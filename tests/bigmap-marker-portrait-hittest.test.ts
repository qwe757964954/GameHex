/**
 * 据点标记「头像撑命中框」的幂等性判据。
 *
 * 背景：`BigMapWorldMarker.setPortrait` 会往上撑 120px 命中框（把头像一起框进点击范围）。
 * 老写法是拿 `markerLayout` **就地累加**，于是只要出现「只换头像、不重跑 `render()`」的调用
 * （换装 / 玩家改名 / 头像异步回包后补挂），每调一次命中框就再涨 120px、头像再往上漂 60px，
 * 而界面上只表现为「点不中 / 头像越飘越高」，看不出根因。
 *
 * 现在改成从 `render()` 存下的基框派生 ⇒ 重复调用必须恒等于「基框 + 120」。
 * 本文件是这条不变量的回归锁：谁再把 `+120` 写回就地累加，这里立刻红。
 *
 * 用 `runInNewContext` + `cc` 桩 —— `BigMapWorldMarker` import 了 `cc`，直接 import 会让
 * node 用例依赖引擎（工程约定：被 node 用例 import 的模块依赖链上禁出现 `cc`）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

/** 头像撑高的量：与 `setPortrait` 里的 120 / 60 对齐，改实现要同步改这里。 */
const PORTRAIT_HIT_EXPAND = 120;
const PORTRAIT_HIT_LIFT = 60;
/** `bigMapMarkerLayout` 桩的固定输出 —— 基框全靠它，断言才不依赖真实布局算法。 */
const BASE_LAYOUT = { width: 120, height: 200, iconY: 30, badgeY: -80, badgeHeight: 40 };

class UITransform {
    node: unknown = null;
    width = 0; height = 0;
    anchorX = 0.5; anchorY = 0.5;
    setContentSize(w: number, h: number): void { this.width = w; this.height = h; }
    setAnchorPoint(x: number, y: number): void { this.anchorX = x; this.anchorY = y; }
}
class MockNode {
    active = true;
    position = { x: 0, y: 0, z: 0 };
    readonly components = new Map<unknown, unknown>();
    setPosition(x: number, y: number, z = 0): void { this.position = { x, y, z }; }
    setScale(): void {}
    getComponent<T>(Ctor: new (...args: never[]) => T): T | null {
        return (this.components.get(Ctor) as T) ?? null;
    }
}
class Sprite {
    static SizeMode = { CUSTOM: 1, TRIMMED: 0, RAW: 2 };
    node!: MockNode;
    spriteFrame: unknown = null;
    color: unknown = null;
    trim = true;
    sizeMode = 0;
}
class Label {
    node!: MockNode;
    string = '';
    fontSize = 20;
}
class Graphics {
    node!: MockNode;
    enabled = true;
    fillColor: unknown = null;
    strokeColor: unknown = null;
    lineWidth = 0;
    clear(): void {}
    roundRect(): void {}
    fill(): void {}
    stroke(): void {}
    moveTo(): void {}
    lineTo(): void {}
    close(): void {}
}
class Color {
    static WHITE = new Color(255, 255, 255, 255);
    constructor(public r = 0, public g = 0, public b = 0, public a = 255) {}
}

interface IMarkerView {
    render(frame: unknown, plate: unknown, level: string, name: string, occupant: string, tint: unknown, width: number): void;
    setPortrait(frame: unknown): void;
    readonly hitArea: { width: number; height: number; iconY?: number };
}
interface IMarkerInternals {
    icon: Sprite; badge: Sprite; label: Label; nameLabel: Label; badgeBackground: Graphics;
    occupantRoot: MockNode; occupantFlag: Sprite; occupantLabel: Label;
    portraitRoot: MockNode; portrait: Sprite; portraitBackground: Graphics;
}

function newSpriteFrame(): unknown {
    return { rect: { width: 120, height: 120 }, originalSize: { width: 120, height: 120 }, offset: { x: 0, y: 0 } };
}

function createMarker(): { view: IMarkerView; parts: IMarkerInternals } {
    const ccStub = {
        _decorator: { ccclass: () => (value: unknown) => value, property: () => () => undefined },
        Component: class {}, Color, Graphics, Label, Node: MockNode, Sprite, SpriteFrame: class {}, UITransform,
    };
    const exports: Record<string, unknown> = {};
    const code = ts.transpileModule(
        readFileSync('assets/script/app/bigmap/view/BigMapWorldMarker.ts', 'utf8'),
        { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true } },
    ).outputText;
    runInNewContext(code, { exports, require(name: string) {
        if (name === 'cc') return ccStub;
        if (name.endsWith('/BigMapWorldLayout')) {
            return { bigMapMarkerLayout: () => ({ ...BASE_LAYOUT }) };
        }
        if (name.endsWith('/MapMarkerBadge')) return { paintMapMarkerBadge: () => undefined };
        return {};
    } });

    const Marker = exports.BigMapWorldMarker as new () => IMarkerView & IMarkerInternals;
    const marker = new Marker();
    const attach = (node: MockNode): void => {
        const transform = new UITransform();
        transform.node = node;
        node.components.set(UITransform, transform);
    };
    const sprite = (): Sprite => { const s = new Sprite(); s.node = new MockNode(); attach(s.node); return s; };
    const label = (): Label => { const l = new Label(); l.node = new MockNode(); attach(l.node); return l; };
    const node = (): MockNode => { const n = new MockNode(); attach(n); return n; };
    const graphics = (): Graphics => { const g = new Graphics(); g.node = new MockNode(); attach(g.node); return g; };
    marker.icon = sprite();
    marker.badge = sprite();
    marker.label = label();
    marker.nameLabel = label();
    marker.badgeBackground = graphics();
    marker.occupantRoot = node();
    marker.occupantFlag = sprite();
    marker.occupantLabel = label();
    marker.portraitRoot = node();
    marker.portrait = sprite();
    return { view: marker, parts: marker };
}

/** 一次完整的 `render()`：建立基框。 */
function renderOnce(view: IMarkerView): void {
    view.render(newSpriteFrame(), newSpriteFrame(), '5', '青龙关', '', new Color(), 120);
}

test('头像挂上后命中框 = 基框 + 120，头像落在建筑顶再上 60', () => {
    const { view, parts } = createMarker();
    renderOnce(view);
    assert.equal(view.hitArea.height, BASE_LAYOUT.height, 'render 之后还没挂头像，不该有外扩');

    view.setPortrait(newSpriteFrame());
    assert.equal(parts.portraitRoot.active, true);
    assert.equal(view.hitArea.height, BASE_LAYOUT.height + PORTRAIT_HIT_EXPAND);
    assert.equal(view.hitArea.iconY, (BASE_LAYOUT.iconY ?? 0) + PORTRAIT_HIT_LIFT);
    const expectedTop = (BASE_LAYOUT.iconY ?? 0) + BASE_LAYOUT.height / 2 + 60;
    assert.equal(parts.portraitRoot.position.y, expectedTop);
});

test('★重复 setPortrait 命中框不累加（只换头像、不重跑 render 的路径）', () => {
    const { view } = createMarker();
    renderOnce(view);
    const frame = newSpriteFrame();
    view.setPortrait(frame);
    const first = { ...view.hitArea };
    view.setPortrait(frame);
    view.setPortrait(frame);
    assert.deepEqual(
        { height: view.hitArea.height, iconY: view.hitArea.iconY },
        { height: first.height, iconY: first.iconY },
        '连续挂三次头像，命中框必须与第一次完全一致（就地累加会这里红）',
    );
    assert.equal(view.hitArea.height, BASE_LAYOUT.height + PORTRAIT_HIT_EXPAND);
});

test('撤掉头像（setPortrait(null)）命中框退回基框，且再 render 也回到同一基框', () => {
    const { view, parts } = createMarker();
    renderOnce(view);
    view.setPortrait(newSpriteFrame());
    assert.equal(view.hitArea.height, BASE_LAYOUT.height + PORTRAIT_HIT_EXPAND);

    view.setPortrait(null);
    assert.equal(parts.portraitRoot.active, false);
    assert.equal(view.hitArea.height, BASE_LAYOUT.height);
    assert.equal(view.hitArea.iconY, BASE_LAYOUT.iconY);

    // 再撑一次仍然只 +120：证明基框没被上一轮的外扩污染。
    view.setPortrait(newSpriteFrame());
    assert.equal(view.hitArea.height, BASE_LAYOUT.height + PORTRAIT_HIT_EXPAND);
    renderOnce(view);
    assert.equal(view.hitArea.height, BASE_LAYOUT.height);
});
