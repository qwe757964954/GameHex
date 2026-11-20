import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    territoryNodeCarrierByCell,
    territoryNodeLockCells,
    territoryNodeMutedCells,
} from '../assets/script/app/territory/model/TerritoryNodeUI';
import {
    territoryPatrolAnchorByCell,
    territoryPatrolAnchorCell,
} from '../assets/script/app/territory/model/TerritoryMonsterPatrol';
import {
    loadTerritoryMapViewClass,
    mapInputWithProjection,
} from './helpers/territory-map-view-sandbox';

/**
 * 2026-11-20：「同个节点的巡逻野怪地块，只在配置了野怪 id 的地块上展示
 * 解锁 icon 和激活银币 icon，其他地块不显示，参考异步 PVP 地块」。
 *
 * 巡逻格没有 `configId`、没有 `buildingId`，战斗节点那两套收敛一条都命不中，
 * 之前同片 6~8 格会各挂一条「银币 + 10」，读成「这一片要连续买十几次」。
 * 现在按 `site.id` 分片、收敛到**配了 `patrolId` 的那一格**：
 * · 价格 / 编号 / 建筑 → `territoryNodeMutedCells` + `stationRenderOf` 早退；
 * · 锁 → `territoryNodeCarrierByCell` + `territoryNodeLockCells`；
 * · 地皮 / 红框 / 通关状态 / 点击上报**一个字都不动**（见最后两条源码守卫）。
 */

interface ISite {
    id: string;
    type: string;
    cellId: number;
    footprint: number[];
    configId?: string;
    buildingId?: string;
    patrolId?: number;
    battleId?: number;
    unlock: { requiredCells: number[]; combatPower: number; silverCost: number; exploreSeconds: number; staminaCost: number };
}

function loadChapter(chapter: string): { sites: ISite[] } {
    return JSON.parse(readFileSync(`assets/resources/config/territory-maps/${chapter}.json`, 'utf8'));
}

function patrol(cellId: number, id: string, patrolId?: number, footprint?: number[]): ISite {
    return {
        id,
        type: 'patrolChest',
        cellId,
        footprint: footprint ?? [cellId],
        ...(patrolId ? { patrolId } : {}),
        battleId: 60001,
        unlock: { requiredCells: [], combatPower: 0, silverCost: 10, exploreSeconds: 2, staminaCost: 5 },
    };
}

function source(path: string): string {
    return readFileSync(path, 'utf8');
}

// ---------------------------------------------------------------------------
// 分组判据：真实 chapter_01 五片
// ---------------------------------------------------------------------------

test('chapter_01：5 片巡逻区只有配了 patrolId 的 5 格承载 UI', () => {
    const sites = loadChapter('chapter_01').sites;
    const patrolSites = sites.filter(s => s.type === 'patrolChest');
    const anchors = patrolSites.filter(s => !!s.patrolId).map(s => s.cellId).sort((a, b) => a - b);
    assert.deepEqual(anchors, [128, 164, 208, 331, 387], '五片各有一格配了野怪 id');
    assert.equal(patrolSites.length, 31, '五片一共 31 个站点格');

    const muted = territoryNodeMutedCells(sites);
    for (const cellId of anchors) {
        assert.equal(muted.has(cellId), false, `${cellId} 配了野怪 id ⇒ 解锁 / 激活 icon 留在它身上`);
    }
    const mutedPatrol = patrolSites.filter(s => muted.has(s.cellId)).map(s => s.cellId);
    assert.equal(mutedPatrol.length, 26, '其余 26 格不显示任何 UI');
    for (const cellId of mutedPatrol) {
        const target = patrolSites.find(s => s.cellId === cellId);
        assert.ok(target && !target.patrolId, `${cellId} 不该是承载格`);
    }
});

test('chapter_01：锚点与后端上报 territoryPatrolAnchorCell 完全同源', () => {
    const sites = loadChapter('chapter_01').sites as never;
    const byCell = territoryPatrolAnchorByCell(sites);
    const patrolSites = (sites as unknown as ISite[]).filter(s => s.type === 'patrolChest');
    for (const site of patrolSites) {
        assert.equal(
            territoryPatrolAnchorCell(site as never, sites),
            byCell.get(site.cellId) ?? site.cellId,
            `${site.cellId}：视图收敛与后端上报不许各写一套「谁才是那格」`,
        );
    }
    assert.equal(byCell.size, 31, '31 个站点格（footprint 与 cellId 相同）全部有映射');
});

test('carrier：巡逻格（含 footprint）全部指向锚点，战斗节点映射不受影响', () => {
    const sites = [
        patrol(401, 'wave_a'),
        patrol(402, 'wave_a', 50021, [402, 4021]),
        patrol(403, 'wave_a'),
    ];
    const carrier = territoryNodeCarrierByCell(sites as never);
    assert.equal(carrier.get(401), 402);
    assert.equal(carrier.get(402), 402, '配了野怪 id 的格映射自己');
    assert.equal(carrier.get(403), 402);
    assert.equal(carrier.get(4021), 402, 'footprint 也收敛到锚点');
    assert.deepEqual(Array.from(territoryNodeMutedCells(sites as never)).sort((a, b) => a - b),
        [401, 403, 4021]);
});

test('锁：同片 6 格被前置卡住 ⇒ 只在野怪 id 那格留一把', () => {
    const sites = loadChapter('chapter_01').sites as never;
    // patrolChest_158：331 是锚点，其余 5 格都没配 patrolId。
    const locked = [331, 330, 350, 370, 390, 391];
    assert.deepEqual(Array.from(territoryNodeLockCells(sites, locked)), [331],
        '参考异步 PVP：一片只画一处 UI，空地不画锁');
});

test('边界：整片都没配 patrolId 的旧图不收敛（不凭空隐掉整片 UI）', () => {
    const sites = [patrol(401, 'wave_old'), patrol(402, 'wave_old'), patrol(403, 'wave_old')] as never;
    assert.equal(territoryPatrolAnchorByCell(sites).size, 0);
    assert.equal(territoryNodeMutedCells(sites).size, 0);
    assert.deepEqual(Array.from(territoryNodeLockCells(sites, [401, 403])).sort((a, b) => a - b),
        [401, 403], '老图退回逐格画法');
    const site = (sites as unknown as ISite[])[0];
    assert.equal(territoryPatrolAnchorCell(site as never, sites), 401, '上报也退回自己');
});

test('边界：同片多格配了 patrolId ⇒ 那些格都显示，其余格仍隐', () => {
    const sites = [
        patrol(401, 'wave_a', 50005),
        patrol(402, 'wave_a'),
        patrol(403, 'wave_a', 50007),
    ] as never;
    const muted = territoryNodeMutedCells(sites);
    assert.deepEqual(Array.from(muted), [402]);
    const byCell = territoryPatrolAnchorByCell(sites);
    assert.equal(byCell.get(401), 401);
    assert.equal(byCell.get(403), 403);
    assert.equal(byCell.get(402), 401, '没配的格指向 cellId 最小的锚点');
});

test('边界：footprint 压到同片另一站点时，承载格不被覆盖', () => {
    const sites = [
        patrol(401, 'wave_a', undefined, [401, 402]),
        patrol(402, 'wave_a', 50021),
    ] as never;
    const byCell = territoryPatrolAnchorByCell(sites);
    assert.equal(byCell.get(402), 402, '402 自己是锚点，不许被 401 的 footprint 写成 402→402 之外的东西');
    assert.equal(byCell.get(401), 402);
    const muted = territoryNodeMutedCells(sites);
    assert.equal(muted.has(402), false, '承载格永远不进 muted');
    assert.equal(muted.has(401), true);
});

// ---------------------------------------------------------------------------
// 画法：跑真实 syncStations
// ---------------------------------------------------------------------------

test('画法：只有锚点显示银币价格与锁，兄弟格任何状态都是空地但仍可点', () => {
    const MapView = loadTerritoryMapViewClass() as new () => {
        createStation: (target: unknown) => unknown;
        syncStations: (input: unknown) => void;
    };
    const mapView = new MapView();
    const rendered = new Map<number, Record<string, unknown>>();
    mapView.createStation = (target: { cellId: number }) => ({
        setMapPosition() {},
        render(content: Record<string, unknown>) { rendered.set(target.cellId, content); },
    });

    const sites = [
        patrol(401, 'wave_a'),
        patrol(402, 'wave_a', 50021),
        patrol(403, 'wave_a'),
    ];
    const silverIcon = { name: 'silver icon' };
    const render = (unlockedCells: readonly number[], lockBlockedCells: readonly number[] = []) => {
        rendered.clear();
        mapView.syncStations(mapInputWithProjection({
            map: { startCellId: 0, sites, defaults: { staminaCost: 5 }, randomSites: { candidateCells: [] } },
            layout: { points: new Map([[401, { x: 0, y: 0 }], [402, { x: 10, y: 0 }], [403, { x: 20, y: 0 }]]) },
            revealedCells: [401, 402, 403],
            siteOpenableCells: [401, 402, 403],
            lockBlockedCells,
            pendingFixedResourceCells: [],
            pendingRandomResourceCells: [],
            stageByCell: new Map(),
            progress: {
                isCellUnlocked: (cellId: number) => unlockedCells.includes(cellId),
                isOwned: () => false,
                isAreaPassed: () => false,
                explorationAt: () => 0,
                checkUnlock: () => ({ ok: true }),
            },
            art: {
                randomSilverIcon: silverIcon,
                buildFrames: new Map(),
                levelBubbleFrame: { name: 'blue bubble' },
                levelBubblePendingFrame: { name: 'red bubble' },
            },
        }));
    };

    // ① 未解锁：锚点挂「银币 + 10」，兄弟格一个 UI 都不画。
    render([]);
    assert.equal(rendered.get(402)?.isCondition, true, '锚点展示激活银币 icon');
    assert.equal(rendered.get(402)?.caption, '10');
    assert.equal(rendered.get(402)?.conditionIcon, silverIcon);
    assert.equal(rendered.get(402)?.conditionChestIcon, null, '巡逻格不长宝箱外观');
    for (const cellId of [401, 403]) {
        const content = rendered.get(cellId);
        assert.equal(content?.caption, '', `${cellId} 不挂银币数量`);
        assert.equal(content?.isCondition, undefined, `${cellId} 不挂银币 icon`);
        assert.equal(content?.icon, null, `${cellId} 不画建筑`);
        assert.equal(content?.levelBubble, undefined, `${cellId} 不挂气泡`);
        assert.equal(content?.interactive, true, '🔴 隐 UI 不等于不可点，照常扣银币解锁');
    }

    // ② 锚点自己解锁后仍是唯一承载格（地形转草地，兄弟格不冒 UI）。
    render([402]);
    assert.equal(rendered.get(402)?.caption, '', '已解锁不再显示解锁消耗');
    assert.equal(rendered.get(401)?.caption, '', '兄弟格永远空着');
    assert.equal(rendered.get(403)?.isCondition, undefined);

    // ③ 同片任意格被前置卡住 ⇒ 锁收敛到锚点，锚点的价格整条摘掉（锁价互斥）。
    render([], [401, 403, 402]);
    assert.equal(rendered.get(402)?.isCondition, false,
        '整片算未解锁 ⇒ 只有锚点显示锁住的 icon，不会出现锁和银币同时存在');
    assert.equal(rendered.get(401)?.isCondition, undefined, '兄弟格不显示价格、也不显示锁');
    assert.equal(rendered.get(403)?.isCondition, undefined);
});

test('画法：普通宝箱 fixedResource 不参与巡逻收敛，仍各自显示价格', () => {
    const MapView = loadTerritoryMapViewClass() as new () => {
        createStation: (target: unknown) => unknown;
        syncStations: (input: unknown) => void;
    };
    const mapView = new MapView();
    const rendered = new Map<number, Record<string, unknown>>();
    mapView.createStation = (target: { cellId: number }) => ({
        setMapPosition() {},
        render(content: Record<string, unknown>) { rendered.set(target.cellId, content); },
    });
    const chest = (cellId: number): ISite => ({
        id: `chest_${cellId}`, type: 'fixedResource', cellId, footprint: [cellId],
        unlock: { requiredCells: [], combatPower: 0, silverCost: 15, exploreSeconds: 2, staminaCost: 5 },
        ...({ rewardId: 1016 } as object),
    });
    const sites = [chest(501), chest(502), ...[patrol(401, 'wave_a'), patrol(402, 'wave_a', 50021)]];
    mapView.syncStations(mapInputWithProjection({
        map: { startCellId: 0, sites, defaults: { staminaCost: 5 }, randomSites: { candidateCells: [] } },
        layout: { points: new Map(sites.map(s => [s.cellId, { x: s.cellId, y: 0 }])) },
        revealedCells: sites.map(s => s.cellId),
        siteOpenableCells: sites.map(s => s.cellId),
        pendingFixedResourceCells: [],
        pendingRandomResourceCells: [],
        stageByCell: new Map(),
        progress: {
            isCellUnlocked: () => false, isOwned: () => false, isAreaPassed: () => false,
            explorationAt: () => 0, checkUnlock: () => ({ ok: true }),
        },
        art: { randomSilverIcon: { name: 'silver' }, buildFrames: new Map() },
    }));
    for (const cellId of [501, 502]) {
        assert.equal(rendered.get(cellId)?.isCondition, true, `${cellId} 普通宝箱照旧显示价格`);
        assert.equal(rendered.get(cellId)?.caption, '15');
    }
    assert.equal(rendered.get(401)?.caption, '', '巡逻片非承载格仍然不显示');
    assert.equal(rendered.get(402)?.caption, '10');
});

// ---------------------------------------------------------------------------
// 源码守卫：不许把 patrolChest 塞进 nodeGroups 连带改地皮 / 框判据
// ---------------------------------------------------------------------------

test('守卫：NODE_SITE_TYPES 不含 patrolChest，地皮 / 红框 / 通关判据不受本次收敛影响', () => {
    const code = source('assets/script/app/territory/model/TerritoryNodeUI.ts');
    const block = code.match(/const NODE_SITE_TYPES[^;]*;/s)?.[0] ?? '';
    assert.match(block, /TERRITORY_SITE_TYPE\.stage/);
    assert.match(block, /TERRITORY_SITE_TYPE\.boss/);
    assert.match(block, /TERRITORY_SITE_TYPE\.asyncPvp/);
    assert.doesNotMatch(block, /patrolChest/,
        'nodeGroups 还供 territoryNodeStateCellByCell / GreyCells 使用，塞进 patrolChest 会连带改地皮与红框');
});

test('守卫：两套收敛都复用 territoryPatrolAnchorByCell，不另写一套分组', () => {
    const nodeUi = source('assets/script/app/territory/model/TerritoryNodeUI.ts');
    assert.match(nodeUi, /import \{ territoryPatrolAnchorByCell \} from '\.\/TerritoryMonsterPatrol'/);
    assert.match(nodeUi, /for \(const \[cell, anchor\] of territoryPatrolAnchorByCell\(sites\)\)/);
    const patrol = source('assets/script/app/territory/model/TerritoryMonsterPatrol.ts');
    assert.match(patrol, /export function territoryPatrolAnchorByCell\(/);
    assert.match(patrol, /territoryPatrolAnchorByCell\(sites\)\.get\(site\.cellId\)/,
        '后端上报必须委托同一份锚点表');
    // 画法依赖 stationRenderOf 的 muted 早退，删了价格就会回到「每格各画一条」。
    const view = source('assets/script/app/territory/view/TerritoryMapView.ts');
    assert.match(view, /if \(mutedCells\.has\(site\.cellId\)\)/);
    assert.match(view, /const mutedCells = territoryNodeMutedCells\(input\.map\.sites\)/);
    assert.match(view, /const lockCells = territoryNodeLockCells\(input\.map\.sites, input\.lockBlockedCells\)/);
});
