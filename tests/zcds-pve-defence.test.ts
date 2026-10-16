import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ZCGameModel } from '../assets/script/app/zcds/model/ZCGameModel';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { configureZCMap } from '../assets/script/app/zcds/model/ZCMapConfig';
import { captureZCMatchConfig, type ZCMatchConfig, type ZCPveDefenceWave } from '../assets/script/app/zcds/model/ZCMatchConfig';

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
