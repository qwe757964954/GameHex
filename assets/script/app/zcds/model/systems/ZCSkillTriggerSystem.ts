/**
 * 技能触发系统（ZCSkillTriggerSystem，2026-10-29）。
 *
 * 补的是「配置已经表达得出来、但运行时没人跑」的三类技能时机：
 *
 * 1. **常驻被动状态**（`behaviorKey = 'passive_status'`）—— 藤盾这类一开局就该挂在自己身上的
 *    减伤，出生后挂一次、不过期；
 * 2. **连发第二发起**（`burstCount > 1`）—— 机关枪在 empowered 那一击之后，按固定间隔把
 *    剩下的子弹补齐（第一发由 `ZCAttackResolutionSystem.sendAttack` 当场发）；
 * 3. **低血护体**（`lowHpThreshold`）—— 生命比例跌破阈值时挂一个限时减伤，按内置冷却重复触发。
 *
 * 设计约束：
 * - **纯加法**：三类时机各自要求单位身上有对应字段/参数，缺省时整段不执行，
 *   所以任何既有单位、既有技能的行为逐字不变；
 * - **不碰战斗节拍**：本系统既不推进 `stateTime`，也不改 `battleState` / `nextAttackAt`，
 *   连发弹走独立的 `sendBurstShot`，不会打乱普攻节拍与强化 CD；
 * - **不依赖 Cocos**：只吃快照 + 状态系统 + 一个发射回调，可独立单测。
 */

import type { ZCSkillRuntimeDefinition } from '../ZCSkillRuntime';
import type { ZCSnapshot, ZCUnitState } from '../ZCGameTypes';
import { type ZCStatusStatMods, type ZCStatusSystem } from '../ZCStatusEffect';
import type { IZCStrikeOptions } from './ZCAttackResolutionSystem';
import { zcMissileFxOf } from '../ZCCombatEffectFlight';
import { missileLogChanging, missileLogOnce } from '../../ZCMissileSkillDiagnostics';

export interface IZCSkillTriggerContext {
    readonly statusSystem: ZCStatusSystem;
    /**
     * 取这个单位当前生效的技能运行时。
     *
     * 键是 `${unitId}:${普攻 profile.skillId}`（与 `ZCAttackResolutionSystem.sendAttack` 同一口径），
     * 但运行时不持有 unit 定义，所以由调用方解析后传进来 —— 不要在这里按 unitId 猜。
     */
    runtimeOf(unit: ZCUnitState): ZCSkillRuntimeDefinition | undefined;
    /** 发一颗连发弹（由 `ZCGameModel` 转给 `ZCAttackResolutionSystem.sendBurstShot`）。 */
    fireBurst(unit: ZCUnitState): void;
    /**
     * 副轨主动到点出手（2026-11-04 椰蛋战士「横扫」），由 `ZCGameModel` 转给
     * `ZCAttackResolutionSystem.castFanSkill`。
     *
     * 返回 `false` ⇒ 这一帧**没真的打出去**（没有目标 / 没配副轨）。此时**不要**消费 CD ——
     * 否则单位在跑位途中会把 CD 转掉，站定了反而半天不出手。
     */
    castSecondary(unit: ZCUnitState): boolean;
    /**
     * 表值（与 `attackRange` 同一套 px 口径）→ 世界坐标的距离换算，即 `rules.combatDistanceScale`。
     *
     * 只给友军光环（`team_aura`）换半径用：光环半径走 `pvpSkillPlan.skillParamJson.teamAuraRadius`
     * 的表值口径，和攻击距离、区域半径一致，换算集中在这里做一次。缺省 1 ⇒ 视为表值即世界值
     * （单测里不传也能跑）。
     */
    readonly distanceScale?: number;
    /**
     * 给单位回血（2026-10-30「吃口菠萝」100603 的自身回血与友军治疗）。
     *
     * 必须由组合根转成 `ZCStatusResolutionSystem.healUnit`：封顶 `maxHp`、死亡不生效、
     * 真回了才推 `heal` 飘字。**不要**在这里直接 `unit.hp += x`，否则同一件事两套口径。
     * 缺省 ⇒ 治疗类参数整段不执行。
     */
    healUnit?(unit: ZCUnitState, amount: number): void;
    /**
     * 多点打击（2026-10-30「戈壁狂箭」100804 /「追踪导弹」101003）。
     *
     * 由组合根转给 `ZCAttackResolutionSystem.strikeTargets`：挑人、伤害、溅射、吸血、处决
     * 全在攻击系统里，本系统只负责「到点了该打一波」。返回实际命中个数，
     * **0 ⇒ 这一帧没打到人，调用方不要消费 CD**（与副轨同口径）。
     */
    strike?(unit: ZCUnitState, options: IZCStrikeOptions): number;
}

/** 友军光环的刷新窗口（秒）：每步都重挂一次，离开半径后最多这么久失效。 */
const TEAM_AURA_SECONDS = 0.6;

/**
 * 一张卡最多几路友军光环。
 *
 * 为什么不是「一路就够」：同一张卡的所有计划行共用 `unitId:pvpSkillId` 一个参数袋
 * （见 `ZCMatchRuntimeCompiler.mergeSkillPlanIntoRuntime`），103001/103002/103003 这种
 * 「攻 / 守 / 矩阵」三条独立被动只能靠下标分槽共存。
 */
const TEAM_AURA_SLOTS = 3;

/**
 * 友军光环状态的 id：`__aura:<key=value,...>__`。
 *
 * 按**生效词缀签名**生成，同参数复用同一条定义 —— 与 `lowHpGuardStatusId` 同一思路，
 * 避免「每张卡每种数值都往状态系统里塞一条新定义」。
 */
export function teamAuraStatusId(mods: ZCStatusStatMods): string {
    const parts = (Object.keys(mods) as (keyof ZCStatusStatMods)[])
        .filter((key) => (mods[key] ?? 0) !== 0)
        .sort()
        .map((key) => `${key}=${(mods[key] ?? 0).toFixed(4)}`);
    return `__aura:${parts.join(',')}__`;
}

/** 低血护体动态状态的 id：`__lowhp:<减伤%>:<持续秒>__`，同参数复用同一条定义。 */
export function lowHpGuardStatusId(reducePct: number, seconds: number): string {
    return `__lowhp:${reducePct.toFixed(4)}:${seconds.toFixed(2)}__`;
}

export class ZCSkillTriggerSystem {
    static tick(state: ZCSnapshot, dt: number, context: IZCSkillTriggerContext): void {
        void dt;
        if (!state.units.length) return;
        const now = state.elapsedSeconds;
        let statusChanged = false;
        for (const unit of state.units) {
            if (unit.battleState === 'dead' || unit.hp <= 0) continue;
            const runtime = context.runtimeOf(unit);
            const params = runtime?.parameters;

            if (this.applyPassiveStatus(state, unit, runtime, context)) statusChanged = true;
            if (this.applyTeamAura(state, unit, runtime, context)) statusChanged = true;
            if (this.applySelfCast(state, unit, params, now, context)) statusChanged = true;
            this.applyRandomStrike(state, unit, params, now, context);
            this.expireShield(unit, now);
            this.advanceBurst(state, unit, now, context);
            this.advanceSecondary(unit, params, now, context);
            if (this.applyLowHpGuard(state, unit, params, now, context)) statusChanged = true;
        }
        if (statusChanged) state.statusEffects = context.statusSystem.exportSnapshot();
    }

    /** ① 常驻被动状态：每个单位只挂一次（`passiveStatusApplied` 标记进快照）。 */
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
     * ①-b 友军光环（2026-10-30 僵尸「共生信号·攻 / 守 / 矩阵」103001 / 103002 / 103003）。
     *
     * 与 ① 的区别：① 把常驻状态挂给**自己**、只挂一次；这里是**每步重挂**给半径内的
     * 同阵营单位（含自己），所以本体移动时光环跟着走、后出生的友军也会被覆盖到。
     *
     * 参数（全部来自技能计划行的 `skillParamJson`，因此可逐档不同）。**带 0/1/2 槽位下标**，
     * 因为同一张卡的多个被动共用同一个 `unitId:pvpSkillId` 参数袋
     * （`ZCMatchRuntimeCompiler.mergeSkillPlanIntoRuntime` 会把它们并成一份）：
     *   `teamAura{k}Radius`          光环半径，表值口径（与 `attackRange` 同一套 px，1 格 ≈ 42）
     *   `teamAura{k}AttackPct`       攻击 +N%
     *   `teamAura{k}MaxHpPct`        生命上限 +N%
     *   `teamAura{k}AttackSpeedPct`  攻速 +N%（落成状态表的 `attackIntervalPct`，正值 = 间隔缩短）
     *   `teamAura{k}MoveSpeedPct`    移速 +N%
     *
     * 生命上限这条能生效的关键：`ZCStatusResolutionSystem.tick` 每帧按
     * `effectiveDefinition(unit).maxHp` 回写 `unit.maxHp`（`rescaleUnitMaxHp`），
     * 而 `effectiveDefinition` 会吃 `statMods.maxHpPct` —— 所以**带状态的单位**才吃得到，
     * 光环正好一直给它挂着状态。
     *
     * 一个槽位都没配 ⇒ 整段不执行，任何既有单位行为逐字不变。
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

    /** 单个光环槽位：配了半径 + 至少一个词缀才生效。 */
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

    /** ② 护盾到期：只清 `shieldExpireAt` 到点的那批，没设过期的（旧光环盾）永远不动。 */
    private static expireShield(unit: ZCUnitState, now: number): void {
        const expireAt = unit.shieldExpireAt;
        if (expireAt == null || now < expireAt) return;
        unit.shield = 0;
        delete unit.shieldExpireAt;
    }

    /** ③ 连发推进：到点发一发，发完清空四个连发字段。 */
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
        //  用「当前时刻」推进而不是 `+= interval`：模拟步被拉长时不会攒出一串子弹同帧齐发。
        unit.burstNextAt = now + interval;
        if (unit.burstShotsLeft <= 0) {
            delete unit.burstShotsLeft;
            delete unit.burstNextAt;
            delete unit.burstInterval;
            delete unit.burstDamageRate;
        }
    }

    /** ④ 副轨主动：按 `secondaryCooldown` 到点清一次扇形（椰蛋战士「横扫」）。 */
    private static advanceSecondary(
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
    ): void {
        const cooldown = Math.max(0, params?.secondaryCooldown ?? 0);
        if (!(cooldown > 0)) return;
        const readyAt = unit.secondaryReadyAt;
        //  首次：从「当前时刻 + CD」起算，开局不立刻放（与 `consumeEmpoweredAttack` 的 CD 分支同口径）。
        if (readyAt === undefined) { unit.secondaryReadyAt = now + cooldown; return; }
        if (now < readyAt) return;
        //  没打出去就不消费 CD —— 跑位途中别把这次机会转掉。
        if (!context.castSecondary(unit)) return;
        unit.secondaryReadyAt = now + cooldown;
    }

    /** ⑤ 低血护体：跌破阈值挂限时减伤；按 `lowHpCooldown` 做内置冷却（0 = 每场只触发一次）。 */
    private static applyLowHpGuard(
        state: ZCSnapshot,
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
    ): boolean {
        //  参数名与 `ZCAttackResolutionSystem` / 配表口径一致，见 `pvpSkillPlan.skillParamJson`。
        const rawThreshold = params?.lowHpThreshold ?? 0;
        if (!(rawThreshold > 0)) return false;
        const threshold = Math.max(0, Math.min(1, rawThreshold));
        if (unit.maxHp > 0 && unit.hp / unit.maxHp > threshold) return false;
        const cooldown = Math.max(0, params?.lowHpCooldown ?? 0);
        const firedAt = unit.lowHpGuardFiredAt;
        if (firedAt != null) {
            //  cooldown = 0 ⇒ 只触发一次：已经触发过就再也不触发。
            if (cooldown <= 0 || now < firedAt + cooldown) return false;
        }
        const reducePct = Math.max(0, Math.min(95, params?.lowHpReducePct ?? 0));
        const seconds = Math.max(0, params?.lowHpSeconds ?? 0);
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
        const retaliate = Math.max(0, Math.min(95, params?.lowHpRetaliatePct ?? 0));
        if (retaliate > 0) {
            unit.retaliateSlowPct = retaliate;
            unit.retaliateUntil = now + seconds;
        }
        const result = context.statusSystem.apply(String(unit.id), statusId, {
            at: state.elapsedSeconds, durationSeconds: seconds,
        });
        return result.applied;
    }

    // ────────────────────────────────────────── ⑥ 冷却型自身施法 / ⑦ 多点打击（2026-10-30）

    /**
     * ⑥ 冷却型自身施法（`behaviorKey = 'self_cast'`）。
     *
     * 补的是「第二个主动」里**不出手、也没有弹道**的那一类：吃口菠萝（100603 自愈 + 友军治疗 + 净化）、
     * 嗜血（100703 限时增伤 + 吸血）、迅击（100903 限时增伤 + 闪避）。
     * 它们既占不到强化槽（那个给「累计 N 次普攻」的那条），也占不到副轨（副轨只会出扇形伤害），
     * 所以单开一条由本系统按自己的 CD 推进的车道。
     *
     * 参数（全部来自 `pvpSkillPlan.skillParamJson`，因此可逐档不同）：
     *   `selfCastCooldown`     冷却秒；≤0 ⇒ 整段不执行
     *   `selfCastSeconds`      增益持续秒；≤0 ⇒ 不加状态（只做治疗 / 净化那种一次性效果）
     *   `selfCastDamagePct`    伤害倍率 +N%（落 `damageRatePct`）
     *   `selfCastAttackSpeedPct` 攻速 +N%（落 `attackIntervalPct`，正值 = 间隔缩短）
     *   `selfCastLifestealPct` 吸血 +N%（**比例**：10 = 0.10，与 `lifestealRate` 同口径）
     *   `selfCastDodgePct`     闪避 +N%（落 `dodgePct`，比例 0~1）
     *   `selfCastHealPct`      自身回复最大生命的 N%
     *   `selfCastAllyRadius`   友军治疗半径（表值口径，内部乘 `distanceScale`）
     *   `selfCastAllyHealPct`  友军回复最大生命的 N%
     *   `selfCastCleanse`      解除几个减益（取剩余时间最长的那个开始解）
     *
     * 首次推进时把 `selfCastReadyAt` 初始化成「当前 + CD」，开局不立刻放
     * （与副轨 `secondaryReadyAt` 同口径）。
     */
    private static applySelfCast(
        state: ZCSnapshot,
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
    ): boolean {
        const cooldown = Math.max(0, params?.selfCastCooldown ?? 0);
        if (!(cooldown > 0)) return false;
        const readyAt = unit.selfCastReadyAt;
        if (readyAt === undefined) { unit.selfCastReadyAt = now + cooldown; return false; }
        if (now < readyAt) return false;
        unit.selfCastReadyAt = now + cooldown;

        const seconds = Math.max(0, params?.selfCastSeconds ?? 0);
        const mods: ZCStatusStatMods = {};
        const damagePct = params?.selfCastDamagePct ?? 0;
        const attackSpeedPct = params?.selfCastAttackSpeedPct ?? 0;
        const lifestealPct = params?.selfCastLifestealPct ?? 0;
        const dodgePct = params?.selfCastDodgePct ?? 0;
        if (damagePct) mods.damageRatePct = damagePct;
        if (attackSpeedPct) mods.attackIntervalPct = attackSpeedPct;
        //  吸血口径与 `ZCUnitStatPatch.lifestealRate` 一致：**比例**，表里写 10 就是 10%。
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

        //  自身回血：按**当前**最大生命算（`maxHpPct` 增益吃到之后的上限才是玩家看到的那根血条）。
        const selfHealPct = params?.selfCastHealPct ?? 0;
        if (selfHealPct > 0 && context.healUnit) {
            context.healUnit(unit, unit.maxHp * selfHealPct / 100);
        }

        //  友军治疗：与友军光环同一套「半径 × distanceScale」换算，只挑同阵营活着的。
        //  **不含自己** —— 设计案把「自身回复 N%」和「友军回复 M%」写成两句话，
        //  自己已经吃了 `selfCastHealPct`，再吃一次友军的会变成 8% + 4% = 12%。
        const allyRadius = params?.selfCastAllyRadius ?? 0;
        const allyHealPct = params?.selfCastAllyHealPct ?? 0;
        if (allyRadius > 0 && allyHealPct > 0 && context.healUnit) {
            const reach = allyRadius * Math.max(1e-6, context.distanceScale ?? 1);
            for (const ally of state.units) {
                if (ally === unit) continue;
                if (ally.owner !== unit.owner || ally.battleState === 'dead' || ally.hp <= 0) continue;
                if (Math.hypot(ally.freeX - unit.freeX, ally.freeY - unit.freeY) > reach) continue;
                context.healUnit(ally, ally.maxHp * allyHealPct / 100);
            }
        }

        //  净化：只解「减益」——带硬控的，或任意一项 statMod 为负的。增益状态不动。
        const cleanse = Math.max(0, params?.selfCastCleanse ?? 0);
        if (cleanse > 0) {
            const debuffs = context.statusSystem.instancesOf(String(unit.id))
                .filter((instance) => isDebuffStatus(context.statusSystem, instance.defId))
                .sort((a, b) => (b.remainingSeconds ?? Number.POSITIVE_INFINITY)
                    - (a.remainingSeconds ?? Number.POSITIVE_INFINITY));
            for (const instance of debuffs.slice(0, Math.round(cleanse))) {
                if (context.statusSystem.remove(String(unit.id), instance.defId)) changed = true;
            }
        }
        return changed;
    }

    /**
     * ⑦ 多点打击（`behaviorKey = 'random_strike'`）。
     *
     * 两种触发口径，配哪个用哪个：
     *   · `strikeCooldown`（秒）—— 到点就打一波（追踪导弹 101003）；
     *   · `strikeEvery`（次）  —— 累计够 N 次普攻打一波（戈壁狂箭 100804）。
     *
     * 持续窗口（可选）：配了 `strikeSeconds` + `strikeInterval` 时，触发后不是打一波就完，
     * 而是开一个「持续 N 秒、每 interval 秒一波」的窗口（戈壁狂箭的「持续6秒、每秒一波」）。
     * 窗口用 `strikeUntil` / `strikeNextAt` 两个字段推进，与冷却互不干扰 ——
     * 窗口只在**触发那一下**判冷却，窗口内的每一波不再判。
     *
     * 其它参数：
     *   `strikeCount` / `strikeRadius`（表值）/ `strikeDamageRate`
     *   `strikeNearest`（1 = 就近优先，0 = 随机）
     *   `strikeSplashRadius`（表值）/ `strikeSplashDamageRate`
     *
     * 没打到人（返回 0）时**不推进冷却 / 不记次数**：跑位途中别把这次机会转掉。
     */
    private static applyRandomStrike(
        state: ZCSnapshot,
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
    ): void {
        if (!context.strike) return;
        const count = Math.max(0, params?.strikeCount ?? 0);
        const radius = Math.max(0, params?.strikeRadius ?? 0);
        if (!(count >= 1) || !(radius > 0)) return;
        const cooldown = Math.max(0, params?.strikeCooldown ?? 0);
        const every = Math.max(0, params?.strikeEvery ?? 0);
        if (!(cooldown > 0) && !(every > 0)) return;
        const scale = Math.max(1e-6, context.distanceScale ?? 1);
        const missileFx = zcMissileFxOf(unit.unitId);
        //  诊断②：参数快照 + 每次开火结果。打空时 `fire()` 每帧都会被叫一遍（`if (!fire()) return;`
        //  不推进冷却），所以用「值变化才打」的通道，失败只留第一条、转成功再补一条。
        if (missileFx) {
            missileLogOnce(`strike-params:${unit.unitId}`,
                '模型',
                `单位 ${unit.unitId} 拿到导弹参数：strikeCount=${count} strikeRadius=${radius}`
                + `（世界 ${(radius * scale).toFixed(1)}）cooldown=${cooldown} every=${every}`
                + ` nearest=${params?.strikeNearest ?? 0} splash=${params?.strikeSplashRadius ?? 0}`
                + ` | 弹体=${missileFx.missilePrefabPath} 爆炸=${missileFx.impactPrefabPath}`);
        }
        const fire = (): boolean => {
            const options: IZCStrikeOptions = {
                count: Math.round(count),
                radius: radius * scale,
                damageRate: Math.max(0, params?.strikeDamageRate ?? 1),
                nearest: (params?.strikeNearest ?? 0) > 0,
                splashRadius: Math.max(0, params?.strikeSplashRadius ?? 0) * scale,
                splashDamageRate: Math.max(0, params?.strikeSplashDamageRate ?? 0),
                //  追踪导弹（镭射飞龙 68010）：挑到人就发会飞的导弹，不立即结算。
                missilePrefabPath: missileFx?.missilePrefabPath,
                impactPrefabPath: missileFx?.impactPrefabPath,
                arcOffset: missileFx?.arcOffset ?? 0,
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
            return hits > 0;
        };
        const windowSeconds = Math.max(0, params?.strikeSeconds ?? 0);
        const interval = Math.max(0.05, params?.strikeInterval ?? 1);

        //  ① 窗口进行中：每 interval 秒一波，窗口结束就收工。
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
            if (readyAt === undefined) { unit.strikeReadyAt = now + cooldown; return; }
            if (now < readyAt) return;
            if (!fire()) return;
            unit.strikeReadyAt = now + cooldown;
            if (windowSeconds > 0) {
                unit.strikeUntil = now + windowSeconds;
                unit.strikeNextAt = now + interval;
            }
            return;
        }
        //  按累计普攻次数：`completedAttackCount` 由普攻流程推进（强化槽用的是同一个计数），
        //  这里只负责「比上次多打了 N 次就打一波」。
        const done = unit.completedAttackCount ?? 0;
        const fired = unit.strikeFiredCount;
        if (fired === undefined) { unit.strikeFiredCount = done; return; }
        if (done - fired < Math.round(every)) return;
        if (!fire()) return;
        unit.strikeFiredCount = done;
        if (windowSeconds > 0) {
            unit.strikeUntil = now + windowSeconds;
            unit.strikeNextAt = now + interval;
        }
    }
}

/** 自身施法状态的 id：把词缀排序后拼进去，同秒数同词缀共用一个 def。 */
export function selfCastStatusId(mods: ZCStatusStatMods, seconds: number): string {
    const parts = (Object.keys(mods) as (keyof ZCStatusStatMods)[])
        .filter((key) => (mods[key] ?? 0) !== 0)
        .sort()
        .map((key) => `${key}=${(mods[key] ?? 0).toFixed(4)}`);
    return `__selfcast:${parts.join(',')}@${seconds.toFixed(2)}__`;
}

/** 减益判定：带硬控，或任意一项 `statMod` 为负。增益状态（全正 / 空）不算。 */
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
