/**
 * 「首充礼包」数据口径的纯逻辑单测。
 *
 * 覆盖 `assets/script/app/firstRecharge/` 里**不依赖 `cc`** 的三个文件：
 *   `FirstRechargeTable`（判定与解析）、`FirstRechargeArt`（品质框 / 道具图映射）、`FirstRechargeTexts`。
 *
 * 这段被单测盯住的原因：老客户端的判定散在 `ModelFirstRecharge` + `TimeUtil` + DI 容器里，
 * 没法单测，只能靠手点。移植时全部收敛成传参纯函数，就有了这里的回归网。
 *
 *  —— `qualityFrameName` 那一组是**真实 bug 的回归保护**：见文件内注释。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildPriceResolver,
    buildStateMap,
    buildTiers,
    buttonStateOf,
    claimableDayOf,
    dayOfActiveTime,
    dayStateOf,
    FIRST_RECHARGE_ALWAYS_VISIBLE_TIERS,
    FIRST_RECHARGE_DAYS,
    startOfDay,
    takenOf,
    tierRedDotOf,
    toMillis,
    visibleTierIndexes,
} from '../assets/script/app/firstRecharge/FirstRechargeTable';
import type { IFirstRechargeState, IFirstRechargeTier } from '../assets/script/app/firstRecharge/FirstRechargeTable';
import { QUALITY_FRAME_NAMES, qualityFrameName } from '../assets/script/app/firstRecharge/FirstRechargeArt';
import { FIRST_RECHARGE_TEXTS } from '../assets/script/app/firstRecharge/FirstRechargeTexts';

// ============================================================
// 时间
// ============================================================

test('toMillis 吃 number / 数字串 / protobufjs Long，非法值一律 0', () => {
    assert.equal(toMillis(1700000000000), 1700000000000);
    assert.equal(toMillis('1700000000000'), 1700000000000);
    // protobufjs 的 Long 有 toNumber
    assert.equal(toMillis({ toNumber: () => 12345 }), 12345);
    // 退化形态：只有 low/high
    assert.equal(toMillis({ low: 1000, high: 0 }), 1000);
    assert.equal(toMillis({ low: 0, high: 1 }), 4294967296);

    assert.equal(toMillis(NaN), 0);
    assert.equal(toMillis(Infinity), 0);
    assert.equal(toMillis('abc'), 0);
    assert.equal(toMillis(null), 0);
    assert.equal(toMillis(undefined), 0);
    assert.equal(toMillis(true), 0);
    assert.equal(toMillis({}), 0);
});

test('dayOfActiveTime 按「激活当天的 0 点」算第 1 天，不按 24 小时滚动', () => {
    const buy = new Date(2026, 4, 1, 23, 50, 0, 0).getTime(); // 5/1 23:50

    // 激活那个自然日**之前**才是 0（注意：同一天的 23:49 也已经算第 1 天）
    assert.equal(dayOfActiveTime(buy, new Date(2026, 3, 30, 23, 59, 0, 0).getTime()), 0);
    // 激活日当天任意时刻都是第 1 天
    assert.equal(dayOfActiveTime(buy, buy), 1);
    assert.equal(dayOfActiveTime(buy, buy - 1), 1);
    // 当天 0 点是第 1 天
    assert.equal(dayOfActiveTime(buy, new Date(2026, 4, 1, 0, 0, 0, 0).getTime()), 1);
    // 23:50 买、10 分钟后跨天 → 第 2 天（这是老客户端 `TimeUtil.getDay` 的关键口径）
    assert.equal(dayOfActiveTime(buy, new Date(2026, 4, 2, 0, 10, 0, 0).getTime()), 2);
    // 第 4 个自然日
    assert.equal(dayOfActiveTime(buy, new Date(2026, 4, 4, 12, 0, 0, 0).getTime()), 4);
    // 没激活过
    assert.equal(dayOfActiveTime(0, buy), 0);
});

test('startOfDay 取本地时区当天 0 点', () => {
    const noon = new Date(2026, 4, 1, 12, 34, 56, 789).getTime();
    assert.equal(startOfDay(noon), new Date(2026, 4, 1, 0, 0, 0, 0).getTime());
    // 再取一次幂等
    assert.equal(startOfDay(startOfDay(noon)), startOfDay(noon));
});

// ============================================================
// 表解析
// ============================================================

test('buildTiers 跳过坏行、去重、把 rmb 当支付渠道 id 交给 priceOf', () => {
    const tiers = buildTiers([
        {
            id: 1, rmb: 11, desc: '史诗皮肤',
            rewards1: [{ resId: 100, number: 2 }, { resId: 0, number: 5 }, null, 'x', { resId: 200 }],
            rewards2: [{ resId: 300, count: 7 }],
        },
        { id: 1, rmb: 12, desc: '重复 id 应被跳过' },
        { id: 0, rmb: 11 },
        { id: -3 },
        null,
        'string',
        [1, 2],
        { id: 2 }, // 没有 rmb → 未配置支付渠道
    ], (payChannelId) => (payChannelId === 11 ? 6 : 0));

    assert.equal(tiers.length, 2);

    const [first, second] = tiers;
    assert.equal(first.id, 1);
    assert.equal(first.rmb, 11);
    assert.equal(first.price, 6, 'price 走 priceOf(rmb)，不是 rmb 本身');
    assert.equal(first.desc, '史诗皮肤');
    assert.equal(first.days.length, FIRST_RECHARGE_DAYS);
    assert.deepEqual(first.days[0], [{ resId: 100, number: 2 }, { resId: 200, number: 1 }]);
    assert.deepEqual(first.days[1], [{ resId: 300, number: 7 }], 'number 缺失时回落 count');
    assert.deepEqual(first.days[2], [], 'rewards3 缺失 → 空数组（而不是少一个元素）');

    assert.equal(second.id, 2);
    assert.equal(second.rmb, 0);
    assert.equal(second.price, 0);
    assert.equal(second.desc, '');
    assert.deepEqual(second.days, [[], [], []]);
});

test('buildTiers 奖励条目的 number 兜底 1，数量非正/非有限则丢弃', () => {
    const [tier] = buildTiers([
        { id: 1, rmb: 11, rewards1: [{ resId: 1 }, { resId: 2, number: 0 }, { resId: 3, number: -2 }, { resId: 4, number: 'x' }, { resId: 5, number: 2.7 }] },
    ], () => 0);
    assert.deepEqual(tier.days[0], [{ resId: 1, number: 1 }, { resId: 5, number: 2 }]);
});

test('buildTiers 单行坏数据不会让整档消失（只丢那一条奖励）', () => {
    const [tier] = buildTiers([
        { id: 1, rmb: 11, rewards1: 'not-an-array', rewards2: [{ resId: 9, number: 1 }], rewards3: undefined },
    ], () => 0);
    assert.deepEqual(tier.days.map((d) => d.length), [0, 1, 0]);
});

test('buildPriceResolver：payChannel.rmb 才是金额，查不到返回 0', () => {
    const priceOf = buildPriceResolver([
        { id: 11, rmb: 6 },
        { id: 12, rmb: 30 },
        { id: 0, rmb: 99 },
        { id: 13, rmb: 0 },
        { id: 14, rmb: 'abc' },
        null,
    ]);
    assert.equal(priceOf(11), 6);
    assert.equal(priceOf(12), 30);
    assert.equal(priceOf(13), 0);
    assert.equal(priceOf(99), 0);
});

test('buildStateMap 扁平化 takenIds，active 必须严格为 true', () => {
    const states = buildStateMap([
        { id: 1, active: true, activeTime: '1700000000000', takenIds: [1, 0, 2] },
        { id: 2, active: 1, takenIds: [1] }, // 真值但不是 true → 未购买
        { id: 3 },                           // 字段全缺
        { id: 3, active: true, takenIds: [3] }, // 同 id 后者覆盖
        { id: -1 },
        null,
    ]);

    assert.equal(states.get(1)!.active, true);
    assert.equal(states.get(1)!.activeTime, 1700000000000);
    assert.deepEqual(states.get(1)!.taken, [1, 0, 2]);
    assert.equal(states.get(2)!.active, false);
    assert.deepEqual(states.get(3)!.taken, [3]);
    assert.equal(states.has(-1), false);
    assert.equal(buildStateMap(null).size, 0);
    assert.equal(buildStateMap(undefined).size, 0);
});

// ============================================================
// 判定
// ============================================================

const stateOf = (active: boolean, taken: number[], activeTime = 0): IFirstRechargeState =>
    ({ id: 1, active, activeTime, taken });

/** 激活于 3 天前 → 第 1..3 天全部解锁。 */
const D3_AGO = new Date(2026, 4, 1, 8, 0, 0, 0).getTime();
const NOW_DAY2 = new Date(2026, 4, 2, 9, 0, 0, 0).getTime(); // 今天 = 第 2 天
const NOW_DAY3 = new Date(2026, 4, 3, 9, 0, 0, 0).getTime(); // 今天 = 第 3 天

test('takenOf：下标从 0 起，越界/非法 day 按未领', () => {
    const state = stateOf(true, [1, 0, 2]);
    assert.equal(takenOf(state, 1), 1);
    assert.equal(takenOf(state, 2), 0);
    assert.equal(takenOf(state, 3), 2);
    assert.equal(takenOf(state, 4), 0);
    assert.equal(takenOf(state, 0), 0);
    assert.equal(takenOf(state, -1), 0);
});

test('dayStateOf 四态：未购买 / 已领 / 可领 / 未解锁', () => {
    const state = stateOf(true, [1, 0, 0], D3_AGO);
    assert.equal(dayStateOf(state, 1, NOW_DAY2), 'taken');
    assert.equal(dayStateOf(state, 2, NOW_DAY2), 'claimable');
    assert.equal(dayStateOf(state, 3, NOW_DAY2), 'locked', '第 3 天还没到');

    // 未购买 / 缺状态
    assert.equal(dayStateOf(stateOf(false, [0, 0, 0]), 1, NOW_DAY2), 'unbought');
    assert.equal(dayStateOf(undefined, 1, NOW_DAY2), 'unbought');
});

test('claimableDayOf 只返回第一个可领的天，没有则 0', () => {
    assert.equal(claimableDayOf(stateOf(true, [0, 0, 0], D3_AGO), NOW_DAY2), 1);
    // 第 1 天没领、第 3 天也已解锁 → 仍然先返回第 1 天（点一次领一天，不会跳着领）
    assert.equal(claimableDayOf(stateOf(true, [0, 0, 0], D3_AGO), NOW_DAY3), 1);
    assert.equal(claimableDayOf(stateOf(true, [1, 0, 0], D3_AGO), NOW_DAY2), 2);
    assert.equal(claimableDayOf(stateOf(true, [1, 1, 0], D3_AGO), NOW_DAY2), 0, '第 3 天还没解锁');
    assert.equal(claimableDayOf(stateOf(true, [1, 1, 1], D3_AGO), NOW_DAY2), 0);
    assert.equal(claimableDayOf(stateOf(true, [0, 0, 0], 0), NOW_DAY2), 0, '没激活时间');
    assert.equal(claimableDayOf(stateOf(false, [0, 0, 0], D3_AGO), NOW_DAY2), 0);
    assert.equal(claimableDayOf(undefined, NOW_DAY2), 0);
});

test('tierRedDotOf：有可领的天才亮红点', () => {
    assert.equal(tierRedDotOf(stateOf(true, [1, 0, 0], D3_AGO), NOW_DAY2), 1);
    assert.equal(tierRedDotOf(stateOf(true, [1, 1, 1], D3_AGO), NOW_DAY2), 0);
    assert.equal(tierRedDotOf(stateOf(false, [0, 0, 0]), NOW_DAY2), 0);
    assert.equal(tierRedDotOf(undefined, NOW_DAY2), 0);
});

test('buttonStateOf：未购买 / 可领 / 已领完', () => {
    assert.equal(buttonStateOf(stateOf(false, [0, 0, 0]), NOW_DAY2), 'buy');
    assert.equal(buttonStateOf(undefined, NOW_DAY2), 'buy');
    assert.equal(buttonStateOf(stateOf(true, [1, 0, 0], D3_AGO), NOW_DAY2), 'claim');
    assert.equal(buttonStateOf(stateOf(true, [1, 1, 1], D3_AGO), NOW_DAY2), 'taken');
    // 已购买，但今天只是第 1 天且已领 → 第 2 天还没解锁 → 也是 taken 态（不可点）
    assert.equal(buttonStateOf(stateOf(true, [1, 0, 0], NOW_DAY2), NOW_DAY2), 'taken');
});

// ============================================================
// tab 可见性
// ============================================================

const tierOf = (id: number): IFirstRechargeTier =>
    ({ id, rmb: id, price: id, desc: '', days: [[], [], []] });

test('visibleTierIndexes：前两档常显，第 3 档起要等第 2 档激活', () => {
    const tiers = [tierOf(1), tierOf(2), tierOf(3), tierOf(4)];

    assert.deepEqual(visibleTierIndexes(tiers, new Map()), [0, 1]);
    assert.deepEqual(
        visibleTierIndexes(tiers, buildStateMap([{ id: 1, active: true }])),
        [0, 1],
        '只买第 1 档不解锁后面的',
    );
    assert.deepEqual(
        visibleTierIndexes(tiers, buildStateMap([{ id: 2, active: true }])),
        [0, 1, 2, 3],
    );

    // 档位不足两档
    assert.deepEqual(visibleTierIndexes([tierOf(1)], new Map()), [0], '只有 1 档时也要出得来');
    assert.deepEqual(visibleTierIndexes([tierOf(1), tierOf(2)], new Map()), [0, 1]);
    assert.deepEqual(visibleTierIndexes([], new Map()), []);
});

test('常量与老客户端对齐', () => {
    assert.equal(FIRST_RECHARGE_DAYS, 3);
    assert.equal(FIRST_RECHARGE_ALWAYS_VISIBLE_TIERS, 2);
});

// ============================================================
// 品质框（真实 bug 的回归保护）
// ============================================================

test('qualityFrameName 把品质档线性压到 4 档，封顶 04', () => {
    assert.equal(qualityFrameName(0), 'common_img_pzk_01');
    assert.equal(qualityFrameName(1), 'common_img_pzk_01');
    assert.equal(qualityFrameName(2), 'common_img_pzk_01', '最低两档共用 01');
    assert.equal(qualityFrameName(3), 'common_img_pzk_02');
    assert.equal(qualityFrameName(4), 'common_img_pzk_03');
    assert.equal(qualityFrameName(5), 'common_img_pzk_04');
    assert.equal(qualityFrameName(9), 'common_img_pzk_04', '封顶');
    assert.equal(qualityFrameName(2.9), 'common_img_pzk_01');
});

test('QUALITY_FRAME_NAMES 是 qualityFrameName 的完整值域，恰好 4 张', () => {
    assert.equal(QUALITY_FRAME_NAMES.length, 4);
    assert.equal(new Set(QUALITY_FRAME_NAMES).size, 4, '不能有重复 —— 重复就意味着漏了一张');
    assert.deepEqual(
        Array.from(QUALITY_FRAME_NAMES),
        ['common_img_pzk_01', 'common_img_pzk_02', 'common_img_pzk_03', 'common_img_pzk_04'],
    );

    //  ★ 这里是那个真实 bug 的防线：
    //  曾经写成 `[qualityFrameName(1), qualityFrameName(2), qualityFrameName(3), qualityFrameName(4)]`，
    //  因为品质 1 和 2 都映射到 `01`，列出来只有 `01/01/02/03` —— `pzk_04` 永远不被预加载，
    //  高品级道具就**保留上一张框**（残影）。任何 `qualityFrameName()` 的结果都必须落在预加载集合里。
    for (let quality = 0; quality <= 12; quality++) {
        assert.ok(
            QUALITY_FRAME_NAMES.includes(qualityFrameName(quality)),
            `品质 ${quality} → ${qualityFrameName(quality)} 不在预加载列表里`,
        );
    }
});

// ============================================================
// 文案
// ============================================================

test('FIRST_RECHARGE_TEXTS 集中一处且没有空串', () => {
    for (const [key, value] of Object.entries(FIRST_RECHARGE_TEXTS)) {
        assert.equal(typeof value, 'string', `${key} 应该是字符串`);
        assert.ok((value as string).length > 0, `${key} 不能是空串（空串会静默留白）`);
    }
    assert.equal(FIRST_RECHARGE_TEXTS.title, '首充礼包');
    assert.equal(FIRST_RECHARGE_TEXTS.claim, '领取');
    assert.equal(FIRST_RECHARGE_TEXTS.taken, '已领取');
    assert.equal(`${FIRST_RECHARGE_TEXTS.countPrefix}5`, 'x5');
    assert.equal(
        `${FIRST_RECHARGE_TEXTS.dayPrefix}2${FIRST_RECHARGE_TEXTS.daySuffix}`,
        '第2天',
    );
});
