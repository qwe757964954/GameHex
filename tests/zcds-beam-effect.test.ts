import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
    ZC_BEAM_MIN_LENGTH,
    zcBeamCoreWidthOf,
    zcBeamFrame,
    zcBeamSpecOf,
    zcBeamStretchOf,
    zcBeamWidthScaleOf,
} from '../assets/script/app/zcds/view/ZCBeamEffect';

/**
 * 镭射飞龙光束（2026-10-31 需求）。
 *
 * 需求原话：「镭射飞龙的攻击效果没有按照案子中使用 units\projectiles\镭射飞龙_普攻 序列帧图片做成
 * 预制子弹…从飞龙的眼睛位置发射，线段的另一端点朝向受击目标，飞龙的技能可以将子弹多个子弹拼接
 * 来实现超长子弹距离的效果或者拉伸预制体实现」。
 *
 * 2026-11-02 复盘三处硬伤（用户截图「模型消失 / 没从眼睛发射 / 有倾斜角」）：
 *   ① 上抬 16 是**脚踝高度**：单位根节点是逻辑脚点（spine 骨架原点≈脚底），龙眼要 +44；
 *   ② 宽度 0.65 是按**整张画布**的长厚比算的，但画布里真正不透明的亮芯只有 5~9px
 *      ⇒ 屏幕上 3px、四成透明，等于消失；
 *   ③ 直接按画布宽拉伸 ⇒ 可见段只有 82%、起点晚 5%，线条既没从嘴里出来也没打到人。
 *
 * 这里锁四件事：
 *   ① 几何：发射口从单位**脚点**按"前伸 8 / 上抬 44"挪出去，角度对住弹道，长度只到弹头；
 *   ② 拉伸：按**可见段**归一化，`scaleX` 与左侧留白位移成对给出；
 *   ③ 兜底：美术缺失时有线宽，不许「整条光束凭空消失」；
 *   ④ 资源：预制体真的从 19 帧散图建出来了，而且**锚点在左端**（否则拉伸会两头一起长）。
 */

const PREFAB_PATH = 'units/projectiles/镭射飞龙_普攻/镭射飞龙_普攻';
const SET_DIR = 'assets/bundles/battle/units/projectiles/镭射飞龙_普攻';
const CANVAS_WIDTH = 640;

const close = (actual: number, expected: number, message: string): void => {
    assert.ok(Math.abs(actual - expected) < 1e-6, `${message}（实际 ${actual} / 期望 ${expected}）`);
};

test('光束配置按预制体路径登记，未登记的一律走通用弹道', () => {
    const spec = zcBeamSpecOf(PREFAB_PATH);
    assert.ok(spec, '镭射飞龙的光束必须登记');
    assert.equal(spec!.muzzleForward, 8);
    assert.equal(spec!.muzzleLift, 44, '单位原点是脚点，龙眼在头部而不是脚踝');
    assert.equal(spec!.widthScale, 1.8, '按亮芯 5~9px 反推，不能按整张画布的长厚比');
    assert.equal(spec!.coreWidth, 10, '兜底线宽要盖得住地块底色');
    assert.ok(spec!.contentEnd > spec!.contentStart, '可见段区间必须有效');

    assert.equal(zcBeamSpecOf('units/projectiles/风法师_绿风/风法师_绿风'), null, '别的弹道不能被误判成光束');
    assert.equal(zcBeamSpecOf(null), null);
    assert.equal(zcBeamSpecOf(''), null);
});

test('正前方目标：发射口前伸 8、整体上抬 44，长度是发射口到弹头的距离', () => {
    const frame = zcBeamFrame({ x: 0, y: 0 }, { x: 1000, y: 0 }, zcBeamSpecOf(PREFAB_PATH)!);
    close(frame.x, 8, '发射口沿弹道前伸');
    close(frame.y, 44, '发射口上抬到龙眼（竖直，不跟弹道转）');
    close(frame.angleDegrees, 0, '朝右为正角度');
    close(frame.length, Math.hypot(1000 - 8, 0 - 44), '长度连到弹头');
});

test('正上方目标：前伸量跟着朝向转到竖直，上抬仍走世界竖直', () => {
    const frame = zcBeamFrame({ x: 0, y: 0 }, { x: 0, y: 1000 }, zcBeamSpecOf(PREFAB_PATH)!);
    close(frame.x, 0, '竖直弹道不该有横向偏移');
    close(frame.y, 52, '8 前伸 + 44 上抬');
    close(frame.angleDegrees, 90, '朝上 90 度');
    close(frame.length, 948, '长度 = 1000 - 52');
});

test('斜向 45°：前伸按 cos/sin 分摊到两轴', () => {
    const frame = zcBeamFrame({ x: 100, y: 100 }, { x: 1100, y: 1100 }, zcBeamSpecOf(PREFAB_PATH)!);
    const k = 8 / Math.SQRT2;
    close(frame.x, 100 + k, '横向前伸');
    close(frame.y, 100 + k + 44, '纵向前伸 + 上抬');
    close(frame.angleDegrees, 45, '45 度');
});

test('贴脸：目标比前伸量还近时，前伸最多吃掉半程（否则光束会朝反方向射出去）', () => {
    const frame = zcBeamFrame({ x: 0, y: 0 }, { x: 20, y: 0 }, zcBeamSpecOf(PREFAB_PATH)!);
    close(frame.x, 8, '前伸只有 8，没吃掉半程');
    close(frame.y, 44, '上抬不受影响');
    close(frame.angleDegrees, 0, '朝向不变');
    close(frame.length, Math.hypot(20 - 8, 0 - 44), '只剩后半程');
});

test('超贴脸：前伸被半程压住，光束不会反过来射', () => {
    const frame = zcBeamFrame({ x: 0, y: 0 }, { x: 6, y: 0 }, zcBeamSpecOf(PREFAB_PATH)!);
    close(frame.x, 3, '前伸被压到 6 的一半');
    assert.ok(frame.length >= ZC_BEAM_MIN_LENGTH, '长度不能被压到 0');
});

test('两端重合时不产生 NaN，退化成一截最短的线', () => {
    const frame = zcBeamFrame({ x: 0, y: 0 }, { x: 0, y: 0 }, zcBeamSpecOf(PREFAB_PATH)!);
    close(frame.angleDegrees, 0, '没有方向时按朝右');
    close(frame.y, 44, '只留上抬');
    assert.ok(frame.length >= ZC_BEAM_MIN_LENGTH, '长度不能被压到 0（会整条消失）');
    close(frame.length, 44, '重合时靠上抬撑出一截');
});

test('拉伸按**可见段**归一化：线条起点落在锚点、末端正好到弹头', () => {
    const spec = zcBeamSpecOf(PREFAB_PATH)!;
    const visible = (spec.contentEnd - spec.contentStart) * CANVAS_WIDTH;
    assert.ok(Math.abs(visible - 524) < 1e-6, '画布里真正有线的那一段 ≈ 524px（32~556）');

    // 可见段原尺寸 ⇒ 不用缩放，但左侧留白必须推到锚点外面
    const unit = zcBeamStretchOf(spec, CANVAS_WIDTH, visible);
    close(unit.scaleX, 1, '可见段原尺寸 = 1 倍');
    close(unit.offsetX, -spec.contentStart * CANVAS_WIDTH, '留白（32px）推到锚点左侧');

    // 拉成两倍 ⇒ 起止都跟着走，位移也要跟着扩
    const doubled = zcBeamStretchOf(spec, CANVAS_WIDTH, visible * 2);
    close(doubled.scaleX, 2, '长度翻倍则 scaleX 翻倍');
    close(doubled.offsetX, -spec.contentStart * CANVAS_WIDTH * 2, '留白位移按同一比例扩');

    // 落到 550 射程那一档（视图长度 ≈ 423）时的实际倍率
    const far = zcBeamStretchOf(spec, CANVAS_WIDTH, 423);
    close(far.scaleX, 423 / 524, '长度 / 可见段宽度');
    assert.ok(far.scaleX < 1, '满射程下是缩，不是拉');
});

test('拉伸有下限：长度被压到 0 时不会把预制体缩成看不见', () => {
    const spec = zcBeamSpecOf(PREFAB_PATH)!;
    const degenerate = zcBeamStretchOf(spec, CANVAS_WIDTH, 0);
    assert.ok(degenerate.scaleX > 0, 'scaleX 不能是 0');
    close(degenerate.scaleX, ZC_BEAM_MIN_LENGTH / 524, '按最短长度兜底');
});

test('兜底线宽：普攻 10px，镭射死光同比例加粗', () => {
    const spec = zcBeamSpecOf(PREFAB_PATH)!;
    assert.ok(Math.abs(zcBeamCoreWidthOf(spec, 30719) - 10) < 1e-9);
    assert.ok(Math.abs(zcBeamCoreWidthOf(spec, 30845) - 13) < 1e-9);
    assert.ok(Math.abs(zcBeamCoreWidthOf(spec, undefined) - 10) < 1e-9);
});

test('预制体从 19 帧散图建出来了，且锚点在左端', () => {
    const prefabFile = `${SET_DIR}/镭射飞龙_普攻.prefab`;
    assert.ok(existsSync(prefabFile), '缺少预制体');
    const nodes = JSON.parse(readFileSync(prefabFile, 'utf8')) as Array<Record<string, unknown>>;
    const root = nodes.find((item) => item.__type__ === 'cc.Node') as Record<string, any>;
    const transform = nodes.find((item) => item.__type__ === 'cc.UITransform') as Record<string, any>;

    assert.deepEqual([root._lpos.x, root._lpos.y], [0, 0], '根节点不许带美术偏置（发射点由运行时给）');
    assert.deepEqual([transform._anchorPoint.x, transform._anchorPoint.y], [0, 0.5], '锚点必须在左端');
    assert.equal(transform._contentSize.width, CANVAS_WIDTH, '画布宽度是拉伸的分母，改美术时要同步改测试');

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
    assert.ok(Math.abs(zcBeamWidthScaleOf(spec, 30719) - 1.8) < 1e-9, '普攻用基准宽度');
    assert.ok(Math.abs(zcBeamWidthScaleOf(spec, 30845) - 1.8 * 1.3) < 1e-9, '死光是同一根光束的 1.3 倍粗');
    assert.ok(Math.abs(zcBeamWidthScaleOf(spec, undefined) - 1.8) < 1e-9, '没带技能号时用基准宽度');
    assert.ok(Math.abs(zcBeamWidthScaleOf(spec, 99999) - 1.8) < 1e-9, '没登记的技能号也用基准宽度');
});

test('源码守卫：光束配置在 `if (!prefab) return` 之前认出来，且缺美术时有兜底线', () => {
    const source = readFileSync('assets/script/app/zcds/view/ZCCombatEffectView.ts', 'utf8');
    const init = source.slice(source.indexOf('initialize('), source.indexOf('render('));
    const specAt = init.indexOf('zcBeamSpecOf(effectPrefabPath)');
    const returnAt = init.indexOf('if (!prefab) return;');
    assert.ok(specAt >= 0 && returnAt >= 0, 'initialize 里两个锚点都要在');
    assert.ok(specAt < returnAt,
        'beamSpec 必须先认出来：放在 early-return 后面的话，美术没加载时 beamSpec 恒 null，'
        + '整条光束会静默消失（2026-11-02）');
    assert.equal(init.indexOf('zcBeamSpecOf(effectPrefabPath)', specAt + 1), -1, '只认一次，别在下面又写一遍');

    const projectile = source.slice(source.indexOf("if (event.type === 'projectile')"));
    assert.match(projectile, /this\.beamSpec\s*\)\s*\{/, 'projectile 分支按 beamSpec 判定，不依赖 visualNode');
    assert.match(projectile, /drawBeamFallback\(/, '没有美术时必须画兜底线');
    const fallback = source.slice(source.indexOf('private drawBeamFallback'));
    assert.match(fallback, /graphics\.clear\(\)/, '兜底线每帧自己清（projectile 只在首帧清过）');
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
