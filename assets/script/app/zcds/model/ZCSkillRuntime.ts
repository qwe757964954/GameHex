import type { ZCSkillBinding, ZCSkillStateMode, ZCTypedModifier } from './ZCStatSchema';

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
    /**
     * 开局常驻状态（`behaviorKey === 'passive_status'`）。
     *
     * 与 `statusId` 分开是因为两者生效时机不同：`statusId` 是「命中时挂给被打的人」，
     * 这个是在单位出生后挂给**自己**、且不过期。合成一个字段会让
     * `ZCAttackResolutionSystem.sendAttack` 里的 `skillRuntime?.statusId ?? profile.onHitStatusId`
     * 把常驻被动误当成命中减益打到敌人身上。
     */
    passiveStatusId?: string;
}

/** 允许把 `pvpSkillPlan` 行直接喂进注册表：计划没有 `legacySkillId`，只借行为/参数/状态三样。 */
export interface ZCSkillRuntimePlanLike {
    pvpSkillId: number;
    targetUnitId: string;
    behaviorKey?: string | null;
    trigger?: string | null;
    stateMode?: ZCSkillStateMode | null;
    statusId?: string | null;
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
        //  2026-10-29 新增两条「只带数据、不带行为」的 key：
        //  · `skill_params` —— 计划行只提供 `skillParamJson` 里的数值参数（连发次数 / 护盾比例 / 低血阈值…），
        //    没有自己的结算逻辑，结算仍由既有的普攻 / empowered 流程读参数完成；
        //  · `passive_status` —— 开局给自己挂一个不过期的状态（藤盾这类常驻减伤）。
        //  新增而不是复用 on_hit_status，是因为后者的语义是「打中别人时挂给被打的人」，
        //  混用会让常驻被动被当成命中减益打到敌人身上。
        this.register('skill_params', 'none');
        this.register('passive_status', 'none');
        //  2026-11-04 椰蛋战士「暴风」（100504）：收招阶段从施法者抛出 N 个移动区域。
        //  与 `skill_params` 一样只带数据，结算由 `ZCAttackResolutionSystem` 的 zone 分支完成；
        //  单独注册是因为它要能出现在表里（`SKILL_BEHAVIORS` 白名单）而不报错。
        this.register('on_cast_end_spawn_zone', 'none');
        //  2026-10-30 僵尸「共生信号」系列（103001 / 103002 / 103003）：友军光环。
        //  与上面几条一样「只带数据」—— 施加状态由 `ZCSkillTriggerSystem.applyTeamAura` 每步推进，
        //  结算复用状态系统的 `statMods`（`attackPct` / `maxHpPct` / `moveSpeedPct` / `attackIntervalPct`）。
        this.register('team_aura', 'none');
        //  2026-10-30 六条「第二个主动」的两条新车道，同样只带数据、不带状态机：
        //  · `self_cast`     —— 冷却到点给自己开一段限时增益（可带自愈 / 友军治疗 / 净化），
        //                      施加与计时全在 `ZCSkillTriggerSystem.applySelfCast`；
        //  · `random_strike` —— 冷却到点在半径内挑 N 个敌人各打一发，
        //                      选目标与伤害结算分别落在 trigger system 与 `ZCAttackResolutionSystem`。
        this.register('self_cast', 'none');
        this.register('random_strike', 'none');
        //  2026-11-06 魔术师「移形换影」（103404）：闪现 + 两端结算 + 可选分身爆炸。
        //  同样只带数据 —— 推进在 `ZCSkillTriggerSystem.applyBlinkStrike`，位移由组合根
        //  转给 `ZCMovementSystem.placeAt`，伤害复用 `ZCAttackResolutionSystem.strikeTargets`。
        this.register('blink_strike', 'none');
        //  2026-11-09 大威天芦「无尘禁土」（102503）：冷却到点在**自己脚下**开一片
        //  **跟着本体走**的周期伤害区域（大拳那一套是「打出去」，这个是「裹在身上」）。
        //  与 `periodic_damage` 不是一回事：那个 handler 挂在状态上、只结算**承载者自己**
        //  掉血（自伤 DoT），而这里要的是「半径内所有敌人每秒掉一次」。
        //  与 `team_aura` 也不是一回事：那个给友军挂增益状态，不打人。
        //  推进在 `ZCSkillTriggerSystem.applySelfAura`，结算复用 `ZCGroundZoneSystem`。
        this.register('self_aura', 'none');
        //  2026-11-11 磁电菇「五雷轰顶」（101603）：冷却到点在目标点连续落下 N 道雷，
        //  每道雷独立判伤、独立掷麻痹。推进在 `ZCSkillTriggerSystem.applyBoltStrike`，
        //  落点与结算在 `ZCAttackResolutionSystem.castBoltLine`（每道雷 = 一个「一波」地面区域）。
        this.register('bolt_strike', 'none');
        //  2026-11-12 科学家「精密陷阱」（103504）：冷却到点**在自己脚下**留一个陷阱，
        //  敌人踩上去（或到点）就炸。「放下就不管」的一次性布置，没有持续状态机。
        //  推进在 `ZCSkillTriggerSystem.applyTrap`，摆放与表现路径在
        //  `ZCAttackResolutionSystem.castTrap`，结算复用 `ZCGroundZoneSystem`
        //  （触碰走 `contactRadius`、爆炸走 `expireDamage` + `expirePrefabPath`）。
        this.register('trap_place', 'none');
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
                trigger: first.trigger ?? 'none',
                stateMode: first.stateMode,
                parameters,
                //  2026-10-29：把状态 id 透传到运行时。此前这里只吐 `parameters`，而
                //  `ZCAttackResolutionSystem.sendAttack` 早就在读 `skillRuntime?.statusId`，
                //  结果是「计划行按等级挂命中减益」永远不生效（只认 profile 上那个定死的 onHitStatusId）。
                //  缺省 undefined ⇒ 所有既有行行为不变。
                ...runtimeStatusOf(first),
            });
        }
        return result;
    }
}

/** 从绑定行/计划行上取两种状态 id；`passive_status` 走常驻槽，其余走命中槽。 */
function runtimeStatusOf(binding: ZCSkillBinding): Pick<ZCSkillRuntimeDefinition, 'statusId' | 'passiveStatusId'> {
    const statusId = typeof binding.statusId === 'string' && binding.statusId.trim()
        ? binding.statusId.trim() : undefined;
    if (!statusId) return {};
    return binding.behaviorKey === 'passive_status'
        ? { passiveStatusId: statusId }
        : { statusId };
}

