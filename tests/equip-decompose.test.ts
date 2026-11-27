import assert from 'node:assert/strict';
import test from 'node:test';
import {
    EQUIP_DECOMPOSE_DEFAULT_GAIN_PER,
    EQUIP_DECOMPOSE_MAX,
    autoSelectDecompose,
    decomposeFitsFilter,
    decomposeMissingIds,
    decomposeRankOptions,
    equipDecomposeGain,
    normalizeDecomposeIds,
    summarizeDecompose,
    toggleDecomposeSelection,
    type IEquipDecomposeFacts,
} from '../assets/script/app/role/EquipDecomposeTable';

const facts = (index: number, overrides: Partial<IEquipDecomposeFacts> = {}): IEquipDecomposeFacts => ({
    uniqueId: String(1000000000 + index),
    rank: 3,
    quality: 4,
    decompose: 41,
    equipped: false,
    ...overrides,
});

test('单件分解收益 = 品阶基础返还 + 养成投入的 70%', () => {
    // 老端 `equipRank[rank, baseQuality].decompose` + floor(costNum * 70 / 100)
    assert.equal(equipDecomposeGain(5, 760), 5 + 532);
    assert.equal(equipDecomposeGain(3, 1200), 3 + 840);
    // 缺失 / 负数 / 非整数按 0 收口，不产生负收益
    assert.equal(equipDecomposeGain(0, 0), 0);
    assert.equal(equipDecomposeGain(-3, -70), 0);
    assert.equal(equipDecomposeGain(1.9, 9.9), 1 + 6);
    // 配置缺行时用默认 70%，不能变成 0 收益
    assert.equal(equipDecomposeGain(2, 100, 0), 2 + 70);
    assert.equal(equipDecomposeGain(2, 100, Number.NaN), 2 + Math.floor(100 * EQUIP_DECOMPOSE_DEFAULT_GAIN_PER / 100));
});

test('筛选按「N 阶及以下 / 品质及以下」收口，-1 表示不筛', () => {
    assert.equal(decomposeFitsFilter(3, 4, { rank: 3, quality: 4 }), true);
    assert.equal(decomposeFitsFilter(4, 4, { rank: 3, quality: 4 }), false);
    assert.equal(decomposeFitsFilter(3, 5, { rank: 3, quality: 4 }), false);
    assert.equal(decomposeFitsFilter(6, 7, { rank: -1, quality: -1 }), true);
    assert.equal(decomposeFitsFilter(6, 7, { rank: -1, quality: 4 }), false);
    assert.equal(decomposeFitsFilter(6, 2, { rank: 3, quality: -1 }), false);
    // 品质是展示品质 1..7（不是 curQuality 的品质档 1..17）
    assert.equal(decomposeFitsFilter(20, 4, { rank: -1, quality: 4 }), true);
    assert.equal(decomposeFitsFilter(20, 4, { rank: -1, quality: 7 }), true);
    assert.equal(decomposeFitsFilter(20, 5, { rank: -1, quality: 4 }), false);
});

test('阶筛选只列背包实际出现的阶：去重、升序、跳过已穿戴 / 空 id / 非法阶', () => {
    const entries = [
        facts(0, { rank: 3 }),
        facts(1, { rank: 1 }),
        facts(2, { rank: 3 }),
        facts(3, { rank: 20 }),
        facts(4, { rank: 7, equipped: true }),
        facts(5, { rank: 9, uniqueId: '' }),
        facts(6, { rank: 0 }),
        facts(7, { rank: Number.NaN }),
    ];
    assert.deepEqual(decomposeRankOptions(entries), [1, 3, 20]);
    assert.deepEqual(decomposeRankOptions([]), []);
    assert.deepEqual(decomposeRankOptions([facts(8, { equipped: true })]), []);
});

test('自动全选跳过已穿戴装备，按背包顺序截到 99 件', () => {
    const entries = Array.from({ length: 200 }, (_, index) => facts(index, {
        // 每 10 件塞一件已穿戴，验证不会把身上装备勾进去
        equipped: index % 10 === 0,
    }));
    const selected = autoSelectDecompose(entries, { rank: 3, quality: 4 });
    assert.equal(selected.length, EQUIP_DECOMPOSE_MAX);
    assert.equal(selected.includes(entries[0].uniqueId), false);
    // 前 99 个未穿戴且落筛选的 id，顺序与 entries 一致
    const expected = entries
        .filter(entry => !entry.equipped && decomposeFitsFilter(entry.rank, entry.quality, { rank: 3, quality: 4 }))
        .slice(0, EQUIP_DECOMPOSE_MAX)
        .map(entry => entry.uniqueId);
    assert.deepEqual(selected, expected);
});

test('勾选：再点取消；未满 99 加入；满 99 返回 limit 且不改数组', () => {
    const full = Array.from({ length: EQUIP_DECOMPOSE_MAX }, (_, index) => `id-${index}`);
    const rejected = toggleDecomposeSelection(full, 'id-new');
    assert.equal(rejected.rejected, 'limit');
    assert.deepEqual(rejected.selected, full);

    const partial = ['a', 'b'];
    assert.deepEqual(toggleDecomposeSelection(partial, 'c'), { selected: ['a', 'b', 'c'], rejected: null });
    assert.deepEqual(toggleDecomposeSelection(partial, 'b'), { selected: ['a'], rejected: null });
    // 原数组不被修改
    assert.deepEqual(partial, ['a', 'b']);
    assert.deepEqual(toggleDecomposeSelection(partial, ''), { selected: ['a', 'b'], rejected: null });
});

test('收益汇总去重、跳过已穿戴与未知 id，并跟随背包顺序', () => {
    const entries = [
        facts(0, { uniqueId: '11', decompose: 10 }),
        facts(1, { uniqueId: '12', decompose: 20, equipped: true }),
        facts(2, { uniqueId: '13', decompose: 30 }),
    ];
    const summary = summarizeDecompose(entries, ['13', '11', '13', '99']);
    assert.deepEqual(summary.ids, ['11', '13']);
    assert.equal(summary.count, 2);
    assert.equal(summary.gain, 40);
    assert.deepEqual(summarizeDecompose(entries, []), { ids: [], count: 0, gain: 0 });
    // 超过 99 只取前 99 件，收益同步截断
    const many = Array.from({ length: 120 }, (_, index) => facts(index, { decompose: 1 }));
    const capped = summarizeDecompose(many, many.map(entry => entry.uniqueId));
    assert.equal(capped.count, EQUIP_DECOMPOSE_MAX);
    assert.equal(capped.gain, EQUIP_DECOMPOSE_MAX);
});

test('请求前 id 规范化：去空、去重、截到 99 件', () => {
    assert.deepEqual(normalizeDecomposeIds(['', ' 1 ', 1, '2', '2', '3']), ['1', '2', '3']);
    const many = Array.from({ length: 120 }, (_, index) => String(index));
    assert.equal(normalizeDecomposeIds(many).length, EQUIP_DECOMPOSE_MAX);
    assert.deepEqual(normalizeDecomposeIds([]), []);
});

test('整包回包缺件时只补发未确认的 id，保持请求顺序', () => {
    assert.deepEqual(decomposeMissingIds(['1', '2', '3', '4'], ['2', '4']), ['1', '3']);
    // 回包里的多余 id 不影响；空回包 = 全部补发
    assert.deepEqual(decomposeMissingIds(['1', '2'], ['9']), ['1', '2']);
    assert.deepEqual(decomposeMissingIds(['1', '2'], []), ['1', '2']);
    assert.deepEqual(decomposeMissingIds([], ['1']), []);
});
