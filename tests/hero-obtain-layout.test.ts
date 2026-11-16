/**
 * 「获得英雄」全屏展示页的纯口径单测。
 *
 * 这里只测 **model 层纯函数**（零 `cc`）：进度语义 / 缓动 / 时间轴。
 * prefab 的尺寸、位置、字体与 Widget 结构在 `tests/hero-obtain-assets.test.ts` 里对账。
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
    HERO_OBTAIN_TIMELINE,
    heroObtainBarVisualOf,
    heroObtainBgAlphaOf,
    heroObtainCountTextOf,
    heroObtainCountUpOf,
    heroObtainFillRatioOf,
    heroObtainHeroVisualOf,
    heroObtainHintAlphaOf,
    heroObtainPlateVisualOf,
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

test('终态落回设计稿：所有位移归零、缩放 1、光效角度 0', () => {
    const total = heroObtainTotalSeconds();
    assert.deepEqual(heroObtainRaysVisualOf(total), { alpha: 1, scale: 1, angle: 0 });
    assert.deepEqual(heroObtainTitleVisualOf(total), { alpha: 1, scale: 1, rise: 0 });
    assert.deepEqual(heroObtainHeroVisualOf(total), { alpha: 1, scale: 1, rise: 0 });
    assert.deepEqual(heroObtainPlateVisualOf(total), { alpha: 1, scale: 1 });
    assert.deepEqual(heroObtainBarVisualOf(total), { bgAlpha: 1, fillRange: 1, countAlpha: 1 });
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
