import { createControllerContext } from './helpers/controller-context';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import {
    ITerritoryBattleNavParams,
    ITerritoryCellGateway,
    ITerritoryChapterBundle,
    ITerritoryChapterLoader,
    ITerritoryChapterStore,
    ITerritoryNavigateBattlePayload,
    ITerritoryPresenterPorts,
    ITerritoryShowRewardsPayload,
    ITerritoryShowTipPayload,
    ITerritorySetBusyPayload,
    TerritoryPresenter,
} from '../assets/script/app/territory/application/TerritoryPresenter';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { TerritoryController } from '../assets/script/app/territory/application/TerritoryController';
import * as territoryEvents from '../assets/script/app/territory/application/TerritoryEvents';
const { TerritoryUiEvent, TerritoryViewEvent } = territoryEvents;
import type { TerritoryCampaignStage } from '../assets/script/app/territory/model/TerritoryCampaignConfig';
import { TERRITORY_REQUEST_STATUS } from '../assets/script/app/territory/model/TerritoryRequestStatus';
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
import { emptyCellState } from '../assets/script/app/territory/model/TerritoryCellBitSet';
import { assetPath } from './helpers/asset-paths';

interface IBattlePageProbe {
    onDetailStart(): void;
    onDetailClose(): void;
    onNavigateToBattle(payload: ITerritoryNavigateBattlePayload): void;
}

/** 用真实页面事件处理器连接真实 Presenter；只替换引擎、弹窗栈和最终路由。 */
function createBattlePageProbe(presenter: TerritoryPresenter) {
    const exports: { MainTerritoryMap?: new () => IBattlePageProbe } = {};
    class LevelInfoPanel {}
    class LevelTipPanel {}
    let opened = true;
    let closes = 0;
    const routes: unknown[] = [];
    const imports: Record<string, unknown> = {
        cc: { Component: class {}, _decorator: {
            ccclass: () => (type: unknown) => type, property: () => () => {},
        } },
        '../../core/asset/ResourceScope': { ResourceScope },
        '../zcds/application/ZCBattlePreparation': { createZCBattlePreload: () => ({ ready: Promise.resolve() }) },
        '../../framework/event/EventMgr': { EventMgr },
        '../territory/application/TerritoryEvents': territoryEvents,
        './LevelInfoPanel': { LevelInfoPanel },
        './LevelTipPanel': { LevelTipPanel },
        '../../core/runtime/GameRoute': { GameRoute: { Battle: 'battle' } },
        '../../framework/procedure/ProcedureManager': { ProcedureManager: {
            navigate: (_route: string, params: unknown) => routes.push(params),
        } },
        '../../framework/ui/PopupManager': { PopupManager: { inst: {
            get: (type: unknown) => type === LevelInfoPanel && opened ? { close: () => {
                opened = false;
                closes++;
                EventMgr.instance.emit(TerritoryUiEvent.Intent, { intent: { kind: 'closeDetail' } });
            } } : null,
        } } },
    };
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/main/MainTerritoryMap.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText, { exports, require: (id: string) => imports[id] ?? {} });
    assert.ok(exports.MainTerritoryMap);
    const page = new exports.MainTerritoryMap();
    const controller = new TerritoryController(() => presenter, { context: createControllerContext(),
        network: { addEvent() {}, removeCaller() {} },
        roleCache: { subscribe: () => () => {} },
        cells: { readCellInfo: () => null, readPassCellsBro: () => null },
        schedule: () => () => {},
    });
    EventMgr.instance.on(TerritoryViewEvent.Command,
        (event: territoryEvents.ITerritoryCommandEvent) => {
            if (event.command.kind === 'navigate') page.onNavigateToBattle(event.command.payload);
        }, page);
    Object.assign(page, { controllerResources: controller.resources });
    controller.start();
    return {
        page: {
            onDetailStart: () => EventMgr.instance.emit(TerritoryUiEvent.Intent, { intent: { kind: 'battle' } }),
            onDetailClose: () => EventMgr.instance.emit(TerritoryUiEvent.Intent, { intent: { kind: 'closeDetail' } }),
        }, routes, closes: () => closes,
        dispose: () => { controller.dispose(); EventMgr.instance.offTarget(page); },
    };
}

test('关卡按钮等有效开战回包后才收弹窗，关闭事件不能取消刚发出的请求', async () => {
    const gateway = createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [367, 213], passCells: [367] },
    } });
    let reply: (result: TerritoryStartBattleResult) => void = () => {};
    gateway.gateway.startBattle = () => new Promise((resolve) => { reply = resolve; });
    const h = createHarness({ loader: createBossFindLoader(), gateway });
    const probe = createBattlePageProbe(h.presenter);
    try {
        await flush();
        assert.equal(h.presenter.focusCurrentBoss(), 213);
        probe.page.onDetailStart();
        assert.equal(probe.closes(), 0, '请求在途不能触发 DETAIL_CLOSE 并作废 requestId');
        reply({ ok: true, battle: fakeBattleStart });
        await flush();
        assert.equal(h.nav.length, 1, '有效回包必须交接到战斗流程');
        assert.equal(probe.routes.length, 1);
        assert.equal(probe.closes(), 1, '流程接手时收掉挂在全局弹窗栈上的关卡界面');
    } finally {
        probe.dispose();
        h.presenter.dispose();
    }
});

test('关卡开战被拒绝时保留详情可重试，玩家主动关闭仍取消迟到回包', async () => {
    const gateway = createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [367, 213], passCells: [367] },
    } });
    let reply: (result: TerritoryStartBattleResult) => void = () => {};
    let requests = 0;
    gateway.gateway.startBattle = () => { requests++; return new Promise((resolve) => { reply = resolve; }); };
    const h = createHarness({ loader: createBossFindLoader(), gateway });
    const probe = createBattlePageProbe(h.presenter);
    try {
        await flush();
        h.presenter.focusCurrentBoss();
        probe.page.onDetailStart();
        reply({ ok: false, reason: 'failed' });
        await flush();
        assert.equal(probe.closes(), 0);
        assert.equal(h.presenter.state.detail.levelInfo?.fightEnabled, true);
        probe.page.onDetailStart();
        assert.equal(requests, 2);
        probe.page.onDetailClose();
        reply({ ok: true, battle: fakeBattleStart });
        await flush();
        assert.equal(h.nav.length, 0, '真正关闭详情后仍必须丢弃迟到回包');
    } finally {
        probe.dispose();
        h.presenter.dispose();
    }
});

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
    buildFrames: new Map(),
};

const bundle: ITerritoryChapterBundle = {
    mapJson,
    campaign: { stages: [stage], playerCardCount: 3, idleRewardMaxHours: 8, levelAutoStart: true },
    art: nullArt,
};

function createBossFindLoader() {
    return createFakeLoader({
        ...bundle,
        mapJson: JSON.parse(readFileSync('assets/remoteRef/chapter_01.json', 'utf8')),
        campaign: {
            ...bundle.campaign,
            stages: [
                { ...stage, levelId: 10004, stage: 4 },
                { ...stage, levelId: 10005, stage: 5, isBoss: true, mode: 'defence' },
                { ...stage, levelId: 10010, stage: 10, isBoss: true, mode: 'defence' },
            ],
        },
    });
}

test('quick find opens current Boss detail without unlocking, charging, or starting battle', async () => {
    const h = createHarness({ loader: createBossFindLoader(), gateway: createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [367, 213], passCells: [367] },
    } }) });
    h.presenter.start();
    await flush();
    assert.equal(h.presenter.focusCurrentBoss(), 213);
    assert.ok(h.presenter.state.detail.levelInfo, '关卡界面必须弹');
    assert.equal(h.presenter.state.detail.levelInfo?.title, '首领关卡  5');
    assert.equal(h.presenter.state.detail.levelInfo?.fightEnabled, true, 'server-unlocked Boss remains challengeable');
    assert.equal(h.gatewayCalls.unlock, 0);
    assert.equal(h.gatewayCalls.startBattle, 0);
    assert.equal(h.gatewayCalls.pass, 0);
    assert.equal(h.storeCalls.beginBattle, 0);
    assert.equal(h.nav.length, 0);
    h.presenter.requestBattle();
    h.presenter.requestBattle();
    await flush();
    assert.equal(h.gatewayCalls.startBattle, 1, 'only the detail button starts a single server battle');
    assert.deepEqual(h.gatewayCalls.battleParamsList, [['1', '1', '213']]);
    assert.equal(h.nav.length, 1);
    h.presenter.dispose();
});

test('locked Boss detail uses the existing unlock-then-start flow and cannot cancel an in-flight request', async () => {
    const h = createHarness({ loader: createBossFindLoader(), gateway: createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [367, 252], passCells: [367, 252] },
    } }) });
    h.presenter.start();
    await flush();
    assert.equal(h.presenter.focusCurrentBoss(), 213);
    assert.equal(h.presenter.state.detail.levelInfo?.fightCaption, '解锁后开战');
    h.presenter.requestBattle();
    assert.equal(h.presenter.focusCurrentBoss(), null, 'quick find must not invalidate a pending write');
    await flush();
    assert.equal(h.gatewayCalls.unlock, 1);
    assert.equal(h.gatewayCalls.startBattle, 0);
    assert.ok(h.presenter.state.detail.levelInfo, '关卡界面必须弹');
    assert.equal(h.presenter.state.detail.levelInfo?.fightCaption, '开始战斗');
    h.presenter.requestBattle();
    await flush();
    assert.equal(h.gatewayCalls.startBattle, 1);
    assert.equal(h.nav.length, 1);
    h.presenter.dispose();
});

test('已通关的普通关卡：弹窗照常打开，「开始战斗」可点、照常扣体力、真能再打一局', async () => {
    // 用**单格**夹具（不借 `chapter_01.json` 那张大地图）：地图上第一个 `stage` 站点未绑定关卡，
    // `staminaCost` 就是 0，会把「照常扣体力」这条断言测成假绿/假红。这里显式绑 `stage`（体力 5）。
    const h = createHarness({
        loader: createFakeLoader({
            ...bundle,
            mapJson: { ...mapJson, sites: [{ id: 'replay', type: 'stage', cellId: 1, configId: '1001' }] },
            campaign: { ...bundle.campaign, stages: [{ ...stage, isBoss: false, mode: 'match' }] },
        }),
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0, 1], passCells: [0, 1] },
        } }),
    });
    h.presenter.start();
    await flush();
    const site = h.presenter.state.map!.sites[0];
    assert.equal(h.presenter.state.progress?.isAreaPassed(site.cellId), true, '夹具前提：这一格已通关');
    h.presenter.selectSite(site);
    const info = h.presenter.state.detail.levelInfo;
    // 🔴 2026-10-28 用户两条口径：
    //   ①「点击已通过的关卡也可以打开【领地关卡信息弹窗】」——图上已放开 `interactive`；
    //   ②「已通过的关卡重复挑战仍需要消耗体力」——弹窗按钮**不许**退化成「已通关 + 禁用」，
    //     否则 ② 就成了空话（按钮根本点不动，也就没有"重复挑战扣体力"这回事）。
    assert.ok(info, '已通关的关卡必须也能打开这个弹窗（以前点在建筑上毫无反应）');
    assert.equal(info!.fightCaption, '开始战斗', '已通关 ≠ 不能打，按钮文案不能改');
    assert.equal(info!.fightEnabled, true, '重复挑战要能点得动');
    assert.equal(info!.staminaCost, 5, '重复挑战照常扣体力 ⇒ 费用必须是关卡配的 5（不能归零）');
    // 真按下去要真的发开战请求（`handleBattleStationStart` 对已通关的普通关卡不再提前 return）。
    h.presenter.requestBattle();
    await flush();
    assert.equal(h.gatewayCalls.startBattle, 1, '已通关的普通关卡再打一次照样请求服务端');
    const params = h.gatewayCalls.battleParamsList;
    assert.equal(params[params.length - 1]?.[0], '1',
        '主线 stage/boss 恒为格子战斗子类型 1（宝箱战斗子类型 2 只属于已通关的 asyncPvp）');
    assert.equal(h.gatewayCalls.unlock, 0, '已通关 ⇒ 不再重复解锁');
    assert.equal(h.nav.length, 1, '开战成功后进入战斗');
    h.presenter.dispose();
});

test('已通关的首领同样可重复挑战，弹窗按钮保持「开始战斗」', async () => {
    const h = createHarness({ loader: createBossFindLoader(), gateway: createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [367], passCells: [367] },
    } }) });
    h.presenter.start();
    await flush();
    const map = h.presenter.state.map!;
    const site = map.sites.find((candidate) => candidate.type === 'boss')!;
    h.presenter.state.progress!.markCellPassed(site.cellId);
    h.presenter.selectSite(site);
    const info = h.presenter.state.detail.levelInfo;
    assert.ok(info, '已通关的首领同样要能打开弹窗');
    assert.equal(info!.fightCaption, '开始战斗', '首领可重复挑战，按钮不能跟着改成「已通关」');
    assert.equal(info!.fightEnabled, true);
    assert.ok(info!.staminaCost > 0, '可再战 ⇒ 体力费用照旧显示');
    h.presenter.dispose();
});

test('quick find falls back to the latest cleared Boss and starts a server battle without unlocking again', async () => {
    const h = createHarness({ loader: createBossFindLoader(), gateway: createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [367], passCells: [367, 193] },
    } }) });
    h.presenter.start();
    await flush();
    assert.equal(h.presenter.focusCurrentBoss(), 105);
    assert.equal(h.presenter.state.detail.levelInfo?.title, '首领关卡  10');
    h.presenter.state.progress!.markCellPassed(85);
    assert.equal(h.presenter.focusCurrentBoss(), 105);
    assert.ok(h.presenter.state.detail.levelInfo, '关卡界面必须弹');
    assert.equal(h.presenter.state.detail.levelInfo?.fightEnabled, true);
    h.presenter.requestBattle();
    h.presenter.requestBattle();
    await flush();
    assert.deepEqual(h.gatewayCalls.battleParamsList, [['1', '1', '105']]);
    assert.equal(h.gatewayCalls.unlock, 0);
    assert.equal(h.gatewayCalls.pass, 0);
    assert.equal(h.nav.length, 1);
    h.presenter.dispose();
});

test('quick find handles loading without requests or navigation', () => {
    const h = createHarness({ loader: createBossFindLoader() });
    assert.equal(h.presenter.focusCurrentBoss(), null);
    assert.equal(h.tips.at(-1), '领地数据加载中，请稍候');
    h.presenter.dispose();
    assert.equal(h.gatewayCalls.startBattle, 0);
    assert.equal(h.nav.length, 0);
});

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
// 🔴 2026-10-29 口径（山猫）：「只有**解锁那一次**直开，之后仍弹窗」。
// 锁着的关卡点一下 = 解锁 → 立刻发 `CmdStartBattleReqMsg` 进战斗，中途不弹关卡界面；
// 解锁过之后再点同一格，才回到原来的「弹关卡界面 → 点开始战斗」。
test('an initially locked stage unlocks and starts the battle on the first click', async () => {
    const h = createHarness({ gateway: createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0], passCells: [0] },
    } }) });
    h.presenter.start();
    await flush();
    const site = h.presenter.state.map!.sites[0];
    h.presenter.selectSite(site);
    // 弹窗不能开：这一下最终是直接进战斗。
    assert.equal(h.presenter.state.detail.levelInfo, null, '首次解锁直开 ⇒ 不弹「关卡界面」');
    await flush();
    assert.equal(h.gatewayCalls.unlock, 1, '未解锁 ⇒ 先发解锁');
    assert.deepEqual(h.gatewayCalls.unlockedCells, [site.cellId]);
    assert.equal(h.gatewayCalls.startBattle, 1, '解锁成功 ⇒ 同一交互内立刻发开战请求');
    assert.deepEqual(h.gatewayCalls.battleParamsList, [['1', '1', String(site.cellId)]],
        'battleParams = [子类型(1=格子战斗), 章节id, cellId]');
    assert.equal(h.gatewayCalls.pass, 0, '关卡绝不发通关请求');
    assert.equal(h.storeCalls.beginBattle, 1, '开战回包成功后进战斗');
    assert.equal(h.nav.length, 1);
    assert.equal(h.presenter.state.progress?.isCellUnlocked(site.cellId), true, '解锁要记账');
    // 已解锁之后再点 ⇒ 只弹关卡界面，**不再**自动开战（这正是「只有解锁那一次」的判据）。
    h.presenter.selectSite(site);
    assert.ok(h.presenter.state.detail.levelInfo, '已解锁 ⇒ 点一下打开关卡界面');
    await flush();
    assert.equal(h.gatewayCalls.startBattle, 1, '第二次点击不许再自动开战（要等弹窗按钮）');
    // 弹窗里的「开始战斗」照旧可用。
    h.presenter.requestBattle();
    await flush();
    assert.equal(h.gatewayCalls.startBattle, 2);
    assert.equal(h.gatewayCalls.unlock, 1, '开战不再重复解锁');
});

// 首次解锁直开被服务端拒绝：解锁已确认（照常记账），但玩家停在原地 —— 不进战斗、不扣本地资源，
// 下一次点击回到「弹关卡界面」，不会因为一次拒绝就把这格锁死。
test('★首次解锁直开被拒：只提示不进战斗，格子已解锁，再点回到关卡界面', async () => {
    const h = createHarness({ gateway: createFakeGateway({
        fetch: { ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0], passCells: [0] } },
        start: { ok: false, reason: TERRITORY_REQUEST_STATUS.rejected },
    }) });
    h.presenter.start();
    await flush();
    const site = h.presenter.state.map!.sites[0];
    h.presenter.selectSite(site);
    await flush();
    assert.equal(h.gatewayCalls.unlock, 1);
    assert.equal(h.gatewayCalls.startBattle, 1);
    assert.equal(h.nav.length, 0, '开战被拒 ⇒ 不进战斗');
    assert.equal(h.storeCalls.beginBattle, 0, '不进战斗就不扣本地资源');
    assert.equal(h.presenter.state.progress?.isCellUnlocked(site.cellId), true, '解锁已确认照常记账');
    assert.equal(h.tips.at(-1), '开战失败，请稍后重试');
    // 解锁过了 ⇒ 下一次点击是「弹关卡界面」，玩家可以在窗里重试。
    h.presenter.selectSite(site);
    assert.ok(h.presenter.state.detail.levelInfo, '再点 ⇒ 打开关卡界面');
    h.presenter.requestBattle();
    await flush();
    assert.equal(h.gatewayCalls.startBattle, 2, '窗里的「开始战斗」照常可用');
});

// 开关来自 `gameConfig.chapterLevelAutoStartConfig`（1 开 / 0 关，策划表 `S-数据配置`）。
// 关掉之后必须**完整退回**改之前的两步行为：锁着的格子只解锁 + 提示，界面不弹、不发开战。
test('chapterLevelAutoStartConfig = 0：锁着的关卡点一下只解锁，不弹窗也不开战', async () => {
    const h = createHarness({
        loader: createFakeLoader({
            ...bundle,
            campaign: { ...bundle.campaign, levelAutoStart: false },
        }),
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0], passCells: [0] },
        } }),
    });
    h.presenter.start();
    await flush();
    const site = h.presenter.state.map!.sites[0];
    h.presenter.selectSite(site);
    await flush();
    assert.equal(h.gatewayCalls.unlock, 1);
    assert.equal(h.gatewayCalls.startBattle, 0, '开关关掉 ⇒ 不发开战请求（退回老的两步）');
    assert.equal(h.nav.length, 0, '不进战斗');
    assert.equal(h.presenter.state.detail.levelInfo, null, '锁态那一下仍然不弹窗');
    assert.equal(h.presenter.state.progress?.isCellUnlocked(site.cellId), true, '解锁照常记账');
    assert.equal(h.tips.at(-1), '已解锁，点击查看关卡', '关掉后回到旧的解锁提示（不是直开那条）');
    // 开关只管「首次解锁那一下」：解锁之后再点照旧弹关卡界面、窗里按钮照常开战。
    h.presenter.selectSite(site);
    assert.ok(h.presenter.state.detail.levelInfo);
    h.presenter.requestBattle();
    await flush();
    assert.equal(h.gatewayCalls.startBattle, 1, '窗里「开始战斗」照常发请求');
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
    // 2026-10-28 起「未解锁 ⇒ 点一下直接解锁」，所以这里不再需要 `requestBattle()`。
    h.presenter.selectSite(site);
    // 同一格的解锁还在飞 ⇒ 连点**不再**发第二次（`pendingFixedResourceCells` 挡）。
    h.presenter.selectSite(site);
    assert.equal(pending.length, 1, '★同一格的解锁在飞 ⇒ 连点不重复发请求');
    // 切到别的站点 ⇒ `cancelBattleRequest()` 递增 ⇒ 那一次回包作废。
    // ⚠️ 另一格发不发自己的解锁请求，取决于它在不在 `revealed` / 有没有解锁 —— 与本条无关，
    //    这里只关心 `site` 那一发的命运，所以只把 `pending[0]` 结掉。
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

function createOutputSpy() {
    const tips: string[] = [];
    const rewards: { resId: number; amount: number }[][] = [];
    /** 与 `rewards` 逐条对应的「来源格」；`null` = 挂机产出这类没有格子的发奖。 */
    const rewardOrigins: (number | null | undefined)[] = [];
    const nav: ITerritoryBattleNavParams[] = [];
    const battles: (ZCBattleStart | undefined)[] = [];
    const busy: Array<{ busy: boolean; text?: string }> = [];
    return { tips, rewards, rewardOrigins, nav, battles, busy };
}

interface HarnessOptions {
    chapters?: readonly number[];
    loader?: ReturnType<typeof createFakeLoader>;
    gateway?: ReturnType<typeof createFakeGateway>;
    store?: ReturnType<typeof createFakeStore>;
    serverWallet?: () => TerritoryWallet | null;
}

function createHarness(options: HarnessOptions = {}) {
    const loader = options.loader ?? createFakeLoader();
    const gateway = options.gateway ?? createFakeGateway();
    const store = options.store ?? createFakeStore();
    const spy = createOutputSpy();
    let stateChanges = 0;
    const ports: ITerritoryPresenterPorts = {
        loader: loader.loader,
        gateway: gateway.gateway,
        store: store.store,
        walletSeed: (): TerritoryWallet => ({ silver: 10000, stamina: 100 }),
        readServerWallet: () => (options.serverWallet ? options.serverWallet() : null),
        availableChapters: options.chapters ?? [1],
    };
    const presenter = new TerritoryPresenter(ports);
    presenter.onOutput((event) => {
        switch (event.kind) {
            case 'changed': stateChanges++; break;
            case 'navigate': spy.nav.push(event.payload.pve); spy.battles.push(event.payload.battle); break;
            case 'tip': spy.tips.push(event.payload.text); break;
            case 'rewards':
                spy.rewards.push(event.payload.rewards.map(g => ({ resId: g.resId, amount: g.amount })));
                spy.rewardOrigins.push(event.payload.originCellId); break;
            case 'busy': spy.busy.push({ ...event.payload }); break;
        }
    });
    return {
        presenter,
        stateChanges: () => stateChanges,
        loaderCalls: loader.calls,
        gatewayCalls: gateway.calls,
        storeCalls: store.calls,
        ...spy,
    };
}

// ── 加载生命周期 ───────────────────────────────────────────────────────

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
        assetPath('config/territory-maps/chapter_01.json'), 'utf8'));
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
test('selectSite on a bound stage opens the level panel first, battle starts from its button', async () => {
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
    assert.equal(detail.open, false, '没点之前不弹面板');
    h.presenter.selectSite(h.presenter.state.map!.sites[0]);
    await flush();
    // 2026-10-27（蓝湖「关卡界面」）：点关卡先弹面板，**不发**开战请求。
    assert.ok(h.presenter.state.detail.levelInfo, '关卡点击后弹关卡界面');
    assert.ok(h.presenter.state.detail.levelInfo, '关卡界面内容必须给出');
    assert.equal(h.gatewayCalls.startBattle, 0, '只弹窗，不开战');
    // 面板上的「开始战斗」= 原来的开战入口。
    h.presenter.requestBattle();
    await flush();
    assert.equal(h.gatewayCalls.startBattle, 1, '点开始战斗才发开战请求');
});

test('selectSite on an unbound site opens nothing (站点详情面板已移除)', async () => {
    const h = createHarness({ gateway: createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0, 2], passCells: [0] },
    } }) });
    h.presenter.start();
    await flush();
    h.presenter.selectSite(h.presenter.state.map!.sites[1]);
    const { detail } = h.presenter.state;
    assert.equal(detail.open, true, '有站点被选中');
    // 详情面板已删（2026-10-27）⇒ 绑不到关卡的格子什么面板都不弹，信息留在左侧 info 区
    assert.equal(detail.levelInfo, null);
    assert.equal(detail.playerStage, null);
    assert.equal(h.gatewayCalls.startBattle, 0);
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

test('two-step stage 327 unlocks and starts the battle on the first click, later clicks open the panel', async () => {
    const publishedMap = JSON.parse(readFileSync(
        assetPath('config/territory-maps/chapter_01.json'), 'utf8'));
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
            campaign: { stages: [stageFor327], playerCardCount: 3, idleRewardMaxHours: 8, levelAutoStart: true },
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
    // 第一步：未解锁 → **解锁 + 立刻开战**（2026-10-29 口径：只有解锁那一次直开）。
    //
    // 🔴 2026-10-10 口径：第二步开战必须是 `CmdStartBattleReqMsg` 而不是通关 ——
    // 327 是**关卡**不是资源点，battleType 固定 1002（章节战斗类型，不是 configId 10001），
    // battleParams = [子类型, 章节id, cellId]（子类型 1 = 格子战斗，由 chapterCellBattleParams 组）。
    h.presenter.selectSite(site);
    assert.equal(h.presenter.state.detail.levelInfo, null, '首次解锁直开 ⇒ 不弹「关卡界面」');
    await flush();
    assert.deepEqual(h.gatewayCalls.unlockedCells, [327]);
    assert.deepEqual(h.gatewayCalls.passedCells, [],
        '关卡绝不发通关请求（服务端会回「章节格子非资源类型」）');
    assert.equal(h.gatewayCalls.startBattle, 1, '解锁成功 ⇒ 立刻发一次开战请求');
    assert.deepEqual(h.gatewayCalls.battleTypes, [1002],
        'battleType 必须是章节战斗类型 1002，不是 site.configId（10001）');
    assert.deepEqual(h.gatewayCalls.battleParamsList, [['1', '1', '327']],
        'battleParams = [子类型(1=格子战斗), 章节id, cellId]');
    assert.equal(h.storeCalls.beginBattle, 1, '开战回包成功后进战斗');
    assert.equal(h.nav.length, 1);
    assert.equal(h.presenter.state.progress?.isCellUnlocked(327), true);
    assert.equal(h.presenter.state.progress?.isOwned(327), false);
    // 第二步：已解锁（建筑已展示）→ 点一下只弹关卡界面，窗里的「开始战斗」才发请求。
    h.presenter.selectSite(site);
    assert.ok(h.presenter.state.detail.levelInfo, '已解锁 ⇒ 点一下打开关卡界面');
    await flush();
    assert.equal(h.gatewayCalls.startBattle, 1, '★第二次点击不许再自动开战');
    h.presenter.requestBattle();
    await flush();
    assert.equal(h.gatewayCalls.unlock, 1, '开战阶段不再重复解锁');
    assert.equal(h.gatewayCalls.startBattle, 2, '已解锁的关卡应发一次开战请求');
    assert.deepEqual(h.gatewayCalls.battleParamsList, [['1', '1', '327'], ['1', '1', '327']]);
    // 第三步：战斗已发起（fake 不真切场景）⇒ 再点 = 战斗未结算返回重打。
    // 🔴 2026-10-21 口径：`bossBattleStart` 不再参与防连点（防连点 = pending 判重 + loading），
    // 未通关格允许再次开战（打输 / 未打完可重打）。
    h.presenter.selectSite(site);
    h.presenter.requestBattle();
    await flush();
    assert.equal(h.gatewayCalls.unlock, 1, '重打不夹带解锁请求');
    assert.equal(h.gatewayCalls.startBattle, 3, '开战后未通关可重打（再次发开战请求）');
});

test('two-step stage 327 skips the battle flow entirely (no detail, no start battle)', async () => {
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
    h.presenter.requestBattle();
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
    h.presenter.requestBattle();
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
    h.presenter.requestBattle();
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
    h.presenter.requestBattle();
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

for (const update of ['broadcast', 'snapshot'] as const) test(`passing a nonrepresentative area cell via ${update} immediately unlocks the next chapter`, async () => {
    const loader = createFakeLoader();
    loader.loader.load = async (chapterId) => ({
        ...bundle,
        mapJson: { ...mapJson, chapterId, sites: [
            ...mapJson.sites,
            { id: 'stage_1_building', type: 'stage', cellId: 3, footprint: [3], configId: '1001' },
        ] },
    });
    const h = createHarness({ loader, chapters: [1, 2] });
    h.presenter.start();
    await flush();
    assert.equal(h.presenter.state.hud?.nextEnabled, false);
    const published: boolean[] = [];
    h.presenter.onOutput((output) => {
        if (output.kind === 'changed') published.push(h.presenter.state.hud?.nextEnabled ?? false);
    });
    if (update === 'broadcast') h.presenter.applyPassCellsBro(1, [3]);
    else h.presenter.applyCellInfoState({ levelChapter: 1, rewardState: 0, unlockCells: [3], passCells: [3] });
    assert.deepEqual(published, [true], 'publish the unlocked HUD immediately without reopening the page');
    assert.equal(h.presenter.state.progress?.isOwned(1), false, 'do not invent ownership of representative cells');
    assert.equal(h.presenter.state.progress?.isAreaPassed(1), true);
    assert.equal(h.presenter.state.hud?.nextEnabled, true, 'use the same area completion rule as the map');
    assert.match(h.presenter.state.hud?.chapterText ?? '', /已占领 1\/1/);
    h.presenter.switchChapter(1);
    await flush();
    assert.equal(h.presenter.state.chapterId, 2);
    h.presenter.dispose();
});

test('switching to the next chapter before completion shows a tip', async () => {
    const h = createHarness({ chapters: [1, 2] });
    h.presenter.start();
    await flush();
    h.presenter.switchChapter(1);
    assert.equal(h.tips.length, 1);
    assert.match(h.tips[0], /请先占领本章全部站点/);
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

test('boss site unlocks and starts the battle on the first click, later clicks send CmdStartBattleReqMsg from the panel', async () => {
    const h = createHarness({
        loader: createFakeLoader({
            ...bundle,
            mapJson: bossMap,
            campaign: { stages: [stage, bossStage], playerCardCount: 3, idleRewardMaxHours: 8, levelAutoStart: true },
        }),
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0, 1], passCells: [0, 1] },
        } }),
    });
    h.presenter.start();
    await flush();
    const site = h.presenter.state.map!.sites.find((entry) => entry.cellId === 2)!;
    assert.equal(site.type, 'boss');
    // 第一步：未解锁 → **解锁 + 立刻开战**（2026-10-29 口径：只有解锁那一次直开）。
    h.presenter.selectSite(site);
    assert.equal(h.presenter.state.detail.levelInfo, null, '首次解锁直开 ⇒ 不弹「关卡界面」');
    await flush();
    assert.deepEqual(h.gatewayCalls.unlockedCells, [2]);
    assert.deepEqual(h.gatewayCalls.passedCells, [], 'Boss 关不再发 CmdCityChapterPassCellReqMsg');
    assert.equal(h.gatewayCalls.startBattle, 1, '解锁成功 ⇒ 立刻发 CmdStartBattleReqMsg');
    assert.deepEqual(h.gatewayCalls.battleTypes, [1002],
        'battleType = 章节战斗类型 1002（2026-10-10 口径）—— 不是 site.configId（这里是 10005），'
        + '关卡身份由 battleParams 的格子id 定位（battleParams = [子类型, 章节id, 格子id]）');
    assert.deepEqual(h.gatewayCalls.battleParamsList, [['1', '1', '2']],
        'battleParams = [子类型(1=格子战斗), 章节id, cellid] —— 子类型占下标 0');
    assert.equal(h.storeCalls.beginBattle, 1, '战斗信息成功后进入战斗');
    assert.equal(h.nav.length, 1);
    assert.equal(h.nav[0].levelId, 10005);
    assert.equal(h.nav[0].territoryCellId, 2);
    assert.equal(h.nav[0].mode, 'defence');
    assert.equal(h.presenter.lastBossBattleStart?.battleId, 'b-10005');
    assert.equal(h.presenter.lastBossBattleStart?.seed, '42');
    assert.equal(h.presenter.state.progress?.isOwned(2), false, '开战不改变占领态');
    assert.equal(h.presenter.state.progress?.isCellUnlocked(2), true);
    // 第二步：已解锁 → 点一下弹界面，窗里「开始战斗」发 CmdStartBattleReqMsg。
    h.presenter.selectSite(site);
    assert.ok(h.presenter.state.detail.levelInfo, '已解锁 ⇒ 打开「关卡界面」');
    await flush();
    assert.equal(h.gatewayCalls.startBattle, 1, '★第二次点击不许再自动开战');
    h.presenter.requestBattle();
    await flush();
    assert.equal(h.gatewayCalls.startBattle, 2);
    assert.equal(h.gatewayCalls.unlock, 1, '开战阶段不再重复解锁');
    // 第三步：已通关仍可重复挑战，不重新解锁。
    h.presenter.state.progress?.markCellPassed(2);
    h.presenter.selectSite(site);
    h.presenter.requestBattle();
    await flush();
    assert.equal(h.gatewayCalls.startBattle, 3);
    assert.equal(h.gatewayCalls.unlock, 1);
});

for (const [siteType, isBoss, mode] of [
    ['boss', false, 'match'],
    ['stage', true, 'defence'],
    // 2026-10-28 用户：「已通过的关卡重复挑战仍需要消耗体力」⇒ 普通关卡打完也要能再打。
    // 这条以前被 `handleBattleStationStart` 的「已通关 ⇒ return」挡住，现在是必须绿的主路径。
    ['stage', false, 'match'],
] as const) {
    test(`已通关 ${siteType}/${mode} 缺少 unlockCells 时仍可重复挑战，连点只发一次服务端开战`, async () => {
        const h = createHarness({
            loader: createFakeLoader({
                ...bundle,
                mapJson: { ...mapJson, sites: [{ id: 'replay', type: siteType, cellId: 1, configId: '1001' }] },
                campaign: { ...bundle.campaign, stages: [{ ...stage, isBoss, mode }] },
            }),
            gateway: createFakeGateway({ fetch: {
                ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0], passCells: [0, 1] },
            } }),
        });
        h.presenter.start();
        await flush();
        const site = h.presenter.state.map!.sites[0];
        // 关卡改成「点格子先弹界面」后，连点语义挪到弹窗的开始按钮上：
        // 同一帧连点两次「开始战斗」只该发一次请求（`startingBattle` 挡住第二次）。
        h.presenter.selectSite(site);
        await flush();
        assert.ok(h.presenter.state.detail.levelInfo, '关卡界面必须弹');
        h.presenter.requestBattle();
        h.presenter.requestBattle();
        await flush();
        assert.deepEqual(h.gatewayCalls.battleParamsList, [['1', '1', '1']]);
        assert.equal(h.gatewayCalls.unlock, 0);
        assert.equal(h.gatewayCalls.pass, 0);
        assert.equal(h.nav.length, 1, '重复点击不得取消正在请求的战斗');
        h.presenter.selectSite(site);
        await flush();
        h.presenter.requestBattle();
        await flush();
        assert.equal(h.gatewayCalls.startBattle, 2, '返回后再次挑战仍请求服务端');
        assert.equal(h.nav.length, 2);
        h.presenter.dispose();
    });
}

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
            campaign: { stages: [stage, asyncStage], playerCardCount: 3, idleRewardMaxHours: 8, levelAutoStart: true },
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
        assert.equal(h.presenter.state.detail.playerStage, null, '首次点击只解锁，不弹详情');
        assert.equal(h.presenter.state.detail.levelInfo, null, '玩家关卡弹窗不用关卡界面内容');
        assert.equal(h.presenter.state.progress?.isCellUnlocked(site.cellId), true,
            `cellId ${site.cellId} 应独立记为已解锁`);
    }

    assert.deepEqual(h.gatewayCalls.unlockedCells, [372, 373, 392]);
    assert.deepEqual(h.gatewayCalls.passedCells, [], '异步关卡解锁不走资源点通关接口');
    assert.equal(h.gatewayCalls.startBattle, 0, '首次点击只解锁，不启动战斗');
    assert.deepEqual(h.tips, ['已解锁，点击查看关卡', '已解锁，点击查看关卡', '已解锁，点击查看关卡']);

    h.presenter.selectSite(sites[0]);
    await flush();
    assert.ok(h.presenter.state.detail.playerStage, '解锁后再次点击才弹玩家关卡详情');
    h.presenter.requestBattle();
    await flush();
    assert.equal(h.gatewayCalls.unlock, 3, '已解锁的异步格再次点击不重复请求解锁');
    assert.equal(h.gatewayCalls.startBattle, 1, '已解锁异步据点应走章节战斗请求');
    // 🔴 asyncPvp 子类型按**通关状态**分流（山猫 2026-10-21 细化）：未通关首次挑战 = 格子
    // 战斗子类型 1（`chapterCellBattleParams`）；已通关重复挑战才切宝箱战斗子类型 2。
    // 372 在这里只解锁没通关 ⇒ 子类型 1（服务端按 0 位分流，打过的格传 2 会回「配置错误」）。
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
            campaign: { stages: [stage, bossStage], playerCardCount: 3, idleRewardMaxHours: 8, levelAutoStart: true },
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
    h.presenter.requestBattle();
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
            campaign: { stages: [stage, bossStage], playerCardCount: 3, idleRewardMaxHours: 8, levelAutoStart: true },
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
    h.presenter.requestBattle();
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
    h.presenter.requestBattle();
    await flush();
    assert.equal(h.nav.length, 1);
    assert.deepEqual(h.battles[0], fakeBattleStart);
});

test('territory page passes battle and current role to the game route', () => {
    const page = readFileSync('assets/script/app/main/MainTerritoryMap.ts', 'utf8');
    assert.match(page, /onNavigateToBattle\(payload: ITerritoryNavigateBattlePayload\)[\s\S]*?ProcedureManager\.navigate\(GameRoute\.Battle, \{[\s\S]*?battle,[\s\S]*?selfRoleId: this\.saveOwner\?\.roleId/);
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
    h.presenter.requestBattle();
    h.presenter.selectSite(site);
    h.presenter.requestBattle();
    assert.equal(gateway.calls.startBattle, 1);
    h.presenter.selectSite(h.presenter.state.map!.sites[1]);
    h.presenter.requestBattle();
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

test('★★★★真机口径：只打通 328，点 309 解锁后必须立刻发开战协议', async () => {
    // 山猫 2026-10-15 真机：cellId 309（关卡 2、有建筑 69004）点下去**一个协议都不发**，
    // 只弹「前置领地尚未占领」。根因见 `territory-progress.test.ts` 同名主题那条：
    // 309 的前置要求 327/328（同 configId=10001）**各通关一次**，而 327 无建筑永远 owned 不了。
    const publishedMap = JSON.parse(readFileSync(
        assetPath('config/territory-maps/chapter_01.json'), 'utf8'));
    const stages: TerritoryCampaignStage[] = [
        { ...stage, levelId: 10001, stage: 1 },
        { ...stage, levelId: 10002, stage: 2 },
    ];
    const h = createHarness({
        loader: createFakeLoader({
            ...bundle,
            mapJson: publishedMap,
            campaign: { stages, playerCardCount: 3, idleRewardMaxHours: 8, levelAutoStart: true },
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
    // 2026-10-29 口径：未解锁点一下 = 解锁 → **立刻开战**（不再停在「已解锁，点击查看关卡」）。
    h.presenter.selectSite(site);
    await flush();
    assert.deepEqual(h.gatewayCalls.unlockedCells, [309],
        '★必须发 CmdCityChapterPassCellReqMsg 类解锁请求 —— 曾经这里是 0 次请求');
    assert.ok(!h.tips.includes('前置领地尚未占领'), '不能再被前置判定挡住');
    assert.equal(h.gatewayCalls.startBattle, 1, '★解锁成功必须立刻发开战请求（这一下就是进战斗）');
    assert.deepEqual(h.gatewayCalls.battleParamsList, [['1', '1', '309']]);
    assert.equal(h.nav.length, 1, '★解锁即开战 ⇒ 直接进战斗');
    assert.equal(h.presenter.state.detail.levelInfo, null, '中途不弹关卡界面');
    assert.ok(!h.tips.includes('已解锁，点击查看关卡'), '直开路径没有「已解锁」这一步提示');
});

// ── 全屏 loading 遮挡（防「服务端还没响应就快速连点」）───────────────────

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
    assert.equal(h.gatewayCalls.startBattle, 1, '解锁成功 ⇒ 同一交互内继续发开战请求');
    assert.equal(h.nav.length, 1);
});

// 🔴 两个写请求**并发**时 loading 必须严格配对（show 几次就 hide 几次）：
// 此前「归零才 hide」会让 LoadingPopup 全局引用计数残留 1 ⇒ 全屏遮罩（含本轮新增的
// `BlockInputEvents` 拦截）常驻 ⇒ 地图所有点击被吞，表现为「刚解锁的宝箱再点没反应」。
test('two concurrent write requests pair their loading layers (no leftover mask)', async () => {
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
    // 同一 tick 同步进两个解锁流程（selectSite 同步执行到网关调用前）⇒ 两层 loading 都弹出。
    h.presenter.selectSite(site4);
    h.presenter.selectSite(site5);
    assert.equal(h.busy.length, 2, '并发两个写请求 ⇒ 两层 loading（busy=true）');
    pending[0]({ ok: true, unlockedCellIds: [4] });
    pending[1]({ ok: true, unlockedCellIds: [5] });
    await flush();
    assert.equal(h.busy.length, 4, '两次 exit 各 hide 一次 ⇒ 严格配对（修复前残留只给 3 条）');
    assert.equal(h.busy[2].busy, false, '第一个请求结束即 hide 一层');
    assert.equal(h.busy[3].busy, false, '第二个请求结束再 hide 一层，引用计数归零');
    assert.equal(unlockCount, 2, '两个格各发一次解锁');
});

// 🔴 页面销毁时在途写请求必须撤回其 loading：否则 LoadingPopup 引用计数残留，
// 全屏遮罩（BlockInputEvents）常驻，回到其他页面「点不动」。
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

// 🔴 解锁成功后的**最终一次渲染**必须发生在 pending 清空之后：视图 `isLoading` 由
// `pendingFixedResourceCells` 驱动（`TerritoryStationView.render`：`interactable = interactive
// && !isLoading`）。若最后渲染的是「请求在途」帧（Button 禁用）⇒ 宝箱看着可领取却点不动
// （用户实机：「弹出已解锁宝箱可领取，再次点击还是领取不了」）。
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

// ── asyncPvp 可重复挑战（2026-10-21 口径）────────────────────────────────

const asyncRepeatStage: TerritoryCampaignStage = { ...stage, levelId: 20001, stage: 4 };
const asyncRepeatMap = {
    ...mapJson,
    rows: 20,
    columns: 20,
    startCellId: 367,
    sites: [372].map((cellId) => ({
        id: `asyncPvp_${cellId}`,
        type: 'asyncPvp' as const,
        cellId,
        footprint: [cellId],
        configId: '20001',
        unlock: { requiredCells: [367], silverCost: 10, staminaCost: 1 },
    })),
};

function createAsyncRepeatHarness(state: {
    unlockCells: number[];
    passCells: number[];
}) {
    return createHarness({
        loader: createFakeLoader({
            ...bundle,
            mapJson: asyncRepeatMap,
            campaign: { stages: [stage, asyncRepeatStage], playerCardCount: 3, idleRewardMaxHours: 8, levelAutoStart: true },
        }),
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0, ...state },
        } }),
    });
}

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
    assert.equal(h.gatewayCalls.startBattle, 1, '★已通关 asyncPvp 可再次开战');
    // asyncPvp = 宝箱战斗子类型（battleParams[0] = 2），不是主线的格子战斗子类型 1。
    assert.deepEqual(h.gatewayCalls.battleParamsList, [['2', '1', '372']],
        'asyncPvp 用宝箱战斗子类型（服务端按 battleParams[0] 分流）');
    assert.equal(h.nav.length, 1, '开战成功进入战斗');
    assert.equal(h.busy.length, 2, '开战请求全程 loading 遮挡（true → false）');
    // 返回领地后再点（模拟上一局已结算、battleId 已清）⇒ 可无限重复挑战。
    h.presenter.selectSite(site);
    await flush();
    h.presenter.requestBattle();
    await flush();
    assert.equal(h.gatewayCalls.startBattle, 2, '★重复挑战：第二次点击再次发开战请求');
    assert.deepEqual(h.gatewayCalls.battleParamsList,
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
    assert.equal(h.gatewayCalls.startBattle, 1, '已通关 asyncPvp 直接开战');
    assert.deepEqual(h.gatewayCalls.battleParamsList, [['2', '1', '372']],
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
    h.presenter.selectSite(site); // 第一次点击只解锁
    assert.equal(h.presenter.state.detail.playerStage, null, '未解锁时不弹据点详情');
    await flush();
    assert.equal(h.gatewayCalls.unlock, 1, '未通关 asyncPvp 先发解锁');
    assert.equal(h.gatewayCalls.startBattle, 0, '解锁步不发战斗请求');
    assert.equal(h.presenter.state.detail.playerStage, null, '解锁回包成功也不自动弹窗');
    assert.equal(h.presenter.state.progress?.isCellUnlocked(372), true);
    h.presenter.selectSite(site); // 解锁后再点：再弹窗
    await flush();
    h.presenter.requestBattle(); // 再点「开始战斗」→ 开战步
    await flush();
    assert.equal(h.gatewayCalls.startBattle, 1, '解锁后可开战');
    assert.deepEqual(h.gatewayCalls.battleParamsList, [['1', '1', '372']],
        '未通关 asyncPvp 用格子战斗子类型 1（服务端对没打过的格按格子战斗分流）');
    assert.equal(h.nav.length, 1);
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
    assert.equal(h.gatewayCalls.startBattle, 1);
    assert.deepEqual(h.gatewayCalls.battleParamsList, [['1', '1', '372']],
        '旧档残留不算通关：asyncPvp 按服务端确认分流，未确认传格子战斗子类型 1');
    assert.equal(h.nav.length, 1);
});

test('★异步据点点击弹「玩家关卡」弹窗：标题/占领奖励/双按钮费用全部来自配置，只弹窗不发请求', async () => {
    const rewardStage: TerritoryCampaignStage = {
        ...asyncRepeatStage,
        idleRewards: [
            { resId: 7, name: '银币', amount: 75, probability: 10000 },
            { resId: 16014, name: '天赋石', amount: 8, probability: 10000 },
            { resId: 16015, name: '抽不到的占位', amount: 0, probability: 0 },
            { resId: 12, name: '卷轴', amount: 8, probability: 600 },
        ],
    };
    const h = createHarness({
        loader: createFakeLoader({
            ...bundle,
            mapJson: asyncRepeatMap,
            campaign: { stages: [stage, rewardStage], playerCardCount: 3, idleRewardMaxHours: 8, levelAutoStart: true },
        }),
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [367, 372], passCells: [367] },
        } }),
    });
    h.presenter.start();
    await flush();
    h.presenter.selectSite(h.presenter.state.map!.sites[0]);
    await flush();

    const content = h.presenter.state.detail.playerStage;
    assert.ok(content, '异步据点必须产出玩家关卡弹窗内容');
    assert.equal(h.presenter.state.detail.levelInfo, null, '玩家关卡不走关卡界面');
    assert.equal(h.presenter.state.detail.levelInfo, null, '玩家关卡不走关卡界面');
    assert.equal(content.title, '异步据点', '服务端不下发对手昵称，标题先写据点类型');
    assert.equal(content.chestText, '获得 1 个卡牌宝箱');
    // 概率 0 的空位必须被过滤掉 —— 展示出来等于骗玩家「可能拿到」
    assert.deepEqual(content.rewards,
        [{ resId: 7, amount: 75 }, { resId: 16014, amount: 8 }, { resId: 12, amount: 8 }],
        '按概率过滤空位、最多 3 格、顺序照配置表');
    assert.equal(content.scoutCost, 10, '侦查 = 设计稿 10 银币（服务端暂无配置）');
    assert.equal(content.fightCost, 10, '开战 = 站点 unlock.silverCost');
    assert.equal(content.fightCaption, '开始战斗');
    assert.equal(content.fightEnabled, true);
    assert.equal(h.gatewayCalls.startBattle, 0, '只弹窗，不发开战请求');
    assert.equal(h.gatewayCalls.unlock, 0, '只弹窗，也不发解锁请求');

    h.presenter.closeDetail();
    await flush();
    assert.equal(h.presenter.state.detail.playerStage, null, '关掉弹窗后内容清空');
    assert.equal(h.presenter.state.detail.open, false);
});

test('★点关卡/首领弹「关卡界面」：占据奖励取硬币、掉落取其余道具、推荐留空；感叹号开关关卡提示', async () => {
    const levelStage: TerritoryCampaignStage = {
        ...stage,
        levelId: 10005, // 与 bossMap 的 boss 站点 configId 对齐（否则绑不到 stage ⇒ 退回未绑定分支）
        stage: 2,
        isBoss: true,
        staminaCost: 10,
        enemies: [
            { cardId: 101, pvpCardId: 11, name: '食人花', level: 3, headIcon: 'icons/card/a', description: '无法阻拦' },
            { cardId: 102, pvpCardId: 12, name: '金发老板', level: 3, headIcon: 'icons/card/b', description: '' },
        ],
        idleRewards: [
            // 硬币（resId 7）= 占据奖励，不进掉落
            { resId: 7, name: '硬币', amount: 6, probability: 10000 },
            { resId: 10012, name: '卷轴', amount: 8, probability: 10000 },
            { resId: 10011, name: '项圈', amount: 8, probability: 600 },
            // 概率 0 的空位不该出现在掉落里
            { resId: 16014, name: '天赋石', amount: 1, probability: 0 },
        ],
    };
    const h = createHarness({
        loader: createFakeLoader({
            ...bundle,
            mapJson: bossMap,
            campaign: { stages: [levelStage], playerCardCount: 3, idleRewardMaxHours: 8, levelAutoStart: true },
        }),
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0, 1, 2], passCells: [0] },
        } }),
    });
    h.presenter.start();
    await flush();
    const site = h.presenter.state.map!.sites.find((entry) => entry.type === 'boss')!;
    h.presenter.selectSite(site);
    await flush();

    const info = h.presenter.state.detail.levelInfo;
    assert.ok(info, '关卡/首领点击后必须产出关卡界面内容');
    assert.equal(h.presenter.state.detail.levelTip, null, '关卡提示默认不开');
    assert.equal(info!.title, '首领关卡  2');
    assert.equal(info!.hasTip, true, '有敌军 ⇒ 显示感叹号入口');
    assert.equal(info!.objective, '第一名成功通过关卡');
    assert.equal(info!.occupy, '【征收】+6 硬币', '占据奖励只取硬币那条');
    assert.deepEqual(info!.drops.map((d) => [d.resId, d.amount]), [[10012, 8], [10011, 8]],
        '掉落 = 其余带概率的奖励（硬币剔除、概率 0 的空位剔除）');
    assert.equal(info!.recommend, '', '推荐卡牌没有数据源 ⇒ 空串（视图整行隐藏）');
    assert.equal(info!.fightCaption.length > 0, true);
    assert.equal(info!.staminaCost, 10);
    assert.equal(h.gatewayCalls.startBattle, 0, '只弹窗，不开战');

    // 感叹号 → 关卡提示（标题与关卡界面一致，敌军前 3 张，描述拼非空项）
    h.presenter.openLevelTip();
    await flush();
    const tip = h.presenter.state.detail.levelTip;
    assert.ok(tip, '感叹号必须能打开关卡提示');
    assert.equal(tip!.title, '首领关卡  2');
    assert.deepEqual(tip!.enemies.map((e) => e.name), ['食人花 Lv.3', '金发老板 Lv.3']);
    assert.equal(tip!.description, '无法阻拦', '空描述不参与拼接');

    // 关提示只收提示，关卡界面还在
    h.presenter.closeLevelTip();
    await flush();
    assert.equal(h.presenter.state.detail.levelTip, null);
    assert.ok(h.presenter.state.detail.levelInfo, '关卡界面不受影响');

    // 关详情把两层一起收掉
    h.presenter.openLevelTip();
    await flush();
    h.presenter.closeDetail();
    await flush();
    assert.equal(h.presenter.state.detail.levelInfo, null);
    assert.equal(h.presenter.state.detail.levelTip, null);
});
