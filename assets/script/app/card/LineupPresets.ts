/**
 * 布阵页签与后端阵型映射 —— 纯函数，零引擎依赖。
 * 页签下标 → formationId = 下标 + 1。
 * 「没有阵型数据」(null) 与「阵型是空的」(空数组) 必须分开。
 */
import type { ZCDeckCard } from '../zcds/model/ZCCombatCatalog';
import type { ZCFormation } from './FormationModel';

export function presetFormationId(index: number): number {
    const normalized = Math.floor(Number(index));
    return (Number.isFinite(normalized) ? Math.max(0, normalized) : 0) + 1;
}

export interface PresetDeckSource {
    readonly deck: readonly ZCDeckCard[];
    readonly pool: readonly ZCDeckCard[];
    readonly formations: readonly ZCFormation[] | null;
}

/** 卡 id → 卡，deck 优先于 pool。 */
function indexCards(source: PresetDeckSource): ReadonlyMap<string, ZCDeckCard> {
    const byId = new Map<string, ZCDeckCard>();
    for (const group of [source.deck, source.pool]) {
        for (const card of group) {
            if (!byId.has(card.id)) byId.set(card.id, card);
        }
    }
    return byId;
}

/**
 * 阵型 heroId 列表 → 卡；本地没有的 id 跳过并告警。
 *
 * 跳过是「压缩」而不是「留空」：后面的卡会整体往前挪一格，于是空出来的永远是最后那几格。
 * 最常见的来源是主城（`2002`）—— 它是 `pvpCard` 的一行、后端当成"英雄"下发，
 * 但客户端 `isHqCard` 把它当建筑摘掉（`loadPvpCatalogCards` / `playerDeck` 都摘），
 * 所以只要某个阵型是老端口径存下来的（含主城），八卡就会只剩七张。
 * 现场看到的是「某张卡的站台空着 / 阵容少一格」，很容易误判成「这张卡丢了」。
 */
function resolveHeroIds(
    heroIds: readonly number[],
    byId: ReadonlyMap<string, ZCDeckCard>,
    formationId: number,
): ZCDeckCard[] {
    const cards: ZCDeckCard[] = [];
    const missing: number[] = [];
    for (const heroId of heroIds) {
        const card = byId.get(String(heroId));
        if (card) cards.push(card);
        else missing.push(heroId);
    }
    if (missing.length > 0) {
        console.warn(
            '[LineupPresets] 阵型里有本地卡表没有的英雄 id，这些卡位会被跳过（站台会少格，不是卡丢了）',
            formationId, missing,
        );
    }
    return cards;
}

/**
 * 后端阵型 → 每个页签一份初始卡组。
 * formations=null（断网/预览）→ 每页签用本地八卡；
 * 无该 formationId → 空卡组；有 → 按 heroIds 取。
 */
export function buildPresetDecks(
    source: PresetDeckSource,
    presetCount: number,
): readonly (readonly ZCDeckCard[])[] {
    const count = Math.max(1, Math.floor(presetCount) || 1);
    const formations = source.formations;
    if (formations === null) return Array.from({ length: count }, () => source.deck);

    const byId = indexCards(source);
    const byFormation = new Map(formations.map((entry) => [entry.formationId, entry]));
    return Array.from({ length: count }, (_unused, index) => {
        const formation = byFormation.get(presetFormationId(index));
        if (!formation) return [] as ZCDeckCard[];
        return resolveHeroIds(formation.heroIds, byId, formation.formationId);
    });
}

/**
 * 当前选中阵型的卡组。
 * null = 无阵型数据（调用方退回本地卡组）；空数组 = 选中阵型明确没人（一键下阵）。
 */
export function resolveSelectedDeck(source: PresetDeckSource): readonly ZCDeckCard[] | null {
    const formations = source.formations;
    if (formations === null) return null;

    const selected = formations.find((entry) => entry.selected);
    if (!selected) return null;

    return resolveHeroIds(selected.heroIds, indexCards(source), selected.formationId);
}
