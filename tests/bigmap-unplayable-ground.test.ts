/**
 * 势力范围「铺灰」的判据必须是**配置层**的 `unplayable`，不能是 `state`。
 *
 * 2026-11-26 用户 bug：*「拖动地图以后叠加的灰色会消失，又变回了原本的颜色」*。
 *
 * 时序：进页面时该据点还没收到服务器快照 ⇒ `campInfo` 为 null ⇒ `state` 走配置
 * （章节 / 开服天数 / 前置城池没满足 ⇒ `locked`）⇒ 地块铺灰。地图一拖，新据点进入视野，
 * `visibleCamps` → `CmdSlgCampSimpleInfoRspMsg` 回包 ⇒ `campInfo` 到手 ⇒
 * `cityView` 按「服务器能下发就说明已开放」把 `state` 改写成 `open` / `occupied`
 * ⇒ 只按 `state` 判灰的写法当场退色。
 *
 * 口径：`unplayable` = `bigMapCityUnlock` 有没有给出理由（+ 两个配置态兜底），跨快照恒定。
 * 本用例把「快照前后」都钉死，防以后再拿 `state` 当染色判据。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { BigMapCampRepository, type IBigMapCampGateway } from '../assets/script/app/bigmap/application/BigMapCampRepository';
import { createMemoryBigMapStorage } from '../assets/script/app/bigmap/application/BigMapSaveKeys';
import { BigMapModel } from '../assets/script/app/bigmap/application/BigMapModel';
import { withBigMapCampCities } from '../assets/script/app/bigmap/model/BigMapCampWorld';
import { loadBigMapConfig } from './helpers/bigmap-fixtures';

// 页面走的是 `BigMapConfigLoader`（`parseBigMapConfig` → `withBigMapCampCities`），夹具只做前半段
// ⇒ 这里补上，否则拿到的是旧城表、跟线上据点 id 对不上。
// 不传布局：本用例只问「`cityView` 的判据稳不稳」，地图落位走种子生成即可（世界尺寸也只与配表有关）。
const config = withBigMapCampCities(loadBigMapConfig());

/** 军团层据点（`bigMapCamp` 201 = 雾隐堡，章节 2、`occupyType` 2）—— 截图里那一类。 */
const CAMP_LOCKED = 201;
/** 个人层据点（101 = 前哨营地，章节 1）。 */
const CAMP_OPEN = 101;

/**
 * 联机档模型：只通关了第 1 章 ⇒ 201 未解锁、101 已解锁。
 * `openDay` 不给（服务器还没下发，不做开服天数控制），这样「未解锁」只由章节决定，判据干净。
 */
async function createModel() {
    const gateway: IBigMapCampGateway = {
        // 服务器把 201 也下发了 —— 正是这一包让 `state` 从 `locked` 变成 `open`。
        fetchSimple: async () => ({ infos: [{ campId: CAMP_LOCKED, opType: 0 }] }),
        fetchDetail: async () => ({ infos: [] }),
        fetchRoles: async () => ({ infos: [] }),
        requestMove: async () => ({}),
    };
    const now = (): number => 1_700_000_000;
    const repository = new BigMapCampRepository(gateway, now);
    const model = new BigMapModel({
        config, campRepository: repository,
        storage: createMemoryBigMapStorage(), saveKey: 'unplayable-ground', now,
        adventureChapter: () => 1,
        canRequestBattle: true,
    });
    return { model, repository };
}

test('未解锁据点：服务器快照把 state 改成 open 之后，unplayable 仍为真（地块继续铺灰）', async () => {
    const { model, repository } = await createModel();

    const before = model.cityView(CAMP_LOCKED);
    assert.ok(before, '据点 201 必须在地图上');
    assert.equal(before.state, 'locked', '快照到之前，state 走配置 = 未解锁');
    assert.equal(before.unplayable, true, '未解锁 ⇒ unplayable');
    assert.match(before.reason, /章/, '理由要能告诉玩家差什么');

    await repository.refreshSimple([CAMP_LOCKED]);

    const after = model.cityView(CAMP_LOCKED);
    assert.ok(after, '据点 201 必须在地图上');
    assert.ok(repository.get(CAMP_LOCKED), '快照必须真的到达 —— 否则本用例只是「分支没跑」的假绿');
    assert.equal(after.state, 'open', '联机档口径：服务器能下发就说明已开放（2026-10-30）');
    // 🔴 这一条就是本用例的全部意义：state 变了，染色判据不能跟着变。
    assert.equal(after.unplayable, true, 'state 变成 open 之后 unplayable 必须仍为真，否则拖动地图灰就没了');
    assert.equal(after.reason, before.reason, '配置层的未解锁理由与快照无关');
});

test('已解锁且能打的据点不许被判成 unplayable（否则整张图都灰）', async () => {
    const { model } = await createModel();
    const open = model.cityView(CAMP_OPEN);
    assert.ok(open, '据点 101 必须在地图上');
    assert.equal(open.reason, '', '第 1 章已通关 ⇒ 没有未解锁理由');
    assert.equal(open.state, 'open');
    assert.equal(open.unplayable, false, '能打的据点不能被铺灰');
});

test('己方占据的据点：unplayable 可能为真，但地块颜色归属优先（绿）', async () => {
    const { model } = await createModel();
    // 归属优先级由 `BigMapWorldView.territoryPaint` 保证（先判 territoryOwner，再判 unplayable），
    // 这里只钉住「unplayable 是配置判据、不掺归属」这件事，避免以后有人把归属塞进 unplayable
    // 导致「我的城被灰掉 / 别人的城被我染绿」。
    const locked = model.cityView(CAMP_LOCKED);
    assert.ok(locked);
    assert.equal(locked.unplayable, true);
    assert.equal(locked.territoryOwner, 'neutral', '没被占的城不该带归属');
});
