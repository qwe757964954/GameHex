/**
 * 值归一化公共件（纯 TS，零引擎依赖）。
 *
 * 口径来自 `app/net/RequestGuard` 的既有实现；`RequestGuard` 继续 re-export，
 * 新代码优先直接 import 本文件，避免 common 再反向依赖 net。
 */

/** `Long` / `string` / `number` → 十进制字符串；认不出来返回空串。 */
export function toIdString(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
    if (value && typeof value === 'object') {
        const long = value as { toString?: () => string; low?: number; high?: number };
        if (typeof long.low === 'number' && typeof long.high === 'number') {
            if (typeof long.toString === 'function') {
                const text = long.toString();
                if (text && text !== '[object Object]') return text;
            }
            return String(long.high * 4294967296 + (long.low >>> 0));
        }
        if (typeof long.toString === 'function') {
            const text = long.toString();
            if (text && text !== '[object Object]') return text;
        }
    }
    return '';
}

/** `Long` / `string` / `number` → 有限数值；认不出来返回 0。 */
export function toCount(value: unknown): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    if (value && typeof value === 'object') {
        const long = value as { toNumber?: () => number; low?: number; high?: number };
        if (typeof long.low === 'number' && typeof long.high === 'number') {
            return long.high * 4294967296 + (long.low >>> 0);
        }
        if (typeof long.toNumber === 'function') {
            const parsed = long.toNumber();
            return Number.isFinite(parsed) ? parsed : 0;
        }
    }
    return 0;
}

/** 正整数字段；非法返回 `null`。 */
export function toPositiveInt(value: unknown): number | null {
    const num = toCount(value);
    return Number.isSafeInteger(num) && num > 0 ? num : null;
}

/** 文本字段安全取值；只接受 string / 有限 number，其余返回 fallback。 */
export function toText(value: unknown, fallback = ''): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return fallback;
}
