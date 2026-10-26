import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { BIGMAP_MARKER_BADGE_Y } from '../assets/script/app/bigmap/view/BigMapWorldLayout';

interface IPrefabRef { __id__: number }
interface IPrefabObject {
    readonly __type__: string;
    readonly _name: string;
    readonly _layer: number;
    readonly data: IPrefabRef;
    readonly _children: IPrefabRef[];
    readonly _components: IPrefabRef[];
    readonly _prefab: IPrefabRef;
    readonly asset: { readonly __uuid__: string };
    readonly target: IPrefabRef;
    readonly targetInfo: IPrefabRef;
    readonly localID: readonly string[];
    readonly propertyPath: readonly string[];
    readonly fileId: string;
    readonly _lpos: { readonly x: number; readonly y: number };
    readonly _contentSize: { readonly width: number; readonly height: number };
    readonly _sizeMode: number;
    readonly _isTrimmedMode: boolean;
    readonly [field: string]: unknown;
}

const WORLD_PATH = 'assets/resources/ui/bigmap/BigMapWorldView.prefab';
const VIEW_PATH = 'assets/script/app/bigmap/view/BigMapWorldView.ts';
const TEMPLATES_PATH = 'assets/resources/ui/bigmap/BigMapWorldTemplates.prefab';

test('世界视图只引用独立模板资产，层级中不含 Templates 或模板子树', () => {
    assert.ok(existsSync(TEMPLATES_PATH));
    const meta = JSON.parse(readFileSync(`${TEMPLATES_PATH}.meta`, 'utf8')) as { uuid: string };
    const world = readFileSync(WORLD_PATH, 'utf8');
    assert.ok(world.includes(meta.uuid), '世界视图必须保留模板资产引用');
    const templates = JSON.parse(readFileSync(TEMPLATES_PATH, 'utf8')) as IPrefabObject[];
    const objects = JSON.parse(world) as IPrefabObject[];
    const root = templates[templates[0].data.__id__];
    assert.deepEqual(root._children.map((ref) => templates[ref.__id__]._name),
        ['GroundTemplate', 'DecorTemplate', 'MarkerTemplate']);
    const viewRoot = objects[objects[0].data.__id__];
    assert.deepEqual(viewRoot._children.map((ref) => objects[ref.__id__]._name), ['Viewport', 'Controls']);
    const view = objects.find((item) => 'viewport' in item);
    assert.ok(view);
    assert.equal((view.templatesPrefab as { __uuid__: string }).__uuid__, meta.uuid);
    const bindings = templates.find((item) => 'groundTemplate' in item);
    assert.ok(bindings, '独立模板必须绑定三个原型节点');
    for (const field of ['groundTemplate', 'decorTemplate', 'markerTemplate']) {
        assert.equal(templates[(bindings[field] as IPrefabRef).__id__]._name.toLowerCase(), field.toLowerCase());
        assert.equal(view[field], undefined, '主视图不得持有模板子节点的序列化引用');
    }
    assert.equal(objects.some((item) => /Template/.test(item._name ?? '')), false);
    for (const node of templates.filter((item) => item.__type__ === 'cc.Node')) {
        assert.equal(node._layer, 33554432, node._name);
        assert.ok(node._components.some((ref) => templates[ref.__id__].__type__ === 'cc.UITransform'));
        assert.ok(node._components.filter((ref) => ['cc.Sprite', 'cc.Graphics', 'cc.Label'].includes(templates[ref.__id__].__type__)).length <= 1,
            `${node._name} 不可同时挂两个渲染组件，否则 Cocos 会静默拒绝后一个组件`);
    }
    const marker = templates.find((item) => 'icon' in item && 'badge' in item);
    assert.ok(marker);
    for (const field of ['badgeBackground', 'portraitRoot', 'portrait', 'portraitBackground']) {
        const ref = marker[field] as IPrefabRef;
        assert.ok(ref && templates[ref.__id__], `地图标记未绑定：${field}`);
    }
    for (const field of ['icon', 'badge', 'label']) {
        const ref = marker[field] as IPrefabRef;
        assert.ok(ref && templates[ref.__id__], `模板内未绑定：${field}`);
    }
    const badge = templates[(marker.badge as IPrefabRef).__id__];
    assert.equal(templates[(badge.node as IPrefabRef).__id__]._lpos.y, BIGMAP_MARKER_BADGE_Y);
    const label = templates[(marker.label as IPrefabRef).__id__];
    assert.ok(label);
    assert.equal(label._fontSize, 15);
    assert.equal(label._overflow, 2);
    assert.equal(label._enableOutline, true);
    for (const sprite of templates.filter((item) => item.__type__ === 'cc.Sprite' && item._sizeMode === 0)) {
        assert.equal(sprite._isTrimmedMode, false);
    }
});

test('大地图视图只实例化编辑器模板，不在代码里搭建节点或添加组件', () => {
    const source = readFileSync(VIEW_PATH, 'utf8');
    assert.doesNotMatch(source, /createUiNode|createLabel|createButton|new Node\(|\.addComponent\(|destroyAllChildren/);
    assert.match(source, /instantiate\(this\.groundTemplate\)/);
    assert.match(source, /instantiate\(this\.markerTemplate\)/);
    assert.doesNotMatch(source, /validateBindings|getBinding/);
    assert.match(source, /type: Button, group:/);
    assert.match(source, /type: Graphics, group:/);
    const page = readFileSync('assets/script/app/bigmap/view/BigMapPage.ts', 'utf8');
    assert.match(page, /assets\.load\([^\n]*Pref(?:ab|AB)|assets\.load\(BIGMAP_WORLD_PREFAB_PATH, Prefab/);
    assert.doesNotMatch(page, /addComponent\(BigMapWorldView\)/);
});

test('编辑器预制体绑定视口、地图图层、操作按钮和三种池模板，所有节点均为 UI_2D', () => {
    assert.ok(existsSync(WORLD_PATH), '必须由 Cocos MCP 创建预制体');
    const objects = JSON.parse(readFileSync(WORLD_PATH, 'utf8')) as IPrefabObject[];
    const root = objects[objects[0].data.__id__];
    const components = root._components.map((ref: { __id__: number }) => objects[ref.__id__]);
    const viewComponent = components.find((component: Record<string, unknown>) => 'viewport' in component);
    assert.ok(viewComponent, '预制体必须挂 BigMapWorldView');
    const view = viewComponent as unknown as Record<string, IPrefabRef>;
    for (const field of ['viewport', 'content', 'rootTransform', 'viewportTransform', 'background', 'sand', 'sandTransform',
        'tileLayer', 'decorLayer', 'terrainLayer', 'markerLayer', 'iconLayer',
        'zoomInButton', 'zoomOutButton', 'focusButton']) {
        assert.ok(view[field] && objects[view[field].__id__], `未绑定必填引用：${field}`);
    }
    for (const [field, type] of [['rootTransform', 'cc.UITransform'], ['viewportTransform', 'cc.UITransform'],
        ['background', 'cc.Sprite'], ['sand', 'cc.Sprite'], ['sandTransform', 'cc.UITransform'],
        ['terrainLayer', 'cc.Graphics'], ['markerLayer', 'cc.Graphics'], ['zoomInButton', 'cc.Button'],
        ['zoomOutButton', 'cc.Button'], ['focusButton', 'cc.Button']] as const) {
        assert.equal(objects[view[field].__id__].__type__, type, field);
    }
    const viewport = objects[view.viewport.__id__];
    assert.ok(viewport._components.some((ref: { __id__: number }) => objects[ref.__id__].__type__ === 'cc.Mask'));
    const content = objects[view.content.__id__];
    assert.deepEqual(content._children.map((ref: { __id__: number }) => objects[ref.__id__]._name),
        ['TerrainFallback', 'Ground', 'WastelandDetails', 'Ownership', 'Buildings']);
    const templates = JSON.parse(readFileSync(TEMPLATES_PATH, 'utf8')) as IPrefabObject[];
    const groundNode = templates.find((item) => item._name === 'GroundTemplate');
    assert.ok(groundNode);
    const ground = groundNode._components.map((ref: { __id__: number }) => templates[ref.__id__])
        .find((component: Record<string, unknown>) => component.__type__ === 'cc.Sprite');
    assert.equal(ground.__type__, 'cc.Sprite');
    assert.equal(ground._sizeMode, 0);
    assert.equal(ground._isTrimmedMode, false);
    const markerNode = templates.find((item) => item._name === 'MarkerTemplate');
    assert.ok(markerNode);
    const marker = markerNode._components.map((ref: { __id__: number }) => templates[ref.__id__])
        .find((component: Record<string, unknown>) => 'icon' in component && 'badge' in component);
    assert.ok(marker);
    for (const [field, type] of [['icon', 'cc.Sprite'], ['badge', 'cc.Sprite'], ['label', 'cc.Label']] as const) {
        assert.equal(templates[(marker[field] as IPrefabRef).__id__].__type__, type);
    }
    const markerBindings = marker as unknown as Record<string, IPrefabRef>;
    const badge = templates[(templates[markerBindings.badge.__id__].node as IPrefabRef).__id__];
    const label = templates[(templates[markerBindings.label.__id__].node as IPrefabRef).__id__];
    assert.equal(badge._lpos.y, BIGMAP_MARKER_BADGE_Y, '可见角标必须与点击范围使用同一落点');
    assert.equal(label._lpos.x, 0);
    assert.equal(label._lpos.y, 0);
    for (const [field, width, height] of [['zoomInButton', 40, 40], ['zoomOutButton', 40, 40], ['focusButton', 56, 34]] as const) {
        const node = objects[(objects[view[field].__id__].node as IPrefabRef).__id__];
        const transform = node._components.map((ref: { __id__: number }) => objects[ref.__id__])
            .find((component: Record<string, unknown>) => component.__type__ === 'cc.UITransform');
        assert.equal(transform._contentSize.width, width);
        assert.equal(transform._contentSize.height, height);
        assert.ok(node._components.some((ref: { __id__: number }) => objects[ref.__id__].__type__ === 'cc.Button'));
    }
    for (const node of objects.filter((item) => item.__type__ === 'cc.Node')) {
        assert.equal(node._layer, 33554432, node._name);
        assert.ok(node._components.some((ref: { __id__: number }) => objects[ref.__id__].__type__ === 'cc.UITransform'), node._name);
    }
});
