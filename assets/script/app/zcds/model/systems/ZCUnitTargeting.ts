import type { IZCModelServices } from './ZCModelServices';
import type { ZCUnitDefinition } from '../ZCCombatCatalog';
import type {ZCCombatTarget, ZCUnitState} from '../ZCGameTypes';
import type { ZCMatchMap } from '../ZCMatchConfig';
import { sweptCircleHit } from './ZCProjectileSystem';
import { ZCTargetingSystem, ZCPathWorkspace, type ZCTargetingContext } from './ZCTargetingSystem';
import type { IZCUnitTargeting } from './ZCUnitSystem';
import { isZCAwakeMonster } from './ZCNeutralFeatureSystem';

const STRUCTURE_TARGET_BODY_RADIUS = 80;

/** 冲刺撞到的那个对象：`x/y` 是最早接触点（冲刺停在这里）。 */
export interface IZCDashHit {
    /** `unit` = 撞到敌方单位；`wall` / `building` = 撞到城墙 / 建筑（同一个地块 id）。 */
    readonly kind: 'unit' | 'wall' | 'building';
    readonly id: number;
    readonly x: number;
    readonly y: number;
}

export interface IZCUnitTargetingContext extends Pick<IZCModelServices, 'geometry' | 'effectiveDefinition' | 'unitPosition' | 'hex' | 'hasExposedWall'> {
    readonly map: ZCMatchMap;
    readonly units: ReadonlyMap<number, ZCUnitState>;
    readonly targeting: ZCTargetingContext;
    readonly combatDistanceScale: number;
    baseDefinition(id: string): ZCUnitDefinition;
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

    /** 按当前模式索敌；同类候选距离相同时优先 id 较小的目标。 */
    acquire(unit: ZCUnitState): void {
        const target = ZCTargetingSystem.acquire(unit, this.context.targeting);
        unit.targetUnitId = null;
        unit.targetWallHexId = null;
        unit.targetBuildingHexId = null;
        if (target?.kind === 'unit') unit.targetUnitId = target.id;
        else if (target?.kind === 'wall') unit.targetWallHexId = target.id;
        else if (target?.kind === 'building') unit.targetBuildingHexId = target.id;
    }

    /** 波次出怪可打断建筑锁定；已有单位目标仍沿用原来的锁敌规则。 */
    refreshPriorityTarget(unit: ZCUnitState): boolean {
        if (!this.context.targeting.preferUnitTargets?.(unit)
            || (unit.targetWallHexId === null && unit.targetBuildingHexId === null)) return false;
        const target = ZCTargetingSystem.acquire(unit, this.context.targeting, true);
        if (!target) return false;
        unit.targetUnitId = target.id;
        unit.targetWallHexId = null;
        unit.targetBuildingHexId = null;
        return true;
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
            if (!hex || (!isZCAwakeMonster(hex) && (hex.owner === 'neutral' || hex.owner === unit.owner || hex.building === 'none')) || hex.hp <= 0
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

    /**
     * 「触发范围」闸门：**普攻射程内有没有可打的目标**（2026-11-11 用户口径）。
     *
     * 技能到点之后不立刻释放，先过这道闸门：范围内一个敌人都没有 ⇒ 待触发
     * （冷却保持就绪、不消费），直到目标走进普攻射程才真正放出去。
     *
     * 与 `isInAttackRange` 的区别：那个只认**当前锁定的那个目标** —— 锁敌是 RTS 式仇恨锁，
     * 目标完全可能在半张图外正往这边跑，`current()` 照样返回它。这里问的是「身边有没有人能打」，
     * 所以不依赖锁敌：锁定的目标就在范围内就直接返回（最常见的一条路，不扫全场），
     * 否则才按 `acquire` + `isInAttackRange` 同一套判据扫一遍敌我单位。
     *
     * 判据与普攻完全同源（`attackReach`：射程 ≤100 补身体半径、>100 打九折，再乘
     * `combatDistanceScale`），且 `effectiveDefinition` 已经把 `attackRangePct` 算进去 ——
     * 攻击距离 buff 会同步放大触发范围，不会出现「普攻够得着、技能说没目标」。
     *
     * 城墙 / 建筑只认**已锁定的那个**：地块不在 `units` 里，全场遍历一遍地块表太贵，
     * 而攻城时它一定被 `targetWallHexId` / `targetBuildingHexId` 锁着。
     */
    hasTargetInAttackRange(unit: ZCUnitState): boolean {
        const locked = this.current(unit);
        if (locked && this.isInAttackRange(unit)) return true;
        const definition = this.context.effectiveDefinition(unit);
        const from = this.context.unitPosition(unit);
        for (const other of this.context.units.values()) {
            if (other.id === unit.id || other.owner === unit.owner) continue;
            if (other.battleState === 'dead' || other.hp <= 0) continue;
            const otherDefinition = this.context.baseDefinition(other.unitId);
            if (otherDefinition.flying && !definition.canAttackAir) continue;
            const reach = this.attackReach(definition, otherDefinition.bodyRadius);
            if (ZCTargetingSystem.isInRange(from, this.context.unitPosition(other), reach)) return true;
        }
        return false;
    }

    /**
     * 当前普攻射程（世界 px）：技能自带的搜索半径**封顶**到它为止。
     *
     * 只压不抬：毒箭蘑菇 `strikeRadius = 252`（约 75.6px）本来就比普攻近，
     * 封顶后仍是 252；镭射飞龙 `strikeRadius = 1100`（330px）、魔术师
     * `blinkSearchRadius = 600`（180px）这类超出普攻的，一律压到普攻射程。
     *
     * 身体半径取**自己**的（与 `castFanSkill` 算扇形半径时同一条口径），
     * 这样「近战 45 + 身体 24」与普攻 `attackReach` 给的是同一个数。
     */
    attackReachOf(unit: ZCUnitState): number {
        const definition = this.context.effectiveDefinition(unit);
        return this.attackReach(definition, definition.bodyRadius);
    }

    /**
     * 最近的敌对单位到本体的距离（世界 px，中心到中心）。没有可打的目标 ⇒ `Infinity`。
     *
     * 给「技能自己的触发距离」用（2026-11-12 用户口径，喷火 102603）：技能到点后如果最近的
     * 敌人还在 350 表值 px 之外，就**待触发**、不消费 CD —— 避免「普攻射程 550 一到点就喷、
     * 火焰却只够 350」这种打空气的释放。
     *
     * 判据与 `hasTargetInAttackRange` 同源：同一套敌人集合，同样过滤「不会飞 / 打不到空中」。
     * 但这里**不补身体半径、不打九折** —— 用户说的是「敌人处于 350px 这个距离」，
     * 量的是两个单位中心的直线距离。
     */
    nearestEnemyDistance(unit: ZCUnitState): number {
        const definition = this.context.effectiveDefinition(unit);
        const from = this.context.unitPosition(unit);
        let nearest = Number.POSITIVE_INFINITY;
        for (const other of this.context.units.values()) {
            if (other.id === unit.id || other.owner === unit.owner) continue;
            if (other.battleState === 'dead' || other.hp <= 0) continue;
            const otherDefinition = this.context.baseDefinition(other.unitId);
            if (otherDefinition.flying && !definition.canAttackAir) continue;
            const position = this.context.unitPosition(other);
            const distance = Math.hypot(position.x - from.x, position.y - from.y);
            if (distance < nearest) nearest = distance;
        }
        return nearest;
    }

    /** 滞回脱离判定：目标移出 reach * 1.3 后才重新追击。 */
    isOutOfAttackRange(unit: ZCUnitState): boolean {
        const target = this.current(unit);
        if (!target) return true;
        const from = this.context.unitPosition(unit);
        const reach = this.attackReach(this.context.effectiveDefinition(unit), target.bodyRadius);
        return ZCTargetingSystem.isOutOfRange(from, target, reach);
    }

    /**
     * 本帧的冲刺倍率 / 冲刺门槛。
     *
     * 返回 **≥ 1** 的倍数：没配冲刺、没有目标、还没进入 `chargeDistance` 一律返回 1，
     * 所以调用点可以直接乘、不需要再判空。
     *
     * 2026-11-02 起它不再只是「移速倍率」，`> 1` 等于**可以起冲**：`ZCUnitSystem` 用它当
     * 冲刺的门槛条件之一（另外两条是「有目标」「本次攻击冷却已就绪」）。
     * 2026-11-03 起城墙 / 建筑目标也走冲刺，所以这里不再区分目标种类。
     *
     * 为什么不缓存成单位状态：这是「当前距离」的纯函数，缓一次就要在处理「目标换人 /
     * 目标瞬移 / 单位被击退」时挨个失效，而每帧算一次只是一次 `hypot`。
     */
    chargeSpeedScale(unit: ZCUnitState): number {
        const profile = this.context.effectiveDefinition(unit).attackProfile;
        const distance = profile.chargeDistance;
        const scale = profile.chargeSpeedScale;
        if (!(distance && scale) || !(scale > 1)) return 1;
        const target = this.current(unit);
        if (!target) return 1;
        const reach = ZCTargetingSystem.chargeReach(distance, target.bodyRadius, this.context.combatDistanceScale);
        const from = this.context.unitPosition(unit);
        return Math.hypot(from.x - target.x, from.y - target.y) <= reach ? scale : 1;
    }

    /**
     * 冲刺这一步**会撞到的第一个东西**（线段上最先接触的那个）。
     *
     * 2026-11-02「冲刺改成真·撞击」：用户拍板的命中对象是「路径上第一个进碰撞圈的敌人」，
     * 而不是「只认锁定目标」—— 冲锋撞到谁算谁，与画面上看到的一致。
     *
     * 2026-11-03 起**城墙 / 建筑也算**（用户口径「城墙 / 建筑目标也需要走冲刺，撞到就停止」）：
     * 结构静止不动，但冲上去一样要停在它面前、结算一次普攻，所以和单位共用同一条扫掠判定。
     * 结构只在**它是当前锁定目标**时才参与 —— 冲锋路过一面墙不该被它截住，
     * 那面墙本身也已经由 `dashStep` 的「进不了敌方墙格」兜住了。
     *
     * 判定用线段扫掠圆，半径取**自己的近战 reach**（`attackReach`），而不是双方
     * `bodyRadius` 求和：`bodyRadius` 是给弹道算「贴脸」用的（表里常是 0/6px，换算到世界
     * 坐标才 0~1.8），拿它当冲撞判定会变成「必须精确踩到对方脚心」，画面上看就是反复穿人。
     * 近战 reach 本来就是「手心够得到哪儿」，与冲撞的直觉一致；改 `attackRange` 时冲撞手感
     * 会跟着走，不会多出第二套互不相干的手感参数。
     *
     * 返回 `null` ⇒ 这一步没撞到东西，继续冲。
     */
    dashFirstHit(unit: ZCUnitState, fromX: number, fromY: number, toX: number, toY: number): IZCDashHit | null {
        const definition = this.context.baseDefinition(unit.unitId);
        const from = { x: fromX, y: fromY };
        const to = { x: toX, y: toY };
        let hit: IZCDashHit | null = null;
        let nearest = Infinity;
        const consider = (kind: IZCDashHit['kind'], id: number, center: { x: number; y: number }, bodyRadius: number): void => {
            const t = sweptCircleHit(from, to, center, this.attackReach(definition, bodyRadius));
            if (t === null) return;
            // 同一个 t 上有多人（挤成一团）时取 id 小的，保证回放可复现。
            if (t > nearest || (t === nearest && id >= (hit?.id ?? Infinity))) return;
            nearest = t;
            hit = { kind, id, x: fromX + (toX - fromX) * t, y: fromY + (toY - fromY) * t };
        };

        for (const other of this.context.units.values()) {
            if (other.id === unit.id || other.owner === unit.owner) continue;
            if (other.battleState === 'dead' || other.hp <= 0) continue;
            const otherDefinition = this.context.baseDefinition(other.unitId);
            if (otherDefinition.flying && !definition.canAttackAir) continue;
            consider('unit', other.id, this.context.unitPosition(other), otherDefinition.bodyRadius);
        }

        //  城墙 / 建筑：`current()` 已经把「还是不是合法目标」判完了（墙拆了、建筑没了都会返回 null）。
        const structure = this.current(unit);
        if (structure && structure.kind !== 'unit') {
            consider(structure.kind, structure.id, structure, structure.bodyRadius);
        }
        return hit;
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

