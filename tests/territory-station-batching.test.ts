import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

type Listener = { readonly callback: () => void; readonly target: unknown };

class FakeVec3 {
    constructor(public x = 0, public y = 0, public z = 0) {}

    clone(): FakeVec3 {
        return new FakeVec3(this.x, this.y, this.z);
    }
}

class FakeNode {
    active = true;
    angle = 0;
    isValid = true;
    position = new FakeVec3();
    parent: FakeNode | null = null;
    destroyCount = 0;
    private readonly listeners = new Map<string, Listener[]>();

    constructor(readonly name: string) {}

    setParent(parent: FakeNode): void {
        this.parent = parent;
    }

    setPosition(x: number | FakeVec3, y?: number, z?: number): void {
        this.position = x instanceof FakeVec3 ? x.clone() : new FakeVec3(x, y ?? 0, z ?? 0);
    }

    on(event: string, callback: () => void, target: unknown): void {
        const listeners = this.listeners.get(event) ?? [];
        listeners.push({ callback, target });
        this.listeners.set(event, listeners);
    }

    off(event: string, callback: () => void, target: unknown): void {
        const listeners = this.listeners.get(event) ?? [];
        this.listeners.set(event, listeners.filter((entry) => entry.callback !== callback || entry.target !== target));
    }

    listenerCount(event: string): number {
        return this.listeners.get(event)?.length ?? 0;
    }

    destroy(): void {
        this.destroyCount += 1;
        this.isValid = false;
    }
}

class FakeComponent {
    node = null! as FakeNode;
}

class FakeButton extends FakeComponent {
    static readonly EventType = { CLICK: 'click' };
    interactable = true;
}

class FakeSprite extends FakeComponent {
    static readonly Type = { SIMPLE: 0, SLICED: 1 };
    spriteFrame: unknown = null;
    enabled = true;
    color = new FakeColor();
    type = FakeSprite.Type.SLICED;
}

class FakeLabel extends FakeComponent {
    string = '';
    color = new FakeColor(62, 43, 30, 255);
}

class FakeColor {
    static readonly WHITE = new FakeColor(255, 255, 255, 255);

    constructor(
        readonly r = 0,
        readonly g = 0,
        readonly b = 0,
        readonly a = 255,
    ) {}

    clone(): FakeColor {
        return new FakeColor(this.r, this.g, this.b, this.a);
    }

    equals(other: FakeColor): boolean {
        return this.r === other.r && this.g === other.g && this.b === other.b && this.a === other.a;
    }
}

interface StationLayers {
    readonly icon: FakeNode;
    readonly caption: FakeNode;
    readonly text: FakeNode;
    readonly badge: FakeNode;
    readonly hit: FakeNode;
}

interface StationView {
    node: FakeNode;
    button: FakeButton;
    iconSprite: FakeSprite;
    captionSprite: FakeSprite;
    captionLabel: FakeLabel;
    badgeLabel: FakeLabel;
    initialize(layers: StationLayers, onClick?: (site: unknown) => void): void;
    setMapPosition(x: number, y: number, z?: number): void;
    render(content: {
        readonly site: unknown;
        readonly icon: unknown;
        readonly isCondition?: boolean;
        readonly conditionIcon?: unknown;
        readonly conditionTextColor?: FakeColor;
        readonly caption: string;
        readonly tint: FakeColor;
        readonly badge: string;
        readonly interactive: boolean;
        readonly isLoading?: boolean;
    }): void;
    update(deltaTime: number): void;
    dispose(): void;
    onDestroy(): void;
}

function loadStationView(): new () => StationView {
    const source = readFileSync('assets/script/app/territory/view/TerritoryStationView.ts', 'utf8');
    const code = ts.transpileModule(source, {
        compilerOptions: {
            experimentalDecorators: true,
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
        },
    }).outputText;
    const context: Record<string, unknown> = {
        exports: {},
        module: { exports: {} },
        require: (id: string) => {
            if (id !== 'cc') throw new Error(`Unexpected require: ${id}`);
            return {
                _decorator: {
                    ccclass: () => (value: unknown) => value,
                    property: () => () => undefined,
                },
                Button: FakeButton,
                Color: FakeColor,
                Component: FakeComponent,
                Label: FakeLabel,
                Node: FakeNode,
                Sprite: FakeSprite,
                SpriteFrame: class {},
                UITransform: class {},
                Vec3: FakeVec3,
            };
        },
    };
    context.module = { exports: context.exports };
    runInNewContext(code, context);
    return (context.exports as { TerritoryStationView: new () => StationView }).TerritoryStationView;
}

function attach(child: FakeNode, parent: FakeNode, x: number, y: number): FakeNode {
    child.setParent(parent);
    child.setPosition(x, y, 0);
    return child;
}

test('station visuals move into contiguous global render layers and preserve prefab offsets', () => {
    const View = loadStationView();
    const view = new View();
    const root = new FakeNode('TerritoryStation');
    const icon = attach(new FakeNode('Icon'), root, 0, 0);
    const caption = attach(new FakeNode('CaptionBg'), root, 0, 52);
    const text = attach(new FakeNode('CaptionLabel'), root, 0, 52);
    const badge = attach(new FakeNode('BadgeLabel'), root, 35, 35);
    const button = new FakeButton();
    button.node = root;
    const iconSprite = new FakeSprite();
    iconSprite.node = icon;
    const captionSprite = new FakeSprite();
    captionSprite.node = caption;
    const captionFrame = { name: 'caption background' };
    captionSprite.spriteFrame = captionFrame;
    const captionLabel = new FakeLabel();
    captionLabel.node = text;
    const badgeLabel = new FakeLabel();
    badgeLabel.node = badge;
    Object.assign(view, { node: root, button, iconSprite, captionSprite, captionLabel, badgeLabel });

    const layers: StationLayers = {
        icon: new FakeNode('StationIconLayer'),
        caption: new FakeNode('StationCaptionLayer'),
        text: new FakeNode('StationTextLayer'),
        badge: new FakeNode('StationBadgeLayer'),
        hit: new FakeNode('StationHitLayer'),
    };
    view.initialize(layers);
    view.initialize(layers);
    view.setMapPosition(100, 200, 0);
    const tint = new FakeColor(20, 40, 60, 255);
    view.render({ site: {}, icon: {}, caption: '关卡 1', tint, badge: '锁', interactive: false });

    assert.equal(root.parent, layers.hit);
    assert.equal(icon.parent, layers.icon);
    assert.equal(caption.parent, layers.caption);
    assert.equal(text.parent, layers.text);
    assert.equal(badge.parent, layers.badge);
    assert.deepEqual([root.position.x, root.position.y], [100, 200]);
    assert.deepEqual([caption.position.x, caption.position.y], [100, 252]);
    assert.deepEqual([badge.position.x, badge.position.y], [135, 235]);
    assert.equal(root.listenerCount(FakeButton.EventType.CLICK), 1, 'initialize must be idempotent');
    assert.equal(captionSprite.color, tint);
    assert.equal(captionLabel.string, '关卡 1');
    assert.equal(caption.active, false, 'building art hides its name background');
    assert.equal(text.active, false, 'building art hides its name');
    assert.equal(badge.active, false, 'building art hides its badge');
    assert.equal(button.interactable, false);
    const silverIcon = { name: 'silver' };
    const red = new FakeColor(230, 30, 24, 255);
    view.render({ site: null, icon: null, isCondition: true, conditionIcon: silverIcon,
        conditionTextColor: red, caption: '399', tint, badge: '', interactive: false });
    assert.equal(iconSprite.enabled, false);
    assert.equal(captionSprite.spriteFrame, silverIcon);
    assert.equal(captionSprite.type, FakeSprite.Type.SIMPLE);
    assert.equal(caption.active, true, 'locked condition restores the cost icon');
    assert.equal(text.active, true, 'locked condition restores the cost value');
    assert.deepEqual([caption.position.x, caption.position.y], [76, 200]);
    assert.deepEqual([text.position.x, text.position.y], [122, 200]);
    assert.equal(captionLabel.color, red);
    view.render({ site: null, icon: null, isCondition: true, conditionIcon: silverIcon,
        caption: '', tint, badge: '', interactive: false, isLoading: true });
    assert.equal(caption.active, false, 'pending cell hides the cost icon');
    assert.equal(text.active, false, 'pending cell hides the cost text');
    assert.equal(button.interactable, false);
    view.render({ site: {}, icon: {}, caption: '资源点', tint, badge: '可领取', interactive: true });
    assert.equal(caption.active, false, 'opening a condition cell hides the cost icon under building art');
    assert.equal(text.active, false, 'opening a condition cell hides the cost value under building art');
    assert.equal(badge.active, false, 'opening a condition cell hides the badge under building art');
    view.render({ site: {}, icon: null, caption: '待配置', tint, badge: '', interactive: true });
    assert.equal(captionSprite.spriteFrame, captionFrame, 'reused caption must regain its normal frame');
    assert.equal(captionSprite.type, FakeSprite.Type.SLICED);
    assert.equal(caption.active, true, 'missing art retains the text fallback');
    assert.equal(text.active, true, 'missing art retains the text fallback');
    assert.deepEqual([caption.position.x, caption.position.y], [100, 252]);
    assert.deepEqual([text.position.x, text.position.y], [100, 252]);
    assert.ok(captionLabel.color.equals(new FakeColor(62, 43, 30, 255)));
    assert.equal(iconSprite.enabled, false);
    assert.equal(badgeLabel.node.active, false);

    view.dispose();
    view.dispose();
    assert.equal(root.listenerCount(FakeButton.EventType.CLICK), 0);
    for (const node of [icon, caption, text, badge]) assert.equal(node.destroyCount, 1);
    assert.equal(root.destroyCount, 0, 'owner destroys the station hit root');
});

/**
 * 回归：切 tab 销毁页面时，站点节点上的 `cc.Button` 排在 `TerritoryStationView` **之前**
 * 被引擎 `_destruct()`（prefab `_components` 数组序：UITransform → Sprite → cc.Button → 本脚本），
 * 于是 `Button.node` 已被置 `null`。此时 `onDestroy` 里若再 `button.node.off(...)` 就会抛
 * `Cannot read properties of null (reading 'off')`，异常打断组件销毁循环还会连带刷
 * 「destroy an object twice or more」。这里按引擎的销毁序复现并断言不抛。
 */
test('station survives the engine destroy order where cc.Button is destructed before the view', () => {
    const View = loadStationView();
    const view = new View();
    const root = new FakeNode('TerritoryStation');
    const icon = attach(new FakeNode('Icon'), root, 0, 0);
    const caption = attach(new FakeNode('CaptionBg'), root, 0, 52);
    const text = attach(new FakeNode('CaptionLabel'), root, 0, 52);
    const badge = attach(new FakeNode('BadgeLabel'), root, 35, 35);
    const button = new FakeButton();
    button.node = root;
    const iconSprite = new FakeSprite();
    iconSprite.node = icon;
    const captionSprite = new FakeSprite();
    captionSprite.node = caption;
    const captionLabel = new FakeLabel();
    captionLabel.node = text;
    const badgeLabel = new FakeLabel();
    badgeLabel.node = badge;
    Object.assign(view, { node: root, button, iconSprite, captionSprite, captionLabel, badgeLabel });

    const layers: StationLayers = {
        icon: new FakeNode('StationIconLayer'),
        caption: new FakeNode('StationCaptionLayer'),
        text: new FakeNode('StationTextLayer'),
        badge: new FakeNode('StationBadgeLayer'),
        hit: new FakeNode('StationHitLayer'),
    };
    view.initialize(layers, () => undefined);
    assert.equal(root.listenerCount(FakeButton.EventType.CLICK), 1);

    // 引擎销毁序：先跑 cc.Button 的 _destruct()，Component.node 被重置为 null。
    button.node = null;

    assert.doesNotThrow(() => view.onDestroy());
    for (const node of [icon, caption, text, badge]) {
        assert.equal(node.destroyCount, 0, 'shared-layer visuals are destroyed with the page, not by the station');
    }
});
