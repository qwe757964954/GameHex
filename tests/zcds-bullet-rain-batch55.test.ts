import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { configureZCMap, ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { captureZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import type { ZCAttackProfile, ZCDeckBonuses, ZCUnitDefinition } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import type { ZCFloatText, ZCSnapshot, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import type { ZCUnitStatPatch } from '../assets/script/app/zcds/model/ZCModifierRuntime';
import type { IZCAttackResolutionContext, IZCStrikeOptions } from '../assets/script/app/zcds/model/systems/ZCAttackResolutionSystem';
import { ZCSkillResolutionSystem } from '../assets/script/app/zcds/model/systems/ZCSkillResolutionSystem';
import { buildZCVisualResourcePlan } from '../assets/script/app/zcds/model/ZCVisualResourcePlan';
import {
    ZC_BULLET_RAIN_ARC_SPREAD, ZC_BULLET_RAIN_MAX_SECONDS, ZC_BULLET_RAIN_MIN_SECONDS,
    ZC_BULLET_RAIN_ORIGIN_LIFT_PX, ZC_BULLET_RAIN_SHOT_INTERVAL_SECONDS,
    ZC_BULLET_RAIN_SPEED, ZC_BULLET_RAIN_UNITS,
    zcBezierTangentDegrees, zcBezierXAt, zcBezierYAt, zcBulletBezierOffsetPx,
    zcBulletRainArcPx, zcBulletRainFieldsAt, zcBulletRainImpactAt, zcBulletRainImpactPathsForUnit,
    zcBulletRainOffset, zcBulletRainPath, zcBulletRainStyleOf, zcBulletRainSwayPx,
} from '../assets/script/app/zcds/model/ZCProjectileDropStyle';
import { pushSkillRangeRingEvent, ZC_SKILL_RANGE_RING_SLIDE_SPEED } from '../assets/script/app/zcds/model/ZCSkillRangeRingFx';
import { zcCombatEffectSlidePoint } from '../assets/script/app/zcds/view/ZCCombatEffectSlide';
import { assetPath } from './helpers/asset-paths';

/**
 * 「弹道雨」：三张卡改成**从自身抛出一批子弹、贝塞尔落到区域任意点**。
 *
 * 第 55 批（2026-11-26）用户原话：
 * 「杰克藕的戈壁箭雨、急冻瓜的冰山陨落、篮球天才的篮球火，三个卡牌的技能都是
 *   **从自身发射多个技能子弹到区域的任意落点，子弹呈贝塞尔曲线飞行**」
 * 以及配套的保底要求：
 * 「没有目标不释放技能，有目标释放后，即使目标死亡，也会继续播放，一定是整个技能动作做完」
 *
 * 第 56 批（同日）追加三条：
 * 「1,释放这种技能的子弹速度 改成150px
 *   2.子弹的弧线不够明显，每个子弹的弧线差异可以再大点，多条不同的贝塞尔曲线行进路线」
 * 「子弹命中指定坐标消失，在坐标处播放受击特效」
 *
 * 这一批有八个「不写用例就会静默出错」的点：
 *
 *  1. **控制点 = 2 × 峰高**。二次贝塞尔 `B(t) = 2(1−t)t·ctrl`，中点只走到 `ctrl/2`；
 *     直接拿峰高当控制点，屏幕上量到的弧只有配置的一半 —— 而且不报错。
 *  2. **曲线必须在屏幕空间求值**。`flyArcPx` / `flySwayPx` 是屏幕 px 量，
 *     先在世界坐标插值再 `mapToView` 会被 x/y 换算比拉扁。
 *  3. **颗数跟配表走**。戈壁箭雨三档 `strikeCount` 是 5/6/8，写死 5 就是「配表说 8 支、画面上 5 支」。
 *  4. **必须按通道分流**。`68024` 身上挂着两条技能：冰山陨落（`self_aura`，要改）与
 *     急冻光线（`random_strike`，不能改）。只看 `unitId` 会把急冻光线一起改掉。
 *  5. **落点是表现、判定不动**。`to` / `zone.x/y` 是战斗结算用的，落点另起 `flyTo*`。
 *  6. **飞行时长不能被单颗飞入的 0.55s 夹住**。150 px/s 下夹住 = 慢速改成面条、弧线被抹平。
 *  7. **逐颗峰高要错开**。只错开横向侧摆时，一批弧的**高度**还是同一个，眼睛读出来仍是
 *     「一批同样的弧斜着撒」。
 *  8. **命中特效必须进资源计划**。漏收的后果是「子弹到点消失、落点什么都没有」，且不报错。
 */

const TABLE_NAMES = [
    'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams',
    'skillAttrModifier', 'generalStar', 'pvpAttrMap', 'pvpModifierOverride',
    'pvpUnitGrowth', 'pvpSkillBinding', 'pvpStatus', 'pvpSkillPlan',
];
const OWNERS = Object.values(ZCOwner) as ZCOwner[];
const ROOT = process.cwd();

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

function perOwner<T>(factory: () => T): Record<ZCOwner, T> {
    return Object.fromEntries(OWNERS.map((owner) => [owner, factory()])) as Record<ZCOwner, T>;
}

/* ────────────────────────────── 一、贝塞尔求值（纯函数） ────────────────────────────── */

test('① 贝塞尔：端点精确、中点抬高「正好一个峰高」、侧摆也正好一个 swayPx', () => {
    //  起点 (0,0) → 终点 (100,0)，峰高 120、侧摆 40。
    //  控制点 = 弦中点 + (2·sway, 2·apex) = (50 + 80, 0 + 240) = (130, 240)
    const path = zcBulletRainPath(0, 0, 100, 0, 120, 40);
    assert.deepEqual(path, { fromX: 0, fromY: 0, toX: 100, toY: 0, ctrlX: 130, ctrlY: 240 });

    assert.deepEqual([zcBezierXAt(path, 0), zcBezierYAt(path, 0)], [0, 0], 't=0 必须正好在起点');
    assert.deepEqual([zcBezierXAt(path, 1), zcBezierYAt(path, 1)], [100, 0], 't=1 必须正好在落点');
    //  t=0.5：(0.25·0 + 0.5·130 + 0.25·100, 0.5·240) = (90, 120)
    //  x 比弦中点 50 多 40 = swayPx；y 比弦 0 高 120 = apexPx ⇒ 配置值就是屏幕上量到的值
    assert.equal(zcBezierXAt(path, 0.5), 90, '中点横向偏移必须正好是 swayPx（40）');
    assert.equal(zcBezierYAt(path, 0.5), 120, '中点抬高必须正好是 apexPx（120）');
});

test('① 一维偏移：峰高传进去、中点抬到峰高（内部按 2× 反推控制点）', () => {
    assert.equal(zcBulletBezierOffsetPx(120, 0), 0);
    assert.equal(zcBulletBezierOffsetPx(120, 1), 0);
    assert.equal(zcBulletBezierOffsetPx(120, 0.5), 120, '中点必须抬到 120，不是 60');
    //  非数字一律按端点处理：NaN 泄进 setPosition 会让整层矩阵变 NaN、整屏不渲染
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 0]) {
        assert.equal(zcBulletBezierOffsetPx(bad, 0.5), 0, `${String(bad)} 不该产生位移`);
    }
    assert.equal(zcBulletBezierOffsetPx(120, Number.NaN), 0, '进度非数字按「已落地」处理');
    //  单调：0.5 之前一路往上
    assert.ok(zcBulletBezierOffsetPx(120, 0.25) < zcBulletBezierOffsetPx(120, 0.5));
});

test('① 切线角 = 解析导数：起手朝上斜、落地朝下斜，跟数值差分对得上', () => {
    const path = zcBulletRainPath(0, 0, 100, 0, 120, 40);
    //  B'(0) = 2(P1 − P0) = (260, 480) ⇒ 61.5°；起手是「斜冲上去」
    assert.ok(Math.abs(zcBezierTangentDegrees(path, 0) - Math.atan2(480, 260) * 180 / Math.PI) < 1e-9);
    //  B'(1) = 2(P2 − P1) = (−60, −480) ⇒ 负角度；落地是「兜下来」
    assert.ok(zcBezierTangentDegrees(path, 1) < 0, '落地那一帧朝向必须朝下，不能突然归零');
    //  与数值差分逐点对照（ε 取 1e-6）
    for (const t of [0.2, 0.5, 0.8]) {
        const eps = 1e-6;
        const numeric = Math.atan2(
            zcBezierYAt(path, t + eps) - zcBezierYAt(path, t - eps),
            zcBezierXAt(path, t + eps) - zcBezierXAt(path, t - eps)) * 180 / Math.PI;
        assert.ok(Math.abs(zcBezierTangentDegrees(path, t) - numeric) < 1e-3,
            `t=${t} 解析切线 ${zcBezierTangentDegrees(path, t)} 与差分 ${numeric} 不一致`);
    }
});

/* ────────────────────────────── 二、名单与通道 ────────────────────────────── */

test('② 名单：三张卡各走各的通道，急冻光线不许被顺带改掉', () => {
    assert.deepEqual(Object.keys(ZC_BULLET_RAIN_UNITS).sort(), ['68008', '68024', '68030']);
    assert.equal(zcBulletRainStyleOf('68008', 'strike')?.count, 5, '戈壁箭雨 = random_strike');
    assert.equal(zcBulletRainStyleOf('68024', 'aura')?.count, 3, '冰山陨落 = self_aura 落地那一击');
    assert.equal(zcBulletRainStyleOf('68030', 'zone')?.count, 3, '篮球火 = area 区域');
    //  🔴 急冻光线与冰山陨落同为 68024，但走 `random_strike` —— 本需求没要求改它
    assert.equal(zcBulletRainStyleOf('68024', 'strike'), null, '急冻光线必须保持原来的单颗表现');
    assert.equal(zcBulletRainStyleOf('68008', 'zone'), null);
    assert.equal(zcBulletRainStyleOf('68030', 'strike'), null);
    for (const unitId of ['68001', '68011', '68025', undefined, null]) {
        for (const channel of ['strike', 'aura', 'zone'] as const) {
            assert.equal(zcBulletRainStyleOf(unitId, channel), null, `${String(unitId)} / ${channel}`);
        }
    }
    //  每份口径都得说清楚：颗数 ≥ 1、峰高 > 0、散布不出圈、命中特效登记齐
    for (const [unitId, style] of Object.entries(ZC_BULLET_RAIN_UNITS)) {
        assert.ok(style.count >= 1, `${unitId} 颗数`);
        assert.ok(style.arcPx > 0, `${unitId} 峰高`);
        assert.ok(style.swayPx >= 0, `${unitId} 侧摆`);
        assert.ok(style.spreadRatio > 0 && style.spreadRatio <= 1, `${unitId} 散布比例必须落在 (0,1]`);
        assert.ok(style.channels.length === 1, `${unitId} 只该挂在一条通道上（多挂会误伤别的技能）`);
        assert.match(style.impactPrefabPath, /^units\/projectiles\/.+\/.+$/, `${unitId} 命中特效路径`);
        assert.ok(style.impactSeconds > 0, `${unitId} 命中特效时长`);
    }
});

test('② 戈壁箭雨的颗数跟配表三档走：5 / 6 / 8', () => {
    prepare();
    const tiers = readRows('pvpSkillPlan')
        .filter((row) => Number(row.skillChainId) === 100804)
        .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
    assert.equal(tiers.length, 3, '戈壁箭雨应有三档');
    assert.equal(tiers[0].skillName, '戈壁箭雨', '改名前叫「戈壁狂箭」，这里只是确认链没接错');
    const counts = tiers.map((row) => Number((JSON.parse(String(row.skillParamJson)) as Record<string, number>).strikeCount));
    assert.deepEqual(counts, [5, 6, 8], '配表三档颗数变了 ⇒ 用例要跟着复核手感');
    assert.equal(ZC_BULLET_RAIN_UNITS['68008'].count, counts[0], '缺省值要与一档对齐，别写成 3 这种无来源的数');
});

/* ────────────────────────────── 三、落点、速度、弧线 ────────────────────────────── */

test('③ 落点：起点是施法者、第 0 颗落在圆心、其余都在散布圈里', () => {
    const style = ZC_BULLET_RAIN_UNITS['68008'];
    const placement = { originX: -500, originY: 240, centerX: 60, centerY: -30, radiusWorld: 63 };
    const shots = 5;
    const spread = placement.radiusWorld * style.spreadRatio;
    const lands: Array<[number, number]> = [];
    for (let index = 0; index < shots; index += 1) {
        const fields = zcBulletRainFieldsAt(style, index, placement, 4321, shots);
        assert.equal(fields.flyFromX, placement.originX, '起点 x 必须是施法者（不是圆心）');
        assert.equal(fields.flyFromY, placement.originY, '起点 y 必须是施法者');
        if (index === 0) {
            assert.deepEqual([fields.flyToX, fields.flyToY], [placement.centerX, placement.centerY],
                '第 0 颗落在圆心：保证「圈正中心一定挨了一下」，也给用例一个稳定锚点');
        }
        const reach = Math.hypot(fields.flyToX - placement.centerX, fields.flyToY - placement.centerY);
        assert.ok(reach <= spread + 1e-6, `第 ${index} 颗飞出散布圈（${reach.toFixed(2)} > ${spread.toFixed(2)}）`);
        lands.push([fields.flyToX, fields.flyToY]);
    }
    assert.ok(new Set(lands.map((point) => `${point[0].toFixed(3)},${point[1].toFixed(3)}`)).size >= 4,
        `落点重叠太多：${JSON.stringify(lands)}`);
});

test('③ 速度 150px：按「起点 → 落点」的世界距离算，夹在弹道雨自己的上下限里', () => {
    //  用户口径「释放这种技能的子弹速度改成 150px」。
    //  单位与配表 `projectileSpeed` 同档（`attackTravelSeconds` 直接除世界距离，不乘 0.3）。
    assert.equal(ZC_BULLET_RAIN_SPEED, 150);
    //  🔴 必须比单颗飞入那条 0.55s 宽：150 px/s 下被夹住 ⇒ 慢速被截断、弧线被抹平
    assert.ok(ZC_BULLET_RAIN_MAX_SECONDS > 0.55, `上限 ${ZC_BULLET_RAIN_MAX_SECONDS} 太窄`);
    assert.ok(ZC_BULLET_RAIN_MIN_SECONDS < ZC_BULLET_RAIN_MAX_SECONDS);
    const style = ZC_BULLET_RAIN_UNITS['68030'];
    for (const distance of [0, 12, 55, 90, 400]) {
        //  radiusWorld 0 ⇒ 落点就是圆心 ⇒ 距离正好是 distance
        const fields = zcBulletRainFieldsAt(style, 1,
            { originX: 0, originY: 0, centerX: distance, centerY: 0, radiusWorld: 0 }, 99);
        const expected = Math.min(ZC_BULLET_RAIN_MAX_SECONDS,
            Math.max(ZC_BULLET_RAIN_MIN_SECONDS, distance / ZC_BULLET_RAIN_SPEED));
        assert.ok(Math.abs(fields.flyInSeconds - expected) < 1e-9, `距离 ${distance} 的时长`);
    }
    //  距离翻倍 ⇒ 时长翻倍（没被上下限夹住的那一段）
    const near = zcBulletRainFieldsAt(style, 1, { originX: 0, originY: 0, centerX: 60, centerY: 0, radiusWorld: 0 }, 99);
    const far = zcBulletRainFieldsAt(style, 1, { originX: 0, originY: 0, centerX: 120, centerY: 0, radiusWorld: 0 }, 99);
    assert.ok(Math.abs(far.flyInSeconds - near.flyInSeconds * 2) < 1e-9, '时长必须与距离成正比');
});

test('③ 弧线：逐颗峰高错开 ±45%、侧摆在摊开之上再叠抖动 ⇒ 每颗都是不同的曲线', () => {
    const style = ZC_BULLET_RAIN_UNITS['68008'];
    assert.equal(ZC_BULLET_RAIN_ARC_SPREAD, 0.45);
    for (const shots of [3, 5, 8]) {
        const arcs = Array.from({ length: shots }, (_, index) => zcBulletRainArcPx(style, index, shots, 4321));
        assert.equal(arcs[0], style.arcPx, '第 0 颗走基准弧（用例与「圈心那一发」的锚点）');
        for (const [index, arc] of arcs.entries()) {
            assert.ok(arc >= style.arcPx * 0.55 - 1 && arc <= style.arcPx * 1.45 + 1,
                `第 ${index} 颗峰高 ${arc} 超出 ±45%`);
        }
        assert.equal(new Set(arcs).size, shots, `${shots} 颗的峰高必须两两不同：${JSON.stringify(arcs)}`);
    }
    //  「差异可以再大点」的量化口径：同一批里最高的弧至少是最低的 1.5 倍
    const five = Array.from({ length: 5 }, (_, index) => zcBulletRainArcPx(style, index, 5, 4321));
    assert.ok(Math.max(...five) / Math.min(...five) >= 1.5, `峰高落差不够：${JSON.stringify(five)}`);

    //  侧摆：摊开 + 抖动 ⇒ 两两不同、不越界、且确实用满了整个宽度
    const sways = Array.from({ length: 5 }, (_, index) => zcBulletRainSwayPx(style, index, 5, 4321));
    assert.equal(new Set(sways).size, 5, `侧摆两两不同：${JSON.stringify(sways)}`);
    for (const sway of sways) assert.ok(Math.abs(sway) <= style.swayPx + 1e-9);
    assert.ok(Math.max(...sways) - Math.min(...sways) > style.swayPx * 1.2, `侧摆没有铺开：${JSON.stringify(sways)}`);
    //  单颗时恒 0（一颗子弹没必要歪）
    assert.equal(zcBulletRainSwayPx(style, 0, 1, 4321), 0);
});

test('③ 落点与曲线可复算：同种子逐位相同、换种子换一批；半径不成立时退回圆心', () => {
    const style = ZC_BULLET_RAIN_UNITS['68024'];
    const placement = { originX: 0, originY: 0, centerX: 30, centerY: 40, radiusWorld: 50 };
    const a = zcBulletRainFieldsAt(style, 2, placement, 777);
    const b = zcBulletRainFieldsAt(style, 2, placement, 777);
    assert.deepEqual(a, b, '同一波同种子必须逐位相同（录像 / 快照重算靠这一条）');
    const c = zcBulletRainFieldsAt(style, 2, placement, 778);
    assert.notDeepEqual([c.flyToX, c.flyToY], [a.flyToX, a.flyToY], '换一波要换一批落点，否则每波一模一样');
    //  峰高按 7 档轮转，相邻两个种子有 1/7 概率落在同一档 ⇒ 看一段连续种子里有几种取值，
    //  而不是死盯某一对（那会变成一个 1/7 概率随机红的用例）。
    const arcs = new Set([777, 778, 779, 780, 781, 782, 783, 784]
        .map((seed) => zcBulletRainFieldsAt(style, 2, placement, seed).flyArcPx));
    assert.ok(arcs.size >= 3, `峰高没有跟着种子轮转（只有 ${JSON.stringify([...arcs])}）`);
    //  不成立的半径：0 / 负数 / NaN / Infinity 一律退回圆心（Infinity 会让落点变 ±Infinity ⇒ 节点 NaN）
    for (const bad of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
        const fields = zcBulletRainFieldsAt(style, 2, { ...placement, radiusWorld: bad }, 777);
        assert.deepEqual([fields.flyToX, fields.flyToY], [placement.centerX, placement.centerY],
            `半径 ${String(bad)} 时不该有偏移`);
    }
    assert.deepEqual(zcBulletRainOffset(1, 0, 50, 1), { dx: 0, dy: 0 }, '第 0 颗恒定在圆心');
});

/* ────────────────────────────── 四、命中即消失 + 受击特效 ────────────────────────────── */

test('④ 命中特效：落在同一坐标、`startedAt` 正好是到达时刻、时长来自表', () => {
    const style = ZC_BULLET_RAIN_UNITS['68030'];
    const fields = zcBulletRainFieldsAt(style, 1,
        { originX: 0, originY: 0, centerX: 60, centerY: 20, radiusWorld: 40 }, 555);
    const impact = zcBulletRainImpactAt(style, fields, 12.5);
    assert.equal(impact.x, fields.flyToX, '特效必须在**落点**，不是施法者也不是区域圆心');
    assert.equal(impact.y, fields.flyToY);
    assert.equal(impact.startedAt, 12.5 + fields.flyInSeconds, '起手 + 飞行时长 = 到达时刻');
    assert.equal(impact.effectPrefabPath, style.impactPrefabPath);
    assert.equal(impact.durationSeconds, style.impactSeconds);
    //  非数字不许泄进去（会让整层矩阵变 NaN）
    assert.equal(zcBulletRainImpactAt(style, { ...fields, flyInSeconds: Number.NaN }, Number.NaN).startedAt, 0);

    //  三张卡的命中特效各是各的（逐条登记，不许共用一条糊过去）
    const paths = Object.entries(ZC_BULLET_RAIN_UNITS).map(([unitId, item]) => [unitId, item.impactPrefabPath]);
    assert.equal(new Set(paths.map(([, path]) => path)).size, 3,
        `三张卡的命中特效应当各不相同：${JSON.stringify(paths)}`);
    assert.deepEqual(zcBulletRainImpactPathsForUnit('68008'), [ZC_BULLET_RAIN_UNITS['68008'].impactPrefabPath]);
    assert.deepEqual(zcBulletRainImpactPathsForUnit('68001'), [], '不在表里的单位一条都不收');
});

test('④ 命中特效进资源计划：漏收就是「子弹消失、落点什么都没有」且不报错', () => {
    prepare();
    const unit = (unitId: string) => ({
        unitId, attackProfile: { effectPrefabPath: null, impactEffectPrefabPath: null },
    });
    const plan = (unitId: string, behaviorKey: string) => ({ enabled: true, unitId, behaviorKey });
    const built = buildZCVisualResourcePlan(
        [unit('68008'), unit('68030'), unit('68024')],
        {
            skillPlans: [plan('68008', 'random_strike'), plan('68030', 'area'), plan('68024', 'self_aura')],
            textOverrides: new Map(),
        });
    for (const unitId of ['68008', '68024', '68030']) {
        const path = ZC_BULLET_RAIN_UNITS[unitId].impactPrefabPath;
        assert.ok(built.effectPaths.includes(path), `${unitId} 的命中特效 ${path} 没进加载清单`);
    }
    //  只上场的单位才收（别把三张卡的命中特效全塞进每一局）
    const only = buildZCVisualResourcePlan([unit('68030')],
        { skillPlans: [plan('68030', 'area')], textOverrides: new Map() });
    assert.ok(only.effectPaths.includes(ZC_BULLET_RAIN_UNITS['68030'].impactPrefabPath));
    assert.equal(only.effectPaths.includes(ZC_BULLET_RAIN_UNITS['68008'].impactPrefabPath), false);
});

/* ────────────────────────────── 五、保底：有目标才放、放完就演完 ────────────────────────────── */

const DEFINITION = {
    unitId: '68008', name: '杰克藕', maxHp: 600, attack: 100,
    moveSpeed: 0, attackSpeed: 500, attackRange: 500, attackInterval: 1.8,
    attackDuration: 0.667, attackHitTime: 0.345, bodyRadius: 6, spawnSeconds: 0,
    flying: false, canAttackAir: true, hero: false, prefabPath: '', prefabSize: 1,
    attackProfile: {
        skillId: 100804, name: '戈壁箭雨', mode: 'projectile',
        projectileSpeed: 500, areaRadius: 0, damageRate: 1,
        empoweredEvery: 0, empoweredSkillId: 0, secondarySkillId: 0,
        durationSeconds: 0, waves: 1, legacyEffectKeys: [],
        effectPrefabPath: 'effects/test/arrow', impactEffectPrefabPath: null,
    } satisfies ZCAttackProfile,
    secondaryProfile: undefined,
} as unknown as ZCUnitDefinition;

function makeUnit(id: number, owner: ZCOwner, x: number, y = 0, unitId = '68008'): ZCUnitState {
    return {
        id, owner, unitId, cardId: String(id), tier: 1,
        sourceHexId: 0, targetHexId: null, progress: 0,
        hp: 1000, maxHp: 1000, battleState: 'idle', stateTime: 0,
        targetUnitId: null, targetWallHexId: null, targetBuildingHexId: null,
        nextAttackAt: 0, waitUntil: 0, attackHitDone: false,
        hatredUnitId: null, hatredUntil: 0, facingRadians: 0, deathRemoveAt: 0,
        marchAngle: null, freeX: x, freeY: y, completedAttackCount: 0,
    };
}

function makeState(units: ZCUnitState[]): ZCSnapshot {
    return {
        version: 4, elapsedSeconds: 0, durationSeconds: 300,
        playerGold: 0, enemyGold: 0, artifactReadyUses: 0, artifactCharge: 0,
        artifactCooldown: 0, enemyFrozenSeconds: 0, status: 'running', resultReason: '',
        hexes: [], units, nextUnitId: units.length + 1,
        incomeClock: 0, aiClock: 0, towerClock: 0, spawnClocks: {},
        drawCursor: perOwner(() => 0),
        allRandomNonGoldDraws: perOwner(() => 0),
        builtTypeCounts: perOwner(() => ({})),
        combatEvents: [], projectiles: [], nextCombatEventId: 1, groundZones: [],
        statusEffects: { nextUid: 1, units: [] },
    } as unknown as ZCSnapshot;
}

function strikeContext(units: ZCUnitState[]) {
    const damaged: Array<{ id: number; damage: number }> = [];
    const context = {
        rules: {
            combatDistanceScale: 0.3, combatDamageMultiplier: 1, unitAttackPerTier: 0, counterDamageMultiplier: 1,
        } as IZCAttackResolutionContext['rules'],
        statusSystem: { statModsOf: () => ({}) } as unknown as IZCAttackResolutionContext['statusSystem'],
        geometry: { hexIdAt: () => null } as unknown as IZCAttackResolutionContext['geometry'],
        random: () => 0.99,
        effectiveDefinition: () => DEFINITION,
        unitPosition: (unit: ZCUnitState) => ({ x: unit.freeX, y: unit.freeY }),
        damageUnit: (unit: ZCUnitState, damage: number) => {
            damaged.push({ id: unit.id, damage: Math.round(damage) });
            return { value: Math.round(damage), kind: 'damage', x: 0, y: 0 } as unknown as ZCFloatText;
        },
        counters: [],
        cards: perOwner(() => new Map()),
        skillRuntime: perOwner(() => new Map()) as unknown as IZCAttackResolutionContext['skillRuntime'],
        statPatches: perOwner(() => new Map<string, ZCUnitStatPatch>()),
        deckBonuses: perOwner<ZCDeckBonuses>(() => ({
            activeBonds: [], unitHpMultiplier: 1, unitAttackMultiplier: 1,
            moveSpeedMultiplier: 1, towerAttackMultiplier: 1, incomeBonus: 0,
            spawnIntervalMultiplier: 1,
        })),
        unitById: new Map(units.map((unit) => [unit.id, unit])),
        currentTarget: () => null,
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

/** 戈壁箭雨 L1 的运行时选项（`strikeTargetMode` 缺省 ⇒ 半径就是 `strikeRadius × 0.3 = 63`）。*/
function strikeOptions(extra: Partial<IZCStrikeOptions> = {}): IZCStrikeOptions {
    return {
        count: 5, radius: 63, damageRate: 0.5,
        nearest: false, splashRadius: 0, splashDamageRate: 0, splashFalloff: 0,
        ...extra,
    };
}

type AnyEvent = Record<string, number | string | null | undefined>;

/** 事件分两拨：带 `flyFromX` 的是子弹，不带的是命中特效。 */
function splitRain(events: readonly unknown[]): { bullets: AnyEvent[]; impacts: AnyEvent[] } {
    const all = events as AnyEvent[];
    return {
        bullets: all.filter((item) => item.flyFromX !== undefined),
        impacts: all.filter((item) => item.flyFromX === undefined),
    };
}

test('⑤ 「没有目标不释放」：0 目标、不带 forceVisual ⇒ 一条事件都不发、返回 0', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    const state = makeState([caster]);
    const { context } = strikeContext([caster]);
    const hits = ZCSkillResolutionSystem.strikeTargets(state, caster, strikeOptions(), context);
    assert.equal(hits, 0);
    //  🔴 返回 0 是调用点的信号：`applyRandomStrike` 据此**不推进冷却**、不建 6 秒窗口、每帧重试
    assert.equal(state.combatEvents.length, 0, '没目标连白圈都不该起（圈是窗口开了才画的）');
});

test('⑤ 「放完就演完」：窗口内的波次带 forceVisual ⇒ 没有敌人也把这一批箭抛完并炸在落点', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    //  敌人已经全死了 —— 只剩尸体（`battleState === 'dead'`），与「被打光」同一条判据
    const corpse = { ...makeUnit(2, ZCOwner.Enemy, 40, 0, '68028'), hp: 0, battleState: 'dead' as const };
    const units = [caster, corpse];
    const state = makeState(units);
    const { context, damaged } = strikeContext(units);

    //  1) 首次施法仍然不带保底 ⇒ 一个敌人都没有就不放（把「没目标不释放」保住）
    assert.equal(ZCSkillResolutionSystem.strikeTargets(state, caster, strikeOptions(), context), 0);
    assert.equal(state.combatEvents.length, 0);

    //  2) 窗口内的这一波带 forceVisual ⇒ 5 支箭 + 5 个落点爆炸，伤害 0（没人可打）
    const hits = ZCSkillResolutionSystem.strikeTargets(state, caster, strikeOptions({ forceVisual: true }), context);
    assert.equal(hits, 0, '没人可打，命中数当然是 0（但表现照发）');
    assert.equal(damaged.length, 0, '不许对着尸体结算伤害');

    const { bullets, impacts } = splitRain(state.combatEvents);
    assert.equal(bullets.length, 5, '配表 strikeCount = 5 ⇒ 5 条子弹事件');
    assert.equal(impacts.length, 5, '每颗子弹各带一条命中特效');
    for (const bullet of bullets) {
        assert.equal(bullet.damage, 0, '纯表现事件，伤害字段必须 0');
        assert.equal(bullet.flyFromX, 0, '起点 = 施法者（不是落点）');
        //  没有敌人时散布中心落在「朝向前方半个半径」—— 不许扎在自己脚上
        const away = Math.hypot(bullet.flyToX as number, bullet.flyToY as number);
        assert.ok(away > 1, `这一波应当朝前方撒（离自己 ${away.toFixed(1)}）`);
        assert.ok(away <= 63, `落点仍要在这张卡的范围圈里（离自己 ${away.toFixed(1)} > 63）`);
        //  🔴 子弹自身只活到到达时刻 ⇒ 「命中指定坐标消失」，不会停在落点继续播
        assert.equal(bullet.durationSeconds, bullet.flyInSeconds);
    }
    //  命中特效必须落在子弹的落点上，且在飞行结束那一刻才起
    const style = ZC_BULLET_RAIN_UNITS['68008'];
    for (const bullet of bullets) {
        const impact = impacts.find((item) => item.toX === bullet.flyToX && item.toY === bullet.flyToY);
        assert.ok(impact, `落点 ${bullet.flyToX},${bullet.flyToY} 没有命中特效`);
        assert.equal(impact.effectPrefabPath, style.impactPrefabPath);
        assert.equal(impact.damage, 0);
        //  第 58 批起逐颗出手：命中时刻 = **这颗**的起手 + 自己的飞行时长。
        assert.ok(Math.abs(Number(impact.startedAt)
            - (Number(bullet.startedAt) + Number(bullet.flyInSeconds))) < 1e-6,
            '命中原事件的时刻 = 这颗的起手 + 飞行时长');
    }
});

test('⑤ 有敌人时：N 条子弹 + N 条命中特效 + 逐个结算（散开落点但不改判定）', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    const enemies = [
        makeUnit(2, ZCOwner.Enemy, 40, 0, '68028'),
        makeUnit(3, ZCOwner.Enemy, 44, 10, '68028'),
    ];
    const units = [caster, ...enemies];
    const state = makeState(units);
    const { context, damaged } = strikeContext(units);

    const hits = ZCSkillResolutionSystem.strikeTargets(state, caster, strikeOptions(), context);
    assert.equal(hits, 2, '两个活敌人都要挨打');
    assert.equal(damaged.length, 2);
    const { bullets } = splitRain(state.combatEvents);
    assert.equal(bullets.length, 5, '表现条数只由配表颗数决定，与敌人数无关');
    assert.equal(state.combatEvents.length, 10, '5 颗子弹 + 5 个命中特效');

    //  散布中心 = 敌群质心 (42, 5) ⇒ 落点围着敌人，不会有一半箭扎在自己脚下
    const nearEnemyPack = bullets.filter((bullet) =>
        Math.hypot((bullet.flyToX as number) - 42, (bullet.flyToY as number) - 5) <= 63 * 0.85 + 1e-6);
    assert.equal(nearEnemyPack.length, 5, '五支箭都该落在敌群那一圈里');
    for (const bullet of bullets) {
        assert.equal(bullet.flyFromX, 0, '起点仍是施法者');
        assert.equal(bullet.toX, bullet.flyToX, '`to` 与落点同一处：这条通道的 `to` 没有判定用途');
    }
});

/* ────────────────────────────── 六、接线守卫（漏一处就静默不生效） ────────────────────────────── */

test('⑥ 三处接入点各按自己的通道取口径；视图到点隐藏、命中特效另起事件', () => {
    const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
    const view = read('assets/script/app/zcds/view/ZCCombatEffectView.ts');
    const zone = read('assets/script/app/zcds/model/systems/ZCGroundZoneSystem.ts');
    const skill = read('assets/script/app/zcds/model/systems/ZCSkillResolutionSystem.ts');
    const trigger = read('assets/script/app/zcds/model/systems/ZCSkillTriggerSystem.ts');
    const types = read('assets/script/app/zcds/model/ZCGameTypes.ts');
    const plan = read('assets/script/app/zcds/model/ZCVisualResourcePlan.ts');

    //  三条通道各取各的，不许写死同一个渠道
    assert.match(zone, /zcBulletRainStyleOf\(sourceUnitId, 'zone'\)/, '篮球火（area）');
    assert.match(skill, /zcBulletRainStyleOf\(unit\.unitId, 'aura'\)/, '冰山陨落（self_aura 落地一击）');
    assert.match(skill, /zcBulletRainStyleOf\(unit\.unitId, 'strike'\)/, '戈壁箭雨（random_strike）');
    //  颗数：戈壁箭雨必须把配表值当第 5 个参数传下去
    assert.match(skill, /const shots = Math\.max\(1, Math\.round\(count\)\);/, '颗数取配表 strikeCount');
    assert.match(skill, /zcBulletRainFieldsAt\(rain, index, \{[\s\S]{0,200}?\}, seed, shots\);/, '侧摆按实际颗数归一');

    //  三个推送点都必须：到点即摘 + 另起一条命中特效
    //  2026-11-26 第 58 批起逐颗出手（`fireAt`），命中特效的时刻基准必须跟着这颗走 ——
    //  还传 `state.elapsedSeconds` 就会让 N 个命中特效全挤在第一颗落地那一刻。
    for (const [label, source] of [['zone', zone], ['skill', skill]] as const) {
        assert.match(source, /zcBulletRainImpactAt\(rain, fields, fireAt\)/,
            `${label} 通道缺命中特效（或没用逐颗的 fireAt）`);
        assert.match(source, /durationSeconds: fields\.flyInSeconds,/, `${label} 通道的子弹没有「到点即摘」`);
        assert.match(source, /ZC_BULLET_RAIN_SHOT_INTERVAL_SECONDS/,
            `${label} 通道没有逐颗出手的间隔`);
    }

    //  视图：到点隐藏，不许停在落点上
    assert.match(view, /if \(t >= 1\) \{[\s\S]{0,220}?return;/, 't=1 必须整颗消失');
    assert.match(view, /this\.visualNode\.active = false;/, '藏的是可视节点（池化复用，别销毁）');
    //  视图：落点优先 `flyTo*`，轨迹走贝塞尔，朝向走切线
    assert.match(view, /const landX = event\.flyToX \?\? event\.toX;/, '落点优先 flyTo，缺省退回 to');
    assert.match(view, /const path = zcBulletRainPath\(/, '轨迹求值');
    assert.match(view, /zcBezierTangentDegrees\(path, t\)/, '朝向 = 切线方向');
    //  事件字段
    assert.match(types, /flyToX\?: number;/, 'ZCCombatEvent 缺 flyToX');
    assert.match(types, /flyToY\?: number;/);
    assert.match(types, /flySwayPx\?: number;/);
    //  资源计划
    assert.match(plan, /zcBulletRainImpactPathsForUnit\(unit\.unitId\)/, '命中特效必须进加载清单');

    //  保底开关：窗口内每波带 true，首次施法不带
    assert.match(trigger, /const fire = \(forceVisual = false\): boolean => \{/);
    assert.match(trigger, /forceVisual: forceVisual \|\| undefined,/);
    assert.match(trigger, /if \(until != null && now < until\) \{[\s\S]{0,400}?fire\(true\);/,
        '窗口内每一波都要保底，否则「圈还在、箭没了」');
    assert.match(trigger, /if \(!fire\(\)\) \{/, '窗口外首次施法仍走「没目标不放」这一档');
});

/* ────────────────── 六、第 57 批：范围指示白环的圆心必须落在「这一发打在哪」 ────────────────── */

/**
 * 用户口径（2026-11-26）：「杰克藕的区域没有出现在对应的目标上，而是以杰克藕为圆心，
 * 正确是以目标为圆心」。
 *
 * 根因是 `pushStrikeRangeRing` 写死 `unitPosition(unit)` —— 圈画在施法者脚下，
 * 而箭按敌群质心撒，两者从第一帧就对不上。修法是**同源**：`strikeTargets` 挑完人之后
 * 把中心回填进 `options.centerOut`，触发系统拿它画圈，不在外面重算
 * （挑人带随机，外面重算一次必然得到另一个质心）。
 */
test('⑥ centerOut：弹道雨单位（68008）⇒ 回填散布中心 = 挑中目标的质心', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    const enemies = [
        makeUnit(2, ZCOwner.Enemy, 40, 0, '68028'),
        makeUnit(3, ZCOwner.Enemy, 44, 10, '68028'),
        //  这只在半径外（63 世界 px 之外）—— 不许把它算进圆心
        makeUnit(4, ZCOwner.Enemy, 400, 400, '68028'),
    ];
    const units = [caster, ...enemies];
    const state = makeState(units);
    const { context } = strikeContext(units);
    const center = { x: Number.NaN, y: Number.NaN };
    const hits = ZCSkillResolutionSystem.strikeTargets(state, caster,
        strikeOptions({ centerOut: center }), context);
    assert.ok(hits >= 1);
    assert.ok(Number.isFinite(center.x) && Number.isFinite(center.y), '挑到人了就必须回填中心');
    //  🔴 68008 走的是**弹道雨**通道：圈是「这一片区域」，圆心只能取散布中心（= 挑中目标的质心），
    //  箭按同一个点往外撒。若改取「第一个目标」，箭会散到圈外 —— 就是第 57 批用户投诉的
    //  「圈在这头、箭落那头」。
    assert.deepEqual([center.x, center.y], [42, 5], '圆心 = (40,0) 与 (44,10) 的中点');
    //  圈心与箭群同源（同一份 centerX/centerY），不是各算一遍
    const { bullets } = splitRain(state.combatEvents);
    const sumX = bullets.reduce((acc, bullet) => acc + (bullet.flyToX as number), 0) / bullets.length;
    const sumY = bullets.reduce((acc, bullet) => acc + (bullet.flyToY as number), 0) / bullets.length;
    assert.ok(Math.abs(center.x - sumX) < 63 * 0.2 && Math.abs(center.y - sumY) < 63 * 0.2,
        `圈心 ${center.x},${center.y} 与箭群中心 ${sumX},${sumY} 相距过远`);
    //  施法者 (0,0) 与半径外那只 (400,400) 都不许被算进来
    assert.ok(Math.hypot(center.x, center.y) > 1, '不许退回施法者脚下');
    assert.ok(center.x < 100, '半径外那只不许被算进来');
});

test('⑥ centerOut：非弹道雨单位 ⇒ 回填「第一个目标」的本体坐标，不是质心', () => {
    prepare();
    //  101003（镭射飞龙）不在 ZC_BULLET_RAIN_UNITS 里 ⇒ 走通用分支，没有散布中心这回事。
    const caster = makeUnit(1, ZCOwner.Player, 0, 0, '101003');
    const enemies = [
        makeUnit(2, ZCOwner.Enemy, 40, 0, '68028'),
        makeUnit(3, ZCOwner.Enemy, 44, 10, '68028'),
    ];
    const units = [caster, ...enemies];
    const state = makeState(units);
    const { context } = strikeContext(units);
    const center = { x: Number.NaN, y: Number.NaN };
    assert.ok(ZCSkillResolutionSystem.strikeTargets(state, caster,
        strikeOptions({ centerOut: center }), context) >= 1);
    //  用户口径「光圈切换到下个目标」⇒ 圈心必须**正好压在某个敌人身上**，
    //  取质心会让圈飘在两只敌人中间的空地上。
    const onSomeone = [[40, 0], [44, 10]].some(([x, y]) => center.x === x && center.y === y);
    assert.ok(onSomeone, `圆心 ${center.x},${center.y} 必须正好是某个目标的坐标`);
    assert.ok(!(center.x === 42 && center.y === 5), '通用分支不许退回质心');
    assert.ok(Math.hypot(center.x, center.y) > 1, '不许退回施法者脚下');
});

test('⑥ centerOut：0 目标且非保底 ⇒ 不写（保持 NaN，圈心退回施法者而不是飘到 0,0）', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    const state = makeState([caster]);
    const { context } = strikeContext([caster]);
    const center = { x: Number.NaN, y: Number.NaN };
    assert.equal(ZCSkillResolutionSystem.strikeTargets(state, caster,
        strikeOptions({ centerOut: center }), context), 0);
    assert.ok(Number.isNaN(center.x) && Number.isNaN(center.y),
        '没打出去就不该有中心 —— 写个 0,0 会让圈跑到地图原点');
});

test('⑥ centerOut：保底那一波（0 目标 + forceVisual）用散布中心，与子弹落点同源', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    const corpse = { ...makeUnit(2, ZCOwner.Enemy, 40, 0, '68028'), hp: 0, battleState: 'dead' as const };
    const units = [caster, corpse];
    const state = makeState(units);
    const { context } = strikeContext(units);
    const center = { x: Number.NaN, y: Number.NaN };
    ZCSkillResolutionSystem.strikeTargets(state, caster,
        strikeOptions({ centerOut: center, forceVisual: true }), context);
    const { bullets } = splitRain(state.combatEvents);
    assert.ok(bullets.length > 0);
    const sumX = bullets.reduce((acc, bullet) => acc + (bullet.flyToX as number), 0) / bullets.length;
    const sumY = bullets.reduce((acc, bullet) => acc + (bullet.flyToY as number), 0) / bullets.length;
    //  散布中心 = 圈心。落点带随机偏移，所以箭群质心**不必**精确等于中心，
    //  但两者必须落在同一个「区域」里 —— 容差取散布半径的 20%，偏出去就是「圈在这头、箭落那头」。
    const tolerance = 63 * 0.2;
    assert.ok(Math.abs(center.x - sumX) < tolerance, `圈心 ${center.x} 与箭群中心 ${sumX} 相距过远`);
    assert.ok(Math.abs(center.y - sumY) < tolerance, `圈心 ${center.y} 与箭群中心 ${sumY} 相距过远`);
    //  而且必须真的离开施法者脚下（否则等于没改）
    assert.ok(Math.hypot(center.x, center.y) > 1, `圈心 ${center.x},${center.y} 还在自己脚下`);
});

test('⑥ 白环：默认仍不跟随（存量逐字不变）；followCenter 时原地挪过去并续命，不叠圈', () => {
    const state = makeState([]) as unknown as { elapsedSeconds: number; combatEvents: any[] };
    const base = {
        logicRadius: 210, worldRadius: 63, seconds: 6,
        owner: ZCOwner.Player, sourceUnitId: 9, skillId: 100804, skillName: 'random_strike',
    };
    assert.equal(pushSkillRangeRingEvent(state as never, { ...base, x: 0, y: 0 }), true);
    //  缺省（冰山陨落那条路）⇒ 窗口内不重建，旧行为一个字节不变
    state.elapsedSeconds = 3;
    assert.equal(pushSkillRangeRingEvent(state as never, { ...base, x: 50, y: 20 }), false);
    assert.equal(state.combatEvents.length, 1);

    //  跟随档：同一条事件挪过去，不新增
    assert.equal(pushSkillRangeRingEvent(state as never, { ...base, x: 50, y: 20 }, true), true);
    assert.equal(state.combatEvents.length, 1, '跟随必须复用同一条，否则叠成年轮');
    const ring = state.combatEvents[0];
    assert.deepEqual([ring.fromX, ring.fromY, ring.toX, ring.toY], [50, 20, 50, 20]);
    assert.equal(ring.startedAt, 3, '续命：startedAt 跟着走到这一拍');
    assert.equal(ring.durationSeconds, 6);
});

test('⑥ 源码守卫：圈心必须由 strikeTargets 回填，不许在触发系统里重算', () => {
    const root = process.cwd();
    const trigger = readFileSync(join(root, 'assets/script/app/zcds/model/systems/ZCSkillTriggerSystem.ts'), 'utf8');
    assert.match(trigger, /centerOut: strikeCenter,/, '这一次出手没有把中心回填口子接上');
    assert.match(trigger, /pushStrikeRangeRing\(state, unit, params, radius, searchRadius, context, runtime, strikeCenter\)/,
        '画圈没有用回填的中心 ⇒ 又会画在施法者脚下');
    //  窗口内每波都要挪圈，否则「第一秒的圈、第五秒的箭」
    assert.match(trigger, /fire\(true\);[\s\S]{0,600}?pushStrikeRangeRing\(/,
        '窗口内每一波都要把圈挪到这一波的散布中心');
    //  寿命取剩余窗口，不能把圈续到技能结束之后
    assert.match(trigger, /unit\.strikeUntil - state\.elapsedSeconds/,
        '窗口内的圈必须按剩余时长续命');

    const skill = readFileSync(join(root, 'assets/script/app/zcds/model/systems/ZCSkillResolutionSystem.ts'), 'utf8');
    assert.match(skill, /options\.centerOut\.x = centerX;/, '弹道雨通道的圈心要用散布中心');
    //  通用分支（急冻光线 / 镭射飞龙这类「挑 N 人各发一颗」）取**第一个目标**：
    //  用户口径「光圈切换到下个目标」⇒ 圈要压在有人站的地方，不是敌群中间的空地。
    assert.match(skill, /const spot = context\.unitPosition\(victims\[0\]\.unit\);/, '通用分支按第一个目标回填');
    assert.match(skill, /options\.centerOut\.x = spot\.x;/, '通用分支把目标坐标写回去');
});

/* ────────────── 七、第 58 批：逐颗出手 / 起点抬高 / 光圈滑动（不瞬移） ────────────── */

/**
 * 用户口径（2026-11-26 第二批）：
 * 「这类技能的子弹是逐个射出去的 不是逐轮的齐射，不停的发射，每个子弹有 0.1s 左右的间隔，
 *   光圈（白色指示圈）切换到下个目标是快速移动（150px 速度），不要直接瞬移」
 * 「这一批发射子弹的位置要在角色图片的中心位置往上 5px，现在子弹发射的位置太低了」
 */
test('⑦ 逐颗出手：一批 N 颗的 startedAt 依次 +0.1s，命中特效跟着各自那颗', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    const enemies = [
        makeUnit(2, ZCOwner.Enemy, 40, 0, '68028'),
        makeUnit(3, ZCOwner.Enemy, 44, 10, '68028'),
    ];
    const units = [caster, ...enemies];
    const state = makeState(units);
    const { context } = strikeContext(units);
    ZCSkillResolutionSystem.strikeTargets(state, caster, strikeOptions(), context);

    const { bullets, impacts } = splitRain(state.combatEvents);
    assert.equal(bullets.length, 5, '配表 strikeCount = 5');
    //  起手时刻必须严格递增 0.1s —— 齐射（全部同一拍）就是用户说的「逐轮」。
    for (let index = 0; index < bullets.length; index += 1) {
        const expected = index * 0.1;
        assert.ok(Math.abs(Number(bullets[index].startedAt) - expected) < 1e-9,
            `第 ${index} 颗应在 ${expected}s 出手，实际 ${bullets[index].startedAt}`);
    }
    //  每一颗的落点各不相同（逐颗撒开才看得出是「连发」）
    const lands = bullets.map((bullet) => `${bullet.flyToX},${bullet.flyToY}`);
    assert.equal(new Set(lands).size, lands.length, '落点两两不同');
    //  命中特效的时刻各自跟着那颗走，不是全挤在第一颗落地
    for (const bullet of bullets) {
        const impact = impacts.find((item) => item.toX === bullet.flyToX && item.toY === bullet.flyToY);
        assert.ok(impact, '落点没有命中特效');
        assert.ok(Math.abs(Number(impact.startedAt)
            - (Number(bullet.startedAt) + Number(bullet.flyInSeconds))) < 1e-6);
    }
});

test('⑦ 起点抬高 25px（脚点 → 角色图片中心再 +5），三张卡一致', () => {
    assert.equal(ZC_BULLET_RAIN_ORIGIN_LIFT_PX, 25,
        '20 = 既有「脚点→身体中心」补偿（yulinDart 同口径），+5 是用户要的那 5px');
    for (const unitId of ['68008', '68024', '68030']) {
        //  起点抬升按通道写在三个推送点上，全卡共用同一个常量
        assert.ok(ZC_BULLET_RAIN_ORIGIN_LIFT_PX > 0, `${unitId} 必须有抬升`);
    }
    const root = process.cwd();
    const skill = readFileSync(join(root, 'assets/script/app/zcds/model/systems/ZCSkillResolutionSystem.ts'), 'utf8');
    const zone = readFileSync(join(root, 'assets/script/app/zcds/model/systems/ZCGroundZoneSystem.ts'), 'utf8');
    //  skill 文件里 strike / aura 两条通道各一处
    assert.equal((skill.match(/visualLiftPx: ZC_BULLET_RAIN_ORIGIN_LIFT_PX,/g) ?? []).length, 2,
        'strike 与 aura 两条通道都要抬升');
    //  zone 通道要叠在区域自己的抬升上（区域有抬升时不能把它冲掉）
    assert.match(zone, /visualLiftPx: \(zone\.visualLiftPx \?\? 0\) \+ ZC_BULLET_RAIN_ORIGIN_LIFT_PX,/,
        '篮球火的子弹抬升必须叠在区域抬升之上');
});

test('⑦ 光圈滑动：150px/s，不是瞬移；走完停在新位置', () => {
    const state = makeState([]) as unknown as { elapsedSeconds: number; combatEvents: any[] };
    const base = {
        logicRadius: 210, worldRadius: 63, seconds: 6,
        owner: ZCOwner.Player, sourceUnitId: 9, skillId: 100804, skillName: 'random_strike',
    };
    assert.equal(pushSkillRangeRingEvent(state as never, { ...base, x: 0, y: 0 }), true);
    state.elapsedSeconds = 1;
    //  挪到 (30, 40)：距离 50 ⇒ 50 / 150 = 0.333s 走完
    assert.equal(pushSkillRangeRingEvent(state as never, { ...base, x: 30, y: 40 }, true), true);
    const ring = state.combatEvents[0];
    assert.equal(ring.slideFromX, 0, '滑动起点 = 上一次的位置');
    assert.equal(ring.slideFromY, 0);
    assert.equal(ring.slideStartAt, 1);
    assert.ok(Math.abs(ring.slideSeconds - 50 / ZC_SKILL_RANGE_RING_SLIDE_SPEED) < 1e-9,
        `滑动时长应为 距离 ÷ 150，实际 ${ring.slideSeconds}`);

    //  视图侧按进度插值：中途在线上、走完正好停在新位置
    const mid = zcCombatEffectSlidePoint(ring, 1 + ring.slideSeconds * 0.5);
    assert.ok(Math.abs(mid.x - 15) < 1e-6 && Math.abs(mid.y - 20) < 1e-6, `中点应是 (15,20)，实际 ${mid.x},${mid.y}`);
    const done = zcCombatEffectSlidePoint(ring, 1 + ring.slideSeconds + 1);
    assert.deepEqual([done.x, done.y], [30, 40], '走完要停在新位置（不是继续飘）');
    //  负时间（时钟回拨 / 快照重算）按起点处理，别把圈甩到反方向
    assert.deepEqual(zcCombatEffectSlidePoint(ring, 0), { x: 0, y: 0 });
    //  没登记滑动 ⇒ 直接用 to（存量逐字不变）
    assert.deepEqual(zcCombatEffectSlidePoint({ toX: 7, toY: 8, startedAt: 0 }, 5), { x: 7, y: 8 });
});

test('⑦ 光圈滑动的源码接线：模型层算 slideSeconds、视图层走 slidePoint', () => {
    const root = process.cwd();
    const ring = readFileSync(join(root, 'assets/script/app/zcds/model/ZCSkillRangeRingFx.ts'), 'utf8');
    assert.match(ring, /alive\.slideSeconds = distance \/ ZC_SKILL_RANGE_RING_SLIDE_SPEED;/,
        '模型层必须按 150px/s 算这一段要走多久');
    assert.match(ring, /alive\.slideFromX = alive\.toX;/, '滑动起点必须是上一次的位置');
    //  位移小于半像素按瞬移处理（省一次无意义插值），四个字段一起清掉
    assert.match(ring, /alive\.slideSeconds = undefined;/, '原地微调要退回瞬移档');
    const view = readFileSync(join(root, 'assets/script/app/zcds/view/ZCCombatEffectView.ts'), 'utf8');
    assert.match(view, /const slide = zcCombatEffectSlidePoint\(event, now\);/, '视图必须走插值');
    assert.match(view, /mapToViewX\(slide\.x\)/, '位置要用插值结果，不能还用 toX');
});
