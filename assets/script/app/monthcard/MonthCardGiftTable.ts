/**
 * 月卡礼包数据口径 —— 纯逻辑，不 import cc，可单测。
 *
 * 注意：
 * - monthCardActPlan.rmb 存的是 payChannel.id，不是价格；价格来自 payChannel.rmb。
 * - plan 与 limitTimeCardResId 是两套 id。
 * - 界面页签按 type 切（1=福利月卡、2=超值月卡）。
 */

import { spriteFramePath } from '../ArtPaths';
import { FALLBACK_RES_ICON_ART, resIconRoot } from '../common/ResTypes';

/** 一条特权。 */
export interface IMonthCardGiftPrivilege {
    readonly desc: string;
    readonly type: number;
    readonly value: number;
}

/** 一条奖励。 */
export interface IMonthCardGiftReward {
    readonly resId: number;
    readonly number: number;
    readonly name: string;
    /** 图标资源路径；空串 = 不加载。 */
    readonly iconArt: string;
}

/** 一张月卡。 */
export interface IMonthCardGift {
    readonly plan: number;
    readonly type: number;
    readonly title: string;
    readonly price: number;
    readonly payId: number;
    readonly continueDays: number;
    readonly privileges: readonly IMonthCardGiftPrivilege[];
    readonly buyReward: IMonthCardGiftReward | null;
    readonly dayRewards: readonly IMonthCardGiftReward[];
    readonly dotArt: string;
}

/** 单张卡服务器状态。 */
export interface IMonthCardGiftState {
    readonly claimedToday: boolean;
    readonly activityResId: number;
}

/** 条目三态：未购买 / 可领取 / 续费。 */
export type MonthCardGiftPhase = 'unbought' | 'claimable' | 'renew';

/** 一次界面刷新的全部数据。 */
export interface IMonthCardGiftSnapshot {
    readonly gifts: readonly IMonthCardGift[];
    readonly states: ReadonlyMap<number, IMonthCardGiftState>;
    readonly endTimes: ReadonlyMap<number, number>;
    readonly now: number;
}

/** 一张卡渲染到界面的形态。 */
export interface IMonthCardGiftView {
    readonly gift: IMonthCardGift;
    readonly phase: MonthCardGiftPhase;
    readonly bought: boolean;
    readonly endTimeMs: number;
    readonly remainMs: number;
    readonly claimedToday: boolean;
    readonly layoutDy: number;
    readonly boughtTagDy: number;
}

// ============================================================
// 常量
// ============================================================

export const MONTH_CARD_TYPE_WELFARE = 1;
export const MONTH_CARD_TYPE_PREMIUM = 2;

/** 整块上移像素。 */
export const MONTHCARD_LAYOUT_DY: Readonly<Record<number, number>> = {
    1: -28,
    2: -5,
};

/** 已购买角标额外上移像素。 */
export const MONTHCARD_BOUGHT_TAG_DY: Readonly<Record<number, number>> = {
    1: -2,
};

export const MONTHCARD_RENEW_LABEL = '续费';
export const MONTHCARD_TIP_DAILY_NOT_TAKEN = 'MONTH_CARD_DAILY_REWARD_NOT_TAKE';

/**
 * 已导入的货币图标名（预加载清单，顺序 = 银币 / 晶石 / 体力 / 金币 / 经验）。
 *
 * ⚠️ 值从 `common/ResTypes.FALLBACK_RES_ICON_ART` 取 —— 那是全工程货币图标的唯一出口
 * （真源 `roleProperty.json` 的 `icon` 列）。原先这里是 5 个字面量手抄，改一个货币要动多处。
 */
export const MONTHCARD_IMPORTED_CURRENCY_ART: readonly string[] = [
    FALLBACK_RES_ICON_ART.gold,
    FALLBACK_RES_ICON_ART.gem,
    FALLBACK_RES_ICON_ART.end,
    FALLBACK_RES_ICON_ART.coin,
    FALLBACK_RES_ICON_ART.exp,
];

/** roleProperty.resId 上界，超过走 item 表。 */
export const MONTHCARD_ROLE_PROPERTY_MAX_RES_ID = 9999;

export const MONTH_CARD_ACT_TYPE = 1002;
export const MONTH_CARD_ACT_TYPE_2 = 1006;

const DAY_MS = 86400000;

// ============================================================
// 工具函数
// ============================================================

/** Long / string / number 统一成毫秒；非法值返回 0。 */
export function toMillis(value: unknown): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    if (value && typeof value === 'object') {
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
 * 剩余时长展示：
 * > 1 天显示整天数，≤ 1 天显示 hh:mm:ss。
 */
export function formatRemain(remainMs: number): { readonly day: string; readonly isDayUnit: boolean } {
    const totalSeconds = Math.floor(Math.max(0, remainMs) / 1000);
    if (totalSeconds > 86400) {
        return { day: String(Math.floor(totalSeconds / 86400)), isDayUnit: true };
    }
    const hh = Math.floor(totalSeconds / 3600);
    const mm = Math.floor((totalSeconds % 3600) / 60);
    const ss = totalSeconds % 60;
    const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
    return { day: `${pad(hh)}:${pad(mm)}:${pad(ss)}`, isDayUnit: false };
}

function num(value: unknown, fallback = 0): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function str(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

/** 解析奖励列表。 */
function parseRewards(
    value: unknown,
    nameByResId: ReadonlyMap<number, { name: string; iconArt: string }>,
): IMonthCardGiftReward[] {
    if (!Array.isArray(value)) return [];
    const out: IMonthCardGiftReward[] = [];
    for (const raw of value) {
        if (!raw || typeof raw !== 'object') continue;
        const row = raw as Record<string, unknown>;
        const resId = num(row.resId);
        const count = num(row.number);
        if (!Number.isSafeInteger(resId) || resId <= 0 || count <= 0) continue;
        const meta = nameByResId.get(resId);
        out.push({
            resId,
            number: count,
            name: meta ? meta.name : '',
            iconArt: meta ? meta.iconArt : '',
        });
    }
    return out;
}

/** 解析特权列表。 */
function parsePrivileges(value: unknown): IMonthCardGiftPrivilege[] {
    if (!Array.isArray(value)) return [];
    const out: IMonthCardGiftPrivilege[] = [];
    for (const raw of value) {
        if (!raw || typeof raw !== 'object') continue;
        const row = raw as Record<string, unknown>;
        const desc = str(row.desc);
        if (desc.length === 0) continue;
        const param = row.param && typeof row.param === 'object' ? (row.param as Record<string, unknown>) : {};
        out.push({ desc, type: num(row.type), value: num(param.value) });
    }
    return out;
}

function resolveIconArtForCurrency(iconName: string): string {
    return MONTHCARD_IMPORTED_CURRENCY_ART.includes(iconName) ? iconName : '';
}

/**
 * 建 resId → { name, iconArt } 映射。
 * 货币走 roleProperty，物品走 item。
 */
export function buildRewardMeta(
    roleRows: readonly unknown[],
    itemRows: readonly unknown[],
): Map<number, { name: string; iconArt: string }> {
    const meta = new Map<number, { name: string; iconArt: string }>();
    for (const raw of roleRows) {
        if (!raw || typeof raw !== 'object') continue;
        const row = raw as Record<string, unknown>;
        const resId = num(row.resId);
        if (!Number.isSafeInteger(resId) || resId <= 0) continue;
        meta.set(resId, { name: str(row.name), iconArt: resolveIconArtForCurrency(str(row.icon)) });
    }
    for (const raw of itemRows) {
        if (!raw || typeof raw !== 'object') continue;
        const row = raw as Record<string, unknown>;
        const resId = num(row.resId);
        if (!Number.isSafeInteger(resId) || resId <= 0 || meta.has(resId)) continue;
        const iconPath = str(row.icon);
        meta.set(resId, {
            name: str(row.name),
            iconArt: iconPath.startsWith('icons/') ? iconPath : '',
        });
    }
    return meta;
}

/** payChannel 行 → id → 实付金额。 */
export function buildPriceResolver(payRows: readonly unknown[]): (payId: number) => number {
    const priceById = new Map<number, number>();
    for (const raw of payRows) {
        if (!raw || typeof raw !== 'object') continue;
        const row = raw as Record<string, unknown>;
        const id = num(row.id);
        if (!Number.isSafeInteger(id) || id <= 0) continue;
        priceById.set(id, num(row.rmb));
    }
    return (payId: number) => priceById.get(payId) ?? 0;
}

/** monthCardActPlan 行 → 月卡数组（按 plan 升序）。 */
export function buildGifts(
    planRows: readonly unknown[],
    priceOf: (payId: number) => number,
    rewardMeta: ReadonlyMap<number, { name: string; iconArt: string }>,
): IMonthCardGift[] {
    const out: IMonthCardGift[] = [];
    for (const raw of planRows) {
        if (!raw || typeof raw !== 'object') continue;
        const row = raw as Record<string,unknown>;
        const plan = num(row.plan);
        const type = num(row.type);
        if (!Number.isSafeInteger(plan) || plan <= 0) continue;
        if (!Number.isSafeInteger(type) || type <= 0) continue;

        const payId = num(row.rmb);
        const buyRewards = parseRewards(row.buyReward, rewardMeta);
        out.push({
            plan,
            type,
            title: str(row.desc),
            price: priceOf(payId),
            payId,
            continueDays: num(row.continueDays),
            privileges: parsePrivileges(row.privilege),
            buyReward: buyRewards.length > 0 ? buyRewards[0] : null,
            dayRewards: parseRewards(row.dayReward, rewardMeta),
            dotArt: type === MONTH_CARD_TYPE_PREMIUM ? 'priv_dot_rich' : 'priv_dot_normal',
        });
    }
    out.sort((a, b) => a.plan - b.plan);
    return out;
}

/** 活动缓存 → plan → 状态。 */
export function buildStates(
    activityCmds: readonly unknown[],
    activityRows: readonly unknown[],
): Map<number, IMonthCardGiftState> {
    const refByResId = new Map<number, { type: number; plan: number }>();
    for (const raw of activityRows) {
        if (!raw || typeof raw !== 'object') continue;
        const row = raw as Record<string, unknown>;
        const resId = num(row.resId);
        if (!Number.isSafeInteger(resId) || resId <= 0) continue;
        refByResId.set(resId, { type: num(row.type), plan: num(row.plan) });
    }

    const states = new Map<number, IMonthCardGiftState>();
    for (const raw of activityCmds) {
        if (!raw || typeof raw !== 'object') continue;
        const cmd = raw as Record<string, unknown>;
        const refId = num(cmd.activityRefId);
        const ref = refByResId.get(refId);
        if (!ref) continue;
        if (ref.type !== MONTH_CARD_ACT_TYPE && ref.type !== MONTH_CARD_ACT_TYPE_2) continue;
        if (!Number.isSafeInteger(ref.plan) || ref.plan <= 0) continue;

        const detailWrap = cmd.detail && typeof cmd.detail === 'object'
            ? (cmd.detail as Record<string, unknown>)
            : null;
        const detailRaw = ref.type === MONTH_CARD_ACT_TYPE
            ? detailWrap?.monthCardActDetail
            : detailWrap?.monthCardActDetail2;
        const detail = detailRaw && typeof detailRaw === 'object'
            ? (detailRaw as Record<string, unknown>)
            : null;

        states.set(ref.plan, {
            claimedToday: detail?.todayTake === true,
            activityResId: num(cmd.openResId),
        });
    }
    return states;
}

/** 三态判定。 */
export function phaseOf(bought: boolean, hasDayReward: boolean, claimedToday: boolean): MonthCardGiftPhase {
    if (!bought) return 'unbought';
    if (hasDayReward && !claimedToday) return 'claimable';
    return 'renew';
}

export function layoutDyOf(type: number): number {
    return MONTHCARD_LAYOUT_DY[type] ?? 0;
}

export function boughtTagDyOf(type: number): number {
    return MONTHCARD_BOUGHT_TAG_DY[type] ?? 0;
}

/** 一张卡 → 视图形态。过期等价于未购买。 */
export function buildView(
    gift: IMonthCardGift,
    endTimeMs: number,
    state: IMonthCardGiftState | undefined,
    nowMs: number,
): IMonthCardGiftView {
    const remainMs = endTimeMs > 0 ? endTimeMs - nowMs : 0;
    const bought = remainMs > 0;
    const claimedToday = state?.claimedToday === true;
    return {
        gift,
        bought,
        endTimeMs: bought ? endTimeMs : 0,
        remainMs: bought ? remainMs : 0,
        claimedToday,
        phase: phaseOf(bought, gift.dayRewards.length > 0, claimedToday),
        layoutDy: layoutDyOf(gift.type),
        boughtTagDy: boughtTagDyOf(gift.type),
    };
}

/** 一次快照 → 全部卡视图。 */
export function buildViews(snapshot: IMonthCardGiftSnapshot): IMonthCardGiftView[] {
    return snapshot.gifts.map((gift) =>
        buildView(
            gift,
            snapshot.endTimes.get(gift.plan) ?? 0,
            snapshot.states.get(gift.plan),
            snapshot.now,
        ),
    );
}

/**
 * 守卫：卡有效期内且有每日奖励且今天没领 → 必须先领奖励。
 */
export function mustTakeDailyRewardFirst(
    endTimeMs: number,
    hasDayReward: boolean,
    claimedToday: boolean,
    nowMs: number,
): boolean {
    if (endTimeMs - nowMs <= 0) return false;
    if (!hasDayReward) return false;
    return !claimedToday;
}

/** 货币奖励装配路径；iconArt 为空返回空串。 */
export function currencyRewardFramePath(iconArt: string): string {
    // 目录走 `resIconRoot`（默认 `icons/resource`，3 张例外查覆盖表）—— 与
    // `resolveRewardIconRef` 同口径：写死 `RESOURCE_ICON_ART_ROOT` 会让 `图标_经验值`
    // 这类例外**静默**加载失败（只留白）。
    return iconArt.length > 0 ? spriteFramePath(resIconRoot(iconArt), iconArt) : '';
}
