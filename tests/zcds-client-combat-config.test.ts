import { ZC_RUNTIME_CONFIG } from '../assets/script/app/zcds/model/ZCRuntimeConfigStore';
import { buildZCBattleEntry } from '../assets/script/app/zcds/application/ZCBattleEntryBuilder';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import type { ZCBattleStart } from '../assets/script/app/battle/BattleStartModel';
import { ZC_BATTLE_TYPE_CHAPTER, ZC_BATTLE_TYPE_SLG_MONSTER, parseBattleBuffs, parseBattleHeroAttrs } from '../assets/script/app/battle/BattleStartModel';
import type { ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import { ZCCombatSystem } from '../assets/script/app/zcds/model/systems/ZCCombatSystem';
import { compileZCMatchRuntime } from '../assets/script/app/zcds/model/ZCMatchRuntimeCompiler';
import { buildZCClientCombatConfig, clientHeroIdsByOwner } from '../assets/script/app/zcds/application/ZCClientCombatConfig';
import { configureZCMap } from '../assets/script/app/zcds/model/ZCMapConfig';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { captureZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import { ZCGameModel } from '../assets/script/app/zcds/model/ZCGameModel';
import { assetPath } from './helpers/asset-paths';
import { compileZCNeutralResourceCatalog } from '../assets/script/app/zcds/model/ZCNeutralResourceGroup';
import { resolveZCMapResources, resolveZCSpawnMatchConfig, ZCSpawnSelection } from '../assets/script/app/zcds/model/ZCSpawnSelection';

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
        'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams',
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

function serverMapBattle(source: ReturnType<typeof prepare>): ZCBattleStart {
    const start = battle();
    return { ...start,
        units: start.units.map((unit, index) => ({ ...unit, unitId: 101 + index })),
        mapInfo: { id: source.map.id, name: '后端地图', version: 3, resourcePoints: [],
            unitHomeIndexes: [2, 3, 0, 1].map((homeIndex, index) => ({ unitId: 101 + index, homeIndex })) },
    };
}

test('后端最终出生点按 unitId 映射玩家视角，同步转换分区并跳过自选主城', () => {
    const source = prepare(4);
    const start = serverMapBattle(source);
    const result = buildZCClientCombatConfig({ ...source, map: { ...source.map, cityMode: 'select' } }, start, 'self', { allowUnresolvedSelect: true }).config;
    assert.equal(result.map.cityMode, 'fixed');
    assert.deepEqual(result.map.homes, [3, 2, 0, 1].map(index => source.map.homes[index]));
    assert.equal(result.map.playerHomeId, source.map.homes[3]);
    assert.deepEqual(result.map.sections, source.map.sections.map(section => [0, 3, 4, 2, 1][section]));
    assert.equal(result.map.name, '后端地图');
    assert.equal(result.map.version, 3);
    assert.deepEqual(result.map.resolvedResources, []);
    const model = new ZCGameModel(null, () => 0.5, result);
    assert.equal(model.snapshot.hexes[result.map.playerHomeId].owner, 'player');
    assert.equal(model.snapshot.hexes[result.map.enemyHomeId].owner, 'enemy');
    assert.deepEqual(resolveZCMapResources(result.map, () => { throw new Error('不应重新抽取'); }), []);
    assert.equal(source.map.cityMode, 'fixed');
});

test('自选地图的后端空出生点保留选点流程，并沿用服务端资源快照', () => {
    prepare();
    configureZCMap(JSON.parse(readFileSync(assetPath('config/maps/river_custom_new.json'), 'utf8')));
    const source = captureZCMatchConfig(undefined, { allowUnresolvedSelect: true });
    const serverStart = serverMapBattle(source);
    const start = { ...serverStart, units: serverStart.units.slice(0, 2) };
    start.mapInfo.unitHomeIndexes.length = 0;
    const options = { allowUnresolvedSelect: true };
    const result = buildZCClientCombatConfig(source, start, 'self', options).config;
    assert.equal(result.map.cityMode, 'select');
    assert.deepEqual(result.map.homes, source.map.homes);
    assert.deepEqual(result.map.sections, source.map.sections);
    assert.equal(result.map.name, '后端地图');
    assert.deepEqual(result.map.resolvedResources, []);
    const selection = new ZCSpawnSelection(result.map, () => 0.5);
    selection.tick(60);
    const selectionResult = selection.result;
    assert.ok(selectionResult);
    const resolved = resolveZCSpawnMatchConfig(result, selectionResult);
    assert.equal(resolved.map.cityMode, 'fixed');
    assert.deepEqual(resolved.map.resolvedResources, []);
    assert.throws(() => buildZCClientCombatConfig(source, start, 'self'), /自选主城/);
});

test('后端资源编号直接进入对局，校验坐标和组合归属，不重新抽签', () => {
    const source = prepare(4);
    ZC_RUNTIME_CONFIG.updateCatalogs({ neutralResources: compileZCNeutralResourceCatalog([
        { id: 99001, groupId: 99, groupName: '测试', resourceType: 1, weight: 0, param: 10 },
    ], new Map()) });
    try {
        const start = serverMapBattle(source);
        const cell = source.map.hexes.find(hex => hex.playable && !source.map.homes.includes(hex.id));
        start.mapInfo.resourcePoints.push({ row: cell.row, column: cell.column, groupId: 99, resourceId: 99001 });
        const result = buildZCClientCombatConfig(source, start, 'self').config;
        assert.equal(result.map.resolvedResources[0].hexId, cell.id);
        assert.equal(result.map.resolvedResources[0].itemId, 99001);
        assert.deepEqual(resolveZCMapResources(result.map, () => { throw new Error('不应重新抽取'); }), result.map.resolvedResources);
        const selectStart = { ...start, mapInfo: { ...start.mapInfo, unitHomeIndexes: [] } };
        const selectResult = buildZCClientCombatConfig(
            { ...source, map: { ...source.map, cityMode: 'select' } }, selectStart, 'self', { allowUnresolvedSelect: true },
        ).config;
        assert.equal(selectResult.map.cityMode, 'select');
        assert.equal(selectResult.map.resolvedResources[0].itemId, 99001);
        assert.deepEqual(resolveZCMapResources(selectResult.map, () => { throw new Error('不应重新抽取'); }), selectResult.map.resolvedResources);
        start.mapInfo.resourcePoints[0].groupId = 98;
        assert.throws(() => buildZCClientCombatConfig(source, start, 'self'), /资源点配置不匹配/);
        start.mapInfo.resourcePoints[0].column = source.map.columns;
        assert.throws(() => buildZCClientCombatConfig(source, start, 'self'), /资源点位置无效/);
    } finally { ZC_RUNTIME_CONFIG.updateCatalogs({ neutralResources: undefined }); }
});

test('后端出生点缺失、重复、越界和未知 unitId 均拒绝开局', () => {
    const source = prepare(4);
    for (const mutate of [
        (info: CmdPvpMapInfo) => { info.unitHomeIndexes.length = 0; },
        (info: CmdPvpMapInfo) => info.unitHomeIndexes.pop(),
        (info: CmdPvpMapInfo) => { info.unitHomeIndexes[0].homeIndex = info.unitHomeIndexes[1].homeIndex; },
        (info: CmdPvpMapInfo) => { info.unitHomeIndexes[0].homeIndex = 4; },
        (info: CmdPvpMapInfo) => { info.unitHomeIndexes[0].unitId = 999; },
    ]) {
        const start = serverMapBattle(source);
        mutate(start.mapInfo);
        assert.throws(() => buildZCClientCombatConfig(source, start, 'self'), /后端出生点/);
    }
});

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
        //  星级表 2026-11-10 弃用后，一名武将只编「等级成长 + 技能计划」两条，**不再有 generalStar 那条**。
        //  归属原来靠 generalStar 的 `generalId` 反查，现在改看 `targetUnitId`。
        const growth = loadouts.filter((loadout) => loadout.sourceKind === 'growth');
        assert.equal(growth.length, 1, owner);
        assert.equal(growth[0].targetUnitId, '68001');
        //  星级那条要彻底消失：谁把它加回构筑，这里立刻红。
        assert.equal(loadouts.filter((loadout) => loadout.sourceKind === 'generalStar').length, 0, owner);
        //  「全量重算·去掉补偿」后 1 级 attackFlat=0，过滤器 value !== 0 ⇒ 无 attackFlat 补丁；
        //  品质固定 45 是已废弃的旧口径，别被顺手加回来。
        assert.equal(growth[0].statPatch.attackFlat ?? 0, 0, owner);
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
        result.config.modifiers?.player?.filter((loadout) => loadout.sourceKind === 'growth')
            .map((loadout) => Number(loadout.targetUnitId)),
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
    //  星级表弃用后没有 generalStar 那条了，改按成长行的 `targetUnitId` 找。
    const spear = result.config.modifiers?.player?.find(
        (loadout) => loadout.sourceKind === 'growth' && loadout.targetUnitId === '68002',
    );
    assert.ok(spear);
    //  同上：1 级为曲线起点 0，不再补品质固定 45。
    assert.equal(spear.statPatch.attackFlat ?? 0, 0);
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

test('章节敌方各席位直接使用后端阵容并保留系统卡', () => {
    const source = prepare(4);
    const remote = battle([68001], [68002], [68003], [68004]);
    const entry = buildZCBattleEntry({ baseMatchConfig: source } as Parameters<typeof buildZCBattleEntry>[0], {
        battle: remote, selfRoleId: 'self',
        pve: {
            mode: 'match', chapterId: 1, levelId: 1, territoryCellId: 327, stage: 1,
            enemyName: '', territorySaveOwner: null, playerCount: 4,
            enemyCardIds: [68001], enemyTeamCardIds: [[68001], [68001], [68001]],
            waves: [], hpRate: 1, attackRate: 1,
        },
    });
    const system = source.enemyDeck.filter(card => card.unitId === undefined).map(card => card.id);
    for (const [index, owner] of (['enemy', 'enemy2', 'enemy3'] as const).entries()) {
        const deck = entry.matchConfig.ownerDecks[owner];
        assert.deepEqual(deck.filter(card => card.unitId !== undefined).map(card => Number(card.unitId)), [68002 + index]);
        assert.deepEqual(deck.filter(card => card.unitId === undefined).map(card => card.id), system);
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
    const pve = {
        mode: 'match', chapterId: 1, levelId: 1, territoryCellId: 327, hpRate: 0.2, attackRate: 0.3,
        enemyCardIds: [68001], enemyTeamCardIds: [[68001], [68001], [68001]], waves: [], playerCount: 4,
    };
    const initialized = buildZCBattleEntry({ baseMatchConfig: source } as Parameters<typeof buildZCBattleEntry>[0], { battle: battle([68001], [68002]), selfRoleId: 'self', pve: { ...pve, playerCount: 2, stage: 1, enemyName: '', territorySaveOwner: null, mode: 'match' } });
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

    const combined = buildZCBattleEntry({ baseMatchConfig: source } as Parameters<typeof buildZCBattleEntry>[0], { battle: server, selfRoleId: 'self', pve: { ...pve, playerCount: 2, stage: 1, enemyName: '', territorySaveOwner: null, mode: 'match' } }).matchConfig;
    assert.deepEqual(combined, buildZCClientCombatConfig(source, server, 'self').config,
        '服务端倍率与本地关卡参数同时存在时，也只采用服务端');

    const local = buildZCBattleEntry({ baseMatchConfig: source } as Parameters<typeof buildZCBattleEntry>[0], { selfRoleId: 'self', pve: { ...pve, playerCount: 2, stage: 1, enemyName: '', territorySaveOwner: null, mode: 'match' } }).matchConfig;
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
    assert.equal(
        result.config.modifiers?.player?.filter((loadout) => loadout.sourceKind === 'growth').length,
        1,
    );
    assert.equal(Object.isFrozen(result.config), true);
});

test('服务端英雄属性覆盖本地成长后参与战斗，建筑血量与阵营隔离且构筑幂等', () => {
    const source = prepare(4);
    const original = JSON.stringify(source);
    const start = battle();
    const plain = compileZCMatchRuntime(buildZCClientCombatConfig(source, start, 'self').config);
    const remote = { ...start, units: start.units.map((unit) => ({
        ...unit,
        heroes: [{ heroId: 68001, level: 10 }],
        heroAttrs: parseBattleHeroAttrs(unit.roleId === 'self' ? [
            { heroId: 68001, attrs: [
                { attrId: 'attack', value: '123' }, { attrId: 'maxHp', value: '789' },
                { attrId: 'buildingHp', value: '654' },
            ] },
            { heroId: 68002, attrs: [{ attrId: 'attack', value: '99999' }, { attrId: 'buildingHp', value: '99999' }] },
        ] : unit.campId === 1 ? [{ heroId: 68001, attrs: [{ attrId: 'attack', value: '0' }] }] : []),
        buffs: unit.roleId === 'self'
            ? parseBattleBuffs([{ source: 1, buffs: ['levelAttackRatio', '2', 'levelHpRatio', '0.5'] }]) : [],
    })) };
    const result = buildZCClientCombatConfig(source, remote, 'self');
    assert.deepEqual(result.skipped, []);
    const runtime = compileZCMatchRuntime(result.config);
    const player = runtime.effectiveDefinitions.player.get('68001');
    assert.equal(player?.attack, 123);
    assert.equal(player?.maxHp, 789);
    assert.ok(player);
    const game = new ZCGameModel(null, () => .1, result.config);
    const spawned: ZCUnitState | null = Reflect.get(game, 'spawnUnit').call(game, 'player',
        result.config.playerDeck.find((card) => card.unitId === '68001'), 1, result.config.map.playerHomeId);
    assert.ok(spawned);
    assert.equal(spawned.maxHp, 789);
    assert.equal(ZCCombatSystem.unitDamage(spawned, player, runtime.deckBonuses.player, 1,
        { ...result.config.rules, combatDamageMultiplier: 1 }), 123);
    assert.equal(runtime.effectiveDefinitions.enemy.get('68001')?.attack, 0);
    const withoutAttrs = compileZCMatchRuntime(buildZCClientCombatConfig(source, {
        ...remote, units: remote.units.map((unit) => ({ ...unit, heroAttrs: [], buffs: [] })),
    }, 'self').config);
    assert.equal(runtime.effectiveDefinitions.enemy.get('68001')?.maxHp,
        withoutAttrs.effectiveDefinitions.enemy.get('68001')?.maxHp);
    assert.deepEqual(runtime.skillRuntime.player, withoutAttrs.skillRuntime.player);
    assert.equal(result.config.playerDeck.find((card) => card.unitId === '68001')?.baseHp, 654);
    assert.equal(result.config.enemyDeck.find((card) => card.unitId === '68001')?.baseHp,
        source.enemyDeck.find((card) => card.unitId === '68001')?.baseHp);
    assert.deepEqual(runtime.effectiveDefinitions.enemy2, withoutAttrs.effectiveDefinitions.enemy2);
    assert.deepEqual(buildZCClientCombatConfig(result.config, remote, 'self').config, result.config);
    assert.equal(JSON.stringify(source), original);
    assert.equal(Object.isFrozen(result.config.modifiers?.player), true);
    assert.notDeepEqual(runtime.effectiveDefinitions.player, plain.effectiveDefinitions.player);
});

test('battle entry copies PVE navigation data without callbacks and normalizes defence wave order', () => {
    const source = prepare(4);
    const prepared = { baseMatchConfig: source } as Parameters<typeof buildZCBattleEntry>[0];
    const pve: NonNullable<Parameters<typeof buildZCBattleEntry>[1]>['pve'] = {
        mode: 'defence', chapterId: 2, levelId: 3, territoryCellId: 4, stage: 1,
        territorySaveOwner: null, enemyName: '', enemyCardIds: [], enemyTeamCardIds: [],
        playerCount: 2, hpRate: 1, attackRate: 1,
        waves: [
            { waveId: 2, showAtSeconds: 3, pvpCardId: 68001, monsterCount: 2, hpRate: 1, attackRate: 1 },
            { waveId: 1, showAtSeconds: 0, pvpCardId: 68001, monsterCount: 1, hpRate: 1, attackRate: 1 },
            { waveId: 3, showAtSeconds: -1, pvpCardId: 68001, monsterCount: 1, hpRate: 1, attackRate: 1 },
        ],
    };
    const original = JSON.stringify(source), waves = JSON.stringify(pve.waves);
    const entry = buildZCBattleEntry(prepared, { pve });
    assert.deepEqual(entry.pveContext, { chapterId: 2, territoryCellId: 4, levelId: 3 });
    assert.deepEqual(entry.matchConfig.pveDefence?.waves.map(wave => wave.waveId), [1, 2]);
    assert.equal(JSON.stringify(source), original);
    assert.equal(JSON.stringify(pve.waves), waves);
    assert.equal(entry.battleSeed, null);
});

test('匹配入口的 battleType 一路带进对局：宝箱战斗（1002）才不会静默丢结算奖励', () => {
    const prepared = { baseMatchConfig: prepare(4) } as Parameters<typeof buildZCBattleEntry>[0];
    // 宝箱栏「开始战斗」的真实形状：battleType 1002 + 子类型 2，没有 pve、没有 slgBattleType。
    // 漏了这一个字段 ⇒ 结算不调 waitResult ⇒ result 恒 null ⇒ 奖励区全空且零报错。
    const treasure = buildZCBattleEntry(prepared, { battleType: ZC_BATTLE_TYPE_CHAPTER });
    assert.equal(treasure.battleType, ZC_BATTLE_TYPE_CHAPTER);
    assert.equal(treasure.pveContext, null);
    // 老形状（只有 slgBattleType 的 SLG 入口）继续收敛成同一个字段
    assert.equal(buildZCBattleEntry(prepared, { slgBattleType: ZC_BATTLE_TYPE_SLG_MONSTER }).battleType, ZC_BATTLE_TYPE_SLG_MONSTER);
    // 两个都没有 ⇒ null：领地 PVE 由运行时按 pveContext 兜底，这里不替它猜 1002
    assert.equal(buildZCBattleEntry(prepared, { selfRoleId: 'self' }).battleType, null);
});

test('关卡 openGrideTime 与 BOSS 波标记随 PVE 参数进入对局配置', () => {
    const source = prepare(4);
    const prepared = { baseMatchConfig: source } as Parameters<typeof buildZCBattleEntry>[0];
    const pveBase = {
        mode: 'defence' as const, chapterId: 1, levelId: 10005, territoryCellId: 4, stage: 5,
        territorySaveOwner: null, enemyName: '', enemyCardIds: [], enemyTeamCardIds: [],
        playerCount: 2 as const, hpRate: 1, attackRate: 1,
        waves: [
            { waveId: 1, showAtSeconds: 3, pvpCardId: 68001, monsterCount: 5, hpRate: 1, attackRate: 1, monsterSize: 1 },
            { waveId: 2, showAtSeconds: 95, pvpCardId: 68002, monsterCount: 1, hpRate: 1, attackRate: 1, isBoss: true, monsterSize: 2 },
        ],
    };
    const entry = buildZCBattleEntry(prepared, { pve: { ...pveBase, openGrideTime: 18 } });
    assert.equal(entry.matchConfig.openGrideTime, 18, 'NPC 翻地块限速要带进对局');
    assert.deepEqual(entry.matchConfig.pveDefence?.waves.map((wave) => [wave.waveId, wave.isBoss === true]),
        [[1, false], [2, true]], 'BOSS 波标记必须原样投影（HUD 大血条与胜负都靠它）');
    // 怪物体型只在 >1 时写：1 是普通体型，写进去只是让对局多做一次无效乘算。
    assert.deepEqual(entry.matchConfig.pveDefence?.waves.map((wave) => wave.monsterSize),
        [undefined, 2], 'BOSS 那行要带上 monsterSize=2（模型放大）');

    // 0 = 「够钱就翻」⇒ 不写进配置，避免把「不限速」当成 0 秒限速。
    const uncapped = buildZCBattleEntry(prepared, { pve: { ...pveBase, openGrideTime: 0 } });
    assert.equal(uncapped.matchConfig.openGrideTime, undefined);
    const missing = buildZCBattleEntry(prepared, { pve: pveBase });
    assert.equal(missing.matchConfig.openGrideTime, undefined);
});

test('首领塔防关拿到服务端开战回包也要按 npcCard 收紧敌方卡组（不能整池上阵）', () => {
    prepare(4);
    const source = captureZCMatchConfig();
    const entry = buildZCBattleEntry({ baseMatchConfig: source } as Parameters<typeof buildZCBattleEntry>[0], {
        battle: battle([68001], [68001]), selfRoleId: 'self',
        pve: {
            mode: 'defence', chapterId: 1, levelId: 10005, territoryCellId: 4, stage: 5,
            territorySaveOwner: null, enemyName: '', enemyCardIds: [68001, 68002, 68003],
            enemyTeamCardIds: [[68001, 68002, 68003]], playerCount: 2, hpRate: 1, attackRate: 1,
            openGrideTime: 18,
            waves: [
                { waveId: 1, showAtSeconds: 3, pvpCardId: 68002, monsterCount: 5, hpRate: 1, attackRate: 1 },
                { waveId: 2, showAtSeconds: 95, pvpCardId: 68003, monsterCount: 1, hpRate: 1, attackRate: 1, isBoss: true },
            ],
        },
    });
    const allowed = new Set(['68001', '68002', '68003']);
    // 整份敌方卡池有 30+ 张，塔防关只认「npcCard + 出怪卡」这一份配置。
    assert.ok(source.enemyDeck.length > 10);
    assert.equal(entry.matchConfig.enemyDeck.length < source.enemyDeck.length, true, '敌方卡组必须被收紧');
    assert.equal(entry.matchConfig.enemyDeck.every((card) => allowed.has(card.id)), true,
        `敌方卡组混进了 npcCard 与出怪卡之外的卡：${entry.matchConfig.enemyDeck.map((card) => card.id).join(',')}`);
    // 出怪卡即使没进敌方卡组也要能查表出怪（`pveDefence.cards` 兜底）。
    const runtime = compileZCMatchRuntime(entry.matchConfig);
    assert.equal(runtime.cards.has('68002'), true);
    assert.equal(runtime.cards.has('68003'), true);
});

test('领地首领波次卡不在服务端阵容中仍出怪，清空末波后才判胜', () => {
    prepare(4);
    configureZCMap(JSON.parse(readFileSync(assetPath('config/maps/normal.json'), 'utf8')));
    const source = captureZCMatchConfig();
    const entry = buildZCBattleEntry({ baseMatchConfig: source } as Parameters<typeof buildZCBattleEntry>[0], {
        battle: battle([68001], [68001]), selfRoleId: 'self',
        pve: {
            mode: 'defence', chapterId: 1, levelId: 50001, territoryCellId: 4, stage: 4,
            territorySaveOwner: null, enemyName: '', enemyCardIds: [68002, 68003], enemyTeamCardIds: [],
            playerCount: 2, hpRate: 1, attackRate: 1,
            waves: [
                { waveId: 1, showAtSeconds: .1, pvpCardId: 68002, monsterCount: 2, hpRate: 1, attackRate: 1 },
                { waveId: 2, showAtSeconds: 20, pvpCardId: 68003, monsterCount: 1, hpRate: 1, attackRate: 1 },
            ],
        },
    });
    const runtime = compileZCMatchRuntime(entry.matchConfig);
    assert.equal(runtime.cards.has('68002'), true, '波次卡必须进入战斗查表');
    assert.equal(runtime.cards.has('68003'), true);
    for (const deck of Object.values(entry.matchConfig.ownerDecks ?? {})) {
        assert.equal(deck.some(card => card.id === '68002' || card.id === '68003'), false,
            '波次卡不能进入服务端抽卡卡池');
    }
    const model = new ZCGameModel(null, () => .25, entry.matchConfig);
    model.tick(.1);
    assert.equal(model.snapshot.status, 'playing', '首波缺席服务端阵容不能直接判胜');
    assert.equal(model.defenceWaveProgress?.spawnedWaves, 1);
    assert.deepEqual(model.snapshot.units.map(unit => unit.cardId), ['68002', '68002']);
    for (const unit of model.snapshot.units) Object.assign(unit, { hp: 0, battleState: 'dead', deathRemoveAt: 100 });
    model.tick(.05);
    assert.equal(model.snapshot.status, 'playing', '第二波必须实际生成并等待击败');
    assert.equal(model.defenceWaveProgress?.spawnedWaves, 2);
    const boss = model.snapshot.units.find(unit => unit.battleState !== 'dead');
    assert.equal(boss?.cardId, '68003');
    assert.ok(boss);
    const snapshot = model.exportSnapshot();
    snapshot.projectiles.push({
        id: snapshot.nextCombatEventId++, type: 'projectile', owner: 'player', sourceUnitId: snapshot.nextUnitId++,
        targetUnitId: boss.id, targetKind: 'unit', targetId: boss.id, sourceCardId: '68001',
        skillId: 1, skillName: 'test', effectKey: null, projectileKey: null,
        fromX: boss.freeX - 10, fromY: boss.freeY, toX: boss.freeX, toY: boss.freeY,
        x: boss.freeX - 10, y: boss.freeY, previousX: boss.freeX - 10, previousY: boss.freeY,
        velocityX: 2000, velocityY: 0, radius: 0, collisionRadius: 1,
        baseDamage: 10, damage: 10, canHitAir: true, empowered: false,
        startedAt: snapshot.elapsedSeconds, durationSeconds: .05,
    });
    const restored = new ZCGameModel(snapshot, () => .25, entry.matchConfig);
    restored.tick(.05);
    assert.equal(restored.snapshot.units.find(unit => unit.id === boss.id)?.hp, boss.hp - 13,
        '缺席阵容的波次卡仍按真实卡表结算 1.3 倍克制伤害');
    assert.equal(restored.damageStats.player.dealt, 13);
    for (const unit of model.snapshot.units) Object.assign(unit, { hp: 0, battleState: 'dead', deathRemoveAt: 100 });
    model.tick(.05);
    assert.equal(model.snapshot.status, 'victory');
});

/**
 * 星级表 2026-11-10 弃用：构筑侧不再传 `generalStar`。
 * 2026-11-10 二次口径（patch_growth_from_card_level_up.js）：「全量重算·去掉补偿」——
 * `pvpUnitGrowth` 按 `cardLevelUp` 反推 1~50 级，品质固定补偿 45/55/65/75 被曲线吸收，
 * 第 1 级为 0（`ZCModifierRuntime` 过滤 value !== 0 ⇒ 不产生 attackFlat 补丁）。
 * 这条用例钉的是**曲线形状与完整性**：漏级、被改回恒定档位、曲线非单调，都要当场红。
 */
test('成长表按 cardLevelUp 全量重算：14 张老卡 1~50 级齐备且 attackFlat 单调递增', () => {
    const cards = new Map(readRows('pvpCard').map((row) => [String(row.id), row]));
    const growth = readRows('pvpUnitGrowth');
    const stars = new Set(readRows('generalStar').map((row) => `${row.id}:${row.star}`));

    const oldCards = ['68001', '68002', '68003', '68004', '68005', '68006', '68007',
        '68008', '68009', '68010', '68011', '68012', '68013', '68014'];

    for (const unitId of oldCards) {
        assert.ok(cards.has(unitId), `${unitId} 必须仍在卡表`);
        const rows = growth.filter((row) => String(row.unitId) === unitId);
        assert.equal(rows.length, 50, `${unitId} 成长行必须是 1~50 级`);
        const levels = rows.map((row) => Number(row.level)).sort((a, b) => a - b);
        assert.deepEqual(levels, Array.from({ length: 50 }, (_, i) => i + 1), `${unitId} 等级要连续`);
        const byLevel = new Map(rows.map((row) => [Number(row.level), Number(row.attackFlat)]));
        assert.equal(byLevel.get(1), 0, `${unitId} 1 级是曲线起点（去掉品质固定补偿）`);
        for (let level = 2; level <= 50; level += 1) {
            assert.ok((byLevel.get(level) ?? 0) > (byLevel.get(level - 1) ?? 0),
                `${unitId} 第 ${level} 级 attackFlat 必须严格递增（改回恒定档位会在这里红）`);
        }
        for (const row of rows) {
            assert.equal(Number(row.enabled), 1, `${unitId} 第 ${row.level} 级必须启用`);
        }
    }

    //  反向守卫：这批卡的星级 1 行如果还在表里，说明「摘星级」只摘了代码没摘数据，
    //  下一个人接回构筑就会重复吃加成 —— 两头只留一头。
    for (const unitId of oldCards) {
        assert.equal(stars.has(`${unitId}:1`), true,
            `${unitId} 的 1 星行被删了？本次口径是「代码不再用」，表本身允许留着不补，删了要同步改这条`);
    }
});

// `pvpBaseTeamWeight` 已于 2026-11-10 并入 `pvpTile` 并下线（见 ZCGameRuntimeConfig 注释、
// ZCPvpTileRules）。守住两件事：权重三列确实由 pvpTile 承载、下线表没被重新导入 ——
// 否则「表悄悄回来了 / 权重列被删了」会变成静默回归，而不是一组 ENOENT。
test('下线的 pvpBaseTeamWeight 不再入库，权重三列由 pvpTile 承载', () => {
    const tile = JSON.parse(readFileSync('assets/remoteRef/pvpTile.json', 'utf8')) as
        | { k: string[]; v: unknown[][] }
        | Array<Record<string, unknown>>;
    const columns = Array.isArray(tile) ? Object.keys(tile[0] ?? {}) : tile.k;
    for (const column of ['weight', 'initialCountLimit', 'setCountLimit']) {
        assert.ok(columns.includes(column), `pvpTile 必须承载 ${column}`);
    }
    assert.equal(existsSync('assets/remoteRef/pvpBaseTeamWeight.json'), false,
        'pvpBaseTeamWeight 已并入 pvpTile 下线，不应被重新导入');
});
