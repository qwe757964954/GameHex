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
 * 卡牌阵容页的数据供给。
 *
 * 正常流程里卡组由 `ensureZCRuntimeCompiled()` 从整套 PVP 分表注入；但本页要能
 * **独立在编辑器预览**（那时战斗流程没跑过，`getPlayerDeck()` 是空的），
 * 所以这里补一条兜底：deck 为空时只读 `pvpCard` + `pvpBond` 两张分表并注入。
 *
 * 解析**直接复用** `ZCGameRuntimeConfig` 的 `normalizeCardRow` / `parseCard` /
 * `parseBondRules`，不另写一套 —— 否则同一张表的字段口径会在两处漂移。
 * 特别是 `normalizeCardRow` 不能省：表里 `enabled` 是数字 `1`，而 `parseCard`
 * 判的是严格 `=== true`，漏掉它会让整张 pvpCard 被过滤空（且不报错）。
 *
 * 只做「取数」；加成条的文案 / 百分比换算在 `CardLineupTypes`（无引擎依赖，可单测）。
 *
 * 卡库两个口径别混（2026-09-18）：
 *   - `loadPvpCatalogCards()` —— **图鉴**：`pvpCard` 全表，阵容页的 `CardGrid` 用它；
 *   - `loadPvpHeroCards()`   —— **我的卡**：后端英雄列表 ∩ 卡表，布阵弹窗的卡池用它。
 */

/** 卡组行；deck 列已删除（2026-09-28），只保留 enabled。 */
type ZCDeckRow = ZCDeckCard & { enabled: boolean };

/** 读一张分表的全部行；表缺失时返回空数组。 */
async function readRows(table: string): Promise<unknown[]> {
    return (await RefUtil.instance.getRefAllAsync(table)) ?? [];
}

/**
 * 把 pvpCard 的行解析成两套卡组；解析失败的行直接跳过（单行坏数据不该整页打不开）。
 *
 */
function parseDecks(rows: unknown[]): { player: ZCDeckCard[]; enemy: ZCDeckCard[] } {
    // deck/slot 列已删除（2026-09-28）：双方卡组由后端 unitInfos 下发。
    // 本地只做编辑器预览 fallback：所有 enabled 非主城卡都当玩家卡，enemy 同 player。
    const player: ZCDeckCard[] = [];
    for (const row of rows) {
        let card: ZCDeckRow;
        try {
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
 * 确保卡组与羁绊规则可用；返回玩家八卡。
 *
 * - 已经注入过（`getPlayerDeck()` 非空）→ 直接用，不再读表；
 * - 否则读 `pvpCard` + `pvpBond` 注入一次。
 *
 * 两张表都读不到时返回空数组，页面会保留 prefab 里的占位外观而不是报错。
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
 * 按后端英雄列表组装卡牌页下半区的卡库。
 *
 * 后端 `heroId` 与 `pvpCard.id` 使用同一套编号；显示顺序以卡表为准，避免服务端容器顺序
 * 改变时 UI 跳动。服务端返回但本地卡表不存在的 id 会被忽略并记录告警。
 *
 *  阵容页的卡库（`CardLineup/CardGrid`）**不再用它** —— 那里要用全表图鉴，
 * 见 `loadPvpCatalogCards()`。这里留给「布阵卡池」（`LineupBoardPage`）：那是个**可部署**
 * 的池子，只该列出玩家真正拥有的卡，口径与图鉴不同，别合并。
 */
export async function loadPvpHeroCards(infos: readonly PvpHeroInfo[]): Promise<readonly ZCDeckCard[]> {
    const wanted = new Set(infos.map((info) => String(info.heroId)));
    const found = new Set<string>();
    /**
     * 表里**存在**的 id（含下面被筛掉的主城）。
     *
     * 与 `found` 分开记的原因：告警问的是「后端给了、表里却没有」，而主城（`2002`）是
     * **表里有、但不可上阵** —— 后端英雄列表里必然带着它。若直接拿 `found` 求差集，
     * 每次进布阵页都会打一条 `["2002"]` 的「没有对应配置」，看着像丢了张卡，
     * 实际只是被 `isHqCard` 正常筛掉了。
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

    // `wanted` 是 Set：展开会被构建期降级成 `[].concat(set)` → unknown 变成 [Set]，
    // 这条警告日志会打出一堆看不懂的东西。用 Array.from。
    // 差集用 `known` 而不是 `found`：主城这类「表里有、但不可上阵」的卡不算缺配置。
    const unknown = Array.from(wanted).filter((id) => !known.has(id));
    if (unknown.length > 0) {
        console.warn('[CardLineupDecks] 后端英雄在 pvpCard 中没有对应配置', unknown);
    }
    return cards;
}

/**
 * 卡库（`CardLineup/CardGrid`）的数据源：**`pvpCard` 全表**，不看后端拥有关系。
 *
 * 与 `loadPvpHeroCards()` 的区别就是「图鉴」与「我的卡」：
 *   - 这里要能浏览 / 点开配置里配了的**每一张**卡（未拥有也看得见，等级显示 0 级）；
 *   - 后端英雄列表（`fetchPvpHeroInfos`）只负责两件事：填等级、标「已出战！」。
 *
 * 于是断网 / 后端列表为空时卡库照样是完整一屏，而不是只剩出战八张（旧行为）。
 *
 * 顺序**就是卡表顺序**（转表器按行走）：先「玩家默认」八张出战卡、再 PVE 敌方八张、
 * 最后是 20 张卡池卡 —— 顺序稳定，不随服务端返回顺序变化跳动。
 *
 *  主城（`type=5`）必须摘掉：它是场地固有建筑而不是卡（`isHqCard`，与 `loadPvpTables`
 * 同一道闸）。它是「玩家默认」的第一行，漏掉会在卡库里多出一张点不开的卡。
 * 其余建筑行（金矿 `type=1`）保留 —— 它是真能上阵的一张卡（`玩家默认` 里就有）。
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
 * 读 `cardLevelUp` 的**原始行**。
 *
 * 升级弹窗（`CardUpgradePage`）要用整行（消耗卡牌 id/数量、两种经验 id、
 * 经验数量），不能像 `loadPvpHeroLevelCaps()` 那样只抽出等级 —— 所以单独开一个入口，
 * 而不是把解析散到弹窗里：**取数口径只有一处**（同一张 `RefUtil` 表、
 * 同样先 `normalizeCardRow` 的口径由 `RefUtil` 负责）。
 */
export async function loadCardLevelUpRows(): Promise<readonly unknown[]> {
    return readRows('cardLevelUp');
}

/**
 * 读 `armySkillLevelUp` 的**原始行**（技能级的等级/解锁/描述都在这一张表里）。
 *
 * 与 `loadCardLevelUpRows` 同口径：只负责取数，聚合与判定在 `CardSkillList`（无引擎依赖、可单测）。
 */
export async function loadArmySkillLevelUpRows(): Promise<readonly unknown[]> {
    return readRows('armySkillLevelUp');
}

/**
 * 读 `pvpCard` 里指定卡（按 id）的**原始行**；没有返回 `null`。
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
 * 读 `pvpCard` 的**全部原始行**（一次读表，按 id 现查）。
 *
 * 与 `loadPvpCardRawRow` 的区别：那个是「一次拿一张」，阵容战力要连算 8 张，
 * 逐张调会读 8 遍整表。返回原样数组（含坏行），由调用方按 `String(row.id)` 建索引 ——
 * 这里不做过滤，保持与 `RefUtil` 一致的口径。
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
