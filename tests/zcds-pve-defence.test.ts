import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { defenceMonsterScale, ZCGameModel } from '../assets/script/app/zcds/model/ZCGameModel';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { configureZCMap } from '../assets/script/app/zcds/model/ZCMapConfig';
import { captureZCMatchConfig, type ZCMatchConfig, type ZCPveDefenceWave } from '../assets/script/app/zcds/model/ZCMatchConfig';
import type { ZCHexState, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import type { ZCDeckCard } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import type { ZCUnitTargeting } from '../assets/script/app/zcds/model/systems/ZCUnitTargeting';
import { assetPath } from './helpers/asset-paths';

function rows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

const tableNames = [
    'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams',
    'skillAttrModifier', 'generalStar', 'pvpAttrMap', 'pvpModifierOverride',
    'pvpUnitGrowth', 'pvpSkillBinding', 'pvpStatus',
];
loadPvpTables(Object.fromEntries(tableNames.map((name) => [name, rows(name)])) as unknown as ZCPvpTables);
configureZCMap(JSON.parse(readFileSync(assetPath('config/maps/normal.json'), 'utf8')));

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

// 旧数据即使带着本地倍率，也不得影响新战斗的数值。
const timedWaves: readonly (ZCPveDefenceWave & { hpRate: number; attackRate: number })[] = [
    { waveId: 1, showAtSeconds: .1, cardId: '', monsterCount: 1, tier: 1, hpRate: 1, attackRate: 1 },
    { waveId: 2, showAtSeconds: .2, cardId: '', monsterCount: 1, tier: 1, hpRate: 2, attackRate: 1.5 },
];

test('territory defence spawns configured waves at deterministic times without local wave rates', () => {
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
        currentWaveIsBoss: false,
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
        // 2 波配置里第 1 波是普通小怪：只有最后一波才是 BOSS
        currentWaveIsBoss: false,
    });

    largeStep.tick(.1);
    assert.equal(largeStep.snapshot.units.length, 2);
    const second = largeStep.snapshot.units.find((unit) => unit.id !== first.id);
    assert.ok(second);
    assert.equal(second.attackMultiplier, 1);
    assert.equal(second.maxHp, first.maxHp, '不应用本地波次倍率');
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
        currentWaveHpRate: 1,
        currentWaveCardId: second.cardId,
        currentWaveIsBoss: true,
    });

    for (let index = 0; index < 4; index += 1) smallSteps.tick(.05);
    assert.deepEqual(smallSteps.exportSnapshot(), largeStep.exportSnapshot());
});

test('塔防清空本轮怪物后立即出下一波，死亡动画不阻塞且不连出多波', () => {
    const config = defenceConfig([
        { waveId: 1, showAtSeconds: .1, cardId: '', monsterCount: 2, tier: 1 },
        { waveId: 2, showAtSeconds: 30, cardId: '', monsterCount: 1, tier: 1 },
        { waveId: 3, showAtSeconds: 60, cardId: '', monsterCount: 1, tier: 1 },
    ]);
    const model = new ZCGameModel(null, () => .25, config);
    model.tick(.05);
    assert.equal(model.defenceWaveProgress?.spawnedWaves, 0, '首波仍等待配置时间');
    model.tick(.05);
    const firstWave = [...model.snapshot.units];
    Object.assign(firstWave[0], { hp: 0, battleState: 'dead', deathRemoveAt: 100 });
    model.tick(.05);
    assert.equal(model.defenceWaveProgress?.spawnedWaves, 1, '尚有一只存活时继续等待');
    Object.assign(firstWave[1], { hp: 0, battleState: 'dead', deathRemoveAt: 100 });
    model.tick(.05);
    assert.equal(model.defenceWaveProgress?.spawnedWaves, 2, '清空后无需等到 30 秒');
    assert.equal(model.defenceWaveProgress?.aliveEnemies, 1, '只提前生成下一波');
    assert.equal(model.snapshot.status, 'playing');

    const restored = new ZCGameModel(model.exportSnapshot(), () => .25, config);
    assert.equal(restored.defenceWaveProgress?.spawnedWaves, 2, '恢复快照保留提前出怪进度');
    restored.tick(.05);
    assert.equal(restored.defenceWaveProgress?.spawnedWaves, 2, '恢复后不重复生成第二波');
    for (const unit of restored.snapshot.units) {
        Object.assign(unit, { hp: 0, battleState: 'dead', deathRemoveAt: 100 });
    }
    restored.tick(.05);
    assert.equal(restored.defenceWaveProgress?.spawnedWaves, 3);
    for (const unit of restored.snapshot.units) {
        Object.assign(unit, { hp: 0, battleState: 'dead', deathRemoveAt: 100 });
    }
    restored.tick(.05);
    assert.equal(restored.snapshot.status, 'victory', '末波清空正常结算');
    for (const index of [-1, .5, 4, '2']) {
        assert.throws(() => new ZCGameModel({
            ...model.exportSnapshot(), nextDefenceWaveIndex: index,
        } as unknown as ReturnType<ZCGameModel['exportSnapshot']>, () => .25, config), /nextDefenceWaveIndex/);
    }
    restored.reset();
    assert.equal(restored.defenceWaveProgress?.spawnedWaves, 0, '重开清空提前出怪进度');
    restored.tick(.05);
    assert.equal(restored.defenceWaveProgress?.spawnedWaves, 0, '重开后首波重新等待');
});

test('塔防没有三分钟时限，超过原结束时间后仍能出怪、继续战斗和正常结算', () => {
    const config = defenceConfig([
        { waveId: 1, showAtSeconds: 181, cardId: '', monsterCount: 1, tier: 1 },
    ]);
    const model = new ZCGameModel(null, () => .25, config);
    assert.equal(model.remainingSeconds, null, '塔防不提供结束倒计时');
    const saved = model.exportSnapshot();
    saved.durationSeconds = 180;
    saved.elapsedSeconds = 179.95;
    const continuing = new ZCGameModel(saved, () => .25, config);
    continuing.tick(.1);
    assert.equal(continuing.snapshot.status, 'playing', '超过三分钟不按分数结算');
    assert.ok(continuing.snapshot.elapsedSeconds > 180);
    assert.equal(continuing.remainingSeconds, null);
    continuing.tick(1);
    assert.equal(continuing.defenceWaveProgress?.spawnedWaves, 1, '超过三分钟继续生成波次');
    assert.equal(continuing.snapshot.status, 'playing', '末波存活时不结束');
    const restored = new ZCGameModel(continuing.exportSnapshot(), () => .25, config);
    assert.equal(restored.snapshot.status, 'playing', '超时快照恢复仍继续战斗');
    const brokenHome = restored.exportSnapshot();
    brokenHome.hexes[config.map.playerHomeId].hp = 0;
    assert.equal(new ZCGameModel(brokenHome, () => .25, config).snapshot.status, 'defeat');
    for (const unit of restored.snapshot.units) Object.assign(unit, { hp: 0, battleState: 'dead' });
    restored.tick(.05);
    assert.equal(restored.snapshot.status, 'victory', '超时后仍按清空末波结算');

    const normal = new ZCGameModel(null, () => .25, captureZCMatchConfig({ ...config, pveDefence: undefined }));
    assert.equal(normal.remainingSeconds, normal.snapshot.durationSeconds, '普通对战保留时限');
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

test('塔防局的 NPC 照常翻地块（2026-11-09：NPC 靠翻地解锁新的怪物卡）', () => {
    const config = defenceConfig([
        { waveId: 1, showAtSeconds: 999, cardId: '', monsterCount: 1, tier: 1 },
    ]);
    const model = new ZCGameModel(null, () => .1, config);
    const before = model.snapshot.hexes.filter((hex) => hex.owner === 'enemy' && hex.developmentResolved).length;
    model.tick(config.rules.enemyAiIntervalSeconds + .1);
    const after = model.snapshot.hexes.filter((hex) => hex.owner === 'enemy' && hex.developmentResolved).length;
    assert.ok(after > before, '塔防局的 NPC 不能整局不动，必须翻地块');
    assert.equal(model.snapshot.units.length, 0, '这一段不该出怪');
});

/** 普通（非塔防）局面：AI 会翻地块，用它量「翻地块速度」。 */
function aiConfig(openGrideTime?: number): ZCMatchConfig {
    const base = captureZCMatchConfig();
    return captureZCMatchConfig({ ...base, pveDefence: undefined, ...(openGrideTime === undefined ? {} : { openGrideTime }) });
}

/** `tick` 单次最多推进 5 秒，长时段要分批喂。 */
function advanceBy(model: ZCGameModel, seconds: number): void {
    let left = seconds;
    while (left > 1e-9) {
        const step = Math.min(left, 5);
        model.tick(step);
        left -= step;
    }
}

function enemyDevelopedCount(model: ZCGameModel): number {
    return model.snapshot.hexes.filter((hex) => hex.owner === 'enemy' && hex.developmentResolved).length;
}

test('openGrideTime 是「两次翻格之间的最小间隔」，从第一次翻格之后开始计时', () => {
    const capped = aiConfig(18);
    const free = aiConfig();
    // 兜底前提：不配 openGrideTime 时 AI 仍按全局间隔翻（否则这条用例量不到东西）。
    const fast = new ZCGameModel(null, () => .1, free);
    const before = enemyDevelopedCount(fast);
    advanceBy(fast, free.rules.enemyAiIntervalSeconds + .1);
    assert.ok(enemyDevelopedCount(fast) > before, '未配置时 AI 应该已经翻过地块');

    const model = new ZCGameModel(null, () => .1, capped);
    const start = enemyDevelopedCount(model);
    // 首格不被间隔拖后：间隔只管「两次点击之间的距离」，计时从第一次翻格之后才开始。
    advanceBy(model, .1);
    assert.equal(enemyDevelopedCount(model), start + 1, '第一格不受 openGrideTime 限制');
    // 之后 3 秒（远小于 18）一格都不许再翻 —— 这里量的是「间距」，不是全局 2.8s 的旧口径。
    advanceBy(model, 3);
    assert.equal(enemyDevelopedCount(model), start + 1, 'openGrideTime 内不许再翻');
    // 距首格满 18 秒：放开一拍，且只翻一格。
    advanceBy(model, 15);
    assert.equal(enemyDevelopedCount(model), start + 2, '到点只翻一格');
    // 再等不足 18 秒：不许接着翻。
    advanceBy(model, 2.9);
    assert.equal(enemyDevelopedCount(model), start + 2);
});

test('塔防局 NPC 同样要翻地块解锁新卡，节奏仍受 openGrideTime 约束', () => {
    const base = captureZCMatchConfig();
    const playable = base.enemyDeck.find((card) => card.unitId);
    assert.ok(playable, 'test requires a spawnable enemy card');
    // 波次挂到 999 秒：整段用例里不会真的出怪，量到的变化只可能来自翻地。
    const config = captureZCMatchConfig({
        ...base,
        enemyDeck: [playable],
        openGrideTime: 18,
        pveDefence: {
            waves: [{ waveId: 1, showAtSeconds: 999, cardId: playable.id, monsterCount: 1, tier: 1 }],
        },
    });
    const model = new ZCGameModel(null, () => .1, config);
    const start = enemyDevelopedCount(model);
    // 塔防局以前整段跳过 AI（红方开局一格不动），这条守「必须动」+「首格不被拖后」。
    advanceBy(model, .1);
    assert.equal(enemyDevelopedCount(model), start + 1, '塔防局 NPC 开局就要翻第一格');
    // 之后 3 秒（远小于 18）不许再翻。
    advanceBy(model, 3);
    assert.equal(enemyDevelopedCount(model), start + 1, 'openGrideTime 内不许再翻');
    // 距首格满 18 秒：放开一拍 —— 塔防局的 NPC 不再整局不动。
    advanceBy(model, 15);
    assert.equal(enemyDevelopedCount(model), start + 2, '塔防局 NPC 必须翻地块，且到点只翻一格');
});

test('openGrideTime 的下限是 1 秒：填 1 真按 1 秒翻，不再被全局 2.8s 抬回去', () => {
    // 旧实现 `max(enemyAiIntervalSeconds, openGrideTime)` 会把 1~2.7 秒的配置**静默抬到 2.8s**，
    // 策划想调快等于没配（用户 2026-11-11）。现在下限固定 `ZC_AI_MIN_DEVELOP_INTERVAL_SECONDS = 1`。
    const fast = new ZCGameModel(null, () => .1, aiConfig(1));
    advanceBy(fast, 3.1);
    const fastCount = enemyDevelopedCount(fast);
    const slow = new ZCGameModel(null, () => .1, aiConfig());
    advanceBy(slow, 3.1);
    const slowCount = enemyDevelopedCount(slow);
    // 首格立刻翻，之后每 1 秒一拍 ⇒ 3.1 秒内 4 格；全局 2.8s 档只有 2 格。
    assert.ok(fastCount >= 4, `1 秒档 3.1s 内应翻 >= 4 格，实际 ${fastCount}`);
    assert.ok(fastCount > slowCount, `1 秒档必须比全局 2.8s 档快（${fastCount} vs ${slowCount}）`);
});

test('出怪表的怪物体型（monsterSize）要用上：BOSS 行放大模型，普通行保持原尺寸', () => {
    const base = captureZCMatchConfig();
    const playable = base.enemyDeck.filter((card) => card.unitId).slice(0, 2);
    assert.equal(playable.length, 2, 'test requires two spawnable enemy cards');
    const [minion, boss] = playable;
    const config = captureZCMatchConfig({
        ...base,
        enemyDeck: playable,
        pveDefence: {
            waves: [
                { waveId: 1, showAtSeconds: .05, cardId: minion.id, monsterCount: 1, tier: 1, monsterSize: 1 },
                { waveId: 2, showAtSeconds: .05, cardId: boss.id, monsterCount: 1, tier: 1, monsterSize: 2, isBoss: true },
            ],
        },
    });
    const model = new ZCGameModel(null, () => .25, config);
    model.tick(.05);
    const units = [...model.snapshot.units];
    const bossUnit = units.find((unit) => unit.cardId === boss.id);
    const minionUnit = units.find((unit) => unit.cardId === minion.id);
    assert.ok(bossUnit && minionUnit, '两波都要出场');
    assert.equal(bossUnit.gateScale, 2, 'BOSS 行的模型要按体型放大（gateScale 是视图缩放通道）');
    assert.equal(minionUnit.gateScale, undefined, '普通行不许被放大');
});

test('体型倍率：缺省 / 0 / 1 都不缩放，超上限封顶（防止表里手滑写大数）', () => {
    assert.equal(defenceMonsterScale(undefined), 1);
    assert.equal(defenceMonsterScale(null), 1);
    assert.equal(defenceMonsterScale(0), 1);
    assert.equal(defenceMonsterScale(1), 1);
    assert.equal(defenceMonsterScale(2), 2);
    assert.equal(defenceMonsterScale(99), 2.5);
    assert.equal(defenceMonsterScale(Number.NaN), 1);
});

test('塔防 BOSS 被打死即结算，未清完的中间波残兵不再阻塞胜利', () => {
    const base = captureZCMatchConfig();
    const playable = base.enemyDeck.filter((card) => card.unitId).slice(0, 2);
    assert.equal(playable.length, 2, 'test requires two spawnable enemy cards');
    const [minion, boss] = playable;
    const config = captureZCMatchConfig({
        ...base,
        enemyDeck: playable,
        pveDefence: {
            waves: [
                { waveId: 1, showAtSeconds: .05, cardId: minion.id, monsterCount: 1, tier: 1 },
                { waveId: 2, showAtSeconds: .05, cardId: boss.id, monsterCount: 1, tier: 1, isBoss: true },
            ],
        },
    });
    const model = new ZCGameModel(null, () => .25, config);
    model.tick(.05);
    const spawned = [...model.snapshot.units];
    const bossUnit = spawned.find((unit) => unit.cardId === boss.id);
    const minionUnit = spawned.find((unit) => unit.cardId === minion.id);
    assert.ok(bossUnit && minionUnit, '两波都该出场');
    assert.equal(model.snapshot.status, 'playing');

    // 只打死小怪：BOSS 还活着 ⇒ 不结算。
    Object.assign(minionUnit, { hp: 0, battleState: 'dead' });
    model.tick(.05);
    assert.equal(model.snapshot.status, 'playing', '清中间波不等于赢');

    // 打死 BOSS：即便还有别的怪，也立即胜利（「只有击败 BOSS 才算胜利」）。
    Object.assign(bossUnit, { hp: 0, battleState: 'dead' });
    model.tick(.05);
    assert.equal(model.snapshot.status, 'victory');
    assert.match(model.snapshot.resultReason, /BOSS 已被击败/);
});

test('territory defence settles victory after the final live monster and defeat after the player base is lost', () => {
    const config = defenceConfig([
        { waveId: 1, showAtSeconds: .05, cardId: '', monsterCount: 1, tier: 1 },
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
    assert.match(victory.snapshot.resultReason, /BOSS 已被击败/);

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
        { waveId: 1, showAtSeconds: 999, cardId: '', monsterCount: 1, tier: 1 },
    ]);
}

test('塔防主城可受伤，摧毁后立即跳到末波 Boss，保留场上怪物且不重复出怪', () => {
    const config = defenceConfig([
        { waveId: 1, showAtSeconds: .05, cardId: '', monsterCount: 1, tier: 1 },
        { waveId: 2, showAtSeconds: 50, cardId: '', monsterCount: 2, tier: 2 },
        { waveId: 3, showAtSeconds: 100, cardId: '', monsterCount: 1, tier: 4 },
    ]);
    const model = new ZCGameModel(null, () => .25, config);
    const combat = model as unknown as ICombatHarness;
    model.tick(.05);
    const first = model.snapshot.units[0];
    const home = model.snapshot.hexes[config.map.enemyHomeId];
    Object.assign(home, { wallHp: 0 });
    const hp = home.hp;
    combat.damageBuilding({ owner: 'player' }, home, 1);
    assert.equal(home.hp, hp - 1);
    assert.equal(model.defenceWaveProgress?.spawnedWaves, 1, '非致命伤不跳波');
    combat.damageBuilding({ owner: 'player' }, home, home.hp * 100);
    assert.equal(home.building, 'none');
    assert.equal(model.defenceWaveProgress?.currentWaveId, 3);
    assert.equal(model.defenceWaveProgress?.nextWaveId, null);
    assert.equal(model.snapshot.units.length, 2, '跳过中间波，已有第一波怪物保留');
    assert.equal(model.snapshot.units[0], first);
    const boss = model.snapshot.units.find((unit) => unit.id !== first.id);
    assert.ok(boss);
    assert.equal(boss.tier, 4, '按末波配置生成 Boss');
    assert.equal(boss.sourceHexId, home.id, 'Boss 从被摧毁的主城位置出现');
    assert.equal(model.defenceWaveProgress?.currentWaveMaxHp, boss.maxHp);
    assert.equal(model.damageStats.player.dealt, hp);
    combat.damageBuilding({ owner: 'player' }, home, 99999);
    model.tick(.05);
    assert.equal(model.snapshot.units.length, 2, '重复命中和后续计时不重复生成 Boss');
    assert.equal(model.snapshot.status, 'playing', '主城摧毁不能直接判胜');
    const restored = new ZCGameModel(model.exportSnapshot(), () => .25, config);
    assert.equal(restored.defenceWaveProgress?.currentWaveId, 3, '快照保留跳波进度');
    for (const unit of restored.snapshot.units) Object.assign(unit, { hp: 0, battleState: 'dead' });
    restored.tick(.05);
    assert.equal(restored.snapshot.status, 'victory');
});

test('塔防小兵通过实际攻击先破墙再拆主城，自动召出末波 Boss', () => {
    const config = defenceConfig([
        { waveId: 1, showAtSeconds: 999, cardId: '', monsterCount: 2, tier: 1 },
        { waveId: 2, showAtSeconds: 1999, cardId: '', monsterCount: 1, tier: 4 },
    ]);
    const model = new ZCGameModel(null, () => .25, config);
    const home = model.snapshot.hexes[config.map.enemyHomeId];
    Object.assign(home, { hp: 1, wallHp: 1 });
    const card = config.playerDeck.find((entry) => entry.unitId);
    assert.ok(card);
    const soldier = (model as unknown as ICombatHarness).spawnUnit('player', card, 1, home.id);
    assert.ok(soldier);
    const point = config.map.hexes[home.id];
    Object.assign(soldier, { freeX: point.x + 1, freeY: point.y });
    for (let i = 0; i < 300 && model.defenceWaveProgress?.currentWaveId !== 2; i += 1) model.tick(.05);
    assert.equal(home.building, 'none');
    assert.equal(model.defenceWaveProgress?.currentWaveId, 2);
    assert.ok(model.snapshot.units.some((unit) => unit.owner === 'enemy' && unit.tier === 4));
    assert.equal(model.snapshot.status, 'playing');
});

test('塔防主城摧毁触发的 Boss 不被已有兵力上限吞掉', () => {
    const base = defenceConfig([
        { waveId: 1, showAtSeconds: .05, cardId: '', monsterCount: 1, tier: 1 },
        { waveId: 2, showAtSeconds: 100, cardId: '', monsterCount: 1, tier: 4 },
    ]);
    const config = captureZCMatchConfig({ ...base, rules: { ...base.rules, unitCapPerSide: 1 } });
    const model = new ZCGameModel(null, () => .25, config);
    model.tick(.05);
    const home = model.snapshot.hexes[config.map.enemyHomeId];
    Object.assign(home, { wallHp: 0 });
    (model as unknown as ICombatHarness).damageBuilding({ owner: 'player' }, home, home.hp);
    assert.equal(model.snapshot.units.length, 2);
    assert.ok(model.snapshot.units.some((unit) => unit.tier === 4));
    assert.equal(model.defenceWaveProgress?.currentWaveId, 2);
});

test('塔防末波已出场后拆城不重复出 Boss，首波前拆城也可直接召出末波', () => {
    const config = defenceConfig([
        { waveId: 1, showAtSeconds: .05, cardId: '', monsterCount: 1, tier: 4 },
    ]);
    for (const spawnFirst of [false, true]) {
        const model = new ZCGameModel(null, () => .25, config);
        if (spawnFirst) {
            model.tick(.05);
            assert.equal(model.defenceWaveProgress?.spawnedWaves, 1);
        }
        const home = model.snapshot.hexes[config.map.enemyHomeId];
        Object.assign(home, { wallHp: 0 });
        (model as unknown as ICombatHarness).damageBuilding({ owner: 'player' }, home, home.hp);
        assert.equal(model.defenceWaveProgress?.spawnedWaves, 1);
        assert.equal(model.snapshot.units.length, 1);
        model.tick(.05);
        assert.equal(model.snapshot.status, 'playing');
    }
});

test('塔防敌方城墙可被击破，记录真实伤害与缺口', () => {
    const model = new ZCGameModel(null, () => .25, waitingWaveConfig());
    const combat = model as unknown as ICombatHarness;
    const wall = model.snapshot.hexes.find((hex) => hex.owner === 'enemy' && combat.hasExposedWall(hex));
    assert.ok(wall, '需要一段实际可攻击的敌方外墙');
    const beforeHp = wall.wallHp;
    const source = { owner: 'player' as const, freeX: 0, freeY: 0 };
    combat.damageWall(source, wall, beforeHp * 100);
    assert.equal(wall.wallHp, 0);
    assert.notEqual(wall.wallBreachedEdge, null);
    assert.equal(model.damageStats.player.dealt, beforeHp);
    assert.ok(model.floatTexts.length > 0);
    assert.equal(model.defenceWaveProgress?.spawnedWaves, 0, '仅破墙不触发 Boss');
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
    assert.ok(wall.wallHp < beforeHp, '等待下一波期间可以攻击城墙');
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
