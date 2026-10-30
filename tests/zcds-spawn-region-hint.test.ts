import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { configureZCMap, ZC_HEX_CONFIG, type ZCMapLayout, type ZCMapRegion } from '../assets/script/app/zcds/model/ZCGameModel';
import { resolveZCSpawnRegionHints } from '../assets/script/app/zcds/model/ZCSpawnRegionHint';
import { assetPath } from './helpers/asset-paths';

test('region hints use depth defaults, tendency overrides, own section, and mean cell positions', () => {
    const regions: ZCMapRegion[] = [
        { section: 1, depth: 'front', cells: [1, 2] },
        { section: 1, depth: 'mid', cells: [3], tendency: 'develop' },
        { section: 1, depth: 'back', cells: [4] },
        { section: 2, depth: 'front', cells: [5] },
        { section: 1, depth: 'front', cells: [] },
        { section: 1, depth: 'mid', cells: [6, 7] },
        { section: 1, depth: 'mid', cells: [8] },
    ];
    const positions = new Map([
        [1, { x: 10, y: 20 }],
        [2, { x: 30, y: 60 }],
        [3, { x: 100, y: 200 }],
        [4, { x: -5, y: 15 }],
        [5, { x: 500, y: 500 }],
        [6, { x: 1, y: 2 }],
    ]);

    assert.deepEqual(resolveZCSpawnRegionHints(regions, positions, 1), [
        { depth: 'front', label: '速攻', x: 20, y: 40 },
        { depth: 'mid', label: '发育', x: 100, y: 200 },
        { depth: 'back', label: '发育', x: -5, y: 15 },
        { depth: 'mid', label: '控场', x: 1, y: 2 },
    ]);
});

test('configureZCMap rejects inherited tendency property names', () => {
    const source = JSON.parse(readFileSync(assetPath('config/maps/select_river.json'), 'utf8')) as ZCMapLayout;
    for (const tendency of ['constructor', 'toString', '__proto__']) {
        const layout = structuredClone(source);
        assert.ok(layout.regions?.length);
        layout.regions[0].tendency = tendency as ZCMapRegion['tendency'];
        assert.throws(() => configureZCMap(layout), /rush \/ control \/ develop/, tendency);
    }
});

test('configureZCMap rejects duplicate section and depth regions', () => {
    const layout = JSON.parse(readFileSync(assetPath('config/maps/select_river.json'), 'utf8')) as ZCMapLayout;
    assert.ok(layout.regions?.length);
    const first = layout.regions[0];
    configureZCMap(layout);
    const usedCells = new Set(layout.regions.flatMap((region) => region.cells));
    const otherPlayableCell = ZC_HEX_CONFIG.find((hex) => hex.playable && !usedCells.has(hex.id));
    assert.ok(otherPlayableCell, 'fixture needs an unassigned playable cell');
    layout.regions.push({ ...first, cells: [otherPlayableCell.id] });
    assert.throws(() => configureZCMap(layout), /区域.*重复|重复.*区域/);
});

test('configureZCMap rejects unknown region tendency with the defined configuration error', () => {
    const layout = JSON.parse(readFileSync(assetPath('config/maps/select_river.json'), 'utf8')) as ZCMapLayout;
    assert.ok(layout.regions?.length, 'select_river must include regions');
    layout.regions[0].tendency = 'unknown' as ZCMapRegion['tendency'];
    assert.throws(() => configureZCMap(layout), /打法倾向必须是 rush \/ control \/ develop/);
});
