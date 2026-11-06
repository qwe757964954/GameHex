import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
import {
    ZC_NEUTRAL_BURST_COUNT,
    ZC_NEUTRAL_BURST_GRAVITY,
    ZC_NEUTRAL_BURST_HALF_ANGLE_DEG,
    ZC_NEUTRAL_BURST_LABEL_SECONDS,
    ZC_NEUTRAL_BURST_SURFACE_FADE_SECONDS,
    zcNeutralBurstLabelFrame,
    zcNeutralBurstLaunch,
    zcNeutralBurstParticle,
} from '../assets/script/app/zcds/model/ZCNeutralBurst';
import { installZCNeutralTestCatalog, ZC_TEST_ITEM } from './helpers/zcds-neutral-catalog';

installZCNeutralTestCatalog();

/**
 * 金币表现口径（2026-11-04 用户定稿）：**一把金币从格心飞向 `ZCGameHUD/CoinPanel`**。
 *
 * 10-26 那版「格心就地喷发」曾把 HUD 挂点删掉，视图却还读旧落点 ⇒ `null ⇒ continue`
 * ⇒ 实机金币一条都不播、零报错。所以本文件除了曲线，还钉住两件事：
 *   ① `ZCGameHUD.prefab` 里 `coinPanel` 真的绑到 `BottomInfoPanel/CoinPanel`（第五节）；
 *   ② 真实入口 `ZCGameRenderWorld.renderNeutralRewards()` 把该节点换算成 overlay 局部坐标，
 *      金币末帧确实冻在它上面（第五节）。
 * 只测「曲线对」是假绿 —— 挂点一丢，曲线照样全绿、屏上什么都没有。
 */

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
        '总长 = 飞行 + 错峰尾 + 上飘（视图时间轴同源，金币没飘完不许被 prune）',
    );
    assert.ok(
        ZC_NEUTRAL_REWARD_TOTAL_SECONDS >= ZC_NEUTRAL_REWARD_FLY_SECONDS + 0.2,
        '神器飞行 + 落地淡出也要落在事件窗内',
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
    queue.prune(ZC_NEUTRAL_REWARD_TOTAL_SECONDS - 0.001);
    assert.equal(queue.neutralRewards.length, 1, '时长边界前还在');
    queue.prune(ZC_NEUTRAL_REWARD_TOTAL_SECONDS + 0.001);
    assert.equal(queue.neutralRewards.length, 0, '过期即摘除');

    queue.pushNeutralReward({ now: 0, hexId: 2, itemId: ZC_TEST_ITEM.Gold, owner: 'player', gold: 50, artifactCharge: 0 });
    queue.reset();
    assert.equal(queue.neutralRewards.length, 0, 'reset 清空队列');
    assert.equal(queue.pushNeutralReward({
        now: 0, hexId: 3, itemId: ZC_TEST_ITEM.Gold, owner: 'player', gold: 50, artifactCharge: 0,
    })?.id, 1, '换局后 id 重新从 1 开始');
});

// ============================================================
// 二、金币飞行曲线（当前生效）
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
    const mid = neutralRewardCoinPoint(11, 0, start, target, 0.5);
    const linearMidY = (start.y + target.y) / 2;
    assert.ok(mid.y > linearMidY + 10, `t=0.5 应高过线性中点（实际 ${mid.y} vs ${linearMidY}）`);
});

test('金币时间轴：错峰出发 → 飞行 → 落地后位置冻结线性淡出', () => {
    const { load } = loadViews();
    const { neutralRewardCoinFrame, ZC_NEUTRAL_REWARD_COIN_FADE_SECONDS } = load('./ZCNeutralRewardFx');
    const start = { x: 0, y: 0 };
    const target = { x: 400, y: 0 };

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
// 三、备用「格心喷发」曲线自检（2026-11-04 起产品代码不接线）
//
// `model/ZCNeutralBurst` 保留备用但视图已改回飞行；这里只验曲线本身没被改坏，
// **不要**据此把 HUD 落点又删掉 —— 那正是「金币没动画」的事故现场。
// ============================================================

test('备用喷发曲线：错峰出发、出射角在倒锥内、落回台面后位置冻结', () => {
    assert.equal(zcNeutralBurstParticle(7, 0, -0.01), null, '起点前不显示');
    assert.equal(
        zcNeutralBurstParticle(7, ZC_NEUTRAL_BURST_COUNT - 1, 0.01), null,
        '最后一枚还没到自己的错峰时刻',
    );
    const launch = zcNeutralBurstLaunch(7, 0);
    assert.ok(launch);
    const halfAngle = (ZC_NEUTRAL_BURST_HALF_ANGLE_DEG * Math.PI) / 180;
    assert.ok(Math.abs(launch.phi) <= halfAngle + 1e-9, '出射方向必须落在 ±半顶角的倒锥里');
    const rising = zcNeutralBurstParticle(7, 0, 0.2);
    assert.ok(rising, '出发后可见');
    assert.ok(rising.offsetY > 0, '先往上抛');
    assert.equal(rising.scaleX, launch.baseScale, '横向缩放恒等于基础缩放');
    assert.notEqual(rising.scaleY, rising.scaleX, '纵向在翻面');
    const surfaceAt = (2 * launch.vy) / ZC_NEUTRAL_BURST_GRAVITY;
    if (surfaceAt < launch.life) {
        const landed = zcNeutralBurstParticle(7, 0, surfaceAt + ZC_NEUTRAL_BURST_SURFACE_FADE_SECONDS * 0.5);
        assert.ok(landed, '落地淡出段仍存在');
        assert.equal(landed.offsetY, 0, '落回台面后位置冻住');
        assert.ok(landed.opacity < 1, '落地后淡出中');
    }
    assert.deepEqual(zcNeutralBurstParticle(7, 3, 0.4), zcNeutralBurstParticle(7, 3, 0.4));
});

test('备用「+N」读数曲线：与喷发同时开始，先弹起再上飘淡出', () => {
    assert.equal(zcNeutralBurstLabelFrame(-0.01), null);
    const entry = zcNeutralBurstLabelFrame(0);
    assert.ok(entry);
    assert.ok(entry.scale < 1, '入场从 0.6 弹起');
    assert.equal(entry.opacity, 1);
    const mid = zcNeutralBurstLabelFrame(ZC_NEUTRAL_BURST_LABEL_SECONDS * 0.6);
    assert.ok(mid);
    assert.ok(mid.offsetY > 0, '整体向上飘');
    assert.equal(zcNeutralBurstLabelFrame(ZC_NEUTRAL_BURST_LABEL_SECONDS), null, '播完即收');
});

// ============================================================
// 四、特效类：节点生命周期 / 资源归类 / 非玩家跳过
// ============================================================

function makeFx() {
    const { load, FakeNode } = loadViews();
    const { ZCNeutralRewardFx } = load('./ZCNeutralRewardFx');
    const host = new FakeNode('HudRoot');
    const fx = new ZCNeutralRewardFx(host, null, null);
    return { fx, host };
}

const START = { x: 100, y: 200 };
/** 金币落点 = CoinPanel 面板中心；神器落点 = ArtifactButton。 */
const TARGETS = { coinPanel: { x: 500, y: 50 }, artifactSlot: { x: 600, y: 50 } };
const resolveStart = () => START;

function goldEvent(overrides: Record<string, unknown> = {}) {
    return {
        id: 1, hexId: 3, itemId: ZC_TEST_ITEM.Gold, owner: 'player', gold: 50, artifactCharge: 0,
        startedAt: 0, durationSeconds: ZC_NEUTRAL_REWARD_TOTAL_SECONDS,
        ...overrides,
    };
}

test('金币事件：建 6 颗金币 + 一个「+N」label，飞行中可见、上飘前 label 不显示', () => {
    const { fx, host } = makeFx();
    fx.render([goldEvent()], 0.3, resolveStart, TARGETS);
    assert.equal(fx.size, 1);
    assert.equal(host.children.length, 1, '一个事件 = 一个根节点');
    const root = host.children[0];
    assert.equal(root.children.length, ZC_NEUTRAL_REWARD_COIN_COUNT + 1, '6 金币 + 1 label');
    const coins = root.children.filter((child) => child.name.startsWith('NeutralRewardCoin_'));
    assert.equal(coins.length, ZC_NEUTRAL_REWARD_COIN_COUNT);
    for (const coin of coins) assert.equal(coin.active, true, '飞行中金币可见');
    const label = root.children.find((child) => child.name === 'NeutralRewardLabel');
    assert.ok(label, 'label 存在');
    assert.equal(label.active, false, '还没到上飘时刻');
});

test('金币事件：金币位置按弧线朝 CoinPanel 走，落地冻在落点；「+N」在金币栏上升起', () => {
    const { load, FakeNode } = loadViews();
    const { ZCNeutralRewardFx, neutralRewardCoinFrame, neutralRewardRiseFrame } = load('./ZCNeutralRewardFx');
    const host = new FakeNode('overlay');
    const fx = new ZCNeutralRewardFx(host, null, null);
    fx.render([goldEvent()], 0.3, resolveStart, TARGETS);
    const root = host.children[0];
    const coin = root.children.find((child) => child.name === 'NeutralRewardCoin_0');
    const expected = neutralRewardCoinFrame(1, 0, 0, 0.3, START, TARGETS.coinPanel);
    assert.ok(expected.visible);
    assert.equal(coin.position.x, expected.x, '金币写 host 绝对局部坐标（不是格心相对偏移）');
    assert.equal(coin.position.y, expected.y);
    assert.ok(coin.position.x > START.x && coin.position.x < TARGETS.coinPanel.x, '在格心 → 金币栏途中');

    const landedAt = ZC_NEUTRAL_REWARD_FLY_SECONDS + 0.02;
    fx.render([goldEvent()], landedAt, resolveStart, TARGETS);
    assert.equal(coin.position.x, TARGETS.coinPanel.x, '末帧冻在 CoinPanel');
    assert.equal(coin.position.y, TARGETS.coinPanel.y);

    fx.render([goldEvent()], 0.9, resolveStart, TARGETS);
    const label = root.children.find((child) => child.name === 'NeutralRewardLabel');
    const rise = neutralRewardRiseFrame(0, 0.9);
    assert.equal(label.active, true, '上飘段 label 显示');
    assert.equal(label.position.x, TARGETS.coinPanel.x, '读数横向钉在金币栏');
    assert.equal(label.position.y, TARGETS.coinPanel.y + rise.y, '读数从金币栏往上飘');
    fx.render([], 1.5, resolveStart, TARGETS);
    assert.equal(fx.size, 0);
    assert.equal(host.children.length, 0, '过期事件节点销毁、不残留');
});

test('资源归类：金矿 / 兵力不建特效；神器充能建单个神器节点；非玩家不播', () => {
    const { fx, host } = makeFx();
    fx.render([goldEvent({ id: 1, itemId: ZC_TEST_ITEM.Mine, gold: 250 })], 0.3, resolveStart, TARGETS);
    assert.equal(fx.size, 0, '金矿不播飞行');
    fx.render([goldEvent({ id: 2, itemId: ZC_TEST_ITEM.Unit, gold: 0 })], 0.3, resolveStart, TARGETS);
    assert.equal(fx.size, 0, '兵力不播飞行');
    fx.render([goldEvent({ id: 3, owner: 'enemy' })], 0.3, resolveStart, TARGETS);
    assert.equal(fx.size, 0, '非玩家不播飞行');

    fx.render([goldEvent({ id: 4, itemId: ZC_TEST_ITEM.MixedCharge, gold: 0, artifactCharge: 1 })], 0.3, resolveStart, TARGETS);
    assert.equal(fx.size, 1);
    assert.equal(host.children.length, 1);
    assert.equal(host.children[0].children.length, 1, '神器只有 1 个子节点');
    const sprite = host.children[0].children[0];
    assert.ok(sprite.position.x > START.x, '神器从格子飞向神器栏途中');
});

test('clear：销毁全部条目（换局清理），渲染空队列后不再重建', () => {
    const { fx, host } = makeFx();
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

// ============================================================
// 五、CoinPanel 落点：装配链路 + prefab 绑定 + 真实入口
// ============================================================

test('正式装配：CoinPanel 从 HUD prefab 一路传到金币特效（静态链路）', () => {
    const game = readFileSync('assets/script/app/zcds/ZCGame.ts', 'utf8');
    const world = readFileSync('assets/script/app/zcds/view/ZCGameRenderWorld.ts', 'utf8');
    const hud = readFileSync('assets/script/app/zcds/view/ZCGameHUDView.ts', 'utf8');
    const fx = readFileSync('assets/script/app/zcds/view/ZCNeutralRewardFx.ts', 'utf8');

    assert.match(hud, /coinPanel:\s*Node\s*=\s*null/, 'HUD view 必须暴露 coinPanel 节点引用');
    assert.match(game, /coinPanelNode:\s*this\.hudView\.coinPanel/, '正式装配必须把面板传进渲染世界');
    assert.match(world, /coinPanelNode\??:\s*Node\s*\|\s*null/, '渲染世界选项里要有金币栏挂点');
    assert.match(world, /coinPanel:\s*this\.overlayLocalOf\(this\.options\.coinPanelNode/,
        '金币落点必须走 overlayLocalOf 换算到全屏层局部坐标');
    assert.match(fx, /kind === 'gold' \? targets\.coinPanel : targets\.artifactSlot/,
        '金币分支必须读 coinPanel（别再退回「用格心占位」那版）');
    assert.match(world, /artifactSlot:\s*this\.overlayLocalOf/, '神器落点不能被顺手弄丢');
});

test('★ ZCGameHUD.prefab：coinPanel 真的绑到 BottomInfoPanel/CoinPanel', () => {
    // 这条才是「金币没动画」的真判据：只写 @property、prefab 忘了拖 ⇒ 运行时 null
    // ⇒ 金币事件整条 continue，零报错，所有曲线用例照样全绿。
    const prefab = JSON.parse(
        readFileSync('assets/bundles/battle/ui/game/ZCGameHUD.prefab', 'utf8'),
    ) as Record<string, any>[];
    const rootIdx = prefab[0].data.__id__;
    const rootComps = (prefab[rootIdx]._components ?? []).map((ref: any) => prefab[ref.__id__]);
    // 按属性表认脚本组件，不硬编码 cid（脚本 uuid 变了也不会假绿）。
    const view = rootComps.find((o: any) => o && 'coinPanel' in o && 'goldIcon' in o && 'goldLabel' in o);
    assert.ok(view, 'HUD 根节点上要有 ZCGameHUDView 组件');
    const ref = view.coinPanel;
    assert.ok(ref && typeof ref.__id__ === 'number',
        'coinPanel 必须是已绑定的 {__id__}；null / 缺失 = 金币不播');
    const target = prefab[ref.__id__];
    assert.equal(target.__type__, 'cc.Node', 'Node 型 @property 必须指向 cc.Node');
    assert.equal(target._name, 'CoinPanel', '落点必须是整个 CoinPanel 面板，不是 GoldLabel / coin 子图标');
    assert.equal(prefab[target._parent.__id__]._name, 'BottomInfoPanel', 'CoinPanel 挂在 BottomInfoPanel 下');
});

test('★ 渲染世界真实入口：金币堆 / 宝箱从格心飞到 CoinPanel 局部坐标', () => {
    for (const itemId of [ZC_TEST_ITEM.Gold, ZC_TEST_ITEM.BigChest]) {
        const { load, FakeNode } = loadViews();
        const { ZCGameRenderWorld } = load('./ZCGameRenderWorld');
        const { ZCNeutralRewardFx, neutralRewardCoinFrame } = load('./ZCNeutralRewardFx');
        const host = new FakeNode('overlay');
        // 模拟 UITransform.convertToNodeSpaceAR：世界 → overlay 局部平移 (−20,−30)。
        Object.assign(host, { getComponent: () => ({
            convertToNodeSpaceAR: (p: { x: number; y: number }) => ({ x: p.x - 20, y: p.y - 30 }),
        }) });
        const coinPanel = new FakeNode('CoinPanel');
        coinPanel.position.x = 520;
        coinPanel.position.y = 80;
        const fx = new ZCNeutralRewardFx(host, null, null);
        const world = Object.create(ZCGameRenderWorld.prototype);
        let now = 0.3;
        Object.assign(world, {
            options: { overlayLayer: host, coinPanelNode: coinPanel },
            neutralRewardFx: fx, neutralRewardStartLocal: resolveStart, visualTime: () => now,
        });
        const event = goldEvent({ itemId });
        world.renderNeutralRewards({ neutralRewards: [event] });
        assert.equal(fx.size, 1, '真实入口必须建出金币飞行');
        const root = host.children[0];
        const coins = root.children.filter((child: any) => child.name.startsWith('NeutralRewardCoin_'));
        assert.equal(coins.length, ZC_NEUTRAL_REWARD_COIN_COUNT);

        const target = { x: 500, y: 50 }; // CoinPanel 世界 (520,80) → overlay 局部 (500,50)
        const frame = neutralRewardCoinFrame(event.id, 0, 0, now, START, target);
        assert.ok(frame.visible);
        assert.equal(coins[0].position.x, frame.x, '粒子按飞行曲线朝 CoinPanel 推进');
        assert.equal(coins[0].position.y, frame.y);

        now = ZC_NEUTRAL_REWARD_FLY_SECONDS + 0.02;
        world.renderNeutralRewards({ neutralRewards: [event] });
        assert.equal(coins[0].position.x, target.x, '落地后冻在 CoinPanel 的 overlay 局部坐标');
        assert.equal(coins[0].position.y, target.y);

        world.renderNeutralRewards({ neutralRewards: [] });
        assert.equal(fx.size, 0);
        assert.equal(host.children.length, 0);
    }
});

test('回归护栏：CoinPanel 挂点缺失时金币不建条目（说明绑定必须验）', () => {
    // 不是「期望不播」，而是钉住当前口径：目标 null ⇒ 金币整条 continue。
    // 正因为如此，上一条 prefab 绑定断言才是唯一能拦住「屏上什么都没有」的判据。
    const { load, FakeNode } = loadViews();
    const { ZCGameRenderWorld } = load('./ZCGameRenderWorld');
    const { ZCNeutralRewardFx } = load('./ZCNeutralRewardFx');
    const host = new FakeNode('overlay');
    Object.assign(host, { getComponent: () => ({
        convertToNodeSpaceAR: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
    }) });
    const artifactButton = new FakeNode('ArtifactButton');
    artifactButton.position.x = 600;
    artifactButton.position.y = 50;
    const fx = new ZCNeutralRewardFx(host, null, null);
    const world = Object.create(ZCGameRenderWorld.prototype);
    Object.assign(world, {
        // 故意不给 coinPanelNode（等价于 prefab 忘了绑）。
        options: { overlayLayer: host, artifactButtonNode: artifactButton },
        neutralRewardFx: fx, neutralRewardStartLocal: resolveStart, visualTime: () => 0.3,
    });
    world.renderNeutralRewards({ neutralRewards: [goldEvent()] });
    assert.equal(fx.size, 0, '金币没落点 ⇒ 不建节点（神器那条不受影响）');
});
