# skillAttrModifier 未注册 type 映射清单

- 日期：2026-09-18
- 工程：D:\City1001\Demo3.8（Cocos Creator 3.8.8）
- 范围：`assets/script/app/zcds/model/ZCModifierEngine.ts`（数值修改器引擎）+ `assets/remoteRef/skillAttrModifier.json`（表数据）
- 目的：占城技能系统接入前的盘点——表里实际出现的 modify type 中，哪些一直没注册处理器、它们在占城有没有对应落点、怎么处理

---

## 1. TL;DR

1. **`ZCModifierEngine` 目前是"孤岛"**：全部导出（`ZCModifierExecutor` / `executeGeneralStarModifiers` / `mergeSkillAttrModifierRows` 等）在 `assets/script` 中**零外部引用**，`commands` 产物无任何消费方，占城技能系统尚未接入。
2. **表数据**：3228 行、3414 条 modify 操作。已注册处理器（`修改属性` 2832 + `替换属性` 156）覆盖 2988 条（87.5%）；**未注册 426 条（12.5%）**，涉及 19 个 type + 9 条空 type。
3. **映射结论**：426 条中——**138 条（32%）直接映射**到占城已有系统；**257 条（60%）需改造翻译**；**30 条（7%）可直接忽略**（塔防遗留 / 表现层 / 脏数据）。
4. **决定性决策点**：占城**没有 buff 系统**，103 条操作（占缺口 24%）挂在"做不做 buff"这个决策上。建议先做**数值折叠**（数值型 buff 编译成单位属性修正），行为型 buff 单独抽成占城自己的 effect。
5. 本清单可直接作为翻译层（方案 B）的映射表蓝本。

---

## 2. 背景：引擎现状

- `ZCModifierEngine.ts` 是从旧塔防 `skillAttrModifier` 表迁移的"占城兼容执行器"：属性型修改立即写入属性包，结构/行为型修改转换成 `commands`，注释声明"交给后续占城技能系统逐项实现"。
- 当前状态：**该承诺尚未兑现**。Grep 全工程，`ZCModifierExecutor` / `executeGeneralStarModifiers` / `ZCModifierCommand` / `mergeSkillAttrModifierRows` / `indexGeneralStarRows` 的唯一命中就是文件自身。
- 表访问器 `RefMgrskillAttrModifierBase`（表名 `skillAttrModifier`）已由 refGen 生成，但没有任何代码调用它；表数据躺在 `assets/remoteRef/skillAttrModifier.json`（k/v 转表格式），从未被加载。
- 表源 xlsx 在 `doc/塔防数据配置/`（转表工具 TFDocGenerator）；数据 JSON 另在 `tmp\_doc\json\sever\skillAttrModifier.json`、`tmp\_doc\json\client\skillAttrModifier.json`。

### 占城对局结构（映射的落点依据）

| 系统 | 占城实现 | 对应 skillAttrModifier type |
| --- | --- | --- |
| 卡牌/卡池 | `pvpCard`（卡 id = 单位 id，一卡一单位），有卡池行与出战卡组 | 卡牌进卡池 / 使用卡牌 / 替换初始卡牌 / 添加兵种 |
| 单位 | `pvpUnit` → `ZCUnitDefinition`（武将 = `general.id` 68001~68014，兵种 = `army.id`，近卫 = `guards.id` 69001~69004） | 添加武将 / 添加近卫 / 添加兵种 / 添加召唤物 / 修改兵种 / 修改射程 |
| 技能 | `ZCAttackProfile`（melee / projectile / area），`ZCCombatEvent.skillId` | 添加技能 / 添加主公技 |
| 主动技/神器 | `pvpArtifact` 神器系统（充能、释放） | 添加主公技（候选落点） |
| 开局生成 | `spawnUnit` | 开局招募 / 修改出兵 |
| **buff** | **不存在**（全 zcds 仅 ZCModifierEngine 提及） | 添加兵种buff / 增加buff / 添加兵种buff列表 / 添加拒马buff |
| 皮肤 | 表现层（prefabPath 换皮） | 修改皮肤 |

---

## 3. 表数据总览

- 总行数：3228（全部有 id）
- modify 操作总数：3414
- 已注册 type（构造函数注册的 2 个处理器）：
  - `修改属性`：2832 条（数字相加 / 缺省写入 / 其它覆盖）
  - `替换属性`：156 条（Object.assign 覆盖）
  - 合计 2988 条（87.5%）
- 未注册：426 条（12.5%），见第 4 节

---

## 4. 未注册 type 映射清单（426 条）

### 4.1 直接映射（138 条，32%）——占城已有对应系统

| type | 条数 | 占城落点 | 建议动作 | 样本 |
| --- | --- | --- | --- | --- |
| 卡牌进卡池 | 115 | pvpCard 卡池 | 初始卡池加卡（技能卡→占城卡） | id=3000100 解锁"修炼御剑术"；3000101"飞剑分裂" |
| 添加武将 | 14 | general.id 68001~68014 → hero 单位 | 武将卡入卡组 | id=1301001 monster=68001 弓兵"征召3个弓兵" |
| 添加近卫 | 4 | guards.id 69001~69004 | 近卫单位入卡组 | id=36780101 monster=69001 近卫邢"普通攻击" |
| 添加召唤物 | 5 | 召唤单位生成（猛虎/战鹰/巨熊） | spawnUnit 扩展带参召唤 | id=1213008 monster=66016 战鹰；1313001 驭兽师 |

### 4.2 需改造翻译（257 条，60%）——占城有近似物，语义需翻译

| type | 条数 | 占城落点 | 建议动作 | 样本 |
| --- | --- | --- | --- | --- |
| 使用卡牌 | 40 | 开局初始卡 + 数值修正 | 拆成"初始卡"+"属性修改" | id=20000309 "初始修炼巨石突刺，伤害-60%" |
| 添加兵种 | 18 | 兵种单位/卡入卡池（冰法师/骑兵） | = 卡池加卡 + 招募参数 | id=1200003 monster=60004 冰法师 |
| 替换初始卡牌 | 16 | 开局卡组替换 | 翻译为"初始卡组"字段 | id=20000249 "初始将御剑术替换为惊雷咒" |
| 开局招募 | 8 | 开局预生成单位 | 对局启动 spawnUnit | id=1214051 "开局招募4民兵" |
| 修改出兵 | 6 | 出生位置（bornType：左翼/中场） | 单位定义加 spawn 位置字段 | id=1204025 bornType=1 "开场后从战场左翼冲出" |
| 修改兵种 | 5 | 单位转职（民兵→冰法师） | 翻译为"单位替换/升级"指令 | id=1214014 "民兵转职为冰法" |
| 添加技能 | 5 | ZCAttackProfile 换/加技能 | 覆盖单位普攻技能 | id=36780102 近卫邢"雷电冲击"（技能34012） |
| 修改射程 | 1 | unit.attackRange | 并入"修改属性"语义 | id=1201011 "弓兵射程+30%" |
| 添加主公技 | 60 | 神器 / 英雄主动技能（二选一） | **决策点**：主公技落到神器还是技能系统 | id=36790101~ 技能[35001] 水淹七军 |
| 添加兵种buff | 83 | 占城无 buff 系统 | 见第 5 节（数值折叠 / 新建 buff） | id=1201006 "弓兵伤害+80%，连击上限50%" |
| 增加buff | 15 | 同上（技能带 buff） | 同上 | id=3000121 buffid=[2] "飞剑+1，伤害-19%" |
| 添加兵种buff列表 | 1 | = 多个添加兵种buff | 并入 buff 决策 | id=1206001 刀盾兵两个 buff |

### 4.3 可忽略（30 条，7%）——塔防遗留 / 表现层 / 脏数据

| type | 条数 | 原因 | 建议动作 |
| --- | --- | --- | --- |
| 修改皮肤 | 15 | 表现层（prefabPath 换皮），不阻塞对局逻辑 | 延后 / 单独做表现层需求 |
| 添加拒马buff | 4 | 拒马是塔防专属单位，占城无 | 直接忽略 |
| 出场携带 | 2 | 伴生单位机制（弩兵带战鹰），占城无 | 延后 / 用召唤物表达 |
| (空 type) | 9 | 脏数据（modify 为空），源头 xlsx 缺值 | 修源头 `doc/塔防数据配置` |

---

## 5. 决定性决策点：buff 系统做不做（103 条）

涉及：添加兵种buff 83 + 增加buff 15 + 添加兵种buff列表 1 + 添加拒马buff 4 = **103 条（占缺口 24%）**。

样本观察：绝大多数是**数值型** buff——
- "弓兵伤害+80%，每次攻击相同目标伤害+10%，最大不超过50%"（狙杀箭）
- "长枪兵伤害+100%，闪避+20%，攻击变为2连击"（天兵下凡）
- "御剑术飞剑+1，伤害-19%"（双发飞剑）

**决策（2026-09-18 用户拍板）：新建状态系统 `ZCStatusEffect`，不做数值折叠。**

统一做一套带生命周期的状态系统（挂载 / 定时 / 叠加 / 移除 / 条件触发），103 条 buff 操作全部走它：
1. 数值型状态：挂到单位后合并进属性修正（攻击/攻速/闪避/生命等），由状态实例持有；
2. 行为型状态：连击、附加状态、定时效果等，通过状态钩子挂在单位战斗事件上；
3. 条件触发型（如"拒马血量低于25%"）：状态定义声明触发条件，由状态系统在事件流中检查。

> 备注：`添加拒马buff` 的载体"拒马"单位在占城不存在，仍按 4.3 忽略；但状态系统建成后，未来若有拒马类单位可直接复用。

---

## 6. 推荐实施路径（方案 B：翻译层 + 强类型效果）

1. **映射表**：以本文档第 4 节为蓝本，建立 `type → 占城 effect` 映射（判别联合 + schema 校验）。
2. **翻译层**：在 `ZCModifierEngine` 与消费方之间加一层——旧 type 翻译成占城强类型 effect，映射表显式声明"直接映射 / 改造 / 忽略"三档；未映射项**启动时告警**，而不是静默。
3. **消费点**：`executeGeneralStarModifiers` 的「武将id:星级」接口接到 `ZCGameModel` 对局启动——属性包喂初始属性、卡牌 effect 喂初始卡池、召唤/开局 effect 喂 spawnUnit、技能 effect 喂攻击技能。
4. **闭环检查**：启动时输出「表中 type × 实现状态」清单（把本次人肉盘点做成常驻检查）；新 type 进表不实现会**报出来**。

---

## 7. 附录

### 7.1 数据来源与口径

- 表数据：`assets/remoteRef/skillAttrModifier.json`（k/v 格式：`{ k: [列名], v: [[行值]] }`，3228 行）
- 统计口径：`modify[].type` 去重计数；空 type 单独记 `(empty)`
- 已注册集合：`修改属性` / `替换属性`（`ZCModifierExecutor` 构造函数）
- 未注册 = 全表 type 集合 − 已注册集合（19 个 type + empty）

### 7.2 涉及文件

- `assets/script/app/zcds/model/ZCModifierEngine.ts`（引擎，需加翻译层/消费方）
- `assets/script/app/zcds/model/ZCGameModel.ts`（占城对局纯逻辑层，消费点候选）
- `assets/script/app/zcds/model/ZCGameRuntimeConfig.ts`（pvpUnit/pvpCard/pvpSkill 解析，单位 id 口径）
- `assets/script/app/zcds/model/ZCGameTypes.ts`（ZCUnitDefinition / ZCDeckCard / ZCCombatEvent 类型）
- `assets/script/app/zcds/model/ZCCombatCatalog.ts`（战斗目录）
- `assets/remoteRef/skillAttrModifier.json`（表数据）
- `doc/塔防数据配置/`（表源 xlsx）

### 7.3 已决问题（2026-09-18 用户拍板）

1. **buff 方案**：✅ **新建状态系统 `ZCStatusEffect`**（不做数值折叠），见第 5 节。
2. **主公技落点**：✅ **双落点**——既实现为英雄主动技能（`ZCAttackProfile` / 单位技能），也实现为神器（`pvpArtifact`）。翻译层按 data 中的技能 id 生成两套挂接：英雄单位携带的技能 + 神器释放的技能。
3. **表数据维护**：9 条空 type 是否回源头 xlsx 修复（未决）。
4. **皮肤**：修改皮肤是否要做表现层支持，不阻塞逻辑（未决）。
