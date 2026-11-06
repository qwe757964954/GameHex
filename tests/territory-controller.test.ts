import { createControllerContext } from './helpers/controller-context';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { formatHms } from '../assets/script/app/hang/HangTable';
import { TERRITORY_IDLE_REWARD_INTERVAL_MS } from '../assets/script/app/territory/model/TerritoryIdleReward';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { TerritoryController } from '../assets/script/app/territory/application/TerritoryController';
import type { TerritoryModel, TerritoryModelOutput, ITerritoryViewState } from '../assets/script/app/territory/application/TerritoryModel';
import { TerritoryUiEvent, TerritoryViewEvent } from '../assets/script/app/territory/application/TerritoryEvents';

function harness() {
    const calls: unknown[] = [];
    let output: (event: TerritoryModelOutput) => void = () => {};
    const model = {
        state: { ready: false, idleRewardStartedAt: null, idleRewardMaxHours: 8,
            map: null, progress: null, detail: {}, layout: {},
            wallet: { silver: 0, stamina: 0 } } as ITerritoryViewState,
        onOutput(listener: typeof output) { output = listener; return () => { calls.push('unsub'); output = () => {}; }; },
        start() { calls.push('start'); }, dispose() { calls.push('dispose'); },
        selectRandomResource(id: number) { calls.push(['random', id]); },
        selectSite(site: unknown) { calls.push(['site', site]); },
        closeDetail() { calls.push('close'); }, requestBattle() { calls.push('battle'); },
        fastTick(now: number) { calls.push(['fast', now]); }, slowTick(now: number) { calls.push(['slow', now]); },
        refreshWalletFromServer() { calls.push('wallet'); },
        applyPassCellsBro(chapter: number, ids: number[]) { calls.push(['pass', chapter, ids]); },
        applyCellInfoState(state: unknown) { calls.push(['cells', state]); },
        focusCurrentLevel() { return 7; },
        claimIdleRewards(now: number) { calls.push(['claimIdleRewards', now]); },
    };
    const listeners = new Map<string, { caller: object; handler: (msg: unknown) => void }>();
    let cache: (() => void) | null = null;
    const timers: Array<{ callback: () => void; seconds: number }> = [];
    const controller = new TerritoryController(() => model as unknown as TerritoryModel, { context: createControllerContext(),
        network: {
            addEvent(name, caller, handler) { listeners.set(name, { caller, handler }); },
            removeCaller() { calls.push('removeCaller'); listeners.clear(); },
        },
        roleCache: { subscribe(callback) { cache = callback; return () => { calls.push('uncache'); cache = null; }; } },
        cells: { readPassCellsBro: () => ({ levelChapter: 2, cellIds: [10] }), readCellInfo: () => null },
        schedule(callback, seconds) { const timer = { callback, seconds }; timers.push(timer); return () => { calls.push(['stop', seconds]); timer.callback = () => {}; }; },
        now: () => 42,
    });
    return { model, controller, calls, listeners, timers, emit: (event: TerritoryModelOutput) => output(event), cache: () => cache?.() };
}

test('征收意图只交给当前控制器，并使用控制器时钟', () => {
    const h = harness();
    h.controller.start();
    EventMgr.instance.emit(TerritoryUiEvent.Intent, { intent: { kind: 'claimIdleRewards' } });
    assert.deepEqual(h.calls.at(-1), ['claimIdleRewards', 42]);
    h.controller.dispose();
    const count = h.calls.length;
    EventMgr.instance.emit(TerritoryUiEvent.Intent, { intent: { kind: 'claimIdleRewards' } });
    assert.equal(h.calls.length, count);
});

test('真实金币车组件无旧主线数据也保持可见，点击派发征收并随销毁退订', () => {
    const h = harness();
    let click = () => {};
    const button = { interactable: true, node: {
        on(_event: string, handler: () => void, owner: object) { click = () => handler.call(owner); },
    } };
    const node = { active: false, getComponent: () => button };
    const label = { string: '' };
    interface IEntryProbe {
        node: typeof node;
        timeLabel: typeof label;
        shakeNode: { isValid: boolean };
        onLoad(): void;
        onDestroy(): void;
    }
    const exports: { HangEntryButton?: new () => IEntryProbe } = {};
    const imports: Record<string, unknown> = {
        cc: {
            Component: class { schedule() {} unschedule() {} unscheduleAllCallbacks() {} },
            Button: { EventType: { CLICK: 'click' } },
            _decorator: { ccclass: () => (type: unknown) => type, property: () => () => {} },
        },
        '../../framework/event/EventMgr': { EventMgr },
        '../territory/application/TerritoryEvents': { TerritoryUiEvent, TerritoryViewEvent },
        '../territory/model/TerritoryIdleReward': { TERRITORY_IDLE_REWARD_INTERVAL_MS },
        './HangTable': { formatHms },
    };
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/hang/HangEntryButton.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText, { exports, require: (id: string) => imports[id], Date });
    const entry = new exports.HangEntryButton();
    Object.assign(entry, { node, timeLabel: label, shakeNode: { isValid: false } });
    try {
        h.controller.start();
        entry.onLoad();
        assert.equal(node.active, true);
        assert.equal(button.interactable, false);
        EventMgr.instance.emit(TerritoryViewEvent.Render, { state: {
            ready: true, idleRewardStartedAt: Date.now() - 30 * 60 * 1000, idleRewardMaxHours: 8,
        } });
        assert.equal(node.active, true);
        assert.equal(button.interactable, true);
        assert.equal(label.string, '00:30:00');
        click();
        assert.deepEqual(h.calls.at(-1), ['claimIdleRewards', 42]);
    } finally { entry.onDestroy(); h.controller.dispose(); }
    EventMgr.instance.emit(TerritoryViewEvent.Render, { state: {
        ready: false, idleRewardStartedAt: null, idleRewardMaxHours: 8,
    } });
    assert.equal(button.interactable, true, '销毁后不再接收领地渲染');
});

test('closing and reopening routes ordinary intents only to the active controller', () => {
    const a = harness(), b = harness();
    try {
        a.controller.start();
        EventMgr.instance.emit(TerritoryUiEvent.Intent, { intent: { kind: 'randomTap', cellId: 10 } });
        assert.deepEqual(a.calls.at(-1), ['random', 10]);
        EventMgr.instance.emit(TerritoryUiEvent.Disposed);
        const before = a.calls.length;
        b.controller.start();
        EventMgr.instance.emit(TerritoryUiEvent.Intent, { intent: { kind: 'randomTap', cellId: 11 } });
        assert.equal(a.calls.length, before);
        assert.deepEqual(b.calls.at(-1), ['random', 11]);
        assert.equal(b.calls.filter(c => Array.isArray(c) && c[0] === 'random').length, 1);
    } finally { a.controller.dispose(); b.controller.dispose(); }
});

test('controller owns network/cache and clocks; disposal releases them exactly once', () => {
    const h = harness();
    h.controller.start(); h.controller.start();
    assert.equal(h.calls.filter(c => c === 'start').length, 1);
    assert.deepEqual([...h.listeners.keys()].sort(), ['CmdCityChapterCellInfoRspMsg', 'CmdCityChapterPassCellBroMsg']);
    const listener = h.listeners.get('CmdCityChapterPassCellBroMsg')!;
    listener.handler.call(listener.caller, {});
    assert.deepEqual(h.calls[h.calls.length - 1], ['pass', 2, [10]]);
    h.cache(); assert.equal(h.calls[h.calls.length - 1], 'wallet');
    h.model.state = { ...h.model.state, ready: true };
    h.emit({ kind: 'changed' });
    assert.deepEqual(h.timers.map(t => t.seconds), [1, 60]);
    h.timers.forEach(t => t.callback());
    assert.deepEqual(h.calls.slice(-2), [['fast', 42], ['slow', 42]]);
    h.controller.dispose(); h.controller.dispose();
    assert.equal(h.calls.filter(c => c === 'dispose').length, 1);
    assert.equal(h.calls.filter(c => c === 'removeCaller').length, 1);
    assert.equal(h.calls.filter(c => c === 'uncache').length, 1);
    const before = h.calls.length;
    assert.equal(h.listeners.size, 0);
    h.cache();
    h.timers.forEach(t => t.callback());
    EventMgr.instance.emit(TerritoryUiEvent.Intent, { intent: { kind: 'battle' } });
    assert.equal(h.calls.length, before);
});


test('disposal balances busy feedback once and drops late model outputs', () => {
    const h = harness(), owner = {};
    const busy: boolean[] = [];
    EventMgr.instance.on(TerritoryViewEvent.Command, (event: { command: TerritoryModelOutput }) => {
        if (event.command.kind === 'busy') busy.push(event.command.payload.busy);
    }, owner);
    h.model.dispose = () => { h.calls.push('dispose'); h.emit({ kind: 'busy', payload: { busy: false } }); };
    try {
        h.controller.start();
        h.emit({ kind: 'busy', payload: { busy: true } });
        assert.deepEqual(busy, [true]);
        EventMgr.instance.emit(TerritoryUiEvent.Disposed);
        h.controller.dispose();
        h.emit({ kind: 'busy', payload: { busy: false } });
        assert.deepEqual(busy, [true, false]);
    } finally { h.controller.dispose(); EventMgr.instance.offTarget(owner); }
});
