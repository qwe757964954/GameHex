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
        // `Long.toString()` 给的是十进制精确值（`String(long)` 也走这里，不经 `valueOf`）
        // ⇒ 超过 2^53 的 id 不会丢精度。
        const long = value as { toString?: () => string; low?: number; high?: number };
        if (typeof long.toString === 'function') {
            const text = long.toString();
            if (text && text !== '[object Object]') return text;
        }
        if (typeof long.low === 'number' && typeof long.high === 'number') {
            return String(long.high * 4294967296 + (long.low >>> 0));
        }
    }
    return '';
}

/**
 * `Long` / `string` / `number` → 有限数值；认不出来返回 `fallback`。
 *
 * 默认 `fallback = 0`，保持既有调用方的降级语义；需要区分“缺失/非法”和显式 0 时，
 * 由调用方传第二个参数（如引导表的 `guideId` 缺省 1）。
 *
 * Long 优先 `toNumber()`（与 `TimeMs.toMillis` 同口径）：它是**唯一**能正确处理
 * `uint64` 高位值的路径 —— 手写 `high * 2^32 + (low >>> 0)` 把 `high` 当有符号，
 * 对 `uint64` 全 1 会算出 `-1`、对 `2^63` 会符号翻转。`low/high` 只作为
 * 没有 `toNumber` 的 Long 形状对象的兜底（sint64 上与 `toNumber()` 逐值等价）。
 */
export function toCount(value: unknown, fallback = 0): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }
    if (value && typeof value === 'object') {
        const long = value as { toNumber?: () => number; low?: number; high?: number };
        if (typeof long.toNumber === 'function') {
            const parsed = long.toNumber();
            return Number.isFinite(parsed) ? parsed : fallback;
        }
        if (typeof long.low === 'number' && typeof long.high === 'number') {
            return long.high * 4294967296 + (long.low >>> 0);
        }
    }
    return fallback;
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
