import type { ZCUnitDefinition } from '../ZCCombatCatalog';
import type { ZCCombatTarget, ZCHexState, ZCUnitState } from '../ZCGameTypes';
import type { ZCMatchMap } from '../ZCMatchConfig';
import type { ZCMapGeometry } from '../ZCMapGeometry';
import { ZCTargetingSystem, ZCPathWorkspace, type ZCTargetingContext } from './ZCTargetingSystem';
import type { IZCUnitTargeting } from './ZCUnitSystem';

const STRUCTURE_TARGET_BODY_RADIUS = 80;

export interface IZCUnitTargetingContext {
    readonly map: ZCMatchMap;
    readonly geometry: ZCMapGeometry;
    readonly units: ReadonlyMap<number, ZCUnitState>;
    readonly targeting: ZCTargetingContext;
    readonly combatDistanceScale: number;
    baseDefinition(id: string): ZCUnitDefinition;
    effectiveDefinition(unit: ZCUnitState): ZCUnitDefinition;
    unitPosition(unit: ZCUnitState): { x: number; y: number };
    hex(id: number): ZCHexState | null;
    hasExposedWall(hex: ZCHexState): boolean;
}

/** 每局独占的单位索敌、射程和寻路缓存。 */
export class ZCUnitTargeting implements IZCUnitTargeting {
    private readonly pathWorkspace: ZCPathWorkspace;
    private readonly rankedNeighbors = new Map<number, readonly (readonly number[])[]>();
    private readonly stepCache = new Map<number, {
        atHex: number; goalHex: number; targetX: number; targetY: number; bodyRadius: number; step: number | null;
    }>();

    constructor(private readonly context: IZCUnitTargetingContext) {
        this.pathWorkspace = new ZCPathWorkspace(context.map.hexes.length);
    }

    invalidateTerrain(): void {
        this.stepCache.clear();
    }

    removeUnit(id: number): void {
        this.stepCache.delete(id);
    }

    /** 全图最近索敌；距离相同时优先 id 较小的目标。 */
    acquire(unit: ZCUnitState): void {
        const target = ZCTargetingSystem.acquire(unit, this.context.targeting);
        unit.targetUnitId = null;
        unit.targetWallHexId = null;
        unit.targetBuildingHexId = null;
        if (target?.kind === 'unit') unit.targetUnitId = target.id;
        else if (target?.kind === 'wall') unit.targetWallHexId = target.id;
        else if (target?.kind === 'building') unit.targetBuildingHexId = target.id;
    }

    current(unit: ZCUnitState): ZCCombatTarget | null {
        if (unit.targetUnitId !== null) {
            const target = this.context.units.get(unit.targetUnitId) ?? null;
            if (!target || target.battleState === 'dead' || target.hp <= 0 || target.owner === unit.owner) return null;
            const definition = this.context.baseDefinition(target.unitId);
            if (!this.context.baseDefinition(unit.unitId).canAttackAir && definition.flying) return null;
            const position = this.context.unitPosition(target);
            return { kind: 'unit', id: target.id, x: position.x, y: position.y, bodyRadius: definition.bodyRadius, cardId: target.cardId };
        }
        if (unit.targetWallHexId !== null) {
            const hex = this.context.hex(unit.targetWallHexId);
            if (!hex || hex.owner === unit.owner || !this.context.hasExposedWall(hex)) return null;
            const config = this.context.map.hexes[hex.id];
            return { kind: 'wall', id: hex.id, x: config.x, y: config.y, bodyRadius: STRUCTURE_TARGET_BODY_RADIUS, cardId: null };
        }
        if (unit.targetBuildingHexId !== null) {
            const hex = this.context.hex(unit.targetBuildingHexId);
            if (!hex || hex.owner === 'neutral' || hex.owner === unit.owner || hex.building === 'none' || hex.hp <= 0
                || hex.wallHp > 0) return null;
            const config = this.context.map.hexes[hex.id];
            return { kind: 'building', id: hex.id, x: config.x, y: config.y, bodyRadius: STRUCTURE_TARGET_BODY_RADIUS, cardId: hex.cardId };
        }
        return null;
    }

    isInAttackRange(unit: ZCUnitState): boolean {
        const target = this.current(unit);
        if (!target) return false;
        const from = this.context.unitPosition(unit);
        const reach = this.attackReach(this.context.effectiveDefinition(unit), target.bodyRadius);
        return ZCTargetingSystem.isInRange(from, target, reach);
    }

    /** 滞回脱离判定：目标移出 reach * 1.3 后才重新追击。 */
    isOutOfAttackRange(unit: ZCUnitState): boolean {
        const target = this.current(unit);
        if (!target) return true;
        const from = this.context.unitPosition(unit);
        const reach = this.attackReach(this.context.effectiveDefinition(unit), target.bodyRadius);
        return ZCTargetingSystem.isOutOfRange(from, target, reach);
    }

    face(unit: ZCUnitState): void {
        const target = this.current(unit);
        if (!target) return;
        const from = this.context.unitPosition(unit);
        const raw = Math.atan2(target.y - from.y, target.x - from.x);
        unit.facingRadians = Math.round(raw / (Math.PI / 4)) * (Math.PI / 4);
    }

    findStepToward(unit: ZCUnitState): number | null {
        const target = this.current(unit);
        if (!target) return null;
        const destinationId = target.kind === 'unit'
            ? this.context.units.get(target.id)?.sourceHexId
            : target.id;
        if (destinationId === undefined) return null;
        const cached = this.stepCache.get(unit.id);
        if (cached && cached.atHex === unit.sourceHexId && cached.goalHex === destinationId
            && cached.targetX === target.x && cached.targetY === target.y && cached.bodyRadius === target.bodyRadius) {
            return cached.step;
        }
        const reach = this.attackReach(this.context.baseDefinition(unit.unitId), target.bodyRadius);
        const step = this.findPathStep(unit, (id) => {
            const config = this.context.map.hexes[id];
            return (target.kind === 'unit' && id === destinationId)
                || Math.hypot(config.x - target.x, config.y - target.y) <= reach;
        }, destinationId);
        this.stepCache.set(unit.id, {
            atHex: unit.sourceHexId, goalHex: destinationId,
            targetX: target.x, targetY: target.y, bodyRadius: target.bodyRadius, step,
        });
        return step;
    }

    private attackReach(definition: ZCUnitDefinition, targetBodyRadius: number): number {
        return ZCTargetingSystem.attackReach(definition, targetBodyRadius, this.context.combatDistanceScale);
    }

    private findPathStep(unit: ZCUnitState, isGoal: (hexId: number) => boolean, preferredId: number): number | null {
        let ranked = this.rankedNeighbors.get(preferredId);
        if (!ranked) {
            const distances = this.context.map.hexes.map((hex) => this.context.geometry.distance(hex.id, preferredId));
            ranked = this.context.map.hexes.map((hex) => [...hex.neighbors].sort((a, b) => distances[a] - distances[b]));
            this.rankedNeighbors.set(preferredId, ranked);
        }
        const neighbors = ranked;
        return ZCTargetingSystem.findPathStep({
            start: unit.sourceHexId,
            isGoal,
            neighborsOf: (id) => neighbors[id],
            canEnter: (id) => {
                const neighbor = this.context.hex(id);
                if (!neighbor) throw new Error(`寻路地块不存在：${id}`);
                const blocked = neighbor.owner !== unit.owner
                    && (this.context.hasExposedWall(neighbor) || neighbor.building !== 'none');
                return !blocked || id === preferredId;
            },
            rank: (id) => this.context.geometry.distance(id, preferredId),
            workspace: this.pathWorkspace,
            neighborsAreRanked: true,
        });
    }
}
