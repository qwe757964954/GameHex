import type { ZCAttackProfile, ZCDeckBonuses, ZCUnitDefinition } from '../ZCCombatCatalog';
import { ZCCombatEventType, ZCSkillTrigger } from '../ZCCombatCatalog';
import type { ZCRuntimeRules } from '../ZCGameRuntimeConfig';
import type { ZCUnitBattleState, ZCUnitState } from '../ZCGameTypes';

/**
 * 弹道打空后的续飞距离（世界 px，一格 36×42）。100 ≈ 2.4 格，弹速 500 时约 0.2s。
 *
 * 只对没命中的弹道生效，命中即摘除；穿透弹命中后不消耗，余程同样按此延长。
*/
export const ZC_PROJECTILE_MISS_DISTANCE = 100;

/** 单次伤害与单位战斗状态的纯规则；目标选择和事件发布由模型编排。*/
export class ZCCombatSystem {
    /** 强化节拍使用绝对时刻，empoweredReadyAt 随单位快照保存。*/
    static consumeEmpoweredAttack(
        unit: Pick<ZCUnitState, 'completedAttackCount' | 'empoweredReadyAt'>,
        profile: Pick<ZCAttackProfile, 'trigger' | 'cooldown' | 'empoweredEvery'>,
        now: number,
    ): boolean {
        const currentCount = (unit.completedAttackCount ?? 0) + 1;
        unit.completedAttackCount = currentCount;
        if (profile.trigger !== ZCSkillTrigger.everySeconds) {
            const every = profile.empoweredEvery ?? 0;
            return every > 0 && currentCount % every === 0;
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
     * `skillDamageRate` 为本次技能行的伤害倍率，缺省 1，既有调用方不传即沿用旧口径。
     *
     * `unit` 收窄成函数体真正读到的两个字段：伤害公式只关心品级与中立增援，与单位的
     * 位置/血量/状态机无关。收窄之后离线数值工具（验证台、数值表）可以按同一份公式
     * 复算伤害，不必伪造一整个 `ZCUnitState`；对原有调用方零影响（完整对象天然满足 `Pick`）。
    */
    static unitDamage(
        unit: Pick<ZCUnitState, 'tier' | 'neutralReinforcement'>,
        definition: ZCUnitDefinition,
        bonuses: ZCDeckBonuses,
        counterMultiplier: number,
        rules: Readonly<ZCRuntimeRules>,
        skillDamageRate = 1,
    ): number {
        const tierMultiplier = 1 + (unit.tier - 1) * rules.unitAttackPerTier;
        return Math.round(definition.attack * (unit.neutralReinforcement ? 1 : bonuses.unitAttackMultiplier * tierMultiplier)
            * counterMultiplier * rules.combatDamageMultiplier * skillDamageRate);
    }

    /**
     * 远程弹道的出手伤害：技能倍率在出手时乘进 `baseDamage`，命中时只再乘克制系数。
     * 这样 `ZCProjectileState.baseDamage` 仍是「出手时的攻击属性」，不必给快照加字段。
    */
    static unitDamageBase(
        unit: Pick<ZCUnitState, 'tier' | 'neutralReinforcement'>,
        definition: ZCUnitDefinition,
        bonuses: ZCDeckBonuses,
        rules: Readonly<ZCRuntimeRules>,
        skillDamageRate = 1,
    ): number {
        const tierMultiplier = 1 + (unit.tier - 1) * rules.unitAttackPerTier;
        return definition.attack * (unit.neutralReinforcement ? 1 : bonuses.unitAttackMultiplier * tierMultiplier) * rules.combatDamageMultiplier * skillDamageRate;
    }

    static applyDamage(target: { hp: number }, damage: number): number {
        if (!Number.isFinite(damage) || damage <= 0 || target.hp <= 0) return 0;
        const before = target.hp;
        target.hp = Math.max(0, before - damage);
        return before - target.hp;
    }

    /** 一次攻击的飞行时长（秒）。`missDistance` 仅弹道使用，缺省 0 与旧口径一致。*/
    static attackTravelSeconds(mode: ZCCombatEventType, distance: number, projectileSpeed?: number, missDistance = 0): number {
        if (mode !== ZCCombatEventType.Projectile) return 0.32;
        const travel = (Number.isFinite(distance) ? Math.max(0, distance) : 0) + Math.max(0, missDistance);
        return Math.max(1e-6, travel / (projectileSpeed || 500));
    }
}
