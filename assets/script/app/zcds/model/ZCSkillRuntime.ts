import type { ZCSkillBinding, ZCTypedModifier } from './ZCStatSchema';

export type ZCSkillStateMode = 'none' | 'counter' | 'cast-fsm';

export interface ZCSkillRuntimeDefinition {
    unitId: string;
    skillId: number;
    behaviorKey: string;
    trigger: string;
    stateMode: ZCSkillStateMode;
    parameters: Readonly<Record<string, number>>;
    statusId?: string;
    targetSelector?: string;
    replacementSkillId?: number;
    cooldown?: number;
    maxTriggers?: number;
}

/**
 * 技能行为注册表只接受显式处理器。旧 skillEffect 的数值公式由
 * ZCLegacySkillEffect 的受限解释器执行；它不会在这里注册任意脚本行为。
 * counter 适用于“每 N 次攻击”；只有带前摇/引导/打断阶段的技能才使用 cast-fsm。
 */
export class ZCSkillRuntimeRegistry {
    private readonly handlers = new Map<string, ZCSkillStateMode>();

    constructor() {
        this.register('empowered_attack', 'counter');
        this.register('multi_projectile', 'counter');
        this.register('periodic_damage', 'none');
        this.register('on_hit_status', 'none');
    }

    register(key: string, stateMode: ZCSkillStateMode): this {
        if (!key) throw new Error('[ZCSkillRuntime] behaviorKey 不能为空');
        this.handlers.set(key, stateMode);
        return this;
    }

    compile(
        binding: ZCSkillBinding,
        modifiers: readonly ZCTypedModifier[],
    ): ZCSkillRuntimeDefinition {
        return this.compileBindings([binding], modifiers)[0];
    }

    /**
     * 同一技能允许多行 parameterKey。每行只消费自己声明的旧字段，避免同一武将的
     * 火船撞击/爆炸、冰雕冻结/消失伤害等参数互相覆盖。
     */
    compileBindings(
        bindings: readonly ZCSkillBinding[],
        modifiers: readonly ZCTypedModifier[],
    ): readonly ZCSkillRuntimeDefinition[] {
        const groups = new Map<string, ZCSkillBinding[]>();
        for (const binding of bindings) {
            const key = `${binding.targetUnitId}:${binding.pvpSkillId}`;
            const group = groups.get(key) ?? [];
            group.push(binding);
            groups.set(key, group);
        }

        const result: ZCSkillRuntimeDefinition[] = [];
        for (const group of groups.values()) {
            const first = group[0];
            const registered = this.handlers.get(first.behaviorKey);
            if (!registered) throw new Error(`[ZCSkillRuntime] 未注册 behaviorKey：${first.behaviorKey}`);
            if (first.stateMode !== registered && first.stateMode !== 'none') {
                throw new Error(`[ZCSkillRuntime] ${first.behaviorKey} 需要 ${registered}，表中却是 ${first.stateMode}`);
            }
            for (const binding of group.slice(1)) {
                if (binding.behaviorKey !== first.behaviorKey
                    || binding.trigger !== first.trigger
                    || binding.stateMode !== first.stateMode) {
                    throw new Error(`[ZCSkillRuntime] 同一技能的行为配置不一致：${first.targetUnitId}:${first.pvpSkillId}`);
                }
            }

            const parameters: Record<string, number> = {};
            for (const binding of group) {
                for (const modifier of modifiers) {
                    if (modifier.domain !== 'skill' || modifier.targetUnitId !== binding.targetUnitId) continue;
                    if (binding.parameterKey && modifier.legacyKey !== binding.parameterKey) continue;
                    if (binding.parameterStatId && modifier.statId !== binding.parameterStatId) continue;
                    parameters[modifier.statId] = modifier.operation === 'add'
                        ? (parameters[modifier.statId] ?? 0) + modifier.value
                        : modifier.value;
                }
            }
            result.push({
                unitId: first.targetUnitId,
                skillId: first.pvpSkillId,
                behaviorKey: first.behaviorKey,
                trigger: first.trigger,
                stateMode: first.stateMode,
                parameters,
            });
        }
        return result;
    }
}
