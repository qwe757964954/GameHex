/**
 * 仙人侍卫（68021）「巨型仙人掌」102104（2026-11-18，第 17 批）：
 *
 * 设计案 K/L/M 三档：三档只差最后一个数 ——
 *   「体积变大 30%，身周出现尖刺风暴，每秒对附近的敌人造成 50% 伤害，持续 6 秒，
 *     期间反弹 50 / 51 / 52% 伤害」
 *
 * 三个容易配错的点，正是本用例要钉住的：
 *
 *  1. **体型是百分点**（100 = ×2）⇒ 「变大 30%」写 30，写成 0.3 等于没变；
 *     而且它**只进表现层**，`bodyRadius` 一个字节都不许动，否则「变大」= 「半个屏幕都算挨着」。
 *  2. **反弹读挨打那一方**：`reflectRate` 挂在被攻击者身上，不是攻击者；
 *     反弹伤害直接 `applyDamage`，不过第二遍减伤 / 闪避，**且不递归**。
 *  3. **三项自身增益并进同一条状态**：体型 + 反弹 +（既有的）增伤 生命周期一致，
 *     分开挂会在 6 秒里出现三个图标、到期还错拍。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import type { ZCDamageSource, ZCSnapshot, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import type { ZCSkillRuntimeDefinition } from '../assets/script/app/zcds/model/ZCSkillRuntime';
import { ZCStatusSystem } from '../assets/script/app/zcds/model/ZCStatusEffect';
import { ZCSkillTriggerSystem } from '../assets/script/app/zcds/model/systems/ZCSkillTriggerSystem';
import { ZCDamageResolutionSystem } from '../assets/script/app/zcds/model/systems/ZCDamageResolutionSystem';

// ────────────────────────────────────────────── 夹具

const ROOT = join(__dirname, '..');
const UNIT_ID = '68021';
const CHAIN = 102104;
const SKILL_ID = 30721;

const PARAMS = {
    auraCooldown: 12, auraSeconds: 6, auraInterval: 1, auraRadius: 120,
    auraDamageRate: 0.5, auraBodySizePct: 30, auraReflectPct: 50,
};

function readTable(name: string): Array<Record<string, unknown>> {
    const parsed = JSON.parse(readFileSync(join(ROOT, 'assets', 'remoteRef', `${name}.json`), 'utf8'));
    if (Array.isArray(parsed)) return parsed as Array<Record<string, unknown>>;
    const keys = parsed.k as string[];
    return (parsed.v as unknown[][]).map((row) => Object.fromEntries(keys.map((key, i) => [key, row[i]])));
}

function readClientTable(name: string): Array<Record<string, unknown>> {
    return JSON.parse(readFileSync(
        join(ROOT, '..', 'doc', '塔防数据配置', 'json', 'client', `${name}.json`), 'utf8'));
}

function unit(id: number, owner: ZCOwner, overrides: Partial<ZCUnitState> = {}): ZCUnitState {
    return {
        id, unitId: owner === 'player' ? UNIT_ID : '68001', owner, cardId: '68021', tier: 1,
        sourceHexId: id, targetHexId: null, progress: 0,
        hp: 1000, maxHp: 1000, battleState: 'idle', stateTime: 0,
        targetUnitId: null, targetWallHexId: null, targetBuildingHexId: null,
        nextAttackAt: 0, waitUntil: 0, attackHitDone: false,
        hatredUnitId: null, hatredUntil: 0, facingRadians: 0, deathRemoveAt: 0,
        marchAngle: null, freeX: 0, freeY: 0, completedAttackCount: 0,
        shield: 0,
        ...overrides,
    } as ZCUnitState;
}

function snapshot(units: ZCUnitState[], elapsedSeconds = 0): ZCSnapshot {
    return {
        version: 4, elapsedSeconds, nextCombatEventId: 1,
        units, projectiles: [], groundZones: [], combatEvents: [], hexes: {},
        statusEffects: { nextUid: 1, units: [] }, spawnClocks: {},
    } as unknown as ZCSnapshot;
}

/** 伤害结算上下文：只关心「谁掉了多少血」「谁被打死了」。 */
function damageContext(statusSystem: ZCStatusSystem, units: ZCUnitState[]) {
    const byId = new Map(units.map((item) => [item.id, item]));
    byId.forEach((item) => { if (item.battleState === 'dead') return; });
    return {
        statusSystem,
        units: { byId, markDead: () => {} },
        damageDealt: { [ZCOwner.Player]: 0, [ZCOwner.Enemy]: 0 },
        damageTaken: { [ZCOwner.Player]: 0, [ZCOwner.Enemy]: 0 },
        random: () => 0.99,
    } as unknown as Parameters<typeof ZCDamageResolutionSystem.damageUnit>[4];
}

/** 把 `reflectRate` / `bodySizePct` 直接挂到状态系统上，省去跑一遍光环施法。 */
function grantReflect(statusSystem: ZCStatusSystem, unitId: number, mods: Record<string, number>): void {
    const id = `__test_reflect:${JSON.stringify(mods)}__`;
    statusSystem.register({
        id, name: id, durationSeconds: 6, maxStacks: 1, refreshPolicy: 'refresh',
        statMods: mods, behavior: { kind: 'none' },
    });
    statusSystem.apply(String(unitId), id, { at: 0, durationSeconds: 6 });
}

// ────────────────────────────────────────────── 一、反弹

test('受伤反弹：按「实际掉血」的 50% 打回攻击者', () => {
    const tank = unit(1, 'player');
    const attacker = unit(2, 'enemy', { freeX: 10, freeY: 0 });
    const statusSystem = new ZCStatusSystem();
    grantReflect(statusSystem, tank.id, { reflectRate: 50 });
    const state = snapshot([tank, attacker]);
    const context = damageContext(statusSystem, [tank, attacker]);
    const source: ZCDamageSource = { owner: ZCOwner.Enemy, kind: 'unit', unitId: attacker.id };

    ZCDamageResolutionSystem.damageUnit(state, tank, 100, source, context);
    assert.equal(tank.hp, 900, '自己照常掉 100');
    assert.equal(attacker.hp, 950, '反弹 50（100 × 50%）');
});

test('没有 reflectRate 时一个字都不变（存量路径逐字相同）', () => {
    const tank = unit(1, 'player');
    const attacker = unit(2, 'enemy');
    const statusSystem = new ZCStatusSystem();
    const state = snapshot([tank, attacker]);
    const context = damageContext(statusSystem, [tank, attacker]);
    ZCDamageResolutionSystem.damageUnit(state, tank, 100,
        { owner: ZCOwner.Enemy, kind: 'unit', unitId: attacker.id }, context);
    assert.equal(attacker.hp, 1000, '没开反弹不该掉血');
});

test('反弹按「实际掉血」算：护盾吃掉的份额不参与', () => {
    const tank = unit(1, 'player', { shield: 60 });
    const attacker = unit(2, 'enemy');
    const statusSystem = new ZCStatusSystem();
    grantReflect(statusSystem, tank.id, { reflectRate: 50 });
    const state = snapshot([tank, attacker]);
    const context = damageContext(statusSystem, [tank, attacker]);
    ZCDamageResolutionSystem.damageUnit(state, tank, 100,
        { owner: ZCOwner.Enemy, kind: 'unit', unitId: attacker.id }, context);
    assert.equal(tank.hp, 960, '护盾挡 60，只掉 40');
    assert.equal(attacker.hp, 980, '反弹 40 × 50% = 20（不是 50）');
});

test('反弹不再吃第二遍减伤、不会递归互弹', () => {
    const tank = unit(1, 'player');
    const attacker = unit(2, 'enemy');
    const statusSystem = new ZCStatusSystem();
    //  双方都开反弹：如果反射走 `damageUnit`，两人会互相弹到天荒地老。
    grantReflect(statusSystem, tank.id, { reflectRate: 50 });
    const second = `__test_reflect_b:${attacker.id}__`;
    statusSystem.register({
        id: second, name: second, durationSeconds: 6, maxStacks: 1, refreshPolicy: 'refresh',
        statMods: { reflectRate: 50 }, behavior: { kind: 'none' },
    });
    statusSystem.apply(String(attacker.id), second, { at: 0, durationSeconds: 6 });

    const state = snapshot([tank, attacker]);
    const context = damageContext(statusSystem, [tank, attacker]);
    ZCDamageResolutionSystem.damageUnit(state, tank, 100,
        { owner: ZCOwner.Enemy, kind: 'unit', unitId: attacker.id }, context);
    assert.equal(tank.hp, 900);
    assert.equal(attacker.hp, 950, '只反弹一次；攻击者身上的反弹没有再弹回来');
});

test('反弹把攻击者打死：走同一段阵亡收尾', () => {
    const tank = unit(1, 'player');
    const attacker = unit(2, 'enemy', { hp: 20, maxHp: 1000 });
    const statusSystem = new ZCStatusSystem();
    grantReflect(statusSystem, tank.id, { reflectRate: 50 });
    const state = snapshot([tank, attacker]);
    const marked: number[] = [];
    const context = damageContext(statusSystem, [tank, attacker]);
    (context as unknown as { units: { markDead: (item: ZCUnitState) => void } }).units.markDead = (item) => {
        marked.push(item.id);
    };
    ZCDamageResolutionSystem.damageUnit(state, tank, 100,
        { owner: ZCOwner.Enemy, kind: 'unit', unitId: attacker.id }, context);
    assert.equal(attacker.hp, 0);
    assert.equal(attacker.battleState, 'dead');
    assert.deepEqual(marked, [attacker.id], '必须走 `markDead`，否则尸体会一直站在场上');
});

// ────────────────────────────────────────────── 二、光环期间的自身增益

test('光环开出来就把「体型 + 反弹」挂上，6 秒同一条状态', () => {
    const caster = unit(1, 'player');
    const state = snapshot([caster]);
    const statusSystem = new ZCStatusSystem();
    const runtimeDefinition = {
        unitId: UNIT_ID, skillId: SKILL_ID, behaviorKey: 'self_aura',
        trigger: 'every_seconds', stateMode: 'none', parameters: PARAMS,
    } as unknown as ZCSkillRuntimeDefinition;

    let casts = 0;
    const context = {
        statusSystem,
        runtimeOf: (target: ZCUnitState) => (target.owner === 'player' ? runtimeDefinition : undefined),
        castSelfAura: () => { casts += 1; return true; },
        unitPosition: (target: ZCUnitState) => ({ x: target.freeX, y: target.freeY }),
        distanceScale: 0.3,
        inAttackRange: () => true,
        nearestEnemyDistance: () => 10,
        effectiveDefinition: () => ({
            unitId: UNIT_ID, name: '仙人侍卫', maxHp: 800, attack: 52, moveSpeed: 40,
            attackRange: 45, attackInterval: 1.8, attackDuration: 0.5, attackHitTime: 0.2,
            bodyRadius: 26, spawnSeconds: 0, flying: false, canAttackAir: false, hero: true,
            prefabPath: 'units/units/仙人侍卫', prefabSize: 1,
            attackProfile: { skillId: SKILL_ID, name: '仙人掌刺', mode: 'melee' },
        }),
    } as unknown as Parameters<typeof ZCSkillTriggerSystem.tick>[2];

    ZCSkillTriggerSystem.tick(state, 0.05, context);
    assert.equal(casts, 0, '冷却制：开局首次只挂 CD，这一帧不该放');
    state.elapsedSeconds = 12;
    ZCSkillTriggerSystem.tick(state, 0.05, context);
    assert.equal(casts, 1, 'CD 到点才放');

    const mods = statusSystem.statModsOf(String(caster.id));
    assert.equal(mods.bodySizePct, 30, '「体积变大 30%」= 百分点 30');
    assert.equal(mods.reflectRate, 50, 'L1 反弹 50%');
});

test('体型只进表现层：`syncBodyScale` 不许碰 bodyRadius', () => {
    const model = readFileSync(join(ROOT, 'assets/script/app/zcds/model/ZCGameModel.ts'), 'utf8');
    const start = model.indexOf('private syncBodyScale(): void {');
    assert.ok(start > 0, 'ZCGameModel 里必须有 syncBodyScale');
    const body = model.slice(start, model.indexOf('private sendAttack(', start));
    assert.match(body, /bodyScale/, '要把状态里的 bodySizePct 折成 unit.bodyScale');
    assert.doesNotMatch(body, /bodyRadius\s*=/, '不许改命中半径 —— 否则「变大」= 半个屏幕都算挨着');
});

// ────────────────────────────────────────────── 三、配表守卫

test('102104 三档：每秒 50% / 6 秒 / 体型 30 / 反弹 50·51·52', () => {
    for (const rows of [readTable('pvpSkillPlan'), readClientTable('pvpSkillPlan')]) {
        const plan = rows.filter((row) => Number(row.skillChainId) === CHAIN)
            .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
        assert.equal(plan.length, 3, '三档都要在');
        plan.forEach((row, index) => {
            const bag = JSON.parse(String(row.skillParamJson)) as Record<string, number>;
            assert.deepEqual(Object.keys(bag).filter((key) => !key.startsWith('aura')), [],
                '参数全带 aura 前缀，否则会串到 102103 废土铁芽');
            assert.equal(bag.auraDamageRate, 0.5, '设计：每秒 50% 伤害');
            assert.equal(bag.auraSeconds, 6);
            assert.equal(bag.auraInterval, 1);
            assert.equal(bag.auraBodySizePct, 30, '百分点，写成 0.3 就等于没变');
            assert.equal(bag.auraReflectPct, [50, 51, 52][index]);
            assert.equal(row.behaviorKey, 'self_aura');
            assert.equal(Number(row.unlockHeroLevel), [7, 24, 36][index]);
            assert.match(String(row.desc), new RegExp(`反弹 ${[50, 51, 52][index]}% 伤害`));
        });
    }
});

test('K 表 / armySkillLevelUp：卡面描述与本条一致，修改器号已接上', () => {
    const plans = readTable('pvpSkillPlan')
        .filter((row) => Number(row.skillChainId) === CHAIN)
        .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
    for (const cards of [readTable('armySkillLevelUp'), readClientTable('armySkillLevelUp')]) {
        const rows = cards.filter((row) => Number(row.id) === CHAIN)
            .sort((a, b) => Number(a.skilllevel) - Number(b.skilllevel));
        assert.equal(rows.length, 3);
        rows.forEach((row, index) => {
            assert.equal(row.desc, plans[index].desc);
            assert.deepEqual(row.modfiy, [Number(plans[index].modifierId)]);
        });
    }
});
