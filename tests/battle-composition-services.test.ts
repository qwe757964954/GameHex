import assert from 'node:assert/strict';
import test from 'node:test';
import type { IControllerResources } from '../assets/script/framework/controller/ControllerBase';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import type { IZCChapterBattleOutcome } from '../assets/script/app/battle/BattleResultService';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import { ZC_BATTLE_EVENTS } from '../assets/script/app/zcds/application/ZCBattleEvents';
import type { IZCGameEntry } from '../assets/script/app/zcds/application/ZCGameEntry';
import type { IZCBattleRuntimeServices } from '../assets/script/app/zcds/application/ZCBattleRuntimeContract';
import type { IZCBattleSettlementServices } from '../assets/script/app/zcds/application/ZCBattleSettlementController';
import { createControllerContext, createControllerResources } from './helpers/controller-context';
import { loadBattleComposition } from './helpers/battle-composition';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

interface IPopupStubOptions {
    settlementOpen?: (options: any) => Promise<any>;
    guideOpen?: (options: any) => Promise<any>;
    damageOpen?: (options: any) => Promise<any>;
    rankOpen?: (options: any) => Promise<any>;
    tipsOpen?: (options: any) => Promise<any>;
}

function fixture(failRuntime = false, popupOverrides: IPopupStubOptions = {}) {
    const context = createControllerContext(), resources = createControllerResources(context);
    const calls: unknown[][] = [];
    let runtimeServices: IZCBattleRuntimeServices;
    let settlementServices: IZCBattleSettlementServices;
    const failure = new Error('runtime assembly failed');
    const view = {
        scheduleOnce(callback: () => void, seconds: number) { calls.push(['schedule', callback, seconds]); },
        unschedule(callback: () => void) { calls.push(['unschedule', callback]); },
    };
    const entry = { pveContext: null, slgBattleType: 1003 } as IZCGameEntry;
    const session = {
        scope: new ResourceScope('battle-services-test'), current: view,
        mount(options: { createRuntime(): typeof view; createRuntimeController(host: typeof view, entry: IZCGameEntry, resources: IControllerResources): unknown }) {
            assert.equal(options.createRuntime(), view);
            options.createRuntimeController(view, entry, resources);
        },
        dispose() { this.scope.dispose(); },
    };
    const makePopup = (kind: string, options?: { onClose?: (reason?: number) => void }) => ({
        isPopupOpen: true,
        refresh(units: unknown) { calls.push(['refreshDamage', units]); },
        close(reason: number = 0) {
            if (!this.isPopupOpen) return;
            this.isPopupOpen = false;
            calls.push([`close:${kind}`, reason]);
            options?.onClose?.(reason);
        },
    });
    const openScoped = async (
        kind: string,
        options: { scope?: ResourceScope; onClose?: (reason?: number) => void } | undefined,
        override?: (options: any) => Promise<any>,
    ): Promise<any> => {
        const scope = options?.scope;
        if (scope?.disposed) return null;
        const popup = await (override ? override(options) : Promise.resolve(makePopup(kind, options)));
        if (!popup) return null;
        if (scope?.disposed) {
            if (popup.isPopupOpen !== false) popup.close(3);
            return null;
        }
        if (scope) {
            const rawClose = popup.close?.bind(popup);
            let detach = () => {};
            popup.close = (reason: number = 0) => {
                detach();
                rawClose?.(reason);
            };
            detach = scope.defer(() => {
                if (popup.isPopupOpen !== false) popup.close(3);
            });
        }
        return popup;
    };
    const { BattleComposition } = loadBattleComposition({
        '../zcds/application/ZCClientCombatConfig': {}, '../zcds/model/ZCRankBoard': {},
        '../zcds/ZCGame': {}, './ZCGameLoader': {}, '../../territory/application/TerritorySaveStoreAdapter': {},
    }, {
        '../../zcds/application/ZCBattleRuntimeController': { ZCBattleRuntimeController: class {
            constructor(_context: unknown, host: unknown, _settlement: unknown, services: IZCBattleRuntimeServices) {
                assert.equal(host, view); runtimeServices = services;
                if (failRuntime) throw failure;
            }
        } },
        '../../zcds/application/ZCBattleSettlementController': { ZCBattleSettlementController: class {
            constructor(_context: unknown, services: IZCBattleSettlementServices, host: { owner: object; hasPveContext: boolean }) {
                assert.equal(host.owner, view); assert.equal(host.hasPveContext, false); settlementServices = services;
            }
            dispose() { calls.push(['disposeSettlement']); }
        } },
        '../../battle/BattleResultService': { BattleResultService: {
            ensureListening() { calls.push(['listen']); },
            async waitForBattleResult(...args: unknown[]) { calls.push(['wait', ...args]); return null; },
            cancelWait(caller: object) { calls.push(['cancelWait', caller]); },
        } },
        '../../battle/BattleStartService': {
            BATTLE_RESULT_WIN: 1, BATTLE_RESULT_LOSE: 2,
            async finishBattle(...args: unknown[]) { calls.push(['finish', ...args]); },
        },
        '../../net/GameNet': { GameNet: { instance: { removeCaller(caller: object) { calls.push(['removeCaller', caller]); } } } },
        '../../showReward/RewardFrames': { async resolveCmdGoodsFrames(goods: unknown, owner: unknown) {
            calls.push(['rewards', goods, owner]); return [{ entry: { resId: 'gold', number: 3 } }];
        } },
        '../../zcds/ui/ZCSettlementPage': { ZCSettlementPage: { open(options: any) {
            calls.push(['settlement', options]);
            return openScoped('settlement', options, popupOverrides.settlementOpen);
        } } },
        '../../zcds/ui/ZCGuidePanel': { ZCGuidePanel: { open(options: any) {
            calls.push(['guide', options]);
            return openScoped('guide', options, popupOverrides.guideOpen);
        } } },
        '../../zcds/ui/GameRunAway': { GameRunAway: { open(options: any) {
            calls.push(['damage', options]);
            return openScoped('damage', options, popupOverrides.damageOpen);
        } } },
        '../../zcds/view/ZCGameRankBoard': { ZCGameRankBoard: { open(options: any) {
            calls.push(['rank', options]);
            return openScoped('rank', options, popupOverrides.rankOpen);
        } } },
        '../../common/CommonTips': { CommonTips: { open(options: any) {
            calls.push(['tips', options]);
            return openScoped('tips', options, popupOverrides.tipsOpen);
        } } },
        '../../../framework/audio/AudioMgr': { AudioMgr: { instance: {
            playMusic: async () => {},
            stopMusic: () => { calls.push(['stopMusic']); },
            playSound: (key: string, scope: unknown) => { calls.push(['playSound', key, scope]); },
        } } },
        '../../ResConst': { GAME_AUDIO: { battleMusic: 'bgm', victory: 'win_sfx', defeat: 'lose_sfx' } },
        '../../../framework/ui/PopupDef': { PopupCloseReason: { Manual: 0, Force: 3 }, PopupLayer: { SYSTEM: 1 } },
        '../../../framework/procedure/ProcedureManager': { ProcedureManager: {
            onSwitchSettled(callback: unknown) { calls.push(['watch', callback]); return () => calls.push(['unwatch']); },
        } },
    });
    const composition = new BattleComposition(context, { addComponent: () => view }, { session });
    return { composition, context, resources, view, calls, failure,
        get runtime() { return runtimeServices; }, get settlement() { return settlementServices; },
        dispose() { composition.dispose(); resources.scope.dispose(); },
    };
}

test('composition binds resource scope, real clock host, caller and service results', async () => {
    const h = fixture();
    try {
        assert.equal(h.calls.length, 0, 'runtime services must remain deferred until mount');
        h.composition.mount();
        h.context.assets.load = async (path, _type, options) => {
            assert.equal(path, 'units/test'); assert.equal(options.scope, h.resources.scope); return null;
        };
        await h.runtime.art.loadUnitPrefab('units/test');
        await h.runtime.art.loadEffectPrefab('units/test');
        const callback = () => {};
        h.runtime.clock.schedule(callback, 1)();
        assert.deepEqual(h.calls.slice(-2), [['schedule', callback, 1], ['unschedule', callback]]);
        const caller = {};
        assert.equal(await h.settlement.results.waitResult(1003, caller), null);
        const request = { localVictory: false, elapsedSeconds: 9, commands: [], statistics: [], battleType: 1003, rank: null };
        await h.settlement.results.finish(request, caller);
        h.settlement.results.cancelRequests(caller);
        assert.deepEqual(h.calls.slice(-4), [
            ['wait', 1003, undefined, caller], ['finish', 9, 2, request.commands, request.statistics, caller],
            ['removeCaller', caller], ['cancelWait', caller],
        ]);
        const outcome: IZCChapterBattleOutcome = { code: 1, treasureId: 0, goods: [{ resId: 1, number: 3 }] };
        const rewards = await h.settlement.rewards.loadRewards(outcome);
        assert.deepEqual(Array.from(rewards, reward => ({ ...reward })), [{ resId: 'gold', amount: 3 }]);
        assert.deepEqual(h.calls.at(-1), ['rewards', outcome.goods, h.resources]);
        h.settlement.flow.watchSwitch(callback)();
        assert.deepEqual(h.calls.slice(-2), [['watch', callback], ['unwatch']]);
    } finally { h.dispose(); }
});

test('composition popup host orchestrates event-driven popups, audio and manual/force close', async () => {
    const damageStates: unknown[] = [];
    const target = {};
    EventMgr.instance.on(ZC_BATTLE_EVENTS.DAMAGE_POPUP_STATE, (state: { phase: string; open: boolean }, source) => {
        if (source) damageStates.push({ phase: state.phase, open: state.open });
    }, target);
    const h = fixture();
    try {
        h.composition.mount();
        const options = { victory: true, rewards: [] };
        EventMgr.instance.emit(ZC_BATTLE_EVENTS.POPUP_COMMAND, { kind: 'openSettlement', options, playOutcome: true }, h.view);
        await flush();
        const settlementCall = h.calls.find(call => call[0] === 'settlement')!;
        const config = settlementCall[1] as { userData: unknown; layer: number; closeOnBlank: boolean };
        assert.equal(config.userData, options);
        assert.equal(config.layer, 1); assert.equal(config.closeOnBlank, false);
        assert.ok(h.calls.some(call => call[0] === 'playSound' && call[1] === 'win_sfx'));
        EventMgr.instance.emit(ZC_BATTLE_EVENTS.POPUP_COMMAND, { kind: 'closeSettlement', reason: 'manual' }, h.view);
        assert.deepEqual(h.calls.at(-1), ['close:settlement', 0]);

        const content = { entries: [], params: { panelTitle: 'guide', footerText: '', emptyText: '' }, iconFrames: new Map() };
        EventMgr.instance.emit(ZC_BATTLE_EVENTS.POPUP_COMMAND, { kind: 'openGuide', content }, h.view);
        await flush();
        assert.equal((h.calls.find(call => call[0] === 'guide')![1] as { userData: { content: unknown } }).userData.content, content);

        const units = [{ owner: 'player' as const, unitId: '68001', cardId: '68001', name: '豌豆游侠', iconKey: '', rarity: 'green' as const, damage: 1, damageTaken: 2 }];
        EventMgr.instance.emit(ZC_BATTLE_EVENTS.POPUP_COMMAND, { kind: 'openDamage', phase: 'runtime', units }, h.view);
        await flush();
        const damageCall = h.calls.find(call => call[0] === 'damage')!;
        assert.equal((damageCall[1] as { userData: { units: unknown } }).userData.units, units);
        assert.equal((damageCall[1] as { closeOnBlank: boolean }).closeOnBlank, true);
        assert.deepEqual(damageStates.at(-1), { phase: 'runtime', open: true });

        EventMgr.instance.emit(ZC_BATTLE_EVENTS.POPUP_COMMAND, { kind: 'refreshDamage', units }, h.view);
        assert.deepEqual(h.calls.at(-1), ['refreshDamage', units]);

        const seats: never[] = [], profiles = new Map();
        EventMgr.instance.emit(ZC_BATTLE_EVENTS.POPUP_COMMAND, { kind: 'openRank', seats, profiles }, h.view);
        await flush();
        const rankCall = h.calls.find(call => call[0] === 'rank')!;
        assert.equal((rankCall[1] as { userData: { seats: unknown } }).userData.seats, seats);
        assert.equal((rankCall[1] as { userData: { profiles: unknown } }).userData.profiles, profiles);

        EventMgr.instance.emit(ZC_BATTLE_EVENTS.POPUP_COMMAND, { kind: 'closeRuntimePopups' }, h.view);
        assert.ok(h.calls.some(call => call[0] === 'close:damage' && call[1] === 3));
        assert.ok(h.calls.some(call => call[0] === 'close:rank' && call[1] === 3));
        assert.ok(h.calls.some(call => call[0] === 'close:guide' && call[1] === 3));
    } finally {
        EventMgr.instance.offTarget(target);
        h.dispose();
    }
});

test('settlement rank closes stale or in-flight runtime rank board and resolves when closed', async () => {
    const firstRank = deferred<any>();
    let rankCalls = 0;
    let closeSecondRank!: () => void;
    const h = fixture(false, {
        rankOpen: (options: { onClose?: () => void }) => {
            rankCalls++;
            if (rankCalls === 1) return firstRank.promise;
            const second = {
                isPopupOpen: true,
                close() {
                    if (!this.isPopupOpen) return;
                    this.isPopupOpen = false;
                    options.onClose?.();
                },
            };
            closeSecondRank = () => second.close();
            return Promise.resolve(second);
        },
    });
    try {
        h.composition.mount();
        EventMgr.instance.emit(ZC_BATTLE_EVENTS.POPUP_COMMAND, { kind: 'openRank', seats: [], profiles: new Map() }, h.view);
        EventMgr.instance.emit(ZC_BATTLE_EVENTS.POPUP_COMMAND, { kind: 'closeRuntimePopups' }, h.view);

        let settlementDone = false;
        const presenting = h.settlement.rank.present([], new Map()).then(() => { settlementDone = true; });
        await flush();
        assert.equal(rankCalls, 2, 'runtimeScope 释放后结算可直接打开独立排行榜，不必等待局内加载');
        assert.equal(settlementDone, false);

        let firstClosed = 0;
        firstRank.resolve({ isPopupOpen: true, close() { firstClosed++; this.isPopupOpen = false; } });
        await flush();
        assert.equal(firstClosed, 1, 'stale in-flight runtime rank must close immediately');
        assert.equal(settlementDone, false);

        closeSecondRank();
        await presenting;
        assert.equal(settlementDone, true);
    } finally { h.dispose(); }
});

test('runtime dialog confirm bridges sure/close and closes late popup on disposal', async () => {
    const pendingTips = deferred<any>();
    let tipsCall = 0;
    const h = fixture(false, {
        tipsOpen: (options: { userData: { onSure?: () => void }; onClose?: () => void }) => {
            tipsCall++;
            if (tipsCall === 1) {
                options.userData.onSure?.();
                return Promise.resolve({ isPopupOpen: true, close() { this.isPopupOpen = false; } });
            }
            return pendingTips.promise;
        },
    });
    try {
        h.composition.mount();
        assert.equal(await h.runtime.dialogs.confirm({ content: '退出？' }), true);

        const pendingAnswer = h.runtime.dialogs.confirm({ content: '退出？' });
        await flush();
        h.dispose();
        let lateClosed = 0;
        pendingTips.resolve({ isPopupOpen: true, close() { lateClosed++; this.isPopupOpen = false; } });
        assert.equal(await pendingAnswer, false);
        assert.equal(lateClosed, 1);
    } finally { h.dispose(); }
});

test('late guide/settlement popups arriving after disposal close immediately', async () => {
    const pendingGuide = deferred<any>();
    const pendingSettlement = deferred<any>();
    const h = fixture(false, {
        guideOpen: () => pendingGuide.promise,
        settlementOpen: () => pendingSettlement.promise,
    });
    try {
        h.composition.mount();
        EventMgr.instance.emit(ZC_BATTLE_EVENTS.POPUP_COMMAND, {
            kind: 'openGuide',
            content: { entries: [], params: { panelTitle: '', footerText: '', emptyText: '' }, iconFrames: new Map() },
        }, h.view);
        EventMgr.instance.emit(ZC_BATTLE_EVENTS.POPUP_COMMAND, {
            kind: 'openSettlement',
            options: { victory: true, rewards: [] },
            playOutcome: true,
        }, h.view);
        await flush();
        h.dispose();

        let guideClosed = 0, settlementClosed = 0;
        pendingGuide.resolve({ isPopupOpen: true, close() { guideClosed++; } });
        pendingSettlement.resolve({ isPopupOpen: true, close() { settlementClosed++; } });
        await flush();
        assert.equal(guideClosed, 1);
        assert.equal(settlementClosed, 1);
        assert.equal(h.calls.some(call => call[0] === 'playSound'), false);
    } finally { h.dispose(); }
});

test('popup host closes remaining popups even if one popup close throws during disposal', async () => {
    const closeFailure = new Error('rank close failed');
    let rankCloseAttempts = 0;
    let guideClosed = 0;
    const h = fixture(false, {
        rankOpen: () => Promise.resolve({ isPopupOpen: true, close() { rankCloseAttempts++; throw closeFailure; } }),
        guideOpen: () => Promise.resolve({ isPopupOpen: true, close() { guideClosed++; } }),
    });
    h.composition.mount();
    EventMgr.instance.emit(ZC_BATTLE_EVENTS.POPUP_COMMAND, { kind: 'openRank', seats: [], profiles: new Map() }, h.view);
    EventMgr.instance.emit(ZC_BATTLE_EVENTS.POPUP_COMMAND, {
        kind: 'openGuide',
        content: { entries: [], params: { panelTitle: '', footerText: '', emptyText: '' }, iconFrames: new Map() },
    }, h.view);
    await flush();
    // ResourceScope 会隔离清理异常，核心是前面弹窗抛错不能阻止后续弹窗与作用域继续清理。
    assert.doesNotThrow(() => h.dispose());
    assert.equal(rankCloseAttempts, 1);
    assert.equal(guideClosed, 1);
    assert.equal(h.resources.scope.disposed, true);
});

test('composition releases a constructed settlement when runtime assembly fails', () => {
    const h = fixture(true);
    try {
        assert.throws(() => h.composition.mount(), error => error === h.failure);
        assert.deepEqual(h.calls, [['listen'], ['disposeSettlement']]);
    } finally { h.dispose(); }
});
