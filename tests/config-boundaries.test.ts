import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    BIGMAP_TABLE, decompressBigMapRows, parseBigMapConfig,
} from '../assets/script/app/bigmap/model/BigMapConfig';
import { normalizeCardRow, parseCard } from '../assets/script/app/zcds/model/ZCPvpTableParser';

function rows(name: string): Array<Record<string, unknown>> {
    return decompressBigMapRows(JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')))
        .map((row) => ({ ...row }));
}

function bigMapTables(): Record<string, Array<Record<string, unknown>>> {
    return Object.fromEntries(Object.values(BIGMAP_TABLE).map((name) => [name, rows(name)]));
}

test('PVP 配置入口保持数字严格校验、可选数值与缩放默认值', () => {
    const row = normalizeCardRow(rows('pvpCard')[0]);
    const parsed = parseCard({ ...row, prefabSize: '', buildSeconds: 0 });
    assert.equal(parsed.prefabSize, 1);
    assert.equal(parsed.buildSeconds, 0);
    assert.equal(parseCard({ ...row, buildSeconds: '' }).buildSeconds, undefined);
    for (const baseHp of [String(row.baseHp), 0, -1, NaN, Infinity]) {
        assert.throws(() => parseCard({ ...row, baseHp }), /baseHp/);
    }
    for (const prefabSize of [0, -1, '1']) {
        assert.throws(() => parseCard({ ...row, prefabSize }), /prefabSize/);
    }
});

test('PVP 配置错误包含表、行标识、字段与实际值', () => {
    const row = normalizeCardRow(rows('pvpCard')[0]);
    assert.throws(() => parseCard({ ...row, id: 'broken-card', baseHp: 'wrong-hp' }),
        /pvpCard.*broken-card.*baseHp.*wrong-hp/);
});

test('SLG 旧表数字转换、取整、候选字段与缺列默认值保持原样', () => {
    const raw = bigMapTables();
    raw[BIGMAP_TABLE.world][0].npcBaseCount = '3.6';
    raw[BIGMAP_TABLE.world][0].cityRing1 = 'broken';
    assert.throws(() => parseBigMapConfig(raw), /cityRing1/);
    raw[BIGMAP_TABLE.world][0].cityRing1 = rows(BIGMAP_TABLE.world)[0].cityRing1;
    const building = raw[BIGMAP_TABLE.building][0];
    delete building.baseBuildSize;
    building.occupyHex = '2.6';
    delete building.unlockType;
    delete building.unlockParam;
    const config = parseBigMapConfig(raw);
    assert.equal(config.world.npcBaseCount, 4);
    assert.equal(config.buildings.get(Number(building.id)).occupyHex, 3);
    assert.equal(config.buildings.get(Number(building.id)).unlockType, 1);
    assert.equal(config.queue.offlineMaxHours, 8);

    building.baseBuildSize = 'broken';
    assert.throws(() => parseBigMapConfig(raw), /baseBuildSize/);
});

test('SLG 新表继续拒绝字符串、非整数和越界数值，允许合法零值', () => {
    const raw = bigMapTables();
    const camp = raw[BIGMAP_TABLE.camp][0];
    camp.warScoreRate = 0;
    assert.equal(parseBigMapConfig(raw).camps.get(Number(camp.campId)).warScoreRate, 0);
    for (const value of ['1', 1.5, 0, Number.MAX_SAFE_INTEGER + 1]) {
        camp.campSize = value;
        assert.throws(() => parseBigMapConfig(raw), /campSize/);
    }
    assert.throws(() => parseBigMapConfig(raw), /bigMapCamp.*campId.*campSize.*收到/);
});

test('据点与野怪掉落共享结构校验，错误定位到所属表和数组元素', () => {
    for (const [tableName, field] of [[BIGMAP_TABLE.camp, 'firstReward'],
        [BIGMAP_TABLE.monster, 'normalDropId']]) {
        const raw = bigMapTables();
        const row = raw[tableName][0];
        row[field] = [{ resId: 18501, number: 0, pro: 10000 }];
        assert.doesNotThrow(() => parseBigMapConfig(raw));
        for (const value of [null, {}, [null], [[]], [{ resId: 18501, number: 1, pro: 10001 }]]) {
            row[field] = value;
            assert.throws(() => parseBigMapConfig(raw), new RegExp(`${tableName}.*${field}`));
        }
        row[field] = [{ resId: 18501, number: 'wrong-count', pro: 0 }];
        assert.throws(() => parseBigMapConfig(raw),
            new RegExp(`${tableName}.*${field}\\[0\\]\\.number.*wrong-count`));
    }
});
