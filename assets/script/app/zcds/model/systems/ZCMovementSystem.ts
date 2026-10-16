import type { ZCDeckBonuses, ZCUnitDefinition } from '../ZCCombatCatalog';
import type { ZCRuntimeRules } from '../ZCGameRuntimeConfig';
import type { ZCHexState, ZCUnitState } from '../ZCGameTypes';
import type { ZCMatchMap } from '../ZCMatchConfig';
import type { ZCOwner } from '../ZCMapConfig';
import type { ZCMapGeometry } from '../ZCMapGeometry';

export interface ZCMovementContext {
    map: ZCMatchMap;
    rules: Readonly<ZCRuntimeRules>;
    geometry: ZCMapGeometry;
    definition(unit: ZCUnitState): ZCUnitDefinition;
    bonuses(owner: ZCOwner): ZCDeckBonuses;
    goalHomeId(owner: ZCOwner, fromHexId: number): number;
    frozenSeconds(): number;
    hex(id: number): ZCHexState | null;
    hasExposedWall(hex: ZCHexState): boolean;
    moveUnitToHex(unit: ZCUnitState, id: number): void;
}

/** 连续坐标、自由行军和追击移动；跨格通过 registry 同步索引。 */
export class ZCMovementSystem {
    constructor(private readonly context: ZCMovementContext) {}
    position(unit: ZCUnitState, result = { x: 0, y: 0 }): { x: number; y: number } {
        // freeX/freeY 是唯一连续坐标；格子插值仅用于兼容旧快照。
        if (Number.isFinite(unit.freeX) && Number.isFinite(unit.freeY)) {
            result.x = unit.freeX;
            result.y = unit.freeY;
            return result;
        }
        const source = this.context.map.hexes[unit.sourceHexId];
        const target = unit.targetHexId === null ? source : this.context.map.hexes[unit.targetHexId];
        result.x = source.x + (target.x - source.x) * unit.progress;
        result.y = source.y + (target.y - source.y) * unit.progress;
        return result;
    }

    startMarch(unit: ZCUnitState): void {
        const pos = this.position(unit);
        const goal = this.context.map.hexes[this.context.goalHomeId(unit.owner, unit.sourceHexId)];
        unit.freeX = pos.x;
        unit.freeY = pos.y;
        unit.marchAngle = Math.atan2(goal.y - pos.y, goal.x - pos.x);
    }

    /** 自由直线移动推进：跨格更新索引，撞敌方建筑或出界即停。 */
    advanceMarch(unit: ZCUnitState, dt: number): void {
        if (unit.marchAngle === null) return;
        const definition = this.context.definition(unit);
        const bonuses = this.context.bonuses(unit.owner);
        const frozenMultiplier = unit.owner !== 'player' && this.context.frozenSeconds() > 0
            ? this.context.rules.artifactEnemySpeedMultiplier : 1;
        const step = definition.moveSpeed * bonuses.moveSpeedMultiplier * frozenMultiplier * dt;
        const nx = unit.freeX + Math.cos(unit.marchAngle) * step;
        const ny = unit.freeY + Math.sin(unit.marchAngle) * step;
        const nextHexId = this.context.geometry.hexIdAt(nx, ny);
        if (nextHexId !== null) {
            const nextHex = this.context.hex(nextHexId);
            // 敌方城墙或建筑会阻挡自由直行，停下后交给索敌/寻路状态处理。
            if (nextHex && nextHex.owner !== unit.owner
                && (this.context.hasExposedWall(nextHex) || nextHex.building !== 'none')) return;
        } else {
            return; // 目标点在地图外：停在原地
        }
        unit.freeX = nx;
        unit.freeY = ny;
        unit.facingRadians = unit.marchAngle;
        this.syncOccupiedHex(unit);
    }

    advanceUnitMovement(unit: ZCUnitState, dt: number): void {
        if (unit.targetHexId === null) return;
        const target = this.context.map.hexes[unit.targetHexId];
        const current = this.position(unit);
        const definition = this.context.definition(unit);
        const bonuses = this.context.bonuses(unit.owner);
        const frozenMultiplier = unit.owner !== 'player' && this.context.frozenSeconds() > 0
            ? this.context.rules.artifactEnemySpeedMultiplier : 1;
        const remaining = distance(current.x, current.y, target.x, target.y);
        const step = definition.moveSpeed * bonuses.moveSpeedMultiplier * frozenMultiplier * dt;
        unit.facingRadians = Math.round(Math.atan2(target.y - current.y, target.x - current.x) / (Math.PI / 4)) * (Math.PI / 4);
        if (remaining > step && remaining > 0.001) {
            unit.freeX = current.x + (target.x - current.x) * step / remaining;
            unit.freeY = current.y + (target.y - current.y) * step / remaining;
            unit.progress = Math.min(0.999, unit.progress + step / Math.max(1, remaining));
            this.syncOccupiedHex(unit);
            return;
        }
        unit.freeX = target.x;
        unit.freeY = target.y;
        unit.targetHexId = null;
        unit.progress = 0;
        this.syncOccupiedHex(unit);
    }

    /** 同格追击按目标实际坐标推进；格心可能始终落在近战射程之外。 */
    advanceTowardUnit(unit: ZCUnitState, target: ZCUnitState, dt: number): void {
        const current = this.position(unit);
        const destination = this.position(target);
        const remaining = distance(current.x, current.y, destination.x, destination.y);
        const definition = this.context.definition(unit);
        const bonuses = this.context.bonuses(unit.owner);
        const frozenMultiplier = unit.owner !== 'player' && this.context.frozenSeconds() > 0
            ? this.context.rules.artifactEnemySpeedMultiplier : 1;
        const step = Math.min(remaining, definition.moveSpeed * bonuses.moveSpeedMultiplier * frozenMultiplier * dt);
        unit.targetHexId = null;
        unit.progress = 0;
        if (remaining <= 0 || step <= 0) return;
        unit.facingRadians = Math.round(Math.atan2(destination.y - current.y, destination.x - current.x) / (Math.PI / 4)) * (Math.PI / 4);
        unit.freeX = current.x + (destination.x - current.x) * step / remaining;
        unit.freeY = current.y + (destination.y - current.y) * step / remaining;
        this.syncOccupiedHex(unit);
    }

    /** 按实际位置同步所在格索引；占领由统一计时系统处理。 */
    private syncOccupiedHex(unit: ZCUnitState): void {
        const hexId = this.context.geometry.hexIdAt(unit.freeX, unit.freeY);
        if (hexId === null) return;
        this.context.moveUnitToHex(unit, hexId);
    }

}

function distance(x: number, y: number, tx: number, ty: number): number {
    return Math.hypot(tx - x, ty - y);
}
