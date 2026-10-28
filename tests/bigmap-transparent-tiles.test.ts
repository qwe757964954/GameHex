import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as geometry from '../assets/script/app/bigmap/view/BigMapWorldLayout';

class Color {
    static WHITE = new Color(255, 255, 255);
    constructor(public r = 0, public g = 0, public b = 0, public a = 255) {}
}
class Sprite {
    node = null! as Node;
    color = Color.WHITE;
    spriteFrame: unknown = null;
}
class UITransform { setContentSize(): void {} }
class Node {
    active = true;
    position = { x: 0, y: 0 };
    private readonly sprite = new Sprite();
    constructor() { this.sprite.node = this; }
    getComponent(type: unknown) { return type === Sprite ? this.sprite : new UITransform(); }
    setPosition(x: number, y: number): void { this.position = { x, y }; }
    setParent(): void {}
    setScale(): void {}
}
class Graphics {
    fillColor = Color.WHITE;
    strokeColor = Color.WHITE;
    lineWidth = 0;
    fills: Color[] = [];
    strokes: Color[] = [];
    closeCount = 0;
    clear(): void { this.fills = []; this.strokes = []; this.closeCount = 0; }
    moveTo(): void {}
    lineTo(): void {}
    close(): void { this.closeCount++; }
    fill(): void { this.fills.push(this.fillColor); }
    stroke(): void { this.strokes.push(this.strokeColor); }
}

function load(path: string, imports: Record<string, unknown>) {
    const exports: Record<string, any> = {};
    runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText, { exports, require: (name: string) => {
        assert.ok(name in imports, `Unexpected import ${name}`);
        return imports[name];
    } });
    return exports;
}

function fixture(ground: unknown = { name: 'opaque-ground' }) {
    const cc = { Color, Sprite, UITransform, Node, Component: class {}, Vec2: class {
        constructor(public x = 0, public y = 0) {}
    }, instantiate: () => new Node(), _decorator: { ccclass: () => (value: unknown) => value, property: () => () => {} } };
    const theme = load('assets/script/app/bigmap/view/BigMapTheme.ts', { cc });
    const { BigMapWorldView } = load('assets/script/app/bigmap/view/BigMapWorldView.ts', {
        cc, '../application/BigMapCampRepository': {}, '../model/BigMapWorld': {}, '../model/BigMapTerritoryColor': {},
        './BigMapWorldLayout': geometry, './BigMapTheme': theme, './BigMapWorldMarker': {},
        './BigMapWorldTemplates': {}, './BigMapBackgroundLayout': {},
    });
    const view = new BigMapWorldView();
    const tiles = Array.from({ length: 10000 }, (_, id) => ({ id,
        terrain: (['plain', 'forest', 'rock', 'water'] as const)[id % 4] }));
    const terrain = new Graphics(), marker = new Graphics();
    Object.assign(view, {
        presenter: { world: { rows: 100, cols: 100, seed: 1, tiles, tileById: new Map(tiles.map(t => [t.id,t])) } },
        layout: geometry.buildBigMapWorldLayout(100, 100), content: { position: { x: 0, y: 0 } },
        viewportTransform: { width: 720, height: 1280 }, terrainLayer: terrain, markerLayer: marker,
        art: { tiledBackground: { name:'seamless' }, ground, groundVariants: [ground],
            rock: { name:'rock', rect:{ width:32 } }, grass: { name:'grass', rect:{ width:32 } } },
    });
    return { view, terrain, marker, theme };
}

test('无缝背景上使用透明色格和淡格线，不再铺不透明沙地 Sprite', () => {
    const { view, terrain } = fixture();
    view.syncVisibleTiles();
    assert.equal(view.tilePool.filter((s: Sprite) => s.node.active && s.spriteFrame).length, 0);
    assert.ok(terrain.fills.length > 0, '地形通过半透明颜色区分');
    assert.ok(terrain.fills.every(c => c.a > 0 && c.a < 64), '颜色要透出连续背景');
    assert.equal(terrain.strokes.length, 1, '格线仍可辨识');
    assert.ok(terrain.strokes[0].a > 0 && terrain.strokes[0].a < 100);
    assert.ok(terrain.closeCount < 500, '百行地图只画当前视口，不一次铺一万格');
    assert.ok(view.decorPool.some((s: Sprite) => s.node.active), '草石装饰继续按可见格渲染');
});

test('透明格不依赖旧沙地图，平移到地图外会清掉旧格和装饰', () => {
    const { view, terrain } = fixture(null);
    view.syncVisibleTiles();
    assert.equal(terrain.strokes.length, 1);
    view.content.position = { x: 100000, y: 100000 };
    view.syncVisibleTiles();
    assert.equal(terrain.closeCount, 0);
    assert.equal(terrain.fills.length, 0);
    assert.equal(view.decorPool.filter((s: Sprite) => s.node.active).length, 0);
});

test('从旧贴图模式切换到连续背景后，已有槽位不再遮住底图；势力颜色继续半透明叠加', () => {
    const { view, marker, theme } = fixture();
    view.art.tiledBackground = null;
    view.syncVisibleTiles();
    assert.ok(view.tilePool.some((s: Sprite) => s.node.active && s.spriteFrame));
    view.art.tiledBackground = { name:'seamless' };
    view.syncVisibleTiles();
    assert.equal(view.tilePool.filter((s: Sprite) => s.node.active).length, 0);
    view.paintTerritory([5050], new Color(92,138,208), []);
    assert.equal(marker.fills[0].a, theme.BIGMAP_TERRITORY_FILL_ALPHA);
    assert.ok(marker.fills[0].a < 255);
});
