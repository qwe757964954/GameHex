import { readFileSync } from 'node:fs';

/**
 * 测试侧读 remoteRef 表 —— 把两种产物格式统一成 `{ k, v }` 列存视图。
 *
 * ## 为什么要有这个文件
 *
 * 导表流程对同一张表会写出两种 JSON 形态，而且是**逐表切换**的：
 *
 * - **列存** `{ "k": ["id", ...], "v": [[2002, "主城", ...], ...], "c": 1 }`
 *   —— 并进 `refSmallAll.json` 的表，或 11-20 之前的老产物。
 * - **行对象数组** `[{ "id": 2002, "name": "主城", ... }, ...]`
 *   —— 未合并的独立表（如 `pvpCard`），11-20 16:35 那次整表重导后就是这种。
 *
 * 运行时**两种都吃**：`RefUtil.compressKeyRefDataFix` 只在 `data_.c == 1` 时解包，
 * 行对象数组原样放行（`result = data_`）。所以线上没有兼容问题，
 * 挂掉的只有测试侧那 9 个写死 `table.v.map(...)` / `table.k.indexOf(...)` 的读取函数 ——
 * 报错是 `Cannot read properties of undefined (reading 'map')`，看着像数据坏了，其实是形态变了。
 *
 * 而且它**不可自愈**：导表再跑一次可能又换回来，同一批测试就再红一遍，红之前没有任何信号。
 * 所以判据必须从「表是列存」改成「能读出列名与行」，格式差异只在本文件收口。
 *
 * ## 三条纪律
 *
 * 1. **读表一律走 {@link readRefKvc}** —— 别再手写 `JSON.parse(readFileSync(...)) as { k, v }`，
 *    那等于把格式假设又写死一次。
 * 2. **行对象数组的列名取「首次出现顺序的并集」** —— 导表对空值列是**直接省略**的
 *    （37 行 `pvpCard` 里只有 35 行带 `prefabSize`），所以列名不能只取第 0 行的 keys。
 * 3. **某行缺该列时补 `undefined`，不许补 `0` / `''`** —— 缺列 vs 值为 0 是两件事，
 *    补默认值会把「配置漏填」伪装成合法数据。
 */

/** 列存视图。`v[i][j]` = 第 i 行第 `k[j]` 列的值。 */
export interface IRefKvcTable {
    readonly k: string[];
    readonly v: unknown[][];
}

/**
 * 把 remoteRef 表的原始 JSON 归一成列存视图。
 *
 * 列存原样返回（含 `c`/`sv`/`vk` 等压缩字段也不动 —— 本函数只负责给出 `k`/`v` 视图，
 * 压缩字段的还原由运行时 `compressKeyRefDataFix` 负责，测试不重复实现那套映射）。
 */
export function normalizeRefKvc(raw: unknown): IRefKvcTable {
    if (Array.isArray(raw)) {
        const columns: string[] = [];
        const seen = new Set<string>();
        for (const row of raw) {
            if (!row || typeof row !== 'object' || Array.isArray(row)) {
                throw new Error(`remoteRef 行对象数组里混进了非对象行：${JSON.stringify(row)}`);
            }
            for (const key of Object.keys(row as Record<string, unknown>)) {
                if (seen.has(key)) continue;
                seen.add(key);
                columns.push(key);
            }
        }
        const v = (raw as Array<Record<string, unknown>>).map((row) => columns.map((key) => row[key]));
        return { k: columns, v };
    }

    if (raw && typeof raw === 'object') {
        const table = raw as { k?: unknown; v?: unknown };
        if (!Array.isArray(table.k) || !Array.isArray(table.v)) {
            throw new Error('remoteRef 表既不是行对象数组，也不是 {k,v} 列存');
        }
        return { k: table.k as string[], v: table.v as unknown[][] };
    }

    throw new Error(`remoteRef 表内容无法识别：${typeof raw}`);
}

/** 按相对项目根的路径读表，例如 `assets/remoteRef/pvpCard.json`。 */
export function readRefKvc(path: string): IRefKvcTable {
    return normalizeRefKvc(JSON.parse(readFileSync(path, 'utf8')));
}

/** 按表名读表，例如 `readRefTable('pvpCard')` → `assets/remoteRef/pvpCard.json`。 */
export function readRefTable(name: string): IRefKvcTable {
    return readRefKvc(`assets/remoteRef/${name}.json`);
}

/**
 * 列存视图 → 行对象数组。
 *
 * 缺列的行会得到 `key: undefined`（与 `Object.fromEntries` 等价），不是删掉这个键 ——
 * 调用方的 `row.x != null` 判断在两种写法下结果一致，但 `Object.hasOwn` 会不同，
 * 所以需要区分「列不存在」与「这行没填」时用 {@link IRefKvcTable} 的 `k` 自己判。
 */
export function rowsOf(table: IRefKvcTable): Array<Record<string, unknown>> {
    return table.v.map((values) => Object.fromEntries(table.k.map((key, index) => [key, values[index]])));
}

/** 按表名直接读成行对象数组，例如 `readRefRows('pvpCard')`。 */
export function readRefRows(name: string): Array<Record<string, unknown>> {
    return rowsOf(readRefTable(name));
}
