/**
 * 射线集束（ray_beam）的 facade。
 *
 * 路径、行为键与烘焙基准半长已迁到目录/调参表；本文件只保留原导出名与纯函数。
 */

import {
    ZC_EFFECT_BEHAVIOR_KEYS,
    ZC_EFFECT_PATHS,
    zcEffectPathsForBehavior,
} from './ZCEffectCatalog';
import { ZC_EFFECT_SCALE } from './ZCEffectTuning';

/** 向身前打出一道持续若干秒的矩形射线。*/
export const ZC_RAY_BEAM_BEHAVIOR_KEY = ZC_EFFECT_BEHAVIOR_KEYS.rayBeam;

/** 射线的表现：横向雷电束。*/
export const ZC_RAY_BEAM_PREFAB_PATH = ZC_EFFECT_PATHS.lightningImpact;

/** 该 prefab 烘进资产的基准半长（表值逻辑 px）。*/
export const ZC_RAY_BEAM_REFERENCE_HALF_LENGTH = ZC_EFFECT_SCALE.rayBeamReferenceHalfLength;

/** 射线消失时末端光斑的爆点。*/
export const ZC_RAY_BEAM_SPOT_PREFAB_PATH = ZC_EFFECT_PATHS.burstImpact;

/**
 * 事件级缩放：让屏上光束的长度等于判定长度。
 *
 * `halfLength` 传表值（`rayHalfLength`，逻辑 px）；非法值退回 1。
 */
export function zcRayBeamEffectScale(halfLength: number): number {
    if (!Number.isFinite(halfLength) || halfLength <= 0) return 1;
    const scale = halfLength / ZC_RAY_BEAM_REFERENCE_HALF_LENGTH;
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/** 行为键 → 这条车道需要的 prefab 路径；不是这条车道返回空数组。*/
export function zcRayBeamEffectPaths(behaviorKey: string | null | undefined): readonly string[] {
    return behaviorKey === ZC_RAY_BEAM_BEHAVIOR_KEY ? zcEffectPathsForBehavior(behaviorKey) : [];
}
