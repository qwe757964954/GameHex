import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import * as ts from 'typescript';
import { ControllerBase } from '../assets/script/framework/controller/ControllerBase';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import { ZCGamePreload } from '../assets/script/app/zcds/application/ZCGamePreload';
import { createControllerContext, createControllerResources } from './helpers/controller-context';
import { bundleForPath } from '../assets/script/core/asset/BundleCatalog';
import { spriteFramePathOf } from '../assets/script/app/ArtPaths';

function preparationFixture(failure = false) {
    const owners: ControllerBase[] = [];
    let released = 0;
    class ComponentController extends ControllerBase {
        constructor(name: string) { super(createControllerContext(), name); owners.push(this); }
    }
    const exports: Record<string, Function> = {};
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/zcds/application/ZCBattlePreparation.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports, Date, console: { info() {} }, require(name: string) {
        if (name.endsWith('/ComponentController')) return { ComponentController };
        if (name === '../ZCGame') return { MAP_DIRECTORY: 'config/maps' };
        if (name === './ZCGamePreload') return { ZCGamePreload };
        if (name === './ZCGameLoader') return { ZCGameLoader: class {
            async prepare(scope: ResourceScope) {
                scope.defer(() => released++);
                if (failure) throw new Error('battle art failed');
                return {};
            }
        } };
        throw new Error(`Unexpected import: ${name}`);
    } });
    return { create: (battle: Promise<null>) => exports.createZCBattlePreload(battle) as ZCGamePreload,
        owners, released: () => released };
}

test('战斗准备控制器随资源移交；匹配退出保持，战斗退出只释放一次', async () => {
    const h = preparationFixture();
    const preload = h.create(Promise.resolve(null));
    await preload.ready;
    const battle = new ResourceScope('battle');
    preload.transferTo(battle);
    preload.releaseFromMatching();
    assert.equal(h.owners[0].scope.disposed, false);
    battle.dispose(); battle.dispose();
    assert.equal(h.owners[0].scope.disposed, true);
    assert.equal(h.released(), 1);
});

test('回包前取消释放准备控制器，迟到回包不开始资源加载', async () => {
    const h = preparationFixture();
    let reply: (value: null) => void = () => {};
    const preload = h.create(new Promise(resolve => { reply = resolve; }));
    preload.releaseFromMatching();
    assert.equal(h.owners[0].scope.disposed, true);
    reply(null);
    await assert.rejects(preload.ready, /取消/);
    assert.equal(h.released(), 0);
});

test('准备失败同时释放已加载资源与准备控制器', async () => {
    const h = preparationFixture(true);
    const preload = h.create(Promise.resolve(null));
    await assert.rejects(preload.ready, /battle art failed/);
    assert.equal(h.owners[0].scope.disposed, true);
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
