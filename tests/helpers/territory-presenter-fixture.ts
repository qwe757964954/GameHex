import { createControllerContext } from './controller-context';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ResourceScope } from '../../assets/script/core/asset/ResourceScope';
import {
    ITerritoryBattleNavParams,
    ITerritoryCellGateway,
    ITerritoryChapterBundle,
    ITerritoryChapterLoader,
    ITerritoryChapterStore,
    ITerritoryNavigateBattlePayload,
    ITerritoryModelPorts,
    ITerritoryShowRewardsPayload,
    ITerritoryShowTipPayload,
    ITerritorySetBusyPayload,
    TerritoryModel,
} from '../../assets/script/app/territory/application/TerritoryModel';
import { EventMgr } from '../../assets/script/framework/event/EventMgr';
import { ControllerBase } from '../../assets/script/framework/controller/ControllerBase';
import { reportGuideComplete } from '../../assets/script/app/guide/application/GuideEvents';
import { buildTerritoryViewState, isTerritoryChestActionable } from '../../assets/script/app/territory/application/TerritoryViewState';
import { TERRITORY_TEXTS } from '../../assets/script/app/territory/application/TerritoryTexts';
import * as territoryEvents from '../../assets/script/app/territory/application/TerritoryEvents';
export const { TerritoryUiEvent, TerritoryViewEvent } = territoryEvents;
export { territoryEvents };
import type { TerritoryCampaignStage } from '../../assets/script/app/territory/model/TerritoryCampaignConfig';
import { readTerritoryMonsterBoxGroups } from '../../assets/script/app/territory/model/TerritoryMonsterBoxConfig';
import { TERRITORY_REQUEST_STATUS } from '../../assets/script/app/territory/model/TerritoryRequestStatus';
import type {
    TerritoryChapterSave,
    TerritoryWallet,
} from '../../assets/script/app/territory/model/TerritorySaveStore';
import { TerritorySaveStore } from '../../assets/script/app/territory/model/TerritorySaveStore';
import type { TerritoryProgressData } from '../../assets/script/app/territory/model/TerritoryProgress';
import type { ZCBattleStart } from '../../assets/script/app/battle/BattleStartModel';
import type {
    TerritoryIdleRewardGain,
    TerritoryIdleRewardSource,
} from '../../assets/script/app/territory/model/TerritoryIdleReward';
import type {
    TerritoryCellFetchResult,
    TerritoryIdleRewardResult,
    TerritoryStartBattleResult,
    TerritoryWriteResult,
    TerritoryMonsterBoxUpgradeResult,
} from '../../assets/script/app/territory/application/TerritoryCellRepository';
import { emptyCellState } from '../../assets/script/app/territory/model/TerritoryCellBitSet';
import { configureTerritoryMap, isTerritoryBattleSite, territoryNeighbors } from '../../assets/script/app/territory/model/TerritoryMapConfig';
import { assetPath } from './asset-paths';
import { loadTsModule } from './cc-sandbox';

export { readFileSync, assetPath, TERRITORY_REQUEST_STATUS, configureTerritoryMap, territoryNeighbors, TerritorySaveStore };

export const bossMap = {
    version: 1,
    mapKind: 'territoryChapter',
    id: 'boss-map',
    name: 'Boss关',
    chapterId: 1,
    rows: 4,
    columns: 4,
    startCellId: 0,
    background: '',
    sites: [
        { id: 'boss_1', type: 'boss', cellId: 2, footprint: [2], configId: '10005' },
    ],
};

export type TerritoryControllerCtor = typeof import('../../assets/script/app/territory/application/TerritoryController')['TerritoryController'];

/** Controller 直连 `GameNet.instance`；这里只驱动界面与 Model，订阅端口给空实现。 */
const { exports: controllerExports, unresolved: controllerUnresolved } = loadTsModule<{ TerritoryController: TerritoryControllerCtor }>(
    'assets/script/app/territory/application/TerritoryController.ts', { modules: {
        '/ControllerBase': { ControllerBase },
        '/GuideEvents': { reportGuideComplete },
        '/GameNet': { GameNet: { instance: { addEvent() {}, removeCaller() {} } } },
        '/EventMgr': { EventMgr },
        '/TerritoryEvents': territoryEvents,
        '/TerritoryViewState': { buildTerritoryViewState, isTerritoryChestActionable },
        '/TerritoryTexts': { TERRITORY_TEXTS },
        '/TerritoryMapConfig': { configureTerritoryMap, isTerritoryBattleSite, territoryNeighbors },
    } });
assert.deepEqual(controllerUnresolved, []);
export const TerritoryController = controllerExports.TerritoryController;

export interface IBattlePageProbe {
    onDetailStart(): void;
    onDetailClose(): void;
    onNavigateToBattle(payload: ITerritoryNavigateBattlePayload): void;
}

/** 用真实页面事件处理器连接真实 Presenter；只替换引擎、弹窗栈和最终路由。 */
export function createBattlePageProbe(presenter: TerritoryModel) {
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
        '../../framework/event/EventMgr': { EventMgr },
        '../territory/application/TerritoryEvents': territoryEvents,
        './LevelInfoPanel': { LevelInfoPanel },
        './LevelTipPanel': { LevelTipPanel },
        '../../core/runtime/GameRoute': { GameRoute: { Battle: 'battle' } },
        '../../framework/procedure/ProcedureManager': { ProcedureManager: {
            navigate: (_route: string, params: unknown) => routes.push(params),
            onSwitchSettled: () => () => {},
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
    const controller = new TerritoryController(presenter, { context: createControllerContext(),
        roleCache: { subscribe: () => () => {} },
        cells: { readCellInfo: () => null, readPassCellsBro: () => null },
        schedule: () => () => {},
        battle: { prepare: () => undefined, enter: payload => routes.push(payload) },
    });
    EventMgr.instance.on(TerritoryViewEvent.Command,
        (event: territoryEvents.ITerritoryCommandEvent) => {
            if (event.command.kind === 'navigate') page.onNavigateToBattle(event.command.payload);
        }, page);
    Object.assign(page, {
        controllerResources: controller.resources,
        mapView: { isValid: false, beginBattleIntro: () => false },
    });
    controller.start();
    return {
        page: {
            onDetailStart: () => EventMgr.instance.emit(TerritoryUiEvent.Intent, { intent: { kind: 'battle' } }),
            onDetailClose: () => EventMgr.instance.emit(TerritoryUiEvent.Intent, { intent: { kind: 'closeDetail' } }),
        }, routes, closes: () => closes,
        dispose: () => { controller.dispose(); EventMgr.instance.offTarget(page); },
    };
}

export const mapJson = {
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

export const stage: TerritoryCampaignStage = {
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
    openGrideTime: 18,
    hpRate: 1,
    attackRate: 1,
};

export const asyncRepeatStage: TerritoryCampaignStage = { ...stage, levelId: 20001, stage: 4 };

export const bossStage: TerritoryCampaignStage = {
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
    openGrideTime: 18,
    hpRate: 1,
    attackRate: 1,
};

export const asyncRepeatMap = {
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

export function createAsyncRepeatHarness(state: {
    unlockCells: number[];
    passCells: number[];
}) {
    const gateway = createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, ...state },
    } });
    const loader = createFakeLoader({
        ...bundle,
        mapJson: asyncRepeatMap,
        campaign: { stages: [asyncRepeatStage], playerCardCount: 3, idleRewardMaxHours: 8, levelAutoStart: true },
    });
    return createHarness({ loader, gateway });
}

export const nullArt = {
    background: null,
    tileLocked: null,
    tileCleared: null,
    tileGrey: null,
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
    chestIcon: null,
    bonus: null,
    header: null,
    navButton: null,
    actionButton: null,
    buildFrames: new Map(),
};

export const bundle: ITerritoryChapterBundle = {
    mapJson,
    campaign: { stages: [stage], playerCardCount: 3, idleRewardMaxHours: 8, levelAutoStart: true },
    art: nullArt,
};

export async function flush(ticks = 6): Promise<void> {
    for (let i = 0; i < ticks; i++) await new Promise((r) => setTimeout(r, 0));
}

export function createFakeLoader(loadResult: ITerritoryChapterBundle | null | 'throw' = bundle) {
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

export function createFakeGateway(options: {
    fetch?: TerritoryCellFetchResult;
    unlock?: TerritoryWriteResult;
    pass?: TerritoryWriteResult;
    start?: TerritoryStartBattleResult;
    claim?: TerritoryIdleRewardResult;
    sweep?: TerritoryWriteResult;
} = {}) {
    const calls = { fetch: 0, unlock: 0, unlockedCells: [] as number[],
        pass: 0, passedCells: [] as number[], startBattle: 0,
        battleTypes: [] as number[], battleParamsList: [] as string[][], clear: 0, claim: 0, sweep: 0, upgrade: 0 };
    let sink: TerritoryModel | null = null;
    const deliver = <T>(make: () => Promise<T>, apply: (model: TerritoryModel, result: T) => void): void => {
        const model = sink;
        if (!model) return;
        const reply = make();
        void reply.then(result => { if (sink === model) apply(model, result); });
    };
    const legacy = {
        unlockCell: async (_chapterId?: number, _cellId?: number): Promise<TerritoryWriteResult> =>
            options.unlock ?? { ok: true },
        passCell: async (_chapterId?: number, _cellId?: number): Promise<TerritoryWriteResult> =>
            options.pass ?? { ok: true },
        claimIdleReward: async (): Promise<TerritoryIdleRewardResult> =>
            options.claim ?? { ok: false, reason: 'offline' },
        sweep: async (_chapterId?: number, _cellId?: number, _times?: number): Promise<TerritoryWriteResult> =>
            options.sweep ?? { ok: true },
        upMonsterBoxLv: async (_chapterId?: number, _cellId?: number): Promise<TerritoryMonsterBoxUpgradeResult> =>
            ({ ok: true, monsterBox: null }),
    };
    const gateway: ITerritoryCellGateway & typeof legacy = {
        ...legacy,
        fetchChapterCells: async () => {
            calls.fetch++;
            return options.fetch ?? { ok: true, state: emptyCellState(1) };
        },
        sendUnlockCell: (_chapterId, cellId) => {
            calls.unlock++;
            calls.unlockedCells.push(cellId);
            deliver(() => gateway.unlockCell(_chapterId, cellId), (model, result) => model.applyUnlockRsp(result));
            return 'ok';
        },
        sendPassCell: (_chapterId, cellId) => {
            calls.pass++;
            calls.passedCells.push(cellId);
            deliver(() => gateway.passCell(_chapterId, cellId), (model, result) => model.applyPassRsp(result));
            return 'ok';
        },
        startBattle: async (battleType, battleParams) => {
            calls.startBattle++;
            calls.battleTypes.push(battleType);
            calls.battleParamsList.push([...battleParams]);
            return options.start ?? { ok: true, battle: fakeBattleStart };
        },
        sendIdleReward: () => {
            calls.claim++;
            deliver(() => gateway.claimIdleReward(), (model, result) => model.applyIdleRewardRsp(result));
            return 'ok';
        },
        sendSweep: (_chapterId, cellId, times) => {
            calls.sweep++;
            deliver(() => gateway.sweep(_chapterId, cellId, times), (model, result) => model.applySweepRsp(result));
            return 'ok';
        },
        sendUpMonsterBoxLv: (_chapterId, cellId) => {
            calls.upgrade++;
            deliver(() => gateway.upMonsterBoxLv(_chapterId, cellId), (model, result) => model.applyMonsterBoxRsp(result));
            return 'ok';
        },
        clear: () => { calls.clear++; },
    };
    return { gateway, calls, bind: (model: TerritoryModel) => { sink = model; } };
}

export const fakeBattleStart: ZCBattleStart = {
    battleId: 'b-10005', seed: '42', version: 'v1',
    units: [{ campId: 1, roleId: 'self', serverId: 1, name: 'player', power: 100,
        avatarId: '', headFrameId: '', gradeId: 1, gradeScore: 0, heroIds: [],
        artifactId: 0, artifactLevel: 0 }],
};

export interface FakeStoreOptions {
    silver?: number;
    stamina?: number;
    ownedCells?: number[];
    randomResourceCells?: number[];
    battle?: TerritoryChapterSave['battle'];
    idleRewards?: { save: TerritoryChapterSave; rewards: TerritoryIdleRewardGain[]; settledHours: number; changed: boolean };
}

export function createFakeStore(options: FakeStoreOptions = {}) {
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

export function createOutputSpy() {
    const tips: string[] = [];
    const rewards: { resId: number; amount: number }[][] = [];
    const rewardOrigins: (number | null | undefined)[] = [];
    const rewardOptions: ({ chest?: boolean; popup?: boolean } | undefined)[] = [];
    const nav: ITerritoryBattleNavParams[] = [];
    const battles: (ZCBattleStart | undefined)[] = [];
    const battleParams: (readonly string[] | undefined)[] = [];
    const busy: Array<{ busy: boolean; text?: string }> = [];
    const chapterSwitches: Array<{ from: number; to: number }> = [];
    return { tips, rewards, rewardOrigins, rewardOptions, nav, battles, battleParams, busy, chapterSwitches };
}

export interface HarnessOptions {
    chapters?: readonly number[];
    loader?: ReturnType<typeof createFakeLoader>;
    gateway?: ReturnType<typeof createFakeGateway>;
    store?: ReturnType<typeof createFakeStore>;
    serverWallet?: () => TerritoryWallet | null;
    writeServerIdleTimeSeconds?: (seconds: number) => void;
}

export const FINAL_BOSS_CELL = 105;
export const MID_BOSS_CELL = 213;

export function createHarness(options: HarnessOptions = {}) {
    const loader = options.loader ?? createFakeLoader();
    const gateway = options.gateway ?? createFakeGateway();
    const store = options.store ?? createFakeStore();
    const spy = createOutputSpy();
    let stateChanges = 0;
    const ports: ITerritoryModelPorts = {
        loader: loader.loader,
        gateway: gateway.gateway,
        store: store.store,
        walletSeed: (): TerritoryWallet => ({ silver: 10000, stamina: 100 }),
        readServerWallet: () => (options.serverWallet ? options.serverWallet() : null),
        writeServerIdleTimeSeconds: options.writeServerIdleTimeSeconds,
        availableChapters: options.chapters ?? [1],
    };
    const presenter = new TerritoryModel(ports);
    gateway.bind?.(presenter);
    presenter.onOutput((event) => {
        switch (event.kind) {
            case 'changed': stateChanges++; break;
            case 'navigate':
                spy.nav.push(event.payload.pve);
                spy.battles.push(event.payload.battle);
                spy.battleParams.push(event.payload.battleParams);
                break;
            case 'tip': spy.tips.push(event.payload.text); break;
            case 'rewards':
                spy.rewards.push(event.payload.rewards.map(g => ({ resId: g.resId, amount: g.amount })));
                spy.rewardOrigins.push(event.payload.originCellId);
                spy.rewardOptions.push(event.payload.options);
                break;
            case 'busy': spy.busy.push({ ...event.payload }); break;
            case 'chapterSwitch':
                spy.chapterSwitches.push({ from: event.fromChapterId, to: event.toChapterId });
                break;
        }
    });
    return {
        presenter,
        stateChanges: () => stateChanges,
        loaderCalls: loader.calls,
        gatewayCalls: gateway.calls,
        storeCalls: store.calls,
        gatewayInstance: gateway.gateway,
        ...spy,
    };
}

export function createBossFindLoader() {
    return createFakeLoader({
        ...bundle,
        mapJson: JSON.parse(readFileSync('assets/resources/config/territory-maps/chapter_01.json', 'utf8')),
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
