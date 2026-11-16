/**
 * 移形换影（blink_strike，魔术师 103404）施法瞬间的闪现特效。
 *
 * 行为技能的参数全压在 pvpSkillPlan.skillParamJson 上，那张表只有数值槽没有造型列，
 * 所以路径只能写在代码里（普攻爆炸也是同一类做法）。硬编码路径必须同时进
 * ZCVisualResourcePlan 的清单，否则技能照常结算、屏幕上什么都不闪，也不会报错。
 *
 * 本文件不能引 cc：用例要在没有引擎的环境里直接读这些常量。
*/

/** 瞬间移动特效的 prefab 路径（assets/bundles/battle/ 分包根下的相对路径）。*/
export const ZC_BLINK_CAST_EFFECT_PREFAB_PATH = 'units/projectiles/瞬间移动特效/瞬间移动特效';

/**
 * 特效存活时长，等于动画 clip 长度：18 帧 / sample 24 = 0.75s（tools/build_blink_fx.py 生成）。
 * 事件时长和 clip 必须一致，短了图没播完就回收，长了会停在末帧。
*/
export const ZC_BLINK_CAST_EFFECT_SECONDS = 0.75;

/** 触发这条表现的行为键。*/
export const ZC_BLINK_CAST_BEHAVIOR_KEY = 'blink_strike';

/**
 * 行为键 → 施法瞬间的特效路径；不是移形换影返回 null。
 *
 * 收成一个函数是为了让「播不播」和「加不加载」用同一个判据，
 * 两处各写一遍字符串迟早会对不上。
*/
export function zcBlinkCastEffectPath(behaviorKey: string | null | undefined): string | null {
    return behaviorKey === ZC_BLINK_CAST_BEHAVIOR_KEY ? ZC_BLINK_CAST_EFFECT_PREFAB_PATH : null;
}
