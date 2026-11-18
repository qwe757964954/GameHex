import { HEX_GRID_LOGICAL_ROW_STEP } from '../../../../core/hex/HexGridLayout';
import { cardCounterMultiplier, ZC_ATTACK_TRAITS, ZC_CAMP_TRAITS, ZCCombatEventType, type ZCAttackProfile, type ZCCardTraits, type ZCCounterRule, type ZCDeckBonuses, type ZCDeckCard } from '../ZCCombatCatalog';
import { zcCombatEffectTravelSeconds } from '../ZCCombatEffectFlight';
import { ZC_SELF_AURA_EFFECT_PREFAB_PATH, ZC_SELF_AURA_BEHAVIOR_KEY, zcSelfAuraEffectPath } from '../ZCSelfAuraFx';
import { ZC_BOLT_EFFECT_PREFAB_PATH, ZC_BOLT_EFFECT_SECONDS, ZC_BOLT_NUMB_STATUS_ID } from '../ZCBoltStrikeFx';
import {
    ZC_SPLASH_SHOT_IMPACT_PREFAB_PATH, ZC_SPLASH_SHOT_MISSILE_PREFAB_PATH,
} from '../ZCSplashShotFx';
import { ZC_BURST_IMPACT_PREFAB_PATH, zcBurstEffectScale } from '../ZCBurstFx';
import {
    ZC_FAN_SWEEP_BURSTS, ZC_FAN_SWEEP_BURST_DISTANCE_RATIO, ZC_FAN_SWEEP_BURST_RADIUS_RATIO,
    ZC_FAN_SWEEP_BURST_SPREAD,
} from '../ZCFanSweepFx';
import { ZC_DASH_GUARD_PREFAB_PATH, ZC_DASH_GUARD_SECONDS } from '../ZCDashFx';
import {
    ZC_BARRAGE_IMPACT_PREFAB_PATH, ZC_BARRAGE_MISSILE_PREFAB_PATH,
    ZC_BARRAGE_SCATTER_RADIUS, ZC_BARRAGE_FLIGHT_SPEED,
    ZC_WIND_BOLT_PREFAB_PATH, ZC_WIND_HURRICANE_PREFAB_PATH, ZC_WIND_HURRICANE_TOUCH_SECONDS,
    zcBarrageFlightSeconds, zcBarrageImpactScale,
} from '../ZCWindBarrageFx';
import {
    ZC_TRAP_EXPIRE_PREFAB_PATH, ZC_TRAP_EXPIRE_SECONDS,
    ZC_TRAP_IDLE_PREFAB_PATH, ZC_TRAP_SPAWN_PREFAB_PATH, ZC_TRAP_SPAWN_SECONDS,
} from '../ZCTrapFx';
import { missileLog } from '../../ZCMissileSkillDiagnostics';
import { skillCastLog, skillCastLogChanging, zcSkillCastWatched } from '../../ZCSkillCastDiagnostics';
import type {
    ZCCombatEvent, ZCCombatFloatTextKind, ZCCombatTarget, ZCFloatText,
    ZCHexState, ZCProjectileState, ZCSnapshot, ZCUnitState
} from '../ZCGameTypes';
import type { ZCLegacyBuffApplication, ZCLegacySkillEvaluation } from '../ZCLegacySkillEffect';
import { ZCOwner } from '../ZCMapConfig';
import type { ZCUnitStatPatch } from '../ZCModifierRuntime';
import type { ZCSkillRuntimeDefinition } from '../ZCSkillRuntime';
import { ZC_PROJECTILE_MISS_DISTANCE, ZCCombatSystem } from './ZCCombatSystem';
import type { IZCModelServices } from './ZCModelServices';
import { ZCTargetingSystem } from './ZCTargetingSystem';

/**
 * 投枪（`破阵投枪`，2026-11-17）的缺省参数。
 *
 * 设计口径「穿透 3 个目标，依次承受 70% / 45% / 30%」= 首目标 `0.7 × 面板`，
 * 之后每穿一人 ×(1 − 0.35)：0.7 → 0.455 → 0.296（四舍五入正是 70% / 45% / 30%）。
 * 这几个缺省值只在表里没写时兜底，`lanceEvery` 缺省 0 ⇒ 整条车道不触发，存量单位不受影响。
 */
const ZC_LANCE_DEFAULT_DAMAGE_RATE = 0.7;
const ZC_LANCE_DEFAULT_PIERCE_FALLOFF = 0.35;
/**
 * 缺省穿透**目标总数（含首目标）**。
 *
 * 注意语义：`lancePierceCount` 是「这一枪总共能打到几个人」，剩余穿透 = N − 1；
 * 与 `pierceCount`（额外穿透次数）不是同一个东西，别拿 2 当「穿 2 个」写进表里 —— 那只会打 2 人。
*/
const ZC_LANCE_DEFAULT_PIERCE_COUNT = 3;
/** 投枪是「掷出去的枪」，比普攻弹速快一档（逻辑 px/秒）。 */
const ZC_LANCE_DEFAULT_SPEED = 700;
/** 没有专属投枪美术时的占位弹体（可在行参数里用 `lanceEffectPrefabPath` 覆盖）。 */
export const ZC_LANCE_DEFAULT_EFFECT_PREFAB_PATH = 'units/projectiles/子弹_新怪物/通用箭矢';

/**
 * 打城墙/打建筑的出手方。用坐标壳而非整只 `ZCUnitState`：投射物离手后施法者可能已被移除。
 * `id` 是单位实例 id（不是卡牌 unitId），用于反查攻击方职业播闪白；缺省时只跳过闪白。
*/
export interface IZCStructureDamageSource {
    readonly owner: ZCOwner;
    readonly freeX: number;
    readonly freeY: number;
    readonly id?: number;
}

export interface IZCAttackResolutionContext extends Pick<IZCModelServices, 'rules' | 'statusSystem' | 'geometry' | 'random' | 'effectiveDefinition' | 'unitPosition' | 'damageUnit'> {
    readonly counters: readonly ZCCounterRule[];
    readonly cards: Readonly<Record<ZCOwner, ReadonlyMap<string, ZCDeckCard>>>;
    readonly skillRuntime: Readonly<Record<ZCOwner, ReadonlyMap<string, ZCSkillRuntimeDefinition>>>;
    readonly neutralSkillRuntime?: ReadonlyMap<string, ZCSkillRuntimeDefinition>;
    readonly statPatches: Readonly<Partial<Record<ZCOwner, ReadonlyMap<string, ZCUnitStatPatch>>>>;
    readonly deckBonuses: Readonly<Record<ZCOwner, ZCDeckBonuses>>;
    readonly unitById: ReadonlyMap<number, ZCUnitState>;
    currentTarget(unit: ZCUnitState, out?: ZCCombatTarget): ZCCombatTarget | null;
    evaluateLegacySkill(source: ZCUnitState, keys: readonly string[], target: ZCCombatTarget, critical: boolean): ZCLegacySkillEvaluation;
    applyLegacySelfBuffs(source: ZCUnitState, buffs: readonly ZCLegacyBuffApplication[]): readonly ZCLegacyBuffApplication[];
    tryExecuteUnit(target: ZCUnitState, chance: number | undefined, owner: ZCOwner, sourceId: number, precedingText?: ZCFloatText | null): void;
    applyHitStatus(target: ZCUnitState, statusId: string | undefined, sourceId?: number): void;
    applyLegacyBuffs(target: ZCUnitState, buffs: readonly ZCLegacyBuffApplication[], sourceId?: number): void;
    damageWall(source: IZCStructureDamageSource, wall: ZCHexState, damage: number): void;
    damageBuilding(source: IZCStructureDamageSource, building: ZCHexState, damage: number): void;
    unitsInRadius(hexId: number, radiusHex: number): ZCUnitState[];
    /**
     * 给单位回血（2026-11-04 吸血用）。
     *
     * 走 `ZCStatusResolutionSystem.healUnit` 同一条实现：封顶 `maxHp`、死亡不生效、
     * 真回了才推一条 `heal` 飘字。不要在这里直接 `unit.hp += x`，
     * 否则同一件事会有两套上限/飘字口径。
    */
    healUnit(unit: ZCUnitState, amount: number): void;
    /**
     * 旧表口径的击退（`rawDistance` 单位是格，实现里乘 `combatDistanceScale`）。
     *
     * 与状态表里的 `legacy_knockback` handler 共用 `ZCGameModel.applyLegacyKnockback`，
     * 所以「技能表直接推一次击退」和「挂个击退 buff」落点完全一致（撞墙/不可走格子会被吞）。
    */
    applyKnockback(target: ZCUnitState, source: ZCUnitState, rawDistance: number): void;
    /**
     * 往 `state.projectiles` 写一颗弹道（追踪导弹走这条：不立即结算，飞过去撞到才停）。
     * 由宿主回调写入，复用 `sendAttack` 的构造口径，避免两套 push 代码漂移。
    */
    pushProjectile(projectile: ZCProjectileState): void;
}

/**
 * `ZCAttackResolutionSystem.strikeTargets` 的入参（全部世界坐标口径，由调用方换算）。
 *
 * 单独抽成接口而不是一长串位置参数：这里有 6 个数值 + 1 个枚举倾向，
 * 位置参数在调用点读不出哪一个是半径、哪一个是倍率。
*/
export interface IZCStrikeOptions {
    /** 这一次最多打几个目标。*/
    readonly count: number;
    /** 挑选半径（世界坐标）。*/
    readonly radius: number;
    /** 每发相对面板的伤害倍率。*/
    readonly damageRate: number;
    /** `true` = 就近优先；`false` = 随机（消耗 `context.random`，回放可重演）。*/
    readonly nearest: boolean;
    /** 落点溅射半径（世界坐标）；0 / 缺省 = 不溅射。*/
    readonly splashRadius?: number;
    /** 溅射伤害 = 直击伤害 × 本系数；0 / 缺省 = 不溅射。*/
    readonly splashDamageRate?: number;
    /**
     * 溅射的多目标递减：旁溅目标按距离由近到远，第 n 个（n 从 0 计）再乘 `(1 - splashFalloff)^n`。
     * 缺省 0 ⇒ 同额溅射（存量行为）。
    */
    readonly splashFalloff?: number;
    /**
     * 挑人的原点，缺省为施法者当前位置。
     * 移形换影的分身要在施法原位爆炸，避免用本体跑位后的坐标。
    */
    readonly origin?: { readonly x: number; readonly y: number };
    /** 命中挂的状态 id；缺省不挂。*/
    readonly statusId?: string;
    /**
     * 追踪导弹模式：每挑一个目标发一颗弧线导弹，而不是立即结算。
     * `missilePrefabPath` 飞行特效，`impactPrefabPath` 命中爆炸，`arcOffset` 中段横向偏移。
     * 命中/伤害/溅射仍走 `resolveProjectileHit` + `splashRadius`。
    */
    readonly missilePrefabPath?: string;
    readonly impactPrefabPath?: string;
    readonly arcOffset?: number;
    /**
     * 导弹自己的飞行速度（逻辑 px/秒）；缺省 = 复用 `profile.projectileSpeed`。
     *
     * 为什么单独给：镭射飞龙的普攻是一道光束，`projectileSpeed` 500 是光束的速度；
     * 导弹要的是「慢速滑翔、看得清弧线」，两者共用一个值就必然二选一。
     * 2026-11-05 需求：「慢速滑翔、强调弧线」⇒ 200（最远一发约 1.65s）。
    */
    readonly missileSpeed?: number;
    /**
     * 导弹一次施法的恒定发数（覆盖 `count`）；缺省听 `count`。
     * 只对导弹分支生效，戈壁狂箭那种立即结算的多点打击不受影响。
    */
    readonly missileCount?: number;
}

/**
 * 冲锋的一次出手（2026-11-17 第 15 批，「线段命中」）。
 *
 * 几何由触发系统算好（它知道冲刺格数、选向、落点钳制），本结构只描述
 * 「从哪冲到哪、多粗的一条线、撞到的人吃什么」。
 *
 * 与 `IZCStrikeOptions` 分开而不是给它加几个可选字段：那个是「圆形内挑 N 个」，
 * 这个是「一条线上全撞」，两套挑人逻辑混在一个结构里，读代码的人迟早会以为
 * `radius` 也能当冲锋的判定宽度用。
*/
export interface IZCChargeDashOptions {
    /** 起冲点（位移前的世界坐标）—— 线段起点，不是施法者当前位置。*/
    readonly origin: { readonly x: number; readonly y: number };
    /** 落点（位移后的世界坐标）—— 线段终点。*/
    readonly destination: { readonly x: number; readonly y: number };
    /** 路径宽度（世界 px）：敌人到线段的距离 ≤ 它就算撞到。*/
    readonly hitRadius: number;
    /** 本次冲锋的伤害倍率（相对面板攻击）。*/
    readonly damageRate: number;
    /** 命中状态（眩晕 `__stunstrike:` / 易伤 `__dashvuln:`），由触发系统注册好后传进来。*/
    readonly statusId?: string;
    /** 落地自护盾：占最大生命的比例（0.12 = 12%）。*/
    readonly shieldRatio?: number;
    /** 护盾持续秒数。*/
    readonly shieldSeconds?: number;
    /** 落地自减伤状态（`__dashguard:`），同上由触发系统注册。*/
    readonly guardStatusId?: string;
    /** 减伤持续秒数。*/
    readonly guardSeconds?: number;
}

interface IZCPreparedAttack {
    readonly target: ZCCombatTarget;
    readonly definition: ReturnType<IZCAttackResolutionContext['effectiveDefinition']>;
    readonly patch: ZCUnitStatPatch;
    readonly activeProfile: ZCAttackProfile;
    readonly empowered: boolean;
    /** 这一击是不是「投枪」（每 N 次普攻把本次攻击替换成一枚远程穿透弹，2026-11-17）。 */
    readonly lance: boolean;
    readonly skillRuntime: ZCSkillRuntimeDefinition | undefined;
    projectileCount: number;
    /** 普攻「多打 N 发」的额外弹体数（`bulletNum` 增量，不含本体那一颗）。 */
    readonly bulletNumExtra: number;
    /** 多弹递减系数（`skillParamJson.bulletFalloff`，缺省 0 = 每颗同额）。 */
    readonly bulletFalloff: number;
    /** 「本体」弹体数 = `projectileCount - bulletNumExtra`，之后的下标才是额外弹。 */
    readonly baseProjectileCount: number;
    readonly criticalMultiplier: number;
    readonly damageRateMultiplier: number;
    readonly skillDamageRate: number;
    /**
     * 投枪的「首目标折算」（`skillParamJson.lanceDamageRate`，缺省 0.7）；非投枪那一拍恒为 1。
     *
     * 🔴 必须单独带出来：近战/区域走本类的 `unitDamage`（把系数直接乘进去），
     * 而弹道走 `createAttackProjectiles` 里的 `unitDamageBase` —— 那是**另一条**乘法链，
     * 不显式乘进去就会「事件上写着 70%、真打出去还是 100%」（第 7 批踩过）。
    */
    readonly lanceDamageRate: number;
    readonly legacy: ZCLegacySkillEvaluation;
    readonly legacyTargetBuffs: readonly ZCLegacyBuffApplication[];
    readonly criticalHit: boolean;
    readonly floatTextKind: ZCCombatFloatTextKind;
    readonly onHitStatusId: string | undefined;
    readonly damage: number;
    readonly legacyAreaRadius: number;
    readonly effectiveAreaRadius: number;
    readonly from: { readonly x: number; readonly y: number };
    readonly event: ZCCombatEvent;
}

function damageFloatTextKind(critical: boolean, counterMultiplier = 1): ZCCombatFloatTextKind {
    if (critical) return 'critical';
    if (counterMultiplier > 1) return 'restraint';
    if (counterMultiplier < 1) return 'resisted';
    return 'damage';
}

/** 读一个 `counter*Pct` / `countered*Pct` 字段；负值按 0（减伤写成负数没有语义）。 */
function counterPctOf(patch: ZCUnitStatPatch, key: string): number {
    //  16 个字段都是 `number | undefined`，字段名由 `ZC_COUNTER_STAT_IDS` 生成 ——
    //  这里只做一次受控窄化，避免为每个判据写一条分支。
    const table = patch as unknown as Readonly<Record<string, number | undefined>>;
    return Math.max(0, Number(table[key] ?? 0));
}

/**
 * 技能级「克制条」乘数（2026-11-17 克制 / 抗性协议 20 条）。
 *
 * 与 `cardCounterMultiplier` 的分工：
 *   · 那个是**全局**克制关系（`pvpCounter` 的 8 条规则，×1.3 / ×0.7）；
 *   · 这个是**单卡被动**给的条件加成 —— 攻方 `counter*` 增伤、守方 `countered*` 减伤。
 *
 * 🔴 判据方向别搞反：`counter*X` 看的是**被打的人**是不是 X（我打 X 更疼）；
 * `countered*X` 看的是**打我的人**是不是 X（X 打我我少受伤）。两边各取各自的特征，
 * 所以这个函数必须**同时**拿到攻守两侧的 `traits` —— 只给守方的写法会把「受到法师减伤」
 * 判成「守方自己是法师」，等于整条抗性协议永远不生效。
 *
 * 判据按设计案文案字面取目标（对某阵营 / 某职业），因此**不读** `pvpCounter`：
 * 设计案的职业克制是「射手→战士、法师→坦克、战士→法师」，与表里的
 * 「射手→法师、战士→射手」并不一致，混用会让文案与实际生效对象不符。
 *
 * 两层相乘：`base(全局克制) × (1 + 增伤) × max(0, 1 - 减伤)`。缺省全 0 ⇒ 恒等，存量逐字不变。
 */
export function zcSkillCounterMultiplier(
    attackerPatch: ZCUnitStatPatch,
    defenderPatch: ZCUnitStatPatch,
    attackerTraits: ZCCardTraits | undefined,
    defenderTraits: ZCCardTraits | undefined,
): number {
    let multiplier = 1;
    //  增伤：看我打的是谁。
    const targetCamp = defenderTraits ? ZC_CAMP_TRAITS.indexOf(defenderTraits.camp) + 1 : 0;
    if (targetCamp > 0) {
        multiplier *= 1 + counterPctOf(attackerPatch, `counterCamp${targetCamp}Pct`) / 100;
    }
    const targetRole = defenderTraits ? ZC_ATTACK_TRAITS.indexOf(defenderTraits.attack) + 1 : 0;
    if (targetRole > 0) {
        multiplier *= 1 + counterPctOf(attackerPatch, `counterRole${targetRole}Pct`) / 100;
    }
    //  减伤：看是谁在打我。
    const sourceCamp = attackerTraits ? ZC_CAMP_TRAITS.indexOf(attackerTraits.camp) + 1 : 0;
    if (sourceCamp > 0) {
        multiplier *= Math.max(0, 1 - counterPctOf(defenderPatch, `counteredCamp${sourceCamp}Pct`) / 100);
    }
    const sourceRole = attackerTraits ? ZC_ATTACK_TRAITS.indexOf(attackerTraits.attack) + 1 : 0;
    if (sourceRole > 0) {
        multiplier *= Math.max(0, 1 - counterPctOf(defenderPatch, `counteredRole${sourceRole}Pct`) / 100);
    }
    return multiplier;
}

/**
 * 普攻「多打 N 发」（`pvpAttrMap.bulletNum`）的**多目标递减**：返回第 `index` 颗弹的伤害系数。
 *
 * 2026-11-14 用户口径：普通攻击带来的穿透类 / 分裂子弹 / 溅射 都要多目标递减、初值低于普攻，
 * 目的是「大面积但数值不大」。多弹的落地口径是：
 *   · 第 1 颗是普攻本体 ⇒ 恒为 100%（它就是普攻，不可能低于自己）；
 *   · 第 2 颗起每颗 ×(1 - bulletFalloff)，`0.4` ⇒ 100% / 60% / 36% / 21.6%；
 *   · 满档 `bulletNum +2` 的额外部分总额 96%（原 200%），整轮 196%（原 300%）。
 *
 * `baseProjectileCount` 是「本体」颗数（= `projectileCount - bulletNumExtra`）：
 * 多弹之外的固定颗数（例如凤凰降临固定 4 颗）不算额外弹，不吃递减。
 * `bulletFalloff` 缺省 0 ⇒ 恒为 1，存量单位行为逐字不变。
 */
export function zcBulletDamageScale(index: number, baseProjectileCount: number, bulletFalloff: number): number {
    if (!(bulletFalloff > 0)) return 1;
    const extra = index - (Math.max(1, baseProjectileCount) - 1);
    if (extra <= 0) return 1;
    return Math.pow(1 - Math.min(1, bulletFalloff), extra);
}

/**
 * 普攻弹体的体积倍率（`pvpAttrMap.bulletSizeScale`，2026-11-17 磁电菇「巨囊弹体」101602）。
 *
 * 设计口径「弹体体积 ×1.6，命中判定半径同比放大」—— 所以同一个倍率必须同时喂两处：
 * 弹道自己的 `collisionRadius`（逻辑判定）与 `sizeScale`（视图缩放）。
 *
 * 语义是**绝对倍率**而不是增量：`1.6` 就是 ×1.6。缺省、非法（≤0、NaN）一律按 1 处理
 * ⇒ 没配这个键的弹道逐字不变。
 */
export function zcBulletSizeScale(value: number | undefined): number {
    if (value === undefined || !Number.isFinite(value) || value <= 0) return 1;
    return value;
}

function distance(fromX: number, fromY: number, toX: number, toY: number): number {
    return Math.hypot(fromX - toX, fromY - toY);
}

/** Resolves attack launch and projectile impact against the same snapshot and per-match dependencies.*/
export class ZCAttackResolutionSystem {
    private static readonly emptySkillRuntime = new Map<string, ZCSkillRuntimeDefinition>();
    private static skillRuntimeFor(unit: ZCUnitState, context: IZCAttackResolutionContext): ReadonlyMap<string, ZCSkillRuntimeDefinition> {
        return unit.neutralReinforcement ? context.neutralSkillRuntime ?? this.emptySkillRuntime : context.skillRuntime[unit.owner];
    }

    private static cardById(context: IZCAttackResolutionContext, owner: ZCOwner, id: string): ZCDeckCard | undefined {
        return context.cards[owner].get(id);
    }

    private static unitStatPatchOf(unit: ZCUnitState, context: IZCAttackResolutionContext): ZCUnitStatPatch {
        return unit.neutralReinforcement ? {} : context.statPatches[unit.owner]?.get(unit.unitId) ?? {};
    }

    /**
     * 克制乘数 = 全局克制（`pvpCounter`）× 技能级克制条（攻方增伤 / 守方减伤）。
     *
     * 守方 patch 优先按**单位实例**的 `unitId` 取（`statPatches` 的键是 unitId），
     * 取不到再退回 cardId（卡与兵种一一对应，多数情况下两者同串；建筑 / 格子没有卡技能）。
     */
    private static counterMultiplierFor(
        unit: ZCUnitState,
        targetOwner: ZCOwner,
        targetCardId: string | null,
        context: IZCAttackResolutionContext,
        targetUnitId?: number,
    ): number {
        const attackerCard = this.cardById(context, unit.owner, unit.cardId);
        const defenderCard = targetCardId ? this.cardById(context, targetOwner, targetCardId) : undefined;
        const base = cardCounterMultiplier(attackerCard, defenderCard, context.counters);
        const targetUnit = targetUnitId != null ? context.unitById.get(targetUnitId) : undefined;
        const defenderPatch = (targetUnit
            ? context.statPatches[targetUnit.owner]?.get(targetUnit.unitId)
            : undefined)
            ?? (targetCardId ? context.statPatches[targetOwner]?.get(targetCardId) : undefined)
            ?? {};
        return base * zcSkillCounterMultiplier(
            this.unitStatPatchOf(unit, context), defenderPatch,
            attackerCard?.traits, defenderCard?.traits);
    }

    /**
     * 弹道命中点的克制乘数（`resolveProjectileHit` 是 static 结算，手上只有弹体）。
     *
     * 攻方实例靠 `projectile.sourceUnitId` 反查 —— 弹体离手后射手可能已经阵亡
     * （`unitById` 查不到），那种情况只剩全局克制：技能级克制条按单位实例的
     * `statPatch` 取，人没了加成也就没了，与「光环随施法者消失」同一口径。
     */
    private static projectileCounterMultiplier(
        projectile: ZCProjectileState,
        targetOwner: ZCOwner,
        targetCardId: string | null,
        context: IZCAttackResolutionContext,
        targetUnitId?: number,
    ): number {
        const shooter = context.unitById.get(projectile.sourceUnitId);
        if (shooter) {
            return this.counterMultiplierFor(shooter, targetOwner, targetCardId, context, targetUnitId);
        }
        return cardCounterMultiplier(
            this.cardById(context, projectile.owner, projectile.sourceCardId),
            targetCardId ? this.cardById(context, targetOwner, targetCardId) : undefined,
            context.counters);
    }

    static criticalMultiplier(unit: ZCUnitState, context: IZCAttackResolutionContext): number {
        const mods = context.statusSystem.statModsOf(String(unit.id));
        const patch = this.unitStatPatchOf(unit, context);
        const chance = Math.max(0, Math.min(1, ((mods.critPct ?? 0) + (patch.critRatePct ?? 0)) / 100));
        if (chance <= 0 || context.random() >= chance) return 1;
        return 1 + Math.max(0, ((mods.critDamagePct ?? 0) + (patch.critDamagePct ?? 0)) / 100);
    }

    private static targetOwner(state: ZCSnapshot, target: ZCCombatTarget, context: IZCAttackResolutionContext): ZCOwner {
        if (target.kind === 'unit') return context.unitById.get(target.id)?.owner ?? ZCOwner.Enemy;
        const owner = this.hex(state, target.id)?.owner;
        return owner && owner !== 'neutral' ? owner : ZCOwner.Enemy;
    }

    private static hex(state: ZCSnapshot, id: number): ZCHexState | null {
        return state.hexes[id] || null;
    }

    /**
     * 一次结算的面板伤害（含克制）。
     *
     * `targetUnitId` 是**目标单位实例**：技能级克制条要读守方的 `statPatches`，
     * 而那份补丁按 `unitId` 建键，只有拿到实例才查得准（建筑 / 格子传 `undefined`，
     * 那时只剩全局克制 —— 它们本来也没有卡技能）。缺省 `undefined` ⇒ 与改前逐字一致。
     */
    private static unitDamage(context: IZCAttackResolutionContext, unit: ZCUnitState,
        targetOwner: ZCOwner, targetCardId: string | null, skillDamageRate = 1,
        targetUnitId?: number): number {
        const definition = context.effectiveDefinition(unit);
        const bonuses = context.deckBonuses[unit.owner];
        //  unit 域「伤害倍率」（`pvpSkillPlan.statId = damageRate`，2026-10-30 玉林好汉「铁质飞镖」）：
        //  与攻击力加成不同，它只在最终结算处相乘一次、不抬高面板。缺省 0 ⇒ 乘 1。
        const rawMultiplier = 1 + (this.unitStatPatchOf(unit, context).damageRatePct ?? 0) / 100;
        //  status 域的同一层（2026-10-30 僵尸「嗜血」100703）：限时增益只能落在状态上，
        //  而 unit 域补丁是常驻的 —— 两者口径相同、各自缺省 0 ⇒ 存量伤害逐字不变。
        const statusMultiplier = 1 + (context.statusSystem.statModsOf(String(unit.id)).damageRatePct ?? 0) / 100;
        const damage = ZCCombatSystem.unitDamage(unit, definition, bonuses,
            //  克制只在这里乘一次：全局克制 × 技能级克制条（见 `counterMultiplierFor`）
            this.counterMultiplierFor(unit, targetOwner, targetCardId, context, targetUnitId),
            context.rules,
            skillDamageRate * Math.max(0, rawMultiplier) * Math.max(0, statusMultiplier));
        return Math.max(1, Math.round(damage * (unit.attackMultiplier ?? 1)));
    }

    /**
     * 吸血：只在真正扣到血时回，比例取飘字 `value`（= `result.applied`），不用面板伤害反算。
     * 缺省 0 时整段不执行。派发点：近战直击/溅射、弹道命中/溅射、地面区域每波。
     * 区域通过 `lifestealFromHit` 回调进来，一次打中 N 人就是 N 次独立回血。
     *
     * `spreadRate` = 这一跳属于「扩散段」时的折算（`skillParamJson.lifestealSpreadRate`）。
     * 直击传缺省 1；溅射 / 命中爆炸这类旁及伤害传表值，缺省仍是 1 ⇒ 存量逐字不变。
    */
    static applyLifesteal(source: ZCUnitState, hitText: ZCFloatText | null,
        context: IZCAttackResolutionContext, spreadRate = 1): void {
        const ratio = this.lifestealRatioOf(source, context) * Math.max(0, Math.min(1, spreadRate));
        if (!(ratio > 0)) return;
        const dealt = hitText?.value ?? 0;
        if (!(dealt > 0)) return;
        context.healUnit(source, dealt * ratio);
    }

    /**
     * 扩散段的吸血折算（`skillParamJson.lifestealSpreadRate`，2026-11-17 噬血蔓延 101702）。
     *
     * 设计口径：「普攻造成伤害的 30% 转化为生命；**扩散段按 50% 折算**」——
     * 主目标全额，溅射出来的那些旁及目标只按一半回血。缺省 1 ⇒ 全额，存量吸血逐字不变
     * （100703 嗜血 / 100302 生命汲取都没写这个键）。
    */
    private static lifestealSpreadRateOf(unit: ZCUnitState, context: IZCAttackResolutionContext): number {
        const skillId = context.effectiveDefinition(unit).attackProfile.skillId;
        const params = context.skillRuntime[unit.owner].get(`${unit.unitId}:${skillId}`)?.parameters;
        const value = params?.lifestealSpreadRate;
        if (value === undefined || !Number.isFinite(value)) return 1;
        return Math.max(0, Math.min(1, value));
    }

    /**
     * 吸血比例：技能参数 `skillParamJson.lifestealRate` 优先，unit 域 `lifestealRate` 兜底。
     * 表里走参数是因为同一行只能有一个 statId，攻击范围已占用；unit 域留给整卡常驻吸血。
    */
    private static lifestealRatioOf(unit: ZCUnitState, context: IZCAttackResolutionContext): number {
        const skillId = context.effectiveDefinition(unit).attackProfile.skillId;
        const params = this.skillRuntimeFor(unit, context).get(`${unit.unitId}:${skillId}`)?.parameters;
        const fromParams = params?.lifestealRate ?? this.unitStatPatchOf(unit, context).lifestealRate ?? 0;
        //  状态域的同名比例（2026-10-30 僵尸「嗜血」100703）：吸血是限时的，只能挂在状态上。
        //  与上面那层相加而不是择一 —— 常驻吸血 + 开嗜血时临时加吸血，两个来源都该吃。
        //  缺省 0 ⇒ 存量单位比例不变。
        const fromStatus = context.statusSystem.statModsOf(String(unit.id)).lifestealRate ?? 0;
        return Math.max(0, Math.min(1, fromParams + fromStatus));
    }

    private static extraHitCountOf(projectile: ZCProjectileState, context: IZCAttackResolutionContext): number {
        const source = context.unitById.get(projectile.sourceUnitId);
        if (!source) return 0;
        return this.extraHitCountForUnit(source, context);
    }

    /** 连击的**额外段数**（不含首段）：`multiHitFlat` 缺省 0 ⇒ 0 段，存量单位不受影响。 */
    private static extraHitCountForUnit(unit: ZCUnitState, context: IZCAttackResolutionContext): number {
        const extra = this.unitStatPatchOf(unit, context).multiHitFlat ?? 0;
        return extra > 0 ? Math.min(20, Math.round(extra)) : 0;
    }

    /**
     * 连击额外段的**总伤害倍率**（2026-11-17 连击批次）。
     *
     * `multiHitFlat` 只说「多打几段」，段间递减靠技能参数，两条分开是因为前者是
     * 整卡常驻补丁（unit 域 statPatch）、后者是单条技能的参数袋：
     *   - `comboDamage`：第 2 段占首段的百分比（60 ⇒ 60%），缺省 100（满伤害）；
     *   - `comboFalloff`：再往后每段乘 `(1 - comboFalloff)`，缺省 0（不递减）。
     * 设计口径「第 2 段 60% / 第 3 段 36%」= `comboDamage = 60` + `comboFalloff = 0.4`
     * （第 3 段 = 60% × 0.6 = 36%）。
     *
     * 🔴 缺省刻意取「满伤害 + 不递减」：存量行（`attackCount add N` 但没写参数）此前按
     * `damage × extraHits` 结算，引入本条后必须逐字不变。
     */
    private static comboDamageMultiplierOf(unit: ZCUnitState | undefined, skillId: number,
        extraHits: number, context: IZCAttackResolutionContext): number {
        if (extraHits <= 0) return 0;
        //  🔴 参数袋的键是 `${卡牌 id}:${技能 id}`（`unit.unitId`），不是场上实例的 `unit.id` ——
        //  传错的话查不到 `comboDamage`，会静默退回「满伤害不递减」，看起来像「配了没生效」。
        const params = unit
            ? context.skillRuntime[unit.owner].get(`${unit.unitId}:${skillId}`)?.parameters
            : undefined;
        const first = Math.max(0, Math.min(100, params?.comboDamage ?? 100)) / 100;
        const falloff = Math.max(0, Math.min(1, params?.comboFalloff ?? 0));
        let total = 0;
        for (let index = 0; index < extraHits; index += 1) total += first * Math.pow(1 - falloff, index);
        return total;
    }

    /**
     * 这一拍是不是「投枪」（`破阵投枪`，2026-11-17 第 7 批）。
     *
     * 节拍读 `skillParamJson.lanceEvery`（4 / 3 / 2，按档位缩短），按**累计普攻次数**取模；
     * `completedAttackCount` 在 `consumeEmpoweredAttack` 里已经自增过，所以第 4 次出手时
     * 这里读到的是 4（不是 3）。
     *
     * 🔴 与「强化那一击」互斥：两者都是「替换本次普攻」，同一拍只会兑现一个。
     * 强化装配的是武将技行（`empoweredSkillId`）的表现与倍率，优先级更高 —— 撞拍时投枪让位，
     * 节拍按绝对次数继续走，不会因为让位而顺延（下一次仍然是 N 的整数倍）。
     */
    private static lanceBeatOf(unit: ZCUnitState, skillRuntime: ZCSkillRuntimeDefinition | undefined,
        empowered: boolean): boolean {
        if (empowered) return false;
        const every = Math.max(0, Math.round(skillRuntime?.parameters.lanceEvery ?? 0));
        if (every <= 0) return false;
        return (unit.completedAttackCount ?? 0) % every === 0;
    }

    /**
     * 投枪这一击的档案：把普攻档案整份换成「弹道」。
     *
     * 只换表现与弹道参数（`mode` / 弹速 / 弹体特效），**不改攻击距离** ——
     * 设计案 P 列「触发时只替换本次普攻的 projectileKey，不改 attackRange」，
     * 所以 `attackRange` / `canAttackAir` / 碰撞半径仍沿用卡牌本体。
     * 命中类状态与命中特效也不带过去：投枪是纯伤害弹，挂状态仍然是「一次出手」的事。
     *
     * ⚠️ 弹体特效只能是常量：`skillParamJson` 的参数袋按 statId/operation/value 解析，
     * 值域是 number（`Record<string, number>`），字符串路径进去会被丢掉。要按卡换皮，
     * 得新增表列或走 `pvpSkill.effectPrefabPath`，不能塞参数袋。
     */
    private static lanceProfileOf(base: ZCAttackProfile,
        skillRuntime: ZCSkillRuntimeDefinition | undefined): ZCAttackProfile {
        const params = skillRuntime?.parameters;
        return {
            ...base,
            mode: ZCCombatEventType.Projectile,
            projectileSpeed: Math.max(1, params?.lanceSpeed ?? ZC_LANCE_DEFAULT_SPEED),
            effectPrefabPath: ZC_LANCE_DEFAULT_EFFECT_PREFAB_PATH,
            onHitStatusId: undefined,
            impactEffectPrefabPath: undefined,
            areaRadius: 0,
            durationSeconds: 0,
            waves: 1,
            slowRatio: undefined,
            empoweredEvery: 0,
            empoweredSkillId: 0,
        };
    }

    /**
     * 命中附加表现（`impactEffectPrefabPath`）：补一条 `area` 事件落在受击点。
     * `area` 归地面层，冲击环压在角色脚下；`damage: 0` 只是画面，伤害已由主事件结算。
    */
    private static pushImpactEffect(state: ZCSnapshot, event: ZCCombatEvent, profile: ZCAttackProfile): void {
        const effectPrefabPath = profile.impactEffectPrefabPath;
        if (!effectPrefabPath) return;
        state.combatEvents.push({
            id: state.nextCombatEventId++,
            type: ZCCombatEventType.Area,
            owner: event.owner,
            sourceUnitId: event.sourceUnitId,
            targetUnitId: event.targetUnitId,
            skillId: event.skillId,
            skillName: event.skillName,
            effectKey: null,
            projectileKey: null,
            effectPrefabPath,
            fromX: event.toX,
            fromY: event.toY,
            toX: event.toX,
            toY: event.toY,
            radius: 1,
            damage: 0,
            empowered: false,
            startedAt: event.startedAt,
            // 与近战主特效的 0.3s 对齐：多出来的那一点是给冲击环留的余波，不要长到盖住下一次普攻。
            durationSeconds: 0.35,
        });
    }

    static resolveRadialSkill(state: ZCSnapshot, source: ZCUnitState, event: ZCCombatEvent,
        damage: number, rawDirectionCount: number, onHitStatusId: string | undefined,
        legacyBuffs: readonly ZCLegacyBuffApplication[], floatTextKind: ZCCombatFloatTextKind,
        context: IZCAttackResolutionContext): void {
        const directionCount = Math.max(1, Math.round(rawDirectionCount));
        const origin = context.unitPosition(source);
        const corridor = 6 * context.rules.combatDistanceScale;
        state.combatEvents.push(event);
        for (const target of state.units) {
            if (target.owner === source.owner || target.battleState === 'dead') continue;
            const pos = context.unitPosition(target);
            const dx = pos.x - origin.x, dy = pos.y - origin.y;
            let hit = false;
            for (let index = 0; index < directionCount && !hit; index += 1) {
                const angle = source.facingRadians + Math.PI * 2 * index / directionCount;
                const ux = Math.cos(angle), uy = Math.sin(angle);
                const along = dx * ux + dy * uy;
                const perpendicular = Math.abs(dx * uy - dy * ux);
                hit = along >= 0 && perpendicular <= corridor
                    + context.effectiveDefinition(target).bodyRadius * context.rules.combatDistanceScale;
            }
            if (!hit) continue;
            //  扇形方向技按「远程」结算（藤盾这类只减远程的护体要能吃到）。
            context.damageUnit(target, damage, {
                owner: source.owner, kind: 'unit', unitId: source.id, floatTextKind, ranged: true,
            });
            context.applyHitStatus(target, onHitStatusId, source.id);
            context.applyLegacyBuffs(target, legacyBuffs, source.id);
        }
    }

    /**
     * 副轨主动：朝当前目标清一次扇形，只做伤害 + 击退 + 表现事件，不推进普攻节拍。
     * 返回 false 表示这一帧没真的出手（没配副轨 / 没目标），调用方不要消费 CD。
     * 参数（skillParamJson）：secondaryCooldown / secondaryDamageRate / secondaryFanDeg(120) /
     * secondaryRadiusScale(1.4) / secondaryKnockback。
    */
    static castFanSkill(state: ZCSnapshot, unit: ZCUnitState,
        context: IZCAttackResolutionContext): boolean {
        const definition = context.effectiveDefinition(unit);
        const profile = definition.attackProfile;
        const parameters = this.skillRuntimeFor(unit, context)
            .get(`${unit.unitId}:${profile.skillId}`)?.parameters;
        if (!(Math.max(0, parameters?.secondaryCooldown ?? 0) > 0)) return false;
        //  上面这道守卫要求 `secondaryCooldown > 0`，而 runtime 缺失时读到的是 0 ⇒ 此处 `parameters` 必存在。
        const activeProfile = definition.secondaryProfile;
        if (!activeProfile) return false;
        const target = context.currentTarget(unit);
        if (!target) return false;
        const origin = context.unitPosition(unit);
        const heading = Math.abs(target.x - origin.x) + Math.abs(target.y - origin.y) > 1e-9
            ? Math.atan2(target.y - origin.y, target.x - origin.x)
            : unit.facingRadians;
        //  半径以当前攻击距离为基准：100503 的 attackRange +30% 会一起吃到，
        //  这样「升了生命汲取顺手把横扫范围拉大」是自然结果，不需要再配一遍。
        //   `attackReach` 内部自己乘 `combatDistanceScale`，三个入参都是表值口径
        //  （bodyRadius 也是），这里不要再预乘一次，否则身体半径会被缩两次。
        const reach = ZCTargetingSystem.attackReach(
            definition, definition.bodyRadius, context.rules.combatDistanceScale);
        const radius = Math.max(1, reach * Math.max(0.1, parameters.secondaryRadiusScale ?? 1.4));
        const halfAngle = Math.max(0, Math.min(180, parameters.secondaryFanDeg ?? 120)) * Math.PI / 360;
        const skillDamageRate = Math.max(0, parameters.secondaryDamageRate ?? 1);
        const knockbackCells = Math.max(0, parameters.secondaryKnockback ?? 0);
        //  副轨命中挂状态（2026-10-30 僵尸「声波扫射」103203：II/III 级让命中目标减速）。
        //  必须显式开 `secondaryAppliesHitStatus = 1` 才挂：`skillParamJson` 里的 `statusId`
        //  是整卡共用的一个槽（`mergeSkillPlanIntoRuntime` 按 `unitId:pvpSkillId` 合并），
        //  不加闸门的话「同一张卡另一条技能的眩晕/易伤」会被副轨顺手一起打出去。
        //  缺省 0 ⇒ 既有副轨（椰蛋战士「横扫」）行为逐字不变。
        const appliesHitStatus = (parameters.secondaryAppliesHitStatus ?? 0) > 0;
        const onHitStatusId = appliesHitStatus
            ? (this.skillRuntimeFor(unit, context).get(`${unit.unitId}:${profile.skillId}`)?.statusId
                ?? activeProfile.onHitStatusId)
            : activeProfile.onHitStatusId;
        const targetOwner = this.targetOwner(state, target, context);
        const criticalMultiplier = this.criticalMultiplier(unit, context);
        const damage = Math.round(this.unitDamage(context, unit, targetOwner, target.cardId, skillDamageRate,
            target.kind === 'unit' ? target.id : undefined)
            * criticalMultiplier);
        const counterMultiplier = this.counterMultiplierFor(
            unit, this.targetOwner(state, target, context), target.cardId, context,
            target.kind === 'unit' ? target.id : undefined);
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
            //  扇形是「技能出手」，不是普攻；`empowered` 只影响表现层的强化标识，这里给 false
            //  是为了不与「每 N 次普攻的强化」混淆（同一个单位两条链各自有表现）。
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
            //  贴脸（距离≈0）时方向没有意义，直接算命中，否则近战会「站在身上打不到」。
            if (dist <= 1e-6) return true;
            const delta = Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - heading),
                Math.cos(Math.atan2(dy, dx) - heading)));
            return delta <= halfAngle;
        });
        for (const victim of hitTargets) {
            const hitText = context.damageUnit(victim, damage, {
                owner: unit.owner, kind: 'unit', unitId: unit.id, floatTextKind,
            });
            this.applyLifesteal(unit, hitText, context);
            context.tryExecuteUnit(victim, undefined, unit.owner, unit.id, hitText);
            if (onHitStatusId) context.applyHitStatus(victim, onHitStatusId, unit.id);
            if (knockbackCells > 0 && victim.hp > 0) {
                //  格 → 逻辑坐标：`HEX_GRID_LOGICAL_ROW_STEP` 是「一格行距」，
                //  再乘 `combatDistanceScale` 由 `applyLegacyKnockback` 自己完成。
                context.applyKnockback(victim, unit, knockbackCells * HEX_GRID_LOGICAL_ROW_STEP);
            }
        }
        return true;
    }

    /**
     * 自身光环：在施法者脚下开一片跟随本体的周期伤害区域。
     * 复用 `ZCGroundZoneSystem` 的波次/间隔/到期/吸血/飘字，只多一个 `followUnitId`。
     * 参数（skillParamJson）：auraSeconds / auraInterval / auraRadius / auraDamageRate。
     * 返回 true = 真的开出来了，调用方才消费 CD。
    */
    static castSelfAura(state: ZCSnapshot, unit: ZCUnitState,
        context: IZCAttackResolutionContext): boolean {
        const definition = context.effectiveDefinition(unit);
        const profile = definition.attackProfile;
        const parameters = this.skillRuntimeFor(unit, context)
            .get(`${unit.unitId}:${profile.skillId}`)?.parameters;
        const radius = Math.max(0, parameters?.auraRadius ?? 0) * context.rules.combatDistanceScale;
        const seconds = Math.max(0, parameters?.auraSeconds ?? 0);
        const interval = Math.max(0.05, parameters?.auraInterval ?? 1);
        const damageRate = Math.max(0, parameters?.auraDamageRate ?? 0);
        if (!(radius > 0) || !(seconds > 0) || !(damageRate > 0)) {
            //  诊断4.-a：三个必需参数里哪个是 0。这条一打出来就说明「走得到施法函数、但表没配上」。
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`selfaura-params:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} 自身光环（${profile.name}）参数不全：`
                    + `radius=${radius}（表值 ${parameters?.auraRadius ?? 'undefined'}）`
                    + ` seconds=${seconds} damageRate=${damageRate} ⇒ 不开区域、不消费 CD`);
            }
            return false;
        }

        //  暴击 / 克制按开光环那一刻的当前目标算一次，之后每一波都吃同一个数 ——
        //  与 `castFanSkill` / `attackProfile.damageRate` 的区域伤害同源（区域只存
        //  `damage` 一个标量，逐波重算暴击会让「同一片光环」一会儿暴一会儿不暴）。
        const target = context.currentTarget(unit);
        const targetOwner = target ? this.targetOwner(state, target, context) : unit.owner;
        const targetCardId = target?.cardId ?? null;
        const criticalMultiplier = this.criticalMultiplier(unit, context);
        const damage = Math.round(
            this.unitDamage(context, unit, targetOwner, targetCardId, damageRate,
                target?.kind === 'unit' ? target.id : undefined) * criticalMultiplier);
        const counterMultiplier = target
            ? this.counterMultiplierFor(
                unit, this.targetOwner(state, target, context), target.cardId, context,
                target.kind === 'unit' ? target.id : undefined)
            : 1;
        const floatTextKind = damageFloatTextKind(criticalMultiplier > 1, counterMultiplier);
        //  波数向下取整再加一：`auraSeconds = 4` / `interval = 1` ⇒ 4 波（立刻一波 + 3 波），
        //  最后一波正好落在到期那一拍；留 `1e-6` 吸收 6 / 1 = 6.000000000000001 这类浮点误差。
        const waves = Math.max(1, Math.round(seconds / interval + 1e-6));
        const origin = context.unitPosition(unit);
        //  「身前 N px」出生点（2026-11-11 磁电菇「磁电冲击」101604「在身前 1px 的位置」）：
        //  沿本体美术朝向前移，与区域半径同一套表值口径 ⇒ 乘 `combatDistanceScale`。
        //  缺省 0 ⇒ 就是本体脚下，无尘禁土（102503）行为逐字不变。
        const forward = Math.max(0, parameters?.auraForward ?? 0) * context.rules.combatDistanceScale;
        //  「终点朝向目标方向」（2026-11-11 磁电冲击 101604 第二轮）：
        //  开了 `auraFaceTarget` 就用「本体 → 当前目标」的方位角，出生点偏移也用同一个角 ——
        //  两者必须同源，否则区域会沿本体朝向飘出去、矩形却朝目标，中心对不上。
        //  没有目标 / 上下文不给位置 ⇒ 回落到本体美术朝向（与改前逐字一致）。
        const faceTarget = (parameters?.auraFaceTarget ?? 0) > 0;
        //  `ZCCombatTarget` 自带 `x / y`（与 `unitPosition` 同一套世界坐标），不用再查单位表。
        const targetPos = faceTarget && target ? { x: target.x, y: target.y } : null;
        const aimRadians = targetPos && (targetPos.x !== origin.x || targetPos.y !== origin.y)
            ? Math.atan2(targetPos.y - origin.y, targetPos.x - origin.x)
            : unit.facingRadians;
        const spawnX = forward > 0 ? origin.x + Math.cos(aimRadians) * forward : origin.x;
        const spawnY = forward > 0 ? origin.y + Math.sin(aimRadians) * forward : origin.y;
        //  区域朝向（度）：只有真的「朝目标」才写，否则保持缺省 0° ⇒ 既有区域一个字节都不变。
        const angleDegrees = targetPos ? aimRadians * 180 / Math.PI : undefined;
        //  表现的竖直抬升（屏上 px）：「起始位置要在角色的中心点」，单位根节点是逻辑脚点，
        //  不抬的话光束有一半埋在地面线以下。缺省 0 ⇒ 既有区域一律不抬。
        const visualLiftPx = Math.max(0, parameters?.auraVisualLiftPx ?? 0);
        //  是否跟随本体（缺省 1 = 跟随，与无尘禁土一致）。冲击波是站桩的，配 0。
        //  2026-11-12 磁电冲击改成「跟随角色一起移动、固定在角色身前」⇒ 配 1。
        const follow = (parameters?.auraFollow ?? 1) > 0;
        //  跟随落点保持的身前距离：直接复用 `auraForward` —— 「出生时在身前 N px」与
        //  「之后一直悬在身前 N px」本来就是同一个数，没必要再开一个口径让两者能配歪。
        //  `auraForward` 缺省 0 ⇒ 圆心跳回本体，与无尘禁土逐字一致。
        const followForward = follow && forward > 0 ? forward : 0;
        //  每波目标上限（磁电冲击「最多对范围内 5 个敌人」）。缺省 0 ⇒ 不限。
        const waveMaxTargets = Math.max(0, Math.round(parameters?.auraWaveMaxTargets ?? 0));
        //  施法者在此期间「跳起来」的高度（屏上 px，只抬美术根节点，不动坐标）。
        //  麻辣铁锅「喷射火焰」102603：「播放攻击动画时，角色上移 30px…角色在空中循环播放攻击动作」。
        //  挂在区域上 ⇒ 与光环同生共死，不需要另设到期清理。缺省 0 ⇒ 任何既有光环都不抬。
        const casterLiftPx = Math.max(0, parameters?.casterLiftPx ?? 0);
        //  矩形判定（2026-11-11 磁电冲击 101604 「把判定改成长方形，尽可能贴合特效范围」）：
        //  `auraRectHalfHeight > 0` 才启用；半长缺省跟随半径（长度仍由 auraRadius 三档驱动）。
        //  两者都是表值逻辑 px，与 `auraRadius` 同一套口径 ⇒ 一起乘 `combatDistanceScale`。
        const rectHalfHeight = Math.max(0, parameters?.auraRectHalfHeight ?? 0)
            * context.rules.combatDistanceScale;
        const rectHalfLength = rectHalfHeight > 0
            ? Math.max(0, parameters?.auraRectHalfLength ?? 0) * context.rules.combatDistanceScale || radius
            : 0;
        //  区域减速（2026-11-17 急冻瓜「冰山陨落」102403）：`auraSlowRatio` 缺省 0 ⇒ 不减速，
        //  与 `castSelfAura` 之前写死 `slowRatio: 0` 的口径逐字一致（无尘禁土 / 喷射火焰不受影响）。
        const slowRatio = Math.max(0, Math.min(1, parameters?.auraSlowRatio ?? 0));
        state.groundZones.push({
            x: spawnX,
            y: spawnY,
            radius,
            owner: unit.owner,
            sourceUnitId: unit.id,
            //  `skillName` 只能取普攻行的名字：`skillParamJson` 只有数值槽，装不下字符串
            //  （同 `ZCGroundZoneSystem` 里 `ZONE_APPROACH_ANIMATION` 那条注释的理由）。
            //  它只服务事件日志/调试，不参与任何结算。
            skillId: profile.skillId,
            skillName: profile.name,
            effectPrefabPath: zcSelfAuraEffectPath(ZC_SELF_AURA_BEHAVIOR_KEY, unit.unitId)
                ?? ZC_SELF_AURA_EFFECT_PREFAB_PATH,
            //  必须给上限而不是 `Number.POSITIVE_INFINITY`：`remainingSeconds` 会进快照，
            //  非有限值过不了 `ZCSnapshotCodec` 的数值校验。
            remainingSeconds: seconds,
            wavesLeft: waves,
            nextWaveAt: state.elapsedSeconds,
            waveInterval: interval,
            damage,
            floatTextKind,
            slowRatio,
            //  整段持有一条长效表现事件：光环是一根持续燃着的光柱，不是每波闪一次。
            //  同时让 `syncHoldVisual` 每帧把事件挪到区域当前位置 ⇒ 视觉跟着本体走。
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
        if (zcSkillCastWatched(unit.unitId)) {
            skillCastLog('施法', `${unit.unitId}#${unit.id} 在 (${origin.x.toFixed(1)}, ${origin.y.toFixed(1)})`
                + ` 开出【${profile.name}】：半径 ${radius.toFixed(1)} 世界px（表值 ${parameters?.auraRadius}）`
                + (rectHalfHeight > 0
                    ? `，矩形判定 ${(rectHalfLength * 2).toFixed(1)}×${(rectHalfHeight * 2).toFixed(1)} 世界px`
                    : '')
                + `，${seconds}s × 每 ${interval}s = ${waves} 波，单跳 ${damage}，`
                + (follow
                    ? (followForward > 0 ? `跟随本体 #${unit.id}、身前 ${followForward.toFixed(1)} 世界px` : `跟随本体 #${unit.id}`)
                    : '站桩（不跟随本体）'));
        }
        return true;
    }

    /**
     * 落雷连线：每道雷 = 一个单波地面区域，按 `boltInterval` 逐道出现，首波延迟到 `boltDelay` 判伤。
     * 参数（表值 px）：boltCount / boltSpacing / boltInterval / boltDelay / boltDamageRate /
     * boltRadius / boltNumbChance / boltNumbSeconds。
     * 返回 true = 放出去了，调用方才消费 CD。
    */
    static castBoltLine(state: ZCSnapshot, unit: ZCUnitState,
        context: IZCAttackResolutionContext): boolean {
        const definition = context.effectiveDefinition(unit);
        const profile = definition.attackProfile;
        const parameters = this.skillRuntimeFor(unit, context)
            .get(`${unit.unitId}:${profile.skillId}`)?.parameters;
        const count = Math.max(0, Math.round(parameters?.boltCount ?? 0));
        const damageRate = Math.max(0, parameters?.boltDamageRate ?? 0);
        const radiusTable = Math.max(0, parameters?.boltRadius ?? 0);
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
        const spacing = Math.max(0, parameters?.boltSpacing ?? 0) * scale;
        const interval = Math.max(0.02, parameters?.boltInterval ?? 0.1);
        const delay = Math.max(0, parameters?.boltDelay ?? 0.15);
        const numbChance = Math.max(0, Math.min(1, parameters?.boltNumbChance ?? 0));
        const numbSeconds = Math.max(0, parameters?.boltNumbSeconds ?? 0);
        const origin = context.unitPosition(unit);
        //  「背朝向」= 从施法者指向目标的方向继续往后排。目标与本体几乎重合时方向没有意义，
        //  退回美术朝向（与 `castFanSkill` 的 `heading` 同一条兜底）。
        const dx = target.x - origin.x;
        const dy = target.y - origin.y;
        const length = Math.hypot(dx, dy);
        const dirX = length > 1e-6 ? dx / length : Math.cos(unit.facingRadians);
        const dirY = length > 1e-6 ? dy / length : Math.sin(unit.facingRadians);
        //  暴击 / 克制按出手那一刻的目标算一次，之后每道雷共用 —— 与光环 / 扇形同口径
        //  （同一轮技能里一会儿暴一会儿不暴只会让飘字抖）。
        const criticalMultiplier = this.criticalMultiplier(unit, context);
        const counterMultiplier = this.counterMultiplierFor(
            unit, this.targetOwner(state, target, context), target.cardId, context,
            target.kind === 'unit' ? target.id : undefined);
        const damage = Math.round(this.unitDamage(context, unit,
            this.targetOwner(state, target, context), target.cardId, damageRate,
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
                //  与 `castFanSkill` 同一条口径：这是「技能出手」而不是普攻强化，
                //  `empowered` 只影响表现层的强化标识。
                empowered: false,
                startedAt: state.elapsedSeconds + index * interval,
                //  必须活够整段动画：`ZCGameModel` 按 `startedAt + durationSeconds` 剔除事件，
                //  短一截就会在「雷尾消散」那几帧之前把节点摘掉。动画总长见 `ZC_BOLT_EFFECT_SECONDS`
                //  （20 帧 @ sample 30 = 0.667s），再加上出现 → 判伤的前摇。
                durationSeconds: delay + ZC_BOLT_EFFECT_SECONDS,
            });
            state.groundZones.push({
                x, y, radius,
                owner: unit.owner,
                sourceUnitId: unit.id,
                skillId: profile.skillId,
                skillName: profile.name,
                //  视觉已经由上面那条事件负责 ⇒ 区域不再逐波推自己的 event。
                effectPrefabPath: null,
                //  必须活到这一道雷结算完：首波在 `waveAt`，之后留 0.3s 收尾。
                remainingSeconds: index * interval + delay + 0.3,
                wavesLeft: 1,
                nextWaveAt: waveAt,
                waveInterval: interval,
                damage,
                floatTextKind,
                slowRatio: 0,
                //  麻痹：每个被打到的敌人各自掷 30%（在区域的波次结算里判）。
                hitStatusId: numbChance > 0 ? ZC_BOLT_NUMB_STATUS_ID : undefined,
                hitStatusChance: numbChance > 0 ? numbChance : undefined,
                hitStatusSeconds: numbSeconds > 0 ? numbSeconds : undefined,
            });
        }
        if (zcSkillCastWatched(unit.unitId)) {
            skillCastLog('施法', `${unit.unitId}#${unit.id} 放【五雷轰顶】：${count} 道，`
                + `间距 ${spacing.toFixed(1)}（表值 ${parameters?.boltSpacing}）`
                + `，逐道 ${interval}s、延迟 ${delay}s 判伤，单道 ${damage}`
                + `，麻痹 ${(numbChance * 100).toFixed(0)}% / ${numbSeconds}s`);
        }
        return true;
    }

    /**
     * 精密陷阱：原地留一片陷阱区域，敌人触碰吃一次伤害并引爆，到期也会主动爆炸。
     * 复用地面区域：`contactRadius` 触碰触发，`expireDamage` 到期均等伤害。
     * 参数（表值 px）：trapDuration / trapRadius / trapDamageRate / trapExplodeRadius /
     * trapExplodeDamageRate / trapForward。
     * 返回 true = 真的放下了，调用方才消费 CD。
    */
    static castTrap(state: ZCSnapshot, unit: ZCUnitState,
        context: IZCAttackResolutionContext): boolean {
        const definition = context.effectiveDefinition(unit);
        const profile = definition.attackProfile;
        const parameters = this.skillRuntimeFor(unit, context)
            .get(`${unit.unitId}:${profile.skillId}`)?.parameters;
        const scale = context.rules.combatDistanceScale;
        const seconds = Math.max(0, parameters?.trapDuration ?? 0);
        const contactTable = Math.max(0, parameters?.trapRadius ?? 0);
        const contactRate = Math.max(0, parameters?.trapDamageRate ?? 0);
        const explodeTable = Math.max(0, parameters?.trapExplodeRadius ?? 0);
        const explodeRate = Math.max(0, parameters?.trapExplodeDamageRate ?? 0);
        if (!(seconds > 0) || !(contactTable > 0) || !(contactRate > 0)
            || !(explodeTable > 0) || !(explodeRate > 0)) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`trap-params:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} 精密陷阱参数不全：duration=${seconds}`
                    + ` contact=${contactTable}/${contactRate} explode=${explodeTable}/${explodeRate}`
                    + ` ⇒ 不放陷阱、不消费 CD`);
            }
            return false;
        }

        //  暴击 / 克制按放下那一刻的当前目标算一次，两份伤害（触碰 / 爆炸）共用 ——
        //  与 `castSelfAura` / `castBoltLine` 同一口径：区域只存标量，逐帧重算会让
        //  「同一片陷阱」一会儿暴一会儿不暴。触发时目标可能已经换了人，这是刻意的：
        //  陷阱是「布置时灌注的能量」，不是「每次踩都重新掷一次骰」。
        const target = context.currentTarget(unit);
        const targetOwner = target ? this.targetOwner(state, target, context) : unit.owner;
        const targetCardId = target?.cardId ?? null;
        const criticalMultiplier = this.criticalMultiplier(unit, context);
        const counterMultiplier = target
            ? this.counterMultiplierFor(
                unit, this.targetOwner(state, target, context), target.cardId, context,
                target.kind === 'unit' ? target.id : undefined)
            : 1;
        const floatTextKind = damageFloatTextKind(criticalMultiplier > 1, counterMultiplier);
        const contactDamage = Math.round(
            this.unitDamage(context, unit, targetOwner, targetCardId, contactRate,
                target?.kind === 'unit' ? target.id : undefined) * criticalMultiplier);
        const explodeDamage = Math.round(
            this.unitDamage(context, unit, targetOwner, targetCardId, explodeRate,
                target?.kind === 'unit' ? target.id : undefined) * criticalMultiplier);

        const origin = context.unitPosition(unit);
        //  放置点：设计案原文是「原地坐标」⇒ 缺省就压在脚下（`trapForward` 缺省 0）。
        //  留这个参数是为了以后要「往前丢一格」时改配表就行，不用再动代码。
        const forward = Math.max(0, parameters?.trapForward ?? 0) * scale;
        const x = forward > 0 ? origin.x + Math.cos(unit.facingRadians) * forward : origin.x;
        const y = forward > 0 ? origin.y + Math.sin(unit.facingRadians) * forward : origin.y;

        state.groundZones.push({
            x, y,
            //  `radius` = 爆炸半径（到期通道按它打全部敌人）；触碰用 `contactRadius`。
            radius: explodeTable * scale,
            owner: unit.owner,
            sourceUnitId: unit.id,
            skillId: profile.skillId,
            skillName: profile.name,
            //  常驻表现（`idle` 循环）跟着区域走，位置由 `syncHoldVisual` 每帧同步。
            effectPrefabPath: ZC_TRAP_IDLE_PREFAB_PATH,
            holdVisual: true,
            //  生成动画先播 0.4s，常驻光环推后出场 —— 两段美术，同帧会双影。
            visualDelaySeconds: ZC_TRAP_SPAWN_SECONDS,
            remainingSeconds: seconds,
            //  陷阱没有「波次」：伤害只在触碰 / 到期两个时刻各结算一次。
            wavesLeft: 0,
            nextWaveAt: state.elapsedSeconds + seconds,
            waveInterval: Math.max(0.05, seconds),
            damage: 0,
            slowRatio: 0,
            floatTextKind,
            contactRadius: contactTable * scale,
            contactDamage,
            expireDamage: explodeDamage,
            expirePrefabPath: ZC_TRAP_EXPIRE_PREFAB_PATH,
            expireFxSeconds: ZC_TRAP_EXPIRE_SECONDS,
        });

        //  生成那一段是独立的一条一次性表现（`start00~11`），不是区域的持有视觉：
        //  它只活 0.4s，与区域寿命无关。时长必须 ≥ 动画总长，否则尾段会被事件裁剪摘掉。
        state.combatEvents.push({
            id: state.nextCombatEventId++,
            type: ZCCombatEventType.Area,
            owner: unit.owner,
            sourceUnitId: unit.id,
            targetUnitId: target?.kind === 'unit' ? target.id : null,
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
            //  纯表现：两份伤害分别由触碰与到期结算，这里给 0。
            damage: 0,
            empowered: false,
            startedAt: state.elapsedSeconds,
            durationSeconds: ZC_TRAP_SPAWN_SECONDS,
        });

        if (zcSkillCastWatched(unit.unitId)) {
            skillCastLog('施法', `${unit.unitId}#${unit.id} 放下【精密陷阱】：`
                + `存活 ${seconds}s、触碰 ${contactTable}px/${contactDamage}、`
                + `爆炸 ${explodeTable}px/${explodeDamage}（均等、无递减）`);
        }
        return true;
    }

    /**
     * 孢爆箭 / 孢子凝珠：朝锁定目标射一枚「命中就爆开」的弹（2026-11-17 第 12 批）。
     *
     * 为什么不走 `castSelfAura` 那条区域：区域是「放下就不管、按波结算」，而这两条技能是
     * 「一发打出去、只在命中点炸一次」，用 `strikeTargets` 的导弹分支正好是同一件事：
     * 弹体飞行 + 命中 `resolveProjectileHit` + `splashRadius` 旁溅。
     *
     * 参数（`skillParamJson`，`shot` 前缀，见 `ZCSkillTriggerSystem.applySplashShot` 的理由）：
     * `shotDamageRate` / `shotRadius`（表值逻辑 px，爆点半径）。
     * 🔴 弹道里的 `splashDamageRate` 给 **1**：设计口径是「对半径 90 内所有敌人造成 60% 伤害」，
     * 也就是旁溅与直击同额；不给 1 的话 `resolveProjectileHit` 会按 0 结算（白炸）。
     *
     * 返回 `false` ⇒ 参数不全 / 锁定目标已经跑出射程 / 射程内一个人都没有，调用方不要消费 CD。
    */
    static castSplashShot(state: ZCSnapshot, unit: ZCUnitState,
        context: IZCAttackResolutionContext, slowStatusId?: string): boolean {
        const definition = context.effectiveDefinition(unit);
        const profile = definition.attackProfile;
        const parameters = this.skillRuntimeFor(unit, context)
            .get(`${unit.unitId}:${profile.skillId}`)?.parameters;
        const damageRate = Math.max(0, parameters?.shotDamageRate ?? 0);
        const splashTable = Math.max(0, parameters?.shotRadius ?? 0);
        const splashRadius = splashTable * context.rules.combatDistanceScale;
        if (!(damageRate > 0) || !(splashRadius > 0)) {
            //  诊断：走得到施法函数、但表没配上（与 `castSelfAura` 的参数诊断同一条思路）。
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`splash-params:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} 孢爆箭（${profile.name}）参数不全：`
                    + `damageRate=${damageRate} shotRadius=${parameters?.shotRadius ?? 'undefined'}`
                    + ` ⇒ 不出弹、不消费 CD`);
            }
            return false;
        }
        //  挑人半径 = 普攻射程（含 `attackRangePct` 与 `combatDistanceScale`，与普攻完全同源）。
        //  设计口径是「向目标射出」：锁定的目标跑出射程就不放，而不是随手换一个更近的。
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
            //  旁溅与直击同额：见上面方法注释里的🔴。
            splashDamageRate: 1,
            //  不递减：设计写的是「半径内**所有**敌人造成 60%」，不是爆囊扩散那种逐目标 ×0.7。
            splashFalloff: 0,
            statusId: slowStatusId,
            missilePrefabPath: ZC_SPLASH_SHOT_MISSILE_PREFAB_PATH,
            impactPrefabPath: ZC_SPLASH_SHOT_IMPACT_PREFAB_PATH,
            //  直线飞行：孢子凝珠/孢爆箭不是「制导导弹」，没有弧线需求（`arcOffset` 缺省 0）。
            //  速度跟着普攻弹速走 —— 箭比法术快，`projectileSpeed` 本来就是这张卡的数。
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
     * 孢爆箭（新口径，2026-11-18 第 16 批）：射一枚**慢速风弹**，命中单体后原地留一片飓风。
     *
     * 与它上一版（第 12 批 `castSplashShot` 的「命中点周围 90/110/130 均等溅射」）的区别：
     *  · 伤害只在**命中的那一个敌人**身上（150/180/220%），不再旁及；
     *  · 旁及的活由飓风接管 —— 命中点生成一块半径 30 逻辑 px、存活 3 秒的区域，
     *    每个接触到的敌人**只挨一次**（`hitOncePerUnit`），站在里面不会反复掉血。
     *
     * 为什么必须自己发弹、不再借 `strikeTargets` 的导弹分支：那条分支的 `durationSeconds`
     * 是「飞到目标的距离 ÷ 弹速 + 打空距离」，而设计要的是**固定 4 秒生命周期**
     * （风弹慢慢飘，飘到哪算哪）。速度也只有 70 逻辑 px/s —— 比普攻弹速慢一个量级，
     * 借用分支就得再开一个「寿命覆盖」参数，反倒比这里直接写清楚更难读。
     *
     * 参数（`skillParamJson`，`wind` 前缀，理由见 `ZCSkillTriggerSystem.applyWindShot`）：
     * `windDamageRate` / `windSpeed` / `windLifeSeconds` /
     * `windZoneRadius` / `windZoneSeconds` / `windZoneDamageRate`。
     *
     * 返回 `false` ⇒ 参数不全 / 没有锁定目标 / 锁定目标已经跑出普攻射程，
     * 调用方**不要**消费 CD（与 `castSplashShot` / `castBurstSkill` 同一条口径）。
    */
    static castWindBolt(state: ZCSnapshot, unit: ZCUnitState,
        context: IZCAttackResolutionContext): boolean {
        const definition = context.effectiveDefinition(unit);
        const profile = definition.attackProfile;
        const parameters = this.skillRuntimeFor(unit, context)
            .get(`${unit.unitId}:${profile.skillId}`)?.parameters;
        const damageRate = Math.max(0, parameters?.windDamageRate ?? 0);
        const speedTable = Math.max(0, parameters?.windSpeed ?? 0);
        const lifeSeconds = Math.max(0, parameters?.windLifeSeconds ?? 0);
        const zoneRate = Math.max(0, parameters?.windZoneDamageRate ?? 0);
        const zoneRadiusTable = Math.max(0, parameters?.windZoneRadius ?? 0);
        const zoneSeconds = Math.max(0, parameters?.windZoneSeconds ?? 0);
        if (!(damageRate > 0) || !(speedTable > 0) || !(lifeSeconds > 0)
            || !(zoneRate > 0) || !(zoneRadiusTable > 0) || !(zoneSeconds > 0)) {
            //  诊断：走得到施法函数、但表没配上（与 `castSplashShot` 的参数诊断同一条思路）。
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`wind-params:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} 孢爆箭（${profile.name}）参数不全：`
                    + `damageRate=${damageRate} speed=${speedTable} life=${lifeSeconds} `
                    + `zone=${zoneRadiusTable}/${zoneSeconds}/${zoneRate} ⇒ 不出弹、不消费 CD`);
            }
            return false;
        }
        const scale = context.rules.combatDistanceScale;
        const target = context.currentTarget(unit);
        if (!target) return false;
        const origin = context.unitPosition(unit);
        //  射程闸门：设计写的是「向目标射出」，锁定目标跑出射程就不放，
        //  而不是随手换一个更近的（与 `castSplashShot` 同一条判据）。
        const reach = Math.max(1, ZCTargetingSystem.attackReach(definition, definition.bodyRadius, scale));
        const dx = target.x - origin.x;
        const dy = target.y - origin.y;
        const length = Math.hypot(dx, dy);
        if (length > reach) return false;
        //  克制 / 处决要按**被打的那个单位**的属性算，而 `ZCCombatTarget` 只带
        //  `kind/id/x/y/bodyRadius/cardId`（没有 owner）⇒ 回单位索引取一次。
        //  城墙 / 建筑不打这张卡的风弹（设计写的是「命中敌人」），取不到就这一帧不放。
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
            //  🔴 寿命就是设计给的 4 秒，不是「飞到目标的距离」：风弹飘到哪算哪，
            //  飘满 4 秒还没碰到人就消失（消失时不留飓风 —— 设计写的是「命中敌人」才留）。
            durationSeconds: lifeSeconds,
            targetKind: 'unit',
            targetId: goal.id,
            sourceCardId: unit.cardId,
            baseDamage: this.unitDamage(context, unit, goal.owner, goal.cardId, damageRate, goal.id),
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
            //  命中点留下的飓风：半径 / 秒 / 每次接触伤害 / 表现，四个一起给才算「要留区域」。
            hurricaneRadius: zoneRadiusTable * scale,
            hurricaneSeconds: zoneSeconds,
            hurricaneDamage: this.unitDamage(context, unit, goal.owner, goal.cardId, zoneRate, goal.id),
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
     * 连射导弹（2026-11-18 第 16 批）：发射**一颗**抛物线炸弹，落点由目标位置抖出来。
     *
     * 为什么一次只发一颗、由触发系统负责「1.2 秒内发 3 颗」：
     *  · 弹体的 `startedAt` 必须是「当前时刻」—— 快照校验要求 `startedAt <= elapsedSeconds`，
     *    排一颗 0.4 秒后才能出场的弹体在存档校验那一关就过不去；
     *  · 项目里「多段出手」本来就有现成的算法（`advanceBurst` 的 shotsLeft/nextAt 那一套），
     *    在本车道再写一份定时器等于同一件事两套口径。
     *  ⇒ 定时归触发系统（`ZCSkillTriggerSystem.advanceBarrage`），这里只管「发一颗、发去哪」。
     *
     * 🔴 三个「不」：不碰中途目标（`ignoresMidAirCollision`）、不在中途炸、
     * 只在落点炸一次（`explodeOnArrival` + `arriveRadius/arriveDamage`）。
     * 设计原话：「炸弹只有达到落点才会爆炸，行径过程不会提前触碰其他目标」。
     *
     * 落点散布：以目标为圆心、半径 15 逻辑 px（= 设计说的「30px 直径」）的圆内**面积均匀**取点
     * （`sqrt(random)` 才不会挤在圆心）。
     *
     * 参数（`skillParamJson`，`barrage` 前缀）：`barrageDamageRate` / `barrageRadius`
     * （爆炸半径，逻辑 px）/ `barrageCount` / `barrageInterval` / `barrageEvery`。
     *
     * 返回 `false` ⇒ 参数不全 / 射程内没有可打的目标，调用方不要记这一发。
    */
    static castBarrageShot(state: ZCSnapshot, unit: ZCUnitState,
        context: IZCAttackResolutionContext): boolean {
        const definition = context.effectiveDefinition(unit);
        const profile = definition.attackProfile;
        const parameters = this.skillRuntimeFor(unit, context)
            .get(`${unit.unitId}:${profile.skillId}`)?.parameters;
        const damageRate = Math.max(0, parameters?.barrageDamageRate ?? 0);
        const radiusTable = Math.max(0, parameters?.barrageRadius ?? 0);
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
        //  落点散布：圆内面积均匀（半径取 sqrt 才不会都挤在圆心）。
        const scatter = ZC_BARRAGE_SCATTER_RADIUS * scale;
        const angle = context.random() * Math.PI * 2;
        const spread = Math.sqrt(context.random()) * scatter;
        const landingX = goalPosition.x + Math.cos(angle) * spread;
        const landingY = goalPosition.y + Math.sin(angle) * spread;
        let dx = landingX - origin.x;
        let dy = landingY - origin.y;
        let length = Math.hypot(dx, dy);
        if (length < 1e-6) {
            //  贴脸（目标就在脚下）：给一个沿朝向的 1px 位移，避免 `velocity = 0` 过不了快照校验。
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
            baseDamage: this.unitDamage(context, unit, goal.owner, goal.cardId, damageRate, goal.id),
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
            //  只走落点：整段不碰撞，飞到 `durationSeconds` 那一拍由 `resolveProjectileArrival` 结算。
            ignoresMidAirCollision: true,
            explodeOnArrival: true,
            arriveRadius: radiusTable * scale,
            arriveDamage: this.unitDamage(context, unit, goal.owner, goal.cardId, damageRate, goal.id),
            //  表现：飞行段用镭射飞龙的导弹，到点由 `lingerBeam` 在落点播命中爆炸。
            impactEffectPrefabPath: ZC_BARRAGE_IMPACT_PREFAB_PATH,
            //  🔴 同一份爆炸 prefab 被镭射飞龙按「半径 80」标定过，这里是 180 ⇒ 事件级放大 2.25。
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
     * 连射导弹这一发的「目标点」：优先用锁定目标（在射程内），否则在射程内挑最近的一个。
     *
     * 为什么要兜底：一轮 3 颗里第一颗可能把锁定目标打死，后面两颗若直接判负就会「凭空少两颗」。
     * 项目里弹道类 AoE 的口径是「打向敌人聚集处」，就近补一个目标是更合理的读法。
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
     * 到点引爆（`explodeOnArrival` 的弹体走这条，2026-11-18 第 16 批连射导弹）。
     *
     * 与 `resolveProjectileHit` 的分工：那个是「撞到谁就结算给谁 + 旁溅」，
     * 这个是「在落点对半径内**所有**敌人各结算一次」，包括原本瞄准的那个。
     * 伤害基数取 `arriveDamage`（出手时算好的面板伤害），逐目标再乘克制
     * （与「命中爆炸」`burstDamage` 那条路同一口径）。
    */
    static resolveProjectileArrival(state: ZCSnapshot, projectile: ZCProjectileState,
        context: IZCAttackResolutionContext): void {
        const radius = Math.max(0, projectile.arriveRadius ?? 0);
        if (!(radius > 0)) return;
        const hexId = context.geometry.hexIdAt(projectile.x, projectile.y);
        if (hexId == null) return;
        const radiusHex = Math.ceil(radius / HEX_GRID_LOGICAL_ROW_STEP) + 1;
        const shooter = context.unitById.get(projectile.sourceUnitId);
        let hit = 0;
        for (const victim of context.unitsInRadius(hexId, radiusHex)) {
            if (victim.owner === projectile.owner || victim.battleState === 'dead' || victim.hp <= 0) continue;
            const position = context.unitPosition(victim);
            if (distance(projectile.x, projectile.y, position.x, position.y) > radius) continue;
            const multiplier = this.projectileCounterMultiplier(
                projectile, victim.owner, victim.cardId, context, victim.id);
            const damage = Math.round(Math.max(0, projectile.arriveDamage ?? 0) * multiplier);
            if (!(damage > 0)) continue;
            const hitText = context.damageUnit(victim, damage, {
                owner: projectile.owner, kind: 'unit', unitId: projectile.sourceUnitId,
                floatTextKind: damageFloatTextKind(projectile.criticalHit === true, multiplier),
                ranged: true,
            });
            hit += 1;
            if (shooter) this.applyLifesteal(shooter, hitText, context);
            context.tryExecuteUnit(victim, projectile.executeChance, projectile.owner,
                projectile.sourceUnitId, hitText);
            context.applyHitStatus(victim, projectile.onHitStatusId, projectile.sourceUnitId);
        }
        if (zcSkillCastWatched(String(context.unitById.get(projectile.sourceUnitId)?.unitId ?? ''))) {
            skillCastLogChanging(`barrage-boom:${projectile.id}`, '施法',
                `连射导弹在落点引爆：半径 ${radius.toFixed(1)}（世界 px）、命中 ${hit} 人`);
        }
    }

    /**
     * 菌毯爆发 / 菌核爆裂：以自身为圆心爆一次（2026-11-17 第 13 批）。
     *
     * 与 `castSplashShot` 的分工：那条是「射一枚会爆的弹、在命中点炸」，圆心由目标决定、
     * 需要一个锁定目标；这条是「原地炸、圆心恒等于自己」，全向、不判朝向、不需要目标。
     * 与 `castFanSkill` 的分工：扇形按 `heading` 过滤，这条是 360°；扇形只打一次、
     * 这条爆完还要给自己加东西（护盾 / 击退）。
     *
     * 参数（`skillParamJson`，`burst` 前缀，理由见 `ZCSkillTriggerSystem.applyBurstSkill`）：
     * `burstDamageRate` / `burstRadius`（表值逻辑 px）/
     * `burstShieldRatio` + `burstShieldSeconds`（套盾）/
     * `burstKnockbackCells`（击退格数）。
     * `guardStatusId` 由触发系统按 `burstShieldReducePct` 算好并注册，这里只负责挂到施法者身上。
     *
     * 返回 `false` ⇒ 参数不全 / 半径内一个人都没有，调用方不要消费 CD。
     *
     * ⚠️ 伤害与扇形 / 光环一致取**一份**：暴击与克制按「离得最近的那个敌人」算一次，
     * 半径内所有人吃同一个数。逐目标各算一遍会让同一发爆炸里飘出「这个暴击、那个不暴击」，
     * 与 `castFanSkill` / `castSelfAura` 的口径不一致（项目内 AoE 一律单值）。
    */
    static castBurstSkill(state: ZCSnapshot, unit: ZCUnitState,
        context: IZCAttackResolutionContext, guardStatusId?: string): boolean {
        const definition = context.effectiveDefinition(unit);
        const profile = definition.attackProfile;
        const parameters = this.skillRuntimeFor(unit, context)
            .get(`${unit.unitId}:${profile.skillId}`)?.parameters;
        const damageRate = Math.max(0, parameters?.burstDamageRate ?? 0);
        const radiusTable = Math.max(0, parameters?.burstRadius ?? 0);
        const radius = radiusTable * context.rules.combatDistanceScale;
        if (!(damageRate > 0) || !(radius > 0)) {
            //  诊断：走得到施法函数、但表没配上（与 `castSplashShot` / `castSelfAura` 同一条思路）。
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`burst-params:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} 自心爆发（${profile.name}）参数不全：`
                    + `damageRate=${damageRate} burstRadius=${parameters?.burstRadius ?? 'undefined'}`
                    + ` ⇒ 不出手、不消费 CD`);
            }
            return false;
        }
        const origin = context.unitPosition(unit);
        //  全向收集：不判朝向，贴脸（距离≈0）与远处一样算命中。
        const victims = state.units.filter((candidate) => {
            if (candidate.owner === unit.owner || candidate.battleState === 'dead' || candidate.hp <= 0) return false;
            const pos = context.unitPosition(candidate);
            return Math.hypot(pos.x - origin.x, pos.y - origin.y) <= radius;
        });
        if (!victims.length) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`burst-empty:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} 自心爆发（${profile.name}）半径 ${radiusTable} 表值 px`
                    + `（世界 ${radius.toFixed(1)}）内没有敌人 ⇒ 不消费 CD，下帧重试`);
            }
            return false;
        }
        //  代表目标 = 最近的那一个：只用来定「这一发是否暴击 / 克制」与事件上的 `targetUnitId`。
        const primary = victims.reduce((best, candidate) => {
            const pos = context.unitPosition(candidate);
            const bestPos = context.unitPosition(best);
            return Math.hypot(pos.x - origin.x, pos.y - origin.y)
                < Math.hypot(bestPos.x - origin.x, bestPos.y - origin.y) ? candidate : best;
        }, victims[0]);
        //  目标就是自己人之外的 `ZCUnitState`，阵营直接读 `.owner` ——
        //  不用绕 `targetOwner`（那个是为「打格子」这类 `ZCCombatTarget` 准备的）。
        const primaryOwner = primary.owner;
        const primaryCardId = primary.unitId;
        const criticalMultiplier = this.criticalMultiplier(unit, context);
        const counterMultiplier = this.counterMultiplierFor(
            unit, primaryOwner, primaryCardId, context, primary.id);
        const damage = Math.round(this.unitDamage(context, unit, primaryOwner, primaryCardId,
            damageRate, primary.id) * criticalMultiplier);
        const floatTextKind = damageFloatTextKind(criticalMultiplier > 1, counterMultiplier);
        //  爆点表现：`普攻爆炸` 一次性播一遍，尺寸由 `zcBurstEffectScale` 反算（让屏上直径 = 判定直径）。
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
            //  与扇形 / 五雷轰顶同口径：这是「技能出手」，不是普攻强化。
            empowered: false,
            startedAt: state.elapsedSeconds,
            durationSeconds: 0.3,
            effectScale: zcBurstEffectScale(radiusTable),
        });
        const knockbackCells = Math.max(0, parameters?.burstKnockbackCells ?? 0);
        for (const victim of victims) {
            const hitText = context.damageUnit(victim, damage, {
                owner: unit.owner, kind: 'unit', unitId: unit.id, floatTextKind,
            });
            this.applyLifesteal(unit, hitText, context);
            context.tryExecuteUnit(victim, undefined, unit.owner, unit.id, hitText);
            if (knockbackCells > 0 && victim.hp > 0) {
                //  格 → 逻辑坐标：`HEX_GRID_LOGICAL_ROW_STEP` 是「一格行距」，
                //  乘 `combatDistanceScale` 由 `applyLegacyKnockback` 自己完成（与扇形同一条路）。
                context.applyKnockback(victim, unit, knockbackCells * HEX_GRID_LOGICAL_ROW_STEP);
            }
        }
        //  自护盾（菌毯爆发）：伤害结算完再套，护盾吸收的是**之后**打来的伤害。
        //  与 `selfShieldRatio`（`sendAttack` 里那条单体护盾）复用同一个 `applySelfShield`：
        //  取最大值、写 `shieldExpireAt`，到期由 `ZCSkillTriggerSystem.expireShield` 清零。
        const shieldRatio = Math.max(0, parameters?.burstShieldRatio ?? 0);
        const shieldSeconds = Math.max(0, parameters?.burstShieldSeconds ?? 0);
        if (shieldRatio > 0) this.applySelfShield(state, unit, shieldRatio, shieldSeconds);
        //  III 级的「护盾期间受到伤害降低」：定义由触发系统注册，这里只挂到施法者身上。
        if (guardStatusId && shieldSeconds > 0) {
            context.statusSystem.apply(String(unit.id), guardStatusId,
                { at: state.elapsedSeconds, durationSeconds: shieldSeconds });
            state.statusEffects = context.statusSystem.exportSnapshot();
        }
        if (zcSkillCastWatched(unit.unitId)) {
            skillCastLogChanging(`burst-cast:${unit.id}`, '施法',
                `${unit.unitId}#${unit.id} 引爆【${profile.name}】：倍率 ${damageRate}、`
                + `半径 ${radiusTable} 表值 px（世界 ${radius.toFixed(1)}）、命中 ${victims.length} 人、`
                + `单发 ${damage}、护盾 ${shieldRatio > 0 ? `${(shieldRatio * 100).toFixed(0)}%·${shieldSeconds}s` : '无'}、`
                + `击退 ${knockbackCells} 格、减伤 ${guardStatusId ?? '无'}`);
        }
        return true;
    }

    /**
     * 菌丝绞杀：身前扇形甩一次（2026-11-17 第 14 批）。
     *
     * 三条既有车道的差别（为什么不能直接复用其中任何一条）：
     *  · `castFanSkill`（副轨扇形）—— 半径是「普攻射程 × `secondaryRadiusScale`」、**没有人数上限**、
     *    还带击退参数；设计案这条要求的是「半径取表值 150、最多 4/5/6 人」，两者对不上。
     *  · `castBurstSkill`（第 13 批）—— 360° 全向，这条只有身前 `fanAngle` 度。
     *  · `strikeTargets` —— 只认圆形半径，没有角度过滤。
     *
     * 参数（`skillParamJson`，`fan` 前缀；理由见 `ZCSkillTriggerSystem.applyFanSweep`）：
     * `fanDamageRate` / `fanRadius`（表值逻辑 px）/ `fanAngle`（度，总张角）/
     * `fanMaxTargets` / `fanSlowRatio` + `fanSlowSeconds`（减速，由触发系统算好 id 传进来）。
     *
     * 朝向：优先「朝当前锁定目标」，没有锁定目标时退回 `unit.facingRadians`
     * （与 `castFanSkill` 同一条兜底）—— 扇形总要有个方向，「身前」在没有目标时就是面朝方向。
     *
     * 返回 `false` ⇒ 参数不全 / 扇形内一个人都没有，调用方不要消费 CD。
    */
    static castFanSweep(state: ZCSnapshot, unit: ZCUnitState,
        context: IZCAttackResolutionContext, slowStatusId?: string): boolean {
        const definition = context.effectiveDefinition(unit);
        const profile = definition.attackProfile;
        const parameters = this.skillRuntimeFor(unit, context)
            .get(`${unit.unitId}:${profile.skillId}`)?.parameters;
        const damageRate = Math.max(0, parameters?.fanDamageRate ?? 0);
        const radiusTable = Math.max(0, parameters?.fanRadius ?? 0);
        const radius = radiusTable * context.rules.combatDistanceScale;
        const fanDeg = Math.max(0, Math.min(360, parameters?.fanAngle ?? 120));
        const halfAngle = fanDeg * Math.PI / 360;
        const maxTargets = Math.max(1, Math.round(parameters?.fanMaxTargets ?? 1));
        if (!(damageRate > 0) || !(radius > 0) || !(halfAngle > 0)) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`fan-params:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} 扇形甩击（${profile.name}）参数不全：`
                    + `damageRate=${damageRate} fanRadius=${parameters?.fanRadius ?? 'undefined'}`
                    + ` fanAngle=${parameters?.fanAngle ?? 'undefined'} ⇒ 不出手、不消费 CD`);
            }
            return false;
        }
        const origin = context.unitPosition(unit);
        const target = context.currentTarget(unit);
        const heading = target && Math.abs(target.x - origin.x) + Math.abs(target.y - origin.y) > 1e-9
            ? Math.atan2(target.y - origin.y, target.x - origin.x)
            : unit.facingRadians;
        //  扇形内的敌人，按距离由近到远取前 `maxTargets` 个。
        //  设计写的是「最多 N 名」，不是「全部」—— 一条 150 半径的扇形扫到十个怪时
        //  只能打前 N 个，否则多目标递减 / 人数上限这两条设计约束都不成立。
        const inFan: { unit: ZCUnitState; distance: number }[] = [];
        for (const candidate of state.units) {
            if (candidate.owner === unit.owner || candidate.battleState === 'dead' || candidate.hp <= 0) continue;
            const pos = context.unitPosition(candidate);
            const dx = pos.x - origin.x, dy = pos.y - origin.y;
            const distance = Math.hypot(dx, dy);
            if (distance > radius) continue;
            //  贴脸（距离≈0）时方向没有意义，直接算命中，否则近战会「站在身上打不到」。
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
        //  伤害与扇形 / 光环一致取**一份**：暴击与克制按「扇形里最近的那个」算一次。
        const primary = victims[0].unit;
        const criticalMultiplier = this.criticalMultiplier(unit, context);
        const counterMultiplier = this.counterMultiplierFor(
            unit, primary.owner, primary.unitId, context, primary.id);
        const damage = Math.round(this.unitDamage(context, unit, primary.owner, primary.unitId,
            damageRate, primary.id) * criticalMultiplier);
        const floatTextKind = damageFloatTextKind(criticalMultiplier > 1, counterMultiplier);
        //  表现：设计案 O 列「普攻爆炸沿扇形展开」—— 铺 `ZC_FAN_SWEEP_BURSTS` 发在扇形里，
        //  尺寸复用 `zcBurstEffectScale`（同一个 prefab、同一套反算），不新写一份。
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
                radius: burstTable * context.rules.combatDistanceScale,
                //  纯表现事件：伤害已经由下面的 `damageUnit` 结算，视图不读这个字段。
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
            this.applyLifesteal(unit, hitText, context);
            context.tryExecuteUnit(victim, undefined, unit.owner, unit.id, hitText);
            if (slowStatusId) context.applyHitStatus(victim, slowStatusId, unit.id);
        }
        if (zcSkillCastWatched(unit.unitId)) {
            skillCastLogChanging(`fan-cast:${unit.id}`, '施法',
                `${unit.unitId}#${unit.id} 甩出【${profile.name}】：倍率 ${damageRate}、`
                + `${fanDeg}° / 半径 ${radiusTable} 表值 px（世界 ${radius.toFixed(1)}）、`
                + `命中 ${victims.length}/${inFan.length} 人（上限 ${maxTargets}）、单发 ${damage}、`
                + `减速 ${slowStatusId ?? '无'}`);
        }
        return true;
    }

    /**
     * 冲锋：沿「起冲点 → 落点」这条线段撞人（2026-11-17 第 15 批）。
     *
     * 三条技能共用：菌盾冲锋 101204（`charge_shield`）、冲锋 102303 / 尖刺冲锋 102703
     * （`legacy_dash`）。差异全在参数里，所以这里只有一个入口。
     *
     * 为什么不能复用既有四条命中集合：
     *  · `strikeTargets` / `castBurstSkill` —— 只认「圆形半径内」，表达不了「一整条线」；
     *  · `castFanSweep` —— 只认扇形，而冲锋的覆盖面是「这条线段周围 `hitRadius` 的胶囊」；
     *  · `castFanSkill`（副轨）—— 同样是扇形。
     * 冲锋的判定必须是**点到线段的距离**，否则「从两个怪中间穿过去」会一个都不中，
     * 而「站在起点旁边的怪」会白吃两下。
     *
     * 位移本身不在这里做：`blinkTo` 只在触发侧的上下文里接线（与 `applyBlinkStrike` /
     * `applySingleStrike` 同侧），本方法只负责「线段上撞到了谁、各挨多少」以及落地后的自保。
     *
     * 与两条「打一个」的车道的关键区别：**命中 0 人也要消费 CD**（人已经冲出去了），
     * 落地自保（护盾 / 减伤）也**不判命中**（设计案：「并为自己附加护盾」「冲锋结束后自身
     * 受到伤害降低 25%」—— 都是无条件生效）。所以返回值只用于诊断日志。
     *
     * 伤害与扇形 / 光环 / 爆发一致取**一份**：暴击与克制按「路径上最近的那个」算一次，
     * 被撞到的所有人吃同一个数（项目内 AoE 一律单值）。
     *
     * @returns 撞到的人数（0 也照常消费 CD，见上）
     */
    static castChargeDash(state: ZCSnapshot, unit: ZCUnitState,
        context: IZCAttackResolutionContext, options: IZCChargeDashOptions): number {
        const { origin, destination } = options;
        const damageRate = Math.max(0, options.damageRate);
        const hitRadius = Math.max(0, options.hitRadius);
        if (!(damageRate > 0) || !(hitRadius > 0)) return 0;
        const profile = context.effectiveDefinition(unit).attackProfile;
        //  线段长度：起冲点与落点重合（被地形挡住 / 参数为 0）时退化成「原地这一个点」，
        //  仍然按胶囊算 —— 冲锋撞在原地也不是「什么都不发生」。
        const spanX = destination.x - origin.x;
        const spanY = destination.y - origin.y;
        const spanSquared = spanX * spanX + spanY * spanY;
        const distanceToSegment = (x: number, y: number): number => {
            if (spanSquared <= 1e-12) return Math.hypot(x - origin.x, y - origin.y);
            //  投影参数夹在 [0,1] 才是「线段」而不是「直线」：不夹的话，
            //  落点前方的怪会被算成撞到（它根本不在冲锋路径上）。
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
        //  自护盾 / 自减伤在「撞到人」之前就算好：它们不判命中，所以不能写在 victims 循环里。
        if (victims.length) {
            const primary = victims[0].unit;
            const criticalMultiplier = this.criticalMultiplier(unit, context);
            const counterMultiplier = this.counterMultiplierFor(
                unit, primary.owner, primary.unitId, context, primary.id);
            const damage = Math.round(this.unitDamage(context, unit, primary.owner, primary.unitId,
                damageRate, primary.id) * criticalMultiplier);
            const floatTextKind = damageFloatTextKind(criticalMultiplier > 1, counterMultiplier);
            for (const { unit: victim } of victims) {
                const hitText = context.damageUnit(victim, damage, {
                    owner: unit.owner, kind: 'unit', unitId: unit.id, floatTextKind,
                });
                this.applyLifesteal(unit, hitText, context);
                context.tryExecuteUnit(victim, undefined, unit.owner, unit.id, hitText);
                //  命中状态（眩晕 / 易伤）只挂活着的：被打死还挂状态会留下一条永远不生效的定义。
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
        //  落地自保：护盾复用 `applySelfShield`（取最大值 + 写 `shieldExpireAt`，到期由
        //  `ZCSkillTriggerSystem.expireShield` 清零），减伤状态由触发系统注册好传进来。
        if (shieldRatio > 0) this.applySelfShield(state, unit, shieldRatio, shieldSeconds);
        if (options.guardStatusId && (options.guardSeconds ?? 0) > 0) {
            context.statusSystem.apply(String(unit.id), options.guardStatusId,
                { at: state.elapsedSeconds, durationSeconds: options.guardSeconds });
            state.statusEffects = context.statusSystem.exportSnapshot();
            //  减伤没有现成的护盾光圈可借（它不是护盾）⇒ 按设计案 O 列在落点补一条
            //  `刀盾兵_护盾`。这条事件**纯表现**：半径与伤害都是 0，谁都不结算。
            state.combatEvents.push({
                id: state.nextCombatEventId++,
                type: ZCCombatEventType.Melee,
                owner: unit.owner,
                sourceUnitId: unit.id,
                targetUnitId: null,
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
     * 多点打击：在半径内挑最多 N 个目标各打一发，由技能触发系统按自己的 CD 调用。
     * 参数：count / radius / damageRate / nearest / splashRadius / splashDamageRate / statusId。
     * 返回实际命中个数；0 表示没有合法目标，调用方不要消费 CD。
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
            const distance = Math.hypot(pos.x - origin.x, pos.y - origin.y);
            if (distance > radius) continue;
            candidates.push({ unit: candidate, distance });
        }
        if (!candidates.length) return 0;
        if (options.nearest) candidates.sort((a, b) => a.distance - b.distance);
        else {
            //  Fisher-Yates：只洗前 `count` 个就够，用 `context.random` 保证回放可重演。
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
        const criticalMultiplier = this.criticalMultiplier(unit, context);

        //  ── 追踪导弹：挑到人就发「会飞过去的弹体」，不在这里立即扣血 ──
        //  需求 2026-11-03：「触发技能发射出 3 个技能特效，每个特效瞄准一个目标，
        //  特效呈弧线飞向目标（3 条不同的弧线），中途触碰到任意目标都会造成 1 次伤害并停止飞行，
        //  到达目标的坐标也会停止飞行，停止飞行后播放爆炸特效」。
        //  弹体直线飞向各自目标（碰撞扫掠天然覆盖"中途碰到谁"），弧线只作用在视觉上
        //  （`arcOffset` 由视图层施加），这样「直线扫掠碰撞」这条既有硬逻辑一行都不用改。
        if (options.missilePrefabPath) {
            let fired = 0;
            //  导弹优先用自己的速度；没登记才退回普攻弹速。
            const speed = options.missileSpeed ?? (profile.projectileSpeed || 500);
            //  ── 恒定发数（2026-11-05「不符合技能设计恒定是 3 个」）──
            //  配表 101003 三档 `strikeCount` 是 3/4/5，但技能口径是「每次恒定 3 颗」。
            //  钳在这里：这是唯一知道"最后推了几颗弹体"的地方，调用方只报一个上限。
            //  ⇒ 目标不足时仍然按实际数量发（不会对同一个目标补发凑数），多出来的绝不多发。
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
                //  三条不同的弧线：偏移量随下标错开（0 / ±arcOffset），方向也交替正负。
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
                    //  打空续飞（2026-11-09）：寿命取「目标距离 + `ZC_PROJECTILE_MISS_DISTANCE`」，
                    //  没命中就沿这条方向飞完再消失，不再在目标的落点上凭空截断。
                    durationSeconds: ZCCombatSystem.attackTravelSeconds(
                        ZCCombatEventType.Projectile, length, speed, ZC_PROJECTILE_MISS_DISTANCE),
                    targetKind: 'unit',
                    targetId: victim.id,
                    sourceCardId: unit.cardId,
                    baseDamage: this.unitDamage(context, unit, victim.owner, victim.cardId,
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
                    //  命中挂状态（2026-11-17 第 12 批「孢子凝珠」101104）：
                    //  这条分支此前只把 `statusId` 用在立即结算那一路（见下面 `applyHitStatus`），
                    //  导弹/弹道分支一直没人接 —— 于是「会飞的技能挂减速」永远不生效。
                    //  `resolveProjectileHit` 早就读 `projectile.onHitStatusId`（直击与旁溅都挂），
                    //  这里只是把参数接上去。缺省 undefined ⇒ 存量弹道逐字不变。
                    onHitStatusId: options.statusId,
                });
                fired += 1;
            }
            //  诊断3.：弹体真的推进 `state.projectiles` 了吗（视图侧只认这个队列）。
            missileLog('模型', `导弹分支已推进 ${fired} 个弹体`
                + `（候选 ${candidates.length} / 本次上限 ${volley.length}，`
                + `配表 count=${count}，恒定发数=${options.missileCount ?? '未登记'}，`
                + `弧线偏移基准 ${(options.arcOffset ?? 0).toFixed(1)}，速度 ${speed}）`);
            return fired;
        }

        let hits = 0;
        for (const { unit: victim } of victims) {
            const targetOwner = victim.owner;
            const damage = Math.round(this.unitDamage(context, unit, targetOwner, victim.cardId,
                options.damageRate, victim.id) * criticalMultiplier);
            const counterMultiplier = this.counterMultiplierFor(
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
                //  表现沿用本卡普攻的特效预制（专属特效尚未制作）；坐标落在被打的那个目标身上，
                //  所以「落点」是对的，只是图不是专属的。
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
            this.applyLifesteal(unit, hitText, context);
            context.tryExecuteUnit(victim, undefined, unit.owner, unit.id, hitText);
            if (options.statusId) context.applyHitStatus(victim, options.statusId, unit.id);
            if (!(splashRadius > 0) || !(splashRate > 0)) continue;
            //  多目标递减（2026-11-14）：旁溅目标按距离由近到远排序，第 n 个再乘 `(1-falloff)^n`。
            //  `splashFalloff` 缺省 0 ⇒ 全部同额，存量溅射逐字不变。
            const bystanders: { unit: ZCUnitState; distance: number }[] = [];
            for (const bystander of state.units) {
                if (bystander === victim || bystander.owner === unit.owner) continue;
                if (bystander.battleState === 'dead' || bystander.hp <= 0) continue;
                const pos = context.unitPosition(bystander);
                const distance = Math.hypot(pos.x - point.x, pos.y - point.y);
                if (distance > splashRadius) continue;
                bystanders.push({ unit: bystander, distance });
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

    static ensureMoveSpeedStatus(context: IZCAttackResolutionContext, id: string,
        moveSpeedPct: number, durationSeconds: number): void {
        if (context.statusSystem.hasDef(id)) return;
        context.statusSystem.register({
            id, name: id, durationSeconds, refreshPolicy: 'refresh',
            statMods: { moveSpeedPct }, behavior: { kind: 'none' },
        });
    }

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

    static applyShieldAura(state: ZCSnapshot, source: ZCUnitState, ratio: number): void {
        const normalized = Math.max(0, Math.min(5, ratio));
        for (const ally of state.units) {
            if (ally.owner !== source.owner || ally.battleState === 'dead') continue;
            ally.shield = Math.max(ally.shield ?? 0, ally.maxHp * normalized);
        }
    }

    /**
     * 只给施法者自己套盾，并登记到期时刻（2026-10-29，亡者护盾）。
     *
     * 与 `applyShieldAura` 分开：那个是「全队光环盾」，这个是单体且会过期。
     * `seconds <= 0` ⇒ 不写 `shieldExpireAt`，等价于永不过期（与旧护盾语义一致）。
    */
    static applySelfShield(state: ZCSnapshot, source: ZCUnitState, ratio: number, seconds: number): void {
        const normalized = Math.max(0, Math.min(5, ratio));
        if (normalized <= 0) return;
        source.shield = Math.max(source.shield ?? 0, source.maxHp * normalized);
        if (seconds > 0) source.shieldExpireAt = state.elapsedSeconds + seconds;
    }

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

    static applyBannerBuff(state: ZCSnapshot, owner: ZCOwner, rawCount: number,
        rawRate: number, context: IZCAttackResolutionContext): void {
        const id = this.ensureBannerStatus(context, rawRate);
        const candidates = state.units
            .filter((unit) => unit.owner === owner && unit.battleState !== 'dead')
            .sort((a, b) => a.id - b.id);
        const count = Math.min(candidates.length, Math.max(0, Math.round(rawCount)));
        for (let index = 0; index < count; index += 1) {
            const pick = Math.min(candidates.length - 1, Math.floor(context.random() * candidates.length));
            const target = candidates.splice(pick, 1)[0];
            context.statusSystem.apply(String(target.id), id, { at: state.elapsedSeconds, durationSeconds: 4 });
        }
        state.statusEffects = context.statusSystem.exportSnapshot();
    }

    /**
     * 命中挂状态的节拍：`statusEveryNAttacks = N` 时每 N 次普攻命中挂一次。
     * 用 `completedAttackCount` 判断（出手时先自增），缺省/非法值按每次挂处理。
    */
    private static hitStatusOnBeat(
        runtime: ZCSkillRuntimeDefinition | undefined,
        unit: ZCUnitState,
    ): boolean {
        const every = runtime?.parameters.statusEveryNAttacks ?? 0;
        if (!(every > 0)) return true;
        const count = unit.completedAttackCount ?? 0;
        return count > 0 && count % every === 0;
    }

    static sendAttack(state: ZCSnapshot, unit: ZCUnitState, context: IZCAttackResolutionContext): void {
        const attack = this.prepareAttack(state, unit, context);
        if (!attack) return;
        const { empowered, skillRuntime, activeProfile, event, damage, onHitStatusId, legacyTargetBuffs, floatTextKind } = attack;
        const parameters = skillRuntime?.parameters;
        if (empowered && parameters && parameters.shieldRatio > 0) {
            this.applyShieldAura(state, unit, parameters.shieldRatio);
        }
        if (empowered && parameters && parameters.moveSpeedBoost > 0) {
            this.applyMoveSpeedAura(state, unit.owner, parameters.moveSpeedBoost, 5, context);
        }
        if (empowered && parameters && parameters.bannerTargetCount > 0
            && parameters.bannerCritRate > 0) {
            this.applyBannerBuff(state, unit.owner, parameters.bannerTargetCount, parameters.bannerCritRate, context);
        }
        if (empowered && parameters && parameters.directionCount > 1) {
            this.resolveRadialSkill(state, unit, event, damage, parameters.directionCount,
                onHitStatusId, legacyTargetBuffs, floatTextKind, context);
            return;
        }
        //  单体护盾（亡者护盾）：只罩自己、且带到期时刻。与上面的 `shieldRatio`（全队光环盾）
        //  是两个互不影响的参数，缺省 0 ⇒ 整段不执行。
        if (empowered && parameters && parameters.selfShieldRatio > 0) {
            this.applySelfShield(state, unit, parameters.selfShieldRatio, parameters.shieldSeconds ?? 0);
        }
        //  连发（豌豆机关枪）：empowered 这一击只打第一颗，余下的按固定间隔排进单位状态，
        //  由 `ZCSkillTriggerSystem` 每步推进。`burstCount` 缺省 1 ⇒ 整段不执行，
        //  原有的「一发 / 多发齐射」路径逐字不变。
        const burstCount = empowered ? Math.max(1, Math.round(parameters?.burstCount ?? 1)) : 1;
        if (burstCount > 1 && activeProfile.mode === ZCCombatEventType.Projectile) {
            const burstSeconds = Math.max(0.05, parameters?.burstSeconds ?? 1.2);
            unit.burstShotsLeft = burstCount - 1;
            unit.burstInterval = Math.max(0.01, burstSeconds / Math.max(1, burstCount - 1));
            unit.burstNextAt = state.elapsedSeconds + unit.burstInterval;
            unit.burstDamageRate = parameters?.damageRate ?? activeProfile.damageRate ?? 1;
            attack.projectileCount = 1;
        }
        if (activeProfile.mode === 'projectile') {
            this.createAttackProjectiles(state, unit, attack, context);
        } else if ((activeProfile.durationSeconds ?? 0) > 0 && attack.effectiveAreaRadius > 0) {
            this.createAttackGroundZones(state, unit, attack, context);
        } else {
            this.resolveImmediateAttack(state, unit, attack, context);
        }
    }

    private static prepareAttack(state: ZCSnapshot, unit: ZCUnitState, context: IZCAttackResolutionContext): IZCPreparedAttack | null {
        unit.attackHitDone = true;
        const rawTarget = context.currentTarget(unit);
        if (!rawTarget) return null;
        // `currentTarget` 返回的是每单位复用的 scratch；prepared attack 会跨后续结算/弹道使用，
        // 必须先拍成独立快照，否则同单位下一拍索敌会把这里的目标改掉。
        const target: ZCCombatTarget = {
            kind: rawTarget.kind, id: rawTarget.id, x: rawTarget.x, y: rawTarget.y,
            bodyRadius: rawTarget.bodyRadius, cardId: rawTarget.cardId,
        };
        const definition = context.effectiveDefinition(unit);
        const patch = this.unitStatPatchOf(unit, context);
        const profile = definition.attackProfile;
        const empowered = ZCCombatSystem.consumeEmpoweredAttack(unit, profile, state.elapsedSeconds);
        const skillRuntime = this.skillRuntimeFor(unit, context).get(`${unit.unitId}:${profile.skillId}`);
        //  投枪（`破阵投枪`）：每 N 次普攻把本次攻击替换成一枚远程穿透弹。
        //  与「强化那一击」互斥（撞拍时强化优先），详见 `lanceBeatOf`。
        const lance = this.lanceBeatOf(unit, skillRuntime, empowered);
        //  「这一击固定发几颗」的显式声明（`skillParamJson.projectileCount`，只服务强化那一击）。
        //  与 `bulletNum`（普攻被动「多打 N 发」）是两种语义，必须分开记：
        //  麻辣铁锅 102601 给 `bulletNum +2`、102604 要求「凤凰降临固定 4 颗」，
        //  两者叠在一起会变成 6 颗。所以声明了固定颗数时不再叠加 `bulletNum`。
        //   现有计划行一条都没用过这个键（全表 grep 无命中）⇒ 存量单位行为逐字不变。
        const declaredProjectileCount = empowered
            ? Math.max(0, Math.round(skillRuntime?.parameters.projectileCount ?? 0))
            : 0;
        let projectileCount = declaredProjectileCount > 0 ? declaredProjectileCount : 1;
        const criticalMultiplier = this.criticalMultiplier(unit, context);
        //  unit 域伤害倍率（`pvpSkillPlan.statId = damageRate`）：弹道走 `unitDamageBase`、
        //  近战/区域走本类的 `unitDamage`，两处各自乘以同一个系数，口径一致。缺省 0 ⇒ 1。
        const damageRateMultiplier = Math.max(0, 1 + (patch.damageRatePct ?? 0) / 100);
        // 技能伤害倍率：强化那一击读武将技行（36xxx）的 `damageRate`，普通普攻读普攻行（301xx）的。
        // 两行各带自己的倍率（表里普攻行一律留空 = 1），所以这里按 `empowered` 二选一；
        // 技能行是 `empoweredSkillId` 指过去的独立 profile，`definition.empoweredProfile` 就是它。
        // 「本次生效 profile」：强化那一击的表现层（mode / 弹道速度 / 半径 / 碰撞半径）一律取
        // 武将技行（36xxx），不再沿用普攻行（301xx）。否则冰法师普攻是 projectile、武将技冰雕
        // 是 area，强化触发时会把冰雕当成投射物从法师位置飞到目标点 —— 冰雕应在目标点就地生成。
        const activeProfile = lance
            ? this.lanceProfileOf(profile, skillRuntime)
            : ((empowered && definition.empoweredProfile) ? definition.empoweredProfile : profile);
        //  命中挂状态的节拍闸门（2026-10-30 火焰树妖「点燃」：每 3 次普攻的第 3 次才附带）。
        //  闸门盖住的是「本次出手挂不挂状态」整件事，所以 `skillRuntime.statusId`（计划行声明）
        //  与 `activeProfile.onHitStatusId`（普攻行自带）同进同出 —— 老表两者互斥使用，
        //  不存在「一个被节拍管、另一个不管」的组合。
        //  没配 `statusEveryNAttacks`（缺省 0）时恒为 true，所有既有表数据行为与改动前逐字一致。
        const onHitStatusId = this.hitStatusOnBeat(skillRuntime, unit)
            ? (skillRuntime?.statusId ?? activeProfile.onHitStatusId)
            : undefined;
        const skillDamageRate = (empowered
            ? (skillRuntime?.parameters.impactDamageRate
                ?? skillRuntime?.parameters.damageRate
                ?? definition.empoweredProfile?.damageRate)
            : profile.damageRate) ?? 1;
        const legacy = context.evaluateLegacySkill(unit, activeProfile.legacyEffectKeys ?? [], target, criticalMultiplier > 1);
        // Old Client applies traction to the caster when the attack/bullet is created; it is an
        // aura, not an on-hit debuff on the struck target. Keep it out of projectile hit payloads.
        const legacyTargetBuffs = context.applyLegacySelfBuffs(unit, legacy.buffs);
        const legacyHitCount = legacy.hitCount ?? 0;
        if (legacyHitCount > 0) projectileCount = Math.max(projectileCount, Math.round(legacyHitCount));
        //  `pvpAttrMap.bulletNum`（2026-10-13）：正数 = 多打几发，负数 = 少几发，下限 1。
        //  用「增量」而非「绝对值」，才能与技能表原有的 projectileCount / hitCount 叠加。
        //  「显式固定颗数」的那一击不叠（见上面 `declaredProjectileCount` 的注释）。
        const bulletNumExtra = (patch.bulletNumFlat && declaredProjectileCount <= 0)
            ? Math.max(0, Math.round(patch.bulletNumFlat))
            : 0;
        if (bulletNumExtra > 0) {
            projectileCount = Math.max(1, Math.round(projectileCount + bulletNumExtra));
        }
        //  投枪是「一枚」枪：不吃 `bulletNum` 的多发叠加，也不会被旧 skillEffect 的 hitCount 撑成多发。
        if (lance) projectileCount = 1;
        //  普攻「多打 N 发」的**多目标递减**（2026-11-14 用户口径：普通攻击带来的穿透类 /
        //  分裂子弹 / 溅射都必须递减，初值低于普攻，形成大面积但数值不大的效果）。
        //  第 1 颗是普攻本体（仍是 100%，它就是普攻），第 2 颗起每颗 ×(1 - bulletFalloff)：
        //  `bulletFalloff = 0.4` ⇒ 100% / 60% / 36% / 21.6%（满档 +2 发总额 196%，原 300%）。
        //  缺省 0 ⇒ 每颗同额，没配这个键的卡（含全部强化那一击）行为逐字不变。
        const bulletFalloff = Math.max(0, Math.min(1, skillRuntime?.parameters.bulletFalloff ?? 0));
        const baseProjectileCount = Math.max(1, projectileCount - bulletNumExtra);
        const counterMultiplier = this.counterMultiplierFor(
            unit, this.targetOwner(state, target, context), target.cardId, context,
            target.kind === 'unit' ? target.id : undefined);
        const criticalHit = criticalMultiplier > 1;
        const floatTextKind = damageFloatTextKind(criticalHit, counterMultiplier);
        //  投枪的「首目标 70%」：设计口径是相对面板的倍率，不是相对普攻伤害的折扣 ——
        //  与 `damageRate` / `impactDamageRate` 同一条乘法链，所以直接乘进 `skillDamageRate`。
        const lanceDamageRate = lance
            ? Math.max(0, skillRuntime?.parameters.lanceDamageRate ?? ZC_LANCE_DEFAULT_DAMAGE_RATE)
            : 1;
        //  投枪固定走面板伤害，不认旧 skillEffect 的伤害公式（那是近战挥击的算法，套在枪上会跑偏）。
        const damage = legacy.hasDamageFormula && !lance
            ? Math.round(legacy.damage * criticalMultiplier * counterMultiplier)
            : Math.round(this.unitDamage(context, unit, this.targetOwner(state, target, context), target.cardId,
                skillDamageRate * lanceDamageRate,
                target.kind === 'unit' ? target.id : undefined) * criticalMultiplier);
        const legacyAreaRadius = Math.max(0, legacy.range ?? 0) * context.rules.combatDistanceScale;
        const effectiveAreaRadius = legacyAreaRadius > 0
            ? legacyAreaRadius
            : (activeProfile.areaRadius || 0) * context.rules.combatDistanceScale;
        const from = context.unitPosition(unit);
        //  事件寿命（纯表现）：登记了飞行段的近战特效按「距离 / 速度」算，
        //  否则沿用固定 0.32s。伤害不在这里结算 —— 见下面 `state.combatEvents.push(event)`
        //  之后紧接着的 `context.damageUnit(...)`，所以改它不影响任何数值。
        //  需求 2026-11-02「猎头者的攻击特效需要匹配射程」（`ZCCombatEffectFlight`）。
        const travelSeconds = zcCombatEffectTravelSeconds(
            activeProfile.mode,
            distance(from.x, from.y, target.x, target.y),
            activeProfile.projectileSpeed,
            activeProfile.effectPrefabPath,
        );
        const event: ZCCombatEvent = {
            id: state.nextCombatEventId++,
            type: activeProfile.mode,
            owner: unit.owner,
            sourceUnitId: unit.id,
            targetUnitId: target.kind === 'unit' ? target.id : null,
            skillId: empowered && profile.empoweredSkillId ? profile.empoweredSkillId : profile.skillId,
            skillName: empowered ? `${profile.name}·强化` : (lance ? `${profile.name}·投枪` : profile.name),
            effectKey: activeProfile.effectKey ?? profile.effectKey ?? null,
            projectileKey: activeProfile.projectileKey ?? profile.projectileKey ?? null,
            // 强化那一击改用技能行（36000 段）的特效；技能行没配路径时回落普攻特效。
            effectPrefabPath: (empowered && definition.empoweredProfile?.effectPrefabPath)
                || (lance ? activeProfile.effectPrefabPath : undefined)
                || profile.effectPrefabPath || null,
            fromX: from.x,
            fromY: from.y,
            toX: target.x,
            toY: target.y,
            radius: effectiveAreaRadius,
            damage,
            empowered,
            startedAt: state.elapsedSeconds,
            durationSeconds: travelSeconds,
        };
        //  镭射死光（30845）：表现终点沿目标方向 18 格（756 逻辑单位），
        //  弹道寿命也按 18 格 / 速度 算，确保射线穿透所有敌人并飞到屏幕外。
        const LASER_DEATH_RANGE = 18 * 42;
        if (profile.skillId === 30845) {
            const dx = target.x - from.x;
            const dy = target.y - from.y;
            const len = Math.hypot(dx, dy);
            const nx = len > 0 ? dx / len : Math.cos(unit.facingRadians);
            const ny = len > 0 ? dy / len : Math.sin(unit.facingRadians);
            event.toX = from.x + nx * LASER_DEATH_RANGE;
            event.toY = from.y + ny * LASER_DEATH_RANGE;
            event.durationSeconds = LASER_DEATH_RANGE / (activeProfile.projectileSpeed || 500);
        }
        return { target, definition, patch, activeProfile, empowered, lance, skillRuntime, projectileCount, bulletNumExtra, bulletFalloff, baseProjectileCount, criticalMultiplier, damageRateMultiplier, skillDamageRate, lanceDamageRate, legacy, legacyTargetBuffs, criticalHit, floatTextKind, damage, legacyAreaRadius, effectiveAreaRadius, from, event, onHitStatusId };
    }

    private static createAttackProjectiles(
        state: ZCSnapshot, unit: ZCUnitState, attack: IZCPreparedAttack, context: IZCAttackResolutionContext,
    ): void {
        const { target, definition, patch, activeProfile, empowered, lance, skillRuntime, projectileCount,
            bulletFalloff, baseProjectileCount, lanceDamageRate,
            criticalMultiplier, damageRateMultiplier, skillDamageRate, legacy, legacyTargetBuffs,
            criticalHit, onHitStatusId, legacyAreaRadius, from, event } = attack;
        const parameters = skillRuntime?.parameters;
        const dx = target.x - from.x, dy = target.y - from.y;
        const length = Math.hypot(dx, dy);
        const speed = activeProfile.projectileSpeed || 500;
        //  固定弹道寿命（2026-11-09 大威芦「天降神拳」102504：子弹 100px/s、持续 4 秒）。
        //  `event.durationSeconds` 对 projectile 恒为「距离 / 速度」——射程跟着目标远近变，
        //  表达不了「不管打多远都飞 4 秒」。这里让 `skillParamJson.projectileLifeSeconds`
        //  直接接管寿命：位移 = 速度 × 寿命，与目标站位无关。
        //  缺省/0 ⇒ 沿用 `travelSeconds`，既有弹道（含镭射死光自己那条 18 格硬编码）逐字不变。
        //   必须 `empowered` 才读：技能计划行是按 `unitId:pvpSkillId` 合并的，102504 的
        //  `skillParamJson` 和本卡普攻共用同一份 runtime —— 不设闸门的话，普攻那一发也会
        //  被改成 4 秒寿命（与 `pierceCount` 同一个理由，两者都只服务「强化那一击」）。
        const lifeSeconds = empowered
            ? Math.max(0, parameters?.projectileLifeSeconds ?? 0)
            : 0;
        //  打空续飞（2026-11-09）：`event.durationSeconds` 是「到目标的飞行时长」，
        //  再加一段「飞过目标也不消失」的余程 —— 命中即消耗，所以这段只在没打中时走。
        //  `projectileLifeSeconds`（固定寿命的技能）仍然优先，不受这条影响。
        const projectileSeconds = lifeSeconds > 0
            ? lifeSeconds
            : event.durationSeconds + ZC_PROJECTILE_MISS_DISTANCE / speed;
        const bonuses = context.deckBonuses[unit.owner];
        //  弹体体积倍率（`bulletSizeScale`，2026-11-17 磁电菇「巨囊弹体」101602）：
        //  视觉与命中判定同比放大。只作用于普攻/投枪这条链路 —— 主动技能的导弹
        //  （`strikeTargets` 的导弹分支）不读它，设计口径写的是「普攻弹体」。
        const bulletSizeScale = zcBulletSizeScale(patch.bulletSizeScale);
        //  穿过己方单位回血（2026-11-17 急冻瓜「贯穿滋养」102401）：
        //  `allyPierceHealPct` 是单次回复比例（0.03 = 该单位最大生命的 3%），
        //  `allyPierceMaxCount` 是**每颗弹道**的额度（3 / 4 / 5）。
        //  两个键缺省 0 ⇒ 不往弹道上挂这两个字段，友军对这条弹道完全透明（存量逐字不变）。
        //  🔴 额度拷到 `allyHealLeft` 而不是每次回查参数：多弹幕的每一颗要各自计数，
        //  共享一个参数值会变成「整轮齐射共享 5 次」。
        const allyHealPct = Math.max(0, Math.min(1, parameters?.allyPierceHealPct ?? 0));
        const allyHealMaxCount = Math.max(0, Math.round(parameters?.allyPierceMaxCount ?? 0));
        const allyHeal = allyHealPct > 0 && allyHealMaxCount > 0
            ? { allyHealPct, allyHealLeft: allyHealMaxCount }
            : {};
        //  命中后爆炸（2026-11-11 麻辣铁锅「凤凰降临」102604）。
        //
        //  与 `splashRadius` / `splashDamageRate` 是两件事，不能复用那一对：
        //    · 溅射不打主目标，而且只在 `!empowered` 时读（见下面 push 里的三元）；
        //    · 爆炸要把包括主目标在内的所有人各打一次，并且强度只在强化那一击出现。
        //  所以另开一组 `impactBurst*` 键，缺省全 0 ⇒ 整段不执行，任何存量弹道逐字不变。
        //
        //  伤害基数按 `unitDamageBase` 算（不含克制）：克制系数是逐个受击者算的，
        //  存进弹道里的必须是一个中性值，否则带主目标的克制关系去炸别人就会算错。
        //  与 `baseDamage` / `splashDamage` 同一条口径。
        const burstRadius = (empowered ? Math.max(0, parameters?.impactBurstRadius ?? 0) : 0)
            * context.rules.combatDistanceScale;
        const burstRate = empowered ? Math.max(0, parameters?.impactBurstDamageRate ?? 0) : 0;
        const burstBase = burstRadius > 0 && burstRate > 0
            ? ZCCombatSystem.unitDamageBase(unit, definition, bonuses, context.rules, burstRate)
                * (unit.attackMultiplier ?? 1) * criticalMultiplier
            : 0;
        const burstSecondRate = empowered ? Math.max(0, parameters?.impactBurstSecondRate ?? 0) : 0;
        const burstSecondBase = burstRadius > 0 && burstSecondRate > 0
            ? ZCCombatSystem.unitDamageBase(unit, definition, bonuses, context.rules, burstSecondRate)
                * (unit.attackMultiplier ?? 1) * criticalMultiplier
            : 0;
        //  第二段的时间锚点：设计案「爆炸开始后第 26 帧」@30fps ⇒ 25/30 = 0.8333s。
        //  第 N 帧（1 起数）= 下标 N-1，与 `ZCBoltStrikeFx` 的「第 5 帧 ⇒ 4/30」同一条换算。
        const burstSecondDelay = Math.max(0, parameters?.impactBurstSecondDelay ?? 0);
        const burstEffectSeconds = Math.max(0, parameters?.impactBurstEffectSeconds ?? 0);
        const burstImpactPrefab = empowered ? (activeProfile.impactEffectPrefabPath ?? null) : null;
        for (let index = 0; index < projectileCount; index += 1) {
            const projectileEvent = index === 0 ? event : { ...event, id: state.nextCombatEventId++ };
            //  多发扇形展开：只有 `bulletAngle > 0` 时才转方向，缺省仍是全部打同一条直线
            //  （老技能没有任何表数据，行为必须逐字不变）。
            //  `projectileSpreadDeg`（2026-11-11 麻辣铁锅「凤凰降临」102604）是强化那一击专用的
            //  张角覆盖：`bulletAngle` 是 unit 域的修改器（`patch.bulletAngleFlat`），同一张卡的
            //  普攻与强化击共用一份，而 102601 要求普攻 20°、102604 要求 4 颗 90° —— 一个槽装不下。
            //  取「强化 + 配了就用它、否则退回 patch」：既有技能一条都没有这个键，行为逐字不变。
            const spreadTable = (empowered ? Math.max(0, parameters?.projectileSpreadDeg ?? 0) : 0)
                || (patch.bulletAngleFlat ?? 0);
            //  两种张角语义（2026-11-11 第三轮，麻辣铁锅「凤凰降临」）：
            //    · < 360 ⇒ 扇形：整组子弹摊在 `spreadTable` 这段张角里，第 0 颗偏 -一半、
            //      最后一颗偏 +一半（20° 三连发的既有口径，别动）；
            //    · ≥ 360 ⇒ 全向均分：等于「向四周各打一发」，相邻两颗差 `360/count`，
            //      第 0 颗仍对准目标。用户口径「4 颗子弹的 4 个方向」= 图例里那四个箭头（十字）。
            //  扇形那套算不出十字：count=4 时 spread 是 -1/-⅓/+⅓/+1，张角 360 会让
            //  首尾两颗都朝背后（-180 与 +180 同向）⇒ 实际只有 3 个方向。必须单独一条分支。
            const fullCircle = spreadTable >= 359.999 && projectileCount > 1;
            const halfSpan = spreadTable > 0 && projectileCount > 1 && !fullCircle
                ? (spreadTable * Math.PI / 180) / 2
                : 0;
            const spread = projectileCount > 1 ? (index / (projectileCount - 1)) * 2 - 1 : 0;
            const aim = length > 0 ? Math.atan2(dy, dx) : unit.facingRadians;
            const heading = fullCircle
                ? aim + index * (Math.PI * 2 / projectileCount)
                : aim + spread * halfSpan;
            const dirX = length > 0 || halfSpan > 0 || fullCircle ? Math.cos(heading) : Math.cos(unit.facingRadians);
            const dirY = length > 0 || halfSpan > 0 || fullCircle ? Math.sin(heading) : Math.sin(unit.facingRadians);
            //   每颗弹道自己的终点（2026-11-11 第五轮用户口径：「1 号朝向对，2 号顺时针 90、
            //  3 号 180、4 号 270」）。事件里的 `to` 是所有弹共用的目标点，而视图
            //  （`ZCCombatEffectView` 的 projectile 分支）是拿 `to - from` 算转角的 ⇒ 四颗弹体
            //  全部朝同一个方向 —— 飞出去的四颗里只有「正好落在瞄准线上」的那颗看着对，
            //  其余三颗是「侧着飞」。所以这里按各弹自己的 `heading` 把 `to` 沿该方向摊开，
            //  长度保持 `length` 不变 ⇒ `aimFlightSeconds`（弧线进度）与打空续飞都不受影响。
            //  只在真的散开时改（`halfSpan > 0 || fullCircle`），单发弹道逐字不动。
            const fanned = length > 0 && (halfSpan > 0 || fullCircle);
            const bulletToX = fanned ? from.x + dirX * length : projectileEvent.toX;
            const bulletToY = fanned ? from.y + dirY * length : projectileEvent.toY;
            //  多弹递减（见 `zcBulletDamageScale` 注释）：`baseProjectileCount` 之后的那几颗
            //  才是「多打」出来的额外弹体，第 n 颗额外弹乘 `(1 - bulletFalloff)^n`。
            //  `bulletFalloff = 0`（缺省）时恒为 1。
            const bulletScale = zcBulletDamageScale(index, baseProjectileCount, bulletFalloff);
            state.projectiles.push({
                ...projectileEvent, type: 'projectile', targetKind: target.kind, targetId: target.id,
                sourceCardId: unit.cardId,
                toX: bulletToX,
                toY: bulletToY,
                //  投枪的首目标折算（`lanceDamageRate`）也必须进这条链：这一发是纯伤害弹，
                //  没有再走 `unitDamage` 的机会。
                baseDamage: (legacy.hasDamageFormula && !lance
                    ? legacy.damage * criticalMultiplier
                    : ZCCombatSystem.unitDamageBase(unit, definition, bonuses, context.rules,
                        skillDamageRate * damageRateMultiplier * lanceDamageRate)
                        * (unit.attackMultiplier ?? 1) * criticalMultiplier) * bulletScale,
                x: from.x, y: from.y, previousX: from.x, previousY: from.y,
                velocityX: dirX * speed,
                velocityY: dirY * speed,
                //  寿命：`projectileLifeSeconds` 有值时固定、否则沿用 travelSeconds（见上）。
                durationSeconds: projectileSeconds,
                collisionRadius: (activeProfile.collisionRadius ?? 3)
                    * context.rules.combatDistanceScale * bulletSizeScale,
                //  视图侧的体积倍率：`ZCCombatEffectView.render` 乘进宿主节点缩放。
                //  没有这个键（= 1）时视图一行都不改，存量弹道逐字不变。
                sizeScale: bulletSizeScale,
                //  穿过己方单位回血的两个字段（缺省时为 `{}` ⇒ 对象上不出现这两个键）。
                ...allyHeal,
                canHitAir: definition.canAttackAir,
                // 投射物命中后在落点创建持续区域（火船/风龙：飞过去命中后才烧）
                zoneDuration: activeProfile.durationSeconds ?? 0,
                zoneWaves: Math.max(1, activeProfile.waves ?? 1),
                zoneSlow: activeProfile.slowRatio ?? 0,
                zoneDamage: empowered && skillRuntime?.parameters.explosionDamageRate != null
                    ? this.unitDamage(context, unit, this.targetOwner(state, target, context), target.cardId,
                        skillRuntime.parameters.explosionDamageRate,
                        target.kind === 'unit' ? target.id : undefined) * criticalMultiplier
                    : undefined,
                remainingPierces: lance
                    //  投枪：`lancePierceCount` 是**目标总数**（含首目标），所以剩余穿透 = N − 1。
                    //  与上面 `pierceCount`（额外穿透次数）语义不同，别混用同一个键。
                    ? Math.max(0, Math.floor(
                        (skillRuntime?.parameters.lancePierceCount ?? ZC_LANCE_DEFAULT_PIERCE_COUNT) - 1))
                    : empowered
                    ? Math.max(0, Math.floor(skillRuntime?.parameters.pierceCount ?? 0))
                    //  普攻穿透（2026-10-30「穿甲苔刺」100701/100801/103501）：`pierceCount` 原本只服务
                    //  「强化那一击」，被动要求的是「每一次普攻都穿透」。用独立键 `normalPierceCount`
                    //  而不是放宽 `pierceCount`，是为了不动任何既有强化击的口径。
                    : Math.max(0, Math.floor(skillRuntime?.parameters.normalPierceCount ?? 0)),
                //  每次穿透后的伤害衰减（玉林好汉「精英猎手」：每穿一人 -20%）；
                //  缺省 0 = 不衰减，既有穿透弹道（火船等）行为逐字不变。
                pierceFalloff: lance
                    ? Math.max(0, Math.min(1,
                        skillRuntime?.parameters.lancePierceFalloff ?? ZC_LANCE_DEFAULT_PIERCE_FALLOFF))
                    : empowered
                    ? Math.max(0, Math.min(1, skillRuntime?.parameters.pierceFalloff ?? 0))
                    : Math.max(0, Math.min(1, skillRuntime?.parameters.normalPierceFalloff ?? 0)),
                hitUnitIds: [],
                executeChance: Math.max(0, Math.min(1,
                    (empowered ? skillRuntime?.parameters.executeChance : undefined)
                    ?? legacy.executeChance ?? 0)),
                criticalHit,
                onHitStatusId,
                legacyBuffs: [...legacyTargetBuffs],
                //  溅射（2026-10-30「爆囊扩散」100802/100902/103202）：旧 skillEffect 的伤害范围走
                //  `legacyAreaRadius`（全额溅射）；新被动走参数 `splashRadius`（屏上 px，与攻击距离
                //  同一套数，乘 `combatDistanceScale`）+ `splashDamageRate`（相对面板的倍率）。
                //  缺省都没有 ⇒ 整段不执行，存量弹道行为逐字不变。
                splashRadius: legacyAreaRadius > 0
                    ? legacyAreaRadius
                    : (empowered ? 0 : (skillRuntime?.parameters.splashRadius ?? 0) * context.rules.combatDistanceScale) || undefined,
                splashDamageRate: legacyAreaRadius > 0
                    ? undefined
                    : (empowered ? undefined : skillRuntime?.parameters.splashDamageRate),
                //  溅射的多目标递减（2026-11-14）：与 `splashDamageRate` 同一路传入，缺省不写。
                splashFalloff: legacyAreaRadius > 0
                    ? undefined
                    : (empowered ? undefined : skillRuntime?.parameters.splashFalloff),
                //  命中爆炸（见上面 `burstRadius` 那一段）。四项任一为 0 就不写，
                //  保持「没有这个键」= 存量弹道逐字不变。
                impactEffectPrefabPath: burstImpactPrefab,
                burstRadius: burstRadius > 0 ? burstRadius : undefined,
                burstDamage: burstBase > 0 ? burstBase : undefined,
                burstSecondDamage: burstSecondBase > 0 ? burstSecondBase : undefined,
                burstSecondDelay: burstSecondBase > 0 ? burstSecondDelay : undefined,
                burstEffectSeconds: burstEffectSeconds > 0 ? burstEffectSeconds : undefined,
            });
        }
    }

    private static createAttackGroundZones(
        state: ZCSnapshot, unit: ZCUnitState, attack: IZCPreparedAttack, context: IZCAttackResolutionContext,
    ): void {
        const { target, activeProfile, empowered, skillRuntime, criticalMultiplier, damage,
            floatTextKind, onHitStatusId, effectiveAreaRadius, from, event } = attack;
        const durationSeconds = activeProfile.durationSeconds ?? 0;
        const waves = Math.max(1, activeProfile.waves ?? 1);
        const slowRatio = empowered
            ? Math.max(0, Math.min(1, skillRuntime?.parameters.slowRatio ?? activeProfile.slowRatio ?? 0))
            : activeProfile.slowRatio ?? 0;
        const areaRadius = effectiveAreaRadius;

        // 持续区域（暴风雪）：命中后在目标点建 zone，分波结算；不再立即打主目标/溅射。
        const waveInterval = durationSeconds / waves;
        //  区域技能同样是「一次出手」：命中状态照挂。
        //  不补这一句的话，第 N 次普攻既触发区域、又该附带点燃时，点燃会被这条提前 return 吞掉
        //  （2026-10-30 火焰树妖：每 6 次普攻放灼热地带、每 3 次命中挂点燃，第 6 次两者重合）。
        if (onHitStatusId && target.kind === 'unit') {
            const zoneTarget = context.unitById.get(target.id);
            if (zoneTarget) context.applyHitStatus(zoneTarget, onHitStatusId, unit.id);
        }
        const zoneCount = empowered ? Math.max(1, Math.round(skillRuntime?.parameters.zoneCount ?? 1)) : 1;
        const expireDamage = empowered && skillRuntime?.parameters.expireDamageRate != null
            ? this.unitDamage(context, unit, this.targetOwner(state, target, context), target.cardId,
                skillRuntime.parameters.expireDamageRate,
                target.kind === 'unit' ? target.id : undefined) * criticalMultiplier
            : 0;
        //  会移动的区域（2026-11-04 椰蛋战士「暴风」）：给了 `zoneMoveSpeed` 才走这条口径 ——
        //  从施法者出发、朝目标方向扇形抛出、路径上每个敌人只吃一次、命中名额满了提前散。
        //  缺省 0 ⇒ 走下面原地的老分支，暴风雪 / 灼热地带 / 火船行为逐字不变。
        const moveSpeed = empowered ? Math.max(0, skillRuntime?.parameters.zoneMoveSpeed ?? 0) : 0;
        const moving = moveSpeed > 0;
        const mParams = skillRuntime?.parameters;
        const movingDuration = moving ? Math.max(0, mParams?.zoneDuration ?? durationSeconds) : durationSeconds;
        //  移动区域每 0.15s 探一次路（走过敌人就结算），而不是沿用「持续秒数 / 波数」。
        const movingInterval = Math.max(0.05, mParams?.zoneWaveInterval ?? 0.15);
        const movingWaves = Math.max(1, Math.ceil(movingDuration / movingInterval));
        const maxHits = moving ? Math.max(0, Math.round(mParams?.zoneMaxHits ?? 0)) : 0;
        const spawnSpread = Math.max(0, mParams?.zoneSpreadDeg ?? 0) * Math.PI / 180;
        //  移动区域的扇形中轴（2026-11-07 椰蛋战士「暴风」需求 3）：
        //  「以椰蛋战士的攻击朝向为法线，3 个飓风夹角为 50°」。
        //  所以基准取 `unit.facingRadians`（美术朝向，`ZCUnitTargeting.face()` 在每次 `startAttack`
        //  时对齐到当前目标），不是 `atan2(目标 - 自身)`：两者只在"目标在正对角"时相同，
        //  而朝向是玩家眼睛看到的角色正面 —— 三条风要围着它对称张开才不歪。
        //  `zoneSpreadDeg` 是总夹角（下面 `fanOffset` 取 ±spread/2），不是"相邻两条的夹角"。
        const axis = moving ? unit.facingRadians : Math.atan2(target.y - from.y, target.x - from.x);
        //  自体中心区域（2026-10-30「斗气爆发」100604 / 「迪斯科旋风」103104 / 「死亡摇滚」103204）：
        //  这类技能的判定是「自身周围」，而区域默认落在目标点。给 `zoneSelfCentered = 1`
        //  就改成落在施法者脚下，半径与波次仍按 areaRadius / durationSeconds / waves 走。
        //  缺省 0 ⇒ 仍在目标点，暴风雪 / 灼热地带逐字不变。
        const selfCentered = !moving && (mParams?.zoneSelfCentered ?? 0) > 0;
        //  出生点前移（2026-11-07 鹿神守护需求 1）：「生成位置在魔术师前进方向 15px 处」
        //  （2026-11-12 由 30 改成 15，与「子弹从枪口出来」的观感对齐）。
        //  与攻击距离 / 区域半径同一套表值口径 ⇒ 乘 `combatDistanceScale`。
        const spawnForward = moving
            ? Math.max(0, mParams?.zoneSpawnForward ?? 0) * context.rules.combatDistanceScale
            : 0;
        //  追踪式移动（2026-11-07 鹿神守护需求 2，2026-11-12 改成「会追踪的子弹」）：
        //  给了 `zoneApproachSpeed` 才走「慢档走过去、贴近后提速」，缺省 0 ⇒ 一出生就按
        //  `zoneMoveSpeed` 飞（暴风 / 既有移动区域逐字不变）。
        const approachSpeed = moving
            ? Math.max(0, mParams?.zoneApproachSpeed ?? 0) * context.rules.combatDistanceScale
            : 0;
        const sprintRange = Math.max(0, mParams?.zoneSprintRange ?? 0) * context.rules.combatDistanceScale;
        for (let index = 0; index < zoneCount; index += 1) {
            //  扇形夹角：移动区域的三条围绕 `axis`（攻击朝向）对称张开；
            //  原地多道（迪斯科旋风一类）仍然绕着施法者均分一圈。
            const fanOffset = zoneCount === 1 ? 0 : ((index / (zoneCount - 1)) * 2 - 1) * spawnSpread / 2;
            const angle = moving ? axis + fanOffset
                : (zoneCount === 1 ? 0 : unit.facingRadians + Math.PI * 2 * index / zoneCount);
            const offset = zoneCount === 1 || moving || selfCentered ? 0 : areaRadius * .45;
            state.groundZones.push({
                //  移动区域的出生点 = 施法者坐标沿中轴前移 `zoneSpawnForward`
                //  （「小鹿在魔术师前进方向 30px」）。`zoneSpawnForward` 缺省 0 ⇒ 就是施法者本身。
                x: moving
                    ? from.x + Math.cos(angle) * spawnForward
                    : (selfCentered ? from.x : target.x + Math.cos(angle) * offset),
                y: moving
                    ? from.y + Math.sin(angle) * spawnForward
                    : (selfCentered ? from.y : target.y + Math.sin(angle) * offset),
                radius: areaRadius,
                owner: unit.owner,
                sourceUnitId: unit.id,
                skillId: event.skillId,
                skillName: event.skillName,
                effectPrefabPath: event.effectPrefabPath ?? null,
                remainingSeconds: movingDuration,
                wavesLeft: moving ? movingWaves : waves,
                nextWaveAt: state.elapsedSeconds,
                waveInterval: moving ? movingInterval : waveInterval,
                damage,
                floatTextKind,
                slowRatio,
                expireDamage,
                expireStatusId: expireDamage > 0 ? 'freeze' : undefined,
                expireStatusDuration: Math.max(0, skillRuntime?.parameters.freezeDuration ?? 0),
                //  表里的 `zoneMoveSpeed` 是「屏上 px/秒」口径，与 attackRange 同一套数，
                //  和区域半径一样乘 `combatDistanceScale` 换成世界坐标。
                moveVelocityX: moving ? Math.cos(angle) * moveSpeed * context.rules.combatDistanceScale : undefined,
                moveVelocityY: moving ? Math.sin(angle) * moveSpeed * context.rules.combatDistanceScale : undefined,
                hitUnitIds: maxHits > 0 ? [] : undefined,
                maxHits: maxHits > 0 ? maxHits : undefined,
                //  逐目标递减（2026-11-06 引入，移动区域的通用能力）：第 k 个被命中的敌人吃
                //  `damage × (1 - zoneDamageFalloff)^k`，设计口径「每多一个目标减少 50%」就是 0.5。
                //  缺省 0 ⇒ 不递减，既有移动区域（暴风）行为逐字不变。
                //   2026-11-12 起 103405 不再配它：小鹿改成「撞到第一个目标就消失」
                //  （`zoneMaxHits = 1`），根本没有「第二个目标」可递减。槽位保留给后续技能用。
                damageFalloff: moving
                    ? Math.max(0, Math.min(1, mParams?.zoneDamageFalloff ?? 0)) || undefined
                    : undefined,
                //  整段持有视觉（2026-11-07 鹿神守护小鹿冲刺）：给了 `zoneHoldVisual = 1` 才开 ——
                //  开了以后区域只在创建时推一条跟着自己走的长效表现事件，
                //  不再按波次在每波位置频闪（见 `ZCGroundZoneSystem.syncHoldVisual`）。
                //  缺省 0 ⇒ 暴风仍是原来的「一串残影」，行为逐字不变。
                holdVisual: moving && (mParams?.zoneHoldVisual ?? 0) > 0 ? true : undefined,
                //  入场「由小变大」（2026-11-07 暴风需求 2）：只对整段持有视觉生效 ——
                //  逐波残影每条只活 0.15s，长不出来。
                growSeconds: moving
                    ? Math.max(0, mParams?.zoneGrowSeconds ?? 0) || undefined
                    : undefined,
                //  追踪式移动（2026-11-12 鹿神守护改成「会追踪的子弹」）：慢档走近、贴近后提速。
                //  `approachSpeed` 是世界 px/秒（表值 × combatDistanceScale），
                //  `sprintSpeed` 同样 —— 由 `ZCGroundZoneSystem.advanceChase` 每帧写进 `moveVelocity`
                //  （它会持续转向目标、目标阵亡还会改追最近敌人，所以速度不能锁死在出生朝向）。
                approachSpeed: approachSpeed > 0 ? approachSpeed : undefined,
                //  追的目标就是这一击的攻击目标；目标是城墙 / 建筑（没有单位 id）时不给，
                //  区域会在第一帧自己找最近的敌人再提速。
                approachTargetId: approachSpeed > 0 && target.kind === 'unit' ? target.id : undefined,
                sprintRange: approachSpeed > 0 ? sprintRange : undefined,
                sprintSpeed: approachSpeed > 0 ? moveSpeed * context.rules.combatDistanceScale : undefined,
                sprinting: approachSpeed > 0 ? false : undefined,
            });
        }
    }

    private static resolveImmediateAttack(
        state: ZCSnapshot, unit: ZCUnitState, attack: IZCPreparedAttack, context: IZCAttackResolutionContext,
    ): void {
        const { target, activeProfile, empowered, skillRuntime, legacy, legacyTargetBuffs,
            floatTextKind, onHitStatusId, damage, legacyAreaRadius, event } = attack;
        const areaRadius = attack.effectiveAreaRadius;

        state.combatEvents.push(event);
        //  命中附加表现（2026-10-31 运动霸「拳击冲撞」203301 的「气浪」）。
        //  只补一条表现事件、不结算任何伤害，所以它与下面那段真正的伤害结算互不干扰。
        //  放在这里而不是结算之后：同一帧起播，「命中」和「气浪」才是同一拍。
        this.pushImpactEffect(state, event, activeProfile);
        if (target.kind === 'unit') {
            const targetUnit = context.unitById.get(target.id) ?? null;
            if (targetUnit) {
                const hitText = context.damageUnit(targetUnit, damage, {
                    owner: unit.owner, kind: 'unit', unitId: unit.id, floatTextKind,
                });
                this.applyLifesteal(unit, hitText, context);
                context.tryExecuteUnit(targetUnit,
                    (empowered ? skillRuntime?.parameters.executeChance : undefined) ?? legacy.executeChance,
                    unit.owner, unit.id, hitText);
                context.applyHitStatus(targetUnit, onHitStatusId, unit.id);
                context.applyLegacyBuffs(targetUnit, legacyTargetBuffs, unit.id);
                //  连击（2026-11-17）：近战 / 区域普攻的额外段，与弹道路径共用同一套递减口径。
                //  此前 `multiHitFlat` 只在 `resolveProjectileHit` 里兑现 ⇒ 近战卡的连击行
                //  （`attackCount add N`）配了却完全不生效，这 6 条连击技能全都踩在这个空档里。
                //  额外段只补伤害：命中类状态、处决、顿帧、吸血都只算「一次出手」那一段 ——
                //  设计案明确「连击段不重复触发命中类状态」，否则点燃/减速会被叠成两层。
                const comboHits = this.extraHitCountForUnit(unit, context);
                if (comboHits > 0) {
                    const comboDamage = Math.round(damage * this.comboDamageMultiplierOf(
                        unit, event.skillId, comboHits, context));
                    if (comboDamage > 0) {
                        context.damageUnit(targetUnit, comboDamage, {
                            owner: unit.owner, kind: 'unit', unitId: unit.id,
                            floatTextKind: 'damage', ranged: activeProfile.mode === 'area',
                        });
                    }
                }
            }
        } else if (target.kind === 'wall') {
            const targetWall = this.hex(state, target.id);
            if (targetWall) context.damageWall(unit, targetWall, damage);
        } else {
            const targetBuilding = this.hex(state, target.id);
            if (targetBuilding) context.damageBuilding(unit, targetBuilding, damage);
        }
        if ((activeProfile.mode === 'area' || legacyAreaRadius > 0) && areaRadius > 0) {
            const targetHexId = context.geometry.hexIdAt(target.x, target.y);
            const radiusHex = targetHexId === null ? 0 : Math.ceil(areaRadius / HEX_GRID_LOGICAL_ROW_STEP) + 1;
            const splashCandidates = targetHexId === null ? [] : context.unitsInRadius(targetHexId, radiusHex);
            for (const splash of splashCandidates) {
                if ((target.kind === 'unit' && splash.id === target.id) || splash.owner === unit.owner || splash.battleState === 'dead') continue;
                const pos = context.unitPosition(splash);
                if (distance(target.x, target.y, pos.x, pos.y) <= areaRadius) {
                    const hitText = context.damageUnit(splash, damage, {
                        owner: unit.owner, kind: 'unit', unitId: unit.id, floatTextKind, ranged: true,
                    });
                    this.applyLifesteal(unit, hitText, context, this.lifestealSpreadRateOf(unit, context));
                    context.tryExecuteUnit(splash, empowered ? skillRuntime?.parameters.executeChance : undefined,
                        unit.owner, unit.id, hitText);
                    context.applyHitStatus(splash, activeProfile.onHitStatusId, unit.id);
                    context.applyLegacyBuffs(splash, legacyTargetBuffs, unit.id);
                }
            }
        }
    }

    /**
     * 连发的一发：只按当前目标丢普通弹道，不动普攻节拍与强化 CD。
     * 命中结算/克制/暴击/挂状态仍走 `resolveProjectileHit`，与普通弹口径一致。
    */
    static sendBurstShot(state: ZCSnapshot, unit: ZCUnitState, context: IZCAttackResolutionContext): void {
        const target = context.currentTarget(unit);
        if (!target) return;
        const definition = context.effectiveDefinition(unit);
        const profile = definition.attackProfile;
        const skillRuntime = this.skillRuntimeFor(unit, context).get(`${unit.unitId}:${profile.skillId}`);
        const damageRate = Math.max(0, unit.burstDamageRate ?? 1);
        const criticalMultiplier = this.criticalMultiplier(unit, context);
        const bonuses = context.deckBonuses[unit.owner];
        const from = context.unitPosition(unit);
        const dx = target.x - from.x;
        const dy = target.y - from.y;
        const length = Math.hypot(dx, dy);
        const heading = length > 0 ? Math.atan2(dy, dx) : unit.facingRadians;
        const speed = profile.projectileSpeed || 500;
        const skillId = profile.skillId;
        //  与普通弹道同一口径：`baseDamage` 在出手时定死（含技能倍率与暴击），命中时再乘克制系数。
        //  这份「连发弹」同样要吃到 unit 域伤害倍率（否则同一张卡的两颗子弹伤害不一致）。
        const damageRateMultiplier = Math.max(0, 1 + (this.unitStatPatchOf(unit, context).damageRatePct ?? 0) / 100);
        const baseDamage = ZCCombatSystem.unitDamageBase(unit, definition, bonuses, context.rules,
            damageRate * damageRateMultiplier)
            * (unit.attackMultiplier ?? 1) * criticalMultiplier;
        state.projectiles.push({
            id: state.nextCombatEventId++,
            type: 'projectile',
            owner: unit.owner,
            sourceUnitId: unit.id,
            targetUnitId: target.kind === 'unit' ? target.id : null,
            skillId,
            skillName: profile.name,
            effectKey: profile.effectKey ?? null,
            projectileKey: profile.projectileKey ?? null,
            effectPrefabPath: profile.effectPrefabPath ?? null,
            fromX: from.x,
            fromY: from.y,
            toX: target.x,
            toY: target.y,
            radius: 0,
            damage: Math.round(baseDamage),
            empowered: true,
            startedAt: state.elapsedSeconds,
            durationSeconds: ZCCombatSystem.attackTravelSeconds(
                ZCCombatEventType.Projectile, distance(from.x, from.y, target.x, target.y), speed,
                ZC_PROJECTILE_MISS_DISTANCE),
            targetKind: 'unit',
            targetId: target.id,
            sourceCardId: unit.cardId,
            baseDamage,
            x: from.x, y: from.y, previousX: from.x, previousY: from.y,
            velocityX: Math.cos(heading) * speed,
            velocityY: Math.sin(heading) * speed,
            collisionRadius: (profile.collisionRadius ?? 3) * context.rules.combatDistanceScale,
            canHitAir: definition.canAttackAir,
            zoneDuration: 0,
            zoneWaves: 1,
            zoneSlow: 0,
            remainingPierces: 0,
            hitUnitIds: [],
            executeChance: 0,
            criticalHit: criticalMultiplier > 1,
            onHitStatusId: skillRuntime?.statusId ?? profile.onHitStatusId,
            legacyBuffs: [],
        });
    }

    static resolveProjectileHit(state: ZCSnapshot, projectile: ZCProjectileState, target: ZCCombatTarget,
        context: IZCAttackResolutionContext): void {
        const targetOwner = this.targetOwner(state, target, context);
        const multiplier = this.projectileCounterMultiplier(projectile, targetOwner, target.cardId, context,
            target.kind === 'unit' ? target.id : undefined);
        const damage = Math.round(projectile.baseDamage * multiplier);
        const floatTextKind = damageFloatTextKind(projectile.criticalHit === true, multiplier);
        //  打墙 / 打建筑只要「归属 + 落点」，受击特效还要实例 id 反查攻击方职业
        //  （2026-11-06：结构物受击也要播攻击方职业的闪白）。
        const sender: IZCStructureDamageSource = {
            id: projectile.sourceUnitId, owner: projectile.owner, freeX: projectile.x, freeY: projectile.y,
        };
        //  吸血要回给真人（`sender` 只是个用于打墙/打建筑的坐标壳），
        //  投射物离手后施法者可能已经死了 —— 查不到就不回。
        const shooter = context.unitById.get(projectile.sourceUnitId);
        //  连击（`pvpAttrMap.attackCount`，2026-10-13）：一次出手多打几段额外伤害。
        //  只加伤害，不重复触发处决 / 状态挂载 / 顿帧 —— 那些按「一次出手」算，多打几段不该重复给。
        //  第一段仍走下面原有的完整链路（含暴击文本），额外段在它之后静默补上。
        const extraHits = this.extraHitCountOf(projectile, context);
        if (target.kind === 'unit') {
            const unit = context.unitById.get(target.id);
            if (unit) {
                const hitText = context.damageUnit(unit, damage, {
                    owner: projectile.owner, kind: 'unit', unitId: projectile.sourceUnitId, floatTextKind, ranged: true,
                });
                if (shooter) this.applyLifesteal(shooter, hitText, context);
                if (extraHits > 0) {
                    //  逐段递减（2026-11-17）：总倍率由 `comboDamage` / `comboFalloff` 算出，
                    //  不写参数时等于 `extraHits`（满伤害），与引入递减前逐字一致。
                    const comboTotal = this.comboDamageMultiplierOf(
                        shooter, projectile.skillId, extraHits, context);
                    const comboDamage = Math.round(damage * comboTotal);
                    if (comboDamage > 0) {
                        context.damageUnit(unit, comboDamage, {
                            owner: projectile.owner, kind: 'unit', unitId: projectile.sourceUnitId,
                            floatTextKind: 'damage', ranged: true,
                        });
                    }
                }
                context.tryExecuteUnit(unit, projectile.executeChance, projectile.owner, projectile.sourceUnitId, hitText);
                context.applyHitStatus(unit, projectile.onHitStatusId, projectile.sourceUnitId);
                context.applyLegacyBuffs(unit, projectile.legacyBuffs ?? [], projectile.sourceUnitId);
            }
        } else {
            const hex = this.hex(state, target.id);
            if (hex) {
                if (target.kind === 'wall') context.damageWall(sender, hex, damage);
                else context.damageBuilding(sender, hex, damage);
            }
        }
        if ((projectile.splashRadius ?? 0) > 0) {
            const centerHexId = context.geometry.hexIdAt(projectile.x, projectile.y);
            const radius = projectile.splashRadius ?? 0;
            const radiusHex = centerHexId == null ? 0 : Math.ceil(radius / HEX_GRID_LOGICAL_ROW_STEP) + 1;
            const candidates = centerHexId == null ? [] : context.unitsInRadius(centerHexId, radiusHex);
            //  多目标递减（2026-11-14）：旁溅目标按距离由近到远排序，第 n 个再乘 `(1-falloff)^n`。
            //  候选来自格子桶，顺序不稳定 ⇒ 必须先排序，否则衰减结果不可重演。
            const splashFalloff = Math.max(0, Math.min(1, projectile.splashFalloff ?? 0));
            const splashTargets: { unit: ZCUnitState; distance: number }[] = [];
            for (const splash of candidates) {
                if ((target.kind === 'unit' && splash.id === target.id)
                    || splash.owner === projectile.owner || splash.battleState === 'dead') continue;
                const position = context.unitPosition(splash);
                const gap = distance(projectile.x, projectile.y, position.x, position.y);
                if (gap > radius) continue;
                splashTargets.push({ unit: splash, distance: gap });
            }
            splashTargets.sort((a, b) => a.distance - b.distance);
            for (let index = 0; index < splashTargets.length; index += 1) {
                const splash = splashTargets[index].unit;
                const splashMultiplier = this.projectileCounterMultiplier(
                    projectile, splash.owner, splash.cardId, context, splash.id);
                const splashDamage = Math.round(projectile.baseDamage * splashMultiplier
                    * (projectile.splashDamageRate ?? 1) * Math.pow(1 - splashFalloff, index));
                const splashText = context.damageUnit(splash, splashDamage, {
                    owner: projectile.owner,
                    kind: 'unit',
                    unitId: projectile.sourceUnitId,
                    floatTextKind: damageFloatTextKind(projectile.criticalHit === true, splashMultiplier),
                    ranged: true,
                });
                if (shooter) this.applyLifesteal(shooter, splashText, context, this.lifestealSpreadRateOf(shooter, context));
                context.tryExecuteUnit(splash, projectile.executeChance, projectile.owner, projectile.sourceUnitId, splashText);
                context.applyHitStatus(splash, projectile.onHitStatusId, projectile.sourceUnitId);
                context.applyLegacyBuffs(splash, projectile.legacyBuffs ?? [], projectile.sourceUnitId);
            }
        }
        //  命中点留下的持续区域（2026-11-18 第 16 批「孢爆箭」101303 的飓风）。
        //  与下面 `burstRadius` 的区别：那个是「炸一下就完」，这个要**留在场上 3 秒**，
        //  所以走 `groundZones` 而不是当场结算 —— 区域系统本来就有
        //  「固定圆心 + 多次判定 + 每个敌人只算一次」（`hitOncePerUnit`）这套能力。
        //  `holdVisual`：整段只推一条长效 `area` 事件跟着区域走，而不是每 0.05 秒刷一次残影。
        const hurricaneRadius = projectile.hurricaneRadius ?? 0;
        if (hurricaneRadius > 0) {
            const hurricaneSeconds = Math.max(0, projectile.hurricaneSeconds ?? 0);
            state.groundZones.push({
                x: projectile.x,
                y: projectile.y,
                radius: hurricaneRadius,
                owner: projectile.owner,
                sourceUnitId: projectile.sourceUnitId,
                skillId: projectile.skillId,
                skillName: projectile.skillName,
                effectPrefabPath: projectile.hurricanePrefabPath ?? ZC_WIND_HURRICANE_PREFAB_PATH,
                remainingSeconds: hurricaneSeconds,
                //  波次数 = 存活秒 ÷ 接触判定间隔：让「接触」在每个逻辑步都被检查到，
                //  而不是等 0.5 秒一波（那样贴边跑过去的人会被漏掉）。
                wavesLeft: Math.max(1, Math.round(hurricaneSeconds / ZC_WIND_HURRICANE_TOUCH_SECONDS)),
                nextWaveAt: state.elapsedSeconds,
                waveInterval: ZC_WIND_HURRICANE_TOUCH_SECONDS,
                damage: Math.max(0, projectile.hurricaneDamage ?? 0),
                slowRatio: 0,
                hitUnitIds: [],
                hitOncePerUnit: true,
                holdVisual: true,
            });
        }
        //  命中爆炸（2026-11-11 麻辣铁锅「凤凰降临」102604）。设计案原文：
        //  「子弹命中目标产生 220%/280%/300% 的伤害，命中目标爆炸，爆炸产生瞬间伤害
        //   150%/200%/250%，爆炸开始后第 26 帧造成 1 次伤害 150%/180%/200%，
        //   爆炸伤害和第 2 段伤害都是范围伤害」。
        //
        //  三段的分工：直击在上面 `damageUnit` 已经结算完；这里补第一段爆炸（立刻）+ 第二段（延迟）。
        //  两段都以命中点为圆心、都把包括主目标在内的所有敌人各打一次 —— 所以不用
        //  `splashRadius` 那条路（它按设计就是「不打主目标」的）。
        //
        //  第二段借 `groundZones` 而不是自己排一个定时器：区域系统本来就有
        //  「首波延迟到 `nextWaveAt`」的能力（五雷轰顶的「第 5 帧判伤」就是这么做的），
        //  再写一套延迟伤害只会让「延迟结算」出现两份口径。`effectPrefabPath: null`
        //  表示这块区域不推表现事件 —— 爆炸特效已经由上面那条 `area` 事件播了。
        const burstRadius = projectile.burstRadius ?? 0;
        if (burstRadius > 0 && (projectile.burstDamage ?? 0) > 0) {
            const burstHexId = context.geometry.hexIdAt(projectile.x, projectile.y);
            const burstHexRadius = burstHexId == null
                ? 0 : Math.ceil(burstRadius / HEX_GRID_LOGICAL_ROW_STEP) + 1;
            const burstCandidates = burstHexId == null ? [] : context.unitsInRadius(burstHexId, burstHexRadius);
            for (const victim of burstCandidates) {
                if (victim.owner === projectile.owner || victim.battleState === 'dead') continue;
                const position = context.unitPosition(victim);
                if (distance(projectile.x, projectile.y, position.x, position.y) > burstRadius) continue;
                const burstMultiplier = this.projectileCounterMultiplier(
                    projectile, victim.owner, victim.cardId, context, victim.id);
                const burstText = context.damageUnit(victim,
                    Math.round((projectile.burstDamage ?? 0) * burstMultiplier), {
                        owner: projectile.owner,
                        kind: 'unit',
                        unitId: projectile.sourceUnitId,
                        floatTextKind: damageFloatTextKind(projectile.criticalHit === true, burstMultiplier),
                        ranged: true,
                    });
                if (shooter) this.applyLifesteal(shooter, burstText, context, this.lifestealSpreadRateOf(shooter, context));
                context.tryExecuteUnit(victim, projectile.executeChance, projectile.owner,
                    projectile.sourceUnitId, burstText);
            }
            const secondDamage = projectile.burstSecondDamage ?? 0;
            if (secondDamage > 0) {
                const delay = Math.max(0, projectile.burstSecondDelay ?? 0);
                state.groundZones.push({
                    x: projectile.x,
                    y: projectile.y,
                    radius: burstRadius,
                    owner: projectile.owner,
                    sourceUnitId: projectile.sourceUnitId,
                    skillId: projectile.skillId,
                    skillName: projectile.skillName,
                    effectPrefabPath: null,
                    //  活到那一波打完：延迟 + 0.3s 收尾（与五雷轰顶逐字同口径）。
                    remainingSeconds: delay + 0.3,
                    wavesLeft: 1,
                    nextWaveAt: state.elapsedSeconds + delay,
                    waveInterval: Math.max(0.05, delay),
                    //  第二段的克制系数按受击者算，所以基数存的是不含克制的那一份；
                    //  这里没有具体受击者，落回施法者自己的克制（中性 = 1），逐人克制在区域的
                    //  波次结算里按 `ZCGroundZoneSystem` 的既有口径处理。
                    damage: Math.round(secondDamage),
                    floatTextKind,
                    slowRatio: 0,
                });
            }
        }
        state.combatEvents.push({
            id: state.nextCombatEventId++, type: 'area', owner: projectile.owner,
            sourceUnitId: projectile.sourceUnitId, skillId: projectile.skillId, skillName: projectile.skillName,
            empowered: projectile.empowered,
            targetUnitId: target.kind === 'unit' ? target.id : null,
            fromX: projectile.x, fromY: projectile.y, toX: projectile.x, toY: projectile.y,
            //  追踪导弹：命中后播爆炸（`镭射飞龙_导弹技能命中`）而不是通用受击；
            //  普通弹道仍是 `effectKey: 'hit'` + null（走通用命中表现）。
            effectPrefabPath: projectile.impactEffectPrefabPath ?? null,
            effectKey: projectile.impactEffectPrefabPath ? null : 'hit',
            projectileKey: null,
            //  命中表现的时长：配了爆炸（`burstEffectSeconds`）就活够整段序列帧动画
            //  （爆炸龙卷 32 帧 @30fps = 1.0667s），否则沿用 0.5 / 0.18 的老口径。
            //  短一截会被 `ZCGameModel` 按 `startedAt + durationSeconds` 提前摘掉 —— 同 §14.5。
            radius: 4, damage, startedAt: state.elapsedSeconds,
            durationSeconds: projectile.impactEffectPrefabPath
                ? (projectile.burstEffectSeconds ?? 0.5) : .18,
        });
        // 投射物命中后在落点创建持续区域（火船/风龙：命中后才烧）
        if ((projectile.zoneDuration ?? 0) > 0 && projectile.radius > 0) {
            const waves = Math.max(1, projectile.zoneWaves ?? 1);
            state.groundZones.push({
                x: projectile.x,
                y: projectile.y,
                radius: projectile.radius,
                owner: projectile.owner,
                sourceUnitId: projectile.sourceUnitId,
                skillId: projectile.skillId,
                skillName: projectile.skillName,
                effectPrefabPath: 'units/projectiles/普攻爆炸/普攻爆炸',
                remainingSeconds: projectile.zoneDuration ?? 0,
                wavesLeft: waves,
                nextWaveAt: state.elapsedSeconds,
                waveInterval: (projectile.zoneDuration ?? 0) / waves,
                damage: projectile.zoneDamage ?? damage,
                floatTextKind,
                slowRatio: projectile.zoneSlow ?? 0,
            });
        }
    }
}

