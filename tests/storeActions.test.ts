/**
 * 「商城 · 动作层」的回归网 —— 守**规则**，不守 prefab。
 *
 * 与 `tests/store.test.ts` 的分工：
 * - `store.test.ts` 守 **版面**（6 张 prefab 的节点 / 几何 / 组件 / 接线）；
 * - 本文件守 **点击之后发生什么**（`StoreCostTable` 的三条老端规则 + `StoreTexts` 文案 +
 *   `StoreAd` 广告位映射 + `StoreShopTable` 的 `rowId` 口径）。
 *
 * 三个被测文件都**引擎无关**（`StoreCostTable` / `StoreTexts` 不 import 任何东西，
 * `StoreShopTable` 同样；`StoreAd` 只依赖 `RefEnum` + `CacheMgr`），所以能直接跑。
 * `StoreActions` / `StoreRepository` 依赖 `cc` 生态（`Toast` / `CommonTips` / `GameNet`），
 * **不在单测范围内** —— 它们的端到端行为由 `tmp/_store2_tap.mjs` 在引擎里真触摸验证。
 *
 * 规则真源：`client/assets/script/app/game/ctrl/main/store/TabStoreMain.ts`
 * （`RenderBox` 的价格换算 / `onClickCoin` 的三档分流 / `GetAdType`）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildProbabilitySections,
    canBuyWithLimit,
    formatProbabilityText,
    isCooldownOver,
    resolveCoinBranch,
    resolveDrawCost,
    type IGemBoxCostRow,
} from '../assets/script/app/store/StoreCostTable';
import {
    STORE_GIFT_FREE_UNAVAILABLE,
    STORE_GIFT_PAGING_UNAVAILABLE,
    STORE_TEXTS,
    formatRate,
} from '../assets/script/app/store/StoreTexts';
import { STORE_GIFT_ROW } from '../assets/script/app/store/StoreShopTable';
import { STORE_AD_TYPE_COMMON_BOX, STORE_AD_TYPE_SUPER_BOX, storeAdLimit, storeAdTypeOfBox } from '../assets/script/app/store/StoreAd';

// ============================================================
// 夹具：真源 `gemBox.json` 的两行（低级 id=1 / 高级 id=2）
// ============================================================

/** 低级宝石宝箱：钥匙 1 把；不够则 50 金币单抽 / 500 金币十连。 */
const LOW_BOX: IGemBoxCostRow = {
    id: 1, priceType: 10991, cost: 1, priceType3: 10, cost3: 50, cost2: 500, quality: 3, quality2: 3,
};

/** 高级宝石宝箱：钥匙 1 把；不够则 250 金币单抽 / 2500 金币十连。 */
const HIGH_BOX: IGemBoxCostRow = {
    id: 2, priceType: 10992, cost: 1, priceType3: 10, cost3: 250, cost2: 2500, quality: 4, quality2: 5,
};

/** 构造「某 resId 有多少个」的查询器。 */
function heldOf(map: Readonly<Record<number, number>>): (resId: number) => number {
    return (resId) => map[resId] ?? 0;
}

// ============================================================
// A. 抽奖花费（老端 `RenderBox` L620–633）
// ============================================================

test('A1 钥匙够 ⇒ 用钥匙，单抽扣 1 把', () => {
    const cost = resolveDrawCost(LOW_BOX, heldOf({ 10991: 5 }), false);
    assert.deepEqual(cost, { resId: 10991, number: 1, fallback: false });
});

test('A2 钥匙不够 ⇒ 退到金币，单抽扣 50', () => {
    const cost = resolveDrawCost(LOW_BOX, heldOf({ 10991: 0, 10: 9999 }), false);
    assert.deepEqual(cost, { resId: 10, number: 50, fallback: true });
});

test('A3 十连：首选数量是 cost×10（不是 cost）', () => {
    // 钥匙 10 把 ⇒ 十连够（老端 `costTen = refGemBox.cost * 10`）
    const enough = resolveDrawCost(LOW_BOX, heldOf({ 10991: 10 }), true);
    assert.deepEqual(enough, { resId: 10991, number: 10, fallback: false });
    // 钥匙 9 把 ⇒ 十连不够
    const short = resolveDrawCost(LOW_BOX, heldOf({ 10991: 9, 10: 9999 }), true);
    assert.deepEqual(short, { resId: 10, number: 500, fallback: true });
});

test('A4 高级宝箱的备选数量与低级不同（250 / 2500）', () => {
    assert.deepEqual(resolveDrawCost(HIGH_BOX, heldOf({}), false), { resId: 10, number: 250, fallback: true });
    assert.deepEqual(resolveDrawCost(HIGH_BOX, heldOf({}), true), { resId: 10, number: 2500, fallback: true });
});

test('A5 单次与十连各自独立判定（老端两个 if 不连坐）', () => {
    // 钥匙 5 把：单抽够（1），十连不够（10）—— 不能因为十连不够就把单抽也改成金币。
    const held = heldOf({ 10991: 5, 10: 9999 });
    assert.equal(resolveDrawCost(LOW_BOX, held, false).fallback, false);
    assert.equal(resolveDrawCost(LOW_BOX, held, true).fallback, true);
});

test('A6 `priceType = 0` 视为「没有首选价格」⇒ 直接走备选', () => {
    const noKeyBox: IGemBoxCostRow = { ...LOW_BOX, priceType: 0 };
    // 即便把「0 号资源」塞成无限，也不该用它（老端是 `priceType == 0 || !够`）。
    const cost = resolveDrawCost(noKeyBox, heldOf({ 0: 99999, 10: 9999 }), false);
    assert.deepEqual(cost, { resId: 10, number: 50, fallback: true });
});

// ============================================================
// B. 铜钱铺三档分流（老端 `onClickCoin`）
// ============================================================

test('B1 免费档 / 广告档 / 付费档的边界（free=1, ad=1）', () => {
    assert.equal(resolveCoinBranch(1, 1, 0), 'free');
    assert.equal(resolveCoinBranch(1, 1, 1), 'ad');
    assert.equal(resolveCoinBranch(1, 1, 2), 'paid');
    assert.equal(resolveCoinBranch(1, 1, 99), 'paid');
});

test('B2 免费多次时按次数走', () => {
    assert.equal(resolveCoinBranch(3, 2, 2), 'free');
    assert.equal(resolveCoinBranch(3, 2, 3), 'ad');
    assert.equal(resolveCoinBranch(3, 2, 5), 'paid');
});

test('B3 黑市（`resourceShop` 没有 freeTimes / adTimes）恒为付费档', () => {
    assert.equal(resolveCoinBranch(0, 0, 0), 'paid');
    assert.equal(resolveCoinBranch(undefined, undefined, 0), 'paid');
});

// ============================================================
// C. 限购
// ============================================================

test('C1 `limit <= 0` 表示不限购', () => {
    assert.equal(canBuyWithLimit(0, 999), true);
    assert.equal(canBuyWithLimit(-1, 999), true);
    assert.equal(canBuyWithLimit(undefined, 999), true);
});

test('C2 限购上限是「开区间」：已买 == 上限即不可买', () => {
    assert.equal(canBuyWithLimit(2, 0), true);
    assert.equal(canBuyWithLimit(2, 1), true);
    assert.equal(canBuyWithLimit(2, 2), false);
    assert.equal(canBuyWithLimit(1, 1), false);
});

// ============================================================
// D. 冷却
// ============================================================

test('D1 无冷却（`nextBuyTime` 为 0 / 缺省）一律放行', () => {
    assert.equal(isCooldownOver(0, 1000), true);
    assert.equal(isCooldownOver(undefined, 1000), true);
});

test('D2 到点前拦住、到点后放行', () => {
    assert.equal(isCooldownOver(1010, 1000), false);
    assert.equal(isCooldownOver(1000, 1000), true);
    assert.equal(isCooldownOver(990, 1000), true);
});

// ============================================================
// E. 概率说明（本端从 `gemBox` 表当场生成）
// ============================================================

test('E1 必得 + 稀有分段，稀有保留**原始权重**不换算百分比', () => {
    const sections = buildProbabilitySections(
        [{ resId: 10023, number: 1 }],
        [{ resId: 11003, number: 1, pro: 40 }, { resId: 11004, number: 1, pro: 4 }],
        (resId) => `物品${resId}`,
    );
    assert.equal(sections.length, 2);
    assert.equal(sections[0].heading, '必得奖励');
    assert.deepEqual(sections[0].lines, ['物品10023 x1']);
    assert.ok(sections[1].lines[0].includes('权重 40'), `稀有行要带原始权重，实得「${sections[1].lines[0]}」`);
    assert.ok(sections[1].lines[1].includes('权重 4'));
});

test('E2 有保底进度时排在最前', () => {
    const sections = buildProbabilitySections(
        [{ resId: 10023, number: 1 }],
        [],
        (resId) => `物品${resId}`,
        { rest: 9, qualityName: '紫色宝石' },
    );
    assert.equal(sections[0].heading, '保底');
    assert.ok(sections[0].lines[0].includes('9'));
    assert.ok(sections[0].lines[0].includes('紫色宝石'));
});

test('E3 全空时给一条兜底段落（弹窗不会是空白）', () => {
    const sections = buildProbabilitySections([], [], (resId) => `物品${resId}`);
    assert.equal(sections.length, 1);
    assert.equal(sections[0].lines.length, 1);
});

test('E4 段落拼成整段文本：每段带【标题】、段间空行', () => {
    const text = formatProbabilityText([
        { heading: 'A', lines: ['a1', 'a2'] },
        { heading: 'B', lines: ['b1'] },
    ]);
    assert.equal(text, '【A】\na1\na2\n\n【B】\nb1');
});

// ============================================================
// F. 文案（★ 本轮用户诉求的守点）
// ============================================================

test('F1 全部提示文案里**不再出现「开发中」**（本轮核心诉求）', () => {
    const texts: string[] = [
        ...Object.values(STORE_TEXTS),
        STORE_GIFT_FREE_UNAVAILABLE,
        STORE_GIFT_PAGING_UNAVAILABLE,
    ];
    assert.ok(texts.length > 0);
    for (const text of texts) {
        assert.ok(!text.includes('开发中'), `仍有占位文案「${text}」`);
    }
});

test('F2 两条「缺能力」提示要**说清缺什么**，不能含糊', () => {
    assert.ok(STORE_GIFT_FREE_UNAVAILABLE.includes('RequestRoleGuanKaGiftGetFree'), '免费领奖要报出缺的协议名');
    assert.ok(STORE_GIFT_PAGING_UNAVAILABLE.length > 0);
});

test('F3 抽奖二次确认文案带 `{0}` 占位（老端 `GEM_GACHA_TIP`）', () => {
    assert.ok(STORE_TEXTS.gachaTip.includes('{0}'));
});

test('F4 百分比格式化：去掉尾随 0、非法值退 0%', () => {
    assert.equal(formatRate(12.5), '12.5%');
    assert.equal(formatRate(12.5000), '12.5%');
    assert.equal(formatRate(0), '0%');
    assert.equal(formatRate(Number.NaN), '0%');
});

// ============================================================
// G. 礼包行的 `rowId` 口径
// ============================================================

test('G1 礼包 `rowId` 必须是 `guankaGift.id`（18），不是 `level`（50）', () => {
    // 老端 `ModelStore.requestBuyGuanKaGift(ref.id)` 发的是 id；
    // `guankaGift.json` 里 `id=18 → level=50`，两者**不相等**，传错会买到别的档。
    assert.equal(STORE_GIFT_ROW.id, 18);
    assert.equal(STORE_GIFT_ROW.level, 50);
    assert.notEqual(STORE_GIFT_ROW.id, STORE_GIFT_ROW.level);
});

// ============================================================
// H. 广告位映射（老端 `GetAdType`）
// ============================================================

test('H1 宝箱 2（高级）走 superBox，其余一律 commonBox', () => {
    assert.equal(storeAdTypeOfBox(2), STORE_AD_TYPE_SUPER_BOX);
    assert.equal(storeAdTypeOfBox(1), STORE_AD_TYPE_COMMON_BOX);
    // 老端 `default` 分支：不是「id==1 才 commonBox」
    assert.equal(storeAdTypeOfBox(0), STORE_AD_TYPE_COMMON_BOX);
    assert.equal(storeAdTypeOfBox(99), STORE_AD_TYPE_COMMON_BOX);
});

test('H2 广告位数值与 `ad.json` 的 `type` 一一对应', () => {
    assert.equal(STORE_AD_TYPE_COMMON_BOX, 1);
    assert.equal(STORE_AD_TYPE_SUPER_BOX, 2);
});

test('H3 `ad` 表上限：有行取 limit、`limit<=0` 与缺行都退到 1（老端同一兜底）', () => {
    const rows = [{ type: 1, limit: 3 }, { type: 2, limit: 0 }];
    assert.equal(storeAdLimit(rows, 1), 3);
    assert.equal(storeAdLimit(rows, 2), 1, 'limit=0 会让文案变成 1/0，必须退到 1');
    assert.equal(storeAdLimit(rows, 9), 1, '表里没有这一行时退到 1');
    assert.equal(storeAdLimit([], 1), 1);
});
