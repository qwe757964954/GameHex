/**
 * territory-presenter 随机格、固定宝箱、征收与异步据点 专项单测
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

test('published random candidate opens from an adjacent cell and unlocks directly', async () => {
    const publishedMap = JSON.parse(readFileSync(
        assetPath('config/territory-maps/chapter_01.json'), 'utf8'));
    const published = configureTerritoryMap(publishedMap);
    const siteCells = new Set<number>();
    for (const site of published.sites) for (const cell of site.footprint) siteCells.add(cell);
    let target = -1;
    let neighbor = -1;
    for (const candidate of published.randomSites?.candidateCells ?? []) {
        const free = territoryNeighbors(candidate, published)
            .find((cell) => cell !== published.startCellId && !siteCells.has(cell));
        if (free !== undefined) {
            target = candidate;
            neighbor = free;
            break;
        }
    }
    assert.ok(target >= 0 && neighbor >= 0,
        'chapter_01 至少要有一个能从相邻空格开启的随机候选格');
    const h = createHarness({
        loader: createFakeLoader({ ...bundle, mapJson: publishedMap }),
        gateway: createFakeGateway({ fetch: {
            ok: true,
            state: { levelChapter: 1, rewardState: 0,
                unlockCells: [neighbor, published.startCellId], passCells: [published.startCellId] },
        } }),
        store: createFakeStore({ silver: 3000, stamina: 1551 }),
    });
    h.presenter.start();
    await flush();
    assert.ok(h.presenter.state.randomResourceOpenableCells.includes(target));
    // 点格直接开启，不经过详情面板。
    h.presenter.selectRandomResource(target);
    await flush();
    assert.equal(h.presenter.state.detail.open, false);
    assert.deepEqual(h.gatewayCalls.unlockedCells, [target]);
    assert.deepEqual(h.gatewayCalls.passedCells, []);
    assert.equal(h.presenter.state.progress?.isCellUnlocked(target), true);
    // 随机格解锁即通关：地块立即进入已占领（绿色 mapOwned），且不产生通关请求。
    assert.equal(h.presenter.state.progress?.isOwned(target), true);
    assert.deepEqual(h.presenter.state.progress?.pendingPassCells, []);
    // 已开的格子再点不发第二次请求。
    h.presenter.selectRandomResource(target);
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
    assert.deepEqual(h.busy, [], '随机格只使用局部等待，不贡献全屏 loading');
    finish({ ok: false, reason: 'rejected' });
    await flush();
    assert.equal(h.presenter.state.progress?.isCellUnlocked(4), false);
    assert.deepEqual(h.presenter.state.pendingRandomResourceCells, []);
    assert.deepEqual(h.presenter.state.randomResourceOpenableCells, [4]);
});

test('random network failure reconciles server state before allowing another open', async () => {
    const randomBundle: ITerritoryChapterBundle = {
        ...bundle, mapJson: { ...mapJson, randomSites: {
            triggerSilver: 10, rewardPoolId: '2001', candidateCells: [4], maxActive: 1,
        } },
    };
    const gateway = createFakeGateway({ unlock: { ok: false, reason: 'failed' } });
    const h = createHarness({ loader: createFakeLoader(randomBundle), gateway });
    h.presenter.start();
    await flush();
    gateway.gateway.fetchChapterCells = async () => ({ ok: true, state: {
        levelChapter: 1, rewardState: 0, unlockCells: [0, 4], passCells: [0, 4],
    } });
    h.presenter.selectRandomResource(4);
    await flush();
    assert.equal(h.presenter.state.progress.isCellUnlocked(4), true);
    assert.deepEqual(h.presenter.state.pendingRandomResourceCells, []);
    assert.deepEqual(h.tips, []);
    assert.deepEqual(h.rewards, [], '状态核对不伪造或重复派发奖励');
    h.presenter.selectRandomResource(4);
    await flush();
    assert.equal(h.gatewayCalls.unlock, 1);
    h.presenter.dispose();
});

test('disposing a random request ignores late success and failure without resync or rewards', async () => {
    for (const result of [{ ok: true, unlockedCellIds: [4] }, { ok: false, reason: 'failed' }] as TerritoryWriteResult[]) {
        const randomBundle: ITerritoryChapterBundle = {
            ...bundle, mapJson: { ...mapJson, randomSites: {
                triggerSilver: 10, rewardPoolId: '2001', candidateCells: [4], maxActive: 1,
            } },
        };
        let finish: (value: TerritoryWriteResult) => void = () => {};
        const gateway = createFakeGateway();
        gateway.gateway.unlockCell = () => new Promise(resolve => { finish = resolve; });
        const h = createHarness({ loader: createFakeLoader(randomBundle), gateway });
        h.presenter.start();
        await flush();
        h.presenter.selectRandomResource(4);
        h.presenter.dispose();
        const changes = h.stateChanges();
        const fetches = h.gatewayCalls.fetch;
        finish(result);
        await flush();
        assert.equal(h.stateChanges(), changes);
        assert.equal(h.gatewayCalls.fetch, fetches);
        assert.deepEqual(h.busy, []);
        assert.deepEqual(h.rewards, []);
        assert.deepEqual(h.tips, []);
    }
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
    // 2026-10-22 追加口径：领取成功**不再弹**「已领取」轻提示 —— 那条深色提示条压在屏幕中央，
    // 正好盖住刚开的宝箱和它周围的地块，而"领取成功"已经由开箱表演 + 奖励飘字表达。
    assert.deepEqual(h.tips, [], '领取成功不该再弹「已领取」提示条');
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
    gateway.gateway.unlockCell = () => new Promise(resolve => { finish = resolve; });
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
        assetPath('config/territory-maps/chapter_01.json'), 'utf8'));
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
        assetPath('config/territory-maps/chapter_01.json'), 'utf8'));
    const h = createHarness({
        loader: createFakeLoader({ ...bundle, mapJson: publishedMap }),
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [346, 347, 367], passCells: [367] },
        } }),
    });
    h.presenter.start();
    await flush();
    const site = h.presenter.state.map!.sites.find((entry) => entry.cellId === 326)!;
    assert.ok(h.presenter.state.revealedCells.includes(326));
    h.presenter.selectSite(site);
    await flush();
    assert.deepEqual(h.gatewayCalls.unlockedCells, [326]);
    assert.deepEqual(h.gatewayCalls.passedCells, []);
    assert.equal(h.presenter.state.progress?.isCellUnlocked(326), true);
    assert.equal(h.presenter.state.progress?.isOwned(326), false);
    h.presenter.selectSite(site);
    await flush();
    assert.deepEqual(h.gatewayCalls.passedCells, [326]);
    assert.equal(h.presenter.state.progress?.isOwned(326), true);
    h.presenter.selectSite(site);
    await flush();
    assert.deepEqual(h.gatewayCalls.passedCells, [326]);
});

test('fixed resource pass rejection keeps the chest open for retry', async () => {
    const publishedMap = JSON.parse(readFileSync(
        assetPath('config/territory-maps/chapter_01.json'), 'utf8'));
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
        assetPath('config/territory-maps/chapter_01.json'), 'utf8'));
    const published = configureTerritoryMap(publishedMap);
    const candidates = published.randomSites?.candidateCells ?? [];
    const siteCells = new Set<number>();
    for (const site of published.sites) for (const cell of site.footprint) siteCells.add(cell);
    const startNeighbors = new Set(territoryNeighbors(published.startCellId, published));
    let target = -1;
    let bridge = -1;
    let anchor = -1;
    for (const candidate of candidates) {
        if (startNeighbors.has(candidate)) continue;
        const targetNeighbors = new Set(territoryNeighbors(candidate, published));
        for (const next of targetNeighbors) {
            if (!candidates.includes(next) || startNeighbors.has(next)) continue;
            const free = territoryNeighbors(next, published).find((cell) =>
                cell !== published.startCellId && cell !== candidate
                && !targetNeighbors.has(cell) && !siteCells.has(cell));
            if (free !== undefined) {
                target = candidate;
                bridge = next;
                anchor = free;
                break;
            }
        }
        if (target >= 0) break;
    }
    assert.ok(target >= 0 && bridge >= 0 && anchor >= 0,
        'chapter_01 至少要有一组“隐藏候选格 + 可开启的桥接候选格”');
    const h = createHarness({
        loader: createFakeLoader({ ...bundle, mapJson: publishedMap }),
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0,
                unlockCells: [anchor, published.startCellId], passCells: [published.startCellId] },
        } }),
    });
    h.presenter.start();
    await flush();
    // 目标格与起始格 / 锚点都不相邻，开局保持隐藏。
    assert.equal(h.presenter.state.revealedCells.includes(target), false);
    assert.equal(h.presenter.state.revealedCells.includes(bridge), true);
    h.presenter.selectRandomResource(target);
    await flush();
    assert.equal(h.gatewayCalls.unlock, 0);
    // 解锁桥接格后，其六边邻居目标格被揭示。
    h.presenter.selectRandomResource(bridge);
    await flush();
    assert.equal(h.presenter.state.revealedCells.includes(target), true);
});

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
    h.presenter.fastTick(Date.now());
    assert.equal(h.storeCalls.settleIdle, 0, '进入页面与定时拍都不能消费挂机产出');
    assert.equal(h.rewards.length, 0);
    // 领奖已改为异步（在线走 `CmdCityChapterIdleRewardReqMsg`）；夹具 base 返回 offline ⇒ 本地兜底。
    await h.presenter.claimIdleRewards(Date.now());
    await flush();
    assert.equal(h.storeCalls.settleIdle, 1);
    assert.equal(h.rewards.length, 1, '仅点击征收后发奖');
    assert.ok(h.rewards.every((batch) => batch.some((g) => g.resId === 9 && g.amount === 3)));
    assert.ok(h.rewardOrigins.every((origin) => origin === undefined || origin === null),
        '挂机产出按关卡结算，不该带格子');
});

test('征收保留离线累计，领取推进真实账本，连点与重进均不重复发奖', async (t) => {
    let clock = Date.now();
    t.mock.method(Date, 'now', () => clock);
    const store = createFakeStore({ ownedCells: [1] });
    const realStore = new TerritorySaveStore(null);
    store.store.settleIdleRewards = (id, sources, cap, now, source) => {
        const result = realStore.settleIdleRewards(id, sources, cap, now, source, () => 0);
        store.store.saveProgress(id, result.save.progress, result.save);
        return result;
    };
    const h = createHarness({ store });
    h.presenter.start();
    await flush();
    const start = h.presenter.state.idleRewardStartedAt;
    assert.equal(typeof start, 'number', '占领后立即建立计时，不能等第一次征收才开始');
    const now = start + 90 * 60 * 1000;
    clock = now;
    h.presenter.slowTick(now);
    assert.equal(h.rewards.length, 0);
    assert.equal(h.presenter.state.idleRewardStartedAt, start);
    await h.presenter.claimIdleRewards(now);
    await flush();
    assert.equal(h.rewards.length, 1);
    assert.equal(h.presenter.state.idleRewardStartedAt, start + 60 * 60 * 1000);
    await h.presenter.claimIdleRewards(now);
    await flush();
    assert.equal(h.rewards.length, 1, '连点不会重复发奖');
    h.presenter.dispose();
    const reopened = createHarness({ store });
    reopened.presenter.start();
    await flush();
    await reopened.presenter.claimIdleRewards(now);
    await flush();
    assert.equal(reopened.rewards.length, 0, '重进后不能重复领取已结算小时');
    reopened.presenter.dispose();
});

test('征收走协议：tlCmdGoods 原样弹窗、idleTime 覆盖起点、不再本地结算', async () => {
    const serverIdleSeconds = 1_700_000_000;
    const gateway = createFakeGateway({
        claim: {
            ok: true,
            rewards: [{ resId: 7, amount: 120 }, { resId: 501, amount: 2 }],
            idleTimeSeconds: serverIdleSeconds,
        },
    });
    const h = createHarness({ gateway });
    h.presenter.start();
    await flush();
    const settleBefore = h.storeCalls.settleIdle;
    await h.presenter.claimIdleRewards(Date.now());
    assert.equal(h.gatewayCalls.claim, 1, '点征收必须发 CmdCityChapterIdleRewardReqMsg');
    assert.equal(h.storeCalls.settleIdle, settleBefore, '在线不得再走本地结算（会双算）');
    assert.deepEqual(h.rewards, [[{ resId: 7, amount: 120 }, { resId: 501, amount: 2 }]],
        '展示的必须是服务端实际发放的 tlCmdGoods');
    assert.deepEqual(h.rewardOptions[0], { popup: true },
        '挂机产出必须强制弹窗 —— 钱包类默认分流只会飘字，玩家看不到奖励');
    assert.equal(h.presenter.state.idleRewardStartedAt, serverIdleSeconds * 1000,
        'idleTime 是新的挂机起点，UI 计时必须从它算');
});

test('领奖在宿主退出后收到成功结果，不再改写账号挂机时间', async () => {
    let reply: (result: TerritoryIdleRewardResult) => void = () => {};
    const gateway = createFakeGateway();
    gateway.gateway.claimIdleReward = () => new Promise(resolve => { reply = resolve; });
    const idleWrites: number[] = [];
    const h = createHarness({ gateway, writeServerIdleTimeSeconds: seconds => idleWrites.push(seconds) });
    h.presenter.start();
    await flush();
    const pending = h.presenter.claimIdleRewards(Date.now());
    h.presenter.dispose();
    reply({ ok: true, idleTimeSeconds: 1700000000, rewards: [{ resId: 7, amount: 10 }] });
    await pending;
    assert.deepEqual(idleWrites, []);
    assert.deepEqual(h.rewards, []);
    assert.equal(h.busy.filter(item => item.busy).length, h.busy.filter(item => !item.busy).length);
});

test('解锁请求在途：loading 在网关调用前显示，解锁回包后同一层 loading 继续盖着开战请求', async () => {
    const pending: Array<(value: TerritoryWriteResult) => void> = [];
    const gateway = createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0], passCells: [0] },
    } });
    let unlockCount = 0;
    gateway.gateway.unlockCell = () => {
        unlockCount++;
        return new Promise((resolve) => pending.push(resolve));
    };
    const h = createHarness({ gateway });
    h.presenter.start();
    await flush();
    h.presenter.selectSite(h.presenter.state.map!.sites[0]);
    // selectSite 同步走到「确认要发请求」⇒ 网关调用前 setBusy(true) 已同步执行。
    // 🔴 2026-10-29：锁着的关卡「解锁 + 开战」共用一个 `runCellWrite` ⇒ 只有**一层** loading，
    // 文案取开战那句（这一下最终是进战斗，不是停在解锁）。
    assert.equal(h.busy.length, 1, '请求在途只显示一层 loading');
    assert.equal(h.busy[0].busy, true, '请求在途 ⇒ busy=true');
    assert.equal(h.busy[0].text, '开战中…', '解锁 + 开战共用一层 loading，文案取「开战中…」');
    pending[0]({ ok: true, unlockedCellIds: [1] });
    await flush();
    assert.equal(h.busy.length, 2, '★两段请求之间 loading 不许归零（只有一对 show/hide）');
    assert.equal(h.busy[1].busy, false, '请求结束 ⇒ busy=false');
    assert.equal(unlockCount, 1, '全程只发一次解锁请求');
    // 普通关：解锁回包后直接交给匹配页（领地不再发开战请求），loading 照样在同一层收掉。
    assert.equal(h.gatewayCalls.startBattle, 0, '开战请求交给匹配页');
    assert.equal(h.nav.length, 1, '解锁回包后同一交互内就去匹配');
});

test('a second write request is refused at the entrance: one loading layer, strictly paired', async () => {
    const fixedBundle: ITerritoryChapterBundle = {
        ...bundle,
        mapJson: { ...mapJson, sites: [...mapJson.sites,
            { id: 'fixed_4', type: 'fixedResource', cellId: 4, footprint: [4], rewardId: 1011,
                unlock: { requiredCells: [0], combatPower: 0, silverCost: 0, staminaCost: 0, exploreSeconds: 1 } },
            { id: 'fixed_5', type: 'fixedResource', cellId: 5, footprint: [5], rewardId: 1011,
                unlock: { requiredCells: [0], combatPower: 0, silverCost: 0, staminaCost: 0, exploreSeconds: 1 } }] },
    };
    const pending: Array<(value: TerritoryWriteResult) => void> = [];
    const gateway = createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0], passCells: [0] },
    } });
    let unlockCount = 0;
    gateway.gateway.unlockCell = () => {
        unlockCount++;
        return new Promise((resolve) => pending.push(resolve));
    };
    const h = createHarness({ loader: createFakeLoader(fixedBundle), gateway });
    h.presenter.start();
    await flush();
    const site4 = h.presenter.state.map!.sites.find((s) => s.cellId === 4)!;
    const site5 = h.presenter.state.map!.sites.find((s) => s.cellId === 5)!;
    h.presenter.selectSite(site4);
    // 🔴 第一条写请求在途 ⇒ 第二个格**不受理**（不换号、不发包）。
    assert.equal(h.presenter.selectSite(site5), false, '★写请求在途 ⇒ 第二个格不受理');
    assert.equal(h.busy.length, 1, '只有一层 loading（busy=true）');
    assert.equal(unlockCount, 1, '只发一次解锁');
    pending[0]({ ok: true, unlockedCellIds: [4] });
    await flush();
    assert.equal(h.busy.length, 2, 'show / hide 严格配对，不残留遮罩');
    assert.equal(h.busy[1].busy, false, '回包结束即 hide 那一层');
});

test('dispose retracts in-flight loading layers and later exits do not double-hide', async () => {
    const fixedBundle: ITerritoryChapterBundle = {
        ...bundle,
        mapJson: { ...mapJson, sites: [...mapJson.sites,
            { id: 'fixed_4', type: 'fixedResource', cellId: 4, footprint: [4], rewardId: 1011,
                unlock: { requiredCells: [0], combatPower: 0, silverCost: 0, staminaCost: 0, exploreSeconds: 1 } }] },
    };
    const pending: Array<(value: TerritoryWriteResult) => void> = [];
    const gateway = createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0], passCells: [0] },
    } });
    gateway.gateway.unlockCell = () => new Promise((resolve) => pending.push(resolve));
    const h = createHarness({ loader: createFakeLoader(fixedBundle), gateway });
    h.presenter.start();
    await flush();
    h.presenter.selectSite(h.presenter.state.map!.sites.find((s) => s.cellId === 4)!);
    assert.equal(h.busy.length, 1, '请求在途 ⇒ loading 已弹出');
    h.presenter.dispose();
    assert.equal(h.busy.length, 2, 'dispose 撤回在途 loading');
    assert.equal(h.busy[1].busy, false, '撤回的是 hide');
    pending[0]({ ok: true, unlockedCellIds: [4] });
    await flush();
    assert.equal(h.busy.length, 2, 'dispose 后 finally 的 exitBusy 幂等，不重复 hide');
});

test('server rejection settles the write ticket at once (no 5s loading wait)', async () => {
    const fixedBundle: ITerritoryChapterBundle = {
        ...bundle,
        mapJson: { ...mapJson, sites: [...mapJson.sites,
            { id: 'fixed_4', type: 'fixedResource', cellId: 4, footprint: [4], rewardId: 1011,
                unlock: { requiredCells: [0], combatPower: 0, silverCost: 0, staminaCost: 0, exploreSeconds: 1 } }] },
    };
    const pending: Array<(value: TerritoryWriteResult) => void> = [];
    const gateway = createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0], passCells: [0] },
    } });
    gateway.gateway.unlockCell = () => new Promise((resolve) => pending.push(resolve));
    const h = createHarness({ loader: createFakeLoader(fixedBundle), gateway });
    h.presenter.start();
    await flush();
    h.presenter.selectSite(h.presenter.state.map!.sites.find((s) => s.cellId === 4)!);
    assert.equal(h.busy.length, 1, '请求在途 ⇒ 一层 loading');
    // 没有对应在途票的协议不许误伤（扫荡那条根本没发）。
    h.presenter.applyWriteError('CmdCityChapterSweepReqMsg', 'server_error');
    assert.equal(h.busy.length, 1, '没有在途票 ⇒ 什么都不做');
    // 服务端拒绝：网络层只 reject 那条请求、不派发 Rsp 事件 ⇒ 走这条旁路当场收尾。
    h.presenter.applyWriteError('CmdCityChapterUnlockCellReqMsg', 'server_error');
    await flush();
    assert.equal(h.busy.length, 2, '★当场 hide，不等 5 秒硬超时');
    assert.equal(h.busy[1].busy, false, '收尾那一层是 hide');
    assert.deepEqual(h.presenter.state.pendingFixedResourceCells, [], '在途判重标记同步清掉');
});

test('a rejected write tips once: CmdTips path stays silent, Rsp succ=0 still tips', async () => {
    const pending: Array<(value: TerritoryWriteResult) => void> = [];
    const gateway = createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0], passCells: [0] },
    } });
    gateway.gateway.unlockCell = () => new Promise((resolve) => pending.push(resolve));
    const h = createHarness({ gateway });
    h.presenter.start();
    await flush();
    const sites = h.presenter.state.map!.sites;
    // ① 服务端走 `CmdTips` 拒绝：提示已经在网络层弹过，这里不许再补一条。
    h.presenter.selectSite(sites[0]);
    h.presenter.applyWriteError('CmdCityChapterUnlockCellReqMsg', 'server_error');
    await flush();
    assert.equal(h.tips.length, 0, '★CmdTips 路径：客户端不再补提示（服务端已经说过原因）');
    // ② 正常回包 `succ = 0`：服务端没弹过，客户端必须自己提示。
    // 收尾后 pending / busy 都清了 ⇒ 同一格可以重新发（服务端拒绝不影响本地锁态）。
    h.presenter.selectSite(sites[0]);
    assert.equal(pending.length, 2, '拒绝收尾后同一格可以重新发出解锁');
    h.presenter.applyUnlockRsp({ ok: false, reason: 'rejected' });
    await flush();
    assert.equal(h.tips.length, 1, '★Rsp succ=0 路径：客户端必须提示');
});

test('unlock success renders its final frame after pending clears (station clickable)', async () => {
    const fixedBundle: ITerritoryChapterBundle = {
        ...bundle,
        mapJson: { ...mapJson, sites: [...mapJson.sites,
            { id: 'fixed_4', type: 'fixedResource', cellId: 4, footprint: [4], rewardId: 1011,
                unlock: { requiredCells: [0], combatPower: 0, silverCost: 0, staminaCost: 0, exploreSeconds: 1 } }] },
    };
    const pending: Array<(value: TerritoryWriteResult) => void> = [];
    const gateway = createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0], passCells: [0] },
    } });
    gateway.gateway.unlockCell = () => new Promise((resolve) => pending.push(resolve));
    const h = createHarness({ loader: createFakeLoader(fixedBundle), gateway });
    const pendingAtRender: boolean[] = [];
    h.presenter.onOutput(event => { if (event.kind === 'changed') pendingAtRender.push(h.presenter.state.pendingFixedResourceCells.includes(4)); });
    h.presenter.start();
    await flush();
    h.presenter.selectSite(h.presenter.state.map!.sites.find((s) => s.cellId === 4)!);
    pending[0]({ ok: true, unlockedCellIds: [4] });
    await flush();
    assert.equal(h.presenter.state.pendingFixedResourceCells.includes(4), false, 'pending 最终为空');
    assert.equal(pendingAtRender[pendingAtRender.length - 1], false,
        '最后一次渲染发生在 pending 清空后 ⇒ 站点按钮恢复可点（修复前最后一条是 true）');
});

test('校验失败（银币不足）不发请求：不弹 loading 不闪屏', async () => {
    const gateway = createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0], passCells: [0] },
    } });
    const h = createHarness({
        gateway,
        store: createFakeStore({ silver: 0 }),
    });
    h.presenter.start();
    await flush();
    h.presenter.selectSite(h.presenter.state.map!.sites[0]);
    h.presenter.requestBattle();
    await flush();
    assert.equal(h.busy.length, 0, '校验失败不发请求 ⇒ 不弹 loading');
    assert.equal(h.gatewayCalls.unlock, 0, '银币不足 ⇒ 未发解锁请求');
    assert.ok(h.tips.some((tip) => tip.includes('银币不足')), '只给轻提示');
});

test('异步据点解锁在途重复点击不取消原请求，失败后保持锁定且不弹窗', async () => {
    const gateway = createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [367], passCells: [367] },
    } });
    let resolveUnlock: ((result: TerritoryWriteResult) => void) | undefined;
    let requests = 0;
    gateway.gateway.unlockCell = () => {
        requests++;
        return new Promise(resolve => { resolveUnlock = resolve; });
    };
    const h = createHarness({ loader: createFakeLoader({ ...bundle, mapJson: asyncRepeatMap,
        campaign: { stages: [stage, asyncRepeatStage], playerCardCount: 3, idleRewardMaxHours: 8, levelAutoStart: true } }), gateway });
    h.presenter.start();
    await flush();
    const site = h.presenter.state.map!.sites[0];
    h.presenter.selectSite(site);
    h.presenter.selectSite(site);
    assert.equal(requests, 1);
    assert.ok(resolveUnlock);
    resolveUnlock({ ok: false, reason: TERRITORY_REQUEST_STATUS.rejected });
    await flush();
    assert.equal(h.presenter.state.progress?.isCellUnlocked(372), false);
    assert.equal(h.presenter.state.detail.playerStage, null);
    h.presenter.selectSite(site);
    assert.equal(requests, 2, '失败后可以重新解锁');
    resolveUnlock({ ok: true });
    await flush();
    assert.equal(h.presenter.state.progress?.isCellUnlocked(372), true);
    assert.equal(h.presenter.state.detail.playerStage, null);
});

test('unlock lock marker ignores wallet shortfall: openable false but not lock-blocked', async () => {
    const fixedBundle: ITerritoryChapterBundle = {
        ...bundle,
        mapJson: { ...mapJson, sites: [...mapJson.sites, {
            id: 'fixed_4', type: 'fixedResource', cellId: 4, footprint: [4], rewardId: 1011,
            unlock: { requiredCells: [0], combatPower: 0, silverCost: 10,
                staminaCost: 1, exploreSeconds: 1 },
        }] },
    };
    // 前置（起点 0 已占领）满足，但银币 9 < 10 ⇒ 开不了。
    const h = createHarness({ loader: createFakeLoader(fixedBundle),
        store: createFakeStore({ silver: 9, stamina: 1 }) });
    h.presenter.start();
    await flush();
    assert.equal(h.presenter.state.siteOpenableCells.includes(4), false, '缺钱 ⇒ 不在可开启集合');
    assert.equal(h.presenter.state.lockBlockedCells.includes(4), false, '缺钱 ≠ 被前置卡住，不上锁');
});

test('unlock lock marker never overlaps cells that can be opened right now', async () => {
    const publishedMap = JSON.parse(readFileSync(
        assetPath('config/territory-maps/chapter_01.json'), 'utf8'));
    const h = createHarness({
        loader: createFakeLoader({ ...bundle, mapJson: publishedMap }),
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [367], passCells: [367] },
        } }),
    });
    h.presenter.start();
    await flush();
    const lockBlocked = new Set(h.presenter.state.lockBlockedCells);
    for (const cellId of h.presenter.state.siteOpenableCells) {
        assert.equal(lockBlocked.has(cellId), false, `站点格 ${cellId} 能开却被上锁`);
    }
    for (const cellId of h.presenter.state.randomResourceOpenableCells) {
        assert.equal(lockBlocked.has(cellId), false, `随机格 ${cellId} 能开却被上锁`);
    }
});

test('unlocked-but-unclaimed chest prerequisite locks the successor instead of reddening the price', async () => {
    const chest = (cellId: number, required: number[]) => ({
        id: `chest_${cellId}`, type: 'fixedResource', cellId, footprint: [cellId], rewardId: 1011,
        unlock: { requiredCells: required, combatPower: 0, silverCost: 10,
            staminaCost: 1, exploreSeconds: 1 },
    });
    const fixedBundle: ITerritoryChapterBundle = {
        ...bundle,
        mapJson: { ...mapJson, sites: [chest(5, [0]), chest(6, [5])] },
    };
    // 5 已解锁（进 unlockCells）但没 pass ⇒ 未领取；6 只差「把 5 点开」这一步。
    const h = createHarness({
        loader: createFakeLoader(fixedBundle),
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [5], passCells: [0] },
        } }),
        store: createFakeStore({ silver: 10000, stamina: 100 }),
    });
    h.presenter.start();
    await flush();
    assert.equal(h.presenter.state.lockBlockedCells.includes(6), true, '前置宝箱没点开 ⇒ 上锁');
    assert.equal(h.presenter.state.siteOpenableCells.includes(6), false, '锁与可开启集合必须互补');
    assert.equal(h.presenter.state.lockBlockedCells.includes(5), false, '5 自己已解锁，不再上锁');
});
