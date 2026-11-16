/**
 * 「累计充值」页的数据解析与视图组装，纯函数、无引擎依赖。
 *
 * 活动实例来自 `CmdActivity` 缓存，`activityTab` 决定页签文案，`rechargeGiftActPlan`
 * 提供档位。需要注意：
 *
 * - `1003` / `1004` / `1005` 三种活动的 `detail` 字段名和进度字段不同，统一在 `readDetail` 收口；
 * - `activityTab.id = 3` 使用 `1003`，`id = 4` 的列表使用 `1004`、宝箱使用 `1005`；
 * - 档位行排序为已领取沉底，其余按 `rechargeProcess` 升序。
 */

// ============================================================
// 常量
// ============================================================

/** 活动类型（= `activity.type`，与老端 `ActivityType` 同值）。 */
export const RECHARGE_ACTIVITY_TYPE = {
    /** 充值好礼 —— 页签「累计充值」列表用的那组（`plan 1`）。 */
    payGift: 1003,
    /** 充值豪礼（一）—— 页签「充值好礼」列表用的那组（`plan 2`），并决定该页签显不显示。 */
    payGift1: 1004,
    /** 充值豪礼（二）—— 顶部宝箱那组（`plan 3`）。 */
    payGift2: 1005,
} as const;

/** `activityTab.id` —— 与老端 `ActivityTabBtn` 同值（`evenyDay=1, monthCard=2, payGift=3, payGift2=4`）。 */
export const RECHARGE_TAB = {
    /** 页签「累计充值」（老端 `ActivityTabBtn.payGift`，controller 页名「基础」）。 */
    base: 3,
    /** 页签「充值好礼」（老端 `ActivityTabBtn.payGift2`，controller 页名「高级」）。 */
    advanced: 4,
} as const;

// ============================================================
// 输入
// ============================================================

/** `rechargeGiftActPlan` 表一行（档位）。 */
export interface IRechargeActPlanRow {
    readonly plan: number;
    /** 该档位要求的累计充值金额（元）。 */
    readonly rechargeProcess: number;
    readonly rechargeReward: readonly IRechargeReward[];
}

/** 一条奖励。 */
export interface IRechargeReward {
    readonly resId: number;
    readonly number: number;
}

/** `activityTab` 表一行。 */
export interface IRechargeTabRow {
    readonly id: number;
    /** 「活动介绍」气泡的正文。 */
    readonly desc: string;
}

/** `activity` 表一行。 */
export interface IRechargeActivityRow {
    readonly resId: number;
    readonly type: number;
    readonly plan: number;
}

/** 归一化后的一个已开启充值活动实例。 */
export interface IRechargeActivityInfo {
    /** 领奖请求要传的 `resId`（`cmd.openResId`）。 */
    readonly id: number;
    readonly activityType: number;
    readonly plan: number;
    /** 当前已累计充值金额；无 `detail` 时为 0。 */
    readonly curProcess: number;
    /** 已领取的档位（`rechargeProcess` 列表）。 */
    readonly takenProcesses: readonly number[];
    /** `detail` 是否存在；用于区分「服务器未下发进度」和「已下发但未达标」。 */
    readonly hasDetail: boolean;
}

// ============================================================
// 视图
// ============================================================

/** 档位行的三态（= 老端 controller「状态」的三个页名）。 */
export type RechargeRowState = 'undone' | 'claimable' | 'taken';

/** 档位行视图。 */
export interface IRechargeTotalRowView {
    readonly rechargeProcess: number;
    readonly curProcess: number;
    readonly state: RechargeRowState;
    readonly rewards: readonly IRechargeReward[];
}

/** 顶部宝箱视图。 */
export interface IRechargeBoxView {
    readonly rechargeProcess: number;
    readonly curProcess: number;
    readonly taken: boolean;
    /** 可点（`curProcess >= rechargeProcess`）。 */
    readonly touchable: boolean;
    readonly reward: IRechargeReward | null;
}

/** 一页（`base` 或 `advanced`）渲染要的全部。 */
export interface IRechargeTotalPageView {
    /** 活动实例 `id`（`openResId`）；`0` 表示该页签没有开启的活动。 */
    readonly activityId: number;
    readonly rows: readonly IRechargeTotalRowView[];
    /** 顶部宝箱；空数组表示不显示。 */
    readonly boxes: readonly IRechargeBoxView[];
    readonly progressMax: number;
    readonly progressValue: number;
    readonly desc: string;
    /** 「充值好礼」页签是否显示，由 `1004` 活动是否存在决定。 */
    readonly advancedTabVisible: boolean;
    /** 该页签是否有可领取的奖励，用于红点。 */
    readonly hasClaimable: boolean;
}

// ============================================================
// 解析表
// ============================================================

function toRewards(value: unknown): IRechargeReward[] {
    if (!Array.isArray(value)) return [];
    const out: IRechargeReward[] = [];
    for (const item of value) {
        if (!item || typeof item !== 'object') continue;
        const resId = Number((item as { resId?: unknown }).resId);
        const number = Number((item as { number?: unknown }).number);
        if (!Number.isSafeInteger(resId) || resId <= 0) continue;
        out.push({ resId, number: Number.isFinite(number) ? number : 1 });
    }
    return out;
}

function toNumberArray(value: unknown): number[] {
    if (!Array.isArray(value)) return [];
    const out: number[] = [];
    for (const item of value) {
        const n = Number(item);
        if (Number.isFinite(n)) out.push(n);
    }
    return out;
}

/** `rechargeGiftActPlan` 表 → 档位行。 */
export function parseRechargeActPlanRows(value: unknown): IRechargeActPlanRow[] {
    if (!Array.isArray(value)) return [];
    const out: IRechargeActPlanRow[] = [];
    for (const row of value) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
        const r = row as Record<string, unknown>;
        const plan = Number(r.plan);
        const rechargeProcess = Number(r.rechargeProcess);
        if (!Number.isSafeInteger(plan) || plan <= 0) continue;
        if (!Number.isFinite(rechargeProcess) || rechargeProcess <= 0) continue;
        out.push({ plan, rechargeProcess, rechargeReward: toRewards(r.rechargeReward) });
    }
    return out;
}

/** `activityTab` 表 → `id` 索引。 */
export function parseRechargeTabRows(value: unknown): Map<number, IRechargeTabRow> {
    const map = new Map<number, IRechargeTabRow>();
    if (!Array.isArray(value)) return map;
    for (const row of value) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
        const r = row as Record<string, unknown>;
        const id = Number(r.id);
        if (!Number.isSafeInteger(id) || id <= 0) continue;
        map.set(id, {
            id,
            desc: typeof r.desc === 'string' ? r.desc : '',
        });
    }
    return map;
}

/** `activity` 表 → `resId` 索引。 */
export function parseRechargeActivityRows(value: unknown): Map<number, IRechargeActivityRow> {
    const map = new Map<number, IRechargeActivityRow>();
    if (!Array.isArray(value)) return map;
    for (const row of value) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
        const r = row as Record<string, unknown>;
        const resId = Number(r.resId);
        if (!Number.isSafeInteger(resId) || resId <= 0) continue;
        map.set(resId, {
            resId,
            type: Number(r.type),
            plan: Number(r.plan),
        });
    }
    return map;
}

// ============================================================
// 读活动实例
// ============================================================

/**
 * 按 `activity.type` 取那三种进度结构，**归一成同一个形状**。
 *
 * 字段名差异见文件头 ①：`1003` 用 `curRechargeProcess` / `tlTakeRechargeProcess`，
 * 其余两个用 `curProcess` / `tlTakeProcess`。这里一次性收口，外面不必再关心。
 */
function readDetail(
    detail: unknown,
    activityType: number,
): { readonly curProcess: number; readonly taken: readonly number[] } | null {
    if (!detail || typeof detail !== 'object') return null;
    const d = detail as Record<string, unknown>;

    if (activityType === RECHARGE_ACTIVITY_TYPE.payGift) {
        const raw = d.rechargeGiftActDetail;
        if (!raw || typeof raw !== 'object') return null;
        const r = raw as Record<string, unknown>;
        return { curProcess: Number(r.curRechargeProcess) || 0, taken: toNumberArray(r.tlTakeRechargeProcess) };
    }
    if (activityType === RECHARGE_ACTIVITY_TYPE.payGift1) {
        const raw = d.cmdRechargeGiftAct2Detail;
        if (!raw || typeof raw !== 'object') return null;
        const r = raw as Record<string, unknown>;
        return { curProcess: Number(r.curProcess) || 0, taken: toNumberArray(r.tlTakeProcess) };
    }
    if (activityType === RECHARGE_ACTIVITY_TYPE.payGift2) {
        const raw = d.cmdRechargeGiftAct3Detail;
        if (!raw || typeof raw !== 'object') return null;
        const r = raw as Record<string, unknown>;
        return { curProcess: Number(r.curProcess) || 0, taken: toNumberArray(r.tlTakeProcess) };
    }
    return null;
}

/**
 * `CmdActivity` 缓存 + `activity` 表 → 已开启的充值活动实例（只保留三种充值类型）。
 *
 * 老端 `GetVoActivitySubSet` 是「按 `tlType` 过滤后取第一个」；这里一次把所有充值活动都归一化出来，
 * 由调用方按 `type` 挑（页签要 `1003`/`1004`、宝箱要 `1005`，一次读表就够）。
 */
export function readRechargeActivities(
    cmdActivityRows: unknown,
    activityTable: ReadonlyMap<number, IRechargeActivityRow>,
): IRechargeActivityInfo[] {
    const out: IRechargeActivityInfo[] = [];
    if (!Array.isArray(cmdActivityRows)) return out;

    for (const row of cmdActivityRows) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
        const r = row as Record<string, unknown>;

        const activityRefId = Number(r.activityRefId);
        const definition = Number.isSafeInteger(activityRefId) ? activityTable.get(activityRefId) : undefined;
        if (!definition) continue;

        const activityType = definition.type;
        if (
            activityType !== RECHARGE_ACTIVITY_TYPE.payGift &&
            activityType !== RECHARGE_ACTIVITY_TYPE.payGift1 &&
            activityType !== RECHARGE_ACTIVITY_TYPE.payGift2
        ) {
            continue;
        }

        const id = Number(r.openResId);
        if (!Number.isSafeInteger(id) || id <= 0) continue;

        const progress = readDetail(r.detail, activityType);
        out.push({
            id,
            activityType,
            plan: definition.plan,
            curProcess: progress ? progress.curProcess : 0,
            takenProcesses: progress ? progress.taken : [],
            hasDetail: progress !== null,
        });
    }
    return out;
}

// ============================================================
// 判定与组装
// ============================================================

/** 取某页签该用哪个活动。 */
function pickActivityForTab(
    activities: readonly IRechargeActivityInfo[],
    tab: number,
): IRechargeActivityInfo | null {
    const wanted = tab === RECHARGE_TAB.advanced
        ? RECHARGE_ACTIVITY_TYPE.payGift1
        : RECHARGE_ACTIVITY_TYPE.payGift;
    return activities.find((activity) => activity.activityType === wanted) ?? null;
}

/** 取顶部宝箱那个活动（老端 `subSet2` = `type 1005`）。 */
export function pickBoxActivity(activities: readonly IRechargeActivityInfo[]): IRechargeActivityInfo | null {
    return activities.find((a) => a.activityType === RECHARGE_ACTIVITY_TYPE.payGift2) ?? null;
}

/** 页签「充值好礼」是否显示。 */
function isAdvancedTabVisible(activities: readonly IRechargeActivityInfo[]): boolean {
    return activities.some((a) => a.activityType === RECHARGE_ACTIVITY_TYPE.payGift1);
}

/** 单行三态判定。 */
function rechargeRowState(
    rechargeProcess: number,
    curProcess: number,
    takenProcesses: readonly number[],
    hasDetail: boolean,
): RechargeRowState {
    if (!hasDetail) return 'undone';
    if (takenProcesses.includes(rechargeProcess)) return 'taken';
    if (curProcess >= rechargeProcess) return 'claimable';
    return 'undone';
}

/** 该活动的档位行。 */
function rowsOfPlan(
    planRows: readonly IRechargeActPlanRow[],
    plan: number,
): IRechargeActPlanRow[] {
    return planRows.filter((row) => row.plan === plan);
}

/** 排序：已领取沉底，其余按 `rechargeProcess` 升序。 */
function sortRechargeRows(
    rows: readonly IRechargeActPlanRow[],
    takenProcesses: readonly number[],
): IRechargeActPlanRow[] {
    const taken = new Set(takenProcesses);
    return rows.slice().sort((a, b) => {
        const aTaken = taken.has(a.rechargeProcess);
        const bTaken = taken.has(b.rechargeProcess);
        if (aTaken && !bTaken) return 1;
        if (!aTaken && bTaken) return -1;
        return a.rechargeProcess - b.rechargeProcess;
    });
}

/**
 * 组装一页的视图。
 *
 * `tab` 决定列表用哪个活动；宝箱恒取 `type 1005`（老端 `UpdateRewards` 里 `subSet2`），
 * 且**只在非基础页签才画**（老端 `if (voActivity == null || this.isBase)` 直接落「未开启」）。
 */
export function buildRechargeTotalPageView(
    tab: number,
    activities: readonly IRechargeActivityInfo[],
    planRows: readonly IRechargeActPlanRow[],
    tabRows: ReadonlyMap<number, IRechargeTabRow>,
): IRechargeTotalPageView {
    const isBase = tab !== RECHARGE_TAB.advanced;
    const activity = pickActivityForTab(activities, tab);
    const tabRow = tabRows.get(tab);
    const desc = tabRow ? tabRow.desc : '';
    const advancedTabVisible = isAdvancedTabVisible(activities);

    // ---- 列表 ----
    const rows: IRechargeTotalRowView[] = [];
    let progressMax = 0;
    let progressValue = 0;
    let hasClaimable = false;

    if (activity) {
        const planRowsOfActivity = sortRechargeRows(
            rowsOfPlan(planRows, activity.plan),
            activity.takenProcesses,
        );
        for (const row of planRowsOfActivity) {
            const state = rechargeRowState(
                row.rechargeProcess,
                activity.curProcess,
                activity.takenProcesses,
                activity.hasDetail,
            );
            if (state === 'claimable') hasClaimable = true;
            if (row.rechargeProcess > progressMax) progressMax = row.rechargeProcess;
            rows.push({
                rechargeProcess: row.rechargeProcess,
                curProcess: activity.curProcess,
                state,
                rewards: row.rechargeReward,
            });
        }
        progressValue = activity.curProcess;
    }

    const boxes: IRechargeBoxView[] = [];
    const boxActivity = pickBoxActivity(activities);
    if (!isBase && boxActivity) {
        const boxRows = rowsOfPlan(planRows, boxActivity.plan);
        for (const row of boxRows) {
            const taken = boxActivity.takenProcesses.includes(row.rechargeProcess);
            const touchable = boxActivity.hasDetail && boxActivity.curProcess >= row.rechargeProcess;
            if (!taken && touchable) hasClaimable = true;
            boxes.push({
                rechargeProcess: row.rechargeProcess,
                curProcess: boxActivity.curProcess,
                taken,
                touchable,
                reward: row.rechargeReward[0] ?? null,
            });
        }
    }

    return {
        activityId: activity ? activity.id : 0,
        rows,
        boxes,
        progressMax,
        progressValue,
        desc,
        advancedTabVisible,
        hasClaimable,
    };
}

/** 两个页签任一有可领奖励即亮红点。 */
export function rechargeTotalRedDot(
    activities: readonly IRechargeActivityInfo[],
    planRows: readonly IRechargeActPlanRow[],
): boolean {
    for (const tab of [RECHARGE_TAB.base, RECHARGE_TAB.advanced]) {
        const view = buildRechargeTotalPageView(tab, activities, planRows, new Map());
        if (view.hasClaimable) return true;
    }
    return false;
}
