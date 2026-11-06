// 护栏：`bigmap` 分包 `image/` 下的每个资源条目都必须能被 `bundleForPath` 路由回 bigmap。
//
// 为什么需要：2026-11-04 `assets/bundles/bigmap/image/bigmap/` 整目录上提成
// `assets/bundles/bigmap/image/` 之后，路由表**失去前缀隔离**（不能再登记 `'image'`，
// 否则会吞掉首包 `image/buildings`、`image/common` 等），只能逐条列举。
// 漏登记的后果是「图不显示 + 零报错」：`loadBigMapArt` 的 `has()` 直接 false，
// 只有一行 warn，页面照常跑。把「忘登记」变成测试红，比事后看日志便宜。
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import test from 'node:test';
import { BIGMAP_BUNDLE, bundleForPath } from '../assets/script/core/asset/BundleCatalog.ts';

const IMAGE_ROOT = 'assets/bundles/bigmap/image';

/** 不是 SpriteFrame 资源、本来就不走 `bundleForPath` 的条目。 */
const NON_RESOURCE = new Set(['auto-atlas.pac', 'sources.json', 'manifest.json']);

/** 目录直接返回原名；图片去掉扩展名（Cocos 资源路径不带后缀）。 */
function toBundlePath(name: string): string {
    return `image/${name.replace(/\.(png|jpe?g|webp)$/i, '')}`;
}

test('bigmap 分包 image/ 下的资源条目全部登记到 BIGMAP_BUNDLE', () => {
    const entries = readdirSync(IMAGE_ROOT)
        .filter((name) => !name.endsWith('.meta') && !NON_RESOURCE.has(name));
    // `bigMapBG`（2048×2048 大背景）已刻意移到 bundle 顶层、不进 `image/` 图集子树，
    // 所以这里只剩 concept / base_background 两条，由 `bundleForPath('bigMapBG')` 单独路由。
    assert.ok(entries.length >= 2, `没扫到资源条目，目录是不是又搬了：${IMAGE_ROOT}`);
    for (const name of entries) {
        const path = toBundlePath(name);
        assert.equal(bundleForPath(path), BIGMAP_BUNDLE, `${path} 未登记到 BundleCatalog.BUNDLE_DIRECTORIES`);
    }
});
