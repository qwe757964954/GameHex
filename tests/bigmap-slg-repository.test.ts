import assert from 'node:assert/strict';
import test from 'node:test';
import Long from 'long';
import { BigMapSlgRepository, type IBigMapSlgGateway, type IBigMapSlgRequestBody, type IBigMapSlgRequestName } from '../assets/script/app/bigmap/application/BigMapSlgRepository';
import { normalizeBigMapBuild, normalizeBigMapBuildInfo, normalizeBigMapBuildQueue } from '../assets/script/app/bigmap/model/BigMapServerState';
import { loadBigMapConfig } from './helpers/bigmap-fixtures';

const config = loadBigMapConfig();
const ID = 0xffffffff;
const build = (patch = {}) => ({ buildInstId: ID, buildingId: config.mainBuildingId,
    position: 0, level: 1, state: 0, ...patch });
const snapshot = (builds = [build()], queues: object[] = [], unlockQueue = 1) => ({ info: { builds, queues, unlockQueue } });

class Gateway implements IBigMapSlgGateway {
    readonly calls: { name: IBigMapSlgRequestName; body: IBigMapSlgRequestBody }[] = [];
    listener: ((kind: 'game' | 'build') => void) | null = null;
    reply: (name: IBigMapSlgRequestName, body: IBigMapSlgRequestBody) => Promise<unknown> = async (name) => {
        if (name === 'CmdSlgBuildInfoReqMsg') return snapshot();
        if (name === 'CmdSlgActionUpdateReqMsg') return { info: { nextRevertTime: 20 } };
        if (name === 'CmdSlgGameInfoReqMsg') return { info: { maxMonsterLevel: 0, toCampId: 0 } };
        return {};
    };
    request(name: IBigMapSlgRequestName, body: IBigMapSlgRequestBody): Promise<unknown> {
        this.calls.push({ name, body });
        return this.reply(name, body);
    }
    subscribe(listener: (kind: 'game' | 'build') => void): () => void {
        this.listener = listener;
        return () => { this.listener = null; };
    }
}

function harness(timeoutMs = 100) {
    const gateway = new Gateway();
    let now = 1000;
    const repo = new BigMapSlgRepository(gateway, config, () => now, timeoutMs);
    return { gateway, repo, advance: (seconds: number) => { now += seconds; } };
}

test('SLG全量建筑边界保留uint32上限、零号地块与空列表，拒绝非法状态和损坏引用', () => {
    assert.equal(normalizeBigMapBuildInfo(snapshot().info)?.builds[0].instanceId, ID);
    assert.equal(normalizeBigMapBuildInfo(snapshot().info)?.builds[0].position, 0);
    assert.deepEqual(normalizeBigMapBuildInfo(snapshot([], []).info), { builds: [], queues: [], unlockQueue: 1 });
    for (const value of [null, {}, { ...snapshot().info, unlockQueue: -1 },
        snapshot([build({ state: 4 })]).info,
        snapshot([build({ buildInstId: ID + 1 })]).info,
        snapshot([build(), build()]).info,
        snapshot([build({ state: 1, finishTime: 1100 })], [{ queueId: 1, type: 1, buildInstId: 2 }]).info]) {
        assert.equal(normalizeBigMapBuildInfo(value), null);
    }
});

test('进入SLG拉玩法、行动力和建筑，服务端全量替换，倒计时是剩余秒数', async () => {
    const { repo, gateway, advance } = harness();
    assert.equal(await repo.initialize(), true);
    assert.deepEqual(gateway.calls.map((call) => call.name).sort(),
        ['CmdSlgActionUpdateReqMsg', 'CmdSlgBuildInfoReqMsg', 'CmdSlgGameInfoReqMsg'].sort());
    const base = repo.projectBase();
    assert.ok(base);
    assert.equal(base.buildings.length, 1);
    assert.equal(base.buildings[0].hexId, 0);
    assert.equal(repo.serverInstanceId(base.buildings[0].instanceId), ID);
    assert.equal(repo.actionRemainingSeconds, 20);
    advance(5);
    assert.equal(repo.actionRemainingSeconds, 15);
    gateway.reply = async () => snapshot([]);
    assert.equal(await repo.refreshBuildInfo(), true);
    assert.equal(repo.projectBase()?.buildings.length, 0, '空列表代表权威空基地');
    repo.dispose();
});

test('两种建筑消息的uint32实例边界拒绝旧Long、字符串、零号和越界数据', () => {
    for (const id of [0, -1, 1.5, NaN, Infinity, 0x100000000, '1', Long.fromInt(1), { low: 1, high: 0 }]) {
        assert.equal(normalizeBigMapBuild(build({ buildInstId: id })), null);
        assert.equal(normalizeBigMapBuildQueue({ queueId: 1, type: 1, buildInstId: id }), null);
    }
});

test('建造回包映射在建格、队列和取消实例，升级保留当前等级，不本地完成', async () => {
    const { repo, gateway, advance } = harness();
    await repo.initialize();
    const field = Array.from(config.buildings.values()).find((item) => item.id !== config.mainBuildingId);
    assert.ok(field);
    const newBuild = build({ buildInstId: 2, buildingId: field.id, position: 2, state: 1, finishTime: 1010 });
    gateway.reply = async () => ({ build: newBuild, queue: { queueId: 1, type: 1, buildInstId: 2 } });
    assert.equal((await repo.build(field.id, 2)).ok, true);
    assert.deepEqual(gateway.calls.at(-1), { name: 'CmdSlgBuildReqMsg', body: { buildingId: field.id, position: 2, instant: 0 } });
    const base = repo.projectBase();
    assert.ok(base);
    assert.equal(base.buildings.length, 1);
    assert.equal(base.queues[0].anchorHexId, 2);
    assert.equal(repo.queueInstanceId(0), 2);
    advance(20);
    assert.equal(repo.projectBase()?.buildings.length, 1, '到时间不在客户端伪造完成');
    gateway.reply = async () => ({ buildInstId: 2 });
    assert.equal((await repo.cancel(2)).ok, true);
    assert.equal(repo.projectBase()?.queues[0].state, 0);
    gateway.reply = async () => ({ build: build({ state: 2, finishTime: 1100 }), queue: { queueId: 1, type: 2, buildInstId: ID } });
    assert.equal((await repo.upgrade(ID)).ok, true);
    assert.equal(repo.projectBase()?.buildings[0].level, 1);
    assert.equal(repo.projectBase()?.queues[0].targetLevel, 2);
    assert.deepEqual(gateway.calls.at(-1), { name: 'CmdSlgBuildUpgradeReqMsg', body: { buildInstId: ID, instant: 0 } });
    repo.dispose();
});

test('移动、收取实际奖励、解锁队列按服务端结果更新，使用uint32实例', async () => {
    const { repo, gateway } = harness();
    await repo.initialize();
    gateway.reply = async (name) => name === 'CmdSlgBuildMoveReqMsg' ? { build: build({ position: 3 }) }
        : name === 'CmdSlgBuildCollectReqMsg' ? { tlCmdGoods: [{ resId: Long.fromInt(18501), number: '7' }] }
            : { unlockQueue: 2 };
    assert.equal((await repo.move(ID, 3)).ok, true);
    assert.equal(repo.projectBase()?.buildings[0].hexId, 3);
    assert.deepEqual((await repo.collect([ID])).rewards, [{ resId: 18501, amount: 7 }]);
    assert.deepEqual(gateway.calls.at(-1), { name: 'CmdSlgBuildCollectReqMsg', body: { buildInstIds: [ID] } });
    assert.equal((await repo.unlockQueue(2)).ok, true);
    assert.equal(repo.projectBase()?.queueUnlocked, 2);
    assert.equal(repo.projectBase()?.res.grain, 0, '不猜测物品和基地资源的映射');
    repo.dispose();
});

test('空广播触发重新拉取，销毁解除监听并拒绝迟到回包', async () => {
    const { repo, gateway } = harness();
    await repo.initialize();
    let finish: (value: unknown) => void = () => {};
    gateway.reply = async () => new Promise((resolve) => { finish = resolve; });
    const refresh = repo.refreshBuildInfo();
    repo.dispose();
    assert.equal(gateway.listener, null);
    finish(snapshot([]));
    assert.equal(await refresh, false);
    assert.equal(repo.projectBase()?.buildings.length, 1);
    const next = harness();
    await next.repo.initialize();
    const before = next.gateway.calls.length;
    next.gateway.listener?.('build');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(next.gateway.calls[before].name, 'CmdSlgBuildInfoReqMsg');
    next.repo.dispose();
});

test('写请求等待服务端，重复操作被拦，超时或畸形回包不污染基地', async () => {
    const { repo, gateway } = harness(20);
    await repo.initialize();
    const before = JSON.stringify(repo.projectBase());
    gateway.reply = async () => new Promise(() => {});
    const first = repo.move(ID, 2);
    assert.equal(JSON.stringify(repo.projectBase()), before);
    assert.equal((await repo.move(ID, 3)).ok, false);
    assert.equal((await first).ok, false);
    assert.equal(JSON.stringify(repo.projectBase()), before);
    gateway.reply = async () => ({ build: build({ buildInstId: 999, position: 4 }) });
    assert.equal((await repo.move(ID, 4)).ok, false, '响应实例必须匹配请求');
    assert.equal(JSON.stringify(repo.projectBase()), before);
    repo.dispose();
});

test('更新回包先于旧全量回包时，旧全量不能回滚建筑', async () => {
    const { repo, gateway } = harness();
    await repo.initialize();
    let finish: (value: unknown) => void = () => {};
    gateway.reply = async (name) => name === 'CmdSlgBuildInfoReqMsg'
        ? new Promise((resolve) => { finish = resolve; }) : { build: build({ position: 3 }) };
    const old = repo.refreshBuildInfo();
    await repo.move(ID, 3);
    finish(snapshot());
    await old;
    assert.equal(repo.projectBase()?.buildings[0].hexId, 3);
    repo.dispose();
});

test('写请求未确认且无广播时，只读重拉恢复服务端已经执行的状态，不重发写操作', async () => {
    const { repo, gateway } = harness();
    await repo.initialize();
    gateway.reply = async (name) => name === 'CmdSlgBuildMoveReqMsg' ? null : snapshot([build({ position: 3 })]);
    assert.equal((await repo.move(ID, 3)).ok, false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(repo.projectBase()?.buildings[0].hexId, 3);
    assert.equal(gateway.calls.filter((call) => call.name === 'CmdSlgBuildMoveReqMsg').length, 1);
    repo.dispose();
});
