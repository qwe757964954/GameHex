import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { guideMapFocusCells } from '../assets/script/app/territory/application/TerritoryViewState';
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
