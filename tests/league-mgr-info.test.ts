/**
 * 「联盟」P2 **第五刀**（管理 + 联盟信息）的回归网。
 *
 * 与 `league-hall.test.ts` / `league-hall-sub.test.ts` / `league-hall-tabs.test.ts` /
 * `league-apply-edit.test.ts` 同一套五段口径：
 *
 *   A. **文案口径**（`LeagueTexts`）—— 管理与联盟信息两条新段。
 *   B. **美术口径**（`LeagueArt`）—— 第五刀新纳的两张图（`TY_btn06` / `shaixuan_dikuang`，
 *      都是**真**九宫格 ⇒ 必须进 `LEAGUE_ART_SLICED`），勾图复用 `image/sevenDay/sd_check`。
 *   C. **数据口径**（`LeagueTable`）—— `buildLeagueMgrView` / `leagueMgrPage` /
 *      `buildLeagueInfoView*` / `ILeagueUnionView.wxChat|declaration` 透传。
 *   D. **prefab 结构 + 几何**（`ui/League/LeagueMgr.prefab`、`ui/League/LeagueInfo.prefab`）——
 *      cid 反解、全 UI_2D、顶层序、全部视觉框（**逐条对 FGUI 原 XML**）、九宫格、
 *      `@f9941` 可解析、`@property` 绑定全覆盖、**「管理」controller 页 0 的落地默认态**。
 *   E. **页面逻辑 / 调用约定**（源码文本）—— `onClose` 才发快速加入、编辑入口传**裸值**、
 *      `join` 走数组协议 + 防连点、静态 import。
 *
 * ## 口径真源
 *
 *   - 设计：`zarts/art/UIProject/trunk/UIProject/assets/主界面_联盟/大厅/组件_联盟_大厅_管理.xml`
 *     `…/大厅/组件_联盟_大厅_联盟信息.xml`、`…/组件/组件_联盟_告示.xml`、
 *     `…/组件/组件_联盟_旗帜.xml`、`共用组件/组件/弹窗/组件_公共弹窗_新.xml`、
 *     `共用组件/组件/按钮/按钮_公共_通用.xml`、`共用组件/组件/按钮/公用_按钮_勾选.xml`、
 *     `公用0/package.xml`（图 id → 文件名 + `scale9grid` 反查）
 *   - 老端：`client/assets/script/app/game/ctrl/main/league/play/LayerLeagueHallMgr.ts`、
 *     `…/LayerLeagueInfo.ts`
 *   - 本项目：`assets/script/app/league/**`、assetPath(`ui/League/*.prefab`)
 *
 * ## ⚠️ 本刀最值得记住的一条：**`autoSize` 缺省的 text 不能落 `overflow = NONE`**
 *
 * FGUI `<text>` **没写** `autoSize` 时默认 `both`（盒 = 文字自然尺寸）。落到 cocos 时很自然会
 * 写成 `cc.Label._overflow = NONE(0)`，但 NONE 会让 Label 在**渲染阶段回写 node 的
 * `contentSize`** —— 实测 `58×36` 被改成 `56×54.4`（多行量法），且回写发生在「写 UITransform
 * 尺寸」那一步**之后**，先写尺寸也防不住；又因为锚点是 `(0.5,0.5)`，盒一变左边界就跟着漂
 * （`LeagueName` 漂 1px、`LeagueLeader` 漂 3.25px），表现为「面板整体看着对、个别字偏了一点」。
 *
 * ⇒ **口径 = `SHRINK(2)` + FGUI 盒尺寸**：盒本来就是按自然尺寸量出来的，SHRINK 在盒内不触发
 * 缩放 ⇒ 视觉等价且尺寸确定。这条与 `_level_preview_build.mjs` 的注释「同 P2 母面板口径」一致。
 *
 * ## ⚠️ 第二条：**`gearDisplay` 要落成 `active`，且 `selected` 决定落地默认态**
 *
 * `管理` controller 的 `selected="0"`（页「否」）⇒ 落地时 `btn_mgr` / `btn_quit` /
 * `按钮_勾选` / `n23` 四个节点**必须是 `active: false`**，只有 `btn_quit1` 亮。
 * 漏掉任意一个，「不能审批的人」进面板就会看到「申请管理」按钮。
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import {
    LEAGUE_ART_BTN_JOIN,
    LEAGUE_ART_CHECK_BG,
    LEAGUE_ART_CHECK_MARK,
    LEAGUE_ART_CHECK_MARK_ROOT,
    LEAGUE_ART_INFO_BANNER_BG,
    LEAGUE_ART_INFO_BANNER_BG_ALPHA,
    LEAGUE_ART_INFO_BANNER_BG_TINT,
    LEAGUE_ART_NOTICE_BOX_BG,
    LEAGUE_ART_NOTICE_BOX_TITLE_BAR,
    LEAGUE_ART_POPUP_BOARD,
    LEAGUE_ART_POPUP_CLOSE,
    LEAGUE_ART_POPUP_TITLE_BG,
    LEAGUE_ART_POPUP_TITLE_DECO,
    LEAGUE_ART_SLICED,
    LEAGUE_SHARED_CHECK_NAME,
    LEAGUE_SHARED_CHECK_ROOT,
    LEAGUE_SPRITE_SIMPLE,
    LEAGUE_SPRITE_SLICED,
    leagueSpriteType,
} from '../assets/script/app/league/LeagueArt';
import {
    buildLeagueInfoView,
    buildLeagueInfoViewFromUnionView,
    buildLeagueMgrView,
    buildLeagueUnionViews,
    canApproveJoin,
    canEditUnion,
    leagueMgrPage,
    type ILeagueInfoTexts,
    type ILeagueMgrTexts,
    type ILeagueOfficialRow,
    type ILeagueUnionRow,
    type ILeagueUnionTexts,
} from '../assets/script/app/league/LeagueTable';
import {
    LEAGUE_HALL_ID_PREFIX,
    LEAGUE_HALL_LV_SUFFIX,
    LEAGUE_HALL_WX_PREFIX,
    LEAGUE_INFO_DECLARATION_TITLE,
    LEAGUE_INFO_JOIN,
    LEAGUE_INFO_NOT_FOUND,
    LEAGUE_INFO_TITLE,
    LEAGUE_MGR_APPLY,
    LEAGUE_MGR_DECLARATION_TITLE,
    LEAGUE_MGR_NOTICE_TITLE,
    LEAGUE_MGR_QUICK_JOIN,
    LEAGUE_MGR_QUIT,
    LEAGUE_MGR_TITLE,
    LEAGUE_UNION_LEADER_PREFIX,
    LEAGUE_UNION_MEMBER_PREFIX,
} from '../assets/script/app/league/LeagueTexts';
import { assetExists, assetPath } from './helpers/asset-paths';

// ============================================================
// A. 文案口径
// ============================================================

test('A1 管理：标题 / 两个告示块标题 / 三颗按钮文案 = FGUI 原稿', () => {
    assert.equal(LEAGUE_MGR_TITLE, '联盟管理');                  // popBg 的 <Label title="联盟管理"/>
    assert.equal(LEAGUE_MGR_DECLARATION_TITLE, '联盟宣言');       // comp_dec 的 <property target="title"/>
    assert.equal(LEAGUE_MGR_NOTICE_TITLE, '联盟公告');            // comp_notice 同上
    assert.equal(LEAGUE_MGR_APPLY, '申请管理');                   // btn_mgr title
    assert.equal(LEAGUE_MGR_QUIT, '退出联盟');                    // btn_quit / btn_quit1 title
    assert.equal(LEAGUE_MGR_QUICK_JOIN, '允许快速加入');          // n23 text
});

test('A2 管理：「退出联盟」两颗按钮**共用同一个常量**（FGUI 里是两颗同名按钮）', () => {
    // `btn_quit` / `btn_quit1` 文案一致，落地不拆成两个常量 —— 若哪天真拆了，
    // 这条会红，提醒去核对 prefab 上 BtnQuit/Label 与 BtnQuitOnly/Label 是不是也一起改了。
    assert.equal(LEAGUE_MGR_QUIT, '退出联盟');
    assert.equal(LEAGUE_MGR_QUIT.length, 4, '「退出联盟」4 个字');
});

test('A3 联盟信息：标题 / 宣言块标题 / 「加入」/ 兜底提示 = FGUI + `mL.json` 原稿', () => {
    assert.equal(LEAGUE_INFO_TITLE, '联盟信息');
    assert.equal(LEAGUE_INFO_DECLARATION_TITLE, '联盟宣言');
    assert.equal(LEAGUE_INFO_JOIN, '加入');                       // btn_join title
    assert.equal(LEAGUE_INFO_NOT_FOUND, '未找到联盟信息');        // FW.G_W("LEAGUE_INFO_NOT_FOUND")
});

test('A4 两张面板各有自己的标题常量（同值会让抄错看不出来）', () => {
    assert.notEqual(LEAGUE_MGR_TITLE, LEAGUE_INFO_TITLE);
    assert.equal(LEAGUE_MGR_TITLE, '联盟管理');
    assert.equal(LEAGUE_INFO_TITLE, '联盟信息');
    // 两个告示块标题**同值**是刻意的（FGUI 两处实例覆盖都写「联盟宣言」）
    assert.equal(LEAGUE_MGR_DECLARATION_TITLE, LEAGUE_INFO_DECLARATION_TITLE);
});

test('A5 ⚠️ 两个页面类里不出现文案字面量（一律从 LeagueTexts 取）', () => {
    const mgrSrc = stripComments(readFileSync(MGR_PAGE_TS, 'utf8'));
    for (const literal of ['联盟管理', '联盟宣言', '联盟公告', '申请管理', '退出联盟', '允许快速加入']) {
        assert.ok(!mgrSrc.includes(`'${literal}'`), `管理页面类里不要写死文案「${literal}」`);
    }
    assert.ok(mgrSrc.includes('LEAGUE_MGR_TITLE'), '管理标题应来自 LeagueTexts');

    const infoSrc = stripComments(readFileSync(INFO_PAGE_TS, 'utf8'));
    for (const literal of ['联盟信息', '联盟宣言', '加入']) {
        assert.ok(!infoSrc.includes(`'${literal}'`), `联盟信息页面类里不要写死文案「${literal}」`);
    }
    assert.ok(infoSrc.includes('LEAGUE_INFO_NOT_FOUND'), '兜底提示应来自 LeagueTexts');
});

// ============================================================
// B. 美术口径
// ============================================================

test('B1 第五刀新纳的两张图 + 弹窗骨架三件套的名字', () => {
    assert.equal(LEAGUE_ART_BTN_JOIN, 'TY_btn06');
    assert.equal(LEAGUE_ART_CHECK_BG, 'shaixuan_dikuang');
    // 骨架三件套（第五刀两张面板继续沿用第四刀换上的公共图）
    assert.equal(LEAGUE_ART_POPUP_BOARD, 'panel_window_01_9gong');
    assert.equal(LEAGUE_ART_POPUP_TITLE_BG, 'title_01');
    assert.equal(LEAGUE_ART_POPUP_TITLE_DECO, 'title_02');
    assert.equal(LEAGUE_ART_POPUP_CLOSE, 'btn_close');
});

test('B2 ⚠️ 两张新图都是**真**九宫格 ⇒ 必须进 `LEAGUE_ART_SLICED`（集合 10 → 18）', () => {
    // P3 之后又多了一张 `TY_btn21`（创建页消耗按钮）⇒ 12 → 13（见 `league-join-create.test.ts` B3）
    // P4 又多了 `frame_Dikuang01`（砍价大底板 581×533）⇒ 13 → 14（见 `league-store-donate-discount.test.ts` B5）
    // P6 又多了 4 张（主板 `panel_window_02_9gong` / 内框 `frame_01_9gong` /
    //   `frame_Zhikuang05` / `frame_Zhikuang04`）⇒ 14 → 18（见 `league-north.test.ts` B4）
    assert.equal(LEAGUE_ART_SLICED.size, 18, 'P6 后九宫格集合应为 18 张');
    assert.ok(LEAGUE_ART_SLICED.has(LEAGUE_ART_BTN_JOIN), 'TY_btn06 必须 SLICED（169×70 会把圆角拉平）');
    assert.ok(LEAGUE_ART_SLICED.has(LEAGUE_ART_CHECK_BG), 'shaixuan_dikuang 必须 SLICED');
    assert.equal(leagueSpriteType(LEAGUE_ART_BTN_JOIN), LEAGUE_SPRITE_SLICED);
    assert.equal(leagueSpriteType(LEAGUE_ART_CHECK_BG), LEAGUE_SPRITE_SLICED);
    assert.equal(leagueSpriteType('TY_btn09'), LEAGUE_SPRITE_SIMPLE);
});

test('B3 ⚠️ 通用按钮底图 `TY_btn09` / `TY_btn10` 仍**故意**不进 SLICED（退化九宫格）', () => {
    // FGUI `package.xml` 给它们标了 scale9grid，但垂直方向退化（top + bottom = 图高、中缝为 0）
    // ⇒ 拉高会把顶边描边拉成一条暗带。这是**已知且已收口**的口径，第五刀不要顺手加进去。
    assert.ok(!LEAGUE_ART_SLICED.has('TY_btn09'));
    assert.ok(!LEAGUE_ART_SLICED.has('TY_btn10'));
});

test('B4 `.png.meta` 里的九宫格四边 = FGUI `scale9grid` 真值', () => {
    // FGUI：TY_btn06 `14,11,4,12`；shaixuan_dikuang `10,13,17,14`
    assert.deepEqual(borderOf(`${BOARD_DIR}/TY_btn06.png.meta`), { left: 14, top: 11, right: 4, bottom: 12 });
    assert.deepEqual(borderOf(`${BOARD_DIR}/shaixuan_dikuang.png.meta`), { left: 10, top: 13, right: 17, bottom: 14 });
});

test('B5 ⚠️ 勾图复用 `image/sevenDay/sd_check`（工程内已有两处同口径先例）', () => {
    assert.equal(LEAGUE_SHARED_CHECK_ROOT, 'image/sevenDay');
    assert.equal(LEAGUE_SHARED_CHECK_NAME, 'sd_check');
    assert.equal(LEAGUE_ART_CHECK_MARK_ROOT, LEAGUE_SHARED_CHECK_ROOT);
    assert.equal(LEAGUE_ART_CHECK_MARK, LEAGUE_SHARED_CHECK_NAME);
    // 图真的在那儿（漏盘就会出「勾选框点了不显示勾」）
    assert.ok(existsSync(`${SHARED_ART_ROOT}/sd_check.png`), '缺 image/sevenDay/sd_check.png');
    // 复用先例还在（哪天有人「顺手」把它挪走，这条会红）
    const friend = readFileSync('assets/script/app/friend/FriendArt.ts', 'utf8');
    const token = readFileSync('assets/script/app/battletoken/BattleTokenArt.ts', 'utf8');
    assert.ok(friend.includes("'image/sevenDay'") && friend.includes("'sd_check'"), 'FriendArt 的复用先例被改动了');
    assert.ok(token.includes("'image/sevenDay'") && token.includes("'sd_check'"), 'BattleTokenArt 的复用先例被改动了');
});

test('B6 联盟信息的茶色晕影 `BannerBg` 复用等级行底纹的图 / 色 / 透明度', () => {
    // FGUI `n27` = 公用 `hknqx` = white_jiao8，`color="#cbaa85"` + `alpha="0.4"`
    assert.equal(LEAGUE_ART_INFO_BANNER_BG, 'white_jiao8');
    assert.deepEqual(LEAGUE_ART_INFO_BANNER_BG_TINT, [0xcb, 0xaa, 0x85]);
    assert.equal(LEAGUE_ART_INFO_BANNER_BG_ALPHA, 102, '0.4 × 255 = 102');
    // 告示块三件套 = 等级行的底框 / 标题条（同一个 `组件_联盟_告示`）
    assert.equal(LEAGUE_ART_NOTICE_BOX_BG, 'frame_Zhikuang01');
    assert.equal(LEAGUE_ART_NOTICE_BOX_TITLE_BAR, 'BB_img03');
});

// ============================================================
// C. 数据口径
// ============================================================

const UNION_TEXTS: ILeagueUnionTexts = {
    levelSuffix: LEAGUE_HALL_LV_SUFFIX,
    leaderPrefix: LEAGUE_UNION_LEADER_PREFIX,
    memberPrefix: LEAGUE_UNION_MEMBER_PREFIX,
};
const INFO_TEXTS: ILeagueInfoTexts = {
    ...UNION_TEXTS,
    idPrefix: LEAGUE_HALL_ID_PREFIX,
    contactPrefix: LEAGUE_HALL_WX_PREFIX,
};
const MGR_TEXTS: ILeagueMgrTexts = {
    idPrefix: LEAGUE_HALL_ID_PREFIX,
    contactPrefix: LEAGUE_HALL_WX_PREFIX,
};

function unionRow(over: Partial<ILeagueUnionRow> = {}): ILeagueUnionRow {
    return {
        id: '2115228', name: '传奇', level: 6, icon: 2, count: 45, maxCount: 46, autoJoin: true,
        leaderId: '7', leaderName: 'aaaa', notice: '今晚八点团战',
        declaration: '人多力量大', wxChat: 'lianmeng_888', exp: 0,
        ...over,
    };
}

function officialRow(position: number, over: Partial<ILeagueOfficialRow> = {}): ILeagueOfficialRow {
    return {
        position, name: `职位${position}`, canApprove: false, canEdit: false,
        kick: [], appointLeader: [], appointDeputy: [], dismiss: [],
        ...over,
    };
}

test('C1 `buildLeagueMgrView`：上屏值 + `wxChat` **裸值**并存', () => {
    const view = buildLeagueMgrView(unionRow(), MGR_TEXTS)!;
    assert.ok(view);
    assert.equal(view.id, '2115228');
    assert.equal(view.name, '传奇');
    assert.equal(view.idText, 'ID:2115228');
    assert.equal(view.wxText, '微信号：lianmeng_888', '上屏用的带前缀');
    assert.equal(view.wxChat, 'lianmeng_888', '编辑框初值必须是不带前缀的裸值');
    assert.equal(view.declaration, '人多力量大');
    assert.equal(view.notice, '今晚八点团战');
    assert.equal(view.icon, 2);
    assert.equal(view.autoJoin, true);
    // ⚠️ 管理面板**没有** `league_lv` / `league_leader` 两个节点 ⇒ 视图模型里也不该有
    const raw = view as unknown as Record<string, unknown>;
    assert.ok(!('levelText' in raw) && !('leaderText' in raw), '管理视图不该有等级 / 盟主字段');
});

test('C2 `buildLeagueMgrView`：未入盟 / 数据没回来 ⇒ null（页面据此走 `close()` 分支）', () => {
    assert.equal(buildLeagueMgrView(null, MGR_TEXTS), null);
    assert.equal(buildLeagueMgrView(undefined, MGR_TEXTS), null);
});

test('C3 `buildLeagueMgrView`：微信号前缀是**全角冒号**、裸值原样透传', () => {
    const view = buildLeagueMgrView(unionRow({ wxChat: '' }), MGR_TEXTS)!;
    assert.equal(view.wxText, '微信号：');
    assert.equal(view.wxChat, '');
    assert.equal(view.wxText.codePointAt(3), 0xff1a, '前缀第 4 字符必须是全角冒号 U+FF1A');
});

test('C4 `leagueMgrPage`：能审批 ⇒ 1（「是」页），不能 ⇒ 0（「否」页）', () => {
    assert.equal(leagueMgrPage(true), 1);
    assert.equal(leagueMgrPage(false), 0);
    // 与权限来源对齐（别在页面里另写一套判定）
    const powers = new Map<number, ILeagueOfficialRow>([
        [3, officialRow(3, { canApprove: true, canEdit: true })],
        [1, officialRow(1)],
    ]);
    assert.equal(leagueMgrPage(canApproveJoin(3, powers)), 1);
    assert.equal(leagueMgrPage(canApproveJoin(1, powers)), 0);
    assert.equal(leagueMgrPage(canApproveJoin(9, powers)), 0, '查不到职位 ⇒ 否');
    // `canEdit` 与 `canApprove` 是两条独立判据（老端 CanEditor / CanApprove 分开调）
    assert.equal(canEditUnion(3, powers), true);
    assert.equal(canEditUnion(1, powers), false);
});

test('C5 `buildLeagueInfoView`：8 个上屏值逐项对齐老端 `updateView()`', () => {
    const view = buildLeagueInfoView(unionRow(), INFO_TEXTS)!;
    assert.ok(view);
    assert.equal(view.name, '传奇');
    assert.equal(view.levelText, '6级');
    assert.equal(view.leaderText, '盟主:aaaa');
    assert.equal(view.idText, 'ID:2115228');
    assert.equal(view.wxText, '微信号：lianmeng_888');
    assert.equal(view.memberText, '成员:45/46', '走 count/maxCount 两个协议字段');
    assert.equal(view.declaration, '人多力量大');
    assert.equal(view.icon, 2);
    assert.equal(buildLeagueInfoView(null, INFO_TEXTS), null, 'cmd 为空 ⇒ null');
});

test('C6 ⚠️ `buildLeagueInfoViewFromUnionView`：搜索行**不在缓存表**里 ⇒ 只能透传', () => {
    // 全服列表的 CmdUnion 来自 RequestUnionSearch 的 Rsp，而 LeagueRepository 刻意不把搜索
    // 结果写进缓存表 ⇒ 「行 → 详情」必须把行对象整体带过来，不能靠 id 回缓存查。
    const [row] = buildLeagueUnionViews([unionRow()], UNION_TEXTS);
    assert.ok(row);
    assert.equal(row!.wxChat, 'lianmeng_888', '行视图必须带上裸微信号');
    assert.equal(row!.declaration, '人多力量大', '行视图必须带上宣言');

    const view = buildLeagueInfoViewFromUnionView(row, INFO_TEXTS)!;
    assert.ok(view);
    assert.equal(view.id, '2115228');
    assert.equal(view.levelText, row!.levelText, '等级串直接复用行上拼好的');
    assert.equal(view.leaderText, row!.leaderText, '盟主串直接复用');
    assert.equal(view.memberText, row!.memberText, '成员串直接复用');
    assert.equal(view.idText, 'ID:2115228', '行上没有 ID 串 ⇒ 这儿补拼');
    assert.equal(view.wxText, '微信号：lianmeng_888', '行上没有微信串 ⇒ 这儿补拼');
    assert.equal(view.declaration, row!.declaration);
    assert.equal(buildLeagueInfoViewFromUnionView(null, INFO_TEXTS), null);
    assert.equal(buildLeagueInfoViewFromUnionView(undefined, INFO_TEXTS), null);
});

test('C7 两条「行 → 详情」路径对同一行给出**一致**的视图（不能一条带前缀一条不带）', () => {
    const row = unionRow();
    const fromRow = buildLeagueInfoView(row, INFO_TEXTS)!;
    const [view] = buildLeagueUnionViews([row], UNION_TEXTS);
    const fromView = buildLeagueInfoViewFromUnionView(view, INFO_TEXTS)!;
    assert.deepEqual(fromView, fromRow, '缓存表路径与搜索行路径必须产出同一份视图');
});

// ============================================================
// D. prefab 结构 + 几何
// ============================================================

const MGR_PREFAB = assetPath('ui/League/LeagueMgr.prefab');
const INFO_PREFAB = assetPath('ui/League/LeagueInfo.prefab');
const MGR_PAGE_TS = 'assets/script/app/league/LeagueMgrPage.ts';
const INFO_PAGE_TS = 'assets/script/app/league/LeagueInfoPage.ts';
const REPO_TS = 'assets/script/app/league/LeagueRepository.ts';
const BOARD_DIR = assetPath('image/league');
const SHARED_ART_ROOT = assetPath('image/sevenDay');
const UI_2D = 33554432;

type Entry = Record<string, unknown>;
const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** `.png.meta` 的九宫格四边。 */
function borderOf(metaPath: string): { left: number; top: number; right: number; bottom: number } {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
    const sub = (meta.subMetas ?? {}) as Record<string, { userData?: Record<string, number> }>;
    const sf = Object.values(sub).find((v) => v?.userData && 'borderTop' in v.userData);
    const d = sf?.userData ?? {};
    return { left: d.borderLeft ?? 0, top: d.borderTop ?? 0, right: d.borderRight ?? 0, bottom: d.borderBottom ?? 0 };
}

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
    /** `{"__id__": n}` → 路径（节点引用或组件引用都行，组件会走它的 `node`）。 */
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
/** 本地坐标（`Entry` 的值是 `unknown`，`--strict` 下不能直接点属性）。 */
const lpos = (n: Entry): { x: number; y: number } => (n._lpos ?? { x: 0, y: 0 }) as { x: number; y: number };
/** `cc.Sprite` 的帧 uuid。 */
const uuidOf = (sp: Entry | null | undefined): string | null =>
    sp ? ((sp._spriteFrame as { __uuid__?: string } | null)?.__uuid__ ?? null) : null;

const mgr = openPrefab(MGR_PREFAB);
const info = openPrefab(INFO_PREFAB);

// 图 uuid（与 `LeagueArt` / FGUI `package.xml` 一一对应；写死在这里，防止改名后测试跟着自动通过）
const U = {
    board: 'a295d231-ef9a-4bea-9818-0e0d85794ef0@f9941',   // panel_window_01_9gong
    title01: 'de242388-9444-451f-adff-78fe5a73e20d@f9941', // title_01
    title02: 'a957fd35-0792-4a27-9de3-85a44274a5d0@f9941', // title_02
    close: 'ca6d0ca8-3ed8-4009-963d-d845eb296872@f9941',   // btn_close
    qizhi02: '82cd6fc7-5e51-4973-b8e2-48ec083d6d8f@f9941',
    lm07: 'c3707aad-313e-4a6a-a69e-366ba45fda45@f9941',
    qizhi06: '5753c0e9-3d98-4052-bf3f-abca2dda9683@f9941',
    copyid: '3d1d9aa8-c5b6-4795-acbc-20bfd05b6795@f9941',  // lm_btn01
    zhikuang: 'dac21f1f-62e9-4f7c-98c9-8125b51c0f49@f9941', // frame_Zhikuang01
    bbp03: 'e7dd22cc-dc8b-4cb8-92b1-b1c6ac085db3@f9941',   // BB_img03
    btn10: 'c482418e-efac-46f8-9753-eebf8be436af@f9941',   // TY_btn10
    btn09: 'fd868d70-2397-4927-bc77-7ea533aee982@f9941',   // TY_btn09
    jiao8: 'b456d791-97f9-40ae-ada5-05ca902ef521@f9941',   // white_jiao8
    btn06: '3bb46826-19e5-4722-be43-d4fd1d78c4e9@f9941',   // TY_btn06（第五刀新）
    checkbg: 'ee8f8335-770c-4447-b91a-9c3e2f08679a@f9941', // shaixuan_dikuang（第五刀新）
    check: 'e10e3712-56a2-4747-a612-1fc84fdea360@f9941',   // sevenDay/sd_check
};

test('D1 两张 prefab（连 `.meta`）+ 两个新脚本（连 `.ts.meta`）都在磁盘上', () => {
    for (const p of [MGR_PREFAB, INFO_PREFAB]) {
        assert.ok(existsSync(p), `缺 prefab：${p}`);
        assert.ok(existsSync(`${p}.meta`), `缺 meta：${p}.meta`);
    }
    for (const ts of [MGR_PAGE_TS, INFO_PAGE_TS]) {
        assert.ok(existsSync(ts), `缺脚本：${ts}`);
        assert.ok(existsSync(`${ts}.meta`), `缺 .ts.meta：${ts}.meta（编辑器不会给未 refresh 的新 .ts 生成）`);
    }
});

test('D2 节点数：管理 35 + 根、联盟信息 23 + 根（重跑生成器若忘了先清空，这里会翻倍）', () => {
    assert.equal(mgr.rootName, 'LeagueMgr');
    assert.equal(info.rootName, 'LeagueInfo');
    assert.equal(mgr.nodes.length, 36, `管理应为 36（35 + 根），实得 ${mgr.nodes.length}`);
    assert.equal(info.nodes.length, 24, `联盟信息应为 24（23 + 根），实得 ${info.nodes.length}`);
});

test('D3 ⚠️ 所有节点 `_layer` 都是 UI_2D（落 DEFAULT 会让整棵子树不渲染且不报错）', () => {
    for (const [tag, ctx] of [['管理', mgr], ['联盟信息', info]] as const) {
        const bad = [...new Set(ctx.nodes.map((n) => n._layer))].filter((l) => l !== UI_2D);
        assert.deepEqual(bad, [], `${tag} 有非 UI_2D 的层：${bad.join(',')}`);
    }
});

test('D4 顶层渲染序：底板最底 → 标题骨架 → 旗帜 → 信息 → 告示块 → 按钮', () => {
    const names = (ctx: ReturnType<typeof openPrefab>) =>
        ((ctx.root._children ?? []) as unknown[]).map((c) => String(ctx.at(c)!._name));
    assert.deepEqual(names(mgr), ['PopupBg', 'TitleBg', 'TitleDeco', 'Title', 'CloseBtn', 'Banner',
        'LeagueName', 'LeagueId', 'LeagueWx', 'CopyId', 'NameHot', 'WxHot',
        'DecBox', 'NoticeBox', 'BtnMgr', 'BtnQuit', 'BtnQuitOnly', 'QuickJoinBox', 'QuickJoinLabel']);
    assert.deepEqual(names(info), ['PopupBg', 'TitleBg', 'TitleDeco', 'Title', 'CloseBtn', 'Banner',
        'BannerBg', 'LeagueName', 'LeagueLeader', 'LeagueLv', 'LeagueId', 'LeagueWx',
        'DecBox', 'LabUser', 'BtnJoin']);
});

test('D5 ⚠️ 联盟信息的茶色晕影 `BannerBg` 必须排在 `Banner`（旗帜）**之后**', () => {
    // FGUI displayList 序是 league_banner → n27 ⇒ 那层半透明暖调是**盖在旗面上**的，
    // 不是旗子的底。按「背景该在下面」的直觉调换 ⇒ 旗面会被压暗，且不报任何错。
    const kids = ((info.root._children ?? []) as unknown[]).map((c) => String(info.at(c)!._name));
    assert.ok(kids.indexOf('Banner') < kids.indexOf('BannerBg'), 'Banner 必须排在 BannerBg 之前');
    assert.equal(kids.indexOf('BannerBg'), kids.indexOf('Banner') + 1, '两者相邻');
    // 管理那张没有晕影
    assert.ok(!mgr.byPath.has('LeagueMgr/BannerBg'), '管理面板不该有 BannerBg');
});

test('D6 ⚠️ 两个脚本的 cid 都能从 `.ts.meta` 反解，且挂在根节点上', () => {
    for (const [ctx, ts, tag] of [[mgr, MGR_PAGE_TS, 'LeagueMgrPage'],
        [info, INFO_PAGE_TS, 'LeagueInfoPage']] as const) {
        const cid = cidOf(ts);
        assert.ok(ctx.customCids.includes(cid), `${tag} 的 cid ${cid} 不在 prefab 里`);
        assert.ok(ctx.comp('', cid), `${tag} 没挂在根节点上`);
    }
});

test('D7 @property 绑定：管理 18 / 联盟信息 10（逐条对节点）', () => {
    const mgrComp = mgr.comp('', cidOf(MGR_PAGE_TS))!;
    for (const [prop, want] of [
        ['closeButton', 'LeagueMgr/CloseBtn'],
        ['bannerColor', 'LeagueMgr/Banner/ColorIcon'],
        ['nameLabel', 'LeagueMgr/LeagueName'],
        ['idLabel', 'LeagueMgr/LeagueId'],
        ['wxLabel', 'LeagueMgr/LeagueWx'],
        ['copyIdButton', 'LeagueMgr/CopyId'],
        ['nameButton', 'LeagueMgr/NameHot'],
        ['wxButton', 'LeagueMgr/WxHot'],
        ['declarationButton', 'LeagueMgr/DecBox'],
        ['noticeButton', 'LeagueMgr/NoticeBox'],
        ['declarationLabel', 'LeagueMgr/DecBox/Content'],
        ['noticeLabel', 'LeagueMgr/NoticeBox/Content'],
        ['mgrButton', 'LeagueMgr/BtnMgr'],
        ['quitButton', 'LeagueMgr/BtnQuit'],
        ['quitOnlyButton', 'LeagueMgr/BtnQuitOnly'],
        ['quickJoinButton', 'LeagueMgr/QuickJoinBox'],
        ['quickJoinCheck', 'LeagueMgr/QuickJoinBox/Check'],
        ['quickJoinLabel', 'LeagueMgr/QuickJoinLabel'],
    ] as const) {
        assert.equal(mgr.refPath(mgrComp[prop]), want, `${prop} 应绑到 ${want}`);
    }
    const infoComp = info.comp('', cidOf(INFO_PAGE_TS))!;
    for (const [prop, want] of [
        ['closeButton', 'LeagueInfo/CloseBtn'],
        ['bannerColor', 'LeagueInfo/Banner/ColorIcon'],
        ['nameLabel', 'LeagueInfo/LeagueName'],
        ['levelLabel', 'LeagueInfo/LeagueLv'],
        ['leaderLabel', 'LeagueInfo/LeagueLeader'],
        ['idLabel', 'LeagueInfo/LeagueId'],
        ['wxLabel', 'LeagueInfo/LeagueWx'],
        ['memberLabel', 'LeagueInfo/LabUser'],
        ['declarationLabel', 'LeagueInfo/DecBox/Content'],
        ['joinButton', 'LeagueInfo/BtnJoin'],
    ] as const) {
        assert.equal(info.refPath(infoComp[prop]), want, `${prop} 应绑到 ${want}`);
    }
});

test('D8 ⚠️「管理」controller 页 0 的落地默认态：4 个节点必须 `active:false`', () => {
    // FGUI `管理` controller `selected="0"`（页「否」）⇒ 只有 `btn_quit1` 亮。
    // 漏掉任意一个，「不能审批的人」进面板就会看到「申请管理」/「允许快速加入」。
    const want: ReadonlyArray<readonly [string, boolean]> = [
        ['BtnMgr', false], ['BtnQuit', false], ['QuickJoinBox', false], ['QuickJoinLabel', false],
        ['BtnQuitOnly', true], ['QuickJoinBox/Check', false],
    ];
    for (const [p, active] of want) {
        assert.equal(mgr.P(p)!.node._active, active, `LeagueMgr/${p} 的落地默认 active 应为 ${active}`);
    }
});

test('D9 ⚠️ prefab 里每个 `cc.Button` 都必须被某个 `@property` 覆盖（否则就是死按钮）', () => {
    // 管理 10 个按钮：闭钮 / 复制 ID / 名字热区 / 微信热区 / 两个告示块 / 三颗大按钮 / 勾选框
    // 联盟信息 2 个：闭钮 / 加入
    for (const [ctx, ts, tag, count] of [[mgr, MGR_PAGE_TS, '管理', 10], [info, INFO_PAGE_TS, '联盟信息', 2]] as const) {
        const comp = ctx.comp('', cidOf(ts))!;
        const covered = new Set(Object.values(comp).map((v) => ctx.refPath(v)).filter(Boolean) as string[]);
        const buttons = [...ctx.byPath.entries()]
            .filter(([, r]) => ((r.node._components ?? []) as unknown[]).map(ctx.at).some((c) => c?.__type__ === 'cc.Button'))
            .map(([p]) => p);
        assert.equal(buttons.length, count, `${tag} 应有 ${count} 个 cc.Button，实得 ${buttons.length}`);
        for (const b of buttons) assert.ok(covered.has(b), `${tag} 的按钮 ${b} 没有被任何 @property 引用（死按钮）`);
    }
    // 管理那 4 个「大面热区」也要挂 Button（点名字 / 微信号 / 两个告示块）
    for (const p of ['NameHot', 'WxHot', 'DecBox', 'NoticeBox']) {
        assert.ok(mgr.comp(p, 'cc.Button'), `LeagueMgr/${p} 应挂 cc.Button`);
    }
    // 联盟信息的 DecBox **不**挂 Button（联盟信息不能改宣言）
    assert.equal(info.comp('DecBox', 'cc.Button'), null, 'LeagueInfo/DecBox 不该是按钮');
});

test('D10 ⚠️ 大面热区 / 勾选框不写 SCALE 按下态（点了整块缩一下会很怪）', () => {
    // 四个热区：FGUI 是**无图**的 loader 上挂了手写点击，没有 downEffect
    for (const p of ['NameHot', 'WxHot', 'DecBox', 'NoticeBox']) {
        assert.equal(mgr.comp(p, 'cc.Button')!._transition, 0, `LeagueMgr/${p} 的 transition 应为 0`);
    }
    // 勾选框：FGUI `公用_按钮_勾选.xml` 只有 `<Button mode="Check"/>`、**没有** `downEffect`
    // ⇒ 也不能给 SCALE 按下态（勾选靠子节点 `Check` 的显隐表达，不靠缩放）
    assert.equal(mgr.comp('QuickJoinBox', 'cc.Button')!._transition, 0, '勾选框没有按下效果');
    // 有底图的按钮反过来必须有 SCALE 0.9
    for (const [ctx, tag, paths] of [
        [mgr, '管理', ['CloseBtn', 'CopyId', 'BtnMgr', 'BtnQuit', 'BtnQuitOnly']],
        [info, '联盟信息', ['CloseBtn', 'BtnJoin']],
    ] as const) {
        for (const p of paths) {
            const b = ctx.comp(p, 'cc.Button')!;
            assert.equal(b._transition, 3, `${tag} ${p} 应是 SCALE 过渡`);
            assert.ok(near(b._zoomScale as number, 0.9), `${tag} ${p} 的 zoomScale 应为 0.9`);
        }
    }
});

test('D10b ⚠️ 勾选框是**三层**：热区挂 Button、底框 39×39、勾 32×33（`fill` 缺省 = none）', () => {
    // FGUI `公用_按钮_勾选.xml`：`<component size="50,50">` 里两个 loader 都**没写 `fill`**
    // ⇒ FGUI loader 的缺省 `fill = none` = 内容按**原图自然尺寸**居中，**不撑满盒子**。
    //   组件的 50×50 只是**点击热区**，不是显示尺寸。
    // 证据（两处独立面板给出同一条「文案紧贴底框右缘」关系）：
    //   本面板 盒右缘 144 / 文案 x=139；`组件_联盟_创建联盟.xml` 盒右缘 142 / 文案 x=137
    //   ⇒ 底框 39 宽居中时右缘 138.5 / 136.5，正好贴住 139 / 137；
    //     若撑满 50 则文案会**压在框里**（✓ 盖住「允」字 —— 第五刀肉眼截图抓到的真缺陷）。
    // 工程先例：复用 `sd_check` 的 13 处一律落 32×33。
    const qjb = mgr.P('QuickJoinBox')!;
    assert.equal(mgr.comp('QuickJoinBox', 'cc.Button') !== null, true, '热区上必须有 cc.Button');
    assert.equal(mgr.comp('QuickJoinBox', 'cc.Sprite'), null, '热区自己不该有 sprite（底图在子层）');
    assert.ok(mgr.byPath.has('LeagueMgr/QuickJoinBox/Box'), '底框应是 QuickJoinBox 的子节点');
    assert.ok(mgr.byPath.has('LeagueMgr/QuickJoinBox/Check'), '对勾应是 QuickJoinBox 的子节点');
    for (const [p, w, h] of [['Box', 39, 39], ['Check', 32, 33]] as const) {
        const r = mgr.P(`QuickJoinBox/${p}`)!;
        assert.ok(near(r.vw, w, 0.5) && near(r.vh, h, 0.5),
            `QuickJoinBox/${p} 应为 ${w}×${h}（自然尺寸），实得 ${r.vw.toFixed(1)}×${r.vh.toFixed(1)}`);
    }
    // 底框与勾都居中在 50×50 热区里（同心）
    for (const p of ['Box', 'Check'] as const) {
        const r = mgr.P(`QuickJoinBox/${p}`)!;
        assert.ok(near(r.cx, qjb.cx, 0.6) && near(r.cy, qjb.cy, 0.6),
            `QuickJoinBox/${p} 应与热区同心（实得 ${r.cx.toFixed(1)},${r.cy.toFixed(1)} / 热区 ${qjb.cx.toFixed(1)},${qjb.cy.toFixed(1)}）`);
    }
    // 底框右缘必须 ≤ 文案左缘，否则 ✓ 会压到「允许快速加入」的「允」字上
    const box = mgr.P('QuickJoinBox/Box')!;
    const lab = mgr.P('QuickJoinLabel')!;
    assert.ok(box.left + box.vw <= lab.left + 0.3,
        `底框右缘 ${(box.left + box.vw).toFixed(1)} 必须 ≤ 文案左缘 ${lab.left.toFixed(1)}`);
});

test('D11 ⚠️ 全部视觉框逐条对 FGUI 原 XML（管理 28 条 + 联盟信息 18 条）', () => {
    const rects = (ctx: ReturnType<typeof openPrefab>, table: Record<string, [number, number, number, number]>, tag: string): void => {
        for (const [p, [left, top, w, h]] of Object.entries(table)) {
            const r = ctx.P(p);
            assert.ok(r, `${tag} 缺节点：${p}`);
            assert.ok(near(r!.left, left), `${tag} ${p} left=${r!.left.toFixed(2)} 期望 ${left}`);
            assert.ok(near(r!.top, top), `${tag} ${p} top=${r!.top.toFixed(2)} 期望 ${top}`);
            assert.ok(near(r!.vw, w), `${tag} ${p} 宽=${r!.vw.toFixed(2)} 期望 ${w}`);
            assert.ok(near(r!.vh, h), `${tag} ${p} 高=${r!.vh.toFixed(2)} 期望 ${h}`);
        }
    };
    // FGUI `组件_联盟_大厅_管理.xml`（popBg (40,185) 640×979 ⇒ 板根 y = −34.5）
    rects(mgr, {
        PopupBg: [40, 185, 640, 979],
        Banner: [113, 267, 136.04, 148.96],                 // league_banner 179×196 scale .76
        'Banner/Frame': [103.88, 254.08, 154.28, 174.8],
        'Banner/Base': [117.56, 271.56, 126.92, 139.84],
        'Banner/ColorIcon': [150.24, 302.72, 62.32, 57],
        LeagueName: [252, 267, 58, 36],
        LeagueId: [252, 311, 155, 34],
        LeagueWx: [252, 344, 309, 34],
        CopyId: [579, 312, 28, 30],                         // league_copyid
        NameHot: [253, 266, 74, 37],                        // btnName（无图热区）
        WxHot: [252, 343, 203, 37],                         // btnWx
        DecBox: [80, 423, 560, 240],                        // comp_dec（实例盒，非组件头 560×220）
        'DecBox/Bg': [80, 423, 560, 240],
        'DecBox/TitleBar': [110, 443, 500, 40],
        'DecBox/Title': [263, 443, 187, 36],
        'DecBox/Content': [111, 501, 498, 136],
        NoticeBox: [80, 672, 560, 240],                     // comp_notice
        'NoticeBox/Bg': [80, 672, 560, 240],
        'NoticeBox/TitleBar': [110, 692, 500, 40],
        'NoticeBox/Title': [263, 692, 187, 36],
        'NoticeBox/Content': [111, 750, 498, 136],
        BtnMgr: [386, 976, 218, 106],                       // btn_mgr
        BtnQuit: [115, 976, 218, 106],                      // btn_quit
        BtnQuitOnly: [251, 976, 218, 106],                  // btn_quit1
        QuickJoinBox: [94, 921, 50, 50],                    // 按钮_勾选：50×50 **只是点击热区**
        'QuickJoinBox/Box': [99.5, 926.5, 39, 39],          // 底框按原图自然尺寸 39×39（fill 缺省 = none）
        'QuickJoinBox/Check': [103, 929.5, 32, 33],         // 对勾 32×33（同工程 13 处 sd_check 先例）
        QuickJoinLabel: [139, 929, 172, 34],                // n23
    }, '管理');
    // FGUI `组件_联盟_大厅_联盟信息.xml`（popBg (40,254) 640×771 ⇒ 板根 y = +0.5）
    rects(info, {
        PopupBg: [40, 254, 640, 771],
        Banner: [113, 336, 136.04, 148.96],
        'Banner/Frame': [103.88, 323.08, 154.28, 174.8],
        'Banner/Base': [117.56, 340.56, 126.92, 139.84],
        'Banner/ColorIcon': [150.24, 371.72, 62.32, 57],
        BannerBg: [246, 325, 386, 184],                     // n27
        LeagueName: [252, 336, 58, 36],
        LeagueLeader: [252, 379, 129, 36],                  // league_leader
        LeagueLv: [568, 336, 47, 36],                       // league_lv
        LeagueId: [252, 429, 155, 34],
        LeagueWx: [252, 462, 155, 34],
        DecBox: [80, 524, 560, 240],
        'DecBox/Bg': [80, 524, 560, 240],
        'DecBox/TitleBar': [110, 544, 500, 40],
        'DecBox/Title': [263, 544, 187, 36],
        'DecBox/Content': [111, 602, 498, 136],
        LabUser: [280, 834, 154, 42],                       // lab_user
        BtnJoin: [275, 883, 169, 70],                       // btn_join
    }, '联盟信息');
});

test('D11b ⚠️ 弹窗骨架「中心距 popBg 顶边」= 12.5 / 12.5 / 10 / 10；闭钮距右缘 32', () => {
    // FGUI `组件_公共弹窗_新.xml`：title_brown 中心距顶 12.5、title 中心距顶 10、闭钮中心距顶 10。
    // ⚠️ 本刀两张面板都**不**居中 —— 老端 `toFullCenterParent` 的接收者自身就是 720×1280，
    //    「居中」是恒等变换 ⇒ FGUI 里那对 xy 就是最终画布坐标（管理 y=185 / 联盟信息 y=254）。
    for (const [ctx, tag] of [[mgr, '管理'], [info, '联盟信息']] as const) {
        const popTop = ctx.P('PopupBg')!.top;
        for (const [p, want] of [['TitleBg', 12.5], ['TitleDeco', 12.5], ['Title', 10], ['CloseBtn', 10]] as const) {
            const got = ctx.P(p)!.cy - popTop;
            assert.ok(near(got, want), `${tag} ${p} 中心距顶 ${got.toFixed(2)} 期望 ${want}`);
        }
        assert.ok(near(ctx.P('PopupBg')!.cx, 360), `${tag} popBg 水平居中`);
        assert.ok(near(ctx.P('CloseBtn')!.cx, 648), `${tag} 闭钮中心 x = 648`);
        assert.ok(near(ctx.P('PopupBg')!.left + ctx.P('PopupBg')!.vw - ctx.P('CloseBtn')!.cx, 32),
            `${tag} 闭钮中心距弹窗右缘 32（与等级预览 / 申请列表同口径）`);
    }
});

test('D12 ⚠️ 板根 y 是奇数高的产物：管理 −34.5、联盟信息 +0.5（骨架 442.5/445、373.5/376）', () => {
    // 979 是奇数 ⇒ 板中心在 674.5，比画布中心低 34.5 ⇒ 根内 y = −34.5
    // 771 是奇数 ⇒ 板中心在 639.5，比画布中心高 0.5 ⇒ 根内 y = +0.5
    // 骨架随之：条 = 根y + 板半高 − 12.5、字/闭钮 = 根y + 板半高 − 10
    assert.ok(near(lpos(mgr.P('PopupBg')!.node).y, -34.5), '管理的板根 y 应为 −34.5');
    assert.ok(near(lpos(info.P('PopupBg')!.node).y, 0.5), '联盟信息的板根 y 应为 +0.5');
    for (const [ctx, tag, bar, title] of [[mgr, '管理', 442.5, 445], [info, '联盟信息', 373.5, 376]] as const) {
        assert.ok(near(lpos(ctx.P('TitleBg')!.node).y, bar), `${tag} 标题条 y 应为 ${bar}`);
        assert.ok(near(lpos(ctx.P('TitleDeco')!.node).y, bar), `${tag} 标题装饰 y 应为 ${bar}`);
        assert.ok(near(lpos(ctx.P('Title')!.node).y, title), `${tag} 标题 y 应为 ${title}`);
        assert.ok(near(lpos(ctx.P('CloseBtn')!.node).y, title), `${tag} 闭钮 y 应为 ${title}`);
        assert.ok(near(lpos(ctx.P('CloseBtn')!.node).x, 288), `${tag} 闭钮 x 应为 288（画布 648）`);
    }
});

test('D13 Sprite 口径：`_sizeMode` 全 CUSTOM、`_type` 与九宫格集合一致', () => {
    const sliced = new Set([U.board, U.zhikuang, U.btn06, U.checkbg, U.jiao8]);
    for (const [tag, ctx] of [['管理', mgr], ['联盟信息', info]] as const) {
        for (const [path, r] of ctx.byPath) {
            const sp = ((r.node._components ?? []) as unknown[]).map(ctx.at).find((c) => c?.__type__ === 'cc.Sprite');
            if (!sp || sp._spriteFrame == null) continue;
            assert.equal(sp._sizeMode, 0, `${tag} ${path} 的 sizeMode 应为 CUSTOM(0)`);
            const uuid = uuidOf(sp)!;
            assert.equal(sp._type === 1, sliced.has(uuid), `${tag} ${path} 的九宫格口径与图不符（uuid=${uuid}）`);
        }
    }
    // 两张真九宫格新图确实落了 SLICED（不是靠「集合里有」蒙过去的）
    assert.equal(mgr.comp('QuickJoinBox/Box', 'cc.Sprite')!._type, 1, 'shaixuan_dikuang 要 SLICED');
    assert.equal(info.comp('BtnJoin', 'cc.Sprite')!._type, 1, 'TY_btn06 要 SLICED');
    // 热区自己无 sprite；勾（对勾）是独立子节点、SIMPLE
    assert.equal(mgr.comp('QuickJoinBox', 'cc.Sprite'), null, '勾选框热区自己不该有 sprite');
    assert.equal(mgr.comp('QuickJoinBox/Check', 'cc.Sprite')!._type, 0, '对勾是独立 sprite，SIMPLE');
    // 通用按钮底一律 SIMPLE（退化九宫格）
    for (const [path, uuid] of [['BtnMgr', U.btn10], ['BtnQuit', U.btn09], ['BtnQuitOnly', U.btn09]] as const) {
        const sp = mgr.comp(path, 'cc.Sprite')!;
        assert.equal(uuidOf(sp), uuid, `${path} 的底图`);
        assert.equal(sp._type, 0, `${path} 的 TY_btn09/10 必须 SIMPLE`);
    }
});

test('D14 ⚠️ 茶色晕影必须写 `rgba(203,170,133,102)`（只写 alpha 会渲染成白条）', () => {
    const c = info.comp('BannerBg', 'cc.Sprite')!._color as { r: number; g: number; b: number; a: number };
    assert.deepEqual([c.r, c.g, c.b, c.a], [203, 170, 133, 102], 'white_jiao8 是「白图 + tint」');
    // 告示块的标题条是半透明（FGUI alpha="0.5"）
    for (const [ctx, tag, paths] of [
        [mgr, '管理', ['DecBox/TitleBar', 'NoticeBox/TitleBar']],
        [info, '联盟信息', ['DecBox/TitleBar']],
    ] as const) {
        for (const p of paths) {
            assert.equal((ctx.comp(p, 'cc.Sprite')!._color as { a: number }).a, 128, `${tag} ${p} 的 alpha 应为 128`);
        }
    }
});

test('D15 ⚠️ `autoSize` 缺省的 text 一律 `overflow = SHRINK(2)`（**不是 NONE**）', () => {
    // 落 NONE 的话 Label 会在渲染期回写 node.contentSize（58×36 → 56×54.4），把 FGUI 量好的盒
    // 冲掉、左边界跟着漂。详见文件头。**兜底**：两张 prefab 里不许存在任何 NONE 溢出的 Label。
    // ⚠️ 这里遍历的是 `byPath`（键是**含根名**的绝对路径），所以不能用 `ctx.comp()`（它会再拼一次根名）
    //    —— 直接从已解析的节点上取组件。
    for (const [ctx, tag] of [[mgr, '管理'], [info, '联盟信息']] as const) {
        const labels: Array<[string, Entry]> = [];
        for (const [p, r] of ctx.byPath) {
            const lb = ((r.node._components ?? []) as unknown[]).map(ctx.at)
                .find((c) => c?.__type__ === 'cc.Label');
            if (lb) labels.push([p, lb]);
        }
        assert.equal(labels.length, tag === '管理' ? 12 : 10, `${tag} 的 Label 数量`);
        const bad = labels.filter(([, lb]) => lb._overflow === 0).map(([p]) => p);
        assert.deepEqual(bad, [], `${tag} 有 NONE(0) 溢出的 Label：${bad.join(',')}`);
        for (const [p, lb] of labels) {
            assert.equal(lb._overflow, 2, `${tag} ${p} 的 overflow 应为 SHRINK(2)`);
        }
    }
});

test('D16 Label 口径：数量 + 文案 / 字号 / 颜色 / 描边 / 对齐逐项对 FGUI', () => {
    const countLabels = (ctx: ReturnType<typeof openPrefab>) =>
        ctx.nodes.reduce((a, n) => a + ((n._components ?? []) as unknown[]).map(ctx.at).filter((c) => c?.__type__ === 'cc.Label').length, 0);
    assert.equal(countLabels(mgr), 12, '管理 12 个 Label');
    assert.equal(countLabels(info), 10, '联盟信息 10 个 Label');

    type Style = [string, number, [number, number, number], boolean, number, number];
    const check = (ctx: ReturnType<typeof openPrefab>, tag: string, table: Record<string, Style>): void => {
        for (const [path, [text, fs, rgb, outline, ha, va]] of Object.entries(table)) {
            const lb = ctx.comp(path, 'cc.Label');
            assert.ok(lb, `${tag} 缺 Label：${path}`);
            assert.equal(lb!._string, text, `${tag} ${path} 文案`);
            assert.equal(lb!._fontSize, fs, `${tag} ${path} 字号`);
            const c = lb!._color as { r: number; g: number; b: number };
            assert.deepEqual([c.r, c.g, c.b], rgb, `${tag} ${path} 颜色`);
            assert.equal(lb!._enableOutline, outline, `${tag} ${path} 描边开关`);
            assert.equal(lb!._horizontalAlign, ha, `${tag} ${path} 水平对齐`);
            assert.equal(lb!._verticalAlign, va, `${tag} ${path} 垂直对齐`);
        }
    };
    check(mgr, '管理', {
        Title: ['联盟管理', 30, [255, 246, 196], true, 1, 1],
        LeagueName: ['传奇', 26, [255, 255, 255], true, 0, 0],
        LeagueId: ['ID:2115228', 24, [115, 76, 63], false, 0, 0],
        LeagueWx: ['微信号：lianmeng_888', 24, [115, 76, 63], false, 0, 0],
        'DecBox/Title': ['联盟宣言', 26, [0, 0, 0], false, 1, 1],
        'DecBox/Content': ['暂无内容', 26, [0, 0, 0], false, 0, 0],
        'NoticeBox/Title': ['联盟公告', 26, [0, 0, 0], false, 1, 1],
        'NoticeBox/Content': ['暂无内容', 26, [0, 0, 0], false, 0, 0],
        'BtnMgr/Label': ['申请管理', 50, [252, 240, 214], true, 1, 1],
        'BtnQuit/Label': ['退出联盟', 50, [252, 240, 214], true, 1, 1],
        'BtnQuitOnly/Label': ['退出联盟', 50, [252, 240, 214], true, 1, 1],
        QuickJoinLabel: ['允许快速加入', 24, [252, 240, 214], true, 0, 1],
    });
    check(info, '联盟信息', {
        Title: ['联盟信息', 30, [255, 246, 196], true, 1, 1],
        LeagueName: ['传奇', 26, [255, 255, 255], true, 0, 0],
        LeagueLeader: ['盟主:aaaa', 26, [255, 255, 255], true, 0, 0],
        LeagueLv: ['6级', 26, [53, 42, 35], false, 0, 0],
        LeagueId: ['ID:2115228', 24, [115, 76, 63], false, 0, 0],
        LeagueWx: ['微信号：lianmeng_888', 24, [115, 76, 63], false, 0, 0],
        'DecBox/Title': ['联盟宣言', 26, [0, 0, 0], false, 1, 1],
        'DecBox/Content': ['暂无内容', 26, [0, 0, 0], false, 0, 0],
        LabUser: ['成员:46/51', 30, [255, 255, 255], true, 0, 0],
        'BtnJoin/Label': ['加入', 50, [252, 240, 214], true, 1, 1],
    });
});

test('D16b ⚠️ 通用按钮内文案的字号一律 **50**（FGUI 实例没写 `titleFontSize`）', () => {
    // `按钮_公共_通用` 的 title 自身 `fontSize="50"`；FGUI 加载分支
    // `iv = buffer.readInt(); if (iv != 0) this.titleFontSize = iv;` ⇒ 实例**没写**就保留 50，
    // 再由 `autoSize="shrink"`（盒 218×66）压到刚好。写 30 的（申请列表批量 / 编辑信息）才是 30。
    for (const [ctx, tag, paths] of [
        [mgr, '管理', ['BtnMgr/Label', 'BtnQuit/Label', 'BtnQuitOnly/Label']],
        [info, '联盟信息', ['BtnJoin/Label']],
    ] as const) {
        for (const p of paths) {
            assert.equal(ctx.comp(p, 'cc.Label')!._fontSize, 50, `${tag} ${p} 的字号应为 50`);
        }
    }
});

test('D16c ⚠️ 按钮内文案的 y 一律 = −1（`Top_Middle` 解算，与按钮高度无关）', () => {
    for (const [ctx, tag, paths] of [
        [mgr, '管理', ['BtnMgr/Label', 'BtnQuit/Label', 'BtnQuitOnly/Label']],
        [info, '联盟信息', ['BtnJoin/Label']],
    ] as const) {
        for (const p of paths) {
            assert.ok(near(lpos(ctx.P(p)!.node).y, -1), `${tag} ${p} 的 y 应为 −1`);
        }
    }
});

test('D17 ⚠️ 告示正文开换行、其余单行（498 宽的长宣言不能横向溢出底框）', () => {
    for (const [ctx, tag, paths] of [
        [mgr, '管理', ['DecBox/Content', 'NoticeBox/Content']],
        [info, '联盟信息', ['DecBox/Content']],
    ] as const) {
        for (const p of paths) {
            assert.equal(ctx.comp(p, 'cc.Label')!._enableWrapText, true, `${tag} ${p} 必须开换行`);
        }
    }
    assert.equal(info.comp('LabUser', 'cc.Label')!._enableWrapText, false, '成员数是单行');
    assert.equal(mgr.comp('QuickJoinLabel', 'cc.Label')!._enableWrapText, false, '勾选框说明是单行');
});

test('D18 ⚠️ 旗帜子组件（`Banner`）口径与母面板一致：scale 0.76 + 三个子节点', () => {
    for (const [ctx, tag] of [[mgr, '管理'], [info, '联盟信息']] as const) {
        const banner = ctx.P('Banner')!;
        assert.ok(near(banner.sx, 0.76) && near(banner.sy, 0.76), `${tag} 旗帜要 scale 0.76`);
        assert.equal(uuidOf(ctx.comp('Banner/Frame', 'cc.Sprite')), U.qizhi02, `${tag} Frame = img_Qizhi_02`);
        assert.equal(uuidOf(ctx.comp('Banner/Base', 'cc.Sprite')), U.lm07, `${tag} Base = icon_lm07`);
        const color = ctx.comp('Banner/ColorIcon', 'cc.Sprite')!;
        assert.equal(uuidOf(color), U.qizhi06, `${tag} ColorIcon = img_Qizhi_06`);
        assert.ok(color._spriteFrame != null, `${tag} 旗面要有初帧（运行时按 icon 换图）`);
        // 旗面是 `lpos(0.5,13.5)` 的 82×75，锚点 (0.5,0.5)
        assert.ok(near(lpos(ctx.P('Banner/ColorIcon')!.node).x, 0.5)
            && near(lpos(ctx.P('Banner/ColorIcon')!.node).y, 13.5), `${tag} 旗面位置 (0.5,13.5)`);
        const uit = ctx.comp('Banner/ColorIcon', 'cc.UITransform')!;
        assert.equal((uit._anchorPoint as { x: number }).x, 0.5);
        assert.equal((uit._anchorPoint as { y: number }).y, 0.5);
    }
});

test('D19 ⚠️ prefab 里每个 spriteFrame 引用都能解析到「sprite-frame」子资源（悬空 ⇒ 运行时品红块）', () => {
    const seen = new Set<string>();
    for (const [tag, ctx] of [['管理', mgr], ['联盟信息', info]] as const) {
        for (const [path, r] of ctx.byPath) {
            const sp = ((r.node._components ?? []) as unknown[]).map(ctx.at).find((c) => c?.__type__ === 'cc.Sprite');
            const uuid = sp ? uuidOf(sp) : null;
            if (!uuid) continue;
            assert.ok(uuid.endsWith('@f9941'), `${tag} ${path} 的 spriteFrame uuid 不是 @f9941 子资源：${uuid}`);
            seen.add(uuid);
        }
    }
    // 第五刀新增的三张（TY_btn06 / shaixuan_dikuang / sd_check）确实被用上了
    assert.ok(seen.has(U.btn06) && seen.has(U.checkbg) && seen.has(U.check));
    assert.ok(seen.has(U.board) && seen.has(U.jiao8) && seen.has(U.copyid));
    // 底板 / 标题骨架必须用公共三件套 + 真底板
    assert.equal(uuidOf(mgr.comp('PopupBg', 'cc.Sprite')), U.board);
    assert.equal(uuidOf(info.comp('PopupBg', 'cc.Sprite')), U.board);
    assert.equal(uuidOf(mgr.comp('TitleBg', 'cc.Sprite')), U.title01);
    assert.equal(uuidOf(mgr.comp('TitleDeco', 'cc.Sprite')), U.title02);
    assert.equal(uuidOf(mgr.comp('CloseBtn', 'cc.Sprite')), U.close);
    assert.equal(uuidOf(mgr.comp('CopyId', 'cc.Sprite')), U.copyid);
    assert.equal(uuidOf(info.comp('BannerBg', 'cc.Sprite')), U.jiao8);
});

// ============================================================
// E. 页面逻辑 / 调用约定（源码文本）
// ============================================================

test('E1 两个页面类 `prefabPath` 大小写与磁盘一致，且继承 PopupBase', () => {
    const m = readFileSync(MGR_PAGE_TS, 'utf8');
    const i = readFileSync(INFO_PAGE_TS, 'utf8');
    assert.ok(m.includes("static prefabPath = 'ui/League/LeagueMgr'"), '管理 prefabPath');
    assert.ok(i.includes("static prefabPath = 'ui/League/LeagueInfo'"), '联盟信息 prefabPath');
    assert.ok(/export class LeagueMgrPage extends PopupBase/.test(m));
    assert.ok(/export class LeagueInfoPage extends PopupBase/.test(i));
    // 目录大小写必须与磁盘一致（热更新 zip 内路径大小写敏感）
    assert.ok(assetExists('ui/League/LeagueMgr.prefab'));
    assert.ok(assetExists('ui/League/LeagueInfo.prefab'));
    // 两个类都给出 `titleText`（供复用方取，避免到处写中文字面量）
    assert.ok(/static get titleText\(\): string \{/.test(m) && /LEAGUE_MGR_TITLE/.test(m));
    assert.ok(/static get titleText\(\): string \{/.test(i) && /LEAGUE_INFO_TITLE/.test(i));
});

test('E2 ⚠️ 管理：快速加入**在 `onClose()` 才发包**（不是在勾选瞬间）', () => {
    const src = stripComments(readFileSync(MGR_PAGE_TS, 'utf8'));
    const method = (name: string): string => {
        const m = new RegExp(`private ${name}\\(\\): void \\{([\\s\\S]*?)\\n    \\}`).exec(src);
        assert.ok(m, `找不到 ${name}()`);
        return m![1]!;
    };
    // 勾选只改本地面板态
    const toggle = method('toggleQuickJoin');
    assert.ok(toggle.includes('this.actualJoin = !this.actualJoin'), '勾选要翻面板态');
    assert.ok(!toggle.includes('sendQuickJoin'), '⚠️ 勾选瞬间不能发包');
    assert.ok(!toggle.includes('repository'), '⚠️ 勾选瞬间不能碰数据层');
    // 发包挂在 onClose（`protected` 前缀）
    const onClose = /protected onClose\(\): void \{([\s\S]*?)\n    \}/.exec(src);
    assert.ok(onClose, '找不到 onClose()');
    assert.ok(onClose![1]!.includes('flushQuickJoin()'), 'onClose 里要 flushQuickJoin');
    // 两道闸门：无权限不发、值没变不发
    const flush = method('flushQuickJoin');
    assert.ok(flush.includes('this.canEdit'), '无权限不发');
    assert.ok(flush.includes('if (this.actualJoin === saved) return;'), '值没变不发');
    assert.ok(flush.includes('sendQuickJoin'), 'flushQuickJoin 里才发包');
    assert.ok(/LEAGUE_TIP_OFFLINE/.test(src) && /LEAGUE_TIP_FAILED/.test(src), '三态提示走常量');
});

test('E3 ⚠️ 管理：四个编辑入口传的是**裸值**，且都被 `canEdit` 包住', () => {
    const src = stripComments(readFileSync(MGR_PAGE_TS, 'utf8'));
    assert.ok(/openEditor\(LeagueEditType\.NAME, this\.view\?\.name\)/.test(src), '名字传 view.name');
    assert.ok(/openEditor\(LeagueEditType\.WX, this\.view\?\.wxChat\)/.test(src), '微信传 **裸** wxChat');
    assert.ok(/openEditor\(LeagueEditType\.DECLARATION, this\.view\?\.declaration\)/.test(src));
    assert.ok(/openEditor\(LeagueEditType\.NOTICE, this\.view\?\.notice\)/.test(src));
    assert.ok(!/openEditor\([^)]*wxText/.test(src), '⚠️ 不能把带「微信号：」前缀的 wxText 当输入框初值');
    // 守卫
    const openEditor = /private openEditor\(type: number, content: string \| undefined\): void \{([\s\S]*?)\n    \}/.exec(src);
    assert.ok(openEditor, '找不到 openEditor');
    assert.ok(openEditor![1]!.includes('if (!this.canEdit)'), '编辑入口要有 canEdit 守卫');
    assert.ok(src.includes('LeagueEditPage.open({ userData: { type, content'), '开编辑信息走统一参数');
    // 未入盟静默关（老端 `if (!IsJoinedLeague()) return this.unload()`，不提示）
    assert.ok(/buildLeagueMgrView\(snapshot\.myUnion, MGR_TEXTS\)/.test(src));
    assert.ok(/console\.warn\([\s\S]{0,60}未入盟/.test(readFileSync(MGR_PAGE_TS, 'utf8')), '数据缺失只 warn（老端不提示）');
    assert.ok(/this\.close\(\);\s*\n\s*return;/.test(src), 'warn 后 close');
});

test('E4 ⚠️ 管理：`mgrButton` 开申请列表、两颗退出钮走同一个二次确认', () => {
    const src = stripComments(readFileSync(MGR_PAGE_TS, 'utf8'));
    assert.ok(/LeagueApplyListPage\.open\(\)/.test(src), 'mgrButton 要开 LeagueApplyListPage');
    assert.ok(/openLeagueExitConfirm\(/.test(src), '退出要走二次确认');
    assert.ok(/this\.bindClick\(this\.quitButton, \(\) => this\.onQuitClick\(\)\)/.test(src));
    assert.ok(/this\.bindClick\(this\.quitOnlyButton, \(\) => this\.onQuitClick\(\)\)/.test(src));
    // 确认后**先 close 再发包**（老端 `onSure` 顺序）
    assert.ok(/this\.close\(\);\s*\n\s*void this\.repository\.quit\(this\)/.test(src), '先关面板再发 quit');
    // 复制 ID：本端已接通（走 copyLeagueText 安全通道，非微信环境退回 navigator.clipboard）
    assert.ok(/this\.bindClick\(this\.copyIdButton, \(\) => this\.onCopyId\(\)\)/.test(src), 'copyIdButton 要调 onCopyId');
    assert.ok(/copyLeagueText/.test(src), '复制要经 copyLeagueText 安全通道');
});

test('E5 ⚠️ 管理：申请列表是**静态 import**（不是动态 `await import`）', () => {
    const raw = readFileSync(MGR_PAGE_TS, 'utf8');
    assert.ok(/^import \{ LeagueApplyListPage \} from '\.\/LeagueApplyListPage';$/m.test(raw),
        '要用静态 import（动态 import + 末尾包装类会让 cid 反解与单测都失灵）');
    assert.ok(!/await import\(/.test(stripComments(raw)), '不该有动态 import');
});

test('E6 ⚠️ 管理：`quickJoinLabel` 是**显式 `@property`**（不是按名字摸节点）', () => {
    const raw = readFileSync(MGR_PAGE_TS, 'utf8');
    const src = stripComments(raw);
    assert.ok(/quickJoinLabel: Node = null!;/.test(raw), 'quickJoinLabel 要是 @property');
    assert.ok(!/getChildByName\('QuickJoinLabel'\)/.test(src), '按名字取节点会在 prefab 改名时静默失效');
    // 切页只动 active，不做几何调整
    const applyPage = /private applyPage\(page: 0 \| 1\): void \{([\s\S]*?)\n    \}/.exec(src);
    assert.ok(applyPage, '找不到 applyPage');
    const body = applyPage![1]!;
    for (const prop of ['mgrButton', 'quitButton', 'quickJoinButton', 'quickJoinLabel']) {
        assert.ok(body.includes(`setActive(this.${prop}, show)`), `${prop} 应在页 1 显示`);
    }
    assert.ok(body.includes('setActive(this.quitOnlyButton, !show)'), 'quitOnlyButton 在页 0 显示');
    assert.ok(!/lpos|position|setPosition/.test(body), '切页不该动坐标');
});

test('E7 联盟信息：`onOpen` 取行数据 → 空则提示并关闭；加入成功**不关面板**', () => {
    const src = stripComments(readFileSync(INFO_PAGE_TS, 'utf8'));
    // 入参是「行」不是 id（搜索结果不在缓存表里）
    assert.ok(/buildLeagueInfoViewFromUnionView\(userData\?\.union, INFO_TEXTS\)/.test(src));
    assert.ok(/interface ILeagueInfoParams/.test(readFileSync(INFO_PAGE_TS, 'utf8')));
    assert.ok(/readonly union\?: ILeagueUnionView \| null;/.test(src));
    // 空 ⇒ 提示 + 关
    assert.ok(/FW\.showTip\(LEAGUE_INFO_NOT_FOUND\)/.test(src), '空数据要提示');
    assert.ok(/FW\.showTip\(LEAGUE_INFO_NOT_FOUND\);[\s\S]{0,80}this\.close\(\)/.test(src), '提示后立刻关（老端 unload）');
    // 加入：数组协议 + 防连点 + 成功不关
    assert.ok(/this\.repository\.join\(\[view\.id\], this\)/.test(src), 'join 传的是**数组**');
    assert.ok(/if \(this\.busy\) return;/.test(src) && /this\.busy = true;/.test(src), '要防连点');
    assert.ok(/if \(result === 'ok'\) return;/.test(src), '成功只 return（不 close）');
    assert.ok(!/this\.close\(\)[\s\S]{0,40}repository\.join/.test(src), 'join 前后不该 close');
});

test('E8 ⚠️ `LeagueRepository.join`：逐 id 清洗 + 空早退 + 数组协议', () => {
    const src = stripComments(readFileSync(REPO_TS, 'utf8'));
    const at = src.indexOf('async join(');
    assert.ok(at >= 0, '找不到 join 实现');
    const body = src.slice(at, at + 600);
    assert.ok(/const id = toIdString\(raw\)/.test(body), '每个 id 都要过 toIdString');
    assert.ok(/if \(id && id !== '0'\) ids\.push\(id\)/.test(body), "空 / '0' 的 id 要丢");
    assert.ok(/if \(!ids\.length\) return 'failed'/.test(body), '一个合法 id 都没有 ⇒ 早退不发包');
    assert.ok(/new RequestUnionJoin\(\{ unionIds: ids \}/.test(body), '走 unionIds 数组协议');
    // 接口上有这个方法
    assert.ok(/join\(unionIds: readonly string\[\], caller\?: unknown\): Promise<LeagueRequestResult>;/.test(src));
});

test('E9 ⚠️ 两条链路都按「行 → 详情」透传（不是按 id 回缓存查）', () => {
    const table = readFileSync('assets/script/app/league/LeagueTable.ts', 'utf8');
    assert.ok(/readonly wxChat: string;/.test(table), 'ILeagueUnionView 要带裸微信号');
    assert.ok(/readonly declaration: string;/.test(table), 'ILeagueUnionView 要带宣言');
    assert.ok(/wxChat: row\.wxChat,/.test(table) && /declaration: row\.declaration,/.test(table),
        'buildLeagueUnionViews 要透传这两个字段');
    // 老端没有对 btn_join 做「是否本盟」的显隐 ⇒ 本端也不做
    const src = stripComments(readFileSync(INFO_PAGE_TS, 'utf8'));
    assert.ok(!/joinButton[\s\S]{0,60}\.active\s*=/.test(src), '不要给「加入」按钮加本盟判据（老端没有）');
    assert.ok(/不判「是否本盟」/.test(readFileSync(INFO_PAGE_TS, 'utf8')),
        '「不做本盟判据」这个决定要写在注释里');
});

// ============================================================
// F. 母面板接线闭链（本刀的收口条件）
// ============================================================

const HALL_PAGE_TS = 'assets/script/app/league/LeagueHallPage.ts';

test('F1 ⚠️ 大厅两个入口都已从「未开放提示」换成真弹窗', () => {
    const raw = readFileSync(HALL_PAGE_TS, 'utf8');
    const src = stripComments(raw);
    // 静态 import（与已有的 LeagueLevelPreviewPage 同形态）
    assert.ok(/^import \{ LeagueInfoPage \} from '\.\/LeagueInfoPage';$/m.test(raw), '缺 LeagueInfoPage import');
    assert.ok(/^import \{ LeagueMgrPage \} from '\.\/LeagueMgrPage';$/m.test(raw), '缺 LeagueMgrPage import');
    assert.ok(!/await import\(/.test(src), '不该有动态 import');
    // 管理：btn_mgr
    assert.ok(/this\.onClick\(this\.mgrButton, \(\) => void LeagueMgrPage\.open\(\)\)/.test(src),
        'mgrButton 要开 LeagueMgrPage');
    assert.ok(!/onClick\(this\.mgrButton[\s\S]{0,60}LEAGUE_TIP_NOT_OPEN/.test(src),
        '⚠️ mgrButton 不该再是「未开放」提示');
    // 联盟信息：全服列表点行
    assert.ok(/void LeagueInfoPage\.open\(\{ userData: \{ union: view \} \}\)/.test(src),
        'onUnionClick 要把**行对象**透传给 LeagueInfoPage');
    assert.ok(!/const view = this\.serverRows\[index\];[\s\S]{0,120}LEAGUE_TIP_NOT_OPEN/.test(src),
        '⚠️ onUnionClick 不该再是「未开放」提示');
});

test('F2 复制 ID / 复制微信号 已接通（走 copyLeagueText 安全通道）', () => {
    const raw = readFileSync(HALL_PAGE_TS, 'utf8');
    const src = stripComments(raw);
    // 老端这两个按钮压根没接线；本端现已接通：复制联盟 ID / 微信号
    assert.ok(/this\.onClick\(this\.copyIdButton, \(\) => this\.onCopyId\(\)\)/.test(src), 'copyIdButton 要调 onCopyId');
    assert.ok(/this\.onClick\(this\.copyWxButton, \(\) => this\.onCopyWx\(\)\)/.test(src), 'copyWxButton 要调 onCopyWx');
    assert.ok(/copyLeagueText/.test(src), '复制要经 copyLeagueText 安全通道');
    assert.ok(/import \{ copyLeagueText \} from '\.\/LeagueClipboard'/.test(raw), '要静态 import copyLeagueText');
});

test('F3 ⚠️ 接线不能引成环：只有 LeaguePage 反过来依赖 LeagueHallPage', () => {
    // `LeagueHallPage` 新增了两个同目录 import；若被 import 的页面反过来依赖大厅就会成环
    // （tsx / cocos 都可能在某条加载顺序上拿到 undefined）。
    for (const dep of ['LeagueMgrPage', 'LeagueInfoPage', 'LeagueApplyListPage', 'LeagueEditPage',
        'LeagueLevelPreviewPage', 'LeagueExitConfirm']) {
        const p = `assets/script/app/league/${dep}.ts`;
        assert.ok(existsSync(p), `缺文件：${p}`);
        assert.ok(!readFileSync(p, 'utf8').includes("from './LeagueHallPage'"), `${dep} 不该反过来 import 大厅`);
    }
    // 反过来，只有入口页依赖大厅（保持这个方向）
    const dependents = ['LeaguePage'].map((n) => `assets/script/app/league/${n}.ts`);
    assert.ok(dependents.some((p) => readFileSync(p, 'utf8').includes("from './LeagueHallPage'")));
});
