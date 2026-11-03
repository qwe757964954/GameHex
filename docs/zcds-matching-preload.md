# 匹配期间预加载对局

匹配界面进入后，`MatchingComposition` 在发起开战请求时创建本局 `ZCBattleController`。会话等待有效回包，再由 `ZCGameLoader` 按阵容、地图和波次准备首帧资源；不创建战斗节点。加载通过既有 AssetService、ResourceLoadManager 和 ScopedAssetCache 调度与复用。

匹配成功展示结束后，将对手、权威开战数据和同一个 `session` 交给 `ProcedureGame`。`BattleComposition` 接管会话，等待原有 `ready` Promise，进入战斗时才装配运行节点。直接进入战斗也使用同一套会话准备逻辑。

资源从准备到退出始终归会话唯一的 ResourceScope。来源退出释放尚未接管的会话；战斗流程开始接管时解除来源的释放登记，改由目标流程管理。目标导航取消、准备失败或会话退出立即释放；取消后的迟到结果不得挂载。重复 prepare 复用同一个 Promise，禁止重复接管。不再使用 ZCGamePreload、预加载专用 ComponentController 或登录会话内的战局暂存。

大地图由 BigMapEntry 创建本局会话。领地直进战斗由 TerritoryEntry 在收到开战输出时准备会话，页面只接收就绪 Promise、播放过场并派发 enterBattle 意图。领地准备失败时仍保留直接加载回退。公共资源后台预热仍由 AppSessionAssetService 管理，与本局状态分开。

会话创建统一传入 `{ owner, battle?, params? }`，立即登记归属并启动准备；调用方只使用 `ready`、`adopt`、`mount`、`dispose`。直接进入战斗也在创建时传入完整参数；已取消或已释放的目标流程不创建会话。

验证：`npx tsx --test tests/battle-entry-controller.test.ts tests/battle-preparation-entry.test.ts tests/zcds-matching-preload.test.ts tests/zcds-controller-resources.test.ts tests/matching-controller.test.ts tests/procedure-manager-preload.test.ts`。

## 信息条数量：跟着**本局实际参与人数**走（2026-11-02，两轮收敛）

用户连着打回两次：

> 1. 「匹配界面没有适配对应实际的玩家数量 4 个」
> 2. 「不能写死，需要根据实际参与人数展示 **3人4人或2人**」

第一轮把 `layout(2)` 改成写死 4，第二轮说明**写死谁都不行**——人数是数据，不是界面常量。
口径收到 `matching/MatchSlots.ts` 一处：

| 来源 | 什么时候有 | 权威性 |
| --- | --- | --- |
| `CmdStartBattleRspMsg.unitInfos` 的条数（`battle.units.length`） | 匹配成功那一刻 | **权威**：服务端真发了几个人 |
| `IMatchingEntryParams.participants` | 入口按模式声明 | 提前量，只影响搜索阶段那几秒 |
| `getZCLocalPlayerCountOverride()`（`zcds.playerCount`） | 本地固定 2/3/4 人玩法 | 本机兜底 |

```ts
matchSlotCount(room, serverUnits) = clamp(max(room ?? 0, serverUnits, 2), 2, MATCH_SLOT_BARS.length)
```

- **回包后**：`units.length` 是 2/3/4 里的哪个就画几条，一个席位不少；
- **回包前**：只有"入口声明 / 本地固定人数"可能有值，取较大者；**都没有就不猜**，按最小值 2 铺，
  回包那一下重排（`MatchingModel.snapshot().slots` 重新算，页面只认 `state.slots`）。
- 上限 `MATCH_MAX_PARTICIPANTS = MATCH_SLOT_BARS.length`（4 套槽位配色：蓝 / 红 / 紫 / 黄），
  不写数字。

`MatchingPage` 里**不许再出现任何人数常量**（`MAX_PARTICIPANTS` 已删）——两轮都栽在这上面。

同时还修了另一处"少人"：`MatchingModel.snapshot` 原来 `opponents = [teams.enemy]`（只取**第一个**
敌对单元），现在把 `units` 里除我方**全部**放上去（按对象引用排除 `teams.mine`）。

布局验算（`ITEM_HEIGHT` 160 + `ITEM_GAP` 38，块心 `ITEMS_CENTER_Y` 37）：4 条时上沿 +414、
下沿 −340；`StatusLabel` 在 +469、`TipTitle` 在 −426 ⇒ 上下都还留 55 / 86px，2/3 条更宽松
（三档对照图：`docs/匹配界面-人数适配.png`）。

验证：`npx tsx --test tests/matching-participants.test.ts tests/matching-artifact-icon.test.ts tests/matching-controller.test.ts`。

## 逐条揭示：玩家数据**一条条**弹出来（2026-11-02）

> 「匹配界面加载玩家数据可以随机逐个加载好，稍微有个 0.15~0.5s 的间隔」

口径在 `matching/MatchReveal.ts`（纯函数，零 cc）：

| 时机 | 谁 |
| --- | --- |
| 同帧 | 我方（slot 0）—— 自己的数据本来就在手上 |
| 同帧 | 第一个对手 —— 和"匹配成功"同一帧，否则标题已翻、画面一条不动，读成没反应 |
| 之后每条第 +`[0.15, 0.5]` 随机秒 | 其余对手，一条一条从"放大镜"切成数据，并做一次 0.92→1 的回弹（`MatchPlayerItem.popIn`） |

```ts
matchRevealDelays(count, random)  // [0, 0.15~0.5, 累加…]
```

⚠️ **总时长必须装得下停留时间**：最坏 `(席位数 − 2) × 0.5 ≤ 1.0s`
< `MATCH_MATCHED_STAY_SECONDS`(1.4s)。装不下的话 4 人局的最后一条还没揭示就被带进战场。
这条不等式由 `tests/matching-reveal.test.ts` 钉住。

⚠️ 这是**视图节奏**，不是人数口径：条数仍然只由 `MatchSlots.matchSlotCount` 决定。

## 散云时序：**先切战场，再散云**（2026-11-02 第三轮打回）

> 「云散开进入战场的动画地图就应该是战场，不能是黑色的地图」

旧时序「散云 → 散到 60% 才 `navigate`」有两个毛病：

1. 散开的那 60% 背后是刚被 `hidePageContent()` 关掉的匹配页（连 `Bg` 都关了）⇒ 露出来的是镜头清屏色；
2. `navigate` 一去 `MatchingComposition.dispose()` 把页面连同云一起销毁 ⇒ 最后 40% 根本没播。

现在：

```
closeInstantly()  →  藏 UI + 把云搬到 TerritoryBattleCoverOverlay（挂到 Canvas、紧排 Procedure 之后，跨流程存活）
navigate(Battle)  →  战场在云**下面**挂起来（云密铺不透明，全程看不见）
onSwitchSettled   →  切换落定
   + 0.1s         →  startRelease()：散云，散开露出来的就是战场
   散完           →  覆盖层自己销毁
```

- 🔴 **不能挂流程宿主底下**：`ZCGame.createGame` 第一行就是 `this.node.removeAllChildren()`
  （战场先清空宿主再挂 HUD），挂那儿等于交接完就被删。所以挂宿主的父节点（`Canvas`），
  兄弟位取 `Procedure` 的 index + 1 —— 战场在 `Procedure` 里，弹窗在 `Popup`，正好夹在中间；
- 🔴 **云必须自己持有帧引用**（2026-11-03 实机崩）：云的 `SpriteFrame` 是在匹配流程的
  `ProcedurePreloadContext.resources` 里 `loadDir` 下来的，`ProcedureMatching.onLeave` 一
  `releaseResourceScope()` 就把它们 `decRef` 掉；而此刻云已经搬到 `Canvas` 上、还要接着散。
  图被回收、`Sprite` 还在提交 ⇒ 战场首帧绘制完，渲染管线整屏报
  `frame should not be invalid, it may have been released` → `SpriteFrame.getGFXTexture` 空指针。
  所以 `TerritoryBattleCover` 自己 `addRef` 注入进来的帧（`held`），交接层收工 / 页面销毁时
  `dispose()` 还回去。与 `docs/ZCGameHUD.md`「装饰图必须自己 `addRef()`」同一条口径；
- 兜底：切换迟迟不落定（预加载卡住 / 路由没注册）最多再等 3s 就强行散，不许一直盖着；
- 资源失败那条路（回主界面）**也要散**，否则一屏云会一直盖着主界面。

行为判据：`tests/matching-controller.test.ts`（顺序 `close → go:battle → release`）、
`tests/battle-cover-handover.test.ts`（云有没有被搬出匹配页、帧引用有没有自己持）、
`tests/territory-battle-intro.test.ts`（`addRef` / `decRef` 的配对与幂等）。
