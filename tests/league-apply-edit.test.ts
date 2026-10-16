/**
 * 「联盟」P2 **第四刀**（申请列表 + 编辑信息）的回归网。
 *
 * 与 `league-hall.test.ts` / `league-hall-sub.test.ts` / `league-hall-tabs.test.ts`
 * 同一套五段口径：
 *
 *   A. **文案口径**（`LeagueTexts`）—— 申请列表 / 编辑信息两条新段，外加第四刀修掉的
 *      微信号**全角冒号**保真 bug。
 *   B. **美术口径**（`LeagueArt`）—— 真底板 `panel_window_01_9gong`、通用按钮 `TY_btn09/TY_btn10`
 *      （**退化九宫格 ⇒ 必须 SIMPLE**）、申请行专属的 `bb_pic13`、以及「图真的在磁盘上」。
 *   C. **数据口径**（`LeagueTable`）—— `buildLeagueApplyViews` / `canApproveAll`。
 *   D. **prefab 结构 + 几何**（`ui/League/LeagueApplyList.prefab`、`ui/League/LeagueEdit.prefab`，
 *      外加 `LeagueLevelPreview.prefab` 的底板 retrofit）—— 脚本 cid 反解、全 UI_2D、顶层序、
 *      全部视觉框（**逐条对 FGUI 原 XML**）、九宫格、`@f9941` 可解析、EditBox 接线。
 *   E. **页面逻辑 / 调用约定**（源码文本）—— 虚拟列表只绑一次、`nextPopupFrame` 时序、
 *      空列表不发包、防连点、`'***'` 当没填、竞态放弃。
 *
 * ## 口径真源
 *
 *   - 设计：`zarts/art/UIProject/trunk/UIProject/assets/主界面_联盟/大厅/组件_联盟_大厅_申请列表.xml`
 *     `…/大厅/组件_联盟_大厅_编辑信息.xml`、`…/组件/组件_联盟_联盟角色申请.xml`、
 *     `共用组件/组件/弹窗/组件_公共弹窗_新.xml`、`共用组件/组件/按钮/按钮_公共_通用.xml`、
 *     `公用0/package.xml`（图 id → 文件名反查）
 *   - 老端：`client/assets/script/app/game/ctrl/main/league/play/LayerLeagueHallApprove.ts`、
 *     `…/LayerLeagueEdit.ts`
 *   - 本项目：`assets/script/app/league/**`、`assets/resources/ui/League/*.prefab`
 *
 * ## ⚠️ 三条**刻意与 FGUI 原稿不同**（理由见各页面类文件头）
 *
 *   ① 「按钮内文案」的 y 一律落 **−1**（`fairygui.js` 的 `Top_Middle` 解算：对「目标 == 父节点」
 *      的分支 `pivot` 恒 0 ⇒ 中心恒为 `h/2 + 1`）。已收口的 `LeagueHall` 操作浮层用的是 **+9**，
 *      那是第 3 刀的偏差，本刀**不沿用**（见 D10b 的说明）。
 *   ② 输入框按**多行**落（FGUI 的 `input` 文本缺省 `singleLine` = 编辑器默认多行；同包内
 *      「显式写 `singleLine="true"` 的都是单行用途」这条规律可证）。
 *   ③ 违禁词校验**跳过**（老端走 `SDKMgr.checkMessage`，Demo3.8 无 SDK 层；同 `ChatTexts` 先例）。
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import {
    LEAGUE_ART_APPLY_ROW_AGREE_BTN,
    LEAGUE_ART_APPLY_ROW_BG,
    LEAGUE_ART_APPLY_ROW_HEAD_FRAME,
    LEAGUE_ART_APPLY_ROW_LEVEL_BADGE,
    LEAGUE_ART_APPLY_ROW_POWER_BAR,
    LEAGUE_ART_APPLY_ROW_POWER_DECO,
    LEAGUE_ART_APPLY_ROW_REJECT_BTN,
    LEAGUE_ART_BTN_CANCEL,
    LEAGUE_ART_BTN_OK,
    LEAGUE_ART_LEVEL_ROW_BG,
    LEAGUE_ART_MEMBER_HEAD_FRAME,
    LEAGUE_ART_MEMBER_LEVEL_BADGE,
    LEAGUE_ART_MEMBER_POWER_BAR,
    LEAGUE_ART_OPS_BTN,
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
    buildLeagueApplyViews,
    canApproveAll,
    normalizeLeagueApply,
    normalizeLeagueApplies,
    type ILeagueApplyRow,
} from '../assets/script/app/league/LeagueTable';
import {
    LEAGUE_APPLY_ALL_AGREE,
    LEAGUE_APPLY_ALL_REJECT,
    LEAGUE_APPLY_ROW_AGREE,
    LEAGUE_APPLY_ROW_REJECT,
    LEAGUE_APPLY_TITLE,
    LEAGUE_EDIT_CANCEL,
    LEAGUE_EDIT_REJECTED_PLACEHOLDER,
    LEAGUE_EDIT_SURE,
    LEAGUE_EDIT_TITLE,
    LEAGUE_HALL_WX_PREFIX,
} from '../assets/script/app/league/LeagueTexts';

// ============================================================
// A. 文案口径
// ============================================================

test('A1 申请列表：标题 / 两个批量按钮 = FGUI `Button title` 原稿', () => {
    assert.equal(LEAGUE_APPLY_TITLE, '申请管理');          // popBg 的 <Label title="申请管理"/>
    assert.equal(LEAGUE_APPLY_ALL_AGREE, '全部同意');       // btn_applyall title
    assert.equal(LEAGUE_APPLY_ALL_REJECT, '全部拒绝');      // btn_noapplyall title
    assert.equal(LEAGUE_APPLY_ROW_AGREE, '同意');           // btn_sure title
    assert.equal(LEAGUE_APPLY_ROW_REJECT, '拒绝');          // btn_kick title（⚠️ 名字叫 kick，文案是「拒绝」）
});

test('A2 编辑信息：标题 / 确定 / 取消 / `***` 占位串', () => {
    assert.equal(LEAGUE_EDIT_TITLE, '编辑信息');
    assert.equal(LEAGUE_EDIT_SURE, '确定');
    assert.equal(LEAGUE_EDIT_CANCEL, '取消');
    // 老端 `showSensitiveTip()` 会把输入框内容改成 "***"，`onBtnOk()` 里 `content == "***"` 当「没填」
    assert.equal(LEAGUE_EDIT_REJECTED_PLACEHOLDER, '***');
});

test('A3 ⚠️ 微信号前缀是**全角冒号**（U+FF1A）—— 第四刀修的保真 bug', () => {
    // 老端文案表 `mL.json` 的 `CONTACT_WAY = 微信号：`（全角），而 FGUI 设计稿与
    // 第 2~3 刀落地的常量写成了半角 `微信号:`（U+003A）⇒ 界面上与老端差一个字符宽度。
    assert.equal(LEAGUE_HALL_WX_PREFIX, '微信号：');
    assert.equal(LEAGUE_HALL_WX_PREFIX.length, 4, '「微信号」3 字 + 1 个冒号');
    assert.equal(LEAGUE_HALL_WX_PREFIX.codePointAt(3), 0xff1a, '第 4 个字符必须是全角冒号 U+FF1A');
    assert.notEqual(LEAGUE_HALL_WX_PREFIX.codePointAt(3), 0x3a, '不是半角冒号');
});

test('A4 ⚠️ 两个页面类里不出现文案字面量（一律从 LeagueTexts 取）', () => {
    const list = stripComments(readFileSync(APPLY_LIST_PAGE_TS, 'utf8'));
    for (const literal of ['申请管理', '全部同意', '全部拒绝', '拒绝', '同意']) {
        assert.ok(!list.includes(`'${literal}'`), `申请列表页面类里不要写死文案「${literal}」`);
    }
    assert.ok(list.includes('LEAGUE_APPLY_TITLE'), '标题应来自 LeagueTexts');

    const edit = stripComments(readFileSync(EDIT_PAGE_TS, 'utf8'));
    for (const literal of ['编辑信息', '确定', '取消']) {
        assert.ok(!edit.includes(`'${literal}'`), `编辑信息页面类里不要写死文案「${literal}」`);
    }
    assert.ok(edit.includes('LEAGUE_EDIT_REJECTED_PLACEHOLDER'), '`***` 应来自 LeagueTexts');
    // ⚠️ 行组件也**不写死**行内两按钮的文案（文案在 prefab 上，行组件不碰）
    const row = stripComments(readFileSync(APPLY_ROW_TS, 'utf8'));
    for (const literal of ['拒绝', '同意']) {
        assert.ok(!row.includes(`'${literal}'`), `行组件里不要写死文案「${literal}」`);
    }
});

// ============================================================
// B. 美术口径
// ============================================================

test('B1 真底板 `panel_window_01_9gong` 在 `image/league`（不是 image/common）', () => {
    // 前三刀用 `bg_04`/`bg_05` 顶替，那两张 `border` 全 0、只能等比拉伸；
    // 第四刀换成公用0 的九宫格真底板 —— 它是**按公用包 id 反查文件名后拷进本模块目录**的
    //（口径同 TY_btn17/18/19），所以落在 image/league，与标题条/闭钮不同目录。
    assert.equal(LEAGUE_ART_POPUP_BOARD, 'panel_window_01_9gong');
    assert.equal(LEAGUE_POPUP_BOARD_ROOT, 'image/league');
    assert.equal(LEAGUE_POPUP_ART_ROOT, 'image/common');
    assert.equal(LEAGUE_ART_POPUP_TITLE_BG, 'title_01');
    assert.equal(LEAGUE_ART_POPUP_TITLE_DECO, 'title_02');
    assert.equal(LEAGUE_ART_POPUP_CLOSE, 'btn_close');
    assert.ok(LEAGUE_ART_SLICED.has(LEAGUE_ART_POPUP_BOARD), '真底板必须九宫格渲染');
    assert.equal(leagueSpriteType(LEAGUE_ART_POPUP_BOARD), LEAGUE_SPRITE_SLICED);

    const meta = `${BOARD_DIR}/${LEAGUE_ART_POPUP_BOARD}.png.meta`;
    assert.ok(existsSync(meta), `缺底板：${meta}`);
    const border = borderOf(meta);
    assert.deepEqual(border, { left: 129, top: 128, right: 123, bottom: 36 }, 'FGUI scale9grid="129,128,123,36"');
    // 394×307 的图，四边切口必须小于边长（否则九宫格退化）
    assert.ok(border.left + border.right < 394 && border.top + border.bottom < 307, '切口不能退化');
});

test('B2 ⚠️ 通用按钮 `TY_btn10` / `TY_btn09` 按 SIMPLE 用（FGUI 的九宫格是退化的）', () => {
    // FGUI `package.xml`：TY_btn10 = `54,0,7,77`、TY_btn09 = `59,0,7,77`，而两张图都只有 **77 高**
    // ⇒ `top + bottom = 77 = 高`，垂直中缝为 0。带这种退化网格拉到 218×106 时，多出的 29px
    // 只能由「源图第 0 行」去撑 ⇒ 顶边那条深色描边被抻成 29px 的暗带（比等比拉伸丑得多）。
    assert.equal(LEAGUE_ART_BTN_OK, 'TY_btn10');
    assert.equal(LEAGUE_ART_BTN_CANCEL, 'TY_btn09');
    assert.ok(!LEAGUE_ART_SLICED.has(LEAGUE_ART_BTN_OK), 'TY_btn10 不能进 SLICED');
    assert.ok(!LEAGUE_ART_SLICED.has(LEAGUE_ART_BTN_CANCEL), 'TY_btn09 不能进 SLICED');
    assert.equal(leagueSpriteType(LEAGUE_ART_BTN_OK), LEAGUE_SPRITE_SIMPLE);
    assert.equal(leagueSpriteType(LEAGUE_ART_BTN_CANCEL), LEAGUE_SPRITE_SIMPLE);
});

test('B3 ⚠️ 申请行「拒绝」用的是 `TY_btn07`，**不是** `TY_btn09`（别按弹窗那套套）', () => {
    // FGUI `组件_联盟_联盟角色申请.xml`：btn_kick icon=`…n44q1yxnaki`（`package.xml` → TY_btn07）、
    // btn_sure icon=`…hknq1yxnakl`（→ TY_btn10）。
    // 即「拒绝」用的是**中性**底图（与角色操作浮层同图），只有「同意」是亮色底。
    assert.equal(LEAGUE_ART_APPLY_ROW_REJECT_BTN, LEAGUE_ART_OPS_BTN);
    assert.equal(LEAGUE_ART_APPLY_ROW_REJECT_BTN, 'TY_btn07');
    assert.equal(LEAGUE_ART_APPLY_ROW_AGREE_BTN, LEAGUE_ART_BTN_OK);
    assert.equal(LEAGUE_ART_APPLY_ROW_AGREE_BTN, 'TY_btn10');
    assert.notEqual(LEAGUE_ART_APPLY_ROW_REJECT_BTN, LEAGUE_ART_BTN_CANCEL, '拒绝不是 TY_btn09');
    assert.ok(LEAGUE_ART_SLICED.has(LEAGUE_ART_APPLY_ROW_REJECT_BTN), 'TY_btn07 是九宫格（15,11,4,9）');
});

test('B4 申请行与详情行的**同图 / 异图**关系', () => {
    // 同图（FGUI 三处 n6 都引 frame_Zhikuang01）
    assert.equal(LEAGUE_ART_APPLY_ROW_BG, LEAGUE_ART_LEVEL_ROW_BG);
    assert.equal(LEAGUE_ART_APPLY_ROW_HEAD_FRAME, LEAGUE_ART_MEMBER_HEAD_FRAME);
    assert.equal(LEAGUE_ART_APPLY_ROW_LEVEL_BADGE, LEAGUE_ART_MEMBER_LEVEL_BADGE);
    assert.equal(LEAGUE_ART_APPLY_ROW_POWER_BAR, LEAGUE_ART_MEMBER_POWER_BAR);
    // ⚠️ 异图：`bb_pic13`（战力条左端小徽记 n12）**只有申请行有**，详情行没有这个节点
    assert.equal(LEAGUE_ART_APPLY_ROW_POWER_DECO, 'bb_pic13');
});

test('B5 申请行 6 张图 + 通用按钮 2 张都必须真的在磁盘上（拷漏不报错，只是渲染空白）', () => {
    const leagueDir = 'assets/resources/image/league';
    for (const name of [
        LEAGUE_ART_APPLY_ROW_BG, LEAGUE_ART_APPLY_ROW_POWER_DECO, LEAGUE_ART_APPLY_ROW_HEAD_FRAME,
        LEAGUE_ART_APPLY_ROW_LEVEL_BADGE, LEAGUE_ART_APPLY_ROW_POWER_BAR,
        LEAGUE_ART_APPLY_ROW_REJECT_BTN, LEAGUE_ART_BTN_OK, LEAGUE_ART_BTN_CANCEL,
    ]) {
        const p = `${leagueDir}/${name}.png`;
        assert.ok(existsSync(p), `缺图：${p}`);
        assert.ok(existsSync(`${p}.meta`), `缺 meta：${p}.meta`);
    }
    // 弹窗骨架三张在 image/common
    for (const name of [LEAGUE_ART_POPUP_TITLE_BG, LEAGUE_ART_POPUP_TITLE_DECO, LEAGUE_ART_POPUP_CLOSE]) {
        assert.ok(existsSync(`assets/resources/image/common/${name}.png`), `缺图：image/common/${name}.png`);
    }
});

// ============================================================
// C. 数据口径
// ============================================================

const row = (over: Partial<ILeagueApplyRow> = {}): ILeagueApplyRow => ({
    applyId: '1001', name: '太史明勋', img: '7', headFrame: '1', level: 67, power: '2138',
    serverId: 3, selectServerId: 9, ...over,
});

test('C1 `buildLeagueApplyViews` 字段映射 + **保持缓存原序**', () => {
    const rows = [row({ applyId: '1', name: 'A', level: 70, power: '900' }),
        row({ applyId: '2', name: 'B', level: 10, power: '300' }),
        row({ applyId: '3', name: 'C', level: 50, power: '600' })];
    const views = buildLeagueApplyViews(rows);
    assert.deepEqual(views.map((v) => v.applyId), ['1', '2', '3'], '⚠️ 不能像详情行那样重排');
    assert.deepEqual(views.map((v) => v.name), ['A', 'B', 'C']);
    assert.deepEqual(views.map((v) => v.levelText), ['70', '10', '50']);
    assert.deepEqual(views.map((v) => v.powerText), ['900', '300', '600']);
    assert.deepEqual(views.map((v) => v.img), ['7', '7', '7']);
    assert.equal(views[0]!.serverId, 3);
    assert.equal(views[0]!.selectServerId, 9);
});

test('C2 等级 / 战力都是**纯数字**，不带「级」「战力」后缀（FGUI 原稿如此）', () => {
    const [view] = buildLeagueApplyViews([row()]);
    assert.equal(view!.levelText, '67');
    assert.equal(view!.powerText, '2138');
    assert.ok(!view!.levelText.includes('级'));
    assert.ok(!view!.powerText.includes('战力'));
});

test('C3 `canApproveAll`：空列表 ⇒ false（老端两句守卫），非空 ⇒ true', () => {
    assert.equal(canApproveAll([]), false, '空列表不发包');
    assert.equal(canApproveAll([row()]), true);
    assert.equal(canApproveAll(buildLeagueApplyViews([])), false);
    assert.equal(canApproveAll(buildLeagueApplyViews([row()])), true);
});

test('C4 `normalizeLeagueApply`：`applyId` 空或 `0` 的脏行要丢', () => {
    assert.equal(normalizeLeagueApply(null), null);
    assert.equal(normalizeLeagueApply({ name: 'x' }), null, '没 applyId');
    assert.equal(normalizeLeagueApply({ applyId: '0', name: 'x' }), null, "applyId='0' 视为无效");
    const ok = normalizeLeagueApply({ applyId: '88', name: '甲', level: '12', power: '345' });
    assert.ok(ok);
    assert.equal(ok!.applyId, '88');
    assert.equal(ok!.level, 12, '数字字符串要转成 number');
    assert.equal(ok!.power, '345');
    assert.equal(ok!.img, '0', '缺 img 补 "0"');
    assert.equal(normalizeLeagueApplies([null, { applyId: '0' }, { applyId: '9' }]).length, 1);
});

// ============================================================
// D. prefab 结构 + 几何
// ============================================================

const APPLY_PREFAB = 'assets/resources/ui/League/LeagueApplyList.prefab';
const EDIT_PREFAB = 'assets/resources/ui/League/LeagueEdit.prefab';
const PREVIEW_PREFAB = 'assets/resources/ui/League/LeagueLevelPreview.prefab';
const APPLY_LIST_PAGE_TS = 'assets/script/app/league/LeagueApplyListPage.ts';
const EDIT_PAGE_TS = 'assets/script/app/league/LeagueEditPage.ts';
const APPLY_ROW_TS = 'assets/script/app/league/LeagueApplyRow.ts';
const BOARD_DIR = 'assets/resources/image/league';
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

const apply = openPrefab(APPLY_PREFAB);
const edit = openPrefab(EDIT_PREFAB);
const preview = openPrefab(PREVIEW_PREFAB);

// 图 uuid（与 `LeagueArt` 名一一对应；写死在这里，防止哪天改名了测试跟着「自动通过」）
const U = {
    board: 'a295d231-ef9a-4bea-9818-0e0d85794ef0@f9941',
    title01: 'de242388-9444-451f-adff-78fe5a73e20d@f9941',
    title02: 'a957fd35-0792-4a27-9de3-85a44274a5d0@f9941',
    close: 'ca6d0ca8-3ed8-4009-963d-d845eb296872@f9941',
    zhikuang: 'dac21f1f-62e9-4f7c-98c9-8125b51c0f49@f9941',
    touxiang: '2c523bf9-1352-4465-bb17-7d3532ff7d44@f9941',
    ltp07: '7ebe1bb0-5336-41f0-8112-c1e1d1e95052@f9941',
    zxzl: 'd5870433-ab9c-4ec0-bb47-7ced0e7d1733@f9941',
    bbp13: '066f0c45-16a8-4fae-8f0b-28aa89425e17@f9941',
    btn07: '0f92b28c-0dc5-49fe-b839-8fe1bdd20a37@f9941',
    btn10: 'c482418e-efac-46f8-9753-eebf8be436af@f9941',
    btn09: 'fd868d70-2397-4927-bc77-7ea533aee982@f9941',
    bg04: '5740b6f6-7c51-4d31-95d4-8f9ffa14f8ea@f9941',
};

test('D1 两张 prefab（连 `.meta`）+ 三个新脚本（连 `.ts.meta`）都在磁盘上', () => {
    for (const p of [APPLY_PREFAB, EDIT_PREFAB]) {
        assert.ok(existsSync(p), `缺 prefab：${p}`);
        assert.ok(existsSync(`${p}.meta`), `缺 meta：${p}.meta`);
    }
    for (const ts of [APPLY_LIST_PAGE_TS, EDIT_PAGE_TS, APPLY_ROW_TS]) {
        assert.ok(existsSync(ts), `缺脚本：${ts}`);
        assert.ok(existsSync(`${ts}.meta`), `缺 .ts.meta：${ts}.meta（编辑器不会给未 refresh 的新 .ts 生成）`);
    }
});

test('D2 节点数：申请列表 24 + 根、编辑信息 13 + 根（重跑生成器若忘了先清空，这里会翻倍）', () => {
    assert.equal(apply.rootName, 'LeagueApplyList');
    assert.equal(edit.rootName, 'LeagueEdit');
    assert.equal(apply.nodes.length, 25, `申请列表应为 25（24 + 根），实得 ${apply.nodes.length}`);
    assert.equal(edit.nodes.length, 14, `编辑信息应为 14（13 + 根），实得 ${edit.nodes.length}`);
});

test('D3 ⚠️ 所有节点 `_layer` 都是 UI_2D（落 DEFAULT 会让整棵子树不渲染且不报错）', () => {
    for (const [tag, ctx] of [['申请列表', apply], ['编辑信息', edit]] as const) {
        const bad = [...new Set(ctx.nodes.map((n) => n._layer))].filter((l) => l !== UI_2D);
        assert.deepEqual(bad, [], `${tag} 有非 UI_2D 的层：${bad.join(',')}`);
    }
});

test('D4 顶层渲染序：底板最底 → 标题骨架 → 内容 → 按钮', () => {
    const names = (ctx: ReturnType<typeof openPrefab>) =>
        ((ctx.root._children ?? []) as unknown[]).map((c) => String(ctx.at(c)!._name));
    assert.deepEqual(names(apply),
        ['PopupBg', 'TitleBg', 'TitleDeco', 'Title', 'CloseBtn', 'ApplyListView', 'BtnAllAgree', 'BtnAllReject']);
    assert.deepEqual(names(edit),
        ['PopupBg', 'TitleBg', 'TitleDeco', 'Title', 'CloseBtn', 'InputBg', 'Input', 'BtnSure', 'BtnCancel']);
    // 行内渲染序（FGUI displayList 顺序）：外框压头像、徽章垫等级、两个按钮最上
    const rowKids = ((apply.P('ApplyListView/content/ApplyRow')!.node._children ?? []) as unknown[])
        .map((c) => String(apply.at(c)!._name));
    assert.deepEqual(rowKids,
        ['Avatar', 'PowerBar', 'PowerDeco', 'HeadFrame', 'LevelBadge', 'Name', 'Level', 'Power', 'RejectBtn', 'AgreeBtn']);
});

test('D5 ⚠️ 三个脚本（申请页 / 编辑页 / 申请行）的 cid 都能从 `.ts.meta` 反解', () => {
    for (const [ctx, ts, tag] of [[apply, APPLY_LIST_PAGE_TS, 'LeagueApplyListPage'],
        [edit, EDIT_PAGE_TS, 'LeagueEditPage']] as const) {
        const cid = cidOf(ts);
        assert.ok(ctx.customCids.includes(cid), `${tag} 的 cid ${cid} 不在 prefab 里`);
        assert.ok(ctx.comp('', cid), `${tag} 没挂在根节点上`);
    }
    const rowCid = cidOf(APPLY_ROW_TS);
    assert.ok(apply.customCids.includes(rowCid), `LeagueApplyRow 的 cid ${rowCid} 不在 prefab 里`);
    assert.ok(apply.comp('ApplyListView/content/ApplyRow', rowCid), 'ApplyRow 没挂 LeagueApplyRow');
    // 虚拟列表：类名 != 文件名 ⇒ 只能按 @ccclass 名挂
    assert.ok(apply.comp('ApplyListView', '544earF5qRLB4JTuTnSr11+'), 'ApplyListView 没挂 VirtualScrollView');
});

test('D6 @property 绑定：申请页 4 + 行 6 / 编辑页 4（逐条对节点）', () => {
    const listCid = cidOf(APPLY_LIST_PAGE_TS);
    const listComp = apply.comp('', listCid)!;
    for (const [prop, want] of [
        ['closeButton', 'LeagueApplyList/CloseBtn'],
        ['allAgreeButton', 'LeagueApplyList/BtnAllAgree'],
        ['allRejectButton', 'LeagueApplyList/BtnAllReject'],
        ['applyList', 'LeagueApplyList/ApplyListView'],
    ] as const) {
        assert.equal(apply.refPath(listComp[prop]), want, `${prop} 应绑到 ${want}`);
    }
    const rowComp = apply.comp('ApplyListView/content/ApplyRow', cidOf(APPLY_ROW_TS))!;
    for (const [prop, want] of [
        ['nameLabel', 'LeagueApplyList/ApplyListView/content/ApplyRow/Name'],
        ['levelLabel', 'LeagueApplyList/ApplyListView/content/ApplyRow/Level'],
        ['powerLabel', 'LeagueApplyList/ApplyListView/content/ApplyRow/Power'],
        ['avatarSprite', 'LeagueApplyList/ApplyListView/content/ApplyRow/Avatar'],
        ['agreeButton', 'LeagueApplyList/ApplyListView/content/ApplyRow/AgreeBtn'],
        ['rejectButton', 'LeagueApplyList/ApplyListView/content/ApplyRow/RejectBtn'],
    ] as const) {
        assert.equal(apply.refPath(rowComp[prop]), want, `${prop} 应绑到 ${want}`);
    }
    const editComp = edit.comp('', cidOf(EDIT_PAGE_TS))!;
    for (const [prop, want] of [
        ['closeButton', 'LeagueEdit/CloseBtn'],
        ['sureButton', 'LeagueEdit/BtnSure'],
        ['cancelButton', 'LeagueEdit/BtnCancel'],
        ['inputField', 'LeagueEdit/Input'],
    ] as const) {
        assert.equal(edit.refPath(editComp[prop]), want, `${prop} 应绑到 ${want}`);
    }
});

test('D7 ⚠️ 虚拟列表的 `content` / `itemNode` 必须指向列表内部（漏了列表恒空且不报错）', () => {
    const vs = apply.comp('ApplyListView', '544earF5qRLB4JTuTnSr11+')!;
    assert.equal(apply.at(vs.content)!._name, 'content');
    assert.equal(apply.at(vs.itemNode)!._name, 'ApplyRow');
    assert.equal(vs.itemCreationMode, 0, '0 = NODE（默认 1 = PREFAB 时拿不到 itemNode）');
    assert.equal(vs.useVirtualList, true);
    assert.equal(vs.direction, 0, '纵向');
    assert.ok(near(vs.spacing as number, 0), 'FGUI requestList 没有 lineGap ⇒ 间距 0');
    assert.ok(near(vs.gridCount as number, 1));
});

test('D8 ⚠️ prefab 里每个 `cc.Button` 都必须被某个 `@property` 覆盖（否则就是死按钮）', () => {
    const reachable = (ctx: ReturnType<typeof openPrefab>, comps: Entry[]): Set<string> => {
        const out = new Set<string>();
        for (const comp of comps) {
            for (const v of Object.values(comp)) {
                const rp = ctx.refPath(v);
                if (rp) out.add(rp);
            }
        }
        return out;
    };
    const listComp = apply.comp('', cidOf(APPLY_LIST_PAGE_TS))!;
    const rowComp = apply.comp('ApplyListView/content/ApplyRow', cidOf(APPLY_ROW_TS))!;
    const covered = reachable(apply, [listComp, rowComp]);
    const buttons = [...apply.byPath.entries()]
        .filter(([, r]) => ((r.node._components ?? []) as unknown[]).map(apply.at).some((c) => c?.__type__ === 'cc.Button'))
        .map(([p]) => p);
    assert.equal(buttons.length, 5, `申请列表应有 5 个 cc.Button，实得 ${buttons.length}`);
    for (const b of buttons) assert.ok(covered.has(b), `按钮 ${b} 没有被任何 @property 引用（死按钮）`);
    // 编辑信息：3 个按钮
    const editComp = edit.comp('', cidOf(EDIT_PAGE_TS))!;
    const coveredEdit = new Set(Object.values(editComp).map((v) => edit.refPath(v)).filter(Boolean) as string[]);
    const buttonsEdit = [...edit.byPath.entries()]
        .filter(([, r]) => ((r.node._components ?? []) as unknown[]).map(edit.at).some((c) => c?.__type__ === 'cc.Button'))
        .map(([p]) => p);
    assert.equal(buttonsEdit.length, 3, `编辑信息应有 3 个 cc.Button，实得 ${buttonsEdit.length}`);
    for (const b of buttonsEdit) assert.ok(coveredEdit.has(b), `按钮 ${b} 没有被任何 @property 引用（死按钮）`);
});

test('D9 Sprite 口径：`_sizeMode` 全 CUSTOM、`_type` 与九宫格集合一致、头像无帧', () => {
    const slicedUuids = new Set([U.board, U.zhikuang, U.btn07]);
    for (const [tag, ctx] of [['申请列表', apply], ['编辑信息', edit]] as const) {
        for (const [path, r] of ctx.byPath) {
            const sp = ((r.node._components ?? []) as unknown[]).map(ctx.at).find((c) => c?.__type__ === 'cc.Sprite');
            if (!sp || sp._spriteFrame == null) continue;
            assert.equal(sp._sizeMode, 0, `${tag} ${path} 的 sizeMode 应为 CUSTOM(0)`);
            const uuid = uuidOf(sp)!;
            assert.equal(sp._type === 1, slicedUuids.has(uuid), `${tag} ${path} 的九宫格口径与图不符（uuid=${uuid}）`);
        }
    }
    // 头像：运行时赋帧 ⇒ 无帧 + CUSTOM
    const avatar = apply.comp('ApplyListView/content/ApplyRow/Avatar', 'cc.Sprite')!;
    assert.equal(avatar._spriteFrame, null);
    assert.equal(avatar._sizeMode, 0);
});

test('D10 Label 口径：数量 + 样式逐项对 FGUI', () => {
    const countLabels = (ctx: ReturnType<typeof openPrefab>) =>
        ctx.nodes.reduce((a, n) => a + ((n._components ?? []) as unknown[]).map(ctx.at).filter((c) => c?.__type__ === 'cc.Label').length, 0);
    assert.equal(countLabels(apply), 8, '申请列表 8 个 Label');
    assert.equal(countLabels(edit), 5, '编辑信息 5 个 Label');

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
            assert.equal(lb!._enableWrapText, false, `${tag} ${path} 默认不换行（输入框除外）`);
        }
    };
    check(apply, '申请列表', {
        Title: ['申请管理', 30, [255, 246, 196], true, 1, 1],
        'ApplyListView/content/ApplyRow/Name': ['太史明勋', 26, [58, 30, 8], false, 0, 0],
        'ApplyListView/content/ApplyRow/Level': ['67', 24, [252, 240, 214], true, 1, 0],
        'ApplyListView/content/ApplyRow/Power': ['2138', 22, [252, 240, 214], true, 0, 0],
        'ApplyListView/content/ApplyRow/RejectBtn/Label': ['拒绝', 28, [252, 240, 214], true, 1, 1],
        'ApplyListView/content/ApplyRow/AgreeBtn/Label': ['同意', 28, [252, 240, 214], true, 1, 1],
        'BtnAllAgree/Label': ['全部同意', 30, [252, 240, 214], true, 1, 1],
        'BtnAllReject/Label': ['全部拒绝', 30, [252, 240, 214], true, 1, 1],
    });
    check(edit, '编辑信息', {
        Title: ['编辑信息', 30, [255, 246, 196], true, 1, 1],
        'BtnSure/Label': ['确定', 30, [252, 240, 214], true, 1, 1],
        'BtnCancel/Label': ['取消', 30, [252, 240, 214], true, 1, 1],
    });
    // 输入框的两个 label：默认黑、左 + 顶、**开换行**（多行输入）
    for (const path of ['Input/Text', 'Input/Placeholder']) {
        const lb = edit.comp(path, 'cc.Label')!;
        assert.equal(lb._string, '', `${path} 初值空（FGUI text=""）`);
        assert.equal(lb._fontSize, 20);
        assert.deepEqual([(lb._color as { r: number }).r, (lb._color as { g: number }).g, (lb._color as { b: number }).b], [0, 0, 0]);
        assert.equal(lb._enableWrapText, true, `${path} 必须开换行（公告 / 宣言是多行）`);
    }
});

test('D10b ⚠️ 通用按钮内文案的 y 一律 = −1（`Top_Middle` 解算；**不沿用**第 3 刀的 +9）', () => {
    // `按钮_公共_通用` 的 title 是 `xy="0,-7" pivot .5,.5`（**无 anchor** ⇒ xy 是左上角），盒高 66
    // ⇒ 设计中心 = 26（相对按钮顶边）。关系 `Top_Middle` 在 `applyOnSizeChanged` 里走
    // 「目标 == 父节点」分支 ⇒ `pivot` 恒 0 ⇒ `owner.y += (h − 50) * 0.5`，中心恒为 `h/2 + 1`
    // ⇒ FGUI 相对按钮中心 +1（y 向下）⇒ cocos −1，与按钮高度无关。
    for (const [ctx, tag, paths] of [
        [apply, '申请列表', ['ApplyListView/content/ApplyRow/RejectBtn/Label',
            'ApplyListView/content/ApplyRow/AgreeBtn/Label', 'BtnAllAgree/Label', 'BtnAllReject/Label']],
        [edit, '编辑信息', ['BtnSure/Label', 'BtnCancel/Label']],
    ] as const) {
        for (const p of paths) {
            assert.ok(near(lpos(ctx.P(p)!.node).y, -1), `${tag} ${p} 的 y 应为 −1`);
        }
    }
    // 对照：已收口的母面板操作浮层是第 3 刀的 +9，本刀**不沿用**（记录差异，便于将来统一）
    const hall = JSON.parse(readFileSync('assets/resources/ui/League/LeagueHall.prefab', 'utf8')) as Entry[];
    const hallAt = (r: unknown) => (r && typeof r === 'object' && '__id__' in (r as Entry) ? hall[(r as { __id__: number }).__id__]! : null);
    const hallLabels = hall.filter((e) => e?.__type__ === 'cc.Node' && e._name === 'Label')
        .map((n) => ((n._lpos ?? {}) as { y?: number }).y);
    assert.ok(hallLabels.includes(9), '母面板操作浮层的 +9 仍在（第 3 刀的已知偏差，本刀不改它）');
});

test('D11 ⚠️ 两张 prefab 的全部视觉框逐条对 FGUI 原 XML', () => {
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
    // FGUI `组件_联盟_大厅_申请列表.xml`
    rects(apply, {
        PopupBg: [40, 287, 640, 706],                 // popBg (40,287) 640×706
        ApplyListView: [90, 349, 540, 446],           // requestList (90,349) 540×446
        'ApplyListView/content': [90, 349, 540, 446],
        'ApplyListView/content/ApplyRow': [90, 349, 540, 128],   // 首行：底框 540×128、lineGap=0
        BtnAllAgree: [386, 810, 218, 106],            // btn_applyall
        BtnAllReject: [113, 810, 218, 106],           // btn_noapplyall
        // 行内（行盒 (0,3)-(540,131)）
        'ApplyListView/content/ApplyRow/Avatar': [119, 365, 84, 84],          // n9  (29,19) 84×84
        'ApplyListView/content/ApplyRow/PowerBar': [236, 418, 113, 27],       // n11 (146,72)
        'ApplyListView/content/ApplyRow/PowerDeco': [230.4, 418.3, 27.2, 26.4], // n12 (137,69) 34×33 scale .8
        'ApplyListView/content/ApplyRow/HeadFrame': [109, 357, 73, 73],       // n8  (19,11)
        'ApplyListView/content/ApplyRow/LevelBadge': [95, 350, 48, 47],       // n10 (5,4)
        'ApplyListView/content/ApplyRow/Name': [224, 378, 203, 36],           // n1  (134,32)
        'ApplyListView/content/ApplyRow/Level': [105, 357, 31, 34],           // n2  (15,11)
        'ApplyListView/content/ApplyRow/Power': [257, 414, 89, 32],           // n13 (167,68)
        'ApplyListView/content/ApplyRow/RejectBtn': [402, 390, 112, 56],      // n16 (298,37) 140×70 scale .8
        'ApplyListView/content/ApplyRow/AgreeBtn': [517, 390, 112, 56],       // n17 (413,37)
    }, '申请列表');
    // FGUI `组件_联盟_大厅_编辑信息.xml`
    rects(edit, {
        PopupBg: [40, 421, 640, 437],       // popBg (40,421)
        InputBg: [80, 487, 560, 158],       // n28 frame_Zhikuang01
        Input: [101, 500, 517, 119],        // lab_input
        BtnSure: [386, 675, 218, 106],      // btn_ok
        BtnCancel: [113, 675, 218, 106],    // btn_no
    }, '编辑信息');
    // ⚠️ 申请行真值是 540×128，**不是** FGUI 组件头写的 `size="662,109"`（那是从详情行抄来的残留）
    assert.equal(apply.P('ApplyListView/content/ApplyRow')!.vw, 540, '行宽必须 = 540（= 列表视口宽）');
    assert.notEqual(apply.P('ApplyListView/content/ApplyRow')!.vw, 662, '照抄 662 会让底框整体左移 61px');
});

test('D11b ⚠️ 弹窗恒居中：骨架「中心距 popBg 顶边」= 12.5 / 12.5 / 10 / 10', () => {
    // FGUI `组件_公共弹窗_新.xml`：title_brown 中心距顶 12.5、title 中心距顶 10、闭钮中心距顶 10。
    // `popBg` 那组的 relation 是 center-center/middle-middle，老端又 toFullCenterParent ⇒ 恒居中，
    // FGUI 里那对 xy 只是设计态坐标（不照抄）。
    for (const [ctx, tag] of [[apply, '申请列表'], [edit, '编辑信息']] as const) {
        const popTop = ctx.P('PopupBg')!.top;
        for (const [p, want] of [['TitleBg', 12.5], ['TitleDeco', 12.5], ['Title', 10], ['CloseBtn', 10]] as const) {
            const got = ctx.P(p)!.cy - popTop;
            assert.ok(near(got, want), `${tag} ${p} 中心距顶 ${got.toFixed(2)} 期望 ${want}`);
        }
        // 弹窗水平居中（popBg 中心 = 画布中心 360）
        assert.ok(near(ctx.P('PopupBg')!.cx, 360), `${tag} popBg 水平居中`);
        assert.ok(near(ctx.P('PopupBg')!.left + ctx.P('PopupBg')!.vw / 2, 360), `${tag} popBg 中点 = 360`);
        // 闭钮右缘固定
        assert.ok(near(ctx.P('PopupBg')!.left + ctx.P('PopupBg')!.vw - ctx.P('CloseBtn')!.cx, 32),
            `${tag} 闭钮中心距弹窗右缘 32（与等级预览同口径）`);
    }
});

test('D12 ⚠️ 虚拟列表行宽 540 = 视口宽（`VirtualScrollView` 槽位水平居中放进 content）', () => {
    const list = apply.P('ApplyListView')!;
    const row = apply.P('ApplyListView/content/ApplyRow')!;
    assert.ok(near(list.vw, 540));
    assert.ok(near(row.vw, 540), '行宽必须等于视口宽，否则槽位居中后底框会偏');
    assert.ok((list.node._components as unknown[]).map(apply.at).some((c) => c?.__type__ === 'cc.Mask'), '列表要 Mask');
    assert.ok((apply.P('ApplyListView/content')!.node._components as unknown[]).map(apply.at).some((c) => c?.__type__ === 'cc.Widget'), 'content 要 Widget');
    // 行模板的锚点 (0.5,0.5)、首行中心 = -行高/2
    assert.ok(near(lpos(row.node).y, -64));
});

test('D13 ⚠️ prefab 里每个 spriteFrame 引用都能解析到「sprite-frame」子资源（悬空 ⇒ 运行时品红块）', () => {
    const seen = new Set<string>();
    for (const [tag, ctx] of [['申请列表', apply], ['编辑信息', edit], ['等级预览', preview]] as const) {
        for (const [path, r] of ctx.byPath) {
            const sp = ((r.node._components ?? []) as unknown[]).map(ctx.at).find((c) => c?.__type__ === 'cc.Sprite');
            const uuid = sp ? uuidOf(sp) : null;
            if (!uuid) continue;
            assert.ok(uuid.endsWith('@f9941'), `${tag} ${path} 的 spriteFrame uuid 不是 @f9941 子资源：${uuid}`);
            seen.add(uuid);
        }
    }
    // 用到的图名都能在 `LeagueArt` 的常量里找到对应（防止「图换了名但常量没跟上」）
    assert.ok(seen.has(U.board) && seen.has(U.btn10) && seen.has(U.btn07) && seen.has(U.bbp13));
});

test('D14 ⚠️ EditBox：maxLength=128 / 多行 / textLabel / placeholderLabel / 无默认垃圾节点', () => {
    const eb = edit.comp('Input', 'cc.EditBox')!;
    assert.ok(eb, 'Input 必须挂 cc.EditBox');
    assert.equal(eb._maxLength, 128, 'FGUI maxLength="128"');
    assert.equal(eb._inputMode, 0, '0 = ANY（多行）');
    assert.equal(eb._returnType, 0, '0 = DEFAULT（回车换行，不收键盘）');
    assert.equal(eb._inputFlag, 5, '5 = DEFAULT');
    // ⚠️ `_textLabel` / `_placeholderLabel` 存的是 **`cc.Label` 组件**引用（不是节点）
    const tl = edit.at(eb._textLabel)!;
    const ph = edit.at(eb._placeholderLabel)!;
    assert.equal(edit.at(tl.node)!._name, 'Text');
    assert.equal(edit.at(ph.node)!._name, 'Placeholder');
    // EditBox 新加时自带的两个默认 label 子节点必须清掉（`PLACEHOLDER_LABEL` 会渲染出「label」脏字）
    const junk = [...edit.byPath.keys()].filter((k) => /PLACEHOLDER_LABEL|TEXT_LABEL/.test(k));
    assert.deepEqual(junk, [], `还有 EditBox 自带的垃圾节点：${junk.join(',')}`);
    const kids = ((edit.P('Input')!.node._children ?? []) as unknown[]).map((c) => String(edit.at(c)!._name)).sort();
    assert.deepEqual(kids, ['Placeholder', 'Text']);

    // ⚠️⚠️ 多行（`inputMode = ANY(0)`）下，`cc.EditBox` 会在自己的生命周期里把两个 label
    //      **强制重排**到「输入框左上角 + (2,0) 内边距」，**完全无视** prefab 里写的 position。
    //      所以 Label 的锚点**必须是左上 `(0,1)`**：若沿用默认 `(0.5,0.5)`，同一个 position 会把
    //      整块文字再往左上挪 `(W/2, H/2)` = (258.5, 59.5)，517×119 的框里文字几乎全落到框外
    //      —— 表现为「输入框看着是空的、连占位提示都没有」，而且**不报任何错**。
    //      （单行模式不会重排：本仓 `ui/Chat/Chat.prefab` 是 SINGLE_LINE 且 label 用 (0,1)，
    //        `LeagueHall` 的搜索框是 NUMERIC 单行、label 用 (0.5,0.5) 居中，两者都对。）
    //      这条是**真引擎探针**（`tmp/_apply_edit_probe.mjs` B8b/B8c）抓出来的，静态检查原本全绿。
    for (const [p, tag] of [['Input/Text', 'Text'], ['Input/Placeholder', 'Placeholder']] as const) {
        const uit = edit.comp(p, 'cc.UITransform')!;
        const ap = uit._anchorPoint as { x: number; y: number };
        assert.equal(ap.x, 0, `${tag} 的锚点 x 必须是 0（左上）`);
        assert.equal(ap.y, 1, `${tag} 的锚点 y 必须是 1（左上）`);
        // 摆在输入框（517×119，锚点 0.5）的左上角 = 相对框中心 (-258.5, +59.5)
        const pos = lpos(edit.P(p)!.node);
        assert.ok(near(pos.x, -258.5) && near(pos.y, 59.5), `${tag} 应摆在输入框左上角 (-258.5,59.5)，实得 (${pos.x},${pos.y})`);
    }
});

test('D15 ⚠️ `LeagueLevelPreview` 的底板 retrofit：已换真九宫格、旧 `bg_04` 不再被引用', () => {
    const sp = preview.comp('PopupBg', 'cc.Sprite')!;
    assert.equal(uuidOf(sp), U.board, 'PopupBg 应引 panel_window_01_9gong');
    assert.equal(sp._type, 1, '真底板必须九宫格');
    assert.ok(near(preview.P('PopupBg')!.vw, 640) && near(preview.P('PopupBg')!.vh, 905), '尺寸不变（640×905）');
    for (const [, r] of preview.byPath) {
        for (const c of ((r.node._components ?? []) as unknown[]).map(preview.at)) {
            if (c?.__type__ === 'cc.Sprite') assert.notEqual(uuidOf(c), U.bg04, '旧底板 bg_04 不该再被引用');
        }
    }
});

test('D16 ⚠️ 三个弹窗的底板 / 按钮九宫格口径一致（不留「有的换有的没换」）', () => {
    const boardUsers = [apply, edit, preview].map((ctx) => uuidOf(ctx.comp('PopupBg', 'cc.Sprite')!));
    assert.deepEqual(boardUsers, [U.board, U.board, U.board], '三个弹窗都必须用真底板');
    for (const ctx of [apply, edit, preview]) {
        assert.equal(ctx.comp('PopupBg', 'cc.Sprite')!._type, 1);
    }
    // 200~210 的两张通用按钮底一律 SIMPLE（退化九宫格）
    for (const [ctx, tag] of [[apply, '申请列表'], [edit, '编辑信息']] as const) {
        for (const [path, r] of ctx.byPath) {
            const sp = ((r.node._components ?? []) as unknown[]).map(ctx.at).find((c) => c?.__type__ === 'cc.Sprite');
            const uuid = sp ? uuidOf(sp) : null;
            if (uuid === U.btn10 || uuid === U.btn09) {
                assert.equal(sp!._type, 0, `${tag} ${path} 的 TY_btn09/10 必须 SIMPLE`);
            }
        }
    }
});

// ============================================================
// E. 页面逻辑 / 调用约定（源码文本）
// ============================================================

test('E1 两个页面类 `prefabPath` 大小写与磁盘一致，且继承 PopupBase', () => {
    const list = readFileSync(APPLY_LIST_PAGE_TS, 'utf8');
    const editSrc = readFileSync(EDIT_PAGE_TS, 'utf8');
    assert.ok(list.includes("static prefabPath = 'ui/League/LeagueApplyList'"), '申请列表 prefabPath');
    assert.ok(editSrc.includes("static prefabPath = 'ui/League/LeagueEdit'"), '编辑信息 prefabPath');
    assert.ok(/export class LeagueApplyListPage extends PopupBase/.test(list));
    assert.ok(/export class LeagueEditPage extends PopupBase/.test(editSrc));
    // 目录大小写必须与磁盘一致（热更新 zip 内路径大小写敏感）
    assert.ok(existsSync('assets/resources/ui/League/LeagueApplyList.prefab'));
    assert.ok(existsSync('assets/resources/ui/League/LeagueEdit.prefab'));
});

test('E2 ⚠️ 申请列表三处时序 / 两道闸门', () => {
    const src = stripComments(readFileSync(APPLY_LIST_PAGE_TS, 'utf8'));
    // renderItemFn 只绑一次（放 onOpen 会随每次打开重复叠加）
    assert.ok(/rendererBound/.test(src) && /if \(!this\.rendererBound\)/.test(src), 'renderItemFn 要只绑一次');
    assert.ok(/this\.applyList\.renderItemFn = /.test(src));
    // ⚠️ VirtualScrollView 在 start() 里建槽位，onOpen 早于 start ⇒ 必须 defer 一帧
    assert.ok(/await this\.nextPopupFrame\(\)/.test(src), '取数后要 defer 一帧再 refreshList');
    assert.ok(/refreshList\(/.test(src), '要调 refreshList');
    // 空列表不发包（老端两句守卫）
    assert.ok(/canApproveAll\(this\.rows\)/.test(src), '批量按钮要走 canApproveAll 守卫');
    // 防连点
    assert.ok(/beginWrite\(\)/.test(src) && /this\.busy/.test(src), '写操作要有防连点闸门');
    // 行回调**每帧现取**（槽位 clone 复用，不能按 index 捕获）
    assert.ok(/const view = this\.rows\[index\]/.test(src), 'renderRow 里要按 index 现取');
    assert.ok(/row\.onAction = /.test(src) && /row\.onAvatar = /.test(src), '每次 render 都要重设回调');
});

test('E3 ⚠️ 编辑信息：四句守卫 + 竞态放弃 + 不发包的三条早退', () => {
    const src = stripComments(readFileSync(EDIT_PAGE_TS, 'utf8'));
    assert.ok(/if \(this\.editing\) return;/.test(src), '① 防连点');
    assert.ok(/content === LEAGUE_EDIT_REJECTED_PLACEHOLDER/.test(src), '② 「***」当没填');
    assert.ok(/if \(this\.editType <= 0\) return;/.test(src), '②b type 无效不发包');
    assert.ok(/input\.string !== content/.test(src), '③ 结果回来时输入框被改了 ⇒ 放弃');
    assert.ok(/this\.closeByButton\(\)/.test(src), "'ok' 才关窗");
    // 四条用途共用一个 prefab（不为四种 type 各建一个）
    assert.ok(/ILeagueEditParams/.test(src), '要暴露 open 参数类型');
    assert.ok(!/LEAGUE_EDIT_SENSITIVE_TIP/.test(src) || /有意跳过|无 SDK/.test(readFileSync(EDIT_PAGE_TS, 'utf8')),
        '违禁词校验是**有意跳过**的（无 SDK 层），跳过的理由要写在注释里');
});

test('E4 ⚠️ 行组件 `render()` 绝对赋值 + 头像令牌防串（槽位会被 clone 复用）', () => {
    const src = stripComments(readFileSync(APPLY_ROW_TS, 'utf8'));
    // 三个 label 绝对赋值
    for (const prop of ['nameLabel', 'levelLabel', 'powerLabel']) {
        assert.ok(new RegExp(`this\\.${prop}\\.string = `).test(src), `${prop} 要绝对赋值`);
    }
    // 先清头像（不清的话新行会短暂顶着上一行的头像）
    assert.ok(/this\.avatarSprite\.spriteFrame = null/.test(src), 'render 里要先清头像');
    // 令牌：在飞的头像结果要和当前槽位比对
    assert.ok(/avatarSeq/.test(src) && /token !== this\.avatarSeq/.test(src), '头像要有令牌防串');
    // 空槽不发
    assert.ok(/if \(!view\) return;/.test(src), '空槽（current === null）时按一次不发');
    // 按钮点击由行自己接（每帧现取数据），不是宿主按 index 捕获
    assert.ok(/bindClick/.test(src) && /this\.emit\('agree'\)/.test(src) && /this\.emit\('reject'\)/.test(src));
    // 语义提醒：btn_kick = 拒绝（agree=false）
    assert.ok(/agreeButton: Node/.test(src) && /rejectButton: Node/.test(src), '两个按钮属性要在');
});

test('E5 ⚠️ 第四刀修掉的微信号前缀，页面模板也要跟着改（不能只在常量里改）', () => {
    // 常量改全角后，`LeagueHallPage` 的两处模板串必须引用常量而不是硬编码半角
    const hall = stripComments(readFileSync('assets/script/app/league/LeagueHallPage.ts', 'utf8'));
    assert.ok(!hall.includes("'微信号:'"), '页面里不该再有半角 `微信号:` 字面量');
    assert.ok(hall.includes('LEAGUE_HALL_WX_PREFIX'), '页面模板要用常量');
    assert.ok(hall.includes('LEAGUE_HALL_ID_PREFIX'), 'ID 前缀同样用常量');
});
