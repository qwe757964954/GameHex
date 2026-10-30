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
        '../model/ZCCombatCatalog': { getAllUnitDefinitions: () => [] },
        '../model/ZCGameModel': {
            configureZCMap() {},
            getZCLocalPlayerCountOverride: () => null,
            isRandomMapCandidate: () => true,
        },
        '../model/ZCGameRuntimeConfig': { getPvpRuntimeRules: () => ({}), loadPvpTables() {} },
        '../model/ZCModifierRuntime': { getZCModifierCatalogs: () => ({ adapters: { textOverrides: new Map() } }) },
        '../../ArtPaths': {
            decorFramePath: (name: string) => name,
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
    return new context.exports.ZCGameLoader({ assets, configs: {} }, 'maps');
}

function loadSortedSpriteFrames(loader: object) {
    return (loader as unknown as {
        loadSortedSpriteFrames(directory: string, label: string, scope?: object): Promise<readonly { name?: string }[]>;
    }).loadSortedSpriteFrames.bind(loader);
}

test('序列帧按文件名排序并忽略没有名称的帧', async () => {
    const directories: string[] = [];
    const scope = { disposed: false };
    const loader = createLoader({
        loadDir: async (directory: string, _type: unknown, options: { scope: object }) => {
            directories.push(`${directory}:${options.scope === scope}`);
            return [{ name: 'frame_02' }, {}, { name: 'frame_01' }];
        },
    });

    const frames = await loadSortedSpriteFrames(loader)('image/effects/test', '测试', scope);

    assert.deepEqual(directories, ['image/effects/test:true']);
    assert.deepEqual(frames.map((frame) => frame.name), ['frame_01', 'frame_02']);
});

test('序列帧目录加载失败时返回空数组并记录目录', async () => {
    const warnings: unknown[][] = [];
    const failure = new Error('missing frames');
    const loader = createLoader({ loadDir: async () => { throw failure; } }, warnings);

    const frames = await loadSortedSpriteFrames(loader)('image/effects/test', '测试');

    assert.ok(Array.isArray(frames));
    assert.equal(frames.length, 0);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0][0], '[ZCGameLoader] 测试序列帧加载失败：image/effects/test');
    assert.equal(warnings[0][1], failure);
});
