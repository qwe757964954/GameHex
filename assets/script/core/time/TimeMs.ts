/** 时间口径公共件（纯 TS，零引擎依赖）。 */

export const MS_PER_SECOND = 1000;
export const SECONDS_PER_DAY = 86400;
export const MS_PER_DAY = 86400000;
export const DAY_MS = MS_PER_DAY;
export const TICK_SECONDS = 1;

/** `Long` / `string` / `number` → 毫秒；Long 优先 `toNumber()`，非法值返回 0。 */
export function toMillis(value: unknown): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    if (value && typeof value === 'object') {
        const long = value as { toNumber?: () => number; low?: number; high?: number };
        if (typeof long.toNumber === 'function') {
            const parsed = long.toNumber();
            return Number.isFinite(parsed) ? parsed : 0;
        }
        if (typeof long.low === 'number' && typeof long.high === 'number') {
            return long.high * 4294967296 + (long.low >>> 0);
        }
    }
    return 0;
}

/** 本地时区当天 0 点（毫秒）。 */
export function startOfDay(timeMs: number): number {
    const date = new Date(timeMs);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}

/** {@link startOfDay} 的语义别名。 */
export function startOfDayMs(timeMs: number): number {
    return startOfDay(timeMs);
}

export function pad2(value: number): string {
    return value < 10 ? `0${value}` : String(value);
}

/** 秒级 HMS（小时可超过 24）；与 HangTable 现有 `formatHms` 同口径。 */
export function formatHmsMs(ms: number): string {
    const totalSeconds = Math.ceil(Math.max(0, ms) / MS_PER_SECOND);
    const hh = Math.floor(totalSeconds / 3600);
    const mm = Math.floor((totalSeconds % 3600) / 60);
    const ss = totalSeconds % 60;
    return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
}
