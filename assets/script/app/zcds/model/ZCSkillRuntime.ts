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
     * 这个是在单位出生后挂给自己、且不过期。合成一个字段会让
     * `ZCAttackResolutionSystem.sendAttack` 里的 `skillRuntime?.statusId ?? profile.onHitStatusId`
     * 把常驻被动误当成命中减益打到敌人身上。
    */
    passiveStatusId?: string;
}

/** 允许把 `pvpSkillPlan` 行直接喂进注册表：计划没有 `legacySkillId`，只借行为/参数/状态三样。*/
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
        //  2026-11-18 第 17 批 雷蕉「嗜血术」102204：**有窗口**的团队增益（伤害 + 攻速，
        //  III 级友军击杀可延长）。与 `team_aura` 同一套状态通道，但窗口会关、离开半径即失去。
        //  施加与计时全在 `ZCSkillTriggerSystem.applyTeamBuff`。
        this.register('team_buff', 'none');
        //  2026-11-18 第 17 批 南瓜战神「大吼大叫」102304：一次自心圆怒吼 —— 伤害 + 敌方减攻
        //  + III 级友军护盾。只带数据，出手在 `ZCAttackResolutionSystem.castRoar`。
        this.register('roar', 'none');
        //  飓风（三叶小丑 102004，2026-11-18 第 17 批）：在场上生成一团会走动的区域。
        this.register('storm_zone', 'none');
        //  射线集束（科学家 103503，2026-11-19 第 18 批）：身前矩形光束，每秒 5 跳。
        this.register('ray_beam', 'none');
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
        //  2026-11-09 大威天芦「无尘禁土」（102503）：冷却到点在自己脚下开一片
        //  跟着本体走的周期伤害区域（大拳那一套是「打出去」，这个是「裹在身上」）。
        //  与 `periodic_damage` 不是一回事：那个 handler 挂在状态上、只结算承载者自己
        //  掉血（自伤 DoT），而这里要的是「半径内所有敌人每秒掉一次」。
        //  与 `team_aura` 也不是一回事：那个给友军挂增益状态，不打人。
        //  推进在 `ZCSkillTriggerSystem.applySelfAura`，结算复用 `ZCGroundZoneSystem`。
        this.register('self_aura', 'none');
        //  2026-11-11 磁电菇「五雷轰顶」（101603）：冷却到点在目标点连续落下 N 道雷，
        //  每道雷独立判伤、独立掷麻痹。推进在 `ZCSkillTriggerSystem.applyBoltStrike`，
        //  落点与结算在 `ZCAttackResolutionSystem.castBoltLine`（每道雷 = 一个「一波」地面区域）。
        this.register('bolt_strike', 'none');
        //  2026-11-12 科学家「精密陷阱」（103504）：冷却到点在自己脚下留一个陷阱，
        //  敌人踩上去（或到点）就炸。「放下就不管」的一次性布置，没有持续状态机。
        //  推进在 `ZCSkillTriggerSystem.applyTrap`，摆放与表现路径在
        //  `ZCAttackResolutionSystem.castTrap`，结算复用 `ZCGroundZoneSystem`
        //  （触碰走 `contactRadius`、爆炸走 `expireDamage` + `expirePrefabPath`）。
        this.register('trap_place', 'none');
        //  2026-11-18 第 17 批：雷蕉「闪电链」102203 —— 冷却到点放一条连锁闪电，
        //  逐跳跳向「最近且未被命中」的敌人，每跳各自结算、II 级起逐跳递减。
        //  推进在 `ZCSkillTriggerSystem.applyChainLightning`，落点与结算在
        //  `ZCAttackResolutionSystem.castChainLightning`，表现路径在 `ZCChainLightningFx`。
        this.register('chain_damage', 'none');
        //  2026-11-18 第 17 批：舞王「舞王召唤」103103 —— 冷却到点召出一批随从，
        //  跟随本体（四个固定阵位、随本体朝向镜像）并主动攻击最近的敌人。
        //  推进在 `ZCSkillTriggerSystem.applySummonUnit`，生成与逐帧跟随在
        //  `ZCGameModel.summonUnits` / `syncSummons`（要动 `state.units`，所以不在攻击系统）。
        this.register('summon_unit', 'none');
        //  2026-11-17 第 12 批：两条「冷却到点射一枚会爆开的弹」的车道。
        //  · `splash_shot`（风炮菇「孢爆箭」101303）—— 朝锁定目标射一发，命中点半径内均等溅射；
        //  · `spore_burst`（水手菇「孢子凝珠」101104）—— 同上，外加给命中目标挂一段减速。
        //  为什么要在 `random_strike` 之外另开一条：那一条的命中状态只能是写死的 `numb`
        //  （见 `ZC_STRIKE_NUMB_STATUS_ID` 的注释），而孢子凝珠要的是**按档位变比例**的减速。
        //  两个 key 共用一个实现，只有「有没有减速参数」这一处差别 —— 名字分开是为了让
        //  设计案 P 列的口径与配表逐字对得上，不是两套结算。
        //  推进在 `ZCSkillTriggerSystem.applySplashShot`，发弹与溅射在
        //  `ZCAttackResolutionSystem.castSplashShot`（复用 `strikeTargets` 的导弹分支）。
        this.register('splash_shot', 'none');
        this.register('spore_burst', 'none');
        //  2026-11-17 第 13 批：两条「以自身为圆心爆一次」的车道。
        //  · `burst_aura`（菌壶菇「菌毯爆发」101504）—— 半径内均等伤害 + 给自己套一段护盾，
        //    III 级护盾期间再叠一层「受到伤害降低」；
        //  · `burst_knockback`（菌王菇「菌核爆裂」101804）—— 半径内均等伤害 + 把命中目标推开 N 格。
        //  与第 12 批的 `splash_shot` 正好互补：那个的圆心由**命中点**决定，这个的圆心恒等于**自己**，
        //  所以不能用 `strikeTargets` 的导弹分支（那条要先选中一个远处目标、再让弹体飞过去）。
        //  两条 key 共用一个实现，只差「爆完给自己加什么」；推进在
        //  `ZCSkillTriggerSystem.applyBurstSkill`，结算在 `ZCAttackResolutionSystem.castBurstSkill`。
        this.register('burst_aura', 'none');
        this.register('burst_knockback', 'none');
        //  2026-11-17 第 14 批：两条「近身型主动」，各自一套命中集合。
        //  · `fan_slow`（机甲菇「菌丝绞杀」101503）—— 身前 120° 扇形、最多 4/5/6 人、带减速。
        //    不能复用 `castFanSkill`（那条是副轨：半径按普攻射程 ×倍率、且**没有人数上限**）；
        //    也不能复用 `burst_*`（那个是 360°）。推进在 `ZCSkillTriggerSystem.applyFanSweep`，
        //    结算在 `ZCAttackResolutionSystem.castFanSweep`。
        //  · `single_strike`（分裂菇「菌丝突刺」101403）—— 贴到最近敌人身边打一发 + 眩晕。
        //    与 `blink_strike`（魔术师 103404）是同一类「挪过去再打」，但那条有往返 / 分身 /
        //    搜索半径封顶三套 103404 专属语义，混用等于把两套参数塞进一格。
        //    因为要位移，整条落在**触发系统**（`applySingleStrike`，与 `applyBlinkStrike` 同侧）。
        this.register('fan_slow', 'none');
        this.register('single_strike', 'none');
        //  2026-11-17 第 15 批：冲锋车道，三条技能两套参数前缀。
        //  · `charge_shield`（菇八戒「菌盾冲锋」101204）—— 朝目标方向定长 1 格，撞到的敌人吃伤害，
        //    落点给自己挂 12/15/18% 最大生命的护盾。参数前缀 `charge*`。
        //  · `legacy_dash`（南瓜战神「冲锋」102303 / 爆锤莲王「尖刺冲锋」102703）——
        //    一条朝最近敌人、一条朝面朝方向，路径上的敌人全吃伤害；
        //    前者带眩晕、后者带易伤（后续两档再各自加「自身减伤 / 自身护盾」）。参数前缀 `dash*`。
        //  为什么两条 key 不合成一个：设计案 P 列与配表逐字对得上（与 `splash_shot`/`spore_burst`、
        //  `burst_aura`/`burst_knockback` 同一条理由）。实现共用 `applyChargeDash` 的骨架，
        //  差异全在参数（`chargeCells` 定长 vs `dashTowardNearest` 选向）。
        //  🔴 两者都要位移，所以整条落在**触发系统**（与 `applySingleStrike` / `applyBlinkStrike` 同侧）：
        //  `blinkTo` 只在触发侧的上下文里接线。
        this.register('charge_shield', 'none');
        this.register('legacy_dash', 'none');
        //  2026-11-18 第 16 批：风炮菇（68013）的一对主动，一条「命中留区域」、一条「落点引爆」。
        //  · `wind_bolt`（孢爆箭 101303）—— 射一枚慢速风弹（70 逻辑 px/s、4 秒寿命），
        //    命中单体后**在原地留一片 3 秒飓风**（每个接触到的敌人只挨一次）。
        //    上一版（第 12 批）借的是 `splash_shot`：命中点周围均等溅射。设计改口径后
        //    两者差得太多（单体 + 持续区域 vs 一次性旁溅），保留 `splash_shot` 那条车道不动，
        //    这里另开一条 —— 两条键共用一套壳子的话，「有没有飓风」会退化成「参数在不在」，
        //    读表的人就分不清「这行忘了配半径」还是「这行本来就不留区域」。
        //    推进在 `ZCSkillTriggerSystem.applyWindShot`，发弹在
        //    `ZCAttackResolutionSystem.castWindBolt`，区域在 `resolveProjectileHit` 里留下来。
        //  · `missile_barrage`（连射导弹 101304）—— 累计 10 次普攻放一轮 3 颗抛物线炸弹，
        //    只走落点、途中不碰人（`ignoresMidAirCollision`），落点半径 180 一次性结算。
        //    与 `random_strike` 的导弹分支（镭射飞龙 101003）不是一回事：那条是「挑 N 人各发一颗、
        //    途中撞到谁就打谁」，这条是「三颗都砸向同一片区域、过程完全透明」。
        //    推进在 `ZCSkillTriggerSystem.applyMissileBarrage`，发弹在
        //    `ZCAttackResolutionSystem.castBarrageShot`，落地结算在 `resolveProjectileArrival`。
        this.register('wind_bolt', 'none');
        this.register('missile_barrage', 'none');
        //  2026-11-18 第 17 批：按「累计普攻 N 次」触发的自我增益。
        //  · `counter_self_buff`（窝瓜人「生命爆发」101904 / 爆锤莲王「战神附体」102704）——
        //    打满 N 次普攻后给自己挂一段限时增益（移速 / 攻击 / 生命上限 / **体型**），
        //    可以顺带回一口血。
        //  为什么不在 `empowered_attack` 里加：那条车道加的是「**下一击**长什么样」
        //  （护盾、连发、多方向），出手即消耗；这里要的是「**一段时间内**我一直变大变强」，
        //  与出手无关。也不复用 `self_cast`：那条的触发口径写死是冷却秒数，
        //  设计案这两条都是「累计普攻」（J 列 = 10），硬套等于把 J 列改掉。
        //  推进在 `ZCSkillTriggerSystem.applyCounterBuff`，增益一律走状态系统的 `statMods`
        //  （与 `self_cast` 同一个 `selfCastStatusId` 词缀签名，同数值复用同一条定义）。
        this.register('counter_self_buff', 'none');
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

/** 从绑定行/计划行上取两种状态 id；`passive_status` 走常驻槽，其余走命中槽。*/
function runtimeStatusOf(binding: ZCSkillBinding): Pick<ZCSkillRuntimeDefinition, 'statusId' | 'passiveStatusId'> {
    const statusId = typeof binding.statusId === 'string' && binding.statusId.trim()
        ? binding.statusId.trim() : undefined;
    if (!statusId) return {};
    return binding.behaviorKey === 'passive_status'
        ? { passiveStatusId: statusId }
        : { statusId };
}

