/**
 * 「限时活动」三页签的数据口径 —— **纯逻辑，不 import `cc`，可在 Node 单测里直接跑**。
 *
 * 移植自老客户端 `LayerLimitTimeAct`（`.../activityBackStage/LayerLimitTimeAct.ts`）+
 * `ModelBackStageAct` / `VOBackStageAct`。
 *
 * 数据来源分两类：
 *   - 配置（`limitTimeTask` / `limitTimeDay` / `limitTimeActivity` / `limitTimeConfig`）：
 *     **服务端下发**（`reqActivityJson` 的 `content` 是一段 JSON 字符串），不是 `remoteRef` 静态表；
 *   - 服务器状态（`CmdActivitySimple` 缓存 + `reqActivityLimitTimeInfo` 响应）：
 *     每日任务进度 `tlCmdTask`、每日礼包次数 `tlLimitTimeDay`、限购次数 `tlLimitTimeActivity`。
 *
 * 老端这些判定挂在 `VOBackStageAct` / `ModelMgr` 上没法单测，这里全部收敛成**传参纯函数**。
 *
 * ## 三页签配置的形状（服务端 `reqActivityJson` 下发）
 *   - `limitTimeTask`：`{ resId, name, sort, desc, targetType, param:{count}, reward:[{resId,number}] }`
 *   - `limitTimeDay` / `limitTimeActivity`：
 *     `{ resId, title, desc, reward, priceType, cost, count, discount, extend, refreshParam }`
 *     （`count` = 限购次数；`discount` = 折扣，2 = 2 折；`priceType` = 货币 resId；`cost` = 单价）
 *   - `limitTimeConfig`：`{ key, value, title }`（`key=icon` 是入口图标，另有一条 `title`）
 */

import { toCount } from '../net/RequestGuard';
import {
    TASK_STATE_FINISH,
    TASK_STATE_REWARDED,
    TASK_STATE_UNDONE,
} from './LimitTimeActTypes';
import type {
    ILimitTimeActConfig,
    ILimitTimeActData,
    ILimitTimeActMeta,
    ILimitTimeGoodsRow,
    ILimitTimeGoodsState,
    ILimitTimeReward,
    ILimitTimeTaskRow,
    ILimitTimeTaskState,
} from './LimitTimeActTypes';

/** `CmdActivityTypeEnum.limit_time`。 */
export const LIMIT_TIME_ACT_TYPE = 101;

/** 任务按钮三态（多一个 `undone`：既没完成也不知道往哪跳）。 */
export type LimitTimeTaskPhase = 'goto' | 'claimable' | 'taken' | 'undone';

/** 礼包 / 限购的购买按钮态。 */
export type LimitTimeGoodsPhase = 'buyable' | 'soldout';

// ============================================================
// 解析
// ============================================================

/** 解析一条奖励数组；非法条目跳过。 */
export function parseRewards(raw: unknown): ILimitTimeReward[] {
    const out: ILimitTimeReward[] = [];
    if (!Array.isArray(raw)) return out;
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const row = item as Record<string, unknown>;
        const resId = toCount(row.resId);
        const number = toCount(row.number);
        if (resId <= 0 || number <= 0) continue;
        out.push({ resId, number });
    }
    return out;
}

/** `limitTimeTask` 全表 → 归一化行（按 `sort` 升序）。 */
export function parseTaskRows(rows: readonly unknown[]): ILimitTimeTaskRow[] {
    const out: ILimitTimeTaskRow[] = [];
    for (const raw of rows ?? []) {
        if (!raw || typeof raw !== 'object') continue;
        const row = raw as Record<string, unknown>;
        const resId = toCount(row.resId);
        const name = typeof row.name === 'string' ? row.name : '';
        if (resId <= 0 || name.length === 0) continue;
        const param = row.param && typeof row.param === 'object'
            ? (row.param as Record<string, unknown>)
            : null;
        out.push({
            resId,
            name,
            sort: toCount(row.sort),
            desc: typeof row.desc === 'string' ? row.desc : '',
            targetType: toCount(row.targetType),
            count: param ? toCount(param.count) : 0,
            rewards: parseRewards(row.reward),
        });
    }
    out.sort((a, b) => a.sort - b.sort || a.resId - b.resId);
    return out;
}

/** `limitTimeDay` / `limitTimeActivity` 全表 → 归一化行（按 `resId` 升序）。 */
export function parseGoodsRows(rows: readonly unknown[]): ILimitTimeGoodsRow[] {
    const out: ILimitTimeGoodsRow[] = [];
    for (const raw of rows ?? []) {
        if (!raw || typeof raw !== 'object') continue;
        const row = raw as Record<string, unknown>;
        const resId = toCount(row.resId);
        if (resId <= 0) continue;
        out.push({
            resId,
            title: typeof row.title === 'string' ? row.title : '',
            desc: typeof row.desc === 'string' ? row.desc : '',
            rewards: parseRewards(row.reward),
            priceType: toCount(row.priceType),
            cost: toCount(row.cost),
            count: toCount(row.count),
            discount: toCount(row.discount),
        });
    }
    out.sort((a, b) => a.resId - b.resId);
    return out;
}

/**
 * 解析 `reqActivityJson` 下发的 `content`（一段 JSON 字符串）→ 三页签配置。
 *
 * `content` 形如 `{ "limitTimeTask": [...], "limitTimeDay": [...],
 * "limitTimeActivity": [...], "limitTimeConfig": [...] }`。键名即 `tlJsonName` 里的名。
 * 解析失败 / 缺键 → 对应页签空数组（不抛，界面按空列表降级）。
 */
export function parseActConfig(content: unknown): ILimitTimeActConfig {
    let raw: Record<string, unknown> = {};
    if (typeof content === 'string' && content.length > 0) {
        try {
            const parsed = JSON.parse(content);
            if (parsed && typeof parsed === 'object') raw = parsed as Record<string, unknown>;
        } catch (error) {
            console.warn('[LimitTimeAct] 活动配置 JSON 解析失败', error);
        }
    } else if (content && typeof content === 'object') {
        raw = content as Record<string, unknown>;
    }
    return {
        tasks: parseTaskRows(asArray(raw.limitTimeTask)),
        dayGifts: parseGoodsRows(asArray(raw.limitTimeDay)),
        limitBuys: parseGoodsRows(asArray(raw.limitTimeActivity)),
    };
}

/** 从 `limitTimeConfig` 行里抽标题 / 图标。 */
export function parseActTitleAndIcon(configRows: readonly unknown[]): { title: string; icon: string } {
    let title = '';
    let icon = '';
    for (const raw of configRows ?? []) {
        if (!raw || typeof raw !== 'object') continue;
        const row = raw as Record<string, unknown>;
        const key = typeof row.key === 'string' ? row.key : '';
        if (key === 'icon') icon = typeof row.value === 'string' ? row.value : '';
        else if (typeof row.title === 'string' && row.title.length > 0 && !title) title = row.title;
    }
    return { title, icon };
}

/** 从 `CmdActivitySimple` 缓存里抽出 `type === limit_time` 的活动 meta。 */
export function findLimitTimeMeta(activitySimples: readonly unknown[]): ILimitTimeActMeta | null {
    for (const raw of activitySimples ?? []) {
        if (!raw || typeof raw !== 'object') continue;
        const cmd = raw as Record<string, unknown>;
        if (toCount(cmd.type) !== LIMIT_TIME_ACT_TYPE) continue;
        const time = cmd.cmdActivityTime && typeof cmd.cmdActivityTime === 'object'
            ? (cmd.cmdActivityTime as Record<string, unknown>)
            : null;
        const jsonNames: string[] = [];
        if (Array.isArray(cmd.jsonNames)) {
            for (const name of cmd.jsonNames) {
                if (typeof name === 'string') jsonNames.push(name);
            }
        }
        return {
            id: typeof cmd.id === 'string' ? cmd.id : String(cmd.id ?? ''),
            type: LIMIT_TIME_ACT_TYPE,
            jsonNames,
            endTime: toCount(time?.endTime),
            title: '',
            icon: '',
        };
    }
    return null;
}

/** 从 `reqActivityLimitTimeInfo` 响应抽三页签数据。 */
export function parseActData(rsp: unknown): ILimitTimeActData {
    if (!rsp || typeof rsp !== 'object') return { tasks: [], dayGifts: [], limitBuys: [] };
    const raw = rsp as Record<string, unknown>;
    return {
        tasks: parseTaskStates(asArray(raw.tlCmdTask)),
        dayGifts: parseGoodsStates(asArray(raw.tlLimitTimeDay)),
        limitBuys: parseGoodsStates(asArray(raw.tlLimitTimeActivity)),
    };
}

/** `CmdTask[]` → 任务进度（resId → 状态）。 */
export function parseTaskStates(rows: readonly unknown[]): ILimitTimeTaskState[] {
    const out: ILimitTimeTaskState[] = [];
    for (const raw of rows ?? []) {
        if (!raw || typeof raw !== 'object') continue;
        const row = raw as Record<string, unknown>;
        const resId = toCount(row.resId);
        if (resId <= 0) continue;
        out.push({
            resId,
            count: toCount(row.count),
            state: toCount(row.rewardState),
        });
    }
    return out;
}

/** `CmdActivityGoods[]` → 购买次数（resId → 次数）。 */
export function parseGoodsStates(rows: readonly unknown[]): ILimitTimeGoodsState[] {
    const out: ILimitTimeGoodsState[] = [];
    for (const raw of rows ?? []) {
        if (!raw || typeof raw !== 'object') continue;
        const row = raw as Record<string, unknown>;
        const resId = toCount(row.resId);
        if (resId <= 0) continue;
        out.push({ resId, times: toCount(row.times) });
    }
    return out;
}

/** 把「可能是数组」的 unknown 兜成数组。 */
function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

// ============================================================
// 状态判定
// ============================================================

/** 一条每日任务的服务器进度；没下发 = 0 / 未完成。 */
export function taskStateOf(resId: number, states: readonly ILimitTimeTaskState[]): ILimitTimeTaskState {
    return states.find((s) => s.resId === resId) ?? { resId, count: 0, state: TASK_STATE_UNDONE };
}

/** 一条礼包 / 限购的已购次数；没下发 = 0。 */
export function goodsTimesOf(resId: number, states: readonly ILimitTimeGoodsState[]): number {
    return states.find((s) => s.resId === resId)?.times ?? 0;
}

/**
 * 任务按钮三态。
 *
 * 老端 `LayerLimitTimeAct` 里：`REWARDED` → 已领取；`FINISH` → 「领取」；否则 → 「前往」
 * （只要配置有 `targetType` 就一定能跳，所以没有「既没完成又不能跳」的态；这里为稳健保留
 * `targetType === 0` 的降级「未完成」）。
 */
export function taskPhaseOf(task: ILimitTimeTaskRow, states: readonly ILimitTimeTaskState[]): LimitTimeTaskPhase {
    const state = taskStateOf(task.resId, states);
    if (state.state === TASK_STATE_REWARDED) return 'taken';
    if (state.state === TASK_STATE_FINISH) return 'claimable';
    return task.targetType > 0 ? 'goto' : 'undone';
}

/** 进度文案：`{name} ({process}/{target})`。 */
export function taskProgressText(task: ILimitTimeTaskRow, states: readonly ILimitTimeTaskState[]): string {
    const process = taskStateOf(task.resId, states).count;
    return `${task.name} (${process}/${task.count})`;
}

/** 是否还有红点（可领取）。 */
export function taskHasRedDot(task: ILimitTimeTaskRow, states: readonly ILimitTimeTaskState[]): boolean {
    return taskPhaseOf(task, states) === 'claimable';
}

/**
 * 每日任务列表排序：可领取(0) → 未完成(1) → 已领取(2)，组内按 `sort`。
 * 对齐老端 `LayerLimitTimeAct.UpdateView` 里 `ActType.Task` 的比较器意图
 * （`REWARDED` 沉底、`FINISH` 置顶），但去掉了它无状态时 `detailA.state` 空引用那个分支。
 */
export function sortTasksForDisplay(
    tasks: readonly ILimitTimeTaskRow[],
    states: readonly ILimitTimeTaskState[],
): ILimitTimeTaskRow[] {
    const rankOf = (task: ILimitTimeTaskRow): number => {
        const phase = taskPhaseOf(task, states);
        if (phase === 'claimable') return 0;
        if (phase === 'taken') return 2;
        return 1;
    };
    return (tasks ?? []).slice().sort((a, b) => rankOf(a) - rankOf(b) || a.sort - b.sort || a.resId - b.resId);
}

/**
 * 礼包 / 限购的购买按钮态 + 剩余次数。
 *
 * 老端：`delayTimes = ref.count - (cmd?.times || 0)`，`delayTimes > 0` 显示「购买」+
 * 「限购 X/Y」，`delayTimes <= 0` 显示「售罄」。
 */
export function goodsPhaseOf(row: ILimitTimeGoodsRow, states: readonly ILimitTimeGoodsState[]): LimitTimeGoodsPhase {
    return goodsRemainOf(row, states) > 0 ? 'buyable' : 'soldout';
}

/** 剩余可购次数。 */
export function goodsRemainOf(row: ILimitTimeGoodsRow, states: readonly ILimitTimeGoodsState[]): number {
    return Math.max(0, row.count - goodsTimesOf(row.resId, states));
}

/**
 * 礼包 / 限购列表排序：有剩余次数(可买)的在前，售罄的沉底。
 * 对齐老端 `ActType.DayGift` / `ActType.LimitBuy` 的比较器（`delayA && !delayB` → A 前）。
 */
export function sortGoodsForDisplay(
    rows: readonly ILimitTimeGoodsRow[],
    states: readonly ILimitTimeGoodsState[],
): ILimitTimeGoodsRow[] {
    return (rows ?? []).slice().sort((a, b) => {
        const remainA = goodsRemainOf(a, states) > 0 ? 1 : 0;
        const remainB = goodsRemainOf(b, states) > 0 ? 1 : 0;
        if (remainA !== remainB) return remainB - remainA;
        return a.resId - b.resId;
    });
}
