/**
 * 基地建造 / 产出 / 收获 / 队列 的回归测试。
 *
 * 这些规则一旦算错，玩家看到的是「资源凭空多了/少了」，很难在界面上一眼看出来，
 * 所以每个动作都断言到具体数值，而不是只断言「成功了」。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    bigMapCanPlace,
    bigMapCanUpgrade,
    bigMapCancelQueue,
    bigMapHarvest,
    bigMapHarvestAll,
    bigMapMainBuilding,
    bigMapMainLevel,
    bigMapPendingHarvest,
    bigMapPlotCenterHexId,
    bigMapPlotHexId,
    bigMapProducePerHour,
    bigMapUnlockQueue,
    bigMapResCap,
    bigMapStartBuild,
    bigMapStartUpgrade,
    bigMapTick,
    createBigMapBaseState,
} from '../assets/script/app/bigmap/model/BigMapBase';
import { BigMapQueueState } from '../assets/script/app/bigmap/model/BigMapTypes';
import type { IBigMapBaseState } from '../assets/script/app/bigmap/model/BigMapTypes';
import { loadBigMapConfig, makeUnlockContext } from './helpers/bigmap-fixtures';

const config = loadBigMapConfig();
const NOW = 1_000_000;
// 策划表 `baseBuilding`：每座田各占一个 id
// （粮食田 71002~71006、木材田 71007~71011、铁矿田 71012~71014、货币田 71015）。
const GRAIN_FIELD = 71002;
const WOOD_FIELD = 71007;
const IRON_FIELD = 71012;
const MAIN = 71001;

/** 把时间推到 `seconds` 秒后并结算（`seconds` 是**相对 NOW 的绝对偏移**，便于连续跳）。 */
function advance(state: IBigMapBaseState, seconds: number) {
    return bigMapTick(config, state, NOW + seconds).state;
}

test('新基地：主城落在建造区中心，资源取初始值', () => {
    const state = createBigMapBaseState(config, NOW);
    const main = bigMapMainBuilding(config, state)!;
    assert.equal(main.buildingId, MAIN);
    assert.equal(main.level, 1);
    assert.equal(main.hexId, bigMapPlotCenterHexId(5, 5));
    assert.equal(state.buildings.length, 1);
    assert.equal(state.res.grain, 800);
    assert.equal(state.res.coin, 200);
    assert.equal(state.stamina, config.stamina.staminaMax);
    assert.equal(state.queueUnlocked, config.queue.initBuildQueue);
    assert.equal(state.queues.length, config.queue.maxBuildQueue);
    assert.equal(state.queues.every((slot) => slot.state === BigMapQueueState.Idle), true);
});

test('建筑解锁没到章节就摆不下去', () => {
    const state = createBigMapBaseState(config, NOW);
    const free = bigMapPlotHexId(1, 1, 5);
    const locked = bigMapCanPlace(config, state, makeUnlockContext({ adventureChapter: 1 }), GRAIN_FIELD, free);
    assert.equal(locked.ok, false);
    assert.match(locked.reason, /第 2 章/);
    const ok = bigMapCanPlace(config, state, makeUnlockContext({ adventureChapter: 2 }), GRAIN_FIELD, free);
    assert.equal(ok.ok, true);
});

test('摆放会扣资源、占队列，同一格不能重复摆', () => {
    // 章节给足：木材田-1 是 71007（unlockParam = 7），否则占位检查前先被章节拦住。
    const unlock = makeUnlockContext({ adventureChapter: 10 });
    let state = createBigMapBaseState(config, NOW);
    const cell = bigMapPlotHexId(1, 1, 5);
    const started = bigMapStartBuild(config, state, unlock, GRAIN_FIELD, cell, NOW);
    assert.equal(started.ok, true);
    state = started.state!;
    // 策划表里粮食田-1 的 1 级建造成本全是 0（第一座田白给，成本压到升 2 级）。
    assert.equal(state.res.grain, 800);
    assert.equal(state.res.wood, 800);
    assert.equal(state.res.iron, 800);
    assert.equal(state.queues[0].state, BigMapQueueState.Building);
    assert.equal(state.queues[0].finishAt, NOW + 20);

    // 同一格再摆：被占位拦住。
    const again = bigMapCanPlace(config, state, unlock, WOOD_FIELD, cell);
    assert.equal(again.ok, false);
    assert.match(again.reason, /已有建筑/);
    // 中心格是主城，也摆不下。
    const center = bigMapCanPlace(config, state, unlock, WOOD_FIELD, bigMapPlotCenterHexId(5, 5));
    assert.equal(center.ok, false);
});

test('队列上限为配置值：初始 1 个，满了就排不进去', () => {
    // 章节给足（木材田 unlockParam = 7），否则先被「章节未通关」拦住，测不到队列。
    const unlock = makeUnlockContext({ adventureChapter: 10 });
    let state = createBigMapBaseState(config, NOW);
    state = bigMapStartBuild(config, state, unlock, GRAIN_FIELD, bigMapPlotHexId(1, 1, 5), NOW).state!;
    const second = bigMapCanPlace(config, state, unlock, WOOD_FIELD, bigMapPlotHexId(1, 2, 5));
    assert.equal(second.ok, false);
    assert.match(second.reason, /队列/);
});

test('计时结束建筑落地，资源田开始累积并在上限处封顶', () => {
    const unlock = makeUnlockContext({ adventureChapter: 2 });
    let state = createBigMapBaseState(config, NOW);
    state = bigMapStartBuild(config, state, unlock, GRAIN_FIELD, bigMapPlotHexId(1, 1, 5), NOW).state!;

    // 还没到 20s：队列仍在进行中。
    const before = bigMapTick(config, state, NOW + 19);
    assert.equal(before.completed.length, 0);
    assert.equal(before.state.buildings.length, 1);

    const after = bigMapTick(config, state, NOW + 20);
    assert.equal(after.completed.length, 1);
    const built = after.state.buildings.find((item) => item.buildingId === GRAIN_FIELD)!;
    assert.equal(built.level, 1);
    assert.equal(after.state.queues[0].state, BigMapQueueState.Idle);

    // 攒 1 小时应正好 40。
    const oneHour = advance(after.state, 3600 + 20);
    const field = oneHour.buildings.find((item) => item.buildingId === GRAIN_FIELD)!;
    assert.ok(Math.abs(field.stored - 40) < 0.001, `1 小时应攒 40，实际 ${field.stored}`);

    // 一次跳 100 小时：离线折扣生效，只结算 offlineMaxHours = 8 小时 ⇒ 40 + 320 = 360。
    const jumped = advance(oneHour, 3600 * 100);
    const clampedField = jumped.buildings.find((item) => item.buildingId === GRAIN_FIELD)!;
    assert.ok(Math.abs(clampedField.stored - 360) < 0.001, `离线应只结算 8 小时，实际 ${clampedField.stored}`);

    // 在线逐小时结算才可能攒到 produceCap = 480（每次只结算 1 小时，不吃离线折扣）。
    let online = jumped;
    for (let hour = 1; hour <= 10; hour += 1) online = advance(online, 3600 * 100 + 3600 * hour);
    const capped = online.buildings.find((item) => item.buildingId === GRAIN_FIELD)!;
    assert.ok(Math.abs(capped.stored - 480) < 0.001, `应封顶 480，实际 ${capped.stored}`);
    assert.equal(bigMapProducePerHour(config, online).grain, 40);
});

test('收获受资源栏上限截断（主城 1 级只有 800）', () => {
    const unlock = makeUnlockContext({ adventureChapter: 2 });
    // 新建档资源就是满的（800），不手动降到 700 就测不出「截断」—— 满仓时收获是 0。
    const fresh = createBigMapBaseState(config, NOW);
    let state = { ...fresh, res: { ...fresh.res, grain: 700 } };
    state = bigMapStartBuild(config, state, unlock, GRAIN_FIELD, bigMapPlotHexId(1, 1, 5), NOW).state!;
    state = bigMapTick(config, state, NOW + 20).state;
    // 逐小时攒 4 小时 = 160，比仓库剩余空间 100 多。
    for (let hour = 1; hour <= 4; hour += 1) state = advance(state, hour * 3600 + 20);
    assert.equal(state.res.grain, 700);
    assert.equal(bigMapResCap(config, state, 'grain'), 800);
    const field = state.buildings.find((item) => item.buildingId === GRAIN_FIELD)!;
    assert.ok(field.stored > 100);

    const harvested = bigMapHarvest(config, state, field.instanceId);
    assert.equal(harvested.amount, 100);
    assert.equal(harvested.capped, true);
    assert.equal(harvested.state.res.grain, 800);
    assert.ok(harvested.state.buildings.find((item) => item.instanceId === field.instanceId)!.stored > 0);

    // 收完之后再收：仓库满，拿不到东西。
    const again = bigMapHarvest(config, harvested.state, field.instanceId);
    assert.equal(again.amount, 0);
    assert.equal(again.capped, true);
});

test('一键收取按资源类型汇总', () => {
    const unlock = makeUnlockContext({ adventureChapter: 2 });
    let state = createBigMapBaseState(config, NOW);
    state = bigMapStartBuild(config, state, unlock, GRAIN_FIELD, bigMapPlotHexId(1, 1, 5), NOW).state!;
    state = bigMapTick(config, state, NOW + 20).state;
    state = advance(state, 3600 + 20);
    // 花掉一些粮食，给收获腾出空间。
    state = { ...state, res: { ...state.res, grain: 0, wood: 0, iron: 0 } };
    const pending = bigMapPendingHarvest(config, state);
    assert.ok(pending.grain > 0);
    const all = bigMapHarvestAll(config, state);
    assert.ok(all.gained.grain > 0);
    assert.equal(all.state.res.grain, Math.floor(pending.grain));
    assert.equal(bigMapPendingHarvest(config, all.state).grain < 1, true);
});

test('升级功能第 3 章才解锁，且受主城等级与前置建筑限制', () => {
    let state = createBigMapBaseState(config, NOW);
    const main = bigMapMainBuilding(config, state)!;

    const locked = bigMapCanUpgrade(config, state, makeUnlockContext({ adventureChapter: 2 }), main.instanceId);
    assert.equal(locked.ok, false);
    assert.match(locked.reason, /第 3 章/);

    const unlock = makeUnlockContext({ adventureChapter: 12 });
    // 策划表里主城升 2 级的前置是**两个**：[木材田-1(71007) Lv1, 铁矿田-1(71012) Lv1]。
    // 早期单值 `preBuildId` 的模型没有这一步，换表后必须先把两座田落地。
    const missing = bigMapCanUpgrade(config, state, unlock, main.instanceId);
    assert.equal(missing.ok, false);
    assert.match(missing.reason, /前置|升到 1 级|需先将/);

    state = { ...state, res: { ...state.res, grain: 5000, wood: 5000, iron: 5000 } };
    state = bigMapStartBuild(config, state, unlock, WOOD_FIELD, bigMapPlotHexId(1, 1, 5), NOW).state!;
    state = bigMapTick(config, state, NOW + 20).state;
    state = bigMapStartBuild(config, state, unlock, IRON_FIELD, bigMapPlotHexId(1, 2, 5), NOW + 20).state!;
    state = bigMapTick(config, state, NOW + 40).state;

    const ok = bigMapCanUpgrade(config, state, unlock, main.instanceId);
    assert.equal(ok.ok, true);

    // 主城先升到 2 级。
    const started = bigMapStartUpgrade(config, state, unlock, main.instanceId, NOW + 40);
    assert.equal(started.ok, true);
    state = bigMapTick(config, started.state!, NOW + 160).state;
    assert.equal(bigMapMainLevel(config, state), 2);
    // 资源栏上限跟着主城涨。
    assert.equal(bigMapResCap(config, state, 'grain'), 2262);

    // 其它建筑不能超过主城等级：把粮食田建出来（1 级），主城已 2 级，升 2 级应该放行。
    // 主城升级已把钱花掉大半，这里补足资源 —— 本用例验的是规则顺序，不是经济平衡。
    state = { ...state, res: { ...state.res, grain: 5000, wood: 5000, iron: 5000 } };
    state = bigMapStartBuild(config, state, unlock, GRAIN_FIELD, bigMapPlotHexId(1, 3, 5), NOW + 200).state!;
    state = bigMapTick(config, state, NOW + 220).state;
    const field = state.buildings.find((item) => item.buildingId === GRAIN_FIELD)!;
    assert.equal(bigMapCanUpgrade(config, state, unlock, field.instanceId).ok, true);
});

test('非主城不得高于主城等级', () => {
    const unlock = makeUnlockContext({ adventureChapter: 4 });
    // 主城先升到 3 级，再把田升到 2 级后尝试升 3 级以外的情况：
    // 这里直接构造「主城 1 级 + 田 2 级」的非法存档状态，验证规则能拦住。
    let state = createBigMapBaseState(config, NOW);
    state = bigMapStartBuild(config, state, makeUnlockContext({ adventureChapter: 2 }), GRAIN_FIELD, bigMapPlotHexId(1, 1, 5), NOW).state!;
    state = bigMapTick(config, state, NOW + 30).state;
    const field = state.buildings.find((item) => item.buildingId === GRAIN_FIELD)!;
    const forged: IBigMapBaseState = {
        ...state,
        buildings: state.buildings.map((item) => (
            item.instanceId === field.instanceId ? { ...item, level: 2 } : item
        )),
    };
    const check = bigMapCanUpgrade(config, forged, unlock, field.instanceId);
    assert.equal(check.ok, false);
    assert.match(check.reason, /主城等级/);
});

test('取消建造按配置比例退资源', () => {
    const unlock = makeUnlockContext({ adventureChapter: 2 });
    let state = createBigMapBaseState(config, NOW);
    state = bigMapStartBuild(config, state, unlock, GRAIN_FIELD, bigMapPlotHexId(1, 1, 5), NOW).state!;
    const cancelled = bigMapCancelQueue(config, state, 0);
    assert.equal(cancelled.ok, true);
    assert.equal(cancelled.state!.res.grain, 800);
    assert.equal(cancelled.state!.res.wood, 800);
    assert.equal(cancelled.state!.res.iron, 800);
    assert.equal(cancelled.state!.queues[0].state, BigMapQueueState.Idle);
    // 空队列取消要报错，不能静默成功。
    assert.equal(bigMapCancelQueue(config, cancelled.state!, 0).ok, false);
});

test('每座建筑上限 1：同类不同 id 各建一座，同一个 id 不能重复', () => {
    // 策划表 `baseBuilding` 把「粮食田 5 座」拆成 71002~71006 五个 id，每座 `baseBuildMaxNum = 1`。
    // 所以"数量上限"现在按 id 判，不是按「这一类最多 3 个」。
    const unlock = makeUnlockContext({ adventureChapter: 10 });
    let state = createBigMapBaseState(config, NOW);
    state = { ...state, queueUnlocked: config.queue.maxBuildQueue, res: { ...state.res, grain: 99999, wood: 99999, iron: 99999 } };
    const ids = [71002, 71003, 71004];
    const cells = [bigMapPlotHexId(0, 0, 5), bigMapPlotHexId(0, 1, 5), bigMapPlotHexId(0, 2, 5)];
    for (const [index, id] of ids.entries()) {
        const result = bigMapStartBuild(config, state, unlock, id, cells[index], NOW);
        assert.equal(result.ok, true, result.reason);
        state = result.state!;
    }
    // 排队中也算数量：同一个 id 再排一座立刻被上限拦住。
    const dup = bigMapCanPlace(config, state, unlock, 71002, bigMapPlotHexId(1, 0, 5));
    assert.equal(dup.ok, false);
    assert.match(dup.reason, /最多建造 1 个/);

    state = bigMapTick(config, state, NOW + 30).state;
    assert.equal(state.buildings.length, 4, '主城 + 三座不同的粮食田');
    for (const id of ids) {
        assert.equal(state.buildings.filter((item) => item.buildingId === id).length, 1);
    }
});

test('建造队列靠货币解锁，不来自建筑（文档口径）', () => {
    // 章节给足：下面要同时建粮食田-1(71002, 第2章) + 木材田-1(71007, 第7章)。
    const unlock = makeUnlockContext({ adventureChapter: 12 });
    let state = createBigMapBaseState(config, NOW);
    assert.equal(state.queueUnlocked, config.queue.initBuildQueue);

    // 货币不足不许解锁，且不扣任何东西
    const poor = bigMapUnlockQueue(config, { ...state, res: { ...state.res, coin: 0 } });
    assert.equal(poor.ok, false);
    assert.match(poor.reason, /货币不足/);
    assert.equal(poor.state, null);

    // 1 → 2 收 queueUnlockCost2
    state = { ...state, res: { ...state.res, coin: 99999 } };
    const coinBefore = state.res.coin;
    const first = bigMapUnlockQueue(config, state);
    assert.equal(first.ok, true, first.reason);
    assert.equal(first.cost, config.queue.queueUnlockCost2);
    state = first.state!;
    assert.equal(state.queueUnlocked, 2);
    assert.equal(state.res.coin, coinBefore - config.queue.queueUnlockCost2);

    // 2 → 3 收 queueUnlockCost3；到上限后再解锁被拒
    const second = bigMapUnlockQueue(config, state);
    assert.equal(second.cost, config.queue.queueUnlockCost3);
    state = second.state!;
    assert.equal(state.queueUnlocked, config.queue.maxBuildQueue);
    assert.equal(bigMapUnlockQueue(config, state).ok, false, '已到上限');
    assert.match(bigMapUnlockQueue(config, state).reason, /已满/);

    // 真有两条能同时开工
    state = { ...state, res: { ...state.res, grain: 9999, wood: 9999, iron: 9999 } };
    state = bigMapStartBuild(config, state, unlock, GRAIN_FIELD, bigMapPlotHexId(0, 0, 5), NOW + 100).state!;
    const parallel = bigMapStartBuild(config, state, unlock, WOOD_FIELD, bigMapPlotHexId(0, 1, 5), NOW + 100);
    assert.equal(parallel.ok, true, parallel.reason);
});

test('离线结算被 offlineMaxHours 截断', () => {
    const unlock = makeUnlockContext({ adventureChapter: 2 });
    let state = createBigMapBaseState(config, NOW);
    state = bigMapStartBuild(config, state, unlock, GRAIN_FIELD, bigMapPlotHexId(1, 1, 5), NOW).state!;
    state = bigMapTick(config, state, NOW + 20).state;
    // 离线 30 天：只结算 8 小时（配置 offlineMaxHours = 8），但产田上限 12 小时 ⇒ 8 小时 × 40 = 320。
    const back = advance(state, 3600 * 24 * 30);
    const field = back.buildings.find((item) => item.buildingId === GRAIN_FIELD)!;
    assert.ok(Math.abs(field.stored - 320) < 0.001, `离线应结算 320，实际 ${field.stored}`);
    // 行动力按 6 分钟 1 点恢复，但不超过上限。
    assert.equal(back.stamina, config.stamina.staminaMax);
});
