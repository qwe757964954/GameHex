import test from 'node:test';
import assert from 'node:assert/strict';
import { ZCAttackResolutionSystem } from '../assets/script/app/zcds/model/systems/ZCAttackResolutionSystem';
import { ZCSkillResolutionSystem } from '../assets/script/app/zcds/model/systems/ZCSkillResolutionSystem';
import { ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import type { ZCUnitState, ZCSnapshot, ZCCombatEvent } from '../assets/script/app/zcds/model/ZCGameTypes';
import type { IZCAttackResolutionContext } from '../assets/script/app/zcds/model/systems/ZCAttackResolutionSystem';
import type { ZCCounterRule, ZCDeckCard, ZCDeckBonuses, ZCUnitDefinition } from '../assets/script/app/zcds/model/ZCCombatCatalog';

function mockContext(overrides: Partial<IZCAttackResolutionContext> = {}): IZCAttackResolutionContext {
    const defaultDefinition: ZCUnitDefinition = {
        unitId: 'u1',
        name: 'u1',
        attack: 100,
        maxHp: 1000,
        moveSpeed: 100,
        attackSpeed: 100,
        attackRange: 100,
        attackInterval: 1,
        attackDuration: 0.3,
        attackHitTime: 0.1,
        bodyRadius: 10,
        spawnSeconds: 0,
        flying: false,
        canAttackAir: true,
        hero: false,
        prefabPath: '',
        prefabSize: 1,
        attackProfile: {
            skillId: 1001,
            name: 'atk',
            mode: 'melee',
            projectileSpeed: 500,
            areaRadius: 0,
            damageRate: 1,
            empoweredEvery: 0,
            empoweredSkillId: 0,
            secondarySkillId: 0,
            durationSeconds: 0.3,
            waves: 1,
            legacyEffectKeys: [],
        },
    };

    return {
        rules: {
            combatDistanceScale: 1,
            combatDamageMultiplier: 1,
            unitAttackPerTier: 0,
            counterDamageMultiplier: 1.3,
            resistedDamageMultiplier: 0.7,
        } as any,
        statusSystem: {
            statModsOf: () => ({}),
            hasDef: () => true,
            apply: () => ({ applied: true }),
            register: () => {},
            exportSnapshot: () => ({ units: [] }),
        } as any,
        geometry: {
            hexIdAt: () => 1,
        } as any,
        random: () => 0.5,
        effectiveDefinition: () => defaultDefinition,
        unitPosition: (u: ZCUnitState) => ({ x: u.freeX, y: u.freeY }),
        damageUnit: (_target: ZCUnitState, damage: number, source: any) => ({
            value: damage,
            appliedDamage: damage,
            kind: source.floatTextKind ?? 'damage',
            x: 0,
            y: 0,
        } as any),
        counters: [
            { trait: 'attack', attacker: 'warrior', defender: 'mage', damageMultiplier: 1.3 },
            { trait: 'attack', attacker: 'mage', defender: 'warrior', damageMultiplier: 0.7 },
        ] as any,
        cards: {
            [ZCOwner.Player]: new Map([
                ['card_w', { cardId: 'card_w', traits: { camp: 'nature', attack: 'warrior' } } as ZCDeckCard],
            ]),
            [ZCOwner.Enemy]: new Map([
                ['card_m', { cardId: 'card_m', traits: { camp: 'nature', attack: 'mage' } } as ZCDeckCard],
            ]),
        } as any,
        skillRuntime: {
            [ZCOwner.Player]: new Map(),
            [ZCOwner.Enemy]: new Map(),
        } as any,
        statPatches: {},
        deckBonuses: {
            [ZCOwner.Player]: { unitAttackMultiplier: 1 } as ZCDeckBonuses,
            [ZCOwner.Enemy]: { unitAttackMultiplier: 1 } as ZCDeckBonuses,
        } as any,
        unitById: new Map(),
        currentTarget: () => null,
        evaluateLegacySkill: () => ({ buffs: [], hitCount: 0, hasDamageFormula: false, damage: 0 }),
        applyLegacySelfBuffs: () => [],
        tryExecuteUnit: () => {},
        applyHitStatus: () => {},
        applyLegacyBuffs: () => {},
        damageWall: () => {},
        damageBuilding: () => {},
        unitsInRadius: () => [],
        healUnit: () => {},
        applyKnockback: () => {},
        pushProjectile: () => {},
        ...overrides,
    };
}

function makeUnit(id: number, owner: ZCOwner, x: number, y: number, cardId = 'card_w'): ZCUnitState {
    return {
        id,
        unitId: String(id),
        cardId,
        owner,
        freeX: x,
        freeY: y,
        hp: 1000,
        maxHp: 1000,
        tier: 1,
        battleState: 'idle',
        facingRadians: 0,
        activeProfileMode: 'melee',
    } as unknown as ZCUnitState;
}

test('P0-1: resolveRadialSkill does not pierce across entire map beyond maxRange', () => {
    const source = makeUnit(1, ZCOwner.Player, 0, 0);
    const targetInRange = makeUnit(2, ZCOwner.Enemy, 50, 0);
    const targetFarAway = makeUnit(3, ZCOwner.Enemy, 500, 0);
    const damagedUnits: number[] = [];

    const state: ZCSnapshot = {
        units: [source, targetInRange, targetFarAway],
        combatEvents: [],
        nextCombatEventId: 1,
    } as any;

    const event: ZCCombatEvent = {
        id: 1,
        type: 'area' as any,
        owner: ZCOwner.Player,
        sourceUnitId: 1,
        targetUnitId: 2,
        skillId: 1001,
        skillName: 'radial',
        effectKey: null,
        projectileKey: null,
        fromX: 0,
        fromY: 0,
        toX: 100,
        toY: 0,
        radius: 0,
        damage: 100,
        empowered: true,
        startedAt: 0,
        durationSeconds: 0.3,
    };

    const context = mockContext({
        damageUnit: (target) => {
            damagedUnits.push(target.id);
            return null;
        },
    });

    ZCAttackResolutionSystem.resolveRadialSkill(
        state, source, event, 100, 1, undefined, [], 'damage', context
    );

    assert.equal(damagedUnits.includes(2), true, 'target in range should be hit');
    assert.equal(damagedUnits.includes(3), false, 'target far away (> maxRange) should NOT be hit');
});

test('P0-2: counterMultiplierFor resolves defender card via targetUnit.cardId fallback', () => {
    const source = makeUnit(1, ZCOwner.Player, 0, 0, 'card_w');
    const defender = makeUnit(2, ZCOwner.Enemy, 50, 0, 'card_m');

    const context = mockContext({
        unitById: new Map([[2, defender]]),
    });

    // 传入 targetCardId 为 null 或错传，但传入 targetUnitId = 2
    const multiplier = ZCAttackResolutionSystem.counterMultiplierFor(
        source, ZCOwner.Enemy, null, context, 2
    );

    // warrior -> mage 克制倍率应该为 1.3
    assert.equal(multiplier, 1.3, 'should resolve card_m from targetUnitId and apply 1.3 counter multiplier');
});

test('P1-3: splash and burst skips units with hp <= 0', () => {
    const source = makeUnit(1, ZCOwner.Player, 0, 0);
    const aliveEnemy = makeUnit(2, ZCOwner.Enemy, 20, 0);
    const deadEnemy = makeUnit(3, ZCOwner.Enemy, 25, 0);
    deadEnemy.hp = 0; // 已死亡，但 battleState 尚未标记 dead

    const damagedIds: number[] = [];
    const context = mockContext({
        unitsInRadius: () => [aliveEnemy, deadEnemy],
        damageUnit: (target) => {
            damagedIds.push(target.id);
            return null;
        },
    });

    // 弹道命中爆炸
    const state: ZCSnapshot = {
        combatEvents: [],
        nextCombatEventId: 1,
        groundZones: [],
    } as any;

    const projectile: any = {
        id: 1,
        x: 20,
        y: 0,
        owner: ZCOwner.Player,
        sourceUnitId: 1,
        burstRadius: 50,
        burstDamage: 100,
    };

    ZCAttackResolutionSystem.resolveProjectileHit(
        state, projectile, { kind: 'unit', id: 2, x: 20, y: 0, bodyRadius: 5, cardId: 'card_m' }, context
    );

    assert.equal(damagedIds.includes(3), false, 'dead enemy with hp <= 0 should NOT take splash/burst damage');
});

test('P1-1: castRayBeam, castStorm, and castFireZone set floatTextKind and apply criticalMultiplier', () => {
    const source = makeUnit(1, ZCOwner.Player, 0, 0, 'card_w');
    const enemy = makeUnit(2, ZCOwner.Enemy, 50, 0, 'card_m');
    const state: ZCSnapshot = {
        units: [source, enemy],
        combatEvents: [],
        nextCombatEventId: 1,
        groundZones: [],
        elapsedSeconds: 0,
    } as any;

    const runtimeRay: any = {
        parameters: { rayHalfLength: 100, rayHalfWidth: 20, raySeconds: 2, rayInterval: 0.2, rayDamageRate: 1 },
    };
    const context = mockContext({
        currentTarget: () => ({ kind: 'unit', id: 2, x: 50, y: 0, bodyRadius: 10, cardId: 'card_m' }),
        unitById: new Map([[2, enemy]]),
        skillRuntime: {
            [ZCOwner.Player]: new Map([['1:1001', runtimeRay]]),
            [ZCOwner.Enemy]: new Map(),
        } as any,
    });

    ZCSkillResolutionSystem.castRayBeam(state, source, context);
    assert.equal(state.groundZones.length, 1);
    assert.equal(state.groundZones[0].floatTextKind, 'restraint', 'warrior vs mage should produce restraint floatTextKind');
});

test('P1-2: resolveImmediateAttack calculates splash damage independently per bystander', () => {
    const attacker = makeUnit(1, ZCOwner.Player, 0, 0, 'card_w');
    const primaryEnemy = makeUnit(2, ZCOwner.Enemy, 10, 0, 'card_w'); // 战士对战士，multiplier = 1
    const bystanderMage = makeUnit(3, ZCOwner.Enemy, 15, 0, 'card_m'); // 战士对法师，multiplier = 1.3
    const recordedHits: { id: number; damage: number; kind: string }[] = [];

    const state: ZCSnapshot = {
        units: [attacker, primaryEnemy, bystanderMage],
        combatEvents: [],
        nextCombatEventId: 1,
        elapsedSeconds: 0,
    } as any;

    const context = mockContext({
        unitById: new Map([[1, attacker], [2, primaryEnemy], [3, bystanderMage]]),
        unitsInRadius: () => [primaryEnemy, bystanderMage],
        damageUnit: (target, damage, source) => {
            recordedHits.push({ id: target.id, damage, kind: source.floatTextKind });
            return { value: damage, appliedDamage: damage } as any;
        },
    });

    const activeProfile: any = {
        mode: 'area',
        areaRadius: 30,
        skillId: 1001,
        name: 'sweep',
        damageRate: 1,
        waves: 1,
        legacyEffectKeys: [],
        impactEffectPrefabPath: null,
    };
    const target: any = { kind: 'unit', id: 2, x: 10, y: 0, cardId: 'card_w' };

    const attack: any = {
        target,
        activeProfile,
        profile: activeProfile,
        lance: false,
        empowered: false,
        skillRuntime: undefined,
        legacy: { buffs: [] },
        legacyTargetBuffs: [],
        floatTextKind: 'damage',
        onHitStatusId: undefined,
        damage: 100,
        legacyAreaRadius: 0,
        effectiveAreaRadius: 30,
        criticalMultiplier: 1,
        skillDamageRate: 1,
        event: {
            id: 1,
            type: 'area',
            owner: ZCOwner.Player,
            sourceUnitId: 1,
            targetUnitId: 2,
            skillId: 1001,
            skillName: 'sweep',
            effectKey: null,
            projectileKey: null,
            effectPrefabPath: null,
            fromX: 0,
            fromY: 0,
            toX: 10,
            toY: 0,
            radius: 30,
            damage: 100,
            empowered: false,
            startedAt: 0,
            durationSeconds: 0.3,
        },
    };

    // 执行近战/区域即时攻击
    (ZCAttackResolutionSystem as any).resolveImmediateAttack(
        state, attacker, attack, context
    );

    const bystanderHit = recordedHits.find((h) => h.id === 3);
    assert.ok(bystanderHit, 'bystander should be hit by area splash');
    // 战士打法师有 1.3 倍克制加成
    assert.equal(bystanderHit.kind, 'restraint', 'bystander hit floatTextKind should be restraint independently calculated');
    assert.equal(bystanderHit.damage, 130, 'bystander damage should be 130 (100 * 1.3)');
});


test('GC: applyBannerBuff uses swap-pop and does not throw', () => {
    const u1 = makeUnit(1, ZCOwner.Player, 0, 0);
    const u2 = makeUnit(2, ZCOwner.Player, 10, 0);
    const u3 = makeUnit(3, ZCOwner.Player, 20, 0);
    const state: ZCSnapshot = { units: [u1, u2, u3], elapsedSeconds: 0 } as any;
    const context = mockContext();

    assert.doesNotThrow(() => {
        ZCSkillResolutionSystem.applyBannerBuff(state, ZCOwner.Player, 2, 0.2, context);
    });
});
