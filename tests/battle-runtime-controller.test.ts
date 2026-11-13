import assert from 'node:assert/strict';
import test from 'node:test';
import { ZCBattleSettlementController } from '../assets/script/app/zcds/application/ZCBattleSettlementController';
import { createControllerContext } from './helpers/controller-context';
import { runtimeFixture, flush, deferred } from './helpers/battle-runtime';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { ZC_BATTLE_EVENTS } from '../assets/script/app/zcds/application/ZCBattleEvents';
import { ZCGameUiEvent } from '../assets/script/app/zcds/view/ZCGameHudEvents';
import type { IZCChapterBattleOutcome } from '../assets/script/app/battle/BattleResultService';
import type { IZCBattlePopup } from '../assets/script/app/zcds/application/ZCBattleSettlementController';
import type { IZCDamageStatsPlayer, IZCDamageStatsPopup } from '../assets/script/app/zcds/application/ZCBattleRuntimeContract';

test('固定与自选出生点开局按阵营打印卡牌最终属性，后续帧不重复打印', (t) => {
    const log = t.mock.method(console, 'info', () => {});
    for (const selecting of [false, true]) {
        const before = log.mock.callCount();
        const h = runtimeFixture({}, selecting);
        try {
            const cardLogs = () => log.mock.calls.slice(before).filter((call) => call.arguments[0] === '[对局卡牌属性]');
            if (selecting) {
                assert.equal(cardLogs().length, 0);
                EventMgr.instance.emit(ZCGameUiEvent.SpawnConfirm);
                EventMgr.instance.emit(ZC_BATTLE_EVENTS.FRAME, { owner: h.view, dt: 20 });
                h.finishShowcase();
            }
            const model = h.runtime.currentModel;
            assert.ok(model);
            assert.deepEqual(cardLogs().map((call) => call.arguments[1]), model.owners);
            for (const call of cardLogs()) {
                const owner = call.arguments[1];
                const rows = JSON.parse(call.arguments[2]);
                const config = h.entry.matchConfig;
                const deck = config.ownerDecks?.[owner] ?? (owner === 'player' ? config.playerDeck : config.enemyDeck);
                assert.equal(rows.length, deck.length);
                const card = deck.find((item) => item.unitId);
                assert.ok(card);
                const definition = model.effectiveDefinitionForUnit(owner, card.unitId);
                assert.deepEqual(rows.find((row) => row.cardId === card.id), {
                    cardId: card.id, name: card.name, heroId: card.unitId,
                    buildingHp: card.baseHp ?? null, maxHp: definition.maxHp, attack: definition.attack,
                });
                const building = deck.find((item) => !item.unitId);
                if (building) assert.equal(rows.find((row) => row.cardId === building.id).maxHp, null);
            }
            EventMgr.instance.emit(ZC_BATTLE_EVENTS.FRAME, { owner: h.view, dt: 0.1 });
            EventMgr.instance.emit(ZCGameUiEvent.SpawnConfirm);
            h.finishShowcase();
            assert.equal(cardLogs().length, model.owners.length);
        } finally { h.dispose(); }
    }
});

test('GM 加金币经事件修改当前模型并即时渲染，选点阶段拒绝，退出后解除', () => {
    const target = {}, messages: string[] = [];
    EventMgr.instance.on(ZCGameUiEvent.DebugAddGoldResult, ({ message }) => messages.push(message), target);
    try {
        const selecting = runtimeFixture({}, true);
        try {
            EventMgr.instance.emit(ZCGameUiEvent.DebugAddGold, 123);
            assert.match(messages.at(-1), /出生点/);
            assert.equal(selecting.runtime.currentModel, null);
        } finally { selecting.dispose(); }
        const h = runtimeFixture();
        const model = h.runtime.currentModel;
        const before = model.snapshot.playerGold;
        try {
            h.calls.length = 0;
            EventMgr.instance.emit(ZCGameUiEvent.DebugAddGold, 123);
            assert.equal(model.snapshot.playerGold, before + 123);
            assert.ok(h.calls.includes('all'));
            assert.match(messages.at(-1), /增加 123/);
            h.calls.length = 0;
            EventMgr.instance.emit(ZCGameUiEvent.DebugAddGold, -1);
            assert.equal(model.snapshot.playerGold, before + 123);
            assert.equal(h.calls.length, 0);
        } finally { h.dispose(); }
        const count = messages.length;
        EventMgr.instance.emit(ZCGameUiEvent.DebugAddGold, 123);
        assert.equal(messages.length, count);
        assert.equal(model.snapshot.playerGold, before + 123);
    } finally { EventMgr.instance.offTarget(target); }
});

test('伤害面板按实际席位逐人显示，打开时追平并按静态节奏实时刷新，关闭后停止', async () => {
    for (const count of [2, 3, 4]) {
        const opened: (readonly IZCDamageStatsPlayer[])[] = [];
        const updates: (readonly IZCDamageStatsPlayer[])[] = [];
        let isOpen = true, opens = 0;
        const popup: IZCDamageStatsPopup = { get isOpen() { return isOpen; }, refresh: players => updates.push(players), close() { isOpen = false; } };
        const h = runtimeFixture({}, false, undefined, { openDamage: async players => { opens++; opened.push(players); return popup; } });
        try {
            const owners = ['player', 'enemy', 'enemy2', 'enemy3'].slice(0, count);
            const stats = { player: { dealt: 10, taken: 3 }, enemy: { dealt: 20, taken: 5 }, enemy2: { dealt: 30, taken: 7 }, enemy3: { dealt: 40, taken: 9 } };
            Object.assign(h.entry, { seatProfiles: owners.map((owner, i) => [owner, { name: `玩家${i}`, headKey: `${i + 1}` }]) });
            const model = h.runtime.currentModel;
            Object.defineProperty(model, 'owners', { get: () => owners });
            Object.defineProperty(model, 'damageStats', { get: () => stats });
            model.tick = () => {};
            EventMgr.instance.emit(ZCGameUiEvent.OpenDamageStats);
            EventMgr.instance.emit(ZCGameUiEvent.OpenDamageStats);
            stats.enemy.dealt = 25;
            await flush();
            assert.equal(opens, 1, '打开中的连点不重复加载弹窗');
            assert.deepEqual(opened[0].map(player => player.owner), owners);
            assert.deepEqual(opened[0].map(player => player.damage), [10, 20, 30, 40].slice(0, count));
            assert.equal(updates[updates.length - 1][1].damage, 25, '加载期间发生的伤害在打开后追平');
            assert.equal(updates[updates.length - 1][1].name, '玩家1');
            assert.equal(updates[updates.length - 1][1].headKey, '2');
            const before = updates.length;
            stats.enemy.dealt = 100;
            for (let i = 0; i < 3; i++) EventMgr.instance.emit(ZC_BATTLE_EVENTS.FRAME, { owner: h.view, dt: 0.05 });
            assert.equal(updates.length, before + 1);
            assert.deepEqual(updates[updates.length - 1].map(player => player.owner), owners, '伤害改变不重排行');
            assert.equal(updates[updates.length - 1][1].damage, 100);
            isOpen = false;
            EventMgr.instance.emit(ZC_BATTLE_EVENTS.FRAME, { owner: h.view, dt: 0.15 });
            assert.equal(updates.length, before + 1);
            isOpen = true;
            EventMgr.instance.emit(ZCGameUiEvent.OpenDamageStats);
            await flush();
            assert.equal(opens, 2);
            h.dispose();
            const final = updates.length;
            EventMgr.instance.emit(ZC_BATTLE_EVENTS.FRAME, { owner: h.view, dt: 1 });
            assert.equal(updates.length, final);
            assert.equal(isOpen, false);
        } finally { h.dispose(); }
    }
});

test('missing unit art is scoped to its real view, deduplicated and ignored after disposal', async () => {
    const pending = deferred<any>();
    const loads: string[] = [];
    const h = runtimeFixture({}, false, undefined, {
        loadUnitPrefab: path => { loads.push(path); return pending.promise; },
    });
    const applied: unknown[] = [];
    h.view.applyUnitPrefab = (...args) => applied.push(args);
    const definition = h.entry.matchConfig.units.find(unit => unit.prefabPath);
    assert.ok(definition);
    const intent = { owner: h.view, unitId: definition.unitId };
    try {
        EventMgr.instance.emit(ZCGameUiEvent.RequestUnitArt, { ...intent, owner: {} });
        EventMgr.instance.emit(ZCGameUiEvent.RequestUnitArt, { owner: h.view, unitId: 'unknown-unit' });
        await flush();
        assert.equal(loads.length, 0);
        EventMgr.instance.emit(ZCGameUiEvent.RequestUnitArt, intent);
        EventMgr.instance.emit(ZCGameUiEvent.RequestUnitArt, intent);
        assert.deepEqual(loads, [definition.prefabPath]);
        h.dispose();
        pending.resolve({});
        await flush();
        assert.deepEqual(applied, []);
        EventMgr.instance.emit(ZCGameUiEvent.RequestUnitArt, intent);
        assert.equal(loads.length, 1);
    } finally { h.dispose(); }
});

test('统计面板加载期间结束对局则关闭迟到窗口，已点空白关闭的窗口不再刷新', async () => {
    for (const settled of [false, true]) {
        const pending = deferred<IZCDamageStatsPopup | null>();
        let closes = 0, refreshes = 0;
        const h = runtimeFixture({}, false, undefined, { openDamage: () => pending.promise });
        try {
            EventMgr.instance.emit(ZCGameUiEvent.OpenDamageStats);
            // 投降要过两次确认（异步），必须先让它落定再放行迟到的统计窗口 ——
            // 否则「加载期间已经结束对局」这个前提根本没成立。
            if (settled) { EventMgr.instance.emit(ZCGameUiEvent.Retreat); await flush(); }
            pending.resolve({ isOpen: settled, refresh: () => refreshes++, close: () => closes++ });
            await flush();
            assert.equal(closes, settled ? 1 : 0);
            assert.equal(refreshes, 0);
        } finally { h.dispose(); }
    }
});

test('successful unit art is published once and failed requests allow a later retry', async () => {
    let attempts = 0;
    const prefab = {};
    const h = runtimeFixture({}, false, undefined, {
        loadUnitPrefab: async () => { if (++attempts === 1) throw new Error('load failed'); return prefab; },
    });
    const applied: unknown[] = [];
    h.view.applyUnitPrefab = (...args) => applied.push(args);
    const unitId = h.entry.matchConfig.units.find(unit => unit.prefabPath).unitId;
    try {
        EventMgr.instance.emit(ZCGameUiEvent.RequestUnitArt, { owner: h.view, unitId });
        await flush();
        EventMgr.instance.emit(ZCGameUiEvent.RequestUnitArt, { owner: h.view, unitId });
        await flush();
        EventMgr.instance.emit(ZCGameUiEvent.RequestUnitArt, { owner: h.view, unitId });
        assert.equal(attempts, 2);
        assert.deepEqual(applied, [[unitId, prefab]]);
    } finally { h.dispose(); }
});

test('effect art is loaded on demand, deduplicated per path and published to the view', async () => {
    const loads: string[] = [];
    const prefab = {};
    const path = 'units/projectiles/磁电菇_子弹攻击/磁电菇_子弹攻击';
    const h = runtimeFixture({}, false, undefined, {
        loadEffectPrefab: async (requested: string) => { loads.push(requested); return prefab; },
    });
    const applied: unknown[] = [];
    h.view.applyEffectPrefab = (...args) => applied.push(args);
    try {
        // 别的视图发的请求不能落进来（同一个 EventMgr 里可能同时有多局）。
        EventMgr.instance.emit(ZCGameUiEvent.RequestEffectArt, { owner: {}, path });
        // 弹幕：同一路径同一帧发多次，只加载一次。
        EventMgr.instance.emit(ZCGameUiEvent.RequestEffectArt, { owner: h.view, path });
        EventMgr.instance.emit(ZCGameUiEvent.RequestEffectArt, { owner: h.view, path });
        await flush();
        assert.deepEqual(loads, [path]);
        assert.deepEqual(applied, [[path, prefab]]);
        // 到货之后再问不会重复加载。
        EventMgr.instance.emit(ZCGameUiEvent.RequestEffectArt, { owner: h.view, path });
        await flush();
        assert.deepEqual(loads, [path]);
    } finally { h.dispose(); }
});

test('settlement waits before report, closes before navigation and restores on cancelled switch', async t => {
    const calls: string[] = [], pages: object[] = [];
    let settled = (_entered: boolean) => {};
    const owner = {}, target = {};
    EventMgr.instance.on(ZC_BATTLE_EVENTS.PVE_RESULT, event => { if (event.owner === owner) calls.push('record'); }, target);
    EventMgr.instance.on(ZC_BATTLE_EVENTS.RETURN_TO_MAIN, event => { if (event.owner === owner) calls.push('navigate'); }, target);
    t.after(() => EventMgr.instance.offTarget(target));
    const controller = new ZCBattleSettlementController(createControllerContext(), {
        results: {
            waitResult: () => { calls.push('wait'); return Promise.resolve({ code: 2, goods: [] }); },
            finish: async () => { calls.push('finish'); },
            cancelRequests: () => calls.push('cancel'),
        },
        rewards: { loadRewards: async () => [] },
        popup: {
            open: async options => { pages.push(options); calls.push('open'); return { close: reason => { calls.push('close'); calls.push(`reason:${reason}`); } }; },
            openRank: async () => { calls.push('rank'); return null; },
        },
        flow: { watchSwitch: callback => { settled = callback; return () => calls.push('unwatch'); } },
        failed: () => {},
    }, { owner, hasPveContext: true });
    controller.start({ localVictory: true, elapsedSeconds: 1, commands: [], statistics: [], battleType: 1002, rank: null });
    controller.start({ localVictory: true, elapsedSeconds: 1, commands: [], statistics: [], battleType: 1002, rank: null });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls.slice(0, 3), ['wait', 'finish', 'record']);
    assert.equal((pages[0] as { victory: boolean }).victory, false);
    controller.confirm(); settled(false); await new Promise(resolve => setImmediate(resolve));
    assert.ok(calls.indexOf('close') < calls.indexOf('navigate'));
    assert.ok(calls.includes('reason:manual'));
    assert.equal(pages[0], pages[1]);
    assert.equal(calls.filter(call => call === 'finish').length, 1);
    controller.dispose();
});

test('runtime consumes only its own frame, drains events once and keeps static cadence', () => {
    const h = runtimeFixture();
    try {
        assert.equal(h.session.currentPhase, 'playing');
        let ticks = 0, drained = 0;
        const model = h.runtime.currentModel;
        model.tick = () => ticks++;
        const drain = model.drainPresentationEvents.bind(model);
        model.drainPresentationEvents = () => { drained++; return drain(); };
        h.calls.length = 0;
        EventMgr.instance.emit(ZC_BATTLE_EVENTS.FRAME, { owner: {}, dt: 1 });
        for (let i = 0; i < 10; i++) EventMgr.instance.emit(ZC_BATTLE_EVENTS.FRAME, { owner: h.view, dt: 0.05 });
        assert.equal(ticks, 10); assert.equal(drained, 10);
        assert.equal(h.calls.filter(call => call === 'dynamic').length, 10);
        assert.equal(h.calls.filter(call => call === 'static').length, 3);
        h.dispose();
        assert.equal(h.session.currentPhase, 'leaving');
        EventMgr.instance.emit(ZC_BATTLE_EVENTS.FRAME, { owner: h.view, dt: 1 });
        assert.equal(ticks, 10);
    } finally { h.dispose(); }
});
test('terminal tick waits for presentation before settlement; retreat reports once and stops model input', async () => {
    for (const retreat of [false, true]) {
        const h = runtimeFixture();
        try {
            let ticks = 0, artifacts = 0;
            h.runtime.currentModel.tick = () => ticks++;
            h.runtime.currentModel.useArtifact = () => { artifacts++; return { ok: true, message: 'ok' }; };
            if (!retreat) {
                h.forceStatus('victory'); h.holdSweep(true);
                EventMgr.instance.emit(ZC_BATTLE_EVENTS.FRAME, { owner: h.view, dt: 0.1 });
                assert.equal(h.requests.length, 0); assert.equal(ticks, 1);
                assert.equal(h.session.currentPhase, 'settlement-presentation');
                h.holdSweep(false);
                EventMgr.instance.emit(ZC_BATTLE_EVENTS.FRAME, { owner: h.view, dt: 0.1 });
            } else EventMgr.instance.emit(ZCGameUiEvent.Retreat);
            EventMgr.instance.emit(ZCGameUiEvent.Retreat);
            // 投降是「两次确认」的异步流程；这里等它落定再断言阶段与冻结效果。
            await flush();
            assert.equal(h.session.currentPhase, 'settlement');
            const frozenTicks = ticks;
            EventMgr.instance.emit(ZCGameUiEvent.UseArtifact);
            EventMgr.instance.emit(ZC_BATTLE_EVENTS.FRAME, { owner: h.view, dt: 1 });
            await flush();
            assert.equal(h.requests.length, 1); assert.equal(h.requests[0].localVictory, !retreat);
            assert.equal(artifacts, 0); assert.equal(ticks, frozenTicks);
            assert.deepEqual(h.requests[0].statistics.map(row => row.unitId), [81, 82, 83]);
        } finally { h.dispose(); }
    }
});
test('settlement commands identify player and each AI by server unitId', async () => {
    const h = runtimeFixture();
    try {
        const model = h.runtime.currentModel;
        const hex = model.snapshot.hexes.find(cell => model.canPlayerDevelop(cell.id));
        assert.ok(hex);
        assert.equal(model.developHex(hex.id).ok, true);
        for (let i = 0; i < 100; i++) model.tick(0.1);
        EventMgr.instance.emit(ZCGameUiEvent.Retreat);
        await flush();   // 两次确认走完之后才上报
        assert.equal(h.requests.length, 1);
        const commands = h.requests[0].commands;
        assert.deepEqual(commands[0], { frameId: 0, unitId: 81, op: 1, params: [hex.id] });
        assert.ok(commands.some(event => event.unitId === 82 && event.op === 1));
        assert.ok(commands.some(event => event.unitId === 83 && event.op === 1));
        assert.ok(commands.every(event => [81, 82, 83].includes(event.unitId)));
    } finally { h.dispose(); }
});

test('spawn selection has no battle model, resolves once, then renders before regular ticks', () => {
    const h = runtimeFixture({}, true);
    try {
        assert.equal(h.session.currentPhase, 'spawn-selection');
        assert.equal(h.runtime.currentModel, null);
        EventMgr.instance.emit(ZCGameUiEvent.SpawnConfirm);
        EventMgr.instance.emit(ZC_BATTLE_EVENTS.FRAME, { owner: h.view, dt: 20 });
        h.finishShowcase();
        assert.equal(h.session.currentPhase, 'playing');
        assert.ok(h.runtime.currentModel);
        assert.equal(h.calls.filter(call => call === 'startPlaying').length, 1);
        EventMgr.instance.emit(ZCGameUiEvent.SpawnConfirm); h.finishShowcase();
        assert.equal(h.calls.filter(call => call === 'startPlaying').length, 1);
    } finally { h.dispose(); }
});
test('late result after disposal does not persist, load rewards or open popup', async () => {
    const pending = deferred<IZCChapterBattleOutcome | null>();
    const calls: string[] = [];
    const h = runtimeFixture({ waitResult: () => pending.promise, loadRewards: async () => { calls.push('rewards'); return []; } }, false, 1004);
    EventMgr.instance.emit(ZCGameUiEvent.Retreat); h.dispose();
    pending.resolve({ code: 1, goods: [], treasureId: 0 }); await flush();
    assert.deepEqual(calls, []); assert.equal(h.pages.length, 0);
});
test('late popup closes immediately and cancelled return reuses the original result', async () => {
    const pending = deferred<IZCBattlePopup | null>(), calls: string[] = [];
    const h = runtimeFixture({ open: () => pending.promise });
    EventMgr.instance.emit(ZCGameUiEvent.Retreat); await flush(); h.dispose();
    pending.resolve({ close: () => calls.push('closed') }); await flush();
    EventMgr.instance.emit(ZCGameUiEvent.SettlementConfirm);
    assert.deepEqual(calls, ['closed']); assert.equal(h.calls.includes('navigate'), false);
});
test('SLG awaits its own result before report and uses server defeat and war score', async () => {
    for (const type of [1003, 1004] as const) {
        const pending = deferred<IZCChapterBattleOutcome | null>();
        const h = runtimeFixture({ waitResult: battleType => { h.calls.push(`wait:${battleType}`); return pending.promise; } }, false, type);
        try {
            EventMgr.instance.emit(ZCGameUiEvent.Retreat);
            await flush();   // 两次确认之后才开始等广播
            assert.ok(h.calls.indexOf(`wait:${type}`) < h.calls.indexOf('finish'));
            pending.resolve({ code: 2, goods: [], treasureId: 0, warScore: 27 }); await flush();
            assert.equal((h.pages[0] as { victory: boolean }).victory, false);
            assert.equal((h.pages[0] as { scoreText: string }).scoreText, '27');
        } finally { h.dispose(); }
    }
});

test('exiting during reward loading prevents a late settlement popup', async () => {
    const rewards = deferred<[]>();
    const h = runtimeFixture({ waitResult: async () => ({ code: 1, goods: [], treasureId: 0 }), loadRewards: () => rewards.promise }, false, 1004);
    EventMgr.instance.emit(ZCGameUiEvent.Retreat); await flush();
    h.dispose(); rewards.resolve([]); await flush();
    assert.equal(h.pages.length, 0);
    assert.equal(h.calls.filter(call => call === 'cancel').length, 1);
});

test('settlement reports request and popup failures without opening twice', async () => {
    const h = runtimeFixture({
        finish: async () => { throw new Error('report failed'); },
        open: async () => { throw new Error('popup failed'); },
    });
    try {
        EventMgr.instance.emit(ZCGameUiEvent.Retreat); await flush();
        EventMgr.instance.emit(ZCGameUiEvent.Retreat); await flush();
        assert.equal(h.calls.filter(call => call === 'failed').length, 2);
    } finally { h.dispose(); }
});

test('exiting selection cancels its showcase timer and ignores a late timer callback', () => {
    let callback = () => {}, cancellations = 0;
    const h = runtimeFixture({}, true, undefined, {
        schedule: next => { callback = next; return () => { cancellations++; }; },
    });
    EventMgr.instance.emit(ZC_BATTLE_EVENTS.FRAME, { owner: h.view, dt: 20 });
    h.dispose(); callback();
    assert.equal(cancellations, 1);
    assert.equal(h.runtime.currentModel, null);
    assert.equal(h.calls.includes('startPlaying'), false);
});

test('runtime disposal closes settlement and auxiliary popups even if request cancellation throws', async () => {
    const calls: string[] = [];
    const failure = new Error('cancel failed');
    const h = runtimeFixture({
        cancelRequests: () => { calls.push('cancel'); throw failure; },
        open: async () => ({ close: () => calls.push('settlementClose') }),
    }, false, undefined, {
        openGuide: async () => ({ close: () => calls.push('guideClose') }),
        openRank: async () => ({ close: () => calls.push('rankClose') }),
    });
    h.runtime.scope.defer(() => calls.push('runtimeRelease'));
    EventMgr.instance.emit(ZCGameUiEvent.OpenGuide);
    EventMgr.instance.emit(ZCGameUiEvent.OpenRank);
    EventMgr.instance.emit(ZCGameUiEvent.Retreat);
    await flush();
    try {
        assert.throws(() => h.runtime.dispose(), error => error === failure);
        assert.deepEqual(calls, ['cancel', 'settlementClose', 'rankClose', 'guideClose', 'runtimeRelease']);
        assert.equal(h.runtime.currentModel, null);
        assert.equal(h.settlement.scope.disposed, true);
        h.runtime.dispose();
        assert.equal(calls.filter(call => call === 'cancel').length, 1);
    } finally { h.dispose(); }
});

test('one auxiliary popup close failure does not retain other popups or runtime resources', async () => {
    const calls: string[] = [];
    const failure = new Error('popup close failed');
    const h = runtimeFixture({}, false, undefined, {
        openRank: async () => ({ close: () => { calls.push('rankClose'); throw failure; } }),
        openGuide: async () => ({ close: () => calls.push('guideClose') }),
    });
    h.runtime.scope.defer(() => calls.push('release'));
    EventMgr.instance.emit(ZCGameUiEvent.OpenRank);
    EventMgr.instance.emit(ZCGameUiEvent.OpenGuide);
    await flush();
    try {
        assert.throws(() => h.runtime.dispose(), error => error === failure);
        assert.deepEqual(calls, ['rankClose', 'guideClose', 'release']);
        assert.equal(h.runtime.currentModel, null);
    } finally { h.dispose(); }
});

test('runtime publishes return and tip notifications with the real view owner', async t => {
    const h = runtimeFixture();
    const notifications: unknown[] = [], target = {};
    t.after(() => { EventMgr.instance.offTarget(target); h.dispose(); });
    EventMgr.instance.on(ZC_BATTLE_EVENTS.SHOW_TIP, event => notifications.push(event), target);
    EventMgr.instance.on(ZC_BATTLE_EVENTS.RETURN_TO_MAIN, event => notifications.push(event), target);
    h.runtime.currentModel.useArtifact = () => ({ ok: true, message: 'artifact tip' });
    EventMgr.instance.emit(ZCGameUiEvent.UseArtifact);
    EventMgr.instance.emit(ZCGameUiEvent.ReturnToMain);
    assert.deepEqual(notifications, [{ owner: h.view, message: 'artifact tip' }, { owner: h.view }]);
    h.dispose();
    EventMgr.instance.emit(ZCGameUiEvent.ReturnToMain);
    assert.equal(notifications.length, 2);
});

test('≥3 人局结算先弹排行榜，关掉之后才出奖励页；2 人局不弹', async () => {
    const rankOpens: number[] = [];
    let resolveClosed: () => void = () => {};
    const whenClosed = new Promise<void>(resolve => { resolveClosed = resolve; });
    const h = runtimeFixture({
        openRank: async seats => { rankOpens.push(seats.length); return { close() {}, whenClosed }; },
    });
    try {
        // standard_3 是三人图；这里显式钉住席位，免得换地图后用例失效。
        Object.defineProperty(h.runtime.currentModel, 'owners', { get: () => ['player', 'enemy', 'enemy2'] });
        EventMgr.instance.emit(ZCGameUiEvent.Retreat);
        await flush();
        assert.deepEqual(rankOpens, [3], '≥3 人局必须先弹排行榜');
        assert.equal(h.pages.length, 0, '排行榜没关之前不能弹结算页（否则两页叠在一起）');
        assert.equal(h.calls.filter(call => call === 'finish').length, 1, '上报不受排行榜阻塞');
        resolveClosed();
        await flush();
        assert.equal(h.pages.length, 1, '玩家关掉排行榜后补上结算页');
    } finally { h.dispose(); }
});

test('2 人局不弹排行榜，直接结算', async () => {
    const rankOpens: number[] = [];
    const h = runtimeFixture({ openRank: async seats => { rankOpens.push(seats.length); return null; } });
    try {
        Object.defineProperty(h.runtime.currentModel, 'owners', { get: () => ['player', 'enemy'] });
        EventMgr.instance.emit(ZCGameUiEvent.Retreat);
        await flush();
        assert.deepEqual(rankOpens, [], '2 人局没有排行榜这一步');
        assert.equal(h.pages.length, 1);
    } finally { h.dispose(); }
});

test('排行榜还开着就退局：结算流程落定，不悬挂也不报错', async () => {
    let closes = 0;
    const h = runtimeFixture({
        // 永不 resolve 的 whenClosed：只有 dispose 能把它放出来，正好验关停信号。
        openRank: async () => ({ close() { closes += 1; }, whenClosed: new Promise<void>(() => {}) }),
    });
    Object.defineProperty(h.runtime.currentModel, 'owners', { get: () => ['player', 'enemy', 'enemy2'] });
    EventMgr.instance.emit(ZCGameUiEvent.Retreat);
    await flush();
    assert.equal(h.pages.length, 0);
    h.dispose();
    await flush();
    assert.ok(closes >= 1, '退局必须把排行榜关掉');
    assert.equal(h.calls.includes('failed'), false, '关停是正常路径，不能报失败');
});

test('投降只弹一个确认框，点一次确定就结算：取消不结算，确定按失败退', async () => {
    const asks: string[] = [], carryAgain: boolean[] = [];
    let answers: boolean[] = [];
    const h = runtimeFixture({}, false, undefined, {
        confirm: async options => {
            asks.push(options.content);
            carryAgain.push(Object.prototype.hasOwnProperty.call(options, 'confirmAgainText'));
            return { answered: Promise.resolve(answers.shift() ?? false), close() {} };
        },
    });
    try {
        answers = [false];
        EventMgr.instance.emit(ZCGameUiEvent.Retreat);
        await flush();
        assert.equal(asks.length, 1, '投降只开一个确认框');
        assert.equal(asks[0], '你确定放弃当前对局，提前退出嘛？', '文案是策划原文');
        assert.equal(carryAgain[0], false, '不再配置「再次确认」：点一次「确定」即确认');
        assert.equal(h.requests.length, 0, '取消不能结算');

        answers = [true];
        EventMgr.instance.emit(ZCGameUiEvent.Retreat);
        await flush();
        assert.equal(asks.length, 2, '每次投降只开一个确认框');
        assert.equal(h.requests.length, 1, '确认后上报一次');
        assert.equal(h.requests[0].localVictory, false, '投降按失败结算');
    } finally { h.dispose(); }
});

test('投降确认框还开着就退局：弹窗被关掉，也不会补一次结算', async () => {
    let closes = 0;
    let answer: (value: boolean) => void = () => {};
    const h = runtimeFixture({}, false, undefined, {
        // 模拟真实 CommonTips：`close()` 会走到 onClose ⇒ answered 兑现 false。
        confirm: async () => ({ answered: new Promise<boolean>(resolve => { answer = resolve; }), close() { closes += 1; answer(false); } }),
    });
    EventMgr.instance.emit(ZCGameUiEvent.Retreat);
    await flush();
    assert.equal(closes, 0, '确认框还开着，不该被提前关');
    assert.equal(h.requests.length, 0);
    h.dispose();
    await flush();
    assert.ok(closes >= 1, '退局必须把确认框关掉，不能留在别的界面上');
    assert.equal(h.requests.length, 0, '关窗口不等于确认，不能补结算');
});
