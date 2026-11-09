import assert from 'node:assert/strict';
import test from 'node:test';
import { ZCOutcomeSystem, type IZCOutcomeContext, type IZCOutcomeState } from '../assets/script/app/zcds/model/systems/ZCOutcomeSystem';
import type { ZCHexState, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';

const context: IZCOutcomeContext = {
    activeOwners: ['player', 'enemy'],
    pveDefence: null,
    homeId: (owner) => owner === 'player' ? 0 : 1,
};

function state(playerHp: number, enemyHp: number, seconds = 60): IZCOutcomeState {
    const hexes = [
        { owner: 'player', building: 'hq', hp: playerHp },
        { owner: 'enemy', building: 'hq', hp: enemyHp },
    ] as ZCHexState[];
    return {
        hexes,
        units: [] as ZCUnitState[],
        status: 'playing',
        elapsedSeconds: seconds,
        durationSeconds: 60,
    };
}

/** 4 人局：主城序号 0..3 分别是 player / enemy / enemy2 / enemy3。 */
const fourContext: IZCOutcomeContext = {
    activeOwners: ['player', 'enemy', 'enemy2', 'enemy3'],
    pveDefence: null,
    homeId: (owner) => ({ player: 0, enemy: 1, enemy2: 2, enemy3: 3 } as Record<string, number>)[owner] ?? 0,
};

test('超时优先比较领地、主城血量；四项相同则平局', () => {
    assert.deepEqual(ZCOutcomeSystem.checkOutcome(state(80, 30), context, 0), {
        status: 'victory', reason: '结算胜利：我方按主城血量领先。', winner: 'player',
    });
    assert.deepEqual(ZCOutcomeSystem.checkOutcome(state(40, 40), context, 0), {
        status: 'draw', reason: '2 方四项结算数据完全相同，本局平局。', winner: null,
    });
});

test('主城归零先按已开发地块结算，计时未到不提前比较分数', () => {
    assert.equal(ZCOutcomeSystem.checkOutcome(state(80, 30, 59), context, 0), null);
    assert.deepEqual(ZCOutcomeSystem.checkOutcome(state(80, 0, 59), context, 0), {
        status: 'victory', reason: '强攻胜利：全部对手的已开发地块归零！', winner: 'player',
    });
});

test('塔防只有击败 BOSS 才算胜利，中间波次清空不算；主城失守立即失败', () => {
    const defence: IZCOutcomeContext = { ...context, pveDefence: { waves: [{ waveId: 1 }] } as IZCOutcomeContext['pveDefence'] };
    assert.equal(ZCOutcomeSystem.checkOutcome(state(80, 30), defence, 0), null);
    assert.deepEqual(ZCOutcomeSystem.checkOutcome(state(80, 30), defence, 1), {
        status: 'victory', reason: '塔防胜利：BOSS 已被击败。', winner: 'player',
    });
    // 塔防没有 PvP 胜方：按敌方色铺场（= 既有表现），winner 必须是明确值而不是漏填 undefined。
    assert.deepEqual(ZCOutcomeSystem.checkOutcome(state(0, 30), defence, 1), {
        status: 'defeat', reason: '塔防失败：我方主城领地已失守。', winner: 'enemy',
    });
});

test('塔防：BOSS 未出场 / BOSS 仍存活时都不结算，入场的小怪清空也不算赢', () => {
    const defence: IZCOutcomeContext = {
        ...context,
        pveDefence: { waves: [{ waveId: 1 }, { waveId: 2, isBoss: true }] } as IZCOutcomeContext['pveDefence'],
    };
    // 只出到第 1 波、场上已无敌人：BOSS 还没来 ⇒ 继续打
    assert.equal(ZCOutcomeSystem.checkOutcome(state(80, 30), defence, 1, { spawned: false, alive: false }), null);
    // BOSS 已出场但还活着 ⇒ 继续打
    assert.equal(ZCOutcomeSystem.checkOutcome(state(80, 30), defence, 2, { spawned: true, alive: true }), null);
    assert.deepEqual(ZCOutcomeSystem.checkOutcome(state(80, 30), defence, 2, { spawned: true, alive: false }), {
        status: 'victory', reason: '塔防胜利：BOSS 已被击败。', winner: 'player',
    });
});

// ============================================================
// 胜方身份：status 是「以我方视角」的二值，胜负身份必须单独给出来
// ============================================================

test('4 人局我方被打光：winner 是**还站着的那个对手**，不是写死的 2 号席', () => {
    // 三个对手里只有紫方（enemy3）还剩两格已开发地块 —— 红 / 黄都被清零。
    const hexes = [
        { owner: 'player', building: 'hq', hp: 0 },
        { owner: 'enemy', building: 'hq', hp: 0 },
        { owner: 'enemy2', building: 'hq', hp: 0 },
        { owner: 'enemy3', building: 'hq', hp: 40 },
        { owner: 'enemy3', building: 'barracks', hp: 30 },
    ] as ZCHexState[];
    const result = ZCOutcomeSystem.checkOutcome({
        hexes, units: [] as ZCUnitState[], status: 'playing', elapsedSeconds: 30, durationSeconds: 60,
    }, fourContext, 0);

    assert.ok(result, '应判出结果');
    assert.equal(result!.status, 'defeat', '我方视角仍是失败');
    // 🔴 这是本轮 bug 的核心：以前这里没有 winner，视图只能 `status === 'victory' ? player : enemy`
    //    ⇒ 紫方赢的局也会按红方色铺地。
    assert.equal(result!.winner, 'enemy3', '胜方必须是紫方，不能沿用 2 号席');
});

test('4/3 人局分数结算：winner 是四项领先的那一方', () => {
    // 时间到，按领地数分胜负：黄方（enemy2）5 格 > 我方 2 格 > 红方 1 格。
    const hexes = [
        { owner: 'player', building: 'hq', hp: 50 },
        { owner: 'player', building: 'barracks', hp: 40 },
        { owner: 'enemy', building: 'hq', hp: 50 },
        { owner: 'enemy2', building: 'hq', hp: 50 },
        { owner: 'enemy2', building: 'barracks', hp: 40 },
        { owner: 'enemy2', building: 'barracks', hp: 40 },
        { owner: 'enemy2', building: 'barracks', hp: 40 },
        { owner: 'enemy2', building: 'barracks', hp: 40 },
    ] as ZCHexState[];
    const result = ZCOutcomeSystem.checkOutcome({
        hexes, units: [] as ZCUnitState[], status: 'playing', elapsedSeconds: 60, durationSeconds: 60,
    }, {
        activeOwners: ['player', 'enemy', 'enemy2'],
        pveDefence: null,
        homeId: (owner) => ({ player: 0, enemy: 2, enemy2: 3 } as Record<string, number>)[owner] ?? 0,
    }, 0);

    assert.ok(result);
    assert.equal(result!.status, 'defeat');
    assert.equal(result!.winner, 'enemy2', '赢的是黄方，扫场就该铺黄方色');
    assert.equal(result!.reason, '结算失败：对手2按占领地块领先。');
});

test('我方赢的两种路径 winner 都是我方的席位（不是"非胜即敌"的布尔）', () => {
    for (const result of [
        ZCOutcomeSystem.checkOutcome(state(80, 0, 10), context, 0),   // 强攻：对手全归零
        ZCOutcomeSystem.checkOutcome(state(90, 30, 60), context, 0),  // 分数领先
    ]) {
        assert.ok(result);
        assert.equal(result!.status, 'victory');
        assert.equal(result!.winner, 'player');
    }
});
