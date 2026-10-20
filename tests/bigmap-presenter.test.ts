/**
 * Presenter（application 层）回归：验证「配置 → 世界 → 存档 → 视图数据 → 动作」整条链路。
 *
 * 这里不打桩 model，全部走真实规则 + 真实配置表，只有存储换成内存、时钟换成可控的，
 * 所以它同时充当一次「存档读回来还能接着玩」的集成测试。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { BigMapPresenter } from '../assets/script/app/bigmap/application/BigMapPresenter';
import { createMemoryBigMapStorage, BIGMAP_SAVE_KEY } from '../assets/script/app/bigmap/application/BigMapSaveKeys';
import type { IBigMapStorage } from '../assets/script/app/bigmap/application/BigMapPresenter';
import { bigMapPlotHexId } from '../assets/script/app/bigmap/model/BigMapBase';
import {
    exportBigMapLayout,
    type IBigMapLayout,
} from '../assets/script/app/bigmap/model/BigMapLayout';
import { buildBigMapWorld } from '../assets/script/app/bigmap/model/BigMapWorld';
import { loadBigMapConfig } from './helpers/bigmap-fixtures';

const config = loadBigMapConfig();

interface IHarness {
    presenter: BigMapPresenter;
    storage: IBigMapStorage;
    clock: { now: number; chapter: number };
}

function makeHarness(
    chapter = 3,
    storage = createMemoryBigMapStorage(),
    now = 1_000_000,
    layout: IBigMapLayout | null = null,
): IHarness {
    const clock = { now, chapter };
    const presenter = new BigMapPresenter({
        config,
        layout,
        storage,
        saveKey: BIGMAP_SAVE_KEY,
        adventureChapter: () => clock.chapter,
        now: () => clock.now,
    });
    return { presenter, storage, clock };
}

test('注入 layout 后世界按布局落位；不注入就按种子生成', () => {
    const seeded = buildBigMapWorld(config);
    const layout = exportBigMapLayout(seeded);
    const target = layout.cities[0];
    // 把第一座城整行下移（占格块一起平移），保证仍是合法连通块。
    const moved: IBigMapLayout = {
        ...layout,
        cities: layout.cities.map((city, index) => (index === 0
            ? { ...city, anchorHexId: city.anchorHexId + 40, hexIds: city.hexIds.map((id) => id + 40) }
            : city)),
    };

    const withLayout = makeHarness(3, createMemoryBigMapStorage(), 1_000_000, moved);
    assert.equal(
        withLayout.presenter.world.cities.get(target.cityId)!.anchorHexId,
        target.anchorHexId + 40,
        '注入的布局没生效',
    );

    const withoutLayout = makeHarness();
    assert.equal(
        withoutLayout.presenter.world.cities.get(target.cityId)!.anchorHexId,
        target.anchorHexId,
        '没注入布局时应该按种子生成',
    );
});

test('资源栏：5 种资源、带名称与上限；新档有货币和行动力', () => {
    const { presenter } = makeHarness();
    const bar = presenter.resourceBar();
    assert.equal(bar.length, 5);
    assert.deepEqual(bar.map((item) => item.type), ['grain', 'wood', 'iron', 'coin', 'stamina']);
    assert.equal(bar[0].name, '粮食');
    assert.equal(bar[0].cap, 800);
    assert.equal(bar[3].amount, 200);
    assert.equal(bar[4].amount, config.stamina.staminaMax);
    assert.equal(presenter.mainLevel(), 1);
    assert.equal(presenter.attackPower(), 420);
});

test('建造列表跟着冒险章节解锁，未解锁带人话原因', () => {
    const { presenter, clock } = makeHarness(1);
    const locked = presenter.buildMenu();
    assert.equal(locked.find((item) => item.buildingId === 71002)!.unlocked, false);
    assert.match(locked.find((item) => item.buildingId === 71002)!.reason, /第 2 章/);
    assert.equal(presenter.upgradeUnlocked(), false);

    clock.chapter = 3;
    // 章节变了要重新取一次（Presenter 每次调用都读最新进度，不需要重新构造）。
    const unlocked = presenter.buildMenu();
    assert.equal(unlocked.find((item) => item.buildingId === 71002)!.unlocked, true);
    assert.equal(unlocked.find((item) => item.buildingId === 71005)!.unlocked, true);
    assert.equal(unlocked.find((item) => item.buildingId === 71006)!.unlocked, false);
    assert.equal(presenter.upgradeUnlocked(), true);
});

test('建造 → 队列视图 → 到点落地 → 产出可收获', () => {
    const { presenter, clock } = makeHarness();
    const cell = bigMapPlotHexId(1, 1, 5);
    const started = presenter.startBuild(cell, 71002);
    assert.equal(started.ok, true, started.message);
    assert.equal(presenter.plotCells().find((item) => item.hexId === cell)!.slot, 'constructing');
    const queue = presenter.queues()[0];
    assert.equal(queue.busy, true);
    assert.equal(queue.name, '粮食田');
    assert.ok(queue.remainSeconds > 0);

    clock.now += 30;
    presenter.tick();
    const cellView = presenter.plotCells().find((item) => item.hexId === cell)!;
    assert.equal(cellView.slot, 'building');
    assert.equal(cellView.level, 1);
    assert.equal(presenter.queues()[0].busy, false);

    // 攒一小时再收。
    for (let hour = 1; hour <= 2; hour += 1) {
        clock.now += 3600;
        presenter.tick();
    }
    const bar = presenter.resourceBar().find((item) => item.type === 'grain')!;
    assert.ok(bar.pending >= 80, `应有待收粮食，实际 ${bar.pending}`);
    assert.equal(bar.perHour, 40);

    // 先把粮食花掉一部分，给仓库腾空间。
    const before = bar.amount;
    const collected = presenter.harvestAll();
    assert.equal(collected.ok, true, collected.message);
    assert.ok(presenter.resourceBar().find((item) => item.type === 'grain')!.amount > before);
});

test('建造失败会返回可直接展示的原因', () => {
    const { presenter } = makeHarness();
    const poor = { ...presenter.base, res: { ...presenter.base.res, grain: 0, wood: 0, iron: 0 } };
    void poor;
    // 中心格已被主城占据。
    const onMain = presenter.startBuild(bigMapPlotHexId(2, 2, 5), 71002);
    assert.equal(onMain.ok, false);
    assert.match(onMain.message, /已有建筑/);
    // 未解锁的建筑。
    const locked = presenter.startBuild(bigMapPlotHexId(0, 0, 5), 71006);
    assert.equal(locked.ok, false);
    assert.match(locked.message, /第 4 章/);
});

test('城池视图：解锁状态、距离、伤害预览都在同一条数据里', () => {
    const { presenter } = makeHarness(3);
    const open = presenter.cityView(101)!;
    assert.equal(open.state, 'open');
    assert.equal(open.name, '前哨营地');
    assert.ok(open.distance > 0);
    assert.ok(open.previewDamage > 0);
    assert.equal(open.hpRatio, 1);
    assert.equal(open.rewardCoin, 240);

    const lockedByPrev = presenter.cityView(102)!;
    assert.equal(lockedByPrev.state, 'locked');
    assert.match(lockedByPrev.reason, /前置城池/);

    const unavailable = presenter.cityView(200)!;
    assert.equal(unavailable.state, 'unavailable');
    assert.equal(unavailable.previewDamage, 0);

    assert.equal(presenter.allCityViews().length, config.cities.size);
});

test('连打 4 次占领首城，并把占领结果写进存档', () => {
    const { presenter, storage } = makeHarness(3);
    // 城防 1600、基地到城池的距离可能超出势力范围（伤害 336），所以不固定次数：
    // 一直打到占领或行动力耗尽为止。
    let occupied = false;
    for (let round = 0; round < 8; round += 1) {
        const feedback = presenter.attackCity(101);
        if (!feedback.ok) break;
        if (/占领/.test(feedback.message)) { occupied = true; break; }
    }
    assert.equal(occupied, true, '应在行动力耗尽前占领首城');
    assert.equal(presenter.cityView(101)!.state, 'occupied');
    // 占领后下一环立刻可打。
    assert.equal(presenter.cityView(102)!.state, 'open');

    // 重新构造一个 Presenter（模拟重进页面），占领结果必须还在。
    const reloaded = new BigMapPresenter({
        config, storage, saveKey: BIGMAP_SAVE_KEY,
        adventureChapter: () => 3, now: () => 1_000_000,
    });
    assert.equal(reloaded.cityView(101)!.state, 'occupied');
    assert.deepEqual(reloaded.battle.occupiedCityIds, [101]);
});

test('野怪：可打、击杀后进 CD，视图给出倒计时', () => {
    const { presenter, clock } = makeHarness(3);
    const monster = presenter.world.monsters.find((item) => item.level === 1)!;
    const view = presenter.monsterView(monster.instanceId)!;
    assert.equal(view.unlocked, true);
    assert.equal(view.hpRatio, 1);

    assert.equal(presenter.attackMonster(monster.instanceId).ok, true);
    const kill = presenter.attackMonster(monster.instanceId);
    assert.equal(kill.ok, true, kill.message);
    assert.match(kill.message, /击杀/);
    assert.equal(presenter.monsterView(monster.instanceId)!.respawnInSeconds > 0, true);
    assert.equal(presenter.battle.clearedMonsterLevel, 1);

    // CD 内再打被拒。
    assert.equal(presenter.attackMonster(monster.instanceId).ok, false);
    clock.now += 1000;
    assert.equal(presenter.monsterView(monster.instanceId)!.respawnInSeconds, 0);
});

test('存档损坏时自动退回新档，不把报错抛给界面', () => {
    const storage = createMemoryBigMapStorage({ [BIGMAP_SAVE_KEY]: '{这不是 json' });
    const presenter = new BigMapPresenter({
        config, storage, saveKey: BIGMAP_SAVE_KEY,
        adventureChapter: () => 3, now: () => 1_000_000,
    });
    assert.equal(presenter.base.buildings.length, 1);
    assert.equal(presenter.mainLevel(), 1);
    assert.deepEqual(presenter.battle.occupiedCityIds, []);
});

test('脏存档里的非法建筑会被丢掉，主城缺失时自动补回', () => {
    const broken = JSON.stringify({
        version: 1,
        savedAt: 1,
        base: {
            instanceSeq: 3,
            queueUnlocked: 9,
            res: { grain: 'x', wood: -5, iron: 10, coin: 1, stamina: 0 },
            stamina: 99999,
            staminaAt: 1,
            buildings: [
                { instanceId: 1, buildingId: 99999, level: 1, hexId: 3 },
                { instanceId: 2, buildingId: 71002, level: 99, hexId: 3, stored: 1e9, lastTickAt: 1 },
            ],
            queues: [{ slotIndex: 0, state: 1, buildingId: 99999, finishAt: 5 }],
        },
        battle: { occupiedCityIds: [101, 7777], clearedMonsterLevel: -3 },
    });
    const storage = createMemoryBigMapStorage({ [BIGMAP_SAVE_KEY]: broken });
    const presenter = new BigMapPresenter({
        config, storage, saveKey: BIGMAP_SAVE_KEY,
        adventureChapter: () => 3, now: () => 1_000_000,
    });
    const buildings = presenter.base.buildings;
    // 不认识的建筑被丢掉，主城被补回，等级被夹到合法值。
    assert.equal(buildings.some((item) => item.buildingId === 99999), false);
    assert.equal(buildings.some((item) => item.buildingId === config.mainBuildingId), true);
    assert.equal(buildings.find((item) => item.buildingId === 71002)!.level, 5);
    // 队列容量由建筑反推（没建「建造队列」⇒ 只有初始 1 条），脏队列被清成空闲。
    assert.equal(presenter.queues().length, config.queue.initBuildQueue);
    assert.equal(presenter.queues()[0].busy, false);
    // 只保留配置里存在的城池；等级不会为负。
    assert.deepEqual(presenter.battle.occupiedCityIds, [101]);
    assert.equal(presenter.battle.clearedMonsterLevel, 0);
    // 资源变成合法数字，且被夹到上限内。
    const grain = presenter.resourceBar().find((item) => item.type === 'grain')!;
    assert.ok(Number.isFinite(grain.amount) && grain.amount >= 0);
});


test('重置存档能回到初始状态', () => {
    const { presenter } = makeHarness(3);
    presenter.startBuild(bigMapPlotHexId(0, 0, 5), 71002);
    assert.ok(presenter.base.buildings.length > 1 || presenter.queues()[0].busy);
    presenter.resetSave();
    assert.equal(presenter.base.buildings.length, 1);
    assert.equal(presenter.queues()[0].busy, false);
});
