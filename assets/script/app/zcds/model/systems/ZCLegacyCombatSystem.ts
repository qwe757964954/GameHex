import type { ZCDeckBonuses, ZCUnitDefinition } from '../ZCCombatCatalog';
import type { ZCMatchConfig } from '../ZCMatchConfig';
import type { ZCRuntimeRules } from '../ZCGameRuntimeConfig';
import type { ZCCombatTarget, ZCHexState, ZCSnapshot, ZCUnitState } from '../ZCGameTypes';
import type { ZCOwner } from '../ZCMapConfig';
import type { ZCLegacyBuffApplication, ZCLegacySkillEvaluation, ZCLegacySkillEffectRuntime } from '../ZCLegacySkillEffect';
import type { ZCStatusApplyOptions, ZCStatusRuntimeBehavior, ZCStatusSystem } from '../ZCStatusEffect';
import { ZCCombatSystem } from './ZCCombatSystem';

export interface IZCLegacyCombatContext {
    rules(): Readonly<ZCRuntimeRules>;
    legacyConfig(): ZCMatchConfig['legacySkillEffects'];
    legacyAttributes(owner: ZCOwner): ReadonlyMap<string, Readonly<Record<string, unknown>>>;
    legacySkillRuntime(): ZCLegacySkillEffectRuntime;
    statusSystem(): ZCStatusSystem;
    random(): number;
    bonusesFor(owner: ZCOwner): ZCDeckBonuses;
    effectiveUnitDefinition(unit: ZCUnitState): ZCUnitDefinition;
    unitById(id: number): ZCUnitState | undefined;
    hex(id: number): ZCHexState | null;
    applyLegacyKnockback(target: ZCUnitState, source: ZCUnitState, distance: number): void;
}

/** Resolves legacy effect formulas and status applications for the current match. */
export class ZCLegacyCombatSystem {
    static evaluateSkill(source: ZCUnitState, effectKeys: readonly string[],
        target: ZCCombatTarget, isCritical: boolean, context: IZCLegacyCombatContext): ZCLegacySkillEvaluation {
        if (!effectKeys.length) return { hasDamageFormula: false, damage: 0, buffs: [] };
        const definition = context.effectiveUnitDefinition(source);
        const baseAttack = ZCCombatSystem.unitDamageBase(
            source, definition, context.bonusesFor(source.owner), context.rules(), 1,
        ) * (source.attackMultiplier ?? 1);
        const configured = context.legacyAttributes(source.owner).get(source.unitId) ?? {};
        const attributes: Record<string, unknown> = {
            ...configured,
            // The old runtime injected these values dynamically from the battle role.
            // Here they use the current owner/unit/tier/status-adjusted PVP attack.
            角色攻击力: baseAttack,
            基础攻击力: baseAttack,
        };
        const targetUnit = target.kind === 'unit' ? context.unitById(target.id) : undefined;
        const targetHex = target.kind === 'unit' ? undefined : context.hex(target.id);
        const targetMaxHp = targetUnit?.maxHp
            ?? (target.kind === 'wall' ? targetHex?.wallMaxHp : targetHex?.maxHp)
            ?? 0;
        const targetHp = targetUnit?.hp
            ?? (target.kind === 'wall' ? targetHex?.wallHp : targetHex?.hp)
            ?? targetMaxHp;
        return context.legacySkillRuntime().evaluate(effectKeys, {
            attributes,
            random: context.random,
            targetId: target.id,
            targetHp,
            targetMaxHp,
            isCritical,
            hasStatus: (targetId, legacyKey) => {
                const statusId = context.legacyConfig()?.legacyStatusIds[legacyKey] ?? legacyKey;
                return context.statusSystem().instancesOf(targetId).some((instance) => instance.defId === statusId);
            },
        });
    }

    static applyHitStatus(state: ZCSnapshot, target: ZCUnitState, statusId: string | undefined,
        sourceUnitId: number | undefined, context: IZCLegacyCombatContext): void {
        if (!statusId || target.battleState === 'dead') return;
        const result = context.statusSystem().apply(String(target.id), statusId, {
            at: state.elapsedSeconds,
            sourceUnitId: sourceUnitId == null ? undefined : String(sourceUnitId),
        });
        if (result.applied) state.statusEffects = context.statusSystem().exportSnapshot();
    }

    static applyBuffs(state: ZCSnapshot, target: ZCUnitState, buffs: readonly ZCLegacyBuffApplication[],
        sourceUnitId: number | undefined, context: IZCLegacyCombatContext): void {
        if (target.battleState === 'dead' || !buffs.length) return;
        const source = sourceUnitId == null ? undefined : context.unitById(sourceUnitId);
        let changed = false;
        for (const buff of buffs) {
            const legacyType = context.legacyConfig()?.buffTypes[buff.legacyKey] ?? '';
            if (legacyType === '牵引') continue; // handled on the caster at launch
            if (legacyType === '击退') {
                if (source) context.applyLegacyKnockback(target, source, legacyNumber(buff.params['击退距离']));
                continue;
            }
            const statusId = context.legacyConfig()?.legacyStatusIds[buff.legacyKey] ?? buff.legacyKey;
            if (!context.statusSystem().hasDef(statusId)) continue;
            const rawDuration = Number(buff.params['持续时间秒']);
            const durationSeconds = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : undefined;
            const options: ZCStatusApplyOptions = {
                at: state.elapsedSeconds,
                durationSeconds,
                sourceUnitId: sourceUnitId == null ? undefined : String(sourceUnitId),
            };
            if (legacyType === '火法师点燃' || legacyType === '燃烧'
                || legacyType === '燃烧增加伤害' || legacyType === '流血' || legacyType === '流血血爆') {
                options.runtimeBehavior = this.dotBehavior(
                    buff,
                    legacyType,
                    source?.owner ?? 'player',
                    source ? context.effectiveUnitDefinition(source).attack * (source.attackMultiplier ?? 1) : 0,
                );
                options.independentStackDuration = true;
                options.maxStacks = Math.max(1, Math.round(legacyNumber(buff.params['叠加上限'], 1)));
            }
            const result = context.statusSystem().apply(String(target.id), statusId, options);
            changed ||= result.applied;
        }
        if (changed) state.statusEffects = context.statusSystem().exportSnapshot();
    }

    static applySelfBuffs(state: ZCSnapshot, source: ZCUnitState, buffs: readonly ZCLegacyBuffApplication[],
        context: IZCLegacyCombatContext): readonly ZCLegacyBuffApplication[] {
        const targetBuffs: ZCLegacyBuffApplication[] = [];
        let changed = false;
        for (const buff of buffs) {
            const legacyType = context.legacyConfig()?.buffTypes[buff.legacyKey] ?? '';
            if (legacyType !== '牵引') {
                targetBuffs.push(buff);
                continue;
            }
            const statusId = context.legacyConfig()?.legacyStatusIds[buff.legacyKey] ?? buff.legacyKey;
            if (!context.statusSystem().hasDef(statusId)) continue;
            const range = Math.max(0, legacyNumber(buff.params['牵引范围'])) * context.rules().combatDistanceScale;
            const speed = Math.max(0, legacyNumber(buff.params['牵引力度'])) * context.rules().combatDistanceScale;
            if (!(range > 0) || !(speed > 0)) continue;
            const runtimeBehavior: ZCStatusRuntimeBehavior = { kind: 'legacyTraction', range, speed };
            const result = context.statusSystem().apply(String(source.id), statusId, {
                at: state.elapsedSeconds,
                sourceUnitId: String(source.id),
                runtimeBehavior,
                maxStacks: 1,
            });
            changed ||= result.applied;
        }
        if (changed) state.statusEffects = context.statusSystem().exportSnapshot();
        return targetBuffs;
    }

    private static dotBehavior(buff: ZCLegacyBuffApplication, legacyType: string,
        sourceOwner: ZCOwner, fallbackSourceAttack: number): ZCStatusRuntimeBehavior {
        const params = buff.params;
        const senderAttack = Math.max(0, Number.isFinite(buff.sourceAttack)
            ? buff.sourceAttack : fallbackSourceAttack);
        const intervalSeconds = Math.max(0.001, legacyNumber(params['伤害间隔'], 1));
        const isMaxHpBurn = legacyType === '燃烧增加伤害';
        let attackCoefficient = isMaxHpBurn ? 0 : legacyNumber(params['伤害系数']);
        if (legacyType === '流血' || legacyType === '流血血爆') {
            attackCoefficient += legacyNumber(params['伤害加成属性名值']) * .01;
        }
        const cap = legacyNumber(params['每次伤害不超过自身攻击的倍数'], Number.NaN);
        const extraTrigger = legacyNumber(params['额外伤害触发属性名值']);
        const extraEvery = Math.max(0, Math.round(legacyNumber(params['额外伤害间隔属性名值'])));
        const extraCoefficient = legacyNumber(params['额外伤害系数'])
            + legacyNumber(params['额外伤害加成属性名值']) * .01;
        return {
            kind: 'legacyDot',
            intervalSeconds,
            flatDamagePerStack: Math.max(0, senderAttack * attackCoefficient),
            targetMaxHpPctPerStack: isMaxHpBurn ? Math.max(0, legacyNumber(params['扣血百分比'])) : 0,
            capAttackMultiplier: Number.isFinite(cap) && cap >= 0 ? cap : undefined,
            senderAttack,
            sourceOwner,
            extraEveryTicks: extraTrigger > 0 && extraEvery > 0 ? extraEvery : undefined,
            extraFlatDamage: extraTrigger > 0 && extraEvery > 0
                ? Math.max(0, senderAttack * extraCoefficient) : undefined,
        };
    }
}

function legacyNumber(value: unknown, fallback = 0): number {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}
