import type { SpriteFrame } from 'cc';
import { BUILDING_ART_ROOT, GAMEUI_ART_ROOT, spriteFramePath } from '../../ArtPaths';
import { ZC_CARD_RARITIES } from './ZCCombatCatalog';
import type { ZCPvpDrawRarity } from './ZCPvpTileRules';

/** 指南配置表（对应 `assets/remoteRef/zcGuide.json`）。*/
export const ZC_GUIDE_TABLE = 'zcGuide';
/** 指南全局参数表（对应 `assets/remoteRef/zcGuideParams.json`）。*/
export const ZC_GUIDE_PARAMS_TABLE = 'zcGuideParams';

/** 必须与 ZCGuideItem.prefab 的奖励槽位数一致。 */
export const ZC_GUIDE_MAX_REWARDS = 4;

export interface ZCGuideReward {
    name: string;
    rate: number;
    rarity: ZCPvpDrawRarity;
}

export interface ZCGuideEntry {
    id: string;
    order: number;
    title: string;
    icon: ZCGuideIconKey | null;
    price: number;
    rewards: readonly ZCGuideReward[];
    remark: string;
}

export interface ZCGuideParams {
    panelTitle: string;
    footerText: string;
    emptyText: string;
    rewardColumns: 1 | 2;
}

/** 点开指南后交给弹窗的只读展示数据。*/
export interface IZCGuidePreparedContent {
    readonly entries: readonly ZCGuideEntry[];
    readonly params: ZCGuideParams;
    readonly iconFrames: ReadonlyMap<ZCGuideIconKey, SpriteFrame>;
}

export const ZC_GUIDE_DEFAULT_PARAMS: Readonly<ZCGuideParams> = {
    panelTitle: '指南',
    footerText: '',
    emptyText: '暂无指南内容',
    rewardColumns: 2,
};

const GUIDE_ICON_PATHS = {
    mine: spriteFramePath(BUILDING_ART_ROOT, 'mine'),
    barracks: spriteFramePath(BUILDING_ART_ROOT, 'barracks-default'),
    question: spriteFramePath(GAMEUI_ART_ROOT, 'icon_question'),
} as const;

export type ZCGuideIconKey = keyof typeof GUIDE_ICON_PATHS;

function isGuideIconKey(icon: unknown): icon is ZCGuideIconKey {
    return typeof icon === 'string' && Object.prototype.hasOwnProperty.call(GUIDE_ICON_PATHS, icon);
}

export function getGuideIconPath(icon: string): string | null {
    return isGuideIconKey(icon) ? GUIDE_ICON_PATHS[icon] : null;
}

export function parseGuideEntries(rows: readonly unknown[]): ZCGuideEntry[] {
    return rows
        .map(parseEntry)
        .filter((entry): entry is ZCGuideEntry => entry !== null)
        .sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id));
}

export function parseGuideParams(rows: readonly unknown[]): ZCGuideParams {
    const merged = new Map<string, unknown>();
    for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const raw = row as Record<string, unknown>;
        if (typeof raw.key === 'string' && raw.key) merged.set(raw.key, raw.value);
    }
    const text = (key: 'panelTitle' | 'footerText' | 'emptyText'): string => {
        const value = merged.get(key);
        return typeof value === 'string' && value ? value : ZC_GUIDE_DEFAULT_PARAMS[key];
    };
    const rewardColumns = merged.get('rewardColumns');
    return {
        panelTitle: text('panelTitle'),
        footerText: text('footerText'),
        emptyText: text('emptyText'),
        rewardColumns: rewardColumns === 1 || rewardColumns === '1' ? 1 : ZC_GUIDE_DEFAULT_PARAMS.rewardColumns,
    };
}

function parseEntry(value: unknown): ZCGuideEntry | null {
    if (!value || typeof value !== 'object') return null;
    const raw = value as Record<string, unknown>;
    if (typeof raw.id !== 'string' || !raw.id) return null;
    const rewards = parseRewards(raw.rewards);
    if (rewards.length > ZC_GUIDE_MAX_REWARDS) return null;
    const price = Number(raw.price);
    const icon = raw.icon ?? 'question';
    return {
        id: raw.id,
        order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : 0,
        title: typeof raw.title === 'string' ? raw.title : raw.id,
        icon: isGuideIconKey(icon) ? icon : null,
        price: Number.isFinite(price) ? price : 0,
        rewards,
        remark: typeof raw.remark === 'string' ? raw.remark : '',
    };
}

function parseRewards(value: unknown): ZCGuideReward[] {
    if (!Array.isArray(value)) return [];
    const result: ZCGuideReward[] = [];
    for (const item of value) {
        if (!item || typeof item !== 'object') continue;
        const raw = item as Record<string, unknown>;
        const rate = typeof raw.rate === 'string' && raw.rate.trim() ? Number(raw.rate) : raw.rate;
        if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 100
            || typeof raw.name !== 'string' || !raw.name.trim()) continue;
        const rarity = raw.rarity === 'empty' ? 'empty' : ZC_CARD_RARITIES.find(id => id === raw.rarity);
        if (!rarity) continue;
        result.push({
            name: raw.name,
            rate,
            rarity,
        });
    }
    return result;
}
