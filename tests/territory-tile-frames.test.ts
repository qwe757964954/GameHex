import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

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
 * | 已解锁未通关 · 普通关卡 | `tileLocked` | `frameStage`（`frame_03`） |
 * | 已解锁未通关 · 异步关卡 | `tileLocked` | `frameAsyncPvp`（`frame_04`） |
 * | 已解锁未通关 · 宝箱 | `tileLocked` | `frameChest`（`fram_02`，美术少写一个 e） |
 * | **已通关 / 已领取** | **`tileCleared`（`img_land_01` 草地）** | **无** |
 *
 * ⚠️ 这张表是**行为**口径，只能用 vm 桩跑真 `paintHexes` 验；源码正则只能当补充。
 * 早先「一张灰图 + 三色 tint」的实现整段删了，反向断言会挡住它回流。
 */

const MAP_VIEW_PATH = 'assets/script/app/territory/view/TerritoryMapView.ts';
const ASSETS_PATH = 'assets/script/app/territory/application/TerritoryPageAssets.ts';
const BUILDING_DIR = 'assets/resources/image/buildings';

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
            if (id === './TerritoryStationView') return { TerritoryStationView: class {} };
            if (id === './TerritoryResourceGainView') return { TerritoryResourceGainView: class {} };
            if (id.endsWith('/TerritoryResourceGain')) return {
                TERRITORY_GAIN_STACK_GAP_PX: 40,
                TERRITORY_GAIN_START_LIFT_PX: 30,
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
            throw new Error(`Unexpected dependency: ${id}`);
        },
    });
    return moduleExports.TerritoryMapView as new () => Record<string, unknown>;
}

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

test('★★美术引用与磁盘：六张图都在、尺寸与代码口径一致（换图必须回来重算贴合）', () => {
    const source = readFileSync(ASSETS_PATH, 'utf8');
    // 名字逐字对照美术文件名 —— `fram_02` 少一个 e 是**美术的原始拼写**，别"顺手改对"。
    const expected: Record<string, [number, number]> = {
        img_land_02: [126, 117],
        img_land_01: [126, 117],
        frame_01: [124, 92],
        frame_03: [124, 92],
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
    // 旧灰图不该再被领地引用（它已由两张成品图取代；对局侧本来也不用它）。
    assert.doesNotMatch(stripComments(source), /'img_land_01_gray'/,
        '领地已经改用 img_land_01 / img_land_02，灰图引用应已删除');
});

test('★TerritoryPresenter 的默认 art 字面量必须与接口同步（漏字段会静默退成 undefined）', () => {
    const presenter = readFileSync('assets/script/app/territory/application/TerritoryPresenter.ts', 'utf8');
    for (const field of ['tileLocked', 'tileCleared', 'frameBoss', 'frameStage', 'frameAsyncPvp', 'frameChest']) {
        assert.match(presenter, new RegExp(`${field}: null`), `Presenter 默认 art 缺字段：${field}`);
    }
    assert.doesNotMatch(stripComments(presenter), /\btile: null/, '旧的单张 tile 字段已删除');
});
