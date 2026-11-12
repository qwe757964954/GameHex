import assert from 'node:assert/strict';
import test from 'node:test';
import type { IControllerResources } from '../assets/script/framework/controller/ControllerBase';
import type { IZCChapterBattleOutcome } from '../assets/script/app/battle/BattleResultService';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import type { IZCGameEntry } from '../assets/script/app/zcds/application/ZCGameEntry';
import type { IZCBattleRuntimeServices } from '../assets/script/app/zcds/application/ZCBattleRuntimeContract';
import type { IZCBattleSettlementServices } from '../assets/script/app/zcds/application/ZCBattleSettlementController';
import { createControllerContext, createControllerResources } from './helpers/controller-context';
import { loadBattleComposition } from './helpers/battle-composition';

function fixture(failRuntime = false) {
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
    const popup = { isPopupOpen: true, refresh(players: unknown) { calls.push(['refreshDamage', players]); }, close(reason: unknown) { calls.push(['close', reason]); } };
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
        '../../zcds/ui/ZCSettlementPage': { ZCSettlementPage: { async open(options: unknown) { calls.push(['settlement', options]); return popup; } } },
        '../../zcds/ui/ZCGuidePanel': { ZCGuidePanel: { async open(options: unknown) { calls.push(['guide', options]); return popup; } } },
        '../../zcds/ui/GameRunAway': { GameRunAway: { async open(options: unknown) { calls.push(['damage', options]); return popup; } } },
        '../../zcds/view/ZCGameRankBoard': { ZCGameRankBoard: { async open(options: unknown) { calls.push(['rank', options]); return popup; } } },
        '../../../framework/ui/PopupDef': { PopupCloseReason: { Manual: 'manual', Force: 'force' }, PopupLayer: { SYSTEM: 'system' } },
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
        const callback = () => {};
        h.runtime.clock.schedule(callback, 1)();
        assert.deepEqual(h.calls.slice(-2), [['schedule', callback, 1], ['unschedule', callback]]);
        const caller = {};
        assert.equal(await h.settlement.results.waitResult(1003, caller), null);
        const request = { localVictory: false, elapsedSeconds: 9, commands: [], statistics: [], battleType: 1003 };
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

test('composition popup adapters preserve data and manual/force close semantics', async () => {
    const h = fixture();
    try {
        h.composition.mount();
        const options = { victory: true, rewards: [] };
        const popup = await h.settlement.popup.open(options);
        const config = h.calls.at(-1)[1] as { userData: unknown; layer: string; closeOnBlank: boolean };
        assert.equal(config.userData, options);
        assert.equal(config.layer, 'system'); assert.equal(config.closeOnBlank, false);
        popup.close('manual'); popup.close();
        assert.deepEqual(h.calls.slice(-2), [['close', 'manual'], ['close', 'force']]);
        const content = { entries: [], params: { panelTitle: 'guide', footerText: '', emptyText: '' }, iconFrames: new Map() };
        await h.runtime.popups.openGuide(content);
        assert.equal((h.calls.at(-1)[1] as { userData: { content: unknown } }).userData.content, content);
        const players = [{ owner: 'player' as const, name: 'me', headKey: '', damage: 1, damageTaken: 2 }];
        const damage = await h.runtime.popups.openDamage(players);
        const damageOptions = h.calls.at(-1)[1] as { userData: { players: unknown }; closeOnBlank: boolean };
        assert.equal(damageOptions.userData.players, players);
        assert.equal(damageOptions.closeOnBlank, true);
        assert.equal(damage.isOpen, true);
        damage.refresh(players);
        assert.deepEqual(h.calls.at(-1), ['refreshDamage', players]);
        const seats = [], profiles = new Map();
        await h.runtime.popups.openRank(seats, profiles);
        assert.equal((h.calls.at(-1)[1] as { userData: { seats: unknown } }).userData.seats, seats);
        assert.equal((h.calls.at(-1)[1] as { userData: { profiles: unknown } }).userData.profiles, profiles);
    } finally { h.dispose(); }
});

test('composition releases a constructed settlement when runtime assembly fails', () => {
    const h = fixture(true);
    try {
        assert.throws(() => h.composition.mount(), error => error === h.failure);
        assert.deepEqual(h.calls, [['listen'], ['disposeSettlement']]);
    } finally { h.dispose(); }
});
