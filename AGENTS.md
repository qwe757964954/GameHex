# AI 开发约定（必读）

本仓库是 Cocos Creator 3.8 + TypeScript 游戏。开始改代码前，先按下方**按需路由表**查阅对应规范：
- 全局架构、生命周期、Prefab 陷阱与美术配表工具链：[docs/AI架构与代码规范.md](https://www.google.com/search?q=docs%2FAI%E6%9E%B6%E6%9E%84%E4%B8%8E%E4%BB%A3%E7%A0%81%E8%A7%84%E8%8C%83.md)
- 对局表现层（`app/zcds/view`）与「冒险」领地页（`app/territory`）专项规格书：[docs/zcds-表现层与领地规范.md](https://www.google.com/search?q=docs%2Fzcds-%E8%A1%A8%E7%8E%B0%E5%B1%82%E4%B8%8E%E9%A2%86%E5%9C%B0%E8%A7%84%E8%8C%83.md)

## 先做什么

1. **确认归属与边界**：先确认需求所属的 feature、流程、数据来源与资源生命周期，不要只按文件名猜测。
2. **符号与调用链追踪**：仓库有 `.codegraph/` 时，先用 `codegraph explore` 追踪符号、调用链和已有测试，再读代码（定位控制在 1~2 次查询内，避免盲目全仓 grep）。
3. **保护工作区**：修改前检查工作区状态；严禁覆盖、格式化或回退与当前任务无关的用户改动。
4. **复用优先**：优先复用已有模式、类型、文本常量、资源加载器和测试夹具，禁止平行造第二套状态机或工具类。

## 按需规范路由与精准验证表

修改以下模块时，**必须先按需读取对应规范章节**，并在改完后运行绑定的最小单测集：

| 涉及模块 / 目录 | 必读规范章节 | 最小验证命令（`npx tsx --test <文件>`） |
| :--- | :--- | :--- |
| 全局分层 / 跨模块依赖 / `Procedure*` | `docs/AI架构与代码规范.md` §2 | 相关流程与边界单测 |
| 弹窗 / 异步加载 / 对象池 / 渲染节流 | `docs/AI架构与代码规范.md` §3 | 对应视图与生命周期单测 |
| 美术碎图 `auto-atlas` / Spine / 导表 | `docs/AI架构与代码规范.md` §7.3.1 ~ §7.3.2 | `python tools/pvp_card_check.py` |
| 棋盘图层 / 墙砖排序 (`ZCGameBoard`) | `docs/zcds-表现层与领地规范.md` §1.1 | `tests/zcds-progress.test.ts`、`tests/zcds-render-performance.test.ts` |
| 地块图标 / 资源图标抬层 / 兵团预览 | `docs/zcds-表现层与领地规范.md` §1.2 | `tests/zcds-tile-icon-scale.test.ts`、`tests/zcds-resource-icon-layer.test.ts`、`tests/zcds-resource-unit-preview.test.ts` |
| 地块激活（脉冲∥缩没 / 卡牌 / 建筑生长） | `docs/zcds-表现层与领地规范.md` §1.3、§8 | `tests/zcds-hex-activation.test.ts`、`tests/zcds-card-reveal-pop.test.ts`、`tests/territory-hex-flip.test.ts` |
| 单位出生抖动 / 建筑产兵、产金与**冒险建筑生成**抖动 | `docs/zcds-表现层与领地规范.md` §1.4、§9.5、§3.4 | `tests/zcds-unit-spawn-shake.test.ts`、`tests/zcds-building-spawn-shake.test.ts`、`tests/territory-building-shake.test.ts` |
| 新扩展邻格延迟展示与描边同步 | `docs/zcds-表现层与领地规范.md` §1.4、§9.2 | `tests/zcds-hex-neighbor-reveal-delay.test.ts` |
| 特效缩放（出生 / 受击 / 阵亡 `_lscale`） | `docs/zcds-表现层与领地规范.md` §1.5 | `tests/zcds-hit-fx.test.ts` |
| 受击特效总时长锁 0.15s（加速、无定格） | `docs/zcds-表现层与领地规范.md` §1.6 | `tests/zcds-hit-fx.test.ts` |
| 传说卡出场横幅 (`ZCGameLegendBanner`) | `docs/zcds-表现层与领地规范.md` §2、§9.4 | `tests/zcds-legend-banner.test.ts` |
| 「冒险」领地页 (`app/territory/**`) | `docs/zcds-表现层与领地规范.md` §3 | `tests/territory-presenter.test.ts`、`tests/territory-page-split.test.ts`、`tests/territory-cell-center-align.test.ts`、`tests/territory-hex-flip.test.ts`、`tests/territory-building-shake.test.ts` |
| 敌方单位暗色叠加 (`ZCUnitView`) | `docs/zcds-表现层与领地规范.md` §4 | `tests/zcds-unit-view-render.test.ts` |
| 自选主城 / 基地确认按钮 (`ZCSpawnSelection`) | `docs/zcds-表现层与领地规范.md` §5 | `tests/zcds-spawn-base-confirm.test.ts` |
| 战斗飘字快进慢出 (`ZCFloatTextView`) | `docs/zcds-表现层与领地规范.md` §6 | `tests/zcds-float-text-gold-icon.test.ts`、`tests/zcds-progress.test.ts` |
| 开局归属扩散波 (`ZCClaimWave`) | `docs/zcds-表现层与领地规范.md` §7 | `tests/zcds-territory-claim-wave.test.ts` |
| 胜利结算三段式扫场 (`ZCVictorySweep`) | `docs/zcds-表现层与领地规范.md` §9.1 | `tests/zcds-progress.test.ts`、`tests/zcds-outline-layer.test.ts` |
| 开局金矿整圈描边闪烁 (`renderNeutralHint`) | `docs/zcds-表现层与领地规范.md` §9.3 | `tests/zcds-neutral-hint-outline.test.ts` |

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

- **契约先行**：先定义输入、输出、错误/取消语义和不变量，再写实现。外部数据一律在边界归一化、校验。
- **异步安全**：异步操作必须能处理节点/弹窗已关闭、流程预加载已取消、重复点击、请求失败。`PopupBase` 子类使用 `nextPopupFrame()` 并在 `await` 后检查 `isValid`；流程预加载检查 `context.cancelled`。
- **渲染幂等与纯函数时间轴**：UI `render` 必须是幂等的全量赋值，对象池/虚拟列表不得依赖上一次状态；动画与时间轴一律记录 `startedAt` 并由纯函数按 `now - startedAt` 计算进度，禁止在视图组件内零散建 `tween` 或靠 `dt` 累加状态。
- **引用与类型红线**：Cocos Inspector 必填引用用 `null!`，允许为空的引用明确写 `| null` 并在边界处理；不得用 `as any`、非空断言或静默 optional chaining 掩盖必填绑定错误。
- **帧循环禁令**：禁止在 `update` 里加载资源、查全局配置、创建临时数组/节点，或混入业务规则；高频渲染按已有节流策略（`renderDynamic` vs 0.15s `renderStatic`）执行。
- **禁全局可变状态**：不引入新的全局可变状态或 static 暂存区。跨流程传值优先写入明确的 entry params / context；临时桥接必须单次消费、立刻清空并有测试。
- **Prefab、资源与配表工具链**：
  - 严禁修改生成文件、`library/`、`temp/`、`build/`、`native/`（除非用户明确要求）。
  - 工程的 Prefab 搭建与修改使用 Cocos MCP 定位和验证；修改 `.prefab`、`.scene` 后通过 MCP 刷新资源，生成 `.meta` 由引擎负责；手写或脚本生成 Prefab 节点必须显式包含 `cc.UITransform`，`CUSTOM` 尺寸 Sprite 必须设 `_isTrimmedMode = false`。
  - 美术碎图目录每棵目录树**最外层**放一份 `auto-atlas.pac`（递归覆盖子目录，严禁父子同放或放在 `image/` 根目录）。
  - Spine 单位目录固定 `<前缀>.atlas.txt` + `.png` + `.skel` + `<目录>.prefab`，节点 `layer = UI_2D`、`defaultAnimation = 'idle'`、`_enableBatch = true`。
  - 改表后依次跑 `tools/config` → `tools/ref` → `tools/pvp_card_check.py`，产物落地后 refresh `db://assets/remoteRef`。

## 对局与领地表现层核心不变量速查（详情见专项规范）

1. **棋盘图层 (`ZCGameBoard.prefab`)**：子节点顺序即渲染顺序，全层 `UI_2D`；城墙层插在 `OutlineLayer` 之后，且全盘墙砖按屏幕 `segment.y` 降序排列；`destroy()` 不得拆 board 与城墙层。
2. **缩放权责分离（代码 vs Prefab）**：
   - 地块类型图标（`TILE_ICON_SCALE = 0.8`）、资源图标（`resourceIconScale`）、建筑图标（`BUILDING_ICON_SCALE = 0.72`，唯一入口 `applyBuildingScale`）**由代码唯一写入**，改 Prefab `_lscale` 无效；金币 `priceIcon` 与数字 `iconLabel` 不参与。
   - 出生/受击/阵亡特效的显示大小**由 Prefab 根 `_lscale` 唯一决定**（受击 = 110px 基准 **×0.7 ⇒ 77px**，战士再 ×0.8 = 61.6px；出生基准屏宽 ~110px；**阵亡特效唯一例外**，`0.16448` 屏上 `88×179.6`，严禁改回 110px）；`playSpawnFx` 禁写 `setPosition`，`playHitFx`/`playDeathFx` 禁写 `scale`。
   - 受击特效**总时长锁死 0.15s**：`ZCEffectPool.HIT_FX_TARGET_SECONDS` 与 `ZCGameModel.HIT_FX_SECONDS` 同值；加速只动 `state.speed = clip.duration / 0.15`（资产 `_duration` 仍是 18fps 美术真值，改它=截断），**回收点必须用 0.15**（用 `clip.duration` 就是末帧被 Normal 定住 = 定格），且渲染循环只能走 `syncHitFx`（逐帧 `play()` 会把动画 seek 回 0）。
3. **资源图标抬层与落点**：中立资源图标由 `setResourceIconRaised` 抬至 `ResourceLayer`，坐标经 `applyIconPosition` 补偿；地块类型图标不抬（局部 `y = 4`）；兵团资源点 `RESOURCE_UNIT_POS_Y = 12`。
4. **地块激活（1.856s = 点击动画 0.7s + 卡牌 1.156s）**：① 点击动画段脉冲与缩没**并发**（`hexPulseShrinkFx`，`tileLift` 恒 0 零位移；格根 `tileScale` 单调减至 0.1；波纹层抵消父缩放向外扩至 1.25 并经每格克隆的 `hex-pulse.effect` 做径向虚化与 `pulseEdgeFloor = 0.72` 边缘抬亮）；② 卡牌在 `ZC_CARD_START_SECONDS (0.7s)` 当帧显形并按 `elasticPopScale` 弹出（起点前 `node.active = false`）；③ 卡牌淡出窗（最后 38% = 0.43928s）内建筑同拍由 0.15 长到 1（0.36s）。
5. **新扩展邻格按住窗 (row6 + row9)**：`canDevelop` 由假变真时延后 `ZC_HEX_NEIGHBOR_HOLD_SECONDS = ZC_CARD_START_SECONDS + 0.2`，由 public `resolveDevelopableHold` 统一拦截**图标、价格与共享领地描边**，确保描边与图标同帧出现。
6. **单位与建筑抖动 (row5 + row12 + row13)**：均走 `spawnShakePulse`（先 Y 后 X 各 0.12s）且挂 `renderDynamic`；单位出生拉伸 `0.1`（110%），建筑产兵（`barracks`）与产金（主城/金矿，挂 `economyContext.grantGold` 经 `drainBuildingShakes` 取走即空）拉伸 `0.2`（120%），乘入 `applyBuildingScale`。
7. **开局归属扩散波 (row15)**：仅自选主城局 `finishSpawnSelection` 触发，**先 `render(model)` 再 `startTerritoryClaimWave(model, selection)`**；开局归属格（主城+6邻格）一帧到位**不入波**，本半区中立可通行格按 BFS 环号 + 极角 `(-π, π]` + 幂次 `r^0.65` 加速扩散，经 `setClaimWave` 绕过指纹闸门做 0.1s 过渡，收工清空 `contentKey`。
8. **胜利结算三段式扫场 (row8)**：方向按**赢家身份**定（`player` 从下往上 `maxRow - row`，其余 `enemy/enemy2/enemy3` 从上往下 `row - minRow`）；① 深色铺场（`zcDeepFactionColor` 纯 RGB 先 clamp 再乘 `ZC_DEEP_DARKEN = 0.9`，叠加 0.15s 三角波 `zcTowardWhite` 闪烁）→ ② 铺过 `LEAD_ROWS = 2` 步（屏上 3 行深色带）即从起点回正（只偏深色端，`mix = 1` 自动停闪并剔出指纹）→ ③ 回正结束后在 `OutlineLayer` 扫过一道 4 档量化的线条脉冲（`PULSE_STEP_SECONDS = 0.035s/行`，轮廓探针步长 **4**，`MAX_BUCKETS = 16`）。
9. **金矿提示 (row10) / 传说横幅 (row11) / 飘字 (row14) / 敌方置灰 / 自选基地 / 领地台面**：
   - 金矿开局 4.4s 整圈金边闪烁（`zcNeutralHintAlpha`，末段 `(1-u)²` 包络，画在每格 `TerritoryOutline`）。
   - 传说横幅（`tier === 4`）挂 HUD 根 `overlayLayer`，一律从左往右扇入，结束后 `Role` 相对静止位（`y = -28.24`）从 `+80` 经 0.7s `easeOutCubic` 落回并改 `roleSprite.color.a`。
   - 战斗飘字前 `0.45` 入场（位移/缩放/金币自转全喂 `enter`），后 `0.55` 线性淡出并带 `driftDistance = 7` 同向收尾漂移（与 `ZCGameFloatText.prefab` 序列化值同步）。时间表：伤害总 `0.85s`（入场 `0.3825` + 淡出 `0.4675`）、金币总 `1.1s`（`0.495` + `0.605`），`now >= startedAt + durationSeconds` 即回收；`easeOutCubic` 让 **10% 时间走完 53% 位移、20% 走完 83%**。文案（2026-10-17）：伤害类**不再带负号**（`-31` → `31`，`+` 只留给金币/治疗）；`暴击/克制/抵抗/秒杀` 前缀拆成**独立小字号 Label**（`Text/Prefix`，`PREFIX_FONT_RATIO = 0.5` ⇒ 数字 30→15、34→17，水平位按数字实宽反推 `-(宽/2 + 6 + 前缀宽/2)`）—— 单 Label 一条字符串只有**一个**字号，这条需求在单 Label 上无解。
   - 其他玩家单位（`owner !== 'player'`）顶点色相乘 `#828282`（优先级：阵亡 > 其他玩家 > 原色，`if (sprite) ... else if (skeleton) ...`）。
   - 敌我标识 (R25)：阵营**颜色 + 描边**分三处早已闭环 —— 领地填充 `zcFactionColor`（60%）、领地轮廓走**整盘共享的 `ZCOutlineLayer`**（100%）、单位外轮廓 `ZCUnitView.renderOutline` 的 `OWNER_EDGE_COLOR[owner]`（只给非我方未阵亡单位）；**血条四色**是本轮补的：`pickHealthBarFill(owner, player, enemy, enemy2, enemy3)` 五参穷举 `switch`（`default` 只兜 `neutral`），`ZCUnitView` / `ZCHexView` 各加 `@property barFillEnemy3`，紫图用**项目里已有但一直没人用的** `resources/image/buildings/jindutiao_p.png`（`#8b5af5`，与 `enemy3Edge` 同色相系）⇒ 不新增美术；另有一整套尺寸统一的 `buildings/jindutiao_{b,r,y,p}` 全未引用，**刻意不用**它们替换已验收的三张。
   - 自选主城预置玩家默认落点（不消耗随机源），邻格深蓝 `#1D24C8`（alpha 170），借用 `ConfirmSpawn` 绿勾改挂 `mapLayer`（关 Widget、下方 `2 × 90` 行距、销毁前归还），显隐判据用 `isPlacing('player')`。顶栏 `SpawnInfoBand`（663×130）是**三行式**（2026-10-17 线框图）：倒计时数字 **48 号加粗 `y=+35`**（第一行、水平居中）→ 标题 **25 号 `y=-9`** → 进度条 **200×23 `y=-46`**（先按「−35% / −5%」到 259×30，再经用户两次手定 230×23 → 200×23，填充 194×16）。两个坑：① **按视觉高度配字号**，汉字满字高 ≈ 0.95em、数字只有大写高 ≈ 0.72em，所以「数字 30 + 标题 28」其实是标题看着更大（21.6 : 26.6）；② Label 是 `overflow = SHRINK`，框小会**静默把字号压回去**（旧标题框 221 装不下 8 字 × 28 号 ⇒ `_actualFontSize` 实测 22），换字号必须同时放宽框（300×38）且框高 ≥ `lineHeight`。
   - 领地「冒险」页走 `ScrollView` + cellId 复用 + 纯 TS `TerritoryPresenter`；建筑落点 `cellCenter()` 为 `y + HEX_GRID_CONTENT_LIFT(12.5)`，并补偿 trim 偏移、归一可见宽为 `70`。
   - 领地未解锁格「银币图标 + 数值」**成对居中**：图标 ×1.1、数值 ×1.5、间距**恒 2px**（按 `位数` 变长时往左长、图标跟着让位）。间距按**实测文本宽**算，所以数值在条件模式下 `overflow = NONE` + 写完字符串立刻 `Label.updateRenderData(true)` 把布局逼到同一帧；退出条件模式必须还原 `overflow` 与两个缩放（站点节点池化复用）。
   - 领地「获得银币 / 体力」= **格心喷发 + 读数上移**（row17；喷发口径 2026-10-17 细化）：从**点击地块的中心点**（`hex.position.y + HEX_GRID_CONTENT_LIFT`，与 `cellCenter` 同源）喷出 `TERRITORY_GAIN_BURST_COUNT = 12` 个资源图标，**逐颗错峰 `STAGGER = 0.025s`**（12 颗铺开 0.275s ⇒ 绝不与首颗同帧）；出射方向以**屏幕竖直向上为轴左右各 `HALF_ANGLE = 26°`**（`phi = random(-1,1)·半顶角`、`vx = speed·sinφ`、`vy = speed·cosφ`），初速 `650 ±12%`、重力 `GRAVITY = 1500`，轨迹是**抛物线**（`x = vx·t`、`y = vy·t − ½g t²`，顶点 `vy/g`、落回台面 `2vy/g`）。**「倒锥」约束的是出射方向**（`|vx|/vy ≤ tan26°`），**不是**「任意时刻 `|x| ≤ y·tan`」（那是初版径向直线才成立的式子，抛物线上到顶点时 x/y 趋于无穷）；抛物线在落点的水平包络是 `2·tan半顶角·vy²/g`。飞行中 icon **绕自身水平轴上下翻面**：`scaleY = baseScale·cos(2π·flipHz·t + phase)`、`scaleX` 恒为 `baseScale`（余弦过零 = 侧立最窄，负值 = 倒面），`flipHz ∈ [2,4]`、初相随机、**正好用 `setScale(scaleX, scaleY, 1)`、禁正负硬切、禁叠平面自转**；基础缩放 0.8~1.2（初始缩放随机）。收尾**取先到的那条**：落回台面（`y ≤ 0`）即刻 `0.12s` 快速淡出且**位置冻在落点**（不穿模、不贴地滑），或生命 `1.1s ±15%` 到期走末段 `0.25s` 淡出。**图标 + 数字 ui** 在原点**上方 40px**（`TERRITORY_GAIN_START_LIFT_PX`）起飘 1.15s，多条奖励再按 `TERRITORY_GAIN_STACK_GAP_PX = 40` 错开。曲线真源 `model/TerritoryResourceGain`：出射参数 `territoryBurstLaunch(seed, index)`、逐帧 `territoryBurstParticle(seed, index, elapsed)`（零 `cc`；`seed` 每次点击自增，**不许用 `Math.random()`** —— 同一 seed 必须可复现；轨迹用**解析式**而非逐帧累加，否则落点依赖帧率），粒子组是 `view/TerritoryGainBurst`（**纯类**、非 `Component`，`ICON_SIZE = 64`，逐帧 `step` **禁 tween**，收尾判据是「一颗活的都没有」而不是死等上限），容器坐在 `GainLayer` 的**第一个子节点**（`ensureBurstRoot`，子节点顺序 = 渲染顺序 ⇒ 粒子画在读数之下）。**不建 prefab**：一粒只有「一张可换的图 + 位置 / 两个缩放 / 透明度」，图由 `setGainIcons` 注入。判据 `tests/territory-resource-gain.test.ts`（出射角/包络/抛物线/翻面余弦/落地不穿模/错峰 + 粒子组沙箱）。
   - 领地随机资源格「翻开」= **原地快碎裂 → 新地皮从格心放大填充**（`hexShatterFx`，`HEX_SHATTER_SECONDS = 0.68s`）。全程 `tileLift / tileFlip / tileScale` 恒定（需求原文「**原地**」快碎裂），碎裂由 `shaders/hex-flip.effect` 的片元级碎块腐蚀做（`shatterParams.x` 是总开关，为 `0` 时**逐像素等价**「没有碎裂」；碎块划分用格内归一化坐标 `vQuad` = 世界坐标 ÷ 实际半尺寸，**不能用 `a_texCoord`**），新地皮放大写在子节点 `Reveal`（`sizeMode = RAW`，**不动格根**）。旧 / 新两张地皮由 `syncFlip` 显式传入（点击那一帧 `paintHexes` 已换成新地皮），换脸点取 `HEX_SHATTER_ERODE_END`（旧地皮已碎没那一帧）并**每帧重写**以自愈被 `paintHexes` 顶掉的帧。**2026-10-16 用户口径「只保留地块破碎效果的方案」** ⇒ 另一套（抬起后绕水平轴垂直翻转 360°：`hexTurnFx` / `HEX_TURN_*` / 随机点将 `pickHexFlipVariant` / `ZCHexFlipVariant` / `IZCHexFlipFx.tileSin` / `HEX_FLIP_PERSPECTIVE` / `hexFlipBodyGlow`）连同着色器里的**顶点 3D 旋转 + 透视除法 / 体积明暗 / 侧视淡出 / 正面开口补光**四段已**整条删除**（删除**逐像素等价**：碎裂全程 `cos ≡ 1`、`tileLift ≡ 0`；别只把曲线补回来 —— 着色器那几段已经不在了）。判据 `tests/territory-hex-flip.test.ts`（含「方案1 的符号 / uniform / shader 段一律不许残留」的删除守卫）。
   - 领地**建筑生成抖动 + 建筑展示滞后**：随机格翻开时建筑**先不出现**，等这一格翻转播完才冒出来并抖一次。「先 Y 后 X」的 120% 脉冲真源在 **`core/hex/ShakePresentation`**（零 `cc`；`ZCGameViewUtil` 只做转发，领地不许反向依赖 `app/zcds`）。滞后载体是 `ITerritoryStationRender.hidden`（**不能**靠 `icon: null` —— 那会让名称底条/文字/角标三者全亮），只关四个视觉节点的 `active`（站点根节点早已没有视觉子树）；`renderMap` 里 `syncFlip` **必须排在 `syncStations` 之前**（否则建筑会闪一帧再消失），`update` 在 `hexFlip.step` 之后立刻解除待办（同一帧补建筑）。判据 `tests/territory-building-shake.test.ts`。
10. **战斗相机 (R22)**：**倍率真源只有一份** —— 地图 JSON 的 `zoomMin` / `zoomMax` → `resolveZCMapZoom`（缺省 `0.6 / 1.2`，硬边界 `0.3 ~ 1.5`，**越界 / 非数字 / 上下限颠倒一律抛错、不夹取**）→ 模块级 `ZC_MAP_ZOOM_MIN/MAX` → `ZCMatchConfig.map` → `ZCGameHUDView.setMapZoomRange(min, max)`（HUD **不写第二份默认值**）。**改地图字段必须同时改编辑器两处白名单**（`tools/map-editor/app.js` 的导入 `applyLayout` 与导出 `buildJSON()`，白名单式重写，漏一处字段就被吃掉）。两条缩放输入路径（触摸双指 / 桌面滚轮 `× 1 ± ZC_MAP_ZOOM_WHEEL_STEP = 0.12`）共用 `applyMapZoom(scale, anchor?)`：先 `clampMapZoom` 再锚点钉住 `offset' = anchor - (anchor - offset) / scale · scale'`；**双指必须用 `EventTouch.getAllTouches()`**（`getTouches()` 在"一根按住不动、第二根刚落下"时只报第二根 ⇒ 拿不到指间距），参照在 `beginPinch`（落指当帧）记好，锚点必须走 `UITransform.convertToNodeSpaceAR`（`getUILocation()` 是 UI 世界坐标）。**一键复位 = 秒回、不做补间**，复用 `resetMapPosition()`（与开下一局同一条路径），并同时清 `settlementOverviewRequested/Done`，否则 `mapCameraBusy` 常挂、棋盘拖不动；复位点位 `mapOffsetY = -focus.y · scale - ZC_MAP_HOME_CENTER_OFFSET_Y(100)`（**屏幕 Y 轴向上为正**，需求「主城位于中心点下方 100px」）。**全景 / 结算镜头是脚本演出，刻意不受玩家缩放区间约束**（走 `mapOverviewScale` / `mapSettleScale`），否则 `zoomMin = 0.6` 的图看不到全图。视口 `UITransform` 全类只查一次（`mapViewportTransform` 缓存 getter，`initialize` 清缓存）；本工程禁「按名找节点」，`Background` 走 `@property mapBackground`。判据 `tests/zcds-map-declaration.test.ts` / `zcds-hud.test.ts` / `zcds-hud-multiteam.test.ts` / `zcds-rank-board-wiring.test.ts`。
11. **大世界 / 基地建造 (BigMap，2026-10-17)**：范围只做**纯玩家个人战斗**（商店 / 赛季 / 联盟 / 战盟 / 托管 / 战斗加速一律不做）。三条硬约束：① **建筑解锁只来自冒险章节**（`BigMap-建筑配置.unlockChapter` → `bigMapBuildingUnlock`，别处不许再开第二条解锁来源）；② **世界地图是种子生成的纯函数** `buildBigMapWorld(config, seed)` —— 存档只存玩家状态（建筑 / 队列 / 资源 / 占领），**不存地图**，所以 `Math.random()` 在这里是禁区（同一份配置每次进页面地图不同，存档里的格子 id 会全指错）；③ **城池解锁 = 章节 + 开服天数 + 前置城池已占领**，`bigMapAttackCity` 刻意**不接** `IBigMapUnlockContext`（占领集合一律从 `battle.occupiedCityIds` 现取，两套状态各自维护迟早打架）。六边距离的 axial 转换必须是 `r = row - (column + (column & 1)) / 2`（偶数**列**下移半格 ⇒ 对角邻居在下一行；写成 `- (column & 1)` 会让 6 个邻居里有一个算成 2 环，`tests/bigmap-world.test.ts` 的「相邻格距离恒为 1」就是钉这个的）。配置表统一 `BigMap-<中文名>` 共 12 张，由 `tools/config/gen_bigmap_tables.py` **一次性推算生成**（本机无 eSon 源目录），脚本写盘前强校验「表头字段数 == 每行值个数」——字段数与值个数不一致会解压成**整行错位**的脏数据，运行时极难发现。战斗口径：`伤害 = (420 + 180×(主城等级-1)) × 势力范围系数(超出 radiateCapacity=10 格 ⇒ ×0.8)`、`战功 = 3000×(1-e^(-伤害/3000)) × 城池战功倍率 × 名次系数 × 拥挤系数`，**打穿城防 ≠ 占领**（还要 `战功 ≥ minOccupyWarScore`）。界面全代码线框（`BigMapTheme` 的 Graphics 工具 + 两个 View），美术到位只需替换绘制、不动布局；入口是主界面右下角悬浮按钮（`BigMapEntryButton` → `BigMapEntry.open`），页面挂 Canvas 下做覆盖页、切 tab 不销毁。判据 `tests/bigmap-world.test.ts` / `bigmap-base.test.ts` / `bigmap-battle.test.ts` / `bigmap-presenter.test.ts`（共 49 条，断言到具体数值）。

## 命名与风格

- 文件/类：PascalCase 且同名；接口/类型 PascalCase **加 `I` 前缀**，`I` 在最前（`IMailRepository`、`IZCSnapshot`，不是 `ZCISnapshot`）；枚举成员 PascalCase；常量 UPPER_SNAKE_CASE。
- 变量/函数：camelCase；布尔 `is/has/can` 开头；私有字段 `private` + camelCase，**TS 不用 `m_` 前缀**。
- 对局玩法 `zcds` 内类统一 `ZC` 前缀；禁用拼音；禁止 `Utils.ts`/`Common.ts`/`Manager.ts` 收容箱。
- 4 空格/单引号/分号；类型依赖用 `import type`；`unknown` 优于 `any`；玩家可见文案与魔法数移至常量/文本表。

## 代码风格与交付

- 一个文件一个清晰职责；函数名描述意图（`load…`、`build…`、`present…`、`handle…`），避免 `doIt`、`data`、`temp`。
- 注释只说明业务原因、引擎陷阱、兼容性或不变量，不要复述代码；兼容分支注明删除条件。
- 有规则、边界、取消、资源或回归风险的改动必须新增/更新测试；最少运行与改动相关的单测子集或检查命令，并报告实际结果。
- 完成时说明：改了什么、关键架构边界、验证命令与结果、尚未验证的风险。不要把“应该能运行”当作验证。

## 版本库（SVN 与 Git 并存）

- 本仓库**双版本库**：SVN 工作副本根 `D:\City1001`（映射 `https://192.168.2.250:8440/svn/City1001/trunk/Demo3.8`）+ Git 仓库 `D:\City1001\Demo3.8\.git`（GitHub remote）。提交变更时**两库都提交**；SVN 在 `D:\City1001` 根下用 `svn commit Demo3.8 -m …`。
- ⚠️ **SVN 日志禁止中文（实测 2026-10-19）**：本机 TortoiseSVN `svn.exe`（1.14.5）对所有输入字节按 Latin-1 逐字节映射后存 UTF-8——PowerShell 内联、`-F` UTF-8 文件、宽字符 argv 三种通道**全部验证为乱码**（r662–r665），客户端无法存入正确中文。**SVN 提交日志一律 ASCII（英文/拼音）**；中文说明写进提交的文件或 Git 提交信息。
- `svn:ignore`（`Demo3.8` 目录属性）已与 `.gitignore` 对齐：`.superpowers/.codegraph/.codex-artifacts/.codex-tmp/.creative-design/.skill_tmp/.workbuddy/data/outputs`。新增本地工具目录时两处同步。

