import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { HEX_GRID_FACE_HEIGHT, HEX_GRID_FACE_WIDTH } from '../assets/script/core/hex/HexGridLayout';
import {
    TERRITORY_CONDITION_CHEST_GAP,
    TERRITORY_CONDITION_CHEST_SCALE,
    TERRITORY_CONDITION_FACE_MIN_MARGIN,
    territoryConditionBlockLayout,
} from '../assets/script/app/territory/model/TerritoryConditionBadge';
import {
    FakeColor,
    loadTerritoryStationModule,
    makeStationView,
    type FakeNode,
    type StationRenderContent,
} from './helpers/territory-station-fixtures';
import { loadTerritoryMapViewClass } from './helpers/territory-map-view-sandbox';

/**
 * 固定宝箱格「可激活」时多出来的那颗宝箱图标（2026-11-10，两轮）。
 *
 * 第一轮（用户原话）：
 * > 「当固定格资源处于可激活状态时，除了展示银币 icon + 数字外，**新增宝箱 icon 展示**，
 * >  宝箱 icon 使用美术资源 `icon_baoxiang`，整个格子的排版参照美术效果图。
 * >  当银币不足，只有数字 UI 显示红色的逻辑不变。固定格未解锁，**仍然只显示锁 icon**。」
 *
 * 第二轮（实机看图之后）：
 * > 「缩银币 icon 和数字的大小，宝箱缩小成 **0.95** 比例，宝箱 icon 和银币和数字行的间隙可以再小点，
 * >  不重叠就行。保证所有 icon 和 UI **都在格子内**，且和格子边缘留有 1~ 像素的间距。」
 *
 * ⇒ 这个文件钉四组：① 排版公式（无宝箱必须零偏移）；② **整块塞进格面**（第二轮的核心）；
 * ③ 视图落位 / 显隐 / 生成缩放 / 销毁；④ 数据侧只有 `fixedResource` 拿得到图。
 *
 * ⚠️ 常量一律从**真实模块**取（视图导出 + model 导出 + core 的格面尺寸），
 *    抄一份数字进来就会变成"改了产品代码、用例还是绿的"。
 */

const STATION_SRC = readFileSync('assets/script/app/territory/view/TerritoryStationView.ts', 'utf8');
const MAP_SRC = readFileSync('assets/script/app/territory/view/TerritoryMapView.ts', 'utf8');
const ASSETS_SRC = readFileSync('assets/script/app/territory/application/TerritoryPageAssets.ts', 'utf8');

const STATION_MODULE = loadTerritoryStationModule();
const ICON_RAW = STATION_MODULE.CONDITION_ICON_WIDTH_FALLBACK as number;
const ICON_SCALE = STATION_MODULE.CONDITION_ICON_SCALE as number;
const VALUE_SCALE = STATION_MODULE.CONDITION_VALUE_SCALE as number;
const ROW_GAP = STATION_MODULE.CONDITION_GAP as number;

/** `image/territory/icon_baoxiang` 实测尺寸（58×45）。 */
const CHEST_SIZE = { width: 58, height: 45 };
const CHEST_FRAME = { name: 'icon_baoxiang', originalSize: CHEST_SIZE };

/** 价格行高度 = 银币图标出厂 40 × 0.85（= 34）。 */
const ROW_HEIGHT = ICON_RAW * ICON_SCALE;
/** 宝箱显示高度 = 45 × 0.95（= 42.75）。 */
const CHEST_HEIGHT = CHEST_SIZE.height * TERRITORY_CONDITION_CHEST_SCALE;

interface IChestHandle {
    readonly node: FakeNode;
    readonly sprite: { spriteFrame: unknown };
    readonly transform: { contentSize: { width: number; height: number } };
}

function chestOf(view: unknown): IChestHandle | null {
    return (view as { conditionChest: IChestHandle | null }).conditionChest;
}

function contentOf(extra: Partial<StationRenderContent> = {}): StationRenderContent {
    return { site: null, icon: null, caption: '', tint: new FakeColor(), badge: '', interactive: true, ...extra };
}

/**
 * 平顶六边形（左右尖角、上下平边）在纵向 `y` 处的**半边可用宽**。
 *
 * 格面 123×90 以格心为中心：`|y| ≤ 22.5` 是中间那段等宽区（半宽 61.5），
 * 再往上/下线性收到上下平边的半宽 30.75。用来验证图标不会顶出斜边。
 */
function faceHalfWidthAt(y: number): number {
    const halfWidth = HEX_GRID_FACE_WIDTH / 2;
    const flatHalf = HEX_GRID_FACE_HEIGHT / 4;
    const taper = Math.max(0, (Math.abs(y) - flatHalf) / flatHalf);
    return halfWidth - (halfWidth / 2) * taper;
}

// ============================================================
// 一、排版公式：没有宝箱就必须是零偏移
// ============================================================

test('★★★没有宝箱图标 ⇒ rowY = 0（非宝箱格的排版一个像素都不许动）', () => {
    const plain = territoryConditionBlockLayout(ROW_HEIGHT, 0);
    assert.equal(plain.rowY, 0, '价格行仍压在格心 —— 这是旧版口径');
    assert.equal(plain.chestY, 0, '没有宝箱 ⇒ 没有第二个位置');
    assert.equal(plain.height, ROW_HEIGHT, '整块高 = 一行');
});

test('★★★有宝箱：宝箱在上、价格行在下，整块关于格心上下对称', () => {
    const block = territoryConditionBlockLayout(ROW_HEIGHT, CHEST_HEIGHT);
    assert.equal(block.height, CHEST_HEIGHT + TERRITORY_CONDITION_CHEST_GAP + ROW_HEIGHT);
    assert.equal(block.height, 77.75, '宝箱 42.75 + 间距 1 + 价格行 34');
    assert.equal(block.rowY, -21.875, '价格行下移半个（宝箱 + 间距）');
    assert.equal(block.chestY, 17.5, '宝箱上抬，让整块居中');

    const top = block.chestY + CHEST_HEIGHT / 2;
    const bottom = block.rowY - ROW_HEIGHT / 2;
    assert.equal(top + bottom, 0, '整块关于格心对称（美术图里那块是居中的，不贴下沿）');
    // 宝箱下沿与价格行上沿只差一个间距 —— 挨得再近就是重叠。
    const chestBottom = block.chestY - CHEST_HEIGHT / 2;
    const rowTop = block.rowY + ROW_HEIGHT / 2;
    assert.equal(chestBottom - rowTop, TERRITORY_CONDITION_CHEST_GAP);
    assert.ok(chestBottom - rowTop > 0, '两行不许叠在一起');
});

test('★★非有限 / 负数入参一律当「没有宝箱」，不产出退化几何', () => {
    for (const bad of [Number.NaN, Number.NEGATIVE_INFINITY, -10]) {
        const block = territoryConditionBlockLayout(ROW_HEIGHT, bad);
        assert.equal(block.chestY, 0, `${String(bad)} 不许被当成真实高度`);
        assert.equal(block.rowY, 0);
        assert.equal(block.height, ROW_HEIGHT);
    }
    // 价格行高度坏了也不许出 NaN（否则 setPosition 收到 NaN，整格飘到屏幕外，零报错）。
    const noRow = territoryConditionBlockLayout(Number.NaN, CHEST_HEIGHT);
    assert.ok(Number.isFinite(noRow.rowY) && Number.isFinite(noRow.chestY));
    assert.equal(noRow.height, CHEST_HEIGHT + TERRITORY_CONDITION_CHEST_GAP);
});

// ============================================================
// 二、整块必须塞进格面（第二轮需求的核心）
// ============================================================

test('★★★整块在格面内：上下留白 ≥ 1px，宝箱与价格行都不顶出斜边', () => {
    const block = territoryConditionBlockLayout(ROW_HEIGHT, CHEST_HEIGHT);
    const halfFace = HEX_GRID_FACE_HEIGHT / 2;

    // ① 竖直：整块高 77.75 ≤ 90，上下各留 6.125px。
    const margin = (HEX_GRID_FACE_HEIGHT - block.height) / 2;
    assert.ok(margin >= TERRITORY_CONDITION_FACE_MIN_MARGIN,
        `竖直留白 ${margin}px 必须 ≥ ${TERRITORY_CONDITION_FACE_MIN_MARGIN}px`);
    assert.ok(Math.abs(margin - 6.125) < 1e-9, `当前配数应留 6.125px，实际 ${margin}`);

    const chestTop = block.chestY + CHEST_HEIGHT / 2;
    const rowBottom = block.rowY - ROW_HEIGHT / 2;
    assert.ok(chestTop <= halfFace - TERRITORY_CONDITION_FACE_MIN_MARGIN,
        `宝箱上沿 ${chestTop} 不许顶到格面顶 ${halfFace}`);
    assert.ok(rowBottom >= -halfFace + TERRITORY_CONDITION_FACE_MIN_MARGIN,
        `价格行下沿 ${rowBottom} 不许顶到格面底 ${-halfFace}`);

    // ② 横向（宝箱）：它画在最上沿处，那里六边形已收窄 —— 必须按**收窄后的宽**验，不是 123。
    const chestWidth = CHEST_SIZE.width * TERRITORY_CONDITION_CHEST_SCALE;
    const chestAvailable = 2 * faceHalfWidthAt(chestTop);
    assert.ok(chestWidth <= chestAvailable - 2 * TERRITORY_CONDITION_FACE_MIN_MARGIN,
        `宝箱宽 ${chestWidth} 超出该高度可用宽 ${chestAvailable}`);

    // ③ 横向（价格行）：按**最坏**文案算 —— 全站最高解锁价 100（3 位数）。
    //    数字宽度取 `readConditionValueWidth` 的位数估算（Arial 17pt 数字步进 9.5）。
    const rowWidth = ROW_HEIGHT + ROW_GAP + 3 * 9.5 * VALUE_SCALE;
    const rowAvailable = 2 * faceHalfWidthAt(rowBottom);
    assert.ok(rowWidth <= rowAvailable - 2 * TERRITORY_CONDITION_FACE_MIN_MARGIN,
        `价格行宽 ${rowWidth} 超出该高度可用宽 ${rowAvailable}`);
});

// ============================================================
// 三、视图：真跑 TerritoryStationView
// ============================================================

test('★★★传了宝箱图 ⇒ 节点建出来、摆在价格行上方、帧与尺寸都对', () => {
    const { view } = makeStationView();
    view.setMapPosition(0, 0, 0);
    view.render(contentOf({
        isCondition: true,
        conditionIcon: { name: 'silver' },
        conditionChestIcon: CHEST_FRAME,
        caption: '10',
    }));

    const chest = chestOf(view);
    assert.ok(chest, '条件模式 + 有宝箱图 ⇒ 必须建出这颗节点');
    assert.equal(chest.node.active, true);
    assert.equal(chest.sprite.spriteFrame, CHEST_FRAME, '帧要落上去（池化复用时会换格换帧）');
    assert.deepEqual({ ...chest.transform.contentSize }, CHEST_SIZE,
        '节点尺寸 = 帧原始尺寸（0.95 是**缩放**，不改 contentSize）');
    assert.equal(chest.node.scale.x, TERRITORY_CONDITION_CHEST_SCALE, '宝箱缩到 0.95');
    assert.equal(chest.node.position.x, 0, '水平居中');
    assert.equal(chest.node.position.y, 17.5, '在价格行上方');
    // 价格行整体下移，给宝箱让位。
    assert.equal(view.captionSprite.node.position.y, -21.875);
    assert.equal(view.captionLabel.node.position.y, -21.875);
    assert.equal(view.captionSprite.node.scale.x, ICON_SCALE, '银币图标缩到 0.85');
    assert.equal(view.captionLabel.node.scale.x, VALUE_SCALE, '数字缩到 1.2');
    // 横向仍是一对居中：图标宽 34 / 数字 19×1.2 = 22.8 ⇒ 图标中心在 −11.9。
    assert.ok(Math.abs(view.captionSprite.node.position.x - -11.9) < 1e-9,
        `图标中心应在 −11.9，实际 ${view.captionSprite.node.position.x}`);
});

test('★★★不传宝箱图 ⇒ 不建 / 不显示，价格行回到格心（旧版零差异）', () => {
    const { view } = makeStationView();
    view.setMapPosition(0, 0, 0);
    view.render(contentOf({ isCondition: true, conditionIcon: { name: 'silver' }, caption: '10' }));
    assert.equal(chestOf(view), null, '没有宝箱图就不该建节点');
    assert.equal(view.captionSprite.node.position.y, 0, '价格行仍在格心');
    assert.equal(view.captionLabel.node.position.y, 0);
});

test('★★★未解锁（isCondition = false）即使传了图也只显示锁，不显示宝箱', () => {
    const { view } = makeStationView();
    view.setMapPosition(0, 0, 0);
    // 先按可激活画一帧（建出节点），再切回未解锁 —— 池化复用最容易在这里漏隐。
    view.render(contentOf({ isCondition: true, conditionIcon: { name: 'silver' }, conditionChestIcon: CHEST_FRAME, caption: '10' }));
    const chest = chestOf(view);
    assert.ok(chest);
    view.render(contentOf({ isCondition: false, caption: '', conditionChestIcon: CHEST_FRAME }));
    assert.equal(chest.node.active, false, '锁着的格不许留一颗宝箱在格心');
    // 价格行回到 prefab 偏移（非条件分支），不再是条件模式的居中位。
    assert.equal(view.captionSprite.node.position.y, 52);
});

test('★★生成缩放同时推进宝箱图标（基准 0.95），dispose 时节点一并销毁', () => {
    const { view } = makeStationView();
    view.setMapPosition(0, 0, 0);
    view.render(contentOf({ isCondition: true, conditionIcon: { name: 'silver' }, conditionChestIcon: CHEST_FRAME, caption: '10' }));
    const chest = chestOf(view);
    assert.ok(chest);
    assert.equal(chest.node.scale.x, TERRITORY_CONDITION_CHEST_SCALE);
    view.setConditionSpawnScale(0.5);
    assert.equal(chest.node.scale.x, TERRITORY_CONDITION_CHEST_SCALE * 0.5, '宝箱基准是 0.95，不是 1');
    assert.equal(view.captionSprite.node.scale.x, ICON_SCALE * 0.5, '价格行仍是基准 × 系数');
    view.dispose();
    assert.equal(chest.node.isValid, false, '节点挂在共享 caption 层上，dispose 必须手动销毁');
    assert.equal(chestOf(view), null);
});

// ============================================================
// 四、数据：只有 fixedResource 拿得到这张图
// ============================================================

interface IRenderInput {
    readonly stageByCell: Map<number, unknown>;
    readonly siteOpenableCells: number[];
    readonly pendingFixedResourceCells: number[];
    readonly art: Record<string, unknown>;
    readonly progress: { isCellUnlocked: () => boolean; isOwned: () => boolean };
}

test('★★★固定宝箱格可激活才传宝箱图标；关卡格同分支但拿不到', () => {
    const MapView = loadTerritoryMapViewClass() as new () => {
        stationRenderOf: (site: unknown, input: IRenderInput) => Record<string, unknown>;
    };
    const mapView = new MapView();
    const art = { randomSilverIcon: 'silver-icon', chestIcon: 'chest-icon' };
    const input: IRenderInput = {
        stageByCell: new Map(),
        siteOpenableCells: [],
        pendingFixedResourceCells: [],
        art,
        progress: { isCellUnlocked: () => false, isOwned: () => false },
    };
    const closed = { unlock: { silverCost: 10, staminaCost: 1 } };

    const fixed = mapView.stationRenderOf(
        { id: 'fixedResource_1', type: 'fixedResource', cellId: 305, ...closed }, input);
    assert.equal(fixed.isCondition, true, '前置满足 ⇒ 走「可激活」条件分支');
    assert.equal(fixed.conditionChestIcon, 'chest-icon', '宝箱格可激活 ⇒ 价格行之上加一颗宝箱');
    assert.equal(fixed.caption, '10', '银币数字照旧（用户：除了银币 icon + 数字外，新增宝箱 icon）');

    const stage = mapView.stationRenderOf(
        { id: 'stage_1', type: 'stage', cellId: 328, configId: '10001', ...closed }, input);
    assert.equal(stage.isCondition, true, '关卡格也走同一个条件分支');
    assert.equal(stage.conditionChestIcon, null, '关卡格不许长出宝箱图标');

    // 美术没交图 ⇒ 传 null，退回旧版只有价格行（不阻断）。
    const noChestArt = mapView.stationRenderOf(
        { id: 'fixedResource_2', type: 'fixedResource', cellId: 306, ...closed },
        { ...input, art: { randomSilverIcon: 'silver-icon' } });
    assert.equal(noChestArt.conditionChestIcon, null);
    assert.equal(noChestArt.isCondition, true, '缺图只影响那颗图标，价格行照旧');
});

// ============================================================
// 五、结构守卫：接线别被"顺手改回去"
// ============================================================

test('★★★视图用 model 的排版函数，宝箱高度先乘 0.95 再进排版', () => {
    assert.match(STATION_SRC, /territoryConditionBlockLayout\(iconHeight, chestHeight\)/,
        '竖直块必须走 model（纯函数可测），别在视图里另写一套加减');
    assert.match(STATION_SRC, /this\.conditionChestHeight \* TERRITORY_CONDITION_CHEST_SCALE/,
        '存的是未缩放高，进排版前要乘显示缩放 —— 否则块高按 45 算，白缩了');
    assert.match(STATION_SRC, /private applyConditionChest\(frame: SpriteFrame \| null, visible: boolean\): void/);
    assert.match(STATION_SRC,
        /this\.applyConditionChest\(content\.conditionChestIcon \?\? null, isCondition && !isHidden && !isLoading\)/,
        '落帧必须与「条件模式 + 没隐没 loading」同一条判据，且排在 applyCaptionPlacement 之前');
});

test('★★★美术：icon_baoxiang 从 territory 目录加载，落到 chestIcon 槽位', () => {
    assert.match(ASSETS_SRC, /spriteFramePath\(TERRITORY_ART_ROOT, 'icon_baoxiang'\)/,
        '与锁标 / 地皮同目录（同进 auto-atlas，能合批）');
    assert.match(ASSETS_SRC, /readonly chestIcon: SpriteFrame \| null;/);
});

test('★★★数据：只有 fixedResource 分支传 conditionChestIcon', () => {
    // 赋值只许出现在「可激活」那一个分支里：多一处就说明有别的格也长了宝箱。
    const assigned = MAP_SRC.match(/conditionChestIcon:/g) ?? [];
    assert.equal(assigned.length, 1, `conditionChestIcon 只该赋值一次，实际 ${assigned.length} 处`);
    assert.match(MAP_SRC, /site\.type === TERRITORY_SITE_TYPE\.fixedResource\s*\r?\n\s*\?\s*input\.art\.chestIcon/,
        '判据必须是站点类型，不是「有没有图」');
    // 渲染契约只有一处声明（`TerritoryStationView` 的入参接口）。
    const declared = STATION_SRC.match(/readonly conditionChestIcon\?: SpriteFrame \| null;/g) ?? [];
    assert.equal(declared.length, 1);
});
