import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { configureTerritoryMap, territoryNeighbors } from '../assets/script/app/territory/model/TerritoryMapConfig';

const sample = JSON.parse(readFileSync(new URL('../assets/resources/config/territory-maps/chapter_01.json', import.meta.url), 'utf8'));
const chapterTwo = JSON.parse(readFileSync(new URL('../assets/resources/config/territory-maps/chapter_02.json', import.meta.url), 'utf8'));

test('client territory config loads static chapter data', () => {
    const config = configureTerritoryMap(sample);
    assert.equal(config.mapKind, 'territoryChapter');
    assert.equal(config.sites.length, 152);
    assert.equal(config.startCellId, 367);
    assert.equal(config.sites[0].type, 'fixedResource');
    assert.ok(territoryNeighbors(config.startCellId, config).length > 0);
});

test('client territory config keeps runtime progress out of static map', () => {
    const config = configureTerritoryMap({ ...sample, progress: { ownedCells: [sample.startCellId] } });
    assert.equal('progress' in config, false);
});

test('client territory config retains fixed resource reward IDs per site', () => {
    const input = structuredClone(sample);
    const resources = input.sites.filter((site: { type: string }) => site.type === 'fixedResource');
    resources[0].rewardId = 101;
    resources[1].rewardId = 202;
    const config = configureTerritoryMap(input);
    const output = config.sites.filter((site) => site.type === 'fixedResource');
    assert.equal(output[0].rewardId, 101);
    assert.equal(output[1].rewardId, 202);
});

test('map editor preset matches the published chapter and the runtime fallback background exists', () => {
    const preset = JSON.parse(readFileSync(new URL('../tools/map-editor/presets/territory/chapter_01.json', import.meta.url), 'utf8'));
    assert.deepEqual(preset, sample);
    assert.equal(sample.background, '');
    assert.equal(existsSync(new URL('../assets/resources/image/gameui/bg_03.png', import.meta.url)), true);
});

test('chapter two keeps the current editor site format in sync with the published JSON', () => {
    const config = configureTerritoryMap(chapterTwo);
    const preset = JSON.parse(readFileSync(new URL('../tools/map-editor/presets/territory/chapter_02.json', import.meta.url), 'utf8'));
    assert.equal(config.chapterId, 2);
    assert.equal(config.name, '第二章');
    assert.equal(config.sites.length, 35);
    assert.ok(config.sites.every((site) => /^(fixedResource|stage|asyncPvp)_\d+$/.test(site.configId)));
    assert.deepEqual(preset, chapterTwo);
    assert.equal(existsSync(new URL('../assets/resources/config/territory-maps/chapter_02.json.meta', import.meta.url)), true);
});

test('published later chapter names stay aligned with their current map presets', () => {
    for (const [chapterId, name] of [[3, '第三章'], [4, '第四章']] as const) {
        const file = `chapter_${String(chapterId).padStart(2, '0')}.json`;
        const published = JSON.parse(readFileSync(new URL(`../assets/resources/config/territory-maps/${file}`, import.meta.url), 'utf8'));
        const preset = JSON.parse(readFileSync(new URL(`../tools/map-editor/presets/territory/${file}`, import.meta.url), 'utf8'));
        assert.equal(published.name, name);
        assert.deepEqual(published, preset);
    }
});

// ── configureTerritoryMap 严格归一化（步骤 0）────────────────────────────

function minimalMap(overrides: Record<string, unknown> = {}) {
    return {
        version: 1,
        mapKind: 'territoryChapter',
        id: 'test-map',
        name: '测试地图',
        chapterId: 1,
        rows: 4,
        columns: 4,
        startCellId: 0,
        background: '',
        sites: [
            { id: 'stage_1', type: 'stage', cellId: 1, footprint: [1], unlock: { requiredCells: [] } },
        ],
        ...overrides,
    };
}

function expectConfigureThrow(input: unknown, fragment: string): void {
    assert.throws(
        () => configureTerritoryMap(input),
        (error: unknown) => error instanceof Error && error.message.includes(fragment),
    );
}

test('sites without unlock fall back to defaults 10/2/5 and empty requiredCells', () => {
    const config = configureTerritoryMap(minimalMap());
    assert.deepEqual(config.defaults.requiredCells, []);
    const unlock = config.sites[0].unlock;
    assert.equal(unlock.silverCost, 10);
    assert.equal(unlock.exploreSeconds, 2);
    assert.equal(unlock.staminaCost, 5);
    assert.deepEqual(unlock.requiredCells, []);
});

test('non-integer requiredCells entries are rejected instead of silently dropped', () => {
    const input = minimalMap();
    (input.sites[0] as { unlock: { requiredCells: unknown[] } }).unlock.requiredCells = ['x'];
    expectConfigureThrow(input, 'requiredCells[0] must be an integer');
});

test('out-of-range requiredCells entries are rejected', () => {
    const input = minimalMap();
    (input.sites[0] as { unlock: { requiredCells: number[] } }).unlock.requiredCells = [99];
    expectConfigureThrow(input, 'requiredCells[0] is out of bounds');
});

test('requiredCells including the site own footprint are rejected', () => {
    const input = minimalMap();
    (input.sites[0] as { unlock: { requiredCells: number[] } }).unlock.requiredCells = [1];
    expectConfigureThrow(input, 'requiredCells cannot include its own footprint');
});

test('duplicate footprint cells are rejected', () => {
    const input = minimalMap();
    (input.sites[0] as { footprint: number[] }).footprint = [1, 1];
    expectConfigureThrow(input, 'footprint has duplicate cells');
});

test('decorations must be in range, with non-empty artId and no repeated cells', () => {
    const invalid = [
        { decorations: [{ cellId: 99, artId: 'a' }], fragment: 'cellId' },
        { decorations: [{ cellId: 2, artId: '' }], fragment: 'artId is invalid' },
        { decorations: [{ cellId: 2, artId: 'a' }, { cellId: 2, artId: 'b' }], fragment: 'repeats cell' },
    ] as const;
    for (const { decorations, fragment } of invalid) {
        expectConfigureThrow(minimalMap({ decorations }), fragment);
    }
    // 合法 decoration 被接受。
    const config = configureTerritoryMap(minimalMap({ decorations: [{ cellId: 2, artId: 'a' }] }));
    assert.deepEqual(config.decorations, [{ cellId: 2, artId: 'a' }]);
});

test('randomSites maxActive must be at least 1', () => {
    const input = minimalMap({
        randomSites: { rewardPoolId: 'pool', candidateCells: [2], maxActive: 0 },
    });
    expectConfigureThrow(input, 'maxActive must be at least 1');
});

test('non-integer random candidate cells are rejected', () => {
    const input = minimalMap({
        randomSites: { rewardPoolId: 'pool', candidateCells: ['x'], maxActive: 1 },
    });
    expectConfigureThrow(input, 'candidateCells[0] must be an integer');
});
