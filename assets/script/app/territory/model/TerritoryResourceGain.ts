import { TERRITORY_SILVER_RES_ID, TERRITORY_STAMINA_RES_ID } from './TerritoryIdleReward';

/**
 * 领地「资源点 / 挂机」发奖的表现分流（山猫 2026-10-15 定）。
 *
 * ## 为什么要分流
 *
 *  领地发下来的奖励里，**银币（`resId 7`）与体力（`resId 9`）直接进钱包**，玩家在顶部
 *  钱包行就能看到数值变化；再弹一次「恭喜获得」弹窗是重复反馈，还会挡住地图。
 *  道具（其余 `resId`）进领地库存、界面上看不到增量 ⇒ **必须**靠弹窗告知。
 *
 * ⇒ 口径：**7 / 9 走「icon + 数字升起」飘字，其余走奖励弹窗**；一批奖励里两类都有时
 *  **逐条分开处理**（各走各的通道），不是整批二选一。
 *
 * ⚠️ `7 / 9` 不是本文件自造的字面量：真源是 `TerritoryIdleReward` 里那两个
 *  `roleProperty` 常量（`idleRewardDestinationOf` 也在用它判钱包去向），改表要改那里。
 */
export const TERRITORY_WALLET_RES_IDS: readonly number[] = [
    TERRITORY_SILVER_RES_ID,
    TERRITORY_STAMINA_RES_ID,
];

/** 转出真源：飘字要按 id 选图标（银币 / 体力各一张图），别在调用方再抄一份 7 / 9。 */
export { TERRITORY_SILVER_RES_ID, TERRITORY_STAMINA_RES_ID };

/** 一条奖励的最小形状：两种来源（`ITerritoryGrantedReward` / `TerritoryIdleRewardGain`）都满足。 */
export interface ITerritoryRewardEntry {
    readonly resId: number;
    readonly amount: number;
}

export interface ITerritoryRewardSplit<T> {
    /** resId 7 / 9 ⇒ 走飘字。 */
    readonly gains: readonly T[];
    /** 其余 ⇒ 走奖励弹窗。 */
    readonly popup: readonly T[];
}

/** 这条奖励是不是「直接进钱包」的资源（进钱包才用飘字替代弹窗）。 */
export function isTerritoryWalletResId(resId: unknown): boolean {
    const id = Number(resId);
    if (!Number.isFinite(id)) return false;
    return TERRITORY_WALLET_RES_IDS.includes(id);
}

/**
 * 按 resId 把一批奖励分成「飘字 / 弹窗」两组。
 *
 * ⚠️ **保持原顺序**：飘字先后即视觉上下顺序，弹窗顺序即 `ShowRewardPage` 的格序，
 * 用 `filter` 两次而不是一次遍历塞两个数组也能保序，但两处判据会各自漂移 ⇒ 单一循环。
 */
export function splitTerritoryRewards<T extends ITerritoryRewardEntry>(
    rewards: readonly T[],
): ITerritoryRewardSplit<T> {
    const gains: T[] = [];
    const popup: T[] = [];
    for (const reward of rewards ?? []) {
        if (reward && isTerritoryWalletResId(reward.resId)) gains.push(reward);
        else popup.push(reward);
    }
    return { gains, popup };
}

// ============================================================
// 升起曲线（纯函数，零 cc —— 与 `TerritoryHexFlip` 同一套路）
// ============================================================

/** 一条飘字的总时长（秒）。 */
export const TERRITORY_GAIN_SECONDS = 1.15;
/** 整条飘字期间向上飘多少像素。 */
export const TERRITORY_GAIN_RISE_PX = 96;
/** 入场段（缩放弹出 + 大部分位移）占整条时长的比例；之后是淡出段。 */
export const TERRITORY_GAIN_ENTRANCE_RATIO = 0.32;
/** 入场段末尾的峰值缩放（>1 才看得见"弹一下"）。 */
export const TERRITORY_GAIN_POP_SCALE = 1.18;
/** 入场段的起始缩放。 */
export const TERRITORY_GAIN_FROM_SCALE = 0.6;
/** 同一格同时飘多条（银币 + 体力）时的纵向间距。 */
export const TERRITORY_GAIN_STACK_GAP_PX = 40;
/** 飘字起点相对**格心**的抬升（压在格子上方一点，别盖住建筑图标）。 */
export const TERRITORY_GAIN_START_LIFT_PX = 30;

export interface ITerritoryGainFx {
    /** 相对起点的纵向位移（像素，向上为正）。 */
    readonly offsetY: number;
    readonly scale: number;
    /** 0 → 1（淡出用）。 */
    readonly opacity: number;
}

function easeOutCubic(t: number): number {
    const p = Math.min(1, Math.max(0, t));
    return 1 - (1 - p) * (1 - p) * (1 - p);
}

/**
 * 播到第 `elapsed` 秒时的表现参数；`null` = 已播完（该回收了）。
 *
 * 位移用**整条**的 easeOutCubic（快起慢收，收尾时几乎悬停，数字看得清）；
 * 缩放在入场段 `0.6 → 1.18` 弹出、淡出段回落到 1；不透明度只在淡出段衰减
 * （`1 - fade²` ⇒ 前段几乎不淡，最后才消失）。
 */
export function territoryGainFx(elapsed: number): ITerritoryGainFx | null {
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= TERRITORY_GAIN_SECONDS) return null;
    const progress = elapsed / TERRITORY_GAIN_SECONDS;
    const offsetY = TERRITORY_GAIN_RISE_PX * easeOutCubic(progress);
    if (progress < TERRITORY_GAIN_ENTRANCE_RATIO) {
        const entrance = easeOutCubic(progress / TERRITORY_GAIN_ENTRANCE_RATIO);
        const scale = TERRITORY_GAIN_FROM_SCALE
            + (TERRITORY_GAIN_POP_SCALE - TERRITORY_GAIN_FROM_SCALE) * entrance;
        return { offsetY, scale, opacity: 1 };
    }
    const fade = (progress - TERRITORY_GAIN_ENTRANCE_RATIO) / (1 - TERRITORY_GAIN_ENTRANCE_RATIO);
    const scale = TERRITORY_GAIN_POP_SCALE
        + (1 - TERRITORY_GAIN_POP_SCALE) * easeOutCubic(fade);
    return { offsetY, scale, opacity: 1 - fade * fade };
}
