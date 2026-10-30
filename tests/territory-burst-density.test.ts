/**
 * 随机地块「直接喷资源」+ **粒子数按奖励量分级**（需求 2026-10-22 §1）：
 *
 *   > 「随机地块的格子不播放宝箱打开的动画，直接播放获得资源的动画
 *   >   （沿用宝箱获得资源中级别的粒子喷射动画），**减少粒子个数来区分奖励**，
 *   >   资源奖励数小于 50 时粒子数量很稀疏」
 *
 * 判据钉四件事：
 *  1. **只有随机格走喷射**：`TerritoryPresenter` 给这条路的 `showRewards` 带 `{ chest: false }`，
 *     页面据此跳过开箱 —— 玩法口径在 Presenter，不在页面里 if 格子类型；
 *  2. 分级阈值：`< 50` ⇒ 稀疏 5 颗；`50 ~ 200` ⇒ 9 颗；`> 200` ⇒ 满喷 12 颗；
 *  3. 脏数据（`NaN` / `±Infinity` / 负数）⇒ **稀疏**，绝不喷满屏；
 *  4. 粒子数**真的**生效：传 5 时第 6 颗起一律 `null`（不是"画出来但透明"）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    TERRITORY_GAIN_BURST_COUNT,
    TERRITORY_GAIN_BURST_COUNT_MEDIUM,
    TERRITORY_GAIN_BURST_COUNT_SPARSE,
    TERRITORY_GAIN_BURST_DENSE_ABOVE,
    TERRITORY_GAIN_BURST_SPARSE_BELOW,
    territoryBurstCountForTotal,
    territoryBurstLaunch,
    territoryBurstParticle,
    territoryBurstTotalSeconds,
} from '../assets/script/app/territory/model/TerritoryResourceGain';

// ============================================================
// 分级
// ============================================================

test('阈值与规格一致：50 是稀疏/中等的分界，200 是中等/满喷的分界', () => {
    assert.equal(TERRITORY_GAIN_BURST_SPARSE_BELOW, 50);
    assert.equal(TERRITORY_GAIN_BURST_DENSE_ABOVE, 200);
    assert.ok(TERRITORY_GAIN_BURST_COUNT_SPARSE < TERRITORY_GAIN_BURST_COUNT_MEDIUM);
    assert.ok(TERRITORY_GAIN_BURST_COUNT_MEDIUM < TERRITORY_GAIN_BURST_COUNT);
});

test('奖励总量 < 50 ⇒ 稀疏 5 颗', () => {
    for (const total of [1, 15, 30, 49, 49.9]) {
        assert.equal(territoryBurstCountForTotal(total), TERRITORY_GAIN_BURST_COUNT_SPARSE, `total=${total}`);
    }
});

test('奖励总量 50 ~ 200 ⇒ 中等 9 颗（两端都含）', () => {
    for (const total of [50, 100, 199, 200]) {
        assert.equal(territoryBurstCountForTotal(total), TERRITORY_GAIN_BURST_COUNT_MEDIUM, `total=${total}`);
    }
});

test('奖励总量 > 200 ⇒ 满喷 12 颗', () => {
    for (const total of [201, 500, 5000]) {
        assert.equal(territoryBurstCountForTotal(total), TERRITORY_GAIN_BURST_COUNT, `total=${total}`);
    }
});

test('脏数据：NaN / ±Infinity / 负数 / 0 ⇒ 稀疏（不许喷满屏）', () => {
    for (const total of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -100, 0]) {
        assert.equal(territoryBurstCountForTotal(total), TERRITORY_GAIN_BURST_COUNT_SPARSE, `total=${total}`);
    }
});

// ============================================================
// 粒子数真的生效
// ============================================================

test('传 5 颗时，第 6 颗起一律 null（不是画出来但透明）', () => {
    const count = TERRITORY_GAIN_BURST_COUNT_SPARSE;
    for (let index = 0; index < count; index += 1) {
        assert.ok(territoryBurstLaunch(7, index, count) !== null, `index=${index} 应在喷`);
    }
    for (let index = count; index < TERRITORY_GAIN_BURST_COUNT + 3; index += 1) {
        assert.equal(territoryBurstLaunch(7, index, count), null, `index=${index} 不该存在`);
        assert.equal(territoryBurstParticle(7, index, 0.3, count), null, `index=${index} 不该有粒子`);
    }
});

test('缺省参数仍是满喷 12 颗（老行为不变）', () => {
    assert.ok(territoryBurstLaunch(1, TERRITORY_GAIN_BURST_COUNT - 1) !== null);
    assert.equal(territoryBurstLaunch(1, TERRITORY_GAIN_BURST_COUNT), null);
});

test('粒子少的整喷时长更短（错峰尾巴按实际个数算）', () => {
    const sparse = territoryBurstTotalSeconds(TERRITORY_GAIN_BURST_COUNT_SPARSE);
    const full = territoryBurstTotalSeconds(TERRITORY_GAIN_BURST_COUNT);
    assert.ok(sparse < full, `稀疏档 ${sparse} 应短于满喷 ${full}`);
    assert.ok(full > 0 && sparse > 0);
});

test('粒子数变化不改变单颗轨迹（同一 index 同一时刻位置一致）', () => {
    const five = territoryBurstParticle(9, 2, 0.4, 5);
    const twelve = territoryBurstParticle(9, 2, 0.4, 12);
    assert.deepEqual(five, twelve, '同 index 的轨迹不该因为总颗数变化而改变');
});

// ============================================================
// 接线：随机格走喷射、资源点走开箱
// ============================================================

test('Presenter 给随机格标 `chest: false`（页面据此不放开箱）', () => {
    const src = readFileSync('assets/script/app/territory/application/TerritoryModel.ts', 'utf8');
    assert.ok(src.includes('chest: false'), '随机格必须显式要求"不要宝箱"');

    // 固定资源点那一路仍然走默认（开箱），不能被顺手改成 burst
    const fixedClaim = src.slice(src.indexOf('handleUnlockThenPass'), src.indexOf('randomResourceOpenCheck'));
    assert.ok(fixedClaim.includes('showRewards(result.rewards, site.cellId)'), '资源点领取仍走默认开箱');
});

test('页面按 `chest: false` 直接结算（喷射），不判格子类型', () => {
    const src = readFileSync('assets/script/app/main/MainTerritoryMap.ts', 'utf8');
    assert.ok(src.includes('presentation?.chest === false'), '页面只认 Presenter 给的表现口径');
    assert.ok(!src.includes("'randomResource'"), '页面不该自己判格子类型');
});

test('喷发个数由奖励总量算出（页面传 total 给 burst）', () => {
    const src = readFileSync('assets/script/app/territory/view/TerritoryMapView.ts', 'utf8');
    assert.ok(src.includes('territoryBurstCountForTotal'), '视图必须按总量分级');
    assert.ok(src.includes('playGainBurst(originX, originY, entries, total)'), '总量要一路传到 playGainBurst');
});
