/**
 * 命中附加特效（`pvpSkill.impactEffectPrefabPath`）的落点口径。
 *
 * 落点由表里的 `pvpSkill.impactEffectAnchor`（0~1）定，本文件只把它算成坐标。
 * 锚点比例已迁到 `ZCEffectTuning`，本文件保留原导出名与纯函数。
 */

import { ZC_IMPACT_ANCHOR_RATIO } from './ZCEffectTuning';

/** 受击点（默认口径）。*/
export const ZC_IMPACT_ANCHOR_TARGET = ZC_IMPACT_ANCHOR_RATIO.target;

/** 攻守双方中点（运动霸气浪）。*/
export const ZC_IMPACT_ANCHOR_MIDPOINT = ZC_IMPACT_ANCHOR_RATIO.midpoint;

/** 命中附加特效的落点（世界坐标）。*/
export interface ZCImpactEffectAnchor {
    x: number;
    y: number;
}

/**
 * 算一条命中附加特效该落在哪：从受击点朝出手点方向走 `ratio` 的比例。
 *
 * `ratio` 由解析层夹在 0~1；这里再兜一次边界，避免绕过解析层调用时算出屏幕外坐标。
 */
export function zcImpactEffectAnchor(
    ratio: number | undefined,
    fromX: number, fromY: number, toX: number, toY: number,
): ZCImpactEffectAnchor {
    if (!ratio || ratio <= 0) return { x: toX, y: toY };
    if (ratio >= 1) return { x: fromX, y: fromY };
    return { x: toX + (fromX - toX) * ratio, y: toY + (fromY - toY) * ratio };
}
