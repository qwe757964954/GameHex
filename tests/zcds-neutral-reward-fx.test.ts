import assert from 'node:assert/strict';
import test from 'node:test';
import { loadViews } from './helpers/zcds-view-fixtures';
import {
    ZCBattlePresentationQueue,
    ZC_NEUTRAL_REWARD_COIN_COUNT,
    ZC_NEUTRAL_REWARD_COIN_STAGGER,
    ZC_NEUTRAL_REWARD_FLY_SECONDS,
    ZC_NEUTRAL_REWARD_RISE_SECONDS,
    ZC_NEUTRAL_REWARD_TOTAL_SECONDS,
} from '../assets/script/app/zcds/model/ZCBattlePresentationQueue';
import { installZCNeutralTestCatalog, ZC_TEST_ITEM } from './helpers/zcds-neutral-catalog';

installZCNeutralTestCatalog();

// ============================================================
// 一、队列：`pushNeutralReward` / `prune` / `reset` 的数值口径
// ============================================================

test('队列：金币事件字段齐全、时长 = 飞行 + 错峰 + 上飘', () => {
    const queue = new ZCBattlePresentationQueue();
    const reward = queue.pushNeutralReward({
        now: 1.5, hexId: 7, itemId: ZC_TEST_ITEM.Gold, owner: 'player', gold: 50, artifactCharge: 0,
    });
    assert.ok(reward);
    assert.equal(reward.id, 1);
    assert.equal(reward.hexId, 7);
    assert.equal(reward.itemId, ZC_TEST_ITEM.Gold);
    assert.equal(reward.owner, 'player');
    assert.equal(reward.gold, 50);
    assert.equal(reward.artifactCharge, 0);
    assert.equal(reward.startedAt, 1.5);
    assert.equal(reward.durationSeconds, ZC_NEUTRAL_REWARD_TOTAL_SECONDS);
    assert.equal(
        ZC_NEUTRAL_REWARD_TOTAL_SECONDS,
        ZC_NEUTRAL_REWARD_FLY_SECONDS
            + ZC_NEUTRAL_REWARD_COIN_STAGGER * (ZC_NEUTRAL_REWARD_COIN_COUNT - 1)
            + ZC_NEUTRAL_REWARD_RISE_SECONDS,
        '总长 = 飞行 + 错峰尾 + 上飘（视图时间轴同源）',
    );
    assert.deepEqual(queue.neutralRewards, [reward]);
});

test('队列：金额取整，负数 / 非有限一律拒收（不进队列）', () => {
    const queue = new ZCBattlePresentationQueue();
    assert.equal(queue.pushNeutralReward({
        now: 0, hexId: 1, itemId: ZC_TEST_ITEM.Gold, owner: 'player', gold: 49.6, artifactCharge: 0,
    })?.gold, 50, '金币四舍五入');
    assert.equal(queue.pushNeutralReward({
        now: 0, hexId: 2, itemId: ZC_TEST_ITEM.BigChest, owner: 'player', gold: 100, artifactCharge: 0.6,
    })?.artifactCharge, 1, '充能四舍五入');

    // 拒收：数量不能脏（会直接变成「+N」文案）。
    for (const gold of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
        assert.equal(queue.pushNeutralReward({
            now: 0, hexId: 3, itemId: ZC_TEST_ITEM.Gold, owner: 'player', gold, artifactCharge: 0,
        }), null, `gold=${gold} 应拒收`);
    }
    for (const charge of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
        assert.equal(queue.pushNeutralReward({
            now: 0, hexId: 4, itemId: ZC_TEST_ITEM.MixedCharge, owner: 'player', gold: 0, artifactCharge: charge,
        }), null, `artifactCharge=${charge} 应拒收`);
    }
    assert.equal(queue.neutralRewards.length, 2, '只有两次合法 push 入队');
});

test('队列：上限 16 丢最旧，不阻塞新事件', () => {
    const queue = new ZCBattlePresentationQueue();
    for (let i = 1; i <= 20; i += 1) {
        queue.pushNeutralReward({ now: i, hexId: i, itemId: ZC_TEST_ITEM.Gold, owner: 'player', gold: 10, artifactCharge: 0 });
    }
    assert.equal(queue.neutralRewards.length, 16);
    assert.equal(queue.neutralRewards[0].id, 5, '丢的是最旧的 4 条');
    assert.equal(queue.neutralRewards[15].id, 20, '最新的保住');
});

test('队列：prune 到点摘除，reset 清空且 id 从 1 重新编号', () => {
    const queue = new ZCBattlePresentationQueue();
    queue.pushNeutralReward({ now: 0, hexId: 1, itemId: ZC_TEST_ITEM.Gold, owner: 'player', gold: 50, artifactCharge: 0 });
    assert.equal(queue.neutralRewards.length, 1);
    // 与其它队列同口径：`now >= startedAt + durationSeconds` 即摘除（边界含）。
    queue.prune(ZC_NEUTRAL_REWARD_TOTAL_SECONDS - 0.001);
    assert.equal(queue.neutralRewards.length, 1, '时长边界前还在');
    queue.prune(ZC_NEUTRAL_REWARD_TOTAL_SECONDS + 0.001);
    assert.equal(queue.neutralRewards.length, 0, '过期即摘除');

    queue.pushNeutralReward({ now: 0, hexId: 2, itemId: ZC_TEST_ITEM.Gold, owner: 'player', gold: 50, artifactCharge: 0 });
    queue.reset();
    assert.equal(queue.neutralRewards.length, 0, 'reset 清空队列');
    assert.equal(queue.pushNeutralReward({
        now: 0, hexId: 3, itemId: ZC_TEST_ITEM.Gold, owner: 'player', gold: 50, artifactCharge: 0,
    })?.id, 1, '换局后 id 重新从 1 开始（判据与其它队列 reset 同口径）');
});

// ============================================================
// 二、特效纯函数：曲线确定性 / 时间轴 / 冻结落点
// ============================================================

test('金币曲线：同 seed 同帧可复现（确定性），不同 index 有抖动', () => {
    const { load } = loadViews();
    const { neutralRewardCoinPoint } = load('./ZCNeutralRewardFx');
    const start = { x: 100, y: 200 };
    const target = { x: 500, y: 50 };
    const a = neutralRewardCoinPoint(11, 0, start, target, 0.4);
    const b = neutralRewardCoinPoint(11, 0, start, target, 0.4);
    assert.deepEqual(a, b, '同一 (seed,index,start,target,t) 必须逐值相等');
    const c = neutralRewardCoinPoint(11, 1, start, target, 0.4);
    assert.notDeepEqual(c, a, '不同 index 起点抖动不同（一把金币散开）');
    // 弧线中点应明显拱起（控制点在起终点中点正上方）。
    const mid = neutralRewardCoinPoint(11, 0, start, target, 0.5);
    const linearMidY = (start.y + target.y) / 2;
    assert.ok(mid.y > linearMidY + 10, `t=0.5 应高过线性中点（实际 ${mid.y} vs ${linearMidY}）`);
});

test('金币时间轴：错峰出发 → 飞行 → 落地后位置冻结线性淡出', () => {
    const { load } = loadViews();
    const { neutralRewardCoinFrame, ZC_NEUTRAL_REWARD_COIN_FADE_SECONDS } = load('./ZCNeutralRewardFx');
    const start = { x: 0, y: 0 };
    const target = { x: 400, y: 0 };

    // 第 0 颗：起点前不可见；飞行中可见；落地段位置恒为 target、透明度递减。
    const before = neutralRewardCoinFrame(1, 0, 0, -0.01, start, target);
    assert.equal(before.visible, false, '起点前不显示');
    const flying = neutralRewardCoinFrame(1, 0, 0, 0.3, start, target);
    assert.equal(flying.visible, true);
    assert.ok(flying.x > 0 && flying.x < 400, '飞行中在起点与目标之间');
    assert.equal(flying.scale, 1 - 0.3 * 0.5, '飞行中整体轻微收缩（速度感）');
    const landing = neutralRewardCoinFrame(1, 0, 0, ZC_NEUTRAL_REWARD_FLY_SECONDS + 0.06, start, target);
    assert.equal(landing.visible, true);
    assert.equal(landing.x, 400, '落地后位置冻在落点');
    assert.equal(landing.y, 0);
    assert.ok(landing.opacity < 1 && landing.opacity > 0, '落地段线性淡出中');
    const gone = neutralRewardCoinFrame(1, 0, 0, ZC_NEUTRAL_REWARD_FLY_SECONDS + ZC_NEUTRAL_REWARD_COIN_FADE_SECONDS + 0.01, start, target);
    assert.equal(gone.visible, false, '淡出完毕即不可见');

    // 第 2 颗比第 1 颗晚一个错峰才出发。
    const secondEarly = neutralRewardCoinFrame(1, 1, 0, 0.03, start, target);
    assert.equal(secondEarly.visible, false, '第 2 颗未到错峰不显示');
});

test('「+N」上飘：等最后一颗金币落地后才开始，前段淡入、末段淡出', () => {
    const { load } = loadViews();
    const { neutralRewardRiseFrame, ZC_NEUTRAL_REWARD_RISE_LIFT_PX } = load('./ZCNeutralRewardFx');
    const labelStart = ZC_NEUTRAL_REWARD_FLY_SECONDS + ZC_NEUTRAL_REWARD_COIN_STAGGER * (ZC_NEUTRAL_REWARD_COIN_COUNT - 1);
    assert.equal(neutralRewardRiseFrame(0, labelStart - 0.01).visible, false, '最后一颗没落地不显示');
    const t10 = neutralRewardRiseFrame(0, labelStart + ZC_NEUTRAL_REWARD_RISE_SECONDS * 0.1);
    assert.equal(t10.visible, true);
    assert.ok(t10.y > 0, '开始上飘');
    assert.ok(t10.y < ZC_NEUTRAL_REWARD_RISE_LIFT_PX);
    assert.ok(t10.opacity > 0, '前段已淡入');
    const end = neutralRewardRiseFrame(0, labelStart + ZC_NEUTRAL_REWARD_RISE_SECONDS);
    assert.equal(end.visible, true, '边界处仍在（收尾由队列 prune 摘）');
    assert.ok(end.opacity < 0.2, '末段已基本淡出');
});

test('神器曲线：单飞 + 落地小幅放大淡出', () => {
    const { load } = loadViews();
    const { neutralRewardArtifactFrame, ZC_NEUTRAL_REWARD_ARTIFACT_POP } = load('./ZCNeutralRewardFx');
    const start = { x: 10, y: 20 };
    const target = { x: 310, y: 20 };
    assert.equal(neutralRewardArtifactFrame(0, -0.01, start, target).visible, false, '起点前不可见');
    const atStart = neutralRewardArtifactFrame(0, 0, start, target);
    assert.equal(atStart.visible, true);
    assert.equal(atStart.opacity, 0, '起点处淡入刚开始（透明）');
    assert.equal(atStart.x, 10, '起点处还没动');
    const mid = neutralRewardArtifactFrame(0, 0.3, start, target);
    assert.equal(mid.visible, true);
    assert.ok(mid.x > 10 && mid.x < 310, '飞行中在途');
    assert.equal(mid.scale, 1, '飞行中不缩放');
    const landing = neutralRewardArtifactFrame(0, ZC_NEUTRAL_REWARD_FLY_SECONDS + 0.1, start, target);
    assert.equal(landing.x, 310, '落地冻结在落点');
    assert.ok(landing.scale > 1 + ZC_NEUTRAL_REWARD_ARTIFACT_POP * 0.4, '落地小幅放大中');
    assert.ok(landing.opacity < 1, '淡出中');
});

// ============================================================
// 三、特效类：节点生命周期 / 资源归类 / 非玩家跳过
// ============================================================

function makeFx() {
    const { load, FakeNode } = loadViews();
    const { ZCNeutralRewardFx } = load('./ZCNeutralRewardFx');
    const host = new FakeNode('HudRoot');
    const fx = new ZCNeutralRewardFx(host, null, null);
    return { fx, host };
}

const START = { x: 100, y: 200 };
const TARGETS = { goldCounter: { x: 500, y: 50 }, artifactSlot: { x: 600, y: 50 } };
const resolveStart = () => START;

function goldEvent(overrides: Record<string, unknown> = {}) {
    return {
        id: 1, hexId: 3, itemId: ZC_TEST_ITEM.Gold, owner: 'player', gold: 50, artifactCharge: 0,
        startedAt: 0, durationSeconds: ZC_NEUTRAL_REWARD_TOTAL_SECONDS,
        ...overrides,
    };
}

test('金币事件：建 6 颗金币 + 一个「+N」label，飞行中可见、上飘后仍挂 host 下', () => {
    const { fx, host } = makeFx();
    fx.render([goldEvent()], 0.3, resolveStart, TARGETS);
    assert.equal(fx.size, 1);
    assert.equal(host.children.length, 1, '一个事件 = 一个根节点');
    const root = host.children[0];
    assert.equal(root.children.length, ZC_NEUTRAL_REWARD_COIN_COUNT + 1, '6 金币 + 1 label');
    const coins = root.children.filter((child) => child.name.startsWith('NeutralRewardCoin_'));
    assert.equal(coins.length, ZC_NEUTRAL_REWARD_COIN_COUNT);
    const label = root.children.find((child) => child.name === 'NeutralRewardLabel');
    assert.ok(label, 'label 存在');
    // 飞行中（now=0.3）：所有金币节点应激活；label 等最后一颗落地（0.8s 后）才显示。
    for (const coin of coins) assert.equal(coin.active, true, '飞行中金币可见');
    assert.equal(label.active, false, '还没到上飘时刻');
});

test('金币事件：上飘段 label 升起、事件过期（队列 prune 后）根节点销毁', () => {
    const { fx, host } = makeFx();
    // 最后一颗金币 0.8s 落地 ⇒ 0.9s 已在上飘段。
    fx.render([goldEvent()], 0.9, resolveStart, TARGETS);
    const root = host.children[0];
    const label = root.children.find((child) => child.name === 'NeutralRewardLabel');
    assert.equal(label.active, true, '上飘段 label 显示');
    assert.ok(label.position.y > TARGETS.goldCounter.y, 'label 从金币栏位置向上飘');
    // 事件从队列摘掉（模拟模型 prune）⇒ 特效类销毁对应根节点。
    fx.render([], 1.5, resolveStart, TARGETS);
    assert.equal(fx.size, 0);
    assert.equal(host.children.length, 0, '过期事件节点销毁、不残留');
});

test('资源归类：金矿 / 兵力不建特效；神器充能建单个神器节点；非玩家不播', () => {
    const { fx, host } = makeFx();
    // 金矿（mine）：需求口径走建筑激活，不进本类。
    fx.render([goldEvent({ id: 1, itemId: ZC_TEST_ITEM.Mine, gold: 250 })], 0.3, resolveStart, TARGETS);
    assert.equal(fx.size, 0, '金矿不播飞行');
    // 兵力（unit_cap）：直接产兵，不进本类。
    fx.render([goldEvent({ id: 2, itemId: ZC_TEST_ITEM.Unit, gold: 0 })], 0.3, resolveStart, TARGETS);
    assert.equal(fx.size, 0, '兵力不播飞行');
    // 非玩家领取：目标在玩家 HUD 上，不给对方播。
    fx.render([goldEvent({ id: 3, owner: 'enemy' })], 0.3, resolveStart, TARGETS);
    assert.equal(fx.size, 0, '非玩家不播飞行');

    // 神器充能：单个神器图标飞向神器按钮。
    fx.render([goldEvent({ id: 4, itemId: ZC_TEST_ITEM.MixedCharge, gold: 0, artifactCharge: 1 })], 0.3, resolveStart, TARGETS);
    assert.equal(fx.size, 1);
    assert.equal(host.children.length, 1);
    assert.equal(host.children[0].children.length, 1, '神器只有 1 个子节点');
    const sprite = host.children[0].children[0];
    assert.ok(sprite.position.x > START.x, '神器从格子飞向神器栏途中');
});

test('clear：销毁全部条目（换局清理），渲染空队列后不再重建', () => {
    const { fx, host } = makeFx();
    // 两个事件同帧渲染：渲染层按「本帧存活事件」对齐，分两次 render 会把旧事件当成已过期。
    fx.render([
        goldEvent(),
        goldEvent({ id: 5, itemId: ZC_TEST_ITEM.MixedCharge, gold: 0, artifactCharge: 1 }),
    ], 0.3, resolveStart, TARGETS);
    assert.equal(fx.size, 2);
    fx.clear();
    assert.equal(fx.size, 0);
    assert.equal(host.children.length, 0, 'clear 后节点全部销毁');
    fx.render([], 1.0, resolveStart, TARGETS);
    assert.equal(fx.size, 0);
});
