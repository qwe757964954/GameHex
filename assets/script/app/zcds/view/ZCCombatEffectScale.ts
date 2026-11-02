/**
 * 受击特效的**尺寸口径**：跟着「被打的那只单位」走，而不是所有兵一个固定像素。
 *
 * 2026-10-31 需求：「各类受击特效需要匹配受击目标的模型大小」。
 *
 * ## 为什么系数取 `pvpCard.prefabSize`
 *
 * 「模型有多大」在项目里只有两个可能的来源，实测下来是同一个：
 *  - **spine 单位**：`ZCUnitView` 按骨架 canvas 高归一到 `SPINE_CANVAS_TARGET_HEIGHT`
 *    （69.4 ⇒ 可见高 67.27px），**各兵种骨架差一个数量级的现象被抹平了**，
 *    屏上高只剩 67.27 × `prefabSize`（实测 53.8 ~ 80.7px）；
 *  - **序列帧单位**（`units/*`）：画布 256 压到 98，实测可见高 173~179/256 ⇒ 同样约 67px。
 *
 * ⇒ 全表**唯一**的体型旋钮就是 `prefabSize`（0.8 / 0.9 / 0.95 / 1 / 1.1 / 1.2）。
 * 不要再按骨架 canvas 高或者贴图尺寸另算一套：那两样都已经被归一化吃掉了。
 *
 * ## 为什么要「基准 × 系数」而不是直接 `setScale(系数)`
 *
 * 受击特效 prefab 根的 `_lscale` 是**美术调的烘焙值**，四类还不一样
 * （射手 0.12418 / 战士 0.29333 / 法师 0.05593 / 坦克 & 中毒 0.07098 ⇒ 屏上 61.6~77px）。
 * 那是「基准 1.0 时该多大」的意图，系数只有 0.8~1.2 那么一点 ——
 * 直接写 `setScale(系数)` 会把美术基准整个抹掉，四类闪白全变成同一个尺寸。
 * 所以：**实际缩放 = prefab 根的烘焙值 × `zcHitFxScale(targetScale)`**。
 *
 * ⚠️ 本文件必须保持**无 `cc` 依赖**（同 `ZCCombatEffectPlacement` / `ZCBeamEffect`），
 * 否则这些数字就没法在没有引擎的环境里逐点断言。
 */

/** 查不到 / 非法值时的兜底系数：保持烘焙原样（现有观感），绝不让特效消失或炸掉。 */
export const ZC_HIT_FX_FALLBACK_SCALE = 1;

/**
 * 目标单位 → 受击特效的尺寸系数。
 *
 * @param targetScale 目标单位的 `pvpCard.prefabSize`（模型等比缩放，基准 1）。
 *   传 `undefined` / `null` / `NaN` / `≤0` 一律退回 {@link ZC_HIT_FX_FALLBACK_SCALE} ——
 *   旧存档、旧测试构造的 `ZCHitFx` 都没有这个字段，不能因此把特效缩成 0。
 */
export function zcHitFxScale(targetScale: number | null | undefined): number {
    if (typeof targetScale !== 'number' || !Number.isFinite(targetScale) || targetScale <= 0) {
        return ZC_HIT_FX_FALLBACK_SCALE;
    }
    return targetScale;
}

/**
 * 把「烘焙基准」与「目标系数」乘成实际要写进节点的缩放。
 *
 * 单独抽出来是为了让「池化复用不能累乘」这件事有个唯一入口：
 * 每次播放都从**烘焙基准**重算绝对值，而不是在上一次的节点缩放上再乘一遍
 * （那样第二次就成了 1.2²，池子复用到第 N 次会缩成几十倍）。
 */
export function zcHitFxNodeScale(
    bakedScale: number,
    targetScale: number | null | undefined,
): number {
    const base = Number.isFinite(bakedScale) && bakedScale > 0 ? bakedScale : 1;
    return base * zcHitFxScale(targetScale);
}
