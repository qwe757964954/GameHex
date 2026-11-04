/**
 * 战斗特效的**尺寸口径**，两张互不相干的表：
 *
 * | 表 | 管什么 | 输入 | 输出 |
 * | :-- | :-- | :-- | :-- |
 * | `zcHitFxScale` / `zcHitFxNodeScale` | 受击闪白「跟着被打的兵多大」 | `pvpCard.prefabSize` | 乘在**闪白节点**的烘焙值上 |
 * | `zcCombatEffectNodeScaleOf` | 这张技能特效**本身**该多大 | prefab 路径 | 乘在**特效宿主节点**上 |
 *
 * 前者是 2026-10-31 需求（各类受击特效匹配受击目标的体型），后者是 2026-11-03 需求
 * （椰蛋战士的龙卷风整体缩到 80%）。两者作用在**不同的节点**上，不会互相抵消。
 *
 * ## 受击闪白：为什么系数取 `pvpCard.prefabSize`
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
 * ## 受击闪白：为什么要「基准 × 系数」而不是直接 `setScale(系数)`
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

/**
 * 按**特效 prefab 路径**登记整体尺寸倍率（乘在特效宿主节点上，基准 1 = 美术原样）。
 *
 * ## 与上面 `prefabSize` 那套的区别
 *
 * 上面管的是「受击闪白该跟受击目标多大」，系数来自单位的 `pvpCard.prefabSize`；
 * 这张表管的是「这张特效本身就该多大」，是**策划对单个技能的尺寸口径**，
 * 与命中谁无关。两者作用在**不同的节点**上（`hitFx` 是独立的一份池化节点），
 * 不会互相抵消。
 *
 * ## 为什么要有它
 *
 * 2026-11-03 需求：「椰蛋战士的龙卷风技能…特效的范围和预制大小整体缩小成 80%，
 * 同时碰撞范围要匹配」。`area` 类地面区域的**视觉尺寸 100% 来自 prefab 的烘焙缩放**
 * （`ZCCombatEffectView` 不按 `event.radius` 缩放 —— 半径只参与结算），
 * 所以「视觉缩到 80%」只能在这里挂一个倍率；
 * 「碰撞范围跟着缩」则是另一件事，落在配表 `pvpSkill.areaRadius`（30 → 24，×0.8）。
 * 两处必须**同步改**，否则就是「看着变小、判定没变」。
 *
 * ⚠️ 只登记需要偏离美术原尺寸的特效。默认 `1`，没登记的一律原样。
 */
const NODE_SCALE_BY_PREFAB_PATH: Readonly<Record<string, number>> = {
    // 30831「椰蛋战士·暴风」（每 5 次普攻的强化那一击，走 `on_cast_end_spawn_zone` 生成 3 道旋风）。
    // 预制体自身：根节点 scale 1 + 子节点 `offset` scale 2、contentSize 128×154
    // ⇒ 屏上约 256×308。乘 0.8 后约 205×246，与 `areaRadius` 24（世界 7.2px）同比例收缩。
    'units/projectiles/椰蛋战士_暴风/椰蛋战士_暴风': 0.8,
    // 镭射飞龙「追踪导弹」的爆炸（`镭射飞龙_导弹技能命中`，225×215 单帧画布）。
    // 需求 2026-11-03：「爆炸范围约 80px，特效大小需要匹配范围」。
    // 80 ÷ 225 ≈ 0.356 —— 与配表 `strikeSplashRadius` 80 同一个数，改半径只改这一处 + 配表。
    'units/projectiles/镭射飞龙_导弹技能命中/镭射飞龙_导弹技能命中': 80 / 225,
};

/**
 * 特效路径 → 宿主节点的整体倍率；未登记 = `1`（美术原样）。
 *
 * 非法值（`NaN` / `≤0` / 非数字）一律退回 `1`：宁可尺寸没改，也不能把节点缩成 0
 * 让整条特效静默消失。
 */
export function zcCombatEffectNodeScaleOf(
    effectPrefabPath: string | null | undefined,
): number {
    if (!effectPrefabPath) return 1;
    const scale = NODE_SCALE_BY_PREFAB_PATH[effectPrefabPath];
    if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) return 1;
    return scale;
}
