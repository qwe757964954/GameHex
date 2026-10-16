/**
 * 主界面两侧活动入口 —— 纯数据层，零引擎依赖。
 * 数据来自 open.json，按 belond 过滤、order 升序。
 */

import type { EntranceCondition } from './MainEntranceVisible';

/** open.belond 本页面用到的两个值。 */
export enum EntranceBelond {
    left = 2,
    right = 3,
}

/** 一屏完整容纳的入口数，用于反推视口高度。 */
export const MAX_VISIBLE_ENTRANCE = 5;

/** 条目边长。 */
export const ENTRANCE_ITEM_SIZE = 66;

/** 条目纵向间距，与尺寸一起决定视口高度。 */
export const ENTRANCE_ITEM_SPACING = 14;

/** 一个入口条目。 */
export interface MainEntranceItem {
    readonly refId: number;
    readonly url: string;
    /** icon.json 的 key（图标名）。 */
    readonly iconKey: string;
    readonly order: number;
}

export interface OpenRowLike {
    readonly refId?: number;
    readonly belond?: number;
    readonly order?: number;
    readonly icon?: string;
    readonly url?: string;
    readonly preResId?: number;
    readonly visibleCondition?: readonly EntranceCondition[];
    /**
     * 红点表达式（策划列）。`"[RDGift]"` 这种；空 = 这个入口没有红点。
     * 语义与聚合规则见 `app/rd/RdExprResolver.ts`（老端 `SystemObject.GetRDExpr` 的移植）。
     */
    readonly RDExpr?: string;
    /** 还要把哪些入口的红点一并算进来（`refId` 列表）；见 `RdExprResolver`。 */
    readonly tlRDResId?: readonly number[];
}

/**
 * 挑出某一侧入口。
 * 规则：belond 匹配、必须有 icon、isRowVisible 为真（若传）、order 再 refId 升序。
 * 不截断，交给虚拟列表按需渲染。
 */
export function collectEntranceItems(
    openRows: readonly OpenRowLike[] | null | undefined,
    belond: EntranceBelond,
    isRowVisible?: (row: OpenRowLike) => boolean,
): MainEntranceItem[] {
    const out: MainEntranceItem[] = [];
    for (const row of openRows ?? []) {
        if (!row || row.belond !== belond) continue;
        const refId = toCount(row.refId);
        if (refId <= 0) continue;
        const iconKey = typeof row.icon === 'string' ? row.icon.trim() : '';
        if (!iconKey) continue;
        if (isRowVisible && !isRowVisible(row)) continue;
        out.push({
            refId,
            url: typeof row.url === 'string' ? row.url : '',
            iconKey,
            order: toCount(row.order),
        });
    }
    out.sort((a, b) => a.order - b.order || a.refId - b.refId);
    return out;
}

export interface EntranceSideLayout {
    /** 初始停在列表末尾（右侧）还是开头（左侧）。 */
    readonly startAtTail: boolean;
}

export const ENTRANCE_SIDE_LAYOUT: Readonly<Record<EntranceBelond, EntranceSideLayout>> = {
    [EntranceBelond.left]: { startAtTail: false },
    [EntranceBelond.right]: { startAtTail: true },
};

/** 未知 belond 按左侧处理。 */
export function normalizeBelond(value: number): EntranceBelond {
    return value === EntranceBelond.right ? EntranceBelond.right : EntranceBelond.left;
}

function toCount(v: unknown): number {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
}
