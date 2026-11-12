import { ScopedAssetCache } from '../assets/script/core/asset/ScopedAssetCache';
import * as resourcePlan from '../assets/script/app/zcds/model/ZCGameResourcePlan';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { ControllerBase } from '../assets/script/framework/controller/ControllerBase';
import { PostLoginController } from '../assets/script/app/loading/PostLoginController';
import { resolvePostLoginIdentity } from '../assets/script/app/loading/PostLoginContract';
import { createControllerContext } from './helpers/controller-context';
import { assetPath } from './helpers/asset-paths';

function loadPostLogin(options: { startRatio?: number; saved?: string; load?: () => Promise<object>; missingUI?: boolean; controllerError?: Error } = {}) {
    const bus = EventMgr.instance;
    const ratios: number[] = [], statuses: string[] = [];
    const navigations: Array<{ route: string; params: unknown }> = [];
    const owners: string[][] = [];
    let releases = 0, oldReleases = 0, audio = 0, reads = 0;
    const ui = {
        show() {}, release() { releases++; },
        setStatus(message: string) { statuses.push(message); },
        setProgress(ratio: number) { ratios.push(ratio); },
    };
    const services = createControllerContext();
    services.assets.load = async (_path, Type) => { if (options.load) await options.load(); return new Type(); };
    services.sessionAssets.prepare = async report => { report?.({ ratio: 1, completed: 1, total: 1, message: 'unused' }); };
    const modules: Record<string, any> = {};
    function load(path: string) {
        const exports = {};
        const context = { exports, console: { warn() {}, error() {} }, require(name: string) {
            if (name === 'cc') return { Prefab: class {}, sys: { localStorage: { getItem() { reads++; return options.saved ?? null; } } } };
            if (name.endsWith('/ControllerBase')) return { ControllerBase };
            if (name.endsWith('/PostLoginController')) return options.controllerError
                ? { PostLoginController: class { constructor() { throw options.controllerError; } } } : { PostLoginController };
            if (name.endsWith('/PostLoginContract')) return { resolvePostLoginIdentity };
            if (name.endsWith('/PostLoginComposition')) return modules.composition;
            if (name.endsWith('/ProcedureManager')) return { ProcedureManager: { navigate: (route: string, params?: unknown) => navigations.push({ route, params }) } };
            if (name.endsWith('/AudioMgr')) return { AudioMgr: { instance: { init() { audio++; } } } };
            if (name.endsWith('/TerritoryChapterInfoRepository')) return { TerritoryChapterInfoRepository: { instance: {
                bindOwner: (...values: string[]) => owners.push(values), refresh: async () => {},
            } } };
            if (name.endsWith('/LaunchProgressUI')) return {
                LAUNCH_UPDATE_WEIGHT: 0.6,
                LaunchProgressUI: {
                    ensure: () => options.startRatio === undefined ? null : { currentRatio: options.startRatio, release() { oldReleases++; } },
                    createFromPrefab: () => options.missingUI ? null : ui,
                },
            };
            if (name.endsWith('/ProcedureBase')) return { ProcedureBase: class {
                protected host = {};
                protected assets = services.assets;
                protected configs = services.configs;
                protected sessionAssets = services.sessionAssets;
                protected releaseResourceScope() {}
                protected onDestroy() {}
            } };
            throw new Error(`unexpected dependency: ${name}`);
        } };
        const code = ts.transpileModule(readFileSync(path, 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
        }).outputText;
        runInNewContext(code, context);
        return exports as any;
    }
    modules.composition = load('assets/script/app/bootstrap/login/PostLoginComposition.ts');
    const module = load('assets/script/app/procedure/ProcedurePostLogin.ts');
    const procedure = new module.ProcedurePostLogin();
    const preload = new ResourceScope('post-login-test');
    return { procedure, bus, ratios, statuses, navigations, owners,
        preload: (context = { resources: preload, cancelled: false }) => procedure.onPreload(undefined, context),
        get releases() { return releases; }, get oldReleases() { return oldReleases; }, get audio() { return audio; }, get reads() { return reads; } };
}

test('PostLogin 导航 Main 只传入口数据，加载事件继续推进同一条进度', async () => {
    const h = loadPostLogin();
    await h.preload();
    h.procedure.onEnter();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(h.navigations, [{ route: 'main', params: undefined }]);
    for (const ratio of [0, 0.3, 1]) h.bus.emit('main-loading:progress', { ratio, message: 'loading' });
    const expected = [0.6, 0.88, 0.88, 0.916, 1];
    assert.equal(h.ratios.length, expected.length);
    h.ratios.forEach((ratio, index) => assert.ok(Math.abs(ratio - expected[index]) < 1e-10));
    h.procedure.onLeave();
    assert.equal(h.releases, 0, "Main 首屏完成后按原契约交接遮罩");
});

test('PostLogin 订阅 Main 失败事件显示错误，离开后不再接收加载通知', async () => {
    const h = loadPostLogin();
    await h.preload();
    h.procedure.onEnter();
    h.bus.emit('main-loading:failed', 'asset failure');
    assert.equal(h.statuses.at(-1), '加载失败，请重新进入游戏');
    h.procedure.onLeave();
    const counts = [h.ratios.length, h.statuses.length];
    h.bus.emit('main-loading:progress', { ratio: 1, message: 'late progress' });
    h.bus.emit('main-loading:failed', 'late failure');
    assert.deepEqual([h.ratios.length, h.statuses.length], counts);
});

test('销毁 PostLogin 会解除事件订阅并取消未完成的会话准备', async () => {
    const h = loadPostLogin();
    await h.preload();
    h.procedure.onEnter();
    h.procedure.onDestroy();
    const counts = [h.ratios.length, h.statuses.length];
    h.bus.emit('main-loading:progress', { ratio: 1, message: 'late progress' });
    h.bus.emit('main-loading:failed', 'late failure');
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual([h.ratios.length, h.statuses.length], counts);
    assert.deepEqual(h.navigations, []);
});

test('LaunchProgress 是首包 prefab：启动图 + 进度条，全 UI_2D 且组件引用齐全', () => {
    // 2026-10-12：启动 UI 资源化。prefab 放 assets/resources（首包内置，不进远程热更 bundle），
    // 热更阶段（ProcedureUpdate）可直接 load；结构沿用旧 PostLoginRoot：
    // ProgressTrack(轨道) 下挂 Bar(青色 FILLED 填充)，StatusLabel/ProgressLabel 平行。
    const prefab = JSON.parse(readFileSync(assetPath('ui/loading/LaunchProgress.prefab'), 'utf8')) as any[];
    const nodes = prefab.filter((item) => item.__type__ === 'cc.Node');
    const byName = new Map(nodes.map((node) => [node._name, node]));
    assert.deepEqual(Array.from(byName.keys()), [
        'LaunchProgress',
        'SplashBg',
        'StatusLabel',
        'ProgressTrack',
        'Bar',
        'ProgressLabel',
    ]);
    assert.ok(nodes.every((node) => node._layer === 33554432), '所有节点必须位于 UI_2D 层');
    const sprites = prefab.filter((item) => item.__type__ === 'cc.Sprite');
    const spriteOf = (name: string) =>
        sprites.find((s) => s.node?.__id__ === prefab.indexOf(byName.get(name)));
    // Bar = 填充条：白色圆角条（image/main/bar_white）+ FILLED 横向填充、青色（以前色值）。
    const bar = spriteOf('Bar');
    assert.ok(bar, 'Bar 必须包含 Sprite');
    assert.equal(bar._type, 3, 'Bar 必须使用 FILLED 类型（横向裁剪驱动进度）');
    assert.equal(bar._spriteFrame.__uuid__, 'e0ec7aed-80b4-49aa-b6ab-557bcb4441de@f9941', 'Bar 使用 bar_white');
    assert.equal(bar._fillStart, 0);
    assert.deepEqual([bar._color.r, bar._color.g, bar._color.b], [59, 206, 235]);
    // ProgressTrack = 轨道：同一张白色圆角条 + 深色染色。
    const track = spriteOf('ProgressTrack');
    assert.ok(track);
    assert.equal(track._type, 1, 'Track 使用 SLICED（圆角九宫格 border 由贴图提供）');
    assert.equal(track._spriteFrame.__uuid__, 'e0ec7aed-80b4-49aa-b6ab-557bcb4441de@f9941', 'Track 使用 bar_white');
    assert.deepEqual([track._color.r, track._color.g, track._color.b], [30, 43, 61]);
    // 登录启动图：SplashBg 沿用登录页的启动背景贴图。
    assert.equal(spriteOf('SplashBg')?._spriteFrame.__uuid__, '3cb13d56-dcdd-4237-a335-52f88de69250@f9941');
    // LaunchProgressPage 绑定四个引用：轨道 + 填充条 + 百分比 + 状态文字，且都指向真实组件。
    const page = prefab.find((item) => item.progressTrack && item.progressFill && item.progressLabel && item.statusLabel);
    assert.ok(page, 'LaunchProgressPage 必须绑定轨道/填充条/百分比/状态四个引用');
    for (const field of ['progressTrack', 'progressFill', 'progressLabel', 'statusLabel']) {
        const target = prefab[page[field].__id__];
        assert.ok(target.node && target.node.__id__ !== undefined, `${field} 必须指向挂在节点上的真实组件`);
    }
});

test('LaunchProgressUI 是 prefab 封装：ensure 复用 / createFromPrefab 实例化，不再动态画几何', () => {
    const source = readFileSync('assets/script/app/loading/LaunchProgressUI.ts', 'utf8');
    // 资源化后不再手写 Graphics 几何；节点/组件全部来自 prefab。
    assert.doesNotMatch(source, /roundRect|addComponent\(Graphics\)|fillColor/);
    // 跨流程复用：挂在常驻 host 下的固定节点名，ensure 幂等；组件缺失视为不可用。
    assert.match(source, /static ensure\(host: Node\): LaunchProgressUI \| null/);
    assert.match(source, /host\.getChildByName\(NODE_NAME\)/);
    assert.match(source, /static createFromPrefab\(prefab: Prefab, host: Node\)/);
    assert.match(source, /node\.getComponent\(LaunchProgressPage\)/);
    // 生命周期：登录页期间 hide、进入 Main 后 release 销毁。
    assert.match(source, /hide\(\): void/);
    assert.match(source, /release\(\): void/);
    // 热更段权重导出，供两个流程分段映射。
    assert.match(source, /export const LAUNCH_UPDATE_WEIGHT = 0\.6/);
});

test('会话基础资源合并并发 prepare，完成后可统一释放', async () => {
    const code = ts.transpileModule(readFileSync('assets/script/app/session/AppSessionAssetService.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    let configCalls = 0;
    let releaseCalls = 0;
    const loaded: string[] = [];
    const context = {
        // 构造函数真实签名是 `(assets, configs, runtimePrecompiler?)`（见
        // `AppSessionAssetService.ts`），这里曾按旧的单参 `(configs)` 写死 ⇒ 下面 `new` 传两个实参
        // 被 tsc 判 TS2554「Expected 1 arguments, but got 2」。运行期是 `as` 断言、不受影响，
        // 但类型漂移会让全量 `tsc` 一直挂着一条红，顺手对齐。
        exports: {} as { AppSessionAssetService: new (assets: any, configs: any, runtimePrecompiler?: any) => any },
        require: (name: string) => {
            if (name === 'cc') return { Prefab: class {} };
            if (name.endsWith('/ScopedAssetCache')) return { ScopedAssetCache };
            if (name.endsWith('/ZCGameResourcePlan')) return resourcePlan;
            if (name === '../../core/asset/ResourceScope') return { ResourceScope };
            if (name === '../../core/asset/BundleCatalog') return { BATTLE_BUNDLE: 'battle' };
            if (name === '../card/CardLineupIcons') return {
                loadCommonArt: async (asset: string) => { loaded.push(asset); return { asset }; },
                releaseArtCache: () => { releaseCalls += 1; },
            };
            throw new Error(`unexpected dependency: ${name}`);
        },
        console, setTimeout, clearTimeout,
    };
    runInNewContext(code, context);

    const service = new context.exports.AppSessionAssetService({}, {
        initialize: async () => { configCalls += 1; },
    });
    const ratios: number[] = [];
    await Promise.all([
        service.prepare((progress: any) => ratios.push(progress.ratio)),
        service.prepare(),
    ]);

    assert.equal(configCalls, 1);
    assert.equal(loaded.length, 3, '导航图标已经序列化在 TabButton prefab 实例，不应加入登录动态加载队列');
    assert.equal(ratios.at(-1), 1);
    assert.equal(service.ready, true);
    assert.equal('takeBattlePreload' in service, false);
    service.clear();
    service.clear();
    assert.equal(service.ready, false);
    assert.equal(releaseCalls, 1);
});

test('PostLogin 流程只转发生命周期，外部组合层拥有加载与身份适配器', () => {
    const login = readFileSync('assets/script/app/login/LoginController.ts', 'utf8');
    const procedure = readFileSync('assets/script/app/procedure/ProcedurePostLogin.ts', 'utf8');
    const composition = readFileSync('assets/script/app/bootstrap/login/PostLoginComposition.ts', 'utf8');
    const controller = readFileSync('assets/script/app/loading/PostLoginController.ts', 'utf8');
    assert.match(login, /navigate\(GameRoute\.PostLogin/);
    assert.match(procedure, /PostLoginComposition/);
    assert.doesNotMatch(procedure, /sys|localStorage|AudioMgr|EventMgr|TerritoryChapterInfoRepository|sessionAssets.prepare|LaunchProgressUI/);
    assert.match(composition, /sessionAssets.prepare/);
    assert.match(composition, /existed.currentRatio/);
    assert.match(composition, /load\('ui\/loading\/LaunchProgress', Prefab/);
    assert.match(controller, /navigate\(GameRoute.Main\)/);
    assert.doesNotMatch(controller, /from 'cc'|progress.message/);
});

test('PostLogin 取消预加载后迟到 prefab 不得挂载，再次进入使用独立会话', async () => {
    let resolve: (value: object) => void = () => {};
    const h = loadPostLogin({ load: () => new Promise(yes => { resolve = yes; }) });
    const context = { resources: new ResourceScope('cancelled-preload'), cancelled: false };
    const ready = h.preload(context);
    context.cancelled = true;
    h.procedure.onPreloadCancelled();
    resolve({}); await ready; h.procedure.onEnter();
    assert.equal(h.audio, 0); assert.deepEqual(h.ratios, []);
    h.procedure.onDestroy(); context.resources.dispose();
});

test('PostLogin 复用热更实际进度、入口身份优先；失败退出释放 UI，重进不复用旧控制器', async () => {
    const h = loadPostLogin({ startRatio: 0, saved: JSON.stringify({ roleId: 8, selectServerId: 9 }) });
    await h.preload(); h.procedure.onEnter({ session: { roleId: 1, selectServerId: 2 } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.ratios[0], 0); assert.equal(h.oldReleases, 1);
    assert.deepEqual(h.owners, [['1', '2']]); assert.equal(h.reads, 0);
    h.procedure.onLeave(); assert.equal(h.releases, 1);
    await h.preload(); h.procedure.onEnter(); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(h.owners, [['1', '2'], ['8', '9']]); assert.equal(h.audio, 2);
    h.procedure.onDestroy(); assert.equal(h.releases, 2);
});

test('PostLogin 缺少 UI 时明确失败且不启动资源和导航', async () => {
    const h = loadPostLogin({ missingUI: true });
    await h.preload(); assert.throws(() => h.procedure.onEnter(), /LaunchProgress/);
    h.procedure.onDestroy(); assert.equal(h.audio, 0); assert.deepEqual(h.navigations, []);
});

test('PostLogin 控制器装配失败释放已创建遮罩，保留原始错误且离开幂等', async () => {
    const failure = new Error('post-login assembly failed');
    const h = loadPostLogin({ controllerError: failure });
    await h.preload();
    assert.throws(() => h.procedure.onEnter(), error => error === failure);
    assert.equal(h.releases, 1);
    h.procedure.onLeave();
    assert.equal(h.releases, 1);
    assert.equal(h.navigations.length, 0);
});
