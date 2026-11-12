import test from 'node:test';
import assert from 'node:assert/strict';
import type { TerritoryCampaignStage } from '../assets/script/app/territory/model/TerritoryCampaignConfig';
import { configureTerritoryMap } from '../assets/script/app/territory/model/TerritoryMapConfig';
import { TerritoryProgress } from '../assets/script/app/territory/model/TerritoryProgress';
import { territoryRevealedCells } from '../assets/script/app/territory/model/TerritoryCellReveal';
import {
    territoryPreviewCells,
    territoryPreviewLevels,
} from '../assets/script/app/territory/model/TerritoryPreview';
import { loadTerritoryMapViewClass } from './helpers/territory-map-view-sandbox';

/**
 * 用户 2026-11-09：
 *
 *   > ① 默认提前展示关卡 10001 所在的地块；
 *   > ② 通过第一关后，提前展示 boss 关卡建筑和所在地块；
 *   > ③ 通过 boss 关卡后，提前披露第 2 个 boss 关卡的位置。
 *   > 「整关 footprint，不然大建筑会有错位」「用现成的 isAreaPassed」。
 *
 * 这张图把三关摆成一条链：`10001(stage 1) → 10005(boss 5) → 10010(boss 10)`。
 * 10001 占 **2 格**（检验「整关 footprint」），两个首领各 1 / 2 格。
 */
const map = configureTerritoryMap({
    version: 1, mapKind: 'territoryChapter', id: 'preview', name: 'preview',
    chapterId: 1, rows: 5, columns: 5, startCellId: 0, background: '',
    sites: [
        // 第 1 关：两块地，前置故意配成「永远拿不到的 2」⇒ 不靠预告根本露不出来。
        { id: 'stage_1a', type: 'stage', cellId: 5, footprint: [5], configId: '10001',
            unlock: { requiredCells: [2] } },
        { id: 'stage_1b', type: 'stage', cellId: 6, footprint: [6], configId: '10001',
            unlock: { requiredCells: [2] } },
        // 首领 1：前置是第 1 关的格子。
        { id: 'boss_1', type: 'boss', cellId: 12, footprint: [12], configId: '10005',
            unlock: { requiredCells: [6] } },
        // 首领 2：前置是首领 1。
        { id: 'boss_2', type: 'boss', cellId: 18, footprint: [18], configId: '10010',
            unlock: { requiredCells: [12] } },
        { id: 'boss_2b', type: 'boss', cellId: 19, footprint: [19], configId: '10010',
            unlock: { requiredCells: [12] } },
    ],
    randomSites: { triggerSilver: 10, rewardPoolId: '2001', candidateCells: [7], maxActive: 1 },
});

/** 测试只读 `levelId` / `stage` / `isBoss` 三个字段，其余用断言过不掉 —— 与既有用例同一种写法。 */
function stage(levelId: number, order: number, isBoss: boolean): TerritoryCampaignStage {
    return { levelId, stage: order, isBoss, chapterId: 1 } as unknown as TerritoryCampaignStage;
}

const stageByCell = new Map<number, TerritoryCampaignStage>([
    [5, stage(10001, 1, false)],
    [6, stage(10001, 1, false)],
    [12, stage(10005, 5, true)],
    [18, stage(10010, 10, true)],
    [19, stage(10010, 10, true)],
]);

function previewOf(progress: TerritoryProgress): number[] {
    return territoryPreviewCells({
        sites: map.sites,
        stageByCell,
        isAreaPassed: (cellId) => progress.isAreaPassed(cellId),
    });
}

function levelsOf(progress: TerritoryProgress) {
    return territoryPreviewLevels({
        sites: map.sites,
        stageByCell,
        isAreaPassed: (cellId) => progress.isAreaPassed(cellId),
    });
}

test('开局只披露第 1 关，而且是**整关 footprint**（两块地都露）', () => {
    const progress = new TerritoryProgress(map);
    assert.deepEqual(previewOf(progress), [5, 6]);

    const levels = levelsOf(progress);
    assert.equal(levels.length, 1, '首领要等第 1 关通关后才披露');
    assert.equal(levels[0].levelId, 10001);
    assert.equal(levels[0].after, null, '第 1 关的触发点是「开局」');
});

test('通过第 1 关 ⇒ 披露首领 1；首领 2 仍然不披露', () => {
    const progress = new TerritoryProgress(map);
    progress.markCellPassed(5);
    assert.deepEqual(previewOf(progress), [5, 6, 12]);

    const levels = levelsOf(progress);
    assert.deepEqual(levels.map((level) => level.levelId), [10001, 10005]);
    assert.equal(levels[1].after, 10001, '首领 1 的触发关卡是第 1 关');
});

test('通过首领 1 ⇒ 披露首领 2（1.5 关之外的两块地都在里面）', () => {
    const progress = new TerritoryProgress(map);
    progress.markCellPassed(5);
    progress.markCellPassed(12);
    assert.deepEqual(previewOf(progress), [5, 6, 12, 18, 19]);
    assert.deepEqual(levelsOf(progress).map((level) => level.levelId), [10001, 10005, 10010]);
});

test('链式：前一项没通过，后面的绝不跳着披露', () => {
    const progress = new TerritoryProgress(map);
    // 直接（异常地）把首领 2 通了 —— 第 1 关还是没打。
    progress.markCellPassed(18);
    assert.deepEqual(previewOf(progress), [5, 6], '披露序列必须一站一站走');
});

test('披露 ≠ 能开：前置判据一格都没松', () => {
    const progress = new TerritoryProgress(map);
    // 第 1 关的两格都在预告里，但前置（cell 2）依然没满足 ⇒ 点击仍会被拦。
    assert.deepEqual(previewOf(progress), [5, 6]);
    assert.deepEqual(progress.prerequisiteBlockers(5), [2]);
    assert.equal(progress.isPrerequisiteComplete(5), false);
});

test('揭示函数：不传 previewCells 与上一版逐格相同，传了才多出那几格', () => {
    const progress = new TerritoryProgress(map);
    const before = territoryRevealedCells(map, progress);
    assert.equal(before.includes(5), false, '前置没满足 ⇒ 自己不该露出来');
    assert.equal(before.includes(6), false);

    const after = territoryRevealedCells(map, progress, previewOf(progress));
    assert.deepEqual(after.filter((cell) => cell === 5 || cell === 6), [5, 6]);
    // 其余格一格不多（尤其前沿空格 7 的邻居、以及还没轮到的首领格）。
    assert.deepEqual(after.filter((cell) => cell !== 5 && cell !== 6), before);
    assert.equal(after.includes(12), false, '首领 1 还没到披露时机');
});

test('第 1 关本身就是首领时，目标序列不许把它算两次', () => {
    const bossFirst = new Map<number, TerritoryCampaignStage>([
        [5, stage(10005, 1, true)],
        [6, stage(10005, 1, true)],
        [12, stage(10010, 5, true)],
    ]);
    const progress = new TerritoryProgress(map);
    const levels = territoryPreviewLevels({
        sites: map.sites,
        stageByCell: bossFirst,
        isAreaPassed: (cellId) => progress.isAreaPassed(cellId),
    });
    assert.deepEqual(levels.map((level) => level.levelId), [10005]);
});

test('没有关卡表（章节还没加载完）⇒ 什么都不披露', () => {
    const progress = new TerritoryProgress(map);
    assert.deepEqual(territoryPreviewCells({
        sites: map.sites,
        stageByCell: new Map(),
        isAreaPassed: (cellId) => progress.isAreaPassed(cellId),
    }), []);
});

// ============================================================
// 第二层：视图选择逻辑（`syncGhosts` / `stepGhostFade`）—— 沙箱直接驱私有方法
// ============================================================

/**
 * 视图侧的「哪几格画虚影」只看三件事：
 *  ① 在 `previewCells` 里；② 配了 `buildingId`（`stationIconOf` 对没配的一律返回 null）；
 *  ③ 这一格**还没激活**。已激活的走实心建筑 + 0.2s 淡出。
 */
test('syncGhosts：只画「带建筑 + 还没激活」的那几格', () => {
    const MapView = loadTerritoryMapViewClass() as new () => any;
    const mapView = new MapView();
    const drawn: number[] = [];
    mapView.renderGhost = (site: { cellId: number }) => {
        drawn.push(site.cellId);
        return true;
    };
    mapView.syncGhosts({
        map: {
            id: 'ch01', startCellId: 0, defaults: { staminaCost: 5 },
            sites: [
                { id: 'stage_1a', type: 'stage', cellId: 5, footprint: [5], buildingId: '69004' },
                { id: 'stage_1b', type: 'stage', cellId: 6, footprint: [6], buildingId: '' },
                { id: 'boss_1', type: 'boss', cellId: 12, footprint: [12], buildingId: '69003' },
            ],
            randomSites: { candidateCells: [] },
        },
        layout: { points: new Map([[5, { x: 0, y: 0 }], [6, { x: 1, y: 0 }], [12, { x: 2, y: 0 }]]) },
        // 12 已经花了银币激活 ⇒ 不该再画虚影。
        progress: {
            isCellUnlocked: (cellId: number) => cellId === 12,
            isOwned: () => false,
        },
        previewCells: [5, 6, 12],
    });
    assert.deepEqual(drawn, [5], '只在带建筑、且还没激活的那一格画虚影');
});

test('syncGhosts：已激活的那颗不画，改挂 0.2s 淡出', () => {
    const MapView = loadTerritoryMapViewClass() as new () => any;
    const mapView = new MapView();
    mapView.renderGhost = () => true;
    // 同一章内的稳态（换章会先整批清空，那一路由下一条用例覆盖）。
    mapView.ghostKey = 'ch01';
    mapView.ghostViews.set(12, { isValid: true });
    mapView.syncGhosts({
        map: {
            id: 'ch01', startCellId: 0, defaults: { staminaCost: 5 },
            sites: [{ id: 'boss_1', type: 'boss', cellId: 12, footprint: [12], buildingId: '69003' }],
            randomSites: { candidateCells: [] },
        },
        layout: { points: new Map([[12, { x: 0, y: 0 }]]) },
        progress: { isCellUnlocked: () => true, isOwned: () => false },
        previewCells: [12],
    });
    assert.equal(mapView.ghostFades.get(12), 0.2, '激活后走 0.2s 淡出，而不是直接消失');
    assert.equal(mapView.ghostViews.has(12), true, '淡出期间节点还在');
});

test('换章：旧虚影必须整批清掉（格子几何都换了）', () => {
    const MapView = loadTerritoryMapViewClass() as new () => any;
    const mapView = new MapView();
    mapView.renderGhost = () => true;
    let disposed = false;
    mapView.ghostKey = 'ch01';
    mapView.ghostViews.set(7, {
        isValid: true,
        dispose() { disposed = true; },
        node: { isValid: false },
    });
    mapView.syncGhosts({
        map: { id: 'ch02', startCellId: 0, defaults: { staminaCost: 5 }, sites: [], randomSites: { candidateCells: [] } },
        layout: { points: new Map() },
        progress: { isCellUnlocked: () => false, isOwned: () => false },
        previewCells: [],
    });
    assert.equal(disposed, true, '换章时旧虚影要当场收掉');
    assert.equal(mapView.ghostViews.size, 0);
});

test('stepGhostFade：0.2s 内 0.35 → 0，扣完销毁', () => {
    const MapView = loadTerritoryMapViewClass() as new () => any;
    const mapView = new MapView();
    const opacities: number[] = [];
    let disposed = false;
    mapView.ghostViews.set(7, {
        isValid: true,
        setGhostOpacity(value: number) { opacities.push(value); },
        dispose() { disposed = true; },
        node: { isValid: false },
    });
    mapView.ghostFades.set(7, 0.2);

    mapView.stepGhostFade(0.1);
    assert.equal(opacities.length, 1);
    assert.ok(Math.abs(opacities[0] - 0.175) < 1e-9, `半程应是 0.175，实际 ${opacities[0]}`);
    assert.equal(disposed, false, '没扣完不许销毁');

    mapView.stepGhostFade(0.1);
    assert.equal(disposed, true, '扣到 0 才销毁');
    assert.equal(mapView.ghostViews.has(7), false);
});
