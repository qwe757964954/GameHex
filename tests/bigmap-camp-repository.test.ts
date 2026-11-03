import assert from 'node:assert/strict';
import test from 'node:test';
import { BigMapCampRepository, type IBigMapCampGateway } from '../assets/script/app/bigmap/application/BigMapCampRepository';
import { normalizeBigMapCampInfos } from '../assets/script/app/bigmap/model/BigMapCampInfo';
import { BigMapPresenter } from '../assets/script/app/bigmap/application/BigMapPresenter';
import { createMemoryBigMapStorage } from '../assets/script/app/bigmap/application/BigMapSaveKeys';
import { withBigMapCampCities, completeBigMapCampLayout } from '../assets/script/app/bigmap/model/BigMapCampWorld';
import { loadBigMapConfig, loadBigMapLayout } from './helpers/bigmap-fixtures';

function deferred() {
    let resolve: (value: unknown) => void = () => undefined;
    const promise = new Promise<unknown>((finish) => { resolve = finish; });
    return { promise, resolve };
}

function makeGateway() {
    const calls: { kind: string; ids: readonly number[] }[] = [];
    const roleCalls: number[] = [];
    const simple = deferred();
    const detail = deferred();
    const roles = deferred();
    const move = deferred();
    const moveCalls: { campId: number; pos: number; moveType: number }[] = [];
    const gateway: IBigMapCampGateway = {
        fetchSimple: (ids) => { calls.push({ kind: 'simple', ids }); return simple.promise; },
        fetchDetail: (ids) => { calls.push({ kind: 'detail', ids }); return detail.promise; },
        fetchRoles: (campId) => { roleCalls.push(campId); return roles.promise; },
        requestMove: (body) => { moveCalls.push({ ...body }); return move.promise; },
    };
    return { calls, roleCalls, moveCalls, simple, detail, roles, move, gateway };
}

test('回包只认 opType（旧 state 字段已废弃，不再参与校验），过滤脏条并按据点去重', () => {
    const blank = { occupyRoleId: '', occupyRoleName: '', detailed: false } as const;
    const valid = { campId: 101, opType: 1, ...blank };
    assert.deepEqual(normalizeBigMapCampInfos({ infos: [valid, valid,
        { campId: 102, opType: 0 }, { campId: 103 },
        { campId: 104, opType: 2 }, { campId: 105, opType: 1, state: 9 },
        { campId: '106', opType: 0 }, { campId: 0x100000000, opType: 0 }, null,
    ] }), [valid, { campId: 102, opType: 0, ...blank }, { campId: 105, opType: 1, ...blank }]);
    assert.equal(normalizeBigMapCampInfos(null), null);
    assert.equal(normalizeBigMapCampInfos({}), null);
    assert.deepEqual(normalizeBigMapCampInfos({ infos: [] }), []);
});

test('详情包解析占领者：uint64 走字符串，未占领时占领者字段一律清空', () => {
    const [taken] = normalizeBigMapCampInfos({ infos: [{
        campId: 101, opType: 1, occupyRoleId: { low: 1, high: 2 }, occupyRoleName: ' 甲玩家 ',
    }] }, true) ?? [];
    assert.deepEqual(taken, {
        campId: 101, opType: 1, occupyRoleId: '8589934593', occupyRoleName: '甲玩家', detailed: true,
    });
    const [free] = normalizeBigMapCampInfos({ infos: [{
        campId: 102, opType: 0, occupyRoleId: '777', occupyRoleName: '甲玩家',
    }] }, true) ?? [];
    assert.deepEqual(free, { campId: 102, opType: 0, occupyRoleId: '', occupyRoleName: '', detailed: true });
    // 简略包没有占领者字段：即使回包里带了也不能信（本包不负责这件事）。
    const [simple] = normalizeBigMapCampInfos({ infos: [{
        campId: 103, opType: 1, occupyRoleId: '777', occupyRoleName: '甲玩家',
    }] }) ?? [];
    assert.deepEqual(simple, { campId: 103, opType: 1, occupyRoleId: '', occupyRoleName: '', detailed: false });
});

test('可见据点去重排序，共享重复请求且不接收请求范围外的回包', async () => {
    const h = makeGateway();
    const repository = new BigMapCampRepository(h.gateway);
    const a = repository.refreshSimple([102, 101, 101, -1, NaN]);
    const b = repository.refreshSimple([101, 102]);
    assert.equal(a, b);
    assert.deepEqual(h.calls, [{ kind: 'simple', ids: [101, 102] }]);
    h.simple.resolve({ infos: [{ campId: 101, opType: 1 }, { campId: 999, opType: 0 }] });
    assert.equal(await a, true);
    assert.deepEqual(repository.get(101), {
        campId: 101, opType: 1, occupyRoleId: '', occupyRoleName: '', detailed: false,
    });
    assert.deepEqual(repository.occupiedCampIds(), [101], '已占据点供前置城池判定用');
    assert.equal(repository.get(999), null);
    assert.equal(await repository.refreshSimple([]), false);
    assert.equal(h.calls.length, 1);
});

test('详情查询仅发送点击据点，迟到的简略回包不能覆盖更新的详情', async () => {
    const h = makeGateway();
    const repository = new BigMapCampRepository(h.gateway);
    const simple = repository.refreshSimple([101]);
    const detail = repository.refreshDetail([101]);
    h.detail.resolve({ infos: [{ campId: 101, opType: 1, occupyRoleId: '777', occupyRoleName: '甲玩家' }] });
    assert.equal(await detail, true);
    h.simple.resolve({ infos: [{ campId: 101, opType: 0 }] });
    await simple;
    assert.deepEqual(repository.get(101), {
        campId: 101, opType: 1, occupyRoleId: '777', occupyRoleName: '甲玩家', detailed: true,
    });
    assert.deepEqual(h.calls[1], { kind: 'detail', ids: [101] });
});

test('缓存短期复用，过期后重新查询；详情不受简略缓存限制', async () => {
    let now = 0;
    let count = 0;
    const info = { campId: 101, opType: 0 };
    const repository = new BigMapCampRepository({
        fetchSimple: async () => { count += 1; return { infos: [info] }; },
        fetchDetail: async () => { count += 1; return { infos: [info] }; },
    }, () => now);
    await repository.refreshSimple([101]);
    assert.equal(await repository.refreshSimple([101]), false);
    assert.equal(count, 1);
    now = 5000;
    assert.equal(await repository.refreshSimple([101]), true);
    assert.equal(count, 2);
    assert.equal(await repository.refreshDetail([101]), true);
    assert.equal(count, 3);
});

test('后发简略先到时，合法详情不能被误报为请求失败', async () => {
    const h = makeGateway();
    const repository = new BigMapCampRepository(h.gateway);
    const detail = repository.refreshDetail([101]);
    const simple = repository.refreshSimple([101]);
    h.simple.resolve({ infos: [{ campId: 101, opType: 1 }] });
    assert.equal(await simple, true);
    h.detail.resolve({ infos: [{ campId: 101, opType: 0 }] });
    assert.equal(await detail, true);
    assert.deepEqual(repository.get(101), {
        campId: 101, opType: 1, occupyRoleId: '', occupyRoleName: '', detailed: false,
    });
});

test('空回包、缺失目标与失败不伪造未占领状态，失败后可重试', async () => {
    let fail = false;
    let response: unknown = { infos: [{ campId: 101, opType: 1 }] };
    const repository = new BigMapCampRepository({
        fetchSimple: async () => response,
        fetchDetail: async () => { if (fail) throw new Error('offline'); return response; },
    });
    await repository.refreshSimple([101]);
    fail = true;
    assert.equal(await repository.refreshDetail([101]), false);
    fail = false;
    response = { infos: [] };
    assert.equal(await repository.refreshDetail([101]), false);
    response = null;
    assert.equal(await repository.refreshDetail([101]), false);
    assert.equal(repository.get(101)?.opType, 1);
    response = { infos: [{ campId: 101, opType: 0 }] };
    assert.equal(await repository.refreshDetail([101]), true);
    assert.equal(repository.get(101)?.opType, 0);
});

test('关闭页面使在途回包失效，旧 Repository 不能继续发请求', async () => {
    const h = makeGateway();
    const repository = new BigMapCampRepository(h.gateway);
    const loading = repository.refreshDetail([101]);
    repository.dispose();
    h.detail.resolve({ infos: [{ campId: 101, opType: 1 }] });
    assert.equal(await loading, false);
    assert.equal(repository.get(101), null);
    assert.equal(await repository.refreshSimple([101]), false);
    assert.equal(h.calls.length, 1);
});

test('无响应请求五秒超时，迟到回包不能改缓存', async (context) => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const h = makeGateway();
    const repository = new BigMapCampRepository(h.gateway);
    const loading = repository.refreshDetail([101]);
    context.mock.timers.tick(5000);
    assert.equal(await loading, false);
    h.detail.resolve({ infos: [{ campId: 101, opType: 1 }] });
    await Promise.resolve();
    assert.equal(repository.get(101), null);
});

test('Presenter 以服务器状态展示据点，不改本地占领存档，也不执行本地攻城', async () => {
    const h = makeGateway();
    const repository = new BigMapCampRepository(h.gateway);
    const storage = createMemoryBigMapStorage();
    const presenter = new BigMapPresenter({ config: loadBigMapConfig(), storage, saveKey: 'server-camp',
        adventureChapter: () => 0, now: () => 957600, campRepository: repository });
    const original = storage.read('server-camp');
    const loading = presenter.refreshVisibleCamps([101, 999999]);
    h.simple.resolve({ infos: [{ campId: 101, opType: 0 }] });
    await loading;
    const view = presenter.cityView(101);
    assert.equal(view?.state, 'open', '服务端能把据点下发出来就说明已开放，未占领即可打');
    assert.equal(view?.campInfo?.opType, 0);
    assert.equal(view?.canAttack, false, '只有查询协议，不能模拟服务器攻城成功');
    assert.equal(presenter.attackCity(101).ok, false);
    assert.deepEqual(h.calls[0].ids, [101]);
    assert.equal(storage.read('server-camp'), original);
    assert.equal(presenter.battle.occupiedCityIds.length, 0);
    const detail = presenter.refreshCampDetail(101);
    assert.equal(presenter.cityView(101)?.campDetailStatus, 'loading');
    await presenter.refreshCampDetail(101);
    assert.equal(h.calls.length, 2, '重复点击不能再发一条详情');
    h.detail.resolve({ infos: [{ campId: 101, opType: 1, occupyRoleId: '888', occupyRoleName: '乙玩家' }] });
    await detail;
    assert.equal(presenter.cityView(101)?.campDetailStatus, 'ready');
    assert.deepEqual(presenter.cityView(101)?.campInfo, {
        campId: 101, opType: 1, occupyRoleId: '888', occupyRoleName: '乙玩家', detailed: true,
    });
    assert.equal(storage.read('server-camp'), original);
    presenter.dispose();
});

test('详情失败可以重新点选；切走页面后不通知视图', async () => {
    const h = makeGateway();
    const repository = new BigMapCampRepository(h.gateway);
    const presenter = new BigMapPresenter({ config: loadBigMapConfig(), storage: createMemoryBigMapStorage(),
        saveKey: 'server-camp-close', adventureChapter: () => 3, now: () => 957600, campRepository: repository });
    let notifications = 0;
    presenter.onChanged(() => { notifications += 1; });
    const detail = presenter.refreshCampDetail(101);
    h.detail.resolve(null);
    await detail;
    assert.equal(presenter.cityView(101)?.campDetailStatus, 'failed');
    assert.equal(notifications, 2);
    const retry = presenter.refreshCampDetail(101);
    presenter.dispose();
    const count = notifications;
    await retry;
    await presenter.refreshVisibleCamps([101]);
    assert.equal(notifications, count);
    assert.equal(h.calls.length, 2);
});

test('联机表 81 座据点全部可用：军团层不会被 available 判成「未开放」', async () => {
    // 夹具的 `loadBigMapConfig` 不经过 `withBigMapCampCities`，所以这个坑单测原本抓不到 ——
    // 必须在这里显式走一遍「解析 → 转成联机城池」，否则 `available: occupyType === 1`
    // 会把 58 座军团层据点全标成未开放（2026-10-30 线上反馈）。
    const config = withBigMapCampCities(loadBigMapConfig());
    assert.equal(config.cities.size, 81);
    let legion = 0;
    for (const city of config.cities.values()) {
        if (city.layer === 2) legion += 1;
        assert.equal(city.available, true, `${city.cityId}（layer=${city.layer}）不该被标成未开放`);
    }
    assert.ok(legion > 0, '军团层必须存在，否则这条用例覆盖不到反馈场景');

    const h = makeGateway();
    const repository = new BigMapCampRepository(h.gateway);
    // 顺带锁住「配置关层」的场景：把 101 的 `available` 打成 false，
    // 服务器仍下发了它 ⇒ 状态必须按 `opType` 走，不能被打回「未开放」。
    const closed = {
        ...config,
        cities: new Map([...config.cities].map(([id, city]) => [id,
            id === 101 ? { ...city, available: false } : city] as const)),
    };
    const presenter = new BigMapPresenter({ config: closed, storage: createMemoryBigMapStorage(),
        saveKey: 'camp-layer-state', adventureChapter: () => 1, now: () => 957600, campRepository: repository });
    const loading = presenter.refreshVisibleCamps([101, 102]);
    h.simple.resolve({ infos: [{ campId: 101, opType: 0 }, { campId: 102, opType: 1 }] });
    await loading;
    assert.equal(presenter.cityView(101)?.state, 'open', '服务器下发即已开放，不看配置的 available');
    assert.equal(presenter.cityView(102)?.state, 'occupied');
    presenter.dispose();
});

test('真实配置 + 真实布局下，点城池必须真的发出详情请求', async () => {
    const source = loadBigMapLayout('bigMap');
    const baseConfig = loadBigMapConfig();
    const config = withBigMapCampCities({ ...baseConfig,
        world: { ...baseConfig.world, rows: source.rows, cols: source.columns },
    });
    const layout = completeBigMapCampLayout(config, source);
    const called: string[] = [];
    const repository = new BigMapCampRepository({
        fetchSimple: async (ids) => { called.push(`simple:${ids.join(',')}`); return { infos: [] }; },
        fetchDetail: async (ids) => { called.push(`detail:${ids.join(',')}`); return { infos: [] }; },
        fetchRoles: async (campId) => ({ campId, infos: [] }),
        requestMove: async () => null,
    });
    const presenter = new BigMapPresenter({
        config, layout, storage: createMemoryBigMapStorage(), saveKey: 'camp-detail-wire',
        adventureChapter: () => 3, now: () => 957600, campRepository: repository,
    });
    assert.equal(presenter.world.cities.size, 81, '装配后世界必须按 campId 建出 81 座');
    assert.equal(presenter.world.cities.has(101), true);
    assert.equal(presenter.cityView(101)?.isServerCamp, true);
    await presenter.refreshCampDetail(101);
    assert.deepEqual(called.filter((item) => item === 'detail:101'), ['detail:101']);
    presenter.dispose();
});
