/**
 * 磁电菇（68016）新设定技能（2026-11-11）：
 *
 *   101603 五雷轰顶 —— 行为键 `bolt_strike`（新车道）
 *   101604 磁电冲击 —— 行为键 `self_aura`（新增「累计普攻」触发口径）
 *   pvpStatus `numb` —— 新设定「麻痹」是**软控**（只禁攻击 + 移速 −50%）
 *
 * 用户 2026-11-11 拍板的四条口径，每一条都在下面钉住：
 *  1. 「160%/200%/250%」**每道雷独立计** ⇒ 三档总伤 480% / 800% / 1250%；
 *  2. 磁电冲击 = **累计 8 次普攻 / 持续 3 秒 / 每波最多 5 人**；
 *  3. 麻痹**新建软控状态**，不动硬控 `paralysis`；
 *  4. 交付范围 = 文档 + 配表 + 代码。
 *
 * 「软控」与硬控的差别是本文件最容易回归的点：硬控在 `ZCUnitSystem.updateUnit`
 * 最前置闸门整段 return（连移动都停），软控只在 `startAttack` / 起冲处挡「这一拳」。
 */

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { loadViews } from './helpers/zcds-view-fixtures';
import { ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import type { ZCSnapshot, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import type { ZCSkillRuntimeDefinition } from '../assets/script/app/zcds/model/ZCSkillRuntime';
import { ZCStatusSystem } from '../assets/script/app/zcds/model/ZCStatusEffect';
import { ZCSkillTriggerSystem } from '../assets/script/app/zcds/model/systems/ZCSkillTriggerSystem';
import { ZCGroundZoneSystem, zcGroundZoneBroadRadius, zcGroundZoneReaches }
    from '../assets/script/app/zcds/model/systems/ZCGroundZoneSystem';
import { ZCUnitSystem } from '../assets/script/app/zcds/model/systems/ZCUnitSystem';
import { ZCAttackResolutionSystem } from '../assets/script/app/zcds/model/systems/ZCAttackResolutionSystem';
import { ZC_BOLT_EFFECT_PREFAB_PATH, ZC_BOLT_EFFECT_SECONDS, ZC_BOLT_NUMB_STATUS_ID, zcBoltStrikeEffectPath }
    from '../assets/script/app/zcds/model/ZCBoltStrikeFx';
import { ZC_SELF_AURA_EFFECT_PREFAB_PATH, zcSelfAuraEffectPath }
    from '../assets/script/app/zcds/model/ZCSelfAuraFx';
import { buildZCVisualResourcePlan } from '../assets/script/app/zcds/model/ZCVisualResourcePlan';


// ────────────────────────────────────────────── 夹具

const ROOT = join(__dirname, '..');

/** `assets/remoteRef/*.json` 是列存 `{k, v}`，转表产物是行数组 —— 两种都认。 */
function readTable(name: string): Array<Record<string, unknown>> {
    const packed = JSON.parse(readFileSync(join(ROOT, 'assets', 'remoteRef', `${name}.json`), 'utf8'));
    if (Array.isArray(packed)) return packed as Array<Record<string, unknown>>;
    const keys = packed.k as string[];
    return (packed.v as unknown[][]).map((row) => Object.fromEntries(keys.map((key, i) => [key, row[i]])));
}

function readClientTable(name: string): Array<Record<string, unknown>> {
    return JSON.parse(readFileSync(join(ROOT, '..', 'doc', '塔防数据配置', 'json', 'client', `${name}.json`), 'utf8'));
}

function unit(id: number, overrides: Partial<ZCUnitState> = {}): ZCUnitState {
    return {
        id, unitId: '68016', owner: 'player', cardId: '68016', tier: 1,
        sourceHexId: id, targetHexId: null, progress: 0,
        hp: 500, maxHp: 500, battleState: 'idle', stateTime: 0,
        targetUnitId: null, targetWallHexId: null, targetBuildingHexId: null,
        nextAttackAt: 0, waitUntil: 0, attackHitDone: false,
        hatredUnitId: null, hatredUntil: 0, facingRadians: 0, deathRemoveAt: 0,
        marchAngle: null, freeX: 0, freeY: 0, completedAttackCount: 0,
        ...overrides,
    } as ZCUnitState;
}

function snapshot(units: ZCUnitState[], elapsedSeconds = 0): ZCSnapshot {
    return {
        version: 4, elapsedSeconds, nextCombatEventId: 1,
        units, projectiles: [], groundZones: [], combatEvents: [], hexes: {},
        statusEffects: { nextUid: 1, units: [] },
    } as unknown as ZCSnapshot;
}

function runtime(parameters: Record<string, number>, behaviorKey = 'bolt_strike'): ZCSkillRuntimeDefinition {
    return {
        unitId: '68016', skillId: 30231, behaviorKey, trigger: 'every_seconds',
        stateMode: 'none', parameters,
    } as unknown as ZCSkillRuntimeDefinition;
}

/** 表里的真值（与 `patch_magdi_mushroom.js` 同一份）。 */
const BOLT_PARAMS = {
    boltCooldown: 12, boltCount: 3, boltSpacing: 60, boltInterval: 0.15, boltDelay: 0.15,
    boltDamageRate: 1.6, boltRadius: 90, boltNumbChance: 0.3, boltNumbSeconds: 3,
};
const SHOCK_PARAMS = {
    auraEvery: 8, auraSeconds: 3, auraInterval: 1, auraRadius: 160, auraRectHalfHeight: 54,
    auraDamageRate: 2.5, auraForward: 160, auraFollow: 1, auraFaceTarget: 1,
    auraWaveMaxTargets: 5, auraVisualLiftPx: 30,
};

// ────────────────────────────────────────────── 一、配表守卫

test('pvpStatus：新增软控 numb，只禁攻击 + 移速 −50%，不挂任何硬控', () => {
    for (const rows of [readTable('pvpStatus'), readClientTable('pvpStatus')]) {
        const row = rows.find((item) => item.statusId === ZC_BOLT_NUMB_STATUS_ID);
        assert.ok(row, '缺 pvpStatus.numb');
        assert.equal(Number(row.enabled), 1);
        //  control 必须是空：填 stun/freeze/paralysis/blind 里任何一个都会变成硬控
        assert.equal(row.control ?? null, null, 'numb 不能是硬控，否则连移动都会停');
        const mods = JSON.parse(String(row.statJson));
        assert.equal(mods.moveSpeedPct, -50);
        assert.equal(mods.attackDisabled, 1);
        assert.equal(Number(row.durationSeconds), 3);
        assert.equal(row.handlerKey, 'none');
    }
});

test('pvpSkillPlan：两条技能的 6 行都在，参数与设计案逐格对齐', () => {
    const rows = readTable('pvpSkillPlan').filter((row) => String(row.unitId) === '68016');
    const bolt = rows.filter((row) => Number(row.skillChainId) === 101603).sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
    const shock = rows.filter((row) => Number(row.skillChainId) === 101604).sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
    assert.equal(bolt.length, 3);
    assert.equal(shock.length, 3);

    //  解锁等级以 K 表为唯一真源
    assert.deepEqual(bolt.map((row) => Number(row.unlockHeroLevel)), [9, 18, 24]);
    assert.deepEqual(shock.map((row) => Number(row.unlockHeroLevel)), [0, 20, 25]);

    for (const row of [...bolt, ...shock]) {
        assert.equal(row.behaviorKey, row.skillChainId === 101603 ? 'bolt_strike' : 'self_aura');
        assert.equal(Number(row.pvpSkillId), 30231, '必须等于 pvpCard.68016.unitSkillId');
        assert.equal(row.skillKind, 'active_cd');
        assert.equal(Number(row.enabled), 1);
    }

    //  「每道独立计」⇒ 三档 160/200/250，道数 3/4/5，两者都不许合并成一个总倍率
    assert.deepEqual(bolt.map((row) => JSON.parse(String(row.skillParamJson)).boltCount), [3, 4, 5]);
    assert.deepEqual(bolt.map((row) => JSON.parse(String(row.skillParamJson)).boltDamageRate), [1.6, 2, 2.5]);
    for (const row of bolt) {
        const params = JSON.parse(String(row.skillParamJson));
        assert.equal(params.boltCooldown, 12);
        assert.equal(params.boltSpacing, 60, '每道间隔 45 → 60（再 +15px，屏上 46.1px 才看得出排开）');
        assert.equal(params.boltInterval, 0.15, '逐道出现间隔 0.18 → 0.15s');
        assert.equal(params.boltDelay, 0.15, '判伤锚点（特效第 5 帧）与逐道间隔是两件事，不跟着改');
        assert.equal(params.boltNumbChance, 0.3, '每道雷各自 30%');
        assert.equal(params.boltNumbSeconds, 3);
    }

    //  磁电冲击：8 次 / 3 秒 / 每秒 1 波 / 每波 5 人 / **跟随本体、固定在身前**
    for (const row of shock) {
        const params = JSON.parse(String(row.skillParamJson));
        assert.equal(params.auraEvery, 8);
        assert.equal(params.auraSeconds, 3);
        assert.equal(params.auraInterval, 1);
        assert.equal(params.auraWaveMaxTargets, 5);
        assert.equal(params.auraForward, params.auraRadius,
            '出生点前移到半个身位：光束的起点落在角色中心、终点朝目标');
        assert.equal(params.auraFaceTarget, 1, '朝当前目标，不固定朝右');
        assert.equal(params.auraVisualLiftPx, 30, '抬到角色身体中心（屏上 px）');
        assert.equal(params.auraFollow, 1,
            '2026-11-12 由 0 改 1：光束跟随角色移动、固定在角色身前（原站桩，人一走就错位）');
    }
    assert.deepEqual(shock.map((row) => JSON.parse(String(row.skillParamJson)).auraDamageRate), [2.5, 3, 3.5]);
});

test('pvpSkillPlan：两份产物（remoteRef 列存 / 转表行数组）逐格一致', () => {
    const pick = (rows: Array<Record<string, unknown>>) => rows
        .filter((row) => String(row.unitId) === '68016' && [101603, 101604].includes(Number(row.skillChainId)));
    const packed = pick(readTable('pvpSkillPlan'));
    const client = pick(readClientTable('pvpSkillPlan'));
    const key = (row: Record<string, unknown>) => `${row.skillChainId}:${row.skillLevel}`;
    assert.equal(packed.length, 6);
    assert.equal(client.length, 6);
    const clientByKey = new Map(client.map((row) => [key(row), row]));
    for (const row of packed) {
        const twin = clientByKey.get(key(row));
        assert.ok(twin, `转表产物缺 ${key(row)}`);
        for (const field of ['modifierId', 'skillName', 'unlockHeroLevel', 'behaviorKey', 'skillParamJson']) {
            assert.deepEqual(twin![field] ?? null, row[field] ?? null, `${key(row)}.${field} 两份产物不一致`);
        }
    }
});

test('K 表转表产物：101603 / 101604 六行的名字与修改器指针都落地了', () => {
    const rows = readTable('armySkillLevelUp').filter((row) => [101603, 101604].includes(Number(row.id)));
    assert.equal(rows.length, 6);
    for (const row of rows) {
        assert.equal(row.name, Number(row.id) === 101603 ? '五雷轰顶' : '磁电冲击');
        assert.ok(String(row.desc).length > 10, `${row.id} L${row.skilllevel} 描述为空`);
        const expected = 94016000 + (Number(row.id) === 101603 ? 30 : 40) + Number(row.skilllevel);
        assert.deepEqual(row.modfiy, [expected]);
    }
});

// ────────────────────────────────────────────── 二、bolt_strike 注册

test('bolt_strike 必须双登记（行为白名单 + 运行时注册表），否则整条技能静默不跑', () => {
    //  两处都是模块内私有量，读源码就是最贴近「校验器 / 运行时真的认得它」的断言方式：
    //  漏了白名单 ⇒ 读表阶段就抛「未注册 behaviorKey」；漏了注册表 ⇒ 行为键能进来、
    //  参数却永远进不了 `runtime.parameters`（表现是「技能存在但永远不触发」）。
    const schemaSource = readFileSync(
        join(ROOT, 'assets', 'script', 'app', 'zcds', 'model', 'ZCStatSchema.ts'), 'utf8');
    assert.match(schemaSource, /SKILL_BEHAVIORS = new Set\(\[[\s\S]*?'bolt_strike'[\s\S]*?\]\)/,
        'ZCStatSchema.SKILL_BEHAVIORS 缺 bolt_strike');
    const runtimeSource = readFileSync(
        join(ROOT, 'assets', 'script', 'app', 'zcds', 'model', 'ZCSkillRuntime.ts'), 'utf8');
    assert.match(runtimeSource, /register\('bolt_strike'/,
        'ZCSkillRuntime 没注册 bolt_strike ⇒ 参数永远进不了运行时');
    assert.equal(zcBoltStrikeEffectPath('bolt_strike'), ZC_BOLT_EFFECT_PREFAB_PATH);
    assert.equal(zcBoltStrikeEffectPath('self_aura'), null);
});

// ────────────────────────────────────────────── 三、五雷轰顶：每道独立结算

/** 只够跑 `castBoltLine` 的最小上下文（照 `tests/zcds-yedan-skills.test.ts` 的 fanContext 收窄）。 */
function boltContext(caster: ZCUnitState, target: { id: number; x: number; y: number }, params: Record<string, number>) {
    const definition = {
        unitId: '68016', name: '磁电菇', maxHp: 600, attack: 30, moveSpeed: 40,
        attackRange: 70, attackInterval: 1.8, attackDuration: 0.5, attackHitTime: 0.2,
        bodyRadius: 26, spawnSeconds: 0, flying: false, canAttackAir: false, hero: true,
        prefabPath: 'units/units/磁电菇', prefabSize: 1,
        attackProfile: { skillId: 30231, name: '磁电菇普攻', mode: 'projectile' },
    };
    return {
        rules: { combatDistanceScale: 0.3, combatDamageMultiplier: 1, unitAttackPerTier: 0.16, counterDamageMultiplier: 1.3 },
        counters: [],
        cards: { [ZCOwner.Player]: new Map(), [ZCOwner.Enemy]: new Map() },
        deckBonuses: {
            [ZCOwner.Player]: {
                activeBonds: [], unitHpMultiplier: 1, unitAttackMultiplier: 1, moveSpeedMultiplier: 1,
                towerAttackMultiplier: 1, incomeBonus: 0, spawnIntervalMultiplier: 1,
            },
            [ZCOwner.Enemy]: {
                activeBonds: [], unitHpMultiplier: 1, unitAttackMultiplier: 1, moveSpeedMultiplier: 1,
                towerAttackMultiplier: 1, incomeBonus: 0, spawnIntervalMultiplier: 1,
            },
        },
        statPatches: { [ZCOwner.Player]: new Map([['68016', {}]]), [ZCOwner.Enemy]: new Map() },
        skillRuntime: {
            [ZCOwner.Player]: new Map([['68016:30231', { parameters: params }]]),
            [ZCOwner.Enemy]: new Map(),
        },
        unitById: new Map([[caster.id, caster]]),
        statusSystem: { statModsOf: () => ({}), controlOf: () => null },
        geometry: { hexIdAt: () => 0 },
        random: () => 1,
        effectiveDefinition: () => definition,
        unitPosition: (item: ZCUnitState) => ({ x: item.freeX, y: item.freeY }),
        currentTarget: () => ({ kind: 'unit', id: target.id, x: target.x, y: target.y, bodyRadius: 24, cardId: '68001' }),
        evaluateLegacySkill: () => ({ buffs: [], hitCount: 0, hasDamageFormula: false }),
        applyLegacySelfBuffs: () => [],
        damageUnit: () => null,
        tryExecuteUnit: () => undefined,
        applyHitStatus: () => undefined,
        applyLegacyBuffs: () => undefined,
        damageWall: () => undefined,
        damageBuilding: () => undefined,
        unitsInRadius: () => [],
        healUnit: () => {},
    } as unknown as Parameters<typeof ZCAttackResolutionSystem.castBoltLine>[2];
}

test('五雷轰顶：3 道雷各落一条事件 + 一个区域，沿「目标 → 背朝向」每道错开 60px', () => {
    const caster = unit(1, { freeX: 0, freeY: 0 });
    const state = snapshot([caster]);
    const context = boltContext(caster, { id: 9, x: 60, y: 0 }, BOLT_PARAMS);
    assert.equal(ZCAttackResolutionSystem.castBoltLine(state, caster, context), true);

    assert.equal(state.combatEvents.length, 3, '3 道雷 ⇒ 3 条表现事件');
    assert.equal(state.groundZones.length, 3, '3 道雷 ⇒ 3 个独立判伤区域');

    //  间距 60（表值）× combatDistanceScale 0.3 = 18 世界 px，沿 +x（目标在正前方）
    //  ⇒ 屏上 60 × 0.76875 = 46.1px（一道雷特效本身 193px 宽，间距再小就完全叠住、看不出排开）
    assert.deepEqual(state.groundZones.map((zone) => Math.round(zone.x * 100) / 100), [60, 78, 96]);
    for (const zone of state.groundZones) assert.equal(zone.y, 0);
    //  半径 90（表值）× 0.3 = 27
    for (const zone of state.groundZones) assert.equal(Math.round(zone.radius * 100) / 100, 27);
    //  每道只结算一次（wavesLeft = 1），判伤时刻 = 0.15 / 0.30 / 0.45（逐道间隔 0.15s）
    assert.deepEqual(state.groundZones.map((zone) => zone.wavesLeft), [1, 1, 1]);
    assert.deepEqual(
        state.groundZones.map((zone) => Math.round(zone.nextWaveAt * 100) / 100), [0.15, 0.3, 0.45]);
    //  出现时刻同样逐道错开：0 / 0.15 / 0.30（事件 `startedAt`），否则五道雷同帧亮起
    assert.deepEqual(
        state.combatEvents.map((event) => Math.round(event.startedAt * 100) / 100), [0, 0.15, 0.3]);
    //  每道独立 30% 麻痹
    for (const zone of state.groundZones) {
        assert.equal(zone.hitStatusId, 'numb');
        assert.equal(zone.hitStatusChance, 0.3);
        assert.equal(zone.hitStatusSeconds, 3);
    }
    //  每道都是 160% × 面板 30 = 48（不是 3 道分 48）
    assert.deepEqual(state.combatEvents.map((event) => event.damage), [48, 48, 48]);
});

test('五雷轰顶：L3 是 5 道 × 250%，总伤 5 倍而不是摊薄', () => {
    const caster = unit(1, { freeX: 0, freeY: 0 });
    const state = snapshot([caster]);
    const context = boltContext(caster, { id: 9, x: 60, y: 0 },
        { ...BOLT_PARAMS, boltCount: 5, boltDamageRate: 2.5 });
    ZCAttackResolutionSystem.castBoltLine(state, caster, context);
    assert.equal(state.groundZones.length, 5);
    //  30 × 2.5 = 75 每道 ⇒ 5 道共 375
    assert.equal(state.combatEvents.reduce((sum, event) => sum + event.damage, 0), 375);
});

test('五雷轰顶：没有锁定目标 ⇒ 不放雷、不消费 CD', () => {
    const caster = unit(1);
    const state = snapshot([caster]);
    const context = boltContext(caster, { id: 9, x: 60, y: 0 }, BOLT_PARAMS);
    (context as unknown as { currentTarget: () => unknown }).currentTarget = () => null;
    assert.equal(ZCAttackResolutionSystem.castBoltLine(state, caster, context), false);
    assert.equal(state.groundZones.length, 0);
    assert.equal(state.combatEvents.length, 0);
});

test('五雷轰顶：参数不全（缺 boltCount / 倍率 / 半径）⇒ 返回 false，调用方不消费 CD', () => {
    const caster = unit(1);
    const state = snapshot([caster]);
    const context = boltContext(caster, { id: 9, x: 60, y: 0 }, { boltCooldown: 12 });
    assert.equal(ZCAttackResolutionSystem.castBoltLine(state, caster, context), false);
});

// ────────────────────────────────────────────── 三·五、逐道出现（观感，2026-11-12 第三次反馈）

/**
 * 用户 2026-11-12：「五雷轰顶的技能还是没有按照先后出现，视觉感官是同时出现的」。
 *
 * 参数（`boltSpacing` 60 / `boltInterval` 0.15）第二轮就改完了，判伤（`nextWaveAt`）也一直
 * 是错开的 —— 错的是**表现**：五条 `area` 事件是**同一拍**推进 `combatEvents` 的，只靠
 * `startedAt`（未来时刻）排先后，而渲染世界原来「看到事件就建节点」：
 * `acquire → initialize → mountVisual` 会立刻 `animation.play(默认 clip)`，`ZCCombatEffectView.render`
 * 又把负进度钳成 0 ⇒ 五道雷**同一帧全部亮起、动画同拍**。
 *
 * 所以这里钉三层：① 模型 `startedAt` 逐道递增；② 「到点没」只有一个判据
 * （`zcCombatEffectEntered`）；③ 视图建节点前必须先过这块闸。
 */
test('五雷轰顶：逐道 0.15s 出现 —— 任意一拍上「已到点」的道数逐道 +1，不会一起亮', () => {
    const { load } = loadViews();
    const entered = load('./ZCGameViewUtil').zcCombatEffectEntered as (startedAt: number, now: number) => boolean;
    //  判据本身：等于 `startedAt <= now`（写成 `<` 会让出手那一拍的第一道消失一帧）
    assert.equal(entered(0.15, 0.14), false);
    assert.equal(entered(0.15, 0.15), true);
    assert.equal(entered(0, 0), true);

    const caster = unit(1, { freeX: 0, freeY: 0 });
    const state = snapshot([caster]);
    ZCAttackResolutionSystem.castBoltLine(state, caster, boltContext(caster, { id: 9, x: 60, y: 0 },
        { ...BOLT_PARAMS, boltCount: 5, boltDamageRate: 2.5 }));

    const visibleAt = (now: number) => state.combatEvents.filter((event) => entered(event.startedAt, now)).length;
    assert.deepEqual(
        [0, 0.14, 0.15, 0.3, 0.45, 0.6, 0.75].map(visibleAt),
        [1, 1, 2, 3, 4, 5, 5],
        '5 道雷必须是 0 / 0.15 / 0.30 / 0.45 / 0.60 逐道亮起');
    //  全部到点只花 0.6s，短于单道特效自身时长（0.667s）⇒ 观感是「一道接一道砸下来」，
    //  而不是「一波齐射」—— 这也是 0.15s 这个间隔能被看见的前提。
    assert.ok(0.6 < ZC_BOLT_EFFECT_SECONDS);
});

test('五雷轰顶：渲染世界对「还没到点」的事件不建节点（节点一建动画就从第 0 帧起播）', () => {
    const source = readFileSync(join(ROOT, 'assets', 'script', 'app', 'zcds', 'view', 'ZCGameRenderWorld.ts'), 'utf8');
    const body = source.slice(
        source.indexOf('private renderEffectSystem('),
        source.indexOf('private resolveMissingEffectArt('),
    );
    assert.ok(body.length > 0, 'renderEffectSystem 必须还在（这条用例靠它定位）');
    const gate = body.indexOf('!zcCombatEffectEntered(event.startedAt, now)');
    const acquire = body.indexOf('this.pool.acquire(');
    assert.ok(gate >= 0, '表现事件先过 `zcCombatEffectEntered` 闸');
    assert.ok(acquire > gate, '闸门必须拦在 `pool.acquire` 之前 —— 建了节点动画就已经在播了');
    assert.match(body, /!zcCombatEffectEntered\(projectile\.startedAt, now\)/,
        '延迟出发的弹道同理，到点前不许先占一个弹头');
});

// ────────────────────────────────────────────── 四、触发范围闸门（五雷轰顶）

interface IBoltHarness {
    readonly casts: number[];
    setGate(value: boolean): void;
    readonly value: Parameters<typeof ZCSkillTriggerSystem.tick>[2];
    readonly unit: ZCUnitState;
}

function boltHarness(params: Record<string, number> = BOLT_PARAMS, gate = true): IBoltHarness {
    const statusSystem = new ZCStatusSystem();
    const caster = unit(1);
    const rt = runtime(params);
    const casts: number[] = [];
    let inside = gate;
    const value = {
        statusSystem,
        runtimeOf: (target: ZCUnitState) => (target.owner === 'player' ? rt : undefined),
        fireBurst: () => {},
        castSecondary: () => true,
        castBolt: (target: ZCUnitState) => { casts.push(target.id); return true; },
        distanceScale: 0.3,
        inAttackRange: () => inside,
        attackReachOf: () => 148.5,
    } as unknown as Parameters<typeof ZCSkillTriggerSystem.tick>[2];
    return { casts, setGate: (next: boolean) => { inside = next; }, value, unit: caster };
}

test('五雷轰顶：首次只挂冷却；到点但普攻范围内没人 ⇒ 待触发，CD 不消费', () => {
    const harness = boltHarness(BOLT_PARAMS, false);
    const state = snapshot([harness.unit]);

    ZCSkillTriggerSystem.tick(state, 0.05, harness.value);
    assert.equal(harness.unit.boltReadyAt, 12, '首次 = 当前 + CD，开局不立刻放');
    assert.deepEqual(harness.casts, []);

    state.elapsedSeconds = 12.5;
    ZCSkillTriggerSystem.tick(state, 0.05, harness.value);
    assert.deepEqual(harness.casts, [], '范围里没人 ⇒ 一道雷都不许落');
    assert.equal(harness.unit.boltReadyAt, 12, '待触发期间 CD 保持就绪（不许被消费）');

    //  目标进范围的那一帧立刻补放
    harness.setGate(true);
    ZCSkillTriggerSystem.tick(state, 0.05, harness.value);
    assert.deepEqual(harness.casts, [1]);
    assert.equal(harness.unit.boltReadyAt, 24.5, '放出去之后 CD 才推进到 now + 12');
});

test('五雷轰顶：放雷被拒（参数不全 / 无目标）⇒ 不消费 CD，下帧重试', () => {
    const statusSystem = new ZCStatusSystem();
    const caster = unit(1);
    const state = snapshot([caster]);
    let accept = false;
    let attempts = 0;
    const value = {
        statusSystem,
        runtimeOf: () => runtime(BOLT_PARAMS),
        fireBurst: () => {},
        castSecondary: () => true,
        castBolt: () => { attempts += 1; return accept; },
        distanceScale: 0.3,
        inAttackRange: () => true,
    } as unknown as Parameters<typeof ZCSkillTriggerSystem.tick>[2];
    ZCSkillTriggerSystem.tick(state, 0.05, value);
    state.elapsedSeconds = 20;
    ZCSkillTriggerSystem.tick(state, 0.05, value);
    assert.equal(attempts, 1);
    assert.equal(caster.boltReadyAt, 12, '被拒 ⇒ CD 不动');
    accept = true;
    ZCSkillTriggerSystem.tick(state, 0.05, value);
    assert.equal(attempts, 2);
    assert.equal(caster.boltReadyAt, 32);
});

// ────────────────────────────────────────────── 五、磁电冲击：累计 8 次普攻触发

test('磁电冲击：累计 8 次普攻才放，第 7 次不放；首次只记下当前计数', () => {
    const statusSystem = new ZCStatusSystem();
    const caster = unit(1, { completedAttackCount: 3 });
    const state = snapshot([caster]);
    const casts: number[] = [];
    const value = {
        statusSystem,
        runtimeOf: () => runtime(SHOCK_PARAMS, 'self_aura'),
        fireBurst: () => {},
        castSecondary: () => true,
        castSelfAura: (target: ZCUnitState) => { casts.push(target.completedAttackCount ?? 0); return true; },
        distanceScale: 0.3,
        inAttackRange: () => true,
    } as unknown as Parameters<typeof ZCSkillTriggerSystem.tick>[2];

    ZCSkillTriggerSystem.tick(state, 0.05, value);
    assert.deepEqual(casts, [], '第一次只记下 completedAttackCount = 3');
    assert.equal(caster.auraFiredCount, 3);

    caster.completedAttackCount = 10;   // 多打了 7 次
    ZCSkillTriggerSystem.tick(state, 0.05, value);
    assert.deepEqual(casts, [], '7 < 8，不放');

    caster.completedAttackCount = 11;   // 多打了 8 次
    ZCSkillTriggerSystem.tick(state, 0.05, value);
    assert.deepEqual(casts, [11]);
    assert.equal(caster.auraFiredCount, 11);
});

test('磁电冲击：次数够了但普攻范围内没人 ⇒ 待触发，不推进 auraFiredCount', () => {
    const statusSystem = new ZCStatusSystem();
    const caster = unit(1, { completedAttackCount: 0 });
    const state = snapshot([caster]);
    const casts: number[] = [];
    let inside = false;
    const value = {
        statusSystem,
        runtimeOf: () => runtime(SHOCK_PARAMS, 'self_aura'),
        fireBurst: () => {},
        castSecondary: () => true,
        castSelfAura: () => { casts.push(1); return true; },
        distanceScale: 0.3,
        inAttackRange: () => inside,
    } as unknown as Parameters<typeof ZCSkillTriggerSystem.tick>[2];

    ZCSkillTriggerSystem.tick(state, 0.05, value);   // 初始化计数 = 0
    caster.completedAttackCount = 8;
    ZCSkillTriggerSystem.tick(state, 0.05, value);
    assert.deepEqual(casts, []);
    //  ⚠️ 关键：次数不能被「吃掉」，否则目标一进范围还得再打 8 下
    assert.equal(caster.auraFiredCount, 0);

    inside = true;
    ZCSkillTriggerSystem.tick(state, 0.05, value);
    assert.deepEqual(casts, [1], '目标进范围那一帧立刻补放');
    assert.equal(caster.auraFiredCount, 8);
});

test('磁电冲击：auraEvery 与 auraCooldown 二选一，都没有才整段不执行', () => {
    const statusSystem = new ZCStatusSystem();
    const caster = unit(1);
    const state = snapshot([caster]);
    let calls = 0;
    const value = {
        statusSystem,
        runtimeOf: () => runtime({ auraSeconds: 3, auraRadius: 160, auraDamageRate: 2.5 }, 'self_aura'),
        fireBurst: () => {},
        castSecondary: () => true,
        castSelfAura: () => { calls += 1; return true; },
        distanceScale: 0.3,
        inAttackRange: () => true,
    } as unknown as Parameters<typeof ZCSkillTriggerSystem.tick>[2];
    for (let i = 0; i < 5; i += 1) {
        caster.completedAttackCount = i * 10;
        state.elapsedSeconds = i * 10;
        ZCSkillTriggerSystem.tick(state, 0.05, value);
    }
    assert.equal(calls, 0, '既没 auraCooldown 也没 auraEvery ⇒ 一条都不放');
});

// ────────────────────────────────────────────── 六、区域：每波 5 人上限 + 逐目标掷骰

test('磁电冲击：一屏 8 个敌人时每波只打 5 个；3 秒 3 波', () => {
    const targets = Array.from({ length: 8 }, (_, index) => ({
        id: index + 2, owner: 'enemy', hp: 999, battleState: 'idle',
        freeX: 0, freeY: 0,
    } as unknown as ZCUnitState));
    for (const target of targets) target.hp = 999;
    const zone = {
        x: 0, y: 0, radius: 40, owner: 'player', sourceUnitId: 1,
        skillId: 30231, skillName: '磁电菇普攻', remainingSeconds: 3,
        wavesLeft: 3, nextWaveAt: 0, waveInterval: 1,
        damage: 75, slowRatio: 0, waveMaxTargets: 5, statusChanged: false,
    };
    const state = {
        elapsedSeconds: 0, groundZones: [zone], combatEvents: [], nextCombatEventId: 1,
    } as unknown as ZCSnapshot;
    const context = {
        hexIdAt: () => 0,
        unitsInRadius: () => targets,
        unitPosition: () => ({ x: 0, y: 0 }),
        damageUnit: (target: ZCUnitState, damage: number) => { target.hp -= damage; return null; },
        ensureSlowStatus: () => {},
        applyStatus: () => {},
        exportStatusEffects: () => undefined,
        hexStep: 1,
        random: () => 0.99,
    } as unknown as Parameters<typeof ZCGroundZoneSystem.tick>[2];

    ZCGroundZoneSystem.tick(state, 0.05, context);
    const hitFirstWave = targets.filter((target) => target.hp < 999);
    assert.equal(hitFirstWave.length, 5, '第一波只该打 5 个');
    for (const target of hitFirstWave) assert.equal(target.hp, 999 - 75);
    assert.equal(zone.wavesLeft, 2);
});

test('磁电冲击：每波每个目标各自掷 30% 麻痹，掷中就挂 numb', () => {
    const targets = [0, 1].map((index) => ({
        id: index + 2, owner: 'enemy', hp: 999, battleState: 'idle',
    } as unknown as ZCUnitState));
    const zone = {
        x: 0, y: 0, radius: 40, owner: 'player', sourceUnitId: 1,
        skillId: 30231, skillName: '磁电菇普攻', remainingSeconds: 3,
        wavesLeft: 1, nextWaveAt: 0, waveInterval: 1,
        damage: 75, slowRatio: 0, hitStatusId: 'numb', hitStatusChance: 0.3, hitStatusSeconds: 3,
    };
    const state = { elapsedSeconds: 0, groundZones: [zone], combatEvents: [], nextCombatEventId: 1 } as unknown as ZCSnapshot;
    //  第一个目标掷出 0.1（< 0.3 命中），第二个掷出 0.9（不命中）
    const rolls = [0.1, 0.9];
    let cursor = 0;
    const applied: { id: string; statusId: string }[] = [];
    const context = {
        hexIdAt: () => 0,
        unitsInRadius: () => targets,
        unitPosition: () => ({ x: 0, y: 0 }),
        damageUnit: () => null,
        ensureSlowStatus: () => {},
        applyStatus: (target: ZCUnitState, statusId: string) => { applied.push({ id: String(target.id), statusId }); },
        exportStatusEffects: () => ({ nextUid: 1, units: [] }),
        hexStep: 1,
        random: () => rolls[cursor++] ?? 0.99,
    } as unknown as Parameters<typeof ZCGroundZoneSystem.tick>[2];

    ZCGroundZoneSystem.tick(state, 0.05, context);
    assert.deepEqual(applied, [{ id: '2', statusId: 'numb' }]);
    assert.deepEqual(state.statusEffects, { nextUid: 1, units: [] }, '挂过状态就要回写 statusEffects');
});

// ────────────────────────────────────────────── 七、软控：只挡普攻，不冻移动

test('软控 numb：attackBlockedOf 为真；硬控闸门照旧只认 control 字段', () => {
    const statusSystem = new ZCStatusSystem();
    statusSystem.register({
        id: 'numb', name: '麻痹', durationSeconds: 3, maxStacks: 1, refreshPolicy: 'refresh',
        statMods: { moveSpeedPct: -50, attackDisabled: 1 }, behavior: { kind: 'none' },
    });
    statusSystem.apply('7', 'numb', { at: 0 });
    assert.equal(statusSystem.attackBlockedOf('7'), true);
    assert.equal(statusSystem.controlOf('7'), null, '软控不是硬控：controlOf 必须仍然返回 null');
    assert.equal(statusSystem.statModsOf('7').moveSpeedPct, -50);
    assert.equal(statusSystem.attackBlockedOf('8'), false, '没挂状态的人是自由的');
});

test('软控 numb：被麻痹的单位不进入 attack，但移动分支照常推进', () => {
    const target = unit(2, { owner: 'enemy' });
    const caster = unit(1, { battleState: 'idle', nextAttackAt: 0 });
    const moved: number[] = [];
    const sent: number[] = [];
    let blocked = true;
    const context = {
        now: () => 1,
        controlOf: () => null,
        attackBlockedOf: () => blocked,
        unitById: new Map([[caster.id, caster], [target.id, target]]),
        targeting: {
            current: () => ({ kind: 'unit', id: 2, x: 0, y: 0, bodyRadius: 24, cardId: '68001' }),
            acquire: () => {},
            isInAttackRange: () => true,
            isOutOfAttackRange: () => false,
            face: () => {},
            refreshPriorityTarget: () => false,
        },
        movement: {
            advanceTowardUnit: () => { moved.push(1); },
            advanceUnitMovement: () => { moved.push(1); },
            startMarch: () => {},
            advanceMarch: () => {},
        },
        sendAttack: (item: ZCUnitState) => { sent.push(item.id); },
        effectiveDefinition: () => ({
            unitId: '68016', maxHp: 600, attack: 30, moveSpeed: 40, attackRange: 70,
            attackInterval: 1.8, attackDuration: 0.5, attackHitTime: 0.2, bodyRadius: 26,
            spawnSeconds: 0, flying: false, canAttackAir: false, hero: true,
            prefabPath: 'units/units/磁电菇', prefabSize: 1,
            attackProfile: { skillId: 30231, name: '磁电菇普攻', mode: 'projectile' },
        }),
        random: () => 0.5,
    };

    ZCUnitSystem.update([caster], 0.05, context as never);
    assert.equal(caster.battleState, 'idle', '软控期间不许进入 attack 状态');
    assert.deepEqual(sent, []);

    blocked = false;
    ZCUnitSystem.update([caster], 0.05, context as never);
    assert.equal(caster.battleState, 'attack', '解控后立刻出拳');
});

// ── 六、两套特效预制体（2026-11-11：美术只丢了散图，预制体由脚本生成） ────────────
//
// 背景：`磁电菇_劈雷技能/`（20 张 png）与 `雷电冲击/`（18 张 png）原本**只有散帧**，
// 没有 prefab / anim / pac。在此之前两条技能只能借别人的预制体占位
// （`雷法师_武将闪电` / `持续光环伤害效果`）。生成器 = `tools/build_magdi_strike_fx.py`。
//
// 这一段钉住三件最容易静默失败的事：
//  ① 散图 meta 必须带 `f9941` sprite-frame 子资源 —— 默认导成 `type: texture` 时
//     只有 `@6c48a`，`cc.Sprite._spriteFrame` 引不到，**不报错、特效永远不出现**；
//  ② `wrapMode` 必须是设计案要的那个（落雷一次性 / 冲击波循环）；
//  ③ 「看着多大就打多大」：屏上尺寸要和配表的判定半径对得上。

const SCREEN_PX_PER_LOGIC_PX = 0.3 * 2.5625; // 0.76875，见 docs §1.11

function readJsonFile<T>(path: string): T {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function fxDir(name: string): string {
    return join(ROOT, 'assets', 'bundles', 'battle', 'units', 'projectiles', name);
}

interface IPrefabParts {
    readonly node: { _lpos: { x: number; y: number }; _lscale: { x: number } };
    readonly ui: { _contentSize: { width: number; height: number } };
    readonly sprite: { _sizeMode: number; _isTrimmedMode: boolean; _spriteFrame: { __uuid__: string } };
    readonly anim: { _clips: { __uuid__: string }[]; _defaultClip: { __uuid__: string }; playOnLoad: boolean };
}

function prefabParts(dir: string, name: string): IPrefabParts {
    const doc = readJsonFile<any[]>(join(dir, `${name}.prefab`));
    const pick = (type: string): any => {
        const found = doc.find((item) => item.__type__ === type);
        assert.ok(found, `${name}.prefab 缺 ${type}`);
        return found;
    };
    return {
        node: pick('cc.Node'),
        ui: pick('cc.UITransform'),
        sprite: pick('cc.Sprite'),
        anim: pick('cc.Animation'),
    };
}

interface IAnimParts {
    sample: number;
    wrapMode: number;
    _duration: number;
    _tracks: { _channel: { _curve: { _times: number[]; _values: { __uuid__: string }[] } } }[];
}

function animParts(dir: string, clip: string): IAnimParts {
    const clipPath = join(dir, 'anim', `${clip}.anim`);
    assert.ok(existsSync(clipPath), `缺动画：${clipPath}`);
    return readJsonFile<IAnimParts>(clipPath);
}

test('特效预制体：两套三件套都齐备，且预制体路径就是代码里写的那个', () => {
    for (const [name, clip] of [['磁电菇_劈雷技能', '磁电菇_劈雷技能'], ['雷电冲击', '雷电冲击-loop']] as const) {
        const dir = fxDir(name);
        for (const file of [`${name}.prefab`, `${name}.prefab.meta`, 'anim', 'atlas', 'atlas.meta', 'anim.meta']) {
            assert.ok(existsSync(join(dir, file)), `${name} 缺 ${file}`);
        }
        assert.ok(existsSync(join(dir, 'anim', `${clip}.anim`)), `${name} 缺动画 ${clip}.anim`);
        assert.ok(existsSync(join(dir, 'atlas', `${name}.pac`)), `${name} 缺自动图集 ${name}.pac`);
    }
    assert.equal(ZC_BOLT_EFFECT_PREFAB_PATH, 'units/projectiles/磁电菇_劈雷技能/磁电菇_劈雷技能',
        '落雷路径必须指向真美术，不许再退回占位用的「雷法师_武将闪电」');
    assert.equal(zcSelfAuraEffectPath('self_aura', '68016'), 'units/projectiles/雷电冲击/雷电冲击',
        '磁电冲击的造型按单位覆盖到「雷电冲击」');
});

test('落雷预制体：屏上地面爆闪直径 ≈ boltRadius 换算出来的 138.4px', () => {
    const dir = fxDir('磁电菇_劈雷技能');
    const parts = prefabParts(dir, '磁电菇_劈雷技能');
    assert.equal(parts.ui._contentSize.width, 237, '画布宽（源 1019 裁到 474 再缩一半）');
    assert.equal(parts.ui._contentSize.height, 283);
    assert.equal(parts.sprite._sizeMode, 0, 'CUSTOM + 固定画布，逐帧换图不跟着新图变形');
    assert.equal(parts.sprite._isTrimmedMode, false);
    assert.equal(parts.anim.playOnLoad, false, '播放由 ZCCombatEffectView 显式发起');

    //  接地点必须压在节点原点上：`_lpos.y` 是**向上**抬（Cocos +y 朝上），
    //  符号反了就是「雷悬在地面上方半个画布」——最难一眼看出来的那种错。
    assert.ok(parts.node._lpos.y > 0, '地面接地点在画布中心下方，节点要往上抬');
    assert.equal(parts.node._lpos.x, 0);

    //  地面爆闪占画布 169.5px（2026-11-11 由生成器从 20 帧底部 12% 带量出来的最大值，
    //  裁切后 339/2）。改了美术或裁切窗口就要回来重标这个数。
    const GROUND_SPLASH_CANVAS_PX = 169.5;
    const onScreen = GROUND_SPLASH_CANVAS_PX * parts.node._lscale.x;
    const target = 90 * 2 * SCREEN_PX_PER_LOGIC_PX; // boltRadius = 90（表值）
    assert.ok(Math.abs(onScreen - target) / target < 0.02,
        `屏上爆闪 ${onScreen.toFixed(1)}px 应贴近判定直径 ${target.toFixed(1)}px`);
});

test('落雷动画：20 帧 @ sample 30、一次性播放，总长与代码常量同步', () => {
    const dir = fxDir('磁电菇_劈雷技能');
    const clip = animParts(dir, '磁电菇_劈雷技能');
    const curve = clip._tracks[0]._channel._curve;
    assert.equal(curve._times.length, 20, '美术给了 20 张散帧，一帧都不许丢');
    assert.equal(curve._values.length, 20);
    assert.equal(clip.sample, 30, 'sample 必须是 30 —— 见下一条「第 5 帧判伤」');
    assert.equal(clip.wrapMode, 1, '1 = Normal，一次性，停在末帧（落雷不是循环光环）');
    assert.ok(Math.abs(clip._duration - ZC_BOLT_EFFECT_SECONDS) < 1e-6,
        `动画总长 ${clip._duration}s 必须等于 ZC_BOLT_EFFECT_SECONDS ${ZC_BOLT_EFFECT_SECONDS}s`
        + '（表现事件的 durationSeconds 要盖住整段，否则雷尾那几帧会被提前摘掉）');
});

test('「每道闪电的伤害判定在特效第 5 帧」：配表 boltDelay 必须落在第 5 帧的时间窗内', () => {
    //  设计案 101603 原文。第 5 帧 = 下标 4 ⇒ 时间窗 [4/sample, 5/sample)。
    //  sample 30 ⇒ [0.1333, 0.1667)，配表 boltDelay = 0.15 正落在中间。
    //  这条不成立时的症状：雷还没落地血就掉了（或反过来，落地半天才掉血）。
    const clip = animParts(fxDir('磁电菇_劈雷技能'), '磁电菇_劈雷技能');
    const plan = readTable('pvpSkillPlan')
        .find((row) => Number(row.skillChainId) === 101603 && Number(row.skillLevel) === 1);
    assert.ok(plan, '缺 101603 L1 行');
    const params = JSON.parse(String(plan.skillParamJson)) as { boltDelay: number };
    const frame = Math.floor(params.boltDelay * clip.sample);
    assert.equal(frame, 4, `boltDelay=${params.boltDelay}s × sample ${clip.sample} 应落在第 5 帧（下标 4）`);
});

test('雷电冲击预制体：取第 9~14 帧做 0.5s 循环，屏上长度 ≈ auraRadius 换算出来的 276.8px', () => {
    const dir = fxDir('雷电冲击');
    const parts = prefabParts(dir, '雷电冲击');
    assert.equal(parts.ui._contentSize.width, 489);
    assert.equal(parts.ui._contentSize.height, 144);
    assert.equal(parts.node._lpos.x, 0, '冲击波以判定圆心为中心左右铺开，不往一侧偏');
    assert.equal(parts.node._lpos.y, 0);

    //  内容并集宽 480.5 画布 px（源图 961 缩一半）。
    const CONTENT_CANVAS_PX = 480.5;
    const onScreen = CONTENT_CANVAS_PX * parts.node._lscale.x;
    const target = 180 * 2 * SCREEN_PX_PER_LOGIC_PX; // auraRadius = 180（L2 档）
    assert.ok(Math.abs(onScreen - target) / target < 0.02,
        `屏上长度 ${onScreen.toFixed(1)}px 应贴近 L2 判定直径 ${target.toFixed(1)}px`);

    const clip = animParts(dir, '雷电冲击-loop');
    const curve = clip._tracks[0]._channel._curve;
    assert.equal(curve._times.length, 6, '设计案：「使用 9~14 帧循环」= 6 帧');
    assert.equal(clip.sample, 12);
    assert.equal(clip.wrapMode, 2, '2 = Loop：3 秒持续里一直循环，不能播一次就定格');
    assert.ok(Math.abs(clip._duration - 0.5) < 1e-6, '6 帧 / sample 12 = 0.5s 一圈');
});

test('散图 meta 必须带 f9941 sprite-frame 子资源（缺了不报错、特效永远不出现）', () => {
    for (const [name, expected] of [['磁电菇_劈雷技能', 20], ['雷电冲击', 6]] as const) {
        const dir = fxDir(name);
        const metas = readdirSync(join(dir, 'atlas')).filter((entry) => entry.endsWith('.png.meta'));
        assert.equal(metas.length, expected, `${name} 图集应有 ${expected} 帧`);
        const frameUuids = new Set<string>();
        for (const entry of metas) {
            const meta = readJsonFile<any>(join(dir, 'atlas', entry));
            assert.ok(meta.subMetas?.['f9941'], `${name}/${entry} 缺 f9941（spriteFrame 子资源）`);
            assert.equal(meta.userData?.type, 'sprite-frame', `${name}/${entry} 还停在 type: texture`);
            const frame = meta.subMetas['f9941'].userData;
            assert.equal(frame.rawWidth, frame.width, `${name}/${entry} 必须整帧不裁剪（trimType none）`);
            assert.equal(frame.rawHeight, frame.height);
            frameUuids.add(`${meta.uuid}@f9941`);
        }
        //  prefab 的首帧与动画的每一帧都必须在这批 uuid 里，不能有悬空引用。
        const parts = prefabParts(dir, name);
        assert.ok(frameUuids.has(parts.sprite._spriteFrame.__uuid__), `${name} prefab 首帧 uuid 悬空`);
        const clip = animParts(dir, name === '磁电菇_劈雷技能' ? name : `${name}-loop`);
        for (const value of clip._tracks[0]._channel._curve._values) {
            assert.ok(frameUuids.has(value.__uuid__), `${name} 动画引用了不存在的帧 ${value.__uuid__}`);
        }
        assert.equal(parts.anim._defaultClip.__uuid__, parts.anim._clips[0].__uuid__);
    }
});

test('两套特效路径都能进本局加载清单，且不会串到别家的自身光环上', () => {
    //  与无尘禁土同一条坑：路径只登记在代码里，漏收 ⇒ `ZCGameLoader` 不加载
    //  ⇒ 技能照常结算、屏幕一次都不亮，且一条错都不报。
    const unit = (unitId: string) => ({
        unitId,
        prefabPath: `units/${unitId}/${unitId}`,
        attackProfile: { effectPrefabPath: `units/projectiles/${unitId}_普攻/${unitId}_普攻` },
    });
    const adapters = {
        skillPlans: [
            { enabled: true, unitId: '68016', behaviorKey: 'bolt_strike' },
            { enabled: true, unitId: '68016', behaviorKey: 'self_aura' },
            { enabled: true, unitId: '68025', behaviorKey: 'self_aura' },
        ],
        textOverrides: new Map(),
    };
    const plan = buildZCVisualResourcePlan(
        [unit('68016'), unit('68025')] as never, adapters as never);
    assert.ok(plan.effectPaths.includes('units/projectiles/磁电菇_劈雷技能/磁电菇_劈雷技能'),
        '五雷轰顶的落雷必须被加载');
    assert.ok(plan.effectPaths.includes('units/projectiles/雷电冲击/雷电冲击'),
        '磁电冲击的冲击波必须被加载');
    assert.ok(plan.effectPaths.includes(ZC_SELF_AURA_EFFECT_PREFAB_PATH),
        '大威天芦的「无尘禁土」仍走原来那根光柱，不能被磁电菇的造型覆盖');
    assert.equal(zcSelfAuraEffectPath('self_aura', '68025'), ZC_SELF_AURA_EFFECT_PREFAB_PATH);
    assert.equal(zcSelfAuraEffectPath('bolt_strike', '68016'), null, '不是自身光环就返回 null');
});

// ────────────────────────────────────────────── 八、判定形状：圆 → 长方形（2026-11-11 用户口径）

test('磁电冲击三档都改成长方形，且别的自身光环一个都没被带偏', () => {
    const rows = readTable('pvpSkillPlan');
    const shock = rows.filter((row) => Number(row.skillChainId) === 101604)
        .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
    assert.deepEqual(shock.map((row) => JSON.parse(String(row.skillParamJson)).auraRectHalfHeight), [54, 54, 54],
        '三档半宽都是 54 逻辑 px（⇒ 108 = 屏上 83px ≈ 雷电冲击美术高 82.4px）');
    //  半长没写 ⇒ 跟随 auraRadius（160 / 180 / 200），L2 的 360 正好等于美术宽 363。
    for (const row of shock) {
        assert.equal(JSON.parse(String(row.skillParamJson)).auraRectHalfLength, undefined,
            '半长要跟随 auraRadius，别在表里再写一份');
    }

    //  ⚠️ 2026-11-12 第八轮：喷射火焰 102603 也改成矩形了（用户口径「改矩形：加 auraRectHalfHeight，
    //  像磁电冲击 101604 那样做成从脚点到 350 的锥/矩形」，详见 docs §15.11）。
    //  所以这里只剩**无尘禁土 102503** 一个「必须仍是圆」的对照。
    const spray = rows.filter((row) => Number(row.skillChainId) === 102603);
    assert.equal(spray.length, 3);
    assert.deepEqual(spray.map((row) => JSON.parse(String(row.skillParamJson)).auraRectHalfHeight), [70, 70, 70],
        '喷射火焰三档半宽都是 70（宽 140），半长跟随 auraRadius 175 ⇒ 覆盖 0~350');

    const others = rows.filter((row) => String(row.unitId) !== '68016'
        && Number(row.skillChainId) !== 102603
        && row.behaviorKey === 'self_aura'
        && JSON.parse(String(row.skillParamJson)).auraRectHalfHeight !== undefined);
    assert.deepEqual(others.map((row) => row.skillChainId), [],
        '无尘禁土 102503 必须仍然是圆 —— 矩形是逐技能开的');
});

test('矩形判定：光束上下缘不再「看着没烧到却掉血」', () => {
    //  世界 px（= 表值 × combatDistanceScale 0.3）：L2 ⇒ 半长 54、半宽 16.2
    const zone = { x: 0, y: 0, radius: 54, rectHalfHeight: 16.2 };
    assert.equal(zcGroundZoneReaches(zone, 40, 10), true, '光束里：|dx|40≤54、|dy|10≤16.2');
    assert.equal(zcGroundZoneReaches(zone, 0, 40), false, '圆内矩形外（40 < 54 但 > 16.2）⇒ 不打');
    assert.equal(zcGroundZoneReaches(zone, 60, 0), false, '半长之外');
    assert.equal(zcGroundZoneReaches(zone, -53, -16), true, '矩形左右对称、上下对称');

    //  半长显式给了就用它；给了 0 则回落到 radius。
    assert.equal(zcGroundZoneReaches({ radius: 54, x: 0, y: 0, rectHalfLength: 80, rectHalfHeight: 16.2 }, 70, 0),
        true, '显式半长 80 比 radius 54 长');
    assert.equal(zcGroundZoneReaches({ radius: 54, x: 0, y: 0, rectHalfLength: 0, rectHalfHeight: 16.2 }, 60, 0),
        false, '半长 0 ⇒ 跟随 radius');

    //  没有 rectHalfHeight 的一切区域仍然是圆，行为逐字不变。
    assert.equal(zcGroundZoneReaches({ radius: 54, x: 0, y: 0 }, 0, 40), true);
    assert.equal(zcGroundZoneReaches({ radius: 54, x: 0, y: 0, rectHalfHeight: 0 }, 0, 40), true,
        'rectHalfHeight 为 0 等同没配');

    //  粗筛半径取外接圆，别把矩形长边漏在格子索引外面。
    assert.equal(zcGroundZoneBroadRadius({ radius: 54, x: 0, y: 0 }), 54);
    assert.ok(Math.abs(zcGroundZoneBroadRadius({ radius: 54, x: 0, y: 0, rectHalfHeight: 16.2 }) - Math.hypot(54, 16.2)) < 1e-9);
});

test('矩形判定的结算：站在光束上方的人不掉血，光束里的人照常掉', () => {
    const inBeam = { id: 2, owner: 'enemy', hp: 999, battleState: 'idle' } as unknown as ZCUnitState;
    const aboveBeam = { id: 3, owner: 'enemy', hp: 999, battleState: 'idle' } as unknown as ZCUnitState;
    const positions = new Map([[2, { x: 40, y: 10 }], [3, { x: 0, y: 40 }]]);
    const zone = {
        x: 0, y: 0, radius: 54, rectHalfHeight: 16.2, owner: 'player', sourceUnitId: 1,
        skillId: 30231, skillName: '磁电菇普攻', remainingSeconds: 3,
        wavesLeft: 1, nextWaveAt: 0, waveInterval: 1, damage: 75, slowRatio: 0,
    };
    const state = {
        elapsedSeconds: 0, groundZones: [zone], combatEvents: [], nextCombatEventId: 1,
    } as unknown as ZCSnapshot;
    const context = {
        hexIdAt: () => 0,
        unitsInRadius: () => [inBeam, aboveBeam],
        unitPosition: (target: ZCUnitState) => positions.get(target.id) ?? { x: 0, y: 0 },
        damageUnit: (target: ZCUnitState, damage: number) => { target.hp -= damage; return null; },
        ensureSlowStatus: () => {},
        applyStatus: () => {},
        exportStatusEffects: () => undefined,
        hexStep: 1,
        random: () => 0.99,
    } as unknown as Parameters<typeof ZCGroundZoneSystem.tick>[2];

    ZCGroundZoneSystem.tick(state, 0.05, context);
    assert.equal(inBeam.hp, 999 - 75, '光束覆盖到的照常结算');
    assert.equal(aboveBeam.hp, 999, '圆内、矩形外 ⇒ 这一波不打');
});

test('代码接线：施法读 auraRect*、区域两处判定都走同一个形状函数', () => {
    const cast = readFileSync(join(ROOT, 'assets/script/app/zcds/model/systems/ZCAttackResolutionSystem.ts'), 'utf8');
    assert.match(cast, /auraRectHalfHeight/, 'castSelfAura 没读 auraRectHalfHeight ⇒ 表配了也没用');
    assert.match(cast, /rectHalfLength: rectHalfLength > 0/, '半长必须能随 zone 落地');
    assert.match(cast, /rectHalfHeight: rectHalfHeight > 0/, '半宽必须能随 zone 落地');

    const zones = readFileSync(join(ROOT, 'assets/script/app/zcds/model/systems/ZCGroundZoneSystem.ts'), 'utf8');
    assert.doesNotMatch(zones, /Math\.hypot\(zone\.x - pos\.x, zone\.y - pos\.y\)/,
        '还有地方直接用圆形距离 ⇒ 矩形判定会被那一行提前筛掉');
    assert.equal((zones.match(/zcGroundZoneReaches\(zone, pos\.x, pos\.y\)/g) ?? []).length, 2,
        'resolveWave 与 resolveExpiry 两处都要换，漏一处就是「到期那一下仍然按圆打」');
});

// ────────────────────────────────────────────── 九、朝目标转向 + 抬到身体中心（2026-11-11 第三轮）

test('矩形随角度旋转：转 90° 后原来打不到的方位打得到、原来打得到的打不到', () => {
    const flat = { x: 0, y: 0, radius: 54, rectHalfHeight: 16.2 };
    const turned = { ...flat, angleDegrees: 90 };
    //  不转：光束沿 +x，正前方 40 命中、正上方 40 落空
    assert.equal(zcGroundZoneReaches(flat, 40, 0), true);
    assert.equal(zcGroundZoneReaches(flat, 0, 40), false);
    //  转 90°（+y）：正好反过来
    assert.equal(zcGroundZoneReaches(turned, 0, 40), true);
    assert.equal(zcGroundZoneReaches(turned, 40, 0), false);
    //  斜 45°：沿对角线 38 命中（|along|38≤54、横向偏移 0），沿 +x 38 落空（横向偏 26.9 > 16.2）
    const tilted = { ...flat, angleDegrees: 45 };
    assert.equal(zcGroundZoneReaches(tilted, 26.87, 26.87), true);
    assert.equal(zcGroundZoneReaches(tilted, 38, 0), false);
    //  圆不吃角度：转了也还是圆（既有区域一个都没变）
    assert.equal(zcGroundZoneReaches({ x: 0, y: 0, radius: 54, angleDegrees: 90 }, 0, 40), true);
});

test('朝向与抬升会跟着区域抄进表现事件（视图自己算不出来）', () => {
    const zone = {
        x: 0, y: 0, radius: 54, rectHalfHeight: 16.2, angleDegrees: -35, visualLiftPx: 30,
        owner: 'player', sourceUnitId: 1, skillId: 30231, skillName: '磁电菇普攻',
        effectPrefabPath: 'units/projectiles/雷电冲击/雷电冲击',
        remainingSeconds: 3, wavesLeft: 3, nextWaveAt: 99, waveInterval: 1,
        damage: 75, slowRatio: 0, holdVisual: true,
    };
    const state = {
        elapsedSeconds: 0, groundZones: [zone], combatEvents: [], nextCombatEventId: 1,
    } as unknown as ZCSnapshot;
    const context = {
        hexIdAt: () => 0,
        unitsInRadius: () => [],
        unitPosition: () => ({ x: 0, y: 0 }),
        damageUnit: () => null,
        ensureSlowStatus: () => {},
        applyStatus: () => {},
        exportStatusEffects: () => undefined,
        hexStep: 1,
    } as unknown as Parameters<typeof ZCGroundZoneSystem.tick>[2];

    ZCGroundZoneSystem.tick(state, 0.05, context);
    assert.equal(state.combatEvents.length, 1, '整段持有视觉只推一条长效事件');
    const event = state.combatEvents[0];
    assert.equal(event.angleDegrees, -35, '角度必须由模型给：area 事件 from == to，视图算不出方向');
    assert.equal(event.visualLiftPx, 30, '竖直抬升跟着事件走');

    //  区域坐标被 followCaster 改写之后，角度与抬升每帧同步（快照还原 / 事件重建都靠这条）
    zone.x = 12; zone.y = 6;
    ZCGroundZoneSystem.tick(state, 0.05, context);
    assert.equal(state.combatEvents[0].fromX, 12);
    assert.equal(state.combatEvents[0].angleDegrees, -35);
});

test('代码接线：施法算瞄准角、视图读角度与抬升', () => {
    const cast = readFileSync(join(ROOT, 'assets/script/app/zcds/model/systems/ZCAttackResolutionSystem.ts'), 'utf8');
    assert.match(cast, /auraFaceTarget/, 'castSelfAura 没读 auraFaceTarget ⇒ 永远朝右喷');
    assert.match(cast, /Math\.atan2\(targetPos\.y - origin\.y, targetPos\.x - origin\.x\)/,
        '方向必须是「本体 → 目标」的方位角');
    assert.match(cast, /Math\.cos\(aimRadians\) \* forward/,
        '出生点偏移必须用同一个角，否则光束中心与矩形朝向对不上');
    assert.match(cast, /auraVisualLiftPx/, 'castSelfAura 没读 auraVisualLiftPx ⇒ 光束埋在脚下');
    //  2026-11-12「跟随角色移动、固定在角色身前」：跟随距离必须由 `auraForward` 派生落地，
    //  否则区域每帧被 followCaster 拍回本体身上 ⇒ 光束从「身前 160」跳回「贴脚」。
    assert.match(cast, /followForward: followForward > 0/, '跟随落点没写进 zone ⇒ 跟随时会贴在脚点');
    const zones = readFileSync(join(ROOT, 'assets/script/app/zcds/model/systems/ZCGroundZoneSystem.ts'), 'utf8');
    assert.match(zones, /zone\.angleDegrees = radians \* 180 \/ Math\.PI/,
        '跟随要同时刷新朝向：落点沿朝向前移、矩形还朝旧角度 ⇒ 中心与光束错开');

    const view = readFileSync(join(ROOT, 'assets/script/app/zcds/view/ZCCombatEffectView.ts'), 'utf8');
    assert.match(view, /event\.angleDegrees \?\? 0/, '视野必须在原地播分支按事件角度转');
    assert.match(view, /event\.visualLiftPx \?\? 0/, '竖直抬升要加在 mapToViewY 之后（屏幕竖直）');
});
