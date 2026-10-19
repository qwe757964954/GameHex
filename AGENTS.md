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
| 单位出生抖动 / 建筑产兵与产金抖动 | `docs/zcds-表现层与领地规范.md` §1.4、§9.5 | `tests/zcds-unit-spawn-shake.test.ts`、`tests/zcds-building-spawn-shake.test.ts` |
| 新扩展邻格延迟展示与描边同步 | `docs/zcds-表现层与领地规范.md` §1.4、§9.2 | `tests/zcds-hex-neighbor-reveal-delay.test.ts` |
| 特效缩放（出生 / 受击 / 阵亡 `_lscale`） | `docs/zcds-表现层与领地规范.md` §1.5 | `tests/zcds-hit-fx.test.ts` |
| 传说卡出场横幅 (`ZCGameLegendBanner`) | `docs/zcds-表现层与领地规范.md` §2、§9.4 | `tests/zcds-legend-banner.test.ts` |
| 「冒险」领地页 (`app/territory/**`) | `docs/zcds-表现层与领地规范.md` §3 | `tests/territory-presenter.test.ts`、`tests/territory-page-split.test.ts`、`tests/territory-cell-center-align.test.ts` |
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
   - 出生/受击/阵亡特效的显示大小**由 Prefab 根 `_lscale` 唯一决定**（受击/出生基准屏宽 ~110px；**阵亡特效唯一例外**，`0.16448` 屏上 `88×179.6`，严禁改回 110px）；`playSpawnFx` 禁写 `setPosition`，`playDeathFx` 禁写 `scale`。
3. **资源图标抬层与落点**：中立资源图标由 `setResourceIconRaised` 抬至 `ResourceLayer`，坐标经 `applyIconPosition` 补偿；地块类型图标不抬（局部 `y = 4`）；兵团资源点 `RESOURCE_UNIT_POS_Y = 12`。
4. **地块激活（1.856s = 点击动画 0.7s + 卡牌 1.156s）**：① 点击动画段脉冲与缩没**并发**（`hexPulseShrinkFx`，`tileLift` 恒 0 零位移；格根 `tileScale` 单调减至 0.1；波纹层抵消父缩放向外扩至 1.25 并经每格克隆的 `hex-pulse.effect` 做径向虚化与 `pulseEdgeFloor = 0.72` 边缘抬亮）；② 卡牌在 `ZC_CARD_START_SECONDS (0.7s)` 当帧显形并按 `elasticPopScale` 弹出（起点前 `node.active = false`）；③ 卡牌淡出窗（最后 38% = 0.43928s）内建筑同拍由 0.15 长到 1（0.36s）。
5. **新扩展邻格按住窗 (row6 + row9)**：`canDevelop` 由假变真时延后 `ZC_HEX_NEIGHBOR_HOLD_SECONDS = ZC_CARD_START_SECONDS + 0.2`，由 public `resolveDevelopableHold` 统一拦截**图标、价格与共享领地描边**，确保描边与图标同帧出现。
6. **单位与建筑抖动 (row5 + row12 + row13)**：均走 `spawnShakePulse`（先 Y 后 X 各 0.12s）且挂 `renderDynamic`；单位出生拉伸 `0.1`（110%），建筑产兵（`barracks`）与产金（主城/金矿，挂 `economyContext.grantGold` 经 `drainBuildingShakes` 取走即空）拉伸 `0.2`（120%），乘入 `applyBuildingScale`。
7. **开局归属扩散波 (row15)**：仅自选主城局 `finishSpawnSelection` 触发，**先 `render(model)` 再 `startTerritoryClaimWave(model, selection)`**；开局归属格（主城+6邻格）一帧到位**不入波**，本半区中立可通行格按 BFS 环号 + 极角 `(-π, π]` + 幂次 `r^0.65` 加速扩散，经 `setClaimWave` 绕过指纹闸门做 0.1s 过渡，收工清空 `contentKey`。
8. **胜利结算三段式扫场 (row8)**：方向按**赢家身份**定（`player` 从下往上 `maxRow - row`，其余 `enemy/enemy2/enemy3` 从上往下 `row - minRow`）；① 深色铺场（`zcDeepFactionColor` 纯 RGB 先 clamp 再乘 `ZC_DEEP_DARKEN = 0.9`，叠加 0.15s 三角波 `zcTowardWhite` 闪烁）→ ② 铺过 `LEAD_ROWS = 2` 步（屏上 3 行深色带）即从起点回正（只偏深色端，`mix = 1` 自动停闪并剔出指纹）→ ③ 回正结束后在 `OutlineLayer` 扫过一道 4 档量化的线条脉冲（`PULSE_STEP_SECONDS = 0.035s/行`，轮廓探针步长 **4**，`MAX_BUCKETS = 16`）。
9. **金矿提示 (row10) / 传说横幅 (row11) / 飘字 (row14) / 敌方置灰 / 自选基地 / 领地台面**：
   - 金矿开局 4.4s 整圈金边闪烁（`zcNeutralHintAlpha`，末段 `(1-u)²` 包络，画在每格 `TerritoryOutline`）。
   - 传说横幅（`tier === 4`）挂 HUD 根 `overlayLayer`，一律从左往右扇入，结束后 `Role` 相对静止位（`y = -28.24`）从 `+80` 经 0.7s `easeOutCubic` 落回并改 `roleSprite.color.a`。
   - 战斗飘字前 `0.45` 入场（位移/缩放/金币自转全喂 `enter`），后 `0.55` 线性淡出并带 `driftDistance = 7` 同向收尾漂移（与 `ZCGameFloatText.prefab` 序列化值同步）。
   - 其他玩家单位（`owner !== 'player'`）顶点色相乘 `#828282`（优先级：阵亡 > 其他玩家 > 原色，`if (sprite) ... else if (skeleton) ...`）。
   - 自选主城预置玩家默认落点（不消耗随机源），邻格深蓝 `#1D24C8`（alpha 170），借用 `ConfirmSpawn` 绿勾改挂 `mapLayer`（关 Widget、下方 `2 × 90` 行距、销毁前归还），显隐判据用 `isPlacing('player')`。
   - 领地「冒险」页走 `ScrollView` + cellId 复用 + 纯 TS `TerritoryPresenter`；建筑落点 `cellCenter()` 为 `y + HEX_GRID_CONTENT_LIFT(12.5)`，并补偿 trim 偏移、归一可见宽为 `70`。

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
