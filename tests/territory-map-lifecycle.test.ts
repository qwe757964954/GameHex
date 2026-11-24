import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTerritoryMapViewClass } from './helpers/territory-map-view-sandbox';

test('releasing the prelude keeps the active chapter switch locked', () => {
    const view = Object.create(loadTerritoryMapViewClass().prototype);
    view.clouds = { dollyActive: false };
    view.battleApproach = null;
    view.previewCinema = null;
    view.setChapterSwitchActive(true);
    view.setPreludeLock(true);
    view.setPreludeLock(false);
    assert.equal(view.isInputLocked, true);
    view.setChapterSwitchActive(false);
    assert.equal(view.isInputLocked, false);
});

test('switching between chapters with the same layout resets presentation before arming preview', () => {
    const view = Object.create(loadTerritoryMapViewClass().prototype);
    const operations: string[] = [];
    for (const method of ['syncContentSize', 'syncBackground', 'syncGrid', 'syncClouds', 'syncFlip', 'syncStations', 'syncGhosts']) {
        view[method] = () => {};
    }
    view.resetChapterPresentation = () => operations.push('reset');
    view.armPreviewCinema = () => operations.push('arm');
    view.previewCinemaHold = new Set();
    const layout = { width: 400, height: 400, points: new Map() };
    const input = { chapterId: 1, layout, map: {}, art: {} };
    view.renderMap(input);
    operations.length = 0;
    view.renderMap({ ...input, chapterId: 2 });
    view.renderMap({ ...input, chapterId: 2 });
    assert.deepEqual(operations, ['reset', 'arm', 'arm']);
});

test('the chapter entry only emits when this map owns the click and input is unlocked', () => {
    const emitted: string[] = [];
    const View = loadTerritoryMapViewClass(event => emitted.push(event));
    const view = new View();
    view.stationHitLayer = {};
    view.setChapterSwitchActive(true);
    view.onStationClick({ target: null }, view.stationHitLayer);
    view.setChapterSwitchActive(false);
    view.onStationClick({ target: null }, {});
    assert.deepEqual(emitted, []);
    view.onStationClick({ target: null }, view.stationHitLayer);
    assert.deepEqual(emitted, ['territory:chapter-select']);
});

test('a hidden cell also hides its independent lock sprite and cancels the lock transition', () => {
    const View = loadTerritoryMapViewClass();
    const view = new View();
    const cell = { active: true };
    const lock = { active: true };
    view.hexNodes.set(7, cell);
    view.hexLocks.set(7, { node: lock });
    view.unlockTransitions.set(7, {});
    view.syncHexRecolor = () => {};
    view.syncHexSpawn = () => {};
    view.paintHexes({ map: { sites: [] }, revealedCells: [], lockBlockedCells: [], art: {} });
    assert.equal(cell.active, false);
    assert.equal(lock.active, false);
    assert.equal(view.unlockTransitions.has(7), false);
});

test('map destruction stops owned presentations without updating the page scroll lock', () => {
    const View = loadTerritoryMapViewClass();
    const view = new View();
    const calls: string[] = [];
    const host = (name: string) => ({ isValid: true, destroy: () => calls.push(name) });
    view.overlayHost = host('overlay');
    view.rewardFxOwned = host('reward layer');
    view.chestView = {
        setCameraHook: (hook: unknown) => assert.equal(hook, null),
        stop: () => calls.push('chest'),
    };
    view.scrollLock = () => assert.fail('destruction must not change the page scroll state');
    Object.defineProperty(view, 'clouds', {
        get: () => assert.fail('destruction must not sample the live animation state'),
    });
    view.onDestroy();
    assert.deepEqual(calls.sort(), ['chest', 'overlay', 'reward layer']);
});
