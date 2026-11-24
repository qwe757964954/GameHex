import type { ZCUnitState } from '../ZCGameTypes';
import { ZCOwner } from '../ZCMapConfig';
import type { ZCMatchMap } from '../ZCMatchConfig';
import type { IZCModelServices } from './ZCModelServices';

export interface ZCMovementContext extends Pick<IZCModelServices, 'rules' | 'geometry' | 'effectiveDefinition' | 'bonuses' | 'hex' | 'hasExposedWall'> {
    map: ZCMatchMap;
    goalHomeId(owner: ZCOwner, fromHexId: number): number;
    frozenSeconds(): number;
    moveUnitToHex(unit: ZCUnitState, id: number): void;
}

/** 冲刺一步的预测落点；`landed` = 本步会到达终点快照（可能是撞墙停下的）。*/
export interface IZCDashStep {
    /** 本步起点（世界坐标，已经过 `position()` 换算）。*/
    readonly fromX: number;
    readonly fromY: number;
    /** 本步终点，尚未落盘：调用方判完碰撞再 `placeAt`。*/
    readonly x: number;
    readonly y: number;
    /** 是否已到终点 / 被挡停（两者都是「冲刺该收场了」）。*/
    readonly landed: boolean;
}

/** 连续坐标、自由行军和追击移动；跨格通过 registry 同步索引。*/
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
        const source = this.context.map.hexes[unit.sourceHexId];
        const goal = this.context.map.hexes[this.context.goalHomeId(unit.owner, unit.sourceHexId)];
        unit.freeX = pos.x;
        unit.freeY = pos.y;
        const dx = source && goal ? goal.x - source.x : 0;
        const dy = source && goal ? goal.y - source.y : 0;
        unit.marchAngle = (dx !== 0 || dy !== 0) ? Math.atan2(dy, dx) : (goal ? Math.atan2(goal.y - pos.y, goal.x - pos.x) : 0);
    }

    /** 自由直线移动推进：跨格更新索引，撞敌方建筑或出界即停。*/
    advanceMarch(unit: ZCUnitState, dt: number): void {
        if (unit.marchAngle === null) return;
        const step = this.speedOf(unit) * dt;
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

    advanceUnitMovement(unit: ZCUnitState, dt: number, speedScale = 1): void {
        if (unit.targetHexId === null) return;
        const target = this.context.map.hexes[unit.targetHexId];
        const current = this.position(unit);
        const remaining = distance(current.x, current.y, target.x, target.y);
        const step = this.speedOf(unit, speedScale) * dt;
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

    /** 同格追击按目标实际坐标推进；格心可能始终落在近战射程之外。*/
    advanceTowardUnit(unit: ZCUnitState, target: ZCUnitState, dt: number, speedScale = 1): void {
        const destination = this.position(target);
        this.advanceTowardPoint(unit, destination.x, destination.y, dt, speedScale);
    }

    /**
     * 朝任意一点直线走一步（**不寻路**、不占格推进，只改连续坐标）。
     *
     * 给「圈内追击」用（2026-11-21 第 36 批 舞王舞伴）：它们不跑 `targetHexId` 那套寻路，
     * 也不想因为寻路把 `progress` 写脏；拴绳半径比一格大不了多少，直线过去就够了。
     */
    advanceTowardPoint(unit: ZCUnitState, x: number, y: number, dt: number, speedScale = 1): void {
        const current = this.position(unit);
        const remaining = distance(current.x, current.y, x, y);
        const step = Math.min(remaining, this.speedOf(unit, speedScale) * dt);
        unit.targetHexId = null;
        unit.progress = 0;
        if (remaining <= 0 || step <= 0) return;
        unit.facingRadians = Math.round(Math.atan2(y - current.y, x - current.x) / (Math.PI / 4)) * (Math.PI / 4);
        unit.freeX = current.x + (x - current.x) * step / remaining;
        unit.freeY = current.y + (y - current.y) * step / remaining;
        this.syncOccupiedHex(unit);
    }

    /**
     * 冲刺一步的预测落点（不落盘，调用方判完碰撞再 `placeAt`）。
     * 终点固定取起冲时拍下的 `dashX/dashY`，中途不寻路；进敌方城墙格即停，本次冲刺目标格除外。
     * 返回 `from` 是为了让调用方直接用同一口径的线段做扫掠碰撞。
    */
    dashStep(unit: ZCUnitState, dt: number, speedScale = 1): IZCDashStep {
        const current = this.position(unit);
        const destinationX = unit.dashX ?? current.x;
        const destinationY = unit.dashY ?? current.y;
        const remaining = distance(current.x, current.y, destinationX, destinationY);
        const step = this.speedOf(unit, speedScale) * dt;
        if (remaining <= 1e-6 || remaining <= step) {
            return { fromX: current.x, fromY: current.y, x: destinationX, y: destinationY, landed: true };
        }
        const nx = current.x + (destinationX - current.x) * step / remaining;
        const ny = current.y + (destinationY - current.y) * step / remaining;
        // 敌方城墙/建筑挡住冲刺：本步即收场。两处例外：
        // 1. 本次冲刺打的就是那格，放行（撞点由碰撞圈先拦）；
        // 2. `hexIdAt` 判不出格子时不算撞墙。
        const targetHexId = unit.targetWallHexId ?? unit.targetBuildingHexId;
        const hexId = this.context.geometry.hexIdAt(nx, ny);
        const hex = hexId === null ? null : this.context.hex(hexId);
        if (hex && hexId !== targetHexId && hex.owner !== unit.owner
            && (this.context.hasExposedWall(hex) || hex.building !== 'none')) {
            return { fromX: current.x, fromY: current.y, x: current.x, y: current.y, landed: true };
        }
        return { fromX: current.x, fromY: current.y, x: nx, y: ny, landed: false };
    }

    /**
     * 把单位摆到任意连续坐标：清掉寻路字段，按位移方向取八向朝向，再同步所在格。
     *
     * `keepFacing = true` 时不动朝向（2026-11-18 第 17 批 召唤物跟随）：舞伴每帧被钉在
     * 本体的四个阵位上，阵位随本体朝向旋转 ⇒ 若照位移方向重算朝向，本体一转圈舞伴就会
     * 各自扭头看自己飞过去的方向，观感是「四个人在原地打转」。缺省 false ⇒ 存量逐字不变。
    */
    placeAt(unit: ZCUnitState, x: number, y: number, keepFacing = false): void {
        const current = this.position(unit);
        if (!keepFacing && distance(current.x, current.y, x, y) > 1e-6) {
            unit.facingRadians = Math.round(Math.atan2(y - current.y, x - current.x) / (Math.PI / 4)) * (Math.PI / 4);
        }
        unit.targetHexId = null;
        unit.progress = 0;
        unit.freeX = x;
        unit.freeY = y;
        this.syncOccupiedHex(unit);
    }

    /** 一步的实际移速（世界 px/s）：面板移速 × 卡组加成 × 冰冻减速 × 本帧倍率。*/
    private speedOf(unit: ZCUnitState, speedScale = 1): number {
        const frozenMultiplier = unit.owner !== ZCOwner.Player && this.context.frozenSeconds() > 0
            ? this.context.rules.artifactEnemySpeedMultiplier : 1;
        return this.context.effectiveDefinition(unit).moveSpeed
            * this.context.bonuses(unit.owner).moveSpeedMultiplier
            * frozenMultiplier * speedScale;
    }

    /** 按实际位置同步所在格索引；占领由统一计时系统处理。*/
    private syncOccupiedHex(unit: ZCUnitState): void {
        const hexId = this.context.geometry.hexIdAt(unit.freeX, unit.freeY);
        if (hexId === null) return;
        this.context.moveUnitToHex(unit, hexId);
    }

}

function distance(x: number, y: number, tx: number, ty: number): number {
    return Math.hypot(tx - x, ty - y);
}

