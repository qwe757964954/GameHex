import { HEX_GRID_LOGICAL_ROW_STEP } from '../../../../core/hex/HexGridLayout';
import { ZCCombatEventType, type ZCUnitDefinition } from '../ZCCombatCatalog';
import {
    ZC_SELF_AURA_EFFECT_PREFAB_PATH, ZC_SELF_AURA_BEHAVIOR_KEY, zcSelfAuraEffectPath,
    ZC_SELF_AURA_LANDING_ANGLE_DEGREES, ZC_SELF_AURA_LANDING_SECONDS, zcSelfAuraLandingPath,
} from '../ZCSelfAuraFx';
import { ZC_BOLT_EFFECT_PREFAB_PATH, ZC_BOLT_EFFECT_SECONDS, ZC_BOLT_NUMB_STATUS_ID } from '../ZCBoltStrikeFx';
import {
    ZC_CHAIN_EFFECT_PREFAB_PATH, ZC_CHAIN_EFFECT_SECONDS,
    zcChainArcPieceLayout, zcChainEffectAlpha,
} from '../ZCChainLightningFx';
import {
    ZC_SPLASH_SHOT_IMPACT_PREFAB_PATH, ZC_SPLASH_SHOT_MISSILE_PREFAB_PATH,
} from '../ZCSplashShotFx';
import { ZC_BURST_IMPACT_PREFAB_PATH, zcBurstEffectScale } from '../ZCBurstFx';
import {
    ZC_FAN_SWEEP_BURSTS, ZC_FAN_SWEEP_BURST_DISTANCE_RATIO, ZC_FAN_SWEEP_BURST_RADIUS_RATIO,
    ZC_FAN_SWEEP_BURST_SPREAD,
} from '../ZCFanSweepFx';
import {
    ZC_DASH_GUARD_PREFAB_PATH, ZC_DASH_GUARD_SECONDS, pushDashGuardVisualEvent,
} from '../ZCDashFx';
import { ZC_STORM_PREFAB_PATH } from '../ZCStormFx';
import { ZC_RAY_BEAM_PREFAB_PATH, zcRayBeamEffectScale } from '../ZCRayBeamFx';
import { ZC_FIRE_ZONE_PREFAB_PATH, ZC_FIRE_ZONE_TINT } from '../ZCFireZoneFx';
import {
    ZC_BARRAGE_IMPACT_PREFAB_PATH, ZC_BARRAGE_MISSILE_PREFAB_PATH,
    ZC_BARRAGE_SCATTER_RADIUS, ZC_BARRAGE_FLIGHT_SPEED,
    ZC_WIND_BOLT_PREFAB_PATH, ZC_WIND_HURRICANE_PREFAB_PATH,
    zcBarrageFlightSeconds, zcBarrageImpactScale,
} from '../ZCWindBarrageFx';
import {
    ZC_TRAP_EXPIRE_SECONDS, zcTrapExpirePath,
    ZC_TRAP_IDLE_PREFAB_PATH, ZC_TRAP_SPAWN_PREFAB_PATH, ZC_TRAP_SPAWN_SECONDS,
} from '../ZCTrapFx';
import { missileLog } from '../../ZCMissileSkillDiagnostics';
import { skillCastLog, skillCastLogChanging, zcSkillCastWatched } from '../../ZCSkillCastDiagnostics';
import type { ZCCombatTarget, ZCSnapshot, ZCUnitState } from '../ZCGameTypes';
import { ZCOwner } from '../ZCMapConfig';
import { ZC_PROJECTILE_MISS_DISTANCE, ZCCombatSystem } from './ZCCombatSystem';
import { ZCTargetingSystem } from './ZCTargetingSystem';
import {
    ZCAttackResolutionSystem,
    damageFloatTextKind,
    distance,
    type IZCAttackResolutionContext,
    type IZCStrikeOptions,
    type IZCChargeDashOptions,
} from './ZCAttackResolutionSystem';

const ZC_STORM_GROW_FROM = 0.1;
const ZC_TRAP_FLIGHT_ARC_PX = 92;

/**
 * 战场主动技能与光环结算系统 (ZCSkillResolutionSystem)
 *
 * 职责划分 (MVC - Model 领域层):
 * 1. 专注承接与结算战场中英雄与怪物的 20+ 种异构主动技能与光环增益（扇形射击、自身光环、落雷连线、
 *    闪电链、陷阱/蘑菇、溅射投射物、飓风召唤、多段弹幕、菌核爆裂、战吼、射线集束、文明之火、
 *    扇形甩击、冲锋、多点打击及全队/自身护盾与光环等）。
 * 2. 纯逻辑领域系统：只对战斗快照状态（ZCSnapshot）进行受限变更并派发 ZCCombatEvent 战斗事件，
 *    绝不持有或调用 Cocos 视图层/引擎节点。
 * 3. 严格遵循战斗数值与规则不变量：
 *    - 统一伤害与暴击计算：baseDamage * criticalMultiplier
 *    - 职业克制乘数：基于攻防双方卡牌与全局克制规则计算，支持目标单位实例的防御降级回退
 *    - 鞭尸防护：对已阵亡（hp <= 0 或 battleState === 'dead'）的目标进行严格过滤拦截
 *    - 战斗高频性能保障：消除热点路径上的闭包临时对象分配，数组随机抽取采用 O(1) swap-pop
 */
/**
 * 战场主动技能与光环结算系统 (ZCSkillResolutionSystem)
 *
 * 职责划分 (MVC - Model 领域层):
 * 1. 专注承接与结算战场中英雄与怪物的 20+ 种异构主动技能与光环增益（扇形射击、自身光环、落雷连线、
 *    闪电链、陷阱/蘑菇、溅射投射物、飓风召唤、多段弹幕、菌核爆裂、战吼、射线集束、文明之火、
 *    扇形甩击、冲锋、多点打击及全队/自身护盾与光环等）。
 * 2. 纯逻辑领域系统：只对战斗快照状态（ZCSnapshot）进行受限变更并派发 ZCCombatEvent 战斗事件，
 *    绝不持有或调用 Cocos 视图层/引擎节点。
 * 3. 严格遵循战斗数值与规则不变量：
 *    - 统一伤害与暴击计算：baseDamage * criticalMultiplier
 *    - 职业克制乘数：基于攻防双方卡牌与全局克制规则计算，支持目标单位实例的防御降级回退
 *    - 鞭尸防护：对已阵亡（hp <= 0 或 battleState === 'dead'）的目标进行严格过滤拦截
 *    - 战斗高频性能保障：消除热点路径上的闭包临时对象分配，数组随机抽取采用 O(1) swap-pop
 */
export class ZCSkillResolutionSystem {
    /**
     * 副轨主动技能：朝当前目标方向清一次扇形区域（伤害 + 击退 + 表现事件）。
     *
     * 特性与约束：
     * - 属于副轨独立释放通道，不推进主攻击轨普攻节拍。
     * - 具备施法前提校验：若未配置副轨参数或当前无合法目标，返回 false（调用方不扣除技能 CD）。
     *
     * @param state 战斗运行时快照
     * @param unit 施法单位状态
     * @param context 攻击与数值上下文
     * @returns 是否成功释放
     */
    static castFanSkill(state: ZCSnapshot, unit: ZCUnitState,
        context: IZCAttackResolutionContext): boolean {
        const definition = context.effectiveDefinition(unit);
        const profile = definition.attackProfile;
        const parameters = ZCAttackResolutionSystem.skillParamsOf(unit, profile.skillId, context);
        if (!parameters || !(Math.max(0, parameters.secondaryCooldown ?? 0) > 0)) return false;
        const activeProfile = definition.secondaryProfile;
        if (!activeProfile) return false;
        const target = context.currentTarget(unit);
        if (!target) return false;
        const origin = context.unitPosition(unit);
        const heading = Math.abs(target.x - origin.x) + Math.abs(target.y - origin.y) > 1e-9
            ? Math.atan2(target.y - origin.y, target.x - origin.x)
            : unit.facingRadians;
        const reach = ZCTargetingSystem.attackReach(
            definition, definition.bodyRadius, context.rules.combatDistanceScale);
        const radius = Math.max(1, reach * Math.max(0.1, parameters.secondaryRadiusScale ?? 1.4));
        const halfAngle = Math.max(0, Math.min(180, parameters.secondaryFanDeg ?? 120)) * Math.PI / 360;
        const skillDamageRate = Math.max(0, parameters.secondaryDamageRate ?? 1);
        const knockbackCells = Math.max(0, parameters.secondaryKnockback ?? 0);
        const appliesHitStatus = (parameters.secondaryAppliesHitStatus ?? 0) > 0;
        const runtime = ZCAttackResolutionSystem.skillRuntimeOf(unit, profile.skillId, context);
        const onHitStatusId = appliesHitStatus
            ? ((runtime ? runtime.statusId : undefined) ?? activeProfile.onHitStatusId)
            : activeProfile.onHitStatusId;
        const targetOwner = ZCAttackResolutionSystem.targetOwner(state, target, context);
        const targetUnitId = target.kind === 'unit' ? target.id : undefined;
        const criticalMultiplier = ZCAttackResolutionSystem.criticalMultiplier(unit, context);
        const damage = Math.round(ZCAttackResolutionSystem.unitDamage(context, unit, targetOwner, target.cardId, skillDamageRate,
            targetUnitId) * criticalMultiplier);
        const counterMultiplier = ZCAttackResolutionSystem.counterMultiplierFor(
            unit, targetOwner, target.cardId, context, targetUnitId);
        const floatTextKind = damageFloatTextKind(criticalMultiplier > 1, counterMultiplier);
        state.combatEvents.push({
            id: state.nextCombatEventId++,
            type: ZCCombatEventType.Area,
            owner: unit.owner,
            sourceUnitId: unit.id,
            targetUnitId: target.kind === 'unit' ? target.id : null,
            skillId: activeProfile.skillId,
            skillName: activeProfile.name,
            effectKey: activeProfile.effectKey ?? null,
            projectileKey: null,
            effectPrefabPath: activeProfile.effectPrefabPath ?? null,
            fromX: origin.x,
            fromY: origin.y,
            toX: origin.x,
            toY: origin.y,
            radius,
            damage,
            empowered: false,
            startedAt: state.elapsedSeconds,
            durationSeconds: 0.3,
        });
        const hitTargets = state.units.filter((candidate) => {
            if (candidate.owner === unit.owner || candidate.battleState === 'dead' || candidate.hp <= 0) return false;
            const pos = context.unitPosition(candidate);
            const dx = pos.x - origin.x, dy = pos.y - origin.y;
            const dist = Math.hypot(dx, dy);
            if (dist > radius) return false;
            if (dist <= 1e-6) return true;
            const delta = Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - heading),
                Math.cos(Math.atan2(dy, dx) - heading)));
            return delta <= halfAngle;
        });
        for (const victim of hitTargets) {
            const hitText = context.damageUnit(victim, damage, {
                owner: unit.owner, kind: 'unit', unitId: unit.id, floatTextKind,
            });
            ZCAttackResolutionSystem.applyLifesteal(unit, hitText, context);
            context.tryExecuteUnit(victim, undefined, unit.owner, unit.id, hitText);
            if (onHitStatusId) context.applyHitStatus(victim, onHitStatusId, unit.id);
            if (knockbackCells > 0 && victim.hp > 0) {
                context.applyKnockback(victim, unit, knockbackCells * HEX_GRID_LOGICAL_ROW_STEP);
            }
        }
        return true;
    }

    /**
     * 自身光环技能：在施法者脚下（或指定目标点）生成跟随/站桩的周期性范围伤害区域。
     *
     * 特性与约束：
     * - 支持站桩或随单位位移（followUnitId），支持矩形或圆形伤害判定。
     * - 校验 radius、seconds、damageRate 等参数合法性，不满足时不产生区域、不扣 CD。
     * - 落地时若有专属美术配置，会额外派发 Area 落地表现事件。
     *
     * @param state 战斗运行时快照
     * @param unit 施法单位状态
     * @param context 攻击与数值上下文
     * @returns 是否成功激活光环区域
     */
    static castSelfAura(state: ZCSnapshot, unit: ZCUnitState,
        context: IZCAttackResolutionContext): boolean {
        const definition = context.effectiveDefinition(unit);
        const profile = definition.attackProfile;
        const runtime = ZCAttackResolutionSystem.skillRuntimeOf(unit, profile.skillId, context);
        if (!runtime || !runtime.parameters) return false;
        const parameters = runtime.parameters;
        const radius = Math.max(0, parameters.auraRadius ?? 0) * context.rules.combatDistanceScale;
        const seconds = Math.max(0, parameters.auraSeconds ?? 0);
        const interval = Math.max(0.05, parameters.auraInterval ?? 1);
        const damageRate = Math.max(0, parameters.auraDamageRate ?? 0);
        const atTarget = (parameters.auraAtTarget ?? 0) > 0;
        if (!(radius > 0) || !(seconds > 0) || !(damageRate > 0)) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`selfaura-params:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} 自身光环（${profile.name}）参数不全：`
                    + `radius=${radius}（表值 ${parameters.auraRadius ?? 'undefined'}）`
                    + ` seconds=${seconds} damageRate=${damageRate} ⇒ 不开区域、不消费 CD`);
            }
            return false;
        }

        const target = context.currentTarget(unit);
        if (atTarget && !target) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`selfaura-losttarget:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} 自身光环（${profile.name}）要求落在受击目标身上，`
                    + '但当前没有目标 ⇒ 不开区域、不消费 CD');
            }
            return false;
        }
        const targetOwner = target ? ZCAttackResolutionSystem.targetOwner(state, target, context) : unit.owner;
        const targetCardId = target ? target.cardId : null;
        const targetUnitId = target && target.kind === 'unit' ? target.id : undefined;
        const criticalMultiplier = ZCAttackResolutionSystem.criticalMultiplier(unit, context);
        const damage = Math.round(
            ZCAttackResolutionSystem.unitDamage(context, unit, targetOwner, targetCardId, damageRate, targetUnitId) * criticalMultiplier);
        const counterMultiplier = target
            ? ZCAttackResolutionSystem.counterMultiplierFor(unit, ZCAttackResolutionSystem.targetOwner(state, target, context), target.cardId, context, targetUnitId)
            : 1;
        const floatTextKind = damageFloatTextKind(criticalMultiplier > 1, counterMultiplier);
        const waves = Math.max(1, Math.round(seconds / interval + 1e-6));
        const origin = context.unitPosition(unit);
        const forward = Math.max(0, parameters.auraForward ?? 0) * context.rules.combatDistanceScale;
        const faceTarget = (parameters.auraFaceTarget ?? 0) > 0;
        const targetPos = faceTarget && target ? { x: target.x, y: target.y } : null;
        const aimRadians = targetPos && (targetPos.x !== origin.x || targetPos.y !== origin.y)
            ? Math.atan2(targetPos.y - origin.y, targetPos.x - origin.x)
            : unit.facingRadians;
        const atTargetPoint = atTarget && target ? { x: target.x, y: target.y } : null;
        const spawnX = atTargetPoint
            ? atTargetPoint.x
            : (forward > 0 ? origin.x + Math.cos(aimRadians) * forward : origin.x);
        const spawnY = atTargetPoint
            ? atTargetPoint.y
            : (forward > 0 ? origin.y + Math.sin(aimRadians) * forward : origin.y);
        const angleDegrees = targetPos ? aimRadians * 180 / Math.PI : undefined;
        const visualLiftPx = Math.max(0, parameters.auraVisualLiftPx ?? 0);
        const follow = !atTarget && (parameters.auraFollow ?? 1) > 0;
        const followForward = follow && forward > 0 ? forward : 0;
        const waveMaxTargets = Math.max(0, Math.round(parameters.auraWaveMaxTargets ?? 0));
        const casterLiftPx = Math.max(0, parameters.casterLiftPx ?? 0);
        const rectHalfHeight = Math.max(0, parameters.auraRectHalfHeight ?? 0)
            * context.rules.combatDistanceScale;
        const rectHalfLength = rectHalfHeight > 0
            ? Math.max(0, parameters.auraRectHalfLength ?? 0) * context.rules.combatDistanceScale || radius
            : 0;
        const slowRatio = Math.max(0, Math.min(1, parameters.auraSlowRatio ?? 0));
        state.groundZones.push({
            x: spawnX,
            y: spawnY,
            radius,
            owner: unit.owner,
            sourceUnitId: unit.id,
            skillId: profile.skillId,
            skillName: profile.name,
            effectPrefabPath: zcSelfAuraEffectPath(ZC_SELF_AURA_BEHAVIOR_KEY, unit.unitId)
                ?? ZC_SELF_AURA_EFFECT_PREFAB_PATH,
            remainingSeconds: seconds,
            wavesLeft: waves,
            nextWaveAt: state.elapsedSeconds,
            waveInterval: interval,
            damage,
            floatTextKind,
            slowRatio,
            holdVisual: true,
            growSeconds: 0.2,
            followUnitId: follow ? unit.id : undefined,
            followForward: followForward > 0 ? followForward : undefined,
            waveMaxTargets: waveMaxTargets > 0 ? waveMaxTargets : undefined,
            casterLiftPx: casterLiftPx > 0 ? casterLiftPx : undefined,
            rectHalfLength: rectHalfLength > 0 ? rectHalfLength : undefined,
            rectHalfHeight: rectHalfHeight > 0 ? rectHalfHeight : undefined,
            angleDegrees,
            visualLiftPx: visualLiftPx > 0 ? visualLiftPx : undefined,
        });
        const landingPath = zcSelfAuraLandingPath(ZC_SELF_AURA_BEHAVIOR_KEY, unit.unitId);
        if (landingPath) {
            state.combatEvents.push({
                id: state.nextCombatEventId++,
                type: ZCCombatEventType.Area,
                owner: unit.owner,
                sourceUnitId: unit.id,
                targetUnitId,
                skillId: profile.skillId,
                skillName: profile.name,
                effectKey: null,
                projectileKey: null,
                effectPrefabPath: landingPath,
                fromX: spawnX,
                fromY: spawnY,
                toX: spawnX,
                toY: spawnY,
                radius: 1,
                damage: 0,
                empowered: false,
                startedAt: state.elapsedSeconds,
                durationSeconds: ZC_SELF_AURA_LANDING_SECONDS,
                angleDegrees: ZC_SELF_AURA_LANDING_ANGLE_DEGREES,
            });
        }
        if (zcSkillCastWatched(unit.unitId)) {
            skillCastLog('施法', `${unit.unitId}#${unit.id} 在 (${origin.x.toFixed(1)}, ${origin.y.toFixed(1)})`
                + ` 开出【${profile.name}】：半径 ${radius.toFixed(1)} 世界px（表值 ${parameters.auraRadius}）`
                + (rectHalfHeight > 0
                    ? `，矩形判定 ${(rectHalfLength * 2).toFixed(1)}×${(rectHalfHeight * 2).toFixed(1)} 世界px`
                    : '')
                + `，${seconds}s × 每 ${interval}s = ${waves} 波，单跳 ${damage}，`
                + (atTargetPoint
                    ? `落点在受击目标 #${targetUnitId ?? '?'}`
                        + ` (${atTargetPoint.x.toFixed(1)}, ${atTargetPoint.y.toFixed(1)})、不跟随本体`
                    : (follow
                        ? (followForward > 0 ? `跟随本体 #${unit.id}、身前 ${followForward.toFixed(1)} 世界px` : `跟随本体 #${unit.id}`)
                        : '站桩（不跟随本体）')));
        }
        return true;
    }

    /**
     * 落雷连线技能（五雷轰顶）：在目标方向生成一条按间隔依次落下的雷击地面区域序列。
     *
     * 特性与约束：
     * - 每道雷产生一个独立的单波（wavesLeft=1）地面区域，并带有逐道延迟与麻痹判定。
     * - 统一计算克制乘数与暴击乘数，保证各道落雷伤害与飘字类型一致。
     *
     * @param state 战斗运行时快照
     * @param unit 施法单位状态
     * @param context 攻击与数值上下文
     * @returns 是否成功施法
     */
    static castBoltLine(state: ZCSnapshot, unit: ZCUnitState,
        context: IZCAttackResolutionContext): boolean {
        const definition = context.effectiveDefinition(unit);
        const profile = definition.attackProfile;
        const parameters = ZCAttackResolutionSystem.skillParamsOf(unit, profile.skillId, context);
        if (!parameters) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`bolt-params:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} 五雷轰顶参数不全：count=0 damageRate=0`
                    + ` radius=0 ⇒ 不放雷、不消费 CD`);
            }
            return false;
        }
        const count = Math.max(0, Math.round(parameters.boltCount ?? 0));
        const damageRate = Math.max(0, parameters.boltDamageRate ?? 0);
        const radiusTable = Math.max(0, parameters.boltRadius ?? 0);
        if (!(count >= 1) || !(damageRate > 0) || !(radiusTable > 0)) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`bolt-params:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} 五雷轰顶参数不全：count=${count} damageRate=${damageRate}`
                    + ` radius=${radiusTable} ⇒ 不放雷、不消费 CD`);
            }
            return false;
        }
        const target = context.currentTarget(unit);
        if (!target) return false;
        const scale = context.rules.combatDistanceScale;
        const radius = radiusTable * scale;
        const spacing = Math.max(0, parameters.boltSpacing ?? 0) * scale;
        const interval = Math.max(0.02, parameters.boltInterval ?? 0.1);
        const delay = Math.max(0, parameters.boltDelay ?? 0.15);
        const numbChance = Math.max(0, Math.min(1, parameters.boltNumbChance ?? 0));
        const numbSeconds = Math.max(0, parameters.boltNumbSeconds ?? 0);
        const origin = context.unitPosition(unit);
        const dx = target.x - origin.x;
        const dy = target.y - origin.y;
        const length = Math.hypot(dx, dy);
        const dirX = length > 1e-6 ? dx / length : Math.cos(unit.facingRadians);
        const dirY = length > 1e-6 ? dy / length : Math.sin(unit.facingRadians);
        const criticalMultiplier = ZCAttackResolutionSystem.criticalMultiplier(unit, context);
        const counterMultiplier = ZCAttackResolutionSystem.counterMultiplierFor(
            unit, ZCAttackResolutionSystem.targetOwner(state, target, context), target.cardId, context,
            target.kind === 'unit' ? target.id : undefined);
        const damage = Math.round(ZCAttackResolutionSystem.unitDamage(context, unit,
            ZCAttackResolutionSystem.targetOwner(state, target, context), target.cardId, damageRate,
            target.kind === 'unit' ? target.id : undefined) * criticalMultiplier);
        const floatTextKind = damageFloatTextKind(criticalMultiplier > 1, counterMultiplier);
        for (let index = 0; index < count; index += 1) {
            const x = target.x + dirX * spacing * index;
            const y = target.y + dirY * spacing * index;
            const waveAt = state.elapsedSeconds + index * interval + delay;
            state.combatEvents.push({
                id: state.nextCombatEventId++,
                type: ZCCombatEventType.Area,
                owner: unit.owner,
                sourceUnitId: unit.id,
                targetUnitId: target.kind === 'unit' ? target.id : null,
                skillId: profile.skillId,
                skillName: profile.name,
                effectKey: null,
                projectileKey: null,
                effectPrefabPath: ZC_BOLT_EFFECT_PREFAB_PATH,
                fromX: x,
                fromY: y,
                toX: x,
                toY: y,
                radius,
                damage,
                empowered: false,
                startedAt: state.elapsedSeconds + index * interval,
                durationSeconds: delay + ZC_BOLT_EFFECT_SECONDS,
            });
            state.groundZones.push({
                x, y, radius,
                owner: unit.owner,
                sourceUnitId: unit.id,
                skillId: profile.skillId,
                skillName: profile.name,
                effectPrefabPath: null,
                remainingSeconds: index * interval + delay + 0.3,
                wavesLeft: 1,
                nextWaveAt: waveAt,
                waveInterval: interval,
                damage,
                floatTextKind,
                slowRatio: 0,
                hitStatusId: numbChance > 0 ? ZC_BOLT_NUMB_STATUS_ID : undefined,
                hitStatusChance: numbChance > 0 ? numbChance : undefined,
                hitStatusSeconds: numbSeconds > 0 ? numbSeconds : undefined,
            });
        }
        if (zcSkillCastWatched(unit.unitId)) {
            skillCastLog('施法', `${unit.unitId}#${unit.id} 放【五雷轰顶】：${count} 道，`
                + `间距 ${spacing.toFixed(1)}（表值 ${parameters.boltSpacing}）`
                + `，逐道 ${interval}s、延迟 ${delay}s 判伤，单道 ${damage}`
                + `，麻痹 ${(numbChance * 100).toFixed(0)}% / ${numbSeconds}s`);
        }
        return true;
    }

    /**
     * 闪电链技能（雷蕉 68022 / 102203）：首跳命中目标后在跳跃半径内寻找下一最近敌人连续弹射。
     *
     * 特性与约束：
     * - 【P0-2 修复】：向 counterMultiplierFor 传入 victim.cardId 计算克制，彻底修复传 unitId 导致克制失效缺陷。
     * - 【GC 优化】：首目标寻址采用 context.unitById.get(target.id) O(1) 检索，替代全场线性遍历与闭包。
     * - 首跳全额伤害，后续每一跳按 falloff 递减，终跳保证暴击。
     * - 命中判定时对麻痹几率进行随机检定，对每一跳受击者通过 pushChainArc 派发电弧表现事件。
     *
     * @param state 战斗运行时快照
     * @param unit 施法单位状态
     * @param context 攻击与数值上下文
     * @returns 是否成功施法
     */
    static castChainLightning(state: ZCSnapshot, unit: ZCUnitState,
        context: IZCAttackResolutionContext): boolean {
        const definition = context.effectiveDefinition(unit);
        const profile = definition.attackProfile;
        const parameters = ZCAttackResolutionSystem.skillParamsOf(unit, profile.skillId, context);
        if (!parameters) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`chain-params:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} 闪电链参数不全：count=0`
                    + ` damageRate=0 jumpRadius=0 ⇒ 不出手、不消费 CD`);
            }
            return false;
        }
        const count = Math.max(0, Math.round(parameters.chainTargetCount ?? 0));
        const damageRate = Math.max(0, parameters.chainDamageRate ?? 0);
        const jumpTable = Math.max(0, parameters.chainJumpRadius ?? 0);
        const falloff = Math.max(0, Math.min(1, parameters.chainFalloff ?? 0));
        const finalCritMultiplier = Math.max(1, parameters.chainFinalCritMultiplier ?? 1);
        if (!(count >= 1) || !(damageRate > 0) || !(jumpTable > 0)) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`chain-params:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} 闪电链参数不全：count=${count}`
                    + ` damageRate=${damageRate} jumpRadius=${jumpTable} ⇒ 不出手、不消费 CD`);
            }
            return false;
        }
        const jumpRadius = jumpTable * context.rules.combatDistanceScale;
        const target = context.currentTarget(unit);
        let firstUnit = target && target.kind === 'unit'
            ? context.unitById.get(target.id)
            : undefined;
        if (!firstUnit && target && target.kind !== 'unit') {
            const fallback = this.stormDeliveryTarget(unit, context.unitPosition(unit), context, definition, context.rules.combatDistanceScale);
            if (fallback) firstUnit = context.unitById.get(fallback.id);
        }
        if (!firstUnit || firstUnit.battleState === 'dead' || firstUnit.hp <= 0) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`chain-target:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} 闪电链没有活着的单位目标 ⇒ 不消费 CD，下帧重试`);
            }
            return false;
        }
        const victims: ZCUnitState[] = [firstUnit];
        const hitIds = new Set<number>([firstUnit.id]);
        let cursor = 0;
        while (cursor < victims.length && victims.length < count) {
            const center = context.unitPosition(victims[cursor]);
            cursor += 1;
            for (const candidate of state.units) {
                if (victims.length >= count) break;
                if (candidate.owner === unit.owner || candidate.battleState === 'dead' || candidate.hp <= 0) continue;
                if (hitIds.has(candidate.id)) continue;
                const pos = context.unitPosition(candidate);
                if (Math.hypot(pos.x - center.x, pos.y - center.y) > jumpRadius) continue;
                victims.push(candidate);
                hitIds.add(candidate.id);
            }
        }
        const origin = context.unitPosition(unit);
        const rolledCrit = ZCAttackResolutionSystem.criticalMultiplier(unit, context);
        for (let index = 0; index < victims.length; index += 1) {
            const victim = victims[index];
            const criticalMultiplier = index === victims.length - 1
                ? Math.max(rolledCrit, finalCritMultiplier)
                : rolledCrit;
            // 修复 P0-2：传 victim.cardId 作为 targetCardId
            const counterMultiplier = ZCAttackResolutionSystem.counterMultiplierFor(
                unit, victim.owner, victim.cardId, context, victim.id);
            const damage = Math.round(ZCAttackResolutionSystem.unitDamage(context, unit, victim.owner, victim.cardId,
                damageRate * Math.pow(1 - falloff, index), victim.id) * criticalMultiplier);
            const floatTextKind = damageFloatTextKind(criticalMultiplier > 1, counterMultiplier);
            const hitText = context.damageUnit(victim, damage, {
                owner: unit.owner, kind: 'unit', unitId: unit.id, floatTextKind,
            });
            ZCAttackResolutionSystem.applyLifesteal(unit, hitText, context);
            context.tryExecuteUnit(victim, undefined, unit.owner, unit.id, hitText);
        }
        // ── 表现：从卡牌中心起，逐个目标铺电弧（2026-11-19 第 21 批示意图口径）──
        const points = victims.map((victim) => context.unitPosition(victim));
        const anchors = [unit.id, ...victims.map((victim) => victim.id)];
        const ends = [origin, ...points];
        for (let index = 1; index < ends.length; index += 1) {
            const previous = index >= 2 ? ends[index - 2] : null;
            const from = ends[index - 1];
            const fallbackRadians = previous
                ? Math.atan2(from.y - previous.y, from.x - previous.x)
                : unit.facingRadians;
            this.pushChainArc(state, unit, profile,
                anchors[index - 1], anchors[index],
                from, ends[index],
                fallbackRadians, zcChainEffectAlpha(index - 1));
        }
        if (zcSkillCastWatched(unit.unitId)) {
            skillCastLogChanging(`chain-cast:${unit.id}`, '施法',
                `${unit.unitId}#${unit.id} 放出【${profile.name}】：${victims.length}/${count} 个、`
                + `传导半径 ${jumpTable} 表值 px（世界 ${jumpRadius.toFixed(1)}）、`
                + `首跳 ${damageRate}、每跳 ×${(1 - falloff).toFixed(2)}`
                + (finalCritMultiplier > 1 ? `、终跳至少 ×${finalCritMultiplier}` : ''));
        }
        return true;
    }

    /**
     * 派发闪电链视觉电弧表现事件（分段多边形电弧）。
     *
     * 特性与约束：
     * - 计算起始单位到终点单位之间的角度与分段偏移（zcChainArcPieceLayout）。
     * - 循环推入 Area 类型战斗事件，供表现层电弧节点平滑拉伸呈现。
     */
    /**
     * 派发闪电链视觉电弧表现事件（分段多边形电弧）。
     *
     * 特性与约束：
     * - 计算起始单位到终点单位之间的角度与分段偏移（zcChainArcPieceLayout）。
     * - 循环推入 Area 类型战斗事件，供表现层电弧节点平滑拉伸呈现。
     */
    private static pushChainArc(
        state: ZCSnapshot,
        unit: ZCUnitState,
        profile: import('../ZCCombatCatalog').ZCAttackProfile,
        fromUnitId: number,
        toUnitId: number,
        from: { x: number; y: number },
        to: { x: number; y: number },
        fallbackRadians: number,
        alpha: number,
    ): void {
        const layout = zcChainArcPieceLayout(from.x, from.y, to.x, to.y, fallbackRadians);
        for (let piece = 0; piece < layout.count; piece += 1) {
            const x = from.x + layout.stepX * piece + layout.offsetX;
            const y = from.y + layout.stepY * piece + layout.offsetY;
            state.combatEvents.push({
                id: state.nextCombatEventId++,
                type: ZCCombatEventType.Area,
                owner: unit.owner,
                sourceUnitId: unit.id,
                targetUnitId: null,
                skillId: profile.skillId,
                skillName: profile.name,
                effectKey: null,
                projectileKey: null,
                effectPrefabPath: ZC_CHAIN_EFFECT_PREFAB_PATH,
                fromX: x,
                fromY: y,
                toX: x,
                toY: y,
                radius: 0,
                damage: 0,
                empowered: false,
                startedAt: state.elapsedSeconds,
                durationSeconds: ZC_CHAIN_EFFECT_SECONDS,
                angleDegrees: layout.angleDegrees,
                effectAlpha: alpha,
                followFromUnitId: fromUnitId,
                followToUnitId: toUnitId,
                followPieceIndex: piece,
                followPieceCount: layout.count,
                stretchAlongAxis: layout.stretch,
            });
        }
    }

    /**
     * 精密陷阱 / 蘑菇爆炸技能：在目标点或自身脚下生成陷阱地面区域。
     *
     * 特性与约束：
     * - 支持原地生成或弧线投掷（带有 visualLiftPx 抛物线抬升视觉）。
     * - 敌人踩入触碰半径后触发引爆，对爆炸半径内所有敌方单位造成均等伤害与可选状态附加。
     *
     * @param state 战斗运行时快照
     * @param unit 施法单位状态
     * @param context 攻击与数值上下文
     * @returns 是否成功布置陷阱
     */
    static castTrap(state: ZCSnapshot, unit: ZCUnitState,
        context: IZCAttackResolutionContext): boolean {
        const definition = context.effectiveDefinition(unit);
        const profile = definition.attackProfile;
        const runtime = ZCAttackResolutionSystem.skillRuntimeOf(unit, profile.skillId, context);
        if (!runtime) return false;
        const parameters = runtime.parameters;
        const hitStatusId = runtime.statusId;
        const scale = context.rules.combatDistanceScale;
        const staySeconds = Math.max(0, parameters.trapDuration ?? 0);
        const contactTable = Math.max(0, parameters.trapRadius ?? 0);
        const contactRate = Math.max(0, parameters.trapDamageRate ?? 0);
        const explodeTable = Math.max(0, parameters.trapExplodeRadius ?? 0);
        const explodeRate = Math.max(0, parameters.trapExplodeDamageRate ?? 0);
        const flightSpeed = Math.max(0, parameters.trapFlightSpeed ?? 0);
        const flightSeconds = Math.max(0, parameters.trapFlightSeconds ?? 0);
        const flying = flightSpeed > 0 && flightSeconds > 0;
        const expireOnTimeout = (parameters.trapExpireOnTimeout ?? 1) > 0;
        if (!(staySeconds > 0) || !(contactTable > 0)
            || (!(contactRate > 0) && !flying)
            || !(explodeTable > 0) || !(explodeRate > 0)) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`trap-params:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} 精密陷阱参数不全：duration=${staySeconds}`
                    + ` contact=${contactTable}/${contactRate} explode=${explodeTable}/${explodeRate}`
                    + ` flight=${flightSpeed}/${flightSeconds} ⇒ 不放陷阱、不消费 CD`);
            }
            return false;
        }

        const target = context.currentTarget(unit);
        const targetOwner = target ? ZCAttackResolutionSystem.targetOwner(state, target, context) : unit.owner;
        const targetCardId = target ? target.cardId : null;
        const targetUnitId = target && target.kind === 'unit' ? target.id : undefined;
        const criticalMultiplier = ZCAttackResolutionSystem.criticalMultiplier(unit, context);
        const counterMultiplier = target
            ? ZCAttackResolutionSystem.counterMultiplierFor(unit, targetOwner, targetCardId, context, targetUnitId)
            : 1;
        const floatTextKind = damageFloatTextKind(criticalMultiplier > 1, counterMultiplier);
        const contactDamage = contactRate > 0
            ? Math.round(ZCAttackResolutionSystem.unitDamage(context, unit, targetOwner, targetCardId, contactRate,
                targetUnitId) * criticalMultiplier)
            : 0;
        const explodeDamage = Math.round(
            ZCAttackResolutionSystem.unitDamage(context, unit, targetOwner, targetCardId, explodeRate,
                targetUnitId) * criticalMultiplier);

        const origin = context.unitPosition(unit);
        const forward = Math.max(0, parameters.trapForward ?? 0) * scale;
        const x = forward > 0 ? origin.x + Math.cos(unit.facingRadians) * forward : origin.x;
        const y = forward > 0 ? origin.y + Math.sin(unit.facingRadians) * forward : origin.y;

        let velocityX = 0;
        let velocityY = 0;
        if (flying) {
            const dx = target ? target.x - x : 0;
            const dy = target ? target.y - y : 0;
            const radians = Math.hypot(dx, dy) > 0.0001
                ? Math.atan2(dy, dx)
                : unit.facingRadians;
            velocityX = Math.cos(radians) * flightSpeed * scale;
            velocityY = Math.sin(radians) * flightSpeed * scale;
        }

        state.groundZones.push({
            x, y,
            radius: explodeTable * scale,
            owner: unit.owner,
            sourceUnitId: unit.id,
            skillId: profile.skillId,
            skillName: profile.name,
            effectPrefabPath: ZC_TRAP_IDLE_PREFAB_PATH,
            holdVisual: true,
            flightVisualPath: flying ? ZC_TRAP_SPAWN_PREFAB_PATH : undefined,
            flightTotalSeconds: flying ? flightSeconds : undefined,
            flightArcPx: flying ? ZC_TRAP_FLIGHT_ARC_PX : undefined,
            visualDelaySeconds: flying ? 0 : ZC_TRAP_SPAWN_SECONDS,
            remainingSeconds: staySeconds + flightSeconds,
            wavesLeft: 0,
            nextWaveAt: state.elapsedSeconds + staySeconds + flightSeconds,
            waveInterval: Math.max(0.05, staySeconds + flightSeconds),
            flightSeconds: flying ? flightSeconds : undefined,
            moveVelocityX: flying ? velocityX : undefined,
            moveVelocityY: flying ? velocityY : undefined,
            expireRequiresContact: expireOnTimeout ? undefined : true,
            damage: 0,
            slowRatio: 0,
            floatTextKind,
            contactRadius: contactTable * scale,
            contactDamage,
            expireDamage: explodeDamage,
            expireStatusId: hitStatusId,
            expireStatusDuration: Math.max(0, parameters.trapStatusSeconds ?? 0) || undefined,
            expirePrefabPath: zcTrapExpirePath(unit.unitId),
            expireFxSeconds: ZC_TRAP_EXPIRE_SECONDS,
        });

        if (!flying) {
            state.combatEvents.push({
                id: state.nextCombatEventId++,
                type: ZCCombatEventType.Area,
                owner: unit.owner,
                sourceUnitId: unit.id,
                targetUnitId: targetUnitId ?? null,
                skillId: profile.skillId,
                skillName: profile.name,
                effectKey: null,
                projectileKey: null,
                effectPrefabPath: ZC_TRAP_SPAWN_PREFAB_PATH,
                fromX: x,
                fromY: y,
                toX: x,
                toY: y,
                radius: contactTable * scale,
                damage: 0,
                empowered: false,
                startedAt: state.elapsedSeconds,
                durationSeconds: ZC_TRAP_SPAWN_SECONDS,
            });
        }

        if (zcSkillCastWatched(unit.unitId)) {
            skillCastLog('施法', `${unit.unitId}#${unit.id} 放下【${profile.name}】：`
                + (flying
                    ? `投掷 ${flightSpeed}px/s × ${flightSeconds}s（${(flightSpeed * flightSeconds).toFixed(0)}px）`
                        + `、落地停留 ${staySeconds}s${expireOnTimeout ? '、到期自爆' : '、到期直接消失'}、`
                    : `存活 ${staySeconds}s、`)
                + `触碰 ${contactTable}px/${contactDamage}、`
                + `爆炸 ${explodeTable}px/${explodeDamage}（均等、无递减）`);
        }
        return true;
    }

    /**
     * 孢爆箭 / 孢子凝珠技能：朝锁定目标射出一枚高速溅射投射物。
     *
     * 特性与约束：
     * - 命中目标后原地引发范围溅射伤害，并可附带减速状态。
     * - 弹道飞行速度快，命中时派发 Splash 命中特效。
     *
     * @param state 战斗运行时快照
     * @param unit 施法单位状态
     * @param context 攻击与数值上下文
     * @param slowStatusId 可选的命中减速状态 ID
     * @returns 是否成功发射
     */
    static castSplashShot(state: ZCSnapshot, unit: ZCUnitState,
        context: IZCAttackResolutionContext, slowStatusId?: string): boolean {
        const definition = context.effectiveDefinition(unit);
        const profile = definition.attackProfile;
        const parameters = ZCAttackResolutionSystem.skillParamsOf(unit, profile.skillId, context);
        if (!parameters) return false;
        const damageRate = Math.max(0, parameters.shotDamageRate ?? 0);
        const splashTable = Math.max(0, parameters.shotRadius ?? 0);
        const splashRadius = splashTable * context.rules.combatDistanceScale;
        if (!(damageRate > 0) || !(splashRadius > 0)) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`splash-params:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} ${profile.name}（wind_bolt）参数不全：`
                    + `damageRate=${damageRate} shotRadius=${parameters.shotRadius ?? 'undefined'}`
                    + ` ⇒ 不出弹、不消费 CD`);
            }
            return false;
        }
        const reach = Math.max(1, ZCTargetingSystem.attackReach(
            definition, definition.bodyRadius, context.rules.combatDistanceScale));
        const target = context.currentTarget(unit);
        if (target) {
            const origin = context.unitPosition(unit);
            if (Math.hypot(target.x - origin.x, target.y - origin.y) > reach) return false;
        }
        const fired = this.strikeTargets(state, unit, {
            count: 1,
            radius: reach,
            damageRate,
            nearest: true,
            splashRadius,
            splashDamageRate: 1,
            splashFalloff: 0,
            statusId: slowStatusId,
            missilePrefabPath: ZC_SPLASH_SHOT_MISSILE_PREFAB_PATH,
            impactPrefabPath: ZC_SPLASH_SHOT_IMPACT_PREFAB_PATH,
        }, context);
        if (zcSkillCastWatched(unit.unitId)) {
            skillCastLogChanging(`splash-cast:${unit.id}`, '施法', fired > 0
                ? `${unit.unitId}#${unit.id} 射出【${profile.name}】：倍率 ${damageRate}、`
                + `爆点 ${splashTable} 表值 px（世界 ${splashRadius.toFixed(1)}）、`
                + `射程 ${reach.toFixed(1)}、减速=${slowStatusId ?? '无'}`
                : `${unit.unitId}#${unit.id} 射【${profile.name}】被拒：射程 ${reach.toFixed(1)} 内没有可打目标`
                + ` ⇒ 不消费 CD，下帧重试`);
        }
        return fired > 0;
    }

    /**
     * 孢爆风弹技能（新口径）：朝目标射出一枚慢速风暴弹，命中后在目标点驻留飓风区域。
     *
     * 特性与约束：
     * - 弹速较慢（慢速风弹），飞行过程中不穿透，命中单体后生成多波飓风伤害区域。
     *
     * @param state 战斗运行时快照
     * @param unit 施法单位状态
     * @param context 攻击与数值上下文
     * @returns 是否成功施法
     */
    static castWindBolt(state: ZCSnapshot, unit: ZCUnitState,
        context: IZCAttackResolutionContext): boolean {
        const definition = context.effectiveDefinition(unit);
        const profile = definition.attackProfile;
        const parameters = ZCAttackResolutionSystem.skillParamsOf(unit, profile.skillId, context);
        if (!parameters) return false;
        const damageRate = Math.max(0, parameters.windDamageRate ?? 0);
        const speedTable = Math.max(0, parameters.windSpeed ?? 0);
        const lifeSeconds = Math.max(0, parameters.windLifeSeconds ?? 0);
        const zoneRate = Math.max(0, parameters.windZoneDamageRate ?? 0);
        const zoneRadiusTable = Math.max(0, parameters.windZoneRadius ?? 0);
        const zoneSeconds = Math.max(0, parameters.windZoneSeconds ?? 0);
        if (!(damageRate > 0) || !(speedTable > 0) || !(lifeSeconds > 0)
            || !(zoneRate > 0) || !(zoneRadiusTable > 0) || !(zoneSeconds > 0)) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`wind-params:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} ${profile.name}（wind_bolt）参数不全：`
                    + `damageRate=${damageRate} speed=${speedTable} life=${lifeSeconds} `
                    + `zone=${zoneRadiusTable}/${zoneSeconds}/${zoneRate} ⇒ 不出弹、不消费 CD`);
            }
            return false;
        }
        const scale = context.rules.combatDistanceScale;
        const target = context.currentTarget(unit);
        if (!target) return false;
        const origin = context.unitPosition(unit);
        const reach = Math.max(1, ZCTargetingSystem.attackReach(definition, definition.bodyRadius, scale));
        const dx = target.x - origin.x;
        const dy = target.y - origin.y;
        const length = Math.hypot(dx, dy);
        if (length > reach) return false;
        const goal = target.kind === 'unit' ? context.unitById.get(target.id) : undefined;
        if (!goal) return false;
        const heading = length > 1e-9 ? Math.atan2(dy, dx) : unit.facingRadians;
        const speedWorld = Math.max(1e-3, speedTable * scale);
        context.pushProjectile({
            id: state.nextCombatEventId++,
            type: 'projectile',
            owner: unit.owner,
            sourceUnitId: unit.id,
            targetUnitId: target.kind === 'unit' ? target.id : null,
            skillId: profile.skillId,
            skillName: profile.name,
            effectKey: null,
            projectileKey: null,
            effectPrefabPath: ZC_WIND_BOLT_PREFAB_PATH,
            fromX: origin.x,
            fromY: origin.y,
            toX: target.x,
            toY: target.y,
            radius: 0,
            damage: 0,
            empowered: false,
            startedAt: state.elapsedSeconds,
            durationSeconds: lifeSeconds,
            targetKind: 'unit',
            targetId: goal.id,
            sourceCardId: unit.cardId,
            baseDamage: ZCAttackResolutionSystem.unitDamage(context, unit, goal.owner, goal.cardId, damageRate, goal.id),
            x: origin.x,
            y: origin.y,
            previousX: origin.x,
            previousY: origin.y,
            velocityX: Math.cos(heading) * speedWorld,
            velocityY: Math.sin(heading) * speedWorld,
            collisionRadius: (profile.collisionRadius ?? 3) * scale,
            canHitAir: definition.canAttackAir,
            remainingPierces: 0,
            hitUnitIds: [],
            hurricaneRadius: zoneRadiusTable * scale,
            hurricaneSeconds: zoneSeconds,
            hurricaneDamage: ZCAttackResolutionSystem.unitDamage(context, unit, goal.owner, goal.cardId, zoneRate, goal.id),
            hurricanePrefabPath: ZC_WIND_HURRICANE_PREFAB_PATH,
        });
        if (zcSkillCastWatched(unit.unitId)) {
            skillCastLogChanging(`wind-cast:${unit.id}`, '施法',
                `${unit.unitId}#${unit.id} 射出【${profile.name}】：倍率 ${damageRate}、`
                + `弹速 ${speedTable} 表值 px/s、寿命 ${lifeSeconds}s、`
                + `飓风 ${zoneRadiusTable} 表值 px / ${zoneSeconds}s / 每次 ${zoneRate}`);
        }
        return true;
    }

    /**
     * 连射导弹技能：向目标范围发射多枚抛物线范围炸弹。
     *
     * 特性与约束：
     * - 落点由目标当前坐标根据散布半径随机抖动生成，呈现乱弹轰炸效果。
     * - 每一枚炸弹落地时对爆炸半径内敌人结算范围伤害。
     *
     * @param state 战斗运行时快照
     * @param unit 施法单位状态
     * @param context 攻击与数值上下文
     * @returns 是否成功发射
     */
    static castBarrageShot(state: ZCSnapshot, unit: ZCUnitState,
        context: IZCAttackResolutionContext): boolean {
        const definition = context.effectiveDefinition(unit);
        const profile = definition.attackProfile;
        const parameters = ZCAttackResolutionSystem.skillParamsOf(unit, profile.skillId, context);
        if (!parameters) return false;
        const damageRate = Math.max(0, parameters.barrageDamageRate ?? 0);
        const radiusTable = Math.max(0, parameters.barrageRadius ?? 0);
        if (!(damageRate > 0) || !(radiusTable > 0)) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`barrage-params:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} 连射导弹（${profile.name}）参数不全：`
                    + `damageRate=${damageRate} radius=${radiusTable} ⇒ 不出弹、不记次数`);
            }
            return false;
        }
        const scale = context.rules.combatDistanceScale;
        const origin = context.unitPosition(unit);
        const reach = Math.max(1, ZCTargetingSystem.attackReach(definition, definition.bodyRadius, scale));
        const goal = this.barrageTarget(unit, reach, context);
        if (!goal) return false;
        const goalPosition = context.unitPosition(goal);
        const scatter = ZC_BARRAGE_SCATTER_RADIUS * scale;
        const angle = context.random() * Math.PI * 2;
        const spread = Math.sqrt(context.random()) * scatter;
        const landingX = goalPosition.x + Math.cos(angle) * spread;
        const landingY = goalPosition.y + Math.sin(angle) * spread;
        let dx = landingX - origin.x;
        let dy = landingY - origin.y;
        let length = Math.hypot(dx, dy);
        if (length < 1e-6) {
            dx = Math.cos(unit.facingRadians);
            dy = Math.sin(unit.facingRadians);
            length = 1;
        }
        const seconds = zcBarrageFlightSeconds(length, ZC_BARRAGE_FLIGHT_SPEED, scale);
        context.pushProjectile({
            id: state.nextCombatEventId++,
            type: 'projectile',
            owner: unit.owner,
            sourceUnitId: unit.id,
            targetUnitId: goal.id,
            skillId: profile.skillId,
            skillName: profile.name,
            effectKey: null,
            projectileKey: null,
            effectPrefabPath: ZC_BARRAGE_MISSILE_PREFAB_PATH,
            fromX: origin.x,
            fromY: origin.y,
            toX: landingX,
            toY: landingY,
            radius: 0,
            damage: 0,
            empowered: false,
            startedAt: state.elapsedSeconds,
            durationSeconds: seconds,
            targetKind: 'unit',
            targetId: goal.id,
            sourceCardId: unit.cardId,
            baseDamage: ZCAttackResolutionSystem.unitDamage(context, unit, goal.owner, goal.cardId, damageRate, goal.id),
            x: origin.x,
            y: origin.y,
            previousX: origin.x,
            previousY: origin.y,
            velocityX: (dx / length) * (length / seconds),
            velocityY: (dy / length) * (length / seconds),
            collisionRadius: (profile.collisionRadius ?? 3) * scale,
            canHitAir: definition.canAttackAir,
            remainingPierces: 0,
            hitUnitIds: [],
            ignoresMidAirCollision: true,
            explodeOnArrival: true,
            arriveRadius: radiusTable * scale,
            arriveDamage: ZCAttackResolutionSystem.unitDamage(context, unit, goal.owner, goal.cardId, damageRate, goal.id),
            impactEffectPrefabPath: ZC_BARRAGE_IMPACT_PREFAB_PATH,
            impactEffectScale: zcBarrageImpactScale(radiusTable),
            arcOffset: Math.max(0, spread) + 6,
        });
        if (zcSkillCastWatched(unit.unitId)) {
            skillCastLogChanging(`barrage-cast:${unit.id}`, '施法',
                `${unit.unitId}#${unit.id} 发射连射导弹：倍率 ${damageRate}、`
                + `爆炸 ${radiusTable} 表值 px、落点散布 ${ZC_BARRAGE_SCATTER_RADIUS} 表值 px、`
                + `飞行 ${seconds.toFixed(2)}s`);
        }
        return true;
    }

    /**
     * 连射导弹的目标选择辅助函数。
     * 优先复用当前锁定目标，若超出射程或无目标，则在六边形攻击范围内寻找最近的有效敌方单位。
     */
    /**
     * 连射导弹的目标选择辅助函数。
     * 优先复用当前锁定目标，若超出射程或无目标，则在六边形攻击范围内寻找最近的有效敌方单位。
     */
    private static barrageTarget(unit: ZCUnitState, reach: number,
        context: IZCAttackResolutionContext): ZCUnitState | null {
        const origin = context.unitPosition(unit);
        const current = context.currentTarget(unit);
        if (current && current.kind === 'unit') {
            const locked = context.unitById.get(current.id);
            if (locked) {
                const position = context.unitPosition(locked);
                if (Math.hypot(position.x - origin.x, position.y - origin.y) <= reach) return locked;
            }
        }
        const hexId = context.geometry.hexIdAt(origin.x, origin.y);
        if (hexId == null) return null;
        const radiusHex = Math.ceil(reach / HEX_GRID_LOGICAL_ROW_STEP) + 1;
        let best: ZCUnitState | null = null;
        let bestDistance = Infinity;
        for (const candidate of context.unitsInRadius(hexId, radiusHex)) {
            if (candidate.owner === unit.owner || candidate.battleState === 'dead' || candidate.hp <= 0) continue;
            const position = context.unitPosition(candidate);
            const gap = distance(origin.x, origin.y, position.x, position.y);
            if (gap > reach || gap >= bestDistance) continue;
            bestDistance = gap;
            best = candidate;
        }
        return best;
    }

    /**
     * 菌毯爆发 / 菌核爆裂技能：以施法者自身为圆心产生强力单次范围爆炸。
     *
     * 特性与约束：
     * - 【P0-2 修复】：向 counterMultiplierFor 传入 primary.cardId 计算克制，彻底修复错传 unitId 的缺陷。
     * - 【GC 优化】：通过单次 for 循环遍历寻找最近敌人，彻底消除 .reduce() 产生的箭头函数闭包及开方计算。
     * - 可为自身施加护卫防御状态（guardStatusId）。
     *
     * @param state 战斗运行时快照
     * @param unit 施法单位状态
     * @param context 攻击与数值上下文
     * @param guardStatusId 可选的施法后护盾/防御状态 ID
     * @param lane 技能子类型（'burst' | 'venom'）
     * @returns 是否成功引爆
     */
    static castBurstSkill(state: ZCSnapshot, unit: ZCUnitState,
        context: IZCAttackResolutionContext, guardStatusId?: string,
        lane: 'burst' | 'venom' = 'burst'): boolean {
        const definition = context.effectiveDefinition(unit);
        const profile = definition.attackProfile;
        const runtime = ZCAttackResolutionSystem.skillRuntimeOf(unit, profile.skillId, context);
        if (!runtime) return false;
        const parameters = runtime.parameters;
        const damageRate = Math.max(0, parameters?.[`${lane}DamageRate`] ?? 0);
        const radiusTable = Math.max(0, parameters?.[`${lane}Radius`] ?? 0);
        const hitStatusId = runtime?.statusId;
        const radius = radiusTable * context.rules.combatDistanceScale;
        if (!(damageRate > 0) || !(radius > 0)) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`burst-params:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} 自心爆发（${profile.name}）参数不全：`
                    + `damageRate=${damageRate} ${lane}Radius=${radiusTable || 'undefined'}`
                    + ` ⇒ 不出手、不消费 CD`);
            }
            return false;
        }
        const origin = context.unitPosition(unit);
        const radiusSq = radius * radius;
        const victims: ZCUnitState[] = [];
        for (let i = 0; i < state.units.length; i++) {
            const candidate = state.units[i];
            if (candidate.owner === unit.owner || candidate.battleState === 'dead' || candidate.hp <= 0) continue;
            const pos = context.unitPosition(candidate);
            const dx = pos.x - origin.x, dy = pos.y - origin.y;
            if (dx * dx + dy * dy <= radiusSq) {
                victims.push(candidate);
            }
        }
        if (!victims.length) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`burst-empty:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} 自心爆发（${profile.name}）半径 ${radiusTable} 表值 px`
                    + `（世界 ${radius.toFixed(1)}）内没有敌人 ⇒ 不消费 CD，下帧重试`);
            }
            return false;
        }
        let primary = victims[0];
        let bestDistSq = Number.POSITIVE_INFINITY;
        for (let i = 0; i < victims.length; i++) {
            const candidate = victims[i];
            const pos = context.unitPosition(candidate);
            const dx = pos.x - origin.x, dy = pos.y - origin.y;
            const distSq = dx * dx + dy * dy;
            if (distSq < bestDistSq) {
                bestDistSq = distSq;
                primary = candidate;
            }
        }
        const primaryOwner = primary.owner;
        // 修复 P0-2：传 primary.cardId 作为 targetCardId
        const primaryCardId = primary.cardId;
        const criticalMultiplier = ZCAttackResolutionSystem.criticalMultiplier(unit, context);
        const counterMultiplier = ZCAttackResolutionSystem.counterMultiplierFor(
            unit, primaryOwner, primaryCardId, context, primary.id);
        const damage = Math.round(ZCAttackResolutionSystem.unitDamage(context, unit, primaryOwner, primaryCardId,
            damageRate, primary.id) * criticalMultiplier);
        const floatTextKind = damageFloatTextKind(criticalMultiplier > 1, counterMultiplier);
        state.combatEvents.push({
            id: state.nextCombatEventId++,
            type: ZCCombatEventType.Area,
            owner: unit.owner,
            sourceUnitId: unit.id,
            targetUnitId: primary.id,
            skillId: profile.skillId,
            skillName: profile.name,
            effectKey: null,
            projectileKey: null,
            effectPrefabPath: ZC_BURST_IMPACT_PREFAB_PATH,
            fromX: origin.x,
            fromY: origin.y,
            toX: origin.x,
            toY: origin.y,
            radius,
            damage,
            empowered: false,
            startedAt: state.elapsedSeconds,
            durationSeconds: 0.3,
            effectScale: zcBurstEffectScale(radiusTable),
        });
        const knockbackCells = Math.max(0, parameters?.[`${lane}KnockbackCells`] ?? 0);
        let statusApplied = false;
        for (const victim of victims) {
            const hitText = context.damageUnit(victim, damage, {
                owner: unit.owner, kind: 'unit', unitId: unit.id, floatTextKind,
            });
            ZCAttackResolutionSystem.applyLifesteal(unit, hitText, context);
            context.tryExecuteUnit(victim, undefined, unit.owner, unit.id, hitText);
            if (hitStatusId && victim.hp > 0 && victim.battleState !== 'dead') {
                const result = context.statusSystem.apply(String(victim.id), hitStatusId,
                    { at: state.elapsedSeconds });
                if (result.applied) statusApplied = true;
            }
            if (knockbackCells > 0 && victim.hp > 0) {
                context.applyKnockback(victim, unit, knockbackCells * HEX_GRID_LOGICAL_ROW_STEP);
            }
        }
        const shieldRatio = Math.max(0, parameters?.[`${lane}ShieldRatio`] ?? 0);
        const shieldSeconds = Math.max(0, parameters?.[`${lane}ShieldSeconds`] ?? 0);
        if (shieldRatio > 0) this.applySelfShield(state, unit, shieldRatio, shieldSeconds);
        if (guardStatusId && shieldSeconds > 0) {
            context.statusSystem.apply(String(unit.id), guardStatusId,
                { at: state.elapsedSeconds, durationSeconds: shieldSeconds });
            state.statusEffects = context.statusSystem.exportSnapshot();
        } else if (statusApplied) {
            state.statusEffects = context.statusSystem.exportSnapshot();
        }
        if (zcSkillCastWatched(unit.unitId)) {
            skillCastLogChanging(`burst-cast:${unit.id}`, '施法',
                `${unit.unitId}#${unit.id} 引爆【${profile.name}】：倍率 ${damageRate}、`
                + `半径 ${radiusTable} 表值 px（世界 ${radius.toFixed(1)}）、命中 ${victims.length} 人、`
                + `单发 ${damage}、减伤=${guardStatusId ? '已挂' : '无'}、护盾=${(shieldRatio * 100).toFixed(0)}%`);
        }
        return true;
    }

    /**
     * 狮子吼 / 怒吼：以自身为圆心的一圈冲击波。
     * GC 优化：循环寻找 primary 消除箭头函数分配与开方。
     * 修复 P0-2：传 primary.cardId。
     * 修复 P1-4：shieldExpireAt 取 Math.max 避免覆盖更长护盾。
     */
    static castRoar(state: ZCSnapshot, unit: ZCUnitState,
        context: IZCAttackResolutionContext): boolean {
        const definition = context.effectiveDefinition(unit);
        const profile = definition.attackProfile;
        const parameters = ZCAttackResolutionSystem.skillParamsOf(unit, profile.skillId, context);
        if (!parameters) return false;
        const damageRate = Math.max(0, parameters.roarDamageRate ?? 0);
        const radiusTable = Math.max(0, parameters.roarRadius ?? 0);
        const attackPct = Math.min(0, parameters.roarAttackPct ?? 0);
        const seconds = Math.max(0, parameters.roarSeconds ?? 0);
        const shieldRatio = Math.max(0, parameters.roarShieldRatio ?? 0);
        const radius = radiusTable * context.rules.combatDistanceScale;
        if (!(damageRate > 0) || !(radius > 0)) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`roar-params:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} 怒吼（${profile.name}）参数不全：`
                    + `damageRate=${damageRate} radius=${radiusTable || 'undefined'}`
                    + ` ⇒ 不出手、不消费 CD`);
            }
            return false;
        }
        const origin = context.unitPosition(unit);
        const radiusSq = radius * radius;
        const victims: ZCUnitState[] = [];
        for (let i = 0; i < state.units.length; i++) {
            const candidate = state.units[i];
            if (candidate.owner === unit.owner || candidate.battleState === 'dead' || candidate.hp <= 0) continue;
            const pos = context.unitPosition(candidate);
            const dx = pos.x - origin.x, dy = pos.y - origin.y;
            if (dx * dx + dy * dy <= radiusSq) {
                victims.push(candidate);
            }
        }
        if (!victims.length) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`roar-empty:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} 怒吼（${profile.name}）半径 ${radiusTable} 表值 px`
                    + `（世界 ${radius.toFixed(1)}）内没有敌人 ⇒ 不消费 CD，下帧重试`);
            }
            return false;
        }
        let primary = victims[0];
        let bestDistSq = Number.POSITIVE_INFINITY;
        for (let i = 0; i < victims.length; i++) {
            const candidate = victims[i];
            const pos = context.unitPosition(candidate);
            const dx = pos.x - origin.x, dy = pos.y - origin.y;
            const distSq = dx * dx + dy * dy;
            if (distSq < bestDistSq) {
                bestDistSq = distSq;
                primary = candidate;
            }
        }
        const criticalMultiplier = ZCAttackResolutionSystem.criticalMultiplier(unit, context);
        // 修复 P0-2：传 primary.cardId 作为 targetCardId
        const counterMultiplier = ZCAttackResolutionSystem.counterMultiplierFor(unit, primary.owner, primary.cardId, context, primary.id);
        const damage = Math.round(ZCAttackResolutionSystem.unitDamage(context, unit, primary.owner, primary.cardId,
            damageRate, primary.id) * criticalMultiplier);
        const floatTextKind = damageFloatTextKind(criticalMultiplier > 1, counterMultiplier);
        state.combatEvents.push({
            id: state.nextCombatEventId++,
            type: ZCCombatEventType.Area,
            owner: unit.owner,
            sourceUnitId: unit.id,
            targetUnitId: primary.id,
            skillId: profile.skillId,
            skillName: profile.name,
            effectKey: null,
            projectileKey: null,
            effectPrefabPath: ZC_BURST_IMPACT_PREFAB_PATH,
            fromX: origin.x,
            fromY: origin.y,
            toX: origin.x,
            toY: origin.y,
            radius,
            damage,
            empowered: false,
            startedAt: state.elapsedSeconds,
            durationSeconds: 0.3,
            effectScale: zcBurstEffectScale(radiusTable),
        });
        for (const victim of victims) {
            const hitText = context.damageUnit(victim, damage, {
                owner: unit.owner, kind: 'unit', unitId: unit.id, floatTextKind,
            });
            ZCAttackResolutionSystem.applyLifesteal(unit, hitText, context);
            context.tryExecuteUnit(victim, undefined, unit.owner, unit.id, hitText);
        }
        let statusApplied = false;
        if (attackPct !== 0 && seconds > 0) {
            const debuffId = `__roar:${attackPct.toFixed(4)}:${seconds.toFixed(2)}__`;
            if (!context.statusSystem.hasDef(debuffId)) {
                context.statusSystem.register({
                    id: debuffId,
                    name: debuffId,
                    durationSeconds: seconds,
                    maxStacks: 1,
                    refreshPolicy: 'refresh',
                    statMods: { attackPct },
                    behavior: { kind: 'none' },
                });
            }
            for (const victim of victims) {
                if (victim.hp <= 0 || victim.battleState === 'dead') continue;
                const result = context.statusSystem.apply(String(victim.id), debuffId,
                    { at: state.elapsedSeconds, durationSeconds: seconds, sourceUnitId: String(unit.id) });
                if (result.applied) statusApplied = true;
            }
        }
        // 修复 P1-4：护盾到期时间不缩短
        if (shieldRatio > 0) {
            for (const ally of state.units) {
                if (ally.owner !== unit.owner || ally.battleState === 'dead' || ally.hp <= 0) continue;
                const pos = context.unitPosition(ally);
                if (Math.hypot(pos.x - origin.x, pos.y - origin.y) > radius) continue;
                ally.shield = Math.max(ally.shield ?? 0, unit.maxHp * shieldRatio);
                if (seconds > 0) {
                    const nextExpire = state.elapsedSeconds + seconds;
                    ally.shieldExpireAt = Math.max(ally.shieldExpireAt ?? 0, nextExpire);
                }
            }
        }
        if (statusApplied) state.statusEffects = context.statusSystem.exportSnapshot();
        if (zcSkillCastWatched(unit.unitId)) {
            skillCastLogChanging(`roar-cast:${unit.id}`, '施法',
                `${unit.unitId}#${unit.id} 怒吼【${profile.name}】：倍率 ${damageRate}、`
                + `半径 ${radiusTable} 表值 px、命中 ${victims.length} 人、单发 ${damage}、`
                + `减攻 ${attackPct}% / ${seconds}s、护盾=${(shieldRatio * 100).toFixed(0)}%`);
        }
        return true;
    }

    /**
     * 飓风（`storm_zone`，三叶小丑 68020 的 102004）。
     * 修复 P1-1：补全 criticalMultiplier 与 floatTextKind。
     */
    static castStorm(state: ZCSnapshot, unit: ZCUnitState,
        context: IZCAttackResolutionContext): boolean {
        const definition = context.effectiveDefinition(unit);
        const profile = definition.attackProfile;
        const parameters = ZCAttackResolutionSystem.skillParamsOf(unit, profile.skillId, context);
        if (!parameters) return false;
        const scale = Math.max(1e-6, context.rules.combatDistanceScale);
        const radiusTable = Math.max(0, parameters.stormRadius ?? 0);
        const seconds = Math.max(0, parameters.stormSeconds ?? 0);
        const interval = Math.max(0.05, parameters.stormInterval ?? 0.5);
        const damageRate = Math.max(0, parameters.stormDamageRate ?? 0);
        if (!(radiusTable > 0) || !(seconds > 0) || !(damageRate > 0)) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`storm-params:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} 飓风参数不全：radius=${radiusTable || 'undefined'}`
                    + ` seconds=${seconds} rate=${damageRate} ⇒ 不出手、不消费 CD`);
            }
            return false;
        }
        const origin = context.unitPosition(unit);
        const rivalOwner = unit.owner === ZCOwner.Player ? ZCOwner.Enemy : ZCOwner.Player;
        // 修复 P1-1：增加暴击倍率与 floatTextKind 计算
        const criticalMultiplier = ZCAttackResolutionSystem.criticalMultiplier(unit, context);
        const counterMultiplier = ZCAttackResolutionSystem.counterMultiplierFor(unit, rivalOwner, null, context);
        const damage = Math.max(1, Math.round(
            ZCAttackResolutionSystem.unitDamage(context, unit, rivalOwner, null, damageRate) * criticalMultiplier));
        const floatTextKind = damageFloatTextKind(criticalMultiplier > 1, counterMultiplier);
        const wanderSpeed = Math.max(0, parameters.stormWanderSpeed ?? 0) * scale;
        const turnSeconds = Math.max(0.05, parameters.stormTurnSeconds ?? 1);
        const pullSpeed = Math.max(0, parameters.stormPullSpeed ?? 0) * scale;
        const pullRadius = Math.max(0, parameters.stormPullRadius ?? 0) * scale;
        const travelSpeed = Math.max(0, definition.moveSpeed);
        const lock = context.currentTarget(unit);
        const lockedTarget = lock && lock.kind === 'unit' && lock.id > 0 ? lock : null;
        const chaseTarget = lockedTarget ?? this.stormDeliveryTarget(unit, origin, context, definition, scale);
        const arriveRange = radiusTable * scale * 0.25;
        const canTravel = chaseTarget ? travelSpeed > 0 : false;
        const travelSeconds = chaseTarget && travelSpeed > 0
            ? Math.max(0, Math.hypot(chaseTarget.x - origin.x, chaseTarget.y - origin.y) - arriveRange) / travelSpeed
            : 0;
        state.groundZones.push({
            x: origin.x,
            y: origin.y,
            radius: radiusTable * scale,
            owner: unit.owner,
            sourceUnitId: unit.id,
            skillId: profile.skillId,
            skillName: profile.name,
            effectPrefabPath: ZC_STORM_PREFAB_PATH,
            holdVisual: true,
            growSeconds: travelSeconds > 0.05 ? travelSeconds : 0.2,
            growFrom: travelSeconds > 0.05 ? ZC_STORM_GROW_FROM : undefined,
            approachSpeed: canTravel ? travelSpeed : undefined,
            approachTargetId: chaseTarget && canTravel ? chaseTarget.id : undefined,
            sprintRange: arriveRange,
            arriveWander: canTravel ? true : undefined,
            remainingSeconds: seconds,
            wavesLeft: Math.max(1, Math.round(seconds / interval)),
            nextWaveAt: state.elapsedSeconds,
            waveInterval: interval,
            damage,
            floatTextKind,
            slowRatio: 0,
            wanderSpeed: wanderSpeed > 0 ? wanderSpeed : undefined,
            wanderTurnSeconds: wanderSpeed > 0 ? turnSeconds : undefined,
            pullSpeed: pullSpeed > 0 ? pullSpeed : undefined,
            pullRadius: pullRadius > 0 ? pullRadius : undefined,
        });
        if (zcSkillCastWatched(unit.unitId)) {
            const travelLog = chaseTarget && canTravel
                ? `投送 目标#${chaseTarget.id} @ ${travelSpeed} 世界 px/s（面板移速，约 `
                    + `${travelSeconds.toFixed(2)}s 抵达，入场 ${ZC_STORM_GROW_FROM * 100}% → 100%）`
                : '投送 无活目标 ⇒ 原地生成、不走赶路段';
            skillCastLogChanging(`storm-cast:${unit.id}`, '施法',
                `${unit.unitId}#${unit.id} 放出飓风【${profile.name}】：半径 ${radiusTable} 表值 px、`
                + `${seconds}s / 每 ${interval}s 一跳、单跳 ${damage}、`
                + `游走 ${(parameters.stormWanderSpeed ?? 0)} 表值 px/s（每 ${turnSeconds}s 换向）、`
                + `牵引 ${(parameters.stormPullSpeed ?? 0)} 表值 px/s @ ${(parameters.stormPullRadius ?? 0)} 表值 px、`
                + travelLog);
        }
        return true;
    }

    /**
     * 飓风投送目标解析辅助函数。
     * 在射程内寻找最近的有效目标（过滤已死、阵营及对空/地限制），作为飓风初期的飞行航向目标。
     */
    /**
     * 飓风投送目标解析辅助函数。
     * 在射程内寻找最近的有效目标（过滤已死、阵营及对空/地限制），作为飓风初期的飞行航向目标。
     */
    private static stormDeliveryTarget(
        unit: ZCUnitState,
        origin: { readonly x: number; readonly y: number },
        context: IZCAttackResolutionContext,
        definition: ZCUnitDefinition,
        scale: number,
    ): ZCCombatTarget | null {
        let bestId = 0;
        let bestX = 0;
        let bestY = 0;
        let bestRadius = 0;
        let bestCardId: string | null = null;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (const other of context.unitById.values()) {
            if (other.id === unit.id || other.owner === unit.owner) continue;
            if (other.battleState === 'dead' || other.hp <= 0) continue;
            const otherDefinition = context.effectiveDefinition(other);
            if (otherDefinition.flying && !definition.canAttackAir) continue;
            const position = context.unitPosition(other);
            const distance = Math.hypot(position.x - origin.x, position.y - origin.y);
            if (distance > ZCTargetingSystem.attackReach(definition, otherDefinition.bodyRadius, scale)) continue;
            if (distance >= bestDistance) continue;
            bestDistance = distance;
            bestId = other.id;
            bestX = position.x;
            bestY = position.y;
            bestRadius = otherDefinition.bodyRadius;
            bestCardId = other.cardId ?? null;
        }
        if (!(bestId > 0)) return null;
        return { kind: 'unit', id: bestId, x: bestX, y: bestY, bodyRadius: bestRadius, cardId: bestCardId };
    }

    /**
     * 聚能射线技能（科学家 103503）：朝目标方向射出贯穿性持续高频切割射线及末端光斑。
     *
     * 特性与约束：
     * - 【P1-1 修复】：射线主矩形区域与末端圆形光斑均补齐 criticalMultiplier 暴击倍率与 floatTextKind，修复伤害缩水与飘字异常。
     * - 支持对击中敌人附加易伤状态（vulnStatusId）。
     *
     * @param state 战斗运行时快照
     * @param unit 施法单位状态
     * @param context 攻击与数值上下文
     * @param vulnStatusId 可选的易伤状态 ID
     * @returns 是否成功发射射线
     */
    static castRayBeam(state: ZCSnapshot, unit: ZCUnitState,
        context: IZCAttackResolutionContext, vulnStatusId?: string): boolean {
        const definition = context.effectiveDefinition(unit);
        const profile = definition.attackProfile;
        const parameters = ZCAttackResolutionSystem.skillParamsOf(unit, profile.skillId, context);
        if (!parameters) return false;
        const scale = Math.max(1e-6, context.rules.combatDistanceScale);
        const halfLengthTable = Math.max(0, parameters.rayHalfLength ?? 0);
        const halfWidthTable = Math.max(0, parameters.rayHalfWidth ?? 0);
        const seconds = Math.max(0, parameters.raySeconds ?? 0);
        const interval = Math.max(0.05, parameters.rayInterval ?? 0.2);
        const damageRate = Math.max(0, parameters.rayDamageRate ?? 0);
        if (!(halfLengthTable > 0) || !(halfWidthTable > 0) || !(seconds > 0) || !(damageRate > 0)) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`ray-params:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} 射线集束参数不全：halfLength=${halfLengthTable}`
                    + ` halfWidth=${halfWidthTable} seconds=${seconds} rate=${damageRate}`
                    + ' ⇒ 不出手、不消费次数');
            }
            return false;
        }
        const origin = context.unitPosition(unit);
        const target = context.currentTarget(unit);
        const aim = target && (target.x !== origin.x || target.y !== origin.y)
            ? Math.atan2(target.y - origin.y, target.x - origin.x)
            : unit.facingRadians;
        const halfLength = halfLengthTable * scale;
        const forward = Math.max(0, parameters.rayForward ?? 0) * scale;
        const centerForward = forward + halfLength;
        const targetOwner = target ? ZCAttackResolutionSystem.targetOwner(state, target, context) : (unit.owner === ZCOwner.Player
            ? ZCOwner.Enemy : ZCOwner.Player);
        const targetCardId = target ? target.cardId : null;
        const targetUnitId = target && target.kind === 'unit' ? target.id : undefined;
        // 修复 P1-1：计算暴击与 floatTextKind
        const criticalMultiplier = ZCAttackResolutionSystem.criticalMultiplier(unit, context);
        const counterMultiplier = ZCAttackResolutionSystem.counterMultiplierFor(unit, targetOwner, targetCardId, context, targetUnitId);
        const damage = Math.round(ZCAttackResolutionSystem.unitDamage(context, unit, targetOwner, targetCardId, damageRate, targetUnitId) * criticalMultiplier);
        const floatTextKind = damageFloatTextKind(criticalMultiplier > 1, counterMultiplier);
        const waves = Math.max(1, Math.round(seconds / interval + 1e-6));
        const vulnPct = Math.max(0, parameters.rayVulnPct ?? 0);
        const spotRadiusTable = Math.max(0, parameters.raySpotRadius ?? 0);
        const spotRate = Math.max(0, parameters.raySpotDamageRate ?? 0);
        state.groundZones.push({
            x: origin.x + Math.cos(aim) * centerForward,
            y: origin.y + Math.sin(aim) * centerForward,
            radius: halfLength,
            owner: unit.owner,
            sourceUnitId: unit.id,
            skillId: profile.skillId,
            skillName: profile.name,
            effectPrefabPath: ZC_RAY_BEAM_PREFAB_PATH,
            holdVisual: true,
            growSeconds: 0.1,
            remainingSeconds: seconds,
            wavesLeft: waves,
            nextWaveAt: state.elapsedSeconds,
            waveInterval: interval,
            damage,
            floatTextKind,
            slowRatio: 0,
            rectHalfLength: halfLength,
            rectHalfHeight: halfWidthTable * scale,
            angleDegrees: aim * 180 / Math.PI,
            followUnitId: unit.id,
            followForward: centerForward,
            hitStatusId: vulnPct > 0 ? vulnStatusId : undefined,
            hitStatusChance: vulnPct > 0 ? 1 : undefined,
            hitStatusSeconds: vulnPct > 0
                ? Math.max(interval, parameters.rayVulnSeconds ?? 0.3) : undefined,
            effectScale: zcRayBeamEffectScale(halfLengthTable),
        });
        if (spotRadiusTable > 0 && spotRate > 0) {
            const spotCriticalMultiplier = ZCAttackResolutionSystem.criticalMultiplier(unit, context);
            const spotRivalOwner = unit.owner === ZCOwner.Player ? ZCOwner.Enemy : ZCOwner.Player;
            const spotCounterMultiplier = ZCAttackResolutionSystem.counterMultiplierFor(unit, spotRivalOwner, null, context);
            const spotExpireDamage = Math.max(1, Math.round(
                ZCAttackResolutionSystem.unitDamage(context, unit, spotRivalOwner, null, spotRate) * spotCriticalMultiplier));
            const spotFloatTextKind = damageFloatTextKind(spotCriticalMultiplier > 1, spotCounterMultiplier);
            state.groundZones.push({
                x: origin.x + Math.cos(aim) * (forward + halfLength * 2),
                y: origin.y + Math.sin(aim) * (forward + halfLength * 2),
                radius: spotRadiusTable * scale,
                owner: unit.owner,
                sourceUnitId: unit.id,
                skillId: profile.skillId,
                skillName: profile.name,
                effectPrefabPath: null,
                remainingSeconds: seconds,
                wavesLeft: 0,
                nextWaveAt: state.elapsedSeconds + seconds,
                waveInterval: Math.max(0.05, seconds),
                damage: 0,
                expireDamage: spotExpireDamage,
                floatTextKind: spotFloatTextKind,
                expirePrefabPath: ZC_BURST_IMPACT_PREFAB_PATH,
                expireFxSeconds: 0.4,
                slowRatio: 0,
                followUnitId: unit.id,
                followForward: forward + halfLength * 2,
                angleDegrees: aim * 180 / Math.PI,
                effectScale: 1,
            });
        }
        if (zcSkillCastWatched(unit.unitId)) {
            skillCastLogChanging(`ray-cast:${unit.id}`, '施法',
                `${unit.unitId}#${unit.id} 射出【${profile.name}】：${(halfLengthTable * 2)}×${(halfWidthTable * 2)}`
                + ` 表值 px 矩形、${seconds}s / 每 ${interval}s = ${waves} 跳、单跳 ${damage}、`
                + `破甲 ${vulnPct > 0 ? `+${vulnPct}%` : '无'}、`
                + `末端光斑 ${spotRadiusTable > 0 ? `${spotRadiusTable} 表值 px × ${(spotRate * 100).toFixed(0)}%` : '无'}`);
        }
        return true;
    }

    /**
     * 文明之火技能：在目标及其周围散布多块持续灼烧的地火地面区域。
     *
     * 特性与约束：
     * - 【P1-1 修复】：火区补齐 criticalMultiplier 暴击乘数与 floatTextKind，确保每跳持续伤害正确体现暴击与克制飘字。
     * - 地火以多块随机散布形式生成，支持多跳持续伤害判定。
     *
     * @param state 战斗运行时快照
     * @param unit 施法单位状态
     * @param context 攻击与数值上下文
     * @returns 是否成功铺设地火
     */
    static castFireZone(state: ZCSnapshot, unit: ZCUnitState,
        context: IZCAttackResolutionContext): boolean {
        const definition = context.effectiveDefinition(unit);
        const profile = definition.attackProfile;
        const parameters = ZCAttackResolutionSystem.skillParamsOf(unit, profile.skillId, context);
        if (!parameters) return false;
        const scale = Math.max(1e-6, context.rules.combatDistanceScale);
        const count = Math.round(parameters.fireCount ?? 0);
        const radiusTable = Math.max(0, parameters.fireRadius ?? 0);
        const spreadTable = Math.max(0, parameters.fireSpreadRadius ?? 0);
        const seconds = Math.max(0, parameters.fireSeconds ?? 0);
        const interval = Math.max(0.05, parameters.fireInterval ?? 1);
        const damageRate = Math.max(0, parameters.fireDamageRate ?? 0);
        if (!(count > 0) || !(radiusTable > 0) || !(spreadTable > 0)
            || !(seconds > 0) || !(damageRate > 0)) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`fire-params:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} 文明之火参数不全：count=${count} radius=${radiusTable}`
                    + ` spread=${spreadTable} seconds=${seconds} rate=${damageRate} ⇒ 不撒区域、不消费次数`);
            }
            return false;
        }
        const target = context.currentTarget(unit);
        if (!target) return false;
        const targetOwner = ZCAttackResolutionSystem.targetOwner(state, target, context);
        const targetCardId = target.cardId;
        const targetUnitId = target.kind === 'unit' ? target.id : undefined;
        // 修复 P1-1：计算暴击与 floatTextKind
        const criticalMultiplier = ZCAttackResolutionSystem.criticalMultiplier(unit, context);
        const counterMultiplier = ZCAttackResolutionSystem.counterMultiplierFor(unit, targetOwner, targetCardId, context, targetUnitId);
        const damage = Math.round(
            ZCAttackResolutionSystem.unitDamage(context, unit, targetOwner, targetCardId, damageRate, targetUnitId) * criticalMultiplier);
        const floatTextKind = damageFloatTextKind(criticalMultiplier > 1, counterMultiplier);
        const waves = Math.max(1, Math.round(seconds / interval + 1e-6));
        const spread = spreadTable * scale;
        for (let index = 0; index < count; index += 1) {
            const angle = context.random() * Math.PI * 2;
            const distance = Math.sqrt(context.random()) * spread;
            state.groundZones.push({
                x: target.x + Math.cos(angle) * distance,
                y: target.y + Math.sin(angle) * distance,
                radius: radiusTable * scale,
                owner: unit.owner,
                sourceUnitId: unit.id,
                skillId: profile.skillId,
                skillName: profile.name,
                effectPrefabPath: ZC_FIRE_ZONE_PREFAB_PATH,
                holdVisual: true,
                growSeconds: 0.2,
                remainingSeconds: seconds,
                wavesLeft: waves,
                nextWaveAt: state.elapsedSeconds,
                waveInterval: interval,
                damage,
                floatTextKind,
                slowRatio: 0,
                tint: [ZC_FIRE_ZONE_TINT[0], ZC_FIRE_ZONE_TINT[1], ZC_FIRE_ZONE_TINT[2]],
            });
        }
        if (zcSkillCastWatched(unit.unitId)) {
            skillCastLogChanging(`fire-cast:${unit.id}`, '施法',
                `${unit.unitId}#${unit.id} 撒出【${profile.name}】：${count} 块区域、`
                + `单块半径 ${radiusTable} 表值 px、散布半径 ${spreadTable} 表值 px、`
                + `${seconds}s / 每 ${interval}s = ${waves} 跳、单跳单块 ${damage}`);
        }
        return true;
    }

    /**
     * 扇形甩击技能：向目标方向扇形区域发动强力范围打击。
     *
     * 特性与约束：
     * - 【P0-2 修复】：克制计算修复为传入主目标的真实 cardId。
     * - 【P1-3 修复】：判定命中目标时增加 hp <= 0 守卫，杜绝鞭尸。
     * - 命中人数受 maxTargets 限制，并可对受击者附加减速状态（slowStatusId）。
     *
     * @param state 战斗运行时快照
     * @param unit 施法单位状态
     * @param context 攻击与数值上下文
     * @param slowStatusId 可选的减速状态 ID
     * @returns 是否成功发动甩击
     */
    static castFanSweep(state: ZCSnapshot, unit: ZCUnitState,
        context: IZCAttackResolutionContext, slowStatusId?: string): boolean {
        const definition = context.effectiveDefinition(unit);
        const profile = definition.attackProfile;
        const parameters = ZCAttackResolutionSystem.skillParamsOf(unit, profile.skillId, context);
        if (!parameters) return false;
        const damageRate = Math.max(0, parameters.fanDamageRate ?? 0);
        const radiusTable = Math.max(0, parameters.fanRadius ?? 0);
        const radius = radiusTable * context.rules.combatDistanceScale;
        const fanDeg = Math.max(0, Math.min(360, parameters.fanAngle ?? 120));
        const halfAngle = (fanDeg * Math.PI) / 360;
        const maxTargets = Math.max(1, Math.round(parameters.fanMaxTargets ?? 1));
        if (!(damageRate > 0) || !(radius > 0) || !(halfAngle > 0)) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`fan-params:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} 扇形甩击（${profile.name}）参数不全：`
                    + `damageRate=${damageRate} fanRadius=${parameters.fanRadius ?? 'undefined'}`
                    + ` fanAngle=${parameters.fanAngle ?? 'undefined'} ⇒ 不出手、不消费 CD`);
            }
            return false;
        }
        const origin = context.unitPosition(unit);
        const target = context.currentTarget(unit);
        const heading = target && Math.abs(target.x - origin.x) + Math.abs(target.y - origin.y) > 1e-9
            ? Math.atan2(target.y - origin.y, target.x - origin.x)
            : unit.facingRadians;
        const inFan: { unit: ZCUnitState; distance: number }[] = [];
        for (const candidate of state.units) {
            if (candidate.owner === unit.owner || candidate.battleState === 'dead' || candidate.hp <= 0) continue;
            const pos = context.unitPosition(candidate);
            const dx = pos.x - origin.x;
            const dy = pos.y - origin.y;
            const distance = Math.hypot(dx, dy);
            if (distance > radius) continue;
            if (distance > 1e-6) {
                const delta = Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - heading),
                    Math.cos(Math.atan2(dy, dx) - heading)));
                if (delta > halfAngle) continue;
            }
            inFan.push({ unit: candidate, distance });
        }
        if (!inFan.length) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`fan-empty:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} 扇形甩击（${profile.name}）${fanDeg}° / 半径 ${radiusTable}`
                    + ` 表值 px（世界 ${radius.toFixed(1)}）内没有敌人 ⇒ 不消费 CD，下帧重试`);
            }
            return false;
        }
        inFan.sort((a, b) => a.distance - b.distance);
        const victims = inFan.slice(0, maxTargets);
        const primary = victims[0].unit;
        const criticalMultiplier = ZCAttackResolutionSystem.criticalMultiplier(unit, context);
        // 修复 P0-2：传 primary.cardId 作为 targetCardId
        const counterMultiplier = ZCAttackResolutionSystem.counterMultiplierFor(
            unit, primary.owner, primary.cardId, context, primary.id);
        const damage = Math.round(ZCAttackResolutionSystem.unitDamage(context, unit, primary.owner, primary.cardId,
            damageRate, primary.id) * criticalMultiplier);
        const floatTextKind = damageFloatTextKind(criticalMultiplier > 1, counterMultiplier);
        const burstTable = radiusTable * ZC_FAN_SWEEP_BURST_RADIUS_RATIO;
        const burstDistance = radius * ZC_FAN_SWEEP_BURST_DISTANCE_RATIO;
        const burstScale = zcBurstEffectScale(burstTable);
        const middle = (ZC_FAN_SWEEP_BURSTS - 1) / 2;
        for (let index = 0; index < ZC_FAN_SWEEP_BURSTS; index += 1) {
            const angle = heading + (index - middle) * halfAngle * ZC_FAN_SWEEP_BURST_SPREAD;
            const x = origin.x + Math.cos(angle) * burstDistance;
            const y = origin.y + Math.sin(angle) * burstDistance;
            state.combatEvents.push({
                id: state.nextCombatEventId++,
                type: ZCCombatEventType.Area,
                owner: unit.owner,
                sourceUnitId: unit.id,
                targetUnitId: null,
                skillId: profile.skillId,
                skillName: profile.name,
                effectKey: null,
                projectileKey: null,
                effectPrefabPath: ZC_BURST_IMPACT_PREFAB_PATH,
                fromX: x,
                fromY: y,
                toX: x,
                toY: y,
                radius: burstDistance,
                damage: 0,
                empowered: false,
                startedAt: state.elapsedSeconds,
                durationSeconds: 0.3,
                effectScale: burstScale,
            });
        }
        for (const { unit: victim } of victims) {
            const hitText = context.damageUnit(victim, damage, {
                owner: unit.owner, kind: 'unit', unitId: unit.id, floatTextKind,
            });
            ZCAttackResolutionSystem.applyLifesteal(unit, hitText, context);
            context.tryExecuteUnit(victim, undefined, unit.owner, unit.id, hitText);
            if (slowStatusId) context.applyHitStatus(victim, slowStatusId, unit.id);
        }
        if (zcSkillCastWatched(unit.unitId)) {
            skillCastLogChanging(`fan-cast:${unit.id}`, '施法',
                `${unit.unitId}#${unit.id} 甩出【${profile.name}】：倍率 ${damageRate}、`
                + `${fanDeg}° / 半径 ${radiusTable} 表值 px（世界 ${radius.toFixed(1)}）、`
                + `命中 ${victims.length}/${inFan.length} 人（上限 ${maxTargets}）、单发 ${damage}`);
        }
        return true;
    }

    /**
     * 冲锋打击技能：施法者向指定目标直线冲刺，对沿途穿越的敌人造成打击并获得防守护盾。
     *
     * 特性与约束：
     * - 【P0-2 修复】：克制乘数传入主目标的真实 cardId。
     * - 【P1-3 修复】：沿途判定命中时严格过滤已死亡单位。
     * - 冲刺结束时为自身提供短期护盾，并推入冲锋表现事件。
     *
     * @param state 战斗运行时快照
     * @param unit 施法单位状态
     * @param context 攻击与数值上下文
     * @param options 冲锋配置选项
     * @returns 命中的敌方单位总数
     */
    static castChargeDash(state: ZCSnapshot, unit: ZCUnitState,
        context: IZCAttackResolutionContext, options: IZCChargeDashOptions): number {
        const { origin, destination } = options;
        const damageRate = Math.max(0, options.damageRate);
        const hitRadius = Math.max(0, options.hitRadius);
        if (!(damageRate > 0) || !(hitRadius > 0)) return 0;
        const profile = context.effectiveDefinition(unit).attackProfile;
        const spanX = destination.x - origin.x;
        const spanY = destination.y - origin.y;
        const spanSquared = spanX * spanX + spanY * spanY;
        const distanceToSegment = (x: number, y: number): number => {
            if (spanSquared <= 1e-12) return Math.hypot(x - origin.x, y - origin.y);
            const t = Math.max(0, Math.min(1,
                ((x - origin.x) * spanX + (y - origin.y) * spanY) / spanSquared));
            return Math.hypot(x - (origin.x + spanX * t), y - (origin.y + spanY * t));
        };
        const victims: { unit: ZCUnitState; distance: number }[] = [];
        for (const candidate of state.units) {
            if (candidate.owner === unit.owner || candidate.battleState === 'dead' || candidate.hp <= 0) continue;
            const pos = context.unitPosition(candidate);
            const distance = distanceToSegment(pos.x, pos.y);
            if (distance > hitRadius) continue;
            victims.push({ unit: candidate, distance });
        }
        victims.sort((a, b) => a.distance - b.distance);
        const shieldRatio = Math.max(0, options.shieldRatio ?? 0);
        const shieldSeconds = Math.max(0, options.shieldSeconds ?? 0);
        if (victims.length) {
            const primary = victims[0].unit;
            const criticalMultiplier = ZCAttackResolutionSystem.criticalMultiplier(unit, context);
            // 修复 P0-2：传 primary.cardId 作为 targetCardId
            const counterMultiplier = ZCAttackResolutionSystem.counterMultiplierFor(
                unit, primary.owner, primary.cardId, context, primary.id);
            const damage = Math.round(ZCAttackResolutionSystem.unitDamage(context, unit, primary.owner, primary.cardId,
                damageRate, primary.id) * criticalMultiplier);
            const floatTextKind = damageFloatTextKind(criticalMultiplier > 1, counterMultiplier);
            for (const { unit: victim } of victims) {
                const hitText = context.damageUnit(victim, damage, {
                    owner: unit.owner, kind: 'unit', unitId: unit.id, floatTextKind,
                });
                ZCAttackResolutionSystem.applyLifesteal(unit, hitText, context);
                context.tryExecuteUnit(victim, undefined, unit.owner, unit.id, hitText);
                if (options.statusId && victim.hp > 0) {
                    context.applyHitStatus(victim, options.statusId, unit.id);
                }
            }
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`dash-cast:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} 冲锋（${profile.name}）：倍率 ${damageRate}、`
                    + `命中 ${victims.length} 人、单发 ${damage}、状态 ${options.statusId ?? '无'}、`
                    + `护盾 ${shieldRatio > 0 ? `${(shieldRatio * 100).toFixed(0)}%·${shieldSeconds}s` : '无'}、`
                    + `减伤 ${options.guardStatusId ?? '无'}`);
            }
        }
        if (shieldRatio > 0) this.applySelfShield(state, unit, shieldRatio, shieldSeconds);
        if (options.guardStatusId && (options.guardSeconds ?? 0) > 0) {
            context.statusSystem.apply(String(unit.id), options.guardStatusId,
                { at: state.elapsedSeconds, durationSeconds: options.guardSeconds });
            state.statusEffects = context.statusSystem.exportSnapshot();
        }
        if (shieldRatio > 0 || (options.guardStatusId && (options.guardSeconds ?? 0) > 0)) {
            state.combatEvents.push({
                id: state.nextCombatEventId++,
                type: ZCCombatEventType.Area,
                owner: unit.owner,
                sourceUnitId: unit.id,
                targetUnitId: unit.id,
                skillId: profile.skillId,
                skillName: profile.name,
                effectKey: null,
                projectileKey: null,
                effectPrefabPath: ZC_DASH_GUARD_PREFAB_PATH,
                fromX: destination.x,
                fromY: destination.y,
                toX: destination.x,
                toY: destination.y,
                radius: 0,
                damage: 0,
                empowered: false,
                startedAt: state.elapsedSeconds,
                durationSeconds: ZC_DASH_GUARD_SECONDS,
            });
        }
        return victims.length;
    }

    /**
     * 多点定点打击技能：在攻击范围内选取至多 N 个目标逐个发动打击，并对各受击者周围造成溅射。
     *
     * 特性与约束：
     * - 严格按距离排序挑选目标，逐个计算主目标伤害与旁及目标的衰减溅射伤害。
     * - 包含已死亡单位过滤，确保不产生无效攻击。
     *
     * @param state 战斗运行时快照
     * @param unit 施法单位状态
     * @param options 打击配置选项
     * @param context 攻击与数值上下文
     * @returns 成功命中的目标数
     */
    static strikeTargets(state: ZCSnapshot, unit: ZCUnitState, options: IZCStrikeOptions,
        context: IZCAttackResolutionContext): number {
        const count = Math.max(1, Math.round(options.count));
        const radius = Math.max(1, options.radius);
        const origin = options.origin ?? context.unitPosition(unit);
        const candidates: { unit: ZCUnitState; distance: number }[] = [];
        for (const candidate of state.units) {
            if (candidate.owner === unit.owner || candidate.battleState === 'dead' || candidate.hp <= 0) continue;
            const pos = context.unitPosition(candidate);
            const dist = Math.hypot(pos.x - origin.x, pos.y - origin.y);
            if (dist > radius) continue;
            candidates.push({ unit: candidate, distance: dist });
        }
        if (!candidates.length) return 0;
        if (options.nearest) candidates.sort((a, b) => a.distance - b.distance);
        else {
            for (let index = 0; index < Math.min(count, candidates.length); index += 1) {
                const pick = index + Math.floor(context.random() * (candidates.length - index));
                const swap = candidates[index];
                candidates[index] = candidates[Math.min(pick, candidates.length - 1)];
                candidates[Math.min(pick, candidates.length - 1)] = swap;
            }
        }
        const victims = candidates.slice(0, count);
        const profile = context.effectiveDefinition(unit).attackProfile;
        const splashRadius = Math.max(0, options.splashRadius ?? 0);
        const splashRate = Math.max(0, options.splashDamageRate ?? 0);
        const splashFalloff = Math.max(0, Math.min(1, options.splashFalloff ?? 0));
        const criticalMultiplier = ZCAttackResolutionSystem.criticalMultiplier(unit, context);

        if (options.missilePrefabPath) {
            let fired = 0;
            const speed = options.missileSpeed ?? (profile.projectileSpeed || 500);
            const volley = options.missileCount == null
                ? victims
                : candidates.slice(0, Math.max(1, Math.round(options.missileCount)));
            for (let index = 0; index < volley.length; index += 1) {
                const { unit: victim } = volley[index];
                const point = context.unitPosition(victim);
                const from = context.unitPosition(unit);
                const dx = point.x - from.x;
                const dy = point.y - from.y;
                const length = Math.hypot(dx, dy);
                const arc = options.arcOffset ?? 0;
                const sign = index % 2 === 0 ? 1 : -1;
                const arcOffset = arc > 0 ? arc * sign * (0.5 + 0.5 * (index % 2)) : 0;
                const heading = length > 0 ? Math.atan2(dy, dx) : unit.facingRadians;
                context.pushProjectile({
                    id: state.nextCombatEventId++,
                    type: 'projectile',
                    owner: unit.owner,
                    sourceUnitId: unit.id,
                    targetUnitId: victim.id,
                    skillId: profile.skillId,
                    skillName: profile.name,
                    effectKey: null,
                    projectileKey: null,
                    effectPrefabPath: options.missilePrefabPath,
                    fromX: from.x,
                    fromY: from.y,
                    toX: point.x,
                    toY: point.y,
                    radius: 0,
                    damage: 0,
                    empowered: false,
                    startedAt: state.elapsedSeconds,
                    durationSeconds: ZCCombatSystem.attackTravelSeconds(
                        ZCCombatEventType.Projectile, length, speed, ZC_PROJECTILE_MISS_DISTANCE),
                    targetKind: 'unit',
                    targetId: victim.id,
                    sourceCardId: unit.cardId,
                    baseDamage: ZCAttackResolutionSystem.unitDamage(context, unit, victim.owner, victim.cardId,
                        options.damageRate, victim.id),
                    x: from.x,
                    y: from.y,
                    previousX: from.x,
                    previousY: from.y,
                    velocityX: Math.cos(heading) * speed,
                    velocityY: Math.sin(heading) * speed,
                    collisionRadius: (profile.collisionRadius ?? 3) * context.rules.combatDistanceScale,
                    canHitAir: context.effectiveDefinition(unit).canAttackAir,
                    remainingPierces: 0,
                    hitUnitIds: [],
                    splashRadius: splashRadius > 0 ? splashRadius : undefined,
                    splashDamageRate: splashRate > 0 ? splashRate : undefined,
                    impactEffectPrefabPath: options.impactPrefabPath ?? null,
                    arcOffset,
                    onHitStatusId: options.statusId,
                });
                fired += 1;
            }
            missileLog('模型', `导弹分支已推进 ${fired} 个弹体`
                + `（候选 ${candidates.length} / 本次上限 ${volley.length}，`
                + `配表 count=${count}，恒定发数=${options.missileCount ?? '未登记'}，`
                + `弧线偏移基准 ${(options.arcOffset ?? 0).toFixed(1)}，速度 ${speed}）`);
            return fired;
        }

        let hits = 0;
        for (const { unit: victim } of victims) {
            const targetOwner = victim.owner;
            const damage = Math.round(ZCAttackResolutionSystem.unitDamage(context, unit, targetOwner, victim.cardId,
                options.damageRate, victim.id) * criticalMultiplier);
            const counterMultiplier = ZCAttackResolutionSystem.counterMultiplierFor(
                unit, targetOwner, victim.cardId, context, victim.id);
            const floatTextKind = damageFloatTextKind(criticalMultiplier > 1, counterMultiplier);
            const point = context.unitPosition(victim);
            state.combatEvents.push({
                id: state.nextCombatEventId++,
                type: ZCCombatEventType.Area,
                owner: unit.owner,
                sourceUnitId: unit.id,
                targetUnitId: victim.id,
                skillId: profile.skillId,
                skillName: profile.name,
                effectKey: profile.effectKey ?? null,
                projectileKey: null,
                effectPrefabPath: profile.effectPrefabPath ?? null,
                fromX: point.x,
                fromY: point.y,
                toX: point.x,
                toY: point.y,
                radius: Math.max(1, splashRadius),
                damage,
                empowered: false,
                startedAt: state.elapsedSeconds,
                durationSeconds: 0.3,
            });
            const hitText = context.damageUnit(victim, damage, {
                owner: unit.owner, kind: 'unit', unitId: unit.id, floatTextKind, ranged: true,
            });
            if (!hitText) continue;
            hits += 1;
            ZCAttackResolutionSystem.applyLifesteal(unit, hitText, context);
            context.tryExecuteUnit(victim, undefined, unit.owner, unit.id, hitText);
            if (options.statusId) context.applyHitStatus(victim, options.statusId, unit.id);
            if (!(splashRadius > 0) || !(splashRate > 0)) continue;
            const bystanders: { unit: ZCUnitState; distance: number }[] = [];
            for (const bystander of state.units) {
                if (bystander === victim || bystander.owner === unit.owner) continue;
                if (bystander.battleState === 'dead' || bystander.hp <= 0) continue;
                const pos = context.unitPosition(bystander);
                const dist = Math.hypot(pos.x - point.x, pos.y - point.y);
                if (dist > splashRadius) continue;
                bystanders.push({ unit: bystander, distance: dist });
            }
            bystanders.sort((a, b) => a.distance - b.distance);
            for (let index = 0; index < bystanders.length; index += 1) {
                const splashDamage = Math.max(1, Math.round(
                    damage * splashRate * Math.pow(1 - splashFalloff, index)));
                context.damageUnit(bystanders[index].unit, splashDamage, {
                    owner: unit.owner, kind: 'unit', unitId: unit.id, floatTextKind, ranged: true,
                });
            }
        }
        return hits;
    }

    /**
     * 动态确保移速增益状态已在状态系统中注册。
     *
     * @param context 攻击与数值上下文
     * @param id 状态唯一标识
     * @param moveSpeedPct 移速百分比加成（如 20 表示 +20%）
     * @param durationSeconds 持续时间（秒）
     */
    /**
     * 动态确保移速增益状态已在状态系统中注册。
     *
     * @param context 攻击与数值上下文
     * @param id 状态唯一标识
     * @param moveSpeedPct 移速百分比加成（如 20 表示 +20%）
     * @param durationSeconds 持续时间（秒）
     */
    static ensureMoveSpeedStatus(context: IZCAttackResolutionContext, id: string,
        moveSpeedPct: number, durationSeconds: number): void {
        if (context.statusSystem.hasDef(id)) return;
        context.statusSystem.register({
            id, name: id, durationSeconds, refreshPolicy: 'refresh',
            statMods: { moveSpeedPct }, behavior: { kind: 'none' },
        });
    }

    /**
     * 动态确保战旗暴击增益状态已在状态系统中注册。
     *
     * @param context 攻击与数值上下文
     * @param rawRate 暴击率与暴伤比率（0.0 ~ 1.0）
     * @returns 生成并注册的状态 ID
     */
    /**
     * 动态确保战旗暴击增益状态已在状态系统中注册。
     *
     * @param context 攻击与数值上下文
     * @param rawRate 暴击率与暴伤比率（0.0 ~ 1.0）
     * @returns 生成并注册的状态 ID
     */
    static ensureBannerStatus(context: IZCAttackResolutionContext, rawRate: number): string {
        const rate = Math.max(0, Math.min(1, rawRate));
        const id = `__banner:${rate.toFixed(4)}__`;
        if (!context.statusSystem.hasDef(id)) {
            context.statusSystem.register({
                id, name: id, durationSeconds: 4, refreshPolicy: 'refresh',
                statMods: { critPct: rate * 100, critDamagePct: rate * 100 },
                behavior: { kind: 'none' },
            });
        }
        return id;
    }

    /**
     * 为全场所有存活友军施加护盾光环。
     *
     * @param state 战斗运行时快照
     * @param source 护盾来源施法者
     * @param ratio 护盾值相对于各友军 maxHp 的比例系数
     */
    /**
     * 为全场所有存活友军施加护盾光环。
     *
     * @param state 战斗运行时快照
     * @param source 护盾来源施法者
     * @param ratio 护盾值相对于各友军 maxHp 的比例系数
     */
    static applyShieldAura(state: ZCSnapshot, source: ZCUnitState, ratio: number): void {
        const normalized = Math.max(0, Math.min(5, ratio));
        for (const ally of state.units) {
            if (ally.owner !== source.owner || ally.battleState === 'dead') continue;
            ally.shield = Math.max(ally.shield ?? 0, ally.maxHp * normalized);
        }
    }

    /**
     * 为自身施加持续指定秒数的临时护盾。
     *
     * 特性与约束：
     * - 【P1-4 修复】：到期时间采用 Math.max(shieldExpireAt, now + seconds) 计算，
     *   防止短时间内重复触发技能时意外缩减剩余护盾的持续时间。
     *
     * @param state 战斗运行时快照
     * @param source 护盾施加目标（自身）
     * @param ratio 护盾值相对于自身 maxHp 的比例系数
     * @param seconds 护盾持续时长（秒）
     */
    static applySelfShield(state: ZCSnapshot, source: ZCUnitState, ratio: number, seconds: number): void {
        const normalized = Math.max(0, Math.min(5, ratio));
        if (normalized <= 0) return;
        source.shield = Math.max(source.shield ?? 0, source.maxHp * normalized);
        if (seconds > 0) {
            const nextExpire = state.elapsedSeconds + seconds;
            source.shieldExpireAt = Math.max(source.shieldExpireAt ?? 0, nextExpire);
        }
    }

    /**
     * 推送自身护盾的视觉表现事件（如金光护盾环绕特效）。
     *
     * @param state 战斗运行时快照
     * @param unit 目标单位状态
     * @param context 攻击与数值上下文
     * @param skillId 关联的技能配置 ID
     * @param skillName 关联的技能名称
     */
    /**
     * 推送自身护盾的视觉表现事件（如金光护盾环绕特效）。
     *
     * @param state 战斗运行时快照
     * @param unit 目标单位状态
     * @param context 攻击与数值上下文
     * @param skillId 关联的技能配置 ID
     * @param skillName 关联的技能名称
     */
    static pushSelfShieldVisual(
        state: ZCSnapshot, unit: ZCUnitState, context: IZCAttackResolutionContext,
        skillId: number, skillName: string,
    ): void {
        const position = context.unitPosition(unit);
        pushDashGuardVisualEvent(state, unit, position.x, position.y, state.elapsedSeconds, skillId, skillName);
    }

    /**
     * 为全场所有存活友军施加持续指定秒数的群体移速提升光环。
     *
     * @param state 战斗运行时快照
     * @param owner 阵营所属（player / enemy）
     * @param ratio 移速提升比率（0.0 ~ 1.0）
     * @param durationSeconds 持续时间（秒）
     * @param context 攻击与数值上下文
     */
    /**
     * 为全场所有存活友军施加持续指定秒数的群体移速提升光环。
     *
     * @param state 战斗运行时快照
     * @param owner 阵营所属（player / enemy）
     * @param ratio 移速提升比率（0.0 ~ 1.0）
     * @param durationSeconds 持续时间（秒）
     * @param context 攻击与数值上下文
     */
    static applyMoveSpeedAura(state: ZCSnapshot, owner: ZCOwner, ratio: number,
        durationSeconds: number, context: IZCAttackResolutionContext): void {
        const normalized = Math.max(0, Math.min(5, ratio));
        const id = `__haste:${normalized.toFixed(4)}__`;
        this.ensureMoveSpeedStatus(context, id, normalized * 100, durationSeconds);
        for (const ally of state.units) {
            if (ally.owner !== owner || ally.battleState === 'dead') continue;
            context.statusSystem.apply(String(ally.id), id, { at: state.elapsedSeconds, durationSeconds });
        }
        state.statusEffects = context.statusSystem.exportSnapshot();
    }

    /**
     * 战旗技能：随机为己方 N 个存活单位施加暴击战旗增益状态。
     *
     * 特性与约束：
     * - 【GC 优化】：采用 Swap-Pop 算法在 O(1) 时间内从候选池中移除已选中元素，
     *   彻底替代原 splice(pick, 1) 产生的 O(N) 数组内存搬移和 GC 压力。
     *
     * @param state 战斗运行时快照
     * @param owner 阵营所属
     * @param rawCount 增益受益单位上限数量
     * @param rawRate 暴击率与暴击伤害增益比率
     * @param context 攻击与数值上下文
     */
    static applyBannerBuff(state: ZCSnapshot, owner: ZCOwner, rawCount: number,
        rawRate: number, context: IZCAttackResolutionContext): void {
        const id = this.ensureBannerStatus(context, rawRate);
        const candidates = state.units
            .filter((unit) => unit.owner === owner && unit.battleState !== 'dead')
            .sort((a, b) => a.id - b.id);
        const count = Math.min(candidates.length, Math.max(0, Math.round(rawCount)));
        for (let index = 0; index < count; index += 1) {
            const lastIdx = candidates.length - 1;
            const pick = Math.min(lastIdx, Math.floor(context.random() * candidates.length));
            const target = candidates[pick];
            candidates[pick] = candidates[lastIdx];
            candidates.pop();
            context.statusSystem.apply(String(target.id), id, { at: state.elapsedSeconds, durationSeconds: 4 });
        }
        state.statusEffects = context.statusSystem.exportSnapshot();
    }
}
