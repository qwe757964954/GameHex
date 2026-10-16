# ZCDS 老客户端技能公式迁移闭环

## 数据链路

策划仍以 Excel 为入口。导表后的正式战斗链路为：

`skillView.hurt/exHurt` → `skillEffect.key` → 受限公式执行器 → 伤害、范围、斩杀、Buff → `pvpStatus.statusId` → `ZCStatusSystem`。

- 普通攻击取 `skillView.hurt`；强化攻击取 `skillView.exHurt`。
- 没有旧公式时继续使用 `pvpSkill.damageRate`，旧数据缺失不会让现有技能失效。
- `skillBuff.param` 是 Buff 默认参数，`skillEffect.effect.param` 是本次命中的公式覆盖。
- 后端只需下发构筑中的 modifier id；技能等级、卡牌等级继续在构筑阶段投影成 modifier。

## 本局冻结和断线恢复

开战前加载 `skillAttr.json`、`skillView.json`、`skillEffect.json`、`skillBuff.json`，只保留本局技能引用的数据，并随 `ZCMatchConfig` 深拷贝冻结。进行中的对局不读取之后热更的全局表。

弹道出手时冻结公式伤害、暴击、已通过条件的 Buff 及参数、斩杀概率和范围。持续伤害还会冻结施法者攻击力、来源 owner、动态层数上限、每层独立剩余时间和周期计数。快照恢复不会重抽随机、重判公式条件或改用热更后的数值。

## 已迁移状态行为

下列旧 Client 行为已经注册到状态白名单，并在 `pvpStatus` 中启用：

- **燃烧**：按 `施法者攻击力 × 伤害系数 × 当前层数` 周期扣血；支持普通燃烧、无特效燃烧和斧盾兵燃烧。目标最大生命百分比型燃烧按旧参数计算，并受施法者攻击力倍率封顶。
- **流血**：按 `施法者攻击力 × 伤害系数 × 当前层数` 周期扣血；每层独立计时，旧层到期只移除对应层。配置了额外血爆时，按冻结的间隔和系数追加伤害。
- **撕裂**：复用旧 Client 的持续流血结算，动态层数上限取公式/`skillBuff` 参数；当前兼容上限为 10 层。
- **击退**：命中时沿施法者到目标的方向立即位移配置距离；落点限制在可行走地图内，位移后废弃旧寻路并同步单位空间索引。
- **牵引**：作为施法者自身的永久光环；每逻辑拍将范围内敌人按配置速度拉向施法者，并保留旧 Client 的 20 距离停止半径。目标按 ID 排序处理，2/3/4 人和 AI 对局结果确定。

这些行为都按 owner 隔离。持续伤害的伤害与击杀统计归原施法者 owner；施法者已经死亡时，冻结来源仍可正确归属。

## 修改器与技能升级

`skillAttrModifier` 按 id 原顺序执行，重复 id、重复操作和“修改属性/替换属性”的先后关系都会保留。J 表投影出的 `pvpSkillPlan` 支持：

- `accumulate`：累计所有已解锁档；
- `replace` / `branch`：只取当前最高已解锁档；
- 攻击、射程等类型化属性先进入单位有效属性，再作为旧公式的 `角色攻击力` / `基础攻击力`；
- 若投影 modifier id 存在于 `skillAttrModifier`，旧中文属性也会按顺序进入公式属性包。

每个 owner 独立编译并保存属性，2/3/4 人和 AI 不共享属性字典。

`pvpAttrMap` 的 `type`、`attackType`、`model` 是技能文本属性。要让覆盖进入本局攻击档案，旧属性必须出现在所选 `skillAttrModifier` 的操作中，并由启用的 `pvpSkillBinding.parameterKey` 指向对应的 `pvpSkillId`。`pvpModifierOverride` 可按 `statId.override` 填值：`type` 和 `attackType` 使用 `melee`、`projectile`、`area`，映射到该技能的攻击模式；`model` 使用 resources 内不带扩展名的 Prefab 路径，映射到该技能的 `effectPrefabPath`。旧数字编码与旧资源名没有自动转换；这些值留在旧公式属性包，但不改新对局攻击档案。启用的模型覆盖路径在开局资源准备时预加载。

## 公式安全边界

表达式支持数字、字符串、属性/方法访问、函数调用、括号、四则运算、比较、逻辑运算和三元表达式。允许上下文包括：

- `attr.GetValue(name)`
- `attr.random()`
- `attr.randomInt(min, max)`
- `buff.has(tid, legacyBuffKey)`
- `damageInfo.damageTag.isCrit`
- `var.HpRateLe(tid, percent)`

运行时不使用 `eval` 或 `new Function`，并禁止访问 `constructor`、`prototype`、`__proto__` 和全局对象。公式在配置加载阶段编译校验，非法公式会阻止本次配置提交。

## 策划新增技能步骤

1. 在 J 表或旧技能表配置技能等级与 modifier id。
2. 在 `skillAttrModifier` 增加公式需要读取的属性；纯 PVP 通用属性可直接使用 J 表类型化列。
3. 在 `skillView.hurt/exHurt` 填 effect key。
4. 在 `skillEffect` 为该 key 增加公式行。
5. 若公式施加 Buff，在 `skillBuff` 定义默认参数，并在 `pvpStatus` 增加 `legacyBuffKey → statusId` 映射。
6. 新行为先注册客户端处理器，补确定性、多人、AI、弹道及快照恢复测试，再将 `enabled` 改为 1。

## 校验命令

`config:validate` 同时校验新 PVP 表和老 Client 四表，包括重复 ID、缺失引用、公式安全边界、行为白名单和数值范围。存量重复属性 ID 与尚未启用状态只告警；新增断链或越权公式会令导表失败。

```powershell
npm.cmd run config:validate
npm.cmd run check:zcds
npx.cmd tsx --test tests/zcds-config-validator.test.ts tests/zcds-legacy-skill-effect.test.ts
```
