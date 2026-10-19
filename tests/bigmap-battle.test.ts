/**
 * 攻城 / 野怪战斗结算的回归测试。
 *
 * 断言到具体数值而不是「成功了」，因为公式里的每一项（势力范围惩罚、边际递减、名次系数、
 * 拥挤系数）都会静默地把战功改小，只测 ok 等于没测。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    bigMapAttackCity,
    bigMapAttackMonster,
    bigMapAttackPower,
    bigMapCityAttackPreview,
    bigMapCityHpRatio,
    bigMapCrowdCoeff,
    bigMapMarginalWarScore,
    bigMapMonsterHpRatio,
    bigMapRankCoeff,
    bigMapUnlockContextOf,
    createBigMapBattleProgress,
} from '../assets/script/app/bigmap/model/BigMapBattle';
import { createBigMapBaseState } from '../assets/script/app/bigmap/model/BigMapBase';
import { buildBigMapWorld } from '../assets/script/app/bigmap/model/BigMapWorld';
import { loadBigMapConfig, makeUnlockContext } from './helpers/bigmap-fixtures';

const config = loadBigMapConfig();
const world = buildBigMapWorld(config);
const NOW = 1_000_000;

function freshBase() {
    return createBigMapBaseState(config, NOW);
}

test('攻击力只跟主城等级走', () => {
    const base = freshBase();
    assert.equal(bigMapAttackPower(config, base), 420);
    const boosted = {
        ...base,
        buildings: base.buildings.map((item) => ({ ...item, level: 3 })),
    };
    assert.equal(bigMapAttackPower(config, boosted), 420 + 180 * 2);
});

test('边际递减：伤害达到 cap 时约 63%，远大于 cap 才接近饱和', () => {
    const cap = config.scoreRule.marginalDamageCap;
    assert.equal(cap, 3000);
    assert.ok(Math.abs(bigMapMarginalWarScore(cap, cap) / cap - 0.632) < 0.01);
    assert.ok(bigMapMarginalWarScore(cap * 10, cap) > cap * 0.99);
    // 小伤害基本线性，不会被递减吃掉。
    assert.ok(Math.abs(bigMapMarginalWarScore(30, cap) - 29.85) < 0.5);
    assert.equal(bigMapMarginalWarScore(0, cap), 0);
});

test('名次系数：前 10 名查表，之后每降一名递减且有下限', () => {
    assert.equal(bigMapRankCoeff(config, 1), 1);
    assert.equal(bigMapRankCoeff(config, 2), 0.9);
    assert.equal(bigMapRankCoeff(config, 10), 0.6);
    // 第 11 名 = 60 - 3 = 57%
    assert.ok(Math.abs(bigMapRankCoeff(config, 11) - 0.57) < 1e-9);
    assert.equal(bigMapRankCoeff(config, 999), config.scoreRule.rankExtendMinPct / 100);
});

test('拥挤系数：单人满额，人越多越低', () => {
    assert.equal(bigMapCrowdCoeff(config, 1), 1);
    assert.ok(bigMapCrowdCoeff(config, 3) < 0.7);
    assert.ok(bigMapCrowdCoeff(config, 10) > config.scoreRule.crowdBase);
});

test('不在城池势力范围内，攻城伤害 −20%', () => {
    const base = freshBase();
    const city = config.cities.get(101)!;
    const near = bigMapCityAttackPreview(config, base, city, city.radiateCapacity);
    const far = bigMapCityAttackPreview(config, base, city, city.radiateCapacity + 1);
    assert.equal(near.inRange, true);
    assert.equal(near.damageCutPct, 0);
    assert.equal(near.damage, 420);
    assert.equal(far.inRange, false);
    assert.equal(far.damageCutPct, 20);
    assert.equal(far.damage, Math.round(420 * 0.8));
    assert.ok(far.warScore < near.warScore);
});

test('攻城：打穿城防 → 战功达标 → 占领并发奖', () => {
    const base = freshBase();
    const city = config.cities.get(101)!;
    const unlock = makeUnlockContext({ adventureChapter: 2 });
    let progress = createBigMapBattleProgress();
    let current = base;
    let occupiedAt = 0;

    for (let round = 1; round <= 4; round += 1) {
        const outcome = bigMapAttackCity(config, current, progress, city, 5, { adventureChapter: 2 });
        assert.equal(outcome.ok, true, outcome.reason);
        current = outcome.base!;
        progress = outcome.progress!;
        if (outcome.occupied) occupiedAt = round;
    }
    // 城防 1600 / 每次 420 ⇒ 第 4 次打穿；累计战功远超 800 ⇒ 同一轮占领。
    assert.equal(occupiedAt, 4);
    assert.deepEqual(progress.occupiedCityIds, [city.cityId]);
    assert.equal(progress.cityHp[city.cityId], city.defenseHp, '占领后城防回满');
    assert.equal(bigMapCityHpRatio(progress, city), 1);
    // 行动力扣了 4 次。
    assert.equal(current.stamina, config.stamina.staminaMax - city.staminaCost * 4);
    // 占领奖励进了货币。
    assert.ok(current.res.coin > config.resources.get('coin')!.startAmount);
    // 占领后解锁上下文能立刻反映出来（前置城池解锁下一环）。
    const next = bigMapUnlockContextOf(progress, 3);
    assert.equal(next.occupiedCityIds.has(city.cityId), true);
});

test('已经打穿但战功不够时不占领', () => {
    const base = freshBase();
    const city = config.cities.get(103)!;
    // 用极高的城防 + 极低战功倍率的组合模拟「一轮打穿但战功不够」：
    // 103 的 minOccupyWarScore = 1600，而单次战功约 784 ⇒ 第一次打穿必然不够。
    const forged = { ...city, defenseHp: 1, staminaCost: 20 };
    // 前置链已占：占领集合只能来自 progress（避免与解锁上下文两套数据打架）。
    const progress = { ...createBigMapBattleProgress(), occupiedCityIds: [101, 102] };
    const outcome = bigMapAttackCity(config, base, progress, forged, 5, { adventureChapter: 4, openDay: 1 });
    assert.equal(outcome.ok, true, outcome.reason);
    assert.equal(outcome.breached, true);
    assert.equal(outcome.occupied, false);
    assert.deepEqual(outcome.progress!.occupiedCityIds, [101, 102]);
    assert.equal(outcome.progress!.cityHp[city.cityId], 0);
});

test('未解锁 / 未开放 / 已占领的城池都不能打', () => {
    const base = freshBase();
    const progress = createBigMapBattleProgress();

    const locked = bigMapAttackCity(config, base, progress, config.cities.get(101)!, 5, { adventureChapter: 1 });
    assert.equal(locked.ok, false);
    assert.match(locked.reason, /第 2 章/);

    const unavailable = bigMapAttackCity(config, base, progress, config.cities.get(200)!, 5, { adventureChapter: 99 });
    assert.equal(unavailable.ok, false);
    assert.match(unavailable.reason, /未开放/);

    const noPrev = bigMapAttackCity(config, base, progress, config.cities.get(102)!, 5, { adventureChapter: 3 });
    assert.equal(noPrev.ok, false);
    assert.match(noPrev.reason, /前置城池/);

    const owned = bigMapAttackCity(
        config, base,
        { ...progress, occupiedCityIds: [101] },
        config.cities.get(101)!, 5,
        { adventureChapter: 3 },
    );
    assert.equal(owned.ok, false);
    assert.match(owned.reason, /已占领/);
});

test('行动力不够时打不了，且不改任何状态', () => {
    const base = { ...freshBase(), stamina: 5 };
    const outcome = bigMapAttackCity(
        config, base, createBigMapBattleProgress(),
        config.cities.get(101)!, 5, { adventureChapter: 2 },
    );
    assert.equal(outcome.ok, false);
    assert.match(outcome.reason, /行动力/);
    assert.equal(outcome.base, null);
    assert.equal(outcome.progress, null);
    // 预览仍然给出，界面可以显示「需要 20 行动力」。
    assert.equal(outcome.preview!.staminaCost, 20);
});

test('打野怪：击杀发奖、记通关等级、进入刷新 CD', () => {
    const base = freshBase();
    let progress = createBigMapBattleProgress();
    const site = world.monsters.find((item) => item.level === 1)!;
    let current = base;

    const first = bigMapAttackMonster(config, current, progress, site, NOW);
    assert.equal(first.ok, true, first.reason);
    current = first.base!;
    progress = first.progress!;
    assert.equal(first.breached, false, '第一刀打不死（600 血 / 420 伤）');
    assert.ok(bigMapMonsterHpRatio(config, progress, site) > 0);

    const second = bigMapAttackMonster(config, current, progress, site, NOW);
    assert.equal(second.ok, true, second.reason);
    assert.equal(second.breached, true);
    current = second.base!;
    progress = second.progress!;
    assert.equal(progress.clearedMonsterLevel, 1);
    assert.ok(current.res.grain > 800 || current.res.coin > 200, '击杀奖励应入账');

    // 刷新 CD 内再打会被拒。
    const cooldown = bigMapAttackMonster(config, current, progress, site, NOW + 1);
    assert.equal(cooldown.ok, false);
    assert.match(cooldown.reason, /刷新/);
    // CD 到了可以再打，且血量已回满。
    assert.equal(bigMapMonsterHpRatio(config, progress, site), 1);
});

test('野怪逐级解锁：没打过 4 级不能碰 5 级', () => {
    const base = freshBase();
    const progress = { ...createBigMapBattleProgress(), clearedMonsterLevel: 3 };
    const boss = world.monsters.find((item) => item.level === 5)!;
    const blocked = bigMapAttackMonster(config, base, progress, boss, NOW);
    assert.equal(blocked.ok, false);
    assert.match(blocked.reason, /4 级野怪/);

    const ready = { ...progress, clearedMonsterLevel: 4 };
    const allowed = bigMapAttackMonster(config, base, ready, boss, NOW);
    assert.equal(allowed.ok, true, allowed.reason);
});

test('攻城预览会随名次与拥挤下降', () => {
    const base = freshBase();
    const city = config.cities.get(101)!;
    const solo = bigMapCityAttackPreview(config, base, city, 5, 1, 1);
    const crowded = bigMapCityAttackPreview(config, base, city, 5, 8, 1);
    const lowRank = bigMapCityAttackPreview(config, base, city, 5, 1, 20);
    assert.ok(crowded.warScore < solo.warScore);
    assert.ok(lowRank.warScore < solo.warScore);
    assert.equal(crowded.damage, solo.damage, '人数与名次只影响战功，不影响伤害');
});
