/**
 * territory-presenter 快照同步、切章原子性与通关判定 专项单测
 * 从 territory-presenter.test.ts 按业务域解耦拆分，脚手架抽至 helpers/territory-presenter-fixture.ts
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import {
    createBattlePageProbe,
    createBossFindLoader,
    createFakeGateway,
    createFakeLoader,
    createFakeStore,
    createHarness,
    createOutputSpy,
    flush,
    fakeBattleStart,
    bundle,
    mapJson,
    stage,
    nullArt,
    bossMap,
    bossStage,
    asyncRepeatStage,
    asyncRepeatMap,
    createAsyncRepeatHarness,
    FINAL_BOSS_CELL,
    MID_BOSS_CELL,
    configureTerritoryMap,
    territoryNeighbors,
    TerritorySaveStore,
    assetPath,
    readFileSync,
    TERRITORY_REQUEST_STATUS,
    TerritoryUiEvent,
    TerritoryViewEvent,
} from './helpers/territory-presenter-fixture';
import { readTerritoryMonsterBoxGroups } from '../assets/script/app/territory/model/TerritoryMonsterBoxConfig';
import { emptyCellState } from '../assets/script/app/territory/model/TerritoryCellBitSet';
import type { TerritoryStartBattleResult } from '../assets/script/app/territory/application/TerritoryCellRepository';
import type { TerritoryCampaignStage } from '../assets/script/app/territory/model/TerritoryCampaignConfig';

test('one write request at a time: taps on any site are ignored while it is in flight', async () => {
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
    // 2026-10-28 起「未解锁 ⇒ 点一下直接解锁」，所以这里不再需要 `requestBattle()`。
    h.presenter.selectSite(site);
    // 同一格的解锁还在飞 ⇒ 连点**不再**发第二次（`pendingFixedResourceCells` 挡）。
    h.presenter.selectSite(site);
    assert.equal(pending.length, 1, '★同一格的解锁在飞 ⇒ 连点不重复发请求');
    // 🔴 2026-11-19 入口单飞：**别的格也不受理**。换格会换交互号，把在途回包判成
    // 过期丢弃 ⇒ 服务端已经扣费解锁、客户端不记账，格子还锁着，玩家接着点就是又一层
    // loading（「快速点击转菊花」的根因）。
    assert.equal(h.presenter.selectSite(other), false, '★写请求在途 ⇒ 别的格一律不受理');
    assert.equal(pending.length, 1, '不受理 ⇒ 不会发第二条请求');
    pending[0]({ ok: true });
    await flush();
    assert.equal(h.presenter.state.progress?.isCellUnlocked(site.cellId), true,
        '★请求没被作废 ⇒ 回包必须记账（作废就会「钱扣了格还锁着」）');
});

test('a write request in flight keeps the site that started it; later taps are ignored', async () => {
    let finish!: (value: TerritoryWriteResult) => void;
    const gateway = createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0, 2], passCells: [0] },
    } });
    gateway.gateway.unlockCell = () => new Promise(resolve => { finish = resolve; });
    const h = createHarness({ gateway });
    h.presenter.start();
    await flush();
    h.presenter.selectSite(h.presenter.state.map!.sites[0]);
    // 解锁在途（锁着的关卡「解锁即开战」，这条链由起手那一格自己走完）。
    h.presenter.requestBattle();
    // 🔴 2026-11-19 入口单飞：在途期间点别的格不受理，交互号不换 ⇒ 起手那一格的
    // 回包不作废（换号会让服务端已扣的银币在客户端不记账）。
    assert.equal(h.presenter.selectSite(h.presenter.state.map!.sites[1]), false,
        '★在途期间点别的格不受理');
    finish({ ok: true });
    await flush();
    assert.equal(h.gatewayCalls.startBattle, 0, '在途期间没有插进第二条开战请求');
    assert.equal(h.presenter.state.progress?.isCellUnlocked(h.presenter.state.map!.sites[0].cellId), true,
        '★起手那一格的解锁回包照常落地');
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
    // 只发不等：重试判据是**发送状态**（offline ⇒ 没发出去），不是回包。
    const sendUnlockCell = gateway.gateway.sendUnlockCell;
    gateway.gateway.sendUnlockCell = (chapterId, cellId) => {
        unlockAttempts++;
        return unlockAttempts === 1 ? 'offline' : sendUnlockCell(chapterId, cellId);
    };
    const h = createHarness({ gateway, store: createFakeStore({ battle: {
        chapterId: 1, cellId: 1, levelId: 1001, status: 'victory', startedAt: 100, resolvedAt: 200,
    } }) });
    h.presenter.start();
    await flush();
    // 首轮离线没发出去 ⇒ 下一拍重试一次；之后发成功就记进「已补过」集合，不再重复。
    h.presenter.slowTick(Date.now() + 60000);
    h.presenter.slowTick(Date.now() + 120000);
    h.presenter.slowTick(Date.now() + 180000);
    await flush();
    assert.equal(unlockAttempts, 2, '离线那一轮不记已发，下一拍重试；成功后不再重复');
    assert.equal(h.gatewayCalls.pass, 0);
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
    const gateway = createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [1], passCells: [] },
    } });
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
    h.presenter.applyCellInfoState({ levelChapter: 1, rewardState: 0, unlockCells: [1], passCells: [1] });
    assert.deepEqual(h.presenter.state.progress?.pendingPassCells, []);
    assert.equal(h.presenter.state.progress?.isOwned(1), true);
    assert.equal(h.gatewayCalls.pass, 0);
    // 重复推送幂等：再来一次没有新增、不报错。
    h.presenter.applyCellInfoState({ levelChapter: 1, rewardState: 0, unlockCells: [1], passCells: [1] });
    assert.deepEqual(h.presenter.state.progress?.pendingPassCells, []);
    // 别的章节的下发必须被忽略。
    h.presenter.applyCellInfoState({ levelChapter: 2, rewardState: 0, unlockCells: [1], passCells: [1] });
    assert.equal(h.presenter.state.progress?.isOwned(1), true);
});

test('迟到的首份快照补齐历史地块，并保留刚点击成功的解锁', async () => {
    const gateway = createFakeGateway();
    let reply = (_result: TerritoryCellFetchResult): void => {};
    gateway.gateway.fetchChapterCells = () => new Promise(resolve => { reply = resolve; });
    const h = createHarness({ gateway, loader: createFakeLoader({
        ...bundle,
        mapJson: { ...mapJson, randomSites: {
            triggerSilver: 10, rewardPoolId: '2001', candidateCells: [4, 15], maxActive: 2,
        } },
    }) });
    const paints: boolean[] = [];
    h.presenter.onOutput(event => {
        if (event.kind === 'changed') paints.push(event.isInitialCellSync === true);
    });
    h.presenter.start();
    await flush();
    assert.equal(h.presenter.state.ready, true);
    h.presenter.selectRandomResource(4);
    await flush();
    assert.equal(h.presenter.state.progress?.isCellUnlocked(4), true);
    assert.ok(paints.every(initial => !initial), '点击成功走正常渲染');

    reply({ ok: true, state: { ...emptyCellState(1), unlockCells: [15], passCells: [15] } });
    await flush();
    assert.equal(h.presenter.state.progress?.isCellUnlocked(15), true);
    assert.equal(h.presenter.state.progress?.isCellUnlocked(4), true, '旧快照不能盖掉后到的写确认');
    assert.deepEqual(paints.filter(Boolean), [true], '只标记合并首份快照的那一帧');
    assert.equal(paints.at(-1), false, '后续渲染恢复普通表现');
    h.presenter.dispose();
});

test('loading preserves pushed passes and snapshots even when the fetch fails', async () => {
    const loader = createFakeLoader();
    let resolveLoad: (value: ITerritoryChapterBundle) => void = () => {};
    loader.loader.load = () => new Promise(resolve => { resolveLoad = resolve; });
    const h = createHarness({ loader, gateway: createFakeGateway({ fetch: {
        ok: false, reason: TERRITORY_REQUEST_STATUS.invalid, state: emptyCellState(1),
    } }) });
    h.presenter.start();
    h.presenter.applyPassCellsBro(1, [1, 1]);
    h.presenter.applyCellInfoState({ levelChapter: 1, rewardState: 0, unlockCells: [2], passCells: [3] });
    assert.equal(h.presenter.state.ready, false);
    resolveLoad(bundle);
    await flush();
    assert.equal(h.presenter.state.progress?.isServerOwned(1), true);
    assert.equal(h.presenter.state.progress?.isServerOwned(3), true);
    assert.equal(h.presenter.state.progress?.isCellUnlocked(2), true);
    assert.equal(h.presenter.state.progress?.serverStateKnown, true);
    h.presenter.dispose();
});

test('pushes between page subscription and start survive the initial load', async () => {
    const h = createHarness({ gateway: createFakeGateway({ fetch: {
        ok: false, reason: TERRITORY_REQUEST_STATUS.invalid, state: emptyCellState(1),
    } }) });
    h.presenter.applyPassCellsBro(0, [3]);
    h.presenter.start();
    await flush();
    assert.equal(h.presenter.state.progress?.isServerOwned(3), true);
    assert.equal(h.presenter.state.progress?.serverStateKnown, false, '仅通关广播不能收紧解锁态');
    h.presenter.dispose();
});

test('dispose discards queued pushes and prevents a pending load from publishing', async () => {
    const loader = createFakeLoader();
    let resolveLoad: (value: ITerritoryChapterBundle) => void = () => {};
    loader.loader.load = () => new Promise(resolve => { resolveLoad = resolve; });
    const h = createHarness({ loader });
    h.presenter.start();
    h.presenter.applyPassCellsBro(1, [1]);
    h.presenter.dispose();
    const before = h.stateChanges();
    resolveLoad(bundle);
    await flush();
    assert.equal(h.presenter.state.ready, false);
    assert.equal(h.stateChanges(), before);
    assert.equal(h.storeCalls.saveProgress, 0);
});

test('unlock-only snapshots refresh once and repeated pushes remain idempotent', async () => {
    const h = createHarness();
    h.presenter.start();
    await flush();
    const before = h.stateChanges();
    const saves = h.storeCalls.saveProgress;
    const state = { levelChapter: 1, rewardState: 0, unlockCells: [2, 999], passCells: [] };
    h.presenter.applyCellInfoState(state);
    assert.equal(h.stateChanges(), before + 1);
    assert.equal(h.storeCalls.saveProgress, saves + 1);
    assert.equal(h.presenter.state.progress?.isCellUnlocked(2), true);
    assert.equal(h.presenter.state.progress?.isCellUnlocked(999), false);
    h.presenter.applyCellInfoState(state);
    assert.equal(h.stateChanges(), before + 1);
    assert.equal(h.storeCalls.saveProgress, saves + 1);
    h.presenter.dispose();
});

test('push confirmation of a locally owned cell refreshes the cached view once', async () => {
    for (const kind of ['bro', 'snapshot']) {
        const h = createHarness({ store: createFakeStore({ ownedCells: [1] }) });
        h.presenter.start();
        await flush();
        const before = h.stateChanges();
        const previous = h.presenter.state;
        const push = () => kind === 'bro'
            ? h.presenter.applyPassCellsBro(1, [1])
            : h.presenter.applyCellInfoState({ levelChapter: 1, rewardState: 0, unlockCells: [], passCells: [1] });
        push();
        assert.equal(h.presenter.state.progress?.isServerOwned(1), true);
        assert.equal(h.stateChanges(), before + 1, kind);
        assert.notEqual(h.presenter.state, previous);
        push();
        assert.equal(h.stateChanges(), before + 1, '重复确认保持幂等');
        h.presenter.dispose();
    }
});

test('chapter switching queues only the target chapter and replaces the context atomically', async () => {
    const loader = createFakeLoader();
    const h = createHarness({ loader, chapters: [1, 2], store: createFakeStore({ ownedCells: [1, 2] }) });
    h.presenter.start();
    await flush();
    const previous = h.presenter.state.progress;
    let resolveLoad: (value: ITerritoryChapterBundle | null) => void = () => {};
    loader.loader.load = () => new Promise(resolve => { resolveLoad = resolve; });
    h.presenter.switchChapter(1);
    assert.equal(h.presenter.state.ready, false, '旧上下文保留作回退，但不能宣告目标章就绪');
    h.presenter.applyPassCellsBro(1, [5]);
    h.presenter.applyPassCellsBro(2, [6]);
    h.presenter.applyCellInfoState({ levelChapter: 2, rewardState: 0, unlockCells: [7], passCells: [8] });
    h.presenter.applyCellInfoState({ levelChapter: 2, rewardState: 0, unlockCells: [9], passCells: [] });
    assert.equal(previous?.isServerOwned(5), false);
    resolveLoad({ ...bundle, mapJson: { ...mapJson, chapterId: 2 } });
    await flush();
    assert.equal(h.presenter.state.map?.chapterId, 2);
    assert.notEqual(h.presenter.state.progress, previous);
    assert.equal(h.presenter.state.progress?.isServerOwned(5), false);
    assert.equal(h.presenter.state.progress?.isServerOwned(6), true);
    assert.equal(h.presenter.state.progress?.isServerOwned(8), true);
    assert.equal(h.presenter.state.progress?.isCellUnlocked(7), true);
    assert.equal(h.presenter.state.progress?.isCellUnlocked(9), true);
    h.presenter.applyPassCellsBro(1, [10]);
    assert.equal(h.presenter.state.progress?.isServerOwned(10), false);
    h.presenter.switchChapter(-1);
    h.presenter.applyPassCellsBro(1, [11]);
    resolveLoad(null);
    await flush();
    assert.equal(h.presenter.state.chapterId, 2);
    assert.equal(h.presenter.state.map?.chapterId, 2);
    assert.equal(h.presenter.state.progress?.isServerOwned(11), false);
    h.presenter.dispose();
});

test('a stale load cannot consume or clear a newer chapter push buffer', async () => {
    const loader = createFakeLoader();
    const replies: Array<(value: ITerritoryChapterBundle | null) => void> = [];
    loader.loader.load = () => new Promise(resolve => replies.push(resolve));
    const h = createHarness({ loader, chapters: [1, 2] });
    h.presenter.start();
    h.presenter.applyPassCellsBro(1, [1]);
    h.presenter.start();
    h.presenter.applyPassCellsBro(1, [3]);
    replies[0](null);
    await flush();
    h.presenter.applyPassCellsBro(1, [4]);
    replies[1](bundle);
    await flush();
    assert.equal(h.presenter.state.progress?.isServerOwned(1), false);
    assert.equal(h.presenter.state.progress?.isServerOwned(3), true);
    assert.equal(h.presenter.state.progress?.isServerOwned(4), true);
    h.presenter.dispose();
});

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

test('published chapter one renders a default random resource with zero silver', async () => {
    const publishedMap = JSON.parse(readFileSync(
        assetPath('config/territory-maps/chapter_01.json'), 'utf8'));
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

test('role cache push refreshes an open territory page wallet', async () => {
    let serverWallet: TerritoryWallet = { silver: 20, stamina: 10 };
    const h = createHarness({ serverWallet: () => serverWallet });
    h.presenter.start();
    await flush();
    serverWallet = { silver: 7, stamina: 3 };
    h.presenter.refreshWalletFromServer();
    assert.match(h.presenter.state.hud!.walletText, /银币 7\s+体力 3/);
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

test('★★★只通关本章最后一个首领 ⇒ 就算通关（异步据点不参与）', async () => {
    const h = createHarness({
        loader: createBossFindLoader(),
        chapters: [1, 2],
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [MID_BOSS_CELL, FINAL_BOSS_CELL], passCells: [] },
        } }),
    });
    h.presenter.start();
    await flush();
    assert.equal(h.presenter.state.chapterId, 1);
    assert.equal(h.presenter.state.hud?.nextEnabled, false, '开局当然还没通关');
    const published: boolean[] = [];
    h.presenter.onOutput((output) => {
        if (output.kind === 'changed') published.push(h.presenter.state.hud?.nextEnabled ?? false);
    });
    // 只推「1-10 这一个首领通过」——占领率口径下这一章只有 1/3，按新判据已经通关。
    h.presenter.applyPassCellsBro(1, [FINAL_BOSS_CELL]);
    assert.equal(published[0], true, '通关必须先把 nextEnabled=true 发布出去，再切章');
    await flush();
    assert.equal(h.presenter.state.chapterId, 2, '通关就要自动进下一章');
    h.presenter.dispose();
});

test('★★★只通关中间那个首领（1-5）⇒ 还不算通关', async () => {
    const h = createHarness({
        loader: createBossFindLoader(),
        chapters: [1, 2],
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [MID_BOSS_CELL, FINAL_BOSS_CELL], passCells: [] },
        } }),
    });
    h.presenter.start();
    await flush();
    h.presenter.applyPassCellsBro(1, [MID_BOSS_CELL]);
    await flush();
    assert.equal(h.presenter.state.hud?.nextEnabled, false, '1-5 不是链尾那个首领');
    assert.equal(h.presenter.state.chapterId, 1, '不许因为通了中间的首领就切章');
    // 再补上链尾那个 ⇒ 立刻通关并切章。
    h.presenter.applyPassCellsBro(1, [FINAL_BOSS_CELL]);
    await flush();
    assert.equal(h.presenter.state.chapterId, 2);
    h.presenter.dispose();
});

test('★★★切章命令只发给「玩家点的章节按钮」：自动推进不发（用户 2026-11-04）', async () => {
    const loader = createFakeLoader();
    loader.loader.load = async (chapterId) => ({ ...bundle, mapJson: { ...mapJson, chapterId } });
    const gateway = createFakeGateway();
    gateway.gateway.fetchChapterCells = async (chapterId) => ({ ok: true, state: {
        levelChapter: chapterId, rewardState: 0, unlockCells: [1], passCells: chapterId === 1 ? [] : [],
    } });
    const h = createHarness({ loader, gateway, chapters: [1, 2] });
    h.presenter.start();
    await flush();
    assert.equal(h.presenter.state.chapterId, 1);

    // ① 通关 ⇒ 模型自动进下一章。这条路上**不许**播转场（否则玩家什么都没点就演了一段）。
    h.presenter.applyPassCellsBro(1, [1]);
    await flush();
    assert.equal(h.presenter.state.chapterId, 2, '自动推进照常发生');
    assert.deepEqual(h.chapterSwitches, [], '自动推进不许发 chapterSwitch');

    // ② 玩家在章节选择弹窗里回到已通过的章节 ⇒ 必须发（含"往回选"这条路）。
    h.presenter.selectChapter(1);
    await flush();
    assert.deepEqual(h.chapterSwitches, [{ from: 2, to: 1 }],
        '回到已通过的章节也要演转场 —— 用户原话就是这么说的');
    assert.equal(h.presenter.state.chapterId, 1);

    // ③ 翻页切章（`chapter` 意图走的那条）同样要发。
    h.chapterSwitches.length = 0;
    h.presenter.switchChapter(1);
    await flush();
    assert.deepEqual(h.chapterSwitches, [{ from: 1, to: 2 }]);
    h.presenter.dispose();
});

test('★★★被门槛拦下的切章不许先演一段转场再回退', async () => {
    // 当前章没通关 ⇒ 「往后翻」被拦，只出提示 —— 此时一条 `chapterSwitch` 都不许发，
    // 否则页面会白合拢一次云，等半天等不到新章。
    const h = createHarness({ chapters: [1, 2] });
    h.presenter.start();
    await flush();
    assert.equal(h.presenter.state.chapterId, 1);
    h.presenter.switchChapter(1);
    await flush();
    assert.equal(h.presenter.state.chapterId, 1, '没通关进不去下一章');
    assert.deepEqual(h.chapterSwitches, []);
    assert.match(h.tips[h.tips.length - 1], /请先通关本章最后一个首领关卡/);

    // 弹窗选章走同一条门槛（目标章在后）。
    h.presenter.selectChapter(2);
    await flush();
    assert.deepEqual(h.chapterSwitches, []);
    assert.equal(h.presenter.state.chapterId, 1);
    h.presenter.dispose();
});

test('★★★一章一个可打的首领都没有 ⇒ 退回「全部站点占领」判定（别当成已通关）', async () => {
    const loader = createFakeLoader();
    const stages = [
        { ...stage, levelId: 1001, stage: 1 },
        { ...stage, levelId: 1002, stage: 2 },
    ];
    loader.loader.load = async (chapterId) => ({
        ...bundle,
        campaign: { ...bundle.campaign, stages },
        mapJson: { ...mapJson, chapterId, sites: [
            { id: 'stage_1', type: 'stage', cellId: 1, footprint: [1], configId: '1001' },
            { id: 'stage_2', type: 'stage', cellId: 3, footprint: [3], configId: '1002' },
        ] },
    });
    const h = createHarness({ loader, chapters: [1, 2] });
    h.presenter.start();
    await flush();
    h.presenter.applyPassCellsBro(1, [3]);
    await flush();
    assert.equal(h.presenter.state.hud?.nextEnabled, false, '只通了一关，另一关还没占领');
    assert.equal(h.presenter.state.chapterId, 1);
    h.presenter.applyPassCellsBro(1, [1]);
    await flush();
    assert.equal(h.presenter.state.chapterId, 2, '两格都占领 ⇒ 旧口径通关');
    h.presenter.dispose();
});

test('auto advance stays on the final chapter and does not loop after a failed next chapter load', async () => {
    const final = createHarness();
    final.presenter.start();
    await flush();
    final.presenter.applyPassCellsBro(1, [1]);
    await flush();
    assert.equal(final.presenter.state.chapterId, 1);
    assert.equal(final.presenter.state.ready, true);
    final.presenter.dispose();

    const loader = createFakeLoader();
    let nextLoads = 0;
    loader.loader.load = async (chapterId) => {
        if (chapterId === 2) { nextLoads++; return null; }
        return bundle;
    };
    const h = createHarness({ loader, chapters: [1, 2] });
    h.presenter.start();
    await flush();
    h.presenter.applyPassCellsBro(1, [1]);
    await flush();
    assert.equal(nextLoads, 1);
    assert.equal(h.presenter.state.chapterId, 1);
    assert.equal(h.presenter.state.ready, true);
    h.presenter.applyPassCellsBro(1, [1]);
    await flush();
    assert.equal(nextLoads, 1, 'duplicate push cannot create an automatic retry loop');
    h.presenter.switchChapter(1);
    await flush();
    assert.equal(nextLoads, 2, 'manual arrow remains available to retry');
    h.presenter.dispose();
});

test('switching to the next chapter before completion shows a tip', async () => {
    const h = createHarness({ chapters: [1, 2] });
    h.presenter.start();
    await flush();
    h.presenter.switchChapter(1);
    assert.equal(h.tips.length, 1);
    // 2026-11-04 口径：通关 = 通过本章最后一个首领关卡（不再是"占领全部站点"）
    assert.match(h.tips[0], /请先通关本章最后一个首领关卡/);
});

test('dispose releases the chapter context without publishing another state', async () => {
    const h = createHarness();
    h.presenter.start();
    await flush();
    const before = h.stateChanges();
    h.presenter.dispose();
    assert.equal(h.presenter.state.map, null);
    assert.equal(h.presenter.state.progress, null);
    assert.equal(h.presenter.state.ready, false);
    assert.equal(h.stateChanges(), before);
});

test('disposing cancels the in-flight snapshot task before it can persist or publish', async () => {
    const gateway = createFakeGateway();
    let reply: (value: TerritoryCellFetchResult) => void = () => {};
    gateway.gateway.fetchChapterCells = () => new Promise(resolve => { reply = resolve; });
    const h = createHarness({ gateway });
    h.presenter.start();
    await flush();
    assert.equal(h.presenter.state.ready, true, '本地上下文先就绪，快照仍在途');
    let emitted = 0;
    const stop = h.presenter.onOutput(event => { if (event.kind === 'changed') emitted++; });
    try {
        h.presenter.dispose();
        const saves = h.storeCalls.saveProgress;
        reply({ ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [2], passCells: [3] } });
        await flush();
        assert.equal(h.storeCalls.saveProgress, saves);
        assert.equal(emitted, 0, '已取消任务不能向其它仍存活的订阅方发布事件');
        assert.equal(h.presenter.state.map, null);
    } finally {
        stop();
    }
});

test('★asyncPvp 已通关可重复挑战：再次点击重新发开战请求，不重复解锁', async () => {
    const h = createAsyncRepeatHarness({
        unlockCells: [367, 372], // 已通关且服务端仍标已解锁（快照常态）
        passCells: [367, 372],
    });
    h.presenter.start();
    await flush();
    const site = h.presenter.state.map!.sites[0];
    assert.equal(h.presenter.state.progress?.isOwned(372), true, '372 已通关');
    h.presenter.selectSite(site);
    await flush();
    h.presenter.requestBattle();
    await flush();
    assert.equal(h.gatewayCalls.unlock, 0, '已通关格不重复发解锁');
    assert.equal(h.gatewayCalls.startBattle, 0, '★请求交给匹配页（asyncPvp 也是 mode = match）');
    // asyncPvp = 宝箱战斗子类型（battleParams[0] = 2），不是主线的格子战斗子类型 1。
    assert.deepEqual(h.battleParams[0], ['2', '1', '372'],
        'asyncPvp 用宝箱战斗子类型（服务端按 battleParams[0] 分流）');
    assert.equal(h.nav.length, 1, '开战成功进入匹配');
    // 普通关（`mode = match`）在领地这一侧**一个请求都不发** ⇒ 也没有 loading 可遮。
    // 遮挡改由匹配页自己负责（它发请求、它等回包）。
    assert.equal(h.busy.length, 0, '领地不发请求 ⇒ 不该出现 loading');
    // 返回领地后再点（模拟上一局已结算、battleId 已清）⇒ 可无限重复挑战。
    h.presenter.selectSite(site);
    await flush();
    h.presenter.requestBattle();
    await flush();
    assert.equal(h.nav.length, 2, '★重复挑战：第二次点击照样再进一次匹配');
    assert.deepEqual([...h.battleParams],
        [['2', '1', '372'], ['2', '1', '372']], '重复挑战每次都用同一组宝箱战斗参数');
    assert.equal(h.nav.length, 2, '再次进入战斗');
    assert.equal(h.gatewayCalls.unlock, 0, '重复挑战不夹带解锁请求');
});

test('★asyncPvp 已通关但快照没给 unlockCells：点击跳过解锁直接开战', async () => {
    const h = createAsyncRepeatHarness({
        unlockCells: [367], // 服务端只给 passCells、没给该格 unlockCells 的兜底
        passCells: [367, 372],
    });
    h.presenter.start();
    await flush();
    const site = h.presenter.state.map!.sites[0];
    assert.equal(h.presenter.state.progress?.isOwned(372), true, '372 已通关');
    assert.equal(h.presenter.state.progress?.isCellUnlocked(372), false, '但本地 unlockable 里没有它');
    h.presenter.selectSite(site);
    await flush();
    h.presenter.requestBattle();
    await flush();
    assert.equal(h.gatewayCalls.unlock, 0, '不因缺 unlockable 发解锁请求');
    assert.equal(h.gatewayCalls.startBattle, 0, '请求交给匹配页');
    assert.deepEqual(h.battleParams[0], ['2', '1', '372'],
        '已通关 asyncPvp 用宝箱战斗子类型 2');
    assert.equal(h.nav.length, 1);
});

test('★asyncPvp 未通关：首次挑战用格子战斗子类型 1（通关后才切宝箱子类型 2）', async () => {
    const h = createAsyncRepeatHarness({
        unlockCells: [367], // 372 未解锁、未通关
        passCells: [367],
    });
    h.presenter.start();
    await flush();
    const site = h.presenter.state.map!.sites[0];
    assert.equal(h.presenter.state.progress?.isOwned(372), false, '372 未通关');
    assert.equal(h.presenter.state.progress?.isCellUnlocked(372), false, '372 未解锁');
    h.presenter.selectSite(site); // 第一次点击：解锁并直接开战（2026-11-11）
    assert.equal(h.presenter.state.detail.playerStage, null, '未解锁时不弹据点详情');
    await flush();
    assert.equal(h.gatewayCalls.unlock, 1, '未通关 asyncPvp 先发解锁');
    assert.equal(h.gatewayCalls.startBattle, 0, '解锁步不发战斗请求');
    assert.equal(h.presenter.state.detail.playerStage, null, '解锁回包成功也不自动弹窗');
    assert.equal(h.presenter.state.progress?.isCellUnlocked(372), true);
    // 2026-11-11：花银币解锁那一次就直接进战斗（mode = match ⇒ 匹配页），不等弹窗按钮。
    assert.equal(h.nav.length, 1, '解锁即直开：第一跳由 selectSite 触发');
    h.presenter.selectSite(site); // 已解锁后再点：仍弹侦查面板
    await flush();
    h.presenter.requestBattle(); // 面板「开始战斗」→ 第二跳
    await flush();
    assert.equal(h.gatewayCalls.startBattle, 0, '请求交给匹配页');
    assert.deepEqual(h.battleParams[0], ['1', '1', '372'],
        '未通关 asyncPvp 用格子战斗子类型 1（服务端对没打过的格按格子战斗分流）');
    assert.equal(h.nav.length, 2, '解锁那一次 + 面板按钮各一跳');
});

test('★asyncPvp 本地旧档残留通关但服务端未确认：子类型按服务端判据传 1', async () => {
    const h = createHarness({
        loader: createFakeLoader({
            ...bundle,
            mapJson: asyncRepeatMap,
            campaign: { stages: [stage, asyncRepeatStage], playerCardCount: 3, idleRewardMaxHours: 8, levelAutoStart: true },
        }),
        // 服务端：372 未解锁未通关（玩家确实没打过）
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [367], passCells: [367] },
        } }),
        // 本地旧档残留：ownedCells 含 372（历史档/未上报结算）⇒ `isOwned` 误判已通关
        store: createFakeStore({ ownedCells: [367, 372] }),
    });
    h.presenter.start();
    await flush();
    const site = h.presenter.state.map!.sites[0];
    assert.equal(h.presenter.state.progress?.isOwned(372), true, '旧档残留：本地 owned 有 372');
    assert.equal(h.presenter.state.progress?.isServerOwned(372), false, '但服务端未确认通关');
    h.presenter.selectSite(site);
    await flush();
    h.presenter.requestBattle();
    await flush();
    // isServerOwned=false ⇒ 首次挑战 ⇒ 子类型 1（修复前用 isOwned ⇒ 传 2 ⇒ 服务端「配置错误」）
    assert.equal(h.gatewayCalls.startBattle, 0, '请求交给匹配页');
    assert.deepEqual(h.battleParams[0], ['1', '1', '372'],
        '旧档残留不算通关：asyncPvp 按服务端确认分流，未确认传格子战斗子类型 1');
    assert.equal(h.nav.length, 1);
});
