import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { MainTabController } from '../assets/script/app/main/MainTabController';
import { MainTab } from '../assets/script/app/main/MainTabModel';
import { MAIN_PAGES_BUNDLE } from '../assets/script/core/asset/BundleCatalog';
import { createControllerContext } from './helpers/controller-context';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { MainTabEvent, type MainTabOutput } from '../assets/script/app/main/MainTabEvents';

function harness() {
    const context = createControllerContext();
    const requests: { path: string; bundle?: string; resolve(value: object): void; reject(error: Error): void; scope: { disposed: boolean } }[] = [];
    const shown: object[] = [], selected: number[] = [], reported: number[] = [];
    context.assets.load = (path, _type, options) => new Promise((resolve, reject) => {
        requests.push({ path, bundle: options?.bundle, resolve: value => resolve(value as InstanceType<typeof _type>), reject, scope: options.scope });
    });
    let overlay = false;
    const owner = {}, outputOwner = {};
    const controller = new MainTabController(context, {
        assetType: class {},
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
    EventMgr.instance.on(MainTabEvent.Output, (output: MainTabOutput<object>, source: object) => {
        if (source !== controller) return;
        if (output.kind === 'showPage') shown.push(output.page);
        else if (output.kind === 'renderNav') selected.push(output.tab);
    }, outputOwner);
    const originalDispose = controller.dispose.bind(controller);
    controller.dispose = () => {
        EventMgr.instance.offTarget(outputOwner);
        originalDispose();
    };
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

test('challenge and alliance stay locked; invalid targets do not cancel a valid load', async () => {
    const h = harness();
    const loading = h.controller.switchTab(MainTab.Territory);
    await h.controller.switchTab(MainTab.Challenge);
    await h.controller.switchTab(MainTab.Alliance);
    await h.controller.switchTab(99);
    assert.equal(h.requests.length, 1, '未开放 / 无效的页签不该发起资源加载');
    assert.equal(h.requests[0].scope.disposed, false);
    assert.deepEqual(h.reported, []);
    h.requests[0].resolve({}); await loading;
    EventMgr.instance.emit(MainTabEvent.Select, { tab: MainTab.World });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(h.reported, [6]); assert.deepEqual(h.selected, [3, 6]);
    h.controller.worldClosed(); assert.equal(h.selected[h.selected.length - 1], 3);
    h.controller.dispose();
    EventMgr.instance.emit(MainTabEvent.Select, { tab: MainTab.Shop });
    assert.deepEqual(h.reported, [6]);
});

test('role is unlocked and loads its own main-pages prefab', async () => {
    const h = harness();
    const role = h.controller.switchTab(MainTab.Role);
    assert.equal(h.requests.length, 1, '角色格解锁后必须真的发起页面加载');
    assert.equal(h.requests[0].path, 'ui/Role/Role');
    assert.equal(h.requests[0].bundle, MAIN_PAGES_BUNDLE);
    h.requests[0].resolve({}); await role;
    assert.equal(h.controller.snapshot.currentTab, MainTab.Role);
    h.controller.dispose();
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

test('world to role highlights the target while loading without flashing the retained tab', async () => {
    const h = harness();
    const first = h.controller.switchTab(MainTab.Territory);
    h.requests[0].resolve({ name: 'territory' });
    await first;
    await h.controller.switchTab(MainTab.World);
    h.selected.length = 0;

    const role = h.controller.switchTab(MainTab.Role);
    h.controller.worldClosed();
    assert.deepEqual(h.selected, [MainTab.Role]);
    assert.equal(h.controller.snapshot.currentTab, MainTab.Territory);
    h.requests[1].resolve({ name: 'role' });
    await role;
    assert.deepEqual(h.selected, [MainTab.Role, MainTab.Role]);
    assert.equal(h.controller.snapshot.currentTab, MainTab.Role);
    h.controller.dispose();
});

test('failed world to role restores the retained tab only after failure', async () => {
    const h = harness();
    const first = h.controller.switchTab(MainTab.Territory);
    h.requests[0].resolve({});
    await first;
    await h.controller.switchTab(MainTab.World);
    h.selected.length = 0;

    const role = h.controller.switchTab(MainTab.Role);
    assert.deepEqual(h.selected, [MainTab.Role]);
    h.requests[1].reject(new Error('offline'));
    await role;
    assert.deepEqual(h.selected, [MainTab.Role, MainTab.Territory]);
    assert.equal(h.controller.snapshot.currentTab, MainTab.Territory);
    h.controller.dispose();
});

test('stale tab failure does not overwrite the world highlight', async () => {
    const h = harness();
    const first = h.controller.switchTab(MainTab.Territory);
    h.requests[0].resolve({});
    await first;
    await h.controller.switchTab(MainTab.World);
    const role = h.controller.switchTab(MainTab.Role);
    await h.controller.switchTab(MainTab.World);
    h.selected.length = 0;

    h.requests[1].reject(new Error('offline'));
    await role;
    assert.deepEqual(h.selected, []);
    assert.equal(h.controller.snapshot.worldVisible, true);
    h.controller.dispose();
});
