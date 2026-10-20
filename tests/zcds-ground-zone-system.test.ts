import assert from 'node:assert/strict';
import test from 'node:test';
import { ZCGroundZoneSystem } from '../assets/script/app/zcds/model/systems/ZCGroundZoneSystem';
import type { ZCGroundZoneState, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';

test('持续区域按绝对时刻结算多波，并在到期后只结算一次额外伤害', () => {
    const zone: ZCGroundZoneState = {
        x: 0, y: 0, radius: 10, owner: 'player', sourceUnitId: 1,
        skillId: 2, skillName: '暴风雪', remainingSeconds: .2,
        wavesLeft: 2, nextWaveAt: 1, waveInterval: .1,
        damage: 7, slowRatio: 0, expireDamage: 3,
    };
    const target = { id: 2, owner: 'enemy', hp: 30, battleState: 'attack' } as ZCUnitState;
    const state = { elapsedSeconds: 1.1, groundZones: [zone], combatEvents: [], nextCombatEventId: 1 };
    const context = {
        hexIdAt: () => 0,
        unitsInRadius: () => [target],
        unitPosition: () => ({ x: 0, y: 0 }),
        damageUnit: (unit: ZCUnitState, damage: number) => { unit.hp -= damage; return null; },
        ensureSlowStatus: () => {},
        applyStatus: () => {},
        exportStatusEffects: () => undefined,
        hexStep: 1,
    };
    ZCGroundZoneSystem.tick(state, .2, context);
    assert.equal(target.hp, 13);
    assert.equal(state.combatEvents.length, 2);
    assert.equal(state.groundZones.length, 0);
    ZCGroundZoneSystem.tick(state, .2, context);
    assert.equal(target.hp, 13);
});
