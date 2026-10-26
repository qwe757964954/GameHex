# 占城大师（zcds）表现层与领地专项规范

> **定位与适用范围**：
> - 本文档拆分自 [AI架构与代码规范.md](https://www.google.com/search?q=.%2FAI%E6%9E%B6%E6%9E%84%E4%B8%8E%E4%BB%A3%E7%A0%81%E8%A7%84%E8%8C%83.md) 原第 `7.3.3` ~ `7.3.11` 节，并已完整合并 `AGENTS.md` 截至 2026-10-16 的全部最新规则（含特效 `_lscale` 口径与 row8 胜利结算三段式扫场），是**对局表现层（`app/zcds/view`）与「冒险」领地页（`app/territory`）的唯一完整实现规格书**。
> - 凡涉及对局棋盘图层、地块激活/脉冲/卡牌/建筑动画、特效缩放、飘字曲线、自选主城、开局归属扩散波、胜利扫场、传说卡横幅以及领地页（含领地喷发 / 资源读数）的修改，必须先核对本文档中的**唯一写入口**、**不变量**与**回归测试判据**。

## 模块核心写入口与必跑单测速查表

| 功能域 | 关键文件 / 唯一写入口 | 必跑单测判据（`npx tsx --test <路径>`） |
| :--- | :--- | :--- |
| 棋盘图层与城墙 y 排序 | `ZCGameBoard.prefab` / `ZCGameRenderWorld.boardLayer`、`renderWallSystem` | `tests/zcds-progress.test.ts`、`tests/zcds-render-performance.test.ts` |
| 地块/建筑/资源图标缩放 | `ZCHexView.renderContent`（图标）、`applyBuildingScale`（建筑） | `tests/zcds-tile-icon-scale.test.ts`、`tests/zcds-building-icon-scale.test.ts`、`tests/zcds-resource-icon-scale.test.ts` |
| 中立资源抬层与兵团落点 | `ZCHexView.setResourceIconRaised`、`applyIconPosition`、`layoutResourceUnits` | `tests/zcds-resource-icon-layer.test.ts`、`tests/zcds-resource-unit-preview.test.ts` |
| 地块激活（脉冲∥缩没→卡牌→建筑） | `ZCHexView.hexActivationFx`、`hexPulseShrinkFx`、`applyTileTransform` | `tests/zcds-hex-activation.test.ts`、`tests/zcds-card-reveal-pop.test.ts`、`tests/territory-hex-flip.test.ts` |
| 点击脉冲的 5 帧序列（对齐缩放 / 一次性退场） | `ZCHexView.applyPulseRipple`、`HexFlipPresentation.hexPulseFx`（`pulseFrame`） | `tests/zcds-hex-activation.test.ts` |
| 单位出生抖动 & 建筑产兵/产金抖动 | `ZCUnitView.playSpawnShake` / `ZCHexView.playBuildingShake`、`drainBuildingShakes` | `tests/zcds-unit-spawn-shake.test.ts`、`tests/zcds-building-spawn-shake.test.ts` |
| 新扩展邻格延迟与描边同步 | `ZCHexView.resolveDevelopableHold`（public） | `tests/zcds-hex-neighbor-reveal-delay.test.ts` |
| 出生 / 受击 / 阵亡特效缩放 | 各特效 `.prefab` 根 `_lscale` / `ZCEffectPool.playSpawnFx`、`playDeathFx`、`playHitFx` | `tests/zcds-hit-fx.test.ts` |
| 受击特效总时长锁 0.15s（加速、无定格） | `ZCEffectPool.HIT_FX_TARGET_SECONDS` / `state.speed`、`ZCGameModel.HIT_FX_SECONDS` | `tests/zcds-hit-fx.test.ts` |
| 出生特效锁总时长 1.25s（speed 由 clip 反推） | `ZCEffectPool.SPAWN_FX_TARGET_SECONDS` / `state.speed` | `tests/zcds-spawn-fx.test.ts` |
| 传说卡出场横幅（金卡 tier 4） | `ZCGameLegendBanner.prefab` / `legendRoleProgress`、`legendRoleEase` | `tests/zcds-legend-banner.test.ts` |
| 「冒险」领地页与台面中心对齐 | `TerritoryPresenter.ts` / `TerritoryMapView.cellCenter`、`applyIconPlacement` | `tests/territory-presenter.test.ts`、`tests/territory-page-split.test.ts`、`tests/territory-cell-center-align.test.ts` |
| 敌方单位顶点色置灰 | `ZCUnitView.applyVisualTint` | `tests/zcds-unit-view-render.test.ts` |
| 自选主城（选择基地模式） | `ZCSpawnSelection.defaultHexFor`、`isPlacing` / `borrowSpawnConfirmButton` | `tests/zcds-spawn-base-confirm.test.ts` |
| 战斗飘字「快进慢出」与收尾漂移 | `ZCFloatTextView` / `floatTextEntrance`、`floatTextFade`、`floatTextDrift` | `tests/zcds-float-text-gold-icon.test.ts`、`tests/zcds-progress.test.ts` |
| 开局归属扩散波 | `ZCClaimWave` / `buildClaimWavePlan`、`ZCHexView.setClaimWave` | `tests/zcds-territory-claim-wave.test.ts` |
| 胜利结算三段式扫场（铺场/回正/脉冲） | `ZCVictorySweep` / `zcDeepFactionColor`、`setSweepOwner`、`appendHexPulseOutlineSegments` | `tests/zcds-progress.test.ts`、`tests/zcds-outline-layer.test.ts` |
| 开局金矿格整圈描边闪烁 | `ZCGameViewUtil.zcNeutralHintAlpha` / `ZCHexView.renderHintOutline` | `tests/zcds-neutral-hint-outline.test.ts` |
| 领地随机资源格「翻开」（**原地碎裂**，2026-10-16 起只剩这一套） | `core/hex/HexFlipPresentation.hexShatterFx` / `TerritoryHexFlip.applyFace`、`applyReveal` | `tests/territory-hex-flip.test.ts` |
| 领地建筑**生成抖动**（先 Y 后 X，120%）+ **展示滞后到翻转结束** | `core/hex/ShakePresentation` / `TerritoryStationView.playBuildingShake`、`TerritoryMapView.pendingBuildingReveal`、`ITerritoryStationRender.hidden` | `tests/territory-building-shake.test.ts` |
| 领地「获得银币 / 体力」**格心抛物线喷发（12 颗 · ±26° · 自身上下翻面）** + 读数在其**上方 40px**（row17，2026-10-17 细化） | `model/TerritoryResourceGain.territoryBurstLaunch / territoryBurstParticle` / `view/TerritoryGainBurst` / `TerritoryMapView.playResourceGain`、`ensureBurstRoot` | `tests/territory-resource-gain.test.ts` |

## 1. 对局棋盘的图层结构与地块表现（`ZCGameBoard.prefab`）

### 1.1 声明式棋盘图层（代码不拼层）与城墙排序

`ZCGameRenderWorld` **禁止在代码中 `new Node` 拼图层**。地图层下的结构固定声明在 `ZCGameBoard.prefab` 中，**子节点顺序 = 渲染顺序**（后画的压在上面）：

```text
mapLayer（= ZCGameHUD.prefab 的 content）
└─ ZCGameBoard          ← ui/game/ZCGameBoard.prefab（ZCGameLoader 加载 → ZCGame 实例化后挂进来）
   ├─ MapWater          水面：cc.Graphics，矩形在 initialize 里按地图包围盒画
   ├─ HexLayer          地块实例挂这里
   ├─ OutlineLayer      整盘共享的领地轮廓：一个 cc.Graphics（ZCOutlineLayer 逐边描线）
   ├─ (ZCGameWallLayer) ← 城墙砖层来自独立 prefab，initialize 时插到 OutlineLayer 之后（outlineLayer.getSiblingIndex() + 1）
   ├─ ResourceLayer     中立资源图标：从地块节点里抬上来的（压得过墙砖，防图标被墙线切断）
   ├─ DecorLayer        自由装饰：ZCGameDecor.prefab 的条目挂这里
   ├─ BuildingOverlay   建筑剪影（从地块节点里提升上来的）
   └─ CooldownOverlay   生命条 + 冷却圈
```

- **硬约束**：
  1. 层的引用一律走 `board.getChildByName('<层名>')`（`ZCGameRenderWorld.boardLayer()`），严禁再用 `siblingIndex` 现算层序或 `new Node` 建同名层。
  2. 城墙层插入锚点必须是 `OutlineLayer + 1`（若插在 `HexLayer + 1` 会导致轮廓线从墙砖里穿出来）。
  3. 各层（含水面）的 `layer` 必须全部为 `UI_2D`。
  4. `destroy()` 只摘 ECS 实体与装饰节点；**board 与城墙层归调用方（随 HUD 销毁）**，渲染层内严禁拆毁。
- **中立格只做矢量绘制（2026-10-16）**：中立格**不铺地块底图**（`ZCHexView.NEUTRAL_FILL_ALPHA = 0`，
  `setSprite` 见 alpha 0 连 Sprite 都不启用）⇒ 棋盘底图直接透出来；格子感全部由 `OutlineLayer`
  的矢量线提供 —— 中立格自己画**暖棕细线**（`ZCOutlineLayer.NEUTRAL_GRID_LINE_WIDTH/COLOR`，
  半透明深色叠在底图上、颜色随底图走），与阵营交界的那条边仍由阵营方的粗线负责
 （`buildTerritoryBoundaryMasks` 已把它从这一格的 mask 里剔掉）。
- **城墙砖全盘按屏幕 y 降序排列**：
  - `ZCGameRenderWorld.renderWallSystem` 在铺砖前必须把**全盘**墙段按 `segment.y` **降序**排一遍（y 小的后画 ⇒ 越下方的城墙层级越高、恒压住上方的城墙）。
  - ⚠️ **必须整盘一起排**，严禁按格或按连通簇分段排（分段会让环形城墙接角处的上下关系随遍历顺序漂移，出现“有的角对齐、有的角带台阶”）。
  - ⚠️ 排序会打乱 `segmentIndex` 与六边形 edge 的对应关系，共享材质帧槽号也按新顺序分配 ⇒ 单测必须**按落点坐标反查边号**，不得写死 `records[edge]` 或 `rightUp = 0`。
- **判据**：`tests/zcds-progress.test.ts`（图层顺序与 `_layer`）、`tests/zcds-render-performance.test.ts`（跨格城墙按屏幕 y 降序）、端到端探针 `tmp/_board_probe.mjs`。

### 1.2 地块图标缩放、中立资源抬层与落点

- **地块与建筑图标缩放由代码唯一决定（只改 Prefab `_lscale` 会被静默覆盖）**：
  - `iconSprite` 同时承载地块类型图标（`icon_jk/by/wh/em`）与中立资源点图标，唯一缩放写入口为 `ZCHexView.renderContent`：类型图标写 `TILE_ICON_SCALE = 0.8`，资源图标按 `resourceIconScale` 缩放到格子边长。
  - 已建建筑唯一缩放写入口为 `applyBuildingScale`（基准 `BUILDING_ICON_SCALE = 0.72`）。
  - 金币图标 `BuildingLayer/PriceIcon` 与价格数字 `BuildingLayer/IconLabel` **不参与**上述缩放。
  - **判据**：`tests/zcds-tile-icon-scale.test.ts`、`tests/zcds-building-icon-scale.test.ts`、`tests/zcds-resource-icon-scale.test.ts`。
- **中立资源图标必须抬到 `ResourceLayer`（防邻格切边）**：
  - **物理原因**：地块整图 130×119、格距仅 92.25×90（相邻格整图重叠）；资源图标 128×128 大于地块顶面 123×90，若留在格节点内必然被后画的邻格沿格边线齐刷刷切掉一半。
  - **唯一入口**：`ZCHexView.setResourceIconRaised`（唯一写 `parent` 入口）将其抬至 `ResourceLayer`，并由 `applyIconPosition`（唯一写坐标入口）换算为棋盘层局部坐标（`格节点位置 + BuildingLayer 偏移 + 图标偏移`）。
  - 地块类型图标字形仅 33×33 落在顶面内，**不抬层**。激活表现的「整格隐藏」段需在 `applyActivationFx` 中同步控制已抬层资源图标的显隐。
  - **判据**：`tests/zcds-resource-icon-layer.test.ts`。
- **地块类型图标落点与兵团资源落点**：
  - `ZCHexView.DEFAULT_TILE_ICON_POS` 与 `ZCGameHex.prefab` 的 `BuildingLayer/BuildingIcon._lpos` 必须同值：当前 `y = 4`（下界 `y >= 1.4`，再小会切到底部 `y = -26.376` 的金币图标）。注意 `BuildingLayer` 挂有 `cc.Widget`，运行时局部 `y = 15.101`（早期注释中的 `2.342` 已作废）。
  - 中立兵团资源点（`unit_cap`）格内兵团纵向落点为 `ZCHexView.RESOURCE_UNIT_POS_Y = 12`（横向间距 `RESOURCE_UNIT_SPACING = 16`、目标高 `RESOURCE_UNIT_TARGET_HEIGHT = 48.6` 保持不变），防止小兵陷进地块下半部被侧壁遮挡。
  - **判据**：`tests/zcds-resource-unit-preview.test.ts`。

### 1.3 地块激活表现：点击动画（阶段 1 脉冲 → 阶段 2 缩没，0.7s）→ 卡牌弹出 → 建筑同拍由小变大

`ZCHexView.hexActivationFx` 将总时长 `ZC_HEX_ACTIVATION_SECONDS = 1.856s` **按秒切成两段**（总长由固定段长相加得出：`ZC_HEX_ACTIVATION_SECONDS = ZC_CARD_START_SECONDS(0.7) + ZC_CARD_REVEAL_SECONDS(1.156)`；卡牌段固定 `1.156s` 以保证淡出窗恒大于建筑生长时长，与点击动画段解耦）：

| 阶段 | 时间窗口 | 核心行为与不变量 |
| :--- | :--- | :--- |
| **① 点击动画段** | `[0, ZC_CARD_START_SECONDS = 0.7s)` | 合成函数 `hexPulseShrinkFx`，**两阶段先后**（2026-10-19）：<br>**阶段 1** `[0, 0.2s)` 只播脉冲 —— `GroundGlow` 按 `pulseFrame` 播 5 帧美术序列（10fps、一道波 `0.5s`；放大与淡出**烘焙在图里**），格子连图标 + 价格数字**原尺寸不动**（`tileScale` 恒 1）；<br>**阶段 2** `[0.2s, 0.7s]` 脉冲继续（0.5s 处自然退场），格根同时原地等比缩至 `0.1`。全程 `tileLift = 0` 零位移、`buildingPopScale = 0` 保持开发前价格外观 |
| **② 卡牌弹出段** | `[0.7s, 1.856s)`（长 `1.156s`） | `0.7s` 当帧显形（`now < startedAt` 时写绝对 `node.active = false`，严禁可见静止干等），按 `elasticPopScale`（`0.2 → 峰值 1.2 → 下探 0.92 → 1`）弹出，`progress = 0.62` 起淡出 |
| **③ 建筑同拍生长** | 卡牌最后 38% 淡出窗（`0.43928s`）内 | 卡牌开始淡出那刻地块原尺寸回场，建筑在 `ZC_HEX_BUILDING_SECONDS = 0.36s` 内从 `0.15` 经同一条 `elasticPopScale` 长到 `1`（`0.36 < 0.43928` 保证卡牌淡完时建筑已长齐） |

- **点击动画段六条硬约束**：
  1. **只由缩没写格根 `tileScale`**：`hexPulseFx` 的 `tileScale` 恒为 `1`；缩没由 `hexPulseShrinkFx` 在 **阶段 2** 才写入 —— 起点 `HEX_PULSE_SHRINK_START_SECONDS = 0.2s`（= 5 帧里的**中间帧**第 2 帧开始那一刻，`HEX_PULSE_FRAME_SECONDS × 2`，别写成 `WAVE/2` 差半帧），跨度 = `ZC_HEX_SHRINK_SECONDS - 0.2 = 0.5s`，末刻收到 `HEX_SHRINK_MIN_SCALE = 0.1`。**段长仍恒 0.7s**（卡牌弹出 / 首批兵 / 邻格按住窗都锚它），严禁把整段也改成 0.5s。
  2. **脉冲层必须抵消父节点缩放与位移**：脉冲节点 `GroundGlow` 是格根的子节点，格根缩小时，`applyPulseRipple` 必须写入 `局部缩放 = 对齐换算 / 格根缩放`、局部 y 写入 `ZC_LAND_TOP_CENTER_LIFT / 格根缩放`。对齐换算是**常量**：把美术图里 `164×142` 的本体摊成格面 `123×90` ⇒ `x = 123/164`、`y = 90/142`（本项目格面 1.367 比正六边形 1.155 更扁，**不许等比**）。节点 `contentSize` 必须按整张 `320×320` 画布给（波最大约 `292×253`，只给格面尺寸会把波挤扁）；离开脉冲段由 `restorePulseLayer` 把缩放归 1、`contentSize` 写回 prefab 的 `130×239`。
  3. **只换帧，不叠 scale / opacity**：美术已把放大（1.00 → 1.78）与不透明度（70% → 15%）烘焙进图，`hexPulseFx` 只产出 `pulseFrame`（5 帧、10fps、`0.1s/帧`）；**不许**在节点上再写缩放 / 透明度动画（等于放大两次、虚化两次），也不再使用 `shaders/hex-pulse.effect` 的径向虚化（旧 30 帧 `fkz_*` 那套已整条退役）。一道波 `0.5s` 播完 ⇒ `pulseFrame = HEX_PULSE_FRAME_HIDDEN(-1)` 直接退场，段尾剩下 `0.2s` 只有缩没在走（**不许**举着末帧当静止波）。
  4. **全程零位移（`tileLift = 0`）**：保持地块与图标中心点坐标不变；底光序列帧（依赖 `tileLift > 0`）与换父置顶（`setRaised`）在对局点击段天然不触发，**严禁为点亮底光而把 `tileLift` 改回非零**。
  5. **无卡牌路径（`hasCardReveal = false`）**：点击动画（两阶段）照常播放，播完直接回常规定格（`HEX_FLIP_IDLE_FX`），不进隐藏段。
  6. **浮点容差与负数保护**：段末比较必须带 `HEX_ACT_SECONDS_EPSILON = 1e-9`；`progress < 0` 必须先返回 idle，严禁交给 `clamp01` 折成 0（否则会把正常建筑 `buildingPopScale` 置 0 藏起来）。
- **判据**：`tests/zcds-hex-activation.test.ts`（含阶段 1 `tileScale` 恒 1、阶段 2 才缩且末刻到 0.1、`pulseFrame` 按 10fps 等宽推进 / 播完退场、对齐缩放恒定、零位移、淡出窗 > 建筑生长时长）、`tests/zcds-card-reveal-pop.test.ts`、`tests/zcds-building-icon-scale.test.ts`、`tests/territory-hex-flip.test.ts`。

### 1.4 单位出生抖动、建筑产兵/产金抖动与新邻格延迟展示

- **单位出生抖动（110%）**：
  - `ZCUnitView.playSpawnShake(now)` 只记起点，`render` 按 `now - 起点` 调 `spawnShakePulse`（先 Y 轴拉至 `1 + SPAWN_SHAKE_STRETCH(0.1) = 1.1` 回落，再 X 轴拉至 `1.1` 回落，各 `SPAWN_SHAKE_PHASE_SECONDS = 0.12s`），叠乘在朝向翻转之上（含描边副本 `applyOutlineCopyScale`）。由 `renderUnitEntity` 的 `isBirth` 分支触发。
  - **判据**：`tests/zcds-unit-spawn-shake.test.ts`。
- **建筑抖动（产兵 + 产金共用曲线，拉伸量 120%）**：
  - 详见第 9.5 节：`ZCHexView.playBuildingShake(now)` 使用 `BUILDING_SHAKE_STRETCH = 0.2`（120%），因子乘进唯一写入口 `applyBuildingScale`，挂 `renderDynamic` 逐帧推进。
  - **判据**：`tests/zcds-building-spawn-shake.test.ts`。
- **新扩展邻格延迟展示与描边同步（row6 + row9）**：
  - 消耗金币开发地块后，新点亮邻格的等待窗为 `ZC_HEX_NEIGHBOR_HOLD_SECONDS = ZC_CARD_START_SECONDS(0.7) + ZC_HEX_NEIGHBOR_REVEAL_DELAY_SECONDS(0.2) = 0.9s`（必须锚定 `ZC_CARD_START_SECONDS`，严禁拼 `ZC_HEX_PULSE_SECONDS` 或 `ZC_HEX_FLIP_SECONDS`）。
  - `ZCHexView.resolveDevelopableHold(now, canDevelop)`（**public**）：只拦截 **`canDevelop` 由假变真** 的格子（严禁按“是否挨着激活格”粗暴隐藏原本已可开发的邻格）；按住期间同时拦截**地块图标、价格、玩家色染色与共享领地轮廓描边**（详见第 9.2 节）；`initialize` 时必须复位 `developableHoldUntil / lastCanDevelop / developableBootstrapped`。
  - **判据**：`tests/zcds-hex-neighbor-reveal-delay.test.ts`。

### 1.5 特效（出生光柱 / 受击 / 阵亡）的显示大小由 Prefab 根 `_lscale` 唯一决定

与地块/建筑图标（由代码定缩放）**正好相反**，特效的显示尺寸完全归属美术 Prefab 根节点 `_lscale`，**在代码里写 `setScale` 或 `setPosition(0,0,0)` 会静默破坏表现**：

| 特效类型 | 资源原图尺寸 | Prefab 根 `_lscale` | 屏上显示尺寸 | 代码端硬约束（`ZCEffectPool`） |
| :--- | :--- | :--- | :--- | :--- |
| **出生特效** | 266×330 | `0.4144` | 110.2×136.8（基准宽 ~110px） | `playSpawnFx` **严禁写 `setPosition` 或 `setScale`**（Prefab `_lpos = (0, -28.2)` 是美术将光柱重心从头顶压到胸口的偏移，写 `(0,0,0)` 会静默覆盖） |
| **受击特效（五组）** | 各异 | 按原图折算后再 **×0.7** | 屏上宽 **77px**（战士 61.6，= 110 基准 ×0.7 ×0.8） | 保持原始像素零插值损失，改大小只动 Prefab `_lscale` |
| **阵亡特效（唯一例外）** | 535×1092 | **`0.16448`**（`= 0.2056 × 0.8`） | **88×179.6**（比 110px 基准小 20%） | `playDeathFx` 只写 `x/y`（阵亡 Prefab `_lpos` 本就是 `(0,0,0)`），**严禁写 `scale`**（池化复用节点每播一次乘一次会逐次缩水；且**严禁顺手把阵亡特效“统一口径”改回 110px**，它刻意缩小 20% 以免抢单位本体视觉重心） |

- **判据**：`tests/zcds-hit-fx.test.ts`（同一条用例同时断言**缩放倍数**与**屏上像素尺寸**，防止原图基数变动漏检）。

### 1.6 受击特效：总时长锁死 0.15s，且不许有定格（2026-10-17）

三条硬约束，缺任何一条都会出现「闪一下之后还剩一坨末帧杵在角色身上」：

| 关注点 | 唯一真源 | 说明 |
| :--- | :--- | :--- |
| **总时长 0.15s** | `ZCEffectPool.HIT_FX_TARGET_SECONDS` + `ZCGameModel.HIT_FX_SECONDS` | 两处必须同值（视图层不 import 模型层常量）；`tests/zcds-hit-fx.test.ts` 有源码级断言钉住 |
| **加速而不是截断** | `state.speed = clip.duration / 0.15` | 资产 `_duration` 仍是美术真值「帧数/18fps」（射手 0.4444s、法师 0.7222s）。改 `clip.duration` / `state.duration` 是**丢帧**，改 `speed` 才是加速 |
| **回收点跟着加速后的时长** | `playHitFx` 里 `duration: HIT_FX_TARGET_SECONDS` | 还按 `clip.duration` 回收 ⇒ 动画 0.15s 就播完、节点留到 0.44s，`wrapMode = Normal(1)` 把**末帧定住** |

- **`play()` 必然 seek 回 0**：`Animation.play(name)` → `crossFade(name, 0)` → `clear()` → `AnimationState.onPlay()` → `setTime(0)`。所以 ① 池化复用节点不会先闪一帧旧画面，无需额外 `stop()`；② **渲染循环里绝不能逐帧调 `playHitFx`**，必须走 `syncHitFx` 按 fx 对象引用去重，否则动画被钉死在第 0 帧。
- **`speed` 只在 `AnimationState.initialize()` 里从 `clip.speed` 取一次**，`play()` / `stop()` 都不重置 ⇒ 每次播放重算 `clip.duration / 0.15` 是幂等的，池化复用不会累乘。3.8.8 的 `play(name?)` **没有** `startTime` 第二参（`animation-component.ts:200`）。
- **判据**：`tests/zcds-hit-fx.test.ts`（`state.speed` 逐个职业断言 + 0.149s 未回收 / 0.15s 必回收 + 两处常量同值）。

### 1.7 出生特效：锁总时长 1.25s（2026-10-19，两次收紧）

用户口径两轮：「播放速度加快，动画总时长缩短成 80%」（2.0s → 1.6s）→「再加速，**1.6s → 1.25s**」。

- **唯一真源** `ZCEffectPool.SPAWN_FX_TARGET_SECONDS = 1.25` —— **锁总时长**，倍速由 clip 反推：
  `state.speed = clip.duration / 1.25`（美术原速 2.0s ⇒ **1.6×**，24 帧 / sample 12）。
  和受击那 0.15s 是同一套做法（见 §1.6）：只动 `speed`，**不改资产 `_duration`**
  （那是「帧数 / sample」的美术真值，改它等于把后半段关键帧丢掉，时间戳不会重排）。
- **回收点就是目标时长**：`duration = SPAWN_FX_TARGET_SECONDS`。`wrapMode = Normal(1)` 播完会**停在末帧**，
  还按 2.0s 回收就多出 0.75s 冻住的残影。拿不到 clip 时也按这个值占位。
- ⚠️ 尺寸 / 位置仍归 Prefab（§1.5），加速**只碰 `speed`**，别顺手写 `setScale`。
- **判据**：`tests/zcds-spawn-fx.test.ts`（`state.speed === 1.6`、1.2s 不回收 / 1.25s 必回收）。

## 2. 抽到金卡的「传说卡出场横幅」（`ZCGameLegendBanner.prefab`）

抽到 `tier === 4`（金卡/传说）时，除地块上的小卡牌（`ZCGameCardReveal`，挂 `mapLayer`）外，同时在 **HUD 根节点 `options.overlayLayer`** 弹出全屏出场横幅 `ui/game/ZCGameLegendBanner.prefab`（四色底板与头像环按 `ZC_CLIENT_COLORS` 色相匹配 `owner`）。

- **宽度 = 屏幕宽度**（2026-10-19 用户口径「传说牌弹出的 UI 提示应该对齐屏幕的宽度」）：
  `applyLayout` 里 **根节点** = `viewWidth × (屏高 / 人数)`（它是「布局格子」，落位按它算），
  **底板 `Banner`** = `viewWidth × 417` —— 只跟宽度走，**高度永远是 prefab 的 417**，
  并强制回到 `x = 0`。设计稿 720 只是兜底（`DESIGN_WIDTH`）。
  - 只改根不改底板 ⇒ 底图仍是 720 宽、右边留一条缝（一次反馈的画面）；
  - 底板连高度也一起按「格子高」拉伸 ⇒ 2 人局被拉到 640，横幅平白长高一截、底边掉到屏幕中间
    （**另一次**反馈「横幅底部的高度被修改了」）。这两条都是实测踩过的，别合并成一次写入。
  ⚠️ 底板 / 标题 / 头像 / 卡名曾在 prefab 里被整体左移 62.6（左贴边、右空一截），已改回设计位；
  改这条链时别再把 `Banner` 往左挪。

- **四条静默失效硬约束**：
  1. **严禁挂 `mapLayer`**：必须挂 `options.overlayLayer`（HUD 根），否则会随棋盘 ScrollView 拖动并被 Mask 裁切。
  2. **立绘原尺寸**（2026-10-10 口径「不用放大了，就用 256×256」）：23 个兵种立绘均为 256×256 方形原图 ⇒
     `Role` 节点 `sizeMode = RAW(2)`、中心锚点、**视图一行都不写 `scale`**（恒 1）。
     早前「按 `frame.height` 等比缩放到高度 333」的口径已废弃（固定框会把方形原图纵向拉扁 30%）。
  3. **禁 Trim 尺寸覆写**：`CUSTOM` 尺寸的 Sprite 必须 `_isTrimmedMode = false`。
  4. **头像圆裁**：`Head` 节点挂载工程既有的 `CircleAvatar`（shader `circle-avatar`），禁止用 `cc.Mask`。
- **扇入与 Role 下落动画（row11）**：详见第 9.4 节。
- **异步头像晚注入**：`ZCGame.loadLegendPortraits()` 异步加载完成后，渲染层每帧 `renderLegendBanners` 里通过闭包取 `ProcedureGame.current?.resolveLegendPortrait(owner)` 喂给 `view.setPortraitResolver`；解析器更换时作废内容键、立刻重绘已弹出的横幅。加载失败则保留玩家色头像环，不阻断对局。
- **判据**：`tests/zcds-legend-banner.test.ts`、端到端探针 `tmp/_legendbanner_probe.mjs`。

## 3. 「冒险」领地页的职责边界（Prefab 骨架 + 三个视图 + 纯 TS Presenter）

### 3.1 职责切分表

| 关注点 | 唯一归属模块 |
| :--- | :--- |
| 主城地图页骨架、布局、Widget 对齐 | `ui/main/MainTerritoryMap.prefab` + `app/main/MainTerritoryMap.ts` |
| 滚动 / 裁剪 / 拖拽 / 拖动中抑制子节点点击 | `cc.ScrollView`（挂在带 `Mask` 的 `MapViewport`，`content = MapLayer`，`cancelInnerEvents = true`） |
| 六边格 + 站点（按 `cellId` diff 复用） | `view/TerritoryMapView.ts` |
| 站点条目、图标 trim 补偿、未解锁格「银币图标 + 数值」排布 | `ui/territory/TerritoryStation.prefab` + `view/TerritoryStationView.ts` |
| 站点 / 待配置据点详情弹层 | `ui/territory/TerritorySiteDetail.prefab` + `view/TerritorySiteDetailPanel.ts`（页内 `instantiate` 持有，`Panel` 挂空 `cc.Button` 防点击穿透） |
| 配色真源 / 坐标换算 / 协议归一化 | `view/TerritoryTheme.ts` / `model/TerritoryMapLayout.ts` / `model/TerritoryMapConfig.ts` |
| 状态与业务编排（纯 TS Passive View） | `application/TerritoryPresenter.ts`（副作用全走 `TerritoryChapterLoader` / `TerritorySaveStoreAdapter` 等端口） |
| 引擎生命周期与渲染接线 | `app/main/MainTerritoryMap.ts`（`MainTabHost.showPage` 必须在 `setParent` 前调用 `initialize(assets)`） |

### 3.2 七条硬口径

快速寻敌优先按当前推进顺序定位未通关 Boss；没有未通关目标时，定位当前章节关卡序号最高的已通关 Boss，同区域优先选建筑格。Boss 关卡、首领波次与异步据点允许重复挑战，区域已通关时跳过再次解锁；详情按钮与地图点击均请求服务端开战，保留在途判重与迟到回包校验。主线 Boss / 首领使用章节格子战斗参数；异步据点沿用服务端确认通关后切宝箱子类型的规则，奖励以服务端结算为准。

1. **滚动用 `cc.ScrollView`**：禁止手写触摸拖拽或建多余 `view` 子节点；切章回中心调 `scrollToOffset(Vec2.ZERO, 0)`。
   - **内容层尺寸 = 地图包围盒 + 四周留白**（2026-10-21 用户口径「整体一起上移，不要被按钮遮挡」）。
     唯一出口 `model/TerritoryMapLayout.territoryMapContentSize()`（`TERRITORY_MAP_CONTENT_PADDING = 300`）。
     ⚠️ 留白不是装饰，是**可滚范围**：`ScrollView` 的偏移被「内容层尺寸 − 视口尺寸」钳死，
     内容层 ≡ 包围盒时，贴到地图下边缘的目标格**再大的抬升量也抬不动**（第一章起始格在第 18 行，
     理想偏移 1312.5、上限只有 940，差 372.5 —— 正好是被【快速寻敌】压住的那一截）。
     加了留白后滚到底时地图底边仍在视口底部之上 300px，而且**格心坐标一个都不用动**，
     `buildTerritoryMapLayout` 与共享格心对齐的契约继续成立。
     判据：`tests/territory-map-layout.test.ts`「滚到地图最底部时，底边仍在视口底部之上留白那么多」。
   - 底图 `syncBackground` 的 cover 必须按**内容层尺寸**算，不能按包围盒 —— 否则滚进留白那 300px 会露空白。
   - 效果对照（左：内容层 ≡ 包围盒；右：内容层 + 2×300 留白）：

     ![领地上移示意](territory-map-shift-preview.png)
2. **节点按 `cellId` diff 复用**：`tickProgress` 每秒重绘，严禁 `destroyAllChildren` 全量重建。
3. **主城 HUD 与地图分层**：`MainTerritoryMap` 只保留地图与详情弹窗；主城顶部信息与导航由 `ArenaRoot` 承载。地图视口顶部贴页面顶边（`MapViewport.Widget.top = 0`），让格子云延伸到顶部 HUD 背后；底部仍预留 168px 导航区。`ArenaRoot` 的 `MapRoot` 排在 `TopHud` / `BottomHud` 前，确保 HUD 显示与按钮点击在地图之上，禁止再通过顶部视口留白裁掉云。进入地图先渲染本地存档，服务端状态后台单调合并，失败仅 `outputs.showTip`。
4. **`@property` 引用区分**：`{type: Node}` 直接是节点本身，组件引用才访问 `.node`。
5. **运行时不画站点解锁连线**：依赖连线仅存在于地图编辑器 `tools/map-editor/territory.html` 的 `g.layer-links` 开关。
6. **Presenter 纯度与单通知通道**：页内只走 `presenter.subscribe()` 一个**本地订阅**通道（纯 TS、返回退订函数、`dispose` 清空），严禁接全局 `FWEventCenter`；视图间跨组件通知统一走**节点事件**（`node.on` / `node.emit` + `view/TerritoryEvents.ts` 的 `TERRITORY_EVENTS` 常量表），监听挂组件自身节点、随节点销毁自动清理；`TerritoryPresenter` 剥掉 `import type` 后严禁 import `cc`、`framework` 或具体边界实现类。
7. **建筑/站点落在格子可见台面中心（`cellCenter` + trim 补偿 + 可见宽归一 70）**：
   - **台面偏移**：地块底图 `img_land_01_gray`（130×119）可见台面占 `y = 2~91`（高 90px），下方 28px 为侧壁；锚点在整图中心 `y = 59` ⇒ 台面中心比锚点高 `HEX_GRID_CONTENT_LIFT = 12.5px`。因此 `TerritoryMapView.cellCenter()` 必须返回 `{ x: point.x, y: point.y + HEX_GRID_CONTENT_LIFT }`（注意：`syncGrid` 中格子节点自身坐标仍为 `(point.x, point.y, 0)`，只偏移格内建筑/站点内容）。
   - **逐图 trim 偏移补偿与可见宽归一（`TerritoryStationView.applyIconPlacement`）**：读取动态合批安全的 `frame.rect / originalSize / offset` 补偿美术非对称留白，并将**trim 后目标可见宽统一归一为 `84`**（2026-10-19 用户要求「当前尺寸调大 120%」：70 × 1.2；可见高 65~75，占台面高 90 的 72~83%，判据 `可见高 <= 台面高 × 0.85`）。取值历史：100 ⇒ 顶满格子（严禁回去）；70 ⇒ 2026-10-15 的保守值；换尺寸只改这一个常量，同屏建筑等比缩放、比例关系不变。
   - **未解锁格的「银币图标 + 数值」成对排布（`TerritoryStationView.applyCaptionPlacement`）**：2026-10-16 需求 —— 图标 **×1.1**、数值 **×1.5**、两者间距**恒 2px**，且这一对**以格心为中心**（数字多一位是往左长、图标同步让位，不是整体右漂）。
     - 间距**不能写成两个固定偏移**（旧实现是图标 `−24` / 数值 `+22`）：那样间距随位数漂，钉不住 2px。改为按**实测文本宽**算 —— 与 `ZCFloatTextView.renderGoldIcon` 的 `GOLD_ICON_GAP` 同一套口径。
     - 数值在条件模式下必须切 `overflow = NONE`：prefab 里它是 `SHRINK` + 固定 `92` 宽、文本居中，**量到的是框宽不是文本宽**（`LayerActivityLayout` 的数量框同理）。写完字符串后立刻调 `refreshCaptionTextLayout()`（`Label.updateRenderData(true)`）把布局逼到**同一帧**，否则「按 A 宽度摆、按 B 宽度画」会让间距偏掉。
     - 引擎还没量过的那一帧（读到出厂宽 92）按**位数**估宽（`CONDITION_DIGIT_WIDTH = 9.5`，Arial 数字等宽 `0.556em`）。
     - ⚠️ 退出条件模式必须还原 `overflow` 与两个缩放：`CaptionLabel` 同时承担「名称底条」文案（那边靠 `SHRINK` 防超宽），且站点节点是**池化复用**的。
- **判据**：`tests/territory-cell-center-align.test.ts`、`tests/territory-map-layout.test.ts`、`tests/territory-map-config.test.ts`、`tests/territory-page-split.test.ts`、`tests/territory-presenter.test.ts`、`tests/territory-station-batching.test.ts`（间距恒 2px / 1·3·5 位数 / 出厂宽那一帧 / 退出模式还原）、`tmp/_territory_probe.mjs`。

### 3.3 随机资源格「翻开」：原地快碎裂（2026-10-16）

需求原文：「地块反转动画优化，**两种方案都做，点击后随机播放**，让我根据播放的结果判断只保留哪一种方案」⇒ 用户看完两套后拍板「**只保留地块破碎效果的方案**」。

于是**只剩一套**：曲线 `hexShatterFx`（`core/hex/HexFlipPresentation.ts`，纯函数、零 `cc`，可脱离引擎单测）+ `HEX_SHATTER_SECONDS = 0.68s`（碎裂段 + 新地皮放大段），由 `TerritoryHexFlip` 走**一条**接线（材质 → `apply` 写口 → `applyFace` 换脸）：

| 环节 | 做法 |
| :--- | :--- |
| 地块本体 | **原地**碎：全程 `tileLift = 0`（不抬起）、`tileFlip = 1`（不旋转）、`tileScale = 1`（不缩整格）—— 需求原文「**原地**快碎裂」，格心坐标与格根缩放全程不动 |
| 碎裂 | **片元级碎块腐蚀**（`shaders/hex-flip.effect`）：格内归一化坐标切 4×4 网格 → 3×3 邻域 Voronoi 取最近 / 次近抖动种子 → `border` 随进度往块心推（错峰碎裂）+ 薄圈裂缝提亮 |
| 换脸点 | `HEX_SHATTER_ERODE_END = 0.55`：到这里旧地皮**已经碎没**，同一帧换成新地皮（换帧看不见） |
| 新地皮 | `revealScale` 从 `HEX_SHATTER_REVEAL_START = 0.42` 起由 0 涨到 1（末尾轻微过冲 `HEX_REVEAL_POP` 再收回）—— 写在**子节点 `Reveal`** 上 |
| 起手 | `flash` 在 `[0, HEX_SHATTER_FLASH_WINDOW = 0.16]` 内冲上去再退掉（整格朝白推一下） |

- **删除的部分（2026-10-16，方案1「抬起后绕水平轴垂直翻转 360°」整条下线）**：
  - core：`hexTurnFx` / `makeTurnFx`、`HEX_TURN_SECONDS = 0.72` / `HEX_TURN_FACE_SWAP = 0.75` / `HEX_TURN_EDGE_FADE_COS = 0.32`、随机点将 `pickHexFlipVariant` + 类型 `ZCHexFlipVariant`、`IZCHexFlipFx.tileSin`、`HEX_FLIP_PERSPECTIVE`（顶点层透视除法）、`hexFlipBodyGlow` + `HEX_FLIP_BODY_GLOW`（正面开口补光）；
  - 视图：每格抽中的 `variant` / `lastVariant` / `totalSecondsOf`、`flipCos` / `flipSin` / `flipPerspective` / `turnParams` 四个材质参数、以及「抬起期间提到同层末位」的 `raise`/`reindex`（`siblingIndex` 不再被动画碰）；
  - 着色器：顶点层 3D 旋转 + 透视除法、片元层体积明暗（`vDepth` / `vTurn`）、侧视淡出（`turnParams.x` / `vCos`）、正面开口补光（`glowStrength` / `vLocalY` / `rim`）。
  - 🔴 这些删除都是**逐像素等价**的：碎裂全程 `tileFlip(cos) = 1`、`tileLift = 0` ⇒ 旋转角 0（透视因子 `q ≡ 1`）、`abs(sin) = 0`（`mix(1, shade, 0) ≡ 1`）、补光强度恒 0、`smoothstep(0, t, |cos|) ≡ 1`。**别只把曲线补回来** —— 着色器那几段已经不在了，翻整圈会退化成纯压扁；要回看走版本历史（SVN）。
- **旧地皮由 `TerritoryMapView.syncFlip` 显式传入**（`{ from: art.tileLocked, to: art.tileCleared }`）：点击那一帧 `paintHexes`（同一次 `renderMap` 里**先**跑）已按新进度把地皮换成草地，不传旧的就等于「从新地皮开始碎」，读不出「翻开」这件事。
  - ⚠️ 换脸点必须**每帧重写**：`paintHexes` 是幂等全量重绘、随时可能把 `spriteFrame` 直接写成新地皮，动画中途被顶掉就是「碎到一半突然换地皮」。每帧比一次引用即可自愈。
  - ⚠️ `settle()` 必须落回**新地皮**：动画被 `reset()`（换章 / 重建格节点）打断时，不收口会永远停在泥巴块。
- **`Reveal` 子节点**（`TerritoryMapView.createHex` 挂，`sizeMode = RAW`，默认收起）：**不动格根** —— 格根缩放归对局的缩没段，动它会把格面框 / 底光 / 建筑一起放大。池化复用前必须把倍率还原成 `1`（`hideReveal`）。
- **底光（`GroundGlow` 序列帧）恒灭**：那道光画的是「地块抬起来后露出的原格开口」，而碎裂**不抬起**（`tileLift ≡ 0`）⇒ `hexFlipGroundGlowStrength` 恒 `0`。保留通道是因为它与对局共用同一份 core 推导；**别为了让底光出现去伪造抬升量**（那等于把「原地」破坏掉）。
- **着色器 `shaders/hex-flip.effect`**：uniform 只剩 `flipCenter` / `flipHalfHeight` / `flipHalfWidth` / `flashParams` / `shatterParams` / `shardGrid`；碎裂整段挂在 `shatterParams.x > 0.5` 上（为 `0` 时**逐像素等价于「没有碎裂」**，起手那几帧与静止态都走这条）。碎块划分用**格内归一化坐标 `vQuad`**（世界坐标 ÷ 实际半尺寸），**不能用 `a_texCoord`**（SpriteFrame 可能裁剪 / 进图集）。裂缝亮线必须**乘完遮罩之后**再加（它就长在遮罩边缘上，先加会被自己那圈 `shardMask < 1` 抹掉）。顶点**不做任何形变**（只换算 `vQuad`）。
  - ⚠️ 顶点 / 片元两段的 `uniform HexFlip` 块必须**逐字一致**（成员与顺序）—— 不一致不会报错，只会静默错读。用例直接对账两份成员表。
  - 半尺寸由**格子实际 `UITransform` 尺寸 × 世界缩放**派生（帧到位后是 126×117，与设计常量 130×119 差一圈），取不到才退回整图常量。
- **时长归属**：`HEX_FLIP_SECONDS`（0.384s）**只属于对局**（`ZCBattlePresentationQueue.ZC_HEX_FLIP_SECONDS`）；领地**不定义自己的时长常量**，直接按 core 的 `HEX_SHATTER_SECONDS` 计时（禁止再造 `TERRITORY_HEX_FLIP_MAX_SECONDS` 这类别名 / 第二份字面量——时长只存在 core 一份）。
- **判据**：`tests/territory-hex-flip.test.ts`（19 条：碎裂的「原地」三恒定、碎裂与放大单调 + 过冲幅度、白闪窗口、底光两个帧序分支、接线守卫，以及**删除守卫** —— 方案1 的符号 / uniform / 着色器四段与 `raise`/`reindex` 一律不许残留）。

### 3.4 建筑生成抖动 + 建筑展示滞后到地块翻转结束（2026-10-16 row14）

需求原文：「冒险 / **建筑生成增加类似战斗系统的建筑抖动效果** / **建筑展示的时间需要滞后，等待地块反转结束**」。

#### 一、抖动曲线只有一处真源：`core/hex/ShakePresentation.ts`

这条「先 Y 后 X」两段脉冲原本只长在 `app/zcds/view/ZCGameViewUtil.ts` 里；领地的建筑也要播同一条，而 **`app/territory` 与 `app/zcds` 之间没有任何依赖**（领地是独立页面，不该反向吃对局的视图层）⇒ 与 `HexFlipPresentation` 一样落到 `core/hex`。

| 符号 | 值 / 含义 |
| :--- | :--- |
| `SPAWN_SHAKE_STRETCH` | `0.1` —— **单位**自己出生那一下（110%） |
| `BUILDING_SHAKE_STRETCH` | `0.2` —— **建筑**生成（120%，需求原文「建筑模型放大比例改成 120%」） |
| `SPAWN_SHAKE_PHASE_SECONDS` | `0.12` —— 单段（Y 或 X）时长 |
| `SPAWN_SHAKE_TOTAL_SECONDS` | `0.24` = 两段之和 |
| `spawnShakePulse(t, stretch)` | `1 + stretch · sin(π t)`，`t` 钳到 `[0,1]`（出手 / 收手零斜率，无尖点） |
| `spawnShakeScaleY/X(elapsed, stretch)` | 前段拉 Y（X 恒 1）、后段拉 X（Y 已回落）；段外恒 1 |

- `ZCGameViewUtil` **只做转发**（`export { … } from '../../../core/hex/ShakePresentation'`），对局侧既有的 `from './ZCGameViewUtil'` 写法与数值全部不变 —— 但**真源只剩 core 那一处**，判据直接对账两份导出逐个相等。
- 两边都是把因子**乘进各自的基准缩放**（对局 `0.72`、领地 `BUILDING_VISIBLE_WIDTH / 可见宽`），不是覆盖 ⇒ 「抖完建筑尺寸变了」这种漂移不会发生。
- 推进方式两边不同：对局由渲染世界每帧调 `advanceBuildingShake(now)`（对局静态渲染是 0.15s 节流，播不出 0.24s 的抖动）；领地的站点视图本来就是每帧的，由自己的 `update(dt)` 推进（没在抖时只做一次数值比较，百来个站点的开销可以忽略）。

#### 二、建筑展示滞后到翻转结束：`ITerritoryStationRender.hidden`

随机资源格翻开的那一帧，进度上已经是「已开启」，但地皮正在翻 ⇒ 建筑必须等翻转播完才出现。

- `TerritoryMapView.syncFlip` 在 `hexFlip.play(...)` **返回 true** 时才把 cellId 记进 `pendingBuildingReveal` —— 没注入 effect（`play` 返回 `false`）**不会**登记，建筑照旧立刻出现，不会变成「格子不动、建筑也不出来」。
- `syncStations` 对在待办里的格子改用 `{ ...content, hidden: true }` 渲染，并把**这一份 content** 存进 `pendingBuildingRender`（解除待办发生在 `update`，那时算不出 content）。
- `update(dt)` 里 `hexFlip.step(dt)` 之后立刻 `resolveBuildingReveal()`：这一格的 `isPlaying` 已经变 false ⇒ **同一帧**用存下的 content 重画一次（不带 `hidden`）并 `view.playBuildingShake()`。
- 换章 / 重建格子（`syncGrid` 的换图分支）必须 `clear()` 两张表，否则新图上同名格会永远等一个不会播完的翻转。
- 🔴 **`renderMap` 里 `syncFlip` 必须排在 `syncStations` 之前**：排后面的话站点会先按「已开启」画一帧，表现为建筑**闪一下就消失**（下一帧才被隐藏、要等 0.7s 再长出来）。

为什么不能靠 `icon: null` 实现隐藏 —— `TerritoryStationView.render` 里 `hasBuilding = !isCondition && content.icon !== null`，`icon` 一为空，名称底条 / 名称 / 角标三者的 `active` **全部变 true**（反而多出一条底条）。所以走独立的 `hidden` 闸：只关**四个视觉节点**的 `active`，并且 `button.interactable` 一并关掉。

⚠️ 也不能关 `this.node.active`：四个视觉节点在 `initialize` 里已被 reparent 到**共享 layer**（`StationIconLayer` 等），站点根节点上只剩命中区 —— 关根节点只关掉点击，视觉照旧留在屏幕上。

#### 三、判据

`tests/territory-building-shake.test.ts`（8 条）：core 零依赖 + 对局侧转发逐项相等 + 领地不出现 `zcds`；120% 与「先 Y 后 X」、段外恒 1；抖动**乘**在归一化基准缩放上、播完复位、`dispose` 停表；`hidden` 只关四个视觉节点（并反向钉「关根节点没用」）；翻开登记待办 → 翻转期间 `hidden` → 播完同一帧补建筑并抖一次；没翻格不登记；换章清空；`renderMap` / `update` 的顺序守卫。

### 3.5 领地「获得银币 / 体力」：格心喷发（抛物线倒锥 + 自身上下翻面）+ 读数在其上方 40px（row17，喷发口径 2026-10-17 细化）

需求原文（2026-10-16）：「获得银币或者体力时，播放**喷发**的效果，喷发**多个图标**，多个图片的喷发范围限制在一个**倒圆锥**的图形，喷发的坐标点对应**点击地块的中心点坐标**，图标和数字 ui 增加上移的动画放在例子效果坐标点的**上方间隔 40px**」。

2026-10-17 用户把喷发单独细化成一整套物理口径（12 颗 / 错峰 0.025s / ±26° / 初速 650±12% / 重力 1500 / 抛物线 / icon 自身上下翻面 / 落回台面 0.12s 淡出且不穿模），**喷发段已按新口径重写**，读数那条 1.15s 时间线一行没动。

#### 一、一句话分工：喷发一半，读一半

| 需求里的句子 | 落点 |
| :--- | :--- |
| 「喷发多个图标」 | `TERRITORY_GAIN_BURST_COUNT = 12` 颗粒子（**每颗都是一个资源图标**，不是一颗带动画的图） |
| 「限制在倒圆锥」 | `TERRITORY_GAIN_BURST_HALF_ANGLE_DEG = 26` —— **出射方向**与屏幕竖直轴夹角的上限 |
| 「喷发坐标点 = 点击地块的中心点」 | `TerritoryMapView.playResourceGain`：`originY = hex.position.y + HEX_GRID_CONTENT_LIFT` |
| 「图标和数字 ui … 上方间隔 40px」 | `baseY = originY + TERRITORY_GAIN_START_LIFT_PX`（该常量就是 `40`），仍由 `TerritoryResourceGainView` 升起 1.15s |
| 「icon 自身持续上下翻转」 | `territoryBurstParticle` 的 `scaleX / scaleY`（见第三节），视图只写 `setScale(scaleX, scaleY, 1)` |
| 「落回地块表面即淡出、不穿模」 | 抛物线落点 + `SURFACE_FADE_SECONDS = 0.12` + 位置冻在落点 |

🔴 **两处都必须加 `HEX_GRID_CONTENT_LIFT`（12.5），而且只加一次**：`hex.position` 是**蜂窝几何的布局点**，人眼看到的台面中心才在它上面 12.5px（`cellCenter()` 同一个口径）。读数的起点因此是「格心 + 40」，**不是**「格心 + 30」也不再是「布局点 + 70」—— 判据里有一条反向守卫钉死这个加法结构。

#### 二、倒锥约束的是**出射方向**，不是「任意时刻 |x| ≤ y·tan」

初版是「径向直线 + `easeOutCubic`」，所以 `|offsetX| / offsetY = |tan θ|` 全程成立。改成抛物线后**这条式子不再成立**：位置角从出射角开始一路变大，到顶点时 `x / y` 趋于无穷。真正的不变量只有出射速度方向：

```
phi = random(-1, 1) · 半顶角
vx  = speed · sin(phi)        vy = speed · cos(phi)
|vx| / vy = |tan phi| ≤ tan(26°)        ← 出射那一刻成立，之后不再约束
```

抛物线的实际边界（判据用的就是这个）：
- 顶点 `t = vy / g`，高度 `apex = vy² / 2g`（≈ 88~177px，取决于是 `-12%` 还是 `+12%` 的初速）；
- 落回台面 `t = 2vy/g`，此时 `|x| = |vx| · 2vy/g ≤ 2·tan(半顶角)·vy²/g = 4·tan(半顶角)·apex`。

| 符号（`model/TerritoryResourceGain`） | 值 / 含义 |
| :--- | :--- |
| `TERRITORY_GAIN_BURST_COUNT` | `12` —— 一喷几颗 |
| `TERRITORY_GAIN_BURST_HALF_ANGLE_DEG` | `26` —— 半顶角（判据的斜率就从它算 `tan`，测试里**不许另抄角度**） |
| `TERRITORY_GAIN_BURST_SPEED` / `_SPEED_JITTER` | `650` / `0.12` —— 初速与 ±12% 随机量 |
| `TERRITORY_GAIN_BURST_GRAVITY` | `1500` —— 重力（抛物线靠它把粒子拉回来） |
| `TERRITORY_GAIN_BURST_STAGGER_SECONDS` | `0.025` —— 相邻两颗的出发间隔；12 颗铺开 0.275s ⇒ **绝不与首颗同帧** |
| `TERRITORY_GAIN_BURST_LIFE_SECONDS` / `_LIFE_JITTER` | `1.1` / `0.15` —— 单颗存活时长 ±15% |
| `TERRITORY_GAIN_BURST_FADE_SECONDS` | `0.25` —— **生命先到期**时的末段淡出 |
| `TERRITORY_GAIN_BURST_SURFACE_FADE_SECONDS` | `0.12` —— **落回台面**后的快速淡出 |
| `TERRITORY_GAIN_BURST_BASE_SCALE` / `_SCALE_JITTER` | `1` / `0.2` ⇒ 基础缩放 0.8~1.2 |
| `TERRITORY_GAIN_BURST_FLIP_MIN_HZ` / `_MAX_HZ` | `2` / `4` —— 翻面频率区间 |
| `TERRITORY_GAIN_BURST_TOTAL_SECONDS` | `1.54` = 最后一颗的出发时刻 + **最长**生命。⚠️ 只是**硬上限**，视图真正的收尾判据是「一颗活的都没有」（实际 ≈1.2s） |
| `territoryBurstLaunch(seed, index)` | 纯函数：出射参数 `{ phi, speed, vx, vy, baseScale, flipHz, phase, life }`，同一 `(seed, index)` 恒等 |
| `territoryBurstParticle(seed, index, elapsed)` | 纯函数（零 `cc`）：`null` = 这颗**还没出发**或**已经消失**；`index` 不在 `[0, COUNT)` 整数值、`elapsed` 非有限/为负 ⇒ `null` |

🔴 **轨迹用解析式 `y = vy·t − ½g t²`，不要写成逐帧累加**：两者数学上等价，但累加会让落点随帧率变（30fps 两帧 ≠ 60fps 四帧），违反「动画一律 记录 startedAt + 纯函数算进度」这条全局约束。

⚠️ 抖动**不用 `Math.random()`**：同一 `(seed, index)` 必须给出同一组参数，否则倒锥判据没法验、池化复用的问题也没法复现。「每次点击不一样」由 `TerritoryMapView.burstSeed`（每次点击自增）提供。

#### 三、icon 自身上下翻面（「垂直反转」的实现）

需求原话：视觉循环是 **正面 → 侧立（最窄）→ 倒面 → 侧立 → 正面**，每帧令 `scaleY = baseScale · cos(ωt + phase)`、`scaleX` 始终 `baseScale`。

```
scaleX = baseScale
scaleY = baseScale · cos(2π · flipHz · t + phase)      flipHz ∈ [2, 4]，phase ∈ [0, 2π) 每颗独立
```

- 余弦**过零即侧立最窄**的中间态 ⇒ 不需要额外画「侧面」帧；负值即「倒面」。
- 🔴 **禁止在正负缩放之间硬切**（会跳变）—— 余弦天然连续，判据里按 1/60s 采样验「相邻帧 `ΔscaleY` 不超过 `0.75·baseScale`」。
- 🔴 `scaleX` **不许跟着压**：翻面只压 `y`。写成 `setScale(s, s·cos, 1)` 而不是 `setScale(s·cos, s·cos, 1)`，否则读成「整体缩小」。
- 🔴 **不做平面自转**（不叠加 `angle`）：与翻面同帧叠加会读成「一边翻一边歪」。
- 12 颗的 `flipHz` 与 `phase` 都两两不同（各取一次哈希）⇒ 不会同步翻。

#### 四、怎么收：先到的那条说了算

| 条件 | 触发时刻 | 淡出窗口 | 位置 |
| :--- | :--- | :--- | :--- |
| 落回台面 | `2vy/g`（≈0.69~0.97s） | `0.12s` | **冻在落点**（`offsetY` 恒 0、横向也不再滑） |
| 生命到期 | `life`（1.1s ±15%） | 末段 `0.25s` | 落点 / 空中 |

- 两条取**先到的**。实测只有 **0.3%** 的样本是「生命先到期」（要初速贴近 +12% 上限**且**生命贴近 −15% 下限），绝大多数都是落回台面。
- 落地后位置**冻住**而不是只夹 `y`：只夹 `y` 会读成「图标贴着地皮横滑一段」。
- 收尾前的最后一帧必须几乎全透明（`opacity < 0.02`）⇒ 回收时是「淡没」不是「跳没」。

#### 五、粒子组：纯类、逐帧、无 prefab

`view/TerritoryGainBurst.ts`（**不是** `Component`，与 `TerritoryHexFlip` 同一套路）：

- 一次喷发 = **一个原点容器** + 12 颗粒子；容器摆在喷发原点，粒子的位移直接写成容器的局部坐标 ⇒ 「相对原点」只在一个地方表达。
- 每颗粒子**各自**挂一个 `UIOpacity`（错峰 + 各自淡出决定了它们不能共用根上那一个），`Sprite` 用 `sizeMode = CUSTOM` + `trim = false`，尺寸 `TERRITORY_GAIN_BURST_ICON_SIZE = 64`（需求默认值；觉得 12×64 太满只改这一个数，喷发曲线不受影响）。
- 图标按 `entries` **轮流取**（同时给银币 + 体力 ⇒ 两种图各喷一半）；`frames` 为空（图没加载出来）只是那几颗是空的，**不是**把整喷关掉 —— 与飘字「缺图仍照常升」同一口径。
- 逐帧 `step(dt)` 由 `TerritoryMapView.update` 推进，**禁用 tween**（池化复用的节点上挂 tween 会在回收后继续跑，规则 106 / 247）。`stop()` 把容器**和每颗粒子**一起复位（只收容器会留下上一喷的残影）。
- `step` 的收尾判据是 `apply()` 返回「还有没有活着的粒子」，`TOTAL_SECONDS` 只作硬上限兜底 —— 死等上限会让容器白挂 0.3s 空帧。
- 🔴 **粒子层必须是 `GainLayer` 的第一个子节点**（`TerritoryMapView.ensureBurstRoot` 里 `setSiblingIndex(0)`）：子节点顺序 = 渲染顺序，飘字节点是后建的，排在后面 ⇒ 粒子画在「+N 读数」**之下**；这条顺序只在建层那一刻定一次，之后两个池都不再动兄弟序。
- **为什么不建 prefab**：一粒粒子只有「一张可换的图 + 位置 / 两个缩放 / 透明度」，没有任何图集布局参数，而图本来就要由页面注入（飘字 prefab 里「帧由代码注入，prefab 里不许写死」的同一理由）⇒ 建 prefab 等于把同一张图的占位写十二遍。

#### 六、判据

`tests/territory-resource-gain.test.ts`（26 条，其中喷发占 15 条）：
- 出射：12 颗 / 0.025s 错峰 / 绝不与首颗同帧 / 总时长 = 出发时刻 + 最长生命；
- 倒锥：`|phi| ≤ 半顶角`、`vx = speed·sinφ`、`vy = speed·cosφ`、`|vx|/vy ≤ tan26°`、初速 ±12%、左右都铺开且**200 次喷发整体无水平偏向**；
- 抛物线：上升段单调、不穿模（`y ≥ 0`）、峰值 ≈ `vy²/2g`、横向不越过 `2·tan·vy²/g`；
- 翻面：`scaleX` 恒等、`scaleY` 逐位等于余弦式、`|scaleY| ≤ baseScale`、相邻帧无硬切、正面/倒面/侧立三态都出现、12 颗频率与初相两两不同；
- 收尾：落台面 0.12s（位置冻在落点）与生命末段 0.25s 两条分支各自命中、收尾帧几乎全透明；
- 确定性、脏输入全 `null`；粒子组沙箱（真代码 + `cc` 打桩）验容器落在原点、粒子数 = 常量、逐帧节点值逐位等于模型、错峰可见、放完提前收起、复用能重新点亮；接线守卫（`originY` / `baseY` 的加法结构、喷发只喷一次且排在飘字之前、`setSiblingIndex(0)`、`stepBursts`）、以及「粒子组不许 instantiate prefab / 不许出现 tween」。

## 4. 其他玩家席位的视觉区分：顶点色相乘灰
- **统一判据**：`owner !== 'player'`（与领地染色、城墙敌我同口径）。
- **实现方式**：在 `ZCUnitView.applyVisualTint` 中通过 `Sprite.color` / `Skeleton.color` 顶点色相乘叠 `#828282`（`OTHER_PLAYER_TINT = 0x82`），保留美术明暗体积，不额外建节点。
- **状态枚举与优先级**：使用枚举 `TINT_WHITE / TINT_OTHER_PLAYER / TINT_DEAD`，优先级为 **阵亡（alpha 190） > 其他玩家（`#828282`） > 原色**。
- **双分支强制**：必须写 `if (sprite) ... else if (skeleton) ...`，确保序列帧与 Spine 单位均生效。
- **判据**：`tests/zcds-unit-view-render.test.ts`。

### 4.1 敌我标识：阵营色 + 描边 + 四色血条（R25「【战斗】敌我标识」）

需求两条：①「根据不同得阵营，叠加对应的颜色和描边」②「不同阵营区分不同的血条」。

① 早已闭环，本轮只做核对（口径分散在三处，别以为要新加一套）：

| 载体 | 入口 | 说明 |
| --- | --- | --- |
| 领地填充 | `ZCHexView` 的 `zcFactionColor(owner)` | 60% 透明；结算铺场用 `zcDeepFactionColor` |
| 领地轮廓 | `ZCOutlineLayer` 的 `zcFactionColor(owner)` | **整盘共享一层绘制**（不是每格一个 `Graphics`），100% 不透明 |
| 单位外轮廓 | `ZCUnitView.renderOutline` → `OWNER_EDGE_COLOR[owner]` | 只给「非我方且未阵亡」的单位；颜色读共享主题 `ZC_CLIENT_COLORS.*Edge`，不复制值 |

② 是本轮的实际改动。原先 `pickHealthBarFill` 只接三张图，`enemy3` 与 `enemy` **共用红色**（蓝湖「多队伍」稿只出了三队配色），四家同场时两条红条分不清谁是谁。

- `ZCGameViewUtil.pickHealthBarFill(owner, player, enemy, enemy2, enemy3)` 改成**五参**，穷举 `switch`；`default` 只兜 `neutral`（没有阵营色概念，按敌方红）。
- `ZCUnitView`（单位）与 `ZCHexView`（建筑 / 城墙）各加一个 `@property barFillEnemy3`，prefab 同步绑定。
- 紫图取**项目里已有但一直没人用**的 `resources/image/buildings/jindutiao_p.png`（实测 `#8b5af5`，与 `ZC_CLIENT_COLORS.enemy3Edge` 的 `#bd49fb` 同色相系）⇒ **不需要新美术、不需要重出图集**。
  该图 20×10、九宫格 `3/7`，与 gameui 那三张（30×8、`4/4`）源尺寸不同，但血条节点是 `SLICED` + `CUSTOM` 画在 68×8（`barFillHeight = 8`），实际观感一致。
- ⚠️ 另有一整套**四色且尺寸统一**的 `resources/image/buildings/jindutiao_{b,r,y,p}.png`（均 20×10）**全部未被引用**。本轮**刻意不用**它们替换现有三张：那会改掉已验收的我方 / 敌方 / 敌2 观感。

判据：`tests/zcds-progress.test.ts` 的「血条使用 ProgressBar，裁切非法比例并按阵营换填充图」——四家映射两两不同 + `neutral` 兜底 + `Set(size) === 4`。

## 5. 自选主城（选择基地模式）：World 层表现 + 跟随基地的确认按钮

沿用既有 `cityMode: 'select'` 的 `ZCSpawnSelection` + `ZCSpawnSelectionView`，仅在 World 层挂载表现，**严禁新建第二套选点状态机或第二颗确认按钮 Prefab**：

1. **预置玩家默认落点（零随机源消耗）**：构造期 `ZCSpawnSelection.defaultHexFor('player')` 优先取 `map.homes[0]`，不合法则退回 `legalHexes()[0]`；**只预置玩家、不预置 AI，且严禁消耗随机源**（构造期随机源消耗次数恒等于 `owners.length - 1`）。
2. **基地相邻 6 格深蓝高亮**：取 `selection.baseNeighborIds('player')`（仅我方），由 `ZCHexView` 渲染 `SPAWN_BASE_NEIGHBOR_FILL`（`#1D24C8`，alpha 170），**优先级：基地邻格高亮 > 受阻红 > 半区/中立色**。
3. **借用 HUD 绿勾按钮改挂世界层 `mapLayer`**：
   - 由 `ZCGame.borrowSpawnConfirmButton()` 借出 `ZCSpawnSelection.prefab/ConfirmSpawn`（`btn_gou.png`）改挂 `hudView.mapLayer`，由 `renderSpawnConfirmButton` 逐帧写坐标至**基地中心正下方 2 个行距**（`SPAWN_BASE_CONFIRM_ROW_OFFSET(2) × HEX_GRID_VIEW_ROW_SPACING(90) = 180px`，严禁乘列距 92.25）。
   - **借还三铁律**：① 借出时必须关掉其自带的 `cc.Widget`；② 在 `spawnSelectionView.node.destroy()` **之前**必须调 `restoreSpawnConfirmButton()` 归还父级、兄弟序、坐标与 Widget（并把世界层引用置 `null`）；③ 若 `shutdown` 时原父级已失效则直接销毁。
4. **显隐判据用 `isPlacing('player')`**：我方点击确认后高亮与按钮立即收起，严禁用 `snapshot.finished`（否则等待 AI 确认期间仍会多亮几秒）。
5. **顶栏三行式（2026-10-17 按线框图重排）**：`SpawnInfoBand`（663×130）内自上而下 = **倒计时数字 48 号（加粗）`y=+35`（第一行、水平居中）→ 标题 25 号 `y=-9`（第二行）→ 进度条 200×23 `y=-46`（第三行）**；等待态收掉数字与进度条，标题回到 `y=0` 居中（`SPAWN_HINT_PICKING_Y / SPAWN_HINT_CENTER_Y`）。
   两个必踩的坑：
   - 🔴 **「字比数大」**：汉字满字高 ≈ 0.95em，阿拉伯数字只有大写高 ≈ 0.72em（无降部）。所以「数字 30 号 + 标题 28 号」实际是**标题看着更大**（视觉高 21.6 : 26.6），这也是调整前截图里「7 比标题还小」的根因。配字号必须按**视觉高度**算：48 : 25 ⇒ 34.6 : 23.8 ≈ 0.69（48 : 30 那版是 0.82）。
   - 🔴 **`SHRINK` 静默缩字**：Label 是 `overflow=SHRINK`，框小就把字号压回去而不报错。旧标题框 221 装不下 8 字 × 28 号，`prefab` 里 `_actualFontSize: 22` 就是被压过的证据 —— **换字号必须同时放宽框**（现 300×38，框高还要 ≥ `lineHeight`）。
   - 进度条几何：先按需求**长度 −35%、高度 −5%**（398×32 → 259×30），再经用户两次手定 **230×23 → 200×23**（填充 194×16，四边留 2~6px）；视图只写 `fillRange`，几何一律在 prefab。
- **判据**：`tests/zcds-spawn-base-confirm.test.ts`（12 条）、`tests/zcds-spawn-selection-view.test.ts`（12 条，含三行式排版与光学字号判据）。

## 6. 战斗飘字「快进慢出」：前 45% 入场，后 55% 淡出

⚠️ 这一节讲的是**伤害 / 治疗 / 暴击…**那一类飘字。**金币是唯一的例外**（2026-10-23 两次改口径，
见 §6.3）：它既不「快进慢出」，也没有文字 —— 只剩一枚硬币掉到角色中心缩没。

总时长常量 `FLOAT_TEXT_DAMAGE_SECONDS = 0.85`（金币另有 `FLOAT_TEXT_GOLD_SECONDS = 0.62`），
由单旋钮 `entranceProgress = FLOAT_TEXT_ENTRANCE_PROGRESS = 0.45` 统一划分前后两段（三条纯函数均在 `ZCGameViewUtil.ts`）：

1. **前 45% 入场（`floatTextEntrance`）**：`progress / entranceProgress` 套 `easeOutCubic`，入场结束后恒为 `1`。**散落、下坠、摇摆、弹出缩放一律喂 `enter`（严禁喂整条 `progress`）**。
2. **后 55% 匀速淡出（`floatTextFade`）**：入场段恒为 `1`，之后在剩余 55% 时长内**线性**降到 `0`。
3. **后 55% 同向收尾漂移（`floatTextDrift`）**：入场段恒为 `0`，之后按 `easeOutQuad` 沿入场同向（伤害继续下沉）再漂移 `driftDistance = 7`（落在 `5~10px` 护栏内），消除静止调透明度的生硬感。
4. **Prefab 序列化同步**：修改 `entranceProgress (0.45)` 或 `driftDistance (7)` 必须同步更新 `ZCGameFloatText.prefab` 上的序列化值。
- **判据**：`tests/zcds-float-text-gold-icon.test.ts`、`tests/zcds-float-text-gold-drop.test.ts`、`tests/zcds-progress.test.ts`。

### 6.1 各阶段时间表（按 0.45 切分，伤害 `0.85s`）

| 阶段 | 伤害飘字（`0.85s`） | 该段里发生什么 |
| --- | --- | --- |
| ① 出现 | `0.000` | 弹出缩放 **1.25**、`alpha 255`；起点在头顶 `y=+55` |
| ② 入场段 | `0.000 → 0.3825` | `easeOutCubic` 走完位移 + 缩放 1.25→1 |
| ③ 淡出段 | `0.3825 → 0.8500` | `alpha` 线性 255→0；位置**只**再沿同向漂 7px（`easeOutQuad`） |
| ④ 回收 | `≥ 0.8500` | 模型侧 `now >= startedAt + durationSeconds` 即摘除（`ZCBattlePresentationQueue`） |
| 段长 | 入场 `0.3825` / 淡出 `0.4675` | 淡出恒为总时长的 55% |

关键节点实测（伤害，`row 0` / 中轨）：

| 时刻 | 进度 | 入场进度 `enter` | `alpha` | 缩放 | `y`（起点 +55） |
| --- | --- | --- | --- | --- | --- |
| `0.0000s` | 0% | 0.000 | 255 | 1.250 | +55.0 |
| `0.0850s` | 10% | **0.530** | 255 | 1.118 | +2.1 |
| `0.1700s` | 20% | 0.829 | 255 | 1.043 | −27.9 |
| `0.3825s` | 45% | 1.000 | 255 | 1.000 | −45.0 |
| `0.6162s` | 72.5% | 1.000 | 128 | 1.000 | −50.3 |
| `0.7650s` | 90% | 1.000 | 46 | 1.000 | −51.8 |
| `0.8500s` | 100% | 1.000 | 0 | 1.000 | −52.0 |

「快进」的量化证据：**10% 的时间（85ms）里已经走完 53% 的位移**、20% 时走完 83%，
剩下 55% 时长只挪 7px —— 所以读起来是「啪」地落到位再慢慢消失，而不是一路匀速飘。

### 6.2 文案：伤害不再带负号，前缀单独一条小字号 Label（2026-10-17）

| kind | 数值 Label | 前缀 Label（`Text/Prefix`） | 前缀字号 |
| --- | --- | --- | --- |
| `damage` | `25` | —— | —— |
| `critical` | `25` | `暴击` | 17（数字 34 的一半） |
| `restraint` | `25` | `克制` | 15（数字 30 的一半） |
| `resisted` | `25` | `抵抗` | 15 |
| `execute` | `25` | `秒杀` | 17 |
| `heal` | `+25` | —— | —— |
| `gold` | **（无文字）** | —— | —— |
| `miss` | `MISS` | —— | —— |

- **负号已删**（`-25` → `25`）：飘字本来就长在挨打的目标身上，负号只多占一个字宽。`+` 保留 —— 它标的是「加」这个语义。
- **金币连 `+` 和数字一起去掉了**（2026-10-23 用户：「移除金币的加号和数字 UI」）：`battleText` 对 `gold` 返回空串，
  `textLabel.enabled` 每帧置 `false`（**不是** `node.active = false` —— 金币图标是 `Text` 的子节点，关节点会把硬币一起关掉）。
- **前缀为什么要拆**：`cc.Label` 一条字符串只有**一个**字号，「克制」与「31」写在一句里就只能同号；需求「前缀约只有数字一半高」在单 Label 上无解（换 `RichText` 会连带改锚点与自适应宽度的行为，不值）。
- 前缀挂在 `Text` 之下 ⇒ 位置、弹出缩放、上下散落自动继承；水平位置按数字**实际宽度**反推（`-(数字宽/2 + 6 + 前缀宽/2)`，间距 6 是留了描边的余地）。前缀恒为 2 个汉字，宽度直接按「字数 × 字号」算（不读 `UITransform`，那条路有一帧延迟）。
- 字号真源 `ZCFloatTextView.PREFIX_FONT_RATIO = 0.5`：数字按 0.72em 的大写高、汉字按 0.95em 算，30 → 15 时视觉高度是 `21.6 : 14.25 ≈ 0.66`；要更贴「一半高」把它改成 `0.4`（30 → 12）即可，只此一处。

### 6.3 金币飘字：只有硬币，从角色中心上方落到中心点缩没（2026-10-23）

同一天两轮口径，最终形态：

| 项 | 口径 |
| --- | --- |
| 文字 | **没有**：加号、数字都不显示（`battleText('gold')` 返回空串 + `textLabel.enabled = false`） |
| 图标 | 唯一可见物：`GoldIcon` 挂在 `Text` 节点**原点**（`x = y = 0`），不再按文字宽度往左偏 |
| 落点 | **角色中心**：`goldCenterY = damageTargetSize / 2 = 49`（单位根节点是**逻辑脚点**，画布中心在它上方 ≈ 45.7~49px） |
| 起手 | 中心上方 `FLOAT_TEXT_GOLD_DROP_PX = 18`（即 `y = +67`），之后只往下走 |
| 时长 | `FLOAT_TEXT_GOLD_SECONDS = 0.62s`（比伤害 0.85s 更快，"迅速消失"） |
| 曲线 | `ZCGameViewUtil.floatTextGoldDrop`：掉落 30%（`k²` 加速）→ 停住 15% → 缩没 55%（`scale` 与 `fade` 同步 `1-k²`） |

- ⚠️ **不是** `offsetY`：那个值（26）只到小腿/腰，读起来是「金币掉在脚边」；2026-10-23 后 `offsetY` 已废弃（仅留 prefab 序列化兼容）。
- ⚠️ 建筑产出的金币也走这条路径（`grantGold` 传格心）⇒ `+49` 落在建筑中部，与「从建筑身上掉下来」的观感一致。
- **判据**：`tests/zcds-float-text-gold-drop.test.ts`（9 条）、`tests/zcds-float-text-gold-icon.test.ts`（7 条）、`tests/zcds-progress.test.ts` 的「飘字整链 / 慢出段漂移」两条。

## 7. 开局归属扩散波：归属格直接切换、中立格逐个替换

自选主城局选点结束进入战斗那一帧（`ZCGame.finishSpawnSelection`），纯表现层过渡（绝不回写模型）：

1. **执行顺序铁律**：必须**先调 `this.renderWorld.render(this.model)`**（让主城+6邻格共 14 个开局归属格一帧直接切到归属色），**再调 `this.renderWorld.startTerritoryClaimWave(this.model, selection)`**（把本半区中立可通行格压回选点半区色并启动扩散波，`selection` 必须传局部引用）。
2. **入波过滤条件（`buildClaimWavePlan`）**：仅收录 `ownerOf(hexId) === 'neutral' && sectionOwnerOf(hexId) === 主城方 && playable !== false` 的格子（`select_river` 实测两侧各 76 格共 152 格，14 个归属格绝不入波）。
3. **单一真源**：起点半区色唯一取自 `ZCSpawnSelection.regionOwnerOf`；终点战斗底色与地块底图、领地轮廓三处同源调用 `ZCGameViewUtil.territoryTintOwner(owner, canDevelop)`。
4. **时间表与幂次加速**：各主城独立做 BFS 环号分层 + 同环按极角 `atan2(dy, dx)`（值域 `(-π, π]`，`+π` 为最大角）升序排列；归一化名次 `r = rank / (total - 1)`，到达时刻 `= ZC_CLAIM_WAVE_SECONDS(1.0) × r^ZC_CLAIM_WAVE_ACCEL_POWER(0.65)`（相邻间隔单调递减，从 ~60ms 加速至 ~8.7ms），每格再做 `ZC_CLAIM_WAVE_FADE_SECONDS = 0.1s` 线性换色。
5. **绕过指纹闸门与收尾清理**：挂 `renderDynamic`；`ZCHexView.setClaimWave({ from, to, progress })` 绕过 `contentSignature` 直接写色，内部按 `written` Map 跳过未变进度；播完自动调 `clear()` 传入 `null` 并**清空 `this.contentKey = ''`** 强制下一帧常规重画；`ZCGame.destroy` 时也必须调 `clearTerritoryClaimWave()`。
- **判据**：`tests/zcds-territory-claim-wave.test.ts`（17 条）。

## 8. 点击脉冲：5 帧美术序列（2026-10-19 换美术，旧着色器整条退役）

- **这套是唯一实现**：`assets/resources/image/effects/hex_pulse_seq/hex_pulse_0..4.png`（320×320 透明底），
  由 `ZCGameLoader` 扫目录按名排序注入 → `ZCGameRenderWorld` → `ZCHexView.setHexPulseFrames`。
- 🔴 **落地的图被处理过（本体压到 35% 不透明度）**：美术原稿中心那块六边形是**实心不透明**的
  （画的是「地块本体」参考色 `#D9CDE2`），5 帧都带着它。直接盖到地块上会把整块地皮盖成淡紫、播完再弹回
  原色 —— 等于闪屏；但**彻底挖空**（alpha=0）又显得中间空得发虚（2026-10-19 先试过这一版）。
  最终口径：`tools/gen_hex_pulse_layer.py` 按第 0 帧量出的本体多边形（165×144 平顶六边形）**向心内缩
  `3px`**（留出帧 0 的贴边亮边），把这一区的 alpha **乘 `BODY_ALPHA = 0.35`**，外圈的波**原样不动**
  （它自带 70%→15% 的逐帧淡出）。⇒ 地块的阵营色 / 图标 / 价格透得出来，波又有个「发光的本体」托底。
  换图时**必须**重跑这个脚本（或在美术侧直接出「本体 35%」的图），否则会退化成「点击闪一下淡紫」。
- **美术自带曲线**（`六边形脉冲序列帧需求` §六）：帧 0 本体边缘 70% 白边 → 逐帧放大到 1.78 倍、淡到 15% →
  **直接消失**；5 帧每帧都有波、没有静止帧。所以视图侧**只换帧**：
  - 帧号由 `hexPulseFx(seconds).pulseFrame` 给（`0..4`，`-1 = HEX_PULSE_FRAME_HIDDEN` 退场）；
  - 节奏 `HEX_PULSE_FRAME_SECONDS = 0.1s`（10fps），一道波 `HEX_PULSE_WAVE_SECONDS = 0.5s`；
  - 严禁在节点上再写 scale / opacity 动画（图里已经有了，叠上去就是放大两次、虚化两次）。
- **对齐换算**：图上本体 `164×142` ↔ 格面 `123×90` ⇒ `HEX_PULSE_SCALE_X = 123/164`、`HEX_PULSE_SCALE_Y = 90/142`。
  节点 `contentSize` 按整张 `320×320` 给（波最大约 `292×253`）。`GroundGlow` 的 `_sizeMode = CUSTOM`，
  引擎不会自动改尺寸 ⇒ 这两件事都必须由 `applyPulseRipple` 写，离开段时由 `restorePulseLayer` 写回 `130×239`。
- **与段长的关系**：点击动画段仍是 `ZC_HEX_PULSE_SECONDS = 0.7s`（卡牌 / 首批兵 / 邻格按住窗都锚它），
  波只占前 `0.5s`；段尾 `0.2s` 波已退场，只剩缩没在收格子。
- **染色 = 卡牌品阶**（用户 2026-10-19）：`pulseTintForRarity(rarity)` —— `1` 绿 `#5AE28A`、
  `2` 蓝 `#4894FF`、`3` 紫 `#B26CFF`、`4` 金 `#FFC43C`，`0`（没抽到卡）/ 越界 / 非数字一律绿。
  品阶来自激活事件 `ZCHexActivation.cardRarity`（`ZCGameModel.developFor` 用 `ZC_RARITY_RANK[card.rarity]`
  填，没抽到卡填 0），由 `renderActivation` **每帧**写进 `pulseTint` —— 不能像旧版按 `state.tileType`
  在 0.15s 的 `render` 里缓存（品阶是「这一次开发」的结果，不是格子的静态属性）。
  ⚠️ 「抽到卡但建不上」（`!result.building`）仍有品阶、只是没有卡牌揭示（`hasCardReveal` 是另一件事）。
- **已退役**：旧 30 帧 `fkz_00..29`（155×144 灰度图）+ `shaders/hex-pulse.effect` 的径向虚化 / 保底乘抬亮，
  以及 `ZCHexView` 里的 `ensurePulseMaterial` / `applyPulseMaterial` / `applyPulseFade` / 每格克隆材质。
  文件和 effect **还留在盘上**做对照，但**代码不再加载**（`ZCGameLoader` 已删 `loadHexPulseMaterial`）。
  想回退先把 `HEX_FLIP_PULSE_ART_ROOT` 指回 `effects/hex_pulse` 并恢复那条材质链 —— 别只改一半。
- **判据**：`tests/zcds-hex-activation.test.ts`（`pulseFrame` 等宽推进 / 播完退场 / 对齐缩放恒定 / 旧材质链已删）。
  本体透明度属于美术产物，靠 `tools/gen_hex_pulse_layer.py` 写出的 `_preview_dark.png` / `_preview_tile.png` 肉眼验收。

## 9. 体验反馈专项（row8~row13）：结算扫场 / 描边同步 / 金矿提示 / 横幅扇入 / 产金抖动

### 9.1 row8 胜利结算三段式填充动画：深色铺场（带闪烁）→ 回正 → 线条脉冲（2026-10-16 最新口径）

1. **方向判据唯一看「赢家身份」（不看单格归属）**：
   - `winner === 'player'` ⇒ 层号 `step = maxRow - row`（**从下往上**）。
   - 其他玩家（`enemy` / `enemy2` / `enemy3`）⇒ 层号 `step = row - minRow`（**从上往下**）。
2. **三段式时序与重叠规则**：

| 阶段 | 起点与步长 | 行为与关键常量 |
| :--- | :--- | :--- |
| **① 深色铺场 + 闪烁** | `t = 0` 起，每 `ZC_VICTORY_SWEEP_STEP_SECONDS = 0.06s` 推进一行 | 填入 `zcDeepFactionColor(owner)` 深色，并叠加 `victorySweepShimmer` 三角波偏白闪烁 |
| **② 起始点回正** | 铺过 **`ZC_VICTORY_SWEEP_REVERT_LEAD_ROWS = 2` 个填充步**即起跑（与总行数无关；行数不足则 `Math.min` 兜底） | 小数游标 `victorySweepRevertCursor` 同速推进，屏幕上恒留 `LEAD_ROWS + 1 = 3` 行闭区间 `[cursor, litStep]` 深色带；由深色插值回阵营当前色（结束时刻用 `victorySweepRevertEndSeconds`） |
| **③ 共享轮廓线条脉冲** | ② 回正全部收手后立即起跑，速度 `PULSE_STEP_SECONDS = 0.035s/行` | 底色不再改动；在 `OutlineLayer` 上沿同方向扫过一道波带半宽 `PULSE_BAND_ROWS = 1`、对称三角形态的亮线（总结束时刻为 `victorySweepDuration`） |

3. **深色计算铁律（`zcDeepFactionColor`，`ZCTheme.ts`）**：
   - **全程纯 RGB，严禁走 HSV**（防中立灰丢色相及测试桩兼容）。
   - **顺序严禁写反：必须先推饱和 clamp 到 `[0, 255]`，最后再乘压暗系数 `ZC_DEEP_DARKEN = 0.9`**（2026-10-16 由 `0.78` 上调至 `0.9`；注意 `ZC_DEEP_DARKEN` 上界必须 `< 1`，否则深色退化为当前色）。
   - **五档标准深色值（供回归核对）**：
     - `player`: `#7e82ff → #6a70e6`
     - `enemy`: `#fb4969 → #e62b54`
     - `enemy2`: `#fbcc49 → #e6b80d`
     - `enemy3`: `#bd49fb → #c32be6`
     - `neutral`: `#c4dae5 → #aac6d5`
4. **铺场闪烁铁律（`victorySweepShimmer` + `zcTowardWhite`）**：
   - **用三角波不用正弦**：周期 `ZC_VICTORY_SWEEP_SHIMMER_CYCLE_SECONDS = 0.15s`、峰值 `SHIMMER_MAX = 0.5`、相邻行相位差 `1/3` 周期，整周期恒非负且 `elapsed = 0` 为 0。
   - **只偏深色那一端**：`sweepFill` 算 `lerp(zcTowardWhite(deep, shimmer), current, mix)` ⇒ `mix = 1`（回正完成）时闪烁自动归零，无需单独停闪逻辑。
   - **指纹量化与剔除**：`ZCHexView.setSweepOwner(owner, mix = 0, shimmer = 0)` 中 `mix` 按 **32 档**、`shimmer` 按 **16 档**量化进 `sweepKey`；**当 `mix >= 1` 时必须将 shimmer 剔出指纹**，避免已回正的格子每帧无故重绘。
5. **第 ③ 段线条脉冲三处同步守卫（`ZCVictorySweep.pulseLevelOf` → `appendHexPulseOutlineSegments`）**：
   - 脉冲强度量化为 `PULSE_LEVELS = 4` 档、最亮档往白偏 `PULSE_MAX_MIX = 0.55`、线宽 `PULSE_LINE_WIDTH = 7`；`victorySweepPulseMix` 起跑判据必须写 **`cursor >= 0`**（写 `> 0` 会漏掉起跑当帧）。
   - ⚠️ **修改脉冲参数时必须同步的三处**：
     1. `redrawSharedOutline` 的探针每格压入 **4 个数**（`id / 阵营 / mask / 脉冲档位`），且传参时必须**按档位预建 `Color` 实例复用**（严禁逐格 `new Color`，否则每格拆成一个 `Graphics` subModel 破坏合批）；
     2. `ZCOutlineLayer` 的 `MAX_BUCKETS` 设为 **16**（原为 12）；
     3. `tests/zcds-hex-neighbor-reveal-delay.test.ts` 中读取轮廓探针的步长固定为 **4**。
   - `ZCVictorySweep.advance` 的重画判据共 4 项：填充步号、回正游标、闪烁相位档位（`victorySweepShimmerTick`）、脉冲波前。
- **判据**：`tests/zcds-progress.test.ts`（含 3/4 号席位方向、铺过 2 步起跑、深色带宽度、闪烁曲线、只偏深色端、脉冲曲线与探针共 7 条，注意用例须用 `advanceTo` 按绝对时刻推进）与 `tests/zcds-outline-layer.test.ts`（脉冲六边全描 / 同档合批 / 坐标对齐）。

### 9.2 row9 地块描边与地块图标同帧展示

- `ZCHexView.resolveDevelopableHold` 设为 **public**，渲染世界 `renderHexSystem` 中的 `ownerForHex` 闭包在让 `canPlayerDevelop` 将共享轮廓染成玩家色**之前**，先调用 `resolveDevelopableHold` 检查该格是否仍在 `ZC_HEX_NEIGHBOR_HOLD_SECONDS` 按住窗内。
- 消除此前“轮廓立刻变蓝、图标和价格还要等 0.2s 才冒出来”的割裂感；该方法查表幂等，同一帧内轮廓与视图各自调用一次完全安全。
- **判据**：`tests/zcds-hex-neighbor-reveal-delay.test.ts`（★row9 用例）。

### 9.3 row10 开局金矿格的整圈描边闪烁

- **纯函数曲线 `ZCGameViewUtil.zcNeutralHintAlpha(elapsed)`**：
  - 窗口总长 `= ZC_NEUTRAL_HINT_CYCLE_SECONDS(1.1) × ZC_NEUTRAL_HINT_CYCLES(4) = 4.4s`；相位用 `cos` 保证 `elapsed = 0` 最亮，脉冲下限 `ZC_NEUTRAL_HINT_MIN_ALPHA = 0.35`。
  - 🔴 **末段包络必须乘 `(1 - u)²`（二次方），严禁线性**：线性包络在最后一周期脉冲上升段会把乘积重新提亮，变成“闪两下再灭”。
- **绘制落点与生命周期**：
  - 仅针对 `ZC_NEUTRAL_HINT_RESOURCE_ID = 'mine'` 的格子，画在**单格自带的 `TerritoryOutline`（`cc.Graphics`）**上（金黄色 `ZC_CLIENT_COLORS.gold`、线宽 7，顶点复用 `ZC_OUTLINE_HEX_POINTS` / `OWNED_OUTLINE_INSET_SCALE`，带 2% 死区与 `graphics.enabled` 闸门）。
  - `ZCGameRenderWorld.renderNeutralHint` 挂 `renderDynamic`，时间锚定 `visualTime`；窗口播完、金矿被领取/开发（`neutralResourceId` 清空）或本局无金矿时，置单向闩锁 `hintOutlineSettled = true` 并清空关闭 `Graphics`。
- **判据**：`tests/zcds-neutral-hint-outline.test.ts`。

### 9.4 row11 传说牌横幅 `ZCGameLegendBanner`：从左往右扇入 + Role 下落生成

- **统一方向**：一律从屏幕左侧外部（`-viewWidth / 2 - halfWidth`）往右扇入，已删除敌我分方向的 `isLeftSide`。
- **Role 节点生成时序（`legendRoleProgress(elapsed, slideSeconds)`）**：
  - 横幅扇入期间 Role 进度恒为 `0`（完全透明）；扇入完成后在 `LEGEND_ROLE_GENERATE_SECONDS = 0.7s` 内按**已用秒数**线性推进 `0 → 1`，下落与淡入共用缓动 `legendRoleEase = easeOutCubic`。
  - 🔴 **Y 轴 `LEGEND_ROLE_DROP_Y = 80 → 0` 是相对 Prefab 静止位的偏移**：Role 节点静止位 `roleRestY = -28.24` 在首次写入前惰性捕获，实际写入 `roleRestY + 80 * (1 - ease)`（写成绝对 0 会把角色永久抬高 28px）。
  - 透明度直接写 `roleSprite.color.a`（不挂 `UIOpacity`，且与 `renderContent` 互不冲突）。
- **判据**：`tests/zcds-legend-banner.test.ts`（★row11 采样用例）。

### 9.5 row12 + row13 建筑抖动扩展至产金，且建筑档拉伸量抬至 120%

1. **两档拉伸量分离**：
   - `SPAWN_SHAKE_STRETCH = 0.1`（110%）：仅供**单位自身出生**（`ZCUnitView.playSpawnShake`）使用，也是 `spawnShakePulse / ScaleX / ScaleY` 的默认参数。
   - `BUILDING_SHAKE_STRETCH = 0.2`（120%）：供**建筑抖动**（`ZCHexView.playBuildingShake`）使用，因子乘入唯一入口 `applyBuildingScale`（注：建筑生长曲线 `elasticPopScale` 的 `POP_PEAK_SCALE` 本就是 `1.2`，保持不变）。
2. **两个触发源与唯一挂点**：
   - **产兵触发（row5）**：`renderUnitEntity` 的 `isBirth` 分支检查 `unit.sourceHexId` 所在格 `building === 'barracks'` 时，直接调 `triggerBuildingShake(hexId, now)`（严禁用“是否有冷却环”作判据，否则主城/金矿也会误判为产兵）。
   - **产金触发（row12/row13）**：挂在 `economyContext.grantGold`（僅主城与金矿调用；**严禁挂私有的 `grantGold`**，否则击杀/拆建筑奖励也会让基地乱抖），当金额合法且 `> 0` 时向 `ZCBattlePresentationQueue` 推入 `ZCBuildingShake { id, hexId }`。
3. **取走即空队列（`drainBuildingShakes`）**：
   - 因 `playBuildingShake` 会重置起点（非幂等），队列**不参与按时间 `prune`**，而是由 `renderBuildingShakes`（挂 `renderDynamic`）每帧调 `takeBuildingShakes() / drainBuildingShakes()` **原子取走原数组并换新数组接手**（因此 `buildingShakeQueue` 不能标 `readonly`；空队列返回共享 `EMPTY_BUILDING_SHAKES`，上限 `BUILDING_SHAKE_CAP = 32`）。
- **判据**：`tests/zcds-building-spawn-shake.test.ts`（6 条）。

## 10. 战斗相机（R22「【战斗】相机」，2026-10-16）

需求原文（`v0.1战斗DEMO` 第 22 行）四条，分工与落点如下 —— **四条里只有第 1、3 条是这一轮新做的**：

| # | 需求 | 落地 | 备注 |
| :- | :--- | :--- | :--- |
| 1 | 局内战斗的支持地图缩放（每个地图配置对应的最大和最小倍率） | `ZCMapConfig.resolveZCMapZoom` → `ZC_MAP_ZOOM_MIN/MAX` → `ZCMatchConfig.map.zoom*` → `ZCGameHUDView.setMapZoomRange` | **新做**：地图 JSON 的 `zoomMin / zoomMax` |
| 2 | 开场动画：进入战场推镜头（展示全地图，推进放大到默认的相机高度） | `ZCGameHUDView.playMapIntro`（既有） | 收尾倍率改为 `mapSettleScale`（夹进本图区间），不再是硬编码的 `ZC_MAP_PRESENTATION_SCALE` |
| 3 | 镜头一键复位，回到初始点位，主城位于中心点下方100px | `ZCGameHUDView.resetCamera` / `mapRestCenterAtScale` + `leftPanel/ResetCameraBtn` | **新做**：`ZC_MAP_HOME_CENTER_OFFSET_Y = 100` |
| 4 | 结算拉高镜头看占据格子变化动画 | `ZCGameHUDView.startSettlementOverview`（既有，见 `docs/ZCGameHUD.md` §结算演出） | **不动**：全景 / 结算镜头是**脚本演出**，不受玩家缩放区间约束（地图把 `zoomMin` 配到 0.6 而"看清整盘"要 0.35 时，夹进去就看不到全图了） |

### 10.1 倍率区间的真源只有一份

- **地图 JSON** 的 `zoomMin` / `zoomMax` 是唯一真源；缺省 `0.6 / 1.2`（`ZC_MAP_ZOOM_MIN/MAX_DEFAULT`），
  硬边界 `0.3 ~ 1.5`（`ZC_MAP_ZOOM_HARD_MIN/MAX`）。
- `resolveZCMapZoom` 的口径：**越界 / 非数字 / 上下限颠倒一律抛错，不静默夹取**
  —— 夹取会让"地图配错了"这件事从表现上完全看不出来（只是手感怪一点）。
- HUD 侧**不写第二份默认值**（`mapZoomMin/Max` 初值就取 `ZC_MAP_ZOOM_*_DEFAULT`）；
  `ZCGame` 在 `createGame`（入口快照）与 `finishSpawnSelection`（选点后重解析的那一份）各注入一次。
- `ZCMatchConfig.map` 是这条链的最后一跳：**只加 `zoomMin/zoomMax` 两个键，随时要看有没有漏**。
- ⚠️ 地图编辑器 `tools/map-editor/app.js` 的 `buildJSON()` 是**白名单式重写**（`passthrough`）。
  加地图级字段**必须同时改「导入白名单」与「导出白名单」两处**，否则编辑器另存一次就静默丢字段。

### 10.2 缩放的两条输入路径，共用同一个 clamp

- **触摸端**：双指。`EventTouch.getAllTouches()` 取全部活动触点 —— 不能用 `getTouches()`：
  后者是"这一帧有变动的触点"，第一根按住不动、第二根刚落下时只报第二根，永远拿不到指间距。
  参照（指间距 + 倍率）在**落指那一刻**（`beginPinch`）就记好，所以第一帧 `move` 就能缩放。
- **桌面端**：滚轮（`Node.EventType.MOUSE_WHEEL`），每格 `× (1 ± ZC_MAP_ZOOM_WHEEL_STEP)`。
  没有这一支的话，编辑器预览里根本验证不了"每个地图自己的倍率区间"。
- 两条路都走 `applyMapZoom(scale, anchor?)`：`clampMapZoom` 夹取 + **锚点钉住**
  （`offset' = anchor - (anchor - offset)/scale · scale'`）+ `applyMapOffset` 收尾。
  不钉锚点的缩放会变成"缩放 + 平移"混合，手感是地图被推了一下。
- 锚点必须是**视口节点局部坐标**（`UITransform.convertToNodeSpaceAR`）：
  `getUILocation()` 给的是 UI 世界坐标（原点在设计分辨率左下角、窄长屏还带黑边偏移）。
- 双指期间**不算棋盘拖动**（落指即 `mapDragMoved = true`），否则松手会被当成点选地块。

### 10.3 「一键复位」= 秒回，不做补间

- `resetCamera()` 直接调 `resetMapPosition()`（与 `initialize` 开下一局**共用同一条路径**）
  ⇒ 复位后的构图与开局第一帧必然一致，不会出现"复位到一个只有复位才有的机位"。
- 刻意**不做 tween**：补间要多一个忙标记去和入场 / 结算镜头抢 `mapLayer`，收益只是 0.2s 的顺滑。
- `mapRestCenterAtScale` 里 `mapOffsetY = -focus.y · scale - ZC_MAP_HOME_CENTER_OFFSET_Y`：
  屏幕 y 轴**向上**为正 ⇒ 「主城在中心点下方 100px」就是让主城落在视口 `(0, -100)`。
  偏移量是**屏幕像素**、不乘倍率（否则越放大主城越往屏幕外跑）。
- 没给 `mapFocus`（自选主城图还没选点）时不加偏移，退回整盘中心。
- 复位同时清掉 `settlementOverviewRequested/Done`
  —— 否则复位完会把 `mapCameraBusy` 一直挂在"结算镜头在跑"上，棋盘直接拖不动。

### 10.4 视口 `UITransform` 只查一次

`mapOverviewScale` / `fitMapBackground` / `clampMapOffset` / 缩放锚点四处都要视口尺寸，
收敛成 `ZCGameHUDView.mapViewportTransform` **一个缓存 getter**（`initialize` 里清缓存）。
用例按「源码里 `mapViewport.getComponent` 只出现一次」钉死 —— 每多一个调用点，
就多一次"顺手判个空"的机会，判空会把 prefab 错误伪装成"镜头有点怪"。

### 10.5 判据

- `tests/zcds-map-declaration.test.ts`：`resolveZCMapZoom` 缺省 / 只配一半 / 越界 / 非数字 / 颠倒，
  以及 `configureZCMap` → 运行时绑定 → `captureZCMatchConfig` 快照三跳，外加地图目录逐张过一遍。
- `tests/zcds-hud.test.ts`：一键复位回到开局点位 + 主城在中心下方 100px、倍率区间夹取（滚轮与双指）、
  锚点钉住、双指不算点选、复位收掉结算镜头、缺省口径只有一份。
- `tests/zcds-hud-multiteam.test.ts`：`leftPanel` 五按钮几何（72×370、沿 y 等距 72、
  `ResetCameraBtn` 64×64 @ y-144 且 `_lscale = 0.7`）。
- `tests/zcds-rank-board-wiring.test.ts`：`ResetCameraBtn → onResetCameraClick → emit(ResetCamera)
  → ZCGame.onHudResetCamera → hudView.resetCamera()` 四环逐条。
