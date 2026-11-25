/** 受击闪白与技能特效节点缩放计算 */

import { zcEffectNodeScaleOf } from '../model/ZCEffectCatalog';

export const ZC_HIT_FX_FALLBACK_SCALE = 1;

/** 目标受击特效缩放（缺省或非法值回退 1，兼容无 prefabSize 的旧数据） */
export function zcHitFxScale(targetScale: number | null | undefined): number {
    if (typeof targetScale !== 'number' || !Number.isFinite(targetScale) || targetScale <= 0) {
        return ZC_HIT_FX_FALLBACK_SCALE;
    }
    return targetScale;
}

/** 按烘焙基准重算节点缩放，避免池化复用时累乘 */
export function zcHitFxNodeScale(
    bakedScale: number,
    targetScale: number | null | undefined,
): number {
    const base = Number.isFinite(bakedScale) && bakedScale > 0 ? bakedScale : 1;
    return base * zcHitFxScale(targetScale);
}

/** 特效路径对应的节点倍率，未登记返回 1（area 类特效缩放需与配表 areaRadius 同步） */
export function zcCombatEffectNodeScaleOf(
    effectPrefabPath: string | null | undefined,
): number {
    return zcEffectNodeScaleOf(effectPrefabPath);
}

/** 入场缩放系数（ease-out quad）。growSeconds 无效时返回满尺寸 1，防止一直停在 growFrom */
export function zcCombatEffectGrowFactor(
    growSeconds: number | null | undefined,
    ageSeconds: number,
    growFrom?: number | null,
): number {
    if (typeof growSeconds !== 'number' || !Number.isFinite(growSeconds) || growSeconds <= 0) return 1;
    if (!Number.isFinite(ageSeconds)) return 1;
    const from = typeof growFrom === 'number' && Number.isFinite(growFrom)
        ? Math.max(0, Math.min(1, growFrom))
        : 0;
    const t = Math.max(0, Math.min(1, ageSeconds / growSeconds));
    return from + (1 - from) * (1 - (1 - t) * (1 - t));
}

export {
    zcBurstEffectScale,
} from '../model/ZCBurstFx';
export {
    zcRayBeamEffectScale,
} from '../model/ZCRayBeamFx';
export {
    zcBarrageImpactScale,
} from '../model/ZCWindBarrageFx';
export {
    ZC_EFFECT_SCALE,
} from '../model/ZCEffectTuning';
