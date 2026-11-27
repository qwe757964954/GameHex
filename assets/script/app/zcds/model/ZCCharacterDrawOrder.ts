/**
 * 角色（单位 / 野怪）之间的前后关系：**按层次 + 屏幕 y** 排兄弟序，零 `cc` 依赖。
 *
 * 2026-11-26 用户（第 55 批）定下的四条口径：
 * 1. 血条**不**独立于单位（跟着自己单位一起被挡，不做单独一层）；
 * 2. 地面单位按 y 排；**飞行单位与中立资源的野怪整体压在地面之上**；
 * 3. 分身（召出来的）仍强制排在所有普通单位之下；
 * 4. 与墙砖同口径 —— **y 大的先画**（先画 = 排在前面 = 被后面的盖住）。
 *
 * 为什么 y 大的先画：`+y` 在屏幕上是「更靠上 / 更远」。远的东西先画，近的（y 小）后画压上来，
 * 这才有「站在前面的人挡住后面的人」的观感。城墙砖就是这么排的
 *（`ZCWallRenderer`：`b.segment.y - a.segment.y`），单位沿用同一套，别各写一份。
 */

/**
 * 层次（小的先画、即更靠后）：
 * - `0` 分身：永远垫在普通单位之下（用户口径 3；原本靠 `applyUnitDrawOrder` 插队实现）；
 * - `1` 地面：同层内按 y 排；
 * - `2` 空中：飞行单位与野怪，整体压在地面之上（用户口径 2）。
 *
 * 飞行的判定来自卡表 `pvpCard.flying`，野怪来自「这一格是中立野怪」——
 * 两者用同一层，谁更靠前仍由 y 决定（野怪在屏幕上方时会被飞行的兵盖住，符合直觉）。
 */
export type ZCCharacterTier = 0 | 1 | 2;

export const ZC_CHARACTER_TIER_SUMMON: ZCCharacterTier = 0;
export const ZC_CHARACTER_TIER_GROUND: ZCCharacterTier = 1;
export const ZC_CHARACTER_TIER_AIR: ZCCharacterTier = 2;

/**
 * 这一只角色落在哪一层。三个输入都来自模型/配表，不看节点状态：
 * `summon` = 有 `summonMasterId`；`flying` = 卡表 `flying`；`monster` = 中立资源野怪。
 *
 * 分身优先于飞行：一只会飞的分身仍然垫底（用户要的是「分身整体在普通单位之下」）。
 */
export function zcCharacterTierOf(input: {
    readonly summon?: boolean;
    readonly flying?: boolean;
    readonly monster?: boolean;
}): ZCCharacterTier {
    if (input.summon === true) return ZC_CHARACTER_TIER_SUMMON;
    if (input.monster === true || input.flying === true) return ZC_CHARACTER_TIER_AIR;
    return ZC_CHARACTER_TIER_GROUND;
}

/** 排序只需这三样：层、屏幕 y、稳定用的 id。*/
export interface IZCCharacterDrawOrder {
    readonly tier: ZCCharacterTier;
    readonly y: number;
    readonly id: number;
}

/**
 * 比较器（喂给 `Array.prototype.sort`）：层小的先画 → y 大的先画 → id 小的先画。
 *
 * 🔴 `id` 那一档不是装饰：同层同 y（两兵站在同一格、或插值期间刚好重合）时，
 * 没有稳定兜底就会出现「每帧顺序抖一下」，描边和血条跟着闪。id 在同一局内唯一且不变。
 */
export function zcCharacterDrawOrder(a: IZCCharacterDrawOrder, b: IZCCharacterDrawOrder): number {
    if (a.tier !== b.tier) return a.tier - b.tier;
    //  y 可能是 NaN（首帧插值还没跑过）：当成 0，别让比较器返回 NaN 把 sort 弄翻。
    const ay = Number.isFinite(a.y) ? a.y : 0;
    const by = Number.isFinite(b.y) ? b.y : 0;
    if (ay !== by) return by - ay;
    return a.id - b.id;
}
