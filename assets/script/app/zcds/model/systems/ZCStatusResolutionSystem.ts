import type { ZCUnitDefinition } from '../ZCCombatCatalog';
import type { ZCDamageSource, ZCSnapshot, ZCUnitState } from '../ZCGameTypes';
import type { ZCOwner } from '../ZCMapConfig';
import { ZCStatusBasis, ZCStatusEffectKind } from '../ZCStatusEffect';
import type { ZCPeriodicEvent, ZCStatusSystem } from '../ZCStatusEffect';

export interface IZCStatusResolutionContext {
    readonly statusSystem: ZCStatusSystem;
    readonly unitById: ReadonlyMap<number, ZCUnitState>;
    readonly owners: readonly ZCOwner[];
    readonly combatDistanceScale: number;
    effectiveUnitDefinition(unit: ZCUnitState): Pick<ZCUnitDefinition, 'attack' | 'maxHp'>;
    unitPosition(unit: ZCUnitState): { x: number; y: number };
    displaceUnit(unit: ZCUnitState, dx: number, dy: number): void;
    damageUnit(unit: ZCUnitState, damage: number, source: ZCDamageSource): void;
    presentHeal(unit: ZCUnitState, amount: number): void;
}

/** Advances status effects against one match snapshot. Cross-system damage and presentation stay in the caller. */
export class ZCStatusResolutionSystem {
    static tick(state: ZCSnapshot, dt: number, context: IZCStatusResolutionContext): void {
        const statusSystem = context.statusSystem;
        const alive = new Map(state.units
            .filter((unit) => unit.battleState !== 'dead')
            .map((unit) => [String(unit.id), unit]));
        for (const unitId of statusSystem.unitIdsWithStatuses()) {
            if (!alive.has(unitId)) statusSystem.removeAll(unitId);
        }
        const previousMaxHp = new Map<number, number>();
        for (const [unitId, unit] of alive) {
            if (statusSystem.hasAny(unitId)) previousMaxHp.set(unit.id, context.effectiveUnitDefinition(unit).maxHp);
        }
        this.tickLegacyTraction(dt, alive, context);
        // An effect due on its expiry frame settles before the status loses its final duration.
        for (const event of statusSystem.collectPeriodicEvents(state.elapsedSeconds)) {
            this.resolvePeriodicEvent(event, context);
        }
        statusSystem.tick(Array.from(alive.keys()), dt);
        for (const unit of alive.values()) {
            const before = previousMaxHp.get(unit.id);
            if (before == null) continue;
            this.rescaleUnitMaxHp(unit, before, context.effectiveUnitDefinition(unit).maxHp);
        }
        state.statusEffects = statusSystem.exportSnapshot();
    }

    private static resolvePeriodicEvent(event: ZCPeriodicEvent, context: IZCStatusResolutionContext): void {
        const target = context.unitById.get(Number(event.targetId));
        if (!target || target.battleState === 'dead') return;
        const sourceUnit = event.sourceUnitId ? context.unitById.get(Number(event.sourceUnitId)) : undefined;
        let amount: number;
        if (event.flatDamagePerStack != null) {
            const hpDamage = target.maxHp * event.amountPct / 100 * event.stacks;
            const capAttack = event.senderAttack
                ?? (sourceUnit ? context.effectiveUnitDefinition(sourceUnit).attack * (sourceUnit.attackMultiplier ?? 1) : 0);
            const cappedHpDamage = event.capAttackMultiplier != null
                ? Math.min(hpDamage, capAttack * event.capAttackMultiplier)
                : hpDamage;
            amount = event.flatDamagePerStack * event.stacks + cappedHpDamage + (event.extraFlatDamage ?? 0);
        } else if (event.basis === ZCStatusBasis.TargetMaxHp) {
            amount = target.maxHp * event.amountPct / 100 * event.stacks;
            if (sourceUnit && event.capAttackMultiplier != null) {
                amount = Math.min(
                    amount,
                    context.effectiveUnitDefinition(sourceUnit).attack
                        * (sourceUnit.attackMultiplier ?? 1)
                        * event.capAttackMultiplier,
                );
            }
        } else {
            if (!sourceUnit) return;
            const senderAttack = context.effectiveUnitDefinition(sourceUnit).attack * (sourceUnit.attackMultiplier ?? 1);
            amount = senderAttack * event.amountPct / 100 * event.stacks;
            if (event.capAttackMultiplier != null) {
                amount = Math.min(amount, senderAttack * event.capAttackMultiplier);
            }
        }
        if (!(amount > 0)) return;
        if (event.effect === ZCStatusEffectKind.Damage) {
            context.damageUnit(target, amount, {
                owner: event.sourceOwner ?? sourceUnit?.owner
                    ?? context.owners.find((owner) => owner !== target.owner) ?? 'player',
                kind: 'unit',
                unitId: sourceUnit?.id,
            });
        } else {
            this.healUnit(target, amount, context);
        }
    }

    private static tickLegacyTraction(dt: number, alive: ReadonlyMap<string, ZCUnitState>,
        context: IZCStatusResolutionContext): void {
        const sources = Array.from(alive.values()).sort((left, right) => left.id - right.id);
        for (const source of sources) {
            const origin = context.unitPosition(source);
            for (const instance of context.statusSystem.instancesOf(String(source.id))) {
                const runtime = instance.runtimeBehavior;
                if (runtime?.kind !== 'legacyTraction') continue;
                const minimumDistance = 20 * context.combatDistanceScale;
                for (const target of sources) {
                    if (target.owner === source.owner || target.battleState === 'dead') continue;
                    const position = context.unitPosition(target);
                    const dx = origin.x - position.x, dy = origin.y - position.y;
                    const currentDistance = Math.hypot(dx, dy);
                    if (currentDistance < minimumDistance || currentDistance > runtime.range || currentDistance <= 1e-9) continue;
                    const step = Math.min(runtime.speed * dt, currentDistance - minimumDistance);
                    context.displaceUnit(target, dx / currentDistance * step, dy / currentDistance * step);
                }
            }
        }
    }

    static healUnit(target: ZCUnitState, amount: number, context: IZCStatusResolutionContext): void {
        if (target.battleState === 'dead' || !(amount > 0)) return;
        const before = target.hp;
        target.hp = Math.min(target.maxHp, target.hp + amount);
        const applied = target.hp - before;
        if (applied > 0) context.presentHeal(target, applied);
    }

    private static rescaleUnitMaxHp(unit: ZCUnitState, before: number, after: number): void {
        if (!Number.isFinite(before) || before <= 0 || !Number.isFinite(after) || after <= 0) return;
        const ratio = Math.max(0, Math.min(1, unit.hp / before));
        unit.maxHp = after;
        unit.hp = Math.min(after, Math.max(0, after * ratio));
    }
}
