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
    //
    // 2026-11-05 修正口径：原值是 `80 / 225`（≈0.356），错在三处 ——
    //   ① 把 `strikeSplashRadius` 的**逻辑 px** 当成屏上 px（漏乘 `combatDistanceScale` 与 `view/logical`）；
    //   ② 把**半径**当成直径；③ 拿 225 的**画布**当可见宽度（实际可见内容只占 202）。
    // 正确换算走项目统一口径（docs §1.11；`火焰树妖_灼热地带技能` 的 `AOE_W = 92.25` 同样是
    // 「可见并集宽 = 范围宽」，可作对照）：
    //   屏上 px = 逻辑 px × combatDistanceScale(0.3) × view/logical(2.5625) = 逻辑 px × 0.76875
    // `strikeSplashRadius = 80` 是**半径** ⇒ 直径 160 逻辑 = **屏上 123px**。
    // 分母取 202（第 10/11 帧 `alpha ≥ 8` 的可见内容宽，不是 225 画布）⇒ 123 ÷ 202 ≈ 0.609。
    // 改爆炸半径时只改这一段（配表 `strikeSplashRadius` 同步）。
    'units/projectiles/镭射飞龙_导弹技能命中/镭射飞龙_导弹技能命中': 123 / 202,
    // 镭射飞龙「追踪导弹」的**弹体**（`镭射飞龙_导弹技能`，单节点 81×77、可见内容 79×75）。
    // 需求 2026-11-05：「导弹预制体的 size 调成 0.8」。
    // 宿上倍数 ⇒ 屏上约 63×60，仍比一格（92.25×90）小，与爆炸（0.609）放在一起不会"弹头比爆炸大"。
    // ⚠️ 拖尾（`ZCMissileTrail`）画在**同一个宿主节点**上，也会一起吃这个 0.8，所以拖尾的
    //    长度/宽度在那边是按「本地单位」写的，注释里给了屏上换算。
    'units/projectiles/镭射飞龙_导弹技能/镭射飞龙_导弹技能': 0.8,
    // 鹿神守护（`pvpSkill` 30854 / 计卡 103405）＝「魔术师召唤鹿」spine + 上层循环「火法师火船」。
    // 需求 2026-11-07：「魔术师召唤的鹿 size 太大了，应该只有 100px」。
    //
    // 尺寸口径：`鹿神守护.prefab` 里 spine 节点的 `_lscale` 是 1，sp.Skeleton 的渲染尺寸
    // 只认**骨架 canvas**（prefab 上的 UITransform 不参与渲染，与 `ZCUnitView` 注释同一结论）。
    // `lu.skel` 的 canvas 从二进制头直接读出来是 **657 × 685**（大端 float：x=-236.2 / y=-6.15
    // / w=657 / h=685，与美术预制上那个 UITransform 一致，可互校）⇒ 原来屏上约 657px 宽，
    // 比一个兵（可见高 67px）大近十倍，所以「看着像一座山」。
    //
    // 取「画布高 685 → 100px」：100 / 685 = 0.146。
    // 可见内容 ≈ 画布 × 0.970（`ZCUnitView.SPINE_CANVAS_TARGET_HEIGHT` 的实测比例）
    // ⇒ 屏上可见约 97px，即需求说的「一只 100px 的鹿」。
    //
    // ⚠️ 火船特效是这个 prefab 的**子节点**，倍率挂在宿主上 ⇒ 鹿和火焰**一起按比例缩**，
    //    相对摆位（`fx_火船` 的 92.2 / 150 偏移）与层序都不用跟着改。
    //    只缩鹿、不缩火的话火焰会比鹿还大一圈 —— 那才是真正难调的那种错。
    'units/projectiles/鹿神守护/鹿神守护': 100 / 685,
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

/**
 * 入场「由小变大」的缩放系数（2026-11-07 椰蛋战士「暴风」100504 需求 2：生成后由小变大到当前的大小）。
 *
 * @param growSeconds 生长时长（秒）。`undefined` / `0` / 非法 ⇒ 返回 1（不生长，既有特效逐字不变）
 * @param ageSeconds  事件年龄（`now - startedAt`）
 *
 * 缓动取 **ease-out quad**（`1 - (1-t)²`）：0.3s 这种短入场用线性会显得"一顿"，
 * out-back 又会在末段过冲、把飓风撑得比最终尺寸还大一圈。
 *
 * 系数只乘**最终缩放**，不参与 prefab 尺寸推导 —— 所以美术调大调小仍然只改 prefab 烘焙值。
 */
export function zcCombatEffectGrowFactor(
    growSeconds: number | null | undefined,
    ageSeconds: number,
): number {
    if (typeof growSeconds !== 'number' || !Number.isFinite(growSeconds) || growSeconds <= 0) return 1;
    if (!Number.isFinite(ageSeconds)) return 1;
    const t = Math.max(0, Math.min(1, ageSeconds / growSeconds));
    return 1 - (1 - t) * (1 - t);
}
