import assert from 'node:assert/strict';
import test from 'node:test';
import { BigMapCampRepository, type IBigMapCampGateway } from '../assets/script/app/bigmap/application/BigMapCampRepository';
import { normalizeBigMapCampInfos } from '../assets/script/app/bigmap/model/BigMapCampInfo';
import { BigMapPresenter } from '../assets/script/app/bigmap/application/BigMapPresenter';
import { createMemoryBigMapStorage } from '../assets/script/app/bigmap/application/BigMapSaveKeys';
import { loadBigMapConfig } from './helpers/bigmap-fixtures';

function deferred() {
    let resolve: (value: unknown) => void = () => undefined;
    const promise = new Promise<unknown>((finish) => { resolve = finish; });
    return { promise, resolve };
}

function makeGateway() {
    const calls: { kind: string; ids: readonly number[] }[] = [];
    const simple = deferred();
    const detail = deferred();
    const gateway: IBigMapCampGateway = {
        fetchSimple: (ids) => { calls.push({ kind: 'simple', ids }); return simple.promise; },
        fetchDetail: (ids) => { calls.push({ kind: 'detail', ids }); return detail.promise; },
    };
    return { calls, simple, detail, gateway };
}

test('回包保持占领状态与开放状态独立，过滤非法字段并按据点去重', () => {
    const valid = { campId: 101, opType: 1, state: 0 };
    assert.deepEqual(normalizeBigMapCampInfos({ infos: [valid, valid,
        { campId: 102, opType: 0, state: 3 }, { campId: 103, opType: 0 },
        { campId: 104, opType: 2, state: 1 }, { campId: 105, opType: 0, state: 4 },
        { campId: '106', opType: 0, state: 1 }, { campId: 0x100000000, opType: 0, state: 1 }, null,
    ] }), [valid, { campId: 102, opType: 0, state: 3 }]);
    assert.equal(normalizeBigMapCampInfos(null), null);
    assert.equal(normalizeBigMapCampInfos({}), null);
    assert.deepEqual(normalizeBigMapCampInfos({ infos: [] }), []);
});

test('可见据点去重排序，共享重复请求且不接收请求范围外的回包', async () => {
    const h = makeGateway();
    const repository = new BigMapCampRepository(h.gateway);
    const a = repository.refreshSimple([102, 101, 101, -1, NaN]);
    const b = repository.refreshSimple([101, 102]);
    assert.equal(a, b);
    assert.deepEqual(h.calls, [{ kind: 'simple', ids: [101, 102] }]);
    h.simple.resolve({ infos: [{ campId: 101, opType: 1, state: 2 }, { campId: 999, opType: 0, state: 0 }] });
    assert.equal(await a, true);
    assert.deepEqual(repository.get(101), { campId: 101, opType: 1, state: 2 });
    assert.equal(repository.get(999), null);
    assert.equal(await repository.refreshSimple([]), false);
    assert.equal(h.calls.length, 1);
});

test('详情查询仅发送点击据点，迟到的简略回包不能覆盖更新的详情', async () => {
    const h = makeGateway();
    const repository = new BigMapCampRepository(h.gateway);
    const simple = repository.refreshSimple([101]);
    const detail = repository.refreshDetail([101]);
    h.detail.resolve({ infos: [{ campId: 101, opType: 1, state: 3 }] });
    assert.equal(await detail, true);
    h.simple.resolve({ infos: [{ campId: 101, opType: 0, state: 1 }] });
    await simple;
    assert.deepEqual(repository.get(101), { campId: 101, opType: 1, state: 3 });
    assert.deepEqual(h.calls[1], { kind: 'detail', ids: [101] });
});

test('缓存短期复用，过期后重新查询；详情不受简略缓存限制', async () => {
    let now = 0;
    let count = 0;
    const info = { campId: 101, opType: 0, state: 1 };
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
    h.simple.resolve({ infos: [{ campId: 101, opType: 1, state: 3 }] });
    assert.equal(await simple, true);
    h.detail.resolve({ infos: [{ campId: 101, opType: 0, state: 1 }] });
    assert.equal(await detail, true);
    assert.deepEqual(repository.get(101), { campId: 101, opType: 1, state: 3 });
});

test('空回包、缺失目标与失败不伪造未占领状态，失败后可重试', async () => {
    let fail = false;
    let response: unknown = { infos: [{ campId: 101, opType: 1, state: 2 }] };
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
    response = { infos: [{ campId: 101, opType: 0, state: 1 }] };
    assert.equal(await repository.refreshDetail([101]), true);
    assert.equal(repository.get(101)?.opType, 0);
});

test('关闭页面使在途回包失效，旧 Repository 不能继续发请求', async () => {
    const h = makeGateway();
    const repository = new BigMapCampRepository(h.gateway);
    const loading = repository.refreshDetail([101]);
    repository.dispose();
    h.detail.resolve({ infos: [{ campId: 101, opType: 1, state: 2 }] });
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
    h.detail.resolve({ infos: [{ campId: 101, opType: 1, state: 2 }] });
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
    h.simple.resolve({ infos: [{ campId: 101, opType: 0, state: 2 }] });
    await loading;
    const view = presenter.cityView(101);
    assert.equal(view?.state, 'open', '服务端已开放，不能被本地章节条件盖回未解锁');
    assert.equal(view?.campInfo?.state, 2);
    assert.equal(view?.canAttack, false, '只有查询协议，不能模拟服务器攻城成功');
    assert.equal(presenter.attackCity(101).ok, false);
    assert.deepEqual(h.calls[0].ids, [101]);
    assert.equal(storage.read('server-camp'), original);
    assert.equal(presenter.battle.occupiedCityIds.length, 0);
    const detail = presenter.refreshCampDetail(101);
    assert.equal(presenter.cityView(101)?.campDetailStatus, 'loading');
    await presenter.refreshCampDetail(101);
    assert.equal(h.calls.length, 2, '重复点击不能再发一条详情');
    h.detail.resolve({ infos: [{ campId: 101, opType: 1, state: 0 }] });
    await detail;
    assert.equal(presenter.cityView(101)?.campDetailStatus, 'ready');
    assert.deepEqual(presenter.cityView(101)?.campInfo, { campId: 101, opType: 1, state: 0 });
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
