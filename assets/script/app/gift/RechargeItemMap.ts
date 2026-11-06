/**
 * 充值类活动共用的「`item` 表 → 展示信息」解析（纯函数、零 `cc`）。
 *
 * `RechargeActivityRepository`（累计充值）与 `RechargeDailyRepository`（每日充值）
 * 原本各写了一份逐行相同的 `parseItemMap`。两处读的是同一张 `item` 表、
 * 产出同样的 `{ quality, icon }`，没有理由各留一份。
 *
 * 脏数据口径保持不变：非对象行跳过、`resId` 非正整数跳过、
 * `quality` 取不到按 1、`icon` 非字符串按空串（视图侧本来就要容忍缺图）。
 */

/**
 * @param rows `item` 配置表的原始行（可能是脏数据）
 * @returns resId → 品质与图标路径
 */
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
