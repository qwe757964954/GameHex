/**
 * 章节格子 bitSet 的回归网（协议 `CmdCityChapterCellInfoRspMsg`）。
 *
 * 四段：
 *   A. 往返一致性 —— `decode(encode(ids))` 必须还原去重排序后的 `ids`。
 *   B. 位边界 —— 格子 0/31/32/63/64/65/127/128。其中 **63 是 uint64 的最高位**，
 *      也是全部实现最容易错的地方（`1 << 31` 是负数、`>>> 0` 会截断）。
 *   C. 两种 uint64 形状 —— **Long（{low, high}）是本工程的真实形态**
 *      （protobufjs@7.6.2 自带 util.Long，实测已确认）；number 作为防御路径也认。
 *   D. 坏数据不静默吞掉 —— 半截格子集比全空更糟（会凭空吃掉玩家已通关的领地）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    decodeCellBitSet,
    emptyCellState,
    encodeCellBitSet,
    isRewardClaimed,
    MAX_BITSET_WORDS,
    MAX_EXACT_CELL_IN_NUMBER,
} from '../assets/script/app/territory/model/TerritoryCellBitSet';

// ── A. 往返一致性 ──────────────────────────────────────────────────────

test('bitSet 往返：任意格子集合 encode → decode 后完全还原（升序去重）', () => {
    const cases: number[][] = [
        [],
        [0],
        [0, 1, 2],
        [1, 5, 9, 13],
        [63, 64, 65],
        [0, 63, 64, 127, 128, 191, 192],
        [5, 5, 5],
    ];
    for (const cells of cases) {
        const expected = [...new Set(cells)].sort((a, b) => a - b);
        const decoded = decodeCellBitSet(encodeCellBitSet(cells));
        assert.deepEqual(decoded.cells, expected, `cells=${JSON.stringify(cells)} 往返失败`);
        assert.equal(decoded.reason, undefined, '不该报解析失败');
    }
});

test('空集合 encode 成 [] 而不是 [0]（否则服务端会凭空多出格子 0）', () => {
    assert.deepEqual(encodeCellBitSet([]), []);
    assert.deepEqual(encodeCellBitSet(null as never), []);
    assert.deepEqual(decodeCellBitSet([]).cells, []);
    // null / undefined（服务端没给这个字段）当"空集合"，不是错误。
    assert.deepEqual(decodeCellBitSet(null).cells, []);
    assert.deepEqual(decodeCellBitSet(undefined).cells, []);
});

// ── B. 位边界 ─────────────────────────────────────────────────────────

test('位边界：32 / 64 位分界两侧的格子各自落在正确的 word 里', () => {
    const probes = [0, 1, 31, 32, 33, 62, 63, 64, 65, 126, 127, 128, 129];
    const decoded = decodeCellBitSet(encodeCellBitSet(probes));
    assert.deepEqual(decoded.cells, probes);
    // 每个格子只能出现在**一个** word 里（否则往返会多出重复格）。
    assert.equal(decoded.cells!.length, probes.length);
});

test('★格子 63（uint64 最高位）必须无损：2^63 超出 JS number 精度', () => {
    // 前提：2^63 = 9223372036854776000 > Number.MAX_SAFE_INTEGER（9007199254740991）
    // ⇒ 单个 JS number 承载不了第 63 位。
    assert.ok(Math.pow(2, 63) > Number.MAX_SAFE_INTEGER, '前提：2^63 确实超出 JS number 精度');
    const words = encodeCellBitSet([63]);
    assert.equal(words.length, 1);
    // ★ 编码必须产出 Long 形态（本工程的真实形状），否则往返会撞上解码的 number 安全区。
    assert.equal(typeof words[0], 'object', '编码产出必须是 Long 形态 {low, high}');
    // 语义核对：low 半（bit 0..31）全空、high 半的第 31 位 = 2^31。
    assert.equal(words[0].low, 0, 'low 32 位应全空');
    assert.equal(words[0].high, 2 ** 31, 'high 的第 31 位应置位');
    assert.equal(words[0].unsigned, true);
    // 往返：格子 63 一格不差。
    assert.deepEqual(decodeCellBitSet(words).cells, [63]);
    // Long 的 high 是**有符号** 32 位（-2^31 表示 2^31 那一位）⇒ 该形态也必须认。
    assert.deepEqual(decodeCellBitSet([{ low: 0, high: -2147483648, unsigned: true }]).cells, [63]);
});

test('格子 63 与 0 同在一个 word 时，低位不能被高位挤掉', () => {
    // ⚠️ 这条专门盯「一个 word 值超过 2^53 后连低位都不可信」这个坑：
    //   word 覆盖 64 格，格子 53 以上就把值顶出 2^53 ⇒ 用 `word % 2^32` 取低位
    //   会得到错误值（实测丢格子 0/1/64/65）。low / high 分开存就完全避开。
    const cells = [0, 1, 62, 63, 64, 65];
    const words = encodeCellBitSet(cells);
    assert.deepEqual(decodeCellBitSet(words).cells, cells, '高低位必须一格不差');
    // 逐 word 核对形状：格子 0/1/30/31 在 word0 的low，62/63 在 word0 的 high，
    // 64/65 在 word1 的 low。
    assert.equal(words.length, 2);
    // 格子 0/1 在 word0.low 的 bit0/bit1；格子 62/63 在 word0.high 的 bit30/bit31
    //（62 = 32 + 30）；格子 64/65 在 word1.low 的 bit0/bit1。
    assert.equal(words[0].low, 1 + 2, '格子 0/1 在 word0 的低位');
    assert.equal(words[0].high, Math.pow(2, 30) + Math.pow(2, 31), '格子 62/63 在 word0 的 high');
    assert.equal(words[1].low, 1 + 2, '格子 64/65 落在第二个 word 的低位');
    assert.equal(words[1].high, 0);
});

// ── C. 两种 uint64 形状 ────────────────────────────────────────────────

test('两种 uint64 形状都要认：Long（工程真实形态）与 number（防御路径）', () => {
    // 本工程 runtime 是 protobufjs@7.6.2，自带 util.Long ⇒ 真实形态是 Long 对象。
    assert.deepEqual(decodeCellBitSet([{ low: 0b1011, high: 0, unsigned: true }]).cells, [0, 1, 3]);
    // high = 1 ⇒ 第 32 位。
    assert.deepEqual(decodeCellBitSet([{ low: 0, high: 1, unsigned: true }]).cells, [32]);
    // high = -1（有符号 32 位全 1）⇒ 第 32..63 位全置。
    assert.deepEqual(
        decodeCellBitSet([{ low: 0, high: -1, unsigned: true }]).cells,
        Array.from({ length: 32 }, (_, i) => 32 + i),
    );
    // low = -1（同理，low 也可以是负）。
    assert.deepEqual(
        decodeCellBitSet([{ low: -1, high: 0, unsigned: true }]).cells,
        Array.from({ length: 32 }, (_, i) => i),
    );
    // 第二个 word：格子 64。
    assert.deepEqual(decodeCellBitSet([0, { low: 1, high: 0, unsigned: true }]).cells, [64]);
    // 两种形状混在同一个数组里也要能解。
    assert.deepEqual(decodeCellBitSet([1, { low: 1, high: 0, unsigned: true }]).cells, [0, 64]);

    // number 形态（runtime 万一被换成不带 Long 的精简实现）也认 —— 但有安全区。
    // ⚠️ 注意传的是**一个 number 元素**，不是"格子 32"：`32 = 2^5` ⇒ 解出格子 5。
    assert.deepEqual(decodeCellBitSet([0b1011]).cells, [0, 1, 3]);
    assert.deepEqual(decodeCellBitSet([32]).cells, [5], '32 = 2^5 ⇒ 格子 5');
    // 想验"格子 32"要传 `2^32`（第 1 个 word 的第 32 位），仍在 2^53 安全区内。
    assert.deepEqual(decodeCellBitSet([Math.pow(2, 32)]).cells, [32]);
    // 一个 word 里同时有低 32 位与高 32 位（`2^32 + 5` 仍是精确整数，安全区之内）。
    assert.deepEqual(decodeCellBitSet([Math.pow(2, 32) + 5]).cells, [0, 2, 32]);
    // 超 2^53 的 number 块明确判 invalid（不丢位给玩家看）。
    // ⚠️ 2^53 对应的格子号是 53，即 word 里第 53 位 —— 一旦置上，整块不可信。
    const overflow = decodeCellBitSet([Math.pow(2, 53)]);
    assert.equal(overflow.cells, null, 'number 形态超 2^53 必须判 invalid');
    assert.ok(overflow.reason?.includes('无损上限'), '必须说清是无损上限问题');
    assert.equal(MAX_EXACT_CELL_IN_NUMBER, 53, 'number 形态的无损上限是 53');
});

// ── D. 坏数据不静默吞掉 ───────────────────────────────────────────────

test('任一块解不出就整体判 invalid，**不返回半截格子集**', () => {
    // 半截数据会让领地页按"缺格子"渲染 ⇒ 凭空吃掉玩家已通关的领地。
    const bad = decodeCellBitSet([0b1011, '不是数字' as never]);
    assert.equal(bad.cells, null, '坏块必须整体失败');
    assert.ok(bad.reason && bad.reason.length > 0, '必须给出原因，便于定位');
    assert.equal(decodeCellBitSet([Number.NaN]).cells, null);
    assert.equal(decodeCellBitSet([-1]).cells, null, '负数块是非法值');
    assert.equal(decodeCellBitSet([1.5]).cells, null, '小数块是非法值');
    assert.equal(decodeCellBitSet('不是数组' as never).cells, null);
    assert.equal(decodeCellBitSet([{ low: 'abc', high: 0 } as never]).cells, null, 'Long 形状但字段非法');
    // 空数组是合法的空集合，不是 invalid。
    assert.deepEqual(decodeCellBitSet([]).cells, []);
});

test('decodeCellBitSet 的 maxCell 会裁掉越界格（服务端扩容过章节、客户端拿旧地图）', () => {
    const words = encodeCellBitSet([1, 100, 300]);
    // 本章只有 240 格 ⇒ 300 该被裁掉。
    assert.deepEqual(decodeCellBitSet(words, 240).cells, [1, 100]);
    assert.deepEqual(decodeCellBitSet(words, 101).cells, [1, 100]);
    assert.deepEqual(decodeCellBitSet(words, 2).cells, [1]);
    // 非法上界（0 / 负数 / NaN）不裁剪，按"无上界"处理。
    assert.deepEqual(decodeCellBitSet(words, 0).cells, [1, 100, 300]);
    assert.deepEqual(decodeCellBitSet(words, -5).cells, [1, 100, 300]);
    assert.deepEqual(decodeCellBitSet(words, Number.NaN).cells, [1, 100, 300]);
});

test('encodeCellBitSet 忽略非法格子号，且不会因脏数据打爆内存', () => {
    // ⚠️ 不能因为一个脏格子号就把整批丢掉 —— 那等于清空玩家进度。
    assert.deepEqual(decodeCellBitSet(encodeCellBitSet([1, -5, 3, 2.5])).cells, [1, 3]);
    assert.deepEqual(
        decodeCellBitSet(encodeCellBitSet([7, Number.NaN, 9, -1, 11])).cells,
        [7, 9, 11],
    );
    // 超上限的脏格子被过滤，正常格子保住（不会去 new Array(2^53) 把进程打死）。
    assert.deepEqual(encodeCellBitSet([Number.MAX_SAFE_INTEGER]), [], '超上限的格子单独被拒');
    assert.deepEqual(
        encodeCellBitSet([1, Number.MAX_SAFE_INTEGER]),
        [{ low: 2, high: 0, unsigned: true }],
        '超上限的脏格子不能连带把正常格子也丢掉（格子 1 = bit1）',
    );
    // 块数封顶：解码侧同样拒绕（脏包不该让 UI 卡在解码上）。
    const tooMany = new Array(MAX_BITSET_WORDS + 1).fill(0);
    assert.equal(decodeCellBitSet(tooMany).cells, null);
});

// ── E. 奖励状态 ────────────────────────────────────────────────────────

test('rewardState：只有 1 算已领，其它值按未领（宁可多领也别卡住）', () => {
    const make = (rewardState: number) => ({ ...emptyCellState(1), rewardState });
    assert.equal(isRewardClaimed(make(1)), true);
    assert.equal(isRewardClaimed(make(0)), false);
    // 协议只定义 0 / 1，服务端给 2（未来扩展）时按未领处理，别抛。
    assert.equal(isRewardClaimed(make(2)), false);
    assert.equal(isRewardClaimed(make(-1)), false);
    // 空快照恒为未领。
    assert.equal(isRewardClaimed(emptyCellState(3)), false);
    assert.equal(emptyCellState(7).levelChapter, 7, '空快照要记住是哪一章');
});