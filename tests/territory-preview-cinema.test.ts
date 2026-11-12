import assert from 'node:assert/strict';
import test from 'node:test';
import {
    TERRITORY_PREVIEW_CINEMA,
    stepTerritoryPreviewCinema,
    territoryPreviewCinema,
    type ITerritoryPreviewCinemaState,
} from '../assets/script/app/territory/model/TerritoryPreviewCinema';
import { loadTerritoryMapViewClass } from './helpers/territory-map-view-sandbox';

/**
 * 「预告首领关」过场（用户 2026-11-09 第二轮）：
 *
 * > ① 通过第 1 关的地块动画结束后，镜头移动到 boss 位置、屏幕居中；
 * > ② 云层消失 / 地块生成 / 建筑虚影 + 锁**同时**生成；
 * > ③ 动画结束停留 1s，镜头自动挪回初始位置。
 *
 * 分两批钉：**时间轴**（纯函数，段序 / 时长 / focus 曲线）与**接线**（沙箱跑 `renderMap`，
 * 验「起演条件」「压住哪些格」「放开时重渲染」）。
 */

const C = TERRITORY_PREVIEW_CINEMA;

/** 一帧一帧推到某个段为止（`dt` 固定 1/60），返回停下来的那一步。 */
function advanceTo(
    state: ITerritoryPreviewCinemaState,
    phase: string,
    dt = 1 / 60,
): ReturnType<typeof stepTerritoryPreviewCinema> {
    let step = { state, focus: 0, revealed: false, done: false } as ReturnType<typeof stepTerritoryPreviewCinema>;
    step = stepTerritoryPreviewCinema(state, 0);
    for (let i = 0; i < 600; i += 1) {
        step = stepTerritoryPreviewCinema(step.state, dt);
        if (step.state.phase === phase) return step;
    }
    throw new Error(`600 帧内没走到 ${phase}（停在 ${step.state.phase}）`);
}

test('段序：wait → pan → reveal → hold → back → done，总时长 = 四段之和', () => {
    const state = territoryPreviewCinema(0.3);
    let step = stepTerritoryPreviewCinema(state, 0);
    assert.equal(step.state.phase, 'wait');
    assert.equal(step.focus, 0, 'wait 段镜头不动');
    assert.equal(step.revealed, false, 'wait 段还不许放开被压住的格');

    step = advanceTo(step.state, 'pan');
    assert.equal(step.revealed, false, 'pan 段仍然压着（镜头还没到，放开了就白演）');

    step = advanceTo(step.state, 'reveal');
    assert.equal(step.revealed, true, '🔴 reveal 段必须放开压住的格 —— 五套动画靠这一下起手');
    assert.equal(step.focus, 1, 'reveal 段镜头已经在目标格上（居中）');

    step = advanceTo(step.state, 'hold');
    assert.equal(step.focus, 1);
    assert.equal(step.revealed, true);

    step = advanceTo(step.state, 'back');
    // ⚠️ 刚跨进 back 的那一帧 `elapsed` 可能正好是 0（focus 仍是 1），再走几帧才看得出在回。
    for (let i = 0; i < 6; i += 1) step = stepTerritoryPreviewCinema(step.state, 1 / 60);
    assert.ok(step.focus < 1, 'back 段镜头往回走');
    assert.equal(step.revealed, true, '往回走的时候地块必须还看得见');

    step = advanceTo(step.state, 'done');
    assert.equal(step.done, true);
    assert.equal(step.focus, 0, '收工时镜头必须回到原位');

    const total = 0.3 + C.panSeconds + C.revealSeconds + C.holdSeconds + C.backSeconds;
    let clock = 0;
    let walked = stepTerritoryPreviewCinema(territoryPreviewCinema(0.3), 0);
    while (!walked.done && clock < total + 1) {
        walked = stepTerritoryPreviewCinema(walked.state, 1 / 120);
        clock += 1 / 120;
    }
    assert.ok(Math.abs(clock - total) < 0.05, `总时长应约 ${total}s，实际 ${clock.toFixed(2)}s`);
});

test('focus 单调：推镜只涨不跌、归位只跌不涨，且落在 [0,1]', () => {
    let step = stepTerritoryPreviewCinema(territoryPreviewCinema(0), 0);
    let previous = 0;
    for (let i = 0; i < 200 && step.state.phase !== 'hold'; i += 1) {
        step = stepTerritoryPreviewCinema(step.state, 1 / 60);
        assert.ok(step.focus >= previous - 1e-6, '推镜途中 focus 不许回退');
        assert.ok(step.focus <= 1 && step.focus >= 0);
        previous = step.focus;
    }
    for (let i = 0; i < 200 && !step.done; i += 1) {
        const before = step.focus;
        step = stepTerritoryPreviewCinema(step.state, 1 / 60);
        assert.ok(step.focus <= before + 1e-6, '归位途中 focus 不许反弹');
    }
});

test('一大帧（切后台回来）能一次跨过好几段，不卡在 wait 里', () => {
    const state = territoryPreviewCinema(0.2);
    const step = stepTerritoryPreviewCinema(state, 10);
    assert.equal(step.state.phase, 'done');
    assert.equal(step.done, true);
    assert.equal(step.focus, 0);
});

test('waitSeconds 缺省 / 负数 / NaN 都当 0（直接开始推镜）', () => {
    for (const wait of [undefined, -1, Number.NaN]) {
        const step = stepTerritoryPreviewCinema(territoryPreviewCinema(wait as number), 0.01);
        assert.equal(step.state.phase, 'pan', `waitSeconds=${String(wait)} 不该卡在 wait`);
    }
});

// ---------------------------------------------------------------------------
// 接线：沙箱跑 renderMap（子步骤全换成桩，只验「起演 / 压住 / 放开」这条链）
// ---------------------------------------------------------------------------

interface IHarness {
    view: Record<string, unknown> & { renderMap: (input: unknown) => void };
    renders: number[][];
    previews: number[][];
}

function createHarness(): IHarness {
    const MapView = loadTerritoryMapViewClass() as new () => Record<string, unknown>;
    const view = new MapView() as unknown as IHarness['view'];
    const renders: number[][] = [];
    const previews: number[][] = [];
    Object.assign(view, {
        lastRenderInput: null,
        spawnBootstrapped: true,
        previewCinema: null,
        previewCinemaHold: new Set<number>(),
        previewSeen: new Set<number>(),
        previewCinemaRevealPending: false,
        cinemaRerendering: false,
        syncContentSize() {},
        syncBackground() {},
        syncGrid() {},
        syncClouds() {},
        syncFlip() {},
        syncStations(input: { revealedCells: number[]; previewCells?: number[] }) {
            renders.push(input.revealedCells.slice());
            previews.push((input.previewCells ?? []).slice());
        },
        syncGhosts() {},
        ensureOverlayHost() { return null; },
        cellPointInOverlay() { return { x: 10, y: 20, z: 0 }; },
        captureChestCamera() { (view as unknown as { chestCameraActive: boolean }).chestCameraActive = true; },
        applyChestCamera() {},
        setInputLocked() {},
    });
    return { view, renders, previews };
}

function bossMap() {
    const unlock = { requiredCells: [], combatPower: 0, silverCost: 30, exploreSeconds: 2, staminaCost: 5 };
    return {
        startCellId: 0,
        rows: 10,
        columns: 10,
        sites: [
            { id: 'boss_1', type: 'boss', cellId: 11, footprint: [11], configId: '10005', buildingId: '', unlock },
            { id: 'boss_2', type: 'boss', cellId: 12, footprint: [12], configId: '10005', buildingId: '69003', unlock },
        ],
        randomSites: { candidateCells: [] },
        defaults: { staminaCost: 5 },
    };
}

const BOSS_STAGE = { levelId: 10005, chapterId: 1, stage: 3, isBoss: true };

function input(overrides: Record<string, unknown> = {}) {
    return {
        map: bossMap(),
        layout: { points: new Map([[11, { x: 0, y: 0 }], [12, { x: 10, y: 10 }]]), width: 100, height: 100 },
        art: {},
        progress: { isCellUnlocked: () => false, isOwned: () => false, isAreaPassed: () => false },
        revealedCells: [11, 12],
        previewCells: [11, 12],
        victoryClaimCells: [3],
        siteOpenableCells: [],
        lockBlockedCells: [11, 12],
        stageByCell: new Map([[11, BOSS_STAGE], [12, BOSS_STAGE]]),
        randomResourceOpenableCells: [],
        pendingRandomResourceCells: [],
        pendingFixedResourceCells: [],
        wallet: { silver: 0, stamina: 0 },
        ...overrides,
    };
}

test('起演：刚通过一关 + 新披露了首领 ⇒ 压住这一批格（云不散、虚影不建）', () => {
    const { view, renders, previews } = createHarness();
    view.renderMap(input());
    assert.equal((view as unknown as { isPreviewCinemaPlaying: boolean }).isPreviewCinemaPlaying, true);
    assert.deepEqual(renders[0], [], '被压住的格不许进 revealedCells（否则云同一帧就散完）');
    assert.deepEqual(previews[0], [], '被压住的格也不许进 previewCells（否则虚影浮在云上）');
    assert.deepEqual(Array.from((view as unknown as { previewCinemaHold: Set<number> }).previewCinemaHold), [11, 12]);
});

test('起演条件：没通过关卡 / 首帧 / 非首领 / 没有新披露 ⇒ 都不演', () => {
    const cases: Array<[string, Record<string, unknown>]> = [
        ['没有胜利格（进页面首帧）', { victoryClaimCells: [] }],
        ['首帧（spawnBootstrapped = false）', { firstFrame: true }],
        ['新披露的是普通关（不是首领）', { stageByCell: new Map([[11, { ...BOSS_STAGE, isBoss: false }], [12, { ...BOSS_STAGE, isBoss: false }]]) }],
        ['没有新披露（上一轮已经见过）', { seenBefore: true }],
    ];
    for (const [label, extra] of cases) {
        const { view } = createHarness();
        if (extra.firstFrame) (view as unknown as { spawnBootstrapped: boolean }).spawnBootstrapped = false;
        if (extra.seenBefore) (view as unknown as { previewSeen: Set<number> }).previewSeen = new Set([11, 12]);
        view.renderMap(input(extra));
        assert.equal((view as unknown as { isPreviewCinemaPlaying: boolean }).isPreviewCinemaPlaying, false, label);
    }
});

test('放开：走到 reveal 段 ⇒ 清掉压住集合 + 就地重渲染一帧（五套动画同时起手）', () => {
    const { view, renders, previews } = createHarness();
    view.renderMap(input());
    assert.deepEqual(renders[0], []);

    // 推镜（0.55s）走完就该进 reveal 段。
    const stepPreview = (view as unknown as { stepPreviewCinema: (dt: number) => void }).stepPreviewCinema
        .bind(view);
    for (let i = 0; i < 120; i += 1) stepPreview(1 / 60);

    assert.equal(renders.length, 2, '放开时必须自己再渲染一帧，否则格子永远不出现');
    assert.deepEqual(renders[1], [11, 12], '重渲染时这一批格要回到 revealedCells');
    assert.deepEqual(previews[1], [11, 12], '虚影也要在这一帧建出来');
    assert.equal((view as unknown as { previewCinemaHold: Set<number> }).previewCinemaHold.size, 0);
});

test('收尾：时间轴走完 ⇒ 过场状态清空（剩下交给 cameraBusy 那条唯一收尾路径）', () => {
    const { view } = createHarness();
    view.renderMap(input());
    const stepPreview = (view as unknown as { stepPreviewCinema: (dt: number) => void }).stepPreviewCinema
        .bind(view);
    for (let i = 0; i < 60 * 6; i += 1) stepPreview(1 / 60);
    assert.equal((view as unknown as { isPreviewCinemaPlaying: boolean }).isPreviewCinemaPlaying, false);
    assert.equal((view as unknown as { previewCinemaHold: Set<number> }).previewCinemaHold.size, 0);
});

test('换章：作废过场与被压住的格（否则新图头几格永久不出现）', () => {
    const { view } = createHarness();
    view.renderMap(input());
    const cancel = (view as unknown as { cancelPreviewCinema: () => void }).cancelPreviewCinema.bind(view);
    cancel();
    assert.equal((view as unknown as { isPreviewCinemaPlaying: boolean }).isPreviewCinemaPlaying, false);
    assert.equal((view as unknown as { previewCinemaHold: Set<number> }).previewCinemaHold.size, 0);
    assert.equal((view as unknown as { previewSeen: Set<number> }).previewSeen.size, 0);
});
