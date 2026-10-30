import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assetPath } from './helpers/asset-paths';

/**
 * 对局结算页（`ZCSettlementPage` + `ZCSettlement.prefab`）的结构守卫。
 *
 * 蓝湖「结算-胜利」/「结算-失败」两张稿：同一骨架，只有标题套图不同。
 * 奖励格复用物品详情那套 `GoodsBox`（品质框 `cu_quality_*` + 道具图标 + 数量）。
 *
 * 判据四层：
 *   ① 源码里不许退回「代码搭节点」、不许自己算坐标（几何归 prefab 生成器）；
 *   ② prefab 的树形、尺寸、相对几何逐项等于**下面手抄的设计稿量测表**；
 *   ③ 16 张切图逐张对到 `image/settlement/<名>.png`，`sizeMode=CUSTOM` + `trim=false`；
 *   ④ 每个 `@property` 反解到正确类型；20 个奖励格的三件套与 `GoodsBox` 绑定齐全。
 */
const pageSource = readFileSync('assets/script/app/zcds/ui/ZCSettlementPage.ts', 'utf8');
const gameSource = readFileSync('assets/script/app/zcds/ZCGame.ts', 'utf8');
const pageMeta = JSON.parse(readFileSync('assets/script/app/zcds/ui/ZCSettlementPage.ts.meta', 'utf8'));
const goodsMeta = JSON.parse(readFileSync('assets/script/app/itemdetail/GoodsBox.ts.meta', 'utf8'));
const rewardItemViewMeta = JSON.parse(readFileSync('assets/script/app/common/RewardItemView.ts.meta', 'utf8'));
//  prefab / 切图都随 battle 分包搬到了 `assets/bundles/battle/` 下（判据原先读 `assets/resources/`，
//  整份文件在模块顶层就 ENOENT 崩掉，30+ 条一条都跑不到）。
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
 * 设计稿量测表（蓝湖「结算-胜利」稿，画布 720×1610，切片 1:1）——**手抄**，别由 prefab 反推。
 * cocosX = 设计x + 设计w/2 − 360；cocosY = 805 − (设计y + 设计h/2)；子树坐标再减父中心。
 */
const DESIGN = {
    panel: { x: 1.5, y: 5.5, w: 671, h: 811 },
    titlePlate: { x: -1.5, y: 446.5, w: 678, h: 192 },
    titleText: { x: 10, y: -6, w: 346, h: 74 },
    rankRow: { x: 1.5, y: 287, w: 550, h: 91 },
    rankIcon: { x: -228.5, y: 8.5, w: 93, h: 72 },
    rankBar: { x: 8.5, y: 3, w: 369, h: 29 },
    rankFill: { x: 0, y: 0, w: 361, h: 21 },
    rankName: { fs: 26, color: 'ffd028' },
    rankAdd: { fs: 26, color: '57e467' },
    rankHint: { fs: 22 },
    rewardTitle: { fs: 28 },
    // 变强途径整段（设计稿 bg_02 在 (51,1021) 623×131，段容器 (51,982) 623×170）
    grow: { x: 51, y: 982, w: 623, h: 170 },
    // 视窗锚点被改成 (0.5,1)（虚拟列表的约定）⇒ `_lpos.y` 放的是**顶边**、比中心高半个视口。
    rewardScroll: { x: 0, y: -19 + 327 / 2, w: 623, h: 327 },
    btnDouble: { x: -153, y: -535, w: 218, h: 90 },
    btnConfirm: { x: 156, y: -536, w: 218, h: 90 },
};
/**
 * 奖励栅格 = **虚拟列表**（`VirtualScrollView`）：设计稿量到**列距 111 / 行距 114**、5 列、
 * 视口 623×327。
 *
 * ⚠️ **格子尺寸 = 公共奖励格 `ui/common/RewardItem.prefab` 的 96×96**（不是原稿的 100×100）——
 * 奖励格统一走公共件后，格宽由公共件决定；**间距按设计稿反推补偿**：
 * `gridSpacing = 111 − 96 = 15`、`spacing = 114 − 96 = 18` ⇒ **落位与原稿逐值相同**。
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
    'ZCSettlement/Panel/RankRow/RankIcon': 'dw_icon_hj',
    'ZCSettlement/Panel/RankRow/RankBar': 'progress_02',
    'ZCSettlement/Panel/RankRow/RankBar/RankFill': 'progress_01',
    'ZCSettlement/Panel/RewardSection/RewardLineL': 'title_line',
    'ZCSettlement/Panel/RewardSection/RewardLineR': 'title_line',
    'ZCSettlement/Panel/Grow/GrowBg': 'bg_02',
    'ZCSettlement/Panel/Grow/GrowLineL': 'title_line',
    'ZCSettlement/Panel/Grow/GrowLineR': 'title_line',
    'ZCSettlement/Panel/Grow/Entry0': 'icon_zbsj',
    'ZCSettlement/Panel/Grow/Entry1': 'icon_yx',
    'ZCSettlement/Panel/Grow/Entry2': 'icon_fw',
    'ZCSettlement/Panel/Grow/Entry0/Bg': 'text_bg',
    'ZCSettlement/BtnDouble': 'btn_02',
    'ZCSettlement/BtnConfirm': 'btn_01',
};

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
const frameOf = (art: string): string =>
    JSON.parse(readFileSync(`assets/bundles/battle/image/settlement/${art}.png.meta`, 'utf8')).subMetas.f9941.uuid;

test('页面脚本不再自己建节点，坐标全归 prefab', () => {
    const code = stripComments(pageSource);
    assert.doesNotMatch(code, /new Node\(/);
    assert.doesNotMatch(code, /\.addComponent\(/);
    assert.doesNotMatch(code, /setPosition|setScale/, '位置/缩放归 prefab（规则 215）');
    assert.doesNotMatch(code, /getChildByName\(|getChildByPath\(/, '结构由 prefab 承载，不再按名找节点');
    for (const key of ['titlePlate', 'rankRow', 'rankFill', 'rewardList', 'confirmButton']) {
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

    const plate = nodeNamed('TitlePlate', 'Panel')!;
    assert.deepEqual(sizeOf(plate), [DESIGN.titlePlate.w, DESIGN.titlePlate.h]);
    assert.deepEqual(positionOf(plate), [DESIGN.titlePlate.x, DESIGN.titlePlate.y]);
    const titleText = nodeNamed('TitleText', 'TitlePlate')!;
    assert.deepEqual(sizeOf(titleText), [DESIGN.titleText.w, DESIGN.titleText.h]);
    assert.deepEqual(positionOf(titleText), [DESIGN.titleText.x, DESIGN.titleText.y]);
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
    assert.equal(objects.filter((o) => o.__type__ === 'cc.Sprite' && o._type === 3).length, 1);

    // 段位名金色、加分绿色（设计稿量到 rgb(255,208,40) / rgb(87,228,103)）
    const rankName = componentOf(nodeNamed('RankName', 'RankRow')!, 'cc.Label')!;
    assert.equal(rankName._fontSize, DESIGN.rankName.fs);
    assert.equal([rankName._color.r, rankName._color.g, rankName._color.b].map((v: number) => v.toString(16).padStart(2, '0')).join(''), DESIGN.rankName.color);
    const rankAdd = componentOf(nodeNamed('RankAdd', 'RankRow')!, 'cc.Label')!;
    assert.equal(rankAdd._fontSize, DESIGN.rankAdd.fs);
    assert.equal([rankAdd._color.r, rankAdd._color.g, rankAdd._color.b].map((v: number) => v.toString(16).padStart(2, '0')).join(''), DESIGN.rankAdd.color);
    assert.equal(componentOf(nodeNamed('RankHint', 'RankRow')!, 'cc.Label')!._fontSize, DESIGN.rankHint.fs);

    for (const [name, want] of [['BtnDouble', DESIGN.btnDouble], ['BtnConfirm', DESIGN.btnConfirm]] as const) {
        const node = nodeNamed(name, 'ZCSettlement')!;
        assert.deepEqual(sizeOf(node), [want.w, want.h]);
        assert.deepEqual(positionOf(node), [want.x, want.y]);
        assert.ok(componentOf(node, 'cc.Button'), `${name} 必须有 cc.Button（CLICK 事件由它发）`);
    }
});

test('ZCSettlement.prefab：奖励区是虚拟列表（视窗挂 Mask + VirtualScrollView，content 只留模板）', () => {
    const scroll = nodeNamed('RewardScroll', 'RewardSection')!;
    assert.deepEqual(sizeOf(scroll), [DESIGN.rewardScroll.w, DESIGN.rewardScroll.h]);
    assert.ok(componentOf(scroll, 'cc.Mask'), '视口必须有 Mask（裁剪矩形 = 视窗 UITransform）');
    assert.equal(objects.filter((o) => o.__type__ === 'cc.ScrollView').length, 0, '不该再有 cc.ScrollView');

    const list = componentOf(scroll, VSCROLL_CID)!;
    assert.ok(list, '视口必须挂 VirtualScrollView');
    // 列表参数全在 prefab 里（代码只喂条数）：漏一项就是「排得不对、且不报错」
    assert.equal(list.useVirtualList, true);
    assert.equal(list.direction, 0, 'VERTICAL');
    // ★ 奖励格统一走**公共** `ui/common/RewardItem.prefab`：PREFAB 模式 + itemPrefab 指向它，
    //   静态槽位全删（自己烘一份 = 同一件事做两遍，改公共件时结算页不跟着变）。
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
    // 靠 lpos 顶边距那套会被 `scrollToTop()` 抹掉 → 整条列表下移半个视口高、只剩第一行可见（截图逮到过）。
    const scrollTransform = componentOf(scroll, 'cc.UITransform')!;
    assert.deepEqual([scrollTransform._anchorPoint.x, scrollTransform._anchorPoint.y], [0.5, 1], '视窗锚点必须 (0.5,1)');
    assert.deepEqual(positionOf(content), [0, 0], 'content 的 lpos 必须 (0,0)（原点 = 视窗上边缘）');
    assert.deepEqual(positionOf(scroll), [DESIGN.rewardScroll.x, DESIGN.rewardScroll.y], '锚点改了，但视觉盒子不许动');

    // ★ content 下**不许留静态槽位**：PREFAB 模式下 `start()` 会 `removeAllChildren()` 清空 content，
    //   留着既是垃圾、又会被误当成"模板"（旧版 GoodsBox 槽位就是这么混进来的）。
    assert.deepEqual(childrenOf(content), [], 'content 下不许有静态槽位（公共件是唯一来源）');
    assert.equal(nodeNamed('Slot', 'content'), undefined, '旧的 GoodsBox 静态槽位必须删干净');
});

test('虚拟列表落位公式与设计稿一致（列距 111 / 行距 114）', () => {
    // ⚠️ 格子 96（公共件），**间距按设计稿反推** ⇒ 列距/行距仍是 111 / 114。
    //    绝对坐标随格高变（首行中心 = −(header 20 + 格高一半 48) = −68）；
    //    设计稿量的 −70 是 100 格时的值，差 2px 来自格高，不是排版错。
    assert.equal(slotX(1) - slotX(0), VGRID.cell + VGRID.gridSpacing, '列距 111 = 格宽 96 + 列距 15');
    assert.equal(slotY(1) - slotY(0), -(VGRID.cell + VGRID.spacing), '行距 114 = 格高 96 + 行距 18');
    // 设计稿量到 −223.5 / −112.5 / −1.5 / 109.5 / 220.5（居中留白 38 : 41）
    // ⇒ 组件按整行居中算出来是 ±222，整体比稿右 1.5px。1.5px 肉眼不可见，认这个差。
    assert.deepEqual([slotX(0), slotX(2), slotX(4)], [-222, 0, 222]);
    // 行心：首行 −68（格高 96 的一半 48 + header 20），行距仍是 114
    assert.deepEqual([slotY(0), slotY(1), slotY(2), slotY(3)], [-68, -182, -296, -410]);
});

test('奖励格用公共 RewardItem（不自带 GoodsBox / 静态槽位）', () => {
    // ★ 结算页**不再自带**奖励格实现：格子来自公共 `ui/common/RewardItem.prefab`，
    //   由 `RewardItemView` 自己解析图标 / 品质框 / 数量（与宝箱详情、关卡界面、玩家关卡弹窗同源）。
    const goodsCid = cidOf(goodsMeta.uuid);
    assert.equal(
        objects.filter((o) => o.__type__ === goodsCid).length, 0,
        '结算页 prefab 里不许再挂 GoodsBox（奖励格统一走公共 RewardItem）',
    );
    // 公共件本体自带三件套 + 概率标签（挂 RewardItemView）
    const rewardItem = JSON.parse(readFileSync(assetPath('ui/common/RewardItem.prefab'), 'utf8')) as any[];
    const rewardItemView = rewardItem.find((o) => o.__type__ === cidOf(rewardItemViewMeta.uuid));
    assert.ok(rewardItemView, '公共 RewardItem 必须挂 RewardItemView');
    for (const prop of ['frame', 'icon', 'num', 'rate']) {
        assert.ok(rewardItemView[prop]?.__id__ !== undefined, `公共 RewardItem 的 ${prop} 未绑定`);
    }
    // 页面侧：只喂 {resId, amount}，格子自己解析
    assert.match(pageSource, /import \{ RewardItemView, type IRewardItemData \} from '\.\.\/\.\.\/common\/RewardItemView'/);
    assert.match(pageSource, /node\.getComponent\(RewardItemView\)!\.render\(this\.rewards\[index\]\)/);
    assert.doesNotMatch(pageSource, /GoodsBox/, '结算页不再使用 GoodsBox');
    // 数量文案由公共件自己算（`amount` 数字），页面不自己拼字符串
    assert.doesNotMatch(pageSource, /itemNumberTextOf/);
});

test('品质框/图标是运行时换图 ⇒ prefab 里出厂留空（不能是 `{}` 空对象）', () => {
    // `{}` 空对象既不是 `null` 也不是 `SpriteFrame` ⇒ 引擎 `Sprite._calculateUV` 读 `uv[0]` 抛错
    assert.doesNotMatch(prefabText, /"_spriteFrame":\s*\{\s*\}/);
});

test('变强途径三个入口：图标 / 文字 / 底板三件套**同心**（宽度不同，不能按左边界摆）', () => {
    // 设计稿量到图标中心 189 / 358 / 530（间距 169 / 172 —— 不是三等分，别自作主张改匀）；
    // 稿里 `text_bg` 中心 186 / 357.9 / 530，与图标中心差 ≤3px（手工摆放误差）⇒ 统一取图标中心。
    // `Grow` 容器中心在设计稿是 362.5 ⇒ 三个入口相对它的偏移如下（就是 189/358/530 减 362.5）。
    const OFFSETS = [-173.5, -4.5, 167.5];
    const names = ['Entry0', 'Entry1', 'Entry2'];
    /** `Grow` 容器中心（设计**绝对**坐标 362.5）—— 入口的 lpos 就是相对它的偏移。 */
    const growCenterX = DESIGN.grow.x + DESIGN.grow.w / 2;
    for (const [index, name] of names.entries()) {
        const entry = nodeNamed(name, 'Grow')!;
        assert.ok(entry, `${name} 不存在`);
        assert.deepEqual(sizeOf(entry), [80, 80], `${name} 图标 80×80`);
        assert.equal(positionOf(entry)[0], OFFSETS[index], `${name} 的图标中心位（相对 Grow 容器）`);
        // 🔴 入口节点锚点是 0.5 ⇒ 与它同心的子节点 `_lpos.x` 必须恰好 0。
        // 三者宽度不同（图标 80 / 文字 100 / 底板 110），任何一处按左边界摆都会偏 10~15px，
        // 视觉上就是「图标相对黑底没居中」（2026-10-14 山猫指出的问题）。
        for (const child of ['Bg', 'Label']) {
            const node = nodeNamed(child, name)!;
            assert.ok(node, `${name}/${child} 不存在`);
            assert.equal(positionOf(node)[0], 0, `${name}/${child} 必须与图标同心`);
        }
        assert.deepEqual(sizeOf(nodeNamed('Bg', name)!), [110, 21], `${name} 的文字底板 110×21`);
    }
    // 图标中心之间的间距照稿（169 / 172），不是三等分
    const centers = names.map((name) => growCenterX + positionOf(nodeNamed(name, 'Grow')!)[0]);
    assert.deepEqual(centers, [189, 358, 530]);
    assert.deepEqual([centers[1] - centers[0], centers[2] - centers[1]], [169, 172]);
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
    // 右侧那两条装饰线是镜像的（设计稿右侧是形状，用同一张图翻过来）
    for (const path of ['ZCSettlement/Panel/RewardSection/RewardLineR', 'ZCSettlement/Panel/Grow/GrowLineR']) {
        assert.deepEqual([findPath(path)!._lscale.x, findPath(path)!._lscale.y], [-1, 1], `${path} 应当镜像`);
    }
    for (const node of nodes) {
        const label = componentOf(node, 'cc.Label');
        if (!label) continue;
        assert.equal(label._enableOutline, true, `${node._name} 文案缺描边（面板是深底）`);
        assert.ok(label._outlineWidth >= 2, `${node._name} 描边宽度`);
    }
    assert.match(pageSource, /settlement\/JS_title_bg_01/);
    assert.match(pageSource, /settlement\/JS_title_02/, '失败态标题套图');
});

test('设计稿的静态文案烘在 prefab 里（运行时没人写它们）', () => {
    const texts = objects.filter((o) => o?.__type__ === 'cc.Label').map((o) => o._string);
    for (const want of ['通关奖励', '变强途径', '装备升级', '英雄', '符文', '双倍奖励', '确定']) {
        assert.ok(texts.includes(want), `静态文案缺失：${want}`);
    }
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
    // 每个真对象都要有 __type__（少了它 JSON 会丢键，落盘成没类型的孤儿组件）
    for (const [index, object] of objects.entries()) {
        const keys = Object.keys(object).filter((k) => k !== '__id__');
        if (keys.length > 0) assert.equal(typeof object.__type__, 'string', `#${index} 缺 __type__`);
    }
});

test('脚本 16 个 @property 全部绑到正确类型的对象', () => {
    const cid = cidOf(pageMeta.uuid);
    const script = objects.find((o) => o.__type__ === cid);
    assert.ok(script, `prefab 里应当挂 ${cid}（ZCSettlementPage）`);
    const expected: Record<string, string> = {
        titlePlate: 'cc.Sprite',
        titleText: 'cc.Sprite',
        rankRow: 'cc.Node',
        rankIcon: 'cc.Sprite',
        rankName: 'cc.Label',
        rankFill: 'cc.Sprite',
        rankScore: 'cc.Label',
        rankAdd: 'cc.Label',
        rankHint: 'cc.Label',
        rewardList: VSCROLL_CID,
        doubleButton: 'cc.Button',
        // 变强途径**整组**容器（2026-10-15 加）：收的是它而不是三个入口 ——
        // 只收入口会剩一个空标题框。收紧到 Grow 本身，见页面逻辑那条用例。
        growGroup: 'cc.Node',
        confirmButton: 'cc.Button',
        entryEquip: 'cc.Button',
        entryHero: 'cc.Button',
        entryRune: 'cc.Button',
    };
    assert.equal(Object.keys(expected).length, 16, '属性数量变了要同步这张表（漏一个 = 有属性没人绑）');
    for (const [prop, type] of Object.entries(expected)) {
        assert.ok(script[prop]?.__id__ !== undefined, `${prop} 未绑定`);
        assert.equal(objects[script[prop].__id__].__type__, type, `${prop} 应指向 ${type}`);
    }
    // `growGroup` 必须真的是 `Panel/Grow`（绑成 Panel 会把整个面板收起 = 页面全空）
    assert.equal(nodeNamed('Grow', 'Panel')!._id, objects[script.growGroup.__id__]._id);
    // 🔴 prefab 上就把 `closeOnBlank` 烘成 false（2026-10-15）：结算页一关，
    // `openSettlement` 置死的 `settlementOpened` 就让它再也弹不出来 ⇒ 关页 = 卡死。
    // 调用方 `open({ closeOnBlank: false })` 只是同向的第二层保险。
    assert.equal(script.closeOnBlank, false, 'prefab 上不许把空白关闭开着');
    // 旧的两个奖励属性随虚拟列表下线（数组属性 MCP 改不了、静态槽位也不再需要）
    assert.equal(script.rewardSlots, undefined, 'rewardSlots 数组属性应当已删除');
    assert.equal(script.rewardContent, undefined, 'rewardContent 应当已删除');
    // 遮罩随「白块 Sprite」方案下线（纯 prefab 件，代码不碰）
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
});

test('页面逻辑：整组显隐 / 虚拟列表喂条数 + 按下标现取 / 两态标题有代号防串', () => {
    const code = stripComments(pageSource);
    // 段位：没数据整组收起（别留一行空框）
    assert.match(code, /this\.rankRow\.active = hasRank/);
    // 奖励：**只喂条数**，格内容在 renderItemFn 里按下标现取
    // 赋**具名方法 + `.bind(this)`**（规范 §7.5 配套第 3 条）：`VScrollView` 是 `this.renderItemFn(node, i)`
    // 的方法调用语法，不绑的话 `this` 会是 VScrollView、`this.rewards` 读成 undefined。
    assert.match(code, /this\.rewardList\.renderItemFn = this\.renderReward\.bind\(this\)/,
        '回调只在 onInit 接一次（槽位复用，重复接会越滚越多）');
    assert.match(code, /this\.rewards = rewards/);
    assert.match(code, /this\.rewardList\.setTotalCount\(rewards\.length\)/);
    // 按下标现取本趟数据（★ 公共奖励格：只喂 resId+amount，图标/品质框/数量由格子自己解析）
    assert.match(code, /node\.getComponent\(RewardItemView\)!\.render\(this\.rewards\[index\]\)/,
        '按下标现取本趟数据');
    assert.match(code, /this\.rewardList\.scrollToTop\(false\)/);
    // ⚠️ 禁闭包捕获「本趟」的数组：`renderItemFn` 只在首次铺列表时绑一次，捕获了下一局还是旧数据
    assert.doesNotMatch(code, /renderItemFn = \(node, index\) => \{[^}]*rewards\[/,
        'renderItemFn 只准读 this.rewards，不许闭包捕获入参 rewards');
    // 两态标题：异步加载 + 代号防串（换态 / 关窗后到达的结果要丢掉）
    assert.match(code, /private titleRevision = 0/);
    assert.match(code, /revision !== this\.titleRevision \|\| !this\.isValid/);
    // 遮罩是纯 prefab 件：代码里既不该画它、也不该读它的尺寸
    assert.doesNotMatch(code, /this\.dim/, '代码不该再持有 dim');
    assert.doesNotMatch(code, /\.rect\(/, '遮罩不许用 Graphics 画矩形');
    // 按钮只在 onInit 绑一次
    assert.match(code, /protected onInit\(\)/);
    assert.match(code, /Button\.EventType\.CLICK/);
});

test('🔴 确定按钮：派发 Confirm 事件、不退化成 close、且防重复提交（2026-10-16 事件化）', () => {
    const code = stripComments(pageSource);
    // ① 确定**只派发意图事件**：页面不认识「回主界面 / 换流程」，那是控制器的事
    //   （旧口径是 `userData.onConfirm` 必填回调 + 拿不到就告警的兜底分支，已删）。
    assert.match(code, /EventMgr\.instance\.emit\(ZCGameUiEvent\.SettlementConfirm\);/, '确定必须派发 ZCGameUiEvent.SettlementConfirm');
    // 总线**不再从 userData 传**：监听由事件中控（`EventMgr.instance`）统一管理。
    assert.doesNotMatch(code, /userData\.events/, '不再往 userData 塞总线');
    assert.doesNotMatch(code, /EventBus/, '页面不该持有总线实例');
    assert.doesNotMatch(code, /onConfirm\b/, '页面不该再持有收尾回调 —— 意图一律走事件');
    // ② 绝不能退化成 close()：页面一关，`openSettlement` 置死的 `settlementOpened`
    //    就让它再也弹不出结算页 ⇒ 卡死。
    assert.doesNotMatch(code, /this\.close\(/, '确定不许退化成只 close()');
    // ③ 防重复提交（§7.2）：连点两下只派发一次（收尾多半是切流程，重复发等于 navigate 两次）。
    assert.match(code, /private confirming = false/);
    assert.match(code, /if \(this\.confirming\) return;/);
    assert.match(code, /this\.confirming = true;/);
    assert.match(code, /this\.confirming = false;\s*this\.renderRank/, '每次 onOpen 必须复位，否则第二局点不动');
    // ④ 页面自己兜住「空白关闭」，不靠调用方记得传 closeOnBlank:false
    assert.match(code, /protected canCloseOnBlank\(\): boolean \{\s*return false;\s*\}/,
        '结算页必须覆写 canCloseOnBlank 返回 false');
});

test('🔴 双倍奖励常显（只展示、未接线不可点）；变强途径未接线整组收起（2026-10-16 调整）', () => {
    const code = stripComments(pageSource);
    // 双倍奖励在设计稿里是奖励区中间那一段（两侧 `RewardLineL/R` 接过去）⇒ **常显**：
    // 藏掉会中间断一截、左右不对称。但没接线只能「看得到、点不动」（`interactable = false`），
    // 不做点了没反应的假交互。
    assert.match(code, /private renderEntryGroups\(data: IZCSettlementOptions\)/);
    assert.match(code, /this\.doubleButton\.node\.active = true;/, '双倍奖励按钮必须常显');
    assert.match(code, /this\.doubleButton\.interactable = Boolean\(data\.hasDoubleReward\)/,
        '★没接线 ⇒ 不可点（展示位，不是假交互）');
    // ⚠️ 收的是 `Panel/Grow` **整组**（底板 + 标题 + 三个入口）而不是三个入口 ——
    // 只收入口会剩一个空标题框，比死按钮更奇怪。
    assert.match(code, /this\.growGroup\.active = Boolean\(data\.hasGrowEntry\)/);
    assert.doesNotMatch(code, /entryEquip\.node\.active|entryHero\.node\.active|entryRune\.node\.active/,
        '三个入口不许各自显隐（会剩空标题框）');
    assert.match(code, /this\.renderEntryGroups\(userData\);/, 'onOpen 必须调它，否则 prefab 的默认 active 会一直露着');
    // 监听仍是「onInit 绑一次 + 具名方法 + this 作 target」（范本 GameRunAway）：
    // 箭头闭包在调用栈里没有名字，将来要 off 也没有稳定函数引用可传。
    assert.match(code, /confirmButton\.node\.on\(Button\.EventType\.CLICK, this\.onConfirmClicked, this\)/);
    assert.doesNotMatch(code, /Button\.EventType\.CLICK, \(\) =>/, '按钮监听不许再用箭头闭包');
});

test('四个按钮只 emit 意图事件，页面不持有任何回调（视图不认识流程）', () => {
    const code = stripComments(pageSource);
    // 「确定」之外，双倍奖励与变强三入口也统一走事件中控（2026-10-27；此前它们还是回调）。
    assert.match(code, /EventMgr\.instance\.emit\(ZCGameUiEvent\.SettlementDoubleReward\)/);
    assert.match(code, /EventMgr\.instance\.emit\(ZCGameUiEvent\.SettlementGrowEntry, entry\)/,
        '三个入口共用一条事件，点哪个由 payload 区分');
    for (const entry of ['equip', 'hero', 'rune']) {
        assert.match(code, new RegExp(`emitGrowEntry\\('${entry}'\\)`), `${entry} 入口必须走 payload`);
    }
    // 页面侧不许再出现 userData 回调：`options?.onXxx?.(...)` 就是「漏传一个 = 点了没反应且零报错」。
    assert.doesNotMatch(code, /this\.options\?\.on/, '页面不许持有回调');
    assert.doesNotMatch(code, /onDoubleReward\?:|onGrowEntry\?:/, 'userData 只留 has* 门闩，不留回调字段');
    assert.doesNotMatch(code, /private options: IZCSettlementOptions/, '留一份 userData 没意义 —— 意图全派发出去了');
});

test('ZCGame：对局结束改弹 ZCSettlementPage（伤害统计仍走 GameRunAway）', () => {
    const code = stripComments(gameSource);
    assert.match(code, /import \{ ZCSettlementPage \} from '\.\/ui\/ZCSettlementPage'/);
    // 弹页搬进 `showSettlement`（章节局要**先等结算广播**再弹），所以断言落在调用点上。
    //  胜负口径要连着两步看：先算 `localVictory`（**撤退算失败**），再把胜负与章节等待器一起交给弹页
    //（章节局要先等 `CmdBattleResultBroMsg` 才弹，见 ZCGame.showSettlement 的签名）。
    assert.match(code, /const localVictory = !retreated && state\.status === 'victory'/, '胜负口径：撤退算失败');
    //  实参是 `battleResult`：章节局那个 `chapterResult` 会被包一层（PVP 走 `waitForBattleResult`，
    //  章节局直接用它），所以这里钉的是包好之后的那个名字。
    assert.match(code, /void this\.showSettlement\(localVictory, battleResult\)/, '胜负与章节等待器一起交给弹页');
    //  签名是多行的（`victory` + 章节等待器 `chapterResult`）⇒ 用 `\s*` 兼容换行。
    assert.match(code, /private async showSettlement\(\s*localVictory: boolean,/);
    assert.match(code, /ZCSettlementPage\.open\(\{/);
    // 确定**不再走 userData 回调**：结算页派发 `ZCGameUiEvent.SettlementConfirm`，控制器订阅后收尾。
    assert.match(code, /import \{ ZCGameUiEvent \} from '\.\/view\/ZCGameHudEvents'/);
    assert.match(code, /EventMgr\.instance\.on\(ZCGameUiEvent\.SettlementConfirm, this\.onSettlementConfirm, this\)/,
        '★ZCGame 必须订阅结算页的确定事件 —— 漏了就「点了没反应」（页面自己不会关）');
    //  确定 = ① 先收页面 ② 再回主界面（切流程是「预加载 → 进入」两段，弹窗不能等 onLeave 才消失）
    //  ③ 切流被取消时按同一份 userData 把页面补回来（否则 phase 已 Settlement ⇒ 卡死）。
    assert.match(code, /private onSettlementConfirm\(\): void \{\s*if \(this\.leaving\) return;\s*this\.closeSettlementPopup\(\);/,
        '确定必须先关弹窗再导航 —— 顺序反了就是「点了没反应」');
    assert.doesNotMatch(code, /private onSettlementConfirm\(\): void \{\s*if \(!this\.leaving\) this\.returnToMain\(\);/,
        '不许退回「不关页、直接导航」的旧写法（伤害统计那条 `onDamageStatsReturnToMain` 不在本次范围）');
    assert.match(code, /ProcedureManager\.onSwitchSettled\(\(entered\) => \{[\s\S]{0,200}?if \(!entered\) this\.reopenSettlement\(\)/,
        '切流被取消必须把结算页补回来');
    assert.match(code, /private reopenSettlement\(\): void \{[\s\S]{0,200}?this\.openSettlementPopup\(this\.settlementOptions\)/,
        '重开复用首次那份 userData（奖励帧已解析好，不必再等广播）');
    assert.doesNotMatch(code, /onConfirm: \(\)/, '不该再往结算页塞收尾回调');
    assert.match(code, /private settlementPopup: ZCSettlementPage \| null = null/);
    // 伤害统计弹窗没被顺手删掉（HUD 的伤害按钮还在用它）
    assert.match(code, /GameRunAway\.open\(\{/);
    assert.match(code, /private damagePopup: GameRunAway \| null = null/);
    assert.match(pageSource, /static prefabPath = 'ui\/game\/ZCSettlement'/);
    assert.match(pageSource, /export class ZCSettlementPage extends PopupBase/);
});
