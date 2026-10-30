/**
 * 「联盟 · 大厅」P2 第二刀（**退出提示 + 等级预览**）的回归网。
 *
 * 与 `league-hall.test.ts`（母面板）同一套四段口径：
 *
 *   A. **文案口径**（`LeagueTexts` 两个子面板段）—— 退出确认正文（含原稿笔误）/ 确定取消 /
 *      弹窗标题 / 等级行两条前缀。
 *   B. **美术口径**（`LeagueArt` 的公共弹窗骨架段 + 等级预览段）—— 弹窗骨架**跨模块**取
 *      `image/common`（不在 `image/league`），等级行三张图的九宫格归属，以及「图真的在磁盘上」。
 *   C. **配置表解析**（`LeagueTable` 的 `unionLevel` 段）—— 三种入参形状、脏行丢弃、
 *      按 level 升序、`addCount = 本级 − 上一级`（**按 level 查上一级，不是下标**）。
 *   D. **prefab 结构 + 几何**（`ui/League/LeagueLevelPreview.prefab`）—— 脚本 cid 反解、
 *      全 UI_2D、顶层序、12 节点几何（**含列表行内的两行文案**）、九宫格、`@f9941` 可解析。
 *   E. **页面逻辑 / 调用约定**（源码文本）—— 虚拟列表只绑一次、`nextPopupFrame` 时序、
 *      退出提示**不建 prefab**（复用 `CommonTips`）。
 *
 * 口径真源：
 *   - 设计：`zarts/art/UIProject/trunk/UIProject/assets/主界面_联盟/大厅/组件_联盟_大厅_等级预览.xml`、
 *     `大厅/组件_联盟_大厅_退出提示.xml`、`组件/组件_联盟_等级预览Item.xml`、
 *     `共用组件/组件/弹窗/组件_公共弹窗_新.xml`
 *   - 老端：`client/assets/script/app/game/ctrl/main/league/play/LayerLeagueExitConfirm.ts`、
 *     `.../LayerLeagueHallLevelPreview.ts`
 *   - 配置表：`assets/remoteRef/unionLevel.json`（10 行）
 *   - 本项目：`assets/script/app/league/**`
 *
 * ⚠️ 三条**刻意与 FGUI 原稿不同**（理由见 `LeagueLevelPreviewPage.ts` / `LeagueExitConfirm.ts` 文件头）：
 *   ① 弹窗骨架的标题条 / 装饰条 / 闭钮改用工程既有的 `image/common/title_01|title_02|btn_close`
 *      （不引 FGUI 的 `title_brown` 与公用弹窗包的其它素材）；**底板**在第四刀换成了公用0 的
 *      真九宫格 `panel_window_01_9gong.png`（拷进 `image/league`），见 B1；
 *   ② 弹窗恒居中 —— FGUI 里 `popBg` 那对 xy 只是设计态坐标，不照抄；
 *   ③ 退出提示**不建 prefab**，复用 `app/common/CommonTips`。
 */

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import test from 'node:test';

import {
    LEAGUE_ART_LEVEL_ROW_BG,
    LEAGUE_ART_LEVEL_ROW_CTX_BAR,
    LEAGUE_ART_LEVEL_ROW_CTX_BAR_ALPHA,
    LEAGUE_ART_LEVEL_ROW_CTX_BAR_TINT,
    LEAGUE_ART_LEVEL_ROW_TITLE_BAR,
    LEAGUE_ART_LEVEL_ROW_TITLE_BAR_ALPHA,
    LEAGUE_ART_POPUP_BOARD,
    LEAGUE_ART_POPUP_CLOSE,
    LEAGUE_ART_POPUP_TITLE_BG,
    LEAGUE_ART_POPUP_TITLE_DECO,
    LEAGUE_ART_SLICED,
    LEAGUE_POPUP_ART_ROOT,
    LEAGUE_POPUP_BOARD_ROOT,
    LEAGUE_SPRITE_SIMPLE,
    LEAGUE_SPRITE_SLICED,
    leagueSpriteType,
} from '../assets/script/app/league/LeagueArt';
import {
    buildLeagueLevelViews,
    LEAGUE_UNION_LEVEL_TABLE,
    parseUnionLevelRows,
    toRefRows,
} from '../assets/script/app/league/LeagueTable';
import {
    LEAGUE_EXIT_CONFIRM_CANCEL,
    LEAGUE_EXIT_CONFIRM_CONTENT,
    LEAGUE_EXIT_CONFIRM_SURE,
    LEAGUE_LEVEL_PREVIEW_TITLE,
    LEAGUE_LEVEL_ROW_CTX_PREFIX,
    LEAGUE_LEVEL_ROW_TITLE_PREFIX,
} from '../assets/script/app/league/LeagueTexts';
import { assetPath } from './helpers/asset-paths';

// ============================================================
// A. 文案口径（LeagueTexts 子面板段）
// ============================================================

test('A1 退出确认正文逐字 = FGUI 原稿（含原文笔误「推出后」）', () => {
    // FGUI `组件_联盟_大厅_退出提示.xml` 把这句话**写死**了（老端没走 `FW.G_W`），
    // 所以移植时逐字照搬。这里把「笔误」也钉成契约 —— 将来统一改文案要**同时**改这条断言。
    assert.equal(
        LEAGUE_EXIT_CONFIRM_CONTENT,
        '是否退出联盟?推出后1小时内不能再加入联盟,盟主职位将自动给本联盟内个人累计贡献值最高的玩家',
    );
    assert.ok(LEAGUE_EXIT_CONFIRM_CONTENT.includes('推出后'), '⚠️ 原稿就是「推出后」，不是「退出后」');
    assert.ok(!LEAGUE_EXIT_CONFIRM_CONTENT.includes('退出后'), '别顺手「修」成「退出后」—— 会与 FGUI 不一致');
    // 半角问号 / 半角逗号也是原稿的，别改成全角
    assert.ok(LEAGUE_EXIT_CONFIRM_CONTENT.includes('联盟?'), '原稿用半角问号');
    assert.ok(LEAGUE_EXIT_CONFIRM_CONTENT.includes('联盟,'), '原稿用半角逗号');
    assert.equal(LEAGUE_EXIT_CONFIRM_SURE, '确定');
    assert.equal(LEAGUE_EXIT_CONFIRM_CANCEL, '取消');
});

test('A2 等级预览标题 + 等级行两条前缀（老端 `LV_TEXT_0` / `UNION_LEVEL_PREVIEW_TEXT`）', () => {
    assert.equal(LEAGUE_LEVEL_PREVIEW_TITLE, '等级预览');
    assert.equal(LEAGUE_LEVEL_ROW_TITLE_PREFIX, '等级');
    // ⚠️ 原稿是**全角冒号 + 加号**：渲染成「最大可加入人数：+40」
    assert.equal(LEAGUE_LEVEL_ROW_CTX_PREFIX, '最大可加入人数：+');
    assert.ok(LEAGUE_LEVEL_ROW_CTX_PREFIX.endsWith('：+'), '全角冒号后紧跟加号');
});

test('A3 ⚠️ 页面类里不出现文案字面量（一律从 LeagueTexts 取）', () => {
    const src = readFileSync(PREVIEW_PAGE_TS, 'utf8');
    for (const literal of ['等级预览', '等级', '最大可加入人数', '推出后']) {
        assert.ok(!src.includes(`'${literal}'`), `页面类里不要写死文案「${literal}」`);
    }
    assert.ok(src.includes('LEAGUE_LEVEL_PREVIEW_TITLE'), '标题应来自 LeagueTexts');

    const exit = readFileSync(EXIT_CONFIRM_TS, 'utf8');
    for (const literal of ['是否退出联盟', '确定', '取消']) {
        assert.ok(!exit.includes(`'${literal}'`), `退出提示里不要写死文案「${literal}」`);
    }
    for (const name of ['LEAGUE_EXIT_CONFIRM_CONTENT', 'LEAGUE_EXIT_CONFIRM_SURE', 'LEAGUE_EXIT_CONFIRM_CANCEL']) {
        assert.ok(exit.includes(name), `缺引用 ${name}`);
    }
});

// ============================================================
// B. 美术口径（公共弹窗骨架 + 等级预览段）
// ============================================================

test('B1 弹窗骨架：标题条/闭钮在 `image/common`，**底板**在 `image/league`（第四刀换真底板）', () => {
    // FGUI 联盟各弹窗的 `popBg` 引的是**公用包**（`5ibsib88`）的 `组件_公共弹窗_新`，
    // 联盟包自己没有这套图 ⇒ 标题条 / 装饰条 / 闭钮跨模块取工程既有的 `image/common`（同 CommonTips）。
    assert.equal(LEAGUE_POPUP_ART_ROOT, 'image/common');
    assert.equal(LEAGUE_ART_POPUP_TITLE_BG, 'title_01');
    assert.equal(LEAGUE_ART_POPUP_TITLE_DECO, 'title_02');
    assert.equal(LEAGUE_ART_POPUP_CLOSE, 'btn_close');
    // ⚠️ 底板换成了公用0 的**真九宫格**底板 `panel_window_01_9gong.png`（394×307，网格 129,128,123,36）。
    //    前两刀拿 `bg_04`(651×982)/`bg_05`(582×404) 顶替，那两张 `border` 全 0、只能等比拉伸，
    //    在 640×706 / 640×437 这类尺寸上会把四角撕边压扁。真底板按 id 反查拷进本模块目录
    //    （口径同 TY_btn17/18/19），所以它**不在** `image/common`。
    assert.equal(LEAGUE_ART_POPUP_BOARD, 'panel_window_01_9gong');
    assert.equal(LEAGUE_POPUP_BOARD_ROOT, 'image/league');
    assert.notEqual(LEAGUE_POPUP_BOARD_ROOT, LEAGUE_POPUP_ART_ROOT);
    assert.ok(LEAGUE_ART_SLICED.has(LEAGUE_ART_POPUP_BOARD), '真底板必须九宫格渲染');
});

test('B2 等级行三张图名 = FGUI 原名（跨包按 id 反查拷入）+ 衬底色调/透明度常量', () => {
    assert.equal(LEAGUE_ART_LEVEL_ROW_BG, 'frame_Zhikuang01');
    assert.equal(LEAGUE_ART_LEVEL_ROW_TITLE_BAR, 'BB_img03');
    assert.equal(LEAGUE_ART_LEVEL_ROW_CTX_BAR, 'white_jiao8');
    // FGUI 组件_联盟_等级预览Item.xml：`n1` alpha=0.5 / `n4` alpha=0.4 color=#cbaa85
    assert.deepEqual([...LEAGUE_ART_LEVEL_ROW_CTX_BAR_TINT], [0xcb, 0xaa, 0x85], 'n4 color="#cbaa85"');
    assert.equal(LEAGUE_ART_LEVEL_ROW_CTX_BAR_ALPHA, 102, 'n4 alpha=0.4 ⇒ 102');
    assert.equal(LEAGUE_ART_LEVEL_ROW_TITLE_BAR_ALPHA, 128, 'n1 alpha=0.5 ⇒ 128');
});

test('B3 ⚠️ 弹窗骨架 4 张 + 底板 1 张 + 等级行 3 张都必须真的在磁盘上（拷漏不报错，只是渲染空白）', () => {
    for (const art of [
        LEAGUE_ART_POPUP_TITLE_BG,
        LEAGUE_ART_POPUP_TITLE_DECO,
        LEAGUE_ART_POPUP_CLOSE,
    ]) {
        const png = assetPath(`${LEAGUE_POPUP_ART_ROOT}/${art}.png`);
        assert.ok(existsSync(png), `缺图：${png}`);
        assert.ok(existsSync(`${png}.meta`), `缺 meta：${png}.meta（编辑器不会导入）`);
    }
    const board = assetPath(`${LEAGUE_POPUP_BOARD_ROOT}/${LEAGUE_ART_POPUP_BOARD}.png`);
    assert.ok(existsSync(board), `缺图：${board}`);
    assert.ok(existsSync(`${board}.meta`), `缺 meta：${board}.meta`);
    for (const art of [LEAGUE_ART_LEVEL_ROW_BG, LEAGUE_ART_LEVEL_ROW_TITLE_BAR, LEAGUE_ART_LEVEL_ROW_CTX_BAR]) {
        const png = assetPath(`image/league/${art}.png`);
        assert.ok(existsSync(png), `缺图：${png}`);
        assert.ok(existsSync(`${png}.meta`), `缺 meta：${png}.meta`);
    }
});

test('B4 ⚠️ 等级行只有 2 张是九宫格（-`BB_img03`）；弹窗底板是真九宫格、其余骨架图 SIMPLE', () => {
    // `frame_Zhikuang01` 显示 540×110（原图 155×113）、`white_jiao8` 显示 430×32（原图 24×24）
    // ⇒ 必须 SLICED，否则边框被拉扁。
    // `BB_img03` 原图 233×31、显示 470×40 —— FGUI 里**没有** `scale9grid` ⇒ SIMPLE。
    for (const art of [LEAGUE_ART_LEVEL_ROW_BG, LEAGUE_ART_LEVEL_ROW_CTX_BAR]) {
        assert.ok(LEAGUE_ART_SLICED.has(art), `${art} 应为九宫格`);
        assert.equal(leagueSpriteType(art), LEAGUE_SPRITE_SLICED, `${art} 的 Sprite._type 应为 1`);
    }
    assert.equal(leagueSpriteType(LEAGUE_ART_LEVEL_ROW_TITLE_BAR), LEAGUE_SPRITE_SIMPLE, `${LEAGUE_ART_LEVEL_ROW_TITLE_BAR} 应为 SIMPLE`);
    // 公共弹窗骨架里「标题条 / 装饰条 / 闭钮」在 FGUI 里都没标 9grid ⇒ 一律 SIMPLE。
    // ⚠️ 底板**不在这组**：第四刀已把前两刀顶替用的 `bg_04`/`bg_05`（`border` 全 0、只能等比拉伸）
    //    换成公用0 的真九宫格 `panel_window_01_9gong` ⇒ 底板是 **SLICED**（B1 也有断）。
    for (const art of [
        LEAGUE_ART_POPUP_TITLE_BG,
        LEAGUE_ART_POPUP_TITLE_DECO,
        LEAGUE_ART_POPUP_CLOSE,
    ]) {
        assert.equal(leagueSpriteType(art), LEAGUE_SPRITE_SIMPLE, `${art} 应为 SIMPLE`);
    }
    assert.ok(LEAGUE_ART_SLICED.has(LEAGUE_ART_POPUP_BOARD), `${LEAGUE_ART_POPUP_BOARD} 应为九宫格`);
    assert.equal(leagueSpriteType(LEAGUE_ART_POPUP_BOARD), LEAGUE_SPRITE_SLICED,
        `${LEAGUE_ART_POPUP_BOARD} 的 Sprite._type 应为 1（真底板，第四刀换上的）`);
});

// ============================================================
// C. 配置表解析（LeagueTable 的 unionLevel 段）
// ============================================================

/** 真表（`assets/remoteRef/unionLevel.json`）—— 断「投影到代码常量」的一致性。 */
const REAL_TABLE = JSON.parse(readFileSync('assets/remoteRef/unionLevel.json', 'utf8')) as unknown;

test('C1 表名 = `unionLevel`（老端 `Ref.RefMgrunionLevel`）', () => {
    assert.equal(LEAGUE_UNION_LEVEL_TABLE, 'unionLevel');
    assert.ok(existsSync('assets/remoteRef/unionLevel.json'), '表文件必须在');
});

test('C2 `toRefRows` 吃三种形状：{k,v} 列式 / {k,v} 对象行 / 对象数组', () => {
    // ① 本表的形状：k 是列名、v 是「行数组的数组」
    assert.deepEqual(toRefRows({ k: ['a', 'b'], v: [[1, 2], [3, 4]] }), [{ a: 1, b: 2 }, { a: 3, b: 4 }]);
    // ② v 里已经是对象
    assert.deepEqual(toRefRows({ k: ['a'], v: [{ a: 9 }] }), [{ a: 9 }]);
    // ③ 直接就是对象数组
    assert.deepEqual(toRefRows([{ a: 1 }]), [{ a: 1 }]);
    // 脏入参**不抛**（表缺失时界面应空着而不是崩）
    for (const dirty of [null, undefined, 0, '', 'x', {}, { k: [] }, { v: [] }, { k: ['a'] }]) {
        assert.deepEqual(toRefRows(dirty), [], `toRefRows(${JSON.stringify(dirty)}) 应为空数组`);
    }
});

test('C3 `parseUnionLevelRows`：真表 10 行、按 level 升序、值 = 40..65', () => {
    const rows = parseUnionLevelRows(REAL_TABLE);
    assert.equal(rows.length, 10, '现网 10 行');
    assert.deepEqual(rows.map((r) => r.level), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.deepEqual(rows.map((r) => r.maxCount), [40, 42, 44, 46, 48, 51, 54, 57, 60, 65]);
    assert.deepEqual(rows.map((r) => r.exp), [2000, 5000, 10000, 17000, 26000, 37000, 50000, 65000, 82000, 101000]);
});

test('C4 ⚠️ `parseUnionLevelRows`：乱序输入要排序，脏行要丢，`exp` 缺失补 0', () => {
    const rows = parseUnionLevelRows({
        k: ['level', 'maxCount', 'exp'],
        v: [
            [3, 44, 10000],
            [1, 40, 2000],
            ['x', 99, 1], // level 解析不出 → 丢
            [5, 'abc', 3], // maxCount 解析不出 → 丢
            [2, 42], // 没有 exp 列 → 补 0
            [4, '46', '17000'], // 字符串数字要能认（remoteRef 导出可能是字符串）
        ],
    });
    assert.equal(rows.length, 4, '两条脏行被丢掉（level="x" / maxCount="abc"）');
    assert.deepEqual(rows.map((r) => r.level), [1, 2, 3, 4], '乱序输入要按 level 升序返回');
    assert.deepEqual(rows, [
        { level: 1, maxCount: 40, exp: 2000 },
        { level: 2, maxCount: 42, exp: 0 },
        { level: 3, maxCount: 44, exp: 10000 },
        { level: 4, maxCount: 46, exp: 17000 },
    ]);
    assert.deepEqual(parseUnionLevelRows(null), [], '空表 → 空数组，不抛');
});

test('C5 ⚠️ `buildLeagueLevelViews`：`addCount = 本级 − 上一级`；第 1 级 = 本级上限', () => {
    const views = buildLeagueLevelViews(parseUnionLevelRows(REAL_TABLE));
    assert.equal(views.length, 10);
    // 第 1 级没有上一级 ⇒ 老端 fallback 用本级上限（40，不是 0）
    assert.deepEqual(views[0], { level: 1, title: '等级1', ctx: '最大可加入人数：+40' });
    // 之后 = 本级 − 上一级
    assert.deepEqual(views[1], { level: 2, title: '等级2', ctx: '最大可加入人数：+2' });
    assert.deepEqual(views[5], { level: 6, title: '等级6', ctx: '最大可加入人数：+3' });
    assert.deepEqual(views[9], { level: 10, title: '等级10', ctx: '最大可加入人数：+5' });
    assert.deepEqual(views.map((v) => v.ctx.replace('最大可加入人数：+', '')), ['40', '2', '2', '2', '2', '3', '3', '3', '3', '5']);
    // 前缀可覆盖（复用方 / 多语言）
    const custom = buildLeagueLevelViews(parseUnionLevelRows(REAL_TABLE), 'LV', 'MAX +');
    assert.equal(custom[0].title, 'LV1');
    assert.equal(custom[0].ctx, 'MAX +40');
});

test('C6 ⚠️ 上一级按 **level** 查（`refId - 1`），不是按数组下标 —— 级别不连续时两者不等价', () => {
    // 表里只有 1 / 2 / 5：老端 `getRef('level', 5-1=4)` 返回空 ⇒ 第 5 级 fallback 用本级上限；
    // 若错写成「减去前一行的 maxCount」，第 5 级会算出 50−42=8（错）。
    const rows = parseUnionLevelRows({ k: ['level', 'maxCount'], v: [[5, 50], [1, 40], [2, 42]] });
    const views = buildLeagueLevelViews(rows);
    assert.deepEqual(views, [
        { level: 1, title: '等级1', ctx: '最大可加入人数：+40' }, // 无 level 0 ⇒ 本级上限
        { level: 2, title: '等级2', ctx: '最大可加入人数：+2' }, // 42 − 40
        { level: 5, title: '等级5', ctx: '最大可加入人数：+50' }, // 无 level 4 ⇒ 本级上限（不是 50−42）
    ]);
});

test('C7 空表 / 单行等边界：不抛，行数正确', () => {
    assert.deepEqual(buildLeagueLevelViews([]), []);
    assert.deepEqual(buildLeagueLevelViews(parseUnionLevelRows({ k: ['level', 'maxCount'], v: [] })), []);
    assert.deepEqual(buildLeagueLevelViews(parseUnionLevelRows({ k: ['level', 'maxCount'], v: [[7, 9]] })), [
        { level: 7, title: '等级7', ctx: '最大可加入人数：+9' },
    ]);
});

// ============================================================
// D. prefab 结构 + 几何
// ============================================================

const PREVIEW_PREFAB = assetPath('ui/League/LeagueLevelPreview.prefab');
const PREVIEW_PAGE_TS = 'assets/script/app/league/LeagueLevelPreviewPage.ts';
const ROW_TS = 'assets/script/app/league/LeagueLevelRow.ts';
const VSCROLL_TS = 'assets/script/vscrollview/VScrollView.ts';
const EXIT_CONFIRM_TS = 'assets/script/app/league/LeagueExitConfirm.ts';
const UI_2D = 33554432;

type Entry = Record<string, unknown>;
/** `@property` 里的颜色取出来（`Entry` 的值是 `unknown`，直接点属性过不了 `--strict`）。 */
const rgb = (comp: Entry): [number, number, number] => {
    const c = comp._color as { r: number; g: number; b: number };
    return [c.r, c.g, c.b];
};
const prefab: Entry[] = JSON.parse(readFileSync(PREVIEW_PREFAB, 'utf8')) as Entry[];
const at = (ref: unknown): Entry | null =>
    ref && typeof ref === 'object' && '__id__' in (ref as Entry) ? prefab[(ref as { __id__: number }).__id__]! : null;

/**
 * 去掉块注释与行注释 —— 供 **反向断言** 用。
 *
 * 本工程的新文件都带一段「为什么这么做」的文档注释，里面会引用老端代码（`await RequestLeagueQuit()`）、
 * 也会点名 `PopupBase` / `Repository` 这些**刻意不用**的东西。直接 `src.includes(x)` 会把注释也算命中，
 * 于是「不该用 X」的断言必然误红。判代码就只看代码。
 */
const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const nodes = prefab.filter((e) => e && e.__type__ === 'cc.Node');
const rootNode = nodes[0]!;

/** 顶层渲染序（= 生成器 ORDER；弹窗底板最底、列表最后）。 */
const PREVIEW_ORDER = ['PopupBg', 'TitleBg', 'TitleDeco', 'Title', 'CloseBtn', 'RowView'];

/**
 * 反解每个节点的「画布像素视觉框」（画布 720×1280，y 向下同 FGUI，根中心 = (360,640)）。
 * 同 `league-hall.test.ts` 的口径：子位移乘父级 scale、框宽高乘自身 scale。
 */
function solveCanvasRects(): Map<string, { node: Entry; cx: number; cy: number; left: number; top: number; w: number; h: number }> {
    const out = new Map<string, { node: Entry; cx: number; cy: number; left: number; top: number; w: number; h: number }>();
    const walk = (node: Entry, path: string, pCx: number, pCy: number, pSx: number, pSy: number): void => {
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
        out.set(path, { node, cx, cy, left: cx - anchor.x * vw, top: cy - (1 - anchor.y) * vh, w: vw, h: vh });
        for (const child of ((node._children ?? []) as unknown[])) {
            const c = at(child);
            if (c) walk(c, `${path}/${c._name}`, cx, cy, sx, sy);
        }
    };
    walk(rootNode, 'LeagueLevelPreview', 360, 640, 1, 1);
    return out;
}
const rects = solveCanvasRects();

const customCids = [...new Set(prefab.map((e) => e?.__type__).filter((t) => t && !String(t).startsWith('cc.')))] as string[];

/** `compressUuid`：`.ts.meta` 的 uuid → prefab 里的脚本 cid。 */
function compressUuid(uuid: string): string {
    const KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const hex = uuid.replace(/-/g, '');
    let want = hex.slice(0, 5);
    for (let i = 5; i < 32; i += 3) {
        const v = parseInt(hex.slice(i, i + 3), 16);
        want += KEYS[v >> 6] + KEYS[v & 63];
    }
    return want;
}
const cidOf = (tsPath: string): string =>
    compressUuid((JSON.parse(readFileSync(`${tsPath}.meta`, 'utf8')) as { uuid: string }).uuid);

test('D1 根节点 = 第一个 cc.Node、无父、`.meta` 在', () => {
    assert.ok(existsSync(PREVIEW_PREFAB), `prefab 不存在：${PREVIEW_PREFAB}`);
    assert.ok(existsSync(`${PREVIEW_PREFAB}.meta`), '缺 LeagueLevelPreview.prefab.meta');
    const data = (prefab[0] as { data: { __id__: number } }).data;
    assert.equal(data.__id__, prefab.findIndex((e) => e && e.__type__ === 'cc.Node'));
    assert.equal(rootNode._name, 'LeagueLevelPreview');
    assert.equal(rootNode._parent, null, '根节点没有父节点');
});

test('D2 节点总数 = 12 + 根（重跑生成器若忘了先删旧产物，这里会翻倍）', () => {
    // ⚠️ `prefab_prefab_lifecycle create` 是「追加」语义。上次中途崩过一次（fetch failed），
    // 这条同时守着「清理干净了」。
    assert.equal(nodes.length, 13, `节点数应为 13（12 + 根），实得 ${nodes.length}`);
});

test('D3 ⚠️ 所有节点 `_layer` 都是 UI_2D（落 DEFAULT 会让整棵子树不渲染且不报错）', () => {
    const layers = new Set(nodes.map((n) => n._layer));
    assert.deepEqual([...layers], [UI_2D], `出现非 UI_2D 的 layer：${[...layers].join(', ')}`);
});

test('D4 顶层渲染序：底板最底、闭钮在标题之后、列表最后', () => {
    const order = ((rootNode._children ?? []) as unknown[]).map((c) => at(c)!._name);
    assert.deepEqual(order, PREVIEW_ORDER);
    assert.equal(order[0], 'PopupBg', '弹窗底板必须最底');
    assert.ok(order.indexOf('PopupBg') < order.indexOf('TitleBg'));
    assert.ok(order.indexOf('Title') < order.indexOf('CloseBtn'));
    assert.equal(order[order.length - 1], 'RowView', '列表必须最后（压在底板之上）');
});

test('D5 ⚠️ 三个脚本的 cid 都能从各自 `.ts.meta` 反解（抄错会变成 MissingScript）', () => {
    // 三个：列表容器的 `VirtualScrollView` + 行模板的 `LeagueLevelRow` + 弹窗本体的 `LeagueLevelPreviewPage`
    assert.equal(customCids.length, 3, `应有 3 个自定义脚本组件，实得：${customCids.join(', ')}`);
    const wantRoot = cidOf(PREVIEW_PAGE_TS);
    const wantRow = cidOf(ROW_TS);
    const wantScroll = cidOf(VSCROLL_TS);
    for (const cid of [wantRoot, wantRow, wantScroll]) assert.equal(String(cid).length, 23, `cid 长 23，实得 ${String(cid).length}`);
    assert.equal(new Set([wantRoot, wantRow, wantScroll]).size, 3, '三个脚本的 cid 不能相同');
    assert.deepEqual([...customCids].sort(), [wantRoot, wantRow, wantScroll].sort(), 'cid 与三个 .ts.meta 的反解值必须一致');
    // 宿主：主脚本在根、行脚本在 LevelRow、虚拟列表在 RowView
    const hostNameOf = (cid: string) => at(prefab.find((e) => e?.__type__ === cid)!.node)!._name;
    assert.equal(hostNameOf(wantRoot), 'LeagueLevelPreview', '主脚本必须挂在根节点上');
    assert.equal(hostNameOf(wantRow), 'LevelRow', '行脚本必须挂在 LevelRow 上');
    assert.equal(hostNameOf(wantScroll), 'RowView', 'VirtualScrollView 必须挂在 RowView 上');
});

test('D6 6 个 @property 全部绑到正确的宿主节点（根 2 + 行 4）', () => {
    const pathOf = new Map<number, string>();
    for (const [p, v] of rects) pathOf.set(prefab.indexOf(v.node), p);
    const checkBind = (cid: string, bind: Record<string, string>): void => {
        const comp = prefab.find((e) => e?.__type__ === cid)!;
        for (const [prop, wantPath] of Object.entries(bind)) {
            const ref = comp[prop] as unknown;
            assert.ok(ref, `@property ${prop} 没绑（漏绑不报错，只是运行时 null）`);
            const target = at(ref)!;
            const hostIdx = target.__type__ === 'cc.Node' ? prefab.indexOf(target) : (target.node as { __id__: number }).__id__;
            assert.equal(pathOf.get(hostIdx), wantPath, `@property ${prop} 绑错`);
        }
    };
    checkBind(cidOf(PREVIEW_PAGE_TS), {
        closeButton: 'LeagueLevelPreview/CloseBtn',
        levelList: 'LeagueLevelPreview/RowView',
    });
    checkBind(cidOf(ROW_TS), {
        titleBar: 'LeagueLevelPreview/RowView/content/LevelRow/BarDeco',
        titleLabel: 'LeagueLevelPreview/RowView/content/LevelRow/Title',
        ctxBar: 'LeagueLevelPreview/RowView/content/LevelRow/Bar',
        ctxLabel: 'LeagueLevelPreview/RowView/content/LevelRow/Ctx',
    });
});

test('D7 ⚠️ 虚拟列表的 `content` / `itemNode` 必须指向列表内部（漏了列表恒空且不报错）', () => {
    const rowView = rects.get('LeagueLevelPreview/RowView')!.node;
    const comps = ((rowView._components ?? []) as unknown[]).map(at);
    const vsv = comps.find((c) => c && !String(c.__type__).startsWith('cc.'));
    assert.ok(vsv, 'RowView 上没挂 VirtualScrollView');
    const resolve = (ref: unknown): string | undefined => {
        const t = at(ref);
        if (!t) return undefined;
        const idx = t.__type__ === 'cc.Node' ? prefab.indexOf(t) : (t.node as { __id__: number }).__id__;
        for (const [p, v] of rects) if (prefab.indexOf(v.node) === idx) return p;
        return undefined;
    };
    assert.equal(resolve(vsv!.content), 'LeagueLevelPreview/RowView/content', 'VirtualScrollView.content 绑错');
    assert.equal(resolve(vsv!.itemNode), 'LeagueLevelPreview/RowView/content/LevelRow', 'VirtualScrollView.itemNode 绑错');
    // 行必须是 content 的子节点，否则列表滚不动
    assert.equal(rects.get('LeagueLevelPreview/RowView/content/LevelRow')!.node._parent !== null, true);
});

test('D8 ⚠️ prefab 里每个 `cc.Button` 都必须被某个 `@property` 覆盖（否则就是死按钮）', () => {
    const boundPaths = new Set<string>();
    const pathOfIdx = new Map<number, string>();
    for (const [p, v] of rects) pathOfIdx.set(prefab.indexOf(v.node), p);
    for (const cid of customCids) {
        const comp = prefab.find((e) => e?.__type__ === cid)!;
        for (const prop of Object.keys(comp)) {
            const target = at(comp[prop]);
            if (!target) continue;
            const idx = target.__type__ === 'cc.Node' ? prefab.indexOf(target) : (target.node as { __id__: number } | undefined)?.__id__;
            if (idx !== undefined && idx >= 0) {
                const p = pathOfIdx.get(idx);
                if (p) boundPaths.add(p);
            }
        }
    }
    const buttonPaths: string[] = [];
    for (const n of nodes) {
        const has = ((n._components ?? []) as unknown[]).map(at).some((c) => c?.__type__ === 'cc.Button');
        if (!has) continue;
        const p = pathOfIdx.get(prefab.indexOf(n));
        if (p) buttonPaths.push(p);
    }
    assert.deepEqual(buttonPaths, ['LeagueLevelPreview/CloseBtn'], `闭钮是唯一按钮，实得 ${buttonPaths.join(', ')}`);
    const dead = buttonPaths.filter((p) => !boundPaths.has(p));
    assert.deepEqual(dead, [], `这些按钮没被任何 @property 接上（点了没反应）：${dead.join(', ')}`);
});

test('D9 Sprite 口径：7 个、sizeMode=CUSTOM(0)、type 与九宫格集合一致', () => {
    const SLICED = new Set(['PopupBg', 'LevelRow', 'Bar']); // 底板 panel_window_01_9gong（第四刀换）/ frame_Zhikuang01 / white_jiao8
    const sprites: { name: string; sp: Entry }[] = [];
    for (const n of nodes) {
        const sp = ((n._components ?? []) as unknown[]).map(at).find((c) => c?.__type__ === 'cc.Sprite');
        if (sp) sprites.push({ name: n._name as string, sp: sp! });
    }
    assert.equal(sprites.length, 7, `实得 ${sprites.length} 个 Sprite`);
    // 名字按字典序比（`cc.Node` 在文件里的序列化次序不是契约；渲染序由 `_children` 定，见 D4）
    assert.deepEqual(
        [...sprites.map((s) => s.name)].sort(),
        ['PopupBg', 'TitleBg', 'TitleDeco', 'CloseBtn', 'LevelRow', 'BarDeco', 'Bar'].sort(),
        `Sprite 名单不符：${sprites.map((s) => s.name).join(', ')}`,
    );
    for (const { name, sp } of sprites) {
        assert.equal(sp._sizeMode, 0, `${name} 的 sizeMode 应为 CUSTOM(0)，否则 contentSize 会被底图回写`);
        assert.equal(sp._type, SLICED.has(name) ? 1 : 0, `${name} 的 type 与九宫格口径不符`);
        assert.ok(sp._spriteFrame, `${name} 的 spriteFrame 为空（会渲染成空白）`);
    }
});

test('D10 Label 口径：3 个、overflow ∈ {NONE,SHRINK}、wrap=false，且样式逐项对 FGUI', () => {
    const labels: { path: string; lb: Entry }[] = [];
    for (const [p, v] of rects) {
        const lb = ((v.node._components ?? []) as unknown[]).map(at).find((c) => c?.__type__ === 'cc.Label');
        if (lb) labels.push({ path: p, lb: lb! });
    }
    assert.equal(labels.length, 3, `实得 ${labels.length} 个 Label`);
    for (const { path, lb } of labels) {
        assert.ok(lb._overflow === 0 || lb._overflow === 2, `${path} 的 overflow=${lb._overflow}`);
        assert.equal(lb._enableWrapText, false, `${path} 必须关掉自动换行`);
    }
    const byPath = new Map(labels.map((x) => [x.path, x.lb]));
    // 文案（`_string` 才是序列化字段；`string` 是 getter，读 prefab JSON 时是 undefined）
    assert.equal(byPath.get('LeagueLevelPreview/Title')!._string, '等级预览', '弹窗标题占位文案');
    assert.equal(byPath.get('LeagueLevelPreview/RowView/content/LevelRow/Title')!._string, '等级1', '行标题占位 = 前缀 + 等级');
    assert.equal(byPath.get('LeagueLevelPreview/RowView/content/LevelRow/Ctx')!._string, '最大可加入人数：+40', '行副文案占位 = 前缀 + 新增上限');
    const TITLE = byPath.get('LeagueLevelPreview/Title')!;
    assert.equal(TITLE._fontSize, 30, '弹窗标题 30px');
    assert.equal(TITLE._isBold, true, '弹窗标题加粗');
    assert.equal(TITLE._enableOutline, true, '弹窗标题有描边');
    assert.equal(TITLE._outlineWidth, 3, '弹窗标题 strokeSize=3');
    assert.deepEqual(rgb(TITLE), [0xff, 0xf6, 0xc4], '弹窗标题 #fff6c4');
    assert.equal(TITLE._horizontalAlign, 1, '弹窗标题居中');
    assert.equal(TITLE._verticalAlign, 1, '弹窗标题垂直居中');

    const ROW_TITLE = byPath.get('LeagueLevelPreview/RowView/content/LevelRow/Title')!;
    assert.equal(ROW_TITLE._fontSize, 26, '行标题 26px');
    assert.deepEqual(rgb(ROW_TITLE), [0xfc, 0xf0, 0xd6], '行标题 #fcf0d6');
    assert.equal(ROW_TITLE._enableOutline, true, '行标题有描边');
    assert.equal(ROW_TITLE._horizontalAlign, 1, '行标题居中');
    assert.equal(ROW_TITLE._isBold, false, '行标题不加粗');

    // ⚠️ 副文案的**颜色是反的**（深字压浅条）：FGUI 没写 color ⇒ 默认黑、无描边、左对齐
    const ROW_CTX = byPath.get('LeagueLevelPreview/RowView/content/LevelRow/Ctx')!;
    assert.equal(ROW_CTX._fontSize, 26, '副文案 26px');
    assert.deepEqual(rgb(ROW_CTX), [0, 0, 0], '副文案默认黑');
    assert.equal(ROW_CTX._enableOutline, false, '副文案无描边');
    assert.equal(ROW_CTX._horizontalAlign, 0, '副文案左对齐');
    // 3.8 的 `cc.LabelOutline` 是废弃空壳，描边必须走 Label 内建
    assert.equal(prefab.filter((e) => e?.__type__ === 'cc.LabelOutline').length, 0, '不应有 cc.LabelOutline');
});

test('D11 ⚠️ 行内两张衬底的 rgba = FGUI（含 `Bar` 的**色调** #cbaa85，原图是纯白）', () => {
    // 整行底框是深色九宫格，两行文案各压一条半透明衬底。alpha 丢了会让文字糊在一起。
    //
    // ⚠️ 只写 alpha 不够：`n4` 的 `white_jiao8.png` 是**纯白**（实测 opaque 像素 rgb 恒 = 255,255,255），
    //    FGUI 靠 `color="#cbaa85"` 把它染成茶色。漏了色调就会渲染成**白条** —— 不报错、也不是空帧，
    //    只有肉眼能看出色差。
    // ⚠️ 别直接把 `_color` 原样返回：序列化出来的是 `{__type__:'cc.Color', r,g,b,a}`，
    //    带 `__type__` 去 `deepStrictEqual` 会「差一个键」而红，且报错信息看不出是键的问题。
    const colorOf = (p: string): { r: number; g: number; b: number; a: number } => {
        const sp = ((rects.get(p)!.node._components ?? []) as unknown[]).map(at).find((c) => c?.__type__ === 'cc.Sprite');
        const c = sp?._color as { r: number; g: number; b: number; a: number };
        return { r: c.r, g: c.g, b: c.b, a: c.a };
    };
    assert.deepEqual(colorOf('LeagueLevelPreview/RowView/content/LevelRow/BarDeco'), { r: 255, g: 255, b: 255, a: 128 },
        'BarDeco 只有 alpha（`BB_img03` 原图已是棕色，FGUI 没给 color）');
    assert.deepEqual(colorOf('LeagueLevelPreview/RowView/content/LevelRow/Bar'), { r: 0xcb, g: 0xaa, b: 0x85, a: 102 },
        'Bar 必须带 FGUI 的色调 #cbaa85 / alpha 0.4（白色原图 + 白字会看不出来）');
    // 行底框本身不透明、不带色
    assert.deepEqual(colorOf('LeagueLevelPreview/RowView/content/LevelRow'), { r: 255, g: 255, b: 255, a: 255 });
});

// ============================================================
// D* 几何：FGUI 视觉框 → 画布像素
// ============================================================

/** [路径, 期望 left, top, 宽, 高]（FGUI `xy` + `size`，容差 0.6px）。 */
const GEOMETRY: [string, number, number, number, number][] = [
    // 弹窗底：FGUI popBg (40,187) 640×905
    ['LeagueLevelPreview/PopupBg', 40, 187, 640, 905],
    // 标题条：FGUI `n6`(title_brown 344×81) xy=141,-28 相对 popBg ⇒ 绝对 y = 187-28 = 159
    ['LeagueLevelPreview/TitleBg', 59.5, 166.5, 601, 66],
    ['LeagueLevelPreview/TitleDeco', 233.5, 177.5, 253, 44],
    // 标题文字：FGUI `title` 中心 (320,10) 相对 popBg ⇒ 绝对 (360,197)
    ['LeagueLevelPreview/Title', 240, 176, 240, 42],
    // 闭钮：relation right-right(2) / top-top(-20) ⇒ 中心 (648,197)
    ['LeagueLevelPreview/CloseBtn', 621, 171.5, 54, 51],
    // 列表：FGUI requestList (90,252) 540×746（锚点 (0.5,1)）
    ['LeagueLevelPreview/RowView', 90, 252, 540, 746],
    ['LeagueLevelPreview/RowView/content', 90, 252, 540, 746],
    // 行模板：行高 110、lineGap=0 ⇒ 首行占 252..362
    ['LeagueLevelPreview/RowView/content/LevelRow', 90, 252, 540, 110],
    // 行内：FGUI `n1` xy=35,6 470×40 ⇒ 绝对 (125,258)
    ['LeagueLevelPreview/RowView/content/LevelRow/BarDeco', 125, 258, 470, 40],
    // FGUI `n4` xy=55,53 430×32 ⇒ 绝对 (145,305)
    ['LeagueLevelPreview/RowView/content/LevelRow/Bar', 145, 305, 430, 32],
    // FGUI `title` xy=176,9 187×36 ⇒ 绝对 (266,261)
    ['LeagueLevelPreview/RowView/content/LevelRow/Title', 266, 261, 187, 36],
    // FGUI `ctx` xy=65,51 257×36 ⇒ 绝对 (155,303)
    ['LeagueLevelPreview/RowView/content/LevelRow/Ctx', 155, 303, 257, 36],
];

test('D12 ⚠️ 12 个节点的画布视觉框全部对上 FGUI（含列表里那两行文案）', () => {
    const bad: string[] = [];
    for (const [path, fx, fy, fw, fh] of GEOMETRY) {
        const g = rects.get(path);
        if (!g) { bad.push(`${path} 节点缺失`); continue; }
        const near = (a: number, b: number) => Math.abs(a - b) <= 0.6;
        if (!near(g.left, fx) || !near(g.top, fy) || !near(g.w, fw) || !near(g.h, fh)) {
            bad.push(`${path} 期望(${fx},${fy}) ${fw}x${fh} 实得(${g.left.toFixed(1)},${g.top.toFixed(1)}) ${g.w.toFixed(1)}x${g.h.toFixed(1)}`);
        }
    }
    assert.deepEqual(bad, [], `几何不符 ${bad.length} 处：\n  ${bad.join('\n  ')}`);
});

test('D12b ⚠️ 弹窗恒居中（FGUI 那对 xy 是设计态坐标，不照抄）', () => {
    // 老端 `toFullCenterParent` + FGUI relation `center-center,middle-middle` ⇒ 弹窗中心必须落在画布中心附近。
    const g = rects.get('LeagueLevelPreview/PopupBg')!;
    assert.ok(Math.abs(g.cx - 360) <= 0.6, `弹窗中心 x 应为 360，实得 ${g.cx.toFixed(1)}`);
    // y：popBg 高 905 ⇒ 居中时 top = (1280-905)/2 = 187.5，生成器取 187（FGUI 设计态值）
    assert.ok(Math.abs(g.top - 187) <= 0.6, `弹窗 top 应在 187 附近，实得 ${g.top.toFixed(1)}`);
});

test('D12c ⚠️ 行内元素的「相对行」偏移 = FGUI 行内坐标（行模板会被 clone 复用）', () => {
    // 行模板整行 540×110，若行内元素是照「弹窗绝对坐标」摆的，滚动后整行会错位。
    // 用「相对首行左上角 (90,252)」的偏移来钉，与行在列表里的纵向位置解耦。
    const row = rects.get('LeagueLevelPreview/RowView/content/LevelRow')!;
    const rel = (p: string) => {
        const g = rects.get(p)!;
        return [g.left - row.left, g.top - row.top];
    };
    assert.deepEqual(rel('LeagueLevelPreview/RowView/content/LevelRow/BarDeco'), [35, 6], 'BarDeco 相对行 (35,6)');
    assert.deepEqual(rel('LeagueLevelPreview/RowView/content/LevelRow/Bar'), [55, 53], 'Bar 相对行 (55,53)');
    assert.deepEqual(rel('LeagueLevelPreview/RowView/content/LevelRow/Title'), [176, 9], 'Title 相对行 (176,9)');
    assert.deepEqual(rel('LeagueLevelPreview/RowView/content/LevelRow/Ctx'), [65, 51], 'Ctx 相对行 (65,51)');
});

// ============================================================
// D** 引用的图必须能解析到 `@f9941` 帧子资源（悬空 ⇒ 运行时品红块）
// ============================================================

/** 索引 `assets/resources` 下所有图片 meta：顶层 uuid → { 路径, 导入类型, 有无 f9941 子资源 }。 */
function indexImageMetas(dir: string, out: Map<string, { file: string; type: string; hasFrame: boolean }>): void {
    for (const name of readdirSync(dir)) {
        const p = `${dir}/${name}`;
        if (statSync(p).isDirectory()) { indexImageMetas(p, out); continue; }
        if (!/\.(png|jpg)\.meta$/.test(name)) continue;
        const meta = JSON.parse(readFileSync(p, 'utf8')) as {
            uuid: string;
            userData?: { type?: string };
            subMetas?: Record<string, unknown>;
        };
        out.set(meta.uuid, {
            file: p,
            type: meta.userData?.type ?? '(none)',
            hasFrame: !!meta.subMetas?.f9941,
        });
    }
}

test('D13 ⚠️ prefab 里 7 个 spriteFrame 引用全部能解析到「sprite-frame」子资源（悬空 ⇒ 运行时品红块）', () => {
    // 踩坑记录：新导入的 PNG 默认被导成 `userData.type="texture"` ⇒ 只有 `@6c48a` 纹理、
    // 没有 `@f9941` 帧 ⇒ prefab 里的引用**悬空**。它**不报错、`sprite.spriteFrame` 也不是 null**，
    // 只有画面上是品红块 ⇒ 必须在静态阶段核「引用能否解析」。
    const metas = new Map<string, { file: string; type: string; hasFrame: boolean }>();
    indexImageMetas('assets/resources', metas);

    const raw = readFileSync(PREVIEW_PREFAB, 'utf8');
    const refs = [...new Set([...raw.matchAll(/"([0-9a-f-]{36}@f9941)"/g)].map((m) => m[1]))];
    assert.equal(refs.length, 7, `prefab 里应有 7 个不同的 spriteFrame 引用，实得 ${refs.length}`);

    const dangling: string[] = [];
    for (const ref of refs) {
        const top = ref.split('@')[0];
        const meta = metas.get(top);
        if (!meta) dangling.push(`${ref} → 资源库里没有这个 uuid`);
        else if (!meta.hasFrame) dangling.push(`${ref} → ${meta.file} 没有 @f9941 子资源（type=${meta.type}）`);
        else if (meta.type !== 'sprite-frame') dangling.push(`${ref} → ${meta.file} 的 userData.type=${meta.type}`);
    }
    assert.deepEqual(dangling, [], `悬空 / 类型不对的 spriteFrame：\n  ${dangling.join('\n  ')}`);
});

test('D14 ⚠️ 需要九宫格的两张图，`.png.meta` 里必须有非零 border（否则 SLICED 等于 SIMPLE）', () => {
    // `type=1`（SLICED）只是「请求」九宫格；真正的分割线来自 `.png.meta` 的
    // `subMetas.f9941.userData.borderLeft/Top/Right/Bottom`。border 全 0 时渲染与 SIMPLE 无异。
    const BORDER: Record<string, number[]> = {
        frame_Zhikuang01: [38, 28, 76, 56],
        white_jiao8: [13, 9, 0, 6],
    };
    for (const [art, want] of Object.entries(BORDER)) {
        const meta = JSON.parse(readFileSync(assetPath(`image/league/${art}.png.meta`), 'utf8')) as {
            userData?: { type?: string };
            subMetas?: Record<string, { userData?: Record<string, number> }>;
        };
        assert.equal(meta.userData?.type, 'sprite-frame', `${art} 的 userData.type 必须被改成 sprite-frame`);
        const sub = meta.subMetas?.f9941;
        assert.ok(sub, `${art} 没有 @f9941 子资源`);
        const ud = sub!.userData ?? {};
        assert.deepEqual(
            [ud.borderLeft, ud.borderTop, ud.borderRight, ud.borderBottom],
            want,
            `${art} 的 border 应为 ${want.join(',')}（FGUI scale9grid）`,
        );
        assert.ok(want.some((v) => v > 0), `${art} 的 border 不能全 0`);
    }
});

// ============================================================
// E. 页面逻辑 / 调用约定（源码文本）
// ============================================================

test('E1 `prefabPath` 大小写与磁盘一致，且继承 PopupBase', () => {
    const page = readFileSync(PREVIEW_PAGE_TS, 'utf8');
    assert.ok(page.includes("static prefabPath = 'ui/League/LeagueLevelPreview'"), "prefabPath 必须是 'ui/League/LeagueLevelPreview'");
    assert.ok(page.includes('extends PopupBase'), '等级预览是子弹窗 ⇒ 继承 PopupBase');
    assert.ok(existsSync(PREVIEW_PREFAB), '磁盘上要有 LeagueLevelPreview.prefab');
    assert.ok(page.includes("import { LeagueLevelRow } from './LeagueLevelRow'"), '要 import 行组件');
});

test('E2 ⚠️ 虚拟列表三处时序守点：renderItemFn 只绑一次 / 取数后 defer 一帧 / 完了 refreshList', () => {
    const page = readFileSync(PREVIEW_PAGE_TS, 'utf8');
    // ① `renderItemFn` 在 `onInit` 里赋一次即可：`PopupBase._inited` 保证 onInit 每实例只跑一次，
    //    所以「只绑一次」的布尔门闩已统一删除（2026-10-30）；放 `onOpen` 才会重复叠加。
    assert.ok(!/if\s*\(!this\.rowRendererBound\)/.test(page), '不该再有「只绑一次」门闩（onInit 每实例只跑一次）');
    const initEnd = page.indexOf('protected async onOpen');
    const initBody = page.slice(page.indexOf('protected onInit(): void {'), initEnd > 0 ? initEnd : undefined);
    assert.ok(initBody.includes('this.levelList.renderItemFn ='), '`renderItemFn` 要在 onInit 里赋一次');
    // ② `VirtualScrollView` 在 `start()` 里建槽位，而 `onOpen` 早于 `start()` ⇒ 必须 defer
    assert.ok(page.includes('await this.nextPopupFrame()'), '⚠️ 铺数据前必须 await nextPopupFrame()，否则列表空白');
    assert.ok(page.includes('this.levelList.refreshList('), '没调用 refreshList');
    assert.ok(page.includes('this.levelList.scrollToTop('), '刷新后要回到顶部');
    // ③ 异步回来时必须复核「还活着 / 还是这一趟」
    assert.ok(page.includes('revision'), '缺 revision（在飞的异步结果会把旧数据写回新弹窗）');
    assert.ok(page.includes('private get alive()'), '缺 alive 守卫（PopupBase 没有这个成员）');
    assert.ok(page.includes('this.alive'), 'alive 必须真的被用到');
});

test('E3 ⚠️ 数据只读配置表：走 RefUtil，且**不建 Repository**', () => {
    const page = readFileSync(PREVIEW_PAGE_TS, 'utf8');
    assert.ok(page.includes("from '../../framework/ref/RefUtil'"), '要 import RefUtil');
    assert.ok(page.includes('RefUtil.instance.getRefAllAsync(LEAGUE_UNION_LEVEL_TABLE)'), '要按表名取表');
    assert.ok(page.includes('LEAGUE_UNION_LEVEL_TABLE'), '表名必须来自 LeagueTable 常量');
    // 老端 `LayerLeagueHallLevelPreview` 也只读 `Ref.RefMgrunionLevel`，不发协议
    assert.ok(!/import .*Repository/.test(page), '等级预览是纯读表 ⇒ 不该引 Repository');
    // 表读失败要降级成空列表，不许把界面打崩
    assert.ok(/try\s*\{/.test(page) && /catch\s*\(/.test(page), '读表要有 try/catch 降级');
});

test('E4 行组件 `render()` 绝对赋值（虚拟列表会 clone 复用槽位）', () => {
    const row = readFileSync(ROW_TS, 'utf8');
    assert.ok(row.includes("@ccclass('LeagueLevelRow')"), 'ccclass 名 = LeagueLevelRow');
    assert.ok(row.includes('extends Component'), '行是普通组件，不是 PopupBase');
    for (const prop of ['titleBar', 'titleLabel', 'ctxBar', 'ctxLabel']) {
        assert.ok(row.includes(prop), `缺 @property ${prop}`);
    }
    // 复用槽位时「只在有值时写」会留上一行的残留 ⇒ 两行文案都必须**无条件**赋值
    assert.ok(row.includes('this.titleLabel.string = view.title'), 'titleLabel 必须绝对赋值');
    assert.ok(row.includes('this.ctxLabel.string = view.ctx'), 'ctxLabel 必须绝对赋值');
    assert.ok(/hide\(\)\s*:\s*void/.test(row) || row.includes('hide(): void'), '要能整行藏掉');
    assert.ok(row.includes('this.node.active = false'), 'hide() 要真的把行关掉');
});

test('E5 ⚠️ 退出提示复用 `CommonTips`，**不新建 prefab**', () => {
    const exit = readFileSync(EXIT_CONFIRM_TS, 'utf8');
    assert.ok(exit.includes("from '../common/CommonTips'"), '要复用工程既有的 CommonTips');
    assert.ok(exit.includes('CommonTips.open('), '要走 CommonTips.open');
    for (const field of ['content:', 'sureText:', 'cancelText:', 'onSure']) {
        assert.ok(exit.includes(field), `CommonTips.open 的 userData 缺 ${field}`);
    }
    assert.ok(exit.includes('export function openLeagueExitConfirm('), '导出的是函数（不是页面类）');
    // 真源是一处**调用**，不是一张版式 ⇒ 不该有 prefab
    assert.ok(!existsSync('assets/resources/ui/League/LeagueExitConfirm.prefab'), '退出提示不该新建 prefab');
    // ⚠️ 反向断言只看**代码**：注释里正解释了「CommonTips 已经是 PopupBase，再造一份是重复实现」，
    //    拿原文 includes 会把这句话本身当成违规。
    const code = stripComments(exit);
    assert.ok(!/extends\s+PopupBase/.test(code), '退出提示不是独立面板类（不该 extends PopupBase）');
    assert.ok(!/@ccclass/.test(code), '退出提示不该是 @ccclass 组件（是组件就得配 prefab）');
    // 网络层收在 Repository（未建）⇒ 这里只转回调，不发包
    assert.ok(!/Repository/.test(code), '退出提示不该自己发包');
});

test('E6 ⚠️ 「确定」的回调在弹窗关闭**之前**触发（否则先关窗再回调，调用方拿不到上下文）', () => {
    const exit = readFileSync(EXIT_CONFIRM_TS, 'utf8');
    // onSure 是直接透传给 CommonTips 的（由 CommonTips 负责「先回调、后关闭」），
    // 这里守「没有把 onSure 包一层异步 / 包一层 setTimeout」——包了就改变了时序契约。
    assert.ok(/onSure,\s*\n\s*\}/.test(exit) || /onSure\b/.test(exit), 'onSure 应原样透传');
    // ⚠️ 同样只看代码：注释里抄了老端的 `await RequestLeagueQuit()`，原文 includes('await') 会误红。
    const code = stripComments(exit);
    assert.ok(!/setTimeout/.test(code), '别用 setTimeout 包 onSure（时序会变）');
    assert.ok(!/\bawait\b/.test(code), '退出提示是同步函数（不该是 async）');
});

test('E7 三个新文件都在磁盘上且各有 `.ts.meta`（不然编辑器不认）', () => {
    for (const f of [PREVIEW_PAGE_TS, ROW_TS, EXIT_CONFIRM_TS]) {
        assert.ok(existsSync(f), `缺文件：${f}`);
        assert.ok(existsSync(`${f}.meta`), `缺 meta：${f}.meta`);
    }
});
