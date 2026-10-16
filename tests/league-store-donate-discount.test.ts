/**
 * 「联盟」P4（**联盟商店 `LeagueStore` + 联盟捐献 `LeagueDonate` + 每日砍价 `LeagueDiscount`**）
 * 的回归网。
 *
 * 与 `league-hall*.test.ts` / `league-apply-edit.test.ts` / `league-join-create.test.ts` 同一套五段口径：
 *
 *   A. **文案口径**（`LeagueTexts`）—— 三个面板的标题 / 提示 / 模板，逐条对 `mL.json` 的 id。
 *   B. **美术口径**（`LeagueArt`）—— P4 的图名别名、`TY_btn21` 进九宫格集合而 `TY_btn20 / TY_btn10` **不进**、
 *      置灰色板、奖励图标两支分流。
 *   C. **数据口径**（`LeagueTable`）—— `parseLeagueP4Config` / `parseUnionShopRows` /
 *      `buildLeagueStoreRowViews` / `hasLeagueStoreRedDot` / `leagueShopBuyTimesOf` /
 *      `parseUnionDiscountRows` / `buildLeagueDiscountRows` / `buildLeagueDiscountView` /
 *      `leagueDiscountPageIndex` / `formatLeagueCountdown` / `canLeagueBargain` /
 *      `canLeagueBuyBargain`。
 *   D. **prefab 结构 + 几何**（`ui/League/LeagueStore|LeagueDonate|LeagueDiscount.prefab`）
 *      —— `D1`~`D10`：脚本 cid（从 `.ts.meta` 反解，禁手抄）、全 UI_2D、顶层渲染序、
 *      每个视觉框逐条对 FGUI 原 XML、图 uuid + 九宫格 type、Label 排版、
 *      虚拟列表装配、嵌套红点实例、`@property` 逐条。
 *   E. **页面逻辑 / 调用约定**（源码文本）—— 三页的「读缓存不发列表请求」、商店的三支分叉、
 *      捐献的「广告未接入不发包」、砍价的「现价二次确认」「置灰不关交互」「定时器幂等」。
 *
 * ## 口径真源
 *
 *   - 设计：`zarts/art/UIProject/trunk/UIProject/assets/主界面_联盟/商店/组件_联盟_商店.xml`、
 *     `…/商店/组件_联盟_捐献.xml`、`…/商店/组件_联盟_砍价.xml`、`…/组件/组件_联盟_商店Item.xml`、
 *     `…/组件/按钮_商店_购买.xml`、`…/组件/按钮_联盟_广告.xml`、
 *     `共用组件/组件/按钮/按钮_公共_通用.xml`、`共用组件/组件/物品框/组件_公用_道具.xml`
 *   - 表：`assets/remoteRef/unionShop.json`（9 行）、`unionDiscount.json`（6 行）、
 *     `gameConfig.json`（`[{key,value}]`，143 行）、`roleProperty.json`（17 行）
 *   - 老端：`client/.../league/play/LayerLeagueStore.ts`、`LayerLeagueDonate.ts`、`LayerLeagueDiscount.ts`、
 *     `client/.../model/expr/RD/Client/RDLeague.ts`、`TabLeagueMain.ts`
 *   - 本项目：`assets/script/app/league/**`
 *
 * ## ⚠️ P4 里几条**刻意与直觉相反**的口径（回归点，别"顺手改对"）
 *
 *   ① **商店行按钮不关 `interactable`**：FGUI 的 `grayed` **点得动**，老端靠 click 内三支做
 *      「已售罄 / 不足」提示 ⇒ 关了交互那两条提示永远出不来（只染 `color`）。
 *   ② **商店恒关红点**：`TabLeagueMain.updateRD()` 里 `btn_shop.com_rd` 那两行是**注释掉的**，
 *      `RDLeague.OnComputeResult()` 里同一段也是注释掉的（连 `LayerLeagueStore` 里 `btn_buy.com_rd`
 *      也被注释）⇒ 入口 + 行内按钮**两处都恒关**。
 *   ③ **砍价的「金币」是 `coin`(10)，不是 `unionCoin`(11)**：`coin=10` 才是扣的钱与按钮图标；
 *      `unionCoin=11 / unionContri=13` 是**捐出去到手的奖励**。
 *   ④ **砍价的确认框填的是现价** `priceNow`（老端 `StringUtil.format(UNION_BUY_BAR_COMFORM, this.priceNow)`）。
 *   ⑤ **砍价倒计时的截止时刻 = 协议 `resetTime`（**毫秒**）+ 1 天**：服务端 `resetTime` 来自
 *      `CommonUtils.getTodayZeroTimestamp()`（`toEpochMilli()`，ms）⇒ Repository 里要 `/1000` 折成秒，
 *      页面再加 `LEAGUE_DISCOUNT_RESET_DAY_SECONDS`(86400)。少除 1000 会算成十几万小时。
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import {
    LEAGUE_ART_AD_BAR,
    LEAGUE_ART_AD_BAR_ALPHA,
    LEAGUE_ART_AD_BAR_TINT,
    LEAGUE_ART_AD_BTN,
    LEAGUE_ART_AD_VIDEO,
    LEAGUE_ART_BARGAIN_BANNER,
    LEAGUE_ART_BARGAIN_BOARD,
    LEAGUE_ART_BARGAIN_BTN,
    LEAGUE_ART_BARGAIN_BUBBLE,
    LEAGUE_ART_BARGAIN_CLOUD,
    LEAGUE_ART_BARGAIN_STRIKE_COLOR,
    LEAGUE_ART_DONATE_ITEM_BG,
    LEAGUE_ART_LEVEL_ROW_BG,
    LEAGUE_ART_POPUP_BOARD,
    LEAGUE_ART_POPUP_CLOSE,
    LEAGUE_ART_POPUP_TITLE_BG,
    LEAGUE_ART_POPUP_TITLE_DECO,
    LEAGUE_ART_SLICED,
    LEAGUE_ART_STORE_BUY_BTN,
    LEAGUE_ART_STORE_ROW_BG,
    LEAGUE_ART_STORE_ROW_TITLE_BAR,
    LEAGUE_ART_STORE_ROW_TITLE_BAR_ALPHA,
    LEAGUE_RESOURCE_ICON_ART_ROOT,
    LEAGUE_TINT_GRAY,
    LEAGUE_TINT_NORMAL,
    leagueRewardIconRef,
    leagueSpriteType,
} from '../assets/script/app/league/LeagueArt';
import {
    buildLeagueDiscountRows,
    buildLeagueDiscountView,
    buildLeagueStoreRowViews,
    canLeagueBargain,
    canLeagueBuyBargain,
    formatLeagueCountdown,
    hasLeagueStoreRedDot,
    LEAGUE_COIN_RES_ID,    LEAGUE_DISCOUNT_RESET_DAY_SECONDS,
    LEAGUE_P4_CONFIG_DEFAULTS,
    LEAGUE_P4_CONFIG_KEYS,
    LEAGUE_UNION_COIN_RES_ID,
    LEAGUE_UNION_CONTRI_RES_ID,
    LEAGUE_UNION_DISCOUNT_TABLE,
    LEAGUE_UNION_SHOP_TABLE,
    leagueDiscountPageIndex,
    leagueShopBuyTimesOf,
    parseLeagueP4Config,
    parseUnionDiscountRows,
    parseUnionShopRows,
} from '../assets/script/app/league/LeagueTable';
import {
    fillLeagueText,
    LEAGUE_DISCOUNT_BUY_CONFIRM,
    LEAGUE_DISCOUNT_BTN_BUY,
    LEAGUE_DISCOUNT_BTN_SALE,
    LEAGUE_DISCOUNT_COUNT_TEMPLATE,
    LEAGUE_DISCOUNT_HINT,
    LEAGUE_DISCOUNT_PAGES as TEXT_PAGES,
    LEAGUE_DISCOUNT_ROW_ACTION,
    LEAGUE_DISCOUNT_TIME_TEMPLATE,
    LEAGUE_DONATE_COIN_PREFIX,
    LEAGUE_DONATE_CONFIRM,
    LEAGUE_DONATE_COUNT_PREFIX,
    LEAGUE_DONATE_EXP_PREFIX,
    LEAGUE_DONATE_FREE_LABEL,
    LEAGUE_DONATE_SUCCESS,
    LEAGUE_DONATE_TITLE,
    LEAGUE_GOODS_COUNT_SEP,
    LEAGUE_STORE_LIMIT_TEMPLATE,
    LEAGUE_STORE_SOLD_OUT,
    LEAGUE_STORE_TITLE,
    LEAGUE_TIP_BUY_TIMES_LIMIT,
    LEAGUE_TIP_DISCOUNT_DONE,
    LEAGUE_TIP_DONATE_LIMIT,
    LEAGUE_TIP_NOT_ENOUGH_TEMPLATE,
} from '../assets/script/app/league/LeagueTexts';
import {
    RESOURCE_ICON_ART_ROOT,
    resolveRewardIconRef,
    ROLE_PROPERTY_ICON_ROOT_OVERRIDE,
} from '../assets/script/app/activity/LayerActivityArt';
import { parseRolePropertyRows } from '../assets/script/app/activity/LayerActivityTable';

const STORE_PAGE_TS = 'assets/script/app/league/LeagueStorePage.ts';
const REPO_TS = 'assets/script/app/league/LeagueRepository.ts';
const DONATE_PAGE_TS = 'assets/script/app/league/LeagueDonatePage.ts';
const DISCOUNT_PAGE_TS = 'assets/script/app/league/LeagueDiscountPage.ts';
const ROW_TS = 'assets/script/app/league/LeagueStoreRow.ts';
const DISCOUNT_ROW_TS = 'assets/script/app/league/LeagueDiscountRow.ts';
const TEXTS_TS = 'assets/script/app/league/LeagueTexts.ts';

const read = (path: string): string => readFileSync(path, 'utf8');
/** 去注释（`E` 段全是文本断言，注释里出现同一句话不算数）。 */
const strip = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/**
 * ⚠️ 远程表是 `{k:[列名…], v:[[值…],…]}` 的**列式**结构（`toRefRows` 要求 `k`/`v` 成对且列数匹配）。
 * 手写一个只有 `v` 的表会被判成**空表**（静默 —— 不抛、不 warn），断言就变成「全空」而不是「解析错」。
 * 这里统一走这两个常量，避免再手滑。
 */
const SHOP_KEYS = ['id', 'desc', 'rewards', 'priceType', 'cost', 'limitType', 'limitDesc', 'freeTimes', 'adTimes', 'limit'];
const DISCOUNT_KEYS = ['id', 'rewards', 'priceType', 'cost', 'minPrice'];
/** 造一张 `unionShop` 形状的列式表。 */
const shopCols = (v: unknown[][]): { k: string[]; v: unknown[][] } => ({ k: SHOP_KEYS, v });
/** 造一张 `unionDiscount` 形状的列式表。 */
const discountCols = (v: unknown[][]): { k: string[]; v: unknown[][] } => ({ k: DISCOUNT_KEYS, v });

// ============================================================
// A. 文案口径
// ============================================================

test('A1 两个弹窗标题与 FGUI `popBg` 的 title 逐字一致；砍价面板没有标题', () => {
    assert.equal(LEAGUE_STORE_TITLE, '联盟商店');
    assert.equal(LEAGUE_DONATE_TITLE, '联盟捐献');
    // 砍价面板整屏是内容、靠「点空白关闭」，既没有 popBg 也没有标题节点
    assert.ok(!strip(read(DISCOUNT_PAGE_TS)).includes('titleText'));
});

test('A2 商店：售罄提示取 `SOLD_OUT`(563)，限购模板用**半角**冒号', () => {
    assert.equal(LEAGUE_STORE_SOLD_OUT, '已售罄');
    assert.equal(LEAGUE_STORE_LIMIT_TEMPLATE, '{0}:{1}/{2}');
    assert.equal(fillLeagueText(LEAGUE_STORE_LIMIT_TEMPLATE, '每周限购', 8, 10), '每周限购:8/10');
    assert.ok(!LEAGUE_STORE_LIMIT_TEMPLATE.includes('：'), '全服 / 管理那几处用的是全角，两处故意不同');
});

test('A3 捐献：两条道具名走**语言表**前缀 + 半角 `*`，与 roleProperty 的 name 不同源', () => {
    assert.equal(LEAGUE_DONATE_COIN_PREFIX, '联盟金币');
    assert.equal(LEAGUE_DONATE_EXP_PREFIX, '联盟贡献');
    assert.equal(LEAGUE_GOODS_COUNT_SEP, '*');
    assert.equal(`${LEAGUE_DONATE_COIN_PREFIX}${LEAGUE_GOODS_COUNT_SEP}300`, '联盟金币*300');
    assert.equal(`${LEAGUE_DONATE_EXP_PREFIX}${LEAGUE_GOODS_COUNT_SEP}10`, '联盟贡献*10');
    // ⚠️ 剩余次数前缀**带全角冒号**（`REMAINING_DONATION_TIMES` 原文如此）—— 与 A2 的半角是两回事
    assert.equal(LEAGUE_DONATE_COUNT_PREFIX, '剩余捐献次数：');
    assert.ok(LEAGUE_DONATE_COUNT_PREFIX.endsWith('：'));
});

test('A4 捐献：次数用完 / 免费按钮文案，以及确认框模板（老端硬编码 10 ⇒ 本端变活）', () => {
    assert.equal(LEAGUE_TIP_DONATE_LIMIT, '今日捐献次数已用完');
    assert.equal(LEAGUE_DONATE_FREE_LABEL, '免费');
    assert.equal(LEAGUE_DONATE_CONFIRM, '是否花费{0}金币进行联盟捐献？');
    assert.equal(
        fillLeagueText(LEAGUE_DONATE_CONFIRM, 10),
        '是否花费10金币进行联盟捐献？',
        '填现网 donateCost=10 后与老端硬编码串逐字一致（这是「模板化没改变表现」的证据）',
    );
});

test('A5 砍价：三页页名、两颗按钮文案、行内静态「砍价」同字不同源', () => {
    assert.deepEqual([...TEXT_PAGES], ['砍价', '购买', '已购买']);
    assert.equal(LEAGUE_DISCOUNT_BTN_SALE, '砍价');
    assert.equal(LEAGUE_DISCOUNT_BTN_BUY, '购买');
    // 行内 `n43` 是设计稿静态文本（老端 render 从没赋过值）⇒ 与按钮文案是两个独立常量
    assert.equal(LEAGUE_DISCOUNT_ROW_ACTION, '砍价');
    assert.ok(strip(read(DISCOUNT_ROW_TS)).includes('LEAGUE_DISCOUNT_ROW_ACTION'));
});

test('A6 砍价：提示与模板逐条对 mL.json（含「新端 mL.json 已无该 key」的那条）', () => {
    assert.equal(LEAGUE_DISCOUNT_HINT, '每次砍价会随机获得金币和银币');
    assert.equal(LEAGUE_DISCOUNT_TIME_TEMPLATE, '剩余时间：{0}');
    assert.equal(LEAGUE_DISCOUNT_COUNT_TEMPLATE, '当前累计{0}人砍价');
    assert.equal(fillLeagueText(LEAGUE_DISCOUNT_COUNT_TEMPLATE, 3), '当前累计3人砍价');
    assert.equal(LEAGUE_TIP_BUY_TIMES_LIMIT, '购买次数已达上限');
    assert.equal(LEAGUE_TIP_DISCOUNT_DONE, LEAGUE_TIP_BUY_TIMES_LIMIT, '「已购买」兜底借用同一句');
    // 措辞里确实写的是「礼包」（原稿如此，不"顺手改对"）
    assert.equal(LEAGUE_DISCOUNT_BUY_CONFIRM, '是否花费{0}金币购买该礼包？');
    assert.ok(LEAGUE_DISCOUNT_BUY_CONFIRM.includes('礼包'));
    assert.equal(fillLeagueText(LEAGUE_DISCOUNT_BUY_CONFIRM, 666), '是否花费666金币购买该礼包？');
});

test('A7 货币不足是**模板**（`{0}不足`），三个面板共用同一入口', () => {
    assert.equal(LEAGUE_TIP_NOT_ENOUGH_TEMPLATE, '{0}不足');
    assert.equal(fillLeagueText(LEAGUE_TIP_NOT_ENOUGH_TEMPLATE, '金币'), '金币不足');
    assert.equal(fillLeagueText(LEAGUE_TIP_NOT_ENOUGH_TEMPLATE, ''), '不足',
        '表还没下来时退回空串 —— 不静默、也不编一个假名字');
});

// ============================================================
// B. 美术口径
// ============================================================

test('B1 商店行三件套是「同图别名」（将来单独换皮只改一处）', () => {
    assert.equal(LEAGUE_ART_STORE_ROW_BG, LEAGUE_ART_LEVEL_ROW_BG);
    assert.equal(LEAGUE_ART_STORE_ROW_BG, 'frame_Zhikuang01');
    assert.equal(LEAGUE_ART_STORE_ROW_TITLE_BAR, 'BB_img03');
    assert.equal(LEAGUE_ART_STORE_ROW_TITLE_BAR_ALPHA, 128, 'FGUI `alpha="0.5"` ⇒ 量化到 128（0.5×255=127.5）');
    assert.ok(LEAGUE_ART_SLICED.has(LEAGUE_ART_STORE_ROW_BG), 'frame_Zhikuang01 九宫格 38,28,76,56');
    // ⚠️ BB_img03（233×31 → 显示 488×32）**故意不进 SLICED**：它的 `scale9grid="58,0,116,31"`
    //    在垂直方向退化（top+bottom = 0+31 = 图高），P2 已按 SIMPLE 落地并写进
    //    `.workbuddy/memory`（LeagueInfo / LeagueLevelPreview / LeagueMgr 三处都是 `_type=0`）
    //    ⇒ 这里跟着既有口径，不单独"修"（改了会让三张已收口的 prefab 与测试对不上）。
    assert.ok(!LEAGUE_ART_SLICED.has(LEAGUE_ART_STORE_ROW_TITLE_BAR));
});

test('B2 商店的「购买」小按钮 = `TY_btn20`（SIMPLE），砍价两按钮 = `TY_btn21`（SLICED）', () => {
    assert.equal(LEAGUE_ART_STORE_BUY_BTN, 'TY_btn20');
    assert.equal(leagueSpriteType(LEAGUE_ART_STORE_BUY_BTN), 0, '包没标 scale9grid ⇒ SIMPLE');
    assert.equal(LEAGUE_ART_BARGAIN_BTN, 'TY_btn21');
    assert.equal(leagueSpriteType(LEAGUE_ART_BARGAIN_BTN), 1, 'scale9grid 56,19,112,38 ⇒ SLICED');
});

test('B3 广告按钮底 = `TY_btn10` 走 SIMPLE（垂直九宫格退化），小视频角标 = `img_video`', () => {
    assert.equal(LEAGUE_ART_AD_BTN, 'TY_btn10');
    assert.equal(leagueSpriteType(LEAGUE_ART_AD_BTN), 0,
        'top+bottom = 0+77 = 图高 ⇒ 垂直中缝为 0，硬拉会把顶边描边抻成暗带');
    assert.equal(LEAGUE_ART_AD_VIDEO, 'img_video');
    assert.equal(leagueSpriteType(LEAGUE_ART_AD_VIDEO), 0);
});

test('B4 广告按钮上的浅色条 = 「纯白图 `white_jiao8` + 染色 #666666 + alpha 0.4」', () => {
    assert.equal(LEAGUE_ART_AD_BAR, 'white_jiao8', '与创建页消耗项衬底同图');
    assert.deepEqual([...LEAGUE_ART_AD_BAR_TINT], [0x66, 0x66, 0x66]);
    assert.equal(LEAGUE_ART_AD_BAR_ALPHA, 0.4 * 255, 'FGUI `alpha="0.4"` ⇒ 102');
    assert.ok(LEAGUE_ART_SLICED.has(LEAGUE_ART_AD_BAR), '13,9,0,6 —— FGUI 标了 scale9grid');
});

test('B5 砍价大底板必须 SLICED；横幅 / 气泡 / 云按原生尺寸落 => SIMPLE', () => {
    assert.equal(LEAGUE_ART_BARGAIN_BOARD, 'frame_Dikuang01');
    assert.ok(LEAGUE_ART_SLICED.has(LEAGUE_ART_BARGAIN_BOARD), '105,124,190,344');
    // P4 只给集合 +1（`frame_Dikuang01`）：商店行底 `frame_Zhikuang01`、广告条 `white_jiao8`、
    // 砍价两按钮 `TY_btn21` 全是**复用已有成员** ⇒ 13 → 14。
    // P6 再 +4（北伐主板 / 内框 / 两块小底板 / 属性区羊皮纸）⇒ 14 → 18。
    // 绊线在 `league-hall.test.ts` B5 / `league-mgr-info.test.ts` B2。
    assert.equal(LEAGUE_ART_SLICED.size, 18);
    assert.equal(LEAGUE_ART_BARGAIN_BANNER, 'kjrw');
    assert.equal(LEAGUE_ART_BARGAIN_BUBBLE, 'lm_kj__qipao', '⚠️ 文件名是两个下划线');
    assert.ok(LEAGUE_ART_BARGAIN_BUBBLE.includes('__'));
    assert.equal(LEAGUE_ART_BARGAIN_CLOUD, 'lm_kj_pic01');
    for (const name of [LEAGUE_ART_BARGAIN_BANNER, LEAGUE_ART_BARGAIN_BUBBLE, LEAGUE_ART_BARGAIN_CLOUD]) {
        assert.equal(leagueSpriteType(name), 0, name);
    }
});

test('B6 砍价删除线取 `lineColor="#ffd84040"` 的 rgb（ARGB ⇒ d84040）', () => {
    assert.deepEqual([...LEAGUE_ART_BARGAIN_STRIKE_COLOR], [0xd8, 0x40, 0x40]);
});

test('B7 捐献道具格底框 = `frame_Zhikuang01`（与商店行同图，但独立命名）', () => {
    assert.equal(LEAGUE_ART_DONATE_ITEM_BG, 'frame_Zhikuang01');
});

test('B8 置灰色板：正常全白 / 置灰压暗到 132，透明度不动', () => {
    assert.deepEqual([...LEAGUE_TINT_NORMAL], [255, 255, 255, 255]);
    assert.deepEqual([...LEAGUE_TINT_GRAY], [132, 132, 132, 255]);
    assert.equal(LEAGUE_TINT_GRAY[3], 255, '只压暗 rgb，不动 a');
    assert.notDeepEqual([...LEAGUE_TINT_NORMAL], [...LEAGUE_TINT_GRAY]);
});

test('B9 `roleProperty` 那一支的图标目录 = `icons/resource`（FGUI 裸名，不是路径）', () => {
    assert.equal(LEAGUE_RESOURCE_ICON_ART_ROOT, 'icons/resource');
});

test('B10 `leagueRewardIconRef` 两支分流：roleProperty(裸名) / item(路径直通) / 查不到 ⇒ null', () => {
    const resources = new Map([[LEAGUE_UNION_COIN_RES_ID, { icon: '图标_联盟银币', iconIsPath: false } as never]]);
    const items = new Map([[10302, { icon: 'icons/icon_10302', iconIsPath: true } as never]]);

    const resource = leagueRewardIconRef(LEAGUE_UNION_COIN_RES_ID, items, resources);
    assert.equal(resource?.name, '图标_联盟银币');
    assert.equal(resource?.root, LEAGUE_RESOURCE_ICON_ART_ROOT,
        '只查 item 表会「奖励格没图标且不报错」—— 两支分流才是全工程唯一入口');

    const item = leagueRewardIconRef(10302, items, resources);
    // `iconIsPath=true` 支走 `resolveItemIconRef` → `splitIconPath`：把路径**拆开**（root='icons'）
    // 而不是整串透传 —— `spriteFramePath(root, name)` 时不会再拼出 `icons/icons/…`
    assert.equal(item?.root, 'icons');
    assert.equal(item?.name, 'icon_10302', 'item 表存路径 ⇒ 拆成 root/name 两段');

    assert.equal(leagueRewardIconRef(999999, items, resources), null, '查不到 ⇒ null（降级成只剩底框）');
});

test('B11 `roleProperty` 裸名图标落哪个目录：默认 `icons/resource`，例外逐条对**实盘**复算', () => {
    // `roleProperty.icon` 是 **FGUI 资源名**，名字里不含目录；老端靠 FGUI 的包查找定位，
    // 本端把图平铺到 `resources/icons|image/*` ⇒ 「这个名字当初拷进了哪个目录」只能查实盘。
    // 只认 `icons/resource` 的症状：静默加载失败（只 console.warn），奖励格 / 弹窗少一张图。
    // 实测用户报的 `[ArtIcons] 图标加载失败：icons/resource/图标_联盟贡献` 就是这一条。
    const rows = JSON.parse(readFileSync('assets/remoteRef/roleProperty.json', 'utf8')) as unknown[];
    const resources = parseRolePropertyRows(rows);

    const defaulted: string[] = [];
    const overrode: string[] = [];
    for (const [resId, info] of resources) {
        if (!info.icon) continue;
        const ref = resolveRewardIconRef(info);
        assert.ok(ref, `resId=${resId} 的 roleProperty 行必须解析得出图标`);
        const file = `assets/resources/${ref.root}/${ref.name}.png`;
        assert.ok(existsSync(file),
            `resId=${resId}（${info.name}）解析到 ${ref.root}/${ref.name}，但实盘没有 ${file}`
            + ' ⇒ 该加进 LayerActivityArt 的 `ROLE_PROPERTY_ICON_ROOT_OVERRIDE`');
        (ref.root === RESOURCE_ICON_ART_ROOT ? defaulted : overrode).push(`${resId}:${ref.root}/${ref.name}`);
    }
    // 覆盖面守卫：绝大多数（实测 8/11）走默认目录，少数例外必须显式列出来 —— 任何一侧变了都要人工确认。
    assert.equal(defaulted.length + overrode.length, 11,
        `roleProperty 有图的条目数是 11（实测），变了就要重新核对目录覆盖表。实得 ${defaulted.length + overrode.length}`);
    assert.deepEqual(overrode.sort(), [
        '13:icons/common/图标_联盟贡献',
        '14:icons/common/图标_补天神石',
        '3:image/main/resbar/图标_经验值',
    ], '例外清单变了（美术挪了目录 / 表里新增了例外）—— 同步改 ROLE_PROPERTY_ICON_ROOT_OVERRIDE');

    // 反向：覆盖表里不许有**多余**的条目（那些名字其实在 `icons/resource/` 有图 ⇒ 多余且会掩盖回归）。
    for (const name of Object.keys(ROLE_PROPERTY_ICON_ROOT_OVERRIDE)) {
        if (name === '图标_经验值') continue; // 本来就不在 icons/resource（见上面清单）
        assert.ok(!existsSync(`assets/resources/${RESOURCE_ICON_ART_ROOT}/${name}.png`),
            `${name} 在 icons/resource/ 已经有图了 ⇒ 覆盖表里这条是多余的，删掉`);
    }
});

// ============================================================
// C. 数据口径
// ============================================================

test('C1 `gameConfig` 的 P4 六个键名逐条对老端读点', () => {
    assert.deepEqual({ ...LEAGUE_P4_CONFIG_KEYS }, {
        donateCost: 'unionDonateCost',
        donateGainCoin: 'unionDonateGainCoin',
        donateGainExp: 'unionDonateGainExp',
        donateMaxCount: 'unionDonateMaxCount',
        donateAdvCount: 'unionDonateAdvCount',
        bargainBuyCount: 'unionBargainBuyCount',
    });
    assert.deepEqual({ ...LEAGUE_P4_CONFIG_DEFAULTS }, {
        donateCost: 0, donateGainCoin: 0, donateGainExp: 0,
        donateMaxCount: 0, donateAdvCount: 0, bargainBuyCount: 0,
    }, '读不到表 ⇒ 全 0（与老端 `… .value || 0` 同口径）');
});

test('C2 `parseLeagueP4Config` 吃 `[{key,value}]`，字符串数字也认，缺项落 0', () => {
    const rows = [
        { key: 'unionDonateCost', value: 10 },
        { key: 'unionDonateGainCoin', value: '300' },
        { key: 'unionDonateGainExp', value: 10 },
        { key: 'unionDonateMaxCount', value: 4 },
        { key: 'unionDonateAdvCount', value: 1 },
        { key: 'unionBargainBuyCount', value: 1 },
        { key: 'unrelated', value: 999 },
    ];
    assert.deepEqual({ ...parseLeagueP4Config(rows) }, {
        donateCost: 10, donateGainCoin: 300, donateGainExp: 10,
        donateMaxCount: 4, donateAdvCount: 1, bargainBuyCount: 1,
    });
    const partial = parseLeagueP4Config([{ key: 'unionDonateCost', value: 7 }]);
    assert.equal(partial.donateCost, 7);
    assert.equal(partial.bargainBuyCount, 0, '缺项 ⇒ 默认 0');
    assert.deepEqual({ ...parseLeagueP4Config(null) }, { ...LEAGUE_P4_CONFIG_DEFAULTS });
    assert.deepEqual({ ...parseLeagueP4Config([]) }, { ...LEAGUE_P4_CONFIG_DEFAULTS });
});

test('C3 现网 `gameConfig.json` 的 P4 六值就是页面要填的那六个', () => {
    const rows = JSON.parse(read('assets/remoteRef/gameConfig.json')) as unknown[];
    const config = parseLeagueP4Config(rows);
    assert.deepEqual({ ...config }, {
        donateCost: 10,
        donateGainCoin: 300,
        donateGainExp: 10,
        donateMaxCount: 4,
        donateAdvCount: 1,
        bargainBuyCount: 1,
    });
});

test('C4 `parseUnionShopRows` 逐列解析，**保留** limitType / freeTimes / adTimes', () => {
    const rows = parseUnionShopRows(shopCols([
        [1, '攻城令牌', [{ number: 1, resId: 10302 }], 11, 500, 2, '每周限购', 0, 0, 10],
        [8, '金钥匙', [{ number: 1, resId: 10992 }], 12, 250, 2, '每周限购', 0, 0, 10],
        [9, '银钥匙', [{ number: 1, resId: 10991 }], 12, 50, 2, '每周限购', 0, 0, 20],
    ]));
    assert.deepEqual(rows.map((r) => r.id), [1, 8, 9], '按 id 升序');
    assert.deepEqual(rows[0], {
        id: 1,
        desc: '攻城令牌',
        rewards: [{ resId: 10302, number: 1 }],
        priceType: 11,
        cost: 500,
        limitType: 2,
        limitDesc: '每周限购',
        freeTimes: 0,
        adTimes: 0,
        limit: 10,
    });
    assert.equal(rows[1].priceType, 12, '钥匙类扣的是 unionGold(12)');
});

test('C5 现网 `unionShop.json` 9 行、只用 11/12 两档货币', () => {
    const rows = parseUnionShopRows(JSON.parse(read('assets/remoteRef/unionShop.json')));
    assert.equal(rows.length, 9);
    assert.deepEqual([...new Set(rows.map((r) => r.priceType))].sort((a, b) => a - b), [11, 12]);
    assert.deepEqual([...new Set(rows.map((r) => r.limitType))].sort((a, b) => a - b), [1, 2],
        'limitType 有 1(日) / 2(周) 两档 —— 看着像没用，实际是限购语义来源，别删');
    for (const row of rows) assert.equal(row.rewards.length, 1, '每行一件奖励（老端只取 rewards[0]）');
});

test('C6 `parseUnionShopRows` 丢弃脏行、容忍 null', () => {
    const rows = parseUnionShopRows(shopCols([
        [1, 'A', [{ number: 1, resId: 100 }], 11, 10, 1, '每日限购', 0, 0, 1],
        ['x', 'B', [], 11, 10, 1, '每日限购', 0, 0, 1], // id 解析不出 ⇒ 丢
        null as unknown as unknown[],
    ]));
    assert.deepEqual(rows.map((r) => r.id), [1]);
    assert.deepEqual(parseUnionShopRows(null), []);
    assert.deepEqual(parseUnionShopRows({}), []);
    // ⚠️ `{v:[…]}` 但缺 `k` ⇒ 判成空表（静默）—— 这不是"容错"，是"列名丢了就没法解析"
    assert.deepEqual(parseUnionShopRows({ v: [[1, 'A', [], 11, 10, 1, '每日限购', 0, 0, 1]] }), []);
});

test('C7 `buildLeagueStoreRowViews`：限购文案是「剩余/上限」，soldOut / enough / canBuy 三者分开', () => {
    const rows = parseUnionShopRows(shopCols([
        [1, '攻城令牌', [{ number: 1, resId: 10302 }], 11, 500, 2, '每周限购', 0, 0, 10],
    ]));
    const view = (buyTimes: number, owned: number) => buildLeagueStoreRowViews(rows, {
        buyTimesOf: () => buyTimes,
        ownedOf: () => owned,
    })[0];

    const fresh = view(0, 500);
    assert.equal(fresh.limitText, '每周限购:10/10', '⚠️ 是 limit − buyTimes（剩余），不是已购');
    assert.equal(fresh.soldOut, false);
    assert.equal(fresh.enough, true);
    assert.equal(fresh.canBuy, true);
    assert.equal(fresh.cost, 500);
    assert.equal(fresh.priceType, 11);
    assert.equal(fresh.rewardResId, 10302);
    assert.equal(fresh.rewardNumber, 1);

    assert.equal(view(3, 1000).limitText, '每周限购:7/10');
    assert.equal(view(0, 500).enough, true, '钱刚好够算够');
    assert.equal(view(0, 499).enough, false, '差 1 也算不够');
    assert.equal(view(0, 499).canBuy, false);
    assert.equal(view(0, 499).soldOut, false, '「不够钱」不等于「售罄」');
    assert.equal(view(9, 0).soldOut, false);
    assert.equal(view(10, 99999).soldOut, true, '买满 limit ⇒ 售罄');
    assert.equal(view(10, 99999).canBuy, false);
});

test('C8 `buildLeagueStoreRowViews`：`buyTimes` 超卖时被钳到 limit（负号不上屏）', () => {
    const rows = parseUnionShopRows(shopCols([
        [1, 'A', [{ number: 1, resId: 1 }], 11, 10, 1, '每日限购', 0, 0, 3],
    ]));
    const view = buildLeagueStoreRowViews(rows, { buyTimesOf: () => 7, ownedOf: () => 999 })[0];
    assert.equal(view.limitText, '每日限购:0/3', '`limit − buyTimes` 会变 −4 ⇒ 钳到 0');
    assert.equal(view.soldOut, true);
});

test('C9 `buildLeagueStoreRowViews`：limit=0（表没配）不判售罄，剩余量压成 0（不出现负号）', () => {
    const rows = parseUnionShopRows(shopCols([
        [1, 'A', [{ number: 1, resId: 1 }], 11, 10, 1, '不限购', 0, 0, 0],
    ]));
    const view = buildLeagueStoreRowViews(rows, { buyTimesOf: () => 5, ownedOf: () => 999 })[0];
    assert.equal(view.soldOut, false, 'limit=0 ⇒ 不判售罄（否则会变成「永远售罄」）');
    assert.equal(view.limitText, '不限购:0/0', '老端这里会打出 `-5/0`，本端 max(0, …) 兜住（本函数唯一的偏离）');
});

test('C10 `buildLeagueStoreRowViews`：奖励为空时 `rewardResId/rewardNumber` 落 0', () => {
    const rows = parseUnionShopRows(shopCols([[1, 'A', [], 11, 10, 1, '每日限购', 0, 0, 1]]));
    const view = buildLeagueStoreRowViews(rows, { buyTimesOf: () => 0, ownedOf: () => 10 })[0];
    assert.equal(view.rewardResId, 0);
    assert.equal(view.rewardNumber, 0);
});

test('C11 `hasLeagueStoreRedDot` = 任意一件「买得起且没买满」就亮', () => {
    const rows = parseUnionShopRows(shopCols([
        [1, 'A', [{ number: 1, resId: 1 }], 11, 500, 1, '每日限购', 0, 0, 10], // 贵
        [2, 'B', [{ number: 1, resId: 2 }], 11, 10, 1, '每日限购', 0, 0, 10],  // 便宜
    ]));
    const build = (buyA: number, buyB: number, owned: number) => buildLeagueStoreRowViews(rows, {
        buyTimesOf: (id) => (id === 1 ? buyA : buyB),
        ownedOf: () => owned,
    });
    assert.equal(hasLeagueStoreRedDot(build(0, 0, 0)), false, '一件都买不起');
    assert.equal(hasLeagueStoreRedDot(build(0, 0, 10)), true, '第二件买得起');
    assert.equal(hasLeagueStoreRedDot(build(10, 10, 99999)), false, '都买满了');
    assert.equal(hasLeagueStoreRedDot(build(0, 10, 99999)), true, '一件没买满就亮');
    assert.equal(hasLeagueStoreRedDot([]), false);
});

test('C12 `leagueShopBuyTimesOf` 按 `id` 取已购次数，脏行 / 空值都归 0', () => {
    const goods = [{ id: 1, buyTimes: 3 }, { id: 2, buyTimes: 0 }, { id: 3 }, null, { buyTimes: 9 }];
    assert.equal(leagueShopBuyTimesOf(goods, 1), 3);
    assert.equal(leagueShopBuyTimesOf(goods, 2), 0);
    assert.equal(leagueShopBuyTimesOf(goods, 3), 0);
    assert.equal(leagueShopBuyTimesOf(goods, 9), 0, '没找到 id ⇒ 0');
    assert.equal(leagueShopBuyTimesOf(null, 1), 0);
    assert.equal(leagueShopBuyTimesOf([], 1), 0);
    assert.equal(leagueShopBuyTimesOf([{ id: 1, buyTimes: -5 }], 1), 0, '负数归 0');
});

test('C13 表名常量：`unionShop` / `unionDiscount`', () => {
    assert.equal(LEAGUE_UNION_SHOP_TABLE, 'unionShop');
    assert.equal(LEAGUE_UNION_DISCOUNT_TABLE, 'unionDiscount');
});

test('C14 `parseUnionDiscountRows`：现网 6 行、`priceType` 全是 10(金币)、每行两件奖励', () => {
    const rows = parseUnionDiscountRows(JSON.parse(read('assets/remoteRef/unionDiscount.json')));
    assert.equal(rows.length, 6);
    assert.deepEqual(rows.map((r) => r.id), [1, 2, 3, 4, 5, 6]);
    for (const row of rows) {
        assert.equal(row.priceType, 10, '砍价扣的是 `roleProperty.coin`(10)');
        assert.equal(row.rewards.length, 2, '`rewards[0]` / `rewards[1]` 两件');
        assert.ok(row.minPrice > 0);
        assert.ok(row.cost >= row.minPrice, '原价不会低于底价');
    }
    assert.deepEqual(rows[0], {
        id: 1,
        rewards: [{ resId: 10991, number: 10 }, { resId: 10992, number: 2 }],
        priceType: 10,
        cost: 1000,
        minPrice: 50,
    });
});

test('C15 `parseUnionDiscountRows` 脏行 / null', () => {
    assert.deepEqual(parseUnionDiscountRows(null), []);
    const rows = parseUnionDiscountRows(discountCols([
        [1, [], 10, 100, 10],
        ['x', [], 10, 100, 10],
        null as unknown as unknown[],
    ]));
    assert.deepEqual(rows.map((r) => r.id), [1]);
});

test('C16 `buildLeagueDiscountRows`：查不到成员的整条**丢掉**，`{0}` 填的是过滤后条数', () => {
    const info = [
        { roleId: '101', value: 30 },
        { roleId: '202', value: 20 },
        { roleId: '999', value: 50 }, // 成员表里没有 ⇒ 丢
        { roleId: '0', value: 5 },    // 空 roleId ⇒ 丢
        { roleId: '303', value: 10 },
    ];
    const names = new Map([['101', '张三'], ['202', '李四'], ['303', '王五']]);
    const rows = buildLeagueDiscountRows(info, (roleId) => names.get(roleId) ?? null);
    assert.deepEqual(rows.map((r) => r.roleId), ['101', '202', '303']);
    assert.deepEqual(rows.map((r) => r.name), ['张三', '李四', '王五']);
    assert.deepEqual(rows.map((r) => r.value), [30, 20, 10]);
    assert.equal(rows.length, 3, '列表与计数都用这个过滤后的数组');
    assert.deepEqual(buildLeagueDiscountRows(null, () => 'x'), []);
});

test('C17 `buildLeagueDiscountView`：`saleNum` 统计**全部**行（不过滤成员），现价 = max(原价 − 已砍, 底价)', () => {
    const row = { id: 1, rewards: [{ resId: 11, number: 10 }, { resId: 12, number: 2 }], priceType: 10, cost: 1000, minPrice: 50 };
    const info = [{ roleId: '101', value: 300 }, { roleId: '999', value: 100 }]; // 999 会被列表丢掉，但仍计入 saleNum
    const view = buildLeagueDiscountView(row, info, 1700000000, true, true);
    assert.ok(view);
    assert.equal(view.saleNum, 400, '⚠️ 不过滤成员（老端 updateView 就是全量求和），与列表条数刻意不同');
    assert.equal(view.price, 1000);
    assert.equal(view.priceNow, 600);
    assert.equal(view.pageIndex, 0, 'canBargain ⇒ 「砍价」页');
    assert.deepEqual(view.rewardA, { resId: 11, number: 10 });
    assert.deepEqual(view.rewardB, { resId: 12, number: 2 });
    assert.equal(view.resetTimeSec, 1700000000);
});

test('C18 `buildLeagueDiscountView`：现价有底价下限；`resetTime` 小数被截断；表空 ⇒ null', () => {
    const row = { id: 1, rewards: [], priceType: 10, cost: 1000, minPrice: 50 };
    const view = buildLeagueDiscountView(row, [{ roleId: '1', value: 99999 }], 1.9, false, true);
    assert.ok(view);
    assert.equal(view.priceNow, 50, '砍穿了也不会低于 minPrice');
    assert.equal(view.resetTimeSec, 1, '协议给的是 ms ⇒ 这一步只做 Long→number，单位折算在 Repository');
    assert.equal(view.rewardA, null, 'rewards[0] 缺 ⇒ null（页面要藏掉那一格）');
    assert.equal(view.rewardB, null);
    assert.equal(buildLeagueDiscountView(null, [], 0, true, true), null);
});

test('C19 `leagueDiscountPageIndex`：canBargain > canBuy > 已购买，页名 → 下标', () => {
    assert.equal(leagueDiscountPageIndex(true, true), 0);
    assert.equal(leagueDiscountPageIndex(true, false), 0, '能砍就优先「砍价」页');
    assert.equal(leagueDiscountPageIndex(false, true), 1);
    assert.equal(leagueDiscountPageIndex(false, false), 2, '两次都用完 ⇒ 「已购买」');
    // 页名改了要立刻红
    assert.equal(leagueDiscountPageIndex(false, true, ['x', '购买', '已购买']), 1);
    assert.equal(leagueDiscountPageIndex(true, true, ['没有这页']), 0, '页名对不上 ⇒ 兜底 0');
});

test('C20 `canLeagueBargain` / `canLeagueBuyBargain` 都只跟次数比，与钱无关', () => {
    assert.equal(canLeagueBargain(0, 1), true);
    assert.equal(canLeagueBargain(1, 1), false);
    assert.equal(canLeagueBargain(2, 1), false);
    assert.equal(canLeagueBargain(0, 0), false, '上限 0 ⇒ 一次都不能砍');
    // ⚠️ 负数在 `toCount` 里就归 0 了 ⇒ `0 < 1` 为真（不是「负数一律不可砍」那种直觉）
    assert.equal(canLeagueBargain(-3, 1), true, '负数归 0 后仍算「还能砍」');

    assert.equal(canLeagueBuyBargain(0, 1), true);
    assert.equal(canLeagueBuyBargain(1, 1), false);
    assert.equal(canLeagueBuyBargain(0, 0), false);
    assert.equal(canLeagueBuyBargain(-1, 1), true, '同 `canLeagueBargain`');
});

test('C21 `formatLeagueCountdown`：`Math.floor` 取整、`day` 前缀、<=0 钳成 00:00:00', () => {
    assert.equal(formatLeagueCountdown(0), '00:00:00');
    assert.equal(formatLeagueCountdown(-1), '00:00:00');
    assert.equal(formatLeagueCountdown(59.9), '00:00:59', 'floor，不是 ceil');
    assert.equal(formatLeagueCountdown(60), '00:01:00');
    assert.equal(formatLeagueCountdown(3600), '01:00:00');
    assert.equal(formatLeagueCountdown(86399), '23:59:59');
    assert.equal(formatLeagueCountdown(86400), '1天00:00:00');
    assert.equal(formatLeagueCountdown(86400 + 3661), '1天01:01:01');
    assert.equal(formatLeagueCountdown(NaN), '00:00:00', 'NaN 不能上屏成 NaN:NaN:NaN');
});

test('C22 砍价的重置周期是 86400 秒（老端 `S_DayTime`），且与协议单位口径写在注释里', () => {
    assert.equal(LEAGUE_DISCOUNT_RESET_DAY_SECONDS, 86400);
    const src = read('assets/script/app/league/LeagueRepository.ts');
    assert.ok(src.includes('toSecFromMs'), 'Repository 必须有 ms→秒 的折算函数');
    assert.ok(/toSecFromMs[\s\S]{0,400}?\/\s*1000/.test(src), '折算里必须真的 /1000');
});

test('C23 三个货币 resId 与老端 `roleProperty` 枚举逐字对齐', () => {
    assert.equal(LEAGUE_COIN_RES_ID, 10, 'roleProperty.coin（金币，图标_幻灵玉）—— 捐献/砍价扣的钱');
    assert.equal(LEAGUE_UNION_COIN_RES_ID, 11, 'roleProperty.unionCoin（联盟银币）—— 捐献到手的奖励');
    assert.equal(LEAGUE_UNION_CONTRI_RES_ID, 13, 'roleProperty.unionContri（联盟贡献）—— 捐献到手的奖励');
});

// ============================================================
// E. 页面逻辑 / 调用约定
// ============================================================

test('E1 三页都不发「列表请求」：读缓存（老端靠 VO 推送刷新）', () => {
    const store = strip(read(STORE_PAGE_TS));
    const donate = strip(read(DONATE_PAGE_TS));
    // 商店 / 捐献：只 load，不发任何包（买 / 捐才发）
    assert.ok(store.includes('loadStore()'));
    assert.ok(!store.includes('requestList('));
    assert.ok(donate.includes('loadDonate()'));
    assert.ok(!donate.includes('requestList('));
    // 砍价例外：老端 `initAsync` 就是三个并发请求（活动列表 + 详情 + 预载表）
    const discount = strip(read(DISCOUNT_PAGE_TS));
    assert.ok(discount.includes('requestActList(LeagueACT_TYPE.DISCOUNT'));
    assert.ok(discount.includes('requestDetail('));
    assert.ok(discount.includes('loadDiscount()'));
});

test('E2 商店的购买三分支：售罄 → 提示；不够 → `{货币名}不足`；够 → 发包', () => {
    const src = strip(read(STORE_PAGE_TS));
    assert.ok(/soldOut[\s\S]{0,200}?FW\.showTip\(LEAGUE_STORE_SOLD_OUT\)/.test(src));
    assert.ok(/!view\.enough[\s\S]{0,200}?notEnoughTip/.test(src));
    assert.ok(src.includes('buyStoreGoods(view.id'));
    // ⚠️ 不存在二次确认（老端商店是直接发包）
    assert.ok(!src.includes('CommonTips'), '商店不该弹确认框');
});

test('E2b 商店：买成功后要消费响应里的 `tlCmdGoods` ⇒ 弹「获得奖励」（老端第 4 参 showReward=true）', () => {
    const src = strip(read(REPO_TS));
    // 老端 `ModelStore.requestBuy(id, StoreType.League, false, true)` 的 `true` 就是这个开关
    assert.ok(/FW\.ShowReward\(rsp\.tlCmdGoods\)/.test(src),
        'buyStoreGoods 的响应回调里必须 FW.ShowReward（否则买成功不弹「获得奖励」）');
    // 必须把回调**真的传进** `RequestShopBuy` 的第 3 个参数：`sendWithResponse` 的 `make` 形参收到
    // `onRsp` 后原样塞进去。只 import FW、或只写一个没人引用的回调，都不算。
    assert.ok(/\(onRsp\) => new RequestShopBuy\(\{[\s\S]{0,260}?caller as any, onRsp\)/.test(src),
        '回调要作为 RequestShopBuy 的第 3 个参数传入，否则永远收不到响应');
    // 只有「真收到响应」才算 ok（沿用 GiftRepository.buyGift 的 applied 闸）
    assert.ok(
        /make: \(onRsp: \(rsp: Rsp\) => void\)/.test(src)
        && /applied = true; onResponse\(rsp\)/.test(src)
        && /return applied \? 'ok' : 'failed'/.test(src),
        '`sendWithResponse` 必须真的调用 make 传进来的回调，且只有收到响应才算 ok（超时/未连接不许当 ok）',
    );
    // 未连接就地返回 offline，别把 state 弄成 ok
    assert.ok(/if \(!net\?\.isConnected\) return 'offline'/.test(src));
    // ⚠️ 弹窗只由 repository 弹一次；页面不许再弹一遍
    assert.ok(!strip(read(STORE_PAGE_TS)).includes('FW.ShowReward'), '页面不要再弹一次，避免双弹');
});

test('E2c 砍价 / 任务领奖 / 任务进度奖 / 北伐扫荡 都已接弹窗；「看广告」是**有意不弹**', () => {    const src = strip(read(REPO_TS));
    // 老端逐条对 `ModelLeague`：`RequestTaskReward` / `RequestTaskUnionGetProgressReward` /
    // `RequestUnionActSweep` / `RequestUnionBargain` 全是 `if (rsp.ret) FW.ShowReward(rsp.tlCmdGoods)`。
    for (const request of [
        'RequestUnionBargain',
        'RequestTaskUnionGetReward',
        'RequestTaskUnionGetProgressReward',
        'RequestUnionActSweep',
    ]) {
        const at = src.indexOf(`new ${request}(`);
        assert.ok(at > 0, `${request} 的构造点必须存在`);
        const near = src.slice(at, at + 400);
        assert.ok(near.includes('FW.ShowReward') && near.includes('tlCmdGoods'),
            `${request} 的响应必须被消费并 FW.ShowReward（否则给了奖励却不弹「获得奖励」）`);
    }

    // ★ 全工程唯一的「有意不弹」：联盟任务看广告。
    //   老端 `LayerLeagueTask.ts:133` → `ModelRole.RequestWatchAdvert(AdType.unionTask, false, ref.resId)`，
    //   第 2 参 `showReward` **显式传 false** ⇒ 本端忠实照做（奖励靠任务列表刷新体现）。
    //   ⚠️ 同一条请求在别的调用点走默认 `true`（如 `HangRepository.watchAd`），所以
    //      `reward-popup-wiring` 里对它的豁免必须**只按文件**，不能整条请求豁免。
    const start = src.indexOf('async requestTaskAdvert(');
    assert.ok(start > 0, 'requestTaskAdvert 必须存在');
    const body = src.slice(start, src.indexOf('\n    }', start) + 1);
    assert.ok(body.includes('new RequestRoleWatchAdvert('), '仍然要发这个请求，只是不弹奖励');
    assert.ok(!body.includes('FW.ShowReward'),
        '老端第 2 参 `showReward=false` ⇒ 这里不许弹奖励');
});

test('E2d 捐献：响应 `ret` 为真 ⇒ 「捐献成功」提示 + 本地算出的「获得物品」窗', () => {
    const src = strip(read(REPO_TS));
    // 老端 `ModelLeague.RequestLeagueDonate`：
    //   `if (rsp.ret) { FW.showTip(FW.G_W("DONATE_SUCCESS")); this.showCommonDonateReward(adv); }`
    assert.ok(/sendWithResponse<CmdUnionDonateRspMsg>/.test(src),
        'requestDonate 必须消费响应（原来走 `this.send` 把响应整个丢掉 ⇒ 既无提示也无奖励窗）');
    assert.ok(/if \(!rsp\?\.ret\) return;/.test(src), '只有 `ret` 为真才算成功');
    assert.ok(/FW\.showTip\(LEAGUE_DONATE_SUCCESS\)/.test(src), '成功要有「捐献成功」提示');
    assert.ok(/FW\.ShowReward\(\[/.test(src), '成功要弹「获得物品」窗');
    assert.ok(src.includes('LEAGUE_UNION_COIN_RES_ID') && src.includes('LEAGUE_UNION_CONTRI_RES_ID'),
        '奖励两件 = 联盟金币(11) + 联盟贡献(13)');

    // ⚠️ `CmdUnionDonateRspMsg` **只有 `ret`**（见 Cmd.d.ts）⇒ 奖励只能本地算。
    //    老端是现读 `RefMgrgameConfig`，本端 table 取值要 await ⇒ 在 `loadDonate()` 时缓存。
    assert.ok(/this\.donateGain = \{ coin: config\.donateGainCoin, exp: config\.donateGainExp \}/.test(src),
        '`loadDonate()` 里缓存 unionDonateGainCoin / unionDonateGainExp');
    assert.ok(/private donateGain/.test(src));
    assert.ok(!/this\.send\(\(\) => new RequestUnionDonate/.test(src),
        '不许再退回把响应丢掉的老写法');

    // 文案逐字对 `mL.json` id=507
    assert.ok(read(TEXTS_TS).includes("export const LEAGUE_DONATE_SUCCESS = '捐献成功';"));
    assert.equal(LEAGUE_DONATE_SUCCESS, '捐献成功');

    // ⚠️ 弹窗 / 提示只由 repository 弹一次；页面不许再弹一遍（避免双弹）
    assert.ok(!strip(read(DONATE_PAGE_TS)).includes('FW.ShowReward'), '页面不要自己再弹奖励窗');
});

test('E3 商店行只染灰、**不关交互**（否则「已售罄 / 不足」两条提示永远出不来）', () => {
    const src = strip(read(ROW_TS));
    assert.ok(src.includes('buttonSprite.color'));
    assert.ok(!src.includes('interactable'), '一关 interactable 就再也点不动、提示也出不来');
    assert.ok(/redDot[\s\S]{0,80}?active = false/.test(src), '商店行内红点恒关（老端那两行注释掉了）');
});

test('E4 捐献：点「免费」= **先播广告**、播完才发 `requestDonate(true)`（绝不裸发）', () => {
    const src = strip(read(DONATE_PAGE_TS));
    // ⚠️ 核心守护：`RequestUnionDonate(true)` 的凭据就是「广告放完了」，必须先播后发。
    assert.ok(/playLeagueAd\(\)[\s\S]{0,220}?requestDonate\(true/.test(src), '必须播完广告再发捐献请求');
    assert.ok(/if \(!watched\)[\s\S]{0,140}?return/.test(src), '没看完广告 ⇒ 直接退出、一个包都不发');
    assert.ok(!/RequestUnionDonate/.test(src), '页面不直接构造协议对象（走 repository.requestDonate）');
    // 次数闸照老端 `onClickAdv` 保留（广告捐献上限）
    assert.ok(/todayDonateAdvTimes >= snapshot\.config\.donateAdvCount/.test(src),
        '广告捐献次数上限那道关要保留');
});

test('E5 捐献：金币按钮三道关的顺序是「次数 → 钱 → 确认」，且扣的是金币(10)', () => {
    const src = strip(read(DONATE_PAGE_TS));
    assert.ok(/!snapshot\.hasTimes[\s\S]{0,160}?LEAGUE_TIP_DONATE_LIMIT/.test(src));
    assert.ok(/!snapshot\.enough[\s\S]{0,200}?LEAGUE_TIP_NOT_ENOUGH_TEMPLATE/.test(src));
    assert.ok(/CommonTips\.open[\s\S]{0,240}?sendDonate\(false\)/.test(src));
    assert.ok(/LEAGUE_COIN_RES_ID/.test(src), '按钮图标 / 货币名都取 coin(10)');
    assert.ok(!src.includes('LEAGUE_UNION_COIN_RES_ID'), '11 是奖励，不该出现在「扣钱 / 按钮图标」处');
});

test('E6 捐献：免费按钮红点恒关（依赖未迁移的广告子系统）', () => {
    const src = strip(read(DONATE_PAGE_TS));
    assert.ok(/freeButton[\s\S]{0,200}?setRedDot\(false\)/.test(src));
});

test('E7 砍价：购买三道关 + 确认框填**现价**，砍价发 `buy=false`', () => {
    const src = strip(read(DISCOUNT_PAGE_TS));
    assert.ok(/!snapshot\.canBuy[\s\S]{0,160}?LEAGUE_TIP_BUY_TIMES_LIMIT/.test(src));
    assert.ok(/!snapshot\.enough[\s\S]{0,200}?LEAGUE_TIP_NOT_ENOUGH_TEMPLATE/.test(src));
    assert.ok(/LEAGUE_DISCOUNT_BUY_CONFIRM, view\.priceNow\)/.test(src), '⚠️ 填现价，不是原价');
    assert.ok(src.includes('sendBargain(false)'), '「砍价」= RequestUnionBargain(false)');
    assert.ok(src.includes('sendBargain(true)'), '「购买」= RequestUnionBargain(true)');
    assert.ok(src.includes('requestBargain(buy, this)'));
});

test('E8 砍价：`状态` 三页 = 两颗按钮显隐 + 购买按钮置灰（只染色、不关交互）', () => {
    const src = strip(read(DISCOUNT_PAGE_TS));
    assert.ok(/saleButton\.active = page === LEAGUE_DISCOUNT_PAGE\.bargain/.test(src));
    assert.ok(/buyButton\.active = page === LEAGUE_DISCOUNT_PAGE\.buy \|\| page === LEAGUE_DISCOUNT_PAGE\.bought/.test(src));
    assert.ok(/buyButtonBg\.color = page === LEAGUE_DISCOUNT_PAGE\.bought \? GRAY_TINT : NORMAL_TINT/.test(src));
    assert.ok(!src.includes('interactable'), 'FGUI 的 grayed 点得动 ⇒ 只染 color');
    assert.ok(src.includes('new Color(...LEAGUE_TINT_GRAY)'), '色板必须建成 cc.Color（普通对象过不了类型）');
});

test('E9 砍价：红点走共用 `RedDot` 组件，判据 = canBargain；锚点是实例**根节点**', () => {
    const src = strip(read(DISCOUNT_PAGE_TS));
    assert.ok(src.includes("import { RedDot } from '../common/RedDot'"));
    // ⚠️ 不能把 `saleRedDot` 声明成 `RedDot`：它是 `ui/common/RedDot.prefab` 的嵌套实例，
    //    跨实例边界引用**内部组件**过不了序列化（盘上会静默落成 null）⇒ 绑根节点 + 运行时取组件。
    assert.ok(/saleRedDot[\s\S]{0,60}?getComponent\(RedDot\)/.test(src));
    assert.ok(/setRedDot\(view && this\.snapshot\?\.canBargain \? 1 : 0\)/.test(src));
});

test('E10 砍价：倒计时先 unschedule 再 schedule（老端会越刷越多）', () => {
    const src = strip(read(DISCOUNT_PAGE_TS));
    assert.ok(/startCountdown[\s\S]{0,200}?stopCountdown\(\)[\s\S]{0,120}?this\.schedule\(/.test(src));
    assert.ok(src.includes('stopCountdown()'), 'onClose / onDestroy 都要停表');
    assert.ok(src.includes('onSecondTick = (): void =>'), '箭头字段 —— schedule/unschedule 靠同一函数引用配对');
    assert.ok(src.includes('LEAGUE_DISCOUNT_RESET_DAY_SECONDS'), '截止时刻 = resetTimeSec + 1 天');
});

test('E11 砍价：删除线用 cc.Graphics 画实心矩形，颜色取 `LEAGUE_ART_BARGAIN_STRIKE_COLOR`', () => {
    const src = strip(read(DISCOUNT_PAGE_TS));
    assert.ok(src.includes("import { _decorator, Button, Color, Graphics"));
    assert.ok(/graphics\.fillColor = new Color\(r, g, b, 255\)/.test(src));
    assert.ok(/graphics\.rect\(-w \/ 2, -h \/ 2, w, h\)/.test(src), '锚点 (0.5,0.5) ⇒ 局部坐标从 -w/2 起');
    assert.ok(/graphics\.fill\(\)/.test(src));
});

test('E12 砍价：行渲染**按 index 现取**（虚拟列表槽位复用），行组件无按钮', () => {
    const page = strip(read(DISCOUNT_PAGE_TS));
    assert.ok(page.includes('renderItemFn'));
    assert.ok(/renderRow\(node: Node, index: number\)[\s\S]{0,300}?this\.rows\[index\]/.test(page));
    const row = strip(read(DISCOUNT_ROW_TS));
    assert.ok(!row.includes('Button'), '这一行不可点（老端 render 里没挂任何 click）');
    assert.ok(!row.includes('.on('), '行组件不绑事件');
});

test('E13 三页的注释里都写明了各自的「有意偏离 / 增补」（可审计性）', () => {
    for (const [path, needle] of [
        [STORE_PAGE_TS, '有意增补'],
        [DONATE_PAGE_TS, '有意偏离'],
        [DISCOUNT_PAGE_TS, '有意偏离'],
    ] as const) {
        assert.ok(read(path).includes(needle), `${path} 缺「${needle}」段`);
    }
    assert.ok(read(DISCOUNT_PAGE_TS).includes('没有 `popBg`、也没有关闭按钮'), '砍价面板靠点空白关闭');
});

test('E14 三页都实现 PopupBase 的三件套（onInit 绑一次 / onOpen 取数 / onClose 作废在飞异步）', () => {
    for (const path of [STORE_PAGE_TS, DONATE_PAGE_TS, DISCOUNT_PAGE_TS]) {
        const src = strip(read(path));
        assert.ok(src.includes('protected onInit(): void'));
        assert.ok(src.includes('protected async onOpen(): Promise<void>'));
        assert.ok(/protected onClose\(\)[\s\S]{0,120}?this\.revision \+= 1/.test(src));
        assert.ok(src.includes('static prefabPath = '), path);
    }
});

// ============================================================
// D. prefab 结构 + 几何
// ============================================================

const STORE_PREFAB = 'assets/resources/ui/League/LeagueStore.prefab';
const DONATE_PREFAB = 'assets/resources/ui/League/LeagueDonate.prefab';
const DISCOUNT_PREFAB = 'assets/resources/ui/League/LeagueDiscount.prefab';
const REWARD_SLOT_TS = 'assets/script/app/league/LeagueRewardSlot.ts';
const AD_BTN_TS = 'assets/script/app/league/LeagueAdButton.ts';
const VSCROLL_TS = 'assets/script/vscrollview/VScrollView.ts';

const UI_2D = 33554432;
/** `ui/common/RedDot.prefab` 的 uuid（三张面板里的红点全是它的嵌套实例）。 */
const RED_DOT_PREFAB_UUID = '1ac30828-4947-4428-a114-b89c4e7d6494';

type Entry = Record<string, unknown>;

/**
 * 图 uuid 表（图名 → `spriteFrame` 的 uuid = `<顶层 uuid>@f9941`）。
 *
 * ⚠️ **写死在这里**：换图 / 改名 / 挪目录都必须显式改这张表 —— 不能从 `LeagueArt` 反查，
 *    否则「图名改了、表也改了、prefab 忘了重导」这类错会被测试放过去。
 */
const U: Readonly<Record<string, string>> = {
    panel_window_01_9gong: 'a295d231-ef9a-4bea-9818-0e0d85794ef0@f9941',
    title_01: 'de242388-9444-451f-adff-78fe5a73e20d@f9941',
    title_02: 'a957fd35-0792-4a27-9de3-85a44274a5d0@f9941',
    btn_close: 'ca6d0ca8-3ed8-4009-963d-d845eb296872@f9941',
    frame_Zhikuang01: 'dac21f1f-62e9-4f7c-98c9-8125b51c0f49@f9941',
    BB_img03: 'e7dd22cc-dc8b-4cb8-92b1-b1c6ac085db3@f9941',
    TY_btn20: '55afd73b-2bfd-43fa-b91a-9e5b2a6b2751@f9941',
    TY_btn10: 'c482418e-efac-46f8-9753-eebf8be436af@f9941',
    white_jiao8: 'b456d791-97f9-40ae-ada5-05ca902ef521@f9941',
    img_video: 'f0d043bc-41c1-458a-b790-dc36ae3108b0@f9941',
    common_img_pzk_01: '0f3d4145-0e38-4010-9a5a-b72eb2ad483b@f9941',
    frame_Dikuang01: 'a1a88366-a302-4c89-ad7e-fb523f21634d@f9941',
    kjrw: '7338e134-64f3-4f51-9670-142dcc418842@f9941',
    lm_kj__qipao: '936e14e9-3bd9-479b-9fa2-49321e057bab@f9941',
    lm_kj_pic01: '9bc996ba-6713-44d5-9958-ce2894642df3@f9941',
    TY_btn21: '1ee1fc53-a798-4b98-b385-96985db1348f@f9941',
};

/** `.ts.meta` 的 uuid → 压缩 cid（= 脚本组件的 `__type__`）。**禁手抄 cid**。 */
function compressUuid(uuid: string): string {
    const KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const hex = uuid.replace(/-/g, '');
    let out = hex.slice(0, 5);
    for (let i = 5; i < 32; i += 3) {
        const v = parseInt(hex.slice(i, i + 3), 16);
        out += KEYS[v >> 6] + KEYS[v & 63];
    }
    return out;
}
const cidOf = (tsPath: string): string =>
    compressUuid((JSON.parse(readFileSync(`${tsPath}.meta`, 'utf8')) as { uuid: string }).uuid);

const near = (a: number, b: number, eps = 0.05): boolean => Math.abs(a - b) <= eps;

interface Box {
    path: string;
    node: Entry;
    /** 本地坐标（已把嵌套实例的 `propertyOverrides._lpos` 折算进来）。 */
    x: number;
    y: number;
    /** `cc.UITransform._contentSize`（本地，不含父级缩放）。 */
    w: number;
    h: number;
    ax: number;
    ay: number;
    sx: number;
    sy: number;
    /** 是嵌套 prefab 实例时的 `cc.PrefabInfo`，否则 `null`。 */
    info: Entry | null;
    overrides: ReadonlyMap<string, unknown>;
}

interface NestInstance {
    shell: Box;
    uuid: string;
    overrides: ReadonlyMap<string, unknown>;
    mounted: readonly unknown[];
}

interface PrefabDoc {
    all: Entry[];
    nodes: Entry[];
    rootName: string;
    /** 相对根的节点路径 → 视觉框。 */
    P: (p: string) => Box | undefined;
    comp: (p: string, type: string) => Entry | null;
    /** `{"__id__":n}`（节点或组件都行）→ 完整节点路径。 */
    refPath: (ref: unknown) => string | null;
    customCids: string[];
    instances: NestInstance[];
}

/**
 * 读一张 prefab 的盘上 JSON，反解「节点路径 → 本地几何 + 组件」。
 *
 * ⚠️ **嵌套 prefab 实例的字段在 `propertyOverrides` 里，不在壳节点上**：
 *    盘上壳节点的 `_lpos` / `_lscale` / `_name` / `_active` 全是 `undefined`，
 *    真值挂在 `cc.PrefabInfo.instance.propertyOverrides[]` 的
 *    `CCPropertyOverrideInfo{ propertyPath:['_lpos'], value }`。不叠回去会把
 *    `BtnSale/RedDot` 读成 `pos(0,0) / active undefined`（误判成「没写位置、默认亮」）。
 */
function openPrefab(path: string): PrefabDoc {
    const all = JSON.parse(readFileSync(path, 'utf8')) as Entry[];
    const at = (ref: unknown): Entry | null =>
        ref && typeof ref === 'object' && '__id__' in (ref as Entry)
            ? all[(ref as { __id__: number }).__id__]! : null;
    const nodes = all.filter((e) => e && e.__type__ === 'cc.Node');
    const root = nodes[0]!;
    const rootName = String(root._name);
    const byPath = new Map<string, Box>();
    const idxPath = new Map<number, string>();
    const instances: NestInstance[] = [];

    /** 节点名 —— 嵌套实例壳节点的 `_name` 是 `undefined`，真名在 overrides 里。 */
    const nameOf = (node: Entry): string => {
        const info = at(node._prefab);
        const inst = at(info?.instance);
        for (const ref of ((inst?.propertyOverrides ?? []) as unknown[])) {
            const ov = at(ref);
            if ((ov?.propertyPath as unknown[] | undefined)?.[0] === '_name') return String(ov!.value);
        }
        return String(node._name ?? '');
    };

    const walk = (node: Entry, p: string, pCx: number, pCy: number, pSx: number, pSy: number): void => {
        const info = at(node._prefab);
        const inst = at(info?.instance);
        const overrides = new Map<string, unknown>();
        for (const ref of ((inst?.propertyOverrides ?? []) as unknown[])) {
            const ov = at(ref);
            const key = (ov?.propertyPath as unknown[] | undefined)?.[0];
            if (typeof key === 'string') overrides.set(key, ov!.value);
        }
        const isInstance = overrides.size > 0 && !!(info?.asset as { __uuid__?: string } | undefined)?.__uuid__;
        const pos = (overrides.get('_lpos') ?? node._lpos ?? { x: 0, y: 0 }) as { x: number; y: number };
        const sc = (overrides.get('_lscale') ?? node._lscale ?? { x: 1, y: 1 }) as { x: number; y: number };
        const name = String(overrides.get('_name') ?? node._name ?? '');
        const comps = ((node._components ?? []) as unknown[]).map(at);
        const uit = comps.find((c) => c?.__type__ === 'cc.UITransform');
        const size = (uit?._contentSize ?? { width: 0, height: 0 }) as { width: number; height: number };
        const anchor = (uit?._anchorPoint ?? { x: 0.5, y: 0.5 }) as { x: number; y: number };
        const cx = pCx + pos.x * pSx;
        const cy = pCy - pos.y * pSy;
        const sx = pSx * (sc.x ?? 1);
        const sy = pSy * (sc.y ?? 1);
        const box: Box = {
            path: p, node, x: pos.x ?? 0, y: pos.y ?? 0,
            w: size.width ?? 0, h: size.height ?? 0,
            ax: anchor.x ?? 0.5, ay: anchor.y ?? 0.5,
            sx: sc.x ?? 1, sy: sc.y ?? 1,
            info: isInstance ? info : null, overrides,
        };
        byPath.set(p, box);
        idxPath.set(all.indexOf(node), p);
        if (isInstance) {
            instances.push({
                shell: box,
                uuid: String((info!.asset as { __uuid__?: string }).__uuid__ ?? ''),
                overrides,
                mounted: (inst?.mountedChildren ?? []) as unknown[],
            });
        }
        for (const child of ((node._children ?? []) as unknown[])) {
            const c = at(child);
            if (c) walk(c, `${p}/${nameOf(c)}`, cx, cy, sx, sy);
        }
    };
    walk(root, rootName, 360, 640, 1, 1);

    const P = (p: string): Box | undefined => byPath.get(p === '' ? rootName : `${rootName}/${p}`);
    const comp = (p: string, type: string): Entry | null =>
        (((P(p)?.node._components ?? []) as unknown[]).map(at)
            .find((c) => c?.__type__ === type) ?? null);
    const refPath = (ref: unknown): string | null => {
        if (!ref || typeof ref !== 'object' || !('__id__' in (ref as Entry))) return null;
        const t = at(ref);
        if (!t) return null;
        if (t.__type__ === 'cc.Node') return idxPath.get((ref as { __id__: number }).__id__) ?? null;
        const owner = at(t.node);
        return owner ? idxPath.get((t.node as { __id__: number }).__id__) ?? null : null;
    };
    const customCids = [...new Set(all.map((e) => e?.__type__)
        .filter((t) => t && !/^(cc\.|sp\.|CC)/.test(String(t))))] as string[];
    return { all, nodes, rootName, P, comp, refPath, customCids, instances };
}

const store = openPrefab(STORE_PREFAB);
const donate = openPrefab(DONATE_PREFAB);
const discount = openPrefab(DISCOUNT_PREFAB);

/** `[path, art]`；`art: null` = 运行时才填的空图槽。 */
type SpriteRow = readonly [string, string | null];

function assertSprites(doc: PrefabDoc, rows: readonly SpriteRow[], tag: string): void {
    for (const [p, art] of rows) {
        const sp = doc.comp(p, 'cc.Sprite');
        assert.ok(sp, `${tag}：${p} 上没有 cc.Sprite`);
        const uuid = (sp!._spriteFrame as { __uuid__?: string } | null)?.__uuid__ ?? null;
        if (art === null) {
            assert.equal(uuid, null, `${tag}：${p} 是运行时图槽，prefab 里必须留空`);
            assert.equal(sp!._type, 0, `${tag}：${p} 空图槽 type 应为 SIMPLE`);
        } else {
            assert.equal(uuid, U[art], `${tag}：${p} 的图应为「${art}」（${U[art]}）`);
            assert.equal(sp!._type, leagueSpriteType(art),
                `${tag}：${p} 的九宫格 type 必须跟随 LEAGUE_ART_SLICED（${art}）`);
        }
    }
}

interface BoxRow {
    p: string; x: number; y: number;
    w?: number; h?: number;
    sx?: number; sy?: number;
    ax?: number; ay?: number;
}

function assertBoxes(doc: PrefabDoc, rows: readonly BoxRow[], tag: string): void {
    for (const r of rows) {
        const box = doc.P(r.p);
        assert.ok(box, `${tag}：缺节点 ${r.p}`);
        assert.ok(near(box!.x, r.x) && near(box!.y, r.y),
            `${tag}/${r.p} 位置应为 (${r.x}, ${r.y})，实得 (${box!.x}, ${box!.y})`);
        if (r.w !== undefined) assert.ok(near(box!.w, r.w), `${tag}/${r.p} 宽应为 ${r.w}，实得 ${box!.w}`);
        if (r.h !== undefined) assert.ok(near(box!.h, r.h), `${tag}/${r.p} 高应为 ${r.h}，实得 ${box!.h}`);
        if (r.sx !== undefined) {
            assert.ok(near(box!.sx, r.sx) && near(box!.sy, r.sy ?? r.sx),
                `${tag}/${r.p} scale 应为 ${r.sx}，实得 (${box!.sx}, ${box!.sy})`);
        }
        if (r.ax !== undefined) {
            assert.ok(near(box!.ax, r.ax) && near(box!.ay, r.ay ?? 0.5),
                `${tag}/${r.p} anchor 应为 (${r.ax}, ${r.ay ?? 0.5})，实得 (${box!.ax}, ${box!.ay})`);
        }
    }
}

interface LabelRow {
    p: string; text: string; size: number;
    color: readonly [number, number, number];
    /** `_horizontalAlign`：0 左 / 1 中 / 2 右（FGUI 的 `align`）。 */
    align: number;
    /** `_verticalAlign`：0 上 / 1 中 / 2 下（FGUI 的 `vAlign`）。 */
    vAlign: number;
    outline?: number;
}

function assertLabels(doc: PrefabDoc, rows: readonly LabelRow[], tag: string): void {
    for (const r of rows) {
        const lb = doc.comp(r.p, 'cc.Label');
        assert.ok(lb, `${tag}：${r.p} 上没有 cc.Label`);
        assert.equal(lb!._string, r.text, `${tag}/${r.p} 文案应为「${r.text}」`);
        assert.equal(lb!._fontSize, r.size, `${tag}/${r.p} 字号应为 ${r.size}`);
        assert.equal(lb!._horizontalAlign, r.align, `${tag}/${r.p} 水平对齐应为 ${r.align}`);
        assert.equal(lb!._verticalAlign, r.vAlign, `${tag}/${r.p} 垂直对齐应为 ${r.vAlign}`);
        const c = lb!._color as { r: number; g: number; b: number };
        assert.deepEqual([c.r, c.g, c.b], [...r.color], `${tag}/${r.p} 颜色应为 #${r.color.map((v) => v.toString(16).padStart(2, '0')).join('')}`);
        // ⚠️ 要看 `_enableOutline`：关掉的描边 `_outlineWidth` 还留着上一次的值（FGUI 的默认 2）
        const outline = lb!._enableOutline ? (lb!._outlineWidth ?? 0) : 0;
        assert.equal(outline, r.outline ?? 0, `${tag}/${r.p} 描边宽度应为 ${r.outline ?? 0}（0 = 不描边）`);
    }
}

/** 逐条对 `@property`：`[属性名, 目标节点路径（相对根）]`。 */
function assertBinds(
    doc: PrefabDoc, tsPath: string, nodePath: string,
    binds: readonly (readonly [string, string])[], tag: string,
): void {
    const c = doc.comp(nodePath, cidOf(tsPath));
    assert.ok(c, `${tag}：${nodePath} 上没有 ${tsPath}`);
    for (const [prop, want] of binds) {
        assert.equal(doc.refPath(c![prop]), `${doc.rootName}/${want}`,
            `${tag}：${tsPath.split('/').pop()}.${prop} 应绑到 ${want}`);
    }
}

test('D1 三张 prefab + 六个新脚本（都带 `.meta`）在磁盘上', () => {
    for (const p of [STORE_PREFAB, DONATE_PREFAB, DISCOUNT_PREFAB]) {
        assert.ok(existsSync(p), `缺 prefab：${p}`);
        assert.ok(existsSync(`${p}.meta`), `缺 meta：${p}.meta`);
    }
    for (const ts of [STORE_PAGE_TS, ROW_TS, DONATE_PAGE_TS, DISCOUNT_PAGE_TS, DISCOUNT_ROW_TS,
        REWARD_SLOT_TS, AD_BTN_TS, VSCROLL_TS]) {
        assert.ok(existsSync(ts), `缺脚本：${ts}`);
        assert.ok(existsSync(`${ts}.meta`), `缺 .ts.meta：${ts}.meta（编辑器不会给未 refresh 的新 .ts 生成）`);
    }
});

test('D2 节点数 = 根 + 子（重跑生成器忘了先清空的话，这里会翻倍）', () => {
    assert.equal(store.rootName, 'LeagueStore');
    assert.equal(donate.rootName, 'LeagueDonate');
    assert.equal(discount.rootName, 'LeagueDiscount');
    assert.equal(store.nodes.length, 19, `联盟商店应为 19（18 + 根），实得 ${store.nodes.length}`);
    assert.equal(donate.nodes.length, 35, `联盟捐献应为 35（34 + 根），实得 ${donate.nodes.length}`);
    assert.equal(discount.nodes.length, 33, `每日砍价应为 33（32 + 根），实得 ${discount.nodes.length}`);
});

test('D3 ⚠️ 所有节点 `_layer` 都是 UI_2D（落 DEFAULT 会让整棵子树不渲染且不报错）', () => {
    for (const [tag, doc] of [['商店', store], ['捐献', donate], ['砍价', discount]] as const) {
        // 嵌套实例的壳节点盘上没有 `_layer`（层级随源 prefab）⇒ 只查真正序列化在本文件里的节点
        const shells = new Set(doc.instances.map((i) => i.shell.node));
        const bad = [...new Set(doc.nodes.filter((n) => !shells.has(n)).map((n) => n._layer))]
            .filter((l) => l !== UI_2D);
        assert.deepEqual(bad, [], `${tag} 有非 UI_2D 的层：${bad.join(',')}`);
    }
});

test('D4 根上只挂本页脚本；脚本 cid 集合恰好等于预期（反查 `.ts.meta`，禁手抄）', () => {
    for (const [tag, doc, own, extra] of [
        ['商店', store, STORE_PAGE_TS, [ROW_TS, REWARD_SLOT_TS, VSCROLL_TS]],
        ['捐献', donate, DONATE_PAGE_TS, [AD_BTN_TS, REWARD_SLOT_TS]],
        ['砍价', discount, DISCOUNT_PAGE_TS, [DISCOUNT_ROW_TS, REWARD_SLOT_TS, VSCROLL_TS]],
    ] as const) {
        assert.ok(doc.comp('', cidOf(own)), `${tag}：${own} 必须挂在根节点上`);
        const want = [own, ...extra].map(cidOf).sort();
        assert.deepEqual([...doc.customCids].sort(), want, `${tag} 的自定义脚本集合不符`);
    }
});

test('D5 顶层渲染序（底 → 顶；砍价的 Strike 必须压在两行价格之上）', () => {
    const names = (doc: PrefabDoc): string[] =>
        ((doc.nodes[0]!._children ?? []) as unknown[]).map((c) => String((doc.all[(c as { __id__: number }).__id__]!)._name));
    assert.deepEqual(names(store),
        ['PopupBg', 'TitleBg', 'TitleDeco', 'Title', 'CloseBtn', 'StoreListView']);
    assert.deepEqual(names(donate),
        ['PopupBg', 'TitleBg', 'TitleDeco', 'Title', 'CloseBtn',
            'ItemCoin', 'ItemExp', 'LabCount', 'BtnFree', 'BtnBuy']);
    assert.deepEqual(names(discount),
        ['Banner', 'Board', 'Bubble', 'RewardB', 'Cloud', 'PriceIcon', 'BtnSale', 'BtnBuy', 'RewardA',
            'LabEndTime', 'Hint', 'LabUserCount', 'DiscountListView', 'LabPrice', 'LabPriceNow', 'Strike']);
    const d = names(discount);
    assert.ok(d.indexOf('Strike') > d.indexOf('LabPrice') && d.indexOf('Strike') > d.indexOf('LabPriceNow'),
        'Strike 是删除线，必须排在两行价格之后才压得住');
});

test('D6 ⚠️ 砍价面板没有 `popBg`、也没有关闭按钮（整屏内容 + 点空白关闭）', () => {
    assert.ok(!discount.P('PopupBg'), '砍价没有公共弹窗底板');
    assert.ok(!discount.P('CloseBtn'), '砍价没有关闭按钮');
    assert.ok(!discount.P('TitleBg') && !discount.P('Title'), '砍价没有标题骨架');
    // 另外两张相反：都有完整骨架（`组件_公共弹窗_新` 640×567 / 640×820）
    for (const [tag, doc] of [['商店', store], ['捐献', donate]] as const) {
        assert.ok(doc.P('PopupBg') && doc.P('TitleBg') && doc.P('Title') && doc.P('CloseBtn'), `${tag} 缺弹窗骨架`);
    }
    assert.equal(store.P('PopupBg')!.w, 640);
    assert.equal(store.P('PopupBg')!.h, 820);
    assert.equal(donate.P('PopupBg')!.w, 640);
    assert.equal(donate.P('PopupBg')!.h, 567);
});

test('D7 视觉框逐条对 FGUI 原 XML（pos = 子中心 − 画布中心 (360,640)）', () => {
    assertBoxes(store, [
        { p: 'PopupBg', x: 4, y: 57, w: 640, h: 820 },
        { p: 'TitleBg', x: 4, y: 454.5, w: 601, h: 66 },
        { p: 'TitleDeco', x: 4, y: 454.5, w: 253, h: 44 },
        { p: 'Title', x: 4, y: 457, w: 240, h: 42 },
        { p: 'CloseBtn', x: 292, y: 457, w: 54, h: 51 },
        { p: 'StoreListView', x: -5, y: 414, w: 550, h: 715, ax: 0.5, ay: 1 },
        { p: 'StoreListView/content', x: 0, y: 0, w: 550, h: 715, ax: 0.5, ay: 1 },
        { p: 'StoreListView/content/StoreRow', x: 0, y: -71, w: 556, h: 142 },
        { p: 'StoreListView/content/StoreRow/TitleBar', x: -3, y: 40, w: 488, h: 32 },
        { p: 'StoreListView/content/StoreRow/Name', x: -11, y: 39, w: 368, h: 36 },
        { p: 'StoreListView/content/StoreRow/Reward', x: -204.8, y: -19.2, w: 62, h: 62, sx: 1.2 },
        { p: 'StoreListView/content/StoreRow/Reward/Icon', x: 0, y: 0, w: 62, h: 62, sx: 0.8 },
        { p: 'StoreListView/content/StoreRow/Reward/Count', x: 30.4, y: -52, ax: 1, ay: 0.5 },
        { p: 'StoreListView/content/StoreRow/Count', x: 116, y: 6, w: 262, h: 32 },
        { p: 'StoreListView/content/StoreRow/BuyBtn', x: 191.5, y: -25, w: 121, h: 42 },
        { p: 'StoreListView/content/StoreRow/BuyBtn/Label', x: 27, y: -1, w: 55, h: 42 },
        { p: 'StoreListView/content/StoreRow/BuyBtn/PriceIcon', x: -27.5, y: 1, w: 40, h: 40 },
        { p: 'StoreListView/content/StoreRow/BuyBtn/RedDot', x: 84.5, y: 6 },
    ], '商店');

    const item = (n: string): BoxRow[] => [
        { p: `Item${n}`, x: n === 'Coin' ? -137 : 135, y: 94, w: 270, h: 180 },
        { p: `Item${n}/ItemBg`, x: 0, y: 0, w: 270, h: 180 },
        { p: `Item${n}/Reward`, x: -10, y: 33, w: 100, h: 100, sx: 0.9 },
        { p: `Item${n}/Reward/Icon`, x: 0, y: 0, w: 100, h: 100, sx: 0.8 },
        { p: `Item${n}/Reward/Count`, x: 49, y: -33, ax: 1, ay: 0.5 },
        { p: `Item${n}/Name`, x: 0, y: -52.5, w: 168, h: 29 },
    ];
    const adBtn = (n: string): BoxRow[] => [
        { p: n, x: n === 'BtnFree' ? -131 : 137, y: -140, w: 240, h: 110 },
        { p: `${n}/Bg`, x: 0, y: 0, w: 240, h: 110 },
        { p: `${n}/FreeBar`, x: -0.5, y: 29, w: 213, h: 30 },
        { p: `${n}/FreeLabel`, x: 0, y: -8.5, w: 168, h: 39 },
        { p: `${n}/FreeVideo`, x: -0.5, y: 29, w: 39, h: 28 },
        { p: `${n}/CostLabel`, x: 39.5, y: 11, w: 103, h: 46 },
        { p: `${n}/CostIcon`, x: -53, y: 10, w: 50, h: 50 },
        { p: `${n}/RedDot`, x: 105, y: 40 },
    ];
    assertBoxes(donate, [
        { p: 'PopupBg', x: 0, y: 0.5, w: 640, h: 567 },
        { p: 'TitleBg', x: 0, y: 271.5, w: 601, h: 66 },
        { p: 'TitleDeco', x: 0, y: 271.5, w: 253, h: 44 },
        { p: 'Title', x: 0, y: 274, w: 240, h: 42 },
        { p: 'CloseBtn', x: 288, y: 274, w: 54, h: 51 },
        ...item('Coin'), ...item('Exp'),
        { p: 'LabCount', x: -0.5, y: -45, w: 315, h: 36 },
        ...adBtn('BtnFree'), ...adBtn('BtnBuy'),
    ], '捐献');

    const reward = (n: string): BoxRow[] => [
        { p: n, x: n === 'RewardA' ? -65 : 51, y: 170, w: 100, h: 100, sx: 0.8 },
        { p: `${n}/Icon`, x: 0, y: 0, w: 100, h: 100, sx: 0.8 },
        { p: `${n}/Count`, x: 49, y: -33, ax: 1, ay: 0.5 },
    ];
    const bargainBtn = (n: string): BoxRow[] => [
        { p: n, x: n === 'BtnSale' ? 0 : 3, y: n === 'BtnSale' ? -439.5 : -440.5, w: 230, h: 77 },
        { p: `${n}/Bg`, x: 0, y: 0, w: 230, h: 77 },
        { p: `${n}/Label`, x: 0, y: -1, w: 230, h: 66 },
        { p: `${n}/RedDot`, x: 100, y: 23.5 },
    ];
    assertBoxes(discount, [
        { p: 'Banner', x: -6, y: 330.5, w: 446, h: 549 },
        { p: 'Board', x: -6.5, y: -46.5, w: 581, h: 533 },
        { p: 'Bubble', x: 205.5, y: 521.5, w: 241, h: 141 },
        ...reward('RewardB'),
        { p: 'Cloud', x: 120.5, y: 55.5, w: 137, h: 87 },
        { p: 'PriceIcon', x: -67, y: 53, w: 100, h: 100, sx: 0.6 },
        ...bargainBtn('BtnSale'), ...bargainBtn('BtnBuy'), ...reward('RewardA'),
        { p: 'LabEndTime', x: -2, y: -354, w: 374, h: 36 },
        { p: 'Hint', x: 1, y: -258, w: 376, h: 36 },
        { p: 'LabUserCount', x: 0, y: 0, w: 452, h: 36 },
        { p: 'DiscountListView', x: 1, y: -32, w: 390, h: 200, ax: 0.5, ay: 1 },
        { p: 'DiscountListView/content', x: 0, y: 0, w: 390, h: 200, ax: 0.5, ay: 1 },
        { p: 'DiscountListView/content/DiscountRow', x: 0, y: -17, w: 390, h: 34 },
        { p: 'DiscountListView/content/DiscountRow/Who', x: -44, y: 0, w: 206, h: 34 },
        { p: 'DiscountListView/content/DiscountRow/Price', x: 156.5, y: 0, w: 59, h: 34 },
        { p: 'DiscountListView/content/DiscountRow/Action', x: 63, y: 0, w: 54, h: 34 },
        { p: 'DiscountListView/content/DiscountRow/Icon', x: 106, y: 0, w: 34, h: 34 },
        { p: 'LabPrice', x: 13, y: 56, w: 104, h: 46 },
        { p: 'LabPriceNow', x: 121, y: 61, w: 78, h: 42 },
        { p: 'Strike', x: 7, y: 50.5, w: 100, h: 3 },
    ], '砍价');
});

test('D8 图 uuid + 九宫格 type 逐条（空图槽必须留空、由页面按 resId 填）', () => {
    const popup: SpriteRow[] = [
        ['PopupBg', LEAGUE_ART_POPUP_BOARD],
        ['TitleBg', LEAGUE_ART_POPUP_TITLE_BG],
        ['TitleDeco', LEAGUE_ART_POPUP_TITLE_DECO],
        ['CloseBtn', LEAGUE_ART_POPUP_CLOSE],
    ];
    assertSprites(store, [
        ...popup,
        ['StoreListView/content/StoreRow', LEAGUE_ART_STORE_ROW_BG],
        ['StoreListView/content/StoreRow/TitleBar', LEAGUE_ART_STORE_ROW_TITLE_BAR],
        ['StoreListView/content/StoreRow/Reward', 'common_img_pzk_01'],
        ['StoreListView/content/StoreRow/Reward/Icon', null],
        ['StoreListView/content/StoreRow/BuyBtn', LEAGUE_ART_STORE_BUY_BTN],
        ['StoreListView/content/StoreRow/BuyBtn/PriceIcon', null],
    ], '商店');

    const adSprites = (n: string): SpriteRow[] => [
        [`${n}/Bg`, LEAGUE_ART_AD_BTN],
        [`${n}/FreeBar`, LEAGUE_ART_AD_BAR],
        [`${n}/FreeVideo`, LEAGUE_ART_AD_VIDEO],
        [`${n}/CostIcon`, null],
    ];
    assertSprites(donate, [
        ...popup,
        ['ItemCoin/ItemBg', LEAGUE_ART_DONATE_ITEM_BG],
        ['ItemCoin/Reward', 'common_img_pzk_01'],
        ['ItemCoin/Reward/Icon', null],
        ['ItemExp/ItemBg', LEAGUE_ART_DONATE_ITEM_BG],
        ['ItemExp/Reward', 'common_img_pzk_01'],
        ['ItemExp/Reward/Icon', null],
        ...adSprites('BtnFree'), ...adSprites('BtnBuy'),
    ], '捐献');

    assertSprites(discount, [
        ['Banner', LEAGUE_ART_BARGAIN_BANNER],
        ['Board', LEAGUE_ART_BARGAIN_BOARD],
        ['Bubble', LEAGUE_ART_BARGAIN_BUBBLE],
        ['RewardB', 'common_img_pzk_01'],
        ['RewardB/Icon', null],
        ['Cloud', LEAGUE_ART_BARGAIN_CLOUD],
        ['PriceIcon', null],
        ['BtnSale/Bg', LEAGUE_ART_BARGAIN_BTN],
        ['BtnBuy/Bg', LEAGUE_ART_BARGAIN_BTN],
        ['RewardA', 'common_img_pzk_01'],
        ['RewardA/Icon', null],
        ['DiscountListView/content/DiscountRow/Icon', null],
    ], '砍价');
    // 两颗按钮底**同图**（`TY_btn21`，九宫格 56,19,112,38）
    assert.equal(LEAGUE_ART_BARGAIN_BTN, 'TY_btn21');
});

test('D9 Label 文案 / 字号 / 颜色 / 对齐 / 描边逐条对 FGUI', () => {
    const title = (text: string): LabelRow[] => [{
        p: 'Title', text, size: 30, color: [255, 246, 196], align: 1, vAlign: 1, outline: 3,
    }];
    assertLabels(store, [
        ...title(LEAGUE_STORE_TITLE),
        { p: 'StoreListView/content/StoreRow/Name', text: '联盟商店', size: 26, color: [231, 217, 190], align: 1, vAlign: 1, outline: 2 },
        { p: 'StoreListView/content/StoreRow/Reward/Count', text: '1', size: 24, color: [255, 255, 255], align: 2, vAlign: 1 },
        { p: 'StoreListView/content/StoreRow/Count', text: '每日限购:10/10', size: 18, color: [42, 35, 51], align: 2, vAlign: 0 },
        { p: 'StoreListView/content/StoreRow/BuyBtn/Label', text: '100', size: 18, color: [239, 227, 191], align: 1, vAlign: 1, outline: 2 },
    ], '商店');

    const adLabels = (n: string): LabelRow[] => [
        { p: `${n}/FreeLabel`, text: LEAGUE_DONATE_FREE_LABEL, size: 28, color: [252, 240, 214], align: 1, vAlign: 1, outline: 2 },
        // `labCost` **没写 align ⇒ 左对齐**（数字靠左、图标在左，不能"顺手居中"）
        { p: `${n}/CostLabel`, text: '999', size: 34, color: [252, 240, 214], align: 0, vAlign: 1, outline: 2 },
    ];
    assertLabels(donate, [
        ...title(LEAGUE_DONATE_TITLE),
        { p: 'ItemCoin/Reward/Count', text: '1', size: 24, color: [255, 255, 255], align: 2, vAlign: 1 },
        // ⚠️ `labName` 无 color ⇒ 默认**黑**
        { p: 'ItemCoin/Name', text: '联盟贡献*10', size: 20, color: [0, 0, 0], align: 1, vAlign: 1 },
        { p: 'ItemExp/Reward/Count', text: '1', size: 24, color: [255, 255, 255], align: 2, vAlign: 1 },
        { p: 'ItemExp/Name', text: '联盟贡献*10', size: 20, color: [0, 0, 0], align: 1, vAlign: 1 },
        { p: 'LabCount', text: '剩余捐献次数4/4', size: 26, color: [252, 240, 214], align: 1, vAlign: 1, outline: 2 },
        ...adLabels('BtnFree'), ...adLabels('BtnBuy'),
    ], '捐献');

    const row = 'DiscountListView/content/DiscountRow';
    assertLabels(discount, [
        { p: 'BtnSale/Label', text: LEAGUE_DISCOUNT_BTN_SALE, size: 42, color: [252, 240, 214], align: 1, vAlign: 1, outline: 2 },
        { p: 'BtnBuy/Label', text: LEAGUE_DISCOUNT_BTN_BUY, size: 42, color: [252, 240, 214], align: 1, vAlign: 1, outline: 2 },
        { p: 'RewardA/Count', text: '1', size: 24, color: [255, 255, 255], align: 2, vAlign: 1 },
        { p: 'RewardB/Count', text: '1', size: 24, color: [255, 255, 255], align: 2, vAlign: 1 },
        { p: 'LabEndTime', text: '结束时间:13:12:21', size: 26, color: [255, 255, 255], align: 1, vAlign: 1, outline: 2 },
        { p: 'Hint', text: LEAGUE_DISCOUNT_HINT, size: 26, color: [255, 235, 165], align: 1, vAlign: 1, outline: 3 },
        { p: 'LabUserCount', text: '当前累计3人完成砍价', size: 26, color: [255, 235, 165], align: 1, vAlign: 1, outline: 2 },
        // 行内三条全是 24px `#3a240d`、左对齐、无描边、非 bold
        { p: `${row}/Who`, text: '阿萨德', size: 24, color: [58, 36, 13], align: 0, vAlign: 1 },
        { p: `${row}/Price`, text: '36', size: 24, color: [58, 36, 13], align: 0, vAlign: 1 },
        { p: `${row}/Action`, text: LEAGUE_DISCOUNT_ROW_ACTION, size: 24, color: [58, 36, 13], align: 0, vAlign: 1 },
        { p: 'LabPrice', text: '1000', size: 34, color: [216, 64, 64], align: 0, vAlign: 1, outline: 3 },
        { p: 'LabPriceNow', text: '666', size: 30, color: [255, 242, 170], align: 1, vAlign: 1, outline: 3 },
    ], '砍价');
});

test('D10 虚拟列表装配：Mask + content/itemNode + 同步创建 + lineGap 10', () => {
    const check = (doc: PrefabDoc, listPath: string, rowPath: string, tag: string): void => {
        assert.ok(doc.comp(listPath, 'cc.Mask'), `${tag}：列表缺 cc.Mask`);
        assert.ok(doc.comp(listPath, 'cc.Graphics'), `${tag}：列表缺 cc.Graphics（调试探针用）`);
        const v = doc.comp(listPath, cidOf(VSCROLL_TS));
        assert.ok(v, `${tag}：列表没挂 VirtualScrollView`);
        assert.equal(doc.refPath(v!.content), `${doc.rootName}/${listPath}/content`, `${tag}：content 绑错`);
        assert.equal(doc.refPath(v!.itemNode), `${doc.rootName}/${rowPath}`, `${tag}：itemNode 绑错`);
        assert.equal(v!.useVirtualList, true, `${tag}：必须走虚拟列表`);
        // 0 = 同步创建：老端是一次性 render 完再摆位，异步会让首帧空列表
        assert.equal(v!.itemCreationMode, 0, `${tag}：itemCreationMode 应为 0（同步）`);
        assert.equal(v!.direction, 0, `${tag}：竖向`);
        assert.equal(v!.gridCount, 1, `${tag}：单列`);
        assert.equal(v!.spacing, 10, `${tag}：spacing 应为 FGUI 的 lineGap=10`);
        assert.equal(v!.useDynamicSize, false, `${tag}：行高固定 34 / 142`);
        assert.ok(doc.comp(`${listPath}/content`, 'cc.Widget'), `${tag}：content 缺 cc.Widget`);
        assert.equal(doc.P(listPath)!.ay, 1, `${tag}：列表锚点 (0.5,1)`);
        // 行必须是 content 的直接子节点（否则克隆出来挂不回同一层）
        assert.equal(rowPath, `${listPath}/content/${rowPath.split('/').pop()}`, `${tag}：itemNode 必须是 content 的直接子节点`);
    };
    check(store, 'StoreListView', 'StoreListView/content/StoreRow', '商店');
    check(discount, 'DiscountListView', 'DiscountListView/content/DiscountRow', '砍价');
    // 捐献没有列表
    assert.ok(!donate.comp('ItemCoin', cidOf(VSCROLL_TS)));
});

test('D11 ⚠️ 5 颗红点全是 `ui/common/RedDot.prefab` 的嵌套实例，且盘上恒 `_active=false`', () => {
    for (const [tag, doc, count] of [['商店', store, 1], ['捐献', donate, 2], ['砍价', discount, 2]] as const) {
        assert.equal(doc.instances.length, count, `${tag} 应有 ${count} 个嵌套实例，实得 ${doc.instances.length}`);
        for (const inst of doc.instances) {
            assert.equal(inst.uuid, RED_DOT_PREFAB_UUID, `${tag}/${inst.shell.path} 指向的不是共用红点 prefab`);
            assert.equal(inst.overrides.get('_name'), 'RedDot', `${tag}/${inst.shell.path} 名字应为 RedDot`);
            // 盘上默认**关**：源 prefab 根是 `_active: true`，不显式写 false 会亮 1 帧（行脚本 render 才关）
            assert.equal(inst.overrides.get('_active'), false, `${tag}/${inst.shell.path} 盘上必须恒 _active=false`);
            assert.ok(inst.shell.node._lpos === undefined, '实例的位置真值在 overrides 里，壳节点上不该有 _lpos');
            // 绝对不许把红点子树内联进来：内联后 icon/spine/titleLabel 没人绑 ⇒ onLoad 崩
            assert.deepEqual([...inst.mounted], [], `${tag}/${inst.shell.path} 不该有 mountedChildren`);
            assert.ok(!doc.P(`${inst.shell.path}/Icon`), `${tag}：红点子树是「来自源 prefab」，本文件里不该有`);
        }
    }
    // 位置逐条对 FGUI `组件_公用_红点` 放进按钮后的相对坐标
    assert.equal(store.P('StoreListView/content/StoreRow/BuyBtn/RedDot')!.x, 84.5);
    assert.equal(donate.P('BtnFree/RedDot')!.x, 105);
    assert.equal(donate.P('BtnBuy/RedDot')!.y, 40);
    assert.equal(discount.P('BtnSale/RedDot')!.x, 100);
    assert.equal(discount.P('BtnSale/RedDot')!.y, 23.5);
    // 商店**入口**红点还没有（`TabLeagueMain.updateRD()` 里 `btn_shop.com_rd` 是注释掉的）
    assert.ok(!store.P('RedDot'), '联盟商店面板内没有额外的独立红点');
});

test('D12 `@property` 逐条对（商店 2+7+2+2 / 捐献 8+7×2+2×2 / 砍价 13+2+4+2×2）', () => {
    const row = 'StoreListView/content/StoreRow';
    assertBinds(store, STORE_PAGE_TS, '', [
        ['closeButton', 'CloseBtn'],
        ['storeList', 'StoreListView'],
    ], '商店.');
    assertBinds(store, ROW_TS, row, [
        ['nameLabel', `${row}/Name`],
        ['countLabel', `${row}/Count`],
        ['rewardSlot', `${row}/Reward`],
        ['buyButton', `${row}/BuyBtn`],
        ['costLabel', `${row}/BuyBtn/Label`],
        ['priceIcon', `${row}/BuyBtn/PriceIcon`],
        ['redDot', `${row}/BuyBtn/RedDot`],
    ], '商店.');
    assertBinds(store, REWARD_SLOT_TS, `${row}/Reward`, [
        ['icon', `${row}/Reward/Icon`],
        ['countLabel', `${row}/Reward/Count`],
    ], '商店.');
    assertBinds(store, VSCROLL_TS, 'StoreListView', [
        ['content', 'StoreListView/content'],
        ['itemNode', `${row}`],
    ], '商店.');

    assertBinds(donate, DONATE_PAGE_TS, '', [
        ['closeButton', 'CloseBtn'],
        ['coinSlot', 'ItemCoin/Reward'],
        ['coinName', 'ItemCoin/Name'],
        ['expSlot', 'ItemExp/Reward'],
        ['expName', 'ItemExp/Name'],
        ['countLabel', 'LabCount'],
        ['freeButton', 'BtnFree'],
        ['buyButton', 'BtnBuy'],
    ], '捐献.');
    for (const n of ['BtnFree', 'BtnBuy']) {
        assertBinds(donate, AD_BTN_TS, n, [
            ['bg', `${n}/Bg`],
            ['freeBar', `${n}/FreeBar`],
            ['freeLabel', `${n}/FreeLabel`],
            ['freeVideo', `${n}/FreeVideo`],
            ['costIcon', `${n}/CostIcon`],
            ['costLabel', `${n}/CostLabel`],
            ['redDot', `${n}/RedDot`],
        ], '捐献.');
    }
    for (const n of ['ItemCoin/Reward', 'ItemExp/Reward']) {
        assertBinds(donate, REWARD_SLOT_TS, n, [['icon', `${n}/Icon`], ['countLabel', `${n}/Count`]], '捐献.');
    }

    const dRow = 'DiscountListView/content/DiscountRow';
    assertBinds(discount, DISCOUNT_PAGE_TS, '', [
        ['discountList', 'DiscountListView'],
        ['rewardA', 'RewardA'],
        ['rewardB', 'RewardB'],
        ['priceIcon', 'PriceIcon'],
        ['priceLabel', 'LabPrice'],
        ['priceNowLabel', 'LabPriceNow'],
        ['userCountLabel', 'LabUserCount'],
        ['endTimeLabel', 'LabEndTime'],
        ['saleButton', 'BtnSale'],
        // ⚠️ 绑的是实例**根节点**（跨嵌套实例边界引用内部组件过不了序列化，会静默落成 null）
        ['saleRedDot', 'BtnSale/RedDot'],
        ['buyButton', 'BtnBuy'],
        ['buyButtonBg', 'BtnBuy/Bg'],
        ['strike', 'Strike'],
    ], '砍价.');
    assertBinds(discount, VSCROLL_TS, 'DiscountListView', [
        ['content', 'DiscountListView/content'],
        ['itemNode', dRow],
    ], '砍价.');
    assertBinds(discount, DISCOUNT_ROW_TS, dRow, [
        ['whoLabel', `${dRow}/Who`],
        ['actionLabel', `${dRow}/Action`],
        ['priceLabel', `${dRow}/Price`],
        ['icon', `${dRow}/Icon`],
    ], '砍价.');
    for (const n of ['RewardA', 'RewardB']) {
        assertBinds(discount, REWARD_SLOT_TS, n, [['icon', `${n}/Icon`], ['countLabel', `${n}/Count`]], '砍价.');
    }
    // `saleRedDot` 那条必须真的是**节点**引用（不是 null、也不是别的组件）
    const page = discount.comp('', cidOf(DISCOUNT_PAGE_TS))!;
    const redDotShell = discount.P('BtnSale/RedDot')!.node;
    assert.equal(redDotShell.__type__, 'cc.Node');
    assert.equal((page.saleRedDot as { __id__: number }).__id__, discount.all.indexOf(redDotShell),
        'saleRedDot 必须指向 BtnSale/RedDot 这个壳节点');
});

