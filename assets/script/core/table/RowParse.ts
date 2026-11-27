import { readConfigNumber } from '../config/ConfigValue';

/** 表行遍历骨架；只做 null 安全与循环，不承载业务校验。 */

export type IRow = Record<string, unknown>;

/** 原始条目 → 行对象；null / 非对象返回 null。 */
export function asRow(raw: unknown): IRow | null {
    if (!raw || typeof raw !== 'object') return null;
    return raw as IRow;
}

/** 对已确认的数组逐行 build；build 返回 null 表示跳过该行。 */
export function collectParsed<T>(
    rows: readonly unknown[],
    build: (row: IRow) => T | null,
): T[] {
    const out: T[] = [];
    for (const raw of rows ?? []) {
        const row = asRow(raw);
        if (!row) continue;
        const value = build(row);
        if (value !== null) out.push(value);
    }
    return out;
}

/** 表字段可能是数组 / null / 非数组；非数组返回空数组。 */
export function parseRows<T>(
    values: unknown,
    build: (row: IRow) => T | null,
): T[] {
    return Array.isArray(values) ? collectParsed(values, build) : [];
}

/** 表行 → Map；重复键按调用方选择的 first / last 策略。 */
export function parseRowsToMap<T>(
    rows: readonly unknown[],
    build: (row: IRow) => T | null,
    keyOf: (value: T) => number,
    options: { readonly keep: 'first' | 'last' },
): Map<number, T> {
    const map = new Map<number, T>();
    for (const raw of rows ?? []) {
        const row = asRow(raw);
        if (!row) continue;
        const value = build(row);
        if (value === null) continue;
        const key = keyOf(value);
        if (!options || options.keep === 'last' || !map.has(key)) {
            map.set(key, value);
        }
    }
    return map;
}

/**
 * 兵种/野怪预制体的等比缩放系数：留空（null / undefined / ''）= 1，填了非正数立即抛错，
 * 避免缩放为 0 导致角色在战场上无报错消失。
 */
export function parsePrefabSize(value: unknown, field: string): number {
    if (value === null || value === undefined || value === '') return 1;
    const parsed = readConfigNumber(value, field);
    if (parsed <= 0) {
        throw new Error(`${field} 必须是大于 0 的数字，收到 ${parsed}`);
    }
    return parsed;
}
