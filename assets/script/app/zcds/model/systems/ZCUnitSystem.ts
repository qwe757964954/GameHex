import type { IZCModelServices } from './ZCModelServices';
import type { ZCCombatTarget, ZCUnitState } from '../ZCGameTypes';
import { ZCCombatSystem } from './ZCCombatSystem';
import { ZC_PORTAL_FLIGHT_SECONDS } from '../ZCBattlePresentationQueue';
import type { IZCDashStep } from './ZCMovementSystem';
import type { IZCDashHit } from './ZCUnitTargeting';

export interface IZCUnitTargeting {
    acquire(unit: ZCUnitState): void;
    refreshPriorityTarget?(unit: ZCUnitState): boolean;
    current(unit: ZCUnitState): ZCCombatTarget | null;
    isInAttackRange(unit: ZCUnitState): boolean;
    isOutOfAttackRange(unit: ZCUnitState): boolean;
    /**
     * 「触发范围」闸门：普攻射程内有没有可打的目标（2026-11-11）。
     *
     * 可选：缺省 ⇒ 技能触发不设闸门（老上下文 / 单测夹具行为逐字不变）。
     * 实现见 `ZCUnitTargeting.hasTargetInAttackRange`。
     */
    hasTargetInAttackRange?(unit: ZCUnitState): boolean;
    /**
     * 当前普攻射程（世界 px），给技能自带搜索半径封顶用；只压不抬。
     * 可选：缺省 ⇒ 不封顶。实现见 `ZCUnitTargeting.attackReachOf`。
     */
    attackReachOf?(unit: ZCUnitState): number;
    findStepToward(unit: ZCUnitState): number | null;
    face(unit: ZCUnitState): void;
    /**
     * 本帧的冲刺倍率 / 冲刺门槛（`>= 1`，没配 / 不在冲刺距离内 = 1）。
     *
     * 可选：老上下文（测试夹具 / 外部实现）没有这条就够了，缺省按 1 处理 ——
     * 与「没配 `chargeDistance`」是同一条路径，存量单位的移动逐字不变。
     * 实现见 `ZCUnitTargeting.chargeSpeedScale`。
     */
    chargeSpeedScale?(unit: ZCUnitState): number;
    /**
     * 冲刺这一步会撞到的第一个敌人（线段扫掠圆）；`null` = 没撞到。
     *
     * 可选：缺省时冲刺退化成「跑到终点但永远撞不到人」，只影响配了冲刺的单位。
     * 实现见 `ZCUnitTargeting.dashFirstHit`。
     */
    dashFirstHit?(unit: ZCUnitState, fromX: number, fromY: number, toX: number, toY: number): IZCDashHit | null;
}

export interface IZCUnitMovement {
    /** `speedScale` = 冲刺倍率（缺省 1 ⇒ 与旧签名逐字一致）。 */
    advanceTowardUnit(unit: ZCUnitState, target: ZCUnitState, dt: number, speedScale?: number): void;
    advanceUnitMovement(unit: ZCUnitState, dt: number, speedScale?: number): void;
    startMarch(unit: ZCUnitState): void;
    advanceMarch(unit: ZCUnitState, dt: number): void;
    /** 冲刺一步的预测落点（不落盘）。可选：缺省 ⇒ 冲刺整段不启用，退回旧追击。 */
    dashStep?(unit: ZCUnitState, dt: number, speedScale: number): IZCDashStep;
    /** 把单位摆到连续坐标（冲刺落位）。可选：与 `dashStep` 成对出现。 */
    placeAt?(unit: ZCUnitState, x: number, y: number): void;
}

export interface IZCUnitContext extends Pick<IZCModelServices, 'effectiveDefinition' | 'random'> {
    now(): number;
    /** 当前硬控（无则 null）；受控单位由状态机闸门冻结一切行动。 */
    controlOf(unit: ZCUnitState): { kind: string; defId: string } | null;
    /**
     * **软控：禁普攻**（2026-11-11 磁电菇「麻痹」软控 `numb`）。
     *
     * 与 `controlOf` 的区别：硬控冻结一切；软控只挡「这一拳」，移动与技能照常，
     * 移速的 −50% 由状态自己的 `moveSpeedPct` 走属性链，不在这里处理。
     * 缺省 ⇒ 不禁（老上下文 / 单测夹具行为逐字不变）。
     */
    attackBlockedOf?(unit: ZCUnitState): boolean;
    readonly unitById: ReadonlyMap<number, ZCUnitState>;
    readonly targeting: IZCUnitTargeting;
    readonly movement: IZCUnitMovement;
    sendAttack(unit: ZCUnitState): void;
}

const BORN_SECONDS = 0.2;
const SOLDIER_WAIT_MIN = 0.15;
const SOLDIER_WAIT_RANDOM = 0.15;
/** 冲刺超时的兜底余量：正常按「到点 / 撞到」收场，这里只防终点不可达。 */
const DASH_TIMEOUT_MARGIN = 2;
const DASH_MIN_SECONDS = 0.15;

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
        //  软控闸门（2026-11-11 磁电菇「麻痹」`numb`）：禁普攻，但**不**冻移动。
        //  直接 return、不改 battleState ⇒ 单位原地站着（追到射程内就停手），
        //  解控后下一帧 `now >= nextAttackAt` 立刻补一拳 —— 与技能侧「待触发」同一套思路。
        //  放在这而不是 `updateUnit` 开头，是因为开头那条 `controlOf` 会连移动一起冻住。
        if (context.attackBlockedOf?.(unit)) return;
        // 出手前重新确认目标与射程，避免在等待期间攻击已经移动的单位。
        context.targeting.acquire(unit);
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
     * 起冲：把目标**当时的坐标拍成快照**，此后一路直线跑过去。
     *
     * 冷却不在这里扣 —— 2026-11-03 用户口径「冲刺是普通攻击，每次普通攻击都有 0.7 秒冷却，
     * 冷却期间静止在原地播待机动作」：冲刺整段就是这一拳的动作，所以 0.7s 从**撞上 / 冲空**
     * 那一刻才开始计时（`updateDash` 收场处写 `nextAttackAt` / `dashRecoverUntil`）。
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
     * 冲刺的一帧：直线推进 → 判路径上第一个撞到的东西 → 结算普攻；没人就跑到终点，**不结算伤害**。
     *
     * 这条分支抢在所有状态之前（见 `updateUnit`），因为冲刺一旦起手就不能再被索敌改写朝向，
     * 否则又退回「一直追着目标 ⇒ 必中」的老行为，冲刺也就没有躲的余地了。
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
     * 冲刺收场后进 0.7s 冷却：原地待机，不索敌、不挪窝。
     *
     * 两个时刻一起写是有意的 —— `nextAttackAt` 管「什么时候能再出手」（与其它单位同一口径），
     * `dashRecoverUntil` 管「这 0.7s 站住别动」。只写前者的话，冷却期间单位会一边等一边往目标挪，
     * 画面上就不是「静止在原地待机」了。
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
     * 能冲就冲 —— 冲刺就是这套普攻，所以它抢在 `waitAttack / idle / move` 前面统一判一次。
     *
     * 四条门槛缺一不可：有目标 / 在 `chargeDistance` 内（`chargeSpeedScale > 1`）/
     * 冷却已就绪 / 上下文真的给了冲刺能力。任何一条不满足就交给下面的常规状态机
     * （远距离继续走、贴身且冷却好就走普通挥拳 —— 后者只对没配冲刺的单位有意义）。
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
        // 冲刺标记**每帧先清**：它是「本帧正在冲刺」的派生量，不是记忆量。
        // 不清的话，离开 move 的那一帧（进射程 / 目标死亡 / 被硬控）会把这个标记带进 idle，
        // 表现层（`ZCUnitView` 用 `charging` 把移动动作换成攻击动作）就会让尸体停在出拳姿势。
        unit.charging = false;
        // 受控闸门（最高优先级）：硬控期间不推进 stateTime/战斗节拍，不索敌、不移动、不攻击，
        // 单位原地保持，表现层按 controlOf().kind 播放眩晕/冻结/麻痹/致盲。
        // 冲刺中挨硬控 ⇒ 冲刺当场作废，**按冲空同责**进冷却：起冲不扣冷却了，若这里也不扣，
        // 解控后下一帧会立刻再冲一次 —— 等于硬控白送一次冲锋。
        if (context.controlOf(unit)) {
            if (unit.dashUntil !== undefined) {
                this.endDash(unit);
                this.startDashCooldown(unit, context);
            }
            return;
        }
        //  冲刺一旦起手就抢在**所有**状态之前推进：起冲时已经拍下终点快照，中途不再索敌、
        //  不再改道。放在状态分派之前而不是塞进 move 分支，是因为目标中途死掉 / 出了射程
        //  都不该让冲锋半路刹车 —— 真·撞击的前提就是「冲出去就收不回来」。
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
        //  冲刺后的冷却：**静止在原地播待机动作**（用户 2026-11-03 口径）。
        //  放在这里（`born` 之后、索敌之前）而不是 `move` 分支里：冷却期间连索敌都不该做，
        //  否则「目标跑远了 → 切 move → 走过去」又变成一边等冷却一边挪窝。
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
        if (unit.battleState === 'attack') {
            if (!unit.attackHitDone && unit.stateTime >= definition.attackHitTime) context.sendAttack(unit);
            if (unit.stateTime >= definition.attackDuration) ZCCombatSystem.switchState(unit, 'idle');
            return;
        }
        //  buff 类施法的**原地锁**（2026-11-13 用户口径：「释放 buff 类技能（回血，加伤害）时
        //  要打断 walk，停止在原地（不影响攻击），匹配对应的特效或数字加成的动画播放时间
        //  结束才继续」）。写法与 `dashRecoverUntil` 同一套，区别只有一处：
        //  那个连索敌都不做，这里**保留出手** —— 括号里写着「不影响攻击」，
        //  所以只把「挪窝」拿掉，射程内有目标、普攻 CD 到点就照常开打。
        //  ⚠️ 放在 `attack` 分支之后：正在出拳就别去打断它，那一拳播完自然掉回 idle。
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
            //  冲刺不在这里判（`tryStartDash` 已经抢在前面统一处理）：走到这一步说明
            //  「没配冲刺 / 目标还在 `chargeDistance` 外 / 冷却没好」，一律按**原速**追。
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

