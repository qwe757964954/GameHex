import { scopeAssetService, type AssetService } from '../assets/script/core/asset/AssetService';
import { ResourceLoadManager } from '../assets/script/core/asset/ResourceLoadManager';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import { ZC_ATTACK_TRAITS } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import * as resourcePlan from '../assets/script/app/zcds/model/ZCGameResourcePlan';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const LOADER_SOURCE = 'assets/script/app/zcds/application/ZCGameLoader.ts';

function createLoader(assets: unknown, warnings: unknown[][] = []) {
    const source = readFileSync(LOADER_SOURCE, 'utf8');
    const code = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    const dependencies: Record<string, unknown> = {
        '../model/ZCGameResourcePlan': resourcePlan,
        '../../../core/asset/BundleCatalog': { BATTLE_BUNDLE: 'battle' },
        cc: {
            EffectAsset: class {},
            JsonAsset: class {},
            Material: class {},
            Prefab: class {},
            SpriteFrame: class {},
        },
        '../model/ZCCombatCatalog': { ZC_ATTACK_TRAITS, getAllUnitDefinitions: () => [] },
        '../model/ZCGameModel': {
            configureZCMap() {},
            getZCLocalPlayerCountOverride: () => null,
            isRandomMapCandidate: () => true,
        },
        '../model/ZCGameRuntimeConfig': { getPvpRuntimeRules: () => ({}), loadPvpTables() {} },
        '../model/ZCModifierRuntime': { getZCModifierCatalogs: () => ({ adapters: { textOverrides: new Map() } }) },
        '../../ArtPaths': {
            decorFramePath: (name: string) => name,
            SPAWN_REGION_ART_ROOT: 'image/spawn-region',
            HEX_FLIP_PULSE_ART_ROOT: 'image/effects/hex_pulse',
            HEX_GROUND_GLOW_ART_ROOT: 'image/effects/hex_ground_glow',
            spriteFramePath: (root: string, name: string) => `${root}/${name}`,
        },
        './ZCGuideLoader': { ZCGuideLoader: class {} },
        // zcds 统一日志开关（2026-10-15）：loader 的加载失败告警挂在它后面。
        '../ZCDCLogSwitch': { ZCDC_LOG_WARNINGS: true, ZCDC_LOG_DIAGNOSTICS: false },
    };
    const context = {
        exports: {} as { ZCGameLoader: new (resources: unknown, mapDirectory: string) => object },
        require: (name: string) => dependencies[name],
        console: { warn: (...args: unknown[]) => warnings.push(args) },
    };
    runInNewContext(code, context);
    // 与正式 Controller 注入一致，资源服务负责加载前后与在途取消。
    const scopedAssets = scopeAssetService(new ResourceLoadManager(assets as AssetService, { maxConcurrentLoads: 1 }), new ResourceScope('loader-test'));
    return new context.exports.ZCGameLoader({ assets: scopedAssets, configs: {} }, 'maps');
}

function loadSortedSpriteFrames(loader: object) {
    return (loader as unknown as {
        loadSortedSpriteFrames(directory: string, scope?: object): Promise<readonly { name?: string }[]>;
    }).loadSortedSpriteFrames.bind(loader);
}

test('序列帧按文件名排序并忽略没有名称的帧', async () => {
    const directories: string[] = [];
    const scope = new ResourceScope('battle-test');
    const loader = createLoader({
        loadDir: async (directory: string, _type: unknown, options: { scope: object }) => {
            directories.push(`${directory}:${options.scope === scope}`);
            return [{ name: 'frame_02' }, {}, { name: 'frame_01' }];
        },
    });

    const frames = await loadSortedSpriteFrames(loader)('image/effects/test', scope);

    assert.deepEqual(directories, ['image/effects/test:true']);
    assert.deepEqual(frames.map((frame) => frame.name), ['frame_01', 'frame_02']);
});

test('序列帧目录加载失败保留原始错误，不返回空数组', async () => {
    const warnings: unknown[][] = [];
    const failure = new Error('missing frames');
    const loader = createLoader({ loadDir: async () => { throw failure; } }, warnings);

    await assert.rejects(loadSortedSpriteFrames(loader)('image/effects/test'), error => error === failure);
    assert.equal(warnings.length, 0);
});

for (const method of [
    'loadWallMaterial', 'loadUnitOutlineCopyEffect', 'loadWallFrames', 'loadBuildingFrames',
    'loadNeutralResourceFrames', 'loadGoldCoinFrame', 'loadUnknownResourceFrame',
    'loadCommonEffects',
    'loadSpawnRegionFrames',
]) {
    test(`${method} 加载失败向上抛出，不降级为缺图`, async () => {
        const failure = new Error('asset unavailable');
        const scope = new ResourceScope('battle-test');
        const warnings: unknown[][] = [];
        const fail = async (_path: string, _type: unknown, options: { scope: object }) => {
            assert.equal(options.scope, scope);
            throw failure;
        };
        const loader = createLoader({ load: fail, loadDir: fail }, warnings) as Record<string, (scope: object) => Promise<unknown>>;
        await assert.rejects(loader[method](scope), error => error === failure);
        assert.equal(warnings.length, 0);
    });
}

for (const fails of [false, true]) {
    test(`序列帧在途取消${fails ? '失败' : '成功'}均拒绝且不报缺图`, async () => {
        const warnings: unknown[][] = [];
        let finish!: () => void;
        const pending = new Promise<void>(resolve => { finish = resolve; });
        const scope = new ResourceScope('battle-test');
        const loader = createLoader({ loadDir: async () => {
            await pending;
            if (fails) throw new Error('late failure');
            return [{ name: 'late' }];
        } }, warnings);
        const result = loadSortedSpriteFrames(loader)('frames', scope);
        scope.dispose(); finish();
        await assert.rejects(result, /取消/);
        assert.equal(warnings.length, 0);
    });
}
test('已释放作用域不派发序列帧加载', async () => {
    let loads = 0;
    const loader = createLoader({ loadDir: async () => { loads++; return []; } });
    const scope = new ResourceScope('cancelled-test');
    scope.dispose();
    await assert.rejects(loadSortedSpriteFrames(loader)('frames', scope), /取消/);
    assert.equal(loads, 0);
});

function commonEffectsLoader(assets: unknown) {
    return createLoader(assets) as {
        loadCommonEffects(scope?: object, priority?: number): Promise<{
            spawnFxPrefab: { name: string };
            deathFxPrefab: { name: string };
            buildingDestroyFxPrefab: { name: string };
            hitFxPrefabs: ReadonlyMap<string, { name: string }>;
        }>;
        loadSpawnRegionFrames(scope?: object): Promise<{ front: { name: string }; mid: { name: string }; back: { name: string } }>;
    };
}

const COMMON_PREFABS = ['出生特效', '死亡特效', '建筑死亡特效', '法师受击', '中毒受击', '射手受击', '坦克受击', '战士受击']
    .map(name => ({ name }));

test('公共特效按目录和 Prefab 类型一次加载，按名称分配且中毒不进职业映射', async () => {
    const scope = new ResourceScope('battle-test');
    let calls = 0;
    const loader = commonEffectsLoader({ loadDir: async (directory, type, options) => {
        calls++;
        assert.equal(directory, 'units/effects');
        assert.equal(type.name, 'Prefab');
        assert.equal(options.scope, scope);
        assert.equal(options.bundle, 'battle');
        assert.equal(options.priority, 10);
        return COMMON_PREFABS;
    } });
    const art = await loader.loadCommonEffects(scope, 10);
    assert.equal(calls, 1);
    assert.equal(art.spawnFxPrefab, COMMON_PREFABS[0]);
    assert.equal(art.deathFxPrefab, COMMON_PREFABS[1]);
    assert.equal(art.buildingDestroyFxPrefab, COMMON_PREFABS[2]);
    assert.deepEqual(Array.from(art.hitFxPrefabs.keys()), ZC_ATTACK_TRAITS);
    for (const trait of ZC_ATTACK_TRAITS) assert.equal(art.hitFxPrefabs.get(trait)?.name, `${trait}受击`);
    assert.equal(art.hitFxPrefabs.has('中毒'), false);
});

test('公共特效目录缺少必需 prefab 时明确失败', async () => {
    const loader = commonEffectsLoader({ loadDir: async () => COMMON_PREFABS.filter(prefab => prefab.name !== '法师受击') });
    await assert.rejects(loader.loadCommonEffects(), /缺少 prefab.*法师受击/);
});

test('公共特效目录在途取消不返回资源，已取消时不派发请求', async () => {
    const scope = new ResourceScope('battle-test');
    let calls = 0;
    const loader = commonEffectsLoader({ loadDir: async () => {
        calls++;
        scope.dispose();
        return COMMON_PREFABS;
    } });
    await assert.rejects(loader.loadCommonEffects(scope), /取消/);
    await assert.rejects(loader.loadCommonEffects(scope), /取消/);
    assert.equal(calls, 1);
});

test('出生区域气泡按目录加载并按帧名映射，其他气泡不参与映射', async () => {
    const scope = new ResourceScope('battle-test');
    let calls = 0;
    const loader = commonEffectsLoader({ loadDir: async (directory, type, options) => {
        calls++;
        assert.equal(directory, 'image/spawn-region');
        assert.equal(type.name, 'SpriteFrame');
        assert.equal(options.scope, scope);
        return ['frame_04', 'frame_02', 'frame_03', 'frame_01'].map(name => ({ name }));
    } });
    const frames = await loader.loadSpawnRegionFrames(scope);
    assert.equal(calls, 1);
    assert.equal(frames.front.name, 'frame_02');
    assert.equal(frames.mid.name, 'frame_01');
    assert.equal(frames.back, frames.mid);
});

test('出生区域气泡目录缺少必需帧时明确失败', async () => {
    const loader = commonEffectsLoader({ loadDir: async () => [{ name: 'frame_04' }] });
    await assert.rejects(loader.loadSpawnRegionFrames(), /缺少 frame_01/);
});
