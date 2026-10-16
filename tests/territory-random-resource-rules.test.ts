import test from 'node:test';
import assert from 'node:assert/strict';
import {
    canOpenTerritoryRandomCell,
    canClaimTerritoryRandomResource,
    claimTerritoryRandomResource,
    selectTerritoryRandomResourceCell,
} from '../assets/script/core/territory/TerritoryRandomResourceRules';

test('random candidate 346 opens beside server-unlocked cells when silver and stamina suffice', () => {
    const input = {
        cellId: 346, rows: 20, columns: 20,
        candidateCells: [346], openedCells: [326, 347, 348, 367],
        silver: 3000, stamina: 1551, silverCost: 10, staminaCost: 5,
    };
    assert.deepEqual(canOpenTerritoryRandomCell(input), { ok: true });
    // 346 是主城 367 的六边邻居（左上斜）：仅主城即可开。
    assert.deepEqual(canOpenTerritoryRandomCell({ ...input, openedCells: [367] }),
        { ok: true });
    // 与 346 不相邻的已开启格不构成开启条件（如 305，隔 1.7 格的旧误判邻居）。
    assert.deepEqual(canOpenTerritoryRandomCell({ ...input, openedCells: [305] }),
        { ok: false, reason: 'needsNeighbor' });
    assert.deepEqual(canOpenTerritoryRandomCell({ ...input, silver: 9 }),
        { ok: false, reason: 'silver' });
    assert.deepEqual(canOpenTerritoryRandomCell({ ...input, stamina: 4 }),
        { ok: false, reason: 'stamina' });
    assert.deepEqual(canOpenTerritoryRandomCell({ ...input, openedCells: [346, 347] }),
        { ok: false, reason: 'alreadyOpen' });
    assert.deepEqual(canOpenTerritoryRandomCell({ ...input, candidateCells: [345] }),
        { ok: false, reason: 'notCandidate' });
});

test('random resource selection uses only free candidate cells in stable order', () => {
    const input = {
        rows: 4,
        columns: 4,
        candidateCells: [5, 3, 2, 1, 5, 99],
        occupiedCells: [3],
        blockedCells: [2],
        activeCells: [] as number[],
        claimedCells: [] as number[],
        maxActive: 1,
    };
    assert.equal(selectTerritoryRandomResourceCell(input, 0), 1);
    assert.equal(selectTerritoryRandomResourceCell(input, 1), 5);
    assert.equal(selectTerritoryRandomResourceCell({ ...input, activeCells: [1] }, 0), null);
    assert.equal(selectTerritoryRandomResourceCell({ ...input, claimedCells: [1, 5] }, 0), null);
});

test('random resource can be claimed only beside an owned hex', () => {
    const dimensions = { rows: 4, columns: 4 };
    assert.equal(canClaimTerritoryRandomResource(1, [1], [0], dimensions), true);
    assert.equal(canClaimTerritoryRandomResource(2, [2], [0], dimensions), false);
    assert.equal(canClaimTerritoryRandomResource(1, [], [0], dimensions), false);
    assert.equal(canClaimTerritoryRandomResource(1, [1], [1], dimensions), false);
});

test('default random resource prefers a claimable neighbor of owned territory', () => {
    const input = {
        rows: 4, columns: 4,
        candidateCells: [1, 2],
        occupiedCells: [0],
        blockedCells: [] as number[],
        activeCells: [] as number[],
        claimedCells: [] as number[],
        ownedCells: [0],
        maxActive: 1,
    };
    assert.equal(selectTerritoryRandomResourceCell(input, 1), 1);
    assert.equal(selectTerritoryRandomResourceCell({ ...input, ownedCells: [15] }, 1), 2);
});

test('claim consumes one active resource once and preserves the previous state', () => {
    const state = { activeCells: [1, 5], claimedCells: [] as number[] };
    const first = claimTerritoryRandomResource(1, state, [0], { rows: 4, columns: 4 });
    assert.deepEqual(first, { ok: true, activeCells: [5], claimedCells: [1] });
    assert.deepEqual(state, { activeCells: [1, 5], claimedCells: [] });
    assert.deepEqual(
        claimTerritoryRandomResource(1, first, [0], { rows: 4, columns: 4 }),
        { ok: false, activeCells: [5], claimedCells: [1] },
    );
});
