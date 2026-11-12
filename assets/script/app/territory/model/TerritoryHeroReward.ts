/**
 * 「奖励飞向英雄按钮」与「英雄碎片进度长满」的**纯函数真源**（零 `cc`）。
 *
 * ## 需求（2026-11-10）
 *
 * 1. 固定格打开时，卡牌碎片 / 种族经验这些「往上飞」的粒子，**终点改成底部「英雄」按钮**；
 *    落地时英雄按钮播「粒子飞入」的抖动受击反馈。
 * 2. 随机格拿到的碎片 / 经验，也**补一段飞向英雄按钮**的动画。
 * 3. 某英雄「碎片累计满 + 种族经验累计满」时，在英雄按钮上方播
 *    「碎片 icon + 进度条」徽标：进度从当前比例长到 100%，然后整个 UI 消失；
 *    多个英雄按排序优先级**逐个**播放。
 *
 * ## 口径（用户在 2026-11-10 确认）
 *
 * · 飞行范围：**只改非钱包类**（非 `resId 7/9`）奖励；银币 / 体力仍飞顶部资源栏并保留数字跳动。
 * · 触发条件：**仅本次新达成** —— 领奖前 `canUpgrade === false`、把本次奖励叠进背包后变成 `true`。
 * · 进度条起点：该英雄**当前**碎片 `owned / need`（截图里约 60%），补到 100% 后整个徽标消失。
 *
 * ## 为什么都在一个 model 里
 *
 * 三条需求共用同一个「哪些奖励算碎片/经验」的判据与同一个目标节点；把判据散到
 * `wireRewardCatch` / `playCellGains` / 进度源三处，就会出现「固定格飞了、随机格没飞」这类
 * 半接线。这里只放纯函数与接口，**不碰任何节点、不读任何表**。
 */

import { isTerritoryWalletResId } from './TerritoryResourceGain';

// ============================================================
// ① 判据：哪些奖励要飞向英雄按钮
// ============================================================

/**
 * 「碎片 / 经验类」奖励 = **非钱包类**（非 `resId 7` 银币 / `9` 体力）且 id 合法。
 *
 * ⚠️ 不是按 `18xxx 碎片 / 16xxx 经验` 白名单判：固定格奖励组里还有 `10010` 随机兵种卷轴、
 *    `19xxx` 专属道具，它们同样没有资源栏落点，用户要的是「那些现在堆在屏幕顶部中央的图标」
 *    整体改道。`7 / 9` 的真源在 `TerritoryIdleReward`，这里只复用 `isTerritoryWalletResId`。
 */
export function isTerritoryHeroRewardResId(resId: unknown): boolean {
    const id = Number(resId);
    return Number.isFinite(id) && id > 0 && !isTerritoryWalletResId(id);
}

/** 从一批奖励里挑出要飞向英雄按钮的部分（保序；脏值 / 非正数丢掉）。 */
export function collectTerritoryHeroRewards<T extends { readonly resId: number; readonly amount: number }>(
    rewards: readonly T[],
): T[] {
    const picked: T[] = [];
    for (const reward of rewards ?? []) {
        if (!reward || !isTerritoryHeroRewardResId(reward.resId)) continue;
        if (!Number.isFinite(Number(reward.amount)) || Number(reward.amount) <= 0) continue;
        picked.push(reward);
    }
    return picked;
}

// ============================================================
// ② 随机格：从格心飞到英雄按钮的时间轴
// ============================================================

/** 一次飞行最多几枚图标（与固定格 Fly 层「按奖励量分档」同义，但随机格只补一段轻动画）。 */
export const TERRITORY_HERO_FLIGHT_MAX_COUNT = 8;

/** 单枚飞行的时长（秒）。比开箱那套 2.3~3.2s 短得多：随机格本来就有喷发 + 读数。 */
export const TERRITORY_HERO_FLIGHT_SECONDS = 0.62;

/** 相邻两枚的错峰（秒）。 */
export const TERRITORY_HERO_FLIGHT_STAGGER = 0.055;

/** 二次贝塞尔控制点的拱高系数（乘 |dy|）。 */
export const TERRITORY_HERO_FLIGHT_ARC_RATIO = 0.42;

/**
 * 这一批飞几枚：按「奖励种类」放大一点点（一格只给 1 种经验也别只飞孤零零一枚），
 * 再钳到上限。随机格本来就有一把喷发 + 一条读数，飞行只是补一段，不需要按数量分三档。
 */
export function territoryHeroFlightCountOf(entryCount: number): number {
    const kinds = Math.max(1, Math.floor(Number(entryCount) || 1));
    return Math.max(2, Math.min(TERRITORY_HERO_FLIGHT_MAX_COUNT, kinds * 2));
}

/** 本批飞行的硬上限（秒）：最后一枚落地即整批收工。 */
export function territoryHeroFlightTotalSeconds(count: number): number {
    const n = Math.max(1, Math.min(TERRITORY_HERO_FLIGHT_MAX_COUNT, Math.floor(count) || 1));
    return TERRITORY_HERO_FLIGHT_SECONDS + (n - 1) * TERRITORY_HERO_FLIGHT_STAGGER;
}

/** 第 `index` 枚的落地时刻（用于「本批只通知按钮抖动一次」）。 */
export function territoryHeroFlightArriveAt(index: number, count: number): number {
    const n = Math.max(1, Math.min(TERRITORY_HERO_FLIGHT_MAX_COUNT, Math.floor(count) || 1));
    const i = Math.max(0, Math.min(n - 1, Math.floor(index)));
    return i * TERRITORY_HERO_FLIGHT_STAGGER + TERRITORY_HERO_FLIGHT_SECONDS;
}

export interface ITerritoryHeroFlightFrame {
    /** 0→1 的贝塞尔进度（已做 easeOutQuad，落地前沿最慢）。 */
    readonly progress: number;
    /** 控制点拱高系数，逐帧略降 ⇒ 尾段贴着目标落下。 */
    readonly arcRatio: number;
    /** 图标缩放：出场 0.7 → 0.18s 长到 1。 */
    readonly scale: number;
    /** 0→1；落地前 18% 快速淡出。 */
    readonly opacity: number;
}

/**
 * 第 `index` 枚在 `elapsed` 秒时的帧；`null` = 还没出发 / 已落地。
 *
 * 与 `TerritoryGainBurst` / `TerritorySilverChestOpen` 同一套路：**纯函数 + `elapsed`**，
 * 不建 tween（节点池化，tween 回收后还会继续写），非法值一律 `null` 而不是抛错。
 */
export function territoryHeroFlightFx(
    elapsed: number,
    index: number,
    count: number,
): ITerritoryHeroFlightFrame | null {
    if (!Number.isFinite(elapsed) || elapsed < 0) return null;
    const n = Math.max(1, Math.min(TERRITORY_HERO_FLIGHT_MAX_COUNT, Math.floor(count) || 1));
    const i = Math.floor(index);
    if (i < 0 || i >= n) return null;
    const t = elapsed - i * TERRITORY_HERO_FLIGHT_STAGGER;
    if (t < 0 || t >= TERRITORY_HERO_FLIGHT_SECONDS) return null;
    const k = t / TERRITORY_HERO_FLIGHT_SECONDS;
    const eased = 1 - (1 - k) ** 2;
    return {
        progress: eased,
        arcRatio: TERRITORY_HERO_FLIGHT_ARC_RATIO * (1 - k * 0.35),
        scale: 0.7 + 0.3 * Math.min(1, k / 0.18),
        opacity: k > 0.82 ? Math.max(0, (1 - k) / 0.18) : 1,
    };
}

// ============================================================
// ③ 英雄按钮上的「碎片进度长满」徽标
// ============================================================

/** 进度从 `from` 长到 1 的时长（秒）。 */
export const TERRITORY_HERO_BADGE_GROW_SECONDS = 0.7;
/** 长满后停一下再消失（秒）。 */
export const TERRITORY_HERO_BADGE_HOLD_SECONDS = 0.2;
/** 整个徽标淡出时长（秒）。 */
export const TERRITORY_HERO_BADGE_FADE_SECONDS = 0.25;
/** 单个英雄一次表演的总时长（秒）；播完才能轮到下一个。 */
export const TERRITORY_HERO_BADGE_TOTAL_SECONDS =
    TERRITORY_HERO_BADGE_GROW_SECONDS + TERRITORY_HERO_BADGE_HOLD_SECONDS + TERRITORY_HERO_BADGE_FADE_SECONDS;

export interface ITerritoryHeroBadgeFrame {
    /** 进度条填充比：从 `from` 长到 1。 */
    readonly progress: number;
    /** 整个徽标的不透明度（1 → 0）。 */
    readonly opacity: number;
}

/**
 * 徽标在 `elapsed` 秒时的帧；`null` = 这一位英雄演完了（队列该出下一个）。
 *
 * · 起点是当前真实进度 `from`（不是 0）—— 用户 2026-11-10 选的口径；
 * · `from` 脏值 / 越界钳到 `[0,1]`；已满是 1 时也能演「保持满 → 消失」；
 * · 增长段 `easeOutCubic`，尾段淡出线性；**缩到 0 即整个 UI 消失**，不叠第二套动画。
 */
export function territoryHeroBadgeFrame(from: number, elapsed: number): ITerritoryHeroBadgeFrame | null {
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= TERRITORY_HERO_BADGE_TOTAL_SECONDS) return null;
    const start = Number.isFinite(from) ? Math.max(0, Math.min(1, from)) : 0;
    const k = Math.min(1, elapsed / TERRITORY_HERO_BADGE_GROW_SECONDS);
    const eased = 1 - (1 - k) ** 3;
    const fadeStart = TERRITORY_HERO_BADGE_GROW_SECONDS + TERRITORY_HERO_BADGE_HOLD_SECONDS;
    const opacity = elapsed <= fadeStart
        ? 1
        : Math.max(0, 1 - (elapsed - fadeStart) / TERRITORY_HERO_BADGE_FADE_SECONDS);
    return {
        progress: start + (1 - start) * eased,
        opacity,
    };
}

// ============================================================
// ④ 新达成英雄的徽标队列
// ============================================================

/** 一位要演「进度长满」的英雄。字段全部是**展示数据**，由组合层注入，视图不查表。 */
export interface ITerritoryHeroBadgeItem {
    readonly cardId: string;
    /** 排序优先级：数值越小越先播（真源是卡库 `sortLineupCards` 的下标）。 */
    readonly priority: number;
    /** 进度条起点 = 当前碎片 `owned / need`，已钳到 `[0,1]`。 */
    readonly from: number;
    /**
     * 碎片道具的 `resId`（`cardLevelUp.costCardID`）。页面用现成的 `ensureRewardIcon` 加载，
     * 查不到图只是空图标、徽标退化成「只有进度条」。`<= 0` = 这一档没配碎片。
     */
    readonly iconResId: number;
}

/**
 * 按排序优先级排好队列；优先级相同时用 `cardId` 兜底，保证**多英雄逐个播放**的顺序稳定。
 *
 * 不改入参（`slice().sort`），与 `sortLineupCards` 同一口径。
 */
export function sortTerritoryHeroBadges(
    items: readonly ITerritoryHeroBadgeItem[],
): ITerritoryHeroBadgeItem[] {
    return (items ?? []).slice().sort((a, b) => {
        const pa = Number.isFinite(a.priority) ? a.priority : Number.MAX_SAFE_INTEGER;
        const pb = Number.isFinite(b.priority) ? b.priority : Number.MAX_SAFE_INTEGER;
        return pa - pb || String(a.cardId).localeCompare(String(b.cardId));
    });
}

/** 一位英雄「领奖前 / 领奖后（叠加本次增量）」的升级判定摘要。 */
export interface ITerritoryHeroUpgradeState {
    readonly cardId: string;
    readonly priority: number;
    /** 领奖前持有的碎片数（进度条起点用）。 */
    readonly cardOwned: number;
    /** 这一级需要的碎片数。 */
    readonly cardNeed: number;
    readonly iconResId: number;
    readonly canUpgradeBefore: boolean;
    readonly canUpgradeAfter: boolean;
    /** 已满级 / 没配升级行 ⇒ 不存在「这一级刚好凑满」，不演。 */
    readonly maxedOrUnconfigured: boolean;
}

/**
 * **仅本次新达成**才入队（用户 2026-11-10 选的口径）：
 * `!canUpgradeBefore && canUpgradeAfter`，且这一级不是满级 / 没配置。
 *
 * 领奖前就已经可升级的英雄**不重复播**；只靠经验涨上来、但本次没凑齐碎片的英雄也不播
 * （`canUpgrade = 碎片够 && 经验够` 由 `CardUpgradeCost.evaluateUpgrade` 给）。
 *
 * 进度条起点 = `cardOwned / cardNeed`（钳到 `[0,1]`），不是 0。
 * 返回值已经按优先级排好，视图直接串行消费。
 */
export function detectTerritoryHeroBadges(
    states: readonly ITerritoryHeroUpgradeState[],
): ITerritoryHeroBadgeItem[] {
    const items: ITerritoryHeroBadgeItem[] = [];
    for (const state of states ?? []) {
        if (!state || state.maxedOrUnconfigured) continue;
        if (state.canUpgradeBefore || !state.canUpgradeAfter) continue;
        const need = Number(state.cardNeed);
        const owned = Number(state.cardOwned);
        const from = need > 0 ? Math.max(0, Math.min(1, owned / need)) : 1;
        items.push({
            cardId: String(state.cardId),
            priority: state.priority,
            from,
            iconResId: state.iconResId,
        });
    }
    return sortTerritoryHeroBadges(items);
}

/** 一次领奖的增量（用于「领奖前 → 领奖后」预测，不依赖服务端缓存何时刷新）。 */
export interface ITerritoryRewardDelta {
    readonly resId: number;
    readonly amount: number;
}

/**
 * **依赖倒置**：英雄状态由组合层（`app/bootstrap/main`）注入，领地页面不反向 import `app/card`。
 *
 * `newlyReady` 只返回「本次新达成」的英雄，且必须已经按优先级排好；
 * 拿不到数据 / 读表失败一律返回空数组 —— 徽标是纯表现，绝不阻断发奖。
 */
export interface ITerritoryHeroProgressSource {
    newlyReady(rewards: readonly ITerritoryRewardDelta[]): Promise<readonly ITerritoryHeroBadgeItem[]>;
}
