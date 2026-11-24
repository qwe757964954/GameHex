/**
 * 技能触发系统：补齐配置能表达、运行时没人跑的三类时机——常驻被动、连发第二发起、低血护体，
 * 以及副轨 / 自身施法 / 光环 / 落雷 / 多点打击 / 陷阱 / 移形换影等主动车道。
 *
 * 纯加法：单位没有对应字段或参数时整段不执行；不推进战斗节拍，也不依赖 Cocos。
 * 打人类的五条车道到点后还要过「普攻射程内有目标」闸门，否则保持待触发（readyAt 停在过去）。
*/

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
    /**
     * 独立技能选敌闸门：在指定半径或全场（mode）寻找合法敌人。
     * 缺省时回退到 inAttackRange（普攻射程闸门）。
     */
    selectSkillTarget?(source: ZCUnitState, radius: number, mode?: number): ZCUnitState | null;
    /**
     * 取这个单位当前生效的技能运行时。
     *
     * 键是 `${unitId}:${普攻 profile.skillId}`（与 `ZCAttackResolutionSystem.sendAttack` 同一口径），
     * 但运行时不持有 unit 定义，所以由调用方解析后传进来 —— 不要在这里按 unitId 猜。
    */
    runtimeOf(unit: ZCUnitState): ZCSkillRuntimeDefinition | undefined;
    /** 发一颗连发弹（由 `ZCGameModel` 转给 `ZCAttackResolutionSystem.sendBurstShot`）。*/
    fireBurst(unit: ZCUnitState): void;
    /**
     * 副轨主动到点出手，由 `ZCGameModel` 转给 `ZCAttackResolutionSystem.castFanSkill`。
     * 返回 `false` 表示本帧未成功施放（无目标/未配副轨），不消费 CD。
    */
    castSecondary(unit: ZCUnitState): boolean;
    /**
     * 自身光环周期伤害，由 `ZCGameModel` 转给 `ZCAttackResolutionSystem.castSelfAura`。
     * 返回 `false` 表示参数不全不消费 CD。
    */
    castSelfAura?(unit: ZCUnitState): boolean;
    /**
     * 五雷轰顶落雷，由 `ZCGameModel` 转给 `ZCAttackResolutionSystem.castBoltLine`。
     * 返回 `false` 表示参数不全或无锁定目标，不消费 CD。
    */
    castBolt?(unit: ZCUnitState): boolean;
    /**
     * 闪电链连锁，由 `ZCGameModel` 转给 `ZCAttackResolutionSystem.castChainLightning`。
     * 返回 `false` 表示参数不全或无存活目标，不消费 CD。
     */
    castChainLightning?(unit: ZCUnitState): boolean;
    /**
     * 随从召唤，由 `ZCGameModel` 转给 `summonUnits`。
     * 返回 `false` 表示参数不全不消费 CD。
     */
    castSummon?(unit: ZCUnitState): boolean;
    /**
     * 范围怒吼，由 `ZCGameModel` 转给 `ZCAttackResolutionSystem.castRoar`。
     * 返回 `false` 表示参数不全或范围内无敌人，不消费 CD。
     */
    castRoar?(unit: ZCUnitState): boolean;
    /** 飓风生成，转给 `ZCAttackResolutionSystem.castStorm`。返回 false 表示参数不全不消费 CD。*/
    castStorm?(unit: ZCUnitState): boolean;
    /** 射线集束，转给 `ZCAttackResolutionSystem.castRayBeam`。返回 false 表示参数不全不消费次数。*/
    castRayBeam?(unit: ZCUnitState, vulnStatusId?: string): boolean;
    /** 文明之火撒区域，转给 `ZCAttackResolutionSystem.castFireZone`。返回 false 表示参数不全不消费次数。*/
    castFireZone?(unit: ZCUnitState): boolean;
    /** 陷阱生成，转给 `ZCAttackResolutionSystem.castTrap`。返回 false 表示参数不全不消费 CD。*/
    castTrap?(unit: ZCUnitState): boolean;
    /** 范围投射技能，由 `ZCGameModel` 转给 `ZCAttackResolutionSystem.castSplashShot`。返回 false 表示未施放不消费 CD。*/
    castSplashShot?(unit: ZCUnitState, slowStatusId?: string): boolean;
    /** 风弹连带生成飓风，由 `ZCGameModel` 转给 `ZCAttackResolutionSystem.castWindBolt`。返回 false 表示未施放不消费 CD。*/
    castWindBolt?(unit: ZCUnitState): boolean;
    /** 连射弹单发，由 `ZCGameModel` 转给 `ZCAttackResolutionSystem.castBarrageShot`。返回 false 表示未施放。*/
    castBarrageShot?(unit: ZCUnitState): boolean;
    /**
     * 范围爆发技能。lane 支持 'burst' 与 'venom' 两套独立 CD 与参数。
     * 返回 false 表示未命中或参数不全不消费 CD。不设普攻射程闸门，按自身爆发半径判定。
     */
    castBurstSkill?(unit: ZCUnitState, guardStatusId?: string, lane?: 'burst' | 'venom'): boolean;
    /** 扇形甩击，由 `ZCGameModel` 转给 `ZCAttackResolutionSystem.castFanSweep`。返回 false 表示未命中不消费 CD。*/
    castFanSweep?(unit: ZCUnitState, slowStatusId?: string): boolean;
    /** 沿线段冲锋并撞击目标，转给 `ZCAttackResolutionSystem.castChargeDash`。返回撞击人数；位移已产生即消费 CD。*/
    castChargeDash?(unit: ZCUnitState, options: IZCChargeDashOptions): number;
    /** 世界坐标 → 格子 ID（用于冲锋边界校验，越界时截断落点）。*/
    hexIdAt?(x: number, y: number): number | null;
    /** 当前锁定的攻击目标世界坐标；用于冲锋选向，缺省退回面朝方向。*/
    currentTarget?(unit: ZCUnitState): { readonly x: number; readonly y: number } | null;
    /** 表值到世界坐标的距离比例（即 rules.combatDistanceScale），缺省按 1。*/
    readonly distanceScale?: number;
    /** 单位生命回复，通过 ZCStatusResolutionSystem.healUnit 统一封顶上限并推飘字。*/
    healUnit?(unit: ZCUnitState, amount: number): void;
    /** 多点打击，转给 `ZCAttackResolutionSystem.strikeTargets`。返回命中数，0 表示未命中不消费 CD。*/
    strike?(unit: ZCUnitState, options: IZCStrikeOptions): number;
    /** 瞬移至指定世界坐标，转给 ZCMovementSystem.placeAt 维持位置与地块状态一致。*/
    blinkTo?(unit: ZCUnitState, x: number, y: number): void;
    /**
     * 取单位世界坐标。缺省退回 freeX/freeY。
     */
    unitPosition?(unit: ZCUnitState): { readonly x: number; readonly y: number };
    /**
     * 触发范围闸门：普攻射程内是否有可打目标。
     * 到点技能先过闸门，没人则保持待触发（冷却就绪、不消费），目标进范围当帧补放。
     * 打人类的四条车道走闸门；自身增益、被动、连发、低血护体刻意不设。
    */
    inAttackRange?(unit: ZCUnitState): boolean;
    /**
     * 当前普攻射程（世界 px），给自带搜索半径的车道封顶用：`min(自身半径, 它)`，只压不抬。
     * 缺省 ⇒ 不封顶。
    */
    attackReachOf?(unit: ZCUnitState): number;
    /**
     * 最近敌对单位到本体的距离；给技能自己的触发距离用，与 `inAttackRange` 串联，只压不抬。
     * 缺省 ⇒ 不压。
    */
    nearestEnemyDistance?(unit: ZCUnitState): number;
    /**
     * 取该单位当前生效的 unit 域属性补丁（`pvpSkillPlan` 折出来的 `statPatch`）。
     *
     * 目前只有「每秒回复」(`hpRegenPct`) 这一条读它：那条是**常驻属性**而不是技能参数，
     * 按 `unitId` 索引、与攻击系统用的是同一份 map（口径必须一致，否则同一张卡
     * 在攻击链路和技能链路看到两个不同的数值）。缺省 ⇒ 视为空补丁，整段不执行。
    */
    statPatchOf?(unit: ZCUnitState): ZCUnitStatPatch | undefined;
}

/** 友军光环的刷新窗口（秒）：每步都重挂一次，离开半径后最多这么久失效。*/
const TEAM_AURA_SECONDS = 0.6;

/**
 * 团队增益（`team_buff`）每步续挂的时长：与 `TEAM_AURA_SECONDS` 同一档。
 * 取 0.6 而不是「整段窗口」：设计 N 列要求「友军离开范围即失去效果」，
 * 续挂时长就是**离开半径后多久掉**——窗口再长也不该让人带着 buff 跑掉。
*/
const TEAM_BUFF_REFRESH_SECONDS = 0.6;

/**
 * 一张卡最多几路友军光环。
 *
 * 为什么不是「一路就够」：同一张卡的所有计划行共用 `unitId:pvpSkillId` 一个参数袋
 * （见 `ZCMatchRuntimeCompiler.mergeSkillPlanIntoRuntime`），103001/103002/103003 这种
 * 「攻 / 守 / 矩阵」三条独立被动只能靠下标分槽共存。
*/
const TEAM_AURA_SLOTS = 3;

/**
 * 多点打击打空后的重试间隔。打空不推进 CD，原来下一帧就重试，多条龙会同时开火；
 * 这里退避一小会儿，再按 `unit.id` 错峰，把齐射拆成先后两波。
*/
const STRIKE_RETRY_SECONDS = 0.2;

/** 多点打击命中麻痹状态 ID（strikeAppliesStatus = 1 时生效）。*/
const ZC_STRIKE_NUMB_STATUS_ID = ZC_EFFECT_STATUS_PREFIX.boltNumb;

/** 同屏多单位多点打击重试退避错峰步长（秒）。*/
const STRIKE_RETRY_JITTER = 0.3;

/** 错峰槽数（unit.id % STRIKE_RETRY_SLOTS）。*/
const STRIKE_RETRY_SLOTS = 4;

/**
 * 移形换影的分身爆炸最多波及几个敌人（`blink_strike`）。
 *
 * 设计案只写了「范围伤害」，没给上限；取 6 与多点打击同量级 ——
 * 既够覆盖一片，又不会让一个 12 秒 CD 的分身一发清场。
*/
const BLINK_CLONE_MAX_TARGETS = 6;

/**
 * 首次施法的相位错开步长（秒）：第 N 条龙的首轮冷却 = `cooldown + N × 它`。
 *
 * 两条龙如果同一帧出生，`strikeReadyAt` 会一模一样 ⇒ 第一次就齐射。
 * 错开之后哪怕同帧出生，也会先后 0.3s 开火。只影响第一波的时刻，
 * 之后各走各的 `now + cooldown`，平均 DPS 不变。
*/
const STRIKE_PHASE_STRIDE = 0.3;

/** 相位错开最多用到第几个槽（`unit.id % 它`）：8 × 0.3s ⇒ 最多推迟 2.1s。*/
const STRIKE_PHASE_SLOTS = 8;

/**
 * 友军光环状态的 id：`__aura:<key=value,...>__`。
 *
 * 按生效词缀签名生成，同参数复用同一条定义 —— 与 `lowHpGuardStatusId` 同一思路，
 * 避免「每张卡每种数值都往状态系统里塞一条新定义」。
*/
export function teamAuraStatusId(mods: ZCStatusStatMods): string {
    const parts = (Object.keys(mods) as (keyof ZCStatusStatMods)[])
        .filter((key) => (mods[key] ?? 0) !== 0)
        .sort()
        .map((key) => `${key}=${(mods[key] ?? 0).toFixed(4)}`);
    return `__aura:${parts.join(',')}__`;
}

/** 低血护体动态状态的 id：`__lowhp:<减伤%>:<持续秒>__`，同参数复用同一条定义。*/
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

            // 阶段 1：被动状态与周期生命恢复
            if (this.applyPassiveStatus(state, unit, runtime, context)) statusChanged = true;
            this.applyHpRegen(unit, dt, now, context);
            if (this.applyTeamAura(state, unit, runtime, context)) statusChanged = true;

            // 阶段 2：团队增益与自身 Buff 施法
            if (this.applyTeamBuff(state, unit, params, now, context)) statusChanged = true;
            if (this.applySelfCast(state, unit, params, now, context)) statusChanged = true;
            if (this.applyCounterBuff(state, unit, params, now, context)) statusChanged = true;
            const auraRadius = params ? (params.auraTriggerRange || params.auraRadius || 100) : 100;
            if (this.applySelfAura(state, unit, params, now, context, () => checkSkillGate(auraRadius, params?.auraTargetMode))) statusChanged = true;

            // 阶段 3：定向攻击、投掷物、召唤与位移连击
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

            // 阶段 4：护盾到期、蓄力推进与低血保底
            this.expireShield(unit, now);
            this.advanceBurst(state, unit, now, context);
            const secRadius = params?.secondaryRadius ?? params?.fanRadius ?? 150;
            this.advanceSecondary(unit, params, now, context, () => checkSkillGate(secRadius, params?.secondaryTargetMode));
            if (this.applyLowHpGuard(state, unit, params, now, context)) statusChanged = true;
        }
        if (statusChanged) state.statusEffects = context.statusSystem.exportSnapshot();
    }

    /**
     * 记下「刚刚真的放了一次主动技能」：所有车道写 `castActionUntil`，buff 类再写 `castHoldUntil`。
     * 只在真放出去之后调用；被拒/待触发时写会每帧刷动作窗口。
    */
    private static markCastAction(unit: ZCUnitState, now: number, hold: boolean): void {
        unit.castActionUntil = now + ZC_SKILL_CAST_ACTION_SECONDS;
        if (hold) unit.castHoldUntil = now + ZC_SELF_CAST_HOLD_SECONDS;
    }

    /**
     * 每秒回复（`pvpAttrMap.hpRegenPct`）。
     * 每整秒边界结算回复自身最大生命百分比，溢出丢弃。
    */
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

    /** 1. 常驻被动状态：每个单位只挂一次（`passiveStatusApplied` 标记进快照）。*/
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

    /**
     * 友军光环：每步重挂给半径内同阵营单位（含自己），本体移动和后续出生的友军都能覆盖。
     * 参数 `teamAura{k}Radius/AttackPct/MaxHpPct/AttackSpeedPct/MoveSpeedPct` 按槽位下标取。
     * 一个槽位都没配 ⇒ 整段不执行。
    */
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

    /** 单个光环槽位：配了半径 + 至少一个词缀才生效。*/
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

    /**
     * 团队增益（`team_buff`）：窗口制范围增益。
     * 激活持续 N 秒，脱离范围或窗口结束失去状态。
     * 击杀延长按各受惠者自身 killCount 增量独立计时并受上限限制。
     */
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
        //  一个字缀都没配 ⇒ 这条车道对这张卡是空的，别往状态系统里塞一条空增益。
        if (!Object.keys(mods).length) return false;

        // 首次调用挂载 CD，开局不立即生效。
        if (unit.teamBuffReadyAt === undefined) {
            unit.teamBuffReadyAt = now + cooldown;
            return false;
        }
        //  窗口关着且 CD 到点 ⇒ 开一个新窗口。
        if (!((unit.teamBuffWindowEnd ?? 0) > now) && now >= unit.teamBuffReadyAt) {
            unit.teamBuffWindowEnd = now + seconds;
            unit.teamBuffReadyAt = now + cooldown;
            //  团队增益是「待在原地吼一嗓子」：`hold = true`，人跑着放大玩家看不出效果。
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
                //  新罩到（或上一轮已经掉干净）⇒ 从窗口截止起算，并把击杀基线拍在当下。
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
                    //  没额度了也要把基线推平：否则额度一放出来会把攒着的击杀一次性补上。
                    ally.teamBuffKillBase = ally.killCount ?? 0;
                }
            }
            const remaining = ally.teamBuffUntil - now;
            if (!(remaining > 0)) continue;
            //  只续到「它自己的截止时刻」为止，而不是固定 0.6 —— 否则最后一个 tick 会把
            //  状态多拖 0.6 秒，目测就是「窗口关了人还在亮」。
            const result = context.statusSystem.apply(String(ally.id), statusId, {
                at: state.elapsedSeconds,
                durationSeconds: Math.min(TEAM_BUFF_REFRESH_SECONDS, remaining),
                sourceUnitId: String(unit.id),
            });
            if (result.applied) applied = true;
        }
        return applied;
    }

    /** 2. 护盾到期：清理 shieldExpireAt 到期的护盾。*/
    private static expireShield(unit: ZCUnitState, now: number): void {
        const expireAt = unit.shieldExpireAt;
        if (expireAt == null || now < expireAt) return;
        unit.shield = 0;
        delete unit.shieldExpireAt;
    }

    /** 3. 连发推进：到点发一发，发完清空四个连发字段。*/
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
        // 用当前时刻推进，避免卡顿时同帧齐发
        unit.burstNextAt = now + interval;
        if (unit.burstShotsLeft <= 0) {
            delete unit.burstShotsLeft;
            delete unit.burstNextAt;
            delete unit.burstInterval;
            delete unit.burstDamageRate;
        }
    }

    /** 4. 副轨主动：按 secondaryCooldown 到点触发扇形攻击。*/
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
        // 首次调用从当前时刻 + CD 起算，开局不立刻施放
        if (readyAt === undefined) { unit.secondaryReadyAt = now + cooldown; return; }
        if (now < readyAt) return;
        // 触发范围闸门：目标进入射程才施放，避免跑位途中原地空放
        if (typeof release === 'function' ? !release() : !release) return;
        if (!context.castSecondary(unit)) return;
        unit.secondaryReadyAt = now + cooldown;
        this.markCastAction(unit, now, false);
    }

    /** 5. 低血护体：跌破阈值挂限时减伤；按 `lowHpCooldown` 做内置冷却（0 = 每场只触发一次）。*/
    private static applyLowHpGuard(
        state: ZCSnapshot,
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
    ): boolean {
        if (!params) return false;
        //  参数名与 `ZCAttackResolutionSystem` / 配表口径一致，见 `pvpSkillPlan.skillParamJson`。
        const rawThreshold = params.lowHpThreshold ?? 0;
        if (!(rawThreshold > 0)) return false;
        const threshold = Math.max(0, Math.min(1, rawThreshold));
        if (unit.maxHp > 0 && unit.hp / unit.maxHp > threshold) return false;
        const cooldown = Math.max(0, params.lowHpCooldown ?? 0);
        const firedAt = unit.lowHpGuardFiredAt;
        if (firedAt != null) {
            //  cooldown = 0 ⇒ 只触发一次：已经触发过就再也不触发。
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
        //  受击反弹减益（格挡 III）：护体期间被单位打中就压攻击者攻速，只在本段有效期内生效，
        //  到期由 `ZCDamageResolutionSystem` 的时间比较自动失效（不用额外清理）。
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

    // 冷却型自身施法 / 多点打击

    /**
     * 冷却型自身施法：不出手、没有弹道的第二主动（自愈 / 嗜血 / 迅击），按自己的 CD 推进。
     * 参数：selfCastCooldown/Seconds/DamagePct/AttackSpeedPct/LifestealPct/DodgePct/
     * HealPct/AllyRadius/AllyHealPct/Cleanse。
     * 首次推进把 readyAt 初始化成「当前 + CD」。不设普攻射程闸门。
    */
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
        // 增益类技能锁定施法（hold = true）以展示施法前摇；攻击类则不打断位移
        this.markCastAction(unit, now, true);

        const seconds = Math.max(0, params.selfCastSeconds ?? 0);
        const mods: ZCStatusStatMods = {};
        const damagePct = params.selfCastDamagePct ?? 0;
        const attackSpeedPct = params.selfCastAttackSpeedPct ?? 0;
        const lifestealPct = params.selfCastLifestealPct ?? 0;
        const dodgePct = params.selfCastDodgePct ?? 0;
        if (damagePct) mods.damageRatePct = damagePct;
        if (attackSpeedPct) mods.attackIntervalPct = attackSpeedPct;
        // lifestealPct 为百分比（10 表示 10%），转换为 0~1 比率
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

        //  自身回血：按当前最大生命算（`maxHpPct` 增益吃到之后的上限才是玩家看到的那根血条）。
        const selfHealPct = params.selfCastHealPct ?? 0;
        if (selfHealPct > 0 && context.healUnit) {
            context.healUnit(unit, unit.maxHp * selfHealPct / 100);
        }

        //  友军治疗：与友军光环同一套「半径 × distanceScale」换算，只挑同阵营活着的。
        //  不含自己 —— 设计案把「自身回复 N%」和「友军回复 M%」写成两句话，
        //  自己已经吃了 `selfCastHealPct`，再吃一次友军的会变成 8% + 4% = 12%。
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

        //  群体护盾表现：selfCastAllyRadius > 0 时对自身及范围内友军播放护盾特效。
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

        //  净化：只解负面减益状态。存在群体半径时净化范围内友军，无群体半径时仅净化自身。
        const cleanse = Math.max(0, params.selfCastCleanse ?? 0);
        if (cleanse > 0) {
            const reachSquared = allyReach * allyReach;
            for (const target of state.units) {
                if (target === unit) {
                    //  群体卡（`allyReach > 0`）desc 只承诺「解友军」⇒ 自己不跟着解；
                    //  没有群体半径的老语义仍然是「自净化」，保持原样。
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
        // 累计普攻触发分支：累计 N 次普攻触发，与 CD 冷却二选一
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
            // 首次调用从当前时刻 + CD 起算，开局不立刻施放
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
            // 按累计普攻次数：completedAttackCount 由普攻推进
            const done = unit.completedAttackCount ?? 0;
            const fired = unit.auraFiredCount;
            if (fired === undefined) { unit.auraFiredCount = done; return false; }
            if (done - fired < Math.round(every)) return false;
        }
        // 触发范围闸门：普攻范围内无有效目标时待触发，不消费 CD 或累计次数
        if (typeof release === 'function' ? !release() : !release) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`aura-pending:${unit.id}`, '触发',
                    `${unit.unitId}#${unit.id} ${now.toFixed(1)}s 触发条件已满足但普攻范围内没有目标 ⇒ 待触发`);
            }
            return false;
        }
        // 技能专属触发距离：串联在普攻射程之后，配值大于 0 时收窄判定半径以匹配视觉特效
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
        // 参数不全（半径 / 时长 / 倍率有 0）⇒ 没真的开出来，不消费 CD / 不记次数
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
        // 移动跟随类主动不锁定原地（hold = false），仅播放施法动作切片
        this.markCastAction(unit, now, false);

        //  2. 光环期间的自身增益。按「生效词缀签名」复用同一条状态定义（`selfCastStatusId`），
        //  避免每张卡每种数值都往状态系统里塞一条新定义。
        //
        //  仙人侍卫「巨型仙人掌」102104 包含三项：
        //    · `auraBodySizePct` —— 体积变大 30%；
        //    · `auraReflectPct`  —— 期间受伤反弹 50/51/52%（消费点 `ZCDamageResolutionSystem`）；
        //    · 原来的 `auraSelfDamagePct` 保持不变。
        //  三项生命周期完全相同（都是「光环开着才成立」的自身状态），所以并进**同一份**状态，
        //  不各开一条 —— 分开的话 6 秒里会同时挂三个图标，到期还会错拍。
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

    // 五雷轰顶

    /**
     * 累计普攻型自我增益（counter_self_buff）：打满 N 次普攻对自己施加限时属性增益与瞬时回血。
     * 参数：counterEvery / counterSeconds / counterMoveSpeedPct / counterAttackPct /
     *       counterMaxHpPct / counterBodySizePct / counterHealMaxHpPct。
     * 作用于自身故不设射程闸门；计数独立记录在 counterFiredCount。
     */
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
        // 初次推进仅记录当前计数基线，避免开局直接触发
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
        // 回血按增益施加后的新 maxHp 计算比例（healPct 为百分比 0~100）
        const healPct = Math.max(0, params.counterHealMaxHpPct ?? 0);
        if (healPct > 0 && context.healUnit) context.healUnit(unit, unit.maxHp * healPct / 100);
        return result.applied;
    }

    /**
     * 五雷轰顶：锁一个目标，把雷沿「目标背朝向」排开，每道雷独立计伤、独立判麻痹。
     * 与副轨/自身光环/多点打击的区别：方向由目标背朝向定，落点与目标强绑定。
     * 参数：boltCooldown/Count/Spacing/Interval/Delay/DamageRate/Radius/NumbChance/NumbSeconds。
    */
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
        // 首次调用从当前时刻 + CD 起算，开局不立刻施放
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
        // 触发范围闸门：普攻范围内无有效目标时待触发，不消费 CD
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

    /**
     * 闪电链（chain_damage）：朝锁定目标释放连锁闪电，逐跳弹射至最近的未命中敌方。
     * 参数：chainCooldown / chainTargetCount / chainDamageRate / chainFalloff /
     *       chainJumpRadius / chainFinalCritMultiplier。
     * 独立维护 unit.chainReadyAt 避免与同单位其它技能 CD 串扰；受普攻射程闸门约束。
     */
    private static applyChainLightning(
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
        release: boolean | (() => boolean),
    ): void {
        if (!context.castChainLightning || !params) return;
        const cooldown = Math.max(0, params.chainCooldown ?? 0);
        //  没配冷却就是「这张卡没有闪电链」。这条车道对每个单位每步都会过一遍，
        //  不加这道静默返回，`zcSkillCastWatched` 一开别的卡就会被刷成「闪电链没有 CD」。
        if (!(cooldown > 0)) return;
        const readyAt = unit.chainReadyAt;
        // 首次调用从当前时刻 + CD 起算，开局不立刻施放
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

    /**
     * 怒吼（`roar`）：独立 CD（roarReadyAt）范围伤害与减攻。
     * 参数：roarCooldown / Radius / DamageRate / AttackPct / Seconds / AllyShieldRatio。
     * 范围内无敌人不施放且不消费 CD。
     */
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

    /**
     * 飓风（`storm_zone`）：独立 CD（stormReadyAt）持续区域。
     * 需满足普攻射程内有活体敌方目标才施放，避免空场或仅锁城墙时空放；未满足闸门不消费 CD。
    */
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
        //  第一道闸：普攻射程内必须有目标（`release` 闸门）。
        if (typeof release === 'function' ? !release() : !release) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`storm-pending:${unit.id}`, '触发',
                    `${unit.unitId}#${unit.id} ${now.toFixed(1)}s 冷却已就绪但普攻范围内没有目标 ⇒ 待触发`);
            }
            return;
        }
        //  第二道闸：目标必须是活体敌人，避免锁城墙时误判。
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
        //  放风是「主动出手」：播一次施法动作，不原地锁（射手放完照常走位 / 继续射）。
        this.markCastAction(unit, now, false);
    }

    /**
     * 射线集束（`ray_beam`）：累计普攻次数触发（rayFiredCount 记账）。
     * 射程内无目标时待触发不消费次数；支持附带易伤状态（rayVulnPct）。
    */
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

    /**
     * 文明之火（`fire_zone`）：累计普攻次数触发（fireFiredCount 记账）。
     * 在目标中心扩散生成多块火焰区域；射程内无目标时待触发不消费次数。
    */
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
     * 腾云驾雾（`dash_chain`）：强化攻击触发的连环突进。
     * 依次位移至首要目标及周边若干目标前造成伤害，全段完成后返回首要目标初始位置。
     * 参数：dashChainSpeed（表值 px/s）/ dashChainSpreadRadius / dashChainCount /
     *       dashChainStopDistance / dashChainHitRadius / dashChainDamageRate。
     *
     * - 伤害与计数：位移与伤害由 strike 统一结算，天然不计入普攻累计数；
     * - 目标序列稳定：起手瞬间锁定目标列表（dashChainIds），中途死亡则直接跳过该段位移；
     * - 状态全量持久化：位移状态字段写入快照，保障重连与回放一致性。
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

        //  ① 起手：把「目标 1 + 周边 3 个」拍成一份访问顺序。
        if (unit.dashChainPendingAt !== undefined) {
            const targetId = unit.dashChainTargetId;
            delete unit.dashChainPendingAt;
            delete unit.dashChainTargetId;
            const first = targetId === undefined
                ? undefined
                : state.units.find((candidate) => candidate.id === targetId);
            if (!alive(first) || first.owner === unit.owner) {
                //  目标在留标记与建序列之间死了：这一拍空过（单位已经不出手了，别再多打一发）。
                this.clearDashChain(unit);
                return;
            }
            const origin = posOf(first);
            const want = Math.max(1, Math.round(params.dashChainCount ?? 1));
            const spread = Math.max(0, params.dashChainSpreadRadius ?? 0) * scale;
            const ids = [first.id];
            if (want > 1 && spread > 0) {
                //  「以目标 1 为圆心」：量的是**目标 1 到候选者**的距离，不是本体到候选者 ——
                //  本体此刻可能离得很远（这正是这条技能要「突进」的原因）。
                const picks: Array<{ id: number; gap: number }> = [];
                for (const candidate of state.units) {
                    if (candidate.id === first.id || candidate.owner === unit.owner) continue;
                    if (!alive(candidate)) continue;
                    const pos = posOf(candidate);
                    const gap = Math.hypot(pos.x - origin.x, pos.y - origin.y);
                    if (gap > spread) continue;
                    picks.push({ id: candidate.id, gap });
                }
                //  由近到远；同距按 id（回放可重演，与选敌的其它车道同口径）。
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
        //  一步能走多远：`dashChainSpeed` 是表值 px/秒，乘 `combatDistanceScale` 落世界坐标。
        const step = speed * dt;

        // ② 全段打击完成 ⇒ 返回首个目标起手时的初始坐标
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

        //  ③ 这一段的人没了（被打死 / 被移除）⇒ 跳过，不空挥、也不在原地补打别人。
        const victim = state.units.find((candidate) => candidate.id === ids[index]);
        if (!alive(victim) || victim.owner === unit.owner) {
            unit.dashChainIndex = index + 1;
            return;
        }
        const target = posOf(victim);
        const dx = target.x - self.x;
        const dy = target.y - self.y;
        const length = Math.hypot(dx, dy);
        //  落点 = 目标身前 `dashChainStopDistance`（与闪现 / 突刺同一条几何：贴上去但不重叠）。
        const stop = Math.max(0, params.dashChainStopDistance ?? 30) * scale;
        const landX = length > stop && length > 1e-9 ? target.x - dx / length * stop : target.x;
        const landY = length > stop && length > 1e-9 ? target.y - dy / length * stop : target.y;
        const gap = Math.hypot(landX - self.x, landY - self.y);

        //  ④ 还没到 ⇒ 沿直线推一段（这一步就是「以 150px 速度突进」看得见的那部分）。
        if (gap > step && gap > 1e-6) {
            context.blinkTo(unit, self.x + (landX - self.x) / gap * step, self.y + (landY - self.y) / gap * step);
            return;
        }

        //  ⑤ 到位：打一下，再轮到下一个人。
        context.blinkTo(unit, landX, landY);
        const damageRate = Math.max(0, params.dashChainDamageRate ?? 0);
        const hitRadius = Math.max(1, Math.max(0, params.dashChainHitRadius ?? 40) * scale);
        if (damageRate > 0) {
            //  🔴 `origin` 显式给成**这个目标自己的坐标**：`strikeTargets` 不接受「指定某人」，
            //  只按「离 origin 最近」挑。刚落地时本体可能还差几 px，附近要是有第二个敌人站得更近，
            //  这一下就会打到别人身上（四段打击变成打同一个）。把挑人圆心钉在目标身上 ⇒
            //  距离 0 的它必然排第一，抢不走。
            context.strike(unit, {
                count: 1, radius: hitRadius, damageRate, nearest: true,
                origin: { x: target.x, y: target.y },
            });
        }
        // 命中表现：在受击目标位置生成重击受击特效（纯表现事件，伤害已由 strike 结算）
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
            //  纯表现事件：伤害已经由 `strike` 结算过，这里再写一次就是双倍。
            radius: 0,
            damage: 0,
            empowered: false,
            startedAt: now,
            durationSeconds: ZC_QUAKE_STRIKE_SECONDS,
        });
        this.markCastAction(unit, now, false);
        unit.dashChainIndex = index + 1;
    }

    /** 收尾：四个字段同生同灭（`dashChainIndex` 有值 = 序列在跑，`ZCUnitSystem` 靠它冻结单位）。*/
    private static clearDashChain(unit: ZCUnitState): void {
        delete unit.dashChainPendingAt;
        delete unit.dashChainTargetId;
        delete unit.dashChainIds;
        delete unit.dashChainIndex;
        delete unit.dashChainReturnX;
        delete unit.dashChainReturnY;
    }

    /**
     * 随从召唤（`summon_unit`）：支持累计普攻与冷却施法两种机制。
     * 参数：summonCount / summonHpInherit / summonAttackInherit / summonSeconds / summonAlpha 等。
     * 不设普攻射程闸门，冷却或次数就绪即施放。
     */
    private static applySummonUnit(
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
    ): void {
        if (!context.castSummon || !params) return;
        //  触发机制：优先判累计普攻次数（summonEvery），其次判冷却制（summonCooldown）。
        const every = Math.max(0, Math.round(params.summonEvery ?? 0));
        if (every > 0) {
            this.applySummonByCount(unit, every, now, context);
            return;
        }
        const cooldown = Math.max(0, params.summonCooldown ?? 0);
        //  没配冷却就是「这张卡没有召唤」。这条车道对每个单位每步都会过一遍，不加就刷日志。
        if (!(cooldown > 0)) return;
        const readyAt = unit.summonReadyAt;
        // 首次调用从当前时刻 + CD 起算，开局不立刻施放
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
        //  召唤是「主动出手」：播一次施法动作，但不原地锁住（召完还能照常走位）。
        this.markCastAction(unit, now, false);
    }

    /**
     * 累计普攻制召唤：累计 N 次普攻后触发召唤。
     * 初次推进仅记录当前计数基线，被拒不消费次数，计数独立记录在 summonFiredCount。
     */
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


    // 精密陷阱

    /**
     * 精密陷阱 / 蘑菇爆炸：留在原地的布置物，在「被踩」与「到点」时刻结算。
     * 参数：trapCooldown/Duration/Radius/DamageRate/ExplodeRadius/ExplodeDamageRate/Forward。
     * 支持冷却触发与累计普攻触发两种模式。
     */
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
        // 首次调用从当前时刻 + CD 起算，开局不立刻施放
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
        // 施法动作：布置陷阱播放动作切片，不原地锁定位移
        this.markCastAction(unit, now, false);
    }

    /**
     * 累计普攻 N 次丢一次陷阱。
     * 与 applyCounterBuff 同套计数推进，被拒时不消费次数。
     */
    private static applyTrapByCount(
        unit: ZCUnitState,
        every: number,
        now: number,
        context: IZCSkillTriggerContext,
    ): void {
        if (!context.castTrap) return;
        const done = unit.completedAttackCount ?? 0;
        const fired = unit.trapFiredCount;
        // 初次推进仅记录当前计数基线，避免开局直接触发
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
        // 施法动作：丢出陷阱播放动作切片，不原地锁定位移
        this.markCastAction(unit, now, false);
    }

    // 孢爆箭 / 孢子凝珠

    /**
     * 孢爆箭 / 孢子凝珠：冷却到点朝锁定目标射一枚「命中就爆开」的弹。
     *
     * 参数（`skillParamJson`，全部带 `shot` 前缀）：`shotCooldown` 冷却秒数 /
     * `shotDamageRate` 相对面板的伤害倍率 / `shotRadius` 爆点半径（表值逻辑 px）/
     * `shotSlowRatio` 减速百分点（0 = 不减速）/ `shotSlowSeconds` 减速时长。
     *
     * 🔴 **为什么前缀是 `shot` 而不是通用 `damageRate` / `splashRadius`**：
     * `skillParamJson` 按 `${unitId}:${pvpSkillId}` 合并成一袋，而 `splashRadius` /
     * `splashDamageRate` 这两个键**普攻链路也在读**（爆囊扩散那套）。直接写裸键的话，
     * 「给主动技能配的 90px 溅射」会顺带把这张卡的**每次普攻**也变成 90px 溅射 ——
     * 不报错、只是数值莫名变大。同一个理由让 `cooldown` 也必须加前缀。
     *
     * 打不出去（射程内没人 / 锁定目标已经跑远）**不消费 CD**：这条与 `castSelfAura` /
     * `castTrap` / `strike` 完全一致，否则单位在跑位途中会把这次机会空转掉。
    */
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
        // 首次调用从当前时刻 + CD 起算，开局不立刻施放
        if (readyAt === undefined) {
            unit.splashReadyAt = now + cooldown;
            return;
        }
        if (now < readyAt) return;
        //  触发范围闸门：到点但普攻范围内没人 ⇒ 待触发、CD 保持就绪。
        if (typeof release === 'function' ? !release() : !release) return;
        const slowStatusId = this.splashShotSlowStatusId(params, context);
        if (!context.castSplashShot(unit, slowStatusId)) return;
        unit.splashReadyAt = now + cooldown;
        //  施法动作：射一发算一次主动出手；不原地锁 —— 射手要边走边放。
        this.markCastAction(unit, now, false);
    }

    /**
     * 孢子凝珠的减速状态：按参数现算 id、缺定义就注册一条。
     *
     * 只有「比例和时长都 > 0」才建：孢爆箭（101303）两个参数都不配 ⇒ 返回 undefined，
     * `castSplashShot` 也就不往弹体上挂状态，与不减速的存量行为完全一致。
     * 状态本身走 `moveSpeedPct`（百分点，`-15` = 移速 −15%），与 `numb` 的 `-50` 同一单位。
    */
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

    /**
     * 风弹（`wind_bolt`）：独立 CD（windReadyAt）射出风弹并在落点生成飓风。
     * 参数：windCooldown / windDamageRate / windSpeed / windLifeSeconds / windZoneRadius / windZoneSeconds / windZoneDamageRate。
     * 普攻射程内有目标才施放，未施放不消费 CD。
    */
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
        // 首次调用从当前时刻 + CD 起算，开局不立刻施放
        if (readyAt === undefined) {
            unit.windReadyAt = now + cooldown;
            return;
        }
        if (now < readyAt) return;
        //  触发范围闸门：到点但普攻范围内没人 ⇒ 待触发、CD 保持就绪。
        if (typeof release === 'function' ? !release() : !release) return;
        if (!context.castWindBolt(unit)) return;
        unit.windReadyAt = now + cooldown;
        //  施法动作：射一发算一次主动出手；不原地锁 —— 射手要边走边放。
        this.markCastAction(unit, now, false);
    }

    /**
     * 连射导弹（`missile_barrage`）：累计普攻次数触发一轮多发导弹。
     * 补发逻辑优先于触发，保证上一轮发射完整；施法期间保持原地站立动作。
    */
    private static applyMissileBarrage(
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
        release: boolean | (() => boolean),
    ): void {
        if (!context.castBarrageShot || !params) return;
        const interval = Math.max(0.05, params.barrageInterval ?? ZC_BARRAGE_DEFAULT_INTERVAL);
        //  ── 1. 补发 ──
        const left = unit.barrageShotsLeft ?? 0;
        if (left > 0) {
            if (now < (unit.barrageNextAt ?? 0)) return;
            context.castBarrageShot(unit);
            unit.barrageShotsLeft = left - 1;
            //  用「当前时刻」推进而不是 `+= interval`：模拟步被拉长时不会攒出几颗同帧齐发。
            unit.barrageNextAt = now + interval;
            if (unit.barrageShotsLeft <= 0) {
                delete unit.barrageShotsLeft;
                delete unit.barrageNextAt;
            }
            return;
        }
        //  ── 2. 触发（累计普攻） ──
        const every = Math.max(0, Math.round(params.barrageEvery ?? 0));
        if (!(every > 0)) return;
        const done = unit.completedAttackCount ?? 0;
        const fired = unit.barrageFiredCount;
        if (fired === undefined) { unit.barrageFiredCount = done; return; }
        if (done - fired < every) return;
        //  触发范围闸门：凑满次数但普攻范围内没人 ⇒ 待触发、不记次数（目标进范围当帧补放）。
        if (typeof release === 'function' ? !release() : !release) return;
        if (!context.castBarrageShot(unit)) return;
        unit.barrageFiredCount = done;
        const count = Math.max(1, Math.round(params.barrageCount ?? 1));
        if (count > 1) {
            unit.barrageShotsLeft = count - 1;
            unit.barrageNextAt = now + interval;
        }
        //  施法动作 + 原地站定：「站在原地不动」要覆盖整轮（首发 + 后续几颗的间隔）。
        this.markCastAction(unit, now, true);
        unit.castHoldUntil = now + interval * (count - 1) + ZC_SELF_CAST_HOLD_SECONDS;
    }

    /**
     * 范围爆发技能（`burst_aura` / `burst_knockback` / `venom`）。
     * 支持 'burst' 与 'venom' 独立 CD 车道。
     * 判定以自身为圆心，不设普攻射程闸门；未命中目标不消费 CD。
    */
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
        //  两条车道的 CD 各记各的：同一张卡（68018）同时挂着菌核爆裂与毒液喷吐，
        //  共用一个 `burstReadyAt` 会变成「爆完这个、那个也进冷却」。
        const readyField = lane === 'venom' ? 'venomReadyAt' : 'burstReadyAt';
        const readyAt = unit[readyField];
        // 首次调用从当前时刻 + CD 起算，开局不立刻施放
        if (readyAt === undefined) {
            unit[readyField] = now + cooldown;
            return;
        }
        if (now < readyAt) return;
        const guardStatusId = lane === 'burst' ? this.burstGuardStatusId(params, context) : undefined;
        if (!context.castBurstSkill(unit, guardStatusId, lane)) return;
        unit[readyField] = now + cooldown;
        //  施法动作：爆一次算一次主动出手；不原地锁 —— 战士开团要能立刻跟进走位。
        this.markCastAction(unit, now, false);
    }

    /**
     * 菌毯爆发 III 级的「护盾期间受到伤害降低」状态：按参数现算 id、缺定义就注册一条。
     *
     * 只有「比例和时长都 > 0」才建：L1 / L2 不配这两个参数 ⇒ 返回 undefined，
     * `castBurstSkill` 也就只套盾、不挂减伤，与「单纯护盾」的存量口径完全一致。
     *
     * 🔴 `pvpStatus` 里**没有**通用的「受到伤害降低 N%」定值档（那几张 `vulnerability` 是反方向），
     * 所以只能动态注册；`damageTakenPct` 用百分点（`-15` = 受到伤害 −15%），
     * 由 `ZCDamageResolutionSystem` 的 `1 + damageTakenPct / 100` 消费。
     *
     * 已知取舍：减伤跟着 `burstShieldSeconds`（4 秒）走，护盾被打破不会提前揭掉减伤 ——
     * 「护盾存在期间」在这里等价于「护盾的持续时间」。要做到「破了就掉减伤」得在
     * `expireShield` 之外再加一条「护盾归零时摘状态」的钩子，收益不抵复杂度。
    */
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

    /**
     * 扇形甩击（`fan_slow`）：独立 CD（fanReadyAt）朝前施放。
     * 判定以自身扇形半径为准，不借普攻射程（扇形距离普遍大于贴脸普攻）；未命中不消费 CD。
    */
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
        // 首次调用从当前时刻 + CD 起算，开局不立刻施放
        if (readyAt === undefined) {
            unit.fanReadyAt = now + cooldown;
            return;
        }
        if (now < readyAt) return;
        //  触发范围闸门：按扇形自身半径判定最近敌方距离，避免受普攻射程过度拦截。
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
        //  施法动作：甩一次算一次主动出手；不原地锁。
        this.markCastAction(unit, now, false);
    }

    /**
     * 菌丝绞杀的减速状态：按参数现算 id、缺定义就注册一条。
     *
     * 只有「比例和时长都 > 0」才建。moveSpeedPct 走百分点（-40 表示移速 -40%）。
    */
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

    /**
     * 多点打击：`strikeCooldown` 到点打一波，或 `strikeEvery` 累计 N 次普攻打一波。
     * 配 `strikeSeconds` + `strikeInterval` 时开持续窗口，窗口内每波不再判冷却。
     * 参数：strikeCount/Radius/DamageRate/Nearest/SplashRadius/SplashDamageRate。
     * 打空（返回 0）不推进冷却、不记次数。
    */
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
        // 触发范围封顶：搜索半径上限钳制到普攻射程，避免技能索敌范围超出普攻范围
        const reachCap = params.strikeTargetMode === 2 ? Number.POSITIVE_INFINITY : Math.max(0, context.attackReachOf?.(unit) ?? Number.POSITIVE_INFINITY);
        const searchRadius = params.strikeTargetMode === 2 ? Number.POSITIVE_INFINITY : Math.min(radius * scale, reachCap);
        const missileFx = zcMissileFxOf(unit.unitId);
        //  诊断2.：参数快照 + 每次开火结果。打空时 `fire()` 每帧都会被叫一遍（`if (!fire()) return;`
        //  不推进冷却），所以用「值变化才打」的通道，失败只留第一条、转成功再补一条。
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
                // 命中附加状态：需显式开启 strikeAppliesStatus。状态 ID 使用专用常量，避免污染全卡普攻状态
                statusId: (params.strikeAppliesStatus ?? 0) > 0 ? ZC_STRIKE_NUMB_STATUS_ID : undefined,
                // 追踪导弹：由飞行弹体承载，到达后延迟结算
                missilePrefabPath: missileFx?.missilePrefabPath,
                impactPrefabPath: missileFx?.impactPrefabPath,
                arcOffset: missileFx?.arcOffset ?? 0,
                missileSpeed: missileFx?.speed,
                // 导弹发射发数上限，由 strikeTargets 最终截断
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
            // 施法动作：仅在命中成功时播放施法动作切片，打空重试时不重置动作避免抖动
            if (hits > 0) this.markCastAction(unit, now, false);
            return hits > 0;
        };
        const windowSeconds = Math.max(0, params.strikeSeconds ?? 0);
        const interval = Math.max(0.05, params.strikeInterval ?? 1);

        //  1. 窗口进行中：每 interval 秒一波，窗口结束就收工。
        const until = unit.strikeUntil;
        if (until != null && now < until) {
            if (now < (unit.strikeNextAt ?? 0)) return;
            fire();
            //  用「当前时刻 + interval」推进，模拟步被拉长时不会攒出一串同帧齐发。
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
                // 首轮相位：导弹按 unit.id 错峰错开发射，其它 random_strike 保持原就绪时间
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
            // 触发范围闸门：普攻范围内无有效目标时待触发，CD 保持就绪
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
        // 触发范围闸门：累计次数满足但范围内无目标时待触发，不消费累计次数
        if (typeof release === 'function' ? !release() : !release) return;
        if (!fire()) return;
        unit.strikeFiredCount = done;
        if (windowSeconds > 0) {
            unit.strikeUntil = now + windowSeconds;
            unit.strikeNextAt = now + interval;
        }
    }

    // 移形换影

    /**
     * 移形换影：向最近敌人闪现并结算伤害，按级别决定是否往返、是否留分身。
     * 参数：blinkCooldown/SearchRadius/DamageRate/RoundTrip/StopDistance/HitRadius/
     * CloneRadius/CloneDamageRate/CloneSeconds。
     * 没目标不消费 CD；分身记施法原位坐标；闪走当刻只推一条表现事件。
     * 事件类型取 `melee`，画在魔术师身上而不是铺地。
    */
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

        //  1. 先结算到点的分身，再判本次 CD —— 反过来的话「闪回 + 分身同帧」会把爆炸推迟一轮。
        const cloneAt = unit.blinkCloneAt;
        if (cloneAt != null && now >= cloneAt) {
            const radius = Math.max(0, params.blinkCloneRadius ?? 0) * scale;
            const rate = Math.max(0, params.blinkCloneDamageRate ?? 0);
            if (radius > 0 && rate > 0 && context.strike) {
                context.strike(unit, {
                    //  范围爆炸最多波及几个：设计案只写「范围伤害」，没给上限。
                    //  取 6 与「多点打击」同量级：既够覆盖一片，又不会一发清场。
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
        // 首次调用从当前时刻 + CD 起算，开局不立刻施放
        if (readyAt === undefined) { unit.blinkReadyAt = now + cooldown; return; }
        if (now < readyAt) return;

        // 触发范围闸门：普攻范围内无有效目标时待触发，不消费 CD
        if (typeof release === 'function' ? !release() : !release) return;
        // 触发范围封顶：搜索半径上限钳制到普攻射程
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
        // 无目标时不消费 CD
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

        // 出发地施法特效：在位移前记录起点坐标（纯表现事件，不造成伤害）
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
        // 施法动作：闪现到达后播放施法攻击动作，不原地锁定
        this.markCastAction(unit, now, false);
        if (damageRate > 0) {
            context.strike(unit, { count: 1, radius: hitRadius, damageRate, nearest: true });
        }
        // 往返：闪回施法初始原位再结算一发打击
        if ((params.blinkRoundTrip ?? 0) > 0) {
            context.blinkTo(unit, self.x, self.y);
            if (damageRate > 0) {
                context.strike(unit, { count: 1, radius: hitRadius, damageRate, nearest: true });
            }
        }
        //  3. 分身：留在原位，到时爆炸。
        const cloneRate = Math.max(0, params.blinkCloneDamageRate ?? 0);
        if (cloneRate > 0) {
            unit.blinkCloneX = self.x;
            unit.blinkCloneY = self.y;
            unit.blinkCloneAt = now + Math.max(0, params.blinkCloneSeconds ?? 0);
        }
        unit.blinkReadyAt = now + cooldown;
    }

    // 菌丝突刺

    /**
     * 单体突刺（`single_strike`）：位移贴近最近目标造成伤害并附带控制/攻速增益。
     * 参数：singleCooldown / singleDamageRate / singleSearchRadius / singleStopDistance / singleHitRadius / singleStunSeconds / singleHastePct / singleHasteSeconds。
     * 无目标时不消费 CD。
    */
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
        // 首次调用从当前时刻 + CD 起算，开局不立刻施放
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
        //  搜索半径内没人 ⇒ 不消费 CD（等目标进圈再扑）。
        if (!victim) return;

        const target = posOf(victim);
        const dx = target.x - self.x;
        const dy = target.y - self.y;
        const length = Math.hypot(dx, dy);
        //  落点 = 目标身边 `singleStopDistance`，与闪现同一条几何：贴上去但不重叠
        //  （重叠会让「谁在打谁」在渲染层分不清，也会让击退方向退化）。
        const stop = Math.max(0, params.singleStopDistance ?? 30) * scale;
        const landX = length > stop && length > 1e-9 ? target.x - dx / length * stop : target.x;
        const landY = length > stop && length > 1e-9 ? target.y - dy / length * stop : target.y;
        const hitRadius = Math.max(1, Math.max(0, params.singleHitRadius ?? 40) * scale);
        const damageRate = Math.max(0, params.singleDamageRate ?? 0);
        if (!(damageRate > 0)) return;

        //  命中表现贴在**目标**身上（设计案 O 列「长戟兵_撕裂 贴目标播」）。
        //  `ZCCombatEffectPlacement` 对未登记的 prefab 一律按 `caster` 锚点取 `fromX/fromY`
        //  ⇒ 这里把两端都写成目标坐标，就能落在被打的那个人身上。
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
            //  纯表现事件：半径与伤害一律 0，谁都不结算（同 `applyBlinkStrike` 的出发闪光）。
            radius: 0,
            damage: 0,
            empowered: false,
            startedAt: now,
            durationSeconds: ZC_SINGLE_STRIKE_EFFECT_SECONDS,
        });
        context.blinkTo(unit, landX, landY);
        //  施法动作：扑到位之后在落点播半秒攻击动作；不锁原地（人已经被挪走了）。
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
                    //  硬控：单位进入受控、停止一切行动（与 `numb` 那种软控分开，后者已按设计删除）。
                    control: 'stun',
                    behavior: { kind: 'none' },
                });
            }
        }
        //  命中结算交给 `strikeTargets`（它负责暴击 / 克制 / 吸血 / 处决 / 命中状态），
        //  `statusId` 在「立即结算」分支会被挂到被打的目标身上。
        const hits = context.strike(unit, {
            count: 1, radius: hitRadius, damageRate, nearest: true, statusId: stunStatusId,
        });
        //  III 级攻速增益：**命中之后**才给，空放不给（设计案 N 列原话）。
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
                    // attackIntervalPct 为百分点缩短：正值表示攻速提升（30 = +30%）
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

    // 冲锋车道（菌盾冲锋 / 冲锋 / 尖刺冲锋）

    /**
     * 菌盾冲锋（`charge_shield`）：朝目标方向定长冲刺，撞击沿途敌方并在落点挂护盾。
     * 参数：chargeCooldown / chargeDamageRate / chargeCells / chargeHitRadius / chargeShieldRatio / chargeShieldSeconds。
     * 不受普攻射程限制。
     */
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
        // 首次调用从当前时刻 + CD 起算，开局不立刻施放
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

    /**
     * 定向/寻敌冲锋（`legacy_dash`）：朝最近敌人或面朝方向冲刺 N 格，沿途造成伤害。
     * 由 dashTowardNearest 决定选向模式；支持眩晕、易伤、自减伤及落地护盾。
     */
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
        //  朝最近敌人那档要一个最大冲程上限：人就在 20px 外时不该「冲过头」穿到背后去。
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
            //  面朝方向：没有目标也照冲（它就是一段位移），所以这里不做「找不到就退出」。
            heading = Number.isFinite(unit.facingRadians) ? unit.facingRadians : 0;
        }
        const destination = this.dashDestination(unit, heading, cells, limit, context);
        if (!destination) return;
        const origin = this.dashOrigin(unit, context);
        this.pushDashCastEvent(state, unit, origin, destination, now, 'legacy_dash');
        context.blinkTo(unit, destination.x, destination.y);
        this.markCastAction(unit, now, false);

        // 命中附加状态：易伤给受击目标（damageTakenPct 为正），自减伤给自身（damageTakenPct 为负）
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
                    //  `damageTakenPct` 用百分点：+35 = 受到伤害提高 35%（破甲）。
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
                    //  `damageTakenPct` 取负：-25 = 受到伤害降低 25%。
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

    /** 取单位的世界坐标；缺省退回 freeX/freeY。*/
    private static dashOrigin(unit: ZCUnitState, context: IZCSkillTriggerContext):
        { readonly x: number; readonly y: number } {
        return context.unitPosition
            ? { ...context.unitPosition(unit) }
            : { x: unit.freeX, y: unit.freeY };
    }

    /** 朝当前锁定目标的方向；没有目标时退回面朝方向（与 `castFanSweep` 同一条兜底）。*/
    private static dashHeadingTowardTarget(unit: ZCUnitState,
        context: IZCSkillTriggerContext): number | null {
        const origin = this.dashOrigin(unit, context);
        const target = context.currentTarget?.(unit) ?? null;
        if (target && Math.abs(target.x - origin.x) + Math.abs(target.y - origin.y) > 1e-9) {
            return Math.atan2(target.y - origin.y, target.x - origin.x);
        }
        return Number.isFinite(unit.facingRadians) ? unit.facingRadians : 0;
    }

    /** 搜索半径内最近的敌人（世界坐标）；没有返回 `null`。*/
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
            //  贴脸（gap≈0）时方向没有意义，但仍要返回一个落点：直接落在他身上。
            if (gap <= 1e-9) break;
        }
        return found;
    }

    /**
     * 落点 = 起冲点沿 `heading` 走 `cells` 格，并且**必须落在合法格子上**。
     *
     * 冲锋是定长位移，与「贴着目标落点」的两条车道（闪现 / 突刺）不同 ——
     * 站在地图边缘朝外冲会把单位送到可玩区域之外，而 `placeAt` 不检查边界。
     * 所以这里逐步缩短（1 → 0.75 → 0.5 → 0.25），一个可用落点都找不到就**不冲**。
     * `hexIdAt` 缺省（单测夹具）⇒ 不校验，直接按换算值落。
     *
     * `limit` 是最大冲程（世界 px）：朝最近敌人时传「到目标的距离」，防止冲过头穿到背后。
    */
    private static dashDestination(unit: ZCUnitState, heading: number, cells: number,
        limit: number, context: IZCSkillTriggerContext): { x: number; y: number } | null {
        const scale = Math.max(1e-6, context.distanceScale ?? 1);
        const full = Math.min(cells * HEX_GRID_LOGICAL_ROW_STEP * scale, limit);
        const origin = this.dashOrigin(unit, context);
        if (!Number.isFinite(heading)) return null;
        //  冲程为 0（目标就贴在身上）⇒ **原地冲**：线段退化成一个点，`castChargeDash` 照样
        //  按胶囊判一次、「冲到了」这件事也照样成立（消费 CD、落地自保生效）。
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

    /**
     * 冲锋残影：一条纯表现的 `melee` 事件，`from` = 起冲点、`to` = 落点。
     *
     * 为什么两端都要写：`ZCCombatEffectPlacement` 把 `轻骑兵_冲锋` 登记成 `midpoint` 锚点
     * （设计案 O 列「沿朝向平移」，实现上就是「画在这段路的中间」），
     * 只写 `from` 的话锚点退化成一个点，看起来像「在原地挥了一下然后瞬移」。
     *
     * 半径与伤害一律 0：这条事件谁都不结算，结算在 `castChargeDash` 里。
    */
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

    /** 注册一条参数化硬控（`control: 'stun'`）；已存在则跳过。*/
    private static ensureControlStatus(context: IZCSkillTriggerContext, statusId: string,
        seconds: number): void {
        if (context.statusSystem.hasDef(statusId)) return;
        context.statusSystem.register({
            id: statusId,
            name: statusId,
            durationSeconds: seconds,
            maxStacks: 1,
            refreshPolicy: 'refresh',
            //  硬控：走 `ZCUnitSystem` 的受控闸门整段停手（软控只有 `attackDisabled` + 减速）。
            control: 'stun',
            behavior: { kind: 'none' },
        });
    }
}

/** 自身施法状态的 id：把词缀排序后拼进去，同秒数同词缀共用一个 def。*/
export function selfCastStatusId(mods: ZCStatusStatMods, seconds: number): string {
    const parts = (Object.keys(mods) as (keyof ZCStatusStatMods)[])
        .filter((key) => (mods[key] ?? 0) !== 0)
        .sort()
        .map((key) => `${key}=${(mods[key] ?? 0).toFixed(4)}`);
    return `__selfcast:${parts.join(',')}@${seconds.toFixed(2)}__`;
}

/** 减益判定：带硬控，或任意一项 `statMod` 为负。增益状态（全正 / 空）不算。*/
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
