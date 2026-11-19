import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import type { ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import type { ZCStatusStatMods } from '../assets/script/app/zcds/model/ZCStatusEffect';
import {
    ZCStatusResolutionSystem, type IZCStatusResolutionContext,
} from '../assets/script/app/zcds/model/systems/ZCStatusResolutionSystem';

/**
 * 第 17 批 · 101803 毒液喷吐（诅咒菇 68018，2026-11-18）。
 *
 * 设计口径：四周 100/130/180%，中毒 4/5/6 秒、每秒 20/25/35%，III 级中毒期间治疗 −50%。
 *
 * 三个「照设计案字面配就会静默出错」的点，正是本用例要钉住的：
 *
 *  1. **参数必须带 `venom` 前缀**。`skillParamJson` 按 `${unitId}:${pvpSkillId}` 合并成一袋，
 *     而 68018 这袋里已经住着菌核爆裂 101804（`burstRadius` / `burstDamageRate` / `burstCooldown`）
 *     ⇒ 裸写 `burstRadius` 会把菌核爆裂的半径一起改掉，不报错。
 *  2. **CD 要各记各的**（`venomReadyAt` vs `burstReadyAt`）：共用一个字段会变成
 *     「爆完这个、那个也进冷却」。
 *  3. **治疗削弱不能反转**：`healTakenRate` 是百分点，-50 = ×0.5；减到 -100 以下按 0 处理，
 *     绝不能变成「治疗把人治死」。
 */

const ROOT = join(import.meta.dirname, '..');

function readSource(relative: string): string {
    return readFileSync(join(ROOT, relative), 'utf8');
}

/**
 * 配表两份产物路径不一样，**客户端版在副本根、不在 Demo3.8 下**（`../doc/塔防数据配置/json/client/`），
 * 而 `assets/remoteRef/*.json` 是列存 `{k:[], v:[[]], c}`。两个都要读、都要校，
 * 只读一份会漏掉「脚本只写了其中一份」这种最常见的漂移。
 */
const CLIENT_ROOT = join(ROOT, '..', 'doc', '塔防数据配置', 'json', 'client');

function readAny(file: string): Array<Record<string, unknown>> {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (Array.isArray(parsed)) return parsed as Array<Record<string, unknown>>;
    const keys = parsed.k as string[];
    return (parsed.v as unknown[][]).map((cells) => {
        const row: Record<string, unknown> = {};
        keys.forEach((key, index) => { row[key] = cells[index]; });
        return row;
    });
}

/** 同一张表的两份产物，逐行对齐返回（remoteRef 在前、client 在后）。 */
function readBoth(table: string): [Array<Record<string, unknown>>, Array<Record<string, unknown>>] {
    return [
        readAny(join(ROOT, 'assets/remoteRef', `${table}.json`)),
        readAny(join(CLIENT_ROOT, `${table}.json`)),
    ];
}

function makeUnit(id: number, hp: number, maxHp: number): ZCUnitState {
    return { id, owner: ZCOwner.Player, hp, maxHp, battleState: 'waitAttack' } as unknown as ZCUnitState;
}

function healContext(mods: ZCStatusStatMods) {
    const healed: number[] = [];
    const context = {
        statusSystem: { statModsOf: () => mods },
        presentHeal: (_unit: ZCUnitState, amount: number) => { healed.push(amount); },
    } as unknown as IZCStatusResolutionContext;
    return { context, healed };
}

// ────────────────────────────────────────────── 一、治疗削弱

test('healTakenRate = -50：只加到一半，飘字也是实际加到的那一半', () => {
    const unit = makeUnit(1, 500, 1000);
    const { context, healed } = healContext({ healTakenRate: -50 });
    ZCStatusResolutionSystem.healUnit(unit, 200, context);
    assert.equal(unit.hp, 600, '200 的治疗只回 100');
    assert.deepEqual(healed, [100], '飘字按实回量');
});

test('没有 healTakenRate ⇒ 治疗量逐字不变（存量行为）', () => {
    const unit = makeUnit(2, 500, 1000);
    const { context, healed } = healContext({});
    ZCStatusResolutionSystem.healUnit(unit, 200, context);
    assert.equal(unit.hp, 700);
    assert.deepEqual(healed, [200]);
});

test('削弱到 -100 以下按 0 处理，绝不变成掉血', () => {
    const unit = makeUnit(3, 500, 1000);
    const { context, healed } = healContext({ healTakenRate: -180 });
    ZCStatusResolutionSystem.healUnit(unit, 200, context);
    assert.equal(unit.hp, 500, '血量不动');
    assert.deepEqual(healed, [], '没回血就不推飘字');
});

test('封顶仍然生效：治疗削弱后也不会超过最大生命', () => {
    const unit = makeUnit(4, 950, 1000);
    const { context } = healContext({ healTakenRate: -50 });
    ZCStatusResolutionSystem.healUnit(unit, 200, context);
    assert.equal(unit.hp, 1000, '100 的实回量里只有 50 吃得下');
});

// ────────────────────────────────────────────── 二、车道接线（源码守卫）

test('爆发车道按 lane 取前缀，两条技能不抢同一袋参数', () => {
    const source = readSource('assets/script/app/zcds/model/systems/ZCAttackResolutionSystem.ts');
    assert.match(source, /lane: 'burst' \| 'venom' = 'burst'/, 'castBurstSkill 必须带 lane');
    for (const key of ['DamageRate', 'Radius', 'ShieldRatio', 'ShieldSeconds', 'KnockbackCells']) {
        assert.match(source, new RegExp('parameters\\?\\.\\[`\\$\\{lane\\}' + key + '`\\]'),
            `${key} 必须按 lane 拼前缀，不能写死 burst`);
    }
    assert.doesNotMatch(source, /parameters\?\.burstRadius/, '不许再残留写死的 burstRadius');
});

test('命中时按计划行的 statusId 给圈内目标挂状态', () => {
    const source = readSource('assets/script/app/zcds/model/systems/ZCAttackResolutionSystem.ts');
    assert.match(source, /const hitStatusId = runtime\?\.statusId/, '读计划行的 statusId');
    assert.match(source, /statusSystem\.apply\(String\(victim\.id\), hitStatusId/, '挂给被打的人，不是施法者');
    assert.match(source, /hitStatusId && victim\.hp > 0 && victim\.battleState !== 'dead'/, '死人不挂毒');
    assert.match(source, /else if \(statusApplied\)[\s\S]{0,120}exportSnapshot/, '中毒也要进快照，否则图标不出现');
});

test('毒液喷吐的 CD 与菌核爆裂分开记', () => {
    const trigger = readSource('assets/script/app/zcds/model/systems/ZCSkillTriggerSystem.ts');
    assert.match(trigger, /lane === 'venom' \? 'venomReadyAt' : 'burstReadyAt'/, '两条车道各记各的 CD');
    assert.match(trigger, /applyBurstSkill\(unit, params, now, context, 'venom'\)/, 'venom 车道要真的被调用');
    const types = readSource('assets/script/app/zcds/model/ZCGameTypes.ts');
    assert.match(types, /venomReadyAt\?: number;/, '单位状态要留字段');
    const codec = readSource('assets/script/app/zcds/model/ZCSnapshotCodec.ts');
    assert.match(codec, /'venomReadyAt'/, '不还原 = 读档回来白送一次喷吐');
});

// ────────────────────────────────────────────── 三、配表

test('101803 三档：venom 前缀 + 各指一条中毒状态 + 解锁 9/18/27', () => {
    const expects = [[20, 4], [25, 5], [35, 6]];
    for (const rows of readBoth('pvpSkillPlan')) {
        const plan = rows.filter((row) => Number(row.skillChainId) === 101803)
            .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
        assert.equal(plan.length, 3, '三档都要在');
        plan.forEach((row, index) => {
            const bag = JSON.parse(String(row.skillParamJson)) as Record<string, number>;
            assert.deepEqual(Object.keys(bag).filter((key) => !key.startsWith('venom')), [],
                '参数全带 venom 前缀，否则会串到 101804');
            assert.equal(bag.venomRadius, 150);
            assert.equal(bag.venomCooldown, 12);
            assert.equal(row.statusId, `poison_venom_l${index + 1}`, '各档指自己那条中毒');
            assert.equal(Number(row.unlockHeroLevel), [9, 18, 27][index]);
            assert.match(String(row.desc), new RegExp(`每秒 ${expects[index][0]}% 伤害`));
        });
        assert.match(String(plan[2].desc), /治疗降低 50%/, 'III 级文案要带减治疗');
    }
});

test('三条中毒状态：周期伤害形态 + 只有 III 级带 healTakenRate', () => {
    const expects = [[20, 4], [25, 5], [35, 6]];
    for (const rows of readBoth('pvpStatus')) {
        const poison = ['poison_venom_l1', 'poison_venom_l2', 'poison_venom_l3'].map((id) => {
            const row = rows.find((item) => item.statusId === id);
            assert.ok(row, `${id} 必须在 pvpStatus 里`);
            return row!;
        });
        poison.forEach((row, index) => {
            //  形态：每秒结算一次、按施加者的攻击力算 —— 写成 `percent_max_hp` 会变成秒杀。
            assert.equal(row.handlerKey, 'periodic_damage');
            assert.equal(Number(row.intervalSeconds), 1);
            assert.equal(Number(row.periodicAmountPct), expects[index][0]);
            assert.equal(row.periodicBasis, 'senderAttack');
            assert.equal(Number(row.durationSeconds), expects[index][1]);
        });
        //  前两档的 statJson 必须是空 —— 带上 healTakenRate 会让 I 级也减治疗。
        [poison[0], poison[1]].forEach((row) => {
            const stat = row.statJson == null ? '' : String(row.statJson);
            assert.doesNotMatch(stat, /healTakenRate/, 'I/II 级不减治疗');
        });
        assert.deepEqual(JSON.parse(String(poison[2].statJson)), { healTakenRate: -50 });
    }
});
