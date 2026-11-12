import { battleBuffRatio } from '../../battle/BattleStartModel';
import type { ZCBattleHero, ZCBattleStart, ZCBattleUnit } from '../../battle/BattleStartModel';
import type { ZCDeckCard } from '../model/ZCCombatCatalog';
import { ZCOwner, ZCPlayerCount, type ZCSection } from '../model/ZCMapConfig';
import { getZCNeutralResourceCatalog } from '../model/ZCNeutralResourceGroup';
import { ownersForPlayerCount } from '../model/ZCMapConfig';
import { captureZCMatchConfig, type ZCMatchConfig, type IZCBattleRates } from '../model/ZCMatchConfig';
import type { ZCCompiledModifierLoadout } from '../model/ZCModifierRuntime';
import { compileZCCombatBuild, getZCModifierCatalogs, selectZCSkillPlans, type ZCModifierCatalogs } from '../model/ZCModifierRuntime';

export interface ZCClientCombatConfigResult {
    readonly config: ZCMatchConfig;
    readonly skipped: readonly { owner: ZCOwner; generalId: number; reason: string }[];
}

export interface ZCClientCombatConfigOptions {
    /** 仅供 ZCGame 的开局选点阶段使用；正式建模前仍必须解析成 fixed。 */
    readonly allowUnresolvedSelect?: boolean;
}

const ZC_MAX_BATTLE_HERO_CARDS = 8;

/** 服务端 buff 的乘数键；仅作用于对应阵营成长后的单位属性。 */
export const ZC_BATTLE_RATE_KEYS = {
    /** 攻击倍率。 */
    attack: 'levelAttackRatio',
    /** 生命倍率。 */
    hp: 'levelHpRatio',
} as const;

/** 将服务端字段投影为阵营倍率，不读取本地关卡配置，也不补缺失字段。 */
export function ownerRatesOf(unit: ZCBattleUnit | undefined): IZCBattleRates | undefined {
    if (!unit) return undefined;
    const hp = battleBuffRatio(unit.buffs, ZC_BATTLE_RATE_KEYS.hp);
    const attack = battleBuffRatio(unit.buffs, ZC_BATTLE_RATE_KEYS.attack);
    if (hp === null && attack === null) return undefined;
    if (hp !== null && (!Number.isFinite(hp) || hp <= 0)) {
        throw new Error(`服务端生命倍率无效：${hp}`);
    }
    if (attack !== null && (!Number.isFinite(attack) || attack < 0)) {
        throw new Error(`服务端攻击倍率无效：${attack}`);
    }
    return {
        ...(hp === null ? {} : { hpRate: hp }),
        ...(attack === null ? {} : { attackRate: attack }),
    };
}

function battleUnitsByOwner(
    playerCount: ZCPlayerCount,
    battle: ZCBattleStart | null | undefined,
    selfRoleId?: string,
): Readonly<Partial<Record<ZCOwner, ZCBattleUnit>>> {
    const owners = ownersForPlayerCount(playerCount);
    const units = [...(battle?.units ?? [])].sort((left, right) => left.campId - right.campId);
    const self = (selfRoleId
        ? units.find((unit) => unit.roleId !== '' && unit.roleId === selfRoleId)
        : undefined) ?? units[0];
    const opponents = units.filter((unit) => unit !== self);
    const result: Partial<Record<ZCOwner, ZCBattleUnit>> = {};
    if (self) result.player = self;
    for (let index = 1; index < owners.length; index += 1) {
        const unit = opponents[index - 1];
        if (unit) result[owners[index]] = unit;
    }
    return result;
}

/** homes 下标是地图席位，unitId 才是参战身份；同时转换分区，保证玩家视角与出生点一致。 */
function battleMapOf(config: ZCMatchConfig, battle: ZCBattleStart | null | undefined, selfRoleId?: string): ZCMatchConfig['map'] {
    const info = battle?.mapInfo;
    const map = config.map;
    if (!info) return map;
    if (map.id !== info.id) throw new Error(`后端地图与已加载地图不一致：${info.id} / ${map.id}`);
    const owners = ownersForPlayerCount(map.playerCount ?? 2);
    const units = battleUnitsByOwner(map.playerCount ?? 2, battle, selfRoleId);
    const assignments = info.unitHomeIndexes ?? [];
    const needsSelection = map.cityMode === 'select' && assignments.length === 0;
    if (battle.units.length !== owners.length
        || new Set(battle.units.map(unit => unit.unitId)).size !== owners.length
        || !needsSelection && (assignments.length !== owners.length
            || new Set(assignments.map(home => home.unitId)).size !== owners.length
            || new Set(assignments.map(home => home.homeIndex)).size !== owners.length)) {
        throw new Error('后端出生点必须完整且一一对应参战单元');
    }
    const indexes = needsSelection ? owners.map((_, index) => index) : owners.map(owner => {
        const home = assignments.find(entry => entry.unitId === units[owner]?.unitId);
        if (!home || !Number.isInteger(home.homeIndex) || home.homeIndex < 0 || home.homeIndex >= owners.length) {
            throw new Error(`后端出生点缺失或越界：${owner}`);
        }
        return home.homeIndex;
    });
    const homes = needsSelection ? map.homes ?? [] : indexes.map(index => map.homes?.[index]);
    if (!needsSelection && (new Set(homes).size !== owners.length || homes.some(id => !Number.isInteger(id) || !map.hexes[id]?.playable))) {
        throw new Error('后端出生点引用了无效主城格');
    }
    const sectionOf = (section: number): ZCSection => section === 0 ? 0 : (indexes.indexOf(section - 1) + 1) as ZCSection;
    const sections = map.sections?.map(sectionOf);
    const regions = map.regions?.map(region => ({ ...region, section: sectionOf(region.section) }));
    const occupied = new Set<number>();
    const resourcePoints = (info.resourcePoints ?? []).map(point => {
        const hexId = point.row * map.columns + point.column;
        if (!Number.isInteger(point.row) || point.row < 0 || point.row >= map.rows
            || !Number.isInteger(point.column) || point.column < 0 || point.column >= map.columns
            || !map.hexes[hexId]?.playable || !needsSelection && homes.includes(hexId) || occupied.has(hexId)) {
            throw new Error(`后端资源点位置无效：${point.row},${point.column}`);
        }
        const item = getZCNeutralResourceCatalog().items.get(point.resourceId);
        if (!item || item.groupId !== point.groupId) throw new Error(`后端资源点配置不匹配：${point.groupId}/${point.resourceId}`);
        occupied.add(hexId);
        return { row: point.row, column: point.column, groupId: point.groupId, section: sections?.[hexId] ?? 0 };
    });
    return {
        ...map, id: info.id, name: info.name, version: info.version, cityMode: needsSelection ? 'select' : 'fixed',
        homes, playerHomeId: needsSelection ? map.playerHomeId : homes[0],
        enemyHomeId: needsSelection ? map.enemyHomeId : homes[1], sections, regions,
        owners: map.owners.map(owner => owner === 'neutral' ? owner : owners[indexes.indexOf(owners.indexOf(owner))]),
        homeCandidates: map.homeCandidates?.map(region => ({ ...region, section: sectionOf(region.section) })),
        resourcePoints,
        resolvedResources: (info.resourcePoints ?? []).map((point, index) => {
            const hexId = point.row * map.columns + point.column;
            const depth = regions?.find(region => region.cells.includes(hexId))?.depth;
            return { hexId, section: resourcePoints[index].section, itemId: point.resourceId,
                ...(depth === undefined ? {} : { depth }) };
        }),
    };
}

/** 后端英雄阵容只替换英雄卡；无 unitId 的金矿、塔等系统卡始终由本地表保留。 */
function buildBattleDeck(
    source: readonly ZCDeckCard[],
    heroes: readonly ZCBattleHero[],
    unit: ZCBattleUnit | undefined,
): readonly ZCDeckCard[] {
    const systemCards = source.filter((card) => card.unitId === undefined);
    const heroCardsById = new Map<string, ZCDeckCard>();
    for (const card of source) {
        if (card.unitId !== undefined) heroCardsById.set(card.unitId, card);
    }
    const selected: ZCDeckCard[] = [];
    const seen = new Set<number>();
    for (const hero of heroes) {
        if (seen.has(hero.heroId)) continue;
        seen.add(hero.heroId);
        if (seen.size > ZC_MAX_BATTLE_HERO_CARDS) break;
        const card = heroCardsById.get(String(hero.heroId));
        if (card) {
            const buildingHp = unit?.heroAttrs?.find((entry) => entry.heroId === hero.heroId)?.attributes.buildingHp;
            selected.push(buildingHp === undefined ? card : { ...card, baseHp: buildingHp });
        }
    }
    return [...selected, ...systemCards];
}

function uniqueHeroIds(values: readonly number[]): number[] {
    return Array.from(new Set(values.filter((value) => Number.isSafeInteger(value) && value > 0)));
}

function limitBattleHeroes(values: readonly ZCBattleHero[]): readonly ZCBattleHero[] {
    const result: ZCBattleHero[] = [];
    const seen = new Set<number>();
    for (const hero of values) {
        if (!Number.isSafeInteger(hero.heroId) || hero.heroId <= 0 || seen.has(hero.heroId)) continue;
        seen.add(hero.heroId);
        result.push(hero);
        if (result.length >= ZC_MAX_BATTLE_HERO_CARDS) break;
    }
    return result;
}

interface IZCClientBattleRosterContext {
    readonly owners: readonly ZCOwner[];
    readonly unitsByOwner: Readonly<Partial<Record<ZCOwner, ZCBattleUnit>>>;
    readonly usesServerRoster: boolean;
}

function buildClientBattleRosterContext(
    config: ZCMatchConfig,
    battle: ZCBattleStart | null | undefined,
    selfRoleId?: string,
): IZCClientBattleRosterContext {
    const playerCount = config.map.playerCount ?? 2;
    return {
        owners: ownersForPlayerCount(playerCount),
        unitsByOwner: battleUnitsByOwner(playerCount, battle, selfRoleId),
        usesServerRoster: battle != null,
    };
}

function mapClientRosterOwners<T>(
    context: IZCClientBattleRosterContext,
    resolve: (owner: ZCOwner, unit: ZCBattleUnit | undefined) => T,
): Readonly<Partial<Record<ZCOwner, T>>> {
    const result: Partial<Record<ZCOwner, T>> = {};
    for (const owner of context.owners) result[owner] = resolve(owner, context.unitsByOwner[owner]);
    return result;
}

function clientHeroesForOwner(
    config: ZCMatchConfig,
    owner: ZCOwner,
    unit: ZCBattleUnit | undefined,
    usesServerRoster: boolean,
): readonly ZCBattleHero[] {
    // 已有服务端席位时，空 heroInfos 也是权威阵容，不能补成本地默认英雄。
    if (unit) return limitBattleHeroes(unit.heroes ?? unit.heroIds.map((heroId) => ({ heroId, level: 1 })));
    return usesServerRoster ? [] : defaultHeroes(config, owner);
}

function clientHeroIdsForOwner(
    config: ZCMatchConfig,
    owner: ZCOwner,
    unit: ZCBattleUnit | undefined,
    usesServerRoster: boolean,
): readonly number[] {
    return clientHeroesForOwner(config, owner, unit, usesServerRoster).map((hero) => hero.heroId);
}

function defaultHeroIds(config: ZCMatchConfig, owner: ZCOwner): number[] {
    const deck = config.ownerDecks?.[owner] ?? (owner === ZCOwner.Player ? config.playerDeck : config.enemyDeck);
    return uniqueHeroIds(deck
        .map((card) => Number(card.unitId))
        .filter((unitId) => Number.isSafeInteger(unitId) && unitId > 0));
}

function defaultHeroes(config: ZCMatchConfig, owner: ZCOwner): ZCBattleHero[] {
    return defaultHeroIds(config, owner).map((heroId) => ({ heroId, level: 1 }));
}

/**
 * 将开始战斗回包中的多方单元映射到本地四个 owner。玩家优先按 roleId 识别；
 * 未命中时退回 campId 最小者。只有无服务端对局的本地模式使用默认卡组，空阵容与缺席位均不补英雄。
 */
export function clientHeroIdsByOwner(
    config: ZCMatchConfig,
    battle: ZCBattleStart | null | undefined,
    selfRoleId?: string,
): Readonly<Partial<Record<ZCOwner, readonly number[]>>> {
    const context = buildClientBattleRosterContext(config, battle, selfRoleId);
    return mapClientRosterOwners(context, (owner, unit) => clientHeroIdsForOwner(config, owner, unit, context.usesServerRoster));
}

/**
 * 卡牌等级 → 成长表选取项。
 *
 * `pvpUnitGrowth` 从 1 级起（1 级 flat 全 0，数值等于卡牌基础值），而卡牌等级从 0 起，
 * 所以 0 级按 1 级取 —— 保住「已解锁未升级」这一档，取到的仍是基础值。
 *
 * 表里没有该等级（这类卡还没配成长）时**不传 level**：退回只吃技能档位与星级，
 * 行为与引入等级成长之前完全一致。这里必须判空，不能交给 `compileGrowthLoadout`
 * 抛错 —— 那里的异常会被上层记成 skipped，把这只武将的技能和星级一起丢掉。
 */
function growthSelectionOf(
    catalogs: ZCModifierCatalogs,
    generalId: number,
    level: number,
): { level?: number } {
    const lv = Math.max(1, Math.floor(Number(level) || 1));
    const row = catalogs.adapters.growth.get(`${generalId}:${lv}`);
    return row?.enabled ? { level: lv } : {};
}

function compileOwnerLoadouts(
    owner: ZCOwner,
    heroes: readonly ZCBattleHero[],
    config: ZCMatchConfig,
    skipped: Array<{ owner: ZCOwner; generalId: number; reason: string }>,
    unit: ZCBattleUnit | undefined,
): readonly ZCCompiledModifierLoadout[] {
    const catalogs = getZCModifierCatalogs();
    const loadouts: ZCCompiledModifierLoadout[] = [];
    for (const hero of heroes) {
        const generalId = hero.heroId;
        //  星级不再进构筑（上游口径：星级表弃用）。`hasGeneral` 现在**只当「这张卡是不是老卡」的
        //  兜底判据**用，不再往构筑里塞 `generalStar` —— 老卡的数值已经整体挪到成长表里。
        const hasGeneral = catalogs.generalStars.has(`${generalId}:1`);
        const serverAttributes = unit?.heroAttrs?.find((entry) => entry.heroId === generalId)?.attributes;
        //  技能计划与星级是**两件事**（2026-11-10）：`pvpSkillPlan.unlockHeroLevel` 比的是
        //  「兵种等级」（= `hero.level`），与 `generalStar` 有没有行完全无关。
        //  原来 `heroLevel` 只写在 `hasGeneral` 分支里 ⇒ 没有星级行的卡（68015~68035 这一批
        //  新卡，含 68025 大威天芦）**整份技能计划都编不出来**：`skillRuntime` 里没有
        //  `68025:30858`，`self_aura` 的 `auraCooldown` 无从读到，战场上既不放下光环、
        //  也不报任何错 —— 表现就是「技能一个都不放」。
        //  同一个坑还有一半：`!hasGeneral && !serverAttributes` 直接 `continue`，
        //  连成长和技能一起丢掉，所以这类卡连属性成长都不会生效。
        const skillPlanLevel = hero.level;
        const hasSkillPlan = selectZCSkillPlans(String(generalId), skillPlanLevel, catalogs).length > 0;
        if (!hasGeneral && !serverAttributes && !hasSkillPlan) continue;
        try {
            loadouts.push(...compileZCCombatBuild({
                unitId: String(generalId),
                ...growthSelectionOf(catalogs, generalId, hero.level),
                //  ⚠️ 必须无条件传：`compileZCCombatBuild` 只在 `heroLevel != null` 时才去编技能计划。
                heroLevel: skillPlanLevel,
                //  ⚠️ 星级表（`generalStar`）2026-11-10 起**弃用且不再参与构筑**：
                //  上游已经明确「星级表弃用、技能数值只用修改器表」，所以这里不再传
                //  `generalStar`（原来传 `star: 1` 只是让老卡白吃一条星级加成）。
                //  老卡因此少掉的那部分固定攻击，已经折算进 `pvpUnitGrowth.attackFlat`
                //  （按品质分档：1→45 / 2→55 / 3→65 / 4→75），
                //  见 `tools/config/patch_general_star_removal_growth.js`。
                serverAttributes,
            }, config.units, catalogs));
        } catch (error) {
            skipped.push({
                owner,
                generalId,
                reason: error instanceof Error ? error.message : String(error),
            });
        }
    }
    return loadouts;
}

/**
 * 正式客户端开局构筑入口。后端阵容收敛为本局英雄卡池并编译修改器，系统卡继续来自
 * client/remoteRef；尚未完成行为移植的武将会被显式记录为 skipped，不会拖垮整局战斗。
 */
export function buildZCClientCombatConfig(
    source: ZCMatchConfig,
    battle: ZCBattleStart | null | undefined,
    selfRoleId?: string,
    options?: ZCClientCombatConfigOptions,
): ZCClientCombatConfigResult {
    const config = captureZCMatchConfig(source, options);
    const rosterContext = buildClientBattleRosterContext(config, battle, selfRoleId);
    const roster = mapClientRosterOwners(
        rosterContext,
        (owner, unit) => clientHeroesForOwner(config, owner, unit, rosterContext.usesServerRoster),
    );
    const owners = rosterContext.owners;
    const skipped: Array<{ owner: ZCOwner; generalId: number; reason: string }> = [];
    const modifiers: Partial<Record<ZCOwner, readonly ZCCompiledModifierLoadout[]>> = {};
    for (const owner of owners) {
        modifiers[owner] = compileOwnerLoadouts(owner, roster[owner] ?? [], config, skipped, rosterContext.unitsByOwner[owner]);
    }
    const ownerDecks: Partial<Record<ZCOwner, readonly ZCDeckCard[]>> = {};
    for (const owner of owners) {
        const sourceDeck = config.ownerDecks?.[owner] ?? (owner === ZCOwner.Player ? config.playerDeck : config.enemyDeck);
        ownerDecks[owner] = rosterContext.usesServerRoster
            ? buildBattleDeck(sourceDeck, roster[owner] ?? [], rosterContext.unitsByOwner[owner])
            : sourceDeck;
    }
    const ownerRates = mapClientRosterOwners(rosterContext, (_owner, unit) => ownerRatesOf(unit));
    const playerDeck = ownerDecks.player ?? config.playerDeck;
    const enemyDeck = ownerDecks.enemy ?? config.enemyDeck;
    return {
        config: captureZCMatchConfig({ ...config, map: battleMapOf(config, battle, selfRoleId), playerDeck, enemyDeck, ownerDecks, modifiers, ownerRates }, options),
        skipped,
    };
}
