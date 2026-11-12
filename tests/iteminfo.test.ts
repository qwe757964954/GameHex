/**
 * 「道具信息」弹窗（蓝湖「道具信息」稿，720×1610，面板 470×659）的单测。
 *
 * ## 盯住哪五类东西
 *
 * | 组 | 内容 | 错了会怎样 |
 * |---|---|---|
 * | A | `ItemInfoTable` 纯函数（行高公式 / 行数钳制 / 类型名） | 静默 —— 底板高度和行数对不上，行悬在底板外 |
 * | B | 文案唯一出口（全角冒号、格式化结果） | 与设计稿分叉（半角 `品质:` 是另一套弹窗的口径） |
 * | C | 切图存在性 + 九宫名单 ↔ `.meta` border 对账 | 静默 —— 按钮/底板按 SIMPLE 拉伸变形 |
 * | D | `ItemInfo.prefab` 结构 + 几何 + **Inspector 引用非空** | 静默 —— 节点在屏幕外 / `GoodsBox.frame=null` 不画框 / 行点不动 |
 * | E | 接线（`CardUpgradePage` 的 ExpIcon → 本弹窗） | 静默 —— 入口是死按钮，点了没反应 |
 *
 * ## 为什么 D 组要逐个查引用
 *
 * 2026-11-10 实测：用 MCP 在**场景**里设好的脚本组件引用（`GoodsBox.frame` 等）
 * 经 `prefab create` / `save` 后会**静默变 `null`**（不报错、编辑器也不提示），
 * 只有打开弹窗才发现「物品图标没框、行没文字」。所以这里把「引用必须非空」
 * 固化成断言，改 prefab 时先跑本文件。
 *
 * ⚠️ `ItemInfoPage` / `ItemInfoRow` / `GoodsBox` 都 `import 'cc'` ⇒ 本文件**不** import 它们，
 * 相关约束全部走 D/E 组的 prefab 与源码文本断言。
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
    ITEM_INFO_MAX_ROWS,
    ITEM_INFO_PANEL_HEIGHT,
    ITEM_INFO_PANEL_WIDTH,
    ITEM_INFO_PLATE_WIDTH,
    ITEM_INFO_REWARD_ITEM_SIZE,
    ITEM_INFO_REWARD_SLOT_SIZE,
    ITEM_INFO_ROWS_PAD,
    ITEM_INFO_ROW_GAP,
    ITEM_INFO_ROW_HEIGHT,
    ITEM_INFO_ROW_WIDTH,
    itemInfoRowCountOf,
    itemInfoRowsHeightOf,
    itemTypeNameOf,
} from '../assets/script/app/itemdetail/ItemInfoTable';
import { ITEM_DETAIL_TEXTS, formatText } from '../assets/script/app/itemdetail/ItemDetailTexts';

const ITEM_INFO_PREFAB = 'assets/bundles/main-pages/ui/ItemInfo/ItemInfo.prefab';
const CARD_UPGRADE_PREFAB = 'assets/bundles/main-pages/ui/card/CardUpgrade.prefab';
/** 公共奖励格（物品格用的就是它）。 */
const REWARD_ITEM_PREFAB = 'assets/resources/ui/common/RewardItem.prefab';
const REWARD_ITEM_PREFAB_META = `${REWARD_ITEM_PREFAB}.meta`;
const ITEM_INFO_PAGE_SRC = 'assets/script/app/itemdetail/ItemInfoPage.ts';
const CARD_UPGRADE_PAGE_SRC = 'assets/script/app/card/CardUpgradePage.ts';
const ART_DIR = 'assets/bundles/main-pages/image/iteminfo';

const UI_2D = 33554432;

interface RawNode {
    readonly __type__?: string;
    readonly _name?: string;
    readonly _components?: readonly { __id__: number }[];
    readonly _children?: readonly { __id__: number }[];
    readonly _lpos?: { x: number; y: number };
    readonly _layer?: number;
    readonly _prefab?: { asset?: { __id__: number } };
}

function readPrefab(path: string): RawNode[] {
    return JSON.parse(readFileSync(path, 'utf8')) as RawNode[];
}

function componentsOf(prefab: RawNode[], node: RawNode): Record<string, unknown>[] {
    return (node._components ?? []).map((ref) => prefab[ref.__id__] as unknown as Record<string, unknown>);
}

function nodeByName(prefab: RawNode[], name: string): RawNode {
    const found = prefab.filter((entry) => entry.__type__ === 'cc.Node' && entry._name === name);
    assert.equal(found.length, 1, `prefab 里应恰有一个节点 ${name}，实际 ${found.length}`);
    return found[0];
}

/** 引用是否指向一个真实对象（`{__id__: n}` 且 n 落在数组内）。 */
function isRef(value: unknown, prefab: RawNode[]): boolean {
    if (!value || typeof value !== 'object') return false;
    const id = (value as { __id__?: unknown }).__id__;
    return typeof id === 'number' && id >= 0 && id < prefab.length;
}

function uiSize(node: RawNode, prefab: RawNode[]): { width: number; height: number } {
    const transform = componentsOf(prefab, node).find((comp) => comp.__type__ === 'cc.UITransform');
    assert.ok(transform, `${node._name} 缺 cc.UITransform`);
    return (transform as unknown as { _contentSize: { width: number; height: number } })._contentSize;
}

// ============================================================
// A 组：版面公式与类型名
// ============================================================

test('A1 底板高度公式：设计稿两行 = 151（与蓝湖稿底板完全一致）', () => {
    assert.equal(itemInfoRowsHeightOf(2), 151);
    assert.equal(itemInfoRowsHeightOf(1), 2 * ITEM_INFO_ROWS_PAD + ITEM_INFO_ROW_HEIGHT);
    assert.equal(itemInfoRowsHeightOf(3), 151 + ITEM_INFO_ROW_HEIGHT + ITEM_INFO_ROW_GAP);
    // 与设计稿常量自洽：151 = 2×内边距 + 2×行高 + 1×行距
    assert.equal(2 * ITEM_INFO_ROWS_PAD + 2 * ITEM_INFO_ROW_HEIGHT + ITEM_INFO_ROW_GAP, 151);
});

test('A2 行数非法/越界都不炸：至少 1 行、最多预建行数', () => {
    assert.equal(itemInfoRowCountOf(0), 1);
    assert.equal(itemInfoRowCountOf(-3), 1);
    assert.equal(itemInfoRowCountOf(Number.NaN), 1);
    assert.equal(itemInfoRowCountOf(2), 2);
    assert.equal(itemInfoRowCountOf(99), ITEM_INFO_MAX_ROWS);
    // 预建 4 行是 `item.access` 的实测上限；底板最高不能低出面板
    const tallest = itemInfoRowsHeightOf(ITEM_INFO_MAX_ROWS);
    assert.ok(tallest < ITEM_INFO_PANEL_HEIGHT / 2, `4 行底板 ${tallest} 不应超过面板一半高`);
});

test('A3 面板/底板/行 的宽度关系：底板包住行、面板包住底板', () => {
    assert.ok(ITEM_INFO_ROW_WIDTH < ITEM_INFO_PLATE_WIDTH, '行必须窄于底板');
    assert.ok(ITEM_INFO_PLATE_WIDTH < ITEM_INFO_PANEL_WIDTH, '底板必须窄于面板');
    assert.equal(ITEM_INFO_PLATE_WIDTH - ITEM_INFO_ROW_WIDTH, 23);
});

test('A4 类型名按 ItemType 枚举口径；未登记/非法返回空串（页面据此藏掉整行）', () => {
    assert.equal(itemTypeNameOf(1), '普通');
    assert.equal(itemTypeNameOf(5), '技能书');
    assert.equal(itemTypeNameOf(8), '装备图纸');
    assert.equal(itemTypeNameOf(10), '灵兽');
    assert.equal(itemTypeNameOf(0), '');
    assert.equal(itemTypeNameOf(11), '');
    assert.equal(itemTypeNameOf(Number.NaN), '');
    // 兵种经验（16003）在表里是 type=5，页面上就该显示「技能书」而不是设计稿示意的「消耗品」
    assert.equal(itemTypeNameOf(5), '技能书');
});

// ============================================================
// B 组：文案唯一出口
// ============================================================

test('B1 类型/品质行用全角冒号（与老「道具详情」的半角 `品质:` 是两套口径）', () => {
    assert.equal(formatText(ITEM_DETAIL_TEXTS.infoTypeLine, '技能书'), '类型：技能书');
    assert.equal(formatText(ITEM_DETAIL_TEXTS.infoQualityLine, '优秀'), '品质：优秀');
    assert.ok(!ITEM_DETAIL_TEXTS.infoTypeLine.includes(':'), '类型行不许出现半角冒号');
    assert.ok(!ITEM_DETAIL_TEXTS.infoQualityLine.includes(':'), '品质行不许出现半角冒号');
    assert.equal(ITEM_DETAIL_TEXTS.qualityLabel, '品质:', '老「道具详情」那套保持半角，别被顺手改掉');
});

test('B2 标题与占位文案复用老弹窗那套（不新造第二份）', () => {
    assert.equal(ITEM_DETAIL_TEXTS.descTitle, '道具说明');
    assert.equal(ITEM_DETAIL_TEXTS.accessTitle, '获取途径');
    assert.equal(ITEM_DETAIL_TEXTS.noAccess, '暂无获取途径');
    assert.equal(ITEM_DETAIL_TEXTS.unknownName, '未知物品');
    assert.equal(ITEM_DETAIL_TEXTS.noDesc, '暂无描述');
});

// ============================================================
// C 组：切图与九宫
// ============================================================

test('C1 五张切图齐全，且目录有 auto-atlas.pac（漏配引擎零报错）', () => {
    const names = ['djxx_bg_01', 'djxx_bg_02', 'brn_hqtj', 'jiantou_03', 'title_line'];
    for (const name of names) {
        assert.ok(existsSync(`${ART_DIR}/${name}.png`), `缺切图 ${name}.png`);
    }
    assert.ok(existsSync(`${ART_DIR}/auto-atlas.pac`), '图目录必须自带 auto-atlas.pac');
    const atlas = JSON.parse(readFileSync(`${ART_DIR}/auto-atlas.pac.meta`, 'utf8')) as {
        importer?: string;
    };
    assert.equal(atlas.importer, 'auto-atlas');
});

test('C2 两张底图是九宫（border 有值且 packable=false，否则合图后拉伸会变形）', () => {
    const expected: readonly [string, number][] = [['brn_hqtj', 12], ['djxx_bg_02', 16]];
    for (const [name, border] of expected) {
        const meta = JSON.parse(readFileSync(`${ART_DIR}/${name}.png.meta`, 'utf8')) as {
            subMetas: Record<string, { userData: Record<string, unknown> }>;
        };
        const data = meta.subMetas.f9941.userData;
        assert.equal(data.borderTop, border, `${name} borderTop`);
        assert.equal(data.borderBottom, border, `${name} borderBottom`);
        assert.equal(data.borderLeft, border, `${name} borderLeft`);
        assert.equal(data.borderRight, border, `${name} borderRight`);
        assert.equal(data.packable, false, `${name} 九宫图不许进图集`);
    }
    // 整图（面板底 / 箭头 / 标题线）保持可合图
    for (const name of ['djxx_bg_01', 'jiantou_03', 'title_line']) {
        const meta = JSON.parse(readFileSync(`${ART_DIR}/${name}.png.meta`, 'utf8')) as {
            subMetas: Record<string, { userData: Record<string, unknown> }>;
        };
        assert.equal(meta.subMetas.f9941.userData.packable, true, `${name} 应可进图集`);
    }
});

// ============================================================
// D 组：prefab 结构与引用
// ============================================================

test('D1 根节点挂 ItemInfoPage、尺寸 720×1280、全部节点在 UI_2D 层', () => {
    const prefab = readPrefab(ITEM_INFO_PREFAB);
    const nodes = prefab.filter((entry) => entry.__type__ === 'cc.Node');
    const root = nodeByName(prefab, 'ItemInfo');
    assert.equal(nodes[0], root, '根节点必须是 ItemInfo');

    const page = componentsOf(prefab, root).find((comp) => 'rowsRoot' in comp && 'nameLabel' in comp);
    assert.ok(page, '根节点缺 ItemInfoPage 组件');

    const size = uiSize(root, prefab);
    assert.deepEqual([size.width, size.height], [720, 1280]);

    const offLayer = nodes.filter((node) => node._layer !== UI_2D).map((node) => node._name);
    assert.deepEqual(offLayer, [], '这些节点不在 UI_2D 层（会被 UI 相机整棵忽略）');
});

test('D2 ItemInfoPage 的 7 个 Inspector 引用全部非空且类型正确', () => {
    const prefab = readPrefab(ITEM_INFO_PREFAB);
    const root = nodeByName(prefab, 'ItemInfo');
    const page = componentsOf(prefab, root).find((comp) => 'rowsRoot' in comp && 'nameLabel' in comp);
    assert.ok(page);

    const typeOf = (ref: unknown): unknown => (isRef(ref, prefab) ? prefab[(ref as { __id__: number }).__id__].__type__ : null);
    const labelRefs = ['nameLabel', 'typeLabel', 'qualityLabel', 'descLabel'] as const;
    for (const key of labelRefs) {
        assert.ok(isRef(page[key], prefab), `ItemInfoPage.${key} 是空引用`);
        assert.equal(typeOf(page[key]), 'cc.Label', `ItemInfoPage.${key} 应指向 cc.Label`);
    }
    // 物品格换成公共奖励格后，`goods` 变成宿主节点 + Prefab 资源两个引用（见 D3）
    assert.ok(isRef(page.goodsHost, prefab), 'ItemInfoPage.goodsHost 是空引用');
    assert.equal(typeOf(page.goodsHost), 'cc.Node', 'ItemInfoPage.goodsHost 应指向节点');
    assert.ok(isRef(page.rowsPlate, prefab), 'ItemInfoPage.rowsPlate 是空引用');
    assert.ok(isRef(page.rowsRoot, prefab), 'ItemInfoPage.rowsRoot 是空引用');
    assert.equal(prefab[(page.rowsRoot as { __id__: number }).__id__].__type__, 'cc.Node');
});

test('D3 物品格用公共 RewardItem：Goods 只是 100×100 宿主，Prefab 引用指向公共格', () => {
    const prefab = readPrefab(ITEM_INFO_PREFAB);
    const goods = nodeByName(prefab, 'Goods');
    // 宿主：只有 UITransform，没有子节点、没有自己那套 Frame/Icon/Num（旧 GoodsBox 口径已废弃）
    assert.deepEqual(componentsOf(prefab, goods).map((comp) => comp.__type__), ['cc.UITransform']);
    assert.deepEqual(goods._children ?? [], [], 'Goods 不该再预放 Frame/Icon/Num');
    const size = uiSize(goods, prefab);
    assert.deepEqual([size.width, size.height], [ITEM_INFO_REWARD_SLOT_SIZE, ITEM_INFO_REWARD_SLOT_SIZE]);

    const root = nodeByName(prefab, 'ItemInfo');
    const page = componentsOf(prefab, root).find((comp) => 'rowsRoot' in comp && 'nameLabel' in comp);
    assert.ok(page);
    assert.ok(isRef(page.goodsHost, prefab), 'ItemInfoPage.goodsHost 是空引用');
    assert.equal((page.goodsHost as { __id__: number }).__id__, prefab.indexOf(goods), 'goodsHost 应指向 Goods 节点');

    // 公共格走**运行时加载**（跨包不绑资源引用）：prefab 里不许出现它的 uuid
    const publicMeta = JSON.parse(readFileSync(REWARD_ITEM_PREFAB_META, 'utf8')) as { uuid: string };
    assert.equal(readFileSync(ITEM_INFO_PREFAB, 'utf8').includes(publicMeta.uuid), false,
        'ItemInfo 是 main-pages 包，绑 resources 的 prefab 就成了跨包引用 ⇒ 应运行时 load');
    const source = readFileSync(ITEM_INFO_PAGE_SRC, 'utf8');
    assert.match(source, /REWARD_ITEM_PATH = 'ui\/common\/RewardItem'/, '公共格路径只写一处');
    assert.match(source, /UIResources\.loadAsync\(ItemInfoPage\.REWARD_ITEM_PATH\)/,
        '要走 UIResources.loadAsync（内部即 resources.load + 缓存/bundle 判定），别裸调 resources.load');
});

test('D3b 公共奖励格自身完整：96×96 + RewardItemView 四件套非空（宿主依赖它的 render 接口）', () => {
    const prefab = readPrefab(REWARD_ITEM_PREFAB);
    const root = prefab.filter((entry) => entry.__type__ === 'cc.Node')[0];
    const size = uiSize(root, prefab);
    assert.deepEqual([size.width, size.height], [ITEM_INFO_REWARD_ITEM_SIZE, ITEM_INFO_REWARD_ITEM_SIZE],
        '公共格尺寸变了要同步 ITEM_INFO_REWARD_ITEM_SIZE');

    const view = componentsOf(prefab, root).find((comp) => 'frame' in comp && 'rate' in comp);
    assert.ok(view, '公共格缺 RewardItemView');
    for (const key of ['frame', 'icon'] as const) {
        assert.ok(isRef(view[key], prefab), `RewardItemView.${key} 是空引用`);
        assert.equal(prefab[(view[key] as { __id__: number }).__id__].__type__, 'cc.Sprite');
    }
    for (const key of ['num', 'rate'] as const) {
        assert.ok(isRef(view[key], prefab), `RewardItemView.${key} 是空引用`);
        assert.equal(prefab[(view[key] as { __id__: number }).__id__].__type__, 'cc.Label');
    }
});

test('D4 途径行预建 4 行：每行挂 cc.Button + ItemInfoRow 且 label/arrow 非空', () => {
    const prefab = readPrefab(ITEM_INFO_PREFAB);
    for (let index = 1; index <= ITEM_INFO_MAX_ROWS; index += 1) {
        const row = nodeByName(prefab, `Row${index}`);
        const comps = componentsOf(prefab, row);
        const types = comps.map((comp) => comp.__type__);
        assert.ok(types.includes('cc.Button'), `Row${index} 缺 cc.Button（CLICK 绑不上就成死行）`);
        assert.ok(types.includes('cc.Sprite'), `Row${index} 缺行底 Sprite`);

        const view = comps.find((comp) => 'label' in comp && 'arrow' in comp);
        assert.ok(view, `Row${index} 缺 ItemInfoRow 组件`);
        assert.ok(isRef(view.label, prefab), `Row${index}.label 是空引用`);
        assert.ok(isRef(view.arrow, prefab), `Row${index}.arrow 是空引用`);

        // 行间距 = 行高 + 行距，第 i 行的中心 = -(行高/2 + i×间距)
        const y = (row._lpos as { y: number }).y;
        const expected = -(ITEM_INFO_ROW_HEIGHT / 2 + (index - 1) * (ITEM_INFO_ROW_HEIGHT + ITEM_INFO_ROW_GAP));
        assert.ok(Math.abs(y - expected) < 0.01, `Row${index} 的 y=${y}，应为 ${expected}`);
        const size = uiSize(row, prefab);
        assert.deepEqual([size.width, size.height], [ITEM_INFO_ROW_WIDTH, ITEM_INFO_ROW_HEIGHT]);
    }
    // 第 3、4 行在 prefab 里先藏着（按实际条数由页面打开）
    assert.equal(nodeByName(prefab, 'Row3')._prefab !== undefined, true);
    const rows = ['Row1', 'Row2', 'Row3', 'Row4'].map((name) => nodeByName(prefab, name));
    assert.equal(rows.filter((node) => (node as { _active?: boolean })._active === false).length, 2);
});

test('D5 版面几何：面板 470×659、底板 437×151、标题线左右各 157×13', () => {
    const prefab = readPrefab(ITEM_INFO_PREFAB);
    const panel = uiSize(nodeByName(prefab, 'Panel'), prefab);
    assert.deepEqual([panel.width, panel.height], [ITEM_INFO_PANEL_WIDTH, ITEM_INFO_PANEL_HEIGHT]);

    const plate = uiSize(nodeByName(prefab, 'RowsPlate'), prefab);
    assert.deepEqual([plate.width, plate.height], [ITEM_INFO_PLATE_WIDTH, 151]);

    for (const name of ['DescLineL', 'DescLineR', 'AccessLineL', 'AccessLineR']) {
        const line = uiSize(nodeByName(prefab, name), prefab);
        assert.deepEqual([line.width, line.height], [157, 13], `${name} 尺寸`);
    }
    // 标题线左右对称（面板中心 x=0 两侧 ±140）。设计稿本身差 1px（142..299 / 422..579），
    // 按「≤2px 视为对称」判，别为了凑对称把线搬离设计稿。
    const left = (nodeByName(prefab, 'DescLineL')._lpos as { x: number }).x;
    const right = (nodeByName(prefab, 'DescLineR')._lpos as { x: number }).x;
    assert.ok(Math.abs(left + right) <= 2, `左右标题线应基本对称，实际 ${left} / ${right}`);
});

// ============================================================
// E 组：接线
// ============================================================

test('E1 ItemInfoPage 的 prefabPath 指向本预制体（大小写错误真机才炸）', () => {
    const source = readFileSync(ITEM_INFO_PAGE_SRC, 'utf8');
    assert.match(source, /static prefabPath = 'ui\/ItemInfo\/ItemInfo'/);
    assert.ok(existsSync('assets/bundles/main-pages/ui/ItemInfo/ItemInfo.prefab'));
});

test('E2 卡牌详情的经验材料图标挂 cc.Button，并绑到 CardUpgradePage.expIconButton', () => {
    const prefab = readPrefab(CARD_UPGRADE_PREFAB);
    const icon = nodeByName(prefab, 'ExpIcon');
    const types = componentsOf(prefab, icon).map((comp) => comp.__type__);
    assert.ok(types.includes('cc.Button'), 'ExpIcon 缺 cc.Button ⇒ 点击入口不存在');

    const root = nodeByName(prefab, 'CardUpgrade');
    const page = componentsOf(prefab, root).find((comp) => 'expIconButton' in comp);
    assert.ok(page, 'CardUpgradePage 上还没有 expIconButton 字段（脚本没编译或没重新挂）');
    assert.ok(isRef(page.expIconButton, prefab), 'CardUpgradePage.expIconButton 是空引用');
    const target = prefab[(page.expIconButton as { __id__: number }).__id__] as {
        __type__?: string;
        node?: { __id__: number };
    };
    assert.equal(target.__type__, 'cc.Button');
    assert.equal(prefab[target.node?.__id__ ?? -1]._name, 'ExpIcon', 'expIconButton 应指向 ExpIcon 上的 Button');
});

test('E3 页面只派发/只打开弹窗，不自己写文案；入口先判 expItemId', () => {
    const source = readFileSync(CARD_UPGRADE_PAGE_SRC, 'utf8');
    assert.match(source, /this\.expIconButton\?\.node\.on\(Button\.EventType\.CLICK, this\.onExpIconClick, this\)/);
    assert.match(source, /if \(this\.expItemId <= 0\) return;/, '图标没铺出来时不该拿旧道具开详情');
    assert.match(source, /ItemInfoPage\.open\(/);
    // 经验图标那一趟必须把「当前显示的道具」回填（否则点开的是上一件）
    assert.match(source, /onPick\?\.\(entry\)/);
});

test('E4 页面不硬编码展示文案（只允许 Inspector 的 group/tooltip 用中文）', () => {
    //  「展示文案」= 会写进界面的那批。改文案只动 `ItemDetailTexts`，
    //  页面脚本里出现这些字面量就是第二份真源（只扫展示串，别误伤 group/tooltip）。
    const forbidden = ['类型：', '品质：', '暂无获取途径', '未知物品', '暂无描述'];
    for (const path of [ITEM_INFO_PAGE_SRC, 'assets/script/app/itemdetail/ItemInfoRow.ts']) {
        const source = readFileSync(path, 'utf8');
        const code = source
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/[^\n]*/g, '');
        const strings = code.match(/'[^'\n]*'/g) ?? [];
        const hits = strings.filter((text) => forbidden.some((word) => text.includes(word)));
        assert.deepEqual(hits, [], `${path} 里出现了展示文案字面量`);
    }
});
