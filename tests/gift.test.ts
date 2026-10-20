/**
 * 礼包（老端 `LayerGift` / FGUI 包「礼包」）移植的回归网。
 *
 * 分五段，各守一件事：
 *
 *   A. **判定口径**（`GiftTable`，零 import 纯函数）—— 老端这些判定散在
 *      `SubTabSpecialGiftBase` / `TabGiftLingYu` / `VORole` 里（依赖 DI 容器 + FGUI 控制器），
 *      没法单测；移植时全收敛成传参纯函数，本段是它们唯一的回归网。
 *   B. **资源口径**（`GiftArt`）—— 两处「查不到就静默不出图」的坑：`item` 表主键是 `resId`
 *      不是 `id`、`roleProperty` 货币档（7/8/9/10）不在 `item` 表里。
 *   C. **prefab 结构 + 几何** —— 脚本组件的 `__type__` 必须能从 `*.ts.meta` 反解（防 cid 抄错
 *      成 `MissingScript`）；节点位置必须与 FGUI XML 反解出的画布像素一致。
 *   D. **数据管道接线**（源码文本）—— 协议名、缓存读法（走 `CacheMgr` 不走自存快照）、超时兜底。
 *   E. **文案表**。
 *
 * 口径真源：
 *   - 配置：`assets/remoteRef/giftShop.json` / `payChannel.json` / `item.json`
 *   - 老端：`client/assets/script/app/game/ctrl/main/gift/**`
 *           + `client/assets/script/app/game/model/vo/Other/VORole.ts`（`CheckIsFirstBuy`）
 *   - 设计：`zarts/art/UIProject/trunk/UIProject/assets/礼包/组件/**`
 *   - 页签开关：新项目 `open.json`（**不是**老端代码里的那三条）
 *
 * ⚠️ 三处**刻意与老端不同**（理由见 `GiftTable.ts` / `GiftArt.ts` 文件头），本文件把它们
 *    当契约钉住，别当 bug 改回去：
 *      ① 页签按新项目 `open.json`：超值礼包 + 灵玉直冲（老端是超值礼包/每日充值/累计充值）；
 *      ② 底部大页签只用底图 + Label，不引 `按钮_首页_菜单` 那套 27 页的主界面图标；
 *      ③ 灵玉页点购买只提示「支付功能尚未接入」（Demo3.8 没有 `SDKMgr`）。
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import {
    collectGiftRewardResIds,
    discountTextOf,
    GIFT_CURRENCY_RES_ID,
    GIFT_MAIN_TABS,
    GIFT_RESOURCE_ICON_IDS,
    GIFT_SHOP_TYPE,
    GIFT_SUB_TAB_ORDER,
    GIFT_TYPE_DAILY,
    GIFT_TYPE_MONTH,
    GIFT_TYPE_ONCE,
    GIFT_TYPE_WEEK,
    giftBuyButtonOf,
    giftShopStateOf,
    giftSubTabOf,
    limitTextOf,
    listGiftOfType,
    listLingYuCards,
    listSubTabs,
    normalizePaidChannelIds,
    normalizeShopGoods,
    parseGiftItemRows,
    parseGiftShopRow,
    parseGiftShopRows,
    parsePayChannelRows,
    payCoinText,
    payPriceText,
    sortGiftRows,
    visiblePayChannels,
} from '../assets/script/app/gift/GiftTable';
import type { IGiftShopRow, IPayChannelRow } from '../assets/script/app/gift/GiftTable';

import {
    GIFT_ART_NAMES,
    GIFT_ART_ROOT,
    GIFT_RES_ICON_ART,
    GIFT_SUB_TAB_ART,
    giftArtPath,
    giftCurrencyIconRef,
    giftResIconRef,
    qualityFrameName,
    resolveGiftIconRef,
} from '../assets/script/app/gift/GiftArt';
import { formatText, GIFT_TEXTS } from '../assets/script/app/gift/GiftTexts';

// ============================================================
// 夹具：直接读工程真实配置表（策划改表 ⇒ 本段立刻红，是有意的）
// ============================================================

const GIFT_SHOP_TABLE = 'assets/remoteRef/giftShop.json';
const PAY_CHANNEL_TABLE = 'assets/remoteRef/payChannel.json';
const ITEM_TABLE = 'assets/remoteRef/item.json';

/** `remoteRef/*.json` 顶层就是行数组。 */
function readTable(path: string): readonly unknown[] {
    assert.ok(existsSync(path), `配置表不存在：${path}`);
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    assert.ok(Array.isArray(parsed), `${path} 顶层不是数组`);
    // `assert.ok` 不是类型守卫（不像 `assert` 断言函数那样收窄）⇒ 这里必须显式 cast
    return parsed as readonly unknown[];
}

const SHOP_ROWS = parseGiftShopRows(readTable(GIFT_SHOP_TABLE));
const PAY_ROWS = parsePayChannelRows(readTable(PAY_CHANNEL_TABLE));
const ITEMS = parseGiftItemRows(readTable(ITEM_TABLE));

// ============================================================
// A. GiftTable 判定口径
// ============================================================

test('A1 商店类型 = 5（`CmdShopType.gift`），大页签按 open.json 只有两项', () => {
    assert.equal(GIFT_SHOP_TYPE, 5);
    assert.deepEqual(
        GIFT_MAIN_TABS.map((tab) => tab.resId),
        [409, 412],
        'open.json 里 preResId=103 的开启行：409 超值礼包 / 412 灵玉直冲；411 晶石兑换是关的',
    );
    assert.deepEqual(GIFT_MAIN_TABS.map((tab) => tab.key), ['special', 'lingYu']);
});

test('A2 ⚠️ 子页签恒 3 个，`type=4`（终身礼包）**有数据也不出页签**', () => {
    // 表里确实有 type=4 的行（26 行），但 `open.json` 的 416 是关的 ⇒ 不进 `GIFT_SUB_TAB_ORDER`
    const onceRows = listGiftOfType(SHOP_ROWS, GIFT_TYPE_ONCE);
    assert.ok(onceRows.length > 0, `本测试前提：表里要有 type=${GIFT_TYPE_ONCE} 的行`);

    const tabs = listSubTabs(SHOP_ROWS);
    assert.deepEqual(
        tabs.map((tab) => tab.type),
        [GIFT_TYPE_DAILY, GIFT_TYPE_WEEK, GIFT_TYPE_MONTH],
        '顺序恒按 GIFT_SUB_TAB_ORDER，不跟表行序走',
    );
    assert.deepEqual(
        tabs.map((tab) => tab.artKey),
        ['daily', 'week', 'month'],
    );
    assert.ok(!tabs.some((tab) => tab.type === GIFT_TYPE_ONCE), '终身礼包不该出页签');
    assert.deepEqual([...GIFT_SUB_TAB_ORDER], [1, 2, 3]);
});

test('A3 `giftSubTabOf` 认得 4 号（页签表管不到它，但文案要能取）', () => {
    assert.equal(giftSubTabOf(GIFT_TYPE_ONCE)?.artKey, 'once');
    assert.equal(giftSubTabOf(0), null);
    assert.equal(giftSubTabOf(99), null);
});

test('A4 子页签标题图只映射 daily/week/month —— `once` 故意不映射', () => {
    assert.deepEqual(Object.keys(GIFT_SUB_TAB_ART).sort(), ['daily', 'month', 'week']);
    assert.equal(GIFT_SUB_TAB_ART.once, undefined);
    assert.equal(GIFT_SUB_TAB_ART.daily, 'tabDaily');
    // 映射到的 key 必须在美术表里有对应文件名，否则界面上是一块空白页签
    for (const artKey of Object.values(GIFT_SUB_TAB_ART)) {
        assert.ok(GIFT_ART_NAMES[artKey], `GIFT_SUB_TAB_ART 指向了不存在的美术键：${artKey}`);
    }
});

test('A5 `parseGiftShopRow` 在 `desc` 为空时判非法（行标题唯一来源）', () => {
    const base = { id: 1, type: 1, desc: '体力福利', cost: 0, limit: 1, rewards: [] };
    assert.ok(parseGiftShopRow(base), '正常行要解析出来');
    assert.equal(parseGiftShopRow({ ...base, desc: '' }), null, 'desc 空 ⇒ 画不出标题 ⇒ 判非法');
    assert.equal(parseGiftShopRow({ ...base, desc: undefined }), null);
    assert.equal(parseGiftShopRow({ ...base, id: 0 }), null);
    assert.equal(parseGiftShopRow({ ...base, id: -3 }), null);
    assert.equal(parseGiftShopRow({ ...base, type: 0 }), null);
    assert.equal(parseGiftShopRow(null), null);
    assert.equal(parseGiftShopRow('nope' as unknown), null);

    // `title` 与 `desc` 都在时，两个字段各存各的（标题口径由 UI 层决定用 desc）
    const both = parseGiftShopRow({ ...base, title: '表里标题', desc: '展示标题' });
    assert.equal(both?.title, '表里标题');
    assert.equal(both?.desc, '展示标题');
});

test('A6 `rewards` 里 `resId <= 0` 或数量 <= 0 的条目被丢掉', () => {
    const row = parseGiftShopRow({
        id: 1,
        type: 1,
        desc: 'x',
        rewards: [
            { resId: 10, number: 60 },
            { resId: 0, number: 5 },
            { resId: 7, number: 0 },
            { resId: -1, number: 3 },
            { resId: 9, number: 2 },
            null,
        ],
    });
    assert.deepEqual(row?.rewards, [
        { resId: 10, number: 60 },
        { resId: 9, number: 2 },
    ]);
});

test('A7 状态判定：**先判售罄，售罄时不再看 cost**', () => {
    const free: IGiftShopRow = { ...SHOP_ROWS[0]!, cost: 0, limit: 1 };
    const paid: IGiftShopRow = { ...SHOP_ROWS[0]!, cost: 60, limit: 3 };

    assert.equal(giftShopStateOf(free, 0), 'free');
    assert.equal(giftShopStateOf(free, 1), 'soldOut', '限购 1 且已购 1 ⇒ 售罄（即使 cost=0）');
    assert.equal(giftShopStateOf(paid, 0), 'buyable');
    assert.equal(giftShopStateOf(paid, 2), 'buyable');
    assert.equal(giftShopStateOf(paid, 3), 'soldOut');
    assert.equal(giftShopStateOf(paid, 99), 'soldOut');
    assert.equal(giftShopStateOf({ ...paid, limit: 0 }, 99), 'buyable', 'limit=0 ⇒ 不限购，永远能买');

    // 非法已购次数（undefined / NaN / 负数）一律当 0
    assert.equal(giftShopStateOf(paid, Number.NaN), 'buyable');
    assert.equal(giftShopStateOf(paid, -5), 'buyable');
});

test('A8 折扣文案：`1折 ~ 7折` 都会显示（表里 discount 不只 0/1/3/5）', () => {
    assert.equal(discountTextOf(0), '', '0 = 不打折 = 不显示角标');
    assert.equal(discountTextOf(-1), '');
    assert.equal(discountTextOf(10), '', '防御：万一以后按百分制填 10');
    assert.equal(discountTextOf(Number.NaN), '');
    for (const value of [1, 2, 3, 4, 5, 6, 7]) {
        assert.equal(discountTextOf(value), `${value}折`);
    }
});

test('A9 限购文案：`limit <= 0` 时返回空串（不限购不显示）', () => {
    assert.equal(limitTextOf(0, 1), '限购 0/1');
    assert.equal(limitTextOf(3, 5), '限购 3/5');
    assert.equal(limitTextOf(0, 0), '');
    assert.equal(limitTextOf(5, -1), '');
    assert.equal(limitTextOf(Number.NaN, 5), '限购 0/5');
});

test('A10 行排序：**还能买的排前面**，同组按 id 升序；不原地改入参', () => {
    const rows: readonly IGiftShopRow[] = [
        { ...SHOP_ROWS[0]!, id: 30, limit: 1 },
        { ...SHOP_ROWS[0]!, id: 10, limit: 1 },
        { ...SHOP_ROWS[0]!, id: 20, limit: 0 },
    ];
    const snapshot = rows.map((row) => row.id);
    const sorted = sortGiftRows(rows, (id) => (id === 30 ? 1 : 0));

    assert.deepEqual(sorted.map((row) => row.id), [10, 20, 30], '售罄的 30 沉底，其余按 id');
    assert.deepEqual(rows.map((row) => row.id), snapshot, 'sortGiftRows 不能改入参数组');
});

test('A11 价格 / 数量文案', () => {
    assert.equal(payPriceText(6), '¥6');
    assert.equal(payPriceText(648), '¥648');
    assert.equal(payPriceText(0), '');
    assert.equal(payPriceText(-1), '');
    assert.equal(payCoinText(60), '60');
    assert.equal(payCoinText(0), '0');
    assert.equal(payCoinText(-5), '0');
});

test('A12 ⚠️ 灵玉档位只留 `isShow === 1`，按 rmb 升序（不过滤会排出 484 张卡）', () => {
    assert.ok(PAY_ROWS.length > 100, `本测试前提：payChannel 是长表（实测 ${PAY_ROWS.length} 行）`);

    const visible = visiblePayChannels(PAY_ROWS);
    assert.equal(visible.length, 6, `isShow===1 的档位实测 6 个，现在是 ${visible.length} 个`);
    assert.deepEqual(
        visible.map((row) => row.rmb),
        [6, 30, 68, 128, 328, 648],
        '按 rmb 升序 —— 表行序不是升序，必须显式排',
    );
    assert.deepEqual(visible.map((row) => row.id), [1, 2, 3, 4, 5, 6]);
    assert.ok(visible.every((row) => row.coin === row.rmb * 10), '实测 coin = rmb × 10');

    // `isShow` 缺失的行一律排除（不是按「非 0」判，是按「恒等于 1」判）
    const mixed: readonly IPayChannelRow[] = [
        { ...PAY_ROWS[0]!, id: 1, rmb: 10, isShow: 1 },
        { ...PAY_ROWS[0]!, id: 2, rmb: 5, isShow: 2 },
        { ...PAY_ROWS[0]!, id: 3, rmb: 1, isShow: 0 },
    ];
    assert.deepEqual(visiblePayChannels(mixed).map((row) => row.id), [1]);
});

test('A13 首充标记：`tlExtraId` **没有**本档位 ⇒ `firstBuy = true`（老端口径）', () => {
    assert.deepEqual(normalizePaidChannelIds(null), new Set<number>());
    assert.deepEqual(normalizePaidChannelIds(undefined), new Set<number>());
    assert.deepEqual(normalizePaidChannelIds({}), new Set<number>(), '字段缺失 ⇒ 空集');
    assert.deepEqual(normalizePaidChannelIds({ tlExtraId: 'nope' }), new Set<number>());
    assert.deepEqual(
        [...normalizePaidChannelIds({ tlExtraId: [1, 0, -2, 3, null] })].sort((a, b) => a - b),
        [1, 3],
        '只收 > 0 的整数',
    );

    const cards = listLingYuCards(PAY_ROWS, new Set([1, 2]));
    assert.equal(cards.length, 6);
    assert.equal(cards[0]?.row.id, 1);
    assert.equal(cards[0]?.firstBuy, false, '买过 1 ⇒ 不是首充');
    assert.equal(cards[1]?.firstBuy, false);
    assert.equal(cards[2]?.firstBuy, true, '没买过 3 ⇒ 首充双倍还在');

    // 默认参数：全都没买过
    assert.ok(listLingYuCards(PAY_ROWS).every((card) => card.firstBuy));
});

test('A14 购买按钮三态：免费 / 有货币图标（裸数字）/ 无图标（拼货币名）', () => {
    const paid: IGiftShopRow = { ...SHOP_ROWS[0]!, cost: 60, limit: 1 };
    const free: IGiftShopRow = { ...SHOP_ROWS[0]!, cost: 0, limit: 1 };
    const options = { freeText: GIFT_TEXTS.free, currencyName: GIFT_TEXTS.currency, hasCurrencyIcon: true };

    assert.deepEqual(giftBuyButtonOf(free, 0, options), { text: '免费', showIcon: false });
    assert.deepEqual(giftBuyButtonOf(paid, 0, options), { text: '60', showIcon: true }, '老端就是裸数字 + 左侧货币图标');
    assert.deepEqual(
        giftBuyButtonOf(paid, 0, { ...options, hasCurrencyIcon: false }),
        { text: '60幻灵玉', showIcon: false },
        '拿不到图标时降级成「60幻灵玉」，不能只画个光秃秃的 60',
    );
    // 售罄时老端整颗按钮被 gearDisplay 藏掉 ⇒ 本函数不管售罄态（页面判状态）
    assert.deepEqual(giftBuyButtonOf(paid, 1, options), { text: '60', showIcon: true });
});

test('A15 `CmdShop` 收敛：`tlCmdShopGoods[].buyTimes`，非法行跳过', () => {
    assert.deepEqual([...normalizeShopGoods(null)], []);
    assert.deepEqual([...normalizeShopGoods({})], []);
    assert.deepEqual([...normalizeShopGoods({ tlCmdShopGoods: 'x' })], []);

    const map = normalizeShopGoods({
        tlCmdShopGoods: [
            { id: 1, buyTimes: 2 },
            { id: 2, buyTimes: -1 },
            { id: 0, buyTimes: 5 },
            null,
            { id: 3 },
        ],
    });
    assert.equal(map.get(1), 2);
    assert.equal(map.get(2), 0, '负数收敛到 0');
    assert.equal(map.has(0), false, 'id <= 0 跳过');
    assert.equal(map.get(3), 0, 'buyTimes 缺失当 0');
});

test('A16 预加载 resId 去重且保序（宿主必须在铺列表**之前** await 完）', () => {
    const rows = parseGiftShopRows([
        { id: 1, type: 1, desc: 'a', rewards: [{ resId: 10, number: 1 }, { resId: 7, number: 1 }] },
        { id: 2, type: 1, desc: 'b', rewards: [{ resId: 10, number: 5 }, { resId: 9, number: 1 }] },
    ]);
    assert.deepEqual(collectGiftRewardResIds(rows), [10, 7, 9]);
    assert.deepEqual(collectGiftRewardResIds([]), []);
});

// ============================================================
// B. GiftArt 资源口径
// ============================================================

test('B1 礼包美术目录 + 20 张图登记齐（缺一个就是一个白框）', () => {
    assert.equal(GIFT_ART_ROOT, 'image/gift');
    const names = Object.values(GIFT_ART_NAMES);
    assert.equal(names.length, 20);
    assert.equal(new Set(names).size, 20, '文件名不能重复');
    assert.ok(
        names.every((name) => name.startsWith('gf_')),
        '礼包美术统一 `gf_` 前缀（七日那批是 `sd_`），混进别的模块前缀说明拷错了',
    );
    assert.equal(GIFT_ART_NAMES.back, 'gf_btn_back');
    assert.equal(GIFT_ART_NAMES.btnBuy, 'gf_btn_buy');
    assert.equal(GIFT_ART_NAMES.btnLingYu, 'gf_btn_lingyu');
});

test('B2 `giftArtPath` 未知键返回 null（不拼出半个路径去 load）', () => {
    assert.equal(giftArtPath('nope'), null);
    const path = giftArtPath('rowBg');
    assert.ok(path, 'rowBg 要能出路径');
    assert.ok(path!.startsWith(`${GIFT_ART_ROOT}/`), `路径要在 ${GIFT_ART_ROOT} 下：${path}`);
    assert.ok(path!.endsWith('/spriteFrame'), `装配路径必须以 /spriteFrame 结尾：${path}`);
});

test('B3 大页签在 prefab 上绑定主页同款金色选中底板', () => {
    const prefab = JSON.parse(readFileSync('assets/resources/ui/Gift/Gift.prefab', 'utf8')) as Array<Record<string, unknown>>;
    const tabs = prefab.filter((item) => Object.prototype.hasOwnProperty.call(item, 'selectedFrame'));
    assert.equal(tabs.length, 3, '三个大页签都要绑定选中资源');
    for (const tab of tabs) {
        assert.deepEqual(tab.selectedFrame, {
            __uuid__: '5aa83ea4-4ad3-4935-9da7-c6081617404f@f9941',
            __expectedType__: 'cc.SpriteFrame',
        });
    }
});

test('B4 ⚠️ `roleProperty` 货币档的图标：五档都有图（`8` 洗炼石 2026-09-29 补上）', () => {
    assert.deepEqual(GIFT_RESOURCE_ICON_IDS, [6, 7, 9, 10]);
    assert.equal(GIFT_RES_ICON_ART[10], '图标_幻灵玉', 'coin 的图标是幻灵玉，别再叫元宝');
    // ⚠️ 2026-09-29：`icons/resource/图标_洗炼石.png` 已存在（旧断言「整工程没有这张图」过时），
    //    8 不再降级成「只画品质框」。映射真源 = `roleProperty.json` 的 `icon` 列。
    assert.equal(GIFT_RES_ICON_ART[8], '图标_洗炼石');

    // 目录统一到 `icons/resource`（真源 `roleProperty.icon`，与 `resolveRewardIconRef` 同源）
    assert.deepEqual(giftResIconRef(10), { root: 'icons/resource', name: '图标_幻灵玉' });
    assert.ok(giftResIconRef(6), '6 灵石有图');
    assert.ok(giftResIconRef(7), '7 铜币有图');
    assert.ok(giftResIconRef(9), '9 体力有图');
    assert.deepEqual(giftResIconRef(8), { root: 'icons/resource', name: '图标_洗炼石' }, '洗炼石已补图，不再降级');
    assert.equal(giftResIconRef(10992), null, '道具 id 走 item 表，不走这条路径');

    assert.equal(giftCurrencyIconRef().name, '图标_幻灵玉');
});

test('B5 ⚠️ 奖励图标两级兜底：`item.icon` 优先，查不到（或老格式裸名）才走 resbar', () => {
    // ① item 表查得到 ⇒ 用 item.icon 的资源路径
    assert.deepEqual(
        resolveGiftIconRef({ icon: 'icons/item/图标_兵书随机' }, 10992),
        { root: 'icons/item', name: '图标_兵书随机' },
    );
    // ② item 表查不到（roleProperty 货币档）⇒ resbar
    assert.deepEqual(resolveGiftIconRef(undefined, 10), { root: 'icons/resource', name: '图标_幻灵玉' });
    // ③ item.icon 是老格式裸组件名（解析不出）⇒ **继续往下兜底**，不能返回 null
    assert.deepEqual(
        resolveGiftIconRef({ icon: '图标_图纸_帽子' }, 10),
        { root: 'icons/resource', name: '图标_幻灵玉' },
        '裸名必须返 null（否则会拿组件名当路径去 load），然后兜底到货币图',
    );
    // ④ 两边都没有 ⇒ null
    assert.equal(resolveGiftIconRef(undefined, 99999), null);
    assert.equal(resolveGiftIconRef({ icon: '' }, 99999), null);
});

test('B6 品质框：`clamp(quality − 1, 1, 4)` —— 与七日狂欢**同算法**（不是 `quality` 直接当档）', () => {
    // `item.quality` 实测 1~7，而 `image/frame/` 只有 4 张框 ⇒ 必须压档。
    // 算法是 `Math.floor(quality) - 1` 再 clamp 到 1..4（见 `GiftArt.qualityFrameLevel`，
    // 与 `SevenDayArt.qualityFrameLevel` 逐字一致）——
    // ⇒ **q1/q2 → 框1**、q3 → 框2、q4 → 框3、q5 及以上 → 框4。
    // 别「顺手修正」成 q2 → 框2：那样礼包和七日的同一件道具会长得不一样。
    assert.equal(qualityFrameName(1), 'common_img_pzk_01');
    assert.equal(qualityFrameName(2), 'common_img_pzk_01', 'q1/q2 同档（算法是 quality-1）');
    assert.equal(qualityFrameName(3), 'common_img_pzk_02');
    assert.equal(qualityFrameName(4), 'common_img_pzk_03');
    assert.equal(qualityFrameName(5), 'common_img_pzk_04');
    assert.equal(qualityFrameName(99), 'common_img_pzk_04', '超上限收敛到 4');
    assert.equal(qualityFrameName(0), 'common_img_pzk_01', '下限收敛到 1');
    assert.equal(qualityFrameName(Number.NaN), 'common_img_pzk_01', 'NaN 也收敛到 1，别产出 pzk_0NaN');
});

// ============================================================
// C. prefab 结构 + 几何
// ============================================================

const PREFAB_PATH = 'assets/resources/ui/Gift/Gift.prefab';

/** 编辑器压缩 uuid：前 5 个 hex 原样 + 其余 27 个 hex 每 3 个编 2 个 base64 字符 = 23 位。 */
function compressUuid(uuid: string): string {
    const KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const hex = uuid.replace(/-/g, '');
    let out = hex.slice(0, 5);
    for (let i = 5; i < 32; i += 3) {
        const value = parseInt(hex.slice(i, i + 3), 16);
        out += KEYS[value >> 6] + KEYS[value & 63];
    }
    return out;
}

/** 读一个脚本的 cid（= 编译器 `_RF.push` 用的那个）。 */
function scriptCid(tsPath: string): string {
    const meta = JSON.parse(readFileSync(`${tsPath}.meta`, 'utf8')) as { uuid: string };
    return compressUuid(meta.uuid);
}

const PREFAB = JSON.parse(readFileSync(PREFAB_PATH, 'utf8')) as Array<Record<string, unknown>>;
const PREFAB_NODES = PREFAB.filter((entry) => entry && entry.__type__ === 'cc.Node');

/** 脚本类名 → 源文件。 */
const SCRIPT_FILES: Readonly<Record<string, string>> = {
    GiftPage: 'assets/script/app/gift/GiftPage.ts',
    GiftSpecialView: 'assets/script/app/gift/GiftSpecialView.ts',
    GiftLingYuView: 'assets/script/app/gift/GiftLingYuView.ts',
    GiftShopRow: 'assets/script/app/gift/GiftShopRow.ts',
    GiftRewardSlot: 'assets/script/app/gift/GiftRewardSlot.ts',
    GiftLingYuCard: 'assets/script/app/gift/GiftLingYuCard.ts',
    GiftSubTab: 'assets/script/app/gift/GiftSubTab.ts',
    GiftTabButton: 'assets/script/app/gift/GiftTabButton.ts',
    VScrollView: 'assets/script/vscrollview/VScrollView.ts',
};

test('C1 prefab 存在，根节点是第一个 cc.Node 且 cc.Prefab.data 指向它（排错会让整棵子树消失）', () => {
    assert.ok(existsSync(PREFAB_PATH), `prefab 不存在：${PREFAB_PATH}`);
    const data = (PREFAB[0] as { data: { __id__: number } }).data;
    const firstNodeIndex = PREFAB.findIndex((entry) => entry && entry.__type__ === 'cc.Node');
    assert.equal(data.__id__, firstNodeIndex, 'cc.Prefab.data 必须指向第一个 cc.Node');
    assert.equal(PREFAB_NODES[0]!._name, 'Gift');
    assert.equal(PREFAB_NODES[0]!._parent as unknown, null, '根节点没有父节点');
});

test('C2 ⚠️ 所有节点的 _layer 都是 UI_2D（落在 DEFAULT 会让整棵子树不渲染）', () => {
    const layers = new Set(PREFAB_NODES.map((node) => node._layer));
    assert.deepEqual([...layers], [33554432], `出现非 UI_2D 的 layer：${[...layers].join(', ')}`);
});

test('C3 ⚠️ 每个脚本组件的 __type__ 都能从对应 .ts.meta 的 uuid 反解（防 cid 抄错成 MissingScript）', () => {
    const expected = new Map<string, string>();
    for (const [className, file] of Object.entries(SCRIPT_FILES)) {
        expected.set(scriptCid(file), className);
    }

    const used = new Set(
        PREFAB
            .filter((entry) => entry && typeof entry.__type__ === 'string' && !entry.__type__.startsWith('cc.'))
            .map((entry) => entry.__type__ as string),
    );
    assert.equal(used.size, Object.keys(SCRIPT_FILES).length, `脚本组件种类数不对：用到 ${used.size} 种`);
    for (const cid of used) {
        assert.equal(cid.length, 23, `cid 长度必须是 23 位：${cid}`);
        assert.ok(expected.has(cid), `未知 cid（抄错 / 编辑器没编译）：${cid}`);
    }
    // 每种的实例数也要对：子页签 3 / 奖励格 4 / 灵玉卡 6 / 大页签 2
    const counts = new Map<string, number>();
    for (const entry of PREFAB) {
        const type = entry?.__type__ as string | undefined;
        if (!type || type.startsWith('cc.')) continue;
        counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    assert.equal(counts.get(scriptCid(SCRIPT_FILES.GiftSubTab!)), 3, '子页签 3 个');
    assert.equal(counts.get(scriptCid(SCRIPT_FILES.GiftRewardSlot!)), 4, '每行 4 个奖励格');
    assert.equal(counts.get(scriptCid(SCRIPT_FILES.GiftLingYuCard!)), 6, '灵玉档位卡 6 张');
    assert.equal(counts.get(scriptCid(SCRIPT_FILES.GiftTabButton!)), 2, '底部大页签 2 个');
    assert.equal(counts.get(scriptCid(SCRIPT_FILES.GiftShopRow!)), 1, '商品行模板 1 个（虚拟列表复用）');
    assert.equal(counts.get(scriptCid(SCRIPT_FILES.VScrollView!)), 1, '虚拟列表 1 个');
});

// ---- 几何：反解回画布像素，对 FGUI XML 原值 ----

interface IGeomNode {
    readonly name: string;
    readonly path: string;
    readonly depth: number;
    readonly w: number;
    readonly h: number;
    readonly ax: number;
    readonly ay: number;
    /** 画布坐标（FGUI 口径：原点左上、y 向下）的**锚点**位置。 */
    readonly px: number;
    readonly py: number;
    readonly left: number;
    readonly top: number;
    readonly mask: boolean;
    readonly script: string | null;
}

const GEOM: readonly IGeomNode[] = (() => {
    const at = (ref: unknown): Record<string, unknown> | null => {
        const id = (ref as { __id__?: number } | null)?.__id__;
        return typeof id === 'number' ? (PREFAB[id] as Record<string, unknown>) : null;
    };
    const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

    const nodes: IGeomNode[] = [];
    const walk = (raw: Record<string, unknown>, parent: { x: number; y: number }, depth: number, path: string): void => {
        const comps = ((raw._components ?? []) as unknown[])
            .map((ref) => at(ref))
            .filter((comp): comp is Record<string, unknown> => !!comp);
        const uit = comps.find((comp) => comp.__type__ === 'cc.UITransform');
        const script = comps.find((comp) => !String(comp.__type__).startsWith('cc.'));

        const w = num((uit?._contentSize as { width?: number } | undefined)?.width);
        const h = num((uit?._contentSize as { height?: number } | undefined)?.height);
        const pt = uit?._anchorPoint as { x?: number; y?: number } | undefined;
        // ⚠️ 不能写 `?? 0.5` 之外的 `|| 0.5` —— anchor 合法值 0 会被判 falsy 而回落到 0.5
        const ax = pt ? num(pt.x) : 0.5;
        const ay = pt ? num(pt.y) : 0.5;

        const lpos = raw._lpos as { x?: number; y?: number } | undefined;
        const px = parent.x + num(lpos?.x);
        const py = parent.y - num(lpos?.y); // cocos y 向上 ⇒ FGUI y 向下取反
        // Cocos anchor.y：0=底 / 1=顶；FGUI pivot.y：0=顶 / 1=底（**方向相反**）
        // ⇒ 推左上角要写 `(1 - ay)`。写成 `ay` 时只有 ay=0.5 碰巧对。
        const name = String(raw._name);
        const full = path ? `${path}/${name}` : name;

        nodes.push({
            name, path: full, depth, w, h, ax, ay, px, py,
            left: px - ax * w,
            top: py - (1 - ay) * h,
            mask: comps.some((comp) => comp.__type__ === 'cc.Mask'),
            script: script ? String(script.__type__) : null,
        });

        for (const child of ((raw._children ?? []) as unknown[])) {
            const childNode = at(child);
            if (childNode) walk(childNode, { x: px, y: py }, depth + 1, full);
        }
    };

    const root = at((PREFAB[0] as { data?: unknown }).data);
    assert.ok(root, 'cc.Prefab.data 指向的根节点取不到');
    // 根节点在场景中心 (360, 640)（Canvas 720×1280）
    walk(root!, { x: 360, y: 640 }, 0, '');
    return nodes;
})();

const geom = (suffix: string): IGeomNode => {
    const hit = GEOM.find((node) => node.path.endsWith(suffix));
    assert.ok(hit, `找不到节点：${suffix}`);
    return hit!;
};

/** `[路径后缀, FGUI 元素, 左上角x, 左上角y, 宽, 高]` —— 全是「左上角」语义的元素。 */
const EXPECT_LEFT_TOP: readonly (readonly [string, string, number, number, number, number])[] = [
    ['SpecialPage/PanelBg', 'n43 hdjm1 (64,257) 597×852', 64, 257, 597, 852],
    ['SpecialPage/Deco', 'n44 hdjm9 (33,100) 653×186', 33, 100, 653, 186],
    ['SpecialPage/SubTabBar', 'list_page (126,285) → 宽改 507（偏离②）', 126, 285, 507, 74],
    ['SpecialPage/RowView', 'list_reward (113,398) 503×550', 113, 398, 503, 550],
    ['RowTemplate', 'item 行 (113,398) 503×175', 113, 398, 503, 175],
    ['RowTemplate/Limit', 'lb_xg (346,11) 142×30', 459, 409, 142, 30],
    ['RowTemplate/RewardBar', 'list (20,64) 280×90', 133, 462, 280, 90],
    ['RowTemplate/ActionBtn', 'btn_buy (339,82) 156×60', 452, 480, 156, 60],
    ['RowTemplate/SoldOutIcon', 'n10 (357,65) 110×80', 470, 463, 110, 80],
    ['LingYuPage/CardBar', 'list (23,340) 674×838', 23, 340, 674, 838],
    ['CardBar/Card1', 'item1 col0,row0 = list 左上角', 23, 340, 230, 330],
    ['Card1/Strip', 'n1 (21,24) 189×33（卡内）', 44, 364, 189, 33],
    ['Card1/Square', 'n2 (23,54) 186×186（卡内）', 46, 394, 186, 186],
    ['Card1/DoubleTag', 'n15 (190,3) 40×256（卡内）', 213, 343, 40, 256],
    ['Card1/BuyBtn', 'btn_buy (37,229) 157×48（卡内）', 60, 569, 157, 48],
    ['Gift/BottomBar', 'n25 diban_BG (0,1160) 720×120', 0, 1160, 720, 120],
    ['Gift/BackBtn', '按钮_返回 (0,1149) 123×123', 0, 1149, 123, 123],
    ['Gift/TabBar', '组 n31 (360,1161) 360×111', 360, 1161, 360, 111],
];

/** `[路径后缀, FGUI 元素, 中心x, 中心y, 宽, 高]` —— FGUI 写了 `pivot + anchor="true"` 的。 */
const EXPECT_PIVOT: readonly (readonly [string, string, number, number, number, number])[] = [
    ['RowTemplate/DiscountTag', 'n4 (469,68) pivot ⇒ **xy 是中心**', 113 + 469, 398 + 68, 67, 55],
    ['Card1/Title', 'n6 (115,40) pivot ⇒ **xy 是中心**', 23 + 115, 340 + 40, 100, 33],
    ['Card1/Icon', 'com_goods (55,84) 120×120 中心', 23 + 115, 340 + 144, 104, 104],
];

test('C4 ⚠️ 几何：每个节点反解回画布像素后必须等于 FGUI XML 原值（差分 0.5px）', () => {
    const failures: string[] = [];
    for (const [suffix, label, ex, ey, ew, eh] of EXPECT_LEFT_TOP) {
        const node = geom(suffix);
        if (
            Math.abs(node.left - ex) >= 0.5 || Math.abs(node.top - ey) >= 0.5 ||
            Math.abs(node.w - ew) >= 0.5 || Math.abs(node.h - eh) >= 0.5
        ) {
            failures.push(
                `${label}：实测(${node.left}, ${node.top}) ${node.w}×${node.h}，期望(${ex}, ${ey}) ${ew}×${eh}`,
            );
        }
    }
    assert.deepEqual(failures, [], `节点位置偏离 FGUI 原值：\n${failures.join('\n')}`);
});

test('C5 ⚠️ 几何：`pivot + anchor="true"` 的元素按**中心**比（行里折角标 / 卡上标题最容易差半个宽）', () => {
    const failures: string[] = [];
    for (const [suffix, label, ex, ey, ew, eh] of EXPECT_PIVOT) {
        const node = geom(suffix);
        if (Math.abs(node.px - ex) >= 0.5 || Math.abs(node.py - ey) >= 0.5 || Math.abs(node.w - ew) >= 0.5) {
            failures.push(
                `${label}：实测中心(${node.px}, ${node.py}) ${node.w}×${node.h}，期望中心(${ex}, ${ey}) ${ew}×${eh}`,
            );
        }
    }
    assert.deepEqual(failures, [], `pivot 元素中心偏离 FGUI 原值：\n${failures.join('\n')}`);
});

test('C6 ⚠️ 根节点子序：PageRoot 必须排在 BottomBar / TabBar **之前**（_children 序 = 渲染序）', () => {
    const order = GEOM.filter((node) => node.depth === 1).map((node) => node.name);
    assert.deepEqual(
        order,
        ['PageRoot', 'BottomBar', 'BackBtn', 'TabBar', 'Hint'],
        '页面容器排在底部条之后 ⇒ 列表会被底部条盖住、底部页签也收不到点击',
    );
});

test('C7 虚拟列表三件套：视口 / content 的 anchor 都是 (0.5,1)，视口带 Mask，模板挂 GiftShopRow', () => {
    const view = geom('SpecialPage/RowView');
    const content = geom('RowView/content');
    assert.equal(view.ax, 0.5);
    assert.equal(view.ay, 1, 'VScrollView 硬要求视口 anchor=(0.5,1)');
    assert.equal(content.ax, 0.5);
    assert.equal(content.ay, 1, 'VScrollView 硬要求 content anchor=(0.5,1)');
    assert.ok(view.mask, '视口必须带 cc.Mask，否则列表溢出到页面上');
    assert.equal(view.script, scriptCid(SCRIPT_FILES.VScrollView!));
    assert.ok(geom('RowView/content/RowTemplate').script, '行模板要挂 GiftShopRow');
});

test('C8 ⚠️ 卡片铺法（行优先）与 GiftLingYuView.cards 的取法必须一致', () => {
    const cards = GEOM.filter((node) => /\/Card\d+$/.test(node.path));
    assert.equal(cards.length, 6);
    // `GiftLingYuView.cards` 按 **cocos 的 position.y 降序** 取 ⇒ 对应本表 FGUI 口径（y 向下）
    // 就是 **py 升序**、py 相同再按 px 升序。方向写反会把两行卡片整体对调。
    const sorted = [...cards].sort((a, b) => (a.py - b.py) || (a.px - b.px)).map((node) => node.name);
    assert.deepEqual(sorted, cards.map((node) => node.name), '子节点序 ≠ 行优先取法');

    // 3 列 2 行
    assert.equal(new Set(cards.map((node) => node.py)).size, 2, '两行');
    assert.equal(new Set(cards.map((node) => node.px)).size, 3, '三列');
});

test('C9 子页签 / 大页签落位（子页签等距 174，大页签占三等分槽位前两格）', () => {
    const subTabs = GEOM.filter((node) => /\/SubTab\d+$/.test(node.path)).map((node) => node.left);
    assert.deepEqual(subTabs, [126, 300, 474], '159 宽 + 15 间距 = 174 步长，左边缘 126');

    const tabs = GEOM.filter((node) => /\/Tab\d+$/.test(node.path)).map((node) => node.left);
    assert.deepEqual(
        tabs,
        [360, 480],
        'FGUI 原稿三个页签落在 360/480/600 且组带 relation right-right；只开 2 个时左贴占前两格',
    );
});

// ============================================================
// D. 数据管道接线（源码文本 —— 这些模块依赖 cc / 网络，跑不进 Node）
// ============================================================

function readSource(path: string): string {
    assert.ok(existsSync(path), `源码不存在：${path}`);
    return readFileSync(path, 'utf8');
}

/**
 * 剥掉注释，只留代码。
 *
 * ⚠️ 做「代码里**没有**出现某某标识符」这类断言时必须先剥 —— 否则会被文件头那句
 *    「老端走 `SDKMgr.pay(...)`，Demo3.8 没有」的注释判成违规（本文件就踩过）。
 */
function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const REPO_CODE = stripComments(readSource('assets/script/app/gift/GiftRepository.ts'));
const PAGE_CODE = stripComments(readSource('assets/script/app/gift/GiftPage.ts'));
const REPO_SRC = readSource('assets/script/app/gift/GiftRepository.ts');
const PAGE_SRC = readSource('assets/script/app/gift/GiftPage.ts');
const MSG_SRC = readSource('assets/script/app/gift/RequestGiftMsg.ts');
const ROUTE_SRC = readSource('assets/script/app/main/MainEntranceRoute.ts');
const LIST_SRC = readSource('assets/script/app/main/MainEntranceList.ts');

test('D1 三张表都读了，`item` 表不能漏（漏了奖励格全不出图且不报错）', () => {
    for (const table of ['giftShop', 'payChannel', 'item']) {
        assert.ok(REPO_SRC.includes(`'${table}'`), `GiftRepository 没读表 ${table}`);
    }
});

test('D2 ⚠️ 已购次数走 `CacheMgr.getCmdShop(5)`，**不自己存快照**（CmdShop 在 protoCache 里，服务端会推）', () => {
    assert.ok(REPO_SRC.includes('getCmdShop'), '要通过 CacheMgr 读 CmdShop');
    assert.ok(REPO_SRC.includes('GIFT_SHOP_TYPE'), '商店类型要用常量 5，别写死数字');
    assert.ok(
        !/private\s+\w*[Ss]napshot/.test(REPO_SRC),
        '本 Repository 不该持有快照字段（CmdShop 是服务端推送的，自存会读到过期值）',
    );
    assert.ok(
        !REPO_CODE.includes('CmdShopReqMsg'),
        'Cmd.d.ts 里没有 CmdShopReqMsg —— 不许造一个假的「拉取商店」请求',
    );
});

test('D3 ⚠️ 写请求必须 withTimeout + 离线早退 + catch 返 failed（否则服务端不回就永悬）', () => {
    assert.ok(REPO_SRC.includes('withTimeout'), '必须包 withTimeout');
    assert.ok(REPO_SRC.includes('WRITE_TIMEOUT_MS'), '写超时');
    assert.ok(REPO_SRC.includes('!net.isConnected'), '离线要早退，不能把请求挂出去');
    assert.ok(REPO_SRC.includes('catch'), '必须 catch');
    assert.ok(REPO_SRC.includes("return 'failed'"), '失败要返 failed 而不是抛出去');
    assert.ok(REPO_SRC.includes("return 'offline'"));
    assert.ok(REPO_SRC.includes('GIFT_READ_TIMEOUT_MS'), '读超时要能读出来给测试对账');
});

test('D4 `CmdShopBuy` 请求参数：`cmdShopType` 用常量，次数 1', () => {
    assert.ok(MSG_SRC.includes('CmdShopBuyReqMsg'), '请求 proto 名');
    assert.ok(MSG_SRC.includes('CmdShopBuyRspMsg'), '响应 proto 名（没登记的话发不出去）');
    assert.ok(REPO_SRC.includes('cmdShopType'), '请求体要带 cmdShopType');
    assert.ok(REPO_SRC.includes('buyTimes: 1'), '一次买一份');
});

test('D5 页面 prefab 路径大小写正确（真机区分大小写，写错就是黑屏）', () => {
    assert.ok(
        PAGE_SRC.includes("'ui/Gift/Gift'"),
        'GiftPage.prefabPath 必须是 ui/Gift/Gift（磁盘目录是大写 G）',
    );
});

test('D6 ⚠️ 入口白名单**两处**都要登记（漏一处：入口不弹面板或弹了没内容）', () => {
    assert.ok(ROUTE_SRC.includes('LayerGift'), 'MainEntranceRoute 要认老端 url `LayerGift`');
    assert.ok(ROUTE_SRC.includes("'gift'"), 'EntrancePopupKey 里要有 gift');
    assert.ok(LIST_SRC.includes('GiftPage'), 'MainEntranceList.POPUP_CLASSES 要挂上 GiftPage');
    assert.ok(LIST_SRC.includes('gift:'), 'POPUP_CLASSES 的键必须是 gift');
});

test('D7 ⚠️ 灵玉直冲只提示「支付功能尚未接入」，不静默失败（Demo3.8 没有 SDKMgr）', () => {
    assert.ok(PAGE_SRC.includes('GIFT_TEXTS.payMissing'), '点击要落提示');
    assert.ok(
        !PAGE_CODE.includes('SDKMgr'),
        'Demo3.8 没有支付 SDK —— 注释里说明可以，但代码里不许出现 SDKMgr',
    );
});

// ============================================================
// E. 文案表
// ============================================================

test('E1 文案表键齐全（页面只从这里取字，别处不许造字符串）', () => {
    const keys = [
        'title', 'tabSpecial', 'tabLingYu', 'tabJingShi', 'free', 'buy', 'soldOut',
        'empty', 'loading', 'offline', 'failed', 'buyOk', 'limitSale', 'discount',
        'firstBuyDouble', 'currency', 'payMissing',
    ] as const;
    for (const key of keys) {
        assert.equal(typeof GIFT_TEXTS[key], 'string', `缺文案键：${key}`);
        assert.ok(GIFT_TEXTS[key].length > 0, `文案键 ${key} 是空串`);
    }
    assert.equal(GIFT_TEXTS.currency, '幻灵玉', 'coin 的图标是幻灵玉，不是元宝');
});

test('E2 `formatText`：占位符替换、缺参原样保留', () => {
    assert.equal(formatText(GIFT_TEXTS.limitSale, 3, 5), '限购 3/5');
    assert.equal(formatText(GIFT_TEXTS.discount, 5), '5折');
    assert.equal(formatText('{0}/{1}', 1), '1/{1}', '缺的参数原样留着，别渲染成 undefined');
    assert.equal(formatText('没有占位符'), '没有占位符');
});

test('E3 数值口径常量（与 `roleProperty` 对齐）', () => {
    assert.equal(GIFT_CURRENCY_RES_ID, 10, 'priceType=10 = roleProperty.coin');
    assert.equal(GIFT_TEXTS.currency, '幻灵玉');
});
