import { createControllerContext } from './helpers/controller-context';
import { scopeAssetService } from '../assets/script/core/asset/AssetService';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as PopupDef from '../assets/script/framework/ui/PopupDef';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';

function loadModule(path: string, dependencies: Record<string, unknown>): any {
    const context = {
        exports: {} as any,
        console,
        require: (name: string) => {
            if (name.endsWith('/ResourceScope')) return { ResourceScope };
            if (name.endsWith('/AssetService')) return { scopeAssetService };
            if (name.endsWith('/ProcedureManager')) return dependencies[name] ?? { ProcedureManager: { instance: null } };
            assert.ok(name in dependencies, `missing test dependency: ${name}`);
            return dependencies[name];
        },
    };
    const output = ts.transpileModule(readFileSync(path, 'utf8'), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            experimentalDecorators: true,
        },
    }).outputText;
    runInNewContext(output, context);
    return context.exports;
}

const classDecorator = () => (value: unknown) => value;
const propertyDecorator = () => () => {};

async function flushMicrotasks(): Promise<void> {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

test('PopupBase 在 onOpen 尚未完成时关闭，也会结束 open 并取消下一帧等待', async () => {
    class Vec2 {
        x = 0;
        y = 0;
        set(x: number, y: number): this { this.x = x; this.y = y; return this; }
    }
    class Vec3 extends Vec2 {
        z = 0;
        set(x: number, y: number, z = 0): this { super.set(x, y); this.z = z; return this; }
    }
    class Node {
        static EventType = {
            TOUCH_START: 'touch-start',
            TOUCH_MOVE: 'touch-move',
            TOUCH_END: 'touch-end',
            TOUCH_CANCEL: 'touch-cancel',
        };
        isValid = true;
        name: string;
        children: Node[] = [];
        parent: Node | null = null;
        layer = 1;
        activeInHierarchy = true;
        private components: any[] = [];
        constructor(name = '') { this.name = name; }
        on(): void {}
        off(): void {}
        destroy(): void { this.isValid = false; }
        // ↓ 「点击空白关闭」会在运行时补一个全屏接收层，用到这几个节点 API
        getChildByName(target: string): Node | null { return this.children.find((child) => child.name === target) ?? null; }
        insertChild(child: Node, index: number): void { child.parent = this; this.children.splice(index, 0, child); }
        addComponent<T>(cls: new () => T): T {
            const component = new cls();
            (component as any).node = this;
            this.components.push(component);
            return component;
        }
        getComponent<T>(cls: new (...args: any[]) => T): T | null {
            return this.components.find((component) => component instanceof cls) ?? null;
        }
        setPosition(): void {}
    }
    class Component {
        node = new Node();
    }
    class UITransform {
        width = 0;
        height = 0;
        setContentSize(width: number, height: number): void { this.width = width; this.height = height; }
    }

    const frameListeners = new Set<() => void>();
    const director = {
        once: (_event: string, callback: () => void) => { frameListeners.add(callback); },
        off: (_event: string, callback: () => void) => { frameListeners.delete(callback); },
    };
    const cc = {
        _decorator: { ccclass: classDecorator, property: propertyDecorator },
        Button: class {},
        Component,
        director,
        Director: { EVENT_AFTER_UPDATE: 'after-update' },
        EditBox: class {},
        EventTouch: class {},
        Mask: class {},
        Node,
        PageView: class {},
        ScrollView: class {},
        Sprite: class {},
        UITransform,
        Vec2,
        Vec3,
        view: { getVisibleSize: () => ({ width: 720, height: 1280 }) },
    };
    const { PopupBase, PopupOpenContext } = loadModule(
        'assets/script/framework/ui/PopupBase.ts',
        {
            cc,
            './PopupDef': PopupDef,
            './PopupManager': { PopupManager: { inst: null } },
        },
    );

    class HangingPopup extends PopupBase {
        protected onOpen(): Promise<void> {
            return new Promise(() => {});
        }
    }

    const popup = new HangingPopup();
    const released: object[] = [];
    assert.equal(typeof popup._bindCallbackOwners, 'function');
    popup._bindCallbackOwners({ removeCallerListener: (owner: object) => released.push(owner) });
    const opening = popup._internalOpen(7, {}, PopupDef.PopupLayer.NORMAL);
    await Promise.resolve();
    assert.equal(popup.lifecycleState, PopupDef.PopupLifecycleState.Opening);

    popup._internalClose(PopupDef.PopupCloseReason.Manual);
    await opening;
    assert.equal(popup.lifecycleState, PopupDef.PopupLifecycleState.Closed);
    assert.equal(popup.isPopupOpen, false);
    assert.deepEqual(released, [popup]);
    assert.equal(popup.node.isValid, true, '缓存关闭时节点仍有效，也必须解除回调');
    const reopening = popup._internalOpen(9, {}, PopupDef.PopupLayer.NORMAL);
    await Promise.resolve();
    popup._internalClose(PopupDef.PopupCloseReason.Manual);
    await reopening;
    assert.deepEqual(released, [popup, popup], '重开后关闭仍由同一生命周期入口解除');

    const context = new PopupOpenContext(8);
    const nextFrame = context.nextFrame();
    assert.equal(frameListeners.size, 1);
    context.cancel();
    assert.equal(await nextFrame, false);
    assert.equal(frameListeners.size, 0);
});

test('PopupManager 默认合并同类打开，打开中关闭后仍可重新打开', async () => {
    class Prefab {
        constructor(readonly factory: () => Node) {}
    }
    class Canvas {}
    class UITransform {
        contentSize = { width: 0, height: 0 };
        setContentSize(width: number, height: number): void { this.contentSize = { width, height }; }
    }
    class Node {
        isValid = true;
        active = true;
        activeInHierarchy = true;
        layer = 0;
        parent: Node | null = null;
        children: Node[] = [];
        private components: any[] = [];

        constructor(public name = '') {}

        attach(component: any): void {
            component.node = this;
            this.components.push(component);
        }

        getComponent<T>(cls: new (...args: any[]) => T): T | null {
            return this.components.find((component) => component instanceof cls) ?? null;
        }

        addComponent<T>(cls: new () => T): T {
            const component = new cls();
            this.attach(component);
            return component;
        }

        setParent(parent: Node): void {
            this.removeFromParent();
            this.parent = parent;
            parent.children.push(this);
        }

        removeFromParent(): void {
            if (!this.parent) return;
            const index = this.parent.children.indexOf(this);
            if (index >= 0) this.parent.children.splice(index, 1);
            this.parent = null;
        }

        setPosition(): void {}
        setSiblingIndex(): void {}

        destroy(): void {
            this.isValid = false;
            this.removeFromParent();
        }
    }
    class Component {
        node!: Node;
    }

    const prefabs = new Map<string, Prefab>();
    const loadedPaths: string[] = [];
    let releasedAssets = 0;
    const cc = {
        _decorator: { ccclass: classDecorator },
        Canvas,
        Component,
        director: { getScene: () => null },
        instantiate: (prefab: Prefab) => prefab.factory(),
        Layers: { Enum: { DEFAULT: 0, UI_2D: 1 } },
        Node,
        Prefab,
        UITransform,
    };
    const { PopupManager } = loadModule(
        'assets/script/framework/ui/PopupManager.ts',
        { cc, './PopupDef': PopupDef, '../../core/asset/ResourceScope': { ResourceScope } },
    );

    let created = 0;
    const callbackOwners = { removeCallerListener() {} };
    let boundOwners: unknown;
    class HangingPopup {
        static prefabPath = 'ui/test/HangingPopup';
        popupLayer = PopupDef.PopupLayer.NORMAL;
        node!: Node;
        className = 'HangingPopup';
        private finishOpen!: () => void;
        private readonly openGate = new Promise<void>((resolve) => { this.finishOpen = resolve; });

        _internalOpen(): Promise<void> { return this.openGate; }
        _bindCallbackOwners(owners: unknown): void { boundOwners = owners; }
        _internalClose(): void { this.finishOpen(); }
        _internalDepthChanged(): void {}
        _internalCover(): void {}
        _internalReveal(): void {}
    }
    prefabs.set(HangingPopup.prefabPath, new Prefab(() => {
        created += 1;
        const node = new Node(`popup-${created}`);
        node.attach(new HangingPopup());
        return node;
    }));

    const manager = new PopupManager();
    manager.node = new Node('Popup');
    manager.node.layer = 1;
    manager.initialize({
        load: async (path: string, _type: typeof Prefab, options?: { scope?: { defer(release: () => void): void } }) => {
            loadedPaths.push(path);
            options?.scope?.defer(() => { releasedAssets += 1; });
            return prefabs.get(path)!;
        },
    }, callbackOwners);

    const first = manager.openAsync(HangingPopup);
    const duplicated = manager.openAsync(HangingPopup);
    assert.equal(first, duplicated, '加载中的重复打开应返回同一个任务');
    await flushMicrotasks();
    const firstPopup = manager.get(HangingPopup);
    assert.ok(firstPopup);
    assert.equal(boundOwners, callbackOwners);
    assert.equal(created, 1);
    assert.equal(firstPopup!.node.name, 'HangingPopup', '打开后根节点应显示弹窗脚本组件名');

    manager.close(firstPopup!);
    assert.equal(await first, null, '打开期间关闭时，open 应结束并返回 null');

    const reopened = manager.openAsync(HangingPopup);
    await flushMicrotasks();
    const secondPopup = manager.get(HangingPopup);
    assert.ok(secondPopup);
    assert.notEqual(secondPopup, firstPopup);
    assert.equal(created, 2, '关闭后再次打开应创建新实例');
    manager.close(secondPopup!);
    assert.equal(await reopened, null);
    assert.deepEqual(loadedPaths, [HangingPopup.prefabPath, HangingPopup.prefabPath]);
    manager.onDestroy();
    assert.equal(releasedAssets, 2, '管理器销毁时释放其持有的 prefab 资源引用');
});

test('PopupManager 缓存实例时保留 prefab 资源到缓存节点销毁', async () => {
    class Prefab { constructor(readonly factory: () => Node) {} }
    class Node {
        isValid = true;
        active = true;
        activeInHierarchy = true;
        layer = 1;
        parent: Node | null = null;
        children: Node[] = [];
        private components: any[] = [];
        constructor(public name = '') {}
        attach(component: any): void { component.node = this; this.components.push(component); }
        getComponent<T>(cls: new (...args: any[]) => T): T | null { return this.components.find((item) => item instanceof cls) ?? null; }
        addComponent<T>(cls: new () => T): T { const component = new cls(); this.attach(component); return component; }
        setParent(parent: Node): void { this.parent?.removeChild(this); this.parent = parent; parent.children.push(this); }
        removeChild(child: Node): void { const index = this.children.indexOf(child); if (index >= 0) this.children.splice(index, 1); child.parent = null; }
        removeFromParent(): void { this.parent?.removeChild(this); }
        setPosition(): void {}
        setSiblingIndex(): void {}
        destroy(): void { this.isValid = false; this.removeFromParent(); }
    }
    class Component { node!: Node; }
    class Canvas {}
    class UITransform { setContentSize(): void {} }
    const cc = {
        _decorator: { ccclass: classDecorator }, Canvas, Component,
        director: { getScene: () => null },
        instantiate: (prefab: Prefab) => prefab.factory(),
        Layers: { Enum: { DEFAULT: 0, UI_2D: 1 } }, Node, Prefab, UITransform,
    };
    const { PopupManager } = loadModule('assets/script/framework/ui/PopupManager.ts', {
        cc,
        './PopupDef': PopupDef,
        '../../core/asset/ResourceScope': { ResourceScope },
    });
    let loads = 0;
    let releases = 0;
    let created = 0;
    class CachedPopup {
        static prefabPath = 'ui/test/CachedPopup';
        popupLayer = PopupDef.PopupLayer.NORMAL;
        node!: Node;
        className = 'CachedPopup';
        _internalOpen(): Promise<void> { return Promise.resolve(); }
        _internalClose(): void {}
        _internalDepthChanged(): void {}
        _internalCover(): void {}
        _internalReveal(): void {}
    }
    const prefab = new Prefab(() => {
        created += 1;
        const node = new Node(`cached-${created}`);
        node.attach(new CachedPopup());
        return node;
    });
    const manager = new PopupManager();
    manager.node = new Node('Popup');
    manager.node.layer = 1;
    manager.initialize({
        load: async (_path: string, _type: typeof Prefab, options?: { scope?: { defer(release: () => void): void } }) => {
            loads += 1;
            options?.scope?.defer(() => { releases += 1; });
            return prefab;
        },
    });

    const first = await manager.openAsync(CachedPopup, { cache: true });
    assert.ok(first);
    const cachedNode = first!.node;
    manager.close(first!);
    assert.equal(cachedNode.isValid, true, '关闭时节点进入缓存');
    assert.equal(releases, 0, '节点仍可能引用 prefab 资源，关闭时不释放');

    const second = await manager.openAsync(CachedPopup, { cache: true });
    assert.ok(second);
    assert.equal(second!.node, cachedNode, '再次打开复用缓存节点');
    assert.equal(loads, 1, '复用缓存时不重复加载 prefab');
    manager.onDestroy();
    assert.equal(cachedNode.isValid, false, '管理器销毁时销毁缓存节点');
    assert.equal(releases, 1, '缓存节点销毁后释放 prefab 资源');
});

test('PopupManager 仅在 allowMultiple=true 时允许同类多开', async () => {
    const source = readFileSync('assets/script/framework/ui/PopupManager.ts', 'utf8');
    const def = readFileSync('assets/script/framework/ui/PopupDef.ts', 'utf8');

    assert.match(source, /const unique = params\.allowMultiple !== true/);
    assert.match(source, /const pending = this\._openingByPath\.get\(path\)/);
    assert.match(source, /const opened = this\.get\(cls\)/);
    assert.match(def, /allowMultiple\?: boolean/);
});


function popupResourceFixture(context = createControllerContext()) {
    class Vector { x = 0; y = 0; z = 0; }
    const runtime = { instance: { context } as { context: typeof context } | null };
    const { PopupBase } = loadModule('assets/script/framework/ui/PopupBase.ts', {
        cc: {
            _decorator: { ccclass: classDecorator, property: propertyDecorator },
            Component: class { node = { isValid: true }; },
            Node: class {}, Vec2: Vector, Vec3: Vector,
        },
        './PopupDef': PopupDef,
        './PopupManager': { PopupManager: { inst: null } },
        '../procedure/ProcedureManager': { ProcedureManager: runtime },
    });
    class ResourcePopup extends PopupBase {
        closeOnBlank = false;
        get ownedAssets() { return this.assets; }
        get ownedScope(): ResourceScope { return this.resourceScope; }
        get ownedConfigs() { return this.configs; }
        get ownedSession() { return this.sessionAssets; }
    }
    return { popup: new ResourcePopup(), runtime, context };
}

test('PopupBase 资源服务按需解析，未用资源即销毁不要求运行时', () => {
    const h = popupResourceFixture();
    h.runtime.instance = null;
    assert.throws(() => h.popup.ownedAssets, /configured application context/);
    assert.doesNotThrow(() => h.popup.onDestroy());
});

test('PopupBase 管理动态资源，缓存关闭即释放，重开取得独立作用域', async () => {
    const h = popupResourceFixture();
    let releases = 0;
    h.context.assets.load = async (_path, Type, options) => {
        options?.scope?.defer(() => releases++);
        return new Type();
    };
    await h.popup._internalOpen(1, {}, PopupDef.PopupLayer.NORMAL);
    const oldScope = h.popup.ownedScope, oldAssets = h.popup.ownedAssets;
    assert.equal(h.popup.ownedConfigs, h.context.configs);
    assert.equal(h.popup.ownedSession, h.context.sessionAssets);
    await oldAssets.load('preview', class {});
    h.popup._internalClose(PopupDef.PopupCloseReason.Manual);
    assert.equal(releases, 1);
    assert.equal(oldScope.disposed, true);
    await assert.rejects(oldAssets.load('preview', class {}), /释放/);
    await h.popup._internalOpen(2, {}, PopupDef.PopupLayer.NORMAL);
    assert.notEqual(h.popup.ownedScope, oldScope);
    assert.equal(h.popup.ownedScope.disposed, false);
    await h.popup.ownedAssets.load('preview', class {});
    h.popup._internalClose(PopupDef.PopupCloseReason.Manual);
    h.popup.onDestroy();
    assert.equal(releases, 2);
});

test('PopupBase 旧打开的迟到资源被释放并拒绝，不占用重开后的作用域', async () => {
    const h = popupResourceFixture();
    let complete: () => void = () => {};
    let releases = 0;
    h.context.assets.load = async (_path, Type, options) => {
        await new Promise<void>(resolve => { complete = resolve; });
        options?.scope?.defer(() => releases++);
        return new Type();
    };
    await h.popup._internalOpen(1, {}, PopupDef.PopupLayer.NORMAL);
    const pending = h.popup.ownedAssets.load('preview', class {});
    h.popup._internalClose(PopupDef.PopupCloseReason.Manual);
    await h.popup._internalOpen(2, {}, PopupDef.PopupLayer.NORMAL);
    const newScope = h.popup.ownedScope;
    complete();
    await assert.rejects(pending, /释放/);
    assert.equal(releases, 1);
    assert.equal(newScope.disposed, false);
    h.popup.onDestroy();
    assert.equal(newScope.disposed, true);
});
