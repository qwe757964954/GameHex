import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as geometry from '../assets/script/app/bigmap/view/BigMapWorldLayout';

/**
 * 城池聚焦口径（2026-11-03 用户：*「在大地图点击城池据点后，隐藏其他的城池据点和玩家基地
 * 以及野怪模型，只展示该城池据点，城池据点连带着名称和等级的UI节点上移200px」*）。
 *
 * `BigMapWorldView` 是 cc 组件，这里用最小 `cc` 桩转译加载（同 `bigmap-camp-view` 的夹具），
 * 直接驱动 `cullMarkers` / `applyFocusIsolation` 两个纯逻辑入口。
 */

// 🔴 2026-11-03 两轮口径：先 200，后「还需要上移100px（85% 极限机位验收）」⇒ 总量 300
const FOCUS_LIFT = 300;

function loadViewClass() {
    const source = readFileSync('assets/script/app/bigmap/view/BigMapWorldView.ts', 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: {
        target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true,
    } }).outputText;
    const exports: Record<string, unknown> = {};
    runInNewContext(code, { exports, require: (name: string) => {
        if (name === 'cc') return {
            _decorator: { ccclass: () => (value: unknown) => value, property: () => () => undefined },
            Color: class Color {},
            Component: class { isValid = true; node = { activeInHierarchy: true }; },
            Vec2: class Vec2 { constructor(public x = 0, public y = 0) {} },
        };
        if (name.endsWith('/BigMapWorldLayout')) return geometry;
        return {};
    } });
    return exports.BigMapWorldView as new () => Record<string, unknown>;
}

interface IFakeMarker {
    kind: 'city' | 'monster' | 'base';
    id: number;
    hexId: number;
    node: { active: boolean; position: { x: number; y: number }; setPosition(x: number, y: number, z: number): void };
}

function makeMarker(kind: IFakeMarker['kind'], id: number, hexId: number): IFakeMarker {
    return {
        kind, id, hexId,
        node: {
            active: true, position: { x: 0, y: 0 },
            setPosition(x: number, y: number) { this.position = { x, y }; },
        },
        // cullMarkers 的视口余量要读 hitArea（名条位置），给一组常规值即可
        view: { hitArea: { badgeY: 70, badgeHeight: 30 } },
    };
}

function makeView() {
    const View = loadViewClass();
    const view = new View() as Record<string, unknown> & {
        viewportTransform: { width: number; height: number };
        content: { position: { x: number; y: number } };
        zoom: number;
        data: { cities: Map<number, { hexId: number }> } | null;
        selectedHexId: number;
        markers: IFakeMarker[];
    };
    view.viewportTransform = { width: 800, height: 800 };
    view.content = { position: { x: 0, y: 0 } };
    view.zoom = 1;
    view.markers = [
        makeMarker('city', 1, 5),
        makeMarker('city', 2, 8),
        makeMarker('monster', 7, 9),
        makeMarker('base', 3, 10),
    ];
    view.data = { cities: new Map([[1, { hexId: 5 }], [2, { hexId: 8 }]]) };
    return view;
}

test('选中城池后只显示该城池：其余城池、玩家基地、野怪标记全部隐藏', () => {
    const view = makeView();
    const cull = () => (view as { cullMarkers(): void }).cullMarkers();
    view.selectedHexId = 5;
    cull();
    assert.deepEqual(view.markers.map((marker) => marker.node.active), [true, false, false, false],
        '聚焦态下只留 hexId=5 的那座城，城池/野怪/基地全隐藏');
    // 解除选中（点空白 / 关弹窗）⇒ 全部恢复
    view.selectedHexId = -1;
    cull();
    assert.deepEqual(view.markers.map((marker) => marker.node.active), [true, true, true, true]);
});

test('选中的是野怪或基地时不聚焦：所有标记保持可见（口径只提了城池据点）', () => {
    const view = makeView();
    const cull = () => (view as { cullMarkers(): void }).cullMarkers();
    for (const hexId of [9, 10, 999]) {
        view.selectedHexId = hexId;
        cull();
        assert.deepEqual(view.markers.map((marker) => marker.node.active), [true, true, true, true],
            `selectedHexId=${hexId} 不是城池锚点，不该触发聚焦`);
    }
});

test('聚焦的城标记上移 300（名条/等级是子节点，跟着一起走），解除后写回原位', () => {
    const view = makeView();
    const isolate = () => (view as { applyFocusIsolation(): void }).applyFocusIsolation();
    view.selectedHexId = 5;
    isolate();
    assert.equal(view.markers[0].node.position.y, FOCUS_LIFT, '选中的城标记 = 原位 + 300');
    assert.equal(view.markers[0].node.position.x, 0);
    assert.equal(view.markers[1].node.position.y, 0, '其余标记位置不动（只是被隐藏）');
    view.selectedHexId = -1;
    isolate();
    assert.equal(view.markers[0].node.position.y, 0, '聚焦解除必须写回原位，不许残留偏移');
});

test('隐藏的标记同时不可点：点击命中区按 active 过滤（守卫）', () => {
    const source = readFileSync('assets/script/app/bigmap/view/BigMapWorldView.ts', 'utf8');
    // 聚焦过滤必须长在 cullMarkers 里（平移/缩放共用入口），不能只写在 syncMarkers 一条路上
    assert.match(source, /private cullMarkers\(\): void \{[\s\S]*?focusedCityHexId[\s\S]*?marker\.node\.active = false;/,
        'cullMarkers 必须叠加「聚焦态隐藏其余标记」');
    // syncMarkers 在重摆位置之后必须紧跟裁剪，两条路径口径一致
    assert.match(source, /this\.applyFocusIsolation\(\);\s*\n\s*this\.cullMarkers\(\);/,
        'syncMarkers 必须先重摆聚焦位移、再裁剪');
});
