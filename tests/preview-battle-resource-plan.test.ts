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
    const bundles: [string, string | undefined][] = [];
    const counts: unknown[] = [];
    let guideLoads = 0;
    const definitions = [68001, 68002, 68003, 68004, 68005].map((id) => ({
        unitId: String(id), prefabPath: id === 68001 ? `skel/probe/unit-${id}` : `units/probe/${id}`, attackProfile: { effectPrefabPath: `units/effects/probe/${id}` },
        ...(id === 68001 ? { empoweredProfile: { effectPrefabPath: 'units/effects/probe/empowered' } } : {}),
    }));
    const base = { playerDeck: [{ id: '91001', unitId: '68003' }], enemyDeck: [], map: {} };
    const dependencies: Record<string, unknown> = {
        '../model/ZCGameResourcePlan': resourcePlan,
        cc: { JsonAsset: class {}, Prefab: class {} },
        '../../../core/asset/BundleCatalog': { BATTLE_BUNDLE: 'battle' },
        '../../ArtPaths': { spriteFramePath: (root: string, name: string) => `${root}/${name}/spriteFrame`, decorFramePath: (name: string) => `image/decor/${name}/spriteFrame` },
        '../model/ZCCombatCatalog': { getAllUnitDefinitions: () => definitions, findCatalogCard: (id: string) => ({ unitId: id === '91001' ? '68003' : '68005' }) },
        '../model/ZCNeutralResourceGroup': { getZCNeutralResourceCatalog: () => ({ items: new Map([
            [1, { cardId: '92001', unitCount: 3 }],
        ]) }) },
        '../model/ZCGameRuntimeConfig': { loadPvpTables() {}, getPvpRuntimeRules: () => ({}) },
        '../model/ZCGameModel': { configureZCMap() {}, getZCLocalPlayerCountOverride: () => 4,
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
    const context = { exports: {} as any, require: (name: string) => dependencies[name] };
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/zcds/application/ZCGameLoader.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, context);
    const loader = new context.exports.ZCGameLoader({
        load: async (path: string, _type: unknown, options: { bundle?: string } | undefined) => { paths.push(path); bundles.push([path, options?.bundle ?? bundleForPath(path)]); return { path }; },
        loadDir: async (path: string, _type: unknown, options: { bundle?: string } | undefined) => {
            bundles.push([path, options?.bundle ?? bundleForPath(path)]);
            return path === 'maps' ? [{ name: 'map', json: { art: { freeDecor: [{ art: 'wasteland/st1' }] } } }] : [];
        },
    }, { initialize: async () => {}, getTable: async () => [] }, 'maps');
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
    const offline = await loader.prepare();
    assert.equal(offline.unitVisualPrefabs.size, 5);
    assert.ok(paths.includes('units/effects/probe/unused'), '离线完整目录保持保守覆盖');
});
