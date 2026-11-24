/**
 * 分裂菇（68014）「一人成军」101404 的分身口径补全（2026-11-19 第 26 批）。
 *
 * 用户口径：
 *   「可以简单理解为分身技能：触发技能，在本体位置召唤出 3/4/6 只新的分裂菇，
 *     新的分裂菇 攻击力/生命值 只有本体的 30%/50%/80%，移动、攻击速度、攻击范围属性与本体一致，
 *     也会去寻找敌人攻击，分身的数量不加入单位计算数量，场上最多同时存在 12 个技能召唤出来的分裂菇，
 *     召唤出来的分裂菇血量为 0 才消失，当超过 12 个的个数限制时，分裂菇不释放该召唤技能。」
 *
 * 第 17 批已经把这条链落成 `summon_unit`（3/4/6 + 30/50/80% + 到战死）。本批补的是**分身语义**，
 * 五条都各自对应一处「不写就静默错」的地方：
 *
 *  1. **不占单位上限**：`spawnUnit(..., ignoreUnitCap = true)` 只绕过了「出生这一关」，
 *     `units.count(owner)` 照样把它算进去 ⇒ 12 只分身会把兵营的产兵名额吃光。
 *     正解是 `ZCUnitRegistry.regularCounts`（`markSummon` 把那一个名额还回去）。
 *  2. **12 只上限**：判据是「现有 + 这一批 ≤ 12 才放」，**不是**「放到 12 为止」的截断 ——
 *     设计说的是「不释放」，截断成 2 只等于偷偷改了召唤数量。
 *  3. **超限不消费累计次数**：`castSummon` 返回 false ⇒ `summonFiredCount` 原地不动，
 *     等场上死掉几只后下一次普攻立刻能补放；若消费了，就变成「白打 8 次」。
 *  4. **本体阵亡不散**：`syncSummons` 原来对召唤物一律「本体没了就收场」，
 *     分身必须跳过这一条（设计「血量为 0 才消失」）。
 *  5. **自己寻路追人**：`ZCUnitSystem` 对召唤物有短路（只索敌 + 出手、绝不移动），
 *     那是给舞伴钉阵位用的；分身要走完整状态机，否则站在本体脚下不动。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ZCGameModel } from '../assets/script/app/zcds/model/ZCGameModel';
import { configureZCMap, ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { compileZCCombatBuild, getZCModifierCatalogs } from '../assets/script/app/zcds/model/ZCModifierRuntime';
import { captureZCMatchConfig, type ZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import type { ZCSnapshot, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import { ZCSnapshotCodec } from '../assets/script/app/zcds/model/ZCSnapshotCodec';
import { ZCSkillTriggerSystem } from '../assets/script/app/zcds/model/systems/ZCSkillTriggerSystem';
import { ZCUnitSystem, type IZCUnitContext } from '../assets/script/app/zcds/model/systems/ZCUnitSystem';
import { assetPath } from './helpers/asset-paths';

const TABLE_NAMES = [
    'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams',
    'skillAttrModifier', 'generalStar', 'pvpAttrMap', 'pvpModifierOverride',
    'pvpUnitGrowth', 'pvpSkillBinding', 'pvpStatus', 'pvpSkillPlan',
];

const UNIT_ID = '68014';
const CHAIN = 101404;
const SKILL_ID = 30216;
const MAX_ALIVE = 12;
const TIERS = [
    { count: 3, inherit: 0.3, unlock: 9 },
    { count: 4, inherit: 0.5, unlock: 18 },
    { count: 6, inherit: 0.8, unlock: 27 },
];

function readRows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

function readClient(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(
        `D:/Alan/Project/POW/doc/塔防数据配置/json/client/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { data: Array<Record<string, unknown>> };
    return Array.isArray(source) ? source : source.data;
}

function prepare(): ZCMatchConfig {
    loadPvpTables(Object.fromEntries(TABLE_NAMES.map((name) => [name, readRows(name)])) as unknown as ZCPvpTables);
    configureZCMap(JSON.parse(readFileSync(assetPath('config/maps/normal.json'), 'utf8')));
    return captureZCMatchConfig();
}

function buildMatch(heroLevel: number, overrides: Partial<ZCMatchConfig['rules']> = {}): ZCMatchConfig {
    const captured = prepare();
    const loadout = compileZCCombatBuild({ unitId: UNIT_ID, heroLevel }, captured.units, getZCModifierCatalogs())
        .find((item) => item.sourceKey.startsWith('skillPlan:'));
    assert.ok(loadout, `68014 在兵种 ${heroLevel} 级必须编译出技能计划`);
    return {
        ...captured,
        rules: {
            ...captured.rules,
            combatDistanceScale: 1, combatDamageMultiplier: 1, enemyAiIntervalSeconds: 10000,
            ...overrides,
        },
        modifiers: { [ZCOwner.Player]: [loadout!], [ZCOwner.Enemy]: [] },
    } as ZCMatchConfig;
}

function makeUnit(id: number, overrides: Partial<ZCUnitState> = {}): ZCUnitState {
    return {
        id, owner: ZCOwner.Player, unitId: UNIT_ID, cardId: UNIT_ID, tier: 1,
        sourceHexId: 0, targetHexId: null, progress: 0,
        hp: 1200, maxHp: 1200, battleState: 'idle', stateTime: 0,
        targetUnitId: null, targetWallHexId: null, targetBuildingHexId: null,
        nextAttackAt: 0, waitUntil: 0, attackHitDone: false,
        hatredUnitId: null, hatredUntil: 0, facingRadians: 0, deathRemoveAt: 0,
        marchAngle: null, freeX: 0, freeY: 0, completedAttackCount: 0,
        ...overrides,
    } as ZCUnitState;
}

/** 场上已有的分身（`summonMasterId` 有值）。*/
function makeClone(id: number, masterId: number): ZCUnitState {
    return makeUnit(id, { summonMasterId: masterId, summonIndependent: true });
}

function makeModel(config: ZCMatchConfig, units: ZCUnitState[], elapsedSeconds = 0): ZCGameModel {
    const snapshot = ZCGameModel.createInitialState(() => 0.5, config);
    snapshot.units = units;
    snapshot.nextUnitId = 100;
    snapshot.elapsedSeconds = elapsedSeconds;
    return new ZCGameModel(snapshot, () => 0.5, config);
}

/**
 * 把「排队中的分身」全部兑现（2026-11-20 第 33 批起独立分身是排队出生的）。
 *
 * `summonUnits` 当拍只往 `pendingSummons` 里压条目：第 i 只在自己 `fxAtSeconds` 播特效、
 * `spawnAtSeconds` 才 `spawnUnit`。想数到人就必须把时钟推过去。
 */
function settlePendingSummons(model: ZCGameModel): void {
    for (let step = 0; step < 40; step += 1) {
        if (!tickPending(model, 0.05)) return;
    }
    assert.fail('队列推了 2 秒还没兑现完');
}

/** 时钟往前推 `dt` 并兑现一到点就该做的事；返回队列是否还有货。*/
function tickPending(model: ZCGameModel, dt: number): boolean {
    const state = model.snapshot as unknown as ZCSnapshot;
    state.elapsedSeconds = Math.round((state.elapsedSeconds + dt) * 1e9) / 1e9;
    (model as unknown as { flushPendingSummons(): void }).flushPendingSummons();
    return (state.pendingSummons?.length ?? 0) > 0;
}

function summon(model: ZCGameModel, master: ZCUnitState): boolean {
    const casted = (model as unknown as { summonUnits(unit: ZCUnitState): boolean }).summonUnits(master);
    //  生产环境这两步由 `advance()` 分多帧完成；夹具里直接一次推完，
    //  这样「召出 6 只」这类断言仍然读得到人。
    settlePendingSummons(model);
    return casted;
}

function syncSummons(model: ZCGameModel): void {
    (model as unknown as { syncSummons(): void }).syncSummons();
}

function clonesOf(model: ZCGameModel): ZCUnitState[] {
    return model.snapshot.units.filter((unit) => unit.summonMasterId !== undefined);
}

function registryCounts(model: ZCGameModel, owner: ZCOwner): { regular: number; all: number } {
    const units = (model as unknown as {
        units: { count(owner: ZCOwner): number; countAll(owner: ZCOwner): number };
    }).units;
    return { regular: units.count(owner), all: units.countAll(owner) };
}

function liveUnit(model: ZCGameModel, id: number): ZCUnitState {
    const unit = (model as unknown as { units: { byId: Map<number, ZCUnitState> } }).units.byId.get(id);
    assert.ok(unit, `模型里找不到 #${id}`);
    return unit!;
}

/** 模型里 `68014:30216` 那一袋（普攻行的技能袋）的参数。*/
function summonParams(model: ZCGameModel): Record<string, number> {
    const runtime = (model as unknown as {
        skillRuntime: Record<string, Map<string, { parameters?: Record<string, number> }>>;
    }).skillRuntime[ZCOwner.Player].get(`${UNIT_ID}:${SKILL_ID}`);
    assert.ok(runtime, `${UNIT_ID}:${SKILL_ID} 必须有运行时`);
    return runtime!.parameters ?? {};
}

// ────────────────────────────────────────────── 一、配表

test('101404 配表：三档都带「场上上限 12」与「独立分身」，其余键不变', () => {
    for (const rows of [readRows('pvpSkillPlan'), readClient('pvpSkillPlan')]) {
        const plan = rows.filter((row) => Number(row.skillChainId) === CHAIN)
            .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
        assert.equal(plan.length, 3);
        plan.forEach((row, index) => {
            const tier = TIERS[index];
            const bag = JSON.parse(String(row.skillParamJson)) as Record<string, number>;
            assert.equal(row.behaviorKey, 'summon_unit');
            assert.equal(Number(row.unitId), Number(UNIT_ID));
            assert.equal(Number(row.unlockHeroLevel), tier.unlock);
            assert.equal(bag.summonEvery, 8, '累计普攻 8 次');
            assert.equal(bag.summonCount, tier.count);
            assert.equal(bag.summonHpInherit, tier.inherit);
            assert.equal(bag.summonAttackInherit, tier.inherit);
            assert.equal(bag.summonMaxAlive, MAX_ALIVE, '场上最多同时存在 12 只');
            assert.equal(bag.summonIndependent, 1, '独立分身：自己追人 / 本体死了不散 / 不占名额');
            //  「到战死」= 不写秒数；`summonFollow` 也不许出现（独立分身不钉阵位）。
            assert.equal('summonSeconds' in bag, false);
            assert.equal('summonFollow' in bag, false);
            assert.equal('summonCooldown' in bag, false);
            assert.deepEqual(Object.keys(bag).filter((key) => !key.startsWith('summon')), []);
        });
        assert.match(String(plan[0].desc), /12 只/, 'desc 必须写清上限');
    }
});

test('103103 舞王没有被动到：仍是 4 只、有到期秒数、无上限', () => {
    //  🔴 只读 client（作者副本）：`assets/remoteRef/pvpSkillPlan.json` 目前对 102001 / 103103 /
    //  103503 三条链还停在第 17 批之前的旧快照（整棵 remoteRef 被批量还原过），
    //  那 9 行是**已知外部漂移**，不是本批引入的；`zcds-king-dance` 因此有 8 条红。
    for (const rows of [readClient('pvpSkillPlan')]) {
        const rowsOfDancer = rows.filter((row) => Number(row.skillChainId) === 103103);
        assert.equal(rowsOfDancer.length, 3);
        for (const row of rowsOfDancer) {
            const bag = JSON.parse(String(row.skillParamJson)) as Record<string, number>;
            assert.equal(bag.summonCount, 4);
            assert.ok(bag.summonSeconds > 0);
            assert.equal('summonMaxAlive' in bag, false);
            assert.equal('summonIndependent' in bag, false);
        }
    }
});

// ────────────────────────────────────────────── 二、不占单位上限

test('分身不加入单位计算数量：召完 regular 不变、总数照涨，兵营还能继续产兵', () => {
    const config = buildMatch(27, { unitCapPerSide: 8 });
    const model = makeModel(config, [makeUnit(1)]);
    const master = liveUnit(model, 1);
    const before = registryCounts(model, ZCOwner.Player);
    assert.equal(before.regular, 1, '夹具只有本体');

    assert.equal(summon(model, master), true);
    const after = registryCounts(model, ZCOwner.Player);
    assert.equal(clonesOf(model).length, 6, 'III 档 6 只');
    assert.equal(after.regular, 1, '🔴 分身不占名额：regular 一个都不许涨');
    assert.equal(after.all, 7, '总数照涨（索敌 / 结算仍看得见它们）');

    //  上限 8 的兵营还能继续产兵 —— 若分身占了名额，这里会拿到 null。
    master.hp = master.maxHp;   // 本体血条与名额无关，只是提醒：判据不是血量
    const spawn = (model as unknown as {
        spawnUnit(owner: ZCOwner, card: { id: string; unitId: string }, tier: number,
            hexId: number, ignoreUnitCap?: boolean): ZCUnitState | null;
    }).spawnUnit.bind(model);
    assert.ok(spawn(ZCOwner.Player, { id: UNIT_ID, unitId: UNIT_ID }, 1, 0), '普通出兵名额没被分身吃掉');
});

test('分身死掉之后名额也不会「欠账」：markDead 不许重复扣', () => {
    const config = buildMatch(27, { unitCapPerSide: 8 });
    const model = makeModel(config, [makeUnit(1)]);
    const master = liveUnit(model, 1);
    summon(model, master);
    for (const clone of clonesOf(model)) {
        clone.hp = 0;
        clone.battleState = 'dead';
        (model as unknown as { units: { markDead(unit: ZCUnitState): void } }).units.markDead(clone);
    }
    const counts = registryCounts(model, ZCOwner.Player);
    assert.equal(counts.regular, 1, '本体仍然是 1');
    assert.equal(counts.all, 1, '分身全部移出存活计数');
});

// ────────────────────────────────────────────── 三、12 只上限

test('场上已有 11 只时再召 3 只 ⇒ 整批拒放（不是截断成 1 只）', () => {
    const config = buildMatch(9);   // 兵种 9 级 = I 档「3 只」
    const units = [makeUnit(1)];
    for (let index = 0; index < 11; index += 1) units.push(makeClone(10 + index, 1));
    const model = makeModel(config, units);
    const master = liveUnit(model, 1);
    //  先钉住「参数真的在」：否则 false 可能来自「参数不全」，这条用例就白写了。
    assert.equal(summonParams(model).summonMaxAlive, MAX_ALIVE);

    assert.equal(summon(model, master), false, '11 + 3 > 12 ⇒ 不释放');
    assert.equal(clonesOf(model).length, 11, '一只都不许偷偷加进去');
});

test('场上已有 9 只时召 3 只 ⇒ 正好 12，放行', () => {
    const config = buildMatch(9);   // 兵种 9 级 = I 档「3 只」
    const units = [makeUnit(1)];
    for (let index = 0; index < 9; index += 1) units.push(makeClone(10 + index, 1));
    const model = makeModel(config, units);
    const master = liveUnit(model, 1);

    assert.equal(summon(model, master), true, '9 + 3 = 12 恰好到上限');
    assert.equal(clonesOf(model).length, MAX_ALIVE);
});

test('已死但还没被摘掉的分身不占上限名额', () => {
    const config = buildMatch(9);   // 兵种 9 级 = I 档「3 只」
    const units = [makeUnit(1)];
    for (let index = 0; index < 11; index += 1) {
        units.push(makeClone(10 + index, 1));
    }
    //  其中 3 只已经血量归零（等 removeDeadUnits 来收），有效数量是 8 ⇒ 8 + 3 = 11 ≤ 12。
    for (const unit of units.slice(1, 4)) {
        unit.hp = 0;
        unit.battleState = 'dead';
    }
    const model = makeModel(config, units);
    const master = liveUnit(model, 1);
    assert.equal(summon(model, master), true, '按「活着的」数，不按数组长度数');
    assert.equal(clonesOf(model).filter((unit) => unit.hp > 0).length, 11);
});

// ────────────────────────────────────────────── 四、超限不消费累计次数

function triggerContext(model: ZCGameModel, castSummon: (unit: ZCUnitState) => boolean) {
    const runtime = (model as unknown as {
        skillRuntime: Record<string, Map<string, unknown>>;
    }).skillRuntime[ZCOwner.Player].get(`${UNIT_ID}:${SKILL_ID}`);
    assert.ok(runtime, `${UNIT_ID}:${SKILL_ID} 必须有运行时`);
    return {
        statusSystem: {
            statModsOf: () => ({}), hasDef: () => false,
            apply: () => ({ applied: false }), exportSnapshot: () => ({ nextUid: 1, units: [] }),
        },
        runtimeOf: () => runtime,
        inAttackRange: () => false,
        healUnit: () => undefined,
        statPatchOf: () => ({}),
        castSummon,
    } as unknown as Parameters<typeof ZCSkillTriggerSystem.tick>[2];
}

test('被 12 只上限拒放时不消费累计次数，场上空出名额后下一次普攻立刻补放', () => {
    const config = buildMatch(9);   // 兵种 9 级 = I 档「3 只」
    const units = [makeUnit(1)];
    for (let index = 0; index < 11; index += 1) units.push(makeClone(10 + index, 1));
    const model = makeModel(config, units);
    const master = liveUnit(model, 1);
    const state = model.snapshot as unknown as ZCSnapshot;
    const context = triggerContext(model, (unit) => summon(model, unit));

    master.completedAttackCount = 7;
    ZCSkillTriggerSystem.tick(state, 0.05, context);   // 只记基线
    master.completedAttackCount = 15;
    ZCSkillTriggerSystem.tick(state, 0.05, context);

    assert.equal(master.summonFiredCount, 7, '🔴 拒放 ⇒ 计数原地不动（否则白打 8 次）');
    assert.equal(clonesOf(model).length, 11);

    //  场上死掉 5 只 ⇒ 6 + 3 = 9 ≤ 12，下帧就该补放（不需要再攒 8 次普攻）。
    for (const clone of clonesOf(model).slice(0, 5)) {
        clone.hp = 0;
        clone.battleState = 'dead';
    }
    ZCSkillTriggerSystem.tick(state, 0.05, context);
    assert.equal(master.summonFiredCount, 15, '补放成功才记账');
    assert.equal(clonesOf(model).filter((unit) => unit.hp > 0).length, 9);
});

// ────────────────────────────────────────────── 五、本体阵亡不散

test('独立分身：本体阵亡后照常活着，只有血量归零才消失', () => {
    const config = buildMatch(27);
    const model = makeModel(config, [makeUnit(1)]);
    const master = liveUnit(model, 1);
    summon(model, master);
    const clones = clonesOf(model);
    assert.equal(clones.length, 6);
    for (const clone of clones) assert.equal(clone.summonIndependent, true, '都带独立标记');

    //  本体被打死：舞伴那套会跟着收场，分身必须不受影响。
    master.hp = 0;
    master.battleState = 'dead';
    syncSummons(model);
    const alive = clonesOf(model).filter((unit) => unit.hp > 0 && unit.battleState !== 'dead');
    assert.equal(alive.length, 6, '🔴 本体死了不许把它们一起带走');

    //  血量归零才算消失。
    clones[0].hp = 0;
    syncSummons(model);
    assert.equal(clonesOf(model).filter((unit) => unit.hp > 0).length, 5);
});

test('舞伴（非独立）保持原口径：本体阵亡就散', () => {
    const config = buildMatch(27);
    const dancer = makeUnit(1, { unitId: '68031', cardId: '68031' });
    const model = makeModel(config, [dancer, makeUnit(2, {
        unitId: '68031', cardId: '68031', summonMasterId: 1, summonSlot: 0,
        summonSlotRadius: 60, summonUntil: 100,
    })]);
    const master = liveUnit(model, 1);
    const clone = liveUnit(model, 2);
    master.hp = 0;
    master.battleState = 'dead';
    syncSummons(model);
    assert.equal(clone.battleState, 'dead', '跟随型召唤物照旧跟着收场');
});

// ────────────────────────────────────────────── 六、自己寻路追人

function combatContext(options: { targetId: number; inRange: boolean }) {
    const clock = { now: 0 };
    const moves: string[] = [];
    const attacks: number[] = [];
    const target = { kind: 'unit', id: options.targetId, x: 200, y: 0, bodyRadius: 24, cardId: '68001' };
    const context = {
        now: () => clock.now,
        effectiveDefinition: () => ({
            unitId: UNIT_ID, maxHp: 1000, attack: 24, moveSpeed: 20, attackSpeed: 500,
            attackRange: 45, attackInterval: 1.8, attackDuration: 1.3, attackHitTime: 0.52,
            bodyRadius: 24, spawnSeconds: 0, flying: false, canAttackAir: true, hero: true,
            prefabPath: '', prefabSize: 1,
            attackProfile: { skillId: SKILL_ID, name: '普攻', mode: 'melee', projectileSpeed: 0 },
            secondaryProfile: undefined,
        }),
        controlOf: () => null,
        attackBlockedOf: () => false,
        random: () => 0.5,
        unitById: new Map<number, ZCUnitState>(),
        targeting: {
            acquire: (unit: ZCUnitState) => { unit.targetUnitId = options.targetId; },
            current: (unit: ZCUnitState) => (unit.targetUnitId === null ? null : target),
            isInAttackRange: () => options.inRange,
            isOutOfAttackRange: () => !options.inRange,
            findStepToward: () => 1,
            face: () => undefined,
            reportTargetChange: () => undefined,
        },
        movement: {
            advanceTowardUnit: () => { moves.push('toward'); },
            advanceUnitMovement: () => { moves.push('free'); },
            startMarch: () => { moves.push('march'); },
            advanceMarch: () => { moves.push('advanceMarch'); },
        },
        sendAttack: (unit: ZCUnitState) => { attacks.push(unit.targetUnitId ?? -1); },
    } as unknown as IZCUnitContext;
    return { context, clock, moves, attacks };
}

test('独立分身不再走「只索敌不移动」的短路：射程外会自己追上去', () => {
    prepare();
    const clone = makeUnit(5, {
        summonMasterId: 1, summonIndependent: true, battleState: 'move', targetUnitId: 2, targetHexId: 1,
    });
    const { context, clock, moves } = combatContext({ targetId: 2, inRange: false });
    for (let step = 0; step < 10; step += 1) {
        clock.now += 0.1;
        ZCUnitSystem.update([clone], 0.1, context);
    }
    assert.ok(moves.length > 0, '🔴 必须走正常寻路（否则 6 只分身会挤在本体脚下不动）');
});

test('跟随型舞伴仍然不动：短路对它们原样有效', () => {
    prepare();
    const clone = makeUnit(5, {
        summonMasterId: 1, summonSlot: 0, summonSlotRadius: 60, battleState: 'move', targetUnitId: 2,
    });
    const { context, clock, moves } = combatContext({ targetId: 2, inRange: false });
    for (let step = 0; step < 10; step += 1) {
        clock.now += 0.1;
        ZCUnitSystem.update([clone], 0.1, context);
    }
    assert.deepEqual(moves, [], '位置由 syncSummons 钉，自己一步都不走');
});

// ────────────────────────────────────────────── 七、生成表现（2026-11-20 第 33 批）

/** `ZC_EFFECT_PATHS.fissionSpawn`；特效目录里那一条的唯一路径。*/
const SPAWN_FX_PATH = 'units/projectiles/分裂菇_生成分身/分裂菇_生成分身';
/** 设计口径「以本体为圆心，20px 为半径的圆内」（逻辑 px）。*/
const SCATTER_RADIUS = 20;
/** 26 帧 ÷ 24fps，与 `tools/build_fission_spawn_fx.py` 的 `_duration` 必须一致。*/
const SPAWN_FX_SECONDS = 26 / 24;

/** 只施法、不推进时钟：拿到「排队中」的原始队列。*/
function castOnly(model: ZCGameModel, master: ZCUnitState): boolean {
    return (model as unknown as { summonUnits(unit: ZCUnitState): boolean }).summonUnits(master);
}

test('分身落点：以本体为圆心 20px 的圆内，且 6 只互不重叠', () => {
    const config = buildMatch(27);
    const model = makeModel(config, [makeUnit(1)]);
    const master = liveUnit(model, 1);
    const originX = master.freeX;
    const originY = master.freeY;

    assert.equal(summon(model, master), true);
    const clones = clonesOf(model);
    assert.equal(clones.length, 6);
    const seats = new Set<string>();
    let maxDistance = 0;
    for (const clone of clones) {
        const distance = Math.hypot(clone.freeX - originX, clone.freeY - originY);
        maxDistance = Math.max(maxDistance, distance);
        assert.ok(distance <= SCATTER_RADIUS + 1e-6, `落点 ${distance.toFixed(2)} 超出 ${SCATTER_RADIUS}px`);
        seats.add(`${clone.freeX.toFixed(3)},${clone.freeY.toFixed(3)}`);
    }
    assert.ok(maxDistance > 0, '不能全落在圆心（那就是没散开）');
    assert.equal(seats.size, 6, '🔴 6 只不许叠在同一个点上');
});

test('分身生成：0.1s 一只、先播 0.32s 特效再出现', () => {
    const config = buildMatch(27);
    const model = makeModel(config, [makeUnit(1)]);
    const master = liveUnit(model, 1);
    const state = model.snapshot as unknown as ZCSnapshot;

    assert.equal(castOnly(model, master), true);
    assert.equal(clonesOf(model).length, 0, '🔴 施法那一拍一个都还没出现');
    const pending = state.pendingSummons ?? [];
    assert.equal(pending.length, 6);
    pending.forEach((entry, index) => {
        assert.ok(Math.abs(entry.fxAtSeconds - index * 0.1) < 1e-9, `第 ${index} 只间隔 0.1s`);
        assert.ok(Math.abs(entry.spawnAtSeconds - (index * 0.1 + 0.32)) < 1e-9, '特效起播 0.32s 后才出生');
    });

    //  0.30s：前 4 只的特效已经在播，场上一只都没有 —— 这就是「先播放特效，再出现分身」。
    tickPending(model, 0.3);
    assert.equal(clonesOf(model).length, 0, '特效在播，分身还没出来');
    const fx = state.combatEvents.filter((event) => event.effectPrefabPath === SPAWN_FX_PATH);
    assert.equal(fx.length, 4, '到 0.30s 正好 4 条特效事件');
    assert.equal(fx[0].type, 'area');
    assert.ok(Math.abs(fx[0].durationSeconds - SPAWN_FX_SECONDS) < 1e-9, '寿命 = 26 帧 ÷ 24fps');
    assert.equal(fx[0].fromX, pending[0].x, '特效落在这一只的出生坐标上');
    assert.equal(fx[0].fromY, pending[0].y);

    //  0.35s：第一只出现（其余还在排队）。
    tickPending(model, 0.05);
    const spawned = clonesOf(model);
    assert.equal(spawned.length, 1, '只出现第一只');
    assert.equal(spawned[0].summonAlpha, 0.65, '设计口径：分身约 65% 透明');
    assert.equal(spawned[0].summonMasterId, 1);
    //  本体必须 100% 实心（2026-11-20 用户口径「只有分身有透明度，本体是 100% 实心的，
    //  透明度是用来区分本体和分身的」）—— 漏了这一半，看着就是「本体跟着变透」。
    assert.equal(master.summonAlpha, undefined, '本体不许被打上透明度');
});

test('排队中的分身也算 12 只名额：9 只在场 + 3 只正在生成 ⇒ 再召一批直接拒放', () => {
    const config = buildMatch(9);   // 兵种 9 级 = I 档「3 只」
    const units = [makeUnit(1)];
    for (let index = 0; index < 9; index += 1) units.push(makeClone(10 + index, 1));
    const model = makeModel(config, units);
    const master = liveUnit(model, 1);

    assert.equal(castOnly(model, master), true, '9 + 3 = 12，第一批放行');
    assert.equal(clonesOf(model).length, 9, '第一批还在排队');
    assert.equal(castOnly(model, master), false, '🔴 9 在场 + 3 排队 + 3 = 15 > 12 ⇒ 第二批拒放');
    assert.equal((model.snapshot as unknown as ZCSnapshot).pendingSummons?.length, 3, '拒放不许偷偷压进队列');
});

test('本体在特效期间阵亡：排队中的分身照样出生', () => {
    const config = buildMatch(27);
    const model = makeModel(config, [makeUnit(1)]);
    const master = liveUnit(model, 1);
    assert.equal(castOnly(model, master), true);

    master.hp = 0;
    master.battleState = 'dead';
    settlePendingSummons(model);
    assert.equal(clonesOf(model).length, 6, '🔴 队列里存的是施法那一刻的属性，不回头查本体');
    assert.equal(clonesOf(model).filter((clone) => clone.hp > 0).length, 6);
});

test('排队队列必须进快照白名单：合法的不报错，时刻写歪的报得出来', () => {
    const config = buildMatch(27);
    const model = makeModel(config, [makeUnit(1)]);
    const master = liveUnit(model, 1);
    assert.equal(castOnly(model, master), true);
    const state = model.snapshot as unknown as ZCSnapshot;
    assert.equal(state.pendingSummons?.length, 6);

    const errors = ZCSnapshotCodec.errors(state, config).filter((path) => path.startsWith('pendingSummons'));
    assert.deepEqual(errors, [], '合法队列不许报错');

    //  出生时刻早于特效时刻 = 读档回来「先出现、后播特效」，必须被挡。
    //  取第 2 只（`fxAtSeconds` = 0.1）：第 1 只的两个时刻都是 0，写成 0 仍然合法。
    const broken = JSON.parse(JSON.stringify(state)) as { pendingSummons: Array<Record<string, number>> };
    broken.pendingSummons[1].spawnAtSeconds = 0;
    const brokenErrors = ZCSnapshotCodec.errors(broken, config);
    assert.ok(brokenErrors.some((path) => path.startsWith('pendingSummons[1].spawnAtSeconds')),
        `写歪的时刻必须报出来，实际：${brokenErrors.join(',')}`);
});
