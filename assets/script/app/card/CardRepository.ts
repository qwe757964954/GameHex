import type { ZCDeckBonuses, ZCDeckCard } from '../zcds/model/ZCCombatCatalog';
import { getPlayerDeck, setCardRarityMeta } from '../zcds/model/ZCCombatCatalog';
import { RequestPvpHeroUpLevel, RequestPvpHeroUpSkill } from '../generated/requestMsg/RequestPvpMsg';
import { GameNet } from '../net/GameNet';
import {
    currentDeckBonuses,
    ensureLineupDecks,
    loadArmySkillLevelUpRows,
    loadCardLevelUpRows,
    loadPvpCardRawRow,
    loadPvpCardRawRows,
    loadPvpCatalogCards,
    loadPvpHeroCards,
    loadPvpHeroLevelCaps,
    loadPvpUnitGrowthRows,
} from './CardLineupDecks';
import { buildCardLevelUpTable, evaluateUpgrade } from './CardUpgradeCost';
import type { ZCCardLevelUpTable, ZCUpgradeStatus } from './CardUpgradeCost';
import { resolveCardLevelAttrs, resolveCardLevelAttrsPair } from './CardLevelAttr';
import { cardAttackOf, formatPowerText, lineupAttackTotal } from './CardLineupPower';
import type { ICardPowerInput } from './CardLineupPower';
import { buildArmySkillTable } from './CardSkillList';
import type { ZCArmySkillTable } from './CardSkillList';
import {
    buildDetailChain,
    buildDetailMilestones,
    buildDetailStats,
    detailBaseOfRow,
    parseGrowthRows,
} from './CardDetailPresenter';
import { buildCritDamageGainTable, critDamageGainAt } from './CardDetailCritDamage';
import type { ZCCritDamageGainTable } from './CardDetailCritDamage';
import type { CardDetailPresentation } from './CardDetailPresenter';
import { fetchFormations, FORMATION_PREFETCH_FRESH_MS, getCachedFormations, saveFormation, selectFormation } from './FormationService';
import type { FormationSaveResult, ZCFormation } from './FormationService';
import { readLineupSnapshot, writeLineupSnapshot } from './LineupSnapshot';
import { createItemCounter } from './ItemBag';
import { resolveSelectedDeck } from './LineupPresets';
import { visibleLineupCards } from './CardLineupTypes';
import {
    applyPvpHeroLevel,
    applyPvpHeroSkillLevel,
    fetchPvpHeroInfos,
    getCachedPvpHeroInfo,
    getCachedPvpHeroInfos,
    normalizePvpHeroInfos,
} from './PvpHeroService';
import type { PvpHeroInfo, PvpHeroSkillLevel } from './PvpHeroService';
import { RefUtil } from '../../framework/ref/RefUtil';
import { CARD_ART_TABLES, parseCardArtConfig, type ICardArtConfig } from './CardArtConfig';
import { cardArtProvider, type ICardDetailArt } from './CardArtProvider';
import { itemDetailRepository } from '../itemdetail/ItemDetailRepository';
import { loadItemIconArt } from '../itemdetail/ItemDetailArtLoader';
import type { ICardSkillCost } from './CardPresentations';
import { resBarCellOfRefId, resBarIconSpritePath } from '../common/ResTypes';
import { readRoleRow } from '../main/MainRoleRow';
import { toCount } from '../net/RequestGuard';

export interface CardLineupData {
    /** 当前上阵卡攻击力合计；快照或权威数据未就绪时不提供。 */
    readonly power?: number;
    readonly art: ICardArtConfig;
    readonly deck: readonly ZCDeckCard[];
    readonly catalog: readonly ZCDeckCard[];
    readonly heroLevels: ReadonlyMap<string, number>;
    readonly heroLevelCaps: ReadonlyMap<string, number>;
    readonly heroListKnown: boolean;
    /** 服务端阵型这次是否拿到；false 时 deck 为空，上阵区留空等数据。 */
    readonly formationsKnown: boolean;
    readonly bonuses: ZCDeckBonuses;
}

export type CardDetailNavigationData = Pick<CardLineupData, 'catalog' | 'heroLevels' | 'heroListKnown'>;

export interface LineupBoardData {
    readonly art: ICardArtConfig;
    readonly deck: readonly ZCDeckCard[];
    readonly pool: readonly ZCDeckCard[];
    readonly heroLevels: ReadonlyMap<string, number>;
    readonly heroLevelCaps: ReadonlyMap<string, number>;
    /**
     * 后端阵型。null 表示没有可用数据（未连接或请求失败），空数组表示服务端确认没有阵型。
     */
    readonly formations: readonly ZCFormation[] | null;
}

/** 技能面板一次取数要的东西：卡表里的技能顺序 + 技能表 + 该英雄的技能等级。 */
export interface CardSkillListData {
    readonly skillDetails?: ReadonlyMap<number, { readonly kind: string; readonly cooldown: number }>;
    readonly costItems?: ReadonlyMap<number, Omit<ICardSkillCost, 'need'>>;
    /** 卡牌配置里的技能 id 顺序（`pvpCard.skillList`）；没配置时为空。 */
    readonly skillIds: readonly number[];
    /** `armySkillLevelUp` 聚合后的技能表。 */
    readonly table: ZCArmySkillTable;
    /** 该英雄的技能等级（后端 `CmdPvpHeroInfo.skills`）；没有后端数据时为空。 */
    readonly levels: readonly PvpHeroSkillLevel[];
    /** 该英雄的等级（用于判「下一档解锁没有」）。 */
    readonly heroLevel: number;
}

export type UpgradeHeroResult =
    | { readonly kind: 'success'; readonly heroId: number; readonly level: number }
    | { readonly kind: 'offline' }
    | { readonly kind: 'failed' };

/** 技能升级成功的结果；`skills` 是服务端回的那条英雄信息里的技能表快照。 */
export type UpgradeHeroSkillResult =
    | {
        readonly kind: 'success';
        readonly heroId: number;
        readonly skillId: number;
        readonly level: number;
        readonly skills: readonly PvpHeroSkillLevel[];
    }
    | { readonly kind: 'offline' }
    | { readonly kind: 'failed' };

/** 页面 Presenter 依赖的统一数据端口；测试可以注入内存实现。 */
export interface ICardRepository {
    loadArtConfig(): Promise<ICardArtConfig>;
    loadDetailArt(card: ZCDeckCard | null): Promise<ICardDetailArt>;
    loadLineup(autoLoadDecks: boolean, refreshFormations?: boolean): Promise<CardLineupData>;
    /** 首帧用的本地阵容快照；命中才返回值，否则返回 null。 */
    loadLineupSnapshot(): CardLineupData | null;
    loadBoard(autoLoadDecks: boolean): Promise<LineupBoardData>;
    /** 详情切卡使用完整卡库；首帧阵容快照不包含卡库。 */
    loadDetailNavigation(): Promise<CardDetailNavigationData>;
    loadUpgradeStatus(cardId: string, level: number): Promise<ZCUpgradeStatus>;
    /** 详情页取数（六维属性 + 技能链 + 里程碑）；失败由调用方按 `null` 降级。英雄等级内部取后端缓存。 */
    loadCardDetail(cardId: string, level: number): Promise<CardDetailPresentation>;
    /**
     * 阵容战力，本地算，不发协议。返回 0 表示阵容未就绪或全是建筑卡。
     */
    loadLineupPower(lineup?: Pick<CardLineupData, 'deck' | 'heroLevels'>): Promise<number>;
    upgradeHero(heroId: number, caller?: object): Promise<UpgradeHeroResult>;
    upgradeHeroSkill(heroId: number, skillId: number, caller?: object): Promise<UpgradeHeroSkillResult>;
    /** 技能面板取数（卡表技能顺序 + `armySkillLevelUp` + 该英雄技能等级）。 */
    loadSkillList(heroId: number): Promise<CardSkillListData>;
    applyHeroLevel(heroId: number, level: number): void;
    /** 覆盖保存一个阵型；结果里带回服务端确认后的阵型。 */
    saveFormation(formationId: number, heroIds: readonly number[], caller?: object): Promise<FormationSaveResult>;
    /**
     * 把服务端的「出战阵型」指向某一条（`CmdFormationSelectReqMsg`），不动卡组。
     *
     * 布阵页切页签时用：页签切换本身就是「这条阵型出战」的意思，
     * 卡组内容有没有改是另一件事（那才走 `saveFormation`）。
     */
    selectFormation(formationId: number, caller?: object): Promise<boolean>;
}

/** 生产环境 Repository：统一封装 Ref 表、后端英雄列表、背包与升级请求。 */
export class RuntimeCardRepository implements ICardRepository {
    // 只缓存与账号无关的不可变配置，随应用中的 Repository 实例存活。
    private artConfig: ICardArtConfig | null = null;
    private artTask: Promise<ICardArtConfig> | null = null;

    loadArtConfig(): Promise<ICardArtConfig> {
        if (this.artConfig) return Promise.resolve(this.artConfig);
        if (!this.artTask) {
            this.artTask = Promise.all([
                RefUtil.instance.getRefAllAsync(CARD_ART_TABLES.rarity),
                RefUtil.instance.getRefAllAsync(CARD_ART_TABLES.cardClass),
                RefUtil.instance.getRefAllAsync(CARD_ART_TABLES.camp),
                RefUtil.instance.getRefAllAsync('icon'),
            ]).then(([rarity, cardClass, camp, icons]) => {
                const art = parseCardArtConfig({
                    rarity: rarity ?? [],
                    cardClass: cardClass ?? [],
                    camp: camp ?? [],
                }, icons ?? []);
                this.artConfig = art;
                setCardRarityMeta(art.lineup.rarities);
                return art;
            }).finally(() => { this.artTask = null; });
        }
        return this.artTask;
    }

    async loadDetailArt(card: ZCDeckCard | null): Promise<ICardDetailArt> {
        return cardArtProvider.loadDetail(card, await this.loadArtConfig());
    }
    /**
     * cardLevelUp 建表结果。卡库一次要 36 张卡的进度，复用一张表避免重复解析全表。
     * 按 rows 引用判命中；RefUtil 返回同一份冻结数组，引用变了就重建。
     */
    private levelUpTable: { readonly rows: readonly unknown[]; readonly table: ZCCardLevelUpTable } | null = null;

    /**
     * pvpSkillPlan 的全队暴击伤害建表结果，与 levelUpTable 同样按 rows 引用缓存。
     */
    private critGainTable: { readonly rows: readonly unknown[]; readonly table: ZCCritDamageGainTable } | null = null;

    /**
     * 卡牌阵容页取数：优先用服务端选中阵型的 heroIds；拿不到阵型数据时退回本地卡表，
     * 阵型为空数组则保持空阵容。catalog 用全表，阵型里的英雄可能不在本地八卡中。
     */
    async loadLineup(autoLoadDecks: boolean, refreshFormations = true): Promise<CardLineupData> {
        // 缓存命中就不再拉英雄列表；升级成功时 applyPvpHeroLevel 已经写回新等级。
        const cached = getCachedPvpHeroInfos();
        const [tableDeck, heroInfos, heroLevelCaps, catalog, formations, art] = await Promise.all([
            autoLoadDecks ? ensureLineupDecks() : Promise.resolve(getPlayerDeck()),
            cached === null ? fetchPvpHeroInfos() : Promise.resolve(cached),
            loadPvpHeroLevelCaps(),
            loadPvpCatalogCards(),
            // maxAgeMs：切 tab 时 prefetchHero 已经预取过一次，几百毫秒内的结果直接复用。
            refreshFormations
                ? fetchFormations({ label: '阵容页首屏阵型', maxAgeMs: FORMATION_PREFETCH_FRESH_MS })
                : Promise.resolve(getCachedFormations()),
            this.loadArtConfig(),
        ]);
        const heroLevels = this.levels(heroInfos);
        const selectedDeck = resolveSelectedDeck({ deck: tableDeck, pool: catalog, formations });
        // 只给服务端确认过的选中阵型写快照，本地默认八卡不能当玩家阵容持久化。
        if (selectedDeck) writeLineupSnapshot(selectedDeck, heroLevels);
        const deck = formations === null ? [] : (selectedDeck ?? tableDeck);
        return {
            art,
            deck,
            catalog,
            heroLevels,
            heroLevelCaps,
            heroListKnown: heroInfos !== null,
            formationsKnown: formations !== null,
            power: formations !== null && heroInfos !== null ? await this.loadLineupPower({ deck, heroLevels }) : undefined,
            bonuses: currentDeckBonuses(deck),
        };
    }

    /**
     * 首帧快照只包含上阵八卡与等级，卡库留空。
     * 卡库要加载 36 张卡面和升级进度，跟着快照抢首帧既慢也没必要。
     */
    loadLineupSnapshot(): CardLineupData | null {
        const art = this.artConfig;
        if (!art) return null;
        const snapshot = readLineupSnapshot();
        if (!snapshot || snapshot.cards.length === 0) return null;
        const heroLevels = new Map<string, number>();
        for (const [key, value] of Object.entries(snapshot.levels)) heroLevels.set(key, value);
        return {
            art,
            deck: snapshot.cards,
            catalog: [],
            heroLevels,
            heroLevelCaps: new Map(),
            // 快照来自服务端确认过的数据，未出现在 levels 里的等级按 0 处理。
            heroListKnown: true,
            formationsKnown: true,
            bonuses: currentDeckBonuses(snapshot.cards),
        };
    }

    /**
     * 详情页左右切卡的目录。金矿是真能上阵的卡，但没有升级配置，
     * 这里和卡库展示层一样用 visibleLineupCards 摘掉。
     */
    async loadDetailNavigation(): Promise<CardDetailNavigationData> {
        const catalog = visibleLineupCards(await loadPvpCatalogCards());
        const infos = getCachedPvpHeroInfos();
        return { catalog, heroLevels: this.levels(infos), heroListKnown: infos !== null };
    }

    async loadBoard(autoLoadDecks: boolean): Promise<LineupBoardData> {
        const cached = getCachedPvpHeroInfos();
        const [deck, heroInfos, heroLevelCaps, formations, art] = await Promise.all([
            autoLoadDecks ? ensureLineupDecks() : Promise.resolve(getPlayerDeck()),
            cached === null ? fetchPvpHeroInfos() : Promise.resolve(cached),
            loadPvpHeroLevelCaps(),
            fetchFormations(),
            this.loadArtConfig(),
        ]);
        const pool = heroInfos === null ? deck : await loadPvpHeroCards(heroInfos);
        // 卡池为空时日志要能区分「后端列表不可用」和「有英雄但 pvpCard 对不上」。
        if (pool.length === 0) {
            console.warn(
                '[CardRepository] 布阵卡池为空：'
                + (heroInfos === null
                    ? `后端英雄列表不可用（未连接/请求失败），回落到本地卡组也是空的（pvpCard 没读到「玩家默认」？），deck=${deck.length}`
                    : `后端给了 ${heroInfos.length} 个英雄，但没一个能在 pvpCard 里对上号（先看 [CardLineupDecks] 那条列 id 的告警）`),
            );
        }
        return { art, deck, pool, heroLevels: this.levels(heroInfos), heroLevelCaps, formations };
    }

    async loadUpgradeStatus(cardId: string, level: number): Promise<ZCUpgradeStatus> {
        const rows = await loadCardLevelUpRows();
        return evaluateUpgrade(this.levelUpTableOf(rows), cardId, level, createItemCounter());
    }

    /**
     * 详情页取数。四份表并行读取，英雄等级取后端缓存，组装交给 CardDetailPresenter。
     */
    async loadCardDetail(cardId: string, level: number): Promise<CardDetailPresentation> {
        const [rawRow, growthRaw, skillRaw, cards, levelUpRaw, plans] = await Promise.all([
            loadPvpCardRawRow(cardId),
            loadPvpUnitGrowthRows(),
            loadArmySkillLevelUpRows(),
            loadPvpCatalogCards(),
            loadCardLevelUpRows(),
            RefUtil.instance.getRefAllAsync('pvpSkillPlan'),
        ]);
        const card = cards.find((item) => item.id === String(cardId)) ?? null;
        const skillIds = card?.skillIds ?? [];
        const table = buildArmySkillTable(skillRaw);
        // 等级属性走 cardLevelUp.attrList（绝对值）；这张卡没配时 pair 两个都是 null，
        // buildDetailStats 内部回落 pvpUnitGrowth，老行为不变。
        const levelAttrs = resolveCardLevelAttrsPair(this.levelUpTableOf(levelUpRaw), String(cardId), level);
        const heroLevel = getCachedPvpHeroInfo(Number(cardId))?.level ?? 0;
        const base = detailBaseOfRow(rawRow);
        const growthRows = parseGrowthRows(growthRaw);
        const unitId = String(card?.unitId ?? '');
        return {
            stats: buildDetailStats(
                base,
                growthRows,
                unitId,
                level,
                levelAttrs.current,
                levelAttrs.next,
            ),
            powerText: formatPowerText(cardAttackOf({ cardId, base, unitId, level, levelAttrs: levelAttrs.current }, growthRows)),
            // 全队暴击伤害链按「目标等级」那一行取增量（卡牌升级就给，与星级/技能档无关）。
            critDamageGain: critDamageGainAt(this.critGainTableOf(plans ?? []), String(cardId), level),
            chain: buildDetailChain(table, skillIds, heroLevel),
            milestones: buildDetailMilestones(table, skillIds, heroLevel),
        };
    }

    /**
     * 阵容战力，本地算，不发协议。与 loadCardDetail 共用同一批取数和纯函数，
     * 保证主界面与详情页攻击力口径一致。读表异常只告警返回 0，不拖垮 HUD。
     */
    async loadLineupPower(lineup?: Pick<CardLineupData, 'deck' | 'heroLevels'>): Promise<number> {
        try {
            if (!lineup) return (await this.loadLineup(false)).power ?? 0;
            if (lineup.deck.length === 0) return 0;
            const [cardRows, growthRaw, levelUpRaw] = await Promise.all([
                loadPvpCardRawRows(),
                loadPvpUnitGrowthRows(),
                loadCardLevelUpRows(),
            ]);
            const rowById = new Map<string, Record<string, unknown>>();
            for (const row of cardRows) rowById.set(String(row.id), row);
            const table = this.levelUpTableOf(levelUpRaw);
            const inputs: ICardPowerInput[] = lineup.deck.map((card) => {
                const level = lineup.heroLevels.get(card.id) ?? 0;
                return {
                    cardId: card.id,
                    base: detailBaseOfRow(rowById.get(String(card.id)) ?? null),
                    unitId: String(card.unitId ?? ''),
                    level,
                    levelAttrs: resolveCardLevelAttrs(table, card.id, level),
                };
            });
            return lineupAttackTotal(inputs, parseGrowthRows(growthRaw));
        } catch (error) {
            console.warn('[CardRepository] 阵容战力计算失败，保留占位', error);
            return 0;
        }
    }

    private levelUpTableOf(rows: readonly unknown[]): ZCCardLevelUpTable {
        const cached = this.levelUpTable;
        if (cached && cached.rows === rows) return cached.table;
        const table = buildCardLevelUpTable(rows);
        this.levelUpTable = { rows, table };
        return table;
    }

    private critGainTableOf(rows: readonly unknown[]): ZCCritDamageGainTable {
        const cached = this.critGainTable;
        if (cached && cached.rows === rows) return cached.table;
        const table = buildCritDamageGainTable(rows);
        this.critGainTable = { rows, table };
        return table;
    }

    /**
     * 技能面板取数。技能顺序读 pvpCard.skillList，技能内容读 armySkillLevelUp，
     * 已升档位读后端缓存，不按 level 猜。
     */
    async loadSkillList(heroId: number): Promise<CardSkillListData> {
        const [rows, plans, properties] = await Promise.all([
            loadArmySkillLevelUpRows(), RefUtil.instance.getRefAllAsync('pvpSkillPlan'),
            RefUtil.instance.getRefAllAsync('roleProperty'),
        ]);
        const table = buildArmySkillTable(rows);
        const info = getCachedPvpHeroInfo(heroId);
        const fallbackIds = Array.from(table.keys());
        const skillIds = await this.skillIdsOf(heroId, fallbackIds);
        const skillDetails = new Map<number, { kind: string; cooldown: number }>();
        for (const raw of plans ?? []) {
            const plan = raw as Record<string, unknown>;
            const id = Number(plan.skillChainId);
            if (String(plan.unitId) !== String(heroId) || !skillIds.includes(id) || !Number(plan.enabled)) continue;
            if (skillDetails.has(id)) continue;
            skillDetails.set(id, {
                kind: String(plan.skillKind ?? ''),
                cooldown: Math.max(0, Number(plan.cooldown) || 0),
            });
        }
        const itemIds = new Set(skillIds.flatMap(id => table.get(id)?.levels.flatMap(level => level.costs?.map(cost => cost.itemId) ?? []) ?? []));
        const counter = createItemCounter();
        const role: Readonly<Record<string, unknown>> = { ...readRoleRow() };
        const costItems = new Map<number, Omit<ICardSkillCost, 'need'>>();
        await Promise.all(Array.from(itemIds, async itemId => {
            const currency = resBarCellOfRefId(itemId, properties);
            const item = currency.kind === 'roleProperty' ? null : await itemDetailRepository.loadItemRow(itemId);
            const icon = currency.kind === 'roleProperty' ? resBarIconSpritePath(currency) : item?.icon ?? '';
            const frame = icon ? await loadItemIconArt(icon) : null;
            const key = currency.key;
            const owned = key ? Math.max(0, Math.floor(toCount(role[key]))) : counter(String(itemId));
            costItems.set(itemId, { itemId, name: currency.name || item?.name || String(itemId), frame, owned });
        }));
        return {
            skillIds,
            skillDetails,
            costItems,
            table,
            levels: info?.skills ?? [],
            heroLevel: info?.level ?? 0,
        };
    }

    /**
     * 卡表里这张卡的技能顺序。卡在但 skillList 为空按无技能处理；
     * 卡表里找不到才退回 fallbackIds。
     */
    private async skillIdsOf(heroId: number, fallbackIds: readonly number[]): Promise<readonly number[]> {
        const cards = await loadPvpCatalogCards();
        for (const card of cards) {
            if (card.id !== String(heroId)) continue;
            return card.skillIds ?? [];
        }
        return fallbackIds;
    }

    async upgradeHero(heroId: number, caller?: object): Promise<UpgradeHeroResult> {
        const net = GameNet.instance;
        if (!net.isConnected) return { kind: 'offline' };
        let response: CmdPvpHeroUpLevelRspMsg | null = null;
        try {
            const ok = await net.send(
                new RequestPvpHeroUpLevel({ heroId }, caller, (rsp) => { response = rsp; }),
                false,
            );
            if (!ok || !response) return { kind: 'failed' };
        } catch (error) {
            console.warn('[CardRepository] 升级请求失败', error);
            return { kind: 'failed' };
        }
        const info = (response as CmdPvpHeroUpLevelRspMsg).info;
        const resolvedHeroId = Number(info?.heroId ?? heroId);
        const level = Number(info?.level);
        if (!Number.isSafeInteger(resolvedHeroId) || resolvedHeroId <= 0
            || !Number.isSafeInteger(level) || level < 0) return { kind: 'failed' };
        // 不在这里写缓存：Presenter 升完会调 applyHeroLevel，而它不传 skills ⇒
        // applyPvpHeroLevel 原样保留缓存里的技能等级（否则升个等级就把技能清空）。
        return { kind: 'success', heroId: resolvedHeroId, level };
    }

    /**
     * 升某个英雄的某个技能（`CmdPvpHeroUpSkillReqMsg { heroId, skillId }`）。
     *
     * 与 `upgradeHero` 同口径：消耗由服务端按表扣，客户端算材料只决定按钮能否点。
     * 响应只回一条 `CmdPvpHeroInfo` —— 技能等级从响应里的那一条取（不猜 `skillId + 1`，
     * 服务端可能因条件不满级/连升），再整份写回缓存。
     */
    async upgradeHeroSkill(heroId: number, skillId: number, caller?: object): Promise<UpgradeHeroSkillResult> {
        const net = GameNet.instance;
        if (!net.isConnected) return { kind: 'offline' };
        if (!Number.isSafeInteger(heroId) || heroId <= 0) return { kind: 'failed' };
        if (!Number.isSafeInteger(skillId) || skillId <= 0) return { kind: 'failed' };
        let response: CmdPvpHeroUpSkillRspMsg | null = null;
        try {
            const ok = await net.send(
                new RequestPvpHeroUpSkill({ heroId, skillId }, caller, (rsp) => { response = rsp; }),
                false,
            );
            if (!ok || !response) return { kind: 'failed' };
        } catch (error) {
            console.warn('[CardRepository] 技能升级请求失败', error);
            return { kind: 'failed' };
        }
        const info = (response as CmdPvpHeroUpSkillRspMsg).info;
        const normalized = normalizePvpHeroInfos([info]);
        const resolvedHeroId = Number(info?.heroId ?? heroId);
        const skills = normalized.length > 0 ? normalized[0].skills : [];
        const level = skills.find((skill) => skill.skillId === skillId)?.level;
        if (!Number.isSafeInteger(resolvedHeroId) || resolvedHeroId <= 0
            || level === undefined) return { kind: 'failed' };
        const heroLevel = Number(info.level);
        // 等级一并写回：服务端升技能时可能同时把英雄等级带上来，缓存里那份不能留旧的。
        if (Number.isSafeInteger(heroLevel) && heroLevel >= 0) {
            this.applyHeroLevel(resolvedHeroId, heroLevel, skills);
        } else {
            applyPvpHeroSkillLevel(resolvedHeroId, skillId, level);
        }
        return { kind: 'success', heroId: resolvedHeroId, skillId, level, skills };
    }

    /** 把服务端确认的英雄等级（可选带技能表快照）写回本地列表缓存。 */
    applyHeroLevel(heroId: number, level: number, skills?: readonly PvpHeroSkillLevel[]): void {
        applyPvpHeroLevel(heroId, level, skills);
    }

    saveFormation(formationId: number, heroIds: readonly number[], caller?: object): Promise<FormationSaveResult> {
        return saveFormation(formationId, heroIds, caller);
    }

    selectFormation(formationId: number, caller?: object): Promise<boolean> {
        return selectFormation(formationId, caller);
    }

    private levels(infos: readonly PvpHeroInfo[] | null): ReadonlyMap<string, number> {
        return new Map((infos ?? []).map((info) => [String(info.heroId), info.level]));
    }
}

export const cardRepository: ICardRepository = new RuntimeCardRepository();
