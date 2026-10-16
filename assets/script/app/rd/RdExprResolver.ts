/**
 * 主界面入口红点表达式的**聚合器** —— 老端 `SystemObject.GetRDExpr()` / `GetRDExprToPre()` 的移植。
 *
 * ## 老端在干什么
 * 策划在主界面配置表（新工程是 `assets/remoteRef/open.json`）里给每个入口配两列：
 * ```
 * refId      : 入口 id（= 老端的系统 id）
 * RDExpr     : 这个入口**自己**的红点表达式，如 "[RDSevenday]"
 * tlRDResId  : 还要**关注**哪些入口，把它们的红点也加进来，如 [405,406,407]
 * ```
 * 于是「商店」入口的红点 = 商店自己的红点 + 三个子系统的红点之和，不用策划手写求和。
 * 聚合结果是一段**表达式字符串**（如 `"[RDCoinStore]+([RDGemStore])"`），最终交给
 * `ToolSet.AddScriptListener` → 有变化就回调 → `RedDot.setRedDot(值)`。
 *
 * ## 三条与老端一致的行为
 * 1. **自引用报错**：某行的 `tlRDResId` 里包含自己的 `refId` ⇒ 报错并**跳过**（不跳过会无限递归）。
 * 2. **成环只报错不断链**：A 关注 B、B 关注 A —— 老端用 `tmReadMap` 断环并报「重复引用红点」，
 *    照搬：报错、继续算（用已算出的部分），不抛异常。
 * 3. **缺配置报错**：`tlRDResId` 指向的 `refId` 在表里不存在 ⇒ 报错、忽略这一项。
 *
 * ## 纯逻辑、零 import
 * 本文件不 import 任何东西（连 `cc` 都不碰），所以能被 `tests/rdExpr.test.ts` 直接 import，
 * 用真 `open.json` 的数据做对账。
 */

/** `open.json` 里本模块用得到的那几列。 */
export interface RdOpenRowLike {
    readonly refId?: number;
    readonly RDExpr?: string;
    readonly tlRDResId?: readonly number[];
}

/** 聚合结果。 */
export interface RdExprResolveResult {
    /** 最终表达式；没有任何红点时是 `''`。 */
    readonly expr: string;
    /** 过程中的问题（自引用 / 成环 / 缺配置），供测试与日志断言。 */
    readonly warnings: readonly string[];
}

/** 计数收敛（`open.json` 的 refId 可能是 number / string / Long）。 */
function toCount(value: unknown): number {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : 0;
    if (typeof value === 'string') {
        const n = Number(value);
        return Number.isFinite(n) ? Math.trunc(n) : 0;
    }
    if (typeof value === 'object') {
        const long = value as { toNumber?: () => number; low?: number; high?: number };
        if (typeof long.toNumber === 'function') return Math.trunc(long.toNumber());
        if (typeof long.low === 'number' && typeof long.high === 'number') {
            return long.high * 4294967296 + (long.low >>> 0);
        }
    }
    return 0;
}

/** 表达式串清洗：去空白（`Expr` 构造时也会去，这里早点去便于去重比较）。 */
function normalizeExpr(expr: string | null | undefined): string {
    if (typeof expr !== 'string') return '';
    return expr.replace(/\s/g, '');
}

/**
 * 把若干段表达式用 `+` 连起来（红点值求和）。
 *
 * 除第一段外**每段都加括号**：`Expr` 的 `process_opera` 是按操作符 `split(opera, 2)` 递归切的，
 * 括号能让 `process_parents` 先把子段算成一个值，避免 `a+b+c` 被切出意外的结合顺序。
 */
function joinExprs(parts: readonly string[]): string {
    const clean = parts.filter((part) => part !== '');
    if (clean.length === 0) return '';
    if (clean.length === 1) return clean[0];
    return clean.map((part, index) => (index === 0 ? part : `(${part})`)).join('+');
}

/**
 * 算某个入口的完整红点表达式。
 *
 * @param refId 目标入口的 `refId`
 * @param rows `open.json` 全表（或任意子集）
 */
export function resolveRdExpr(refId: number, rows: readonly RdOpenRowLike[]): RdExprResolveResult {
    const warnings: string[] = [];
    const byRefId = indexRdOpenRows(rows);
    const computed = new Map<number, string>();

    const compute = (id: number, visited: Set<number>): string => {
        const cached = computed.get(id);
        if (cached !== undefined) return cached;

        const row = byRefId.get(id);
        if (!row) {
            // 顶层入口不在表里是配置问题（调用方给的 refId 有问题）；子项缺配置在下面单独报
            warnings.push(`open.json 里没有 refId=${id} 这一行`);
            computed.set(id, '');
            return '';
        }

        const parts: string[] = [];
        const own = normalizeExpr(row.RDExpr);
        if (own) parts.push(own);

        for (const rawResId of row.tlRDResId ?? []) {
            const resId = toCount(rawResId);
            if (resId <= 0) continue;
            if (resId === id) {
                // 老端原文：「自己关注自己红点,请策划检查配置表！」——不跳过会无限递归
                warnings.push(`refId=${id} 的 tlRDResId 里包含了自己，已跳过`);
                continue;
            }
            if (visited.has(resId)) {
                // 老端原文：「重复引用红点,请策划检查配置表，只报错，不影响获取」
                warnings.push(`refId=${id} -> ${resId} 成环或重复引用，已断链`);
                continue;
            }
            if (!byRefId.has(resId)) {
                // 老端原文：「缺少系统配置！开启表添加 resId」
                warnings.push(`refId=${id} 关注的 resId=${resId} 在表里不存在`);
                continue;
            }
            visited.add(resId);
            const sub = compute(resId, visited);
            if (sub) parts.push(sub);
        }

        const result = joinExprs(parts);
        computed.set(id, result);
        return result;
    };

    const expr = compute(refId, new Set<number>([refId]));
    return { expr, warnings };
}

/**
 * 一次性算出**全表**每个入口的红点表达式。
 *
 * 主界面要把每个条目都绑上红点。这里逐行调 `resolveRdExpr` —— 单次调用内部有 `computed`
 * 缓存（同一个入口的重复子链只展开一次），34 行的量级完全够用。不做跨入口共享缓存是为了让
 * `warnings` 的归属清晰：谁的问题报在谁头上。
 */
export function resolveAllRdExprs(rows: readonly RdOpenRowLike[]): Map<number, RdExprResolveResult> {
    const out = new Map<number, RdExprResolveResult>();
    for (const refId of indexRdOpenRows(rows).keys()) {
        out.set(refId, resolveRdExpr(refId, rows));
    }
    return out;
}

/** `open.json` 全表 → `refId` → 行。 */
export function indexRdOpenRows(rows: readonly RdOpenRowLike[] | null | undefined): Map<number, RdOpenRowLike> {
    const map = new Map<number, RdOpenRowLike>();
    for (const row of rows ?? []) {
        const refId = toCount(row?.refId);
        if (refId <= 0) continue;
        map.set(refId, row);
    }
    return map;
}
