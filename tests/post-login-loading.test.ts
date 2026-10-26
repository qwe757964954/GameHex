import { ScopedAssetCache } from '../assets/script/core/asset/ScopedAssetCache';
import * as resourcePlan from '../assets/script/app/zcds/model/ZCGameResourcePlan';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';

test('LaunchProgress 是首包 prefab：启动图 + 进度条，全 UI_2D 且组件引用齐全', () => {
    // 2026-10-12：启动 UI 资源化。prefab 放 assets/resources（首包内置，不进远程热更 bundle），
    // 热更阶段（ProcedureUpdate）可直接 load；结构沿用旧 PostLoginRoot：
    // ProgressTrack(轨道) 下挂 Bar(青色 FILLED 填充)，StatusLabel/ProgressLabel 平行。
    const prefab = JSON.parse(readFileSync('assets/resources/ui/loading/LaunchProgress.prefab', 'utf8')) as any[];
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
    let battleReleaseCalls = 0;
    let battleLoads = 0;
    const loaded: string[] = [];
    class BattlePreload {
        constructor() { battleLoads += 1; }
        readonly ready = Promise.resolve({ prepared: true });
        releaseFromMatching() { battleReleaseCalls += 1; }
    }
    const context = {
        exports: {} as { AppSessionAssetService: new (configs: any) => any },
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
            if (name === '../zcds/ZCGame') return { MAP_DIRECTORY: 'config/maps' };
            if (name === '../zcds/application/ZCGameLoader') return { ZCGameLoader: class {} };
            if (name === '../zcds/application/ZCGamePreload') return { ZCGamePreload: BattlePreload };
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
    assert.equal(battleLoads, 0, '登录只准备基础资源，不选地图或构筑战斗');
    assert.equal(service.takeBattlePreload(), null);
    service.clear();
    service.clear();
    assert.equal(service.ready, false);
    assert.equal(releaseCalls, 1);
    assert.equal(battleReleaseCalls, 0, '接管后不再由会话服务释放');
    assert.equal(battleReleaseCalls, 0);
});

test('角色登录成功后先进入 PostLogin，由加载流程复用启动 UI 续走进度到 Main', () => {
    const login = readFileSync('assets/script/app/login/LoginPage.ts', 'utf8');
    const loading = readFileSync('assets/script/app/procedure/ProcedurePostLogin.ts', 'utf8');
    assert.match(login, /navigate\(GameRoute\.PostLogin/);
    assert.match(loading, /sessionAssets\.prepare/);
    assert.match(loading, /navigate\(GameRoute\.Main/);
    assert.doesNotMatch(loading, /progress\.message/);
    // 共用同一个启动 UI：热更留下的节点因资源作用域已释放而失效，销毁前先读其实际进度
    // （热更走完续走 0.6；跳过/异常则从 0 起步），再以本流程预加载的同一 prefab 重建。
    assert.match(loading, /LaunchProgressUI\.ensure\(this\.host\)/);
    assert.match(loading, /existed\.currentRatio/);
    assert.match(loading, /existed\.release\(\)/);
    assert.match(loading, /createFromPrefab\(this\.launchPrefab, this\.host\)/);
    // 登录后所有预加载合并为一条 [startRatio, 1]：会话资源占 0.7、Main 加载占 0.3，
    // 中途不提前满 100%（避免「到 100 再 100%」）。
    assert.match(loading, /this\.startRatio \+ progress\.ratio \* remain \* 0\.7/);
    assert.match(loading, /remain \* \(0\.7 \+ ratio \* 0\.3\)/);
    assert.doesNotMatch(loading, /setProgress\(1\)/);
    // 首包 prefab 预载：热更期未实例化时，登录后加载阶段兜底 load 启动 UI。
    assert.match(loading, /load\('ui\/loading\/LaunchProgress', Prefab/);
    // 旧 PostLoginRoot 预制体/组件已废弃。
    assert.doesNotMatch(loading, /PostLoginRoot|PostLoginLoadingPage|POST_LOGIN_ROOT_URL/);
});
