import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { TerritoryProgress } from '../assets/script/app/territory/model/TerritoryProgress';
import { configureTerritoryMap, isTerritoryBattleSite, TERRITORY_SITE_TYPE } from '../assets/script/app/territory/model/TerritoryMapConfig';
import { buildTerritoryViewState } from '../assets/script/app/territory/application/TerritoryViewState';
import type { ITerritoryViewState } from '../assets/script/app/territory/application/TerritoryModel';

test('published progress stays stable while live chapter state changes, and exposes no writes', () => {
    const map = configureTerritoryMap({ version: 1, mapKind: 'territoryChapter', id: 'snapshot', name: 'test',
        chapterId: 1, rows: 4, columns: 4, startCellId: 0, sites: [] });
    const progress = new TerritoryProgress(map);
    const source = { map, progress, wallet: { silver: 0, stamina: 0 } } as ITerritoryViewState;
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

test('站点投影保留区域共享、请求中、费用不足与稳定快照，视图无需再查进度', () => {
    const map = configureTerritoryMap({ version: 1, mapKind: 'territoryChapter', id: 'projection', name: 'test',
        chapterId: 1, rows: 4, columns: 4, startCellId: 0, sites: [
            { id: 'stage', cellId: 1, type: 'stage', configId: '1001', unlock: { silverCost: 10, staminaCost: 2 } },
            { id: 'boss', cellId: 2, type: 'boss', configId: '1001' },
            { id: 'chest', cellId: 3, type: 'fixedResource', configId: '1001', unlock: { silverCost: 10, staminaCost: 2 } },
        ] });
    const progress = new TerritoryProgress(map, { ownedCells: [0, 2], unlockedCells: [1, 2, 3] });
    const wallet = { silver: 20, stamina: 0 };
    const source = { map, progress, wallet, siteOpenableCells: [], pendingFixedResourceCells: [1] } as unknown as ITerritoryViewState;
    const before = buildTerritoryViewState(source);
    const stage = before.stationStates.get(1)!;
    assert.equal(stage.opened, true);
    assert.equal(stage.owned, false);
    assert.equal(stage.areaPassed, true, '通关同区域首领即可投影为已通关，实际占领保持不变');
    assert.equal(stage.pending, true);
    assert.equal(stage.staminaShort, true);
    assert.equal(stage.silverRed, false, '仅体力不足不把银币数字染红');
    assert.equal(before.stationStates.get(3)!.areaPassed, false, '宝箱不共享战斗区域占领');
    assert.equal(before.stationStates.get(3)!.battle, false);
    assert.equal(Object.isFrozen(stage), true);
    progress.markCellPassed(1);
    wallet.silver = 0;
    wallet.stamina = 10;
    const after = buildTerritoryViewState(source);
    assert.equal(stage.owned, false);
    assert.equal(stage.silverRed, false);
    assert.equal(after.stationStates.get(1)!.owned, true);
    assert.equal(after.stationStates.get(1)!.silverRed, true);
    assert.equal(after.stationStates.get(1)!.staminaShort, false);
});

test('战斗站点共享判据只包含关卡、首领和异步据点', () => {
    for (const type of Object.values(TERRITORY_SITE_TYPE)) {
        assert.equal(isTerritoryBattleSite({ type }), ['stage', 'boss', 'asyncPvp'].includes(type));
    }
});
