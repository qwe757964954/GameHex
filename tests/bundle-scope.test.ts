// Bundle 分包路由与加载通道（2026-10-23 第二轮）：
// ① 路径前缀路由表（bundleForPath）正确性；② CocosAssetService 未显式 bundle 时按路径路由。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import {
    BATTLE_BUNDLE, BIGMAP_BUNDLE, MAIN_PAGES_BUNDLE, BUNDLE_DIRECTORIES, bundleForPath,
} from '../assets/script/core/asset/BundleCatalog.ts';

function load(path: string, dependencies: Record<string, unknown>) {
    const context = { exports: {} as Record<string, unknown>, require: (name: string) => dependencies[name], console };
    runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, context);
    return context.exports;
}

test('分包目录清单与路由表一致，命中前缀走对应 bundle', () => {
    assert.equal(BUNDLE_DIRECTORIES[BATTLE_BUNDLE].length, 7);
    assert.equal(BUNDLE_DIRECTORIES[BIGMAP_BUNDLE].length, 2);
    assert.ok(BUNDLE_DIRECTORIES[MAIN_PAGES_BUNDLE].length >= 20);
    // 战斗
    assert.equal(bundleForPath('units/archer/archer'), BATTLE_BUNDLE);
    assert.equal(bundleForPath('ui/game/ZCGameHUD'), BATTLE_BUNDLE);
    assert.equal(bundleForPath('image/effects/hex_ground_glow/hex_ground_glow_01'), BATTLE_BUNDLE);
    assert.equal(bundleForPath('image/map-resource/coin_icon'), BATTLE_BUNDLE);
    assert.equal(bundleForPath('image/spawn-region/frame_01'), BATTLE_BUNDLE);
    assert.equal(bundleForPath('image/gameui/whh'), BATTLE_BUNDLE);
    assert.equal(bundleForPath('image/settlement/title_victory'), BATTLE_BUNDLE);
    // 大世界
    assert.equal(bundleForPath('image/bigmap/wasteland_background'), BIGMAP_BUNDLE);
    assert.equal(bundleForPath('ui/bigmap/BigMapWorldView'), BIGMAP_BUNDLE);
    // 功能页
    assert.equal(bundleForPath('ui/Role/Role'), MAIN_PAGES_BUNDLE);
    assert.equal(bundleForPath('ui/League/LeagueTab'), MAIN_PAGES_BUNDLE);
    assert.equal(bundleForPath('image/card/card_frame'), MAIN_PAGES_BUNDLE);
    assert.equal(bundleForPath('icons/item/foo'), MAIN_PAGES_BUNDLE);
    // 首包（resources）：未登记路径必须回 undefined
    assert.equal(bundleForPath('config/maps/map_01'), undefined);
    assert.equal(bundleForPath('ui/main/ArenaRoot'), undefined);
    assert.equal(bundleForPath('image/artifact/霜封冰刃'), undefined);
    assert.equal(bundleForPath('image/buildings/hq-base'), undefined);
    assert.equal(bundleForPath('image/decor/wasteland/st2'), undefined);
    assert.equal(bundleForPath('skel/reddot/reddot'), undefined);
    assert.equal(bundleForPath('塔防/音效/点击音效'), undefined);
});

test('CocosAssetService 未显式 bundle 时按路径前缀自动路由到分包', async () => {
    const requests: { path: string; bundle: string }[] = [];
    const { CocosAssetService } = load('assets/script/platform/cocos/CocosAssetService.ts', {
        cc: {
            Asset: class {},
            resources: { name: 'resources', load() {}, loadDir() {}, getInfoWithPath: () => null },
            assetManager: {
                preloadAny: (request: { path: string; bundle: string }, _options: unknown, done: Function) => { requests.push(request); done(null, []); },
                getBundle: (name: string) => name === 'resources' ? null : { name, load() {}, loadDir() {}, getInfoWithPath: () => null },
                loadBundle: (name: string, done: Function) => { requests.push({ path: `__bundle:${name}`, bundle: name }); done(null, { name, load() {}, loadDir() {}, getInfoWithPath: () => null }); },
            },
        },
        '../../core/asset/BundleCatalog': { bundleForPath },
        '../hotupdate/CocosBundleRegistry': {},
    });
    const service = new CocosAssetService();
    // 战斗路径未显式 bundle → 自动路由 battle（preload 只发下载请求，不解析）。
    await service.preload('ui/game/ZCGameHUD', {});
    assert.deepEqual(requests.filter((r) => !r.path.startsWith('__bundle:')).map(({ path, bundle }) => ({ path, bundle })),
        [{ path: 'ui/game/ZCGameHUD', bundle: 'battle' }]);
    // 首包路径 → resources
    await service.preload('config/maps/map_01', {});
    assert.deepEqual(requests.filter((r) => !r.path.startsWith('__bundle:')).slice(-1).map(({ path, bundle }) => ({ path, bundle })),
        [{ path: 'config/maps/map_01', bundle: 'resources' }]);
    // 显式 bundle 优先于路径路由
    await service.preload('ui/main/ArenaRoot', { bundle: 'main-pages' });
    assert.deepEqual(requests.filter((r) => !r.path.startsWith('__bundle:')).slice(-1).map(({ path, bundle }) => ({ path, bundle })),
        [{ path: 'ui/main/ArenaRoot', bundle: 'main-pages' }]);
});
