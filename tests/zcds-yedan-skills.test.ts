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
import { ZCSkillResolutionSystem } from '../assets/script/app/zcds/model/systems/ZCSkillResolutionSystem';
import { ZCGroundZoneSystem } from '../assets/script/app/zcds/model/systems/ZCGroundZoneSystem';
import { ZC_EMPOWERED_LOCK_PARAM } from '../assets/script/app/zcds/model/ZCSkillRuntime';
import { zcCombatEffectGrowFactor } from '../assets/script/app/zcds/view/ZCCombatEffectScale';
import { assetPath } from './helpers/asset-paths';
import { withoutLineupCrit } from './helpers/lineup-crit';

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

function prepare() {
    loadPvpTables(Object.fromEntries(TABLE_NAMES.map((name) => [name, readRows(name)])) as unknown as ZCPvpTables);
    configureZCMap(JSON.parse(readFileSync(assetPath('config/maps/normal.json'), 'utf8')));
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
    const plans = withoutLineupCrit(readRows('pvpSkillPlan'))
        .filter((row) => String(row.unitId) === '68005');
    // 68005 另有 50 行「全队暴击伤害增幅」（skillChainId 109001），不是技能链，先剔掉。
    assert.equal(plans.length, 12, '4 条技能 × 3 档');

    const byChain = (chainId: number): Array<Record<string, unknown>> => plans
        .filter((row) => Number(row.skillChainId) === chainId)
        .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel) || Number(a.modifierId) - Number(b.modifierId));
    for (const chainId of [100501, 100502, 100503, 100504]) {
        assert.ok(byChain(chainId).length >= 3, `${chainId} 必须三档齐备`);
        // 第 1 档允许 0（「解锁即拥有」）：`ZCStatSchema` 对 unlockHeroLevel 只要求 >= 0。
        for (const tier of byChain(chainId)) {
            const unlock = Number(tier.unlockHeroLevel);
            assert.ok(Number.isSafeInteger(unlock) && unlock >= 0, `${chainId} 的解锁等级必须是非负整数`);
        }
        // 全部挂在普攻行上：`sendAttack` 取运行时的键是 `${unitId}:${profile.skillId}`。
        for (const tier of byChain(chainId)) assert.equal(Number(tier.pvpSkillId), 30707);
    }

    // 100501「蔓生连打」（2026-11-17 连击批次）：旧的「高速移动」（移速 +15%）整条换掉 ——
    // 设计案 mech 写明「移速不在战士任何档位池」。现在是 1 段连击 + 逐档递减系数。
    for (const [index, tier] of byChain(100501).entries()) {
        assert.equal(tier.statId, 'attackCount');
        assert.equal(tier.operation, 'add');
        assert.equal(Number(tier.value), 1, '紫卡只有 1 段额外连击（金卡才是 2 段）');
        const params = JSON.parse(String(tier.skillParamJson)) as Record<string, number>;
        assert.equal(params.comboDamage, [60, 65, 70][index], '第 2 段占首段的百分比');
        assert.equal(params.comboFalloff, 0.4, '再往后每段 ×0.6（本卡没有第 3 段，系数不生效）');
    }
    // 100503 V5「异种猎杀协议」（2026-11-17 落地）：对蘑菇阵营 +45/50/55%、暴击率 8/10/12%，
    // 混搭尾（攻击 7% / 伤害 6% / 攻速 7%）走 `mix.*`。
    //  🔴 原来的「生命汲取」（攻击范围 +30% + `lifestealRate` 2%）被设计案整条替换 ——
    //  `lifestealRate` 现在**不该**再出现在这行参数里。
    for (const [index, row] of byChain(100503).entries()) {
        assert.equal(row.statId, 'counterCamp2', '对蘑菇阵营（ZC_CAMP_TRAITS 第 2 位）');
        assert.equal(row.operation, 'add');
        assert.equal(Number(row.value), [45, 50, 55][index]);
        assert.equal(row.behaviorKey, 'skill_params');
        const params = JSON.parse(String(row.skillParamJson)) as Record<string, number>;
        assert.equal(params['mix.critRate'], [8, 10, 12][index]);
        assert.equal(params['mix.attack.addRate'], 0.07);
        assert.equal(params['mix.damageRate.addRate'], 0.06);
        assert.equal(params['mix.attackSpeed.addRate'], 0.07);
        assert.equal(params.lifestealRate, undefined, '吸血已随机制更换移除');
    }

    // 100502 横扫：120/150/180%，只有 III 级带 2 格击退
    const sweep = byChain(100502).map((row) => JSON.parse(String(row.skillParamJson)) as Record<string, number>);
    assert.deepEqual(sweep.map((p) => p.secondaryDamageRate), [1.2, 1.5, 1.8]);
    assert.deepEqual(sweep.map((p) => p.secondaryKnockback), [0, 0, 2]);
    assert.deepEqual(sweep.map((p) => p.secondaryCooldown), [8, 8, 8]);
    assert.deepEqual(sweep.map((p) => p.secondaryFanDeg), [120, 120, 120]);
    for (const tier of byChain(100502)) assert.equal(tier.behaviorKey, 'skill_params');

    // 100504 暴风（2026-11-07 改口径）：3 道、**总夹角 50°**、**三档统一 3 秒**、
    // **100px/s**、最多 3/4/5 人、80/100/120%。
    const storm = byChain(100504).map((row) => JSON.parse(String(row.skillParamJson)) as Record<string, number>);
    assert.deepEqual(storm.map((p) => p.zoneCount), [3, 3, 3]);
    assert.deepEqual(storm.map((p) => p.zoneSpreadDeg), [50, 50, 50], '三条旋风的总夹角');
    assert.deepEqual(storm.map((p) => p.zoneDuration), [3, 3, 3], '三档都跑 3 秒');
    assert.deepEqual(storm.map((p) => p.zoneMaxHits), [3, 4, 5]);
    assert.deepEqual(storm.map((p) => p.damageRate), [0.8, 1.0, 1.2]);
    assert.deepEqual(storm.map((p) => p.zoneMoveSpeed), [100, 100, 100]);
    //  「由小变大」只有走「整段持有视觉」才成立：逐波残影每条只活 0.15s，长不出来。
    assert.deepEqual(storm.map((p) => p.zoneHoldVisual), [1, 1, 1]);
    assert.deepEqual(storm.map((p) => p.zoneGrowSeconds), [0.3, 0.3, 0.3]);
    for (const tier of byChain(100504)) assert.equal(tier.behaviorKey, 'on_cast_end_spawn_zone');
});

// ── 二、编译期：属性与技能参数真的进运行时 ─────────────────────────────────────

test('36 级：连击段数与 100503 的克制条 / 混搭尾都落进 unit 域 statPatch', () => {
    const config = prepare();
    const catalogs = getZCModifierCatalogs();
    const selected = withoutLineupCrit(selectZCSkillPlans('68005', 36, catalogs));
    // 四条链都是 `replace`（三级同值）⇒ 每条链只留最高档，共 4 行。取 36 级是因为
    // 100504 在**第 4 格**、III 档要到 36 级（2026-11-17 统一档位前是 25）。
    assert.equal(selected.length, 4, `四条链的最高档共 4 行，实得 ${selected.length}`);
    assert.deepEqual(selected.map((row) => row.modifierId).sort(),
        [91005103, 91005113, 91005123, 91005143]);

    const loadout = compileZCCombatBuild({
        unitId: '68005', heroLevel: 36, generalStar: { generalId: 68005, star: 1 },
    }, config.units, catalogs).find((item) => item.sourceKey.startsWith('skillPlan:'));
    assert.ok(loadout, '必须编译出技能计划 loadout');
    //  100501 换成连击后不再给移速（旧「高速移动」已整条替换）。
    assert.equal(loadout!.statPatch.moveSpeedPct, undefined, '移速随「高速移动」一起移除');
    assert.equal(loadout!.statPatch.multiHitFlat, 1, '1 段额外连击');
    //  100503 换成克制条后不再给攻击范围（那条 30% 是旧「生命汲取」的），
    //  改为「对蘑菇阵营 +55%」+ 暴击率 12% + 混搭尾（攻 7% / 伤害 6% / 攻速 7%）。
    assert.equal(loadout!.statPatch.attackRangePct, undefined, '旧「生命汲取」的攻击范围已移除');
    assert.equal(loadout!.statPatch.counterCamp2Pct, 55);
    assert.equal(loadout!.statPatch.critRatePct, 12);
    //  `addRate` 折百分数是 `value * 100`，0.07 会带出 7.000000000000001 ⇒ 比到 1e-9。
    const near = (actual: number | undefined, expected: number) => {
        assert.ok(actual != null && Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);
    };
    near(loadout!.statPatch.attackPct, 7);
    near(loadout!.statPatch.damageRatePct, 6);
    near(loadout!.statPatch.attackSpeedPct, 7);
    // 吸血**不在** statPatch 里：它是技能参数而不是常驻补丁 ——
    // 这条卡现在也根本没有吸血了，所以必须是 undefined。
    assert.equal(loadout!.statPatch.lifestealRate, undefined);
});

test('36 级：暴风 / 横扫两套参数都并进同一个运行时（68005:30707）', () => {
    const config = prepare();
    const catalogs = getZCModifierCatalogs();
    const loadout = compileZCCombatBuild({
        unitId: '68005', heroLevel: 36, generalStar: { generalId: 68005, star: 1 },
    }, config.units, catalogs).find((item) => item.sourceKey.startsWith('skillPlan:'));
    assert.ok(loadout);
    const runtime = compileZCMatchRuntime({
        ...config,
        ownerDecks: { [ZCOwner.Player]: [], [ZCOwner.Enemy]: [] },
        modifiers: { [ZCOwner.Player]: [loadout!], [ZCOwner.Enemy]: [] },
    } as never);
    const skill = runtime.skillRuntime[ZCOwner.Player].get('68005:30707');
    assert.ok(skill, '68005:30707 必须建出运行时（否则两条主动都读不到参数）');
    // 暴风（L3，2026-11-07 改口径：三档统一 3 秒、100px/s、夹角 50°）
    assert.equal(skill!.parameters.zoneCount, 3);
    assert.equal(skill!.parameters.zoneMaxHits, 5);
    assert.equal(skill!.parameters.zoneDuration, 3);
    assert.equal(skill!.parameters.zoneMoveSpeed, 100);
    assert.equal(skill!.parameters.zoneSpreadDeg, 50);
    assert.equal(skill!.parameters.zoneGrowSeconds, 0.3);
    assert.equal(skill!.parameters.damageRate, 1.2);
    // 横扫（L3）
    assert.equal(skill!.parameters.secondaryCooldown, 8);
    assert.equal(skill!.parameters.secondaryDamageRate, 1.8);
    assert.equal(skill!.parameters.secondaryKnockback, 2);
    // 生命汲取已随 V5 移除（100503 改成异种猎杀协议）⇒ 同一份参数袋里不该再有吸血比例。
    assert.equal(skill!.parameters.lifestealRate, undefined);
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
    assert.equal(ZCSkillResolutionSystem.castFanSkill(state, caster, context as never), true);
    assert.deepEqual(hits.map((hit) => hit.id).sort(), [2, 3], `只该打中正前方与斜前方，实际 ${JSON.stringify(hits)}`);
    // 伤害 = 面板 30 × 1 × 1 × 1.8（无暴击、无克制）
    for (const hit of hits) assert.equal(hit.damage, 54);
    // 半径 = (attackRange 70 + bodyRadius 26 × 0.5) × 0.3 × 1.4 ≈ 34.86 ⇒ 60 距离的 E5 打不到
    assert.equal(hits.some((hit) => hit.id === 5), false, '超距目标不该被打');

    // 表现事件：一条 area、锚点在施法者、半径与伤害跟结算一致
    assert.equal(state.combatEvents.length, 1);
    const event = state.combatEvents[0];
    assert.equal(event.type, 'area');
    assert.equal(Number(event.skillId), 30832);
    assert.equal(event.fromX, 0);
    assert.ok(Math.abs(Number(event.radius) - 34.86) < 0.01, `半径应 ≈34.86，实得 ${event.radius}`);
});

test('横扫：L3 带 2 格击退（换算成逻辑距离 84），L1 不击退', () => {
    const caster3 = makeUnit(1, 0, 0, ZCOwner.Player);
    const l3 = fanContext(caster3, [makeUnit(2, 20, 0)], {
        secondaryCooldown: 8, secondaryDamageRate: 1.8, secondaryFanDeg: 120,
        secondaryRadiusScale: 1.4, secondaryKnockback: 2,
    });
    ZCSkillResolutionSystem.castFanSkill(fanState(l3.units), caster3, l3.context as never);
    assert.equal(l3.hits.length, 1);
    // `applyLegacyKnockback` 的口径是「格 × HEX_GRID_LOGICAL_ROW_STEP(42)」再乘 combatDistanceScale。
    assert.equal(l3.hits[0].knock, 84, '2 格 = 2 × 42 逻辑单位');

    const caster1 = makeUnit(1, 0, 0, ZCOwner.Player);
    const l1 = fanContext(caster1, [makeUnit(2, 20, 0)], {
        secondaryCooldown: 8, secondaryDamageRate: 1.2, secondaryFanDeg: 120,
        secondaryRadiusScale: 1.4, secondaryKnockback: 0,
    });
    ZCSkillResolutionSystem.castFanSkill(fanState(l1.units), caster1, l1.context as never);
    assert.equal(l1.hits[0].knock, 0, 'L1/L2 不击退');
});

test('横扫：没有副轨参数或没有目标时不出手（CD 不该被消费）', () => {
    const caster = makeUnit(1, 0, 0, ZCOwner.Player);
    const noParams = fanContext(caster, [makeUnit(2, 20, 0)], {});
    assert.equal(ZCSkillResolutionSystem.castFanSkill(fanState(noParams.units), caster, noParams.context as never), false);

    const noTarget = fanContext(caster, [], { secondaryCooldown: 8 });
    (noTarget.context as unknown as { currentTarget: () => null }).currentTarget = () => null;
    assert.equal(ZCSkillResolutionSystem.castFanSkill(fanState(noTarget.units), caster, noTarget.context as never), false);
});

test('独立打击的最近排序落实到真实伤害对象，不受随机值影响', () => {
    const caster = makeUnit(1, 0, 0, ZCOwner.Player);
    const h = fanContext(caster, [makeUnit(3, 20, 0), makeUnit(2, 10, 0)], {});
    const state = fanState(h.units);
    const hits = ZCSkillResolutionSystem.strikeTargets(state, caster,
        { count: 1, radius: Infinity, damageRate: 1, nearest: true }, h.context as never);
    assert.equal(hits, 1);
    assert.deepEqual(h.hits.map(hit => hit.id), [2]);
});

test('吸血：命中后按真正扣掉的血量 × 2% 回血', () => {
    const caster = makeUnit(1, 0, 0, ZCOwner.Player);
    const { context, hits, units } = fanContext(caster, [makeUnit(2, 20, 0)], {
        secondaryCooldown: 8, secondaryDamageRate: 1.0, secondaryFanDeg: 120,
        secondaryRadiusScale: 1.4, secondaryKnockback: 0,
    }, { lifestealRate: 0.02 });
    ZCSkillResolutionSystem.castFanSkill(fanState(units), caster, context as never);
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

// ── 六、暴风 2026-11-07 改口径：从自身坐标出发 / 攻击朝向为中轴 / 由小变大 ──────────
//
// 需求原话：
//   1. 三个飓风生成位置是从椰蛋战士的坐标
//   2. 生成后由小变大到当前的大小，以椰蛋战士的攻击朝向为法线，3 个飓风夹角为 50°，
//      飓风以 100px 的速度移动 3s，每个飓风根据技能 1/2/3 等级最多分别对 3/4/5 个敌人造成伤害，
//      伤害次数达到上限后对应的飓风提前消失

/** 让 `sendAttack` 走进「移动区域」分支的最小上下文：强化那一击 = 暴风（30831, mode area）。 */
function stormHarness(options: {
    facingRadians: number;
    targetX: number;
    targetY: number;
    params: Record<string, number>;
}) {
    const caster = makeUnit(1, 10, 20, ZCOwner.Player);
    caster.unitId = '68005';
    caster.cardId = '68005';
    caster.facingRadians = options.facingRadians;
    //  普攻行是 `every_n_attacks` / every 5 ⇒ 第 5 次才是强化那一击。
    caster.completedAttackCount = 4;

    const attackProfile = {
        skillId: 30707, name: '椰蛋战士普攻', mode: 'melee' as const,
        trigger: 'every_n_attacks' as const, cooldown: 5, empoweredEvery: 5, empoweredSkillId: 30831,
        effectPrefabPath: 'units/projectiles/椰蛋战士_普攻/椰蛋战士_普攻',
    };
    const definition = {
        unitId: '68005', name: '椰蛋战士', maxHp: 600, attack: 30, moveSpeed: 40,
        attackRange: 70, attackInterval: 1.8, attackDuration: 0.5, attackHitTime: 0.2,
        bodyRadius: 26, spawnSeconds: 0, flying: false, canAttackAir: false, hero: true,
        prefabPath: 'units/units/椰蛋战士', prefabSize: 1.2,
        attackProfile,
        empoweredProfile: {
            skillId: 30831, name: '椰蛋战士·暴风', mode: 'area' as const, areaRadius: 30,
            damageRate: 0.8, durationSeconds: 3, waves: 20,
            effectPrefabPath: 'units/projectiles/椰蛋战士_暴风/椰蛋战士_暴风',
        },
    };
    const bonuses = {
        activeBonds: [], unitHpMultiplier: 1, unitAttackMultiplier: 1, moveSpeedMultiplier: 1,
        towerAttackMultiplier: 1, incomeBonus: 0, spawnIntervalMultiplier: 1,
    };
    const context = {
        rules: { combatDistanceScale: 0.3, combatDamageMultiplier: 1, unitAttackPerTier: 0.16, counterDamageMultiplier: 1.3 },
        counters: [],
        cards: { [ZCOwner.Player]: new Map(), [ZCOwner.Enemy]: new Map() },
        deckBonuses: { [ZCOwner.Player]: bonuses, [ZCOwner.Enemy]: bonuses },
        statPatches: { [ZCOwner.Player]: new Map(), [ZCOwner.Enemy]: new Map() },
        skillRuntime: {
            [ZCOwner.Player]: new Map([['68005:30707', { parameters: options.params }]]),
            [ZCOwner.Enemy]: new Map(),
        },
        unitById: new Map([[caster.id, caster]]),
        statusSystem: { statModsOf: () => ({}), controlOf: () => null },
        geometry: { hexIdAt: () => 0 },
        random: () => 1,
        effectiveDefinition: () => definition,
        unitPosition: (unit: ZCUnitState) => ({ x: unit.freeX, y: unit.freeY }),
        currentTarget: () => ({
            kind: 'unit', id: 99, x: options.targetX, y: options.targetY, bodyRadius: 6, cardId: '68001',
        }),
        evaluateLegacySkill: () => ({ buffs: [], hitCount: 0, hasDamageFormula: false }),
        applyLegacySelfBuffs: () => [],
        damageUnit: () => null,
        tryExecuteUnit: () => undefined,
        applyHitStatus: () => undefined,
        applyLegacyBuffs: () => undefined,
        damageWall: () => undefined,
        damageBuilding: () => undefined,
        unitsInRadius: () => [],
        healUnit: () => undefined,
        applyKnockback: () => undefined,
    };
    const state = {
        version: 4, elapsedSeconds: 10, nextCombatEventId: 1,
        units: [caster], projectiles: [], groundZones: [], combatEvents: [], hexes: {},
    } as unknown as ZCSnapshot;
    return { caster, state, context };
}

const STORM_L1 = {
    zoneCount: 3, zoneSpreadDeg: 50, zoneMoveSpeed: 100, zoneDuration: 3,
    zoneWaveInterval: 0.15, zoneMaxHits: 3, damageRate: 0.8,
    zoneHoldVisual: 1, zoneGrowSeconds: 0.3,
};

test('暴风：三道旋风从椰蛋战士坐标生成，以攻击朝向为中轴、总夹角 50°', () => {
    //  椰蛋战士在 (10, 20)，**朝上**（facingRadians = π/2）；目标在正右方 (110, 20)。
    //  如果照着「指向目标」开扇，三道应该是 -25° / 0° / +25°；
    //  按需求以**攻击朝向**为中轴，就该是 65° / 90° / 115°。
    const harness = stormHarness({ facingRadians: Math.PI / 2, targetX: 110, targetY: 20, params: STORM_L1 });
    ZCAttackResolutionSystem.sendAttack(
        harness.state, harness.caster, harness.context as never,
    );
    const zones = harness.state.groundZones;
    assert.equal(zones.length, 3, '3 道旋风');

    //  ① 生成位置 = 椰蛋战士坐标（三道同一出发点，不散在目标点周围）
    for (const zone of zones) {
        assert.equal(zone.x, 10, 'x 必须等于施法者 x');
        assert.equal(zone.y, 20, 'y 必须等于施法者 y');
    }

    //  ② 中轴 = 攻击朝向，总夹角 50°（±25°）
    const degrees = zones
        .map((zone) => Math.round(Math.atan2(zone.moveVelocityY!, zone.moveVelocityX!) * 180 / Math.PI))
        .map((value) => (value + 360) % 360)
        .sort((a, b) => a - b);
    assert.deepEqual(degrees, [65, 90, 115], `期望 90°±25°，实际 ${degrees.join('/')}`);

    //  ③ 速度 100px/s（表值 × combatDistanceScale 0.3 = 30 世界 px/s）
    for (const zone of zones) {
        const speed = Math.hypot(zone.moveVelocityX!, zone.moveVelocityY!);
        assert.ok(Math.abs(speed - 30) < 1e-9, `速度应为 100 × 0.3 = 30，实际 ${speed}`);
    }

    //  ④ 持续 3 秒、每档名额 3/4/5、入场生长
    for (const zone of zones) {
        assert.equal(zone.remainingSeconds, 3, '三档统一跑 3 秒');
        assert.equal(zone.maxHits, 3, 'L1 最多打 3 个');
        assert.equal(zone.hitUnitIds?.length, 0);
        assert.equal(zone.holdVisual, true, '整段一条长效视觉（否则逐波闪烁，长不大）');
        assert.equal(zone.growSeconds, 0.3, '由小变大');
    }
});

test('武将技解锁门控：兵种等级没到 12 时，暴风一次都不放', () => {
    //  2026-11-19 反馈「暴风从椰蛋战士位置飞到目标位置，变成直接生成在目标位置」。
    //  根因是两套表打架，不是 `createAttackGroundZones` 的 moving 分支坏了：
    //    · 施放与否由 `pvpSkill` 30707 的 `empoweredEvery: 5` + `empoweredSkillId: 30831` 决定，
    //      **与等级无关** —— 1 级也会放；
    //    · 「三道 / 50° / 100px / 3s / 名额 / 由小变大」却写在 `pvpSkillPlan` 的 100504 上，
    //      三档解锁等级自 2026-11-26 起是 7 / 24 / 36（设计案口径，原 12/24/36）。
    //  等级没到时整条链被 `selectZCSkillPlans` 过滤 ⇒ 参数袋里一个 `zone*` 都没有
    //  ⇒ `moving = zoneMoveSpeed > 0` 退化成 false ⇒ 落回「原地生成」，且不报任何错。
    //  用户口径（2026-11-19）：「没到技能解锁以前不能释放技能」⇒ 门控见
    //  `ZCCompiledModifierLoadout.empoweredLocked` / `ZC_EMPOWERED_LOCK_PARAM`。
    const base = prepare();
    //  前提：6 级时 100504 这条链确实还没解锁（否则本用例测的就不是门控那条路）。
    assert.ok(
        !selectZCSkillPlans('68005', 6).some((row) => row.skillChainId === 100504),
        '前提：6 级时 100504 未解锁',
    );
    for (const [heroLevel, expectedZones, maxHits] of [[6, 0, 0], [7, 3, 3], [36, 3, 5]] as const) {
        const compiled = compileZCCombatBuild({ unitId: '68005', heroLevel }, base.units, getZCModifierCatalogs());
        const runtime = compileZCMatchRuntime({ ...base, modifiers: { player: compiled, enemy: [] } } as never);
        const runtimeDefinition = runtime.skillRuntime[ZCOwner.Player].get('68005:30707');
        assert.ok(runtimeDefinition, `Lv${heroLevel} 必须有 68005:30707 的运行时（否则门控标记无处可挂）`);
        assert.equal(
            runtimeDefinition.parameters[ZC_EMPOWERED_LOCK_PARAM] ?? 0,
            heroLevel < 7 ? 1 : 0,
            `Lv${heroLevel} 的门控标记`,
        );
        //  直接把**真实构筑出来的**参数喂进既有夹具，等于把「表 → 运行时 → 区域」整条链验一遍。
        const harness = stormHarness({
            facingRadians: 0, targetX: 110, targetY: 20, params: runtimeDefinition.parameters,
        });
        ZCAttackResolutionSystem.sendAttack(harness.state, harness.caster, harness.context as never);
        const zones = harness.state.groundZones;
        assert.equal(zones.length, expectedZones, `Lv${heroLevel} 区域道数`);
        //  门控只作废「强化那一击」，普攻计数照常推进（`consumeEmpoweredAttack` 顺手 +1），
        //  否则连击 / 投枪 / 陷阱这些「每 N 次普攻」的链路会一起停摆。
        assert.equal(harness.caster.completedAttackCount, 5, `Lv${heroLevel} 普攻计数照常 +1`);
        for (const zone of zones) {
            assert.equal(zone.x, 10, `Lv${heroLevel} x 必须等于施法者 x`);
            assert.equal(zone.y, 20, `Lv${heroLevel} y 必须等于施法者 y`);
            const speed = Math.hypot(zone.moveVelocityX ?? 0, zone.moveVelocityY ?? 0);
            assert.ok(Math.abs(speed - 30) < 1e-9, `Lv${heroLevel} 速度应为 100 × 0.3 = 30，实际 ${speed}`);
            assert.equal(zone.maxHits, maxHits, `Lv${heroLevel} 名额按等级（${maxHits}）`);
            assert.equal(zone.holdVisual, true, `Lv${heroLevel} 整段持有视觉`);
        }
    }
});

test('暴风：等级决定每个飓风的名额上限（3 / 4 / 5）', () => {
    for (const [level, maxHits] of [[1, 3], [2, 4], [3, 5]] as const) {
        const harness = stormHarness({
            facingRadians: 0, targetX: 110, targetY: 20,
            params: { ...STORM_L1, zoneMaxHits: maxHits, damageRate: [0.8, 1, 1.2][level - 1] },
        });
        ZCAttackResolutionSystem.sendAttack(harness.state, harness.caster, harness.context as never);
        for (const zone of harness.state.groundZones) {
            assert.equal(zone.maxHits, maxHits, `L${level} 每个飓风最多 ${maxHits} 个`);
        }
        assert.equal(harness.state.groundZones.length, 3);
    }
});

test('暴风：一个飓风打满名额只消它自己，另外两个照常飞', () => {
    const enemy = makeUnit(2, 0, 0);
    const at = (x: number, maxHits: number, hitUnitIds: number[]): ZCGroundZoneState => makeZone({
        x, y: 0, radius: 9, maxHits, hitUnitIds,
        remainingSeconds: 5, wavesLeft: 40, nextWaveAt: 0, waveInterval: 0.1,
    });
    const saturated = at(0, 1, []);
    const other = at(400, 1, []);
    const third = at(800, 1, []);
    const state = {
        elapsedSeconds: 0, groundZones: [saturated, other, third],
        combatEvents: [], nextCombatEventId: 1, statusEffects: undefined,
    } as never;
    const view = state as unknown as { groundZones: ZCGroundZoneState[]; elapsedSeconds: number };
    ZCGroundZoneSystem.tick(state as never, 0.05, zoneContext([enemy]) as never);

    assert.equal(saturated.hitUnitIds!.length, 1, '只打到 1 个（就是它名额上限）');
    assert.deepEqual([other.hitUnitIds!.length, third.hitUnitIds!.length], [0, 0],
        '离敌人远的两个不该被记名额');
    assert.equal(view.groundZones.length, 2, '打满的那一道提前消失，另外两道还在');
    assert.equal(view.groundZones.includes(saturated), false);
});

test('暴风：入场生长系数 0 → 1，之后恒 1（纯函数，与 prefab 尺寸解耦）', () => {
    assert.equal(zcCombatEffectGrowFactor(0.3, 0), 0, '刚生成时是 0（由"无"长出来）');
    assert.equal(zcCombatEffectGrowFactor(0.3, 0.15), 0.75, '过半时 ease-out 已经到 75%');
    assert.equal(zcCombatEffectGrowFactor(0.3, 0.3), 1, '到点就是最终大小');
    assert.equal(zcCombatEffectGrowFactor(0.3, 9), 1, '之后恒 1');
    assert.equal(zcCombatEffectGrowFactor(undefined, 0.1), 1, '没配时长 ⇒ 不生长（既有特效逐字不变）');
    assert.equal(zcCombatEffectGrowFactor(0, 0.1), 1);
    //  2026-11-20 第 28 批（三叶小丑飓风）：多一格「起始占比」。缺省 0 ⇒ 老口径逐字不变；
    //  给了 0.1 就是「出生即 10%」，因为缓动本身在 t = 0 时是 0，光有 `growSeconds` 表达不了。
    assert.equal(zcCombatEffectGrowFactor(0.3, 0, 0), 0);
    assert.equal(zcCombatEffectGrowFactor(0.3, 0, 0.1), 0.1, '出生就是 10%');
    assert.equal(zcCombatEffectGrowFactor(0.3, 0.15, 0.1), 0.775, '10% + 90% × ease(0.5)');
    assert.equal(zcCombatEffectGrowFactor(0.3, 0.3, 0.1), 1, '到点仍是满尺寸');
    assert.equal(zcCombatEffectGrowFactor(0.3, 0, 5), 1, '起点占比钳到 1');
    assert.equal(zcCombatEffectGrowFactor(0.3, 9, -3), 1, '负值当 0，之后恒 1');
    assert.equal(zcCombatEffectGrowFactor(undefined, 0, 0.1), 1,
        '时长非法 ⇒ 满尺寸（宁可没有入场，也不能把整片风永久钉在 10%）');
});

test('暴风：生长时长经区域落到那条长效表现事件上', () => {
    const zone = makeZone({
        x: 0, y: 0, radius: 9, moveVelocityX: 30, moveVelocityY: 0,
        hitUnitIds: [], maxHits: 3, remainingSeconds: 3, wavesLeft: 20,
        effectPrefabPath: 'units/projectiles/椰蛋战士_暴风/椰蛋战士_暴风',
        holdVisual: true, growSeconds: 0.3,
    });
    const state = {
        elapsedSeconds: 0, groundZones: [zone], combatEvents: [],
        nextCombatEventId: 1, statusEffects: undefined,
    } as never;
    ZCGroundZoneSystem.tick(state as never, 0.05, zoneContext([]) as never);
    const visuals = (state as unknown as { combatEvents: Array<Record<string, unknown>> }).combatEvents;
    assert.equal(visuals.length, 1, '整段持有 ⇒ 只有一条视觉事件（不是逐波 20 条）');
    assert.equal(visuals[0].growSeconds, 0.3);
    //  2026-11-20：涨落起点是另一格，没配就是 `undefined`（视图按 0 处理）——存量逐字不变。
    assert.equal(visuals[0].growFrom, undefined, '没配起始占比 ⇒ 视图按 0 处理');
    assert.equal(visuals[0].effectPrefabPath, 'units/projectiles/椰蛋战士_暴风/椰蛋战士_暴风');
});
