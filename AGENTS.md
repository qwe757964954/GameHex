# AI 开发约定（必读）

本仓库是 Cocos Creator 3.8 + TypeScript 游戏。开始改代码前，先读
[`docs/AI架构与代码规范.md`](docs/AI架构与代码规范.md)；本文件是其可执行摘要。

## 先做什么

1. 先确认需求所属的 feature、流程、数据来源与资源生命周期；不要只按文件名猜测。
2. 仓库有 `.codegraph/` 时，先用 `codegraph explore` 追踪符号、调用链和已有测试，再读代码。
3. 修改前检查工作区；不得覆盖、格式化或回退与任务无关的用户改动。
4. 先复用已有模式、类型、文本常量、资源加载器和测试夹具；避免平行实现。

## 架构硬约束

依赖只可从外向内：

```text
app/bootstrap（组合根）
  -> app/procedure、app/<feature>/application、app/<feature>/view
  -> core（端口、运行时契约、纯规则）
platform（Cocos/网络/配置/热更新适配器） -> core
framework（通用 UI/流程机制）            -> core
```

- `core/**` 必须是纯 TypeScript：禁止 import `cc`、`framework`、`app`、`platform`，禁止直接 I/O 和全局单例。
- `framework/**` 不得依赖任何具体 `app` feature 或 `Procedure*`。
- `platform/**` 只实现 `core` 端口；业务规则不放在 adapter 中。
- 页面只能通过 `GameRoute` 导航，不得 import 或直接切换具体 `Procedure*`。
- 正式流程的资源、配置、网络必须分别经 `AssetService`、`ConfigService`、`NetworkTransport`（或既有 repository/gateway）进入；禁止 feature 中直调 `resources.load`、`fetch`。
- 新玩法的规则进入 feature 的 `model/domain` 或 `core`；Cocos `Component` 只负责生命周期、输入和渲染编排。

## 实现硬约束

- 先定义输入、输出、错误/取消语义和不变量，再写实现。外部数据一律在边界归一化、校验。
- 异步操作必须能处理：节点/弹窗已关闭、流程预加载已取消、重复点击、请求失败。`PopupBase` 子类使用 `nextPopupFrame()`，并在 `await` 后检查 `isValid`；流程预加载检查 `context.cancelled`。
- UI `render` 必须是幂等的全量赋值：对象池/虚拟列表不得依赖上一次状态；资源先加载完再刷新同步列表。
- Cocos Inspector 必填引用用 `null!`，允许为空的引用明确写 `| null` 并在边界处理；不得用 `as any`、非空断言或静默 optional chaining 掩盖必填绑定错误。
- 禁止在 `update` 里加载资源、查全局配置、创建临时数组/节点，或混入业务规则；高频渲染按已有节流策略执行。
- 不引入新的全局可变状态或 static 暂存区。确需跨流程传值时，优先写入明确的 entry params / context；临时桥接必须单次消费、立刻清空并有测试。
- 工程的 Prefab搭建与修改使用cocos mcp、定位和验证。可以通过 MCP、脚本、文本编辑或任何自动化手段修改 `.prefab`、`.scene` , `.meta`通过mcp刷新资源，由引擎创建；需要调整节点、Inspector 属性、组件或引用时，给出精确步骤，由用户在 Cocos 编辑器手动完成。
- 对局棋盘的图层结构（水面 / 地块 / 轮廓 / 资源 / 城墙 / 装饰 / 建筑 / 状态条）**声明在 `ui/game/ZCGameBoard.prefab` 里**，
  **子节点顺序 = 渲染顺序**；渲染层只按名取引用，禁止再用 `new Node` 拼层、也禁止用 `siblingIndex` 现算层序
  （城墙砖层例外：它来自 `ZCGameWallLayer.prefab`，由 `initialize` 插到地块层之后）。
  层的 `layer` 必须都是 `UI_2D`；`destroy()` 不许拆 board/城墙层（归调用方）。
  口径与判据见 `docs/AI架构与代码规范.md` §7.3.3。
- **地块上的图标缩放由代码定，只改 prefab 的 `_lscale` 会被静默覆盖成 1**：地块类型图标
  （`icon_jk/by/wh/em`）与资源点图标**共用 `iconSprite` 一个节点**，缩放由 `ZCHexView.renderContent`
  唯一写入 —— 类型图标写 `TILE_ICON_SCALE = 0.8`，资源图标按 `resourceIconScale` 缩到格子边长。
  已建建筑同口径：`BUILDING_ICON_SCALE = 0.72` / `applyBuildingScale`。金币 `priceIcon` 与
  数字 `iconLabel` **不参与**这套缩放。口径与判据见 `docs/AI架构与代码规范.md` §7.3.3。
- **特效（出生光柱 / 受击 / 阵亡）的显示大小反过来由 prefab 根的 `_lscale` 定 —— 在代码里 `setScale` 才是静默失效**
  （与上一条**正好相反**，两条要一起看；「谁定」是按**资产的归属**分，不是按"特效还是图标"分）。
  🔴 `ZCEffectPool.playSpawnFx` 连 `setPosition` **都刻意不写**：`出生特效` 的 `_lpos = (0, −28.2)` 是美术
  把光柱重心从头顶压到胸口的调整，写 `setPosition(0,0,0)` 会覆盖掉它，症状是「改了 prefab 完全没效果」**且不报错**。
  `playDeathFx` 只写 `x/y`（来自模型快照；阵亡 prefab 的 `_lpos` 本就是 `(0,0,0)`），**不写 scale** ——
  写了会 ① 覆盖美术烘焙值、② 节点是**池化复用**的，每播一次乘一次 ⇒ 逐次缩水。
  · 出生特效 266×330 @ `0.4144` ⇒ 屏上 110.2×136.8；受击五组统一压到屏上宽 ~110px（**基准**）。
  · 🔴 **阵亡特效是唯一不守 110px 的特效**：2026-10-16 反馈「死亡特效节点，整体缩小成 0.8」⇒
  `0.2056 × 0.8 = 0.16448`（535×1092 ⇒ 屏上 **88×179.6**），故意比受击/出生小 20%
  —— 它是「脚下一团爆开」，等宽会跟单位本体抢视觉重心。**别顺手"统一口径"把它改回 110px**。
  改大小只动 prefab 的 `_lscale` 一个数（**不要重采样成显示尺寸**：保留原始像素零插值损失）。
  判据 `tests/zcds-hit-fx.test.ts`（同一条用例同时钉**倍数**与**屏上尺寸**，只钉算出来的小数的话基数坏了查不出）。
- **中立资源图标必须画在格子线之上**：地块整图 130×119、格距只有 92.25×90 ⇒ 相邻格整图互相重叠
  （后画的整格盖住先画的）；资源图标节点 128×128，比地块**顶面** 123×90 还大还宽，留在格节点里
  必然被邻格整图沿**格边线**切掉（症状：图标被一条直线齐刷刷切断、只剩半张）。
  `ZCHexView.setResourceIconRaised` 把它抬到 `ZCGameBoard.prefab` 的 `ResourceLayer`（唯一写 parent 的入口），
  坐标随之改成**棋盘层局部口径**，唯一写入口 `applyIconPosition`。地块类型图标**不抬**（字形只占节点中段，
  本来就落在顶面之内）。口径与判据见 `docs/AI架构与代码规范.md` §7.3.3。
- 地块类型图标落点 `ZCHexView.DEFAULT_TILE_ICON_POS` 与 `ZCGameHex.prefab` 的
  `BuildingLayer/BuildingIcon._lpos` **必须同值**（当前 `y = 4`：压在底部金币行上方；下界 1.4，再小就切到金币）。
  `BuildingLayer` 挂着 `cc.Widget`，运行时局部 y 是 **15.101**（早期注释里的 2.342 是过期值）。
- **地块激活表现：点击动画（脉冲 ∥ 缩没，0.7s）→ 卡牌弹出 → 卡牌淡出时建筑同拍由小变大**
  （`ZCHexView.hexActivationFx` 把 `ZC_HEX_ACTIVATION_SECONDS = 1.856s` **按秒切成两段**：
  ① **点击动画段** `ZC_CARD_START_SECONDS = 0.7`（**脉冲与缩没并发**，同起同收）
  + ② 卡牌段 `ZC_CARD_REVEAL_SECONDS = 1.156`；建筑**不单开一段**，它在卡牌淡出窗
  （最后 38% = 0.43928s）内长完）。
  🔴 2026-10-15 row13 需求「② 缩没段和 ① 脉冲段**同步播放**，点击动画即将结束时衔接卡牌段动画」⇒
  两段并发退休了原先串行的「脉冲 0.7 + 缩没 0.384」合段；用户同时把总长从 2.24 收到 **1.856**。
  **总长 = 点击动画 + 卡牌段**（口径已由「钉死总长、反推卡牌段」改成「**卡牌段固定 1.156、总长由它推**」——
  卡牌段不动 ⇒ 淡出窗与建筑生长时长的那层不变式跟总长解耦，改点击动画不会碰它）。
  换算卡牌进度一律用 `ZC_CARD_AXIS_RATIO`，别靠任何占比常数推。
  ① **点击动画段**（`seconds < ZC_CARD_START_SECONDS`，合成函数 `hexPulseShrinkFx`）：
  · **脉冲**（`hexPulseFx`）播**一道**美术水波纹（30 帧序列帧，`HEX_PULSE_CYCLE_SECONDS = 0.7s`，
  按地块类型染色），并让波纹层**向外扩散 + 外缘虚化**（2026-10-15 row16：「脉冲效果从缩小改成向外扩散
  消失，最大扩散 1.25 个单位格子大小，扩散的部分虚化」）—— 扩散是**波纹层节点**的缩放
  （`pulseScale` 1 → `HEX_PULSE_MAX_SCALE = 1.25`；视图先除以格根缩放，把它抵消成**绝对**的格子倍率），
  虚化是脉冲着色器的**径向遮罩**（`pulseFade` 0 → 1，视图每帧写进材质）；
  · **缩没**（`hexShrinkFx`，跨度 `ZC_HEX_SHRINK_SECONDS = ZC_HEX_PULSE_SECONDS`）整格**原地等比缩到
  `HEX_SHRINK_MIN_SCALE = 0.1`**（零位移、不压扁）。
  🔴 **只有缩没写格根 `tileScale`**（脉冲的 `tileScale` 恒 `1`，`HEX_PULSE_MIN_SCALE` 已随之删除）⇒
  `hexPulseShrinkFx` 就是「照抄脉冲那份、把格根缩放换成缩没的」，读起来是「波纹一边往外扩、格子一边被
  收掉，0.7s 末格子收干净」。🔴 判据是整段**格根 `tileScale` 单调不增** + **`pulseScale` / `pulseFade`
  单调增**（`tests/zcds-hex-activation.test.ts` 各有一条 `[0, 0.1, …, 0.999] × 段长` 的单调性循环）——
  脉冲一旦回退成「缩格根」、或哪天真被拆成串行，那两条立刻红。
  ⚠️ 波纹层（`GroundGlow`）是**格根的子节点** ⇒ 不抵消父缩放的话它只会跟着缩没一起缩（那正是 row16
  要改掉的「缩小」）；位置同理按 `ZC_LAND_TOP_CENTER_LIFT / 格根缩放` 反补，世界落点才恒钉在台面中心。
  ⚠️ 脉冲材质要**每格克隆一份**（`ZCHexView.ensurePulseMaterial`）：`pulseFade` 是每帧写的 uniform，
  共用一份时两格同时脉冲会互相盖掉；`onDestroy` 负责释放（`new Material()` 不归资源管理器管）。
  🔴 **`tileLift` 恒 0 = 零位移**（需求「保持图片中心点坐标不变」）；早先那版「先抬起 48px、停在最高点再缩」
  会让格心整段动画往上跑，读成「飞走并变小」。此时 `buildingPopScale = 0`，格子仍按**开发前**的可开发外观
  渲染（图标+价格数字跟着一起缩），而不是让已落地的建筑提前顶掉它们。对局**不再绕水平轴翻面**。
  ⚠️ 连带影响：底光（`hex-ground-glow` 序列帧）靠 `tileLift` 点亮 ⇒ 点击动画段**不点亮底光**；
  想保住那道光得另找驱动量，**不许**把 `tileLift` 填回非零（那等于把位移加回来）。同理置顶
  （`setRaised(tileLift > 0)`）也不再触发 —— 没抬起就没有「顶面被上层压住」这回事。
  🔴 缩没曾因 SVN 冲突整个丢失（用户报「点击地块收缩替换的动画丢失」）—— 这一段**别删**；
  `tests/territory-hex-flip.test.ts` 有正向守卫钉 `hexShrinkFx` 在链路上。
  ⚠️ 无卡牌（`hasCardReveal = false`）时**点击动画照播**（脉冲 + 缩没两段都要），只是播完直接回常规定格、不进隐藏段。
  ⚠️ `ZC_HEX_FLIP_SECONDS`（0.384，= core `HEX_FLIP_SECONDS`）**只剩领地翻格在用**，对局分段已不用它 ——
  别再拿它当「缩没段长」（那是 `ZC_HEX_SHRINK_SECONDS = 0.7`）。
  ② 卡牌段：点击动画播完的**当帧**弹卡牌（`ZCCardRevealView`，小→大的节奏由共用曲线 `elasticPopScale` 给定：
  `0.2 → 峰值 1.2 → 下探 0.92 → 落位 1`，**弹性来自穿过 1 的那一下下探**）。
  🔴 卡牌起点 = 开发时刻 + `ZC_CARD_START_SECONDS`（= 点击动画结束 = 0.7；`pushCardReveal` 推的就是它），
  **起点之前整卡不渲染**（`render` 里 `now < startedAt` ⇒ 写绝对 `node.active = false`）。
  这两条缺一不可：只把进度 clamp 到 0 会让整卡以 `popScale = 0.2` **可见却一动不动**地干等，
  读作「卡牌卡住了」而不是「还没轮到它出场」。需求原文：「卡牌生成阶段不需要等待静止不动的阶段，
  出现小卡后马上播放卡片变大的动画」⇒ 出现的那一刻就是开始变大的那一刻。
  ⚠️ 所有「从卡牌起算」的窗口都必须锚 `ZC_CARD_START_SECONDS`，不许各自去拼 `ZC_HEX_PULSE_SECONDS`
  （数值上眼下相等但语义不同，改点击动画时会跟着漂）或领地侧的 `ZC_HEX_FLIP_SECONDS`——
  多算 / 少算一段不会报错，只会整体错位（row6 的 `ZC_HEX_NEIGHBOR_HOLD_SECONDS` 就踩过这个坑）。
  卡牌开始淡出（`ZC_CARD_FADE_START_PROGRESS`）那一刻，地块**原尺寸回场**、建筑从 `BUILDING_POP_FROM_SCALE = 0.15`
  经**同一条** `elasticPopScale` 长到 1（与淡出**同拍重叠**，卡牌淡完时建筑已长齐，中间没有空窗）。
  `buildingPopScale = 0 ⇒ node.active = false`（写**绝对** active 防池复用残留，不是缩成 0 留着占一次绘制）。
  段末比较必须带 `HEX_ACT_SECONDS_EPSILON = 1e-9` 容差（`progress × 总时长` 重组成秒会有 ~1e-16 误差）。
  口径与判据见 `docs/AI架构与代码规范.md` §7.3.3、`tests/zcds-hex-activation.test.ts`。
- **脉冲水波纹的「黑边」靠专用着色器 `shaders/hex-pulse.effect` 抬亮**（2026-10-15 row13 需求
  「脉冲效果的边缘颜色与整体颜色保持相近色系，更亮一点（现在是黑色的）」）：
  美术帧 `fkz_*.png` 是**灰度**图 —— 填充 `(255,255,255)`、外圈边缘 `(117,117,117)`，**两者同 alpha**。
  Sprite 的 `color` 是**乘性**的 ⇒ 边缘只拿到 45.9% 的色 ⇒ `#888CFF × 0.459 ≈ #3E4075`，肉眼就是黑边。
  **纯乘性染色物理上做不到「边缘更亮而填充不变」**（那要求颜色 > 2×），所以必须换着色器。
  effect 里把「灰→色」的映射改成**保底乘**：`lum = max(tex.rgb)`、`k = mix(pulseEdgeFloor, 1, lum)`、
  `out.rgb = tex.rgb * k * color.rgb` —— 填充 `lum = 1 ⇒ k = 1`（与内置 Sprite shader **逐像素等价**，
  不会过曝 / 掉饱和），边缘 `lum ≈ 0.459 ⇒ k ≈ 0.85`（`pulseEdgeFloor = 0.72` 时）。
  `pulseEdgeFloor = 0` 就是**精确回退**到旧的纯乘性观感（留作对照开关）。
  ⚠️ 材质**只挂脉冲段**（`ZCHexView.applyPulseMaterial`：进脉冲分支挂、进其余分支摘）——
  `GroundGlow` 这个中间层节点与底光序列帧共用，整段挂着会把底光也一起抬亮。
  接线链：`ZCGameLoader.loadHexPulseMaterial`（`assets.load('shaders/hex-pulse', EffectAsset)` →
  `new Material(); initialize({ effectAsset })`，无 `*.mtl` 文件、材质运行时构建）→ `ZCGame` →
  `ZCGameRenderWorld` → `ZCHexView.setHexPulseMaterial`。判据见 `tests/zcds-hex-activation.test.ts`。
- **建筑生成单位时播一次「出生抖动」**：`ZCUnitView.playSpawnShake(now)` 只记起点、不建 tween，`render` 按
  `now − 起点` 反推 `spawnShakePulse`（`1 → 1.1 → 1` 正弦脉冲）：先 Y 轴拉 110% 回落、再 X 轴拉 110% 回落，
  各 `SPAWN_SHAKE_PHASE_SECONDS = 0.12s`，叠在朝向翻转之上；由 `ZCGameRenderWorld.renderUnitEntity` 在单位
  **首次出现**（`isBirth`）时触发。判据见 `tests/zcds-unit-spawn-shake.test.ts`。
- **建筑「生成动画：抖动」：产兵与产金共用同一条曲线，只有宿主与拉伸量不同**（钉钉表 `demo体验反馈`
  row5 / row12 / row13）。`ZCHexView.playBuildingShake(now)` 只记起点，`advanceBuildingShake(now)` 每帧按
  `now − 起点` 反推 `spawnShakeScaleY/X`（`ZCGameViewUtil` 里由 `spawnShakePulse` 拼出的两段纯函数），
  **先 Y 轴拉一下回落、再 X 轴拉一下回落**。因子**乘进** `applyBuildingScale`
  （`scale = BUILDING_ICON_SCALE × multiplier × 抖动因子`），不另开一条写 scale 的路径 ——
  否则 0.15s 一次的静态刷新会把在飞的抖动拍平。
  🔴 **拉伸量分两档，别混**：`SPAWN_SHAKE_STRETCH = 0.1`（110%）是**单位**自己出生那一下；
  `BUILDING_SHAKE_STRETCH = 0.2`（**120%**）是**建筑**这一档 —— row12 原文「建筑模型放大比例从 110%
  改成 120%」只点建筑模型。`spawnShakePulse/ScaleX/ScaleY` 都收一个可选 `stretch`，缺省是单位档。
  （同一条需求里的「【建筑生成动画】」也可以读成「建筑由小长出来的那一段」`elasticPopScale`，
  它的峰值 `POP_PEAK_SCALE` **本来就是 1.2** ⇒ 两种读法下「建筑模型放大比例 = 120%」都成立，
  所以只抬抖动这一处、`POP_PEAK_SCALE` 保持 1.2。）
  **两个触发源**：
  ① **产兵**（row5）—— 兵营倒计时结束时那批新兵首次出现在快照里，`renderUnitEntity` 的 `isBirth` 分支
  判 `unit.sourceHexId` 那格 `building === 'barracks'` 后直接调 `triggerBuildingShake(hexId, now)`
  （**不走队列**：出生这一拍本来就是逐帧事件）；
  ② **产金**（row12 / row13）—— 主城 / 金矿的 `economyContext.grantGold` 往 `ZCBattlePresentationQueue`
  推一条 `ZCBuildingShake { id, hexId }`，`renderBuildingShakes` 每帧先 `takeBuildingShakes()` **取走**再登记。
  🔴 通知队列是**取走即空**、**不参与 `prune`**：抖动**不幂等**（`playBuildingShake` 把起点重置到「现在」），
  读两遍或攒着不取就是「一直重头抖」。`drainBuildingShakes` 交出去的是**原来那条数组**、内部换新的接手，
  所以调用方可以安全遍历。因此 `buildingShakeQueue` **不能标 `readonly`**。
  🔴 推通知挂 `economyContext.grantGold` 而**不是**私有的 `grantGold`：私有那条**击杀 / 拆建筑奖励**也在走
  （它们没有「建筑在产金币」这回事，不该抖）。金额非法 / ≤ 0 不抖，与 `grantGold` 内部那道闸同口径。
  ⚠️ 别改用「有没有冷却环」当判据 —— 主城 / 金矿也有环（收入 / 产出），而产兵那条要的是**产兵建筑**。
  `renderDynamic` 末尾 `renderBuildingShakes` 逐帧推进、结束即从 `buildingShakeHexes` 摘除
  （`renderHexSystem` 挂在 0.15s 节流的 `renderStatic` 上，播不出 0.24s 的抖动）。
  判据见 `tests/zcds-building-spawn-shake.test.ts`（含队列取走即空 / 上限 / `reset` 三条）。
- **开发后「新点亮」的邻格，可开发外观要等卡牌弹出后再显示**（2026-10-15 需求「消耗金币点击方块后，
  三个新扩展的方块展示时间延迟 0.2s，等待卡牌生成动画开始播放后再展示出来」）：
  等待窗 `ZC_HEX_NEIGHBOR_HOLD_SECONDS = ZC_CARD_START_SECONDS + 0.2`（`model/ZCBattlePresentationQueue.ts`）——
  两个分句都要成立 ⇒ **从卡牌弹出那一刻（= 点击动画「脉冲 ∥ 缩没」播完）起再等 0.2s**，
  既不跟脉冲 / 缩没抢视线，也不与卡牌同拍起跳。
  ⚠️ 锚必须用 `ZC_CARD_START_SECONDS`（卡牌真正的起点 = 0.7）：别去拼 `ZC_HEX_PULSE_SECONDS`
  （数值上眼下相等但语义不同，改点击动画时会跟着漂），更别用领地侧的 `ZC_HEX_FLIP_SECONDS`（0.384）——
  锚错会让按住窗与卡牌**错拍**（图标抢在卡牌前冒出来，正好违反需求）。
  判定在 `ZCHexView.resolveDevelopableHold`：只认 **`canDevelop` 由假变真** 的那一格（视图自己记上一帧值），
  按住期间 `canDevelop` 传假 ⇒ 地块图标 / 价格图标 / 价格数字 / 玩家色染色全部不出现。
  ⚠️ 别改成「谁挨着激活格就藏谁」——本来就可开发的邻格会被藏一遍再回来（闪一下）。
  ⚠️ 对象池复用与开局首帧基线靠 `initialize` 复位三个字段 + `developableBootstrapped` 兜底。
  判据见 `tests/zcds-hex-neighbor-reveal-delay.test.ts`。
- **开局归属扩散波：选点倒计时结束、正式开打那一帧，归属格一帧直接到位、半区里的中立格逐个换成战斗底色**
  （2026-10-15 `row15` 需求「红色框，归属格子的颜色直接切换；绿色框，中立格子的颜色则是逐个替换，
  以玩家基地为圆心，圆形的扩散替换，替换的速度越来越快，范围越来越大」）。
  🔴 **两条口径互不重叠**：① 开局就归属的格（主城 + 其 6 邻格）**不入波**，走常规渲染一帧到位；
  ② 只有**本半区的中立可通行格**进波，起点 = 该格选点阶段铺的**半区色**、终点 = 战斗**底色**。
  旧实现把①那 14 格也塞进波里淡入，读起来像「归属还在推进」，正是这一版修掉的。
  触发点唯一：`ZCGame.finishSpawnSelection` —— **只在自选主城局（`cityMode: 'select'`）**，
  固定主城图不走这条路（`startSpawnSelection` 才是，见 §7.3.7），所以它天然不播。
  纯表现层，**不回写模型**（与 `ZCVictorySweep` 同形）：归属在开局那一刻就由 `createInitialState` 判好了，
  波只决定底色**何时**回到战斗态；快照 / 战报 / 领地统计读到的始终是「已经归属」。
  🔴 **必须先 `renderWorld.render(model)` 再 `startTerritoryClaimWave(model, selection)`** —— 归属格不入波，
  它们的底色**只**由这次 render 画出来（波起手只写中立格）；反了那 14 格会停在选点阶段的深蓝高亮上。
  第二个参数必须是 `finishSpawnSelection` 里的**局部** `selection`（`this.spawnSelection` 已被置空），
  波拿它查「这一格属于哪个半区」，半区口径只有 `ZCSpawnSelection.regionOwnerOf` 一处。
  时间表 `buildClaimWavePlan`（`ZCGameViewUtil.ts`）：① **BFS 距离分层**（波前由主城向外推）；② 同环内**按极角**
  `atan2(y − 主城y, x − 主城x)` 排（⚠️ 值域是 **(−π, π]**，180° = `+π` 是**最大**角不是最小，排序期望别写反）；
  ③ 每座主城**各排各的**（名次在自己的表里从 0 起），归一化 `r = rank / (总数 − 1)`，
  到达时刻 `= ZC_CLAIM_WAVE_SECONDS(=1.0) × r^ZC_CLAIM_WAVE_ACCEL_POWER(=0.65)` ——
  幂次 < 1 让相邻快照间隔**单调递减**，这就是「越来越快」的来源。
  每格自己再有 `ZC_CLAIM_WAVE_FADE_SECONDS = 0.1s` 换色过渡（`claimWaveProgress` 把 `now − startedAt − 到达时刻` 除以它）。
  实测 `select_river`（20×11＝220 格）：波 **14 格 → 152 格（两侧各 76）**，即半场里除归属格外的每一个可通行格；
  名次 0 是**离主城最近的中立格**（最内环 = 邻格的邻格），首间隔 ≈ 60ms、末间隔 ≈ 8.7ms，左右两方逐格同时刻。
  🔴 **终点色 `territoryTintOwner(owner, canDevelop)` 三处同源**（地块底图 `ZCHexView.territoryTint`、
  领地轮廓 `renderHexSystem`、波的 `tintOwnerOf`）—— 分开算就会「底图一个色、轮廓另一个色」。
  实测开局那刻中立格全不可开发（状态 `occupiable`），所以 152 格事实上全落回中立观感。
  🔴 **必须挂 `renderDynamic`**（`renderTerritoryClaimWave`，0.1s 的过渡会被 0.15s 的静态节流压成硬切）。
  ⚠️ `ZCHexView.setClaimWave({ from, to, progress })`（传 `null` 收工）是**唯一**绕过 `contentSignature` 闸门的着色入口 ——
  波改的是颜色但颜色不在指纹里，指纹不变整块渲染会被跳过，所以它**直接写** `terrainTintColor` / 底光 / `tileSprite.color`；
  收工（`null`）时要**清空 `contentKey`**，否则常规渲染会误以为「上一帧画过、这帧不用重画」。
  两端都用 `territoryFill()` 算 ⇒ 与常规渲染逐位一致（起手是选点界面那个半区色、收工是战斗底色，两帧都不闪）。
  `ZCClaimWave` 播完自动 `clear()`（把所有格交还常规渲染，别把覆盖一直挂着——`canDevelop` 那类旁路只在常规路径里算得对），
  `ZCGame.destroy` / 重开一局也要调 `clearTerritoryClaimWave()`。
  判据见 `tests/zcds-territory-claim-wave.test.ts`（17 条）。
- **胜利结算填充动画 = 深色铺场（带闪烁）→ 回正 → 线条脉冲三段，方向由「赢家是谁」决定**（钉钉表 `demo体验反馈` row8：
  「用和阵营颜色一致、但饱和度更深的颜色填充格子；**其他玩家从最上方的格子往下填充，玩家自己依旧是从下方往上填充**；
  深色格子即将完成全部填充时，再从**起始点**开始逐渐过渡到对应阵营的当前颜色」。
  2026-10-16 追加三轮：「铺场的颜色格子会闪烁，颜色在同色系偏白色的范围内快速变化」、
  「回正动画播放时间往前移，普通动画播了 3、4 行格子时，马上播放回正动画」（⇒ 取 2 行）、
  「**铺场动画播了 1~3 行就播放回正**／**铺场动画的颜色要偏亮**／**回正动画结束后再加一个线条波动的脉冲效果**」）。
  🔴 **方向判据是赢家身份、不是每格归属**：`winner === 'player' ⇒ 层号 = maxRow − row`（**从下往上**）；
  **其他玩家**（`enemy` / `enemy2` / `enemy3`）⇒ 层号 = `row − minRow`（**从上往下**）。
  旧实现只认 `winner === 'enemy'`，把 3 / 4 号席位误判成「玩家方」，这是这一版修掉的。
  ① 铺场：每次 `ZC_VICTORY_SWEEP_STEP_SECONDS = 0.06s` 铺**整整一行**深饱和色；铺上的行同时**闪烁**（见下）。
  ② 回正：从**起始点所在行**往回，每格由深色混到该阵营**当前色**，两段**重叠**。
  ③ 线条脉冲：② 收手后，一道亮线沿**同一方向**再扫一遍（`ZCVictorySweep.pulseLevelOf` → 共享轮廓层）。
  ⚠️ **总长 `victorySweepDuration` 现在含三段**。要"回正收手那一刻"必须用
  `victorySweepRevertEndSeconds` —— 拿 `victorySweepDuration` 当回正终点会多等一整段脉冲。
  🔴 ② 的起跑时刻是 **`ZC_VICTORY_SWEEP_REVERT_LEAD_ROWS = 2` 个填充步**（2026-10-16 第二轮改口径）——
  **与整盘有多少行无关**。更早的口径是「比铺满提前 0.12s 的秒数」，那要等铺到倒数第二行才动，
  前大半段屏幕上只有不动的深色。行数比 `LEAD_ROWS` 还少的盘退化成「铺满即起跑」
  （`victorySweepRevertStartSeconds` 用 `Math.min` 兜住，不许出负的起跑时刻）。
  两段同速 ⇒ 中间**恒留一条深色带**（填到第 n 行、游标就在 n − 2）。
  ⚠️ **带子宽度的两种说法别混**：差值是半开区间 `(LEAD_ROWS − 1, LEAD_ROWS]`，
  但**屏幕上数得到 `LEAD_ROWS + 1` 行**（`[cursor, litStep]` 闭区间）。同理「起跑时已铺几行」
  = `LEAD_ROWS + 1` 行。要按"铺了几行"调参数就照这个换算，别把 2 当成"2 行"。
  ② 用一个**小数游标** `victorySweepRevertCursor` 表达（整数部分 = 已整行回正的层数，小数 = 行内过渡比例），
  每格混合量 `victorySweepRevertMix(cursor, step)`（0 = 深色、1 = 当前色）。
  🔴 **深色 = `zcDeepFactionColor(owner)`（`ZCTheme.ts`）：先离灰更远、再整体压暗，全程纯 RGB** ——
  不许走 HSV（测试桩 `Color` 没有 HSV，且 h∈[0,360] 往返会让灰色丢色相）。
  🔴 **顺序不能反：先 clamp 再加暗**。`#7e82ff` 推饱和后蓝通道 = 305 越界，
  先加暗会把越界值洗成偏色（实测过一次，正确的 `[106,112,230]` 被算成 `[106,112,238]`）。
  **压暗比例 `ZC_DEEP_DARKEN = 0.9`**（2026-10-16 第二轮「铺场动画的颜色要偏亮」由 0.78 上调，
  五档统一亮约 15%）；⚠️ **上界是 1**：取到 1 深色就等于阵营当前色，回正那一段连同它的方向一起看不见了。
  实测五档：player `#7e82ff → #6a70e6`、enemy `#fb4969 → #e62b54`、enemy2 `#fbcc49 → #e6b80d`、
  enemy3 `#bd49fb → #c32be6`、neutral `#c4dae5 → #aac6d5`。
  **闪烁**（`victorySweepShimmer(elapsed, step)`，2026-10-16）：三角波，周期
  `ZC_VICTORY_SWEEP_SHIMMER_CYCLE_SECONDS = 0.15s`、峰值 `SHIMMER_MAX = 0.5`、相邻行相位差 `1/3` 周期。
  🔴 用**三角波不用正弦** —— 三角波顶点是折角，看上去是「啪一下亮起来」，正弦顶点平缓读作「慢慢呼吸」。
  整周期 0 → 峰 → 0 **恒非负** ⇒ `elapsed = 0` 拿到的是纯深色，起手不会先白一下。
  往白里偏走 `zcTowardWhite(color, amount)`（逐通道线性插值到 255，纯 RGB、保持色相）。
  🔴 **只偏深色那一端**（`sweepFill` 里 `lerp(whiten(deep, shimmer), current, mix)`）⇒ `mix = 1` 时
  闪烁**完全不参与**、中间态按 `1 − mix` **自动**淡出，不需要第二套「什么时候停闪」的规则。
  写色走 `ZCHexView.setSweepOwner(owner, mix = 0, shimmer = 0)`：`mix` 按 **32 档**、`shimmer` 按 **16 档**
  量化进 `sweepKey`（不量化的话每帧回正 / 闪烁都会抖 `spriteFrame`）；
  ⚠️ `mix >= 1` 时**把 shimmer 剔出指纹** —— 那时闪烁已经不参与配色，再算进去就是每帧无故重绘一片
  不会再变的格子。`sweepFill(owner, mix, shimmer)` 混两份 `territoryFill` 采样；
  **`mix = 1` 与常规渲染逐位一致**，所以最后摘掉覆盖层不会「弹」一下。
  🔴 **③ 线条脉冲一格底色都不改，画在整盘共享的 `OutlineLayer` 上**（`appendHexPulseOutlineSegments`）：
  波带半宽 `ZC_VICTORY_SWEEP_PULSE_BAND_ROWS = 1`、速度 `PULSE_STEP_SECONDS = 0.035s/行`
  （**比铺场 / 回正的 0.06 快**：收尾的一道光不该按"再铺一遍"的节奏走）、
  强度量化 `PULSE_LEVELS = 4` 档、最亮档往白偏 `PULSE_MAX_MIX = 0.55`、亮线宽 `PULSE_LINE_WIDTH = 7`。
  形状是**波前两侧对称的三角**（峰在波前正压过那一行）—— 单侧斜坡只有"亮起再灭"，读作闪一下。
  ⚠️ 脉冲段**要在 4 个数里选对判据**：`victorySweepPulseMix` 判的是 `cursor >= 0`，
  写成 `> 0` 会漏掉起跑那一帧（游标恰好 0）。
  ⚠️ **三处必须同步改的地方**（改脉冲参数时最容易漏）：① `redrawSharedOutline` 的探针每格压
  **4** 个数（id / 阵营 / mask / **脉冲档位**），加它是因为"底色不变但亮带在移"必须算作内容变化，
  否则亮带定格不动；传参时**按档位预先建好 `Color` 再复用**（逐格现算颜色会让每格各占一个
  `Graphics` 桶 = 一个 subModel，共享层就白合了）；② `MAX_BUCKETS` 从 12 提到 **16**；
  ③ `tests/zcds-hex-neighbor-reveal-delay.test.ts` 里读探针的步长是 **4**，改布局要一起改。
  闪烁相位档位（`victorySweepShimmerTick`）是 `advance` 的第三个「要不要重画」判据，脉冲波前是第四个。
  镜头动画本身**不变**。判据见 `tests/zcds-progress.test.ts`（含 3 / 4 号席位方向、铺过 2 行即起跑、
  深色带宽度、闪烁曲线、「闪烁只偏深色端」、脉冲曲线、脉冲时序与探针共 7 条）
  与 `tests/zcds-outline-layer.test.ts`（脉冲六条边全描 / 同档归一笔 / 与轮廓同坐标）。
  布局提醒：那段用例是**累加式**推进的（`elapsed += dt`），所以用例内部自己记进度、按**绝对时刻**推
  （`advanceTo`）—— 直接传差值的话，一旦回正起跑时刻前移，两次推进的差不小心变成负数就会被
  `Math.max(0, dt)` 静默吃掉。
- **地块描边与地块图标同一帧出现，不许「先展示描边」**（钉钉表 row9）。
  `ZCHexView.resolveDevelopableHold` 改为 **public**，渲染世界的 `ownerForHex` 闭包在让 `canPlayerDevelop`
  给轮廓上玩家色**之前**，先问每格视图「这一格还在按住窗里吗」。
  旧行为是轮廓**立刻**变玩家色，而图标 / 价格还要再等 `ZC_HEX_NEIGHBOR_HOLD_SECONDS`（卡牌弹出 + 0.2s）
  —— 那 0.2s 的「只有描边、没有图标」正是需求要消掉的东西。
  查表是**幂等**的，所以视图自己在同一帧后面对 `render` 再问一次同一个方法是安全的。
  判据见 `tests/zcds-hex-neighbor-reveal-delay.test.ts`（★row9 那条直接驱动 `renderHexSystem`，
  用 `world.outlineDrawn` 读轮廓用的是哪档颜色：1 = 中立、2 = 玩家）。
- **进入对局初始时，金矿那一格套一圈整体描边闪烁**（钉钉表 row10：「参照图例，进入游戏初始时，
  给金矿图标所在的地块格子增加一个整体的描边闪烁，提示玩家点击金矿」）。
  曲线 `zcNeutralHintAlpha(elapsed)`（纯函数）：窗口 = `ZC_NEUTRAL_HINT_CYCLE_SECONDS (1.1) ×
  ZC_NEUTRAL_HINT_CYCLES (4)` = 4.4s，相位用 `cos` ⇒ **`elapsed = 0` 最亮**；
  脉冲下限 `ZC_NEUTRAL_HINT_MIN_ALPHA = 0.35`；**末段包络是 `(1 − u)²` 不是线性** ——
  线性会让上升中的脉冲把乘积重新提亮，读起来是「闪两下再灭」。
  目标格唯一：`ZC_NEUTRAL_HINT_RESOURCE_ID = 'mine'`。
  画在**每格自己的 `TerritoryOutline`（`Graphics`）**上（为这一个用途把它复活：每帧 6 条边，
  比重建整块共享轮廓便宜），颜色 `ZC_CLIENT_COLORS.gold`、线宽 7，
  复用 `ZCOutlineLayer` 的 `ZC_OUTLINE_HEX_POINTS` / `OWNED_OUTLINE_INSET_SCALE`。
  `ZCHexView.renderHintOutline(alpha)` 带 2% 不透明死区 + `graphics.enabled` 闸门；`alpha ≤ 0` 时清空并关掉。
  通道 `ZCGameRenderWorld.renderNeutralHint`：挂 `renderDynamic`，窗口**锚在对局时间** `visualTime`
  （进对局那一刻为 0，换局 / 重连天然重新计时），`hintOutlineSettled` 单向闩锁；
  金矿被领取 / 开发（模型 `neutralResourceId` 被清空）或这盘根本没有金矿格时自动收手。
  判据见 `tests/zcds-neutral-hint-outline.test.ts`（曲线 / 视图 / 源守卫 / 通道共 4 条）。
- **传说牌横幅 `ZCGameLegendBanner`：扇入 + role 生成动画**（钉钉表 row11：「预制体从屏幕外生成，
  从左往右快速扇入屏幕，当生成动画块完成时，再展示 role 节点生成动画（role 初始透明度为 0 或不加载显示），
  role 节点初始位置 Y 轴为 80，0.7s 内降至 0（X 轴根据父节点移动）」）。
  🔴 **一律从左往右**（不再按「我方从左、敌方从右」分方向）—— `isLeftSide` 已删除，
  起点恒为 `−viewWidth / 2 − halfWidth`。
  `LEGEND_ROLE_DROP_Y = 80`、`LEGEND_ROLE_GENERATE_SECONDS = 0.7`；
  `legendRoleProgress(elapsed, slideSeconds)`：扇入期间恒 0，扇入结束后 0.7s 内线性 0 → 1
  （算的是**已用时**，不是 reveal 进度）；`legendRoleEase = easeOutCubic`，下落与淡入共用它。
  🔴 **「Y 轴 80 → 0」是相对 prefab 静止位的偏移**，不是绝对 0：role 节点的静止 `y = −28.24`，
  写成绝对值会把它永久抬高 28px。`roleRestY` 在第一次写之前惰性捕获。
  透明度走 `roleSprite.color.a`（**不是 `UIOpacity`**）：`renderContent` 从不碰 `color`，两者不打架，
  也就不需要改 prefab。
  判据见 `tests/zcds-legend-banner.test.ts`（★row11 那条按 0.05s 采样整段）。
- **中立资源点（`unit_cap`）格内那队兵的落点 = `ZCHexView.RESOURCE_UNIT_POS_Y = 12`**（2026-10-15 由 `-18` 上移 30px：
  原「格心偏下一点」会被地块整图下半部与邻格侧壁压住，看着陷在格子里）。
  ⚠️ 只动这一个数：横向间距 `RESOURCE_UNIT_SPACING = 16`、目标高 `RESOURCE_UNIT_TARGET_HEIGHT = 48.6` 不变。
  判据见 `tests/zcds-resource-unit-preview.test.ts`。
- **战斗飘字是「快进慢出」：前 45% 完成入场（位移 + 缩放），后 55% 缓慢淡出，总时长不变**（`ZCFloatTextView`）。
  **一个旋钮管两端** —— `entranceProgress = FLOAT_TEXT_ENTRANCE_PROGRESS = 0.45`（2026-10-15 由 0.35 上调：
  35% 时入场太急、位移「唰」一下走完，读不出「从目标头顶飘出来」；45% 仍小于一半 ⇒ 「快进 / 慢出」的定性不变）。
  早先是两个数（代码常量 `POP_PROGRESS = 0.3` + property `fadeStartProgress = 0.55`），
  中间那 0.25 段数字**既不动也不淡**，读起来是「卡了一下才消失」。合成一个之后，
  进到位的那一刻正是开始淡出的那一刻。
  两条曲线都是 `ZCGameViewUtil` 里的**纯函数**，视图里不准另算一份：`floatTextEntrance`（入场段套
  easeOutCubic —— 起步最快、末段收稳，这就是「快进」的手感来源；之后**恒 1**）、`floatTextFade`
  （入场段恒 1，之后在剩下的时长里**线性**淡到 0；「慢出」要的是匀速地慢慢消失，再叠一层 easing 会忽快忽慢显脏）。
  🔴 位移（散落 / 下坠 / 摇摆 / 金币上浮）、弹出缩放、金币图标自转**一律喂 `enter` 而不是整条 `progress`**：
  换成 `progress` 数字会飘满整条时长（看着是「一直在飘」而不是「进场」），金币图标也会变成
  「数字已停住、图标还在旁边自己转」。
  ④ 慢出段带 **`driftDistance = 7`（5~10px）的同向收尾漂移**（`floatTextDrift`：入场段恒 `0`，之后 easeOutQuad
  `u(2-u)` 递减收尾）—— 伤害继续下沉、金币继续上飘。没有它的话数字会在剩下的 55% 里**完全静止**地淡出，
  读起来像「贴图卡在那儿被调透明度」而不是「飘走」。🔴 **幅度压在 5~10px**（2026-10-15 由 3~5 上调，
  4px 在 720×1280 上太含蓄、看不出在动）：几十像素就会变回「一直在飘」，
  等于把快进慢出退回去；也**不许**在入场段漂移（那段位移归 `floatTextEntrance`，两段叠加会打架）。
  ⚠️ **总时长保持不变** —— 改的是曲线分配，不是 `FLOAT_TEXT_DAMAGE_SECONDS` / `FLOAT_TEXT_GOLD_SECONDS`。
  **改了 `entranceProgress` / `driftDistance` 要同步 `ZCGameFloatText.prefab` 上那份序列化值**，
  否则面板值把代码缺省顶掉。
  判据见 `tests/zcds-float-text-gold-icon.test.ts` 与 `tests/zcds-progress.test.ts`（后者从真曲线取值，不写死数字）。
- **墙砖之间按屏幕 y 排序：越下方的城墙层级越高、压住上方的城墙**。`ZCGameRenderWorld.renderWallSystem`
  铺砖前把**全盘**墙段按 `segment.y` **降序**排一遍（y 小的后画 ⇒ 在上面）。必须整盘一起排，
  按格 / 按连通簇分段排会让「墙环绕一圈」时接角处的上下关系随簇遍历顺序漂。
  这条排序会打乱 `segmentIndex` 与边的对应，也让共享材质的帧槽号按新顺序分配 ⇒
  依赖顺序的用例必须改成「按落点反查边号」，别再把 `records[edge]` 或 `rightUp=0` 写死。
  口径与判据见 `docs/AI架构与代码规范.md` §7.3.3。
- **其他玩家的单位 = 顶点色相乘叠 `#828282` 灰（暗色叠加）**，判据统一 `owner !== 'player'`
  （与领地染色 / 城墙敌我同一个口径）。灰走 `Sprite.color` / `Skeleton.color`（与阵亡灰同一条通道，
  优先级 **阵亡 > 其他玩家 > 原色**）。是**相乘**不是覆盖半透明节点：保留色相、只压暗
  （`OTHER_PLAYER_TINT = 0x82`，别用全黑，否则看不出体积）。写色必须带 `else`
  （`if (sprite) … else if (skeleton) …`），不带的话 spine 单位永远不变色。
  口径见 `docs/AI架构与代码规范.md` §7.3.6 与 `tests/zcds-unit-view-render.test.ts`。
- 抽到**金卡（tier 4）**时弹「传说卡出场横幅」：`ui/game/ZCGameLegendBanner.prefab`，与小卡牌**同源**
  （都读 `model.cardReveals`，渲染层筛 tier 4），但**挂全屏层 `options.overlayLayer`（HUD 根）而不是
  `mapLayer`** —— 后者是 `ScrollView` 的 content，横幅会跟着拖动跑、还会被 Mask 裁掉。
  四条硬约束（漏任一条都是静默失效）：立绘是 256×256 方形原图 ⇒ `Role` 必须 `sizeMode=RAW` + 底边锚点 + 视图
  按 `frame.height` **等比**缩放到 333（固定框会拉扁 30%）；CUSTOM 尺寸的 Sprite 必须 `_isTrimmedMode=false`；
  头像用工程既有的 `CircleAvatar` 圆裁（`icons/head` 是方形图），别退回 `cc.Mask`。
  口径与判据见 `docs/AI架构与代码规范.md` §7.3.4。
- **自选主城（`cityMode: 'select'`）= 「选择基地模式」**：倒计时 / 半区限制 / AI 自动确认 / 顶栏 HUD
  一律沿用既有 `ZCSpawnSelection` + `ZCSpawnSelectionView`，**只改 world 层表现**，别新造第二套选点状态机。
  ① 玩家一进选点阶段就有**默认落点**（`ZCSpawnSelection.defaultHexFor`：地图声明的默认主城，否则第一个合法格），
  基地建筑照旧由格子的 `buildingSprite`（`hq` → `hq-base`）画 —— **只预置玩家，不预置 AI**，
  且这条退路必须**确定**（构造期多消耗一次随机源会把 AI 确认时机与资源抽取次序整体错开）；
  ② 基地相邻格走 `ZCHexView` 的 `homeHighlight` 填充 = 深蓝 `#1D24C8`（alpha 170），
  **优先级高于受阻红**；邻格集合只从 `ZCSpawnSelection.baseNeighborIds('player')` 取，渲染层别自己推；
  ③ 跟随基地的绿色【确认位置】按钮 = **选点 HUD 里现成的绿勾 `ZCSpawnSelection.prefab/ConfirmSpawn`**
  （`btn_gou.png`，实测绿 `#5ED545`），由 `ZCGame.borrowSpawnConfirmButton()` **借出来改挂**
  `hudView.mapLayer`（世界坐标，与基地同层同缩放 —— 不是 HUD 层），位置由
  `ZCGameRenderWorld.renderSpawnConfirmButton` 逐帧写 = **基地正下方 `SPAWN_BASE_CONFIRM_ROW_OFFSET = 2`
  个行距**（1 格子单位 = `HEX_GRID_VIEW_ROW_SPACING = 90`，**不是列距 92.25**；取中心到中心，
  基地外观怎么换按钮都不跳）。
  🔴 三条不能省的借用细节：**关掉它自带的 `cc.Widget`**（它在 HUD 里靠「水平居中 + 底边 200px」
  钉住，换父级后会每帧把按钮拽回屏幕底部，跟逐帧写的基地坐标打架）；
  **归还必须在 `spawnSelectionView.node.destroy()` 之前**（按钮此刻挂在棋盘层，不送回去就销毁不掉）；
  **不要另造一颗按钮** —— 染色（`CONFIRM_INVALID/READY/IDLE`）、「等待其他玩家」隐藏、
  `TOUCH_END → actions.confirm()` 全部由 `ZCSpawnSelectionView` 管着，第二颗按钮必然长出第二套判据
  （2026-10-15 已删掉最初手画的 `ui/game/ZCSpawnBaseConfirm`）；
  ④ 「显示高亮 / 按钮」的判据是 `ZCSpawnSelection.isPlacing('player')`，**不是 `snapshot.finished`**
  —— 我方确认后整体阶段还要等 AI，用 `finished` 会让高亮与按钮多留好几秒。
  口径与判据见 `docs/AI架构与代码规范.md` §7.3.7 与 `tests/zcds-spawn-base-confirm.test.ts`。
- 不得修改生成文件、`library/`、`temp/`、`build/`、`native/`，除非用户明确要求；proto/配置按既有生成脚本更新。
- 加美术 / 改配置一律走既有工具链，**不手改生成产物**：
  - **美术碎图目录必须配自动图集**：每棵目录树**最外层**一份 `auto-atlas.pac`（`image/<分类>/`、`icons/<分类>/`）。
    它**递归覆盖整个子目录树**（父目录自己一张图都没有也生效 ⇒ `decor/` 覆盖 `decor/wasteland/`），
    因此**父子都放会重复打包**、**`image/` 根目录绝不能放**（下面 35 个子目录各有 pac）。
    漏了**不报错**（图照常加载、没 warn），必须专门核查；口径与核查脚本见 `docs/AI架构与代码规范.md` §7.3.2。
  - 兵种美术两种形态 —— 序列帧 `assets/resources/units/<名>/<名>`、spine `assets/resources/skel/<名>/<名>`。
    spine 目录固定 `<前缀>.atlas.txt`（源的 `.atlas` 必须改名）+ `.png` + `.skel` + `<目录>.prefab`；
    节点 layer 必须 `UI_2D`（根 + `spine` 子节点都要）、`sp.Skeleton.defaultAnimation` 必须是 `idle`、
    **`sp.Skeleton.enableBatch` 必须勾上**（落盘 `_enableBatch: true`；组件默认 false，新建 / 生成的都不自带）。
  - 卡表 `unitPrefabPath` 写 `skel/<目录>/<目录>`（**正斜杠**）；`units/**` 与 `skel/**` 的取舍以卡表为准。
  - **目录名 = prefab 名，但不必等于卡名** —— 唯一硬约束是「`assets/resources/<unitPrefabPath>.prefab` 真实存在」。
    实测 8 个单位里 2 个用简称（卡名 `豌豆游侠`→目录 `豌豆射手`、卡名 `巨力坚果`→`坚果`）。
    **改目录名 / 挪位置必须同步改卡表**；只改卡名则不必动目录。别按美术源目录名直接建目录
    （`金发老板exp`→卡名 `金发统领`；`吞噬大嘴花exp` 曾名为 `剑圣`，当天又以 `吞噬大嘴花` 统一，
    卡名与路径一并改）。文件前缀是三件套的文件名（`tlp`/`mds`/`wdss`），与上面两者互不相等。
  - 判据 = `tools/pvp_card_check.py` 逐行校验 `assets/resources/<unitPrefabPath>.prefab` 存在，
    `skel/**` 与 `units/**` 同一口径；它比运行时那条 `Bundle resources doesn't contain ...` 的 warn 早得多。
  - 改表后依次跑 `tools/config`（Excel → json/remoteRef/refGen）与 `tools/ref`（拷进工程 + 守卫），
    并让 `tools/pvp_card_check.py` 通过；产物落地后 refresh `db://assets/remoteRef`。

- **领地「冒险」页：建筑 / 站点要落在格子的可见台面中心**（2026-10-15）。`TerritoryMapView.cellCenter()`
  返回 `y + HEX_GRID_CONTENT_LIFT(12.5)` —— **不是**恒等映射。
  🔴 **为什么不能按「建筑坐标 == 格子节点坐标」的字面口径做**：地块底图 `img_land_01_gray` 是
  **130×119 的 2.5D 立体图**，逐行扫 alpha 实测**可见台面只占 y=2~91**（高 90 = `HEX_GRID_FACE_HEIGHT`），
  下面 28px 是侧壁；`Sprite` 锚点在整图中心 y=59 ⇒ 台面中心比锚点**高 12.5px**。
  摆在锚点上就恒偏下 12.5 美术px（截图逐格实测总偏差 13~23px）。
  ⚠️ 偏移的**只有格内内容**：格子节点在 `syncGrid` 里仍必须 `setPosition(point.x, point.y, 0)`
  （行距 90 / 列距 92.25 与画家顺序都以它为准，动了整张地图就乱）。
  ⚠️ `HEX_GRID_CONTENT_LIFT` 在对局侧仍是合法的蜂窝顶面几何，别跟着删。
  判据 `tests/territory-cell-center-align.test.ts`（⚠️ 该文件 2026-10-15 前**根本不存在**，
  文档引用了三处却从没落地，正是本条长期无守卫的原因）。

## 命名与风格

- 文件/类：PascalCase 且同名；接口/类型 PascalCase **加 `I` 前缀**，`I` 在最前（`IMailRepository`、`IZCSnapshot`，不是 `ZCISnapshot`）；枚举成员 PascalCase；常量 UPPER_SNAKE_CASE。
- 变量/函数：camelCase；布尔 `is/has/can` 开头；私有字段 `private` + camelCase，**TS 不用 `m_` 前缀**（`m_` 是 C# 约定）。
- 对局玩法 `zcds` 内类统一 `ZC` 前缀；禁用拼音；禁止 `Utils.ts`/`Common.ts`/`Manager.ts` 收容箱。
- 4 空格/单引号/分号；类型依赖用 `import type`；`unknown` 优于 `any`；玩家可见文案与魔法数移至常量/文本表。

## 代码风格与交付

- TypeScript：显式导出公共类型；接口/只读入参优先 `readonly`；`unknown` 优于 `any`；魔法数和玩家可见文本移至命名常量/文本表。
- 一个文件一个清晰职责。函数应描述意图（`load…`、`build…`、`present…`、`handle…`），避免 `doIt`、`data`、`temp`。
- 注释只说明业务原因、引擎陷阱、兼容性或不变量；不要复述代码。兼容分支要说明删除条件。
- 有规则、边界、取消、资源或回归风险的改动必须新增/更新测试；最少运行与改动相关的 `npm.cmd test` 子集或项目检查命令，并报告实际结果。
- 完成时说明：改了什么、关键架构边界、验证命令与结果、尚未验证的风险。不要把“应该能运行”当作验证。
