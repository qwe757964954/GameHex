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
 * 2026-11-11 追加：*「大地图点击查看城池据点，城池据点居中时，背景地图要同步移动」*
 * ⇒ 「上移」从**搬标记节点**改成**抬相机**（`content.y += 300 * zoom`），
 * 背景 / 地块 / 势力色 / 标记是同一个父节点的子节点，一起动。
 *
 * `BigMapWorldView` 是 cc 组件，这里用最小 `cc` 桩转译加载（同 `bigmap-camp-view` 的夹具），
 * 直接驱动 `cullMarkers` / `applyFocusCamera` / `focusOn` 三个纯逻辑入口。
 */

// 🔴 2026-11-03 两轮口径：先 200，后「还需要上移100px（85% 极限机位验收）」⇒ 总量 300
const FOCUS_LIFT = 300;
/** 视口基准偏移：`centerOnHex` 恒定把格子放在视口中心**下方** 100，给顶部 HUD 留位。 */
const CENTER_DROP = 100;

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
    cityId?: number;
    node: { active: boolean; position: { x: number; y: number }; setPosition(x: number, y: number, z: number): void };
}

function makeMarker(kind: IFakeMarker['kind'], id: number | string, hexId: number, cityId = 0): IFakeMarker {
    return {
        kind, id, hexId, ...(cityId > 0 ? { cityId } : {}),
        node: {
            active: true, position: { x: 0, y: 0 },
            setPosition(x: number, y: number) { this.position = { x, y }; },
        },
        // cullMarkers 的视口余量要读 hitArea（名条位置），给一组常规值即可
        view: { hitArea: { badgeY: 70, badgeHeight: 30 } },
    };
}

/** 布局点：城池 5 / 城池 8 / 野怪 9 / 基地 10，取好认的整数，断言直接对着手算结果比。 */
const LAYOUT_POINTS: ReadonlyArray<readonly [number, { x: number; y: number }]> = [
    [5, { x: 100, y: 200 }], [8, { x: -40, y: 60 }], [9, { x: 0, y: 0 }], [10, { x: 250, y: -70 }],
];

function makeView() {
    const View = loadViewClass();
    const view = new View() as Record<string, unknown> & {
        viewportTransform: { width: number; height: number };
        content: {
            position: { x: number; y: number };
            setPosition(x: number, y: number): void;
            setScale(x: number, y: number): void;
        };
        layout: { points: Map<number, { x: number; y: number }> };
        zoom: number;
        liftedFocusHexId: number;
        data: { ui: object; cities: Map<number, { hexId: number; campRoles?: readonly IBigMapCampRoleInfo[] }> } | null;
        selectedHexId: number;
        markers: IFakeMarker[];
        syncVisibleTiles(): void;
        queueCampRefresh(): void;
        cullMarkers(): void;
        applyFocusCamera(): void;
        focusOn(hexId: number): void;
    };
    view.viewportTransform = { width: 800, height: 800 };
    // `applyCamera` 真的会写 content：位置 + 缩放都接住，才能断言「相机抬了多少」
    view.content = {
        position: { x: 0, y: 0 },
        setPosition(x: number, y: number) { this.position = { x, y }; },
        setScale() {},
    };
    view.layout = { points: new Map(LAYOUT_POINTS.map(([id, point]) => [id, { ...point }] as const)) };
    // 相机落位会顺带刷地块与视野上报，这两个跟本用例无关，桩掉免得依赖 cc 桩以外的世界
    view.syncVisibleTiles = () => undefined;
    view.queueCampRefresh = () => undefined;
    view.zoom = 1;
    view.markers = [
        makeMarker('city', 1, 5),
        makeMarker('city', 2, 8),
        makeMarker('monster', 7, 9),
        makeMarker('base', 3, 10),
    ];
    view.data = { ui: {}, cities: new Map([[1, { cityId: 1, hexId: 5 }], [2, { cityId: 2, hexId: 8 }]]) };
    return view;
}

/**
 * 相机位。`+ 0` 把 `-0` 归一成 `0`：`-center.x * zoom` 在中心为 0 时会产出 `-0`，
 * 而 `node:assert/strict` 的 `equal` 是 `Object.is`，`-0` 与 `0` 会被判成不相等。
 */
function assertCamera(view: { content: { position: { x: number; y: number } } }, x: number, y: number): void {
    assert.equal(view.content.position.x + 0, x + 0);
    assert.equal(view.content.position.y + 0, y + 0);
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

test('campId=114的136名玩家：聚焦只显示选中城池与**本城名单玩家**，同格的别城玩家仍隐藏', () => {
    const view = makeView();
    const roles = normalizeBigMapCampRoleInfos({ campId: 114, infos: Array.from({ length: 136 }, (_, i) => ({
        roleId: String(9000 + i), serverId: '2', roleName: `玩家${i}`, img: '1',
        defenseHp: 4400, pos: 100 + i, buildLevel: 10,
    })) }, 114);
    assert.equal(roles.length, 136);
    view.data.cities = new Map([[114, { cityId: 114, hexId: 5, campRoles: [] }], [115, { cityId: 115, hexId: 8, campRoles: [] }]]);
    view.selectedHexId = 5;
    view.cullMarkers();
    view.data.cities.get(114).campRoles = roles;
    // 归属由创建标记时记下的 `cityId` 提供（= 哪座城的名单回来的），不靠 pos 反推。
    view.markers.push(...roles.map((role) => makeMarker('role', role.roleId, role.pos, 114)));
    const foreign = makeMarker('role', 'other-city', roles[0].pos, 115);
    view.markers.push(foreign);
    view.cullMarkers();
    assert.equal(view.markers.filter((marker) => marker.kind === 'city' && marker.node.active).length, 1);
    assert.equal(view.markers.filter((marker) => marker.kind === 'role' && marker.node.active).length, 136,
        '★ 聚焦时本城玩家跟着留在图上传（点了据点人不能凭空消失）');
    assert.equal(foreign.node.active, false, '相同pos不能替代回包campId归属');
    const own = view.markers.find((marker) => marker.id === roles[0].roleId);
    own.node.position.x = 9000;
    view.cullMarkers();
    assert.equal(own.node.active, false, '本城玩家离开视口仍被裁剪');
    view.selectedHexId = 8;
    view.cullMarkers();
    assert.equal(view.markers.filter((marker) => marker.kind === 'role' && marker.cityId === 114 && marker.node.active).length, 0,
        '换聚焦到另一座城后，前一座城的玩家全部隐藏');
    assert.equal(view.markers.filter((marker) => marker.kind === 'role' && marker.node.active).length, 1,
        '新聚焦城的玩家留着他自己那条（foreign 就属于 115）');
});

test('与城池同格的玩家仍保持原始pos：聚焦抬的是相机，不动任何标记', () => {
    const view = makeView();
    const role = makeMarker('role', 'self', 5);
    view.markers.push(role);
    view.selectedHexId = 5;
    view.applyFocusCamera();
    assert.equal(role.node.position.y, 0);
    assert.equal(view.markers[0].node.position.y, 0, '城池标记也不动 —— 它跟着 content 一起上移');
});

test('聚焦城池抬的是相机：背景/地块/势力色/标记同一个 content，一起上移 300×zoom', () => {
    const view = makeView();
    view.zoom = 0.5;
    view.selectedHexId = 5;
    view.applyFocusCamera();
    // 居中基准 = (-100×0.5, -200×0.5 - 100) = (-50, -200)，再上抬 300×0.5 = 150
    assertCamera(view, -50, -50);
    assert.equal(view.liftedFocusHexId, 5, '记下「已经为哪座城抬过」，解除时才知道要落多少');
});

test('聚焦解除：相机原路落回 300×zoom，x 不动；同一座城反复刷新不叠加', () => {
    const view = makeView();
    view.zoom = 0.5;
    view.selectedHexId = 5;
    view.applyFocusCamera();
    view.applyFocusCamera();
    view.applyFocusCamera();
    assert.deepEqual(view.content.position, { x: -50, y: -50 }, '重复刷新必须幂等，不许越抬越高');
    view.content.position.x = -30; // 模拟玩家在弹窗开着时平移过地图
    view.selectedHexId = -1;
    view.applyFocusCamera();
    assert.equal(view.content.position.y, -50 - FOCUS_LIFT * 0.5, '只落回上抬的那一段');
    assert.equal(view.content.position.x, -30, '解除时只落 y，不强行重新居中（保留玩家平移）');
    assert.equal(view.liftedFocusHexId, -1);
});

test('focusOn：选中的城池才上抬；野怪定位与「回家」都不上抬', () => {
    const view = makeView();
    // 野怪：选中格是野怪锚点，不是城池 ⇒ 只居中
    view.selectedHexId = 9;
    view.focusOn(9);
    assertCamera(view, 0, -CENTER_DROP);
    // 选中城池 5 再定位它 ⇒ 额外 +300
    view.selectedHexId = 5;
    view.focusOn(5);
    assertCamera(view, -100, -200 - CENTER_DROP + FOCUS_LIFT);
    // 「回家」：玩家基地在 10，此时没有城池选中态 ⇒ 不上抬
    view.selectedHexId = -1;
    view.focusOn(10);
    assertCamera(view, -250, 70 - CENTER_DROP);
});

test('隐藏的标记同时不可点，且「抬相机」不许再退回「搬标记」（守卫）', () => {
    const source = readFileSync('assets/script/app/bigmap/view/BigMapWorldView.ts', 'utf8');
    // 聚焦过滤必须长在 cullMarkers 里（平移/缩放共用入口），不能只写在 syncMarkers 一条路上
    assert.match(source, /private cullMarkers\(\): void \{[\s\S]*?focusedCityHexId[\s\S]*?marker\.node\.active = false;/,
        'cullMarkers 必须叠加「聚焦态隐藏其余标记」');
    // 相机补偿之后紧跟裁剪，两条路径口径一致
    assert.match(source, /this\.applyFocusCamera\(\);\s*\n\s*this\.cullMarkers\(\);/,
        'syncMarkers 必须先做聚焦相机补偿、再裁剪');
    // 2026-11-11 的核心：不许再出现「按聚焦搬标记」的写法
    assert.doesNotMatch(source, /marker\.node\.setPosition\(/,
        '标记位置只在 addMarker 落一次；聚焦要靠相机，搬标记会让城和它脚下的地块脱节');
    // 上抬只给「当前选中的城池」，野怪定位 / 回家按 0 处理
    assert.match(source, /this\.centerOnHex\(hexId, hexId === this\.focusedCityHexId \? BIGMAP_FOCUSED_CITY_LIFT : 0\);/,
        'focusOn 的上抬必须挂在 focusedCityHexId 上');
});
