import assert from 'node:assert/strict';
import test from 'node:test';
import { compileZCNeutralResourceCatalog } from '../assets/script/app/zcds/model/ZCNeutralResourceGroup';
import { readFileSync, readdirSync } from 'node:fs';
import { setZCNeutralResourceCatalog, neutralResourceItemOf } from '../assets/script/app/zcds/model/ZCNeutralResourceGroup';
import { ZCNeutralFeatureSystem, isZCAwakeMonster } from '../assets/script/app/zcds/model/systems/ZCNeutralFeatureSystem';
import { ZCSnapshotCodec } from '../assets/script/app/zcds/model/ZCSnapshotCodec';
import { captureZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { ZCGameModel, configureZCMap } from '../assets/script/app/zcds/model/ZCGameModel';
import { findCatalogCard } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import type { ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import { ZCTileSystem } from '../assets/script/app/zcds/model/systems/ZCTileSystem';
import { resolveZCMapResources, resolveZCSpawnMatchConfig, ZCSpawnSelection } from '../assets/script/app/zcds/model/ZCSpawnSelection';
import type { ZCCombatTarget, ZCProjectileState, ZCHexState } from '../assets/script/app/zcds/model/ZCGameTypes';
import type { ZCDamageSource } from '../assets/script/app/zcds/model/ZCGameTypes';
import type { ZCStatusSystem } from '../assets/script/app/zcds/model/ZCStatusEffect';
import type { ZCUnitDefinition } from '../assets/script/app/zcds/model/ZCCombatCatalog';

const names = ['pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams', 'pvpBaseTeamWeight', 'neutralResourceGroup'];
const tables = Object.fromEntries(names.map(name => {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8'));
    return [name, Array.isArray(source) ? source : source.v.map((row: unknown[]) =>
        Object.fromEntries(source.k.map((key: string, index: number) => [key, row[index]])))];
})) as unknown as ZCPvpTables;
loadPvpTables(tables);
const gateParam = { effect: 'add', mode: 'fixed', value: 2, cooldownSeconds: 1, windowSeconds: 0.2,
    scale: 3, hpFlat: 1000, moveMultiplier: 2, attackSpeedMultiplier: 2, damageMultiplier: 0.5 };

test('常规随机池每张地图都投放趣味资源，源预设与发布资源一致并进入开局快照', () => {
    loadPvpTables(tables);
    for (const file of readdirSync('assets/resources/config/maps').filter(file => file.endsWith('.json'))) {
        const layout = JSON.parse(readFileSync(`assets/resources/config/maps/${file}`, 'utf8'));
        assert.deepEqual(layout, JSON.parse(readFileSync(`tools/map-editor/presets/${file}`, 'utf8')), file);
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

function fixture(type = 7, param: Record<string, unknown> = gateParam) {
    loadPvpTables(tables);
    configureZCMap(JSON.parse(readFileSync('assets/resources/config/maps/standard.json', 'utf8')));
    const base = captureZCMatchConfig();
    const card = findCatalogCard('68001');
    setZCNeutralResourceCatalog(compileZCNeutralResourceCatalog([
        { groupId: 14001, id: 1400101, groupName: '测试资源', resourceType: type, weight: 10000, param },
    ], new Map([[card.id, card]])));
    const config = { ...base, map: { ...base.map, resolvedResources: [] },
        rules: { ...base.rules, enemyAiIntervalSeconds: 10000 } };
    const state = ZCSnapshotCodec.createInitialState(config);
    const hex = state.hexes.find(hex => config.map.hexes[hex.id].playable && hex.owner === 'neutral'
        && config.map.hexes[hex.id].neighbors.length === 6);
    assert.ok(hex);
    hex.neutralResourceId = 1400101;
    let clones = 0;
    const batches: number[] = [];
    const system = new ZCNeutralFeatureSystem(config.map, {
        random: () => 0, definition: () => config.units[0], monsterDefinition: () => config.units[0],
        cloneUnit: () => { clones += 1; }, spawnBatch: hex => { if (hex.building === 'barracks') batches.push(hex.id); },
        damageUnit: (unit, damage) => { unit.hp -= damage; }, changed: () => {},
    });
    system.initialize(state);
    const unit = (id: number, owner: 'player' | 'enemy' = 'player'): ZCUnitState => ({
        id, owner, unitId: card.unitId, cardId: card.id, tier: 1, sourceHexId: hex.id,
        targetHexId: null, progress: 0, hp: 100, maxHp: 100, battleState: 'idle', stateTime: 0,
        targetUnitId: null, targetWallHexId: null, targetBuildingHexId: null, nextAttackAt: 100,
        waitUntil: 0, attackHitDone: false, hatredUnitId: null, hatredUntil: 0, facingRadians: 0,
        deathRemoveAt: 0, marchAngle: null, freeX: config.map.hexes[hex.id].x, freeY: config.map.hexes[hex.id].y,
    });
    return { config, state, hex, system, unit, batches, clones: () => clones };
}

test('趣味中立资源参数由组合表编译，不改变旧资源参数', () => {
    const catalog = compileZCNeutralResourceCatalog([
        { groupId: 14001, id: 1400101, groupName: '加法门', resourceType: 7, weight: 10000,
            param: { effect: 'add', mode: 'fixed', value: 2, cooldownSeconds: 10, windowSeconds: 0,
                scale: 3, hpFlat: 1000, moveMultiplier: 2, attackSpeedMultiplier: 2, damageMultiplier: 0.5 } },
        { groupId: 14002, id: 1400201, groupName: '衍生地块', resourceType: 8, weight: 10000, param: {} },
        { groupId: 14003, id: 1400301, groupName: '传送门', resourceType: 9, weight: 10000, param: {} },
        { groupId: 14004, id: 1400401, groupName: '号角', resourceType: 10, weight: 10000, param: {} },
    ], new Map());
    assert.equal(catalog.items.size, 4);
    assert.equal(catalog.items.get(1400101)?.visual, 'gate');
    assert.throws(() => compileZCNeutralResourceCatalog([
        { groupId: 1, id: 1, groupName: '错误门', resourceType: 7, weight: 1,
            param: { effect: 'add', cooldownSeconds: -1 } },
    ], new Map()), /param/);
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
    const f = fixture(11, { resId: '68001', wakeRange: 2, attackRange: 1 });
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
    const f = fixture(11, { resId: '68001', wakeRange: 2, attackRange: 1 });
    const model = new ZCGameModel(f.state, () => 0, f.config);
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
    configureZCMap(JSON.parse(readFileSync('assets/resources/config/maps/standard.json', 'utf8')));
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
    neighbor.building = 'barracks';
    f.state.spawnClocks[`barracks:${neighbor.id}`] = 4;
    f.system.claim(f.state);
    f.system.claim(f.state);
    assert.deepEqual(f.batches, [neighbor.id]);
    assert.equal(f.state.spawnClocks[`barracks:${neighbor.id}`], 4);
});

test('衍生线允许一次远离建筑的付费建造，失去归属后不能使用', () => {
    const f = fixture(8, {});
    const from = f.config.map.hexes[f.hex.id].neighbors[0];
    f.state.hexes[from].owner = 'player';
    f.system.claim(f.state);
    const line = f.hex.neutralFeature.lineHexIds;
    assert.ok(line.length > 0);
    const id = line[line.length - 1];
    assert.ok(ZCTileSystem.canDevelopFor(f.state, f.config.map, id, 'player'));
    f.state.hexes[id].owner = 'enemy';
    assert.equal(ZCTileSystem.canDevelopFor(f.state, f.config.map, id, 'player'), false);
    f.state.hexes[id].owner = 'player';
    ZCNeutralFeatureSystem.consumeBuild(f.state, id, 'player');
    assert.equal(ZCNeutralFeatureSystem.canBuild(f.state, id, 'player'), false);
});

test('真实开发入口仍扣原费用，失败不耗权，成功建造才耗权并占邻格', () => {
    const f = fixture(8, {});
    f.state.hexes[f.config.map.hexes[f.hex.id].neighbors[0]].owner = 'player';
    f.system.claim(f.state);
    const line = f.hex.neutralFeature.lineHexIds;
    const id = line[line.length - 1];
    assert.notEqual(id, undefined);
    f.state.goldByOwner.player = f.state.playerGold = 0;
    const poor = new ZCGameModel(f.state, () => 0, f.config);
    assert.equal(poor.developHex(id).ok, false);
    assert.equal(poor.snapshot.hexes[f.hex.id].neutralFeature.buildUsed, false);
    const saved = poor.exportSnapshot();
    saved.goldByOwner.player = saved.playerGold = 100000;
    const model = new ZCGameModel(saved, () => 0, f.config);
    assert.equal(model.setDebugDrawCard('68001', 1).ok, true);
    const cost = model.snapshot.hexes[id].developmentCost;
    assert.equal(model.developHex(id).ok, true);
    assert.equal(model.snapshot.goldByOwner.player, 100000 - cost);
    assert.equal(model.snapshot.hexes[f.hex.id].neutralFeature.buildUsed, true);
    assert.equal(model.snapshot.hexes[id].building, 'barracks');
    for (const neighbor of f.config.map.hexes[id].neighbors) {
        if (!saved.hexes[neighbor].neutralResourceId) assert.equal(model.snapshot.hexes[neighbor].owner, 'player');
    }
});

test('三人局不投放传送门，野怪睡眠时不是攻击目标', () => {
    const f = fixture(9, {});
    const system = new ZCNeutralFeatureSystem({ ...f.config.map, playerCount: 3 }, {} as never);
    delete f.hex.neutralFeature;
    system.initialize(f.state);
    assert.equal(f.hex.neutralResourceId, null);
    const m = fixture(11, { resId: '68001', wakeRange: 2, attackRange: 1 });
    assert.equal(isZCAwakeMonster(m.hex), false);
    m.state.hexes[m.config.map.hexes[m.hex.id].neighbors[0]].owner = 'player';
    m.system.claim(m.state);
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

test('传送每批选择唯一出口，失去出口后重选，出口旁兵营原地产兵', () => {
    const f = fixture(9, {});
    const portals = f.state.hexes.filter(hex => f.config.map.hexes[hex.id].playable && hex.building === 'none');
    const entrance = f.hex;
    const exit = portals.find(hex => hex.id !== entrance.id
        && !f.config.map.hexes[entrance.id].neighbors.includes(hex.id)
        && f.config.map.hexes[hex.id].neighbors.length > 0);
    assert.ok(exit);
    exit.neutralResourceId = entrance.neutralResourceId;
    f.system.initialize(f.state);
    entrance.owner = exit.owner = 'player';
    entrance.neutralFeature.claimed = exit.neutralFeature.claimed = true;
    // 用真实敌方主城坐标使指定出口成为最近门。
    const enemyHomeId = f.config.map.homes[1];
    const goal = f.config.map.hexes[enemyHomeId];
    const distance = (id: number) => Math.hypot(f.config.map.hexes[id].x - goal.x, f.config.map.hexes[id].y - goal.y);
    const near = distance(entrance.id) < distance(exit.id) ? entrance : exit;
    const far = near === entrance ? exit : entrance;
    const barracks = f.state.hexes[f.config.map.hexes[far.id].neighbors.find(id => !f.config.map.hexes[near.id].neighbors.includes(id))];
    assert.ok(barracks);
    barracks.owner = 'player';
    assert.equal(f.system.spawnHex(f.state, barracks), near.id);
    const local = f.state.hexes[f.config.map.hexes[near.id].neighbors[0]];
    local.owner = 'player';
    assert.equal(f.system.spawnHex(f.state, local), local.id);
    barracks.building = 'barracks';
    barracks.cardId = '68001';
    barracks.hp = barracks.maxHp = 100;
    barracks.constructionRemainingSeconds = 0;
    const model = new ZCGameModel(f.state, () => 0, f.config);
    const access = model as unknown as { state: typeof f.state; spawnFirstBarracksUnit(hex: ZCHexState): void };
    access.spawnFirstBarracksUnit(access.state.hexes[barracks.id]);
    assert.equal(model.snapshot.units.length, Math.max(1, Math.floor(findCatalogCard('68001').cycleBaseValue ?? 1)));
    assert.ok(model.snapshot.units.every(unit => unit.sourceHexId === near.id));
    near.owner = 'enemy';
    assert.equal(f.system.spawnHex(f.state, barracks), barracks.id);
});
