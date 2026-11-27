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
    zcSelfAuraLandingPath as catalogSelfAuraLandingPath,
} from './ZCEffectCatalog';
import { ZC_EFFECT_SCALE } from './ZCEffectTuning';

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

export const ZC_SELF_AURA_LANDING_ANGLE_DEGREES = ZC_EFFECT_SCALE.selfAuraLandingAngleDegrees;
export const ZC_SELF_AURA_LANDING_SECONDS = ZC_EFFECT_SCALE.selfAuraLandingSeconds;

export function zcSelfAuraLandingPath(
    behaviorKey: string | null | undefined,
    unitId?: string | null,
): string | null {
    return catalogSelfAuraLandingPath(behaviorKey, unitId);
}
