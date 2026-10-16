/**
 * 主界面入口可见性判定 —— 纯函数，零引擎依赖，可单测。
 * 口径对齐老端：全部 visibleCondition 用 && 组合，任一不满足就不进列表；
 * preResId 前置系统的条件递归拼在前面。
 */

// ============================================================
// 输入
// ============================================================

export interface EntranceCondition {
    /** 缺失/空串 = 整条跳过（不构成约束）。 */
    readonly type?: string;
    readonly param?: { readonly resId?: number; readonly value?: number };
}

export interface EntranceVisibleRow {
    readonly refId?: number;
    /** 前置系统 id，可见条件继承它。 */
    readonly preResId?: number;
    readonly visibleCondition?: readonly EntranceCondition[];
}

/** 判定可见性所需状态，均为已算好的最终值（时间/查表留在取数层）。 */
export interface EntrancePlayerState {
    readonly hasRole: boolean;
    readonly roleLevel: number;
    /** 创角第几天，1-based。 */
    readonly createdDays: number;
    readonly rechargeCount: number;
    readonly firstRechargeId: number;
    /** 首充 id+1 档存在（还没买完）。 */
    readonly firstRechargeNextExists: boolean;
    readonly audit: boolean;
    readonly guardExists: boolean;
    readonly lotteryOpenIds: readonly number[];
    readonly miningShow: boolean;
    readonly dailyShareShow: boolean;
    readonly osRankShow: boolean;
    readonly isLevelPassed: (level: number) => boolean;
}

/** 什么都没拿到时的兜底：带条件入口一律不显示。 */
export const EMPTY_ENTRANCE_PLAYER_STATE: EntrancePlayerState = {
    hasRole: false,
    roleLevel: 0,
    createdDays: 0,
    rechargeCount: 0,
    firstRechargeId: 0,
    firstRechargeNextExists: false,
    audit: false,
    guardExists: false,
    lotteryOpenIds: [],
    miningShow: false,
    dailyShareShow: false,
    osRankShow: false,
    isLevelPassed: () => false,
};

// ============================================================
// 单条条件
// ============================================================

export type EntranceConditionVerdict = 'pass' | 'fail' | 'skip';

/**
 * 判一条条件。参数缺失 / 未识别类型返回 fail（宁可少显示），并 warn。
 */
export function evaluateEntranceCondition(
    condition: EntranceCondition | null | undefined,
    state: EntrancePlayerState,
): EntranceConditionVerdict {
    if (!condition) return 'skip';
    const type = typeof condition.type === 'string' ? condition.type.trim() : '';
    if (!type) return 'skip';

    const resId = toCountOrNull(condition.param?.resId);
    const value = toCountOrNull(condition.param?.value);

    switch (type) {
        case 'open':
            return 'pass';
        case 'close':
            return 'fail';
        case 'notTiShen':
            return state.audit ? 'fail' : 'pass';
        case 'roleLevel':
            if (value == null) return missingParam(type, 'value');
            return state.hasRole && state.roleLevel >= value ? 'pass' : 'fail';
        case 'battleLevel':
            if (resId == null) return missingParam(type, 'resId');
            return state.isLevelPassed(resId) ? 'pass' : 'fail';
        case 'roleCreateDays': {
            if (resId == null || value == null) return missingParam(type, 'resId/value');
            return state.createdDays >= resId && state.createdDays <= value ? 'pass' : 'fail';
        }
        case 'miningShow':
            return state.miningShow ? 'pass' : 'fail';
        case 'hasFirstRecharge':
            return hasFirstRecharge(state) ? 'pass' : 'fail';
        case 'dailyShareShow':
            return state.dailyShareShow ? 'pass' : 'fail';
        case 'osRankShow':
            return state.osRankShow ? 'pass' : 'fail';
        case 'guardsExist': {
            if (value == null) return missingParam(type, 'value');
            return (state.hasRole && state.roleLevel >= value) || state.guardExists ? 'pass' : 'fail';
        }
        case 'lotteryOpen': {
            if (resId == null) return missingParam(type, 'resId');
            return state.lotteryOpenIds.includes(resId) ? 'pass' : 'fail';
        }
        case 'guanKaGiftShow':
            // 老端该 Var 函数体被注释、无 return，入口永不显示，照搬。
            return 'fail';
        default:
            console.warn(`[MainEntranceVisible] 未识别条件类型 "${type}"，按不满足处理`);
            return 'fail';
    }
}

/** 老端 VarHasFirstRecharge 照搬。 */
function hasFirstRecharge(state: EntrancePlayerState): boolean {
    if (!state.hasRole) return false;
    if (state.rechargeCount <= 0) return true;
    if (state.firstRechargeId <= 0) return true;
    return state.firstRechargeNextExists;
}

// ============================================================
// 一行入口（含 preResId 继承）
// ============================================================

/** 展开完整条件 = [前置链（递归，远的在前）, 自己的]。visited 断环。 */
export function expandVisibleConditions(
    row: EntranceVisibleRow | null | undefined,
    byRefId: ReadonlyMap<number, EntranceVisibleRow> | null | undefined,
): EntranceCondition[] {
    const out: EntranceCondition[] = [];
    collectConditions(row, byRefId ?? null, out, new Set<number>());
    return out;
}

function collectConditions(
    row: EntranceVisibleRow | null | undefined,
    byRefId: ReadonlyMap<number, EntranceVisibleRow> | null,
    out: EntranceCondition[],
    visited: Set<number>,
): void {
    if (!row) return;

    const refId = toCountOrNull(row.refId);
    const preResId = toCountOrNull(row.preResId);
    if (preResId != null && byRefId) {
        if (visited.has(preResId)) {
            console.warn(`[MainEntranceVisible] preResId 成环：${refId ?? '?'} -> ${preResId}，已停止`);
        } else {
            visited.add(preResId);
            collectConditions(byRefId.get(preResId), byRefId, out, visited);
        }
    }

    for (const condition of row.visibleCondition ?? []) {
        out.push(condition);
    }
}

/** 一行入口现在该不该显示（本模块对外唯一判定）。只判 visibleCondition，不判 condition。 */
export function isEntranceRowVisible(
    row: EntranceVisibleRow | null | undefined,
    byRefId: ReadonlyMap<number, EntranceVisibleRow> | null | undefined,
    state: EntrancePlayerState,
): boolean {
    for (const condition of expandVisibleConditions(row, byRefId)) {
        if (evaluateEntranceCondition(condition, state) === 'fail') return false;
    }
    return true;
}

/** open 全表 → refId → 行。 */
export function indexOpenRowsByRefId(
    openRows: readonly EntranceVisibleRow[] | null | undefined,
): Map<number, EntranceVisibleRow> {
    const map = new Map<number, EntranceVisibleRow>();
    for (const row of openRows ?? []) {
        const refId = toCountOrNull(row?.refId);
        if (refId == null) continue;
        map.set(refId, row);
    }
    return map;
}

// ============================================================
// 工具
// ============================================================

/** number/string/Long → 非负数；认不出/负数返回 null（参数"缺"与"配成0"要分开）。 */
function toCountOrNull(value: unknown): number | null {
    if (value == null) return null;
    let num: number;
    if (typeof value === 'number') {
        num = value;
    } else if (typeof value === 'string') {
        num = Number(value);
    } else if (typeof value === 'object') {
        const long = value as { toNumber?: () => number; low?: number; high?: number };
        if (typeof long.low === 'number' && typeof long.high === 'number') {
            num = long.high * 4294967296 + (long.low >>> 0);
        } else if (typeof long.toNumber === 'function') {
            num = long.toNumber();
        } else {
            return null;
        }
    } else {
        return null;
    }
    if (!Number.isFinite(num) || num < 0) return null;
    return num;
}

function missingParam(type: string, which: string): EntranceConditionVerdict {
    console.warn(`[MainEntranceVisible] 条件 "${type}" 缺参数 ${which}，按不满足处理`);
    return 'fail';
}
