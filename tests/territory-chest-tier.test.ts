/**
 * 章节宝箱**三档判定**（用户口径 2026-10-22）：
 *
 *   > 弱宝箱表现：所有类型的资源数量相加 小于 100
 *   > 中宝箱表现：所有类型的资源数量相加 处于 100~1000
 *   > 大宝箱表现：所有类型的资源数量相加 1000 以上
 *
 * 判据钉五件事：
 *  1. **只看总数量**：不分资源种类、不按条目数、不加权（1 个 ×50 与 50 个 ×1 同档）；
 *  2. 边界：`99 → weak` / `100 → medium` / `1000 → medium` / `1001 → strong`
 *     （1000 两句需求都覆盖，按「区间闭合优先」取中档，见 `TerritoryChestTier` 头注释）；
 *  3. 脏数据：`NaN` / `Infinity` ⇒ **弱档**（绝不能因一个 NaN 触发全屏镜头）；
 *     负数 / 0 / 非数字 amount 跳过，不计入合计；
 *  4. 空奖励 ⇒ `null`（= 没有宝箱要开，调用方跳过整套表现，不是「小箱子」）；
 *  5. 档位中文名与三档常量一一对应（改名不许漏）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    TERRITORY_CHEST_MEDIUM_MAX,
    TERRITORY_CHEST_TIER,
    TERRITORY_CHEST_TIER_LABEL,
    TERRITORY_CHEST_WEAK_BELOW,
    territoryChestTierOf,
    territoryChestTierOfRewards,
    territoryChestTotal,
} from '../assets/script/app/territory/model/TerritoryChestTier';

// ============================================================
// 合计：只加 amount，脏条目跳过
// ============================================================

test('合计：所有类型直接相加（不按种类合并、不加权）', () => {
    const rewards = [
        { resId: 7, amount: 30 },
        { resId: 9, amount: 20 },
        { resId: 101, amount: 5 },
    ];
    assert.equal(territoryChestTotal(rewards), 55);
});

test('合计：同一 resId 出现多次照实累加（不先去重）', () => {
    assert.equal(territoryChestTotal([
        { resId: 7, amount: 100 },
        { resId: 7, amount: 250 },
    ]), 350);
});

test('合计：空 / null / undefined ⇒ 0', () => {
    assert.equal(territoryChestTotal([]), 0);
    assert.equal(territoryChestTotal(null), 0);
    assert.equal(territoryChestTotal(undefined), 0);
});

test('合计：负数 / 0 / NaN / 非数字 amount 一律跳过', () => {
    const rewards = [
        { resId: 7, amount: 40 },
        { resId: 8, amount: -100 },
        { resId: 9, amount: 0 },
        { resId: 10, amount: Number.NaN },
        { resId: 11, amount: '60' as unknown as number },
    ];
    // '60' 会被 Number() 转成 60 ⇒ 40 + 60 = 100（服务端字段是数字，字符串只做宽容处理）
    assert.equal(territoryChestTotal(rewards), 100);
});

test('合计：脏「条目」不炸（数组里混 null）', () => {
    const rewards = [null, { resId: 7, amount: 10 }, undefined] as unknown as { resId: number; amount: number }[];
    assert.equal(territoryChestTotal(rewards), 10);
});

// ============================================================
// 边界：99 / 100 / 1000 / 1001
// ============================================================

test('档位边界：99 弱、100 中、1000 中、1001 强', () => {
    assert.equal(territoryChestTierOf(99), TERRITORY_CHEST_TIER.weak);
    assert.equal(territoryChestTierOf(100), TERRITORY_CHEST_TIER.medium);
    assert.equal(territoryChestTierOf(1000), TERRITORY_CHEST_TIER.medium);
    assert.equal(territoryChestTierOf(1001), TERRITORY_CHEST_TIER.strong);
});

test('档位边界正好等于两个常量（常量改了测试跟着改）', () => {
    assert.equal(TERRITORY_CHEST_WEAK_BELOW, 100);
    assert.equal(TERRITORY_CHEST_MEDIUM_MAX, 1000);
    assert.equal(territoryChestTierOf(TERRITORY_CHEST_WEAK_BELOW - 1), TERRITORY_CHEST_TIER.weak);
    assert.equal(territoryChestTierOf(TERRITORY_CHEST_WEAK_BELOW), TERRITORY_CHEST_TIER.medium);
    assert.equal(territoryChestTierOf(TERRITORY_CHEST_MEDIUM_MAX), TERRITORY_CHEST_TIER.medium);
    assert.equal(territoryChestTierOf(TERRITORY_CHEST_MEDIUM_MAX + 1), TERRITORY_CHEST_TIER.strong);
});

test('档位边界：0 与负数走弱档（不是「没有宝箱」）', () => {
    assert.equal(territoryChestTierOf(0), TERRITORY_CHEST_TIER.weak);
    assert.equal(territoryChestTierOf(-1), TERRITORY_CHEST_TIER.weak);
});

test('档位边界：NaN / ±Infinity 一律弱档（脏数据不许放大动画）', () => {
    assert.equal(territoryChestTierOf(Number.NaN), TERRITORY_CHEST_TIER.weak);
    assert.equal(territoryChestTierOf(Number.POSITIVE_INFINITY), TERRITORY_CHEST_TIER.weak);
    assert.equal(territoryChestTierOf(Number.NEGATIVE_INFINITY), TERRITORY_CHEST_TIER.weak);
});

// ============================================================
// 一批奖励 → 档位（空 ⇒ null）
// ============================================================

test('空奖励 ⇒ null（不播开箱，不是弱档）', () => {
    assert.equal(territoryChestTierOfRewards([]), null);
    assert.equal(territoryChestTierOfRewards(null), null);
    assert.equal(territoryChestTierOfRewards(undefined), null);
});

test('条目都在但金额全 0 / 全负 ⇒ null（没有可展示的奖励）', () => {
    assert.equal(territoryChestTierOfRewards([{ resId: 7, amount: 0 }]), null);
    assert.equal(territoryChestTierOfRewards([{ resId: 7, amount: -5 }, { resId: 8, amount: 0 }]), null);
});

test('奖励 → 档位：三档各取一例（含「一条顶多条」的等价性）', () => {
    assert.equal(territoryChestTierOfRewards([{ resId: 7, amount: 80 }]), TERRITORY_CHEST_TIER.weak);
    assert.equal(territoryChestTierOfRewards([
        { resId: 7, amount: 60 },
        { resId: 9, amount: 60 },
    ]), TERRITORY_CHEST_TIER.medium);
    assert.equal(territoryChestTierOfRewards([{ resId: 101, amount: 5000 }]), TERRITORY_CHEST_TIER.strong);
    // 1 个「大额」与 50 个「小额」在分档上是同一档 —— 用户口径就是数量相加，没让按稀有度加权
    assert.equal(
        territoryChestTierOfRewards(Array.from({ length: 50 }, () => ({ resId: 7, amount: 30 }))),
        TERRITORY_CHEST_TIER.strong,
    );
});

// ============================================================
// 文案
// ============================================================

test('三档中文名齐全且不重复', () => {
    const labels = Object.values(TERRITORY_CHEST_TIER).map((tier) => TERRITORY_CHEST_TIER_LABEL[tier]);
    assert.deepEqual(labels.sort(), ['中宝箱', '弱宝箱', '大宝箱'].sort());
});
