import type { IZCModelServices } from './ZCModelServices';
import type { ZCUnitDefinition } from '../ZCCombatCatalog';
import type { ZCCombatTargetKind, ZCHexState, ZCUnitState } from '../ZCGameTypes';

export interface ZCPoint { readonly x: number; readonly y: number }
export interface ZCTargetSelection { readonly kind: ZCCombatTargetKind; readonly id: number }

export interface ZCTargetingContext extends Pick<IZCModelServices, 'unitPosition' | 'effectiveDefinition' | 'hasExposedWall'> {
    readonly now: number;
    readonly units: readonly ZCUnitState[];
    readonly hexes: readonly ZCHexState[];
    readonly unitById: (id: number) => ZCUnitState | null;
    readonly hexPosition: (hexId: number) => ZCPoint;
}

/** 每局独占的 BFS 工作区；访问标记避免每次创建 Set/Map。 */
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

/** `findPathStep` 的入参：BFS 起点、目标判定、邻居图、可入判定与排序。 */
export interface IZCPathStepOptions {
    readonly start: number;
    readonly isGoal: (id: number) => boolean;
    readonly neighborsOf: (id: number) => readonly number[];
    readonly canEnter: (id: number) => boolean;
    /** 邻居排序分值（小者先搜）；`neighborsAreRanked` 为 true 时不使用。 */
    readonly rank: (id: number) => number;
    /** 传入则复用工作区、零分配；省略时走一次性 Set/Map。 */
    readonly workspace?: ZCPathWorkspace;
    /** `neighborsOf` 返回的邻居是否已按 rank 排好（true 时跳过每格排序）。 */
    readonly neighborsAreRanked?: boolean;
}

/** 索敌排序、射程和通用 BFS；不持有对局状态。 */
export class ZCTargetingSystem {
    static acquire(unit: ZCUnitState, context: ZCTargetingContext): ZCTargetSelection | null {
        const definition = context.effectiveDefinition(unit);
        const from = context.unitPosition(unit);
        const candidatePosition = { x: 0, y: 0 };
        let best: ZCTargetSelection | null = null;
        let bestDistance = Infinity;
        const consider = (kind: ZCCombatTargetKind, id: number, point: ZCPoint): void => {
            const dx = from.x - point.x;
            const dy = from.y - point.y;
            const distanceSquared = dx * dx + dy * dy;
            if (distanceSquared < bestDistance || (distanceSquared === bestDistance && id < (best?.id ?? Infinity))) {
                bestDistance = distanceSquared;
                best = { kind, id };
            }
        };

        if (unit.hatredUnitId !== null && context.now <= unit.hatredUntil) {
            const hater = context.unitById(unit.hatredUnitId);
            if (hater && hater.battleState !== 'dead' && hater.hp > 0 && hater.owner !== unit.owner
                && (definition.canAttackAir || !context.effectiveDefinition(hater).flying)) {
                // 仇恨目标进入同一候选池；保留旧逻辑的距离排序语义。
                consider('unit', hater.id, context.unitPosition(hater, candidatePosition));
            }
        }
        for (const candidate of context.units) {
            if (candidate.id === unit.id || candidate.battleState === 'dead' || candidate.hp <= 0 || candidate.owner === unit.owner) continue;
            if (!definition.canAttackAir && context.effectiveDefinition(candidate).flying) continue;
            consider('unit', candidate.id, context.unitPosition(candidate, candidatePosition));
        }
        for (const hex of context.hexes) {
            if (hex.owner === 'neutral' || hex.owner === unit.owner) continue;
            const point = context.hexPosition(hex.id);
            if (context.hasExposedWall(hex)) consider('wall', hex.id, point);
            else if (hex.building !== 'none' && hex.hp > 0 && hex.wallHp <= 0) consider('building', hex.id, point);
        }
        return best;
    }

    static attackReach(definition: ZCUnitDefinition, targetBodyRadius: number, distanceScale: number): number {
        const sourceReach = definition.attackRange <= 100
            ? definition.attackRange + targetBodyRadius
            : definition.attackRange * 0.9;
        return sourceReach * distanceScale;
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

