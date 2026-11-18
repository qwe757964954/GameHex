/**
 * 特效路径 → 叠加色（2026-11-18 第 17 批：「飓风要绿色」）。
 *
 * 需求原话：「飓风的颜色可以修改成绿色（叠加颜色的方式）」。
 *
 * 为什么按 prefab 路径而不是技能 id：同一份美术会被多条技能复用 —— `风法师_龙卷风` 既是
 * 三叶小丑强化那一击的飓风（`pvpSkill` 36251）、也是风炮菇 101303「孢爆箭」命中点留下的那片区域。
 * 画出来是哪张图才决定它该是什么颜色，与 `ZCCombatEffectPlacement` 的 `ANCHOR_BY_PREFAB_PATH` /
 * `LAYER_BY_PREFAB_PATH` 同一套口径。
 *
 * 🔴 **「叠加」= 乘算**（`final = 原色 × 叠加色 ÷ 255`），不是直接覆盖：
 * 覆盖会把美术调过的明暗关系抹平（高光变纯绿、暗部变死绿），乘算保留层次、只把色相推过去。
 * 所以这张表里给的 `[96, 255, 128]` 读作「保留绿通道、红压到 38%、蓝压到 50%」，
 * 而不是「把每个像素都刷成这个值」。
 *
 * 本文件必须保持无 `cc` 依赖（同 `ZCCombatEffectScale` / `ZCCombatEffectPlacement`）：
 * 表与混色都是纯函数，单测在无引擎环境下直接跑；`Color` 的构造留给 `ZCCombatEffectView`。
 */

/** `[r, g, b]`，0~255。alpha 不参与叠加（透明走宿主 `UIOpacity`，见 `ZCCombatEffectView`）。*/
export type ZCCombatEffectTint = readonly [number, number, number];

/**
 * 只登记需要改色的 prefab，未登记 = 保持原色。
 *
 * 数值口径：叠 `[255, 255, 255]` 等于不变；每个通道按 `原色 × 表值 ÷ 255` 相乘。
*/
const TINT_BY_PREFAB_PATH: Readonly<Record<string, ZCCombatEffectTint>> = {
    //  风炮菇 101303「孢爆箭」命中点留下的飓风。三叶小丑那份原本是青蓝色系，
    //  设计要的是「绿色的飓风」⇒ 红压到 38%、蓝压到 50%、绿拉满，乘算后呈青绿。
    'units/projectiles/风法师_龙卷风/风法师_龙卷风': [96, 255, 128],
};

/** 特效路径 → 叠加色；未登记 / 空路径 ⇒ `null`（视图按原色渲染，绝不偷偷改别的特效）。*/
export function zcCombatEffectTintOf(
    effectPrefabPath: string | null | undefined,
): ZCCombatEffectTint | null {
    if (!effectPrefabPath) return null;
    const tint = TINT_BY_PREFAB_PATH[effectPrefabPath];
    if (!tint) return null;
    //  表写错（少通道 / 非数字）时退回原色，而不是把特效染成黑色。
    for (const channel of tint) {
        if (!Number.isFinite(channel)) return null;
    }
    return tint;
}

/**
 * 乘算混色。`alpha` 原样保留（透明度不在这条链上）。
 *
 * 逐通道 `Math.round(base * tint / 255)` 并夹在 0~255：`Color` 构造器虽然也会夹，
 * 但先夹一次可以让单测直接比整数，不必关心引擎侧的截断行为。
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
