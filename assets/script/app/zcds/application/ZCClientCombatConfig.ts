import type { ZCBattleHero, ZCBattleStart, ZCBattleUnit } from '../../battle/BattleStartModel';
import type { ZCDeckCard } from '../model/ZCCombatCatalog';
import { ZCOwner, ZCPlayerCount } from '../model/ZCMapConfig';
import { ownersForPlayerCount } from '../model/ZCMapConfig';
import { captureZCMatchConfig, type ZCMatchConfig } from '../model/ZCMatchConfig';
import type { ZCCompiledModifierLoadout } from '../model/ZCModifierRuntime';
import { compileZCCombatBuild, getZCModifierCatalogs } from '../model/ZCModifierRuntime';

export interface ZCClientCombatConfigResult {
    readonly config: ZCMatchConfig;
    readonly skipped: readonly { owner: ZCOwner; generalId: number; reason: string }[];
}

export interface ZCClientCombatConfigOptions {
    /** 仅供 ZCGame 的开局选点阶段使用；正式建模前仍必须解析成 fixed。 */
    readonly allowUnresolvedSelect?: boolean;
}

const ZC_MAX_BATTLE_HERO_CARDS = 8;

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

/** 后端英雄阵容只替换英雄卡；无 unitId 的金矿、塔等系统卡始终由本地表保留。 */
function buildBattleDeck(
    source: readonly ZCDeckCard[],
    heroes: readonly ZCBattleHero[],
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
        if (card) selected.push(card);
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

function hasRemoteHeroes(unit: ZCBattleUnit | undefined): boolean {
    return (unit?.heroes?.length ?? 0) > 0 || (unit?.heroIds.length ?? 0) > 0;
}

interface IZCClientBattleRosterContext {
    readonly owners: readonly ZCOwner[];
    readonly unitsByOwner: Readonly<Partial<Record<ZCOwner, ZCBattleUnit>>>;
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
): readonly ZCBattleHero[] {
    if (unit?.heroes?.length) return limitBattleHeroes(unit.heroes);
    if (unit?.heroIds.length) return limitBattleHeroes(unit.heroIds.map((heroId) => ({ heroId, level: 1 })));
    return defaultHeroes(config, owner);
}

function clientHeroIdsForOwner(
    config: ZCMatchConfig,
    owner: ZCOwner,
    unit: ZCBattleUnit | undefined,
): readonly number[] {
    return unit?.heroIds.length
        ? uniqueHeroIds(unit.heroIds).slice(0, ZC_MAX_BATTLE_HERO_CARDS)
        : defaultHeroIds(config, owner);
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
 * 未命中时退回 campId 最小者。服务端没有给满 3/4 方时，空席位继续使用本地 PVE 卡组。
 */
export function clientHeroIdsByOwner(
    config: ZCMatchConfig,
    battle: ZCBattleStart | null | undefined,
    selfRoleId?: string,
): Readonly<Partial<Record<ZCOwner, readonly number[]>>> {
    const context = buildClientBattleRosterContext(config, battle, selfRoleId);
    return mapClientRosterOwners(context, (owner, unit) => clientHeroIdsForOwner(config, owner, unit));
}

function compileOwnerLoadouts(
    owner: ZCOwner,
    heroes: readonly ZCBattleHero[],
    config: ZCMatchConfig,
    skipped: Array<{ owner: ZCOwner; generalId: number; reason: string }>,
): readonly ZCCompiledModifierLoadout[] {
    const catalogs = getZCModifierCatalogs();
    const loadouts: ZCCompiledModifierLoadout[] = [];
    for (const hero of heroes) {
        const generalId = hero.heroId;
        // 当前协议只有英雄 id/等级，没有星级字段。本地 PVP 先按一星构筑；后端补星级后只改这里的输入。
        if (!catalogs.generalStars.has(`${generalId}:1`)) continue;
        try {
            loadouts.push(...compileZCCombatBuild({
                unitId: String(generalId),
                heroLevel: hero.level,
                generalStar: { generalId, star: 1 },
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
        (owner, unit) => clientHeroesForOwner(config, owner, unit),
    );
    const battleUnits = rosterContext.unitsByOwner;
    const owners = rosterContext.owners;
    const skipped: Array<{ owner: ZCOwner; generalId: number; reason: string }> = [];
    const modifiers: Partial<Record<ZCOwner, readonly ZCCompiledModifierLoadout[]>> = {};
    for (const owner of owners) {
        modifiers[owner] = compileOwnerLoadouts(owner, roster[owner] ?? [], config, skipped);
    }
    const ownerDecks: Partial<Record<ZCOwner, readonly ZCDeckCard[]>> = {};
    for (const owner of owners) {
        const sourceDeck = config.ownerDecks?.[owner] ?? (owner === ZCOwner.Player ? config.playerDeck : config.enemyDeck);
        ownerDecks[owner] = hasRemoteHeroes(battleUnits[owner])
            ? buildBattleDeck(sourceDeck, roster[owner] ?? [])
            : sourceDeck;
    }
    const playerDeck = ownerDecks.player ?? config.playerDeck;
    const enemyDeck = ownerDecks.enemy ?? config.enemyDeck;
    return {
        config: captureZCMatchConfig({ ...config, playerDeck, enemyDeck, ownerDecks, modifiers }, options),
        skipped,
    };
}
