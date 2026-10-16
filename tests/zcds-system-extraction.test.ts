import assert from 'node:assert/strict';
import test from 'node:test';
import type { ZCDeckBonuses, ZCUnitDefinition } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import type { ZCRuntimeRules } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import type { ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import { ZCArtifactSystem } from '../assets/script/app/zcds/model/systems/ZCArtifactSystem';
import { ZCCombatSystem } from '../assets/script/app/zcds/model/systems/ZCCombatSystem';
import { ZCEconomySystem } from '../assets/script/app/zcds/model/systems/ZCEconomySystem';
import { ZCTargetingSystem } from '../assets/script/app/zcds/model/systems/ZCTargetingSystem';

const artifactRules = {
    artifactMaxStored: 2,
    artifactChargeFull: 100,
    artifactChargePerDevelopment: 12.5,
    artifactCooldownSeconds: 1,
    artifactFreezeSeconds: 3,
} as ZCRuntimeRules;

test('Artifact 系统独立处理旧快照归一化、充能和激活', () => {
    const state = { artifactReadyUses: 0, artifactCharge: 112.5, artifactCooldown: -1, enemyFrozenSeconds: -2 };
    ZCArtifactSystem.normalize(state, artifactRules);
    assert.deepEqual(state, { artifactReadyUses: 1, artifactCharge: 12.5, artifactCooldown: 0, enemyFrozenSeconds: 0 });

    for (let index = 0; index < 7; index += 1) ZCArtifactSystem.chargeFromDevelopment(state, artifactRules);
    assert.deepEqual(ZCArtifactSystem.activate(state, artifactRules), { ok: true });
    assert.equal(state.artifactReadyUses, 1);
    assert.equal(state.artifactCooldown, 1);
    assert.equal(state.enemyFrozenSeconds, 3);
});

test('Economy 系统统一建筑工作状态和周期键', () => {
    const hex = { id: 7, hp: 10, constructionRemainingSeconds: 0, building: 'mine' } as any;
    assert.equal(ZCEconomySystem.isBuildingOperational(hex), true);
    assert.equal(ZCEconomySystem.cycleKey(hex), 'mine:7');
    hex.constructionRemainingSeconds = 0.1;
    assert.equal(ZCEconomySystem.isBuildingOperational(hex), false);
});

test('Targeting 系统独立计算射程与确定性 BFS 首步', () => {
    const definition = { attackRange: 60 } as ZCUnitDefinition;
    assert.equal(ZCTargetingSystem.attackReach(definition, 20, 0.5), 40);
    assert.equal(ZCTargetingSystem.isInRange({ x: 0, y: 0 }, { x: 30, y: 0 }, 40), true);
    const graph: Record<number, number[]> = { 0: [2, 1], 1: [3], 2: [3], 3: [] };
    const step = ZCTargetingSystem.findPathStep({
        start: 0,
        isGoal: (id) => id === 3,
        neighborsOf: (id) => graph[id],
        canEnter: () => true,
        rank: (id) => id,
    });
    assert.equal(step, 1);
});

test('Combat 系统计算有效伤害并维护状态切换不变量', () => {
    const unit = {
        tier: 2,
        battleState: 'move',
        stateTime: 5,
        marchAngle: 1,
        targetHexId: 2,
        progress: 0.5,
    } as ZCUnitState;
    const definition = { attack: 100 } as ZCUnitDefinition;
    const bonuses = { unitAttackMultiplier: 1.2 } as ZCDeckBonuses;
    const rules = { unitAttackPerTier: 0.1, combatDamageMultiplier: 1 } as ZCRuntimeRules;
    assert.equal(ZCCombatSystem.unitDamage(unit, definition, bonuses, 1.3, rules), 172);

    ZCCombatSystem.switchState(unit, 'idle');
    assert.equal(unit.stateTime, 0);
    assert.equal(unit.targetHexId, null);
    assert.equal(unit.progress, 0);
    assert.equal(unit.marchAngle, null);

    const target = { hp: 30 };
    assert.equal(ZCCombatSystem.applyDamage(target, 50), 30);
    assert.equal(target.hp, 0);
});
