import { createControllerContext } from './helpers/controller-context';
import { scopeAssetService } from '../assets/script/core/asset/AssetService';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as PopupDef from '../assets/script/framework/ui/PopupDef';
import { PopupCompositionHost } from '../assets/script/framework/ui/PopupCompositionHost';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';

function loadModule(path: string, dependencies: Record<string, unknown>): any {
    const context = {
        exports: {} as any,
        console,
        require: (name: string) => {
            if (name.endsWith('/PopupCompositionHost')) return { PopupCompositionHost };
            if (name.endsWith('/ResourceScope')) return { ResourceScope };
            if (name.endsWith('/AssetService')) return { scopeAssetService };
            // 统一过渡（`UIMotionPlayer`）在本文件里不参与断言：桩成「播不上」，
            // 让关闭链路走同步销毁 / 回收，与加入过渡之前的行为逐条对齐。
            // 过渡本身的逐帧行为由 `tests/ui-motion.test.ts` 用假 `cc` 单独验证。
            if (name.endsWith('/UIMotionPlayer')) {
                return { UIMotionPlayer: { playEnter: () => false, playExit: () => false, stop: () => {} } };
            }
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
        _internalReleaseResources(): void {}
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

test('PopupManager 支持 params.scope 取消在途打开、关闭已开弹窗并在正常关闭后解绑', async () => {
    class Prefab {
        constructor(readonly factory: () => Node) {}
    }
    class Canvas {}
    class UITransform {
        setContentSize(): void {}
    }
    class Node {
        isValid = true;
        active = true;
        activeInHierarchy = true;
        layer = 1;
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
            this.parent?.removeChild(this);
            this.parent = parent;
            parent.children.push(this);
        }

        removeChild(child: Node): void {
            const index = this.children.indexOf(child);
            if (index >= 0) this.children.splice(index, 1);
            child.parent = null;
        }

        removeFromParent(): void {
            this.parent?.removeChild(this);
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
    const { PopupManager } = loadModule('assets/script/framework/ui/PopupManager.ts', {
        cc,
        './PopupDef': PopupDef,
        '../../core/asset/ResourceScope': { ResourceScope },
    });

    const closeReasons: number[] = [];
    const createdNodes: Node[] = [];
    let nextId = 0;
    let resolvePendingLoad!: (prefab: Prefab) => void;
    let loadCount = 0;
    let gatePendingOpen = false;
    let resolvePendingOpen!: () => void;

    class ScopedPopup {
        static prefabPath = 'ui/test/ScopedPopup';
        popupLayer = PopupDef.PopupLayer.NORMAL;
        node!: Node;
        className = 'ScopedPopup';

        _internalOpen(): Promise<void> {
            if (!gatePendingOpen) return Promise.resolve();
            return new Promise<void>((resolve) => {
                resolvePendingOpen = resolve;
            });
        }
        _bindCallbackOwners(): void {}
        _internalClose(reason: number): void {
            closeReasons.push(reason);
            resolvePendingOpen?.();
        }
        _internalReleaseResources(): void {}
        _internalDepthChanged(): void {}
        _internalCover(): void {}
        _internalReveal(): void {}
    }

    const makePrefab = () => new Prefab(() => {
        nextId += 1;
        const node = new Node(`scoped-${nextId}`);
        node.attach(new ScopedPopup());
        createdNodes.push(node);
        return node;
    });

    const manager = new PopupManager();
    manager.node = new Node('Popup');
    manager.node.layer = 1;
    manager.initialize({
        load: async () => {
            loadCount += 1;
            if (loadCount === 1) {
                return new Promise<Prefab>((resolve) => {
                    resolvePendingLoad = resolve;
                });
            }
            return makePrefab();
        },
    });

    // 1) 已释放 scope 直接返回 null，不发起资源加载
    const disposedScope = new ResourceScope('already-disposed');
    disposedScope.dispose();
    assert.equal(await manager.openAsync(ScopedPopup, { scope: disposedScope }), null);
    assert.equal(loadCount, 0);

    // 2) prefab 加载途中释放 scope：立即清理在途去重槽，新 scope 可立刻重开，迟到节点自毁并返回 null
    const runtimeScope = new ResourceScope('runtime');
    const cancelledDuringLoad = manager.openAsync(ScopedPopup, { scope: runtimeScope });
    runtimeScope.dispose();

    const settlementScope = new ResourceScope('settlement');
    const reopened = await manager.openAsync(ScopedPopup, { scope: settlementScope });
    assert.ok(reopened, '旧 scope 取消后新 scope 可立即重新打开同名弹窗');
    assert.equal(loadCount, 2);

    resolvePendingLoad(makePrefab());
    assert.equal(await cancelledDuringLoad, null, '迟到 prefab 不得挂载，返回 null');
    assert.equal(createdNodes.length, 2);
    assert.equal(createdNodes[1].isValid, false, '迟到实例化的节点应立即销毁');
    assert.equal(reopened!.node.isValid, true, '新作用域打开的弹窗节点保持有效');
    assert.equal(manager.get(ScopedPopup), reopened, '新弹窗不受迟到取消影响');

    // 3) 正常手动关闭后，再释放原 scope 不误伤后续同弹窗
    manager.close(reopened!, PopupDef.PopupCloseReason.Manual);
    const unscoped = await manager.openAsync(ScopedPopup);
    settlementScope.dispose();
    assert.equal(manager.get(ScopedPopup), unscoped, '手动关闭应已从原 scope 解绑');
    manager.close(unscoped!, PopupDef.PopupCloseReason.Manual);

    // 4) 已打开弹窗随 scope.dispose 强制关闭
    const openScope = new ResourceScope('mounted');
    const mounted = await manager.openAsync(ScopedPopup, { scope: openScope });
    assert.ok(mounted);
    closeReasons.length = 0;
    openScope.dispose();
    assert.deepEqual(closeReasons, [PopupDef.PopupCloseReason.Force]);
    assert.equal(manager.get(ScopedPopup), null);

    // 5) onOpen 等待途中释放 scope 立即 Force 关闭并返回 null
    gatePendingOpen = true;
    const onOpenScope = new ResourceScope('during-onOpen');
    const openingDuringOnOpen = manager.openAsync(ScopedPopup, { scope: onOpenScope });
    await flushMicrotasks();
    assert.ok(manager.get(ScopedPopup));
    closeReasons.length = 0;
    onOpenScope.dispose();
    assert.deepEqual(closeReasons, [PopupDef.PopupCloseReason.Force]);
    assert.equal(await openingDuringOnOpen, null);
    assert.equal(manager.get(ScopedPopup), null);

    manager.onDestroy();
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
    let sessions = 0;
    let disposed = 0;
    let pending = false;
    let fail = false;
    const ownerCleanups = new Map<object, () => void>();
    const owners = {
        addCallerCleanup(owner: object, cleanup: () => void) { ownerCleanups.set(owner, cleanup); return () => { ownerCleanups.delete(owner); }; },
        removeCallerListener(owner: object) { ownerCleanups.get(owner)?.(); ownerCleanups.delete(owner); },
    };
    class CachedPopup {
        static prefabPath = 'ui/test/CachedPopup';
        popupLayer = PopupDef.PopupLayer.NORMAL;
        node!: Node;
        className = 'CachedPopup';
        _bindCallbackOwners(): void {}
        _internalOpen(): Promise<void> { return Promise.resolve(); }
        _internalClose(): void { assert.equal(disposed, sessions, '外部会话先于 View 关闭释放'); }
        _internalReleaseResources(): void {}
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
    }, owners, () => {
        sessions++;
        return { open: () => fail ? Promise.reject(new Error('open failed')) : pending ? new Promise<void>(() => {}) : Promise.resolve(), dispose: () => { disposed++; } };
    });

    const first = await manager.openAsync(CachedPopup, { cache: true });
    assert.ok(first);
    const cachedNode = first!.node;
    assert.equal(sessions, 1);
    manager.close(first!);
    assert.equal(disposed, 1);
    assert.equal(ownerCleanups.size, 0);
    assert.equal(cachedNode.isValid, true, '关闭时节点进入缓存');
    assert.equal(releases, 0, '节点仍可能引用 prefab 资源，关闭时不释放');

    const second = await manager.openAsync(CachedPopup, { cache: true });
    assert.ok(second);
    assert.equal(second!.node, cachedNode, '再次打开复用缓存节点');
    assert.equal(loads, 1, '复用缓存时不重复加载 prefab');
    assert.equal(sessions, 2);
    manager.close(second!);
    pending = true;
    const opening = manager.openAsync(CachedPopup, { cache: true });
    await flushMicrotasks();
    const third = manager.get(CachedPopup);
    assert.ok(third);
    manager.close(third);
    assert.equal(await opening, null, '关闭立即取消未完成的组合首屏');
    const rawOpening = manager.openAsync(CachedPopup, { cache: true });
    await flushMicrotasks();
    const raw = manager.get(CachedPopup);
    owners.removeCallerListener(raw);
    assert.equal(await rawOpening, null, '直接销毁宿主也取消组合会话');
    assert.equal(disposed, 4);
    manager.close(raw);
    fail = true;
    assert.equal(await manager.openAsync(CachedPopup, { cache: true }), null, '组合失败不得留在弹窗栈');
    assert.equal(manager.get(CachedPopup), null);
    assert.equal(disposed, 5);
    fail = false;
    const destroyedOpening = manager.openAsync(CachedPopup, { cache: true });
    await flushMicrotasks();
    manager.onDestroy();
    assert.equal(await destroyedOpening, null, '管理器销毁取消组合等待');
    assert.equal(disposed, 6);
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
    // 无过渡的弹窗（Toast 一类）关闭即释放：这条锁的是原有语义，不走延迟释放那条路。
    h.popup.motionEnabled = false;
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

test('有离场过渡的弹窗关闭时不放资源，交还节点时才放（淡出帧不能画已销毁的帧）', async () => {
    const h = popupResourceFixture();
    let releases = 0;
    h.context.assets.load = async (_path, Type, options) => {
        options?.scope?.defer(() => releases++);
        return new Type();
    };
    await h.popup._internalOpen(1, {}, PopupDef.PopupLayer.NORMAL);
    const scope = h.popup.ownedScope;
    await h.popup.ownedAssets.load('preview', class {});

    h.popup._internalClose(PopupDef.PopupCloseReason.Manual);
    assert.equal(releases, 0,
        '关闭就 decRef ⇒ 离场过渡那 0.16s 每帧提交已销毁的 SpriteFrame（frame should not be invalid）');
    assert.equal(scope.disposed, false);

    h.popup._internalReleaseResources();
    assert.equal(releases, 1, '节点交还时必须把这次打开的动态资源还回去');
    assert.equal(scope.disposed, true);
    h.popup.onDestroy();
});

test('PopupBase 旧打开的迟到资源被释放并拒绝，不占用重开后的作用域', async () => {
    const h = popupResourceFixture();
    h.popup.motionEnabled = false;
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

test('PopupBase 架构级生命周期：支持 onViewReady 并在首帧渲染就绪后自动调用', async () => {
    const frameListeners = new Set<() => void>();
    const director = {
        once: (_event: string, callback: () => void) => { frameListeners.add(callback); },
        off: (_event: string, callback: () => void) => { frameListeners.delete(callback); },
    };
    class Vector { x = 0; y = 0; z = 0; set() { return this; } }
    class DummyNode {
        static EventType = {
            TOUCH_START: 'touch-start',
            TOUCH_MOVE: 'touch-move',
            TOUCH_END: 'touch-end',
            TOUCH_CANCEL: 'touch-cancel',
        };
        isValid = true;
        children: DummyNode[] = [];
        addComponent<T>(cls: new () => T): T { return new cls(); }
        getComponent() { return null; }
        getChildByName() { return null; }
        insertChild() {}
        setPosition() {}
        on() {}
        off() {}
        destroy() { this.isValid = false; }
    }
    class DummyComponent { node = new DummyNode(); isValid = true; }
    const cc = {
        _decorator: { ccclass: classDecorator, property: propertyDecorator },
        Button: class {},
        Component: DummyComponent,
        director,
        Director: { EVENT_AFTER_UPDATE: 'after-update' },
        EditBox: class {},
        EventTouch: class {},
        Mask: class {},
        Node: DummyNode,
        PageView: class {},
        ScrollView: class {},
        Sprite: class {},
        UITransform: class { width = 100; height = 100; setContentSize() {} },
        Vec2: Vector,
        Vec3: Vector,
        view: { getVisibleSize: () => ({ width: 720, height: 1280 }) },
    };
    const { PopupBase } = loadModule(
        'assets/script/framework/ui/PopupBase.ts',
        { cc, './PopupDef': PopupDef, './PopupManager': { PopupManager: { inst: null } } },
    );

    const steps: string[] = [];
    class ReadyPopup extends PopupBase {
        closeOnBlank = false;
        get readyFlag(): boolean { return this.isViewReady; }
        protected async onOpen(userData: any): Promise<void> {
            steps.push(`onOpen:${userData}`);
            assert.equal(this.readyFlag, false, 'onOpen 尚未跨过首帧时 isViewReady 为 false');
        }
        protected async onViewReady(userData: any): Promise<void> {
            assert.equal(this.readyFlag, true, '进入 onViewReady 时 isViewReady 必须为 true');
            steps.push(`onViewReady:${userData}`);
        }
    }

    const popup = new ReadyPopup();
    assert.equal(popup.readyFlag, false);
    const opening = popup._internalOpen(10, { userData: 'hero' }, PopupDef.PopupLayer.NORMAL);
    await flushMicrotasks();
    assert.deepEqual(steps, ['onOpen:hero'], 'onOpen 先行执行');

    // 触发下一帧
    assert.equal(frameListeners.size, 1, '框架自动等待首帧以保证子组件完成 start');
    frameListeners.forEach(fn => fn());
    frameListeners.clear();
    await opening;
    assert.deepEqual(steps, ['onOpen:hero', 'onViewReady:hero'], '首帧就绪后框架自动调用 onViewReady');
    assert.equal(popup.readyFlag, true);
    popup._internalClose(PopupDef.PopupCloseReason.Manual);
    assert.equal(popup.readyFlag, false, '关闭后 isViewReady 复位为 false');

    // 若 onOpen 自身异步跨过了首帧，onViewReady 不再额外空等第二帧
    steps.length = 0;
    let releaseAsyncOpen!: () => void;
    class SlowOpenPopup extends PopupBase {
        closeOnBlank = false;
        protected async onOpen(): Promise<void> {
            steps.push('slow-open-start');
            await new Promise<void>(resolve => { releaseAsyncOpen = resolve; });
            steps.push('slow-open-end');
        }
        protected onViewReady(): void {
            steps.push('slow-ready');
        }
    }
    const slowPopup = new SlowOpenPopup();
    const slowOpening = slowPopup._internalOpen(12, {}, PopupDef.PopupLayer.NORMAL);
    await flushMicrotasks();
    assert.equal(frameListeners.size, 1, '首帧监听随 onOpen 并行注册');
    frameListeners.forEach(fn => fn());
    frameListeners.clear();
    await flushMicrotasks();
    assert.deepEqual(steps, ['slow-open-start'], 'onOpen 未完成前不提前触发 onViewReady');
    releaseAsyncOpen();
    await slowOpening;
    assert.equal(frameListeners.size, 0, '已跨过首帧后不再注册多余的等帧监听');
    assert.deepEqual(steps, ['slow-open-start', 'slow-open-end', 'slow-ready']);

    // 若在 onOpen 期间关闭，onViewReady 绝不被调用
    steps.length = 0;
    class CancelledPopup extends PopupBase {
        closeOnBlank = false;
        protected onOpen(): Promise<void> {
            steps.push('onOpen');
            return new Promise(() => {}); // 模拟耗时拉取
        }
        protected onViewReady(): void {
            steps.push('onViewReady');
        }
    }
    const cancelPopup = new CancelledPopup();
    const cancelOpening = cancelPopup._internalOpen(11, {}, PopupDef.PopupLayer.NORMAL);
    await flushMicrotasks();
    assert.deepEqual(steps, ['onOpen']);
    cancelPopup._internalClose(PopupDef.PopupCloseReason.Manual);
    await cancelOpening;
    assert.deepEqual(steps, ['onOpen'], '关闭后 onViewReady 绝不被触发');
});

test('PopupBase.nextPopupFrame 契约：关闭、取消、销毁或作用域释放后必定安全返回 false', async () => {
    const frameListeners = new Set<() => void>();
    const director = {
        once: (_event: string, callback: () => void) => { frameListeners.add(callback); },
        off: (_event: string, callback: () => void) => { frameListeners.delete(callback); },
    };
    class Vector { x = 0; y = 0; z = 0; set() { return this; } }
    class DummyNode {
        static EventType = { TOUCH_START: 'touch-start', TOUCH_MOVE: 'touch-move', TOUCH_END: 'touch-end', TOUCH_CANCEL: 'touch-cancel' };
        isValid = true;
        children: DummyNode[] = [];
        addComponent<T>(cls: new () => T): T { return new cls(); }
        getComponent() { return null; }
        getChildByName() { return null; }
        insertChild() {}
        setPosition() {}
        on() {}
        off() {}
        destroy() { this.isValid = false; }
    }
    class DummyComponent { node = new DummyNode(); isValid = true; }
    const cc = {
        _decorator: { ccclass: classDecorator, property: propertyDecorator },
        Button: class {},
        Component: DummyComponent,
        director,
        Director: { EVENT_AFTER_UPDATE: 'after-update' },
        EditBox: class {},
        EventTouch: class {},
        Mask: class {},
        Node: DummyNode,
        PageView: class {},
        ScrollView: class {},
        Sprite: class {},
        UITransform: class { width = 100; height = 100; setContentSize() {} },
        Vec2: Vector,
        Vec3: Vector,
        view: { getVisibleSize: () => ({ width: 720, height: 1280 }) },
    };
    const { PopupBase } = loadModule(
        'assets/script/framework/ui/PopupBase.ts',
        { cc, './PopupDef': PopupDef, './PopupManager': { PopupManager: { inst: null } } },
    );

    class TestPopup extends PopupBase {
        closeOnBlank = false;
        async waitFrame(): Promise<boolean> {
            return this.nextPopupFrame();
        }
    }

    const popup = new TestPopup();
    // 未 open 时直接调用
    assert.equal(await popup.waitFrame(), false, '未 open 时直接返回 false');

    // 正常 open
    const opening = popup._internalOpen(1, {}, PopupDef.PopupLayer.NORMAL);
    await flushMicrotasks();
    const waitTask = popup.waitFrame();
    assert.equal(frameListeners.size, 1);
    frameListeners.forEach(fn => fn());
    frameListeners.clear();
    const result = await waitTask;
    assert.equal(result, true, '正常情况下跨帧返回 true');
    await opening;

    // 等帧期间被关闭
    const waitTask2 = popup.waitFrame();
    assert.equal(frameListeners.size, 1);
    popup._internalClose(PopupDef.PopupCloseReason.Manual);
    const result2 = await waitTask2;
    assert.equal(result2, false, '等待帧期间关闭，立即返回 false');

    // 已销毁后再调
    popup.onDestroy();
    assert.equal(await popup.waitFrame(), false, '销毁后调用立即返回 false');
});
