/**
 * `buildTerritoryMonsterBoxDetail` 的行为网 —— 巡逻宝箱详情在各等级下的口径。
 *
 * ## 为什么要有这条
 *
 * 2026-11-19 的 bug 是「点宝箱格弹『站点配置待补齐』、从来不弹详情」：
 * Model 的 `patrolChest` 分支以前走「第一下解锁、第二下开战」，
 * 绑不到 `battleId` 时直接 `showTip(pendingTitle)`。改成「一律弹详情」之后，
 * **各等级该显示什么**全靠这个 builder 决定 —— 它算错不会报错，只会让弹窗内容怪：
 *
 *   · 满级还显示「升级宝箱 10」⇒ 点下去必定失败；
 *   · 守护怪解锁等级差一级 ⇒ 第三格早亮或永远锁着；
 *   · 绑不到 `battleId` 时挑战按钮仍可点 ⇒ 点了没反应（这次要消灭的正是这种观感）。
 *
 * 纯函数、零 `cc` 依赖，直接 import 真实实现（不复制算法）。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTerritoryMonsterBoxDetail, monsterBoxRewardText } from '../assets/script/app/territory/model/TerritoryMonsterBoxDetail';
import { TERRITORY_MONSTER_BOX_SPEC } from '../assets/script/app/territory/model/TerritoryMonsterBoxSpec';
import type { TerritoryCampaignStage, TerritorySite } from '../assets/script/app/territory/model/TerritoryMapConfig';
import { TERRITORY_SITE_TYPE } from '../assets/script/app/territory/model/TerritoryMapConfig';
import { bindTerritoryPatrolStages } from '../assets/script/app/territory/model/TerritoryStageBinding';
import type { ITerritoryMonsterBoxGroup } from '../assets/script/app/territory/model/TerritoryMonsterBoxConfig';

/** 造一个最小可用的巡逻宝箱站点。 */
function patrolChestSite(cellId = 42): TerritorySite {
    return {
        id: `patrol_${cellId}`,
        type: TERRITORY_SITE_TYPE.patrolChest,
        cellId,
        footprint: [cellId],
        unlock: { silver: 0 },
    } as unknown as TerritorySite;
}


/** 照真实 monsterBox 表（1002 组）造一组配置：grade 1 是初始态，2~4 才带消耗与成功率。 */
const GROUP: ITerritoryMonsterBoxGroup = {
    grades: [
        { grade: 1, levelId: 60003, upCostCoins: 0, upCostDiamond: 0, upPro: 0, maxFailTimes: 0,
          rewards: [{ resId: 10010, amount: 100, pro: 10000 }, { resId: 7, amount: 50, pro: 500 }] },
        { grade: 2, levelId: 60003, upCostCoins: 20, upCostDiamond: 2, upPro: 90, maxFailTimes: 99,
          rewards: [{ resId: 10010, amount: 200, pro: 10000 }, { resId: 7, amount: 100, pro: 500 }] },
        { grade: 3, levelId: 60003, upCostCoins: 20, upCostDiamond: 2, upPro: 60, maxFailTimes: 2,
          rewards: [{ resId: 10010, amount: 300, pro: 10000 }, { resId: 7, amount: 150, pro: 500 }] },
        { grade: 4, levelId: 60004, upCostCoins: 20, upCostDiamond: 2, upPro: 40, maxFailTimes: 2,
          rewards: [{ resId: 10010, amount: 400, pro: 10000 }, { resId: 7, amount: 50, pro: 500 }] },
    ],
};

/** 一个「绑到了关卡行」的占位 stage（builder 只用它判空）。 */
const STAGE = { levelId: 10001 } as unknown as TerritoryCampaignStage;

test('非巡逻宝箱站点 ⇒ 不出详情（别的站点仍走各自面板）', () => {
    const stageSite = { ...patrolChestSite(7), type: TERRITORY_SITE_TYPE.stage } as TerritorySite;
    assert.equal(buildTerritoryMonsterBoxDetail({ site: stageSite, stage: STAGE, group: GROUP, lv: 2 }), null);
    assert.equal(buildTerritoryMonsterBoxDetail({ site: null, stage: STAGE, group: GROUP, lv: 2 }), null);
});

test('Lv.2：前两格守护怪解锁、第三格写「4 级解锁」', () => {
    const detail = buildTerritoryMonsterBoxDetail({ site: patrolChestSite(), stage: STAGE, group: GROUP, lv: 2 });
    assert.equal(detail?.failCount, -1, '协议只给等级，未下发失败次数时标记为未知');
    assert.ok(detail);
    assert.equal(detail.lv, 2);
    assert.equal(detail.maxLv, 4);
    assert.deepEqual(
        detail.guards.map((guard) => guard.unlocked),
        [true, true, false],
    );
    assert.equal(detail.guards[2].unlockText, '4 级解锁');
    // lv=2 ⇒ 显示的是「升到 3 级」那行：20 银币 / 60% / 失败上限 2
    assert.equal(detail.upgradeCost, 20);
    assert.equal(detail.successRate, 60);
    assert.equal(detail.failLimit, 2);
    assert.equal(detail.upgradeCaption, TERRITORY_MONSTER_BOX_SPEC.upgradeCaption);
    assert.equal(detail.footerText, TERRITORY_MONSTER_BOX_SPEC.footerText);
});

test('Lv.1：只有第一格守护怪亮', () => {
    const detail = buildTerritoryMonsterBoxDetail({ site: patrolChestSite(), stage: STAGE, group: GROUP, lv: 1 });
    assert.ok(detail);
    assert.deepEqual(detail.guards.map((guard) => guard.unlocked), [true, false, false]);
    assert.equal(detail.guards[1].unlockText, '2 级解锁');
});

test('Lv.4 满级：没有升级入口，底部换成满级文案', () => {
    const detail = buildTerritoryMonsterBoxDetail({ site: patrolChestSite(), stage: STAGE, group: GROUP, lv: 4 });
    assert.ok(detail);
    assert.deepEqual(detail.guards.map((guard) => guard.unlocked), [true, true, true]);
    assert.equal(detail.upgradeCost, 0);
    assert.equal(detail.upgradeCaption, '');
    assert.equal(detail.successRate, 0);
    assert.equal(detail.footerText, TERRITORY_MONSTER_BOX_SPEC.footerTextAtMaxLv);
});

test('绑不到关卡行 ⇒ 挑战按钮置灰（而不是点了没反应）', () => {
    const detail = buildTerritoryMonsterBoxDetail({ site: patrolChestSite(), stage: null, group: GROUP, lv: 2 });
    assert.ok(detail);
    assert.equal(detail.battleEnabled, false);
});

test('等级取服务端下发值，不本地造（0 也不崩）', () => {
    const zero = buildTerritoryMonsterBoxDetail({ site: patrolChestSite(), stage: STAGE, group: GROUP, lv: 0 });
    assert.ok(zero);
    assert.equal(zero.lv, 0);
    assert.deepEqual(zero.guards.map((guard) => guard.unlocked), [false, false, false]);
    // 负数 / 小数也按 0 兜底，不把 NaN 传进 UI
    const dirty = buildTerritoryMonsterBoxDetail({ site: patrolChestSite(), stage: STAGE, group: GROUP, lv: Number.NaN });
    assert.ok(dirty);
    assert.equal(dirty.lv, 0);
});

test('奖励取「当前等级」那行的胜利奖励池，概率从万分比换成百分比', () => {
    const detail = buildTerritoryMonsterBoxDetail({ site: patrolChestSite(), stage: STAGE, group: GROUP, lv: 2 });
    assert.ok(detail);
    // mock 里 grade 2 的池：10010×200(100%) + 7×100(5%)；grade 3 是 300 / 150 ⇒ 增量 +100 / +50
    assert.deepEqual(detail.rewards, [
        { resId: 10010, amount: 200, addAmount: 100, ratePercent: 100 },
        { resId: 7, amount: 100, addAmount: 50, ratePercent: 5 },
    ]);
});

test('lv=1 显示的是「升到 2 级」那行：20 银币 / 90% / 失败上限 99', () => {
    const detail = buildTerritoryMonsterBoxDetail({ site: patrolChestSite(), stage: STAGE, group: GROUP, lv: 1 });
    assert.ok(detail);
    assert.equal(detail.upgradeCost, 20);
    assert.equal(detail.costResId, 7);
    assert.equal(detail.successRate, 90);
    assert.equal(detail.failLimit, 99);
});

test('失败次数未达上限：消耗银币（resId: 7）；达到上限后切换为金币（resId: 10）', () => {
    // lv=2 升 lv=3：maxFailTimes=2, upCostCoins=20, upCostDiamond=2
    const silverDetail = buildTerritoryMonsterBoxDetail({ site: patrolChestSite(), stage: STAGE, group: GROUP, lv: 2, failCount: 1 });
    assert.ok(silverDetail);
    assert.equal(silverDetail.upgradeCost, 20);
    assert.equal(silverDetail.costResId, 7);
    assert.equal(silverDetail.failCount, 1);
    assert.equal(silverDetail.failLimit, 2);

    const goldDetail = buildTerritoryMonsterBoxDetail({ site: patrolChestSite(), stage: STAGE, group: GROUP, lv: 2, failCount: 2 });
    assert.ok(goldDetail);
    assert.equal(goldDetail.upgradeCost, 2);
    assert.equal(goldDetail.costResId, 10);
    assert.equal(goldDetail.failCount, 2);
    assert.equal(goldDetail.failLimit, 2);
    assert.equal(goldDetail.upgradeCaption, TERRITORY_MONSTER_BOX_SPEC.upgradeCaption);
});

test('没有组配置 ⇒ 不给升级入口，但挑战照常（不让面板整片空白）', () => {
    const detail = buildTerritoryMonsterBoxDetail({ site: patrolChestSite(), stage: STAGE, group: null, lv: 2 });
    assert.ok(detail);
    assert.equal(detail.upgradeCost, 0);
    assert.equal(detail.upgradeCaption, '');
    assert.equal(detail.battleEnabled, true);
    assert.deepEqual(detail.rewards, []);
});

// ------------------------------------------------------------------
// 关卡绑定：「battleId → monsterBox 表 → monsterBoxLevel」这一跳
// ------------------------------------------------------------------

test('patrolLevelId 优先于 battleId（少这一跳「开始挑战」恒灰）', () => {
    // 真实配置：chapter_01 的巡逻格 battleId=1002，monsterBox 表 1002 组的最低级行 monsterBoxLevel=60003
    const sites = [{ ...patrolChestSite(310), battleId: 1002, patrolLevelId: 60003 } as TerritorySite];
    const stages = [{ levelId: 60003 } as TerritoryCampaignStage];
    const bindings = bindTerritoryPatrolStages(sites, stages);
    assert.equal(bindings.length, 1, '批到关卡才可能点得动');
    assert.equal(bindings[0].stage.levelId, 60003);
    // 只拿 battleId(1002) 去 levelInfo 里找是找不到的 —— 这正是修复前的死因
    const naive = bindTerritoryPatrolStages([{ ...patrolChestSite(310), battleId: 1002 } as TerritorySite], stages);
    assert.equal(naive.length, 0);
});

test('没有 patrolLevelId 时退回 battleId（老地图 / 不带 monsterBox 表的场景不炸）', () => {
    const sites = [{ ...patrolChestSite(311), battleId: 60003 } as TerritorySite];
    const stages = [{ levelId: 60003 } as TerritoryCampaignStage];
    const bindings = bindTerritoryPatrolStages(sites, stages);
    assert.equal(bindings.length, 1);
});

test('同一个 resId 的多档奖励合并成一格（否则 4 格全是同一个图标）', () => {
    // 照真实 1002 组 grade 1 的池：10010 有四档（100/100 100%/50%/500/10%/100/5%），另有 7、19350、19301 各一档
    const group: ITerritoryMonsterBoxGroup = {
        grades: [{
            grade: 1, levelId: 60003, upCostCoins: 0, upPro: 0, maxFailTimes: 0,
            rewards: [
                { resId: 10010, amount: 100, pro: 10000 },
                { resId: 10010, amount: 100, pro: 5000 },
                { resId: 10010, amount: 500, pro: 1000 },
                { resId: 10010, amount: 100, pro: 500 },
                { resId: 7, amount: 50, pro: 500 },
                { resId: 19350, amount: 3, pro: 500 },
                { resId: 19301, amount: 1, pro: 500 },
            ],
        }],
    };
    const detail = buildTerritoryMonsterBoxDetail({ site: patrolChestSite(), stage: STAGE, group, lv: 1 });
    assert.ok(detail);
    // 7 条 → 4 种资源，正好铺满面板 4 格
    assert.equal(detail.rewards.length, 4);
    // 数量取该资源的**下限**（100，不再是 500）：区间口径在 11-25 换成「当前+增量」后读不出来
    // 这组只有一个 grade ⇒ 没有下一级可比 ⇒ 增量全 0
    assert.deepEqual(detail.rewards, [
        { resId: 10010, amount: 100, addAmount: 0, ratePercent: 100 },
        { resId: 7, amount: 50, addAmount: 0, ratePercent: 5 },
        { resId: 19350, amount: 3, addAmount: 0, ratePercent: 5 },
        { resId: 19301, amount: 1, addAmount: 0, ratePercent: 5 },
    ]);
});

test('★下一级同资源更少（配表反向）⇒ 增量为 0，只显示当前值', () => {
    // 真实 monsterBox 表有 5 处这种反向配置（见 §3.53）：照 GROUP 的 grade 3 → grade 4，银币 150 → 50
    const lv3 = buildTerritoryMonsterBoxDetail({ site: patrolChestSite(), stage: STAGE, group: GROUP, lv: 3 });
    assert.ok(lv3);
    assert.deepEqual(lv3.rewards, [
        { resId: 10010, amount: 300, addAmount: 100, ratePercent: 100 },
        { resId: 7, amount: 150, addAmount: 0, ratePercent: 5 },
    ]);
    // 满级没有下一级 ⇒ 增量全 0
    const lv4 = buildTerritoryMonsterBoxDetail({ site: patrolChestSite(), stage: STAGE, group: GROUP, lv: 4 });
    assert.ok(lv4);
    assert.deepEqual(lv4.rewards.map((reward) => reward.addAmount), [0, 0]);
});

test('奖励文案：有增量写 `当前+增量`，没增量只写当前值', () => {
    assert.equal(monsterBoxRewardText({ amount: 300, addAmount: 100 }), '300+100');
    assert.equal(monsterBoxRewardText({ amount: 150, addAmount: 0 }), '150');
    // 配表脏数据（负数 / 小数 / NaN）一律向下归零，不把 `300+-20` 送到界面
    assert.equal(monsterBoxRewardText({ amount: 300, addAmount: -20 }), '300');
    assert.equal(monsterBoxRewardText({ amount: 300.9, addAmount: 99.9 }), '300+99');
    assert.equal(monsterBoxRewardText({ amount: Number.NaN, addAmount: Number.NaN }), '0');
});

// ------------------------------------------------------------------
// 守护怪头像：levelInfo.levelMonsterGroup → monsterCard.headIcon
// ------------------------------------------------------------------

/** 照真实表造：60003 出 50021 / 50030，60004 换关后出 50023（1002 组的 grade 4 就是这么换的）。 */
const GUARD_MONSTERS = new Map([
    [60003, [
        { monsterId: 50021, headIcon: '兵种_头像_窝瓜人' },
        { monsterId: 50030, headIcon: '兵种_头像_饥饿战士' },
    ]],
    [60004, [{ monsterId: 50023, headIcon: '兵种_头像_仙人侍卫' }]],
]);

test('★★守护怪头像读「当前等级那一关」的 levelMonsterGroup（不是静态绑定那关）', () => {
    const lv3 = buildTerritoryMonsterBoxDetail({
        site: patrolChestSite(), stage: STAGE, group: GROUP, lv: 3, monsterGroupByLevelId: GUARD_MONSTERS,
    });
    assert.ok(lv3);
    // 组里的怪只有两只 ⇒ 第三格没有头像（面板保留 prefab 占位图），不许整格消失
    assert.deepEqual(lv3.guards.map((guard) => guard.headIcon),
        ['兵种_头像_窝瓜人', '兵种_头像_饥饿战士', '']);
    assert.match(lv3.guards[2].unlockText, /解锁/, '没头像不影响「4 级解锁」文案');

    // grade 4 那行的 monsterBoxLevel 换成了 60004 ⇒ 满级后显示的是新关的怪
    const lv4 = buildTerritoryMonsterBoxDetail({
        site: patrolChestSite(), stage: STAGE, group: GROUP, lv: 4, monsterGroupByLevelId: GUARD_MONSTERS,
    });
    assert.ok(lv4);
    assert.deepEqual(lv4.guards.map((guard) => guard.headIcon),
        ['兵种_头像_仙人侍卫', '', '']);
});

test('守护怪数量按 levelMonsterGroup.number 透传；未解锁格不显示', () => {
    const withCount = new Map([[60003, [
        { monsterId: 50021, headIcon: '兵种_头像_窝瓜人', count: 44 },
        { monsterId: 50030, headIcon: '兵种_头像_饥饿战士', count: 32 },
        { monsterId: 50022, headIcon: '', count: 1 },
    ]]]);
    const detail = buildTerritoryMonsterBoxDetail({
        site: patrolChestSite(), stage: STAGE, group: GROUP, lv: 3, monsterGroupByLevelId: withCount,
    });
    assert.ok(detail);
    assert.equal(detail.guards[0].countText, '数量：44');
    assert.equal(detail.guards[1].countText, '数量：32');
    assert.equal(detail.guards[2].countText, '', '4 级才解锁的格子不显示数量');
});

test('没有守护怪配置（老 bundle / 老夹具）⇒ 头像空串，整块照常显示', () => {
    const detail = buildTerritoryMonsterBoxDetail({ site: patrolChestSite(), stage: STAGE, group: GROUP, lv: 2 });
    assert.ok(detail);
    assert.deepEqual(detail.guards.map((guard) => guard.headIcon), ['', '', '']);
    assert.deepEqual(detail.guards.map((guard) => guard.unlocked), [true, true, false]);
});

test('组配置缺失时按静态绑定的关卡取守护怪（不能因为没升级入口就丢掉头像）', () => {
    const detail = buildTerritoryMonsterBoxDetail({
        site: patrolChestSite(), stage: { levelId: 60003 } as TerritoryCampaignStage,
        group: null, lv: 2, monsterGroupByLevelId: GUARD_MONSTERS,
    });
    assert.ok(detail);
    assert.equal(detail.guards[0].headIcon, '兵种_头像_窝瓜人');
});

// ------------------------------------------------------------------
// 升级摇奖结果：只透传，不在这里判成功
// ------------------------------------------------------------------

test('★摇奖结果原样透传（面板据它决定黄条停绿区还是灰区）', () => {
    const attempt = { cellId: 42, seq: 7, success: false };
    const detail = buildTerritoryMonsterBoxDetail({
        site: patrolChestSite(), stage: STAGE, group: GROUP, lv: 2, attempt,
    });
    assert.ok(detail);
    assert.deepEqual(detail.upgradeAttempt, attempt);
    // 没摇过 ⇒ null（面板据此知道「没有结果可等」，不会空等）
    const fresh = buildTerritoryMonsterBoxDetail({ site: patrolChestSite(), stage: STAGE, group: GROUP, lv: 2 });
    assert.equal(fresh?.upgradeAttempt, null);
});
