import { EventMgr } from '../assets/script/framework/event/EventMgr';
import * as mvcEvents from '../assets/script/app/bigmap/application/BigMapEvents';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as geometry from '../assets/script/app/bigmap/view/BigMapWorldLayout';
import * as territoryColor from '../assets/script/app/bigmap/model/BigMapTerritoryColor';

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
        cc, '../../../framework/event/EventMgr': { EventMgr }, '../application/BigMapEvents': mvcEvents, '../model/BigMapWorld': {}, '../model/BigMapTerritoryColor': territoryColor,
        './BigMapWorldLayout': geometry, './BigMapTheme': theme, './BigMapWorldMarker': {},
        './BigMapWorldTemplates': {}, './BigMapBackgroundLayout': {},
    });
    const view = new BigMapWorldView();
    const tiles = Array.from({ length: 10000 }, (_, id) => ({ id,
        terrain: (['plain', 'forest', 'rock', 'water'] as const)[id % 4] }));
    const terrain = new Graphics(), marker = new Graphics();
    Object.assign(view, {
        data: { world: { rows: 100, cols: 100, seed: 1, tiles, tileById: new Map(tiles.map(t => [t.id,t])) } },
        layout: geometry.buildBigMapWorldLayout(100, 100), content: { position: { x: 0, y: 0 } },
        viewportTransform: { width: 720, height: 1280 }, terrainLayer: terrain, markerLayer: marker,
        art: { tiledBackground: { name:'seamless' }, ground, groundVariants: [ground],
            rock: { name:'rock', rect:{ width:32 } }, grass: { name:'grass', rect:{ width:32 } } },
    });
    return { view, terrain, marker, theme };
}

function playerMarkerFixture() {
    const { view } = fixture();
    const playerBase = { baseId: 'player', hexId: 5050, isPlayer: true };
    Object.assign(view.data, {
        playerBaseHexId: 5050, playerCampId: 101, territories: [], monsters: new Map(),
        cities: new Map([
            [101, { cityId: 101, hexId: 5050, level: 3, name: '城池甲', state: 'open', territoryOwner: 'neutral' }],
            [102, { cityId: 102, hexId: 5051, level: 4, name: '城池乙', state: 'open', territoryOwner: 'neutral' }],
        ]),
    });
    Object.assign(view.data.world, { monsters: [], playerBase, bases: [playerBase,
        { baseId: 'npc', hexId: 5052, isPlayer: false, name: '其他基地' }] });
    Object.assign(view.art, { home: { name: 'home' }, city: { name: 'city' }, camps: new Map(),
        plates: new Map([['self', { name: 'self' }], ['city', { name: 'city-plate' }]]) });
    view.playerPortrait = { name: 'portrait' };
    view.paintTerritory = () => {};
    view.addMarker = (kind: string, id: number | string, hexId: number) => {
        const point = view.layout.points.get(hexId);
        view.markers.push({ kind, id, hexId, icon: {},
            node: { active: true, position: point, destroyed: false,
                destroy() { this.destroyed = true; }, setSiblingIndex() {},
                // 城池聚焦会把标记按布局点幂等重摆（applyFocusIsolation），桩节点要能接 setPosition
                setPosition(x: number, y: number) { this.position = { x, y }; } },
            view: { hitArea: { height: 200 }, portrait: null,
                setPortrait(frame: unknown) { this.portrait = frame; } },
        });
    };
    view.applyMarker = (marker: { appearance?: unknown }, appearance: unknown) => { marker.appearance = appearance; };
    return view;
}

test('玩家基地与城池同格时只有一个标记，显示主城与头像且保留城池查询', () => {
    const view = playerMarkerFixture();
    view.refresh();
    const overlapping = view.markers.filter((marker: { hexId: number }) => marker.hexId === 5050);
    assert.equal(overlapping.length, 1);
    const marker = overlapping[0];
    assert.equal(marker.kind, 'city');
    assert.equal(marker.id, 101);
    assert.equal(marker.appearance.frame, view.art.home);
    assert.equal(marker.appearance.name, '主城');
    assert.equal(marker.appearance.level, '');
    assert.equal(marker.appearance.plate, view.art.plates.get('self'));
    assert.equal(marker.view.portrait, view.playerPortrait);
    assert.ok(view.markers.some((entry: { id: string }) => entry.id === 'npc'));
    const received: number[][] = [];
    const owner = {};
    EventMgr.instance.on(mvcEvents.BigMapUiEvent.Intent, (event: mvcEvents.IBigMapIntentEvent) => {
        if (event.intent.kind === 'visibleCamps') received.push(Array.from(event.intent.campIds));
    }, owner);
    try {
        view.isValid = true;
        view.node = { activeInHierarchy: true };
        view.reportVisibleCamps();
        assert.ok(received[0].includes(101));
    } finally { EventMgr.instance.offTarget(owner); }
});

test('基地位置回包后重建唯一主城，原位置恢复城池；无同格城池时显示独立基地', () => {
    const view = playerMarkerFixture();
    view.refresh();
    const oldMarkers = [...view.markers];
    view.data = { ...view.data, playerBaseHexId: 5051, playerCampId: 102 };
    view.refresh();
    assert.ok(oldMarkers.every((marker) => marker.node.destroyed));
    assert.equal(view.markers.filter((marker: { hexId: number }) => marker.hexId === 5051).length, 1);
    const previousCity = view.markers.find((marker: { id: number }) => marker.id === 101);
    assert.equal(previousCity.appearance.name, '城池甲');
    assert.equal(previousCity.appearance.frame, view.art.city);
    assert.equal(previousCity.view.portrait, null);
    const home = view.markers.find((marker: { id: number }) => marker.id === 102);
    assert.equal(home.appearance.name, '主城');
    assert.equal(home.view.portrait, view.playerPortrait);
    view.data = { ...view.data, playerBaseHexId: 5053, playerCampId: 0 };
    view.refresh();
    const standalone = view.markers.filter((marker: { hexId: number }) => marker.hexId === 5053);
    assert.equal(standalone.length, 1);
    assert.equal(standalone[0].kind, 'base');
    assert.equal(standalone[0].appearance.name, '主城');
    assert.equal(standalone[0].view.portrait, view.playerPortrait);
});

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

/** 色相（0~360）；灰阶（饱和度≈0）返回 -1，不参与红/绿族判定。 */
function hueOf(color: { r: number; g: number; b: number }): number {
    const r = color.r / 255, g = color.g / 255, b = color.b / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const delta = max - min;
    if (delta < 0.02) return -1;
    let hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    hue *= 60;
    return hue < 0 ? hue + 360 : hue;
}
const isRedHue = (hue: number): boolean => hue >= 0 && (hue < 20 || hue > 340);
const isGreenHue = (hue: number): boolean => hue > 70 && hue < 165;

test('势力归属决定整片范围的颜色：己方绿、他人红、无主走色板且更淡', () => {
    const { view, theme } = fixture();
    const rgb = (color: { r: number; g: number; b: number }) => [color.r, color.g, color.b];

    const mine = view.territoryPaint(101, { territoryOwner: 'self' });
    assert.deepEqual(rgb(mine.color), rgb(theme.BIGMAP_TERRITORY_SELF_COLOR));
    assert.ok(isGreenHue(hueOf(mine.color)), '己方势力必须是绿色');

    const enemy = view.territoryPaint(202, { territoryOwner: 'other' });
    assert.deepEqual(rgb(enemy.color), rgb(theme.BIGMAP_TERRITORY_ENEMY_COLOR));
    assert.ok(isRedHue(hueOf(enemy.color)), '其他玩家占据的势力必须是红色');

    // 归属地要压过中立的色板色：填充更实（但仍透出地块纹理）。
    assert.equal(mine.alpha, theme.BIGMAP_TERRITORY_OWNED_FILL_ALPHA);
    assert.equal(enemy.alpha, theme.BIGMAP_TERRITORY_OWNED_FILL_ALPHA);
    assert.ok(theme.BIGMAP_TERRITORY_OWNED_FILL_ALPHA > theme.BIGMAP_TERRITORY_FILL_ALPHA);
    assert.ok(theme.BIGMAP_TERRITORY_OWNED_FILL_ALPHA < 255);

    // 没被占的城：走色板，用淡填充 —— 且不会拿到红绿两族（否则和状态色撞车）。
    const neutral = view.territoryPaint(303, { territoryOwner: 'neutral' });
    assert.equal(neutral.alpha, theme.BIGMAP_TERRITORY_FILL_ALPHA);
    assert.deepEqual(rgb(neutral.color), rgb(theme.BIGMAP_TERRITORY_COLORS[0]));
});

test('色板一律冷色系：不许出现红绿两族，也不许橙黄（压在沙地上看不出边界）', () => {
    const { theme } = fixture();
    for (const color of theme.BIGMAP_TERRITORY_COLORS) {
        const hue = hueOf(color);
        const name = `rgb(${color.r},${color.g},${color.b})`;
        assert.ok(!isRedHue(hue), `色板色 ${name} 是红族，会和「他人占据」混淆`);
        assert.ok(!isGreenHue(hue), `色板色 ${name} 是绿族，会和「己方占据」混淆`);
        // 底色是暖沙（#CFAF8C）：橙 / 黄 / 土褐压上去等于没染（2026-10-28 用户反馈）。
        assert.ok(
            hue === -1 || (hue >= 165 && hue <= 335),
            `色板色 ${name} 的色相 ${hue.toFixed(0)}° 不在冷色范围（青→蓝→紫，165°~335°），会和沙地背景糊在一起`,
        );
    }
    // 色板要够用：真布局按邻接上色，4 色够；色板少于 5 个就没法在几何兜底时还保证相邻不同色。
    assert.ok(theme.BIGMAP_TERRITORY_COLORS.length >= 5, '色板少于 5 色时相邻势力会撞色');
});
