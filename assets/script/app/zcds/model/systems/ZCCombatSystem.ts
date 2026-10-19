import { ZCCombatEventType, ZCSkillTrigger } from '../ZCCombatCatalog';
import type { ZCAttackProfile, ZCDeckBonuses, ZCUnitDefinition } from '../ZCCombatCatalog';
import type { ZCRuntimeRules } from '../ZCGameRuntimeConfig';
import type { ZCUnitBattleState, ZCUnitState } from '../ZCGameTypes';

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

    static attackTravelSeconds(mode: ZCCombatEventType, distance: number, projectileSpeed?: number): number {
        return mode === ZCCombatEventType.Projectile
            ? Math.max(1e-6, distance / (projectileSpeed || 500))
            : 0.32;
    }
}
