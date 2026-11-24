import assert from 'node:assert/strict';
import test from 'node:test';
import {
    matchingTipOpacity,
    matchingTipOffsetY,
    matchingTipProgress,
    matchingWaveOffset,
} from '../assets/script/app/matching/MatchingTimeline';
test('matching timelines clamp endpoints and depend only on elapsed time', () => {
    assert.equal(matchingTipProgress(-1), 0); assert.equal(matchingTipProgress(0.3), 1); assert.equal(matchingTipProgress(1), 1);
    assert.equal(matchingTipProgress(0.15), 0.5);
    assert.equal(matchingWaveOffset(0, 0), 0); assert.equal(matchingWaveOffset(0.45, 0), 6);
    assert.equal(matchingWaveOffset(0.03, 1), 0);
    const sampled = [0, 0.07, 0.17, 0.8, 1.4].map(value => matchingWaveOffset(value, 2));
    assert.deepEqual(sampled, [0, 0.07, 0.17, 0.8, 1.4].map(value => matchingWaveOffset(value, 2)));
});

test('matching tip fade and vertical offset timeline tests', () => {
    // 边界钳位测试
    assert.equal(matchingTipOpacity(0), 255);
    assert.equal(matchingTipOpacity(-0.5), 255);
    assert.equal(matchingTipOpacity(1), 255);
    assert.equal(matchingTipOpacity(1.5), 255);
    assert.equal(matchingTipOffsetY(0), 0);
    assert.equal(matchingTipOffsetY(1), 0);

    // 半程中点切换（淡出最低点，透明度为 0）
    assert.equal(matchingTipOpacity(0.5), 0);
    // 1/4 进度与 3/4 进度透明度对称
    assert.equal(matchingTipOpacity(0.25), Math.round(255 * 0.5));
    assert.equal(matchingTipOpacity(0.75), Math.round(255 * 0.5));

    // 垂直微移测试 (direction = 1)
    assert.equal(matchingTipOffsetY(0.25, 1, 10), 5);
    assert.equal(matchingTipOffsetY(0.75, 1, 10), -5);
    // 垂直微移测试 (direction = -1)
    assert.equal(matchingTipOffsetY(0.25, -1, 10), -5);
    assert.equal(matchingTipOffsetY(0.75, -1, 10), 5);
});
