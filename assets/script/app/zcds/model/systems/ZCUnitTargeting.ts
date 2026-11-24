import type { IZCModelServices } from './ZCModelServices';
import type { ZCUnitDefinition } from '../ZCCombatCatalog';
import type {ZCCombatTarget, ZCUnitState} from '../ZCGameTypes';
import type { ZCMatchMap } from '../ZCMatchConfig';
import { sweptCircleHitScalars } from './ZCProjectileSystem';
import { ZCTargetingSystem, ZCPathWorkspace, type ZCTargetingContext, type ZCTargetSelectionSink } from './ZCTargetingSystem';
import type { IZCUnitTargeting } from './ZCUnitSystem';
import { isZCAwakeMonster, zcMonsterPosition } from './ZCNeutralFeatureSystem';
import { ZCDC_LOG_TARGET_SWITCH } from '../../ZCDCLogSwitch';

const STRUCTURE_TARGET_BODY_RADIUS = 80;

export function zcTargetSwitchWatched(): boolean {
    return ZCDC_LOG_TARGET_SWITCH;
}

/** 冲刺撞到的那个对象：`x/y` 是最早接触点（冲刺停在这里）。*/
export interface IZCDashHit {
    /** `unit` = 撞到敌方单位；`wall` / `building` = 撞到城墙 / 建筑（同一个地块 id）。*/
    readonly kind: 'unit' | 'wall' | 'building';
    readonly id: number;
    readonly x: number;
    readonly y: number;
}

interface IZCMutableDashHit {
    kind: 'unit' | 'wall' | 'building';
    id: number;
    x: number;
    y: number;
}

export interface IZCUnitTargetingContext extends Pick<IZCModelServices, 'geometry' | 'effectiveDefinition' | 'unitPosition' | 'hex' | 'hasExposedWall'> {
    readonly map: ZCMatchMap;
    readonly units: ReadonlyMap<number, ZCUnitState>;
    readonly targeting: ZCTargetingContext;
    readonly combatDistanceScale: number;
    priorityMonster?(unit: ZCUnitState): number | null;
    hasFocusableMonster?(): boolean;
    baseDefinition(id: string): ZCUnitDefinition;
}

/** 每局独占的单位索敌、射程和寻路缓存。*/
export class ZCUnitTargeting implements IZCUnitTargeting {
    private readonly pathWorkspace: ZCPathWorkspace;
    private readonly targetingContext: ZCTargetingContext;
    private readonly rankedNeighbors = new Map<number, readonly (readonly number[])[]>();
    private readonly stepCache = new Map<number, {
        atHex: number; goalHex: number; targetX: number; targetY: number; bodyRadius: number; step: number | null;
    }>();
    /** 每单位一块索敌结果 scratch：同拍多次 `current()` 不再造字面量。跨调用持有时由调用方传 out。*/
    private readonly targetScratch = new Map<number, ZCCombatTarget>();
    private readonly selectionScratch: ZCTargetSelectionSink = { kind: 'unit', id: 0 };
    private readonly selfPosition = { x: 0, y: 0 };
    private readonly targetPosition = { x: 0, y: 0 };
    private readonly candidatePosition = { x: 0, y: 0 };
    private readonly dashHitScratch: IZCMutableDashHit = { kind: 'unit', id: 0, x: 0, y: 0 };
    private dashNearest = Infinity;
    private dashBestId = Infinity;
    private dashHit = false;
    private readonly observedTargets = new WeakMap<ZCUnitState, { kind: ZCCombatTarget['kind']; id: number } | null>();
    private readonly prioritySwitches = new WeakSet<ZCUnitState>();

    constructor(private readonly context: IZCUnitTargetingContext) {
        this.pathWorkspace = new ZCPathWorkspace(context.map.hexes.length);
        // 测试/旧上下文可能只在外层提供 baseDefinition；构造时补一次，避免索敌每帧拼上下文。
        this.targetingContext = Object.create(context.targeting) as ZCTargetingContext;
        Object.assign(this.targetingContext, {
            baseDefinition: context.targeting.baseDefinition ?? context.baseDefinition,
            canTargetUnit: (unit: ZCUnitState, candidate: ZCUnitState) =>
                !unit.disengagedUnitIds || !unit.disengagedUnitIds.includes(candidate.id)
                || (candidate.id === unit.hatredUnitId && this.context.targeting.now <= unit.hatredUntil),
        });
    }

    invalidateTerrain(): void {
        this.stepCache.clear();
    }

    removeUnit(id: number): void {
        this.stepCache.delete(id);
        this.targetScratch.delete(id);
        const units = this.context.units;
        if (units) {
            const list = typeof (units as any).values === 'function' ? (units as any).values() : units;
            for (const u of list) {
                if (u && u.hatredUnitId === id) {
                    u.hatredUnitId = null;
                    u.hatredUntil = 0;
                }
            }
        }
    }

    reportTargetChange(unit: ZCUnitState): void {
        if (!ZCDC_LOG_TARGET_SWITCH) return;
        const previous = this.observedTargets.get(unit);
        const target = this.current(unit);
        const isPriority = this.prioritySwitches.delete(unit);
        if ((!previous && !target) || previous && target && previous.kind === target.kind && previous.id === target.id) return;
        let reason = previous ? 'score' : 'init';
        if (isPriority) reason = 'priority';
        else if (previous) {
            if (previous.kind === 'unit') {
                const victim = this.context.units.get(previous.id);
                if (!victim || victim.hp <= 0) {
                    reason = 'dead';
                } else if (victim.owner === unit.owner
                    || (!this.context.effectiveDefinition(unit).canAttackAir
                        && this.context.baseDefinition(victim.unitId).flying)) {
                    reason = 'invalid';
                } else if (unit.disengagedUnitIds && unit.disengagedUnitIds.includes(previous.id)) {
                    reason = 'outOfRange';
                } else if (!target) {
                    reason = 'invalid';
                } else {
                    const oldPosition = this.context.unitPosition(victim, this.targetPosition);
                    const oldRadius = this.context.baseDefinition(victim.unitId).bodyRadius;
                    if (ZCTargetingSystem.isOutOfRange(
                        this.context.unitPosition(unit, this.selfPosition),
                        oldPosition,
                        this.attackReach(this.context.effectiveDefinition(unit), oldRadius),
                    )) {
                        reason = 'outOfRange';
                    }
                }
            } else {
                const hex = this.context.hex(previous.id);
                if (!hex || hex.hp <= 0) {
                    reason = 'dead';
                } else if (!target) {
                    reason = 'invalid';
                } else {
                    const oldPosition = this.context.targeting.hexPosition(previous.id);
                    if (ZCTargetingSystem.isOutOfRange(
                        this.context.unitPosition(unit, this.selfPosition),
                        oldPosition,
                        this.attackReach(this.context.effectiveDefinition(unit), STRUCTURE_TARGET_BODY_RADIUS),
                    )) {
                        reason = 'outOfRange';
                    }
                }
            }
        }
        this.observedTargets.set(unit, target ? { kind: target.kind, id: target.id } : null);
        console.info(`[索敌诊断] ${unit.owner}/${unit.unitId}#${unit.id} ${this.context.targeting.now.toFixed(2)}s`
            + ` ${previous ? `${previous.kind}:${previous.id}` : 'none'} → ${target ? `${target.kind}:${target.id}` : 'none'} ${reason}`);
    }

    /** 按当前模式索敌；同类候选距离相同时优先 id 较小的目标。*/
    acquire(unit: ZCUnitState): void {
        if (unit.disengagedUnitIds) {
            const definition = this.context.effectiveDefinition(unit);
            const from = this.context.unitPosition(unit, this.selfPosition);
            unit.disengagedUnitIds = unit.disengagedUnitIds.filter(id => {
                if (id === unit.hatredUnitId && this.context.targeting.now <= unit.hatredUntil) return false;
                const candidate = this.context.units.get(id);
                return candidate && candidate.hp > 0 && candidate.battleState !== 'dead' && candidate.owner !== unit.owner
                    && !ZCTargetingSystem.isInRange(from, this.context.unitPosition(candidate, this.candidatePosition),
                        this.attackReach(definition, this.context.baseDefinition(candidate.unitId).bodyRadius));
            });
            if (!unit.disengagedUnitIds.length) delete unit.disengagedUnitIds;
        }
        const previous = unit.targetUnitId;
        const monsterId = this.context.priorityMonster ? (this.context.priorityMonster(unit) ?? null) : null;
        const target = monsterId === null
            ? ZCTargetingSystem.acquire(unit, this.targetingContext, false, this.selectionScratch)
            : { kind: 'building' as const, id: monsterId };
        unit.targetUnitId = null;
        unit.targetWallHexId = null;
        unit.targetBuildingHexId = null;
        if (target) {
            if (target.kind === 'unit') unit.targetUnitId = target.id;
            else if (target.kind === 'wall') unit.targetWallHexId = target.id;
            else if (target.kind === 'building') unit.targetBuildingHexId = target.id;
        }
        if (previous !== unit.targetUnitId) delete unit.chase;
    }

    /** 波次出怪可打断建筑锁定；已有单位目标仍沿用原来的锁敌规则。*/
    refreshPriorityTarget(unit: ZCUnitState): boolean {
        const preferUnits = this.context.targeting.preferUnitTargets ? this.context.targeting.preferUnitTargets(unit) : false;
        if (this.context.hasFocusableMonster && !this.context.hasFocusableMonster()
            && unit.targetBuildingHexId === null && unit.targetWallHexId === null
            && !preferUnits) return false;
        const monsterId = this.context.priorityMonster ? (this.context.priorityMonster(unit) ?? null) : null;
        if (monsterId !== null) {
            if (unit.targetBuildingHexId === monsterId) return false;
            unit.targetUnitId = unit.targetWallHexId = null;
            unit.targetBuildingHexId = monsterId;
            if (zcTargetSwitchWatched()) this.prioritySwitches.add(unit);
            return true;
        }
        const hex = unit.targetBuildingHexId === null ? null : this.context.hex(unit.targetBuildingHexId);
        if (hex && isZCAwakeMonster(hex)) {
            const isFocused = !!hex.neutralFeature?.focusOwners?.includes(unit.owner);
            if (!isFocused) {
                unit.targetBuildingHexId = null;
                const newTarget = ZCTargetingSystem.acquire(unit, this.targetingContext, false, this.selectionScratch);
                if (newTarget) {
                    if (newTarget.kind === 'unit') unit.targetUnitId = newTarget.id;
                    else if (newTarget.kind === 'wall') unit.targetWallHexId = newTarget.id;
                    else if (newTarget.kind === 'building') unit.targetBuildingHexId = newTarget.id;
                }
                if (zcTargetSwitchWatched()) this.prioritySwitches.add(unit);
                return true;
            }
            if (hex.neutralFeature?.focusOwners?.includes(unit.owner)) {
                const opponent = ZCTargetingSystem.acquire(unit, this.targetingContext, true, this.selectionScratch);
                if (opponent) {
                    unit.targetBuildingHexId = unit.targetWallHexId = null;
                    unit.targetUnitId = opponent.id;
                    if (zcTargetSwitchWatched()) this.prioritySwitches.add(unit);
                    return true;
                }
            }
            let attacker: ZCUnitState | null = null;
            let best = Infinity;
            const definition = this.context.effectiveDefinition(unit);
            for (const candidate of this.context.units.values()) {
                if (candidate.owner === unit.owner || candidate.hp <= 0 || candidate.battleState === 'dead'
                    || candidate.targetUnitId !== unit.id || !['attack', 'waitAttack'].includes(candidate.battleState)
                    || (!definition.canAttackAir && this.context.baseDefinition(candidate.unitId).flying)) continue;
                const distance = Math.hypot(candidate.freeX - unit.freeX, candidate.freeY - unit.freeY);
                if (distance < best || (distance === best && attacker && candidate.id < attacker.id)) { attacker = candidate; best = distance; }
            }
            if (attacker) {
                unit.targetBuildingHexId = unit.targetWallHexId = null;
                unit.targetUnitId = attacker.id;
                if (zcTargetSwitchWatched()) this.prioritySwitches.add(unit);
                return true;
            }
        }
        if (!preferUnits || (unit.targetWallHexId === null && unit.targetBuildingHexId === null)) return false;
        const target = ZCTargetingSystem.acquire(unit, this.targetingContext, true, this.selectionScratch);
        if (!target) return false;
        unit.targetUnitId = target.id;
        unit.targetWallHexId = null;
        unit.targetBuildingHexId = null;
        if (zcTargetSwitchWatched()) this.prioritySwitches.add(unit);
        return true;
    }

    /**
     * 检测近身是否有敌方单位正在攻击我方建筑/城墙。
     * 命中时返回该敌方单位，供调用方打断远距离追击门闩并优先转火守家。
     */
    findNearbyStructureBreaker(unit: ZCUnitState, maxDistance = 150): ZCUnitState | null {
        const units = this.context.units;
        if (!units) return null;
        const maxDistSq = maxDistance * maxDistance;
        const list = typeof (units as any).values === 'function' ? (units as any).values() : units;
        const definition = this.context.effectiveDefinition(unit);
        let bestBreaker: ZCUnitState | null = null;
        let bestDistSq = Infinity;
        for (const candidate of list) {
            if (!candidate || candidate.owner === unit.owner || candidate.hp <= 0 || candidate.battleState === 'dead') continue;
            if (!definition.canAttackAir && this.context.baseDefinition(candidate.unitId).flying) continue;
            const targetHexId = candidate.targetWallHexId ?? candidate.targetBuildingHexId;
            if (targetHexId === null) continue;
            const hex = this.context.hex(targetHexId);
            if (!hex || hex.owner !== unit.owner) continue;
            const distSq = (candidate.freeX - unit.freeX) ** 2 + (candidate.freeY - unit.freeY) ** 2;
            if (distSq <= maxDistSq && distSq < bestDistSq) {
                bestDistSq = distSq;
                bestBreaker = candidate;
            }
        }
        return bestBreaker;
    }

    current(unit: ZCUnitState, out?: ZCCombatTarget): ZCCombatTarget | null {
        if (unit.targetUnitId !== null) {
            const target = this.context.units.get(unit.targetUnitId);
            if (!target || target.battleState === 'dead' || target.hp <= 0 || target.owner === unit.owner) return null;
            const definition = this.context.baseDefinition(target.unitId);
            if (!this.context.effectiveDefinition(unit).canAttackAir && definition.flying) return null;
            const result = out ?? this.scratchFor(unit);
            const position = this.context.unitPosition(target, this.targetPosition);
            result.kind = 'unit';
            result.id = target.id;
            result.x = position.x;
            result.y = position.y;
            result.bodyRadius = definition.bodyRadius;
            result.cardId = target.cardId;
            return result;
        }
        if (unit.targetWallHexId !== null) {
            const hex = this.context.hex(unit.targetWallHexId);
            if (!hex || hex.owner === unit.owner || !this.context.hasExposedWall(hex)) return null;
            const config = this.context.map.hexes[hex.id];
            const result = out ?? this.scratchFor(unit);
            result.kind = 'wall';
            result.id = hex.id;
            result.x = config.x;
            result.y = config.y;
            result.bodyRadius = STRUCTURE_TARGET_BODY_RADIUS;
            result.cardId = null;
            return result;
        }
        if (unit.targetBuildingHexId !== null) {
            const hex = this.context.hex(unit.targetBuildingHexId);
            if (!hex || (!isZCAwakeMonster(hex) && (hex.owner === 'neutral' || hex.owner === unit.owner || hex.building === 'none')) || hex.hp <= 0
                || hex.wallHp > 0) return null;
            const result = out ?? this.scratchFor(unit);
            const position = zcMonsterPosition(this.context.map, hex, this.context.targeting.now, this.targetPosition);
            result.kind = 'building';
            result.id = hex.id;
            result.x = position.x;
            result.y = position.y;
            result.bodyRadius = STRUCTURE_TARGET_BODY_RADIUS;
            result.cardId = hex.cardId;
            return result;
        }
        return null;
    }

    private scratchFor(unit: ZCUnitState): ZCCombatTarget {
        let scratch = this.targetScratch.get(unit.id);
        if (!scratch) {
            scratch = { kind: 'unit', id: 0, x: 0, y: 0, bodyRadius: 0, cardId: null };
            this.targetScratch.set(unit.id, scratch);
        }
        return scratch;
    }

    isInAttackRange(unit: ZCUnitState): boolean {
        const target = this.current(unit);
        if (!target) return false;
        const from = this.context.unitPosition(unit, this.selfPosition);
        const reach = this.attackReach(this.context.effectiveDefinition(unit), target.bodyRadius);
        return ZCTargetingSystem.isInRange(from, target, reach);
    }

    /**
     * 触发范围闸门：普攻射程内是否有可打目标。锁定的目标在范围内直接返回，否则再扫一遍。
     * 判据与普攻同源（attackReach 含 attackRangePct 与 combatDistanceScale）。
     * 城墙/建筑只认已锁定的目标，不遍历地块表。
    */
    hasTargetInAttackRange(unit: ZCUnitState): boolean {
        const locked = this.current(unit);
        if (locked && this.isInAttackRange(unit)) return true;
        const definition = this.context.effectiveDefinition(unit);
        const from = this.context.unitPosition(unit, this.selfPosition);
        for (const other of this.context.units.values()) {
            if (other.id === unit.id || other.owner === unit.owner) continue;
            if (other.battleState === 'dead' || other.hp <= 0) continue;
            const otherDefinition = this.context.baseDefinition(other.unitId);
            if (otherDefinition.flying && !definition.canAttackAir) continue;
            const reach = this.attackReach(definition, otherDefinition.bodyRadius);
            if (ZCTargetingSystem.isInRange(from, this.context.unitPosition(other, this.candidatePosition), reach)) return true;
        }
        return false;
    }

    /**
     * 当前普攻射程（世界 px），技能搜索半径封顶用；只压不抬。
     * 身体半径取自己的，与 `attackReach` 给同一个数。
    */
    attackReachOf(unit: ZCUnitState): number {
        const definition = this.context.effectiveDefinition(unit);
        return this.attackReach(definition, definition.bodyRadius);
    }

    /**
     * 最近敌对单位的中心距离，没有目标返回 Infinity；给技能自己的触发距离用。
     * 不补身体半径、不打九折，量的是两个单位中心。
    */
    nearestEnemyDistance(unit: ZCUnitState): number {
        const definition = this.context.effectiveDefinition(unit);
        const from = this.context.unitPosition(unit, this.selfPosition);
        let nearest = Number.POSITIVE_INFINITY;
        for (const other of this.context.units.values()) {
            if (other.id === unit.id || other.owner === unit.owner) continue;
            if (other.battleState === 'dead' || other.hp <= 0) continue;
            const otherDefinition = this.context.baseDefinition(other.unitId);
            if (otherDefinition.flying && !definition.canAttackAir) continue;
            const position = this.context.unitPosition(other, this.candidatePosition);
            const dx = position.x - from.x;
            const dy = position.y - from.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < nearest) nearest = distance;
        }
        return nearest;
    }

    /** 滞回脱离判定：目标移出 reach * 1.3 后才重新追击。*/
    isOutOfAttackRange(unit: ZCUnitState): boolean {
        const target = this.current(unit);
        if (!target) return true;
        const from = this.context.unitPosition(unit, this.selfPosition);
        const reach = this.attackReach(this.context.effectiveDefinition(unit), target.bodyRadius);
        return ZCTargetingSystem.isOutOfRange(from, target, reach);
    }

    /**
     * 本帧冲刺倍率：没配冲刺/没目标/未进入 chargeDistance 都返回 1，调用点可直接乘。
     * > 1 同时作为 `ZCUnitSystem` 的起冲门槛。每帧一次 hypot，不缓存。
    */
    chargeSpeedScale(unit: ZCUnitState): number {
        const profile = this.context.effectiveDefinition(unit).attackProfile;
        const distance = profile.chargeDistance;
        const scale = profile.chargeSpeedScale;
        if (!(distance && scale) || !(scale > 1)) return 1;
        const target = this.current(unit);
        if (!target) return 1;
        const reach = ZCTargetingSystem.chargeReach(distance, target.bodyRadius, this.context.combatDistanceScale);
        const from = this.context.unitPosition(unit, this.selfPosition);
        const dx = from.x - target.x;
        const dy = from.y - target.y;
        return Math.sqrt(dx * dx + dy * dy) <= reach ? scale : 1;
    }

    /**
     * 冲刺路径上第一个碰撞：线段扫掠圆，撞到谁算谁；城墙/建筑只在它是当前锁定目标时参与。
     * 半径用自己的近战 reach（attackReach），不用双方 bodyRadius 求和——后者是弹道贴脸口径。
     * 返回 null 表示这一步没撞到，继续冲。
    */
    dashFirstHit(unit: ZCUnitState, fromX: number, fromY: number, toX: number, toY: number): IZCDashHit | null {
        const definition = this.context.effectiveDefinition(unit);
        const dx = toX - fromX;
        const dy = toY - fromY;
        this.dashNearest = Infinity;
        this.dashBestId = Infinity;
        this.dashHit = false;

        for (const other of this.context.units.values()) {
            if (other.id === unit.id || other.owner === unit.owner) continue;
            if (other.battleState === 'dead' || other.hp <= 0) continue;
            const otherDefinition = this.context.baseDefinition(other.unitId);
            if (otherDefinition.flying && !definition.canAttackAir) continue;
            this.considerDashCandidate(definition, 'unit', other.id, this.context.unitPosition(other, this.candidatePosition),
                otherDefinition.bodyRadius, fromX, fromY, dx, dy);
        }

        //  城墙 / 建筑：`current()` 已经把「还是不是合法目标」判完了（墙拆了、建筑没了都会返回 null）。
        const structure = this.current(unit);
        if (structure && structure.kind !== 'unit') {
            this.considerDashCandidate(definition, structure.kind, structure.id, structure, structure.bodyRadius, fromX, fromY, dx, dy);
        }
        return this.dashHit ? this.dashHitScratch : null;
    }

    /** 冲刺扫掠的单候选判定；结果写进实例 scratch，避免每个候选建 `consider` 闭包。*/
    private considerDashCandidate(definition: ZCUnitDefinition, kind: IZCDashHit['kind'], id: number, center: { x: number; y: number },
        bodyRadius: number, fromX: number, fromY: number, dx: number, dy: number): void {
        const t = sweptCircleHitScalars(dx, dy, fromX - center.x, fromY - center.y,
            ZCTargetingSystem.chargeReach(definition.attackRange, bodyRadius, this.context.combatDistanceScale));
        if (t === null) return;
        // 同一个 t 上有多人（挤成一团）时取 id 小的，保证回放可复现。
        if (t > this.dashNearest || (t === this.dashNearest && id >= this.dashBestId)) return;
        this.dashNearest = t;
        this.dashBestId = id;
        this.dashHit = true;
        this.dashHitScratch.kind = kind;
        this.dashHitScratch.id = id;
        this.dashHitScratch.x = fromX + dx * t;
        this.dashHitScratch.y = fromY + dy * t;
    }

    face(unit: ZCUnitState): void {
        const target = this.current(unit);
        if (!target) return;
        const from = this.context.unitPosition(unit, this.selfPosition);
        const raw = Math.atan2(target.y - from.y, target.x - from.x);
        unit.facingRadians = Math.round(raw / (Math.PI / 4)) * (Math.PI / 4);
    }

    findStepToward(unit: ZCUnitState): number | null {
        const target = this.current(unit);
        if (!target) return null;
        let destinationId: number | undefined;
        if (target.kind === 'unit') {
            const targetUnit = this.context.units.get(target.id);
            destinationId = targetUnit ? targetUnit.sourceHexId : undefined;
        } else {
            destinationId = target.id;
        }
        if (destinationId === undefined) return null;
        const cached = this.stepCache.get(unit.id);
        if (cached && cached.atHex === unit.sourceHexId && cached.goalHex === destinationId
            && cached.targetX === target.x && cached.targetY === target.y && cached.bodyRadius === target.bodyRadius) {
            return cached.step;
        }
        const reach = this.attackReach(this.context.effectiveDefinition(unit), target.bodyRadius);
        const step = this.findPathStep(unit, (id) => {
            const config = this.context.map.hexes[id];
            if (target.kind === 'unit' && id === destinationId) return true;
            const dx = config.x - target.x;
            const dy = config.y - target.y;
            return Math.sqrt(dx * dx + dy * dy) <= reach;
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

