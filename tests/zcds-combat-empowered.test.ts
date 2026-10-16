import assert from 'node:assert/strict';
import test from 'node:test';
import { ZCSkillTrigger } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import { ZCCombatSystem } from '../assets/script/app/zcds/model/systems/ZCCombatSystem';

test('按秒强化攻击首击只建立绝对冷却时刻，快照恢复后仍按原时刻触发', () => {
    const unit: { completedAttackCount?: number; empoweredReadyAt?: number } = {};
    const profile = { trigger: ZCSkillTrigger.everySeconds, cooldown: 2, empoweredEvery: 3 };
    assert.equal(typeof ZCCombatSystem.consumeEmpoweredAttack, 'function');
    assert.equal(ZCCombatSystem.consumeEmpoweredAttack(unit, profile, 10), false);
    assert.equal(unit.empoweredReadyAt, 12);
    assert.equal(ZCCombatSystem.consumeEmpoweredAttack(unit, profile, 11.9), false);
    const restored = { ...unit };
    assert.equal(ZCCombatSystem.consumeEmpoweredAttack(restored, profile, 12), true);
    assert.equal(restored.empoweredReadyAt, 14);
    assert.equal(restored.completedAttackCount, 3);
});

test('按次数强化攻击只在第 N 次普攻触发', () => {
    const unit: { completedAttackCount?: number; empoweredReadyAt?: number } = {};
    const profile = { trigger: ZCSkillTrigger.everyNAttacks, empoweredEvery: 3 };
    assert.equal(ZCCombatSystem.consumeEmpoweredAttack(unit, profile, 0), false);
    assert.equal(ZCCombatSystem.consumeEmpoweredAttack(unit, profile, 1), false);
    assert.equal(ZCCombatSystem.consumeEmpoweredAttack(unit, profile, 2), true);
    assert.equal(unit.completedAttackCount, 3);
    assert.equal(unit.empoweredReadyAt, undefined);
});
