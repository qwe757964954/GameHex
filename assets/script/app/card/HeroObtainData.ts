/**
 * 「获得英雄」页的展示数据解析：`heroId → 名字 / 立绘 / 职业徽标`。
 *
 * 只做**读表 + 归一**，不碰节点：页面拿到 {@link IHeroObtainData} 后一次性渲染。
 *
 *  - 卡数据走 `pvpCard`（与阵容页同一入口 `loadPvpCardRawRow` + `parseCardCatalogRow`），
 *    避免同张表两套解析；
 *  - 头像走 `icon` 表（`兵种_头像_*` → `icons/cardHead/*`），只当 Spine 加载失败时的兜底；
 *  - 职业徽标走 `cardUiArtClass`（`name` 是中文职业名，和 `pvpCard.traits.attack` 同词表）。
 *
 * ⚠️ 设计稿的职业徽标是**射手**（`yx_zhiye_ss`），但 `椰蛋战士` 在 `pvpCard` 里是**战士**，
 *    徽标按数据走（`yx_zhiye_zs`）。设计稿只是拿这张卡当模特，不能把徽标写死。
 */
import { RefUtil } from '../../framework/ref/RefUtil';
import { ICON_PACKAGE_ART_ROOT } from '../ArtPaths';
import { loadPvpCardRawRow } from './CardLineupDecks';
import { parseCardCatalogRow } from '../zcds/model/ZCGameRuntimeConfig';

export interface IHeroObtainUserData {
    /** `pvpCard.id`（如 68005 椰蛋战士）；给了才会读表补名字 / 立绘 / 徽标。 */
    readonly heroId?: number | string;
    /** 覆盖表里的名字。 */
    readonly name?: string;
    /** 覆盖头图（`icons/cardHead/*` 这类 resources 路径，不含 `spriteFrame` 后缀）。 */
    readonly headIconPath?: string;
    /** 覆盖兵种预制体路径（`skel/<英雄>/<英雄>`）。 */
    readonly unitPrefabPath?: string;
    /** 覆盖兵种等比缩放（`pvpCard.prefabSize`）。 */
    readonly prefabSize?: number;
    /** 覆盖职业徽标（`icons/card/yx_zhiye_*`）。 */
    readonly badgePath?: string;
    /** 碎片进度（缺省则不展示进度条）。 */
    readonly progressCurrent?: number;
    readonly progressMax?: number;
}

export interface IHeroObtainProgress {
    readonly current: number;
    readonly max: number;
}

export interface IHeroObtainData {
    readonly name: string;
    readonly headIconPath: string | null;
    readonly unitPrefabPath: string | null;
    readonly prefabSize: number;
    readonly badgePath: string | null;
    readonly progress: IHeroObtainProgress | null;
}

/** 设计稿模特（预览 / GM 调试用）。 */
export const HERO_OBTAIN_DEMO_USER_DATA: IHeroObtainUserData = {
    heroId: 68005,
    progressCurrent: 53,
    progressMax: 53,
};

function textOf(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

/** `ui://图标_兵种_头像/yedanzhanshi` → `icons/cardHead/yedanzhanshi`。 */
function artPathOfIconUrl(url: string): string | null {
    if (!url.startsWith('ui://')) return null;
    const slash = url.lastIndexOf('/');
    if (slash < 0) return null;
    const packageName = url.slice('ui://'.length, slash);
    const art = url.slice(slash + 1);
    const root = ICON_PACKAGE_ART_ROOT[packageName];
    if (!root || !art) return null;
    return `${root}/${art}`;
}

/** 读 `icon` 表，把 `兵种_头像_*` 换成 `icons/cardHead/*`；查不到返回 null。 */
async function headIconPathOf(name: string): Promise<string | null> {
    if (!name) return null;
    const rows = await RefUtil.instance.getRefAllAsync('icon') as readonly Record<string, unknown>[];
    for (const row of rows) {
        if (textOf(row.key) !== name.trim()) continue;
        return artPathOfIconUrl(textOf(row.path));
    }
    return null;
}

/** 读 `cardUiArtClass`，按中文职业名取徽标；查不到返回 null。 */
async function badgePathOf(className: string): Promise<string | null> {
    if (!className) return null;
    const rows = await RefUtil.instance.getRefAllAsync('cardUiArtClass') as readonly Record<string, unknown>[];
    for (const row of rows) {
        if (textOf(row.name) !== className.trim()) continue;
        const badge = textOf(row.badge);
        return badge || null;
    }
    return null;
}

function progressOf(userData: IHeroObtainUserData): IHeroObtainProgress | null {
    const current = userData.progressCurrent;
    const max = userData.progressMax;
    if (typeof current !== 'number' || typeof max !== 'number') return null;
    if (!(max > 0)) return null;
    return { current: Math.min(max, Math.max(0, Math.floor(current))), max: Math.floor(max) };
}

/**
 * `pvpCard.id` → 展示数据。表里查不到 / 解析失败时退回入参覆盖值，页面照样能开。
 */
export async function resolveHeroObtainData(userData: IHeroObtainUserData): Promise<IHeroObtainData> {
    let name = textOf(userData.name);
    let headIconPath = userData.headIconPath ? textOf(userData.headIconPath) : null;
    let unitPrefabPath = userData.unitPrefabPath ? textOf(userData.unitPrefabPath) : null;
    let prefabSize = typeof userData.prefabSize === 'number' && userData.prefabSize > 0 ? userData.prefabSize : 1;
    let badgePath = userData.badgePath ? textOf(userData.badgePath) : null;

    const heroId = userData.heroId === undefined || userData.heroId === null ? '' : String(userData.heroId);
    if (heroId) {
        const row = await loadPvpCardRawRow(heroId);
        if (row) {
            const card = parseCardCatalogRow(row);
            name = name || card.name;
            unitPrefabPath = unitPrefabPath || card.unitPrefabPath || null;
            prefabSize = card.prefabSize && card.prefabSize > 0 ? card.prefabSize : prefabSize;
            headIconPath = headIconPath || await headIconPathOf(card.headIcon ?? '');
            badgePath = badgePath || await badgePathOf(String(card.traits?.attack ?? ''));
        }
    }

    return {
        name: name || '英雄',
        headIconPath,
        unitPrefabPath,
        prefabSize,
        badgePath,
        progress: progressOf(userData),
    };
}
