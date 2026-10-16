/**
 * 「联盟」主页（P1 = 主页外壳）的回归网。
 *
 * 分五段，各守一件事：
 *
 *   A. **判定口径**（`LeagueTable`，纯函数）—— 六个入口的「节点名 → 老端入口」映射、
 *      `landed` 开关、信息条节点名与占位文案。老端这些散在 `CtrlLeague` + 五个
 *      `play/LayerLeague*.ts` 里（依赖 DI 容器 + FGUI 控制器 + 网络），没法单测，
 *      移植时收敛成传参纯函数，本段是它们唯一的回归网。
 *   B. **美术口径**（`LeagueArt`）—— 按钮底图按**颜色语义**取（棕被 3 个入口复用）、
 *      旗帜 8 色表（**图名顺序与颜色名顺序不一致**）、越界夹取、SIMPLE/SLICED。
 *   C. **prefab 结构 + 几何**（`ui/League/League.prefab`）—— 脚本组件 `__type__`
 *      必须能从 `.ts.meta` 反解（防 cid 抄错成 `MissingScript`）；每个节点的
 *      `_layer` 必须是 UI_2D（落 DEFAULT 会整棵子树不渲染）；子节点序 = FGUI
 *      `displayList` 序（序错会让 `InfoBg` 底板盖住三行文字）；几何必须与 FGUI
 *      `组件_联盟_主界面.xml` 反解出的画布像素一致。
 *   D. **入口接线**（源码文本 + `MainRoot.prefab`）—— 底部六格第 6 格「联盟」必须
 *      真的绑上 `ui/League/League`，否则点了静默忽略。
 *   E. **文案表**。
 *
 * 口径真源：
 *   - 设计：`zarts/art/UIProject/trunk/UIProject/assets/主界面_联盟/主界面/**`
 *     （`组件_联盟_主界面.xml` + `按钮_联盟_{红,棕,蓝,玩法标题}.xml`）
 *     + `.../主界面_联盟/组件/组件_联盟_旗帜.xml`
 *   - 老端：`client/assets/script/app/game/ctrl/main/league/**`（`CtrlLeague` + `TabLeagueMain`）
 *   - 本项目：`assets/script/app/league/**` + `assets/script/app/main/MainTabHost.ts`
 *
 * ⚠️ 三处**刻意与 FGUI 原稿不同**（理由见 `LeaguePage.ts` 文件头），本文件当契约钉住：
 *   ① 按钮节点尺寸 = **底图原尺寸**（206×54 / 186×44），不是 FGUI 组件框 206×130 / 186×130
 *      ⇒ 点击区 = 可见底图，不留「看得见框、点不到」的空白热区；
 *   ② 两个「全面屏适配」helper（`组件_通用_全面屏适配` / `_延展`）**不移植**
 *      —— 屏幕适配由 Canvas/Widget 统一管；
 *   ③ 旗面 8 色取 FGUI `颜色` controller 的**默认页**（绿 `img_Qizhi_06`）。
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import {
    LEAGUE_ART_BANNER_BASE,
    LEAGUE_ART_BANNER_FRAME,
    LEAGUE_ART_BG,
    LEAGUE_ART_BTN_BLUE,
    LEAGUE_ART_BTN_BROWN,
    LEAGUE_ART_BTN_RED,
    LEAGUE_ART_BTN_TITLE,
    LEAGUE_ART_HELP,
    LEAGUE_ART_INFO_BG,
    LEAGUE_ART_ROOT,
    LEAGUE_ART_SLICED,
    LEAGUE_BANNER_COLOR_COUNT,
    LEAGUE_BANNER_COLORS,
    LEAGUE_BANNER_DEFAULT_COLOR,
    LEAGUE_SPRITE_SIMPLE,
    LEAGUE_SPRITE_SLICED,
    leagueBannerArt,
    leagueBannerColorName,
    leagueButtonArt,
    leagueSpriteType,
} from '../assets/script/app/league/LeagueArt';
import {
    LEAGUE_ENTRANCES,
    LEAGUE_ENTRANCE_RED_DOT,
    LEAGUE_ENTRANCE_RED_DOT_SOURCE,
    LEAGUE_INFO_NODES,
    LEAGUE_INFO_PLACEHOLDER,
    hasLeagueDiscountRedDot,
    landedLeagueEntrances,
    leagueEntranceByNode,
    pendingLeagueEntrances,
} from '../assets/script/app/league/LeagueTable';
import { LEAGUE_TIP_LOADING, LEAGUE_TIP_NOT_OPEN } from '../assets/script/app/league/LeagueTexts';

// ============================================================
// A. 判定口径（LeagueTable）
// ============================================================

test('A1 六个入口：节点名 / 老端 key / 文案 唯一且互不重复', () => {
    assert.equal(LEAGUE_ENTRANCES.length, 6, 'FGUI displayList 里就是 6 个入口');
    const nodes = LEAGUE_ENTRANCES.map((e) => e.node);
    const keys = LEAGUE_ENTRANCES.map((e) => e.key);
    assert.equal(new Set(nodes).size, 6, `节点名重复：${nodes.join(',')}`);
    assert.equal(new Set(keys).size, 6, `老端 key 重复：${keys.join(',')}`);
    assert.deepEqual(nodes, ['BtnHall', 'BtnShop', 'BtnSale', 'BtnTask', 'BtnFight', 'BtnDonate']);
});

test('A2 入口文案 = FGUI 原稿逐字（含「联合战线」不是「北伐中原」）', () => {
    const byNode = new Map(LEAGUE_ENTRANCES.map((e) => [e.node, e.label]));
    assert.equal(byNode.get('BtnHall'), '联盟大厅');
    assert.equal(byNode.get('BtnShop'), '联盟商店');
    assert.equal(byNode.get('BtnSale'), '每日砍价');
    assert.equal(byNode.get('BtnTask'), '联盟任务');
    assert.equal(byNode.get('BtnFight'), '联合战线');
    assert.equal(byNode.get('BtnDonate'), '联盟捐献');
});

test('A3 入口颜色：玩法标题 1 + 红 1 + 棕 3（复用）+ 蓝 1', () => {
    const colors = LEAGUE_ENTRANCES.map((e) => e.color);
    assert.deepEqual(colors, ['title', 'red', 'brown', 'brown', 'brown', 'blue']);
    const count = (c: string) => colors.filter((x) => x === c).length;
    assert.equal(count('brown'), 3, '「棕」被每日砍价 / 联盟任务 / 联合战线 三个入口复用');
});

test('A4 P6 后六入口**全部**落地：大厅 + 商店 + 砍价 + 任务 + 联合战线 + 捐献（无残留）', () => {
    assert.equal(landedLeagueEntrances().length, 6);
    assert.equal(pendingLeagueEntrances().length, 0);
    // 顺序 = `LEAGUE_ENTRANCES` 的声明序（= FGUI `displayList` 序），不是视觉位置序
    assert.deepEqual(
        landedLeagueEntrances().map((e) => e.node),
        ['BtnHall', 'BtnShop', 'BtnSale', 'BtnTask', 'BtnFight', 'BtnDonate'],
    );
    // P6 收口后**不再有**未落地入口 —— 六颗按钮点下去都必须开面板（或按来源表亮红点）
    assert.deepEqual(pendingLeagueEntrances().map((e) => e.node), []);
    // ⚠️ `landed:true` 必须在 `LeaguePage.onEntranceClick` 里有对应 `case`，
    //    否则会落到 `default` 的 `console.warn` + 提示「尚未开放」（半接线，界面上很难发现）。
    //    这条联动由 `league-hall.test.ts` 的 D2 按本表的 `landed` 集合**反查**守着。
    assert.deepEqual(
        landedLeagueEntrances().map((e) => e.key),
        [
            'LayerLeagueHall', 'LayerLeagueStore', 'LayerLeagueDiscount',
            'LayerLeagueTask', 'LayerLeagueNorthernExpedition', 'LayerLeagueDonate',
        ],
    );
});

test('A5 leagueEntranceByNode：查得到就返回同一条，查不到返 null（不抛）', () => {
    const hall = leagueEntranceByNode('BtnHall');
    assert.equal(hall, LEAGUE_ENTRANCES[0]);
    assert.equal(leagueEntranceByNode('NoSuchNode'), null);
    assert.equal(leagueEntranceByNode(''), null);
});

test('A6 信息条节点名与 prefab 里实际节点一致（这是页面类按名取节点的唯一契约）', () => {
    assert.deepEqual(LEAGUE_INFO_NODES, {
        banner: 'Banner',
        bannerFrame: 'Frame',
        bannerBase: 'Base',
        bannerColor: 'ColorIcon',
        name: 'LabName',
        level: 'LabLv',
        memberCount: 'LabUserCount',
        infoBg: 'InfoBg',
    });
});

test('A7 信息条占位文案 = FGUI 原稿（真值等 CmdUnion 数据落地）', () => {
    assert.deepEqual(LEAGUE_INFO_PLACEHOLDER, {
        name: '北伐中原',
        level: '传奇:4级',
        memberCount: '成员:26/46',
    });
});

test('A8 ⚠️ 入口红点来源表：六条全覆盖、只有「砍价 / 任务 / 联合战线」三条是真判据（其余照抄老端恒关）', () => {
    // 节点下那颗红点的名字 = `ui/common/RedDot.prefab` 的根名（`LeaguePage` 靠 `getChildByName` 找）
    assert.equal(LEAGUE_ENTRANCE_RED_DOT, 'RedDot');
    // 表必须**全覆盖**六个 key（漏一个类型就不过；这里再钉一遍键序与值）
    const keys = LEAGUE_ENTRANCES.map((e) => e.key);
    assert.deepEqual(Object.keys(LEAGUE_ENTRANCE_RED_DOT_SOURCE), keys);
    for (const key of keys) {
        const src = LEAGUE_ENTRANCE_RED_DOT_SOURCE[key];
        assert.ok(
            src === 'none' || src === 'discount' || src === 'task' || src === 'north',
            `${key} 的红点来源取值非法：${src}`,
        );
    }
    // 三条有真判据；另外三条**刻意**恒关（老端：大厅无 `com_rd`、商店两处调用点被注释、
    // 捐献依赖未迁移的广告子系统）。别"顺手打开"。
    assert.equal(LEAGUE_ENTRANCE_RED_DOT_SOURCE.LayerLeagueDiscount, 'discount');
    assert.equal(LEAGUE_ENTRANCE_RED_DOT_SOURCE.LayerLeagueTask, 'task');
    // P6 新增：老端 `TabLeagueMain.updateRD()` 里的 `hasNorthernExpeditionRD()`（`btn_fight.com_rd`）
    assert.equal(LEAGUE_ENTRANCE_RED_DOT_SOURCE.LayerLeagueNorthernExpedition, 'north');
    assert.deepEqual(
        keys.filter((k) => LEAGUE_ENTRANCE_RED_DOT_SOURCE[k] === 'discount'),
        ['LayerLeagueDiscount'],
    );
    assert.deepEqual(
        keys.filter((k) => LEAGUE_ENTRANCE_RED_DOT_SOURCE[k] === 'task'),
        ['LayerLeagueTask'],
    );
    assert.deepEqual(
        keys.filter((k) => LEAGUE_ENTRANCE_RED_DOT_SOURCE[k] === 'north'),
        ['LayerLeagueNorthernExpedition'],
    );
    // 恒关的三条：大厅 / 商店 / 捐献（`none`）
    assert.deepEqual(
        keys.filter((k) => LEAGUE_ENTRANCE_RED_DOT_SOURCE[k] === 'none'),
        ['LayerLeagueHall', 'LayerLeagueStore', 'LayerLeagueDonate'],
    );
});

test('A9 hasLeagueDiscountRedDot = 老端 hasDiscountRD()（todayBargainTimes < bargainBuyCount）', () => {
    // 还有次数 ⇒ 亮；用完 / 到顶 ⇒ 灭
    assert.equal(hasLeagueDiscountRedDot(0, 3), true);
    assert.equal(hasLeagueDiscountRedDot(2, 3), true);
    assert.equal(hasLeagueDiscountRedDot(3, 3), false);
    assert.equal(hasLeagueDiscountRedDot(4, 3), false);
    // 上限为 0（未配置 / 未入盟时取到 0）⇒ 恒灭，不会出现「0 < 非零上限」以外的恒亮
    assert.equal(hasLeagueDiscountRedDot(0, 0), false);
});

// ============================================================
// B. 美术口径（LeagueArt）
// ============================================================

test('B1 图目录与主页用图的图名（FGUI 原名，只在磁盘上核对得到）', () => {
    assert.equal(LEAGUE_ART_ROOT, 'image/league');
    assert.equal(LEAGUE_ART_BG, 'lm_bg01');
    assert.equal(LEAGUE_ART_INFO_BG, 'lm_pic10');
    assert.equal(LEAGUE_ART_BANNER_FRAME, 'img_Qizhi_02');
    assert.equal(LEAGUE_ART_BANNER_BASE, 'icon_lm07');
    assert.equal(LEAGUE_ART_HELP, 'zx_btn01');
    // 背景实际落地是 jpg（`lm_bg01.jpg`）—— 取图走 `loadArt(name, root)`，不带扩展名
    assert.ok(existsSync(`assets/resources/${LEAGUE_ART_ROOT}/${LEAGUE_ART_BG}.jpg`), 'lm_bg01.jpg 不在磁盘上');
});

test('B2 按钮底图按颜色语义取，棕是三种入口共用的那一张', () => {
    assert.equal(leagueButtonArt('title'), LEAGUE_ART_BTN_TITLE);
    assert.equal(leagueButtonArt('red'), LEAGUE_ART_BTN_RED);
    assert.equal(leagueButtonArt('brown'), LEAGUE_ART_BTN_BROWN);
    assert.equal(leagueButtonArt('blue'), LEAGUE_ART_BTN_BLUE);
    assert.equal(LEAGUE_ART_BTN_RED, 'TY_btn17');
    assert.equal(LEAGUE_ART_BTN_BROWN, 'TY_btn18');
    assert.equal(LEAGUE_ART_BTN_BLUE, 'TY_btn19');
    assert.equal(LEAGUE_ART_BTN_TITLE, 'title_btn');
    // 三种颜色必须是三张不同的图（写错就整排按钮一个色，且不报错）
    assert.equal(new Set([LEAGUE_ART_BTN_RED, LEAGUE_ART_BTN_BROWN, LEAGUE_ART_BTN_BLUE, LEAGUE_ART_BTN_TITLE]).size, 4);
});

test('B3 旗帜 8 色：图名顺序与颜色名顺序**不一致**（照 gearIcon 的 values 回查得到）', () => {
    assert.equal(LEAGUE_BANNER_COLOR_COUNT, 8);
    assert.deepEqual(
        LEAGUE_BANNER_COLORS.map((c) => c.name),
        ['绿', '蓝', '紫', '红', '橙', '黄', '金', '青'],
    );
    assert.deepEqual(
        LEAGUE_BANNER_COLORS.map((c) => c.art),
        ['img_Qizhi_06', 'img_Qizhi_11', 'img_Qizhi_07', 'img_Qizhi_08', 'img_Qizhi_09', 'img_Qizhi_05', 'img_Qizhi_10', 'img_Qizhi_04'],
    );
    // 8 张图名必须互不相同（重复 = 两个颜色长得一样）
    assert.equal(new Set(LEAGUE_BANNER_COLORS.map((c) => c.art)).size, 8);
    // 绿排第 0、图名是 06（不是 01）—— 「按直觉排」的典型陷阱
    assert.equal(LEAGUE_BANNER_COLORS[0]!.art, 'img_Qizhi_06');
});

test('B4 默认色 = 第 1 页（绿），与 prefab 里 ColorIcon 的静态图一致', () => {
    assert.equal(LEAGUE_BANNER_DEFAULT_COLOR, 0);
    assert.equal(leagueBannerArt(LEAGUE_BANNER_DEFAULT_COLOR), 'img_Qizhi_06');
});

test('B5 leagueBannerArt / leagueBannerColorName 越界**就地夹取**（服务端下发裸数字，别把界面打崩）', () => {
    assert.equal(leagueBannerArt(-999), 'img_Qizhi_06');
    assert.equal(leagueBannerArt(999), 'img_Qizhi_04');
    assert.equal(leagueBannerColorName(-1), '绿');
    assert.equal(leagueBannerColorName(99), '青');
    // 非有限数 / 小数
    assert.equal(leagueBannerArt(Number.NaN), 'img_Qizhi_06');
    // 非有限数（Infinity）**不夹到最大色**，而是回落到第 1 页 —— 那不是「越界的整数」，是垃圾输入
    assert.equal(leagueBannerArt(Number.POSITIVE_INFINITY), 'img_Qizhi_06');
    assert.equal(leagueBannerArt(Number.NEGATIVE_INFINITY), 'img_Qizhi_06');
    assert.equal(leagueBannerArt(3.9), 'img_Qizhi_08');
});

test('B6 主页用到的图**都不是九宫格**（FGUI 里没标 scale="9grid"）', () => {
    // ⚠️ P2 起 `LEAGUE_ART_SLICED` **不再为空**（大厅的 6 张大底板/底框/底栏需要九宫格），
    //    所以这里不能再断言「集合为空」，改成「主页这批图一张都不许进集合」——
    //    守卫的意图（主页的图在 FGUI 里都没标 9grid）原样保留。
    const homeArts = [
        LEAGUE_ART_BG, LEAGUE_ART_INFO_BG, LEAGUE_ART_BANNER_FRAME, LEAGUE_ART_BANNER_BASE,
        LEAGUE_ART_HELP, LEAGUE_ART_BTN_RED, LEAGUE_ART_BTN_BROWN, LEAGUE_ART_BTN_BLUE, LEAGUE_ART_BTN_TITLE,
        ...LEAGUE_BANNER_COLORS.map((c) => c.art),
    ];
    for (const art of homeArts) {
        assert.equal(leagueSpriteType(art), LEAGUE_SPRITE_SIMPLE, `${art} 应为 SIMPLE`);
        assert.ok(!LEAGUE_ART_SLICED.has(art), `${art} 是主页用图，不该被加进九宫格集`);
    }
    assert.equal(leagueSpriteType('不存在的图'), LEAGUE_SPRITE_SIMPLE, '认不出的一律 SIMPLE，别猜九宫格');
    assert.equal(LEAGUE_SPRITE_SIMPLE, 0);
    assert.equal(LEAGUE_SPRITE_SLICED, 1);
});

// ============================================================
// C. prefab 结构 + 几何
// ============================================================

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

function scriptCid(tsPath: string): string {
    const meta = JSON.parse(readFileSync(`${tsPath}.meta`, 'utf8')) as { uuid: string };
    return compressUuid(meta.uuid);
}

const LEAGUE_PREFAB = 'assets/resources/ui/League/League.prefab';
const LEAGUE_PAGE_TS = 'assets/script/app/league/LeaguePage.ts';
const UI_2D = 33554432;

type Entry = Record<string, unknown>;
const prefab: Entry[] = JSON.parse(readFileSync(LEAGUE_PREFAB, 'utf8')) as Entry[];
const at = (ref: unknown): Entry | null =>
    ref && typeof ref === 'object' && '__id__' in (ref as Entry) ? prefab[(ref as { __id__: number }).__id__]! : null;

const nodes = prefab.filter((e) => e && e.__type__ === 'cc.Node');
const rootNode = nodes[0]!;

/**
 * 嵌套 prefab 实例的**壳节点**。
 *
 * 盘上这种节点只有 `_parent` / `_prefab` 两个字段：`_name` / `_lpos` / `_lscale` / `_layer` / `_active`
 * 全落在 `cc.PrefabInstance.propertyOverrides` 里（或随源 prefab）⇒ 不能按普通节点去查 `_layer`。
 */
const instanceShells = new Set<Entry>(
    prefab
        .filter((e) => e && e.__type__ === 'cc.PrefabInfo'
            && (e.asset as { __uuid__?: string } | undefined)?.__uuid__)
        .map((info) => at(info.root)!),
);

/** 目标渲染序 = FGUI `displayList` 序（去掉两个「全面屏适配」helper）。 */
const RENDER_ORDER = [
    'Bg', 'BtnHall', 'BtnShop', 'BtnSale', 'BtnTask', 'BtnFight', 'BtnDonate',
    'InfoBg', 'Banner', 'BtnHelp', 'LabName', 'LabLv', 'LabUserCount',
];

/** 反解每个节点的「画布像素左上角」（画布 720×1280，根中心 = (360,640)，y 向下同 FGUI）。 */
function solveCanvasRects(): Map<string, { left: number; top: number; w: number; h: number }> {
    const out = new Map<string, { left: number; top: number; w: number; h: number }>();
    const walk = (node: Entry, parentCx: number, parentCy: number): void => {
        const pos = (node._lpos ?? { x: 0, y: 0 }) as { x: number; y: number };
        const comps = ((node._components ?? []) as unknown[]).map(at);
        const uit = comps.find((c) => c?.__type__ === 'cc.UITransform');
        const size = (uit?._contentSize ?? { width: 0, height: 0 }) as { width: number; height: number };
        const anchor = (uit?._anchorPoint ?? { x: 0.5, y: 0.5 }) as { x: number; y: number };
        const cx = parentCx + pos.x;
        const cy = parentCy + pos.y;
        out.set(node._name as string, {
            left: 360 + cx - anchor.x * size.width,
            top: 640 - cy - (1 - anchor.y) * size.height,
            w: size.width,
            h: size.height,
        });
        for (const child of ((node._children ?? []) as unknown[])) {
            const c = at(child);
            if (c) walk(c, cx, cy);
        }
    };
    walk(rootNode, 0, 0);
    return out;
}
const rects = solveCanvasRects();

test('C1 根节点是第一个 cc.Node、cc.Prefab.data 指向它、且 prefab 存在', () => {
    assert.ok(existsSync(LEAGUE_PREFAB), `prefab 不存在：${LEAGUE_PREFAB}`);
    assert.ok(existsSync(`${LEAGUE_PREFAB}.meta`), '缺 League.prefab.meta（不会被编辑器导入）');
    const data = (prefab[0] as { data: { __id__: number } }).data;
    assert.equal(data.__id__, prefab.findIndex((e) => e && e.__type__ === 'cc.Node'));
    assert.equal(rootNode._name, 'League');
    assert.equal(rootNode._parent, null, '根节点没有父节点');
});

test('C2 ⚠️ 所有节点 _layer 都是 UI_2D（落 DEFAULT 会让整棵子树不渲染，且不报错）', () => {
    // 嵌套实例（六个入口红点）的壳节点盘上**没有 `_layer`** —— 层级随源 prefab
    // ⇒ 只查真正序列化在本文件里的节点，否则会把 `undefined` 误判成「层落错」。
    const layers = new Set(nodes.filter((n) => !instanceShells.has(n)).map((n) => n._layer));
    assert.deepEqual([...layers], [UI_2D], `出现非 UI_2D 的 layer：${[...layers].join(', ')}（MCP create-node 默认给 1<<30 = DEFAULT）`);
});

test('C3 ⚠️ 子节点序 = FGUI displayList 序（InfoBg/Banner 必须在三个 Label 之前，否则底板盖住文字）', () => {
    const order = ((rootNode._children ?? []) as unknown[]).map((c) => at(c)!._name);
    assert.deepEqual(order, RENDER_ORDER);
    // 具体守点：底板与旗帜都排在名字/等级/成员数三行文字之前
    assert.ok(order.indexOf('InfoBg') < order.indexOf('LabName'));
    assert.ok(order.indexOf('Banner') < order.indexOf('LabName'));
    assert.equal(nodes.length, 29, '29 个节点（1 根 + 12 直接子 + 6 按钮文案 + 3 旗帜零件 + 6 入口红点实例）');
});

test('C4 ⚠️ 几何：每个节点反解回画布像素后必须等于 FGUI XML 原值（差分 0.5px）', () => {
    // FGUI `组件_联盟_主界面.xml` 的 xy/size；按钮取**底图**的框（见文件头 ①）
    const EXPECT: readonly [string, number, number, number, number][] = [
        ['Bg', 0, -234, 720, 1742],
        ['BtnHall', 257, 307, 206, 54],
        ['BtnShop', 78, 479, 186, 44],
        ['BtnSale', 497, 478, 186, 44],
        ['BtnTask', 497, 662, 186, 44],
        ['BtnFight', 261, 910, 186, 44],
        ['BtnDonate', 77, 662, 186, 44],
        ['InfoBg', 115, 989, 232, 132],
        ['Banner', 0, 975, 179, 196],
        ['BtnHelp', 323, 976, 50, 50],
        ['LabName', 164, 1002, 150, 50],
        ['LabLv', 164, 1053, 100, 32],
        ['LabUserCount', 164, 1078, 100, 32],
    ];
    for (const [name, left, top, w, h] of EXPECT) {
        const got = rects.get(name);
        assert.ok(got, `找不到节点 ${name}`);
        // ⚠️ 用 `!` 而不是靠 `assert.ok` 收窄：本工程的 tsc 配置下 `node:assert/strict`
        // 只能默认导入（TS1259），TS 认不出 `assert.ok` 的 assertion 签名 ⇒ 不会收窄。
        const g = got!;
        assert.ok(Math.abs(g.left - left) <= 0.5, `${name}.left 期望 ${left} 实得 ${g.left}`);
        assert.ok(Math.abs(g.top - top) <= 0.5, `${name}.top 期望 ${top} 实得 ${g.top}`);
        assert.ok(Math.abs(g.w - w) <= 0.5, `${name}.width 期望 ${w} 实得 ${g.w}`);
        assert.ok(Math.abs(g.h - h) <= 0.5, `${name}.height 期望 ${h} 实得 ${g.h}`);
    }
});

test('C4b ⚠️ 按钮文案相对底图的偏移必须等于 FGUI（这几 px 差是「偏半个元素」那类静默 bug）', () => {
    // 由 FGUI 组件内局部框反解：文案中心 − 底图中心（画布 y 向下），Cocos 里取反号。
    // BtnHall：icon(0,33,206×54) 中心 y=60；title(0,41,206×56) 中心 y=69 ⇒ dy = −9
    // 其余：  icon(0,43,186×44) 中心 y=65；title(0,48,187×42) 中心 y=69 ⇒ dy = −4（dx = −0.5）
    const EXPECT: readonly [string, number, number][] = [
        ['BtnHall', 0, -9],
        ['BtnShop', -0.5, -4],
        ['BtnSale', -0.5, -4],
        ['BtnTask', -0.5, -4],
        ['BtnFight', -0.5, -4],
        ['BtnDonate', -0.5, -4],
    ];
    for (const [btn, dx, dy] of EXPECT) {
        const btnNode = nodes.find((n) => n._name === btn)!;
        const labelRef = ((btnNode._children ?? []) as unknown[])[0];
        const labelNode = at(labelRef);
        assert.ok(labelNode, `${btn} 下应该有一个文案子节点`);
        const comps = ((labelNode!._components ?? []) as unknown[]).map(at);
        assert.ok(comps.some((c) => c?.__type__ === 'cc.Label'), `${btn}/${labelNode!._name} 上应有 cc.Label`);
        const labelUit = comps.find((c) => c?.__type__ === 'cc.UITransform')!;
        const size = labelUit._contentSize as { width: number; height: number };
        const anchor = labelUit._anchorPoint as { x: number; y: number };
        const pos = labelNode!._lpos as { x: number; y: number };
        assert.ok(Math.abs(pos.x - dx) <= 0.5, `${btn} 文案 dx 期望 ${dx} 实得 ${pos.x}`);
        assert.ok(Math.abs(pos.y - dy) <= 0.5, `${btn} 文案 dy 期望 ${dy} 实得 ${pos.y}`);
        assert.ok(size.width > 0 && size.height > 0, `${btn} 文案尺寸不应为 0`);
        assert.equal(anchor.x, 0.5);
        assert.equal(anchor.y, 0.5);
    }
});

test('C5 Banner 三件：Frame/Base 居中、ColorIcon 上移 13.5（FGUI 组件内局部坐标）', () => {
    const banner = rects.get('Banner')!;
    const frame = rects.get('Frame')!;
    const base = rects.get('Base')!;
    const icon = rects.get('ColorIcon')!;
    // FGUI `组件_联盟_旗帜.xml`：Frame xy=(-12,-17) 203×230；Base xy=(6,6) 167×184；icon xy=(49,47) 82×75
    assert.ok(Math.abs(frame.left - (banner.left - 12)) <= 0.5 && Math.abs(frame.top - (banner.top - 17)) <= 0.5);
    assert.equal(frame.w, 203);
    assert.equal(frame.h, 230);
    assert.ok(Math.abs(base.left - (banner.left + 6)) <= 0.5 && Math.abs(base.top - (banner.top + 6)) <= 0.5);
    assert.equal(base.w, 167);
    assert.equal(base.h, 184);
    assert.ok(Math.abs(icon.left - (banner.left + 49)) <= 0.5 && Math.abs(icon.top - (banner.top + 47)) <= 0.5);
    assert.equal(icon.w, 82);
    assert.equal(icon.h, 75);
});

test('C6 ⚠️ 每个脚本组件的 __type__ 必须能从 .ts.meta 反解（防 cid 抄错成 MissingScript）', () => {
    const expected = new Map<string, string>([
        [scriptCid(LEAGUE_PAGE_TS), 'LeaguePage'],
    ]);
    const used = new Set(
        prefab
            .filter((e) => e && typeof e.__type__ === 'string' && !/^(cc\.|sp\.|CC)/.test(e.__type__ as string))
            .map((e) => e.__type__ as string),
    );
    assert.equal(used.size, 1, `prefab 里应只有 LeaguePage 一个脚本组件，实得：${[...used].join(', ')}`);
    for (const cid of used) {
        assert.equal(cid.length, 23, `cid 长度必须 23 位：${cid}`);
        assert.ok(expected.has(cid), `未知 cid（抄错 / 编辑器没编译）：${cid}`);
    }
});

test('C7 LeaguePage 的 7 个 @property 都绑上了，且指向正确的宿主节点', () => {
    const cid = scriptCid(LEAGUE_PAGE_TS);
    const comp = prefab.find((e) => e.__type__ === cid);
    assert.ok(comp, 'LeaguePage 组件没挂在 prefab 上');
    assert.equal((comp!.node as { __id__: number }).__id__, prefab.indexOf(rootNode), '脚本必须挂在根节点');

    const EXPECT: readonly [string, string][] = [
        ['banner', 'Banner'],
        ['bannerColor', 'ColorIcon'],
        ['bannerFrame', 'Frame'],
        ['nameLabel', 'LabName'],
        ['levelLabel', 'LabLv'],
        ['memberLabel', 'LabUserCount'],
        ['helpButton', 'BtnHelp'],
    ];
    for (const [prop, hostName] of EXPECT) {
        const target = at(comp![prop]);
        assert.ok(target, `${prop} 没绑`);
        // Sprite / Label 引用指向**组件**，Node 引用指向**节点**
        const host = target!.__type__ === 'cc.Node' ? target! : at(target!.node);
        assert.ok(host, `${prop} 的引用解不出宿主节点`);
        assert.equal(host!._name, hostName, `${prop} 应绑到 ${hostName}`);
    }
});

test('C8 Sprite 口径：全部 sizeMode=CUSTOM(0) / _type=SIMPLE(0)', () => {
    let seen = 0;
    for (const node of nodes) {
        const comps = ((node._components ?? []) as unknown[]).map(at);
        const sprite = comps.find((c) => c?.__type__ === 'cc.Sprite');
        if (!sprite) continue;
        seen += 1;
        assert.equal(sprite._sizeMode, 0, `${node._name} 的 sizeMode 必须是 CUSTOM(0)，否则 contentSize 被回写`);
        assert.equal(sprite._type, LEAGUE_SPRITE_SIMPLE, `${node._name} 的 _type 应为 SIMPLE(0)（主页无九宫格）`);
        const sf = sprite._spriteFrame as { __uuid__?: string } | null;
        assert.ok(sf && sf.__uuid__, `${node._name} 没有 spriteFrame`);
        assert.ok(String(sf!.__uuid__).endsWith('@f9941'), `${node._name} 的 spriteFrame 必须带 @f9941 子资源后缀`);
    }
    assert.equal(seen, 12, '12 张图：Bg + 6 入口 + InfoBg + Banner 3 件 + BtnHelp');
});

test('C9 ⚠️ Label 口径：overflow=SHRINK(2) + wrap=false + valign=TOP（防 contentSize 被回写）', () => {
    const INFO: readonly [string, string, number, number][] = [
        // [节点, 文案, fontSize, horizontalAlign]
        ['LabName', '北伐中原', 30, 0],
        ['LabLv', '传奇:4级', 18, 0],
        ['LabUserCount', '成员:26/46', 18, 0],
    ];
    const BTN_TEXT: Readonly<Record<string, [string, number]>> = {
        BtnHall: ['联盟大厅', 30],
        BtnShop: ['联盟商店', 27],
        BtnSale: ['每日砍价', 27],
        BtnTask: ['联盟任务', 27],
        BtnFight: ['联合战线', 27],
        BtnDonate: ['联盟捐献', 27],
    };
    let seen = 0;
    for (const node of nodes) {
        const comps = ((node._components ?? []) as unknown[]).map(at);
        const label = comps.find((c) => c?.__type__ === 'cc.Label');
        if (!label) continue;
        seen += 1;
        assert.equal(label._overflow, 2, `${node._name} overflow 必须 SHRINK(2)`);
        assert.equal(label._enableWrapText, false, `${node._name} 禁止换行`);
        assert.equal(label._verticalAlign, 0, `${node._name} 垂直对齐应是 TOP（FGUI 默认 valign=top）`);

        const info = INFO.find((i) => i[0] === node._name);
        if (info) {
            assert.equal(label._string, info[1]);
            assert.equal(label._fontSize, info[2]);
            assert.equal(label._horizontalAlign, info[3]);
            assert.equal(label._enableOutline, false, '信息条三行在 FGUI 里没有 strokeColor');
            continue;
        }
        // 按钮文案：挂在某个按钮下
        const parentName = at(node._parent)?._name as string;
        const want = BTN_TEXT[parentName];
        assert.ok(want, `意外的 Label 宿主：${parentName}`);
        assert.equal(label._string, want![0], `${parentName} 文案`);
        assert.equal(label._fontSize, want![1], `${parentName} 字号`);
        assert.equal(label._horizontalAlign, 1, `${parentName} 文案应居中`);
        // 文案压在图片底图上 ⇒ 必须有描边（漏了不报错、只是字发虚）
        assert.equal(label._enableOutline, true, `${parentName} 文案缺描边`);
        assert.equal(label._outlineWidth, 2, `${parentName} 描边宽度应 = FGUI strokeSize 2`);
        assert.ok(label._outlineColor, `${parentName} 缺 outlineColor`);
    }
    assert.equal(seen, 9, '9 个 Label：6 个按钮文案 + 3 行信息');
});

test('C9b ⚠️ 描边走 Label **内建** `enableOutline`，不用已废弃的 `cc.LabelOutline` 组件', () => {
    // 3.8 的 `cc.LabelOutline` 是空壳：写它属性既不落盘也不生效、且不报错。
    // 项目既有 prefab（Friend / Gift / MainRoot）里该组件计数恒为 0。
    const outlineComps = prefab.filter((e) => e?.__type__ === 'cc.LabelOutline');
    assert.equal(outlineComps.length, 0, 'League.prefab 里不应有 cc.LabelOutline（已废弃）');
    for (const other of ['assets/resources/ui/Friend/Friend.prefab', 'assets/resources/ui/Gift/Gift.prefab']) {
        const raw = readFileSync(other, 'utf8');
        assert.ok(!raw.includes('cc.LabelOutline'), `${other} 也该没有 cc.LabelOutline`);
        assert.ok(raw.includes('"_enableOutline": true'), `${other} 用 Label 内建描边`);
    }
});

test('C10 按钮按下态 = SCALE 0.9（FGUI Button downEffect="scale" downEffectValue="0.9"）', () => {
    for (const name of ['BtnHall', 'BtnShop', 'BtnSale', 'BtnTask', 'BtnFight', 'BtnDonate', 'BtnHelp']) {
        const node = nodes.find((n) => n._name === name)!;
        const btn = ((node._components ?? []) as unknown[]).map(at).find((c) => c?.__type__ === 'cc.Button');
        assert.ok(btn, `${name} 上没有 cc.Button`);
        assert.equal(btn!._transition, 3, `${name} 的 transition 应为 SCALE(3)`);
        assert.equal(btn!._zoomScale, 0.9, `${name} 的 _zoomScale 应为 0.9`);
    }
});

test('C11 ⚠️ 六个入口按钮下各一颗共用红点实例：名字 / 位置 / 盘上恒 `_active=false`', () => {
    // 位置真值 = FGUI 四个按钮组件里的 `com_rd xy="170,43|42|33"`（30×30，xy 是左上角），
    // 从「组件盒 186|206×130」换到本端「loader icon 盒」后的相对坐标。
    const EXPECT: readonly [string, number, number, string][] = [
        // [宿主按钮, rel.x, rel.y, FGUI 来源]
        ['BtnHall', 82, 12, '按钮_联盟_玩法标题.xml com_rd(170,33)'],
        ['BtnShop', 92, 7, '按钮_联盟_红.xml com_rd(170,43)'],
        ['BtnSale', 92, 7, '按钮_联盟_棕.xml com_rd(170,43)'],
        ['BtnTask', 92, 7, '按钮_联盟_棕.xml com_rd(170,43)'],
        ['BtnFight', 92, 7, '按钮_联盟_棕.xml com_rd(170,43)'],
        ['BtnDonate', 92, 8, '按钮_联盟_蓝.xml com_rd(170,42)'],
    ];
    const infos = prefab.filter((e) => e?.__type__ === 'cc.PrefabInfo' && (e.asset as { __uuid__?: string } | undefined)?.__uuid__);
    assert.equal(infos.length, 6, '六个入口各一颗红点实例');

    for (const [host, x, y, src] of EXPECT) {
        const hostNode = nodes.find((n) => n._name === host)!;
        assert.ok(hostNode, `找不到入口按钮 ${host}`);
        const kids = ((hostNode._children ?? []) as unknown[]).map(at);
        const shell = kids.find((c) => {
            const inst = at(at(c!._prefab)?.instance);
            // `propertyOverrides` 是 `{__id__}` 引用数组 ⇒ 必须逐条 `at()`
            const overs = (inst?.propertyOverrides ?? []) as unknown[];
            return overs.map(at).some((ov) => (ov?.propertyPath as unknown[])?.[0] === '_name' && ov!.value === 'RedDot');
        });
        assert.ok(shell, `${host} 下没有名为 RedDot 的嵌套实例`);
        const inst = at(at(shell!._prefab)!.instance)!;
        const ovOf = (k: string): unknown =>
            (inst.propertyOverrides as unknown[])
                .map(at).find((ov) => (ov?.propertyPath as unknown[])?.[0] === k)?.value;
        // ⚠️ `asset` 是**内联对象** `{__uuid__, __expectedType__}`，不是 `{__id__}` 引用
        // ⇒ 不能过 `at()`（会返 null）
        assert.equal((at(shell!._prefab)!.asset as { __uuid__: string }).__uuid__,
            '1ac30828-4947-4428-a114-b89c4e7d6494', `${host}/RedDot 应指向共用 RedDot.prefab`);
        const pos = ovOf('_lpos') as { x: number; y: number };
        assert.equal(pos.x, x, `${host}/RedDot 的 x（${src}）`);
        assert.equal(pos.y, y, `${host}/RedDot 的 y（${src}）`);
        // 源 prefab 的根是 `_active: true` ⇒ 不显式写 false 的话六个入口会默认全亮
        assert.equal(ovOf('_active'), false, `${host}/RedDot 盘上必须 _active=false`);
        assert.deepEqual([...(inst.mountedChildren as unknown[])], [], '不许把红点子树内联进来（onLoad 会崩）');
    }
});

// ============================================================
// D. 入口接线
// ============================================================

const leaguePrefabUuid = (JSON.parse(readFileSync(`${LEAGUE_PREFAB}.meta`, 'utf8')) as { uuid: string }).uuid;

/**
 * P3 起 `alliancePage` 指向的是**容器页** `LeagueTab`，不是大厅 `League`。
 *
 * 理由：联盟入口要先按「入没入盟」二选一（未入盟 ⇒ `LeagueJoin`），而 `MainTabHost`
 * 一个 tab 只能吃一个 `Prefab` ⇒ 由 `LeagueTabPage` 当壳、运行时再整页替换。
 * 容器页自己的 `joinedPage` / `joinPage` 两个绑定由 `league-join-create.test.ts` 的 E 段守。
 */
const leagueTabPrefabUuid = (JSON.parse(readFileSync('assets/resources/ui/League/LeagueTab.prefab.meta', 'utf8')) as { uuid: string }).uuid;

test('D1 LeaguePage.prefabPath 大小写正确，且磁盘上有这个 prefab', () => {
    const code = readFileSync(LEAGUE_PAGE_TS, 'utf8');
    assert.ok(code.includes("static prefabPath = 'ui/League/League'"), "prefabPath 必须是 'ui/League/League'");
    assert.ok(code.includes('extends Component'), 'tab 页是 Component，不是 PopupBase');
    // 真机 zip 内路径大小写敏感：目录名是 `League`（L 大写）
    assert.ok(existsSync('assets/resources/ui/League/League.prefab'));
    assert.ok(existsSync('assets/resources/ui/League.meta'), '目录 meta 缺失');
});

test('D2 MainTabHost 里有 alliancePage 字段，且 pagePrefab 真的返回它', () => {
    const code = readFileSync('assets/script/app/main/MainTabHost.ts', 'utf8');
    assert.ok(/@property\([^)]*Prefab[^)]*\)\s*alliancePage\s*:\s*Prefab/.test(code), '缺 alliancePage @property');
    assert.ok(
        code.includes('if (index === MainTab.Alliance) return this.alliancePage;'),
        'pagePrefab 没有处理 MainTab.Alliance ⇒ 点底部第 6 格会静默忽略',
    );
});

test('D3 ⚠️ MainRoot.prefab 上 alliancePage 真的绑到了联盟**容器页**（否则点了高亮不动）', () => {
    const mainRoot = JSON.parse(readFileSync('assets/resources/ui/main/MainRoot.prefab', 'utf8')) as Entry[];
    const comp = mainRoot.find((e) => e && e.alliancePage !== undefined);
    assert.ok(comp, 'MainRoot.prefab 里找不到带 alliancePage 的组件（主界面的 tab 宿主）');
    const ref = comp!.alliancePage as { __uuid__?: string };
    // P3 起必须指容器页：指大厅的话「未入盟」的玩家点进来会看到一张空白大厅（没有加入入口）
    assert.equal(ref.__uuid__, leagueTabPrefabUuid, `alliancePage 应指向容器页 LeagueTab（${leagueTabPrefabUuid}）`);
    assert.notEqual(ref.__uuid__, leaguePrefabUuid, 'alliancePage 不该再指向大厅 League（P3 起由 LeagueTab 兜）');
    // 另外两个已落地的 tab 也不能掉（顺带守一下别把别人的绑定改坏）
    assert.ok((comp!.arenaPage as { __uuid__?: string })?.__uuid__, 'arenaPage 掉绑了');
    assert.ok((comp!.rolePage as { __uuid__?: string })?.__uuid__, 'rolePage 掉绑了');
});

test('D4 LeaguePage 的 onLoad 真的接了入口 / 信息条 / 旗面（源码文本层守一遍）', () => {
    const code = readFileSync(LEAGUE_PAGE_TS, 'utf8');
    // ⚠️ P2 起签名是 `applyInfoTexts(union)`（要按快照渲染信息条）⇒ 这里只钉「调过」，
    //    不带括号，免得签名再变时又误报。
    for (const call of ['this.bindEntrances()', 'this.applyInfoTexts(', 'this.applyBannerColor(']) {
        assert.ok(code.includes(call), `onLoad 里应调用 ${call}`);
    }
    // 未落地的入口必须走「提示未开放」，不许静默吞掉
    assert.ok(code.includes('LEAGUE_TIP_NOT_OPEN'), '未落地入口必须提示，不许静默');
    assert.ok(code.includes('landed'), '必须按 entrance.landed 分流');
});

test('D5 ⚠️ LeaguePage 入口红点接线：收集 / 判据来源表 / setRedDot（源码文本层守一遍）', () => {
    const code = readFileSync(LEAGUE_PAGE_TS, 'utf8');
    // 收集：六个入口按钮下按名取红点节点
    assert.ok(code.includes("getChildByName(LEAGUE_ENTRANCE_RED_DOT)"), '必须在入口按钮下按名找红点节点');
    assert.ok(code.includes('this.entranceRedDots.set('), '必须把找到的红点节点收进 Map');
    // 判据：只认来源表里标了真判据的那几档（别退化成「有判据就全亮」）。
    // P5 起来源多了 `'task'` ⇒ 判定收敛进 `leagueEntranceRedDotOn(source, dots)` 纯函数，
    // 这里改为钉「applyEntranceRedDots 确实过那张表 + 那个映射函数」。
    assert.ok(code.includes('leagueEntranceRedDotOn(LEAGUE_ENTRANCE_RED_DOT_SOURCE[entrance.key]'), '必须按来源表判定');
    assert.ok(/function leagueEntranceRedDotOn\([\s\S]{0,400}case 'task': return dots\.task;/.test(code),
        'leagueEntranceRedDotOn 必须认 task 来源（P5 联盟任务入口红点）');
    // ⚠️ 必须走 `RedDot.setRedDot()`：`RedDot.onLoad` 会把 icon/spine/title 三个子节点压成 inactive，
    //    只写 `node.active` 会得到「根开着、子全关」⇒ 什么都看不见
    // 从**方法定义**（lastIndexOf，避开 refresh() 里的调用点）往后切
    const defAt = code.lastIndexOf('applyEntranceRedDots(');
    const apply = code.slice(defAt, defAt + 900);
    assert.ok(apply.includes('getComponent(RedDot)'), 'applyEntranceRedDots 里要取 RedDot 组件');
    assert.ok(apply.includes('setRedDot('), '必须用 setRedDot 而不是只翻 node.active');
    // refresh 必须一次性把「信息条 + 入口红点」取回来（共用同一个 revision）
    assert.ok(code.includes('this.repository.loadLeagueEntryRedDots()'), 'refresh 必须取入口红点');
    assert.ok(/Promise\.all\(\[[\s\S]{0,200}loadLeagueEntryRedDots\(\)/.test(code), '信息条与红点应 Promise.all 并发取');
});

test('D6 LeaguePage 入口分发：五个已落地面板各开一个 + default 兜底提示', () => {
    const code = readFileSync(LEAGUE_PAGE_TS, 'utf8');
    assert.ok(code.includes('switch (entrance.key)'), '入口分发应是 switch(entrance.key)');
    const PANELS: readonly [string, string][] = [
        ['LayerLeagueHall', 'LeagueHallPage'],
        ['LayerLeagueStore', 'LeagueStorePage'],
        ['LayerLeagueDiscount', 'LeagueDiscountPage'],
        ['LayerLeagueDonate', 'LeagueDonatePage'],
        ['LayerLeagueTask', 'LeagueTaskPage'],
    ];
    for (const [key, cls] of PANELS) {
        assert.ok(code.includes(`case '${key}':`), `缺 case '${key}':`);
        assert.ok(new RegExp(`case '${key}':[\\s\\S]{0,200}void ${cls}\\.open\\(`).test(code),
            `${key} 应分发到 ${cls}.open(`);
        assert.ok(new RegExp(`import[\\s\\S]{0,80}\\b${cls}\\b`).test(code), `缺 ${cls} 的 import`);
    }
    // 未落地那一条（联合战线 P6）必须落到 default 的「未开放」提示
    // （default 到提示之间隔着两行注释 + 一条 console.warn，故窗口放宽到 600 字）
    assert.ok(/default:[\s\S]{0,600}LEAGUE_TIP_NOT_OPEN/.test(code), 'default 分支必须提示未开放');
});

test('D7 LeagueRepository.loadLeagueEntryRedDots：接口 + 实现都在，且带「已入盟」这道闸', () => {
    const code = readFileSync('assets/script/app/league/LeagueRepository.ts', 'utf8');
    // 接口声明
    assert.ok(code.includes('loadLeagueEntryRedDots(): Promise<ILeagueEntryRedDots>'), '接口缺 loadLeagueEntryRedDots');
    // 实现：只读 gameConfig + CmdRoleUnion，**不**走 loadIconTables（避免白花图帧预载）
    const impl = code.slice(code.indexOf('async loadLeagueEntryRedDots('));
    const body = impl.slice(0, impl.indexOf('\n    }') + 6);
    assert.ok(!body.includes('loadIconTables('), '入口红点不能触发图帧预载（那是列表页的开销）');
    assert.ok(body.includes('parseLeagueP4Config('), '实现没读 gameConfig？');
    assert.ok(body.includes('this.myUnionId()'), '实现没读「我」的 unionId？');
    assert.ok(/const joined = .*unionId.*!==\s*'0'/.test(body), '缺「已入盟」这道闸（老端 RDLeague 第一句就 return 0）');
    assert.ok(body.includes('hasLeagueDiscountRedDot('), '判据应复用 LeagueTable.hasLeagueDiscountRedDot');
});

// ============================================================
// E. 文案表
// ============================================================

test('E1 文案常量（页面类里不出现中文字面量）', () => {
    assert.equal(LEAGUE_TIP_NOT_OPEN, '该功能尚未开放，敬请期待');
    assert.equal(LEAGUE_TIP_LOADING, '联盟数据加载中，请稍候');
    const page = readFileSync(LEAGUE_PAGE_TS, 'utf8');
    // 页面类里不允许出现这两条中文（必须从 LeagueTexts 取）
    assert.ok(!page.includes('该功能尚未开放'), '页面类里不要写死提示文案');
    assert.ok(!page.includes('联盟数据加载中'), '页面类里不要写死提示文案');
});
