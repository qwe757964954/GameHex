import assert from 'node:assert/strict';
import test from 'node:test';
import { toCount, toIdString, toPositiveInt, toText } from '../assets/script/core/value/Coerce';
import { MS_PER_DAY, TICK_SECONDS, formatHmsMs, pad2, startOfDay, startOfDayMs, toMillis } from '../assets/script/core/time/TimeMs';
import { clamp01, clamp01Finite, clampUint32, isUint32 } from '../assets/script/core/math/Scalar';
import { easeOutCubic } from '../assets/script/core/math/Easing';
import { fguiAnchorToCocos, fguiTopLeftToCocos } from '../assets/script/core/layout/FguiLayout';
import { asRow, collectParsed, parseRows, parseRowsToMap } from '../assets/script/core/table/RowParse';
import { parseRewardAmounts } from '../assets/script/core/table/RewardRows';
import type { IRewardAmount } from '../assets/script/core/types/Reward';

const longLike = { low: 5, high: 1, unsigned: true, toString: () => '4294967301' };

test('Coerce: Long / number / string 口径与旧 RequestGuard 一致', () => {
    assert.equal(toCount(12), 12);
    assert.equal(toCount('12'), 12);
    assert.equal(toCount('bad'), 0);
    assert.equal(toCount(longLike), 4294967301);
    assert.equal(toCount({ toNumber: () => 7 }), 7);
    assert.equal(toIdString(longLike), '4294967301');
    assert.equal(toIdString(12), '12');
    assert.equal(toIdString(''), '');
    assert.equal(toPositiveInt('3'), 3);
    assert.equal(toPositiveInt(0), null);
    assert.equal(toPositiveInt(1.5), null);
    assert.equal(toText(' x ', ''), ' x ');
    assert.equal(toText(12, 'fallback'), '12');
    assert.equal(toText(null, 'fallback'), 'fallback');
});

test('TimeMs: 常量、toMillis、startOfDay、HMS', () => {
    assert.equal(MS_PER_DAY, 86400000);
    assert.equal(TICK_SECONDS, 1);
    assert.equal(toMillis('123'), 123);
    assert.equal(toMillis(longLike), 4294967301);
    const withNumber = { low: 1, high: 1, toNumber: () => 42 };
    assert.equal(toMillis(withNumber), 42);
    const date = new Date(2026, 10, 16, 15, 30, 0, 0);
    const start = startOfDay(date.getTime());
    assert.equal(new Date(start).getHours(), 0);
    assert.equal(new Date(start).getMinutes(), 0);
    assert.equal(startOfDayMs(date.getTime()), start);
    assert.equal(pad2(3), '03');
    assert.equal(formatHmsMs(0), '00:00:00');
    assert.equal(formatHmsMs(3599999), '01:00:00');
});

test('Scalar / Easing: NaN 语义与不 clamp 的 easeOutCubic', () => {
    assert.equal(clamp01(-1), 0);
    assert.equal(clamp01(2), 1);
    assert.equal(clamp01(0.5), 0.5);
    assert.ok(Number.isNaN(clamp01(Number.NaN)));
    assert.equal(clamp01Finite(Number.NaN), 0);
    assert.equal(clamp01Finite(0.5), 0.5);
    assert.equal(isUint32(1), true);
    assert.equal(isUint32(-1), false);
    assert.equal(isUint32(4294967296), false);
    assert.equal(clampUint32(4294967296), 4294967295);
    assert.equal(easeOutCubic(0), 0);
    assert.equal(easeOutCubic(0.5), 0.875);
    assert.equal(easeOutCubic(2), 2);
});

test('FguiLayout: 左上角与 anchor 换算', () => {
    assert.deepEqual(fguiTopLeftToCocos(0, 0, 100, 50, 720, 1280), { x: -310, y: 615 });
    assert.deepEqual(fguiAnchorToCocos(360, 640, 720, 1280), { x: 0, y: 0 });
});

test('RowParse: null 安全、脏行跳过、first/last 键策略', () => {
    assert.deepEqual(parseRows(null, () => 1), []);
    assert.deepEqual(parseRows([{ id: 1 }, null, 3], (row) => (row && row.id ? Number(row.id) : null)), [1]);
    assert.equal(asRow(null), null);
    assert.deepEqual(collectParsed([{ id: 1 }, null], (row) => (row ? Number(row.id) : null)), [1]);
    const mapFirst = parseRowsToMap([{ id: 1, name: 'a' }, { id: 1, name: 'b' }], (row) => row as { id: number; name: string }, (row) => row.id, { keep: 'first' });
    assert.equal(mapFirst.get(1)?.name, 'a');
    const mapLast = parseRowsToMap([{ id: 1, name: 'a' }, { id: 1, name: 'b' }], (row) => row as { id: number; name: string }, (row) => row.id, { keep: 'last' });
    assert.equal(mapLast.get(1)?.name, 'b');
});

test('RewardRows: 奖励金额解析的 minNumber 口径', () => {
    const rewards: IRewardAmount[] = parseRewardAmounts([
        { resId: 1, number: 2 },
        { resId: 2, number: 0 },
        { resId: 0, number: 2 },
        null,
    ]);
    assert.deepEqual(rewards, [{ resId: 1, number: 2 }]);
    assert.deepEqual(parseRewardAmounts([{ resId: 2, number: 0 }], { minNumber: 0 }), [{ resId: 2, number: 0 }]);
    assert.deepEqual(parseRewardAmounts('bad'), []);
});
