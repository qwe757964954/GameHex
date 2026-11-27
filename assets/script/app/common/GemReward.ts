/**
 * 宝石奖励的展示口径（零 `cc`，可直接 import 单测）。
 *
 * 宝石**不是道具**：`gem` 表按部位登记（`resId` 1000000 / 1010000 / …，六个部位），
 * 名称与品质档位在 `gemQuality`（quality 1..7 → 图标_宝石_白色..粉色，图在 `icons/gem`）。
 * 服务端发奖走 `CmdGoods`，宝石那一条的 `resId` 是**宝石实例 id**（gemId）：
 *   `gemId = 部位 resId 的前段 × 10000 + 属性 id`
 * 老端口径（`RoleRepository.readGemBag`）就是这么反解的，本文件与之保持一致：
 *   `部位 resId = floor(gemId / 10000) * 10000`，`attrId = gemId % 10000`，`quality = floor(attrId / 1000) + 1`。
 *
 * 品质优先取 `CmdGoods.quality`（服务端直接给），缺省再按末四位推；
 * 两条都拿不到时退品质 1，**不抛**（表缺 / 字段缺也要能出格子）。
 */

/** 宝石图标目录（`main-pages` bundle，`BundleCatalog` 按前缀路由）。 */
const GEM_ICON_ROOT = 'icons/gem';

/** `gem` 表名。 */
export const GEM_TABLE = 'gem';

/** `gemQuality` 表名。 */
export const GEM_QUALITY_TABLE = 'gemQuality';

/** 一个宝石部位（`gem` 一行）。 */
export interface IGemRow {
    readonly resId: number;
    readonly name: string;
}

/** 一个品质档位（`gemQuality` 一行）。 */
export interface IGemQualityRow {
    readonly quality: number;
    readonly name: string;
    /** FGUI 裸图标名（如 `图标_宝石_紫色`），图在 {@link GEM_ICON_ROOT}。 */
    readonly icon: string;
}

/** 宝石展示要用的两张表。 */
export interface IGemTables {
    readonly gems: ReadonlyMap<number, IGemRow>;
    readonly qualities: ReadonlyMap<number, IGemQualityRow>;
}

/** 一条宝石奖励的展示信息。 */
export interface IGemRewardInfo {
    readonly quality: number;
    readonly iconPath: string;
}

/** `gem` 全表 → `resId` 索引（坏行跳过）。 */
export function parseGemRows(rows: readonly unknown[] | null | undefined): Map<number, IGemRow> {
    const map = new Map<number, IGemRow>();
    for (const raw of rows ?? []) {
        if (!raw || typeof raw !== 'object') continue;
        const row = raw as Record<string, unknown>;
        const resId = Math.floor(Number(row.resId) || 0);
        if (resId <= 0) continue;
        map.set(resId, { resId, name: typeof row.desc === 'string' ? row.desc : '' });
    }
    return map;
}

/** `gemQuality` 全表 → `quality` 索引。 */
export function parseGemQualityRows(rows: readonly unknown[] | null | undefined): Map<number, IGemQualityRow> {
    const map = new Map<number, IGemQualityRow>();
    for (const raw of rows ?? []) {
        if (!raw || typeof raw !== 'object') continue;
        const row = raw as Record<string, unknown>;
        const quality = Math.floor(Number(row.quality) || 0);
        if (quality <= 0) continue;
        map.set(quality, {
            quality,
            name: typeof row.desc === 'string' ? row.desc : '',
            icon: typeof row.icon === 'string' ? row.icon : '',
        });
    }
    return map;
}

/** 宝石实例 id → `gem` 表的部位 resId（前段 × 10000）；非宝石返回 0。 */
export function gemBaseResIdOf(resId: number): number {
    const value = Math.floor(Number(resId) || 0);
    if (value <= 0) return 0;
    return Math.floor(value / 10000) * 10000;
}

/** 宝石实例 id 的末四位（属性 id）→ 品质；推不出返回 0。 */
export function gemQualityOfResId(resId: number): number {
    const value = Math.floor(Number(resId) || 0);
    const attrId = value % 10000;
    if (attrId <= 0) return 0;
    return Math.floor(attrId / 1000) + 1;
}

/**
 * 一条奖励 `resId` 若是宝石（实例 id 或部位 resId 均可），返回品质与图标路径；
 * 不是宝石 / 表缺失返回 `null`（调用方继续走 `item` / `roleProperty`）。
 */
export function gemRewardOf(
    resId: number,
    quality: number | undefined,
    tables: IGemTables | null | undefined,
): IGemRewardInfo | null {
    if (!tables) return null;
    const value = Math.floor(Number(resId) || 0);
    if (value <= 0) return null;

    const exact = tables.gems.get(value);
    const base = exact ? value : gemBaseResIdOf(value);
    const gem = exact ?? (base > 0 ? tables.gems.get(base) : undefined);
    if (!gem) return null;

    const fromPayload = Math.floor(Number(quality) || 0);
    const want = fromPayload > 0 ? fromPayload : gemQualityOfResId(value);
    const qualityRow = tables.qualities.get(want) ?? tables.qualities.get(1);
    // 品质档优先信 payload / 末四位；`gemQuality` 缺行只影响图标，不能把底框也压回 1。
    const resolvedQuality = qualityRow ? qualityRow.quality : (want > 0 ? want : 1);
    const iconPath = qualityRow?.icon ? `${GEM_ICON_ROOT}/${qualityRow.icon}` : '';
    return { quality: resolvedQuality, iconPath };
}
