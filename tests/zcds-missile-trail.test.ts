import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    zcMissileTrailOf, zcMissileTrailPaths, zcMissileTrailQuads,
} from '../assets/script/app/zcds/view/ZCMissileTrail';
import { zcCombatEffectNodeScaleOf } from '../assets/script/app/zcds/view/ZCCombatEffectScale';

/**
 * 弹道拖尾。
 *
 * 2026-11-05 原始需求：「增加一个倒三角的拖尾，拖尾从子弹部分向外倒三角且逐渐变透明」；
 * 2026-11-06 用户看图后纠正方向：「拖尾的方向做反了，末端窄，和子弹相接触的部分是宽的，
 * 宽度和子弹半径相近，屏幕上的长度改成 80px」。
 *
 * ⇒ 定稿形状是**宽端贴弹体、往外收成尖**的锥形尾焰。这一条钉四件事：
 * ① **锥形方向**：贴弹体那端宽、远端窄（`rootHalfWidth > tipHalfWidth`），且宽度**线性**收窄
 *   （两条边是直线；缓动会把边画成内凹弧，就不像锥了）；
 * ② **接触端 ≈ 子弹半径**：`2 × rootHalfWidth × 宿主缩放` 要对得上弹体屏上半径（所以是"半径"，
 *   不是直径 —— 一个常见的手滑点）；
 * ③ **往外渐隐**：每段 alpha 严格递减，最后一段基本为 0（不是"整条一样浓"）；
 * ④ **方向**：沿本地 -X 伸展（宿主节点 +X 已被 `ZCCombatEffectView` 转成飞行方向），
 *   所以拖尾永远在弹体后面，跟着弧线一起飞。
 */

const MISSILE_PREFAB = 'units/projectiles/镭射飞龙_导弹技能/镭射飞龙_导弹技能';

test('拖尾：只给登记过的弹体画，普通弹道一律 null', () => {
    const spec = zcMissileTrailOf(MISSILE_PREFAB);
    assert.ok(spec, '镭射飞龙的导弹弹体必须登记拖尾');
    //  2026-11-06 需求「拖尾改成 255 的纯白色」；渐隐只靠 alpha，所以三个通道必须相等且拉满。
    assert.deepEqual([...spec.color], [255, 255, 255], '拖尾必须是 255 纯白');
    assert.equal(zcMissileTrailOf('units/projectiles/镭射飞龙_普攻/镭射飞龙_普攻'), null, '普攻光束没有拖尾');
    assert.equal(zcMissileTrailOf(''), null);
    assert.equal(zcMissileTrailOf(null), null);
    assert.equal(zcMissileTrailOf(undefined), null);
    assert.deepEqual(zcMissileTrailPaths(), [MISSILE_PREFAB]);
});

test('拖尾：每条登记的配置都是「宽端贴弹体、往外收成尖」、长度为正、起点在弹体后方', () => {
    for (const path of zcMissileTrailPaths()) {
        const spec = zcMissileTrailOf(path)!;
        assert.ok(spec.length > 0, `${path} 长度必须为正`);
        assert.ok(spec.rootHalfWidth > spec.tipHalfWidth,
            `${path} 贴弹体那端必须更宽、往外收成尖（2026-11-06 纠正：末端窄、接触子弹的部分宽）`);
        assert.ok(spec.rootHalfWidth > 0, `${path} 接触端不能是 0 宽（那样贴不住弹体）`);
        assert.ok(spec.tipHalfWidth > 0, `${path} 末端也不能是负宽/零宽（会画成反向三角形）`);
        assert.ok(spec.startX < 0, `${path} 起点必须在弹体中心后方（本地 -X）`);
        assert.ok(spec.slices >= 4, `${path} 段数太少会看出"分层"`);
        assert.ok(spec.alpha > 0 && spec.alpha <= 1, `${path} 起点不透明度要在 (0,1]`);
        assert.equal(spec.color.length, 3);
    }
});

test('拖尾：切成 N 段，宽度线性收窄、透明度段段递减、末端基本消失', () => {
    const spec = zcMissileTrailOf(MISSILE_PREFAB)!;
    const quads = zcMissileTrailQuads(spec);
    assert.equal(quads.length, spec.slices);
    //  ① 方向：每段都往本地 -X 走（x1 比 x0 更负），且首尾对齐 startX / startX - length
    assert.ok(Math.abs(quads[0].x0 - spec.startX) < 1e-9, '第一段近端 = startX');
    const tail = quads[quads.length - 1];
    assert.ok(Math.abs(tail.x1 - (spec.startX - spec.length)) < 1e-9, '最后一段远端 = startX - length');
    for (const quad of quads) assert.ok(quad.x1 < quad.x0, '每段都要向外延伸');
    //  ② 宽度：段内与段间都只减不增（宽端贴弹体、往外收成尖）
    for (const quad of quads) assert.ok(quad.halfWidth1 < quad.halfWidth0, '段内收窄');
    for (let index = 1; index < quads.length; index += 1) {
        assert.ok(quads[index].halfWidth0 < quads[index - 1].halfWidth0, '段间收窄');
    }
    //  ③ 渐隐：alpha 每段递减，末端 ~0
    for (let index = 1; index < quads.length; index += 1) {
        assert.ok(quads[index].alpha < quads[index - 1].alpha, '透明度必须越往外越低');
    }
    assert.ok(tail.alpha < 0.05, `末端要基本看不见（实际 ${tail.alpha.toFixed(4)}）`);
    assert.ok(tail.alpha >= 0, '不允许出现负 alpha');
    //  宽度线性 ⇒ 中点处半宽正好是首尾平均（用来防"手滑改成缓动"）
    const middle = zcMissileTrailQuads({ ...spec, slices: 2 })[0];
    assert.ok(Math.abs(middle.halfWidth0 - spec.rootHalfWidth) < 1e-9);
    assert.ok(Math.abs(middle.halfWidth1 - (spec.rootHalfWidth + spec.tipHalfWidth) / 2) < 1e-9,
        '一半处的半宽 = 近端与远端的平均 ⇒ 边是直线');
});

test('拖尾：整体透明度倍率只降不升，非法值按 1 处理', () => {
    const spec = zcMissileTrailOf(MISSILE_PREFAB)!;
    const base = zcMissileTrailQuads(spec);
    assert.deepEqual(zcMissileTrailQuads(spec, Number.NaN), base, 'NaN 当作 1');
    assert.deepEqual(zcMissileTrailQuads(spec, 2), base, '>1 被夹回 1');
    assert.deepEqual(zcMissileTrailQuads(spec, -1), zcMissileTrailQuads(spec, 0), '<0 被夹到 0');
    assert.ok(zcMissileTrailQuads(spec, 0).every((quad) => quad.alpha === 0), '倍率 0 ⇒ 全透明');
    const half = zcMissileTrailQuads(spec, 0.5);
    for (let index = 0; index < base.length; index += 1) {
        assert.ok(Math.abs(half[index].alpha - base[index].alpha / 2) < 1e-9);
    }
});

test('拖尾：屏上长度 80px、接触端整宽 ≈ 子弹半径（都要吃掉宿主节点的 0.8 缩放）', () => {
    const spec = zcMissileTrailOf(MISSILE_PREFAB)!;
    const nodeScale = zcCombatEffectNodeScaleOf(MISSILE_PREFAB);
    assert.equal(nodeScale, 0.8, '2026-11-05 需求：导弹预制体 size 0.8');
    //  弹体 prefab 81×77、可见内容 79×75、锚点 0.5 ⇒ 屏上约 63.2 宽，半径 ≈ 31.6。
    const screenBodyWidth = 79 * nodeScale;
    const screenBodyHalfWidth = screenBodyWidth / 2;
    //  注意是**本地值**乘缩放，不是屏上值：需求里的 80px 是屏上，所以本地要 100。
    const screenLength = spec.length * nodeScale;
    const screenRootWidth = spec.rootHalfWidth * 2 * nodeScale;
    const screenTipWidth = spec.tipHalfWidth * 2 * nodeScale;

    assert.ok(Math.abs(screenLength - 80) < 1,
        `2026-11-06 需求：屏幕上的长度 80px（实际 ${screenLength.toFixed(2)}）`);
    //  「宽度和子弹半径相近」= 整宽对半径（不是对直径 —— 对直径会宽出一倍）。
    assert.ok(Math.abs(screenRootWidth - screenBodyHalfWidth) <= screenBodyHalfWidth * 0.25,
        `接触端整宽 ${screenRootWidth.toFixed(2)} 应与弹体半径 ${screenBodyHalfWidth.toFixed(2)} 相近`);
    assert.ok(screenRootWidth < screenBodyWidth, '接触端不能宽过弹体本身（那就是第二颗弹了）');
    assert.ok(screenTipWidth <= screenRootWidth * 0.25,
        `末端 ${screenTipWidth.toFixed(2)} 要明显收窄（收成尖）`);
    assert.ok(screenLength > screenBodyWidth, `尾巴 ${screenLength} 要比弹体宽 ${screenBodyWidth} 长，才读得出"在飞"`);
});

test('视图：拖尾在「位置 + 转角都定好之后」才画，且每帧清一次 graphics', () => {
    const source = readFileSync('assets/script/app/zcds/view/ZCCombatEffectView.ts', 'utf8');
    const headingAt = source.indexOf('this.node.setRotationFromEuler(0, 0, angle);');
    const trailAt = source.indexOf('this.drawMissileTrail(event.effectPrefabPath);');
    assert.ok(headingAt >= 0 && trailAt >= 0, '两处锚点都要在');
    assert.ok(headingAt < trailAt, '拖尾必须在转角之后画，否则第一帧会甩在错误方向');
    const methodAt = source.indexOf('private drawMissileTrail(');
    assert.ok(methodAt > trailAt, '方法本体放在调用点之后（同文件的写法习惯）');
    const body = source.slice(methodAt, source.indexOf('把光束拉到', methodAt));
    assert.ok(body.includes('graphics.clear()'),
        '每帧必须 clear：render 只在首帧清 graphics，不清会一层层叠上去糊成实心');
    assert.ok(body.includes('new Color('), '每段独立 Color：Graphics 是按路径记填充色的');
});
