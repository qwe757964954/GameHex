/**
 * 「联盟 · 大厅」母面板（P2 垂直切片）的回归网。
 *
 * 分四段，各守一件事：
 *
 *   A. **文案口径**（`LeagueTexts` 的大厅段）—— 三个页签名、详情表头三列、
 *      占位串、`ID:`/`微信号:`/`级` 前缀。
 *   B. **美术口径**（`LeagueArt` 的大厅段）—— 大厅用图名、页签「选中/未选中」
 *      两套图标、九宫格集合（6 张，与主页的空集**刻意不同**）。
 *   C. **prefab 结构 + 几何**（`ui/League/LeagueHall.prefab`）—— 脚本 cid 必须能从
 *      `.ts.meta` 反解（防抄错成 `MissingScript`）；所有节点 `_layer` 必须 UI_2D
 *      （落 DEFAULT 整棵子树不渲染且不报错）；顶层序 = FGUI `displayList` 序；
 *      几何必须与 FGUI 大厅各 XML 反解出的画布像素一致（**含缩放节点**：
 *      FGUI 的 `scale` 绕元素左上角，视觉框 = `xy → xy + size*scale`）。
 *   D. **入口接线 + 页面逻辑**（源码文本）—— `BtnHall` 在 `LeagueTable` 里 `landed:true`、
 *      `LeaguePage.onEntranceClick` 真的 `open` 了大厅、`prefabPath` 与磁盘大小写一致、
 *      未落地的子面板必须走提示而不是静默。
 *
 * 口径真源：
 *   - 设计：`zarts/art/UIProject/trunk/UIProject/assets/主界面_联盟/大厅/**`
 *     （`组件_联盟_大厅.xml` + 详情 / 动态 / 全服 / 按钮_大厅页签 / 按钮_联盟_管理 /
 *      组件_联盟_进度条 / 组件_联盟_查询）
 *   - 老端：`client/assets/script/app/game/ctrl/main/league/play/LayerLeagueHall.ts`
 *   - 本项目：`assets/script/app/league/**`
 *
 * ⚠️ 三条**刻意与 FGUI 原稿不同**（理由见 `LeagueHallPage.ts` 文件头），本文件当契约钉住：
 *   ① 三个页签是三个 `active` 容器（不引 FGUI 页签框架）；
 *   ② 页签选中态用 `BgUp/IconUp` 与 `BgDown/IconDown` 四子节点互斥（口径同 `MainTabHost`）；
 *   ③ 两个「全面屏适配」helper 不移植（屏幕适配交给 Canvas/Widget）。
 */

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import test from 'node:test';

import {
    LEAGUE_ART_BACK,
    LEAGUE_ART_BOTTOM_BAR,
    LEAGUE_ART_COPY,
    LEAGUE_ART_DETAIL_FRAME,
    LEAGUE_ART_HALL_BG,
    LEAGUE_ART_HALL_FRAME,
    LEAGUE_ART_INPUT_BG,
    LEAGUE_ART_MGR_BTN,
    LEAGUE_ART_NOTICE_BG,
    LEAGUE_ART_PIC07,
    LEAGUE_ART_PROGRESS_BG,
    LEAGUE_ART_PROGRESS_FILL,
    LEAGUE_ART_ROOT,
    LEAGUE_ART_SEARCH_BTN,
    LEAGUE_ART_SLICED,
    LEAGUE_ART_TAB_DOWN,
    LEAGUE_ART_TAB_UP,
    LEAGUE_HALL_TAB_ARTS,
    LEAGUE_SPRITE_SIMPLE,
    LEAGUE_SPRITE_SLICED,
    LEAGUE_TAB_ICON_ROOT,
    leagueSpriteType,
    leagueTabIconArt,
} from '../assets/script/app/league/LeagueArt';
import { LEAGUE_ENTRANCES, landedLeagueEntrances, leagueEntranceByNode } from '../assets/script/app/league/LeagueTable';
import {
    LEAGUE_HALL_DEFAULT_NOTICE,
    LEAGUE_HALL_DETAIL_HEADERS,
    LEAGUE_HALL_ID_PREFIX,
    LEAGUE_HALL_LV_SUFFIX,
    LEAGUE_HALL_MGR_LABEL,
    LEAGUE_HALL_PLACEHOLDER,
    LEAGUE_HALL_SEARCH_PROMPT,
    LEAGUE_HALL_TABS,
    LEAGUE_HALL_WX_PREFIX,
    LEAGUE_TIP_NOT_OPEN,
} from '../assets/script/app/league/LeagueTexts';
import { assetPath } from './helpers/asset-paths';

// ============================================================
// A. 文案口径（LeagueTexts 大厅段）
// ============================================================

test('A1 三个页签文案 = FGUI `标签` controller 页序（详情 / 动态 / 全服联盟）', () => {
    assert.deepEqual([...LEAGUE_HALL_TABS], ['详情', '动态', '全服联盟']);
    assert.equal(LEAGUE_HALL_TABS.length, 3, '页签数 = 3（与 LEAGUE_HALL_TAB_ARTS 必须同长）');
    assert.equal(new Set(LEAGUE_HALL_TABS).size, 3);
});

test('A2 文案常量（页面类里不出现中文字面量）', () => {
    assert.equal(LEAGUE_HALL_DEFAULT_NOTICE, '暂无公告');
    assert.equal(LEAGUE_HALL_LV_SUFFIX, '级');
    assert.equal(LEAGUE_HALL_ID_PREFIX, 'ID:');
    // ⚠️ 冒号必须是**全角** U+FF1A：老端运行时是 `FW.G_W("CONTACT_WAY")`，
    //    而 `mL.json` 里那条 = 「微信号：」。FGUI 设计稿写的半角 `微信号:` 只是设计期占位串。
    assert.equal(LEAGUE_HALL_WX_PREFIX, '微信号：');
    assert.equal(LEAGUE_HALL_WX_PREFIX.codePointAt(3), 0xff1a, '第 4 个字符必须是全角冒号 U+FF1A');
    assert.equal(LEAGUE_HALL_MGR_LABEL, '管理');
    assert.equal(LEAGUE_HALL_SEARCH_PROMPT, '点击输入ID');
    const page = readFileSync(HALL_PAGE_TS, 'utf8');
    for (const literal of ['暂无公告', '点击输入ID', '全服联盟']) {
        assert.ok(!page.includes(`'${literal}'`), `页面类里不要写死文案「${literal}」`);
    }
    assert.ok(page.includes('LEAGUE_HALL_PLACEHOLDER'), '头部占位必须来自 LeagueTexts');
});

test('A3 详情页签表头三列逐字（FGUI 组件_联盟_大厅详情.xml 的 <text>）', () => {
    assert.deepEqual(LEAGUE_HALL_DETAIL_HEADERS, {
        memberCount: '联盟成员',
        lastLogin: '上次登陆', // ⚠️ 原稿就是「登陆」不是「登录」
        contribution: '今日/历史贡献',
    });
});

test('A4 头部占位串：数值域自洽（真值等 CmdUnion 接上）', () => {
    const p = LEAGUE_HALL_PLACEHOLDER;
    assert.equal(p.name, '北伐中原');
    assert.equal(p.notice, LEAGUE_HALL_DEFAULT_NOTICE);
    assert.equal(p.id, 2115228);
    assert.equal(p.wxChat, 'lianmeng_888');
    assert.ok(p.level >= 1, '等级至少 1');
    assert.ok(p.exp >= 0 && p.exp <= p.maxExp, '经验必须落在 [0, maxExp]（否则进度条会溢出）');
    assert.ok(p.memberCount >= 0 && p.memberCount <= p.maxMemberCount, '成员数不得超过上限');
});

// ============================================================
// B. 美术口径（LeagueArt 大厅段）
// ============================================================

test('B1 大厅用图名 = FGUI 原名（跨包图按 id 反查拷入）', () => {
    assert.equal(LEAGUE_ART_ROOT, 'image/league');
    assert.equal(LEAGUE_ART_HALL_BG, 'lm_bg02');
    assert.equal(LEAGUE_ART_HALL_FRAME, 'lm_kj_pic08');
    assert.equal(LEAGUE_ART_NOTICE_BG, 'frame_Zhikuang02');
    assert.equal(LEAGUE_ART_DETAIL_FRAME, 'frame_Dikuang03');
    assert.equal(LEAGUE_ART_PIC07, 'lm_pic07');
    assert.equal(LEAGUE_ART_INPUT_BG, 'frame_shurukuang');
    assert.equal(LEAGUE_ART_SEARCH_BTN, 'hy_btn02');
    assert.equal(LEAGUE_ART_COPY, 'lm_btn01');
    assert.equal(LEAGUE_ART_MGR_BTN, 'fyt_pic07');
    // 三张来自公用包（w3m64m87）的图，按公用包 id 反查得到，不是按名字猜的
    assert.equal(LEAGUE_ART_BOTTOM_BAR, 'diban_BG');
    assert.equal(LEAGUE_ART_BACK, 'btn_FanHui');
    assert.equal(LEAGUE_ART_TAB_UP, 'TY_btn13');
    assert.equal(LEAGUE_ART_TAB_DOWN, 'TY_btn14');
    assert.equal(LEAGUE_ART_PROGRESS_BG, 'bar_bg_01');
    assert.equal(LEAGUE_ART_PROGRESS_FILL, 'bar_bg_01_hong');
});

test('B2 ⚠️ 大厅这 6 张公用图必须真的在磁盘上（跨包拷漏了不报错，只是渲染空白）', () => {
    for (const art of [
        LEAGUE_ART_BOTTOM_BAR,
        LEAGUE_ART_BACK,
        LEAGUE_ART_TAB_UP,
        LEAGUE_ART_TAB_DOWN,
        LEAGUE_ART_PROGRESS_BG,
        LEAGUE_ART_PROGRESS_FILL,
    ]) {
        const png = assetPath(`${LEAGUE_ART_ROOT}/${art}.png`);
        assert.ok(existsSync(png), `缺图：${png}`);
        assert.ok(existsSync(`${png}.meta`), `缺 meta：${png}.meta（编辑器不会导入）`);
    }
});

test('B3 页签图标复用「主界面图标目录」，两套（选中/未选中）互不相同', () => {
    assert.equal(LEAGUE_TAB_ICON_ROOT, 'icons/main');
    assert.equal(LEAGUE_HALL_TAB_ARTS.length, LEAGUE_HALL_TABS.length, '每页签一套图标');
    const names = LEAGUE_HALL_TAB_ARTS.flatMap((a) => [a.up, a.down]);
    assert.equal(new Set(names).size, 6, `6 个图名必须互不相同：${names.join(',')}`);
    for (const a of LEAGUE_HALL_TAB_ARTS) {
        assert.notEqual(a.up, a.down, '选中 / 未选中不能用同一张图（看不出切换）');
        assert.ok(existsSync(assetPath(`${LEAGUE_TAB_ICON_ROOT}/${a.up}.png`)), `缺图：${a.up}`);
        assert.ok(existsSync(assetPath(`${LEAGUE_TAB_ICON_ROOT}/${a.down}.png`)), `缺图：${a.down}`);
    }
});

test('B4 leagueTabIconArt：selected=true 取选中态，越界 / 非有限数就近夹取', () => {
    assert.equal(leagueTabIconArt(0, false), LEAGUE_HALL_TAB_ARTS[0].up);
    assert.equal(leagueTabIconArt(0, true), LEAGUE_HALL_TAB_ARTS[0].down);
    assert.equal(leagueTabIconArt(2, true), LEAGUE_HALL_TAB_ARTS[2].down);
    assert.equal(leagueTabIconArt(-999, false), LEAGUE_HALL_TAB_ARTS[0].up);
    assert.equal(leagueTabIconArt(999, true), LEAGUE_HALL_TAB_ARTS[2].down);
    assert.equal(leagueTabIconArt(Number.NaN, false), LEAGUE_HALL_TAB_ARTS[0].up);
    assert.equal(leagueTabIconArt(1.9, true), LEAGUE_HALL_TAB_ARTS[1].down);
});

test('B5 ⚠️ 九宫格集合：大厅 6 张必须 SLICED（拉伸不变形），其余一律 SIMPLE', () => {
    assert.equal(LEAGUE_SPRITE_SIMPLE, 0);
    assert.equal(LEAGUE_SPRITE_SLICED, 1);
    // 大厅这版贡献 6 张；P2 第二刀（等级预览）加了 `frame_Zhikuang01` / `white_jiao8`；
    // P2 第三刀（三页签内容 + 操作浮层）又加了 `TY_btn07`（浮层 5 个按钮的底图）；
    // P2 第四刀（申请列表 / 编辑信息）又把弹窗底板换成真九宫格 `panel_window_01_9gong`
    // （顶替用的 `bg_04`/`bg_05` `border` 全 0、只能等比拉伸）；
    // P2 第五刀（管理 / 联盟信息）再加 `TY_btn06`（加入按钮）与 `shaixuan_dikuang`（勾选框底框）；
    // P3（加入 / 创建）再加 `TY_btn21`（创建页的消耗按钮，300×130 会把 56,19,112,38 的圆角拉平）；
    // P4（商店 / 捐献 / 砍价）再加 `frame_Dikuang01`（砍价大底板 105,124,190,344，显示 581×533）。
    // P6（联合战线 / 北伐中原）再加 4 张：`panel_window_02_9gong`（主板 720×660，85,117,183,56）、
    //    `frame_01_9gong`（内框 680×545，160,127,57,50）、`frame_Zhikuang05`（两块小底板 148,21,33,42）、
    //    `frame_Zhikuang04`（属性区羊皮纸 600×187，103,39,104,78）。
    //    ⚠️ 同一刀里的弹窗 `panel_window_01_9gong`、行底 `frame_Zhikuang01`、进度条 `bar_bg_01`、
    //       底栏 `diban_BG`、擂鼓/领取按钮 `TY_btn07` **全是复用已有成员** ⇒ P6 只 +4，不是 +9。
    // ⚠️ 商店行底 `frame_Zhikuang01` / 广告条 `white_jiao8` 都是**复用已有成员**，不新增；
    //    砍价两按钮用的 `TY_btn21` 也是 P3 已入集的 ⇒ P4 只 +1。
    // ⇒ 集合总数 **18**。
    // 这里只钉「大厅这 6 张在集合内」+ 总数；其余几张的归属由 `league-hall-sub.test.ts` / `league-hall-tabs.test.ts` 守。
    assert.equal(LEAGUE_ART_SLICED.size, 18, '九宫格集合现为 18 张（P4 后 14 + P6 的 4：主板 / 内框 / 两块小底板 / 属性区羊皮纸）');
    for (const art of [
        LEAGUE_ART_NOTICE_BG,
        LEAGUE_ART_DETAIL_FRAME,
        LEAGUE_ART_PIC07,
        LEAGUE_ART_INPUT_BG,
        LEAGUE_ART_BOTTOM_BAR,
        LEAGUE_ART_PROGRESS_BG,
    ]) {
        assert.ok(LEAGUE_ART_SLICED.has(art), `${art} 应为九宫格`);
        assert.equal(leagueSpriteType(art), LEAGUE_SPRITE_SLICED, `${art} 的 Sprite._type 应为 1`);
    }
    // 底栏 / 页签底 / 旗帜 / 进度填充**不是**九宫格
    for (const art of [LEAGUE_ART_TAB_UP, LEAGUE_ART_TAB_DOWN, LEAGUE_ART_PROGRESS_FILL, 'img_Qizhi_02', '不存在的图']) {
        assert.equal(leagueSpriteType(art), LEAGUE_SPRITE_SIMPLE, `${art} 应为 SIMPLE`);
    }
});

// ============================================================
// C. prefab 结构 + 几何
// ============================================================

const HALL_PREFAB = assetPath('ui/League/LeagueHall.prefab');
const HALL_PAGE_TS = 'assets/script/app/league/LeagueHallPage.ts';
const UI_2D = 33554432;

type Entry = Record<string, unknown>;
const prefab: Entry[] = JSON.parse(readFileSync(HALL_PREFAB, 'utf8')) as Entry[];
const at = (ref: unknown): Entry | null =>
    ref && typeof ref === 'object' && '__id__' in (ref as Entry) ? prefab[(ref as { __id__: number }).__id__]! : null;

const nodes = prefab.filter((e) => e && e.__type__ === 'cc.Node');
const rootNode = nodes[0]!;

/** 顶层渲染序 = FGUI `displayList` 序（去掉两个「全面屏适配」helper 与两个 graph/group）。 */
const HALL_ORDER = [
    'Bg', 'Frame', 'NoticeBg', 'Banner', 'Progress', 'BtnHelp', 'BtnCopyId', 'BtnCopyWx', 'BtnMgr',
    'LabName', 'LabLv', 'LabNotice', 'LabId', 'LabWx', 'BottomBg', 'BtnBack',
    'BtnDetail', 'BtnLog', 'BtnAllServer', 'TabDetail', 'TabLog', 'TabAllServer',
];

/**
 * 反解每个节点的「画布像素视觉框」（画布 720×1280，y 向下同 FGUI，根中心 = (360,640)）。
 *
 * ⚠️ 两个坑：
 *   ① 子节点位移要**乘父级缩放**（`pos.x * parentScale`），漏了会让缩放容器里的元素全偏；
 *   ② FGUI 的 `scale` 绕元素**左上角**（pivot 0,0），Cocos 的 `node.scale` 绕锚点 (0.5,0.5)；
 *      两者视觉框一致的前提是位置按「缩放后的中心」摆（生成器就是这么算的），
 *      反解时把父链上的 scale 一路乘下来即可。
 */
function solveCanvasRects(): Map<string, { node: Entry; left: number; top: number; w: number; h: number }> {
    const out = new Map<string, { node: Entry; left: number; top: number; w: number; h: number }>();
    const walk = (node: Entry, path: string, pCx: number, pCy: number, pSx: number, pSy: number): void => {
        const pos = (node._lpos ?? { x: 0, y: 0 }) as { x: number; y: number };
        const sc = (node._lscale ?? { x: 1, y: 1 }) as { x: number; y: number };
        const comps = ((node._components ?? []) as unknown[]).map(at);
        const uit = comps.find((c) => c?.__type__ === 'cc.UITransform');
        const size = (uit?._contentSize ?? { width: 0, height: 0 }) as { width: number; height: number };
        const anchor = (uit?._anchorPoint ?? { x: 0.5, y: 0.5 }) as { x: number; y: number };
        // 画布像素（y 向下）：Cocos 的 `pos.y` 向上 ⇒ 取负
        const cx = pCx + pos.x * pSx;
        const cy = pCy - pos.y * pSy;
        const sx = pSx * (sc.x ?? 1);
        const sy = pSy * (sc.y ?? 1);
        const vw = size.width * sx;
        const vh = size.height * sy;
        out.set(path, { node, left: cx - anchor.x * vw, top: cy - (1 - anchor.y) * vh, w: vw, h: vh });
        for (const child of ((node._children ?? []) as unknown[])) {
            const c = at(child);
            if (c) walk(c, `${path}/${c._name}`, cx, cy, sx, sy);
        }
    };
    walk(rootNode, 'LeagueHall', 360, 640, 1, 1);
    return out;
}
const rects = solveCanvasRects();

test('C1 根节点 = 第一个 cc.Node、无父、且 `.meta` 在（否则不会被导入）', () => {
    assert.ok(existsSync(HALL_PREFAB), `prefab 不存在：${HALL_PREFAB}`);
    assert.ok(existsSync(`${HALL_PREFAB}.meta`), '缺 LeagueHall.prefab.meta');
    const data = (prefab[0] as { data: { __id__: number } }).data;
    assert.equal(data.__id__, prefab.findIndex((e) => e && e.__type__ === 'cc.Node'));
    assert.equal(rootNode._name, 'LeagueHall');
    assert.equal(rootNode._parent, null, '根节点没有父节点');
});

test('C2 节点总数 = 101 + 根（重跑生成器若忘了先删旧产物，这里会翻倍）', () => {
    // ⚠️ `prefab_prefab_lifecycle create` 是「追加」语义：重复跑会让整棵树翻倍。
    // 101 = 母面板外壳 56（P2 第一刀）+ 三页签内容 / 三个行模板 / 操作浮层 45（P2 第三刀）。
    // ⚠️ EditBox 在编辑器里会给自己建 `PLACEHOLDER_LABEL` / `TEXT_LABEL` 两个默认子节点，
    //    构建脚本必须删掉它们，否则这里会变成 103（多出来的那个 `PLACEHOLDER_LABEL` 还会渲染出「label」脏字）。
    assert.equal(nodes.length, 102, `节点数应为 102（101 + 根），实得 ${nodes.length}`);
});

test('C3 ⚠️ 所有节点 `_layer` 都是 UI_2D（落 DEFAULT 会让整棵子树不渲染且不报错）', () => {
    const layers = new Set(nodes.map((n) => n._layer));
    assert.deepEqual([...layers], [UI_2D], `出现非 UI_2D 的 layer：${[...layers].join(', ')}`);
});

test('C4 顶层渲染序 = FGUI `displayList` 序（底板必须排在一堆小图之前）', () => {
    const order = ((rootNode._children ?? []) as unknown[]).map((c) => at(c)!._name);
    assert.deepEqual(order, HALL_ORDER);
    // 具体守点：整屏背景最底、底部栏在页签按钮之前、三个页签容器在最后
    assert.equal(order[0], 'Bg');
    assert.ok(order.indexOf('BottomBg') < order.indexOf('BtnBack'));
    assert.ok(order.indexOf('BtnDetail') < order.indexOf('TabDetail'));
});

test('C5 每个自定义组件的 cid 都能从对应 `.ts.meta` 反解（抄错会变成 MissingScript）', () => {
    const KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const cidOf = (metaPath: string): string => {
        const uuid = (JSON.parse(readFileSync(metaPath, 'utf8')) as { uuid: string }).uuid;
        const hex = uuid.replace(/-/g, '');
        let cid = hex.slice(0, 5);
        for (let i = 5; i < 32; i += 3) {
            const v = parseInt(hex.slice(i, i + 3), 16);
            cid += KEYS[v >> 6] + KEYS[v & 63];
        }
        return cid;
    };
    const cids = [...new Set(prefab.map((e) => e?.__type__).filter((t) => t && !String(t).startsWith('cc.')))].map(String);
    // P2 第三刀之后这张 prefab 里有 6 个自定义脚本：
    //   主力 `LeagueHallPage` + 3 张列表（同一个 `VirtualScrollView`）+ 3 个行 / 浮层脚本
    assert.equal(cids.length, 6, `实得 ${cids.length} 个自定义 cid：${cids.join(',')}`);
    const known = new Map<string, string>();
    for (const rel of [
        'app/league/LeagueHallPage', 'app/league/LeagueMemberRow', 'app/league/LeagueLogRow',
        'app/league/LeagueUnionRow', 'app/league/LeagueOpsBar', 'vscrollview/VScrollView',
    ]) {
        known.set(cidOf(`assets/script/${rel}.ts.meta`), rel);
    }
    for (const cid of cids) {
        assert.ok(known.has(cid), `cid ${cid} 反解不到任何 .ts.meta（抄错 / 漏 meta ⇒ MissingScript）`);
        assert.equal(cid.length, 23, `cid 应为 23 字符，实得 ${cid.length}`);
    }
    // 主力脚本必须挂在根节点上
    const comp = prefab.find((e) => e?.__type__ === cidOf(`${HALL_PAGE_TS}.meta`));
    assert.ok(comp, '根节点上必须挂着 LeagueHallPage');
    const compNode = comp!.node as { __id__?: number } | undefined;
    assert.equal(compNode?.__id__, prefab.indexOf(rootNode), '脚本必须挂在根节点上');
});

test('C6 28 个 @property 全部绑到正确的宿主节点', () => {
    const KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const uuid = (JSON.parse(readFileSync(`${HALL_PAGE_TS}.meta`, 'utf8')) as { uuid: string }).uuid;
    const hex = uuid.replace(/-/g, '');
    let cid = hex.slice(0, 5);
    for (let i = 5; i < 32; i += 3) {
        const v = parseInt(hex.slice(i, i + 3), 16);
        cid += KEYS[v >> 6] + KEYS[v & 63];
    }
    const comp = prefab.find((e) => e?.__type__ === cid)!;
    const pathOf = new Map<number, string>();
    for (const [p, v] of rects) pathOf.set(prefab.indexOf(v.node), p);

    const BIND: Record<string, string> = {
        banner: 'LeagueHall/Banner',
        bannerColor: 'LeagueHall/Banner/ColorIcon',
        bannerFrame: 'LeagueHall/Banner/Frame',
        nameLabel: 'LeagueHall/LabName',
        levelLabel: 'LeagueHall/LabLv',
        noticeLabel: 'LeagueHall/LabNotice',
        idLabel: 'LeagueHall/LabId',
        wxLabel: 'LeagueHall/LabWx',
        progressFill: 'LeagueHall/Progress/ProgressFill',
        progressLabel: 'LeagueHall/Progress/ProgressLabel',
        backButton: 'LeagueHall/BtnBack',
        mgrButton: 'LeagueHall/BtnMgr',
        helpButton: 'LeagueHall/BtnHelp',
        copyIdButton: 'LeagueHall/BtnCopyId',
        copyWxButton: 'LeagueHall/BtnCopyWx',
        searchButton: 'LeagueHall/TabAllServer/Search/BtnSearch',
        tabDetailButton: 'LeagueHall/BtnDetail',
        tabLogButton: 'LeagueHall/BtnLog',
        tabAllServerButton: 'LeagueHall/BtnAllServer',
        tabDetailPage: 'LeagueHall/TabDetail',
        tabLogPage: 'LeagueHall/TabLog',
        tabAllServerPage: 'LeagueHall/TabAllServer',
        // ---- P2 第三刀 ----
        memberCountLabel: 'LeagueHall/TabDetail/LabUserCount',
        memberList: 'LeagueHall/TabDetail/DetailList',
        logList: 'LeagueHall/TabLog/LogList',
        serverList: 'LeagueHall/TabAllServer/ServerList',
        searchInput: 'LeagueHall/TabAllServer/Search/Input',
        opsBar: 'LeagueHall/TabDetail/OpsBar',
    };
    const keys = Object.keys(BIND);
    assert.equal(keys.length, 28, '本版 28 个 @property（母面板 22 + 三页签 6）');
    for (const [prop, wantPath] of Object.entries(BIND)) {
        const ref = comp[prop] as unknown;
        assert.ok(ref, `@property ${prop} 没绑（漏绑不报错，只是运行时 null）`);
        const target = at(ref)!;
        const hostIdx = target.__type__ === 'cc.Node' ? prefab.indexOf(target) : (target.node as { __id__: number }).__id__;
        assert.equal(pathOf.get(hostIdx), wantPath, `@property ${prop} 绑错`);
    }
});

test('C6b ⚠️ prefab 里每个 `cc.Button` 都必须被某个 `@property` 覆盖（否则就是「点了没反应」的死按钮）', () => {
    // 这条是踩坑后补的：`TabAllServer/Search/BtnSearch` 有过 `cc.Button` 但页面类没接 ⇒
    // 不报错、静态检查也看不出、单测全绿，只有端到端探针查 `hasEventListener('click')` 才露。
    // ⚠️ 覆盖来源**不止主力脚本**：浮层那 5 个按钮是 `LeagueOpsBar` 的 `@property`（`showButton` …）。
    const pathOfIdx = new Map<number, string>();
    for (const [p, v] of rects) pathOfIdx.set(prefab.indexOf(v.node), p);
    const boundPaths = new Set<string>();
    for (const e of prefab) {
        if (!e || !e.__type__ || String(e.__type__).startsWith('cc.')) continue;
        for (const prop of Object.keys(e)) {
            const ref = e[prop] as unknown;
            if (!ref || typeof ref !== 'object') continue;
            const target = at(ref);
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
        const idx = prefab.indexOf(n);
        const p = pathOfIdx.get(idx);
        if (p) buttonPaths.push(p);
    }
    // 9（母面板：返回 / 管理 / 帮助 / 复制×2 / 页签×3 / 查询）+ 5（操作浮层）
    assert.equal(buttonPaths.length, 14, `prefab 里有 14 个按钮节点，实得 ${buttonPaths.length}`);
    const dead = buttonPaths.filter((p) => !boundPaths.has(p));
    assert.deepEqual(dead, [], `这些按钮没被任何 @property 接上（点了没反应）：${dead.join(', ')}`);
});

test('C7 Sprite 口径：sizeMode=CUSTOM(0)，type 与九宫格集合一致', () => {
    // ⚠️ 到了三页签这一刀，**按节点名**判九宫格已经不成立（`Bg` 在旗帜 / 管理按钮 / 浮层里各有一个，
    //    只有浮层那个是 `frame_Zhikuang01`）⇒ 改成**按图（spriteFrame uuid）**判。
    const SLICED = new Set([
        '14a8777f-e00e-4a00-891d-ad4e25dc5a44@f9941', // frame_Zhikuang02
        'f0544e68-71d4-4058-925a-5d0e73c74785@f9941', // frame_Dikuang03
        '672a6233-305e-4ebf-bcb1-b3c0a2d150fb@f9941', // lm_pic07
        '248a214e-5fb8-4dbd-bf45-9bd6ce46f606@f9941', // frame_shurukuang
        '9f8dde9a-b493-4c50-bf04-a6d220683183@f9941', // diban_BG
        '443fa078-9ba5-42c8-a2bc-77e75125a70f@f9941', // bar_bg_01
        'dac21f1f-62e9-4f7c-98c9-8125b51c0f49@f9941', // frame_Zhikuang01
        '0f92b28c-0dc5-49fe-b839-8fe1bdd20a37@f9941', // TY_btn07
    ]);
    const sprites: { name: string; sp: Entry }[] = [];
    for (const n of nodes) {
        const sp = ((n._components ?? []) as unknown[]).map(at).find((c) => c?.__type__ === 'cc.Sprite');
        if (sp) sprites.push({ name: n._name as string, sp: sp! });
    }
    // 47（规格表里的 sprite / spriteButton）+ 头像 `Avatar` + `EditBox` 在编辑器里自带的背景 Sprite
    assert.equal(sprites.length, 49, `实得 ${sprites.length} 个 Sprite`);
    for (const { name, sp } of sprites) {
        const frame = (sp._spriteFrame ?? null) as { __uuid__?: string } | null;
        if (!frame?.__uuid__) {
            // 允许「挂了 Sprite 但没帧」的只有两个：
            //   `Avatar` —— 头像由 `LeagueMemberRow.applyAvatar` 按 `img` 取图后贴（**会**赋帧 ⇒ 下面照样查 sizeMode）；
            //   `Input`  —— `cc.EditBox` 在编辑器里自带的背景 Sprite（口径同 `ui/Friend/Friend.prefab`），
            //              本工程用独立的 `InputBg` 节点当底，这个背景**永不赋帧** ⇒ `sizeMode` 是死字段，不查。
            assert.ok(name === 'Avatar' || name === 'Input', `只有 Avatar / Input 允许没帧，实得 ${name}`);
            if (name === 'Input') continue;
        }
        assert.equal(sp._sizeMode, 0, `${name} 的 sizeMode 应为 CUSTOM(0)，否则 contentSize 会被底图回写`);
        if (!frame?.__uuid__) continue;
        assert.equal(sp._type, SLICED.has(frame.__uuid__) ? 1 : 0, `${name}(${frame.__uuid__}) 的 type 与九宫格口径不符`);
    }
});

test('C8 Label 口径：30 个、overflow ∈ {NONE,SHRINK}、wrap=false、名字齐', () => {
    const labels: { name: string; lb: Entry }[] = [];
    for (const n of nodes) {
        const lb = ((n._components ?? []) as unknown[]).map(at).find((c) => c?.__type__ === 'cc.Label');
        if (lb) labels.push({ name: n._name as string, lb: lb! });
    }
    // 11（母面板）+ 19（成员行 7 / 浮层 5 / 动态行 2 / 全服行 4 / 查询框 2）
    assert.equal(labels.length, 30, `实得 ${labels.length} 个 Label`);
    for (const { name, lb } of labels) {
        assert.ok(lb._overflow === 0 || lb._overflow === 2, `${name} 的 overflow=${lb._overflow}，应为 NONE(0) 或 SHRINK(2)`);
        assert.equal(lb._enableWrapText, false, `${name} 必须关掉自动换行（否则宽度被行宽回写）`);
    }
    const names = labels.map((x) => x.name);
    for (const must of [
        'LabName', 'LabLv', 'LabNotice', 'LabId', 'LabWx', 'ProgressLabel', 'Label',
        'LabUserCount', 'LabLastLogin', 'LabContribution',
        // 查询框：FGUI `lab_input` 拆成「占位 / 正文」两个（EditBox 的两个槽）
        'Placeholder', 'Text',
    ]) {
        assert.ok(names.includes(must), `缺 Label：${must}`);
    }
    // ⚠️ 3.8 的 `cc.LabelOutline` 是废弃空壳，描边必须走 Label 内建
    assert.equal(prefab.filter((e) => e?.__type__ === 'cc.LabelOutline').length, 0, '不应有 cc.LabelOutline');
    // ⚠️ 给节点新加 `cc.EditBox` 时组件会顺手建 `PLACEHOLDER_LABEL` / `TEXT_LABEL`，构建脚本必须删掉
    assert.ok(!names.includes('PLACEHOLDER_LABEL') && !names.includes('TEXT_LABEL'),
        'EditBox 自带的 PLACEHOLDER_LABEL / TEXT_LABEL 必须已删除（前者 _active=true 且文本是「label」）');
});

test('C9 默认显隐：TabDetail 显示，另两个隐藏；详情页签默认「选中」态', () => {
    // 三个内容容器
    assert.equal(rects.get('LeagueHall/TabDetail')!.node._active, true, '详情容器默认显示');
    assert.equal(rects.get('LeagueHall/TabLog')!.node._active, false, '动态容器默认隐藏');
    assert.equal(rects.get('LeagueHall/TabAllServer')!.node._active, false, '全服容器默认隐藏');
    // 页签按钮内部的四个状态子节点（selected ⇒ BgDown/IconDown 亮，up 灭）
    const state = (parent: string) => {
        const p = nodes.find((n) => n._name === parent)!;
        const kids = ((p._children ?? []) as unknown[]).map(at);
        const on = (nm: string) => kids.find((c) => c!._name === nm)!._active as boolean;
        return { up: on('BgUp'), down: on('BgDown'), iconUp: on('IconUp'), iconDown: on('IconDown') };
    };
    assert.deepEqual(state('BtnDetail'), { up: false, down: true, iconUp: false, iconDown: true }, '详情页签 = 选中态');
    assert.deepEqual(state('BtnLog'), { up: true, down: false, iconUp: true, iconDown: false }, '动态页签 = 未选中态');
    assert.deepEqual(state('BtnAllServer'), { up: true, down: false, iconUp: true, iconDown: false }, '全服页签 = 未选中态');
});

// ============================================================
// C11 ⚠️ 每一张引用的图都必须**真的解析得到 `@f9941` 帧子资源**
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

test('C11 ⚠️ prefab 里 31 个 spriteFrame 引用全部能解析到「sprite-frame」子资源（悬空 ⇒ 运行时品红块）', () => {
    // 踩坑记录：6 张公用图被导成 `userData.type="texture"` ⇒ 只有 `@6c48a` 纹理、没有 `@f9941` 帧，
    // prefab 里的 `"<顶层uuid>@f9941"` 就是**悬空引用**。它**不报错、`sprite.spriteFrame` 也不是 null**，
    // 只有画面上是品红块 ⇒ 必须在静态阶段核「引用能否解析」，这是唯一能提前逮住它的检查。
    const metas = new Map<string, { file: string; type: string; hasFrame: boolean }>();
    indexImageMetas('assets/resources', metas);

    const raw = readFileSync(HALL_PREFAB, 'utf8');
    const refs = [...new Set([...raw.matchAll(/"([0-9a-f-]{36}@f9941)"/g)].map((m) => m[1]))];
    // 25（母面板）→ 31（三页签 / 行模板 / 浮层新增 6 张：frame_Zhikuang01 / img_Touxiang_01 / lm_pic04 /
    //   zx_zl_pic01 / lt_pic07 / TY_btn07）
    assert.equal(refs.length, 31, `prefab 里应有 31 个不同的 spriteFrame 引用，实得 ${refs.length}`);

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

// ============================================================
// C* 几何：FGUI 视觉框 → 画布像素
// ============================================================
/** [路径, 期望 left, top, 宽, 高]（FGUI `xy` + `size`×`scale`，容差 0.6px）。 */
const GEOMETRY: [string, number, number, number, number][] = [
    ['LeagueHall/Bg', 0, 0, 720, 1280],
    ['LeagueHall/Frame', 0, 0, 720, 502],
    ['LeagueHall/NoticeBg', 63, 357, 595, 91],
    ['LeagueHall/Banner', 96, 217, 107.4, 117.6],
    ['LeagueHall/Progress', 210, 243, 392, 36],
    ['LeagueHall/BtnHelp', 633, 179, 52, 54],
    ['LeagueHall/BtnCopyId', 645, 269, 28, 30],
    ['LeagueHall/BtnCopyWx', 645, 303, 28, 30],
    ['LeagueHall/BtnMgr', 105, 315, 79.5, 40],
    ['LeagueHall/LabLv', 465, 186, 131, 36],
    ['LeagueHall/LabNotice', 57, 370, 598, 64],
    ['LeagueHall/LabId', 215, 279, 155, 36],
    ['LeagueHall/LabWx', 213, 313, 351, 36],
    ['LeagueHall/BottomBg', 0, 1132, 720, 153],
    ['LeagueHall/BtnBack', 0, 1162, 132, 116],
    ['LeagueHall/BtnDetail', 358, 1161, 120, 120],
    ['LeagueHall/BtnLog', 478, 1161, 120, 120],
    ['LeagueHall/BtnAllServer', 598, 1161, 120, 120],
    ['LeagueHall/TabDetail', 0, 0, 720, 1280],
    ['LeagueHall/TabLog', 0, 0, 720, 1280],
    ['LeagueHall/TabAllServer', 0, 0, 720, 1280],
    // Banner（父 scale 0.6）
    ['LeagueHall/Banner/Frame', 88.8, 206.8, 121.8, 138],
    ['LeagueHall/Banner/Base', 99.6, 220.6, 100.2, 110.4],
    ['LeagueHall/Banner/ColorIcon', 125.4, 245.2, 49.2, 45],
    // Progress
    ['LeagueHall/Progress/ProgressBg', 210, 243, 392, 36],
    ['LeagueHall/Progress/ProgressFill', 214.5, 251, 383, 20],
    ['LeagueHall/Progress/ProgressLabel', 295.5, 246.5, 220, 28],
    // BtnMgr（父 scale 0.5）
    ['LeagueHall/BtnMgr/Bg', 105, 315, 79.5, 40],
    ['LeagueHall/BtnMgr/Label', 105, 313.5, 79.5, 40],
    // BtnBack
    ['LeagueHall/BtnBack/BackIcon', 8, 1162, 115, 119],
    // 页签底图 / 图标（父 scale 0.7）
    ['LeagueHall/BtnDetail/BgUp', 357, 1177, 117.6, 92.4],
    ['LeagueHall/BtnDetail/BgDown', 357, 1143, 117.6, 92.4],
    ['LeagueHall/BtnDetail/IconUp', 381, 1175, 72, 90],
    ['LeagueHall/BtnDetail/IconDown', 379, 1135, 80, 100],
    // TabDetail
    ['LeagueHall/TabDetail/DetailFrame', 0, 477, 720, 650],
    ['LeagueHall/TabDetail/DetailHdrBg', 37, 506, 642, 141],
    ['LeagueHall/TabDetail/LabUserCount', 94, 595, 208, 34],
    ['LeagueHall/TabDetail/LabLastLogin', 325, 595, 100, 34],
    ['LeagueHall/TabDetail/LabContribution', 463, 595, 160, 34],
    ['LeagueHall/TabDetail/DetailList', 32, 655, 660, 450],
    // TabLog
    ['LeagueHall/TabLog/LogList', 39, 542, 646, 585],
    // TabAllServer
    ['LeagueHall/TabAllServer/Search', 75, 455, 569, 111],
    ['LeagueHall/TabAllServer/ServerList', 30, 570, 660, 542],
    ['LeagueHall/TabAllServer/Search/SearchBg', 111, 424, 495, 141],
    ['LeagueHall/TabAllServer/Search/InputBg', 204, 503, 276, 47],
    ['LeagueHall/TabAllServer/Search/Input', 201, 507, 276, 39],
    ['LeagueHall/TabAllServer/Search/BtnSearch', 484, 498, 65, 55],
];

test('C10 ⚠️ 47 个节点的画布视觉框全部对上 FGUI（含缩放节点：BtnMgr×0.5 / Banner×0.6 / 页签底×0.7）', () => {
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

test('C10b ⚠️ `LabName` 是 auto-size Label（overflow=NONE）⇒ 只钉「中心」，不钉框', () => {
    // FGUI `league_name` 没写 `autoSize` ⇒ 默认 both（框跟文本走），原稿的 size=60,38 是失效值；
    // Cocos 侧 `overflow=NONE` 同理：contentSize 会随文案重算（占位 4 字 ⇒ 112×54.4）。
    // 不变量只剩「箱中心」，所以这里单独钉它，别把 FGUI 的 60×38 当契约。
    const g = rects.get('LeagueHall/LabName')!;
    const lb = ((g.node._components ?? []) as unknown[]).map(at).find((c) => c?.__type__ === 'cc.Label');
    assert.ok(lb, 'LabName 上没有 cc.Label');
    assert.equal(lb!._overflow, 0, 'LabName 应为 NONE(0) —— 与 FGUI 的 auto-size 对齐');
    assert.equal(lb!._enableWrapText, false);
    // LabName 直挂根 ⇒ left/top/w/h 就是画布像素；锚点 (0.5,0.5) ⇒ 箱中心 = 左/上 + 半宽/半高
    assert.ok(Math.abs(g.left + g.w / 2 - (208 + 60 / 2)) <= 0.6, `中心 x 应为 238，实得 ${(g.left + g.w / 2).toFixed(1)}`);
    assert.ok(Math.abs(g.top + g.h / 2 - (207 + 38 / 2)) <= 0.6, `中心 y 应为 226，实得 ${(g.top + g.h / 2).toFixed(1)}`);
});

// ============================================================
// D. 入口接线 + 页面逻辑（源码文本）
// ============================================================

test('D1 `BtnHall` 在入口表里已落（`landed: true`）', () => {
    const hall = leagueEntranceByNode('BtnHall');
    assert.ok(hall, '入口表里没有 BtnHall');
    assert.equal(hall!.landed, true, '联盟大厅已落地');
    assert.equal(hall!.key, 'LayerLeagueHall', 'key 必须对上老端 LayerLeagueHall');
});

test('D2 `LeaguePage.onEntranceClick` 按 key 分发到**所有**已落地面板（六条一条不落）', () => {
    const code = readFileSync('assets/script/app/league/LeaguePage.ts', 'utf8');
    // key → 页面类名。**与 `LeagueTable.LEAGUE_ENTRANCES` 的 landed 集合互为镜像**：
    // 下面拿 `landedLeagueEntrances()` 反查（而不是写死 4 条），少接一条就红 ——
    // 专防「把 landed 翻成 true、忘了加 `case`」这种半接线（运行时只会 `console.warn`，
    // 界面上表现为「点了弹『尚未开放』」，很难发现）。
    const PAGE_OF: Readonly<Record<string, string>> = {
        LayerLeagueHall: 'LeagueHallPage',
        LayerLeagueStore: 'LeagueStorePage',
        LayerLeagueDiscount: 'LeagueDiscountPage',
        LayerLeagueTask: 'LeagueTaskPage',
        LayerLeagueNorthernExpedition: 'LeagueNorthExpeditionPage',
        LayerLeagueDonate: 'LeagueDonatePage',
    };
    const landed = landedLeagueEntrances();
    assert.equal(landed.length, 6, 'P6 收口后六入口应全部落地');
    for (const entrance of landed) {
        const page = PAGE_OF[entrance.key];
        assert.ok(page, `${entrance.key} 没在 PAGE_OF 里登记页面类`);
        assert.ok(code.includes(`import { ${page} } from './${page}'`), `没 import ${page}`);
        assert.ok(code.includes(`void ${page}.open(`), `onEntranceClick 里没 open ${page}`);
        assert.ok(code.includes(`case '${entrance.key}':`), `分发里没有 ${entrance.key} 分支`);
    }
    // 反向：`PAGE_OF` 不许比入口表多（多出来的就是死分支，改了名也不会有人发现）
    assert.equal(Object.keys(PAGE_OF).length, LEAGUE_ENTRANCES.length, 'PAGE_OF 与入口表条数必须一致');
    // `landed: true` 却没有分支 ⇒ 明确报出来（而不是静默退回「未开放」把人绕晕）
    assert.ok(code.includes('default:'), 'switch 必须有 default 兜底');
    assert.ok(code.includes('FW.showTip(LEAGUE_TIP_NOT_OPEN)'), '未落地的子面板必须提示，不许静默');
});

test('D3 `prefabPath` 大小写与磁盘一致（真机 zip 内路径大小写敏感）', () => {
    const page = readFileSync(HALL_PAGE_TS, 'utf8');
    assert.ok(page.includes("static prefabPath = 'ui/League/LeagueHall'"), "prefabPath 必须是 'ui/League/LeagueHall'");
    assert.ok(page.includes('extends PopupBase'), '大厅是子弹窗 ⇒ 继承 PopupBase（不是 tab 页的 Component）');
    assert.ok(existsSync(`${HALL_PREFAB}`), '磁盘上要有 LeagueHall.prefab');
});

test('D4 页面逻辑守点：页签夹取 / 进度条满宽 / 按钮走 Button.CLICK', () => {
    const page = readFileSync(HALL_PAGE_TS, 'utf8');
    // 页签下标必须夹取（外部传裸数字不能把界面切崩）
    assert.ok(/selectTab\(index: number\)/.test(page), 'selectTab 签名应带 number');
    assert.ok(page.includes('Math.min(Math.max(Math.trunc(index), 0), LEAGUE_HALL_TABS.length - 1)'), 'selectTab 应按下标夹取');
    // 进度条满宽必须与 prefab 里 ProgressFill 的 contentSize.width 一致
    assert.ok(page.includes('PROGRESS_FULL_WIDTH = 383'), '进度条满宽常量应为 383（= prefab 里 ProgressFill 宽）');
    // 按钮点击优先走 cc.Button 的 CLICK（有 Button 却用 TOUCH_END 会与按下态缩放打架）
    assert.ok(page.includes('Button.EventType.CLICK'), '应优先用 Button.EventType.CLICK');
    // 返回键必须关面板
    assert.ok(page.includes('this.close()'), '返回键应 close()');
    // ⚠️ 全服联盟的查询按钮必须也接上（曾经漏绑 ⇒ 死按钮）
    assert.ok(page.includes('@property({ type: Node, tooltip: \'TabAllServer/Search/BtnSearch'), '缺 searchButton @property');
    assert.ok(/this\.onClick\(this\.searchButton,/.test(page), 'searchButton 没接点击 ⇒ 点了没反应');
    // 三页签容器 + 三页签按钮都来自 @property（不许 getChildByName 硬编码中文/序号）
    for (const prop of ['tabDetailPage', 'tabLogPage', 'tabAllServerPage']) {
        assert.ok(page.includes(prop), `缺 @property ${prop}`);
    }
});
