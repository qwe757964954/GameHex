/**
 * MatchTipsConfig —— 匹配界面底部「提示」条的轮播文案配置。
 *
 * 数据来源：doc/塔防数据配置/P-匹配提示.xlsx（sheet「匹配提示」）
 *   → 转表工具 TFDocGenerator → assets/remoteRef/matchTips.json
 * 该表随 `remoteRef` bundle 下发，运行时经 RefUtil 读取，与 ZCGuideConfig 同一套机制。
 *
 *  代码里**不持有任何提示文案** —— 策划改文案只动 Excel。
 * 表没下发 / 解析为空时返回空列表，界面据此隐藏提示条（不会露出写死的兜底文案）。
 */

import { RefUtil } from '../../framework/ref/RefUtil';
import type { ConfigService } from '../../core/config/ConfigService';

/** 一条提示（对应表中一行）。 */
export interface MatchTipEntry {
    /** 提示 ID，如 `tip-01`。 */
    id: string;
    /** 展示排序，升序。 */
    order: number;
    /** 提示条正文。 */
    text: string;
    /** 策划备注，仅编辑器/日志使用。 */
    remark: string;
}

/** 已加载的提示文案缓存；进入匹配前预载一次，界面打开后直接取。 */
let cachedTips: readonly string[] | null = null;

/** 解析一行；缺 id/order 不算错，缺 text 的行直接丢弃（空文案上屏没有意义）。 */
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

/**
 * 读取提示条目。
 *
 * 排序放在客户端做一次（表里的行序不保证等于展示序），order 相同时按 id 兜底排序，
 * 保证多次读取的顺序稳定。
 */
export async function loadMatchTipEntries(configs?: ConfigService): Promise<MatchTipEntry[]> {
    const rows = configs
        ? await configs.getTable('matchTips')
        : (await RefUtil.instance.getRefAllAsync('matchTips')) ?? [];
    return rows
        .map(parseEntry)
        .filter((entry): entry is MatchTipEntry => entry !== null)
        .sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id));
}

/**
 * 读取提示文案（已按 order 排好的纯文本列表）。
 *
 * 结果缓存在模块内：配置表在整个会话里不会变，重复调用不重复读盘/解压。
 * 读取失败也缓存空列表并告警 —— 与其在上屏时反复重试，不如让界面明确地不显示提示条。
 */
export async function loadMatchTips(configs?: ConfigService): Promise<readonly string[]> {
    if (cachedTips) return cachedTips;
    try {
        const entries = await loadMatchTipEntries(configs);
        cachedTips = entries.map((entry) => entry.text);
        if (!cachedTips.length) console.warn('[MatchTipsConfig] matchTips 配置为空，提示条将隐藏');
    } catch (error) {
        console.error('[MatchTipsConfig] matchTips 配置读取失败', error);
        cachedTips = [];
    }
    return cachedTips;
}
