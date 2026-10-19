import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const UI = 'assets/resources/ui/territory';
const PATHS = {
    page: `${UI}/TerritoryPage.prefab`,
    station: `${UI}/TerritoryStation.prefab`,
    detail: `${UI}/TerritorySiteDetail.prefab`,
    pageScript: 'assets/script/app/territory/view/TerritoryPage.ts',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** `.ts.meta` 的 uuid → 编辑器用的 23 位组件 cid。 */
function cidOf(tsPath: string): string {
    const uuid = (JSON.parse(readFileSync(`${tsPath}.meta`, 'utf8')) as { uuid: string }).uuid.replace(/-/g, '');
    return uuid.slice(0, 5) + Array.from({ length: 9 }, (_, i) => {
        const value = parseInt(uuid.slice(5 + i * 3, 8 + i * 3), 16);
        return ALPHABET[value >> 6] + ALPHABET[value & 0x3f];
    }).join('');
}

const load = (path: string): Raw[] => JSON.parse(readFileSync(path, 'utf8')) as Raw[];

function nodeIndexOf(objects: Raw[], name: string): number {
    const index = objects.findIndex((o) => o?.__type__ === 'cc.Node' && o._name === name);
    assert.ok(index >= 0, `prefab 里找不到节点 ${name}`);
    return index;
}

function componentOf(objects: Raw[], nodeIndex: number, type: string): Raw {
    const refs: Array<{ __id__: number }> = objects[nodeIndex]._components ?? [];
    const found = refs.map((ref) => objects[ref.__id__]).find((o) => o?.__type__ === type);
    assert.ok(found, `${objects[nodeIndex]._name} 上没有 ${type}`);
    return found as Raw;
}

function scriptOf(objects: Raw[], cid: string): Raw {
    const found = objects.find((o) => o?.__type__ === cid);
    assert.ok(found, `prefab 里没有脚本组件 ${cid}`);
    return found as Raw;
}

/** 断言某个 `@property` 指向「名为 name 的节点上的类型为 type 的组件」。 */
function expectRef(objects: Raw[], script: Raw, prop: string, nodeName: string, type: string): void {
    const ref = script[prop] as { __id__: number } | undefined;
    assert.ok(ref && typeof ref.__id__ === 'number', `${prop} 没绑`);
    const target = objects[ref.__id__];
    assert.equal(target.__type__, type, `${prop} 应是 ${type}，实际 ${target.__type__}`);
    // ⚠️ 引用有两种形态（规则 105）：`cc.Node` 的目标就是节点本身；组件要走 `.node` 反查宿主。
    const owner = target.__type__ === 'cc.Node' ? target : objects[target.node.__id__];
    assert.equal(owner._name, nodeName, `${prop} 指向了 ${owner._name}`);
}

function assertUiLayers(objects: Raw[], label: string): void {
    const nodes = objects.filter((o) => o?.__type__ === 'cc.Node');
    assert.ok(nodes.length > 0, `${label} 没有节点`);
    for (const node of nodes) {
        assert.equal(node._layer, 33554432, `${label}/${node._name} 的 layer 不是 UI_2D`);
    }
}

/** 读位掩码：TOP1 MID2 BOT4 LEFT8 CENTER16 RIGHT32。 */
const flagsOf = (objects: Raw[], nodeIndex: number): number =>
    componentOf(objects, nodeIndex, 'cc.Widget')._alignFlags;

// ── 页面骨架 ─────────────────────────────────────────────────────────────
test('TerritoryPage.prefab：地图区是 ScrollView + 内容层，HUD 在另一支，弹窗走独立 prefab', () => {
    const objects = load(PATHS.page);
    const script = scriptOf(objects, cidOf('assets/script/app/territory/view/TerritoryPage.ts'));

    // 旧字段必须彻底消失（脚本里已删，prefab 里留着就是孤儿）。
    for (const stale of ['mapViewport', 'mapLayer', 'hudLayer']) {
        assert.equal(stale in script, false, `根脚本仍残留旧字段 ${stale}`);
    }

    // ① 滚动容器：`cc.ScrollView` 挂在有 Mask 的 MapViewport 上，content 是 MapLayer。
    const scroll = script.mapScrollView as { __id__: number };
    const viewport = nodeIndexOf(objects, 'MapViewport');
    assert.equal(objects[scroll.__id__].__type__, 'cc.ScrollView');
    assert.equal(objects[scroll.__id__].node.__id__, viewport, 'ScrollView 应挂在 MapViewport 上');
    const scrollView = objects[scroll.__id__];
    assert.equal(
        objects[scrollView._content.__id__]._name, 'MapLayer',
        'content 必须是 MapLayer（引擎的 view 取 content.parent ⇒ MapViewport）',
    );
    // 地图是二维拖拽，两个方向都要开。
    assert.equal(scrollView.horizontal, true);
    assert.equal(scrollView.vertical, true);
    // ⚠️ 这一条替代了旧实现手写的 `mapDragMoved` 点击抑制：拖动超阈值时引擎给子节点补发 TOUCH_CANCEL。
    assert.equal(scrollView.cancelInnerEvents, true, '必须让引擎抑制拖动中的子节点点击');
    assert.ok(componentOf(objects, viewport, 'cc.Mask'), 'MapViewport 需要 Mask 裁剪');

    // ② 地图渲染层挂在内容节点上，三个引用齐全。
    const mapView = scriptOf(objects, cidOf('assets/script/app/territory/view/TerritoryMapView.ts'));
    const mapLayer = nodeIndexOf(objects, 'MapLayer');
    assert.equal(objects[mapView.node.__id__]._name, 'MapLayer');
    assert.equal(mapView.node.__id__, mapLayer);
    expectRef(objects, mapView, 'gridLayer', 'GridLayer', 'cc.Node');
    expectRef(objects, mapView, 'stationIconLayer', 'StationIconLayer', 'cc.Node');
    expectRef(objects, mapView, 'stationCaptionLayer', 'StationCaptionLayer', 'cc.Node');
    expectRef(objects, mapView, 'stationTextLayer', 'StationTextLayer', 'cc.Node');
    expectRef(objects, mapView, 'stationBadgeLayer', 'StationBadgeLayer', 'cc.Node');
    expectRef(objects, mapView, 'stationHitLayer', 'StationHitLayer', 'cc.Node');
    // 底图引用（2026-10-10）：必须绑到 `MapLayer/MapBackground` 上的那个 `cc.Sprite`。
    expectRef(objects, mapView, 'mapBackground', 'MapBackground', 'cc.Sprite');
    assert.ok((mapView.stationPrefab as Raw).__uuid__, 'stationPrefab 没绑');
    // 站点解锁连线已下线（2026-10-01）：节点、组件引用、脚本字段三处都不该留。
    // 查看职责改由编辑器 `tools/map-editor/territory.html` 的「依赖连线」开关承担。
    assert.equal(objects.some((item) => item.__type__ === 'cc.Node' && item._name === 'RouteLayer'), false,
        'RouteLayer 节点应从 prefab 摘掉');
    assert.equal('routeGraphics' in mapView, false, 'TerritoryMapView 不该再有 routeGraphics');
    // MapLayer 的子节点顺序 = 渲染顺序（后建的画在上面）。
    // `MapBackground` 必须排**第一位**：它是底图，格子要压在上面（2026-10-10 随底图一起滑动的改造）。
    // ⚠️ 「同类材质连续才能合批」这条约束依然成立 —— 底图是另一种材质，
    //    单独放在最前面反而**更**利于合批（同材质的那 6 层仍保持连续）。
    // `GainLayer`（资源飘字层）排在**最后**：它要画在站点之上，且不属于站点那组同材质层，
    // 加在末尾不会打断它们的连续性 ⇒ 合批不受影响（2026-10-15 随「7/9 飘字」加）。
    assert.deepEqual(
        (objects[mapLayer]._children as Array<{ __id__: number }>).map((ref) => objects[ref.__id__]._name),
        ['MapBackground', 'GridLayer', 'StationIconLayer', 'StationCaptionLayer', 'StationTextLayer', 'StationBadgeLayer', 'StationHitLayer', 'GainLayer'],
        'MapBackground must stay first (背景在下、格子在上)，其余同类渲染层保持连续以合批',
    );

    // ③ HUD 层：常态元素全在 Content 下（加载态只切这一个节点）。
    const hudView = scriptOf(objects, cidOf('assets/script/app/territory/view/TerritoryHeaderView.ts'));
    assert.equal(objects[hudView.node.__id__]._name, 'HudLayer');
    expectRef(objects, hudView, 'contentLayer', 'Content', 'cc.Node');
    expectRef(objects, hudView, 'headerSprite', 'HeaderPanel', 'cc.Sprite');
    expectRef(objects, hudView, 'titleLabel', 'Title', 'cc.Label');
    expectRef(objects, hudView, 'chapterLabel', 'ChapterLabel', 'cc.Label');
    expectRef(objects, hudView, 'walletLabel', 'WalletLabel', 'cc.Label');
    expectRef(objects, hudView, 'inventoryLabel', 'InventoryLabel', 'cc.Label');
    expectRef(objects, hudView, 'previousButton', 'PrevChapter', 'cc.Button');
    expectRef(objects, hudView, 'nextButton', 'NextChapter', 'cc.Button');
    expectRef(objects, hudView, 'hintPanel', 'HintPanel', 'cc.Node');
    expectRef(objects, hudView, 'hintLabel', 'HintLabel', 'cc.Label');

    const content = nodeIndexOf(objects, 'Content');
    assert.deepEqual(
        (objects[content]._children ?? []).map((ref: { __id__: number }) => objects[ref.__id__]._name).sort(),
        // 常态 HUD 的九个元素（顺序 = 渲染序，这里只关心集合）。
        ['ChapterLabel', 'HeaderPanel', 'HintLabel', 'HintPanel', 'InventoryLabel',
            'NextChapter', 'PrevChapter', 'Title', 'WalletLabel'],
    );
    // 出厂状态：常态 HUD 常驻可见（2026-10-12 起不再有整页 LoadingPanel，加载态不锁屏）。
    assert.equal(objects[content]._active, true);

    // ④ 弹窗是独立 prefab（运行时 instantiate），不是页面的嵌套实例。
    assert.ok((script.detailPrefab as Raw).__uuid__, 'detailPrefab 没绑');

    // ⑤ 定位靠 Widget：顶部一排 TOP+CENTER(17)，提示条 BOT+CENTER(20)。
    assert.equal(flagsOf(objects, nodeIndexOf(objects, 'HeaderPanel')), 17);
    assert.equal(flagsOf(objects, nodeIndexOf(objects, 'HintPanel')), 20);
    // 距顶的数值就是旧实现 `hudSize.height / 2 - N` 里的 N 折算（长屏不再跟着屏幕中心跑）。
    assert.equal(componentOf(objects, nodeIndexOf(objects, 'HeaderPanel'), 'cc.Widget')._top, 10);
    assert.equal(componentOf(objects, nodeIndexOf(objects, 'HintPanel'), 'cc.Widget')._bottom, 116);

    assertUiLayers(objects, 'TerritoryPage');
});

// ── 站点条目 ─────────────────────────────────────────────────────────────
test('TerritoryStation.prefab：128 站点 + 名称条 + 角标，整块可点，五个引用形态正确', () => {
    const objects = load(PATHS.station);
    const view = scriptOf(objects, cidOf('assets/script/app/territory/view/TerritoryStationView.ts'));
    const root = nodeIndexOf(objects, 'TerritoryStation');
    assert.equal(view.node.__id__, root);

    const transform = componentOf(objects, root, 'cc.UITransform');
    assert.equal(transform._contentSize.width, 128, '站点尺寸必须与六边格一致');
    assert.equal(transform._contentSize.height, 128);
    // 整块可点（旧实现 `node.addComponent(Button)`），过渡用 SCALE。
    const button = componentOf(objects, root, 'cc.Button');
    assert.equal(button._transition, 3, 'Button 过渡应是 SCALE');
    assert.equal(button._interactable, true);

    expectRef(objects, view, 'button', 'TerritoryStation', 'cc.Button');
    expectRef(objects, view, 'iconSprite', 'Icon', 'cc.Sprite');
    expectRef(objects, view, 'captionSprite', 'CaptionBg', 'cc.Sprite');
    expectRef(objects, view, 'captionLabel', 'CaptionLabel', 'cc.Label');
    expectRef(objects, view, 'badgeLabel', 'BadgeLabel', 'cc.Label');

    const captionBg = nodeIndexOf(objects, 'CaptionBg');
    assert.equal(
        (objects[captionBg]._components as Array<{ __id__: number }>)
            .some((ref) => objects[ref.__id__].__type__ === 'cc.Graphics'),
        false,
        'CaptionBg must not use one Graphics component per station',
    );
    assert.equal(
        componentOf(objects, captionBg, 'cc.Sprite')._spriteFrame,
        null,
        'CaptionBg must not have a default background; its Sprite is reserved for the runtime currency icon',
    );
    assert.equal(componentOf(objects, nodeIndexOf(objects, 'CaptionLabel'), 'cc.Label')._cacheMode, 2);
    assert.equal(componentOf(objects, nodeIndexOf(objects, 'BadgeLabel'), 'cc.Label')._cacheMode, 2);

    // 名称条在站点上方（旧实现 `box(node,'CaptionBg',0,52,94,26,…)`）。
    assert.deepEqual(objects[nodeIndexOf(objects, 'CaptionBg')]._lpos, { __type__: 'cc.Vec3', x: 0, y: 52, z: 0 });
    assertUiLayers(objects, 'TerritoryStation');
});

// ── 详情弹窗 ─────────────────────────────────────────────────────────────
test('TerritorySiteDetail.prefab：全屏暗底 + 面板，根与暗底都四边对齐，面板自身吞点击', () => {
    const objects = load(PATHS.detail);
    const view = scriptOf(objects, cidOf('assets/script/app/territory/view/TerritorySiteDetailPanel.ts'));
    const root = nodeIndexOf(objects, 'TerritorySiteDetail');
    assert.equal(view.node.__id__, root);
    assert.equal(objects[root]._active, false, '弹窗出厂必须隐藏');

    // 规则 152b：弹窗根与底图都四边对齐，否则长屏上下会露底。
    assert.equal(flagsOf(objects, root), 45, '弹窗根要四边对齐');
    const dim = nodeIndexOf(objects, 'Dim');
    assert.equal(flagsOf(objects, dim), 45, '暗底要四边对齐');
    expectRef(objects, view, 'dimButton', 'Dim', 'cc.Button');

    const panel = nodeIndexOf(objects, 'Panel');
    const panelTransform = componentOf(objects, panel, 'cc.UITransform');
    assert.equal(panelTransform._contentSize.width, 650);
    assert.equal(panelTransform._contentSize.height, 760);
    // 面板要自己吞点击，否则点面板会穿透到暗底把弹窗关掉。
    assert.ok(componentOf(objects, panel, 'cc.Button'), 'Panel 需要拦事件的 Button');

    expectRef(objects, view, 'titleLabel', 'Title', 'cc.Label');
    expectRef(objects, view, 'subtitleLabel', 'Subtitle', 'cc.Label');
    expectRef(objects, view, 'infoLabel', 'Info', 'cc.Label');
    expectRef(objects, view, 'closeButton', 'Close', 'cc.Button');
    expectRef(objects, view, 'startButton', 'Start', 'cc.Button');

    // 两个按钮的文案挂子节点（FGUI/VirtualScrollView 那轮的同类口径：底图与字是两回事）。
    for (const [parent, caption] of [['Close', '返回地图'], ['Start', '开战']]) {
        const node = nodeIndexOf(objects, parent);
        const textNode = (objects[node]._children ?? [])
            .map((ref: { __id__: number }) => objects[ref.__id__])
            .find((child) => child._name === 'Label');
        assert.ok(textNode, `${parent} 缺文案子节点`);
        const text = componentOf(objects, objects.indexOf(textNode), 'cc.Label')._string;
        assert.equal(text, caption);
    }
    assertUiLayers(objects, 'TerritorySiteDetail');
});

// ── 源码守卫：这一轮要消灭的写法不许回流 ─────────────────────────────────
test('TerritoryPage.ts 不再自己搭 UI、不再直调 resources.load、不再手写拖拽', () => {
    const source = readFileSync(PATHS.pageScript, 'utf8');
    // 先剥注释再断言（规则 104：反向断言必须先剥注释，否则注释里的说明会误报）。
    const code = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

    for (const banned of ['new Node(', 'addComponent(', 'destroyAllChildren', 'resources.load(']) {
        assert.equal(code.includes(banned), false, `源码里仍有 ${banned}（应交给 prefab / AssetService）`);
    }
    // 手写拖拽与点击抑制整块删掉了（换成 cc.ScrollView + cancelInnerEvents）。
    for (const banned of ['bindMapDrag', 'mapDragMoved', 'onMapTouchMove', 'applyMapOffset']) {
        assert.equal(code.includes(banned), false, `源码里仍有手写拖拽痕迹 ${banned}`);
    }
    // 但注入点与视图接线必须在。
    assert.ok(code.includes('this.mapView.renderMap('), '页面应驱动地图渲染层');
    assert.ok(code.includes('this.hudView.render('), '页面应驱动 HUD');
    assert.ok(code.includes('this.detailPanel.open('), '页面应驱动详情弹窗');
});

// ── 源码守卫：Presenter 重构后，业务编排不许留在 Page ─────────────────────
test('TerritoryPage.ts 不再做配置/战役/存档/进度编排，只接线与渲染', () => {
    const code = readFileSync(PATHS.pageScript, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

    for (const banned of [
        'configureTerritoryMap',
        'loadTerritoryCampaign',
        'TerritorySaveStore.',
        'new TerritoryProgress',
        'settleIdleRewards',
        '.beginBattle(',
    ]) {
        assert.equal(code.includes(banned), false,
            `源码里仍有 ${banned}（业务已迁到 TerritoryPresenter）`);
    }
    // 页面仍驱动三个视图（Passive View 的渲染入口）。
    assert.ok(code.includes('this.mapView.renderMap('), '页面应驱动地图渲染层');
    assert.ok(code.includes('this.hudView.render('), '页面应驱动 HUD');
    assert.ok(code.includes('this.detailPanel.open('), '页面应驱动详情弹窗');
});

// ── Presenter 纯度守卫：纯 TS 编排器，整条 import 链不许碰 cc / 边界 ───────
const PRESENTER_SCRIPT = 'assets/script/app/territory/application/TerritoryPresenter.ts';

test('TerritoryPresenter.ts 是纯 TS：不 import cc / framework / 边界模块', () => {
    const source = readFileSync(PRESENTER_SCRIPT, 'utf8');
    // 剥注释（反向断言先剥注释），再剥 import type（type-only 编译期擦除，允许引用边界类型）。
    const code = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/import\s+type\s+[\s\S]*?;\s*$/gm, '');

    assert.equal(code.includes("from 'cc'"), false, 'Presenter 不能 import cc');
    // 唯一例外：`framework/event/EventMgr`（纯 TS 事件中控，零依赖、可直接 require —— zcds 同款）。
    const frameworkImports = code.split('\n')
        .filter((line) => /framework/.test(line) && !line.includes('framework/event/EventMgr'));
    assert.equal(frameworkImports.length, 0, 'Presenter 除纯 TS 的 EventMgr 外不能依赖 framework');
    for (const boundary of [
        'TerritoryPageAssets',
        'TerritoryCellRepository',
        'TerritoryCampaignRepository',
        'TerritorySaveStore',
    ]) {
        assert.equal(code.includes(boundary), false,
            `Presenter 不能依赖边界模块 ${boundary}（走端口）`);
    }
});
