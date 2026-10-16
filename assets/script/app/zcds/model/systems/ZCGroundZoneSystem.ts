import type { ZCDamageSource, ZCGroundZoneState, ZCSnapshot, ZCUnitState } from '../ZCGameTypes';
import type { ZCStatusApplyOptions, ZCStatusSystemSnapshot } from '../ZCStatusEffect';

export interface IZCGroundZoneContext {
    readonly hexStep: number;
    hexIdAt(x: number, y: number): number | null;
    unitsInRadius(hexId: number, radiusHex: number): ZCUnitState[];
    unitPosition(unit: ZCUnitState): { x: number; y: number };
    damageUnit(unit: ZCUnitState, damage: number, source: ZCDamageSource): void;
    ensureSlowStatus(id: string, speedPct: number, durationSeconds: number): void;
    applyStatus(unit: ZCUnitState, id: string, options: ZCStatusApplyOptions): void;
    exportStatusEffects(): ZCStatusSystemSnapshot | undefined;
}

type IZCGroundZoneStepState = Pick<ZCSnapshot,
    'elapsedSeconds' | 'groundZones' | 'combatEvents' | 'nextCombatEventId' | 'statusEffects'>;

/** 持续区域只处理已创建的 zone；模型保留技能出手与创建 zone 的编排。 */
export class ZCGroundZoneSystem {
    static tick(state: IZCGroundZoneStepState, dt: number, context: IZCGroundZoneContext): void {
        if (!state.groundZones.length) return;
        const now = state.elapsedSeconds;
        const keep: ZCGroundZoneState[] = [];
        for (const zone of state.groundZones) {
            zone.remainingSeconds -= dt;
            while (zone.wavesLeft > 0 && now >= zone.nextWaveAt) {
                this.resolveWave(state, zone, context);
                zone.wavesLeft -= 1;
                zone.nextWaveAt += zone.waveInterval;
            }
            if (zone.remainingSeconds > 0.0001) keep.push(zone);
            else if ((zone.expireDamage ?? 0) > 0) this.resolveExpiry(state, zone, context);
        }
        state.groundZones = keep;
    }

    private static resolveWave(state: IZCGroundZoneStepState, zone: ZCGroundZoneState, context: IZCGroundZoneContext): void {
        state.combatEvents.push({
            id: state.nextCombatEventId++,
            type: 'area',
            owner: zone.owner,
            sourceUnitId: zone.sourceUnitId,
            targetUnitId: null,
            skillId: zone.skillId,
            skillName: zone.skillName,
            effectKey: null,
            projectileKey: null,
            effectPrefabPath: zone.effectPrefabPath ?? null,
            fromX: zone.x,
            fromY: zone.y,
            toX: zone.x,
            toY: zone.y,
            radius: zone.radius,
            damage: zone.damage,
            empowered: true,
            startedAt: state.elapsedSeconds,
            durationSeconds: zone.waveInterval,
        });
        const targetHexId = context.hexIdAt(zone.x, zone.y);
        if (targetHexId === null) return;
        const radiusHex = Math.ceil(zone.radius / context.hexStep) + 1;
        for (const target of context.unitsInRadius(targetHexId, radiusHex)) {
            if (target.owner === zone.owner || target.battleState === 'dead') continue;
            const pos = context.unitPosition(target);
            if (Math.hypot(zone.x - pos.x, zone.y - pos.y) > zone.radius) continue;
            context.damageUnit(target, zone.damage, {
                owner: zone.owner, kind: 'unit', unitId: zone.sourceUnitId,
                floatTextKind: zone.floatTextKind,
            });
            if (zone.slowRatio > 0) {
                const id = `__slow:${zone.slowRatio}__`;
                context.ensureSlowStatus(id, -zone.slowRatio * 100, 1);
                context.applyStatus(target, id, { at: state.elapsedSeconds, durationSeconds: 1 });
            }
        }
        if (zone.slowRatio > 0) state.statusEffects = context.exportStatusEffects();
    }

    private static resolveExpiry(state: IZCGroundZoneStepState, zone: ZCGroundZoneState, context: IZCGroundZoneContext): void {
        const targetHexId = context.hexIdAt(zone.x, zone.y);
        if (targetHexId === null) return;
        const radiusHex = Math.ceil(zone.radius / context.hexStep) + 1;
        for (const target of context.unitsInRadius(targetHexId, radiusHex)) {
            if (target.owner === zone.owner || target.battleState === 'dead') continue;
            const pos = context.unitPosition(target);
            if (Math.hypot(zone.x - pos.x, zone.y - pos.y) > zone.radius) continue;
            context.damageUnit(target, zone.expireDamage ?? 0, {
                owner: zone.owner, kind: 'unit', unitId: zone.sourceUnitId,
                floatTextKind: zone.floatTextKind,
            });
            if (target.hp <= 0 || !zone.expireStatusId || !(zone.expireStatusDuration && zone.expireStatusDuration > 0)) continue;
            context.applyStatus(target, zone.expireStatusId, {
                at: state.elapsedSeconds,
                sourceUnitId: String(zone.sourceUnitId),
                durationSeconds: zone.expireStatusDuration,
            });
        }
        state.statusEffects = context.exportStatusEffects();
    }
}
