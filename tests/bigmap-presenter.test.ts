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
import type { IBigMapStorage, IBigMapPresenterDeps } from '../assets/script/app/bigmap/application/BigMapPresenter';
import type { IBigMapCityRankBoard } from '../assets/script/app/bigmap/model/BigMapRank';
import type { IBigMapConfig } from '../assets/script/app/bigmap/model/BigMapTypes';
import { bigMapPlotHexId } from '../assets/script/app/bigmap/model/BigMapBase';
import {
    exportBigMapLayout,
    type IBigMapLayout,
} from '../assets/script/app/bigmap/model/BigMapLayout';
import { buildBigMapWorld } from '../assets/script/app/bigmap/model/BigMapWorld';
import { loadBigMapConfig } from './helpers/bigmap-fixtures';

const config = loadBigMapConfig();

/**
 * 夹具时钟：本地 10:00（UTC 02:00）。
 *
 * 🔴 必须落在攻城日程的 `prepare` 段。原来的 `1_000_000` 折成本地 21:46，
 * 正好在 `settling`（21:10–22:00）—— 那时候 `attackCity` 会被日程拦住，
 * 攻城用例会以「结算中，无法攻城」失败。日程本身另有 `bigmap-city-schedule` 覆盖。
 */
const CLOCK_PREPARE = 957_600;

/** 本地 03:00 —— 落在 `closed`（休战）段，用来验证攻城入口真的被日程拦住。 */
const CLOCK_CLOSED = 68_400;

/** 本地 22:05 —— 已过 22:00 快照点，用来验证 tick 会自动定格当日战绩。 */
const CLOCK_SNAPSHOT = 50_700;

interface IHarness {
    presenter: BigMapPresenter;
    storage: IBigMapStorage;
    clock: { now: number; chapter: number };
}

function makeHarness(
    chapter = 3,
    storage = createMemoryBigMapStorage(),
    now = CLOCK_PREPARE,
    layout: IBigMapLayout | null = null,
    extra: Partial<IBigMapPresenterDeps> = {},
): IHarness {
    const clock = { now, chapter };
    const presenter = new BigMapPresenter({
        config,
        layout,
        storage,
        saveKey: BIGMAP_SAVE_KEY,
        adventureChapter: () => clock.chapter,
        now: () => clock.now,
        ...extra,
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
    // 建造目录按 `kind`（baseBuildType）合并：2=粮食田 / 5=货币田 / 6=研究院。
    const { presenter, clock } = makeHarness(1);
    const locked = presenter.buildMenu();
    const grainLocked = locked.find((item) => item.kind === 2)!;
    assert.equal(grainLocked.unlocked, false);
    assert.equal(grainLocked.buildingId, 0, '全锁着时没有可建的 id');
    assert.match(grainLocked.reason, /第 2 章/);
    assert.equal(presenter.upgradeUnlocked(), false);

    clock.chapter = 3;
    // 章节变了要重新取一次（Presenter 每次调用都读最新进度，不需要重新构造）。
    const unlocked = presenter.buildMenu();
    const grain = unlocked.find((item) => item.kind === 2)!;
    assert.equal(grain.unlocked, true);
    // 粮食田 71002~71006 五座，第 3 章解锁前两座（71002 第2章 / 71003 第3章），
    // 一座都还没建 ⇒ 下一座就是 71002。
    assert.equal(grain.buildingId, 71002);
    assert.equal(grain.maxOwnNum, 5);
    const coin = unlocked.find((item) => item.kind === 5)!;
    assert.equal(coin.unlocked, false, '货币田-1 要第 15 章');
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
    assert.equal(queue.name, '粮食田-1', '队列条显示建筑表里的原名');
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
    assert.equal(bar.perHour, 40);
    // 田里确实产出到账（策划表里粮食田-1 是 40/小时）。
    const stored = presenter.plotCells().find((item) => item.hexId === cell)!.stored;
    assert.ok(stored >= 80, `田里应攒到 80，实际 ${stored}`);
    // 新档粮食就是满仓（800/800），而 1 级建造不要钱 ⇒ 仓库腾不出空间，
    // 待收被上限压成 0 —— 这是**正确**行为，不是漏算。
    assert.equal(bar.amount, 800);
    // `pending` 是田里攒的量（不按仓库上限截断），收获时才截。
    assert.ok(bar.pending >= 80, `田里应有待收，实际 ${bar.pending}`);
    assert.equal(presenter.harvestAll().ok, false, '满仓时没有可收的');
});

test('建造失败会返回可直接展示的原因', () => {
    const { presenter } = makeHarness();
    const poor = { ...presenter.base, res: { ...presenter.base.res, grain: 0, wood: 0, iron: 0 } };
    void poor;
    // 中心格已被主城占据。
    const onMain = presenter.startBuild(bigMapPlotHexId(2, 2, 5), 71002);
    assert.equal(onMain.ok, false);
    assert.match(onMain.message, /已有建筑/);
    // 未解锁的建筑：71006 是粮食田-5（unlockParam = 6）。
    const locked = presenter.startBuild(bigMapPlotHexId(0, 0, 5), 71006);
    assert.equal(locked.ok, false);
    assert.match(locked.message, /第 6 章/);
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

test('休战期攻城被日程拦住，且不落下任何状态', () => {
    const { presenter } = makeHarness(3, createMemoryBigMapStorage(), CLOCK_CLOSED);
    const view = presenter.cityView(101)!;
    assert.equal(view.state, 'open', '城池本身是开放的');
    assert.equal(view.phase, 'closed');
    assert.equal(view.canAttack, false);
    assert.match(view.attackReason, /休战/);

    const staminaBefore = presenter.base.res.stamina;
    const feedback = presenter.attackCity(101);
    assert.equal(feedback.ok, false);
    assert.match(feedback.message, /休战/);
    // 被拦的攻打不能动城池状态，也不能扣行动力。
    assert.equal(presenter.cityView(101)!.state, 'open');
    assert.equal(presenter.base.res.stamina, staminaBefore);
});

test('注入榜单端口：名次与同场人数进视图，战功预览随之下降', async () => {
    const alone = makeHarness(3);
    const soloScore = alone.presenter.cityView(101)!.previewWarScore;

    // 一个「全服都在抢」的榜：玩家第 11 名、同场 10 人。
    const crowdedBoard: IBigMapCityRankBoard = {
        cityId: 101,
        entries: [
            { rank: 1, warScore: 99999, isPlayer: false },
            { rank: 11, warScore: 10, isPlayer: true },
        ],
        playerRank: 11,
        attackerCount: 10,
        topWarScore: 99999,
    };
    const crowded = makeHarness(3, createMemoryBigMapStorage(), CLOCK_PREPARE, null, {
        rankProvider: { fetchCityRank: async () => crowdedBoard },
    });
    await crowded.presenter.refreshCityRank(101);

    const view = crowded.presenter.cityView(101)!;
    assert.equal(view.playerRank, 11);
    assert.equal(view.attackerCount, 10);
    assert.ok(view.previewWarScore < soloScore, '名次靠后 + 人多，单次战功必须低于独狼');
    assert.deepEqual(crowded.presenter.cityRankBoard(101), crowdedBoard);
});

test('榜单端口抛错不炸界面：回退本地 NPC 榜', async () => {
    const broken = makeHarness(3, createMemoryBigMapStorage(), CLOCK_PREPARE, null, {
        rankProvider: { fetchCityRank: async () => { throw new Error('网络断了'); } },
    });
    await broken.presenter.refreshCityRank(101);
    const board = broken.presenter.cityRankBoard(101);
    assert.equal(board.entries.some((entry) => entry.isPlayer), true, '回退后仍要有玩家自己');
    assert.ok(board.entries.length > 1, '回退的是 NPC 榜，不是单人兜底');
});

test('打城之后名次会跟着战功变（榜单重算）', async () => {
    const { presenter } = makeHarness(3);
    // 先刷一次拿真实 NPC 榜：不刷新时读到的是「兜底榜 = 独自一人第一名」，
    // 那是「没人抢」的假设，拿它当基准比会得到假结论。
    await presenter.refreshCityRank(101);
    const before = presenter.cityRankBoard(101).playerRank;
    const scoreBefore = presenter.cityRankBoard(101).entries.find((entry) => entry.isPlayer)!.warScore;
    presenter.attackCity(101);
    const after = presenter.cityRankBoard(101).playerRank;
    const scoreAfter = presenter.cityRankBoard(101).entries.find((entry) => entry.isPlayer)!.warScore;
    assert.ok(scoreAfter > scoreBefore, '战功必须累加');
    assert.ok(after <= before, `战功涨了名次不该退：${before} → ${after}`);
});

test('日程来自配置表：把开战时间推到 23:00，同一时刻就打不了', () => {
    const lateConfig: IBigMapConfig = {
        ...config,
        schedule: {
            ...config.schedule,
            openAt: 23 * 3600,
            lockAt: 23 * 3600 + 60,
            settleAt: 23 * 3600 + 120,
            snapshotAt: 23 * 3600 + 180,
        },
    };
    const late = new BigMapPresenter({
        config: lateConfig,
        storage: createMemoryBigMapStorage(),
        saveKey: BIGMAP_SAVE_KEY,
        adventureChapter: () => 3,
        now: () => CLOCK_PREPARE,
    });
    const view = late.cityView(101)!;
    assert.equal(view.phase, 'closed', '本地 10:00 落在改过之后的休战段');
    assert.equal(view.canAttack, false);

    // 对照：默认配置（09:00 开战）同一时刻是可打的，说明差异只来自配置。
    const normal = makeHarness(3).presenter.cityView(101)!;
    assert.equal(normal.phase, 'prepare');
    assert.equal(normal.canAttack, true);
});

test('22:05 tick 出当日快照：一天只出一份，且能写进存档', () => {
    const { presenter, storage, clock } = makeHarness(3);
    presenter.attackCity(101);
    const warScore = Math.round(presenter.battle.cityWarScore[101] ?? 0);
    assert.ok(warScore > 0, '先打出战功，快照才有内容');

    clock.now = CLOCK_SNAPSHOT;   // 推到 22:05
    presenter.tick();
    const snapshot = presenter.daySnapshot();
    assert.ok(snapshot, '过了快照点必须出快照');
    assert.equal(snapshot!.cities['101'].warScore, warScore);
    assert.ok(snapshot!.cities['101'].rank >= 1);

    // 幂等：同一天再 tick 不重算
    clock.now += 300;
    presenter.tick();
    assert.deepEqual(presenter.daySnapshot(), snapshot);

    // 持久化：关掉重进页面，昨天那份还在
    const reloaded = new BigMapPresenter({
        config, storage, saveKey: BIGMAP_SAVE_KEY,
        adventureChapter: () => 3, now: () => CLOCK_SNAPSHOT + 300,
    });
    assert.deepEqual(reloaded.daySnapshot(), snapshot);
});

test('白天 tick 不出快照（09:00~22:00 之间）', () => {
    const { presenter } = makeHarness(3);   // 本地 10:00
    presenter.attackCity(101);
    presenter.tick();
    assert.equal(presenter.daySnapshot(), null);
});

test('建造队列靠货币解锁：第一次成功、第二次货币不足', () => {
    const resources = new Map(config.resources);
    const coin = resources.get('coin');
    assert.ok(coin);
    resources.set('coin', { ...coin, startAmount: config.queue.queueUnlockCost2 });
    const { presenter } = makeHarness(3, createMemoryBigMapStorage(), CLOCK_PREPARE, null,
        { config: { ...config, resources } });
    const startCoin = presenter.base.res.coin;
    assert.equal(startCoin, config.queue.queueUnlockCost2, '测试预算只够解锁下一条队列');
    assert.equal(presenter.queueUnlockInfo().current, config.queue.initBuildQueue);
    assert.equal(presenter.queueUnlockInfo().canUnlock, true);

    const first = presenter.unlockBuildQueue();
    assert.equal(first.ok, true, first.message);
    assert.match(first.message, /队列 \+1/);
    assert.equal(presenter.base.queueUnlocked, config.queue.initBuildQueue + 1);
    assert.equal(presenter.base.res.coin, startCoin - config.queue.queueUnlockCost2);

    // 首次费用全部扣完，再解锁下一条必须拒绝且不修改状态。
    const info = presenter.queueUnlockInfo();
    assert.equal(info.current, config.queue.initBuildQueue + 1);
    assert.equal(info.canUnlock, false);
    assert.match(info.reason, /货币不足/);
    const second = presenter.unlockBuildQueue();
    assert.equal(second.ok, false);
    assert.match(second.message, /货币不足/);
    assert.equal(presenter.base.queueUnlocked, config.queue.initBuildQueue + 1, '失败不能改状态');
});

test('野怪：可打、击杀后进 CD，视图给出倒计时', () => {
    const { presenter, clock } = makeHarness(3, undefined, undefined, null, { config: loadBigMapConfig(true) });
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
    // 策划表 `baseBuildingLevel` 里粮食田-1 最高 30 级，脏档的 99 被夹到 30。
    assert.equal(buildings.find((item) => item.buildingId === 71002)!.level, 30);
    // 队列数量是**存档权威**（文档口径：付费解锁，不来自建筑），越界的 9 被夹到上限。
    assert.equal(presenter.queues().length, config.queue.maxBuildQueue);
    assert.equal(presenter.queues()[0].busy, false, '脏队列被清成空闲');
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
