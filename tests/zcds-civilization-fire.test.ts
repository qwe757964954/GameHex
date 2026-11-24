import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { configureZCMap, ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import type { ZCAttackProfile, ZCDeckBonuses, ZCUnitDefinition } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import type { ZCFloatText, ZCProjectileState, ZCSnapshot, ZCUnitState, ZCGroundZoneState } from '../assets/script/app/zcds/model/ZCGameTypes';
import type { ZCSkillRuntimeDefinition } from '../assets/script/app/zcds/model/ZCSkillRuntime';
import type { ZCUnitStatPatch } from '../assets/script/app/zcds/model/ZCModifierRuntime';
import {
    ZCAttackResolutionSystem, type IZCAttackResolutionContext,
} from '../assets/script/app/zcds/model/systems/ZCAttackResolutionSystem';
import { buildZCVisualResourcePlan } from '../assets/script/app/zcds/model/ZCVisualResourcePlan';
import { resolveUnitDefinition } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { ZC_EFFECT_PATHS } from '../assets/script/app/zcds/model/ZCEffectCatalog';
import { ZC_EFFECT_SCALE } from '../assets/script/app/zcds/model/ZCEffectTuning';
import {
    ZC_FIRE_ZONE_PREFAB_PATH, ZC_FIRE_ZONE_TINT, zcFireZoneEffectPaths,
} from '../assets/script/app/zcds/model/ZCFireZoneFx';
import {
    ZC_RAY_BEAM_PREFAB_PATH, ZC_RAY_BEAM_REFERENCE_HALF_LENGTH, zcRayBeamEffectScale,
} from '../assets/script/app/zcds/model/ZCRayBeamFx';

/**
 * 第 43 批 · 机甲菇 / 科学家三条技能链（2026-11-23）。
 *
 * 用户原话：
 *  1. 「科学家的 射线集束 技能给 机甲菇使用，技能效果不变，直接替换掉机甲菇的菌毯爆发，
 *     机甲菇的菌毯爆发弃用，机甲菇使用的射线颜色和镭射飞龙的普通攻击颜色一致，不需要改成蓝色」；
 *  2. 「机甲菇的 主动技能改成 武器绞杀，技能描述的菌丝也改成 武器」；
 *     （2026-11-24 第 44 批名字又改成「三尖两刃」，见下面 ② 的断言。）
 *  3. 「科学家的原 射线集束 技能改成 文明之火，特效使用灼热地带的特效，改成蓝色的，
 *     在目标位中心点，200px 半径的圆内，生成 3 个火焰区域，每个火焰区域的大小都和灼热地带一致，
 *     持续时间对应 3 个等级 6/8/10 秒，每秒钟造成的伤害为 100%/110%/120%」。
 *
 * 四件事按用户 2026-11-23 的追问确认落地：
 *  · 射线配色 —— **换用镭射飞龙那张红图**（青蓝乘红只能得到暗红，「一致」做不到）；
 *  · 每块区域**各自**按 100/110/120% 结算（不是三块合计）；
 *  · 落点**圆内随机**（面积均匀，`sqrt` 取半径）；
 *  · 触发方式沿用**累计普攻 8 次**（不改成冷却）。
 *
 * 本文件钉住的是「照字面配就会静默出错」的几处：换图后基准半长必须重算、
 * 蓝色不能写进目录（同一个 prefab 被火焰树妖用着）、每块区域必须独立成 zone。
 */

const CLIENT_DIR = 'D:/Alan/Project/POW/doc/塔防数据配置/json/client';

interface ITableRow {
    [key: string]: unknown;
}

function readRows(name: string): ITableRow[] {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        ITableRow[] | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

function readClient(name: string): ITableRow[] {
    const source = JSON.parse(readFileSync(`${CLIENT_DIR}/${name}.json`, 'utf8')) as
        ITableRow[] | { data: ITableRow[] };
    return Array.isArray(source) ? source : source.data;
}

/** 两条产物里同一 (unitId, skillChainId, skillLevel) 的行，逐键比对用。*/
function planRows(name: string, unitId: string, chainId: number): ITableRow[] {
    return name === 'remoteRef'
        ? readRows('pvpSkillPlan').filter((row) => String(row.unitId) === unitId && Number(row.skillChainId) === chainId)
        : readClient('pvpSkillPlan').filter((row) => String(row.unitId) === unitId && Number(row.skillChainId) === chainId);
}

const BOTH = ['remoteRef', 'client'] as const;

/** ⑥ 要跑「配表 → 定义 → 本局清单」这条真链路，得把 pvp 表装进运行时。*/
function pvpTables(): ZCPvpTables {
    return {
        pvpGlobal: readRows('pvpGlobal') as unknown as ZCPvpTables['pvpGlobal'],
        pvpArtifact: readRows('pvpArtifact'),
        pvpCard: readRows('pvpCard'),
        pvpSkill: readRows('pvpSkill'),
        pvpCounter: readRows('pvpCounter'),
        pvpBond: readRows('pvpBond'),
        pvpTile: readRows('pvpTile'),
        pvpPity: readRows('pvpPity'),
        pvpTileGen: readRows('pvpTileGen'),
        pvpTileGenParams: readRows('pvpTileGenParams') as unknown as ZCPvpTables['pvpTileGenParams'],
    };
}

loadPvpTables(pvpTables());
//  ⑧⑨ 的 `castFireZone` 只碰目标点与地图几何，装一张真地图免得几何取到空表。
configureZCMap(JSON.parse(readFileSync('tests/fixtures/zcds-legacy-map.json', 'utf8')) as never);

// ────────────────────────────────────────────── 一、配表真值（两份产物）

test('① 机甲菇 101504 = 射线集束（ray_beam），三级参数与科学家改造前逐键一致', () => {
    //  用户：「技能效果不变」。改造前 103503 的值抄在这里 —— 任何人动歪了这条先红。
    const EXPECTED = [
        { level: 1, params: { rayEvery: 8, rayHalfLength: 120, rayHalfWidth: 36, rayForward: 30, raySeconds: 2, rayInterval: 0.2, rayDamageRate: 0.2, rayVulnPct: 0 } },
        { level: 2, params: { rayEvery: 8, rayHalfLength: 120, rayHalfWidth: 36, rayForward: 30, raySeconds: 3, rayInterval: 0.2, rayDamageRate: 0.25, rayVulnPct: 10, rayVulnSeconds: 0.3 } },
        { level: 3, params: { rayEvery: 8, rayHalfLength: 120, rayHalfWidth: 36, rayForward: 30, raySeconds: 4, rayInterval: 0.2, rayDamageRate: 0.35, rayVulnPct: 20, rayVulnSeconds: 0.3, raySpotRadius: 60, raySpotDamageRate: 0.5 } },
    ];
    for (const source of BOTH) {
        const rows = planRows(source, '68015', 101504);
        assert.equal(rows.length, 3, `${source} 68015/101504 应有三档`);
        for (const expected of EXPECTED) {
            const row = rows.find((entry) => Number(entry.skillLevel) === expected.level);
            assert.ok(row, `${source} 缺 101504 L${expected.level}`);
            assert.equal(row!.skillName, '射线集束', `${source} 101504 L${expected.level} 名字`);
            assert.equal(row!.behaviorKey, 'ray_beam', `${source} 101504 L${expected.level} 车道`);
            assert.deepEqual(
                JSON.parse(String(row!.skillParamJson)),
                expected.params,
                `${source} 101504 L${expected.level} 参数与改造前的 103503 不一致（「技能效果不变」被破坏）`,
            );
            assert.match(String(row!.desc), /集束射线/, `${source} 101504 L${expected.level} 描述`);
        }
    }
    //  菌毯爆发彻底弃用：它的车道不该再挂在机甲菇身上。
    for (const source of BOTH) {
        const rows = planRows(source, '68015', 101504);
        assert.equal(rows.some((row) => row.behaviorKey === 'burst_aura'), false,
            `${source} 101504 还挂着 burst_aura（菌毯爆发没弃用）`);
    }
});

test('② 机甲菇 101503 = 三尖两刃：描述一个字都不许再提「菌丝」，参数三个档位不变', () => {
    for (const source of BOTH) {
        const rows = planRows(source, '68015', 101503);
        assert.equal(rows.length, 3, `${source} 68015/101503 应有三档`);
        for (const row of rows) {
            assert.equal(row.skillName, '三尖两刃', `${source} 101503 名字`);
            assert.equal(row.behaviorKey, 'fan_slow', `${source} 101503 车道不该变`);
            assert.equal(String(row.desc).includes('菌丝'), false, `${source} 101503 描述里还有「菌丝」`);
            assert.match(String(row.desc), /扇形甩出武器/, `${source} 101503 描述`);
            const params = JSON.parse(String(row.skillParamJson));
            assert.equal(params.fanAngle, 120, `${source} 101503 的扇形角度被改了`);
            assert.equal(params.fanRadius, 150, `${source} 101503 的半径被改了`);
        }
        //  K 表（卡牌 UI 真读）也要跟着改，否则面板写的还是「菌丝」。
        const levels = readClient('armySkillLevelUp').filter((row) => Number(row.id) === 101503);
        assert.equal(levels.length, 3, 'armySkillLevelUp 101503 应有三档');
        for (const row of levels) {
            assert.equal(row.name, '三尖两刃');
            assert.equal(String(row.desc).includes('菌丝'), false, 'K 表 101503 描述里还有「菌丝」');
        }
    }
});

test('③ 科学家 103503 = 文明之火（fire_zone）：3 块 / 200 散布 / 60 半径 / 6-8-10 秒 / 100-110-120%', () => {
    const EXPECTED = [
        { level: 1, seconds: 6, rate: 1 },
        { level: 2, seconds: 8, rate: 1.1 },
        { level: 3, seconds: 10, rate: 1.2 },
    ];
    for (const source of BOTH) {
        const rows = planRows(source, '68035', 103503);
        assert.equal(rows.length, 3, `${source} 68035/103503 应有三档`);
        for (const expected of EXPECTED) {
            const row = rows.find((entry) => Number(entry.skillLevel) === expected.level);
            assert.ok(row, `${source} 缺 103503 L${expected.level}`);
            assert.equal(row!.skillName, '文明之火');
            assert.equal(row!.behaviorKey, 'fire_zone', `${source} 103503 车道不是 fire_zone`);
            const params = JSON.parse(String(row!.skillParamJson));
            assert.equal(params.fireCount, 3, '火焰区域数量');
            assert.equal(params.fireSpreadRadius, 200, '散布半径');
            assert.equal(params.fireRadius, 60, '每块区域半径必须与灼热地带一致');
            assert.equal(params.fireSeconds, expected.seconds, `L${expected.level} 持续秒数`);
            assert.equal(params.fireDamageRate, expected.rate, `L${expected.level} 每秒倍率`);
            assert.equal(params.fireEvery, 8, '触发方式沿用累计普攻 8 次');
        }
        //  灼热地带自己的行不许被顺手改掉（同一张图、另一种颜色）。
        const hot = readClient('armySkillLevelUp').filter((row) => Number(row.id) === 100304);
        assert.equal(hot.length, 3, '灼热地带 100304 的三档不该丢');
        assert.match(String(hot[0].desc), /灼热地带/, '灼热地带的描述被改了');
    }
});

// ────────────────────────────────────────────── 二、表现：换图 / 蓝色 / 基准半长

test('④ 射线集束换镭射飞龙那张红图，基准半长按新图重算（否则光束长度对不上判定）', () => {
    assert.equal(ZC_RAY_BEAM_PREFAB_PATH, ZC_EFFECT_PATHS.laserAttack,
        '射线集束仍用【雷电冲击】—— 用户要的是「和镭射飞龙普攻颜色一致」');
    assert.equal(ZC_RAY_BEAM_REFERENCE_HALF_LENGTH, 374,
        '基准半长没按镭射飞龙重算：可见宽 575 × 1 / 0.76875 / 2 ≈ 374');
    assert.equal(ZC_RAY_BEAM_REFERENCE_HALF_LENGTH, ZC_EFFECT_SCALE.rayBeamReferenceHalfLength,
        'facade 和调参表必须同源（重复写一遍迟早漂）');
    //  表值 120 半长 ⇒ 缩放 120/374；这个数变了意味着「画面比判定长/短」。
    assert.ok(Math.abs(zcRayBeamEffectScale(120) - 120 / 374) < 1e-12);
    assert.equal(zcRayBeamEffectScale(0), 1, '非法半长要退回 1');
});

test('⑤ 文明之火用灼热地带那张图，但蓝色只按事件染（目录不能登记路径色）', () => {
    assert.equal(ZC_FIRE_ZONE_PREFAB_PATH, ZC_EFFECT_PATHS.hotZone);
    //  🔴 同一个 prefab 被火焰树妖 68003 自己的灼热地带（30811）用着 ⇒ 路径色一旦登记，
    //  那边也会变蓝。所以蓝色必须走 `ZC_FIRE_ZONE_TINT` + 事件级 tint。
    const [red, green, blue] = ZC_FIRE_ZONE_TINT;
    assert.ok(blue > red && blue > green, `蓝色不够蓝：${ZC_FIRE_ZONE_TINT.join(',')}`);
    assert.equal(red < 120, true, '红通道没压下去，原图的紫品红会留着');
});

test('⑥ 资源清单：文明之火收灼热地带那张图，射线集束收镭射飞龙', () => {
    assert.deepEqual([...zcFireZoneEffectPaths('fire_zone')], [ZC_EFFECT_PATHS.hotZone]);
    assert.deepEqual([...zcFireZoneEffectPaths('ray_beam')], [], '不是这条车道就该返回空');

    //  按真定义跑一遍「配表 → 定义 → 本局清单」：配表填了但清单没收到 = 编辑器里看得见、实战一片空白。
    const plan = (unitId: string, behaviorKey: string) => ({ enabled: true, unitId, behaviorKey });
    const adapters = (plans: Array<{ enabled: boolean; unitId: string; behaviorKey: string }>) => ({
        skillPlans: plans, textOverrides: new Map(),
    });
    const sci = buildZCVisualResourcePlan(
        [resolveUnitDefinition('68035')], adapters([plan('68035', 'fire_zone')]));
    assert.ok(sci.effectPaths.includes(ZC_EFFECT_PATHS.hotZone), '文明之火的火焰图没进本局清单');

    const mech = buildZCVisualResourcePlan(
        [resolveUnitDefinition('68015')], adapters([plan('68015', 'ray_beam')]));
    assert.ok(mech.effectPaths.includes(ZC_EFFECT_PATHS.laserAttack), '射线集束的红图没进本局清单');
});

// ────────────────────────────────────────────── 三、castFireZone 行为

const SCI_ATTACK = 30709;
const FIRE_PARAMS = {
    fireEvery: 8, fireCount: 3, fireSpreadRadius: 200, fireRadius: 60,
    fireSeconds: 10, fireInterval: 1, fireDamageRate: 1.2,
};

const DEFINITION = {
    unitId: '68035', name: '科学家', maxHp: 1200, attack: 100,
    moveSpeed: 0, attackSpeed: 500, attackRange: 500, attackInterval: 1.8,
    attackDuration: 0.667, attackHitTime: 0.345, bodyRadius: 6, spawnSeconds: 0,
    flying: false, canAttackAir: true, hero: true, prefabPath: '', prefabSize: 1,
    attackProfile: {
        skillId: SCI_ATTACK, name: '科学家普攻', mode: 'projectile',
        projectileSpeed: 800, areaRadius: 0, damageRate: 1, trigger: 'every_seconds',
        empoweredEvery: 0, empoweredSkillId: 0, secondarySkillId: 0,
        durationSeconds: 0, waves: 1, legacyEffectKeys: [],
        effectPrefabPath: 'units/projectiles/科学家_普攻/科学家_普攻',
        impactEffectPrefabPath: null,
    } satisfies ZCAttackProfile,
    empoweredProfile: undefined,
    secondaryProfile: undefined,
} as unknown as ZCUnitDefinition;

function makeUnit(id: number, owner: ZCOwner, x: number): ZCUnitState {
    return {
        id, owner, unitId: '68035', cardId: String(id), tier: 1,
        sourceHexId: 0, targetHexId: null, progress: 0,
        hp: 1000, maxHp: 1000, battleState: 'idle', stateTime: 0,
        targetUnitId: null, targetWallHexId: null, targetBuildingHexId: null,
        nextAttackAt: 0, waitUntil: 0, attackHitDone: false,
        hatredUnitId: null, hatredUntil: 0, facingRadians: 0, deathRemoveAt: 0,
        marchAngle: null, freeX: x, freeY: 0, completedAttackCount: 0,
    } as unknown as ZCUnitState;
}

function makeState(units: ZCUnitState[]): ZCSnapshot {
    return {
        version: 4, elapsedSeconds: 0, durationSeconds: 300,
        playerGold: 0, enemyGold: 0, artifactReadyUses: 0, artifactCharge: 0,
        artifactCooldown: 0, enemyFrozenSeconds: 0, status: 'running', resultReason: '',
        hexes: [], units, nextUnitId: units.length + 1,
        incomeClock: 0, aiClock: 0, towerClock: 0, spawnClocks: {},
        drawCursor: perOwnerBoost(), allRandomNonGoldDraws: perOwnerBoost(),
        builtTypeCounts: { player: {}, enemy: {}, enemy2: {}, enemy3: {} },
        combatEvents: [], projectiles: [], nextCombatEventId: 1, groundZones: [],
        statusEffects: { nextUid: 1, units: [] },
    } as unknown as ZCSnapshot;
}

function perOwnerBoost(): Record<string, number> {
    return { player: 0, enemy: 0, enemy2: 0, enemy3: 0 };
}

function castContext(
    units: ZCUnitState[],
    params: Record<string, number>,
    target: { id: number; x: number; y: number } | null,
    randomValues: number[] = [0.25, 0.5],
): IZCAttackResolutionContext {
    let cursor = 0;
    const runtime = {
        skillChainId: 103503, behaviorKey: 'fire_zone', trigger: 'none', stateMode: 'none',
        parameters: { ...params },
    } as unknown as ZCSkillRuntimeDefinition;
    const map = new Map<string, ZCSkillRuntimeDefinition>([[`68035:${SCI_ATTACK}`, runtime]]);
    return {
        rules: {
            combatDistanceScale: 0.3, combatDamageMultiplier: 1, unitAttackPerTier: 0,
            counterDamageMultiplier: 1,
        } as IZCAttackResolutionContext['rules'],
        statusSystem: { statModsOf: () => ({}) } as unknown as IZCAttackResolutionContext['statusSystem'],
        geometry: { hexIdAt: () => 0 } as unknown as IZCAttackResolutionContext['geometry'],
        //  固定序列：第一次取角度、第二次取半径 —— 断言落点可复现。
        random: () => randomValues[cursor++ % randomValues.length],
        effectiveDefinition: () => DEFINITION,
        unitPosition: (unit: ZCUnitState) => ({ x: unit.freeX, y: unit.freeY }),
        damageUnit: () => ({ value: 0, kind: 'damage', x: 0, y: 0 }) as unknown as ZCFloatText,
        counters: [],
        cards: { player: new Map(), enemy: new Map() },
        skillRuntime: {
            player: map, enemy: new Map(), enemy2: new Map(), enemy3: new Map(),
        } as unknown as IZCAttackResolutionContext['skillRuntime'],
        statPatches: { player: new Map<string, ZCUnitStatPatch>(), enemy: new Map(), enemy2: new Map(), enemy3: new Map() },
        deckBonuses: {
            player: emptyDeck(), enemy: emptyDeck(), enemy2: emptyDeck(), enemy3: emptyDeck(),
        } as unknown as IZCAttackResolutionContext['deckBonuses'],
        unitById: new Map(units.map((unit) => [unit.id, unit])),
        currentTarget: () => (target
            ? { kind: 'unit', id: target.id, x: target.x, y: target.y, bodyRadius: 24, cardId: '68001' }
            : null),
        evaluateLegacySkill: () => ({ buffs: [], hitCount: 0, hasDamageFormula: false, damage: 0 }),
        applyLegacySelfBuffs: () => [],
        tryExecuteUnit: () => undefined,
        applyHitStatus: () => undefined,
        applyLegacyBuffs: () => undefined,
        damageWall: () => undefined,
        damageBuilding: () => undefined,
        unitsInRadius: () => units,
        healUnit: () => undefined,
        applyKnockback: () => undefined,
        pushProjectile: (_: ZCProjectileState) => undefined,
    } as unknown as IZCAttackResolutionContext;
}

function emptyDeck(): ZCDeckBonuses {
    return {
        activeBonds: [], unitHpMultiplier: 1, unitAttackMultiplier: 1,
        moveSpeedMultiplier: 1, towerAttackMultiplier: 1, incomeBonus: 0,
        spawnIntervalMultiplier: 1,
    };
}

test('⑦ castFireZone：3 块独立区域，半径 60×0.3、落点圆内、每块各自结算', () => {
    const caster = makeUnit(1, ZCOwner.Player, 0);
    const enemy = makeUnit(2, ZCOwner.Enemy, 100);
    const units = [caster, enemy];
    const state = makeState(units);
    const context = castContext(units, FIRE_PARAMS, { id: enemy.id, x: 100, y: 0 });

    const ok = ZCAttackResolutionSystem.castFireZone(state, caster, context);
    assert.equal(ok, true, '参数齐全时应撒下区域');
    assert.equal(state.groundZones.length, 3, '必须是 3 块独立区域（不是 1 块记 3 份伤害）');

    for (const zone of state.groundZones as ZCGroundZoneState[]) {
        assert.equal(zone.radius, 60 * 0.3, '每块半径 = 灼热地带 60 表值 × 0.3');
        assert.equal(zone.effectPrefabPath, ZC_EFFECT_PATHS.hotZone, '用灼热地带那张图');
        assert.deepEqual(zone.tint, [ZC_FIRE_ZONE_TINT[0], ZC_FIRE_ZONE_TINT[1], ZC_FIRE_ZONE_TINT[2]],
            '蓝色必须跟着区域走（同一张图在火焰树妖那边仍是紫）');
        assert.equal(zone.remainingSeconds, 10, 'L3 持续 10 秒');
        assert.equal(zone.wavesLeft, 10, '每秒 1 跳 ⇒ 10 跳');
        assert.equal(zone.waveInterval, 1);
        assert.equal(zone.damage, 120, '面板 100 × 120% = 120/跳/块');
        assert.equal(zone.holdVisual, true, '整段一条长效表现（否则每秒叠一条事件）');
        //  落点必须在目标点 200 表值（×0.3 = 60 世界 px）的圆内。
        const distance = Math.hypot(zone.x - 100, zone.y - 0);
        assert.ok(distance <= 60 + 1e-9, `区域落点 ${distance.toFixed(2)} 超出了 200px 半径`);
    }
});

test('⑧ castFireZone：L1 参数 ⇒ 6 秒 6 跳、每跳 100%；参数不全 ⇒ 不撒、返回 false', () => {
    const caster = makeUnit(1, ZCOwner.Player, 0);
    const enemy = makeUnit(2, ZCOwner.Enemy, 100);
    const units = [caster, enemy];
    const l1 = { ...FIRE_PARAMS, fireSeconds: 6, fireDamageRate: 1 };

    const state = makeState(units);
    const context = castContext(units, l1, { id: enemy.id, x: 100, y: 0 });
    assert.equal(ZCAttackResolutionSystem.castFireZone(state, caster, context), true);
    assert.equal(state.groundZones.length, 3);
    assert.equal(state.groundZones[0].remainingSeconds, 6);
    assert.equal(state.groundZones[0].wavesLeft, 6);
    assert.equal(state.groundZones[0].damage, 100);

    //  参数不全（块数 0）⇒ 拒绝，调用方不消费次数。
    const bad = makeState(units);
    const badContext = castContext(units, { ...FIRE_PARAMS, fireCount: 0 }, { id: enemy.id, x: 100, y: 0 });
    assert.equal(ZCAttackResolutionSystem.castFireZone(bad, caster, badContext), false);
    assert.equal(bad.groundZones.length, 0, '参数不全时不许留下半块区域');

    //  没有目标 ⇒ 也没有落点。
    const noTarget = makeState(units);
    const noTargetContext = castContext(units, FIRE_PARAMS, null);
    assert.equal(ZCAttackResolutionSystem.castFireZone(noTarget, caster, noTargetContext), false);
});

test('⑨ 文明之火不读射线集束的键：ray* 全空也能跑，fire* 缺失才拒', () => {
    const caster = makeUnit(1, ZCOwner.Player, 0);
    const enemy = makeUnit(2, ZCOwner.Enemy, 100);
    const units = [caster, enemy];

    //  袋里只有 ray*（配置漏改的典型形态）⇒ 必须拒，而不是撒出 0 半径的区域。
    const state = makeState(units);
    const rayOnly = castContext(units, { rayEvery: 8, rayHalfLength: 120 }, { id: enemy.id, x: 100, y: 0 });
    assert.equal(ZCAttackResolutionSystem.castFireZone(state, caster, rayOnly), false);
    assert.equal(state.groundZones.length, 0);
});
