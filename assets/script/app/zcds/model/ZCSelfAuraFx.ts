/**
 * 自身光环（`behaviorKey = 'self_aura'`，大威天芦 102503「无尘禁土」）的**持续表现**。
 *
 * 需求（2026-11-09）：「使用【持续光环伤害效果】叠加成类似角色的黄色，中间持续伤害时，
 * 在第 8 到第 25 帧循环」。
 *
 * ## 为什么路径写在代码里，而不是配表
 *
 * 与 `ZCBlinkCastFx`（移形换影）同一个理由：`self_aura` 是**行为技能**，全部参数压在
 * `pvpSkillPlan.skillParamJson` 上（`auraCooldown` / `auraRadius` …），那张表只有数值槽、
 * 没有造型槽；而 `pvpSkill`（唯一带 `effectPrefabPath` 的）按 `unitId` 挂的是**普攻行**
 * （68025 是 30858），一行只服务一个「出手」，装不下第三条主动技能的造型。
 * 于是这张图没有任何配置列可以承载 —— 表现是这套行为的一部分，不是某张表的列。
 *
 * ## ⚠️ 它必须被 `ZCVisualResourcePlan` 收进本局特效清单
 *
 * `ZCGameLoader` 只加载 `buildZCVisualResourcePlan()` 算出来的路径。硬编码路径如果
 * 不进那张清单，运行时 `effectVisualPrefabs.get()` 就是 `null` ⇒ 技能照常结算、
 * 屏幕上**一次光都没有**，而且一条错都不报（2026-11-03 追踪导弹就是这么消失的）。
 * 所以那边按「本局有没有 `self_aura` 的技能计划」把这条路径加进去。
 *
 * ⚠️ 本文件必须保持**无 `cc` 依赖**（同 `ZCCombatEffectPlacement` / `ZCCombatEffectScale`），
 * 否则这些常量就没法在没有引擎的环境里被用例直接断言。
 */

/** 「持续光环伤害效果」预制体路径（`assets/bundles/battle/` 分包根下的相对路径）。 */
export const ZC_SELF_AURA_EFFECT_PREFAB_PATH = 'units/projectiles/持续光环伤害效果/持续光环伤害效果';

/** 触发这条表现的行为键。 */
export const ZC_SELF_AURA_BEHAVIOR_KEY = 'self_aura';

/**
 * 按**单位**覆盖自身光环的造型（缺省全体走 {@link ZC_SELF_AURA_EFFECT_PREFAB_PATH}）。
 *
 * 为什么需要：`self_aura` 已经不只服务一家 —— 大威天芦「无尘禁土」（一根黄光柱）
 * 与磁电菇「磁电冲击」（一道横向雷电束）共用一个车道、共用一个 `behaviorKey`。
 * 造型槽在配表里没有位置（见文件头），只能落成一张代码表；
 * 这是 `ZCCombatEffectFlight.MISSILE_FX_BY_UNIT` 早就用过的同一套写法
 * （那边按单位登记「弹体 / 爆炸」两条路径）。
 *
 * 🔴 表里出现的路径**必须**同时被 `ZCVisualResourcePlan` 收进本局清单，
 * 否则 `ZCGameLoader` 不加载 ⇒ 技能照常结算、屏幕上一道电都没有，且不报错。
 * 那边按「本局有没有这个单位的 `self_aura` 计划」顺带把对应路径加进去。
 */
const SELF_AURA_FX_BY_UNIT: Readonly<Record<string, string>> = {
    // 68016 磁电菇「磁电冲击」101604：`tools/build_magdi_strike_fx.py` 生成的三件套，
    // 取原 18 帧的第 9~14 帧做 0.5s 循环（设计案：「中间持续时间使用 9~14 帧循环」）。
    // 尺寸：判定 `auraRadius = 180`（L2 档）⇒ 冲击波烘焙到屏上 276.8px 长。
    '68016': 'units/projectiles/雷电冲击/雷电冲击',
    // 68026 麻辣铁锅「喷射火焰」102603：`tools/build_maladi_guo_fx.py` 生成的三件套。
    // 帧序 = 原 18 帧 + 「循环帧 11~17」× 3（设计案：「当需要延长时间时使用循环帧 11-17」）,
    // sample 12 ⇒ 39/12 = 3.25s，比光环的 3s 略长，动画会在区域到期那一拍被整体摘掉，
    // 不会停在最后一帧上僵住。
    // 摆位：prefab 的根 `_lpos` 往回带一个偏移，把火焰**根部**钉在角色头部，
    // 火焰主体铺到 `auraForward = 350` 的判定圆心上（换算见生成器文件头 §2）。
    '68026': 'units/projectiles/麻辣铁锅_喷射火焰/麻辣铁锅_喷射火焰',
};

/**
 * 行为键（+ 可选单位 id）→ 自身光环的特效路径；不是自身光环就返回 `null`（不插任何事件）。
 *
 * 收成一个函数而不是让两处各自比较字符串：触发系统决定「播不播」、
 * 资源计划决定「加不加载」，**这两件事必须是同一个判据**，否则又是一次
 * 「结算了但没图」或者「加载了但永远不播」。
 *
 * @param unitId 单位 id。缺省 ⇒ 走默认预制（大威天芦那条老口径，行为逐字不变）。
 */
export function zcSelfAuraEffectPath(
    behaviorKey: string | null | undefined,
    unitId?: string | null,
): string | null {
    if (behaviorKey !== ZC_SELF_AURA_BEHAVIOR_KEY) return null;
    const override = unitId ? SELF_AURA_FX_BY_UNIT[unitId] : undefined;
    return override ?? ZC_SELF_AURA_EFFECT_PREFAB_PATH;
}
