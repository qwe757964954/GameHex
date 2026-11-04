import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { StoreController } from '../assets/script/app/store/StoreController';
import { StoreEvent } from '../assets/script/app/store/StoreEvents';
import { RoleController } from '../assets/script/app/role/RoleController';
import { RoleEvent } from '../assets/script/app/role/RoleEvents';
import { LeagueTabController } from '../assets/script/app/league/LeagueTabController';
import { LeagueTabEvent } from '../assets/script/app/league/LeagueTabEvents';
import { CardLineupController } from '../assets/script/app/card/CardLineupController';
import { CardLineupEvent, CardLineupUiEvent } from '../assets/script/app/card/CardLineupEvents';
import type { CardLineupData } from '../assets/script/app/card/CardRepository';
import { createControllerContext } from './helpers/controller-context';

function deferred<T>() {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}
function lineupData(known: boolean): CardLineupData {
    return { deck: [], catalog: [], heroLevels: new Map(), heroLevelCaps: new Map(), heroListKnown: known,
        formationsKnown: known, bonuses: { activeBonds: [], unitHpMultiplier: 1, unitAttackMultiplier: 1,
            moveSpeedMultiplier: 1, towerAttackMultiplier: 1, incomeBonus: 0, spawnIntervalMultiplier: 1 } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('store routes only its own intents, prevents repeated purchases and detaches on exit', async () => {
    const owner = {}, gate = deferred<void>(); let actions = 0;
    const controller = new StoreController(createControllerContext(), owner, async () => { actions++; await gate.promise; }, assert.fail);
    controller.start();
    const action = { owner, kind: 'buyGoods', context: { section: 'goods', rowId: 1 } };
    EventMgr.instance.emit(StoreEvent.Action, { ...action, owner: {} });
    EventMgr.instance.emit(StoreEvent.Action, action); EventMgr.instance.emit(StoreEvent.Action, action);
    assert.equal(actions, 1);
    gate.resolve(); await tick();
    EventMgr.instance.emit(StoreEvent.Action, action); assert.equal(actions, 2);
    controller.dispose(); EventMgr.instance.emit(StoreEvent.Action, action); assert.equal(actions, 2);
});

test('role default loading does not override a bag chosen while loading; cancellation ignores stale render', async () => {
    const owner = {}, gate = deferred<number>(), shown: number[] = [], rendered: number[] = [];
    const controller = new RoleController(createControllerContext(), {
        owner,
        failed: assert.fail,
        repository: {
            load: () => gate.promise
        },
        view: {
            render: async value => { rendered.push(value); },
            selectBag: tab => shown.push(tab),
            showBag: async () => {}
        },
        popups: {
            openTalent() {}
        },
        feedback: {
            tip() {}
        },
    });
    controller.start(); const loading = controller.refresh();
    EventMgr.instance.emit(RoleEvent.Intent, { owner, kind: 'bag', tab: 2 });
    gate.resolve(12); await loading;
    assert.deepEqual(shown, [2]); assert.deepEqual(rendered, [12]);
    const late = controller.refresh(); controller.cancel(); await late;
    assert.deepEqual(rendered, [12]);
    controller.dispose(); EventMgr.instance.emit(RoleEvent.Intent, { owner, kind: 'bag', tab: 1 });
    assert.deepEqual(shown, [2]);
});

test('league join event rechecks membership for the matching container and ignores stale results', async () => {
    const owner = {}, requests: ReturnType<typeof deferred<{ joined: boolean }>>[] = [], shown: boolean[] = [];
    const controller = new LeagueTabController(createControllerContext(), {
        owner,
        failed: assert.fail,
        repository: {
            load: () => { const gate = deferred<{ joined: boolean }>(); requests.push(gate); return gate.promise; }
        },
        view: {
            showPage: joined => shown.push(joined)
        },
    });
    controller.start();
    EventMgr.instance.emit(LeagueTabEvent.Joined, { owner: {} }); assert.equal(requests.length, 1);
    EventMgr.instance.emit(LeagueTabEvent.Joined, { owner });
    requests[1].resolve({ joined: true }); await tick();
    requests[0].resolve({ joined: false }); await tick(); assert.deepEqual(shown, [true]);
    const late = controller.refresh(true); controller.dispose(); requests[2].resolve({ joined: false }); await late;
    assert.deepEqual(shown, [true]);
});

test('hero snapshot publishes before authority and only latest refresh survives; exit detaches business events', async () => {
    const owner = {}, requests: ReturnType<typeof deferred<CardLineupData>>[] = [], seen: CardLineupData[] = [];
    const snapshot = lineupData(false);
    const authority = lineupData(true);
    const observer = {};
    EventMgr.instance.on(CardLineupUiEvent.Render, event => { if (event.owner === owner) seen.push(event.data); }, observer);
    const controller = new CardLineupController(createControllerContext(), {
        owner,
        autoLoadDecks: true,
        fallbackLevel: 3,
        repository: { loadLineupSnapshot: () => snapshot, loadLineup: () => { const gate = deferred<CardLineupData>(); requests.push(gate); return gate.promise; } },
        failed: assert.fail,
        popups: {
            openEditor() {},
            openUpgrade() {}
        },
    });
    controller.start(); EventMgr.instance.emit(CardLineupEvent.DeckSaved);
    requests[1].resolve(authority); await tick(); requests[0].resolve(snapshot); await tick();
    assert.deepEqual(seen, [snapshot, authority]);
    controller.dispose(); EventMgr.instance.emit(CardLineupEvent.DeckSaved); assert.equal(requests.length, 2);
    EventMgr.instance.offTarget(observer);
});

test('hero upgrade immediately updates reopening level while authoritative refresh is pending', () => {
    const owner = {}, levels: number[] = [];
    const controller = new CardLineupController(createControllerContext(), {
        owner,
        autoLoadDecks: true,
        fallbackLevel: 3,
        repository: {
            loadLineupSnapshot: () => ({ ...lineupData(true), heroLevels: new Map([['101', 3]]) }),
            loadLineup: () => new Promise(() => {}),
        },
        failed: assert.fail,
        popups: {
            openEditor() {},
            openUpgrade: (_card, level) => levels.push(level)
        },
    });
    controller.start();
    EventMgr.instance.emit(CardLineupEvent.HeroUpgraded, { heroId: 101, level: 4 });
    EventMgr.instance.emit(CardLineupUiEvent.Intent, { owner, kind: 'upgrade', card: { id: '101' } });
    assert.deepEqual(levels, [4]);
    controller.dispose();
});
