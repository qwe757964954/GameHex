import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
    BIGMAP_BASE_FALLBACK_ART, BIGMAP_CONCEPT_ROOT, BIGMAP_STAMINA_ART,
} from '../assets/script/app/bigmap/application/BigMapArtCatalog';
import { assetPath } from './helpers/asset-paths';

const root = assetPath(BIGMAP_CONCEPT_ROOT);

test('清单只剩体力图标，切图与清单一致，保持真实透明通道', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
    // 2026-11-12 第一刀：9 张基地/世界旧概念图（barracks/farm/fortress/headquarters/ironworks/
    // mutant_camp/sawmill/warehouse/water_tower）随新美术删库，清单同步裁到 16 条。
    // 2026-11-12 第二刀：8 张零消费 UI 件（header/detail/button/tab_idle/tab_active/badge/plot/home）
    // 已经 uuid 反查（prefab/scene/json 零命中）后连 PNG 一起删，清单裁到 8 条；只剩 stamina。
    // 2026-11-26 第三刀：`sprites/` 7 张切片整目录删除（`W-物品表` 18501-18504 改指 `concept/ui/top_*`，
    // 顶栏金币也改绑 `top_coin`），清单裁到 1 条。
    assert.equal(manifest.assets.length, 1);
    assert.equal(new Set(manifest.assets.map((asset: { path: string }) => asset.path)).size, 1);
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
    // 2026-11-12：`BIGMAP_UI_KEYS` 那 8 张（header/detail/button/tab_*/badge/plot/home）零消费，
    // 已从加载链摘除并**连 PNG 一起删**；只剩 `stamina` 还被资源图标兜底用 —— 就钉这一张。
    assert.equal(BIGMAP_STAMINA_ART, `${BIGMAP_CONCEPT_ROOT}/ui/stamina`);
    assert.ok(existsSync(assetPath(`${BIGMAP_STAMINA_ART}.png`)), BIGMAP_STAMINA_ART);
    // 2026-11-26 第三刀：`sprites/` 整目录删除（item 表 18501-18504 已改指 `concept/ui/top_*`，
    // 顶栏金币改绑 `top_coin`）—— 资源图标兜底与顶栏同源，钉这 5 张，删一张就集体失图。
    for (const name of ['top_grain', 'top_wood', 'top_iron', 'top_coin', 'top_stamina']) {
        assert.ok(existsSync(join(root, 'ui', `${name}.png`)), name);
    }
    // 自动图集只能贴在 bundle 的 `image/` 根上（`bigmap` 分包内路径，2026-11-04 上提后少一层 `bigmap`）。
    // 这里**不能用 `assetExists`** —— 它按分包根顺序探测，会先命中 main-pages 的同名 pac，断言就失去意义。
    assert.ok(existsSync('assets/bundles/bigmap/image/auto-atlas.pac'));
    for (const directory of [root, join(root, 'sprites'), join(root, 'ui')]) {
        assert.equal(existsSync(join(directory, 'auto-atlas.pac')), false, directory);
    }
});
