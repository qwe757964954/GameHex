import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import type { ZCSnapshot, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import type { ZCSkillRuntimeDefinition } from '../assets/script/app/zcds/model/ZCSkillRuntime';
import { ZCSkillRuntimeRegistry } from '../assets/script/app/zcds/model/ZCSkillRuntime';
import type { ZCStatusStatMods } from '../assets/script/app/zcds/model/ZCStatusEffect';
import { ZCSkillTriggerSystem, selfCastStatusId } from '../assets/script/app/zcds/model/systems/ZCSkillTriggerSystem';

/**
 * 第 17 批 · `counter_self_buff`（2026-11-18）——「累计普攻 N 次给自己开一段增益」。
 *
 *   · 窝瓜人「生命爆发」101904：移速 +50/80/100%、体型 ×2、最大生命 +15/30/50%；
 *   · 爆锤莲王「战神附体」102704：体型 ×2、移速 −15%、攻击 +50/70/100%，6 秒，回 15% 最大生命。
 *
 * 这一批有四个「照字面配就会静默出错」的点，正是本用例要钉住的：
 *
 *  1. **`bodySizePct` 是百分点、不是比例**：100 = 体型 ×2。写成 `addRate` 会去乘一个不存在的
 *     `baseValue` ⇒ 恒 0（体型一动不动，也不报错）。它与 `bulletSizeScale`（弹体）不是一回事。
 *  2. **体型只进表现层**：`unit.bodyScale` 只被 `ZCUnitView` 读，`bodyRadius` 必须保持原值 ——
 *     否则「变大」会顺手变成「半个屏幕都算挨着」，对玩家是纯亏。
 *  3. **计数要独立**：`counterFiredCount` 不能复用 `auraFiredCount`，否则同卡两条车道互相吃次数。
 *  4. **打满但参数不全不消费次数**（与第 12/13 批同一条口径），补上参数后要能立刻放。
 */

const ROOT = join(import.meta.dirname, '..');

function readSource(relative: string): string {
    return readFileSync(join(ROOT, relative), 'utf8');
}

function makeUnit(id: number, owner: ZCOwner, x: number): ZCUnitState {
    return {
        id, owner, unitId: '68027', cardId: 68027, tier: 1,
        freeX: x, freeY: 0, hp: 1000, maxHp: 1000, shield: 0,
        battleState: 'waitAttack', stateTime: 0, completedAttackCount: 0,
        attackMultiplier: 1,
    } as unknown as ZCUnitState;
}

function makeState(units: ZCUnitState[]): ZCSnapshot {
    return { units, elapsedSeconds: 0, statusEffects: { nextUid: 1, units: [] }, combatEvents: [] } as unknown as ZCSnapshot;
}

//  ── 102704 战神附体 L3 的实际参数（配表照抄；前缀 `counter*` 见 P 列）──
const WAR_GOD = {
    counterEvery: 10,
    counterSeconds: 6,
    counterBodySizePct: 100,
    counterMoveSpeedPct: -15,
    counterAttackPct: 100,
    counterHealMaxHpPct: 15,
};

interface HarnessOptions {
    readonly params?: Record<string, number>;
    readonly maxHp?: number;
}

function harness(options: HarnessOptions = {}) {
    const caster = makeUnit(1, ZCOwner.Player, 0);
    if (options.maxHp !== undefined) { caster.maxHp = options.maxHp; caster.hp = options.maxHp; }
    const state = makeState([caster]);
    const runtime = {
        unitId: '68027', skillId: 102704, behaviorKey: 'counter_self_buff',
        trigger: 'none', stateMode: 'none', parameters: { ...(options.params ?? WAR_GOD) },
    } as unknown as ZCSkillRuntimeDefinition;
    const applied: Array<{ unitId: string; statusId: string; seconds?: number }> = [];
    const registered = new Map<string, { statMods?: ZCStatusStatMods; durationSeconds?: number }>();
    const healed: number[] = [];
    const context = {
        statusSystem: {
            hasDef: (id: string) => registered.has(id),
            register: (definition: { id: string; statMods?: ZCStatusStatMods; durationSeconds?: number }) => {
                registered.set(definition.id, definition);
            },
            apply: (unitId: string, statusId: string, extra?: { durationSeconds?: number }) => {
                applied.push({ unitId, statusId, seconds: extra?.durationSeconds });
                return { applied: true };
            },
            statModsOf: () => ({}),
            exportSnapshot: () => ({ nextUid: 1, units: [] }),
            instancesOf: () => [],
        },
        runtimeOf: () => runtime,
        healUnit: (_unit: ZCUnitState, amount: number) => { healed.push(amount); },
        //  本车道不吃普攻射程闸门（加成的是自己），故意给 false 证明它不看这个。
        inAttackRange: () => false,
    } as unknown as Parameters<typeof ZCSkillTriggerSystem.tick>[2];
    return {
        caster, state, applied, registered, healed, runtime, context,
        /** 把 `completedAttackCount` 推到第 n 次，再 tick 一拍。*/
        step: (at: number, attackCount: number) => {
            caster.completedAttackCount = attackCount;
            state.elapsedSeconds = at;
            ZCSkillTriggerSystem.tick(state, 0.05, context);
        },
    };
}

// ────────────────────────────────────────────── 一、触发口径

test('首次 tick 只记下当前计数，不立刻放（与 auraFiredCount 同口径）', () => {
    const box = harness();
    box.step(1, 4);
    assert.equal(box.caster.counterFiredCount, 4, '第一次推进只记数');
    assert.equal(box.applied.length, 0, '不许一上场就白送一段增益');
});

test('累计普攻满 10 次才放；差一次不放', () => {
    const box = harness();
    box.step(1, 0);                 // 记 0
    box.step(2, 9);
    assert.equal(box.applied.length, 0, '第 9 次还不放');
    box.step(3, 10);
    assert.equal(box.applied.length, 1, '第 10 次放');
    assert.equal(box.caster.counterFiredCount, 10, '计数推到本次');
});

test('放出来之后重新攒：再打 10 次才放第二次', () => {
    const box = harness();
    box.step(1, 0);
    box.step(2, 10);
    box.step(3, 15);
    assert.equal(box.applied.length, 1, '15 次时还差 5 次');
    box.step(4, 20);
    assert.equal(box.applied.length, 2, '20 次放第二次');
});

// ────────────────────────────────────────────── 二、增益内容

test('战神附体 L3：体型 ×2 / 移速 −15 / 攻击 +100 全进同一条状态', () => {
    const box = harness();
    box.step(1, 0);
    box.step(2, 10);
    const statusId = box.applied[0].statusId;
    const def = box.registered.get(statusId);
    assert.ok(def, '状态必须动态注册过');
    assert.equal(def.durationSeconds, 6, '持续 6 秒');
    assert.deepEqual(def.statMods, {
        bodySizePct: 100, moveSpeedPct: -15, attackPct: 100,
    }, '四项里没有 maxHpPct 的这条不写 0，避免把状态签名搅乱');
});

test('生命爆发 L1：移速 / 体型 / 生命上限三项，攻击不写', () => {
    const box = harness({
        params: { counterEvery: 10, counterSeconds: 6, counterMoveSpeedPct: 50, counterBodySizePct: 100, counterMaxHpPct: 15 },
    });
    box.step(1, 0);
    box.step(2, 10);
    const def = box.registered.get(box.applied[0].statusId);
    assert.deepEqual(def?.statMods, { moveSpeedPct: 50, bodySizePct: 100, maxHpPct: 15 });
});

test('状态 id 走词缀签名：同数值复用同一条定义，不同数值不复用', () => {
    const same = selfCastStatusId({ bodySizePct: 100, attackPct: 100 }, 6);
    assert.equal(same, selfCastStatusId({ attackPct: 100, bodySizePct: 100 }, 6), '键序不影响 id');
    assert.notEqual(same, selfCastStatusId({ bodySizePct: 100, attackPct: 70 }, 6), '数值不同 ⇒ 不同定义');
});

test('回血按释放瞬间的最大生命 ×15%', () => {
    const box = harness({ maxHp: 2000 });
    box.step(1, 0);
    box.step(2, 10);
    assert.deepEqual(box.healed, [300], '2000 × 15% = 300');
});

// ────────────────────────────────────────────── 三、不打空、不误触发

test('参数不全（缺 counterSeconds）⇒ 不消费次数，补上后立刻放', () => {
    const box = harness({ params: { counterEvery: 10, counterBodySizePct: 100 } });
    box.step(1, 0);
    box.step(2, 10);
    assert.equal(box.applied.length, 0, '没有时长 ⇒ 不放');
    assert.equal(box.caster.counterFiredCount, 0, '次数不许被吃掉');

    box.runtime.parameters = { ...box.runtime.parameters, counterSeconds: 6 };
    box.step(3, 10);
    assert.equal(box.applied.length, 1, '参数补齐后这一帧就放');
});

test('没有 counterEvery（不是这条车道）⇒ 整段不执行', () => {
    const box = harness({ params: { counterSeconds: 6, counterAttackPct: 100 } });
    box.step(1, 0);
    box.step(2, 50);
    assert.equal(box.applied.length, 0);
    assert.equal(box.caster.counterFiredCount, undefined, '连计数都不该写');
});

test('不吃普攻射程闸门：`inAttackRange` 恒 false 也照放', () => {
    const box = harness();
    box.step(1, 0);
    box.step(2, 10);
    assert.equal(box.applied.length, 1, '加成的是自己，敌方在不在射程内无关');
});

// ────────────────────────────────────────────── 四、车道登记与源码守卫

test('behaviorKey 已注册且是「只带数据」的 none 状态机', () => {
    const registry = new ZCSkillRuntimeRegistry();
    const definition = registry.register('counter_self_buff', 'none');
    assert.ok(definition, '注册链可用');
    const source = readSource('assets/script/app/zcds/model/ZCSkillRuntime.ts');
    assert.match(source, /this\.register\('counter_self_buff', 'none'\)/, '车道必须注册');
    const schema = readSource('assets/script/app/zcds/model/ZCStatSchema.ts');
    assert.match(schema, /'counter_self_buff'/, 'SKILL_BEHAVIORS 白名单要有它，否则读表就炸');
});

test('bodySizePct 在四处登记点齐全（缺一处就是「配了没反应」）', () => {
    const schema = readSource('assets/script/app/zcds/model/ZCStatSchema.ts');
    assert.match(schema, /\| 'bodySizePct'/, '① ZCStatId 联合类型');
    assert.match(schema, /'hpRegenPct', 'bulletSizeScale', 'bodySizePct',\n    'attackCount'/, '② STAT_IDS 集合');
    assert.match(schema, /'hpRegenPct', 'bulletSizeScale', 'bodySizePct',\n\]/, '③ UNIT_STAT_IDS');
    assert.match(schema, /bodySizePct: \['bodySizePct', null\]/, '④ STAT_TO_PATCH（第二个槽位必须是 null）');
    const runtime = readSource('assets/script/app/zcds/model/ZCModifierRuntime.ts');
    assert.match(runtime, /bodySizePct\?: number;/, 'ZCUnitStatPatch 字段');
    const status = readSource('assets/script/app/zcds/model/ZCStatusEffect.ts');
    assert.match(status, /bodySizePct\?: number;/, 'ZCStatusStatMods 字段（状态要走这条）');
});

test('体型只进表现层：视图乘 bodyScale、模型不动 bodyRadius', () => {
    const view = readSource('assets/script/app/zcds/view/ZCUnitView.ts');
    assert.match(view, /\(unit\.bodyScale \?\? 1\)/, '本体缩放要乘');
    assert.match(view, /this\.barOffsetY \* this\.visualSize \* \(unit\.gateScale \?\? 1\) \* \(unit\.bodyScale \?\? 1\)/,
        '血条偏移要跟着升，否则放大后血条陷进脑袋');
    const model = readSource('assets/script/app/zcds/model/ZCGameModel.ts');
    const start = model.indexOf('private syncBodyScale(): void {');
    assert.ok(start > 0, '模型里必须有 syncBodyScale');
    const body = model.slice(start, model.indexOf('private sendAttack(', start));
    assert.match(body, /statusSystem\.statModsOf/, '状态侧要读');
    assert.match(body, /unitStatPatches\[unit\.owner\]/, '构筑期侧要读');
    assert.doesNotMatch(body, /unit\.bodyRadius\s*=/, '不许改命中半径');
    assert.doesNotMatch(body, /bodyRadius\s*=/, '整段都不许碰 bodyRadius');
});

test('计数与快照：counterFiredCount / bodyScale 都进了还原白名单', () => {
    const codec = readSource('assets/script/app/zcds/model/ZCSnapshotCodec.ts');
    assert.match(codec, /'counterFiredCount', 'bodyScale'/, '不还原 = 读档回来白拿一段增益 / 体型变回原样');
    const types = readSource('assets/script/app/zcds/model/ZCGameTypes.ts');
    assert.match(types, /counterFiredCount\?: number;/, '单位状态字段');
    assert.match(types, /bodyScale\?: number;/, '视图字段');
});
