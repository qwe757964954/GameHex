import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTerritoryMapLayout } from '../assets/script/app/territory/model/TerritoryMapLayout';
import { configureTerritoryMap } from '../assets/script/app/territory/model/TerritoryMapConfig';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

// 2026-09-30 领地页拆分后，这组契约的**真源换了位置**（原来是 TerritoryPage 一个类在做）：
//   地图渲染 → view/TerritoryMapView.ts        布局换算 → model/TerritoryMapLayout.ts
//   HUD      → view/TerritoryHeaderView.ts      资源     → application/TerritoryPageAssets.ts
//   滚动容器 → prefab 上的 cc.ScrollView         站点条目 → TerritoryStation.prefab
// 断言跟着真源走，别再去 TerritoryPage.ts 里找 —— 那里的职责只剩流程编排。
const page = read('../assets/script/app/main/MainTerritoryMap.ts');
const presenter = read('../assets/script/app/territory/application/TerritoryPresenter.ts');
const mapView = read('../assets/script/app/territory/view/TerritoryMapView.ts');
const assets = read('../assets/script/app/territory/application/TerritoryPageAssets.ts');
const texts = read('../assets/script/app/territory/application/TerritoryTexts.ts');
const prefab = JSON.parse(read('../assets/resources/ui/main/MainTerritoryMap.prefab')) as Array<Record<string, unknown>>;
const stationPrefab = JSON.parse(read('../assets/resources/ui/territory/TerritoryStation.prefab')) as Array<Record<string, unknown>>;

function prefabNode(objects: Array<Record<string, unknown>>, name: string): Record<string, unknown> {
    const node = objects.find((entry) => entry.__type__ === 'cc.Node' && entry._name === name);
    assert.ok(node, `missing prefab node: ${name}`);
    return node;
}

function componentOf(objects: Array<Record<string, unknown>>, node: Record<string, unknown>, type: string): Record<string, unknown> {
    const refs = node._components as Array<{ __id__: number }>;
    const component = refs.map((ref) => objects[ref.__id__]).find((entry) => entry.__type__ === type);
    assert.ok(component, `${String(node._name)} missing ${type}`);
    return component;
}

test('territory page renders every site from the current map JSON, not only bound PVE stations', () => {
    // 每个 site 都要出节点 —— 与有没有绑定关卡无关（绑定只影响文案与颜色）。
    assert.match(mapView, /for \(const site of input\.map\.sites\)/);
    assert.match(mapView, /const stage = input\.stageByCell\.get\(site\.cellId\) \?\? null;/);
    // 未绑定站点同样保留命中区，但地图不再显示类型名或「待配置」角标。
    assert.doesNotMatch(mapView, /TERRITORY_UNBOUND_TYPE_NAMES|TERRITORY_TEXTS\.pendingConfig/);
    // 点开它的详情是另一条文案（unboundStatus）：字面文案在 TerritoryTexts，Presenter 引用它。
    assert.match(texts, /仅展示地图站点，不扣资源、不进入战斗/);
    assert.match(presenter, /TERRITORY_TEXTS\.unboundStatus/);
});

test('territory map keeps battle-scale cells and supports two-axis drag within its viewport', () => {
    // 格子尺寸 = 战斗同款 128（站点条目 prefab 的根尺寸）。
    const stationRoot = prefabNode(stationPrefab, 'TerritoryStation');
    const transform = componentOf(stationPrefab, stationRoot, 'cc.UITransform');
    assert.deepEqual(transform._contentSize, { __type__: 'cc.Size', width: 128, height: 128 });
    // 🔴 2026-10-12 换成 2.5D 立体地块：地块图是 **130×119（非正方形）**，
    // 必须按宽高分别 setContentSize —— 用同一个 `SIZE` 会把图非等比拉伸。
    assert.match(mapView, /setContentSize\(HEX_GRID_IMAGE_WIDTH, HEX_GRID_IMAGE_HEIGHT\)/);
    // 视口内双向拖拽：交给 `cc.ScrollView`（原来是手写 TOUCH_MOVE + 累加 delta）。
    const viewport = prefabNode(prefab, 'MapViewport');
    const scroll = componentOf(prefab, viewport, 'cc.ScrollView');
    assert.equal(scroll.horizontal, true);
    assert.equal(scroll.vertical, true);
    assert.equal(scroll._content.__id__, prefab.indexOf(prefabNode(prefab, 'MapLayer')));
    // 内容层尺寸 = 地图包围盒 + 四周留白（可滚范围由它和视口尺寸推出）。
    // ⚠️ 2026-10-21 起**不再**是裸包围盒：留白（`TERRITORY_MAP_CONTENT_PADDING`）就是
    // 「相机多出来的可滚余量」，没它的话贴到地图下边缘的目标格永远抬不到【快速寻敌】之上
    // （用户口径「整体一起上移」）。尺寸口径由 `territoryMapContentSize` 统一出口。
    assert.match(mapView, /territoryMapContentSize\(layout\)/);
    assert.match(mapView, /setContentSize\(content\.width, content\.height\)/);
});

test('territory stations use dedicated 128px transparent building cuts instead of oversized concept slices', () => {
    for (const art of ['territory_home_v1', 'territory_outpost_v1', 'territory_boss_v1']) {
        assert.match(assets, new RegExp(`spriteFramePath\\(TERRITORY_BUILDING_ART_ROOT, '${art}'\\)`));
    }
    // 概念稿切片（2.0 倍宽的大图）绝不能回流。
    for (const source of [assets, mapView, page]) assert.doesNotMatch(source, /territory-ui-v1\/slices/);
    // 三张切图的原图都是 128×128 的透明底 —— 站点图标节点也用 128，不做二次缩放。
    // ⚠️ meta 的 `subMetas.f9941.userData` 里 `width/height` 是 **trim 后**的可见尺寸
    // （实测 `territory_home_v1` 是 118×120，`trimX/trimY` 有留白），**原图尺寸看 `rawWidth/rawHeight`**。
    for (const art of ['territory_home_v1', 'territory_outpost_v1', 'territory_boss_v1']) {
        const meta = JSON.parse(read(`../assets/resources/image/territory/buildings/${art}.png.meta`)) as {
            subMetas?: Record<string, {
                userData?: { rawWidth?: number; rawHeight?: number; trimType?: string; packable?: boolean };
            }>;
        };
        const size = meta.subMetas?.f9941?.userData;
        assert.equal(size?.rawWidth, 128, `${art} 原图不是 128 宽`);
        assert.equal(size?.rawHeight, 128, `${art} 原图不是 128 高`);
        assert.equal(size?.trimType, 'auto', `${art} 应保留自动裁剪（切图是透明底的）`);
        assert.equal(size?.packable, true, `${art} 必须允许进入动态合图`);
    }
    const icon = prefabNode(stationPrefab, 'Icon');
    assert.deepEqual(componentOf(stationPrefab, icon, 'cc.UITransform')._contentSize,
        { __type__: 'cc.Size', width: 128, height: 128 });
});

test('main territory map prefab contains no duplicate chapter HUD', () => {
    for (const name of ['HudLayer', 'HeaderPanel', 'ChapterLabel', 'WalletLabel', 'PrevChapter', 'NextChapter', 'HintPanel']) {
        assert.equal(prefab.some((node) => node.__type__ === 'cc.Node' && node._name === name), false,
            `map-only prefab should not contain ${name}`);
    }
    assert.match(page, /@ccclass\('MainTerritoryMap'\)/);
    assert.doesNotMatch(page, /TerritoryHeaderView|hudView|setHudVisible/);
});

test('main territory map viewport reaches the page top behind the HUD and keeps the bottom navigation inset', () => {
    const root = prefabNode(prefab, 'MainTerritoryMap');
    const viewport = prefabNode(prefab, 'MapViewport');
    const widget = componentOf(prefab, root, 'cc.Widget');
    assert.equal(widget._alignFlags, 45);
    assert.equal(widget._top, 0);
    assert.equal(widget._bottom, 0);
    assert.equal(widget._left, 0);
    assert.equal(widget._right, 0);

    // 云和地块延伸到顶部，HUD 由 ArenaRoot 的上层节点绘制与接收点击。
    const viewportWidget = componentOf(prefab, viewport, 'cc.Widget');
    assert.equal(viewportWidget._alignFlags, 45, 'MapViewport must stretch on all four edges');
    assert.equal(viewportWidget._left, 0);
    assert.equal(viewportWidget._right, 0);
    assert.equal(viewportWidget._top, 0);
    assert.equal(viewportWidget._bottom, 168);
    const rootSize = componentOf(prefab, root, 'cc.UITransform')._contentSize as { height: number };
    const viewportSize = componentOf(prefab, viewport, 'cc.UITransform')._contentSize as { height: number };
    const viewportPosition = viewport._lpos as { y: number };
    assert.equal(viewportPosition.y + viewportSize.height / 2, rootSize.height / 2,
        'serialized viewport must also reach the page top before Widget alignment');
    assert.equal(viewportPosition.y - viewportSize.height / 2, -rootSize.height / 2 + 168);
    const arena = JSON.parse(read('../assets/resources/ui/main/ArenaRoot.prefab')) as Array<Record<string, unknown>>;
    const arenaRoot = prefabNode(arena, 'ArenaRoot');
    const children = (arenaRoot._children as Array<{ __id__: number }>).map((ref) => arena[ref.__id__]._name);
    assert.ok(children.indexOf('MapRoot') >= 0);
    for (const hud of ['TopHud', 'BottomHud']) {
        assert.ok(children.indexOf(hud) > children.indexOf('MapRoot'), `${hud} must stay above the map`);
    }
    const controller = (root._components as Array<{ __id__: number }>).map((ref) => prefab[ref.__id__]);
    assert.ok(controller.some((entry) => entry.__type__ === 'db11eTDMkRLYYWMYrCVH0E9'),
        'MainTerritoryMap script must remain attached to the root');
});

test('layout consumes every current JSON site', () => {
    // 布局层要遍历**整张地图的格子**（不只是有站点的那些），否则六边格铺不满。
    const map = configureTerritoryMap(JSON.parse(read('../assets/resources/config/territory-maps/chapter_01.json')));
    const grid = buildTerritoryMapLayout(map);
    assert.equal(grid.points.size, map.rows * map.columns);
    for (const site of map.sites) assert.ok(grid.points.has(site.cellId), `站点 ${site.cellId} 没有格心`);
});

test('presenter exposes missing random-pool state safely', () => {
    // 站点解锁连线已下线（2026-10-01）：渲染层不再消费 `requiredCells` 画线，
    // 查看改由编辑器 `tools/map-editor/territory.html` 的「依赖连线」开关承担。
    // 反例断言先剥注释（规则 104）—— 类注释里提到旧实现是合法的。
    const mapViewCode = mapView.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.doesNotMatch(mapViewCode, /drawRoutes|routeGraphics|RouteLayer/);
    // 随机名额池还没发布时，HUD 要把「有几个候选格」如实说出来（Presenter 侧）。
    assert.match(presenter, /random\?\.candidateCells\.length/);
    assert.match(presenter, /TERRITORY_TEXTS\.randomCostHint/);
});

test('★★地图底图随格子一起滑动，且格子画在背景上', () => {
    // 背景必须挂在 `MapLayer`（= cc.ScrollView 的 content）里。
    // 🔴 反例：挂在页面根或 `MapViewport` 上时它们都在 content **之外** ⇒ 滑动时格子走、背景不动，
    //    画面就是「格子飘在一张静止的底图上」——不报任何错（2026-10-10 修的就是这个）。
    const mapViewport = prefabNode(prefab, 'MapViewport');
    const mapLayer = prefabNode(prefab, 'MapLayer');
    const background = prefabNode(prefab, 'MapBackground');

    const parentOf = (objects: Array<Record<string, unknown>>, name: string): string => {
        const node = prefabNode(objects, name);
        const parent = objects[(node._parent as { __id__: number }).__id__] as Record<string, unknown>;
        return String(parent._name);
    };
    assert.equal(parentOf(prefab, 'MapBackground'), 'MapLayer',
        '★底图必须在 MapLayer（ScrollView 的 content）里，否则不跟着滑');
    assert.notEqual(parentOf(prefab, 'MapBackground'), 'TerritoryPage');

    // 渲染序：`_children` 顺序 = 绘制顺序（后建的在上）⇒ 底图必须是 MapLayer 的**第一个**子节点。
    const children = (mapLayer._children as Array<{ __id__: number }>)
        .map((ref) => prefab[ref.__id__]._name);
    assert.equal(children[0], 'MapBackground', '★底图须是 MapLayer 第一个子节点（格子才画在它上面）');
    // 末尾多出的 `GainLayer` 是资源飘字层（2026-10-15 加）：画在站点之上，不参与站点合批，
    // 加在最后不打断既有层的连续性。
    assert.deepEqual(children.slice(1),
        ['GridLayer', 'StationIconLayer', 'StationCaptionLayer', 'StationTextLayer', 'StationBadgeLayer', 'StationHitLayer', 'GainLayer'],
        '★既有图层顺序不得被打乱');

    // 底图节点本身：UI_2D + Sprite 且 sizeMode=CUSTOM。
    // ⚠️ `_layer` 落DEFAULT(1073741824) 的话 UI 相机整棵子树不渲染，且**不报错**（规则 5）。
    assert.equal(background._layer, 33554432, '★底图必须 UI_2D');
    const bgSprite = componentOf(prefab, background, 'cc.Sprite');
    assert.equal(bgSprite._sizeMode, 0, '★sizeMode 必须是 CUSTOM(0)，否则赋帧时尺寸会被贴图覆写');
    assert.ok((bgSprite._spriteFrame as { __uuid__?: string } | null)?.__uuid__,
        '底图应在 prefab 上默认挂好一张图（运行时可再换）');

    // 视图脚本：真的消费了 background（此前 `art.background` 加载了却没有任何消费方 —— 纯浪费）。
    assert.match(mapView, /readonly background: SpriteFrame \| null/);
    assert.match(mapView, /syncBackground\(input\)/, '★renderMap 必须同步底图');
    // 等比 cover：不能按包围盒非等比拉伸（会把美术纹理压扁），也不能只按视口尺寸（滑到边缘露白）。
    assert.match(mapView, /Math\.max\(width \/ artWidth, height \/ artHeight\)/,
        '★底图必须等比 cover 铺满包围盒');
    assert.match(mapView, /if \(!\(artWidth > 0\) \|\| !\(artHeight > 0\)\) return;/,
        '★图尺寸未就绪时不要把节点写成 0×0（整块底图会消失且不报错）');
});
