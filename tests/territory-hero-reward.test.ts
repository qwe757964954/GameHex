import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
    TERRITORY_HERO_BADGE_FADE_SECONDS,
    TERRITORY_HERO_BADGE_GROW_SECONDS,
    TERRITORY_HERO_BADGE_HOLD_SECONDS,
    TERRITORY_HERO_BADGE_TOTAL_SECONDS,
    TERRITORY_HERO_FLIGHT_MAX_COUNT,
    TERRITORY_HERO_FLIGHT_SECONDS,
    TERRITORY_HERO_FLIGHT_STAGGER,
    collectTerritoryHeroRewards,
    detectTerritoryHeroBadges,
    isTerritoryHeroRewardResId,
    sortTerritoryHeroBadges,
    territoryHeroBadgeFrame,
    territoryHeroFlightArriveAt,
    territoryHeroFlightCountOf,
    territoryHeroFlightFx,
    territoryHeroFlightTotalSeconds,
    type ITerritoryHeroBadgeItem,
    type ITerritoryHeroUpgradeState,
} from '../assets/script/app/territory/model/TerritoryHeroReward';

const PAGE = 'assets/script/app/main/MainTerritoryMap.ts';
const VIEW = 'assets/script/app/territory/view/TerritoryMapView.ts';
const FLIGHT = 'assets/script/app/territory/view/TerritoryHeroFlight.ts';
const BADGE = 'assets/script/app/main/HeroFragmentBadge.ts';
const TAB = 'assets/script/app/common/TabButton.ts';
const SOURCE = 'assets/script/app/bootstrap/main/TerritoryHeroProgressSource.ts';
const COMPOSITION = 'assets/script/app/bootstrap/main/MainPageComposition.ts';
const MODEL = 'assets/script/app/territory/model/TerritoryHeroReward.ts';

const src = (path: string): string => readFileSync(path, 'utf8');
/** 去掉块注释与行注释，只留真代码 —— 防止「注释里写了就算接线」的假绿。 */
const body = (path: string): string => src(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

// ============================================================
// 需求 ①：判据「只改碎片经验」
// ============================================================

test('碎片/经验类 = 非钱包类：7/9 仍归顶部资源栏，其余一律改道英雄按钮', () => {
    assert.equal(isTerritoryHeroRewardResId(7), false, '银币仍飞资源栏');
    assert.equal(isTerritoryHeroRewardResId(9), false, '体力仍飞资源栏');
    assert.equal(isTerritoryHeroRewardResId('7'), false);
    for (const id of [10010, 16000, 16003, 18003, 19101, 19350]) {
        assert.equal(isTerritoryHeroRewardResId(id), true, `resId ${id} 属于碎片/经验类`);
    }
    for (const bad of [0, -1, NaN, Infinity, -Infinity, '', 'abc', null, undefined]) {
        assert.equal(isTerritoryHeroRewardResId(bad), false, `脏值 ${String(bad)} 不算`);
    }
    // 判据真源是「是不是钱包类」，不是硬编码 18xxx / 16xxx 白名单
    // （固定格还有 10010 卷轴、19xxx 专属道具，它们同样堆在屏幕顶部中央）。
    assert.match(body(MODEL), /isTerritoryWalletResId/, '不许另抄一份 7/9 字面量');
});

test('从一批奖励里只挑非钱包类，保序并丢掉脏值', () => {
    const picked = collectTerritoryHeroRewards([
        { resId: 7, amount: 100 },
        { resId: 18003, amount: 3 },
        { resId: 9, amount: 5 },
        { resId: 16000, amount: 20 },
        { resId: 19350, amount: 0 },
        { resId: NaN, amount: 1 },
    ]);
    assert.deepEqual(picked.map((item) => item.resId), [18003, 16000]);
});

// ============================================================
// 需求 ②：随机格飞行曲线
// ============================================================

test('飞行曲线：错峰起手、进度单调、端点收工、非法值一律 null', () => {
    const count = 4;
    assert.equal(territoryHeroFlightFx(-1, 0, count), null);
    assert.equal(territoryHeroFlightFx(NaN, 0, count), null);
    assert.equal(territoryHeroFlightFx(0, 1, count), null, '第 1 枚还没到错峰时刻');
    assert.equal(territoryHeroFlightFx(0, 0, count)?.progress, 0);
    assert.equal(territoryHeroFlightFx(0, count, count), null, '越界 index');

    let last = -1;
    for (let t = 0; t < TERRITORY_HERO_FLIGHT_SECONDS; t += 0.01) {
        const fx = territoryHeroFlightFx(t, 0, count);
        assert.ok(fx, `${t}s 这一帧不该消失`);
        assert.ok(fx.progress > last, 'easeOutQuad 进度必须单调增');
        assert.ok(fx.progress >= 0 && fx.progress <= 1);
        assert.ok(fx.scale >= 0.7 && fx.scale <= 1);
        assert.ok(fx.opacity >= 0 && fx.opacity <= 1);
        assert.ok(fx.arcRatio > 0);
        last = fx.progress;
    }
    assert.equal(territoryHeroFlightFx(TERRITORY_HERO_FLIGHT_SECONDS, 0, count), null);
    assert.equal(territoryHeroFlightFx(TERRITORY_HERO_FLIGHT_STAGGER, 1, count)?.progress, 0,
        '第 1 枚在它自己的错峰时刻刚起手');
});

test('落地时刻与总时长对齐：最后一枚落地即整批收工（按显式时刻，不看 fx 变 null）', () => {
    const count = 4;
    assert.equal(territoryHeroFlightTotalSeconds(count), territoryHeroFlightArriveAt(count - 1, count));
    assert.ok(territoryHeroFlightArriveAt(1, count) > territoryHeroFlightArriveAt(0, count));
    assert.equal(territoryHeroFlightCountOf(1), 2, '一格只有一种经验也别只飞孤零零一枚');
    assert.equal(territoryHeroFlightCountOf(4), TERRITORY_HERO_FLIGHT_MAX_COUNT);
    assert.equal(territoryHeroFlightCountOf(100), TERRITORY_HERO_FLIGHT_MAX_COUNT, '钳到上限');
    assert.equal(territoryHeroFlightCountOf(NaN), 2);
});

// ============================================================
// 需求 ③：进度条从当前比例长满 → 整个 UI 消失
// ============================================================

test('进度条从当前 owned/need 起长到 100%，停一下再淡出到消失', () => {
    const from = 0.6;
    assert.equal(territoryHeroBadgeFrame(from, 0)?.progress, from, '起点是真实进度，不是 0');
    let last = from - 1e-9;
    for (let t = 0; t < TERRITORY_HERO_BADGE_GROW_SECONDS; t += 0.02) {
        const fx = territoryHeroBadgeFrame(from, t);
        assert.ok(fx);
        assert.ok(fx.progress >= last, '进度不许回退');
        assert.equal(fx.opacity, 1, '增长段不淡出');
        last = fx.progress;
    }
    assert.equal(territoryHeroBadgeFrame(from, TERRITORY_HERO_BADGE_GROW_SECONDS)?.progress, 1);
    const holdAt = TERRITORY_HERO_BADGE_GROW_SECONDS + TERRITORY_HERO_BADGE_HOLD_SECONDS / 2;
    assert.equal(territoryHeroBadgeFrame(from, holdAt)?.progress, 1);
    assert.equal(territoryHeroBadgeFrame(from, holdAt)?.opacity, 1);
    const fading = territoryHeroBadgeFrame(
        from, TERRITORY_HERO_BADGE_GROW_SECONDS + TERRITORY_HERO_BADGE_HOLD_SECONDS
        + TERRITORY_HERO_BADGE_FADE_SECONDS / 2);
    assert.ok(fading && fading.opacity > 0 && fading.opacity < 1, '尾段线性淡出');
    assert.equal(fading?.progress, 1, '淡出时进度保持满');
    assert.equal(territoryHeroBadgeFrame(from, TERRITORY_HERO_BADGE_TOTAL_SECONDS), null,
        '播完 = 整个 UI 消失（队列该出下一个）');
});

test('进度条：脏 from 钳到 [0,1]，非法 elapsed 一律 null', () => {
    assert.equal(territoryHeroBadgeFrame(NaN, 0)?.progress, 0);
    assert.equal(territoryHeroBadgeFrame(-3, 0)?.progress, 0);
    assert.equal(territoryHeroBadgeFrame(5, 0)?.progress, 1, '已满是 1 时演「保持满 → 消失」');
    assert.equal(territoryHeroBadgeFrame(1, 0)?.progress, 1);
    assert.equal(territoryHeroBadgeFrame(0.5, -1), null);
    assert.equal(territoryHeroBadgeFrame(0.5, NaN), null);
});

test('仅本次新达成入队：领奖前已可升级 / 本次没凑齐 / 满级都不播', () => {
    const base = {
        priority: 0, cardOwned: 6, cardNeed: 10, iconResId: 18003,
        canUpgradeBefore: false, canUpgradeAfter: true, maxedOrUnconfigured: false,
    };
    const states: ITerritoryHeroUpgradeState[] = [
        { ...base, cardId: 'A' },
        { ...base, cardId: 'B', canUpgradeBefore: true },   // 领奖前就满了 ⇒ 不重复播
        { ...base, cardId: 'C', canUpgradeAfter: false },   // 本次没凑齐 ⇒ 不播
        { ...base, cardId: 'D', maxedOrUnconfigured: true },// 满级 / 没配 ⇒ 不播
        { ...base, cardId: 'E', priority: -1, cardOwned: 9, cardNeed: 10 },
    ];
    const items = detectTerritoryHeroBadges(states);
    assert.deepEqual(items.map((item) => item.cardId), ['E', 'A'], '按 priority 排好，只留新达成');
    assert.equal(items[0].from, 0.9, '进度起点 = 9/10');
    assert.equal(items[1].from, 0.6, '进度起点 = 6/10');
    assert.equal(items[1].iconResId, 18003);
    assert.deepEqual(detectTerritoryHeroBadges([]), []);
    assert.equal(detectTerritoryHeroBadges([{ ...base, cardId: 'F', cardNeed: 0 }])[0].from, 1,
        'need 为 0 时直接从满开始');
});

test('多英雄按优先级逐个排好，同优先级按 cardId 兜底，不改入参', () => {
    const items: ITerritoryHeroBadgeItem[] = [
        { cardId: 'B', priority: 2, from: 0, iconResId: 0 },
        { cardId: 'Z', priority: 1, from: 0, iconResId: 0 },
        { cardId: 'A', priority: 1, from: 0, iconResId: 0 },
    ];
    assert.deepEqual(sortTerritoryHeroBadges(items).map((item) => item.cardId), ['A', 'Z', 'B']);
    assert.deepEqual(items.map((item) => item.cardId), ['B', 'Z', 'A'], 'slice().sort 不改入参');
});

// ============================================================
// 接线守卫：三条需求都真的接进运行时，而不是只写在注释里
// ============================================================

test('① 固定格落点分流：7/9 仍飞资源栏并击中那一格，其余改飞英雄按钮并让按钮抖', () => {
    const page = body(PAGE);
    assert.match(page, /setRewardCatchWorldPoint\(resId, bar\.slotWorldPositionOf\(key\)\)/,
        '钱包类落点原串必须保留（既有单测也钉着它）');
    assert.match(page, /setRewardCatchWorldPoint\(resId, heroWorld\)/, '非钱包类落点 = 英雄按钮');
    assert.match(page, /bar\.playGainFeedback\(key, amount\)/, '钱包类落地仍触发数字跳动');
    assert.match(page, /heroButton\.playHitFeedback\(\)/, '非钱包类落地触发按钮受击抖动');
    assert.match(page, /findHeroTabHost\(\)/, '找底栏逐层往上问，不从场景根搜');
    assert.match(page, /tabType === MainTab\.Hero/, '按 tabType 精确定位，不靠「第 2 个子节点」');
});

test('① 英雄按钮抖动复用 core 真源，不建 tween、不另抄曲线', () => {
    const tab = body(TAB);
    assert.match(tab, /spawnShakeScaleX\(/, '先 Y 后 X 的 X 段');
    assert.match(tab, /spawnShakeScaleY\(/, '先 Y 后 X 的 Y 段');
    assert.match(tab, /BUILDING_SHAKE_STRETCH/, '建筑生成 120% 档，与领地同一条脉冲');
    assert.match(tab, /SPAWN_SHAKE_TOTAL_SECONDS/, '播完显式停表');
    assert.doesNotMatch(tab, /tween\(/, '池化共用件不许挂 tween');
});

test('② 随机格：补一段飞行，但绝不替换原有喷发 + 合成读数', () => {
    const page = body(PAGE);
    assert.ok(page.includes('this.mapView.playResourceGain(cellId, gains, { frame: readoutFrame, amount });'),
        '原有喷发 + 读数必须原样保留');
    assert.match(page, /setHeroRewardTargetWorld\(/, '先登记英雄按钮终点');
    assert.match(page, /playHeroRewardFlight\(cellId, heroEntries\)/, '再补一段飞行');
    assert.match(page, /isTerritoryHeroRewardResId\(entry\.resId\)/, '只挑非钱包类，7/9 不重复飞');
    const view = body(VIEW);
    assert.match(view, /this\.stepHeroFlights\(dt\);/, '飞行挂进 update 逐帧推进');
    assert.match(view, /this\.resetHeroFlights\(\);/, '换章要收掉在飞的图标');
    assert.match(view, /convertToNodeSpaceAR\(world/, '世界坐标换算留在视图');
});

test('② 飞行视图：纯函数时间轴 + 池化，落地只通知一次', () => {
    const flight = body(FLIGHT);
    assert.match(flight, /territoryHeroFlightFx\(/, '曲线取 model 真源');
    assert.match(flight, /territoryHeroFlightArriveAt\(/, '按显式到达时刻判落地');
    assert.match(flight, /this\.landed = true/, '本批只通知一次，别把按钮连抖 8 次');
    assert.doesNotMatch(flight, /tween\(/, '池化节点不挂 tween');
});

test('③ 页面：任何来源的领奖都查一次新达成，且纯表现不接管结算', () => {
    const page = body(PAGE);
    assert.match(page, /void this\.playHeroBadges\(rewards\);/, 'presentRewards 统一触发');
    const trigger = page.indexOf('void this.playHeroBadges(rewards);');
    assert.ok(trigger >= 0 && trigger < page.indexOf('if (presentation?.popup === true)'),
        '必须排在所有分流之前：随机格 / 固定格 / 银币宝箱 / 挂机弹窗都要覆盖');
    const fn = page.slice(page.indexOf('private async playHeroBadges('), page.indexOf('private ensureHeroBadge('));
    assert.match(fn, /if \(!this\.isValid \|\| !items\.length\) return;/, 'await 之后判失效');
    assert.match(fn, /if \(!this\.isValid\) return;/, '第二次 await 之后还要判失效');
    assert.doesNotMatch(fn, /settleRewards|FW\.ShowReward|onDone/,
        '徽标是纯表现，绝不挂奖励结算');
    assert.match(page, /this\.heroBadge\?\.step\(step\);/, '徽标由页面 update 驱动');
    assert.match(page, /this\.heroBadge\?\.dispose\(\);/, '页面销毁要手动收底栏节点');
});

test('③ 徽标视图：串行队列 + 排在七格之上 + 不用 cc.ProgressBar', () => {
    const badge = body(BADGE);
    assert.match(badge, /sortTerritoryHeroBadges\(items\)/, '多英雄按优先级排队');
    assert.match(badge, /territoryHeroBadgeFrame\(/, '进度走 model 时间轴');
    assert.match(badge, /if \(!this\.current\) return;/, '一次只演一个英雄');
    assert.match(badge, /setSiblingIndex\(/, '必须压在底栏七格按钮之上');
    assert.doesNotMatch(badge, /ProgressBar|tween\(/, '按宽度重画，不用 ProgressBar / tween');
});

test('③ 数据源：组合层注入、预测叠加判新达成，不反向读两次背包', () => {
    const composition = body(COMPOSITION);
    assert.match(composition, /setHeroProgressSource\(new TerritoryHeroProgressSource\(\)\)/,
        '由 bootstrap 注入，领地页不反向 import app/card');
    const source = body(SOURCE);
    assert.match(source, /detectTerritoryHeroBadges\(states\)/, '判定用 model 纯函数');
    assert.match(source, /evaluateUpgrade\(table, entry\.card\.id, entry\.level, afterCounter\)/,
        'after 用「当前背包 + 本次增量」预测');
    assert.match(source, /createItemCounter\(\)/, '背包计数真源');
    assert.match(source, /sortLineupCards\(/, '排序复用卡库唯一真源');
    assert.doesNotMatch(source, /settleRewards|showRewards/, '数据源不碰发奖');
});
