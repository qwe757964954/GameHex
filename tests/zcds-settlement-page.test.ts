import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { assetPath } from './helpers/asset-paths';
import { calcMvpEffectiveArtHeight, ZC_SETTLEMENT_STYLE } from '../assets/script/app/zcds/model/ZCSettlementStyle';

/**
 * 对局结算页（`ZCSettlementPage` + `ZCSettlement.prefab`）的结构守卫。
 *
 * 蓝湖「结算-MVP」稿（720×1610）把面板重排成：标题套图 → MVP 卡片 → 段位行 → 通关奖励；
 * 旧稿的「变强途径」整组已下线（功能未接线，新稿也没有这一组）。
 *
 * 判据四层：
 *   ① 源码里不许退回「代码搭节点」、不许自己算坐标（几何归 prefab）；
 *   ② prefab 的树形、尺寸、相对几何逐项等于**下面手抄的设计稿量测表**；
 *   ③ 切图逐张对到 `image/settlement/<名>.png`，`sizeMode=CUSTOM` + `trim=false`；
 *   ④ 每个 `@property` 反解到正确类型；奖励格仍走公共 `RewardItem`。
 */
const pageSource = readFileSync('assets/script/app/zcds/ui/ZCSettlementPage.ts', 'utf8');
const styleSource = readFileSync('assets/script/app/zcds/model/ZCSettlementStyle.ts', 'utf8');
const actorSource = readFileSync('assets/script/app/zcds/view/ZCSettlementMvpActor.ts', 'utf8');
const gameSource = readFileSync('assets/script/app/zcds/ZCGame.ts', 'utf8');
const pageMeta = JSON.parse(readFileSync('assets/script/app/zcds/ui/ZCSettlementPage.ts.meta', 'utf8'));
const layoutMeta = JSON.parse(readFileSync('assets/script/app/zcds/view/ZCSettlementLayout.ts.meta', 'utf8'));
const goodsMeta = JSON.parse(readFileSync('assets/script/app/itemdetail/GoodsBox.ts.meta', 'utf8'));
const rewardItemViewMeta = JSON.parse(readFileSync('assets/script/app/common/RewardItemView.ts.meta', 'utf8'));
const prefabText = readFileSync('assets/bundles/battle/ui/game/ZCSettlement.prefab', 'utf8');
const objects: any[] = JSON.parse(prefabText);

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function cidOf(uuid: string): string {
    const hex = uuid.replace(/-/g, '');
    return hex.slice(0, 5) + Array.from({ length: 9 }, (_, i) => {
        const value = parseInt(hex.slice(5 + i * 3, 8 + i * 3), 16);
        return B64[value >> 6] + B64[value & 0x3f];
    }).join('');
}
function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * 设计稿量测表（蓝湖「结算-MVP」稿，画布 720×1610，切片 1:1）——**手抄**，别由 prefab 反推。
 * 面板中心设计 (361.5, 799.5) ⇒ 子节点 lpos = (设计x − 361.5, 799.5 − 设计y)，再减父中心。
 * 数值来自 `tmp/lanhu_settlement/grid_mvp.png`（50px 网格 2×）+ 像素扫描交叉确认。
 */
const DESIGN = {
    panel: { x: 1.5, y: 5.5, w: 671, h: 811 },
    titlePlate: { x: -1.5, y: 446.5, w: 678, h: 192 },
    titleText: { x: 10, y: -6, w: 346, h: 74 },
    // MVP 整组：本地 y 95..405（设计 y ≈ 394..705），覆盖 MVP 标识 / 头像 / 两条进度条
    mvpBlock: { x: 0, y: 250, w: 623, h: 310 },
    // 11-24 用户实机定案：徽标从「悬浮在角色头顶」改成「与 Lv/名字 同一行、贴区左沿」
    // （原稿 -46.5 / 132.5，Lv/名字 也跟着上移 23.5 到 y=83），坐标以 prefab 为准。
    mvpIcon: { x: -254, y: 85, w: 120, h: 40 },
    // 设计稿那里是 170×265 的立绘位：本局赢家输出最高卡的骨骼模型站在这里播 idle
    mvpActor: { x: -141.5, y: -7.5, w: 170, h: 265 },
    mvpLevel: { x: 70, y: 83 },
    mvpName: { x: 175, y: 83 },
    mvpDealtLabel: { x: 70.5, y: 32.5 },
    mvpDealtRate: { x: 235.5, y: 33.5 },
    mvpDealtBar: { x: 149.5, y: 4, w: 230, h: 27 },
    mvpDealtFill: { x: 0, y: 0, w: 222, h: 19 },
    mvpDealtValue: { x: 0, y: 0 },
    mvpTakenLabel: { x: 70.5, y: -37.5 },
    mvpTakenRate: { x: 235.5, y: -36.5 },
    mvpTakenBar: { x: 149.5, y: -65, w: 230, h: 27 },
    mvpTakenFill: { x: 0, y: 0, w: 222, h: 19 },
    mvpTakenValue: { x: 0, y: 0 },
    teamButton: { x: 151, y: -109, w: 160, h: 34 },
    // 段位行整体下移到 MVP 卡下方（本地 y −2.5..88.5），段位条换 420/412
    rankRow: { x: 1.5, y: 43, w: 550, h: 91 },
    rankIcon: { x: -214.5, y: 8.5, w: 93, h: 72 },
    rankBar: { x: 53, y: -2, w: 420, h: 29 },
    rankFill: { x: 0, y: 0, w: 412, h: 21 },
    rankName: { x: -93, y: 31.5, fs: 26, color: 'ffd028' },
    rankScore: { x: 47, y: -1.5 },
    rankAdd: { x: 227, y: 35.5, fs: 26, color: '57e467' },
    rankHint: { fs: 22 },
    // 通关奖励区块整体下移：框中心本地 −206（设计 y 1005.5），滚动视窗顶边 −42.5（设计 y 842）
    rewardSection: { x: 1, y: -187, w: 623, h: 365 },
    rewardBg: { x: -3.5, y: -19, w: 598, h: 327 },
    rewardTitle: { x: -2, y: 169 },
    // 视窗锚点被改成 (0.5,1)（虚拟列表的约定）⇒ `_lpos.y` 放的是**顶边**、比中心高半个视口。
    rewardScroll: { x: 0, y: 144.5, w: 623, h: 327 },
    btnDouble: { x: -153, y: -535, w: 218, h: 90 },
    btnConfirm: { x: 156, y: -536, w: 218, h: 90 },
};
/**
 * 奖励栅格 = **虚拟列表**（`VirtualScrollView`）：设计稿量到**列距 111 / 行距 114**、5 列、
 * 视口 623×327。
 */
const VGRID = { cols: 5, cell: 96, gridSpacing: 15, spacing: 18, header: 20, footer: 20, rows: 4 };
/** 公共奖励格 prefab（assetPath(`ui/common/RewardItem.prefab`)）的 uuid。 */
const REWARD_ITEM_UUID = '375dbd89-8396-4fe8-95e0-3871cf334c43';
const VSCROLL_CID = '544earF5qRLB4JTuTnSr11+';
/** Cocos **内置**的 2×2 白图（`default_sprite_splash`）—— 工程里所有全屏遮罩都用它染色。 */
const BUILTIN_SPLASH = '7d8f9b89-4fd1-4c9f-a3ab-38ec7cded7ca@f9941';
/** 全屏遮罩的染色值（与 `GMPanel` / `ServerSelectPanel` / `ZCGameRankBoard` 的 `Bg` 逐字相同）。 */
const DIM_RGBA = [0, 0, 0, 160];
/** `_layoutSlots`（纵向 + gridCount>1）的行内居中公式。 */
const slotX = (col: number): number => col * (VGRID.cell + VGRID.gridSpacing)
    - (VGRID.cols * VGRID.cell + (VGRID.cols - 1) * VGRID.gridSpacing) / 2 + VGRID.cell / 2;
/** 纵向落位公式：`y = −(headerSpacing + row*stride + itemMainSize/2)`（条目锚点 0.5）。 */
const slotY = (row: number): number => -(VGRID.header + row * (VGRID.cell + VGRID.spacing) + VGRID.cell / 2);
/** content 高度 = headerSpacing + 行数 × (格高 + 行距) − 行距 + footerSpacing（与组件同款）。 */
const REWARD_CONTENT_H = VGRID.header + VGRID.rows * (VGRID.cell + VGRID.spacing) - VGRID.spacing + VGRID.footer;

const ART = {
    'ZCSettlement/Panel': 'bg_01',
    'ZCSettlement/Panel/TitlePlate': 'JS_title_bg_01',
    'ZCSettlement/Panel/TitlePlate/TitleText': 'title_text_01',
    'ZCSettlement/Panel/MvpBlock/MvpIcon': 'icon_mvp',
    // MvpActor 是骨骼宿主（裸 Node，不挂 Sprite）—— 不在切图表里
    'ZCSettlement/Panel/MvpBlock/MvpDealtBar': 'progress_r_02',
    'ZCSettlement/Panel/MvpBlock/MvpDealtBar/MvpDealtFill': 'progress_r_01',
    'ZCSettlement/Panel/MvpBlock/MvpTakenBar': 'progress_b_02',
    'ZCSettlement/Panel/MvpBlock/MvpTakenBar/MvpTakenFill': 'progress_b_01',
    'ZCSettlement/Panel/RankRow/RankIcon': 'dw_icon_hj',
    'ZCSettlement/Panel/RankRow/RankBar': 'progress_02',
    'ZCSettlement/Panel/RankRow/RankBar/RankFill': 'progress_01',
    'ZCSettlement/Panel/RewardSection/RewardBg': 'frame',
    'ZCSettlement/Panel/RewardSection/RewardLineL': 'title_line',
    'ZCSettlement/Panel/RewardSection/RewardLineR': 'title_line',
    'ZCSettlement/BtnDouble': 'btn_02',
    'ZCSettlement/BtnConfirm': 'btn_01',
};
/** 结算切图目录之外的共用美术（旧的头像框已随骨骼立绘下线）。 */

const nodes = objects.filter((o) => o.__type__ === 'cc.Node');
const nodeNamed = (name: string, parentName?: string) => nodes.find((node) => {
    if (node._name !== name) return false;
    if (parentName === undefined) return node._parent === null;
    return objects[node._parent.__id__]._name === parentName;
});
const findPath = (path: string) => {
    const parts = path.split('/');
    let current = nodes.find((n) => n._name === parts[0] && n._parent === null);
    for (let i = 1; i < parts.length && current; i += 1) {
        current = nodes.find((n) => n._name === parts[i] && objects[n._parent.__id__] === current);
    }
    return current;
};
const componentOf = (node: any, type: string) =>
    node._components.map((ref: any) => objects[ref.__id__]).find((c: any) => c.__type__ === type);
const sizeOf = (node: any): [number, number] => {
    const t = componentOf(node, 'cc.UITransform');
    return [t._contentSize.width, t._contentSize.height];
};
const positionOf = (node: any): [number, number] => [node._lpos.x, node._lpos.y];
const childrenOf = (node: any): string[] => node._children.map((ref: any) => objects[ref.__id__]._name);
const frameOf = (art: string): string => frameUuid(art);
/** 面板底图 `bg_01` 留在 battle/image（跨页复用），其余结算切图在 settlement 下。*/
const frameUuid = (art: string): string => {
    const local = `assets/bundles/battle/image/settlement/${art}.png.meta`;
    const shared = `assets/bundles/battle/image/${art}.png.meta`;
    const path = existsSync(local) ? local : shared;
    return JSON.parse(readFileSync(path, 'utf8')).subMetas.f9941.uuid;
};

test('页面脚本不再自己建节点，坐标全归 prefab', () => {
    const code = stripComments(pageSource);
    assert.doesNotMatch(code, /new Node\(/);
    assert.doesNotMatch(code, /\.addComponent\(/);
    assert.doesNotMatch(code, /setPosition|setScale/, '位置/缩放归 prefab（规则 215）');
    assert.doesNotMatch(code, /getChildByName\(|getChildByPath\(/, '结构由 prefab 承载，不再按名找节点');
    for (const key of ['titlePlate', 'mvpGroup', 'mvpActor', 'teamButton', 'rankRow', 'rankFill', 'rewardList', 'confirmButton']) {
        assert.match(code, new RegExp(`this\\.${key}\\b`), `${key} 应当被直接使用`);
    }
    // 遮罩是纯 prefab 件（白块 Sprite + 染色 + 四边 Widget），代码一行都不该碰
    assert.doesNotMatch(code, /Graphics/, '遮罩不许改回 Graphics 手画（尺寸烘死，长屏上下露白）');
});

test('Dim 是全屏白块 Sprite + 染色 + 四边 Widget（工程通用遮罩，范本 GMPanel/Bg）', () => {
    const dim = nodeNamed('Dim', 'ZCSettlement')!;
    assert.ok(dim, '根下必须有 Dim');
    const sprite = componentOf(dim, 'cc.Sprite');
    assert.ok(sprite, 'Dim 必须是 cc.Sprite（白块 + 染色），不能是手画的 cc.Graphics');
    assert.equal(componentOf(dim, 'cc.Graphics'), undefined, 'Dim 上不许有 Graphics');
    assert.equal(sprite._spriteFrame.__uuid__, BUILTIN_SPLASH, 'Dim 用内置白图 default_sprite_splash');
    assert.deepEqual(
        [sprite._color.r, sprite._color.g, sprite._color.b, sprite._color.a],
        DIM_RGBA,
        'Dim 的染色 = 半透明黑（照抄其他页面）',
    );
    assert.equal(sprite._type, 0, 'SIMPLE 平铺，不做 FILLED');
    assert.equal(sprite._sizeMode, 0, 'CUSTOM：渲染区跟 UITransform 走，Widget 一拉就铺满');
    assert.equal(sprite._isTrimmedMode, false, '关掉裁剪模式');
    // 四边 Widget ⇒ 任意分辨率（720×1280 设计与 720×1610 长屏）都自动铺满
    const widget = componentOf(dim, 'cc.Widget')!;
    assert.equal(widget._alignFlags, 45, 'Dim 必须四边对齐（TOP|BOT|LEFT|RIGHT）');
    assert.ok(widget._left === 0 && widget._right === 0 && widget._top === 0 && widget._bottom === 0, '四边 inset 全 0');
});

test('全屏遮罩之外不许有人手画的 Graphics（唯一允许的是 Mask 自带的那个）', () => {
    for (const node of nodes) {
        const graphics = componentOf(node, 'cc.Graphics');
        if (!graphics) continue;
        assert.ok(componentOf(node, 'cc.Mask'), `${node._name} 上的 cc.Graphics 是手画的（遮罩请用白块 Sprite）`);
    }
});

test('ZCSettlement.prefab：树形、面板与标题几何按设计稿', () => {
    const root = nodeNamed('ZCSettlement')!;
    assert.deepEqual(childrenOf(root), ['Dim', 'Panel', 'BtnDouble', 'BtnConfirm'], '子节点顺序 = 渲染顺序');
    assert.deepEqual(sizeOf(root), [720, 1280]);

    const panel = nodeNamed('Panel', 'ZCSettlement')!;
    assert.deepEqual(sizeOf(panel), [DESIGN.panel.w, DESIGN.panel.h]);
    assert.deepEqual(positionOf(panel), [DESIGN.panel.x, DESIGN.panel.y]);
    // 新版面板：标题 → MVP → 段位 → 奖励（变强途径整组已下线）
    assert.deepEqual(childrenOf(panel), ['TitlePlate', 'MvpBlock', 'RankRow', 'RewardSection'], '面板子节点 = 新版四段');
    assert.equal(nodeNamed('Grow', 'Panel'), undefined, '旧稿的「变强途径」必须删干净');

    const plate = nodeNamed('TitlePlate', 'Panel')!;
    assert.deepEqual(sizeOf(plate), [DESIGN.titlePlate.w, DESIGN.titlePlate.h]);
    assert.deepEqual(positionOf(plate), [DESIGN.titlePlate.x, DESIGN.titlePlate.y]);
    const titleText = nodeNamed('TitleText', 'TitlePlate')!;
    assert.deepEqual(sizeOf(titleText), [DESIGN.titleText.w, DESIGN.titleText.h]);
    assert.deepEqual(positionOf(titleText), [DESIGN.titleText.x, DESIGN.titleText.y]);
});

test('ZCSettlement.prefab：MVP 卡片按设计稿（标识 / 骨骼立绘 / Lv+名字 / 两条进度条 / 查看完整队伍）', () => {
    const block = nodeNamed('MvpBlock', 'Panel')!;
    assert.deepEqual(sizeOf(block), [DESIGN.mvpBlock.w, DESIGN.mvpBlock.h]);
    assert.deepEqual(positionOf(block), [DESIGN.mvpBlock.x, DESIGN.mvpBlock.y]);
    assert.deepEqual(childrenOf(block), [
        'MvpActor', 'MvpIcon', 'MvpLevel', 'MvpName',
        'MvpDealtLabel', 'MvpDealtRate', 'MvpDealtBar',
        'MvpTakenLabel', 'MvpTakenRate', 'MvpTakenBar', 'TeamButton',
    ], 'MVP 区顺序 = 渲染顺序（骨骼模型在最底层，徽标/文案压在它上面）');

    for (const key of ['MvpActor', 'MvpIcon'] as const) {
        const node = nodeNamed(key, 'MvpBlock')!;
        const want = DESIGN[key === 'MvpIcon' ? 'mvpIcon' : 'mvpActor'];
        assert.deepEqual(sizeOf(node), [want.w, want.h], `${key} 尺寸`);
        assert.deepEqual(positionOf(node), [want.x, want.y], `${key} 位置`);
    }
    // 骨骼宿主是裸 Node：挂 Sprite 会在模型后面闪一块方图，也说明旧头像方案没删干净
    assert.equal(componentOf(nodeNamed('MvpActor', 'MvpBlock')!, 'cc.Sprite'), undefined, 'MvpActor 不许挂 Sprite');
    assert.equal(nodeNamed('MvpPortrait', 'MvpBlock'), undefined, '旧头像节点必须删干净');
    assert.equal(nodeNamed('MvpPortraitFrame', 'MvpBlock'), undefined, '旧头像框必须删干净');

    for (const key of ['MvpLevel', 'MvpName'] as const) {
        const node = nodeNamed(key, 'MvpBlock')!;
        assert.deepEqual(positionOf(node), [DESIGN[key === 'MvpLevel' ? 'mvpLevel' : 'mvpName'].x, DESIGN[key === 'MvpLevel' ? 'mvpLevel' : 'mvpName'].y], `${key} 位置`);
    }

    for (const [prefix, design] of [[
        'MvpDealt', { label: DESIGN.mvpDealtLabel, rate: DESIGN.mvpDealtRate, bar: DESIGN.mvpDealtBar, fill: DESIGN.mvpDealtFill, value: DESIGN.mvpDealtValue },
    ], [
        'MvpTaken', { label: DESIGN.mvpTakenLabel, rate: DESIGN.mvpTakenRate, bar: DESIGN.mvpTakenBar, fill: DESIGN.mvpTakenFill, value: DESIGN.mvpTakenValue },
    ]] as const) {
        const label = nodeNamed(`${prefix}Label`, 'MvpBlock')!;
        const rate = nodeNamed(`${prefix}Rate`, 'MvpBlock')!;
        const bar = nodeNamed(`${prefix}Bar`, 'MvpBlock')!;
        const fill = nodeNamed(`${prefix}Fill`, `${prefix}Bar`)!;
        const value = nodeNamed(`${prefix}Value`, `${prefix}Bar`)!;
        assert.deepEqual(positionOf(label), [design.label.x, design.label.y], `${prefix}Label 位置`);
        assert.deepEqual(positionOf(rate), [design.rate.x, design.rate.y], `${prefix}Rate 位置`);
        assert.deepEqual(sizeOf(bar), [design.bar.w, design.bar.h], `${prefix}Bar 尺寸`);
        assert.deepEqual(positionOf(bar), [design.bar.x, design.bar.y], `${prefix}Bar 位置`);
        assert.deepEqual(sizeOf(fill), [design.fill.w, design.fill.h], `${prefix}Fill 尺寸`);
        assert.deepEqual(positionOf(fill), [design.fill.x, design.fill.y], `${prefix}Fill 位置`);
        assert.deepEqual(positionOf(value), [design.value.x, design.value.y], `${prefix}Value 位置`);
        const fillSprite = componentOf(fill, 'cc.Sprite')!;
        assert.equal(fillSprite._type, 3, `${prefix}Fill 必须是 FILLED`);
        assert.equal(fillSprite._fillType, 0, `${prefix}Fill HORIZONTAL`);
        // 数值文本压在进度条上 ⇒ 必须在填充之后（同父下顺序 = 渲染顺序）
        assert.ok(childrenOf(bar).indexOf(`${prefix}Value`) > childrenOf(bar).indexOf(`${prefix}Fill`), '数值要盖在填充条上');
    }

    const team = nodeNamed('TeamButton', 'MvpBlock')!;
    assert.deepEqual(sizeOf(team), [DESIGN.teamButton.w, DESIGN.teamButton.h]);
    assert.deepEqual(positionOf(team), [DESIGN.teamButton.x, DESIGN.teamButton.y]);
    assert.ok(componentOf(team, 'cc.Button'), '查看完整队伍必须有 cc.Button');
    const teamLabel = componentOf(nodeNamed('TeamLabel', 'TeamButton')!, 'cc.Label')!;
    assert.equal(teamLabel._isUnderline, true, '「查看完整队伍」带下划线（设计稿是一行链接）');
    assert.equal(teamLabel._string, '查看完整队伍');
    assert.equal(teamLabel._fontSize, 24);
    assert.ok(sizeOf(nodeNamed('TeamLabel', 'TeamButton')!)[1] >= teamLabel._lineHeight, '框高不许小于行高（SHRINK 会缩字号）');
});

test('ZCSettlement.prefab：段位行与底部按钮按设计稿', () => {
    const rank = nodeNamed('RankRow', 'Panel')!;
    assert.deepEqual(sizeOf(rank), [DESIGN.rankRow.w, DESIGN.rankRow.h]);
    assert.deepEqual(positionOf(rank), [DESIGN.rankRow.x, DESIGN.rankRow.y]);
    assert.deepEqual(childrenOf(rank), ['RankIcon', 'RankName', 'RankBar', 'RankScore', 'RankAdd', 'RankHint']);

    const icon = nodeNamed('RankIcon', 'RankRow')!;
    assert.deepEqual(sizeOf(icon), [DESIGN.rankIcon.w, DESIGN.rankIcon.h]);
    assert.deepEqual(positionOf(icon), [DESIGN.rankIcon.x, DESIGN.rankIcon.y]);

    const bar = nodeNamed('RankBar', 'RankRow')!;
    assert.deepEqual(sizeOf(bar), [DESIGN.rankBar.w, DESIGN.rankBar.h]);
    assert.deepEqual(positionOf(bar), [DESIGN.rankBar.x, DESIGN.rankBar.y]);
    const fill = nodeNamed('RankFill', 'RankBar')!;
    assert.deepEqual(sizeOf(fill), [DESIGN.rankFill.w, DESIGN.rankFill.h]);
    assert.deepEqual(positionOf(fill), [DESIGN.rankFill.x, DESIGN.rankFill.y]);
    const fillSprite = componentOf(fill, 'cc.Sprite')!;
    assert.equal(fillSprite._type, 3, '段位条是 FILLED');
    assert.equal(fillSprite._fillType, 0, 'HORIZONTAL');
    // 全 prefab 只有 3 条 FILLED：段位条 + MVP 的总输出 / 总承伤
    assert.equal(objects.filter((o) => o.__type__ === 'cc.Sprite' && o._type === 3).length, 3);

    // 段位名金色、加分绿色（设计稿量到 rgb(255,208,40) / rgb(87,228,103)）
    const rankName = componentOf(nodeNamed('RankName', 'RankRow')!, 'cc.Label')!;
    assert.equal(rankName._fontSize, DESIGN.rankName.fs);
    assert.deepEqual(positionOf(nodeNamed('RankName', 'RankRow')!), [DESIGN.rankName.x, DESIGN.rankName.y]);
    assert.equal([rankName._color.r, rankName._color.g, rankName._color.b].map((v: number) => v.toString(16).padStart(2, '0')).join(''), DESIGN.rankName.color);
    const rankAdd = componentOf(nodeNamed('RankAdd', 'RankRow')!, 'cc.Label')!;
    assert.equal(rankAdd._fontSize, DESIGN.rankAdd.fs);
    assert.deepEqual(positionOf(nodeNamed('RankAdd', 'RankRow')!), [DESIGN.rankAdd.x, DESIGN.rankAdd.y]);
    assert.equal([rankAdd._color.r, rankAdd._color.g, rankAdd._color.b].map((v: number) => v.toString(16).padStart(2, '0')).join(''), DESIGN.rankAdd.color);
    assert.equal(componentOf(nodeNamed('RankHint', 'RankRow')!, 'cc.Label')!._fontSize, DESIGN.rankHint.fs);
    assert.deepEqual(positionOf(nodeNamed('RankScore', 'RankRow')!), [DESIGN.rankScore.x, DESIGN.rankScore.y]);

    for (const [name, want] of [['BtnDouble', DESIGN.btnDouble], ['BtnConfirm', DESIGN.btnConfirm]] as const) {
        const node = nodeNamed(name, 'ZCSettlement')!;
        assert.deepEqual(sizeOf(node), [want.w, want.h]);
        assert.deepEqual(positionOf(node), [want.x, want.y]);
        assert.ok(componentOf(node, 'cc.Button'), `${name} 必须有 cc.Button（CLICK 事件由它发）`);
    }
});

test('ZCSettlement.prefab：奖励区是虚拟列表（视窗挂 Mask + VirtualScrollView，content 只留模板）', () => {
    const section = nodeNamed('RewardSection', 'Panel')!;
    assert.deepEqual(sizeOf(section), [DESIGN.rewardSection.w, DESIGN.rewardSection.h]);
    assert.deepEqual(positionOf(section), [DESIGN.rewardSection.x, DESIGN.rewardSection.y]);
    const bg = nodeNamed('RewardBg', 'RewardSection')!;
    assert.deepEqual(sizeOf(bg), [DESIGN.rewardBg.w, DESIGN.rewardBg.h], '新稿的奖励框 598×327');
    assert.deepEqual(positionOf(bg), [DESIGN.rewardBg.x, DESIGN.rewardBg.y]);

    const scroll = nodeNamed('RewardScroll', 'RewardSection')!;
    assert.deepEqual(sizeOf(scroll), [DESIGN.rewardScroll.w, DESIGN.rewardScroll.h]);
    assert.ok(componentOf(scroll, 'cc.Mask'), '视口必须有 Mask（裁剪矩形 = 视窗 UITransform）');
    assert.equal(objects.filter((o) => o.__type__ === 'cc.ScrollView').length, 0, '不该再有 cc.ScrollView');

    const list = componentOf(scroll, VSCROLL_CID)!;
    assert.ok(list, '视口必须挂 VirtualScrollView');
    // 列表参数全在 prefab 里（代码只喂条数）：漏一项就是「排得不对、且不报错」
    assert.equal(list.useVirtualList, true);
    assert.equal(list.direction, 0, 'VERTICAL');
    assert.equal(list.itemCreationMode, 1, 'PREFAB：用公共奖励格 prefab 克隆');
    assert.equal(list.itemPrefab?.__uuid__, REWARD_ITEM_UUID, 'itemPrefab 必须指向 ui/common/RewardItem');
    assert.equal(list.itemNode, null, 'PREFAB 模式不许配 itemNode');
    assert.equal(list.gridCount, VGRID.cols);
    assert.equal(list.gridSpacing, VGRID.gridSpacing);
    assert.equal(list.spacing, VGRID.spacing);
    assert.equal(list.headerSpacing, VGRID.header);
    assert.equal(list.footerSpacing, VGRID.footer);
    assert.equal(list.pixelAlign, true);
    assert.equal(list.enableItemClickEffect, false, '奖励格不可点，别给假的按下反馈');
    assert.equal(list.interactive, true, '要滚就得接管触摸');

    const content = nodeNamed('content', 'RewardScroll')!;
    assert.equal(objects[list.content.__id__], content, 'content 必须显式绑（别依赖按名兜底）');
    assert.deepEqual(sizeOf(content), [DESIGN.rewardScroll.w, REWARD_CONTENT_H]);
    const contentTransform = componentOf(content, 'cc.UITransform')!;
    assert.deepEqual([contentTransform._anchorPoint.x, contentTransform._anchorPoint.y], [0.5, 1]);
    // 🔴 组件把 `content.position` **直接当滚动偏移**（`scrollToTop()` 会把它写成 0）⇒
    // content 的原点必须落在视窗上边缘，只能靠「视窗锚点 (0.5,1) + content lpos (0,0)」实现。
    const scrollTransform = componentOf(scroll, 'cc.UITransform')!;
    assert.deepEqual([scrollTransform._anchorPoint.x, scrollTransform._anchorPoint.y], [0.5, 1], '视窗锚点必须 (0.5,1)');
    assert.deepEqual(positionOf(content), [0, 0], 'content 的 lpos 必须 (0,0)（原点 = 视窗上边缘）');
    assert.deepEqual(positionOf(scroll), [DESIGN.rewardScroll.x, DESIGN.rewardScroll.y], '锚点改了，但视觉盒子不许动');

    assert.deepEqual(childrenOf(content), [], 'content 下不许有静态槽位（公共件是唯一来源）');
    assert.equal(nodeNamed('Slot', 'content'), undefined, '旧的 GoodsBox 静态槽位必须删干净');
});

test('虚拟列表落位公式与设计稿一致（列距 111 / 行距 114）', () => {
    assert.equal(slotX(1) - slotX(0), VGRID.cell + VGRID.gridSpacing, '列距 111 = 格宽 96 + 列距 15');
    assert.equal(slotY(1) - slotY(0), -(VGRID.cell + VGRID.spacing), '行距 114 = 格高 96 + 行距 18');
    assert.deepEqual([slotX(0), slotX(2), slotX(4)], [-222, 0, 222]);
    assert.deepEqual([slotY(0), slotY(1), slotY(2), slotY(3)], [-68, -182, -296, -410]);
});

test('奖励格用公共 RewardItem（不自带 GoodsBox / 静态槽位）', () => {
    const goodsCid = cidOf(goodsMeta.uuid);
    assert.equal(
        objects.filter((o) => o.__type__ === goodsCid).length, 0,
        '结算页 prefab 里不许再挂 GoodsBox（奖励格统一走公共 RewardItem）',
    );
    const rewardItem = JSON.parse(readFileSync(assetPath('ui/common/RewardItem.prefab'), 'utf8')) as any[];
    const rewardItemView = rewardItem.find((o) => o.__type__ === cidOf(rewardItemViewMeta.uuid));
    assert.ok(rewardItemView, '公共 RewardItem 必须挂 RewardItemView');
    for (const prop of ['frame', 'icon', 'num', 'rate']) {
        assert.ok(rewardItemView[prop]?.__id__ !== undefined, `公共 RewardItem 的 ${prop} 未绑定`);
    }
    assert.match(pageSource, /import \{ RewardItemView, type IRewardItemData \} from '\.\.\/\.\.\/common\/RewardItemView'/);
    assert.match(pageSource, /node\.getComponent\(RewardItemView\)\.render\(this\.rewards\[index\]\)/);
    assert.doesNotMatch(pageSource, /GoodsBox/, '结算页不再使用 GoodsBox');
    assert.doesNotMatch(pageSource, /itemNumberTextOf/);
});

test('品质框/图标是运行时换图 ⇒ prefab 里出厂留空（不能是 `{}` 空对象）', () => {
    // `{}` 空对象既不是 `null` 也不是 `SpriteFrame` ⇒ 引擎 `Sprite._calculateUV` 读 `uv[0]` 抛错
    assert.doesNotMatch(prefabText, /"_spriteFrame":\s*\{\s*\}/);
    // MVP 立绘位是骨骼宿主，不放任何静态 SpriteFrame（模型由 `ZCSettlementMvpActor` 运行时挂）
    assert.equal(componentOf(nodeNamed('MvpActor', 'MvpBlock')!, 'cc.Sprite'), undefined);
});

test('切图逐张指到 image/settlement（sizeMode=CUSTOM + trim=false + 深底文案带描边）', () => {
    for (const [path, art] of Object.entries(ART)) {
        const node = findPath(path);
        assert.ok(node, `${path} 不存在`);
        const sprite = componentOf(node, 'cc.Sprite');
        assert.ok(sprite, `${path} 上应当有 cc.Sprite`);
        assert.equal(sprite._spriteFrame.__uuid__, frameOf(art), `${path} 的图应当是 ${art}.png`);
        assert.equal(sprite._sizeMode, 0, `${path} sizeMode 必须 CUSTOM`);
        assert.equal(sprite._isTrimmedMode, false, `${path} 必须关掉裁剪模式`);
    }
    // 头像框随骨骼立绘下线：立绘位由 MvpActor 运行时挂模型，不引用任何预制方图
    // 右侧那两条装饰线是镜像的（设计稿右侧是形状，用同一张图翻过来）
    for (const path of ['ZCSettlement/Panel/RewardSection/RewardLineR']) {
        assert.deepEqual([findPath(path)!._lscale.x, findPath(path)!._lscale.y], [-1, 1], `${path} 应当镜像`);
    }
    for (const node of nodes) {
        const label = componentOf(node, 'cc.Label');
        if (!label) continue;
        assert.equal(label._enableOutline, true, `${node._name} 文案缺描边（面板是深底）`);
        assert.ok(label._outlineWidth >= 2, `${node._name} 描边宽度`);
    }
    assert.match(styleSource, /settlement\/JS_title_bg_01/);
    assert.match(styleSource, /settlement\/JS_title_02/, '失败态标题套图');
});

test('设计稿的静态文案烘在 prefab 里（运行时没人写它们）', () => {
    const texts = objects.filter((o) => o?.__type__ === 'cc.Label').map((o) => o._string);
    for (const want of ['通关奖励', '双倍奖励', '确定', '总输出', '总承伤', '查看完整队伍']) {
        assert.ok(texts.includes(want), `静态文案缺失：${want}`);
    }
});

test('样式 token 与 prefab / 布局组件一致', () => {
    const level = componentOf(nodeNamed('MvpLevel', 'MvpBlock')!, 'cc.Label');
    assert.equal(level._fontSize, ZC_SETTLEMENT_STYLE.fonts.mvpLevel.size);
    assert.equal(level._lineHeight, ZC_SETTLEMENT_STYLE.fonts.mvpLevel.line);
    for (const name of ['MvpDealtRate', 'MvpTakenRate']) {
        const rate = componentOf(nodeNamed(name, 'MvpBlock')!, 'cc.Label');
        assert.equal(rate._fontSize, ZC_SETTLEMENT_STYLE.fonts.mvpStatRate.size, `${name} 字号`);
        assert.equal(rate._lineHeight, ZC_SETTLEMENT_STYLE.fonts.mvpStatRate.line, `${name} 行高`);
    }
    for (const [name, parent] of [['MvpDealtValue', 'MvpDealtBar'], ['MvpTakenValue', 'MvpTakenBar']] as const) {
        const value = componentOf(nodeNamed(name, parent)!, 'cc.Label');
        assert.equal(value._fontSize, ZC_SETTLEMENT_STYLE.fonts.mvpStatValue.size, `${name} 字号`);
        assert.equal(value._lineHeight, ZC_SETTLEMENT_STYLE.fonts.mvpStatValue.line, `${name} 行高`);
    }
    const team = componentOf(nodeNamed('TeamLabel', 'TeamButton')!, 'cc.Label');
    assert.equal(team._isBold, true, '队伍链接按设计稿加粗');
    assert.equal(team._outlineWidth, 4, '队伍链接描边');

    const layout = objects.find((o) => o.__type__ === cidOf(layoutMeta.uuid));
    assert.ok(layout, 'prefab 根节点应挂 ZCSettlementLayout');
    assert.equal(objects[layout.rankRow.__id__]._name, 'RankRow');
    assert.equal(objects[layout.rewardSection.__id__]._name, 'RewardSection');
    assert.equal(layout.rankRewardGap, ZC_SETTLEMENT_STYLE.layout.rankRewardGap);
    assert.match(pageSource, /this\.layout\?\.apply\(hasRank\)/, '段位行显隐后由布局组件补位');
});

test('prefabInfo / fileId / layer 形态正确', () => {
    const rootIndex = objects[0].data.__id__;
    assert.equal(rootIndex, objects.findIndex((o) => o?.__type__ === 'cc.Node'));
    for (const node of nodes) {
        assert.equal(node._layer, 33554432, `${node._name} layer 必须是 UI_2D`);
        const info = objects[node._prefab.__id__];
        assert.equal(info.asset.__id__, 0);
        assert.equal(info.root.__id__, rootIndex);
    }
    const fileIds = objects.filter((o) => typeof o?.fileId === 'string').map((o) => o.fileId);
    for (const id of fileIds) assert.equal(id.length, 22);
    assert.equal(new Set(fileIds).size, fileIds.length);
    for (const [index, object] of objects.entries()) {
        const keys = Object.keys(object).filter((k) => k !== '__id__');
        if (keys.length > 0) assert.equal(typeof object.__type__, 'string', `#${index} 缺 __type__`);
    }
});

test('脚本 23 个 @property 全部绑到正确类型的对象', () => {
    const cid = cidOf(pageMeta.uuid);
    const script = objects.find((o) => o.__type__ === cid);
    assert.ok(script, `prefab 里应当挂 ${cid}（ZCSettlementPage）`);
    const expected: Record<string, string> = {
        titlePlate: 'cc.Sprite',
        titleText: 'cc.Sprite',
        mvpGroup: 'cc.Node',
        mvpActor: 'cc.Node',
        mvpLevel: 'cc.Label',
        mvpName: 'cc.Label',
        mvpDealtRate: 'cc.Label',
        mvpDealtValue: 'cc.Label',
        mvpDealtFill: 'cc.Sprite',
        mvpTakenRate: 'cc.Label',
        mvpTakenValue: 'cc.Label',
        mvpTakenFill: 'cc.Sprite',
        teamButton: 'cc.Button',
        rankRow: 'cc.Node',
        rankIcon: 'cc.Sprite',
        rankName: 'cc.Label',
        rankFill: 'cc.Sprite',
        rankScore: 'cc.Label',
        rankAdd: 'cc.Label',
        rankHint: 'cc.Label',
        rewardList: VSCROLL_CID,
        doubleButton: 'cc.Button',
        confirmButton: 'cc.Button',
    };
    assert.equal(Object.keys(expected).length, 23, '属性数量变了要同步这张表（漏一个 = 有属性没人绑）');
    for (const [prop, type] of Object.entries(expected)) {
        assert.ok(script[prop]?.__id__ !== undefined, `${prop} 未绑定`);
        assert.equal(objects[script[prop].__id__].__type__, type, `${prop} 应指向 ${type}`);
    }
    // MVP 整组必须真的是 `Panel/MvpBlock`（绑成 Panel 会把整个面板收起 = 页面全空）
    assert.equal(nodeNamed('MvpBlock', 'Panel')!._id, objects[script.mvpGroup.__id__]._id);
    // 旧「变强途径」四个属性与事件一并下线
    for (const prop of ['growGroup', 'entryEquip', 'entryHero', 'entryRune']) {
        assert.equal(script[prop], undefined, `${prop} 应当已删除`);
    }
    // 🔴 prefab 上就把 `closeOnBlank` 烘成 false：结算页一关，`openSettlement` 置死的
    // `settlementOpened` 就让它再也弹不出来 ⇒ 关页 = 卡死。
    assert.equal(script.closeOnBlank, false, 'prefab 上不许把空白关闭开着');
    assert.equal(script.rewardSlots, undefined, 'rewardSlots 数组属性应当已删除');
    assert.equal(script.rewardContent, undefined, 'rewardContent 应当已删除');
    assert.equal(script.dim, undefined, 'dim 属性应当已删除');
    // 段位行整组收起的口径：`rankRow` 是容器节点，段位元素全在它下面
    const rankRowId = script.rankRow.__id__;
    for (const prop of ['rankIcon', 'rankName', 'rankFill', 'rankScore', 'rankAdd', 'rankHint']) {
        let node = objects[script[prop].__id__];
        node = node.__type__ === 'cc.Node' ? node : objects[node.node.__id__];
        let parent = objects[node._parent.__id__];
        const chain: string[] = [];
        while (parent) { chain.push(parent._name); if (parent.__id__ === rankRowId) break; parent = parent._parent ? objects[parent._parent.__id__] : null; }
        assert.ok(chain.length > 1, `${prop} 应当挂在 RankRow 下（实测链：${chain.join('<')}）`);
    }
    // MVP 的 11 个引用都挂在 MvpBlock 下（整组收起时一起消失）
    const blockId = script.mvpGroup.__id__;
    for (const prop of ['mvpActor', 'mvpLevel', 'mvpName', 'mvpDealtRate', 'mvpDealtValue',
        'mvpDealtFill', 'mvpTakenRate', 'mvpTakenValue', 'mvpTakenFill', 'teamButton']) {
        let node = objects[script[prop].__id__];
        node = node.__type__ === 'cc.Node' ? node : objects[node.node.__id__];
        let parent = objects[node._parent.__id__];
        const chain: string[] = [];
        while (parent) { chain.push(parent._name); if (parent.__id__ === blockId) break; parent = parent._parent ? objects[parent._parent.__id__] : null; }
        assert.ok(chain.length > 0, `${prop} 应当挂在 MvpBlock 下（实测链：${chain.join('<')}）`);
    }
});

test('页面逻辑：整组显隐 / 虚拟列表喂条数 + 按下标现取 / 标题图随本次打开取消', () => {
    const code = stripComments(pageSource);
    // 段位：没数据整组收起（别留一行空框）
    assert.match(code, /this\.rankRow\.active = hasRank/);
    // 奖励：**只喂条数**，格内容在 renderItemFn 里按下标现取
    assert.match(code, /this\.rewardList\.renderItemFn = this\.renderReward\.bind\(this\)/,
        '回调只在 onInit 接一次（槽位复用，重复接会越滚越多）');
    assert.match(code, /this\.rewards = rewards/);
    assert.match(code, /this\.rewardList\.setTotalCount\(rewards\.length\)/);
    assert.match(code, /node\.getComponent\(RewardItemView\)\.render\(this\.rewards\[index\]\)/,
        '按下标现取本趟数据');
    assert.match(code, /this\.rewardList\.scrollToTop\(false\)/);
    assert.doesNotMatch(code, /renderItemFn = \(node, index\) => \{[^}]*rewards\[/,
        'renderItemFn 只准读 this.rewards，不许闭包捕获入参 rewards');
    assert.match(code, /this\.applyTitle\(userData\.victory \? 'victory' : 'defeat', context\)/);
    assert.match(code, /await Promise\.all\(\[[\s\S]+?\]\);\s*if \(!this\.isValid \|\| context\.cancelled\) return;/);
    // 遮罩是纯 prefab 件：代码里既不该画它、也不该读它的尺寸
    assert.doesNotMatch(code, /this\.dim/, '代码不该再持有 dim');
    assert.doesNotMatch(code, /\.rect\(/, '遮罩不许用 Graphics 画矩形');
    assert.match(code, /protected onInit\(\)/);
    assert.match(code, /Button\.EventType\.CLICK/);
});

test('MVP 卡片：整组按数据显隐，两条进度按模型口径，骨骼模型加载随本次打开取消', () => {
    const code = stripComments(pageSource);
    assert.match(code, /this\.renderMvp\(userData\.mvp \?\? null, context\)/);
    // 没数据 ⇒ 整组收起 + 清掉上一局的模型（别留别人的兵）
    assert.match(code, /this\.mvpGroup\.active = Boolean\(mvp\)/);
    assert.match(code, /this\.mvpPreview\?\.clear\(\)/);
    // 文案与进度**只用模型给的**，页面不自己算百分比 / 缩写
    for (const field of ['levelText', 'name', 'dealtRateText', 'dealtText', 'takenRateText', 'takenText']) {
        assert.match(code, new RegExp(`mvp\\.${field}`), `MVP 的 ${field} 应当由模型提供`);
    }
    assert.match(code, /this\.mvpDealtFill\.fillRange = mvp\.dealtRate/);
    assert.match(code, /this\.mvpTakenFill\.fillRange = mvp\.takenRate/);
    assert.doesNotMatch(code, /Math\.round\(\s*mvp|mvp\.damage|mvp\.damageTaken/, '页面不许回算伤害');
    // 等级只有服务端英雄数据才有 ⇒ 空串时收起，而不是留一个「Lv.」空标签
    assert.match(code, /this\.mvpLevel\.node\.active = Boolean\(mvp\.levelText\)/);
    // 骨骼：prefabPath → 对局同一份兵种 prefab → MvpActor 播 idle。
    assert.match(code, /this\.mvpActor\.active = Boolean\(mvp\.prefabPath\)/);
    assert.match(code, /this\.assets\.load\(mvp\.prefabPath, Prefab, \{/);
    assert.match(code, /bundle: bundleForPath\(mvp\.prefabPath\)/);
    assert.match(code, /await this\.assets\.load\([^;]+\);\s*if \(!this\.isValid \|\| context\.cancelled \|\| scope\.disposed\) return;/);
    assert.match(code, /scope\.disposed/, '资源作用域销毁后不许再挂模型');
    assert.match(code, /void this\.applyMvpActor\(mvp, context\)/);
    assert.match(code, /new ZCSettlementMvpActor\(this\.mvpActor\)/);
    assert.doesNotMatch(code, /HeadArt|createIconLoader|touxiang_03/, '旧的头像方案必须删干净');
});

test('🔴 确定按钮：派发 Confirm 事件、不退化成 close、且防重复提交', () => {
    const code = stripComments(pageSource);
    assert.match(code, /EventMgr\.instance\.emit\(ZCGameUiEvent\.SettlementConfirm\);/, '确定必须派发 ZCGameUiEvent.SettlementConfirm');
    assert.doesNotMatch(code, /userData\.events/, '不再往 userData 塞总线');
    assert.doesNotMatch(code, /EventBus/, '页面不该持有总线实例');
    assert.doesNotMatch(code, /onConfirm\b/, '页面不该再持有收尾回调 —— 意图一律走事件');
    assert.doesNotMatch(code, /this\.close\(/, '确定不许退化成只 close()');
    assert.match(code, /private confirming = false/);
    assert.match(code, /if \(this\.confirming\) return;/);
    assert.match(code, /this\.confirming = true;/);
    assert.match(code, /this\.confirming = false;\s*this\.renderMvp/, '每次 onOpen 必须复位，否则第二局点不动');
    assert.match(code, /protected canCloseOnBlank\(\): boolean \{\s*return false;\s*\}/,
        '结算页必须覆写 canCloseOnBlank 返回 false');
});

test('双倍奖励常显按接线置灰；「查看完整队伍」走结算自己的事件', () => {
    const code = stripComments(pageSource);
    assert.match(code, /private renderEntryGroups\(data: IZCSettlementOptions\)/);
    assert.match(code, /this\.doubleButton\.node\.active = true;/, '双倍奖励按钮必须常显');
    assert.match(code, /this\.doubleButton\.interactable = Boolean\(data\.hasDoubleReward\)/,
        '★没接线 ⇒ 不可点（展示位，不是假交互）');
    assert.match(code, /this\.renderEntryGroups\(userData\);/, 'onOpen 必须调它，否则 prefab 的默认 active 会一直露着');
    // 「查看完整队伍」：结算期运行期入口已被 isSettled 拦掉 ⇒ 必须派结算自己的事件
    assert.match(code, /EventMgr\.instance\.emit\(ZCGameUiEvent\.SettlementViewTeam\)/);
    assert.doesNotMatch(code, /ZCGameUiEvent\.OpenDamageStats/, '页面不许直接借运行期入口（结算期它会 return');
    assert.match(code, /teamButton\.node\.on\(Button\.EventType\.CLICK, this\.onViewTeamClicked, this\)/);
    assert.match(code, /confirmButton\.node\.on\(Button\.EventType\.CLICK, this\.onConfirmClicked, this\)/);
    assert.doesNotMatch(code, /Button\.EventType\.CLICK, \(\) =>/, '按钮监听不许再用箭头闭包');
});

test('双倍按钮的显隐 / 置灰全量刷新（战败胜利同一口径）', () => {
    const exports: Record<string, any> = {};
    runInNewContext(ts.transpileModule(pageSource, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText, {
        exports,
        require(name: string) {
            if (name === 'cc') return { _decorator: { ccclass: () => () => {}, property: () => () => {} } };
            if (name.endsWith('/PopupBase')) return { PopupBase: class {} };
            return {};
        },
    });
    const page = new exports.ZCSettlementPage();
    page.doubleButton = { node: { active: false }, interactable: true };
    for (const victory of [false, true, false, true]) {
        for (const hasDoubleReward of [undefined, false, true]) {
            page.renderEntryGroups({ victory, hasDoubleReward });
            assert.equal(page.doubleButton.node.active, true);
            assert.equal(page.doubleButton.interactable, hasDoubleReward === true, `victory=${victory}`);
        }
    }
});

test('三个按钮只 emit 意图事件，页面不持有任何回调（视图不认识流程）', () => {
    const code = stripComments(pageSource);
    assert.match(code, /EventMgr\.instance\.emit\(ZCGameUiEvent\.SettlementDoubleReward\)/);
    assert.match(code, /EventMgr\.instance\.emit\(ZCGameUiEvent\.SettlementViewTeam\)/);
    assert.doesNotMatch(code, /SettlementGrowEntry|emitGrowEntry/, '变强途径入口已随新稿下线');
    assert.doesNotMatch(code, /this\.options\?\.on/, '页面不许持有回调');
    assert.doesNotMatch(code, /onDoubleReward\?:|onTeam\?:|onGrowEntry\?:/, 'userData 只留数据字段，不留回调字段');
    assert.doesNotMatch(code, /private options: IZCSettlementOptions/, '留一份 userData 没意义 —— 意图全派发出去了');
});

test('外部战斗控制器装配结算页与伤害统计，ZCGame 只保留展示', () => {
    const composition = readFileSync('assets/script/app/bootstrap/battle/BattleComposition.ts', 'utf8');
    const runtime = readFileSync('assets/script/app/zcds/application/ZCBattleRuntimeController.ts', 'utf8');
    const settlement = readFileSync('assets/script/app/zcds/application/ZCBattleSettlementController.ts', 'utf8');
    assert.match(composition, /ZCSettlementPage\.open\(\{/);
    assert.match(composition, /GameRunAway\.open\(\{/);
    assert.match(runtime, /localVictory: !retreated && model\.snapshot\.status === 'victory'/);
    assert.match(runtime, /this\.listen\(ZCGameUiEvent\.SettlementConfirm, this\.onSettlementConfirm\)/);
    assert.match(runtime, /this\.settlement\.confirm\(\)/);
    // 「查看完整队伍」的数据在结算开始时就冻结进请求（结算期不回读模型）
    assert.match(runtime, /mvp: this\.settlementMvp\(\)/);
    assert.match(runtime, /units: this\.damageUnits\(\), seats: this\.damageSeats\(\)/);
    assert.match(settlement, /this\.listen\(ZCGameUiEvent\.SettlementViewTeam, this\.onViewTeam\)/);
    assert.match(settlement, /this\.services\.popup\.openDamage\(this\.units, this\.seats\)/);
    assert.match(settlement, /mvp: request\.mvp \?\? null/);
    const close = settlement.indexOf("popup?.close('manual');");
    assert.ok(close >= 0 && close < settlement.indexOf('emit(ZC_BATTLE_EVENTS.RETURN_TO_MAIN'));
    assert.doesNotMatch(stripComments(gameSource), /ZCSettlementPage|finishBattle|ProcedureManager|settlementPopup/);
    assert.match(pageSource, /static prefabPath = 'ui\/game\/ZCSettlement'/);
    assert.match(pageSource, /export class ZCSettlementPage extends PopupBase/);
});

test('MVP 徽标 / Lv / 名字的坐标只认 prefab：立绘代码不许改写，徽标与文案同一行', () => {
    const icon = nodeNamed('MvpIcon', 'MvpBlock')!;
    const level = nodeNamed('MvpLevel', 'MvpBlock')!;
    const name = nodeNamed('MvpName', 'MvpBlock')!;
    const [iconX, iconY] = positionOf(icon);
    const [levelX, levelY] = positionOf(level);
    const [nameX, nameY] = positionOf(name);
    const span = (node: any) => sizeOf(node)[0] / 2;

    // 同一行：徽标(40 高) 与两个 38 高的 Label 中心最多差 2px（视觉上共基线）
    assert.ok(Math.abs(iconY - levelY) <= 2, `徽标 y=${iconY} 与 Lv y=${levelY} 必须同一行`);
    assert.ok(Math.abs(levelY - nameY) <= 2, `Lv y=${levelY} 与名字 y=${nameY} 必须同一行`);
    // 左 → 右：徽标 → Lv → 名字，且徽标右沿不压 Lv 左沿
    assert.ok(iconX < levelX && levelX < nameX, `x 必须递增：徽标 ${iconX} < Lv ${levelX} < 名字 ${nameX}`);
    assert.ok(iconX + span(icon) <= levelX - span(level), '徽标右沿不得压住 Lv 文案');

    // 立绘只摆模型：`ZCSettlementMvpActor` 里出现 `MvpIcon` 就是在改 prefab 坐标 ⇒ 实机必然错位
    const actor = stripComments(actorSource);
    assert.doesNotMatch(actor, /MvpIcon/, 'MvpActor 不许碰徽标节点，坐标归 prefab');
    // 头顶上限只管立绘收敛，不再兼职推徽标
    assert.equal(ZC_SETTLEMENT_STYLE.mvpArt.maxHeadTopInBlock, 91);
    assert.doesNotMatch(styleSource, /calcMvpAdaptiveBadgeY|mvpBadge/, '自适应推徽标那套 token 必须删干净');

    const footInBlock = -140; // MvpActor.y(-7.5) + 底边(-132.5)
    assert.equal(
        calcMvpEffectiveArtHeight(317.8, footInBlock),
        ZC_SETTLEMENT_STYLE.mvpArt.maxHeadTopInBlock - footInBlock,
        '超高角色立绘必须收敛到头顶 91，别顶进上方飘带',
    );
});
