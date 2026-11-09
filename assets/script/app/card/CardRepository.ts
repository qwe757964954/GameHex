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
import type { CardDetailPresentation } from './CardDetailPresenter';
import { fetchFormations, FORMATION_PREFETCH_FRESH_MS, saveFormation, selectFormation } from './FormationService';
import type { FormationSaveResult, ZCFormation } from './FormationService';
import { readLineupSnapshot, writeLineupSnapshot } from './LineupSnapshot';
import { createItemCounter } from './ItemBag';
import { resolveSelectedDeck } from './LineupPresets';
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

export interface CardLineupData {
    /** 当前上阵卡攻击力合计；快照或权威数据未就绪时不提供。 */
    readonly power?: number;
    readonly art: ICardArtConfig;
    readonly deck: readonly ZCDeckCard[];
    readonly catalog: readonly ZCDeckCard[];
    readonly heroLevels: ReadonlyMap<string, number>;
    readonly heroLevelCaps: ReadonlyMap<string, number>;
    readonly heroListKnown: boolean;
    /**
     * 服务端阵型这次到底拿到了没有。
     *
     * `false` = 这次没拿到服务端阵型（未连接 / 超时），`deck` 是空数组（上阵区留空等数据）。
     */
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
     * 后端阵型（`CmdFormationInfoReqMsg` 的响应）。
     * `null` = 没有可用的后端数据（未连接 / 请求失败）→ 面板退回本地卡组；
     * 空数组是服务端明确回「一个阵型都没有」。
     */
    readonly formations: readonly ZCFormation[] | null;
}

/** 技能面板一次取数要的东西：卡表里的技能顺序 + 技能表 + 该英雄的技能等级。 */
export interface CardSkillListData {
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
    loadLineup(autoLoadDecks: boolean): Promise<CardLineupData>;
    /**
     * 首帧用的**本地阵容快照**（同步，命中才有值）。
     *
     * 有它就等于「上次服务端确认过的阵容」：页面第一帧直接画出来，网络回来再覆盖。
     * 没有（首次安装 / 过期 / 存坏）返回 `null`，页面走空台直到权威数据到达。
     * 见 `LineupSnapshot.ts` 文件头。
     */
    loadLineupSnapshot(): CardLineupData | null;
    loadBoard(autoLoadDecks: boolean): Promise<LineupBoardData>;
    /** 详情切卡使用完整卡库；首帧阵容快照不包含卡库。 */
    loadDetailNavigation(): Promise<CardDetailNavigationData>;
    loadUpgradeStatus(cardId: string, level: number): Promise<ZCUpgradeStatus>;
    /** 详情页取数（六维属性 + 技能链 + 里程碑）；失败由调用方按 `null` 降级。英雄等级内部取后端缓存。 */
    loadCardDetail(cardId: string, level: number): Promise<CardDetailPresentation>;
    /**
     * 阵容战力 = 上阵卡攻击力之和（本地算，不发协议）。
     *
     * 口径见 `CardLineupPower`；返回 0 表示「阵容还没拿到」或「阵容里全是建筑卡」，
     * 调用方据此决定要不要保留占位文案。
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
     * 把服务端的「出战阵型」指向某一条（`CmdFormationSelectReqMsg`），**不动卡组**。
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
     * `cardLevelUp` 的建表结果（卡库一次要 36 张卡的进度，每张都建一遍表就是 36 次全表解析）。
     *
     * 实测（2026-11-03，`tmp/_bench_cardlevelup.mjs`）：表 1785 行，建一次 0.12ms，
     * 一张卡建一次 → 整页 12.03ms；复用一张表 0.40ms。
     *
     * 按 `rows` **引用**判定命中：`RefUtil` 返回的是同一份冻结数组，会话语义内不会换对象；
     * 真换了就重建，不需要额外的失效通知（`evaluateUpgrade` 只读表，缓存不持有可变状态）。
     */
    private levelUpTable: { readonly rows: readonly unknown[]; readonly table: ZCCardLevelUpTable } | null = null;

    /**
     * 卡牌阵容页的取数。
     *
     *  本页显示的是**当前出阵的那套阵容**，所以八卡优先用服务端「选中阵型」的 `heroIds`
     * （`LineupPresets.resolveSelectedDeck`）—— 布阵面板保存时会把该阵型置为选中
     * （`FormationService` 的 `select = 1`），于是「保存 → 本页重刷」就能看到刚改的阵容。
     *
     *  拿不到阵型数据（未连接 / 请求失败 / 没有选中阵型）才退回本地卡表的「玩家默认」八卡，
     *  保证断网与编辑器预览也有一屏内容。
     *  **阵型为空数组是有效值**（玩家把选中的阵型一键下阵后保存了），不能当成"没数据"退回本地。
     *
     *  映射源用 `catalog`（pvpCard 全表）而不只是 `deck`：阵型里的英雄可能不在本地八卡里。
     */
    async loadLineup(autoLoadDecks: boolean): Promise<CardLineupData> {
        // 与 `loadBoard` 同口径：缓存命中就不再发英雄列表请求。
        // 刚升级成功时 `applyPvpHeroLevel` 已经把新等级写进缓存，布阵保存不影响等级，
        // 所以重刷本页不需要重新拉一次权威列表。
        const cached = getCachedPvpHeroInfos();
        const [tableDeck, heroInfos, heroLevelCaps, catalog, formations, art] = await Promise.all([
            autoLoadDecks ? ensureLineupDecks() : Promise.resolve(getPlayerDeck()),
            cached === null ? fetchPvpHeroInfos() : Promise.resolve(cached),
            loadPvpHeroLevelCaps(),
            loadPvpCatalogCards(),
            // 与布阵面板同口径等满 3000ms：没拿到就留空台（见下方 `deck`），不拿兜底卡组先顶上。
            //  `maxAgeMs`：切 tab 时 `MainTabsComposition.prefetchHero` 已经预取过一次，
            //  几百毫秒内的这份就是它拉回来的 —— 再发一遍是纯重复请求（首屏白等一个 RTT）。
            fetchFormations({ label: '阵容页首屏阵型', maxAgeMs: FORMATION_PREFETCH_FRESH_MS }),
            this.loadArtConfig(),
        ]);
        const heroLevels = this.levels(heroInfos);
        const selectedDeck = resolveSelectedDeck({ deck: tableDeck, pool: catalog, formations });
        //  只给**服务端确认过的选中阵型**写快照 —— 本地卡表那张「玩家默认」八卡不是玩家的阵容，
        // 写进去就是把假数据持久化，下次首帧会理直气壮地画错。
        if (selectedDeck) writeLineupSnapshot(selectedDeck, heroLevels);
        //  阵型没拿到（未连接 / 超时）→ 上阵区**留空**，等真数据回来再画；
        //  拿到但里面没有选中阵型 → 用本地卡表的「玩家默认」八卡。
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
     * 首帧快照：只有上阵八卡与等级，**卡库留空**。
     *
     * 卡库（`CardGrid`）的全表卡面一次要加载 36 张图 + 36 份升级进度，让它跟着快照一起
     * 抢首帧既慢又没必要 —— 快照的职责只是「别让玩家看到一个假的阵容」。
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
            // 快照来自服务端确认过的数据，等级是已知的（未出现在 `levels` 里的按 0 处理，
            // 与在线路径「后端列表里没有 = 没拥有」同一口径）。
            heroListKnown: true,
            formationsKnown: true,
            bonuses: currentDeckBonuses(snapshot.cards),
        };
    }

    async loadDetailNavigation(): Promise<CardDetailNavigationData> {
        const catalog = await loadPvpCatalogCards();
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
        //  卡池为空是"面板看起来没内容"的头号原因，而它有两种完全不同的成因，日志必须能一眼分开。
        // 后端英雄在 pvpCard 里对不上号时 `loadPvpHeroCards` 会另出一条列 id 的告警，配合看。
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
     * 详情页取数。
     *
     * 三份数据并行：pvpCard 原始行（属性基础值）、pvpUnitGrowth（成长）、
     * armySkillLevelUp（技能链与里程碑）；英雄等级取后端缓存（没有 = 0，全锁）。
     * 组装在 `CardDetailPresenter`（纯函数、可单测），这里只取数与编排。
     */
    async loadCardDetail(cardId: string, level: number): Promise<CardDetailPresentation> {
        const [rawRow, growthRaw, skillRaw, cards, levelUpRaw] = await Promise.all([
            loadPvpCardRawRow(cardId),
            loadPvpUnitGrowthRows(),
            loadArmySkillLevelUpRows(),
            loadPvpCatalogCards(),
            loadCardLevelUpRows(),
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
            chain: buildDetailChain(table, skillIds, heroLevel),
            milestones: buildDetailMilestones(table, skillIds, heroLevel),
        };
    }

    /**
     * 阵容战力 = 上阵卡攻击力之和（**本地算、不发协议**，山猫 2026-11-06）。
     *
     * 与 `loadCardDetail` 共用同一批取数与同一个纯函数（`CardLineupPower`），
     * 保证「主界面战力」和「卡牌详情里的攻击」不会各算一套。
     *
     * 三份表一次读全：`pvpCard`（基础值，按 id 建索引）、`pvpUnitGrowth`（成长）、
     * `cardLevelUp`（等级绝对属性）。逐张卡 `loadPvpCardRawRow` 会读 8 遍整表，所以走批量版。
     *
     * ⚠️ 不能让这里抛错：主界面 HUD 刷新失败不该把整个玩家信息块拖垮。
     * 读表异常 ⇒ 打 warn 返回 0，HUD 保留 prefab 上的占位文案。
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

    /**
     * 技能面板取数。
     *
     * 三份数据各有各的权威源：
     *   - **有哪些技能、什么顺序** ← `pvpCard.skillList`（卡表，缺省时退回 `armySkillLevelUp` 里该英雄的行）；
     *   - **技能名 / 每档解锁等级 / 每档描述** ← `armySkillLevelUp`；
     *   - **已升到第几档** ← 后端 `CmdPvpHeroInfo.skills`（缓存）。**不猜 `level + 1`** ——
     *     服务端可能因条件不满足只升半档，猜出来的数字点两下就跟服务端对不上。
     *
     * 技能等级一律从 `PvpHeroService` 的缓存读：技能升级响应回来后
     * `upgradeHeroSkill` 已经把新值写回缓存，所以「收到响应 → 重刷」天然拿到最新值，
     * 不需要再发一次英雄列表请求。
     */
    async loadSkillList(heroId: number): Promise<CardSkillListData> {
        const table = buildArmySkillTable(await loadArmySkillLevelUpRows());
        const info = getCachedPvpHeroInfo(heroId);
        const fallbackIds = Array.from(table.keys());
        return {
            skillIds: await this.skillIdsOf(heroId, fallbackIds),
            table,
            levels: info?.skills ?? [],
            heroLevel: info?.level ?? 0,
        };
    }

    /**
     * 卡表里这张卡的技能顺序。
     *
     * 卡表那一行存在但 `skillList` 为空，是策划**明确不给技能**（主城、金矿），返回空数组、不兜底；
     * 卡表里根本找不到这张卡（表缺失 / id 对不上）才退回 `fallbackIds`（技能表全部技能）——
     * 宁可多列几行也别让面板空着。
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
        // 不在这里写缓存：Presenter 升完会调 applyHeroLevel，而它**不传** skills ⇒
        // applyPvpHeroLevel 原样保留缓存里的技能等级（否则升个等级就把技能清空）。
        return { kind: 'success', heroId: resolvedHeroId, level };
    }

    /**
     * 升某个英雄的某个技能（`CmdPvpHeroUpSkillReqMsg { heroId, skillId }`）。
     *
     * 与 `upgradeHero` 同口径：消耗由服务端按表扣，客户端算材料只决定按钮能否点。
     * 响应只回一条 `CmdPvpHeroInfo` —— 技能等级从**响应里的那一条**取（不猜 `skillId + 1`，
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
