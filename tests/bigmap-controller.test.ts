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

test('收取奖励输出展示命令；空奖励、失败和销毁后的迟到结果不展示', async () => {
    const h = create();
    const commands: unknown[] = [];
    const owner = {};
    EventMgr.instance.on(BigMapViewEvent.Command, ({ command }) => commands.push(command), owner);
    const rewards = [{ resId: 7, amount: 12 }];
    try {
        for (const result of [
            { ok: true, message: '', rewards },
            { ok: true, message: '', rewards: [] },
            { ok: false, message: '', rewards },
        ]) {
            h.model.requestHarvestAll = async () => result;
            h.intent({ kind: 'harvestAll' });
            await new Promise(resolve => setImmediate(resolve));
        }
        assert.deepEqual(commands, [{ kind: 'rewards', rewards }]);
        let finish!: (result: IBigMapActionFeedback) => void;
        h.model.requestHarvestAll = () => new Promise(resolve => { finish = resolve; });
        h.intent({ kind: 'harvestAll' });
        h.controller.dispose();
        finish({ ok: true, message: '', rewards });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(commands.length, 1);
    } finally {
        h.dispose();
        EventMgr.instance.offTarget(owner);
    }
});
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
    // 可见据点查询按 1s 限速（`BIGMAP_VISIBLE_REFRESH_INTERVAL_MS`），用例用可控时钟推进；
    // 不推进就等于「同一秒内的第二次上报只合并、不发」。
    let clock = 0;
    const controller = new BigMapController(model, { context: createControllerContext(), network, campRepository,
        now: () => clock,
        schedule: (callback) => { ticks = callback; return () => { stopped++; ticks = () => {}; }; } });
    const snapshots: IBigMapViewState[] = [];
    const recorder = {};
    EventMgr.instance.on(BigMapViewEvent.Render, ({ state }: { state: IBigMapViewState }) => {
        snapshots.push(state);
    }, recorder);
    controller.start();
    return { model, network, controller, snapshots, tick: () => ticks(), stopped: () => stopped,
        advance: (ms: number) => { clock += ms; },
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

test('出生广播补查未知据点且列表可循环查看，滑动时新城才补发名单', async () => {
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
        // 名单角色已经摆在地图上（每个玩家落自己那格），所以滑动时新城要补发名单；
        // 刚查过的那座城在新鲜窗口内不重发，打开城池也复用刚拉到的结果。
        await h.model.refreshVisibleCamps([territory.id]);
        assert.equal(queryCount, before, '窗口内不重发同一座城');
        const fresh = [...h.model.world.cities.keys()].find((id) => id !== territory.id);
        await h.model.refreshVisibleCamps([fresh]);
        assert.equal(queryCount, before + 1, '★ 滑动到新城补发 RoleInfos');
        await h.model.refreshVisibleCamps([fresh]);
        assert.equal(queryCount, before + 1, '反复上报同一批可见据点不重发');
        await h.model.refreshCampDetail(fresh);
        assert.equal(queryCount, before + 1, '打开城池复用预取到的名单');
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

test('按秒轮询已移除：只有新城进入视野才查一次，静止与基地模式都不再发请求', () => {
    const h = create();
    let polls = 0;
    const batches: number[][] = [];
    h.model.refreshVisibleCamps = async (ids) => { polls++; batches.push([...ids]); };
    try {
        const all = [...h.model.world.cities.keys()];
        assert.ok(all.length >= 2, '夹具至少要有两座城');
        const first = all.slice(0, all.length - 1);
        h.intent({ kind: 'visibleCamps', campIds: [...first, ...first] });
        assert.equal(polls, 0, '视野上报先合并，不立即发送');
        h.tick();
        assert.equal(polls, 1, '首次进入视野查一次完整快照');
        assert.deepEqual(batches[0], [...new Set(first)]);
        // 静止 150 秒（300 个 500ms 时钟）不允许再发任何一条 Req。
        for (let i = 0; i < 300; i++) h.tick();
        assert.equal(polls, 1, '静止期间不再周期轮询 Simple / RoleInfos');
        h.intent({ kind: 'visibleCamps', campIds: [...first].reverse() });
        h.tick();
        assert.equal(polls, 1, '同一集合反复上报不重发');
        h.advance(1000);
        h.intent({ kind: 'visibleCamps', campIds: all });
        h.tick();
        assert.equal(polls, 2, '新城进入视野才再查一次');
        assert.deepEqual(batches[1], all, '使用最新完整可见集合');
        // 基地模式暂停，但 pending 不丢：回到世界模式后合并补发。
        h.intent({ kind: 'visibleCamps', campIds: first });
        h.intent({ kind: 'mode', mode: 'base' });
        h.intent({ kind: 'visibleCamps', campIds: all });
        h.tick();
        assert.equal(polls, 2, '基地模式暂停可见区域查询');
        h.advance(1000);
        h.intent({ kind: 'mode', mode: 'world' });
        h.tick();
        assert.equal(polls, 3, '回到世界模式后补发合并的那一次');
    } finally { h.dispose(); }
});


test('快速滑动的多次视野上报合并到Controller时钟一次查询，使用最新可见集合', () => {
    const h = create();
    let polls = 0;
    const batches: number[][] = [];
    h.model.refreshVisibleCamps = async (ids) => { polls++; batches.push([...ids]); };
    try {
        const all = [...h.model.world.cities.keys()];
        assert.ok(all.length >= 2, '夹具至少要有两座城才能区分「同集合」与「新增」');
        const ids = all.slice(0, all.length - 1);
        const extra = all[all.length - 1];
        h.intent({ kind: 'visibleCamps', campIds: ids });
        h.tick();
        assert.equal(polls, 1);
        // 拖动/缩放：视图侧 150ms 防抖后又报同一批城，Controller 时钟没走 ⇒ 一条都不许再发
        //（以前这里是无条件刷新，等于每个可见城 ~150ms 一条 `CmdSlgCampRoleInfosReqMsg`）。
        h.intent({ kind: 'visibleCamps', campIds: ids });
        h.intent({ kind: 'visibleCamps', campIds: [...ids].reverse() });
        assert.equal(polls, 1, '同一批城重复上报不许重发');
        h.intent({ kind: 'visibleCamps', campIds: all });
        assert.equal(polls, 1, '新城进入视野先合并，不立即发送');
        h.intent({ kind: 'visibleCamps', campIds: [extra] });
        h.intent({ kind: 'visibleCamps', campIds: all });
        h.tick();
        assert.equal(polls, 1, '1s 限速窗口内只合并、不发请求');
        assert.deepEqual(batches.length, 1);
        h.advance(1000);
        h.tick();
        assert.equal(polls, 2, '限速窗口过去后补发合并的那一轮');
        assert.deepEqual(batches[1], all, '时钟统一发送最终可见集合');
    } finally { h.dispose(); }
});


test('Simple 请求按最新可见集合整批发送，静止不重发；新增城时才再发一次', async () => {
    let now = 0;
    const batches: number[][] = [];
    const repository = new BigMapCampRepository({
        fetchSimple: async (ids) => {
            batches.push([...ids]);
            return { infos: ids.map((campId) => ({ campId, opType: 0 })) };
        },
        fetchDetail: async () => ({ infos: [] }),
        fetchRoles: async (campId) => ({ campId, infos: [] }),
        requestMove: async () => null,
    }, () => now);
    const h = create(repository);
    const ids = [...h.model.world.cities.keys()].slice(0, 3);
    assert.ok(ids.length >= 3, '夹具至少三座城');
    try {
        await repository.refreshSimple([ids[0]]);
        batches.length = 0;
        h.intent({ kind: 'visibleCamps', campIds: ids.slice(0, 2) });
        h.tick();
        await new Promise((resolve) => setImmediate(resolve));
        assert.deepEqual(batches, [[ids[0], ids[1]].sort((a, b) => a - b)],
            '首查整批发送当前全部可见据点，不按缓存时间拆包');
        now = 60000;
        for (let i = 0; i < 20; i++) h.tick();
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(batches.length, 1, '去掉 5 秒轮询后静止期间零 Simple 请求');
        h.advance(1000);
        h.intent({ kind: 'visibleCamps', campIds: ids });
        h.tick();
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(batches.length, 2);
        assert.deepEqual(batches[1], [...ids].sort((a, b) => a - b), '新增城时用最新完整集合');
    } finally { h.dispose(); }
});

test('角色广播驱动增量更新，静止期间不再拉 RoleInfos / Simple', () => {
    const h = create();
    let polls = 0;
    const eventTypes: number[] = [];
    h.model.refreshVisibleCamps = async () => { polls++; };
    h.model.applyRoleEvent = (event) => { eventTypes.push(event.eventType); };
    try {
        const campId = h.model.territoryRegions()[0].id;
        h.intent({ kind: 'visibleCamps', campIds: [campId] });
        h.tick();
        assert.equal(polls, 1, '首次进视野查一次完整快照');
        for (let i = 0; i < 100; i++) {
            h.network.emit('CmdSlgGameRoleInfoBroMsg', {
                eventType: 1 + (i % 4),
                info: { roleId: '9001', serverId: '3001', roleName: '广播玩家', img: '2001',
                    defenseHp: 100, pos: 5, buildLevel: 1 },
            });
            h.tick();
        }
        assert.equal(eventTypes.length, 100, '攻击/复活/移动/出生四类事件都归一化并交给 Model');
        assert.deepEqual([...new Set(eventTypes)].sort(), [1, 2, 3, 4]);
        assert.equal(polls, 1, '广播期间零据点轮询请求');
    } finally { h.dispose(); }
});

test('视野刷新按城预取名单（窗口内不重发），打开城池复用缓存（空名单也算查过）', async () => {
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
        assert.deepEqual(roleCalls, [campId], '★ 滑动到这座据点就要发 CmdSlgCampRoleInfosReqMsg（地图按 pos 摆人）');
        await h.model.refreshVisibleCamps([campId]);
        assert.deepEqual(roleCalls, [campId], '同城在新鲜窗口内不重发');
        const opening = h.model.refreshCampDetail(campId);
        assert.equal(h.model.cityView(campId)?.campRolesStatus, 'ready', '预取过的城直接进 ready');
        await opening;
        assert.deepEqual(roleCalls, [campId], '打开城池复用刚拉到的名单');
        assert.equal(h.model.cityView(campId)?.campRolesStatus, 'ready');
        await h.model.refreshCampDetail(campId);
        assert.deepEqual(roleCalls, [campId], '空名单也缓存，再打开不重查');
    } finally { h.dispose(); }
});


test('名单失败后再打开可重试，重复打开共享在途查询，成功后直接展示缓存', async () => {
    let calls = 0;
    let complete: (value: unknown) => void = () => {};
    const repository = new BigMapCampRepository({
        fetchSimple: async () => ({ infos: [] }),
        fetchDetail: async () => ({ infos: [] }),
        fetchRoles: async () => {
            calls++;
            if (calls === 1) return null;
            return new Promise((resolve) => { complete = resolve; });
        },
        requestMove: async () => null,
    });
    const h = create(repository);
    const campId = [...h.model.world.cities.keys()][0];
    try {
        await h.model.refreshCampDetail(campId);
        assert.equal(calls, 1);
        assert.equal(repository.rolesOf(campId), null);
        assert.equal(h.model.cityView(campId)?.campRolesStatus, 'failed');
        const opening = h.model.refreshCampDetail(campId);
        const repeated = h.model.refreshCampDetail(campId);
        assert.equal(calls, 2, '重试后重复打开共享同一请求');
        complete({ campId, infos: [{ roleId: '1', serverId: '2', roleName: '甲', img: '1', pos: 0, defenseHp: 100 }] });
        await Promise.all([opening, repeated]);
        assert.equal(h.model.cityView(campId)?.campRoles[0].roleName, '甲');
        await h.model.refreshCampDetail(campId);
        assert.equal(calls, 2, '再次打开不重查名单');
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

test('切到基地只把镜头对准主城、不自动选中：首屏不被详情弹窗糊住', () => {
    const h = create();
    const recorder = {};
    const commands: { kind: string; hexId: number }[] = [];
    EventMgr.instance.on(BigMapViewEvent.Command, (event: { command: { kind: string; hexId: number } }) => {
        commands.push(event.command);
    }, recorder);
    try {
        const main = h.model.plotCells().find((plot) => plot.buildingId === h.model.mainBuildingId);
        assert.ok(main, '新号应自动放好主城');

        h.intent({ kind: 'mode', mode: 'base' });

        assert.equal(h.controller.snapshot.ui.mode, 'base');
        // 2026-11-11 修复：这里曾经被设成主城 hexId ⇒ 一进基地就弹「主城 升级」模态，
        // 玩家还没看清布局就被挡住。现在只移镜头。
        assert.equal(h.controller.snapshot.ui.selectedPlotHexId, -1, '进基地不应自动选中任何格子');
        assert.equal(h.controller.snapshot.ui.buildMenuVisible, false);

        // 镜头仍然要对准主城，否则玩家进基地看到的是一片空白。
        assert.equal(commands.at(-1)?.kind, 'focusBase');
        assert.equal(commands.at(-1)?.hexId, main!.hexId);

        // 点一下主城才应该选中 —— 保证「不自动选」没有把点击链路一起掐掉。
        h.intent({ kind: 'plotTap', hexId: main!.hexId });
        assert.equal(h.controller.snapshot.ui.selectedPlotHexId, main!.hexId);
    } finally { EventMgr.instance.offTarget(recorder); h.dispose(); }
});

test('摆放态投影「放得下的格子」，界面据此画绿/红边而不是让玩家试错', () => {
    const h = create();
    try {
        h.intent({ kind: 'mode', mode: 'base' });
        // 没选建筑时不该白跑 25 次规则判定。
        assert.deepEqual(h.controller.snapshot.placeableHexIds, []);

        // 补足资源：`placeableHexIds` 走 `bigMapCanPlace(..., checkResources)`，
        // 新号资源不足会让每一格都"放不下"，测不出红绿差异。
        const holder = h.model as unknown as { data: { base: { res: Record<string, number> } } };
        holder.data = {
            ...holder.data,
            base: { ...holder.data.base, res: { grain: 9999, wood: 9999, iron: 9999, coin: 9999, stamina: 9999 } },
        };

        h.intent({ kind: 'build', buildingKind: 2 });
        const ids = h.controller.snapshot.placeableHexIds;
        assert.ok(ids.length > 0, '资源充足时应至少有一格能放');

        const plots = h.controller.snapshot.plots;
        for (const hexId of ids) {
            assert.equal(plots.find((plot) => plot.hexId === hexId)?.slot, 'empty', `格 ${hexId} 不是空地`);
        }
        // 已建的主城格不能被当成可放。
        const main = plots.find((plot) => plot.buildingId === h.model.mainBuildingId);
        assert.ok(main, '新号应自动放好主城');
        assert.equal(ids.includes(main!.hexId), false);

        // 取消选择后清空，避免退出摆放态还留着红绿边。
        h.intent({ kind: 'build', buildingKind: 2 });
        assert.deepEqual(h.controller.snapshot.placeableHexIds, []);
    } finally { h.dispose(); }
});

test('moveBegin 长按入口：进入移建态并下发可落点，重复触发取消，不存在实例忽略', () => {
    const h = create();
    try {
        h.intent({ kind: 'mode', mode: 'base' });
        const instance = h.model.plotCells().find((plot) => plot.slot !== 'empty');
        assert.ok(instance, '新号至少有主城');
        h.intent({ kind: 'moveBegin', instanceId: instance.instanceId });
        const snap = h.controller.snapshot;
        assert.equal(snap.ui.pendingMoveInstanceId, instance.instanceId);
        // moveableHexIds 只含空格，且原格不在内（bigMapCanMove 对原格 false）。
        assert.ok(snap.moveableHexIds.every((hex) =>
            snap.plots.find((plot) => plot.hexId === hex)?.slot === 'empty'));
        assert.equal(snap.moveableHexIds.includes(instance.hexId), false);
        // 再触发同一实例 = 取消，可落点清空。
        h.intent({ kind: 'moveBegin', instanceId: instance.instanceId });
        assert.equal(h.controller.snapshot.ui.pendingMoveInstanceId, 0);
        assert.deepEqual(h.controller.snapshot.moveableHexIds, []);
        // 不存在实例直接忽略，不进入移建态。
        h.intent({ kind: 'moveBegin', instanceId: 999999 });
        assert.equal(h.controller.snapshot.ui.pendingMoveInstanceId, 0);
    } finally { h.dispose(); }
});

test('建造目录点空白关闭后状态跟着关：不会在下一次时钟 publish 里自己弹回来', () => {
    const h = create();
    try {
        h.intent({ kind: 'mode', mode: 'base' });
        h.intent({ kind: 'toggleBuildMenu' });
        assert.equal(h.controller.snapshot.ui.buildMenuVisible, true);

        // 弹窗被点空白关掉时只收掉了自己，页面必须把它翻译成这个意图；
        // 否则 `buildMenuVisible` 留在 true，下一次 500ms `tick → publish` 会把弹窗原样再弹回来。
        h.intent({ kind: 'closeBuildMenu' });
        assert.equal(h.controller.snapshot.ui.buildMenuVisible, false);

        h.tick();
        assert.equal(h.snapshots.at(-1)?.ui.buildMenuVisible, false, '时钟 publish 后不能复活');

        // 关窗回调可能比关闭晚到一帧：重复关闭必须是幂等的，不能再 publish 一轮。
        const count = h.snapshots.length;
        h.intent({ kind: 'closeBuildMenu' });
        assert.equal(h.snapshots.length, count, '已经关掉时不再多发一次快照');
    } finally { h.dispose(); }
});
