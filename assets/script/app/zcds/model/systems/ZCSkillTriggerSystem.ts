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
import type { IZCStrikeOptions } from './ZCAttackResolutionSystem';
import { ZCCombatEventType } from '../ZCCombatCatalog';
import { ZC_BLINK_CAST_EFFECT_PREFAB_PATH, ZC_BLINK_CAST_EFFECT_SECONDS } from '../ZCBlinkCastFx';
import { ZC_SELF_CAST_HOLD_SECONDS, ZC_SKILL_CAST_ACTION_SECONDS } from '../ZCUnitCastAction';
import { zcMissileFxOf } from '../ZCCombatEffectFlight';
import { missileLog, missileLogChanging, missileLogOnce } from '../../ZCMissileSkillDiagnostics';
import { skillCastLogChanging, skillCastLogOnce, zcSkillCastWatched } from '../../ZCSkillCastDiagnostics';

export interface IZCSkillTriggerContext {
    readonly statusSystem: ZCStatusSystem;
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
     * 副轨主动到点出手（2026-11-04 椰蛋战士「横扫」），由 `ZCGameModel` 转给
     * `ZCAttackResolutionSystem.castFanSkill`。
     *
     * 返回 `false` ⇒ 这一帧没真的打出去（没有目标 / 没配副轨）。此时不要消费 CD ——
     * 否则单位在跑位途中会把 CD 转掉，站定了反而半天不出手。
    */
    castSecondary(unit: ZCUnitState): boolean;
    /**
     * 自身光环到点开一片跟随本体的周期伤害区域（2026-11-09 大威天芦「无尘禁土」102503），
     * 由 `ZCGameModel` 转给 `ZCAttackResolutionSystem.castSelfAura`。
     *
     * 返回 `false` ⇒ 参数不全（半径 / 时长 / 倍率有 0），此时不要消费 CD ——
     * 与 `castSecondary` / `strike` 同一条口径。
    */
    castSelfAura?(unit: ZCUnitState): boolean;
    /**
     * 五雷轰顶到点放雷（2026-11-11 磁电菇「五雷轰顶」101603），由 `ZCGameModel` 转给
     * `ZCAttackResolutionSystem.castBoltLine`。
     *
     * 返回 `false` ⇒ 参数不全（道数 / 倍率 / 半径有 0）或没有锁定目标，此时不要消费 CD ——
     * 与 `castSecondary` / `castSelfAura` / `strike` 同一条口径。
    */
    castBolt?(unit: ZCUnitState): boolean;
    /**
     * 陷阱到点布置，转给 `ZCAttackResolutionSystem.castTrap`。
     * 返回 false 表示参数不全，调用方不要消费 CD；陷阱不设普攻射程闸门。
    */
    castTrap?(unit: ZCUnitState): boolean;
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
     * 真回了才推 `heal` 飘字。不要在这里直接 `unit.hp += x`，否则同一件事两套口径。
     * 缺省 ⇒ 治疗类参数整段不执行。
    */
    healUnit?(unit: ZCUnitState, amount: number): void;
    /**
     * 多点打击（2026-10-30「戈壁狂箭」100804 /「追踪导弹」101003）。
     *
     * 由组合根转给 `ZCAttackResolutionSystem.strikeTargets`：挑人、伤害、溅射、吸血、处决
     * 全在攻击系统里，本系统只负责「到点了该打一波」。返回实际命中个数，
     * 0 ⇒ 这一帧没打到人，调用方不要消费 CD（与副轨同口径）。
    */
    strike?(unit: ZCUnitState, options: IZCStrikeOptions): number;
    /**
     * 把单位挪到指定世界坐标，转给 `ZCMovementSystem.placeAt`，保持坐标与占格同一口径。
     * 缺省时 `blink_strike` 整段不执行。
    */
    blinkTo?(unit: ZCUnitState, x: number, y: number): void;
    /**
     * 取单位的世界坐标。
     *
     * 与 `blinkTo` 成对：`strikeTargets` 用的是 `context.unitPosition`，这里挑「最近的敌人」
     * 必须用同一份坐标，否则会出现「挑中了、打不到」。
     * 缺省 ⇒ 退回 `freeX/freeY`（快照里一定有，只是可能落后于本帧的移动推进）。
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

/**
 * 多点打击命中后挂的状态（`strikeAppliesStatus = 1` 时生效）：麻痹。
 *
 * 2026-11-17 急冻瓜「急冻光线」102404 用。为什么写死：`skillParamJson` 只有数值槽，
 * 装不下状态 id；而 `runtime.statusId` 是整卡共用的一个槽（同一张卡的 102401~102404 都挂在
 * `68024:30671` 这个键上），借它会顺带把这张卡的普攻也变成「每发都麻痹」。
 * 用 `numb` 而不是 `paralysis`：前者只禁攻击 + 移速 −50%（软控），后者是 3 秒硬控。
*/
const ZC_STRIKE_NUMB_STATUS_ID = 'numb';

/**
 * 每个 `unit.id` 槽位多加的退避（秒）：4 个槽 ⇒ 0.2 ~ 1.1s 的错峰。
 *
 * 0.2s 量级的错峰在 20Hz 模拟下只差 3~4 帧，两条龙的导弹仍然糊成一波（实测 0.15s）；
 * 要"一眼看出是两波"就得拉到 0.3s 以上 —— 代价是打空的那条龙晚至多 0.9s 才补发，
 * 对 12s CD 的技能无感。
*/
const STRIKE_RETRY_JITTER = 0.3;

/** 错峰槽数（`unit.id % 它`）。*/
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
            //  触发范围闸门（2026-11-11）：每个单位每步只算一次，四条打人型车道共用。
            //  缺省（老上下文 / 单测夹具）⇒ 恒 true，等价于「不设闸门」。
            const release = context.inAttackRange?.(unit) ?? true;

            if (this.applyPassiveStatus(state, unit, runtime, context)) statusChanged = true;
            this.applyHpRegen(unit, dt, now, context);
            if (this.applyTeamAura(state, unit, runtime, context)) statusChanged = true;
            if (this.applySelfCast(state, unit, params, now, context)) statusChanged = true;
            if (this.applySelfAura(state, unit, params, now, context, release)) statusChanged = true;
            this.applyBoltStrike(unit, params, now, context, release);
            this.applyTrap(unit, params, now, context);
            this.applyRandomStrike(state, unit, params, now, context, release);
            this.applyBlinkStrike(state, unit, params, now, context, runtime, release);
            this.expireShield(unit, now);
            this.advanceBurst(state, unit, now, context);
            this.advanceSecondary(unit, params, now, context, release);
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
     * 每秒回复（`pvpAttrMap.hpRegenPct`，2026-11-17 波利奥「孢子回流」100601）。
     *
     * 设计口径：「每秒回复自身最大生命的固定比例，不受治疗加成、不被护盾吸收，溢出丢弃」。
     *  · 「不受治疗加成 / 不被护盾吸收」由 `healUnit` 天然满足（它只做封顶，不吃任何倍率、不碰护盾）；
     *  · 「溢出丢弃」= `healUnit` 的封顶；
     *  · **结算点是整秒边界**，不是每帧按比例切碎：逐帧切碎的话 `healUnit` 会把小数抹掉
     *    （最大生命 1000、每秒 2% ⇒ 单帧 0.32 点 → 0），回血直接消失。
     * 用 `floor(now) - floor(now - dt)` 数「这一步跨过了几个整秒」，就能在跨秒那一帧补一拍；
     * 步长固定（1/30 s）时恒为 0 或 1，掉帧跨多秒也不会漏。
    */
    private static applyHpRegen(
        unit: ZCUnitState,
        dt: number,
        now: number,
        context: IZCSkillTriggerContext,
    ): void {
        const rate = Math.max(0, context.statPatchOf?.(unit)?.hpRegenPct ?? 0);
        if (!(rate > 0)) return;
        const ticks = Math.floor(now + 1e-9) - Math.floor(now - dt + 1e-9);
        if (ticks <= 0) return;
        const amount = unit.maxHp * rate / 100 * ticks;
        if (amount > 0) context.healUnit?.(unit, amount);
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

    /** 2. 护盾到期：只清 `shieldExpireAt` 到点的那批，没设过期的（旧光环盾）永远不动。*/
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
        //  用「当前时刻」推进而不是 `+= interval`：模拟步被拉长时不会攒出一串子弹同帧齐发。
        unit.burstNextAt = now + interval;
        if (unit.burstShotsLeft <= 0) {
            delete unit.burstShotsLeft;
            delete unit.burstNextAt;
            delete unit.burstInterval;
            delete unit.burstDamageRate;
        }
    }

    /** 4. 副轨主动：按 `secondaryCooldown` 到点清一次扇形（椰蛋战士「横扫」）。*/
    private static advanceSecondary(
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
        release: boolean,
    ): void {
        const cooldown = Math.max(0, params?.secondaryCooldown ?? 0);
        if (!(cooldown > 0)) return;
        const readyAt = unit.secondaryReadyAt;
        //  首次：从「当前时刻 + CD」起算，开局不立刻放（与 `consumeEmpoweredAttack` 的 CD 分支同口径）。
        if (readyAt === undefined) { unit.secondaryReadyAt = now + cooldown; return; }
        if (now < readyAt) return;
        //  触发范围闸门（2026-11-11）：`castFanSkill` 只判「有没有锁定目标」，锁敌是仇恨锁、
        //  目标可能在半张图外跑过来 —— 那样扇形会原地清一片空气却把 CD 记掉。这里先挡一道。
        if (!release) return;
        //  没打出去就不消费 CD —— 跑位途中别把这次机会转掉。
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
        const cooldown = Math.max(0, params?.selfCastCooldown ?? 0);
        if (!(cooldown > 0)) return false;
        const readyAt = unit.selfCastReadyAt;
        if (readyAt === undefined) { unit.selfCastReadyAt = now + cooldown; return false; }
        if (now < readyAt) return false;
        unit.selfCastReadyAt = now + cooldown;
        //  施法动作 + 原地锁（2026-11-13 用户口径）：buff 类是唯一「打断 walk、停在原地」
        //  的一类 —— 回血 / 加伤这些不出手的主动，人跑着放出来没人看得见效果。
        //   只有这条车道 `hold = true`：别的主动都是打人的，锁住会毁掉追击与走位。
        this.markCastAction(unit, now, true);

        const seconds = Math.max(0, params?.selfCastSeconds ?? 0);
        const mods: ZCStatusStatMods = {};
        const damagePct = params?.selfCastDamagePct ?? 0;
        const attackSpeedPct = params?.selfCastAttackSpeedPct ?? 0;
        const lifestealPct = params?.selfCastLifestealPct ?? 0;
        const dodgePct = params?.selfCastDodgePct ?? 0;
        if (damagePct) mods.damageRatePct = damagePct;
        if (attackSpeedPct) mods.attackIntervalPct = attackSpeedPct;
        //  吸血口径与 `ZCUnitStatPatch.lifestealRate` 一致：比例，表里写 10 就是 10%。
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
        const selfHealPct = params?.selfCastHealPct ?? 0;
        if (selfHealPct > 0 && context.healUnit) {
            context.healUnit(unit, unit.maxHp * selfHealPct / 100);
        }

        //  友军治疗：与友军光环同一套「半径 × distanceScale」换算，只挑同阵营活着的。
        //  不含自己 —— 设计案把「自身回复 N%」和「友军回复 M%」写成两句话，
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
        release: boolean,
    ): boolean {
        if (!context.castSelfAura) return false;
        const cooldown = Math.max(0, params?.auraCooldown ?? 0);
        //  第二种触发口径（2026-11-11 磁电菇「磁电冲击」101604）：累计 N 次普攻。
        //  与 `random_strike` 的 `strikeEvery` 同一套算法，两种口径二选一。
        const every = Math.max(0, params?.auraEvery ?? 0);
        if (!(cooldown > 0) && !(every > 0)) {
            //  诊断3.-a：连冷却/次数参数都读不到 ⇒ 说明 `skillParamJson` 没进运行时
            //  （最可能是构筑期整卡被跳过，见 `[技能诊断][构筑]`）。
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`aura-params:${unit.id}`, '触发',
                    `${unit.unitId}#${unit.id} 自身光环没有 auraCooldown / auraEvery`
                    + `（读到 ${params?.auraCooldown ?? 'undefined'} / ${params?.auraEvery ?? 'undefined'}）`
                    + '⇒ 这条车道整段不执行');
            }
            return false;
        }
        if (cooldown > 0) {
            const readyAt = unit.auraReadyAt;
            //  首次：从「当前时刻 + CD」起算，开局不立刻放（与 `secondaryReadyAt` / `selfCastReadyAt` 同口径）。
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
            //  按累计普攻次数：`completedAttackCount` 由普攻流程推进，这里只比「比上次多打了 N 次」。
            const done = unit.completedAttackCount ?? 0;
            const fired = unit.auraFiredCount;
            if (fired === undefined) { unit.auraFiredCount = done; return false; }
            if (done - fired < Math.round(every)) return false;
        }
        //  触发范围闸门（2026-11-11）：条件满足但普攻范围内没人 ⇒ 待触发，不消费条件。
        //  放在 `castSelfAura` 之前：那片区域是「打人」的，身边没人时开出来只是一块空烧的地。
        //  次数分支这里不推进 `auraFiredCount` —— 目标一进范围那一下立刻补放。
        if (!release) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`aura-pending:${unit.id}`, '触发',
                    `${unit.unitId}#${unit.id} ${now.toFixed(1)}s 触发条件已满足但普攻范围内没有目标 ⇒ 待触发`);
            }
            return false;
        }
        //  技能自己的触发距离（2026-11-12 用户口径）：喷火的释放距离要小于普攻射程、
        //  并且与特效长度对齐 —— 「只有敌人处于 350px 这个距离才会被攻击」。
        //  与上面那道普攻射程闸门是串联的：先证明「普攻够得着」，再把范围往下压。
        //  配 0 / 缺省 ⇒ 不压，退回「只看普攻射程」的旧行为。
        const triggerRange = Math.max(0, params?.auraTriggerRange ?? 0);
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
        //  参数不全（半径 / 时长 / 倍率有 0）⇒ 没真的开出来，不消费 CD / 不记次数。
        const cast = context.castSelfAura(unit);
        if (zcSkillCastWatched(unit.unitId)) {
            //  用「值变化才打」：失败时每帧都会走到这里，直接打就是每帧一行的洪水。
            skillCastLogChanging(`aura-cast:${unit.id}`, '触发', cast
                ? `${unit.unitId}#${unit.id} ${now.toFixed(1)}s 施放成功，`
                    + (cooldown > 0 ? `CD 推到 ${(now + cooldown).toFixed(1)}s` : `次数记到 ${unit.completedAttackCount ?? 0}`)
                : `${unit.unitId}#${unit.id} ${now.toFixed(1)}s 施放被拒（参数不全）⇒ 不消费条件，下帧重试`);
        }
        if (!cast) return false;
        if (cooldown > 0) unit.auraReadyAt = now + cooldown;
        else unit.auraFiredCount = Math.max(0, Math.round(unit.completedAttackCount ?? 0));
        //  施法动作（2026-11-13）：光环是「打人」的主动，只换动画片段、不原地锁住 ——
        //  无尘禁土 / 喷射火焰本来就跟着人走，锁在原地会让喷火变成站桩。
        this.markCastAction(unit, now, false);

        //  2. 光环期间的自身增伤。按「生效词缀签名」复用同一条状态定义（`selfCastStatusId`），
        //  避免每张卡每种数值都往状态系统里塞一条新定义。
        const selfDamagePct = Math.max(0, params?.auraSelfDamagePct ?? 0);
        const seconds = Math.max(0, params?.auraSeconds ?? 0);
        if (!(selfDamagePct > 0) || !(seconds > 0)) return false;
        const mods: ZCStatusStatMods = { damageRatePct: selfDamagePct };
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
     * 五雷轰顶：锁一个目标，把雷沿「目标背朝向」排开，每道雷独立计伤、独立判麻痹。
     * 与副轨/自身光环/多点打击的区别：方向由目标背朝向定，落点与目标强绑定。
     * 参数：boltCooldown/Count/Spacing/Interval/Delay/DamageRate/Radius/NumbChance/NumbSeconds。
    */
    private static applyBoltStrike(
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
        release: boolean,
    ): void {
        if (!context.castBolt) return;
        const cooldown = Math.max(0, params?.boltCooldown ?? 0);
        if (!(cooldown > 0)) {
            //  诊断9.-a：读到 0 ⇒ `skillParamJson` 没进运行时（整卡被跳过），这条车道整段不执行。
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`bolt-params:${unit.id}`, '触发',
                    `${unit.unitId}#${unit.id} 五雷轰顶没有 boltCooldown`
                    + `（读到 ${params?.boltCooldown ?? 'undefined'}）⇒ 这条车道整段不执行`);
            }
            return;
        }
        const readyAt = unit.boltReadyAt;
        //  首次：从「当前时刻 + CD」起算，开局不立刻放（与 `auraReadyAt` / `strikeReadyAt` 同口径）。
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
        //  触发范围闸门（2026-11-11）：冷却到点但普攻范围内没人 ⇒ 待触发，不消费 CD。
        if (!release) {
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

    // 精密陷阱

    /**
     * 精密陷阱：留在原地的布置物，只在「被踩」与「到点」两个时刻各结算一次。
     * 不设普攻射程闸门：落点在自己脚下，等目标进范围会永远落在追兵身后。
     * 参数：trapCooldown/Duration/Radius/DamageRate/ExplodeRadius/ExplodeDamageRate/Forward。
    */
    private static applyTrap(
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
    ): void {
        if (!context.castTrap) return;
        const cooldown = Math.max(0, params?.trapCooldown ?? 0);
        if (!(cooldown > 0)) {
            //  诊断 10-a：只有本卡确实配了 `trap*` 参数才说话。
            //  这条车道对每个单位每步都会过一遍（`castTrap` 是全局钩子），没有陷阱的卡
            //  （大威天芦、磁电菇……）在这里本来就该静默返回；不加这个条件，
            //  只要 `zcSkillCastWatched` 开着，别的卡就会被刷成「精密陷阱没有 trapCooldown」。
            if (zcSkillCastWatched(unit.unitId)) {
                const declared = !!params && Object.keys(params).some((key) => key.startsWith('trap'));
                if (declared) {
                    skillCastLogChanging(`trap-params:${unit.id}`, '触发',
                        `${unit.unitId}#${unit.id} 精密陷阱没有 trapCooldown`
                        + `（读到 ${params?.trapCooldown ?? 'undefined'}）⇒ 这条车道整段不执行`);
                }
            }
            return;
        }
        const readyAt = unit.trapReadyAt;
        //  首次：从「当前时刻 + CD」起算，开局不立刻放（与 `boltReadyAt` / `auraReadyAt` 同口径）。
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
        //  施法动作（2026-11-13）：放下陷阱也算一次主动出手，蹲下摆一个是有必要的；
        //  但不原地锁住 —— 陷阱是「放下就不管」，锁住只会拖慢下一次走位。
        this.markCastAction(unit, now, false);
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
        release: boolean,
    ): void {
        if (!context.strike) return;
        const count = Math.max(0, params?.strikeCount ?? 0);
        const radius = Math.max(0, params?.strikeRadius ?? 0);
        if (!(count >= 1) || !(radius > 0)) return;
        const cooldown = Math.max(0, params?.strikeCooldown ?? 0);
        const every = Math.max(0, params?.strikeEvery ?? 0);
        if (!(cooldown > 0) && !(every > 0)) return;
        const scale = Math.max(1e-6, context.distanceScale ?? 1);
        //  触发范围封顶（2026-11-11 用户口径「直接压到普攻范围」）：
        //  技能自带的搜索半径压到普攻射程以内，只压不抬 ——
        //  镭射飞龙 1100（330px）压到普攻射程；毒箭蘑菇 252（75.6px）本来就比普攻近，保持原样。
        const reachCap = Math.max(0, context.attackReachOf?.(unit) ?? Number.POSITIVE_INFINITY);
        const searchRadius = Math.min(radius * scale, reachCap);
        const missileFx = zcMissileFxOf(unit.unitId);
        //  诊断2.：参数快照 + 每次开火结果。打空时 `fire()` 每帧都会被叫一遍（`if (!fire()) return;`
        //  不推进冷却），所以用「值变化才打」的通道，失败只留第一条、转成功再补一条。
        if (missileFx) {
            missileLogOnce(`strike-params:${unit.unitId}`,
                '模型',
                `单位 ${unit.unitId} 拿到导弹参数：strikeCount=${count} strikeRadius=${radius}`
                + `（世界 ${(radius * scale).toFixed(1)}，封顶后 ${searchRadius.toFixed(1)}）`
                + ` cooldown=${cooldown} every=${every}`
                + ` nearest=${params?.strikeNearest ?? 0} splash=${params?.strikeSplashRadius ?? 0}`
                + ` | 弹体=${missileFx.missilePrefabPath} 爆炸=${missileFx.impactPrefabPath}`);
        }
        const fire = (): boolean => {
            const options: IZCStrikeOptions = {
                count: Math.round(count),
                radius: searchRadius,
                damageRate: Math.max(0, params?.strikeDamageRate ?? 1),
                nearest: (params?.strikeNearest ?? 0) > 0,
                splashRadius: Math.max(0, params?.strikeSplashRadius ?? 0) * scale,
                splashDamageRate: Math.max(0, params?.strikeSplashDamageRate ?? 0),
                splashFalloff: Math.max(0, Math.min(1, params?.strikeSplashFalloff ?? 0)),
                //  命中挂状态（2026-11-17 急冻瓜「急冻光线」102404）：必须显式开
                //  `strikeAppliesStatus = 1` 才挂，缺省 0 ⇒ 既有 `random_strike` 行为逐字不变。
                //  🔴 状态 id **不能**取 `runtime.statusId`：那是整卡共用的一个槽
                //  （`mergeSkillPlanIntoRuntime` 按 `unitId:pvpSkillId` 合并），
                //  写了它会让这张卡的**普攻每一发**都挂上同一个状态（`hitStatusOnBeat` 对
                //  没配 `statusEveryNAttacks` 的技能恒为 true）。与落雷同一个理由写死常量。
                statusId: (params?.strikeAppliesStatus ?? 0) > 0 ? ZC_STRIKE_NUMB_STATUS_ID : undefined,
                //  追踪导弹（镭射飞龙 68010）：挑到人就发会飞的导弹，不立即结算。
                missilePrefabPath: missileFx?.missilePrefabPath,
                impactPrefabPath: missileFx?.impactPrefabPath,
                arcOffset: missileFx?.arcOffset ?? 0,
                missileSpeed: missileFx?.speed,
                //  恒定发数（策划口径 3 颗）：在这里只报一个上限，真正钳的是 `strikeTargets`。
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
            //  施法动作（2026-11-13）：打空了不算「出手」，不刷窗口 —— 否则每帧重试会原地抖。
            if (hits > 0) this.markCastAction(unit, now, false);
            return hits > 0;
        };
        const windowSeconds = Math.max(0, params?.strikeSeconds ?? 0);
        const interval = Math.max(0.05, params?.strikeInterval ?? 1);

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
                //  首轮相位：导弹按 `unit.id` 错峰（见 `STRIKE_PHASE_STRIDE`），
                //  其余 `random_strike` 保持「到点就打、不加相位」的旧口径。
                const phase = missileFx
                    ? (unit.id % STRIKE_PHASE_SLOTS) * STRIKE_PHASE_STRIDE
                    : 0;
                unit.strikeReadyAt = now + cooldown + phase;
                //  诊断7.：冷却挂上的那一刻。看到这行就说明「技能确实在跑」，只是还没到点；
                //  之后每 `cooldown` 秒会尝试开一次（成败见上面两条）。
                if (missileFx) {
                    missileLog('模型', `#${unit.id} 追踪导弹冷却挂上：${now.toFixed(1)}s → `
                        + `${(now + cooldown + phase).toFixed(1)}s 首次可开火`
                        + `（cooldown=${cooldown}s + 错峰 ${phase.toFixed(2)}s）`);
                }
                return;
            }
            if (now < readyAt) return;
            //  触发范围闸门（2026-11-11）：到点但普攻范围内没人 ⇒ 待触发，CD 保持就绪。
            if (!release) return;
            //  打空后的退避：见 `STRIKE_RETRY_SECONDS`。没打空过（`strikeRetryAt` 缺省）⇒ 不停留。
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
        //  按累计普攻次数：`completedAttackCount` 由普攻流程推进（强化槽用的是同一个计数），
        //  这里只负责「比上次多打了 N 次就打一波」。
        const done = unit.completedAttackCount ?? 0;
        const fired = unit.strikeFiredCount;
        if (fired === undefined) { unit.strikeFiredCount = done; return; }
        if (done - fired < Math.round(every)) return;
        //  触发范围闸门（2026-11-11）：次数攒够了但身边没人 ⇒ 待触发。
        //  不推进 `strikeFiredCount` —— 目标一进范围，这一波立刻补出去。
        if (!release) return;
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
        release = true,
    ): void {
        const cooldown = Math.max(0, params?.blinkCooldown ?? 0);
        if (!(cooldown > 0)) return;
        const scale = Math.max(1e-6, context.distanceScale ?? 1);
        const posOf = (target: ZCUnitState): { x: number; y: number } => (context.unitPosition
            ? { ...context.unitPosition(target) }
            : { x: target.freeX, y: target.freeY });

        //  1. 先结算到点的分身，再判本次 CD —— 反过来的话「闪回 + 分身同帧」会把爆炸推迟一轮。
        const cloneAt = unit.blinkCloneAt;
        if (cloneAt != null && now >= cloneAt) {
            const radius = Math.max(0, params?.blinkCloneRadius ?? 0) * scale;
            const rate = Math.max(0, params?.blinkCloneDamageRate ?? 0);
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
        //  首次：从「当前 + CD」起算，开局不立刻闪（与副轨 / 自身施法同口径）。
        if (readyAt === undefined) { unit.blinkReadyAt = now + cooldown; return; }
        if (now < readyAt) return;

        //  触发范围闸门（2026-11-11）：到点但普攻范围内没人 ⇒ 待触发，不消费 CD。
        if (!release) return;
        //  触发范围封顶（用户口径「直接压到普攻范围」）：`blinkSearchRadius` 是表值 px，
        //  魔术师配的 600（约 180px）大于普攻射程 148.5px ⇒ 压到普攻射程；只压不抬。
        const reachCap = Math.max(0, context.attackReachOf?.(unit) ?? Number.POSITIVE_INFINITY);
        const searchRadius = Math.min(Math.max(0, params?.blinkSearchRadius ?? 0) * scale, reachCap);
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
        //  没有目标 ⇒ 不消费 CD。闪现的全部意义就是「贴上去」，空闪只会浪费 12 秒。
        if (!victim) return;

        const target = posOf(victim);
        const dx = target.x - self.x;
        const dy = target.y - self.y;
        const length = Math.hypot(dx, dy);
        const stop = Math.max(0, params?.blinkStopDistance ?? 30) * scale;
        const landX = length > stop && length > 1e-9 ? target.x - dx / length * stop : target.x;
        const landY = length > stop && length > 1e-9 ? target.y - dy / length * stop : target.y;
        const hitRadius = Math.max(1, Math.max(0, params?.blinkHitRadius ?? 40) * scale);
        const damageRate = Math.max(0, params?.blinkDamageRate ?? 0);

        //  出发地闪一下（需求 2026-11-07）。放在 `blinkTo` 之前：这条事件用的是 `self`，
        //  而 `self` 是闪走之前的坐标 —— 先位移再取，位置就成落点了。
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
            //  半径 / 伤害一律 0：这是一条纯表现事件，谁都不结算。
            //  写成落点判定半径会让「闪走的地方」和「打到谁」在日志里混成一条。
            radius: 0,
            damage: 0,
            empowered: false,
            startedAt: now,
            durationSeconds: ZC_BLINK_CAST_EFFECT_SECONDS,
        });
        context.blinkTo(unit, landX, landY);
        //  施法动作（2026-11-13）：闪走之后在落点播半秒攻击动作；不锁原地（人已经被挪走了）。
        this.markCastAction(unit, now, false);
        if (damageRate > 0) {
            context.strike(unit, { count: 1, radius: hitRadius, damageRate, nearest: true });
        }
        //  2. 往返（II 级起）：闪回原位再打同样一发。回位用施法时的坐标，
        //     不是「当前位置」—— 否则闪过去之后回位点会跟着变。
        if ((params?.blinkRoundTrip ?? 0) > 0) {
            context.blinkTo(unit, self.x, self.y);
            if (damageRate > 0) {
                context.strike(unit, { count: 1, radius: hitRadius, damageRate, nearest: true });
            }
        }
        //  3. 分身：留在原位，到时爆炸。
        const cloneRate = Math.max(0, params?.blinkCloneDamageRate ?? 0);
        if (cloneRate > 0) {
            unit.blinkCloneX = self.x;
            unit.blinkCloneY = self.y;
            unit.blinkCloneAt = now + Math.max(0, params?.blinkCloneSeconds ?? 0);
        }
        unit.blinkReadyAt = now + cooldown;
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
