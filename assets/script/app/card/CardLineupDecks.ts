import { ZC_RUNTIME_CONFIG } from '../zcds/model/ZCRuntimeConfigStore';
import { RefUtil } from '../../framework/ref/RefUtil';
import {
    calculateDeckBonuses,
    getBondRules,
    getPlayerDeck,
    ZCDeckBonuses,
    ZCDeckCard,
} from '../zcds/model/ZCCombatCatalog';
import {
    isHqCard,
    normalizeCardRow,
    parseBondRules,
    parseCard,
    parseCardCatalogRow,
} from '../zcds/model/ZCGameRuntimeConfig';
import type { PvpHeroInfo } from './PvpHeroService';

/**
 * 阵容页的数据供给。
 *
 * 正常流程由运行时注入卡组；编辑器里战斗流程没跑过，getPlayerDeck() 是空的，
 * 所以这里补一条兜底：deck 为空时读 pvpCard + pvpBond 注进去。
 * 解析复用 ZCGameRuntimeConfig，别再写一套，否则同张表会出现两种口径。
 *
 * 卡库和布阵卡池不是一回事：CardGrid 用全表图鉴，布阵只列玩家已有的卡。
 */

/** 卡组行，只有 enabled 这个本地字段。 */
type ZCDeckRow = ZCDeckCard & { enabled: boolean };

/** 读一张分表；表不存在就当空数组。 */
async function readRows(table: string): Promise<unknown[]> {
    return (await RefUtil.instance.getRefAllAsync(table)) ?? [];
}

/** 解析 pvpCard，坏行跳过，别让一行坏数据把整页卡住。 */
function parseDecks(rows: unknown[]): { player: ZCDeckCard[]; enemy: ZCDeckCard[] } {
    // 本地只做编辑器预览：启用的非主城卡都算玩家卡，敌方复制一份。
    const player: ZCDeckCard[] = [];
    for (const row of rows) {
        let card: ZCDeckRow;
        try {
            // normalizeCardRow 不能省：表里 enabled 是 1，parseCard 只认 === true。
            card = parseCard(normalizeCardRow(row));
        } catch (error) {
            console.warn('[CardLineupDecks] pvpCard 有一行解析失败，已跳过', error);
            continue;
        }
        if (!card.enabled) continue;
        if (isHqCard(card)) continue;
        player.push(card);
    }
    return { player, enemy: [...player] };
}

/**
 * 保证卡组和羁绊规则可用，返回玩家八卡。
 * 已经注入过就直接用；没有才读 pvpCard + pvpBond。两张表都读不到就返回空数组。
 */
export async function ensureLineupDecks(): Promise<readonly ZCDeckCard[]> {
    if (getPlayerDeck().length > 0) return getPlayerDeck();

    const revision = ZC_RUNTIME_CONFIG.revision;
    const [cardRows, bondRows] = await Promise.all([readRows('pvpCard'), readRows('pvpBond')]);
    if (ZC_RUNTIME_CONFIG.revision !== revision) return getPlayerDeck();
    const { player, enemy } = parseDecks(cardRows);
    if (player.length === 0) {
        console.warn('[CardLineupDecks] pvpCard 未读到启用卡牌，页面将保持占位外观');
        return [];
    }
    ZC_RUNTIME_CONFIG.updateCatalogs({ playerDeck: player, enemyDeck: enemy,
        bonds: getBondRules().length === 0 && bondRows.length > 0 ? parseBondRules(bondRows) : getBondRules() });
    return player;
}

/**
 * 按后端英雄列表组装布阵卡池。顺序以卡表为准，避免服务端顺序一变 UI 就跳。
 * 阵容页的 CardGrid 不用它，那里看全表图鉴。
 */
export async function loadPvpHeroCards(infos: readonly PvpHeroInfo[]): Promise<readonly ZCDeckCard[]> {
    const wanted = new Set(infos.map((info) => String(info.heroId)));
    const found = new Set<string>();
    /**
     * 表里存在的 id，包括后面会被筛掉的主城。
     * 告警只关心“后端给了、表里没有”，主城属于表里有但不可上阵，不能算缺配置。
     */
    const known = new Set<string>();
    const cards: ZCDeckCard[] = [];

    for (const row of await readRows('pvpCard')) {
        try {
            const card = parseCardCatalogRow(row);
            known.add(card.id);
            if (!card.enabled || isHqCard(card) || !wanted.has(card.id) || found.has(card.id)) continue;
            cards.push(card);
            found.add(card.id);
        } catch (error) {
            console.warn('[CardLineupDecks] pvpCard 有一行卡池数据解析失败，已跳过', error);
        }
    }

    // 别展开 Set，构建器会把它降级成 [].concat(set)，日志内容会变得没法看。
    // 差集用 known，不用 found。
    const unknown = Array.from(wanted).filter((id) => !known.has(id));
    if (unknown.length > 0) {
        console.warn('[CardLineupDecks] 后端英雄在 pvpCard 中没有对应配置', unknown);
    }
    return cards;
}

/**
 * 卡库数据：pvpCard 全表，不看玩家有没有。
 * 图鉴要能翻到配置里的每张卡，后端英雄列表只负责填等级和标出战中。
 * 主城是场地建筑，不是卡，必须用 isHqCard 摘掉；金矿是能上阵的卡，保留。
 */
export async function loadPvpCatalogCards(): Promise<readonly ZCDeckCard[]> {
    const cards: ZCDeckCard[] = [];
    const found = new Set<string>();

    for (const row of await readRows('pvpCard')) {
        try {
            const card = parseCardCatalogRow(row);
            if (!card.enabled || isHqCard(card) || found.has(card.id)) continue;
            cards.push(card);
            found.add(card.id);
        } catch (error) {
            console.warn('[CardLineupDecks] pvpCard 有一行卡池数据解析失败，已跳过', error);
        }
    }
    return cards;
}

/** 从 `cardLevelUp` 计算每个英雄的等级上限，供卡牌进度条作分母。 */
export async function loadPvpHeroLevelCaps(): Promise<ReadonlyMap<string, number>> {
    const caps = new Map<string, number>();
    for (const value of await readRows('cardLevelUp')) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        const row = value as Record<string, unknown>;
        const id = Number(row.id);
        const level = Number(row.level);
        if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(level) || level < 0) continue;
        const key = String(id);
        caps.set(key, Math.max(caps.get(key) ?? 0, level));
    }
    return caps;
}

/**
 * 读 cardLevelUp 原始行。升级弹窗要用整行（消耗、两种经验），不要只抽等级。
 */
export async function loadCardLevelUpRows(): Promise<readonly unknown[]> {
    return readRows('cardLevelUp');
}

/**
 * 读 `armySkillLevelUp` 的原始行（技能级的等级/解锁/描述都在这一张表里）。
 *
 * 与 `loadCardLevelUpRows` 同口径：只负责取数，聚合与判定在 `CardSkillList`（无引擎依赖、可单测）。
 */
export async function loadArmySkillLevelUpRows(): Promise<readonly unknown[]> {
    return readRows('armySkillLevelUp');
}

/**
 * 读 `pvpCard` 里指定卡（按 id）的原始行；没有返回 `null`。
 *
 * 详情页的六维属性要用 `unitMaxHp` / `unitAttack` 等未进 `ZCDeckCard` 的列，
 * 与 `loadCardLevelUpRows` 同一条「原始行」口径，不另写一套解析。
 */
export async function loadPvpCardRawRow(cardId: string): Promise<Record<string, unknown> | null> {
    for (const row of await readRows('pvpCard')) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
        const record = row as Record<string, unknown>;
        if (String(record.id) === String(cardId)) return record;
    }
    return null;
}

/** 读 `pvpUnitGrowth` 的原始行（详情页兵种成长）。 */
export async function loadPvpUnitGrowthRows(): Promise<readonly unknown[]> {
    return readRows('pvpUnitGrowth');
}

/**
 * 一次读回 pvpCard 全部原始行，调用方按 id 自己查。
 * 战力要连算 8 张，逐张走 loadPvpCardRawRow 会反复读整表。
 */
export async function loadPvpCardRawRows(): Promise<readonly Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = [];
    for (const row of await readRows('pvpCard')) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
        rows.push(row as Record<string, unknown>);
    }
    return rows;
}

/** 当前阵容的羁绊加成（供加成条展示）。deck 为空时返回中性值。 */
export function currentDeckBonuses(deck: readonly ZCDeckCard[]): ZCDeckBonuses {
    return calculateDeckBonuses(deck);
}
