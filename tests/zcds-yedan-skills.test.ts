import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { configureZCMap, ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import {
    compileZCCombatBuild, getZCModifierCatalogs, selectZCSkillPlans,
} from '../assets/script/app/zcds/model/ZCModifierRuntime';
import { captureZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import { compileZCMatchRuntime } from '../assets/script/app/zcds/model/ZCMatchRuntimeCompiler';
import type { ZCGroundZoneState, ZCSnapshot, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import { ZCAttackResolutionSystem } from '../assets/script/app/zcds/model/systems/ZCAttackResolutionSystem';
import { ZCGroundZoneSystem } from '../assets/script/app/zcds/model/systems/ZCGroundZoneSystem';
import { assetPath } from './helpers/asset-paths';

/**
 * 椰蛋战士（68005）2026-11-04 全套：配表真值 + 三条新能力的运行期落点。
 *
 * 设计案（`技能设计案2.xlsx` 第 22~26 行）到代码之间有四处「照字面写会静默失效」：
 *
 *  1. **一条普攻行只有一个强化槽**。68005 有两条主动（暴风每 5 次普攻 / 横扫 CD 8s），
 *     所以强化槽给了暴风，横扫挂到新增的 `secondarySkillId` + 副轨（`secondaryReadyAt`）上。
 *  2. **`lifestealRate` 是新 statId**：它没有基础值，只能 `add` 一个**比例**（0.02），
 *     用 `addRate` 会被 `foldStatPatch` 乘上基础值 0 而恒等于 0。
 *  3. **`on_cast_end_spawn_zone` 是新 behaviorKey**：没在 `SKILL_BEHAVIORS` /
 *     `ZCSkillRuntimeRegistry` 登记过的话，编译期直接抛「未注册 behaviorKey」。
 *  4. **移动区域要新字段**：`ZCGroundZoneState` 原本没有方向、也没有命中上限，
 *     暴风要「沿路径最多打 N 个、打满提前散」就必须补 `moveVelocityX/Y` + `hitUnitIds/maxHits`。
 */

const TABLE_NAMES = [
    'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams', 'pvpBaseTeamWeight',
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

function prepare() {
    loadPvpTables(Object.fromEntries(TABLE_NAMES.map((name) => [name, readRows(name)])) as unknown as ZCPvpTables);
    configureZCMap(JSON.parse(readFileSync(assetPath('config/maps/standard.json'), 'utf8')));
    return captureZCMatchConfig();
}

// ── 一、配表真值 ───────────────────────────────────────────────────────────────

test('椰蛋战士：30707 换链（暴风进强化槽、横扫进副轨），30831 / 30832 存在', () => {
    prepare();
    const skills = new Map(readRows('pvpSkill').map((row) => [Number(row.skillId), row]));
    const card = readRows('pvpCard').find((row) => Number(row.id) === 68005);
    assert.ok(card, '68005 必须在 pvpCard 里');
    assert.equal(Number(card!.unitSkillId), 30707);

    const attack = skills.get(30707);
    assert.ok(attack, '30707 必须存在');
    assert.equal(attack!.mode, 'melee', '切割是近战撞击');
    // 设计案 100504「主动-累计普攻 5」⇒ 强化槽按次数触发，第 5 次换成 30831。
    assert.equal(attack!.trigger, 'every_n_attacks');
    assert.equal(Number(attack!.empoweredEvery), 5);
    assert.equal(Number(attack!.empoweredSkillId), 30831);
    // 设计案 100502「主动-冷却 8 秒」⇒ 副轨（一条普攻行只有一个强化槽）。
    assert.equal(Number(attack!.secondarySkillId), 30832);
    // 这一行原来指 36221（长戟兵武将技），是遗留链路，本次按设计案摘掉。
    assert.notEqual(Number(attack!.empoweredSkillId), 36221);
    // 普攻特效不换：200501 就是「沿用椰蛋战士_普攻」
    assert.equal(attack!.effectPrefabPath, 'units/projectiles/椰蛋战士_普攻/椰蛋战士_普攻');

    const storm = skills.get(30831);
    assert.ok(storm, '30831（暴风）必须存在');
    assert.equal(storm!.mode, 'area', '暴风走持续区域分支');
    assert.equal(storm!.effectPrefabPath, 'units/projectiles/椰蛋战士_暴风/椰蛋战士_暴风');

    const sweep = skills.get(30832);
    assert.ok(sweep, '30832（横扫）必须存在');
    assert.equal(sweep!.effectPrefabPath, 'units/projectiles/椰蛋战士_横扫/椰蛋战士_横扫');

    // 别的卡不能被动到：30715 仍是玉米射手的普攻行。
    assert.equal(skills.get(30715)!.effectPrefabPath, 'units/projectiles/玉米射手_普攻/玉米射手_普攻');
});

test('椰蛋战士：12 行技能计划（4 条链 × 3 档），三档数值逐档递增', () => {
    prepare();
    const plans = readRows('pvpSkillPlan').filter((row) => String(row.unitId) === '68005');
    assert.equal(plans.length, 12, '4 条技能 × 3 档');

    const byChain = (chainId: number): Array<Record<string, unknown>> => plans
        .filter((row) => Number(row.skillChainId) === chainId)
        .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel) || Number(a.modifierId) - Number(b.modifierId));
    for (const chainId of [100501, 100502, 100503, 100504]) {
        assert.ok(byChain(chainId).length >= 3, `${chainId} 必须三档齐备`);
        for (const tier of byChain(chainId)) assert.ok(Number(tier.unlockHeroLevel) >= 1);
        // 全部挂在普攻行上：`sendAttack` 取运行时的键是 `${unitId}:${profile.skillId}`。
        for (const tier of byChain(chainId)) assert.equal(Number(tier.pvpSkillId), 30707);
    }

    // 100501 高速移动：三级同值 +15%
    for (const tier of byChain(100501)) {
        assert.equal(tier.statId, 'moveSpeed');
        assert.equal(tier.operation, 'addRate');
        assert.equal(Number(tier.value), 0.15);
    }
    // 100503 生命汲取：**一行两个数值** —— 攻击范围占 statId、吸血占 skillParamJson。
    // `ZCStatSchema` 硬校验「同一 unit + 技能链 + 等级只能有一行」，所以不能拆两行。
    for (const row of byChain(100503)) {
        assert.equal(row.statId, 'attackRange');
        assert.equal(row.operation, 'addRate');
        assert.equal(Number(row.value), 0.30);
        assert.equal(row.behaviorKey, 'skill_params');
        const params = JSON.parse(String(row.skillParamJson)) as Record<string, number>;
        assert.equal(params.lifestealRate, 0.02, '比例口径：0.02 = 2%');
    }

    // 100502 横扫：120/150/180%，只有 III 级带 2 格击退
    const sweep = byChain(100502).map((row) => JSON.parse(String(row.skillParamJson)) as Record<string, number>);
    assert.deepEqual(sweep.map((p) => p.secondaryDamageRate), [1.2, 1.5, 1.8]);
    assert.deepEqual(sweep.map((p) => p.secondaryKnockback), [0, 0, 2]);
    assert.deepEqual(sweep.map((p) => p.secondaryCooldown), [8, 8, 8]);
    assert.deepEqual(sweep.map((p) => p.secondaryFanDeg), [120, 120, 120]);
    for (const tier of byChain(100502)) assert.equal(tier.behaviorKey, 'skill_params');

    // 100504 暴风：3 道、夹角 50°、持续 3/4/4s、最多 3/4/5 人、80/100/120%
    const storm = byChain(100504).map((row) => JSON.parse(String(row.skillParamJson)) as Record<string, number>);
    assert.deepEqual(storm.map((p) => p.zoneCount), [3, 3, 3]);
    //  2026-11-03 需求「初始生成夹角要增加大 20°，更扩散一点」⇒ 总夹角 30° → 50°
    //  （三道的方向从 −15°/0°/+15° 变成 −25°/0°/+25°）。
    assert.deepEqual(storm.map((p) => p.zoneSpreadDeg), [50, 50, 50]);
    assert.deepEqual(storm.map((p) => p.zoneDuration), [3, 4, 4]);
    assert.deepEqual(storm.map((p) => p.zoneMaxHits), [3, 4, 5]);
    assert.deepEqual(storm.map((p) => p.damageRate), [0.8, 1.0, 1.2]);
    assert.deepEqual(storm.map((p) => p.zoneMoveSpeed), [70, 70, 70]);
    for (const tier of byChain(100504)) assert.equal(tier.behaviorKey, 'on_cast_end_spawn_zone');
});

// ── 二、编译期：属性与技能参数真的进运行时 ─────────────────────────────────────

test('25 级：移速 +15% / 攻击范围 +30% 落进 unit 域 statPatch，吸血走技能参数', () => {
    const config = prepare();
    const catalogs = getZCModifierCatalogs();
    const selected = selectZCSkillPlans('68005', 25, catalogs);
    // 四条链都是 `replace`（三级同值）⇒ 25 级每条链只留最高档，共 4 行。
    assert.equal(selected.length, 4, `四条链的最高档共 4 行，实得 ${selected.length}`);
    assert.deepEqual(selected.map((row) => row.modifierId).sort(),
        [91005103, 91005113, 91005123, 91005143]);

    const loadout = compileZCCombatBuild({
        unitId: '68005', heroLevel: 25, generalStar: { generalId: 68005, star: 1 },
    }, config.units, catalogs).find((item) => item.sourceKey.startsWith('skillPlan:'));
    assert.ok(loadout, '必须编译出技能计划 loadout');
    assert.equal(loadout!.statPatch.moveSpeedPct, 15);
    assert.equal(loadout!.statPatch.attackRangePct, 30);
    // 吸血**不在** statPatch 里：它在 skillParamJson（见下一个用例），
    // 所以这里必须是 undefined —— 否则说明 unit 域兜底路径被误触发了。
    assert.equal(loadout!.statPatch.lifestealRate, undefined);
});

test('25 级：暴风 / 横扫 / 吸血三套参数都并进同一个运行时（68005:30707）', () => {
    const config = prepare();
    const catalogs = getZCModifierCatalogs();
    const loadout = compileZCCombatBuild({
        unitId: '68005', heroLevel: 25, generalStar: { generalId: 68005, star: 1 },
    }, config.units, catalogs).find((item) => item.sourceKey.startsWith('skillPlan:'));
    assert.ok(loadout);
    const runtime = compileZCMatchRuntime({
        ...config,
        ownerDecks: { [ZCOwner.Player]: [], [ZCOwner.Enemy]: [] },
        modifiers: { [ZCOwner.Player]: [loadout!], [ZCOwner.Enemy]: [] },
    } as never);
    const skill = runtime.skillRuntime[ZCOwner.Player].get('68005:30707');
    assert.ok(skill, '68005:30707 必须建出运行时（否则两条主动都读不到参数）');
    // 暴风（L3）
    assert.equal(skill!.parameters.zoneCount, 3);
    assert.equal(skill!.parameters.zoneMaxHits, 5);
    assert.equal(skill!.parameters.zoneDuration, 4);
    assert.equal(skill!.parameters.damageRate, 1.2);
    // 横扫（L3）
    assert.equal(skill!.parameters.secondaryCooldown, 8);
    assert.equal(skill!.parameters.secondaryDamageRate, 1.8);
    assert.equal(skill!.parameters.secondaryKnockback, 2);
    // 生命汲取的吸血比例（同一行挂的第二个数值）
    assert.equal(skill!.parameters.lifestealRate, 0.02);
});

// ── 三、横扫：120° 扇形 + L3 击退 ─────────────────────────────────────────────

interface IFanHit {
    id: number;
    damage: number;
    knock: number;
    heal: number;
}

function makeUnit(id: number, x: number, y: number, owner = ZCOwner.Enemy): ZCUnitState {
    return {
        id, owner, unitId: '68001', cardId: '68001', tier: 1,
        sourceHexId: 0, targetHexId: null, progress: 0,
        hp: 500, maxHp: 500, battleState: 'idle', stateTime: 0,
        targetUnitId: null, targetWallHexId: null, targetBuildingHexId: null,
        nextAttackAt: 0, waitUntil: 0, attackHitDone: false,
        hatredUnitId: null, hatredUntil: 0, facingRadians: 0, deathRemoveAt: 0,
        marchAngle: null, freeX: x, freeY: y, completedAttackCount: 0,
    } as ZCUnitState;
}

/** 造一个只够跑 `castFanSkill` 的最小上下文。 */
function fanContext(caster: ZCUnitState, enemies: ZCUnitState[], params: Record<string, number>,
    statPatch: Record<string, number> = {}) {
    const hits: IFanHit[] = [];
    // 运行时键是 `${unitId}:${普攻 skillId}` —— 施法者必须是椰蛋战士本人。
    caster.unitId = '68005';
    caster.cardId = '68005';
    const units = [caster, ...enemies];
    const definition = {
        unitId: '68005', name: '椰蛋战士', maxHp: 600, attack: 30, moveSpeed: 40,
        attackRange: 70, attackInterval: 1.8, attackDuration: 0.5, attackHitTime: 0.2,
        bodyRadius: 26, spawnSeconds: 0, flying: false, canAttackAir: false, hero: true,
        prefabPath: 'units/units/椰蛋战士', prefabSize: 1.2,
        attackProfile: { skillId: 30707, name: '椰蛋战士普攻', mode: 'melee' },
        secondaryProfile: { skillId: 30832, name: '椰蛋战士·横扫', mode: 'area', areaRadius: 60 },
    };
    const context = {
        rules: {
            combatDistanceScale: 0.3, combatDamageMultiplier: 1, unitAttackPerTier: 0.16,
            counterDamageMultiplier: 1.3,
        },
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
        statPatches: {
            [ZCOwner.Player]: new Map([['68005', statPatch]]),
            [ZCOwner.Enemy]: new Map(),
        },
        skillRuntime: {
            [ZCOwner.Player]: new Map([['68005:30707', { parameters: params }]]),
            [ZCOwner.Enemy]: new Map(),
        },
        unitById: new Map(units.map((unit) => [unit.id, unit])),
        statusSystem: { statModsOf: () => ({}), controlOf: () => null },
        geometry: { hexIdAt: () => 0 },
        random: () => 1,
        effectiveDefinition: () => definition,
        unitPosition: (unit: ZCUnitState) => ({ x: unit.freeX, y: unit.freeY }),
        currentTarget: () => ({ kind: 'unit', id: 99, x: 100, y: 0, bodyRadius: 6, cardId: '68001' }),
        evaluateLegacySkill: () => ({ buffs: [], hitCount: 0, hasDamageFormula: false }),
        applyLegacySelfBuffs: () => [],
        damageUnit: (target: ZCUnitState, damage: number) => {
            target.hp = Math.max(0, target.hp - damage);
            const text = { id: hits.length + 1, kind: 'damage', owner: target.owner, value: damage, x: 0, y: 0, startedAt: 0, durationSeconds: 1 };
            hits.push({ id: target.id, damage, knock: 0, heal: 0 });
            return text;
        },
        tryExecuteUnit: () => undefined,
        applyHitStatus: () => undefined,
        applyLegacyBuffs: () => undefined,
        damageWall: () => undefined,
        damageBuilding: () => undefined,
        unitsInRadius: () => enemies,
        healUnit: (_unit: ZCUnitState, amount: number) => {
            if (hits.length) hits[hits.length - 1].heal = amount;
        },
        applyKnockback: (target: ZCUnitState, _source: ZCUnitState, distance: number) => {
            const hit = hits.find((item) => item.id === target.id);
            if (hit) hit.knock = distance;
        },
    };
    return { context, hits, units };
}

/** `castFanSkill` 扫的是 `state.units`（不是 `context.unitById`），两边都要有。 */
function fanState(units: ZCUnitState[]): ZCSnapshot {
    return {
        version: 4, elapsedSeconds: 0, nextCombatEventId: 1,
        units, projectiles: [], groundZones: [], combatEvents: [], hexes: {},
    } as unknown as ZCSnapshot;
}

test('横扫：只打前方 120° 扇形的敌人，扇形外 / 超距一律不打', () => {
    const caster = makeUnit(1, 0, 0, ZCOwner.Player);
    const front = makeUnit(2, 20, 0);        // 正前方，20 ≤ 半径
    const diagonal = makeUnit(3, 20, 20);    // 45°，在 ±60° 内
    const sideways = makeUnit(4, 0, 20);     // 90°，扇形外
    const afar = makeUnit(5, 60, 0);         // 正前方但超距
    const ally = makeUnit(6, 15, 0, ZCOwner.Player);
    const enemies = [front, diagonal, sideways, afar, ally];
    const { context, hits, units } = fanContext(caster, enemies, {
        secondaryCooldown: 8, secondaryDamageRate: 1.8, secondaryFanDeg: 120,
        secondaryRadiusScale: 1.4, secondaryKnockback: 2,
    });
    const state = fanState(units);
    assert.equal(ZCAttackResolutionSystem.castFanSkill(state, caster, context as never), true);
    assert.deepEqual(hits.map((hit) => hit.id).sort(), [2, 3], `只该打中正前方与斜前方，实际 ${JSON.stringify(hits)}`);
    // 伤害 = 面板 30 × 1 × 1 × 1.8（无暴击、无克制）
    for (const hit of hits) assert.equal(hit.damage, 54);
    // 半径 = (attackRange 70 + bodyRadius 26) × 0.3 × 1.4 ≈ 40.3 ⇒ 60 距离的 E5 打不到
    assert.equal(hits.some((hit) => hit.id === 5), false, '超距目标不该被打');

    // 表现事件：一条 area、锚点在施法者、半径与伤害跟结算一致
    assert.equal(state.combatEvents.length, 1);
    const event = state.combatEvents[0];
    assert.equal(event.type, 'area');
    assert.equal(Number(event.skillId), 30832);
    assert.equal(event.fromX, 0);
    assert.ok(Math.abs(Number(event.radius) - 40.32) < 0.01, `半径应 ≈40.32，实得 ${event.radius}`);
});

test('横扫：L3 带 2 格击退（换算成逻辑距离 84），L1 不击退', () => {
    const caster3 = makeUnit(1, 0, 0, ZCOwner.Player);
    const l3 = fanContext(caster3, [makeUnit(2, 20, 0)], {
        secondaryCooldown: 8, secondaryDamageRate: 1.8, secondaryFanDeg: 120,
        secondaryRadiusScale: 1.4, secondaryKnockback: 2,
    });
    ZCAttackResolutionSystem.castFanSkill(fanState(l3.units), caster3, l3.context as never);
    assert.equal(l3.hits.length, 1);
    // `applyLegacyKnockback` 的口径是「格 × HEX_GRID_LOGICAL_ROW_STEP(42)」再乘 combatDistanceScale。
    assert.equal(l3.hits[0].knock, 84, '2 格 = 2 × 42 逻辑单位');

    const caster1 = makeUnit(1, 0, 0, ZCOwner.Player);
    const l1 = fanContext(caster1, [makeUnit(2, 20, 0)], {
        secondaryCooldown: 8, secondaryDamageRate: 1.2, secondaryFanDeg: 120,
        secondaryRadiusScale: 1.4, secondaryKnockback: 0,
    });
    ZCAttackResolutionSystem.castFanSkill(fanState(l1.units), caster1, l1.context as never);
    assert.equal(l1.hits[0].knock, 0, 'L1/L2 不击退');
});

test('横扫：没有副轨参数或没有目标时不出手（CD 不该被消费）', () => {
    const caster = makeUnit(1, 0, 0, ZCOwner.Player);
    const noParams = fanContext(caster, [makeUnit(2, 20, 0)], {});
    assert.equal(ZCAttackResolutionSystem.castFanSkill(fanState(noParams.units), caster, noParams.context as never), false);

    const noTarget = fanContext(caster, [makeUnit(2, 20, 0)], { secondaryCooldown: 8 });
    (noTarget.context as unknown as { currentTarget: () => null }).currentTarget = () => null;
    assert.equal(ZCAttackResolutionSystem.castFanSkill(fanState(noTarget.units), caster, noTarget.context as never), false);
});

test('吸血：命中后按真正扣掉的血量 × 2% 回血', () => {
    const caster = makeUnit(1, 0, 0, ZCOwner.Player);
    const { context, hits, units } = fanContext(caster, [makeUnit(2, 20, 0)], {
        secondaryCooldown: 8, secondaryDamageRate: 1.0, secondaryFanDeg: 120,
        secondaryRadiusScale: 1.4, secondaryKnockback: 0,
    }, { lifestealRate: 0.02 });
    ZCAttackResolutionSystem.castFanSkill(fanState(units), caster, context as never);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].damage, 30);
    assert.equal(hits[0].heal, 30 * 0.02, '按 applied 反算，不是面板伤害');
});

// ── 四、暴风：移动区域 + 命中上限 ─────────────────────────────────────────────

function makeZone(overrides: Partial<ZCGroundZoneState> = {}): ZCGroundZoneState {
    return {
        x: 0, y: 0, radius: 9,
        owner: ZCOwner.Player, sourceUnitId: 1,
        skillId: 30831, skillName: '椰蛋战士·暴风',
        effectPrefabPath: null,
        remainingSeconds: 1, wavesLeft: 40, nextWaveAt: 0, waveInterval: 0.1,
        damage: 24, slowRatio: 0,
        ...overrides,
    } as ZCGroundZoneState;
}

function zoneContext(enemies: ZCUnitState[]) {
    return {
        hexStep: 42,
        hexIdAt: () => 0,
        unitsInRadius: () => enemies,
        unitPosition: (unit: ZCUnitState) => ({ x: unit.freeX, y: unit.freeY }),
        damageUnit: () => null,
        ensureSlowStatus: () => undefined,
        applyStatus: () => undefined,
        exportStatusEffects: () => undefined,
    } as never;
}

test('暴风：移动区域按速度推进位置，同一个敌人只结算一次', () => {
    const enemy = makeUnit(2, 10, 0);
    const zone = makeZone({
        moveVelocityX: 20, moveVelocityY: 0,
        maxHits: 3, hitUnitIds: [],
    });
    const state = {
        elapsedSeconds: 0, groundZones: [zone], combatEvents: [],
        nextCombatEventId: 1, statusEffects: undefined,
    } as never;
    const damages: number[] = [];
    const context = zoneContext([enemy]) as Record<string, unknown>;
    context.damageUnit = () => { damages.push(1); return null; };
    let steps = 0;
    while ((state as unknown as { groundZones: ZCGroundZoneState[] }).groundZones.length && steps < 40) {
        steps += 1;
        (state as unknown as { elapsedSeconds: number }).elapsedSeconds = steps * 0.05;
        ZCGroundZoneSystem.tick(state as never, 0.05, context as never);
    }
    assert.equal(damages.length, 1, `同一个敌人只该吃一次，实际 ${damages.length} 次`);
    assert.equal(zone.hitUnitIds!.length, 1);
    // 0.5s 走 10 单位 ⇒ 打到 10 位置上的敌人
    assert.ok(zone.x >= 9.5 || (state as unknown as { groundZones: ZCGroundZoneState[] }).groundZones.length === 0);
});

test('暴风：命中名额打满就提前消失', () => {
    const enemies = [makeUnit(2, 4, 0), makeUnit(3, 8, 0), makeUnit(4, 12, 0)];
    const zone = makeZone({
        moveVelocityX: 20, moveVelocityY: 0,
        // 半径 9 罩得住三个，但只准打 2 个
        radius: 9, maxHits: 2, hitUnitIds: [],
        remainingSeconds: 5,
    });
    const state = {
        elapsedSeconds: 0, groundZones: [zone], combatEvents: [],
        nextCombatEventId: 1, statusEffects: undefined,
    } as never;
    const stateView = state as unknown as { groundZones: ZCGroundZoneState[]; elapsedSeconds: number };
    const context = zoneContext(enemies) as Record<string, unknown>;
    context.damageUnit = () => null;
    for (let step = 1; step <= 10 && stateView.groundZones.length; step += 1) {
        stateView.elapsedSeconds = step * 0.05;
        ZCGroundZoneSystem.tick(state as never, 0.05, context as never);
    }
    assert.equal(zone.hitUnitIds!.length, 2, `最多打 2 个，实际 ${zone.hitUnitIds!.length}`);
    assert.equal(stateView.groundZones.length, 0, '打满名额后必须提前消散');
});

// ── 五、区域伤害也吃吸血（2026-11-04 补：原先把持续区域排除在外） ──────────────

test('暴风：区域每一跳都按实际掉血反算吸血，与普攻同一条口径', () => {
    const caster = makeUnit(1, 0, 0, ZCOwner.Player);
    caster.unitId = '68005';
    const e1 = makeUnit(2, 2, 0);
    const e2 = makeUnit(3, -2, 0);
    const enemies = [e1, e2];

    // 只凑 `applyLifesteal` 真正读的五个字段：effectiveDefinition / skillRuntime /
    // statPatches / statusSystem / healUnit。取值顺序是「技能参数优先、unit 域兜底，
    // 再加上状态域那一层（2026-10-30 僵尸「嗜血」）」。这里走技能参数。
    const healed: Array<{ unit: string; amount: number }> = [];
    const attackContext = {
        effectiveDefinition: () => ({ attackProfile: { skillId: 30707 } }),
        statusSystem: { statModsOf: () => ({}) },
        skillRuntime: {
            [ZCOwner.Player]: new Map([['68005:30707', { parameters: { lifestealRate: 0.02 } }]]),
            [ZCOwner.Enemy]: new Map(),
        },
        statPatches: { [ZCOwner.Player]: new Map(), [ZCOwner.Enemy]: new Map() },
        healUnit: (unit: ZCUnitState, amount: number) => { healed.push({ unit: unit.unitId, amount }); },
    } as never;

    const zone = makeZone({
        radius: 9, damage: 12, wavesLeft: 1, waveInterval: 0.1,
        sourceUnitId: caster.id,
    });
    const state = {
        elapsedSeconds: 0.5, groundZones: [zone], combatEvents: [],
        nextCombatEventId: 1, statusEffects: undefined,
    } as never;
    const context = {
        hexStep: 42,
        hexIdAt: () => 0,
        unitsInRadius: () => enemies,
        unitPosition: (unit: ZCUnitState) => ({ x: unit.freeX, y: unit.freeY }),
        // 这一跳真扣了 12 血 ⇒ 飘字 value = 12（= damageUnit 的 result.applied）
        damageUnit: (_target: ZCUnitState, damage: number) => ({ value: damage }),
        ensureSlowStatus: () => undefined,
        applyStatus: () => undefined,
        exportStatusEffects: () => undefined,
        // 与 ZCGameModel.buildGroundZoneContext 的接线逐字一致：找回源单位后转给普攻那条实现
        lifestealFromHit: (sourceUnitId: number, hitText: { value?: number } | null) => {
            const source = [caster, ...enemies].find((unit) => unit.id === sourceUnitId);
            if (!source || source.battleState === 'dead') return;
            ZCAttackResolutionSystem.applyLifesteal(source, hitText as never, attackContext);
        },
    } as never;

    ZCGroundZoneSystem.tick(state as never, 0.05, context as never);

    // 一次波次打到两个人 ⇒ 两次独立回血，各 12 × 2% = 0.24
    assert.equal(healed.length, 2, `命中 2 人应回 2 次，实际 ${healed.length} 次`);
    for (const item of healed) assert.equal(item.amount, 12 * 0.02);
    assert.equal(healed[0].unit, '68005');
});

test('暴风：这一跳没真扣到血（被盾吃 / 飘字为 null）就不回血', () => {
    const caster = makeUnit(1, 0, 0, ZCOwner.Player);
    caster.unitId = '68005';
    const enemy = makeUnit(2, 2, 0);
    const healed: number[] = [];
    const attackContext = {
        effectiveDefinition: () => ({ attackProfile: { skillId: 30707 } }),
        statusSystem: { statModsOf: () => ({}) },
        skillRuntime: {
            [ZCOwner.Player]: new Map([['68005:30707', { parameters: { lifestealRate: 0.02 } }]]),
            [ZCOwner.Enemy]: new Map(),
        },
        statPatches: { [ZCOwner.Player]: new Map(), [ZCOwner.Enemy]: new Map() },
        healUnit: (_unit: ZCUnitState, amount: number) => { healed.push(amount); },
    } as never;
    const zone = makeZone({ radius: 9, damage: 12, wavesLeft: 1, waveInterval: 0.1, sourceUnitId: caster.id });
    const state = {
        elapsedSeconds: 0.5, groundZones: [zone], combatEvents: [],
        nextCombatEventId: 1, statusEffects: undefined,
    } as never;
    const context = {
        hexStep: 42,
        hexIdAt: () => 0,
        unitsInRadius: () => [enemy],
        unitPosition: (unit: ZCUnitState) => ({ x: unit.freeX, y: unit.freeY }),
        damageUnit: () => null,   // 护盾全吸收 / 无敌 / 已死：applied = 0
        ensureSlowStatus: () => undefined,
        applyStatus: () => undefined,
        exportStatusEffects: () => undefined,
        lifestealFromHit: (sourceUnitId: number, hitText: { value?: number } | null) => {
            const source = [caster, enemy].find((unit) => unit.id === sourceUnitId);
            if (!source || source.battleState === 'dead') return;
            ZCAttackResolutionSystem.applyLifesteal(source, hitText as never, attackContext);
        },
    } as never;

    ZCGroundZoneSystem.tick(state as never, 0.05, context as never);
    assert.deepEqual(healed, [], '没扣到血就不该凭空回血');
});

test('暴风：源单位已阵亡时区域不再吸血（人没了还在飘的风不该继续回）', () => {
    const caster = makeUnit(1, 0, 0, ZCOwner.Player);
    caster.unitId = '68005';
    caster.battleState = 'dead';
    const enemy = makeUnit(2, 2, 0);
    const healed: number[] = [];
    const attackContext = {
        effectiveDefinition: () => ({ attackProfile: { skillId: 30707 } }),
        statusSystem: { statModsOf: () => ({}) },
        skillRuntime: {
            [ZCOwner.Player]: new Map([['68005:30707', { parameters: { lifestealRate: 0.02 } }]]),
            [ZCOwner.Enemy]: new Map(),
        },
        statPatches: { [ZCOwner.Player]: new Map(), [ZCOwner.Enemy]: new Map() },
        healUnit: (_unit: ZCUnitState, amount: number) => { healed.push(amount); },
    } as never;
    const zone = makeZone({ radius: 9, damage: 12, wavesLeft: 1, waveInterval: 0.1, sourceUnitId: caster.id });
    const state = {
        elapsedSeconds: 0.5, groundZones: [zone], combatEvents: [],
        nextCombatEventId: 1, statusEffects: undefined,
    } as never;
    const context = {
        hexStep: 42,
        hexIdAt: () => 0,
        unitsInRadius: () => [enemy],
        unitPosition: (unit: ZCUnitState) => ({ x: unit.freeX, y: unit.freeY }),
        damageUnit: (_target: ZCUnitState, damage: number) => ({ value: damage }),
        ensureSlowStatus: () => undefined,
        applyStatus: () => undefined,
        exportStatusEffects: () => undefined,
        lifestealFromHit: (sourceUnitId: number, hitText: { value?: number } | null) => {
            const source = [caster, enemy].find((unit) => unit.id === sourceUnitId);
            if (!source || source.battleState === 'dead') return;
            ZCAttackResolutionSystem.applyLifesteal(source, hitText as never, attackContext);
        },
    } as never;

    ZCGroundZoneSystem.tick(state as never, 0.05, context as never);
    assert.deepEqual(healed, [], '源单位已阵亡，不该回血');
});
