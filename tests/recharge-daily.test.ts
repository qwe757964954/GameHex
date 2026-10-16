import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildRoundView,
    parseRechargeDailyRows,
    readRoundProgresses,
    RECHARGE_DAILY_STATE,
} from '../assets/script/app/gift/RechargeDailyTable';

// 模拟 rechargeDaily.json 的前几行（round=1）
const tableRows = [
    { round: 1, days: 1, openGainItemNum: 60, rewards: [{ resId: 10991, number: 2 }, { resId: 10, number: 60 }], finishRewards: [] },
    { round: 1, days: 2, openGainItemNum: 60, rewards: [{ resId: 10012, number: 60 }, { resId: 10, number: 60 }], finishRewards: [{ resId: 10992, number: 2 }] },
    { round: 1, days: 3, openGainItemNum: 60, rewards: [{ resId: 10011, number: 10 }], finishRewards: [] },
];

// 模拟 CmdRechargeDaily：已充 60 金币，第1天已领(3)，第2天可领(2)，第3天锁定(0)
const cmd = {
    rechargeCount: 60,
    infos: [
        { id: 1, day: 2, accDay: 1, takenIds: [3, 2, 0], accTakenIds: [0, 0, 0] },
    ],
};

test('解析表行：按 round/days 排序', () => {
    const rows = parseRechargeDailyRows(tableRows);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].days, 1);
    assert.equal(rows[1].finishRewards.length, 1);
});

test('读缓存：按 round 取进度', () => {
    const p = readRoundProgresses(cmd);
    assert.equal(p.get(1)?.rechargeCount, 60);
    assert.equal(p.get(1)?.accDay, 1);
    assert.deepEqual(p.get(1)?.takenIds, [3, 2, 0]);
});

test('每天状态：takenIds[day-1] 直接映射', () => {
    const rows = parseRechargeDailyRows(tableRows);
    const view = buildRoundView(1, rows, readRoundProgresses(cmd).get(1));
    assert.equal(view.days[0].state, RECHARGE_DAILY_STATE.rewarded);
    assert.equal(view.days[1].state, RECHARGE_DAILY_STATE.canReward);
    assert.equal(view.days[2].state, RECHARGE_DAILY_STATE.locked);
});

test('累计奖励：finishRewards 非空的天才画格', () => {
    const rows = parseRechargeDailyRows(tableRows);
    const view = buildRoundView(1, rows, readRoundProgresses(cmd).get(1));
    assert.equal(view.accRewards.length, 1);
    assert.equal(view.accRewards[0].days, 2);
    assert.equal(view.accRewards[0].reward.resId, 10992);
});

test('缓存为空：全部 locked，进度 0', () => {
    const rows = parseRechargeDailyRows(tableRows);
    const view = buildRoundView(1, rows, undefined);
    assert.equal(view.accProgress, 0);
    for (const d of view.days) assert.equal(d.state, 0);
});
