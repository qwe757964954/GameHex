# ZCGameHUD 节点与组件需求

以当前 `assets/resources/ui/game/ZCGameHUD.prefab` 为准。`ZCGameHUDView` 负责展示、按钮事件转发和棋盘拖动；`ZCGame` 负责读取模型、执行游戏动作和刷新 HUD。保留现有节点布局与嵌套 prefab。

## 节点与数据对应

| 节点路径（相对 HUD 根节点） | 脚本字段 | 职责 / 数据来源 |
| --- | --- | --- |
| Background | 无动态绑定 | 预制体背景和 Widget 适配 |
| MapScrollView | mapScrollView | 地图容器；对局中停止原生滚动，统一由 HUD 处理二维拖动 |
| MapScrollView/view | mapViewport | 裁切区域、触摸监听、实际视口尺寸 |
| MapScrollView/view/content | mapLayer | 地块、单位、城墙与特效挂载点 |
| TopInfoPanel/LeftPlayer | leftPlayer | GamePlayerItem：我方昵称、头像、存活兵力 / unitCap |
| TopInfoPanel/RightPlayer | rightPlayer | GamePlayerItem：敌方昵称、头像、存活兵力 / unitCap |
| TopInfoPanel/GameVS | gameVS | GameVS：双方领地数量；暂按领地语义接入 |
| TopInfoPanel/time/timeLab | timeLabel | remainingSeconds 向上取整，显示 m:ss，最低为 0:00 |
| BottomInfoPanel/di/GoldLabel | goldLabel | playerGold 向下取整，只显示数字，金币图标由 coin 节点提供 |
| BottomInfoPanel/ArtifactButton | artifactButton | 释放神器；仅对局进行中、充能 ≥ 100、冷却 ≤ 0 且已绑定动作时可点 |
| BottomInfoPanel/ArtifactButton/ArtifactIcon | artifactIcon | 不可释放时置灰；当前布局没有充能或冷却文字节点 |
| BottomInfoPanel/DeckLabel | deckLabel | 玩家卡组名称与已激活羁绊 |
| BottomInfoPanel/BattleLogLabel | logLabel | 当前操作提示或结算原因，加最近两条战报 |
| leftPanel/RankBtn | rankButton | 派发 openRank 回调 |
| leftPanel/ZhiNanBtn | guideButton | 派发 openGuide 回调 |
| leftPanel/HurtBtn | damageButton | 派发 openDamageStats 回调 |
| leftPanel/RunAwayBtn | retreatButton | 派发 retreat 回调，仅对局进行中可用 |

## 对外接口

```ts
hud.initialize({
    useArtifact: () => useArtifact(),
    openRank: () => openRankPanel(),
    openGuide: () => openGuidePanel(),
    openDamageStats: () => openDamagePanel(),
    retreat: () => showRetreatConfirmation(),
});

// 登录或匹配结果提供身份信息；不提供时保留 prefab 的昵称和头像。
hud.setPlayers(
    { name: '我方昵称', headSpriteFrame: playerAvatar },
    { name: '敌方昵称', headSpriteFrame: enemyAvatar },
);
hud.render(model, lastHint);
```

上例中的业务函数由宿主提供。当前 `ZCGame` 只接入已有的神器动作；排行、指南、伤害统计页面及撤退流程尚未实现，相应按钮在未提供回调时不可点击。撤退不能复用旧的重开行为。身份设置在下一次 `render` 生效。

## 初始化、刷新与交互规则

- 引用在 prefab 中持久化；三个嵌套组件采用 Cocos 的 TargetOverrideInfo 绑定。
- 各显示区域独立刷新。缺少某个 Label 不会阻止玩家、金币、计时或 GameVS 更新。缺少地图核心节点时，ZCGame 输出明确错误并停止创建棋盘。
- 兵力不计入 `battleState === 'dead'` 的单位；领地数直接来自模型，GameVS 根据双方数量计算占比。
- 地图沿用 2.15 倍显示缩放及原有初始偏移。拖动边界使用 view 的实际尺寸；移动超过 10 UI 像素标记为拖动，等触摸结束事件派发完成后再清标记，避免误点地块。
- 重复初始化先解绑旧监听；禁用或销毁 HUD 时清理按钮、触摸与尺寸监听，并恢复 ScrollView 原先的 enabled 状态。
- 删除旧 `statLabel`、`hintLabel`、`artifactLabel`、`resetButton` 依赖；不再显示“点击右上角重开”的过期提示。

## 结算演出（镜头拉远看全局 → 逐格归色）

胜负判出后、结算弹窗弹出前播一段演出，**两拍**，全程用**现有地块资源**（`.prefab` 里已绑的
`playerTileFrame` / `enemyTileFrame` / `playerSelectionFrame` / `enemySelectionFrame` 复用，不新增美术）：

1. **镜头拉远、居中看全局** —— `ZCGameHUDView.startSettlementOverview()`，0.55s `quadInOut`。
   从玩家**当前**视角平滑拉到「整盘刚好装进视口（四周留 36）」的缩放并居中，**播完就停在
   全局视角**（不像开局入场 `playMapIntro` 那样再 zoom 回游戏倍率 —— 结算要的就是一直在全局
   看完整盘变色）。玩家可能刚把视角拖到角落，不先摆正的话半张棋盘在屏幕外，
   逐格变色等于没看到。
2. **逐格把地块染成胜利方颜色** —— 0.018s/格，最后一格亮完再停 0.35s 才弹窗。

| 环节 | 位置 | 职责 |
| --- | --- | --- |
| 分步表 | `ZCGameViewUtil.buildVictorySweepPlan(map, winner)` | 给每个可玩格排一个**唯一**步号：先按「离胜利方隔了几行」分层（我方胜 `layer = maxRow - row`，从最下面一层起；敌方胜 `layer = row - minRow`，从最上面一层起），同层内按列 `x` 升序。同层内 `x` 互不相同 ⇒ **全序确定**，不依赖引擎排序稳定性 |
| 覆盖表现 | `ZCHexView.setSweepOwner(owner \| null)` | 非 `null` 时把这一格的底图 / 色调 / 阵营选框整个画成该阵营，压过 `state.owner`。**只影响这一帧画什么，不回写模型** |
| 逐帧推进 | `ZCGameRenderWorld.startVictorySweep / advanceVictorySweep / clearVictorySweep` | 只在**步号变化**时重画；`ZCHexView.render` 的 `contentKey` 再挡掉没变化的格，实际每拍只有跨过边界的那一两格真的换图 |
| 接线与闸门 | `ZCGame.update` 的结算分支 + `beginVictorySweep()` + `settling` | 见下 |

节奏常量：`ZC_VICTORY_SWEEP_STEP_SECONDS = 0.018`（每格）+ `ZC_VICTORY_SWEEP_HOLD_SECONDS = 0.35`
（收尾）。整盘 174~260 格 ≈ 3.5~5s，加上镜头 ≈ 4~5.5s 后弹结算。**想调快慢只动这两个常量**
（镜头时长是 `ZCGameHUDView.MAP_SETTLEMENT_ZOOM_SECONDS`）。棋盘尺寸**每次开局随机**
（实测跑过 198/18 行、174/20 行、260 格），所以别把格数当常量用。

为什么分层用**行**、层内又**逐格**：

- 分层按行、不按到主城的像素距离 —— 按像素半径会变成圆形扩散，同一时刻亮起的格子散落在
  各行，看着像噪点而不是"这片地归我了"。
- 层内再逐格、不整层一起亮 —— 齐平推进线看着像扫描特效；一格一格走才看得出"逐个变色块"。
  代价是重画频率高了一档，由 `contentKey` 兜住（任意时刻最多**一层**处于"填到一半"）。

四条必须守住的约束：

1. **`update` 里 `this.model.tick(dt)` 无条件调**。`ZCGameModel.tick` 首行就挡非 playing，
   所以判出胜负那一帧照常走这一刀，既有语义不能丢（用例钉的 `ticks === 1` 就是它）。
2. **起扫场绑在结算分支入口、每帧幂等调用**，不能绑在「`tick` 刚判出胜负那一帧」——
   胜负也会由服务端快照 / 掉线判负置位，绑死单帧就会静默没有扫场。
3. **镜头门在变色之前**：
   ```ts
   if (this.beginVictorySweep() && this.hudView) {
       if (!this.hudView.settlementOverviewSettled) { this.hudView.startSettlementOverview(); return; }
       if (this.renderWorld?.advanceVictorySweep(this.model, dt)) return;
   }
   ```
   `beginVictorySweep()` 返回**要不要播**：平局没有胜利方、整盘没有可染的格子都返回 `false`，
   直接弹窗别等。`hudView` 为 `null`（编辑器单挂路径 / 单测桩）时整段跳过，降级成"没有镜头"。
4. **`settling` 是唯一操作闸门**（`settlementOpened || 非 playing`），`onHexClick` / `openRunAway`
   都走它：演出这几秒棋盘还在画，不挡就能点着买地、拉战报。镜头侧对应 `mapCameraBusy`
   （入场动画或结算拉远期间）吞掉棋盘拖动。`shutdown()` 里要先 `clearVictorySweep()` 再 `destroy()`，
   否则 `sweepOwner` 留给下一局。

## 场景装饰（地图编辑器摆的礁石 / 沉船）

所有装饰统一落盘于 `art.freeDecor`，使用地图局部坐标和独立宽高，不占格，也不影响寻路、建造或领地判定。
数据形如 `{ id, art, x, y, width, height, rotation, flipX, flipY }`。编辑器支持画布放置、拖动、旋转、
等比缩放、翻转、复制、锁定、删除和可选格心吸附。旧地图 `art.tiles` 中的 `"行,列"` 装饰键不再导入或渲染，
需要在编辑器中重新摆放；`art.tiles` 只保留地块贴图键。

| 环节 | 位置 | 职责 |
| --- | --- | --- |
| 挑选与加载 | `ZCGameLoader.loadDecorFrames()`、`ZCGame.installMapDecor()` | 从 `art.freeDecor` 收集资源名并去重预加载 |
| 算摆放 | `ZCGameViewUtil.buildDecorPlacements(freeDecor, measure)` | 保留地图局部坐标、尺寸、旋转与翻转；非法条目或缺失资源不进入清单 |
| 铺节点 | `ZCGameRenderWorld.installDecor(placements, frames)` | 在棋盘 prefab 的 `DecorLayer` 下铺 Sprite；不创建玩法实体 |

⚠️ **装配路径必须补 `/spriteFrame` 这一层**。地图 JSON 里存的是 `image/decor/<主题>/<名字>`，
而 `resources.load` 要的是 `<完整路径>/spriteFrame`（CC 3.x 的图片是「子资源容器」）。
少了它不会报错，只会**静默 404** —— 装饰一个都画不出来，看着像功能没做。唯一入口
`ArtPaths.decorFramePath()`（根目录常量 `DECOR_ART_ROOT`）。

自由装饰统一挂到 `ZCGameBoard.prefab` 的 `DecorLayer`，尺寸由 `UITransform` 写入，Sprite 使用 `CUSTOM` 和
`trim = false`，从而与编辑器的完整图片预览一致。

**生命周期约束**：

- `installDecor` 幂等（先 `clearDecor` 再铺）：重开局 / 换地图不会叠出两层。
- `destroy()` 里必须显式 `clearDecor()` —— 装饰不在 `this.scene` 里（不是 ECS 实体），
  实体遍历收不到它。
- `resources.load` 拿到的 `SpriteFrame` **必须自己 `addRef()`**。装饰图没有任何 prefab
  静态引用它，而模块级 `Map` 不参与引擎引用计数 —— 不加这一行，图一旦被回收，还挂在棋盘上的
  Sprite 下一帧就崩在渲染管线里（每帧一条 `getGFXTexture` 报错）。样板 `CardLineupIcons.loadArt`。

## 验收

1. 打开 HUD prefab，16 个脚本引用指向对应节点或组件；玩家条目的六个内部引用完整。
2. 双方兵力只统计存活单位；时间和金币单独显示；GameVS 跟随领地变化。
3. 神器未充满、冷却中或对局结束时不可点击；就绪后一次点击只调用一次动作。
4. 未接入的左侧按钮禁用；提供回调后各自独立触发。
5. 重复 initialize、禁用再启用不会积累监听；拖动不触发地块操作。
6. 结算演出：镜头先拉远（`scale` 变小）且**拉远期间一格都没染**、首次染色时 `scale` 已等于全局缩放；
   随后逐格推进（总步号数 = 可玩格数；任意时刻最多**一层**处于"填到一半"；单次采样增量远小于一层）；
   我方胜起手就在最靠我方那一侧、末帧全盘归我方；敌方胜相反；弹窗首帧时地块已全染；
   模型 200 格归属与状态零改动；收起覆盖后立刻回到真实归属。
   真引擎验收 `tmp/_victory_sweep_probe.mjs`（**20 条断言全绿**），
   单测 `tests/zcds-progress.test.ts` 末三条。
