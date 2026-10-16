import type { ZCUnitDefinition } from '../ZCCombatCatalog';
import type { ZCCombatTarget, ZCUnitState } from '../ZCGameTypes';
import { ZCCombatSystem } from './ZCCombatSystem';

export interface IZCUnitTargeting {
    acquire(unit: ZCUnitState): void;
    current(unit: ZCUnitState): ZCCombatTarget | null;
    isInAttackRange(unit: ZCUnitState): boolean;
    isOutOfAttackRange(unit: ZCUnitState): boolean;
    findStepToward(unit: ZCUnitState): number | null;
    face(unit: ZCUnitState): void;
}

export interface IZCUnitMovement {
    advanceTowardUnit(unit: ZCUnitState, target: ZCUnitState, dt: number): void;
    advanceUnitMovement(unit: ZCUnitState, dt: number): void;
    startMarch(unit: ZCUnitState): void;
    advanceMarch(unit: ZCUnitState, dt: number): void;
}

export interface IZCUnitContext {
    now(): number;
    definition(unit: ZCUnitState): ZCUnitDefinition;
    /** 当前硬控（无则 null）；受控单位由状态机闸门冻结一切行动。 */
    controlOf(unit: ZCUnitState): { kind: string; defId: string } | null;
    random(): number;
    readonly unitById: ReadonlyMap<number, ZCUnitState>;
    readonly targeting: IZCUnitTargeting;
    readonly movement: IZCUnitMovement;
    sendAttack(unit: ZCUnitState): void;
}

const BORN_SECONDS = 0.2;
const SOLDIER_WAIT_MIN = 0.15;
const SOLDIER_WAIT_RANDOM = 0.15;

/** 单位战斗状态机；由编排层提供索敌、命中和移动操作。 */
export class ZCUnitSystem {
    static update(units: readonly ZCUnitState[], dt: number, context: IZCUnitContext): void {
        for (const unit of units) this.updateUnit(unit, dt, context);
    }

    private static switchWaitAttack(unit: ZCUnitState, context: IZCUnitContext): void {
        ZCCombatSystem.switchState(unit, 'waitAttack');
        unit.waitUntil = context.now() + SOLDIER_WAIT_MIN + context.random() * SOLDIER_WAIT_RANDOM;
    }

    private static startAttack(unit: ZCUnitState, context: IZCUnitContext): void {
        // 出手前重新确认目标与射程，避免在等待期间攻击已经移动的单位。
        context.targeting.acquire(unit);
        if (!context.targeting.current(unit) || !context.targeting.isInAttackRange(unit)) {
            ZCCombatSystem.switchState(unit, 'target');
            return;
        }
        context.targeting.face(unit);
        ZCCombatSystem.switchState(unit, 'attack');
        unit.attackHitDone = false;
        unit.nextAttackAt = context.now() + context.definition(unit).attackInterval;
    }

    private static updateUnit(unit: ZCUnitState, dt: number, context: IZCUnitContext): void {
        if (unit.battleState === 'dead' || unit.hp <= 0) return;
        // 受控闸门（最高优先级）：硬控期间不推进 stateTime/战斗节拍，不索敌、不移动、不攻击，
        // 单位原地保持，表现层按 controlOf().kind 播放眩晕/冻结/麻痹/致盲。
        if (context.controlOf(unit)) return;
        unit.stateTime = Math.round((unit.stateTime + dt) * 1e9) / 1e9;
        const definition = context.definition(unit);

        if (unit.battleState === 'born') {
            if (unit.stateTime >= BORN_SECONDS) ZCCombatSystem.switchState(unit, 'target');
            return;
        }
        if (unit.battleState === 'attack') {
            if (!unit.attackHitDone && unit.stateTime >= definition.attackHitTime) context.sendAttack(unit);
            if (unit.stateTime >= definition.attackDuration) ZCCombatSystem.switchState(unit, 'idle');
            return;
        }
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
        const lockedAndFighting = unit.battleState === 'idle' && !!context.targeting.current(unit);
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
                if (context.now() >= unit.nextAttackAt) this.switchWaitAttack(unit, context);
                else ZCCombatSystem.switchState(unit, 'idle');
                return;
            }
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
