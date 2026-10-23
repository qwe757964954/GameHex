import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ZCGameModel } from '../assets/script/app/zcds/model/ZCGameModel';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { configureZCMap } from '../assets/script/app/zcds/model/ZCMapConfig';
import { captureZCMatchConfig, type ZCMatchConfig, type ZCPveDefenceWave } from '../assets/script/app/zcds/model/ZCMatchConfig';
import type { ZCHexState, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import type { ZCDeckCard } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import type { ZCUnitTargeting } from '../assets/script/app/zcds/model/systems/ZCUnitTargeting';

function rows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

const tableNames = [
    'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams', 'pvpBaseTeamWeight',
    'skillAttrModifier', 'generalStar', 'pvpAttrMap', 'pvpModifierOverride',
    'pvpUnitGrowth', 'pvpSkillBinding', 'pvpStatus',
];
loadPvpTables(Object.fromEntries(tableNames.map((name) => [name, rows(name)])) as unknown as ZCPvpTables);
configureZCMap(JSON.parse(readFileSync('assets/resources/config/maps/standard.json', 'utf8')));

function defenceConfig(waves: readonly ZCPveDefenceWave[]): ZCMatchConfig {
    const base = captureZCMatchConfig();
    const playable = base.enemyDeck.find((card) => card.unitId);
    assert.ok(playable, 'test requires a spawnable enemy card');
    return captureZCMatchConfig({
        ...base,
        enemyDeck: [playable],
        pveDefence: {
            waves: waves.map((wave) => ({ ...wave, cardId: playable.id })),
        },
    });
}

const timedWaves: readonly ZCPveDefenceWave[] = [
    { waveId: 1, showAtSeconds: .1, cardId: '', monsterCount: 1, tier: 1, hpRate: 1, attackRate: 1 },
    { waveId: 2, showAtSeconds: .2, cardId: '', monsterCount: 1, tier: 1, hpRate: 2, attackRate: 1.5 },
];

test('territory defence spawns configured waves at deterministic times with per-wave rates', () => {
    const config = defenceConfig(timedWaves);
    const largeStep = new ZCGameModel(null, () => .25, config);
    const smallSteps = new ZCGameModel(null, () => .25, config);

    assert.deepEqual(largeStep.defenceWaveProgress, {
        totalWaves: 2,
        spawnedWaves: 0,
        currentWaveId: null,
        nextWaveId: 1,
        secondsUntilNextWave: .1,
        aliveEnemies: 0,
        // 一波动还没出：本波血条三个数全是空值（HUD 会画一条空条）
        currentWaveHp: 0,
        currentWaveMaxHp: 0,
        currentWaveHpRate: 1,
        currentWaveCardId: null,
    });
    largeStep.tick(.05);
    assert.equal(largeStep.snapshot.units.length, 0);
    largeStep.tick(.05);
    assert.equal(largeStep.snapshot.units.length, 1);
    const first = largeStep.snapshot.units[0];
    assert.equal(first.attackMultiplier, 1);
    assert.deepEqual(largeStep.defenceWaveProgress, {
        totalWaves: 2,
        spawnedWaves: 1,
        currentWaveId: 1,
        nextWaveId: 2,
        secondsUntilNextWave: .1,
        aliveEnemies: 1,
        // 本波血条 = 本波剩余 / 本波总：分母是**生成那一刻记下**的 maxHp（不随死亡变小）
        currentWaveHp: first.hp,
        currentWaveMaxHp: first.maxHp,
        currentWaveHpRate: 1,
        currentWaveCardId: first.cardId,
    });

    largeStep.tick(.1);
    assert.equal(largeStep.snapshot.units.length, 2);
    const second = largeStep.snapshot.units.find((unit) => unit.id !== first.id);
    assert.ok(second);
    assert.equal(second.attackMultiplier, 1.5);
    assert.ok(second.maxHp >= first.maxHp * 1.9, `${second.maxHp} should reflect the second wave hpRate`);
    assert.deepEqual(largeStep.defenceWaveProgress, {
        totalWaves: 2,
        spawnedWaves: 2,
        currentWaveId: 2,
        nextWaveId: null,
        secondsUntilNextWave: null,
        aliveEnemies: 2,
        // 切到第 2 波后条只统计**第 2 波**的怪（第 1 波还活着但不算进这条）
        currentWaveHp: second.hp,
        currentWaveMaxHp: second.maxHp,
        currentWaveHpRate: 2,
        currentWaveCardId: second.cardId,
    });

    for (let index = 0; index < 4; index += 1) smallSteps.tick(.05);
    assert.deepEqual(smallSteps.exportSnapshot(), largeStep.exportSnapshot());
});

test('本波血条：分子随存活血量走，分母固定在生成那一刻', () => {
    const config = defenceConfig(timedWaves);
    const model = new ZCGameModel(null, () => .25, config);
    model.tick(.1);
    const unit = model.snapshot.units[0];
    assert.ok(unit, '第一波应当已经出怪');
    const wave = model.defenceWaveProgress;
    assert.ok(wave);
    assert.equal(wave.currentWaveMaxHp, unit.maxHp, '分母 = 生成那一刻的 maxHp');
    assert.equal(wave.currentWaveCardId, unit.cardId, 'HUD 靠这个 id 取首领头像与名字');

    // 打掉四分之三：分子要跟着掉，分母**不许**跟着掉（否则血条永远满格）
    // ⚠️ 快照里的字段是 `readonly`（对外是只读视图）⇒ 用 `Object.assign` 改活状态，
    //    与 `zcds-hud.test.ts` 改快照的手法是同一个。
    Object.assign(unit, { hp: Math.max(1, Math.round(unit.maxHp / 4)) });
    assert.equal(model.defenceWaveProgress?.currentWaveHp, unit.hp);
    assert.equal(model.defenceWaveProgress?.currentWaveMaxHp, unit.maxHp);

    // 死掉的怪不再计入剩余血量（分母保持不动）
    Object.assign(unit, { battleState: 'dead' });
    assert.equal(model.defenceWaveProgress?.currentWaveHp, 0);
    assert.equal(model.defenceWaveProgress?.currentWaveMaxHp, unit.maxHp);
});

test('territory defence disables ordinary enemy expansion while waves are pending', () => {
    const config = defenceConfig([
        { waveId: 1, showAtSeconds: 999, cardId: '', monsterCount: 1, tier: 1, hpRate: 1, attackRate: 1 },
    ]);
    const model = new ZCGameModel(null, () => .1, config);
    const before = model.snapshot.hexes.filter((hex) => hex.owner === 'enemy' && hex.developmentResolved).length;
    model.tick(config.rules.enemyAiIntervalSeconds + .1);
    const after = model.snapshot.hexes.filter((hex) => hex.owner === 'enemy' && hex.developmentResolved).length;
    assert.equal(after, before);
    assert.equal(model.snapshot.units.length, 0);
});

test('territory defence settles victory after the final live monster and defeat after the player base is lost', () => {
    const config = defenceConfig([
        { waveId: 1, showAtSeconds: .05, cardId: '', monsterCount: 1, tier: 1, hpRate: 1, attackRate: 1 },
    ]);
    const spawned = new ZCGameModel(null, () => .1, config);
    spawned.tick(.05);
    const cleared = JSON.parse(JSON.stringify(spawned.exportSnapshot()));
    for (const unit of cleared.units) {
        unit.hp = 0;
        unit.battleState = 'dead';
    }
    const victory = new ZCGameModel(cleared, () => .1, config);
    assert.equal(victory.snapshot.status, 'victory');
    assert.match(victory.snapshot.resultReason, /全部 1 波/);

    const brokenBase = JSON.parse(JSON.stringify(new ZCGameModel(null, () => .1, config).exportSnapshot()));
    brokenBase.hexes[config.map.playerHomeId].hp = 0;
    const defeat = new ZCGameModel(brokenBase, () => .1, config);
    assert.equal(defeat.snapshot.status, 'defeat');
    assert.match(defeat.snapshot.resultReason, /主城领地已失守/);
});

interface ICombatHarness {
    damageWall(source: Pick<ZCUnitState, 'owner' | 'freeX' | 'freeY'>, wall: ZCHexState, damage: number): void;
    damageBuilding(source: Pick<ZCUnitState, 'owner'>, building: ZCHexState, damage: number): void;
    hasExposedWall(wall: ZCHexState): boolean;
    spawnUnit(owner: ZCUnitState['owner'], card: ZCDeckCard, tier: number, hexId: number): ZCUnitState | null;
    readonly unitTargeting: ZCUnitTargeting;
}

function waitingWaveConfig(): ZCMatchConfig {
    return defenceConfig([
        { waveId: 1, showAtSeconds: 999, cardId: '', monsterCount: 1, tier: 1, hpRate: 1, attackRate: 1 },
    ]);
}

test('波次战斗敌方主城无敌：不扣血、不易主、不发拆城奖励或虚假伤害', () => {
    const config = waitingWaveConfig();
    const model = new ZCGameModel(null, () => .25, config);
    const combat = model as unknown as ICombatHarness;
    const home = model.snapshot.hexes[config.map.enemyHomeId];
    Object.assign(home, { wallHp: 0 });
    const before = JSON.stringify(model.exportSnapshot());
    combat.damageBuilding({ owner: 'player' }, home, home.hp * 100);
    assert.equal(JSON.stringify(model.exportSnapshot()), before);
    assert.equal(model.damageStats.player.dealt, 0);
    assert.equal(model.floatTexts.length, 0);
});

test('波次战斗敌方城墙无敌，连续攻击不破墙、不改缺口或伤害统计', () => {
    const model = new ZCGameModel(null, () => .25, waitingWaveConfig());
    const combat = model as unknown as ICombatHarness;
    const wall = model.snapshot.hexes.find((hex) => hex.owner === 'enemy' && combat.hasExposedWall(hex));
    assert.ok(wall, '需要一段实际可攻击的敌方外墙');
    const before = JSON.stringify(wall);
    const source = { owner: 'player' as const, freeX: 0, freeY: 0 };
    combat.damageWall(source, wall, wall.wallHp * 100);
    combat.damageWall(source, wall, wall.wallHp * 100);
    assert.equal(JSON.stringify(wall), before);
    assert.equal(model.damageStats.player.dealt, 0);
    assert.equal(model.floatTexts.length, 0);
});

test('波次模式保留向敌方城墙集结和攻击新怪的索敌能力', () => {
    const config = waitingWaveConfig();
    const model = new ZCGameModel(null, () => .25, config);
    const combat = model as unknown as ICombatHarness;
    const wall = model.snapshot.hexes.find((hex) => hex.owner === 'enemy' && combat.hasExposedWall(hex));
    const card = config.playerDeck.find((entry) => entry.unitId);
    assert.ok(wall && card);
    const soldier = combat.spawnUnit('player', card, 1, wall.id);
    assert.ok(soldier);
    const point = config.map.hexes[wall.id];
    Object.assign(soldier, { freeX: point.x + 1, freeY: point.y });
    combat.unitTargeting.acquire(soldier);
    assert.equal(combat.unitTargeting.current(soldier)?.kind, 'wall');
    const beforeHp = wall.wallHp;
    for (let i = 0; i < 80; i++) model.tick(.05);
    assert.equal(wall.wallHp, beforeHp, '等待下一波期间不能拆墙');
    const monster = combat.spawnUnit('enemy', card, 1, wall.id);
    assert.ok(monster);
    Object.assign(monster, { freeX: soldier.freeX, freeY: soldier.freeY });
    combat.unitTargeting.acquire(soldier);
    assert.equal(combat.unitTargeting.current(soldier)?.id, monster.id);
    assert.equal(combat.unitTargeting.current(soldier)?.kind, 'unit');
});

for (const structure of ['wall', 'building'] as const) {
    for (const state of ['idle', 'waitAttack', 'attack', 'move'] as const) {
        test(`波次新怪比${structure}远时，${state}状态及时离开建筑目标迎怪`, () => {
            const config = waitingWaveConfig();
            const model = new ZCGameModel(null, () => .25, config);
            const combat = model as unknown as ICombatHarness;
            const home = model.snapshot.hexes[config.map.enemyHomeId];
            if (structure === 'building') Object.assign(home, { wallHp: 0 });
            const card = config.playerDeck.find((entry) => entry.unitId);
            assert.ok(card);
            const soldier = combat.spawnUnit('player', card, 1, home.id);
            assert.ok(soldier);
            const point = config.map.hexes[home.id];
            Object.assign(soldier, { freeX: point.x + 1, freeY: point.y });
            combat.unitTargeting.acquire(soldier);
            assert.equal(combat.unitTargeting.current(soldier)?.kind, structure);
            Object.assign(soldier, { battleState: state, stateTime: 0, nextAttackAt: 10, waitUntil: 10 });
            const monster = combat.spawnUnit('enemy', card, 1, home.id);
            assert.ok(monster);
            Object.assign(monster, { freeX: point.x + 350, freeY: point.y });
            model.tick(.05);
            assert.equal(soldier.targetUnitId, monster.id, '怪物比建筑远也必须优先');
            assert.equal(soldier.targetWallHexId, null);
            assert.equal(soldier.targetBuildingHexId, null);
            assert.equal(soldier.battleState, 'move', '不等旧建筑攻击冷却结束才追怪');
            Object.assign(monster, { battleState: 'dead', hp: 0 });
            combat.unitTargeting.acquire(soldier);
            assert.equal(combat.unitTargeting.current(soldier)?.kind, structure, '怪物清完恢复原有集结目标');
        });
    }
}

test('普通对战仍按距离索敌，不因波次优先规则放弃更近的城墙', () => {
    const config = captureZCMatchConfig({ ...waitingWaveConfig(), pveDefence: undefined });
    const model = new ZCGameModel(null, () => .25, config);
    const combat = model as unknown as ICombatHarness;
    const home = model.snapshot.hexes[config.map.enemyHomeId];
    const card = config.playerDeck.find((entry) => entry.unitId);
    assert.ok(card);
    const soldier = combat.spawnUnit('player', card, 1, home.id);
    const monster = combat.spawnUnit('enemy', card, 1, home.id);
    assert.ok(soldier && monster);
    const point = config.map.hexes[home.id];
    Object.assign(soldier, { freeX: point.x + 1, freeY: point.y });
    Object.assign(monster, { freeX: point.x + 350, freeY: point.y });
    combat.unitTargeting.acquire(soldier);
    assert.equal(combat.unitTargeting.current(soldier)?.kind, 'wall');
});

test('波次模式我方建筑仍可受伤，普通对战敌方主城和城墙仍可被拆毁', () => {
    const config = waitingWaveConfig();
    const defence = new ZCGameModel(null, () => .25, config);
    const defenceCombat = defence as unknown as ICombatHarness;
    const playerWall = defence.snapshot.hexes.find((hex) => hex.owner === 'player' && defenceCombat.hasExposedWall(hex));
    assert.ok(playerWall);
    const playerWallHp = playerWall.wallHp;
    defenceCombat.damageWall({ owner: 'enemy', freeX: 0, freeY: 0 }, playerWall, 1);
    assert.equal(playerWall.wallHp, playerWallHp - 1);
    const playerHome = defence.snapshot.hexes[config.map.playerHomeId];
    Object.assign(playerHome, { wallHp: 0 });
    const playerHp = playerHome.hp;
    (defence as unknown as ICombatHarness).damageBuilding({ owner: 'enemy' }, playerHome, 1);
    assert.equal(playerHome.hp, playerHp - 1);

    const normal = new ZCGameModel(null, () => .25, captureZCMatchConfig({ ...config, pveDefence: undefined }));
    const combat = normal as unknown as ICombatHarness;
    const wall = normal.snapshot.hexes.find((hex) => hex.owner === 'enemy' && combat.hasExposedWall(hex));
    assert.ok(wall);
    combat.damageWall({ owner: 'player', freeX: 0, freeY: 0 }, wall, wall.wallHp * 2);
    assert.equal(wall.wallHp, 0);
    const home = normal.snapshot.hexes[config.map.enemyHomeId];
    Object.assign(home, { wallHp: 0 });
    combat.damageBuilding({ owner: 'player' }, home, home.hp * 2);
    assert.equal(home.building, 'none');
    assert.equal(home.owner, 'player');
});
