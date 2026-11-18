import type { IZCModelServices } from './ZCModelServices';
import type { ZCUnitDefinition } from '../ZCCombatCatalog';
import type { ZCCombatTargetKind, ZCHexState, ZCUnitState } from '../ZCGameTypes';
import { ZC_OWNER_ORDER, type ZCOwner } from '../ZCMapConfig';
import { isZCAwakeMonster } from './ZCNeutralFeatureSystem';
import { ZCSkillTargetMode } from '../ZCSkillRuntime';

export interface ZCPoint { readonly x: number; readonly y: number }
export interface ZCTargetSelection { readonly kind: ZCCombatTargetKind; readonly id: number }
/** acquire 的复用出参；只在当次调用内有效，调用方不得跨拍保留。*/
export interface ZCTargetSelectionSink { kind: ZCCombatTargetKind; id: number }

export interface ZCTargetingContext extends Pick<IZCModelServices, 'unitPosition' | 'effectiveDefinition' | 'hasExposedWall'> {
    readonly baseDefinition: (id: string) => ZCUnitDefinition;
    readonly now: number;
    readonly units: readonly ZCUnitState[];
    readonly hexes: readonly ZCHexState[];
    readonly unitById: (id: number) => ZCUnitState | null;
    readonly hexPosition: (hexId: number) => ZCPoint;
    readonly preferUnitTargets?: (unit: ZCUnitState) => boolean;
    /** 已按 owner 建好索引时，索敌只遍历敌方桶，不再线性扫全量 units。*/
    readonly unitsOf?: (owner: ZCOwner) => ReadonlySet<ZCUnitState>;
    /** 已按「当前单位 owner」预分组的目标地块；缺省时回退到全量 hexes。*/
    readonly candidateHexes?: (owner: ZCOwner) => readonly ZCHexState[];
    readonly canTargetUnit?: (unit: ZCUnitState, candidate: ZCUnitState) => boolean;
}

/** 索敌是同步纯查询；候选坐标出参共用一块，避免每次 acquire 新建字面量。*/
const ACQUIRE_POSITION = { x: 0, y: 0 };

/** 每局独占的 BFS 工作区；访问标记避免每次创建 Set/Map。*/
export class ZCPathWorkspace {
    readonly queue: number[] = [];
    readonly visited: Uint32Array;
    readonly firstStep: Int32Array;
    generation = 0;
    constructor(size: number) {
        this.visited = new Uint32Array(size);
        this.firstStep = new Int32Array(size);
    }
}

/** `findPathStep` 的入参：BFS 起点、目标判定、邻居图、可入判定与排序。*/
export interface IZCPathStepOptions {
    readonly start: number;
    readonly isGoal: (id: number) => boolean;
    readonly neighborsOf: (id: number) => readonly number[];
    readonly canEnter: (id: number) => boolean;
    /** 邻居排序分值（小者先搜）；`neighborsAreRanked` 为 true 时不使用。*/
    readonly rank: (id: number) => number;
    /** 传入则复用工作区、零分配；省略时走一次性 Set/Map。*/
    readonly workspace?: ZCPathWorkspace;
    /** `neighborsOf` 返回的邻居是否已按 rank 排好（true 时跳过每格排序）。*/
    readonly neighborsAreRanked?: boolean;
}

/** 索敌排序、射程和通用 BFS；不持有对局状态。*/
export class ZCTargetingSystem {
    static skillSearchRadius(radius: number, mode = ZCSkillTargetMode.Range): number {
        return mode === ZCSkillTargetMode.All ? Infinity : radius;
    }

    static auraSearchRadius(params: Readonly<Record<string, number>> | undefined, scale: number): number {
        const radius = Math.max(0, params?.auraRadius ?? 0);
        const halfHeight = Math.max(0, params?.auraRectHalfHeight ?? 0);
        const halfLength = halfHeight > 0 ? Math.max(0, params?.auraRectHalfLength ?? 0) || radius : radius;
        return (Math.max(0, params?.auraTriggerRange ?? 0)
            || Math.max(0, params?.auraForward ?? 0) + Math.hypot(halfLength, halfHeight)) * scale;
    }

    static isSkillEnemy(unit: ZCUnitState, candidate: ZCUnitState,
        context: { effectiveDefinition?(unit: ZCUnitState): ZCUnitDefinition }): boolean {
        return candidate.id !== unit.id && candidate.owner !== unit.owner && candidate.hp > 0
            && candidate.battleState !== 'dead' && (!context.effectiveDefinition
                || context.effectiveDefinition(unit).canAttackAir || !context.effectiveDefinition(candidate).flying);
    }

    static acquireSkillUnit(unit: ZCUnitState, units: readonly ZCUnitState[], radius: number,
        context: { unitPosition?(unit: ZCUnitState): ZCPoint; effectiveDefinition?(unit: ZCUnitState): ZCUnitDefinition },
        mode = ZCSkillTargetMode.Range, canHit?: (x: number, y: number) => boolean): ZCUnitState | null {
        const from = context.unitPosition?.(unit);
        const fromX = from?.x ?? unit.freeX, fromY = from?.y ?? unit.freeY;
        const limit = this.skillSearchRadius(radius, mode);
        let nearest: ZCUnitState | null = null;
        let best = Infinity;
        for (const candidate of units) {
            if (!this.isSkillEnemy(unit, candidate, context)) continue;
            const position = context.unitPosition?.(candidate);
            const dx = (position?.x ?? candidate.freeX) - fromX;
            const dy = (position?.y ?? candidate.freeY) - fromY;
            const distance = dx * dx + dy * dy;
            if (distance > limit * limit || distance > best || distance === best && nearest && candidate.id >= nearest.id) continue;
            if (canHit && !canHit(dx + fromX, dy + fromY)) continue;
            best = distance;
            nearest = candidate;
        }
        return nearest;
    }

    static acquire(unit: ZCUnitState, context: ZCTargetingContext, unitsOnly = false, out?: ZCTargetSelectionSink): ZCTargetSelection | null {
        const definition = context.effectiveDefinition(unit);
        const from = context.unitPosition(unit, ACQUIRE_POSITION);
        const fromX = from.x, fromY = from.y;
        let bestKind: ZCCombatTargetKind | null = null;
        let bestId = Infinity;
        let bestDistance = Infinity;
        let bestCurrent = false;
        if (unit.hatredUnitId !== null && context.now <= unit.hatredUntil) {
            const hater = context.unitById(unit.hatredUnitId);
            if (hater && hater.id !== unit.id && hater.battleState !== 'dead' && hater.hp > 0 && hater.owner !== unit.owner
                && (definition.canAttackAir || !context.baseDefinition(hater.unitId).flying)
                && (!context.canTargetUnit || context.canTargetUnit(unit, hater))) {
                bestDistance = targetDistanceSquared(fromX, fromY, context.unitPosition(hater, ACQUIRE_POSITION))
                    * 0.25 * (context.baseDefinition(hater.unitId).valueFactor ?? 1);
                bestKind = 'unit'; bestId = hater.id; bestCurrent = hater.id === unit.targetUnitId;
            }
        }
        if (context.unitsOf) {
            // owner 分桶只排除同阵营单位；敌方单位仍全部参与精确最近目标比较。
            for (const owner of ZC_OWNER_ORDER) {
                if (owner === unit.owner) continue;
                for (const candidate of context.unitsOf(owner)) {
                    if (candidate.id === unit.id || candidate.battleState === 'dead' || candidate.hp <= 0 || candidate.owner === unit.owner) continue;
                    if (!definition.canAttackAir && context.baseDefinition(candidate.unitId).flying) continue;
                    if (context.canTargetUnit && !context.canTargetUnit(unit, candidate)) continue;
                    const distance = targetDistanceSquared(fromX, fromY, context.unitPosition(candidate, ACQUIRE_POSITION))
                        * (candidate.id === unit.hatredUnitId && context.now <= unit.hatredUntil ? 0.25 : 1)
                        * (context.baseDefinition(candidate.unitId).valueFactor ?? 1);
                    const current = candidate.id === unit.targetUnitId;
                    if (distance < bestDistance || (distance === bestDistance && (current && !bestCurrent || current === bestCurrent && candidate.id < bestId))) {
                        bestDistance = distance; bestKind = 'unit'; bestId = candidate.id; bestCurrent = current;
                    }
                }
            }
        } else {
            for (const candidate of context.units) {
                if (candidate.id === unit.id || candidate.battleState === 'dead' || candidate.hp <= 0 || candidate.owner === unit.owner) continue;
                if (!definition.canAttackAir && context.baseDefinition(candidate.unitId).flying) continue;
                if (context.canTargetUnit && !context.canTargetUnit(unit, candidate)) continue;
                const distance = targetDistanceSquared(fromX, fromY, context.unitPosition(candidate, ACQUIRE_POSITION))
                    * (candidate.id === unit.hatredUnitId && context.now <= unit.hatredUntil ? 0.25 : 1)
                    * (context.baseDefinition(candidate.unitId).valueFactor ?? 1);
                const current = candidate.id === unit.targetUnitId;
                if (distance < bestDistance || (distance === bestDistance && (current && !bestCurrent || current === bestCurrent && candidate.id < bestId))) {
                    bestDistance = distance; bestKind = 'unit'; bestId = candidate.id; bestCurrent = current;
                }
            }
        }
        if (unitsOnly || (bestKind !== null && context.preferUnitTargets?.(unit))) {
            return bestKind === null ? null : ZCTargetingSystem.writeSelection(bestKind, bestId, out);
        }
        const hexCandidates = context.candidateHexes
            ? context.candidateHexes(unit.owner)
            : context.hexes;
        for (const hex of hexCandidates) {
            let kind: ZCCombatTargetKind;
            if (isZCAwakeMonster(hex)) kind = 'building';
            else {
                if (hex.owner === 'neutral' || hex.owner === unit.owner) continue;
                if (context.hasExposedWall(hex)) kind = 'wall';
                else if (hex.building !== 'none' && hex.hp > 0 && hex.wallHp <= 0) kind = 'building';
                else continue;
            }
            const distance = targetDistanceSquared(fromX, fromY, context.hexPosition(hex.id));
            const current = kind === 'wall' ? unit.targetWallHexId === hex.id : unit.targetBuildingHexId === hex.id;
            if (distance < bestDistance || (distance === bestDistance && (current && !bestCurrent || current === bestCurrent && hex.id < bestId))) {
                bestDistance = distance; bestKind = kind; bestId = hex.id; bestCurrent = current;
            }
        }
        return bestKind === null ? null : ZCTargetingSystem.writeSelection(bestKind, bestId, out);
    }

    private static writeSelection(kind: ZCCombatTargetKind, id: number, out?: ZCTargetSelectionSink): ZCTargetSelection {
        if (out) { out.kind = kind; out.id = id; return out; }
        return { kind, id };
    }

    static attackReach(definition: ZCUnitDefinition, targetBodyRadius: number, distanceScale: number): number {
        const sourceReach = definition.attackRange + targetBodyRadius * 0.5;
        return sourceReach * distanceScale;
    }

    /**
     * 冲刺触发与撞击沿用完整目标半径；普攻射程统一不改变已校准的冲刺接触点。
    */
    static chargeReach(chargeDistance: number, targetBodyRadius: number, distanceScale: number): number {
        return (chargeDistance + targetBodyRadius) * distanceScale;
    }

    static isInRange(from: ZCPoint, target: ZCPoint, reach: number): boolean {
        return Math.hypot(from.x - target.x, from.y - target.y) <= reach;
    }

    static isOutOfRange(from: ZCPoint, target: ZCPoint, reach: number, hysteresis = 1.3): boolean {
        return Math.hypot(from.x - target.x, from.y - target.y) > reach * hysteresis;
    }

    static findPathStep(input: Readonly<IZCPathStepOptions>): number | null {
        const {
            start, isGoal, neighborsOf, canEnter, rank,
            workspace, neighborsAreRanked = false,
        } = input;
        if (workspace) {
            const { queue, visited, firstStep } = workspace;
            workspace.generation = (workspace.generation + 1) >>> 0;
            if (workspace.generation === 0) {
                visited.fill(0);
                workspace.generation = 1;
            }
            const generation = workspace.generation;
            queue.length = 0;
            queue.push(start);
            visited[start] = generation;
            for (let head = 0; head < queue.length; head++) {
                const current = queue[head];
                if (current !== start && isGoal(current)) return firstStep[current];
                const neighbors = neighborsAreRanked ? neighborsOf(current) : [...neighborsOf(current)].sort((a, b) => rank(a) - rank(b));
                for (const neighbor of neighbors) {
                    if (visited[neighbor] === generation || !canEnter(neighbor)) continue;
                    visited[neighbor] = generation;
                    firstStep[neighbor] = current === start ? neighbor : firstStep[current];
                    queue.push(neighbor);
                }
            }
            return null;
        }
        const queue = [start];
        let head = 0;
        const visited = new Set<number>([start]);
        const previous = new Map<number, number>();
        let goal: number | null = null;
        while (head < queue.length) {
            const current = queue[head++];
            if (current !== start && isGoal(current)) {
                goal = current;
                break;
            }
            for (const neighbor of [...neighborsOf(current)].sort((a, b) => rank(a) - rank(b))) {
                if (visited.has(neighbor) || !canEnter(neighbor)) continue;
                visited.add(neighbor);
                previous.set(neighbor, current);
                queue.push(neighbor);
            }
        }
        if (goal === null) return null;
        let step = goal;
        while (previous.get(step) !== start) {
            const parent = previous.get(step);
            if (parent === undefined) return null;
            step = parent;
        }
        return step;
    }
}

function targetDistanceSquared(fromX: number, fromY: number, point: ZCPoint): number {
    const dx = fromX - point.x, dy = fromY - point.y;
    return dx * dx + dy * dy;
}

