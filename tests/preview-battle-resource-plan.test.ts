import * as ArtPaths from '../assets/script/app/ArtPaths';
import * as resourcePlan from '../assets/script/app/zcds/model/ZCGameResourcePlan';
import assert from 'node:assert/strict';
import test from 'node:test';
import { bundleForPath } from '../assets/script/core/asset/BundleCatalog';
import { resolveZCVisualUnitIds } from '../assets/script/app/zcds/model/ZCVisualResourcePlan';

test('本局英雄表现依赖沿召唤、换兵种传递闭包，循环引用终止，不加载无关单位', () => {
    const known = ['68001','68002','68003','68004'];
    const result = resolveZCVisualUnitIds(known, [68001], [
        {unitId:'68001',details:{summonUnitId:68002}},
        {unitId:'68002',details:{replacement:'68003'}},
        {unitId:'68003',details:{target:'68001'}},
        {unitId:'68004',details:{summonUnitId:'68004'}},
    ]);
    assert.deepEqual(Array.from(result), ['68001','68002','68003']);
    assert.equal(resolveZCVisualUnitIds(known, [], []).size,0);
});


test('加载器按后端英雄、召唤链与波次选模型，离线保持完整目录', async () => {
    const { readFileSync } = await import('node:fs');
    const { runInNewContext } = await import('node:vm');
    const ts = (await import('typescript')).default;
    const paths: string[] = [];
    const directories: string[] = [];
    const bundles: [string, string | undefined][] = [];
    const counts: unknown[] = [];
    let guideLoads = 0;
    let initialization: Promise<void> | null = null;
    let configurationApplied = false;
    let mapFailure = false;
    let beforeLoad: ((path: string) => Promise<void>) | null = null;
    const definitions = [68001, 68002, 68003, 68004, 68005].map((id) => ({
        unitId: String(id), prefabPath: id === 68001 ? `skel/probe/unit-${id}` : `units/probe/${id}`, attackProfile: { effectPrefabPath: `units/effects/probe/${id}` },
        ...(id === 68001 ? { empoweredProfile: { effectPrefabPath: 'units/effects/probe/empowered' } } : {}),
    }));
    const base = { playerDeck: [{ id: '91001', unitId: '68003' }], enemyDeck: [], map: {} };
    const dependencies: Record<string, unknown> = {
        '../model/ZCGameResourcePlan': resourcePlan,
        cc: { JsonAsset: class {}, Prefab: class {} },
        '../../../core/asset/BundleCatalog': { BATTLE_BUNDLE: 'battle' },
        '../../ArtPaths': { ...ArtPaths, spriteFramePath: (root: string, name: string) => `${root}/${name}/spriteFrame`, decorFramePath: (name: string) => `image/decor/${name}/spriteFrame` },
        '../model/ZCCombatCatalog': { getAllUnitDefinitions: () => definitions, findCatalogCard: (id: string) => ({ unitId: id === '91001' ? '68003' : '68005' }) },
        '../model/ZCNeutralResourceGroup': { getZCNeutralResourceCatalog: () => ({ items: new Map([
            [1, { cardId: '92001', unitCount: 3 }],
        ]) }) },
        '../model/ZCGameRuntimeConfig': { loadPvpTables() { configurationApplied = true; }, getPvpRuntimeRules: () => ({}) },
        '../model/ZCGameModel': { configureZCMap() { assert.equal(configurationApplied, true, '地图必须等本局配置应用后再配置'); }, getZCLocalPlayerCountOverride: () => 4,
            isRandomMapCandidate: (_layout: unknown, count: unknown) => { counts.push(count); return true; } },
        '../model/ZCMatchConfig': { captureZCMatchConfig: () => base },
        '../model/ZCModifierRuntime': { getZCModifierCatalogs: () => ({ adapters: {
            skillPlans: [{ enabled: true, unitId: '68001', summonUnitId: '68002' }],
            textOverrides: new Map([['replacement', { enabled: true, statId: 'model', value: 'units/effects/probe/replacement' }], ['irrelevant', { enabled: true, statId: 'model', value: 'units/effects/probe/unused' }]]),
        } }) },
        './ZCClientCombatConfig': { buildZCClientCombatConfig: () => ({ config: { modifiers: { player: [{ targetUnitId: '68001', textModifiers: [{ statId: 'model', value: 'units/effects/probe/replacement' }] }] } } }) },
        '../model/ZCVisualResourcePlan': { resolveZCVisualUnitIds },
        '../ZCDCLogSwitch': { ZCDC_LOG_WARNINGS: false },
        './ZCGuideLoader': { ZCGuideLoader: class { async prepare() { guideLoads++; return {}; } } },
    };
    const context = { exports: {} as any, setTimeout, console, require: (name: string) => dependencies[name] };
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/zcds/application/ZCGameLoader.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, context);
    const loader = new context.exports.ZCGameLoader({ assets: {
        load: async (path: string, _type: unknown, options: { bundle?: string; cache?: boolean } | undefined) => {
            if (path.startsWith('image/decor/')) assert.equal(options?.cache, false, '随机地图装饰不占用会话缓存');
            paths.push(path); bundles.push([path, options?.bundle ?? bundleForPath(path)]);
            if (beforeLoad) await beforeLoad(path);
            return { path };
        },
        loadDir: async (path: string, _type: unknown, options: { bundle?: string } | undefined) => {
            bundles.push([path, options?.bundle ?? bundleForPath(path)]);
            if (path === 'maps' && mapFailure) throw new Error('map file failed');
            directories.push(path);
            if (beforeLoad) await beforeLoad(path);
            if (path.startsWith('image/effects/')) return [{ name: 'frame_02' }, { name: 'frame_01' }];
            return path === 'maps' ? [{ name: 'map', json: { art: { freeDecor: [{ art: 'wasteland/st1' }] } } }] : [];
        },
    }, configs: { initialize: async () => { if (initialization) await initialization; }, getTable: async () => [] } }, 'maps');
    const prepared = await loader.prepare(undefined, { units: [
        { heroes: [{ heroId: 68001 }], heroIds: [68004] }, { heroes: [], heroIds: [68004] },
    ] }, [91001]);
    assert.deepEqual(Array.from(prepared.unitVisualPrefabs.keys()), ['68001', '68002', '68003', '68005']);
    assert.ok(prepared.unitVisualPrefabs.has('68005'), '中立奖励兵即使不在参战阵容或默认卡组也必须有模型');
    assert.ok(!paths.includes('units/probe/68004'), '空 heroInfos 不能回退旧名单');
    assert.ok(paths.includes('units/effects/probe/empowered'));
    assert.ok(paths.includes('units/effects/probe/replacement'));
    assert.ok(!paths.includes('units/effects/probe/unused'), '正式回包只加载实际修改器用到的覆盖模型');
    assert.ok(paths.includes('ui/game/ZCBossPanel'), '守城波次需要首领面板');
    assert.ok(!paths.includes('ui/game/ZCSpawnSelection'));
    assert.ok(!paths.includes('image/gameui/whh/spriteFrame'), '固定主城不加载选点问号');
    assert.ok(!paths.includes('image/spawn-region/frame_01/spriteFrame'), '固定主城不加载选点气泡');
    assert.equal(guideLoads, 0, '开战不等待指南内容或图标');
    assert.equal(typeof prepared.loadGuide, 'function');
    await Promise.all([prepared.loadGuide(), prepared.loadGuide()]);
    assert.equal(guideLoads, 1, '指南首次打开合并请求');
    // 战斗专属单位与外壳走 battle；Spine、建筑、装饰和地图保留各自归属。
    const battlePaths = paths.filter((p) => p.startsWith('units/') || p.startsWith('ui/game/'));
    assert.ok(battlePaths.length > 0, '战斗资源清单不应为空');
    for (const p of battlePaths) {
        assert.equal(bundles.find(([bp]) => bp === p)?.[1], 'battle', `${p} 必须带 battle bundle`);
    }
    assert.equal(bundles.find(([bp]) => bp === 'maps')?.[1], undefined, '地图目录不带 bundle（首包）');
    for (const path of ['skel/probe/unit-68001', 'image/buildings', 'image/buildings/walls', 'image/decor/wasteland/st1/spriteFrame']) {
        assert.ok(bundles.some(([p]) => p === path), `必须覆盖共享资源 ${path}`);
        assert.equal(bundles.find(([p]) => p === path)?.[1], undefined, `${path} 留在首包，不能被强制发往 battle`);
    }
    assert.deepEqual(counts, [2], '回包人数优先于本地调试覆盖');
    paths.length = 0;
    await loader.prepare(undefined, { units: [{ heroes: [], heroIds: [] }, { heroes: [], heroIds: [] }] });
    assert.ok(!paths.includes('ui/game/ZCBossPanel'), '普通对局不等待守城面板');
    paths.length = 0;
    Object.assign(base.map, { cityMode: 'select' });
    await loader.prepare(undefined, { units: [{ heroes: [], heroIds: [] }, { heroes: [], heroIds: [] }] });
    for (const path of ['image/gameui/whh/spriteFrame', 'image/spawn-region/frame_01/spriteFrame', 'image/spawn-region/frame_02/spriteFrame']) {
        assert.ok(paths.includes(path), `自选主城仍需加载 ${path}`);
    }
    paths.length = 0;
    const offline = await loader.prepare();
    assert.equal(offline.unitVisualPrefabs.size, 5);
    assert.ok(paths.includes('units/effects/probe/unused'), '离线完整目录保持保守覆盖');

    paths.length = 0;
    const scope = { disposed: false };
    directories.length = 0;
    const progressive = await loader.prepare(scope, { units: [
        { heroes: [{ heroId: 68001 }], heroIds: [] }, { heroes: [], heroIds: [] },
    ] });
    assert.equal(progressive.effectVisualPrefabs.size, 0);
    assert.equal(progressive.hexGroundGlowFrames.length, 0);
    assert.equal(progressive.hexPulseFrames.length, 0);
    assert.equal(progressive.artifactClaimBurstFrames.length, 0);
    for (const dir of [ArtPaths.HEX_GROUND_GLOW_ART_ROOT, ArtPaths.HEX_FLIP_PULSE_ART_ROOT, ArtPaths.ARTIFACT_CLAIM_BURST_ART_ROOT]) {
        assert.ok(!directories.includes(dir), `纯表现目录 ${dir} 不得挤占首帧`);
    }
    assert.equal(progressive.hitFxPrefabs.size, 0);
    assert.ok(!paths.some(p => p.startsWith('units/effects/')), '首帧不得提前派发专属或公共特效');
    assert.ok(!paths.some(p => p.startsWith('image/decor/')), '装饰延后');
    assert.ok(progressive.unitVisualPrefabs.has('68002'), '召唤链模型仍在首帧前准备');
    // 路径必须已经拍成字符串；下一局配表/地图切换不能改变后补清单。
    const previousPath = definitions[0].attackProfile.effectPrefabPath;
    definitions[0].attackProfile.effectPrefabPath = 'units/effects/probe/next-battle';
    loader.selectedMap = { art: { freeDecor: [{ art: 'next-map' }] } };
    const updates: any[] = [];
    const task = progressive.loadDeferredArt((art: unknown) => updates.push(art));
    assert.equal(progressive.loadDeferredArt(() => {}), task, '重复启动共用同一任务');
    await task;
    assert.ok(updates.at(-1).effectVisualPrefabs.has('units/effects/probe/empowered'));
    assert.equal(updates.at(-1).hitFxPrefabs.size, 4);
    assert.ok(updates.at(-1).decorFrames.has('wasteland/st1'));
    for (const frames of [updates.at(-1).hexGroundGlowFrames, updates.at(-1).hexPulseFrames, updates.at(-1).artifactClaimBurstFrames]) {
        assert.deepEqual(Array.from(frames, (f: any) => f.name), ['frame_01', 'frame_02']);
    }
    assert.equal(directories[0], 'maps');

    assert.equal(paths.filter(p => p === 'units/effects/probe/empowered').length, 1);
    assert.ok(!paths.includes('units/effects/probe/next-battle'));
    assert.ok(!paths.includes('image/decor/next-map/spriteFrame'));
    definitions[0].attackProfile.effectPrefabPath = previousPath;

    const inFlightScope = { disposed: false };
    const inFlight = await loader.prepare(inFlightScope, { units: [{ heroes: [], heroIds: [] }, { heroes: [], heroIds: [] }] });
    let release!: () => void;
    let started!: () => void;
    const began = new Promise<void>(resolve => { started = resolve; });
    beforeLoad = async () => { started(); await new Promise<void>(resolve => { release = resolve; }); };
    paths.length = 0; directories.length = 0;
    const pending = inFlight.loadDeferredArt(() => assert.fail('在途取消后的结果不得发布'));
    const rejected = assert.rejects(pending, /取消/);
    await began; inFlightScope.disposed = true; release(); await rejected;
    assert.equal(paths.length + directories.length, 1, '在途任务结束后不得继续下一项');
    beforeLoad = null;

    paths.length = 0;
    const cancelledScope = { disposed: false };
    const cancelled = await loader.prepare(cancelledScope, { units: [{ heroes: [], heroIds: [] }, { heroes: [], heroIds: [] }] });
    cancelledScope.disposed = true;
    paths.length = 0;
    await assert.rejects(cancelled.loadDeferredArt(() => assert.fail('离场后禁止刷新')));
    assert.equal(paths.length, 0, '离场后不派发补载');

    let finishConfig!: () => void;
    initialization = new Promise<void>(resolve => { finishConfig = resolve; });
    configurationApplied = false; directories.length = 0;
    const overlapping = loader.prepare({ disposed: false }, { units: [{ heroes: [], heroIds: [] }, { heroes: [], heroIds: [] }] });
    try {
        await new Promise(resolve => setImmediate(resolve));
        assert.ok(directories.includes('maps'), '地图文件读取不应串在配置请求之后');
        assert.equal(configurationApplied, false);
    } finally { finishConfig(); await overlapping; initialization = null; }

    // 地图在配置仍等待时失败，既不产生未处理拒绝，也不提前配置地图。
    initialization = new Promise<void>(resolve => { finishConfig = resolve; });
    configurationApplied = false; mapFailure = true;
    const failedMap = loader.prepare({ disposed: false }, { units: [{ heroes: [], heroIds: [] }, { heroes: [], heroIds: [] }] });
    const rejectedMap = assert.rejects(failedMap, /地图目录中没有可用配置/);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(configurationApplied, false);
    finishConfig(); await rejectedMap; initialization = null; mapFailure = false;

});
