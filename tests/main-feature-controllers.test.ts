import { cardArtConfig } from './helpers/card-art-config';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { StoreController } from '../assets/script/app/store/StoreController';
import { StoreEvent, type StoreOutput } from '../assets/script/app/store/StoreEvents';
import { RoleController } from '../assets/script/app/role/RoleController';
import { RoleEvent, type RoleOutput } from '../assets/script/app/role/RoleEvents';
import { LeagueTabController } from '../assets/script/app/league/LeagueTabController';
import { LeagueTabEvent, type LeagueTabOutput } from '../assets/script/app/league/LeagueTabEvents';
import { CardLineupController } from '../assets/script/app/card/CardLineupController';
import { CardLineupEvent, CardLineupUiEvent, type CardLineupOutput } from '../assets/script/app/card/CardLineupEvents';
import type { CardLineupData } from '../assets/script/app/card/CardRepository';
import { createControllerContext } from './helpers/controller-context';

function deferred<T>() {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}
function lineupData(known: boolean): CardLineupData {
    return { art: cardArtConfig, deck: [], catalog: [], heroLevels: new Map(), heroLevelCaps: new Map(), heroListKnown: known,
        formationsKnown: known, bonuses: { activeBonds: [], unitHpMultiplier: 1, unitAttackMultiplier: 1,
            moveSpeedMultiplier: 1, towerAttackMultiplier: 1, incomeBonus: 0, spawnIntervalMultiplier: 1 } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('store routes only its own intents, prevents repeated purchases and detaches on exit', async () => {
    const owner = {}, observer = {}, gate = deferred<void>(); let actions = 0;
    const controller = new StoreController(createControllerContext(), {
        owner,
        action: async () => { actions++; await gate.promise; },
    });
    EventMgr.instance.on(StoreEvent.Output, (output: StoreOutput, source: object) => {
        if (source === controller && output.kind === 'failed') assert.fail(String(output.error));
    }, observer);
    try {
        controller.start();
        const action = { kind: 'buyGoods', context: { section: 'goods', rowId: 1 } };
        EventMgr.instance.emit(StoreEvent.Action, { ...action }, {});
        EventMgr.instance.emit(StoreEvent.Action, action, owner); EventMgr.instance.emit(StoreEvent.Action, action, owner);
        assert.equal(actions, 1);
        gate.resolve(); await tick();
        EventMgr.instance.emit(StoreEvent.Action, action, owner); assert.equal(actions, 2);
        controller.dispose(); EventMgr.instance.emit(StoreEvent.Action, action, owner); assert.equal(actions, 2);
    } finally { EventMgr.instance.offTarget(observer); controller.dispose(); }
});

test('role default loading does not override a bag chosen while loading; cancellation ignores stale render', async () => {
    const observer = {}, gate = deferred<number>(), shown: number[] = [], rendered: number[] = [];
    const controller = new RoleController(createControllerContext(), {
        repository: {
            load: () => gate.promise
        },
    });
    EventMgr.instance.on(RoleEvent.Output, (output: RoleOutput<number>) => {
        if (output.kind === 'render') rendered.push(output.snapshot);
        else if (output.kind === 'selectBag') shown.push(output.tab);
        else if (output.kind === 'failed') assert.fail(String(output.error));
    }, observer);
    try {
        controller.start(); const loading = controller.refresh();
        EventMgr.instance.emit(RoleEvent.Intent, { kind: 'bag', tab: 2 });
        gate.resolve(12); await loading;
        assert.deepEqual(shown, [2]); assert.deepEqual(rendered, [12]);
        const late = controller.refresh(); controller.cancel(); await late;
        assert.deepEqual(rendered, [12]);
        controller.dispose(); EventMgr.instance.emit(RoleEvent.Intent, { kind: 'bag', tab: 1 });
        assert.deepEqual(shown, [2]);
    } finally { EventMgr.instance.offTarget(observer); controller.dispose(); }
});

test('league join event rechecks membership for the active container and ignores stale results', async () => {
    const observer = {}, requests: ReturnType<typeof deferred<{ joined: boolean }>>[] = [], shown: boolean[] = [];
    const controller = new LeagueTabController(createControllerContext(), {
        repository: {
            load: () => { const gate = deferred<{ joined: boolean }>(); requests.push(gate); return gate.promise; }
        },
    });
    EventMgr.instance.on(LeagueTabEvent.Output, (output: LeagueTabOutput, source: object) => {
        if (source !== controller) return;
        if (output.kind === 'page') shown.push(output.joined);
        else if (output.kind === 'failed') assert.fail(String(output.error));
    }, observer);
    try {
        controller.start();
        assert.equal(requests.length, 1);
        EventMgr.instance.emit(LeagueTabEvent.Joined);
        assert.equal(requests.length, 2);
        requests[1].resolve({ joined: true }); await tick();
        requests[0].resolve({ joined: false }); await tick(); assert.deepEqual(shown, [true]);
        const late = controller.refresh(true); controller.dispose(); requests[2].resolve({ joined: false }); await late;
        assert.deepEqual(shown, [true]);
    } finally { EventMgr.instance.offTarget(observer); controller.dispose(); }
});

test('hero snapshot publishes before authority and only latest refresh survives; exit detaches business events', async () => {
    const requests: ReturnType<typeof deferred<CardLineupData>>[] = [], seen: CardLineupData[] = [];
    const snapshot = lineupData(false);
    const authority = lineupData(true);
    const observer = {};
    EventMgr.instance.on(CardLineupUiEvent.Render, event => { seen.push(event.data); }, observer);
    const controller = new CardLineupController(createControllerContext(), {
        autoLoadDecks: true,
        fallbackLevel: 3,
        repository: { loadArtConfig: async () => cardArtConfig, loadLineupSnapshot: () => snapshot, loadLineup: () => { const gate = deferred<CardLineupData>(); requests.push(gate); return gate.promise; } },
    });
    controller.start(); EventMgr.instance.emit(CardLineupEvent.DeckSaved);
    requests[1].resolve(authority); await tick(); requests[0].resolve(snapshot); await tick();
    assert.deepEqual(seen, [snapshot, authority]);
    controller.dispose(); EventMgr.instance.emit(CardLineupEvent.DeckSaved); assert.equal(requests.length, 2);
    EventMgr.instance.offTarget(observer);
});

test('hero upgrade immediately updates reopening level while authoritative refresh is pending', () => {
    const observer = {}, levels: number[] = [];
    const controller = new CardLineupController(createControllerContext(), {
        autoLoadDecks: true,
        fallbackLevel: 3,
        repository: {
            loadArtConfig: async () => cardArtConfig,
            loadLineupSnapshot: () => ({ ...lineupData(true), heroLevels: new Map([['101', 3]]) }),
            loadLineup: () => new Promise(() => {}),
        },
    });
    EventMgr.instance.on(CardLineupUiEvent.Output, (output: CardLineupOutput) => {
        if (output.kind === 'openUpgrade') levels.push(output.level);
    }, observer);
    try {
        controller.start();
        EventMgr.instance.emit(CardLineupEvent.HeroUpgraded, { heroId: 101, level: 4 });
        EventMgr.instance.emit(CardLineupUiEvent.Intent, { kind: 'upgrade', card: { id: '101' } });
        assert.deepEqual(levels, [4]);
    } finally { EventMgr.instance.offTarget(observer); controller.dispose(); }
});

test('冷配置就绪后先发布完整快照；迟到快照不能覆盖权威数据或已关闭页面', async () => {
    for (const order of ['snapshot', 'authority', 'dispose']) {
        const art = deferred<typeof cardArtConfig>(), live = deferred<CardLineupData>();
        const snapshot = lineupData(false), authority = lineupData(true);
        const observer = {}, seen: CardLineupData[] = [];
        let ready = false;
        EventMgr.instance.on(CardLineupUiEvent.Render, event => { seen.push(event.data); }, observer);
        const controller = new CardLineupController(createControllerContext(), {
            autoLoadDecks: true, fallbackLevel: 1,
            repository: {
                loadArtConfig: () => art.promise.then(value => { ready = true; return value; }),
                loadLineupSnapshot: () => ready ? snapshot : null,
                loadLineup: () => live.promise,
            },
        });
        try {
            controller.start();
            assert.equal(seen.length, 0);
            if (order === 'authority') { live.resolve(authority); await tick(); }
            if (order === 'dispose') controller.dispose();
            art.resolve(cardArtConfig); await tick();
            if (order === 'snapshot') {
                assert.deepEqual(seen, [snapshot]);
                live.resolve(authority); await tick();
                assert.deepEqual(seen, [snapshot, authority]);
            } else assert.deepEqual(seen, order === 'authority' ? [authority] : []);
        } finally { controller.dispose(); EventMgr.instance.offTarget(observer); }
    }
});
