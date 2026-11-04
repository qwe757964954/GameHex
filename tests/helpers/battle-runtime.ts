import { EventMgr } from '../../assets/script/framework/event/EventMgr';
import { ZC_BATTLE_EVENTS } from '../../assets/script/app/zcds/application/ZCBattleEvents';
import { readFileSync } from 'node:fs';
import { ZCBattleRuntimeController } from '../../assets/script/app/zcds/application/ZCBattleRuntimeController';
import { ZCBattleSettlementController, type IZCBattleSettlementRequest, type IZCBattleSettlementServices } from '../../assets/script/app/zcds/application/ZCBattleSettlementController';
import type { IZCBattleView, IZCBattleRuntimeServices } from '../../assets/script/app/zcds/application/ZCBattleRuntimeContract';
import type { IZCGameEntry } from '../../assets/script/app/zcds/application/ZCGameEntry';
import { loadPvpTables, type ZCPvpTables } from '../../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { configureZCMap } from '../../assets/script/app/zcds/model/ZCMapConfig';
import { captureZCMatchConfig } from '../../assets/script/app/zcds/model/ZCMatchConfig';
import { createControllerContext, createControllerResources } from './controller-context';
import { createBattleSession } from './battle-session';
import { assetPath } from './asset-paths';

export function deferred<T>() {
    let resolve: (value: T) => void = () => {}, reject: (error: Error) => void = () => {};
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
export const flush = () => new Promise<void>(resolve => setImmediate(resolve));
type ISettlementFixtureMethods = IZCBattleSettlementServices['results'] & IZCBattleSettlementServices['rewards'] & IZCBattleSettlementServices['popup'] & IZCBattleSettlementServices['flow'] & Pick<IZCBattleSettlementServices, 'failed'>;
type IRuntimeFixtureMethods = IZCBattleRuntimeServices['art'] & IZCBattleRuntimeServices['popups'] & IZCBattleRuntimeServices['clock'] & Pick<IZCBattleRuntimeServices, 'failed'>;
export function runtimeFixture(overrides: Partial<ISettlementFixtureMethods> = {}, selecting = false, slgBattleType?: 1003 | 1004, auxiliary: Partial<IRuntimeFixtureMethods> = {}) {
    const names = ['pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond', 'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams', 'pvpBaseTeamWeight', 'skillAttrModifier', 'generalStar', 'pvpAttrMap', 'pvpModifierOverride', 'pvpUnitGrowth', 'pvpSkillBinding', 'pvpStatus'];
    const tables = Object.fromEntries(names.map(name => {
        const data = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8'));
        return [name, Array.isArray(data) ? data : data.v.map((values: unknown[]) => Object.fromEntries(data.k.map((key: string, index: number) => [key, values[index]])))];
    }));
    loadPvpTables(tables as ZCPvpTables);
    configureZCMap(selecting ? { id: 'runtime-select', version: 3, rows: 8, columns: 8, playerCount: 2, cityMode: 'select', ascii: ['22222222', '22222222', '22222222', '22222222', '11111111', '11111111', '11111111', '11111111'], homeCandidates: [{ section: 1, cells: Array.from({ length: 32 }, (_, i) => i + 32) }, { section: 2, cells: Array.from({ length: 32 }, (_, i) => i) }], resourcePoints: [] } : JSON.parse(readFileSync(assetPath('config/maps/standard_3.json'), 'utf8')));
    const base = captureZCMatchConfig(undefined, { allowUnresolvedSelect: true });
    const config = selecting ? { ...base, map: { ...base.map, cityMode: 'select' as const, playerHomeId: -1, enemyHomeId: -1, homes: [] } } : base;
    const calls: string[] = [], requests: IZCBattleSettlementRequest[] = [], pages: unknown[] = [], persisted: boolean[] = [];
    let hold = false, scheduled: (() => void) | null = null, switchCallback = (_entered: boolean) => {};
    const view: IZCBattleView & { dragMoved: boolean } = {
        dragMoved: false, applyUnitPrefab() {}, applyEffectPrefab() {}, initialize: () => calls.push('mount'), startPlaying: () => calls.push('startPlaying'),
        renderBattle: (_model, _frame, _events, mode) => calls.push(mode), renderSpawnSelection: () => calls.push('spawn'),
        advanceSettlementPresentation: () => { calls.push('sweep'); return hold; },
        flashSpawn: message => calls.push(message), flashInsufficientGold: () => calls.push('gold'), resetCamera: () => calls.push('camera'),
    };
    const context = createControllerContext();
    const session = createBattleSession(context);
    const settlementMethods: ISettlementFixtureMethods = {
        waitResult: async type => { calls.push(`wait:${type}`); return null; },
        finish: async request => { calls.push('finish'); requests.push(request); },
        loadRewards: async () => [],
        open: async options => { calls.push('open'); pages.push(options); return { close: () => calls.push('close') }; },
        watchSwitch: callback => { switchCallback = callback; return () => calls.push('unwatch'); },
        cancelRequests: () => calls.push('cancel'), failed: () => calls.push('failed'),
        ...overrides,
    };
    const settlement = new ZCBattleSettlementController(context, {
        results: settlementMethods, rewards: settlementMethods, popup: settlementMethods,
        flow: settlementMethods, failed: settlementMethods.failed,
    }, { owner: view, hasPveContext: false });
    const runtimeMethods: IRuntimeFixtureMethods = {
        loadUnitPrefab: async () => null,
        loadEffectPrefab: async () => null,
        openGuide: async () => ({ close: () => calls.push('guideClose') }),
        openDamage: async () => ({ close: () => calls.push('damageClose') }),
        openRank: async () => ({ close: () => calls.push('rankClose') }),
        schedule: callback => { scheduled = callback; return () => { scheduled = null; }; }, failed: () => calls.push('failed'), ...auxiliary,
    };
    const runtime = new ZCBattleRuntimeController(context, view, settlement, {
        art: runtimeMethods, popups: runtimeMethods, clock: runtimeMethods, failed: runtimeMethods.failed,
    }, session);
    const entry: IZCGameEntry = {
        resources: { loadGuide: async () => ({ entries: [], params: {}, iconFrames: new Map() }) } as IZCGameEntry['resources'],
        battleSeed: 'runtime-test', matchConfig: config, playerAvatars: null, seatProfiles: [],
        seatUnitIds: [['player', 81], ['enemy', 82], ['enemy2', 83]], pveContext: null, slgBattleType,
    };
    const resources = createControllerResources(context);
    const target = {};
    EventMgr.instance.on(ZC_BATTLE_EVENTS.RETURN_TO_MAIN, ({ owner }) => { if (owner === view) calls.push('navigate'); }, target);
    EventMgr.instance.on(ZC_BATTLE_EVENTS.SHOW_TIP, ({ owner, message }) => { if (owner === view) calls.push('tip:' + message); }, target);
    EventMgr.instance.on(ZC_BATTLE_EVENTS.PVE_RESULT, ({ owner, victory }) => { if (owner === view) persisted.push(victory); }, target);
    resources.scope.defer(() => EventMgr.instance.offTarget(target));
    runtime.start(entry, resources);
    return { runtime, session, settlement, entry, view, calls, requests, pages, persisted, resources,
        holdSweep(value: boolean) { hold = value; }, finishShowcase() { scheduled?.(); },
        settleSwitch(entered: boolean) { switchCallback(entered); },
        dispose() { runtime.dispose(); session.dispose(); resources.scope.dispose(); },
        forceStatus(status: 'victory' | 'defeat' | 'draw') {
            const model = runtime.currentModel;
            const snapshot = model.snapshot;
            Object.defineProperty(model, 'snapshot', { get: () => ({ ...snapshot, status }) });
        },
    };
}
