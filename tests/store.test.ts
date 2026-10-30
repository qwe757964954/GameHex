/**
 * 「商城 · `组件_商店_界面`」的回归网（外壳 `Store` + 5 个分段 prefab）。
 *
 * 分四段，各守一件事：
 *
 *   A. **版面表**（`StoreTable`）—— 5 段的顺序 / 键 / prefab 名 / 标题、段高、`content` 总高、
 *      段顶 y、三列网格参数、资源条键。这一层是**引擎无关**的纯表，可穷举。
 *   B. **内容表**（`StoreShopTable`）—— 逐格文案与格子数（截图逐字）。它同时是
 *      「prefab 里该有几张卡」的唯一真源。
 *   C. **6 张 prefab 结构 + 几何** —— 脚本 cid 必须能从 `.ts.meta` 反解（防抄错成 `MissingScript`）；
 *      所有节点 `_layer` 必须 UI_2D（落 DEFAULT 整棵子树不渲染且不报错）；
 *      几何必须与 FGUI 各 XML 反解出的**画布像素**一致（含缩放节点与嵌套 prefab 段）。
 *   D. **接线**（源码文本 + prefab 引用）—— `MainTabHost.shopPage` 真的绑到了 `Store.prefab` 的
 *      uuid、`MainTab.Shop` 真的路由到它、`StorePage.prefabPath` 与磁盘大小写一致。
 *
 * 口径真源：
 *   - 设计：`zarts/art/UIProject/trunk/UIProject/assets/主界面_商店/**`
 *     （`组件/组件_商店_界面.xml` + `通用/组件_商店_背景.xml` + 5 个 `页面/组件_商店_*页面.xml`
 *      + 5 个 `..._item.xml` + `公用0/**` 的公共组件）
 *   - 老端：`client/assets/script/app/game/ctrl/main/store/TabStoreMain.ts`
 *   - 本项目：`assets/script/app/store/**`、assetPath(`ui/Store/**`)
 *   - 生成器：`tmp/_store2_build.mjs`（本文件 C 段的期望值就是它的输入口径）
 *
 * ⚠️ 三条**刻意**的选择，本文件当契约钉住：
 *   ① **一条长滚动，没有页签** —— 真源 `组件_商店_界面` 就是一个 `list` + 5 个 item；
 *      之前那套「4 页签 + 4 子页」已整体回退（备份在 `tmp/backup_store_p3/`）。
 *   ② 5 段不做虚拟化（老端 `initVirtualList` 是懒加载）—— 总量 270 节点，**有意降级**。
 *   ③ 资源条是商城页**自己补的一条**（FGUI 真源里没有；截图顶部那两枚药丸来自主界面 HUD），
 *      但数据 / 图标**复用**主界面那一套（`buildResBarView` + `loadResBarSprite`），不自造口径。
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import {
    STORE_ART_ARROW,
    STORE_ART_BG,
    STORE_ART_BTN_GOLD,
    STORE_ART_BTN_GREEN,
    STORE_ART_BTN_GREY,
    STORE_ART_CARD,
    STORE_ART_CHEST_HIGH,
    STORE_ART_CHEST_LOW,
    STORE_ART_DOT_OFF,
    STORE_ART_DOT_ON,
    STORE_ART_GIFT_CARD,
    STORE_ART_HELP,
    STORE_ART_ICON_VIDEO,
    STORE_ART_ICON_VIDEO_NEW,
    STORE_ART_ITEM_FRAME,
    STORE_ART_NPC,
    STORE_ART_PANEL,
    STORE_ART_PILL,
    STORE_ART_REBATE,
    STORE_ART_ROOT,
    STORE_ART_SLICED,
    STORE_ART_TAG,
    STORE_ART_TITLE,
    STORE_CARD_H,
    STORE_CONTENT_H,
    STORE_GRID_COL_X,
    STORE_GRID_LINE_GAP,
    STORE_GRID_ROWS,
    STORE_SECTION_GAP,
    STORE_SECTION_H,
    STORE_SECTION_LIST_TOP,
    STORE_SECTIONS,
    storeSectionTop,
} from '../assets/script/app/store/StoreTable';
import type { StoreSectionKey } from '../assets/script/app/store/StoreTable';
import {
    STORE_CHEST_ROWS,
    STORE_GIFT_ROW,
    STORE_GOLD_ROWS,
    STORE_GOODS_ROWS,
    STORE_QUALITY_FRAMES,
    STORE_SILVER_ROWS,
    storeCardCount,
    storeQualityFrame,
} from '../assets/script/app/store/StoreShopTable';
import { assetExists, assetPath } from './helpers/asset-paths';

/** 段内反复出现的几个图标路径（写死在这里 = 一旦表改成别的图，B 段会立刻红）。 */
const ICON_RES_FANTASY_JADE = 'icons/resource/图标_幻灵玉';
const ICON_COPPER = 'icons/resource/图标_铜币';
const ICON_KEY = 'icons/item/图标_金钥匙';

// 宝箱两档的钥匙**逐档不同**（真源 `item.json`：10991 银 / 10992 金，
// 与 `gemBox[0/1].priceType` 一一对应）。这四条断言就是防「又退回一张通用钥匙图」。
assert.equal(STORE_CHEST_ROWS[0].keyResId, 10991, '1 档钥匙应是 10991（gemBox[0].priceType）');
assert.equal(STORE_CHEST_ROWS[1].keyResId, 10992, '2 档钥匙应是 10992（gemBox[1].priceType）');
assert.equal(STORE_CHEST_ROWS[0].keyIcon, 'icons/item/图标_银钥匙', '1 档应显示银钥匙');
assert.equal(STORE_CHEST_ROWS[1].keyIcon, ICON_KEY, '2 档应显示金钥匙');
assert.notEqual(STORE_CHEST_ROWS[0].keyIcon, STORE_CHEST_ROWS[1].keyIcon, '两档钥匙图标不能相同');

// ============================================================
// A. 版面表（StoreTable）
// ============================================================

const KEYS: readonly StoreSectionKey[] = ['gem', 'gift', 'gold', 'silver', 'goods'];
/** 三列网格段（`gem` / `gift` 不在此列 —— 一个走整宽大卡、一个走横向翻页）。 */
const GRID_KEYS = ['gold', 'silver', 'goods'] as const;

test('A1 5 段顺序 = FGUI 外层 list 的 item 顺序（键 / prefab 名 / 标题逐位）', () => {
    assert.deepEqual(STORE_SECTIONS.map((s) => s.key), [...KEYS]);
    assert.deepEqual(STORE_SECTIONS.map((s) => s.prefab), [
        'StoreGemBox', 'StoreLevelGift', 'StoreGold', 'StoreSilver', 'StoreGoods',
    ]);
    assert.deepEqual(STORE_SECTIONS.map((s) => s.title), [
        '宝石宝箱', '50关卡礼包', '金币', '银币', '黑市宝箱',
    ]);
});

test('A2 段高按「list 顶边 + 真实行数」长出来，不抄设计稿的 377 / 369 / 378', () => {
    // 设计稿那三个数是**占位 item 的高度**；真源每个页面都带
    // `<relation target="n58_h2ls" sidePair="bottomext-bottom"/>` ⇒ 下边界跟着 list 内容走。
    assert.deepEqual({ ...STORE_SECTION_H }, { gem: 842, gift: 365, gold: 662, silver: 641, goods: 936 });
    for (const key of GRID_KEYS) {
        const rows = STORE_GRID_ROWS[key]!;
        const expect = STORE_SECTION_LIST_TOP[key] + rows * STORE_CARD_H + (rows - 1) * STORE_GRID_LINE_GAP[key]!;
        assert.equal(STORE_SECTION_H[key], expect, `${key} 段高`);
    }
    // `gem` = 89 + 377 + 376（两张宝箱卡整宽铺满）；`gift` = 横向翻页，高度固定
    assert.equal(STORE_SECTION_LIST_TOP.gem + 377 + 376, STORE_SECTION_H.gem);
});

test('A3 content 总高 = Σ 段高 + 4 条段间距', () => {
    assert.equal(STORE_CONTENT_H, 3486);
    assert.equal(
        STORE_CONTENT_H,
        KEYS.reduce((sum, k) => sum + STORE_SECTION_H[k], 0) + STORE_SECTION_GAP * (KEYS.length - 1),
    );
});

test('A4 storeSectionTop 单调递减、步长 = 段高 + 段间距（外壳摆 Sec0..4 用的就是它）', () => {
    let expect = 0;
    for (const key of KEYS) {
        assert.equal(storeSectionTop(key), expect, `${key} 的段顶 y`);
        expect -= STORE_SECTION_H[key] + STORE_SECTION_GAP;
    }
    assert.equal(storeSectionTop('gem'), 0);
    assert.equal(storeSectionTop('gift'), -(842 + 10));
    // 最后一段的底边必须正好等于 content 高（否则滚动区要么留白要么截断）
    const last = KEYS[KEYS.length - 1]!;
    assert.equal(-storeSectionTop(last) + STORE_SECTION_H[last], STORE_CONTENT_H);
});

test('A5 三列网格：卡高 276、列心 −215 / 0 / +215（列距 = 卡宽 200 + colGap 15）', () => {
    assert.equal(STORE_CARD_H, 276);
    assert.deepEqual([...STORE_GRID_COL_X], [-215, 0, 215]);
    assert.equal(STORE_GRID_COL_X[1]! - STORE_GRID_COL_X[0]!, 215);
    assert.equal(STORE_GRID_COL_X[2]! - STORE_GRID_COL_X[1]!, 215);
    for (const key of GRID_KEYS) {
        const section = STORE_SECTIONS.find((s) => s.key === key)!;
        assert.equal(section.rows, STORE_GRID_ROWS[key], `${key} rows`);
        assert.equal(section.lineGap, STORE_GRID_LINE_GAP[key], `${key} lineGap`);
        // 格子数必须**填满** rows 行、且放得下
        assert.ok(section.rows * 3 >= section.cards, `${key} 的 ${section.cards} 张放不进 ${section.rows} 行`);
        assert.ok(section.cards > (section.rows - 1) * 3, `${key} 的行数多算了一行`);
    }
    // `gem`（整宽大卡）/ `gift`（横向翻页）不走网格
    for (const key of ['gem', 'gift'] as const) {
        const section = STORE_SECTIONS.find((s) => s.key === key)!;
        assert.equal(section.rows, 0, `${key} 不该有 rows`);
        assert.equal(section.lineGap, 0, `${key} 不该有 lineGap`);
    }
});

test('A6 美术口径：目录名 / 9 张九宫格 / 关键图名（改名会让 SLICED 判定失效）', () => {
    assert.equal(STORE_ART_ROOT, 'image/store');
    assert.equal(STORE_ART_SLICED.size, 9);
    for (const art of [
        STORE_ART_PANEL, STORE_ART_TITLE, STORE_ART_CHEST_LOW, STORE_ART_CHEST_HIGH,
        STORE_ART_CARD, STORE_ART_BTN_GOLD, STORE_ART_BTN_GREY, STORE_ART_PILL, STORE_ART_ITEM_FRAME,
    ]) {
        assert.ok(STORE_ART_SLICED.has(art), `${art} 应为九宫格`);
    }
    // 这几个**不是**九宫格（`TY_btn22` 在 FGUI 里没有 scale9grid；角标 / 箭头 / 页码点都是整图）
    for (const art of [STORE_ART_BTN_GREEN, STORE_ART_TAG, STORE_ART_ARROW, STORE_ART_DOT_ON, STORE_ART_DOT_OFF]) {
        assert.ok(!STORE_ART_SLICED.has(art), `${art} 不该是九宫格`);
    }
    assert.equal(STORE_ART_BG, 'sd_fg_01_3gong');
    assert.equal(STORE_ART_NPC, 'shoping_bg04');
    assert.equal(STORE_ART_GIFT_CARD, 'gklb');
    assert.equal(STORE_ART_REBATE, 'newsd3');
    assert.equal(STORE_ART_HELP, 'zx_btn01');
    assert.equal(STORE_ART_ICON_VIDEO_NEW, 'img_video_new');
    assert.equal(STORE_ART_ICON_VIDEO, 'img_video');
});

test('A7 资源条不再有代码常量 —— 两格配置落在 prefab（见 C1b）', () => {
    // 2026-09-29：`STORE_RES_KEYS` 已删（配置只留 prefab 一处真源）。
    // 这里保留一条**反向**断言，防有人为了「测试方便」把常量加回来。
    const tableSrc = readFileSync('assets/script/app/store/StoreTable.ts', 'utf8');
    assert.ok(
        !/export\s+const\s+STORE_RES_KEYS/.test(tableSrc),
        'STORE_RES_KEYS 不该回来：两格配置的真源是 Store.prefab 的 ResBar.resKeys',
    );
});

// ============================================================
// B. 内容表（StoreShopTable）
// ============================================================

test('B1 每段卡片数 = 内容表长度（prefab 里建几张卡就是这么定的）', () => {
    for (const section of STORE_SECTIONS) {
        assert.equal(storeCardCount(section.key), section.cards, `${section.key} 卡片数`);
    }
    assert.equal(storeCardCount('nope'), 0);
});

test('B2 宝箱段两张卡：低级蓝 / 高级金，文案与消耗齐备', () => {
    assert.equal(STORE_CHEST_ROWS.length, 2);
    const [low, high] = STORE_CHEST_ROWS as [(typeof STORE_CHEST_ROWS)[number], (typeof STORE_CHEST_ROWS)[number]];
    assert.equal(low.quality, 'low');
    assert.equal(low.art, STORE_ART_CHEST_LOW);
    assert.equal(low.buttonArt, STORE_ART_BTN_GREEN);
    assert.deepEqual([...low.buttonColor], [0x86, 0xca, 0xf8]);
    assert.equal(high.quality, 'high');
    assert.equal(high.art, STORE_ART_CHEST_HIGH);
    assert.equal(high.buttonArt, STORE_ART_BTN_GOLD);
    assert.deepEqual([...high.buttonColor], [0xff, 0x9a, 0x22]);
    for (const row of STORE_CHEST_ROWS) {
        assert.match(row.title, /^剩余\d+次必得 .+宝石$/);
        assert.ok(row.own.length > 0 && row.cost1.length > 0 && row.cost10.length > 0);
    }
});

test('B3 关卡礼包段：id=18 / 550% 返利 / 限购 1/1 / 5 页 / 3 个奖励槽', () => {
    assert.equal(STORE_GIFT_ROW.title, STORE_SECTIONS.find((s) => s.key === 'gift')!.title, '段标题与内容表要一致');
    assert.equal(STORE_GIFT_ROW.title, '50关卡礼包');
    assert.equal(STORE_GIFT_ROW.level, 50);
    assert.equal(STORE_GIFT_ROW.rebate, '550%');
    assert.equal(STORE_GIFT_ROW.buyCount, '限购:1/1');
    assert.equal(STORE_GIFT_ROW.price, '1280');
    assert.equal(STORE_GIFT_ROW.priceIcon, ICON_RES_FANTASY_JADE, '关卡礼包价签左边是元宝');
    assert.equal(STORE_GIFT_ROW.pages, 5);
    assert.equal(STORE_GIFT_ROW.page, 0);
    // `guankaGift.json` id=18 的 rewards = [{10,10992},{200,10011},{25000,7}]
    assert.equal(STORE_GIFT_ROW.rewards.length, 3);
    assert.deepEqual(
        STORE_GIFT_ROW.rewards.map((r) => [r.iconPath, r.quality]),
        [[ICON_KEY, 5], ['icons/item/图标_图纸_问号', 3], [ICON_COPPER, 4]],
    );
});

test('B4 金币段（元宝铺）6 档：金币数递增 / N元 / 图标是幻灵丹而非旧的聚宝盆', () => {
    assert.equal(STORE_GOLD_ROWS.length, 6);
    assert.deepEqual(STORE_GOLD_ROWS.map((r) => r.coin), [60, 300, 680, 1280, 3280, 6480]);
    assert.deepEqual(STORE_GOLD_ROWS.map((r) => r.rmb), [6, 30, 68, 128, 328, 648]);
    STORE_GOLD_ROWS.forEach((row, i) => {
        // `payChannel.json` type=1 && isShow=1 的前 6 条：id 1..6
        assert.equal(row.id, i + 1);
        // 卡面主图 = `payChannel.path`（裸 key `图标_幻灵丹_0N` → `icons/common/`）
        assert.equal(row.iconPath, `icons/common/图标_幻灵丹_0${i + 1}`);
        // 首充额外条右侧的元宝图标
        assert.equal(row.extraIcon, ICON_RES_FANTASY_JADE);
        assert.ok(row.name.length > 0, `${row.id} 缺名字`);
    });
    // ⚠️ 回归钉子：**不许**再出现旧组件（`组件_商店_金币页面item`）的聚宝盆图
    const stale = ['商店_金币001', '商店_金币002', '商店_金币003'];
    for (const row of STORE_GOLD_ROWS) {
        for (const s of stale) assert.ok(!row.iconPath.includes(s), `金币段又用回旧资源 ${s}`);
    }
});

test('B5 银币段（铜钱铺）4 档：只有第一格是看视频免费，后两格带折扣角标且都有铜钱图', () => {
    assert.equal(STORE_SILVER_ROWS.length, 4);
    assert.deepEqual(STORE_SILVER_ROWS.map((r) => r.name), ['银币x520', '银币x300', '银币x1000', '银币x5000']);
    assert.equal(STORE_SILVER_ROWS.filter((r) => r.video).length, 1);
    assert.equal(STORE_SILVER_ROWS[0]!.video, true);
    assert.equal(STORE_SILVER_ROWS[0]!.price, '免费');
    assert.deepEqual(STORE_SILVER_ROWS.map((r) => r.sale), [null, null, '9折', '8折']);
    // ⚠️ 回归钉子：4 格**都必须有**卡面图（旧版这里是空 `cc.Sprite` ⇒ 用户报的「银币没图片」）
    assert.deepEqual(STORE_SILVER_ROWS.map((r) => r.iconPath), [
        'icons/resource/图标_货币_几个铜钱',
        'icons/resource/图标_货币_几个铜钱',
        'icons/resource/图标_货币_少量铜钱',
        'icons/resource/图标_货币_大量铜钱',
    ]);
});

test('B6 黑市宝箱段 7 格：图标 / 品质 / 件数齐备，价格以配置表 cost 为准', () => {
    assert.equal(STORE_GOODS_ROWS.length, 7);
    assert.deepEqual(STORE_GOODS_ROWS.map((r) => r.name), [
        '随机装备图纸', '随机兵种卷轴', '天赋石', '城墙升级石', '城墙突破石', '啤酒', '禁军升级卷轴',
    ]);
    for (const row of STORE_GOODS_ROWS) {
        assert.ok(row.bought <= row.limit, `${row.name} 已买超过上限`);
        assert.ok(row.limit > 0, `${row.name} 上限必须为正`);
        assert.match(row.price, /^\d+$/);
        // ⚠️ 回归钉子：7 格的图标与品质框都不能缺（旧版是空 `cc.Sprite` + `icon_fg_selected` 描边）
        assert.match(row.iconPath, /^icons\//, `${row.name} 图标路径`);
        assert.ok(row.quality >= 1 && row.quality <= 4, `${row.name} 品质 ${row.quality} 超出 1..4`);
        assert.ok(Number(row.number) > 0, `${row.name} 件数`);
    }
    // `resourceShop.json` 的 cost 是 100/100/10/100/30/30/10
    assert.deepEqual(STORE_GOODS_ROWS.map((r) => r.price), ['100', '100', '10', '100', '30', '30', '10']);
    const talent = STORE_GOODS_ROWS.find((r) => r.name === '天赋石')!;
    assert.equal(talent.limit, 2);
    assert.deepEqual([talent.bought, talent.limit], [0, 2]);
});

test('B7 品质框映射：1..4 全有、越界夹到两端（`100×100` 物品框专用）', () => {
    assert.deepEqual({ ...STORE_QUALITY_FRAMES }, {
        1: 'image/frame/common_img_pzk_01',
        2: 'image/frame/common_img_pzk_02',
        3: 'image/frame/common_img_pzk_03',
        4: 'image/frame/common_img_pzk_04',
    });
    assert.equal(storeQualityFrame(0), STORE_QUALITY_FRAMES[1]);
    assert.equal(storeQualityFrame(2), STORE_QUALITY_FRAMES[2]);
    assert.equal(storeQualityFrame(9), STORE_QUALITY_FRAMES[4]);
});

test('B8 段内图标**都真的在磁盘上**且 meta 是 sprite-frame（悬空引用会让运行期变品红块）', () => {
    const res = 'assets/resources';
    const paths = new Set<string>([
        // 宝箱两档的钥匙**逐档不同**（银 / 金），两张都要在磁盘上。
        ...STORE_CHEST_ROWS.map((r) => r.keyIcon),
        STORE_GIFT_ROW.priceIcon,
        ...STORE_GIFT_ROW.rewards.map((r) => r.iconPath),
        ...STORE_GOLD_ROWS.flatMap((r) => [r.iconPath, r.extraIcon]),
        ...STORE_SILVER_ROWS.map((r) => r.iconPath),
        ...STORE_GOODS_ROWS.map((r) => r.iconPath),
        ...Object.values(STORE_QUALITY_FRAMES),
    ]);
    for (const rel of paths) {
        const png = `${res}/${rel}.png`;
        assert.ok(existsSync(png), `缺图：${png}`);
        const meta = JSON.parse(readFileSync(`${png}.meta`, 'utf8')) as {
            userData?: { type?: string }; subMetas?: Record<string, unknown>;
        };
        assert.equal(meta.userData?.type, 'sprite-frame', `${rel} 的 meta 不是 sprite-frame（跑 tmp/_store_fix_icon_meta.mjs --apply）`);
        assert.ok(meta.subMetas?.f9941, `${rel} 缺 @f9941 子资源`);
    }
});

// ============================================================
// C. 6 张 prefab 结构 + 几何
// ============================================================

const PREFAB_DIR = assetPath('ui/Store');
const SHELL_TS = 'assets/script/app/store/StorePage.ts';
const SECTION_TS = 'assets/script/app/store/StoreSectionPage.ts';
/** 顶部资源条走**公共货币件**：`app/common/ResBar` + 它的槽组件 `MainResBarSlot`。
 *  ⚠️ 2026-09-29（第二轮修正）：`Store/ResBar` 不是「内联抄一份 + 挂脚本」，而是
 *    `common/ResBar.prefab` 的**嵌套 prefab 实例**（与主界面 HUD、天赋页同一份）。
 *    ⇒ 内部节点（`Res0/1/2`、`Bg/Icon/Value/Plus`）**不落 Store.prefab**，
 *      `RESBAR_TS` / `RESBAR_SLOT_TS` 的 cid 也不该在 Store.prefab 里出现（出现 = 又变回内联）。 */
const RESBAR_TS = 'assets/script/app/common/ResBar.ts';
const RESBAR_SLOT_TS = 'assets/script/app/main/MainResBarSlot.ts';
const RESBAR_PREFAB = assetPath('ui/common/ResBar.prefab');
const UI_2D = 33554432;
const KEYS_B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** 嵌套实例「壳节点」在 prefab JSON 里没有 `_name` ⇒ 解析不出来时用这个占位。 */
const INSTANCE_SHELL = '(嵌套实例)';

/** `.ts.meta` 的 uuid → prefab 里的**压缩 cid**（36 位去 dash → 32 hex，留前 5 个 hex，其余每 3 hex → 2 base64）。 */
function cidOf(metaPath: string): string {
    const uuid = (JSON.parse(readFileSync(metaPath, 'utf8')) as { uuid: string }).uuid;
    const hex = uuid.replace(/-/g, '');
    let cid = hex.slice(0, 5);
    for (let i = 5; i < 32; i += 3) {
        const v = parseInt(hex.slice(i, i + 3), 16);
        cid += KEYS_B64[v >> 6]! + KEYS_B64[v & 63]!;
    }
    return cid;
}

type Entry = Record<string, unknown>;
interface Rect { readonly left: number; readonly top: number; readonly w: number; readonly h: number }

/**
 * 嵌套 prefab 实例的「壳节点」。
 *
 * ⚠️ 它在父 prefab 的 JSON 里是个**占位根** —— 只有 `_parent` + `_prefab`，
 * **没有** `_name` / `_lpos` / `_components` / `_children`；真正的值在
 * `cc.PrefabInfo.instance` → `cc.PrefabInstance.propertyOverrides` 的
 * `CCPropertyOverrideInfo { propertyPath, value }` 里。
 * （`tmp/_store_pages_probe.mjs` 文件头的「陷阱 1」记的就是这条。）
 *
 * ⇒ 想断言嵌套实例的位置 / 名字，**只能读覆盖项**；想读它的尺寸，只能去**源 prefab 的根**量
 *   （实测：`_name` / `_lpos` / `_lrot` / `_euler` 会落成覆盖项，**UITransform 的尺寸不会**）。
 */
interface InstanceShell {
    /** 嵌套的源 prefab 的 uuid。 */
    readonly uuid: string | null;
    /** `propertyPath.join('.')` → 覆盖值。 */
    readonly overrides: Readonly<Record<string, unknown>>;
}

/**
 * 读一张 prefab 并反解每个节点的「视觉框」。
 *
 * `originX / originY` = **根节点锚点**所在的那个点在「FGUI 像素」里的坐标：
 *   - 外壳 `Store`：根挂 Canvas 中心、锚点 `(0.5,0.5)` ⇒ `(360, 640)`，算出来就是**画布像素**；
 *   - 分段 `StoreXxx`：根锚点 `(0.5,1)`（顶中点）⇒ `(666/2, 0)`，算出来就是**段内 FGUI 像素**
 *     （与各 item XML 的 `xy` 同尺）。
 *
 * ⚠️ 三个坑：
 *   ① 子节点位移要**乘父链缩放**（`pos.x * parentScale`）；
 *   ② 本工程节点一律锚点 `(0.5,1)` ⇒ 盒左 = `锚点x − w/2`、盒顶 = `锚点y`；盒宽高乘缩放
 *      （缩放绕锚点 ⇒ 顶边不动，与 FGUI「绕左上角」等价）；
 *   ③ 嵌套实例的壳节点**没有** `_components` ⇒ 走覆盖项取 `_lpos` / `_name`，几何登记为 0×0。
 */
function analyze(rel: string, originX: number, originY: number) {
    const disk = `${PREFAB_DIR}/${rel}.prefab`;
    assert.ok(existsSync(disk), `prefab 不存在：${disk}`);
    assert.ok(existsSync(`${disk}.meta`), `缺 ${rel}.prefab.meta`);
    const entries = JSON.parse(readFileSync(disk, 'utf8')) as Entry[];
    const at = (ref: unknown): Entry | null =>
        (ref && typeof ref === 'object' && '__id__' in (ref as Entry))
            ? entries[(ref as { __id__: number }).__id__]!
            : null;

    const shellOf = (node: Entry): InstanceShell | null => {
        const prefabInfo = node._prefab ? at(node._prefab) : null;
        if (!prefabInfo) return null;
        const instance = prefabInfo.instance ? at(prefabInfo.instance) : null;
        const overrides: Record<string, unknown> = {};
        for (const ref of ((instance?.propertyOverrides ?? []) as unknown[])) {
            const entry = at(ref) as { propertyPath?: string[]; value?: unknown } | null;
            const path = entry?.propertyPath?.join('.');
            if (path) overrides[path] = entry!.value;
        }
        return { uuid: ((prefabInfo.asset as { __uuid__?: string } | undefined)?.__uuid__) ?? null, overrides };
    };

    const nodes = entries.filter((e) => e && e.__type__ === 'cc.Node');
    const root = nodes[0]!;
    const rects = new Map<string, Rect>();
    const shells = new Map<string, InstanceShell>();
    /** 节点对象 → 有效名字（壳节点的名字只在覆盖项里）。 */
    const names = new Map<Entry, string>();
    /** 路径 → 组件类型名列表（不含 `cc.UITransform`）。用来守「哪个节点上真的有 `cc.Button`」。 */
    const compsAt = new Map<string, string[]>();

    /**
     * 递归一遍，把每个节点登记成 `名字 → 视觉框`。
     *
     * ⚠️ **路径必须在 `walk` 内部拼**（`parentPath + '/' + 自己的名字`），不能由父节点
     *    `names.get(child)` 去拼 —— 父节点遍历到子节点时，子节点还没进 `walk`、
     *    `names` 里还是 `undefined`，整条路径会退化成 `/(嵌套实例)/(嵌套实例)/…`
     *    （实测：`StoreGemBox/List` 都找不着，一路报「找不到节点路径」）。
     */
    const walk = (node: Entry, parentPath: string, pCx: number, pCy: number, pSx: number, pSy: number): void => {
        const shell = shellOf(node);
        const name = (node._name as string) ?? (shell?.overrides._name as string) ?? INSTANCE_SHELL;
        names.set(node, name);
        const path = parentPath ? `${parentPath}/${name}` : name;
        if (shell) shells.set(path, shell);
        const pos = (node._lpos ?? shell?.overrides._lpos ?? { x: 0, y: 0 }) as { x: number; y: number };
        const cx = pCx + pos.x * pSx;
        const cy = pCy - pos.y * pSy;
        if (!node._components) {
            // 占位实例根：几何未知（尺寸在源 prefab 里）⇒ 只记「锚点落点」
            rects.set(path, { left: cx, top: cy, w: 0, h: 0 });
            return;
        }
        const scale = (node._lscale ?? { x: 1, y: 1 }) as { x: number; y: number };
        const comps = ((node._components ?? []) as unknown[]).map(at);
        compsAt.set(path, comps.map((c) => String(c?.__type__ ?? '?')).filter((t) => t !== 'cc.UITransform'));
        const uit = comps.find((c) => c?.__type__ === 'cc.UITransform');
        const size = (uit?._contentSize ?? { width: 0, height: 0 }) as { width: number; height: number };
        const anchor = (uit?._anchorPoint ?? { x: 0.5, y: 0.5 }) as { x: number; y: number };
        const sx = pSx * (scale.x ?? 1);
        const sy = pSy * (scale.y ?? 1);
        // 盒子的两条边（**相对锚点**、已乘缩放）：`−anchor·size·s` 与 `(1−anchor)·size·s`。
        // ⚠️ 不能写成「轴心 − anchor.x·w·sx」——**负缩放（镜像）会把两端点对调**，
        //    直接乘会得到负的宽高。镜像的视觉盒与不镜像**是同一个矩形**
        //    （例 `按钮_右` 52×63 `scale(−1,1)` ⇒ 盒左 = 轴心 − 26、宽 52）
        //    ⇒ 取两端点的 min/max，才与 FGUI「绕左上角缩放」等价。
        const xa = -anchor.x * size.width * sx;
        const xb = (1 - anchor.x) * size.width * sx;
        const ya = -anchor.y * size.height * sy;
        const yb = (1 - anchor.y) * size.height * sy;
        rects.set(path, {
            left: cx + Math.min(xa, xb),
            top: cy - Math.max(ya, yb),
            w: Math.abs(xb - xa),
            h: Math.abs(yb - ya),
        });
        for (const child of ((node._children ?? []) as unknown[])) {
            const c = at(child);
            if (!c) continue;
            walk(c, path, cx, cy, sx, sy);
        }
    };
    walk(root, '', originX, originY, 1, 1);
    const rootName = names.get(root) ?? rel;
    return { disk, entries, nodes, realNodes: nodes.filter((n) => n._components), root, rootName, rects, shells, names, compsAt, at };
}

const shell = analyze('Store', 360, 640);
const sections = Object.fromEntries(STORE_SECTIONS.map((s) => [s.key, analyze(s.prefab, 666 / 2, 0)])) as
    Record<StoreSectionKey, ReturnType<typeof analyze>>;

/** 近似相等（0.01px 容差：`x + w/2 − parentW/2` 会产生 .5 之类的小数）。 */
function near(actual: number, expect: number): boolean {
    return Math.abs(actual - expect) < 0.01;
}

/** 钉一个节点的视觉框。 */
function expectRect(bundle: ReturnType<typeof analyze>, path: string, left: number, top: number, w: number, h: number, label = ''): void {
    const rect = bundle.rects.get(path);
    assert.ok(rect, `找不到节点路径「${path}」${label}`);
    assert.ok(
        near(rect.left, left) && near(rect.top, top) && near(rect.w, w) && near(rect.h, h),
        `${label}${path} 期望 (${left},${top},${w}×${h})，实得 (${rect.left},${rect.top},${rect.w}×${rect.h})`,
    );
}

/** 所有**真实节点**必须 UI_2D（落 DEFAULT 会整棵子树不渲染且不报错；嵌套实例壳节点 `_layer` 不落盘）。 */
function expectAllUi2D(bundle: ReturnType<typeof analyze>, label: string): void {
    assert.ok(bundle.realNodes.length > 0, `${label} 一个真实节点都没有`);
    const layers = [...new Set(bundle.realNodes.map((n) => n._layer))];
    assert.deepEqual(layers, [UI_2D], `${label} 出现非 UI_2D 的 layer：${layers.join(', ')}`);
}

/**
 * 守「某个节点上到底挂了哪些**非 UITransform** 组件」。
 *
 * 为什么值得单独一条：整卡可点（老端 `initVirtualList` 的第三参）是**组件级**的事实，
 * `expectRect` 只看几何 ⇒ 把卡上的 `cc.Button` 删掉，几何全对、测试全绿，
 * 但「点卡片任意位置有反应」会静默失效 —— 这类「静默退出」正是本工程踩过最多的坑。
 */
function expectComps(bundle: ReturnType<typeof analyze>, path: string, wanted: string[], label = ''): void {
    const got = bundle.compsAt.get(path);
    assert.ok(got, `找不到节点路径「${path}」${label}`);
    assert.deepEqual([...got].sort(), [...wanted].sort(), `${label}${path} 组件期望 [${wanted.join(', ')}]，实得 [${got.join(', ')}]`);
}

/** 顶层渲染序（= FGUI `displayList` 序；顶层的「全面屏适配」helper 不落节点）。 */
function topOrder(bundle: ReturnType<typeof analyze>): string[] {
    return ((bundle.root._children ?? []) as unknown[]).map((c) => bundle.names.get(bundle.at(c)!)!);
}

/** 根上必须挂主脚本、且挂在根节点上；prefab 里出现的每个非 `cc.*` cid 都必须能反解。 */
function expectRootScript(bundle: ReturnType<typeof analyze>, tsPath: string, label: string): void {
    const cid = cidOf(`${tsPath}.meta`);
    assert.equal(cid.length, 23, 'cid 应为 23 字符');
    const comp = bundle.entries.find((e) => e?.__type__ === cid);
    assert.ok(comp, `${label} 根上必须挂 ${tsPath}（cid ${cid} 反解不到 ⇒ 会变成 MissingScript）`);
    const node = comp!.node as { __id__?: number } | undefined;
    assert.equal(node?.__id__, bundle.entries.indexOf(bundle.root), `${label} 脚本必须挂在根节点上`);
    const custom = [...new Set(bundle.entries.map((e) => e?.__type__).filter((t) => t && !String(t).startsWith('cc.')))];
    // `CCPropertyOverrideInfo` 不是脚本 —— 它是**嵌套 prefab 实例的属性覆盖项**（`_name` / `_lpos` …），
    // 引擎把它序列化成这个非 `cc.*` 的 `__type__`。别当成「脚本改名后的坏引用」。
    // ⚠️ `RESBAR_TS` / `RESBAR_SLOT_TS` **故意不列**：顶部资源条走嵌套实例后，那两个 cid
    //    不该再出现在 Store.prefab 里（列进来等于给「退化成内联」开后门；C1b 有反向断言）。
    const known = new Set([
        cidOf(`${SHELL_TS}.meta`),
        cidOf(`${SECTION_TS}.meta`),
        'CCPropertyOverrideInfo',
    ]);
    for (const t of custom) assert.ok(known.has(String(t)), `${label} 出现未知自定义 cid ${String(t)}（多半是脚本改名后没重绑）`);
}

/** 源 prefab 根的 UITransform（`[8.6]` 写的那两个值）—— 嵌套实例的尺寸就继承它。 */
function rootTransform(bundle: ReturnType<typeof analyze>): Rect {
    const rect = bundle.rects.get(bundle.rootName)!;
    return rect;
}

/**
 * 读公共货币件 `common/ResBar.prefab`：根尺寸 + 每个 `Res{n}` 相对**根中心**的偏移。
 *
 * 为什么 store 用例要读它：`Store/ResBar` 是**嵌套实例**，两枚药丸的节点**不落 Store.prefab**
 * ⇒ 「药丸落在哪」= **实例锚点**（本文件守）⊕ **公共件内部布局**（`militia-talent-ui.test.ts` 守）。
 * 这里把两者复合起来做一次端到端对账 —— 只改实例 `_lpos`、或只改公共件布局，都会在这里显形。
 */
function commonResBarLayout(): { width: number; height: number; cells: Map<string, { dx: number; dy: number }> } {
    const src = JSON.parse(readFileSync(RESBAR_PREFAB, 'utf8')) as Entry[];
    const at = (ref: unknown): Entry | null =>
        (ref && typeof ref === 'object' && '__id__' in (ref as Entry)) ? src[(ref as { __id__: number }).__id__]! : null;
    const root = src.find((e) => e && e.__type__ === 'cc.Node' && e._parent === null)!;
    const uit = ((root._components ?? []) as unknown[]).map(at).find((c) => c?.__type__ === 'cc.UITransform')!;
    const size = uit._contentSize as { width: number; height: number };
    const cells = new Map<string, { dx: number; dy: number }>();
    for (const child of ((root._children ?? []) as unknown[])) {
        const node = at(child)!;
        const pos = node._lpos as { x: number; y: number };
        cells.set(String(node._name), { dx: pos.x, dy: pos.y });
    }
    return { width: size.width, height: size.height, cells };
}

test('C1 外壳 `Store`：结构 + 3 层背景 + 资源条 + 滚动区（几何逐位对 FGUI）', () => {
    assert.equal(shell.rootName, 'Store');
    assert.equal(shell.root._parent, null, '根节点没有父节点');
    assert.equal(shell.root._name, 'Store');
    // `cc.Node` 条目数 = 规格 7 + 根 + 顶部资源条实例壳 = 13。**别按「真实节点」数**：
    // 5 个 `Sec*` + 顶部资源条共 6 个嵌套 prefab 实例，在父 prefab 的 JSON 里是「占位根」
    // （只有 `_parent` + `_prefab`）——它照样占一条 `cc.Node`，但没有 `_components`。
    assert.equal(shell.nodes.length, 13, `cc.Node 条目应为 13，实得 ${shell.nodes.length}`);
    assert.equal(shell.realNodes.length, 7, `真实节点应为 7（13 减去 6 个嵌套实例壳），实得 ${shell.realNodes.length}`);
    expectAllUi2D(shell, '外壳');
    expectRootScript(shell, SHELL_TS, '外壳');
    assert.deepEqual(topOrder(shell), ['Bg', 'ShopPanel', 'Npc', 'ResBar', 'ScrollView']);
    // 根 = 整屏 720×1280（锚点 (0.5,0.5)，原点 = 画布中心）
    expectRect(shell, 'Store', 0, 0, 720, 1280, '外壳根 ');

    // 三层背景（与 `组件_商店_界面.xml` + `通用/组件_商店_背景.xml` 逐位）
    expectRect(shell, 'Store/Bg', 0, 0, 720, 1280, '整屏地牢货架 ');
    expectRect(shell, 'Store/ShopPanel', 0, 384, 720, 926, '木框面板 ');
    expectRect(shell, 'Store/Npc', 1, 61, 720, 330, 'NPC 哥布林 ');
    // ── 顶部资源条 = **公共件 `common/ResBar` 的嵌套实例** ──────────────────
    // 实例壳只有「锚点落点」落盘（尺寸/内部节点在其源 prefab 里）：
    //   `_lpos=(-131,509)`、父原点 (360,640) ⇒ 锚点 (229,131)。
    expectRect(shell, 'Store/ResBar', 229, 131, 0, 0, '资源条实例锚点 ');
    // 两枚药丸的绝对位置 = 实例锚点 ⊕ 公共件内部布局（每格 132×40、锚点居中）：
    //   旧「手搓 720×40 条」的中心在 x = 138 / 300；改实例后各向中间收 8px ⇒ 盒左 80 / 226、顶边 86。
    const rb = commonResBarLayout();
    assert.equal(rb.width, 552, '公共件整条宽 552（老端 组件_资源栏 的 mid group）');
    assert.equal(rb.height, 106, '公共件整条高 106');
    for (const [name, expectLeft] of [['Res0', 80], ['Res1', 226]] as const) {
        const cell = rb.cells.get(name);
        assert.ok(cell, `公共件 ${RESBAR_PREFAB} 里没有 ${name} —— 药丸会整格消失且不报错`);
        assert.ok(near(229 + cell!.dx - 66, expectLeft), `${name} 药丸盒左应为 ${expectLeft}（实得 ${229 + cell!.dx - 66}）`);
        assert.ok(near(131 - cell!.dy - 20, 86), `${name} 药丸顶边应为 86（实得 ${131 - cell!.dy - 20}）`);
    }
    // 滚动区：FGUI `xy="361,385" pivot="0.5,0"` ⇒ 盒左 28、顶 385
    expectRect(shell, 'Store/ScrollView', 28, 385, 666, 738, '滚动区 ');
    expectRect(shell, 'Store/ScrollView/view', 28, 385, 666, 738, '蒙版 ');
    expectRect(shell, 'Store/ScrollView/view/content', 28, 385, 666, STORE_CONTENT_H, 'content ');
});

/**
 * C1b 资源条 = 公共件 `common/ResBar` 的**嵌套实例**：两格配置落在覆盖项（`resKeys`）。
 *
 * 为什么单独一条：`C1` 只守「实例摆在 (229,131)」⇒ 把实例换成内联节点树、或把 `resKeys`
 * 改成别的货币，几何全对、C1 照绿，但「顶部显示铜币 + 灵石」「改公共件穿透到这里」都会**静默失效**。
 *
 * ⚠️ `open.json` 里商城是 `refId = 1`（`url: "TabStore"`），但那行 `resShowType = [10,7]`
 *    （幻灵玉 + 铜币）与界面现状（铜币 + 灵石）**顺序与内容都不同** ⇒ 暂时不覆盖 `openRefId`
 *    （继承公共件默认 0），待策划确认。切的时候这一条会红，正好提醒同步改界面预期。
 */
test('C1b 资源条 = 公共件 `ResBar` 的嵌套实例：两格配置落在覆盖项（`resKeys`）', () => {
    const commonUuid = (JSON.parse(readFileSync(`${RESBAR_PREFAB}.meta`, 'utf8')) as { uuid: string }).uuid;
    const bar = shell.shells.get('Store/ResBar');
    assert.ok(bar, 'Store/ResBar 必须是嵌套实例壳（`shells` 里找不到 ⇒ 又变成「手抄一份 + 挂脚本」了）');
    assert.equal(bar!.uuid, commonUuid, `Store/ResBar 必须实例化 ${RESBAR_PREFAB}（uuid 不对 ⇒ 改公共件同步不过来）`);
    assert.equal(bar!.overrides._name, 'ResBar', '覆盖名应为 ResBar');

    // 位置覆盖必须是 (-131,509)：丢了会落回 (0,0)、整条压到 NPC 上，且**零报错**
    const lpos = bar!.overrides._lpos as { x: number; y: number } | undefined;
    assert.ok(lpos, '实例必须覆盖 _lpos');
    assert.ok(near(lpos!.x, -131) && near(lpos!.y, 509), `实例 _lpos 应为 (-131,509)，实得 (${lpos!.x},${lpos!.y})`);

    // 格数真源 = 覆盖的 `resKeys`：商城两格 = 铜币 + 灵石（与主界面 HUD 同一套 key）
    assert.equal(bar!.overrides.resKeys, 'gold,gem', '显示哪两格 = `resKeys`（与主界面 HUD 同一套 key）');
    assert.equal(String(bar!.overrides.resKeys).split(',').length, 2, '商城只有两格 ⇒ resKeys 必须是 2 个键');
    // 不覆盖 `openRefId` ⇒ 继承公共件默认 0（见上面 open.json 的口径说明）
    assert.ok(!('openRefId' in bar!.overrides), '商城暂不走 open.json 真源 ⇒ 不该覆盖 openRefId');

    // 宿主**只许**覆盖「名字 / 位置 / 旋转 / 格数」——多出来的多半是想在这里私有一份布局
    assert.deepEqual(
        Object.keys(bar!.overrides).sort(),
        ['_euler', '_lpos', '_lrot', '_name', 'resKeys'],
        'Store/ResBar 的覆盖项超出预期 ⇒ 确认是有意为之',
    );

    // 反向断言：宿主里不许再出现内联形态 —— 内联脚本 cid、内联 Res 格
    for (const ts of [RESBAR_TS, RESBAR_SLOT_TS]) {
        assert.ok(
            !shell.entries.some((e) => e?.__type__ === cidOf(`${ts}.meta`)),
            `Store.prefab 里不该内联挂 ${ts} —— 资源条必须走公共件实例`,
        );
    }
    assert.equal(
        shell.nodes.filter((n) => /^Res\d+$/.test(String(n._name))).length,
        0,
        'Store.prefab 里不该有内联的 Res0/Res1（那是「手抄一份」的旧形态）',
    );
});

test('C2 外壳：5 个分段实例挂的是对的 prefab、位置首尾相接（顶 y = storeSectionTop）', () => {
    // 嵌套实例的 `_name` / `_lpos` 只存在于 `CCPropertyOverrideInfo` 里（见 `analyze` 的注释）
    // ⇒ 这里读覆盖项，不读 `node._lpos`（那是 `undefined`）。
    const uuidOf = (prefab: string): string =>
        (JSON.parse(readFileSync(`${PREFAB_DIR}/${prefab}.prefab.meta`, 'utf8')) as { uuid: string }).uuid;
    STORE_SECTIONS.forEach((section, index) => {
        const name = `Sec${index}_${section.prefab}`;
        const path = `Store/ScrollView/view/content/${name}`;
        const instance = shell.shells.get(path);
        assert.ok(instance, `找不到第 ${index} 段的嵌套实例壳：${path}`);
        assert.equal(instance!.uuid, uuidOf(section.prefab), `第 ${index} 段挂错了 prefab`);
        assert.equal(instance!.overrides._name, name, `壳节点名应为 ${name}`);
        const lpos = instance!.overrides._lpos as { x: number; y: number };
        assert.ok(near(lpos.x, 0), `第 ${index} 段 x 应为 0，实得 ${lpos.x}`);
        assert.ok(near(lpos.y, storeSectionTop(section.key)), `第 ${index} 段 y 应为 ${storeSectionTop(section.key)}，实得 ${lpos.y}`);
        // 段尺寸继承源 prefab 的根 ⇒ 源根必须是 `666 × 段高`（见 C9）
        const root = rootTransform(sections[section.key]);
        assert.equal(root.h, STORE_SECTION_H[section.key]);
    });
    // 首尾相接：`storeSectionTop` 是**负数往下走**的（0 / −852 / −1227 …）
    // ⇒ 关系是「本段顶 = 上段顶 − 上段高 − 段间距」，别写成 `+`。
    for (let i = 1; i < STORE_SECTIONS.length; i += 1) {
        const before = STORE_SECTIONS[i - 1]!;
        assert.equal(
            storeSectionTop(before.key) - STORE_SECTION_H[before.key] - STORE_SECTION_GAP,
            storeSectionTop(STORE_SECTIONS[i]!.key),
            `第 ${i} 段与上一段没接上`,
        );
    }
});

test('C3 外壳：内容 = 1 个 ScrollView + 5 段（没有页签、没有分页控件）', () => {
    const names = topOrder(shell);
    for (const forbidden of ['TabBar', 'Tabs', 'Menu', 'Page', 'PageView']) {
        assert.ok(!names.some((n) => n.includes(forbidden)), `外壳不该出现「${forbidden}」——真源是一条长滚动`);
    }
    const scroll = shell.rects.get('Store/ScrollView')!;
    assert.ok(scroll.h >= 700, '滚动区高度应接近真源的 738');
    const content = shell.rects.get('Store/ScrollView/view/content')!;
    assert.ok(content.h > scroll.h * 4, 'content 应远高于可视区（否则没有滚动意义）');
});

test('C4 段一 `StoreGemBox`：标题绶带 + 两张整宽宝箱卡', () => {
    const gem = sections.gem;
    assert.equal(gem.rootName, 'StoreGemBox');
    assert.equal(gem.nodes.length, 51 + 1, `cc.Node 条目 51 + 根，实得 ${gem.nodes.length}`);
    assert.equal(gem.realNodes.length, 50, `真实节点 50（52 − 2 颗红点实例壳），实得 ${gem.realNodes.length}`);
    expectAllUi2D(gem, '宝箱段');
    expectRootScript(gem, SECTION_TS, '宝箱段');
    // 老端 `list.initVirtualList(this, this.RenderBox)` **没有**点击回调 ⇒ 宝箱卡**整体不可点**，
    // 热区只有卡内的 4 个按钮。这条断言把「无意中给整卡加了 Button」钉死。
    expectComps(gem, 'StoreGemBox/List/Card0', [], '宝箱卡不该整卡可点 ');
    assert.deepEqual(topOrder(gem), ['TitleBar', 'Title', 'List']);
    expectRect(gem, 'StoreGemBox', 0, 0, 666, STORE_SECTION_H.gem, '宝箱段根 ');

    expectRect(gem, 'StoreGemBox/TitleBar', 0, 0, 665, 81, '标题绶带 ');
    // `n60 title` richtext `@(333,10) pivot(0.5,0) anchor` 156×52 ⇒ 盒左 333−78 = 255、顶 10
    expectRect(gem, 'StoreGemBox/Title', 255, 10, 156, 52, '段标题 ');
    // FGUI `n58` list `666×753 @(336,89) pivot(0.5,0)` ⇒ 盒左 3、顶 89
    expectRect(gem, 'StoreGemBox/List', 3, 89, 666, 753, '宝箱列表 ');
    expectRect(gem, 'StoreGemBox/List/Card0', 3, 89, 666, 377, '低级宝箱卡 ');
    expectRect(gem, 'StoreGemBox/List/Card1', 3, 466, 666, 376, '高级宝箱卡 ');
    // 卡内零件（FGUI 卡内绝对坐标 + 卡片盒左 3 / 顶 89）
    expectRect(gem, 'StoreGemBox/List/Card0/Bg', 3, 89, 666, 377, '低级卡底 ');
    expectRect(gem, 'StoreGemBox/List/Card1/Bg', 3, 466, 666, 376, '高级卡底 ');
    expectRect(gem, 'StoreGemBox/List/Card0/AdBtn', 3 + 57, 89 + 268, 128, 74, '广告按钮 ');
    // `n8 icon` `@(97,37) pivot(0.5,0.5) anchor` 48×36 ⇒ **xy 是轴心** ⇒ 组件内盒左上 (73,19)。
    // ⚠️ 再叠上按钮自己在卡内的 `(57,268)` —— 早期这里漏了按钮偏移（写成 `3+73`），
    //    那个坐标落在按钮**外面**，是测试写错而不是产物错（`_store2_rects.mjs` 实测 133）。
    expectRect(gem, 'StoreGemBox/List/Card0/AdBtn/Icon', 3 + 57 + 73, 89 + 268 + 19, 48, 36, '广告图标 ');
    expectRect(gem, 'StoreGemBox/List/Card0/AdBtn/Label', 3 + 57 + 7, 89 + 268 + 17, 60, 39, '免费文案 ');
    expectRect(gem, 'StoreGemBox/List/Card0/Buy1', 3 + 220, 89 + 267, 193, 79, '抽 1 次 ');
    expectRect(gem, 'StoreGemBox/List/Card0/Buy10', 3 + 435, 89 + 267, 193, 79, '抽 10 次 ');
    expectRect(gem, 'StoreGemBox/List/Card0/Buy1/Label', 3 + 220 + 25, 89 + 267 + 20, 70, 39, '抽 1 次文案 ');
    expectRect(gem, 'StoreGemBox/List/Card0/Buy1/Cost', 3 + 220 + 100, 89 + 267 + 24, 76, 31, '消耗条 ');
    // `组件_公用_消耗_商店` 的 `n0 icon` 35×35 `@(0,−1)`（**无** anchor ⇒ 0,−1 就是左上角）
    expectRect(gem, 'StoreGemBox/List/Card0/Buy1/Cost/Icon', 3 + 320, 89 + 290, 35, 35, '消耗钥匙 ');
    expectRect(gem, 'StoreGemBox/List/Card0/Own', 3 + 521, 89 + 34, 72, 40, '拥有数量 ');
    expectRect(gem, 'StoreGemBox/List/Card0/Help', 3 + 598, 89 + 8, 42, 41, '帮助按钮 ');
    // 宝石装饰：`n72/n73/n74` 尺寸在 item XML 里写死（73×76 / 86×90 / 73×76）
    expectRect(gem, 'StoreGemBox/List/Card0/Gem0', 3 + 4, 89 + 11, 73, 76, '宝石装饰 0 ');
    expectRect(gem, 'StoreGemBox/List/Card0/Gem1', 3 + 262, 89 + 12, 86, 90, '宝石装饰 1 ');
    expectRect(gem, 'StoreGemBox/List/Card0/Gem2', 3 + 255, 89 + 130, 73, 76, '宝石装饰 2 ');
    // 两张卡整宽铺满 list（89 → 842）
    const list = gem.rects.get('StoreGemBox/List')!;
    assert.equal(list.top, STORE_SECTION_LIST_TOP.gem);
    assert.equal(list.h, 377 + 376);
});

test('C5 段二 `StoreLevelGift`：横向翻页一张卡 + 左右箭头 + 5 个页码点', () => {
    const gift = sections.gift;
    assert.equal(gift.rootName, 'StoreLevelGift');
    assert.equal(gift.nodes.length, 32 + 1, `cc.Node 条目 32 + 根，实得 ${gift.nodes.length}`);
    assert.equal(gift.realNodes.length, 32, `真实节点 32（33 − 1 颗红点实例壳），实得 ${gift.realNodes.length}`);
    expectAllUi2D(gift, '关卡礼包段');
    expectRootScript(gift, SECTION_TS, '关卡礼包段');
    // 同宝箱段：老端 `initVirtualList(this, this.renderGuanKaOnePage)` 没有点击回调 ⇒ 整卡不可点。
    expectComps(gift, 'StoreLevelGift/List/Card', [], '关卡礼包卡不该整卡可点 ');
    assert.deepEqual(topOrder(gift), ['TitleBar', 'Title', 'List', 'ArrowLeft', 'ArrowRight', 'Dots']);

    expectRect(gift, 'StoreLevelGift/TitleBar', 0, 0, 665, 81, '标题绶带 ');
    expectRect(gift, 'StoreLevelGift/Title', 233.5, 7, 197, 51, '段标题 ');
    expectRect(gift, 'StoreLevelGift/List', 0, 85, 666, 280, '翻页列表 ');
    expectRect(gift, 'StoreLevelGift/List/Card', 0, 85, 666, 246, '礼包卡 ');
    // ⚠️ 卡内零件的 FGUI 坐标是**卡内**相对值 ⇒ 必须再加卡的顶边 85 才是段内绝对 y。
    const CARD_TOP = 85;
    // `text_buycount` 115×34 `@(531,146) pivot(1,0.5) anchor` ⇒ 盒左 531−115 = 416、顶 146−17 = 129
    expectRect(gift, 'StoreLevelGift/List/Card/BuyCount', 416, CARD_TOP + 129, 115, 34, '限购文案 ');
    // `reward` 280×85 `@(324,55) pivot(0.5,0.5)`（**无** anchor、scale 0.8）
    // ⇒ 缩放**绕 pivot（= 中心）** ⇒ 视觉框 224×68 居中于 (464,97.5) ⇒ 盒左 352、顶 63.5。
    // ⚠️ 旧版按「左上角不动」落成 (184,12.5) —— 那正是用户报的「关卡宝箱错乱」的一半。
    expectRect(gift, 'StoreLevelGift/List/Card/Reward', 352, CARD_TOP + 63.5, 224, 68, '奖励槽 ');
    // 三格奖励：`flow_hz colGap=10 align=center` ⇒ 85 宽、步长 95、整排 275 居中于 280 ⇒ 首格左 2.5，
    // 再乘父级 0.8 ⇒ 视觉上 68 宽、步长 76，首格左 = 32 + (2.5+42.5)*0.8 − 34 = 354
    expectRect(gift, 'StoreLevelGift/List/Card/Reward/R0', 354, CARD_TOP + 63.5, 68, 68, '奖励槽 0 ');
    expectRect(gift, 'StoreLevelGift/List/Card/Reward/R1', 354 + 76, CARD_TOP + 63.5, 68, 68, '奖励槽 1 ');
    expectRect(gift, 'StoreLevelGift/List/Card/Reward/R2', 354 + 152, CARD_TOP + 63.5, 68, 68, '奖励槽 2 ');
    // 购买按钮 160×80 `@(394,151) pivot(0.5,0.5) scale(0.8,0.7)`（无 anchor）
    // ⇒ 视觉框 128×56 居中于 (474,191) ⇒ 盒左 410、顶 163（旧版错成 314 / 111）
    expectRect(gift, 'StoreLevelGift/List/Card/BuyBtn', 410, CARD_TOP + 163, 128, 56, '购买按钮 ');
    // `item_icon` 40×40 `@(19,22)`：按钮内绝对坐标 ⇒ 视觉盒左 = 410 + 19×0.8 = 425.2
    expectRect(gift, 'StoreLevelGift/List/Card/BuyBtn/Icon', 425.2, CARD_TOP + 178.4, 32, 28, '价签货币图标 ');
    // `title` 84×42 `@(61,21)` ⇒ 视觉盒左 = 410 + 61×0.8 = 458.8、顶 = 163 + 21×0.7 = 177.7
    expectRect(gift, 'StoreLevelGift/List/Card/BuyBtn/Label', 458.8, CARD_TOP + 177.7, 67.2, 29.4, '价格文案 ');
    // `按钮_宝箱` 80×80 `@(8,5) scale 0.9`（组件根 pivot 0.5,0.5）⇒ 视觉框 72×72 居中于 (48,45）
    expectRect(gift, 'StoreLevelGift/List/Card/ChestBtn', 12, CARD_TOP + 9, 72, 72, '免费宝箱 ');
    // 左右箭头：右箭头 `pivot(0.5,0.5) anchor scale(-1,1)` ⇒ xy=(642,193) 就是**中心**
    expectRect(gift, 'StoreLevelGift/ArrowLeft', -10, 159, 52, 63, '左箭头 ');
    expectRect(gift, 'StoreLevelGift/ArrowRight', 616, 161.5, 52, 63, '右箭头 ');
    // 页码点：5 × 20 + 4 × 15 = 160，居中于 200 宽的容器 ⇒ 首点盒左 = 233 + 20
    expectRect(gift, 'StoreLevelGift/Dots/D0', 253, 339, 20, 20, '页码点 0 ');
    expectRect(gift, 'StoreLevelGift/Dots/D4', 253 + 4 * 35, 339, 20, 20, '页码点 4 ');
});

test('C6 段三 `StoreGold`：6 张竖卡分两行，含「首充额外送」条', () => {
    const gold = sections.gold;
    assert.equal(gold.rootName, 'StoreGold');
    assert.equal(gold.nodes.length, 69 + 1, `cc.Node 条目 69 + 根，实得 ${gold.nodes.length}`);
    assert.equal(gold.realNodes.length, gold.nodes.length, '金币段没有嵌套实例 ⇒ 全是真实节点');
    expectAllUi2D(gold, '金币段');
    expectRootScript(gold, SECTION_TS, '金币段');
    // 整卡可点：老端 `list.initVirtualList(this, this.RenderCharge, this.onClickCharge)`
    // 第三参就是整卡点击 ⇒ 卡节点自己也挂 `cc.Button`（不带 SCALE 按下态）。
    expectComps(gold, 'StoreGold/List/Card0', ['cc.Button'], '金币卡整卡可点 ');
    expectRect(gold, 'StoreGold', 0, 0, 666, STORE_SECTION_H.gold, '金币段根 ');
    // FGUI `list 632×274 @(333,90) pivot(0.5,0) anchor`；内容高 = 2 行 × 276 + lineGap 20 = 572
    expectRect(gold, 'StoreGold/List', 17, 90, 632, 572, '金币列表 ');
    // 行 0：三列贴 list 顶；行 1 下移 276 + 20
    for (const [i, col] of [0, 1, 2].entries()) {
        expectRect(gold, `StoreGold/List/Card${i}`, 333 + STORE_GRID_COL_X[col]! - 100, 90, 200, 276, `金币卡 ${i} `);
    }
    for (const [i, col] of [0, 1, 2].entries()) {
        expectRect(gold, `StoreGold/List/Card${i + 3}`, 333 + STORE_GRID_COL_X[col]! - 100, 90 + 296, 200, 276, `金币卡 ${i + 3} `);
    }
    // `n60` 组（「首充额外送」/ `exIcon` / `x60`）三件成员用的是**卡内绝对坐标**
    // ⇒ `Extra` 只是一个「落在卡原点、同宽」的容器，成员盒左仍等于卡内值
    expectRect(gold, 'StoreGold/List/Card0/Extra', 18, 90, 200, 276, '额外条容器 ');
    expectRect(gold, 'StoreGold/List/Card0/Extra/Label', 18 + 16, 90 + 25, 84, 24, '首充额外送 ');
    expectRect(gold, 'StoreGold/List/Card0/Extra/Icon', 18 + 100, 90 + 17, 40, 40, '元宝小图标 ');
    // `n61 icon` `@(100,127) pivot(0.5,0.5) anchor` 135×135 ⇒ 盒左 100−67.5 = 32.5
    expectRect(gold, 'StoreGold/List/Card0/Icon', 18 + 32.5, 90 + 59.5, 135, 135, '元宝主图标 ');
    // `n62 text_name` 31×34 `@(136,160)`（无 anchor ⇒ 左上角）
    expectRect(gold, 'StoreGold/List/Card0/CountText', 18 + 136, 90 + 160, 64, 34, '数量角标 ');
    // `n78 freeText` = 按钮_公共_多颜色_二级_变暗 160×60 `@(20,209) scale 0.85`，组件根 pivot 0.5,0.5
    // ⇒ 视觉框 136×51 居中于 (100,239) ⇒ 盒左 32、顶 213.5
    expectRect(gold, 'StoreGold/List/Card0/Price', 18 + 32, 90 + 213.5, 136, 51, '价格条 ');
    assert.equal(gold.rects.get('StoreGold/List/Card0')!.h, STORE_CARD_H);
});

test('C7 段四 `StoreSilver`：4 张竖卡两行，后两格带折扣角标', () => {
    const silver = sections.silver;
    assert.equal(silver.rootName, 'StoreSilver');
    assert.equal(silver.nodes.length, 39 + 1, `cc.Node 条目 39 + 根，实得 ${silver.nodes.length}`);
    // 40 条 − 4 颗红点实例壳。`铜钱页面item` 真源还有 `text_cd`（冷却中）/`n1`（今日已售空）
    // 两条文案，**故意不落**：本端没有服务器冷却/售空状态，落了就是永远显示「11:22:33」的假数据。
    assert.equal(silver.realNodes.length, 36, `真实节点 36（40 − 4 颗红点实例壳），实得 ${silver.realNodes.length}`);
    expectAllUi2D(silver, '银币段');
    expectRootScript(silver, SECTION_TS, '银币段');
    // 整卡可点：老端 `list.initVirtualList(this, this.RendCoinItem, this.onClickCoin)`。
    expectComps(silver, 'StoreSilver/List/Card0', ['cc.Button'], '银币卡整卡可点 ');
    expectRect(silver, 'StoreSilver/List', 17, 79, 632, 562, '银币列表 ');
    expectRect(silver, 'StoreSilver/List/Card0', 18, 79, 200, 276, '银币卡 0 ');
    expectRect(silver, 'StoreSilver/List/Card1', 333 - 100, 79, 200, 276, '银币卡 1 ');
    expectRect(silver, 'StoreSilver/List/Card2', 333 + 215 - 100, 79, 200, 276, '银币卡 2 ');
    expectRect(silver, 'StoreSilver/List/Card3', 18, 79 + 286, 200, 276, '银币卡 3 ');
    // 卡面主图 `n61 icon` 100×100 `@(100,119) pivot(0.5,0.5) anchor` ⇒ 盒左 50、顶 69
    expectRect(silver, 'StoreSilver/List/Card0/Icon', 18 + 50, 79 + 69, 100, 100, '铜钱图 ');
    // 折扣角标：卡 2 / 3 有（`kfqd01` 67×55 @(136,29)），卡 0 / 1 没有
    expectRect(silver, 'StoreSilver/List/Card2/SaleTag', 448 + 136, 79 + 29, 67, 55, '折扣角标 ');
    expectRect(silver, 'StoreSilver/List/Card3/SaleTag', 18 + 136, 79 + 286 + 29, 67, 55, '折扣角标 ');
    assert.ok(!silver.rects.has('StoreSilver/List/Card0/SaleTag'), '第 1 格不该有折扣角标');
    assert.ok(!silver.rects.has('StoreSilver/List/Card1/SaleTag'), '第 2 格不该有折扣角标');
    // 第 1 格是「广告 / 免费」档：只有一枚居中的「免费」+ `n68 img_video` 39×28 @(55,224)
    expectRect(silver, 'StoreSilver/List/Card0/Price', 18 + 20, 79 + 209, 160, 60, '价格条 ');
    // `n67 freeText` 48×32 中心 `@(123,239)`（广告态 `gearXY` 右移）⇒ 盒左 99、顶 223
    expectRect(silver, 'StoreSilver/List/Card0/Price/Label', 18 + 99, 79 + 223, 48, 32, '免费文案 ');
    assert.ok(!silver.rects.has('StoreSilver/List/Card0/Price/Icon'), '免费档不该有货币图标');
    expectRect(silver, 'StoreSilver/List/Card0/Price/Video', 18 + 55, 79 + 224, 39, 28, '看视频图标 ');
    // 第 3 格是「可购买」档：`icon_res` 右缘贴卡内 97、`title` 左缘起于卡内 97
    expectRect(silver, 'StoreSilver/List/Card2/Price/Icon', 448 + 20 + 47, 79 + 225, 30, 30, '货币图标 ');
    expectRect(silver, 'StoreSilver/List/Card2/Price/Label', 448 + 20 + 77, 79 + 224, 80, 32, '价格数字 ');
    assert.ok(!silver.rects.has('StoreSilver/List/Card2/Price/Video'), '可购买档不该有看视频图标');
});

test('C8 段五 `StoreGoods`：7 格（2 行 + 1 行 3 格），品质物品框 + 限购 + 价格', () => {
    const goods = sections.goods;
    assert.equal(goods.rootName, 'StoreGoods');
    assert.equal(goods.nodes.length, 80 + 1, `cc.Node 条目 80 + 根，实得 ${goods.nodes.length}`);
    assert.equal(goods.realNodes.length, goods.nodes.length, '黑市宝箱段没有嵌套实例 ⇒ 全是真实节点');
    expectAllUi2D(goods, '黑市宝箱段');
    expectRootScript(goods, SECTION_TS, '黑市宝箱段');
    // 整卡可点：老端 `list.initVirtualList(this, this.RenderGoods, this.onClickCoin)`。
    expectComps(goods, 'StoreGoods/List/Card0', ['cc.Button'], '黑市卡整卡可点 ');
    expectRect(goods, 'StoreGoods', 0, 0, 666, STORE_SECTION_H.goods, '黑市宝箱段根 ');
    expectRect(goods, 'StoreGoods/List', 17, 88, 632, 848, '杂货列表 ');
    // 第 3 行只有 1 格（7 = 3 + 3 + 1）
    expectRect(goods, 'StoreGoods/List/Card6', 18, 88 + 2 * 286, 200, 276, '杂货卡 6 ');
    assert.ok(!goods.rects.has('StoreGoods/List/Card7'), '不该有第 8 格');
    // `n37 com_item` = 物品框 100×100 `@(50,70)`；道具图按 `com_goods` 口径 80×80 贴框内 (5,5)
    expectRect(goods, 'StoreGoods/List/Card0/ItemBox', 18 + 50, 88 + 70, 100, 100, '物品框 ');
    expectRect(goods, 'StoreGoods/List/Card0/ItemBox/Frame', 18 + 50, 88 + 70, 100, 100, '品质框 ');
    expectRect(goods, 'StoreGoods/List/Card0/ItemBox/Icon', 18 + 55, 88 + 75, 80, 80, '道具图标 ');
    // `n46 text_remainTime` 74×24 居中于卡内 (100,196)（这里取 120 宽同中心，防 `SHRINK` 缩字）
    expectRect(goods, 'StoreGoods/List/Card0/Remain', 18 + 40, 88 + 184, 120, 24, '限购文案 ');
    // `n45 组件_消耗` = 按钮_公用_消耗 170×60 `@(15,210) scale 0.8`（组件根 pivot 0.5,0.5）
    // ⇒ 视觉框 136×48 居中于卡内 (100,240) ⇒ 盒左 32、顶 216
    expectRect(goods, 'StoreGoods/List/Card0/Price', 18 + 32, 88 + 216, 136, 48, '价格条 ');
    // 组件内 `icon` 40×40 `@(80,30) pivot(0.5,0.5) anchor` ⇒ 视觉盒左 = 32 + (80−20)×0.8 = 80，
    // 视觉盒宽高都乘 0.8 ⇒ **32×32**（早期写成 40×32：宽漏乘了缩放）。
    expectRect(goods, 'StoreGoods/List/Card0/Price/Icon', 18 + 80, 88 + 216 + 8, 32, 32, '货币图标 ');
    // 组件内 `title` 左缘起于 100、纵向中心 30 ⇒ 视觉盒左 = 32 + 100×0.8 = 112
    expectRect(goods, 'StoreGoods/List/Card0/Price/Value', 18 + 112, 88 + 216 + 11.2, 48, 25.6, '价格数字 ');
});

test('C9 六张 prefab 的**根 UITransform** = 真实版心（改版面表就会在这里炸）', () => {
    // ⚠️ 源 prefab 的根尺寸不是装饰 —— 分段被外壳当嵌套实例挂进去时，
    //    壳节点**只能从源根继承尺寸**（`_lpos`/`_name` 能靠覆盖项改，尺寸覆盖实测不落盘）
    //    ⇒ 源根写小了，666×936 的段在编辑器里就只有 100×100 的框。
    const shellRoot = rootTransform(shell);
    assert.equal(shellRoot.w, 720, '外壳根宽');
    assert.equal(shellRoot.h, 1280, '外壳根高');
    for (const section of STORE_SECTIONS) {
        const root = rootTransform(sections[section.key]);
        assert.equal(root.w, 666, `${section.prefab} 根宽`);
        assert.equal(root.h, STORE_SECTION_H[section.key], `${section.prefab} 根高`);
    }
    // content 是滚动区的真实内容高（`cc.ScrollView` 靠它算可滚范围）
    assert.equal(shell.rects.get('Store/ScrollView/view/content')?.h, STORE_CONTENT_H);
});

// ============================================================
// D. 接线
// ============================================================

const MAIN_ROOT = assetPath('ui/main/MainRoot.prefab');
const MAIN_TAB_HOST_TS = 'assets/script/app/main/MainTabHost.ts';

test('D1 `StorePage.prefabPath` 与磁盘目录大小写一致（Android/iOS 的 zip 内路径大小写敏感）', () => {
    const src = readFileSync(SHELL_TS, 'utf8');
    assert.match(src, /static\s+prefabPath\s*=\s*'ui\/Store\/Store'/, 'prefabPath 必须是 ui/Store/Store（S 大写）');
    assert.ok(assetExists('ui/Store/Store.prefab'), '磁盘上必须有 ui/Store/Store.prefab');
});

test('D2 `MainTabHost` 有 `shopPage`，且 `MainTab.Shop` 路由到它', () => {
    const src = readFileSync(MAIN_TAB_HOST_TS, 'utf8');
    assert.match(src, /shopPage:\s*Prefab/, '缺少 shopPage @property');
    assert.match(src, /index === MainTab\.Shop\)\s*return this\.shopPage/, 'pagePrefab 没把 Shop 路由到 shopPage');
});

test('D3 `MainRoot.prefab` 的 `shopPage` 真的绑到了 `Store.prefab` 的 uuid', () => {
    const prefab = JSON.parse(readFileSync(MAIN_ROOT, 'utf8')) as Entry[];
    const host = prefab.find((e) => typeof e?.shopPage === 'object' && e.shopPage !== null);
    assert.ok(host, 'MainRoot.prefab 里找不到绑了 shopPage 的组件');
    const bound = (host!.shopPage as { __uuid__?: string }).__uuid__;
    const expect = (JSON.parse(readFileSync(`${PREFAB_DIR}/Store.prefab.meta`, 'utf8')) as { uuid: string }).uuid;
    assert.equal(bound, expect, `shopPage 绑的 uuid 不是 Store.prefab（绑到了 ${bound}）`);
    // 其余四个 tab 页必须还在（别把别的绑定碰掉）
    for (const prop of ['arenaPage', 'rolePage', 'roleMainPage', 'alliancePage']) {
        assert.ok(typeof host![prop] === 'object' && host![prop] !== null, `${prop} 的绑定被弄丢了`);
    }
});

test('D4 分段脚本的 `sectionKey` 必须在 prefab 里落值（漏了会让 5 段都打「未知段键」）', () => {
    for (const section of STORE_SECTIONS) {
        const bundle = sections[section.key];
        const cid = cidOf(`${SECTION_TS}.meta`);
        const comp = bundle.entries.find((e) => e?.__type__ === cid)!;
        assert.equal(comp.sectionKey, section.key, `${section.prefab} 的 sectionKey 应为 ${section.key}，实得 ${String(comp.sectionKey)}`);
    }
});
