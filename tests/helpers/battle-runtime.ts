import { EventMgr } from '../../assets/script/framework/event/EventMgr';
import { ZC_BATTLE_EVENTS, type ZCBattlePopupCommand } from '../../assets/script/app/zcds/application/ZCBattleEvents';
import { readFileSync } from 'node:fs';
import { ZCBattleRuntimeController } from '../../assets/script/app/zcds/application/ZCBattleRuntimeController';
import { ZCBattleSettlementController, type IZCBattleSettlementRequest, type IZCBattleSettlementServices } from '../../assets/script/app/zcds/application/ZCBattleSettlementController';
import type { IZCBattleConfirmOptions, IZCBattleView, IZCBattleRuntimeServices, IZCDamageStatsSeats, IZCDamageStatsUnit } from '../../assets/script/app/zcds/application/ZCBattleRuntimeContract';
import type { IZCGameEntry } from '../../assets/script/app/zcds/application/ZCGameEntry';
import type { IZCGuidePreparedContent } from '../../assets/script/app/zcds/model/ZCGuideConfig';
import type { IRankSeat, RankSeatProfiles } from '../../assets/script/app/zcds/model/ZCRankBoard';
import type { IZCSettlementOptions } from '../../assets/script/app/zcds/ui/ZCSettlementPage';
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

export interface ITestBattlePopup {
    close(reason?: 'manual' | 'force'): void;
    readonly whenClosed?: Promise<void>;
    readonly answered?: Promise<boolean>;
}

export interface ITestDamageStatsPopup extends ITestBattlePopup {
    readonly isOpen: boolean;
    refresh(units: readonly IZCDamageStatsUnit[]): void;
}

type ISettlementFixtureMethods = IZCBattleSettlementServices['results'] & IZCBattleSettlementServices['rewards'] & IZCBattleSettlementServices['flow'] & Pick<IZCBattleSettlementServices, 'failed'> & {
    open(options: IZCSettlementOptions): Promise<ITestBattlePopup | null>;
    openRank(seats: readonly IRankSeat[], profiles: RankSeatProfiles): Promise<ITestBattlePopup | null>;
    openDamage(units: readonly IZCDamageStatsUnit[], seats?: IZCDamageStatsSeats): Promise<ITestDamageStatsPopup | null>;
};
type IRuntimeFixtureMethods = IZCBattleRuntimeServices['art'] & IZCBattleRuntimeServices['clock'] & Pick<IZCBattleRuntimeServices, 'failed'> & {
    readonly playSound?: (key: string) => void;
    openGuide(content: IZCGuidePreparedContent): Promise<ITestBattlePopup | null>;
    openDamage(units: readonly IZCDamageStatsUnit[], seats?: IZCDamageStatsSeats): Promise<ITestDamageStatsPopup | null>;
    openRank(seats: readonly IRankSeat[], profiles: RankSeatProfiles): Promise<ITestBattlePopup | null>;
    confirm(options: IZCBattleConfirmOptions): Promise<ITestBattlePopup | null>;
};

function closeSafely(popups: readonly (ITestBattlePopup | null)[], reason?: 'manual' | 'force'): void {
    let failed = false;
    let firstError: unknown;
    for (const popup of popups) {
        if (!popup) continue;
        try {
            popup.close(reason);
        } catch (error) {
            if (!failed) {
                failed = true;
                firstError = error;
            }
        }
    }
    if (failed) throw firstError;
}

export function runtimeFixture(overrides: Partial<ISettlementFixtureMethods> = {}, selecting = false, slgBattleType?: 1003 | 1004, auxiliary: Partial<IRuntimeFixtureMethods> = {}) {
    const names = ['pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond', 'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams', 'skillAttrModifier', 'generalStar', 'pvpAttrMap', 'pvpModifierOverride', 'pvpUnitGrowth', 'pvpSkillBinding', 'pvpStatus'];
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
        showBarracksInfo: info => calls.push(`barracks:${info.cardId}`), hideBarracksInfo: () => calls.push('barracks:hide'),
    };
    const context = createControllerContext();
    const session = createBattleSession(context);
    const settlementMethods: ISettlementFixtureMethods = {
        waitResult: async type => { calls.push(`wait:${type}`); return null; },
        finish: async request => { calls.push('finish'); requests.push(request); },
        loadRewards: async () => [],
        open: async options => { calls.push('open'); pages.push(options); return { close: () => calls.push('close') }; },
        // 结算页「查看完整队伍」走这条（运行期的同名入口在 isSettled 后被拦掉）。
        openDamage: async players => {
            calls.push(`viewTeam:${players.length}`);
            return { isOpen: true, refresh() {}, close: () => calls.push('viewTeamClose') };
        },
        // 默认「没弹」：≥3 人局也直接进结算。要验顺序时用 overrides 覆盖成可关闭的桩。
        openRank: async seats => { calls.push(`rank:${seats.length}`); return null; },
        watchSwitch: callback => { switchCallback = callback; return () => calls.push('unwatch'); },
        cancelRequests: () => calls.push('cancel'), failed: () => calls.push('failed'),
        ...overrides,
    };
    const runtimeMethods: IRuntimeFixtureMethods = {
        loadUnitPrefab: async () => null,
        loadEffectPrefab: async () => null,
        openGuide: async () => ({ close: () => calls.push('guideClose') }),
        openDamage: async () => ({ isOpen: true, refresh() {}, close: () => calls.push('damageClose') }),
        openRank: async () => ({ close: () => calls.push('rankClose') }),
        // 默认「点确定就确认」：既有用例 emit Retreat 期待直接进结算，别让两次确认挡路。
        // 要验「点取消 / 只确认一次」时用 overrides 覆盖。
        confirm: async () => ({ answered: Promise.resolve(true), close() {} }),
        schedule: callback => { scheduled = callback; return () => { scheduled = null; }; }, failed: () => calls.push('failed'), ...auxiliary,
    };

    let runtimeEpoch = 0;
    let settlementEpoch = 0;
    let guidePopup: ITestBattlePopup | null = null;
    let rankPopup: ITestBattlePopup | null = null;
    let settlementRankPopup: ITestBattlePopup | null = null;
    let damagePopup: ITestDamageStatsPopup | null = null;
    let damagePhase: 'runtime' | 'settlement' | null = null;
    let settlementPopup: ITestBattlePopup | null = null;
    let confirmPopup: ITestBattlePopup | null = null;

    const target = {};
    EventMgr.instance.on(ZC_BATTLE_EVENTS.RETURN_TO_MAIN, (_payload, source) => { if (source === view) calls.push('navigate'); }, target);
    EventMgr.instance.on(ZC_BATTLE_EVENTS.SHOW_TIP, ({ message }, source) => { if (source === view) calls.push('tip:' + message); }, target);
    EventMgr.instance.on(ZC_BATTLE_EVENTS.PVE_RESULT, ({ victory }, source) => { if (source === view) persisted.push(victory); }, target);
    EventMgr.instance.on(ZC_BATTLE_EVENTS.POPUP_COMMAND, (command: ZCBattlePopupCommand, source: object) => {
        if (source !== view) return;
        switch (command.kind) {
            case 'openGuide': {
                const epoch = runtimeEpoch;
                void runtimeMethods.openGuide(command.content).then(popup => {
                    if (!popup) return;
                    if (epoch !== runtimeEpoch) { popup.close('force'); return; }
                    guidePopup = popup;
                }).catch(error => runtimeMethods.failed(error));
                return;
            }
            case 'openDamage': {
                const phase = command.phase;
                const epoch = phase === 'runtime' ? runtimeEpoch : settlementEpoch;
                const opener = phase === 'runtime' ? runtimeMethods.openDamage : settlementMethods.openDamage;
                void opener(command.units, command.seats).then(popup => {
                    const currentEpoch = phase === 'runtime' ? runtimeEpoch : settlementEpoch;
                    if (!popup) {
                        EventMgr.instance.emit(ZC_BATTLE_EVENTS.DAMAGE_POPUP_STATE, { phase, open: false }, view);
                        return;
                    }
                    if (epoch !== currentEpoch) {
                        popup.close('force');
                        EventMgr.instance.emit(ZC_BATTLE_EVENTS.DAMAGE_POPUP_STATE, { phase, open: false }, view);
                        return;
                    }
                    if (!popup.isOpen) {
                        EventMgr.instance.emit(ZC_BATTLE_EVENTS.DAMAGE_POPUP_STATE, { phase, open: false }, view);
                        return;
                    }
                    const originalClose = popup.close.bind(popup);
                    const wrapped: ITestDamageStatsPopup = {
                        get isOpen() { return popup.isOpen; },
                        refresh: units => popup.refresh(units),
                        close: reason => {
                            if (damagePopup === wrapped) {
                                damagePopup = null;
                                damagePhase = null;
                            }
                            EventMgr.instance.emit(ZC_BATTLE_EVENTS.DAMAGE_POPUP_STATE, { phase, open: false }, view);
                            originalClose(reason);
                        },
                    };
                    damagePopup = wrapped;
                    damagePhase = phase;
                    EventMgr.instance.emit(ZC_BATTLE_EVENTS.DAMAGE_POPUP_STATE, { phase, open: true }, view);
                }).catch(error => {
                    EventMgr.instance.emit(ZC_BATTLE_EVENTS.DAMAGE_POPUP_STATE, { phase, open: false }, view);
                    (phase === 'runtime' ? runtimeMethods : settlementMethods).failed(error);
                });
                return;
            }
            case 'refreshDamage': {
                if (damagePhase === 'runtime' && damagePopup?.isOpen) {
                    damagePopup.refresh(command.units);
                }
                return;
            }
            case 'openRank': {
                const epoch = runtimeEpoch;
                void runtimeMethods.openRank(command.seats, command.profiles).then(popup => {
                    if (!popup) return;
                    if (epoch !== runtimeEpoch) { popup.close('force'); return; }
                    rankPopup = popup;
                }).catch(error => runtimeMethods.failed(error));
                return;
            }
            case 'closeRuntimePopups': {
                runtimeEpoch++;
                const guide = guidePopup; guidePopup = null;
                const rank = rankPopup; rankPopup = null;
                const damage = damagePhase === 'runtime' ? damagePopup : null;
                if (damagePhase === 'runtime') { damagePopup = null; damagePhase = null; }
                closeSafely([damage, rank, guide]);
                return;
            }
            case 'openSettlement': {
                const epoch = settlementEpoch;
                void settlementMethods.open(command.options).then(popup => {
                    if (!popup) return;
                    if (epoch !== settlementEpoch) { popup.close('force'); return; }
                    settlementPopup = popup;
                }).catch(error => settlementMethods.failed(error));
                return;
            }
            case 'closeSettlement': {
                settlementEpoch++;
                const popup = settlementPopup; settlementPopup = null;
                closeSafely([popup], command.reason);
                return;
            }
            case 'closeSettlementPopups': {
                settlementEpoch++;
                const popup = settlementPopup; settlementPopup = null;
                const team = damagePhase === 'settlement' ? damagePopup : null;
                if (damagePhase === 'settlement') { damagePopup = null; damagePhase = null; }
                closeSafely([team, popup]);
                return;
            }
        }
    }, target);

    const settlement = new ZCBattleSettlementController(context, {
        results: settlementMethods,
        rewards: settlementMethods,
        rank: {
            async present(seats, profiles) {
                const epoch = settlementEpoch;
                if (rankPopup) {
                    const stale = rankPopup; rankPopup = null;
                    stale.close('force');
                }
                const popup = await settlementMethods.openRank(seats, profiles);
                if (!popup) return;
                if (epoch !== settlementEpoch) { popup.close('force'); return; }
                settlementRankPopup = popup;
                try {
                    await (popup.whenClosed ?? Promise.resolve());
                } finally {
                    if (settlementRankPopup === popup) settlementRankPopup = null;
                }
            },
            cancel() {
                const popup = settlementRankPopup;
                settlementRankPopup = null;
                popup?.close('force');
            },
        },
        flow: settlementMethods,
        failed: settlementMethods.failed,
    }, { owner: view, hasPveContext: false });

    const runtime = new ZCBattleRuntimeController(context, view, settlement, {
        art: runtimeMethods,
        dialogs: {
            async confirm(options) {
                const epoch = runtimeEpoch;
                const popup = await runtimeMethods.confirm(options);
                if (!popup) return false;
                if (epoch !== runtimeEpoch) { popup.close('force'); return false; }
                confirmPopup = popup;
                try {
                    return (await popup.answered) === true;
                } finally {
                    if (confirmPopup === popup) confirmPopup = null;
                }
            },
            cancel() {
                const popup = confirmPopup;
                confirmPopup = null;
                popup?.close('force');
            },
        },
        clock: runtimeMethods,
        failed: runtimeMethods.failed,
        audio: runtimeMethods.playSound ? { playSound: runtimeMethods.playSound } : undefined,
    }, session);

    const entry: IZCGameEntry = {
        resources: { loadGuide: async () => ({ entries: [], params: {}, iconFrames: new Map() }) } as IZCGameEntry['resources'],
        battleSeed: 'runtime-test', matchConfig: config, playerAvatars: null, seatProfiles: [],
        seatUnitIds: [['player', 81], ['enemy', 82], ['enemy2', 83]], pveContext: null, slgBattleType,
    };
    const resources = createControllerResources(context);
    resources.scope.defer(() => EventMgr.instance.offTarget(target));
    runtime.start(entry, resources);
    return { runtime, session, settlement, entry, view, calls, requests, pages, persisted, resources,
        holdSweep(value: boolean) { hold = value; }, finishShowcase() { scheduled?.(); },
        settleSwitch(entered: boolean) { switchCallback(entered); },
        closeDamagePopup() { damagePopup?.close('manual'); },
        dispose() { runtime.dispose(); session.dispose(); resources.scope.dispose(); },
        forceStatus(status: 'victory' | 'defeat' | 'draw') {
            const model = runtime.currentModel;
            const snapshot = model.snapshot;
            Object.defineProperty(model, 'snapshot', { get: () => ({ ...snapshot, status }) });
        },
    };
}
