import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
    ITerritoryBattleNavParams,
    ITerritoryCellGateway,
    ITerritoryChapterBundle,
    ITerritoryChapterLoader,
    ITerritoryChapterStore,
    ITerritoryPresenterPorts,
    TerritoryPresenter,
} from '../assets/script/app/territory/application/TerritoryPresenter';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { TERRITORY_PRESENTER_EVENTS } from '../assets/script/app/territory/view/TerritoryEvents';
import type { TerritoryCampaignStage } from '../assets/script/app/territory/model/TerritoryCampaignConfig';
import type {
    TerritoryChapterSave,
    TerritoryWallet,
} from '../assets/script/app/territory/model/TerritorySaveStore';
import type { TerritoryProgressData } from '../assets/script/app/territory/model/TerritoryProgress';
import type { ZCBattleStart } from '../assets/script/app/battle/BattleStartModel';
import type {
    TerritoryIdleRewardGain,
    TerritoryIdleRewardSource,
} from '../assets/script/app/territory/model/TerritoryIdleReward';
import type {
    TerritoryCellFetchResult,
    TerritoryStartBattleResult,
    TerritoryWriteResult,
} from '../assets/script/app/territory/application/TerritoryCellRepository';
import { emptyCellState, type ITerritoryCellState } from '../assets/script/app/territory/model/TerritoryCellBitSet';

// ── 夹具 ───────────────────────────────────────────────────────────────

const mapJson = {
    version: 1,
    mapKind: 'territoryChapter',
    id: 'test-map',
    name: '第一章',
    chapterId: 1,
    rows: 4,
    columns: 4,
    startCellId: 0,
    background: '',
    sites: [
        { id: 'stage_1', type: 'stage', cellId: 1, footprint: [1], configId: '1001' },
        { id: 'bonus_1', type: 'bonus', cellId: 2, footprint: [2] },
    ],
};

const stage: TerritoryCampaignStage = {
    levelId: 1001,
    chapterId: 1,
    stage: 1,
    mode: 'match',
    isBoss: false,
    enemyTeamId: 1,
    enemyTeamIds: [1],
    enemyTeamCardIds: [[11]],
    opponentCount: 1,
    enemies: [{ cardId: 101, pvpCardId: 11, name: '小怪兽', level: 1 }],
    waves: [],
    idleRewards: [{ resId: 1, name: '银币', amount: 100, probability: 10000 }],
    staminaCost: 5,
    exploreSeconds: 2,
    hpRate: 1,
    attackRate: 1,
};

const nullArt = {
    background: null,
    // 2026-10-16：单张 `tile` 拆成「未通关 / 已通关」两张地皮，另加四张格面框（见 paintHexes）。
    tileLocked: null,
    tileCleared: null,
    frameBoss: null,
    frameStage: null,
    frameAsyncPvp: null,
    frameChest: null,
    start: null,
    stage: null,
    boss: null,
    asyncPvp: null,
    fixedResource: null,
    randomResource: null,
    randomSilverIcon: null,
    bonus: null,
    header: null,
    navButton: null,
    actionButton: null,
};

const bundle: ITerritoryChapterBundle = {
    mapJson,
    campaign: { stages: [stage], playerCardCount: 3, idleRewardMaxHours: 8 },
    art: nullArt,
};

async function flush(ticks = 6): Promise<void> {
    for (let i = 0; i < ticks; i++) await new Promise((r) => setTimeout(r, 0));
}

// ── Fakes ──────────────────────────────────────────────────────────────

function createFakeLoader(loadResult: ITerritoryChapterBundle | null | 'throw' = bundle) {
    const calls: number[] = [];
    const loader: ITerritoryChapterLoader = {
        load: async (chapterId) => {
            calls.push(chapterId);
            if (loadResult === 'throw') throw new Error('network boom');
            return loadResult;
        },
    };
    return { loader, calls };
}

function createFakeGateway(options: {
    fetch?: TerritoryCellFetchResult;
    unlock?: TerritoryWriteResult;
    pass?: TerritoryWriteResult;
    start?: TerritoryStartBattleResult;
} = {}) {
    const calls = { fetch: 0, unlock: 0, unlockedCells: [] as number[],
        pass: 0, passedCells: [] as number[], startBattle: 0,
        battleTypes: [] as number[], battleParamsList: [] as string[][], clear: 0 };
    const gateway: ITerritoryCellGateway = {
        fetchChapterCells: async () => {
            calls.fetch++;
            return options.fetch ?? { ok: true, state: emptyCellState(1) };
        },
        unlockCell: async (_chapterId, cellId) => {
            calls.unlock++;
            calls.unlockedCells.push(cellId);
            return options.unlock ?? { ok: true };
        },
        passCell: async (_chapterId, cellId) => {
            calls.pass++;
            calls.passedCells.push(cellId);
            return options.pass ?? { ok: true };
        },
        startBattle: async (battleType, battleParams) => {
            calls.startBattle++;
            calls.battleTypes.push(battleType);
            calls.battleParamsList.push([...battleParams]);
            return options.start ?? { ok: true, battle: fakeBattleStart };
        },
        clear: () => { calls.clear++; },
    };
    return { gateway, calls };
}

const fakeBattleStart: ZCBattleStart = {
    battleId: 'b-10005', seed: '42', version: 'v1',
    units: [{ campId: 1, roleId: 'self', serverId: 1, name: 'player', power: 100,
        avatarId: '', headFrameId: '', gradeId: 1, gradeScore: 0, heroIds: [],
        artifactId: 0, artifactLevel: 0 }],
};

interface FakeStoreOptions {
    silver?: number;
    stamina?: number;
    ownedCells?: number[];
    randomResourceCells?: number[];
    battle?: TerritoryChapterSave['battle'];
    idleRewards?: { save: TerritoryChapterSave; rewards: TerritoryIdleRewardGain[]; settledHours: number; changed: boolean };
}

function createFakeStore(options: FakeStoreOptions = {}) {
    const calls = { saveProgress: 0, beginBattle: 0, settleIdle: 0, clearBattle: 0 };
    let lastChapter = 1;
    let save: TerritoryChapterSave = {
        version: 1,
        progress: options.ownedCells ? { ownedCells: options.ownedCells } : {},
        ...(options.randomResourceCells ? { randomResourceCells: options.randomResourceCells } : {}),
        wallet: { silver: options.silver ?? 10000, stamina: options.stamina ?? 100 },
        inventory: {},
        idleRewardAtByLevel: {},
        ...(options.battle ? { battle: options.battle } : {}),
    };
    const store: ITerritoryChapterStore = {
        loadLastChapter: () => lastChapter,
        saveLastChapter: (id) => { lastChapter = id; },
        load: () => save,
        saveProgress: (_id, progress, source) => {
            calls.saveProgress++;
            save = { ...source, progress: JSON.parse(JSON.stringify(progress)) };
            return save;
        },
        saveWallet: (_id, wallet, source) => {
            save = { ...source, wallet: { ...wallet } };
            return save;
        },
        settleIdleRewards: (
            _id, _sources: readonly TerritoryIdleRewardSource[], _maxHours, _now, source,
        ) => {
            calls.settleIdle++;
            return options.idleRewards
                ? { ...options.idleRewards, save: source }
                : { save: source, rewards: [], settledHours: 0, changed: false };
        },
        beginBattle: (_id, request, source) => {
            calls.beginBattle++;
            if (source.wallet.silver < request.silverCost)
                return { ok: false, reason: '银币不足', save: source };
            if (source.wallet.stamina < request.staminaCost)
                return { ok: false, reason: '体力不足', save: source };
            save = {
                ...source,
                wallet: {
                    silver: source.wallet.silver - request.silverCost,
                    stamina: source.wallet.stamina - request.staminaCost,
                },
                battle: {
                    chapterId: _id,
                    cellId: request.cellId,
                    levelId: request.levelId,
                    status: 'pending',
                    startedAt: Date.now(),
                },
            };
            return { ok: true, save };
        },
        clearBattle: (_id, source) => {
            calls.clearBattle++;
            const { battle: _battle, ...rest } = source;
            save = rest as TerritoryChapterSave;
            return save;
        },
    };
    return { store, calls };
}

// 🔴 2026-10-15 口径：**关卡（`stage` / `boss`）点一下就走解锁/开战，不再弹详情面板** ——
// 这条取代了原「一步式 stage 弹详情 + 点开始」的交互。两步式也不再是 `[327,328]` 的硬编码名单，
// 而是「站点类型 = 关卡」见定（见 `TerritoryMapConfig` 顶部那条历史口径注释）。
test('an initially locked stage unlocks on the first click without entering battle', async () => {
    const h = createHarness({ gateway: createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0], passCells: [0] },
    } }) });
    h.presenter.start();
    await flush();
    h.presenter.selectSite(h.presenter.state.map!.sites[0]);
    // 关卡不弹详情面板 —— 面板留给 asyncPvp / bonus / 待配表站点。
    assert.equal(h.presenter.state.detail.open, false, '关卡不再弹详情面板');
    await flush();
    assert.equal(h.gatewayCalls.unlock, 1, '未解锁 ⇒ 第一次点击只解锁');
    assert.equal(h.gatewayCalls.startBattle, 0, '未解锁 ⇒ 这一步不发开战请求');
    assert.equal(h.nav.length, 0, '解锁阶段不进战斗');
});

test('an already unlocked stage starts without sending a duplicate unlock', async () => {
    const h = createHarness({ gateway: createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0, 1], passCells: [0] },
    } }) });
    h.presenter.start();
    await flush();
    h.presenter.selectSite(h.presenter.state.map!.sites[0]);
    h.presenter.requestBattle();
    await flush();
    assert.equal(h.gatewayCalls.unlock, 0);
    assert.equal(h.nav.length, 1);
});

// 关卡版（原用例测的是「面板上的开始按钮」，那条路已被 2026-10-15 的统一口径取代）：
// 同一格的解锁还在飞时再点一次 ⇒ 旧的那次作废（`battleRequestId` 校验），只有最后一次记账。
test('re-clicking a stage while its unlock is in flight cancels the stale attempt', async () => {
    const pending: Array<(value: TerritoryWriteResult) => void> = [];
    const gateway = createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0], passCells: [0] },
    } });
    gateway.gateway.unlockCell = () => new Promise(resolve => pending.push(resolve));
    const h = createHarness({ gateway });
    h.presenter.start();
    await flush();
    const site = h.presenter.state.map!.sites[0];
    const other = h.presenter.state.map!.sites[1];
    h.presenter.selectSite(site);
    // 同一格的解锁还在飞 ⇒ 连点**不再**发第二次（`pendingFixedResourceCells` 挡）。
    h.presenter.selectSite(site);
    assert.equal(pending.length, 1, '★同一格的解锁在飞 ⇒ 连点不重复发请求');
    // 切到别的站点 ⇒ `cancelBattleRequest()` 递增 ⇒ 那一次回包作废。
    h.presenter.selectSite(other);
    pending[0]({ ok: true });
    await flush();
    assert.equal(h.presenter.state.progress?.isCellUnlocked(site.cellId), false,
        '★离开这一格之后，旧的解锁回包必须作废 —— 不记账，界面不会「莫名解锁」');
    assert.equal(h.tips.length, 0, '作废的回包连提示都不给');
});

test('selecting a different site invalidates an in-flight battle', async () => {
    let finish!: (value: TerritoryWriteResult) => void;
    const gateway = createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0, 2], passCells: [0] },
    } });
    gateway.gateway.unlockCell = () => new Promise(resolve => { finish = resolve; });
    const h = createHarness({ gateway });
    h.presenter.start();
    await flush();
    h.presenter.selectSite(h.presenter.state.map!.sites[0]);
    h.presenter.requestBattle();
    h.presenter.selectSite(h.presenter.state.map!.sites[1]);
    finish({ ok: true });
    await flush();
    assert.equal(h.nav.length, 0);
    assert.equal(h.storeCalls.beginBattle, 0);
});

test('a stage victory stays owned locally, never sends passCell, and waits for a server snapshot', async () => {
    const store = createFakeStore({ battle: {
        chapterId: 1, cellId: 1, levelId: 1001, status: 'victory', startedAt: 100, resolvedAt: 200,
    } });
    // 服务端快照：格子已解锁、但还没确认通关（passCells 空）。
    const fetch: TerritoryCellFetchResult = {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [1], passCells: [] },
    };
    const first = createHarness({ store, gateway: createFakeGateway({ fetch }) });
    first.presenter.start();
    await flush();
    // 🔴 关卡通关不发 passCell —— 发了只会被「章节格子非资源类型」拒绝。
    assert.equal(first.gatewayCalls.pass, 0);
    assert.equal(first.presenter.state.progress?.isOwned(1), true);
    assert.deepEqual(first.presenter.state.progress?.pendingPassCells, [1]);
    first.presenter.dispose();
    // 重进：服务端仍未确认 ⇒ 仍不发 pass，待确认记录保留，本地占领不丢。
    const reopened = createHarness({ store, gateway: createFakeGateway({ fetch }) });
    reopened.presenter.start();
    await flush();
    assert.equal(reopened.gatewayCalls.pass, 0);
    assert.equal(reopened.presenter.state.progress?.isOwned(1), true);
    assert.deepEqual(reopened.presenter.state.progress?.pendingPassCells, [1]);
    reopened.presenter.dispose();
    // 服务端快照确认通关（passCells 含 1）⇒ 清待确认，仍不发 pass。
    const confirmed = createHarness({ store, gateway: createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [1], passCells: [1] },
    } }) });
    confirmed.presenter.start();
    await flush();
    assert.equal(confirmed.gatewayCalls.pass, 0);
    assert.equal(confirmed.presenter.state.progress?.isOwned(1), true);
    assert.deepEqual(confirmed.presenter.state.progress?.pendingPassCells, []);
});

test('offline victory is retained, retries the unlock, and never sends passCell', async () => {
    const h = createHarness({ store: createFakeStore({ battle: {
        chapterId: 1, cellId: 1, levelId: 1001, status: 'victory', startedAt: 100, resolvedAt: 200,
    } }) });
    h.presenter.start();
    await flush();
    // 本地立即记为已占领（乐观展示）。
    assert.equal(h.presenter.state.progress?.isOwned(1), true);
    // 服务端快照缺解锁 ⇒ 补 unlock（让服务端知道这格），但不发 passCell。
    assert.equal(h.gatewayCalls.unlock, 1);
    assert.equal(h.gatewayCalls.pass, 0);
    // 服务端还没确认通关 ⇒ 待确认记录保留。
    assert.deepEqual(h.presenter.state.progress?.pendingPassCells, [1]);
});

test('offline victory retries the missing unlock and then waits for the server push', async () => {
    const gateway = createFakeGateway();
    const writes: string[] = [];
    gateway.gateway.unlockCell = async (_chapter, cell) => {
        writes.push(`unlock:${cell}`);
        return { ok: true };
    };
    gateway.gateway.passCell = async (_chapter, cell) => {
        writes.push(`pass:${cell}`);
        return { ok: true };
    };
    const h = createHarness({ gateway, store: createFakeStore({ battle: {
        chapterId: 1, cellId: 1, levelId: 1001, status: 'victory', startedAt: 100, resolvedAt: 200,
    } }) });
    h.presenter.start();
    await flush();
    // 只补 unlock；passCell 一次都不发（服务端会主动下发通关状态）。
    assert.deepEqual(writes, ['unlock:1']);
});

test('the pending pass is saved before any request and survives a dispose during the unlock', async () => {
    const store = createFakeStore({ battle: {
        chapterId: 1, cellId: 1, levelId: 1001, status: 'victory', startedAt: 100, resolvedAt: 200,
    } });
    // 默认空快照：格子还没解锁，reportPendingPasses 会补 unlock。
    let finish!: (result: TerritoryWriteResult) => void;
    const gateway = createFakeGateway();
    gateway.gateway.unlockCell = () => {
        // 补 unlock 在途：待确认队列此时已先落盘（防关页丢失）。
        assert.deepEqual(store.store.load(1, { silver: 0, stamina: 0 }).progress.pendingPassCells, [1]);
        return new Promise(resolve => { finish = resolve; });
    };
    const h = createHarness({ store, gateway });
    h.presenter.start();
    await flush();
    // 补解锁在途时关页 ⇒ 安全，不崩、不弹错误 tip。
    h.presenter.dispose();
    finish({ ok: true });
    await flush();
    assert.equal(h.tips.length, 0);
    assert.equal(h.gatewayCalls.pass, 0);
    // 重进：服务端快照确认通关 ⇒ 清待确认，仍不发 pass。
    const reopened = createHarness({ store, gateway: createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [1], passCells: [1] },
    } }) });
    reopened.presenter.start();
    await flush();
    assert.equal(reopened.gatewayCalls.pass, 0);
    assert.deepEqual(store.store.load(1, { silver: 0, stamina: 0 }).progress.pendingPassCells, []);
});

test('repeated ticks cannot duplicate an in-flight unlock, and never send passCell', async () => {
    // 默认空快照：格子未解锁，reportPendingPasses 走补 unlock。
    const gateway = createFakeGateway();
    let unlockAttempts = 0;
    let finishUnlock!: (result: TerritoryWriteResult) => void;
    gateway.gateway.unlockCell = () => {
        unlockAttempts++;
        return new Promise(resolve => { finishUnlock = resolve; });
    };
    const h = createHarness({ gateway, store: createFakeStore({ battle: {
        chapterId: 1, cellId: 1, levelId: 1001, status: 'victory', startedAt: 100, resolvedAt: 200,
    } }) });
    h.presenter.start();
    await flush();
    // 补 unlock 在途：多次 tick 因 reportingLoadId 锁不会重复发。
    h.presenter.slowTick(Date.now() + 60000);
    h.presenter.slowTick(Date.now() + 120000);
    assert.equal(unlockAttempts, 1);
    assert.equal(h.gatewayCalls.pass, 0);
    // unlock 因断线未完成 ⇒ 下一轮重试一次。
    finishUnlock({ ok: false, reason: 'offline' });
    await flush();
    h.presenter.slowTick(Date.now() + 180000);
    assert.equal(unlockAttempts, 2);
    finishUnlock({ ok: true });
    await flush();
    // 始终不发 passCell；服务端未确认通关前待确认记录保留。
    assert.equal(h.gatewayCalls.pass, 0);
    assert.deepEqual(h.presenter.state.progress?.pendingPassCells, [1]);
    // 重进，服务端快照确认通关 ⇒ 清待确认，仍不发 pass。
    h.presenter.dispose();
    const reopened = createHarness({ gateway: createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [1], passCells: [1] },
    } }) });
    reopened.presenter.start();
    await flush();
    assert.equal(reopened.gatewayCalls.pass, 0);
    assert.deepEqual(reopened.presenter.state.progress?.pendingPassCells, []);
});

test('a server-pushed CellInfo confirms the pending pass without sending passCell', async () => {
    let pushCellInfo: ((state: ITerritoryCellState) => void) | null = null;
    const gateway = createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [1], passCells: [] },
    } });
    gateway.gateway.listenCellInfo = (_maxCell: number, onState: (state: ITerritoryCellState) => void) => {
        pushCellInfo = onState;
    };
    gateway.gateway.unlistenCellInfo = () => { pushCellInfo = null; };
    const h = createHarness({ gateway, store: createFakeStore({ battle: {
        chapterId: 1, cellId: 1, levelId: 1001, status: 'victory', startedAt: 100, resolvedAt: 200,
    } }) });
    h.presenter.start();
    await flush();
    // 战斗胜利：本地已占领、待确认、不发 passCell。
    assert.equal(h.presenter.state.progress?.isOwned(1), true);
    assert.deepEqual(h.presenter.state.progress?.pendingPassCells, [1]);
    assert.equal(h.gatewayCalls.pass, 0);
    // 服务端主动下发完整快照（含通关 1）⇒ 清待确认、刷新，仍不发 passCell。
    assert.equal(typeof pushCellInfo, 'function');
    pushCellInfo?.({ levelChapter: 1, rewardState: 0, unlockCells: [1], passCells: [1] });
    assert.deepEqual(h.presenter.state.progress?.pendingPassCells, []);
    assert.equal(h.presenter.state.progress?.isOwned(1), true);
    assert.equal(h.gatewayCalls.pass, 0);
    // 重复推送幂等：再来一次没有新增、不报错。
    pushCellInfo?.({ levelChapter: 1, rewardState: 0, unlockCells: [1], passCells: [1] });
    assert.deepEqual(h.presenter.state.progress?.pendingPassCells, []);
    // 别的章节的下发必须被忽略。
    pushCellInfo?.({ levelChapter: 2, rewardState: 0, unlockCells: [1], passCells: [1] });
    assert.equal(h.presenter.state.progress?.isOwned(1), true);
});

function createOutputs() {
    const tips: string[] = [];
    const rewards: { resId: number; amount: number }[][] = [];
    /** 与 `rewards` 逐条对应的「来源格」；`null` = 挂机产出这类没有格子的发奖。 */
    const rewardOrigins: (number | null | undefined)[] = [];
    const nav: ITerritoryBattleNavParams[] = [];
    const battles: (ZCBattleStart | undefined)[] = [];
    const outputs = {
        navigateToBattle: (pve: ITerritoryBattleNavParams, battle?: ZCBattleStart) => {
            nav.push(pve);
            battles.push(battle);
        },
        showTip: (text: string) => tips.push(text),
        showRewards: (
            gains: readonly { resId: number; amount: number }[],
            originCellId?: number | null,
        ) => {
            rewards.push(gains.map((g) => ({ ...g })));
            rewardOrigins.push(originCellId);
        },
    };
    return { outputs, tips, rewards, rewardOrigins, nav, battles };
}

interface HarnessOptions {
    chapters?: readonly number[];
    loader?: ReturnType<typeof createFakeLoader>;
    gateway?: ReturnType<typeof createFakeGateway>;
    store?: ReturnType<typeof createFakeStore>;
    outputs?: ReturnType<typeof createOutputs>;
    serverWallet?: () => TerritoryWallet | null;
}

function createHarness(options: HarnessOptions = {}) {
    const loader = options.loader ?? createFakeLoader();
    const gateway = options.gateway ?? createFakeGateway();
    const store = options.store ?? createFakeStore();
    const outputs = options.outputs ?? createOutputs();
    let stateChanges = 0;
    const ports: ITerritoryPresenterPorts = {
        loader: loader.loader,
        gateway: gateway.gateway,
        store: store.store,
        outputs: outputs.outputs,
        walletSeed: (): TerritoryWallet => ({ silver: 10000, stamina: 100 }),
        readServerWallet: () => options.serverWallet?.() ?? null,
        availableChapters: options.chapters ?? [1],
    };
    const presenter = new TerritoryPresenter(ports);
    // 订阅挂在 `EventMgr` 全局中控上，target = presenter：`presenter.dispose()` 里 `offTarget(this)` 一并摘净。
    EventMgr.instance.on(TERRITORY_PRESENTER_EVENTS.StateChange, () => { stateChanges++; }, presenter);
    return {
        presenter,
        stateChanges: () => stateChanges,
        loaderCalls: loader.calls,
        gatewayCalls: gateway.calls,
        storeCalls: store.calls,
        ...outputs,
    };
}

// ── 加载生命周期 ───────────────────────────────────────────────────────

test('start renders the ready state from the bundle without locking the page', async () => {
    const h = createHarness();
    h.presenter.start();
    assert.equal(h.presenter.state.ready, false);
    await flush();
    assert.equal(h.presenter.state.ready, true);
    assert.equal(h.presenter.state.map?.id, 'test-map');
    assert.match(h.presenter.state.hud?.chapterText ?? '', /第一章/);
    assert.equal(h.presenter.state.detail.open, false);
});

test('random resource is generated once and persisted outside fixed sites', async () => {
    const randomBundle: ITerritoryChapterBundle = {
        ...bundle,
        mapJson: { ...mapJson, randomSites: {
            triggerSilver: 10, rewardPoolId: '2001', candidateCells: [4], maxActive: 1,
        } },
    };
    const saved = createFakeStore();
    const h = createHarness({ loader: createFakeLoader(randomBundle), store: saved });
    h.presenter.start();
    await flush();
    assert.deepEqual(h.presenter.state.randomResourceCells, [4]);
    assert.equal(h.presenter.state.map?.sites.some((site) => site.cellId === 4), false);
    assert.deepEqual(h.presenter.state.randomResourceOpenableCells, [4]);
    h.presenter.start();
    await flush();
    assert.deepEqual(h.presenter.state.randomResourceCells, [4]);
});

test('random candidate openability follows six-neighbor developed cells', async () => {
    const randomBundle: ITerritoryChapterBundle = {
        ...bundle,
        mapJson: { ...mapJson, randomSites: {
            triggerSilver: 10, rewardPoolId: '2001', candidateCells: [15], maxActive: 1,
        } },
    };
    const h = createHarness({ loader: createFakeLoader(randomBundle) });
    h.presenter.start();
    await flush();
    assert.equal(h.presenter.state.randomResourceOpenableCells.length, 0);
    const owned = createHarness({
        loader: createFakeLoader(randomBundle),
        store: createFakeStore({ ownedCells: [14] }),
    });
    owned.presenter.start();
    await flush();
    assert.deepEqual(owned.presenter.state.randomResourceOpenableCells, [15]);
});

test('random resource appears on first load even below the silver threshold', async () => {
    const randomBundle: ITerritoryChapterBundle = {
        ...bundle,
        mapJson: { ...mapJson, randomSites: {
            triggerSilver: 10, rewardPoolId: '2001', candidateCells: [4], maxActive: 1,
        } },
    };
    const h = createHarness({
        loader: createFakeLoader(randomBundle), store: createFakeStore({ silver: 0 }),
    });
    h.presenter.start();
    await flush();
    assert.deepEqual(h.presenter.state.randomResourceCells, [4]);
    assert.deepEqual(h.presenter.state.randomResourceOpenableCells, []);
});

test('published chapter one renders a default random resource with zero silver', async () => {
    const publishedMap = JSON.parse(readFileSync(
        'assets/resources/config/territory-maps/chapter_01.json', 'utf8'));
    const h = createHarness({
        loader: createFakeLoader({ ...bundle, mapJson: publishedMap }),
        store: createFakeStore({ silver: 0 }),
    });
    h.presenter.start();
    await flush();
    const state = h.presenter.state;
    assert.equal(state.randomResourceCells.length, 1);
    const cellId = state.randomResourceCells[0];
    assert.ok(state.map?.randomSites?.candidateCells.includes(cellId));
    assert.ok(state.layout.points.has(cellId));
    assert.equal(state.map?.sites.some((site) => site.cellId === cellId), false);
    assert.deepEqual(state.randomResourceOpenableCells, []);
});

test('old nonadjacent random placement moves beside owned territory', async () => {
    const randomBundle: ITerritoryChapterBundle = {
        ...bundle,
        mapJson: { ...mapJson, randomSites: {
            triggerSilver: 10, rewardPoolId: '2001', candidateCells: [4, 15], maxActive: 1,
        } },
    };
    const h = createHarness({
        loader: createFakeLoader(randomBundle),
        store: createFakeStore({ randomResourceCells: [15], silver: 0 }),
    });
    h.presenter.start();
    await flush();
    assert.deepEqual(h.presenter.state.randomResourceCells, [4]);
    assert.deepEqual(h.presenter.state.randomResourceOpenableCells, []);
});

test('published random candidate 346 unlocks directly beside 326 and 347', async () => {
    const publishedMap = JSON.parse(readFileSync(
        'assets/resources/config/territory-maps/chapter_01.json', 'utf8'));
    const h = createHarness({
        loader: createFakeLoader({ ...bundle, mapJson: publishedMap }),
        gateway: createFakeGateway({ fetch: {
            ok: true,
            state: { levelChapter: 1, rewardState: 0,
                unlockCells: [326, 347, 348, 367], passCells: [367] },
        } }),
        store: createFakeStore({ silver: 3000, stamina: 1551 }),
    });
    h.presenter.start();
    await flush();
    assert.ok(h.presenter.state.randomResourceOpenableCells.includes(346));
    // 点格直接开启，不经过详情面板。
    h.presenter.selectRandomResource(346);
    await flush();
    assert.equal(h.presenter.state.detail.open, false);
    assert.deepEqual(h.gatewayCalls.unlockedCells, [346]);
    assert.deepEqual(h.gatewayCalls.passedCells, []);
    assert.equal(h.presenter.state.progress?.isCellUnlocked(346), true);
    // 随机格解锁即通关：地块立即进入已占领（绿色 mapOwned），且不产生通关请求。
    assert.equal(h.presenter.state.progress?.isOwned(346), true);
    assert.deepEqual(h.presenter.state.progress?.pendingPassCells, []);
    // 已开的格子再点不发第二次请求。
    h.presenter.selectRandomResource(346);
    await flush();
    assert.equal(h.gatewayCalls.unlock, 1);
});

test('random cell unlock is an instant pass: tile owned right away, no pass request', async () => {
    const randomBundle: ITerritoryChapterBundle = {
        ...bundle,
        mapJson: { ...mapJson, randomSites: {
            triggerSilver: 10, rewardPoolId: '2001', candidateCells: [4, 5], maxActive: 1,
        } },
    };
    // 服务端回包可能带整片格子（同区域批量解锁），这里模拟回 [4, 5]。
    const gateway = createFakeGateway();
    gateway.gateway.unlockCell = async () => ({ ok: true, unlockedCellIds: [4, 5] });
    const h = createHarness({
        loader: createFakeLoader(randomBundle), gateway,
        store: createFakeStore({ silver: 500, stamina: 100 }),
    });
    h.presenter.start();
    await flush();
    h.presenter.selectRandomResource(4);
    await flush();
    const progress = h.presenter.state.progress!;
    assert.equal(progress.isOwned(4), true, '回包内格子立即变已占领');
    assert.equal(progress.isOwned(5), true);
    assert.equal(progress.isCellUnlocked(4), true);
    assert.deepEqual(progress.pendingPassCells, []);
    assert.equal(h.gatewayCalls.pass, 0, '随机格不发通关请求');
    // 已通关的随机格不影响章节完成度分母（本夹具无 boss 绑定，仅 stage）。
    assert.match(h.presenter.state.hud!.chapterText, /已占领 0\/1/);
});

test('random unlock uses server wallet updates for the HUD and next-cell eligibility', async () => {
    const randomBundle: ITerritoryChapterBundle = {
        ...bundle,
        mapJson: { ...mapJson, randomSites: {
            triggerSilver: 10, rewardPoolId: '2001', candidateCells: [4, 7], maxActive: 1,
        } },
    };
    let serverWallet: TerritoryWallet = { silver: 10, stamina: 5 };
    const gateway = createFakeGateway();
    gateway.gateway.unlockCell = async () => {
        serverWallet = { silver: 0, stamina: 0 };
        return { ok: true };
    };
    const h = createHarness({
        loader: createFakeLoader(randomBundle), gateway,
        store: createFakeStore({ silver: 500, stamina: 100 }),
        serverWallet: () => serverWallet,
    });
    h.presenter.start();
    await flush();
    assert.deepEqual(h.presenter.state.randomResourceOpenableCells, [4]);
    assert.match(h.presenter.state.hud!.walletText, /银币 10\s+体力 5/);
    h.presenter.selectRandomResource(4);
    await flush();
    assert.equal(h.presenter.state.progress?.isCellUnlocked(4), true);
    assert.deepEqual(h.presenter.state.randomResourceOpenableCells, []);
    assert.match(h.presenter.state.hud!.walletText, /银币 0\s+体力 0/);
});

test('role cache push refreshes an open territory page wallet', async () => {
    let serverWallet: TerritoryWallet = { silver: 20, stamina: 10 };
    const h = createHarness({ serverWallet: () => serverWallet });
    h.presenter.start();
    await flush();
    serverWallet = { silver: 7, stamina: 3 };
    h.presenter.refreshWalletFromServer();
    assert.match(h.presenter.state.hud!.walletText, /银币 7\s+体力 3/);
});

test('random candidate keeps one pending request and stays closed after server rejection', async () => {
    const randomBundle: ITerritoryChapterBundle = {
        ...bundle,
        mapJson: { ...mapJson, randomSites: {
            triggerSilver: 10, rewardPoolId: '2001', candidateCells: [4], maxActive: 1,
        } },
    };
    let finish!: (result: TerritoryWriteResult) => void;
    let requests = 0;
    const gateway = createFakeGateway();
    gateway.gateway.unlockCell = () => {
        requests++;
        return new Promise(resolve => { finish = resolve; });
    };
    const h = createHarness({ loader: createFakeLoader(randomBundle), gateway });
    h.presenter.start();
    await flush();
    h.presenter.selectRandomResource(4);
    // 连点两下随机资源也只发一次请求（pending 去重仍在）。
    h.presenter.selectRandomResource(4);
    assert.equal(requests, 1);
    assert.deepEqual(h.presenter.state.pendingRandomResourceCells, [4]);
    finish({ ok: false, reason: 'rejected' });
    await flush();
    assert.equal(h.presenter.state.progress?.isCellUnlocked(4), false);
    assert.deepEqual(h.presenter.state.pendingRandomResourceCells, []);
    assert.deepEqual(h.presenter.state.randomResourceOpenableCells, [4]);
});

test('random candidate shows a resource tip without opening details when silver or stamina is insufficient', async () => {
    const randomBundle: ITerritoryChapterBundle = {
        ...bundle,
        mapJson: { ...mapJson, randomSites: {
            triggerSilver: 10, rewardPoolId: '2001', candidateCells: [4], maxActive: 1,
        } },
    };
    for (const wallet of [{ silver: 9, stamina: 100 }, { silver: 100, stamina: 4 }]) {
        const h = createHarness({ loader: createFakeLoader(randomBundle), store: createFakeStore(wallet) });
        h.presenter.start();
        await flush();
        assert.deepEqual(h.presenter.state.randomResourceOpenableCells, []);
        h.presenter.selectRandomResource(4);
        await flush();
        assert.equal(h.presenter.state.detail.open, false);
        assert.equal(h.gatewayCalls.unlock, 0);
        assert.equal(h.presenter.state.progress?.isCellUnlocked(4), false);
        assert.equal(h.tips[h.tips.length - 1], wallet.silver < 10 ? '银币不足' : '体力不足');
    }
});

test('loader returning null leaves the page empty and shows the load-failed tip', async () => {
    const h = createHarness({ loader: createFakeLoader(null) });
    h.presenter.start();
    await flush();
    assert.equal(h.presenter.state.ready, false);
    assert.equal(h.tips[h.tips.length - 1], '领地数据加载失败\n请检查关卡与怪物卡牌配置');
});

test('loader throwing leaves the page empty and shows the load-failed tip', async () => {
    const h = createHarness({ loader: createFakeLoader('throw') });
    h.presenter.start();
    await flush();
    assert.equal(h.tips[h.tips.length - 1], '领地数据加载失败\n请检查关卡与怪物卡牌配置');
});

test('fetchChapterCells failure does not block the page (fail-open)', async () => {
    const h = createHarness({
        gateway: createFakeGateway({
            fetch: { ok: false, reason: 'offline', state: emptyCellState(1) },
        }),
    });
    h.presenter.start();
    await flush();
    assert.equal(h.presenter.state.ready, true);
    assert.equal(h.gatewayCalls.fetch, 1);
});

// ── 站点详情 ───────────────────────────────────────────────────────────

// 🔴 口径反转（2026-10-15）：关卡（`stage`/`boss`）**不再弹详情面板**，点一下直接走解锁→开战。
// 面板只留给 asyncPvp / bonus / 待配表站点 —— 这条用例就是这次反转的判据。
test('selectSite on a bound stage does NOT open the detail (stages start on click)', async () => {
    const h = createHarness({
        gateway: createFakeGateway({
            fetch: {
                ok: true,
                state: { levelChapter: 1, rewardState: 0, unlockCells: [1], passCells: [] },
            },
        }),
    });
    h.presenter.start();
    await flush();
    const { detail } = h.presenter.state;
    assert.equal(detail.open, false, '关卡不弹面板');
    h.presenter.selectSite(h.presenter.state.map!.sites[0]);
    assert.equal(h.presenter.state.detail.open, false, '关卡点了也不弹面板');
    await flush();
    assert.equal(h.gatewayCalls.startBattle, 1, '已解锁的关卡第一次点击就发开战请求');
});

test('selectSite on an unbound site opens the detail with no start button', async () => {
    const h = createHarness({ gateway: createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0, 2], passCells: [0] },
    } }) });
    h.presenter.start();
    await flush();
    h.presenter.selectSite(h.presenter.state.map!.sites[1]);
    const { detail } = h.presenter.state;
    assert.equal(detail.open, true);
    assert.equal(detail.content?.startEnabled, false);
    assert.match(detail.content?.title ?? '', /站点配置待补齐/);
});

test('clicking a fixed resource unlocks it directly without opening detail', async () => {
    const fixedBundle: ITerritoryChapterBundle = {
        ...bundle,
        mapJson: { ...mapJson, sites: [...mapJson.sites, {
            id: 'fixed_326', type: 'fixedResource', cellId: 4,
            footprint: [4], rewardId: 1011,
        }] },
    };
    const h = createHarness({
        loader: createFakeLoader(fixedBundle),
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0], passCells: [0] },
        } }),
    });
    h.presenter.start();
    await flush();
    // （2026-10-15 口径下关卡也不再弹面板，原来那段「先点 stage 看它弹面板」的对照已无对照意义，
    //  这条用例只看资源点：直接解锁、不弹详情、不发通关。）
    h.presenter.selectSite(h.presenter.state.map!.sites[2]);
    assert.equal(h.presenter.state.detail.open, false);
    await flush();
    assert.deepEqual(h.gatewayCalls.unlockedCells, [4]);
    assert.equal(h.gatewayCalls.pass, 0);
    assert.equal(h.storeCalls.beginBattle, 0);
    assert.equal(h.nav.length, 0);
    assert.equal(h.presenter.state.progress?.isCellUnlocked(4), true);
    assert.equal(h.presenter.state.detail.open, false);
    h.presenter.selectSite(h.presenter.state.map!.sites[2]);
    await flush();
    assert.equal(h.gatewayCalls.unlock, 1);
    assert.deepEqual(h.gatewayCalls.passedCells, [4]);
});

test('fixed resource shows only rewards from a successful claim, after the second click', async () => {
    const fixedBundle: ITerritoryChapterBundle = {
        ...bundle,
        mapJson: { ...mapJson, sites: [...mapJson.sites, {
            id: 'fixed_4', type: 'fixedResource', cellId: 4,
            footprint: [4], rewardId: 1011,
        }] },
    };
    const h = createHarness({
        loader: createFakeLoader(fixedBundle),
        gateway: createFakeGateway({ pass: { ok: true, rewards: [{ resId: 9, amount: 5 }] } }),
    });
    h.presenter.start();
    await flush();
    const site = h.presenter.state.map!.sites[2];
    h.presenter.selectSite(site);
    await flush();
    assert.deepEqual(h.rewards, [], '解锁展示建筑时尚未领奖');
    h.presenter.selectSite(site);
    await flush();
    assert.deepEqual(h.rewards, [[{ resId: 9, amount: 5 }]]);
    h.presenter.selectSite(site);
    await flush();
    assert.equal(h.rewards.length, 1, '已领取的格子不能重复弹奖');
});

test('random resource shows rewards only after a confirmed open', async () => {
    const randomBundle: ITerritoryChapterBundle = {
        ...bundle,
        mapJson: { ...mapJson, randomSites: {
            triggerSilver: 10, rewardPoolId: '2001', candidateCells: [4], maxActive: 1,
        } },
    };
    const h = createHarness({
        loader: createFakeLoader(randomBundle),
        gateway: createFakeGateway({ unlock: { ok: true, rewards: [{ resId: 7, amount: 15 }] } }),
    });
    h.presenter.start();
    await flush();
    h.presenter.selectRandomResource(4);
    await flush();
    assert.deepEqual(h.rewards, [[{ resId: 7, amount: 15 }]]);
    // 随机格成功只由奖励窗反馈 —— 不能再叠「已开启」轻提示（两条 UI 会抢同一时刻）。
    assert.deepEqual(h.tips, [], '解锁成功不该弹任何轻提示');
    h.presenter.selectRandomResource(4);
    await flush();
    assert.equal(h.rewards.length, 1);
});

test('fixed resource with unmet prerequisite does not send an unlock request or open detail', async () => {
    const fixedBundle: ITerritoryChapterBundle = {
        ...bundle,
        mapJson: { ...mapJson, sites: [...mapJson.sites, {
            id: 'fixed_3', type: 'fixedResource', cellId: 4,
            footprint: [4], rewardId: 1011,
            unlock: { requiredCells: [2], combatPower: 0, silverCost: 10,
                exploreSeconds: 1, staminaCost: 1 },
        }] },
    };
    const h = createHarness({ loader: createFakeLoader(fixedBundle) });
    h.presenter.start();
    await flush();
    h.presenter.selectSite(h.presenter.state.map!.sites[2]);
    await flush();
    assert.equal(h.presenter.state.detail.open, false);
    assert.equal(h.gatewayCalls.unlock, 0);
});

test('fixed resource already in server unlockCells passes without another unlock', async () => {
    const fixedBundle: ITerritoryChapterBundle = {
        ...bundle,
        mapJson: { ...mapJson, sites: [...mapJson.sites, {
            id: 'fixed_3', type: 'fixedResource', cellId: 4,
            footprint: [4], rewardId: 1011,
        }] },
    };
    const h = createHarness({
        loader: createFakeLoader(fixedBundle),
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0, 4], passCells: [0] },
        } }),
    });
    h.presenter.start();
    await flush();
    h.presenter.selectSite(h.presenter.state.map!.sites[2]);
    assert.equal(h.presenter.state.detail.open, false);
    await flush();
    assert.equal(h.gatewayCalls.unlock, 0);
    assert.deepEqual(h.gatewayCalls.passedCells, [4]);
});

test('fixed resource unlock rejection leaves the claim available', async () => {
    const fixedBundle: ITerritoryChapterBundle = {
        ...bundle,
        mapJson: { ...mapJson, sites: [...mapJson.sites, {
            id: 'fixed_3', type: 'fixedResource', cellId: 4,
            footprint: [4], rewardId: 1011,
        }] },
    };
    const h = createHarness({
        loader: createFakeLoader(fixedBundle),
        gateway: createFakeGateway({ unlock: { ok: false, reason: 'rejected' } }),
    });
    h.presenter.start();
    await flush();
    h.presenter.selectSite(h.presenter.state.map!.sites[2]);
    await flush();
    assert.deepEqual(h.gatewayCalls.unlockedCells, [4]);
    assert.equal(h.presenter.state.detail.open, false);
    assert.equal(h.presenter.state.progress?.isCellUnlocked(4), false);
    assert.match(h.tips[h.tips.length - 1] ?? '', /解锁失败/);
});

test('fixed resource keeps one pending request and records success without a detail panel', async () => {
    let finish!: (value: TerritoryWriteResult) => void;
    const gateway = createFakeGateway();
    gateway.gateway.unlockCell = (_chapterId, cellId) => {
        gateway.calls.unlock++;
        gateway.calls.unlockedCells.push(cellId);
        return new Promise(resolve => { finish = resolve; });
    };
    const fixedBundle: ITerritoryChapterBundle = {
        ...bundle,
        mapJson: { ...mapJson, sites: [...mapJson.sites, {
            id: 'fixed_3', type: 'fixedResource', cellId: 4,
            footprint: [4], rewardId: 1011,
        }] },
    };
    const h = createHarness({ loader: createFakeLoader(fixedBundle), gateway });
    h.presenter.start();
    await flush();
    const site = h.presenter.state.map!.sites[2];
    h.presenter.selectSite(site);
    h.presenter.selectSite(site);
    assert.deepEqual(h.gatewayCalls.unlockedCells, [4]);
    assert.equal(h.presenter.state.detail.open, false);
    assert.deepEqual(h.presenter.state.pendingFixedResourceCells, [4]);
    finish({ ok: true });
    await flush();
    assert.equal(h.presenter.state.progress?.isCellUnlocked(4), true);
    assert.deepEqual(h.presenter.state.pendingFixedResourceCells, []);
});

test('published fixed site 326 has an available claim through unlock', async () => {
    const publishedMap = JSON.parse(readFileSync(
        'assets/resources/config/territory-maps/chapter_01.json', 'utf8'));
    const h = createHarness({
        loader: createFakeLoader({ ...bundle, mapJson: publishedMap }),
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0,
                unlockCells: [346, 347, 367], passCells: [367] },
        } }),
    });
    h.presenter.start();
    await flush();
    const site = h.presenter.state.map?.sites.find((entry) => entry.cellId === 326);
    assert.ok(site);
    assert.equal(site.type, 'fixedResource');

    h.presenter.selectSite(site);
    assert.equal(h.presenter.state.detail.open, false);
    await flush();
    assert.deepEqual(h.gatewayCalls.unlockedCells, [326]);
    assert.equal(h.presenter.state.progress?.isCellUnlocked(326), true);
});

test('fixed resource unlocks first and passes only on the next click', async () => {
    const publishedMap = JSON.parse(readFileSync(
        'assets/resources/config/territory-maps/chapter_01.json', 'utf8'));
    const h = createHarness({
        loader: createFakeLoader({ ...bundle, mapJson: publishedMap }),
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [367], passCells: [367] },
        } }),
    });
    h.presenter.start();
    await flush();
    const site = h.presenter.state.map!.sites.find((entry) => entry.cellId === 347)!;
    assert.ok(h.presenter.state.revealedCells.includes(347));
    h.presenter.selectSite(site);
    await flush();
    assert.deepEqual(h.gatewayCalls.unlockedCells, [347]);
    assert.deepEqual(h.gatewayCalls.passedCells, []);
    assert.equal(h.presenter.state.progress?.isCellUnlocked(347), true);
    assert.equal(h.presenter.state.progress?.isOwned(347), false);
    h.presenter.selectSite(site);
    await flush();
    assert.deepEqual(h.gatewayCalls.passedCells, [347]);
    assert.equal(h.presenter.state.progress?.isOwned(347), true);
    h.presenter.selectSite(site);
    await flush();
    assert.deepEqual(h.gatewayCalls.passedCells, [347]);
});

test('two-step stage 327 unlocks first, shows the building, then starts battle on the next click', async () => {
    const publishedMap = JSON.parse(readFileSync(
        'assets/resources/config/territory-maps/chapter_01.json', 'utf8'));
    // ⚠️ 必须给 327 配一个**对得上 `configId`** 的 campaign stage：
    // `bindTerritoryStages` 按 `Number(site.configId)` 去匹配 `stage.levelId`，
    // 而共享夹具里的 `stage.levelId = 1001`、327 的 `configId = 10001` ⇒ 绑不上
    // ⇒ `bossStage` 为 null ⇒ 走「只解锁」兜底分支，永远不会发开战请求。
    // （这不是代码问题，是夹具数据与真实地图对不上。）
    const stageFor327: TerritoryCampaignStage = { ...stage, levelId: 10001, stage: 1 };
    const h = createHarness({
        loader: createFakeLoader({
            ...bundle,
            mapJson: publishedMap,
            campaign: { stages: [stageFor327], playerCardCount: 3, idleRewardMaxHours: 8 },
        }),
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [367], passCells: [367] },
        } }),
    });
    h.presenter.start();
    await flush();
    const site = h.presenter.state.map!.sites.find((entry) => entry.cellId === 327)!;
    assert.equal(site.type, 'stage', 'chapter_01.json 的 stage_4 应为 stage 类型');
    assert.deepEqual(site.unlock.requiredCells, [367], 'stage_4 前置为主城 367');
    // 第一步：未解锁 → 不弹详情、不发战斗，直接请求解锁并记账。
    h.presenter.selectSite(site);
    assert.equal(h.presenter.state.detail.open, false, '两步式格子不弹关卡详情');
    await flush();
    assert.deepEqual(h.gatewayCalls.unlockedCells, [327]);
    assert.deepEqual(h.gatewayCalls.passedCells, []);
    assert.equal(h.storeCalls.beginBattle, 0, '解锁阶段不进战斗');
    assert.equal(h.nav.length, 0);
    assert.equal(h.presenter.state.progress?.isCellUnlocked(327), true);
    assert.equal(h.presenter.state.progress?.isOwned(327), false);
    // 第二步：已解锁（建筑已展示）→ 再次点击发 `CmdStartBattleReqMsg` **开战**。
    //
    // 🔴 2026-10-10 口径反转：早期这里发的是 `CmdCityChapterPassCellReqMsg` 通关，
    // 服务端回「章节格子非资源类型」并拒绝（实机日志）。327 是**关卡**不是资源点，
    // 第二步必须是开战 —— battleType 固定 1002（章节战斗类型，不是 configId 10001），
    // battleParams = [子类型, 章节id, cellId]（子类型 1 = 格子战斗，由 chapterCellBattleParams 组）。
    h.presenter.selectSite(site);
    assert.equal(h.presenter.state.detail.open, false);
    await flush();
    assert.equal(h.gatewayCalls.unlock, 1, '开战阶段不再重复解锁');
    assert.deepEqual(h.gatewayCalls.passedCells, [],
        '关卡绝不���发通关请求（服务端会回「章节格子非资源类型」）');
    assert.equal(h.gatewayCalls.startBattle, 1, '已解锁的关卡应发一次开战请求');
    assert.deepEqual(h.gatewayCalls.battleTypes, [1002],
        'battleType 必须是章节战斗类型 1002，不是 site.configId（10001）');
    assert.deepEqual(h.gatewayCalls.battleParamsList, [['1', '1', '327']],
        'battleParams = [子类型(1=格子战斗), 章节id, cellId]');
    assert.equal(h.presenter.state.progress?.isCellUnlocked(327), true);
    assert.equal(h.presenter.state.progress?.isCellUnlocked(327), true);
    // 第三步：战斗已发起 → 再点不再发任何请求。
    // ⚠️ `startBattle` 之后 Presenter 就进了战斗态（`beginBattle`），本地进度**不会**变成 owned
    // —— 通关要等战斗结算回报。所以这里只钉「不发重复请求」。
    h.presenter.selectSite(site);
    await flush();
    assert.equal(h.gatewayCalls.unlock, 1);
    assert.equal(h.gatewayCalls.startBattle, 1, '开战请求只发一次，不重复');
    assert.deepEqual(h.gatewayCalls.passedCells, [], '关卡流程里永远没有通关请求');
});

test('two-step stage 327 skips the battle flow entirely (no detail, no start battle)', async () => {
    const publishedMap = JSON.parse(readFileSync(
        'assets/resources/config/territory-maps/chapter_01.json', 'utf8'));
    const h = createHarness({
        loader: createFakeLoader({ ...bundle, mapJson: publishedMap }),
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [367], passCells: [367] },
        } }),
    });
    h.presenter.start();
    await flush();
    const site = h.presenter.state.map!.sites.find((entry) => entry.cellId === 327)!;
    h.presenter.selectSite(site);
    assert.equal(h.presenter.state.detail.content?.startEnabled, undefined,
        '327 不进入详情面板，不存在开战按钮');
    // 请求开始战斗对 327 无效（detailSite/detailStage 均未设置）。
    h.presenter.requestBattle();
    await flush();
    assert.equal(h.storeCalls.beginBattle, 0);
    assert.equal(h.nav.length, 0);
});

test('fixed resource pass rejection keeps the chest open for retry', async () => {
    const publishedMap = JSON.parse(readFileSync(
        'assets/resources/config/territory-maps/chapter_01.json', 'utf8'));
    const h = createHarness({
        loader: createFakeLoader({ ...bundle, mapJson: publishedMap }),
        gateway: createFakeGateway({
            fetch: { ok: true, state: { levelChapter: 1, rewardState: 0,
                unlockCells: [347, 367], passCells: [367] } },
            pass: { ok: false, reason: 'rejected' },
        }),
    });
    h.presenter.start();
    await flush();
    const site = h.presenter.state.map!.sites.find((entry) => entry.cellId === 347)!;
    h.presenter.selectSite(site);
    await flush();
    assert.equal(h.presenter.state.progress?.isCellUnlocked(347), true);
    assert.equal(h.presenter.state.progress?.isOwned(347), false);
    h.presenter.selectSite(site);
    await flush();
    assert.deepEqual(h.gatewayCalls.passedCells, [347, 347]);
});

test('fixed resource needs its configured silver and stamina before unlock', async () => {
    const fixedBundle: ITerritoryChapterBundle = {
        ...bundle,
        mapJson: { ...mapJson, sites: [...mapJson.sites, {
            id: 'fixed_4', type: 'fixedResource', cellId: 4, footprint: [4], rewardId: 1011,
            unlock: { requiredCells: [0], combatPower: 0, silverCost: 10,
                staminaCost: 1, exploreSeconds: 1 },
        }] },
    };
    const h = createHarness({ loader: createFakeLoader(fixedBundle),
        store: createFakeStore({ silver: 9, stamina: 1 }) });
    h.presenter.start();
    await flush();
    assert.equal(h.presenter.state.siteOpenableCells.includes(4), false);
    h.presenter.selectSite(h.presenter.state.map!.sites[2]);
    await flush();
    assert.equal(h.gatewayCalls.unlock, 0);
    assert.equal(h.tips[h.tips.length - 1], '银币不足');
});

test('distant random candidate remains hidden until an adjacent cell opens', async () => {
    const publishedMap = JSON.parse(readFileSync(
        'assets/resources/config/territory-maps/chapter_01.json', 'utf8'));
    const h = createHarness({
        loader: createFakeLoader({ ...bundle, mapJson: publishedMap }),
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [367], passCells: [367] },
        } }),
    });
    h.presenter.start();
    await flush();
    // 346 是主城 367 的左上斜邻居，开局即揭示；386 是第二圈格（与 367 不相邻），保持隐藏。
    assert.equal(h.presenter.state.revealedCells.includes(346), true);
    assert.equal(h.presenter.state.revealedCells.includes(386), false);
    h.presenter.selectRandomResource(386);
    await flush();
    assert.equal(h.gatewayCalls.unlock, 0);
    // 解锁主城邻居 387 后，其六边邻居 386 被揭示。
    h.presenter.selectRandomResource(387);
    await flush();
    assert.equal(h.presenter.state.revealedCells.includes(386), true);
});

test('closeDetail closes the open panel', async () => {
    const h = createHarness();
    h.presenter.start();
    await flush();
    h.presenter.selectSite(h.presenter.state.map!.sites[0]);
    h.presenter.closeDetail();
    assert.equal(h.presenter.state.detail.open, false);
});

// ── 开战 ───────────────────────────────────────────────────────────────

test('a stage click starts the server battle and navigates with the bound level', async () => {
    const h = createHarness({ gateway: createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [1], passCells: [] },
    } }) });
    h.presenter.start();
    await flush();
    // 默认网关返回 unlockCells 已含 1 ⇒ 关卡处于已解锁态，点一下就是开战。
    h.presenter.selectSite(h.presenter.state.map!.sites[0]);
    await flush();
    assert.equal(h.gatewayCalls.startBattle, 1, '关卡必须发 CmdStartBattleReqMsg（拿 battleId/seed）');
    assert.deepEqual(h.gatewayCalls.battleTypes, [1002]);
    assert.equal(h.storeCalls.beginBattle, 1);
    assert.equal(h.nav.length, 1);
    assert.equal(h.nav[0].levelId, 1001);
    assert.deepEqual(h.nav[0].enemyTeamCardIds, [[11]]);
    assert.equal(h.nav[0].enemyCardIds[0], 11);
});

// 未解锁 ⇒ 第一次点击是解锁。服务端**明确拒绝**（`reason: 'rejected'`）⇒ 停下，给提示、不解锁。
test('server unlock rejection stops the stage unlock and shows a tip', async () => {
    const h = createHarness({
        gateway: createFakeGateway({
            fetch: {
                ok: true,
                state: { levelChapter: 1, rewardState: 0, unlockCells: [0], passCells: [0] },
            },
            unlock: { ok: false, reason: 'rejected' },
        }),
    });
    h.presenter.start();
    await flush();
    h.presenter.selectSite(h.presenter.state.map!.sites[0]);
    await flush();
    assert.equal(h.nav.length, 0);
    assert.equal(h.gatewayCalls.startBattle, 0);
    assert.equal(h.presenter.state.progress?.isCellUnlocked(h.presenter.state.map!.sites[0].cellId), false,
        '服务端拒绝 ⇒ 本地不记账');
    assert.equal(h.tips.length, 1);
    assert.equal(h.tips[0], '解锁失败，请稍后重试');
});

// 🔴 关卡的解锁**不放行**（不同于战场上那条「网络失败按本地继续」）：拿不到服务端确认就不能
// 走到「已解锁 ⇒ 再点开战」那一步，否则第二次点击会拿一个服务端根本没记录的格子去开战。
test('stage unlock network failure stops before battle (no local fail-open)', async () => {
    const h = createHarness({
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0], passCells: [0] },
        }, unlock: { ok: false, reason: 'offline' } }),
    });
    h.presenter.start();
    await flush();
    h.presenter.selectSite(h.presenter.state.map!.sites[0]);
    await flush();
    assert.equal(h.nav.length, 0, '解锁没确认 ⇒ 不进战斗');
    assert.equal(h.gatewayCalls.startBattle, 0, '没解锁就不该发开战请求');
    assert.equal(h.tips.length, 1);
    assert.equal(h.tips[0], '解锁失败，请稍后重试');
});

// 银币不够 ⇒ 关卡**连解锁都不发**（先钱包检查再发请求），提示原因，不进战斗。
test('local resource shortage blocks the stage before any request', async () => {
    const h = createHarness({
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0], passCells: [0] },
        } }),
        store: createFakeStore({ silver: 0 }),
    });
    h.presenter.start();
    await flush();
    h.presenter.selectSite(h.presenter.state.map!.sites[0]);
    await flush();
    assert.equal(h.gatewayCalls.unlock, 0, '银币不足 ⇒ 不该先发解锁白试一趟');
    assert.equal(h.gatewayCalls.startBattle, 0);
    assert.equal(h.nav.length, 0);
    assert.equal(h.tips[0], '银币不足');
});

// ── 探索 / tick ────────────────────────────────────────────────────────

test('a stored victory resumes an exploration; it is claimed locally and waits for the server push', async () => {
    const resolvedAt = 1_000_000;
    const h = createHarness({
        gateway: createFakeGateway({
            fetch: {
                ok: true,
                state: { levelChapter: 1, rewardState: 0, unlockCells: [1], passCells: [] },
            },
        }),
        store: createFakeStore({
            battle: {
                chapterId: 1,
                cellId: 1,
                levelId: 1001,
                status: 'victory',
                startedAt: resolvedAt - 1000,
                resolvedAt,
            },
        }),
    });
    h.presenter.start();
    await flush();
    // loadChapter 末尾的 settleProgress(now) 用真实时间，到期的探索当场被领走 ⇒
    // 加载完成后格子已占领；但不再发 passCell（等服务端主动下发），待确认记录保留。
    assert.equal(h.presenter.state.progress?.isOwned(1), true);
    assert.equal(h.gatewayCalls.pass, 0);
    assert.deepEqual(h.presenter.state.progress?.pendingPassCells, [1]);
    assert.match(h.presenter.state.hud?.chapterText ?? '', /已占领 1\/1/);
});

test('fastTick with no active explorations is a no-op', async () => {
    const h = createHarness();
    h.presenter.start();
    await flush();
    h.presenter.fastTick(Date.now() + 10_000);
    assert.equal(h.gatewayCalls.pass, 0);
});

test('server pass cells are merged into local ownership', async () => {
    const h = createHarness({
        gateway: createFakeGateway({
            fetch: {
                ok: true,
                state: {
                    levelChapter: 1,
                    rewardState: 0,
                    unlockCells: [],
                    passCells: [1],
                },
            },
        }),
    });
    h.presenter.start();
    await flush();
    assert.equal(h.presenter.state.progress?.isOwned(1), true);
});

// ── 切章 / dispose ─────────────────────────────────────────────────────

test('switching to the next chapter before completion shows a tip', async () => {
    const h = createHarness({ chapters: [1, 2] });
    h.presenter.start();
    await flush();
    h.presenter.switchChapter(1);
    assert.equal(h.tips.length, 1);
    assert.match(h.tips[0], /请先占领本章全部站点/);
});

test('dispose stops further callbacks', async () => {
    const h = createHarness();
    h.presenter.start();
    await flush();
    const before = h.stateChanges();
    h.presenter.dispose();
    h.presenter.selectSite(h.presenter.state.map!.sites[0]);
    h.presenter.fastTick(Date.now() + 1000);
    assert.equal(h.stateChanges(), before);
});

// ── Boss 关两步式开战（CmdStartBattleReqMsg）───────────────────────────

const bossMap = {
    version: 1,
    mapKind: 'territoryChapter',
    id: 'boss-map',
    name: 'Boss 章',
    chapterId: 1,
    rows: 4,
    columns: 4,
    startCellId: 0,
    background: '',
    sites: [
        { id: 'stage_1', type: 'stage', cellId: 1, footprint: [1], configId: '1001' },
        { id: 'boss_5', type: 'boss', cellId: 2, footprint: [2], configId: '10005' },
    ],
};

const bossStage: TerritoryCampaignStage = {
    levelId: 10005,
    chapterId: 1,
    stage: 5,
    mode: 'defence',
    isBoss: true,
    enemyTeamId: 1,
    enemyTeamIds: [1],
    enemyTeamCardIds: [[11]],
    opponentCount: 1,
    enemies: [{ cardId: 101, pvpCardId: 11, name: '首领守军', level: 1 }],
    waves: [],
    idleRewards: [{ resId: 1, name: '银币', amount: 100, probability: 10000 }],
    staminaCost: 5,
    exploreSeconds: 2,
    hpRate: 1,
    attackRate: 1,
};

test('boss site unlocks first, then clicking again sends CmdStartBattleReqMsg instead of passCell', async () => {
    const h = createHarness({
        loader: createFakeLoader({
            ...bundle,
            mapJson: bossMap,
            campaign: { stages: [stage, bossStage], playerCardCount: 3, idleRewardMaxHours: 8 },
        }),
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0, 1], passCells: [0, 1] },
        } }),
    });
    h.presenter.start();
    await flush();
    const site = h.presenter.state.map!.sites.find((entry) => entry.cellId === 2)!;
    assert.equal(site.type, 'boss');
    // 第一步：未解锁 → 不弹详情、不发战斗请求，直接解锁展示建筑。
    h.presenter.selectSite(site);
    assert.equal(h.presenter.state.detail.open, false, 'Boss 关不弹关卡详情');
    await flush();
    assert.deepEqual(h.gatewayCalls.unlockedCells, [2]);
    assert.deepEqual(h.gatewayCalls.passedCells, []);
    assert.equal(h.gatewayCalls.startBattle, 0, '解锁阶段不发 CmdStartBattleReqMsg');
    assert.equal(h.storeCalls.beginBattle, 0, '解锁阶段不进战斗');
    assert.equal(h.presenter.state.progress?.isCellUnlocked(2), true);
    assert.equal(h.presenter.state.progress?.isOwned(2), false);
    // 第二步：已解锁（建筑已展示）→ 再次点击发 CmdStartBattleReqMsg 开战。
    h.presenter.selectSite(site);
    assert.equal(h.presenter.state.detail.open, false);
    await flush();
    assert.equal(h.gatewayCalls.startBattle, 1);
    assert.deepEqual(h.gatewayCalls.battleTypes, [1002],
        'battleType = 章节战斗类型 1002（2026-10-10 口径）—— 不是 site.configId（这里是 10005），'
        + '关卡身份由 battleParams 的格子id 定位（battleParams = [子类型, 章节id, 格子id]）');
    assert.deepEqual(h.gatewayCalls.battleParamsList, [['1', '1', '2']],
        'battleParams = [子类型(1=格子战斗), 章节id, cellid] —— 子类型占下标 0');
    assert.deepEqual(h.gatewayCalls.passedCells, [], 'Boss 关不再发 CmdCityChapterPassCellReqMsg');
    assert.equal(h.gatewayCalls.unlock, 1, '开战阶段不再重复解锁');
    assert.equal(h.storeCalls.beginBattle, 1, '战斗信息成功后进入战斗');
    assert.equal(h.nav.length, 1);
    assert.equal(h.nav[0].levelId, 10005);
    assert.equal(h.nav[0].territoryCellId, 2);
    assert.equal(h.nav[0].mode, 'defence');
    assert.equal(h.presenter.lastBossBattleStart?.battleId, 'b-10005');
    assert.equal(h.presenter.lastBossBattleStart?.seed, '42');
    assert.equal(h.presenter.state.progress?.isOwned(2), false, '开战不改变占领态');
    // 第三步：已通关 → 点击不再发任何请求。
    h.presenter.state.progress?.markCellPassed(2);
    h.presenter.selectSite(site);
    await flush();
    assert.equal(h.gatewayCalls.startBattle, 1);
    assert.equal(h.gatewayCalls.unlock, 1);
});

test('asyncPvp sites sharing configId unlock independently then start their configured battle', async () => {
    const asyncStage: TerritoryCampaignStage = { ...stage, levelId: 20001, stage: 4 };
    const asyncPvpMap = {
        ...mapJson,
        rows: 20,
        columns: 20,
        startCellId: 367,
        sites: [372, 373, 392].map((cellId) => ({
            id: `asyncPvp_${cellId}`,
            type: 'asyncPvp',
            cellId,
            footprint: [cellId],
            configId: '20001',
            unlock: { requiredCells: [367], silverCost: 10, staminaCost: 1 },
        })),
    };
    const h = createHarness({
        loader: createFakeLoader({
            ...bundle,
            mapJson: asyncPvpMap,
            campaign: { stages: [stage, asyncStage], playerCardCount: 3, idleRewardMaxHours: 8 },
        }),
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [367], passCells: [367] },
        } }),
    });
    h.presenter.start();
    await flush();
    const sites = h.presenter.state.map!.sites;
    assert.deepEqual(sites.map((site) => site.configId), ['20001', '20001', '20001']);

    for (const site of sites) {
        h.presenter.selectSite(site);
        await flush();
        assert.equal(h.presenter.state.detail.open, false, '异步关卡解锁时不弹未绑定关卡详情');
        assert.equal(h.presenter.state.progress?.isCellUnlocked(site.cellId), true,
            `cellId ${site.cellId} 应独立记为已解锁`);
    }

    assert.deepEqual(h.gatewayCalls.unlockedCells, [372, 373, 392]);
    assert.deepEqual(h.gatewayCalls.passedCells, [], '异步关卡解锁不走资源点通关接口');
    assert.equal(h.gatewayCalls.startBattle, 0, '首次点击只解锁，不启动战斗');
    assert.deepEqual(h.tips, ['已解锁，点击开战', '已解锁，点击开战', '已解锁，点击开战'],
        '首次解锁提示后续点击可开战');

    h.presenter.selectSite(sites[0]);
    await flush();
    assert.equal(h.gatewayCalls.unlock, 3, '已解锁的异步格再次点击不重复请求解锁');
    assert.equal(h.gatewayCalls.startBattle, 1, '已解锁异步据点应走章节战斗请求');
    assert.deepEqual(h.gatewayCalls.battleParamsList, [['1', '1', '372']]);
    assert.equal(h.storeCalls.beginBattle, 1);
    assert.equal(h.nav[0]?.levelId, 20001, '开战应使用 levelInfo.json 中的 20001');
    assert.equal(h.nav[0]?.territoryCellId, 372);
    assert.deepEqual(h.gatewayCalls.passedCells, [], '异步战斗不走资源点通关接口');
});

test('boss site already unlocked starts battle on click without unlock', async () => {
    const h = createHarness({
        loader: createFakeLoader({
            ...bundle,
            mapJson: bossMap,
            campaign: { stages: [stage, bossStage], playerCardCount: 3, idleRewardMaxHours: 8 },
        }),
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0, 1, 2], passCells: [0] },
        } }),
    });
    h.presenter.start();
    await flush();
    const site = h.presenter.state.map!.sites.find((entry) => entry.cellId === 2)!;
    assert.equal(h.presenter.state.progress?.isCellUnlocked(2), true);
    h.presenter.selectSite(site);
    await flush();
    assert.equal(h.gatewayCalls.startBattle, 1);
    assert.equal(h.gatewayCalls.unlock, 0, '已解锁不再请求解锁');
    assert.equal(h.storeCalls.beginBattle, 1);
    assert.deepEqual(h.gatewayCalls.battleTypes, [1002],
        'battleType = 章节战斗类型 1002（2026-10-10 口径），不是 site.configId');
});

test('boss start battle failure shows a tip and does not enter battle', async () => {
    const h = createHarness({
        loader: createFakeLoader({
            ...bundle,
            mapJson: bossMap,
            campaign: { stages: [stage, bossStage], playerCardCount: 3, idleRewardMaxHours: 8 },
        }),
        gateway: createFakeGateway({
            fetch: {
                ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0, 1, 2], passCells: [0] },
            },
            start: { ok: false, reason: 'failed' },
        }),
    });
    h.presenter.start();
    await flush();
    const site = h.presenter.state.map!.sites.find((entry) => entry.cellId === 2)!;
    h.presenter.selectSite(site);
    await flush();
    assert.equal(h.gatewayCalls.startBattle, 1);
    assert.equal(h.storeCalls.beginBattle, 0, '请求失败不进战斗');
    assert.equal(h.nav.length, 0);
    assert.match(h.tips[h.tips.length - 1], /开战失败/);
    assert.equal(h.presenter.lastBossBattleStart, null);
});

test('chapter start forwards the complete server battle to navigation', async () => {
    const h = createHarness({ gateway: createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0, 1], passCells: [0] },
    } }) });
    h.presenter.start();
    await flush();
    h.presenter.selectSite(h.presenter.state.map!.sites[0]);
    await flush();
    assert.equal(h.nav.length, 1);
    assert.deepEqual(h.battles[0], fakeBattleStart);
});

test('territory page passes battle and current role to the game route', () => {
    const page = readFileSync('assets/script/app/main/MainTerritoryMap.ts', 'utf8');
    assert.match(page, /navigateToBattle: \(pve, battle\) =>[\s\S]*?ProcedureManager\.navigate\(GameRoute\.Battle, \{[\s\S]*?battle,[\s\S]*?selfRoleId: saveOwner\?\.roleId/);
});

test('chapter start ignores repeat clicks while in flight and stale response after selection changes', async () => {
    const gateway = createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0, 1, 2], passCells: [0] },
    } });
    const pending: Array<(value: TerritoryStartBattleResult) => void> = [];
    gateway.gateway.startBattle = () => {
        gateway.calls.startBattle++;
        return new Promise(resolve => pending.push(resolve));
    };
    const h = createHarness({ gateway });
    h.presenter.start();
    await flush();
    const site = h.presenter.state.map!.sites[0];
    h.presenter.selectSite(site);
    h.presenter.selectSite(site);
    assert.equal(gateway.calls.startBattle, 1);
    h.presenter.selectSite(h.presenter.state.map!.sites[1]);
    pending[0]({ ok: true, battle: fakeBattleStart });
    await flush();
    assert.equal(h.nav.length, 0);
    assert.equal(h.storeCalls.beginBattle, 0);
});

test('unconfirmed chapter battle remains pending after returning to territory', async () => {
    const h = createHarness({
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0, 1], passCells: [0] },
        } }),
        store: createFakeStore({ battle: {
            chapterId: 1, cellId: 1, levelId: 1001, status: 'pending', startedAt: Date.now(),
        } }),
    });
    h.presenter.start();
    await flush();
    assert.equal(h.storeCalls.clearBattle, 0);
    assert.equal(h.presenter.state.progress?.isOwned(1), false);
});

// ── 发奖要带「来源格」（飘字落点；7/9 走飘字、其余走弹窗，见 TerritoryResourceGain） ──

test('随机资源格开启：奖励带上来的是被点的那一格 cellId', async () => {
    const randomBundle: ITerritoryChapterBundle = {
        ...bundle,
        mapJson: { ...mapJson, randomSites: {
            triggerSilver: 10, rewardPoolId: '2001', candidateCells: [4], maxActive: 1,
        } },
    };
    const h = createHarness({
        loader: createFakeLoader(randomBundle),
        gateway: createFakeGateway({ unlock: { ok: true, rewards: [{ resId: 7, amount: 120 }] } }),
        store: createFakeStore({ ownedCells: [0] }),
    });
    h.presenter.start();
    await flush();
    h.presenter.selectRandomResource(4);
    await flush();
    assert.equal(h.rewards.length, 1);
    assert.deepEqual(h.rewards[0], [{ resId: 7, amount: 120 }]);
    assert.equal(h.rewardOrigins[0], 4, '飘字必须落在被点的那一格');
});

test('挂机产出没有来源格：originCellId 为空（页面回落到起始格）', async () => {
    const h = createHarness({
        store: createFakeStore({
            idleRewards: {
                save: {} as TerritoryChapterSave,
                rewards: [{ resId: 9, name: '体力', amount: 3 }],
                settledHours: 1,
                changed: true,
            },
        }),
    });
    h.presenter.start();
    await flush();
    h.presenter.slowTick(Date.now());
    // 进页面时也会结算一次挂机（loadChapter 末尾），所以这里可能有 1~2 条。
    assert.ok(h.rewards.length >= 1, '挂机产出必须发出来');
    assert.ok(h.rewards.every((batch) => batch.some((g) => g.resId === 9 && g.amount === 3)));
    assert.ok(h.rewardOrigins.every((origin) => origin === undefined || origin === null),
        '挂机产出按关卡结算，不该带格子');
});

test('★★★★真机口径：只打通 328，点 309 必须发解锁协议（曾经零协议）', async () => {
    // 山猫 2026-10-15 真机：cellId 309（关卡 2、有建筑 69004）点下去**一个协议都不发**，
    // 只弹「前置领地尚未占领」。根因见 `territory-progress.test.ts` 同名主题那条：
    // 309 的前置要求 327/328（同 configId=10001）**各通关一次**，而 327 无建筑永远 owned 不了。
    const publishedMap = JSON.parse(readFileSync(
        'assets/resources/config/territory-maps/chapter_01.json', 'utf8'));
    const stages: TerritoryCampaignStage[] = [
        { ...stage, levelId: 10001, stage: 1 },
        { ...stage, levelId: 10002, stage: 2 },
    ];
    const h = createHarness({
        loader: createFakeLoader({
            ...bundle,
            mapJson: publishedMap,
            campaign: { stages, playerCardCount: 3, idleRewardMaxHours: 8 },
        }),
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0,
                unlockCells: [347, 348, 327, 328, 308, 329], passCells: [367, 328] },
        } }),
    });
    h.presenter.start();
    await flush();
    const site = h.presenter.state.map!.sites.find((s) => s.cellId === 309)!;
    assert.equal(site.type, 'stage');
    assert.equal(site.buildingId, '69004', '309 就是真机点的那格（有建筑）');
    assert.ok(h.presenter.state.revealedCells.includes(309), '309 已揭示（玩家看得见）');

    h.presenter.selectSite(site);
    await flush();
    assert.deepEqual(h.gatewayCalls.unlockedCells, [309],
        '★必须发 CmdCityChapterPassCellReqMsg 类解锁请求 —— 曾经这里是 0 次请求');
    assert.ok(!h.tips.includes('前置领地尚未占领'), '不能再被前置判定挡住');
    assert.equal(h.tips[h.tips.length - 1], '已解锁，点击开战');
});
