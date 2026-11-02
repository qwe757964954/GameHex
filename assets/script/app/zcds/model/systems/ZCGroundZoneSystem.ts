import type { ZCFloatText, ZCGroundZoneState, ZCSnapshot, ZCUnitState } from '../ZCGameTypes';
import type { ZCStatusApplyOptions, ZCStatusSystemSnapshot } from '../ZCStatusEffect';
import type { IZCModelServices } from './ZCModelServices';

export interface IZCGroundZoneContext extends Pick<IZCModelServices, 'unitPosition' | 'damageUnit'> {
    readonly hexStep: number;
    hexIdAt(x: number, y: number): number | null;
    unitsInRadius(hexId: number, radiusHex: number): ZCUnitState[];
    ensureSlowStatus(id: string, speedPct: number, durationSeconds: number): void;
    applyStatus(unit: ZCUnitState, id: string, options: ZCStatusApplyOptions): void;
    exportStatusEffects(): ZCStatusSystemSnapshot | undefined;
    /**
     * 区域伤害的吸血（2026-11-04 椰蛋战士「生命汲取」100503）。
     *
     * 区域结算这一步拿不到 `IZCAttackResolutionContext`（没有 skillRuntime / statPatches /
     * effectiveDefinition），所以只把「谁打的 + 这一跳实际掉多少」丢回去，让模型找回源单位、
     * 转给 `ZCAttackResolutionSystem.applyLifesteal` —— 比例取法与普攻完全同源，
     * 不在这里另算一套。
     *
     * `hitText` 是 `damageUnit` 的返回值（`value` = `result.applied`），
     * 护盾全吃 / 溢出 / 已死都会是 0 或 null，此时不回血。
     * **源单位已经阵亡时模型侧直接跳过**：区域还在天上飞、人已经没了，不该继续吸。
     *
     * 声明成可选是为了「只跑区域结算」的轻量上下文（单测、工具）不必凭空凑一个攻击上下文；
     * 正式对局里 `ZCGameModel.buildGroundZoneContext` 一定会给，缺了只是不吸血、不会报错。
     */
    lifestealFromHit?(sourceUnitId: number, hitText: ZCFloatText | null): void;
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
            //  移动区域（暴风）：先推进位置再结算这一波，否则伤害会永远落在上一帧的格子上。
            if (zone.moveVelocityX || zone.moveVelocityY) {
                zone.x += (zone.moveVelocityX ?? 0) * dt;
                zone.y += (zone.moveVelocityY ?? 0) * dt;
            }
            while (zone.wavesLeft > 0 && now >= zone.nextWaveAt) {
                this.resolveWave(state, zone, context);
                zone.wavesLeft -= 1;
                zone.nextWaveAt += zone.waveInterval;
                //  命中名额打满 ⇒ 立刻散（「接触到足够数量的敌人会提前消失」）。
                if ((zone.maxHits ?? 0) > 0 && (zone.hitUnitIds?.length ?? 0) >= (zone.maxHits ?? 0)) {
                    zone.remainingSeconds = 0;
                    break;
                }
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
        //  命中名额（移动区域）：同一个敌人只算一次，满额就这一波直接收工。
        const maxHits = Math.max(0, zone.maxHits ?? 0);
        const hitUnitIds = zone.hitUnitIds;
        if (maxHits > 0 && (hitUnitIds?.length ?? 0) >= maxHits) return;
        const radiusHex = Math.ceil(zone.radius / context.hexStep) + 1;
        for (const target of context.unitsInRadius(targetHexId, radiusHex)) {
            if (target.owner === zone.owner || target.battleState === 'dead') continue;
            const pos = context.unitPosition(target);
            if (Math.hypot(zone.x - pos.x, zone.y - pos.y) > zone.radius) continue;
            if (maxHits > 0 && hitUnitIds) {
                if (hitUnitIds.includes(target.id)) continue;
                if (hitUnitIds.length >= maxHits) break;
                hitUnitIds.push(target.id);
            }
            const hitText = context.damageUnit(target, zone.damage, {
                owner: zone.owner, kind: 'unit', unitId: zone.sourceUnitId,
                floatTextKind: zone.floatTextKind,
            });
            //  每一跳各自回血：命中 N 人就回 N 次，各按「自身实际掉血 × 比例」。
            context.lifestealFromHit?.(zone.sourceUnitId, hitText);
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
            const hitText = context.damageUnit(target, zone.expireDamage ?? 0, {
                owner: zone.owner, kind: 'unit', unitId: zone.sourceUnitId,
                floatTextKind: zone.floatTextKind,
            });
            context.lifestealFromHit?.(zone.sourceUnitId, hitText);
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

