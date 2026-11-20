import type { IZCModelServices } from './ZCModelServices';
import type { ZCCombatTarget, ZCUnitState } from '../ZCGameTypes';
import { ZCCombatSystem } from './ZCCombatSystem';
import { ZC_PORTAL_FLIGHT_SECONDS } from '../ZCBattlePresentationQueue';
import type { IZCDashStep } from './ZCMovementSystem';
import type { IZCDashHit } from './ZCUnitTargeting';
import { HEX_GRID_LOGICAL_ROW_STEP } from '../../../../core/hex/HexGridLayout';

export interface IZCUnitTargeting {
    acquire(unit: ZCUnitState): void;
    refreshPriorityTarget?(unit: ZCUnitState): boolean;
    current(unit: ZCUnitState, out?: ZCCombatTarget): ZCCombatTarget | null;
    isInAttackRange(unit: ZCUnitState): boolean;
    isOutOfAttackRange(unit: ZCUnitState): boolean;
    /** 普攻射程内是否已有可打目标；缺省视为不设闸门。*/
    hasTargetInAttackRange?(unit: ZCUnitState): boolean;
    /** 当前普攻射程，给技能搜索半径封顶用；缺省不封顶。*/
    attackReachOf?(unit: ZCUnitState): number;
    findStepToward(unit: ZCUnitState): number | null;
    face(unit: ZCUnitState): void;
    reportTargetChange?(unit: ZCUnitState): void;
    /** 本帧冲刺倍率（`>= 1`）；缺省按 1 处理，等价于没配冲刺。*/
    chargeSpeedScale?(unit: ZCUnitState): number;
    /** 冲刺路径上第一个撞到的敌人；缺省时冲刺只会跑到终点、不发生碰撞。*/
    dashFirstHit?(unit: ZCUnitState, fromX: number, fromY: number, toX: number, toY: number): IZCDashHit | null;
}

export interface IZCUnitMovement {
    /** `speedScale` = 冲刺倍率（缺省 1 ⇒ 与旧签名逐字一致）。*/
    advanceTowardUnit(unit: ZCUnitState, target: ZCUnitState, dt: number, speedScale?: number): void;
    advanceUnitMovement(unit: ZCUnitState, dt: number, speedScale?: number): void;
    startMarch(unit: ZCUnitState): void;
    advanceMarch(unit: ZCUnitState, dt: number): void;
    /** 冲刺一步的预测落点（不落盘）。可选：缺省 ⇒ 冲刺整段不启用，退回旧追击。*/
    dashStep?(unit: ZCUnitState, dt: number, speedScale: number): IZCDashStep;
    /** 把单位摆到连续坐标（冲刺落位）。可选：与 `dashStep` 成对出现。*/
    placeAt?(unit: ZCUnitState, x: number, y: number, keepFacing?: boolean): void;
}

export interface IZCUnitContext extends Pick<IZCModelServices, 'effectiveDefinition' | 'random'> {
    now(): number;
    /** 当前硬控（无则 null）；受控单位由状态机闸门冻结一切行动。*/
    controlOf(unit: ZCUnitState): { kind: string; defId: string } | null;
    /** 软控：禁普攻，移动与技能照常；缺省不禁。*/
    attackBlockedOf?(unit: ZCUnitState): boolean;
    readonly unitById: ReadonlyMap<number, ZCUnitState>;
    readonly targeting: IZCUnitTargeting;
    readonly movement: IZCUnitMovement;
    sendAttack(unit: ZCUnitState): void;
}

const BORN_SECONDS = 0.2;
const SOLDIER_WAIT_MIN = 0.15;
const SOLDIER_WAIT_RANDOM = 0.15;
/** 冲刺超时的兜底余量：正常按「到点 / 撞到」收场，这里只防终点不可达。*/
const DASH_TIMEOUT_MARGIN = 2;
const DASH_MIN_SECONDS = 0.15;
const CHASE_MAX_SECONDS = 5;
const CHASE_MAX_DISTANCE = 3 * HEX_GRID_LOGICAL_ROW_STEP;

/** 单位战斗状态机；由编排层提供索敌、命中和移动操作。*/
export class ZCUnitSystem {
    static update(units: readonly ZCUnitState[], dt: number, context: IZCUnitContext): void {
        for (const unit of units) {
            this.updateUnit(unit, dt, context);
            context.targeting.reportTargetChange?.(unit);
        }
    }

    private static switchWaitAttack(unit: ZCUnitState, context: IZCUnitContext): void {
        ZCCombatSystem.switchState(unit, 'waitAttack');
        unit.waitUntil = context.now() + SOLDIER_WAIT_MIN + context.random() * SOLDIER_WAIT_RANDOM;
    }

    private static startAttack(unit: ZCUnitState, context: IZCUnitContext): void {
        // 软控只禁普攻、不冻移动；直接返回，解控后下一帧到点就能补拳。
        if (context.attackBlockedOf?.(unit)) return;
        // 出手前重新确认目标与射程，避免在等待期间攻击已经移动的单位。
        if (!context.targeting.current(unit) || !context.targeting.isInAttackRange(unit)) {
            ZCCombatSystem.switchState(unit, 'target');
            return;
        }
        context.targeting.face(unit);
        ZCCombatSystem.switchState(unit, 'attack');
        unit.attackHitDone = false;
        unit.nextAttackAt = context.now() + context.effectiveDefinition(unit).attackInterval;
    }

    private static endDash(unit: ZCUnitState): void {
        unit.dashUntil = undefined;
        unit.dashX = undefined;
        unit.dashY = undefined;
    }

    /**
     * 起冲：把目标当时的坐标拍成快照，之后直线跑过去。
     * 冷却不在这里扣，从撞上/冲空那一刻才开始计时（冲刺整段就是这一拳的动作）。
    */
    private static startDash(unit: ZCUnitState, target: ZCCombatTarget, speedScale: number, context: IZCUnitContext): void {
        const definition = context.effectiveDefinition(unit);
        unit.dashX = target.x;
        unit.dashY = target.y;
        const span = Number.isFinite(unit.freeX) && Number.isFinite(unit.freeY)
            ? Math.hypot(target.x - unit.freeX, target.y - unit.freeY)
            : 0;
        //  超时只是兜底（终点被挡 / 坐标异常时别让冲刺永远挂着），正常靠「到点」结束。
        unit.dashUntil = context.now() + Math.max(DASH_MIN_SECONDS,
            span / Math.max(1e-6, definition.moveSpeed * speedScale) * DASH_TIMEOUT_MARGIN);
        unit.charging = true;
    }

    /**
     * 冲刺的一帧：直线推进 → 判路径第一个碰撞 → 结算普攻；没人就跑到终点、不结算伤害。
     * 这条分支抢在所有状态之前，起手后不再被索敌改写朝向。
    */
    private static updateDash(unit: ZCUnitState, dt: number, context: IZCUnitContext): void {
        const movement = context.movement;
        if (!movement.dashStep || !movement.placeAt) {
            this.endDash(unit);
            return;
        }
        const speedScale = context.effectiveDefinition(unit).attackProfile.chargeSpeedScale ?? 1;
        const step = movement.dashStep(unit, dt, speedScale);
        const hit = context.targeting.dashFirstHit?.(unit, step.fromX, step.fromY, step.x, step.y) ?? null;
        if (hit) {
            //  停在接触点再结算：让「撞上」「伤害数字」「气浪」落在同一个地方，而不是穿过去才掉血。
            movement.placeAt(unit, hit.x, hit.y);
            if (hit.kind === 'unit') {
                unit.targetUnitId = hit.id;
                unit.targetWallHexId = null;
                unit.targetBuildingHexId = null;
            } else {
                //  撞的是城墙 / 建筑：目标就是那个地块，`sendAttack` 会根据 kind 走 `damageWall / damageBuilding`。
                unit.targetUnitId = null;
                unit.targetWallHexId = hit.kind === 'wall' ? hit.id : null;
                unit.targetBuildingHexId = hit.kind === 'building' ? hit.id : null;
            }
            context.sendAttack(unit);
            this.endDash(unit);
            this.startDashCooldown(unit, context);
            return;
        }
        movement.placeAt(unit, step.x, step.y);
        if (step.landed) {
            //  冲空：一分伤害都不打，但这次普攻一样要进冷却（用户口径「冲空也吃冷却」）。
            this.endDash(unit);
            this.startDashCooldown(unit, context);
            return;
        }
        //  表现层靠 `charging` 把移动动作换成循环的攻击动作（设计案「开始冲刺时播放循环的攻击动作」）。
        unit.charging = true;
    }

    /**
     * 冲刺收场后进冷却：原地待机，不索敌、不挪窝。
     * `nextAttackAt` 管再出手时机，`dashRecoverUntil` 管这 0.7s 站住别动。
    */
    private static startDashCooldown(unit: ZCUnitState, context: IZCUnitContext): void {
        unit.nextAttackAt = context.now() + context.effectiveDefinition(unit).attackInterval;
        unit.dashRecoverUntil = unit.nextAttackAt;
        //  冷却期间是待机姿势，不是出拳姿势 —— `charging` 已经被推进逻辑清过一遍，
        //  这里再显式落一次，免得末帧的 `charging = true` 把待机动作盖出去。
        unit.charging = false;
        ZCCombatSystem.switchState(unit, 'idle');
    }

    /**
     * 能冲就冲，抢在 `waitAttack / idle / move` 之前统一判一次。
     * 四条门槛缺一不可：有目标、在冲刺距离内、冷却就绪、上下文提供冲刺能力。
    */
    private static tryStartDash(unit: ZCUnitState, dt: number, context: IZCUnitContext): boolean {
        //  冲刺就是这套普攻本身 ⇒ 软控期间一样不许起冲（否则「禁攻击」形同虚设）。
        if (context.attackBlockedOf?.(unit)) return false;
        if (unit.battleState === 'attack' || unit.battleState === 'born'
            || unit.battleState === 'moveForward' || unit.battleState === 'dead') return false;
        if (context.now() < unit.nextAttackAt) return false;
        const movement = context.movement;
        if (!movement.dashStep || !movement.placeAt) return false;
        const target = context.targeting.current(unit);
        if (!target) return false;
        const speedScale = context.targeting.chargeSpeedScale?.(unit) ?? 1;
        if (!(speedScale > 1)) return false;
        this.startDash(unit, target, speedScale, context);
        this.updateDash(unit, dt, context);
        return true;
    }

    private static updateUnit(unit: ZCUnitState, dt: number, context: IZCUnitContext): void {
        if (unit.battleState === 'dead' || unit.hp <= 0) {
            this.endDash(unit);   // 冲刺中被打死：别把 dead 状态的终点快照留在快照里
            return;
        }
        // 冲刺标记每帧先清：它是本帧派生量，残留会让表现层停在出拳姿势。
        unit.charging = false;
        // 硬控优先：冻结 stateTime、索敌、移动与攻击；冲刺中挨控则作废并按冲空进冷却。
        if (context.controlOf(unit)) {
            if (unit.dashUntil !== undefined) {
                this.endDash(unit);
                this.startDashCooldown(unit, context);
            }
            return;
        }
        // 冲刺起手后抢在所有状态之前推进，中途不再索敌改道；目标死亡也不刹车。
        if (unit.dashUntil !== undefined) {
            if (context.now() < unit.dashUntil) {
                this.updateDash(unit, dt, context);
                return;
            }
            this.endDash(unit);   // 超时兜底：按冲空收场，同样要进冷却
            this.startDashCooldown(unit, context);
        }
        unit.stateTime = Math.round((unit.stateTime + dt) * 1e9) / 1e9;
        const definition = context.effectiveDefinition(unit);

        if (unit.battleState === 'born') {
            if (unit.stateTime >= BORN_SECONDS && (!unit.portalFlight
                || context.now() >= unit.portalFlight.startedAt + ZC_PORTAL_FLIGHT_SECONDS)) {
                ZCCombatSystem.switchState(unit, 'target');
            }
            return;
        }
        // 冲刺冷却期间原地待机，不索敌也不挪窝。
        if (unit.dashRecoverUntil !== undefined) {
            if (context.now() < unit.dashRecoverUntil) {
                if (unit.battleState !== 'idle') ZCCombatSystem.switchState(unit, 'idle');
                return;
            }
            unit.dashRecoverUntil = undefined;
        }
        if (context.targeting.refreshPriorityTarget?.(unit)) {
            ZCCombatSystem.switchState(unit, 'target');
        }
        if (unit.chase && context.targeting.isInAttackRange(unit)) delete unit.chase;
        if (unit.battleState === 'attack') {
            if (!unit.attackHitDone && unit.stateTime >= definition.attackHitTime) context.sendAttack(unit);
            if (unit.stateTime >= definition.attackDuration) ZCCombatSystem.switchState(unit, 'idle');
            return;
        }
        // buff 施法原地锁：停移动但保留攻击，射程内有目标且冷却到点照常出手。
        if (unit.castHoldUntil !== undefined) {
            if (context.now() < unit.castHoldUntil) {
                if (unit.battleState !== 'idle') ZCCombatSystem.switchState(unit, 'idle');
                if (context.targeting.current(unit) && context.targeting.isInAttackRange(unit)
                    && context.now() >= unit.nextAttackAt) {
                    this.startAttack(unit, context);
                }
                return;
            }
            unit.castHoldUntil = undefined;
        }
        // ── 跟随型召唤物（`summonMasterId` 有值、且不是独立分身）──
        //  位置每帧由 `ZCGameModel.syncSummons` 钉在「本体 + 阵位」上 ⇒ 这里**不许寻路**：
        //  一旦让它走正常的 `target / move` 分支，`advanceUnitMovement` 会把坐标拽向敌人，
        //  下一帧又被拽回阵位，观感是四个舞伴在原地抽筋。召唤物只做一件事：
        //  射程内有敌人就出手（设计口径「跟随本体移动，并主动攻击离自己最近的敌人」）。
        //
        //  放在 `attack` 分支**之后**：攻击动作要照常走完 `attackDuration` 才回 idle，
        //  提前 return 会让它们一直卡在第一帧的挥拳姿势。
        //
        //  🔴 `summonIndependent`（2026-11-19 第 26 批 101404 分裂菇分身）**不进这个短路**：
        //  设计口径「移动、攻击速度、攻击范围属性与本体一致，也会去寻找敌人攻击」，
        //  它就是个普通战斗单位，必须走下面完整的 target / move / 追人分支。
        if (unit.summonMasterId !== undefined && unit.summonIndependent !== true) {
            if (context.attackBlockedOf?.(unit)) return;   // 软控禁普攻：原地站着不动
            context.targeting.acquire(unit);
            if (!context.targeting.current(unit)) {
                if (unit.battleState !== 'idle') ZCCombatSystem.switchState(unit, 'idle');
                return;
            }
            if (context.targeting.isInAttackRange(unit) && context.now() >= unit.nextAttackAt) {
                this.startAttack(unit, context);
                return;
            }
            if (unit.battleState !== 'idle') ZCCombatSystem.switchState(unit, 'idle');
            return;
        }
        //  冲刺是这套普攻本身 ⇒ 能冲就冲，抢在「贴身挥拳 / 站定等冷却 / 追人」之前。
        if (this.tryStartDash(unit, dt, context)) return;
        if (unit.battleState === 'waitAttack') {
            if (!context.targeting.current(unit) || context.targeting.isOutOfAttackRange(unit)) {
                ZCCombatSystem.switchState(unit, 'target');
            } else if (context.now() >= unit.waitUntil && context.now() >= unit.nextAttackAt) {
                this.startAttack(unit, context);
            }
            return;
        }

        if (unit.battleState === 'target') {
            context.targeting.acquire(unit);
            if (!context.targeting.current(unit)) {
                ZCCombatSystem.switchState(unit, 'moveForward');
            } else if (context.targeting.isInAttackRange(unit)) {
                ZCCombatSystem.switchState(unit, 'idle');
            } else {
                ZCCombatSystem.switchState(unit, 'move');
            }
            return;
        }

        // 正在射程内锁定目标时保持当前目标（RTS 式仇恨锁）：
        // 目标死亡或移出射程（isTargetOutOfAttackRange 滞回判定）后才重新索敌，切到最近的。
        const lockedAndFighting = (unit.battleState === 'idle' || unit.battleState === 'move')
            && !!context.targeting.current(unit);
        if (!lockedAndFighting) {
            context.targeting.acquire(unit);
            if (context.targeting.current(unit)) ZCCombatSystem.switchState(unit, context.targeting.isInAttackRange(unit) ? 'idle' : 'move');
            else if (unit.battleState !== 'moveForward') ZCCombatSystem.switchState(unit, 'moveForward');
        }

        if (unit.battleState === 'idle') {
            if (!context.targeting.current(unit)) {
                ZCCombatSystem.switchState(unit, 'target');
            } else if (context.targeting.isOutOfAttackRange(unit)) {
                ZCCombatSystem.switchState(unit, 'move');
            } else if (context.now() >= unit.nextAttackAt) {
                this.startAttack(unit, context);
            }
            return;
        }

        if (unit.battleState === 'move') {
            const target = context.targeting.current(unit);
            if (!target) {
                ZCCombatSystem.switchState(unit, 'target');
                return;
            }
            if (context.targeting.isInAttackRange(unit)) {
                delete unit.chase;
                if (context.now() >= unit.nextAttackAt) this.switchWaitAttack(unit, context);
                else ZCCombatSystem.switchState(unit, 'idle');
                return;
            }
            if (target.kind === 'unit') {
                unit.chase ??= { x: unit.freeX, y: unit.freeY, startedAt: context.now() };
                if (context.now() - unit.chase.startedAt >= CHASE_MAX_SECONDS
                    || Math.hypot(unit.freeX - unit.chase.x, unit.freeY - unit.chase.y) >= CHASE_MAX_DISTANCE) {
                    if (!unit.disengagedUnitIds?.includes(target.id)) {
                        unit.disengagedUnitIds = [...(unit.disengagedUnitIds ?? []), target.id];
                    }
                    unit.targetUnitId = unit.targetWallHexId = unit.targetBuildingHexId = null;
                    unit.targetHexId = null;
                    unit.progress = 0;
                    delete unit.chase;
                    ZCCombatSystem.switchState(unit, 'moveForward');
                    return;
                }
            } else delete unit.chase;
            // 冲刺已在 tryStartDash 统一处理，走到这里说明没配冲刺或不在冲刺距离内。
            if (target.kind === 'unit') {
                const targetUnit = context.unitById.get(target.id);
                if (targetUnit && targetUnit.sourceHexId === unit.sourceHexId) {
                    context.movement.advanceTowardUnit(unit, targetUnit, dt);
                    return;
                }
            }
            if (unit.targetHexId === null) unit.targetHexId = context.targeting.findStepToward(unit);
            if (unit.targetHexId === null) {
                ZCCombatSystem.switchState(unit, 'idle');
                return;
            }
            context.movement.advanceUnitMovement(unit, dt);
            return;
        }

        if (unit.battleState === 'moveForward') {
            if (unit.marchAngle === null) context.movement.startMarch(unit);
            context.movement.advanceMarch(unit, dt);
            return;
        }
    }
}

