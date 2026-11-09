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

// 🔴 2026-11-05 山猫：「不该多露空格」。锁标只叠在**本来就会露出来**的格上，
//    绝不能为了放锁把前沿的空格（cell 1）也揭示出来 —— 那会让地图边缘凭空长出一排灰地块。
test('a frontier cell without site or random candidate stays hidden', () => {
    const progress = new TerritoryProgress(map);
    // 1 是起点 0 的邻居，但既不是站点也不是随机候选 ⇒ 必须继续留在云里。
    assert.equal(territoryRevealedCells(map, progress).includes(1), false);
    progress.markCellUnlocked(4);
    assert.equal(territoryRevealedCells(map, progress).includes(1), false);
});

/**
 * 用户 2026-11-06（chapter_02）：
 *   「boss 关卡的解锁关系没有绑定到 2-9 的关卡中，**提前披露了**」。
 *
 * 根因：揭示侧原来判的是「前置格 ∈ `owned ∪ unlocked`」，而点击拦截
 * （`checkUnlock` → `prerequisiteBlockers` → `isPrerequisiteComplete`）判的是
 * 「关卡必须**通关**」。于是只要把 2-9 的格子花银币解锁、一枪不打，2-10 就露出来了。
 * 现在两边同源，下面的用例把这条钉住。
 */
const gateMap = configureTerritoryMap({
    version: 1, mapKind: 'territoryChapter', id: 'reveal-gate-level', name: 'reveal-gate-level',
    chapterId: 2, rows: 4, columns: 4, startCellId: 0, background: '',
    sites: [
        // 2-9：起点解锁，本身是关卡格
        { id: 'stage_8', type: 'stage', cellId: 4, footprint: [4], configId: '10019',
            unlock: { requiredCells: [0] } },
        // 2-10：前置 = 2-9 的格子
        { id: 'boss_2', type: 'boss', cellId: 9, footprint: [9], configId: '10020',
            unlock: { requiredCells: [4] } },
    ],
    randomSites: { triggerSilver: 10, rewardPoolId: '2001', candidateCells: [5], maxActive: 1 },
});

test('前置关卡只「解锁」没通关时，后继关卡（首领）不许提前揭示', () => {
    const progress = new TerritoryProgress(gateMap);
    // 2-9 已解锁（花银币开格）：自己露出、点得动，但还没打。
    progress.markCellUnlocked(4);
    const revealed = territoryRevealedCells(gateMap, progress);
    assert.equal(revealed.includes(4), true, '自己已解锁的格子当然要露出来');
    assert.equal(revealed.includes(9), false,
        '前置只解锁未通关 ⇒ 2-10 必须留在云里（原来这里会被提前揭示）');

    // 打完 2-9 ⇒ 2-10 才揭示。
    progress.markCellPassed(4);
    assert.equal(territoryRevealedCells(gateMap, progress).includes(9), true,
        '前置通关后，后继首领必须揭示');
});

/**
 * 用户 2026-11-06（chapter_02）：「**尚未通关就已经显示成已通过的蓝色气泡**」。
 *
 * 气泡变蓝 / 地块变草地都判 `isAreaPassed` ⇒ `owned`。而 `markCellsPassed` 原来把
 * 「解锁回包」整批记成通关（回包是**一片区域**的清单，实测请求 327 回 `[327,328]`）。
 * 只要回包里混进一个关卡 / 首领格，玩家没打也变成「已通关」。现在只认随机候选格。
 */
test('markCellsPassed 只把随机候选格记成通关，关卡 / 首领格一律不认', () => {
    const progress = new TerritoryProgress(gateMap);
    const added = progress.markCellsPassed([4, 9, 5]);
    assert.deepEqual(added, [5], '只有 5 是随机候选格');
    assert.equal(progress.isOwned(4), false, '关卡格不许被「解锁即通关」顺手记成通关');
    assert.equal(progress.isOwned(9), false, '首领格同理');
    assert.equal(progress.isOwned(5), true, '随机格解锁即通关，这条规则不能动');
});

test('没配 randomSites 的老地图：markCellsPassed 保持原样全收（兼容）', () => {
    const legacy = configureTerritoryMap({
        version: 1, mapKind: 'territoryChapter', id: 'reveal-legacy', name: 'reveal-legacy',
        chapterId: 1, rows: 4, columns: 4, startCellId: 0, background: '',
        sites: [{ id: 'fixed', type: 'fixedResource', cellId: 4, footprint: [4], rewardId: 1011 }],
    });
    const progress = new TerritoryProgress(legacy);
    assert.deepEqual(progress.markCellsPassed([4]), [4],
        '白名单为空 ⇒ 不做过滤，别把老图整章随机格搞失效');
});
