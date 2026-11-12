import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { territoryNodeLockCells, territoryNodeMutedCells } from '../assets/script/app/territory/model/TerritoryNodeUI';
import { loadTerritoryMapViewClass } from './helpers/territory-map-view-sandbox';

/**
 * 「一个节点只在一块地上长 UI」（用户 2026-11-09）。
 *
 * > 「关卡或者 boss 关卡，或者 pvp 据点，置于**建筑地块**上展示具体的 UI，
 * >  其他**同一节点**的地块不展示任何 UI。」
 *
 * 这批用例钉两件事：
 *  ① **分组判据**（哪些格子该隐）—— 真实七章数据 + 合成边界（全没建筑 / 全有建筑）；
 *  ② **画法**（隐掉的格真的什么都不画，但**仍然可点**）—— 沙箱跑 `syncStations`。
 *
 * ⚠️ 别把「隐 UI」理解成「不可点」：用户口径是「保留可点，照常解锁」，
 *    价格只是不画在格子上，消耗由点击后的确认弹窗承担。
 */

interface ISite {
    id: string;
    type: string;
    cellId: number;
    footprint: number[];
    configId?: string;
    buildingId?: string;
    unlock: { requiredCells: number[]; combatPower: number; silverCost: number; exploreSeconds: number; staminaCost: number };
}

function loadChapter(chapter: string): { sites: ISite[] } {
    return JSON.parse(readFileSync(`assets/resources/config/territory-maps/${chapter}.json`, 'utf8'));
}

function site(type: string, cellId: number, extra: Partial<ISite> = {}): ISite {
    return {
        id: `${type}_${cellId}`,
        type,
        cellId,
        footprint: [cellId],
        unlock: { requiredCells: [], combatPower: 0, silverCost: 30, exploreSeconds: 2, staminaCost: 5 },
        ...extra,
    };
}

test('chapter_01：13 组关卡里，没建筑的那 56 格全部不承载 UI', () => {
    const sites = loadChapter('chapter_01').sites;
    const muted = territoryNodeMutedCells(sites);
    assert.equal(muted.size, 56, 'chapter_01 一共 56 个「同节点、无建筑」的格子');

    // 10001 = 327（无建筑）+ 328（69004 建筑）⇒ 只隐 327。
    assert.ok(muted.has(327), '327 没配建筑 ⇒ 不画 UI');
    assert.ok(!muted.has(328), '328 是这一节点的建筑格 ⇒ UI 留在它身上');

    // 10002 = 288 / 309(建筑) / 310 ⇒ 隐两个。
    assert.ok(muted.has(288) && muted.has(310) && !muted.has(309));

    // 只要进了集合，就一定是**战斗站点且没有建筑** —— 别把宝箱/随机格误伤。
    const byCell = new Map(sites.map((s) => [s.cellId, s]));
    for (const cellId of muted) {
        const target = byCell.get(cellId);
        assert.ok(target, `${cellId} 必须是真实站点`);
        assert.ok(['stage', 'boss', 'asyncPvp'].includes(target.type), `${cellId} 只能是战斗站点`);
        assert.equal(target.buildingId ?? '', '', `${cellId} 不该有建筑`);
    }
    // 反向：所有「战斗站点 + 无建筑」的格子都必须被隐（没有漏网的）。
    const expected = sites
        .filter((s) => ['stage', 'boss', 'asyncPvp'].includes(s.type) && !s.buildingId)
        .map((s) => s.cellId)
        .sort((a, b) => a - b);
    assert.deepEqual(Array.from(muted).sort((a, b) => a - b), expected);
});

test('chapter_02~07：一个站点就是一整块 footprint，没有兄弟站 ⇒ 一格都不隐', () => {
    for (const chapter of ['chapter_02', 'chapter_03', 'chapter_04', 'chapter_05', 'chapter_06', 'chapter_07']) {
        const muted = territoryNodeMutedCells(loadChapter(chapter).sites);
        assert.equal(muted.size, 0, `${chapter} 不该有被隐的格子（非锚点格本来就不是站点）`);
    }
});

test('边界：同 configId 多格但「都没建筑」或「每格都有建筑」时保持现状', () => {
    const noBuilding = [site('stage', 1, { configId: '90001' }), site('stage', 2, { configId: '90001' })];
    assert.equal(territoryNodeMutedCells(noBuilding).size, 0,
        '一格建筑都没有 ⇒ 隐了整关就凭空消失，什么都不隐');

    const allBuilding = [
        site('stage', 1, { configId: '90002', buildingId: '69004' }),
        site('stage', 2, { configId: '90002', buildingId: '69004' }),
    ];
    assert.equal(territoryNodeMutedCells(allBuilding).size, 0, '每格都有自己的建筑 ⇒ 各自承载 UI');

    const mixed = [
        site('stage', 1, { configId: '90003' }),
        site('stage', 2, { configId: '90003', buildingId: '69004' }),
        site('stage', 3, { configId: '90003' }),
    ];
    assert.deepEqual(Array.from(territoryNodeMutedCells(mixed)).sort((a, b) => a - b), [1, 3]);
});

test('边界：非战斗站点、以及没有 configId 的站点不参与分组', () => {
    // 宝箱即使共用 configId + 有建筑，也不是「节点」，不能被隐。
    const chests = [
        site('fixedResource', 10, { configId: '91001' }),
        site('fixedResource', 11, { configId: '91001', buildingId: '69004' }),
    ];
    assert.equal(territoryNodeMutedCells(chests).size, 0);

    // 没有 configId 就无法判「同一节点」⇒ 保持现状（宁可不隐，也别乱隐）。
    const noConfig = [site('stage', 20), site('stage', 21, { buildingId: '69004' })];
    assert.equal(territoryNodeMutedCells(noConfig).size, 0);

    assert.equal(territoryNodeMutedCells([]).size, 0);
});

test('边界：兄弟站的 footprint 压到承载格时，承载格必须保住 UI', () => {
    const sites = [
        site('stage', 30, { configId: '92001', footprint: [30, 31], buildingId: '69004' }),
        site('stage', 31, { configId: '92001', footprint: [31] }),
    ];
    const muted = territoryNodeMutedCells(sites);
    assert.ok(!muted.has(31), '31 是承载站 footprint 的一部分 ⇒ 不许隐');
});

test('画法：兄弟格上不出现银币价格 / 编号气泡 / 建筑，但仍然可点', () => {
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
        site('stage', 327, { configId: '10001' }),
        site('stage', 328, { configId: '10001', buildingId: '69004' }),
    ];
    const stage = { levelId: 10001, chapterId: 1, stage: 1, isBoss: false };
    const building = { name: '69004 building' };
    const silverIcon = { name: 'silver icon' };
    const render = (unlockedCells: readonly number[]) => {
        rendered.clear();
        mapView.syncStations({
            map: { startCellId: 0, sites, defaults: { staminaCost: 5 }, randomSites: { candidateCells: [] } },
            layout: { points: new Map([[327, { x: 0, y: 0 }], [328, { x: 10, y: 10 }]]) },
            revealedCells: [327, 328],
            siteOpenableCells: [327, 328],
            pendingFixedResourceCells: [],
            pendingRandomResourceCells: [],
            stageByCell: new Map([[327, stage], [328, stage]]),
            progress: {
                isCellUnlocked: (cellId: number) => unlockedCells.includes(cellId),
                isOwned: () => false,
                isAreaPassed: () => false,
                explorationAt: () => 0,
                checkUnlock: () => ({ ok: true }),
            },
            art: {
                randomSilverIcon: silverIcon,
                buildFrames: new Map([[69004, building]]),
                levelBubbleFrame: { name: 'blue bubble' },
                levelBubblePendingFrame: { name: 'red bubble' },
            },
        });
    };

    // ① 未解锁：建筑格「银币 + 30」；**兄弟格一个 UI 都不画**
    //    （用户 2026-11-10：「和 boss 关卡是同一个节点的地块都不显示 UI，只有建筑虚影上显示 UI」）。
    render([]);
    assert.equal(rendered.get(328)?.isCondition, true, '建筑格展示价格');
    assert.equal(rendered.get(328)?.caption, '30');
    assert.equal(rendered.get(328)?.interactive, true);

    const sibling = rendered.get(327);
    assert.equal(sibling?.caption, '', '未解锁兄弟格不挂价格');
    assert.equal(sibling?.isCondition, undefined, '银币图标也不出现');
    assert.equal(sibling?.icon, null, '兄弟格不画建筑');
    assert.equal(sibling?.levelBubble, undefined, '兄弟格不挂编号气泡');
    assert.equal(sibling?.badge, '', '兄弟格不挂角标');
    assert.equal(sibling?.interactive, true, '🔴 兄弟格仍然可点、照常扣银币解锁');

    // ② 建筑格解锁：建筑 + 编号气泡长在建筑格；兄弟格**依旧空着**
    //    （2026-11-09 第四 / 五轮曾要求「解锁后兄弟格显示银币数量」「兄弟格跟 30 一样」，
    //     被本轮覆盖：同一关十几片褐色格各挂一条 35 读作"要买十几次"）。
    render([328]);
    assert.equal(rendered.get(328)?.icon, building, '建筑格解锁后长建筑');
    assert.equal(rendered.get(328)?.levelBubble, '1-1', '编号气泡只在建筑格');
    const siblingOpened = rendered.get(327);
    assert.equal(siblingOpened?.caption, '', '解锁后兄弟格仍然是空地');
    assert.equal(siblingOpened?.isCondition, undefined, '不挂银币图标');
    assert.equal(siblingOpened?.icon, null, '建筑仍然只在承载格画');
    assert.equal(siblingOpened?.levelBubble, undefined, '编号气泡仍只在建筑格');
    assert.equal(siblingOpened?.interactive, true, '兄弟格仍然可点、照常扣银币解锁');

    // ③ 兄弟格自己也解锁了 ⇒ 还是空地（地形转草地，不冒 UI）。
    render([327, 328]);
    assert.equal(rendered.get(327)?.caption, '', '自己已解锁也不挂价格');
    assert.equal(rendered.get(327)?.icon, null, '兄弟格永远不长建筑');
});

test('画法：不传 mutedCells 时行为与本改动之前逐格相同', () => {
    const MapView = loadTerritoryMapViewClass() as new () => {
        stationRenderOf: (site: unknown, input: unknown) => Record<string, unknown>;
    };
    const mapView = new MapView();
    const render = (mapView as unknown as {
        stationRenderOf: (site: unknown, input: unknown) => Record<string, unknown>;
    }).stationRenderOf.bind(mapView);
    const content = render(site('stage', 327, { configId: '10001' }), {
        stageByCell: new Map(), siteOpenableCells: [327], pendingFixedResourceCells: [],
        progress: { isCellUnlocked: () => false, isOwned: () => false, explorationAt: () => 0,
            checkUnlock: () => ({ ok: true }) },
        art: { randomSilverIcon: { name: 'silver' } },
    });
    assert.equal(content.caption, '30', '缺省 mutedCells ⇒ 老口径（每格各自显示价格）');
    assert.equal(content.isCondition, true);
    assert.equal(content.interactive, true);
});

// ---------------------------------------------------------------------------
// 锁：一个节点**只画一处**、就在建筑格上（用户 2026-11-10，覆盖 2026-11-09 第三轮的「每格都画」）
//
// > 「如果是未解锁，那么整个关卡节点就只有建筑虚影上显示锁住的 icon；
// >  如果是可激活，那么只有建筑虚影显示银币和数值 UI，不会出现锁和银币同时存在的情况。」
//
// 「组内任一格被卡住 ⇒ 整节点算未解锁」这一条仍然保留，只是落点从「空地也画」改成
// 「收敛到承载格」——截图里 `10005` 那 6 把锁 + 一个红 50（锁与价格并存）就是被这条修掉的。
// ---------------------------------------------------------------------------

test('锁：10005 首领 7 个单格站点 ⇒ 只收敛成建筑格 213 那一把', () => {
    const sites = loadChapter('chapter_01').sites;
    const bossCells = sites
        .filter((s) => s.type === 'boss' && s.configId === '10005')
        .map((s) => s.cellId);
    assert.equal(bossCells.length, 7, '这一组就是截图里那 7 个格');
    // 6 个兄弟格的前置要三只宝箱（253/232/231），任一格被卡 ⇒ 整节点未解锁 ⇒ 锁落在 213。
    assert.deepEqual(Array.from(territoryNodeLockCells(sites, bossCells)), [213],
        '空地不画锁（截图里那 6 把要收掉），整节点只在建筑格上留一把');
});

test('锁：chapter_02 起一关一块 footprint ⇒ 收敛到锚点那一格', () => {
    const sites = [
        { id: 'stage_1', type: 'stage', cellId: 328, footprint: [327, 328, 329],
            configId: '9001', buildingId: '69004' },
    ] as never;
    assert.deepEqual(Array.from(territoryNodeLockCells(sites, [327, 329])), [328],
        'footprint 的非锚点格不画锁');
});

test('锁：非节点格（宝箱 / 随机格）原样透传', () => {
    // 1 / 2 同 configId，但都不是 node 类型 ⇒ 各自一格一把锁（宝箱本来就没有"节点"可收）。
    const sites = [
        { id: 'a', type: 'stage', cellId: 1, footprint: [1], configId: '9002', buildingId: '' },
        { id: 'b', type: 'stage', cellId: 2, footprint: [2], configId: '9002', buildingId: '69004' },
    ] as never;
    assert.deepEqual(
        Array.from(territoryNodeLockCells(sites, [40, 41])).sort((a, b) => a - b),
        [40, 41],
    );
});

test('锁：空输入零改动', () => {
    const sites = loadChapter('chapter_01').sites;
    assert.equal(territoryNodeLockCells(sites, undefined).size, 0);
    assert.equal(territoryNodeLockCells(sites, []).size, 0);
    assert.deepEqual(Array.from(territoryNodeLockCells(sites, [9, 10])).sort((a, b) => a - b), [9, 10],
        '9 / 10 不属于任何节点组 ⇒ 透传');
});

test('Muted：兄弟格进 muted，承载格永远不进', () => {
    const sites = loadChapter('chapter_01').sites;
    const siblings = [156, 136, 135, 134];
    const muted = territoryNodeMutedCells(sites);
    assert.equal(muted.has(155), false, '建筑格永远不隐');
    for (const cell of siblings) assert.equal(muted.has(cell), true,
        `${cell} 进 muted：任何状态都不画 UI（价格 / 编号 / 建筑，见画法用例）`);
});
