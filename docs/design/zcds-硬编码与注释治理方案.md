# zcds 硬编码与注释治理方案

> 状态：在用（2026-11-19 审计）。本文件是方案，未改任何运行代码；剩余事项见 §7 与 §11。

- 日期：2026-11-19
- 范围：`assets/script/app/zcds/**`
- 状态：审计 + 方案（本文件不改任何运行代码）
- 配套清单：[zcds-硬编码与注释清单.csv](zcds-硬编码与注释清单.csv)

## 1. 结论先行

zcds 不是"满屏魔法数"的工程。战斗数值主体已经走 `pvpCard / pvpSkill / pvpSkillPlan / pvpStatus / skillAttrModifier` 等配表，`ZCStatSchema` 也把属性 id 收敛成了一张映射表。真正的问题是**同一个事实存在多个真源**：

1. **战斗数值**：表里有值，代码里又留一份"表没配时兜底"的默认值；两份都像真源，改表还是改代码全靠注释判断。
2. **表现参数**：一个 prefab 的路径、缩放、落点、飞行、朝向、淡出、染色、拖尾、光束配置，被拆在 16 个 `ZC*Fx` 模块和 13 张按路径索引的表里；`ZCVisualResourcePlan` 为此写了 13 段"按行为键补路径"的分支，`ZCGameResourcePlan` 又手工 `paths.add` 了 6 组。每新增一个行为技能，要改 4～5 个地方，漏一处是**静默失效**（技能照常结算、屏幕不播、不报错）。
3. **UI 设计值**：`ZCTheme` 已经集中了主色板，但 view/ui 里还有 89 处 `new Color(...)`（其中 66 处在 `ZCTheme` 之外）、164 处 `setPosition / setContentSize / setScale`；静态布局值仍散落在各 View。
4. **注释**：13,363 行注释（占代码+注释的 30.7%），其中 652 行带日期、188 处"第 N 批"、72 处"用户"、642 处"需求/口径/设计案"。注释在承担**需求档案 + 变更日志 + 美术调参说明**三种职责，而不是代码契约。

治理思路不是"把所有数字抽成常量、把所有注释删掉"，而是：

> **一个事实只留一个真源；代码只保留解释"为什么"的契约注释；需求、批次、调参过程迁到文档或数据表的 `notes` 字段。**

改造顺序：**先补基线 → 表现单一真源 → 战斗默认值与 ID 特判 → UI 主题 → 注释分层 → 拆巨型文件**。全程只做"搬移 / 改名 / 查表"，不改公式、不改时序、不改资源，每阶段单独可回滚。

## 2. 代码实际作用

### 2.1 分层与体量

| 目录 | 文件数 | 行数 | 职责 |
| --- | --- | --- | --- |
| `zcds/*.ts` | 4 | 681 | 入口 `ZCGame`、诊断开关等 |
| `application/` | 13 | 2,323 | 对局入口、加载器、运行时契约、结算、客户端战斗配置 |
| `model/`（不含 systems） | 53 | 15,814 | 快照/状态、配表解析与编译、战斗目录、属性 schema |
| `model/systems/` | 21 | 10,217 | 攻击结算、技能触发、伤害、状态、投射物、移动、索敌、区域等 |
| `view/` | 36 | 13,765 | 六边形棋盘、单位、HUD、渲染世界、特效池与表现参数表 |
| `ui/` | 5 | 761 | 结算、引导、逃跑等面板 |

上表行数为非空行（合计 43,561）；加上 2,685 空行后总计 **46,146 行**。其中代码 30,098 行、注释 13,363 行。

### 2.2 数据流

```
pvpCard / pvpSkill / pvpSkillPlan / pvpStatus / skillAttrModifier ...
        │  ZCPvpTableParser / ZCClientCombatConfig / ZCModifierRuntime
        ▼
ZC_RUNTIME_CONFIG（纯数据，无 cc 依赖）
        │
        ▼
ZCGameModel + model/systems/*（攻击、技能、伤害、状态、投射物、移动、索敌）
        │  snapshot / render frame / combat event
        ▼
view/*（ZCHexView、ZCUnitView、ZCGameHUDView、ZCGameRenderWorld、ZCEffectPool）
```

关键判断：

- **模型层**的绝大多数数值来自配表；代码里的数字分两类：
  1. 物理/几何/时序常量（格距、速度下限、最小间隔等），应命名并集中；
  2. 表缺列时的兜底默认值，应集中且标注"覆盖它的表列名"。
- **表现层**没有配表造型槽。`ZCVisualResourcePlan` 的注释反复出现同一句："行为技能在 `pvpSkill` 里没有造型槽，路径只登记在代码常量里"。这是当前硬编码的总根因。
- **视图层**的动态坐标（世界坐标、格子位置、弹道插值）不属于硬编码，不能为了"零魔法数"把它们搬进配置；只有静态设计值（颜色、字号、固定偏移）适合迁移。

## 3. 现状体检

> 以下为词法扫描估算值（正则统计，误差约 ±5%），用于排优先级，不作为逐行验收依据。

| 指标 | 现状 | 说明 |
| --- | --- | --- |
| TS 文件 / 体量 | 132 个 / 2.4 MB / 46,146 行（含空行） | `model` 占 60% 行数 |
| 注释行占比 | 13,363 / 43,461 = **30.7%** | 56/132 个文件超过 30% |
| 带日期注释 | **652 行**，分布在 69 个文件 | 多数是"2026-xx-xx 用户口径" |
| "第 N 批"注释 | **188 处** | 变更批次写进代码 |
| 含"用户"的注释 | **72 处** | 需求来源写进代码 |
| 含"需求/口径/设计案" | **642 处** | 规格与实现混在一起 |
| 模块级字面量常量 | **359 个** | 尺寸/位置 123、时间 75、比例 33、资源路径 31、其他 94 |
| prefab 路径字面量 | 71 处，唯一路径 35 条 | 14 条路径在 2～4 个模块重复出现 |
| `ZC*Fx.ts` 模块 | **16 个 / 1,550 行 / 86.6 KB** | 多数是"常量 + 取路径函数"；`ZCNeutralRewardFx` 是真正的视图类 |
| 按路径索引的表现表 | **13 张 / 6 个文件 / 约 25 条目** | flight 4 张、placement 5 张、scale/tint/trail/beam 各 1 张 |
| 行为技能注册 | **31 个 `this.register(...)`** | 构造函数约 144 行，注释占大头 |
| `ZCVisualResourcePlan` 补路径分支 | **13 段** `xxxUnits` | 每段 5～7 行，含"漏收静默失效"注释 |
| `ZCGameResourcePlan` 手工注册 | **6 组 `paths.add`** | 每批技能追加一段 |
| 5～6 位 ID 字面量 | 37 处 / 25 个唯一 ID | `68010` 5 处、`30845` 4 处，其余多为配表数据 |
| view/ui 内联颜色 | **89 处 `new Color(...)`，其中 66 处在 `ZCTheme` 之外** | 主色板已集中，战斗飘字/HUD 细节仍未 token 化 |
| view/ui 布局写入 | **164 处** `setPosition / setContentSize / setScale` | 一部分是动态坐标，不应迁移 |
| zcds 相关测试 | **183 个测试文件** | 已有较强的行为回归网 |
| 当前类型检查 | **21 个错误 / 3 个文件** | `chase`、`disengagedUnitIds`、`ZCSkillTargetMode` 缺失，来自在途索敌改动 |
| 当前全量用例 | 6,718 条：6,571 通过 / **147 失败** | `npm run verify` 的基线快照仍是 2026-11-09 的 97 失败，已过期 |
| 在途改动 | **32 个 zcds 文件**，+2,407 / -144 | 不能回退、不能覆盖 |

**前置结论：当前不是可重构的绿色基线。** 21 个类型错误和 147 个失败用例里，有多少是本次在途功能造成、有多少是历史基线，必须先分清。否则"改完没变红"无法证明。

## 4. 硬编码分类与处置

### H1 表现资源的路径与注册（最高优先级）

**现状**

- 16 个 `ZC*Fx.ts` 各自导出 `ZC_XXX_PREFAB_PATH` 和 `zcXxxEffectPath(behaviorKey)`。
- `ZCVisualResourcePlan` 为 13 类行为技能各写一段 `xxxUnits`，再在 `effects` 数组里逐条 `has(unitId) ? PATH : null`。仅这一段就 40+ 行、30+ 行注释。
- `ZCGameResourcePlan` 再按批次手工 `paths.add(...)`：孢爆箭、菌毯爆发、菌丝突刺、冲锋、风弹/飓风、连射导弹……
- 同一个 prefab 被多个模块重复引用。例：`units/projectiles/普攻爆炸/普攻爆炸` 同时出现在 `ZCBurstFx`、`ZCSplashShotFx`、`ZCFanSweepFx`、`ZCAttackResolutionSystem`。

**根因**

`pvpSkill` 只有数值参数槽，没有"造型/特效"槽；行为技能（`blink_strike`、`self_aura`、`bolt_strike`、`chain_damage`、`trap_place`……）在表里甚至没有一行。所以造型只能写在代码里，加载清单只能手工补。

**处置**

建立 `model/ZCEffectCatalog.ts`（纯 TS，不 import `cc`）：

```ts
export interface ZCEffectSpec {
    /** 稳定键：行为键（blink_strike）或 unitId:skillId 或 prefab 路径 */
    readonly key: string;
    readonly prefabPath: string;
    /** 表现总时长；缺省 = 由 prefab clip 决定 */
    readonly seconds?: number;
    readonly nodeScale?: number;
    readonly tint?: readonly [number, number, number];
    readonly anchor?: 'impact' | 'midpoint' | 'source' | 'top';
    readonly liftY?: number;
    readonly layer?: 'ground' | 'air' | 'overlay';
    readonly overlayChild?: string;
    readonly flight?: { readonly mode: 'linear' | 'arc'; readonly speed?: number; readonly fixedSeconds?: number };
    readonly facingDegrees?: number;
    readonly fadeSeconds?: number;
    readonly trail?: { readonly startX: number; readonly endX: number; readonly color?: readonly [number, number, number] };
    readonly beam?: { readonly width: number; readonly canvasWidth: number; readonly fallbackColor: readonly [number, number, number] };
    readonly loadGroup?: 'common' | 'skill' | 'deferred';
    /** 一句话说明，不再写日期/批次/需求原文 */
    readonly notes?: string;
}

export function zcEffectSpecOf(key: string): ZCEffectSpec | null;
export function zcEffectSpecsForBehavior(behaviorKey: string, unitId?: string): readonly ZCEffectSpec[];
export function zcAllEffectPaths(): readonly string[];
```

改造后：

- `ZCCombatEffectScale / Placement / Tint / Flight`、`ZCMissileTrail`、`ZCBeamEffect` 的 13 张表合并为目录条目字段，函数签名不变、内部改成查目录。
- `ZCVisualResourcePlan` 的 13 段 `xxxUnits` 变成一次遍历：按 `skillPlans` 的 `behaviorKey` 取 `zcEffectSpecsForBehavior`，路径自动进集合。
- `ZCGameResourcePlan` 的 6 组手工 `paths.add` 删除，改由 `zcAllEffectPaths()` 枚举；与表扫描结果做并集去重。

**收益**

新增一个行为技能：从"新建 1 个 Fx 模块 + 改 2 个 Plan + 改 3 张表现表 + 写 30 行注释"降为"在目录里加 1 条"。静默漏加载的风险从"每处手工补"变成"目录枚举"。

**风险与对策**

- 目录字段是现有表的并集，必须逐条**等值搬运**；用 parity 测试锁住（见 §7）。
- 同一 prefab 被多条 spec 共用时，`SPEC_BY_PREFAB_PATH` 可能冲突。规则：路径级字段（scale/tint/anchor/flight）必须一致，否则测试报错；不一致说明原表本来就有二义性，先记录再决定。

### H2 按路径索引的表现参数

**现状**

| 文件 | 表 | 条目 |
| --- | --- | --- |
| `ZCCombatEffectFlight.ts` | `FLIGHT_BY_PREFAB_PATH`、`FACING_BY_PREFAB_PATH`、`FADE_BY_PREFAB_PATH`、`MISSILE_FX_BY_UNIT` | 4 / 5 / 4 / 5 |
| `ZCCombatEffectScale.ts` | `NODE_SCALE_BY_PREFAB_PATH` | 10 |
| `ZCCombatEffectPlacement.ts` | `ANCHOR_BY_PREFAB_PATH`、`PROJECTILE_LIFT_BY_PREFAB_PATH`、`LAYER_BY_PREFAB_PATH`、`OVERLAY_CHILD_BY_PREFAB_PATH`、`HIT_FX_SURFACE_LIFT_Y` | 5 张 |
| `ZCCombatEffectTint.ts` | `TINT_BY_PREFAB_PATH` | 1 |
| `ZCMissileTrail.ts` | 拖尾配置 | 2 |
| `ZCBeamEffect.ts` | 光束配置 | 1 |

**处置**：合并进 `ZCEffectCatalog` 的对应字段；原文件降为"兼容 facade"（签名不变，内部 `return zcEffectSpecOfPath(path)?.nodeScale ?? 1`），下一阶段再删除。这样调用点和测试都不用改，先证明数据等价。

**注意**：`ZCCombatEffectScale` 的 200 行注释里有真正的几何换算（"一格 = 92.25×90"、"300 屏上 px 的量级"），把它压成每条 1 行 `notes` + `docs/zcds-表现层与领地规范.md` 的换算附录，不要直接删。

### H3 战斗兜底默认值

**现状**

- `ZCAttackResolutionSystem`：`ZC_LANCE_DEFAULT_DAMAGE_RATE = 0.7`、`ZC_LANCE_DEFAULT_PIERCE_FALLOFF = 0.35`、`ZC_LANCE_DEFAULT_PIERCE_COUNT = 3`、`ZC_LANCE_DEFAULT_SPEED = 700`；`projectileSpeed || 500` 在本文件出现 4 次，`ZCCombatSystem` 与 `ZCCombatEffectFlight` 各还有 1 次。
- `ZCChainLightningFx`：`ZC_CHAIN_FADE_STEP = 0.12`、`ZC_CHAIN_FADE_FLOOR = 0.4`；`ZCWindBarrageFx`：`ZC_BARRAGE_DEFAULT_INTERVAL = 0.4`。同类"表没配就兜底"的常量分散在三个文件。
- 投射物系统另有 `private readonly cellSize = 42`；`ZCAttackResolutionSystem` 里 `LASER_DEATH_RANGE = 18 * 42`。而 `HEX_GRID_LOGICAL_ROW_STEP = 42` 已经在 `core/hex/HexGridLayout.ts` 定义。
- `ZCGameLoader` 的 `ZC_SPAWN_SELECTION_WEIGHT = 11` 用注释解释"11 fixed + 1 select = 50%"，池子一变就漂移。

**处置**

- 新增 `model/ZCCombatDefaults.ts`，按"一族一个默认"分组，每个字段注释只写**覆盖它的表列名**和缺省语义，不写日期/批次。
- 删除重复字面量：`cellSize = HEX_GRID_LOGICAL_ROW_STEP`；`LASER_DEATH_RANGE = ZC_LASER_RANGE_HEX * HEX_GRID_LOGICAL_ROW_STEP`。
- `ZC_SPAWN_SELECTION_WEIGHT` 不抽成"万能配置"。要么按 fixed 图数量动态计算（`K = countFixed`），要么保留常量但把公式写进注释并加测试。**推荐动态计算**，它本来就是派生值。

**边界**：只集中"跨文件共用或表缺列兜底"的常量。`1e-6`、`0`、`1`、数组索引、数学恒等式不抽，抽了只会增加阅读噪音。

### H4 按技能 / 单位 ID 的特判

**现状**

| 位置 | 代码 | 问题 |
| --- | --- | --- |
| `ZCAttackResolutionSystem.ts:2932` | `const LASER_DEATH_RANGE = 18 * 42; if (profile.skillId === 30845) {...}` | 通用 `prepareAttack` 里按技能 id 分支 |
| `ZCCombatEffectView.ts:372` | `if (event.skillId === 30845 \|\| event.skillId === 30846)` | 视图按技能 id 选光束模式 |
| `ZCGameModel.ts:2314` | `if (unitId === '68010') { missileLog(...) }` | 调试诊断写死单位 id |
| `ZCModifierRuntime.ts:601/605` | `unitId === '68010' && ZC_MISSILE_DEBUG_HERO_LEVEL > 0` | 调试开关写死单位 id |

**处置**

- `30845` 的"射线终点延长 18 格"改成技能行上的可选字段 `beamRangeHex`（或 `effectTailHex`），由 `ZCPvpTableParser` 解析；表暂无列时从 `ZC_SKILL_OVERRIDES` 取，值仍是 `18`，行为逐字不变。
- 视图不再读 `skillId`：模型在事件上写 `effectMode: 'beam' | 'projectile'`，视图只读模式。
- `68010` 收进 `ZCMissileSkillDiagnostics.ts` 的 `ZC_DIAGNOSTIC_UNIT_IDS` 集合；业务代码只调 `missileLogUnit(unitId, ...)`，不再出现 ID。

**收益**：通用流程里不再出现"某个技能特殊"，新技能不需要在结算系统里加分支。

### H5 UI 设计值

**现状**

- `ZCTheme.ts` 已有 `ZC_CLIENT_COLORS`（ink/ice/player/enemy/enemy2/enemy3/neutral/ruins/paper/gold/hint/muted/white）与 `zcDeepFactionColor` 等派生函数。
- 但 view/ui 仍有 89 处 `new Color(...)`，其中 66 处在 `ZCTheme` 之外：`ZCHexView` 24、`ZCFloatTextView` 9、`ZCGuideItem` 5、`ZCOutlineLayer` 5、`ZCSpawnSelectionView` 5、`ZCCombatEffectView` 4……
- 164 处布局写入里，大部分是动态坐标（格子、单位、弹道），**不应迁移**；真正该迁的是固定字号、固定偏移、固定尺寸。

**处置**

- 扩展 `ZCTheme` 为语义 token：`ZC_COMBAT_COLORS.damage / heal / shield / goldGain / muted`，`ZC_HUD_COLORS.*`；View 只引用 token，不直接 `new Color`。
- 静态布局值按既有《布局与外观硬编码迁移方案》的规则走：能进 prefab / `@property` 的进 prefab，运行时代码只读；动态坐标保留。
- 不追求"0 处 `new Color`"：带 alpha 的临时插值色、每帧混色仍应在代码里，但必须命名。

### H6 结构常量与重复字面量

- `ZCMapConfig.parseZCMap` 里的 `4 / 60 / 30` 地图尺寸上限没有命名；建议提为 `ZC_MAP_MIN_* / ZC_MAP_MAX_*`，与已有的 `ZC_MAP_ZOOM_HARD_*` 放一起。
- `ZCProjectileSystem.cellSize = 42`、`LASER_DEATH_RANGE = 18 * 42` 应直接引用 `HEX_GRID_LOGICAL_ROW_STEP`。
- `ZCGameViewUtil` 的几何常量已经正确从 `HexGridLayout` 派生（如 `ZC_HEX_COLUMN_SPACING = HEX_GRID_VIEW_COLUMN_SPACING`），这部分保持不动。要核对的是各 View 内仍直接写死的 `128 / 142 / 94` 这类尺寸，凡是能与 `HEX_GRID_*` 建立比例关系的，改为派生；纯美术定稿值保留并命名。

## 5. 注释分类与处置

### 5.1 四类注释

| 类型 | 特征 | 处置 | 例子 |
| --- | --- | --- | --- |
| C1 契约/不变量 | 解释"为什么必须这个顺序""缺省意味着什么""池化复用要复位什么" | **保留**，压到 ≤3 行 | `ZCCombatEffectView` 的 tint 快照说明；`ZCUnitState` 的 `summonUntil` 缺省语义 |
| C2 需求/设计档案 | 日期、"用户口径"、"第 N 批"、设计案原文 | **迁文档**，代码只留稳定锚点（如 `101003`） | `ZCCombatEffectScale` 每条特效的 5～10 行调参史 |
| C3 变更日志 | "原先…后来…已移除…改成…" | **迁 changelog**，代码删除 | `ZCCombatEffectView` 里"原 beamBaseScaleY 已被移除" |
| C4 复述/逐步解说 | 把下一行代码用中文再说一遍 | **删除** | `// 遍历单位`、`// 返回结果` |

### 5.2 量化现状

- 13,363 行注释里，带日期 652 行、带"第 N 批" 188 处、带"用户" 72 处。
- "同一口径" 33 处、"同源" 30 处、"同一个理由 / 同一条理由" 14 处：同一套解释在多文件重复，改一处口径会留下多份过期说明。
- 单文件注释占比最高：`ZCGameTypes` 61.2%、`ZCGameViewUtil` 53.1%、`ZCHexView` 41.5%、`ZCGameHUDView` 39.1%、`ZCGameRenderWorld` 36.1%。
- `ZCSkillRuntime` 构造函数约 144 行（第 45～188 行），其中大部分是每个行为键的 5～15 行说明；`ZCCombatEffectScale` 249 行里约 200 行注释；`ZCSkillTriggerSystem` 的上下文接口每个 `castXxx` 都带日期与批次。

### 5.3 治理规则（落到评审清单）

1. 文件头 ≤12 行：职责、数据来源、不变量、禁止事项；**不写日期、批次、需求原文**。
2. 行内注释 ≤3 行：只写"为什么"，不写"是什么"；相邻代码已能表达的删除。
3. 代码中禁止 `20\d\d-\d+-\d+`、"第 N 批"、"用户反馈"、"原先/后来/已移除"这类变更叙事。
4. 需要保留的设计知识，进现有 `docs/design/技能全量研发档案_20261116.md`（行为键 → 车道/触发/结算入口/美术口径）或现有 `docs/zcds-表现层与领地规范.md` 的特效章节/附录（prefab → 尺寸/格距换算/染色原因）。代码里只留 `notes` 一句话。
5. 数据表条目用 `notes?: string` 承载一句话说明，不再在表上方堆 10 行注释。
6. 不做全量重写。采用"触达即治理"：因其他需求打开某文件时，顺手把它降到规则线；配合扫描工具防新增（见 §7.4）。

### 5.4 预期效果（保守估计）

| 位置 | 现状注释 | 治理后 |
| --- | --- | --- |
| 16 个 `ZC*Fx` 模块 | 约 700～900 行 | 目录 `notes` 约 30～40 行 + 1 篇调参文档 |
| `ZCCombatEffectScale` | 约 200 行 | 文件头 5 行 + 每条 1 行 notes |
| `ZCSkillRuntime` 构造函数 | 约 150 行 | 行为矩阵文档 1 张表 + 每行 1 句 |
| `ZCVisualResourcePlan` 13 段分支 | 约 120 行 | 一次遍历 + 10 行说明 |
| `ZCGameResourcePlan` 6 组手工注册 | 约 40 行 | 2 行枚举 |
| `ZCGameTypes` 字段注释 | 799 行 | 先压到约 400～500 行（保留缺省/互斥语义，删批次与历史） |

整体注释占比目标：**30.7% → 20% 左右**，不追求更低；契约注释是资产，不是负债。

## 6. 目标结构

```
model/
  ZCCombatDefaults.ts        # 表缺列时的兜底默认值（一族一条，注明覆盖列）
  ZCEffectCatalog.ts         # prefab 路径 + 缩放/落点/飞行/染色/拖尾/光束/加载组
  ZCSkillBehaviorTable.ts    # 31 个行为键：stateMode + 车道 + 一句话说明
  ZCGameTypes.ts             # 只留类型与契约注释
systems/
  ZCAttackPrepare.ts         # 从 ZCAttackResolutionSystem 抽出的纯准备逻辑（后续阶段）
  ZCAttackArea.ts
  ZCAttackStructure.ts
view/
  ZCTheme.ts                 # 语义色板（扩展）
  ZCCombatEffectScale.ts     # 兼容 facade，内部查 catalog（过渡期后删除）
  ...
```

**非目标**：

- 不把所有常量塞进一个 `ZCConstants.ts`。超过 50 条的"常量坟场"和散落一样难维护。
- 不把表现参数迁成 JSON。当前用 TS 数据模块可保留字面量类型、编译期查错、无需运行时解析；只有设计师需要脱离代码调参时，才考虑导表。
- 不把动态坐标、每帧插值、池化临时量搬进配置或 prefab。

## 7. 分阶段实施

### P0 基线闭合与护栏（0.5～1 天）

**必须先做**，否则后续所有验证都无效。

1. 确认在途 32 个 zcds 文件属于用户当前功能，**不 stash、不回退、不格式化**。
2. 处理 21 个类型错误：`ZCUnitState` 缺 `chase` / `disengagedUnitIds`，`ZCSkillRuntime` 缺 `ZCSkillTargetMode` 导出。先随当前功能补齐，或确认这些错误就是未完成部分。
3. 跑 `npm run verify`（不是 `npm test`），记录相对旧基线的**新增**失败；旧基线 `tmp/verify/baseline.json` 是 2026-11-09 的 97 失败 / 5,244 用例，已过期。
4. 在绿灯（或"错误集合已确认归属"）后执行 `npm run verify:baseline` 刷新基线，再开始改结构。
5. 建议加一条确定性对局快照测试：固定 `ZCSeededRandom` 种子 × 3 组阵容 × 60 逻辑秒，序列化 `ZCSnapshot` 后取哈希。它比单测更能在"搬移数据"时证明行为没变。

**交付**：基线记录（测试数/失败数/tsc 错误数）+ 一份"在途改动归属"说明。
**回滚**：本阶段不改代码。

### P1 表现单一真源（2～3 天，收益最大）

1. 新建 `ZCEffectCatalog.ts`，先只放**类型 + 空目录 + 查询函数**，不接线。
2. 逐表搬运：`ZCCombatEffectScale` → `nodeScale`；`ZCCombatEffectPlacement` 的 4 张路径表 → `anchor/liftY/layer/overlayChild`（命中面抬升保留独立函数）；`ZCCombatEffectFlight` 4 张 → `flight/facingDegrees/fadeSeconds/missile`；`ZCCombatEffectTint` → `tint`；`ZCMissileTrail` → `trail`；`ZCBeamEffect` → `beam`。
3. 写 parity 测试：对每张旧表的每个 key，断言目录返回值与旧表**严格相等**（数字用 `===`，颜色用现有 `[r,g,b]` 三元组逐通道相等）。
4. 旧模块改成 facade：导出签名不变，内部查目录。跑全部 zcds 特效相关测试（`zcds-hit-fx-size`、`zcds-combat-effect-placement`、`zcds-effect-tint`、`zcds-combat-effect-flight`、`zcds-missile-trail`、`zcds-beam-effect` 等）。
5. 接 `ZCVisualResourcePlan`：删除 13 段 `xxxUnits`，按 `behaviorKey` 从目录取 specs；保留"表字段直收"的部分（普攻/强化/副轨）。
6. 接 `ZCGameResourcePlan`：删除 6 组 `paths.add`，改为 `zcAllEffectPaths()` 与表扫描并集。
7. 删除已无引用的 `ZC*Fx` 常量模块；`ZCBlinkCastFx / ZCSelfAuraFx` 等若还有"按行为键返回路径"的调用，保留薄函数，内部查目录。
8. 跑 `npm run verify`，对比基线；资源路径数量必须**不变**（新增 0、缺失 0）。

**验证重点**：`buildZCBattleWarmupPaths` 与 `buildZCVisualResourcePlan` 的输出集合逐路径相等。建议加一条"路径集合快照"测试，把改造前的输出写入 fixture，改造后断言完全一致。

**回滚**：P1 是纯数据搬运；单 commit 回退即可。旧模块 facade 保证中途任何一步都能编译。

> **执行状态（2026-11-19）**：P1 第 1～4 步已完成，范围限定为 `ZCCombatEffectScale` / `ZCCombatEffectPlacement` / `ZCCombatEffectFlight` / `ZCCombatEffectTint` 四张核心表。目录落在 `assets/script/app/zcds/model/ZCEffectCatalog.ts`，parity 基线落在 `tests/fixtures/zc-effect-catalog-baseline.json`。`ZCMissileTrail → trail`、`ZCBeamEffect → beam` 与资源清单接线（第 5～8 步）尚未开始。

### P2 战斗默认值与 ID 特判（2～3 天）

1. 新建 `ZCCombatDefaults.ts`，搬运 lance / chain / wind / projectile speed / spawn-death 时长等默认值；每个字段注释只写"覆盖列名 + 缺省语义"。
2. `ZCProjectileSystem.cellSize`、`LASER_DEATH_RANGE` 改用 `HEX_GRID_LOGICAL_ROW_STEP`；删除 `18 * 42` 里的裸 42。
3. `ZC_SPAWN_SELECTION_WEIGHT` 改为按 fixed 图数量动态计算，并加测试断言当前池仍为 50%。
4. `30845` 射线延长：新增 `ZC_SKILL_OVERRIDES`（key: skillId），先保持 18 格；`prepareAttack` 删除 id 分支，读 profile 字段。
5. 视图：事件增加 `effectMode`，`ZCCombatEffectView` 删除 `30845/30846` 判断。
6. `68010`：收进诊断模块的 `ZC_DIAGNOSTIC_UNIT_IDS`，业务代码只调 `missileLogUnit`。
7. `ZCSkillRuntime` 构造函数改为遍历 `ZC_SKILL_BEHAVIORS` 数据表（31 行 → 31 条 `{ key, stateMode, lane, notes }`），注册逻辑不变。

**验证**：技能相关测试 + 战斗快照；`30845` 的射线终点与持续时间必须逐值相等（18 格、`756 / speed`）。

### P3 UI 主题与静态布局（1～2 天）

1. 扩展 `ZCTheme`：把 view/ui 里重复出现的语义色抽成 token；先处理出现 ≥2 次的颜色，一次性颜色保留并命名。
2. 按既有《布局与外观硬编码迁移方案》迁移静态字号/偏移/尺寸；动态坐标不动。
3. `ZCHexView` 顶部已有命名的常量保留，未命名的内联值按"同文件同用途"分组命名；不追求逐像素外置。
4. 用截图/关键界面做视觉比对（战斗 HUD、棋盘、结算），确认颜色与布局零变化。

### P4 注释分层治理（2～3 天 + 持续）

1. 先落规则（§5.3），不做全量删除。
2. 在现有 `docs/design/技能全量研发档案_20261116.md` 增加"行为键矩阵"章节（键 / 所属技能 / 触发 / 结算入口 / 美术口径 / 已知坑），承接 `ZCSkillRuntime` 的注册注释与 `ZCSkillTriggerSystem` 的上下文接口注释；不另起一份平行文档。
3. 在现有 `docs/zcds-表现层与领地规范.md` 补"特效调参附录"（prefab 路径 / 尺寸 / 格距换算 / 染色原因 / 时长），承接 `ZCCombatEffectScale`、`ZCCombatEffectFlight` 的调参史；不另起一份平行文档。
4. 删除 15 个常量型 `ZC*Fx` 模块后，其头部注释自然消失（`ZCNeutralRewardFx` 是视图类，保留）；`ZCGameResourcePlan` 的批次叙事随手工注册一起删除。
5. 对 `ZCGameTypes`、`ZCHexView`、`ZCGameRenderWorld` 采用"触达即治理"：只在本次改动涉及的字段/函数上压缩，不做大规模重排。
6. 加扫描工具 `tools/verify/zcds-comment-budget.mjs`：
   - 禁止注释中出现 `20\d\d-\d+-\d+`、`第\s*\d+\s*批`、`用户反馈`；
   - 文件头块注释 >40 行报新增；
   - 单文件注释占比 > 基线 + 5% 报新增；
   - 基线放 `tools/verify/zcds-comment-baseline.json`，只拦新增，不要求一次清完。

### P5 巨型文件拆分（4～6 天，可选后置）

按"纯函数先出、类保留 facade"的顺序，一次只拆一个文件：

| 文件 | 行数（含空行） | 拆分建议 |
| --- | --- | --- |
| `ZCAttackResolutionSystem.ts` | 3,640 | `prepareAttack` / 弹道创建 / 区域技能 / 建筑伤害 四块；类保留同名静态方法转发 |
| `ZCSkillTriggerSystem.ts` | 2,529 | 被动、主动、空间/区域三条车道分文件；`tick` 只做编排 |
| `ZCGameModel.ts` | 2,815 | 召唤/光环、建筑伤害、攻击上下文构建分文件 |
| `ZCGameRenderWorld.ts` | 2,416 | 特效系统、出生选择、装饰/胜利扫场分文件 |
| `ZCHexView.ts` | 2,381 | 资源图标、建筑、血条、集火按钮分文件 |
| `ZCGameHUDView.ts` / `ZCGameViewUtil.ts` | 1,181 / 1,180 | HUD 分块；几何/布局纯函数分文件 |
| `ZCModifierRuntime.ts` | 870 | 配表编译、技能筛选、诊断分离 |
| `ZCStatSchema.ts` | 1,213 | schema 定义与运行时查询分离（数据表本身保留） |

拆分规则：**只移动、不改写**；公开签名不变；每个文件单独一个 commit；每拆一个跑一次 `npm run verify`。

## 8. 不影响现有逻辑的保障

1. **Move-only 原则**：搬移 commit 里不允许出现公式、比较、时序、资源名的变化。评审时对含 `+ - * / %`、`>`、`<`、`&&`、`||` 的改动行单独看 diff。
2. **Parity 测试**：目录 vs 旧表、默认值 vs 旧常量、行为表 vs 旧注册，逐键严格相等。
3. **路径集合快照**：`buildZCBattleWarmupPaths` / `buildZCVisualResourcePlan` 的输出写入 fixture，改造前后集合完全一致（顺序可不定，集合必须相等）。
4. **确定性对局快照**：固定种子与阵容，改造前后 `ZCSnapshot` 哈希一致；覆盖普攻、技能、召唤、状态、建筑伤害各一条。
5. **现有 183 个 zcds 测试文件**：每个阶段跑相关子集，阶段末跑 `npm run verify`。
6. **性能护栏**：改动涉及特效池/渲染循环时，跑 `zcds-hotpath-allocation`、`zcds-render-performance`，确认没有新增每帧分配。
7. **不改公开契约**：`ZCEffectCatalog` 是新增模块；旧函数签名保留为 facade；事件字段只增不减，缺省值等于旧行为。
8. **可回滚**：每阶段独立 commit，无数据迁移、无 prefab 改动、无配表改动；回退即恢复。

**不能接受的"证明"**：

- "代码看起来一样"——必须有测试或快照。
- "全量测试本来就是红的，所以没回归"——必须用 `npm run verify` 对比基线，不能用 `npm test` 的红绿当结论。
- "注释删了不影响运行"——注释里的不变量可能正是后来人避免踩坑的唯一线索；先迁移，再删。

## 9. 验收指标

| 指标 | 现状 | 目标 |
| --- | --- | --- |
| 新增行为技能的改动点 | 4～5 个文件（Fx + 2 Plan + 3 表） | 1 个目录条目（+ 必要时 1 条行为键） |
| 重复 prefab 路径 | 14 条 | 0 条（目录唯一） |
| `ZCVisualResourcePlan` 补路径分支 | 13 段 | 0 段（目录遍历） |
| `ZCGameResourcePlan` 手工 `paths.add` | 6 组 | 0 组 |
| 按路径索引的表现表 | 13 张 / 6 文件 | 1 张目录 / 1 文件 |
| 裸 `42` / `18 * 42` | 2 处 | 0 处（引用 `HEX_GRID_LOGICAL_ROW_STEP`） |
| 通用流程里的技能 ID 分支 | 4 处（30845 ×2、68010 ×2） | 0 处（数据字段/诊断集合） |
| 代码中的日期/批次注释 | 652 行 / 188 处 | 0（迁文档） |
| 整体注释占比 | 30.7% | ≤20%（重点文件 ≤25%） |
| 类型检查 | 21 错误 | 0（P0 完成） |
| 用例 | 147 失败 | 相对基线零新增；P1/P2 后不增加 |
| 战斗快照哈希 | 未建立 | 3 组种子 × 3 阵容稳定一致 |

## 10. 边界与反模式

1. **不要把所有数字常量化**。`0/1/-1`、数组索引、`1e-6`、`Math.PI` 附近的推导值，命名只会增加噪音。
2. **不要建"常量坟场"**。常量应靠近使用点；只有跨 ≥2 个模块共享、或表缺列兜底的值才上移。
3. **不要把 TS 数据表换成 JSON**。当前 TS 目录有类型检查、可被测试直接 import、无需运行时解析；除非设计师明确要求脱离代码调参，否则不导表。
4. **不要为了"统一"改资源路径**。prefab 路径是资产契约，搬移必须逐字不变。
5. **不要批量删注释**。先分类，再迁移，最后删；契约注释是维护资产。
6. **不要手改 prefab / meta**。涉及 prefab 的静态布局迁移必须走 Cocos 编辑器 / Funplay Cocos MCP。
7. **不要在红基线上重构**。P0 未完成前，任何"零回归"结论都不可信。
8. **不要覆盖在途改动**。当前 32 个 zcds 文件有未提交修改，任何自动化重排/格式化都可能吞掉用户代码。

## 11. 建议的第一个可执行切片

如果只做一件事，做 **P1 的 1～4 步**：

1. 新建 `ZCEffectCatalog.ts`（类型 + 空表 + 查询）。
2. 搬 `ZCCombatEffectScale` / `Placement` / `Flight` / `Tint` 四张核心表。
3. 写 parity 测试并跑相关特效测试。
4. 旧模块改 facade，不动任何调用点。

这一步不改任何结算逻辑、不改资源、不改 prefab，却能把"一个 prefab 的路径/缩放/落点/飞行/染色/拖尾/光束 7 类参数"收敛成 1 条记录，是后续 13 段分支和 6 组手工注册的前置条件。

## 附：关键证据索引

| 证据 | 位置 |
| --- | --- |
| 行为技能无造型槽、13 段补路径分支 | `model/ZCVisualResourcePlan.ts:86-209` |
| 按批次手工注册加载路径 | `model/ZCGameResourcePlan.ts:70-103` |
| 16 个 Fx 模块与路径常量 | `model/ZC*Fx.ts`、`view/ZCNeutralRewardFx.ts` |
| 按路径索引的 13 张表 | `model/ZCCombatEffectFlight.ts:82-319`、`view/ZCCombatEffectScale.ts`、`view/ZCCombatEffectPlacement.ts:29-233`、`view/ZCCombatEffectTint.ts`、`view/ZCMissileTrail.ts`、`view/ZCBeamEffect.ts` |
| 技能 ID 特判 | `model/systems/ZCAttackResolutionSystem.ts:2930-2942` |
| 单位 ID 诊断特判 | `model/ZCGameModel.ts:2312-2317`、`model/ZCModifierRuntime.ts:596-610` |
| 视图技能 ID 特判 | `view/ZCCombatEffectView.ts:372` |
| 裸格距 42 | `model/systems/ZCProjectileSystem.ts:79`、`model/systems/ZCAttackResolutionSystem.ts:2932` |
| 行为键注册与长注释 | `model/ZCSkillRuntime.ts:45-188` |
| 主色板 | `view/ZCTheme.ts:7-44` |
| 地图尺寸内联上限 | `model/ZCMapConfig.ts:432-440` |
| 类型字段的长注释 | `model/ZCGameTypes.ts:149-229`（该文件 799 行注释） |
| 验证基线 | `tmp/verify/baseline.json`（2026-11-09：97 失败 / 5,244 用例） |
