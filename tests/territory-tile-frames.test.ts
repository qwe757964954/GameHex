import * as mvcEvents from '../assets/script/app/territory/application/TerritoryEvents';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import {
    MAP_MARKER_BUBBLE_FRAME_PASSED_PATH,
    MAP_MARKER_BUBBLE_FRAME_PENDING_PATH,
} from '../assets/script/app/common/MapMarkerBadge';
import { assetPath } from './helpers/asset-paths';

/**
 * 领地图纸「地皮 + 格面框」的判据（2026-10-16 山猫需求）。
 *
 * ## 口径原文
 *
 * 「未解锁用 `img_land_02`，通关用 `img_land_01`；Boss 解锁在格子上放 `frame_01`，
 *   异步关卡解锁 `frame_04`，宝箱用 `fram_02`；frame 是放在立体格子上；
 *   通关了，frame 要去掉，用 `img_land_01`。」
 *
 * 逐条落成的实现口径：
 * | 格子状态 | 地皮 | 格面框 |
 * |---|---|---|
 * | 未解锁 | `tileLocked`（`img_land_02` 泥土） | 无（「解锁」就是框出现的那一刻） |
 * | 已解锁未通关 · 首领 | `tileLocked` | `frameBoss`（`frame_01`） |
 * | 已解锁未通关 · 普通关卡 | `tileLocked` | `frameStage`（**2026-10-28 起同首领那张 `frame_01` 红**，原 `frame_03` 紫） |
 * | 已解锁未通关 · 异步关卡 | `tileLocked` | `frameAsyncPvp`（`frame_04`） |
 * | 已解锁未通关 · 宝箱 | `tileLocked` | `frameChest`（`fram_02`，美术少写一个 e） |
 * | **已通关 / 已领取** | **`tileCleared`（`img_land_01` 草地）** | **无** |
 *
 * ⚠️ 这张表是**行为**口径，只能用 vm 桩跑真 `paintHexes` 验；源码正则只能当补充。
 * 早先「一张灰图 + 三色 tint」的实现整段删了，反向断言会挡住它回流。
 */

const MAP_VIEW_PATH = 'assets/script/app/territory/view/TerritoryMapView.ts';
const ASSETS_PATH = 'assets/script/app/territory/application/TerritoryPageAssets.ts';
const BUILDING_DIR = assetPath('image/buildings');

/** 剥掉注释再匹配（规则 104：注释里为解释"为什么不能这么写"会带上被禁的写法）。 */
const stripComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

// ── 行为判据：用 vm 桩跑真 paintHexes ──────────────────────────────────

interface ICellState {
    readonly unlocked: ReadonlySet<number>;
    readonly owned: ReadonlySet<number>;
    readonly areaPassed: ReadonlySet<number>;
}

/** 格子节点 + 它的视觉组件（桩里 `getComponent` 恒返回同一个对象，同时充当 Sprite 与 UITransform）。 */
function makeHexCell() {
    const component = {
        spriteFrame: null as unknown,
        enabled: false,
        color: { r: 0, g: 0, b: 0, a: 0, equals: () => false },
        contentSize: { width: 0, height: 0 },
        setContentSize(this: { contentSize: { width: number; height: number } }, w: number, h: number) {
            this.contentSize = { width: w, height: h };
        },
    };
    const node = { active: false, getComponent: () => component };
    return { node, component };
}

/** 格面框的 Sprite：`applyHexFrame` 会读 `sprite.node.active` 与 `sprite.node.getComponent(UITransform)`。 */
function makeFrameSprite() {
    const sprite: {
        spriteFrame: unknown; enabled: boolean;
        contentSize: { width: number; height: number };
        setContentSize: (w: number, h: number) => void;
        node: { active: boolean; getComponent: () => unknown };
    } = {
        spriteFrame: null,
        enabled: false,
        contentSize: { width: 0, height: 0 },
        setContentSize(w: number, h: number) { sprite.contentSize = { width: w, height: h }; },
        node: { active: false, getComponent: () => sprite },
    };
    return sprite;
}

function loadMapView() {
    const source = readFileSync(MAP_VIEW_PATH, 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: {
        experimentalDecorators: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
    } }).outputText;
    const moduleExports: Record<string, unknown> = {};
    runInNewContext(code, {
        exports: moduleExports,
        require: (id: string) => {
            if (id === 'cc') return {
                _decorator: { ccclass: () => (value: unknown) => value, property: () => () => undefined },
                Component: class {},
                // `paintHexes` 把地皮色写回绝对白 ⇒ 桩要提供 `Color.WHITE`。
                Color: { WHITE: { r: 255, g: 255, b: 255, a: 255 } },
            };
            if (id.endsWith('/HexGridLayout')) return {
                HEX_GRID_CONTENT_LIFT: 12.5,
                HEX_GRID_IMAGE_WIDTH: 130,
                HEX_GRID_IMAGE_HEIGHT: 119,
                HEX_GRID_FACE_WIDTH: 123,
                HEX_GRID_FACE_HEIGHT: 90,
            };
            // `bottomAnchor` 判定（69008~69015 底部对齐）由 TerritoryMapView 调用，
            // 桩里必须给函数，否则 `undefined is not a function`；本夹具只关心地皮/格面 ⇒ 恒 false。
            if (id === './TerritoryStationView') {
                return { TerritoryStationView: class {}, territoryUsesBottomAnchor: () => false };
            }
            if (id === './TerritoryResourceGainView') return { TerritoryResourceGainView: class {} };
            // 喷发粒子（2026-10-16 row17）：夹具只关心地皮 / 格面框，给个空壳即可。
            if (id === './TerritoryGainBurst') return {
                TERRITORY_GAIN_BURST_NODE: 'GainBurst',
                TerritoryGainBurst: class {},
            };
            if (id.endsWith('/TerritoryResourceGain')) return {
                TERRITORY_GAIN_STACK_GAP_PX: 40,
                TERRITORY_GAIN_START_LIFT_PX: 40,
                TERRITORY_SILVER_RES_ID: 7,
                TERRITORY_STAMINA_RES_ID: 9,
            };
            if (id === './TerritoryHexFlip') return {
                TerritoryHexFlip: class {
                    setEffect() {}
                    step() { return false; }
                    play() { return false; }
                    reset() {}
                    isPlaying() { return false; }
                },
            };
            if (id === './TerritoryTheme') return {
                TERRITORY_COLORS: {
                    gold: 'gold', locked: 'locked', cleared: 'cleared', owned: 'owned',
                    danger: 'danger', exploring: 'exploring', available: 'available',
                    randomConditionText: 'red', randomAvailableText: 'white',
                },
                TERRITORY_STATION_STATE: {
                    owned: 'owned', exploring: 'exploring', available: 'available', locked: 'locked',
                },
                territoryStationTint: () => 'gold',
                territoryBossTint: () => 'danger',
                territoryUnboundTint: () => 'async-brown',
            };
            if (id.endsWith('/TerritoryTexts')) return {
                TERRITORY_TEXTS: { pendingConfig: '待配置', lockBadge: '锁' },
                TERRITORY_UNBOUND_TYPE_NAMES: {
                    stage: '关卡', boss: '首领', asyncPvp: '异步', fixedResource: '资源据点', bonus: '奖励据点',
                },
            };
            // 事件契约：纯常量表，给桩（与 `view/TerritoryEvents.ts` 同值）。
            if (id === './TerritoryEvents') return {
                TERRITORY_EVENTS: {
                    STATION_CLICK: 'territory:station-click',
                    PREVIOUS_CHAPTER: 'territory:previous-chapter',
                    NEXT_CHAPTER: 'territory:next-chapter',
                    DETAIL_CLOSE: 'territory:detail-close',
                    DETAIL_START: 'territory:detail-start',
                },
            };
            // MapView 按站点类型命名常量判定（2026-10-19 起），需运行时值桩。
            if (id === '../model/TerritoryMapConfig') return {
                TERRITORY_SITE_TYPE: {
                    stage: 'stage', boss: 'boss', asyncPvp: 'asyncPvp',
                    fixedResource: 'fixedResource', bonus: 'bonus',
                },
            };
            // 内容层留白（2026-10-21）：`syncContentSize` 现在把「地图包围盒 + 四周留白」写进
            // 内容层，留白归 `TerritoryMapLayout` 统一算。本用例不校验尺寸，桩只保证宽度高度可用。
            if (id.endsWith('/TerritoryMapLayout')) return {
                // 2026-10-27：`contentPaddingBottom` 的初值直接取这个常量、偏移取它的一半，
                // 桩缺了会让字段变 `undefined`（尺寸算出 NaN，用例看着"莫名其妙整片红"）。
                TERRITORY_MAP_CONTENT_PADDING: 300,
                // 2026-10-27：顶部留白也是运行时值（`(bottom − top)/2` 决定内容层偏移），
                // 桩缺了同样会让偏移变 NaN ⇒ 一并给 0。
                TERRITORY_MAP_CONTENT_PADDING_TOP: 0,
                territoryMapContentShiftY: (padding = 300, top = 0) => (padding - top) / 2,
                territoryMapContentSize: (layout: { width: number; height: number }) => ({
                    width: layout.width,
                    height: layout.height,
                }),
            };
            // 开箱表演 / 点击反馈（2026-10-22）：`TerritoryMapView` 新增的两个表现层，
            // 与本用例关注的渲染分支无关 ⇒ 给空壳（它们的曲线在 `territory-chest-animation`
            // / `territory-tap-feedback` 里单独测）。
            if (id === './TerritoryChestView') return { TerritoryChestView: class {} };
            if (id === './TerritoryTapFeedback') return { TerritoryTapFeedback: class {} };
            // 新地块生成（2026-10-22）：只影响地皮的**透明度与缩放**，不改地皮 / 格面框的
            // 选图判据 ⇒ 空壳（曲线在 `territory-hex-spawn` 里单独测）。六个成员都要在，
            // 因为 `TerritoryMapView` 的 `syncGrid` / `syncFlip` / `applyHexSpawnFade` 都会调。
            if (id === './TerritoryHexSpawn') return {
                TerritoryHexSpawn: class {
                    isPlaying() { return false; }
                    play() { return false; }
                    opacityOf() { return null; }
                    stop() {}
                    reset() {}
                    step() { return false; }
                },
            };
            if (id === '../model/TerritoryHexSpawn') return {
                territoryHexSpawnDelays: () => new Map<number, number>(),
                territoryHexSpawnBatchSeconds: () => 0,
            };
            // 未解锁云（2026-10-23）：`TerritoryMapView` 又多了一条表现层依赖。本用例关注的
            // 渲染分支与云无关（云的层序 / 帧序 / 消散在 `territory-cloud` 里单独测）⇒ 空壳，
            // 成员按 MapView 实际调用面补齐（`attach` / `setFrames` / `sync` / `step` / `reset`）。
            if (id === './TerritoryCloudView') return {
                TERRITORY_CLOUD_LAYER_NODE: 'CloudLayer',
                TerritoryCloudView: class {
                    attach(): void {}
                    setFrames(): void {}
                    sync(): void {}
                    step(): void {}
                    reset(): void {}
                },
            };
            // 未解锁云的**格位集合**（2026-10-23）：MapView 多了一条来自 model 的**值导入**
            // （`territoryCloudCells`），不只是 class。本用例的判据与云无关 ⇒ 给空集合
            // （视图那边全是空壳，没人读这些常量）。
            if (id === '../model/TerritoryCloud') return {
                territoryCloudCells: () => [],
                TERRITORY_CLOUD_SCALE: 1,
                TERRITORY_CLOUD_ART_OFFSET_Y: -21,
            };
            // 通关换色（2026-10-23 第三轮）：`TerritoryMapView` 又多了一条表现层依赖。
            // 它只影响**换色那两层的缩放 / 透明度**，不改地皮与格面框的选图判据
            // ⇒ 空壳（曲线在 `territory-hex-recolor` 里单独测）。
            // 六个成员按 MapView 实际调用面补齐：step / stop / reset / isPlaying / play / hideGround。
            if (id === './TerritoryHexRecolor') return {
                TERRITORY_HEX_RECOLOR_NEW_NODE: 'HexRecolorNew',
                TERRITORY_HEX_RECOLOR_OLD_NODE: 'HexRecolorOld',
                TerritoryHexRecolor: class {
                    step(): void {}
                    stop(): void {}
                    reset(): void {}
                    isPlaying() { return false; }
                    play(): void {}
                    hideGround(): void {}
                },
            };
            if (id === '../model/TerritoryHexRecolor') return {
                territoryHexRecolorDelays: () => new Map<number, number>(),
            };
            //  事件走 `EventMgr` 全局中控（组件侧 emit、页面侧 on 都经它）。
            if (id.includes('event/EventMgr')) {
                return { EventMgr: { instance: { emit() {}, on() {}, offTarget() {} } } };
            }
            if (id === '../application/TerritoryEvents') return mvcEvents;
            throw new Error(`Unexpected dependency: ${id}`);
        },
    });
    return moduleExports.TerritoryMapView as new () => Record<string, unknown>;
}

test('章节战斗站点气泡显示章节-关卡（连字符不留空格），未解锁条件格与资源点不带气泡', () => {
    const View = loadMapView();
    const view = new View();
    Object.assign(view, { stationIconOf: () => ({ name: 'building' }), stateOf: () => 'available' });
    const render = (view as unknown as { stationRenderOf(site: unknown, input: unknown): {
        levelBubble?: string; levelBubbleFrame?: unknown; isCondition?: boolean;
    } }).stationRenderOf.bind(view);
    let unlocked = true;
    const input = {
        stageByCell: new Map([[1, { chapterId: 3, stage: 12 }]]),
        art: { randomSilverIcon: {}, levelBubbleFrame: { name: 'frame_01' } }, siteOpenableCells: [1], pendingFixedResourceCells: [],
        map: { sites: [] },
        progress: { isCellUnlocked: () => unlocked, isOwned: () => false, isAreaPassed: () => false },
    };
    for (const type of ['stage', 'boss', 'asyncPvp']) {
        const site = { cellId: 1, type, configId: '10012', unlock: { silverCost: 399, requiredCells: [] } };
        unlocked = true;
        // 2026-10-28 按美术效果图对齐：`1-1` 连字符两侧**没有空格**，
        // 字距交给 `MAP_MARKER_BADGE_SPACING_X`，不能再往字符串里塞空格。
        // 🔴 同日第二轮：**异步据点不写编号，写 `PVP`** —— 它可重复挑战，
        //    编号会被读成"第 12 关，打一次就过"（详见 `TERRITORY_ASYNC_PVP_BUBBLE_TEXT`）。
        assert.equal(render(site, input).levelBubble, type === 'asyncPvp' ? 'PVP' : '3-12',
            '主线/首领显示章节-关卡；异步据点固定 PVP');
        assert.equal(render(site, input).levelBubbleFrame, input.art.levelBubbleFrame);
        unlocked = false;
        const locked = render(site, input);
        assert.equal(locked.levelBubble, undefined);
        assert.equal(locked.isCondition, true);
    }
    unlocked = true;
    assert.equal(render({ cellId: 1, type: 'fixedResource' }, input).levelBubble, undefined);
});

test('气泡底图必须按通关状态分色：未通关红 frame_02 / 已通关蓝 frame_03，且都能在磁盘上找到', () => {
    // 🔴 2026-10-29 10:11 用户（附截图圈出蓝色 `1-2`）：「需要区分未通关关卡的气泡 icon 底色是红色」。
    // 2026-10-28 16:23 那句「改回蓝色」说的是**已通关那颗变绿**，不是要所有气泡同色。
    assert.equal(MAP_MARKER_BUBBLE_FRAME_PENDING_PATH, 'image/spawn-region/frame_02/spriteFrame',
        '未通关必须是红色那张（spawn-region 下的 frame_02）');
    assert.equal(MAP_MARKER_BUBBLE_FRAME_PASSED_PATH, 'image/spawn-region/frame_03/spriteFrame',
        '已通关保持蓝色那张（spawn-region 下的 frame_03）');
    assert.notEqual(MAP_MARKER_BUBBLE_FRAME_PASSED_PATH, MAP_MARKER_BUBBLE_FRAME_PENDING_PATH,
        '两档必须不同图，否则「通没通过」在气泡上分不出来');
    for (const path of [MAP_MARKER_BUBBLE_FRAME_PASSED_PATH, MAP_MARKER_BUBBLE_FRAME_PENDING_PATH]) {
        assert.match(path, /^image\/spawn-region\/frame_0[123]\/spriteFrame$/,
            '必须落在 spawn-region 下 —— image/buildings/ 里同名的是首领的红色六边形格面框');
        const png = `assets/bundles/battle/${path.replace('/spriteFrame', '')}.png`;
        assert.equal(existsSync(png), true, `美术切图缺失：${png}`);
    }
});

test('气泡底图按「通没通过」二选一：未通关红、已通关蓝，红图缺失回退蓝图', () => {
    const View = loadMapView();
    const view = new View();
    Object.assign(view, { stationIconOf: () => ({ name: 'building' }), stateOf: () => 'available' });
    const render = (view as unknown as { stationRenderOf(site: unknown, input: unknown): {
        levelBubbleFrame?: unknown;
    } }).stationRenderOf.bind(view);
    const blue = { name: 'frame_03' };
    const red = { name: 'frame_02' };
    let passed = false;
    const base = {
        stageByCell: new Map([[1, { chapterId: 1, stage: 3 }]]),
        art: { randomSilverIcon: {}, levelBubbleFrame: blue, levelBubblePendingFrame: red },
        siteOpenableCells: [1], pendingFixedResourceCells: [],
        map: { sites: [] },
        // 2026-10-28：判据是**区域口径**（`isAreaPassed`）。同一 `configId` 的兄弟格共享通关状态，
        // 按 `isCellUnlocked` 判会出现「一格通关、兄弟格还红」。
        progress: { isCellUnlocked: () => true, isOwned: () => false, isAreaPassed: () => passed },
    };
    const site = { cellId: 1, type: 'stage', configId: '10001', unlock: { silverCost: 0, requiredCells: [] } };
    assert.equal(render(site, base).levelBubbleFrame, red, '未通关 ⇒ 红色底图');
    passed = true;
    assert.equal(render(site, base).levelBubbleFrame, blue, '已通关 ⇒ 蓝色底图');
    passed = false;
    const noRed = { ...base, art: { ...base.art, levelBubblePendingFrame: undefined } };
    assert.equal(render(site, noRed).levelBubbleFrame, blue,
        '红色底图没加载到时必须回退蓝图 —— 不能让这一格连编号都没有');
});

test('已通关的关卡仍然可点（要能打开领地关卡信息弹窗）', () => {
    const View = loadMapView();
    const view = new View();
    Object.assign(view, { stationIconOf: () => ({ name: 'building' }), stateOf: () => 'available' });
    const render = (view as unknown as { stationRenderOf(site: unknown, input: unknown): {
        interactive?: boolean;
    } }).stationRenderOf.bind(view);
    const base = (pending: boolean) => ({
        stageByCell: new Map([[1, { chapterId: 1, stage: 3 }]]),
        art: { randomSilverIcon: {}, levelBubbleFrame: { name: 'frame_01' },
            levelBubblePendingFrame: { name: 'frame_02' } },
        siteOpenableCells: [], pendingFixedResourceCells: pending ? [1] : [],
        map: { sites: [] },
        progress: { isCellUnlocked: () => true, isOwned: () => true, isAreaPassed: () => true },
    });
    // 🔴 2026-10-28 用户：「点击已通过的关卡也可以打开【领地关卡信息弹窗】」。
    // 以前这里是 `claimed ? isAsyncPvp : true` ⇒ 打完的 stage/boss 直接不可点，点建筑毫无反应。
    for (const type of ['stage', 'boss', 'asyncPvp']) {
        const site = { cellId: 1, type, configId: '10001', unlock: { silverCost: 0, requiredCells: [] } };
        assert.equal(render(site, base(false)).interactive, true,
            `已通关的 ${type} 必须仍可点，否则关卡信息弹窗打不开`);
    }
    // 唯一不可点的情况：请求在途（防连点）。
    const stage = { cellId: 1, type: 'stage', configId: '10001', unlock: { silverCost: 0, requiredCells: [] } };
    assert.equal(render(stage, base(true)).interactive, false, '请求在途时必须禁掉，防连点');
});

test('气泡层排在透明站点命中层之后，避免相邻行抢走编号点击', () => {
    const View = loadMapView();
    const view = new View();
    let badgeIndex = 4;
    Object.assign(view, {
        stationHitLayer: { getSiblingIndex: () => 5 },
        stationBadgeLayer: { getSiblingIndex: () => badgeIndex, setSiblingIndex: (index: number) => { badgeIndex = index; } },
    });
    (view as unknown as { getStationLayers(): unknown }).getStationLayers();
    assert.equal(badgeIndex, 5, '从前方移除并插入原 hitIndex 后，气泡层位于命中层之上');
});

const TILE_LOCKED = { name: 'img_land_02', originalSize: { width: 126, height: 117 } };
const TILE_CLEARED = { name: 'img_land_01', originalSize: { width: 126, height: 117 } };
const FRAME_BOSS = { name: 'frame_01', originalSize: { width: 124, height: 92 } };
const FRAME_STAGE = { name: 'frame_03', originalSize: { width: 124, height: 92 } };
const FRAME_ASYNC = { name: 'frame_04', originalSize: { width: 124, height: 92 } };
const FRAME_CHEST = { name: 'fram_02', originalSize: { width: 124, height: 92 } };

/** 一张含全部状态的图：起始格 / 四种站点 × 解锁与否 / 通关与否 / 随机格 / 中立格 / 未探索格。 */
function paintSampleMap() {
    const MapView = loadMapView();
    const mapView = new MapView();
    const cells = new Map<number, ReturnType<typeof makeHexCell>>();
    const frames = new Map<number, ReturnType<typeof makeFrameSprite>>();
    for (const cellId of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) {
        cells.set(cellId, makeHexCell());
        frames.set(cellId, makeFrameSprite());
    }
    (mapView as { hexNodes: Map<number, unknown> }).hexNodes =
        new Map(Array.from(cells, ([id, cell]) => [id, cell.node]));
    (mapView as { hexFrames: Map<number, unknown> }).hexFrames =
        new Map(Array.from(frames, ([id, frame]) => [id, frame]));

    const state: ICellState = {
        // 2=首领已解锁 / 5=普通关卡已解锁 / 6=异步已解锁 / 7=宝箱已解锁未领 / 9=奖励据点已解锁 / 10=随机格已开启
        unlocked: new Set([2, 5, 6, 7, 9, 10]),
        // 8=宝箱已领取
        owned: new Set([8]),
        // 4=首领已通关（区域口径）
        areaPassed: new Set([4]),
    };
    const sites = [
        { id: 'boss_2', type: 'boss', cellId: 2, unlock: {} },
        { id: 'boss_3', type: 'boss', cellId: 3, unlock: {} },
        { id: 'boss_4', type: 'boss', cellId: 4, unlock: {} },
        { id: 'stage_5', type: 'stage', cellId: 5, unlock: {} },
        { id: 'async_6', type: 'asyncPvp', cellId: 6, unlock: {} },
        { id: 'chest_7', type: 'fixedResource', cellId: 7, unlock: {} },
        { id: 'chest_8', type: 'fixedResource', cellId: 8, unlock: {} },
        { id: 'bonus_9', type: 'bonus', cellId: 9, unlock: {} },
    ];
    (mapView as { paintHexes: (input: unknown) => void }).paintHexes({
        revealedCells: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        map: {
            startCellId: 1,
            sites,
            randomSites: { candidateCells: [10, 11] },
        },
        progress: {
            isCellUnlocked: (id: number) => state.unlocked.has(id),
            isOwned: (id: number) => state.owned.has(id),
            isAreaPassed: (id: number) => state.areaPassed.has(id),
        },
        art: {
            tileLocked: TILE_LOCKED, tileCleared: TILE_CLEARED,
            frameBoss: FRAME_BOSS, frameStage: FRAME_STAGE,
            frameAsyncPvp: FRAME_ASYNC, frameChest: FRAME_CHEST,
        },
    });
    return { cells, frames };
}

test('★★★未通关格用 img_land_02、已通关格用 img_land_01（起始格按通关算）', () => {
    const { cells } = paintSampleMap();
    const tileOf = (id: number) => cells.get(id)!.component.spriteFrame;
    // 起始格 = 我方基地 ⇒ 草地。
    assert.equal(tileOf(1), TILE_CLEARED, '起始格必须按已通关渲染（草地）');
    // 未解锁 / 已解锁未通关 / 中立 / 随机格未开启 ⇒ 一律泥地。
    for (const cellId of [2, 3, 5, 6, 7, 9, 11, 12]) {
        assert.equal(tileOf(cellId), TILE_LOCKED, `cell ${cellId} 未通关 ⇒ img_land_02`);
    }
    // 已通关 / 已领取 / 随机格已开启 ⇒ 草地。
    assert.equal(tileOf(4), TILE_CLEARED, '已通关首领 ⇒ 草地');
    assert.equal(tileOf(8), TILE_CLEARED, '已领取宝箱 ⇒ 草地');
    assert.equal(tileOf(10), TILE_CLEARED, '随机格开启即算通关 ⇒ 草地');
});

test('★★★格面框按站点类型四选一，且只给「已解锁未通关」的格', () => {
    const { frames } = paintSampleMap();
    const frameOf = (id: number) => frames.get(id)!.spriteFrame;
    assert.equal(frameOf(2), FRAME_BOSS, '首领已解锁 ⇒ frame_01');
    assert.equal(frameOf(5), FRAME_STAGE, '普通关卡已解锁 ⇒ frame_03');
    assert.equal(frameOf(6), FRAME_ASYNC, '异步关卡已解锁 ⇒ frame_04');
    assert.equal(frameOf(7), FRAME_CHEST, '宝箱已解锁未领 ⇒ fram_02');
});

test('★★★通关后 frame 必须去掉（需求原文：通关了，fram 要去掉）', () => {
    const { frames } = paintSampleMap();
    const frameOf = (id: number) => frames.get(id)!.spriteFrame;
    // 已通关的首领：`isAreaPassed` 为真 ⇒ 即便仍处于已解锁态也不能留框。
    assert.equal(frameOf(4), null, '已通关首领不得残留 frame_01');
    // 已领取的宝箱同理。
    assert.equal(frameOf(8), null, '已领取宝箱不得残留 fram_02');
    // 随机格已开启 ⇒ 不叠框（框只给四类战斗/宝箱站点）。
    assert.equal(frameOf(10), null, '随机资源格不叠格面框');
});

test('★★未解锁格不叠框、「解锁」这个动作才是框出现的那一刻', () => {
    const { frames } = paintSampleMap();
    const frameOf = (id: number) => frames.get(id)!.spriteFrame;
    assert.equal(frameOf(3), null, '未解锁首领不得提前出现 frame_01');
    assert.equal(frameOf(11), null, '未开启随机格不叠框');
    assert.equal(frameOf(12), null, '中立格不叠框');
    // 节点必须真的收起（写绝对 active，换章复用后不能残留上一次的状态）。
    assert.equal(frames.get(3)!.node.active, false);
    assert.equal(frames.get(2)!.node.active, true);
});

test('★★奖励据点（bonus）没有对应美术框 ⇒ 查不到就不叠，不许硬指一张', () => {
    const { frames } = paintSampleMap();
    assert.equal(frames.get(9)!.spriteFrame, null, 'bonus 不在 TERRITORY_SITE_FRAME 表里');
});

test('★★未探索格仍然整格隐藏（与旧 tintHexes 行为一致）', () => {
    const { cells, frames } = paintSampleMap();
    assert.equal(cells.get(13)!.node.active, false, '未 revealed 的格不显示');
    assert.equal(frames.get(13)!.node.active, false, '连框也不该被点亮');
});

test('★★地皮不再三色染色：颜色恒写绝对白，且尺寸跟帧走（126×117 不再被拉伸到 130×119）', () => {
    const { cells } = paintSampleMap();
    const cell = cells.get(2)!.component;
    assert.equal(cell.color.r, 255);
    assert.equal(cell.color.g, 255);
    assert.equal(cell.color.b, 255);
    // 🔴 尺寸必须等于帧的画布尺寸：钉死 130×119 会把新图（126×117）非等比拉伸，
    //    而格面框（124×92）是照实际格面画的 ⇒ 框会缩在格子中间。
    assert.deepEqual(cell.contentSize, { width: 126, height: 117 });
});

test('★★格面框的尺寸也按帧 1:1（124×92），不写 0 也不写 0×0', () => {
    const { frames } = paintSampleMap();
    assert.deepEqual(frames.get(2)!.contentSize, { width: 124, height: 92 });
});

// ── 源码守卫：口径别回流 / 美术别丢 ─────────────────────────────────────

test('★旧的三色 tint 口径不得回流（TERRITORY_COLORS.map* 与 tintHexes 都已删除）', () => {
    const code = stripComments(readFileSync(MAP_VIEW_PATH, 'utf8'));
    assert.doesNotMatch(code, /tintHexes/, 'drawMap 用的旧方法名已删除，回流说明染色口径又回来了');
    assert.doesNotMatch(code, /TERRITORY_COLORS\.map(Owned|Target|Neutral)/, '地皮不再染色');
    // 反向：新入口必须存在（否则上面两条会因为「整段函数被删」而假绿）。
    assert.match(code, /private paintHexes\(/);
    // 通关后摘框的口径必须写在代码里（不是靠数据巧合规避）。
    assert.match(code, /if \(passed\) return null;/);
});

test('★类型→框的映射表：四类站点逐个对上，bonus 不在表里', () => {
    const code = stripComments(readFileSync(MAP_VIEW_PATH, 'utf8'));
    assert.match(code, /boss: 'frameBoss'/);
    assert.match(code, /stage: 'frameStage'/);
    assert.match(code, /asyncPvp: 'frameAsyncPvp'/);
    assert.match(code, /fixedResource: 'frameChest'/);
    assert.doesNotMatch(code, /bonus: 'frame/, 'bonus 没有美术框，别为了表全硬指一张');
});

test('★★美术引用与磁盘：五张图都在、尺寸与代码口径一致（换图必须回来重算贴合）', () => {
    const source = readFileSync(ASSETS_PATH, 'utf8');
    // 名字逐字对照美术文件名 —— `fram_02` 少一个 e 是**美术的原始拼写**，别"顺手改对"。
    const expected: Record<string, [number, number]> = {
        img_land_02: [126, 117],
        img_land_01: [126, 117],
        frame_01: [124, 92],
        frame_04: [124, 92],
        fram_02: [124, 92],
    };
    for (const [name, [width, height]] of Object.entries(expected)) {
        assert.ok(source.includes(`spriteFramePath(BUILDING_ART_ROOT, '${name}')`),
            `TerritoryPageAssets 缺少美术引用：${name}`);
        const png = `${BUILDING_DIR}/${name}.png`;
        assert.ok(existsSync(png), `美术不在磁盘上：${png}`);
        // 读 PNG 头（IHDR）校验尺寸：尺寸一变，格面框与格子的贴合规口就要重算。
        const header = readFileSync(png).subarray(16, 24);
        assert.equal(header.readUInt32BE(0), width, `${name} 宽度变了 ⇒ 回来核对格面框贴合`);
        assert.equal(header.readUInt32BE(4), height, `${name} 高度变了 ⇒ 回来核对格面框贴合`);
    }
    // 紫框退役：2026-10-28 山猫要求「未通过的关卡地表与 Boss 一致（红）」⇒ 普通关卡改吃 `frame_01`。
    // 图还留在美术目录里，但**代码不许再引用** —— 否则"地表又变紫了"会静默回流。
    assert.doesNotMatch(stripComments(source), /'frame_03'/,
        '普通关卡已改用 frame_01 红框，紫框 frame_03 不该再被引用');
    // 旧灰图不该再被领地引用（它已由两张成品图取代；对局侧本来也不用它）。
    assert.doesNotMatch(stripComments(source), /'img_land_01_gray'/,
        '领地已经改用 img_land_01 / img_land_02，灰图引用应已删除');
});

test('★TerritoryPresenter 的默认 art 字面量必须与接口同步（漏字段会静默退成 undefined）', () => {
    const presenter = readFileSync('assets/script/app/territory/application/TerritoryModel.ts', 'utf8');
    for (const field of ['tileLocked', 'tileCleared', 'frameBoss', 'frameStage', 'frameAsyncPvp', 'frameChest']) {
        assert.match(presenter, new RegExp(`${field}: null`), `Presenter 默认 art 缺字段：${field}`);
    }
    assert.doesNotMatch(stripComments(presenter), /\btile: null/, '旧的单张 tile 字段已删除');
});
