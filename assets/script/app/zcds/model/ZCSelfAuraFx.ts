/**
 * 自身光环（`behaviorKey = 'self_aura'`）的持续表现 facade。
 *
 * 默认路径与按单位覆盖表已迁到 `ZCEffectCatalog` 的 behavior 组；
 * 本文件只保留原导出名，资源计划与触发系统共用同一判据。
 */

import {
    ZC_EFFECT_BEHAVIOR_KEYS,
    ZC_EFFECT_PATHS,
    zcEffectPathsForBehavior,
} from './ZCEffectCatalog';

/** 自身光环的兜底预制体路径；没有单位覆盖时使用。*/
export const ZC_SELF_AURA_EFFECT_PREFAB_PATH = ZC_EFFECT_PATHS.sustainedAura;

/** 触发这条表现的行为键。*/
export const ZC_SELF_AURA_BEHAVIOR_KEY = ZC_EFFECT_BEHAVIOR_KEYS.selfAura;

/**
 * 行为键（+ 可选单位 id）→ 自身光环的特效路径；不是自身光环返回 `null`。
 *
 * 覆盖表在目录里（68025 火焰光环 / 68016 雷电冲击 / 68026 喷射火焰）；
 * 未覆盖的单位回落到默认光柱。
 */
export function zcSelfAuraEffectPath(
    behaviorKey: string | null | undefined,
    unitId?: string | null,
): string | null {
    if (behaviorKey !== ZC_SELF_AURA_BEHAVIOR_KEY) return null;
    return zcEffectPathsForBehavior(behaviorKey, unitId)[0] ?? ZC_SELF_AURA_EFFECT_PREFAB_PATH;
}

/**
 * 「落地那一击」的一次性表现（按单位登记，缺省没有）。
 *
 * 为什么需要另一条通道：{@link SELF_AURA_FX_BY_UNIT} 那张表是**区域本身**的持续表现
 * （`holdVisual`，与区域同生共死 3 秒）；而设计案里的「陨落」观感是**落地那一记**——
 * 开区域那一下从天上砸下来的一根冰锥，播完就没了，不该跟着区域站满 3 秒。
 * 两者同源不同时：一条挂在区域上、一条只在 `castSelfAura` 出生那一拍推一条一次性 `area` 事件。
 *
 * 2026-11-19 用户口径（急冻瓜「冰山陨落」102403）：
 * 「区域效果和冰锥都是落在目标身上」⇒ 冰锥的落点就是区域圆心
 * （该技能配了 `auraAtTarget = 1`，圆心 = 受击目标坐标）。
 *
 * 表里出现的路径必须同时被 `ZCVisualResourcePlan` 收进本局清单，
 * 否则 `ZCGameLoader` 不加载 ⇒ 冰域照常结算、天上什么都没砸下来、且不报错。
*/
const SELF_AURA_LANDING_FX_BY_UNIT: Readonly<Record<string, string>> = {
    // 68024 急冻瓜「冰山陨落」102403：设计案 O 列「冰锥复用【冰法师的冰锥】特效」。
    // 它原本是**弹体**（冰法师 30201 / 弩兵 30261 的普攻，水平飞出去），
    // 摆成落地就是「旋转 -90°」—— 朝向从水平改成垂直向下，观感变成自天而降。
    '68024': ZC_EFFECT_PATHS.iceCone,
};

/** 落地那一击要转多少度（设计案原话「旋转 -90°」）。*/
export const ZC_SELF_AURA_LANDING_ANGLE_DEGREES = -90;

/**
 * 落地那一击的存活秒数。
 *
 * ⚠️ 冰锥的 clip 是**单帧循环**（`冰法师_冰锥-loop.anim`：`_duration` = 0.0833 = 1/12、
 * `wrapMode = 2` 循环）⇒ 它本身就是一张静帧，落下来之后不会自己演完，
 * 所以「砸完就消失」得由这条时长决定。0.5s ≈ 肉眼能看见一记落地、又不至于杵着挡住目标。
*/
export const ZC_SELF_AURA_LANDING_SECONDS = 0.5;

/**
 * 行为键（+ 可选单位 id）→ 落地那一击的预制体路径；没登记就返回 `null`（不插事件）。
 *
 * 与 {@link zcSelfAuraEffectPath} 一样收成函数：触发系统决定「播不播」、
 * 资源计划决定「加不加载」，必须是同一个判据。
*/
export function zcSelfAuraLandingPath(
    behaviorKey: string | null | undefined,
    unitId?: string | null,
): string | null {
    if (behaviorKey !== ZC_SELF_AURA_BEHAVIOR_KEY) return null;
    return (unitId ? SELF_AURA_LANDING_FX_BY_UNIT[unitId] : undefined) ?? null;
}
