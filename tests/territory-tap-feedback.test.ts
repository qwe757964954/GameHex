/**
 * 地块**点击反馈**的时间轴（`docs/章节地图动画实现规格.md` §1 + §0.1）。
 *
 *   > 地块按压 `PressBounce`：scale `1 → 0.94 → 1.02 → 1`，0.18s
 *   > 绿色光圈：以点击点为圆心径向，0.3s 淡出
 *   > 蓝色圆环：`scale 0.4 → 1.4`、`alpha 1 → 0`，0.3s
 *
 * 为什么这几条要单测（而不是"点一下看看"）：
 *  · 三个关键倍率必须**精确**等于 0.94 / 1.02 / 1 —— 用正弦或弹簧拟合做不到，
 *    而且旧实现（`cc.Button` 的 `SCALE` 过渡，`zoomScale 1.2`）是**放大**，方向就错了；
 *  · 反馈必须「按下瞬间」就有（规格 §5 验收第一条：0.1s 内可见），
 *    所以按下后的第一帧就得离开 1（不能前摇）；
 *  · 越界要返回 `null`（= 已播完，视图复位成 1），不能返回「差不多是 1 的数」，
 *    否则节点会留着 0.9999 的缩放慢慢累积误差。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    TERRITORY_TAP_GLOW_FROM,
    TERRITORY_TAP_GLOW_TO,
    TERRITORY_TAP_PRESS_DOWN,
    TERRITORY_TAP_PRESS_SECONDS,
    TERRITORY_TAP_PRESS_UP,
    TERRITORY_TAP_RING_FROM,
    TERRITORY_TAP_RING_SECONDS,
    TERRITORY_TAP_RING_TO,
    territoryTapGlowFx,
    territoryTapPressScale,
    territoryTapRingFx,
} from '../assets/script/app/territory/model/TerritoryTapFeedback';

/** 按 1/240s 采样一个时长窗口（关键点能落在采样点上）。 */
function samples(seconds: number, step = 1 / 240): number[] {
    const out: number[] = [];
    for (let t = 0; t < seconds; t += step) out.push(Number(t.toFixed(6)));
    return out;
}

// ============================================================
// 常量口径
// ============================================================

test('常量与规格一致：0.18s / 0.94 / 1.02 / 0.3s', () => {
    assert.equal(TERRITORY_TAP_PRESS_SECONDS, 0.18);
    assert.equal(TERRITORY_TAP_PRESS_DOWN, 0.94);
    assert.equal(TERRITORY_TAP_PRESS_UP, 1.02);
    assert.equal(TERRITORY_TAP_RING_SECONDS, 0.3);
    assert.equal(TERRITORY_TAP_RING_FROM, 0.4);
    assert.equal(TERRITORY_TAP_RING_TO, 1.4);
});

// ============================================================
// 按压回弹
// ============================================================

test('按压：三段关键值精确等于 0.94 / 1.02 / 1', () => {
    const total = TERRITORY_TAP_PRESS_SECONDS;
    const atHinge = territoryTapPressScale(total * 0.35)!;
    assert.ok(Math.abs(atHinge - TERRITORY_TAP_PRESS_DOWN) < 1e-9, `0.35 处应压到 0.94，实测 ${atHinge}`);
    const atTop = territoryTapPressScale(total * 0.7)!;
    assert.ok(Math.abs(atTop - TERRITORY_TAP_PRESS_UP) < 1e-9, `0.7 处应弹到 1.02，实测 ${atTop}`);
    // 收尾（仍 < 总时长的那一帧）已经很接近 1
    const nearEnd = territoryTapPressScale(total * 0.999)!;
    assert.ok(Math.abs(nearEnd - 1) < 1e-3, `收尾应回到 1，实测 ${nearEnd}`);
});

test('按压：先压后弹（不是像 Button 那样直接放大）', () => {
    const total = TERRITORY_TAP_PRESS_SECONDS;
    assert.ok(territoryTapPressScale(total * 0.1)! < 1, '第一段必须小于 1（压下去）');
    assert.ok(territoryTapPressScale(total * 0.5)! > 1, '第二段必须大于 1（弹回来）');
});

test('按压：按下后立刻就有反馈（0.1s 内明显离开 1）', () => {
    const early = territoryTapPressScale(0.02)!;
    assert.ok(early < 0.995, `0.02s 时缩放 ${early} 应已明显下压`);
    assert.ok(early >= TERRITORY_TAP_PRESS_DOWN, '不该一次压过头');
});

test('按压：全程落在 [0.94, 1.02] 区间内（不抖出边界）', () => {
    for (const t of samples(TERRITORY_TAP_PRESS_SECONDS)) {
        const scale = territoryTapPressScale(t);
        assert.ok(scale !== null, `t=${t} 应仍在播`);
        assert.ok(scale! >= TERRITORY_TAP_PRESS_DOWN - 1e-9, `t=${t} 缩放 ${scale} 低于 0.94`);
        assert.ok(scale! <= TERRITORY_TAP_PRESS_UP + 1e-9, `t=${t} 缩放 ${scale} 高于 1.02`);
    }
});

test('按压：越界返回 null（视图据此复位，不靠"接近 1"）', () => {
    assert.equal(territoryTapPressScale(TERRITORY_TAP_PRESS_SECONDS), null);
    assert.equal(territoryTapPressScale(TERRITORY_TAP_PRESS_SECONDS + 0.5), null);
    assert.equal(territoryTapPressScale(-0.001), null);
    assert.equal(territoryTapPressScale(Number.NaN), null);
    assert.equal(territoryTapPressScale(Number.POSITIVE_INFINITY), null);
});

// ============================================================
// 绿色光圈
// ============================================================

test('绿光圈：半径从 10 扩到 62、不透明度 1 → 0', () => {
    const first = territoryTapGlowFx(0)!;
    assert.ok(Math.abs(first.radius - TERRITORY_TAP_GLOW_FROM) < 1e-9);
    assert.ok(Math.abs(first.alpha - 1) < 1e-9);
    const late = territoryTapGlowFx(TERRITORY_TAP_RING_SECONDS * 0.95)!;
    assert.ok(late.radius > first.radius, '半径必须扩散');
    assert.ok(late.alpha < 0.2, `末段应几乎透明，实测 ${late.alpha}`);
    assert.ok(late.radius <= TERRITORY_TAP_GLOW_TO + 1e-9);
});

test('绿光圈：半径单调不回缩、alpha 单调不回升', () => {
    let lastRadius = -1;
    let lastAlpha = 2;
    for (const t of samples(TERRITORY_TAP_RING_SECONDS)) {
        const fx = territoryTapGlowFx(t)!;
        assert.ok(fx.radius >= lastRadius - 1e-9, `t=${t} 半径回缩`);
        assert.ok(fx.alpha <= lastAlpha + 1e-9, `t=${t} 透明度回升`);
        lastRadius = fx.radius;
        lastAlpha = fx.alpha;
    }
});

test('绿光圈：越界 null', () => {
    assert.equal(territoryTapGlowFx(TERRITORY_TAP_RING_SECONDS), null);
    assert.equal(territoryTapGlowFx(-1), null);
    assert.equal(territoryTapGlowFx(Number.NaN), null);
});

// ============================================================
// 蓝色圆环
// ============================================================

test('蓝圆环：scale 0.4 → 1.4、alpha 1 → 0', () => {
    const first = territoryTapRingFx(0)!;
    assert.ok(Math.abs(first.scale - TERRITORY_TAP_RING_FROM) < 1e-9);
    assert.ok(Math.abs(first.alpha - 1) < 1e-9);
    const late = territoryTapRingFx(TERRITORY_TAP_RING_SECONDS * 0.95)!;
    assert.ok(late.scale > 1.3, `末段应扩到接近 1.4，实测 ${late.scale}`);
    assert.ok(late.alpha < 0.1, `末段应几乎透明，实测 ${late.alpha}`);
});

test('蓝圆环：与绿光圈同时开始、同时结束（两层一起读才像"点爆了"）', () => {
    for (const t of [0, 0.05, 0.15, 0.25, 0.299]) {
        assert.ok(territoryTapRingFx(t) !== null, `t=${t} 圆环应在播`);
        assert.ok(territoryTapGlowFx(t) !== null, `t=${t} 光圈应在播`);
    }
    assert.equal(territoryTapRingFx(TERRITORY_TAP_RING_SECONDS), null);
    assert.equal(territoryTapGlowFx(TERRITORY_TAP_RING_SECONDS), null);
});

test('蓝圆环：全程 scale / alpha 都在合法区间', () => {
    for (const t of samples(TERRITORY_TAP_RING_SECONDS)) {
        const fx = territoryTapRingFx(t)!;
        assert.ok(fx.scale >= TERRITORY_TAP_RING_FROM - 1e-9 && fx.scale <= TERRITORY_TAP_RING_TO + 1e-9, `t=${t} scale=${fx.scale}`);
        assert.ok(fx.alpha >= 0 && fx.alpha <= 1, `t=${t} alpha=${fx.alpha}`);
    }
});

test('蓝圆环：越界 null', () => {
    assert.equal(territoryTapRingFx(TERRITORY_TAP_RING_SECONDS), null);
    assert.equal(territoryTapRingFx(-0.01), null);
    assert.equal(territoryTapRingFx(Number.NaN), null);
});
