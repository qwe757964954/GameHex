/**
 * 特效路径 → 叠加色。
 *
 * 按 prefab 路径而不是技能 id：同一份美术会被多条技能复用 —— `风法师_龙卷风` 既是
 * 三叶小丑强化那一击的飓风（`pvpSkill` 36251），也是风炮菇 101303「孢爆箭」命中点
 * 留下的那片区域。画出来是哪张图才决定它该是什么颜色。
 *
 * 「叠加」= 乘算（`final = 原色 × 叠加色 ÷ 255`），不是直接覆盖：
 * 覆盖会把美术调过的明暗关系抹平，乘算保留层次、只把色相推过去。
 * 表与混色都是纯函数；`Color` 的构造留给 `ZCCombatEffectView`。
 */

import type { ZCEffectTint } from '../model/ZCEffectCatalog';
import { zcEffectTintOf } from '../model/ZCEffectCatalog';

/** `[r, g, b]`，0~255。alpha 不参与叠加（透明走宿主 `UIOpacity`）。*/
export type ZCCombatEffectTint = ZCEffectTint;

/** 特效路径 → 叠加色；未登记 / 空路径 / 通道非法 ⇒ `null`（视图按原色渲染）。*/
export function zcCombatEffectTintOf(
    effectPrefabPath: string | null | undefined,
): ZCCombatEffectTint | null {
    return zcEffectTintOf(effectPrefabPath);
}

/**
 * 乘算混色。`alpha` 原样保留（透明度不在这条链上）。
 *
 * 逐通道 `Math.round(base * tint / 255)` 并夹在 0~255：先夹一次可以让单测直接比整数，
 * 不必关心引擎侧的截断行为。
 */
export function zcBlendCombatEffectTint(
    base: readonly [number, number, number],
    tint: ZCCombatEffectTint,
): [number, number, number] {
    const mix = (value: number, factor: number): number => {
        const scaled = Math.round((value * factor) / 255);
        return scaled < 0 ? 0 : (scaled > 255 ? 255 : scaled);
    };
    return [mix(base[0], tint[0]), mix(base[1], tint[1]), mix(base[2], tint[2])];
}
