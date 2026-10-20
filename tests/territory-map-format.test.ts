import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hexGridNeighborIds } from '../assets/script/core/hex/HexGridLayout';
import { hexNeighbors, normalizeTerritoryMap, TerritoryValidationError } from '../tools/map-editor/formats/territory-format.js';

/**
 * 领地编辑器的六邻居必须与客户端 `hexGridNeighborIds` 逐格一致。
 *
 * 这条是 2026-10-20 补的：`territory-format.js` 原来有**自己一套** offset 约定，
 * 与客户端 400/400 格全部不一致 —— 表现是「编辑器刷的笔刷是另一组格子」、
 * 「编辑器校验说连通、python 发布校验说另一回事」。别再让它长出第二套实现。
 */
test('领地编辑器的六邻居与客户端逐格一致（20×20 与 40×40）', () => {
    for (const [rows, cols] of [[20, 20], [40, 40]]) {
        for (let cellId = 0; cellId < rows * cols; cellId += 1) {
            const editor = [...hexNeighbors(cellId, rows, cols)].sort((a, b) => a - b);
            const client = [...hexGridNeighborIds(cellId, rows, cols)].sort((a, b) => a - b);
            assert.deepEqual(editor, client, `格 ${cellId}（${rows}×${cols}）邻居不一致`);
        }
    }
});

const sample = JSON.parse(readFileSync(new URL('../assets/resources/config/territory-maps/chapter_01.json', import.meta.url), 'utf8'));

test('territory sample normalizes independently from battle map protocol', () => {
    const result = normalizeTerritoryMap(sample);
    assert.equal(result.map.mapKind, 'territoryChapter');
    assert.equal(result.map.rows, 20);
    assert.equal(result.map.sites.length, 152);
    assert.deepEqual(result.map.randomSites?.candidateCells, sample.randomSites.candidateCells);
});

test('territory validator rejects overlapping sites and random fixed cells', () => {
    const invalid = structuredClone(sample);
    invalid.sites[1].cellId = invalid.sites[0].cellId;
    invalid.sites[1].footprint = [invalid.sites[0].cellId];
    invalid.randomSites.candidateCells.push(invalid.startCellId);
    assert.throws(() => normalizeTerritoryMap(invalid), (error: unknown) => error instanceof TerritoryValidationError && error.issues.some((issue) => issue.includes('overlaps')) && error.issues.some((issue) => issue.includes('fixed cell')));
});

test('territory validator rejects dependency cycles', () => {
    const invalid = structuredClone(sample);
    invalid.sites[0].unlock.requiredCells = [invalid.sites[1].cellId];
    invalid.sites[1].unlock.requiredCells = [invalid.sites[0].cellId];
    assert.throws(() => normalizeTerritoryMap(invalid), (error: unknown) => error instanceof TerritoryValidationError && error.issues.some((issue) => issue.includes('dependency cycle')));
});

test('fixed resource sites retain distinct numeric reward IDs through editor normalization', () => {
    const input = structuredClone(sample);
    const resources = input.sites.filter((site: { type: string }) => site.type === 'fixedResource');
    resources[0].rewardId = 101;
    resources[1].rewardId = 202;
    const normalized = normalizeTerritoryMap(input).map;
    const output = normalized.sites.filter((site: { type: string }) => site.type === 'fixedResource');
    assert.equal(output[0].rewardId, 101);
    assert.equal(output[1].rewardId, 202);
});

test('fixed resource reward ID rejects non-positive and non-integer values', () => {
    for (const rewardId of [0, -1, 1.5, '101']) {
        const input = structuredClone(sample);
        input.sites[0].rewardId = rewardId;
        assert.throws(() => normalizeTerritoryMap(input), (error: unknown) =>
            error instanceof TerritoryValidationError && error.issues.some((issue) => issue.includes('rewardId')));
    }
});

test('reward ID cannot be assigned to a non-resource site', () => {
    const input = structuredClone(sample);
    const stage = input.sites.find((site: { type: string }) => site.type === 'stage');
    stage.rewardId = 101;
    assert.throws(() => normalizeTerritoryMap(input), (error: unknown) =>
        error instanceof TerritoryValidationError && error.issues.some((issue) => issue.includes('rewardId')));
});
