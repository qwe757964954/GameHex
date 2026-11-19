import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { CardUnitPreviewAssets } from '../assets/script/app/card/CardUnitPreviewAssets';
import { parseCardCatalogRow } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { assetPath } from './helpers/asset-paths';

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
        assert.ok(path.startsWith('skel/'), `${path} 应为已交付的 skel 骨骼预制体`);
        const prefabPath = assetPath(`${path}.prefab`);
        assert.ok(existsSync(prefabPath), `${path} 预制体应存在`);
        assert.match(readFileSync(prefabPath, 'utf8'), /"defaultAnimation": "idle"/,
            `${path} 骨骼预制体应提供 idle`);
    }
});

test('怪物卡表的兵种预制体同样真实存在（50017 曾指向已删除的 units/阿尔萨斯）', () => {
    const packed = JSON.parse(readFileSync('assets/remoteRef/monsterCard.json', 'utf8')) as
        { k: string[]; v: unknown[][] };
    const rows = packed.v.map((values) => Object.fromEntries(packed.k.map((key, index) => [key, values[index]])));
    const paths = new Set(rows.map((row) => row.unitPrefabPath).filter((value): value is string =>
        typeof value === 'string' && value.length > 0));
    assert.ok(paths.size > 30, `怪物卡的 prefab 路径数量异常：${paths.size}`);
    for (const path of paths) {
        assert.ok(path.startsWith('skel/'), `${path} 应为已交付的 skel 骨骼预制体`);
        const prefabPath = assetPath(`${path}.prefab`);
        //  路径失效时运行时不会报错：单位照常出生、照常结算，只是**画面上什么都没有**。
        //  所以这条只能靠静态守卫兜。
        assert.ok(existsSync(prefabPath), `${path} 预制体应存在`);
        assert.match(readFileSync(prefabPath, 'utf8'), /"defaultAnimation": "idle"/,
            `${path} 骨骼预制体应提供 idle`);
    }
    //  回归点：50017 机甲菇的路径曾经是 `units/阿尔萨斯/阿尔萨斯`（目录早已删除），
    //  2026-11-18 按同名玩家卡修正。改回旧值这条会红，不必等到上线才在战场上看不见人。
    const mecha = rows.find((row) => row.id === 50017);
    assert.equal(mecha?.unitPrefabPath, 'skel/机甲菇/机甲菇');
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
