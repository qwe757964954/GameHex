import assert from 'node:assert/strict';
import test from 'node:test';
import { ZCStatusSystem } from '../assets/script/app/zcds/model/ZCStatusEffect';
import type { ZCStatusStatMods } from '../assets/script/app/zcds/model/ZCStatusEffect';

/**
 * P1-2B：`statModsOf` 共享对象只读 + 随机状态操作压力。
 *
 * 覆盖：
 * - 200 个单位、固定种子的 apply / remove / removeAll / tick 混合操作；
 * - 每个采样点把缓存结果与遍历 `instancesOf` 的独立重算逐键对比；
 * - 同一版本内返回同一引用，版本失效后不返回旧对象；
 * - 共享对象被冻结，调用方误写会当场失败（而不是静默改坏下一拍缓存）。
 */
const DEFS = [
    { id: 'attack-up', name: 'attack-up', durationSeconds: 4, maxStacks: 3, statMods: { attackPct: 10, attackFlat: 2 } },
    { id: 'slow', name: 'slow', durationSeconds: 6, maxStacks: 2, statMods: { moveSpeedPct: -5, attackIntervalPct: 8 } },
    { id: 'vulnerable', name: 'vulnerable', durationSeconds: 3, maxStacks: 4, statMods: { damageTakenPct: 7, damageRatePct: 3 } },
    { id: 'endure', name: 'endure', durationSeconds: 8, maxStacks: 2, statMods: { maxHpPct: 4, lifestealRate: 1 } },
] as const;

function expectedMods(system: ZCStatusSystem, unitId: string): ZCStatusStatMods {
    const result: ZCStatusStatMods = {};
    for (const inst of system.instancesOf(unitId)) {
        const def = system.getDef(inst.defId);
        if (!def?.statMods) continue;
        for (const key of Object.keys(def.statMods) as (keyof ZCStatusStatMods)[]) {
            const value = def.statMods[key];
            if (value == null || value === 0) continue;
            result[key] = (result[key] ?? 0) + value * inst.stacks;
        }
    }
    return result;
}

function assertSameMods(actual: ZCStatusStatMods, expected: ZCStatusStatMods, context: string): void {
    const keys = new Set<keyof ZCStatusStatMods>([
        ...Object.keys(actual) as Array<keyof ZCStatusStatMods>,
        ...Object.keys(expected) as Array<keyof ZCStatusStatMods>,
    ]);
    for (const key of keys) {
        assert.equal(actual[key] ?? 0, expected[key] ?? 0, `${context} 的 ${String(key)} 不一致`);
    }
}

test('200 单位随机 apply/remove/tick：缓存值始终等于独立重算', () => {
    const system = new ZCStatusSystem();
    for (const def of DEFS) system.register({ ...def });
    let seed = 0x5eed1234;
    const random = (): number => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 0x100000000;
    };
    const unitIds = Array.from({ length: 200 }, (_, index) => String(index + 1));
    const durations = [1, 2, 4, 6, 8];

    for (let step = 0; step < 60; step += 1) {
        for (let operation = 0; operation < 80; operation += 1) {
            const unitId = unitIds[Math.floor(random() * unitIds.length)];
            const action = random();
            if (action < 0.36) {
                const def = DEFS[Math.floor(random() * DEFS.length)];
                system.apply(unitId, def.id, {
                    stacks: 1 + Math.floor(random() * 2),
                    durationSeconds: durations[Math.floor(random() * durations.length)],
                    at: step * 0.2,
                });
            } else if (action < 0.68) {
                const def = DEFS[Math.floor(random() * DEFS.length)];
                system.remove(unitId, def.id);
            } else if (action < 0.78) {
                system.removeAll(unitId);
            } else {
                system.tick([unitId], 0.2);
            }
            const mods = system.statModsOf(unitId);
            assertSameMods(mods, expectedMods(system, unitId), `step ${step} op ${operation} unit ${unitId}`);
            assert.equal(system.statModsOf(unitId), mods, '同一版本内必须复用同一对象');
            assert.ok(Object.isFrozen(mods), '共享 mods 必须冻结，禁止调用方就地修改');
        }
    }
});

test('removeAll 后缓存失效；重新 apply 得到新对象，不残留旧字段', () => {
    const system = new ZCStatusSystem();
    for (const def of DEFS) system.register({ ...def });
    system.apply('1', 'attack-up');
    system.apply('1', 'slow');
    const before = system.statModsOf('1');
    assert.ok(before.attackPct && before.moveSpeedPct);

    system.removeAll('1');
    const empty = system.statModsOf('1');
    assert.notEqual(empty, before);
    assert.equal(empty.attackPct, undefined);
    assert.equal(empty.moveSpeedPct, undefined);

    system.apply('1', 'vulnerable');
    const after = system.statModsOf('1');
    assert.notEqual(after, empty);
    assert.equal(after.damageTakenPct, 7);
    assert.equal(after.attackPct, undefined);
});
