import type { ZCDeckBonuses, ZCDeckCard } from '../zcds/model/ZCCombatCatalog';
import { getPlayerDeck } from '../zcds/model/ZCCombatCatalog';
import { RequestPvpHeroUpLevel, RequestPvpHeroUpSkill } from '../generated/requestMsg/RequestPvpMsg';
import { GameNet } from '../net/GameNet';
import {
    currentDeckBonuses,
    ensureLineupDecks,
    loadCardLevelUpRows,
    loadPvpCatalogCards,
    loadPvpHeroCards,
    loadPvpHeroLevelCaps,
} from './CardLineupDecks';
import { buildCardLevelUpTable, evaluateUpgrade } from './CardUpgradeCost';
import type { ZCUpgradeStatus } from './CardUpgradeCost';
import { fetchFormations, saveFormation } from './FormationService';
import type { FormationSaveResult, ZCFormation } from './FormationService';
import { createItemCounter } from './ItemBag';
import { resolveSelectedDeck } from './LineupPresets';
import {
    applyPvpHeroLevel,
    applyPvpHeroSkillLevel,
    fetchPvpHeroInfos,
    getCachedPvpHeroInfos,
    normalizePvpHeroInfos,
} from './PvpHeroService';
import type { PvpHeroInfo, PvpHeroSkillLevel } from './PvpHeroService';

export interface CardLineupData {
    readonly deck: readonly ZCDeckCard[];
    readonly catalog: readonly ZCDeckCard[];
    readonly heroLevels: ReadonlyMap<string, number>;
    readonly heroLevelCaps: ReadonlyMap<string, number>;
    readonly heroListKnown: boolean;
    readonly bonuses: ZCDeckBonuses;
}

export interface LineupBoardData {
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
    loadLineup(autoLoadDecks: boolean): Promise<CardLineupData>;
    loadBoard(autoLoadDecks: boolean): Promise<LineupBoardData>;
    loadUpgradeStatus(cardId: string, level: number): Promise<ZCUpgradeStatus>;
    upgradeHero(heroId: number, caller?: unknown): Promise<UpgradeHeroResult>;
    upgradeHeroSkill(heroId: number, skillId: number, caller?: unknown): Promise<UpgradeHeroSkillResult>;
    applyHeroLevel(heroId: number, level: number): void;
    /** 覆盖保存一个阵型；结果里带回服务端确认后的阵型。 */
    saveFormation(formationId: number, heroIds: readonly number[], caller?: unknown): Promise<FormationSaveResult>;
}

/** 生产环境 Repository：统一封装 Ref 表、后端英雄列表、背包与升级请求。 */
export class RuntimeCardRepository implements ICardRepository {
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
        const [tableDeck, heroInfos, heroLevelCaps, catalog, formations] = await Promise.all([
            autoLoadDecks ? ensureLineupDecks() : Promise.resolve(getPlayerDeck()),
            cached === null ? fetchPvpHeroInfos() : Promise.resolve(cached),
            loadPvpHeroLevelCaps(),
            loadPvpCatalogCards(),
            fetchFormations(),
        ]);
        const deck = resolveSelectedDeck({ deck: tableDeck, pool: catalog, formations }) ?? tableDeck;
        return {
            deck,
            catalog,
            heroLevels: this.levels(heroInfos),
            heroLevelCaps,
            heroListKnown: heroInfos !== null,
            bonuses: currentDeckBonuses(deck),
        };
    }

    async loadBoard(autoLoadDecks: boolean): Promise<LineupBoardData> {
        const cached = getCachedPvpHeroInfos();
        const [deck, heroInfos, heroLevelCaps, formations] = await Promise.all([
            autoLoadDecks ? ensureLineupDecks() : Promise.resolve(getPlayerDeck()),
            cached === null ? fetchPvpHeroInfos() : Promise.resolve(cached),
            loadPvpHeroLevelCaps(),
            fetchFormations(),
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
        return { deck, pool, heroLevels: this.levels(heroInfos), heroLevelCaps, formations };
    }

    async loadUpgradeStatus(cardId: string, level: number): Promise<ZCUpgradeStatus> {
        const rows = await loadCardLevelUpRows();
        return evaluateUpgrade(buildCardLevelUpTable(rows), cardId, level, createItemCounter());
    }

    async upgradeHero(heroId: number, caller?: unknown): Promise<UpgradeHeroResult> {
        const net = GameNet.instance;
        if (!net.isConnected) return { kind: 'offline' };
        let response: CmdPvpHeroUpLevelRspMsg | null = null;
        try {
            const ok = await net.send(
                new RequestPvpHeroUpLevel({ heroId }, caller as any, (rsp) => { response = rsp; }),
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
    async upgradeHeroSkill(heroId: number, skillId: number, caller?: unknown): Promise<UpgradeHeroSkillResult> {
        const net = GameNet.instance;
        if (!net.isConnected) return { kind: 'offline' };
        if (!Number.isSafeInteger(heroId) || heroId <= 0) return { kind: 'failed' };
        if (!Number.isSafeInteger(skillId) || skillId <= 0) return { kind: 'failed' };
        let response: CmdPvpHeroUpSkillRspMsg | null = null;
        try {
            const ok = await net.send(
                new RequestPvpHeroUpSkill({ heroId, skillId }, caller as any, (rsp) => { response = rsp; }),
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

    saveFormation(formationId: number, heroIds: readonly number[], caller?: unknown): Promise<FormationSaveResult> {
        return saveFormation(formationId, heroIds, caller);
    }

    private levels(infos: readonly PvpHeroInfo[] | null): ReadonlyMap<string, number> {
        return new Map((infos ?? []).map((info) => [String(info.heroId), info.level]));
    }
}

export const cardRepository: ICardRepository = new RuntimeCardRepository();
