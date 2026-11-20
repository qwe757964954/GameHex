/**
 * 第 17 批尾段（2026-11-18）：「未实现主动」最后四条一次落地。
 *
 *   101404 一人成军（分裂菇 68014）  → `summon_unit`（复用）+ **累计普攻 8 次**触发
 *   102204 嗜血术（雷蕉 68022）      → `team_buff`（新增）
 *   102304 大吼大叫（南瓜战神 68023）→ `roar`（新增）
 *   102004 飓风（三叶小丑 68020）    → `storm_zone`（新增，会走动 + 牵引）
 *
 * 四条在 `pvpSkillPlan` 里原本**一行都没有**（不是参数写错），所以本组用例同时钉两件事：
 * 「配表补上了」+「新车道真的按设计在跑」。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ZCGameModel } from '../assets/script/app/zcds/model/ZCGameModel';
import { configureZCMap, ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { compileZCCombatBuild, getZCModifierCatalogs } from '../assets/script/app/zcds/model/ZCModifierRuntime';
import { captureZCMatchConfig, type ZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import type { ZCCombatTarget, ZCSnapshot, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import type { ZCSkillRuntimeDefinition } from '../assets/script/app/zcds/model/ZCSkillRuntime';
import { ZCSkillTriggerSystem } from '../assets/script/app/zcds/model/systems/ZCSkillTriggerSystem';
import { ZCGroundZoneSystem } from '../assets/script/app/zcds/model/systems/ZCGroundZoneSystem';
import { ZCDamageResolutionSystem } from '../assets/script/app/zcds/model/systems/ZCDamageResolutionSystem';
import {
    ZCAttackResolutionSystem, type IZCAttackResolutionContext,
} from '../assets/script/app/zcds/model/systems/ZCAttackResolutionSystem';
import type { ZCAttackProfile, ZCDeckBonuses, ZCUnitDefinition } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import { ZCCombatEventType } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import type { ZCFloatText } from '../assets/script/app/zcds/model/ZCGameTypes';
import type { ZCUnitStatPatch } from '../assets/script/app/zcds/model/ZCModifierRuntime';
import { ZCStatusSystem } from '../assets/script/app/zcds/model/ZCStatusEffect';
import type { ZCDamageSource } from '../assets/script/app/zcds/model/ZCGameTypes';
import { assetPath } from './helpers/asset-paths';

const TABLE_NAMES = [
    'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams',
    'skillAttrModifier', 'generalStar', 'pvpAttrMap', 'pvpModifierOverride',
    'pvpUnitGrowth', 'pvpSkillBinding', 'pvpStatus', 'pvpSkillPlan',
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

function buildMatch(unitId: string, heroLevel: number, overrides: Partial<ZCMatchConfig['rules']> = {}): ZCMatchConfig {
    const captured = prepare();
    const loadout = compileZCCombatBuild({ unitId, heroLevel }, captured.units, getZCModifierCatalogs())
        .find((item) => item.sourceKey.startsWith('skillPlan:'));
    assert.ok(loadout, `${unitId} 在兵种 ${heroLevel} 级必须编译出技能计划`);
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

function makeUnit(id: number, unitId: string, overrides: Partial<ZCUnitState> = {}): ZCUnitState {
    return {
        id, owner: ZCOwner.Player, unitId, cardId: unitId, tier: 1,
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
    snapshot.nextUnitId = 100;
    snapshot.elapsedSeconds = elapsedSeconds;
    return new ZCGameModel(snapshot, () => 0.5, config);
}

/** 模型会把 `snapshot.units` 逐条解码成新对象 ⇒ 夹具里那个引用从构造起就失效了。*/
function liveUnit(model: ZCGameModel, id: number): ZCUnitState {
    const unit = (model as unknown as { units: { byId: Map<number, ZCUnitState> } }).units.byId.get(id);
    assert.ok(unit, `模型里找不到 #${id}`);
    return unit!;
}

/**
 * 把「排队中的分身」全部兑现。
 *
 * 2026-11-20 第 33 批起，独立分身是**排队出生**的（先播 0.32s 特效、间隔 0.1s），
 * `summonUnits` 当拍只往 `pendingSummons` 里压条目 —— 想数到人必须把时钟推过去。
 */
function settlePendingSummons(model: ZCGameModel): void {
    const state = model.snapshot as unknown as ZCSnapshot;
    const flush = (model as unknown as { flushPendingSummons(): void }).flushPendingSummons.bind(model);
    for (let step = 0; step < 40 && (state.pendingSummons?.length ?? 0) > 0; step += 1) {
        state.elapsedSeconds += 0.05;
        flush();
    }
    assert.equal(state.pendingSummons?.length ?? 0, 0, '队列必须全部兑现');
}

// ────────────────────────────────────────────── 101404 一人成军

const SPLIT_UNIT = '68014';
const SPLIT_CHAIN = 101404;
const SPLIT_TIERS = [
    { count: 3, inherit: 0.3 },
    { count: 4, inherit: 0.5 },
    { count: 6, inherit: 0.8 },
];

test('101404 配表：累计普攻 8 次 + 3/4/6 只 + 继承 30/50/80%（生命与攻击同值）', () => {
    for (const rows of [readRows('pvpSkillPlan'), readClient('pvpSkillPlan')]) {
        const plan = rows.filter((row) => Number(row.skillChainId) === SPLIT_CHAIN)
            .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
        assert.equal(plan.length, 3, '三档都要在（原本一行都没有）');
        plan.forEach((row, index) => {
            const tier = SPLIT_TIERS[index];
            const bag = JSON.parse(String(row.skillParamJson)) as Record<string, number>;
            assert.equal(row.behaviorKey, 'summon_unit');
            assert.equal(row.skillKind, 'active_cd');
            assert.equal(Number(row.unitId), Number(SPLIT_UNIT));
            assert.equal(Number(row.pvpSkillId), 30216);
            assert.equal(Number(row.unlockHeroLevel), [9, 18, 27][index]);
            assert.deepEqual(Object.keys(bag).filter((key) => !key.startsWith('summon')), []);
            assert.equal(bag.summonEvery, 8, '设计 K 列：累计普攻 8 次');
            assert.equal(bag.summonCount, tier.count);
            assert.equal(bag.summonHpInherit, tier.inherit);
            assert.equal(bag.summonAttackInherit, tier.inherit, '设计说「继承属性」，没分生命与攻击');
            //  两条都「不配」才是对的：不配 = 到战死 / 放出去自己走。
            assert.equal('summonSeconds' in bag, false, '持续到战死，不许写秒数');
            assert.equal('summonFollow' in bag, false,
                '不跟随 —— 固定阵位只有 4 个，6 只分身会两两叠在同一个角上');
            assert.equal('summonCooldown' in bag, false, '累计普攻制与冷却制互斥');
        });
    }
});

test('101404 卡面：K 表口径的 desc 三份一致，修改器 94014041~43', () => {
    const plans = readRows('pvpSkillPlan')
        .filter((row) => Number(row.skillChainId) === SPLIT_CHAIN)
        .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
    for (const cards of [readRows('armySkillLevelUp'), readClient('armySkillLevelUp')]) {
        const rows = cards.filter((row) => Number(row.id) === SPLIT_CHAIN)
            .sort((a, b) => Number(a.skilllevel) - Number(b.skilllevel));
        assert.equal(rows.length, 3);
        rows.forEach((row, index) => {
            assert.equal(row.name, '一人成军');
            assert.equal(row.desc, plans[index].desc);
            assert.equal(Number(row.unlockarmylevel), [9, 18, 27][index]);
            assert.deepEqual(row.modfiy, [94014041 + index]);
        });
    }
});

function splitTriggerParams(options: {
    castSummon?: () => boolean;
    count?: number;
}) {
    const runtime = {
        skillChainId: SPLIT_CHAIN, behaviorKey: 'summon_unit',
        trigger: 'none', stateMode: 'none',
        parameters: {
            summonEvery: 8, summonCount: 3, summonHpInherit: 0.3, summonAttackInherit: 0.3,
        },
    } as unknown as ZCSkillRuntimeDefinition;
    return {
        statusSystem: {
            statModsOf: () => ({}), hasDef: () => false,
            apply: () => ({ applied: false }), exportSnapshot: () => ({ nextUid: 1, units: [] }),
        },
        runtimeOf: () => runtime,
        inAttackRange: () => false,
        healUnit: () => undefined,
        statPatchOf: () => ({}),
        ...options,
    } as unknown as Parameters<typeof ZCSkillTriggerSystem.tick>[2];
}

test('101404 触发口径：第一次只记基线、满 8 次才放、被拒不消费次数', () => {
    prepare();
    const master = makeUnit(1, SPLIT_UNIT);
    const state = { ...({} as ZCSnapshot), units: [master], elapsedSeconds: 0 } as unknown as ZCSnapshot;
    let casts = 0;
    const params = splitTriggerParams({ castSummon: () => { casts += 1; return true; } });

    //  第一次推进：只记下当前普攻次数，不补放（否则开局就白送一批分身）。
    master.completedAttackCount = 7;
    ZCSkillTriggerSystem.tick(state, 0.05, params);
    assert.equal(casts, 0, '不补放');
    assert.equal(master.summonFiredCount, 7, '基线记的是「当前已打几次」');
    assert.equal(master.summonReadyAt, undefined, '累计普攻制不许碰 CD 那格');

    master.completedAttackCount = 14;
    ZCSkillTriggerSystem.tick(state, 0.05, params);
    assert.equal(casts, 0, '差 1 次不放（14 - 7 = 7 < 8）');

    master.completedAttackCount = 15;
    ZCSkillTriggerSystem.tick(state, 0.05, params);
    assert.equal(casts, 1, '满 8 次放');
    assert.equal(master.summonFiredCount, 15);

    //  被拒：不消费次数，下帧重试。
    const deny = splitTriggerParams({ castSummon: () => false });
    master.completedAttackCount = 23;
    ZCSkillTriggerSystem.tick(state, 0.05, deny);
    assert.equal(master.summonFiredCount, 15, '被拒之后计数原地不动');
    ZCSkillTriggerSystem.tick(state, 0.05, params);
    assert.equal(casts, 2, '下一帧补放');
});

test('101404 分身：3/4/6 只、继承 30/50/80% 生命与攻击、不过期、不跟随', () => {
    for (let index = 0; index < 3; index += 1) {
        const tier = SPLIT_TIERS[index];
        const config = buildMatch(SPLIT_UNIT, [9, 18, 27][index]);
        const model = makeModel(config, [makeUnit(1, SPLIT_UNIT)], 4);
        const master = liveUnit(model, 1);
        const base = (model as unknown as { effectiveUnitDefinition(unit: ZCUnitState): { attack: number } })
            .effectiveUnitDefinition(master);

        const cast = (model as unknown as { summonUnits(unit: ZCUnitState): boolean }).summonUnits(master);
        assert.equal(cast, true, `第 ${index + 1} 档召得出来`);
        settlePendingSummons(model);
        const clones = model.snapshot.units.filter((unit) => unit.summonMasterId !== undefined);
        assert.equal(clones.length, tier.count, `第 ${index + 1} 档 ${tier.count} 只`);
        for (const clone of clones) {
            assert.equal(clone.unitId, SPLIT_UNIT, '复制本体');
            assert.equal(clone.maxHp, Math.round(master.maxHp * tier.inherit));
            assert.ok(Math.abs(clone.inheritedStats!.attack - base.attack * tier.inherit) < 1e-6);
            assert.equal(clone.summonUntil, undefined, '持续到战死');
            assert.equal(clone.summonSlot, undefined, '不跟随 ⇒ 没有阵位');
            //  2026-11-20 第 33 批（用户原话「分裂菇的分身透明度约为 65%」）：
            //  配表里 101404 三档都没填 `summonAlpha` ⇒ 走独立分身的 0.65 兜底。
            assert.equal(clone.summonAlpha, 0.65, '分身 65% 透明');
        }
    }
});

// ────────────────────────────────────────────── 102204 嗜血术（team_buff）

const BANANA_UNIT = '68022';
const BANANA_CHAIN = 102204;
const BANANA_TIERS = [
    { damage: 15, speed: 0, seconds: 5 },
    { damage: 25, speed: 15, seconds: 6 },
    { damage: 40, speed: 30, seconds: 8 },
];

test('102204 配表：伤害 15/25/40% + 攻速 0/15/30% + 5/6/8 秒，III 级才有击杀延长', () => {
    for (const rows of [readRows('pvpSkillPlan'), readClient('pvpSkillPlan')]) {
        const plan = rows.filter((row) => Number(row.skillChainId) === BANANA_CHAIN)
            .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
        assert.equal(plan.length, 3);
        plan.forEach((row, index) => {
            const tier = BANANA_TIERS[index];
            const bag = JSON.parse(String(row.skillParamJson)) as Record<string, number>;
            assert.equal(row.behaviorKey, 'team_buff');
            assert.equal(Number(row.unitId), Number(BANANA_UNIT));
            assert.equal(Number(row.pvpSkillId), 30231);
            assert.equal(Number(row.unlockHeroLevel), [12, 24, 36][index]);
            assert.deepEqual(Object.keys(bag).filter((key) => !key.startsWith('teamBuff')), []);
            assert.equal(bag.teamBuffCooldown, 8, '设计 J 列');
            assert.equal(bag.teamBuffRadius, 190, '设计没给半径 ⇒ 补 190（与共生信号光环同档）');
            assert.equal(bag.teamBuffSeconds, tier.seconds);
            assert.equal(bag.teamBuffDamagePct, tier.damage);
            assert.equal(bag.teamBuffAttackSpeedPct, tier.speed,
                'I 级显式写 0：省了会被下一个人补成 15，顺手把 I 级改强');
            if (index === 2) {
                assert.equal(bag.teamBuffKillExtendSeconds, 1);
                assert.equal(bag.teamBuffKillExtendMaxSeconds, 4);
            } else {
                assert.equal('teamBuffKillExtendSeconds' in bag, false, '延长只在 III 级');
                assert.equal('teamBuffKillExtendMaxSeconds' in bag, false);
            }
            //  同袋不许出现闪电链 / 孢子弹幕那两个前缀。
            for (const key of ['chainCooldown', 'bulletCount', 'summonCooldown']) {
                assert.equal(key in bag, false, `参数袋串进了 ${key}`);
            }
        });
    }
});

test('102204 卡面三份一致，修改器 94022041~43', () => {
    const plans = readRows('pvpSkillPlan')
        .filter((row) => Number(row.skillChainId) === BANANA_CHAIN)
        .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
    for (const cards of [readRows('armySkillLevelUp'), readClient('armySkillLevelUp')]) {
        const rows = cards.filter((row) => Number(row.id) === BANANA_CHAIN)
            .sort((a, b) => Number(a.skilllevel) - Number(b.skilllevel));
        assert.equal(rows.length, 3);
        rows.forEach((row, index) => {
            assert.equal(row.name, '嗜血术');
            assert.equal(row.desc, plans[index].desc);
            assert.equal(Number(row.unlockarmylevel), [12, 24, 36][index]);
            assert.deepEqual(row.modfiy, [94022041 + index]);
        });
    }
});

/** 记录每一次施加：`team_buff` 的效果全落在状态系统上，没有别的可观测出口。 */
function fakeStatuses() {
    const applied: Array<{ unitId: string; id: string; duration: number }> = [];
    const defs = new Map<string, { statMods: Record<string, number>; durationSeconds: number }>();
    return {
        applied,
        defs,
        statusSystem: {
            statModsOf: () => ({}),
            hasDef: (id: string) => defs.has(id),
            register: (def: { id: string; statMods: Record<string, number>; durationSeconds: number }) => {
                defs.set(def.id, def);
            },
            apply: (unitId: string, id: string, options: { durationSeconds?: number }) => {
                applied.push({ unitId, id, duration: options?.durationSeconds ?? 0 });
                return { applied: true };
            },
            exportSnapshot: () => ({ nextUid: 1, units: [] }),
        },
    };
}

function teamBuffParams(tierIndex: number, statuses: ReturnType<typeof fakeStatuses>) {
    const tier = BANANA_TIERS[tierIndex];
    const bag: Record<string, number> = {
        teamBuffCooldown: 8, teamBuffRadius: 190, teamBuffSeconds: tier.seconds,
        teamBuffDamagePct: tier.damage, teamBuffAttackSpeedPct: tier.speed,
    };
    if (tierIndex === 2) {
        bag.teamBuffKillExtendSeconds = 1;
        bag.teamBuffKillExtendMaxSeconds = 4;
    }
    const runtime = {
        skillChainId: BANANA_CHAIN, behaviorKey: 'team_buff',
        trigger: 'none', stateMode: 'none', parameters: bag,
    } as unknown as ZCSkillRuntimeDefinition;
    return {
        statusSystem: statuses.statusSystem,
        //  只给 #1 这本书：两条 `runtimeOf` 都给会让「友军」也变成第二个施法者，
        //  测出来的「离开范围就不再续挂」会被它自己给自己续的状态盖掉。
        runtimeOf: (unit: ZCUnitState) => (unit.id === 1 ? runtime : undefined),
        inAttackRange: () => true,
        healUnit: () => undefined,
        statPatchOf: () => ({}),
        distanceScale: 1,
    } as unknown as Parameters<typeof ZCSkillTriggerSystem.tick>[2];
}

function buffScene() {
    const caster = makeUnit(1, BANANA_UNIT, { freeX: 0, freeY: 0 });
    const ally = makeUnit(2, BANANA_UNIT, { freeX: 100, freeY: 0 });
    const state = { ...({} as ZCSnapshot), units: [caster, ally], elapsedSeconds: 0 } as unknown as ZCSnapshot;
    return { caster, ally, state };
}

test('102204 窗口：首次只挂 CD，窗口内给友军续上「伤害 + 攻速」状态', () => {
    prepare();
    const statuses = fakeStatuses();
    const params = teamBuffParams(2, statuses);
    const { caster, ally, state } = buffScene();

    ZCSkillTriggerSystem.tick(state, 0.05, params);
    assert.equal(statuses.applied.length, 0, '首次只挂 CD，开局不立刻放');
    assert.equal(caster.teamBuffReadyAt, 8);
    assert.equal(caster.teamBuffWindowEnd, undefined);

    state.elapsedSeconds = 8;
    ZCSkillTriggerSystem.tick(state, 0.05, params);
    assert.ok(statuses.applied.length >= 2, '施法者与友军都被罩到');
    const statusId = statuses.applied[0].id;
    const def = statuses.defs.get(statusId)!;
    assert.equal(def.statMods.damageRatePct, 40, 'III 级伤害 +40%');
    assert.equal(def.statMods.attackIntervalPct, 30, 'III 级攻速 +30%');
    assert.ok(def.durationSeconds <= 0.6, '续挂时长 ≤ 0.6 秒 ⇒ 离开半径最多 0.6 秒就掉');
    assert.equal(ally.teamBuffUntil, 16, '窗口 = 8 + 8 秒');
    assert.equal(caster.castHoldUntil, 8 + 0.5, '吼的时候原地锁 0.5 秒（`ZC_SELF_CAST_HOLD_SECONDS`，buff 类同一口径）');
});

test('102204 离开范围即失去：走出半径后不再续挂，窗口结束也不再挂', () => {
    prepare();
    const statuses = fakeStatuses();
    const params = teamBuffParams(2, statuses);
    const { ally, state } = buffScene();

    ZCSkillTriggerSystem.tick(state, 0.05, params);   // t=0：只挂 CD
    state.elapsedSeconds = 8;
    ZCSkillTriggerSystem.tick(state, 0.05, params);
    const insideCount = statuses.applied.filter((item) => item.unitId === '2').length;
    assert.ok(insideCount >= 1, '半径内要挂上');

    ally.freeX = 400;   //  190 之外
    state.elapsedSeconds = 8.1;
    ZCSkillTriggerSystem.tick(state, 0.05, params);
    assert.equal(statuses.applied.filter((item) => item.unitId === '2').length, insideCount,
        '出去了就不再续挂（剩下的靠那 0.6 秒自然掉完）');

    //  ⚠ 这里 CD(8) 与窗口(8) 同长 ⇒ 16 秒时「窗口关」和「CD 到」是同一刻，没有空档。
    //  回到半径内那一帧开的是**下一轮**（16.05 + 8），而不是把上一轮拖着续 ——
    //  两者的区别只在「窗口截止时刻」上：拼接式续挂会得到 16，重开得到 24.05。
    ally.freeX = 100;
    state.elapsedSeconds = 16.05;
    ZCSkillTriggerSystem.tick(state, 0.05, params);
    assert.equal(ally.teamBuffUntil, 16.05 + 8, '窗口 + CD 都到点 ⇒ 开下一轮');
});

test('102204 III 级击杀延长：每杀 1 个 +1 秒、封顶 4 秒；I/II 级不延', () => {
    prepare();
    const statuses = fakeStatuses();
    const params = teamBuffParams(2, statuses);
    const { ally, state } = buffScene();

    ZCSkillTriggerSystem.tick(state, 0.05, params);   // t=0：只挂 CD
    state.elapsedSeconds = 8;
    ZCSkillTriggerSystem.tick(state, 0.05, params);
    assert.equal(ally.teamBuffUntil, 16, '窗口截止 16');
    assert.equal(ally.teamBuffKillBase, 0, '击杀基线拍在罩上的那一刻');

    ally.killCount = 1;
    state.elapsedSeconds = 8.1;
    ZCSkillTriggerSystem.tick(state, 0.05, params);
    assert.equal(ally.teamBuffUntil, 17, '杀 1 个延 1 秒');
    assert.equal(ally.teamBuffExtendUsed, 1);

    //  一次攒 10 个击杀：只给到封顶 4 秒为止。
    ally.killCount = 11;
    state.elapsedSeconds = 8.2;
    ZCSkillTriggerSystem.tick(state, 0.05, params);
    assert.equal(ally.teamBuffUntil, 20, '16 + 封顶 4 秒');
    assert.equal(ally.teamBuffExtendUsed, 4);

    //  额度用完之后再杀也不动。
    ally.killCount = 20;
    state.elapsedSeconds = 8.3;
    ZCSkillTriggerSystem.tick(state, 0.05, params);
    assert.equal(ally.teamBuffUntil, 20, '封顶之后不再延');
    assert.equal(ally.teamBuffKillBase, 20, '基线照推平，额度放开时不会补账');

    //  I 级没配延长两键 ⇒ 杀了也不延。
    const lowStatuses = fakeStatuses();
    const lowParams = teamBuffParams(0, lowStatuses);
    const low = buffScene();
    ZCSkillTriggerSystem.tick(low.state, 0.05, lowParams);   // t=0：只挂 CD
    low.state.elapsedSeconds = 8;
    ZCSkillTriggerSystem.tick(low.state, 0.05, lowParams);
    const before = low.ally.teamBuffUntil;
    low.ally.killCount = 5;
    low.state.elapsedSeconds = 8.1;
    ZCSkillTriggerSystem.tick(low.state, 0.05, lowParams);
    assert.equal(low.ally.teamBuffUntil, before, 'I 级不延长');
});

test('击杀归因：打出最后一击的人 killCount +1（III 级延长全靠这一格）', () => {
    const attacker = makeUnit(1, BANANA_UNIT);
    const victim = makeUnit(2, '68001', { owner: ZCOwner.Enemy, hp: 50, maxHp: 50 });
    const statusSystem = new ZCStatusSystem();
    const byId = new Map([[attacker.id, attacker], [victim.id, victim]]);
    const state = {
        elapsedSeconds: 0, units: [attacker, victim],
        statusEffects: { nextUid: 1, units: [] }, combatEvents: [], nextCombatEventId: 1,
        projectiles: [], groundZones: [], hexes: [],
    } as unknown as ZCSnapshot;
    const context = {
        statusSystem,
        units: { byId, markDead: () => undefined },
        damageDealt: { [ZCOwner.Player]: 0, [ZCOwner.Enemy]: 0 },
        damageTaken: { [ZCOwner.Player]: 0, [ZCOwner.Enemy]: 0 },
        random: () => 0.99,
    } as unknown as Parameters<typeof ZCDamageResolutionSystem.damageUnit>[4];
    const source: ZCDamageSource = { owner: ZCOwner.Player, kind: 'unit', unitId: attacker.id };

    ZCDamageResolutionSystem.damageUnit(state, victim, 100, source, context);
    assert.equal(victim.hp, 0, '打死了');
    assert.equal(attacker.killCount, 1, '最后一击记在攻击者身上');
    assert.equal(victim.killCount, undefined, '被打死的人不涨');

    //  没打死时不记。
    const tanky = makeUnit(3, '68001', { owner: ZCOwner.Enemy, hp: 900, maxHp: 900 });
    byId.set(tanky.id, tanky);
    state.units.push(tanky);
    ZCDamageResolutionSystem.damageUnit(state, tanky, 100, source, context);
    assert.equal(tanky.hp, 800);
    assert.equal(attacker.killCount, 1, '没打死不加');
});

// ────────────────────────────────────────────── 102304 大吼大叫（roar）

const PUMPKIN_UNIT = '68023';
const PUMPKIN_CHAIN = 102304;
const ROAR_TIERS = [
    { rate: 0.8, attackPct: -20, seconds: 3 },
    { rate: 1.1, attackPct: -30, seconds: 4 },
    { rate: 1.5, attackPct: -40, seconds: 5 },
];

test('102304 配表：80/110/150% + 减攻 20/30/40% + 3/4/5 秒，III 级才有友军护盾', () => {
    for (const rows of [readRows('pvpSkillPlan'), readClient('pvpSkillPlan')]) {
        const plan = rows.filter((row) => Number(row.skillChainId) === PUMPKIN_CHAIN)
            .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
        assert.equal(plan.length, 3);
        plan.forEach((row, index) => {
            const tier = ROAR_TIERS[index];
            const bag = JSON.parse(String(row.skillParamJson)) as Record<string, number>;
            assert.equal(row.behaviorKey, 'roar');
            assert.equal(Number(row.unitId), Number(PUMPKIN_UNIT));
            assert.equal(Number(row.pvpSkillId), 30216, '南瓜战神与分裂菇共用 30216，靠 unitId 分袋');
            assert.equal(Number(row.unlockHeroLevel), [12, 24, 36][index]);
            assert.deepEqual(Object.keys(bag).filter((key) => !key.startsWith('roar')), []);
            assert.equal(bag.roarCooldown, 8, '设计 J 列');
            assert.equal(bag.roarRadius, 150, '设计没给半径 ⇒ 补 150（与毒液喷吐 / 陷阱爆炸同档）');
            assert.equal(bag.roarDamageRate, tier.rate);
            assert.equal(bag.roarAttackPct, tier.attackPct, '负值 = 减攻');
            assert.equal(bag.roarSeconds, tier.seconds);
            if (index === 2) {
                assert.equal(bag.roarAllyShieldRatio, 0.15);
            } else {
                assert.equal('roarAllyShieldRatio' in bag, false, '友军护盾只在 III 级');
            }
            //  与同卡 102301 光环 / 102303 冲锋的前缀不许串。
            for (const key of ['teamAura0Radius', 'dashCooldown', 'teamBuffCooldown']) {
                assert.equal(key in bag, false, `参数袋串进了 ${key}`);
            }
        });
    }
});

test('102304 卡面三份一致，修改器 94023041~43', () => {
    const plans = readRows('pvpSkillPlan')
        .filter((row) => Number(row.skillChainId) === PUMPKIN_CHAIN)
        .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
    for (const cards of [readRows('armySkillLevelUp'), readClient('armySkillLevelUp')]) {
        const rows = cards.filter((row) => Number(row.id) === PUMPKIN_CHAIN)
            .sort((a, b) => Number(a.skilllevel) - Number(b.skilllevel));
        assert.equal(rows.length, 3);
        rows.forEach((row, index) => {
            assert.equal(row.name, '大吼大叫');
            assert.equal(row.desc, plans[index].desc);
            assert.equal(Number(row.unlockarmylevel), [12, 24, 36][index]);
            assert.deepEqual(row.modfiy, [94023041 + index]);
        });
    }
});

/** 攻击力 100、无加成 ⇒ 面板伤害 = 100 × 倍率，便于钉绝对值。 */
const ROAR_DEFINITION = {
    unitId: PUMPKIN_UNIT, name: '南瓜战神', maxHp: 1000, attack: 100,
    moveSpeed: 0, attackSpeed: 500, attackRange: 45, attackInterval: 1.8,
    attackDuration: 1.3, attackHitTime: 0.52, bodyRadius: 24, spawnSeconds: 0,
    flying: false, canAttackAir: true, hero: true, prefabPath: '', prefabSize: 1,
    attackProfile: {
        skillId: 30216, name: '南瓜战神普攻', mode: 'melee',
        projectileSpeed: 0, areaRadius: 0, damageRate: 1,
        empoweredEvery: 0, empoweredSkillId: 0, secondarySkillId: 0,
        durationSeconds: 0, waves: 1, legacyEffectKeys: [],
    } satisfies ZCAttackProfile,
    secondaryProfile: undefined,
} as unknown as ZCUnitDefinition;

/**
 * 「到点生成 / 结算一次」那类技能（怒吼 102304 / 飓风 102004）共用的施法夹具。
 *
 * 抽成一份是为了让「链号 / 行为键 / 技能 id / 单位定义」这四个变量只有一个来源 ——
 * 各写一份的话，改一条技能时很容易只改到其中一条用例的 runtime 键（`${unitId}:${skillId}`），
 * 而那正是 `skillParamJson` 分袋的判据：键对不上的表现是「技能一声不响地不触发」。
 */
interface ICastSpec {
    chainId: number;
    behaviorKey: string;
    skillId: number;
    unitId: string;
    definition: ZCUnitDefinition;
}

function castContext(units: ZCUnitState[], params: Record<string, number>,
    statuses: ReturnType<typeof fakeStatuses>, spec: ICastSpec,
    target: ZCCombatTarget | null = null) {
    const damaged: Array<{ id: number; damage: number }> = [];
    const runtime = {
        skillChainId: spec.chainId, behaviorKey: spec.behaviorKey,
        trigger: 'none', stateMode: 'none', parameters: { ...params },
    } as unknown as ZCSkillRuntimeDefinition;
    const context = {
        rules: {
            combatDistanceScale: 1, combatDamageMultiplier: 1,
            unitAttackPerTier: 0, counterDamageMultiplier: 1,
        } as IZCAttackResolutionContext['rules'],
        statusSystem: statuses.statusSystem,
        geometry: { hexIdAt: () => null } as unknown as IZCAttackResolutionContext['geometry'],
        random: () => 0.99,
        effectiveDefinition: () => spec.definition,
        unitPosition: (unit: ZCUnitState) => ({ x: unit.freeX, y: unit.freeY }),
        damageUnit: (target: ZCUnitState, damage: number) => {
            damaged.push({ id: target.id, damage });
            target.hp = Math.max(0, target.hp - damage);
            return { value: Math.round(damage), kind: 'damage', x: 0, y: 0 } as unknown as ZCFloatText;
        },
        counters: [],
        cards: { [ZCOwner.Player]: new Map(), [ZCOwner.Enemy]: new Map() },
        skillRuntime: {
            [ZCOwner.Player]: new Map([[`${spec.unitId}:${spec.skillId}`, runtime]]),
            [ZCOwner.Enemy]: new Map(),
        } as unknown as IZCAttackResolutionContext['skillRuntime'],
        statPatches: {
            [ZCOwner.Player]: new Map<string, ZCUnitStatPatch>(),
            [ZCOwner.Enemy]: new Map<string, ZCUnitStatPatch>(),
        },
        deckBonuses: {
            [ZCOwner.Player]: {
                activeBonds: [], unitHpMultiplier: 1, unitAttackMultiplier: 1,
                moveSpeedMultiplier: 1, towerAttackMultiplier: 1, incomeBonus: 0,
                spawnIntervalMultiplier: 1,
            },
            [ZCOwner.Enemy]: {
                activeBonds: [], unitHpMultiplier: 1, unitAttackMultiplier: 1,
                moveSpeedMultiplier: 1, towerAttackMultiplier: 1, incomeBonus: 0,
                spawnIntervalMultiplier: 1,
            },
        } as unknown as Record<ZCOwner, ZCDeckBonuses>,
        unitById: new Map(units.map((unit) => [unit.id, unit])),
        //  选敌这里给常量：`null` = 场上没目标（存量用例的口径），给了才是「有目标可投送」。
        currentTarget: () => target,
        evaluateLegacySkill: () => ({
            buffs: [], hitCount: 0, hasDamageFormula: false, damage: 0,
        }) as unknown as ReturnType<IZCAttackResolutionContext['evaluateLegacySkill']>,
        applyLegacySelfBuffs: () => [],
        tryExecuteUnit: () => undefined,
        applyHitStatus: () => undefined,
        applyLegacyBuffs: () => undefined,
        damageWall: () => undefined,
        damageBuilding: () => undefined,
        unitsInRadius: () => [],
        healUnit: () => undefined,
        applyKnockback: () => undefined,
        pushProjectile: () => undefined,
    } as unknown as IZCAttackResolutionContext;
    return { context, damaged };
}

const ROAR_SPEC: ICastSpec = {
    chainId: PUMPKIN_CHAIN, behaviorKey: 'roar', skillId: 30216,
    unitId: PUMPKIN_UNIT, definition: ROAR_DEFINITION,
};

function roarContext(units: ZCUnitState[], params: Record<string, number>,
    statuses: ReturnType<typeof fakeStatuses>) {
    return castContext(units, params, statuses, ROAR_SPEC);
}

const JOKER_UNIT = '68020';
const JOKER_CHAIN = 102004;
/** 三叶小丑：同样是攻击力 100、普攻 30714（飓风挂在这条普攻的 `skillParamJson` 袋里）。*/
const STORM_DEFINITION = {
    ...ROAR_DEFINITION,
    unitId: JOKER_UNIT, name: '三叶小丑',
    //  真实卡面：`pvpCard.68020.unitMoveSpeed = 28`，且它**就是世界 px/s**
    //  （`ZCMovementSystem.speedOf` 直接 `moveSpeed * dt`）—— 飓风的投送速度照抄这一格。
    moveSpeed: 28,
    attackProfile: {
        ...(ROAR_DEFINITION.attackProfile as ZCAttackProfile),
        skillId: 30714, name: '三叶小丑普攻',
    } satisfies ZCAttackProfile,
} as unknown as ZCUnitDefinition;

const STORM_SPEC: ICastSpec = {
    chainId: JOKER_CHAIN, behaviorKey: 'storm_zone', skillId: 30714,
    unitId: JOKER_UNIT, definition: STORM_DEFINITION,
};

function stormContext(units: ZCUnitState[], params: Record<string, number>,
    target: ZCCombatTarget | null = null) {
    return castContext(units, params, fakeStatuses(), STORM_SPEC, target);
}

/**
 * 🔴 `castRoar` 会往 `state.combatEvents` 里 push 表现事件、还会读 `state.groundZones`
 * ⇒ 不能再用 `{ ...({} as ZCSnapshot), units }` 那种空壳，字段会全是 `undefined`
 * （报错长得像 `Cannot read properties of undefined (reading 'push')`）。
 */
function skillState(units: ZCUnitState[], elapsedSeconds: number): ZCSnapshot {
    return {
        elapsedSeconds, units,
        statusEffects: { nextUid: 1, units: [] },
        combatEvents: [], nextCombatEventId: 1,
        projectiles: [], groundZones: [], hexes: [],
    } as unknown as ZCSnapshot;
}

test('102304 伤害：半径内敌人吃 80/110/150%，半径外一个不碰', () => {
    prepare();
    for (let index = 0; index < 3; index += 1) {
        const tier = ROAR_TIERS[index];
        const params: Record<string, number> = {
            roarCooldown: 8, roarRadius: 150, roarDamageRate: tier.rate,
            roarAttackPct: tier.attackPct, roarSeconds: tier.seconds,
        };
        const caster = makeUnit(1, PUMPKIN_UNIT, { freeX: 0, freeY: 0 });
        const near = makeUnit(2, '68001', { owner: ZCOwner.Enemy, freeX: 100, freeY: 0 });
        const far = makeUnit(3, '68001', { owner: ZCOwner.Enemy, freeX: 200, freeY: 0 });
        const ally = makeUnit(4, PUMPKIN_UNIT, { freeX: 50, freeY: 0 });
        const units = [caster, near, far, ally];
        const statuses = fakeStatuses();
        const { context, damaged } = roarContext(units, params, statuses);
        const state = skillState(units, 4.2);

        assert.equal(ZCAttackResolutionSystem.castRoar(state, caster, context), true);
        assert.deepEqual(damaged.map((hit) => hit.id), [2], '只打半径内的敌人（友军不挨）');
        assert.equal(damaged[0].damage, Math.round(100 * tier.rate));
        assert.equal(far.hp, 1200, '200 > 150，打不到');
        assert.equal(ally.hp, 1200, '友军不掉血');
        assert.equal(state.combatEvents.length, 1, '一条 area 事件（怒吼的环）');
        assert.equal(state.combatEvents[0].type, ZCCombatEventType.Area);
        assert.equal(state.combatEvents[0].damage, damaged[0].damage, '事件上带这一发的伤害');
    }
});

test('102304 减攻：挂的是 `attackPct` 负值状态，秒数照设计', () => {
    prepare();
    const params: Record<string, number> = {
        roarCooldown: 8, roarRadius: 150, roarDamageRate: 1.1,
        roarAttackPct: -30, roarSeconds: 4,
    };
    const caster = makeUnit(1, PUMPKIN_UNIT, { freeX: 0, freeY: 0 });
    const near = makeUnit(2, '68001', { owner: ZCOwner.Enemy, freeX: 100, freeY: 0 });
    const units = [caster, near];
    const statuses = fakeStatuses();
    const { context } = roarContext(units, params, statuses);
    const state = skillState(units, 0);

    ZCAttackResolutionSystem.castRoar(state, caster, context);
    const applied = statuses.applied.filter((item) => item.unitId === '2');
    assert.equal(applied.length, 1, '每个挨打的敌人都挂一条');
    const def = statuses.defs.get(applied[0].id)!;
    assert.equal(def.statMods.attackPct, -30, '减攻 30% ⇒ attackPct = -30');
    assert.equal(def.durationSeconds, 4);
    assert.equal(def.statMods.damageRatePct, undefined, '减攻不是减「造成的伤害」，两格不能混');
});

test('102304 III 级友军护盾：施法者最大生命的 15%，只给半径内友军，到期即失效', () => {
    prepare();
    const params: Record<string, number> = {
        roarCooldown: 8, roarRadius: 150, roarDamageRate: 1.5,
        roarAttackPct: -40, roarSeconds: 5, roarAllyShieldRatio: 0.15,
    };
    const caster = makeUnit(1, PUMPKIN_UNIT, { freeX: 0, freeY: 0, maxHp: 2000, hp: 2000 });
    const nearAlly = makeUnit(2, PUMPKIN_UNIT, { freeX: 60, freeY: 0, maxHp: 500, hp: 500 });
    const farAlly = makeUnit(3, PUMPKIN_UNIT, { freeX: 400, freeY: 0 });
    const foe = makeUnit(4, '68001', { owner: ZCOwner.Enemy, freeX: 120, freeY: 0 });
    const units = [caster, nearAlly, farAlly, foe];
    const statuses = fakeStatuses();
    const { context } = roarContext(units, params, statuses);
    const state = skillState(units, 10);

    ZCAttackResolutionSystem.castRoar(state, caster, context);
    //  「自身 15% 最大生命」= 施法者的 2000 × 15% = 300，不是友军自己的 500 × 15%。
    assert.equal(caster.shield, 300, '吼的人自己也有一份');
    assert.equal(nearAlly.shield, 300, '按施法者最大生命算');
    assert.equal(farAlly.shield, undefined, '400 > 150，够不着');
    assert.equal(foe.shield, undefined, '敌人没有护盾');
    assert.equal(nearAlly.shieldExpireAt, 15, '护盾到期 = 施放 + 5 秒');
    assert.equal(caster.shieldExpireAt, 15);

    //  到期由 `expireShield` 清零（不回血）。`tick` 自己不推进 `elapsedSeconds`
    //  （那是宿主每帧喂进来的），所以时间要自己挪到 15 秒那一帧。
    state.elapsedSeconds = 15;
    ZCSkillTriggerSystem.tick(state, 0.05, {
        statusSystem: statuses.statusSystem,
        runtimeOf: () => undefined,
        inAttackRange: () => true,
        healUnit: () => undefined,
        statPatchOf: () => ({}),
    } as unknown as Parameters<typeof ZCSkillTriggerSystem.tick>[2]);
    assert.equal(nearAlly.shield, 0, '到期清零');
});

test('102304 半径内没有敌人 ⇒ 拒放（不白吃 8 秒 CD）', () => {
    prepare();
    const caster = makeUnit(1, PUMPKIN_UNIT, { freeX: 0, freeY: 0 });
    const far = makeUnit(2, '68001', { owner: ZCOwner.Enemy, freeX: 900, freeY: 0 });
    const units = [caster, far];
    const statuses = fakeStatuses();
    const { context, damaged } = roarContext(units, {
        roarCooldown: 8, roarRadius: 150, roarDamageRate: 1, roarAttackPct: -20, roarSeconds: 3,
    }, statuses);
    const state = skillState(units, 0);
    assert.equal(ZCAttackResolutionSystem.castRoar(state, caster, context), false);
    assert.deepEqual(damaged, []);
    assert.equal(state.combatEvents.length, 0, '拒放连表现都不该有');

    //  触发层：被拒不吃 CD，下帧重试。
    let casts = 0;
    const runtime = {
        skillChainId: PUMPKIN_CHAIN, behaviorKey: 'roar', trigger: 'none', stateMode: 'none',
        parameters: { roarCooldown: 8, roarRadius: 150, roarDamageRate: 1, roarAttackPct: -20, roarSeconds: 3 },
    } as unknown as ZCSkillRuntimeDefinition;
    const tickParams = {
        statusSystem: statuses.statusSystem,
        //  🔴 `runtimeOf` 若不按单位过滤，敌人 `far` 也会拿到这本「书」，
        //  于是它自己也吼一次（`casts` 变成 2）。只有持有该链的单位才算施法者。
        runtimeOf: (unit: ZCUnitState) => (unit.id === 1 ? runtime : undefined),
        inAttackRange: () => false,
        healUnit: () => undefined,
        statPatchOf: () => ({}),
        castRoar: () => { casts += 1; return false; },
    } as unknown as Parameters<typeof ZCSkillTriggerSystem.tick>[2];
    ZCSkillTriggerSystem.tick(state, 0.05, tickParams);
    assert.equal(casts, 0, '首次只挂 CD');
    assert.equal(caster.roarReadyAt, 8);
    state.elapsedSeconds = 8;
    ZCSkillTriggerSystem.tick(state, 0.05, tickParams);
    assert.equal(casts, 1);
    assert.equal(caster.roarReadyAt, 8, '被拒不消费 CD');
});

// ────────────────────────────────────────────── 102004 飓风（storm_zone）

const STORM_TIERS = [6, 7, 8];

function stormParams(seconds = 8): Record<string, number> {
    return {
        stormCooldown: 12, stormRadius: 90, stormSeconds: seconds, stormInterval: 0.5,
        stormDamageRate: 0.1, stormWanderSpeed: 10, stormTurnSeconds: 1,
        stormPullSpeed: 60, stormPullRadius: 150,
    };
}

test('102004 配表：每 0.5 秒 10% + 持续 6/7/8 秒，游走与牵引参数齐全', () => {
    for (const rows of [readRows('pvpSkillPlan'), readClient('pvpSkillPlan')]) {
        const plan = rows.filter((row) => Number(row.skillChainId) === JOKER_CHAIN)
            .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
        assert.equal(plan.length, 3, '三档都要在（原本一行都没有）');
        plan.forEach((row, index) => {
            const bag = JSON.parse(String(row.skillParamJson)) as Record<string, number>;
            assert.equal(row.behaviorKey, 'storm_zone');
            assert.equal(row.skillKind, 'active_cd');
            assert.equal(Number(row.unitId), Number(JOKER_UNIT));
            assert.equal(Number(row.pvpSkillId), 30714);
            assert.equal(Number(row.unlockHeroLevel), [12, 24, 36][index]);
            assert.deepEqual(Object.keys(bag).filter((key) => !key.startsWith('storm')), [],
                '参数袋里不许串进 102001 / 102002 的克制条');
            assert.equal(bag.stormCooldown, 12, '设计 J 列');
            assert.equal(bag.stormRadius, 90);
            assert.equal(bag.stormSeconds, STORM_TIERS[index]);
            assert.equal(bag.stormInterval, 0.5, '设计：每 0.5 秒一次');
            assert.equal(bag.stormDamageRate, 0.1, '设计：每跳 10%');
            assert.equal(bag.stormWanderSpeed, 10, '设计 N 列：移动速度 10px');
            assert.equal(bag.stormTurnSeconds, 1, '设计没给换向间隔 ⇒ 补 1 秒');
            assert.equal(bag.stormPullSpeed, 60);
            assert.equal(bag.stormPullRadius, 150);
        });
    }
});

test('102004 卡面：K 表口径的 desc 三份一致，修改器 94020041~43', () => {
    const plans = readRows('pvpSkillPlan')
        .filter((row) => Number(row.skillChainId) === JOKER_CHAIN)
        .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
    for (const cards of [readRows('armySkillLevelUp'), readClient('armySkillLevelUp')]) {
        const rows = cards.filter((row) => Number(row.id) === JOKER_CHAIN)
            .sort((a, b) => Number(a.skilllevel) - Number(b.skilllevel));
        assert.equal(rows.length, 3);
        rows.forEach((row, index) => {
            assert.equal(row.name, '飓风');
            assert.equal(row.desc, plans[index].desc);
            assert.equal(Number(row.unlockarmylevel), [12, 24, 36][index]);
            assert.deepEqual(row.modfiy, [94020041 + index]);
        });
    }
});

test('102004 释放：区域建在施法者脚下，半径 / 时长 / 每跳伤害照设计', () => {
    prepare();
    const caster = makeUnit(1, JOKER_UNIT, { freeX: 30, freeY: 40 });
    const units = [caster];
    const { context } = stormContext(units, stormParams(8));
    const state = skillState(units, 5);

    assert.equal(ZCAttackResolutionSystem.castStorm(state, caster, context), true);
    assert.equal(state.groundZones.length, 1);
    const zone = state.groundZones[0];
    assert.equal(zone.x, 30, '生成在施法者脚下（设计没给位置）');
    assert.equal(zone.y, 40);
    assert.equal(zone.radius, 90, '半径按表值 × combatDistanceScale');
    assert.equal(zone.remainingSeconds, 8, 'III 级 8 秒');
    assert.equal(zone.waveInterval, 0.5, '每 0.5 秒一跳');
    assert.equal(zone.wavesLeft, 16, '8 秒 ÷ 0.5 秒 = 16 跳');
    assert.equal(zone.damage, 10, '面板 100 × 10%');
    assert.equal(zone.nextWaveAt, 5, '落地立刻打第一跳');
    assert.equal(zone.holdVisual, true, '整段一条长效表现，不是每跳刷残影');
    assert.equal(zone.hitOncePerUnit, undefined,
        '设计是「每 0.5 秒造成伤害」，站在里面要一直挨 —— 不能走「每人只挨一次」');
    assert.equal(zone.effectPrefabPath, 'units/projectiles/风法师_龙卷风/风法师_龙卷风');
    assert.equal(zone.wanderSpeed, 10, '表值 × 1（本夹具 combatDistanceScale = 1）');
    assert.equal(zone.wanderTurnSeconds, 1);
    assert.equal(zone.pullSpeed, 60);
    assert.equal(zone.pullRadius, 150);

    //  参数不全 ⇒ 拒放，不白吃 CD。
    const broken = stormContext(units, { ...stormParams(8), stormRadius: 0 });
    assert.equal(ZCAttackResolutionSystem.castStorm(skillState(units, 5), caster, broken.context), false);
});

test('102004 触发：CD 走独立的 stormReadyAt，首次只挂 CD', () => {
    prepare();
    const caster = makeUnit(1, JOKER_UNIT);
    const units = [caster];
    const runtime = {
        skillChainId: JOKER_CHAIN, behaviorKey: 'storm_zone', trigger: 'none', stateMode: 'none',
        parameters: stormParams(8),
    } as unknown as ZCSkillRuntimeDefinition;
    let casts = 0;
    //  2026-11-20 口径调整：飓风改成「等找到目标才放」⇒ 闸门可开关，用例三头都要覆盖。
    let inRange = false;
    //  第二道闸：`release` 为真也可能只是「锁的是墙」⇒ 还要最近**敌人**进普攻射程。
    let nearest = 2000;
    const tickParams = {
        statusSystem: fakeStatuses().statusSystem,
        //  只给持链的那一个单位：否则同场敌人也会拿到这本「书」自己放风。
        runtimeOf: (unit: ZCUnitState) => (unit.id === 1 ? runtime : undefined),
        inAttackRange: () => inRange,
        //  普攻射程 300 表值 × 0.3 = 90 世界 px（`skillAttr 502203「三叶小丑普攻攻击距离」`）。
        attackReachOf: () => 90,
        nearestEnemyDistance: () => nearest,
        healUnit: () => undefined,
        statPatchOf: () => ({}),
        castStorm: () => { casts += 1; return true; },
    } as unknown as Parameters<typeof ZCSkillTriggerSystem.tick>[2];
    const state = skillState(units, 0);

    ZCSkillTriggerSystem.tick(state, 0.05, tickParams);
    assert.equal(casts, 0, '首次只挂 CD');
    assert.equal(caster.stormReadyAt, 12);

    //  冷却到点但普攻射程内没人 ⇒ 待触发，不消费 CD（旧口径这里是「照放」）。
    state.elapsedSeconds = 12;
    ZCSkillTriggerSystem.tick(state, 0.05, tickParams);
    assert.equal(casts, 0, '空场不许放（主动技能都要等找到目标）');
    assert.equal(caster.stormReadyAt, 12, '被拦下 ⇒ 冷却保持就绪');

    //  只在打墙：`release` 为真（墙在射程内），但最近敌人还在 2000 px 外 ⇒ 仍不放。
    //  少了这道闸，风会扔在自己脚下一动不动 —— 用户 2026-11-20 的实测反馈。
    inRange = true;
    ZCSkillTriggerSystem.tick(state, 0.05, tickParams);
    assert.equal(casts, 0, '只在打墙 ⇒ 仍待触发（不能往脚下扔）');
    assert.equal(caster.stormReadyAt, 12, '被第二道闸拦下也不消费 CD');

    //  敌人真进普攻射程：当帧补放。
    nearest = 60;
    ZCSkillTriggerSystem.tick(state, 0.05, tickParams);
    assert.equal(casts, 1, '敌人一进射程立刻补放');
    assert.equal(caster.stormReadyAt, 24, '放出去才推到下一个 CD');

    //  其他冷却格不许被顺手写脏（同卡 102001 / 102002 各有各的）。
    assert.equal(caster.roarReadyAt, undefined);
    assert.equal(caster.teamBuffReadyAt, undefined);
});

/**
 * 区域结算用的轻量上下文：只补齐 `ZCGroundZoneSystem` 真正读的那几项。
 * `hexIdAt` 恒给 1（不是 null）——「格子找不到」会让整片区域跳过判定，
 * 那样用例会「绿得莫名其妙」。
 */
function stormZoneContext(units: ZCUnitState[], random: () => number = () => 0.1) {
    const hits: Array<{ id: number; damage: number }> = [];
    const moved: Array<{ id: number; dx: number; dy: number }> = [];
    const context = {
        hexStep: 42,
        hexIdAt: () => 1,
        unitsInRadius: () => units,
        unitPosition: (unit: ZCUnitState) => ({ x: unit.freeX, y: unit.freeY }),
        damageUnit: (target: ZCUnitState, damage: number) => {
            hits.push({ id: target.id, damage });
            target.hp = Math.max(0, target.hp - damage);
            return { value: Math.round(damage), kind: 'damage', x: 0, y: 0 } as unknown as ZCFloatText;
        },
        ensureSlowStatus: () => undefined,
        applyStatus: () => undefined,
        exportStatusEffects: () => ({ nextUid: 1, units: [] }),
        random,
        displaceUnit: (unit: ZCUnitState, dx: number, dy: number) => {
            moved.push({ id: unit.id, dx, dy });
            unit.freeX += dx;
            unit.freeY += dy;
        },
        //  追踪段按 `approachTargetId` 取单位；不给的话 `advanceChase` 只能走「重选最近敌人」，
        //  投送用例就测不出「飞向那个目标」了。
        unitById: (id: number) => units.find((unit) => unit.id === id),
        combatDistanceScale: 1,
    } as unknown as Parameters<typeof ZCGroundZoneSystem.tick>[2];
    return { context, hits, moved };
}

test('102004 区域：每 0.5 秒打一跳、同一个敌人反复挨，牵引把人往风心拽', () => {
    prepare();
    const caster = makeUnit(1, JOKER_UNIT, { freeX: 0, freeY: 0 });
    //  敌人在风心正右 100（< 牵引半径 150、> 最小距离 20）⇒ 每帧被往左拽一点。
    const foe = makeUnit(2, '68001', { owner: ZCOwner.Enemy, freeX: 100, freeY: 0 });
    const units = [caster, foe];
    const cast = stormContext(units, stormParams(8));
    const state = skillState(units, 0);
    assert.equal(ZCAttackResolutionSystem.castStorm(state, caster, cast.context), true);

    const zoneCtx = stormZoneContext(units);
    //  第一拍：打一跳 + 把敌人往左拽。
    ZCGroundZoneSystem.tick(state, 0.5, zoneCtx.context);
    assert.deepEqual(zoneCtx.hits.map((hit) => hit.id), [2], '只打敌人');
    assert.equal(zoneCtx.hits[0].damage, 10);
    assert.deepEqual(zoneCtx.moved.map((move) => move.id), [2], '牵引只拽敌方');
    assert.ok(foe.freeX < 100, `被拽向风心（实际 ${foe.freeX}）`);
    assert.ok(foe.freeX > 0, '不会一步跨过圆心');

    //  第二拍：同一个敌人**再挨一次** —— 设计是「每 0.5 秒造成 10%」，不是「只挨一次」。
    const before = zoneCtx.hits.length;
    state.elapsedSeconds = 0.5;
    ZCGroundZoneSystem.tick(state, 0.5, zoneCtx.context);
    assert.equal(zoneCtx.hits.length, before + 1, '站在风里就要一直挨');

    //  游走：换向后位置应该动起来（速度 10 表值 px/s × 1）。
    const movedX = state.groundZones[0].x;
    assert.ok(Math.abs(movedX) > 0, `飓风自己在飘（x=${movedX}）`);
});

test('102004 区域：游走是 S 型（连续转向 + 按段翻号），不是每段整段重掷的折线', () => {
    //  用户口径（2026-11-20）：「飓风类技能的移动要类似 S 型的行走方式，不要固定的直线」。
    //  老实现每 `wanderTurnSeconds` 把朝向整段重掷成随机角 ⇒ 折线甚至原地掉头。
    //  现在：每帧按固定角速度累加、每段取反 ⇒ 一左一右的蛇形。
    prepare();
    const caster = makeUnit(1, JOKER_UNIT, { freeX: 0, freeY: 0 });
    const units = [caster];
    //  random 恒 0 ⇒ 初始朝向 0（+x），后面全靠转向率走 S。
    const cast = stormContext(units, stormParams(8));
    const state = skillState(units, 0);
    ZCAttackResolutionSystem.castStorm(state, caster, cast.context);
    const zone = state.groundZones[0];
    const zoneCtx = stormZoneContext(units, () => 0);

    const angles: number[] = [];
    const ys: number[] = [];
    let flips = 0;
    let lastRate = 0;
    for (let step = 0; step < 40; step += 1) {
        state.elapsedSeconds = Math.round((state.elapsedSeconds + 0.1) * 1e6) / 1e6;
        ZCGroundZoneSystem.tick(state, 0.1, zoneCtx.context);
        angles.push(zone.wanderAngleRadians as number);
        ys.push(zone.y);
        const rate = zone.wanderTurnRate ?? 0;
        if (lastRate !== 0 && Math.sign(rate) !== Math.sign(lastRate)) flips += 1;
        lastRate = rate;
    }
    //  ① 角速度要按段翻号，否则一直是同一条弧、走不出 S。
    assert.ok(flips >= 2, `角速度按段翻号（实际翻了 ${flips} 次）`);
    //  ② 连续转向：每一拍的转角恒 = |rate| × dt，而不是「跳角」。
    const expected = Math.PI / 3 * 0.1;
    for (let index = 1; index < angles.length; index += 1) {
        const delta = Math.abs(angles[index] - angles[index - 1]);
        assert.ok(Math.abs(delta - expected) < 1e-6,
            `第 ${index} 拍转角 ${delta.toFixed(6)} 应恒为 ${expected.toFixed(6)}`);
    }
    //  ③ 轨迹要真的拐回来（纵向位移方向至少变一次），这就是「S」的观测面。
    let turns = 0;
    for (let index = 2; index < ys.length; index += 1) {
        const now = ys[index] - ys[index - 1];
        const prev = ys[index - 1] - ys[index - 2];
        if (prev !== 0 && Math.sign(now) !== Math.sign(prev)) turns += 1;
    }
    assert.ok(turns >= 1, `纵向要来回（S 型），实际换向 ${turns} 次`);
});

test('102004 区域：牵引够不着 / 贴着圆心都不拽，游走方向由对局种子决定', () => {
    prepare();
    const caster = makeUnit(1, JOKER_UNIT, { freeX: 0, freeY: 0 });
    //  400 > 牵引半径 150 ⇒ 够不着；敌人贴脸 5 < 最小距离 20 ⇒ 松手。
    const far = makeUnit(2, '68001', { owner: ZCOwner.Enemy, freeX: 400, freeY: 0 });
    const hugging = makeUnit(3, '68001', { owner: ZCOwner.Enemy, freeX: 5, freeY: 0 });
    const ally = makeUnit(4, '68020', { freeX: 60, freeY: 0 });
    const units = [caster, far, hugging, ally];
    const cast = stormContext(units, stormParams(8));
    const state = skillState(units, 0);
    ZCAttackResolutionSystem.castStorm(state, caster, cast.context);

    const zoneCtx = stormZoneContext(units, () => 0.25);
    ZCGroundZoneSystem.tick(state, 0.5, zoneCtx.context);
    assert.deepEqual(zoneCtx.moved, [], '远的不拽、贴脸的松手、友军不拽');
    assert.equal(far.freeX, 400);
    assert.equal(hugging.freeX, 5);

    //  随机数 0.25 ⇒ 角度 = 0.25 × 2π = 90° ⇒ 朝 +y 漂，x 不动。
    const zone = state.groundZones[0];
    assert.ok(Math.abs(zone.wanderAngleRadians! - Math.PI / 2) < 1e-9, '方向 = random × 2π');
    assert.ok(Math.abs(zone.x) < 1e-9, `90° ⇒ x 不变（实际 ${zone.x}）`);
    assert.ok(zone.y > 0, '朝 +y 漂');
});

// ────────────────────────── 102004 投送段（2026-11-20 第 28 批）
//
// 用户原话：「三叶小丑的飓风没有从卡牌本体移动到目标的过程…是因为移动速度太小了吗？
// 如果是，改成和卡牌的移速一样，初始生成的大小只有 10%，随着移动过程逐渐成长」。
//
// 三条口径要在用例里钉死：
//  1. 出生点仍是**本体脚下**（不是直接糊在目标身上），速度取卡牌面板移速 28 世界 px/s
//     —— 配表那 10px/秒 的游走速度乘上 `combatDistanceScale` 只剩 3 世界 px/s，就是
//     「看起来没动」的根因，所以这一格**不能**再乘 `combatDistanceScale`。
//  2. 赶路期不读秒 ⇒ `stormSeconds` 是「落地后再活 N 秒」，赶路时间不吃它的寿命。
//  3. 到点必须交还随机游走（`arriveWander`），否则 `sprintSpeed` 为 0 会让它定在半空，
//     一片永不消散、也不打人的风。

test('102004 投送：出生在本体脚下、按卡牌面板移速飞向目标，到点交还游走', () => {
    prepare();
    const caster = makeUnit(1, JOKER_UNIT, { freeX: 0, freeY: 0 });
    //  目标在正右 100 世界 px（> 到达容差 22.5 = 风半径 90 × combatDistanceScale 1 × 1/4）。
    const foe = makeUnit(2, '68001', { owner: ZCOwner.Enemy, freeX: 100, freeY: 0 });
    const units = [caster, foe];
    const target = {
        kind: 'unit', id: 2, x: 100, y: 0, bodyRadius: 24, cardId: null,
    } as ZCCombatTarget;
    const cast = stormContext(units, stormParams(8), target);
    const state = skillState(units, 0);
    assert.equal(ZCAttackResolutionSystem.castStorm(state, caster, cast.context), true);
    const zone = state.groundZones[0];
    assert.equal(zone.x, 0, '出生点仍是本体脚下');
    assert.equal(zone.y, 0);
    assert.equal(zone.approachSpeed, 28,
        '投送速度 = 卡牌面板移速（世界 px/s，不再乘 combatDistanceScale）');
    assert.equal(zone.approachTargetId, 2);
    assert.equal(zone.arriveWander, true, '到点要交还游走，否则飞到目标就定住');
    assert.equal(zone.sprintRange, 22.5, '到达容差 = 风半径的 1/4');
    assert.equal(zone.growFrom, 0.1, '初始生成只有 10%');
    assert.ok(Math.abs((zone.growSeconds as number) - (100 - 22.5) / 28) < 1e-9,
        `成长时长 = 直线赶路耗时（实际 ${zone.growSeconds}）`);

    const zoneCtx = stormZoneContext(units);
    state.elapsedSeconds = 1;
    ZCGroundZoneSystem.tick(state, 1, zoneCtx.context);
    assert.ok(Math.abs(zone.x - 28) < 1e-6, `1 秒走 28 世界 px（实际 ${zone.x}）`);
    assert.equal(zone.y, 0, '朝目标直线飞');
    assert.equal(zone.remainingSeconds, 8, '赶路期不读秒 ⇒ 寿命还是满的');
    assert.deepEqual(zoneCtx.hits, [], '赶路期一波都不结算');
    //  成长口径要真的落到那条长效表现事件上（只登记在区域里不算数）。
    const visual = state.combatEvents[0] as unknown as Record<string, unknown>;
    assert.equal(visual.growFrom, 0.1, '表现事件带上了起始占比');
    assert.ok(Math.abs((visual.growSeconds as number) - (100 - 22.5) / 28) < 1e-9);

    //  继续飞：进到容差之内就「下车」，移动权交还随机游走。
    for (let index = 0; index < 200 && zone.approachSpeed !== undefined; index += 1) {
        state.elapsedSeconds += 0.1;
        ZCGroundZoneSystem.tick(state, 0.1, zoneCtx.context);
    }
    assert.equal(zone.approachSpeed, undefined, '到点下车：清掉 approachSpeed');
    assert.equal(zone.approachTargetId, undefined);
    assert.equal(zone.sprintSpeed, undefined);
    assert.equal(zone.sprinting, true, '阶段标记保留（它进快照，读档回来不能又变「还在赶路」）');
    const gap = Math.hypot(zone.x - foe.freeX, zone.y - foe.freeY);
    assert.ok(gap <= 30, `确实飞到了目标身边（离目标 ${gap.toFixed(2)}）`);

    //  落地后才开始结算人，且寿命按「含赶路共 N 秒」结账。
    const before = zoneCtx.hits.length;
    state.elapsedSeconds += 0.5;
    ZCGroundZoneSystem.tick(state, 0.5, zoneCtx.context);
    assert.ok(zoneCtx.hits.length > before, '落地后才开始打人');
    assert.ok(zone.remainingSeconds + state.elapsedSeconds <= 8.001,
        `寿命按总账扣掉赶路（剩 ${zone.remainingSeconds.toFixed(2)} + 已耗时 ${state.elapsedSeconds.toFixed(2)}）`);
    assert.ok(zone.remainingSeconds + state.elapsedSeconds >= 7.8,
        '扣的只有赶路那一段，不是把寿命多扣一刀');
});

test('102004 投送：落地那一拍只补当前一波，不把赶路期间攒的波次一次性倾泻', () => {
    prepare();
    const caster = makeUnit(1, JOKER_UNIT, { freeX: 0, freeY: 0 });
    const foe = makeUnit(2, '68001', { owner: ZCOwner.Enemy, freeX: 100, freeY: 0 });
    const units = [caster, foe];
    const target = {
        kind: 'unit', id: 2, x: 100, y: 0, bodyRadius: 24, cardId: null,
    } as ZCCombatTarget;
    const cast = stormContext(units, stormParams(8), target);
    const state = skillState(units, 0);
    ZCAttackResolutionSystem.castStorm(state, caster, cast.context);
    const zone = state.groundZones[0];
    const zoneCtx = stormZoneContext(units);
    for (let index = 0; index < 200 && zone.approachSpeed !== undefined; index += 1) {
        state.elapsedSeconds += 0.1;
        ZCGroundZoneSystem.tick(state, 0.1, zoneCtx.context);
    }
    assert.equal(zone.approachSpeed, undefined, '已落地');
    //  口径「含赶路共 N 秒」：剩余寿命 + 已耗时 恒 ≈ N（赶路期不读秒 ⇒ 这笔账只能在落地时结）。
    assert.ok(zone.remainingSeconds + state.elapsedSeconds <= 8.001,
        `落地扣掉了赶路段（剩 ${zone.remainingSeconds.toFixed(2)}，已耗时 ${state.elapsedSeconds.toFixed(2)}）`);
    assert.ok(zone.remainingSeconds < 7.9, '确实扣了，不是一秒没动');
    //  波数也要按剩余时间重算：不重算就是「整段 16 波（8s ÷ 0.5s）塞进剩下的几秒」，落地后每 0.17 秒打一下。
    const interval = 0.5;
    const wholeWaveCount = Math.round(8 / interval);
    assert.ok(zone.wavesLeft <= Math.round(zone.remainingSeconds / interval),
        `波数按剩余时间重算（wavesLeft=${zone.wavesLeft}）`);
    assert.ok(zone.wavesLeft < wholeWaveCount,
        `比整段 ${wholeWaveCount} 波少（不是照 N 秒算的那一份）：wavesLeft=${zone.wavesLeft}`
        + ` remaining=${zone.remainingSeconds.toFixed(2)} elapsed=${state.elapsedSeconds.toFixed(2)}`);
    //  赶路那 1 秒按 0.5 秒间隔本该攒下 2 波；`enterSprint` 把 `nextWaveAt` 重置到落地时刻，
    //  所以落地这一拍只补当前这一波（不重置的话这一帧会连着打 2 下）。
    assert.equal(zoneCtx.hits.length, 1, '落地只打一波');
});

test('102004 投送：追不上的目标不能把风变成永动机（赶路耗尽寿命即落地散场）', () => {
    prepare();
    const caster = makeUnit(1, JOKER_UNIT, { freeX: 0, freeY: 0 });
    //  目标在 2000 世界 px 外且不动：28 px/s 要飞 70 秒，远超这阵风 8 秒的寿命。
    //  不设「赶路耗尽即落地」这道闸的话，`remainingSeconds` 在赶路期不读秒 ⇒ 它会永远在飞。
    const foe = makeUnit(2, '68001', { owner: ZCOwner.Enemy, freeX: 2000, freeY: 0 });
    const units = [caster, foe];
    const target = {
        kind: 'unit', id: 2, x: 2000, y: 0, bodyRadius: 24, cardId: null,
    } as ZCCombatTarget;
    const cast = stormContext(units, stormParams(8), target);
    const state = skillState(units, 0);
    ZCAttackResolutionSystem.castStorm(state, caster, cast.context);
    const zoneCtx = stormZoneContext(units);
    for (let index = 0; index < 400 && state.groundZones.length; index += 1) {
        state.elapsedSeconds += 0.1;
        ZCGroundZoneSystem.tick(state, 0.1, zoneCtx.context);
    }
    assert.equal(state.groundZones.length, 0, '赶路耗尽寿命 ⇒ 落地即散场（不会永远在飞）');
    assert.ok(state.elapsedSeconds <= 8.3, `散场不晚于寿命（实际 ${state.elapsedSeconds.toFixed(2)}s）`);
    assert.deepEqual(zoneCtx.hits, [], '够不着 ⇒ 全程一下都没打到');
});

test('102004 投送：闸门放行但这一拍还没锁定 ⇒ 自己按普攻射程挑最近的敌人送出去', () => {
    prepare();
    //  用户实测反馈「改成等目标之后，飓风又不会移动了」的根因就在这里：
    //  闸门 `release` 走全表扫（射程内有活敌就放），`currentTarget` 读的是攻击流程
    //  才写的 `targetUnitId` —— 敌人刚进圈那一帧还是空的 ⇒ 投送段拿不到目标、原地生成。
    //  夹具里 `currentTarget` 给 `null` 就是在复现那一帧。
    const caster = makeUnit(1, JOKER_UNIT, { freeX: 0, freeY: 0 });
    //  射程 57 世界 px（= (45 + 24 × 0.5) × combatDistanceScale 1）：50 在圈内、80 在圈外。
    const near = makeUnit(2, '68001', { owner: ZCOwner.Enemy, freeX: 30, freeY: 40 });
    const far = makeUnit(3, '68001', { owner: ZCOwner.Enemy, freeX: 80, freeY: 0 });
    const units = [caster, near, far];
    const cast = stormContext(units, stormParams(8), null);
    const state = skillState(units, 0);
    assert.equal(ZCAttackResolutionSystem.castStorm(state, caster, cast.context), true);
    const zone = state.groundZones[0];
    assert.equal(zone.approachSpeed, 28, '照样走赶路段（不能因为没锁定就原地生成）');
    assert.equal(zone.approachTargetId, 2, '追射程内最近的那个，射程外的 3 不追');
    assert.equal(zone.growFrom, 0.1, '有赶路段 ⇒ 出生 10%');
    assert.ok(Math.abs((zone.growSeconds as number) - (50 - 22.5) / 28) < 1e-9,
        `成长时长按「本体 → 目标」直线算（实际 ${zone.growSeconds}）`);
    const zoneCtx = stormZoneContext(units);
    state.elapsedSeconds = 1;
    ZCGroundZoneSystem.tick(state, 1, zoneCtx.context);
    assert.ok(Math.abs(zone.x - 16.8) < 1e-6 && Math.abs(zone.y - 22.4) < 1e-6,
        `朝落点直线飞（实际 ${zone.x.toFixed(2)}, ${zone.y.toFixed(2)}）`);
});

test('102004 投送：锁的是墙也照样飞向射程内的敌人，不能飞到墙根再定住', () => {
    prepare();
    const caster = makeUnit(1, JOKER_UNIT, { freeX: 0, freeY: 0 });
    const foe = makeUnit(2, '68001', { owner: ZCOwner.Enemy, freeX: 50, freeY: 0 });
    const units = [caster, foe];
    //  墙在 300 世界 px 外：追墙 = 一片风飞到没有人的墙根下站定（`approachTargetId` 也没得追）。
    const wall = {
        kind: 'wall', id: 9, x: 300, y: 0, bodyRadius: 40, cardId: null,
    } as ZCCombatTarget;
    const cast = stormContext(units, stormParams(8), wall);
    const state = skillState(units, 0);
    assert.equal(ZCAttackResolutionSystem.castStorm(state, caster, cast.context), true);
    const zone = state.groundZones[0];
    assert.equal(zone.approachSpeed, 28, '有活敌 ⇒ 走赶路段');
    assert.equal(zone.approachTargetId, 2, '追的是敌人，不是墙');
    assert.equal(zone.arriveWander, true);
});

test('102004 投送：目标半路阵亡且没有替代 ⇒ 继续飞到最后已知坐标，落地才交还游走', () => {
    //  用户口径（2026-11-20 第 31 批）：「锁定目标，移动，目标丢失，切换目标，
    //  没有目标继续往旧的目标坐标移动，不会静止」。换目标那一半由 `nearestChaseTarget` 负责，
    //  这条钉的是最后一段：没有替代目标时，风要朝**最后记录的目标坐标**继续飞，
    //  而且速度不能掉成 0（投送段只有 `approachSpeed`、没有 `sprintSpeed`，
    //  老代码在这里取 `sprintSpeed ?? 0` ⇒ 整片风定在原地）。
    prepare();
    const caster = makeUnit(1, JOKER_UNIT, { freeX: 0, freeY: 0 });
    const foe = makeUnit(2, '68001', { owner: ZCOwner.Enemy, freeX: 100, freeY: 0 });
    const units = [caster, foe];
    const target = {
        kind: 'unit', id: 2, x: 100, y: 0, bodyRadius: 24, cardId: null,
    } as ZCCombatTarget;
    const cast = stormContext(units, stormParams(8), target);
    const state = skillState(units, 0);
    ZCAttackResolutionSystem.castStorm(state, caster, cast.context);
    const zone = state.groundZones[0];
    const zoneCtx = stormZoneContext(units);

    //  ① 锁定目标在飞：每一拍都把目标坐标记成「最后已知落点」。
    state.elapsedSeconds = 1;
    ZCGroundZoneSystem.tick(state, 1, zoneCtx.context);
    assert.equal(zone.chaseGoalX, 100, '目标活着时记下它的坐标');
    assert.equal(zone.chaseGoalY, 0);
    assert.ok(Math.abs(zone.x - 28) < 1e-6);

    //  ② 目标阵亡，且附近没有可换的敌人（场上只剩施法者自己）。
    foe.hp = 0;
    foe.battleState = 'dead';
    state.elapsedSeconds = 2;
    ZCGroundZoneSystem.tick(state, 1, zoneCtx.context);
    assert.equal(zone.approachSpeed, 28, '还在飞，不能提前交还游走');
    assert.equal(zone.approachTargetId, undefined, '目标已经没了');
    assert.ok(Math.abs(zone.x - 56) < 1e-6, `继续朝最后已知坐标飞（实际 ${zone.x}）`);
    assert.equal(zone.y, 0);

    //  ③ 飞到旧坐标（容差 = 风半径 1/4）才落地，旧坐标随之清掉。
    for (let index = 0; index < 100 && zone.approachSpeed !== undefined; index += 1) {
        state.elapsedSeconds += 0.1;
        ZCGroundZoneSystem.tick(state, 0.1, zoneCtx.context);
    }
    assert.equal(zone.approachSpeed, undefined, '到点交还游走');
    assert.equal(zone.chaseGoalX, undefined, '旧坐标要清掉，否则游走会被重新拽回去');
    assert.ok(zone.x >= 100 - 22.5 - 1e-6, `落在旧坐标附近（离旧点 ${(100 - zone.x).toFixed(2)}）`);
});

test('102004 投送：无活目标（含在打墙）⇒ 原地生成、退回老出场口径', () => {
    prepare();
    const caster = makeUnit(1, JOKER_UNIT, { freeX: 0, freeY: 0 });
    const foe = makeUnit(2, '68001', { owner: ZCOwner.Enemy, freeX: 100, freeY: 0 });
    const units = [caster, foe];
    const wall = {
        kind: 'wall', id: 9, x: 300, y: 0, bodyRadius: 40, cardId: null,
    } as ZCCombatTarget;
    for (const target of [null, wall]) {
        const cast = stormContext(units, stormParams(8), target);
        const state = skillState(units, 0);
        assert.equal(ZCAttackResolutionSystem.castStorm(state, caster, cast.context), true,
            '不拒放（设计：场上没敌人也照放，敌人走过来照样挨）');
        const zone = state.groundZones[0];
        assert.equal(zone.x, 0, '原地生成');
        assert.equal(zone.approachSpeed, undefined, '不走赶路段（墙 / 建筑没有可追的单位）');
        assert.equal(zone.approachTargetId, undefined);
        assert.equal(zone.arriveWander, undefined);
        assert.equal(zone.growFrom, undefined, '入场退回「从 0 长起来」的老口径');
        assert.equal(zone.growSeconds, 0.2);
        assert.equal(zone.approachSeconds, undefined, '没有赶路段 ⇒ 不累计、落地也无从扣');
    }
});

test('102004 投送：新字段必须进快照白名单（少一条就读档回来又变「追到就停」）', () => {
    const codec = readFileSync('assets/script/app/zcds/model/ZCSnapshotCodec.ts', 'utf8');
    assert.match(codec, /optional\(zone\.arriveWander/, '到点交还的阶段标记要还原理');
    assert.match(codec, /optional\(zone\.growFrom/, '起始占比要还原（写歪成 10% 就整片风缩水）');
    assert.match(codec, /optional\(zone\.approachSeconds/,
        '赶路已耗时是寿命账本，少了它读档回来会白多活一整段赶路');
});
