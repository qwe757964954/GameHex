import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ZCGameModel, ZC_MAX_TICK_SECONDS } from '../assets/script/app/zcds/model/ZCGameModel';
import { configureZCMap, ZCMapLayout } from '../assets/script/app/zcds/model/ZCMapConfig';
import { loadPvpTables, ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { captureZCMatchConfig, ZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import { ZCSnapshotCodec } from '../assets/script/app/zcds/model/ZCSnapshotCodec';
import { ZCMapGeometry } from '../assets/script/app/zcds/model/ZCMapGeometry';
import { ZCCardType, ZCDeckCard } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import { ZCHexState, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import { ZCUnitRegistry } from '../assets/script/app/zcds/model/systems/ZCUnitRegistry';
import { ZCDevelopmentSystem } from '../assets/script/app/zcds/model/systems/ZCDevelopmentSystem';
import { assetPath } from './helpers/asset-paths';

//  `pvpUnit` 已于 2026-09-20 并入 `pvpCard`（单位列内联、加 `unit` 前缀），表已下线。
const tableNames = [
    'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams', 'pvpBaseTeamWeight',
];
const tables = Object.fromEntries(tableNames.map((name) => {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8'));
    return [name, Array.isArray(source) ? source : source.v.map((row: unknown[]) => (
        Object.fromEntries(source.k.map((key: string, index: number) => [key, row[index]]))
    ))];
})) as unknown as ZCPvpTables;
const layout = JSON.parse(readFileSync('tests/fixtures/zcds-legacy-map.json', 'utf8')) as ZCMapLayout;
loadPvpTables(tables);
configureZCMap(layout);
const config = captureZCMatchConfig();

function unit(id: number, owner: 'player' | 'enemy', hexId = config.map.playerHomeId): ZCUnitState {
    const definition = config.units[0];
    const hex = config.map.hexes[hexId];
    return {
        id, owner, unitId: definition.unitId, cardId: 'test', tier: 1,
        sourceHexId: hexId, targetHexId: null, progress: 0, hp: definition.maxHp, maxHp: definition.maxHp,
        battleState: 'target', stateTime: 0, targetUnitId: null, targetWallHexId: null,
        targetBuildingHexId: null, nextAttackAt: 1.8, waitUntil: 0, attackHitDone: false,
        hatredUnitId: null, hatredUntil: 0, facingRadians: 0, deathRemoveAt: 0,
        marchAngle: null, freeX: hex.x, freeY: hex.y, completedAttackCount: 0,
    };
}

function gameWithUnits(): ZCGameModel {
    const snapshot = ZCGameModel.createInitialState(() => 0.1, config);
    snapshot.units = [unit(1, 'player'), unit(2, 'enemy', config.map.hexes[config.map.playerHomeId].neighbors[0])];
    snapshot.nextUnitId = 3;
    let seed = 123456;
    const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 0x100000000;
    };
    return new ZCGameModel(snapshot, random, config);
}

test('伤害结算只统计实际扣血，护盾和重复死亡不会重复给奖励', () => {
    const game = gameWithUnits();
    const target = (game as any).state.units.find((candidate: ZCUnitState) => candidate.owner === 'enemy') as ZCUnitState;
    target.hp = 30;
    target.shield = 10;
    const goldBefore = game.snapshot.playerGold;
    const hit = (game as any).damageUnit(target, 100, { owner: 'player', kind: 'artifact' });
    assert.equal(hit.value, 30);
    assert.equal(target.shield, 0);
    assert.equal(target.battleState, 'dead');
    assert.equal(game.damageStats.player.dealt, 30);
    assert.equal(game.damageStats.enemy.taken, 30);
    assert.equal(game.snapshot.playerGold, goldBefore + config.rules.killUnitGoldReward);
    assert.deepEqual(game.floatTexts.map((text) => text.kind), ['damage', 'gold']);
    assert.equal((game as any).damageUnit(target, 100, { owner: 'player', kind: 'artifact' }), null);
    assert.equal(game.damageStats.player.dealt, 30);
    assert.equal(game.snapshot.playerGold, goldBefore + config.rules.killUnitGoldReward);
});

/** 资源项 id：行军占领只改归属、不领取，所以这里只要一个合法数字（不查表）。 */
const GOLD_ITEM = 1300101;

test('小兵占领资源格时保留资源，废墟易手仍保留已消费标记', () => {
    const hex = ZCGameModel.createInitialState(() => .1, config).hexes.find((candidate) => candidate.building === 'none')!;
    hex.owner = 'neutral';
    hex.neutralResourceId = GOLD_ITEM;
    assert.deepEqual(ZCDevelopmentSystem.captureEmptyTile(hex, 'player'),
        { changed: true, terrainChanged: true });
    assert.equal(hex.owner, 'player');
    assert.equal(hex.neutralResourceId, GOLD_ITEM, '行军占领不应领取或隐藏资源');
    assert.equal(hex.developmentResolved, false, '行军占领不应将资源标记为已领取');
    hex.neutralResourceId = null;
    hex.owner = 'player';
    hex.state = 'ruins';
    hex.developmentResolved = true;
    hex.wallHp = 30;
    assert.deepEqual(ZCDevelopmentSystem.captureEmptyTile(hex, 'enemy'),
        { changed: true, terrainChanged: true });
    assert.equal(hex.owner, 'enemy');
    assert.equal(hex.state, 'developed');
    assert.equal(hex.developmentResolved, true);
    assert.equal(hex.wallHp, 0);
});

// 编译检查：实时状态的数组、实体及嵌套记录均不能由视图层修改。
function readonlyContract(game: ZCGameModel): void {
    // @ts-expect-error snapshot 中的实体只读
    game.snapshot.units[0].hp = 0;
    // @ts-expect-error snapshot 中的数组只读
    game.snapshot.units.push(unit(100, 'player'));
    // @ts-expect-error snapshot 中的嵌套记录只读
    game.snapshot.builtTypeCounts.player[ZCCardType.Barracks] = 0;
}
void readonlyContract;

test('独立存档修改不会影响模型，表现事件不进入导出存档', () => {
    const game = gameWithUnits();
    game.tick(3);
    const snapshot = game.exportSnapshot();
    assert.deepEqual(snapshot.combatEvents, []);
    const originalHp = game.snapshot.units[0].hp;
    snapshot.hexes[0].owner = 'neutral';
    snapshot.units[0].hp = 0;
    snapshot.units.length = 0;
    assert.equal(game.snapshot.units[0].hp, originalHp);
    assert.notEqual(game.snapshot.hexes[0].owner, 'neutral');
});

test('快照拒绝地块乱序、非法单位引用、重复 ID 和缺少周期数据，并点名字段', () => {
    const seed = gameWithUnits().exportSnapshot();
    const cases: Array<[string, (snapshot: typeof seed) => void]> = [
        ['hexes[0].id', (s) => { [s.hexes[0], s.hexes[1]] = [s.hexes[1], s.hexes[0]]; }],
        ['units[0].sourceHexId', (s) => { s.units[0].sourceHexId = -1; }],
        ['units[1].id', (s) => { s.units[1].id = s.units[0].id; }],
        ['units[0].unitId', (s) => { s.units[0].unitId = 'missing'; }],
        ['units[0].owner', (s) => { (s.units[0] as any).owner = 'neutral'; }],
        ['nextUnitId', (s) => { s.nextUnitId = 2; }],
        ['spawnClocks', (s) => { delete (s as any).spawnClocks; }],
        ['builtTypeCounts', (s) => { (s.builtTypeCounts as any).player = null; }],
        ['durationSeconds', (s) => { s.durationSeconds = NaN; }],
    ];
    for (const [field, mutate] of cases) {
        const snapshot = ZCSnapshotCodec.clone(seed);
        mutate(snapshot);
        const result = ZCSnapshotCodec.decode(snapshot, config);
        assert.equal(result.ok, false, field);
        if (result.ok === false) assert.ok(result.errors.includes(field), result.errors.join(', '));
        assert.equal(ZCGameModel.isValidSnapshot(snapshot, config), false, field);
        assert.throws(() => new ZCGameModel(snapshot, () => 0.1, config), /无效对局快照/);
    }
});

test('旧 version 4 字段迁移补齐坐标、神器和建筑周期，不修改输入', () => {
    const snapshot = gameWithUnits().exportSnapshot();
    const homeId = config.map.playerHomeId;
    for (const field of ['battleState', 'freeX', 'freeY', 'stateTime', 'nextAttackAt']) delete (snapshot.units[0] as any)[field];
    for (const field of ['artifactReadyUses', 'allRandomNonGoldDraws', 'pendingSeconds', 'combatEvents', 'nextCombatEventId']) delete (snapshot as any)[field];
    snapshot.spawnClocks[String(homeId)] = 0.4;
    snapshot.artifactCharge = config.rules.artifactChargeFull;
    const original = JSON.stringify(snapshot);
    const game = new ZCGameModel(snapshot, () => 0.1, config);
    assert.equal(game.snapshot.units[0].battleState, 'target');
    assert.equal(game.snapshot.units[0].freeX, config.map.hexes[homeId].x);
    assert.equal(game.snapshot.artifactReadyUses, 1);
    assert.equal(game.snapshot.spawnClocks[`hq:${homeId}`], 0.4);
    assert.equal(JSON.stringify(snapshot), original);
});

test('固定步长在不同帧率及有战斗的情况下得到相同状态', () => {
    const slow = gameWithUnits();
    const fast = gameWithUnits();
    for (let i = 0; i < 4; i++) slow.tick(1);
    for (let i = 0; i < 400; i++) fast.tick(0.01);
    assert.deepEqual(fast.exportSnapshot(), slow.exportSnapshot());
    assert.deepEqual(fast.damageStats, slow.damageStats);
    assert.deepEqual(fast.floatTexts, slow.floatTexts);
});

test('不足一步的时间余量可以存档恢复，非法 delta 无效，长帧沿用 5 秒上限', () => {
    const game = new ZCGameModel(null, () => 0.1, config);
    game.tick(0.03);
    assert.equal(game.snapshot.elapsedSeconds, 0);
    const restored = new ZCGameModel(game.exportSnapshot(), () => 0.1, config);
    restored.tick(0.02);
    assert.equal(restored.snapshot.elapsedSeconds, 0.05);
    assert.equal(restored.snapshot.pendingSeconds, 0);
    for (const delta of [NaN, Infinity, 0, -1]) restored.tick(delta);
    assert.equal(restored.snapshot.elapsedSeconds, 0.05);
    restored.tick(10);
    assert.equal(restored.snapshot.elapsedSeconds, 0.05 + ZC_MAX_TICK_SECONDS);
});

test('全局配置重载和更换地图不会影响已有对局及其 reset', () => {
    const original = new ZCGameModel(null, () => 0.1, config);
    const control = new ZCGameModel(null, () => 0.1, config);
    try {
        const alternate = structuredClone(tables);
        const gold = (alternate.pvpGlobal as Array<Record<string, unknown>>).find((row) => row.key === 'initialGold');
        if (gold) gold.value = Number(gold.value) + 999;
        loadPvpTables(alternate);
        configureZCMap({ ...layout, id: 'another-map' });
        original.reset();
        assert.deepEqual(original.exportSnapshot(), control.exportSnapshot());
        const id = original.snapshot.hexes.find((hex) => original.canPlayerDevelop(hex.id))!.id;
        assert.deepEqual(original.developHex(id), control.developHex(id));
        original.tick(3); control.tick(3);
        assert.deepEqual(original.exportSnapshot(), control.exportSnapshot());
    } finally {
        loadPvpTables(tables);
        configureZCMap(layout);
    }
});

test('注入配置会独立拷贝；原配置后续修改不影响建筑与神器数值', () => {
    const source: ZCMatchConfig = structuredClone(config);
    const originalWallHp = source.rules.wallMaxHp;
    const game = new ZCGameModel(null, () => 0.1, source);
    (source.rules as any).wallMaxHp = 1;
    source.map.hexes[0].x = 999;
    const id = game.snapshot.hexes.find((hex) => game.canPlayerDevelop(hex.id))!.id;
    game.developHex(id);
    assert.equal(game.snapshot.hexes[id].wallMaxHp, originalWallHp);
});

test('敌方防御塔伤害与击杀奖励归敌方；reset 清空双向伤害和飘字', () => {
    const source: ZCMatchConfig = structuredClone(config);
    const tower: ZCDeckCard = {
        id: 'test-tower', name: '测试塔', type: ZCCardType.Tower, rarity: '绿',
        baseHp: 100, cycleSeconds: 0.05, cycleBaseValue: 99999,
    };
    source.enemyDeck = [...source.enemyDeck, tower];
    const snapshot = ZCGameModel.createInitialState(() => 0.1, source);
    const towerId = source.map.hexes[source.map.playerHomeId].neighbors[0];
    Object.assign(snapshot.hexes[towerId], {
        owner: 'enemy', building: 'tower', state: 'developed', developmentResolved: true,
        cardId: tower.id, hp: 100, maxHp: 100, tier: 1,
    });
    const victim = unit(1, 'player', towerId);
    snapshot.units = [victim]; snapshot.nextUnitId = 2;
    const game = new ZCGameModel(snapshot, () => 0.1, source);
    const beforeEnemyGold = game.snapshot.enemyGold;
    const beforePlayerGold = game.snapshot.playerGold;
    game.tick(0.05);
    assert.equal(game.damageStats.enemy.dealt, victim.hp);
    assert.equal(game.damageStats.player.taken, victim.hp);
    assert.equal(game.damageStats.player.dealt, 0);
    assert.equal(game.snapshot.enemyGold, beforeEnemyGold + source.rules.killUnitGoldReward);
    assert.equal(game.snapshot.playerGold, beforePlayerGold);
    assert.equal(game.snapshot.units[0].battleState, 'dead');
    game.reset();
    assert.deepEqual(game.damageStats, { player: { dealt: 0, taken: 0 }, enemy: { dealt: 0, taken: 0 } });
    assert.equal(game.floatTexts.length, 0);
    assert.equal(game.snapshot.units.length, 0);
});

test('单位跨格、死亡与移除同时维护索引，重复死亡不重复扣数', () => {
    const registry = new ZCUnitRegistry();
    const soldier = unit(1, 'player');
    registry.register(soldier);
    assert.equal(registry.count('player'), 1);
    registry.move(soldier, config.map.enemyHomeId);
    assert.equal(registry.byHex.has(config.map.playerHomeId), false);
    assert.equal(registry.byHex.get(config.map.enemyHomeId)?.has(soldier), true);
    registry.markDead(soldier); registry.markDead(soldier);
    assert.equal(registry.count('player'), 0);
    registry.remove(soldier);
    assert.equal(registry.byId.size, 0);
    assert.equal(registry.byHex.size, 0);
});

function captureGame(owner: 'player' | 'enemy' = 'player', ruleOverrides: Partial<ZCMatchConfig['rules']> = {}) {
    const match: ZCMatchConfig = { ...config, bonds: [],
        rules: { ...config.rules, enemyAiIntervalSeconds: 10000, ...ruleOverrides },
        units: config.units.map(definition => ({ ...definition, moveSpeed: 0 })),
    };
    const tile = config.map.hexes.find(hex => hex.playable && config.map.owners[hex.id] !== owner
        && hex.neighbors.some(id => config.map.owners[id] === owner)
        && hex.id !== config.map.playerHomeId && hex.id !== config.map.enemyHomeId)!;
    const snapshot = ZCGameModel.createInitialState(() => .1, match);
    const actor = unit(1, owner, tile.id);
    const opponent = unit(2, owner === 'player' ? 'enemy' : 'player', owner === 'player' ? config.map.enemyHomeId : config.map.playerHomeId);
    for (const soldier of [actor, opponent]) { soldier.nextAttackAt = 10000; soldier.waitUntil = 10000; soldier.battleState = 'idle'; }
    snapshot.units = [actor, opponent]; snapshot.nextUnitId = 3;
    const game = new ZCGameModel(snapshot, () => .1, match);
    const move = (id: number, hexId: number) => {
        const actor = (game as any).state.units.find((unit: ZCUnitState) => unit.id === id);
        const hex = config.map.hexes[hexId];
        actor.freeX = hex.x; actor.freeY = hex.y;
        (game as any).moveUnitToHex(actor, hexId);
    };
    const add = (id: number, unitOwner: 'player' | 'enemy', hexId = tile.id) => {
        const soldier = unit(id, unitOwner, hexId);
        soldier.nextAttackAt = 10000; soldier.waitUntil = 10000; soldier.battleState = 'idle';
        (game as any).state.units.push(soldier);
        (game as any).state.nextUnitId = Math.max((game as any).state.nextUnitId, id + 1);
        (game as any).units.register(soldier);
        return soldier;
    };
    return { game, tile, match, move, add };
}

test('单兵连续控制 0.1 秒后占领，双方规则相同', () => {
    for (const owner of ['player', 'enemy'] as const) {
        const { game, tile } = captureGame(owner);
        game.tick(.05);
        assert.notEqual(game.snapshot.hexes[tile.id].owner, owner);
        assert.equal(game.snapshot.hexes[tile.id].captureOwner, owner);
        assert.equal(game.snapshot.hexes[tile.id].captureSeconds, .05);
        game.tick(.05);
        assert.equal(game.snapshot.hexes[tile.id].owner, owner);
        assert.equal(game.snapshot.hexes[tile.id].captureOwner, null);
        assert.equal(game.snapshot.hexes[tile.id].captureSeconds, 0);
        const revision = game.terrainRevision;
        game.tick(1);
        assert.equal(game.terrainRevision, revision, '已归己方就不再重复触发');
    }
});

test('按小兵脚点轨迹双向判定经过：高速跨过中间格且落点已离开仍计入本拍控制', () => {
    const match: ZCMatchConfig = {
        ...config,
        bonds: [],
        rules: { ...config.rules, enemyAiIntervalSeconds: 10000, captureRequireSupply: false },
        units: config.units.map(definition => ({ ...definition, moveSpeed: 0 })),
    };
    const from = match.map.hexes.find(hex => hex.row === 7 && hex.column === 4)!;
    const middle = match.map.hexes.find(hex => hex.row === 6 && hex.column === 4)!;
    const to = match.map.hexes.find(hex => hex.row === 5 && hex.column === 4)!;
    assert.equal(match.map.owners[from.id], 'enemy');
    assert.equal(match.map.owners[middle.id], 'enemy');
    assert.equal(match.map.owners[to.id], 'enemy');
    for (const [start, end, direction] of [[from, to, '从下往上'], [to, from, '从上往下']] as const) {
        const snapshot = ZCGameModel.createInitialState(() => .1, match);
        const runner = unit(1, 'player', start.id);
        runner.unitId = match.units[0].unitId;
        runner.battleState = 'idle';
        snapshot.units = [runner]; snapshot.nextUnitId = 2;
        const game = new ZCGameModel(snapshot, () => .1, match);
        const system = (game as any).captureSystem;
        const state = (game as any).state;
        system.beginStep(state.units);
        state.units[0].freeX = end.x; state.units[0].freeY = end.y;
        system.update(state, .05, () => assert.fail('一拍进度不应直接完成占领'));
        assert.equal(new ZCMapGeometry(match.map).hexIdAt(state.units[0].freeX, state.units[0].freeY), end.id);
        assert.equal(state.hexes[middle.id].captureOwner, 'player', direction);
        assert.equal(state.hexes[middle.id].captureSeconds, .05, `${direction}经过中间格都应记一拍进度`);
    }
});

test('单位公共预制体以根节点为脚点，并由 VisualRoot 校准兵种美术', () => {
    const prefab = JSON.parse(readFileSync(assetPath('ui/game/ZCGameUnit.prefab'), 'utf8')) as any[];
    const root = prefab[1];
    const children = root._children.map((reference: { __id__: number }) => prefab[reference.__id__]);
    const footPoint = children.find((node: any) => node._name === 'FootPoint');
    const visualRoot = children.find((node: any) => node._name === 'VisualRoot');
    const view = prefab.find((entry: any) => entry.visualRoot && entry.healthBar);
    assert.deepEqual([root._lpos.x, root._lpos.y], [0, 0]);
    assert.deepEqual([footPoint?._lpos.x, footPoint?._lpos.y], [0, 0]);
    assert.deepEqual([visualRoot?._lpos.x, visualRoot?._lpos.y], [0, 45.7]);
    assert.equal(view?.visualRoot?.__id__, prefab.indexOf(visualRoot));
    assert.equal(view?.barOffsetY, 80);
});

test('多兵每个额外单位加速 25%，并在 2 倍封顶', () => {
    const elapsedFor = (count: number): number => {
        const { game, tile, add } = captureGame();
        for (let index = 1; index < count; index += 1) add(index + 2, 'player');
        let elapsed = 0;
        while (game.snapshot.hexes[tile.id].owner !== 'player' && elapsed < 1) {
            game.tick(.05); elapsed += .05;
        }
        return Math.round(elapsed * 100) / 100;
    };
    assert.equal(elapsedFor(1), .1);
    assert.equal(elapsedFor(2), .1, '固定步长为 0.05 秒，1.25 倍仍需两拍');
    assert.equal(elapsedFor(5), .05);
    assert.equal(elapsedFor(20), .05, '超过上限的兵力不再加速');
});

test('双方同格暂停；无人时衰减；防守方以 2 倍速度清除进度', () => {
    const { game, tile, move } = captureGame('player', { captureSeconds: .3 });
    game.tick(.15);
    assert.equal(game.snapshot.hexes[tile.id].captureSeconds, .15);
    move(2, tile.id); game.tick(.1);
    assert.equal(game.snapshot.hexes[tile.id].captureSeconds, .15, '争夺状态暂停');
    move(1, config.map.playerHomeId); game.tick(.05);
    assert.equal(game.snapshot.hexes[tile.id].captureSeconds, .05, '防守方按 2 倍速度清进度');
    game.tick(.05);
    assert.equal(game.snapshot.hexes[tile.id].captureOwner, null);

    move(2, config.map.enemyHomeId); move(1, tile.id); game.tick(.15);
    move(1, config.map.playerHomeId); game.tick(.1);
    assert.equal(game.snapshot.hexes[tile.id].captureSeconds, .05, '无人时按正常速度衰减');
});

test('敌兵死亡后不再阻挡，但剩余单位仍须完成剩余控制时间', () => {
    const { game, tile, move } = captureGame();
    move(2, tile.id); game.tick(.2);
    assert.equal(game.snapshot.hexes[tile.id].captureSeconds, 0);
    const enemy = (game as any).state.units.find((unit: ZCUnitState) => unit.id === 2);
    (game as any).damageUnit(enemy, enemy.hp, { owner: 'player', kind: 'artifact' });
    enemy.deathRemoveAt = 10000;
    game.tick(.05);
    assert.equal(game.snapshot.units.find(unit => unit.id === 2)!.battleState, 'dead');
    assert.notEqual(game.snapshot.hexes[tile.id].owner, 'player');
    game.tick(.05);
    assert.equal(game.snapshot.hexes[tile.id].owner, 'player');
});

test('没有主城连通补给时不能占领敌方腹地', () => {
    const { game, move } = captureGame();
    const deep = config.map.hexes.find(hex => hex.playable && config.map.owners[hex.id] === 'enemy'
        && hex.id !== config.map.enemyHomeId
        && hex.neighbors.every(id => config.map.owners[id] === 'enemy'))!;
    move(1, deep.id);
    game.tick(1);
    assert.equal(game.snapshot.hexes[deep.id].owner, 'enemy');
    assert.equal(game.snapshot.hexes[deep.id].captureSeconds, 0);
});

test('建筑、未破城墙和仅有旧格索引都不能推进占领；废墟可被驻留易手', () => {
    for (const kind of ['building', 'wall', 'position']) {
        const { game, tile } = captureGame();
        const state = (game as any).state.hexes[tile.id];
        const initial = state.owner;
        if (kind === 'building') { state.building = 'mine'; state.hp = 100; state.maxHp = 100; }
        if (kind === 'wall') { state.developmentResolved = true; state.wallHp = 100; state.wallMaxHp = 100; }
        if (kind === 'position') {
            const hex = config.map.hexes[config.map.playerHomeId];
            (game as any).state.units[0].freeX = hex.x; (game as any).state.units[0].freeY = hex.y;
        }
        game.tick(1.1);
        assert.equal(game.snapshot.hexes[tile.id].owner, initial, kind);
        assert.equal(game.snapshot.hexes[tile.id].captureSeconds, 0, kind);
    }
    // 废墟：建筑被摧毁后的残迹，现在可被驻留占领易手。
    {
        const { game, tile } = captureGame();
        const state = (game as any).state.hexes[tile.id];
        state.state = 'ruins';
        game.tick(1.1);
        assert.equal(game.snapshot.hexes[tile.id].owner, 'player', '废墟应被驻留占领');
        assert.notEqual(game.snapshot.hexes[tile.id].state, 'ruins', '占领后不再是废墟态');
    }
    // 废墟已归属己方时，己方小兵经过也要把废墟「激活」成占有地块（废墟图消失）。
    {
        const { game, tile } = captureGame();
        const state = (game as any).state.hexes[tile.id];
        state.state = 'ruins';
        state.owner = 'player';
        game.tick(1.1);
        assert.equal(game.snapshot.hexes[tile.id].owner, 'player');
        assert.notEqual(game.snapshot.hexes[tile.id].state, 'ruins', '己方经过也应激活废墟');
    }
});

test('占领进度可存档续算；旧存档缺字段补零；重开清空', () => {
    const { game, tile, match } = captureGame();
    game.tick(.05);
    const saved = game.exportSnapshot();
    const restored = new ZCGameModel(saved, () => .1, match);
    assert.equal(restored.snapshot.hexes[tile.id].captureSeconds, .05);
    restored.tick(.05);
    assert.equal(restored.snapshot.hexes[tile.id].owner, 'player');
    const older = game.exportSnapshot();
    for (const hex of older.hexes) { delete (hex as any).captureOwner; delete (hex as any).captureSeconds; }
    assert.ok(new ZCGameModel(older, () => .1, match).snapshot.hexes.every(hex => hex.captureOwner === null && hex.captureSeconds === 0));
    game.reset(); assert.ok(game.snapshot.hexes.every(hex => hex.captureOwner === null && hex.captureSeconds === 0));
});

test('已消费的空地易手后不能重新开发或重复抽卡', () => {
    const { game, tile } = captureGame();
    const state = (game as any).state.hexes[tile.id];
    state.developmentResolved = true;
    state.state = 'developed';
    game.tick(.1);
    assert.equal(game.snapshot.hexes[tile.id].owner, 'player');
    assert.equal(game.snapshot.hexes[tile.id].developmentResolved, true);
    assert.equal(game.canPlayerDevelop(tile.id), false);
});

test('占领存档字段拒绝非法阵营、负进度、过大进度和无阵营的非零进度', () => {
    const { game, tile, match } = captureGame();
    game.tick(.05);
    const mutations: Array<(hex: ZCHexState) => void> = [
        hex => { (hex as any).captureOwner = 'neutral'; }, hex => { hex.captureSeconds = -1; },
        hex => { hex.captureSeconds = 1.1; }, hex => { hex.captureOwner = null; hex.captureSeconds = .5; },
    ];
    for (const mutate of mutations) {
        const snapshot = game.exportSnapshot(); mutate(snapshot.hexes[tile.id]);
        assert.equal(ZCGameModel.isValidSnapshot(snapshot, match), false);
        assert.throws(() => new ZCGameModel(snapshot, () => .1, match), /无效对局快照/);
    }
});

test('缓存的索敌目标在破墙、摧毁建筑和重开对局后立即更新', () => {
    const snapshot = ZCGameModel.createInitialState(() => .1, config);
    snapshot.units = [unit(1, 'player', config.map.enemyHomeId)];
    snapshot.nextUnitId = 2;
    const game = new ZCGameModel(snapshot, () => .1, config);
    const actor = (game as any).state.units[0];
    const wall = (game as any).state.hexes[config.map.enemyHomeId];
    (game as any).unitTargeting.acquire(actor);
    assert.equal(actor.targetWallHexId, wall.id);
    const originalRevision = game.terrainRevision;
    (game as any).damageWall(actor, wall, wall.wallHp / 2);
    assert.equal(game.terrainRevision, originalRevision);
    (game as any).damageWall(actor, wall, wall.wallHp);
    assert.equal(game.terrainRevision, originalRevision + 1);
    (game as any).unitTargeting.acquire(actor);
    assert.equal(actor.targetWallHexId, null);
    assert.equal(actor.targetBuildingHexId, wall.id);
    (game as any).damageBuilding(actor, wall, wall.hp);
    (game as any).unitTargeting.acquire(actor);
    assert.equal(actor.targetBuildingHexId, null);
    game.reset();
    (game as any).unitTargeting.acquire(actor);
    assert.equal(actor.targetWallHexId, config.map.enemyHomeId);
});

test('地图坐标查询覆盖所有格心、棋盘外和水域，水域不吸附到邻格', () => {
    const geometry = new ZCMapGeometry(config.map);
    for (const hex of config.map.hexes) assert.equal(geometry.hexIdAt(hex.x, hex.y), hex.id);
    assert.equal(geometry.hexIdAt(1e6, 0), null);
    assert.equal(geometry.hexIdAt(0, 1e6), null);
    assert.equal(geometry.hexIdAt(NaN, 0), null);
    const map = structuredClone(config.map);
    const water = map.hexes[config.map.playerHomeId];
    water.playable = false;
    assert.equal(new ZCMapGeometry(map).hexIdAt(water.x, water.y), null);
    const edge = map.hexes[0];
    assert.equal(new ZCMapGeometry(map).hexIdAt(edge.x - 36, edge.y), null);
});
