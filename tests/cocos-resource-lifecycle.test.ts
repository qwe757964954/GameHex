import { componentControllerModule } from './helpers/controller-context';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import * as ArtPaths from '../assets/script/app/ArtPaths';
import { loadSpriteFrameCache } from './helpers/sprite-frame-cache';

function load(path: string, dependencies: Record<string, unknown>) {
    const context = { exports: {} as any, console, require: (name: string) => {
        if (name.endsWith('/ComponentController')) return componentControllerModule();
        assert.ok(name in dependencies, name); return dependencies[name];
    } };
    runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true,
    } }).outputText, context); return context.exports;
}
class Asset {
    refs = 0; isValid = true;
    addRef() { this.refs++; return this; }
    decRef() { this.refs--; if (this.refs === 0) this.isValid = false; return this; }
}

test('流程资源引用保留到延迟节点销毁和绘制结束，批量释放且取消后的迟到资源也释放', async () => {
    const frame = new Asset(), events: Array<() => void> = [];
    const { CocosAssetService } = load('assets/script/platform/cocos/CocosAssetService.ts', {
        cc: { Asset, resources: { load: (_path: string, _type: unknown, done: Function) => done(null, frame) },
            Director: { EVENT_AFTER_DRAW: 'after-draw' }, director: { once: (event: string, fn: () => void) => { assert.equal(event, 'after-draw'); events.push(fn); } } },
        '../../core/asset/BundleCatalog': { bundleForPath: () => undefined },
        '../hotupdate/CocosBundleRegistry': {},
    });
    const service = new CocosAssetService(), scope = new ResourceScope('battle');
    await service.load('sprite', Asset, { scope }); await service.load('sprite', Asset, { scope });
    scope.dispose(); scope.dispose();
    assert.equal(frame.refs, 2); assert.equal(frame.isValid, true); assert.equal(events.length, 1);
    let nodesDestroyed = false;
    const dec = frame.decRef.bind(frame); frame.decRef = () => { assert.equal(nodesDestroyed, true); return dec(); };
    nodesDestroyed = true; events.shift()!();
    assert.equal(frame.refs, 0); assert.equal(frame.isValid, false);
    frame.isValid = true;
    await service.load('late-sprite', Asset, { scope });
    assert.equal(frame.refs, 1); events.shift()!(); assert.equal(frame.refs, 0);
});

test('应用图标缓存持有 Cocos 引用，返回主界面复用有效帧，已失效缓存重新加载', async () => {
    let calls = 0; let frame = new Asset();
    const { loadArt } = load('assets/script/app/card/CardLineupIcons.ts', {
        cc: { SpriteFrame: Asset, resources: { load: (_path: string, _type: unknown, done: Function) => { calls++; done(null, frame); } } },
        '../ArtPaths': ArtPaths, '../HeadArt': { HeadArt: {} },
        '../common/RoutedResource': { routedLoad: (_path: string, _type: unknown, done: Function) => { calls++; done(null, frame); } },
        '../common/SpriteFrameCache': loadSpriteFrameCache((_path: string, _type: unknown, done: Function) => { calls++; done(null, frame); }),
    });
    assert.equal(await loadArt('nav_shop', 'image/main/city'), frame); assert.equal(frame.refs, 1);
    frame.addRef(); frame.decRef();
    assert.equal(await loadArt('nav_shop', 'image/main/city'), frame); assert.equal(calls, 1);
    frame.isValid = false; const replacement = new Asset(); frame = replacement;
    assert.equal(await loadArt('nav_shop', 'image/main/city'), replacement); assert.equal(calls, 2);
    assert.equal(replacement.refs, 1);
});

test('战斗流程先关闭视图再销毁组件和释放作用域，不等待 Cocos onDestroy', () => {
    const order: string[] = []; let destroyed = false; let initializedEntry: any = null;
    const game = { initialize(entry: unknown) { initializedEntry = entry; }, shutdown: () => order.push('view shutdown'), destroy: () => { destroyed = true; order.push('component queued'); } };
    const scope = new ResourceScope('battle'); scope.defer(() => order.push('scope released'));
    class Base {
        host = { addComponent: () => game };
        releaseResourceScope() { scope.dispose(); } log() {} error() {}
    }
    // `ProcedureGame.current` 要经 `ProcedureManager.instance.currentProcedure` 找当前流程 ⇒ 夹具给个可写的假实例。
    const manager = { instance: null as { currentProcedure: unknown } | null };
    const { ProcedureGame } = load('assets/script/app/procedure/ProcedureGame.ts', {
        '../../framework/procedure/ProcedureManager': { ProcedureManager: manager },
        '../../framework/procedure/ProcedureBase': { ProcedureBase: Base },
        // `ProcedureGame.onEnter` 把组装好的 entry 交给对局组件实例。
        '../zcds/ZCGame': { ZCGame: class ZCGame { initialize() {} } },
        '../zcds/application/ZCGameLoader': {},
        '../zcds/application/ZCClientCombatConfig': { buildZCClientCombatConfig: (config: unknown) => ({ config, skipped: [] }) },
        '../zcds/application/ZCPveCombatConfig': { buildZCPveEnemyDecks: () => ({}) },
        '../zcds/model/ZCMatchConfig': { captureZCMatchConfig: (config: unknown) => config ?? { map: {}, enemyDeck: [] } },
        '../zcds/model/ZCRankBoard': { buildSeatProfiles: () => new Map() },
        '../territory/model/TerritorySaveStore': { TerritorySaveStore: { resolveBattle() {} } },
        '../territory/application/TerritorySaveStoreAdapter': { createTerritorySaveStore: () => ({ resolveBattle() {} }) },
    });
    const prepared = { baseMatchConfig: { map: {}, enemyDeck: [] } };
    const procedure = new ProcedureGame(); procedure.preparedResources = prepared; procedure.onEnter();
    assert.equal(initializedEntry.resources, prepared);
    assert.equal(initializedEntry.battleSeed, null);
    assert.ok(initializedEntry.matchConfig);
    procedure.onLeave();
    assert.equal(destroyed, true); assert.deepEqual(order, ['view shutdown', 'component queued', 'scope released']);
});

test('流程管理器能拿到对局控制器（只读出口）；不在对局流程 / 已离场时为 null', () => {
    class Base {
        host = { addComponent: () => ({ initialize() {}, shutdown() {}, destroy() {} }) };
        releaseResourceScope() {} log() {} error() {}
    }
    const manager = { instance: null as { currentProcedure: unknown } | null };
    const { ProcedureGame } = load('assets/script/app/procedure/ProcedureGame.ts', {
        '../../framework/procedure/ProcedureManager': { ProcedureManager: manager },
        '../../framework/procedure/ProcedureBase': { ProcedureBase: Base },
        '../zcds/ZCGame': { ZCGame: class ZCGame { initialize() {} } },
        '../zcds/application/ZCGameLoader': {},
        '../zcds/application/ZCClientCombatConfig': { buildZCClientCombatConfig: (config: unknown) => ({ config, skipped: [] }) },
        '../zcds/application/ZCPveCombatConfig': { buildZCPveEnemyDecks: () => ({}) },
        '../zcds/model/ZCMatchConfig': { captureZCMatchConfig: (config: unknown) => config ?? { map: {}, enemyDeck: [] } },
        '../zcds/model/ZCRankBoard': { buildSeatProfiles: () => new Map() },
        '../territory/application/TerritorySaveStoreAdapter': { createTerritorySaveStore: () => ({ resolveBattle() {} }) },
    });

    assert.equal(ProcedureGame.current, null, '还没进对局流程时必须是 null（别让调用方以为总能拿到）');
    const procedure = new ProcedureGame();
    procedure.preparedResources = { baseMatchConfig: { map: {}, enemyDeck: [] } };
    procedure.onEnter();
    manager.instance = { currentProcedure: procedure };
    assert.ok(ProcedureGame.current, '★对局流程中必须拿得到控制器（跨模块只读 model 的入口）');
    assert.equal(ProcedureGame.current, (procedure as unknown as { game: unknown }).game);
    // 别的流程实现不能被误当成对局流程（`instanceof` 收窄的意义）
    manager.instance = { currentProcedure: {} };
    assert.equal(ProcedureGame.current, null);
    // 离场后 `game` 已置空 ⇒ 迟到的调用方拿不到东西，不会摸到已销毁的控制器
    manager.instance = { currentProcedure: procedure };
    procedure.onLeave();
    assert.equal(ProcedureGame.current, null);
});


test('公共预下载用标准下载节奏保留低优先级，不继承每帧2项节流；取消不派发', async () => {
    const requests: unknown[] = [];
    const presets: unknown[] = [];
    const { CocosAssetService } = load('assets/script/platform/cocos/CocosAssetService.ts', {
        cc: { resources: { name: 'resources', load() { throw new Error('不能解析'); } },
            assetManager: { preloadAny: (request: unknown, optionsOrDone: { preset: string } | Function, done?: Function) => {
                requests.push(request); presets.push(typeof optionsOrDone === 'function' ? undefined : optionsOrDone.preset);
                (typeof optionsOrDone === 'function' ? optionsOrDone : done!)(null, []);
            } } },
        '../../core/asset/BundleCatalog': { bundleForPath: () => undefined },
        '../hotupdate/CocosBundleRegistry': {},
    });
    const service = new CocosAssetService();
    const scope = new ResourceScope('warm');
    await service.preload('ui/game/ZCGameHUD', { scope });
    assert.deepEqual(JSON.parse(JSON.stringify(requests)), [{ path: 'ui/game/ZCGameHUD', bundle: 'resources', priority: -1 }]);
    assert.deepEqual(presets, ['default'], '只绕过 preload 预设的共享队列低速限制，依然不解析');
    scope.dispose();
    await service.preload('late', { scope });
    assert.equal(requests.length, 1);
});


test('Cocos 适配器通过公开 loadAny 透传优先级和目录数组语义', async () => {
    const requests: object[] = [];
    const { CocosAssetService } = load('assets/script/platform/cocos/CocosAssetService.ts', {
        cc: { Asset, resources: { name: 'resources' }, assetManager: {
            loadAny: (request: { dir?: string }, optionsOrDone: Function | object, done?: Function) => {
                requests.push(request);
                if (request.dir) { assert.deepEqual(Object.keys(optionsOrDone), ['__outputAsArray__']); done!(null, []); }
                else (optionsOrDone as Function)(null, new Asset());
            },
            preloadAny: (request: object, _options: unknown, done: Function) => { requests.push(request); done(null); },
        } },
        '../../core/asset/BundleCatalog': { bundleForPath: () => undefined }, '../hotupdate/CocosBundleRegistry': {},
    });
    const service = new CocosAssetService();
    await service.load('shell', Asset, { priority: 100 });
    await service.loadDir('scene', Asset, { priority: 100 });
    await service.preload('idle', { priority: -10 });
    assert.deepEqual(requests.map((r: any) => r.priority), [100, 100, -10]);
    assert.deepEqual(requests.map((r: any) => r.bundle), ['resources', 'resources', 'resources']);
});
