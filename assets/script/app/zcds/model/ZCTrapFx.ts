/**
 * 科学家「精密陷阱」103504（`behaviorKey = 'trap_place'`）的表现与预算常量。
 *
 * ## 为什么路径写在代码里，而不是配表
 *
 * 与 `ZCBoltStrikeFx` / `ZCSelfAuraFx` / `ZCBlinkCastFx` 同一个理由：`trap_place` 是**行为技能**，
 * 参数全压在 `pvpSkillPlan.skillParamJson`（只有数值槽、没有造型槽），`pvpSkill` 按 `unitId`
 * 挂的是**普攻行**，一行只服务一个「出手」，装不下这条主动的三段造型。
 *
 * ## 为什么要三个 prefab
 *
 * 设计案第 175 行的表现口径是**三段**：
 *
 * | 段 | 帧 | 时长 | 出场 |
 * | :-- | :-- | :-- | :-- |
 * | 生成 | `start00~11` | 0.4s（`sample 30`） | 施法那一拍，一次性 |
 * | 常驻 | `idle00~11` | 1.0s 一圈（`sample 12`，**循环**） | 生成动画播完才出现 |
 * | 爆炸 | `levelup-1_00~17` | 0.6s（`sample 30`） | 触碰 / 到点那一拍 |
 *
 * `cc.AnimationClip` 的 `wrapMode` 管**整段**，没法「先播一次 start、再无限循环 idle」；
 * `ZCCombatEffectView` 也只在 `mountVisual` 时 `play(默认 clip)`，不会接龙。
 * 所以拆成三份，由**模型**决定谁在哪一拍出场：
 * 生成段是独立的一条 `area` 事件（0.4s 后自然过期），常驻段靠区域的
 * `visualDelaySeconds = ZC_TRAP_SPAWN_SECONDS` 推后出场（视图侧由
 * `zcCombatEffectEntered` 挡住未来事件，见 docs §14.9）。
 *
 * ## ⚠️ 三条路径都必须被 `ZCVisualResourcePlan` 收进本局特效清单
 *
 * `ZCGameLoader` 只加载 `buildZCVisualResourcePlan()` 算出来的路径。漏收的后果和其它
 * 行为技能一模一样：**技能照常结算、屏幕上一个像素都没有，而且一条错都不报**。
 *
 * ⚠️ 本文件必须保持**无 `cc` 依赖**，否则这些常量没法在没有引擎的环境里被用例直接断言。
 */

/** 触发这条车道的行为键。 */
export const ZC_TRAP_BEHAVIOR_KEY = 'trap_place';

/** 陷阱常驻（`idle00~11` 循环）：区域的 `holdVisual` 事件挂它。 */
export const ZC_TRAP_IDLE_PREFAB_PATH = 'units/projectiles/科学家_陷阱/科学家_陷阱';

/** 陷阱生成（`start00~11` 一次性）：施法那一拍单独推一条 0.4s 的可视事件。 */
export const ZC_TRAP_SPAWN_PREFAB_PATH = 'units/projectiles/科学家_陷阱/科学家_陷阱_出现';

/** 陷阱爆炸（`levelup-1_00~17` 一次性）：触碰 / 到点那一拍推一条 0.6s 的事件。 */
export const ZC_TRAP_EXPIRE_PREFAB_PATH = 'units/projectiles/科学家_陷阱爆炸/科学家_陷阱爆炸';

/**
 * 生成动画的秒数 = 12 帧 ÷ `sample` 30。
 *
 * 🔴 它同时是「常驻视觉的延迟」：`start` 与 `idle` 是两段独立美术，同帧出场会双影。
 * 改 `tools/build_scientist_trap_fx.py` 里那个 `sample` 时必须同步这个常量。
 */
export const ZC_TRAP_SPAWN_SECONDS = 12 / 30;

/** 爆炸动画的秒数 = 18 帧 ÷ `sample` 30；表现事件必须活够这么久。 */
export const ZC_TRAP_EXPIRE_SECONDS = 18 / 30;

/** 行为键 → 陷阱常驻路径；不是陷阱就返回 `null`（不插任何资源）。 */
export function zcTrapEffectPath(behaviorKey: string | null | undefined): string | null {
    return behaviorKey === ZC_TRAP_BEHAVIOR_KEY ? ZC_TRAP_IDLE_PREFAB_PATH : null;
}
