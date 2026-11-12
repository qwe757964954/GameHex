import assert from 'node:assert/strict';
import test from 'node:test';
import Long from 'long';
import { BigMapSlgRepository, type IBigMapSlgGateway, type IBigMapSlgRequestBody, type IBigMapSlgRequestName } from '../assets/script/app/bigmap/application/BigMapSlgRepository';
import {
    bigMapServerCellIndex, normalizeBigMapBuild, normalizeBigMapBuildInfo, normalizeBigMapBuildQueue,
    projectBigMapServerBase,
} from '../assets/script/app/bigmap/model/BigMapServerState';
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
    next.repo.invalidate('build');
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

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('建筑脏标记不再触发定时 BuildInfo 请求，行动力轮询与广播重拉仍保留', async () => {
    const { repo, gateway, advance } = harness();
    await repo.initialize();
    const count = (name: IBigMapSlgRequestName) => gateway.calls.filter((call) => call.name === name).length;
    assert.equal(count('CmdSlgBuildInfoReqMsg'), 1, '进入页面拉一次全量');
    // 写操作失败、随后的即时只读重拉也失败 ⇒ isBuildDirty 保持 true。
    gateway.reply = async () => null;
    assert.equal((await repo.move(ID, 2)).ok, false);
    await flush();
    const before = count('CmdSlgBuildInfoReqMsg');
    assert.ok(before >= 2, '写操作未确认后仍有一次即时只读重拉（不是定时请求）');
    // 跨过 10 个 5 秒节流窗口：若 tick 仍按脏标记/倒计时补拉，这里会多出一串 BuildInfo。
    for (let i = 0; i < 10; i++) { advance(6); repo.tick(); }
    await flush();
    assert.equal(count('CmdSlgBuildInfoReqMsg'), before, '倒计时/脏标记不再定时重拉 BuildInfo');
    assert.ok(count('CmdSlgActionUpdateReqMsg') >= 2, '行动力轮询按 10-30 口径保留');
    // 广播失效通知仍是保留的全量重拉入口。
    gateway.reply = async (name) => name === 'CmdSlgBuildInfoReqMsg' ? snapshot() : { info: { nextRevertTime: 20 } };
    repo.invalidate('build');
    await flush();
    assert.equal(count('CmdSlgBuildInfoReqMsg'), before + 1, '广播仍触发一次全量重拉');
    repo.dispose();
});

test('行动力倒计时到 0 必须自己发 ActionUpdate，回包重置后继续轮询', async () => {
    const { repo, gateway, advance } = harness();
    await repo.initialize();
    const actionCalls = () => gateway.calls.filter((call) => call.name === 'CmdSlgActionUpdateReqMsg').length;
    assert.equal(actionCalls(), 1, '进页面拉一次');
    assert.equal(repo.actionRemainingSeconds, 20);

    // 没到点：tick 一轮不该发。
    advance(4);
    repo.tick();
    await flush();
    assert.equal(actionCalls(), 1, '还差 16 秒，不该发');
    assert.equal(repo.actionRemainingSeconds, 16);

    // 到点：tick 必须发一次（`tick` 有 5 秒轮询节流，所以这里一次跨过窗口；
    // 真实运行时 500ms 一 tick ⇒ 到点后最多延迟 5 秒发出，对分钟级恢复可接受）。
    advance(20);
    repo.tick();
    await flush();
    assert.equal(actionCalls(), 2, '倒计时到 0 就该拉一次');
    assert.equal(repo.actionRemainingSeconds, 20, 'nextRevertTime 是剩余秒数，回包把倒计时重置');

    // 再走一轮，证明是轮询而不是只补一次
    advance(20);
    repo.tick();
    await flush();
    assert.equal(actionCalls(), 3, '每一轮恢复都要重新拉');
    repo.dispose();
});

test('nextRevertTime = 0 表示没有待恢复，不再自动轮询（否则每 5 秒打一次服务器）', async () => {
    const { repo, gateway, advance } = harness();
    gateway.reply = async (name) => {
        if (name === 'CmdSlgActionUpdateReqMsg') return { info: { nextRevertTime: 0 } };
        if (name === 'CmdSlgBuildInfoReqMsg') return snapshot();
        return { info: { maxMonsterLevel: 0, toCampId: 0 } };
    };
    await repo.initialize();
    const actionCalls = () => gateway.calls.filter((call) => call.name === 'CmdSlgActionUpdateReqMsg').length;
    assert.equal(actionCalls(), 1);
    assert.equal(repo.actionRemainingSeconds, 0, '0 秒 = 当前没有恢复计划');
    advance(600);
    repo.tick();
    await flush();
    assert.equal(actionCalls(), 1, '已经满了就不该再轮询');
    repo.dispose();
});

test('还没同步到基地信息时，写操作顺手补拉一次，而不是干等', async () => {
    const { gateway, repo } = harness();
    // 故意不 initialize：`info` 还是 null。
    const result = await repo.build(config.mainBuildingId, 1);
    assert.equal(result.ok, false, '未就绪时不能提交建造');
    assert.equal(result.message, '正在同步基地信息');
    // 关键：不能只回一句提示就完事 —— 要顺手补一次 BuildInfo，
    // 否则表现就是用户看到的「点了没反应、服务器也没收到请求」。
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(gateway.calls.some((call) => call.name === 'CmdSlgBuildInfoReqMsg'), true,
        '未就绪时必须主动补拉一次基地信息');

    // 补拉成功后照常提交。
    assert.equal(await repo.initialize(), true);
    gateway.reply = async (name) => (name === 'CmdSlgBuildReqMsg' ? { build: build({ position: 1 }), queue: null } : {});
    assert.equal((await repo.build(config.mainBuildingId, 1)).ok, true);
});

test('首帧同步确实失败后，写操作说「同步失败」而不是「正在同步」', async () => {
    const { gateway, repo } = harness();
    gateway.reply = async () => null;   // 全部被拦 / 超时
    assert.equal(await repo.initialize(), false);
    const result = await repo.build(config.mainBuildingId, 1);
    assert.equal(result.ok, false);
    // 「正在同步」会让人一直等；这里必须明说失败。
    assert.match(result.message, /同步失败/);
});

test('unlockQueue=0（还没解锁任何队列）是合法快照，不能整包丢弃', () => {
    // 之前写的是 `!unlockQueue`，把 0 当"字段缺失"⇒ 服务端首次下发 0 时 info 永远 null
    // ⇒ ready 永远 false ⇒ 建造请求一帧都不发。
    assert.deepEqual(normalizeBigMapBuildInfo({ builds: [], queues: [], unlockQueue: 0 }),
        { builds: [], queues: [], unlockQueue: 0 });
    // 负数 / 非整数仍然拒绝（那是真的脏数据）。
    assert.equal(normalizeBigMapBuildInfo({ builds: [], queues: [], unlockQueue: -1 }), null);
    assert.equal(normalizeBigMapBuildInfo({ builds: [], queues: [], unlockQueue: 1.5 }), null);
});

test('服务端 position 用 1001 系「初始位置 id」时归一到格索引（不改协议也能投影）', () => {
    // 2026-11-11 实测：服务端下发 buildingId=71001 position=1001，客户端 5×5=25 格 ⇒ 整份快照被拒。
    assert.equal(bigMapServerCellIndex(1001, 25), 0);
    assert.equal(bigMapServerCellIndex(1023, 25), 22);
    // 已经是格索引的原样用（服务端改成 0..24 之后走这条，上面的兼容自然不再命中）。
    assert.equal(bigMapServerCellIndex(0, 25), 0);
    assert.equal(bigMapServerCellIndex(24, 25), 24);
    // 越界两条都不算：1000（低于基准）、1026（超格数）、负数、非整数。
    assert.equal(bigMapServerCellIndex(1000, 25), -1);
    assert.equal(bigMapServerCellIndex(1026, 25), -1);
    assert.equal(bigMapServerCellIndex(-1, 25), -1);
    assert.equal(bigMapServerCellIndex(1.5, 25), -1);

    // 投影层：position=1001 的主城应该能落地，hexId 归一成 0。
    const base = projectBigMapServerBase(
        { builds: [{ instanceId: 1, buildingId: config.mainBuildingId, position: 1001, level: 1, state: 0, finishAt: 0 }],
            queues: [], unlockQueue: 1 }, config, 1000);
    assert.ok(base, 'position=1001 不能再把整份快照拒掉');
    assert.equal(base!.buildings[0].hexId, 0);
});

test('建造 finishTime 到点主动拉一次基地信息，同一完成时间只拉一次', async () => {
    const { gateway, repo, advance } = harness();
    const finishAt = 1000 + 30;   // harness 的 now 从 1000 起
    gateway.reply = async (name) => {
        if (name === 'CmdSlgBuildInfoReqMsg') return { info: {
            builds: [{ buildInstId: 7, buildingId: config.mainBuildingId, position: 1, level: 2, state: 1, finishTime: finishAt }],
            queues: [{ queueId: 1, type: 1, buildInstId: 7 }], unlockQueue: 1 } };
        if (name === 'CmdSlgActionUpdateReqMsg') return { info: { nextRevertTime: 0 } };
        if (name === 'CmdSlgGameInfoReqMsg') return { info: { maxMonsterLevel: 0, toCampId: 0 } };
        return {};
    };
    assert.equal(await repo.initialize(), true);
    const pulls = () => gateway.calls.filter((call) => call.name === 'CmdSlgBuildInfoReqMsg').length;
    const before = pulls();

    // 还没到点：tick 不能多打服务器。
    advance(5); repo.tick();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(pulls(), before, 'finishTime 未到不该拉');

    // 到点：主动拉一次，让服务端告诉我们建完没有。
    advance(30); repo.tick();
    await new Promise((resolve) => setImmediate(resolve));
    const afterFinish = pulls();
    assert.equal(afterFinish, before + 1, 'finishTime 到点应主动拉一次');

    // 同一个 finishAt 不重复拉（否则 500ms tick 会反复打服务器）。
    advance(10); repo.tick();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(pulls(), afterFinish, '同一 finishAt 只拉一次');
});
