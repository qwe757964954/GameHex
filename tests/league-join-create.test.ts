/**
 * 「联盟」P3（**加入联盟 `LeagueJoin` + 创建联盟 `LeagueCreate` + 容器页 `LeagueTab`**）的回归网。
 *
 * 与 `league-hall*.test.ts` / `league-apply-edit.test.ts` 同一套五段口径：
 *
 *   A. **文案口径**（`LeagueTexts`）—— 「加入联盟 / 创建联盟」两段新文案。
 *   B. **美术口径**（`LeagueArt`）—— 加入页背景三件套、两颗粒按钮、消耗按钮 / 衬底、勾选框两图、
 *      招牌输入框；以及 `TY_btn21` 进九宫格集合、`TY_btn20 / TY_btn23` **不进**。
 *   C. **数据口径**（`LeagueTable`）—— `isLeagueSearchId` / `sanitizeLeagueSearchInput` /
 *      `pickQuickJoinIdsFor`（① 搜索缓存支）/ `leagueCreateBannerIndices` / `isLeagueNameUsable` /
 *      `leagueCreateBannerIndexOf` / `leagueCreateCost` / `buildLeagueCostView`。
 *   D. **prefab 结构 + 几何**（`ui/League/LeagueTab.prefab`、`LeagueJoin.prefab`、`LeagueCreate.prefab`）
 *      —— 脚本 cid 反解、全 UI_2D、顶层序、**全部视觉框逐条对 FGUI 原 XML**、九宫格、
 *      虚拟列表装配（纵向 / 横向）、EditBox 接线。
 *   E. **页面逻辑 / 调用约定**（源码文本）—— 容器页的「按入盟态切页」、加入页的「只填空 label」、
 *      创建页的「消耗两态换色」「勾选框同步」。
 *
 * ## 口径真源
 *
 *   - 设计：`zarts/art/UIProject/trunk/UIProject/assets/主界面_联盟/加入联盟/组件_联盟_加入联盟.xml`、
 *     `…/加入联盟/组件_联盟_创建联盟.xml`、`…/组件/组件_联盟_查询.xml`、`…/组件/组件_联盟_联盟item.xml`、
 *     `…/组件/组件_联盟_旗帜.xml`、`…/组件/按钮_联盟_消耗按钮.xml`、
 *     `共用组件/组件/消耗展示/组件_公用_消耗_单个.xml`、`共用组件/组件/按钮/公用_按钮_勾选.xml`、
 *     `共用组件/组件/按钮/按钮_公共_通用.xml`、`共用组件/组件/弹窗/组件_公共弹窗_新.xml`
 *   - 老端：`client/assets/script/app/game/ctrl/main/league/play/TabLeagueJoin.ts`、
 *     `…/LayerLeagueCreat.ts`、`client/assets/script/lib/fgui/fairygui.js`
 *   - 本项目：`assets/script/app/league/**`、`assets/resources/ui/League/*.prefab`
 *
 * ## ⚠️ 四条**刻意与 FGUI 原稿不同**（理由见各页面类文件头与构建器注释）
 *
 *   ① 查询框 `maxLength` 落 **19**（联盟 id 是 `Long` ⇒ 十进制最多 19 位）；
 *      创建名 `maxLength` 落 **20**。FGUI 两处都是 `maxLength="0"`（不限），而 cocos 的
 *      `0` 会**原样**传给原生输入（构建产物里是 `maxLength<0?65535:e.maxLength`）⇒ 一个字符都打不进去。
 *   ② 「允许快速加入」的文案节点落成**根下的 `QuickJoinLabel`**（FGUI 是面板上的 `n10`，
 *      与勾选框同级；勾选组件自带的 `title` 是空的、`autoClearText`）⇒ 页面类里要按兄弟名取。
 *   ③ 加入页不落 FGUI 的 `n13` / `n14`（全面屏适配组件）与 `n18`（一块 debug 用的 `graph`）。
 *   ④ 创建页的 `BtnCreate` / `QuickJoinBox` **不挂 SCALE 按下态**（FGUI 只写了 `<Button/>`，
 *      没有 `downEffect`）；只有 `CloseBtn` 走 `按钮_公共_关闭`（有 `downEffect="scale"`）。
 *
 * ## ⚠️ 带 scale 的节点：「视觉左上角」≠ FGUI xy（P3 新收口）
 *
 * `GObject.prototype.handlePositionChanged`（fairygui.js:1697）：
 *     xv = _x;  yv = -_y;
 *     if (!_pivotAsAnchor) { xv += anchorX*_width;  yv -= (1-anchorY)*_height; }
 * `_pivotAsAnchor` 由 XML 的 `anchor="true"` 决定（**缺省 false**）⇒
 *     **视觉左上角 = ( _x + pivotX·(w − w·sx),  _y + pivotY·(h − h·sy) )**
 * - `旗帜` 组件 pivot=(0,0) ⇒ 修正为 0 ⇒ 「xy 即视觉左上角」成立（P2 的口径）；
 * - `组件_公用_消耗_单个` pivot=(0.5,0.5) + scale 0.9 ⇒ **要修正**（D14 就是这条的回归点）。
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import {
    LEAGUE_ART_BANNER_BASE,
    LEAGUE_ART_BANNER_FRAME,
    LEAGUE_ART_BTN_CREATE,
    LEAGUE_ART_BTN_QUICK_JOIN,
    LEAGUE_ART_CHECK_BG,
    LEAGUE_ART_CHECK_MARK,
    LEAGUE_ART_CHECK_MARK_ROOT,
    LEAGUE_ART_COST_BAR_ALPHA,
    LEAGUE_ART_COST_BAR_TINT,
    LEAGUE_ART_COST_BTN,
    LEAGUE_ART_CREATE_NAME_BG,
    LEAGUE_ART_JOIN_BG,
    LEAGUE_ART_JOIN_BOARD,
    LEAGUE_ART_JOIN_FRAME,
    LEAGUE_ART_POPUP_BOARD,
    LEAGUE_ART_POPUP_CLOSE,
    LEAGUE_ART_POPUP_TITLE_BG,
    LEAGUE_ART_POPUP_TITLE_DECO,
    LEAGUE_ART_SEARCH_BTN,
    LEAGUE_ART_SLICED,
    LEAGUE_BANNER_COLOR_COUNT,
    LEAGUE_BANNER_DEFAULT_COLOR,
    LEAGUE_COST_ENOUGH_COLOR,
    LEAGUE_COST_ENOUGH_STROKE,
    LEAGUE_COST_ICON_ROOT,
    LEAGUE_COST_SHORT_COLOR,
    LEAGUE_COST_SHORT_STROKE,
    LEAGUE_POPUP_ART_ROOT,
    LEAGUE_POPUP_BOARD_ROOT,
    LEAGUE_SHARED_CHECK_ROOT,
    LEAGUE_SPRITE_SIMPLE,
    LEAGUE_SPRITE_SLICED,
    leagueBannerArt,
    leagueBannerColorName,
    leagueSpriteType,
} from '../assets/script/app/league/LeagueArt';
import {
    buildLeagueCostView,
    isLeagueNameUsable,
    isLeagueSearchId,
    LEAGUE_CREATE_BANNER_COUNT,
    LEAGUE_CREATE_COST_CONFIG_KEY,
    LEAGUE_CREATE_COST_FALLBACK,
    LEAGUE_CREATE_COST_RES_ID,
    LEAGUE_QUICK_JOIN_LIMIT,
    leagueCreateBannerIndexOf,
    leagueCreateBannerIndices,
    leagueCreateCost,
    pickQuickJoinIdsFor,
    sanitizeLeagueSearchInput,
    type ILeagueUnionRow,
} from '../assets/script/app/league/LeagueTable';
import {
    LEAGUE_COST_HAS_SUFFIX,
    LEAGUE_CREATE_NAME_PROMPT,
    LEAGUE_CREATE_QUICK_JOIN,
    LEAGUE_CREATE_SUBMIT,
    LEAGUE_CREATE_TITLE,
    LEAGUE_HALL_SEARCH_PROMPT,
    LEAGUE_JOIN_BTN_CREATE,
    LEAGUE_JOIN_BTN_QUICK,
    LEAGUE_NO_JOINABLE,
} from '../assets/script/app/league/LeagueTexts';

// ============================================================
// A. 文案口径
// ============================================================

test('A1 加入页：两颗粒按钮的文案 = FGUI `Button title` 原稿；查询框 prompt 复用大厅常量', () => {
    assert.equal(LEAGUE_JOIN_BTN_CREATE, '创建联盟'); // btn_creat 的 title
    assert.equal(LEAGUE_JOIN_BTN_QUICK, '快速加入'); // btn_join 的 title
    // 查询框 `lab_input` 的 prompt="点击输入ID" —— 与大厅搜索框同一句，共用常量
    assert.equal(LEAGUE_HALL_SEARCH_PROMPT, '点击输入ID');
    // 列表空文案
    assert.equal(LEAGUE_NO_JOINABLE, '没有可加入的联盟');
});

test('A2 创建页：标题 / 名字占位 / 勾选文案 / 提交 / 消耗尾巴', () => {
    assert.equal(LEAGUE_CREATE_TITLE, '创建联盟'); // popBg 的 <Label title="创建联盟"/>
    assert.equal(LEAGUE_CREATE_NAME_PROMPT, '点击输入联盟名称'); // lab_leagueName 的 prompt
    assert.equal(LEAGUE_CREATE_QUICK_JOIN, '允许快速加入'); // n10 的 text
    assert.equal(LEAGUE_CREATE_SUBMIT, '创建'); // 按钮_联盟_消耗按钮 / n4 的 text
    assert.equal(LEAGUE_COST_HAS_SUFFIX, '/'); // lab_has 的文本尾巴
    assert.equal(LEAGUE_CREATE_TITLE, LEAGUE_JOIN_BTN_CREATE, 'FGUI 两处同字（一处是按钮 title、一处是弹窗 Label）');
});

// ============================================================
// B. 美术口径
// ============================================================

test('B1 加入页三件套 = 大厅同源图（保真：FGUI 就是复用的）', () => {
    assert.equal(LEAGUE_ART_JOIN_BG, 'lm_bg02'); // bg loader
    assert.equal(LEAGUE_ART_JOIN_FRAME, 'lm_kj_pic08'); // n19
    assert.equal(LEAGUE_ART_JOIN_BOARD, 'frame_Dikuang03'); // n20
});

test('B2 两颗粒按钮 + 消耗按钮 + 衬底 + 输入框', () => {
    assert.equal(LEAGUE_ART_BTN_CREATE, 'TY_btn23');
    assert.equal(LEAGUE_ART_BTN_QUICK_JOIN, 'TY_btn20');
    assert.equal(LEAGUE_ART_COST_BTN, 'TY_btn21');
    assert.equal(LEAGUE_ART_CREATE_NAME_BG, 'frame_shurukuang');
    assert.equal(LEAGUE_ART_SEARCH_BTN, 'hy_btn02');
    assert.deepEqual([...LEAGUE_ART_COST_BAR_TINT], [0x66, 0x66, 0x66]); // FGUI color="#666666"
    assert.equal(LEAGUE_ART_COST_BAR_ALPHA, 102);                        // FGUI alpha="0.4"
});

test('B3 ⚠️ 九宫格集合：`TY_btn21` 进；`TY_btn20 / TY_btn23` **不进**（原生尺寸恰好等于实例尺寸）', () => {
    assert.ok(LEAGUE_ART_SLICED.has(LEAGUE_ART_COST_BTN), 'TY_btn21 有 scale9grid（56,19,112,38）⇒ 必须 SLICED');
    assert.ok(!LEAGUE_ART_SLICED.has(LEAGUE_ART_BTN_CREATE), 'TY_btn23 无 scale9grid ⇒ SIMPLE');
    assert.ok(!LEAGUE_ART_SLICED.has(LEAGUE_ART_BTN_QUICK_JOIN), 'TY_btn20 无 scale9grid ⇒ SIMPLE');
    assert.equal(leagueSpriteType(LEAGUE_ART_BTN_CREATE), LEAGUE_SPRITE_SIMPLE);
    assert.equal(leagueSpriteType(LEAGUE_ART_BTN_QUICK_JOIN), LEAGUE_SPRITE_SIMPLE);
    assert.equal(leagueSpriteType(LEAGUE_ART_COST_BTN), LEAGUE_SPRITE_SLICED);
    // `lm_kj_pic08` 原图 720×502 == 实例尺寸 ⇒ 本工程口径按 SIMPLE（FGUI <image> 默认铺满）
    assert.equal(leagueSpriteType('lm_kj_pic08'), LEAGUE_SPRITE_SIMPLE);
});

test('B4 勾选框两图 + 图真的在磁盘上', () => {
    assert.equal(LEAGUE_ART_CHECK_BG, 'shaixuan_dikuang');
    assert.equal(LEAGUE_ART_CHECK_MARK, 'sd_check');
    assert.equal(LEAGUE_ART_CHECK_MARK_ROOT, 'image/sevenDay', '勾是七日狂欢的公共图，不在 image/league');
    assert.equal(LEAGUE_POPUP_ART_ROOT, 'image/common');
    assert.equal(LEAGUE_POPUP_BOARD_ROOT, 'image/league', '弹窗底板单独在 image/league');
    assert.equal(LEAGUE_COST_ICON_ROOT, 'icons/resource');
    for (const [dir, name] of [
        ['assets/resources/image/league', LEAGUE_ART_JOIN_BG],
        ['assets/resources/image/league', LEAGUE_ART_JOIN_FRAME],
        ['assets/resources/image/league', LEAGUE_ART_JOIN_BOARD],
        ['assets/resources/image/league', LEAGUE_ART_BTN_CREATE],
        ['assets/resources/image/league', LEAGUE_ART_BTN_QUICK_JOIN],
        ['assets/resources/image/league', LEAGUE_ART_COST_BTN],
        ['assets/resources/image/league', LEAGUE_ART_CREATE_NAME_BG],
        ['assets/resources/image/league', LEAGUE_ART_SEARCH_BTN],
        ['assets/resources/image/league', LEAGUE_ART_POPUP_BOARD],
        ['assets/resources/image/common', LEAGUE_ART_POPUP_TITLE_BG],
        ['assets/resources/image/common', LEAGUE_ART_POPUP_TITLE_DECO],
        ['assets/resources/image/common', LEAGUE_ART_POPUP_CLOSE],
        ['assets/resources/image/league', LEAGUE_ART_CHECK_BG],
        [`assets/resources/${LEAGUE_SHARED_CHECK_ROOT}`, LEAGUE_ART_CHECK_MARK],
    // ⚠️ `lm_bg02` 在磁盘上是 **`.jpg`**（1280 高的整屏底图，被 P2 大厅同源复用）
    //    ⇒ 这里两种扩展名都放行，但**必须命中一个**。
    ] as const) {
        assert.ok(existsSync(`${dir}/${name}.png`) || existsSync(`${dir}/${name}.jpg`),
            `缺图：${dir}/${name}.png（或 .jpg）`);
    }
});

test('B5 消耗两态四色（`lab_has` 换色、`lab_need` 恒「够」那一色）', () => {
    assert.deepEqual([...LEAGUE_COST_ENOUGH_COLOR], [0xe6, 0xe5, 0xd9]);
    assert.deepEqual([...LEAGUE_COST_ENOUGH_STROKE], [0x18, 0x16, 0x14]);
    assert.deepEqual([...LEAGUE_COST_SHORT_COLOR], [0xea, 0x43, 0x32]);
    assert.deepEqual([...LEAGUE_COST_SHORT_STROKE], [0x16, 0x0e, 0x08]);
});

test('B6 旗帜八色：个数 = `组件_联盟_旗帜` 的 `颜色` controller 页数；默认第 0 页', () => {
    assert.equal(LEAGUE_BANNER_COLOR_COUNT, 8);
    assert.equal(LEAGUE_BANNER_COLOR_COUNT, LEAGUE_CREATE_BANNER_COUNT);
    assert.equal(LEAGUE_BANNER_DEFAULT_COLOR, 0);
    const arts = new Set<string>();
    for (let i = 0; i < LEAGUE_BANNER_COLOR_COUNT; i += 1) {
        const art = leagueBannerArt(i);
        assert.ok(art.startsWith('img_Qizhi_'), `第 ${i} 色应是 img_Qizhi_*，实得 ${art}`);
        arts.add(art);
        assert.ok(leagueBannerColorName(i).length > 0, `第 ${i} 色应有名字`);
    }
    assert.equal(arts.size, LEAGUE_BANNER_COLOR_COUNT, '八色不能重复');
    // 越界夹取
    assert.equal(leagueBannerArt(-1), leagueBannerArt(0));
    assert.equal(leagueBannerArt(LEAGUE_BANNER_COLOR_COUNT + 3), leagueBannerArt(LEAGUE_BANNER_COLOR_COUNT - 1));
    assert.equal(LEAGUE_ART_BANNER_FRAME, 'img_Qizhi_02', '旗帜外框（选中态）');
    assert.equal(LEAGUE_ART_BANNER_BASE, 'icon_lm07', '旗帜底图');
});

// ============================================================
// C. 数据口径
// ============================================================

test('C1 `isLeagueSearchId` 逐字照搬老端 `StringUtil.isPositiveInteger`（允许 "0" 与 "007"）', () => {
    assert.equal(isLeagueSearchId('2115228'), true);
    assert.equal(isLeagueSearchId('0'), true, '老端正则 ^[0-9]\\d*$ 允许单字 "0"');
    assert.equal(isLeagueSearchId('007'), true);
    assert.equal(isLeagueSearchId(''), false);
    assert.equal(isLeagueSearchId('12a'), false);
    assert.equal(isLeagueSearchId(' 12'), false);
    assert.equal(isLeagueSearchId('-1'), false);
});

test('C2 `sanitizeLeagueSearchInput`：不是纯数字串就清空（兜粘贴旁路，不是拒绝按键）', () => {
    assert.equal(sanitizeLeagueSearchInput('2115228'), '2115228');
    assert.equal(sanitizeLeagueSearchInput('12a3'), '');
    assert.equal(sanitizeLeagueSearchInput(''), '');
    // 空串传进去也不炸（页面里 `text ?? ''`）
    assert.equal(sanitizeLeagueSearchInput(undefined as unknown as string), '');
});

const union = (over: Partial<ILeagueUnionRow>): ILeagueUnionRow => ({
    id: '1', name: 'x', icon: 0, level: 1, count: 1, maxCount: 50, autoJoin: false, leader: '', leaderId: '',
    ...over,
} as ILeagueUnionRow);

test('C3 ⚠️ `pickQuickJoinIdsFor` 的 ① 支（搜索缓存）**不查 autoJoin、也不查满没满**', () => {
    const rows = [
        union({ id: '11', autoJoin: true, count: 1, maxCount: 50 }),
        union({ id: '12', autoJoin: false, count: 1, maxCount: 50 }),
        union({ id: '13', autoJoin: true, count: 50, maxCount: 50 }),
    ];
    // ② 支：全量里挑 autoJoin && 未满
    assert.deepEqual(pickQuickJoinIdsFor(rows, null), ['11']);
    // ① 支：搜索命中一个「没开快速加入 / 已满」的盟，也直接点名加入
    assert.deepEqual(pickQuickJoinIdsFor(rows, rows[1]!), ['12']);
    assert.deepEqual(pickQuickJoinIdsFor(rows, rows[2]!), ['13']);
    assert.equal(LEAGUE_QUICK_JOIN_LIMIT, 5, '老端最多点 5 条');
    // ② 支的截断
    const many = Array.from({ length: 8 }, (_, i) => union({ id: String(100 + i), autoJoin: true, count: 0, maxCount: 50 }));
    assert.equal(pickQuickJoinIdsFor(many, null).length, LEAGUE_QUICK_JOIN_LIMIT);
});

test('C4 旗帜列表数据源 = `[0..7]`（老端 `this.arr`）', () => {
    assert.deepEqual(leagueCreateBannerIndices(), [0, 1, 2, 3, 4, 5, 6, 7]);
    assert.deepEqual(leagueCreateBannerIndices(3), [0, 1, 2]);
    assert.deepEqual(leagueCreateBannerIndices(0), []);
    assert.deepEqual(leagueCreateBannerIndices(-5), []);
    assert.deepEqual(leagueCreateBannerIndices(2.7), [0, 1], '非整数截断');
});

test('C5 `isLeagueNameUsable`：空 / `***` 不可用；**不 trim**（老端也允许纯空格）', () => {
    assert.equal(isLeagueNameUsable('传奇'), true);
    assert.equal(isLeagueNameUsable(''), false);
    assert.equal(isLeagueNameUsable('***'), false, '老端把敏感词占位串当「没填」');
    assert.equal(isLeagueNameUsable(' '), true, '⚠️ 保真：老端不 trim，别顺手加');
});

test('C6 `leagueCreateBannerIndexOf`：越界夹到 [0,7]', () => {
    assert.equal(leagueCreateBannerIndexOf(0), 0);
    assert.equal(leagueCreateBannerIndexOf(7), 7);
    assert.equal(leagueCreateBannerIndexOf(-1), 0);
    assert.equal(leagueCreateBannerIndexOf(99), LEAGUE_CREATE_BANNER_COUNT - 1);
    assert.equal(leagueCreateBannerIndexOf(Number.NaN), 0);
});

test('C7 创建消耗数量：`gameConfig.unionCreateCost`，读不到用 100 兜底', () => {
    assert.equal(LEAGUE_CREATE_COST_CONFIG_KEY, 'unionCreateCost');
    assert.equal(LEAGUE_CREATE_COST_FALLBACK, 100);
    assert.equal(LEAGUE_CREATE_COST_RES_ID, 10, 'roleProperty.coin');
    assert.equal(leagueCreateCost([{ key: 'unionCreateCost', value: '100' }]), 100);
    assert.equal(leagueCreateCost([{ key: 'other', value: '5' }]), LEAGUE_CREATE_COST_FALLBACK);
    assert.equal(leagueCreateCost(null), LEAGUE_CREATE_COST_FALLBACK);
    assert.equal(leagueCreateCost([{ key: 'unionCreateCost', value: '0' }]), LEAGUE_CREATE_COST_FALLBACK,
        '0 / 负值都算读不到');
});

test('C8 `buildLeagueCostView`：`lab_has` 带 `/` 尾巴、`enough` 驱动两态、读数按已持有量', () => {
    const prop = { key: 'coin', name: '金币', icon: '图标_幻灵玉', unenoughTips: '金币不足' };
    const enough = buildLeagueCostView(prop, { text: '120', value: 120 }, 100);
    assert.equal(enough.hasText, '120/');
    assert.equal(enough.needText, '100');
    assert.equal(enough.enough, true);
    assert.equal(enough.iconRoot, LEAGUE_COST_ICON_ROOT);
    assert.equal(enough.iconName, '图标_幻灵玉', 'FGUI 表里存的是组件名，不是路径');
    assert.equal(enough.unenoughTips, '金币不足');

    const short = buildLeagueCostView(prop, { text: '30', value: 30 }, 100);
    assert.equal(short.enough, false);
    assert.equal(short.hasText, '30/');

    // 边界：刚好够
    assert.equal(buildLeagueCostView(prop, { text: '100', value: 100 }, 100).enough, true);
    // 表缺行 ⇒ 不炸，图标名空（调用方降级不画图）
    const none = buildLeagueCostView(null, { text: '1', value: 1 }, 100);
    assert.equal(none.iconName, '');
    assert.equal(none.resId, 0);
    assert.equal(none.enough, false);
});

// ============================================================
// D. prefab 结构 + 几何
// ============================================================

const TAB_PREFAB = 'assets/resources/ui/League/LeagueTab.prefab';
const JOIN_PREFAB = 'assets/resources/ui/League/LeagueJoin.prefab';
const CREATE_PREFAB = 'assets/resources/ui/League/LeagueCreate.prefab';
const TAB_PAGE_TS = 'assets/script/app/league/LeagueTabPage.ts';
const JOIN_PAGE_TS = 'assets/script/app/league/LeagueJoinPage.ts';
const CREATE_PAGE_TS = 'assets/script/app/league/LeagueCreatePage.ts';
const UNION_ROW_TS = 'assets/script/app/league/LeagueUnionRow.ts';
const SCROLL_TS = 'assets/script/vscrollview/VScrollView.ts';
const UI_2D = 33554432;
/** 类名 != 文件名（`VScrollView` 的 `@ccclass('VirtualScrollView')`）⇒ 只能按压缩 cid 找。 */
const VSCROLL_CID = '544earF5qRLB4JTuTnSr11+';

type Entry = Record<string, unknown>;
const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

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

/** 载入一张 prefab 并反解「画布像素视觉框」（画布 720×1280，y 向下同 FGUI，根中心 (360,640)）。 */
function openPrefab(path: string) {
    const all = JSON.parse(readFileSync(path, 'utf8')) as Entry[];
    const at = (ref: unknown): Entry | null =>
        ref && typeof ref === 'object' && '__id__' in (ref as Entry) ? all[(ref as { __id__: number }).__id__]! : null;
    const nodes = all.filter((e) => e && e.__type__ === 'cc.Node');
    const root = nodes[0]!;
    const rootName = String(root._name);
    const byPath = new Map<string, {
        node: Entry; cx: number; cy: number; left: number; top: number; vw: number; vh: number; sx: number; sy: number;
    }>();
    const idxPath = new Map<number, string>();
    const walk = (node: Entry, p: string, pCx: number, pCy: number, pSx: number, pSy: number): void => {
        const pos = (node._lpos ?? { x: 0, y: 0 }) as { x: number; y: number };
        const sc = (node._lscale ?? { x: 1, y: 1 }) as { x: number; y: number };
        const comps = ((node._components ?? []) as unknown[]).map(at);
        const uit = comps.find((c) => c?.__type__ === 'cc.UITransform');
        const size = (uit?._contentSize ?? { width: 0, height: 0 }) as { width: number; height: number };
        const anchor = (uit?._anchorPoint ?? { x: 0.5, y: 0.5 }) as { x: number; y: number };
        const cx = pCx + pos.x * pSx;
        const cy = pCy - pos.y * pSy;
        const sx = pSx * (sc.x ?? 1);
        const sy = pSy * (sc.y ?? 1);
        const vw = size.width * sx;
        const vh = size.height * sy;
        byPath.set(p, { node, cx, cy, left: cx - anchor.x * vw, top: cy - (1 - anchor.y) * vh, vw, vh, sx, sy });
        idxPath.set(all.indexOf(node), p);
        for (const child of ((node._children ?? []) as unknown[])) {
            const c = at(child);
            if (c) walk(c, `${p}/${c._name}`, cx, cy, sx, sy);
        }
    };
    walk(root, rootName, 360, 640, 1, 1);
    const P = (p: string): (typeof byPath extends Map<string, infer V> ? V : never) | undefined =>
        byPath.get(p === '' ? rootName : `${rootName}/${p}`);
    const comp = (p: string, type: string): Entry | null =>
        (((P(p)?.node._components ?? []) as unknown[]).map(at).find((c) => c?.__type__ === type) ?? null);
    const refPath = (ref: unknown): string | null => {
        if (!ref || typeof ref !== 'object' || !('__id__' in (ref as Entry))) return null;
        const t = at(ref);
        if (!t) return null;
        if (t.__type__ === 'cc.Node') return idxPath.get((ref as { __id__: number }).__id__) ?? null;
        const owner = at(t.node);
        return owner ? idxPath.get((t.node as { __id__: number }).__id__) ?? null : null;
    };
    const customCids = [...new Set(all.map((e) => e?.__type__).filter((t) => t && !String(t).startsWith('cc.')))] as string[];
    return { all, at, nodes, root, rootName, byPath, P, comp, refPath, customCids };
}

const near = (a: number, b: number, eps = 0.05): boolean => Math.abs(a - b) <= eps;
const lpos = (n: Entry): { x: number; y: number } => (n._lpos ?? { x: 0, y: 0 }) as { x: number; y: number };
const uuidOf = (sp: Entry | null | undefined): string | null =>
    sp ? ((sp._spriteFrame as { __uuid__?: string } | null)?.__uuid__ ?? null) : null;
const names = (ctx: ReturnType<typeof openPrefab>): string[] =>
    ((ctx.root._children ?? []) as unknown[]).map((c) => String(ctx.at(c)!._name));

const tab = openPrefab(TAB_PREFAB);
const join = openPrefab(JOIN_PREFAB);
const create = openPrefab(CREATE_PREFAB);

const U = {
    bg: 'fd6390c4-7c60-4404-a06a-3351873ce4ed@f9941',
    frame: '997e78ce-23a5-45c4-83ec-68b5770d18c9@f9941',
    board: 'f0544e68-71d4-4058-925a-5d0e73c74785@f9941',
    rowBg: 'dac21f1f-62e9-4f7c-98c9-8125b51c0f49@f9941',
    qizhi02: '82cd6fc7-5e51-4973-b8e2-48ec083d6d8f@f9941',
    qizhi06: '5753c0e9-3d98-4052-bf3f-abca2dda9683@f9941',
    lm07: 'c3707aad-313e-4a6a-a69e-366ba45fda45@f9941',
    pic07: '672a6233-305e-4ebf-bcb1-b3c0a2d150fb@f9941',
    input: '248a214e-5fb8-4dbd-bf45-9bd6ce46f606@f9941',
    search: 'a0457e48-5dc5-41d4-bc57-9d8dba425290@f9941',
    btn24: 'ab3d4c52-d694-4b26-8e55-daec483290f2@f9941',
    btn20: '55afd73b-2bfd-43fa-b91a-9e5b2a6b2751@f9941',
    btn21: '1ee1fc53-a798-4b98-b385-96985db1348f@f9941',
    popup: 'a295d231-ef9a-4bea-9818-0e0d85794ef0@f9941',
    title01: 'de242388-9444-451f-adff-78fe5a73e20d@f9941',
    title02: 'a957fd35-0792-4a27-9de3-85a44274a5d0@f9941',
    close: 'ca6d0ca8-3ed8-4009-963d-d845eb296872@f9941',
    jiao8: 'b456d791-97f9-40ae-ada5-05ca902ef521@f9941',
    checkBg: 'ee8f8335-770c-4447-b91a-9c3e2f08679a@f9941',
    checkMark: 'e10e3712-56a2-4747-a612-1fc84fdea360@f9941',
};

test('D1 三张 prefab（连 `.meta`）+ 三个新脚本（连 `.ts.meta`）都在磁盘上', () => {
    for (const p of [TAB_PREFAB, JOIN_PREFAB, CREATE_PREFAB]) {
        assert.ok(existsSync(p), `缺 prefab：${p}`);
        assert.ok(existsSync(`${p}.meta`), `缺 meta：${p}.meta`);
    }
    for (const ts of [TAB_PAGE_TS, JOIN_PAGE_TS, CREATE_PAGE_TS]) {
        assert.ok(existsSync(ts), `缺脚本：${ts}`);
        assert.ok(existsSync(`${ts}.meta`), `缺 .ts.meta：${ts}.meta（编辑器不会给未 refresh 的新 .ts 生成）`);
    }
});

test('D2 节点数：容器 1（只有根）/ 加入页 27 / 创建页 28（重跑生成器忘了先清空会翻倍）', () => {
    assert.equal(tab.rootName, 'LeagueTab');
    assert.equal(join.rootName, 'LeagueJoin');
    assert.equal(create.rootName, 'LeagueCreate');
    assert.equal(tab.nodes.length, 1, `容器页只有根，实得 ${tab.nodes.length}`);
    assert.equal(join.nodes.length, 26, `加入页应为 26（25 + 根），实得 ${join.nodes.length}`);
    assert.equal(create.nodes.length, 27, `创建页应为 27（26 + 根），实得 ${create.nodes.length}`);
});

test('D3 ⚠️ 所有节点 `_layer` 都是 UI_2D（落 DEFAULT 会让整棵子树不渲染且不报错）', () => {
    for (const [tag, ctx] of [['容器', tab], ['加入页', join], ['创建页', create]] as const) {
        const bad = [...new Set(ctx.nodes.map((n) => n._layer))].filter((l) => l !== UI_2D);
        assert.deepEqual(bad, [], `${tag} 有非 UI_2D 的层：${bad.join(',')}`);
    }
});

test('D4 顶层渲染序 = FGUI `displayList` 序（去掉不落的节点）', () => {
    assert.deepEqual(names(join), ['Bg', 'Frame', 'Board', 'LeagueListView', 'Search', 'BtnCreate', 'BtnQuickJoin']);
    assert.deepEqual(names(create), ['PopupBg', 'TitleBg', 'TitleDeco', 'Title', 'CloseBtn',
        'BtnCreate', 'NameBg', 'Input', 'BannerListView', 'QuickJoinBox', 'QuickJoinLabel']);
    // ⚠️ 行内序照抄 `组件_联盟_联盟item` 的 `<displayList>`：
    //     `n6 底框 → lab_name → lab_lv → lab_topuser → lab_usercount → banner`。
    //     `n6 底框` 不是子节点 —— 它被折进 `LeagueRow` 节点**自身**的 `cc.Sprite`
    //     （节点自身渲染恒在子节点之下 ⇒ 正好占 displayList 的第 0 位），
    //     所以子节点序只剩「四段字 → banner」。
    assert.deepEqual(
        ((join.P('LeagueListView/content/LeagueRow')!.node._children ?? []) as unknown[]).map((c) => String(join.at(c)!._name)),
        ['Name', 'Level', 'Leader', 'Member', 'Banner']);
    // 创建页的行内序照抄 `组件_联盟_旗帜`（无底框）
    assert.deepEqual(
        ((create.P('BannerListView/content/BannerRow')!.node._children ?? []) as unknown[]).map((c) => String(create.at(c)!._name)),
        ['Frame', 'Base', 'ColorIcon']);
});

test('D5 ⚠️ 三个脚本 cid 都能从 `.ts.meta` 反解（含行模板 `LeagueUnionRow`、横向列表的 `VScrollView`）', () => {
    for (const [ctx, ts, tag] of [[tab, TAB_PAGE_TS, 'LeagueTabPage'],
        [join, JOIN_PAGE_TS, 'LeagueJoinPage'],
        [create, CREATE_PAGE_TS, 'LeagueCreatePage']] as const) {
        const cid = cidOf(ts);
        assert.ok(ctx.customCids.includes(cid), `${tag} 的 cid ${cid} 不在 prefab 里`);
        assert.ok(ctx.comp('', cid), `${tag} 没挂在根节点上`);
    }
    assert.ok(join.comp('LeagueListView/content/LeagueRow', cidOf(UNION_ROW_TS)), '行模板没挂 LeagueUnionRow');
    assert.equal(cidOf(SCROLL_TS), VSCROLL_CID, 'VirtualScrollView 的 cid 变了 ⇒ D6/D15 的硬编码要跟着改');
    assert.ok(join.comp('LeagueListView', VSCROLL_CID), '加入页列表没挂 VirtualScrollView');
    assert.ok(create.comp('BannerListView', VSCROLL_CID), '创建页列表没挂 VirtualScrollView');
});

test('D6 容器页：只挂脚本 + 两个 Prefab 引用（`leaguePage` / `joinPage`）', () => {
    const comp = tab.comp('', cidOf(TAB_PAGE_TS))!;
    assert.deepEqual([lpos(tab.root).x, lpos(tab.root).y], [0, 0]);
    assert.equal(comp.joinedPage && (comp.joinedPage as Entry).__uuid__, '7f116e19-1785-4c6e-9470-ff5ef357be79',
        'joinedPage 应指 ui/League/League.prefab');
    assert.equal(comp.joinPage && (comp.joinPage as Entry).__uuid__, '960d358e-b155-400a-b1d1-72c4b983f9c2',
        'joinPage 应指 ui/League/LeagueJoin.prefab');
    assert.deepEqual([lpos(tab.root).x, lpos(tab.root).y], [0, 0]);
});

test('D7 ⚠️ 加入页几何：逐条对 `组件_联盟_加入联盟.xml`（含「锚点非中心时 y 用顶边公式」）', () => {
    const table: Record<string, [number, number, number, number]> = {
        Bg: [0, 0, 720, 1280],                    // bg (0,0) 720×1280
        Frame: [0, 0, 720, 502],                 // n19 lm_kj_pic08 原图 720×502（XML 无 size）
        Board: [0, 498, 720, 650],               // n20 frame_Dikuang03 (0,498) 720×650
        LeagueListView: [59, 657, 614, 345],     // list_league (59,657)
        'LeagueListView/content': [59, 657, 614, 345],
        'LeagueListView/content/LeagueRow': [59, 657, 614, 113],
        Search: [97, 535, 569, 111],             // comp_search (97,535)
        'Search/SearchBg': [133, 504, 495, 141], // n0 lm_pic07 (36,-31) 相对 comp_search
        'Search/InputBg': [226, 583, 276, 47],   // n3 frame_shurukuang (129,48)
        'Search/Input': [223, 587, 276, 39],     // lab_input (126,52)
        'Search/BtnSearch': [506, 578, 65, 55],  // btn_search (409,43)
        BtnCreate: [115, 1024, 224, 79],         // btn_creat
        BtnQuickJoin: [393, 1020, 224, 79],      // btn_join（⚠️ 比 btn_creat 高 4px）
    };
    for (const [path, [left, top, w, h]] of Object.entries(table)) {
        const r = join.P(path);
        assert.ok(r, `缺节点：${path}`);
        assert.ok(near(r!.left, left) && near(r!.top, top) && near(r!.vw, w) && near(r!.vh, h),
            `${path} 视觉框应为 [${left},${top},${w},${h}]，实得 [${r!.left.toFixed(2)},${r!.top.toFixed(2)},${r!.vw.toFixed(2)},${r!.vh.toFixed(2)}]`);
    }
    // ⚠️ 列表锚点必须是 (0.5,1)：引擎按「位置点」放行 ⇒ 用中心公式会整列偏移半高
    const listAnchor = ((join.P('LeagueListView')!.node._components ?? []) as unknown[])
        .map(join.at).find((c) => c?.__type__ === 'cc.UITransform')!._anchorPoint as { x: number; y: number };
    assert.deepEqual([listAnchor.x, listAnchor.y], [0.5, 1], '纵向虚拟列表要 anchor (0.5,1) + 顶边公式');
});

test('D8 ⚠️ 加入页行内几何：坐标 = 行原点(FGUI item 左上角) + item 局部 xy（item 宽度被拉到 614）', () => {
    const R = 'LeagueListView/content/LeagueRow/';
    const table: Record<string, [number, number, number, number]> = {
        [`${R}Name`]: [182, 666, 104, 35],     // lab_name       (123,9)
        [`${R}Level`]: [183, 695, 43, 35],     // lab_lv         (124,38)
        [`${R}Leader`]: [182, 726, 296, 35],   // lab_topuser    (123,69)
        [`${R}Member`]: [477, 695, 164, 35],   // lab_usercount  (418,38)
    };
    for (const [path, [left, top, w, h]] of Object.entries(table)) {
        const r = join.P(path);
        assert.ok(r, `缺节点：${path}`);
        assert.ok(near(r!.left, left) && near(r!.top, top) && near(r!.vw, w) && near(r!.vh, h),
            `${path} 应为 [${left},${top},${w},${h}]，实得 [${r!.left.toFixed(2)},${r!.top.toFixed(2)},${r!.vw.toFixed(2)},${r!.vh.toFixed(2)}]`);
    }
    // 行是 `autoResizeItem=true` ⇒ 子项被拉到列表宽 614（FGUI item 自己 660 宽）
    assert.ok(near(join.P('LeagueListView/content/LeagueRow')!.vw, 614), '行宽应被拉到 614');
});

test('D9 ⚠️ 旗帜（pivot=(0,0)）视觉左上角 = fgui xy；三件套相对容器中心 (0,0)/(0,0)/(0.5,13.5)', () => {
    const R = 'LeagueListView/content/LeagueRow/';
    const banner = join.P(`${R}Banner`)!;
    assert.deepEqual([banner.sx, banner.sy].map((v) => Number(v.toFixed(4))), [0.54, 0.54]);
    assert.ok(near(banner.left, 81) && near(banner.top, 670), `Banner 视觉左上角应为 (81,670)，实得 (${banner.left},${banner.top})`);
    assert.ok(near(banner.vw, 96.66) && near(banner.vh, 105.84), '视觉尺寸 = 179×196 × 0.54');
    assert.ok(near(banner.vw / 0.54, 179) && near(banner.vh / 0.54, 196), '未缩放尺寸 = 179×196（槽位尺寸即权威）');
    for (const [name, rect] of Object.entries({
        Frame: [74.52, 660.82, 109.62, 124.2],     // n5 203×230 pivot(.5,.5) ⇒ 与容器同心
        Base: [84.24, 673.24, 90.18, 99.36],       // n4 167×184 pivot(.5,.5) ⇒ 与容器同心
        ColorIcon: [107.46, 695.38, 44.28, 40.5],  // icon 82×75，中心 = 容器中心 + (0.5,13.5)
    }) as Record<string, [number, number, number, number]>) {
        const r = join.P(`${R}Banner/${name}`)!;
        assert.ok(near(r.left, rect[0]) && near(r.top, rect[1]) && near(r.vw, rect[2]) && near(r.vh, rect[3]),
            `Banner/${name} 应为 [${rect.join(',')}]，实得 [${r.left.toFixed(2)},${r.top.toFixed(2)},${r.vw.toFixed(2)},${r.vh.toFixed(2)}]`);
    }
});

test('D10 ⚠️ 创建页几何：逐条对 `组件_联盟_创建联盟.xml`（板心 639.5 ⇒ 根 y = +0.5）', () => {
    const table: Record<string, [number, number, number, number]> = {
        PopupBg: [40, 343, 640, 593],              // popBg
        BtnCreate: [211, 723, 300, 130],           // btn_creat = 按钮_联盟_消耗按钮 300×130
        'BtnCreate/Bar': [231, 738, 260, 30],      // n7 white_jiao8 (20,15) 260×30
        'BtnCreate/Submit': [277, 769, 168, 46],   // n4 (66,46) 168×46
        NameBg: [172, 614, 376, 50],               // n8 frame_shurukuang
        Input: [177, 622, 366, 34],                // lab_leagueName
        BannerListView: [98, 408, 544, 206],       // list_banner
        'BannerListView/content': [98, 408, 544, 206],
        'BannerListView/content/BannerRow': [98, 413, 179, 196], // 第 0 列（vAlign=Middle ⇒ top = 408 + 5）
        QuickJoinBox: [92, 666, 50, 50],           // 按钮_勾选
        'QuickJoinBox/Box': [97.5, 671.5, 39, 39], // icon loader fill 缺省=none ⇒ 39×39 居中
        'QuickJoinBox/Check': [101, 674.5, 32, 33],// n2 32×33 居中
        QuickJoinLabel: [137, 674, 172, 34],       // n10
    };
    for (const [path, [left, top, w, h]] of Object.entries(table)) {
        const r = create.P(path);
        assert.ok(r, `缺节点：${path}`);
        assert.ok(near(r!.left, left) && near(r!.top, top) && near(r!.vw, w) && near(r!.vh, h),
            `${path} 视觉框应为 [${left},${top},${w},${h}]，实得 [${r!.left.toFixed(2)},${r!.top.toFixed(2)},${r!.vw.toFixed(2)},${r!.vh.toFixed(2)}]`);
    }
    // 骨架：中心距板顶 12.5 / 12.5 / 10 / 10（本端素材尺寸与 FGUI 不同 ⇒ 只核偏移）
    const popTop = create.P('PopupBg')!.top;
    for (const [path, want] of [['TitleBg', 12.5], ['TitleDeco', 12.5], ['Title', 10], ['CloseBtn', 10]] as const) {
        const got = create.P(path)!.cy - popTop;
        assert.ok(near(got, want), `${path} 中心距板顶应为 ${want}，实得 ${got.toFixed(2)}`);
    }
});

test('D11 ⚠️⚠️ 消耗项：`组件_公用_消耗_单个` pivot=(0.5,0.5) + scale 0.9 ⇒ 视觉左上角要补偿', () => {
    const cost = create.P('BtnCreate/Cost')!;
    // 视觉左上角(按钮内) = 84 + 0.5·(109−109·0.9) = 89.45 ；9 + 0.5·(40−40·0.9) = 11
    // 视觉中心(按钮内) = (89.45 + 49.05, 11 + 18) = (138.5, 29) ⇒ 相对按钮中心 (150,65) ⇒ cocos (−11.5, 36)
    assert.deepEqual([lpos(cost.node).x, lpos(cost.node).y], [-11.5, 36],
        '⚠️ 用「未缩放左上角」会落成 (−16.95,38)，用「未缩放中心」会落成 (−11.5,−36) —— 都不对');
    assert.deepEqual([cost.sx, cost.sy], [0.9, 0.9]);
    assert.ok(near(cost.vw / 0.9, 109) && near(cost.vh / 0.9, 40), '未缩放尺寸 = 109×40');
    assert.ok(near(cost.left, 300.45) && near(cost.top, 734) && near(cost.vw, 98.1) && near(cost.vh, 36),
        `Cost 视觉框应为 [300.45,734,98.1,36]，实得 [${cost.left.toFixed(2)},${cost.top.toFixed(2)},${cost.vw.toFixed(2)},${cost.vh.toFixed(2)}]`);
    // 内层三件（相对 Cost 的**未缩放**坐标，随 0.9 一起缩）
    for (const [name, rect] of Object.entries({
        CostIcon: [304.05, 735.8, 31.5, 31.5], // icon (4,2) 35×35 pivot(.5,.5)
        Has: [338.25, 735.8, 34.2, 31.5],      // lab_has (42,2) 38×35（无 pivot）
        Need: [370.65, 735.8, 23.4, 30.6],     // lab_need (78,2) 26×34（无 pivot）
    }) as Record<string, [number, number, number, number]>) {
        const r = create.P(`BtnCreate/Cost/${name}`)!;
        assert.ok(near(r.left, rect[0]) && near(r.top, rect[1]) && near(r.vw, rect[2]) && near(r.vh, rect[3]),
            `Cost/${name} 应为 [${rect.join(',')}]，实得 [${r.left.toFixed(2)},${r.top.toFixed(2)},${r.vw.toFixed(2)},${r.vh.toFixed(2)}]`);
    }
});

test('D12 旗帜八色列表（pivot=(0,0)、无 scale）三件套 = 容器中心 ± 已知偏移', () => {
    const B = 'BannerListView/content/BannerRow/';
    for (const [name, rect] of Object.entries({
        Frame: [86, 396, 203, 230],
        Base: [104, 419, 167, 184],
        ColorIcon: [147, 460, 82, 75],
    }) as Record<string, [number, number, number, number]>) {
        const r = create.P(`${B}${name}`)!;
        assert.ok(near(r.left, rect[0]) && near(r.top, rect[1]) && near(r.vw, rect[2]) && near(r.vh, rect[3]),
            `${B}${name} 应为 [${rect.join(',')}]，实得 [${r.left.toFixed(2)},${r.top.toFixed(2)},${r.vw.toFixed(2)},${r.vh.toFixed(2)}]`);
    }
    // item 是 `组件_联盟_旗帜`（无底框）⇒ 行模板不该有 Sprite
    assert.equal(create.comp(B.slice(0, -1), 'cc.Sprite'), null, '创建页行模板不带底框');
    // 加入页的行反之（item = 组件_联盟_联盟item，带 frame_Zhikuang01）
    assert.equal(uuidOf(join.comp('LeagueListView/content/LeagueRow', 'cc.Sprite')), U.rowBg);
});

test('D13 Sprite 口径：贴图逐条对、`_sizeMode` 全 CUSTOM、`_type` 与九宫格集合一致', () => {
    const slicedJoin = new Set([U.board, U.rowBg, U.pic07, U.input]);
    const slicedCreate = new Set([U.popup, U.input, U.jiao8, U.checkBg, U.btn21]);
    const expectJoin: Record<string, string> = {
        Bg: U.bg, Frame: U.frame, Board: U.board,
        'LeagueListView/content/LeagueRow': U.rowBg,
        'LeagueListView/content/LeagueRow/Banner/Frame': U.qizhi02,
        'LeagueListView/content/LeagueRow/Banner/Base': U.lm07,
        'LeagueListView/content/LeagueRow/Banner/ColorIcon': U.qizhi06,
        'Search/SearchBg': U.pic07, 'Search/InputBg': U.input, 'Search/BtnSearch': U.search,
        BtnCreate: U.btn24, BtnQuickJoin: U.btn20,
    };
    const expectCreate: Record<string, string> = {
        PopupBg: U.popup, TitleBg: U.title01, TitleDeco: U.title02, CloseBtn: U.close,
        BtnCreate: U.btn21, 'BtnCreate/Bar': U.jiao8, NameBg: U.input,
        'BannerListView/content/BannerRow/Frame': U.qizhi02,
        'BannerListView/content/BannerRow/Base': U.lm07,
        'BannerListView/content/BannerRow/ColorIcon': U.qizhi06,
        'QuickJoinBox/Box': U.checkBg, 'QuickJoinBox/Check': U.checkMark,
    };
    for (const [ctx, tag, expect, sliced] of [
        [join, '加入页', expectJoin, slicedJoin],
        [create, '创建页', expectCreate, slicedCreate],
    ] as const) {
        for (const [path, uuid] of Object.entries(expect)) {
            assert.equal(uuidOf(ctx.comp(path, 'cc.Sprite')), uuid, `${tag} ${path} 的贴图不对`);
        }
        for (const [path, r] of ctx.byPath) {
            const sp = ((r.node._components ?? []) as unknown[]).map(ctx.at).find((c) => c?.__type__ === 'cc.Sprite');
            if (!sp || sp._spriteFrame == null) continue;
            assert.equal(sp._sizeMode, 0, `${tag} ${path} 的 sizeMode 应为 CUSTOM(0)`);
            assert.equal(sp._type === 1, sliced.has(uuidOf(sp)!), `${tag} ${path} 的九宫格口径与图不符（uuid=${uuidOf(sp)}）`);
        }
    }
    // 消耗图标：运行时按表换帧（FGUI `clearOnPublish`）⇒ 无帧 + CUSTOM
    const costIcon = create.comp('BtnCreate/Cost/CostIcon', 'cc.Sprite')!;
    assert.equal(costIcon._spriteFrame, null);
    assert.equal(costIcon._sizeMode, 0);
});

test('D14 Label 口径：数量 + 文案 / 字号 / 颜色 / 对齐 / 粗体 / 描边 逐项对 FGUI', () => {
    const countLabels = (ctx: ReturnType<typeof openPrefab>): number =>
        ctx.nodes.reduce((a, n) => a + ((n._components ?? []) as unknown[]).map(ctx.at).filter((c) => c?.__type__ === 'cc.Label').length, 0);
    assert.equal(countLabels(join), 8, '加入页 8 个 Label');
    assert.equal(countLabels(create), 7, '创建页 7 个 Label');

    /** `[文字, 字号, rgb, hAlign, vAlign, bold, 描边(rgb,w) | null]` */
    type Style = [string, number, [number, number, number], number, number, boolean, [string, number] | null];
    const check = (ctx: ReturnType<typeof openPrefab>, tag: string, table: Record<string, Style>): void => {
        for (const [path, [text, fs, rgb, ha, va, bold, outline]] of Object.entries(table)) {
            const lb = ctx.comp(path, 'cc.Label');
            assert.ok(lb, `${tag} 缺 Label：${path}`);
            assert.equal(lb!._string, text, `${tag} ${path} 文案`);
            assert.equal(lb!._fontSize, fs, `${tag} ${path} 字号`);
            const c = lb!._color as { r: number; g: number; b: number };
            assert.deepEqual([c.r, c.g, c.b], rgb, `${tag} ${path} 颜色`);
            assert.equal(lb!._horizontalAlign, ha, `${tag} ${path} 水平对齐`);
            assert.equal(lb!._verticalAlign, va, `${tag} ${path} 垂直对齐`);
            assert.equal(lb!._isBold, bold, `${tag} ${path} 粗体`);
            assert.equal(lb!._enableOutline, outline !== null, `${tag} ${path} 描边开关`);
            if (outline) {
                const oc = lb!._outlineColor as { r: number; g: number; b: number };
                const want = [parseInt(outline[0].slice(1, 3), 16), parseInt(outline[0].slice(3, 5), 16), parseInt(outline[0].slice(5, 7), 16)];
                assert.deepEqual([oc.r, oc.g, oc.b], want, `${tag} ${path} 描边色`);
                assert.ok(near(lb!._outlineWidth as number, outline[1]), `${tag} ${path} 描边宽`);
            }
        }
    };
    check(join, '加入页', {
        'LeagueListView/content/LeagueRow/Name': ['阿尔萨斯', 25, [27, 20, 16], 1, 0, false, null],
        'LeagueListView/content/LeagueRow/Level': ['6级', 25, [27, 20, 16], 1, 0, false, null],
        'LeagueListView/content/LeagueRow/Leader': ['盟主:xxxx', 25, [27, 20, 16], 0, 0, false, null],
        'LeagueListView/content/LeagueRow/Member': ['成员:45/46', 25, [27, 20, 16], 0, 0, false, null],
        'Search/Input/Placeholder': ['点击输入ID', 26, [59, 45, 13], 1, 1, false, null],
        // ⚠️ 正文 label 的 vAlign 会被 `cc.EditBox` 回写成 0 ⇒ 必须与占位一致（FGUI `vAlign=middle`）
        'Search/Input/Text': ['', 26, [59, 45, 13], 1, 1, false, null],
        'BtnCreate/Label': ['创建联盟', 35, [252, 240, 214], 1, 1, true, ['#110b08', 2]],
        'BtnQuickJoin/Label': ['快速加入', 35, [252, 240, 214], 1, 1, true, ['#110b08', 2]],
    });
    check(create, '创建页', {
        Title: ['创建联盟', 30, [255, 246, 196], 1, 1, true, ['#160e08', 3]],
        'BtnCreate/Submit': ['创建', 34, [252, 240, 214], 1, 1, true, ['#160e08', 2]],
        'BtnCreate/Cost/Has': ['10/', 25, [230, 229, 217], 0, 1, false, ['#181614', 2]],
        'BtnCreate/Cost/Need': ['10', 24, [230, 229, 217], 0, 1, false, ['#181614', 2]],
        'Input/Placeholder': ['点击输入联盟名称', 24, [255, 249, 246], 1, 1, true, ['#160e08', 1]],
        'Input/Text': ['', 24, [255, 249, 246], 1, 1, true, ['#160e08', 1]],
        QuickJoinLabel: ['允许快速加入', 24, [252, 240, 214], 0, 1, false, ['#160e08', 2]],
    });
    // 按钮内文案一律 y = −1（`按钮_公共_通用` 的 `Top_Middle` 解算：中心恒为 h/2 + 1）
    for (const path of ['BtnCreate/Label', 'BtnQuickJoin/Label']) {
        assert.ok(near(lpos(join.P(path)!.node).y, -1), `${path} 的 y 应为 −1`);
    }
});

test('D15 ⚠️ 两张列表的装配：加入页纵向、创建页横向（FGUI `flow_vt` + `colGap=1`）', () => {
    const jv = join.comp('LeagueListView', VSCROLL_CID)!;
    assert.equal(jv.useVirtualList, true);
    assert.equal(jv.itemCreationMode, 0, '0 = NODE（默认 1 = PREFAB 时拿不到 itemNode）');
    assert.equal(join.refPath(jv.content), 'LeagueJoin/LeagueListView/content');
    assert.equal(join.refPath(jv.itemNode), 'LeagueJoin/LeagueListView/content/LeagueRow');
    assert.equal(jv.direction, 0, '纵向');
    assert.ok(near(jv.spacing as number, 0), 'FGUI 没写 lineGap ⇒ 0');
    assert.ok(near(jv.gridCount as number, 1));
    assert.equal(jv.autoCenter, false, '引擎缺省 false ⇒ 不做视口居中（FGUI 的 align 只在内容 < 视口时生效）');
    assert.ok(join.comp('LeagueListView', 'cc.Mask'), 'FGUI overflow="scroll" ⇒ 必须有 Mask');

    const cv = create.comp('BannerListView', VSCROLL_CID)!;
    assert.equal(cv.useVirtualList, true);
    assert.equal(create.refPath(cv.content), 'LeagueCreate/BannerListView/content');
    assert.equal(create.refPath(cv.itemNode), 'LeagueCreate/BannerListView/content/BannerRow');
    assert.equal(cv.direction, 1, '横向');
    assert.ok(near(cv.spacing as number, 1), 'FGUI colGap="1"');
    assert.ok(near(cv.gridCount as number, 1));
    assert.equal(cv.autoCenter, false);
    assert.ok(create.comp('BannerListView', 'cc.Mask'));
    // 第 0 列烘在 prefab 里的位置 = 运行期 `_layoutSingleSlot` 会算出的值
    //   x = itemMainSize·anchorX = 179·0.5 = 89.5 ；y = totalHeight/2 − itemCrossSize/2 = 0
    assert.deepEqual([lpos(create.P('BannerListView/content/BannerRow')!.node).x,
        lpos(create.P('BannerListView/content/BannerRow')!.node).y], [89.5, 0]);
});

test('D16 ⚠️ 两个 EditBox：盒尺寸/键盘/长度不同，但**两个 label 的锚点口径必须一致** = (0,1) + 框左上角', () => {
    // 加入页：276×39 宽扁盒 + restrict="[0-9]" ⇒ 数字键盘。
    // ⚠️⚠️ 两个 label **不能用 (0.5,0.5)**：`cc.EditBox._updateLabelPosition()` 摆的是
    //   「框左上角 + (2,0)」这个**绝对**位置，只有锚点 (0,1) 时它才等于「文字的左上角」。
    //   用 (0.5,0.5) 时真引擎实测：文字顶边贴住框顶边、文字中心落在框高的 **0.667** 处
    //   （应 0.5）⇒ 整体偏上 6.5 画布像素，视觉上像跑到框外（探针 1C.6 + 放大截图抓到的）。
    const jeb = join.comp('Search/Input', 'cc.EditBox')!;
    assert.equal(jeb._inputMode, 2, 'NUMERIC');
    assert.equal(jeb._maxLength, 19, '联盟 id 是 Long ⇒ 十进制最多 19 位（FGUI 的 0 打不进字）');
    assert.equal(join.refPath(jeb._placeholderLabel), 'LeagueJoin/Search/Input/Placeholder');
    assert.equal(join.refPath(jeb._textLabel), 'LeagueJoin/Search/Input/Text');
    for (const p of ['Search/Input/Placeholder', 'Search/Input/Text']) {
        const r = join.P(p)!;
        const anchor = (((r.node._components ?? []) as unknown[]).map(join.at).find((c) => c?.__type__ === 'cc.UITransform')!._anchorPoint) as { x: number; y: number };
        assert.deepEqual([anchor.x, anchor.y], [0, 1], `${p} 锚点必须是 (0,1)`);
        // 276×39 ⇒ 框左上角 = (−138, +19.5)
        assert.deepEqual([lpos(r.node).x, lpos(r.node).y], [-138, 19.5], `${p} lpos = 框左上角`);
        // FGUI `GTextInput` 构造写死 `singleLine=false` ⇒ 多行 ⇒ 开换行（与创建页同判据）
        assert.equal(join.comp(p, 'cc.Label')!._enableWrapText, true, `${p} 多行 ⇒ enableWrapText`);
    }

    // 创建页：366×34 宽扁盒 + FGUI `singleLine=false`（解 bin 定死）⇒ 多行；两 label 必须 (0,1) + 框左上角
    const ceb = create.comp('Input', 'cc.EditBox')!;
    assert.equal(ceb._inputMode, 0, 'ANY（多行）');
    assert.equal(ceb._returnType, 0, 'DEFAULT（回车换行）');
    assert.equal(ceb._maxLength, 20, 'FGUI 是 0（不限）；cocos 的 0 会原样传成原生 maxlength=0');
    assert.equal(create.refPath(ceb._placeholderLabel), 'LeagueCreate/Input/Placeholder');
    assert.equal(create.refPath(ceb._textLabel), 'LeagueCreate/Input/Text');
    for (const p of ['Input/Placeholder', 'Input/Text']) {
        const r = create.P(p)!;
        const anchor = (((r.node._components ?? []) as unknown[]).map(create.at).find((c) => c?.__type__ === 'cc.UITransform')!._anchorPoint) as { x: number; y: number };
        assert.deepEqual([anchor.x, anchor.y], [0, 1],
            `${p} 多行盒必须 (0,1)：cc.EditBox 会把两个 label 强制重排到「框左上角」，用 (0.5,0.5) 文字会跑出框外且不报错`);
        assert.deepEqual([lpos(r.node).x, lpos(r.node).y], [-183, 17], `${p} lpos = 框左上角`);
        assert.equal(create.comp(p, 'cc.Label')!._enableWrapText, true, `${p} 多行要开换行`);
    }
    // 两个 EditBox 的默认 label（`label`）都该被删干净
    for (const [ctx, tag] of [[join, '加入页'], [create, '创建页']] as const) {
        const stray = [...ctx.byPath.keys()].filter((p) => /\/label$/.test(p));
        assert.deepEqual(stray, [], `${tag} 残留了 cc.EditBox 自动生成的 label：${stray.join(',')}`);
    }
});

test('D17 @property 绑定：加入页 5 / 创建页 9 / 容器页 2（逐条对节点）', () => {
    const jc = join.comp('', cidOf(JOIN_PAGE_TS))!;
    for (const [prop, want] of [
        ['searchButton', 'LeagueJoin/Search/BtnSearch'],
        ['searchInput', 'LeagueJoin/Search/Input'],
        ['unionList', 'LeagueJoin/LeagueListView'],
        ['createButton', 'LeagueJoin/BtnCreate'],
        ['quickJoinButton', 'LeagueJoin/BtnQuickJoin'],
    ] as const) {
        assert.equal(join.refPath(jc[prop]), want, `${prop} 应绑到 ${want}`);
    }
    const cc = create.comp('', cidOf(CREATE_PAGE_TS))!;
    for (const [prop, want] of [
        ['closeButton', 'LeagueCreate/CloseBtn'],
        ['nameInput', 'LeagueCreate/Input'],
        ['bannerList', 'LeagueCreate/BannerListView'],
        ['quickJoinBox', 'LeagueCreate/QuickJoinBox'],
        ['quickJoinCheck', 'LeagueCreate/QuickJoinBox/Check'],
        ['costButton', 'LeagueCreate/BtnCreate'],
        ['costIcon', 'LeagueCreate/BtnCreate/Cost/CostIcon'],
        ['costHasLabel', 'LeagueCreate/BtnCreate/Cost/Has'],
        ['costNeedLabel', 'LeagueCreate/BtnCreate/Cost/Need'],
    ] as const) {
        assert.equal(create.refPath(cc[prop]), want, `${prop} 应绑到 ${want}`);
    }
    // 行模板 5 个属性
    const rc = join.comp('LeagueListView/content/LeagueRow', cidOf(UNION_ROW_TS))!;
    for (const [prop, want] of [
        ['nameLabel', 'LeagueJoin/LeagueListView/content/LeagueRow/Name'],
        ['levelLabel', 'LeagueJoin/LeagueListView/content/LeagueRow/Level'],
        ['leaderLabel', 'LeagueJoin/LeagueListView/content/LeagueRow/Leader'],
        ['memberLabel', 'LeagueJoin/LeagueListView/content/LeagueRow/Member'],
        ['bannerColor', 'LeagueJoin/LeagueListView/content/LeagueRow/Banner/ColorIcon'],
    ] as const) {
        assert.equal(join.refPath(rc[prop]), want, `行 ${prop} 应绑到 ${want}`);
    }
});

test('D18 ⚠️ prefab 里每个 `cc.Button` 都必须被某个 `@property` 覆盖（否则就是死按钮）', () => {
    const covered = (ctx: ReturnType<typeof openPrefab>, comps: Entry[]): Set<string> => {
        const out = new Set<string>();
        for (const comp of comps) for (const v of Object.values(comp)) {
            const rp = ctx.refPath(v);
            if (rp) out.add(rp);
        }
        return out;
    };
    const buttonsOf = (ctx: ReturnType<typeof openPrefab>): string[] =>
        [...ctx.byPath.entries()]
            .filter(([, r]) => ((r.node._components ?? []) as unknown[]).map(ctx.at).some((c) => c?.__type__ === 'cc.Button'))
            .map(([p]) => p);

    const jButtons = buttonsOf(join);
    assert.equal(jButtons.length, 3, `加入页应 3 个 cc.Button（Search/BtnSearch + BtnCreate + BtnQuickJoin），实得 ${jButtons.length}`);
    const jCovered = covered(join, [join.comp('', cidOf(JOIN_PAGE_TS))!]);
    for (const b of jButtons) assert.ok(jCovered.has(b), `加入页按钮 ${b} 没被任何 @property 引用（死按钮）`);

    const cButtons = buttonsOf(create);
    assert.equal(cButtons.length, 3, `创建页应 3 个 cc.Button（CloseBtn / BtnCreate / QuickJoinBox），实得 ${cButtons.length}`);
    const cCovered = covered(create, [create.comp('', cidOf(CREATE_PAGE_TS))!]);
    for (const b of cButtons) assert.ok(cCovered.has(b), `创建页按钮 ${b} 没被任何 @property 引用（死按钮）`);
});

test('D19 ⚠️ 按下态：只有 `CloseBtn` / 两颗颗粒按钮 / 查询钮走 SCALE 0.9；消耗按钮与勾选框不走', () => {
    for (const [ctx, tag, path] of [
        [join, '加入页', 'BtnCreate'], [join, '加入页', 'BtnQuickJoin'], [join, '加入页', 'Search/BtnSearch'],
        [create, '创建页', 'CloseBtn'],
    ] as const) {
        const b = ctx.comp(path, 'cc.Button')!;
        assert.equal(b._transition, 3, `${tag} ${path} 应有 SCALE 按下态`);
        assert.ok(near(b._zoomScale as number, 0.9), `${tag} ${path} 的 zoomScale 应为 0.9`);
    }
    // 消耗按钮 / 勾选框：FGUI 只写了 <Button/>（无 downEffect）⇒ transition = NONE
    for (const [path, why] of [['BtnCreate', '按钮_联盟_消耗按钮 只写了 <Button/>'],
        ['QuickJoinBox', '公用_按钮_勾选 没有 downEffect']] as const) {
        const b = create.comp(path, 'cc.Button')!;
        assert.ok(b, `创建页 ${path} 应挂 cc.Button`);
        assert.equal(b._transition, 0, `${path} 不该有 SCALE 按下态（${why}）`);
    }
});

test('D20 ⚠️ 小零碎：勾选框默认已勾、衬底色、列表不落的节点', () => {
    // FGUI `<Button checked="true"/>` ⇒ 默认勾上
    assert.equal(create.P('QuickJoinBox/Check')!.node._active, true, '勾选框默认已勾');
    // 无文字时隐藏（免得占位）
    assert.equal(join.P('Search/Input/Text')!.node._active, false);
    assert.equal(create.P('Input/Text')!.node._active, false);
    // Bar 衬底：color #666666 + alpha 0.4
    const bar = create.comp('BtnCreate/Bar', 'cc.Sprite')!._color as { r: number; g: number; b: number; a: number };
    assert.deepEqual([bar.r, bar.g, bar.b, bar.a], [0x66, 0x66, 0x66, 102]);
    // 不落的 FGUI 节点
    const all = [...join.byPath.keys()].join(' ');
    for (const n of ['n13', 'n14', 'n18', '组件_通用_全面屏适配']) {
        assert.ok(!all.includes(n), `加入页不该落 ${n}`);
    }
});

// ============================================================
// E. 页面逻辑 / 调用约定（源码文本）
// ============================================================

test('E1 ⚠️ 容器页：按 `IsJoinedLeague` 实例化两页之一（`joinedPage` / `joinPage`）', () => {
    // ⚠️ 必须去注释再判：文件头的长注释里**故意**写了 `CacheMgr` / `GameCacheMgr`
    //    （解释「为什么不能挂监听」），直接判原文会误报。
    const src = stripComments(readFileSync(TAB_PAGE_TS, 'utf8'));
    assert.ok(src.includes('LeagueTabPage'), '类名');
    assert.ok(/@property\(\{\s*type:\s*Prefab\b/.test(src), '两个页面是 Prefab 引用');
    assert.ok(src.includes('joinedPage') && src.includes('joinPage'), '两个 @property 名');
    assert.ok(src.includes('instantiate'), '用 instantiate 造页');
    assert.ok(src.includes('setParent(this.node)') || src.includes('setParent('), '挂到自己下面');
    assert.ok(src.includes('Vec3.ZERO'), '摆到原点（页面自带绝对版面）');
    assert.ok(!/GameCacheMgr|CacheMgr\.\w+\.on\(/.test(src), '⚠️ CacheMgr 没有变更事件 ⇒ 只能靠写操作回敲，不能挂监听');
});

test('E2 ⚠️ 加入页：按钮文案「只填空的」（不覆盖 prefab 已写好的）', () => {
    const src = stripComments(readFileSync(JOIN_PAGE_TS, 'utf8'));
    assert.ok(src.includes('setLabelIfEmpty(this.createButton, LEAGUE_JOIN_BTN_CREATE)'));
    assert.ok(src.includes('setLabelIfEmpty(this.quickJoinButton, LEAGUE_JOIN_BTN_QUICK)'));
    assert.ok(/function setLabelIfEmpty\(/.test(src), 'helper 要在同一文件里定义');
    assert.ok(!/\.string\s*=\s*LEAGUE_JOIN_BTN/.test(src), '别无条件覆盖（prefab 里已经有文案）');
});

test('E3 ⚠️ 加入页：查询框 placeholder + 输入过滤 + 一定走 `pickQuickJoinIdsFor`', () => {
    const src = stripComments(readFileSync(JOIN_PAGE_TS, 'utf8'));
    assert.ok(src.includes('placeholderLabel'), 'placeholder 走 EditBox 的 placeholderLabel');
    assert.ok(src.includes('LEAGUE_HALL_SEARCH_PROMPT'));
    assert.ok(src.includes('sanitizeLeagueSearchInput'), '粘贴旁路过滤');
    assert.ok(src.includes('pickQuickJoinIdsFor'), '⚠️ 不能只调 pickQuickJoinUnionIds（会漏掉「搜索缓存」那一支）');
});

test('E4 ⚠️ 加入页：刷新列表必须 defer 一帧（虚拟列表槽位还没建）', () => {
    const src = stripComments(readFileSync(JOIN_PAGE_TS, 'utf8'));
    const i = src.indexOf('.refreshList(');
    assert.ok(i > 0, '找不到 refreshList');
    const before = src.slice(0, i);
    assert.ok(/scheduleOnce|nextFrame|setTimeout|defer|setTimeoutFrame/i.test(before.slice(-1200)) ||
        /refreshList\s*\(\s*\)\s*\{[\s\S]{0,400}?scheduleOnce/.test(src),
        'refreshList 前要有让帧（本工程口径：defer 一帧，否则列表空白）');
    assert.ok(src.includes('onJoined'), '加入成功后要回敲容器页');
});

test('E5 ⚠️ 创建页：勾选框同步 + 名字守卫 + 消耗两态换色 + 成功后关窗回敲', () => {
    const src = stripComments(readFileSync(CREATE_PAGE_TS, 'utf8'));
    // 勾选框：读写都落到 quickJoinCheck.active（FGUI 用 gearDisplay 控制勾的显隐，不是换图）
    assert.ok(src.includes('quickJoinCheck'), '勾选框的显隐靠 quickJoinCheck');
    assert.ok(!/quickJoinCheck[\s\S]{0,40}spriteFrame/.test(src), '勾选框不是换帧，是 active 开关');
    // 名字守卫：走 isLeagueNameUsable（空 / '***' 都拒）
    assert.ok(src.includes('isLeagueNameUsable'));
    // 消耗两态：换色走 LeagueArt 的四色常量
    assert.ok(src.includes('LEAGUE_COST_ENOUGH_COLOR') && src.includes('LEAGUE_COST_SHORT_COLOR'),
        '`lab_has` 两态换色');
    assert.ok(src.includes('LEAGUE_COST_ENOUGH_STROKE') && src.includes('LEAGUE_COST_SHORT_STROKE'),
        '描边也要跟着换');
    assert.ok(src.includes('LEAGUE_COST_ENOUGH_COLOR') && !/costNeedLabel[\s\S]{0,200}LEAGUE_COST_SHORT_COLOR/.test(src),
        '⚠️ `lab_need` 恒用「够」那一色（FGUI 的 lab_need 没有 gearColor）');
    // 三个静态文案都从 LeagueTexts 取
    assert.ok(src.includes('LEAGUE_CREATE_TITLE') && src.includes('LEAGUE_CREATE_SUBMIT') &&
        src.includes('LEAGUE_CREATE_NAME_PROMPT') && src.includes('LEAGUE_CREATE_QUICK_JOIN'));
    // ⚠️ 「允许快速加入」的节点是根下的兄弟（不是在 QuickJoinBox 里）
    assert.ok(src.includes('QUICK_JOIN_LABEL_NODE') && src.includes("'QuickJoinLabel'"),
        '要按兄弟名取 label（getComponentInChildren 在盒子里找不到）');
    assert.ok(src.includes('onCreated'), '建盟成功后回敲');
});

test('E6 三个页面类里不出现死写文案（一律从 LeagueTexts 取）', () => {
    for (const [ts, literals] of [
        [JOIN_PAGE_TS, ['创建联盟', '快速加入', '点击输入ID']],
        [CREATE_PAGE_TS, ['创建联盟', '点击输入联盟名称', '允许快速加入', '创建']],
    ] as const) {
        const src = stripComments(readFileSync(ts, 'utf8'));
        for (const literal of literals) {
            assert.ok(!src.includes(`'${literal}'`), `${ts} 里不要写死文案「${literal}」`);
        }
    }
});

test('E7 ⚠️ 三个页面类都不直接读缓存做刷新判定（`GameCacheMgr` 没有变更事件）', () => {
    for (const ts of [TAB_PAGE_TS, JOIN_PAGE_TS, CREATE_PAGE_TS]) {
        const src = stripComments(readFileSync(ts, 'utf8'));
        assert.ok(!/\bGameCacheMgr\b/.test(src), `${ts} 不该直接用 GameCacheMgr`);
    }
});
