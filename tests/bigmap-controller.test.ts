import { createControllerContext } from './helpers/controller-context';
import assert from 'node:assert/strict';
import test from 'node:test';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { BigMapController, type IBigMapNetworkEvents } from '../assets/script/app/bigmap/application/BigMapController';
import { BigMapModel, type IBigMapActionFeedback } from '../assets/script/app/bigmap/application/BigMapModel';
import { BigMapCampRepository } from '../assets/script/app/bigmap/application/BigMapCampRepository';
import { BigMapUiEvent, BigMapViewEvent, type BigMapIntent } from '../assets/script/app/bigmap/application/BigMapEvents';
import type { IBigMapViewState } from '../assets/script/app/bigmap/application/BigMapViewState';
import { createMemoryBigMapStorage } from '../assets/script/app/bigmap/application/BigMapSaveKeys';
import { loadBigMapConfig } from './helpers/bigmap-fixtures';

const config = loadBigMapConfig();
class Network implements IBigMapNetworkEvents {
    handlers = new Map<string, { owner: object; callback: (message: unknown) => void }[]>();
    addEvent(name: string, owner: object, callback: (message: unknown) => void) {
        const list = this.handlers.get(name) ?? [];
        list.push({ owner, callback }); this.handlers.set(name, list);
    }
    removeCaller(owner: object) {
        for (const [key, list] of this.handlers) this.handlers.set(key, list.filter((item) => item.owner !== owner));
    }
    emit(name: string, message: unknown) {
        for (const item of this.handlers.get(name) ?? []) item.callback.call(item.owner, message);
    }
}
function create(campRepository?: BigMapCampRepository) {
    const model = new BigMapModel({ config, campRepository, storage: createMemoryBigMapStorage(), saveKey: 'mvc', now: () => 957600, adventureChapter: () => 3 });
    const network = new Network();
    let ticks = () => {};
    let stopped = 0;
    const controller = new BigMapController(model, { context: createControllerContext(), network, campRepository,
        schedule: (callback) => { ticks = callback; return () => { stopped++; ticks = () => {}; }; } });
    const snapshots: IBigMapViewState[] = [];
    const recorder = {};
    EventMgr.instance.on(BigMapViewEvent.Render, ({ state }: { state: IBigMapViewState }) => {
        snapshots.push(state);
    }, recorder);
    controller.start();
    return { model, network, controller, snapshots, tick: () => ticks(), stopped: () => stopped,
        intent: (intent: BigMapIntent) => EventMgr.instance.emit(BigMapUiEvent.Intent, { intent }),
        dispose: () => { controller.dispose(); EventMgr.instance.offTarget(recorder); } };
}

test('Controller 集中绑定一次、接收意图并发布纯展示快照，退出停止时钟和所有监听', () => {
    const h = create();
    try {
        h.controller.start();
        assert.equal([...h.network.handlers.values()].flat().length, 4);
        h.intent({ kind: 'mode', mode: 'base' });
        assert.equal(h.snapshots.at(-1)?.ui.mode, 'base');
        assert.equal('model' in h.snapshots.at(-1)!, false);
        assert.equal('requestBuild' in h.snapshots.at(-1)!, false);
        const count = h.snapshots.length;
        h.controller.dispose(); h.controller.dispose();
        h.tick(); h.intent({ kind: 'mode', mode: 'world' });
        assert.equal(h.snapshots.length, count);
        assert.equal(h.stopped(), 1);
        assert.equal([...h.network.handlers.values()].flat().length, 0);
    } finally { h.dispose(); }
});

test('意图派发中关闭控制器，当前派发中的旧意图监听也立即解除', () => {
    const closer = {};
    let close: () => void = () => {};
    EventMgr.instance.on(BigMapUiEvent.Intent, () => close(), closer);
    const h = create();
    close = () => h.controller.dispose();
    try {
        const count = h.snapshots.length;
        h.intent({ kind: 'mode', mode: 'base' });
        assert.equal(h.snapshots.length, count);
        assert.equal(h.controller.snapshot.ui.mode, 'world');
        assert.equal(h.stopped(), 1);
    } finally { h.dispose(); EventMgr.instance.offTarget(closer); }
});

test('点击联机城池同时查询详情与排行榜，不再跳过榜单请求', () => {
    const repository = new BigMapCampRepository({ fetchSimple: async () => null, fetchDetail: async () => null,
        fetchRoles: async () => null, requestMove: async () => null });
    const h = create(repository);
    const city = [...h.model.world.cities.values()][0];
    const details: number[] = [];
    const ranks: number[] = [];
    h.model.refreshCampDetail = async (id) => { details.push(id); };
    h.model.refreshCityRank = async (id) => { ranks.push(id); };
    try {
        h.intent({ kind: 'worldTap', hexId: city.anchorHexId });
        assert.deepEqual(details, [city.cityId]);
        assert.deepEqual(ranks, [city.cityId]);
    } finally { h.dispose(); }
});

test('驻守玩家入口可翻页，迁城先选格确认且拒绝城外位置与重复提交', async () => {
    const repository = new BigMapCampRepository({ fetchSimple: async () => null, fetchDetail: async () => null,
        fetchRoles: async () => null, requestMove: async () => null });
    const h = create(repository);
    const territory = h.model.territoryRegions()[0];
    const city = h.model.world.cities.get(territory.id);
    const moves: [number, number][] = [];
    let finish: (result: IBigMapActionFeedback) => void = () => {};
    h.model.requestMoveCamp = (campId, pos) => {
        moves.push([campId, pos]);
        return new Promise((resolve) => { finish = resolve; });
    };
    try {
        h.intent({ kind: 'worldTap', hexId: city.anchorHexId });
        h.intent({ kind: 'campRoles' });
        assert.equal(h.controller.snapshot.ui.campRolesVisible, true);
        h.intent({ kind: 'primary' });
        assert.equal(h.controller.snapshot.ui.pendingCampMoveId, territory.id);
        assert.deepEqual(moves, []);
        const outside = [...h.model.world.tileById.keys()].find((pos) => !territory.hexIds.includes(pos));
        h.intent({ kind: 'worldTap', hexId: outside });
        assert.equal(h.controller.snapshot.ui.selectedBaseHexId, -1);
        const pos = territory.hexIds[0];
        h.intent({ kind: 'worldTap', hexId: pos });
        assert.equal(h.controller.snapshot.ui.selectedBaseHexId, pos);
        h.intent({ kind: 'primary' });
        h.intent({ kind: 'primary' });
        assert.deepEqual(moves, [[territory.id, pos]]);
        finish({ ok: true, message: '' });
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(h.controller.snapshot.ui.pendingCampMoveId, 0);
    } finally { h.dispose(); }
});

test('可见据点主动补齐玩家名单，已有快照不跟着轮询重拉，出生广播补查未知据点且列表可循环查看', async () => {
    let queryCount = 0;
    let position = 0;
    const repository = new BigMapCampRepository({ fetchSimple: async () => ({ infos: [] }),
        fetchDetail: async () => ({ infos: [] }), requestMove: async () => null,
        fetchRoles: async (campId) => { queryCount++; return { campId, infos: [
            { roleId: '1', serverId: '2', roleName: '甲', img: '1', pos: position, defenseHp: 100 },
            { roleId: '2', serverId: '2', roleName: '乙', img: '2', pos: position + 1, defenseHp: 90 },
        ] }; } });
    const h = create(repository);
    const territory = h.model.territoryRegions()[0];
    position = territory.hexIds[0];
    try {
        h.network.emit('CmdSlgGameRoleInfoBroMsg', { eventType: 4,
            info: { roleId: '1', serverId: '2', roleName: '甲', img: '1', pos: position, defenseHp: 100 } });
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(queryCount, 1);
        assert.equal(repository.rolesOf(territory.id)?.length, 2);
        h.intent({ kind: 'worldTap', hexId: h.model.world.cities.get(territory.id).anchorHexId });
        h.intent({ kind: 'campRoles' });
        h.intent({ kind: 'secondary' });
        assert.equal(h.controller.snapshot.ui.campRoleIndex, 1);
        h.intent({ kind: 'secondary' });
        assert.equal(h.controller.snapshot.ui.campRoleIndex, 0);
        await new Promise((resolve) => setImmediate(resolve));
        const before = queryCount;
        // 已有快照的城不再跟着 5 秒轮询重拉（`CmdSlgCampRoleInfosReqMsg` 一次只能带一个 campId，
        // 每城每轮一条会把请求刷爆），但**新进视野**的城仍然主动补一次名单 —— 不是等用户点开才查。
        await h.model.refreshVisibleCamps([territory.id]);
        assert.equal(queryCount, before, '已有快照不重拉');
        const fresh = [...h.model.world.cities.keys()].find((id) => id !== territory.id);
        await h.model.refreshVisibleCamps([fresh]);
        assert.equal(queryCount, before + 1, '★新城进视野主动补齐名单');
    } finally { h.dispose(); }
});

test('首轮名单未返回时收到出生广播，旧包失效后必须补发名单查询', async () => {
    const pending: ((value: unknown) => void)[] = [];
    const repository = new BigMapCampRepository({ fetchSimple: async () => null,
        fetchDetail: async () => ({ infos: [] }), requestMove: async () => null,
        fetchRoles: () => new Promise((resolve) => pending.push(resolve)) });
    const h = create(repository);
    const territory = h.model.territoryRegions()[0];
    const info = { roleId: '1', serverId: '2', roleName: '新玩家', img: '1', pos: territory.hexIds[0], defenseHp: 100 };
    try {
        const first = h.model.refreshCampDetail(territory.id);
        assert.equal(pending.length, 1);
        h.network.emit('CmdSlgGameRoleInfoBroMsg', { eventType: 4, info });
        pending[0]({ campId: territory.id, infos: [] });
        await first;
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(pending.length, 2);
        pending[1]({ campId: territory.id, infos: [info] });
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(repository.rolesOf(territory.id)?.[0].roleName, '新玩家');
    } finally { h.dispose(); }
});

test('角色网络广播经 Controller 归一化、提交 Model 后以 Render 事件刷新详情，关闭后不再更新', async () => {
    let position = 0;
    const repository = new BigMapCampRepository({
        fetchSimple: async () => null, fetchDetail: async () => null, requestMove: async () => null,
        fetchRoles: async (campId) => ({ campId, infos: [{ roleId: '1', serverId: '2', roleName: 'player', img: '1', pos: position, defenseHp: 100 }] }),
    });
    const h = create(repository);
    const territory = h.model.territoryRegions()[0];
    position = territory.hexIds[0];
    try {
        await repository.refreshRoles(territory.id);
        h.network.emit('CmdSlgGameRoleInfoBroMsg', { eventType: 1, info: { roleId: '1', serverId: '2', roleName: 'player', pos: position, defenseHp: 30 } });
        assert.equal(repository.rolesOf(territory.id)?.[0].defenseHp, 30);
        assert.equal(h.snapshots.at(-1)?.cities.get(territory.id)?.campRoles[0].defenseHp, 30);
        const count = h.snapshots.length;
        h.network.emit('CmdSlgGameRoleInfoBroMsg', { eventType: 999, info: {} });
        assert.equal(h.snapshots.length, count);
        h.controller.dispose();
        h.network.emit('CmdSlgGameRoleInfoBroMsg', { eventType: 1, info: {} });
        assert.equal(h.snapshots.length, count);
    } finally { h.dispose(); }
});

test('写操作锁由 Controller 管理，重复点击不重复请求；失败后解锁，销毁后迟到结果不通知 View', async () => {
    const h = create();
    let finish!: (value: IBigMapActionFeedback) => void;
    let writes = 0;
    h.model.requestHarvestAll = () => { writes++; return new Promise((resolve) => { finish = resolve; }); };
    try {
        h.intent({ kind: 'harvestAll' }); h.intent({ kind: 'harvestAll' });
        assert.equal(writes, 1);
        assert.equal(h.snapshots.at(-1)?.ui.baseActionPending, true);
        finish({ ok: false, message: 'failed' });
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(h.snapshots.at(-1)?.ui.baseActionPending, false);
        h.intent({ kind: 'harvestAll' });
        assert.equal(writes, 2);
        h.controller.dispose();
        const count = h.snapshots.length;
        finish({ ok: true, message: 'late' });
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(h.snapshots.length, count);
    } finally { h.dispose(); }
});

test('可见据点轮询由 Controller 时钟驱动，基地模式不继续刷新世界据点', () => {
    const h = create();
    let polls = 0;
    h.model.refreshVisibleCamps = async () => { polls++; };
    try {
        const campId = h.model.territoryRegions()[0].id;
        h.intent({ kind: 'visibleCamps', campIds: [campId, campId] });
        assert.equal(polls, 1);
        h.tick(); assert.equal(polls, 1);
        h.intent({ kind: 'mode', mode: 'base' });
        h.intent({ kind: 'visibleCamps', campIds: [campId] });
        h.tick(); assert.equal(polls, 1);
    } finally { h.dispose(); }
});


test('镜头在同一批可见城池上反复上报时按 5 秒节流，只有新城池进视野才立即重发', () => {
    const h = create();
    let polls = 0;
    h.model.refreshVisibleCamps = async () => { polls++; };
    try {
        const all = [...h.model.world.cities.keys()];
        assert.ok(all.length >= 2, '夹具至少要有两座城才能区分「同集合」与「新增」');
        const ids = all.slice(0, all.length - 1);
        const extra = all[all.length - 1];
        h.intent({ kind: 'visibleCamps', campIds: ids });
        assert.equal(polls, 1);
        // 拖动/缩放：视图侧 150ms 防抖后又报同一批城，Controller 时钟没走 ⇒ 一条都不许再发
        //（以前这里是无条件刷新，等于每个可见城 ~150ms 一条 `CmdSlgCampRoleInfosReqMsg`）。
        h.intent({ kind: 'visibleCamps', campIds: ids });
        h.intent({ kind: 'visibleCamps', campIds: [...ids].reverse() });
        assert.equal(polls, 1, '同一批城重复上报不许重发');
        h.intent({ kind: 'visibleCamps', campIds: all });
        assert.equal(polls, 2, '新城进入视野立即刷新，不等满 5 秒');
    } finally { h.dispose(); }
});


test('可见城轮询只在首次补齐角色名单，拿到快照后不再跟着 5 秒轮询重拉', async () => {
    const roleCalls: number[] = [];
    const repository = new BigMapCampRepository({
        fetchSimple: async () => ({ infos: [] }),
        fetchDetail: async () => ({ infos: [] }),
        fetchRoles: async (campId: number) => { roleCalls.push(campId); return { campId, infos: [] }; },
        requestMove: async () => null,
    });
    const h = create(repository);
    const campId = [...h.model.world.cities.keys()][0];
    try {
        await h.model.refreshVisibleCamps([campId]);
        assert.deepEqual(roleCalls, [campId], '首次进视野补一次名单');
        await h.model.refreshVisibleCamps([campId]);
        await h.model.refreshVisibleCamps([campId]);
        assert.deepEqual(roleCalls, [campId], '★已有快照（哪怕是空名单）就不再重拉，靠广播维护');
    } finally { h.dispose(); }
});


test('关闭后重开只由新 Controller 接收事件，旧监听已解除', () => {
    const h = create();
    try {
        EventMgr.instance.emit(BigMapUiEvent.Disposed);
        assert.equal(h.stopped(), 1);
        assert.equal([...h.network.handlers.values()].flat().length, 0);
        const count = h.snapshots.length;
        h.tick(); h.intent({ kind: 'mode', mode: 'base' });
        assert.equal(h.snapshots.length, count);
        h.dispose();
        const next = create();
        try {
            next.intent({ kind: 'mode', mode: 'base' });
            assert.equal(next.snapshots.at(-1)?.ui.mode, 'base');
            assert.equal(h.snapshots.length, count);
        } finally { next.dispose(); }
    } finally { h.dispose(); }
});

test('选中世界目标由 Controller 查询详情，开战成功锁输入，预加载失败后可重试', async () => {
    const h = create();
    let queries = 0, attacks = 0;
    const city = [...h.model.world.cities.values()][0];
    const cityView = h.model.cityView(city.cityId);
    h.model.cityView = () => ({ ...cityView, isServerCamp: true });
    h.model.refreshCampDetail = async () => { queries++; };
    h.model.requestAttackCity = async () => { attacks++; return { ok: true, message: '' }; };
    try {
        h.intent({ kind: 'worldTap', hexId: city.anchorHexId });
        assert.equal(queries, 1);
        assert.equal(h.controller.snapshot.ui.selectedCityId, city.cityId);
        h.intent({ kind: 'primary' }); h.intent({ kind: 'primary' });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(attacks, 1);
        assert.equal(h.controller.snapshot.ui.enteringBattle, true);
        h.intent({ kind: 'mode', mode: 'base' });
        assert.equal(h.controller.snapshot.ui.mode, 'world');
        h.controller.cancelEnteringBattle();
        assert.equal(h.controller.snapshot.ui.enteringBattle, false);
        h.intent({ kind: 'primary' });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(attacks, 2);
    } finally { h.dispose(); }
});
