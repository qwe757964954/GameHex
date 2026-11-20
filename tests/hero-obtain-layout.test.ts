/**
 * 「获得英雄」全屏展示页的纯口径单测。
 *
 * 这里只测 **model 层纯函数**（零 `cc`）：进度语义 / 缓动 / 时间轴。
 * prefab 的尺寸、位置、字体与 Widget 结构在 `tests/hero-obtain-assets.test.ts` 里对账。
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
    HERO_OBTAIN_RAYS_SPIN_SECONDS,
    HERO_OBTAIN_TIMELINE,
    heroObtainBarVisualOf,
    heroObtainBgAlphaOf,
    heroObtainCountTextOf,
    heroObtainCountUpOf,
    heroObtainFillRatioOf,
    heroObtainHeroVisualOf,
    heroObtainHintAlphaOf,
    heroObtainPlateVisualOf,
    heroObtainRaysSpinAngleOf,
    heroObtainRaysVisualOf,
    heroObtainTitleVisualOf,
    heroObtainTotalSeconds,
} from '../assets/script/app/card/model/HeroObtainLayout';

const EPS = 1e-6;

test('进度语义：ratio 收敛到 0..1，文本取整并夹住', () => {
    assert.equal(heroObtainFillRatioOf(53, 53), 1);
    assert.equal(heroObtainFillRatioOf(0, 53), 0);
    assert.equal(heroObtainFillRatioOf(80, 53), 1);
    assert.equal(heroObtainFillRatioOf(53, 0), 0);
    assert.equal(heroObtainCountTextOf(53, 53), '53/53');
    assert.equal(heroObtainCountTextOf(8, 53), '8/53');
    assert.equal(heroObtainCountTextOf(-1, 53), '0/53');
});

test('数字滚动：与填充进度同步，末态等于目标值', () => {
    const filled = heroObtainBarVisualOf(heroObtainTotalSeconds());
    assert.equal(filled.fillRange, 1);
    assert.equal(heroObtainCountUpOf(heroObtainTotalSeconds(), 53, 53), '53/53');
    assert.equal(heroObtainCountUpOf(0, 53, 53), '0/53');
    const midway = heroObtainCountUpOf(1.1, 53, 53);
    const value = Number(midway.split('/')[0]);
    assert.ok(value >= 0 && value <= 53);
});

test('时间轴单调：背景/光效/英雄/名牌/提示都从 0 走到 1', () => {
    const total = heroObtainTotalSeconds();
    assert.equal(heroObtainBgAlphaOf(0), 0);
    assert.equal(heroObtainBgAlphaOf(total), 1);
    assert.equal(heroObtainRaysVisualOf(0).alpha, 0);
    assert.equal(heroObtainRaysVisualOf(total).alpha, 1);
    assert.equal(heroObtainTitleVisualOf(0).alpha, 0);
    assert.equal(heroObtainTitleVisualOf(total).alpha, 1);
    assert.equal(heroObtainHeroVisualOf(0).alpha, 0);
    assert.equal(heroObtainHeroVisualOf(total).alpha, 1);
    assert.equal(heroObtainPlateVisualOf(0).alpha, 0);
    assert.equal(heroObtainPlateVisualOf(total).alpha, 1);
    assert.equal(heroObtainHintAlphaOf(0), 0);
    assert.equal(heroObtainHintAlphaOf(total), 1);
});

test('终态落回设计稿：位移归零、缩放 1，放射光转交给自转', () => {
    const total = heroObtainTotalSeconds();
    const rays = heroObtainRaysVisualOf(total);
    assert.equal(rays.alpha, 1);
    assert.equal(rays.scale, 1);
    // 入场把 -16° 收回到 0，之后交给匀速顺时针自转 ⇒ 总时长这一帧已经在转，且是负角度。
    assert.ok(rays.angle < 0 && rays.angle > -360, `放射光应已开始顺时针自转，实际 ${rays.angle}`);
    assert.deepEqual(heroObtainTitleVisualOf(total), { alpha: 1, scale: 1, rise: 0 });
    assert.deepEqual(heroObtainHeroVisualOf(total), { alpha: 1, scale: 1, rise: 0 });
    assert.deepEqual(heroObtainPlateVisualOf(total), { alpha: 1, scale: 1 });
    assert.deepEqual(heroObtainBarVisualOf(total), { bgAlpha: 1, fillRange: 1, countAlpha: 1 });
});

test('放射光常驻自转：接缝连续、顺时针、按圈取模', () => {
    const start = HERO_OBTAIN_TIMELINE.raysDelay + HERO_OBTAIN_TIMELINE.rays;
    //  接缝：入场结束那一帧角度恰为 0，自转从 0 起算，不会先跳一下再转。
    assert.equal(heroObtainRaysSpinAngleOf(start - 0.001), 0);
    assert.equal(heroObtainRaysVisualOf(start).angle, 0);

    //  顺时针 = 负角度：1/4 圈 -90°、半圈 -180°。
    const turn = (fraction: number) => heroObtainRaysSpinAngleOf(start + HERO_OBTAIN_RAYS_SPIN_SECONDS * fraction);
    assert.ok(Math.abs(turn(0.25) + 90) < EPS, `1/4 圈应为 -90°，实际 ${turn(0.25)}`);
    assert.ok(Math.abs(turn(0.5) + 180) < EPS, `半圈应为 -180°，实际 ${turn(0.5)}`);

    //  整圈回 0（取模，不累到 -720 这种大数值）。
    assert.equal(turn(1), 0);
    assert.ok(Math.abs(turn(1.25) + 90) < EPS, '第二圈应重新从 0 起算');

    //  长时间停留：角度始终落在 (-360, 0]，不会无限累减（掉精度后相邻帧就不转了）。
    for (const seconds of [30, 300, 3600]) {
        const angle = heroObtainRaysSpinAngleOf(start + seconds);
        assert.ok(angle <= 0 && angle > -360, `${seconds}s 后角度越界：${angle}`);
    }
});

test('时间轴常量：总时长 = 1.72s，各阶段顺序不倒置', () => {
    assert.equal(HERO_OBTAIN_TIMELINE.total, 1.72);
    assert.equal(heroObtainTotalSeconds(), 1.72);
    assert.ok(HERO_OBTAIN_TIMELINE.raysDelay < HERO_OBTAIN_TIMELINE.titleDelay);
    assert.ok(HERO_OBTAIN_TIMELINE.titleDelay < HERO_OBTAIN_TIMELINE.heroDelay);
    assert.ok(HERO_OBTAIN_TIMELINE.heroDelay < HERO_OBTAIN_TIMELINE.plateDelay);
    assert.ok(HERO_OBTAIN_TIMELINE.plateDelay < HERO_OBTAIN_TIMELINE.barDelay);
    assert.ok(HERO_OBTAIN_TIMELINE.barDelay < HERO_OBTAIN_TIMELINE.hintDelay);
    assert.ok(HERO_OBTAIN_TIMELINE.hintDelay + HERO_OBTAIN_TIMELINE.hint < HERO_OBTAIN_TIMELINE.total + EPS);
});
