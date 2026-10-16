/**
 * 每日充值（TabGiftEveryDay）的数据与判定 —— 纯函数、零引擎依赖、可单测。
 *
 * 数据来源：
 *   ① 配置表 `rechargeDaily`（`assets/remoteRef/rechargeDaily.json`）：
 *      每行 { round, days, openGainItemNum, rewards[], finishRewards[] }。
 *      round=1 为「60档」、round=2 为「300档」；每档 days 从 1 起。
 *   ② 服务器缓存 `CmdRechargeDaily`：
 *      { rechargeCount, infos: [{ id(=round), day, accDay, takenIds[], accTakenIds[] }] }。
 *
 * 状态口径照搬老端 `VORechargeDaily.GetTakenStateByDay`：
 *   `takenIds[day-1]` 直接就是状态枚举值（不再用 day 比较）：
 *     0 = locked（未解锁）
 *     1 = unlocked（已解锁，充了 openGainItemNum 金币但没领当天奖励）
 *     2 = canReward（可领取）
 *     3 = rewarded（已领取）
 * 累计奖励（顶部那一排宝箱）：`finishRewards` 非空的天才有一格，
 *   领取状态看 `accTakenIds[day-1]`；累计进度看 `accDay`。
 */

// ============================================================
// 输入
// ============================================================

export type RechargeDailyState = 0 | 1 | 2 | 3;

export const RECHARGE_DAILY_STATE = {
    locked: 0,
    unlocked: 1,
    canReward: 2,
    rewarded: 3,
} as const;

/** 表里一条奖励（resId + 数量）。 */
export interface IRechargeDailyReward {
    readonly resId: number;
    readonly number: number;
}

/** rechargeDaily 表一行。 */
export interface IRechargeDailyRow {
    readonly round: number;
    readonly days: number;
    /** 当天充值满 N 金币解锁奖励（60 档 = 60）。 */
    readonly openGainItemNum: number;
    readonly rewards: readonly IRechargeDailyReward[];
    /** 累计达标第 days 天的奖励（非空才在顶部画累计格）。 */
    readonly finishRewards: readonly IRechargeDailyReward[];
}

/** 缓存里某一档（round）的进度。 */
export interface IRechargeDailyRoundProgress {
    /** 本档已充金币数（= CmdRechargeDaily.rechargeCount）。 */
    readonly rechargeCount: number;
    /** 累计已领天数。 */
    readonly accDay: number;
    /** takenIds[day-1] = 每天状态 0~3。 */
    readonly takenIds: readonly number[];
    /** accTakenIds[day-1] = 累计奖励领取状态。 */
    readonly accTakenIds: readonly number[];
}

// ============================================================
// 视图
// ============================================================

/** 每天一行。 */
export interface IRechargeDailyDayView {
    readonly days: number;
    /**
     * 进度条：目标金币数（= 表的 `openGainItemNum`，60 档 / 300 档）。
     *
     * ⚠️ 行标题**不在**这里 —— 文案归 `GiftTexts.RECHARGE_TEXTS.dailyRowTitle`，
     * 界面拿 `days` + `targetCoin` 自己拼（本文件零中文字面量）。
     */
    readonly targetCoin: number;
    /** 进度条：当前已充金币数。 */
    readonly currentCoin: number;
    readonly rewards: readonly IRechargeDailyReward[];
    readonly state: RechargeDailyState;
}

/** 顶部累计奖励格。 */
export interface IRechargeDailyAccRewardView {
    readonly days: number;
    readonly reward: IRechargeDailyReward;
    /** 已领取。 */
    readonly taken: boolean;
}

/** 一档（一个 round）渲染要的全部。 */
export interface IRechargeDailyRoundView {
    readonly round: number;
    /** 已充金币 / 目标总天数 的进度条（顶部）。 */
    readonly accProgress: number;
    readonly accTotal: number;
    readonly accRewards: readonly IRechargeDailyAccRewardView[];
    readonly days: readonly IRechargeDailyDayView[];
}

// ============================================================
// 解析表
// ============================================================

function toRewards(value: unknown): IRechargeDailyReward[] {
    if (!Array.isArray(value)) return [];
    const out: IRechargeDailyReward[] = [];
    for (const item of value) {
        if (!item || typeof item !== 'object') continue;
        const resId = Number((item as { resId?: unknown }).resId);
        const number = Number((item as { number?: unknown }).number);
        if (!Number.isSafeInteger(resId) || resId <= 0) continue;
        out.push({ resId, number: Number.isFinite(number) ? number : 1 });
    }
    return out;
}

/** 表行 → 展示行；字段不全的行跳过。 */
export function parseRechargeDailyRows(value: unknown): IRechargeDailyRow[] {
    if (!Array.isArray(value)) return [];
    const out: IRechargeDailyRow[] = [];
    for (const row of value) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
        const r = row as Record<string, unknown>;
        const round = Number(r.round);
        const days = Number(r.days);
        const openGainItemNum = Number(r.openGainItemNum);
        if (!Number.isSafeInteger(round) || !Number.isSafeInteger(days) || days <= 0) continue;
        out.push({
            round,
            days,
            openGainItemNum: Number.isFinite(openGainItemNum) ? openGainItemNum : 0,
            rewards: toRewards(r.rewards),
            finishRewards: toRewards(r.finishRewards),
        });
    }
    out.sort((a, b) => a.round - b.round || a.days - b.days);
    return out;
}

// ============================================================
// 读缓存
// ============================================================

/**
 * 从 `CmdRechargeDaily` 缓存读每档进度。
 *
 * 老端按 `infos[round - 1]` 下标取；这里按 `id === round` 找更稳（缓存顺序不保证）。
 * 某档没数据时给全 0 的空进度（= 未充值、全部 locked）。
 */
export function readRoundProgresses(cmdRechargeDaily: unknown): Map<number, IRechargeDailyRoundProgress> {
    const map = new Map<number, IRechargeDailyRoundProgress>();
    if (!cmdRechargeDaily || typeof cmdRechargeDaily !== 'object') return map;
    const rechargeCount = Number((cmdRechargeDaily as { rechargeCount?: unknown }).rechargeCount ?? 0);
    const infos = (cmdRechargeDaily as { infos?: unknown }).infos;
    if (!Array.isArray(infos)) return map;
    for (const info of infos) {
        if (!info || typeof info !== 'object') continue;
        const i = info as Record<string, unknown>;
        const round = Number(i.id);
        if (!Number.isSafeInteger(round) || round <= 0) continue;
        const takenIds = Array.isArray(i.takenIds) ? i.takenIds.map(Number) : [];
        const accTakenIds = Array.isArray(i.accTakenIds) ? i.accTakenIds.map(Number) : [];
        map.set(round, {
            rechargeCount: Number.isFinite(rechargeCount) ? rechargeCount : 0,
            accDay: Number(i.accDay ?? 0),
            takenIds,
            accTakenIds,
        });
    }
    return map;
}

// ============================================================
// 视图组装
// ============================================================

function clampState(value: unknown): RechargeDailyState {
    const n = Number(value);
    if (n === 1 || n === 2 || n === 3) return n as RechargeDailyState;
    return 0;
}

/** 组装一档的视图（按 days 升序）。 */
export function buildRoundView(
    round: number,
    rows: readonly IRechargeDailyRow[],
    progress: IRechargeDailyRoundProgress | undefined,
): IRechargeDailyRoundView {
    const myRows = rows.filter((row) => row.round === round);
    const takenIds = progress?.takenIds ?? [];
    const accTakenIds = progress?.accTakenIds ?? [];
    const rechargeCount = progress?.rechargeCount ?? 0;
    const accDay = progress?.accDay ?? 0;

    const days: IRechargeDailyDayView[] = myRows.map((row) => {
        const state = clampState(takenIds[row.days - 1]);
        return {
            days: row.days,
            targetCoin: row.openGainItemNum,
            currentCoin: state === RECHARGE_DAILY_STATE.locked ? 0 : rechargeCount,
            rewards: row.rewards,
            state,
        };
    });

    const accRewards: IRechargeDailyAccRewardView[] = [];
    for (const row of myRows) {
        if (row.finishRewards.length === 0) continue;
        accRewards.push({
            days: row.days,
            reward: row.finishRewards[0],
            taken: Number(accTakenIds[row.days - 1]) === 1,
        });
    }

    return {
        round,
        accProgress: Math.min(accDay, myRows.length),
        accTotal: myRows.length,
        accRewards,
        days,
    };
}

/** 按钮键（文案由界面按 `GiftTexts.RECHARGE_TEXTS` 出）。 */
export type RechargeDailyButtonKey = 'locked' | 'goto' | 'claim' | 'taken';

/** 按钮键：unlocked=去充值 / canReward=领取 / rewarded=已领取 / locked=未解锁。 */
export function dailyButtonKey(state: RechargeDailyState): RechargeDailyButtonKey {
    switch (state) {
        case RECHARGE_DAILY_STATE.unlocked:
            return 'goto';
        case RECHARGE_DAILY_STATE.canReward:
            return 'claim';
        case RECHARGE_DAILY_STATE.rewarded:
            return 'taken';
        default:
            return 'locked';
    }
}

/**
 * 该档（round）有没有可领的奖励 —— 老端 `VORechargeDaily.hasRd(round)`，页签红点用它。
 *
 * 老端口径是「每个 `takenIds`/`accTakenIds` 里等于 `canReward(2)` 就亮」，等价于
 * 「有任一行的状态是 `canReward`」。累计格那边老端误用了 `GetTakenStateByDay`（按天而不是按累计），
 * 这里按语义纠正成「未领取 且 累计达标」，见 `accRewards` 的组装（`accProgress` 已 clamp 到总天数）。
 */
export function roundHasClaimable(view: IRechargeDailyRoundView): boolean {
    if (view.days.some((day) => day.state === RECHARGE_DAILY_STATE.canReward)) return true;
    return view.accRewards.some((acc) => !acc.taken && view.accProgress >= acc.days);
}
