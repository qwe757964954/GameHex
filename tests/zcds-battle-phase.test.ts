import assert from 'node:assert/strict';
import test from 'node:test';
import { ZCBattlePhaseController } from '../assets/script/app/zcds/application/ZCBattlePhaseController';

test('固定地图和自选出生点都只能进入有效对局阶段', () => {
    const fixed = new ZCBattlePhaseController();
    assert.equal(fixed.startPlaying(), true);
    assert.equal(fixed.current, 'playing');
    assert.equal(fixed.startPlaying(), false, '重复开始不改变阶段');

    const selecting = new ZCBattlePhaseController();
    assert.equal(selecting.startSpawnSelection(), true);
    assert.equal(selecting.current, 'spawn-selection');
    assert.equal(selecting.startPlaying(), true, '选点完成后进入对局');
    assert.equal(selecting.current, 'playing');
});

test('终局演出、撤退和离场转换幂等且不能回到对局', () => {
    const outcome = new ZCBattlePhaseController();
    outcome.startPlaying();
    assert.equal(outcome.beginSettlementPresentation(), true);
    assert.equal(outcome.beginSettlementPresentation(), false);
    assert.equal(outcome.current, 'settlement-presentation');
    assert.equal(outcome.openSettlement(), true);
    assert.equal(outcome.openSettlement(), false);
    assert.equal(outcome.current, 'settlement');
    assert.equal(outcome.startPlaying(), false);
    assert.equal(outcome.leave(), true);
    assert.equal(outcome.leave(), false);
    assert.equal(outcome.current, 'leaving');

    const retreat = new ZCBattlePhaseController();
    retreat.startPlaying();
    assert.equal(retreat.openSettlement(), true, '撤退可以跳过终局演出直接结算');
    assert.equal(retreat.current, 'settlement');
});
