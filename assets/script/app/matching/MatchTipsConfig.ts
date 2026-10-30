/** 提示文案来自 matchTips 表；为空或读取失败时隐藏提示区。 */

import type { ConfigService } from '../../core/config/ConfigService';

export interface MatchTipEntry {
    id: string;
    order: number;
    text: string;
    remark: string;
}

/** 空文案丢弃，缺失或非法排序值按 0 处理。 */
function parseEntry(value: unknown): MatchTipEntry | null {
    if (!value || typeof value !== 'object') return null;
    const raw = value as Record<string, unknown>;
    const text = typeof raw.text === 'string' ? raw.text.trim() : '';
    if (!text) return null;
    const order = Number(raw.order);
    return {
        id: typeof raw.id === 'string' ? raw.id : '',
        order: Number.isFinite(order) ? order : 0,
        text,
        remark: typeof raw.remark === 'string' ? raw.remark : '',
    };
}

/** 同 order 按 id 排序，保证展示顺序稳定。 */
export async function loadMatchTipEntries(configs: ConfigService): Promise<MatchTipEntry[]> {
    const rows = await configs.getTable('matchTips');
    return rows
        .map(parseEntry)
        .filter((entry): entry is MatchTipEntry => entry !== null)
        .sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id));
}

/** 配置缓存交给 ConfigService；失败不固化为空列表。 */
export async function loadMatchTips(configs: ConfigService): Promise<readonly string[]> {
    try {
        const entries = await loadMatchTipEntries(configs);
        const tips = entries.map((entry) => entry.text);
        if (!tips.length) console.warn('[MatchTipsConfig] matchTips 配置为空，提示条将隐藏');
        return tips;
    } catch (error) {
        console.error('[MatchTipsConfig] matchTips 配置读取失败', error);
        return [];
    }
}
