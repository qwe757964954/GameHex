/** 标量公共件；NaN 语义按调用方显式选择，不做隐式统一。 */

/** `0..1` 夹紧；NaN 透传（匹配既有 `Math.min/max` 与 core/hex 变体）。 */
export function clamp01(value: number): number {
    return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** `0..1` 夹紧；非有限值归 0（匹配 `Number.isFinite` / `!(value > 0)` 变体）。 */
export function clamp01Finite(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** 是否为 uint32 整数（0..0xffffffff）。 */
export function isUint32(value: unknown): value is number {
    return typeof value === 'number'
        && Number.isInteger(value)
        && value >= 0
        && value <= 0xffffffff;
}

/** 先向下取整，再夹到 uint32 范围。 */
export function clampUint32(value: number): number {
    return Math.min(0xffffffff, Math.max(0, Math.floor(value)));
}
