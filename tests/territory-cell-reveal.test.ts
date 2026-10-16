import test from 'node:test';
import assert from 'node:assert/strict';
import { configureTerritoryMap } from '../assets/script/app/territory/model/TerritoryMapConfig';
import { TerritoryProgress } from '../assets/script/app/territory/model/TerritoryProgress';
import { territoryRevealedCells } from '../assets/script/app/territory/model/TerritoryCellReveal';

const map = configureTerritoryMap({
    version: 1, mapKind: 'territoryChapter', id: 'reveal', name: 'reveal',
    chapterId: 1, rows: 4, columns: 4, startCellId: 0, background: '',
    sites: [{ id: 'fixed', type: 'fixedResource', cellId: 4, footprint: [4], rewardId: 1011 }],
    randomSites: { triggerSilver: 10, rewardPoolId: '2001', candidateCells: [5, 8], maxActive: 1 },
});

test('only opened cells and adjacent target cells are revealed, then the frontier expands', () => {
    const progress = new TerritoryProgress(map);
    // cell 0 的六边邻居 = {1, 4, 5}（(1,1) 斜向也相邻）；5 是候选格 ⇒ 开局即揭示。
    assert.deepEqual(territoryRevealedCells(map, progress), [0, 4, 5]);
    progress.markCellUnlocked(4);
    assert.deepEqual(territoryRevealedCells(map, progress), [0, 4, 5, 8]);
});

test('fixed resource with satisfied prerequisites shows even when not adjacent to opened cells', () => {
    // fixedResource cell 9 前置依赖 stage 1（与起点 0 不相邻）：前置满足即显示，不要求相邻。
    const mapWithGate = configureTerritoryMap({
        version: 1, mapKind: 'territoryChapter', id: 'reveal-gate', name: 'reveal-gate',
        chapterId: 1, rows: 4, columns: 4, startCellId: 0, background: '',
        sites: [
            { id: 'fixed', type: 'fixedResource', cellId: 4, footprint: [4], rewardId: 1011 },
            { id: 'fixed_9', type: 'fixedResource', cellId: 9, footprint: [9], rewardId: 1011,
                unlock: { requiredCells: [1] } },
        ],
        randomSites: { triggerSilver: 10, rewardPoolId: '2001', candidateCells: [5, 8], maxActive: 1 },
    });
    const progress = new TerritoryProgress(mapWithGate);
    assert.deepEqual(territoryRevealedCells(mapWithGate, progress), [0, 4, 5]);
    progress.markCellPassed(1);
    assert.deepEqual(territoryRevealedCells(mapWithGate, progress), [0, 1, 4, 5, 9]);
});
