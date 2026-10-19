/**
 * `TerritoryStationView` 的 **VM 夹具** —— 把真实源码转译进一个隔离的 `vm` 上下文，
 * `cc` 只打最小桩。
 *
 * 原来这套 Fake* / loader 就写在 `tests/territory-station-batching.test.ts` 里；
 * 2026-10-16 的 row14（建筑生成抖动 + 建筑展示滞后）需要在**另一个**用例文件里
 * 用同一套桩（抖动要断言 `Icon` 节点的缩放因子），才搬到 `helpers/` 里共用。
 *
 * ⚠️ `require` 是**白名单式**的：视图每多一个 import，这里就要补一条，
 * 否则整组用例会以「Unexpected require」一起红（看起来像产品代码问题）。
 * `core/hex/ShakePresentation` 那条特意转译**真模块**（它零依赖）——
 * 桩里抄一份数字的话，「120% 拉伸量」改错了两边一起绿。
 */
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

type Listener = { readonly callback: (...args: unknown[]) => void; readonly target: unknown };

export class FakeVec3 {
    constructor(public x = 0, public y = 0, public z = 0) {}

    clone(): FakeVec3 {
        return new FakeVec3(this.x, this.y, this.z);
    }
}

/**
 * `UITransform` 的最小模型：视图只读 `contentSize`。
 *
 *  `width` 可变是**故意的** —— 条件模式下 `CaptionLabel` 的 `overflow` 被切成 `NONE`，
 *  引擎会把**实测文本宽**写回 `contentSize`，用例就靠改这个值来模拟引擎量文本。
 */
export class FakeUITransform {
    constructor(public contentSize: { width: number; height: number }) {}
}

export class FakeNode {
    active = true;
    angle = 0;
    isValid = true;
    position = new FakeVec3();
    parent: FakeNode | null = null;
    destroyCount = 0;
    scale = new FakeVec3(1, 1, 1);
    /** 见 `FakeUITransform`；`withTransform` 挂上去，`makeStationView` 再注入到视图的 `@property` 字段。 */
    uiTransform: FakeUITransform | null = null;
    private readonly listeners = new Map<string, Listener[]>();

    constructor(readonly name: string) {}

    setParent(parent: FakeNode): void {
        this.parent = parent;
    }

    setPosition(x: number | FakeVec3, y?: number, z?: number): void {
        this.position = x instanceof FakeVec3 ? x.clone() : new FakeVec3(x, y ?? 0, z ?? 0);
    }

    setScale(x: number, y: number, z: number): void {
        this.scale = new FakeVec3(x, y, z);
    }

    getComponent(): unknown {
        return this.uiTransform;
    }

    on(event: string, callback: (...args: unknown[]) => void, target: unknown): void {
        const listeners = this.listeners.get(event) ?? [];
        listeners.push({ callback, target });
        this.listeners.set(event, listeners);
    }

    off(event: string, callback: (...args: unknown[]) => void, target: unknown): void {
        const listeners = this.listeners.get(event) ?? [];
        this.listeners.set(event, listeners.filter((entry) => entry.callback !== callback || entry.target !== target));
    }

    emit(event: string, ...args: unknown[]): void {
        for (const { callback } of this.listeners.get(event) ?? []) callback(...args);
    }

    listenerCount(event: string): number {
        return this.listeners.get(event)?.length ?? 0;
    }

    destroy(): void {
        this.destroyCount += 1;
        this.isValid = false;
    }
}

export class FakeComponent {
    node = null! as FakeNode;
}

export class FakeButton extends FakeComponent {
    static readonly EventType = { CLICK: 'click' };
    interactable = true;
}

export class FakeSprite extends FakeComponent {
    static readonly Type = { SIMPLE: 0, SLICED: 1 };
    spriteFrame: unknown = null;
    enabled = true;
    color = new FakeColor();
    type = FakeSprite.Type.SLICED;
}

export class FakeLabel extends FakeComponent {
    /** 与 `cc.Label.Overflow` 同值；初始值按 prefab 抄（`CaptionLabel` 是 `SHRINK`）。 */
    static readonly Overflow = { NONE: 0, CLAMP: 1, SHRINK: 2, RESIZE_HEIGHT: 3 };

    string = '';
    overflow = FakeLabel.Overflow.SHRINK;
    color = new FakeColor(62, 43, 30, 255);
}

export class FakeColor {
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

export interface StationLayers {
    readonly icon: FakeNode;
    readonly caption: FakeNode;
    readonly text: FakeNode;
    readonly badge: FakeNode;
    readonly hit: FakeNode;
}

export interface StationRenderContent {
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
    /** 需求 row14：建筑展示滞后期间整站不显示（见 `ITerritoryStationRender.hidden`）。 */
    readonly hidden?: boolean;
}

export interface StationView {
    node: FakeNode;
    button: FakeButton;
    iconSprite: FakeSprite;
    captionSprite: FakeSprite;
    captionLabel: FakeLabel;
    badgeLabel: FakeLabel;
    /** 面板绑定（prefab 序列化）的 `UITransform`——夹具注入对应节点的 `FakeUITransform`。 */
    iconTransform: FakeUITransform;
    captionIconTransform: FakeUITransform;
    captionTextTransform: FakeUITransform;
    initialize(layers: StationLayers, clickable?: boolean): void;
    setMapPosition(x: number, y: number, z?: number): void;
    render(content: StationRenderContent): void;
    /** 建筑生成抖动（需求 row14）：登记起点。 */
    playBuildingShake(): void;
    /** 建筑生成抖动：逐帧推进（引擎每帧调）。 */
    update(deltaTime: number): void;
    dispose(): void;
    onDestroy(): void;
}

/** `core/hex/ShakePresentation` 的真数值（零依赖，直接转译真源）。 */
let shakeCoreCache: Record<string, unknown> | null = null;

function loadShakeCore(): Record<string, unknown> {
    if (shakeCoreCache) return shakeCoreCache;
    const code = ts.transpileModule(readFileSync('assets/script/core/hex/ShakePresentation.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const context: Record<string, unknown> = {
        exports: {},
        module: { exports: {} },
        require: (id: string) => {
            throw new Error(`ShakePresentation 必须保持零依赖，但 require 了 ${id}`);
        },
    };
    context.module = { exports: context.exports };
    runInNewContext(code, context);
    shakeCoreCache = context.exports as Record<string, unknown>;
    return shakeCoreCache;
}

export function loadTerritoryStationView(): new () => StationView {
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
            if (id === 'cc') {
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
            }
            // 曲线真源：转译真模块（不是抄数字）。
            if (id.endsWith('/ShakePresentation')) return loadShakeCore();
            // 事件契约：纯常量表，直接给桩（与 `view/TerritoryEvents.ts` 同值）。
            if (id === './TerritoryEvents') {
                return {
                    TERRITORY_EVENTS: {
                        STATION_CLICK: 'territory:station-click',
                        PREVIOUS_CHAPTER: 'territory:previous-chapter',
                        NEXT_CHAPTER: 'territory:next-chapter',
                        DETAIL_CLOSE: 'territory:detail-close',
                        DETAIL_START: 'territory:detail-start',
                    },
                };
            }
            throw new Error(`Unexpected require: ${id}`);
        },
    };
    context.module = { exports: context.exports };
    runInNewContext(code, context);
    return (context.exports as { TerritoryStationView: new () => StationView }).TerritoryStationView;
}

export function attach(child: FakeNode, parent: FakeNode, x: number, y: number): FakeNode {
    child.setParent(parent);
    child.setPosition(x, y, 0);
    return child;
}

/** 给节点挂上 `UITransform`（尺寸按 `TerritoryStation.prefab` 抄）。 */
export function withTransform(node: FakeNode, width: number, height: number): FakeNode {
    node.uiTransform = new FakeUITransform({ width, height });
    return node;
}

/** 按 `TerritoryStation.prefab` 的角色接好一个站点视图（子节点尺寸 / 偏移全按 prefab 抄）。 */
export function makeStationView(): {
    view: StationView;
    root: FakeNode;
    icon: FakeNode;
    caption: FakeNode;
    text: FakeNode;
    badge: FakeNode;
    iconSprite: FakeSprite;
    captionSprite: FakeSprite;
    captionLabel: FakeLabel;
    badgeLabel: FakeLabel;
    layers: StationLayers;
} {
    const View = loadTerritoryStationView();
    const view = new View();
    const root = new FakeNode('TerritoryStation');
    const icon = withTransform(attach(new FakeNode('Icon'), root, 0, 0), 128, 128);
    const caption = withTransform(attach(new FakeNode('CaptionBg'), root, 0, 52), 40, 40);
    const text = withTransform(attach(new FakeNode('CaptionLabel'), root, 0, 52), 92, 28);
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
    // 三个 `UITransform` 是**面板绑定**的 `@property` ⇒ 夹具注入节点上同一个 `FakeUITransform` 对象
    // （station-batching 里改 `text.uiTransform.contentSize.width` 模拟引擎量文本，必须与视图读到的是同一引用）。
    Object.assign(view, {
        node: root, button, iconSprite, captionSprite, captionLabel, badgeLabel,
        iconTransform: icon.uiTransform,
        captionIconTransform: caption.uiTransform,
        captionTextTransform: text.uiTransform,
    });
    const layers: StationLayers = {
        icon: new FakeNode('StationIconLayer'),
        caption: new FakeNode('StationCaptionLayer'),
        text: new FakeNode('StationTextLayer'),
        badge: new FakeNode('StationBadgeLayer'),
        hit: new FakeNode('StationHitLayer'),
    };
    view.initialize(layers);
    return { view, root, icon, caption, text, badge, iconSprite, captionSprite, captionLabel, badgeLabel, layers };
}

/** 建筑图标按 128×128 画布铺满时的归一化基准缩放（`BUILDING_VISIBLE_WIDTH / 可见宽`）。 */
export const STATION_ICON_BASE_SCALE = 70 / 128;
