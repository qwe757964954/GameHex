import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as geometry from '../assets/script/app/bigmap/view/BigMapWorldLayout';
import { normalizeBigMapCampRoleInfos, type IBigMapCampRoleInfo } from '../assets/script/app/bigmap/model/BigMapCampRoleInfo';

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
    kind: 'city' | 'monster' | 'base' | 'role';
    id: number | string;
    hexId: number;
    node: { active: boolean; position: { x: number; y: number }; setPosition(x: number, y: number, z: number): void };
}

function makeMarker(kind: IFakeMarker['kind'], id: number | string, hexId: number): IFakeMarker {
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
        data: { ui: object; cities: Map<number, { hexId: number; campRoles?: readonly IBigMapCampRoleInfo[] }> } | null;
        selectedHexId: number;
        markers: IFakeMarker[];
        cullMarkers(): void;
        applyFocusIsolation(): void;
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
    view.data = { ui: {}, cities: new Map([[1, { hexId: 5 }], [2, { hexId: 8 }]]) };
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

test('campId=114的136名玩家回包后，聚焦只显示选中城池，不显示名单角色标记', () => {
    const view = makeView();
    const roles = normalizeBigMapCampRoleInfos({ campId: 114, infos: Array.from({ length: 136 }, (_, i) => ({
        roleId: String(9000 + i), serverId: '2', roleName: `玩家${i}`, img: '1',
        defenseHp: 4400, pos: 100 + i, buildLevel: 10,
    })) }, 114);
    assert.equal(roles.length, 136);
    view.data.cities = new Map([[114, { hexId: 5, campRoles: [] }], [115, { hexId: 8, campRoles: [] }]]);
    view.selectedHexId = 5;
    view.cullMarkers();
    view.data.cities.get(114).campRoles = roles;
    view.markers.push(...roles.map((role) => makeMarker('role', role.roleId, role.pos)));
    const foreign = makeMarker('role', 'other-city', roles[0].pos);
    view.markers.push(foreign);
    view.cullMarkers();
    assert.equal(view.markers.filter((marker) => marker.kind === 'role' && marker.node.active).length, 0);
    assert.equal(foreign.node.active, false, '相同pos不能替代回包campId归属');
    const own = view.markers.find((marker) => marker.id === roles[0].roleId);
    own.node.position.x = 9000;
    view.cullMarkers();
    assert.equal(own.node.active, false, '本城玩家离开视口仍被裁剪');
    view.selectedHexId = 8;
    view.cullMarkers();
    assert.equal(view.markers.filter((marker) => marker.kind === 'role' && marker.node.active).length, 0);
});

test('与城池同格的玩家仍保持原始pos，不跟随城池展示位移', () => {
    const view = makeView();
    const role = makeMarker('role', 'self', 5);
    view.markers.push(role);
    view.selectedHexId = 5;
    view.applyFocusIsolation();
    assert.equal(role.node.position.y, 0);
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
