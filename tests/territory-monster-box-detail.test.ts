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
import { buildTerritoryMonsterBoxDetail } from '../assets/script/app/territory/model/TerritoryMonsterBoxDetail';
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
        { grade: 1, levelId: 60003, upCostCoins: 0, upPro: 0, maxFailTimes: 0,
          rewards: [{ resId: 10010, amount: 100, pro: 10000 }, { resId: 7, amount: 50, pro: 500 }] },
        { grade: 2, levelId: 60003, upCostCoins: 20, upPro: 90, maxFailTimes: 99,
          rewards: [{ resId: 10010, amount: 200, pro: 10000 }, { resId: 7, amount: 100, pro: 500 }] },
        { grade: 3, levelId: 60003, upCostCoins: 20, upPro: 60, maxFailTimes: 2,
          rewards: [{ resId: 10010, amount: 300, pro: 10000 }, { resId: 7, amount: 150, pro: 500 }] },
        { grade: 4, levelId: 60004, upCostCoins: 20, upPro: 40, maxFailTimes: 2,
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
    // mock 里 grade 2 的池：10010×200(100%) + 7×50(5%)
    assert.deepEqual(detail.rewards, [
        { resId: 10010, amount: 200, ratePercent: 100 },
        { resId: 7, amount: 100, ratePercent: 5 },
    ]);
});

test('lv=1 显示的是「升到 2 级」那行：20 银币 / 90% / 失败上限 99', () => {
    const detail = buildTerritoryMonsterBoxDetail({ site: patrolChestSite(), stage: STAGE, group: GROUP, lv: 1 });
    assert.ok(detail);
    assert.equal(detail.upgradeCost, 20);
    assert.equal(detail.successRate, 90);
    assert.equal(detail.failLimit, 99);
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
    assert.deepEqual(detail.rewards, [
        { resId: 10010, amount: 500, ratePercent: 100, amountText: '100~500' },
        { resId: 7, amount: 50, ratePercent: 5 },
        { resId: 19350, amount: 3, ratePercent: 5 },
        { resId: 19301, amount: 1, ratePercent: 5 },
    ]);
});
