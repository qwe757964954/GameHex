import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { ZCBattleStart } from '../assets/script/app/battle/BattleStartModel';
import { parseBattleBuffs } from '../assets/script/app/battle/BattleStartModel';
import { compileZCMatchRuntime } from '../assets/script/app/zcds/model/ZCMatchRuntimeCompiler';
import { buildZCClientCombatConfig, clientHeroIdsByOwner } from '../assets/script/app/zcds/application/ZCClientCombatConfig';
import { buildZCPveEnemyDecks } from '../assets/script/app/zcds/application/ZCPveCombatConfig';
import { configureZCMap } from '../assets/script/app/zcds/model/ZCMapConfig';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { captureZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import { assetPath } from './helpers/asset-paths';

function readRows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(
        source.k.map((key, index) => [key, values[index]]),
    ));
}

function prepare(playerCount: 3 | 4 = 4) {
    const names = [
        'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
        'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams', 'pvpBaseTeamWeight',
        'skillAttrModifier', 'generalStar', 'pvpAttrMap', 'pvpModifierOverride',
        'pvpUnitGrowth', 'pvpSkillBinding', 'pvpStatus',
    ];
    loadPvpTables(Object.fromEntries(names.map((name) => [name, readRows(name)])) as unknown as ZCPvpTables);
    configureZCMap(JSON.parse(readFileSync(
        assetPath(`config/maps/standard_${playerCount}.json`), 'utf8',
    )));
    return captureZCMatchConfig();
}

function battle(
    playerHeroIds: readonly number[] = [68001],
    enemyHeroIds: readonly number[] = [68001],
    enemy2HeroIds: readonly number[] = [68001],
    enemy3HeroIds: readonly number[] = [68001],
): ZCBattleStart {
    const unit = (campId: number, roleId: string, heroIds: readonly number[]) => ({
        campId, roleId, serverId: 1, name: roleId, power: 1,
        avatarId: '', headFrameId: '', gradeId: 1, gradeScore: 1,
        heroIds, artifactId: 1, artifactLevel: 1,
    });
    return {
        battleId: 'battle', seed: '42', version: 'test',
        units: [
            unit(1, 'enemy-a', enemyHeroIds),
            unit(2, 'self', playerHeroIds),
            unit(3, 'enemy-b', enemy2HeroIds),
            unit(4, 'enemy-c', enemy3HeroIds),
        ],
    };
}

test('四方服务端阵容按本机 roleId 与 campId 映射到 client owner', () => {
    const config = prepare(4);
    const roster = clientHeroIdsByOwner(config, battle(), 'self');
    assert.deepEqual(roster, {
        player: [68001], enemy: [68001], enemy2: [68001], enemy3: [68001],
    });
});

test('正式客户端构筑为四个 owner 分别编译并冻结修改器', () => {
    const result = buildZCClientCombatConfig(prepare(4), battle(), 'self');
    assert.deepEqual(result.skipped, []);
    for (const owner of ['player', 'enemy', 'enemy2', 'enemy3'] as const) {
        const loadouts = result.config.modifiers?.[owner] ?? [];
        assert.equal(loadouts.length, 1, owner);
        assert.equal(loadouts[0].generalId, 68001);
        assert.equal(loadouts[0].star, 1);
        assert.deepEqual(loadouts[0].unsupportedAttributes, []);
    }
    assert.equal(Object.isFrozen(result.config), true);
});

test('正式客户端卡池只采用后端每方最多八张英雄卡，并独立保留系统卡', () => {
    const source = prepare(4);
    const heroIds = source.playerDeck
        .filter((card) => card.unitId !== undefined)
        .map((card) => Number(card.unitId));
    assert.ok(heroIds.length >= 10, '真表需要至少十张英雄卡覆盖八卡截断与敌方独立阵容');
    const playerHeroIds = heroIds.slice(0, 9);
    const enemyHeroIds = heroIds.slice(9, 11);
    const enemy2HeroIds = heroIds.slice(11, 13);
    const enemy3HeroIds = heroIds.slice(13, 15);

    const result = buildZCClientCombatConfig(
        source,
        battle(playerHeroIds, enemyHeroIds, enemy2HeroIds, enemy3HeroIds),
        'self',
    );
    const systemCardIds = source.playerDeck
        .filter((card) => card.unitId === undefined)
        .map((card) => card.id);

    assert.deepEqual(
        result.config.playerDeck.filter((card) => card.unitId === undefined).map((card) => card.id),
        systemCardIds,
    );
    assert.deepEqual(
        result.config.playerDeck.filter((card) => card.unitId !== undefined).map((card) => Number(card.unitId)),
        playerHeroIds.slice(0, 8),
    );
    assert.deepEqual(
        result.config.modifiers?.player?.map((loadout) => loadout.generalId),
        playerHeroIds.slice(0, 8),
    );
    assert.deepEqual(
        result.config.enemyDeck.filter((card) => card.unitId !== undefined).map((card) => Number(card.unitId)),
        enemyHeroIds,
    );
    assert.deepEqual(
        result.config.ownerDecks?.enemy2?.filter((card) => card.unitId !== undefined)
            .map((card) => Number(card.unitId)),
        enemy2HeroIds,
    );
    assert.deepEqual(
        result.config.ownerDecks?.enemy3?.filter((card) => card.unitId !== undefined)
            .map((card) => Number(card.unitId)),
        enemy3HeroIds,
    );
    assert.deepEqual(
        result.config.playerDeck.slice(-systemCardIds.length).map((card) => card.id),
        systemCardIds,
    );
});

test('三人本地模式没有服务端阵容时使用客户端默认卡组且全部构筑可编译', () => {
    const source = prepare(3);
    const result = buildZCClientCombatConfig(source, null);
    assert.deepEqual(result.config.playerDeck, source.playerDeck);
    assert.deepEqual(result.config.enemyDeck, source.enemyDeck);
    assert.ok((result.config.modifiers?.player?.length ?? 0) >= 1);
    assert.ok(result.config.modifiers?.enemy);
    assert.ok(result.config.modifiers?.enemy2);
    assert.equal(result.config.modifiers?.enemy3, undefined);
    assert.deepEqual(result.skipped, []);
    const spear = result.config.modifiers?.player?.find((loadout) => loadout.generalId === 68002);
    assert.ok(spear);
    const spearDamage = spear.typedModifiers.find((modifier) => modifier.legacyKey === '长枪兵武将普攻伤害加成buff用');
    assert.equal(spearDamage?.statId, 'damageRate');
    assert.equal(spearDamage?.value, 2);
});

test('local PVE keeps distinct configured enemy decks for each AI seat', () => {
    const source = prepare(4);
    const heroes = source.enemyDeck.filter((card) => card.unitId !== undefined);
    assert.ok(heroes.length >= 3);
    const ownerDecks = {
        enemy: [heroes[0]],
        enemy2: [heroes[1]],
        enemy3: [heroes[2]],
    };
    const result = buildZCClientCombatConfig({ ...source, ownerDecks }, null);
    for (const owner of ['enemy', 'enemy2', 'enemy3'] as const) {
        assert.deepEqual(result.config.ownerDecks?.[owner]?.map((card) => card.id), ownerDecks[owner].map((card) => card.id));
    }
});

test('territory NPC teams retain separate cards and shared system cards', () => {
    const source = prepare(4);
    const heroes = source.enemyDeck.filter((card) => card.unitId !== undefined);
    const system = source.enemyDeck.filter((card) => card.unitId === undefined).map((card) => card.id);
    const decks = buildZCPveEnemyDecks(source.enemyDeck, [[Number(heroes[0].id)], [Number(heroes[1].id)], [Number(heroes[2].id)]]);
    for (const [index, owner] of (['enemy', 'enemy2', 'enemy3'] as const).entries()) {
        assert.deepEqual(decks[owner]?.filter((card) => card.unitId !== undefined).map((card) => card.id), [heroes[index].id]);
        assert.deepEqual(decks[owner]?.filter((card) => card.unitId === undefined).map((card) => card.id), system);
    }
});

test('正式回包明确给空英雄阵容时只保留系统卡，不补本地英雄', () => {
    const source = prepare(4);
    const result = buildZCClientCombatConfig(source, battle([], []), 'self');
    assert.deepEqual(result.config.playerDeck, source.playerDeck.filter((card) => card.unitId === undefined));
    assert.deepEqual(result.config.enemyDeck, source.enemyDeck.filter((card) => card.unitId === undefined));
    assert.deepEqual(result.config.modifiers?.player, []);
    assert.deepEqual(result.config.modifiers?.enemy, []);
    assert.deepEqual(clientHeroIdsByOwner(source, battle([], []), 'self').player, []);
});

test('heroInfos 归一化后的 heroes 优先于旧 heroIds，包括空数组', () => {
    const source = prepare(4);
    const original = battle([68001], [68001]);
    const remote = { ...original, units: original.units.map((unit) => ({
        ...unit, heroes: unit.roleId === 'self' ? [] : [{ heroId: 68002, level: 3 }],
    })) };
    const result = buildZCClientCombatConfig(source, remote, 'self');
    assert.deepEqual(result.config.playerDeck.filter((card) => card.unitId !== undefined), []);
    assert.deepEqual(result.config.enemyDeck.filter((card) => card.unitId !== undefined).map((card) => Number(card.unitId)), [68002]);
    assert.deepEqual(clientHeroIdsByOwner(source, remote, 'self').enemy, [68002]);
});

test('服务端未提供的额外席位不补本地英雄阵容', () => {
    const source = prepare(4);
    const original = battle();
    const remote = { ...original, units: original.units.slice(0, 2) };
    const result = buildZCClientCombatConfig(source, remote, 'self');
    for (const owner of ['enemy2', 'enemy3'] as const) {
        assert.deepEqual(result.config.ownerDecks?.[owner]?.filter((card) => card.unitId !== undefined), []);
        assert.deepEqual(result.config.modifiers?.[owner], []);
        assert.deepEqual(clientHeroIdsByOwner(source, remote, 'self')[owner], []);
    }
});

test('SLG 守军八张卡按实际回包 id 和顺序构筑，不使用默认英雄', () => {
    const source = prepare(4);
    const ids = [68019, 68012, 68002, 68030, 68003, 68022, 68023, 68033];
    const original = battle([68001], ids);
    const remote = { ...original, units: original.units.map((unit) => unit.campId !== 1 ? unit : {
        ...unit, roleId: '0', name: '', heroes: ids.map((heroId) => ({ heroId, level: heroId === 68023 ? 1 : 3 })),
    }) };
    const result = buildZCClientCombatConfig(source, remote, 'self');
    assert.deepEqual(result.config.enemyDeck.filter((card) => card.unitId !== undefined).map((card) => Number(card.unitId)), ids);
});

test('服务端章节战斗阵容不再受本地关卡敌方卡牌名单裁剪', () => {
    const source = prepare(4);
    const exports: Record<string, unknown> = {};
    let initialized: { matchConfig: typeof source } | null = null;
    class Base {
        host = { addComponent: () => ({ initialize: (entry: { matchConfig: typeof source }) => { initialized = entry; } }) };
        log(): void {} error(): void {}
    }
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/procedure/ProcedureGame.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports, console, require(name: string) {
        if (name.endsWith('/ProcedureBase')) return { ProcedureBase: Base };
        if (name.endsWith('/ZCClientCombatConfig')) return { buildZCClientCombatConfig };
        if (name.endsWith('/ZCPveCombatConfig')) return { buildZCPveEnemyDecks };
        if (name.endsWith('/ZCMatchConfig')) return { captureZCMatchConfig };
        if (name.endsWith('/ZCRankBoard')) return { buildSeatProfiles: () => new Map(), buildSeatUnitIds: () => new Map() };
        if (name.endsWith('/ZCGame')) return { ZCGame: class {} };
        return {};
    } });
    const Procedure = exports.ProcedureGame as new () => { preparedResources: object; onEnter(params: object): void };
    const procedure = new Procedure();
    procedure.preparedResources = { baseMatchConfig: source };
    const pve = {
        mode: 'match', chapterId: 1, levelId: 1, territoryCellId: 327, hpRate: 0.2, attackRate: 0.3,
        enemyCardIds: [68001], enemyTeamCardIds: [[68001], [68001], [68001]], waves: [], playerCount: 4,
    };
    procedure.onEnter({ battle: battle([68001], [68002]), selfRoleId: 'self', pve });
    assert.ok(initialized);
    assert.deepEqual((initialized as { matchConfig: typeof source }).matchConfig.enemyDeck
        .filter((card) => card.unitId !== undefined).map((card) => Number(card.unitId)), [68002]);
    const actual = (initialized as { matchConfig: typeof source }).matchConfig;
    const expected = buildZCClientCombatConfig(source, battle([68001], [68002]), 'self').config;
    assert.deepEqual(actual.modifiers, expected.modifiers, '本地关卡倍率不得追加到修改器');
    const start = battle([68001], [68002]);
    const server = { ...start, units: start.units.map((unit) => ({
        ...unit, buffs: parseBattleBuffs([{ source: 1, buffs: ['levelAttackRatio', '0.8', 'levelHpRatio', '0.8'] }]),
    })) };
    procedure.preparedResources = { baseMatchConfig: source };
    procedure.onEnter({ battle: server, selfRoleId: 'self', pve });
    const combined = (initialized as { matchConfig: typeof source }).matchConfig;
    assert.deepEqual(combined, buildZCClientCombatConfig(source, server, 'self').config,
        '服务端倍率与本地关卡参数同时存在时，也只采用服务端');
    procedure.preparedResources = { baseMatchConfig: source };
    procedure.onEnter({ selfRoleId: 'self', pve });
    const local = (initialized as { matchConfig: typeof source }).matchConfig;
    assert.deepEqual(local.ownerRates, {}, '没有服务端数据时不补本地倍率');
    assert.ok(Object.values(local.modifiers ?? {}).flat().every((loadout) => !loadout.sourceKey.startsWith('territory:')));
});

test('服务端倍率独立作用于成长后的属性，保留英雄技能参数且不串阵营', () => {
    const source = prepare(4);
    const plain = buildZCClientCombatConfig(source, battle(), 'self').config;
    const start = battle();
    const buffed = { ...start, units: start.units.map((unit) => unit.roleId === 'self' ? {
        ...unit, buffs: parseBattleBuffs([{ source: 1, buffs: ['levelAttackRatio', '0.8', 'levelHpRatio', '0.5'] }]),
    } : unit) };
    const config = buildZCClientCombatConfig(source, buffed, 'self').config;
    assert.deepEqual(config.modifiers, plain.modifiers, '倍率不能占用英雄修改器和 rawAttributes');
    const before = compileZCMatchRuntime(plain);
    const after = compileZCMatchRuntime(config);
    for (const unit of source.units) {
        assert.equal(after.effectiveDefinitions.player.get(unit.unitId)?.attack,
            before.effectiveDefinitions.player.get(unit.unitId)!.attack * 0.8);
        assert.equal(after.effectiveDefinitions.player.get(unit.unitId)?.maxHp,
            before.effectiveDefinitions.player.get(unit.unitId)!.maxHp * 0.5);
    }
    assert.deepEqual(after.legacyAttributes, before.legacyAttributes);
    assert.deepEqual(after.effectiveDefinitions.enemy, before.effectiveDefinitions.enemy);
});

test('自选主城配置可在显式预备模式下完成客户端构筑', () => {
    prepare(4);
    const fixed = captureZCMatchConfig();
    const unresolved = {
        ...fixed,
        map: {
            ...fixed.map,
            cityMode: 'select' as const,
            playerHomeId: -1,
            enemyHomeId: -1,
            homes: [],
        },
    };

    assert.throws(() => buildZCClientCombatConfig(unresolved, battle(), 'self'), /自选主城/);

    const result = buildZCClientCombatConfig(unresolved, battle(), 'self', {
        allowUnresolvedSelect: true,
    });
    assert.equal(result.config.map.cityMode, 'select');
    assert.equal(result.config.map.playerHomeId, -1);
    assert.equal(result.config.modifiers?.player?.length, 1);
    assert.equal(Object.isFrozen(result.config), true);
});
