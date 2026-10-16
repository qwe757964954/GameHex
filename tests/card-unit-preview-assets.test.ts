import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { CardUnitPreviewAssets } from '../assets/script/app/card/CardUnitPreviewAssets';
import { parseCardCatalogRow } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';

test('卡表解析保留兵种预制体路径，阵容页无需依赖对局单位目录缓存', () => {
    const packed = JSON.parse(readFileSync('assets/remoteRef/pvpCard.json', 'utf8')) as
        { k: string[]; v: unknown[][] };
    const row = packed.v.map((values) => Object.fromEntries(packed.k.map((key, index) => [key, values[index]])))
        .find((card) => card.id === 68001);
    assert.ok(row);
    assert.equal(parseCardCatalogRow(row).unitPrefabPath, 'skel/豌豆射手/豌豆射手');
});

test('卡表中的上阵兵种预制体均有待机动作', () => {
    const packed = JSON.parse(readFileSync('assets/remoteRef/pvpCard.json', 'utf8')) as
        { k: string[]; v: unknown[][] };
    const rows = packed.v.map((values) => Object.fromEntries(packed.k.map((key, index) => [key, values[index]])));
    const paths = new Set(rows.map((row) => row.unitPrefabPath).filter((value): value is string =>
        typeof value === 'string' && value.length > 0));
    assert.ok(paths.size > 0);
    for (const path of paths) {
        const prefabPath = `assets/resources/${path}.prefab`;
        assert.ok(existsSync(prefabPath), `${path} 预制体应存在`);
        if (path.startsWith('skel/')) {
            assert.match(readFileSync(prefabPath, 'utf8'), /"defaultAnimation": "idle"/,
                `${path} 骨骼预制体应提供 idle`);
        } else {
            const folder = `assets/resources/${path.slice(0, path.lastIndexOf('/'))}/anim`;
            assert.ok(readdirSync(folder).some((name) => name.endsWith('-idle.anim')),
                `${path} 序列帧预制体应提供 idle`);
        }
    }
});

test('上阵预览按兵种预制体路径加载并复用，同一兵种只加载一次', async () => {
    const paths: string[] = [];
    const prefab = { name: 'unit-prefab' };
    const assets = new CardUnitPreviewAssets(
        async (path) => { paths.push(path); return prefab; },
    );

    const [first, second] = await Promise.all([
        assets.load({ unitId: '68001', unitPrefabPath: 'skel/豌豆射手/豌豆射手' }),
        assets.load({ unitId: '68001', unitPrefabPath: 'skel/豌豆射手/豌豆射手' }),
    ]);
    assert.equal(first, prefab);
    assert.equal(second, prefab);
    assert.deepEqual(paths, ['skel/豌豆射手/豌豆射手']);
    assert.equal(await assets.load({}), null);
});

test('兵种预制体缺失时上阵预览返回空，由站台显示静态图', async () => {
    const assets = new CardUnitPreviewAssets(
        async () => { throw new Error('missing'); },
    );
    assert.equal(await assets.load({ unitId: '68001', unitPrefabPath: 'skel/missing' }), null);
    assert.equal(await assets.load({ unitId: 'unknown' }), null);
});
