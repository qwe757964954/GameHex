# zcds 索敌机制落地方案

> 状态：已实施（2026-11-18）。本轮确认口径与实现见下；§2～§8 保留实施前评估用于追溯，冲突处以本轮口径为准。验证结果及未覆盖范围见 §9；卡牌价值首版、源表与导出见 §10。

## 本轮实施口径（2026-11-18 用户确认）

- B1～B4 全部实施，单 Agent 在当前工作区实现、两人只读复核，保留既有技能改动。
- 保持合法锁定；重新索敌时仇恨目标平方距离评分 ×0.25，同分保留当前目标，再取 id 小者。
- 射程采用 A：`(attackRange + targetBodyRadius * 0.5) * combatDistanceScale`；美术远近程分类阈值保持原样。
- 追击单位以起点为中心最多 3 格、最多 5 秒；任一上限到达则沿现有行军逻辑前进。脱战对象重新进入普攻范围才能再锁；状态随快照保存。
- 技能复用数值参数袋，按车道配置 Range / All；无合法敌方单位不消费 CD。冲锋空挥耗 CD 的既有规则保留。

### 实施与验证清单

- [x] B1：中立怪物缓存与前置闸门、技能范围查询惰性求值；基准 digest 与改前一致。
- [x] B2/B3：锁定、仇恨同分规则、射程 A；更新行为回归及射程对照。
- [x] B4：追击上限、重接敌和快照校验；技能独立选敌及参数编译链路。
- [x] 诊断与交付：默认关闭的目标切换日志、完整索敌分项探针、受影响测试、类型与目录检查；记录实际结果。

实现沿用 `ZCUnitTargeting` / `ZCUnitSystem` 与现有技能参数编译器，不增加第二套战斗状态机或跨端表列。测试直接调用真实实现，重点覆盖怪物唤醒/死亡/恢复缓存、目标合法性与空中单位、超时后重复锁敌、旧快照及非法新字段、技能无目标不扣 CD。

参考设计为旧客户端 `TF_SystemTarget` 索敌机制总览（2026-11-17 由山猫提供截图，未入库）；以下为实施前评估。

## 1. 目标与范围

**目标**（按收益排序）

1. 砍掉每帧每单位对全图地块的空转扫描（实测占逻辑 tick 28.6%）。
2. 修掉「锁定」语义自相矛盾：`idle` 保持锁定，`startAttack` 又重选最近，实际每拳换目标。
3. 让仇恨（`hatredUnitId`）与优先级真正影响选择，而不是只进候选池。
4. 给射程判定一个自洽口径（当前远程比配置短、近战比配置长）。
5. 补上脱战上限与技能独立目标选择（体验向，需策划定价）。

**范围**：`ZCTargetingSystem`、`ZCUnitTargeting`、`ZCUnitSystem` 的目标相关分支、`ZCSkillTriggerSystem` 的触发闸门、`ZCNeutralFeatureSystem.priorityTarget`。

**不在本次范围**：BFS 寻路与邻居排序缓存（实测仅占 2.5%）、空间索引 / 跨拍目标缓存（失效因素覆盖不全，见 `zcds-performance.md` P2-8 结论）、技能数值与平衡。

## 2. 现状

### 2.1 流程

| 阶段 | 入口 | 触发条件 | 说明 |
| --- | --- | --- | --- |
| 优先级闸门 | `ZCUnitTargeting.refreshPriorityTarget` | `ZCUnitSystem.updateUnit` 每步每单位无条件调用（死/硬控/冲刺/冲刺冷却除外） | 焦点怪物 → 直接锁建筑；被唤醒怪锁定 → 反打攻击者；PVE 玩家 → 优先单位 |
| 候选池 | `ZCTargetingSystem.acquire` | `target` 态每步、`startAttack` 每拳、`refreshPriorityTarget` 内 | 仇恨目标（5s 内）+ 敌方 owner 桶全量 + 预分组地块桶 |
| 筛选 | 同上 | — | 跳过自身 / 同 owner / 死亡 / `hp<=0`；`!canAttackAir` 跳过 flying |
| 排序 | 同上 | — | 唯一键：平方距离最小；平局取 `id` 小。单位与地块共用同一个 `bestDistance` |
| 锁定 | `ZCUnitSystem` `lockedAndFighting` | `battleState==='idle'` 且 `current()` 非空 | 跳过 `acquire`，保留当前目标 |
| 出手 | `ZCUnitSystem.startAttack` | 冷却到点 | **先 `acquire()` 重写目标**，再校验射程 |
| 丢失 | `damageUnit` 清三字段 / `current()` 返 null | 死亡、失去合法性、超出 1.3× 射程 | 走 `target` → `moveForward` |
| 追击 | `ZCUnitSystem.move` | 目标超距 | 同格直线逼近；跨格 BFS 一步；无追击上限 |
| 技能闸门 | `ZCSkillTriggerSystem.tick` | 每步每单位，循环顶部无条件计算 `release` | 光环/连发/副轨共用 |

`current()` 的合法性校验按目标类型分三支：`unit` 判死亡/同阵营/flying；`wall` 判 `hasExposedWall`；`building` 判 `isZCAwakeMonster` 或「非中立、非己方、`building!=='none'`、`hp>0`、`wallHp<=0`」。

### 2.2 参数

| 参数 | 现值 | 位置 |
| --- | --- | --- |
| 逻辑步长 | 0.05s（20Hz） | `ZCGameModel.ZC_SIMULATION_STEP_SECONDS` |
| 仇恨时长 | 5s，受击刷新 | `ZCDamageResolutionSystem.HATRED_SECONDS` |
| 脱锁滞回 | 1.3× | `ZCTargetingSystem.isOutOfRange` |
| 射程口径 | `attackRange<=100`：`attackRange+目标体半径`；`>100`：`attackRange×0.9`（不加体半径） | `ZCTargetingSystem.attackReach` |
| 建筑 / 城墙目标体半径 | 80（固定） | `ZCUnitTargeting.STRUCTURE_TARGET_BODY_RADIUS` |
| 攻后摇 | 0.15~0.3s 随机 | `ZCUnitSystem.SOLDIER_WAIT_*` |
| 冲刺 | 距目标 ≤`chargeDistance` 起冲，撞点即结算，冲空也吃冷却 | `chargeReach` / `tryStartDash` |
| 扇形副轨 | 默认 120°、半径 1.4×普攻射程 | `castFanSkill` |

### 2.3 参考设计差异

| 参考图机制 | 现状 | 影响 |
| --- | --- | --- |
| `Score = D²×(1+InterestPenalty)` 评分 | 无评分，纯距离 | 无法表达威胁 / 价值 / 可斩杀 |
| 兴趣度 `INTERESTED_COUNT`（0-1 无惩罚，≥4 惩罚 4） | 缺失 | 全军集火同一目标，无自然分散 |
| 仇恨目标提升优先级 | 仇恨只进候选池，仍按距离比 | 被打不还手 |
| 4 类 `skillRange` 分道（Wall / Notify / Range / All） | 技能全部复用普攻当前目标 | 扇形朝墙放、技能空放 |
| 按「通道值总和」选目标 | 直线距离选目标 + BFS 走位 | 隔墙时舍近求远 |
| Barrier / Wall 单独类型、不可替换 | `preferUnitTargets` 粗粒度开关（仅 PVE） | PVP 走位目标不可控 |

## 3. 基线实测

**方法**：包装 `ZCTargetingSystem.acquire`、`ZCUnitTargeting.refreshPriorityTarget` / `hasTargetInAttackRange` / `findStepToward` 计时，`model.tick(1/60)` × 720 帧（12s 模拟，20Hz 逻辑步），地图用 `tests/fixtures/zcds-legacy-map.json`（200 格 / 200 可放置），Node v22.22.2，与 `benchmark:zcds` 同口径。脚本见 §8。

| 单位数 | tick 总耗时 | 每帧 | acquire | priority | gate | path | 索敌合计 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 40 | 169.7 ms | 0.24 ms | 5.3% | 17.9% | 8.4% | 2.5% | **34.1%** |
| 100 | 306.1 ms | 0.43 ms | 5.8% | 25.2% | 8.6% | 2.4% | **42.0%** |
| 200 | 518.1 ms | 0.72 ms | 7.2% | 28.6% | 10.6% | 2.5% | **48.9%** |

**结论**

- 最大项不是选目标（acquire 7.2%），而是 `refreshPriorityTarget`（28.6%）：它对每单位每步遍历全图地块，而多数对局没有焦点怪物，扫完直接 `return null`。200 单位场景下实到 35,248 次调用，每次 200 格 ⇒ 约 **705 万次查表/比较**。
- 占比随单位数上升（34.1% → 48.9%），说明它是随规模放大的结构性开销，不是常数噪声。
- `zcds-performance.md` 的 `targetingMs` 只包住 `acquire`，不含 priority（约 4×）与 gate（约 1.5×），历史数据低估了真实索敌成本；文档口径需在本方案落地后修正。
- 绝对值不高（200 单位 0.72 ms/帧，且不含渲染），**当前不是可感知瓶颈**；但它零行为变化、可独立发布，因此排在第一批先做，需要策划确认的 P0 排在其后。

## 4. 问题清单

| 编号 | 级别 | 问题 | 证据 | 影响 |
| --- | --- | --- | --- | --- |
| T1 | P0 | 锁定名存实亡：`idle` 保持目标，`startAttack` 每拳 `acquire` 重写 | `ZCUnitSystem.ts:72` vs `:269` | 目标每拳跳变，注释所述「RTS 式仇恨锁」不成立 |
| T2 | P0 | 仇恨无效：仇恨目标仅进候选池按距离比较 | `ZCTargetingSystem.ts:64-74` | 被打 5s 内不还手，玩家感知为「AI 迟钝」 |
| T3 | P0 | 射程口径分裂：`>100` 反打 9 折且不补体半径 | `ZCTargetingSystem.ts:126-131` | 配置 120 的远程实际 108；近战 100+体半径反而更远；同一张表两套语义 |
| T4 | P1 | 无脱战上限：`move` 追到天边 | `ZCUnitSystem.ts:287-313` | 被风筝拉穿地图，阵型崩 |
| T5 | P1 | 技能寄生普攻目标：`castFanSkill` 用 `currentTarget` | `ZCAttackResolutionSystem.ts:602-616` | 目标在射程边缘或是建筑时技能白放 |
| T6 | P1 | 全图地块空转扫描 | `ZCUnitTargeting.ts:87-89` 调用 → `ZCNeutralFeatureSystem.ts:377-401` 逐格遍历 | tick 28.6% |
| T7 | P1 | 技能闸门 `release` 无条件计算 | `ZCSkillTriggerSystem.ts:214` | 无技能单位也付 O(E) 扫描，gate 占 10.6% |
| T8 | P2 | `priorityTarget` 内两次全量扫 `state.units`（`find` + `some`） | `ZCNeutralFeatureSystem.ts:387-397` | 该分支被 T6 闸门后不常走，收益小 |
| T9 | P2 | 索敌无诊断：切目标原因不可见 | 全链路 | 复盘「为什么去打墙」只能读代码 |

## 5. 改动方案

### 5.1 T6 —— priority 前置闸门（P1，第一批）

**改法**

1. `ZCNeutralFeatureSystem` 暴露 `hasFocusableMonster(): boolean`：`hasFeatures` 为真且本局存在 `awake && !claimed && hp>0` 的怪物格。用现成的拓扑版本 + 怪物状态版本做缓存，不要每步遍历。
2. `refreshPriorityTarget` 开头加快速返回：`if (!priorityPossible(unit)) return false`，条件为「本局无焦点/唤醒怪」且「单位未锁 `building`/`wall`」且「非 PVE 玩家」。
3. 焦点怪列表建议复用 `focusOwners` 变更点（`unlockMonster` 设 `awake=true`、`claim` 设 `awake=false`、`toggleFocus`、`hp` 归零、`invalidateTerrain`）作为失效戳。

**涉及文件**：`ZCNeutralFeatureSystem.ts`、`ZCUnitTargeting.ts`、`ZCGameModel.ts`（注入上下文）。

**风险**：怪物被打醒 / 焦点切换后若戳没跟上，会出现「焦点怪已存在但单位不切换」。必须覆盖 `hp` 归零这一路（`damageBuilding` 里怪物的 `hp` 变化不经过 `invalidateTerrain`）。

**验证**：`zcds-neutral-features`、`zcds-targeting-index` 全绿；复跑 §8 探针，priority 占比应从 28.6% 降到 <5%，且 `candidateChecks` 与优化前一致（保证选择结果不变）。

**验收标准**：同种子同配置下战斗结果 digest 与优化前逐位一致（用 `benchmark:zcds` 的 digest 对比），仅耗时下降。

### 5.2 T7 —— release 惰性求值（P1，第一批）

**改法**：`ZCSkillTriggerSystem.tick` 循环顶部改为 `let release: boolean | undefined`，提供 `const needRelease = () => (release ??= context.inAttackRange?.(unit) ?? true)`，只传给真正需要的车道（`applySelfAura` / `applyBoltStrike` / `applyRandomStrike` / `applyBlinkStrike` / `advanceSecondary`）。若该单位的 `params` 不含上述任何字段，一键短路。

**涉及文件**：`ZCSkillTriggerSystem.ts`。

**风险**：`release` 原先每步只算一次（注释明确），改惰性后仍是每步至多一次，语义不变；注意不要让多个车道各算一次。

**验证**：`zcds-skill-*` 相关用例 + 技能施放诊断日志条数前后一致（`zcSkillCastWatched` 输出）。

**验收标准**：gate 占比 <2%，技能施放次数与时机零变化。

### 5.3 T1 —— 收敛「锁定」语义（P0，第二批）

**改法**：`startAttack` 删除 `acquire`，改为 `current()` + `isInAttackRange()` 校验；不合格退回 `target` 态让状态机重新索敌。目标变更只在 `target` 态发生。

**涉及文件**：`ZCUnitSystem.ts`。

**风险**：**会改变战斗节奏**。原先每拳打最近，改后会把锁定目标打完（更符合「锁定」语义，但集火更集中、换目标更慢）。属数值影响，需策划确认后再改（见 §7-2）。

**验证**：同种子战斗回放对比——伤害分布、击杀序列、首杀时间；差异需能逐条解释。

**验收标准**：目标切换次数在「多个等距敌人」的夹具里显著下降，且无「打不动远处目标却站着不动」的死锁。

### 5.4 T2 —— 仇恨与评分（P0，第二批）

**改法**（先结构，后调参）

```
Score = distanceSq × threatFactor × valueFactor
threatFactor: 仇恨目标 0.25（即等效拉近一半距离），其余 1.0
valueFactor : 兵种权重表，缺省全 1.0；可留配置位
同分：保持当前目标 > id 小
```

1. `acquire` 新增 `currentTargetId` 入参，同分时优先保留。
2. 仇恨目标命中 `hatredUnitId && now<=hatredUntil` 时 `threatFactor` 生效，而不是只进池。
3. `valueFactor` 先全置 1，留出配置位，避免一上来就动平衡。

**涉及文件**：`ZCTargetingSystem.ts`、`ZCUnitTargeting.ts`（透传当前目标）、`ZCCombatCatalog.ts`（若接配置）。

**风险**：权重是最容易拍脑袋的地方。`threatFactor=0.25` 相当于「仇恨目标距离缩半」，先在木桩夹具上跑，不要直接上线。

**验证**：新增夹具——「A 在 100px 打我，B 在 60px 不动」，改后应打 A；「A 在 200px 打（仇恨过期后）」，应回落到最近。

**验收标准**：仇恨有效期内始终优先攻击者（除非超出 1.3× 射程或被控），且总 DPS 波动 <5%（木桩）。

### 5.5 T3 —— 射程口径统一（P0，需策划确认）

**现状拆解**：近战 `range + 目标体半径`，远程 `range × 0.9`。同样配 100/120，实际打到 120/108，**近战比远程远**。

**两个可选方案**

| 方案 | 改法 | 优点 | 代价 |
| --- | --- | --- | --- |
| A（推荐） | 统一为 `range + 目标体半径 × 0.5`，取消 0.9 折 | 语义自洽，一张表一套距离 | 远程实际射程变长，需按表重调 |
| B（保守） | 保留 0.9 折但补目标体半径，仅调平口径 | 改动小、平衡漂移小 | 口径仍分裂（近战全补、远程半补） |

**注意**：`attackRange > 100` 不只用于射程判定，还是美术占位分支（`ZCUnitView.ts:753/770` 用它区分「弓 / 兵」）。改阈值或口径时必须同步这两处，否则会出现「表现是弓、判定按近战算」。

**建议先行**：先把「配置值 → 实际判定距离」做成一张对照表（`attackReach` 单测直出），交策划核对是否符合预期，再决定动 A 还是 B。当前表现层没有射程圈，不需要改渲染。

**验证**：射程单测 + 一张「配置值 → 实际判定距离」对照表交策划签字。

### 5.6 T4 / T5 —— 脱战与技能目标（P1/P2，需排期）

**T4 脱战**：新增「追击起点」或「追击计时」，超过 N 格 / T 秒放弃，回 `moveForward`。涉及快照字段（`ZCSnapshotCodec` 校验 + 存档兼容），成本比看起来高，建议与本轮解耦单独立项。

**T5 技能目标**：给技能加独立选择器（至少 Range / All 两型），找不到合法目标不消费 CD。需要 `pvpSkill` 新增列 → 导表 → 编译链路，属跨端改动，排到下一迭代。

### 5.7 T9 —— 索敌诊断（P2，可随第一批附带）

仿 `zcSkillCastWatched` 加 `zcTargetSwitchWatched`，只在「目标 ID 变化」时打一行（按值变化去重，防刷屏）：`原因` 取值 `init|dead|invalid|outOfRange|priority|score`。默认关闭，诊断开关打开即用。

## 6. 实施顺序

| 批次 | 内容 | 前置 | 风险 | 可独立发布 |
| --- | --- | --- | --- | --- |
| B1 | T6 闸门 + T7 惰性 + T9 诊断 | 无 | 低（结果不变，仅快） | 是 |
| B2 | T1 锁定语义 + T2 仇恨评分 | §7-2 确认 | 中（动节奏） | 是（需策划验收） |
| B3 | T3 射程口径（先出对照表，再改判定） | §7-1 确认 | 中（动平衡） | 是（需策划签字） |
| B4 | T4 脱战 + T5 技能分道 | 排期 | 高（快照 / 导表） | 拆成两个独立需求 |

**B1 的硬性约束**：只改开销不改结果。验收靠 `benchmark:zcds` 的 digest 逐位一致，任何数值差异都视为不合格。

## 7. 待确认口径

1. **`attackRange > 100` 打 9 折是在补偿什么？**（美术体量？格子中心对齐误差？）如果没人记得原因，建议按 5.5 方案 A 统一，并让策划按新口径重核表。
2. **「锁定后不换目标」与「每拳打最近」哪个是设计意图？** 这决定 T1 的走向：改 `startAttack` 会明显改变集火效率。
3. **技能是否需要独立的 `skillRange` 配置列？** 一旦要，就要动 `pvpSkill` 表结构与跨端编译，建议单独立项。

## 8. 附录：复现与探针

**运行环境**：Node v22.22.2，`npx tsx`。

**要点**（临时脚本，建议落地时固化到 `tools/probe_targeting.ts`，验收后保留）：

1. 用 `parseZCMap(JSON.parse(readFileSync('tests/fixtures/zcds-legacy-map.json')))` + `createZCMatchConfig` + `captureZCMatchConfig` 构造 config。
   ⚠️ 不要用 `configureZCMap` + `captureZCMatchConfig()`：`ZC_HEX_CONFIG` 是 `export let`，以 `.mjs` 入口 import 时拿到的是 CJS 快照，会报「地图配置未加载」。脚本入口必须是 `.ts`（tsx 编译成 CJS，模块单例才一致）。
2. 造 N 个单位（`battleState:'target'`，`freeX/freeY` 取格子坐标），逐帧 `model.tick(1/60)` × 720。
3. 包装 `ZCTargetingSystem.acquire`、`ZCUnitTargeting.prototype.refreshPriorityTarget` / `hasTargetInAttackRange` / `findStepToward`，`performance.now()` 前后差累加。
4. 报告 `ms / 占比 / 调用次数`，并与 `npm run benchmark:zcds` 的 digest 交叉核对确定性。

**注意**：探针脚本不要留在 `tmp/` 且扩展名为 `.ts`——工程 `tsconfig.json` 没有 `include`，会被 `tsc --noEmit` 收进去造成全量报错。

## 9. 实施结果（2026-11-18）

### 9.1 代码与配置归属

- `ZCNeutralFeatureSystem` 在初始化时登记怪物格，按地形失效戳重建可索敌怪物缓存；焦点切换、死亡和重置均覆盖。`priorityTarget` 将原来的两次单位扫描合为一次。
- `ZCUnitTargeting` / `ZCUnitSystem` 保持有效目标，出手不重选；仅重新索敌时使用仇恨评分。追击起点、时钟和脱战名单保存到 `ZCUnitState`，由 `ZCSnapshotCodec` 校验；旧快照无需新增必填字段。3 格按实际地图行距 `3 × 42 = 126` 逻辑坐标计算，不额外乘战斗射程缩放。
- 回到攻击范围即清除追击时钟（包括 idle、施法原地锁和等待攻击），再次追击重新计时。脱战后允许其他敌人进入选择，原对象进入普攻范围才解除排除。
- `ZCSkillRuntime.ZCSkillTargetMode` 定义 Range=1 / All=2。参数袋按车道使用 `secondaryTargetMode`、`auraTargetMode`、`boltTargetMode`、`shotTargetMode`、`fanTargetMode`、`strikeTargetMode`、`blinkTargetMode`、`singleTargetMode`，缺省 Range；由既有 `skillParamJson → skillParams → parameters` 链路传递，非法枚举在 `ZCStatSchema` 报错。无需改生成 JSON、Excel 列或跨端协议。
- 技能目标为最近合法敌方单位，同距按 id；独立于普攻锁墙/锁建筑。多点打击生产路径也使用最近排序。Range 使用技能自己的搜索范围；All 搜索全场，但施法仍须满足技能实际形状，不能让本体圆形/前置矩形空放。喷火复用 `zcGroundZoneReaches` 判断真实前置矩形，保留 350 表值长度；`auraTriggerRange=0` 与缺省等价。
- 范围口径：副轨使用自身普攻 reach × `secondaryRadiusScale`；落雷/弹体默认自身 reach，可用 `boltSearchRadius` / `shotSearchRadius` 指定表值范围；打击、闪现、突刺沿用各自 `strikeRadius` / `blinkSearchRadius` / `singleSearchRadius`；光环使用正 `auraTriggerRange`，否则由前置距离与实际形状计算搜索界限。
- 冲锋与普通冲刺保持既有位移、撞击接触点及空挥耗冷却规则；普通攻击统一射程不会重新校准冲刺碰撞体。
- `ZCDC_LOG_TARGET_SWITCH=false` 为默认状态；打开后输出 init/dead/invalid/outOfRange/priority/score，按每局单位对象记录前一目标并按变化去重，不进入存档或全局业务状态。

### 9.2 射程对照

以下均为 scale=1；源数据由真实 `attackReach` 探针生成于 `outputs/zcds-targeting/range-comparison.json`。战斗实际坐标再乘 `combatDistanceScale`。远近程美术分类仍用 `attackRange>100`，分类与射程公式各司其职，无需变更 prefab。

| 配置 attackRange | 目标单位半径20 | 目标建筑半径80 |
| ---: | ---: | ---: |
| 60 | 70 | 100 |
| 100 | 110 | 140 |
| 101 | 111 | 141 |
| 120 | 130 | 160 |
| 500 | 510 | 540 |

### 9.3 验证证据

- `npx tsx --test --test-concurrency=4 "tests/zcds-*.test.ts"`：1665 条，1603 通过、62 失败；相对本轮开工前 1650 条/1588 通过/62 失败，失败用例名集合零新增。新增 15 条回归覆盖上述边界。已存在的配表副本不一致、地图/表现资源等失败保留原样；明细见 `outputs/zcds-targeting/comparison.json`。
- `npx tsc --noEmit`：通过。`verify:layout` 与 `verify:hygiene`：通过。
- `npm run benchmark:zcds -- outputs/zcds-targeting/b1.json`：B1 阶段 8 个场景的战斗/表现 digest 与改前逐位一致。单次本机对比中，2p 60Hz tick 均值 0.3285 → 0.2424 ms，3p 0.4721 → 0.2965 ms；不推断设备 FPS 或承诺稳定降幅。B2～B4 明确改变行为，最终基准只验证固定种子重复运行确定性，不要求沿用旧 digest。
- 探针直接扩展 `tools/benchmark_zcds.ts`，覆盖 acquire、priority、gate、skillTarget 与 path 的调用次数/耗时。priority 扣除嵌套 acquire 耗时后再求索敌合计，寻路单独报告；原 targetingMs 只代表 acquire。当前基础场景不配置主动技能，旧范围 gate 调用为 0，不能据此推断主动技能密集场景成本。候选计数须另开 `ZCDS_TARGETING_COUNTS=1`，默认 0 不作为候选数量证据。
- `npm run verify`：共享工作区对历史基线仍报 83 条新增，tsc 新增 0；它包含开工前其他模块改动，不能冒称全仓门禁已绿。`verify:defs` 的两项 `sendGameRequest` 导出问题位于未触及的网络文件。`verify:route` 唯一完全无覆盖项是 benchmark 脚本，已手动实跑且脚本内断言计时有效、固定种子 digest 一致。
- 两人只读复核发现的追击时钟、随机实际选敌、显式0光环和前置矩形范围问题均已修复并补回归，未遗留已确认 P0/P1。

本阶段未执行真机/编辑器战斗观感、数值平衡与木桩 DPS 波动验收；不将 Node 基准当设备帧率，不承诺锁定与射程变化后的平衡不变。空间索引与跨拍目标缓存未新增；当时遗漏的兵种价值权重配置已由 §10 补齐。


## 10. 卡牌价值首版（2026-11-18）

用户追加要求接入价值体系、更新卡牌源表并导入工程，首版差异权重由实现者按策划角度制定。

### 10.1 规则与实现

重新索敌的单位评分为 `D² × threatFactor × valueFactor`，分数越小越优先。仇恨有效期内 `threatFactor=0.25`，否则为 1；`valueFactor` 来自目标所属卡牌的 `unitValueFactor`。同分保持当前目标，再按 id。合法锁定继续保持；技能独立选敌仍按最近合法目标。墙、建筑和怪物格按系数 1 参与原有比较。

这是静态索敌系数，既有卡牌价格、伤害、生命和技能参数不随本项改动。`parseUnits` 读取 `pvpCard.unitValueFactor → ZCUnitDefinition.valueFactor`，随对局配置冻结；旧配置缺列/null/空串按 1，显式非正数、非数值及非有限数在解析入口报错。后续修改表值影响新建对局。

### 10.2 首版数值依据

用职业与品阶给基础档，以范围输出、治疗、群控和团队收益作少量逐卡调整。系数范围 0.65～1.25 是本版取值，不是运行时硬上限。

| 职业 | 绿（1） | 蓝（2） | 紫（3） | 金（4） |
| --- | ---: | ---: | ---: | ---: |
| 战士 | 1.15 | 1.05 | 0.95 | 0.85 |
| 坦克 | 1.25 | 1.20 | 1.10 | 1.00 |
| 射手 | 1.05 | 0.95 | 0.85 | 0.75 |
| 法师 | 1.00 | 0.90 | 0.80 | 0.70 |

距离仍约束选择：100 距离的基础纯坦（1.25）与 130 距离的急冻瓜（0.65）比较，后者评分更低；急冻瓜远至 140 时则纯坦更低。极端档差只抵消约 38.7% 的距离差，不意味着全场追杀高价值卡。仇恨、不可攻击飞行目标、脱战排除和优先目标规则继续各自生效。

| 卡牌 id | 卡名 | 职业 | 品阶 | 系数 | 依据 |
| --- | --- | --- | ---: | ---: | --- |
| 68001 | 豌豆游侠 | 射手 | 1 | 1.05 | 按职业×品阶基础档 |
| 68002 | 巨力坚果 | 坦克 | 1 | 1.25 | 按职业×品阶基础档 |
| 68003 | 火焰树妖 | 法师 | 2 | 0.90 | 按职业×品阶基础档 |
| 68004 | 玉林好汉 | 射手 | 2 | 0.95 | 按职业×品阶基础档 |
| 68005 | 椰蛋战士 | 战士 | 3 | 0.95 | 按职业×品阶基础档 |
| 68006 | 波利奥 | 坦克 | 3 | 1.00 | 吸血与同阵营加速，团队收益高于纯坦 |
| 68007 | 吞噬大嘴花 | 战士 | 4 | 0.85 | 按职业×品阶基础档 |
| 68008 | 杰克藕 | 射手 | 4 | 0.75 | 按职业×品阶基础档 |
| 68009 | 仙桃行者 | 战士 | 4 | 0.85 | 按职业×品阶基础档 |
| 68010 | 镭射飞龙 | 法师 | 4 | 0.70 | 按职业×品阶基础档 |
| 68011 | 水手菇 | 法师 | 1 | 1.00 | 按职业×品阶基础档 |
| 68012 | 菇八戒 | 战士 | 1 | 1.15 | 按职业×品阶基础档 |
| 68013 | 风炮菇 | 射手 | 3 | 0.85 | 按职业×品阶基础档 |
| 68014 | 分裂菇 | 战士 | 3 | 0.95 | 按职业×品阶基础档 |
| 68015 | 机甲菇 | 战士 | 4 | 0.85 | 按职业×品阶基础档 |
| 68016 | 磁电菇 | 法师 | 4 | 0.70 | 按职业×品阶基础档 |
| 68017 | 毒箭菇 | 射手 | 4 | 0.75 | 按职业×品阶基础档 |
| 68018 | 诅咒菇 | 战士 | 4 | 0.85 | 按职业×品阶基础档 |
| 68019 | 窝瓜人 | 战士 | 1 | 1.15 | 按职业×品阶基础档 |
| 68020 | 三叶小丑 | 射手 | 2 | 0.90 | 聚怪控制兼双克制 |
| 68021 | 仙人侍卫 | 战士 | 2 | 1.05 | 按职业×品阶基础档 |
| 68022 | 雷蕉 | 法师 | 3 | 0.80 | 按职业×品阶基础档 |
| 68023 | 南瓜战神 | 坦克 | 3 | 1.00 | 团队加速与群体削攻 |
| 68024 | 急冻瓜 | 法师 | 4 | 0.65 | 穿友治疗与范围冻结，首版最高战略威胁 |
| 68025 | 大威天芦 | 战士 | 4 | 0.85 | 按职业×品阶基础档 |
| 68026 | 麻辣铁锅 | 法师 | 4 | 0.70 | 按职业×品阶基础档 |
| 68027 | 爆锤莲王 | 战士 | 4 | 0.85 | 按职业×品阶基础档 |
| 68028 | 饥饿战士 | 战士 | 1 | 1.15 | 按职业×品阶基础档 |
| 68029 | 金发统领 | 坦克 | 2 | 1.20 | 按职业×品阶基础档 |
| 68030 | 篮球天才 | 法师 | 2 | 0.85 | 击退与沉默可打断输出 |
| 68031 | 艺术家 | 坦克 | 3 | 1.05 | 团队加速与分身，略高于同档纯坦 |
| 68032 | 吉他手 | 射手 | 4 | 0.75 | 按职业×品阶基础档 |
| 68033 | 运动霸 | 战士 | 4 | 0.75 | 0.7 秒普攻间隔并带眩晕，威胁高于常规金战士 |
| 68034 | 魔术师 | 法师 | 4 | 0.70 | 按职业×品阶基础档 |
| 68035 | 科学家 | 射手 | 4 | 0.75 | 按职业×品阶基础档 |

### 10.3 源表、导表与工程归属

- 源表：`D:/City1001/doc/塔防数据配置/PVP-卡牌.xlsx` 的「卡牌配置」AM 列：中文名“索敌价值系数”，字段 `unitValueFactor`，类型 `float`、导出码 3。35 张兵种卡填值，主城/金矿留空。与现有单位属性一样仅导客户端，不新增服务端字段。
- 使用 Artifact Tool 编写新增列，再只将 AM 列并回原 Excel 包。写入时核对其余单元格文本字节不变，另 16 个 ZIP 成员逐字节相同；源表备份位于 `outputs/zcds-card-value/PVP-卡牌.before.xlsx`。
- 复用 `tools/config/EsonCli.java` 仅导卡牌单表，临时目录全量配置校验通过后发布 `doc/塔防数据配置/json/client/pvpCard.json`。导表当时核对原有卡牌字段零变更、服务端卡表零变更。
- 使用 `tools/ref/ref_compress_json.py ... --table pvpCard`、`ref_ref_type_all_gen.py ... --table pvpCard`、`ref_RefBase_gen.py` 导入工程，生成 `assets/remoteRef/pvpCard.json` 和 `IRefpvpCard.unitValueFactor` 类型。单表导出避免重写其他源表；共享工作区后来产生的其他导表改动保持原样。
- Funplay Cocos MCP 已确认项目 `D:/City1001/Demo3.8` / Creator 3.8.8，刷新 `db://assets/remoteRef`。卡表 AssetDB 标识稳定，UUID 为 `7f91c783-cb68-4d86-ac0b-319626595296`；脚本诊断零错误。稳定 AssetDB 标识不等同于已运行战斗。

### 10.4 回归与验收边界

必要回归覆盖缺省/非法系数、35 张卡逐行透传、仇恨快捷候选与索引/全量扫描的一致性、价值与距离/仇恨共同影响、同分规则及技能最近目标不变。模型集成回归同时验证墙前单位可优先、同距时 1.05 系数单位低于系数 1 的墙，先拆墙后打建筑。

实际命令和最终结果见 `outputs/zcds-card-value/验收记录.md`；逐卡配置见 `weights.json`，源表/策划 JSON/工程 JSON 对照由 `check-current.py` 验证。首版仍需实战调权重与真机观感验收；Node 基准只验证确定性，不作为胜率或帧率结论。
