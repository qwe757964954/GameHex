/**
 * 首充礼包（新首充）的数据口径 —— **纯逻辑，不 import `cc`，可在 Node 单测里直接跑**。
 *
 * 移植自老客户端 `client/assets/script/app/game/`：
 *   - 配置表  `firstRechargeNew`（4 档，每档 3 天奖励）+ `payChannel`（rmb → 实付金额）
 *   - 服务器  `CmdFirstRechargeNew.infos[]`，每项 `{ id, active, activeTime, takenIds }`
 *   - 判定    `ModelFirstRecharge.IsRewarded / CanReward / GetRewardDay / GetRdByTab`
 *   - 界面    `LayerFirstRechargeUI.UpdateView / refreshSelect`（tab 显示规则、按钮文案）
 *
 * 老客户端里这些判定散在 `ModelFirstRecharge`（依赖 DI 容器、TimeUtil、ModelMgr）里，
 * 没法单测。这里全部收敛成**传参的纯函数**：
 *   - 时间一律走参数 `now`（毫秒），不读 `Date.now()` —— 测试才能定住「第几天」；
 *   - 表行只做「读字段 + 归一化」，解析失败的行走跳过策略，不抛异常。
 *
 *  关键口径（照抄老客户端，别"顺手优化"）：
 *   ① `takenIds[day - 1] > 0` 才是已领 —— 数组下标从 0 起，长度不足时按未领处理；
 *   ② 第 `N` 天可领的条件是 `N <= 今天`（今天 = 从 activeTime 当天 0 点起的第几天）；
 *   ③ tab 只显示前两档；第 3 档起**必须第 2 档已激活**才出现（渐进解锁）。
 */

/** 一条奖励：`{ resId, number }`（与 `CmdGoods` 同口径）。 */
export interface IFirstRechargeReward {
    readonly resId: number;
    readonly number: number;
}

/** 配置表 `firstRechargeNew` 的一行（原样，未归一化）。 */
export interface IFirstRechargeRow {
    readonly id: number;
    readonly rmb: number;
    readonly desc: string;
    readonly rewards1?: unknown;
    readonly rewards2?: unknown;
    readonly rewards3?: unknown;
}

/** 归一化后的一档礼包。 */
export interface IFirstRechargeTier {
    readonly id: number;
    /** `payChannel.id`（服务端 `CmdFirstRechargesBuyReqMsg.id` 用的就是这个值）。 */
    readonly rmb: number;
    /** 实付金额（元），来自 `payChannel.rmb`；查不到时为 0。 */
    readonly price: number;
    /** 档位名（`firstRechargeNew.desc`，如「史诗皮肤」）。 */
    readonly desc: string;
    /** 3 天的奖励（固定长度 `FIRST_RECHARGE_DAYS`，缺配置的那天是空数组）。 */
    readonly days: readonly (readonly IFirstRechargeReward[])[];
}

/** 服务器下发的单档状态（`CmdFirstRechargeNewItem` 的窄化视图）。 */
export interface IFirstRechargeState {
    readonly id: number;
    /** 是否已购买（激活）。 */
    readonly active: boolean;
    /** 激活时间（毫秒）；用来算「今天是第几天」。 */
    readonly activeTime: number;
    /** 已领取的天：`taken[day - 1] > 0` 即第 day 天已领。 */
    readonly taken: readonly number[];
}

/** 某档某一天的领取状态。 */
export type FirstRechargeDayState =
    /** 还没买这一档 —— 所有天都不可领。 */
    | 'unbought'
    /** 买了，但这天还没到。 */
    | 'locked'
    /** 买了、这天到了、还没领。 */
    | 'claimable'
    /** 已经领过。 */
    | 'taken';

/** 礼包固定 3 天（`firstRechargeNew` 的 `rewards1..3`）。 */
export const FIRST_RECHARGE_DAYS = 3;

/** 前两档常显；第 3 档起要等第 2 档激活。 */
export const FIRST_RECHARGE_ALWAYS_VISIBLE_TIERS = 2;

const DAY_MS = 86400000;

/** `Long` / `string` / `number` 统一成毫秒数；非法值返回 0。 */
export function toMillis(value: unknown): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    if (value && typeof value === 'object') {
        // protobufjs 的 Long：`{ low, high, unsigned }`（有 toNumber 就优先用它）
        const long = value as { toNumber?: () => number; low?: number; high?: number };
        if (typeof long.toNumber === 'function') {
            const parsed = long.toNumber();
            return Number.isFinite(parsed) ? parsed : 0;
        }
        if (typeof long.low === 'number' && typeof long.high === 'number') {
            return long.high * 4294967296 + (long.low >>> 0);
        }
    }
    return 0;
}

/** 本地时区当天 0 点（毫秒）。 */
export function startOfDay(timeMs: number): number {
    const date = new Date(timeMs);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}

/**
 * 「今天是激活后的第几天」，0 = 还没到激活日。
 *
 * 对齐老客户端 `TimeUtil.getDay(time)`：**以 activeTime 当天的 0 点为第一天**，
 * 不是按 24 小时滚动。所以 23:50 买、第二天 00:10 就能领第 2 天。
 */
export function dayOfActiveTime(activeTimeMs: number, nowMs: number): number {
    if (!Number.isFinite(activeTimeMs) || activeTimeMs <= 0) return 0;
    const start = startOfDay(activeTimeMs);
    if (nowMs < start) return 0;
    return Math.floor((nowMs - start) / DAY_MS) + 1;
}

/** 单个奖励条目的解析；字段不合法返回 `null`。 */
function parseReward(value: unknown): IFirstRechargeReward | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    const resId = Number(row.resId);
    const count = Number(row.number ?? row.count ?? 1);
    if (!Number.isSafeInteger(resId) || resId <= 0) return null;
    if (!Number.isFinite(count) || count <= 0) return null;
    return { resId, number: Math.floor(count) };
}

/** 解析一天的奖励数组；`rewards1..3` 缺失时给空数组。 */
function parseDayRewards(value: unknown): readonly IFirstRechargeReward[] {
    if (!Array.isArray(value)) return [];
    const out: IFirstRechargeReward[] = [];
    for (const entry of value) {
        const reward = parseReward(entry);
        if (reward) out.push(reward);
    }
    return out;
}

/**
 * 配置表行 → 档位列表。
 *
 * `priceOf(rmb)` 由调用方提供（生产环境 = `payChannel.id → rmb` 的查表函数），
 * 这样本文件不依赖 `RefUtil`，单测里可以直接喂一个假函数。
 * 非法行（`id` 不是正整数）直接跳过 —— 单行坏数据不该让整个弹窗打不开。
 */
export function buildTiers(
    rows: readonly unknown[],
    priceOf: (payChannelId: number) => number,
): IFirstRechargeTier[] {
    const tiers: IFirstRechargeTier[] = [];
    const seen = new Set<number>();
    for (const value of rows) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        const row = value as Record<string, unknown>;
        const id = Number(row.id);
        if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) continue;
        seen.add(id);
        const rmb = Number(row.rmb);
        const payChannelId = Number.isSafeInteger(rmb) && rmb > 0 ? rmb : 0;
        const price = payChannelId > 0 ? Number(priceOf(payChannelId)) : 0;
        tiers.push({
            id,
            rmb: payChannelId,
            price: Number.isFinite(price) ? price : 0,
            desc: typeof row.desc === 'string' ? row.desc : '',
            days: [
                parseDayRewards(row.rewards1),
                parseDayRewards(row.rewards2),
                parseDayRewards(row.rewards3),
            ],
        });
    }
    return tiers;
}

/**
 * `payChannel` 行 → `id → rmb` 查表函数。
 *
 * 老客户端读的是 `RefMgrpayChannel.getRef("id", ref.rmb).rmb` —— 同一个字段名两处含义
 * （`firstRechargeNew.rmb` 是**支付渠道 id**，`payChannel.rmb` 才是**金额**），
 * 这里用 `priceOf` 把这条歧义收在一处，调用方不用记。
 */
export function buildPriceResolver(rows: readonly unknown[]): (payChannelId: number) => number {
    const prices = new Map<number, number>();
    for (const value of rows) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        const row = value as Record<string, unknown>;
        const id = Number(row.id);
        const rmb = Number(row.rmb);
        if (!Number.isSafeInteger(id) || id <= 0) continue;
        if (!Number.isFinite(rmb) || rmb <= 0) continue;
        prices.set(id, rmb);
    }
    return (payChannelId: number) => prices.get(payChannelId) ?? 0;
}

/** 服务器 `infos[]` → `id → 状态`。 */
export function buildStateMap(infos: readonly unknown[] | null | undefined): Map<number, IFirstRechargeState> {
    const map = new Map<number, IFirstRechargeState>();
    if (!infos) return map;
    for (const value of infos) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        const row = value as Record<string, unknown>;
        const id = Number(row.id);
        if (!Number.isSafeInteger(id) || id <= 0) continue;
        const taken: number[] = [];
        if (Array.isArray(row.takenIds)) {
            for (const entry of row.takenIds) {
                const count = Number(entry);
                taken.push(Number.isFinite(count) ? count : 0);
            }
        }
        map.set(id, {
            id,
            active: row.active === true,
            activeTime: toMillis(row.activeTime),
            taken,
        });
    }
    return map;
}

/**
 * 某档某天的状态。
 *
 * 严格照抄老客户端 `IsRewarded` / `CanReward`：
 *   `IsRewarded(id, day)` = `active && taken[day-1] > 0`
 *   `CanReward(id, day)`  = `active && day <= 今天 && taken[day-1] == 0`
 */
export function dayStateOf(
    state: IFirstRechargeState | undefined,
    day: number,
    nowMs: number,
): FirstRechargeDayState {
    if (!state || !state.active) return 'unbought';
    if (takenOf(state, day) > 0) return 'taken';
    return day <= dayOfActiveTime(state.activeTime, nowMs) ? 'claimable' : 'locked';
}

/** `taken[day - 1]`；越界或 `day` 非法按 0（= 未领）。 */
export function takenOf(state: IFirstRechargeState, day: number): number {
    if (!Number.isSafeInteger(day) || day < 1) return 0;
    const value = state.taken[day - 1];
    return Number.isFinite(value) ? value : 0;
}

/**
 * 第一个可领的天（1..3）；没有可领的返回 0。
 *
 * 对齐老客户端 `ModelFirstRecharge.GetRewardDay(id)` —— 界面点「领取」时用它当 `day` 参数。
 * 注意：**只返回第一个**，所以「第 1 天没领、第 2 天可领」时点一次先领第 1 天。
 */
export function claimableDayOf(state: IFirstRechargeState | undefined, nowMs: number): number {
    if (!state || !state.active) return 0;
    for (let day = 1; day <= FIRST_RECHARGE_DAYS; day++) {
        if (dayStateOf(state, day, nowMs) === 'claimable') return day;
    }
    return 0;
}

/** 某一档的红点（0 / 1）：`active && 有可领的天`；对齐 `GetRdByTab`。 */
export function tierRedDotOf(state: IFirstRechargeState | undefined, nowMs: number): number {
    return claimableDayOf(state, nowMs) > 0 ? 1 : 0;
}

/**
 * 当前应该显示哪几档的**下标**（原表顺序）。
 *
 * 对齐 `LayerFirstRechargeUI.UpdateView`：
 *   前两档常显；第 3 档起，只有**第 2 档已激活**时才显示（也就是「买了 ¥12 才看到 ¥13/¥14」）。
 * 档位不足两档时按实际数量返回。
 */
export function visibleTierIndexes(
    tiers: readonly IFirstRechargeTier[],
    states: ReadonlyMap<number, IFirstRechargeState>,
): number[] {
    const indexes: number[] = [];
    const unlockAll = tiers.length > 1 && states.get(tiers[1].id)?.active === true;
    for (let i = 0; i < tiers.length; i++) {
        if (i < FIRST_RECHARGE_ALWAYS_VISIBLE_TIERS || unlockAll) indexes.push(i);
    }
    // 表只有 1 档时上面那圈可能什么都没加（`FIRST_RECHARGE_ALWAYS_VISIBLE_TIERS` 是 2）
    if (indexes.length === 0 && tiers.length > 0) indexes.push(0);
    return indexes;
}

/**
 * 底部按钮的状态 —— 界面按它决定文案与可点性。
 *
 * 对齐 `refreshSelect`：
 *   - 未购买 → `'buy'`，文案「¥{price}」
 *   - 已购买 + 有可领的天 → `'claim'`，文案「领取」+ 红点
 *   - 已购买 + 无可领的天 → `'taken'`，文案「已领取」（不可点）
 */
export type FirstRechargeButtonState = 'buy' | 'claim' | 'taken';

export function buttonStateOf(
    state: IFirstRechargeState | undefined,
    nowMs: number,
): FirstRechargeButtonState {
    if (!state || !state.active) return 'buy';
    return claimableDayOf(state, nowMs) > 0 ? 'claim' : 'taken';
}
