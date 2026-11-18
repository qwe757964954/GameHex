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
    dashGuardStatusId, dashVulnerableStatusId,
} from '../ZCDashFx';
import { ZC_BARRAGE_DEFAULT_INTERVAL } from '../ZCWindBarrageFx';
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
     * 孢爆箭 / 孢子凝珠到点射一发（`splash_shot` / `spore_burst`），由 `ZCGameModel` 转给
     * `ZCAttackResolutionSystem.castSplashShot`。
     *
     * `slowStatusId` 由本系统按参数算好再传进去：状态定义归状态系统管（要 `register`），
     * 几何与伤害归攻击系统管 —— 两边各查一次表迟早会算歪。
     *
     * 返回 `false` ⇒ 参数不全 / 锁定目标已经跑出射程 / 射程内一个人都没有，
     * 此时**不要**消费 CD（与 `castSecondary` / `castSelfAura` / `strike` 同一条口径）。
     */
    castSplashShot?(unit: ZCUnitState, slowStatusId?: string): boolean;
    /**
     * 孢爆箭（新口径，2026-11-18 第 16 批）：射一枚风弹、命中后原地留一片飓风
     * （`wind_bolt`，风炮菇 101303），由 `ZCGameModel` 转给
     * `ZCAttackResolutionSystem.castWindBolt`。
     *
     * 返回 `false` ⇒ 参数不全 / 没有锁定目标 / 锁定目标跑出普攻射程，
     * 此时**不要**消费 CD（与 `castSplashShot` 同一条口径）。
     */
    castWindBolt?(unit: ZCUnitState): boolean;
    /**
     * 连射导弹（`missile_barrage`，风炮菇 101304）：发射**一颗**抛物线炸弹，
     * 由 `ZCGameModel` 转给 `ZCAttackResolutionSystem.castBarrageShot`。
     *
     * 为什么是「一颗」而不是「一轮」：一轮 3 颗的节拍（0 / 0.4 / 0.8s）由本系统的
     * `barrageShotsLeft` / `barrageNextAt` 推进，落点每颗各自重算 —— 见
     * `ZCAttackResolutionSystem.castBarrageShot` 的注释（`startedAt` 不能排到未来）。
     *
     * 返回 `false` ⇒ 参数不全 / 射程内没有目标。
     */
    castBarrageShot?(unit: ZCUnitState): boolean;
    /**
     * 菌毯爆发 / 菌核爆裂到点在自己脚下爆一次（`burst_aura` / `burst_knockback`），由
     * `ZCGameModel` 转给 `ZCAttackResolutionSystem.castBurstSkill`。
     *
     * `guardStatusId` 同样是「本系统算 id、状态系统存定义、攻击系统挂到施法者身上」的分工
     * （理由见 `castSplashShot` 那一段）。
     *
     * 返回 `false` ⇒ 参数不全 / 半径内一个人都没有，此时**不要**消费 CD。
     * ⚠️ 这条**不设普攻射程闸门**：设计口径是「半径 150 内的所有敌人」，
     * 用普攻射程去挡会变成「近战站脸上不放大招、远处一群怪却不放」—— 判据由
     * `castBurstSkill` 自己按爆发半径算，命中 0 人即视为没放。
     */
    castBurstSkill?(unit: ZCUnitState, guardStatusId?: string): boolean;
    /**
     * 菌丝绞杀到点朝身前扇形甩一次（`fan_slow`），由 `ZCGameModel` 转给
     * `ZCAttackResolutionSystem.castFanSweep`。
     *
     * 返回 `false` ⇒ 参数不全 / 扇形内一个人都没有，此时**不要**消费 CD。
     * 与 `castBurstSkill` 同理：**不设普攻射程闸门**，判据是「扇形半径内有没有人」
     * （表值 150 大于近战普攻射程，用射程挡会漏掉「怪就在面前 40px 但普攻够不着」的情形）。
    */
    castFanSweep?(unit: ZCUnitState, slowStatusId?: string): boolean;
    /**
     * 冲锋到点往「起冲点 → 落点」这条线段上撞人（`charge_shield` / `legacy_dash`，2026-11-17 第 15 批），
     * 由 `ZCGameModel` 转给 `ZCAttackResolutionSystem.castChargeDash`。
     *
     * 几何（选向 / 冲刺格数 / 落点钳制）由本系统算好再传进来，攻击系统只负责
     * 「线段上撞到了谁、各挨多少」以及落地自保 —— 与 `castFanSweep`（形状由攻击系统算）
     * 的分工不同，因为冲锋的落点要先挪人，而 `blinkTo` 只在本系统这一侧有接线。
     *
     * 返回撞到的人数。**命中 0 人也照常消费 CD**（人已经冲出去了），
     * 与「打不出去不消费 CD」的那几条（扇形 / 爆发 / 突刺）刻意不同。
     */
    castChargeDash?(unit: ZCUnitState, options: IZCChargeDashOptions): number;
    /**
     * 世界坐标 → 格子 id（取不到返回 `null`）。
     *
     * 只给冲锋用：冲锋是**定长位移**（1~2 格），不像闪现 / 突刺那样「贴着一个必然合法的
     * 目标落点走」。没有这一层校验，站在地图边缘朝外冲就会把单位送出可玩区域
     * （`placeAt` 不做边界检查），之后选目标 / 占格全乱。
     * 缺省 ⇒ 不校验（单测夹具可以不传）。
     */
    hexIdAt?(x: number, y: number): number | null;
    /**
     * 当前锁定的攻击目标（世界坐标）；没有返回 `null`。
     *
     * 只给菌盾冲锋定方向用（设计案「向目标方向冲撞 1 格」）。与攻击系统读的是
     * 同一个 `unitTargeting.current` —— 两边各挑一次会出现「朝 A 的格子冲、打 B」。
     * 缺省 ⇒ 冲锋退回面朝方向。
     */
    currentTarget?(unit: ZCUnitState): { readonly x: number; readonly y: number } | null;
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
            if (this.applyCounterBuff(state, unit, params, now, context)) statusChanged = true;
            if (this.applySelfAura(state, unit, params, now, context, release)) statusChanged = true;
            this.applyBoltStrike(unit, params, now, context, release);
            this.applyTrap(unit, params, now, context);
            this.applySplashShot(unit, params, now, context, release);
            this.applyWindShot(unit, params, now, context, release);
            this.applyMissileBarrage(unit, params, now, context, release);
            this.applyBurstSkill(unit, params, now, context);
            this.applyFanSweep(unit, params, now, context);
            this.applyChargeShield(state, unit, params, now, context);
            this.applyRandomStrike(state, unit, params, now, context, release);
            this.applyBlinkStrike(state, unit, params, now, context, runtime, release);
            this.applySingleStrike(state, unit, params, now, context);
            this.applyLegacyDash(state, unit, params, now, context);
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
     * 累计普攻型自我增益（2026-11-18 第 17 批）。
     *
     * 设计口径：打满 N 次普攻 ⇒ 给自己开一段限时增益。
     *   · 101904 生命爆发：移速 +50/80/100%、体型 ×2、最大生命 +15/30/50%；
     *   · 102704 战神附体：体型 ×2、移速 −15%、攻击 +50/70/100%，6 秒，释放瞬间回 15% 最大生命。
     *
     * 参数：counterEvery / counterSeconds / counterMoveSpeedPct / counterAttackPct /
     *       counterMaxHpPct / counterBodySizePct / counterHealMaxHpPct。
     *
     * 与 `applySelfAura` 的次数分支是同一套「比上次多打了 N 次」算法，差别只有两处：
     *  · 那个要过 `release`（普攻范围内得有人）才放 —— 因为区域是打人的；这里加成的是自己，
     *    敌方在不在射程内都该放（与 `self_cast` 同口径，不设射程闸门）；
     *  · 那个记在 `auraFiredCount`，这里记在 `counterFiredCount` —— 各记各的，
     *    否则同一张卡两条车道会互相吃掉对方攒的次数。
     */
    private static applyCounterBuff(
        state: ZCSnapshot,
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
    ): boolean {
        const every = Math.max(0, Math.round(params?.counterEvery ?? 0));
        if (!(every > 0)) return false;
        const done = unit.completedAttackCount ?? 0;
        const fired = unit.counterFiredCount;
        //  第一次推进只记下当前计数，不补放（与 `auraFiredCount` / `barrageFiredCount` 同口径）。
        if (fired === undefined) { unit.counterFiredCount = done; return false; }
        if (done - fired < every) return false;

        const seconds = Math.max(0, params?.counterSeconds ?? 0);
        const mods: ZCStatusStatMods = {};
        const moveSpeedPct = params?.counterMoveSpeedPct ?? 0;
        const attackPct = params?.counterAttackPct ?? 0;
        const maxHpPct = params?.counterMaxHpPct ?? 0;
        const bodySizePct = params?.counterBodySizePct ?? 0;
        if (moveSpeedPct) mods.moveSpeedPct = moveSpeedPct;
        if (attackPct) mods.attackPct = attackPct;
        if (maxHpPct) mods.maxHpPct = maxHpPct;
        if (bodySizePct) mods.bodySizePct = bodySizePct;
        //  参数不全（没时长，或四项增益全 0）⇒ 没真的放出来，**不消费次数**，下帧重试。
        if (!(seconds > 0) || !Object.keys(mods).length) return false;

        unit.counterFiredCount = done;
        //  buff 类与 `self_cast` 一样「停在原地放」（`hold = true`）：人跑着放大，玩家看不出效果。
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
        //  回血按「吃到增益之后的上限」算（与 `applySelfCast` 的 selfCastHealPct 同一口径）。
        const healPct = Math.max(0, params?.counterHealMaxHpPct ?? 0);
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

    // 孢爆箭 / 孢子凝珠

    /**
     * 孢爆箭 / 孢子凝珠：冷却到点朝锁定目标射一枚「命中就爆开」的弹。
     *
     * 参数（`skillParamJson`，全部带 `shot` 前缀）：`shotCooldown` 冷却秒数 /
     * `shotDamageRate` 相对面板的伤害倍率 / `shotRadius` 爆点半径（表值逻辑 px）/
     * `shotSlowRatio` 减速百分点（0 = 不减速）/ `shotSlowSeconds` 减速时长。
     *
     * 🔴 **为什么前缀是 `shot` 而不是设计案 P 列原来写的 `damageRate` / `splashRadius`**：
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
        release: boolean,
    ): void {
        if (!context.castSplashShot) return;
        const cooldown = Math.max(0, params?.shotCooldown ?? 0);
        if (!(cooldown > 0)) return;
        const readyAt = unit.splashReadyAt;
        //  首次：从「当前时刻 + CD」起算，开局不立刻放（与 `boltReadyAt` / `trapReadyAt` 同口径）。
        if (readyAt === undefined) {
            unit.splashReadyAt = now + cooldown;
            return;
        }
        if (now < readyAt) return;
        //  触发范围闸门：到点但普攻范围内没人 ⇒ 待触发、CD 保持就绪。
        if (!release) return;
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
        const slowPct = Math.max(0, Math.min(100, params?.shotSlowRatio ?? 0));
        const seconds = Math.max(0, params?.shotSlowSeconds ?? 0);
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
     * 孢爆箭（新口径，2026-11-18 第 16 批）：`windCooldown` 到点射一枚风弹。
     *
     * 与上一版（第 12 批借用 `splash_shot`：命中点周围均等溅射）的差别全在攻击系统那一侧，
     * 触发这一侧只换了两件事：
     *  · 车道从 `splashReadyAt` 换成 `windReadyAt` —— 同一张卡（风炮菇 68013）今后若再出现
     *    一条 `splash_shot`，两条不该互相顶掉冷却（`unit.*ReadyAt` 一条车道一格）；
     *  · 依然吃 `release`（普攻射程）闸门：设计写的是「向目标射出」，锁定目标跑出射程
     *    就不该放，而不是随手换一个更近的人。
     *
     * 参数（`skillParamJson`，`wind` 前缀）：windCooldown / windDamageRate / windSpeed /
     * windLifeSeconds / windZoneRadius / windZoneSeconds / windZoneDamageRate。
     * 🔴 前缀不能省：`68013:30401` 这个袋子里已经住着 101301 的 `bulletFalloff`、
     * 101302 的 `mix.*`、以及本批 101304 的 `barrage*` —— 裸 `cooldown` / `damageRate`
     * 会直接把别条车道改掉，而且不报错。
    */
    private static applyWindShot(
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
        release: boolean,
    ): void {
        if (!context.castWindBolt) return;
        const cooldown = Math.max(0, params?.windCooldown ?? 0);
        if (!(cooldown > 0)) return;
        const readyAt = unit.windReadyAt;
        //  首次：从「当前时刻 + CD」起算，开局不立刻放（与 `splashReadyAt` / `trapReadyAt` 同口径）。
        if (readyAt === undefined) {
            unit.windReadyAt = now + cooldown;
            return;
        }
        if (now < readyAt) return;
        //  触发范围闸门：到点但普攻范围内没人 ⇒ 待触发、CD 保持就绪。
        if (!release) return;
        if (!context.castWindBolt(unit)) return;
        unit.windReadyAt = now + cooldown;
        //  施法动作：射一发算一次主动出手；不原地锁 —— 射手要边走边放。
        this.markCastAction(unit, now, false);
    }

    /**
     * 连射导弹（2026-11-18 第 16 批）：每累计 `barrageEvery` 次普攻放一轮，一轮 `barrageCount` 颗。
     *
     * 两段结构（**顺序不能反**）：
     *  1. **补发**：`barrageShotsLeft > 0` ⇒ 到点再发一颗，发完清字段。这一段必须在触发之前，
     *     否则一轮还没打完就又凑满 10 次普攻，会把「还剩几颗」覆盖掉（多发或少发）。
     *  2. **触发**：`completedAttackCount` 比上次触发时多出 `barrageEvery` 次 ⇒ 发第一颗 + 记次数。
     *
     * 三条设计口径：
     *  · **没有 CD**（J 列写的是「主动-累计普攻」，10 次一轮）；
     *  · **站在原地不动**：整轮都锁在原地（默认 0.5s 只够第一颗，这里按 `颗数 × 间隔` 补足）；
     *  · 补发那几颗若目标全没了，**照样消耗这一格** —— 一轮是「已经承诺出去」的，
     *    不然后面几颗会永远卡在队列里，下一次触发被堵住。
     *
     * 参数（`skillParamJson`，`barrage` 前缀）：barrageEvery / barrageCount / barrageInterval /
     * barrageDamageRate / barrageRadius。前缀理由见 `applyWindShot`。
    */
    private static applyMissileBarrage(
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
        release: boolean,
    ): void {
        if (!context.castBarrageShot) return;
        const interval = Math.max(0.05, params?.barrageInterval ?? ZC_BARRAGE_DEFAULT_INTERVAL);
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
        const every = Math.max(0, Math.round(params?.barrageEvery ?? 0));
        if (!(every > 0)) return;
        const done = unit.completedAttackCount ?? 0;
        const fired = unit.barrageFiredCount;
        if (fired === undefined) { unit.barrageFiredCount = done; return; }
        if (done - fired < every) return;
        //  触发范围闸门：凑满次数但普攻范围内没人 ⇒ 待触发、不记次数（目标进范围当帧补放）。
        if (!release) return;
        if (!context.castBarrageShot(unit)) return;
        unit.barrageFiredCount = done;
        const count = Math.max(1, Math.round(params?.barrageCount ?? 1));
        if (count > 1) {
            unit.barrageShotsLeft = count - 1;
            unit.barrageNextAt = now + interval;
        }
        //  施法动作 + 原地站定：「站在原地不动」要覆盖整轮（首发 + 后续几颗的间隔）。
        this.markCastAction(unit, now, true);
        unit.castHoldUntil = now + interval * (count - 1) + ZC_SELF_CAST_HOLD_SECONDS;
    }

    /**
     * 菌毯爆发 / 菌核爆裂：`burstCooldown` 到点在自己脚下爆一次（2026-11-17 第 13 批）。
     *
     * 与 `applySplashShot` 的三处差别：
     *  · **不吃 `release` 闸门**。那个闸门问的是「普攻射程内有没有人」，而这两条技能的
     *    判据是「爆发半径内有没有人」（150 / 120，普遍大于近战普攻射程）。用射程挡会出现
     *    「一群怪在 140px 处围着、战士因为普攻打不到而不放大招」这种明显错的结果。
     *    命中 0 人时 `castBurstSkill` 自己返回 false ⇒ CD 照样不消费，这条口径不变。
     *  · 圆心恒等于自己，不需要锁定目标 —— 所以也不存在「目标跑了就不放」。
     *  · 爆完给自己加什么由参数决定（护盾 / 击退），不由行为键分支：行为键只影响
     *    加载清单与配表可读性，结算一律看参数在不在。
     *
     * 参数（`skillParamJson`，`burst` 前缀）：burstCooldown / burstDamageRate / burstRadius /
     * burstShieldRatio / burstShieldSeconds / burstShieldReducePct / burstKnockbackCells。
     * 🔴 前缀不能省：68015 这张卡的另一条技能（爆囊扩散 101501）已经在同一个参数袋里写了
     * `splashRadius` / `splashDamageRate`，裸键会直接把普攻溅射改掉且不报错。
    */
    private static applyBurstSkill(
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
    ): void {
        if (!context.castBurstSkill) return;
        const cooldown = Math.max(0, params?.burstCooldown ?? 0);
        if (!(cooldown > 0)) return;
        const readyAt = unit.burstReadyAt;
        //  首次：从「当前时刻 + CD」起算，开局不立刻放（与 `splashReadyAt` / `trapReadyAt` 同口径）。
        if (readyAt === undefined) {
            unit.burstReadyAt = now + cooldown;
            return;
        }
        if (now < readyAt) return;
        const guardStatusId = this.burstGuardStatusId(params, context);
        if (!context.castBurstSkill(unit, guardStatusId)) return;
        unit.burstReadyAt = now + cooldown;
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
        const reducePct = Math.max(0, Math.min(95, params?.burstShieldReducePct ?? 0));
        const seconds = Math.max(0, params?.burstShieldSeconds ?? 0);
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
     * 菌丝绞杀：`fanCooldown` 到点朝身前扇形甩一次（2026-11-17 第 14 批）。
     *
     * 与 `applyBurstSkill` 同一条口径：**不吃 `release`（普攻射程）闸门** ——
     * 判据是「扇形半径内有没有人」（表值 150 普遍大于近战普攻射程），
     * 用射程挡会变成「怪就在扇形里、战士因为普攻够不着而不放」。
     * 命中 0 人时 `castFanSweep` 自己返回 false ⇒ CD 照样不消费。
     *
     * 参数（`skillParamJson`，`fan` 前缀）：fanCooldown / fanDamageRate / fanRadius /
     * fanAngle / fanMaxTargets / fanSlowRatio / fanSlowSeconds。
     * 🔴 前缀不能省：68015 这张卡的袋子里已经有 101501 的 `splashRadius`、
     * 101504 的 `burstRadius` —— 裸 `radius` 会同时改掉普攻溅射与爆发半径，且不报错。
    */
    private static applyFanSweep(
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
    ): void {
        if (!context.castFanSweep) return;
        const cooldown = Math.max(0, params?.fanCooldown ?? 0);
        if (!(cooldown > 0)) return;
        const readyAt = unit.fanReadyAt;
        //  首次：从「当前时刻 + CD」起算，开局不立刻甩（与其余四条车道同口径）。
        if (readyAt === undefined) {
            unit.fanReadyAt = now + cooldown;
            return;
        }
        if (now < readyAt) return;
        const slowStatusId = this.fanSweepSlowStatusId(params, context);
        if (!context.castFanSweep(unit, slowStatusId)) return;
        unit.fanReadyAt = now + cooldown;
        //  施法动作：甩一次算一次主动出手；不原地锁。
        this.markCastAction(unit, now, false);
    }

    /**
     * 菌丝绞杀的减速状态：按参数现算 id、缺定义就注册一条。
     *
     * 只有「比例和时长都 > 0」才建。`moveSpeedPct` 走百分点（`-40` = 移速 −40%），
     * 与 `__shotslow:`（第 12 批）同一单位 —— 写 0.4 等于没有。
    */
    private static fanSweepSlowStatusId(
        params: Readonly<Record<string, number>> | undefined,
        context: IZCSkillTriggerContext,
    ): string | undefined {
        const slowPct = Math.max(0, Math.min(100, params?.fanSlowRatio ?? 0));
        const seconds = Math.max(0, params?.fanSlowSeconds ?? 0);
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

    // 菌丝突刺

    /**
     * 菌丝突刺：贴到最近敌人身边打一发 + 眩晕（2026-11-17 第 14 批）。
     *
     * 为什么整条落在触发系统而不是攻击系统：它要**挪人**，而 `blinkTo` 只在触发侧的上下文里接线
     * （`ZCGameModel` 的 `buildSkillTriggerContext`）—— 与 `applyBlinkStrike` 同侧。
     *
     * 与 `applyBlinkStrike`（魔术师 103404）的三处差别：
     *  · 不打往返、不留分身、**不用普攻射程封顶**：突刺的意义就是「够不着才扑过去」，
     *    用普攻射程压住会把这条技能变成「原地打一发」；
     *  · 命中挂**硬控**（`control: 'stun'`，按参数生成 `__stunstrike:<秒>__`），
     *    而不是 103404 那种「只结算伤害」；
     *  · 命中后给自己加攻速（III 级），**空放不给** —— 所以增益挂在 `strike` 的返回值之后。
     *
     * 参数（`skillParamJson`，`single` 前缀）：singleCooldown / singleDamageRate /
     * singleSearchRadius / singleStopDistance / singleHitRadius /
     * singleStunSeconds / singleHastePct / singleHasteSeconds。
     * 🔴 前缀同样不能省：68014 的袋子里已经有 101401 的 `comboDamage`、101402 的 `mix.*`，
     * 裸 `cooldown` 与状态表列名撞车。
     *
     * 没目标 / 参数不全 ⇒ 什么都不做，**不消费 CD**（与闪现同一条口径：空放只会浪费 12 秒）。
    */
    private static applySingleStrike(
        state: ZCSnapshot,
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
    ): void {
        if (!context.blinkTo || !context.strike) return;
        const cooldown = Math.max(0, params?.singleCooldown ?? 0);
        if (!(cooldown > 0)) return;
        const readyAt = unit.singleReadyAt;
        //  首次：从「当前时刻 + CD」起算，开局不立刻扑（与其余车道同口径）。
        if (readyAt === undefined) { unit.singleReadyAt = now + cooldown; return; }
        if (now < readyAt) return;

        const scale = Math.max(1e-6, context.distanceScale ?? 1);
        const searchRadius = Math.max(0, params?.singleSearchRadius ?? 0) * scale;
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
        const stop = Math.max(0, params?.singleStopDistance ?? 30) * scale;
        const landX = length > stop && length > 1e-9 ? target.x - dx / length * stop : target.x;
        const landY = length > stop && length > 1e-9 ? target.y - dy / length * stop : target.y;
        const hitRadius = Math.max(1, Math.max(0, params?.singleHitRadius ?? 40) * scale);
        const damageRate = Math.max(0, params?.singleDamageRate ?? 0);
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

        const stunSeconds = Math.max(0, params?.singleStunSeconds ?? 0);
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
        const hastePct = Math.max(0, params?.singleHastePct ?? 0);
        const hasteSeconds = Math.max(0, params?.singleHasteSeconds ?? 0);
        if (hits > 0 && hastePct > 0 && hasteSeconds > 0) {
            const hasteStatusId = singleStrikeHasteStatusId(hastePct, hasteSeconds);
            if (!context.statusSystem.hasDef(hasteStatusId)) {
                context.statusSystem.register({
                    id: hasteStatusId,
                    name: hasteStatusId,
                    durationSeconds: hasteSeconds,
                    maxStacks: 1,
                    refreshPolicy: 'refresh',
                    //  `attackIntervalPct` 是「间隔缩短」口径：正值 = 攻速提升（30 = +30%）。
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
     * 菌盾冲锋：朝目标方向定长冲 1 格，撞到的敌人吃伤害，落点给自己挂护盾（2026-11-17 第 15 批）。
     *
     * 参数（`skillParamJson`，`charge` 前缀）：`chargeCooldown` / `chargeDamageRate` /
     * `chargeCells` / `chargeHitRadius` / `chargeShieldRatio` / `chargeShieldSeconds`。
     * 🔴 前缀不能省：`68012:30271` 这个袋子里已经有 101203 的 `mix.critRate`，
     * 与 `legacy_dash` 那条（`dash*`）也只差一张卡 —— 裸 `cooldown` / `damageRate` 迟早串车。
     *
     * 与 `applyLegacyDash` 的差别只有三处：**选向**（朝目标 / 面朝）、
     * **冲刺距离**（定长格数）、**落地给自己什么**（护盾）。位移 + 线段命中是同一套。
     *
     * 不吃普攻射程闸门（`release`）：冲锋的全部意义就是「够不着才冲过去」，
     * 与 `applySingleStrike` 同一条理由。
     */
    private static applyChargeShield(
        state: ZCSnapshot,
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
    ): void {
        if (!context.castChargeDash || !context.blinkTo) return;
        const cooldown = Math.max(0, params?.chargeCooldown ?? 0);
        if (!(cooldown > 0)) return;
        const readyAt = unit.chargeReadyAt;
        //  首次：从「当前 + CD」起算，开局不立刻冲（与其余车道同口径）。
        if (readyAt === undefined) { unit.chargeReadyAt = now + cooldown; return; }
        if (now < readyAt) return;
        const damageRate = Math.max(0, params?.chargeDamageRate ?? 0);
        if (!(damageRate > 0)) return;
        const heading = this.dashHeadingTowardTarget(unit, context);
        if (heading === null) return;
        const destination = this.dashDestination(unit, heading,
            Math.max(0, params?.chargeCells ?? 1), Number.POSITIVE_INFINITY, context);
        if (!destination) return;
        const origin = this.dashOrigin(unit, context);
        //  位移本身「不可被打断」（设计案 N 列 102303 原话），所以先推表现再挪人：
        //  表现事件的 from 必须是**起冲点**，挪完再取就成了落点。
        this.pushDashCastEvent(state, unit, origin, destination, now, 'charge_shield');
        context.blinkTo(unit, destination.x, destination.y);
        this.markCastAction(unit, now, false);

        const shieldRatio = Math.max(0, params?.chargeShieldRatio ?? 0);
        const shieldSeconds = Math.max(0, params?.chargeShieldSeconds ?? 0);
        const hitRadius = Math.max(1, Math.max(0, params?.chargeHitRadius ?? 40)
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
     * 冲锋 / 尖刺冲锋：往「最近敌人」或「面朝方向」冲 N 格，路径上的敌人全吃伤害
     * （2026-11-17 第 15 批）。
     *
     * 两条技能共用本方法，靠 `dashTowardNearest` 区分选向：
     *  · `dashTowardNearest = 1`（102303 冲锋）—— 朝搜索半径内最近的敌人，冲到他身上为止；
     *  · `dashTowardNearest = 0`（102703 尖刺冲锋）—— 朝**面朝方向**定长冲（设计案 O 列
     *    「沿朝向平移」），不找目标。
     *
     * 参数（`skillParamJson`，`dash` 前缀）：`dashCooldown` / `dashDamageRate` / `dashCells` /
     * `dashHitRadius` / `dashTowardNearest` / `dashSearchRadius` / `dashStunSeconds` /
     * `dashVulnerablePct` / `dashVulnerableSeconds` / `dashGuardReducePct` / `dashGuardSeconds` /
     * `dashShieldRatio` / `dashShieldSeconds`。
     * 🔴 前缀不能省：`68027:30241` 的袋子里已经有 102701 的 `splashRadius` 与
     * 102702 的 `lancePierceCount` —— 裸 `radius` / `damageRate` 会一起改掉普攻溅射与投枪。
     *
     * 朝最近敌人的那一档：搜索半径内没人 ⇒ **不消费 CD**（与突刺同口径：
     * 空冲只会浪费 12 秒，还把自己送到一个没有目标的空地）。
     * 朝面朝方向那一档没有「没人」这个概念 —— 前面是空的也照冲（它就是一段位移）。
     */
    private static applyLegacyDash(
        state: ZCSnapshot,
        unit: ZCUnitState,
        params: Readonly<Record<string, number>> | undefined,
        now: number,
        context: IZCSkillTriggerContext,
    ): void {
        if (!context.castChargeDash || !context.blinkTo) return;
        const cooldown = Math.max(0, params?.dashCooldown ?? 0);
        if (!(cooldown > 0)) return;
        const readyAt = unit.dashReadyAt;
        if (readyAt === undefined) { unit.dashReadyAt = now + cooldown; return; }
        if (now < readyAt) return;
        const damageRate = Math.max(0, params?.dashDamageRate ?? 0);
        if (!(damageRate > 0)) return;
        const cells = Math.max(0, params?.dashCells ?? 0);
        if (!(cells > 0)) return;
        const scale = Math.max(1e-6, context.distanceScale ?? 1);
        const towardNearest = (params?.dashTowardNearest ?? 0) > 0;
        //  朝最近敌人那档要一个最大冲程上限：人就在 20px 外时不该「冲过头」穿到背后去。
        let limit = Number.POSITIVE_INFINITY;
        let heading: number | null;
        if (towardNearest) {
            const searchRadius = Math.max(0, params?.dashSearchRadius ?? 0) * scale;
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

        //  三个命中状态各自按参数生成签名（不是三条固定档）：
        //  · 眩晕（102303）：`__stunstrike:<秒>__`，`control: 'stun'`，与突刺共用同一签名；
        //  · 易伤 / 破甲（102703 L2/L3）：`__dashvuln:<百分点>:<秒>__`，`damageTakenPct` 为正；
        //  · 自减伤（102303 L3）：`__dashguard:<百分点>:<秒>__`，`damageTakenPct` 为负。
        //  易伤给**被打的人**、减伤给**自己** —— 两条都叫 `damageTakenPct`，方向正好相反，
        //  写错一处就是「自保变成自残」，而且不报错。
        let statusId: string | undefined;
        const stunSeconds = Math.max(0, params?.dashStunSeconds ?? 0);
        if (stunSeconds > 0) {
            statusId = singleStrikeStunStatusId(stunSeconds);
            this.ensureControlStatus(context, statusId, stunSeconds);
        }
        const vulnPct = Math.max(0, params?.dashVulnerablePct ?? 0);
        const vulnSeconds = Math.max(0, params?.dashVulnerableSeconds ?? 0);
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
        const guardPct = Math.max(0, params?.dashGuardReducePct ?? 0);
        const guardSeconds = Math.max(0, params?.dashGuardSeconds ?? 0);
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
            hitRadius: Math.max(1, Math.max(0, params?.dashHitRadius ?? 40) * scale),
            damageRate,
            statusId,
            shieldRatio: Math.max(0, params?.dashShieldRatio ?? 0),
            shieldSeconds: Math.max(0, params?.dashShieldSeconds ?? 0),
            guardStatusId,
            guardSeconds,
        });
        unit.dashReadyAt = now + cooldown;
    }

    /** 取单位的世界坐标；缺省退回 `freeX/freeY`（与 `applySingleStrike` 同一口径）。*/
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
