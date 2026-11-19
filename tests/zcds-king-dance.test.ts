/**
 * 艺术家（68031）「舞王召唤」103103（2026-11-18，第 17 批）—— 纯新增 `summon_unit` 车道。
 *
 * 设计案 K/L/M 三档（J 列冷却 12 秒，N 列是行为口径）：
 *   L1 兵种 9 级：4 个舞伴，继承 80% 生命 / 60% 攻击，持续 6 秒；
 *   L2 兵种 18 级：4 个，90% / 70%，持续 7 秒；
 *   L3 兵种 27 级：4 个，100% / 80%，持续 8 秒；
 *   N 列：「跟随本体移动（取消原圆形硬范围），主动攻击离自己最近的敌人；
 *          只做普攻与被动，不计入单位上限，到期一起消失」。
 *
 * 六个「照字面配就会静默错」的点，正是本用例要钉住的：
 *
 *  1. **这一行原来是 `self_cast`**（`selfCastDamagePct=240` 本体限时增伤），desc 却早就是
 *     召唤口径 —— 名字与参数不是一件事。整袋换车道后旧三键必须**一个不剩**：留着不报错，
 *     只会让下一个人以为「这技能还会给自己增伤」。
 *  2. **CD 必须自己一份**（`summonReadyAt`）。同卡 103104 迪斯科旋风占着 `selfCastReadyAt`，
 *     复用会变成「召完这个、那个也进冷却」，症状只是「偶尔少放一次」。
 *  3. **不计入单位上限**只能靠 `spawnUnit(..., ignoreUnitCap = true)`。满编时普通出兵被拒、
 *     召唤照出 4 个，是本用例唯一能证明的写法。
 *  4. **继承值必须落在单位身上**（`inheritedStats`）：`effectiveDefinition` 每帧从缓存折算，
 *     只改 definition 会被下一次刷新冲掉，观感是「舞伴血条一会儿高一会儿低」。
 *  5. **位置是硬钉的，朝向不能跟着被改**：`placeAt(..., keepFacing = true)`。否则本体一转圈，
 *     四个舞伴会各自扭头看自己"飞过去"的方向。
 *  6. **到期是「一起消失」不是「一起阵亡」**：`deathRemoveAt = now`（正常阵亡是
 *     `now + DEATH_SECONDS`），同一帧就被 `removeDeadUnits` 摘掉，不留尸体、不走阵亡动画。
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
import type { ZCSkillRuntimeDefinition } from '../assets/script/app/zcds/model/ZCSkillRuntime';
import { ZCSkillTriggerSystem } from '../assets/script/app/zcds/model/systems/ZCSkillTriggerSystem';
import { ZCUnitSystem, type IZCUnitContext } from '../assets/script/app/zcds/model/systems/ZCUnitSystem';
import { assetPath } from './helpers/asset-paths';

const TABLE_NAMES = [
    'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams',
    'skillAttrModifier', 'generalStar', 'pvpAttrMap', 'pvpModifierOverride',
    'pvpUnitGrowth', 'pvpSkillBinding', 'pvpStatus', 'pvpSkillPlan',
];

const CHAIN = 103103;
const UNIT_ID = '68031';
const SKILL_ID = 30706;
const MODIFIER_IDS = [94031031, 94031032, 94031033];
const UNLOCKS = [9, 18, 27];
/** 与配表逐字一致；三档只差 hp / attack / seconds。 */
const TIER_PARAMS: Array<Record<string, number>> = [
    {
        summonCooldown: 12, summonCount: 4, summonHpInherit: 0.8, summonAttackInherit: 0.6,
        summonSeconds: 6, summonFollow: 1, summonSlotRadius: 60, summonAlpha: 0.6,
    },
    {
        summonCooldown: 12, summonCount: 4, summonHpInherit: 0.9, summonAttackInherit: 0.7,
        summonSeconds: 7, summonFollow: 1, summonSlotRadius: 60, summonAlpha: 0.6,
    },
    {
        summonCooldown: 12, summonCount: 4, summonHpInherit: 1, summonAttackInherit: 0.8,
        summonSeconds: 8, summonFollow: 1, summonSlotRadius: 60, summonAlpha: 0.6,
    },
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

/** 按兵种等级编译这一档的构筑（`progressionMode: replace` ⇒ 27 级拿到的就是 III 级那行）。 */
function buildMatch(heroLevel = 27, overrides: Partial<ZCMatchConfig['rules']> = {}): ZCMatchConfig {
    const captured = prepare();
    const loadout = compileZCCombatBuild({ unitId: UNIT_ID, heroLevel }, captured.units, getZCModifierCatalogs())
        .find((item) => item.sourceKey.startsWith('skillPlan:'));
    assert.ok(loadout, `68031 在兵种 ${heroLevel} 级必须编译出技能计划`);
    return {
        ...captured,
        rules: {
            ...captured.rules,
            //  ⚠ 钉成 1：「阵位半径 60 表值」与「世界 60px」在用例里必须是同一个数，
            //  否则断言里得再乘一次 scale，改 scale 就会红在别处。
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

function makeModel(config: ZCMatchConfig, units: ZCUnitState[], elapsedSeconds = 0): ZCGameModel {
    const snapshot = ZCGameModel.createInitialState(() => 0.5, config);
    snapshot.units = units;
    snapshot.nextUnitId = 100;   // 召唤物从 100 起编号，和本体（1）不会撞
    snapshot.elapsedSeconds = elapsedSeconds;
    return new ZCGameModel(snapshot, () => 0.5, config);
}

/**
 * 取模型**自己**那份单位对象。
 *
 * 🔴 `new ZCGameModel(snapshot, ...)` 会把 `snapshot.units` 逐条解码成新对象
 * （`ZCSnapshotCodec` 的白名单重建），夹具里那个 `master` 从构造那一刻起就是死引用 ——
 * 改它的 `facingRadians` / `battleState`，模型完全看不见，用例会红在「为什么没生效」上。
 */
function liveUnit(model: ZCGameModel, id: number): ZCUnitState {
    const unit = (model as unknown as { units: { byId: Map<number, ZCUnitState> } }).units.byId.get(id);
    assert.ok(unit, `模型里找不到 #${id}`);
    return unit!;
}

/** 直接跑一次召唤（`summonUnits` 是私有方法：用例要的是「它自己怎么算」，不走触发车道）。 */
function summon(model: ZCGameModel, master: ZCUnitState): boolean {
    return (model as unknown as { summonUnits(unit: ZCUnitState): boolean }).summonUnits(master);
}

function summonsOf(model: ZCGameModel): ZCUnitState[] {
    return model.snapshot.units.filter((unit) => unit.summonMasterId !== undefined);
}

// ────────────────────────────────────────────── 一、配表真值

test('103103 三档：整袋换成 summon_unit，旧 self_cast 三个键一个不剩', () => {
    for (const rows of [readRows('pvpSkillPlan'), readClient('pvpSkillPlan')]) {
        const plan = rows.filter((row) => Number(row.skillChainId) === CHAIN)
            .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
        assert.equal(plan.length, 3, '三档都要在');
        plan.forEach((row, index) => {
            const want = TIER_PARAMS[index];
            const bag = JSON.parse(String(row.skillParamJson)) as Record<string, number>;
            assert.deepEqual(Object.keys(bag).filter((key) => !key.startsWith('summon')), [],
                '参数全带 summon 前缀，否则会串到 103101 / 103102 / 103104');
            for (const stale of ['selfCastCooldown', 'selfCastSeconds', 'selfCastDamagePct']) {
                assert.equal(stale in bag, false, `旧 self_cast 参数没清掉：${stale}`);
            }
            assert.equal(row.behaviorKey, 'summon_unit', '车道必须真的换掉（不是只改 desc）');
            assert.equal(row.skillKind, 'active_cd');
            assert.equal(row.stateMode, 'none');
            assert.equal(Number(row.unitId), Number(UNIT_ID));
            assert.equal(Number(row.pvpSkillId), SKILL_ID);
            assert.equal(Number(row.unlockHeroLevel), UNLOCKS[index]);
            assert.deepEqual(bag, want, `第 ${index + 1} 档参数与设计不一致`);
        });
    }
});

test('卡面描述三份逐字一致，修改器 94031031~33 已接上', () => {
    const plans = readRows('pvpSkillPlan')
        .filter((row) => Number(row.skillChainId) === CHAIN)
        .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
    //  desc 里必须能看到三档真正不同的那三个数（生命 / 攻击 / 秒数），否则改错档也没人发现。
    const marks = [['80%', '60%', '6 秒'], ['90%', '70%', '7 秒'], ['100%', '80%', '8 秒']];
    plans.forEach((row, index) => {
        for (const mark of marks[index]) {
            assert.ok(String(row.desc).includes(mark), `第 ${index + 1} 档 desc 少了「${mark}」：${row.desc}`);
        }
    });
    for (const cards of [readRows('armySkillLevelUp'), readClient('armySkillLevelUp')]) {
        const rows = cards.filter((row) => Number(row.id) === CHAIN)
            .sort((a, b) => Number(a.skilllevel) - Number(b.skilllevel));
        assert.equal(rows.length, 3);
        rows.forEach((row, index) => {
            assert.equal(row.name, '舞王召唤');
            assert.equal(row.desc, plans[index].desc);
            assert.equal(Number(row.unlockarmylevel), UNLOCKS[index]);
            assert.deepEqual(row.modfiy, [MODIFIER_IDS[index]]);
        });
    }
});

test('同卡另三条链没被带动（这袋共用 68031:30706）', () => {
    const rows = readRows('pvpSkillPlan');
    for (const chain of [103101, 103102, 103104]) {
        const kin = rows.filter((row) => Number(row.skillChainId) === chain);
        assert.equal(kin.length, 3, `${chain} 原有 3 档被动了`);
        for (const row of kin) {
            assert.equal(Number(row.unitId), Number(UNIT_ID));
            const bag = JSON.parse(String(row.skillParamJson)) as Record<string, number>;
            assert.equal(Object.keys(bag).some((key) => key.startsWith('summon')), false,
                `召唤参数串进了 ${chain}`);
        }
    }
});

// ────────────────────────────────────────────── 二、车道接线与快照

test('车道注册三处齐全：运行时 / 行为键白名单 / 触发系统', () => {
    const runtime = readFileSync('assets/script/app/zcds/model/ZCSkillRuntime.ts', 'utf8');
    assert.match(runtime, /register\('summon_unit'/, '参数永远进不了运行时');
    const schema = readFileSync('assets/script/app/zcds/model/ZCStatSchema.ts', 'utf8');
    assert.match(schema, /'summon_unit'/, 'behaviorKey 不在白名单 ⇒ 计划行会被判非法');
    const trigger = readFileSync('assets/script/app/zcds/model/systems/ZCSkillTriggerSystem.ts', 'utf8');
    assert.match(trigger, /applySummonUnit\(unit, params, now, context\)/, 'tick 里要真的被调用');
});

test('五个召唤字段 + summonReadyAt 都进了快照白名单（漏一个 ⇒ 读档后舞伴永不过期 / CD 白送）', () => {
    const types = readFileSync('assets/script/app/zcds/model/ZCGameTypes.ts', 'utf8');
    for (const field of ['summonUntil', 'summonMasterId', 'summonSlot', 'summonSlotRadius', 'summonAlpha', 'summonReadyAt']) {
        //  ⚠ `?` 必须转义：`summonUntil?: number;` 里的 `?` 会被当成量词，
        //  变成「summonUnti + 可选的 l + : number」—— 永远匹配不上，用例假红。
        assert.match(types, new RegExp(`${field}\\?: number;`), `${field} 没在 ZCUnitState 上声明`);
    }
    const codec = readFileSync('assets/script/app/zcds/model/ZCSnapshotCodec.ts', 'utf8');
    for (const field of ['summonUntil', 'summonMasterId', 'summonSlot', 'summonSlotRadius', 'summonAlpha', 'summonReadyAt']) {
        assert.ok(codec.includes(`'${field}'`), `${field} 不在 ZC_SNAPSHOT_UNIT_FIELDS 白名单里`);
    }
});

// ────────────────────────────────────────────── 三、触发车道

function triggerParams(overrides: Record<string, unknown>) {
    const runtime = {
        skillChainId: CHAIN, behaviorKey: 'summon_unit',
        trigger: 'none', stateMode: 'none', parameters: { ...TIER_PARAMS[0] },
    } as unknown as ZCSkillRuntimeDefinition;
    return {
        statusSystem: {
            statModsOf: () => ({}), hasDef: () => false,
            apply: () => ({ applied: false }), exportSnapshot: () => ({ nextUid: 1, units: [] }),
        },
        runtimeOf: () => runtime,
        inAttackRange: () => false,   // ← 故意「射程内没敌人」：召唤不该被射程闸门挡住
        healUnit: () => undefined,
        statPatchOf: () => ({}),
        ...overrides,
    } as unknown as Parameters<typeof ZCSkillTriggerSystem.tick>[2];
}

test('冷却制：开局首次只挂 CD；12 秒后召唤；用的是自己的 summonReadyAt', () => {
    prepare();
    const master = makeUnit(1);
    const state = { ...({} as ZCSnapshot), units: [master], elapsedSeconds: 0 } as unknown as ZCSnapshot;
    let casts = 0;
    const params = triggerParams({ castSummon: () => { casts += 1; return true; } });

    ZCSkillTriggerSystem.tick(state, 0.05, params);
    assert.equal(casts, 0, '首次只挂 CD，开局不立刻召');
    assert.equal(master.summonReadyAt, 12);
    assert.equal(master.selfCastReadyAt, undefined, '不许占用 103104 迪斯科旋风那格 CD');

    state.elapsedSeconds = 11.9;
    ZCSkillTriggerSystem.tick(state, 0.05, params);
    assert.equal(casts, 0, 'CD 没到不召');

    state.elapsedSeconds = 12;
    ZCSkillTriggerSystem.tick(state, 0.05, params);
    assert.equal(casts, 1, '射程内没敌人也照召（不设普攻射程闸门）');
    assert.equal(master.summonReadyAt, 24, 'CD 推到 now + 12');
    //  「主动出手」但**不原地锁住**：召完还要能跟本体走位，所以 castHoldUntil 不该被挂上。
    assert.equal(master.castHoldUntil, undefined, '召唤不许锁住本体');
});

test('参数不全被拒时不吃 CD（下帧重试）', () => {
    prepare();
    const master = makeUnit(1);
    const state = { ...({} as ZCSnapshot), units: [master], elapsedSeconds: 0 } as unknown as ZCSnapshot;
    const params = triggerParams({ castSummon: () => false });

    ZCSkillTriggerSystem.tick(state, 0.05, params);
    state.elapsedSeconds = 12;
    ZCSkillTriggerSystem.tick(state, 0.05, params);
    assert.equal(master.summonReadyAt, 12, '被拒之后 CD 原地不动');
});

test('没配 summonCooldown ⇒ 这条车道对这张卡是空的（不刷日志、不挂 CD）', () => {
    prepare();
    const master = makeUnit(1);
    const state = { ...({} as ZCSnapshot), units: [master], elapsedSeconds: 0 } as unknown as ZCSnapshot;
    let casts = 0;
    const runtime = {
        skillChainId: CHAIN, behaviorKey: 'summon_unit',
        trigger: 'none', stateMode: 'none', parameters: { summonCount: 4 },
    } as unknown as ZCSkillRuntimeDefinition;
    const params = triggerParams({ runtimeOf: () => runtime, castSummon: () => { casts += 1; return true; } });

    for (let step = 0; step < 400; step += 1) {
        state.elapsedSeconds = step * 0.05;
        ZCSkillTriggerSystem.tick(state, 0.05, params);
    }
    assert.equal(casts, 0);
    assert.equal(master.summonReadyAt, undefined);
});

// ────────────────────────────────────────────── 四、召唤本体

test('三档：4 个舞伴 + 80/90/100% 生命 + 60/70/80% 攻击 + 6/7/8 秒', () => {
    for (let index = 0; index < 3; index += 1) {
        const config = buildMatch(UNLOCKS[index]);
        const model = makeModel(config, [makeUnit(1)], 3);
        const master = liveUnit(model, 1);
        const base = (model as unknown as { effectiveUnitDefinition(unit: ZCUnitState): { attack: number } })
            .effectiveUnitDefinition(master);
        assert.equal(summon(model, master), true, `第 ${index + 1} 档必须召得出来`);

        const clones = summonsOf(model);
        assert.equal(clones.length, 4, `第 ${index + 1} 档召出 4 个`);
        const want = TIER_PARAMS[index];
        for (const clone of clones) {
            assert.equal(clone.summonMasterId, master.id, '记着本体是谁（本体死了要跟着收场）');
            assert.equal(clone.unitId, UNIT_ID, '复制本体，不另开兵种');
            assert.equal(clone.maxHp, Math.round(master.maxHp * want.summonHpInherit),
                `第 ${index + 1} 档生命继承 ${want.summonHpInherit * 100}%`);
            assert.equal(clone.hp, clone.maxHp, '满血召出');
            assert.ok(Math.abs(clone.inheritedStats!.attack - base.attack * want.summonAttackInherit) < 1e-6,
                `第 ${index + 1} 档攻击继承 ${want.summonAttackInherit * 100}%（基准含卡组加成，所以按比例判）`);
            assert.equal(clone.summonUntil, 3 + want.summonSeconds, `第 ${index + 1} 档持续 ${want.summonSeconds} 秒`);
            assert.equal(clone.summonAlpha, 0.6, '半透明（设计只写「半透明」，0.6 是补的）');
        }
    }
});

test('继承值落在 inheritedStats 上，且不改本体', () => {
    const config = buildMatch(27);
    const model = makeModel(config, [makeUnit(1)]);
    const master = liveUnit(model, 1);
    summon(model, master);
    for (const clone of summonsOf(model)) {
        assert.ok(clone.inheritedStats, '必须落在单位身上 —— 只改 definition 会被每帧刷新冲掉');
        assert.equal(clone.inheritedStats!.maxHp, clone.maxHp);
        //  `bodyRadius` / `attackInterval` 原样继承：舞伴不是「小一号的兵」，是同一双手。
        assert.equal(clone.inheritedStats!.bodyRadius, master.inheritedStats?.bodyRadius
            ?? (model as unknown as { effectiveUnitDefinition(u: ZCUnitState): { bodyRadius: number } })
                .effectiveUnitDefinition(master).bodyRadius);
    }
    assert.equal(master.summonUntil, undefined, '本体自己不是召唤物');
});

test('阵位：135/45/225/315 度 × 半径 60，跟着本体朝向一起转', () => {
    const config = buildMatch(27);
    const model = makeModel(config, [makeUnit(1, { freeX: 100, freeY: 50, facingRadians: 0 })]);
    const master = liveUnit(model, 1);
    summon(model, master);
    const clones = summonsOf(model).sort((a, b) => a.summonSlot! - b.summonSlot!);
    assert.deepEqual(clones.map((unit) => unit.summonSlot), [0, 1, 2, 3], '四个固定阵位');

    const radius = 60;
    const corners = [[135, -1, 1], [45, 1, 1], [225, -1, -1], [315, 1, -1]] as const;
    clones.forEach((clone, slot) => {
        const [, signX, signY] = corners[slot];
        const offset = radius * Math.SQRT1_2;
        assert.ok(Math.abs(clone.freeX - (100 + signX * offset)) < 1e-6, `slot${slot} x`);
        assert.ok(Math.abs(clone.freeY - (50 + signY * offset)) < 1e-6, `slot${slot} y`);
    });

    //  朝上（π/2）：整组阵位跟着转 90°，仍然围着本体。
    master.facingRadians = Math.PI / 2;
    for (const clone of clones) clone.facingRadians = 0.3;   // 摆位不许改朝向
    (model as unknown as { syncSummons(): void }).syncSummons();
    clones.forEach((clone) => {
        const distance = Math.hypot(clone.freeX - 100, clone.freeY - 50);
        assert.ok(Math.abs(distance - radius) < 1e-6, `slot${clone.summonSlot} 仍在半径 60 上`);
        assert.ok(Math.abs(clone.facingRadians - 0.3) < 1e-9, '朝向不能被「位移方向」覆盖');
    });
    //  slot0（135°）+ 90° = 225°：x、y 双双落负。
    assert.ok(clones[0].freeX < 100 && clones[0].freeY < 50, '阵位随本体朝向旋转');
});

test('到期一起消失：dead + deathRemoveAt = now（不是 now + 阵亡停留）', () => {
    const config = buildMatch(27);
    const model = makeModel(config, [makeUnit(1)], 0);
    summon(model, liveUnit(model, 1));
    const clones = summonsOf(model);
    assert.equal(clones.length, 4);

    const sync = (model as unknown as { syncSummons(): void });
    (model.snapshot as unknown as { elapsedSeconds: number }).elapsedSeconds = 7.9;
    sync.syncSummons();
    assert.equal(summonsOf(model).filter((unit) => unit.battleState === 'dead').length, 0, '没到点还活着');

    (model.snapshot as unknown as { elapsedSeconds: number }).elapsedSeconds = 8;
    sync.syncSummons();
    for (const clone of clones) {
        assert.equal(clone.battleState, 'dead');
        assert.equal(clone.hp, 0);
        assert.equal(clone.deathRemoveAt, 8,
            '正常阵亡是 now + DEATH_SECONDS；这里等于 now ⇒ 同一帧就摘掉，不留尸体');
    }
});

test('本体先死 ⇒ 舞伴跟着收场，不会留下没有位置可算的孤儿', () => {
    const config = buildMatch(27);
    const model = makeModel(config, [makeUnit(1)], 0);
    const master = liveUnit(model, 1);
    summon(model, master);
    const clones = summonsOf(model);

    master.battleState = 'dead';
    master.hp = 0;
    (model as unknown as { syncSummons(): void }).syncSummons();
    for (const clone of clones) {
        assert.equal(clone.battleState, 'dead');
        assert.equal(clone.deathRemoveAt, 0);
    }
    //  快照里本体和召唤物都在（清理走 `removeDeadUnits` 那条既有出口，不在这里 splice）。
    assert.equal(model.snapshot.units.length, 5);
});

test('不计入单位上限：满编时普通出兵被拒、召唤照出 4 个', () => {
    const config = buildMatch(27, { unitCapPerSide: 1 });
    const model = makeModel(config, [makeUnit(1)]);
    const master = liveUnit(model, 1);
    const spawn = (model as unknown as {
        spawnUnit(owner: ZCOwner, card: { id: string; unitId: string }, tier: number, hexId: number): ZCUnitState | null;
    }).spawnUnit.bind(model);

    //  上限 1、场上已有本体 ⇒ 普通通道必须被拒（这条断言是「上限真的生效」的对照）。
    assert.equal(spawn(ZCOwner.Player, { id: UNIT_ID, unitId: UNIT_ID }, 1, 0), null, '上限生效');
    assert.equal(summon(model, master), true, '召唤走 ignoreUnitCap 通道');
    assert.equal(summonsOf(model).length, 4, '四个都进去了，没有被上限吞掉');
});

test('参数不全（缺生命 / 攻击继承）⇒ 拒放，不召出「0 血 0 攻击」的摆设', () => {
    const config = buildMatch(27);
    const model = makeModel(config, [makeUnit(1)]);
    const master = liveUnit(model, 1);
    const runtime = (model as unknown as {
        skillRuntime: Record<string, Map<string, { parameters: Record<string, number> }>>;
    }).skillRuntime[ZCOwner.Player].get(`${UNIT_ID}:${SKILL_ID}`);
    assert.ok(runtime, '68031:30706 必须有运行时');
    assert.equal(runtime!.parameters.summonCount, 4, 'III 级参数已在运行时里');

    for (const broken of ['summonCount', 'summonHpInherit', 'summonAttackInherit']) {
        const saved = runtime!.parameters[broken];
        delete runtime!.parameters[broken];
        assert.equal(summon(model, master), false, `漏 ${broken} 必须拒放`);
        assert.equal(summonsOf(model).length, 0);
        runtime!.parameters[broken] = saved;
    }
});

// ────────────────────────────────────────────── 五、状态机（只做普攻）

function combatContext(options: {
    targetId: number | null;
    inRange: boolean;
    attackBlocked?: boolean;
}) {
    const clock = { now: 0 };
    const acquired: number[] = [];
    const attacks: number[] = [];
    const moves: string[] = [];
    const target = { kind: 'unit', id: options.targetId ?? 0, x: 40, y: 0, bodyRadius: 24, cardId: '68001' };
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
        attackBlockedOf: () => options.attackBlocked === true,
        random: () => 0.5,
        unitById: new Map<number, ZCUnitState>(),
        targeting: {
            acquire: (unit: ZCUnitState) => {
                acquired.push(unit.id);
                unit.targetUnitId = options.targetId;
            },
            current: (unit: ZCUnitState) => (unit.targetUnitId === null ? null : target),
            isInAttackRange: () => options.inRange,
            isOutOfAttackRange: () => !options.inRange,
            findStepToward: () => null,
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
    return { context, clock, acquired, attacks, moves };
}

test('召唤物不进自由行军：只索敌 + 出手，位置交给 syncSummons 钉', () => {
    prepare();
    const clone = makeUnit(5, { summonMasterId: 1, summonSlot: 0, summonSlotRadius: 60, battleState: 'idle' });
    const { context, clock, acquired, attacks, moves } = combatContext({ targetId: 2, inRange: false });

    //  射程外：只索敌，一步都不走（走了下一帧又会被拽回阵位 ⇒ 原地抽筋）。
    for (let step = 0; step < 20; step += 1) {
        clock.now += 0.1;
        ZCUnitSystem.update([clone], 0.1, context);
    }
    assert.ok(acquired.length > 0, '每帧都要重新索敌（目标会跑）');
    assert.deepEqual(moves, [], '不许走 `advanceUnitMovement` / `advanceTowardUnit`');
    assert.equal(clone.battleState, 'idle', '没目标可打就待机');
});

test('召唤物有敌人进射程就出手，打的是索敌给的那个人', () => {
    prepare();
    const clone = makeUnit(5, { summonMasterId: 1, summonSlot: 0, battleState: 'target', nextAttackAt: 0 });
    const { context, attacks } = combatContext({ targetId: 2, inRange: true });

    ZCUnitSystem.update([clone], 0.05, context);
    assert.equal(clone.battleState, 'attack', '进 attack 状态');
    assert.equal(clone.nextAttackAt, 1.8, '普攻间隔照本体算');

    //  攻击动作走完 `attackDuration`（1.3 秒）才回 idle —— 提前 return 会卡在第一帧挥拳姿势。
    for (let step = 0; step < 30; step += 1) ZCUnitSystem.update([clone], 0.05, context);
    assert.equal(clone.battleState, 'idle', '动作演完回 idle');
    assert.ok(attacks.length >= 1, '真的打出去了');
    assert.equal(attacks[0], 2, '打的是索敌给的那个人');
});

test('召唤物被软控（禁普攻）时原地站着，不改状态也不出手', () => {
    prepare();
    const clone = makeUnit(5, { summonMasterId: 1, summonSlot: 0, battleState: 'idle', nextAttackAt: 0 });
    const { context, attacks, acquired } = combatContext({ targetId: 2, inRange: true, attackBlocked: true });

    ZCUnitSystem.update([clone], 0.05, context);
    assert.equal(clone.battleState, 'idle');
    assert.deepEqual(attacks, []);
    assert.deepEqual(acquired, [], '连索敌都不做（软控禁的是这一整套出手链）');
});
