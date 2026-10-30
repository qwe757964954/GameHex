import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { BIGMAP_TABLE, decompressBigMapRows, parseBigMapConfig } from '../assets/script/app/bigmap/model/BigMapConfig';
import { BigMapBuildingKind } from '../assets/script/app/bigmap/model/BigMapTypes';

function tables() {
    return Object.fromEntries(Object.values(BIGMAP_TABLE).map((name) => [name,
        decompressBigMapRows(JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8'))).map((row) => ({ ...row })),
    ]));
}

test('DM 新建筑表八种类型与枚举一致，23 个格子 ID 保留配置原值', () => {
    const config = parseBigMapConfig(tables());
    const kinds = [[71001, BigMapBuildingKind.Main], [71002, BigMapBuildingKind.ResourceField],
        [71007, BigMapBuildingKind.WoodField], [71012, BigMapBuildingKind.IronField],
        [71015, BigMapBuildingKind.CoinField], [71016, BigMapBuildingKind.Tech],
        [71017, BigMapBuildingKind.Function], [71018, BigMapBuildingKind.Decoration]] as const;
    for (const [id, kind] of kinds) assert.equal(config.buildings.get(id)?.kind, kind);
    assert.deepEqual([...config.buildings.values()].map((item) => item.initialCellId),
        Array.from({ length: 23 }, (_, i) => 1001 + i));
});

test('旧表缺少图片和初始格子字段时归一化为空值', () => {
    const raw = tables();
    for (const building of raw[BIGMAP_TABLE.building]) {
        delete building.baseBuildIcon;
        delete building.basebuildPositon;
    }
    const config = parseBigMapConfig(raw);
    assert.ok([...config.buildings.values()].every((item) => item.icon === '' && item.initialCellId === null));
});

test('明确配置非法类型或初始格子 ID 时在边界拒绝', () => {
    for (const [field, value] of [['baseBuildType', 9], ['basebuildPositon', -1], ['basebuildPositon', 'invalid']] as const) {
        const raw = tables();
        raw[BIGMAP_TABLE.building][0][field] = value;
        assert.throws(() => parseBigMapConfig(raw), /baseBuildType|basebuildPositon/);
    }
});
