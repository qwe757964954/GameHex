import assert from 'node:assert/strict';
import test from 'node:test';
import { BigMapPresenter } from '../assets/script/app/bigmap/application/BigMapPresenter';
import { BigMapSlgRepository, type IBigMapSlgGateway } from '../assets/script/app/bigmap/application/BigMapSlgRepository';
import { loadBigMapConfig } from './helpers/bigmap-fixtures';

const config = loadBigMapConfig();
const ID = 0xffffffff;
function harness() {
    let writes = 0;
    let now = 1000;
    const calls: { name: string; body: Readonly<Record<string, number>> }[] = [];
    const home = { buildInstId: ID, buildingId: config.mainBuildingId, position: 0, level: 1, state: 0 };
    let reply: IBigMapSlgGateway['request'] = async (name) => name === 'CmdSlgBuildInfoReqMsg'
        ? { info: { builds: [home], queues: [], unlockQueue: 1 } }
        : name === 'CmdSlgActionUpdateReqMsg' ? { info: { nextRevertTime: 20 } } : {};
    const gateway: IBigMapSlgGateway = {
        request(name, body) { calls.push({ name, body }); return reply(name, body); }, subscribe: () => () => {},
    };
    const repo = new BigMapSlgRepository(gateway, config, () => now);
    const presenter = new BigMapPresenter({ config, storage: { read: () => { throw new Error('联机不能读取离线基地'); },
        write: () => { writes += 1; } }, saveKey: 'slg-test', adventureChapter: () => 10,
        now: () => now, slgRepository: repo });
    return { presenter, repo, calls, home, setReply: (fn: typeof reply) => { reply = fn; },
        writes: () => writes, advance: () => { now += 2000; } };
}

test('联机基地只展示服务端建筑，不读写本地存档，不自动增长资源或完成队列', async () => {
    const h = harness();
    assert.equal(h.presenter.base.buildings.length, 0);
    assert.equal(await h.presenter.initializeSlg(), true);
    assert.equal(h.presenter.base.buildings.length, 1);
    assert.equal(h.presenter.base.buildings[0].hexId, 0);
    assert.equal(h.presenter.resourceBar().every((item) => item.amountKnown === false), true);
    h.advance();
    h.presenter.tick();
    assert.equal(h.presenter.base.res.grain, 0);
    assert.equal(h.writes(), 0);
    h.presenter.dispose();
});

test('基地建造入口等服务端确认，队列取消用服务端实例ID，失败不回落本地规则', async () => {
    const h = harness();
    await h.presenter.initializeSlg();
    const field = Array.from(config.buildings.values()).find((item) => item.kind === 2);
    assert.ok(field);
    let finish: (value: unknown) => void = () => {};
    h.setReply(async () => new Promise((resolve) => { finish = resolve; }));
    const pending = h.presenter.requestBuild(2, field.id);
    assert.equal(h.presenter.base.buildings.length, 1);
    finish({ build: { buildInstId: 2, buildingId: field.id, position: 2, level: 1, state: 1, finishTime: 1100 },
        queue: { queueId: 1, type: 1, buildInstId: 2 } });
    assert.equal((await pending).ok, true);
    assert.equal(h.presenter.plotCells()[2].slot, 'constructing');
    h.setReply(async () => ({ buildInstId: 2 }));
    assert.equal((await h.presenter.requestCancelQueue(0)).ok, true);
    assert.equal(h.calls.at(-1)?.body.buildInstId, 2);
    assert.equal(h.presenter.plotCells()[2].slot, 'empty');
    h.setReply(async () => null);
    assert.equal((await h.presenter.requestBuild(2, field.id)).ok, false);
    assert.equal(h.presenter.plotCells()[2].slot, 'empty');
    h.presenter.dispose();
});

test('基地升级、移动、收取和队列解锁都走对应SLG请求并保留实例精度', async () => {
    const h = harness();
    await h.presenter.initializeSlg();
    const localId = h.presenter.base.buildings[0].instanceId;
    assert.equal(localId, ID, '展示直接使用服务端uint32实例，不再创建本地编号');
    h.setReply(async (name) => name === 'CmdSlgBuildUpgradeReqMsg'
        ? { build: { ...h.home, state: 2, finishTime: 1100 }, queue: { queueId: 1, type: 2, buildInstId: ID } }
        : name === 'CmdSlgBuildMoveReqMsg' ? { build: { ...h.home, position: 3 } }
            : name === 'CmdSlgBuildCollectReqMsg' ? { tlCmdGoods: [{ resId: 18501, number: '7' }] } : { unlockQueue: 2 });
    assert.equal((await h.presenter.requestUpgrade(localId)).ok, true);
    assert.equal(h.calls.at(-1)?.body.buildInstId, ID);
    // 用全量确认升级完成后再移动。
    h.setReply(async () => ({ info: { builds: [h.home], queues: [], unlockQueue: 1 } }));
    await h.repo.refreshBuildInfo();
    h.setReply(async (name) => name === 'CmdSlgBuildMoveReqMsg' ? { build: { ...h.home, position: 3 } }
        : name === 'CmdSlgBuildCollectReqMsg' ? { tlCmdGoods: [{ resId: 18501, number: '7' }] } : { unlockQueue: 2 });
    assert.equal((await h.presenter.requestMove(localId, 3)).ok, true);
    assert.equal((await h.presenter.requestHarvest(localId)).ok, true);
    assert.equal((await h.presenter.requestUnlockBuildQueue()).ok, true);
    assert.equal(h.presenter.base.queueUnlocked, 2);
    assert.equal(h.writes(), 0);
    h.presenter.dispose();
});
