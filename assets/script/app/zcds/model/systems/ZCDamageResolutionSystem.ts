import type { ZCDamageSource, ZCHexState, ZCSnapshot, ZCUnitState } from '../ZCGameTypes';
import { zcHexTopEdgeToward } from '../ZCHexTopGeometry';
import type { ZCOwner } from '../ZCMapConfig';
import { ZCCombatSystem } from './ZCCombatSystem';
import type { IZCModelServices } from './ZCModelServices';
import type { ZCUnitRegistry } from './ZCUnitRegistry';

const HATRED_SECONDS = 5;
const DEATH_SECONDS = 0.45;

export interface IZCDamageResolutionContext extends Pick<IZCModelServices, 'statusSystem'> {
    readonly units: ZCUnitRegistry;
    readonly damageDealt: Record<ZCOwner, number>;
    readonly damageTaken: Record<ZCOwner, number>;
}

export interface IZCDamageResult {
    readonly applied: number;
    readonly killed: boolean;
}

/** Applies combat damage and state transitions; the caller emits presentation and rewards. */
export class ZCDamageResolutionSystem {
    static damageUnit(state: ZCSnapshot, target: ZCUnitState, damage: number,
        source: ZCDamageSource, context: IZCDamageResolutionContext): IZCDamageResult | null {
        if (target.battleState === 'dead' || damage <= 0) return null;
        const takenMods = context.statusSystem.statModsOf(String(target.id));
        let scaledDamage = damage * Math.max(0, 1 + (takenMods.damageTakenPct ?? 0) / 100);
        const absorbed = Math.min(target.shield ?? 0, scaledDamage);
        if (absorbed > 0) {
            target.shield = Math.max(0, (target.shield ?? 0) - absorbed);
            scaledDamage -= absorbed;
        }
        const applied = ZCCombatSystem.applyDamage(target, scaledDamage);
        this.recordDamage(source.owner, target.owner, applied, context);
        const sender = source.kind === 'unit' && source.unitId != null
            ? context.units.byId.get(source.unitId) : undefined;
        if (sender) {
            const hatredUnit = target.hatredUnitId !== null
                ? context.units.byId.get(target.hatredUnitId) ?? null : null;
            const oldHatred = hatredUnit && hatredUnit.battleState !== 'dead' ? hatredUnit : null;
            if (target.hatredUnitId === sender.id || !oldHatred || state.elapsedSeconds > target.hatredUntil) {
                target.hatredUnitId = sender.id;
            }
            target.hatredUntil = state.elapsedSeconds + HATRED_SECONDS;
        }
        if (target.hp > 0) return { applied, killed: false };
        target.hp = 0;
        // Unit deaths are not frame operations: the protocol only accepts development, skill and chat.
        target.targetUnitId = null;
        target.targetWallHexId = null;
        target.targetBuildingHexId = null;
        target.targetHexId = null;
        target.progress = 0;
        target.deathRemoveAt = state.elapsedSeconds + DEATH_SECONDS;
        context.units.markDead(target);
        ZCCombatSystem.switchState(target, 'dead');
        return { applied, killed: true };
    }

    static damageWall(wall: ZCHexState, damage: number, attacker: Pick<ZCUnitState, 'owner' | 'freeX' | 'freeY'>,
        isExposed: boolean, center: { readonly x: number; readonly y: number },
        context: IZCDamageResolutionContext): IZCDamageResult | null {
        if (wall.owner === 'neutral' || !isExposed || damage <= 0) return null;
        const wallHpBefore = wall.wallHp;
        wall.wallHp = Math.max(0, wallHpBefore - damage);
        const applied = wallHpBefore - wall.wallHp;
        this.recordDamage(attacker.owner, wall.owner, applied, context);
        if (wall.wallHp > 0) return { applied, killed: false };
        wall.wallBreachedEdge = this.wallEdgeToward(attacker, center);
        return { applied, killed: true };
    }

    static damageBuilding(state: ZCSnapshot, building: ZCHexState, damage: number,
        attacker: Pick<ZCUnitState, 'owner'>, context: IZCDamageResolutionContext): IZCDamageResult | null {
        if (building.owner === 'neutral' || building.wallHp > 0) return null;
        const hpBefore = building.hp;
        building.hp -= damage;
        const applied = Math.min(damage, Math.max(0, hpBefore));
        this.recordDamage(attacker.owner, building.owner, applied, context);
        if (building.hp > 0) return { applied, killed: false };
        building.building = 'none';
        building.state = 'ruins';
        building.owner = attacker.owner;
        building.tier = 0;
        building.hp = 0;
        building.maxHp = 0;
        building.wallHp = 0;
        building.wallMaxHp = 0;
        building.wallBreachedEdge = null;
        building.cardId = null;
        building.developmentResolved = false;
        building.constructionRemainingSeconds = 0;
        building.constructionTotalSeconds = 0;
        building.captureOwner = null;
        building.captureSeconds = 0;
        delete state.spawnClocks[String(building.id)];
        delete state.spawnClocks[`mine:${building.id}`];
        delete state.spawnClocks[`barracks:${building.id}`];
        delete state.spawnClocks[`tower:${building.id}`];
        return { applied, killed: true };
    }

    private static recordDamage(attacker: ZCOwner, defender: ZCOwner, amount: number,
        context: IZCDamageResolutionContext): void {
        if (amount <= 0) return;
        context.damageDealt[attacker] += amount;
        context.damageTaken[defender] += amount;
    }

    /**
     * 破门边：必须和墙砖渲染共用顶面边口径。单位从两格外沿角点打墙时，站位可能落在
     * 标准正六边形法线（30°+60°·edge）与顶面实际外法线的分界夹角内，用标准公式会
     * 选到相邻的另一条边，导致缺口和单位错开一根（该断的砖没断）。
     */
    private static wallEdgeToward(unit: Pick<ZCUnitState, 'freeX' | 'freeY'>,
        center: { readonly x: number; readonly y: number }): number {
        return zcHexTopEdgeToward(unit.freeX, unit.freeY, center.x, center.y);
    }
}
