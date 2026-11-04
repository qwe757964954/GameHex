import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { MainTabController } from '../assets/script/app/main/MainTabController';
import { MainTab } from '../assets/script/app/main/MainTabModel';
import { createControllerContext } from './helpers/controller-context';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { MainTabEvent } from '../assets/script/app/main/MainTabEvents';

function harness() {
    const context = createControllerContext();
    const requests: { resolve(value: object): void; reject(error: Error): void; scope: { disposed: boolean } }[] = [];
    const shown: object[] = [], selected: number[] = [], reported: number[] = [];
    context.assets.load = (_path, _type, options) => new Promise((resolve, reject) => {
        requests.push({ resolve: value => resolve(value as InstanceType<typeof _type>), reject, scope: options.scope });
    });
    let overlay = false;
    const owner = {};
    const controller = new MainTabController(context, {
        owner,
        assetType: class {},
        failed() {},
        view: {
            showPage: page => shown.push(page),
            renderNav: tab => selected.push(tab)
        },
        world: {
            openWorld: async () => { overlay = true; },
            closeWorld: () => { overlay = false; },
            isWorldOpen: () => overlay
        },
        warmup: {
            beforeSwitch() {},
            settled() {}
        },
        hero: {
            prefetchHero() {}
        },
        telemetry: {
            reportClick: tab => { reported.push(tab); }
        },
    });
    controller.start();
    return { controller, requests, shown, selected, reported, owner };
}

test('tab controller merges repeats, discards stale loads, preserves old page after failure', async () => {
    const h = harness();
    const a = h.controller.switchTab(MainTab.Shop), repeat = h.controller.switchTab(MainTab.Shop);
    const b = h.controller.switchTab(MainTab.Territory);
    assert.equal(h.requests.length, 2);
    assert.equal(h.requests[0].scope.disposed, true);
    h.requests[1].resolve({ name: 'territory' }); await b;
    h.requests[0].resolve({ name: 'shop' }); await Promise.all([a, repeat]);
    assert.deepEqual(h.shown, [{ name: 'territory' }]);
    const fail = h.controller.switchTab(MainTab.Hero);
    h.requests[2].reject(new Error('offline')); await fail;
    assert.equal(h.controller.snapshot.currentTab, MainTab.Territory);
    const late = h.controller.switchTab(MainTab.Shop);
    h.controller.dispose(); h.requests[3].resolve({}); await late;
    assert.equal(h.shown.length, 1);
    assert.equal(h.requests[1].scope.disposed, true);
});

test('locked tabs (challenge / role / alliance) issue no load; invalid targets do not cancel valid load', async () => {
    const h = harness();
    const loading = h.controller.switchTab(MainTab.Territory);
    await h.controller.switchTab(MainTab.Challenge);
    await h.controller.switchTab(MainTab.Role);
    await h.controller.switchTab(MainTab.Alliance);
    await h.controller.switchTab(99);
    assert.equal(h.requests.length, 1, '未开放 / 无效的页签不该发起资源加载');
    assert.equal(h.requests[0].scope.disposed, false);
    EventMgr.instance.emit(MainTabEvent.Select, { owner: {}, tab: MainTab.World });
    assert.deepEqual(h.reported, []);
    h.requests[0].resolve({}); await loading;
    EventMgr.instance.emit(MainTabEvent.Select, { owner: h.owner, tab: MainTab.World });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(h.reported, [6]); assert.deepEqual(h.selected, [3, 6]);
    h.controller.worldClosed(); assert.equal(h.selected[h.selected.length - 1], 3);
    h.controller.dispose();
    EventMgr.instance.emit(MainTabEvent.Select, { owner: h.owner, tab: MainTab.Shop });
    assert.deepEqual(h.reported, [6]);
});

test('closing world before a failed tab restores the retained page highlight', async () => {
    const h = harness();
    const first = h.controller.switchTab(MainTab.Territory); h.requests[0].resolve({}); await first;
    await h.controller.switchTab(MainTab.World);
    const failed = h.controller.switchTab(MainTab.Shop);
    h.requests[1].reject(new Error('offline')); await failed;
    assert.equal(h.controller.snapshot.currentTab, MainTab.Territory);
    assert.equal(h.selected[h.selected.length - 1], MainTab.Territory);
    h.controller.dispose();
});
