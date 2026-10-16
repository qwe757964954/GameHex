import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createSeededRandom } from '../assets/script/app/zcds/model/ZCSeededRandom';
import { ZCGameModel } from '../assets/script/app/zcds/model/ZCGameModel';
import { configureZCMap } from '../assets/script/app/zcds/model/ZCMapConfig';
import type { ZCMapLayout } from '../assets/script/app/zcds/model/ZCMapConfig';
import { loadPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import type { ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import type { ZCPvpTileType } from '../assets/script/app/zcds/model/ZCPvpTileRules';

// 初始地块分布要查 `PVP-全局` 的 rules 与地块权重（`getPvpRuntimeRules()` 在未注入时直接抛），
// 口径与 `zcds-state-consistency.test.ts` 一致：11 张表从 remoteRef 读，地图用固定夹具。
//  `pvpUnit` 已于 2026-09-20 并入 `pvpCard`，表已下线。
const TABLE_NAMES = [
    'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams', 'pvpBaseTeamWeight',
] as const;
const tables = Object.fromEntries(TABLE_NAMES.map((name) => {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8'));
    return [name, Array.isArray(source) ? source : source.v.map((row: unknown[]) => (
        Object.fromEntries(source.k.map((key: string, index: number) => [key, row[index]]))
    ))];
})) as unknown as ZCPvpTables;
loadPvpTables(tables);
configureZCMap(JSON.parse(readFileSync('tests/fixtures/zcds-legacy-map.json', 'utf8')) as ZCMapLayout);

test('同一种子播放同一条序列（逐位相同）', () => {
    for (const seed of ['1', '42', '1234567890123456789', '18446744073709551615']) {
        const left = createSeededRandom(seed);
        const right = createSeededRandom(seed);
        const a = Array.from({ length: 64 }, () => left());
        const b = Array.from({ length: 64 }, () => right());
        assert.deepEqual(a, b, `种子 ${seed} 的两条序列必须逐位相同`);
    }
});

test('相邻的 uint64 种子必须分岔（靠 Number 就会撞在一起）', () => {
    // 两对**前提**是 `Number(a) === Number(b)` 的相邻种子：`2^53` 与 `2^64-1` 附近各一对。
    // 本实现按十进制字符串取种子（不经过浮点），所以这两对必须给出不同序列 ——
    // 这正是「不能 `Number(seed)` 再播种」这条约束的回归防线。
    const pairs: ReadonlyArray<readonly [string, string]> = [
        ['9007199254740992', '9007199254740993'],
        ['18446744073709551615', '18446744073709551614'],
    ];
    for (const [a, b] of pairs) {
        assert.equal(Number(a), Number(b), `${a} / ${b} 转为 number 应当相等（本用例的前提）`);
        const genA = createSeededRandom(a);
        const genB = createSeededRandom(b);
        const left = Array.from({ length: 8 }, () => genA());
        const right = Array.from({ length: 8 }, () => genB());
        assert.notDeepEqual(left, right, `相邻种子 ${a} / ${b} 必须给出不同序列`);
    }
});

test('不同种子给出不同序列', () => {
    const seeds = ['1', '2', '3', '100', '1000', 'abc', '001'];
    const rows = seeds.map((seed) => {
        const gen = createSeededRandom(seed);
        return Array.from({ length: 8 }, () => gen()).join(',');
    });
    assert.equal(new Set(rows).size, seeds.length, '每个种子都应给出互不相同的序列');
});

test('没有种子 / 空白种子退回 Math.random（行为与接入前逐位一致）', () => {
    for (const empty of [null, undefined, '', '   ']) {
        assert.equal(createSeededRandom(empty), Math.random, `${String(empty)} 应退回 Math.random 本身`);
    }
});

test('取值落在 [0, 1)，分布不退化', () => {
    const gen = createSeededRandom('18446744073709551615');
    const count = 20000;
    const distinct = new Set<number>();
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let sum = 0;
    for (let index = 0; index < count; index += 1) {
        const value = gen();
        assert.ok(value >= 0 && value < 1, `越界值：${value}`);
        min = Math.min(min, value);
        max = Math.max(max, value);
        sum += value;
        distinct.add(value);
    }
    assert.equal(distinct.size, count, `不应出现重复值（常量或短周期），实际去重后 ${distinct.size} 个`);
    const mean = sum / count;
    assert.ok(mean > 0.45 && mean < 0.55, `均值应接近 0.5，实际 ${mean}`);
    assert.ok(min < 0.01 && max > 0.99, `应覆盖两端，实际 [${min}, ${max}]`);
});

test('种子决定开局：同种子同一份初始地块，不同种子必然分岔', () => {
    const tileTypes = (seed: string | null): Array<ZCPvpTileType | null> => new ZCGameModel(null, createSeededRandom(seed))
        .snapshot.hexes.map((hex) => hex.tileType);

    const baseline = tileTypes('1234567890123456789');
    assert.ok(baseline.length > 0, '初始快照必须带地块');
    assert.deepEqual(tileTypes('1234567890123456789'), baseline, '同一种子两次构建必须是同一份开局');

    // 不指定「哪两个种子必须不同」（那会把用例绑死在抽签结果上），只要求**存在**差异 ——
    // 若没有任何差异，说明随机源根本没被播种。
    const rows = ['1', '2', '3', '18446744073709551615'].map(tileTypes);
    assert.ok(
        rows.some((row) => row.join(',') !== baseline.join(',')),
        '不同种子必须能给出不同开局（否则播种没生效）',
    );
});

test('对局只有一个随机源构造点，且用的是本局种子', () => {
    const source = readFileSync('assets/script/app/zcds/ZCGame.ts', 'utf8');
    assert.ok(
        /this\.matchRandom = createSeededRandom\(this\.battleSeed\)/.test(source)
            && /new ZCGameModel\(null, this\.matchRandom, matchConfig\)/.test(source),
        'ZCGame 必须用本局种子构造随机源并交给 ZCGameModel',
    );
    assert.equal(
        (source.match(/createSeededRandom\(/g) ?? []).length,
        1,
        '随机源只能有这一个构造点 —— 别处再 new 一份就不再是「整局同一条流」',
    );
});
