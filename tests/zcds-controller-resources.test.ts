import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import * as ts from 'typescript';
import { ControllerBase } from '../assets/script/framework/controller/ControllerBase';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import { loadBattlePreparation } from './helpers/battle-composition';
import type { ZCBattleController } from '../assets/script/app/zcds/application/ZCBattleController';
import { createControllerContext, createControllerResources } from './helpers/controller-context';
import { bundleForPath } from '../assets/script/core/asset/BundleCatalog';
import { spriteFramePathOf } from '../assets/script/app/ArtPaths';

function preparationFixture(failure = false) {
    const context = createControllerContext();
    let released = 0;
    const preparation = loadBattlePreparation({
        '../ZCGame': { MAP_DIRECTORY: 'config/maps' },
        './ZCBattleEntryBuilder': { buildZCBattleEntry() {}, resolveZCBattlePlayerCount() {} },
        '../../territory/application/TerritorySaveStoreAdapter': { createTerritorySaveStore() {} },
        './ZCGameLoader': { ZCGameLoader: class {
            async prepare(scope: ResourceScope) {
                scope.defer(() => released++);
                if (failure) throw new Error('battle art failed');
                return {};
            }
        } },
    });
    const source = new ResourceScope('map-entry');
    return { create: (battle: Promise<null>) => preparation.createZCBattleSession(context, { owner: source, battle }) as ZCBattleController<never>,
        source, released: () => released };
}

test('准备会话在战斗流程接管后保持资源，来源退出不释放，战斗退出只释放一次', async () => {
    const h = preparationFixture();
    const session = h.create(Promise.resolve(null));
    await session.ready;
    const battle = new ResourceScope('battle');
    await session.adopt(undefined, { resources: battle, cancelled: false });
    h.source.dispose();
    assert.equal(session.scope.disposed, false);
    battle.dispose(); battle.dispose();
    assert.equal(session.scope.disposed, true);
    assert.equal(h.released(), 1);
});

test('回包前取消释放同一会话，迟到回包不开始资源加载', async () => {
    const h = preparationFixture();
    let reply: (value: null) => void = () => {};
    const session = h.create(new Promise(resolve => { reply = resolve; }));
    h.source.dispose();
    assert.equal(session.scope.disposed, true);
    reply(null);
    await assert.rejects(session.ready, /取消/);
    assert.equal(h.released(), 0);
});

test('准备失败立即释放会话持有的资源', async () => {
    const h = preparationFixture(true);
    const session = h.create(Promise.resolve(null));
    await assert.rejects(session.ready, /battle art failed/);
    assert.equal(session.scope.disposed, true);
    assert.equal(h.released(), 1);
});

test('结算补图只通过控制器加载配置和分包资源，释放后不再加载', async () => {
    const context = createControllerContext();
    const paths: string[] = [], tables: string[] = [];
    const resources = createControllerResources(context);
    context.configs.getTable = async name => { tables.push(name); return []; };
    context.assets.load = async (path, Type, options) => {
        assert.equal(options?.scope, resources.scope);
        assert.equal(options?.bundle, bundleForPath(path));
        paths.push(path);
        return new Type();
    };
    const exports: Record<string, Function> = {};
    const legacy = () => { throw new Error('不能走公共全局加载入口'); };
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/showReward/RewardFrames.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports, console, require(name: string) {
        if (name === 'cc') return { SpriteFrame: class {} };
        if (name.endsWith('/BundleCatalog')) return { bundleForPath };
        if (name === '../ArtPaths') return { spriteFramePathOf };
        if (name.endsWith('/RefUtil')) return { RefUtil: { instance: { getRefAllAsync: legacy } } };
        if (name.endsWith('/ItemDetailArtLoader')) return {
            loadItemIconArt: legacy, loadQualityFrameArt: legacy,
            idFramePathOf: (path: string) => spriteFramePathOf(`image/${path}`),
        };
        if (name.endsWith('/ItemDetailArt')) return { qualityFrameArtPath: () => 'common/cu_quality_01' };
        if (name.endsWith('/ItemDetailTable')) return { qualityFrameSuffixOf: () => '01' };
        if (name.endsWith('/LayerActivityTable')) return { parseItemRows: () => new Map(), parseRolePropertyRows: () => new Map() };
        if (name === './ShowRewardTable') return {
            parseCmdGoodsList: (raw: unknown) => raw, rewardEntryOf: (entry: unknown) => entry,
            sortRewardEntries: (entries: unknown) => entries,
        };
        throw new Error(`Unexpected import: ${name}`);
    } });
    await exports.resolveCmdGoodsFrames([{ quality: 1, iconPath: 'icons/item/probe' }], resources);
    assert.deepEqual(tables, ['item', 'roleProperty']);
    assert.deepEqual(paths, ['image/common/cu_quality_01/spriteFrame', 'icons/item/probe/spriteFrame']);
    resources.scope.dispose();
    await assert.rejects(resources.assets.load('icons/item/probe/spriteFrame', class {}), /disposed|释放/);
    assert.equal(paths.length, 2);
});
