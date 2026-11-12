import type { ZCSnapshot, ZCUnitState } from '../ZCGameTypes';
import { ZCOwner } from '../ZCMapConfig';
import type { ZCPeriodicEvent } from '../ZCStatusEffect';
import { ZCStatusBasis, ZCStatusEffectKind } from '../ZCStatusEffect';
import type { IZCModelServices } from './ZCModelServices';

export interface IZCStatusResolutionContext extends Pick<IZCModelServices, 'statusSystem' | 'effectiveDefinition' | 'unitPosition' | 'damageUnit'> {
    readonly unitById: ReadonlyMap<number, ZCUnitState>;
    readonly owners: readonly ZCOwner[];
    readonly combatDistanceScale: number;
    displaceUnit(unit: ZCUnitState, dx: number, dy: number): void;
    presentHeal(unit: ZCUnitState, amount: number): void;
}

/** Advances status effects against one match snapshot. Cross-system damage and presentation stay in the caller. */
export class ZCStatusResolutionSystem {
    private readonly alive = new Map<string, ZCUnitState>();
    private readonly aliveIds: string[] = [];
    private readonly previousMaxHp = new Map<number, number>();
    private readonly tractionSources: ZCUnitState[] = [];
    private readonly statusIds: string[] = [];
    private readonly periodicEvents: ZCPeriodicEvent[] = [];

    tick(state: ZCSnapshot, dt: number, context: IZCStatusResolutionContext): void {
        const statusSystem = context.statusSystem;
        // 每局独占 scratch；结算完成或抛错都释放单位引用，不进入快照。
        const { alive, aliveIds, previousMaxHp, tractionSources } = this;
        try {
            const statusIds = statusSystem.unitIdsWithStatuses(this.statusIds);
            if (statusIds.length === 0) {
                state.statusEffects = statusSystem.exportSnapshot();
                return;
            }
            for (const unit of state.units) {
                if (unit.battleState === 'dead') continue;
                const unitId = String(unit.id);
                alive.set(unitId, unit);
                aliveIds.push(unitId);
            }
            for (const unitId of statusIds) {
                if (!alive.has(unitId)) statusSystem.removeAll(unitId);
            }
            for (const [unitId, unit] of alive) {
                if (statusSystem.hasAny(unitId)) previousMaxHp.set(unit.id, context.effectiveDefinition(unit).maxHp);
            }
            ZCStatusResolutionSystem.tickLegacyTraction(dt, alive, tractionSources, context);
            // An effect due on its expiry frame settles before the status loses its final duration.
            for (const event of statusSystem.collectPeriodicEvents(state.elapsedSeconds, this.periodicEvents)) {
                ZCStatusResolutionSystem.resolvePeriodicEvent(event, context);
            }
            statusSystem.tick(aliveIds, dt);
            for (const unit of alive.values()) {
                const before = previousMaxHp.get(unit.id);
                if (before == null) continue;
                ZCStatusResolutionSystem.rescaleUnitMaxHp(unit, before, context.effectiveDefinition(unit).maxHp);
            }
            state.statusEffects = statusSystem.exportSnapshot();
        } finally {
            alive.clear();
            aliveIds.length = 0;
            previousMaxHp.clear();
            tractionSources.length = 0;
            this.statusIds.length = 0;
            this.periodicEvents.length = 0;
        }
    }

    private static resolvePeriodicEvent(event: ZCPeriodicEvent, context: IZCStatusResolutionContext): void {
        const target = context.unitById.get(Number(event.targetId));
        if (!target || target.battleState === 'dead') return;
        const sourceUnit = event.sourceUnitId ? context.unitById.get(Number(event.sourceUnitId)) : undefined;
        let amount: number;
        if (event.flatDamagePerStack != null) {
            const hpDamage = target.maxHp * event.amountPct / 100 * event.stacks;
            const capAttack = event.senderAttack
                ?? (sourceUnit ? context.effectiveDefinition(sourceUnit).attack * (sourceUnit.attackMultiplier ?? 1) : 0);
            const cappedHpDamage = event.capAttackMultiplier != null
                ? Math.min(hpDamage, capAttack * event.capAttackMultiplier)
                : hpDamage;
            amount = event.flatDamagePerStack * event.stacks + cappedHpDamage + (event.extraFlatDamage ?? 0);
        } else if (event.basis === ZCStatusBasis.TargetMaxHp) {
            amount = target.maxHp * event.amountPct / 100 * event.stacks;
            if (sourceUnit && event.capAttackMultiplier != null) {
                amount = Math.min(
                    amount,
                    context.effectiveDefinition(sourceUnit).attack
                        * (sourceUnit.attackMultiplier ?? 1)
                        * event.capAttackMultiplier,
                );
            }
        } else {
            if (!sourceUnit) return;
            const senderAttack = context.effectiveDefinition(sourceUnit).attack * (sourceUnit.attackMultiplier ?? 1);
            amount = senderAttack * event.amountPct / 100 * event.stacks;
            if (event.capAttackMultiplier != null) {
                amount = Math.min(amount, senderAttack * event.capAttackMultiplier);
            }
        }
        if (!(amount > 0)) return;
        if (event.effect === ZCStatusEffectKind.Damage) {
            context.damageUnit(target, amount, {
                owner: event.sourceOwner ?? sourceUnit?.owner
                    ?? context.owners.find((owner) => owner !== target.owner) ?? ZCOwner.Player,
                kind: 'unit',
                unitId: sourceUnit?.id,
            });
        } else {
            this.healUnit(target, amount, context);
        }
    }

    private static tickLegacyTraction(dt: number, alive: ReadonlyMap<string, ZCUnitState>,
        sources: ZCUnitState[], context: IZCStatusResolutionContext): void {
        for (const unit of alive.values()) sources.push(unit);
        sources.sort(compareUnitIds);
        for (const source of sources) {
            for (const instance of context.statusSystem.instancesOf(String(source.id))) {
                const runtime = instance.runtimeBehavior;
                if (runtime?.kind !== 'legacyTraction') continue;
                const origin = context.unitPosition(source);
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

function compareUnitIds(left: ZCUnitState, right: ZCUnitState): number {
    return left.id - right.id;
}
