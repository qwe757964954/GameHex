import assert from 'node:assert/strict';
import test from 'node:test';
import { BigMapCampRepository, BIGMAP_CAMP_REFRESH_SECONDS, type IBigMapCampGateway } from '../assets/script/app/bigmap/application/BigMapCampRepository';
import { normalizeBigMapCampInfos } from '../assets/script/app/bigmap/model/BigMapCampInfo';
import { BigMapModel } from '../assets/script/app/bigmap/application/BigMapModel';
import { createMemoryBigMapStorage } from '../assets/script/app/bigmap/application/BigMapSaveKeys';
import { withBigMapCampCities, completeBigMapCampLayout } from '../assets/script/app/bigmap/model/BigMapCampWorld';
import { loadBigMapConfig, loadBigMapLayout } from './helpers/bigmap-fixtures';

test('迁城强制刷新等待旧查询结束并再查，旧名单不能作为迁城后的最终事实', async () => {
    const releases: ((value: unknown) => void)[] = [];
    const repository = new BigMapCampRepository({ fetchSimple: async () => null, fetchDetail: async () => null,
        requestMove: async () => null, fetchRoles: () => new Promise((resolve) => releases.push(resolve)) });
    const old = repository.refreshRoles(101);
    const fresh = repository.refreshRoles(101, true);
    assert.equal(releases.length, 1);
    releases[0]({ campId: 101, infos: [{ roleId: '1', serverId: '1', roleName: '旧角色', img: '1', pos: 1, defenseHp: 100 }] });
    assert.equal(await old, false);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(releases.length, 2);
    releases[1]({ campId: 101, infos: [] });
    assert.equal(await fresh, true);
    assert.deepEqual(repository.rolesOf(101), []);
    repository.dispose();
});

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

test('滑动产生重叠可见集合时，已在途据点不重复发送', async () => {
    const h = makeGateway();
    const repository = new BigMapCampRepository(h.gateway);
    const first = repository.refreshSimple([101, 102]);
    const next = repository.refreshSimple([102, 103]);
    assert.deepEqual(h.calls.map((call) => call.ids), [[101, 102], [103]]);
    h.simple.resolve({ infos: [101, 102, 103].map((campId) => ({ campId, opType: 0 })) });
    assert.deepEqual(await Promise.all([first, next]), [true, true]);
    repository.dispose();
});

test('可见区域整批刷新包含未过期缓存，重叠在途时不拆成剩余单个据点', async () => {
    let now = 0;
    const calls: number[][] = [];
    const response = deferred();
    const h = makeGateway();
    const repository = new BigMapCampRepository({ ...h.gateway,
        fetchSimple: async (ids) => {
            calls.push([...ids]);
            if (calls.length === 1) return { infos: [{ campId: 101, opType: 0 }] };
            return response.promise;
        },
    }, () => now);
    await repository.refreshSimple([101]);
    now = 100;
    const loading = repository.refreshSimple([101, 102], true);
    assert.deepEqual(calls, [[101], [101, 102]], '新缓存和未查询据点合为一个完整集合');
    assert.equal(await repository.refreshSimple([102, 103], true), false);
    assert.equal(calls.length, 2, '不拆出103单独发送');
    response.resolve({ infos: [101, 102, 103].map((campId) => ({ campId, opType: 0 })) });
    await loading;
    now = 5000;
    await repository.refreshSimple([102, 103], true);
    assert.deepEqual(calls[2], [102, 103], '下一轮仍发送完整可见集合');
    repository.dispose();
});

test('同一批可见据点反复上报时，整批刷新在新鲜窗口内不重发', async () => {
    let now = 0;
    const sent: number[][] = [];
    const repository = new BigMapCampRepository({
        fetchSimple: async (ids) => { sent.push([...ids]); return { infos: ids.map((campId) => ({ campId, opType: 0 })) }; },
        fetchDetail: async () => null,
        fetchRoles: async (campId) => ({ campId, infos: [] }),
        requestMove: async () => null,
    }, () => now);
    await repository.refreshSimple([304, 306, 505, 606, 706], true);
    assert.deepEqual(sent, [[304, 306, 505, 606, 706]], '首次整批查询');
    // 视图 150ms 防抖后又报同一批（裁剪边界上 marker 反复 active/inactive），Controller 再驱动一次整批刷新
    now = 300;
    assert.equal(await repository.refreshSimple([304, 306, 505, 606, 706], true), false);
    now = 1200;
    assert.equal(await repository.refreshSimple([606, 505, 304, 706, 306], true), false);
    assert.equal(sent.length, 1, '★ 全批仍在 5 秒新鲜窗口内，整批不重发');
    // 真有不新鲜的目标时才整批重发，且仍然一次发完整集合（不拆单城）
    now = 1500;
    await repository.refreshSimple([304, 306, 505, 606, 706, 707], true);
    assert.deepEqual(sent[1], [304, 306, 505, 606, 706, 707], '新城进入视野仍发完整集合');
    repository.dispose();
});

test('整批撞上在途被跳过时，在途落地后按最新可见集合补一次，新进视野的城不漏快照', async () => {
    const sent: number[][] = [];
    const first = deferred();
    let calls = 0;
    const repository = new BigMapCampRepository({
        fetchSimple: async (ids) => {
            sent.push([...ids]);
            calls += 1;
            return calls === 1 ? first.promise
                : { infos: ids.map((campId) => ({ campId, opType: campId === 101 ? 1 : 0 })) };
        },
        fetchDetail: async () => null,
        fetchRoles: async (campId) => ({ campId, infos: [] }),
        requestMove: async () => null,
    });
    const loading = repository.refreshSimple([101], true);
    // 拖动中新进视野 102：这一轮整批撞上在途，当场不发（不拆包），但必须登记补发
    assert.equal(await repository.refreshSimple([101, 102], true), false);
    assert.equal(repository.get(102), null, '此刻 102 还没有快照');
    first.resolve({ infos: [{ campId: 101, opType: 1 }] });
    await loading;
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(sent, [[101], [101, 102]], '★ 在途落地后按最新集合补一次');
    assert.equal(repository.get(102)?.opType, 0, '补发把漏掉的城补上，不留空状态');
    assert.equal(repository.get(101)?.opType, 1, '老城的快照不被补发覆盖成旧值');
    // 再补一次同批：全部新鲜 ⇒ 不再发
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(sent.length, 2);
    repository.dispose();
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

test('可见集合变化时只补新增/过期的据点，已缓存的城不跟着整批重发', async () => {
    let now = 0;
    const sent: number[][] = [];
    const repository = new BigMapCampRepository({
        fetchSimple: async (ids) => { sent.push([...ids]); return { infos: ids.map((campId) => ({ campId, opType: 0 })) }; },
        fetchDetail: async () => null,
    }, () => now);
    await repository.refreshSimple([110, 102]);
    assert.deepEqual(sent, [[102, 110]], '首次两座一起发');
    // 快速滑动滑进一座新城：只补 119，老的两座不再跟着重发
    await repository.refreshSimple([110, 102, 119]);
    assert.deepEqual(sent, [[102, 110], [119]], '★集合变化只发增量');
    assert.equal(await repository.refreshSimple([102, 110, 119]), false, '5 秒内同批不重发');
    assert.equal(sent.length, 2);
    now = 5000;
    await repository.refreshSimple([102, 110, 119]);
    assert.deepEqual(sent[2], [102, 110, 119], '全部过期后整批重查');
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
    const presenter = new BigMapModel({ config: loadBigMapConfig(), storage, saveKey: 'server-camp',
        adventureChapter: () => 0, now: () => 957600, campRepository: repository });
    const original = storage.read('server-camp');
    const loading = presenter.refreshVisibleCamps([101, 999999]);
    h.roles.resolve({ campId: 101, infos: [] });
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
    const presenter = new BigMapModel({ config: loadBigMapConfig(), storage: createMemoryBigMapStorage(),
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
    const presenter = new BigMapModel({ config: closed, storage: createMemoryBigMapStorage(),
        saveKey: 'camp-layer-state', adventureChapter: () => 1, now: () => 957600, campRepository: repository });
    const loading = presenter.refreshVisibleCamps([101, 102]);
    h.roles.resolve(null);
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
    const presenter = new BigMapModel({
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

test('视野补发名单：同城在新鲜窗口内只发一次，窗口过后可再拉，空名单也是有效事实', async () => {
    let clock = 0;
    const calls: number[] = [];
    const repository = new BigMapCampRepository({
        fetchSimple: async () => null, fetchDetail: async () => null, requestMove: async () => null,
        fetchRoles: async (campId) => { calls.push(campId); return { campId, infos: [] }; },
    }, () => clock);
    try {
        assert.equal(await repository.refreshRolesFor([101, 102]), true, '至少一条真的拿到包');
        assert.deepEqual(calls, [101, 102], '滑到两座城各发一条');
        assert.equal(await repository.refreshRolesFor([101, 102]), false);
        assert.deepEqual(calls, [101, 102], '★ 新鲜窗口内同一批城不重发（长拖不刷屏）');
        clock = BIGMAP_CAMP_REFRESH_SECONDS * 1000;
        assert.equal(await repository.refreshRolesFor([101]), true);
        assert.deepEqual(calls, [101, 102, 101], '窗口过后可再拉');
        assert.deepEqual(repository.rolesOf(102), [], '空名单=查过、确实没人');
    } finally { repository.dispose(); }
});

test('视野补发的名单失败不占新鲜窗口，下一次滑动还能补上', async () => {
    let fail = true;
    const calls: number[] = [];
    const repository = new BigMapCampRepository({
        fetchSimple: async () => null, fetchDetail: async () => null, requestMove: async () => null,
        fetchRoles: async (campId) => { calls.push(campId); return fail ? null : { campId, infos: [] }; },
    }, () => 0);
    try {
        assert.equal(await repository.refreshRolesFor([101]), false);
        fail = false;
        assert.equal(await repository.refreshRolesFor([101]), true, '超时/坏包不能把这座城顶进「刚查过」');
        assert.equal(calls.length, 2);
    } finally { repository.dispose(); }
});

test('视野补发与点开城池共用同一把在途锁：同时触发只发一条', async () => {
    const pending: ((value: unknown) => void)[] = [];
    const calls: number[] = [];
    const repository = new BigMapCampRepository({
        fetchSimple: async () => null, fetchDetail: async () => null, requestMove: async () => null,
        fetchRoles: (campId) => { calls.push(campId); return new Promise((resolve) => { pending.push(resolve); }); },
    }, () => 0);
    try {
        const visible = repository.refreshRolesFor([101]);
        const opening = repository.refreshRoles(101);
        assert.deepEqual(calls, [101], '★ 拖动进视野的同时点开同一座城，只发一条');
        pending[0]({ campId: 101, infos: [] });
        assert.equal(await visible, true);
        assert.equal(await opening, true);
    } finally { repository.dispose(); }
});
