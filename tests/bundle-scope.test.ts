// Bundle 分包路由与加载通道（2026-10-23 第二轮）：
// ① 路径前缀路由表（bundleForPath）正确性；② CocosAssetService 未显式 bundle 时按路径路由。
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
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
    assert.equal(BUNDLE_DIRECTORIES[BIGMAP_BUNDLE].length, 4);
    assert.ok(BUNDLE_DIRECTORIES[MAIN_PAGES_BUNDLE].length >= 20);
    // 战斗
    assert.equal(bundleForPath('units/archer/archer'), BATTLE_BUNDLE);
    assert.equal(bundleForPath('ui/game/ZCGameHUD'), BATTLE_BUNDLE);
    assert.equal(bundleForPath('image/effects/hex_ground_glow/hex_ground_glow_01'), BATTLE_BUNDLE);
    assert.equal(bundleForPath('image/map-resource/coin_icon'), BATTLE_BUNDLE);
    assert.equal(bundleForPath('image/spawn-region/frame_01'), BATTLE_BUNDLE);
    assert.equal(bundleForPath('image/gameui/whh'), BATTLE_BUNDLE);
    assert.equal(bundleForPath('image/settlement/title_victory'), BATTLE_BUNDLE);
    // 大世界（2026-11-04 bundle 内 `image/bigmap/` 上提成 `image/`，只能逐条登记）
    assert.equal(bundleForPath('image/concept/sprites/grain'), BIGMAP_BUNDLE);
    assert.equal(bundleForPath('image/concept/ui/stamina'), BIGMAP_BUNDLE);
    assert.equal(bundleForPath('image/base_background'), BIGMAP_BUNDLE);
    assert.equal(bundleForPath('bigMapBG'), BIGMAP_BUNDLE);
    assert.equal(bundleForPath('ui/bigmap/BigMapWorldView'), BIGMAP_BUNDLE);
    // ⚠️ 上提后 `image/` 前缀不再被 bigmap 独占，首包同前缀目录必须仍走 resources
    assert.equal(bundleForPath('image/conceptx/foo'), undefined);
    // 功能页
    assert.equal(bundleForPath('ui/Role/Role'), MAIN_PAGES_BUNDLE);
    assert.equal(bundleForPath('ui/League/LeagueTab'), MAIN_PAGES_BUNDLE);
    assert.equal(bundleForPath('image/card/card_frame'), MAIN_PAGES_BUNDLE);
    assert.equal(bundleForPath('image/card_lineup/yx_img_guang_01'), MAIN_PAGES_BUNDLE);
    assert.equal(bundleForPath('image/card_board/bz_bg_01'), MAIN_PAGES_BUNDLE);
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
    const cc = {
        Asset: class {},
        resources: { name: 'resources', load() {}, loadDir() {}, getInfoWithPath: () => null },
        assetManager: {
            preloadAny: (request: { path: string; bundle: string }, _options: unknown, done: Function) => { requests.push(request); done(null, []); },
            getBundle: (name: string) => name === 'resources' ? null : { name, load() {}, loadDir() {}, getInfoWithPath: () => null },
            loadBundle: (name: string, done: Function) => { requests.push({ path: `__bundle:${name}`, bundle: name }); done(null, { name, load() {}, loadDir() {}, getInfoWithPath: () => null }); },
        },
    };
    const { CocosAssetService } = load('assets/script/platform/cocos/CocosAssetService.ts', {
        cc,
        '../../core/asset/BundleCatalog': { bundleForPath },
        './AssetBundleLoader': load('assets/script/platform/cocos/AssetBundleLoader.ts', {
            cc, '../hotupdate/CocosBundleRegistry': { CocosBundleRegistry: { resolve: () => undefined } },
        }),
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

/**
 * 反向守卫：分包里**每个可加载资源**都必须被路由表命中。
 *
 * 2026-11-10 踩到：新弹窗放 `bundles/main-pages/ui/ItemInfo/`，路由表没登记 `ui/ItemInfo`
 * ⇒ `bundleForPath` 回 `undefined` ⇒ `CocosAssetService` 去 resources 里找
 * `ui/ItemInfo/ItemInfo`，运行时报 `Bundle resources doesn't contain ...`，
 * 而**单测与构建都不报**，只有真点到那个按钮才炸。
 *
 * 判据按**资源路径（去扩展名）**逐个判，不按目录：`image/base_background.jpg` 这种
 * 「文件直接落在容器目录、登记的是完整文件名前缀」的情况也才对得上；
 * `auto-atlas.pac` / `sources.json` 是构建产物，不作为可加载路径，跳过。
 */
test('分包里每个可加载资源都必须登记到 BUNDLE_DIRECTORIES（漏了运行时落回 resources）', () => {
    const RESOURCE_EXT = new Set([
        '.prefab', '.scene', '.png', '.jpg', '.json', '.anim', '.skel', '.effect',
        '.plist', '.atlas', '.txt', '.mp3', '.ogg', '.fnt', '.spine', '.bin',
    ]);
    const IGNORED_FILES = new Set(['auto-atlas.pac', 'sources.json']);
    const bundles: [string, string][] = [
        [BATTLE_BUNDLE, 'assets/bundles/battle'],
        [BIGMAP_BUNDLE, 'assets/bundles/bigmap'],
        [MAIN_PAGES_BUNDLE, 'assets/bundles/main-pages'],
    ];
    const misses: string[] = [];
    for (const [bundle, root] of bundles) {
        const walk = (dir: string): void => {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                if (entry.isDirectory()) {
                    walk(join(dir, entry.name));
                    continue;
                }
                const name = entry.name;
                if (name.endsWith('.meta') || IGNORED_FILES.has(name)) continue;
                const ext = extname(name).toLowerCase();
                if (!RESOURCE_EXT.has(ext)) continue;
                // 加载路径不带扩展名（`image/iteminfo/xxx`）
                const rel = relative(root, join(dir, name)).split(sep).join('/').slice(0, -ext.length);
                if (bundleForPath(rel) !== bundle) misses.push(`${bundle}:${rel}`);
            }
        };
        walk(root);
    }
    assert.deepEqual(misses, [], '这些资源没被 BUNDLE_DIRECTORIES 命中，运行时按路径加载会落回 resources');
});
