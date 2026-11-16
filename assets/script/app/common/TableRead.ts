/**
 * 读表壳（纯 TS，零引擎依赖）。
 *
 * 不直接 import `RefUtil`：`framework/ref/RefUtil.ts` 顶部 import `cc`，会让所有
 * Node repository 用例在 require 链上加载引擎。source 由 repository 传入。
 */

export interface IRefRowsSource {
    getRefAllAsync(table: string): Promise<unknown[] | null | undefined>;
}

/** 读一张分表；表缺失返回空数组；读表失败让上层失败（与 14 个既有副本同语义）。 */
export async function readRefRows(source: IRefRowsSource, table: string): Promise<unknown[]> {
    return (await source.getRefAllAsync(table)) ?? [];
}

/** 读表失败时降级空数组并 warn；只给 ItemDetail 的 try/catch 变体用。 */
export async function readRefRowsSafe(
    source: IRefRowsSource,
    table: string,
    label: string,
): Promise<unknown[]> {
    try {
        return (await source.getRefAllAsync(table)) ?? [];
    } catch (error) {
        console.warn(`[${label}] 读配置表 ${table} 失败`, error);
        return [];
    }
}
