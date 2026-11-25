/** 技能触发系统：驱动常驻被动、连发推进与主动技能触发 */

import type { ZCSkillRuntimeDefinition } from '../ZCSkillRuntime';
import type { ZCSnapshot, ZCUnitState } from '../ZCGameTypes';
import type { ZCUnitStatPatch } from '../ZCModifierRuntime';
import { type ZCStatusStatMods, type ZCStatusSystem } from '../ZCStatusEffect';
import type { IZCChargeDashOptions, IZCStrikeOptions } from './ZCAttackResolutionSystem';
import { HEX_GRID_LOGICAL_ROW_STEP } from '../../../../core/hex/HexGridLayout';
import { ZCCombatEventType } from '../ZCCombatCatalog';
import { ZC_BLINK_CAST_EFFECT_PREFAB_PATH, ZC_BLINK_CAST_EFFECT_SECONDS } from '../ZCBlinkCastFx';
import { ZC_SELF_CAST_HOLD_SECONDS, ZC_SKILL_CAST_ACTION_SECONDS } from '../ZCUnitCastAction';
import { zcMissileFxOf } from '../ZCCombatEffectFlight';
import { splashShotSlowStatusId } from '../ZCSplashShotFx';
import { burstGuardStatusId } from '../ZCBurstFx';
import { fanSweepSlowStatusId } from '../ZCFanSweepFx';
import {
    ZC_SINGLE_STRIKE_EFFECT_PREFAB_PATH, ZC_SINGLE_STRIKE_EFFECT_SECONDS,
    singleStrikeHasteStatusId, singleStrikeStunStatusId,
} from '../ZCSingleStrikeFx';
import {
    ZC_DASH_EFFECT_PREFAB_PATH, ZC_DASH_EFFECT_SECONDS,
    dashGuardStatusId, dashVulnerableStatusId, pushDashGuardVisualEvent,
} from '../ZCDashFx';
import { ZC_BARRAGE_DEFAULT_INTERVAL } from '../ZCWindBarrageFx';
import { ZC_QUAKE_STRIKE_PREFAB_PATH, ZC_QUAKE_STRIKE_SECONDS } from '../ZCQuakeFx';
import { ZC_EFFECT_STATUS_PREFIX } from '../ZCEffectTuning';
import { missileLog, missileLogChanging, missileLogOnce } from '../../ZCMissileSkillDiagnostics';
import { skillCastLogChanging, skillCastLogOnce, zcSkillCastWatched } from '../../ZCSkillCastDiagnostics';

export interface IZCSkillTriggerContext {
    readonly statusSystem: ZCStatusSystem;
    /** 按技能半径或模式选敌，缺省回退 inAttackRange */
    selectSkillTarget?(source: ZCUnitState, radius: number, mode?: number): ZCUnitState | null;
    /** key 格式须与攻击系统一致：`${unitId}:${attackSkillId}` */
    runtimeOf(unit: ZCUnitState): ZCSkillRuntimeDefinition | undefined;
    fireBurst(unit: ZCUnitState): void;
    // 主动结算转发：返回 false 表示参数不全或无目标，不消费 CD / 次数
    castSecondary(unit: ZCUnitState): boolean;
    castSelfAura?(unit: ZCUnitState): boolean;
    castBolt?(unit: ZCUnitState): boolean;
    castChainLightning?(unit: ZCUnitState): boolean;
    castSummon?(unit: ZCUnitState): boolean;
    castRoar?(unit: ZCUnitState): boolean;
    castStorm?(unit: ZCUnitState): boolean;
    castRayBeam?(unit: ZCUnitState, vulnStatusId?: string): boolean;
    castFireZone?(unit: ZCUnitState): boolean;
    castTrap?(unit: ZCUnitState): boolean;
    castSplashShot?(unit: ZCUnitState, slowStatusId?: string): boolean;
    castWindBolt?(unit: ZCUnitState): boolean;
    castBarrageShot?(unit: ZCUnitState): boolean;
    /** lane 区分同单位爆发/毒液独立 CD 与参数 */
    castBurstSkill?(unit: ZCUnitState, guardStatusId?: string, lane?: 'burst' | 'venom'): boolean;
    castFanSweep?(unit: ZCUnitState, slowStatusId?: string): boolean;
    castChargeDash?(unit: ZCUnitState, options: IZCChargeDashOptions): number;
    /** 冲锋落点合法性校验 */
    hexIdAt?(x: number, y: number): number | null;
    currentTarget?(unit: ZCUnitState): { readonly x: number; readonly y: number } | null;
    readonly distanceScale?: number;
    healUnit?(unit: ZCUnitState, amount: number): void;
    strike?(unit: ZCUnitState, options: IZCStrikeOptions): number;
    /** 瞬移并同步更新地块索引 */
    blinkTo?(unit: ZCUnitState, x: number, y: number): void;
    /** 世界坐标，缺省用 freeX/freeY */
    unitPosition?(unit: ZCUnitState): { readonly x: number; readonly y: number };
    /** 普攻射程闸门：范围内有目标时才消耗 CD */
    inAttackRange?(unit: ZCUnitState): boolean;
    /** 普攻射程上限（世界 px），用于钳制技能索敌半径 */
    attackReachOf?(unit: ZCUnitState): number;
    /** 最近敌方距离（世界 px），用于收窄特定技能触发范围 */
    nearestEnemyDistance?(unit: ZCUnitState): number;
    /** 单位常驻属性补丁，需与攻击系统共用同一数据源 */
    statPatchOf?(unit: ZCUnitState): ZCUnitStatPatch | undefined;
}

const TEAM_AURA_SECONDS = 0.6;
/** 刷新周期 0.6s，确保友军离开范围后迅速失效 */
const TEAM_BUFF_REFRESH_SECONDS = 0.6;
/** 同卡多路被动光环按槽位下标共存 */
const TEAM_AURA_SLOTS = 3;
/** 多点打击打空重试退避与按 unit.id 错峰参数 */
const STRIKE_RETRY_SECONDS = 0.2;
const ZC_STRIKE_NUMB_STATUS_ID = ZC_EFFECT_STATUS_PREFIX.boltNumb;
const STRIKE_RETRY_JITTER = 0.3;
const STRIKE_RETRY_SLOTS = 4;
/** 分身爆炸上限目标数 */
const BLINK_CLONE_MAX_TARGETS = 6;
/** 首轮冷却按 unit.id 错峰步长（秒），防同帧齐射 */
const STRIKE_PHASE_STRIDE = 0.3;
const STRIKE_PHASE_SLOTS = 8;

/** 按词缀签名生成可复用的友军光环状态 ID */
export function teamAuraStatusId(mods: ZCStatusStatMods): string {
    const parts = (Object.keys(mods) as (keyof ZCStatusStatMods)[])
        .filter((key) => (mods[key] ?? 0) !== 0)
        .sort()
        .map((key) => `${key}=${(mods[key] ?? 0).toFixed(4)}`);
    return `__aura:${parts.join(',')}__`;
}

export function lowHpGuardStatusId(reducePct: number, seconds: number): string {
    return `__lowhp:${reducePct.toFixed(4)}:${seconds.toFixed(2)}__`;
}

export class ZCSkillTriggerSystem {
    static tick(state: ZCSnapshot, dt: number, context: IZCSkillTriggerContext): void {
        if (!state.units.length) return;
        const now = state.elapsedSeconds;
        let statusChanged = false;
        for (const unit of state.units) {
            if (unit.battleState === 'dead' || unit.hp <= 0) continue;
            const runtime = context.runtimeOf(unit);
            const params = runtime?.parameters;
            let checkedRelease = false;
            let releaseValue = true;
            const getRelease = (): boolean => {
                if (!checkedRelease) {
                    checkedRelease = true;
                    releaseValue = context.inAttackRange ? context.inAttackRange(unit) : true;
                }
                return releaseValue;
            };
            const checkSkillGate = (radiusTable: number, mode?: number): boolean => {
                if (context.selectSkillTarget) {
                    const scale = Math.max(1e-6, context.distanceScale ?? 1);
                    return Boolean(context.selectSkillTarget(unit, radiusTable * scale, mode));
                }
                return getRelease();
            };

            if (this.applyPassiveStatus(state, unit, runtime, context)) statusChanged = true;
            this.applyHpRegen(unit, dt, now, context);
            if (this.applyTeamAura(state, unit, runtime, context)) statusChanged = true;

            if (this.applyTeamBuff(state, unit, params, now, context)) statusChanged = true;
            if (this.applySelfCast(state, unit, params, now, context)) statusChanged = true;
            if (this.applyCounterBuff(state, unit, params, now, context)) statusChanged = true;
            const auraRadius = params ? (params.auraTriggerRange || params.auraRadius || 100) : 100;
            if (this.applySelfAura(state, unit, params, now, context, () => checkSkillGate(auraRadius, params?.auraTargetMode))) statusChanged = true;

            const boltRadius = params?.boltRadius ?? 150;
            this.applyBoltStrike(unit, params, now, context, () => checkSkillGate(boltRadius, params?.boltTargetMode));
            this.applyChainLightning(unit, params, now, context, getRelease);
            this.applySummonUnit(unit, params, now, context);
            this.applyRoar(unit, params, now, context);
            this.applyStorm(unit, params, now, context, getRelease);
            this.applyRayBeam(unit, params, now, context, getRelease);
            this.applyFireZone(unit, params, now, context, getRelease);
            this.applyDashChain(state, unit, params, now, dt, context);
            this.applyTrap(unit, params, now, context);
            const shotRadius = params?.shotRadius ?? params?.splashRadius ?? 150;
            this.applySplashShot(unit, params, now, context, () => checkSkillGate(shotRadius, params?.shotTargetMode ?? params?.splashTargetMode));
            this.applyWindShot(unit, params, now, context, getRelease);
            this.applyMissileBarrage(unit, params, now, context, getRelease);
            this.applyBurstSkill(unit, params, now, context);
            this.applyBurstSkill(unit, params, now, context, 'venom');
            this.applyFanSweep(unit, params, now, context);
            this.applyChargeShield(state, unit, params, now, context);
            const strikeRadius = params?.strikeRadius ?? 300;
            this.applyRandomStrike(state, unit, params, now, context, () => checkSkillGate(strikeRadius, params?.strikeTargetMode));
            const blinkRadius = params?.blinkSearchRadius ?? 300;
            this.applyBlinkStrike(state, unit, params, now, context, runtime, () => checkSkillGate(blinkRadius, params?.blinkTargetMode));
            this.applySingleStrike(state, unit, params, now, context);
            this.applyLegacyDash(state, unit, params, now, context);

            this.expireShield(unit, now);
            this.advanceBurst(state, unit, now, context);
            const secRadius = params?.secondaryRadius ?? params?.fanRadius ?? 150;
            this.advanceSecondary(unit, params, now, context, () => checkSkillGate(secRadius, params?.secondaryTargetMode));
            if (this.applyLowHpGuard(state, unit, params, now, context)) statusChanged = true;
        }
        if (statusChanged) state.statusEffects = context.statusSystem.exportSnapshot();
    }

    /** 仅在真实出手后标记施法动作窗口，待触发重试时不调用 */
    private static markCastAction(unit: ZCUnitState, now: number, hold: boolean): void {
        unit.castActionUntil = now + ZC_SKILL_CAST_ACTION_SECONDS;
        if (hold) unit.castHoldUntil = now + ZC_SELF_CAST_HOLD_SECONDS;
    }

    /** 跨整秒边界时按 maxHp 百分比回血 */
    private static applyHpRegen(
        unit: ZCUnitState,
        dt: number,
        now: number,
        context: IZCSkillTriggerContext,
    ): void {
        const patch = context.statPatchOf ? context.statPatchOf(unit) : undefined;
        const rate = Math.max(0, (patch && patch.hpRegenPct) || 0);
        if (!(rate > 0)) return;
        const ticks = Math.floor(now + 1e-9) - Math.floor(now - dt + 1e-9);
        if (ticks <= 0) return;
        const amount = unit.maxHp * rate / 100 * ticks;
        if (amount > 0 && context.healUnit) context.healUnit(unit, amount);
    }

    private static applyPassiveStatus(
        state: ZCSnapshot,
        unit: ZCUnitState,
        runtime: ZCSkillRuntimeDefinition | undefined,
        context: IZCSkillTriggerContext,
    ): boolean {
        const statusId = runtime?.passiveStatusId;
        if (!statusId || unit.passiveStatusApplied) return false;
        unit.passiveStatusApplied = true;
        if (!context.statusSystem.hasDef(statusId)) return false;
        const result = context.statusSystem.apply(String(unit.id), statusId, { at: state.elapsedSeconds });
        return result.applied;
    }

    private static applyTeamAura(
        state: ZCSnapshot,
        unit: ZCUnitState,
        runtime: ZCSkillRuntimeDefinition | undefined,
        context: IZCSkillTriggerContext,
    ): boolean {
        const params = runtime?.parameters;
        if (!params) return false;
        let applied = false;
        for (let slot = 0; slot < TEAM_AURA_SLOTS; slot += 1) {
            if (this.applyTeamAuraSlot(state, unit, params, slot, context)) applied = true;
        }
        return applied;
    }

    private static applyTeamAuraSlot(
        state: ZCSnapshot,
        unit: ZCUnitState,
        params: Readonly<Record<string, number>>,
        slot: number,
        context: IZCSkillTriggerContext,
    ): boolean {
        const radius = Math.max(0, params[`teamAura${slot}Radius`] ?? 0);
        if (!(radius > 0)) return false;
        const mods: ZCStatusStatMods = {};
        const attackPct = params[`teamAura${slot}AttackPct`] ?? 0;
        const maxHpPct = params[`teamAura${slot}MaxHpPct`] ?? 0;
        const attackSpeedPct = params[`teamAura${slot}AttackSpeedPct`] ?? 0;
        const moveSpeedPct = params[`teamAura${slot}MoveSpeedPct`] ?? 0;
        if (attackPct) mods.attackPct = attackPct;
        if (maxHpPct) mods.maxHpPct = maxHpPct;
        if (attackSpeedPct) mods.attackIntervalPct = attackSpeedPct;
        if (moveSpeedPct) mods.moveSpeedPct = moveSpeedPct;
        if (!Object.keys(mods).length) return false;
        const statusId = teamAuraStatusId(mods);
        if (!context.statusSystem.hasDef(statusId)) {
            context.statusSystem.register({
                id: statusId,
                name: statusId,
                durationSeconds: TEAM_AURA_SECONDS,
                maxStacks: 1,
                refreshPolicy: 'refresh',
                statMods: mods,
                behavior: { kind: 'none' },
            });
        }
        const reach = radius * Math.max(1e-6, context.distanceScale ?? 1);
        let applied = false;
        for (const ally of state.units) {
            if (ally.owner !== unit.owner || ally.battleState === 'dead' || ally.hp <= 0) continue;
            if (Math.hypot(ally.freeX - unit.freeX, ally.freeY - unit.freeY) > reach) continue;
            const result = context.statusSystem.apply(String(ally.id), statusId, {
                at: state.elapsedSeconds,
                durationSeconds: TEAM_AURA_SECONDS,
                sourceUnitId: String(unit.id),
            });
            if (result.applied) applied = true;
        }
        return applied;
    }

    /** 团队范围增益：窗口期内刷新，脱离或到期失效，支持击杀延长 */
    private static applyTeamBuff(
        state: ZCSnapshot,
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
    ): boolean {
        if (!params) return false;
        const cooldown = Math.max(0, params.teamBuffCooldown ?? 0);
        const seconds = Math.max(0, params.teamBuffSeconds ?? 0);
        const radiusTable = Math.max(0, params.teamBuffRadius ?? 0);
        if (!(cooldown > 0) || !(seconds > 0) || !(radiusTable > 0)) return false;
        const mods: ZCStatusStatMods = {};
        const damagePct = params.teamBuffDamagePct ?? 0;
        const attackSpeedPct = params.teamBuffAttackSpeedPct ?? 0;
        if (damagePct) mods.damageRatePct = damagePct;
        if (attackSpeedPct) mods.attackIntervalPct = attackSpeedPct;
        if (!Object.keys(mods).length) return false;

        // 首次仅初始化 CD
        if (unit.teamBuffReadyAt === undefined) {
            unit.teamBuffReadyAt = now + cooldown;
            return false;
        }
        if (!((unit.teamBuffWindowEnd ?? 0) > now) && now >= unit.teamBuffReadyAt) {
            unit.teamBuffWindowEnd = now + seconds;
            unit.teamBuffReadyAt = now + cooldown;
            // 原地锁定播放前摇
            this.markCastAction(unit, now, true);
        }
        const windowEnd = unit.teamBuffWindowEnd ?? 0;
        if (!(windowEnd > now)) return false;

        const statusId = teamAuraStatusId(mods);
        if (!context.statusSystem.hasDef(statusId)) {
            context.statusSystem.register({
                id: statusId,
                name: statusId,
                durationSeconds: TEAM_BUFF_REFRESH_SECONDS,
                maxStacks: 1,
                refreshPolicy: 'refresh',
                statMods: mods,
                behavior: { kind: 'none' },
            });
        }
        const reach = radiusTable * Math.max(1e-6, context.distanceScale ?? 1);
        const extendSeconds = Math.max(0, params.teamBuffKillExtendSeconds ?? 0);
        const extendMax = Math.max(0, params.teamBuffKillExtendMaxSeconds ?? 0);
        let applied = false;
        for (const ally of state.units) {
            if (ally.owner !== unit.owner || ally.battleState === 'dead' || ally.hp <= 0) continue;
            if (Math.hypot(ally.freeX - unit.freeX, ally.freeY - unit.freeY) > reach) continue;
            if (!((ally.teamBuffUntil ?? 0) > now)) {
                ally.teamBuffUntil = windowEnd;
                ally.teamBuffKillBase = ally.killCount ?? 0;
                ally.teamBuffExtendUsed = 0;
            } else if (extendSeconds > 0) {
                const kills = (ally.killCount ?? 0) - (ally.teamBuffKillBase ?? 0);
                if (kills > 0) {
                    const used = ally.teamBuffExtendUsed ?? 0;
                    const grant = Math.min(kills * extendSeconds, Math.max(0, extendMax - used));
                    if (grant > 0) {
                        ally.teamBuffUntil += grant;
                        ally.teamBuffExtendUsed = used + grant;
                    }
                    // 达上限后仍推进击杀基线，避免后续额度变更时补算历史击杀
                    ally.teamBuffKillBase = ally.killCount ?? 0;
                }
            }
            const remaining = ally.teamBuffUntil - now;
            if (!(remaining > 0)) continue;
            // 截断至个体截止时间，避免窗口结束后额外多挂一个刷新周期
            const result = context.statusSystem.apply(String(ally.id), statusId, {
                at: state.elapsedSeconds,
                durationSeconds: Math.min(TEAM_BUFF_REFRESH_SECONDS, remaining),
                sourceUnitId: String(unit.id),
            });
            if (result.applied) applied = true;
        }
        return applied;
    }

    /** 清理到期限时护盾 */
    private static expireShield(unit: ZCUnitState, now: number): void {
        const expireAt = unit.shieldExpireAt;
        if (expireAt == null || now < expireAt) return;
        unit.shield = 0;
        delete unit.shieldExpireAt;
    }

    private static advanceBurst(
        state: ZCSnapshot,
        unit: ZCUnitState,
        now: number,
        context: IZCSkillTriggerContext,
    ): void {
        const left = unit.burstShotsLeft ?? 0;
        if (left <= 0) return;
        const interval = Math.max(0.01, unit.burstInterval ?? 0.2);
        if (now < (unit.burstNextAt ?? 0)) return;
        context.fireBurst(unit);
        unit.burstShotsLeft = left - 1;
        // 用当前时刻推进，防卡顿补帧同帧齐发
        unit.burstNextAt = now + interval;
        if (unit.burstShotsLeft <= 0) {
            delete unit.burstShotsLeft;
            delete unit.burstNextAt;
            delete unit.burstInterval;
            delete unit.burstDamageRate;
        }
    }

    private static advanceSecondary(
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
        release: boolean | (() => boolean),
    ): void {
        const cooldown = Math.max(0, params?.secondaryCooldown ?? 0);
        if (!(cooldown > 0)) return;
        const readyAt = unit.secondaryReadyAt;
        if (readyAt === undefined) { unit.secondaryReadyAt = now + cooldown; return; }
        if (now < readyAt) return;
        if (typeof release === 'function' ? !release() : !release) return;
        if (!context.castSecondary(unit)) return;
        unit.secondaryReadyAt = now + cooldown;
        this.markCastAction(unit, now, false);
    }

    /** 低血护体：lowHpCooldown 为 0 表示整场仅触发一次 */
    private static applyLowHpGuard(
        state: ZCSnapshot,
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
    ): boolean {
        if (!params) return false;
        const rawThreshold = params.lowHpThreshold ?? 0;
        if (!(rawThreshold > 0)) return false;
        const threshold = Math.max(0, Math.min(1, rawThreshold));
        if (unit.maxHp > 0 && unit.hp / unit.maxHp > threshold) return false;
        const cooldown = Math.max(0, params.lowHpCooldown ?? 0);
        const firedAt = unit.lowHpGuardFiredAt;
        if (firedAt != null) {
            if (cooldown <= 0 || now < firedAt + cooldown) return false;
        }
        const reducePct = Math.max(0, Math.min(95, params.lowHpReducePct ?? 0));
        const seconds = Math.max(0, params.lowHpSeconds ?? 0);
        if (reducePct <= 0) return false;
        const statusId = lowHpGuardStatusId(reducePct, seconds);
        if (!context.statusSystem.hasDef(statusId)) {
            context.statusSystem.register({
                id: statusId,
                name: statusId,
                durationSeconds: seconds,
                refreshPolicy: 'refresh',
                statMods: { damageTakenPct: -reducePct },
                behavior: { kind: 'none' },
            });
        }
        unit.lowHpGuardFiredAt = now;
        // 护体期受击反制降攻速；有效期由伤害系统按时间戳判定，无需额外清理
        const retaliate = Math.max(0, Math.min(95, params.lowHpRetaliatePct ?? 0));
        if (retaliate > 0) {
            unit.retaliateSlowPct = retaliate;
            unit.retaliateUntil = now + seconds;
        }
        const result = context.statusSystem.apply(String(unit.id), statusId, {
            at: state.elapsedSeconds, durationSeconds: seconds,
        });
        return result.applied;
    }

    /** 冷却型自身施法（不设普攻射程闸门） */
    private static applySelfCast(
        state: ZCSnapshot,
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
    ): boolean {
        if (!params) return false;
        const cooldown = Math.max(0, params.selfCastCooldown ?? 0);
        if (!(cooldown > 0)) return false;
        const readyAt = unit.selfCastReadyAt;
        if (readyAt === undefined) { unit.selfCastReadyAt = now + cooldown; return false; }
        if (now < readyAt) return false;
        unit.selfCastReadyAt = now + cooldown;
        this.markCastAction(unit, now, true);

        const seconds = Math.max(0, params.selfCastSeconds ?? 0);
        const mods: ZCStatusStatMods = {};
        const damagePct = params.selfCastDamagePct ?? 0;
        const attackSpeedPct = params.selfCastAttackSpeedPct ?? 0;
        const lifestealPct = params.selfCastLifestealPct ?? 0;
        const dodgePct = params.selfCastDodgePct ?? 0;
        if (damagePct) mods.damageRatePct = damagePct;
        if (attackSpeedPct) mods.attackIntervalPct = attackSpeedPct;
        if (lifestealPct) mods.lifestealRate = Math.min(1, lifestealPct / 100);
        if (dodgePct) mods.dodgePct = Math.min(1, dodgePct / 100);

        let changed = false;
        if (seconds > 0 && Object.keys(mods).length) {
            const statusId = selfCastStatusId(mods, seconds);
            if (!context.statusSystem.hasDef(statusId)) {
                context.statusSystem.register({
                    id: statusId,
                    name: statusId,
                    durationSeconds: seconds,
                    maxStacks: 1,
                    refreshPolicy: 'refresh',
                    statMods: mods,
                    behavior: { kind: 'none' },
                });
            }
            const result = context.statusSystem.apply(String(unit.id), statusId, {
                at: state.elapsedSeconds, durationSeconds: seconds,
            });
            if (result.applied) changed = true;
        }

        const selfHealPct = params.selfCastHealPct ?? 0;
        if (selfHealPct > 0 && context.healUnit) {
            context.healUnit(unit, unit.maxHp * selfHealPct / 100);
        }

        // 友军治疗不含施法者自身（自身已单独结算 selfCastHealPct）
        const allyRadius = params.selfCastAllyRadius ?? 0;
        const allyHealPct = params.selfCastAllyHealPct ?? 0;
        const allyReach = allyRadius > 0 ? allyRadius * Math.max(1e-6, context.distanceScale ?? 1) : 0;
        if (allyReach > 0 && allyHealPct > 0 && context.healUnit) {
            for (const ally of state.units) {
                if (ally === unit) continue;
                if (ally.owner !== unit.owner || ally.battleState === 'dead' || ally.hp <= 0) continue;
                if (Math.hypot(ally.freeX - unit.freeX, ally.freeY - unit.freeY) > allyReach) continue;
                context.healUnit(ally, ally.maxHp * allyHealPct / 100);
            }
        }

        if (allyReach > 0) {
            for (const target of state.units) {
                if (target !== unit) {
                    if (target.owner !== unit.owner || target.battleState === 'dead' || target.hp <= 0) continue;
                    if (Math.hypot(target.freeX - unit.freeX, target.freeY - unit.freeY) > allyReach) continue;
                }
                if (!Number.isFinite(target.freeX) || !Number.isFinite(target.freeY)) continue;
                pushDashGuardVisualEvent(state, target, target.freeX, target.freeY, now);
            }
        }

        const cleanse = Math.max(0, params.selfCastCleanse ?? 0);
        if (cleanse > 0) {
            const reachSquared = allyReach * allyReach;
            for (const target of state.units) {
                if (target === unit) {
                    // 群体治疗配了半径时仅净化友军，无半径则走单体自净化
                    if (allyReach > 0) continue;
                } else {
                    if (allyReach <= 0) continue;
                    if (target.owner !== unit.owner || target.battleState === 'dead' || target.hp <= 0) continue;
                    const dx = target.freeX - unit.freeX;
                    const dy = target.freeY - unit.freeY;
                    if (dx * dx + dy * dy > reachSquared) continue;
                }
                const debuffs = context.statusSystem.instancesOf(String(target.id))
                    .filter((instance) => isDebuffStatus(context.statusSystem, instance.defId))
                    .sort((a, b) => (b.remainingSeconds ?? Number.POSITIVE_INFINITY)
                        - (a.remainingSeconds ?? Number.POSITIVE_INFINITY));
                for (const instance of debuffs.slice(0, Math.round(cleanse))) {
                    if (context.statusSystem.remove(String(target.id), instance.defId)) changed = true;
                }
            }
        }
        return changed;
    }

    /**
     * 自身光环：到点在脚下开一片跟随本体的周期伤害区域，III 级附带自身增伤状态。
     * 与 `applySelfCast` 的区别：主体是区域，增益是附带；两条车道各有 readyAt。
     * 参数：auraCooldown / auraEvery / auraSeconds / auraInterval / auraRadius / auraDamageRate。
    */
    private static applySelfAura(
        state: ZCSnapshot,
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
        release: boolean | (() => boolean),
    ): boolean {
        if (!context.castSelfAura || !params) return false;
        const cooldown = Math.max(0, params.auraCooldown ?? 0);
        const every = Math.max(0, params.auraEvery ?? 0);
        if (!(cooldown > 0) && !(every > 0)) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`aura-params:${unit.id}`, '触发',
                    `${unit.unitId}#${unit.id} 自身光环没有 auraCooldown / auraEvery`
                    + `（读到 ${params.auraCooldown ?? 'undefined'} / ${params.auraEvery ?? 'undefined'}）`
                    + '⇒ 这条车道整段不执行');
            }
            return false;
        }
        if (cooldown > 0) {
            const readyAt = unit.auraReadyAt;
            if (readyAt === undefined) {
                unit.auraReadyAt = now + cooldown;
                if (zcSkillCastWatched(unit.unitId)) {
                    skillCastLogOnce(`aura-arm:${unit.id}`, '触发',
                        `${unit.unitId}#${unit.id} 自身光环冷却挂上：${now.toFixed(1)}s → `
                        + `${(now + cooldown).toFixed(1)}s 首次可施放（cooldown=${cooldown}s）`);
                }
                return false;
            }
            if (now < readyAt) return false;
        } else {
            const done = unit.completedAttackCount ?? 0;
            const fired = unit.auraFiredCount;
            if (fired === undefined) { unit.auraFiredCount = done; return false; }
            if (done - fired < Math.round(every)) return false;
        }
        if (typeof release === 'function' ? !release() : !release) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`aura-pending:${unit.id}`, '触发',
                    `${unit.unitId}#${unit.id} ${now.toFixed(1)}s 触发条件已满足但普攻范围内没有目标 ⇒ 待触发`);
            }
            return false;
        }
        // 配了专属触发半径时收窄判定（如喷火长度），与普攻射程串联
        const triggerRange = Math.max(0, params.auraTriggerRange ?? 0);
        if (triggerRange > 0 && context.nearestEnemyDistance) {
            const limit = triggerRange * Math.max(1e-6, context.distanceScale ?? 1);
            const nearest = context.nearestEnemyDistance(unit);
            if (nearest > limit) {
                if (zcSkillCastWatched(unit.unitId)) {
                    skillCastLogChanging(`aura-far:${unit.id}`, '触发',
                        `${unit.unitId}#${unit.id} ${now.toFixed(1)}s 最近目标 ${(nearest / limit * triggerRange).toFixed(1)}`
                        + ` 表值 px > 触发距离 ${triggerRange} ⇒ 待触发（不消费 CD）`);
                }
                return false;
            }
        }
        const cast = context.castSelfAura(unit);
        if (zcSkillCastWatched(unit.unitId)) {
            skillCastLogChanging(`aura-cast:${unit.id}`, '触发', cast
                ? `${unit.unitId}#${unit.id} ${now.toFixed(1)}s 施放成功，`
                    + (cooldown > 0 ? `CD 推到 ${(now + cooldown).toFixed(1)}s` : `次数记到 ${unit.completedAttackCount ?? 0}`)
                : `${unit.unitId}#${unit.id} ${now.toFixed(1)}s 施放被拒（参数不全）⇒ 不消费条件，下帧重试`);
        }
        if (!cast) return false;
        if (cooldown > 0) unit.auraReadyAt = now + cooldown;
        else unit.auraFiredCount = Math.max(0, Math.round(unit.completedAttackCount ?? 0));
        this.markCastAction(unit, now, false);

        // 光环附属增益（增伤/体型/反伤）同生命周期，合并为一条状态避免多图标到期错拍
        const selfDamagePct = Math.max(0, params.auraSelfDamagePct ?? 0);
        const bodySizePct = Math.max(0, params.auraBodySizePct ?? 0);
        const reflectPct = Math.max(0, params.auraReflectPct ?? 0);
        const seconds = Math.max(0, params.auraSeconds ?? 0);
        const mods: ZCStatusStatMods = {};
        if (selfDamagePct > 0) mods.damageRatePct = selfDamagePct;
        if (bodySizePct > 0) mods.bodySizePct = bodySizePct;
        if (reflectPct > 0) mods.reflectRate = reflectPct;
        if (!Object.keys(mods).length || !(seconds > 0)) return false;
        const statusId = selfCastStatusId(mods, seconds);
        if (!context.statusSystem.hasDef(statusId)) {
            context.statusSystem.register({
                id: statusId,
                name: statusId,
                durationSeconds: seconds,
                maxStacks: 1,
                refreshPolicy: 'refresh',
                statMods: mods,
                behavior: { kind: 'none' },
            });
        }
        const result = context.statusSystem.apply(String(unit.id), statusId, {
            at: state.elapsedSeconds, durationSeconds: seconds,
        });
        return result.applied;
    }

    /** 累计普攻自身增益（不设射程闸门） */
    private static applyCounterBuff(
        state: ZCSnapshot,
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
    ): boolean {
        if (!params) return false;
        const every = Math.max(0, Math.round(params.counterEvery ?? 0));
        if (!(every > 0)) return false;
        const done = unit.completedAttackCount ?? 0;
        const fired = unit.counterFiredCount;
        // 首次只记计数基线，开局不直接放
        if (fired === undefined) { unit.counterFiredCount = done; return false; }
        if (done - fired < every) return false;

        const seconds = Math.max(0, params.counterSeconds ?? 0);
        const mods: ZCStatusStatMods = {};
        const moveSpeedPct = params.counterMoveSpeedPct ?? 0;
        const attackPct = params.counterAttackPct ?? 0;
        const maxHpPct = params.counterMaxHpPct ?? 0;
        const bodySizePct = params.counterBodySizePct ?? 0;
        if (moveSpeedPct) mods.moveSpeedPct = moveSpeedPct;
        if (attackPct) mods.attackPct = attackPct;
        if (maxHpPct) mods.maxHpPct = maxHpPct;
        if (bodySizePct) mods.bodySizePct = bodySizePct;
        if (!(seconds > 0) || !Object.keys(mods).length) return false;

        unit.counterFiredCount = done;
        this.markCastAction(unit, now, true);
        const statusId = selfCastStatusId(mods, seconds);
        if (!context.statusSystem.hasDef(statusId)) {
            context.statusSystem.register({
                id: statusId,
                name: statusId,
                durationSeconds: seconds,
                maxStacks: 1,
                refreshPolicy: 'refresh',
                statMods: mods,
                behavior: { kind: 'none' },
            });
        }
        const result = context.statusSystem.apply(String(unit.id), statusId, {
            at: state.elapsedSeconds, durationSeconds: seconds,
        });
        // 回血按增益生效后的 maxHp 计算
        const healPct = Math.max(0, params.counterHealMaxHpPct ?? 0);
        if (healPct > 0 && context.healUnit) context.healUnit(unit, unit.maxHp * healPct / 100);
        return result.applied;
    }

    private static applyBoltStrike(
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
        release: boolean | (() => boolean),
    ): void {
        if (!context.castBolt || !params) return;
        const cooldown = Math.max(0, params.boltCooldown ?? 0);
        if (!(cooldown > 0)) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`bolt-params:${unit.id}`, '触发',
                    `${unit.unitId}#${unit.id} 五雷轰顶没有 boltCooldown`
                    + `（读到 ${params.boltCooldown ?? 'undefined'}）⇒ 这条车道整段不执行`);
            }
            return;
        }
        const readyAt = unit.boltReadyAt;
        if (readyAt === undefined) {
            unit.boltReadyAt = now + cooldown;
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogOnce(`bolt-arm:${unit.id}`, '触发',
                    `${unit.unitId}#${unit.id} 五雷轰顶冷却挂上：${now.toFixed(1)}s → `
                    + `${(now + cooldown).toFixed(1)}s 首次可施放（cooldown=${cooldown}s）`);
            }
            return;
        }
        if (now < readyAt) return;
        if (typeof release === 'function' ? !release() : !release) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`bolt-pending:${unit.id}`, '触发',
                    `${unit.unitId}#${unit.id} ${now.toFixed(1)}s 冷却已就绪但普攻范围内没有目标 ⇒ 待触发`);
            }
            return;
        }
        const cast = context.castBolt(unit);
        if (zcSkillCastWatched(unit.unitId)) {
            skillCastLogChanging(`bolt-cast:${unit.id}`, '触发', cast
                ? `${unit.unitId}#${unit.id} ${now.toFixed(1)}s 放雷成功，CD 推到 ${(now + cooldown).toFixed(1)}s`
                : `${unit.unitId}#${unit.id} ${now.toFixed(1)}s 放雷被拒（参数不全 / 无锁定目标）⇒ 不消费 CD，下帧重试`);
        }
        if (!cast) return;
        unit.boltReadyAt = now + cooldown;
        this.markCastAction(unit, now, false);
    }

    private static applyChainLightning(
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
        release: boolean | (() => boolean),
    ): void {
        if (!context.castChainLightning || !params) return;
        const cooldown = Math.max(0, params.chainCooldown ?? 0);
        if (!(cooldown > 0)) return;
        const readyAt = unit.chainReadyAt;
        if (readyAt === undefined) {
            unit.chainReadyAt = now + cooldown;
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogOnce(`chain-arm:${unit.id}`, '触发',
                    `${unit.unitId}#${unit.id} 闪电链冷却挂上：${now.toFixed(1)}s → `
                    + `${(now + cooldown).toFixed(1)}s 首次可施放（cooldown=${cooldown}s）`);
            }
            return;
        }
        if (now < readyAt) return;
        if (typeof release === 'function' ? !release() : !release) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`chain-pending:${unit.id}`, '触发',
                    `${unit.unitId}#${unit.id} ${now.toFixed(1)}s 冷却已就绪但普攻范围内没有目标 ⇒ 待触发`);
            }
            return;
        }
        const cast = context.castChainLightning(unit);
        if (zcSkillCastWatched(unit.unitId)) {
            skillCastLogChanging(`chain-cast:${unit.id}`, '触发', cast
                ? `${unit.unitId}#${unit.id} ${now.toFixed(1)}s 闪电链放出，CD 推到 ${(now + cooldown).toFixed(1)}s`
                : `${unit.unitId}#${unit.id} ${now.toFixed(1)}s 闪电链被拒（参数不全 / 无存活单位目标）`
                    + ` ⇒ 不消费 CD，下帧重试`);
        }
        if (!cast) return;
        unit.chainReadyAt = now + cooldown;
        this.markCastAction(unit, now, false);
    }

    private static applyRoar(
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
    ): void {
        if (!context.castRoar || !params) return;
        const cooldown = Math.max(0, params.roarCooldown ?? 0);
        if (!(cooldown > 0)) return;
        const readyAt = unit.roarReadyAt;
        if (readyAt === undefined) {
            unit.roarReadyAt = now + cooldown;
            return;
        }
        if (now < readyAt) return;
        const cast = context.castRoar(unit);
        if (zcSkillCastWatched(unit.unitId)) {
            skillCastLogChanging(`roar-cd:${unit.id}`, '触发', cast
                ? `${unit.unitId}#${unit.id} ${now.toFixed(1)}s 怒吼放出，CD 推到 ${(now + cooldown).toFixed(1)}s`
                : `${unit.unitId}#${unit.id} ${now.toFixed(1)}s 怒吼被拒（参数不全 / 半径内无敌人）`
                    + ' ⇒ 不消费 CD，下帧重试');
        }
        if (!cast) return;
        unit.roarReadyAt = now + cooldown;
        this.markCastAction(unit, now, false);
    }

    private static applyStorm(
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
        release: boolean | (() => boolean),
    ): void {
        if (!context.castStorm || !params) return;
        const cooldown = Math.max(0, params.stormCooldown ?? 0);
        if (!(cooldown > 0)) return;
        const readyAt = unit.stormReadyAt;
        if (readyAt === undefined) {
            unit.stormReadyAt = now + cooldown;
            return;
        }
        if (now < readyAt) return;
        if (typeof release === 'function' ? !release() : !release) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`storm-pending:${unit.id}`, '触发',
                    `${unit.unitId}#${unit.id} ${now.toFixed(1)}s 冷却已就绪但普攻范围内没有目标 ⇒ 待触发`);
            }
            return;
        }
        // 二次校验活体敌人，防止仅锁城墙时误触发
        const reach = context.attackReachOf?.(unit);
        const nearest = context.nearestEnemyDistance?.(unit);
        if (reach !== undefined && nearest !== undefined && !(nearest <= reach)) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`storm-pending:${unit.id}`, '触发',
                    `${unit.unitId}#${unit.id} ${now.toFixed(1)}s 冷却已就绪，但普攻射程 `
                    + `${reach.toFixed(1)} px 内没有活敌（最近 ${nearest.toFixed(1)} px，多半只在打墙）⇒ 待触发`);
            }
            return;
        }
        const cast = context.castStorm(unit);
        if (zcSkillCastWatched(unit.unitId)) {
            skillCastLogChanging(`storm-cd:${unit.id}`, '触发', cast
                ? `${unit.unitId}#${unit.id} ${now.toFixed(1)}s 放出飓风，CD 推到 ${(now + cooldown).toFixed(1)}s`
                : `${unit.unitId}#${unit.id} ${now.toFixed(1)}s 飓风被拒（参数不全）⇒ 不消费 CD，下帧重试`);
        }
        if (!cast) return;
        unit.stormReadyAt = now + cooldown;
        this.markCastAction(unit, now, false);
    }

    private static applyRayBeam(
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
        release: boolean | (() => boolean),
    ): void {
        if (!context.castRayBeam || !params) return;
        const every = Math.max(0, Math.round(params.rayEvery ?? 0));
        if (!(every > 0)) return;
        const done = unit.completedAttackCount ?? 0;
        const fired = unit.rayFiredCount;
        if (fired === undefined) { unit.rayFiredCount = done; return; }
        if (done - fired < every) return;
        if (typeof release === 'function' ? !release() : !release) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`ray-pending:${unit.id}`, '触发',
                    `${unit.unitId}#${unit.id} ${now.toFixed(1)}s 累计普攻已满 ${every} 次但射程内没有目标 ⇒ 待触发`);
            }
            return;
        }
        const vulnPct = Math.max(0, params.rayVulnPct ?? 0);
        let vulnStatusId: string | undefined;
        if (vulnPct > 0) {
            const seconds = Math.max(0.05, params.rayVulnSeconds ?? 0.3);
            vulnStatusId = `__rayvuln:${vulnPct.toFixed(4)}:${seconds.toFixed(2)}__`;
            if (!context.statusSystem.hasDef(vulnStatusId)) {
                context.statusSystem.register({
                    id: vulnStatusId,
                    name: vulnStatusId,
                    durationSeconds: seconds,
                    maxStacks: 1,
                    refreshPolicy: 'refresh',
                    statMods: { damageTakenPct: vulnPct },
                    behavior: { kind: 'none' },
                });
            }
        }
        const cast = context.castRayBeam(unit, vulnStatusId);
        if (zcSkillCastWatched(unit.unitId)) {
            skillCastLogChanging(`ray-cast:${unit.id}`, '触发', cast
                ? `${unit.unitId}#${unit.id} ${now.toFixed(1)}s 射出射线，次数记到 ${done}`
                : `${unit.unitId}#${unit.id} ${now.toFixed(1)}s 射线被拒（参数不全）⇒ 不消费次数，下帧重试`);
        }
        if (!cast) return;
        unit.rayFiredCount = done;
        this.markCastAction(unit, now, false);
    }

    private static applyFireZone(
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
        release: boolean | (() => boolean),
    ): void {
        if (!context.castFireZone || !params) return;
        const every = Math.max(0, Math.round(params.fireEvery ?? 0));
        if (!(every > 0)) return;
        const done = unit.completedAttackCount ?? 0;
        const fired = unit.fireFiredCount;
        if (fired === undefined) { unit.fireFiredCount = done; return; }
        if (done - fired < every) return;
        if (typeof release === 'function' ? !release() : !release) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`fire-pending:${unit.id}`, '触发',
                    `${unit.unitId}#${unit.id} ${now.toFixed(1)}s 累计普攻已满 ${every} 次但射程内没有目标 ⇒ 待触发`);
            }
            return;
        }
        const cast = context.castFireZone(unit);
        if (zcSkillCastWatched(unit.unitId)) {
            skillCastLogChanging(`fire-cast:${unit.id}`, '触发', cast
                ? `${unit.unitId}#${unit.id} ${now.toFixed(1)}s 撒下火焰区域，次数记到 ${done}`
                : `${unit.unitId}#${unit.id} ${now.toFixed(1)}s 文明之火被拒（参数不全）⇒ 不消费次数，下帧重试`);
        }
        if (!cast) return;
        unit.fireFiredCount = done;
        this.markCastAction(unit, now, false);
    }

    /**
     * 腾云驾雾（dash_chain）：强化攻击连环突进，按起手固定的目标列表依次位移打击后返回初目标位置。
     * 结算走 strike 不推进普攻计数；中途目标死亡直接跳过该段。
     */
    private static applyDashChain(
        state: ZCSnapshot,
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        dt: number,
        context: IZCSkillTriggerContext,
    ): void {
        if (!context.blinkTo || !context.strike || !params) return;
        const speedTable = Math.max(0, params.dashChainSpeed ?? 0);
        if (!(speedTable > 0)) return;
        const scale = Math.max(1e-6, context.distanceScale ?? 1);
        const speed = speedTable * scale;
        if (!(speed > 0)) return;
        const posOf = (target: ZCUnitState): { x: number; y: number } => (context.unitPosition
            ? { ...context.unitPosition(target) }
            : { x: target.freeX, y: target.freeY });
        const alive = (target: ZCUnitState | undefined): target is ZCUnitState => !!target
            && target.battleState !== 'dead' && target.hp > 0;

        if (unit.dashChainPendingAt !== undefined) {
            const targetId = unit.dashChainTargetId;
            delete unit.dashChainPendingAt;
            delete unit.dashChainTargetId;
            const first = targetId === undefined
                ? undefined
                : state.units.find((candidate) => candidate.id === targetId);
            if (!alive(first) || first.owner === unit.owner) {
                this.clearDashChain(unit);
                return;
            }
            const origin = posOf(first);
            const want = Math.max(1, Math.round(params.dashChainCount ?? 1));
            const spread = Math.max(0, params.dashChainSpreadRadius ?? 0) * scale;
            const ids = [first.id];
            if (want > 1 && spread > 0) {
                // 索敌圆心固定在初目标处，不从当前施法者位置量距
                const picks: Array<{ id: number; gap: number }> = [];
                for (const candidate of state.units) {
                    if (candidate.id === first.id || candidate.owner === unit.owner) continue;
                    if (!alive(candidate)) continue;
                    const pos = posOf(candidate);
                    const gap = Math.hypot(pos.x - origin.x, pos.y - origin.y);
                    if (gap > spread) continue;
                    picks.push({ id: candidate.id, gap });
                }
                picks.sort((a, b) => a.gap - b.gap || a.id - b.id);
                for (const pick of picks) {
                    if (ids.length >= want) break;
                    ids.push(pick.id);
                }
            }
            unit.dashChainIds = ids;
            unit.dashChainIndex = 0;
            unit.dashChainReturnX = origin.x;
            unit.dashChainReturnY = origin.y;
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`dash-begin:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} 腾云驾雾起手：${ids.length} 段（${ids.join('→')}），`
                    + `回程落点 ${origin.x.toFixed(1)},${origin.y.toFixed(1)}`);
            }
        }

        const ids = unit.dashChainIds;
        const index = unit.dashChainIndex;
        if (!ids || index === undefined || index < 0) return;

        const self = posOf(unit);
        const step = speed * dt;

        // 全段完成后返回首个目标的初始位置
        if (index >= ids.length) {
            const backX = unit.dashChainReturnX;
            const backY = unit.dashChainReturnY;
            if (backX === undefined || backY === undefined) { this.clearDashChain(unit); return; }
            const gap = Math.hypot(backX - self.x, backY - self.y);
            if (gap <= step || gap <= 1e-6) {
                context.blinkTo(unit, backX, backY);
                this.clearDashChain(unit);
                return;
            }
            context.blinkTo(unit, self.x + (backX - self.x) / gap * step, self.y + (backY - self.y) / gap * step);
            return;
        }

        const victim = state.units.find((candidate) => candidate.id === ids[index]);
        if (!alive(victim) || victim.owner === unit.owner) {
            unit.dashChainIndex = index + 1;
            return;
        }
        const target = posOf(victim);
        const dx = target.x - self.x;
        const dy = target.y - self.y;
        const length = Math.hypot(dx, dy);
        const stop = Math.max(0, params.dashChainStopDistance ?? 30) * scale;
        const landX = length > stop && length > 1e-9 ? target.x - dx / length * stop : target.x;
        const landY = length > stop && length > 1e-9 ? target.y - dy / length * stop : target.y;
        const gap = Math.hypot(landX - self.x, landY - self.y);

        if (gap > step && gap > 1e-6) {
            context.blinkTo(unit, self.x + (landX - self.x) / gap * step, self.y + (landY - self.y) / gap * step);
            return;
        }

        context.blinkTo(unit, landX, landY);
        const damageRate = Math.max(0, params.dashChainDamageRate ?? 0);
        const hitRadius = Math.max(1, Math.max(0, params.dashChainHitRadius ?? 40) * scale);
        if (damageRate > 0) {
            // origin 锚定目标坐标，防止贴脸时命中判定落到更近的旁侧单位
            context.strike(unit, {
                count: 1, radius: hitRadius, damageRate, nearest: true,
                origin: { x: target.x, y: target.y },
            });
        }
        // 纯表现事件，伤害已由 strike 结算
        state.combatEvents.push({
            id: state.nextCombatEventId++,
            type: ZCCombatEventType.Melee,
            owner: unit.owner,
            sourceUnitId: unit.id,
            targetUnitId: victim.id,
            skillId: 0,
            skillName: 'dash_chain',
            effectKey: null,
            projectileKey: null,
            effectPrefabPath: ZC_QUAKE_STRIKE_PREFAB_PATH,
            fromX: self.x,
            fromY: self.y,
            toX: target.x,
            toY: target.y,
            radius: 0,
            damage: 0,
            empowered: false,
            startedAt: now,
            durationSeconds: ZC_QUAKE_STRIKE_SECONDS,
        });
        this.markCastAction(unit, now, false);
        unit.dashChainIndex = index + 1;
    }

    /** 清理序列字段（dashChainIndex 存在期间 ZCUnitSystem 会冻结单位） */
    private static clearDashChain(unit: ZCUnitState): void {
        delete unit.dashChainPendingAt;
        delete unit.dashChainTargetId;
        delete unit.dashChainIds;
        delete unit.dashChainIndex;
        delete unit.dashChainReturnX;
        delete unit.dashChainReturnY;
    }

    private static applySummonUnit(
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
    ): void {
        if (!context.castSummon || !params) return;
        const every = Math.max(0, Math.round(params.summonEvery ?? 0));
        if (every > 0) {
            this.applySummonByCount(unit, every, now, context);
            return;
        }
        const cooldown = Math.max(0, params.summonCooldown ?? 0);
        if (!(cooldown > 0)) return;
        const readyAt = unit.summonReadyAt;
        if (readyAt === undefined) {
            unit.summonReadyAt = now + cooldown;
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogOnce(`summon-arm:${unit.id}`, '触发',
                    `${unit.unitId}#${unit.id} 召唤冷却挂上：${now.toFixed(1)}s → `
                    + `${(now + cooldown).toFixed(1)}s 首次可召唤（cooldown=${cooldown}s）`);
            }
            return;
        }
        if (now < readyAt) return;
        const cast = context.castSummon(unit);
        if (zcSkillCastWatched(unit.unitId)) {
            skillCastLogChanging(`summon-cast:${unit.id}`, '触发', cast
                ? `${unit.unitId}#${unit.id} ${now.toFixed(1)}s 召唤成功，CD 推到 ${(now + cooldown).toFixed(1)}s`
                : `${unit.unitId}#${unit.id} ${now.toFixed(1)}s 召唤被拒（参数不全）⇒ 不消费 CD，下帧重试`);
        }
        if (!cast) return;
        unit.summonReadyAt = now + cooldown;
        this.markCastAction(unit, now, false);
    }

    private static applySummonByCount(
        unit: ZCUnitState,
        every: number,
        now: number,
        context: IZCSkillTriggerContext,
    ): void {
        const done = unit.completedAttackCount ?? 0;
        const fired = unit.summonFiredCount;
        if (fired === undefined) {
            unit.summonFiredCount = done;
            return;
        }
        if (done - fired < every) return;
        const cast = context.castSummon!(unit);
        if (zcSkillCastWatched(unit.unitId)) {
            skillCastLogChanging(`summon-count:${unit.id}`, '触发', cast
                ? `${unit.unitId}#${unit.id} 累计普攻 ${done} 次（阈值 ${every}）⇒ 召唤成功`
                : `${unit.unitId}#${unit.id} 累计普攻 ${done} 次但召唤被拒（参数不全）`
                    + ' ⇒ 不消费次数，下帧重试');
        }
        if (!cast) return;
        unit.summonFiredCount = done;
        this.markCastAction(unit, now, false);
    }

    /** 精密陷阱 / 投掷陷阱（不设普攻射程闸门） */
    private static applyTrap(
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
    ): void {
        if (!context.castTrap || !params) return;
        const every = Math.max(0, Math.round(params.trapEvery ?? 0));
        if (every > 0) {
            this.applyTrapByCount(unit, every, now, context);
            return;
        }
        const cooldown = Math.max(0, params.trapCooldown ?? 0);
        if (!(cooldown > 0)) {
            if (zcSkillCastWatched(unit.unitId)) {
                const declared = Object.keys(params).some((key) => key.startsWith('trap'));
                if (declared) {
                    skillCastLogChanging(`trap-params:${unit.id}`, '触发',
                        `${unit.unitId}#${unit.id} 精密陷阱没有 trapCooldown`
                        + `（读到 ${params.trapCooldown ?? 'undefined'}）⇒ 这条车道整段不执行`);
                }
            }
            return;
        }
        const readyAt = unit.trapReadyAt;
        if (readyAt === undefined) {
            unit.trapReadyAt = now + cooldown;
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogOnce(`trap-arm:${unit.id}`, '触发',
                    `${unit.unitId}#${unit.id} 精密陷阱冷却挂上：${now.toFixed(1)}s → `
                    + `${(now + cooldown).toFixed(1)}s 首次可布置（cooldown=${cooldown}s）`);
            }
            return;
        }
        if (now < readyAt) return;
        const cast = context.castTrap(unit);
        if (zcSkillCastWatched(unit.unitId)) {
            skillCastLogChanging(`trap-cast:${unit.id}`, '触发', cast
                ? `${unit.unitId}#${unit.id} ${now.toFixed(1)}s 放下陷阱，CD 推到 ${(now + cooldown).toFixed(1)}s`
                : `${unit.unitId}#${unit.id} ${now.toFixed(1)}s 放陷阱被拒（参数不全）⇒ 不消费 CD，下帧重试`);
        }
        if (!cast) return;
        unit.trapReadyAt = now + cooldown;
        this.markCastAction(unit, now, false);
    }

    private static applyTrapByCount(
        unit: ZCUnitState,
        every: number,
        now: number,
        context: IZCSkillTriggerContext,
    ): void {
        if (!context.castTrap) return;
        const done = unit.completedAttackCount ?? 0;
        const fired = unit.trapFiredCount;
        if (fired === undefined) {
            unit.trapFiredCount = done;
            return;
        }
        if (done - fired < every) return;
        if (!context.castTrap(unit)) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`trap-partial:${unit.id}`, '触发',
                    `${unit.unitId}#${unit.id} 攒满 ${every} 次但陷阱参数不全 ⇒ 不消费次数，下帧重试`);
            }
            return;
        }
        unit.trapFiredCount = done;
        if (zcSkillCastWatched(unit.unitId)) {
            skillCastLogChanging(`trap-count:${unit.id}`, '触发',
                `${unit.unitId}#${unit.id} 累计普攻 ${done} 次（上次 ${fired}）⇒ 丢出陷阱`);
        }
        this.markCastAction(unit, now, false);
    }

    /** 范围投射物；参数使用 shot 前缀避免与普攻溅射键 splashRadius 混淆 */
    private static applySplashShot(
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
        release: boolean | (() => boolean),
    ): void {
        if (!context.castSplashShot || !params) return;
        const cooldown = Math.max(0, params.shotCooldown ?? 0);
        if (!(cooldown > 0)) return;
        const readyAt = unit.splashReadyAt;
        if (readyAt === undefined) {
            unit.splashReadyAt = now + cooldown;
            return;
        }
        if (now < readyAt) return;
        if (typeof release === 'function' ? !release() : !release) return;
        const slowStatusId = this.splashShotSlowStatusId(params, context);
        if (!context.castSplashShot(unit, slowStatusId)) return;
        unit.splashReadyAt = now + cooldown;
        this.markCastAction(unit, now, false);
    }

    private static splashShotSlowStatusId(
        params: Readonly<Record<string, number>> | undefined,
        context: IZCSkillTriggerContext,
    ): string | undefined {
        if (!params) return undefined;
        const slowPct = Math.max(0, Math.min(100, params.shotSlowRatio ?? 0));
        const seconds = Math.max(0, params.shotSlowSeconds ?? 0);
        if (!(slowPct > 0) || !(seconds > 0)) return undefined;
        const statusId = splashShotSlowStatusId(slowPct, seconds);
        if (!context.statusSystem.hasDef(statusId)) {
            context.statusSystem.register({
                id: statusId,
                name: statusId,
                durationSeconds: seconds,
                maxStacks: 1,
                refreshPolicy: 'refresh',
                statMods: { moveSpeedPct: -slowPct },
                behavior: { kind: 'none' },
            });
        }
        return statusId;
    }

    private static applyWindShot(
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
        release: boolean | (() => boolean),
    ): void {
        if (!context.castWindBolt || !params) return;
        const cooldown = Math.max(0, params.windCooldown ?? 0);
        if (!(cooldown > 0)) return;
        const readyAt = unit.windReadyAt;
        if (readyAt === undefined) {
            unit.windReadyAt = now + cooldown;
            return;
        }
        if (now < readyAt) return;
        if (typeof release === 'function' ? !release() : !release) return;
        if (!context.castWindBolt(unit)) return;
        unit.windReadyAt = now + cooldown;
        this.markCastAction(unit, now, false);
    }

    private static applyMissileBarrage(
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
        release: boolean | (() => boolean),
    ): void {
        if (!context.castBarrageShot || !params) return;
        const interval = Math.max(0.05, params.barrageInterval ?? ZC_BARRAGE_DEFAULT_INTERVAL);
        const left = unit.barrageShotsLeft ?? 0;
        if (left > 0) {
            if (now < (unit.barrageNextAt ?? 0)) return;
            context.castBarrageShot(unit);
            unit.barrageShotsLeft = left - 1;
            unit.barrageNextAt = now + interval;
            if (unit.barrageShotsLeft <= 0) {
                delete unit.barrageShotsLeft;
                delete unit.barrageNextAt;
            }
            return;
        }
        const every = Math.max(0, Math.round(params.barrageEvery ?? 0));
        if (!(every > 0)) return;
        const done = unit.completedAttackCount ?? 0;
        const fired = unit.barrageFiredCount;
        if (fired === undefined) { unit.barrageFiredCount = done; return; }
        if (done - fired < every) return;
        if (typeof release === 'function' ? !release() : !release) return;
        if (!context.castBarrageShot(unit)) return;
        unit.barrageFiredCount = done;
        const count = Math.max(1, Math.round(params.barrageCount ?? 1));
        if (count > 1) {
            unit.barrageShotsLeft = count - 1;
            unit.barrageNextAt = now + interval;
        }
        // 原地站定持续到本轮最后一发弹射结束
        this.markCastAction(unit, now, true);
        unit.castHoldUntil = now + interval * (count - 1) + ZC_SELF_CAST_HOLD_SECONDS;
    }

    private static applyBurstSkill(
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
        lane: 'burst' | 'venom' = 'burst',
    ): void {
        if (!context.castBurstSkill || !params) return;
        const cooldown = Math.max(0, params[`${lane}Cooldown`] ?? 0);
        if (!(cooldown > 0)) return;
        const readyField = lane === 'venom' ? 'venomReadyAt' : 'burstReadyAt';
        const readyAt = unit[readyField];
        if (readyAt === undefined) {
            unit[readyField] = now + cooldown;
            return;
        }
        if (now < readyAt) return;
        const guardStatusId = lane === 'burst' ? this.burstGuardStatusId(params, context) : undefined;
        if (!context.castBurstSkill(unit, guardStatusId, lane)) return;
        unit[readyField] = now + cooldown;
        this.markCastAction(unit, now, false);
    }

    /** 爆发护盾附带减伤状态；按持续时间直接生效，不因破盾提前移除 */
    private static burstGuardStatusId(
        params: Readonly<Record<string, number>> | undefined,
        context: IZCSkillTriggerContext,
    ): string | undefined {
        if (!params) return undefined;
        const reducePct = Math.max(0, Math.min(95, params.burstShieldReducePct ?? 0));
        const seconds = Math.max(0, params.burstShieldSeconds ?? 0);
        if (!(reducePct > 0) || !(seconds > 0)) return undefined;
        const statusId = burstGuardStatusId(reducePct, seconds);
        if (!context.statusSystem.hasDef(statusId)) {
            context.statusSystem.register({
                id: statusId,
                name: statusId,
                durationSeconds: seconds,
                maxStacks: 1,
                refreshPolicy: 'refresh',
                statMods: { damageTakenPct: -reducePct },
                behavior: { kind: 'none' },
            });
        }
        return statusId;
    }

    private static applyFanSweep(
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
    ): void {
        if (!context.castFanSweep || !params) return;
        const cooldown = Math.max(0, params.fanCooldown ?? 0);
        if (!(cooldown > 0)) return;
        const readyAt = unit.fanReadyAt;
        if (readyAt === undefined) {
            unit.fanReadyAt = now + cooldown;
            return;
        }
        if (now < readyAt) return;
        // 扇形半径常大于普攻射程，按自身半径独立判闸门
        const radiusTable = Math.max(0, params.fanRadius ?? 0);
        if (radiusTable > 0 && context.nearestEnemyDistance) {
            const limit = radiusTable * Math.max(1e-6, context.distanceScale ?? 1);
            const nearest = context.nearestEnemyDistance(unit);
            if (nearest > limit) {
                if (zcSkillCastWatched(unit.unitId)) {
                    skillCastLogChanging(`fan-pending:${unit.id}`, '触发',
                        `${unit.unitId}#${unit.id} ${now.toFixed(1)}s 冷却已就绪但扇形半径内没有目标`
                        + `（最近 ${nearest.toFixed(1)} 世界 px > ${limit.toFixed(1)}）⇒ 待触发`);
                }
                return;
            }
        }
        const slowStatusId = this.fanSweepSlowStatusId(params, context);
        if (!context.castFanSweep(unit, slowStatusId)) return;
        unit.fanReadyAt = now + cooldown;
        this.markCastAction(unit, now, false);
    }

    private static fanSweepSlowStatusId(
        params: Readonly<Record<string, number>> | undefined,
        context: IZCSkillTriggerContext,
    ): string | undefined {
        if (!params) return undefined;
        const slowPct = Math.max(0, Math.min(100, params.fanSlowRatio ?? 0));
        const seconds = Math.max(0, params.fanSlowSeconds ?? 0);
        if (!(slowPct > 0) || !(seconds > 0)) return undefined;
        const statusId = fanSweepSlowStatusId(slowPct, seconds);
        if (!context.statusSystem.hasDef(statusId)) {
            context.statusSystem.register({
                id: statusId,
                name: statusId,
                durationSeconds: seconds,
                maxStacks: 1,
                refreshPolicy: 'refresh',
                statMods: { moveSpeedPct: -slowPct },
                behavior: { kind: 'none' },
            });
        }
        return statusId;
    }

    private static applyRandomStrike(
        state: ZCSnapshot,
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
        release: boolean | (() => boolean),
    ): void {
        if (!context.strike || !params) return;
        const count = Math.max(0, params.strikeCount ?? 0);
        const radius = Math.max(0, params.strikeRadius ?? 0);
        if (!(count >= 1) || !(radius > 0)) return;
        const cooldown = Math.max(0, params.strikeCooldown ?? 0);
        const every = Math.max(0, params.strikeEvery ?? 0);
        if (!(cooldown > 0) && !(every > 0)) return;
        const scale = Math.max(1e-6, context.distanceScale ?? 1);
        const reachCap = params.strikeTargetMode === 2 ? Number.POSITIVE_INFINITY : Math.max(0, context.attackReachOf?.(unit) ?? Number.POSITIVE_INFINITY);
        const searchRadius = params.strikeTargetMode === 2 ? Number.POSITIVE_INFINITY : Math.min(radius * scale, reachCap);
        const missileFx = zcMissileFxOf(unit.unitId);
        if (missileFx) {
            missileLogOnce(`strike-params:${unit.unitId}`,
                '模型',
                `单位 ${unit.unitId} 拿到导弹参数：strikeCount=${count} strikeRadius=${radius}`
                + `（世界 ${(radius * scale).toFixed(1)}，封顶后 ${searchRadius.toFixed(1)}）`
                + ` cooldown=${cooldown} every=${every}`
                + ` nearest=${params.strikeNearest ?? 0} splash=${params.strikeSplashRadius ?? 0}`
                + ` | 弹体=${missileFx.missilePrefabPath} 爆炸=${missileFx.impactPrefabPath}`);
        }
        const fire = (): boolean => {
            const options: IZCStrikeOptions = {
                count: Math.round(count),
                radius: searchRadius,
                damageRate: Math.max(0, params.strikeDamageRate ?? 1),
                nearest: (params.strikeNearest ?? 0) > 0,
                splashRadius: Math.max(0, params.strikeSplashRadius ?? 0) * scale,
                splashDamageRate: Math.max(0, params.strikeSplashDamageRate ?? 0),
                splashFalloff: Math.max(0, Math.min(1, params.strikeSplashFalloff ?? 0)),
                // 需显式开启 strikeAppliesStatus；使用专用状态 ID 防止与普攻复用同一状态槽
                statusId: (params.strikeAppliesStatus ?? 0) > 0 ? ZC_STRIKE_NUMB_STATUS_ID : undefined,
                missilePrefabPath: missileFx?.missilePrefabPath,
                impactPrefabPath: missileFx?.impactPrefabPath,
                arcOffset: missileFx?.arcOffset ?? 0,
                missileSpeed: missileFx?.speed,
                missileCount: missileFx?.count,
            };
            const hits = context.strike!(unit, options);
            if (missileFx) {
                missileLogChanging(`strike-fire:${unit.id}`,
                    '模型',
                    hits > 0
                        ? `单位 ${unit.unitId}#${unit.id} 开火成功：命中/发出 ${hits} 个（搜索半径 ${options.radius.toFixed(1)}）`
                        : `单位 ${unit.unitId}#${unit.id} 开火失败：搜索半径 ${options.radius.toFixed(1)} 内没有可用目标`
                        + `（包围盒内敌人不足 / 全在半径外）⇒ strike() 返回 0 ⇒ 冷却不推进，会每帧重试`);
            }
            if (hits > 0) this.markCastAction(unit, now, false);
            return hits > 0;
        };
        const windowSeconds = Math.max(0, params.strikeSeconds ?? 0);
        const interval = Math.max(0.05, params.strikeInterval ?? 1);

        const until = unit.strikeUntil;
        if (until != null && now < until) {
            if (now < (unit.strikeNextAt ?? 0)) return;
            fire();
            unit.strikeNextAt = now + interval;
            return;
        }
        if (until != null) {
            delete unit.strikeUntil;
            delete unit.strikeNextAt;
        }

        if (cooldown > 0) {
            const readyAt = unit.strikeReadyAt;
            if (readyAt === undefined) {
                // 追踪导弹按 unit.id 错开首轮相位
                const phase = missileFx
                    ? (unit.id % STRIKE_PHASE_SLOTS) * STRIKE_PHASE_STRIDE
                    : 0;
                unit.strikeReadyAt = now + cooldown + phase;
                if (missileFx) {
                    missileLog('模型', `#${unit.id} 追踪导弹冷却挂上：${now.toFixed(1)}s → `
                        + `${(now + cooldown + phase).toFixed(1)}s 首次可开火`
                        + `（cooldown=${cooldown}s + 错峰 ${phase.toFixed(2)}s）`);
                }
                return;
            }
            if (now < readyAt) return;
            if (typeof release === 'function' ? !release() : !release) return;
            if (now < (unit.strikeRetryAt ?? 0)) return;
            if (!fire()) {
                unit.strikeRetryAt = now + STRIKE_RETRY_SECONDS
                    + (missileFx ? (unit.id % STRIKE_RETRY_SLOTS) * STRIKE_RETRY_JITTER : 0);
                return;
            }
            delete unit.strikeRetryAt;
            unit.strikeReadyAt = now + cooldown;
            if (windowSeconds > 0) {
                unit.strikeUntil = now + windowSeconds;
                unit.strikeNextAt = now + interval;
            }
            return;
        }
        const done = unit.completedAttackCount ?? 0;
        const fired = unit.strikeFiredCount;
        if (fired === undefined) { unit.strikeFiredCount = done; return; }
        if (done - fired < Math.round(every)) return;
        if (typeof release === 'function' ? !release() : !release) return;
        if (!fire()) return;
        unit.strikeFiredCount = done;
        if (windowSeconds > 0) {
            unit.strikeUntil = now + windowSeconds;
            unit.strikeNextAt = now + interval;
        }
    }

    private static applyBlinkStrike(
        state: ZCSnapshot,
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
        runtime?: ZCSkillRuntimeDefinition,
        release: boolean | (() => boolean) = true,
    ): void {
        if (!params) return;
        const cooldown = Math.max(0, params.blinkCooldown ?? 0);
        if (!(cooldown > 0)) return;
        const scale = Math.max(1e-6, context.distanceScale ?? 1);
        const posOf = (target: ZCUnitState): { x: number; y: number } => (context.unitPosition
            ? { ...context.unitPosition(target) }
            : { x: target.freeX, y: target.freeY });

        // 先结算到点分身再判本次冷却，防止往返与分身同帧时分身延迟一轮
        const cloneAt = unit.blinkCloneAt;
        if (cloneAt != null && now >= cloneAt) {
            const radius = Math.max(0, params.blinkCloneRadius ?? 0) * scale;
            const rate = Math.max(0, params.blinkCloneDamageRate ?? 0);
            if (radius > 0 && rate > 0 && context.strike) {
                context.strike(unit, {
                    count: BLINK_CLONE_MAX_TARGETS,
                    radius,
                    damageRate: rate,
                    nearest: true,
                    origin: {
                        x: unit.blinkCloneX ?? unit.freeX,
                        y: unit.blinkCloneY ?? unit.freeY,
                    },
                });
            }
            delete unit.blinkCloneAt;
            delete unit.blinkCloneX;
            delete unit.blinkCloneY;
        }

        if (!context.blinkTo || !context.strike) return;
        const readyAt = unit.blinkReadyAt;
        if (readyAt === undefined) { unit.blinkReadyAt = now + cooldown; return; }
        if (now < readyAt) return;

        if (typeof release === 'function' ? !release() : !release) return;
        const reachCap = params.blinkTargetMode === 2 ? Number.POSITIVE_INFINITY : Math.max(0, context.attackReachOf?.(unit) ?? Number.POSITIVE_INFINITY);
        const searchRadius = params.blinkTargetMode === 2 ? Number.POSITIVE_INFINITY : Math.min(Math.max(0, params.blinkSearchRadius ?? 0) * scale, reachCap);
        if (!(searchRadius > 0)) return;
        const self = posOf(unit);
        let victim: ZCUnitState | undefined;
        let best = Number.POSITIVE_INFINITY;
        for (const candidate of state.units) {
            if (candidate.owner === unit.owner || candidate.battleState === 'dead' || candidate.hp <= 0) continue;
            const pos = posOf(candidate);
            const gap = Math.hypot(pos.x - self.x, pos.y - self.y);
            if (gap > searchRadius || gap >= best) continue;
            best = gap;
            victim = candidate;
        }
        if (!victim) return;

        const target = posOf(victim);
        const dx = target.x - self.x;
        const dy = target.y - self.y;
        const length = Math.hypot(dx, dy);
        const stop = Math.max(0, params.blinkStopDistance ?? 30) * scale;
        const landX = length > stop && length > 1e-9 ? target.x - dx / length * stop : target.x;
        const landY = length > stop && length > 1e-9 ? target.y - dy / length * stop : target.y;
        const hitRadius = Math.max(1, Math.max(0, params.blinkHitRadius ?? 40) * scale);
        const damageRate = Math.max(0, params.blinkDamageRate ?? 0);

        // 出发地特效（必须在 blinkTo 前取 self 起点）
        state.combatEvents.push({
            id: state.nextCombatEventId++,
            type: ZCCombatEventType.Melee,
            owner: unit.owner,
            sourceUnitId: unit.id,
            targetUnitId: null,
            skillId: runtime?.skillId ?? 0,
            skillName: runtime?.behaviorKey ?? 'blink_strike',
            effectKey: null,
            projectileKey: null,
            effectPrefabPath: ZC_BLINK_CAST_EFFECT_PREFAB_PATH,
            fromX: self.x,
            fromY: self.y,
            toX: self.x,
            toY: self.y,
            radius: 0,
            damage: 0,
            empowered: false,
            startedAt: now,
            durationSeconds: ZC_BLINK_CAST_EFFECT_SECONDS,
        });
        context.blinkTo(unit, landX, landY);
        this.markCastAction(unit, now, false);
        if (damageRate > 0) {
            context.strike(unit, { count: 1, radius: hitRadius, damageRate, nearest: true });
        }
        if ((params.blinkRoundTrip ?? 0) > 0) {
            context.blinkTo(unit, self.x, self.y);
            if (damageRate > 0) {
                context.strike(unit, { count: 1, radius: hitRadius, damageRate, nearest: true });
            }
        }
        const cloneRate = Math.max(0, params.blinkCloneDamageRate ?? 0);
        if (cloneRate > 0) {
            unit.blinkCloneX = self.x;
            unit.blinkCloneY = self.y;
            unit.blinkCloneAt = now + Math.max(0, params.blinkCloneSeconds ?? 0);
        }
        unit.blinkReadyAt = now + cooldown;
    }

    private static applySingleStrike(
        state: ZCSnapshot,
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
    ): void {
        if (!context.blinkTo || !context.strike || !params) return;
        const cooldown = Math.max(0, params.singleCooldown ?? 0);
        if (!(cooldown > 0)) return;
        const readyAt = unit.singleReadyAt;
        if (readyAt === undefined) { unit.singleReadyAt = now + cooldown; return; }
        if (now < readyAt) return;

        const scale = Math.max(1e-6, context.distanceScale ?? 1);
        const searchRadius = Math.max(0, params.singleSearchRadius ?? 0) * scale;
        if (!(searchRadius > 0)) return;
        const posOf = (target: ZCUnitState): { x: number; y: number } => (context.unitPosition
            ? { ...context.unitPosition(target) }
            : { x: target.freeX, y: target.freeY });
        const self = posOf(unit);
        let victim: ZCUnitState | undefined;
        let best = Number.POSITIVE_INFINITY;
        for (const candidate of state.units) {
            if (candidate.owner === unit.owner || candidate.battleState === 'dead' || candidate.hp <= 0) continue;
            const pos = posOf(candidate);
            const gap = Math.hypot(pos.x - self.x, pos.y - self.y);
            if (gap > searchRadius || gap >= best) continue;
            best = gap;
            victim = candidate;
        }
        if (!victim) return;

        const target = posOf(victim);
        const dx = target.x - self.x;
        const dy = target.y - self.y;
        const length = Math.hypot(dx, dy);
        const stop = Math.max(0, params.singleStopDistance ?? 30) * scale;
        const landX = length > stop && length > 1e-9 ? target.x - dx / length * stop : target.x;
        const landY = length > stop && length > 1e-9 ? target.y - dy / length * stop : target.y;
        const hitRadius = Math.max(1, Math.max(0, params.singleHitRadius ?? 40) * scale);
        const damageRate = Math.max(0, params.singleDamageRate ?? 0);
        if (!(damageRate > 0)) return;

        // 两端均填目标坐标，确保未在 ZCEffectCatalog 注册锚点的特效播在受击目标身上
        state.combatEvents.push({
            id: state.nextCombatEventId++,
            type: ZCCombatEventType.Melee,
            owner: unit.owner,
            sourceUnitId: unit.id,
            targetUnitId: victim.id,
            skillId: 0,
            skillName: 'single_strike',
            effectKey: null,
            projectileKey: null,
            effectPrefabPath: ZC_SINGLE_STRIKE_EFFECT_PREFAB_PATH,
            fromX: target.x,
            fromY: target.y,
            toX: target.x,
            toY: target.y,
            radius: 0,
            damage: 0,
            empowered: false,
            startedAt: now,
            durationSeconds: ZC_SINGLE_STRIKE_EFFECT_SECONDS,
        });
        context.blinkTo(unit, landX, landY);
        this.markCastAction(unit, now, false);

        const stunSeconds = Math.max(0, params.singleStunSeconds ?? 0);
        let stunStatusId: string | undefined;
        if (stunSeconds > 0) {
            stunStatusId = singleStrikeStunStatusId(stunSeconds);
            if (!context.statusSystem.hasDef(stunStatusId)) {
                context.statusSystem.register({
                    id: stunStatusId,
                    name: stunStatusId,
                    durationSeconds: stunSeconds,
                    maxStacks: 1,
                    refreshPolicy: 'refresh',
                    control: 'stun',
                    behavior: { kind: 'none' },
                });
            }
        }
        const hits = context.strike(unit, {
            count: 1, radius: hitRadius, damageRate, nearest: true, statusId: stunStatusId,
        });
        // 攻速增益仅在命中成功时付与自身
        const hastePct = Math.max(0, params.singleHastePct ?? 0);
        const hasteSeconds = Math.max(0, params.singleHasteSeconds ?? 0);
        if (hits > 0 && hastePct > 0 && hasteSeconds > 0) {
            const hasteStatusId = singleStrikeHasteStatusId(hastePct, hasteSeconds);
            if (!context.statusSystem.hasDef(hasteStatusId)) {
                context.statusSystem.register({
                    id: hasteStatusId,
                    name: hasteStatusId,
                    durationSeconds: hasteSeconds,
                    maxStacks: 1,
                    refreshPolicy: 'refresh',
                    statMods: { attackIntervalPct: hastePct },
                    behavior: { kind: 'none' },
                });
            }
            context.statusSystem.apply(String(unit.id), hasteStatusId,
                { at: state.elapsedSeconds, durationSeconds: hasteSeconds });
            state.statusEffects = context.statusSystem.exportSnapshot();
        }
        unit.singleReadyAt = now + cooldown;
    }

    private static applyChargeShield(
        state: ZCSnapshot,
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
    ): void {
        if (!context.castChargeDash || !context.blinkTo || !params) return;
        const cooldown = Math.max(0, params.chargeCooldown ?? 0);
        if (!(cooldown > 0)) return;
        const readyAt = unit.chargeReadyAt;
        if (readyAt === undefined) { unit.chargeReadyAt = now + cooldown; return; }
        if (now < readyAt) return;
        const damageRate = Math.max(0, params.chargeDamageRate ?? 0);
        if (!(damageRate > 0)) return;
        const heading = this.dashHeadingTowardTarget(unit, context);
        if (heading === null) return;
        const destination = this.dashDestination(unit, heading,
            Math.max(0, params.chargeCells ?? 1), Number.POSITIVE_INFINITY, context);
        if (!destination) return;
        const origin = this.dashOrigin(unit, context);
        this.pushDashCastEvent(state, unit, origin, destination, now, 'charge_shield');
        context.blinkTo(unit, destination.x, destination.y);
        this.markCastAction(unit, now, false);

        const shieldRatio = Math.max(0, params.chargeShieldRatio ?? 0);
        const shieldSeconds = Math.max(0, params.chargeShieldSeconds ?? 0);
        const hitRadius = Math.max(1, Math.max(0, params.chargeHitRadius ?? 40)
            * Math.max(1e-6, context.distanceScale ?? 1));
        context.castChargeDash(unit, {
            origin,
            destination,
            hitRadius,
            damageRate,
            shieldRatio,
            shieldSeconds,
        });
        unit.chargeReadyAt = now + cooldown;
    }

    private static applyLegacyDash(
        state: ZCSnapshot,
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
    ): void {
        if (!context.castChargeDash || !context.blinkTo || !params) return;
        const cooldown = Math.max(0, params.dashCooldown ?? 0);
        if (!(cooldown > 0)) return;
        const readyAt = unit.dashReadyAt;
        if (readyAt === undefined) { unit.dashReadyAt = now + cooldown; return; }
        if (now < readyAt) return;
        const damageRate = Math.max(0, params.dashDamageRate ?? 0);
        if (!(damageRate > 0)) return;
        const cells = Math.max(0, params.dashCells ?? 0);
        if (!(cells > 0)) return;
        const scale = Math.max(1e-6, context.distanceScale ?? 1);
        const towardNearest = (params.dashTowardNearest ?? 0) > 0;
        let limit = Number.POSITIVE_INFINITY;
        let heading: number | null;
        if (towardNearest) {
            const searchRadius = Math.max(0, params.dashSearchRadius ?? 0) * scale;
            const target = searchRadius > 0
                ? this.nearestEnemy(unit, searchRadius, state, context)
                : null;
            if (!target) return;
            const self = this.dashOrigin(unit, context);
            heading = Math.atan2(target.y - self.y, target.x - self.x);
            limit = Math.hypot(target.x - self.x, target.y - self.y);
        } else {
            heading = Number.isFinite(unit.facingRadians) ? unit.facingRadians : 0;
        }
        const destination = this.dashDestination(unit, heading, cells, limit, context);
        if (!destination) return;
        const origin = this.dashOrigin(unit, context);
        this.pushDashCastEvent(state, unit, origin, destination, now, 'legacy_dash');
        context.blinkTo(unit, destination.x, destination.y);
        this.markCastAction(unit, now, false);

        // 易伤对目标（damageTakenPct 正），自减伤对自己（damageTakenPct 负）
        let statusId: string | undefined;
        const stunSeconds = Math.max(0, params.dashStunSeconds ?? 0);
        if (stunSeconds > 0) {
            statusId = singleStrikeStunStatusId(stunSeconds);
            this.ensureControlStatus(context, statusId, stunSeconds);
        }
        const vulnPct = Math.max(0, params.dashVulnerablePct ?? 0);
        const vulnSeconds = Math.max(0, params.dashVulnerableSeconds ?? 0);
        if (vulnPct > 0 && vulnSeconds > 0) {
            statusId = dashVulnerableStatusId(vulnPct, vulnSeconds);
            if (!context.statusSystem.hasDef(statusId)) {
                context.statusSystem.register({
                    id: statusId,
                    name: statusId,
                    durationSeconds: vulnSeconds,
                    maxStacks: 1,
                    refreshPolicy: 'refresh',
                    statMods: { damageTakenPct: vulnPct },
                    behavior: { kind: 'none' },
                });
            }
        }
        const guardPct = Math.max(0, params.dashGuardReducePct ?? 0);
        const guardSeconds = Math.max(0, params.dashGuardSeconds ?? 0);
        let guardStatusId: string | undefined;
        if (guardPct > 0 && guardSeconds > 0) {
            guardStatusId = dashGuardStatusId(guardPct, guardSeconds);
            if (!context.statusSystem.hasDef(guardStatusId)) {
                context.statusSystem.register({
                    id: guardStatusId,
                    name: guardStatusId,
                    durationSeconds: guardSeconds,
                    maxStacks: 1,
                    refreshPolicy: 'refresh',
                    statMods: { damageTakenPct: -guardPct },
                    behavior: { kind: 'none' },
                });
            }
        }
        context.castChargeDash(unit, {
            origin,
            destination,
            hitRadius: Math.max(1, Math.max(0, params.dashHitRadius ?? 40) * scale),
            damageRate,
            statusId,
            shieldRatio: Math.max(0, params.dashShieldRatio ?? 0),
            shieldSeconds: Math.max(0, params.dashShieldSeconds ?? 0),
            guardStatusId,
            guardSeconds,
        });
        unit.dashReadyAt = now + cooldown;
    }

    private static dashOrigin(unit: ZCUnitState, context: IZCSkillTriggerContext):
        { readonly x: number; readonly y: number } {
        return context.unitPosition
            ? { ...context.unitPosition(unit) }
            : { x: unit.freeX, y: unit.freeY };
    }

    private static dashHeadingTowardTarget(unit: ZCUnitState,
        context: IZCSkillTriggerContext): number | null {
        const origin = this.dashOrigin(unit, context);
        const target = context.currentTarget?.(unit) ?? null;
        if (target && Math.abs(target.x - origin.x) + Math.abs(target.y - origin.y) > 1e-9) {
            return Math.atan2(target.y - origin.y, target.x - origin.x);
        }
        return Number.isFinite(unit.facingRadians) ? unit.facingRadians : 0;
    }

    private static nearestEnemy(unit: ZCUnitState, radius: number, state: ZCSnapshot,
        context: IZCSkillTriggerContext): { readonly x: number; readonly y: number } | null {
        const self = this.dashOrigin(unit, context);
        let best = Number.POSITIVE_INFINITY;
        let found: { readonly x: number; readonly y: number } | null = null;
        for (const candidate of state.units) {
            if (candidate.owner === unit.owner || candidate.battleState === 'dead' || candidate.hp <= 0) continue;
            const pos = context.unitPosition ? context.unitPosition(candidate)
                : { x: candidate.freeX, y: candidate.freeY };
            const gap = Math.hypot(pos.x - self.x, pos.y - self.y);
            if (gap > radius || gap >= best) continue;
            best = gap;
            found = { x: pos.x, y: pos.y };
            if (gap <= 1e-9) break;
        }
        return found;
    }

    /** 沿 heading 按格数截取合法可站立落点（limit 防止向最近敌人冲锋时穿背） */
    private static dashDestination(unit: ZCUnitState, heading: number, cells: number,
        limit: number, context: IZCSkillTriggerContext): { x: number; y: number } | null {
        const scale = Math.max(1e-6, context.distanceScale ?? 1);
        const full = Math.min(cells * HEX_GRID_LOGICAL_ROW_STEP * scale, limit);
        const origin = this.dashOrigin(unit, context);
        if (!Number.isFinite(heading)) return null;
        if (!(full > 0)) return { x: origin.x, y: origin.y };
        const canStand = (x: number, y: number): boolean => {
            if (!context.hexIdAt) return true;
            return context.hexIdAt(x, y) !== null;
        };
        for (const ratio of [1, 0.75, 0.5, 0.25]) {
            const x = origin.x + Math.cos(heading) * full * ratio;
            const y = origin.y + Math.sin(heading) * full * ratio;
            if (canStand(x, y)) return { x, y };
        }
        return null;
    }

    /** 残影锚点为 midpoint，需填起止两点；纯表现事件不结算伤害 */
    private static pushDashCastEvent(state: ZCSnapshot, unit: ZCUnitState,
        origin: { readonly x: number; readonly y: number },
        destination: { readonly x: number; readonly y: number },
        now: number, skillName: string): void {
        state.combatEvents.push({
            id: state.nextCombatEventId++,
            type: ZCCombatEventType.Melee,
            owner: unit.owner,
            sourceUnitId: unit.id,
            targetUnitId: null,
            skillId: 0,
            skillName,
            effectKey: null,
            projectileKey: null,
            effectPrefabPath: ZC_DASH_EFFECT_PREFAB_PATH,
            fromX: origin.x,
            fromY: origin.y,
            toX: destination.x,
            toY: destination.y,
            radius: 0,
            damage: 0,
            empowered: false,
            startedAt: now,
            durationSeconds: ZC_DASH_EFFECT_SECONDS,
        });
    }

    private static ensureControlStatus(context: IZCSkillTriggerContext, statusId: string,
        seconds: number): void {
        if (context.statusSystem.hasDef(statusId)) return;
        context.statusSystem.register({
            id: statusId,
            name: statusId,
            durationSeconds: seconds,
            maxStacks: 1,
            refreshPolicy: 'refresh',
            control: 'stun',
            behavior: { kind: 'none' },
        });
    }
}

export function selfCastStatusId(mods: ZCStatusStatMods, seconds: number): string {
    const parts = (Object.keys(mods) as (keyof ZCStatusStatMods)[])
        .filter((key) => (mods[key] ?? 0) !== 0)
        .sort()
        .map((key) => `${key}=${(mods[key] ?? 0).toFixed(4)}`);
    return `__selfcast:${parts.join(',')}@${seconds.toFixed(2)}__`;
}

function isDebuffStatus(statusSystem: ZCStatusSystem, defId: string): boolean {
    const def = statusSystem.getDef(defId);
    if (!def) return false;
    if (def.control) return true;
    const mods = def.statMods;
    if (!mods) return false;
    for (const key of Object.keys(mods) as (keyof ZCStatusStatMods)[]) {
        if ((mods[key] ?? 0) < 0) return true;
    }
    return false;
}
