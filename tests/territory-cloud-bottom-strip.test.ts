/**
 * 新手引导收起底部 UI ⇒ 云层继续向屏幕底填充完整（2026-11-17）。
 *
 * ## 真因（不是 inset / 留白算错）
 *
 * `MainTerritoryMap.prefab` 的层级是：
 * ```text
 * 页面根 MainTerritoryMap（自身挂 zdbg1 橙色 Sprite，720×1280）
 *   └ MapViewport（cc.Mask GRAPHICS_RECT，Widget bottom = 168 ⇒ 高 1112）
 *       └ MapLayer → GridLayer / CloudKeepOut → CloudFillLayer
 * ```
 * `CloudFillLayer` 铺得再满也出不了 `MapViewport` 的 rect Mask。底栏 `BottomNav`
 * 正好盖住视口下面那条 168px；`GuideComposition.syncDialogHud` 把它 `active = false`
 * 之后，那里就只剩页面根那张橙色底图 —— 用户截图底部约 13%（168 / 1280）的橙色带。
 *
 * ## 修法
 *
 * 在**页面根第 0 个孩子**建一条 `CloudBottomStrip`：压住橙色裸底图、仍被
 * `MapViewport` 整棵子树盖住（不需要第二层 Mask）；用与铺满层同源的格网铺点，
 * 只在「底栏被收起」时点亮，淡出跟着铺满层一起收。
 *
 * 本文件钉四件事：
 *  1. prefab 事实：Mask / Widget bottom / 页面根底图；
 *  2. 纯几何：补云带的格点相位与铺满层同源、中线落在视口底边与页面底边之间；
 *  3. 接线：页面判 `BottomNav.active` → 地图视图转发 → 云层建层，且只在需要时点亮；
 *  4. VM 行为：第 0 个孩子、影子在下、幂等、视口到底不补、雾散完一起收。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

import * as cloud from '../assets/script/app/territory/model/TerritoryCloud';
import * as layout from '../assets/script/app/territory/model/TerritoryMapLayout';
import * as gridLayout from '../assets/script/core/hex/HexGridLayout';

const PAGE_SRC = readFileSync('assets/script/app/main/MainTerritoryMap.ts', 'utf8');
const MAP_VIEW_SRC = readFileSync('assets/script/app/territory/view/TerritoryMapView.ts', 'utf8');
const CLOUD_VIEW_SRC = readFileSync('assets/script/app/territory/view/TerritoryCloudView.ts', 'utf8');
const CLOUD_MODEL_SRC = readFileSync('assets/script/app/territory/model/TerritoryCloud.ts', 'utf8');

/** 剥注释后再判源码（反向断言必须剥 —— 说明注释里就写着被禁的写法）。 */
function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// ============================================================
// 一、prefab 事实：为什么铺满层到不了屏幕底
// ============================================================

const prefab = JSON.parse(readFileSync(
    'assets/resources/ui/main/MainTerritoryMap.prefab', 'utf8')) as Record<string, any>[];

test('★★★MapViewport 的 rect Mask 是启用的，且 Widget bottom = 168', () => {
    const viewport = prefab.find((o) => o?.__type__ === 'cc.Node' && o._name === 'MapViewport');
    assert.ok(viewport, '要有 MapViewport');
    const comps = (viewport._components ?? [])
        .map((ref: { __id__: number }) => prefab[ref.__id__])
        .filter(Boolean);
    const mask = comps.find((o: any) => o.__type__ === 'cc.Mask');
    const widget = comps.find((o: any) => o.__type__ === 'cc.Widget');
    const transform = comps.find((o: any) => o.__type__ === 'cc.UITransform');
    assert.equal(mask?._enabled, true, 'Mask 开着 ⇒ 云层画不出视口');
    assert.equal(mask?._type, 0, 'GRAPHICS_RECT：裁切矩形取 UITransform 尺寸');
    assert.equal(widget?._bottom, 168, '视口底边离页面底还有 168px —— 正是截图那条橙色带');
    assert.equal(transform?._contentSize?.height, 1112, '1280 − 168 = 1112');
});

test('★★★页面根自己挂 zdbg1 橙色底图，收起底栏后就是它露出来', () => {
    const root = prefab.find((o) => o?.__type__ === 'cc.Node' && o._name === 'MainTerritoryMap');
    assert.ok(root);
    const sprite = (root._components ?? [])
        .map((ref: { __id__: number }) => prefab[ref.__id__])
        .find((o: any) => o?.__type__ === 'cc.Sprite');
    assert.match(sprite?._spriteFrame?.__uuid__ ?? '', /^59db350f/,
        '页面根的底图是 image/zdbg1.jpg（橙色沙漠）；补云带必须压在它上面');
});

// ============================================================
// 二、纯几何：补云带与铺满层同源
// ============================================================

test('★★★补云带点阵 = 铺满层同一张格网，整体平移到页面底部的带中线', () => {
    const rows = 18;
    const columns = 15;
    const width = 720;
    const stripHeight = 168;
    const centerY = -640 + stripHeight / 2; // -556
    const base = cloud.territoryCloudFillPoints(rows, columns, width, stripHeight);
    const band = cloud.territoryCloudBottomStripPoints(rows, columns, width, stripHeight, centerY);
    assert.ok(base.length > 0, '这条带至少要铺得上云');
    assert.equal(band.length, base.length, '不许换格网 / 不许少铺一列');
    for (let i = 0; i < band.length; i += 1) {
        assert.equal(band[i].x, base[i].x, `第 ${i} 点 x 必须与铺满层同相位`);
        assert.ok(Math.abs((band[i].y - centerY) - base[i].y) < 1e-9,
            `第 ${i} 点 y 只能是整体平移 ${centerY}`);
    }
    // 带高 168 时，云点要横向铺满整屏、纵向覆盖整条带（含半朵云的外扩）。
    assert.ok(band.some((p) => p.x < -width / 2 + 100), '左边缘要有云');
    assert.ok(band.some((p) => p.x > width / 2 - 100), '右边缘要有云');
    assert.ok(band.every((p) => p.y <= centerY + stripHeight / 2 + 130),
        '不许把云铺到视口里太深（会被 MapBackground 盖住，白建节点）');
});

test('★★★非法尺寸 / 行列一律不铺（不许产出 NaN 或半屏云）', () => {
    for (const args of [
        [18, 15, 0, 168, -556], [18, 15, 720, 0, -556],
        [18, 15, 720, -10, -556], [0, 15, 720, 168, -556],
        [18, 0, 720, 168, -556],
    ] as const) {
        assert.deepEqual(cloud.territoryCloudBottomStripPoints(...args), [],
            `非法入参 ${args.join('/')} 应返回空`);
    }
    const band = cloud.territoryCloudBottomStripPoints(
        18, 15, 720, 168, Number.POSITIVE_INFINITY);
    assert.deepEqual(band, [], '中线不是有限数 ⇒ 宁可不铺，也不能把坐标写成 Infinity');
    assert.match(CLOUD_MODEL_SRC,
        /export function territoryCloudBottomStripPoints\(/,
        '补云带几何必须是模型里的纯函数，别塞进视图里现算');
});

// ============================================================
// 三、接线：页面判底栏 → 视图转发 → 云层建层
// ============================================================

test('★★★页面按 BottomNav.active 判定，且排在 update 的所有早退之前', () => {
    const code = stripComments(PAGE_SRC);
    const updateAt = code.indexOf('update(dt: number): void {');
    assert.ok(updateAt > 0, '要有 update');
    const syncAt = code.indexOf('this.syncBottomCloudFill();', updateAt);
    const earlyReturn = code.indexOf('return;', updateAt);
    assert.ok(syncAt > updateAt, 'update 要调 syncBottomCloudFill');
    assert.ok(syncAt < earlyReturn,
        '🔴 补云带判定必须排在过场 / 战斗前奏的早退之前 —— 晚一帧就闪出一条橙色底图');

    const methodAt = code.indexOf('private syncBottomCloudFill()');
    assert.ok(methodAt > 0, '要有 syncBottomCloudFill');
    const body = code.slice(methodAt, code.indexOf('\n    }', methodAt));
    assert.match(body, /navBar\.active/,
        '判据是底栏这个「盖子」在不在，不是去问引导配置（页面不许反向依赖引导）');
    assert.match(body, /this\.bottomNavNode/,
        '底栏节点要缓存，别每帧逐层 getComponent(MainTabHost)');
    assert.match(body, /if \(visible === this\.bottomCloudFillVisible\) return;/,
        '值没变要早退 —— 不重铺那几十个 Sprite');
    assert.match(body, /setBottomCloudFillVisible/, '只转发一个布尔给地图视图');
    assert.doesNotMatch(body, /new Node\(|addComponent\(/,
        '页面不许自己搭 UI（架构守卫 territory-page-split / territory-battle-intro）');
});

test('★★★地图视图只做转发，云层自己量视口 / 建层', () => {
    const view = stripComments(MAP_VIEW_SRC);
    const at = view.indexOf('setBottomCloudFillVisible(');
    assert.ok(at > 0, '视图要有 setBottomCloudFillVisible');
    const body = view.slice(at, view.indexOf('\n    }', at));
    assert.match(body, /this\.clouds\?\.setBottomStripEnabled/,
        '只转发，不许在地图视图里量页面尺寸 / 建节点');
    assert.doesNotMatch(body, /new Node\(/, '地图视图不许为这条带建节点');

    const clouds = stripComments(CLOUD_VIEW_SRC);
    assert.match(clouds, /territoryCloudBottomStripPoints\(/, '格点走模型纯函数');
    assert.match(clouds, /TERRITORY_CLOUD_BOTTOM_STRIP_NODE, page, page\.layer, 0\)/,
        '补云带必须挂页面根**第 0 个孩子**：压住橙色底图、但被 MapViewport 盖住');
    assert.match(clouds, /viewportBottom - pageBottom/,
        '带高按运行时视口底边 − 页面底边现算，不许抄死 168（长屏 / 安全区会变）');
    assert.match(clouds, /this\.bottomStripEnabled && !!this\.idleFrame && !this\.fillDismissed/,
        '底栏没收起 / 没雾 / 雾已散完，一条都不许补');
    assert.match(clouds, /this\.syncBottomStripAlpha\(\);/,
        '铺满层淡出时补云带要跟着变淡（排在 !dissolving 早退之前）');
    assert.match(clouds, /this\.rebindSprites\(this\.bottomStripSprites, this\.idleFrame\)/,
        '帧晚到时要把图补进已建好的节点（与铺满层 / 云洞层同一个坑）');
});

// ============================================================
// 四、VM 行为：只在底栏收起时第 0 个孩子点亮，且幂等
// ============================================================

class NodeStub {
    isValid = true;
    active = true;
    layer = 33554432;
    parent: NodeStub | null = null;
    children: NodeStub[] = [];
    position = { x: 0, y: 0, z: 0 };
    scale = { x: 1, y: 1, z: 1 };
    worldPosition = { x: 0, y: 0, z: 0 };
    worldScale = { x: 1, y: 1, z: 1 };
    private readonly components = new Map<unknown, unknown>();

    constructor(public name = '') {}

    setParent(parent: NodeStub): void {
        if (this.parent) {
            const i = this.parent.children.indexOf(this);
            if (i >= 0) this.parent.children.splice(i, 1);
        }
        this.parent = parent;
        parent.children.push(this);
    }

    getSiblingIndex(): number {
        return this.parent ? this.parent.children.indexOf(this) : -1;
    }

    setSiblingIndex(index: number): void {
        if (!this.parent) return;
        const list = this.parent.children;
        const from = list.indexOf(this);
        if (from >= 0) list.splice(from, 1);
        list.splice(Math.max(0, Math.min(index, list.length)), 0, this);
    }

    setPosition(x: number, y: number, z: number): void { this.position = { x, y, z }; }
    setScale(x: number, y: number, z: number): void { this.scale = { x, y, z }; }
    setWorldPosition(x: number, y: number, z: number): void {
        this.worldPosition = { x, y, z };
    }
    setWorldScale(x: number, y: number, z: number): void { this.worldScale = { x, y, z }; }

    addComponent(ctor: new () => unknown): any {
        const component = new ctor() as { node?: NodeStub };
        component.node = this;
        this.components.set(ctor, component);
        return component;
    }

    getComponent(ctor: unknown): any { return this.components.get(ctor) ?? null; }

    destroy(): void {
        this.isValid = false;
        if (this.parent) {
            const i = this.parent.children.indexOf(this);
            if (i >= 0) this.parent.children.splice(i, 1);
        }
        this.parent = null;
    }
}

class UITransformStub {
    node: NodeStub | null = null;
    contentSize = { width: 0, height: 0 };
    setContentSize(width: number, height: number): void {
        this.contentSize = { width, height };
    }
    convertToWorldSpaceAR(point: { x: number; y: number; z?: number }): { x: number; y: number; z: number } {
        const node = this.node;
        if (!node) return { x: point.x, y: point.y, z: point.z ?? 0 };
        return {
            x: node.worldPosition.x + point.x * node.worldScale.x,
            y: node.worldPosition.y + point.y * node.worldScale.y,
            z: node.worldPosition.z,
        };
    }
}

class SpriteStub {
    static SizeMode = { CUSTOM: 0, TRIMMED: 1, RAW: 2 };
    node: NodeStub | null = null;
    trim = true;
    sizeMode = 0;
    spriteFrame: any = null;
    private _color = { r: 255, g: 255, b: 255, a: 255 };
    get color(): { r: number; g: number; b: number; a: number } { return this._color; }
    set color(value: { r: number; g: number; b: number; a: number }) {
        this._color = { r: value.r, g: value.g, b: value.b, a: value.a };
    }
}

class Vec3Stub {
    constructor(public x = 0, public y = 0, public z = 0) {}
}
class ColorStub {
    constructor(public r = 255, public g = 255, public b = 255, public a = 255) {}
}
class GraphicsStub {
    node: NodeStub | null = null;
    fillColor = new ColorStub();
    clear(): void {}
    moveTo(): void {}
    lineTo(): void {}
    close(): void {}
    fill(): void {}
}
class MaskStub {
    static Type = { GRAPHICS_RECT: 0, GRAPHICS_ELLIPSE: 1, GRAPHICS_STENCIL: 2, SPRITE_STENCIL: 3 };
    node: NodeStub | null = null;
    type = MaskStub.Type.GRAPHICS_RECT;
    inverted = false;
    enabled = true;
}

const ccStub = {
    Node: NodeStub,
    Sprite: SpriteStub,
    UITransform: UITransformStub,
    Color: ColorStub,
    Graphics: GraphicsStub,
    Mask: MaskStub,
    Vec3: Vec3Stub,
    SpriteFrame: class {},
};

let cached: Record<string, any> | null = null;
function cloudViewModule(): Record<string, any> {
    if (cached) return cached;
    const code = ts.transpileModule(CLOUD_VIEW_SRC, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const exports: Record<string, any> = {};
    runInNewContext(code, {
        exports, console,
        require: (name: string) => {
            if (name === 'cc') return ccStub;
            if (name === '../model/TerritoryCloud') return cloud;
            if (name === '../model/TerritoryMapLayout') return layout;
            if (name === '../../../core/hex/HexGridLayout') return gridLayout;
            throw new Error(`未预期依赖 ${name}`);
        },
    });
    cached = exports;
    return exports;
}

interface Fixture {
    view: any;
    page: NodeStub;
    viewport: NodeStub;
    strip(): NodeStub | null;
}

function fixture(): Fixture {
    const page = new NodeStub('MainTerritoryMap');
    page.addComponent(UITransformStub).setContentSize(720, 1280);
    const viewport = new NodeStub('MapViewport');
    viewport.addComponent(UITransformStub).setContentSize(720, 1112);
    viewport.setParent(page);
    viewport.setPosition(0, 84, 0); // 顶边贴屏幕顶 (640)，中心 = 640 − 556 = 84
    const mapLayer = new NodeStub('MapLayer');
    mapLayer.addComponent(UITransformStub);
    mapLayer.setParent(viewport);
    const gridLayer = new NodeStub('GridLayer');
    gridLayer.addComponent(UITransformStub);
    gridLayer.setParent(mapLayer);

    const View = cloudViewModule().TerritoryCloudView;
    const view = new View();
    view.attach(gridLayer);
    view.setFrames({
        body: [{ name: 'cloud_body_0' }],
        shadow: [{ name: 'cloud_shadow_0' }],
        dissolveBody: [],
        dissolveShadow: [],
    });
    view.setFillArea(1421.5, 2315, 18, 15);
    return {
        view, page, viewport,
        strip: () => page.children.find((child) => child.name === 'CloudBottomStrip') ?? null,
    };
}

test('★★★底栏没收起时页面根一个多余节点都不建（平时画面零变化）', () => {
    const { page } = fixture();
    assert.equal(page.children.some((child) => child.name === 'CloudBottomStrip'), false,
        '底栏还盖着那条带，不许为了「以后可能要补」先把几十个 Sprite 挂上去');
});

test('★★★底栏收起 ⇒ 页面根第 0 个孩子点亮，云体 / 影子成对铺到屏幕底', () => {
    const fx = fixture();
    fx.view.setBottomStripEnabled(true);
    const strip = fx.strip();
    assert.ok(strip, '要建 CloudBottomStrip');
    assert.equal(strip.getSiblingIndex(), 0,
        '必须排在 MapViewport 之前：压住橙色底图、又被 MapBackground 盖回去');
    assert.equal(strip.active, true, '底栏收起 ⇒ 这条带要亮');

    const bodies = strip.children.filter((child) => child.name === 'CloudBottomFill');
    const shadowGroup = strip.children.find(
        (child) => child.name === 'CloudBottomStripShadow');
    assert.ok(bodies.length > 0, '一条带至少要铺得上云');
    assert.ok(shadowGroup, '影子要有独立分组');
    assert.equal(shadowGroup.getSiblingIndex(), 0, '影子必须排在所有云体之前');
    assert.equal(
        shadowGroup.children.filter((child) => child.name === 'CloudBottomFillShadow').length,
        bodies.length,
        '云体 / 影子一一对应（少一朵影子，带子会少了地面投影）',
    );
    // 带中线 -556、带高 168：云心（含 12.5 抬升与美术偏移）应落在这一截附近。
    for (const body of bodies) {
        assert.ok(body.position.y >= -640 - 130 && body.position.y <= -472 + 130,
            `云心 ${body.position.y} 不在底部那条带里`);
        assert.ok(Math.abs(body.position.x) <= 360 + 100 + 1e-9,
            `云心 ${body.position.x} 跑出页面宽了`);
    }
});

test('★★★开关幂等：反复切底栏不会重复建层 / 重复堆几十份 Sprite', () => {
    const fx = fixture();
    fx.view.setBottomStripEnabled(true);
    const strip = fx.strip()!;
    const bodies = strip.children.filter((child) => child.name === 'CloudBottomFill').length;
    const children = fx.page.children.length;
    fx.view.setBottomStripEnabled(false);
    assert.equal(strip.active, false, '底栏回来 ⇒ 立刻收掉（交给底栏盖）');
    fx.view.setBottomStripEnabled(true);
    fx.view.setBottomStripEnabled(true);
    assert.equal(fx.page.children.length, children, '不许重复建页面根子节点');
    assert.equal(strip.children.filter((child) => child.name === 'CloudBottomFill').length, bodies,
        '同指纹不许重建节点');
    assert.equal(strip.active, true, '再收起底栏要能重新点亮');
});

test('★★★视口本来就铺到页面底（带高 0）⇒ 不补云，避免多一层无用绘制', () => {
    const fx = fixture();
    fx.view.setBottomStripEnabled(true);
    // 视口改成 720×1280、居中 ⇒ 底边与页面底边重合，Mask 没有裁掉任何一段。
    fx.viewport.getComponent(UITransformStub).setContentSize(720, 1280);
    fx.viewport.setPosition(0, 0, 0);
    fx.view.setFillArea(1421.5, 2483, 18, 15);
    assert.equal(fx.strip()?.active, false,
        '带高 0 ⇒ 不该点亮（此时改 inset / padding 也铺不出 Mask 外面去）');
});

test('★★★铺满层淡出 / 雾散完时，补云带跟着一起收（不许孤零零留一条云）', () => {
    const fx = fixture();
    fx.view.setBottomStripEnabled(true);
    const strip = fx.strip()!;
    assert.equal(strip.active, true);

    // 模拟铺满层起淡：第 0 朵写到半透明 ⇒ 补云带同帧跟到半透明。
    const fillSprites = fx.view.fillSprites as SpriteStub[];
    assert.ok(fillSprites.length > 0, '铺满层要有云');
    fillSprites[0].color = { r: 255, g: 255, b: 255, a: 100 };
    fx.view.step(0.016);
    const body = strip.children.find((child) => child.name === 'CloudBottomFill');
    assert.ok(body, '要有云体节点');
    assert.equal(body.getComponent(SpriteStub).color.a, 100,
        'step() 要把铺满层的 alpha 同步到补云带（排在 !dissolving 早退之前）');

    // 整片雾散完 ⇒ 补云带直接收起来。
    fx.view.fillDismissed = true;
    fx.view.applyFillActive();
    assert.equal(strip.active, false, '雾散完了，底部不许还留一条云');
});
