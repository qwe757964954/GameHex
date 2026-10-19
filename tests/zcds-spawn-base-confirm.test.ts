/**
 * 【战斗系统】选择基地模式（钉钉表「demo 体验反馈」2026-10-14 / 优化 / 优先级中）的回归。
 *
 * 需求四条：
 *   1. 进入时在该位置展示基地建筑模型，并高亮基地相邻 6 格（填充 = 深蓝 `#1D24C8`）；
 *   2. 基地正下方 2 格处显示绿色【确认位置】按钮；
 *   3. 点其他格子 ⇒ 基地移动，按钮与高亮圈一起跟过去；
 *   4. 点【确认位置】⇒ 退出选基地模式，基地落定，高亮消失。
 *
 * 实现刻意**沿用既有的 `cityMode: 'select'` 骨架**（倒计时 / 半区限制 / AI 自动确认 / 顶栏 HUD
 * 一个都没动），只加了三件事：地块填充多一位 `homeHighlight`、落点几何（`spawnBaseConfirmPoint`）、
 * 以及跟着基地走的那颗按钮 —— 后者**不新建节点**，而是把选点 HUD 里现成的绿勾
 * `ZCSpawnSelection.prefab/ConfirmSpawn` 借到棋盘层（2026-10-15 删掉了自己手画的
 * `ui/game/ZCSpawnBaseConfirm`，理由是两套按钮必然长出两套染色/显隐判据）。
 *
 * 所以下面逐条钉的就是这三件事 —— 不去重复覆盖 `zcds-spawn-selection.test.ts` 已经管住的
 * 倒计时 / 半区 / AI 时机。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { loadViews } from './helpers/zcds-view-fixtures';
import { HEX_GRID_VIEW_ROW_SPACING } from '../assets/script/core/hex/HexGridLayout';
import {
    configureZCMap,
    getZCMapOwner,
    getZCMapSection,
    ZC_HEX_CONFIG,
    ZC_MAP_COLUMNS,
    ZC_MAP_HOMES,
    ZC_MAP_ID,
    ZC_MAP_PLAYER_COUNT,
    ZC_MAP_REGIONS,
    ZC_MAP_RESOURCE_POINTS,
    ZC_MAP_ROWS,
    ZC_MAP_SPACING,
    type ZCMapLayout,
} from '../assets/script/app/zcds/model/ZCGameModel';
import type { ZCMatchMap } from '../assets/script/app/zcds/model/ZCMatchConfig';
import { ZCSpawnSelection } from '../assets/script/app/zcds/model/ZCSpawnSelection';

// ============================================================
// 选点地图夹具
// ============================================================

/**
 * 8×8 的 select 图，上下半场二分：`row < 4` 是 2 区（敌），`row ≥ 4` 是 1 区（我）。
 * 默认主城按需求写成 `homes`，我方那座落在 (5,4) —— **内圈格**，6 个邻格齐全，
 * 正是需求 1 说的「相邻的 6 个六边形格子」。
 */
const PLAYER_HOME_ROW = 5;
const PLAYER_HOME_COLUMN = 4;
const SELECT_LAYOUT: ZCMapLayout = {
    id: 'spawn-base-confirm-test',
    version: 3,
    rows: 8,
    columns: 8,
    playerCount: 2,
    cityMode: 'select',
    ascii: [
        '22222222', '22222222', '22222222', '22222222',
        '11111111', '11111111', '11111111', '11111111',
    ],
    homes: [
        { row: PLAYER_HOME_ROW, column: PLAYER_HOME_COLUMN },
        { row: 2, column: 3 },
    ],
    spacing: { homeMinDistance: 2, resourceMinDistance: 3 },
};

function makeMap(layout: ZCMapLayout = SELECT_LAYOUT): ZCMatchMap {
    configureZCMap(layout);
    return {
        id: ZC_MAP_ID,
        rows: ZC_MAP_ROWS,
        columns: ZC_MAP_COLUMNS,
        playerHomeId: -1,
        enemyHomeId: -1,
        playerCount: ZC_MAP_PLAYER_COUNT,
        cityMode: 'select',
        // 默认主城由 `configureZCMap` 把 `{row,column}` 翻成格子 id；这里必须搬真值，
        // 写死 `[]` 会让「预置落点」退化到「第一个合法格」，把默认主城那条口径悄悄测没了。
        homes: ZC_MAP_HOMES,
        hexes: ZC_HEX_CONFIG,
        owners: ZC_HEX_CONFIG.map((hex) => getZCMapOwner(hex.id)),
        sections: ZC_HEX_CONFIG.map((hex) => getZCMapSection(hex.id)),
        regions: ZC_MAP_REGIONS,
        resourcePoints: ZC_MAP_RESOURCE_POINTS,
        spacing: ZC_MAP_SPACING,
    };
}

const PLAYER_HOME_ID = PLAYER_HOME_ROW * SELECT_LAYOUT.columns + PLAYER_HOME_COLUMN;

// ============================================================
// 需求 1 / 4：默认落点、邻格高亮判据
// ============================================================

test('进入选点即预置默认落点，且不额外消耗随机源', () => {
    let draws = 0;
    const selection = new ZCSpawnSelection(makeMap(), () => { draws += 1; return 0.5; });

    assert.equal(draws, 1, '构造期只该消耗「每个 AI 一次确认延时」这一次随机（2 人局 = 1 次）');
    assert.equal(
        selection.snapshot.selections.player.selectedHexId, PLAYER_HOME_ID,
        '玩家一进来就要有落点（不然需求 1 的「展示基地 + 高亮周边」无从画起），取地图声明的默认主城',
    );
    assert.equal(selection.snapshot.selections.enemy.selectedHexId, null,
        'AI 不预置：预置会让 autoConfirm 不再摇随机格，整局唯一那条随机源的次序就全错了');
    assert.equal(selection.isPlacing('player'), true);
});

test('基地邻格高亮 = 该落点在地图上的真实邻格（内圈 6 个）', () => {
    const selection = new ZCSpawnSelection(makeMap(), () => 0.5);
    const baseId = selection.snapshot.selections.player.selectedHexId!;
    const neighbors = selection.baseNeighborIds('player');

    // 关系只由地图的 `neighbors` 给出，渲染层不许自己按行列推。
    assert.deepEqual([...neighbors], [...selection.map.hexes[baseId].neighbors]);
    assert.equal(neighbors.length, 6, '需求说的「相邻的 6 格」= 内圈满值');
    assert.equal(neighbors.includes(baseId), false, '高亮圈不含基地自己那一格');
});

test('点其他格子只移动落点：高亮圈跟着换，且不自动确认（需求 3 与 4 必须分开）', () => {
    const selection = new ZCSpawnSelection(makeMap(), () => 0.5);
    const before = [...selection.baseNeighborIds('player')];
    const other = 6 * SELECT_LAYOUT.columns + 3;

    assert.equal(selection.select('player', other).ok, true);
    assert.equal(selection.snapshot.selections.player.selectedHexId, other, '基地移到新格上');
    assert.equal(selection.snapshot.selections.player.confirmedHexId, null,
        '点格子只是「移动」，不是「确认」—— 否则玩家没机会再挑');
    assert.deepEqual([...selection.baseNeighborIds('player')], [...selection.map.hexes[other].neighbors],
        '高亮圈必须同步挪到新基地周围');
    assert.notDeepEqual([...selection.baseNeighborIds('player')], before);
});

test('确认后 isPlacing 转 false（高亮与按钮的收掉判据），而落点本身不清空', () => {
    const selection = new ZCSpawnSelection(makeMap(), () => 0.5);
    const neighbors = [...selection.baseNeighborIds('player')];

    assert.equal(selection.confirm('player').ok, true);
    assert.equal(selection.isPlacing('player'), false, '需求 4：确认后高亮消失、按钮收起');
    assert.deepEqual([...selection.baseNeighborIds('player')], neighbors,
        '落点仍留着（结算要用），「收起高亮」靠 isPlacing 而不是清空 selectedHexId');
    assert.equal(selection.snapshot.finished, false,
        '⚠️ 我方确认后整体阶段还没结束（要等 AI）—— 所以判据只能用 isPlacing，不能用 finished');
});

// ============================================================
// 需求 2 / 3：按钮落点几何
// ============================================================

test('【确认位置】按钮落在基地正下方 2 个格子单位（= 行距 90 × 2）', () => {
    const { load } = loadViews();
    const util = load('./ZCGameViewUtil');

    assert.equal(util.SPAWN_BASE_CONFIRM_ROW_OFFSET, 2);
    // 「1 个格子单位」取**行距**：需求说的是「正下方」，那是同列方向；列距（92.25）是斜邻居的
    // 横向分量，拿它算 y 偏移会让同一个数字在别的口径下对不上。
    assert.equal(util.spawnBaseConfirmOffsetY(), -2 * HEX_GRID_VIEW_ROW_SPACING);
    assert.equal(util.spawnBaseConfirmOffsetY(), -180);

    // 逐字段比而不是 deepEqual：返回值来自 vm 里那个 realm，跨 realm 的对象原型不同，
    // deepEqual 会以「原型不等」为由红掉，看起来像几何算错。
    const point = util.spawnBaseConfirmPoint({ x: 33, y: 77 });
    assert.equal(point.x, 33, '正下方 = x 不变');
    assert.equal(point.y, 77 - 180);
});

// ============================================================
// 需求 1：深蓝高亮的填充优先级
// ============================================================

/** 地块视图桩（与 `zcds-building-icon-scale.test.ts` 同套；补 `resourceUnitNodes` 供资源单位分支）。 */
function stubHexView(load: (name: string) => any, cc: any, bar: () => any): any {
    const view = new (load('./ZCHexView').ZCHexView)();
    const sprite = () => ({ node: bar().node, enabled: true, spriteFrame: null, color: null });
    for (const key of ['tileSprite', 'buildingSprite', 'iconSprite', 'priceIcon']) view[key] = sprite();
    view.groundGlow = { ...sprite(), color: { r: 255, g: 255, b: 255, a: 180 }, customMaterial: null };
    for (const key of ['tileFrame', 'mineIconFrame', 'barracksIconFrame', 'mysteryFrame',
        'mineFrame', 'ruinsFrame', 'enemyDevelopFrame',
        'goldResourceFrame', 'mineResourceFrame', 'chestResourceFrame']) view[key] = { name: key };
    view.buildingLayer = bar().node;
    view.iconLabel = { node: bar().node, string: '', enabled: true, color: null };
    view.outlineGraphics = new cc.Graphics();
    view.healthBar = bar();
    view.cooldownBar = bar();
    view.resourceUnitNodes = [];
    return view;
}

const SPAWN_PRESENTATION = {
    sectionOwner: 'player',
    selectedBy: null,
    confirmed: false,
    blocked: false,
    resourcePoint: false,
    unlocksResource: false,
};

/** 取地块填充的 RGBA（视图里的 Color 来自 vm realm，只能逐字段读）。 */
const tintOf = (sprite: any): [number, number, number, number] =>
    [sprite.color.r, sprite.color.g, sprite.color.b, sprite.color.a];

test('基地邻格填充 = 需求指定的深蓝 #1D24C8，且压得过「受阻红」', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);

    view.renderSpawnSelection({ ...SPAWN_PRESENTATION, homeHighlight: true });
    assert.deepEqual(tintOf(view.tileSprite), [0x1D, 0x24, 0xC8, 170],
        '深蓝 #1D24C8；alpha 170 是既有「领地 60% 透明度」口径下比领地(150)略实一档的高亮');

    // 那 6 格里大半属于「敌半区 / 距离过近」等受阻格：靠底色表达受阻会盖掉需求要的蓝，
    // 所以高亮优先，受阻改由格面 × 文案表达。
    view.renderSpawnSelection({ ...SPAWN_PRESENTATION, blocked: true, homeHighlight: true });
    assert.deepEqual(tintOf(view.tileSprite), [0x1D, 0x24, 0xC8, 170], '高亮必须压过受阻红');

    view.renderSpawnSelection({ ...SPAWN_PRESENTATION, blocked: true, homeHighlight: false });
    assert.deepEqual(tintOf(view.tileSprite), [255, 148, 148, 150], '没有高亮时受阻红照旧');
});

// ============================================================
// 需求 2 / 4：按钮本体 —— 借用选点 HUD 里现成的绿勾 `ConfirmSpawn`
// ============================================================

/** `ZCGame` 是组件、`cc` 只认真引擎，用例里用沙箱装载（白名单与 `zcds-settlement.test.ts` 同源）。 */
function loadZCGameClass(): { ZCGame: any; Widget: unknown } {
    const Widget = class {};
    const dependencies: Record<string, unknown> = {
        cc: {
            _decorator: { ccclass: () => (value: unknown) => value, property: () => () => {} },
            Component: class {}, instantiate: () => ({}), Node: class {}, Prefab: class {},
            SpriteFrame: class {}, Vec3: class {}, Widget,
        },
        './ui/GameRunAway': { GameRunAway: class {} },
        './ui/ZCSettlementPage': { ZCSettlementPage: class {} },
        './ui/ZCGuidePanel': { ZCGuidePanel: class {} },
        './model/ZCCombatCatalog': {}, './view/ZCGameHUDView': {}, './model/ZCGameModel': {},
        './model/ZCRankBoard': { buildRankSeats: () => [] },
        './view/ZCGameRankBoard': { ZCGameRankBoard: class {} },
        './model/ZCMapConfig': { ZC_OWNER_ORDER: ['player', 'enemy'] },
        './model/ZCMatchConfig': { captureZCMatchConfig: () => ({}) },
        './model/ZCSpawnSelection': {}, './view/ZCSpawnSelectionView': {},
        './view/ZCHudBossPanel': {}, './application/ZCClientCombatConfig': {},
        './view/ZCGameRenderWorld': {}, './view/ZCGameViewUtil': {},
        '../battle/BattleResultService': { BattleResultService: { ensureListening: () => {} } },
        '../showReward/RewardFrames': { resolveCmdGoodsFrames: () => Promise.resolve([]) },
        '../itemdetail/ItemDetailTable': { itemNumberTextOf: (n: unknown) => String(n) },
        './model/ZCGameRuntimeConfig': {}, './model/ZCSeededRandom': {},
        '../ArtPaths': {}, '../HeadArt': { HeadArt: {} },
        '../../framework/ref/RefUtil': {},
        '../../framework/FW': { FW: { showTip: () => {} } },
        '../../core/runtime/GameRoute': { GameRoute: { Main: 'main' } },
        '../../framework/procedure/ProcedureManager': { ProcedureManager: { navigate: () => {} } },
        '../../framework/ui/PopupDef': { PopupLayer: { SYSTEM: 1 }, PopupCloseReason: { Force: 3 } },
        '../battle/BattleStartService': {
            finishBattle: () => Promise.resolve(null), BATTLE_RESULT_WIN: 1, BATTLE_RESULT_LOSE: 2,
        },
    };
    const context = { exports: {} as any, console, require: (name: string) => {
        assert.ok(name in dependencies, name);
        return dependencies[name];
    } };
    const code = ts.transpileModule(readFileSync('assets/script/app/zcds/ZCGame.ts', 'utf8'), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true,
        },
    }).outputText;
    runInNewContext(code, context);
    return { ZCGame: context.exports.ZCGame, Widget };
}

/** 够用的节点替身：只实现借出/归还真正会碰到的那几个方法。 */
function fakeNode(name: string, parent: any = null): any {
    const node: any = {
        name, parent, children: [] as any[], active: true, isValid: true, layer: 33554432,
        destroyed: 0, index: 0,
        position: { x: 28, y: -399, z: 0, clone(): any { return { x: node.position.x, y: node.position.y, z: node.position.z }; } },
        setParent(next: any): void {
            if (node.parent) node.parent.children = node.parent.children.filter((child: any) => child !== node);
            node.parent = next ?? null;
            if (next) next.children.push(node);
        },
        setSiblingIndex(index: number): void { node.index = index; },
        getSiblingIndex(): number { return node.index; },
        setPosition(x: any, y?: number, z?: number): void {
            node.position = typeof x === 'object' ? { ...x } : { x, y, z };
        },
        destroy(): void {
            node.destroyed += 1; node.isValid = false;
            // 真引擎销毁会把节点从父级的 children 里摘掉；不模拟的话「是否留在棋盘上」这类断言全是假的。
            if (node.parent) node.parent.children = node.parent.children.filter((child: any) => child !== node);
            node.parent = null;
        },
        getComponent(): unknown { return null; },
    };
    if (parent) parent.children.push(node);
    return node;
}

/** 装配一个只跑「借出 / 归还」的 `ZCGame`。 */
function borrowFixture(options: { withLayer?: boolean; withButton?: boolean } = {}) {
    const { ZCGame, Widget } = loadZCGameClass();
    const game: any = new ZCGame();
    const widget = { enabled: true };
    const hudRoot = fakeNode('ZCSpawnSelection');
    const confirm = options.withButton === false ? null : fakeNode('ConfirmSpawn', hudRoot);
    if (confirm) {
        confirm.index = 7;
        confirm.getComponent = (type: unknown) => (type === Widget ? widget : null);
    }
    const mapLayer = options.withLayer === false ? null : fakeNode('MapLayer');
    const injected: unknown[] = [];
    game.spawnSelectionView = { confirmButton: confirm };
    game.hudView = { mapLayer, node: hudRoot };
    game.renderWorld = { setSpawnConfirmButton: (node: unknown) => injected.push(node) };
    return { game, confirm, widget, hudRoot, mapLayer, injected };
}

test('借用：按钮改挂棋盘层、Widget 关掉、原位记下来，并把节点交给世界层', () => {
    const { game, confirm, widget, hudRoot, mapLayer, injected } = borrowFixture();

    game.borrowSpawnConfirmButton();

    assert.equal(confirm.parent, mapLayer, '需求 2：按钮要跟着基地走，就得挂到棋盘层（不是 HUD 层）');
    assert.deepEqual(mapLayer.children, [confirm]);
    assert.deepEqual(hudRoot.children, [], '借出后原父级下不再有它');
    // 🔴 最关键的一步：按钮在 HUD 里靠 Widget 钉在屏幕底部（水平居中 + 底边 200px），
    // 换父级后 Widget 仍会按那套规则把它拽回去，跟逐帧写的基地坐标打架。
    assert.equal(widget.enabled, false);
    assert.deepEqual(injected, [confirm], '世界层拿到节点，之后按基地格心逐帧写位置');

    const borrow = game.spawnConfirmBorrow;
    assert.equal(borrow.parent, hudRoot);
    assert.equal(borrow.index, 7, '归还时要塞回原来的兄弟序');
    assert.deepEqual(
        { x: borrow.position.x, y: borrow.position.y, z: borrow.position.z }, { x: 28, y: -399, z: 0 },
        '原位坐标；且必须是 clone（拿引用会被后面的 setPosition 改写掉）',
    );
    assert.notEqual(borrow.position, confirm.position);
    assert.equal(borrow.widget, widget);
});

test('归还：放回原父级原位、恢复 Widget，并把世界层的引用摘掉', () => {
    const { game, confirm, widget, hudRoot, mapLayer, injected } = borrowFixture();
    game.borrowSpawnConfirmButton();
    // 模拟世界层在棋盘上把它挪到了基地下方。
    confirm.setPosition(120, -640, 0);

    game.restoreSpawnConfirmButton();

    assert.equal(confirm.parent, hudRoot, '必须送回选点 HUD：不送回去它就随 HUD 一起销毁不了');
    assert.equal(confirm.index, 7);
    assert.deepEqual(confirm.position, { x: 28, y: -399, z: 0 });
    assert.equal(widget.enabled, true, 'Widget 要还原，否则下一局按钮会歪');
    assert.deepEqual(injected, [confirm, null], '摘引用 —— Node.destroy() 当帧 isValid 仍为 true');
    assert.equal(game.spawnConfirmBorrow, null, '还完就清账，重复归还不能再动节点');
    assert.equal(confirm.destroyed, 0);
});

test('归还：原父级已经没了就销毁按钮（否则它会永远留在棋盘上）', () => {
    const { game, confirm, mapLayer, injected } = borrowFixture();
    game.borrowSpawnConfirmButton();
    game.hudView = null;
    game.spawnSelectionView = null;
    // 对局被强制拆掉：选点 HUD 先没了。
    (game.spawnConfirmBorrow as any).parent.destroy();

    game.restoreSpawnConfirmButton();

    assert.equal(confirm.destroyed, 1, '没有归宿的按钮不能留在棋盘层');
    assert.equal(mapLayer.children.length, 0);
    assert.deepEqual(injected, [confirm, null]);
});

test('借用 / 归还都不挑场景：缺棋盘层或缺按钮就什么都不做，且可以重复归还', () => {
    const { game, injected } = borrowFixture({ withLayer: false });
    game.borrowSpawnConfirmButton();
    assert.equal(game.spawnConfirmBorrow, null, '没有棋盘层就干脆不借（按钮留在 HUD 原位，行为退化成改版前）');
    assert.deepEqual(injected, [], '借都没借，世界层不该收到任何节点');

    const bare = borrowFixture({ withButton: false });
    bare.game.borrowSpawnConfirmButton();
    assert.equal(bare.game.spawnConfirmBorrow, null);

    // 没借过就归还 / 借了归两次：都不能抛（退出对局与选点结束是两条都会走到的路径）。
    bare.game.restoreSpawnConfirmButton();
    bare.game.restoreSpawnConfirmButton();
});

// ============================================================
// 接线守卫：按钮从哪来、挂到哪、什么时候收
// ============================================================

test('按钮沿用 HUD 那颗绿勾：没有第二套 prefab，位置由世界层按基地格心写', () => {
    const gameSource = readFileSync('assets/script/app/zcds/ZCGame.ts', 'utf8');
    const loaderSource = readFileSync('assets/script/app/zcds/application/ZCGameLoader.ts', 'utf8');
    const worldSource = readFileSync('assets/script/app/zcds/view/ZCGameRenderWorld.ts', 'utf8');
    const selectionViewSource = readFileSync('assets/script/app/zcds/view/ZCSpawnSelectionView.ts', 'utf8');
    const hexViewSource = readFileSync('assets/script/app/zcds/view/ZCHexView.ts', 'utf8');

    // 已删掉的手画按钮不允许留下任何残骸：两份实现会各有一套染色 / 显隐判据，必然分叉。
    // 只查**代码**：注释里提到它（为什么删、当初为什么画）是应该保留的，不算残骸。
    const strip = (source: string) =>
        source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/[^\n']*$/gm, '');
    for (const source of [strip(gameSource), strip(loaderSource), strip(worldSource)]) {
        assert.doesNotMatch(source, /ZCSpawnBaseConfirm/);
        assert.doesNotMatch(source, /spawnBaseConfirmPrefab/);
    }
    assert.doesNotMatch(strip(gameSource), /disposeSpawnBaseConfirm/);

    // 来源 = 选点 HUD 上现成的 `ConfirmSpawn`（`ZCSpawnSelectionView.confirmButton`）。
    assert.match(gameSource, /const button = this\.spawnSelectionView\?\.confirmButton;/);
    assert.match(gameSource, /const layer = this\.hudView\?\.mapLayer;/);
    assert.match(gameSource, /button\.setParent\(layer\);/);
    assert.match(gameSource, /const widget = button\.getComponent\(Widget\);/);
    assert.match(gameSource, /if \(widget\) widget\.enabled = false;/);
    assert.match(gameSource, /this\.renderWorld\?\.setSpawnConfirmButton\(button\);/);
    // 选点结束与退出对局都要归还。
    assert.match(gameSource, /private borrowSpawnConfirmButton\(\): void/);
    assert.match(gameSource, /private restoreSpawnConfirmButton\(\): void/);
    assert.equal((gameSource.match(/this\.restoreSpawnConfirmButton\(\);/g) ?? []).length, 2);
    // 还原三件套：父级 / 兄弟序 / 坐标 + Widget。
    assert.match(gameSource, /node\.setParent\(borrow\.parent\);/);
    assert.match(gameSource, /node\.setSiblingIndex\(borrow\.index\);/);
    assert.match(gameSource, /node\.setPosition\(borrow\.position\);/);
    assert.match(gameSource, /if \(borrow\.widget\) borrow\.widget\.enabled = true;/);

    // 归还必须在拆选点 HUD **之前**（按钮此刻挂在棋盘层，不送回去就销毁不掉）。
    const finish = gameSource.slice(
        gameSource.indexOf('private finishSpawnSelection()'),
        gameSource.indexOf('private applyResult('),
    );
    assert.ok(finish.indexOf('this.restoreSpawnConfirmButton()') < finish.indexOf('spawnSelectionView?.node.destroy()'),
        'finishSpawnSelection 里要先归还再销毁 HUD');

    // 跟随：位置逐帧由世界层写；显示判据是「我方还在选点」（需求 4 的收起条件）。
    assert.match(worldSource, /const playerBaseId = selection\.isPlacing\('player'\) \? playerSelection : null;/);
    assert.match(worldSource, /selection\.baseNeighborIds\('player'\)/);
    assert.match(worldSource, /homeHighlight: playerBaseNeighbors\.has\(config\.id\)/);
    assert.match(worldSource, /spawnBaseConfirmPoint\(\{ x: mapToViewX\(hex\.x\), y: mapToViewY\(hex\.y\) \}\)/);
    assert.match(worldSource, /private renderSpawnConfirmButton\(baseHexId: number \| null\): void/);
    assert.match(worldSource, /setSpawnConfirmButton\(node: Node \| null\): void/);

    // 染色 / 显隐 / 点击仍然只归 `ZCSpawnSelectionView`，世界层不许重复管一套。
    assert.match(selectionViewSource, /confirmButton\.on\(Node\.EventType\.TOUCH_END/);
    assert.match(selectionViewSource, /this\.confirmButton\.active = !waiting;/);
    assert.match(selectionViewSource, /this\.confirmIcon\.color = invalid/);
    assert.doesNotMatch(worldSource, /confirmIcon/);

    // 旧的「基地邻格 = 归属到该方染色」的表现已下线，别再复活出第二套口径。
    assert.doesNotMatch(hexViewSource, /isHomeNeighbor/);
    assert.doesNotMatch(worldSource, /isHomeNeighbor/);
});

test('确认按钮用的是 HUD 上那颗绿勾节点（`btn_gou.png`），不在别处另起一份', () => {
    const prefab = JSON.parse(readFileSync('assets/resources/ui/game/ZCSpawnSelection.prefab', 'utf8'));
    const nodes = prefab.filter((object: any) => object.__type__ === 'cc.Node');
    const confirm = nodes.find((node: any) => node._name === 'ConfirmSpawn');
    assert.ok(confirm, '选点 HUD 里必须有 ConfirmSpawn —— 借用的就是它');
    assert.equal(confirm._layer, 33554432, 'UI_2D');

    const components = confirm._components.map((ref: any) => prefab[ref.__id__]);
    const sprite = components.find((component: any) => component.__type__ === 'cc.Sprite');
    assert.ok(sprite, '绿勾是 Sprite 画的');
    assert.equal(sprite._spriteFrame.__uuid__, '5f18794c-236e-4cba-94b4-13c297595dbc@f9941', 'btn_gou.png');
    // 那份 Widget（水平居中 + 底边 200px）正是借用时必须关掉的东西。
    assert.ok(components.some((component: any) => component.__type__ === 'cc.Widget'));

    // 全工程只有这一个按钮用到绿勾图，不存在第二颗「确认」按钮。
    const meta = JSON.parse(readFileSync('assets/resources/image/gameui/btn_gou.png.meta', 'utf8'));
    // 子资源 uuid 带 `@f9941` 后缀（SpriteFrame 子元），比前缀即可。
    assert.ok(meta.subMetas.f9941.uuid.startsWith('5f18794c-236e-4cba-94b4-13c297595dbc'));
    assert.ok((sprite._spriteFrame.__uuid__ as string).startsWith(meta.subMetas.f9941.uuid));
});
