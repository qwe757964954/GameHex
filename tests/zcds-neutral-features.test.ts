import { hexGridDistance } from '../assets/script/core/hex/HexGridLayout';
import { ZC_RUNTIME_CONFIG } from '../assets/script/app/zcds/model/ZCRuntimeConfigStore';
import assert from 'node:assert/strict';
import test from 'node:test';
import { compileZCNeutralResourceCatalog } from '../assets/script/app/zcds/model/ZCNeutralResourceGroup';
import { readFileSync, readdirSync } from 'node:fs';
import { neutralResourceItemOf } from '../assets/script/app/zcds/model/ZCNeutralResourceGroup';
import { ZCNeutralFeatureSystem, isZCAwakeMonster, zcMonsterPosition } from '../assets/script/app/zcds/model/systems/ZCNeutralFeatureSystem';
import { ZCSnapshotCodec } from '../assets/script/app/zcds/model/ZCSnapshotCodec';
import { ZCPvpTileType } from '../assets/script/app/zcds/model/ZCPvpTileRules';
import { captureZCMatchConfig, withZCGeneralStarSelections } from '../assets/script/app/zcds/model/ZCMatchConfig';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { ZCGameModel, configureZCMap } from '../assets/script/app/zcds/model/ZCGameModel';
import { findCatalogCard } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import type { ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import { ZCTileSystem } from '../assets/script/app/zcds/model/systems/ZCTileSystem';
import { ZCEconomySystem } from '../assets/script/app/zcds/model/systems/ZCEconomySystem';
import { ZCCaptureSystem } from '../assets/script/app/zcds/model/systems/ZCCaptureSystem';
import { resolveZCMapResources, resolveZCSpawnMatchConfig, ZCSpawnSelection } from '../assets/script/app/zcds/model/ZCSpawnSelection';
import type { ZCCombatTarget, ZCProjectileState, ZCHexState, ZCSnapshot } from '../assets/script/app/zcds/model/ZCGameTypes';
import type { ZCDamageSource } from '../assets/script/app/zcds/model/ZCGameTypes';
import type { ZCStatusSystem } from '../assets/script/app/zcds/model/ZCStatusEffect';
import type { ZCUnitDefinition } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import { ZCMapGeometry } from '../assets/script/app/zcds/model/ZCMapGeometry';
import { ZC_PORTAL_FLIGHT_SECONDS } from '../assets/script/app/zcds/model/ZCBattlePresentationQueue';
import type { ZCEconomyContext } from '../assets/script/app/zcds/model/systems/ZCEconomySystem';

const names = ['pvpGlobal', 'pvpArtifact', 'pvpCard', 'monsterCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams', 'neutralResourceGroup', 'neutralEnhanceGate', 'skillAttrModifier', 'generalStar'];
const tables = Object.fromEntries(names.map(name => {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8'));
    return [name, Array.isArray(source) ? source : source.v.map((row: unknown[]) =>
        Object.fromEntries(source.k.map((key: string, index: number) => [key, row[index]])))];
})) as unknown as ZCPvpTables;
loadPvpTables(tables);
const gateParam = { effect: 'add', mode: 'fixed', value: 2, cooldownSeconds: 1, windowSeconds: 0.2,
    scale: 3, hpFlat: 1000, moveMultiplier: 2, attackSpeedMultiplier: 2, damageMultiplier: 0.5 };

test('焦点怪物闸门缓存按地形失效，覆盖唤醒、死亡与初始化恢复', () => {
    const { system, state, hex } = fixture(11, { resId: '68001', wakeRange: 3, reviveRate: 0.5 });
    assert.equal(system.hasFocusableMonster(), false);
    hex.neutralFeature.awake = true;
    system.invalidateTerrain();
    assert.equal(system.hasFocusableMonster(), true);
    hex.hp = 0;
    system.invalidateTerrain();
    assert.equal(system.hasFocusableMonster(), false);
    hex.hp = hex.maxHp;
    system.initialize(state);
    assert.equal(system.hasFocusableMonster(), true);
});

test('追击与脱战名单随快照往返，旧快照可读，非法新字段被拦截', () => {
    const f = fixture();
    f.state.units = [f.unit(1), f.unit(2, 'enemy')];
    f.state.nextUnitId = 3;
    f.state.elapsedSeconds = 6;
    const soldier = f.state.units[0];
    soldier.chase = { x: -10, y: 20, startedAt: 1 };
    soldier.disengagedUnitIds = [2];
    const decoded = ZCSnapshotCodec.decode(f.state, f.config);
    assert.equal(decoded.ok, true, JSON.stringify(decoded));
    if (decoded.ok) {
        assert.deepEqual(decoded.snapshot.units[0].chase, soldier.chase);
        assert.deepEqual(decoded.snapshot.units[0].disengagedUnitIds, [2]);
    }
    for (const chase of [{ x: NaN, y: 0, startedAt: 1 }, { x: 0, y: 0, startedAt: 7 }]) {
        soldier.chase = chase;
        assert.ok(ZCSnapshotCodec.errors(f.state, f.config).some(error => error.includes('.chase.')));
    }
    delete soldier.chase;
    for (const ids of [[0], [1], [2, 2], [-1], [1.5]]) {
        soldier.disengagedUnitIds = ids;
        assert.ok(ZCSnapshotCodec.errors(f.state, f.config).some(error => error.includes('.disengagedUnitIds')));
    }
    delete soldier.disengagedUnitIds;
    assert.equal(ZCSnapshotCodec.decode(f.state, f.config).ok, true);
});

test('常规随机池每张地图都投放趣味资源，源预设与发布资源一致并进入开局快照', () => {
    loadPvpTables(tables);
    for (const file of readdirSync('assets/resources/config/maps').filter(file => file.endsWith('.json'))) {
        const layout = JSON.parse(readFileSync(`assets/resources/config/maps/${file}`, 'utf8'));
        assert.deepEqual(layout, JSON.parse(readFileSync(`tools/map-editor/presets/gamemap/${file}`, 'utf8')), file);
        configureZCMap(layout);
        const base = captureZCMatchConfig(undefined, { allowUnresolvedSelect: true });
        let config = base;
        if (base.map.cityMode === 'select') {
            const selection = new ZCSpawnSelection(base.map, () => 0);
            selection.tick(10);
            assert.ok(selection.result, `${file} 无法完成主城选点`);
            config = resolveZCSpawnMatchConfig(base, selection.result);
        } else config = { ...base, map: { ...base.map, resolvedResources: resolveZCMapResources(base.map, () => 0) } };
        const resolvedResources = config.map.resolvedResources;
        const types = resolvedResources.map(item => neutralResourceItemOf(item.itemId).resourceType);
        for (const type of [7, 8, 10, 11]) assert.ok(types.includes(type), `${file} 未投放类型 ${type}`);
        if ((layout.playerCount ?? 2) === 2) assert.ok(types.filter(type => type === 9).length >= 4, `${file} 需有双方可争夺的四座门`);
        else assert.equal(types.includes(9), false, `${file} 多人局不投放传送门`);
        const model = new ZCGameModel(undefined, () => 0, config);
        assert.ok(model.snapshot.hexes.some(hex => hex.neutralFeature?.effect), `${file} 开局缺少强化门`);
        assert.ok(model.snapshot.hexes.some(hex => typeof hex.neutralFeature?.awake === 'boolean' && hex.hp > 0), `${file} 开局缺少野怪`);
    }
});

function fixture(type = 7, param: Record<string, unknown> = gateParam, activateGate = true, patrol = false) {
    loadPvpTables(tables);
    configureZCMap(JSON.parse(readFileSync('assets/resources/config/maps/normal.json', 'utf8')));
    const base = captureZCMatchConfig();
    const card = findCatalogCard('68001');
    const effects = param.mode === 'random' ? ['add', 'multiply', 'enlarge', 'shrink'] : [param.effect];
    const gates = effects.map((effect, index) => ({ id: index + 1, name: effect, effectType: ['add', 'multiply', 'enlarge', 'shrink'].indexOf(effect) + 1,
        value: param.value, cooldownSeconds: param.cooldownSeconds, windowSeconds: param.windowSeconds,
        scale: effect === 'shrink' ? 1 / Number(param.scale) : param.scale, hpRate: 11,
        moveMultiplier: param.moveMultiplier, attackSpeedMultiplier: param.attackSpeedMultiplier, damageMultiplier: param.damageMultiplier }));
    const featureParam = type === 7 ? { gateIds: gates.map(gate => gate.id) }
        : type === 8 ? { damageRate: 1, speed: 2, ...param }
        : type === 9 ? { range: 6, uses: 3, cooldownSeconds: 8, ...param } : param;
    ZC_RUNTIME_CONFIG.updateCatalogs({ neutralResources: compileZCNeutralResourceCatalog([
        { groupId: 14001, id: 1400101, groupName: '测试资源', resourceType: type, weight: 10000, param: featureParam },
    ], new Map([[card.id, card]]), gates) });
    const config = { ...base, map: { ...base.map, hexes: base.map.hexes.map(point => ({ ...point })), resolvedResources: [] },
        rules: { ...base.rules, enemyAiIntervalSeconds: 10000 } };
    const state = ZCSnapshotCodec.createInitialState(config);
    const hex = state.hexes.find(hex => config.map.hexes[hex.id].playable && hex.owner === 'neutral'
        && config.map.hexes[hex.id].neighbors.length === 6);
    assert.ok(hex);
    if (patrol) config.map.resourcePoints = [{ row: config.map.hexes[hex.id].row,
        column: config.map.hexes[hex.id].column, groupId: 14001,
        patrolCells: [hex.id, ...config.map.hexes[hex.id].neighbors] }];
    hex.neutralResourceId = 1400101;
    let clones = 0;
    const batches: number[] = [];
    const structureHits: number[] = [];
    const system = new ZCNeutralFeatureSystem(config.map, {
        random: () => 0, rules: config.rules, definition: () => config.units[0], monsterDefinition: () => config.units[0],
        cloneUnit: () => { clones += 1; }, spawnBatch: hex => { if (hex.building === 'barracks') batches.push(hex.id); },
        damageUnit: (unit, damage) => { unit.hp -= damage; }, capture: (hex, owner) => { hex.owner = owner; }, changed: () => {},
        damageStructure: hex => { structureHits.push(hex.id); },
    });
    system.initialize(state);
    if (type === 7 && activateGate) {
        const neighbor = state.hexes[config.map.hexes[hex.id].neighbors[0]];
        neighbor.owner = 'player';
        neighbor.developmentResolved = true;
        system.claim(state);
    }
    const unit = (id: number, owner: 'player' | 'enemy' = 'player'): ZCUnitState => ({
        id, owner, unitId: card.unitId, cardId: card.id, tier: 1, sourceHexId: hex.id,
        targetHexId: null, progress: 0, hp: 100, maxHp: 100, battleState: 'idle', stateTime: 0,
        targetUnitId: null, targetWallHexId: null, targetBuildingHexId: null, nextAttackAt: 100,
        waitUntil: 0, attackHitDone: false, hatredUnitId: null, hatredUntil: 0, facingRadians: 0,
        deathRemoveAt: 0, marchAngle: null, freeX: config.map.hexes[hex.id].x, freeY: config.map.hexes[hex.id].y,
    });
    return { config, state, hex, system, unit, batches, structureHits, clones: () => clones };
}

test('野怪领地排除空洞，各方永久解锁，首次解锁立即自动攻击', () => {
    const f = fixture(11, { resId: '68001', wakeRange: 2, reviveRate: 1 });
    const center = f.config.map.hexes[f.hex.id];
    const second = f.config.map.hexes.find(point => point.playable && hexGridDistance(center, point) === 2);
    assert.ok(second);
    for (const id of center.neighbors) f.config.map.hexes[id].playable = false;
    const building = f.state.hexes[second.id];
    building.owner = 'player'; building.building = 'barracks'; building.hp = 10;
    const nearby = f.unit(1, 'enemy');
    f.state.units = [nearby];
    f.system.tick(f.state);
    assert.equal(nearby.hp, 100);
    f.system.claim(f.state);
    assert.deepEqual(f.hex.neutralFeature.unlockedOwners, ['player']);
    assert.equal(isZCAwakeMonster(f.hex), true);
    assert.equal(f.system.hasFocusableMonster(), true);
    assert.equal(f.system.priorityTarget(f.state, nearby), null);
    f.system.tick(f.state);
    assert.ok(nearby.hp < 100);
    assert.ok(f.system.territory(f.hex).includes(second.id));
    assert.ok(center.neighbors.every(id => !f.system.territory(f.hex).includes(id)), JSON.stringify({neighbors: center.neighbors.map(id => [id, f.config.map.hexes[id].playable]), territory: f.system.territory(f.hex)}));
    assert.ok(f.config.map.hexes.filter(point => hexGridDistance(center, point) > 2)
        .every(point => !f.system.territory(f.hex).includes(point.id)));
    f.config.rules.neutralMonsterFocusSwitchCdSeconds = 0.5;
    assert.equal(f.system.toggleFocus(f.state, f.hex, 'player'), true);
    assert.equal(isZCAwakeMonster(f.hex), true);
    assert.equal(f.system.toggleFocus(f.state, f.hex, 'enemy'), false);
    building.owner = 'enemy';
    f.system.claim(f.state);
    assert.equal(f.system.toggleFocus(f.state, f.hex, 'enemy'), true);
    building.building = 'none';
    assert.equal(f.system.toggleFocus(f.state, f.hex, 'player'), false);
    f.state.elapsedSeconds = 0.5;
    assert.equal(f.system.toggleFocus(f.state, f.hex, 'player'), true);
    assert.equal(isZCAwakeMonster(f.hex), true);
    assert.deepEqual(f.hex.neutralFeature.focusOwners, ['enemy']);
    assert.equal(f.hex.neutralFeature.patrol, undefined);
    assert.deepEqual(zcMonsterPosition(f.config.map, f.hex, 100), { x: center.x, y: center.y });
});

test('双方小兵踩过野怪领地立即易手，出生格上的存活野怪保留血量', () => {
    const f = fixture(11, { resId: '68001', wakeRange: 2, reviveRate: 1 });
    const center = f.config.map.hexes[f.hex.id];
    const adjacent = f.config.map.hexes[center.neighbors[0]];
    const outside = f.config.map.hexes.find(point => point.playable && hexGridDistance(center, point) > 2
        && f.state.hexes[point.id].building === 'none' && f.state.hexes[point.id].owner === 'neutral');
    assert.ok(outside);
    const model = new ZCGameModel(f.state, () => 0, {
        ...f.config, rules: { ...f.config.rules, captureSeconds: 10, captureRequireSupply: true },
    });
    const { state } = model as unknown as { state: ZCSnapshot };
    const monster = state.hexes[f.hex.id];
    const hp = monster.hp;
    for (const owner of ['player', 'enemy'] as const) {
        const centerUnit = f.unit(1, owner);
        const adjacentUnit = f.unit(2, owner);
        const outsideUnit = f.unit(3, owner);
        Object.assign(adjacentUnit, { freeX: adjacent.x, freeY: adjacent.y });
        Object.assign(outsideUnit, { freeX: outside.x, freeY: outside.y });
        state.units = [centerUnit, adjacentUnit, outsideUnit];
        for (const unit of state.units) unit.castHoldUntil = 100;
        model.tick(0.05);
        assert.equal(monster.owner, owner);
        assert.equal(state.hexes[adjacent.id].owner, owner);
        assert.equal(state.hexes[outside.id].owner, 'neutral');
        assert.equal(monster.hp, hp);
        assert.equal(monster.maxHp, hp);
        assert.equal(monster.neutralResourceId, f.hex.neutralResourceId);
    }
    const contestant = f.unit(4);
    contestant.castHoldUntil = 100;
    state.units.push(contestant);
    model.tick(0.05);
    assert.equal(monster.owner, 'enemy');
});

test('真实模型自动唤醒后，命中的射程外攻击者会收到反击', () => {
    const f = fixture(11, { resId: '68001', wakeRange: 2, reviveRate: 1 });
    const center = f.config.map.hexes[f.hex.id];
    const building = f.state.hexes[center.neighbors[0]];
    Object.assign(building, { owner: 'player', building: 'barracks', hp: 10, maxHp: 10, cardId: '68001' });
    const attacker = f.unit(1);
    const definition = f.config.units.find(unit => unit.unitId === attacker.unitId);
    attacker.freeX += 10000;
    attacker.castHoldUntil = 100;
    f.state.units = [attacker];
    f.state.nextUnitId = 2;
    const model = new ZCGameModel(f.state, () => 0, f.config);
    const access = model as unknown as {
        state: ZCSnapshot;
        damageBuilding(source: Pick<ZCUnitState, 'id' | 'owner'>, hex: ZCHexState, damage: number): void;
    };
    const monster = access.state.hexes[center.id];
    assert.equal(isZCAwakeMonster(monster), true);
    const shooter = access.state.units[0];
    assert.ok(definition);
    assert.ok(Math.hypot(shooter.freeX - center.x, shooter.freeY - center.y)
        > (definition.attackRange + definition.bodyRadius * 0.5) * f.config.rules.combatDistanceScale);
    model.tick(0.05);
    assert.equal(shooter.hp, 100);
    access.damageBuilding(shooter, monster, 1);
    model.tick(0.05);
    assert.equal(monster.neutralFeature.targetUnitId, shooter.id);
    assert.ok(shooter.hp < 100);
});

test('monster regeneration retains fractions, resets on combat and respects distant retaliation targets', () => {
    for (const rate of [0, 1, 10]) {
        const f = fixture(11, { resId: '68001', wakeRange: 2, reviveRate: 1 });
        f.config.rules.neutralMonsterRegenDelaySeconds = 0.5;
        f.config.rules.neutralMonsterRegenRate = rate;
        f.hex.neutralFeature.awake = true;
        f.hex.maxHp = 100; f.hex.hp = 50;
        f.system.tick(f.state);
        f.state.elapsedSeconds = 0.5; f.system.tick(f.state);
        assert.equal(f.hex.hp, 50);
        for (let i = 1; i <= 10; i++) { f.state.elapsedSeconds = 0.5 + i / 10; f.system.tick(f.state); }
        assert.ok(Math.abs(f.hex.hp - (50 + rate / 100)) < 1e-9);
        const attacker = f.unit(1);
        attacker.freeX += 10000; attacker.hp = 100000;
        f.state.units = [attacker]; f.hex.neutralFeature.retaliationUnitIds = [attacker.id];
        const hp = f.hex.hp;
        f.state.elapsedSeconds = 10; f.system.tick(f.state);
        assert.equal(f.hex.hp, hp);
        assert.equal(f.hex.neutralFeature.targetUnitId, attacker.id);
        assert.ok(attacker.hp < 100000, 'out-of-range attacker remains attackable');
        attacker.hp = 0;
        f.state.elapsedSeconds = 11; f.system.tick(f.state);
        f.state.elapsedSeconds = 11.5; f.system.tick(f.state);
        assert.equal(f.hex.hp, hp);
        f.state.elapsedSeconds = 12.5; f.system.tick(f.state);
        assert.ok(Math.abs(f.hex.hp - (hp + rate / 100)) < 1e-9);
        const active = f.unit(2); active.freeX += 10000; active.targetBuildingHexId = f.hex.id; active.battleState = 'attack';
        f.state.units.push(active);
        const regenerated = f.hex.hp;
        f.state.elapsedSeconds = 13; f.system.tick(f.state);
        assert.equal(f.hex.hp, regenerated);
        assert.equal(f.hex.neutralFeature.disengagedAt, undefined);
        f.hex.neutralFeature.claimed = true;
        f.state.elapsedSeconds = 100; f.system.tick(f.state);
        assert.equal(f.hex.hp, regenerated, 'reinforcement never uses neutral regeneration');
    }
});

test('last hit revives once at the origin with only hp/attack scaled and survives snapshot restoration', () => {
    for (const rate of [0.8, 1, 1.2]) {
        const f = fixture(11, { resId: '68001', wakeRange: 2, reviveRate: rate });
        f.hex.neutralFeature.awake = true;
        const config = withZCGeneralStarSelections(f.config, { player: [{ generalId: 68001, star: 1 }] });
        const model = new ZCGameModel(f.state, () => 0, config);
        const access = model as unknown as {
            state: ZCSnapshot;
            damageBuilding(source: { owner: 'player' }, hex: ZCHexState, damage: number): void;
            effectiveUnitDefinition(unit: ZCUnitState): ZCUnitDefinition;
            unitDefinition(id: string): ZCUnitDefinition;
        };
        const monster = access.state.hexes[f.hex.id];
        const original = access.unitDefinition(findCatalogCard('68001').unitId);
        assert.ok(model.effectiveDefinitionForUnit('player', '68001').attack > original.attack, 'recipient has cultivation bonuses');
        access.damageBuilding({ owner: 'player' }, monster, monster.hp);
        const unit = access.state.units.find(unit => unit.neutralReinforcement);
        assert.ok(unit);
        assert.equal(unit.hp, original.maxHp * rate);
        assert.equal(unit.maxHp, unit.hp);
        assert.equal(unit.nextAttackAt, access.state.elapsedSeconds + original.attackInterval);
        const definition = access.effectiveUnitDefinition(unit);
        assert.equal(definition.attack, original.attack * rate);
        for (const key of ['moveSpeed', 'attackInterval', 'attackRange', 'bodyRadius'] as const) assert.equal(definition[key], original[key]);
        assert.equal(unit.freeX, f.config.map.hexes[f.hex.id].x);
        assert.equal(unit.freeY, f.config.map.hexes[f.hex.id].y);
        access.damageBuilding({ owner: 'player' }, monster, 100);
        assert.equal(access.state.units.length, 1);
        assert.equal(monster.neutralResourceId, null);
        assert.deepEqual(monster.neutralFeature.focusOwners, []);
        assert.deepEqual(monster.neutralFeature.retaliationUnitIds, []);
        assert.equal(model.cardReveals.filter(item => item.monsterClaim).length, 1);
        const restored = new ZCGameModel(model.exportSnapshot(), () => 0, config);
        assert.deepEqual(restored.snapshot.units[0].inheritedStats, unit.inheritedStats);
    }
});

test('强化门按独立表引用，拒绝未知ID、重复效果和旧内联结构', () => {
    const card = findCatalogCard('68001');
    const cards = new Map([[card.id, card]]);
    const row = { groupId: 1, id: 1, groupName: '门', resourceType: 7, weight: 10000, param: { gateIds: [101] } };
    const gate = { id: 101, name: '加法', effectType: 1, value: 3, scale: 0, hpRate: 0,
        windowSeconds: 0, cooldownSeconds: 8, attackSpeedMultiplier: 0, moveMultiplier: 0, damageMultiplier: 0 };
    assert.equal(compileZCNeutralResourceCatalog([row], cards, [gate]).items.get(1).feature.gates[0].value, 3);
    assert.throws(() => compileZCNeutralResourceCatalog([row], cards), /引用无效/);
    assert.throws(() => compileZCNeutralResourceCatalog([{ ...row, param: gateParam }], cards, [gate]), /未知字段/);
    assert.throws(() => compileZCNeutralResourceCatalog([{ ...row, param: { gateIds: [101, 102] } }], cards,
        [gate, { ...gate, id: 102 }]), /效果不可重复/);
});

test('强化门在相邻格翻开前不领取、不触发，翻开后自动生效', () => {
    const f = fixture(7, gateParam, false);
    for (const id of f.config.map.hexes[f.hex.id].neighbors) {
        f.state.hexes[id].owner = 'player';
        f.state.hexes[id].developmentResolved = false;
    }
    f.state.units = [f.unit(1)];
    f.system.claim(f.state);
    f.system.tick(f.state);
    assert.equal(f.hex.neutralFeature.claimed, false);
    assert.equal(f.clones(), 0);
    f.state.hexes[f.config.map.hexes[f.hex.id].neighbors[0]].developmentResolved = true;
    f.system.claim(f.state);
    f.system.tick(f.state);
    assert.equal(f.hex.neutralFeature.claimed, true);
    assert.equal(f.clones(), 2);
});

test('趣味资源只认已翻开的邻格，不被未翻格的归属或远处翻格激活', () => {
    for (const [type, param] of [[8, {}], [9, {}], [10, {}]] as const) {
        const f = fixture(type, param);
        const neighbors = f.config.map.hexes[f.hex.id].neighbors;
        for (const hex of f.state.hexes) {
            hex.owner = 'neutral';
            hex.developmentResolved = false;
        }
        const fromId = neighbors.find(id => f.config.map.hexes[id].neighbors.some(next => next !== f.hex.id && !neighbors.includes(next)));
        assert.notEqual(fromId, undefined);
        const neighbor = f.state.hexes[fromId];
        neighbor.owner = 'player';
        const distantId = f.config.map.hexes[neighbor.id].neighbors.find(id => id !== f.hex.id && !neighbors.includes(id));
        assert.notEqual(distantId, undefined);
        f.state.hexes[distantId].owner = 'player';
        f.state.hexes[distantId].developmentResolved = true;
        f.system.claim(f.state);
        assert.equal(f.hex.neutralFeature.claimed, false, `类型 ${type}`);
        assert.equal(isZCAwakeMonster(f.hex), false, `类型 ${type}`);
        neighbor.developmentResolved = true;
        f.system.claim(f.state);
        assert.equal(f.hex.neutralFeature.claimed, true, `类型 ${type}`);
    }
});

test('加法门同拍只取一人，双方共用冷却，停留不重复触发', () => {
    const f = fixture();
    f.state.units = [f.unit(1), f.unit(2, 'enemy')];
    f.system.tick(f.state);
    assert.equal(f.clones(), 2);
    f.state.elapsedSeconds = 2;
    f.system.tick(f.state);
    assert.equal(f.clones(), 2);
    f.state.units = [];
    f.system.tick(f.state);
    f.state.units = [f.unit(3, 'enemy')];
    f.system.tick(f.state);
    assert.equal(f.clones(), 4);
});

test('零冷却同拍仍只激活一人；随机门下一种效果不会重复', () => {
    const f = fixture(7, { ...gateParam, cooldownSeconds: 0, mode: 'random' });
    f.state.units = [f.unit(1), f.unit(2, 'enemy')];
    f.system.tick(f.state);
    assert.equal(f.clones(), 2);
    assert.notEqual(f.hex.neutralFeature.effect, 'add');
});

test('高速穿越整格也触发，冷却期间进入并停留不会等到冷却结束自动触发', () => {
    const f = fixture();
    const unit = f.unit(1);
    unit.freeX -= 200;
    f.state.units = [unit];
    f.system.beginStep(f.state);
    unit.freeX += 400;
    f.system.tick(f.state);
    assert.equal(f.clones(), 2);
    f.state.units.push(f.unit(2));
    f.system.beginStep(f.state);
    f.system.tick(f.state);
    f.state.elapsedSeconds = 2;
    f.system.beginStep(f.state);
    f.system.tick(f.state);
    assert.equal(f.clones(), 2);
});

test('野怪锁定首个目标，失效后换最近单位，脱战不回血', () => {
    const f = fixture(11, { resId: '68001', wakeRange: 2, reviveRate: 1 });
    f.hex.neutralFeature.awake = true;
    f.hex.hp -= 5;
    const first = f.unit(1);
    first.freeX += 10;
    f.state.units = [first];
    f.system.tick(f.state);
    assert.equal(f.hex.neutralFeature.targetUnitId, first.id);
    const closer = f.unit(2, 'enemy');
    f.state.units.push(closer);
    f.state.elapsedSeconds = 0.01;
    f.system.tick(f.state);
    assert.equal(f.hex.neutralFeature.targetUnitId, first.id);
    first.hp = 0;
    f.system.tick(f.state);
    assert.equal(f.hex.neutralFeature.targetUnitId, closer.id);
    const hp = f.hex.hp;
    f.state.units = [];
    f.state.elapsedSeconds = 10;
    f.system.tick(f.state);
    assert.equal(f.hex.neutralFeature.targetUnitId, null);
    assert.equal(f.hex.hp, hp);
});

test('真实模型睡眠怪免伤，唤醒后远程弹道可命中且击杀只发一次既有奖励', () => {
    const f = fixture(11, { resId: '68001', wakeRange: 2, reviveRate: 1 });
    const config = { ...f.config, map: { ...f.config.map,
        resolvedResources: [{ hexId: f.hex.id, itemId: f.hex.neutralResourceId }] } };
    const model = new ZCGameModel(null, () => 0, config);
    const access = model as unknown as {
        state: typeof f.state;
        damageBuilding(unit: Pick<ZCUnitState, 'owner'>, hex: ZCHexState, damage: number): void;
        projectileStructureTargets(
            projectile: Pick<ZCProjectileState, 'targetKind' | 'targetId' | 'owner'>,
            fromX: number, fromY: number, toX: number, toY: number, out: ZCCombatTarget[],
        ): void;
    };
    const monster = access.state.hexes[f.hex.id];
    const hp = monster.hp;
    access.damageBuilding({ owner: 'player' }, monster, hp * 2);
    assert.equal(monster.hp, hp);
    const shot = { targetKind: 'building' as const, targetId: monster.id, owner: 'player' as const };
    //  2026-11-06：结构判定从「只看锁定格」改成「锁定格 + 飞行段经过的格」，
    //  这里两端都取该格中心（等于原地扫掠），语义与改前一致。
    const probe = (): ZCCombatTarget | null => {
        const center = f.config.map.hexes[f.hex.id];
        const out: ZCCombatTarget[] = [];
        access.projectileStructureTargets(shot, center.x, center.y, center.x, center.y, out);
        return out[0] ?? null;
    };
    assert.equal(probe(), null);
    monster.neutralFeature.awake = true;
    assert.equal(probe()?.id, monster.id);
    const gold = access.state.goldByOwner.player;
    access.damageBuilding({ owner: 'player' }, monster, hp * 2);
    access.damageBuilding({ owner: 'enemy' }, monster, hp * 2);
    assert.equal(monster.neutralResourceId, null);
    assert.equal(monster.tileType, ZCPvpTileType.AllRandom,
        '真实开局的怪物被击败后保留问号类型，不能只剩默认价格');
    assert.equal(monster.developmentCost, config.tiles[ZCPvpTileType.AllRandom].price);
    assert.equal(access.state.goldByOwner.player, gold + f.config.rules.killUnitGoldReward);
    assert.equal(probe(), null);
});

test('快照拒绝缺失门状态及非法继承属性，保留旧存档兼容', () => {
    const f = fixture();
    assert.equal(ZCSnapshotCodec.decode(f.state, f.config).ok, true);
    f.hex.neutralFeature = { claimed: false };
    assert.equal(ZCSnapshotCodec.decode(f.state, f.config).ok, false);
    delete f.hex.neutralFeature;
    assert.equal(ZCSnapshotCodec.decode(f.state, f.config).ok, true);
    const unit = f.unit(1);
    unit.gateScale = NaN;
    f.state.units = [unit];
    f.state.nextUnitId = 2;
    assert.equal(ZCSnapshotCodec.decode(f.state, f.config).ok, false);
});

test('同一野怪组合在一局中冻结同一种类，三人局资源抽签不投放传送门', () => {
    loadPvpTables(tables);
    configureZCMap(JSON.parse(readFileSync('assets/resources/config/maps/normal.json', 'utf8')));
    const config = captureZCMatchConfig();
    const points = [{ row: 8, column: 1, groupId: 14009 }, { row: 8, column: 9, groupId: 14009 },
        { row: 10, column: 5, groupId: 14007 }];
    let random = 0;
    const result = resolveZCMapResources({ ...config.map, resourcePoints: points }, () => random++ % 2 ? 0.99 : 0);
    assert.equal(result.length, 3);
    assert.equal(result[0].itemId, result[1].itemId);
    assert.equal(resolveZCMapResources({ ...config.map, playerCount: 3, resourcePoints: points }, () => 0).length, 2);
});

test('验收地图包含所有新类型，真实模型可开局、推进和重置', () => {
    loadPvpTables(tables);
    configureZCMap(JSON.parse(readFileSync('assets/resources/config/maps/neutral_fun.json', 'utf8')));
    const base = captureZCMatchConfig();
    const config = { ...base, map: { ...base.map, resolvedResources: resolveZCMapResources(base.map, () => 0) } };
    const model = new ZCGameModel(undefined, () => 0, config);
    assert.equal(model.snapshot.hexes.filter(hex => hex.neutralFeature).length, 13);
    for (let i = 0; i < 20; i += 1) model.tick(0.05);
    const restored = new ZCGameModel(model.exportSnapshot(), () => 0, config);
    restored.tick(0.05);
    model.reset();
    assert.equal(model.snapshot.hexes.filter(hex => hex.neutralFeature).length, 13);
    assert.ok(model.snapshot.hexes.some(hex => hex.neutralFeature?.effect === 'shrink'));
});

test('乘法门包含首人和窗口后到者，窗口结束才起冷却', () => {
    const f = fixture(7, { ...gateParam, effect: 'multiply', value: 3 });
    f.state.units = [f.unit(1)];
    f.system.tick(f.state);
    f.state.elapsedSeconds = 0.1;
    f.state.units.push(f.unit(2, 'enemy'));
    f.system.tick(f.state);
    assert.equal(f.clones(), 4);
    f.state.elapsedSeconds = 0.2;
    f.state.units.push(f.unit(3));
    f.system.tick(f.state);
    assert.equal(f.clones(), 4);
    assert.equal(f.hex.neutralFeature.readyAt, 1.2);
});

test('乘法门的原地出生副本不再次增殖，必须离开后重新穿越', () => {
    const f = fixture(7, { ...gateParam, effect: 'multiply', value: 2, windowSeconds: 1 });
    f.state.units = [f.unit(1)];
    f.state.nextUnitId = 2;
    const config = { ...f.config, units: f.config.units.map(unit => ({ ...unit, moveSpeed: 0 })) };
    const model = new ZCGameModel(f.state, () => 0, config);
    for (let i = 0; i < 10; i += 1) model.tick(0.05);
    assert.equal(model.snapshot.units.length, 2);
    const access = model as unknown as { state: typeof f.state };
    const clone = access.state.units[1];
    const origin = f.config.map.hexes[f.hex.id];
    clone.freeX = origin.x + 200;
    model.tick(0.05);
    clone.freeX = origin.x;
    clone.freeY = origin.y;
    model.tick(0.05);
    assert.equal(model.snapshot.units.length, 3);
    model.tick(0.05);
    assert.equal(model.snapshot.units.length, 3);
});

test('克隆继承常驻减伤和当前状态，攻击加成不重复叠加', () => {
    const f = fixture();
    const source = f.unit(1);
    source.maxHp = source.hp = 1000;
    source.passiveStatusApplied = true;
    f.state.units = [source];
    f.state.nextUnitId = 2;
    const model = new ZCGameModel(f.state, () => 0, f.config);
    const access = model as unknown as {
        state: typeof f.state; statusSystem: ZCStatusSystem;
        cloneGateUnit(unit: ZCUnitState): void;
        effectiveUnitDefinition(unit: ZCUnitState): ZCUnitDefinition;
        damageUnit(unit: ZCUnitState, damage: number, source: ZCDamageSource): void;
    };
    const original = access.state.units[0];
    access.statusSystem.register({ id: 'test-current', name: '当前加攻与藤盾减伤', durationSeconds: 2,
        statMods: { attackPct: 20, damageTakenRangedPct: -10 } });
    access.statusSystem.apply(String(original.id), 'test-current');
    access.cloneGateUnit(original);
    const clone = access.state.units[1];
    assert.equal(access.statusSystem.statModsOf(String(clone.id)).damageTakenRangedPct, -10);
    assert.equal(access.effectiveUnitDefinition(clone).attack, access.effectiveUnitDefinition(original).attack);
    for (const unit of [original, clone]) access.damageUnit(unit, 100, { owner: 'enemy', kind: 'unit', ranged: true });
    assert.equal(original.hp, 910);
    assert.equal(clone.hp, 910);
    const sourceStatus = access.statusSystem.instancesOf(String(original.id))[0];
    const cloneStatus = access.statusSystem.instancesOf(String(clone.id))[0];
    assert.notEqual(sourceStatus.uid, cloneStatus.uid);
    assert.equal(sourceStatus.remainingSeconds, cloneStatus.remainingSeconds);
});

test('缩小不覆盖放大，缩小后放大恢复正常速度与伤害', () => {
    const f = fixture(7, { ...gateParam, effect: 'shrink' });
    const small = f.unit(1);
    const giant = f.unit(2);
    giant.gateSize = 'enlarge';
    giant.gateScale = 3;
    f.state.units = [small, giant];
    f.system.tick(f.state);
    assert.equal(small.gateScale, 1 / 3);
    assert.equal(giant.gateSize, 'enlarge');
    const gate = neutralResourceItemOf(f.hex.neutralResourceId).feature.gates[0];
    Object.assign(gate, { effect: 'enlarge', scale: 3 });
    f.hex.neutralFeature.effect = 'enlarge';
    f.hex.neutralFeature.insideUnitIds = [];
    f.hex.neutralFeature.windowUntil = 0;
    f.hex.neutralFeature.readyAt = 0;
    f.system.tick(f.state);
    assert.equal(small.gateScale, 3);
    assert.equal(small.maxHp, 1100);
    assert.equal(small.gateMoveMultiplier, 1);
    assert.equal(small.gateDamageMultiplier, 1);
    giant.maxHp = 2100;
    giant.hp = 1;
    giant.gateHpFlat = 2000;
    f.state.units = [giant];
    f.hex.neutralFeature.insideUnitIds = [];
    f.hex.neutralFeature.readyAt = 0;
    f.system.tick(f.state);
    assert.equal(giant.maxHp, 1100);
    assert.equal(giant.hp, 1, '覆盖较小的最大生命加成不额外造成伤害');
});

test('号角只出一次波，不改变兵营时钟', () => {
    const f = fixture(10, {});
    const neighbor = f.state.hexes[f.config.map.hexes[f.hex.id].neighbors[0]];
    neighbor.owner = 'player';
    neighbor.developmentResolved = true;
    neighbor.building = 'barracks';
    f.state.spawnClocks[`barracks:${neighbor.id}`] = 4;
    f.system.claim(f.state);
    f.system.claim(f.state);
    assert.deepEqual(f.batches, [neighbor.id]);
    assert.equal(f.state.spawnClocks[`barracks:${neighbor.id}`], 4);
});

test('割草机随时间推进，只占中立格，敌方空地保持归属且不授予自由建造权', () => {
    const f = fixture(8, {});
    const from = f.config.map.hexes[f.hex.id].neighbors[0];
    f.state.hexes[from].owner = 'player';
    f.state.hexes[from].developmentResolved = true;
    f.system.claim(f.state);
    const line = f.hex.neutralFeature.lineHexIds;
    assert.ok(line.length > 1);
    const last = f.state.hexes[line[line.length - 1]];
    last.owner = 'enemy';
    const neutral = f.state.hexes[line[1]];
    if (neutral !== last) neutral.owner = 'neutral';
    f.system.tick(f.state);
    if (neutral !== last) assert.equal(neutral.owner, 'neutral', '割草机尚未走到时不提前占地');
    f.state.elapsedSeconds = line.length;
    f.system.tick(f.state);
    assert.equal(last.owner, 'enemy');
    if (neutral !== last) assert.equal(neutral.owner, 'player');
    ZCTileSystem.refresh(f.state, f.config.map);
    assert.equal(ZCTileSystem.canDevelopFor(f.state, f.config.map, last.id, 'player'), false);
    assert.equal('buildUsed' in f.hex.neutralFeature, false);
});

test('割草机按全队总攻击力伤害一次，非中立格保持归属，恢复后不补发伤害', () => {
    const f = fixture(8, {});
    const neighbor = f.state.hexes[f.config.map.hexes[f.hex.id].neighbors[0]];
    neighbor.owner = 'player'; neighbor.developmentResolved = true;
    const ally = f.unit(1); const enemy = f.unit(2, 'enemy');
    enemy.hp = 100000;
    f.state.units = [ally, enemy];
    f.system.claim(f.state);
    const line = f.hex.neutralFeature.lineHexIds;
    assert.ok(line.length > 1);
    const point = f.config.map.hexes[line[1]];
    enemy.freeX = point.x; enemy.freeY = point.y;
    f.state.hexes[point.id].owner = 'enemy';
    f.system.tick(f.state);
    assert.equal(enemy.hp, 100000);
    f.state.elapsedSeconds = 0.5;
    f.system.tick(f.state);
    assert.equal(enemy.hp, 100000 - f.config.units[0].attack);
    assert.equal(f.state.hexes[point.id].owner, 'enemy');
    f.system.initialize(f.state);
    f.system.tick(f.state);
    assert.equal(enemy.hp, 100000 - f.config.units[0].attack);
});

test('割草机沿开启邻格的反方向推进，六个方向都不掉头', () => {
    for (let direction = 0; direction < 6; direction++) {
        const f = fixture(8, {});
        const origin = f.config.map.hexes[f.hex.id];
        for (const id of origin.neighbors) f.state.hexes[id].developmentResolved = false;
        const from = f.config.map.hexes[origin.neighbors[direction]];
        f.state.hexes[from.id].owner = 'player';
        f.state.hexes[from.id].developmentResolved = true;
        f.system.claim(f.state);
        const line = f.hex.neutralFeature.lineHexIds;
        assert.equal(line[0], origin.id);
        assert.equal(line.includes(from.id), false, '不能往开启格方向倒推');
        for (const id of line.slice(1)) {
            const point = f.config.map.hexes[id];
            const dx = point.x - origin.x, dy = point.y - origin.y;
            const forwardX = origin.x - from.x, forwardY = origin.y - from.y;
            assert.ok(dx * forwardX + dy * forwardY > 0);
            assert.ok(Math.abs(dx * forwardY - dy * forwardX) < 1e-6, '路线保持直线');
        }
    }
});

test('每名玩家每局只触发一次割草机，恢复与易手不重置，其他玩家仍可触发', () => {
    const f = fixture(8, {});
    const second = f.state.hexes.find(hex => hex.id !== f.hex.id && hex.owner === 'neutral'
        && f.config.map.hexes[hex.id].playable && f.config.map.hexes[hex.id].neighbors.length === 6
        && f.config.map.hexes[hex.id].neighbors.every(id => id !== f.hex.id && f.state.hexes[id].owner === 'neutral'));
    assert.ok(second);
    second.neutralResourceId = f.hex.neutralResourceId;
    f.system.initialize(f.state);
    const from = f.state.hexes[f.config.map.hexes[f.hex.id].neighbors[0]];
    from.owner = 'player'; from.developmentResolved = true;
    f.system.claim(f.state);
    assert.equal(f.hex.neutralFeature.mowerOwner, 'player');
    for (const id of f.config.map.hexes[second.id].neighbors) {
        f.state.hexes[id].owner = 'player'; f.state.hexes[id].developmentResolved = true;
    }
    f.system.claim(f.state);
    assert.equal(second.neutralFeature.claimed, false, '同一玩家不能触发第二台');
    const restored = ZCSnapshotCodec.clone(f.state);
    restored.hexes[f.hex.id].owner = 'enemy';
    f.system.initialize(restored);
    f.system.claim(restored);
    assert.equal(restored.hexes[second.id].neutralFeature.claimed, false, '恢复和资源格易手不能刷新已用次数');
    const neighbors = f.config.map.hexes[second.id].neighbors;
    const enemyNeighbor = neighbors[neighbors.length - 1];
    restored.hexes[enemyNeighbor].owner = 'enemy';
    f.system.claim(restored);
    assert.equal(restored.hexes[second.id].neutralFeature.mowerOwner, 'enemy', '跳过已用次数的玩家，允许其他邻接玩家触发');
    const fresh = ZCSnapshotCodec.createInitialState(f.config);
    fresh.hexes[f.hex.id].neutralResourceId = f.hex.neutralResourceId;
    fresh.hexes[from.id].owner = 'player'; fresh.hexes[from.id].developmentResolved = true;
    f.system.initialize(fresh);
    f.system.claim(fresh);
    assert.equal(fresh.hexes[f.hex.id].neutralFeature.mowerOwner, 'player', '新局恢复每名玩家的使用机会');
});

test('割草机经过有敌兵的中立格仍按新规则归属触发方', () => {
    const f = fixture(8, {});
    const from = f.state.hexes[f.config.map.hexes[f.hex.id].neighbors[0]];
    from.owner = 'player'; from.developmentResolved = true;
    f.state.units = [];
    f.system.claim(f.state);
    const nextId = f.hex.neutralFeature.lineHexIds[1];
    assert.notEqual(nextId, undefined);
    const enemy = f.unit(1, 'enemy');
    enemy.freeX = f.config.map.hexes[nextId].x; enemy.freeY = f.config.map.hexes[nextId].y;
    f.state.units.push(enemy);
    f.state.hexes[nextId].owner = 'neutral';
    f.state.elapsedSeconds = 1;
    f.system.tick(f.state);
    assert.equal(f.state.hexes[nextId].owner, 'player');
});

test('三人局不投放传送门，野怪睡眠时不是攻击目标', () => {
    const f = fixture(9, {});
    const system = new ZCNeutralFeatureSystem({ ...f.config.map, playerCount: 3 }, {} as never);
    delete f.hex.neutralFeature;
    system.initialize(f.state);
    assert.equal(f.hex.neutralResourceId, null);
    const m = fixture(11, { resId: '68001', wakeRange: 2, reviveRate: 1 });
    assert.equal(isZCAwakeMonster(m.hex), false);
    m.state.hexes[m.config.map.hexes[m.hex.id].neighbors[0]].owner = 'player';
    m.state.hexes[m.config.map.hexes[m.hex.id].neighbors[0]].building = 'barracks';
    m.state.hexes[m.config.map.hexes[m.hex.id].neighbors[0]].hp = 10;
    m.system.claim(m.state);
    assert.equal(isZCAwakeMonster(m.hex), true);
    assert.equal(m.system.toggleFocus(m.state, m.hex, 'player'), true);
    assert.ok(isZCAwakeMonster(m.hex));
    const hp = m.hex.hp;
    m.system.claim(m.state);
    assert.equal(m.hex.hp, hp);
});

test('真实模型增殖继承当前最大生命、大小与属性，恢复后不重复触发', () => {
    const f = fixture();
    const source = f.unit(1);
    source.maxHp = 777;
    source.hp = 12;
    source.gateSize = 'enlarge';
    source.gateScale = 3;
    source.gateHpFlat = 677;
    f.state.units = [source];
    f.state.nextUnitId = 2;
    const model = new ZCGameModel(f.state, () => 0, f.config);
    model.tick(0.05);
    const snapshot = model.exportSnapshot();
    const clones = snapshot.units.filter(unit => unit.id !== source.id);
    assert.equal(clones.length, 2);
    for (const clone of clones) {
        assert.equal(clone.hp, 777);
        assert.equal(clone.gateScale, 3);
        assert.ok(clone.inheritedStats);
    }
    const restored = new ZCGameModel(snapshot, () => 0, f.config);
    restored.tick(0.05);
    assert.equal(restored.snapshot.units.length, snapshot.units.length);
});

test('单门按批传送，优先范围内最近敌人，次数耗尽后冷却恢复', () => {
    const f = fixture(9, { range: 3, uses: 2, cooldownSeconds: 8 });
    f.hex.owner = 'player'; f.hex.neutralFeature.claimed = true;
    const barracks = f.state.hexes[f.config.map.hexes[f.hex.id].neighbors[0]];
    barracks.owner = 'player';
    const enemy = f.unit(1, 'enemy');
    const target = f.config.map.hexes[f.config.map.hexes[f.hex.id].neighbors[1]];
    enemy.freeX = target.x; enemy.freeY = target.y;
    f.state.units = [enemy];
    assert.equal(f.system.spawnHex(f.state, barracks).hexId, target.id);
    assert.equal(f.hex.neutralFeature.usesRemaining, 1);
    assert.equal(f.system.spawnHex(f.state, barracks).hexId, target.id);
    assert.equal(f.hex.neutralFeature.usesRemaining, 0);
    assert.equal(f.system.spawnHex(f.state, barracks).hexId, barracks.id);
    f.state.elapsedSeconds = 8;
    f.system.tick(f.state);
    assert.equal(f.hex.neutralFeature.usesRemaining, 2);
    f.state.units = [];
    const exit = f.system.spawnHex(f.state, barracks).hexId;
    assert.ok(f.config.map.hexes[exit].playable);
    assert.notEqual(exit, barracks.id);
    assert.equal(f.hex.neutralFeature.usesRemaining, 1);
});


test('随机门只使用引用行的独立倍率、生命与冷却参数', () => {
    const f = fixture(7, { ...gateParam, mode: 'random' });
    const config = neutralResourceItemOf(f.hex.neutralResourceId).feature;
    Object.assign(config.gates[0], { value: 3, cooldownSeconds: 7 });
    Object.assign(config.gates[1], { value: 4, windowSeconds: 0.5, cooldownSeconds: 9 });
    f.state.units = [f.unit(1)];
    f.system.tick(f.state);
    assert.equal(f.clones(), 3);
    assert.equal(f.hex.neutralFeature.readyAt, 7);
    assert.equal(f.hex.neutralFeature.cooldownSeconds, 7);
    assert.equal(f.hex.neutralFeature.effect, 'multiply');
    f.state.elapsedSeconds = 7;
    f.state.units = [f.unit(2)];
    f.system.tick(f.state);
    assert.equal(f.clones(), 6);
    f.state.elapsedSeconds = 7.5;
    f.system.tick(f.state);
    assert.equal(f.hex.neutralFeature.readyAt, 16.5);
    assert.equal(f.hex.neutralFeature.cooldownSeconds, 9);
});

test('割草机穿过敌方建筑并只命中一次，虚空不入线，恢复后不重伤建筑', () => {
    const f = fixture(8, {});
    const neighbor = f.state.hexes[f.config.map.hexes[f.hex.id].neighbors[0]];
    neighbor.owner = 'player'; neighbor.developmentResolved = true;
    f.system.claim(f.state);
    const line = f.hex.neutralFeature.lineHexIds;
    assert.ok(line.length > 1);
    assert.ok(line.every(id => f.config.map.hexes[id].playable));
    const blocked = f.state.hexes[line[1]];
    blocked.owner = 'enemy'; blocked.building = 'barracks'; blocked.cardId = '68001';
    f.state.elapsedSeconds = 0.5;
    f.system.tick(f.state);
    assert.equal(f.hex.neutralFeature.lineHexIds.length, line.length);
    assert.deepEqual(f.structureHits, [blocked.id]);
    f.system.initialize(f.state);
    f.system.tick(f.state);
    f.state.elapsedSeconds = 10;
    f.system.tick(f.state);
    assert.deepEqual(f.structureHits, [blocked.id]);
    assert.equal(blocked.owner, 'enemy');
    f.hex.neutralFeature.hitUnitIds = [1];
    assert.equal(ZCSnapshotCodec.decode(f.state, f.config).ok, true);
    delete f.hex.neutralFeature.hitUnitIds;
    assert.equal(ZCSnapshotCodec.decode(f.state, f.config).ok, false);
});

test('割草机启动时已有建筑也不截断路线', () => {
    const f = fixture(8, {});
    const origin = f.config.map.hexes[f.hex.id];
    const from = f.config.map.hexes[origin.neighbors[0]];
    f.state.hexes[from.id].owner = 'player';
    f.state.hexes[from.id].developmentResolved = true;
    const next = origin.neighbors.find(id => Math.abs(f.config.map.hexes[id].x - origin.x - (origin.x - from.x)) < 2
        && Math.abs(f.config.map.hexes[id].y - origin.y - (origin.y - from.y)) < 2);
    assert.notEqual(next, undefined);
    Object.assign(f.state.hexes[next], { owner: 'enemy', building: 'barracks' });
    f.system.claim(f.state);
    assert.equal(f.hex.neutralFeature.lineHexIds[1], next);
});

test('已触发推车格可被路过小兵占领，未触发时保留资源', () => {
    const f = fixture(8, {});
    const enemy = f.unit(1, 'enemy');
    f.state.units = [enemy];
    const capture = new ZCCaptureSystem(new ZCMapGeometry(f.config.map), f.config.map,
        { ...f.config.rules, captureSeconds: 0.05, captureRequireSupply: false });
    const applyCapture = (hex: ZCHexState, owner: 'player' | 'enemy' | 'enemy2' | 'enemy3') => { hex.owner = owner; };
    capture.beginStep(f.state.units);
    capture.update(f.state, 0.05, applyCapture);
    assert.equal(f.hex.owner, 'neutral');
    const from = f.state.hexes[f.config.map.hexes[f.hex.id].neighbors[0]];
    from.owner = 'player'; from.developmentResolved = true;
    f.system.claim(f.state);
    capture.update(f.state, 0.05, applyCapture);
    assert.equal(f.hex.owner, 'enemy');
    assert.equal(f.hex.neutralFeature.mowerOwner, 'player');
});

test('真实模型推车伤害城墙和建筑，穿过友方建筑且读档不重复扣血', () => {
    const f = fixture(8, {});
    const from = f.state.hexes[f.config.map.hexes[f.hex.id].neighbors[0]];
    from.owner = 'player'; from.developmentResolved = true;
    f.state.units = [f.unit(1)];
    f.system.claim(f.state);
    const line = f.hex.neutralFeature.lineHexIds;
    assert.ok(line.length > 4);
    const damage = f.hex.neutralFeature.lineDamage;
    f.state.units = [];
    const wall = f.state.hexes[line[1]];
    const building = f.state.hexes[line[2]];
    const friendly = f.state.hexes[line[3]];
    for (const hex of [wall, building, friendly]) {
        Object.assign(hex, { owner: 'enemy', building: 'mine', cardId: '68001',
            hp: damage * 10, maxHp: damage * 10, wallHp: 0, wallMaxHp: 0,
            developmentResolved: true });
    }
    wall.wallHp = wall.wallMaxHp = damage * 10;
    friendly.owner = 'player';
    const model = new ZCGameModel(f.state, () => 0, f.config);
    model.tick(0.5);
    assert.equal(model.snapshot.hexes[wall.id].wallHp, damage * 9);
    assert.equal(model.snapshot.hexes[wall.id].hp, damage * 10);
    const restored = new ZCGameModel(model.exportSnapshot(), () => 0, f.config);
    restored.tick(1.1);
    assert.equal(restored.snapshot.hexes[wall.id].wallHp, damage * 9);
    assert.equal(restored.snapshot.hexes[building.id].hp, damage * 9);
    assert.equal(restored.snapshot.hexes[friendly.id].hp, damage * 10);
    assert.equal(restored.snapshot.hexes[line[4]].owner, 'neutral');
});


test('人口已满时不选择传送出口，也不消耗传送批次', () => {
    const f = fixture(9, {});
    const barracks = f.state.hexes[f.config.map.hexes[f.hex.id].neighbors[0]];
    barracks.owner = 'player'; barracks.building = 'barracks'; barracks.cardId = '68001';
    barracks.hp = barracks.maxHp = 100; barracks.constructionRemainingSeconds = 0;
    let selections = 0;
    const context = { rules: { unitCapPerSide: 1 }, cardById: () => findCatalogCard('68001'),
        unitCount: () => 1, spawnHex: () => { selections++; return { hexId: f.hex.id }; } };
    ZCEconomySystem.spawnFirstBarracksUnit(barracks, context as never);
    assert.equal(selections, 0);
});

test('兵营一批多单位只扣一次传送次数，并携带明确入口', () => {
    const f = fixture(9, { range: 3, uses: 2, cooldownSeconds: 8 });
    f.hex.owner = 'player'; f.hex.neutralFeature.claimed = true;
    const barracks = f.state.hexes[f.config.map.hexes[f.hex.id].neighbors[0]];
    Object.assign(barracks, { owner: 'player', building: 'barracks', cardId: '68001', hp: 100, maxHp: 100,
        constructionRemainingSeconds: 0 });
    const calls: unknown[][] = [];
    const card = { ...findCatalogCard('68001'), cycleBaseValue: 3 };
    const context = { rules: { unitCapPerSide: 100 }, cardById: () => card,
        unitCount: () => calls.length, spawnHex: () => f.system.spawnHex(f.state, barracks),
        spawnUnit: (...args: unknown[]) => calls.push(args) };
    ZCEconomySystem.spawnFirstBarracksUnit(barracks, context as never);
    assert.equal(calls.length, 3);
    assert.equal(f.hex.neutralFeature.usesRemaining, 1);
    assert.ok(calls.every(call => call[4] === f.hex.id && call[5] === barracks.id), '每个单位保留入口与真实产兵兵营');
});

test('传送没有敌兵时沿主城方向走最大范围，不因主城较近提前停下', () => {
    const f = fixture(9, { range: 3, uses: 2, cooldownSeconds: 8 });
    f.state.units = [];
    f.hex.owner = 'player'; f.hex.neutralFeature.claimed = true;
    const adjacent = f.config.map.hexes[f.hex.id].neighbors;
    const origin = f.config.map.hexes[f.hex.id];
    const home = adjacent.find(id => {
        const point = f.config.map.hexes[id];
        return point.x === origin.x && point.playable && f.state.hexes[id].building === 'none'
            && f.config.map.hexes.some(far => far.x === origin.x && far.y === origin.y + 3 * (point.y - origin.y)
                && far.playable && f.state.hexes[far.id].building === 'none');
    });
    assert.notEqual(home, undefined);
    const map = { ...f.config.map, homes: [f.config.map.homes[0], home] };
    const system = new ZCNeutralFeatureSystem(map, {} as never);
    const barracks = f.state.hexes[adjacent.find(id => id !== home)];
    barracks.owner = 'player';
    const spawn = system.spawnHex(f.state, barracks);
    const geometry = new ZCMapGeometry(f.config.map);
    assert.ok(geometry.distance(f.hex.id, spawn.hexId) > geometry.distance(f.hex.id, home),
        '主城在范围内时仍沿该方向传至更远的有效点');
});

test('真实模型传送保留飞行快照，落地前不行动，恢复不重复扣次数并拒绝非法入口', () => {
    const f = fixture(9, { range: 3, uses: 2, cooldownSeconds: 8 });
    f.hex.owner = 'player'; f.hex.neutralFeature.claimed = true;
    const barracks = f.state.hexes[f.config.map.hexes[f.hex.id].neighbors[0]];
    Object.assign(barracks, { owner: 'player', building: 'barracks', cardId: '68001', tier: 1, hp: 100, maxHp: 100,
        constructionRemainingSeconds: 0 });
    const model = new ZCGameModel(f.state, () => 0, f.config);
    const context = (model as unknown as { economyContext: ZCEconomyContext }).economyContext;
    ZCEconomySystem.spawnFirstBarracksUnit(barracks, context);
    const born = model.exportSnapshot();
    assert.ok(born.units.length > 0);
    const unit = born.units[0];
    assert.deepEqual(unit.portalFlight, { fromHexId: f.hex.id, barracksHexId: barracks.id, startedAt: 0 });
    const restored = new ZCGameModel(born, () => 0, f.config);
    restored.tick(ZC_PORTAL_FLIGHT_SECONDS / 2);
    const flying = restored.snapshot.units.find(item => item.id === unit.id);
    assert.equal(flying.battleState, 'born');
    assert.equal(flying.freeX, unit.freeX);
    assert.equal(flying.freeY, unit.freeY);
    assert.equal(restored.snapshot.hexes[f.hex.id].neutralFeature.usesRemaining, 1);
    restored.tick(ZC_PORTAL_FLIGHT_SECONDS);
    assert.notEqual(restored.snapshot.units.find(item => item.id === unit.id).battleState, 'born');
    unit.portalFlight.fromHexId = f.config.map.hexes.length;
    assert.equal(ZCSnapshotCodec.decode(born, f.config).ok, false);
});


test('focus interrupts combat only in reach/territory and cancellation retaliates against live current attackers', () => {
    const f = fixture(11, { resId: '68001', wakeRange: 2, reviveRate: 1 });
    const neighbor = f.state.hexes[f.config.map.hexes[f.hex.id].neighbors[0]];
    neighbor.owner = 'player'; neighbor.building = 'barracks'; neighbor.hp = 100;
    const soldier = f.unit(1), enemy = f.unit(2, 'enemy');
    soldier.targetBuildingHexId = f.hex.id; soldier.battleState = 'attack';
    enemy.targetUnitId = soldier.id; enemy.battleState = 'attack';
    enemy.freeX += 10;
    f.state.units = [soldier, enemy];
    f.state.nextUnitId = 3;
    const model = new ZCGameModel(f.state, () => 0, f.config);
    const access = model as unknown as { state: ZCSnapshot; unitTargeting: {
        refreshPriorityTarget(unit: ZCUnitState): boolean;
    }; neutralFeatures: ZCNeutralFeatureSystem };
    const own = access.state.units[0], opponent = access.state.units[1];
    assert.equal(model.toggleMonsterFocus(f.hex.id), true);
    assert.equal(own.targetBuildingHexId, f.hex.id);
    assert.equal(access.unitTargeting.refreshPriorityTarget(own), false, 'focus resists retaliation in territory');
    access.state.elapsedSeconds = 3;
    assert.equal(model.toggleMonsterFocus(f.hex.id), true);
    assert.equal(own.targetUnitId, opponent.id, 'cancel retaliates immediately without another hit');
    own.targetUnitId = null; own.targetBuildingHexId = f.hex.id;
    opponent.targetUnitId = null;
    own.hatredUnitId = opponent.id; own.hatredUntil = 100;
    assert.equal(access.unitTargeting.refreshPriorityTarget(own), false, 'historical hatred is not a live attacker');
    own.freeX += 10000; opponent.freeX = own.freeX + 1;
    own.targetUnitId = opponent.id; own.targetBuildingHexId = null;
    own.battleState = 'attack';
    access.state.elapsedSeconds = 6;
    assert.equal(model.toggleMonsterFocus(f.hex.id), true);
    assert.equal(own.targetUnitId, opponent.id, 'far combat continues');
    opponent.hp = 0;
    assert.equal(access.neutralFeatures.priorityTarget(access.state, own), f.hex.id, 'resume after opponent dies');
    own.freeX = f.config.map.hexes[f.hex.id].x;
    own.targetUnitId = opponent.id;
    assert.equal(access.unitTargeting.refreshPriorityTarget(own), true);
    assert.equal(own.targetBuildingHexId, f.hex.id);
});

test('monster params reject invalid multipliers, obsolete independent range and unsafe ground paths', () => {
    const card = findCatalogCard('68001');
    const compile = (param: unknown, icon: unknown = 0) => compileZCNeutralResourceCatalog([
        { groupId: 1, id: 1, groupName: 'monster', resourceType: 11, weight: 10000, param, icon },
    ], new Map([[card.id, card]]));
    for (const rate of [0, -1, NaN, Infinity, '1', null, undefined]) assert.throws(() => compile({ resId: card.id, wakeRange: 2, reviveRate: rate }));
    assert.throws(() => compile({ resId: card.id, wakeRange: 2, reviveRate: 1, attackRange: 2 }));
    for (const icon of ['../escape', 'a/b', '']) assert.throws(() => compile({ resId: card.id, wakeRange: 2, reviveRate: 1 }, icon));
    for (const rate of [0.8, 1, 1.2]) assert.equal(compile({ resId: card.id, wakeRange: 2, reviveRate: rate }, 'monster_ice').items.get(1).territoryIcon, 'monster_ice');
});

test('S-table monster rules preserve fractional seconds and reject blank, negative or fractional regeneration rates', () => {
    const rows = (cd: unknown, delay: unknown, rate: unknown) => [
        { key: 'neutralMonsterFocusSwitchCdSeconds', value: cd },
        { key: 'neutralMonsterRegenDelaySeconds', value: delay },
        { key: 'neutralMonsterRegenRate', value: rate },
    ];
    loadPvpTables({ ...tables, gameConfig: rows(0.5, 1.5, 1) });
    const config = captureZCMatchConfig();
    assert.equal(config.rules.neutralMonsterFocusSwitchCdSeconds, 0.5);
    assert.equal(config.rules.neutralMonsterRegenDelaySeconds, 1.5);
    for (const input of [rows(-1, 0, 0), rows('', 0, 0), rows(0, -1, 0), rows(0, 0, 0.5), rows(0, 0, NaN)]) {
        assert.throws(() => loadPvpTables({ ...tables, gameConfig: input }));
    }
    loadPvpTables(tables);
});

test('monster snapshot rejects malformed focus owners, cooldowns and retaliation state', () => {
    const f = fixture(11, { resId: '68001', wakeRange: 2, reviveRate: 1 });
    for (const invalid of [{ focusOwners: ['enemy'] }, { unlockedOwners: ['invalid'] },
        { focusReadyAt: { player: -1 } }, { retaliationUnitIds: [0] }, { disengagedAt: 1 }, { regenUpdatedAt: NaN }]) {
        const snapshot = ZCSnapshotCodec.clone(f.state);
        Object.assign(snapshot.hexes[f.hex.id].neutralFeature, invalid);
        assert.equal(ZCGameModel.isValidSnapshot(snapshot, f.config), false, JSON.stringify(invalid));
    }
});
