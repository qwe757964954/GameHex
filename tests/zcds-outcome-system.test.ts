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

test('超时优先比较领地、主城血量；四项相同则平局', () => {
    assert.deepEqual(ZCOutcomeSystem.checkOutcome(state(80, 30), context, 0), {
        status: 'victory', reason: '结算胜利：我方按主城血量领先。',
    });
    assert.deepEqual(ZCOutcomeSystem.checkOutcome(state(40, 40), context, 0), {
        status: 'draw', reason: '2 方四项结算数据完全相同，本局平局。',
    });
});

test('主城归零先按已开发地块结算，计时未到不提前比较分数', () => {
    assert.equal(ZCOutcomeSystem.checkOutcome(state(80, 30, 59), context, 0), null);
    assert.deepEqual(ZCOutcomeSystem.checkOutcome(state(80, 0, 59), context, 0), {
        status: 'victory', reason: '强攻胜利：全部对手的已开发地块归零！',
    });
});

test('塔防必须全部波次已出且无存活敌人，主城失守立即失败', () => {
    const defence: IZCOutcomeContext = { ...context, pveDefence: { waves: [{ waveId: 1 }] } as IZCOutcomeContext['pveDefence'] };
    assert.equal(ZCOutcomeSystem.checkOutcome(state(80, 30), defence, 0), null);
    assert.deepEqual(ZCOutcomeSystem.checkOutcome(state(80, 30), defence, 1), {
        status: 'victory', reason: '塔防胜利：已击退全部 1 波守军。',
    });
    assert.deepEqual(ZCOutcomeSystem.checkOutcome(state(0, 30), defence, 1), {
        status: 'defeat', reason: '塔防失败：我方主城领地已失守。',
    });
});
