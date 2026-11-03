import assert from 'node:assert/strict';
import test from 'node:test';
import { createBattleSession } from './helpers/battle-session';

test('固定地图和自选出生点都只能进入有效对局阶段', t => {
    const fixed = createBattleSession();
    assert.equal(fixed.startPlaying(), true);
    assert.equal(fixed.currentPhase, 'playing');
    assert.equal(fixed.startPlaying(), false, '重复开始不改变阶段');

    t.after(() => fixed.dispose());
    const selecting = createBattleSession();
    t.after(() => selecting.dispose());
    assert.equal(selecting.startSpawnSelection(), true);
    assert.equal(selecting.currentPhase, 'spawn-selection');
    assert.equal(selecting.startPlaying(), true, '选点完成后进入对局');
    assert.equal(selecting.currentPhase, 'playing');
});

test('终局演出、撤退和离场转换幂等且不能回到对局', t => {
    const outcome = createBattleSession();
    outcome.startPlaying();
    assert.equal(outcome.beginSettlementPresentation(), true);
    assert.equal(outcome.beginSettlementPresentation(), false);
    assert.equal(outcome.currentPhase, 'settlement-presentation');
    assert.equal(outcome.openSettlement(), true);
    assert.equal(outcome.openSettlement(), false);
    assert.equal(outcome.currentPhase, 'settlement');
    assert.equal(outcome.startPlaying(), false);
    assert.equal(outcome.leave(), true);
    assert.equal(outcome.leave(), false);
    assert.equal(outcome.currentPhase, 'leaving');

    t.after(() => outcome.dispose());
    const retreat = createBattleSession();
    t.after(() => retreat.dispose());
    retreat.startPlaying();
    assert.equal(retreat.openSettlement(), true, '撤退可以跳过终局演出直接结算');
    assert.equal(retreat.currentPhase, 'settlement');
});

test('会话释放立即进入离场阶段，拒绝重新开始或结算', () => {
    const session = createBattleSession();
    session.startPlaying();
    session.dispose();
    assert.equal(session.currentPhase, 'leaving');
    assert.equal(session.isLeaving, true);
    assert.equal(session.isSettled, true);
    assert.equal(session.isPlaying, false);
    assert.equal(session.startPlaying(), false);
    assert.equal(session.startSpawnSelection(), false);
    assert.equal(session.beginSettlementPresentation(), false);
    assert.equal(session.openSettlement(), false);
    assert.equal(session.leave(), false);
});
