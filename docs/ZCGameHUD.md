# ZCGameHUD 节点与组件需求

以当前 `assets/resources/ui/game/ZCGameHUD.prefab` 为准。`ZCGameHUDView` 负责展示、按钮事件转发和棋盘拖动；`ZCGame` 负责读取模型、执行游戏动作和刷新 HUD。保留现有节点布局与嵌套 prefab。

## 节点与数据对应

| 节点路径（相对 HUD 根节点） | 脚本字段 | 职责 / 数据来源 |
| --- | --- | --- |
| Background | 无动态绑定 | 预制体背景和 Widget 适配 |
| MapScrollView | mapScrollView | 地图容器；对局中停止原生滚动，统一由 HUD 处理二维拖动 |
| MapScrollView/view | mapViewport | 裁切区域、触摸监听、实际视口尺寸 |
| MapScrollView/view/content | mapLayer | 地块、单位、城墙与特效挂载点 |
| MapScrollView/view/content/Background | mapBackground | 铺底大图；按全景倍率 `cover` 铺满（**不再 `getChildByName('Background')`**） |
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
| leftPanel/ResetCameraBtn | resetCameraButton | 派发 `ResetCamera` 意图事件（`ZCGame` 订阅后调 `hudView.resetCamera()`）；**不判 `playing`**，与排行榜 / 指南一致 |

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
- 地图停靠机位是 `ZC_MAP_PRESENTATION_SCALE = 1`（见下「战斗相机」）；拖动边界使用 view 的实际尺寸；移动超过 10 UI 像素标记为拖动，等触摸结束事件派发完成后再清标记，避免误点地块。
- 重复初始化先解绑旧监听；禁用或销毁 HUD 时清理按钮、触摸与尺寸监听，并恢复 ScrollView 原先的 enabled 状态。
- 删除旧 `statLabel`、`hintLabel`、`artifactLabel`、`resetButton` 依赖；不再显示“点击右上角重开”的过期提示。

## 战斗相机（缩放 / 一键复位）

对应需求 R22「【战斗】相机」，四条分工：①「局内支持地图缩放，每个地图配对应的最大最小倍率」与 ③「镜头一键复位，回到初始点位，主城位于中心点下方 100px」为**新做**；②「开场推镜头」由既有 `playMapIntro` 承担、④「结算拉高镜头看占据格子变化」由既有 `startSettlementOverview` 承担，本轮只把两者的**收尾倍率**统一成 `mapSettleScale`。

### 倍率真源只有一份

| 环节 | 位置 | 说明 |
| --- | --- | --- |
| 原始配置 | 地图 JSON `zoomMin` / `zoomMax` | 缺省 `0.6 / 1.2`，硬边界 `0.3 ~ 1.5` |
| 解析 | `ZCMapConfig.resolveZCMapZoom(layout)` | **越界 / 非数字 / 上下限颠倒一律抛错，不夹取**；正常返回夹在硬边界内的区间 |
| 运行时 | 模块级 `ZC_MAP_ZOOM_MIN` / `ZC_MAP_ZOOM_MAX` · `captureZCMatchConfig` 的 `map.zoomMin/zoomMax` | 由 `configureZCMap` 写入 |
| 视图 | `ZCGameHUDView.setMapZoomRange(min, max)` | 内部取 `Math.min/max` 兜底顺序；**HUD 侧不写第二份默认值** |

`ZCGame` 在 `createGame` 与 `finishSpawnSelection` 两处 `setMapFocus(...)` 之后各注入一次（选点后会重解析那份配置）。

> ⚠️ 地图编辑器 `tools/map-editor/app.js` 的 `buildJSON()` 是**白名单式重写**：加地图字段必须**同时**改它的导入白名单（`applyLayout`）与导出白名单，只改一处字段就会被静默吃掉。

### 两条输入路径共用一套夹取

- **触摸双指**：`beginPinch` 在**落指当帧**就记好参照（指间距 + 当时的倍率），`stepPinch` 按「当前指间距 ÷ 参照间距」算目标倍率 —— 这样第一帧 `move` 就能缩放，不用等第二次移动。
  **必须用 `EventTouch.getAllTouches()`**：`getTouches()` 在"第一根手指按住不动、第二根刚落下"时只报第二根，拿不到指间距。`stepPinch` 里保留「没参照就补记参照、本帧不缩」的兜底分支，防上层吞掉第二根手指的 `TOUCH_START`。
- **桌面滚轮**：`Node.EventType.MOUSE_WHEEL`，每格 `× (1 ± ZC_MAP_ZOOM_WHEEL_STEP = 0.12)`。
- 两条路径最终都走 `applyMapZoom(scale, anchor?)`：`clampMapZoom` 夹取后**锚点钉住** `offset' = anchor - (anchor - offset) / scale · scale'`，再 `applyMapOffset` 收尾（偏移本身仍要受 `clampMapOffset` 边界约束）。
- 锚点必须经 `UITransform.convertToNodeSpaceAR` 换算 —— `getUILocation()` 给的是 UI 世界坐标，窄长屏带黑边时会整体偏移。
- 双指进行期间**不算棋盘拖动**（先判 `mapCameraBusy`，再 `beginPinch` / `stepPinch`，最后才考虑拖动）。
- 单指不再缩放（早期版本的「单指拖动顺便缩放」已移除）。

### 一键复位 = 秒回，刻意不做补间

`resetCamera()` = `pinchStartDistance = 0` + `resetMapPosition()`，**直接复用开下一局的那条路径**（同一份初始点位、同一套背景铺底），不写 `tween`。

- 复位点位：`mapRestCenterAtScale(focus, scale)` 返回 `{ x: -focus.x · scale, y: -focus.y · scale - ZC_MAP_HOME_CENTER_OFFSET_Y(100) }`。**屏幕 Y 轴向上为正**，所以需求原话「主城位于中心点**下方** 100px」落在 `-100`。
- 复位必须**同时清掉 `settlementOverviewRequested` / `settlementOverviewDone`** —— 否则 `mapCameraBusy` 会一直挂着，棋盘拖不动。
- 入口是左侧面板 `ResetCameraBtn` → `EventMgr` 的 `ZCGameUiEvent.ResetCamera` → `ZCGame.onHudResetCamera()` → `hudView.resetCamera()`。按钮**不判 `playing`**（与排行榜 / 指南一致），对局结束后也能把镜头拉回来。

### 全景 / 结算镜头不受玩家区间约束

`mapOverviewScale`（全景，封顶 `ZC_MAP_PRESENTATION_SCALE`）与 `mapSettleScale`（= `clampMapZoom(1)`）是**脚本演出**用的机位，**不夹进玩家可缩放区间**。否则 `zoomMin` 配到 0.6 的地图就再也看不到整盘了。

### 视口组件只查一次

`MapScrollView/view` 的 `UITransform` 全类只有一处 `getComponent`：`mapViewportTransform` 缓存 getter（`initialize()` 里清缓存以保证换局重取）。本工程**禁「按名找节点」**，原先 `getChildByName('Background')` 已改成 `@property mapBackground`。



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

1. 打开 HUD prefab，25 个脚本引用指向对应节点或组件；玩家条目的六个内部引用完整。
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
7. 战斗相机：地图 JSON 少配 / 只配一半时落缺省 `0.6 / 1.2`，越界 / 非数字 / 颠倒时 `resolveZCMapZoom` **抛错**；
   `setMapZoomRange` 注入后双指与滚轮都夹在区间内、锚点不动；点 `ResetCameraBtn` 秒回初始点位
   （主城落在中心点下方 100px、倍率回默认机位）且能重新拖动棋盘。判据 `tests/zcds-map-declaration.test.ts` /
   `zcds-hud.test.ts` / `zcds-hud-multiteam.test.ts` / `zcds-rank-board-wiring.test.ts`。
