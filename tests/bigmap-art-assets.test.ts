import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { BIGMAP_BASE_FALLBACK_ART, BIGMAP_CONCEPT_ROOT, BIGMAP_UI_KEYS } from '../assets/script/app/bigmap/application/BigMapArtCatalog';
import { assetPath } from './helpers/asset-paths';

const root = assetPath(BIGMAP_CONCEPT_ROOT);

test('16 张在用设计切图与清单一致，建筑和 UI 保持真实透明通道', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
    // 2026-11-12：9 张基地/世界旧概念图（barracks/farm/fortress/headquarters/ironworks/
    // mutant_camp/sawmill/warehouse/water_tower）随新美术删库，清单同步裁到 16 条。
    assert.equal(manifest.assets.length, 16);
    assert.equal(new Set(manifest.assets.map((asset: { path: string }) => asset.path)).size, 16);
    for (const asset of manifest.assets) {
        const bytes = readFileSync(join(root, asset.path));
        assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256, asset.path);
        assert.equal(bytes.readUInt32BE(16), asset.size[0], asset.path);
        assert.equal(bytes.readUInt32BE(20), asset.size[1], asset.path);
        if (asset.path !== 'base_ground.png') assert.equal(bytes[25], 6, `${asset.path} 必须是 RGBA PNG`);
        assert.ok(existsSync(join(root, `${asset.path}.meta`)), `${asset.path} 未经 Cocos 导入`);
    }
});

test('实际配置建筑与所有运行时图标均有资源，自动图集只放在最外层', () => {
    // 通用建筑兜底图放在 resources 下（不走 concept 目录）。
    assert.equal(BIGMAP_BASE_FALLBACK_ART, 'image/buildings/camp_outpost');
    for (const name of BIGMAP_UI_KEYS) assert.ok(existsSync(join(root, 'ui', `${name}.png`)), name);
    // 剩下的 7 张 sprites：4 张资源图标 + 3 张基地/地形（建造中、石头、草）。
    for (const name of ['grain', 'wood', 'iron', 'coin', 'construction', 'rocks', 'grass']) {
        assert.ok(existsSync(join(root, 'sprites', `${name}.png`)), name);
    }
    // 自动图集只能贴在 bundle 的 `image/` 根上（`bigmap` 分包内路径，2026-11-04 上提后少一层 `bigmap`）。
    // 这里**不能用 `assetExists`** —— 它按分包根顺序探测，会先命中 main-pages 的同名 pac，断言就失去意义。
    assert.ok(existsSync('assets/bundles/bigmap/image/auto-atlas.pac'));
    for (const directory of [root, join(root, 'sprites'), join(root, 'ui')]) {
        assert.equal(existsSync(join(directory, 'auto-atlas.pac')), false, directory);
    }
});
