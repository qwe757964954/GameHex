import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { guideMapFocusCells, isTerritoryChestActionable } from '../assets/script/app/territory/application/TerritoryViewState';
import { TERRITORY_SITE_TYPE } from '../assets/script/app/territory/model/TerritoryMapConfig';
import { HEX_GRID_FACE_WIDTH, HEX_GRID_FACE_HEIGHT } from '../assets/script/core/hex/HexGridLayout';

// 执行真实方法；隔离与焦点无关的资源加载和引擎生命周期。
const source = ts.createSourceFile('MainTerritoryMap.ts', readFileSync(
    'assets/script/app/main/MainTerritoryMap.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const page = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'MainTerritoryMap') as ts.ClassDeclaration;
const method = page.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === 'getGuideFocusNode')!;
const code = ts.transpileModule(`exports.focus = class { ${method.getText(source)} }.prototype.getGuideFocusNode;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const exports: { focus?: (key: string) => object | null } = {};
runInNewContext(code, { exports, guideMapFocusCells, HEX_GRID_FACE_WIDTH, HEX_GRID_FACE_HEIGHT,
    Vec3: class {}, UITransform: class {} });

test('首帧定位或视口变化让缓存格离屏时，焦点恢复到另一可翻且可见的格', () => {
    const nodes = new Map([[1, { activeInHierarchy: true, worldPosition: { x: 0, y: 0 } }],
        [2, { activeInHierarchy: true, worldPosition: { x: 150, y: 0 } }]]);
    const viewport = { width: 720, height: 1112,
        convertToNodeSpaceAR: (point: object, out: object) => Object.assign(out, point) };
    const host = { state: { randomResourceOpenableCells: [1, 2] },
        mapView: { getGuideCellNode: (id: number) => nodes.get(id) },
        mapScrollView: { node: { getComponent: () => viewport } },
        guideFocusKey: '', guideFocusCell: null };
    const focus = () => exports.focus!.call(host, 'Map/Tile_1');
    assert.equal(focus(), nodes.get(1));
    // 更近的候选出现也保持当前可见目标，避免呼吸光圈来回跳。
    nodes.get(2)!.worldPosition.x = 0;
    nodes.get(1)!.worldPosition.x = 100;
    assert.equal(focus(), nodes.get(1));
    nodes.get(1)!.worldPosition.y = 400;
    viewport.height = 600;
    assert.equal(focus(), nodes.get(2));
    nodes.get(2)!.activeInHierarchy = false;
    assert.equal(focus(), null);
    nodes.get(1)!.worldPosition.y = 0;
    assert.equal(focus(), nodes.get(1));
});

test('Map/Chest_N 只给「已翻出未点开」的宝箱，翻地步给「还没翻出来的宝箱」+ 随机格', () => {
    // 资源据点是两步：第一下 unlock（翻出箱子）、第二下 pass（点开箱子）。
    // 11 = 已翻出未点开（2-2 的目标）；12 = 还没翻出来（2-1 的目标）；13 = 关卡；14 = 已领过。
    const progress = {
        isCellUnlocked: (id: number) => id === 11 || id === 14,
        isOwned: (id: number) => id === 14,
    };
    const state = {
        map: { sites: [
            { cellId: 11, type: TERRITORY_SITE_TYPE.fixedResource },
            { cellId: 12, type: TERRITORY_SITE_TYPE.fixedResource },
            { cellId: 13, type: TERRITORY_SITE_TYPE.stage },
            { cellId: 14, type: TERRITORY_SITE_TYPE.fixedResource },
        ] },
        siteOpenableCells: [12, 13],
        randomResourceOpenableCells: [21],
        stageByCell: new Map<number, { levelId: number }>(),
        progress,
    };

    // 🔴 `2-2 打开宝箱`：这一格此刻已经**不在** `siteOpenableCells`（那里只收未解锁的格），
    // 只判那个集合会得到空集 ⇒ 孔挖不出来 ⇒ 整屏点击区把玩家锁死（实机踩过）。
    assert.deepEqual(guideMapFocusCells('Map/Chest_1', state), [11]);
    // `2-1 翻第1块地`：随机格 + 还能翻出来的宝箱；已翻出/已领过的不算「翻一格」。
    assert.deepEqual(guideMapFocusCells('Map/Tile_1', state), [21, 12]);
    // 箱子都点开了 ⇒ 空集，由调用方退回「无焦点」，不会指到别的格子上。
    assert.deepEqual(guideMapFocusCells('Map/Chest_1',
        { ...state, progress: { ...progress, isOwned: () => true } }), []);
    // 翻地步同理：没有可翻的宝箱时保持原来的随机格口径，不静默变成空。
    assert.deepEqual(guideMapFocusCells('Map/Tile_1', { ...state, siteOpenableCells: [13] }), [21]);
});

test('引导「翻地/点宝箱」判据同源：两步都算可推进，关卡与已领过的不算', () => {
    const progress = {
        isCellUnlocked: (id: number) => id === 11 || id === 14,
        isOwned: (id: number) => id === 14,
    };
    const state = {
        map: { sites: [
            { cellId: 11, type: TERRITORY_SITE_TYPE.fixedResource },
            { cellId: 12, type: TERRITORY_SITE_TYPE.fixedResource },
            { cellId: 13, type: TERRITORY_SITE_TYPE.stage },
            { cellId: 14, type: TERRITORY_SITE_TYPE.fixedResource },
        ] },
        siteOpenableCells: [12, 13],
        progress,
    };
    // 手指指到哪，点到哪就必须上报 `tileFlipped`（两处共用这一个函数）。
    assert.equal(isTerritoryChestActionable(state, 11), true, '已翻出未点开');
    assert.equal(isTerritoryChestActionable(state, 12), true, '还没翻出来');
    assert.equal(isTerritoryChestActionable(state, 14), false, '已经领过');
    assert.equal(isTerritoryChestActionable(state, 13), false, '关卡不是宝箱');
    assert.equal(isTerritoryChestActionable(state, 99), false, '不存在的格子');
});
