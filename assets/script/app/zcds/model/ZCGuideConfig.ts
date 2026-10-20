import { BUILDING_ART_ROOT, GAMEUI_ART_ROOT, spriteFramePath } from '../../ArtPaths';

/** 奖励品级，与 ZCPvpTileRules.ZCPvpDrawRarity 对齐（'空' = 抽空/空地）。 */
export type ZCGuideRarity = '空' | '绿' | '蓝' | '紫' | '金';

export interface ZCGuideReward {
    name: string;
    rate: number;
    rarity: ZCGuideRarity;
}

export interface ZCGuideEntry {
    id: string;
    order: number;
    title: string;
    icon: string;
    price: number;
    rewards: ZCGuideReward[];
    remark: string;
}

export interface ZCGuideParams {
    panelTitle: string;
    footerText: string;
    emptyText: string;
}

const DEFAULT_PARAMS: Readonly<ZCGuideParams> = {
    panelTitle: '指南',
    footerText: '',
    emptyText: '暂无指南内容',
};

/**
 * 图标键到资源路径的唯一映射；具体加载由 application 层负责。
 *
 *  键名必须与 `remoteRef/zcGuide.json` 的 `icon` 列逐一对上（表里写了没登记的键 =
 * 静默无图标；登记了但磁盘没图 = `Bundle resources doesn't contain ...` 一条 warn + 留白）。
 *
 * 「兵营」取 `barracks-default`：r361（2026-09-28）美术重做兵营外观时删掉了通用的
 * `barracks-icon.png`，换成 `barracks-<武将>.png` 八张专属图（卡表 `buildIcon` 用），
 * 无 `buildIcon` 时的通用兵营外观就是 `barracks-default`（同 `ZCGameRenderWorld.resolveBuildingFrame`
 * 与 `TerritoryPage` 的口径）。
 *
 * 「防御塔」原本登记 `tower-icon`，同一批被删且**没有替代图**（塔在地图上走
 * `ZCHexView.BUILDING_SYMBOLS` 的「塔」字符，没有专属贴图，`resolveBuildingFrame`
 * 对 tower 直接返回 null）；表里当前也没有防御塔条目，故整条移除。
 * 日后要在表里加防御塔，先让美术往 `image/buildings/` 补图再登记回来。
 */
const GUIDE_ICON_PATHS = {
    金矿: spriteFramePath(BUILDING_ART_ROOT, 'mine'),
    兵营: spriteFramePath(BUILDING_ART_ROOT, 'barracks-default'),
    问号: spriteFramePath(GAMEUI_ART_ROOT, 'icon_question'),
} as const;

/** 表里登记过的 icon 键；调用方与测试都用它做收窄，写错键名会直接编译不过。 */
export type ZCGuideIconKey = keyof typeof GUIDE_ICON_PATHS;

export function getGuideIconPath(icon: string): string | null {
    // 键来自 remoteRef/zcGuide.json 的 icon 列，运行时是任意字符串，先判存在再索引。
    return icon in GUIDE_ICON_PATHS ? GUIDE_ICON_PATHS[icon as ZCGuideIconKey] : null;
}

export function parseGuideEntries(rows: readonly unknown[]): ZCGuideEntry[] {
    return rows
        .map(parseEntry)
        .filter((entry): entry is ZCGuideEntry => entry !== null)
        .sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id));
}

export function parseGuideParams(rows: readonly unknown[]): ZCGuideParams {
    const merged: Record<string, unknown> = {};
    for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const raw = row as Record<string, unknown>;
        if (typeof raw.key === 'string' && raw.key) merged[raw.key] = raw.value;
    }
    const text = (key: keyof ZCGuideParams): string => (
        typeof merged[key] === 'string' && merged[key] ? merged[key] as string : DEFAULT_PARAMS[key]
    );
    return {
        panelTitle: text('panelTitle'),
        footerText: text('footerText'),
        emptyText: text('emptyText'),
    };
}

function parseEntry(value: unknown): ZCGuideEntry | null {
    if (!value || typeof value !== 'object') return null;
    const raw = value as Record<string, unknown>;
    if (typeof raw.id !== 'string' || !raw.id) return null;
    const price = Number(raw.price);
    return {
        id: raw.id,
        order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : 0,
        title: typeof raw.title === 'string' ? raw.title : raw.id,
        icon: typeof raw.icon === 'string' ? raw.icon : '问号',
        price: Number.isFinite(price) ? price : 0,
        rewards: parseRewards(raw.rewards),
        remark: typeof raw.remark === 'string' ? raw.remark : '',
    };
}

function parseRewards(value: unknown): ZCGuideReward[] {
    if (!Array.isArray(value)) return [];
    const result: ZCGuideReward[] = [];
    for (const item of value) {
        if (!item || typeof item !== 'object') continue;
        const raw = item as Record<string, unknown>;
        const rate = Number(raw.rate);
        if (!Number.isFinite(rate) || typeof raw.name !== 'string' || !raw.name) continue;
        result.push({
            name: raw.name,
            rate,
            rarity: (typeof raw.rarity === 'string' ? raw.rarity : '空') as ZCGuideRarity,
        });
    }
    return result;
}
