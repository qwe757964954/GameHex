import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { TerritoryProgress } from '../assets/script/app/territory/model/TerritoryProgress';
import { configureTerritoryMap } from '../assets/script/app/territory/model/TerritoryMapConfig';
import { buildTerritoryViewState } from '../assets/script/app/territory/application/TerritoryViewState';
import type { ITerritoryViewState } from '../assets/script/app/territory/application/TerritoryModel';

test('published progress stays stable while live chapter state changes, and exposes no writes', () => {
    const map = configureTerritoryMap({ version: 1, mapKind: 'territoryChapter', id: 'snapshot', name: 'test',
        chapterId: 1, rows: 4, columns: 4, startCellId: 0, sites: [] });
    const progress = new TerritoryProgress(map);
    const source = { map, progress } as ITerritoryViewState;
    const before = buildTerritoryViewState(source);
    progress.markCellsUnlocked([1]);
    progress.markCellPassed(1);
    const after = buildTerritoryViewState(source);
    assert.equal(before.progress?.isCellUnlocked(1), false);
    assert.equal(before.progress?.isOwned(1), false);
    assert.equal(after.progress?.isCellUnlocked(1), true);
    assert.equal(after.progress?.isOwned(1), true);
    assert.equal('markCellPassed' in before.progress!, false);
    assert.equal('markCellsUnlocked' in before.progress!, false);
});
