import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { BIGMAP_BUILDING_ART, BIGMAP_CONCEPT_ROOT, BIGMAP_UI_KEYS } from '../assets/script/app/bigmap/application/BigMapArtCatalog';

const root = join('assets/resources', BIGMAP_CONCEPT_ROOT);

test('26 张设计切图与清单一致，建筑和 UI 保持真实透明通道', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
    assert.equal(manifest.assets.length, 26);
    assert.equal(new Set(manifest.assets.map((asset: { path: string }) => asset.path)).size, 26);
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
    for (const name of Object.values(BIGMAP_BUILDING_ART)) assert.ok(existsSync(join(root, 'sprites', `${name}.png`)), name);
    for (const name of BIGMAP_UI_KEYS) assert.ok(existsSync(join(root, 'ui', `${name}.png`)), name);
    for (const name of ['grain', 'wood', 'iron', 'coin', 'fortress', 'mutant_camp']) {
        assert.ok(existsSync(join(root, 'sprites', `${name}.png`)), name);
    }
    assert.ok(existsSync('assets/resources/image/bigmap/auto-atlas.pac'));
    for (const directory of [root, join(root, 'sprites'), join(root, 'ui')]) {
        assert.equal(existsSync(join(directory, 'auto-atlas.pac')), false, directory);
    }
});
