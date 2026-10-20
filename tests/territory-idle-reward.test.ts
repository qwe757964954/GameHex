/**
 * 领地「离线挂机收益结算」的回归网。
 *
 * 分三段：
 *   A. 纯函数口径（`TerritoryIdleReward`，零运行时 `cc` 依赖）—— 1 小时产出周期、
 *      最多累计 8 小时、新站点账本从当前时刻起步（不追溯旧时间）、概率按万分比逐小时掷出、
 *      同 resId 多行累加。
 *   B. 路由口径（`idleRewardDestinationOf`）—— 银币（resId 7）/ 体力（resId 9）直接入钱包，
 *      其余 resId 进入领地库存。
 *   C. 接线守护（读源码文本，`SaveStore` / `TerritoryPage` 含 `cc` 无法在 Node 直接加载）——
 *      页面在占领之后结算、来源只含已占领站点、8 小时上限来自 campaign、奖励弹窗与 60 秒在线周期。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    idleRewardDestinationOf,
    settleTerritoryIdleRewards,
    TERRITORY_IDLE_REWARD_INTERVAL_MS,
    TERRITORY_SILVER_RES_ID,
    TERRITORY_STAMINA_RES_ID,
} from '../assets/script/app/territory/model/TerritoryIdleReward';
import type {
    TerritoryIdleRewardSource,
} from '../assets/script/app/territory/model/TerritoryIdleReward';

const HOUR = TERRITORY_IDLE_REWARD_INTERVAL_MS;
const NO_DROP_RANDOM = () => 0.99; // 概率项（非 10000）不命中
const DROP_RANDOM = () => 0;       // 概率项必命中

interface RewardSeed {
    resId: number;
    amount?: number;
    probability?: number;
    number?: number;
    pro?: number;
}

function makeSource(levelId: number, rewards: readonly RewardSeed[]): TerritoryIdleRewardSource {
    return {
        levelId,
        rewards: rewards.map((seed) => ({
            resId: seed.resId,
            name: `res_${seed.resId}`,
            amount: seed.amount ?? 1,
            probability: seed.probability ?? 10000,
        })),
    };
}

function readRows(name: string): Record<string, unknown>[] {
    const raw = JSON.parse(readFileSync(new URL(`../assets/remoteRef/${name}.json`, import.meta.url), 'utf8')) as
        | Record<string, unknown>[]
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(raw)) return raw;
    return raw.v.map((values) => Object.fromEntries(raw.k.map((key, index) => [key, values[index]])));
}

// ============================================================
// A. 结算周期 / 上限 / 不追溯 / 概率
// ============================================================

test('site missing from the ledger starts at now and never earns retroactive rewards', () => {
    const now = 100 * HOUR;
    const source = makeSource(10001, [
        { resId: 7, amount: 16 },
        { resId: 10012, amount: 2 },
    ]);
    const result = settleTerritoryIdleRewards({}, [source], now, 8, NO_DROP_RANDOM);
    assert.equal(result.changed, true);
    assert.equal(result.settledHours, 0);
    assert.deepEqual(result.rewards, []);
    assert.equal(result.claimedAtByLevel['10001'], now);
});

test('corrupted ledger entries behave like missing entries', () => {
    const now = 100 * HOUR;
    const source = makeSource(10001, [{ resId: 7, amount: 16 }]);
    const result = settleTerritoryIdleRewards(
        { 10001: 'not-a-timestamp' as unknown as number },
        [source],
        now,
        8,
        NO_DROP_RANDOM,
    );
    assert.deepEqual(result.rewards, []);
    assert.equal(result.claimedAtByLevel['10001'], now);
});

test('partial hour keeps accruing without granting a cycle', () => {
    const t0 = 100 * HOUR;
    const source = makeSource(10001, [{ resId: 7, amount: 16 }]);
    const result = settleTerritoryIdleRewards(
        { 10001: t0 },
        [source],
        t0 + HOUR - 1,
        8,
        NO_DROP_RANDOM,
    );
    assert.equal(result.changed, false);
    assert.deepEqual(result.rewards, []);
    assert.equal(result.claimedAtByLevel['10001'], t0);
});

test('one full hour grants one cycle and keeps the leftover partial hour', () => {
    const t0 = 100 * HOUR;
    const now = t0 + HOUR + 30 * 60 * 1000; // 1.5h
    const source = makeSource(10001, [
        { resId: 7, amount: 16 },
        { resId: 10012, amount: 2 },
    ]);
    const result = settleTerritoryIdleRewards({ 10001: t0 }, [source], now, 8, NO_DROP_RANDOM);
    assert.equal(result.settledHours, 1);
    assert.deepEqual(result.rewards, [
        { resId: 7, name: 'res_7', amount: 16 },
        { resId: 10012, name: 'res_10012', amount: 2 },
    ]);
    assert.equal(result.claimedAtByLevel['10001'], t0 + HOUR); // 30 分钟零头保留
});

test('offline time beyond the cap settles at most 8 hours and discards overflow', () => {
    const t0 = 100 * HOUR;
    const now = t0 + 10 * HOUR;
    const source = makeSource(10001, [
        { resId: 7, amount: 16 },
        { resId: 10012, amount: 2 },
    ]);
    const result = settleTerritoryIdleRewards({ 10001: t0 }, [source], now, 8, NO_DROP_RANDOM);
    assert.equal(result.settledHours, 8);
    assert.deepEqual(result.rewards, [
        { resId: 7, name: 'res_7', amount: 128 },
        { resId: 10012, name: 'res_10012', amount: 16 },
    ]);
    assert.equal(result.claimedAtByLevel['10001'], now); // 溢出 ⇒ 账本重置为 now
});

test('exactly 8 hours settles eight cycles and keeps the ledger rolling forward', () => {
    const t0 = 100 * HOUR;
    const now = t0 + 8 * HOUR;
    const source = makeSource(10001, [{ resId: 7, amount: 10 }]);
    const result = settleTerritoryIdleRewards({ 10001: t0 }, [source], now, 8, NO_DROP_RANDOM);
    assert.equal(result.settledHours, 8);
    assert.deepEqual(result.rewards, [{ resId: 7, name: 'res_7', amount: 80 }]);
    assert.equal(result.claimedAtByLevel['10001'], t0 + 8 * HOUR);
});

test('probabilistic rewards are rolled per hour against the configured permyriad rate', () => {
    const t0 = 100 * HOUR;
    const source = makeSource(10001, [
        { resId: 7, amount: 16 },
        { resId: 16014, amount: 1, probability: 600 },
    ]);
    const missed = settleTerritoryIdleRewards({ 10001: t0 }, [source], t0 + HOUR, 8, NO_DROP_RANDOM);
    assert.deepEqual(missed.rewards, [{ resId: 7, name: 'res_7', amount: 16 }]);

    const hit = settleTerritoryIdleRewards({ 10001: t0 }, [source], t0 + HOUR, 8, DROP_RANDOM);
    assert.deepEqual(hit.rewards, [
        { resId: 7, name: 'res_7', amount: 16 },
        { resId: 16014, name: 'res_16014', amount: 1 },
    ]);
});

test('multiple reward rows sharing one resId accumulate within and across hours', () => {
    const t0 = 100 * HOUR;
    const source = makeSource(10001, [
        { resId: 10012, amount: 2 },
        { resId: 10012, amount: 3 },
    ]);
    const result = settleTerritoryIdleRewards(
        { 10001: t0 },
        [source],
        t0 + 2 * HOUR,
        8,
        NO_DROP_RANDOM,
    );
    assert.deepEqual(result.rewards, [{ resId: 10012, name: 'res_10012', amount: 10 }]); // (2+3)*2
});

test('each occupied site settles independently on its own ledger and settledHours is the max', () => {
    const t0 = 100 * HOUR;
    const siteA = makeSource(10001, [{ resId: 7, amount: 10 }]);
    const siteB = makeSource(10002, [{ resId: 7, amount: 5 }]);
    const result = settleTerritoryIdleRewards(
        { 10001: t0, 10002: t0 + HOUR },
        [siteA, siteB],
        t0 + 3 * HOUR,
        8,
        NO_DROP_RANDOM,
    );
    // Site A: 3h × 10 = 30; site B: 2h × 5 = 10; same resId merges across sites.
    assert.deepEqual(result.rewards, [{ resId: 7, name: 'res_7', amount: 40 }]);
    assert.equal(result.settledHours, 3);
    assert.equal(result.claimedAtByLevel['10001'], t0 + 3 * HOUR);
    assert.equal(result.claimedAtByLevel['10002'], t0 + 3 * HOUR);
});

test('ledger timestamps in the future are reset to now without granting', () => {
    const now = 100 * HOUR;
    const source = makeSource(10001, [{ resId: 7, amount: 16 }]);
    const result = settleTerritoryIdleRewards(
        { 10001: now + 5 * HOUR },
        [source],
        now,
        8,
        NO_DROP_RANDOM,
    );
    assert.deepEqual(result.rewards, []);
    assert.equal(result.claimedAtByLevel['10001'], now);
});

test('real level table: offline 9h settles 8h of guaranteed silver and item rows only', () => {
    const level = readRows('levelInfo').find((row) => row.levelId === 10001);
    assert.ok(level, 'levelInfo 缺少 10001');
    const source: TerritoryIdleRewardSource = {
        levelId: 10001,
        rewards: ((level!.idleReward as RewardSeed[]) ?? []).map((row) => ({
            resId: Number(row.resId),
            name: `res_${row.resId}`,
            amount: Number(row.number),
            probability: Number(row.pro),
        })),
    };
    const t0 = 100 * HOUR;
    const result = settleTerritoryIdleRewards(
        { 10001: t0 },
        [source],
        t0 + 9 * HOUR,
        8,
        NO_DROP_RANDOM,
    );
    // Silver 16 × 8 = 128; item 10012 has two rows (2 + 3) × 8 = 40; rare rows never roll.
    assert.deepEqual(result.rewards, [
        { resId: 7, name: 'res_7', amount: 128 },
        { resId: 10012, name: 'res_10012', amount: 40 },
    ]);
});

// ============================================================
// B. 收益路由：钱包 / 领地库存
// ============================================================

test('silver (resId 7) and stamina (resId 9) go to the wallet, every other resId to inventory', () => {
    assert.equal(TERRITORY_SILVER_RES_ID, 7);
    assert.equal(TERRITORY_STAMINA_RES_ID, 9);
    assert.equal(idleRewardDestinationOf(7), 'wallet.silver');
    assert.equal(idleRewardDestinationOf(9), 'wallet.stamina');
    assert.equal(idleRewardDestinationOf(10012), 'inventory');
    assert.equal(idleRewardDestinationOf(16014), 'inventory');
});

// ============================================================
// C. 接线守护（SaveStore / TerritoryPage 含 cc，读源码文本）
// ============================================================

const saveStoreSrc = readFileSync(
    new URL('../assets/script/app/territory/model/TerritorySaveStore.ts', import.meta.url),
    'utf8',
);
const pageSrc = readFileSync(
    new URL('../assets/script/app/main/MainTerritoryMap.ts', import.meta.url),
    'utf8',
);
const presenterSrc = readFileSync(
    new URL('../assets/script/app/territory/application/TerritoryPresenter.ts', import.meta.url),
    'utf8',
);
const adapterSrc = readFileSync(
    new URL('../assets/script/app/territory/application/TerritorySaveStoreAdapter.ts', import.meta.url),
    'utf8',
);

test('save store routes each settlement through the destination table and persists only on change', () => {
    assert.match(saveStoreSrc, /idleRewardDestinationOf\(reward\.resId\)/);
    assert.match(saveStoreSrc, /save\.wallet\.silver \+= reward\.amount/);
    assert.match(saveStoreSrc, /save\.wallet\.stamina \+= reward\.amount/);
    assert.match(saveStoreSrc, /save\.inventory\[key\] =\s*amount\(save\.inventory\[key\]\) \+ reward\.amount/);
    assert.match(saveStoreSrc, /if \(settlement\.changed\) this\.save\(/);
});

test('territory page settles idle rewards after occupation, with only owned sites as sources', () => {
    // 2026-10-09 抽 Presenter 后：编排断言读 Presenter；store 委托断言读适配器；
    // 定时器 / 奖励弹窗仍在 Page（Passive View 的渲染侧）。
    assert.match(presenterSrc, /this\.idleRewardMaxHours = campaign\.idleRewardMaxHours/);
    assert.match(presenterSrc, /this\.progress\.isOwned\(item\.site\.cellId\)/);
    assert.match(adapterSrc, /this\.store\.settleIdleRewards\(/);
    assert.match(pageSrc, /FW\.ShowReward\(/);
    assert.match(pageSrc, /this\.schedule\(this\.onSlowTick,\s*60\)/);

    // Occupation must happen before idle settlement so newly occupied sites get their
    // ledger initialized at this moment instead of earning time before ownership.
    // 锚点要带相邻行（fastTick / slowTick 里也有同名调用，只搜单行会命中错误位置）。
    const occupationAt = presenterSrc.indexOf('this.settleProgress(now);\n        this.persistProgress();');
    const settlementAt = presenterSrc.indexOf('const idle = this.settleIdleRewards(now);\n        this.emitStateChange();');
    assert.ok(
        occupationAt >= 0 && settlementAt > occupationAt,
        '占领必须在挂机结算之前：新站点账本才会从当前时刻起步',
    );
});
