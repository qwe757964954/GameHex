/**
 * 移形换影（`behaviorKey = 'blink_strike'`，魔术师 103404）的**施法瞬间**表现。
 *
 * 需求（2026-11-07）：「魔术师播放【移形换影】在本体位置播放【瞬间移动特效】」。
 *
 * ## 为什么路径写在代码里，而不是配表
 *
 * 移形换影是**行为技能**：它的全部参数都压在 `pvpSkillPlan.skillParamJson` 上
 * （`blinkCooldown` / `blinkDamageRate` …），而那张表只有数值槽，没有造型槽；
 * `pvpSkill`（有 `effectPrefabPath` 的那张）里根本没有这一行。
 * 于是「施法闪一下」这张图没有任何配置列可以承载 —— 与「普攻爆炸」
 * （`ZCAttackResolutionSystem` 里同样硬编码了 `units/projectiles/普攻爆炸/普攻爆炸`）
 * 是同一类情况：**表现是这套行为的一部分，不是某张表的列**。
 *
 * ## ⚠️ 它必须被 `ZCVisualResourcePlan` 收进本局特效清单
 *
 * `ZCGameLoader` 只加载 `buildZCVisualResourcePlan()` 算出来的路径。硬编码的路径如果
 * 不进那张清单，运行时 `effectVisualPrefabs.get()` 就是 `null` ⇒ 技能照常结算、
 * 屏幕上**一次闪都没有**，而且一条错都不报（2026-11-03 追踪导弹就是这么消失的）。
 * 所以那边按「本局有没有 `blink_strike` 的技能计划」把这条路径加进去。
 *
 * ⚠️ 本文件必须保持**无 `cc` 依赖**（同 `ZCCombatEffectPlacement` / `ZCCombatEffectScale`），
 * 否则这些常量就没法在没有引擎的环境里被用例直接断言。
 */

/** 「瞬间移动特效」预制体路径（`assets/bundles/battle/` 分包根下的相对路径）。 */
export const ZC_BLINK_CAST_EFFECT_PREFAB_PATH = 'units/projectiles/瞬间移动特效/瞬间移动特效';

/**
 * 这条特效在场上存活多久（秒）= 动画 clip 的时长。
 *
 * 18 帧 / sample 24 = 0.75s（`tools/build_blink_fx.py` 生成）。事件时长与 clip 必须一致：
 * 短了会「图还没播完就被回收」，长了会留一段停在末帧的静止闪光。
 */
export const ZC_BLINK_CAST_EFFECT_SECONDS = 0.75;

/** 触发这条表现的行为键。 */
export const ZC_BLINK_CAST_BEHAVIOR_KEY = 'blink_strike';

/**
 * 行为键 → 施法瞬间的特效路径；不是移形换影就返回 `null`（不插任何事件）。
 *
 * 收成一个函数而不是让两处各自比较字符串：触发系统决定「播不播」、
 * 资源计划决定「加不加载」，**这两件事必须是同一个判据**，否则又是一次
 * 「结算了但没图」或者「加载了但永远不播」。
 */
export function zcBlinkCastEffectPath(behaviorKey: string | null | undefined): string | null {
    return behaviorKey === ZC_BLINK_CAST_BEHAVIOR_KEY ? ZC_BLINK_CAST_EFFECT_PREFAB_PATH : null;
}
