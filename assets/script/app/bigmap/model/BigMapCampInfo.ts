export interface IBigMapCampInfo {
    readonly campId: number;
    readonly opType: 0 | 1;
    readonly state: 0 | 1 | 2 | 3;
}

export const BIGMAP_CAMP_STATE_TEXT = ['未开放', '开放', '攻城中', '结算中'] as const;
export const BIGMAP_CAMP_OCCUPATION_TEXT = ['未占领', '已占领'] as const;
export const BIGMAP_CAMP_QUERY_TEXT = {
    pending: '据点信息加载中',
    failed: '据点信息获取失败，请重新选择据点重试',
    failedCanAttack: '暂未获取据点状态，可尝试攻打',
    attackUnavailable: '攻城操作暂未接入服务器',
} as const;

export function isBigMapCampId(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 0xFFFFFFFF;
}

/** 必填字段缺失或枚举未知时丢弃该条，不能把脏回包当成「未开放」。 */
export function normalizeBigMapCampInfos(response: unknown): readonly IBigMapCampInfo[] | null {
    if (!response || typeof response !== 'object') return null;
    const infos = (response as { infos?: unknown }).infos;
    if (!Array.isArray(infos)) return null;
    const result = new Map<number, IBigMapCampInfo>();
    for (const info of infos) {
        if (!info || typeof info !== 'object') continue;
        const { campId, opType, state } = info as { campId?: unknown; opType?: unknown; state?: unknown };
        if (!isBigMapCampId(campId) || (opType !== 0 && opType !== 1)
            || (state !== 0 && state !== 1 && state !== 2 && state !== 3)) continue;
        result.set(campId, { campId, opType, state });
    }
    return [...result.values()];
}
