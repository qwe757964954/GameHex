import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ZCGameModel } from '../assets/script/app/zcds/model/ZCGameModel';
import { configureZCMap } from '../assets/script/app/zcds/model/ZCMapConfig';
import { loadPvpTables, ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { captureZCMatchConfig, ZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import type { ZCCompiledModifierLoadout } from '../assets/script/app/zcds/model/ZCModifierRuntime';
import type { ZCCombatTarget, ZCProjectileState, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import { sweptCircleHit, ZCProjectileSystem } from '../assets/script/app/zcds/model/systems/ZCProjectileSystem';
import { ZCAttackResolutionSystem } from '../assets/script/app/zcds/model/systems/ZCAttackResolutionSystem';
import { ZCGroundZoneSystem } from '../assets/script/app/zcds/model/systems/ZCGroundZoneSystem';
import { loadViews } from './helpers/zcds-view-fixtures';

//  `pvpUnit` 已于 2026-09-20 并入 `pvpCard`（单位列内联、加 `unit` 前缀），表已下线。
const names = ['pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond', 'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams', 'pvpBaseTeamWeight'];
const tables = Object.fromEntries(names.map(name => {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8'));
    return [name, Array.isArray(source) ? source : source.v.map((row: unknown[]) => Object.fromEntries(source.k.map((key: string, i: number) => [key, row[i]])))];
})) as unknown as ZCPvpTables;
loadPvpTables(tables);
configureZCMap(JSON.parse(readFileSync('tests/fixtures/zcds-legacy-map.json', 'utf8')));
const captured = captureZCMatchConfig();
const config: ZCMatchConfig = {
    ...captured,
    rules: { ...captured.rules, combatDistanceScale: 1, combatDamageMultiplier: 1, enemyAiIntervalSeconds: 10000 },
    units: captured.units.map(definition => ({ ...definition, maxHp: 1000, moveSpeed: 0, bodyRadius: 4,
        attack: 100, attackProfile: { ...definition.attackProfile, mode: 'projectile', projectileSpeed: 100, collisionRadius: 1 },
    })),
};
const definition = config.units.find(definition => !definition.flying)!;

function unit(id: number, owner: 'player' | 'enemy', x: number, y = 0): ZCUnitState {
    return {
        id, owner, unitId: definition.unitId, cardId: 'test', tier: 1, sourceHexId: config.map.playerHomeId,
        targetHexId: null, progress: 0, hp: 1000, maxHp: 1000, battleState: 'idle', stateTime: 0,
        targetUnitId: null, targetWallHexId: null, targetBuildingHexId: null, nextAttackAt: 10000, waitUntil: 10000,
        attackHitDone: false, hatredUnitId: null, hatredUntil: 0, facingRadians: 0, deathRemoveAt: 0,
        marchAngle: null, freeX: x, freeY: y, completedAttackCount: 0,
    };
}

function game(units = [unit(1, 'player', -80), unit(2, 'enemy', 40)], match = config) {
    const snapshot = ZCGameModel.createInitialState(() => .1, match);
    snapshot.units = units;
    snapshot.nextUnitId = Math.max(...units.map(unit => unit.id)) + 1;
    return new ZCGameModel(snapshot, () => .1, match);
}

function launch(model: ZCGameModel, sourceId = 1, targetId = 2) {
    const source = (model as any).state.units.find((unit: ZCUnitState) => unit.id === sourceId);
    source.targetUnitId = targetId;
    (model as any).sendAttack(source);
    return model.snapshot.projectiles[model.snapshot.projectiles.length - 1];
}

test('远程出手不扣血，在途状态存在，命中后移除弹道并产生命中特效', () => {
    const model = game();
    launch(model);
    assert.equal(model.snapshot.units[1].hp, 1000);
    assert.equal(model.snapshot.projectiles.length, 1);
    assert.equal(model.snapshot.combatEvents.length, 0);
    model.tick(.5);
    assert.equal(model.snapshot.units[1].hp, 1000);
    assert.ok(model.snapshot.projectiles[0].x > -80);
    for (let step = 0; step < 20 && model.snapshot.projectiles.length; step++) model.tick(.05);
    assert.equal(model.snapshot.projectiles.length, 0);
    assert.ok(model.snapshot.units[1].hp < 1000);
    assert.equal(model.snapshot.combatEvents.at(-1)?.effectKey, 'hit');
    assert.equal(model.snapshot.combatEvents.at(-1)?.targetUnitId, 2);
});

test('本局文本攻击模式覆盖使远程攻击直接结算', () => {
    const loadout: ZCCompiledModifierLoadout = {
        sourceKey: 'test:text', sourceKind: 'skill', targetUnitId: definition.unitId,
        appliedModifierIds: [31], rawAttributes: {}, statPatch: {}, typedModifiers: [],
        textModifiers: [{ sourceId: 31, targetUnitId: definition.unitId,
            skillId: definition.attackProfile.skillId, statId: 'attackType', value: 'melee', priority: 100 }],
        skillPlans: [], breakdown: [], effects: [], unsupportedAttributes: [], configHash: 'test',
    };
    const match: ZCMatchConfig = { ...config, modifiers: { player: [loadout] } };
    const model = game([unit(1, 'player', -80), unit(2, 'enemy', 40)], match);
    launch(model);
    assert.equal(model.snapshot.projectiles.length, 0);
    assert.ok(model.snapshot.units[1].hp < 1000);
    assert.equal(model.snapshot.combatEvents.at(-1)?.type, 'melee');
});

test('同拍穿过多个小兵只命中沿轨迹最先碰到的敌人，忽略友军', () => {
    const fast = { ...config, units: config.units.map(def => ({ ...def, attackProfile: { ...def.attackProfile, projectileSpeed: 10000 } })) };
    const model = game([unit(1, 'player', -80), unit(2, 'enemy', 40), unit(3, 'enemy', -20), unit(4, 'enemy', -50), unit(5, 'player', -70)], fast);
    launch(model);
    model.tick(.05);
    assert.ok(model.snapshot.units.find(unit => unit.id === 4)!.hp < 1000);
    for (const id of [2, 3, 5]) assert.equal(model.snapshot.units.find(unit => unit.id === id)!.hp, 1000);
    assert.equal(model.snapshot.projectiles.length, 0);
});

test('目标离开直线弹道后可以躲避，飞到终点过期不会补扣锁定目标血量', () => {
    const model = game();
    launch(model);
    (model as any).state.units[1].freeY = 100;
    model.tick(1.3);
    assert.equal(model.snapshot.units.find(unit => unit.id === 2)!.hp, 1000);
    assert.equal(model.snapshot.projectiles.length, 0);
    assert.equal(model.damageStats.player.dealt, 0);
});

test('攻击者死亡并被移除后子弹仍命中，击杀奖励和伤害统计归发射方', () => {
    const enemy = unit(2, 'enemy', 40); enemy.hp = 1;
    const model = game([unit(1, 'player', -80), enemy]);
    launch(model);
    const source = (model as any).state.units[0];
    (model as any).damageUnit(source, source.hp, { owner: 'enemy', kind: 'artifact' });
    model.tick(.6);
    assert.equal(model.snapshot.units.some(unit => unit.id === 1), false);
    assert.equal(model.snapshot.projectiles.length, 1);
    const before = model.snapshot.playerGold;
    for (let step = 0; step < 20 && model.snapshot.projectiles.length; step++) model.tick(.05);
    assert.equal(model.damageStats.player.dealt, 1);
    assert.equal(model.snapshot.playerGold, before + config.rules.killUnitGoldReward);
});

test('在途子弹独立导出并恢复；旧存档补空数组，重开对局清空弹道', () => {
    const model = game();
    launch(model); model.tick(.225);
    const snapshot = model.exportSnapshot();
    assert.equal(snapshot.projectiles.length, 1);
    assert.equal(snapshot.combatEvents.length, 0);
    const restored = new ZCGameModel(snapshot, () => .1, config);
    snapshot.projectiles[0].x = 999;
    assert.notEqual(model.snapshot.projectiles[0].x, 999);
    assert.notEqual(restored.snapshot.projectiles[0].x, 999);
    for (let step = 0; step < 25; step++) { model.tick(.05); restored.tick(.05); }
    assert.deepEqual(restored.exportSnapshot(), model.exportSnapshot());
    assert.deepEqual(restored.damageStats, model.damageStats);
    const legacy = model.exportSnapshot();
    delete (legacy as any).projectiles;
    assert.deepEqual(new ZCGameModel(legacy, () => .1, config).snapshot.projectiles, []);
    model.reset();
    assert.deepEqual(model.snapshot.projectiles, []);
});

test('在途子弹快照拒绝重复 ID、非法半径、零速度、无效目标和计数器冲突', () => {
    const model = game(); launch(model);
    const mutations: Array<(snapshot: ReturnType<typeof model.exportSnapshot>) => void> = [
        s => { s.projectiles.push({ ...s.projectiles[0] }); },
        s => { s.projectiles[0].collisionRadius = -1; },
        s => { s.projectiles[0].velocityX = 0; s.projectiles[0].velocityY = 0; },
        s => { s.projectiles[0].targetId = 10000; },
        s => { s.projectiles[0].x = NaN; },
        s => { s.projectiles[0].durationSeconds = 0; },
        s => { s.nextCombatEventId = s.projectiles[0].id; },
    ];
    for (const mutate of mutations) {
        const snapshot = model.exportSnapshot(); mutate(snapshot);
        assert.equal(ZCGameModel.isValidSnapshot(snapshot, config), false);
        assert.throws(() => new ZCGameModel(snapshot, () => .1, config), /无效对局快照/);
    }
});

test('伤害冻结出手属性，克制系数按实际拦截者计算', () => {
    const match: ZCMatchConfig = { ...config, bonds: [],
        playerDeck: [{ ...config.playerDeck[0], id: 'source', traits: { attack: '射手', camp: '花果' } }],
        enemyDeck: [
            { ...config.enemyDeck[0], id: 'target', traits: { attack: '坦克', camp: '花果' } },
            { ...config.enemyDeck[0], id: 'blocker', traits: { attack: '法师', camp: '花果' } },
        ],
        counters: [
            { trait: 'attack', attacker: '射手', defender: '坦克', damageMultiplier: 2 },
            { trait: 'attack', attacker: '射手', defender: '法师', damageMultiplier: 3 },
        ],
    };
    const source = unit(1, 'player', -80); source.cardId = 'source';
    const target = unit(2, 'enemy', 40); target.cardId = 'target';
    const blocker = unit(3, 'enemy', -30); blocker.cardId = 'blocker';
    const model = game([source, target, blocker], match);
    const shot = launch(model);
    assert.equal(shot.damage, 200);
    (model as any).state.units[0].tier = 4;
    model.tick(.5);
    assert.equal(model.snapshot.units.find(unit => unit.id === 3)!.hp, 700);
    assert.equal(model.snapshot.units.find(unit => unit.id === 2)!.hp, 1000);
    assert.equal(model.damageStats.player.dealt, 300);
});

test('本拍出手的子弹下一拍才移动，不多推进一个逻辑步', () => {
    const source = unit(1, 'player', -80);
    source.battleState = 'attack'; source.stateTime = definition.attackHitTime;
    source.targetUnitId = 2;
    const model = game([source, unit(2, 'enemy', 40)]);
    model.tick(.05);
    assert.equal(model.snapshot.projectiles.length, 1);
    assert.equal(model.snapshot.projectiles[0].x, -80);
    assert.equal(model.snapshot.projectiles[0].startedAt, .05);
    model.tick(.05);
    assert.equal(model.snapshot.projectiles[0].x, -75);
});

test('同一远程战局在不同帧率下弹道、命中和伤害结果相同', () => {
    const slow = game(), fast = game(); launch(slow); launch(fast);
    for (let step = 0; step < 15; step++) slow.tick(.1);
    for (let step = 0; step < 150; step++) fast.tick(.01);
    assert.deepEqual(fast.exportSnapshot(), slow.exportSnapshot());
    assert.deepEqual(fast.damageStats, slow.damageStats);
    assert.deepEqual(fast.floatTexts, slow.floatTexts);
    assert.deepEqual(fast.snapshot.combatEvents, slow.snapshot.combatEvents);
});

function projectile(overrides: Partial<ZCProjectileState> = {}): ZCProjectileState {
    return {
        id: 1, type: 'projectile', owner: 'player', sourceUnitId: 1, targetUnitId: 2, targetKind: 'unit', targetId: 2,
        sourceCardId: 'test', skillId: 1, skillName: 'test', effectKey: null, projectileKey: null,
        fromX: 0, fromY: 0, toX: 100, toY: 0, x: 0, y: 0, previousX: 0, previousY: 0,
        velocityX: 2000, velocityY: 0, radius: 0, collisionRadius: 1, baseDamage: 10, damage: 10,
        canHitAir: false, empowered: false, startedAt: 0, durationSeconds: .05, ...overrides,
    };
}

test('小兵一拍内从弹道上方穿到下方，双方相对运动仍检测到接触', () => {
    const system = new ZCProjectileSystem();
    const enemy = unit(2, 'enemy', 50, -50);
    system.beginStep([enemy]);
    enemy.freeY = 50;
    const shots = [projectile()];
    const hits: ZCCombatTarget[] = [];
    system.update(shots, .05, { now: .05, units: [enemy], distanceScale: 1, definition: () => definition, structureTarget: () => null, hit: (_shot, target) => hits.push(target) });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].id, 2);
    assert.equal(shots.length, 0);
});

test('空气攻击过滤和同位置 ID 平局稳定，已死单位不能阻挡后续子弹', () => {
    const flying = unit(2, 'enemy', 20), dead = unit(3, 'enemy', 30), ground = unit(4, 'enemy', 60), tied = unit(5, 'enemy', 60);
    dead.hp = 0; dead.battleState = 'dead';
    const units = [tied, flying, dead, ground];
    const run = (canHitAir: boolean) => {
        const system = new ZCProjectileSystem(); system.beginStep(units);
        const shots = [projectile({ canHitAir })]; let id: number | null = null;
        system.update(shots, .05, { now: .05, units, distanceScale: 1, definition: unit => ({ ...definition, flying: unit.id === 2 }), structureTarget: () => null, hit: (_shot, target) => { id = target.id; } });
        return id;
    };
    assert.equal(run(false), 4);
    assert.equal(run(true), 2);
});

test('piercing projectile hits distinct enemies in deterministic order and survives the configured extra hits', () => {
    const first = unit(2, 'enemy', 20), second = unit(3, 'enemy', 60);
    const system = new ZCProjectileSystem();
    system.beginStep([first, second]);
    const shots = [projectile({ durationSeconds: .15, remainingPierces: 1, hitUnitIds: [] })];
    const hits: number[] = [];
    const context = {
        now: .05, units: [second, first], distanceScale: 1, definition: () => definition,
        structureTarget: () => null,
        hit: (_shot: ZCProjectileState, target: ZCCombatTarget) => hits.push(target.id),
    };
    system.update(shots, .05, context);
    assert.deepEqual(hits, [2]);
    assert.equal(shots.length, 1);
    assert.deepEqual(shots[0].hitUnitIds, [2]);
    context.now = .1;
    system.beginStep([first, second]);
    system.update(shots, .05, context);
    assert.deepEqual(hits, [2, 3]);
    assert.equal(shots.length, 0);
});

test('shield absorbs damage without stacking and remains snapshot-safe', () => {
    const source = unit(1, 'player', 0), ally = unit(2, 'player', 10), enemy = unit(3, 'enemy', 20);
    const model = game([source, ally, enemy]);
    ZCAttackResolutionSystem.applyShieldAura((model as any).state, (model as any).state.units[0], .2);
    const protectedUnit = (model as any).state.units[1] as ZCUnitState;
    assert.equal(protectedUnit.shield, 200);
    (model as any).damageUnit(protectedUnit, 150, { owner: 'enemy', kind: 'unit', unitId: 3 });
    assert.equal(protectedUnit.hp, 1000);
    assert.equal(protectedUnit.shield, 50);
    (model as any).damageUnit(protectedUnit, 75, { owner: 'enemy', kind: 'unit', unitId: 3 });
    assert.equal(protectedUnit.hp, 975);
    assert.equal(protectedUnit.shield, 0);
    assert.equal(ZCGameModel.isValidSnapshot(model.exportSnapshot(), config), true);
});

test('haste and banner statuses use deterministic selection and configured critical values', () => {
    const model = game([unit(1, 'player', 0), unit(2, 'player', 10), unit(3, 'enemy', 20)]);
    ZCAttackResolutionSystem.applyMoveSpeedAura((model as any).state, 'player', .5, 5,
        (model as any).attackResolutionContext);
    ZCAttackResolutionSystem.applyBannerBuff((model as any).state, 'player', 1, .3,
        (model as any).attackResolutionContext);
    const statuses = (model as any).statusSystem;
    assert.equal(statuses.statModsOf('1').moveSpeedPct, 50);
    assert.equal(statuses.statModsOf('1').critPct, 30);
    assert.equal(statuses.statModsOf('1').critDamagePct, 30);
    assert.equal(statuses.statModsOf('2').critPct ?? 0, 0);
    assert.equal(ZCAttackResolutionSystem.criticalMultiplier((model as any).state.units[0], (model as any).attackResolutionContext), 1.3);
    const restored = new ZCGameModel(model.exportSnapshot(), () => .1, config);
    assert.equal((restored as any).statusSystem.statModsOf('1').moveSpeedPct, 50);
    assert.equal((restored as any).statusSystem.statModsOf('1').critPct, 30);
});

test('multi-direction skill damages each unit on a radial ray once and misses units between rays', () => {
    const source = unit(1, 'player', 0), east = unit(2, 'enemy', 40), north = unit(3, 'enemy', 0, 40), diagonal = unit(4, 'enemy', 30, 30);
    source.facingRadians = 0;
    const model = game([source, east, north, diagonal]);
    const event = {
        id: 1, type: 'area', owner: 'player', sourceUnitId: 1, targetUnitId: 2,
        skillId: 1, skillName: 'radial', effectKey: null, projectileKey: null,
        fromX: 0, fromY: 0, toX: 40, toY: 0, radius: 0, damage: 100,
        empowered: true, startedAt: 0, durationSeconds: 0,
    } as const;
    ZCAttackResolutionSystem.resolveRadialSkill((model as any).state, (model as any).state.units[0], event,
        100, 4, undefined, [], 'damage', (model as any).attackResolutionContext);
    const hp = Object.fromEntries(model.snapshot.units.map((entry) => [entry.id, entry.hp]));
    assert.equal(hp[2], 900);
    assert.equal(hp[3], 900);
    assert.equal(hp[4], 1000);
});

test('projectile impact and persistent explosion use their separate configured damage values', () => {
    const model = game([unit(1, 'player', 0), unit(2, 'enemy', 20)]);
    const shot = projectile({ sourceUnitId: 1, targetId: 2, targetUnitId: 2, baseDamage: 100, zoneDamage: 250, zoneDuration: 6, zoneWaves: 6, radius: 60 });
    (model as any).resolveProjectileHit(shot, { kind: 'unit', id: 2, x: 20, y: 0, bodyRadius: 4, cardId: 'test' });
    assert.equal(model.snapshot.units[1].hp, 900);
    assert.equal(model.snapshot.groundZones.length, 1);
    assert.equal(model.snapshot.groundZones[0].damage, 250);
});

test('ground-zone expiry deals its own damage and applies per-instance freeze duration', () => {
    const center = config.map.hexes[config.map.playerHomeId];
    const model = game([unit(1, 'player', center.x, center.y), unit(2, 'enemy', center.x, center.y)]);
    (model as any).statusSystem.register({ id: 'freeze', name: 'freeze', durationSeconds: 3, control: 'freeze', behavior: { kind: 'none' } });
    (model as any).state.groundZones.push({
        x: center.x, y: center.y, radius: 60, owner: 'player', sourceUnitId: 1,
        skillId: 36201, skillName: 'ice', remainingSeconds: 0, wavesLeft: 0,
        nextWaveAt: 0, waveInterval: 1, damage: 0, slowRatio: 0,
        expireDamage: 200, expireStatusId: 'freeze', expireStatusDuration: 2,
    });
    ZCGroundZoneSystem.tick((model as any).state, 0, (model as any).groundZoneContext);
    assert.equal(model.snapshot.units[1].hp, 800);
    const freeze = model.snapshot.statusEffects?.units.flatMap((entry) => entry.instances).find((entry) => entry.defId === 'freeze');
    assert.equal(freeze?.remainingSeconds, 2);
});

test('短于一拍的弹道停在射程终点，超长扫掠回退候选查询仍正确命中', () => {
    const enemy = unit(2, 'enemy', 110);
    const system = new ZCProjectileSystem(); system.beginStep([enemy]);
    const shot = projectile({ velocityX: 10000, durationSeconds: .01 });
    const shots = [shot]; let hits = 0;
    const context = { now: .05, units: [enemy], distanceScale: 1, definition: () => definition, structureTarget: () => null, hit: () => hits++ };
    system.update(shots, .05, context);
    assert.equal(hits, 0); assert.equal(shots.length, 0); assert.equal(shot.x, 100);
    enemy.freeX = 500000;
    system.beginStep([enemy]);
    const long = [projectile({ velocityX: 20000000 })];
    system.update(long, .05, context);
    assert.equal(hits, 1); assert.equal(long.length, 0);
});

test('撞墙仅扣墙血，破墙后新弹道可以命中建筑，前方小兵可拦截建筑攻击', () => {
    const center = config.map.hexes[config.map.enemyHomeId];
    const match = { ...config, rules: { ...config.rules, combatDistanceScale: .3 } };
    const model = game([unit(1, 'player', center.x - 100, center.y)], match);
    const state = (model as any).state, source = state.units[0], wall = state.hexes[center.id];
    wall.wallHp = 1;
    source.targetWallHexId = wall.id;
    (model as any).sendAttack(source);
    const originalHp = wall.hp;
    for (let step = 0; step < 20 && model.snapshot.projectiles.length; step++) model.tick(.05);
    assert.equal(wall.wallHp, 0); assert.equal(wall.hp, originalHp);
    source.targetWallHexId = null; source.targetBuildingHexId = wall.id;
    (model as any).sendAttack(source);
    for (let step = 0; step < 20 && model.snapshot.projectiles.length; step++) model.tick(.05);
    assert.ok(wall.hp < originalHp);
    const blocked = game([unit(1, 'player', center.x - 100, center.y), unit(2, 'enemy', center.x - 50, center.y)], match);
    const actor = (blocked as any).state.units[0]; actor.targetWallHexId = center.id;
    const before = blocked.snapshot.hexes[center.id].wallHp;
    (blocked as any).sendAttack(actor);
    for (let step = 0; step < 20 && blocked.snapshot.projectiles.length; step++) blocked.tick(.05);
    assert.equal(blocked.snapshot.hexes[center.id].wallHp, before);
    assert.ok(blocked.snapshot.units[1].hp < 1000);
});

test('连续碰撞涵盖起点重叠、擦边、零移动及高速跨过，不命中反方向圆', () => {
    const origin = { x: 0, y: 0 };
    assert.equal(sweptCircleHit(origin, origin, origin, 1), 0);
    assert.equal(sweptCircleHit(origin, origin, { x: 10, y: 0 }, 1), null);
    assert.equal(sweptCircleHit(origin, { x: 100, y: 0 }, { x: 50, y: 5 }, 5), .5);
    assert.equal(sweptCircleHit(origin, { x: 100, y: 0 }, { x: -20, y: 0 }, 5), null);
    assert.equal(sweptCircleHit(origin, { x: 100, y: 0 }, { x: 50, y: 0 }, 5), .45);
});

test('渲染使用逻辑弹道插值，碰撞移除后回收节点，单位显示中心等于逻辑中心', () => {
    const { load, FakeNode } = loadViews();
    const world = new (load('./ZCGameRenderWorld').ZCGameRenderWorld)({ mapLayer: new FakeNode(), effectPrefab: { make: () => {
        const node = new FakeNode(); node.getComponent = (() => ({ initialize() {}, render: (...args: any[]) => { rendered = args; } })) as any; return node;
    } }, effectVisualPrefabs: new Map() });
    let rendered: any[] = [];
    const shot = projectile({ previousX: 20, x: 30 });
    const model = { snapshot: { combatEvents: [], projectiles: [shot], status: 'playing', elapsedSeconds: .05, pendingSeconds: .025 } };
    world.renderEffectSystem(model);
    assert.equal(rendered[2], shot); assert.equal(rendered[3], .5);
    const node = [...world.scene.values()][0].node;
    model.snapshot.projectiles = []; world.renderEffectSystem(model);
    assert.equal(node.active, false);
    const view = new (load('./ZCCombatEffectView').ZCCombatEffectView)();
    view.spriteNode = new FakeNode(); view.sprite = {};
    view.graphics = { clear() {}, moveTo() {}, lineTo() {}, stroke() {} };
    view.render(shot, 999, shot, .5);
    assert.equal(view.node.position.x, load('./ZCGameViewUtil').mapToViewX(25));
    for (let id = 1; id < 10; id++) {
        const position = world.unitPosition(unit(id, 'enemy', 40, 20));
        assert.equal(position.x, 40); assert.equal(position.y, 20);
    }
});
