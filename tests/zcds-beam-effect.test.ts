import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
    ZC_BEAM_MIN_LENGTH,
    zcBeamFrame,
    zcBeamSpecOf,
    zcBeamWidthScaleOf,
} from '../assets/script/app/zcds/view/ZCBeamEffect';

/**
 * 镭射飞龙光束（2026-10-31 需求）。
 *
 * 需求原话：「镭射飞龙的攻击效果没有按照案子中使用 units\projectiles\镭射飞龙_普攻 序列帧图片做成
 * 预制子弹…从飞龙的眼睛位置发射，线段的另一端点朝向受击目标，飞龙的技能可以将子弹多个子弹拼接
 * 来实现超长子弹距离的效果或者拉伸预制体实现」。
 *
 * 这里锁两件事：
 *   ① 几何：发射口从单位中心按"前伸 34 / 上抬 16"挪出去，角度对住弹道，长度只到弹头；
 *   ② 资源：预制体真的从 19 帧散图建出来了，而且**锚点在左端**（否则拉伸会两头一起长）。
 */

const PREFAB_PATH = 'units/projectiles/镭射飞龙_普攻/镭射飞龙_普攻';
const SET_DIR = 'assets/bundles/battle/units/projectiles/镭射飞龙_普攻';

const close = (actual: number, expected: number, message: string): void => {
    assert.ok(Math.abs(actual - expected) < 1e-6, `${message}（实际 ${actual} / 期望 ${expected}）`);
};

test('光束配置按预制体路径登记，未登记的一律走通用弹道', () => {
    const spec = zcBeamSpecOf(PREFAB_PATH);
    assert.ok(spec, '镭射飞龙的光束必须登记');
    assert.equal(spec!.muzzleForward, 34);
    assert.equal(spec!.muzzleLift, 16);
    assert.equal(spec!.widthScale, 0.65, '基准宽度按原画长厚比定');

    assert.equal(zcBeamSpecOf('units/projectiles/风法师_绿风/风法师_绿风'), null, '别的弹道不能被误判成光束');
    assert.equal(zcBeamSpecOf(null), null);
    assert.equal(zcBeamSpecOf(''), null);
});

test('正前方目标：发射口前伸 34、整体上抬 16，长度是发射口到弹头的距离', () => {    const frame = zcBeamFrame({ x: 0, y: 0 }, { x: 1000, y: 0 }, zcBeamSpecOf(PREFAB_PATH)!);
    close(frame.x, 34, '发射口沿弹道前伸');
    close(frame.y, 16, '发射口上抬（竖直，不跟弹道转）');
    close(frame.angleDegrees, 0, '朝右为正角度');
    close(frame.length, Math.hypot(1000 - 34, 0 - 16), '长度连到弹头');
});

test('正上方目标：前伸量跟着朝向转到竖直，上抬仍走世界竖直', () => {
    const frame = zcBeamFrame({ x: 0, y: 0 }, { x: 0, y: 1000 }, zcBeamSpecOf(PREFAB_PATH)!);
    close(frame.x, 0, '竖直弹道不该有横向偏移');
    close(frame.y, 50, '34 前伸 + 16 上抬');
    close(frame.angleDegrees, 90, '朝上 90 度');
    close(frame.length, 950, '长度 = 1000 - 50');
});

test('斜向 45°：前伸按 cos/sin 分摊到两轴', () => {
    const frame = zcBeamFrame({ x: 100, y: 100 }, { x: 1100, y: 1100 }, zcBeamSpecOf(PREFAB_PATH)!);
    const k = 34 / Math.SQRT2;
    close(frame.x, 100 + k, '横向前伸');
    close(frame.y, 100 + k + 16, '纵向前伸 + 上抬');
    close(frame.angleDegrees, 45, '45 度');
});

test('贴脸：目标比前伸量还近时，前伸最多吃掉半程（否则光束会朝反方向射出去）', () => {
    const frame = zcBeamFrame({ x: 0, y: 0 }, { x: 20, y: 0 }, zcBeamSpecOf(PREFAB_PATH)!);
    close(frame.x, 10, '前伸被压到 20 的一半');
    close(frame.y, 16, '上抬不受影响');
    close(frame.angleDegrees, 0, '朝向不变');
    close(frame.length, Math.hypot(20 - 10, 0 - 16), '只剩后半程');
});

test('两端重合时不产生 NaN，退化成一截最短的线', () => {
    const frame = zcBeamFrame({ x: 0, y: 0 }, { x: 0, y: 0 }, zcBeamSpecOf(PREFAB_PATH)!);
    close(frame.angleDegrees, 0, '没有方向时按朝右');
    close(frame.y, 16, '只留上抬');
    assert.ok(frame.length >= ZC_BEAM_MIN_LENGTH, '长度不能被压到 0（会整条消失）');
    // 前伸被压到 0（`span * 0.5`），只剩上抬这 16 个单位撑住一截。
    close(frame.length, 16, '重合时靠上抬撑出一截');
});

test('预制体从 19 帧散图建出来了，且锚点在左端', () => {
    const prefabFile = `${SET_DIR}/镭射飞龙_普攻.prefab`;
    assert.ok(existsSync(prefabFile), '缺少预制体');
    const nodes = JSON.parse(readFileSync(prefabFile, 'utf8')) as Array<Record<string, unknown>>;
    const root = nodes.find((item) => item.__type__ === 'cc.Node') as Record<string, any>;
    const transform = nodes.find((item) => item.__type__ === 'cc.UITransform') as Record<string, any>;

    assert.deepEqual([root._lpos.x, root._lpos.y], [0, 0], '根节点不许带美术偏置（发射点由运行时给）');
    assert.deepEqual([transform._anchorPoint.x, transform._anchorPoint.y], [0, 0.5], '锚点必须在左端');

    const frames = readdirSync(`${SET_DIR}/atlas`).filter((name) => name.endsWith('.png'));
    assert.equal(frames.length, 19, '19 帧全要在图集目录里');
    assert.ok(existsSync(`${SET_DIR}/atlas/镭射飞龙_普攻.pac`), '缺图集');
    assert.ok(existsSync(`${SET_DIR}/anim/镭射飞龙_普攻-loop.anim`), '缺循环动画');

    const clip = JSON.parse(readFileSync(`${SET_DIR}/anim/镭射飞龙_普攻-loop.anim`, 'utf8')) as Record<string, any>;
    const keys = clip._tracks[0]._channel._curve._values as unknown[];
    assert.equal(keys.length, 19, '动画要串满 19 帧');
    assert.equal(clip.wrapMode, 2, '光束是常驻循环');
});

test('镭射死光（30845）比普攻更粗，但共用同一份美术', () => {
    const spec = zcBeamSpecOf(PREFAB_PATH)!;
    assert.ok(Math.abs(zcBeamWidthScaleOf(spec, 30719) - 0.65) < 1e-9, '普攻用基准宽度');
    assert.ok(Math.abs(zcBeamWidthScaleOf(spec, 30845) - 0.65 * 1.3) < 1e-9, '死光是同一根光束的 1.3 倍粗');
    assert.ok(Math.abs(zcBeamWidthScaleOf(spec, undefined) - 0.65) < 1e-9, '没带技能号时用基准宽度');
    assert.ok(Math.abs(zcBeamWidthScaleOf(spec, 99999) - 0.65) < 1e-9, '没登记的技能号也用基准宽度');
});

test('两条技能行都指向这份光束预制体（remoteRef 与 client 逐格互校）', () => {
    const rowsOf = (path: string): Map<number, string> => {
        const raw = JSON.parse(readFileSync(path, 'utf8'));
        const rows = Array.isArray(raw)
            ? raw
            : raw.v.map((values: unknown[]) => Object.fromEntries(raw.k.map((key: string, index: number) => [key, values[index]])));
        return new Map(rows.map((row: Record<string, unknown>) => [Number(row.skillId), String(row.effectPrefabPath ?? '')]));
    };
    for (const path of ['assets/remoteRef/pvpSkill.json', '../doc/塔防数据配置/json/client/pvpSkill.json']) {
        const rows = rowsOf(path);
        assert.equal(rows.get(30719), PREFAB_PATH, `${path} 的普攻`);
        assert.equal(rows.get(30845), PREFAB_PATH, `${path} 的镭射死光`);
    }
    // 守卫：`zcBeamSpecOf` 只认这个路径，两边写成别的就静默退回「移动小图」。
    assert.ok(zcBeamSpecOf(PREFAB_PATH), '配表路径必须能被光束配置认出来');
});
