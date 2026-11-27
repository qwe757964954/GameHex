import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import type { ZCSnapshot } from '../assets/script/app/zcds/model/ZCGameTypes';
import {
    ZC_SKILL_RANGE_RING_PREFAB_PATH, ZC_SKILL_RANGE_RING_REFERENCE_RADIUS,
    ZC_SKILL_RANGE_RING_UNITS, pushSkillRangeRingEvent, zcRangeRingEnabledForUnit,
    zcRangeRingPathsForUnit, zcSkillRangeRingScale,
} from '../assets/script/app/zcds/model/ZCSkillRangeRingFx';
import { ZC_EFFECT_SCALE } from '../assets/script/app/zcds/model/ZCEffectTuning';
import { ZC_CHAIN_SCREEN_PER_WORLD } from '../assets/script/app/zcds/model/ZCChainLightningFx';
import { buildZCVisualResourcePlan } from '../assets/script/app/zcds/model/ZCVisualResourcePlan';
import { assetPath } from './helpers/asset-paths';

/**
 * 第 45 批 · 技能范围「白环」（2026-11-25）。
 *
 * 用户口径原文：
 *   「描绘一个白色的椭圆描，边缘微亮，中间是 35% 的透明区域，用来标识技能的实际范围，
 *     椭圆和实际范围一样大，一直到技能的持续时间结束才消失」。
 *
 * 这一批有三个「照直觉写就会静默错」的点，正是本用例要钉住的：
 *
 *  1. **椭圆不是美术随手画的**。逻辑 → 视图横纵比例不同（横 2.5625、纵 2.142857），
 *     地面上「半径 R 的圆」在屏上天然是半轴比 0.8361 的椭圆。代码侧只给一个**等比**
 *     `effectScale`，再自己乘一次纵向系数就是二次压扁 —— 圈看起来比判定小一圈。
 *  2. **尺寸只走事件级 `effectScale`**。`area` 类地面特效从不按 `event.radius` 缩放（§43），
 *     所以「圈 = 判定范围」全靠 {@link zcSkillRangeRingScale} 把半径算准。
 *  3. **寿命必须等于技能持续时间**。`durationSeconds` 写短了圈会提前消失，
 *     写死一个常量则「冰山陨落 2s / 篮球火 3s」里必有一条对不上。
 */

const ROOT = process.cwd();
const BUILDER = join(ROOT, 'tools/build_range_ring_fx.py');
const MODEL_DIR = join(ROOT, 'assets/script/app/zcds/model');

/** 读 remoteRef 的列存表（`{k,v}` ⇒ 行对象）。*/
function readRows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

/** 读生成脚本里的模块级常量（数值真源在这一份，测试不再抄第二遍）。*/
function builderNumber(name: string): number {
    const source = readFileSync(BUILDER, 'utf8');
    //  右侧可能是纯数字，也可能是 `round(255 * 0.35)` 这类简单算式 —— 一起算掉，
    //  否则「脚本里改成算出来的值」时测试会假装常量不存在（比算错更难查）。
    const match = new RegExp(`^${name}\\s*=\\s*([^#\\n]+)`, 'm').exec(source);
    assert.ok(match, `tools/build_range_ring_fx.py 里找不到常量 ${name}`);
    const expression = match![1].trim().replace(/\bround\(/g, 'Math.round(');
    const value = Number(new Function(`return ${expression};`)());
    assert.ok(Number.isFinite(value), `${name} 的表达式算不出数：${expression}`);
    return value;
}

function makeState(elapsedSeconds = 0): ZCSnapshot {
    return {
        version: 4, elapsedSeconds, durationSeconds: 300,
        playerGold: 0, enemyGold: 0, artifactReadyUses: 0, artifactCharge: 0,
        artifactCooldown: 0, enemyFrozenSeconds: 0, status: 'running', resultReason: '',
        hexes: [], units: [], nextUnitId: 1,
        incomeClock: 0, aiClock: 0, towerClock: 0, spawnClocks: {},
        drawCursor: { player: 0, enemy: 0 }, allRandomNonGoldDraws: { player: 0, enemy: 0 },
        builtTypeCounts: { player: {}, enemy: {} },
        combatEvents: [], projectiles: [], nextCombatEventId: 1, groundZones: [],
        statusEffects: { nextUid: 1, units: [] },
    } as unknown as ZCSnapshot;
}

// ────────────────────────────────────────────── 一、prefab 的几何与透明度

test('白环 prefab：画布留出辉光余量，半轴比 = 地面透视 0.8361', () => {
    const semiX = builderNumber('SEMI_X');
    const pad = builderNumber('PAD');
    const glow = builderNumber('GLOW_BLUR');
    //  SEMI_Y 在脚本里是**算出来的**（round(SEMI_X × 纵/横)），不是又一个魔法数。
    const semiY = Math.round(semiX * 2.142857 / ZC_CHAIN_SCREEN_PER_WORLD);
    assert.equal(semiY, 214, '纵向半轴必须由透视比推出来');

    const prefab = JSON.parse(readFileSync(
        assetPath(`${ZC_SKILL_RANGE_RING_PREFAB_PATH}.prefab`), 'utf8')) as Array<Record<string, unknown>>;
    const transform = prefab.find((item) => item.__type__ === 'cc.UITransform');
    assert.ok(transform, 'prefab 里没有 UITransform');
    const size = transform!._contentSize as { width: number; height: number };
    assert.equal(size.width, semiX * 2 + pad * 2, `画布宽应为 ${semiX * 2 + pad * 2}，实际 ${size.width}`);
    assert.equal(size.height, semiY * 2 + pad * 2, `画布高应为 ${semiY * 2 + pad * 2}，实际 ${size.height}`);

    //  🔴 描边是 4px，辉光向外扩 `GLOW_BLUR`。内边距小于辉光半径时，最亮的那圈会被画布切掉 ——
    //  实测观感从「边缘微亮」变成「硬切一刀」，而且截图里几乎看不出来，只能靠这条守卫。
    assert.ok(pad > glow, `PAD(${pad}) 必须大于 GLOW_BLUR(${glow})，否则外扩辉光被裁`);

    //  代码侧基准半径必须与画布一致：两边各写一个数，迟早对不上（差 2px 肉眼看不出来，圈就是错的）。
    assert.equal(semiX, ZC_SKILL_RANGE_RING_REFERENCE_RADIUS);
});

test('白环：中心填充 35% 不透明，不是「中间挖空」', () => {
    const alpha = builderNumber('FILL_ALPHA');
    assert.ok(Math.abs(alpha / 255 - 0.35) < 0.01, `填充不透明度应为 35%，实际 ${(alpha / 255 * 100).toFixed(1)}%`);
    //  用户原话「中间是 35% 的透明区域」已澄清为「不透明度 35%（推荐）」——
    //  反向理解（中间挖空 65%）会让圈看起来像一圈空气，技能范围反而更难读。
    assert.ok(alpha > 0, '中心必须填色；填 0 = 只剩描边');
});

// ────────────────────────────────────────────── 二、尺寸只走 effectScale

test('zcSkillRangeRingScale：屏上横向半径 = 逻辑半径 × 0.76875', () => {
    for (const logicRadius of [60, 110, 150, 190, 366.6666667]) {
        const scale = zcSkillRangeRingScale(logicRadius);
        const screenRadius = scale * ZC_SKILL_RANGE_RING_REFERENCE_RADIUS;
        assert.ok(Math.abs(screenRadius - logicRadius * ZC_EFFECT_SCALE.screenPxPerLogic) < 1e-6,
            `逻辑 ${logicRadius} 应换算成 ${(logicRadius * ZC_EFFECT_SCALE.screenPxPerLogic).toFixed(2)} 屏上 px，`
            + `实际 ${screenRadius.toFixed(2)}`);
    }
    //  非法值不许把 NaN 送进节点缩放（整层矩阵会变 NaN，届时是「整屏特效全没了」）。
    assert.equal(zcSkillRangeRingScale(0), 1);
    assert.equal(zcSkillRangeRingScale(-1), 1);
    assert.equal(zcSkillRangeRingScale(Number.NaN), 1);
});

// ────────────────────────────────────────────── 三、按单位登记 + 资源清单

test('只有三张卡画圈，其余单位零新增资源', () => {
    assert.deepEqual([...ZC_SKILL_RANGE_RING_UNITS], ['68008', '68024', '68030']);
    for (const unitId of ZC_SKILL_RANGE_RING_UNITS) {
        assert.equal(zcRangeRingEnabledForUnit(unitId), true, `${unitId} 应该画圈`);
        assert.deepEqual([...zcRangeRingPathsForUnit(unitId)], [ZC_SKILL_RANGE_RING_PREFAB_PATH]);
    }
    for (const unitId of ['68001', '68015', '68014']) {
        assert.equal(zcRangeRingEnabledForUnit(unitId), false, `${unitId} 不该被这张表收进来`);
        assert.deepEqual([...zcRangeRingPathsForUnit(unitId)], [], '名单外的卡一个资源都不许多收');
    }
    assert.equal(zcRangeRingEnabledForUnit(null), false);
    assert.equal(zcRangeRingEnabledForUnit(undefined), false);
});

test('资源清单：三张卡收白环，其它卡不收', () => {
    const unit = (unitId: string) => ({ unitId, attackProfile: { effectPrefabPath: null, impactEffectPrefabPath: null } });
    const plan = (unitId: string, behaviorKey: string) => ({ enabled: true, unitId, behaviorKey });
    const withRing = buildZCVisualResourcePlan(
        [unit('68008'), unit('68024'), unit('68030')],
        {
            skillPlans: [
                plan('68008', 'random_strike'), plan('68024', 'self_aura'), plan('68030', 'skill_params'),
            ],
            textOverrides: new Map(),
        },
    );
    //  白环没有 behaviorKey 可挂（它是「表现层附加物」），只能按单位表收 ——
    //  漏收的后果是「结算照常、屏幕上没有圈」，而日志里一个字都不会报。
    assert.ok(withRing.effectPaths.includes(ZC_SKILL_RANGE_RING_PREFAB_PATH), '三张卡的白环必须进本局清单');
    const without = buildZCVisualResourcePlan(
        [unit('68001')], { skillPlans: [plan('68001', 'splash_shot')], textOverrides: new Map() });
    assert.equal(without.effectPaths.includes(ZC_SKILL_RANGE_RING_PREFAB_PATH), false);
});

test('三张卡的圈按各自表值半径算：210 / 120 / 110，一个都不许退成基准 256', () => {
    const planRows = readRows('pvpSkillPlan');
    const landedParams = (unitId: string, behaviorKey: string) => planRows
        .filter((row) => String(row.unitId) === unitId && row.behaviorKey === behaviorKey)
        .map((row) => JSON.parse(String(row.skillParamJson)) as Record<string, number>);

    //  戈壁狂箭 68008：`random_strike` 的砸击半径（三档同值，改档只改次数/倍率）。
    assert.deepEqual([...new Set(landedParams('68008', 'random_strike').map((item) => item.strikeRadius))], [210]);
    //  冰山陨落 68024：`self_aura` 的冰域半径。
    assert.deepEqual([...new Set(landedParams('68024', 'self_aura').map((item) => item.auraRadius))], [120]);
    //  篮球火 68030：判定住在 pvpSkill 行里（`area` 车道），第 45 批按设计案改回 110 / 3 秒。
    const click = readRows('pvpSkill').filter((row) => Number(row.skillId) === 30848);
    assert.equal(click.length, 1);
    assert.equal(Number(click[0].areaRadius), 110, '设计案：220p 为直径 ⇒ 半径 110');
    assert.equal(Number(click[0].durationSeconds), 3, '设计案：技能持续 3s');
    //  篮子三档的参数袋里不许再有 `zoneSelfCentered` —— 那是「自身圆心」的口径，
    //  留着的话圈会画在施法者脚下，而判定（设计案「以目标为圆心」）在目标身上。
    for (const params of landedParams('68030', 'skill_params')) {
        assert.equal('zoneSelfCentered' in params, false, '篮球火不许再自带中心');
    }

    const radii = [210, 120, Number(click[0].areaRadius)];
    for (const logicRadius of radii) {
        const scale = zcSkillRangeRingScale(logicRadius);
        //  退 1 = 圈画成基准 256 屏上 px（按 110 算应该只有 84.6）—— 大三倍，且不会报错。
        assert.notEqual(scale, 1, `逻辑半径 ${logicRadius} 取不到时会让圈退成基准大小`);
        assert.ok(Math.abs(scale - logicRadius * ZC_EFFECT_SCALE.screenPxPerLogic / ZC_SKILL_RANGE_RING_REFERENCE_RADIUS) < 1e-9);
    }
    //  三张卡的圈必须彼此不同：都按一个数画，说明半径没走各自的表值。
    assert.equal(new Set(radii.map((r) => zcSkillRangeRingScale(r).toFixed(4))).size, 3);
});

// ────────────────────────────────────────────── 四、事件语义

test('范围圈事件：纯表现、圆形落在判定圆心、寿命 = 技能持续秒数', () => {
    const state = makeState(4.5);
    assert.equal(pushSkillRangeRingEvent(state, {
        x: 12, y: -8, logicRadius: 110, worldRadius: 33, seconds: 3,
        owner: ZCOwner.Player, sourceUnitId: 7, skillId: 30848, skillName: '篮球火',
    }), true);
    assert.equal(state.combatEvents.length, 1);
    const [event] = state.combatEvents;
    assert.equal(event.type, 'area');
    assert.equal(event.effectPrefabPath, ZC_SKILL_RANGE_RING_PREFAB_PATH);
    //  🔴 圈只负责「让人看见」，伤害一律由原链结算；写个非 0 就等于给技能白送一次群伤。
    assert.equal(event.damage, 0);
    assert.equal(event.fromX, 12);
    assert.equal(event.fromY, -8);
    //  圆心两端同点：这是个定点标记，不是「从 A 飞到 B」。
    assert.equal(event.toX, 12);
    assert.equal(event.toY, -8);
    //  `radius` 是判定半径（世界 px），只作诊断 —— `area` 从不按它缩放。
    assert.equal(event.radius, 33);
    assert.ok(Math.abs(Number(event.effectScale) - zcSkillRangeRingScale(110)) < 1e-9);
    //  寿命：一帧都不能短（用户要「一直到技能的持续时间结束才消失」）。
    assert.equal(event.durationSeconds, 3);
    assert.equal(event.startedAt, 4.5);
});

test('同单位窗口内不叠圈；过期后可再画', () => {
    const state = makeState(0);
    const push = (seconds: number) => pushSkillRangeRingEvent(state, {
        x: 0, y: 0, logicRadius: 150, worldRadius: 45, seconds,
        owner: ZCOwner.Player, sourceUnitId: 3, skillId: 30717, skillName: '戈壁狂箭',
    });
    assert.equal(push(2), true);
    //  戈壁狂箭在持续窗口内会反复开火，每次都推一条就会叠出「年轮」——一圈比一圈亮。
    state.elapsedSeconds = 1.9;
    assert.equal(push(2), false, '窗口没结束 ⇒ 不重建');
    assert.equal(state.combatEvents.length, 1);
    //  过期后允许再画（新的那一发确实换了位置）。
    state.elapsedSeconds = 2.1;
    assert.equal(push(2), true);
    assert.equal(state.combatEvents.length, 2);
    //  换个单位互不影响：两条圈各有各的主人。
    assert.equal(pushSkillRangeRingEvent(state, {
        x: 0, y: 0, logicRadius: 150, worldRadius: 45, seconds: 2,
        owner: ZCOwner.Enemy, sourceUnitId: 4, skillId: 30717, skillName: '戈壁狂箭',
    }), true);
});

test('非法入参不推事件（不许把 NaN 送进节点矩阵）', () => {
    const state = makeState(0);
    const base = {
        x: 0, y: 0, logicRadius: 150, worldRadius: 45, seconds: 2,
        owner: ZCOwner.Player, sourceUnitId: 1, skillId: 1, skillName: 'x',
    };
    assert.equal(pushSkillRangeRingEvent(state, { ...base, x: Number.NaN }), false);
    assert.equal(pushSkillRangeRingEvent(state, { ...base, logicRadius: 0 }), false);
    assert.equal(pushSkillRangeRingEvent(state, { ...base, seconds: 0 }), false);
    assert.equal(state.combatEvents.length, 0);
});

// ────────────────────────────────────────────── 五、三处调用点登记

test('三条技能链都必须真的推圈（漏一处 = 那张卡屏幕上没有范围提示）', () => {
    const guard = /zcRangeRingEnabledForUnit\(unit\.unitId\)/;
    const call = /pushSkillRangeRingEvent\(/;
    const expectations: Array<[string, string]> = [
        //  戈壁狂箭 68008：「蓄力窗口内先画出它将要打到的范围」，窗口挂起两处都要推。
        ['systems/ZCSkillTriggerSystem.ts', '累计普攻 / 冷却两种窗口挂起'],
        //  冰山陨落 68024：`castSelfAura` 落完区域之后。
        ['systems/ZCSkillResolutionSystem.ts', 'self_aura 落区域'],
        //  篮球火 68030：`createAttackGroundZones` 落区域之后（坐标与区域共用同一对局部变量）。
        ['systems/ZCAttackResolutionSystem.ts', 'area 落区域'],
    ];
    for (const [file, where] of expectations) {
        const source = readFileSync(join(MODEL_DIR, file), 'utf8');
        assert.match(source, call, `${file} 没有调用 pushSkillRangeRingEvent（${where}）`);
        assert.match(source, guard, `${file} 少了按单位名单的守卫 ⇒ 会给所有卡都画圈`);
    }
    //  圆心与区域必须是**同一个坐标**：两处各算一遍迟早写歪（差半个偏移量就看不出来）。
    const attack = readFileSync(join(MODEL_DIR, 'systems/ZCAttackResolutionSystem.ts'), 'utf8');
    assert.match(attack, /const zoneX = moving/, 'zoneX 必须是局部变量，供区域与范围圈共用');
    assert.match(attack, /const zoneY = moving/, 'zoneY 必须是局部变量');
});
