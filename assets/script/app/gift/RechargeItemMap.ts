/** `item` 表 → `resId` 到品质/图标的映射，供累计充值和每日充值共用。 */
export function parseRechargeItemMap(
    rows: readonly unknown[],
): Map<number, { quality: number; icon: string }> {
    const map = new Map<number, { quality: number; icon: string }>();
    for (const row of rows) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
        const r = row as Record<string, unknown>;
        const resId = Number(r.resId);
        if (!Number.isSafeInteger(resId) || resId <= 0) continue;
        map.set(resId, {
            quality: Number(r.quality) || 1,
            icon: typeof r.icon === 'string' ? r.icon : '',
        });
    }
    return map;
}
