/**
 * 「累计充值」页的数据口径 —— 纯函数、零引擎依赖、可单测。
 *
 * 移植自老客户端（`D:\City1001\client`）的**活动体系**（不是直接读 `rechargeGiftActPlan` 表）：
 *   - `model/Activity/ModelActivity.ts`：`GetTlActivityType` / `GetVoActivitySubSet` /
 *     `GetTlRechargeGiftAct` / `hasRechargeTotalByType` / `RequestTakeRechargeGiftActReward`
 *   - `model/vo/Other/VOActivity.ts`：`GetId` / `GetActivityType` / `GetPlan` / `GetRechargeDetail`
 *   - `ctrl/main/gift/TabGiftRechargeTotal.ts`：`Initlist` 的 render / `UpdateList` / `UpdateRewards`
 *
 * ## 数据链路（**活动的实例来自 `CmdActivity` 缓存，不是把表读全**）
 *
 *   `CmdActivity` 缓存（每行 = 一个**已开启**的活动实例）
 *     ├ `openResId`      → 领奖请求要传的 `resId`（老端 `VOActivity.GetId()`）
 *     ├ `activityRefId`  → 查 `activity` 表（主键 `resId`）→ `{ type, name, plan }`
 *     └ `detail`         → 按 `type` 取三种 `RechargeGiftAct*Detail` 之一（见 ②）
 *   `activityTab` 表（主键 `id`）→ 页签 → `tlType` = 该页签收哪些活动类型
 *   `rechargeGiftActPlan` 表（按 `plan` 分组）→ 档位行
 *
 * ## 三处必须照抄的老端口径（都是「写错不报错、只是数值不动」的那种）
 *
 * ① **`type` 与 `detail` 字段不是一一对应**（`VOActivity.GetRechargeDetail()`）：
 *      `1003 RechargeGiftAct`  → `detail.rechargeGiftActDetail`        ← 字段名不同
 *      `1004 RechargeGiftAct1` → `detail.cmdRechargeGiftAct2Detail`
 *      `1005 RechargeGiftAct2` → `detail.cmdRechargeGiftAct3Detail`
 *    而且**前者的进度字段叫 `curRechargeProcess` / `tlTakeRechargeProcess`，
 *    后两者叫 `curProcess` / `tlTakeProcess`** —— 差一个词，抄错就是「进度恒 0、永远领不了」。
 *
 * ② **页签 → 活动类型走 `activityTab.id` 映射**（别按顺序猜）：
 *      `id=3 充值好礼(payGift)`  → `[1003]`       → `activity.plan = 1`
 *      `id=4 充值豪礼(payGift2)` → `[1004, 1005]` → `plan 2`（列表）/ `plan 3`（顶部宝箱）
 *    「高级」页签的**列表**列的是 `plan 2`（type 1004），顶部**宝箱**（老端 controller 名「活动二」）
 *    用的是 `plan 3`（type 1005）—— 同属一个页签，但取**两个不同活动**。
 *
 * ③ **行排序 = 「已领取的沉底」+ 其余按 `rechargeProcess` 升序**（`ModelActivity.UpdateList`），
 *    不是纯数值序。所以 `[6,30,68]` 里领了 `30` 之后，顺序变成 `6,68,30`。
 *
 * ## 与老端的**刻意差异**
 *
 * - 老端 `hasRechargeTotalByType` / `UpdateRewards` 在「活动不存在」时会解引用 `detail`
 *   （`detail.tlTakeRechargeProcess` / `detail.curProcess`）而抛异常；这里一律收成
 *   「无活动 ⇒ 空视图」，让界面能正常退化成「未开启」。
 * - 老端红点走 `ModelSystem.GetRDExpr()` 表达式引擎（Demo3.8 没有）；这里给**判定函数**
 *   `rechargeTotalRedDot()`，接线由页面决定（与 `LayerActivityTable` 同口径）。
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
    readonly name: string;
    /** 该页签收哪些 `activity.type`。 */
    readonly tlType: readonly number[];
    /** 「活动介绍」气泡的正文（富文本，老端 `GetActivityBagTabDesc(tabType)`）。 */
    readonly desc: string;
}

/** `activity` 表一行。 */
export interface IRechargeActivityRow {
    readonly resId: number;
    readonly type: number;
    readonly name: string;
    readonly plan: number;
}

/** 归一化后的「一个已开启的充值活动实例」。 */
export interface IRechargeActivityInfo {
    /** 领奖请求要传的 `resId`（老端 `VOActivity.GetId()` = `cmd.openResId`）。 */
    readonly id: number;
    readonly activityType: number;
    readonly name: string;
    readonly plan: number;
    /** 当前已累计充值金额（元）；**拿不到 `detail` 时为 0**。 */
    readonly curProcess: number;
    /** 已领取的档位（`rechargeProcess` 列表）。 */
    readonly takenProcesses: readonly number[];
    /**
     * `detail` 是否存在。
     *
     * ⚠️ 这是老端判定里**独立的一档**：`Initlist` 里 `detail == null` 直接落「未完成」，
     * 与 `curProcess < rechargeProcess` 的结果相同，但语义不同 —— 「服务器还没给这个活动的进度」
     * 与「给了、只是没充够」。保留它，界面才好区分要不要画进度。
     */
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
    /** 领取按钮上的红点（老端 `canBeReward`）。 */
    readonly redDot: boolean;
    /** 按钮文案键 —— 文案由页面按 `GiftTexts` 出（本文件零中文字面量）。 */
    readonly buttonKey: RechargeButtonKey;
}

/** 顶部宝箱视图（老端 controller「活动二」那一排，最多 2 个）。 */
export interface IRechargeBoxView {
    readonly rechargeProcess: number;
    readonly curProcess: number;
    /** 已领取（老端 controller 页名「已开启」）。 */
    readonly taken: boolean;
    /** 可领取（`taken = false` 且 `curProcess >= rechargeProcess`）。 */
    readonly claimable: boolean;
    /** 可点（`curProcess >= rechargeProcess`；老端用它决定 `touchable`）。 */
    readonly touchable: boolean;
    readonly reward: IRechargeReward | null;
}

/** 按钮文案键。 */
export type RechargeButtonKey = 'claim' | 'goto' | 'taken';

/** 一页（`base` 或 `advanced`）渲染要的全部。 */
export interface IRechargeTotalPageView {
    readonly tab: number;
    /** 活动实例 `id`（= `openResId`）；`0` = 该页签当前没有开启的活动。 */
    readonly activityId: number;
    readonly rows: readonly IRechargeTotalRowView[];
    /** 顶部宝箱；空数组 = 不显示（老端「活动二」未开启）。 */
    readonly boxes: readonly IRechargeBoxView[];
    /** 顶部进度条的 `max`（最大档位值）；`0` = 没档位。 */
    readonly progressMax: number;
    /** 顶部进度条的 `value`。 */
    readonly progressValue: number;
    /** 「活动介绍」正文（`activityTab.desc`）。 */
    readonly desc: string;
    /**
     * 页签「充值好礼」是否显示。
     *
     * 老端 `tab_1` 带 `gearDisplay controller="好礼" pages="1"` ——
     * 只有 `type 1004` 的活动存在时才显示（`refreshSelectPage` 里 `subSet1.GetOneVO()`）。
     */
    readonly advancedTabVisible: boolean;
    /** 该页签整体有没有可领的奖励（老端 `hasRechargeTotalByType`，用于红点）。 */
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
            name: typeof r.name === 'string' ? r.name : '',
            tlType: toNumberArray(r.tlType),
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
            name: typeof r.name === 'string' ? r.name : '',
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
            name: definition.name,
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

/** 取某页签该用哪个活动（老端 `getSubSet().GetOneVO()`）。 */
export function pickActivityForTab(
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

/** 页签「充值好礼」显不显示（老端 `subSet1` = `type 1004` 存在）。 */
export function isAdvancedTabVisible(activities: readonly IRechargeActivityInfo[]): boolean {
    return activities.some((a) => a.activityType === RECHARGE_ACTIVITY_TYPE.payGift1);
}

/** 单行三态判定（照抄老端 `Initlist` 的分支顺序）。 */
export function rechargeRowState(
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

/** 三态 → 按钮键（`undone` 是「前往」而不是「不可点」）。 */
export function rechargeButtonKeyOf(state: RechargeRowState): RechargeButtonKey {
    if (state === 'taken') return 'taken';
    if (state === 'claimable') return 'claim';
    return 'goto';
}

/** 该活动的档位行（按 `plan` 取）。 */
export function rowsOfPlan(
    planRows: readonly IRechargeActPlanRow[],
    plan: number,
): IRechargeActPlanRow[] {
    return planRows.filter((row) => row.plan === plan);
}

/**
 * 排序：**已领取的沉底**，其余按 `rechargeProcess` 升序（老端 `ModelActivity.UpdateList`）。
 *
 * 老端的比较器是「a 已领 && b 未领 → +1；a 未领 && b 已领 → -1；否则按数值升序」。
 * 这里用同样的三段式，不用 `sort` 的稳定性假设。
 */
export function sortRechargeRows(
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
            const redDot = state === 'claimable';
            if (redDot) hasClaimable = true;
            if (row.rechargeProcess > progressMax) progressMax = row.rechargeProcess;
            rows.push({
                rechargeProcess: row.rechargeProcess,
                curProcess: activity.curProcess,
                state,
                rewards: row.rechargeReward,
                redDot,
                buttonKey: rechargeButtonKeyOf(state),
            });
        }
        progressValue = activity.curProcess;
    }

    // ---- 顶部宝箱（老端「活动二」）----
    const boxes: IRechargeBoxView[] = [];
    const boxActivity = pickBoxActivity(activities);
    if (!isBase && boxActivity) {
        const boxRows = rowsOfPlan(planRows, boxActivity.plan);
        for (const row of boxRows) {
            const taken = boxActivity.takenProcesses.includes(row.rechargeProcess);
            const touchable = boxActivity.hasDetail && boxActivity.curProcess >= row.rechargeProcess;
            const claimable = !taken && touchable;
            if (claimable) hasClaimable = true;
            boxes.push({
                rechargeProcess: row.rechargeProcess,
                curProcess: boxActivity.curProcess,
                taken,
                claimable,
                touchable,
                reward: row.rechargeReward[0] ?? null,
            });
        }
    }

    return {
        tab,
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

/**
 * 页签红点 —— 两个页签任一有可领奖励就亮（老端 `hasRecharegeTotalRd`）。
 *
 * 老端是在 `ModelActivity` 里按 `ActivityTabBtn.payGift` / `payGift2` 分别判、再相加；
 * 这里给「按页签」的纯函数，接线（`open.json` 的 `RDExpr`）由调用方决定。
 */
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
