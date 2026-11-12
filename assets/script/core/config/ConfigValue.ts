function invalidValue(field: string, expected: string, value: unknown): never {
    const actual = typeof value === 'string' ? JSON.stringify(value) : String(value);
    throw new Error(`${field} 必须是${expected}，收到 ${actual}`);
}

export function readConfigObject(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalidValue(field, '对象', value);
    return value as Record<string, unknown>;
}

export function readConfigArray(value: unknown, field: string): unknown[] {
    if (!Array.isArray(value)) invalidValue(field, '数组', value);
    return value;
}

export function readConfigText(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) invalidValue(field, '非空字符串', value);
    return value;
}

/** 不转换类型；旧表兼容转换及缺值默认值由配置入口决定。 */
export function readConfigNumber(value: unknown, field: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) invalidValue(field, '有限数字', value);
    return value;
}

export function readConfigInteger(
    value: unknown, field: string, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER,
): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
        invalidValue(field, `${min}~${max} 的安全整数`, value);
    }
    return value;
}
