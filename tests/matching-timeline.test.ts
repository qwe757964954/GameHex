import assert from 'node:assert/strict';
import test from 'node:test';
import { matchingTipProgress, matchingWaveOffset } from '../assets/script/app/matching/MatchingTimeline';
test('matching timelines clamp endpoints and depend only on elapsed time', () => {
    assert.equal(matchingTipProgress(-1), 0); assert.equal(matchingTipProgress(0.3), 1); assert.equal(matchingTipProgress(1), 1);
    assert.equal(matchingTipProgress(0.15), 0.5);
    assert.equal(matchingWaveOffset(0, 0), 0); assert.equal(matchingWaveOffset(0.45, 0), 6);
    assert.equal(matchingWaveOffset(0.03, 1), 0);
    const sampled = [0, 0.07, 0.17, 0.8, 1.4].map(value => matchingWaveOffset(value, 2));
    assert.deepEqual(sampled, [0, 0.07, 0.17, 0.8, 1.4].map(value => matchingWaveOffset(value, 2)));
});
