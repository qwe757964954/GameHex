import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    clamp01,
    HEX_FLIP_IDLE_FX,
    HEX_FLIP_LIFT_PIXELS,
    HEX_FLIP_RISE_RATIO,
    HEX_SHRINK_MIN_SCALE,
    hexCollapseProgress,
    hexFlipFoldFx,
    hexFlipGroundGlowStrength,
    hexFlipUnfoldFx,
    hexShrinkBackFx,
    hexShrinkFx,
} from '../assets/script/core/hex/HexFlipPresentation';

const read = (path: string): string => readFileSync(path, 'utf8');

/** 剥掉注释再断言（rule 104）：注释里抄的表达式/旧值不该被当成实现。 */
const stripComments = (source: string): string => source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

// ── 动作曲线本身 ────────────────────────────────────────────────────────────

test('翻面段：先抬起（形状不变）、再原地压扁，末尾停在最高点', () => {
    assert.equal(HEX_FLIP_LIFT_PIXELS > 0, true);
    const start = hexFlipFoldFx(0);
    assert.equal(start.tileLift, 0);
    assert.equal(start.tileFlip, 1, '起手正面朝上');

    // 抬起结束点：已到最高点，但形状完好。
    const riseEnd = hexFlipFoldFx(HEX_FLIP_RISE_RATIO);
    assert.ok(Math.abs(riseEnd.tileLift - HEX_FLIP_LIFT_PIXELS) < 1e-9);
    assert.equal(riseEnd.tileFlip, 1, '抬起阶段不能压扁');

    // 翻面中点：位置钉在最高点不动，只压扁一半 ⇒ 轴心是一条固定线。
    const mid = hexFlipFoldFx(HEX_FLIP_RISE_RATIO + (1 - HEX_FLIP_RISE_RATIO) / 2);
    assert.ok(Math.abs(mid.tileLift - HEX_FLIP_LIFT_PIXELS) < 1e-9, '翻面阶段不能再往上跑');
    assert.ok(Math.abs(mid.tileFlip - 0.5) < 1e-9);

    const end = hexFlipFoldFx(1);
    assert.ok(Math.abs(end.tileLift - HEX_FLIP_LIFT_PIXELS) < 1e-9);
    assert.ok(end.tileFlip < 1e-9, '末尾压扁成侧视');
    // 进度越界按边界处理（超时的激活事件不该算出负抬升）。
    assert.deepEqual(hexFlipFoldFx(-1), start);
    assert.deepEqual(hexFlipFoldFx(2), end);
});

test('合回段：翻回一半时也落回一半，末尾回到布局原位', () => {
    const start = hexFlipUnfoldFx(0);
    assert.ok(Math.abs(start.tileLift - HEX_FLIP_LIFT_PIXELS) < 1e-9, '接力点仍在最高点');
    assert.ok(start.tileFlip < 1e-9, '接力点仍是侧视');

    const mid = hexFlipUnfoldFx(0.5);
    assert.ok(Math.abs(mid.tileFlip - 0.5) < 1e-9);
    assert.ok(Math.abs(mid.tileLift - HEX_FLIP_LIFT_PIXELS / 2) < 1e-9, '合回与落回同步');

    const end = hexFlipUnfoldFx(1);
    assert.equal(end.tileLift, 0);
    assert.equal(end.tileFlip, 1);
    assert.equal(end.hidden, false, '合回全程可见 —— 不能落在「整格隐藏」上');
});

test('静止态是只读单例，曲线产出的对象都是新对象', () => {
    assert.equal(HEX_FLIP_IDLE_FX.tileLift, 0);
    assert.equal(HEX_FLIP_IDLE_FX.tileFlip, 1);
    assert.equal(HEX_FLIP_IDLE_FX.tileScale, 1);
    assert.ok(!hexFlipFoldFx(1).hidden && !hexFlipUnfoldFx(0).hidden);
    // 领地翻格（压扁）不影响建筑：buildingPopScale 恒 1。
    for (const fx of [hexFlipFoldFx(0.2), hexFlipUnfoldFx(0.7)]) {
        assert.notEqual(fx, HEX_FLIP_IDLE_FX);
        assert.equal(fx.buildingPopScale, 1);
        assert.equal(fx.glowRadius, 0);
    }
    // 对局缩没 / 缩回段：建筑还没长出来（buildingPopScale 0），其余仍是新对象。
    for (const fx of [hexShrinkFx(0.6), hexShrinkBackFx(0.4)]) {
        assert.notEqual(fx, HEX_FLIP_IDLE_FX);
        assert.equal(fx.buildingPopScale, 0, '对局缩没段建筑还没长出来（要等卡牌淡出那段才换上来）');
        assert.equal(fx.glowRadius, 0);
    }
});

// ── 收场第二条路（对局）：「原地缩到最小」，全程零位移 ────────────────────────────

/**
 * 🔴 回归（2026-10-15）：对局的收场**不许有任何位移**。
 *
 * 之前是「先抬起 `HEX_FLIP_RISE_RATIO` 一段、停在最高点再缩」—— 格心整段动画都在往上跑，
 * 缩没读起来是「飞走并变小」而不是「原地收掉」，格内图标 / 价格数字的中心也跟着偏。
 * 现在整条曲线 `tileLift` 恒 `0`：中心点坐标不变，缩放绕它走 ⇒ 原地缩。
 */
test('缩没段：全程零位移（中心点坐标不变），只缩不压扁，末尾停在最小尺寸', () => {
    const start = hexShrinkFx(0);
    assert.equal(start.tileScale, 1, '起手是原尺寸');
    assert.equal(start.tileFlip, 1);

    for (const k of [0, 0.15, HEX_FLIP_RISE_RATIO * 0.3, HEX_FLIP_RISE_RATIO, 0.7, 1]) {
        assert.equal(hexShrinkFx(k).tileLift, 0, `k=${k} 不得有位移（原地缩）`);
    }
    // 反向守卫：**只有缩没不抬**，抬升常量本身不能被清零（翻面那套还要靠它）。
    assert.ok(HEX_FLIP_LIFT_PIXELS > 0);
    assert.ok(hexFlipFoldFx(1).tileLift > 0, '领地翻面仍要抬起');

    // 与翻面曲线的差别只在 `tileLift`（恒 0）和 `buildingPopScale`，其余字段同口径。
    // 早先「抬升段与 `hexFlipFoldFx` 逐字段一致」那条已随抬起一起取消，别再补回去。
    const shrink = hexShrinkFx(HEX_FLIP_RISE_RATIO * 0.3);
    const fold = hexFlipFoldFx(HEX_FLIP_RISE_RATIO * 0.3);
    assert.equal(shrink.tileFlip, fold.tileFlip);
    assert.equal(shrink.hidden, fold.hidden);
    assert.equal(shrink.glowRadius, fold.glowRadius);
    assert.equal(shrink.glowAlpha, fold.glowAlpha);
    assert.equal(shrink.buildingPopScale, 0, '对局缩没段建筑还没长出来');
    assert.equal(fold.buildingPopScale, 1, '领地翻格不影响建筑');

    // 两段式取消后不该留空窗：整段都在缩，中点就已经明显小于 1 了。
    const mid = hexShrinkFx(0.5);
    assert.equal(mid.tileFlip, 1, '对局不压扁地块');
    assert.ok(mid.tileScale < 1 && mid.tileScale > HEX_SHRINK_MIN_SCALE,
        `中点应已开始收（前 45% 不再是空窗），实际 ${mid.tileScale}`);

    const end = hexShrinkFx(1);
    assert.ok(Math.abs(end.tileScale - HEX_SHRINK_MIN_SCALE) < 1e-9, '终点必须是 0.1');
    assert.equal(end.tileLift, 0);
    assert.equal(end.hidden, false, '缩没段本身不负责隐藏（隐藏是下一段的事）');
    // 进度越界按边界处理（超时的激活事件不该算出负抬升 / 放大到 1 以外）。
    assert.deepEqual(hexShrinkFx(-1), start);
    assert.deepEqual(hexShrinkFx(2), end);
    // 缩放单调收小（easeInCubic 的末段最快）。
    for (const k of [0.2, 0.5, 0.8]) {
        assert.ok(hexShrinkFx(k + 0.1).tileScale < hexShrinkFx(k).tileScale, `k=${k} 之后应更小`);
    }
});

test('缩没段零位移的连带影响：底部开口光不再点亮（那道光画的是抬起后露出的开口）', () => {
    // `hexFlipGroundGlowStrength` 的强度里含 `clamp01(tileLift / HEX_FLIP_LIFT_PIXELS)`，
    // 缩没段 `tileLift` 恒 0 ⇒ 整段恒不点亮。这是「不抬就没有开口」的自洽结果，
    // ⚠️ 别为了保住这道光把 `tileLift` 填回非零 —— 那等于把位移加回来。
    for (const k of [0, 0.3, 0.6, 1]) {
        const fx = hexShrinkFx(k);
        const collapseFlip = 1 - hexCollapseProgress(fx.tileFlip, fx.tileScale);
        assert.equal(hexFlipGroundGlowStrength(fx.tileLift, collapseFlip), 0, `k=${k} 底光恒灭`);
    }
    // 翻面那条路相反：抬到位就该亮。
    assert.ok(hexFlipGroundGlowStrength(HEX_FLIP_LIFT_PIXELS, 1) > 0, '领地翻面抬起后底光要亮');
});

test('缩回段：同样零位移，末尾回到原尺寸', () => {
    const start = hexShrinkBackFx(0);
    assert.ok(Math.abs(start.tileScale - HEX_SHRINK_MIN_SCALE) < 1e-9, '接力点仍在最小尺寸');
    assert.equal(start.tileLift, 0, '接力点没有位移');

    const mid = hexShrinkBackFx(0.5);
    assert.ok(mid.tileScale > HEX_SHRINK_MIN_SCALE && mid.tileScale < 1);
    assert.equal(mid.tileLift, 0, '缩回全程不许有位移');

    const end = hexShrinkBackFx(1);
    assert.equal(end.tileLift, 0);
    assert.equal(end.tileScale, 1);
    assert.equal(end.tileFlip, 1);
    assert.equal(end.hidden, false, '缩回全程可见 —— 不能落在「整格隐藏」上');
});

test('塌陷轴：两种收场（压扁 / 缩没）换出同一条进度，底部光不用各写一套', () => {
    // 完好态：两根轴都报 0。
    assert.equal(hexCollapseProgress(1, 1), 0);
    // 压扁收场：塌陷轴 = 1 − flip。
    assert.ok(Math.abs(hexCollapseProgress(0.25, 1) - 0.75) < 1e-9);
    // 缩没收场：塌陷轴由缩放反推，终点与压扁一样到 1。
    assert.equal(hexCollapseProgress(1, HEX_SHRINK_MIN_SCALE), 1);
    const half = hexCollapseProgress(1, (1 + HEX_SHRINK_MIN_SCALE) / 2);
    assert.ok(Math.abs(half - 0.5) < 1e-9, `缩到一半应报 0.5，实际 ${half}`);
    // 越界 clamp：池化复用回来的脏值不该产出 <0 / >1 的进度。
    assert.equal(hexCollapseProgress(1, 2), 0);
    assert.equal(hexCollapseProgress(1, -1), 1);
});

test('地面光斑强度：翻到侧视前平滑归零，抬升为 0 时不亮', () => {
    assert.equal(hexFlipGroundGlowStrength(0, 1), 0, '没抬起来就不该有光斑');
    const peak = hexFlipGroundGlowStrength(HEX_FLIP_LIFT_PIXELS, 1);
    assert.ok(peak > 0);
    // 压扁到侧视（tileFlip → 0）时归零：那会儿地块只剩一条线，留着光带会读成悬空亮片。
    assert.equal(hexFlipGroundGlowStrength(HEX_FLIP_LIFT_PIXELS, 0), 0);
    // 缩没也走同一条「等价 flip」：缩到底时同样归零。
    assert.equal(hexFlipGroundGlowStrength(HEX_FLIP_LIFT_PIXELS, 1 - hexCollapseProgress(1, HEX_SHRINK_MIN_SCALE)), 0);
    assert.ok(clamp01(2) === 1 && clamp01(-3) === 0);
});

// ── 两处必须共用同一份（这是「领地翻格与游戏内共用这套体验」的判据） ──────────
// 说明：2026-10-15 起对局收场段改成「脉冲水波纹 + 原地缩没」两段串行
// （缩没段仍走 core 的 `hexShrinkFx` / `HEX_FLIP_SECONDS`，与领地翻格共用时长）；
// 两边「共用 core」由下面两个测试直接保证（各自断言从 core 取曲线/时长，不许写死 0.384），
// 不再需要一个对局侧的转发别名。

test('领地的翻格表现直接消费 core 的曲线/时长/透视，不自算一套', () => {
    const flip = stripComments(read('assets/script/app/territory/view/TerritoryHexFlip.ts'));
    assert.match(flip, /from '\.\.\/\.\.\/\.\.\/core\/hex\/HexFlipPresentation'/,
        '领地翻格必须从 core 的共用模块取曲线与参数');
    for (const symbol of ['hexFlipFoldFx', 'hexFlipUnfoldFx', 'HEX_FLIP_SECONDS', 'HEX_FLIP_FOLD_SECONDS', 'HEX_FLIP_PERSPECTIVE']) {
        assert.ok(flip.includes(symbol), `领地翻格应复用 ${symbol}`);
    }
    assert.doesNotMatch(flip, /0\.384|0\.42\b/, '不许把时长/透视写死在领地侧');
    // 与对局同一套 uniform 协议 + 同一个半高（两块地都是 130×119 的整图）。
    for (const uniform of ['flipCos', 'flipSin', 'flipPerspective', 'flipCenter', 'flipHalfHeight', 'glowStrength']) {
        assert.ok(flip.includes(`'${uniform}'`), `领地翻格应写材质参数 ${uniform}`);
    }
    assert.match(flip, /HEX_GRID_IMAGE_HEIGHT \/ 2/, 'flipHalfHeight 必须由地块整图高派生');
});

test('对局的脉冲 + 缩没曲线都来自 core（两边共用模块），且领地不做「整格隐藏」', () => {
    const view = stripComments(read('assets/script/app/zcds/view/ZCHexView.ts'));
    // 收场的**形状**两边不同（2026-10-15 起：对局 = 原地脉冲呼吸 + 原地缩没，领地 = 绕水平轴压扁），
    // 但曲线都落在 core 的同一个模块里（对局没有自己写一套呼吸 / 缩没曲线）。
    assert.match(view, /from '\.\.\/\.\.\/\.\.\/core\/hex\/HexFlipPresentation'/,
        '对局的脉冲 / 缩没曲线必须从 core 取');
    assert.match(view, /hexPulseFx\(/, '对局的脉冲段应直接调 core 的呼吸曲线');
    // 🔴 2026-10-15：脉冲段之后接**缩没段**（用户口径「水波纹 + 缩没两段都要」）——
    // 这一段曾因 SVN 冲突整个丢失（用户报「点击地块收缩替换的动画丢失」），守卫必须钉住它在。
    assert.match(view, /hexShrinkFx\(/,
        '对局的缩没段应直接调 core 的缩没曲线（收场 = 脉冲 + 缩没，缺一不可）');
    assert.doesNotMatch(view, /hexShrinkBackFx\(/,
        '对局只用「缩掉」那一条，不播反向回缩（回场直接原尺寸）');
    assert.doesNotMatch(view, /hexFlipFoldFx|hexFlipUnfoldFx/,
        '对局不再压扁地块（压扁那条只剩领地在用），别把两条曲线混着调');

    const flip = stripComments(read('assets/script/app/territory/view/TerritoryHexFlip.ts'));
    // 领地没有卡牌揭示接棒 ⇒ 永远不走「整格隐藏」（`hidden` 由 idle 常量给出，恒 false）。
    assert.doesNotMatch(flip, /hidden:\s*true/, '领地翻格不能进整格隐藏段（会露出棋盘底）');
});

test('领地的底部发光也用同一份序列帧，位置抵消父节点上移', () => {
    const flip = stripComments(read('assets/script/app/territory/view/TerritoryHexFlip.ts'));
    assert.match(flip, /setGroundGlowFrames/, '领地播放器要提供序列帧注入入口');
    assert.match(flip, /HEX_FLIP_GLOW_MASK_OFFSET_Y - fx\.tileLift/,
        '光带下沿要钉在原格开口（父节点抬多少、Sprite 往下补多少）');
    assert.match(flip, /hexFlipFoldProgress\(/, '帧序按翻面段进度推导（与对局同一套）');
    assert.match(flip, /hexFlipGroundGlowStrength\(/, '亮灭判断也要走 core 的共用强度');
    assert.doesNotMatch(flip, /hex-ground-glow/, '不再走 shader 版底光');

    // 地图格子上的 GroundGlow 子节点由 TerritoryMapView 挂：序列帧必须 RAW（8 帧同画布，尺寸跟帧走）。
    const mapView = stripComments(read('assets/script/app/territory/view/TerritoryMapView.ts'));
    assert.match(mapView, /new Node\('GroundGlow'\)/, '格子要挂 GroundGlow 子节点');
    assert.match(mapView, /SizeMode\.RAW/, '序列帧必须 RAW：尺寸由帧决定，别写死高度');
});

test('领地翻格的触发只在首帧快照之后（免得历史已开启格一次性全播）', () => {
    const mapView = stripComments(read('assets/script/app/territory/view/TerritoryMapView.ts'));
    assert.match(mapView, /hexFlipBootstrapped/, '缺少首帧快照开关 ⇒ 进页面会闪一串翻格');
    assert.match(mapView, /update\(dt: number\): void \{\s*this\.hexFlip\.step\(dt\)/,
        '翻格要挂在每帧推进上');
    const play = /private syncFlip[\s\S]*?\n    \}/.exec(mapView);
    assert.ok(play, '没读到 syncFlip');
    assert.match(play![0], /if \(!this\.hexFlipBootstrapped\)[\s\S]*?return;/,
        '首帧必须先做快照再返回，不能直接播');
});
