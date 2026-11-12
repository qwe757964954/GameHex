import type { ZCAttackProfile, ZCDeckBonuses, ZCUnitDefinition } from '../ZCCombatCatalog';
import { ZCCombatEventType, ZCSkillTrigger } from '../ZCCombatCatalog';
import type { ZCRuntimeRules } from '../ZCGameRuntimeConfig';
import type { ZCUnitBattleState, ZCUnitState } from '../ZCGameTypes';

/**
 * 弹道**打空**后沿原方向继续飞的距离（世界 px，与 `freeX/freeY` 同一套坐标；一格 36×42）。
 *
 * 2026-11-09 需求：「子弹会打空，但是会沿着方向继续前进，直到达到指定的距离消失，
 * 或者命中其他目标消失」。
 *
 * 为什么需要它：改前弹道寿命 = `出手点到目标的距离 / 速度`（见 `attackTravelSeconds`），
 * 于是**目标一挪位**，子弹正好在那条「打不到人」的终点线上凭空消失，看着像被谁剪掉了。
 * 加一段续飞之后，没打中的子弹会把这段路飞完，路上撞到谁就打谁。
 *
 * 100 ≈ 2.4 格 ≈ 弹速 500 时的 0.2s，够看出「这发打空了」又不至于穿过半张图去打人。
 * 调大调小只改这一个数。
 *
 * 口径选择（不是笔误）：
 *  - 取「目标距离 + 本常数」而不是「固定总射程」。固定射程会让**原本打得到**的远距离
 *    目标提前失效（子弹在目标身前就过期），把「打空才继续飞」变成「够不够得着」。
 *  - 命中即消耗（`ZCProjectileSystem` 命中那一拍就摘掉弹道），所以续飞段只在**没打到**时生效，
 *    正常命中的表现与改前逐字一致。
 *  - 例外：穿透弹（`remainingPierces > 0`）命中后不消耗，因此它的余程也跟着变长
 *    —— 这正是「穿透」应有的语义（打出人群），但要清楚这是一次强度变化。
 */
export const ZC_PROJECTILE_MISS_DISTANCE = 100;

/** 单次伤害与单位战斗状态的纯规则；目标选择和事件发布由模型编排。 */
export class ZCCombatSystem {
    /** 强化节拍使用绝对时刻，empoweredReadyAt 随单位快照保存。 */
    static consumeEmpoweredAttack(
        unit: Pick<ZCUnitState, 'completedAttackCount' | 'empoweredReadyAt'>,
        profile: Pick<ZCAttackProfile, 'trigger' | 'cooldown' | 'empoweredEvery'>,
        now: number,
    ): boolean {
        unit.completedAttackCount = (unit.completedAttackCount ?? 0) + 1;
        if (profile.trigger !== ZCSkillTrigger.everySeconds) {
            const every = profile.empoweredEvery ?? 0;
            return every > 0 && (unit.completedAttackCount ?? 0) % every === 0;
        }
        const cooldown = profile.cooldown ?? 0;
        if (cooldown <= 0) return false;
        if (unit.empoweredReadyAt === undefined) {
            unit.empoweredReadyAt = now + cooldown;
            return false;
        }
        if (now < unit.empoweredReadyAt) return false;
        unit.empoweredReadyAt = now + cooldown;
        return true;
    }

    static switchState(unit: ZCUnitState, state: ZCUnitBattleState): void {
        if (unit.battleState === state) return;
        unit.battleState = state;
        unit.stateTime = 0;
        if (state !== 'moveForward') unit.marchAngle = null;
        if (state !== 'move' && state !== 'moveForward') {
            unit.targetHexId = null;
            unit.progress = 0;
        }
    }

    /**
     * `skillDamageRate` = 本次出手所用技能行的伤害倍率（`ZCAttackProfile.damageRate`）。
     * 尾参可选、默认 `1` —— 既有调用方（含用例）不传即等价于改动前的口径。
     */
    static unitDamage(
        unit: ZCUnitState,
        definition: ZCUnitDefinition,
        bonuses: ZCDeckBonuses,
        counterMultiplier: number,
        rules: Readonly<ZCRuntimeRules>,
        skillDamageRate = 1,
    ): number {
        const tierMultiplier = 1 + (unit.tier - 1) * rules.unitAttackPerTier;
        return Math.round(definition.attack * bonuses.unitAttackMultiplier * tierMultiplier
            * counterMultiplier * rules.combatDamageMultiplier * skillDamageRate);
    }

    /**
     * 远程弹道的**出手伤害**（命中时再乘克制系数）。
     *  技能倍率必须在这里乘进去、而不是命中时：`ZCProjectileState.baseDamage` 是
     * 「出手时的攻击属性」，进快照（`ZCSnapshotCodec` 校验非负）；倍率在出手时就已确定，
     * 放进 baseDamage 就**不必给快照加字段**。
     */
    static unitDamageBase(unit: ZCUnitState, definition: ZCUnitDefinition, bonuses: ZCDeckBonuses, rules: Readonly<ZCRuntimeRules>, skillDamageRate = 1): number {
        const tierMultiplier = 1 + (unit.tier - 1) * rules.unitAttackPerTier;
        return definition.attack * bonuses.unitAttackMultiplier * tierMultiplier * rules.combatDamageMultiplier * skillDamageRate;
    }

    static applyDamage(target: { hp: number }, damage: number): number {
        if (!Number.isFinite(damage) || damage <= 0 || target.hp <= 0) return 0;
        const before = target.hp;
        target.hp = Math.max(0, before - damage);
        return before - target.hp;
    }

    /**
     * 一次攻击的飞行时长（秒）。
     *
     * `missDistance` 是**打空续飞**的额外距离（世界 px），只有 projectile 吃它：
     * 位移取 `距离 + missDistance`，于是「飞不到目标」的情况下子弹还会再飞一段再消失。
     * 缺省 0 ⇒ 与改前逐字一致（melee 恒 0.32s，projectile 恒 `距离 / 速度`）。
     */
    static attackTravelSeconds(mode: ZCCombatEventType, distance: number, projectileSpeed?: number, missDistance = 0): number {
        if (mode !== ZCCombatEventType.Projectile) return 0.32;
        const travel = (Number.isFinite(distance) ? Math.max(0, distance) : 0) + Math.max(0, missDistance);
        return Math.max(1e-6, travel / (projectileSpeed || 500));
    }
}
