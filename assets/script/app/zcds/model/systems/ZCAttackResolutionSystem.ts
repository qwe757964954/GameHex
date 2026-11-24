import { HEX_GRID_LOGICAL_ROW_STEP } from '../../../../core/hex/HexGridLayout';
import { cardCounterMultiplier, ZC_ATTACK_TRAITS, ZC_CAMP_TRAITS, ZC_EMPOWERED_FX_SCALE, ZCCombatEventType, type ZCAttackProfile, type ZCCardTraits, type ZCCounterRule, type ZCDeckBonuses, type ZCDeckCard, type ZCUnitDefinition } from '../ZCCombatCatalog';
import { zcCombatEffectTravelSeconds } from '../ZCCombatEffectFlight';
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
import { zcImpactEffectAnchor } from '../ZCImpactEffectFx';
import { pushQuakeStrikeVisualEvent, zcEmpoweredFxOverrideOf, ZC_QUAKE_STRIKE_SECONDS } from '../ZCQuakeFx';
import { zcEffectDurationOf } from '../ZCEffectCatalog';
import { ZC_STORM_PREFAB_PATH } from '../ZCStormFx';
import { ZC_RAY_BEAM_PREFAB_PATH, zcRayBeamEffectScale } from '../ZCRayBeamFx';
import { ZC_FIRE_ZONE_PREFAB_PATH, ZC_FIRE_ZONE_TINT } from '../ZCFireZoneFx';
import {
    ZC_BARRAGE_IMPACT_PREFAB_PATH, ZC_BARRAGE_MISSILE_PREFAB_PATH,
    ZC_BARRAGE_SCATTER_RADIUS, ZC_BARRAGE_FLIGHT_SPEED,
    ZC_WIND_BOLT_PREFAB_PATH, ZC_WIND_HURRICANE_PREFAB_PATH, ZC_WIND_HURRICANE_TOUCH_SECONDS,
    zcBarrageFlightSeconds, zcBarrageImpactScale,
} from '../ZCWindBarrageFx';
import {
    ZC_TRAP_EXPIRE_SECONDS, zcTrapExpirePath,
    ZC_TRAP_IDLE_PREFAB_PATH, ZC_TRAP_SPAWN_PREFAB_PATH, ZC_TRAP_SPAWN_SECONDS,
} from '../ZCTrapFx';
import { missileLog } from '../../ZCMissileSkillDiagnostics';
import { skillCastLog, skillCastLogChanging, zcSkillCastWatched } from '../../ZCSkillCastDiagnostics';
import { ZCDC_LOG_DAMAGE_FLOAT } from '../../ZCDCLogSwitch';
import type {
    ZCCombatEvent, ZCCombatFloatTextKind, ZCCombatTarget, ZCFloatText,
    ZCHexState, ZCProjectileState, ZCSnapshot, ZCUnitState
} from '../ZCGameTypes';
import type { ZCLegacyBuffApplication, ZCLegacySkillEvaluation } from '../ZCLegacySkillEffect';
import { ZCOwner } from '../ZCMapConfig';
import { neutralResourceItemOf, ZCNeutralResourceType } from '../ZCNeutralResourceGroup';
import type { ZCUnitStatPatch } from '../ZCModifierRuntime';
import type { ZCSkillRuntimeDefinition } from '../ZCSkillRuntime';
import { ZC_EMPOWERED_LOCK_PARAM } from '../ZCSkillRuntime';
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
 * 三叶小丑「飓风」102004 的入场起点占比（2026-11-20 第 28 批）。
 *
 * 用户原话「初始生成的大小只有 10%，随着移动过程逐渐成长」⇒ 出生那一眼就是 10%，
 * 飞到目标时正好长满（`growSeconds` 取直线赶路耗时）。只在**有赶路段**时才写进区域：
 * 没有目标的原地生成保持老口径（0.2s 从 0 长起来），存量表现逐字不变。
*/
const ZC_STORM_GROW_FROM = 0.1;

/**
 * 投掷陷阱飞行段的**弧线峰高**（屏上 px，2026-11-20）。
 *
 * 用户口径「蘑菇爆炸没有丢出特效（弧线飞行落地）的过程」。位移判定仍是地面直线，
 * 弧线只落在表现层的竖直抬升上（`ZCGroundZoneSystem.settleFlight` 每帧刷
 * `visualLiftPx = 4h·p·(1-p)`）—— 起飞与落地都是 0、中途最高。
 *
 * 取值：120 逻辑 px ≈ 92 屏上 px，与一格地砖差不多高，「看得出扔出去了」又不至于飞出屏幕。
 * 注意这一格是**屏上 px**（视图直接加在 `mapToViewY` 之后），不是表值。
*/
const ZC_TRAP_FLIGHT_ARC_PX = 92;

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
    /**
     * 这张卡的**普攻行**（`activeProfile` 的基准档）。
     *
     * 强化那一击的 `activeProfile` 会切到武将技行（36xxx），而表现口径统一按普攻行走
     * （2026-11-19 定案 A）⇒ 需要同时带着原始那一份。投枪例外：它有专属枪形弹体，
     * 且那份 profile 刻意清空了 `impactEffectPrefabPath`（投枪不该带「气浪」）。
     */
    readonly profile: ZCAttackProfile;
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
    private static readonly emptyStatPatch: ZCUnitStatPatch = Object.freeze({});

    private static statPatchOf(context: IZCAttackResolutionContext, owner: ZCOwner, id: string): ZCUnitStatPatch {
        const ownerPatches = context.statPatches[owner];
        return (ownerPatches && ownerPatches.get(id)) || this.emptyStatPatch;
    }

    private static skillRuntimeFor(unit: ZCUnitState, context: IZCAttackResolutionContext): ReadonlyMap<string, ZCSkillRuntimeDefinition> {
        return unit.neutralReinforcement ? context.neutralSkillRuntime ?? this.emptySkillRuntime : context.skillRuntime[unit.owner];
    }

    private static skillRuntimeOf(
        unit: ZCUnitState,
        skillId: number,
        context: IZCAttackResolutionContext,
    ): ZCSkillRuntimeDefinition | undefined {
        return this.skillRuntimeFor(unit, context).get(`${unit.unitId}:${skillId}`);
    }

    private static skillParamsOf(
        unit: ZCUnitState,
        skillId: number,
        context: IZCAttackResolutionContext,
    ): Readonly<Record<string, number>> | undefined {
        const runtime = this.skillRuntimeOf(unit, skillId, context);
        return runtime ? runtime.parameters : undefined;
    }

    private static cardById(context: IZCAttackResolutionContext, owner: ZCOwner, id: string): ZCDeckCard | undefined {
        return context.cards[owner].get(id);
    }

    private static unitStatPatchOf(unit: ZCUnitState, context: IZCAttackResolutionContext): ZCUnitStatPatch {
        return unit.neutralReinforcement ? this.emptyStatPatch : this.statPatchOf(context, unit.owner, unit.unitId);
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
        const defenderPatch = targetUnit
            ? this.statPatchOf(context, targetUnit.owner, targetUnit.unitId)
            : (targetCardId ? this.statPatchOf(context, targetOwner, targetCardId) : this.emptyStatPatch);
        return base * zcSkillCounterMultiplier(
            this.unitStatPatchOf(unit, context), defenderPatch,
            attackerCard ? attackerCard.traits : undefined, defenderCard ? defenderCard.traits : undefined);
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
        if (target.kind === 'unit') {
            const unit = context.unitById.get(target.id);
            return unit ? unit.owner : ZCOwner.Enemy;
        }
        const hex = this.hex(state, target.id);
        if (!hex) return ZCOwner.Enemy;
        // 出生格的阵营不能参与中立野怪的克制结算。
        const resourceItem = neutralResourceItemOf(hex.neutralResourceId);
        if (resourceItem && resourceItem.resourceType === ZCNeutralResourceType.Monster) {
            return ZCOwner.Enemy;
        }
        const owner = hex.owner;
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
        const counterMultiplier = this.counterMultiplierFor(unit, targetOwner, targetCardId, context, targetUnitId);
        const damage = ZCCombatSystem.unitDamage(unit, definition, bonuses,
            //  克制只在这里乘一次：全局克制 × 技能级克制条（见 `counterMultiplierFor`）
            counterMultiplier,
            context.rules,
            skillDamageRate * Math.max(0, rawMultiplier) * Math.max(0, statusMultiplier));
        const resolvedDamage = Math.max(1, Math.round(damage * (unit.attackMultiplier ?? 1)));
        if (ZCDC_LOG_DAMAGE_FLOAT) {
            console.info('[伤害飘字][攻击计算]', {
                ...this.attackLogFields(unit, definition, context),
                targetOwner, targetCardId, targetId: targetUnitId, skillDamageRate, counterMultiplier,
                damageRateMultiplier: Math.max(0, rawMultiplier), statusDamageMultiplier: Math.max(0, statusMultiplier),
                damageBeforeUnitMultiplier: damage, resolvedDamage,
            });
        }
        return resolvedDamage;
    }

    private static attackLogFields(unit: ZCUnitState, definition: ZCUnitDefinition, context: IZCAttackResolutionContext) {
        const status = context.statusSystem.statModsOf(String(unit.id));
        return {
            sourceId: unit.id, sourceCardId: unit.cardId, unitId: unit.unitId, owner: unit.owner,
            attack: definition.attack, inheritedAttack: unit.inheritedStats ? unit.inheritedStats.attack : undefined,
            gateDamageMultiplier: unit.gateSize ? (unit.gateDamageMultiplier ?? 1) : 1,
            statusAttackFlat: status.attackFlat ?? 0, statusAttackPct: status.attackPct ?? 0,
            tier: unit.tier, tierMultiplier: unit.neutralReinforcement ? 1 : ZCCombatSystem.unitTierAttackMultiplier(unit, context.rules),
            bondMultiplier: unit.neutralReinforcement ? 1 : context.deckBonuses[unit.owner].unitAttackMultiplier,
            globalMultiplier: context.rules.combatDamageMultiplier, unitAttackMultiplier: unit.attackMultiplier ?? 1,
        };
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
        const dealt = hitText ? (hitText.appliedDamage ?? hitText.value) : 0;
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
        const params = this.skillParamsOf(unit, skillId, context);
        const value = params ? params.lifestealSpreadRate : undefined;
        if (value === undefined || !Number.isFinite(value)) return 1;
        return Math.max(0, Math.min(1, value));
    }

    /**
     * 吸血比例：技能参数 `skillParamJson.lifestealRate` 优先，unit 域 `lifestealRate` 兜底。
     * 表里走参数是因为同一行只能有一个 statId，攻击范围已占用；unit 域留给整卡常驻吸血。
    */
    private static lifestealRatioOf(unit: ZCUnitState, context: IZCAttackResolutionContext): number {
        const skillId = context.effectiveDefinition(unit).attackProfile.skillId;
        const params = this.skillParamsOf(unit, skillId, context);
        const fromParams = (params && params.lifestealRate) ?? (this.unitStatPatchOf(unit, context).lifestealRate ?? 0);
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
        const params = unit ? this.skillParamsOf(unit, skillId, context) : undefined;
        const first = Math.max(0, Math.min(100, (params && params.comboDamage) ?? 100)) / 100;
        const falloff = Math.max(0, Math.min(1, (params && params.comboFalloff) ?? 0));
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
        if (empowered || !skillRuntime) return false;
        const every = Math.max(0, Math.round(skillRuntime.parameters.lanceEvery ?? 0));
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
        const params = skillRuntime ? skillRuntime.parameters : undefined;
        return {
            ...base,
            mode: ZCCombatEventType.Projectile,
            projectileSpeed: Math.max(1, (params ? params.lanceSpeed : undefined) ?? ZC_LANCE_DEFAULT_SPEED),
            effectPrefabPath: ZC_LANCE_DEFAULT_EFFECT_PREFAB_PATH,
            onHitStatusId: undefined,
            impactEffectPrefabPath: undefined,
            //  气浪的落点比例一并清掉：没有命中附加特效时它没有意义，留着容易让人以为「投枪也有气浪」。
            impactEffectAnchor: undefined,
            areaRadius: 0,
            durationSeconds: 0,
            waves: 1,
            slowRatio: undefined,
            empoweredEvery: 0,
            empoweredSkillId: 0,
        };
    }

    /**
     * 命中附加表现（`impactEffectPrefabPath`）：补一条 `area` 事件。
     * `area` 归地面层，冲击环压在角色脚下；`damage: 0` 只是画面，伤害已由主事件结算。
     *
     * 落点由 `ZCImpactEffectFx.zcImpactEffectAnchor` 按表里的 `impactEffectAnchor` 算：
     * 0（默认）= 受击点，0.5 = 双方中点（运动霸的气浪），1 = 出手点。
     * 起终点仍然给同一个坐标 —— `area` 原地播，起终点不同会被当成「有飞行段」去算朝向和时长。
    */
    private static pushImpactEffect(state: ZCSnapshot, event: ZCCombatEvent, profile: ZCAttackProfile): void {
        const effectPrefabPath = profile.impactEffectPrefabPath;
        if (!effectPrefabPath) return;
        const anchor = zcImpactEffectAnchor(profile.impactEffectAnchor,
            event.fromX, event.fromY, event.toX, event.toY);
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
            fromX: anchor.x,
            fromY: anchor.y,
            toX: anchor.x,
            toY: anchor.y,
            radius: 1,
            damage: 0,
            empowered: false,
            startedAt: event.startedAt,
            // 与近战主特效的 0.3s 对齐：多出来的那一点是给冲击环留的余波，不要长到盖住下一次普攻。
            durationSeconds: 0.35,
            //  强化那一击连命中附加特效一起 ×1.2（定案 A：全套表现只差尺寸）。
            effectScale: event.empowered ? ZC_EMPOWERED_FX_SCALE : undefined,
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
        const parameters = this.skillParamsOf(unit, profile.skillId, context);
        if (!parameters || !(Math.max(0, parameters.secondaryCooldown ?? 0) > 0)) return false;
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
        const runtime = this.skillRuntimeOf(unit, profile.skillId, context);
        const onHitStatusId = appliesHitStatus
            ? ((runtime ? runtime.statusId : undefined) ?? activeProfile.onHitStatusId)
            : activeProfile.onHitStatusId;
        const targetOwner = this.targetOwner(state, target, context);
        const targetUnitId = target.kind === 'unit' ? target.id : undefined;
        const criticalMultiplier = this.criticalMultiplier(unit, context);
        const damage = Math.round(this.unitDamage(context, unit, targetOwner, target.cardId, skillDamageRate,
            targetUnitId) * criticalMultiplier);
        const counterMultiplier = this.counterMultiplierFor(
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
     *
     * `auraAtTarget`（2026-11-19）：圆心改落到**当前受击目标**身上、且不再跟随本体。
     * 缺省 0 ⇒ 所有存量 `self_aura` 行为逐字不变。
     * 返回 true = 真的开出来了，调用方才消费 CD。
    */
    static castSelfAura(state: ZCSnapshot, unit: ZCUnitState,
        context: IZCAttackResolutionContext): boolean {
        const definition = context.effectiveDefinition(unit);
        const profile = definition.attackProfile;
        const runtime = this.skillRuntimeOf(unit, profile.skillId, context);
        if (!runtime || !runtime.parameters) return false;
        const parameters = runtime.parameters;
        const radius = Math.max(0, parameters.auraRadius ?? 0) * context.rules.combatDistanceScale;
        const seconds = Math.max(0, parameters.auraSeconds ?? 0);
        const interval = Math.max(0.05, parameters.auraInterval ?? 1);
        const damageRate = Math.max(0, parameters.auraDamageRate ?? 0);
        //  「落点在受击目标身上」（2026-11-19 用户口径，急冻瓜「冰山陨落」102403）：
        //  「释放位置应该是受击目标的位置，不是自身，区域效果和冰锥都是落在目标身上」。
        //  开了它 ⇒ 判定圆心直接搬到**当前目标**脚下、并且**不跟随本体**（跟随那一句会把圆心
        //  每帧拽回施法者，等于没搬）；没有目标 ⇒ 拒放（返回 false，调用方不消费 CD）。
        //  缺省 0 ⇒ 无尘禁土 / 磁电冲击 / 喷射火焰 一个字节都不变。
        const atTarget = (parameters.auraAtTarget ?? 0) > 0;
        if (!(radius > 0) || !(seconds > 0) || !(damageRate > 0)) {
            //  诊断4.-a：三个必需参数里哪个是 0。这条一打出来就说明「走得到施法函数、但表没配上」。
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`selfaura-params:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} 自身光环（${profile.name}）参数不全：`
                    + `radius=${radius}（表值 ${parameters.auraRadius ?? 'undefined'}）`
                    + ` seconds=${seconds} damageRate=${damageRate} ⇒ 不开区域、不消费 CD`);
            }
            return false;
        }

        //  暴击 / 克制按开光环那一刻的当前目标算一次，之后每一波都吃同一个数 ——
        //  与 `castFanSkill` / `attackProfile.damageRate` 的区域伤害同源（区域只存
        //  `damage` 一个标量，逐波重算暴击会让「同一片光环」一会儿暴一会儿不暴）。
        const target = context.currentTarget(unit);
        if (atTarget && !target) {
            //  目标刚被打死 / 已脱战 ⇒ 这一拍不放，也不消费 CD（下一帧重新索敌）。
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`selfaura-losttarget:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} 自身光环（${profile.name}）要求落在受击目标身上，`
                    + '但当前没有目标 ⇒ 不开区域、不消费 CD');
            }
            return false;
        }
        const targetOwner = target ? this.targetOwner(state, target, context) : unit.owner;
        const targetCardId = target ? target.cardId : null;
        const targetUnitId = target && target.kind === 'unit' ? target.id : undefined;
        const criticalMultiplier = this.criticalMultiplier(unit, context);
        const damage = Math.round(
            this.unitDamage(context, unit, targetOwner, targetCardId, damageRate, targetUnitId) * criticalMultiplier);
        const counterMultiplier = target
            ? this.counterMultiplierFor(unit, this.targetOwner(state, target, context), target.cardId, context, targetUnitId)
            : 1;
        const floatTextKind = damageFloatTextKind(criticalMultiplier > 1, counterMultiplier);
        //  波数向下取整再加一：`auraSeconds = 4` / `interval = 1` ⇒ 4 波（立刻一波 + 3 波），
        //  最后一波正好落在到期那一拍；留 `1e-6` 吸收 6 / 1 = 6.000000000000001 这类浮点误差。
        const waves = Math.max(1, Math.round(seconds / interval + 1e-6));
        const origin = context.unitPosition(unit);
        //  「身前 N px」出生点（2026-11-11 磁电菇「磁电冲击」101604「在身前 1px 的位置」）：
        //  沿本体美术朝向前移，与区域半径同一套表值口径 ⇒ 乘 `combatDistanceScale`。
        //  缺省 0 ⇒ 就是本体脚下，无尘禁土（102503）行为逐字不变。
        const forward = Math.max(0, parameters.auraForward ?? 0) * context.rules.combatDistanceScale;
        //  「终点朝向目标方向」（2026-11-11 磁电冲击 101604 第二轮）：
        //  开了 `auraFaceTarget` 就用「本体 → 当前目标」的方位角，出生点偏移也用同一个角 ——
        //  两者必须同源，否则区域会沿本体朝向飘出去、矩形却朝目标，中心对不上。
        //  没有目标 / 上下文不给位置 ⇒ 回落到本体美术朝向（与改前逐字一致）。
        const faceTarget = (parameters.auraFaceTarget ?? 0) > 0;
        //  `ZCCombatTarget` 自带 `x / y`（与 `unitPosition` 同一套世界坐标），不用再查单位表。
        const targetPos = faceTarget && target ? { x: target.x, y: target.y } : null;
        const aimRadians = targetPos && (targetPos.x !== origin.x || targetPos.y !== origin.y)
            ? Math.atan2(targetPos.y - origin.y, targetPos.x - origin.x)
            : unit.facingRadians;
        //  `auraAtTarget` 优先于 `auraForward`：圆心就是目标点，不再沿朝向推一段
        //  （两套口径同时配没有意义 —— 「落在目标身上」和「在身前 N px」是互斥的落点）。
        const atTargetPoint = atTarget && target ? { x: target.x, y: target.y } : null;
        const spawnX = atTargetPoint
            ? atTargetPoint.x
            : (forward > 0 ? origin.x + Math.cos(aimRadians) * forward : origin.x);
        const spawnY = atTargetPoint
            ? atTargetPoint.y
            : (forward > 0 ? origin.y + Math.sin(aimRadians) * forward : origin.y);
        //  区域朝向（度）：只有真的「朝目标」才写，否则保持缺省 0° ⇒ 既有区域一个字节都不变。
        const angleDegrees = targetPos ? aimRadians * 180 / Math.PI : undefined;
        //  表现的竖直抬升（屏上 px）：「起始位置要在角色的中心点」，单位根节点是逻辑脚点，
        //  不抬的话光束有一半埋在地面线以下。缺省 0 ⇒ 既有区域一律不抬。
        const visualLiftPx = Math.max(0, parameters.auraVisualLiftPx ?? 0);
        //  是否跟随本体（缺省 1 = 跟随，与无尘禁土一致）。冲击波是站桩的，配 0。
        //  2026-11-12 磁电冲击改成「跟随角色一起移动、固定在角色身前」⇒ 配 1。
        //  🔴 `auraAtTarget` 恒等于「不跟随」：跟着走的话圆心每帧被 `followUnitId` 拽回施法者，
        //  区域会在目标脚下开一拍、然后整片飘回自己身上 —— 看起来就是「没生效」。
        const follow = !atTarget && (parameters.auraFollow ?? 1) > 0;
        //  跟随落点保持的身前距离：直接复用 `auraForward` —— 「出生时在身前 N px」与
        //  「之后一直悬在身前 N px」本来就是同一个数，没必要再开一个口径让两者能配歪。
        //  `auraForward` 缺省 0 ⇒ 圆心跳回本体，与无尘禁土逐字一致。
        const followForward = follow && forward > 0 ? forward : 0;
        //  每波目标上限（磁电冲击「最多对范围内 5 个敌人」）。缺省 0 ⇒ 不限。
        const waveMaxTargets = Math.max(0, Math.round(parameters.auraWaveMaxTargets ?? 0));
        //  施法者在此期间「跳起来」的高度（屏上 px，只抬美术根节点，不动坐标）。
        //  麻辣铁锅「喷射火焰」102603：「播放攻击动画时，角色上移 30px…角色在空中循环播放攻击动作」。
        //  挂在区域上 ⇒ 与光环同生共死，不需要另设到期清理。缺省 0 ⇒ 任何既有光环都不抬。
        const casterLiftPx = Math.max(0, parameters.casterLiftPx ?? 0);
        //  矩形判定（2026-11-11 磁电冲击 101604 「把判定改成长方形，尽可能贴合特效范围」）：
        //  `auraRectHalfHeight > 0` 才启用；半长缺省跟随半径（长度仍由 auraRadius 三档驱动）。
        //  两者都是表值逻辑 px，与 `auraRadius` 同一套口径 ⇒ 一起乘 `combatDistanceScale`。
        const rectHalfHeight = Math.max(0, parameters.auraRectHalfHeight ?? 0)
            * context.rules.combatDistanceScale;
        const rectHalfLength = rectHalfHeight > 0
            ? Math.max(0, parameters.auraRectHalfLength ?? 0) * context.rules.combatDistanceScale || radius
            : 0;
        //  区域减速（2026-11-17 急冻瓜「冰山陨落」102403）：`auraSlowRatio` 缺省 0 ⇒ 不减速，
        //  与 `castSelfAura` 之前写死 `slowRatio: 0` 的口径逐字一致（无尘禁土 / 喷射火焰不受影响）。
        const slowRatio = Math.max(0, Math.min(1, parameters.auraSlowRatio ?? 0));
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
        //  落地那一击（2026-11-19 急冻瓜「冰山陨落」102403）：冰锥自天而降，砸的点和区域圆心
        //  是同一个点 —— 配上 `auraAtTarget` 之后就是受击目标脚下。一次性 `area` 事件、
        //  伤害 0，只负责交代「陨落」这一下；区域本身的表现仍由 `holdVisual` 那条通道承担。
        //  没登记落地造型的单位（无尘禁土 / 磁电冲击 / 喷射火焰）⇒ 这里什么都不推，行为逐字不变。
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
                //  冰锥本来是水平飞出去的弹体 ⇒ 转 -90° 才变成垂直落下（设计案 O 列原话）。
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
     * 落雷连线：每道雷 = 一个单波地面区域，按 `boltInterval` 逐道出现，首波延迟到 `boltDelay` 判伤。
     * 参数（表值 px）：boltCount / boltSpacing / boltInterval / boltDelay / boltDamageRate /
     * boltRadius / boltNumbChance / boltNumbSeconds。
     * 返回 true = 放出去了，调用方才消费 CD。
    */
    static castBoltLine(state: ZCSnapshot, unit: ZCUnitState,
        context: IZCAttackResolutionContext): boolean {
        const definition = context.effectiveDefinition(unit);
        const profile = definition.attackProfile;
        const parameters = this.skillParamsOf(unit, profile.skillId, context);
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
                + `间距 ${spacing.toFixed(1)}（表值 ${parameters.boltSpacing}）`
                + `，逐道 ${interval}s、延迟 ${delay}s 判伤，单道 ${damage}`
                + `，麻痹 ${(numbChance * 100).toFixed(0)}% / ${numbSeconds}s`);
        }
        return true;
    }

    /**
     * 闪电链（`chain_damage`，雷蕉 68022 / 102203，2026-11-18 第 17 批）。
     *
     * 口径（2026-11-19 第 21 批按用户示意图改判据，见 `ZCChainLightningFx` 文件头）：
     *  · **传导 = 半径 150 px 的圆**：卡牌射出的射线碰到目标 1 之后，以目标 1 为圆心画一个
     *    `chainJumpRadius` 的圆，圆内**每个**还没挨过的敌人都算被传导；它们各自再成为新的圆心，
     *    一层层扩散下去（不是「跳向最近的那一个」）；
     *  · **圈里没人就断**（不回头、不弹回去）；**受击数到 `chainTargetCount` 就停**；
     *  · 逐跳递减：第 k 跳（k 从 0 计）倍率 = `chainDamageRate × (1 - chainFalloff)^k`。
     *    L2 起 `chainFalloff = 0.1` ⇒ 100% / 90% / 81% / 72.9%……
     *    **必须是复利**（与 `splashFalloff` / `bulletFalloff` / `pierceFalloff` 同一套），
     *    写成线性 `1 - 0.1k` 看着差不多，第 6 跳会差出 10 个百分点；
     *  · III 级终跳强制暴击 150%（`chainFinalCritMultiplier`）：与掷出来的暴击取**大者** ——
     *    「必暴 150%」是下限，玩家自己掷出更高暴击时不该被压回 150%。
     *
     * 结算**在同一帧全部完成**（连锁要么全中、要么在圈里没人时提前断）。
     *
     * 表现（2026-11-19 第 21 批用户示意图口径）：
     *  · 起点 = **卡牌中心**，之后每个目标各占一个点 ⇒ n 个目标铺 **n 段**；
     *  · 每段电弧 `z` 转 -90°（美术是竖的），**底端钉在这一段的起点、顶端指向下一段的起点**；
     *  · 段距不够就**复制**成 `ceil(段距 / 单段长度)` 段，再沿长轴各压到 `段距 / 段数`
     *    （只压长轴，闪电粗细不变），末段正好咬住目标中心；
     *  · 整条链**同帧出现**（没有飞行过程），并且**每帧跟随**两端单位重算坐标
     *    （事件带 `followFromUnitId` / `followToUnitId`，模型每帧重写）。
     *
     * 参数（`skillParamJson`，`chain*` 前缀 —— 同一袋里还住着 102204 嗜血术）：
     * chainCooldown / chainTargetCount / chainDamageRate / chainFalloff /
     * chainJumpRadius（表值逻辑 px，现在是**圆的半径**）/ chainFinalCritMultiplier。
     *
     * 返回 false ⇒ 参数不全 / 没有活着的单位目标，调用方不要消费 CD。
    */
    static castChainLightning(state: ZCSnapshot, unit: ZCUnitState,
        context: IZCAttackResolutionContext): boolean {
        const definition = context.effectiveDefinition(unit);
        const profile = definition.attackProfile;
        const parameters = this.skillParamsOf(unit, profile.skillId, context);
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
        //  终跳强制暴击是「倍率」而不是「开关」：缺省 1 = 不强制，III 级配 1.5。
        const finalCritMultiplier = Math.max(1, parameters.chainFinalCritMultiplier ?? 1);
        //  `chainJumpRadius` 也是硬条件：漏配时链条只能打到首个目标，那种「技能放了但像没放」
        //  的静默错比拒放更难查，所以和道数 / 倍率一样按「参数不全」处理。
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
        //  只认同「活着的敌方单位」：`damageUnit` 只吃 `ZCUnitState`，建筑 / 地块没有血条。
        //  锁定的是建筑时按「没目标」处理（不消费 CD、下帧重试）—— 雷蕉是法师，
        //  它的锁定目标本来就该是个单位；硬给建筑开一条分支只会多一套没人验过的路径。
        let firstUnit = target && target.kind === 'unit'
            ? state.units.find((candidate) => candidate.id === target.id)
            : undefined;
        if (!firstUnit && target && target.kind !== 'unit') {
            const fallback = this.stormDeliveryTarget(unit, context.unitPosition(unit), context, definition, context.rules.combatDistanceScale);
            if (fallback) firstUnit = state.units.find((candidate) => candidate.id === fallback.id);
        }
        if (!firstUnit || firstUnit.battleState === 'dead' || firstUnit.hp <= 0) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`chain-target:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} 闪电链没有活着的单位目标 ⇒ 不消费 CD，下帧重试`);
            }
            return false;
        }
        //  收集「挨打名单」：首跳 = 锁定目标；之后**逐圈扩散** ——
        //  每命中一个敌人，它自己就变成一个新的圆心（用户原话「范围内有其他目标敌人
        //  （又会产生 1 个目标 2 为圆心的判定范围）」），圆心按**命中顺序**依次扩散（BFS）。
        //
        //  🔴 三个「照直觉写就错」的点：
        //   1. 用 id 集合去重，不比对对象引用 —— 单位池化复用时对象会换身份；
        //   2. 一个圆内**所有**未命中的敌人都算被传导，不是「取最近的那个」；
        //   3. 扩散顺序由 `state.units` 的顺序决定（有实数组）⇒ 同一份战场状态重放出来的
        //      链条完全一致；`cursor` 只往前走，绝不回头补扫已经扩过的圆。
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
        //  暴击按「这一轮」掷一次（同一轮技能一会儿暴一会儿不暴只会让飘字抖，与
        //  `castFanSweep` / `castBoltLine` 同一条口径）；克制按**每一跳各自的守方**算
        //  —— 链条上每张卡的职业不同，拿首目标那一份会明显打歪。
        const rolledCrit = this.criticalMultiplier(unit, context);
        for (let index = 0; index < victims.length; index += 1) {
            const victim = victims[index];
            const criticalMultiplier = index === victims.length - 1
                ? Math.max(rolledCrit, finalCritMultiplier)
                : rolledCrit;
            const counterMultiplier = this.counterMultiplierFor(
                unit, victim.owner, victim.unitId, context, victim.id);
            const damage = Math.round(this.unitDamage(context, unit, victim.owner, victim.unitId,
                damageRate * Math.pow(1 - falloff, index), victim.id) * criticalMultiplier);
            const floatTextKind = damageFloatTextKind(criticalMultiplier > 1, counterMultiplier);
            const hitText = context.damageUnit(victim, damage, {
                owner: unit.owner, kind: 'unit', unitId: unit.id, floatTextKind,
            });
            this.applyLifesteal(unit, hitText, context);
            context.tryExecuteUnit(victim, undefined, unit.owner, unit.id, hitText);
        }
        //  ── 表现：从卡牌中心起，逐个目标铺电弧（2026-11-19 第 21 批示意图口径）──
        //  ① 起点 = **卡牌中心**（图上的红圈），之后每个目标各占一个点 ⇒ n 个目标铺 n 段；
        //     「取消中间飞的过程」仍然成立：这一版没有弹道飞行，弧是直接长出来的；
        //  ② 整条链同帧出现（`startedAt` 全部是当前时刻），不逐跳错开；
        //  ③ 每段带两端的单位 id，模型**每帧**按两端当前位置重算 —— 卡牌不动、敌人移动时，
        //     尾端就跟着旋转 / 伸缩（用户原话「技能尾端会跟随旋转或伸缩」）。
        const points = victims.map((victim) => context.unitPosition(victim));
        //  链首那一段的起点锚是**施法者自己**（`unit.id`），其余段落从上一个目标长出。
        const anchors = [unit.id, ...victims.map((victim) => victim.id)];
        const ends = [origin, ...points];
        for (let index = 1; index < ends.length; index += 1) {
            //  兜底方向：贴脸 / 同一格时两点算不出方向 ⇒ 沿用上一段的方向，第一段用施法者朝向。
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
     * 铺一条「从 `from` 指向 `to`」的电弧（闪电链 102203 专用，2026-11-19 第 21 批）。
     *
     * 口径（用户原话 + 示意图）：
     *  · 「特效的 z 轴应该旋转 90°」—— 美术是一根**竖着**的闪电，长轴 = 本地 +y；
     *    要让长轴躺到「起点 → 终点」上，旋转角 = 链路方向 `+ (-90°)`；
     *  · 「红色圆圈是起点，在释放技能的卡牌中心点；绿色框是尾部，在目标的中心位置」——
     *    预制体已把**底端**钉在节点原点（`_lpos.y` = 屏上高度的一半），
     *    所以节点摆在起点，弧就从起点长出去；
     *  · 「长度不够…可以拉伸特效或者复制多个节点（复制后压缩）连接目标」——
     *    段数仍是 `ceil(段距 / 单段长度)`，每段沿长轴压到 `段距 / 段数`，
     *    末段右端正好咬住目标中心（摆位全部由 `zcChainArcPieceLayout` 一处算）；
     *  · 「特效会跟随敌人移动」—— 每条事件带两端的单位 id + 本段序号，
     *    模型每帧重算（`ZCGameModel.syncFollowingCombatEvents`）。
     *
     * 事件仍然是「一对多」的 `area`：起终点都写这一段的**锚点**（视图只认 `to`），
     * 方向单独走 `angleDegrees`；`damage = 0`（伤害已由 `damageUnit` 结算）。
     *
     * @param fromUnitId     这一段起点的跟随锚（第一段是施法者自己，之后是上一个目标）
     * @param toUnitId       这一段终点的跟随锚（当前目标）
     * @param from           这一段的起点（施法者 / 上一个目标的中心点）
     * @param to             这一段的终点（当前目标的中心点）
     * @param fallbackRadians 两点重合时的方向兜底（没有方向 ⇒ 沿用上一段）
    */
    private static pushChainArc(
        state: ZCSnapshot,
        unit: ZCUnitState,
        profile: ZCAttackProfile,
        fromUnitId: number,
        toUnitId: number,
        from: { x: number; y: number },
        to: { x: number; y: number },
        fallbackRadians: number,
        alpha: number,
    ): void {
        const layout = zcChainArcPieceLayout(from.x, from.y, to.x, to.y, fallbackRadians);
        for (let piece = 0; piece < layout.count; piece += 1) {
            //  `offsetX/offsetY`：贴图原点那一截是透明的，节点要沿长轴后退，
            //  有像素的那一段才从段起点开始（否则每段尾巴空 11 屏上，接缝显缝）。
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
                //  起终点写在同一个点上：这条事件的锚点就是**这一段的起点**。
                //  写多目标的包围盒中点会让整条链歪到一边（2026-11-18 的教训）。
                fromX: x,
                fromY: y,
                toX: x,
                toY: y,
                radius: 0,
                damage: 0,
                empowered: false,
                //  整条链同帧出现（用户口径「取消中间飞的过程」）。
                startedAt: state.elapsedSeconds,
                durationSeconds: ZC_CHAIN_EFFECT_SECONDS,
                angleDegrees: layout.angleDegrees,
                effectAlpha: alpha,
                //  跟随锚 + 本段序号：模型每帧按两端当前位置把这一格重新摆一遍。
                followFromUnitId: fromUnitId,
                followToUnitId: toUnitId,
                followPieceIndex: piece,
                followPieceCount: layout.count,
                //  只压长轴：复制之后一起压缩，闪电粗细不变。
                stretchAlongAxis: layout.stretch,
            });
        }
    }

    /**
     * 精密陷阱 / 蘑菇爆炸：原地留一片陷阱区域，敌人触碰引爆（触碰本身不一定掉血），到期也可能主动爆炸。
     * 复用地面区域：`contactRadius` 触碰触发，`expireDamage` 到期均等伤害。
     * 参数（表值 px）：trapDuration / trapRadius / trapDamageRate / trapExplodeRadius /
     * trapExplodeDamageRate / trapForward。
     *
     * 2026-11-18 第 17 批补「投掷段」（毒箭菇「蘑菇爆炸」101704，原名穿甲爆矢）：多认三个参数 ——
     * `trapFlightSpeed`（**逻辑 px / 秒**，用户已裁定不是「每格」）/
     * `trapFlightSeconds`（飞几秒）/ `trapExpireOnTimeout`（0 = 到期无人踩直接消失）。
     * 三个全缺省 ⇒ 出生即落地，103504 的精密陷阱逐字不变。
     *
     * 返回 true = 真的放下了，调用方才消费 CD。
    */
    static castTrap(state: ZCSnapshot, unit: ZCUnitState,
        context: IZCAttackResolutionContext): boolean {
        const definition = context.effectiveDefinition(unit);
        const profile = definition.attackProfile;
        const runtime = this.skillRuntimeOf(unit, profile.skillId, context);
        if (!runtime) return false;
        const parameters = runtime.parameters;
        //  爆炸附带的中毒（101704）：id 走计划行的 `statusId` 列（与 `castBurstSkill` 同口径），
        //  秒数走 `trapStatusSeconds`。不带这个前缀的裸 `statusId` 不进参数袋 ——
        //  `skillParamJson` 是「一卡一袋」，塞进去会串到同卡其他技能。
        const hitStatusId = runtime.statusId;
        const scale = context.rules.combatDistanceScale;
        //  `trapDuration` 在投掷形态下是**落地后停留**的秒数，不含飞行段（飞行段由
        //  `trapFlightSeconds` 单独给）—— 设计原文就是分开写的：「飞行 2 秒……落点停留 6 秒」。
        const staySeconds = Math.max(0, parameters.trapDuration ?? 0);
        const contactTable = Math.max(0, parameters.trapRadius ?? 0);
        const contactRate = Math.max(0, parameters.trapDamageRate ?? 0);
        const explodeTable = Math.max(0, parameters.trapExplodeRadius ?? 0);
        const explodeRate = Math.max(0, parameters.trapExplodeDamageRate ?? 0);
        const flightSpeed = Math.max(0, parameters.trapFlightSpeed ?? 0);
        const flightSeconds = Math.max(0, parameters.trapFlightSeconds ?? 0);
        const flying = flightSpeed > 0 && flightSeconds > 0;
        //  到期自爆缺省开：103504 靠它收尾（无人踩中也得炸）。101704 配 0 ⇒ 到期直接消失。
        const expireOnTimeout = (parameters.trapExpireOnTimeout ?? 1) > 0;
        if (!(staySeconds > 0) || !(contactTable > 0)
            //  触碰伤害可以为 0，但**只有投掷形态允许** —— 那时踩响只是引爆，伤害全在爆炸那一份。
            //  原地陷阱若把 `trapDamageRate` 漏配，静默变成「踩上去不掉血」是很难查的错，
            //  所以这里仍然按参数不全拒掉，让它不消费 CD、下帧重试。
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

        //  暴击 / 克制按放下那一刻的当前目标算一次，两份伤害（触碰 / 爆炸）共用 ——
        //  与 `castSelfAura` / `castBoltLine` 同一口径：区域只存标量，逐帧重算会让
        //  「同一片陷阱」一会儿暴一会儿不暴。触发时目标可能已经换了人，这是刻意的：
        //  陷阱是「布置时灌注的能量」，不是「每次踩都重新掷一次骰」。
        const target = context.currentTarget(unit);
        const targetOwner = target ? this.targetOwner(state, target, context) : unit.owner;
        const targetCardId = target ? target.cardId : null;
        const targetUnitId = target && target.kind === 'unit' ? target.id : undefined;
        const criticalMultiplier = this.criticalMultiplier(unit, context);
        const counterMultiplier = target
            ? this.counterMultiplierFor(unit, targetOwner, targetCardId, context, targetUnitId)
            : 1;
        const floatTextKind = damageFloatTextKind(criticalMultiplier > 1, counterMultiplier);
        //  触碰伤害允许为 0（101704 蘑菇爆炸：踩响只是引爆）。这里必须**显式跳过计算**：
        //  `unitDamage(…, 0)` 会按「伤害至少 1 点」兜底，白给一个 1 点伤害 + 一条「-1」飘字。
        const contactDamage = contactRate > 0
            ? Math.round(this.unitDamage(context, unit, targetOwner, targetCardId, contactRate,
                targetUnitId) * criticalMultiplier)
            : 0;
        const explodeDamage = Math.round(
            this.unitDamage(context, unit, targetOwner, targetCardId, explodeRate,
                targetUnitId) * criticalMultiplier);

        const origin = context.unitPosition(unit);
        //  放置点：设计案原文是「原地坐标」⇒ 缺省就压在脚下（`trapForward` 缺省 0）。
        //  留这个参数是为了以后要「往前丢一格」时改配表就行，不用再动代码。
        const forward = Math.max(0, parameters.trapForward ?? 0) * scale;
        const x = forward > 0 ? origin.x + Math.cos(unit.facingRadians) * forward : origin.x;
        const y = forward > 0 ? origin.y + Math.sin(unit.facingRadians) * forward : origin.y;

        //  投掷段的初速：**朝目标**（设计原话「朝目标丢出陷阱」），而不是朝正面。
        //  锁不到人（目标已死 / 被清场）就退回正面朝向 —— CD 已经走到这一步了，
        //  不能因为「没人可丢」把整次出手吞掉；那样这条车道的实际 CD 会变得不可预测。
        let velocityX = 0;
        let velocityY = 0;
        if (flying) {
            //  `ZCCombatTarget` 自带 `x / y`（与 `unitPosition` 同一套世界坐标），
            //  而且可能是建筑 / 地块 —— 走 `unitPosition` 会拿不到（它只认 `ZCUnitState`）。
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
            //  `radius` = 爆炸半径（到期通道按它打全部敌人）；触碰用 `contactRadius`。
            radius: explodeTable * scale,
            owner: unit.owner,
            sourceUnitId: unit.id,
            skillId: profile.skillId,
            skillName: profile.name,
            //  常驻表现（`idle` 循环）跟着区域走，位置由 `syncHoldVisual` 每帧同步。
            effectPrefabPath: ZC_TRAP_IDLE_PREFAB_PATH,
            holdVisual: true,
            //  投掷段：飞行期间播的是「抛出去的那个东西」，落地才换成常驻的 `idle`。
            //  换挡由 `ZCGroundZoneSystem.settleFlight` 在落地那一刻做（摘掉飞行段
            //  那条事件 → 下一帧按 `effectPrefabPath` 重建）。
            //  🔴 飞行段固定播**陷阱生成**（`科学家_陷阱_出现`），不跟着这张卡的普攻弹体走
            //  （2026-11-20 用户裁定，同日第二次口径）：「丢技能的这段特效使用的应该是陷阱生成，
            //  而不是普攻的子弹」。理由是对得上语义 —— 丢出去的就是那颗陷阱，落地后换成常驻的
            //  `idle`，两段是同一套美术的前后半段；用普攻弹体则会看成「放了个法术弹」，
            //  落地突然变成陷阱，前后不是一件事。
            //  也不要改成「有配弹体就用弹体」：`profile.effectPrefabPath` 是**普攻**那一格，
            //  换一张卡就会跟着换皮，同一技能在不同卡上长得不一样。
            flightVisualPath: flying ? ZC_TRAP_SPAWN_PREFAB_PATH : undefined,
            //  抛掷弧线（2026-11-20）：`flightTotalSeconds` 给进度分母、`flightArcPx` 给峰高，
            //  `settleFlight` 每帧把 `visualLiftPx` 刷成抛物线 —— 只改竖直表现，不动地面坐标。
            flightTotalSeconds: flying ? flightSeconds : undefined,
            flightArcPx: flying ? ZC_TRAP_FLIGHT_ARC_PX : undefined,
            //  生成动画先播 0.4s，常驻光环推后出场 —— 两段美术，同帧会双影。
            //  投掷形态不需要这段延迟：飞行段自己就是「生成」，落地那一拍要立刻接上常驻。
            visualDelaySeconds: flying ? 0 : ZC_TRAP_SPAWN_SECONDS,
            //  总寿命 = 投掷段 + 停留段。飞行段由 `flightSeconds` 单独读秒（飞满就停），
            //  两段共用一个 `remainingSeconds` 才不会「落地后又从头数一遍」。
            remainingSeconds: staySeconds + flightSeconds,
            //  陷阱没有「波次」：伤害只在触碰 / 到期两个时刻各结算一次。
            wavesLeft: 0,
            nextWaveAt: state.elapsedSeconds + staySeconds + flightSeconds,
            waveInterval: Math.max(0.05, staySeconds + flightSeconds),
            flightSeconds: flying ? flightSeconds : undefined,
            moveVelocityX: flying ? velocityX : undefined,
            moveVelocityY: flying ? velocityY : undefined,
            //  只有踩响才炸：101704 的「到期无人触碰直接消失」。
            expireRequiresContact: expireOnTimeout ? undefined : true,
            damage: 0,
            slowRatio: 0,
            floatTextKind,
            contactRadius: contactTable * scale,
            contactDamage,
            expireDamage: explodeDamage,
            //  爆炸顺手挂中毒（101704）：`resolveExpiry` 会给圈内**每个**还活着的人各挂一次。
            //  缺 `statusId` 或秒数 ≤ 0 ⇒ 两个字段都是 undefined，既有陷阱一字不变。
            expireStatusId: hitStatusId,
            expireStatusDuration: Math.max(0, parameters.trapStatusSeconds ?? 0) || undefined,
            expirePrefabPath: zcTrapExpirePath(unit.unitId),
            expireFxSeconds: ZC_TRAP_EXPIRE_SECONDS,
        });

        //  生成那一段是独立的一条一次性表现（`start00~11`），不是区域的持有视觉：
        //  它只活 0.4s，与区域寿命无关。时长必须 ≥ 动画总长，否则尾段会被事件裁剪摘掉。
        //  🔴 投掷形态不推这一条：施法点那条「出现」会留在原地，而真正的投掷物已经飞走了
        //  （用户口径「飞行期间播生成」）—— 飞行段的表现由 `flightVisualPath` 跟着区域走。
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
                //  纯表现：两份伤害分别由触碰与到期结算，这里给 0。
                damage: 0,
                empowered: false,
                startedAt: state.elapsedSeconds,
                durationSeconds: ZC_TRAP_SPAWN_SECONDS,
            });
        }

        if (zcSkillCastWatched(unit.unitId)) {
            skillCastLog('施法', `${unit.unitId}#${unit.id} 放下【${profile.name}】：`
                + (flying
                    //  投掷段：速度和秒数都要写出来，否则「飞了多远」只能靠数格子猜。
                    ? `投掷 ${flightSpeed}px/s × ${flightSeconds}s（${(flightSpeed * flightSeconds).toFixed(0)}px）`
                        + `、落地停留 ${staySeconds}s${expireOnTimeout ? '、到期自爆' : '、到期直接消失'}、`
                    : `存活 ${staySeconds}s、`)
                + `触碰 ${contactTable}px/${contactDamage}、`
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
        const parameters = this.skillParamsOf(unit, profile.skillId, context);
        if (!parameters) return false;
        const damageRate = Math.max(0, parameters.shotDamageRate ?? 0);
        const splashTable = Math.max(0, parameters.shotRadius ?? 0);
        const splashRadius = splashTable * context.rules.combatDistanceScale;
        if (!(damageRate > 0) || !(splashRadius > 0)) {
            //  诊断：走得到施法函数、但表没配上（与 `castSelfAura` 的参数诊断同一条思路）。
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`splash-params:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} ${profile.name}（wind_bolt）参数不全：`
                    + `damageRate=${damageRate} shotRadius=${parameters.shotRadius ?? 'undefined'}`
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
     * （风弹慢慢飘，飘到哪算哪）。速度是表值 `windSpeed`，2026-11-23 由 70 提到 **175**
     * 逻辑 px/s（×2.5，满射程 260 约 1.5 秒到）—— 仍比普攻弹速慢，但不再慢到「飘到寿命
     * 结束还打不着人」。借用 `strikeTargets` 的分支就得再开一个「寿命覆盖」参数，
     * 反倒比这里直接写清楚更难读。
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
        const parameters = this.skillParamsOf(unit, profile.skillId, context);
        if (!parameters) return false;
        const damageRate = Math.max(0, parameters.windDamageRate ?? 0);
        const speedTable = Math.max(0, parameters.windSpeed ?? 0);
        const lifeSeconds = Math.max(0, parameters.windLifeSeconds ?? 0);
        const zoneRate = Math.max(0, parameters.windZoneDamageRate ?? 0);
        const zoneRadiusTable = Math.max(0, parameters.windZoneRadius ?? 0);
        const zoneSeconds = Math.max(0, parameters.windZoneSeconds ?? 0);
        if (!(damageRate > 0) || !(speedTable > 0) || !(lifeSeconds > 0)
            || !(zoneRate > 0) || !(zoneRadiusTable > 0) || !(zoneSeconds > 0)) {
            //  诊断：走得到施法函数、但表没配上（与 `castSplashShot` 的参数诊断同一条思路）。
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
        const parameters = this.skillParamsOf(unit, profile.skillId, context);
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
        if (zcSkillCastWatched(shooter ? shooter.unitId : '')) {
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
        context: IZCAttackResolutionContext, guardStatusId?: string,
        lane: 'burst' | 'venom' = 'burst'): boolean {
        const definition = context.effectiveDefinition(unit);
        const profile = definition.attackProfile;
        const runtime = this.skillRuntimeOf(unit, profile.skillId, context);
        if (!runtime) return false;
        const parameters = runtime.parameters;
        //  参数前缀分车道（2026-11-18 第 17 批）：诅咒菇 68018 同时挂着「菌核爆裂 101804」
        //  和「毒液喷吐 101803」，`skillParamJson` 按 `${unitId}:${pvpSkillId}` 合并成一袋
        //  ⇒ 两条技能都叫 `burstRadius` 会互相覆盖。所以毒液喷吐整条用 `venom*`，
        //  这里按 lane 取前缀，实现只有一份。
        const damageRate = Math.max(0, parameters?.[`${lane}DamageRate`] ?? 0);
        const radiusTable = Math.max(0, parameters?.[`${lane}Radius`] ?? 0);
        //  命中后的附带状态（101803 中毒）：走计划行的 `statusId` 列 —— 那本来就是
        //  「命中了给被打的人挂什么」，与普攻的 `onHitStatusId` 同一条语义，只是这里一次挂给圈内所有人。
        const hitStatusId = runtime?.statusId;
        const radius = radiusTable * context.rules.combatDistanceScale;
        if (!(damageRate > 0) || !(radius > 0)) {
            //  诊断：走得到施法函数、但表没配上（与 `castSplashShot` / `castSelfAura` 同一条思路）。
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`burst-params:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} 自心爆发（${profile.name}）参数不全：`
                    + `damageRate=${damageRate} ${lane}Radius=${radiusTable || 'undefined'}`
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
        const knockbackCells = Math.max(0, parameters?.[`${lane}KnockbackCells`] ?? 0);
        let statusApplied = false;
        for (const victim of victims) {
            const hitText = context.damageUnit(victim, damage, {
                owner: unit.owner, kind: 'unit', unitId: unit.id, floatTextKind,
            });
            this.applyLifesteal(unit, hitText, context);
            context.tryExecuteUnit(victim, undefined, unit.owner, unit.id, hitText);
            //  附带减益（中毒）挂在「还活着、没被处决掉」的目标上：死人挂毒没有意义，
            //  而且会在状态系统里留一条指向死人的实例。
            if (hitStatusId && victim.hp > 0 && victim.battleState !== 'dead') {
                const result = context.statusSystem.apply(String(victim.id), hitStatusId,
                    { at: state.elapsedSeconds });
                if (result.applied) statusApplied = true;
            }
            if (knockbackCells > 0 && victim.hp > 0) {
                //  格 → 逻辑坐标：`HEX_GRID_LOGICAL_ROW_STEP` 是「一格行距」，
                //  乘 `combatDistanceScale` 由 `applyLegacyKnockback` 自己完成（与扇形同一条路）。
                context.applyKnockback(victim, unit, knockbackCells * HEX_GRID_LOGICAL_ROW_STEP);
            }
        }
        //  自护盾（菌毯爆发）：伤害结算完再套，护盾吸收的是**之后**打来的伤害。
        //  与 `selfShieldRatio`（`sendAttack` 里那条单体护盾）复用同一个 `applySelfShield`：
        //  取最大值、写 `shieldExpireAt`，到期由 `ZCSkillTriggerSystem.expireShield` 清零。
        const shieldRatio = Math.max(0, parameters?.[`${lane}ShieldRatio`] ?? 0);
        const shieldSeconds = Math.max(0, parameters?.[`${lane}ShieldSeconds`] ?? 0);
        if (shieldRatio > 0) this.applySelfShield(state, unit, shieldRatio, shieldSeconds);
        //  III 级的「护盾期间受到伤害降低」：定义由触发系统注册，这里只挂到施法者身上。
        if (guardStatusId && shieldSeconds > 0) {
            context.statusSystem.apply(String(unit.id), guardStatusId,
                { at: state.elapsedSeconds, durationSeconds: shieldSeconds });
            state.statusEffects = context.statusSystem.exportSnapshot();
        } else if (statusApplied) {
            //  命中附带的中毒也要落进快照，否则视图上中毒图标不出现、状态栏也不显示。
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
     * 大吼大叫（`roar`，2026-11-18 第 17 批 南瓜战神 102304）—— 范围伤害 + 敌方减攻 + 友军护盾三合一。
     *
     * 设计 K/L/M：对周围敌人造成 80/110/150% 伤害并降低其攻击 20/30/40%，持续 3/4/5 秒；
     * III 级同时给周围友军套一层护盾。N 列：「护盾是一次性吸收量，不回复生命，到期即失效」。
     *
     * 五条实现口径（都为了不静默错）：
     *  1. **没有敌人就拒放**（不消费 CD）：与 `castBurstSkill` 同一条口径 —— 空放一次怒吼既没伤害
     *     也没减攻，白白吃掉 8 秒冷却是最难查的那种「技能好像没生效」。
     *  2. **减攻走状态 `attackPct`（负值）**，不是 `damageRatePct` —— 后者是「造成的伤害」，
     *     会被同一张卡的第三条链读到；而且减攻还得让面板跟着掉，`attackPct` 才是对的那一格。
     *  3. **护盾取「施法者最大生命 × 比例」再挂给每个友军**：「自身 15% 最大生命」里的「自身」
     *     指吼的人（南瓜战神）。挂到友军身上时**取最大值**，不叠加 —— 与 `applySelfShield` 同一口径，
     *     否则两个坦克轮流吼能把护盾叠成血条。
     *  4. **护盾到期时间写在友军自己身上**（`shieldExpireAt`），由 `ZCSkillTriggerSystem.expireShield`
     *     统一清零；到期即失效、不回血。
     *  5. 减攻状态 id 带上百分比与秒数（`__roar:<pct>:<sec>__`），同参数复用同一条定义。
     */
    static castRoar(state: ZCSnapshot, unit: ZCUnitState,
        context: IZCAttackResolutionContext): boolean {
        const definition = context.effectiveDefinition(unit);
        const profile = definition.attackProfile;
        const parameters = this.skillParamsOf(unit, profile.skillId, context);
        if (!parameters) return false;
        const damageRate = Math.max(0, parameters.roarDamageRate ?? 0);
        const radiusTable = Math.max(0, parameters.roarRadius ?? 0);
        const attackPct = parameters.roarAttackPct ?? 0;
        const seconds = Math.max(0, parameters.roarSeconds ?? 0);
        const shieldRatio = Math.max(0, parameters.roarAllyShieldRatio ?? 0);
        const radius = radiusTable * context.rules.combatDistanceScale;
        if (!(damageRate > 0) || !(radius > 0)) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`roar-params:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} 大吼大叫参数不全：damageRate=${damageRate}`
                    + ` roarRadius=${radiusTable || 'undefined'} ⇒ 不出手、不消费 CD`);
            }
            return false;
        }
        const origin = context.unitPosition(unit);
        const victims = state.units.filter((candidate) => {
            if (candidate.owner === unit.owner || candidate.battleState === 'dead' || candidate.hp <= 0) return false;
            const pos = context.unitPosition(candidate);
            return Math.hypot(pos.x - origin.x, pos.y - origin.y) <= radius;
        });
        if (!victims.length) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`roar-empty:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} 半径 ${radiusTable} 表值 px 内没有敌人 ⇒ 不消费 CD，下帧重试`);
            }
            return false;
        }
        const primary = victims.reduce((best, candidate) => {
            const pos = context.unitPosition(candidate);
            const bestPos = context.unitPosition(best);
            return Math.hypot(pos.x - origin.x, pos.y - origin.y)
                < Math.hypot(bestPos.x - origin.x, bestPos.y - origin.y) ? candidate : best;
        }, victims[0]);
        const criticalMultiplier = this.criticalMultiplier(unit, context);
        const counterMultiplier = this.counterMultiplierFor(unit, primary.owner, primary.unitId, context, primary.id);
        const damage = Math.round(this.unitDamage(context, unit, primary.owner, primary.unitId,
            damageRate, primary.id) * criticalMultiplier);
        const floatTextKind = damageFloatTextKind(criticalMultiplier > 1, counterMultiplier);
        //  怒吼的「环」：复用爆点 prefab，屏上直径按判定半径反算（与 `castBurstSkill` 同一套）。
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
            this.applyLifesteal(unit, hitText, context);
            context.tryExecuteUnit(victim, undefined, unit.owner, unit.id, hitText);
        }
        //  减攻：挂在「还活着、没被处决掉」的目标上（死人挂减益没有意义，还会在状态系统里留一条孤儿实例）。
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
        //  III 级：护盾给「半径内的友军（含自己）」。
        if (shieldRatio > 0) {
            for (const ally of state.units) {
                if (ally.owner !== unit.owner || ally.battleState === 'dead' || ally.hp <= 0) continue;
                const pos = context.unitPosition(ally);
                if (Math.hypot(pos.x - origin.x, pos.y - origin.y) > radius) continue;
                ally.shield = Math.max(ally.shield ?? 0, unit.maxHp * shieldRatio);
                if (seconds > 0) ally.shieldExpireAt = state.elapsedSeconds + seconds;
            }
        }
        if (statusApplied) state.statusEffects = context.statusSystem.exportSnapshot();
        if (zcSkillCastWatched(unit.unitId)) {
            skillCastLogChanging(`roar-cast:${unit.id}`, '施法',
                `${unit.unitId}#${unit.id} 怒吼【${profile.name}】：倍率 ${damageRate}、`
                + `半径 ${radiusTable} 表值 px、命中 ${victims.length} 人、单发 ${damage}、`
                + `减攻 ${attackPct}%·${seconds}s、友军护盾 `
                + `${shieldRatio > 0 ? `${(shieldRatio * 100).toFixed(0)}%×${Math.round(unit.maxHp)}` : '无'}`);
        }
        return true;
    }

    /**
     * 飓风（`storm_zone`，2026-11-18 第 17 批 三叶小丑 68020 的 102004）。
     *
     * 设计 K/L/M：「在场上生成一个飓风，飓风会牵引敌人并每 0.5 秒造成 10% 伤害，持续 6/7/8 秒」；
     * N 列补两条：「移动速度 10px，方向随机变化」「与已有的 legacy_traction 完全契合」。
     *
     * 落在 `groundZones` 而不是当场结算：它要**在场上待 6~8 秒、每 0.5 秒打一次、还会走动**，
     * 区域系统本来就有「移动 + 分波 + 每步重判」这套能力（暴风 / 小鹿 / 101303 的飓风都在用）。
     *
     * 参数（`skillParamJson`，`storm*` 前缀；`68020:30714` 这袋里还住着 102001 / 102002 的克制条，
     * 裸写 `radius` / `seconds` 会串到那两条且**不报错**）：
     * `stormCooldown` / `stormRadius` / `stormSeconds` / `stormInterval` / `stormDamageRate` /
     * `stormWanderSpeed` / `stormTurnSeconds` / `stormPullSpeed` / `stormPullRadius`。
     *
     * 🔴 三条口径：
     *  1. **不设 `hitOncePerUnit`**：那是「同一个敌人全程只挨一次」（101303 的接触判定），
     *     这条设计明写「每 0.5 秒造成 10%」，站在里面就得一直挨 —— 靠 `waveInterval = 0.5` 复打。
     *  2. **走位与牵引都在区域里算**（`ZCGroundZoneSystem.advanceWander` / `pullEnemies`），
     *     不挂 `legacyTraction` 状态：那条车道的力心是**单位坐标**，挂在施法者身上会变成
     *     「把人往射手身上拽」，而设计要的是往**风心**拽。
     *  3. **场上没有敌人也不拒放**：区域活 6~8 秒，敌人走过来照样挨打、照样被拽，
     *     这与「一次性爆发打空气」不是一回事（怒吼 102304 那种才需要拒放省 CD）。
     *  4. **先从本体飞到目标，落地再开始读秒**（2026-11-20 第 28 批，用户原话「没有从卡牌
     *     本体移动到目标的过程…改成和卡牌的移速一样，初始生成的大小只有 10%，随着移动
     *     过程逐渐成长」）：出生点仍是本体脚下，但挂 `approachSpeed = 卡牌面板移速`
     *     （`unitMoveSpeed`，**世界 px/s，不再乘 `combatDistanceScale`** —— 它和
     *     `ZCMovementSystem.speedOf` 同一个口径）飞向 `currentTarget`，`arriveWander`
     *     让它在到点后交还给随机游走。赶路期 `isApproaching` 为真 ⇒ 不读秒、不打波次，
     *     所以 `stormSeconds` 是「落地后再活 N 秒」，赶路时间不吃它的寿命。
     *     这份成长只覆盖画面：`growSeconds` 取「直线赶路耗时」、`growFrom` 取 0.1。
     *     没有活目标（或在打墙/建筑）⇒ 退回老口径：就在本体脚下生成、不长距离飞行。
     *
     * 伤害按**施放那一刻的克制关系**烘一次：区域每 0.5 秒打的是不同的人，逐个算克制会让
     * 同一个 `zone.damage` 每波都不同（区域只存一个标量），所以与 101303 的飓风同一口径。
     *
     * 返回 `false` ⇒ 参数不全（半径 / 时长 / 间隔任一为 0），调用方不要消费 CD。
    */
    static castStorm(state: ZCSnapshot, unit: ZCUnitState,
        context: IZCAttackResolutionContext): boolean {
        const definition = context.effectiveDefinition(unit);
        const profile = definition.attackProfile;
        const parameters = this.skillParamsOf(unit, profile.skillId, context);
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
        //  克制按「施放那一刻的对手」烘一次（与 101303 的飓风逐字同口径）：
        //  区域每波打的是不同的人，逐个算会让同一个 `zone.damage` 每波都不一样。
        const rivalOwner = unit.owner === ZCOwner.Player ? ZCOwner.Enemy : ZCOwner.Player;
        const damage = Math.max(1, Math.round(
            this.unitDamage(context, unit, rivalOwner, null, damageRate)));
        //  表值 → 世界坐标：与 `attackRange` / `zoneMoveSpeed` 同一套口径（都乘 `combatDistanceScale`）。
        const wanderSpeed = Math.max(0, parameters.stormWanderSpeed ?? 0) * scale;
        const turnSeconds = Math.max(0.05, parameters.stormTurnSeconds ?? 1);
        const pullSpeed = Math.max(0, parameters.stormPullSpeed ?? 0) * scale;
        const pullRadius = Math.max(0, parameters.stormPullRadius ?? 0) * scale;
        //  投送段（方法头第 4 条）：从本体脚下出发、用**卡牌面板移速**飞向当前目标。
        //  `moveSpeed` 已经是世界 px/s（`ZCMovementSystem.speedOf` 直接 `moveSpeed * dt`），
        //  🔴 不能再乘 `combatDistanceScale` —— 乘了就是每秒 8.4px 的蜗牛（配表那 10px/秒
        //  的游走速度正是这么来的，也是用户「看起来没动」的根因）。
        const travelSpeed = Math.max(0, definition.moveSpeed);
        const lock = context.currentTarget(unit);
        //  只追**单位**：调色板里还有墙 / 建筑，那两种没有 `approachTargetId` 可追，
        //  硬追会让区域一路飞到城墙脚下再定住（那里一个敌人都没有）。
        const lockedTarget = lock && lock.kind === 'unit' && lock.id > 0 ? lock : null;
        //  🔴 锁定目标不是活单位时自己再找一次（2026-11-20 修「一加闸门就不飞了」）：
        //  触发闸门 `release` 走 `ZCUnitTargeting.hasTargetInAttackRange` —— 锁不上就**全表扫**
        //  射程内有没有活敌；而 `currentTarget` 读的是 `targetUnitId`，那个锁要等这一拍的
        //  攻击流程跑完才写。闸门恰好会在「敌人刚进圈的第一帧」放行，那一帧常常还没锁定
        //  （或锁的还是城墙）⇒ 投送段拿不到可追的单位、退回原地生成，画面上就是
        //  「有目标了反而长在脚下一动不动」。这里按**同一套射程口径**重扫一遍，
        //  让「闸门放行 ⇒ 必有落点」这条不变量闭合。
        const chaseTarget = lockedTarget ?? this.stormDeliveryTarget(unit, origin, context, definition, scale);
        //  到达容差 = 风半径的 1/4。取 0 会「永远差半步」（目标每帧都在走，而 `advanceChase`
        //  每步都被 clamp 到当时的目标点），取整个半径又会让贴脸的目标直接跳过赶路段、
        //  看不见飞行。四分之一的半径刚好是「风已经罩住目标」的那一圈。
        const arriveRange = radiusTable * scale * 0.25;
        const canTravel = chaseTarget ? travelSpeed > 0 : false;
        //  画面成长时长 = 直线赶路耗时。目标半路改向 / 阵亡只会让风**提前**长满，不会缩回去 ——
        //  视觉只负责「边飞边长大」，不参与判定，所以不值得为它每帧重算。
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
            //  整段一条长效表现跟着风心走：不这么设的话，每 0.5 秒一波会在身后拖出一串
            //  定格的龙卷风（移动区域的通病，见 `syncHoldVisual` 的注释）。
            holdVisual: true,
            //  入场「由小变大」（2026-11-20）：有赶路段就从 10% 起步、飞到目标正好长满；
            //  没有赶路段（无活目标 / 目标贴脸）退回老口径 0.2s 从 0 长起来。
            growSeconds: travelSeconds > 0.05 ? travelSeconds : 0.2,
            growFrom: travelSeconds > 0.05 ? ZC_STORM_GROW_FROM : undefined,
            //  投送段：飞到目标、到点交还游走（`arriveWander`，见区域系统 `releaseToWander`）。
            //  赶路期 `isApproaching` 为真 ⇒ 不读秒、不打波次，所以 `stormSeconds` 是
            //  「落地后再活 N 秒」，赶路时间不吃它的寿命。
            approachSpeed: canTravel ? travelSpeed : undefined,
            approachTargetId: chaseTarget && canTravel ? chaseTarget.id : undefined,
            sprintRange: arriveRange,
            arriveWander: canTravel ? true : undefined,
            remainingSeconds: seconds,
            //  波次数 = 存活秒 ÷ 间隔：`resolveWave` 每 `waveInterval` 打一次，
            //  打满就散场；`remainingSeconds` 同时读秒，两边任一先到都收。
            wavesLeft: Math.max(1, Math.round(seconds / interval)),
            nextWaveAt: state.elapsedSeconds,
            waveInterval: interval,
            damage,
            slowRatio: 0,
            //  走位：速度 + 换向间隔，方向由区域系统按对局种子随机抽（`advanceWander`）。
            wanderSpeed: wanderSpeed > 0 ? wanderSpeed : undefined,
            wanderTurnSeconds: wanderSpeed > 0 ? turnSeconds : undefined,
            //  牵引：力心是这个会飘的圆心（见方法头第 2 条）。
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
     * 投送段的目标兜底：锁定目标不是**活着的单位**时，自己在普攻射程内挑最近的敌人。
     *
     * 为什么要有（2026-11-20 用户实测「改成等目标之后，飓风又不会移动了」）：
     * 触发闸门 `release` 取自 `ZCUnitTargeting.hasTargetInAttackRange` —— 它先看锁定目标，
     * 锁不上就**全表扫一遍**射程内有没有活敌；而 `currentTarget` 读的是 `unit.targetUnitId`，
     * 那个锁要等这一拍的攻击流程跑完才写。闸门恰好会在「敌人刚进圈的第一帧」放行，那一帧
     * 往往还没锁定（或锁的还是城墙）⇒ 投送段拿不到可追的单位，退回「原地生成 + 0.2s 从 0 长起」，
     * 画面上就是一片长在施法者脚下、一动不动的风。
     *
     * 判据与闸门的扫描分支**逐条对齐**，否则又会出现「闸门说有人 / 投送说没人」：
     * 跳过自己与同阵营、跳过尸体、跳过「卡打不了空却来了飞行单位」，射程用
     * `ZCTargetingSystem.attackReach`（= (普攻射程 + 目标半径 × 0.5) × `combatDistanceScale`）。
     *
     * 射程外的一律不追：宁可就地生成，也不要让一片风斜穿半张地图去追一个够不着的目标。
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
     * 射线集束（`ray_beam`，2026-11-19 第 18 批 科学家 68035 的 103503）。
     *
     * 设计 K/L/M：「向前方射出集束射线，持续 2/3/4 秒，每 0.2 秒对命中敌人造成 20/25/35% 伤害」；
     * L2 起「使命中目标受到的伤害提高 10/20%」；L3「射线末端光斑额外造成 50% 范围伤害」。
     * N 列两条口径：「高频射线（每秒 5 跳），目标离开射线立即停止结算」「III 级的额外波及在
     * 射线消失的瞬间结算一次」。
     *
     * 参数（`skillParamJson`，`ray*` 前缀；`68035:30709` 这袋里还住着 103501 穿甲苔刺 /
     * 103502 苔针双连 / 103504 精密陷阱，裸写 `radius` / `seconds` 会串到那三条且**不报错**）：
     * `rayEvery` / `rayHalfLength` / `rayHalfWidth` / `rayForward` / `raySeconds` /
     * `rayInterval` / `rayDamageRate` / `rayVulnPct` / `rayVulnSeconds` /
     * `raySpotRadius` / `raySpotDamageRate`。
     *
     * 🔴 三条实现口径：
     *  1. **矩形 + 跟随本体**（复用区域的 `rectHalfLength/rectHalfHeight` + `followUnitId`）：
     *     射线是「从身上射出去的」，不是扔在地上的。`followForward` 取「起点前移 + 半长」，
     *     圆心才落在矩形的几何中心上；`followCaster` 每帧会把它连同 `angleDegrees` 一起转，
     *     所以本体一转身、射线跟着转（与 101604 磁电冲击同一条通道）。
     *  2. **不设 `hitOncePerUnit`**：设计是「每 0.2 秒五跳」，站在光束里就得一直挨。
     *     「目标离开射线立即停止结算」天然满足 —— 每波都按当前矩形重判。
     *  3. **III 级的光斑是第二个区域**，不是主区域的 `expireDamage`：`expireDamage` 按**区域中心**
     *     的圆结算，而光斑在射线**末端**（中心在身前 halfLength 处），位置差了整整一条射线。
     *     于是建一个 `wavesLeft = 0` 的小区域，与主区域同 `remainingSeconds` 同帧到期，
     *     靠它的到期通道（`expireDamage` + `expirePrefabPath`）在消失那一拍炸一次。
     *
     * 返回 `false` ⇒ 参数不全（长度 / 时长 / 每跳倍率任一为 0），调用方不要消费次数。
    */
    static castRayBeam(state: ZCSnapshot, unit: ZCUnitState,
        context: IZCAttackResolutionContext, vulnStatusId?: string): boolean {
        const definition = context.effectiveDefinition(unit);
        const profile = definition.attackProfile;
        const parameters = this.skillParamsOf(unit, profile.skillId, context);
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
        //  朝向：优先「朝当前锁定目标」，没有目标时退回美术朝向（与 `castFanSweep` 同一条兜底）。
        //  位置与 `angleDegrees` 必须同源 —— 否则会出现「矩形朝目标、圆心在美术朝向那边」。
        const target = context.currentTarget(unit);
        const aim = target && (target.x !== origin.x || target.y !== origin.y)
            ? Math.atan2(target.y - origin.y, target.x - origin.x)
            : unit.facingRadians;
        const halfLength = halfLengthTable * scale;
        const forward = Math.max(0, parameters.rayForward ?? 0) * scale;
        //  圆心 = 起点 + 半长：起点在身前 `forward`，射线全长 `2 × halfLength`。
        const centerForward = forward + halfLength;
        const targetOwner = target ? this.targetOwner(state, target, context) : (unit.owner === ZCOwner.Player
            ? ZCOwner.Enemy : ZCOwner.Player);
        const targetCardId = target ? target.cardId : null;
        const targetUnitId = target && target.kind === 'unit' ? target.id : undefined;
        const damage = Math.round(this.unitDamage(context, unit, targetOwner, targetCardId, damageRate, targetUnitId));
        //  每跳数量：2 秒 / 0.2 = 10 跳，向下取整再加一吸收浮点误差（与 `castSelfAura` 同口径）。
        const waves = Math.max(1, Math.round(seconds / interval + 1e-6));
        const vulnPct = Math.max(0, parameters.rayVulnPct ?? 0);
        const spotRadiusTable = Math.max(0, parameters.raySpotRadius ?? 0);
        const spotRate = Math.max(0, parameters.raySpotDamageRate ?? 0);
        state.groundZones.push({
            x: origin.x + Math.cos(aim) * centerForward,
            y: origin.y + Math.sin(aim) * centerForward,
            //  `radius` 给的是半长（圆形兜底 / 表现尺寸都用它），矩形判定另有两格。
            radius: halfLength,
            owner: unit.owner,
            sourceUnitId: unit.id,
            skillId: profile.skillId,
            skillName: profile.name,
            effectPrefabPath: ZC_RAY_BEAM_PREFAB_PATH,
            //  整段一条长效表现跟着本体走：否则每 0.2 秒会推一条 area 事件，
            //  10~20 条光束叠在同一处，看着像「越来越亮」。
            holdVisual: true,
            growSeconds: 0.1,
            remainingSeconds: seconds,
            wavesLeft: waves,
            nextWaveAt: state.elapsedSeconds,
            waveInterval: interval,
            damage,
            slowRatio: 0,
            //  矩形判定（贴合光束）：两格都是表值逻辑 px，与 `radius` 同一套口径。
            rectHalfLength: halfLength,
            rectHalfHeight: halfWidthTable * scale,
            angleDegrees: aim * 180 / Math.PI,
            //  跟随本体：`followForward` = 圆心到本体的距离，`followCaster` 每帧连朝向一起重写。
            followUnitId: unit.id,
            followForward: centerForward,
            //  「受到的伤害提高」（L2 起）：每波给光束里的敌人挂 / 续一条参数化破甲。
            //  时长只有 0.3 秒（补值）—— N 列要求「目标离开射线立即停止结算」，
            //  残留必须比一跳（0.2s）稍长、又远短于整段，才不会变成「射线走了人还虚着」。
            hitStatusId: vulnPct > 0 ? vulnStatusId : undefined,
            hitStatusChance: vulnPct > 0 ? 1 : undefined,
            hitStatusSeconds: vulnPct > 0
                ? Math.max(interval, parameters.rayVulnSeconds ?? 0.3) : undefined,
            //  事件级缩放：`area` 不按 `radius` 缩放，光束长度全靠这一格（见 `ZCRayBeamFx`）。
            effectScale: zcRayBeamEffectScale(halfLengthTable),
        });
        //  III 级：末端光斑。`wavesLeft = 0` ⇒ 全程不结算波次，只在到期那一拍炸一次；
        //  与主区域同 `remainingSeconds` ⇒ 同一帧消失、同一帧结算（N 列「射线消失的瞬间」）。
        if (spotRadiusTable > 0 && spotRate > 0) {
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
                //  光斑是一次性范围伤害，按同一份面板算（与主射线的可暴击口径保持一致）。
                damage: 0,
                expireDamage: Math.max(1, Math.round(
                    this.unitDamage(context, unit, unit.owner === ZCOwner.Player
                        ? ZCOwner.Enemy : ZCOwner.Player, null, spotRate))),
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
     * 文明之火：在目标点周围撒 N 块持续燃烧的区域（2026-11-23 第 43 批）。
     *
     * 需求原话：「在目标位中心点，200px 半径的圆内，生成 3 个火焰区域，每个火焰区域的大小
     * 都和灼热地带一致，持续时间对应 3 个等级 6/8/10 秒，每秒钟造成的伤害为 100%/110%/120%」。
     *
     * 参数（`fire*` 前缀，同袋还住着 103501 / 103502 / 103504）：
     * `fireCount` / `fireSpreadRadius` / `fireRadius` / `fireSeconds` / `fireInterval` /
     * `fireDamageRate`（`fireEvery` 只在触发系统里读）。
     *
     * 🔴 三条口径：
     *  1. **每个区域各自结算**（用户 2026-11-23 明确「每个区域各自 100%」）：敌人同时站在两块
     *     里就是两倍伤害，不做「三块合计」的摊分。
     *  2. **落点圆内随机**（同一轮确认）：`angle` 取全圆、`distance` 取 `sqrt(random) × R`
     *     （面积均匀，与连射导弹的落点散布同一套），所以三块会各自独立散布、也可能靠得很近。
     *     `context.random()` 是确定性的每方随机流 ⇒ 用例可复现。
     *  3. **每块一个独立区域**，不是一个区域记三份伤害：`ZCGroundZoneSystem` 按每块的
     *     `radius` / `wavesLeft` 各自判命中，站两块挨两下、只站一块挨一下。
     *
     * 返回 `false` ⇒ 参数不全（块数 / 半径 / 散布半径 / 时长 / 每跳倍率任一为 0）或没有目标，
     * 调用方不要消费次数。
    */
    static castFireZone(state: ZCSnapshot, unit: ZCUnitState,
        context: IZCAttackResolutionContext): boolean {
        const definition = context.effectiveDefinition(unit);
        const profile = definition.attackProfile;
        const parameters = this.skillParamsOf(unit, profile.skillId, context);
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
        const targetOwner = this.targetOwner(state, target, context);
        const targetCardId = target.cardId;
        const targetUnitId = target.kind === 'unit' ? target.id : undefined;
        //  每跳每敌伤害：与普攻同一条面板（可暴击 / 可克制），每块区域各自算一次。
        const damage = Math.round(
            this.unitDamage(context, unit, targetOwner, targetCardId, damageRate, targetUnitId));
        //  每秒 1 跳：6 秒 = 6 跳，向下取整再加一吸收浮点误差（与 `castRayBeam` 同口径）。
        const waves = Math.max(1, Math.round(seconds / interval + 1e-6));
        const spread = spreadTable * scale;
        for (let index = 0; index < count; index += 1) {
            //  圆内面积均匀：半径取 sqrt 才不会都挤在圆心（与 `castBarrageShot` 一致）。
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
                //  整段一条长效表现跟着区域走：不设的话每秒会推一条 area 事件，
                //  6~10 条火焰叠在同一处，看着像「越来越亮」。
                holdVisual: true,
                growSeconds: 0.2,
                remainingSeconds: seconds,
                wavesLeft: waves,
                nextWaveAt: state.elapsedSeconds,
                waveInterval: interval,
                damage,
                slowRatio: 0,
                //  蓝色只属于文明之火：同一张图在火焰树妖那边仍是紫品红（见 `ZCFireZoneFx`）。
                tint: [ZC_FIRE_ZONE_TINT[0], ZC_FIRE_ZONE_TINT[1], ZC_FIRE_ZONE_TINT[2]],
            });
        }
        if (zcSkillCastWatched(unit.unitId)) {
            skillCastLogChanging(`fire-cast:${unit.id}`, '施法',
                `${unit.unitId}#${unit.id} 撒下【${profile.name}】：${count} 块 × 半径 ${radiusTable} 表值 px、`
                + `散布 ${spreadTable} 表值 px、${seconds}s / 每 ${interval}s = ${waves} 跳、单跳 ${damage}/块`);
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
        const parameters = this.skillParamsOf(unit, profile.skillId, context);
        if (!parameters) return false;
        const damageRate = Math.max(0, parameters.fanDamageRate ?? 0);
        const radiusTable = Math.max(0, parameters.fanRadius ?? 0);
        const radius = radiusTable * context.rules.combatDistanceScale;
        const fanDeg = Math.max(0, Math.min(360, parameters.fanAngle ?? 120));
        const halfAngle = fanDeg * Math.PI / 360;
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

    /**
     * 「亡者护盾」上盾那一下的表现（2026-11-21 第 37 批）。
     *
     * 用的是 `刀盾兵_护盾` —— 与冲锋落地自保（102303 减伤 / 102703 护盾）同一份 prefab，
     * 也是「刀盾兵」这个原型自带的护盾光圈。字段口径（17 帧 @12fps、半径 / 伤害为 0、
     * `from == to` 钉在原地）全部收在 `ZCDashFx.pushDashGuardVisualEvent` 里 ——
     * 第 38 批「吃口菠萝」的群体版本走的是同一个函数，两边不许各写一份。
     *
     * 🔴 所以这里**不**拿 `shieldSeconds`（10/11/12 秒）当事件时长 —— 那会把一层 loop 动画
     * 钉在原地播十几秒，而本体早就走开了。
     * 🔴 **资源必须进本局清单**：路径登记在 `ZCEffectCatalog` 的 `skill_params` 行为组
     * 按单位覆盖（`68002`）里。漏了就是「预热有、实战没有」—— 结算正常、画面全无。
     */
    private static pushSelfShieldVisual(
        state: ZCSnapshot, unit: ZCUnitState, context: IZCAttackResolutionContext,
        skillId: number, skillName: string,
    ): void {
        const position = context.unitPosition(unit);
        pushDashGuardVisualEvent(state, unit, position.x, position.y, state.elapsedSeconds, skillId, skillName);
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
        const every = runtime ? runtime.parameters.statusEveryNAttacks ?? 0 : 0;
        if (!(every > 0)) return true;
        const count = unit.completedAttackCount ?? 0;
        return count > 0 && count % every === 0;
    }

    static sendAttack(state: ZCSnapshot, unit: ZCUnitState, context: IZCAttackResolutionContext): void {
        const attack = this.prepareAttack(state, unit, context);
        if (!attack) return;
        const { empowered, skillRuntime, activeProfile, event, damage, onHitStatusId, legacyTargetBuffs, floatTextKind } = attack;
        const parameters = skillRuntime ? skillRuntime.parameters : undefined;
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
        //  🔴 这条以前**只加数值、不加表现** ⇒ 玩家看到的是「巨力坚果凭空变硬」（2026-11-21 第 37 批，
        //  用户原话「巨力坚果没有释放刀盾兵的护盾效果」）。表现走 `pushSelfShieldVisual`。
        if (empowered && parameters && parameters.selfShieldRatio > 0) {
            this.applySelfShield(state, unit, parameters.selfShieldRatio, parameters.shieldSeconds ?? 0);
            this.pushSelfShieldVisual(state, unit, context, activeProfile.skillId, activeProfile.name);
        }
        //  连发（豌豆机关枪）：empowered 这一击只打第一颗，余下的按固定间隔排进单位状态，
        //  由 `ZCSkillTriggerSystem` 每步推进。`burstCount` 缺省 1 ⇒ 整段不执行，
        //  原有的「一发 / 多发齐射」路径逐字不变。
        const burstCount = empowered && parameters ? Math.max(1, Math.round(parameters.burstCount ?? 1)) : 1;
        if (burstCount > 1 && parameters && activeProfile.mode === ZCCombatEventType.Projectile) {
            const burstSeconds = Math.max(0.05, parameters.burstSeconds ?? 1.2);
            unit.burstShotsLeft = burstCount - 1;
            unit.burstInterval = Math.max(0.01, burstSeconds / Math.max(1, burstCount - 1));
            unit.burstNextAt = state.elapsedSeconds + unit.burstInterval;
            unit.burstDamageRate = parameters.damageRate ?? activeProfile.damageRate ?? 1;
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
        //  武将技解锁门控（2026-11-19，用户口径「没到技能解锁等级就别放技能」）：
        //  基表 `empoweredEvery` / `empoweredSkillId` 只说明「每几次普攻放一次」，
        //  完全不看等级；「几级解锁」写在 `pvpSkillPlan` 上，构筑期把结论压成
        //  `${unitId}:${pvpSkillId}` 袋里的 `zcEmpoweredLocked`。
        //  这里**照常**调 `consumeEmpoweredAttack` 再作废结果：那个函数顺手累加
        //  `completedAttackCount`，跳过它会让所有「每 N 次普攻」的链路（连击 / 投枪 /
        //  陷阱 / 累计自我增益）一起停摆。代价只是这一次强化机会落空。
        const skillRuntime = this.skillRuntimeOf(unit, profile.skillId, context);
        const skillParams = skillRuntime ? skillRuntime.parameters : undefined;
        const empoweredBeat = ZCCombatSystem.consumeEmpoweredAttack(unit, profile, state.elapsedSeconds);
        const empowered = empoweredBeat
            && (!skillParams || (skillParams[ZC_EMPOWERED_LOCK_PARAM] ?? 0) <= 0);
        //  腾云驾雾（仙桃行者 68009，2026-11-24 第 44 批）：强化那一击不再是「打一发」，
        //  而是四段突进连击 —— 这一步只做两件事：给触发系统留起手标记，然后**不出手**。
        //
        //  🔴 位置必须在 `consumeEmpoweredAttack` 之后：累计普攻数要照常 +1。
        //  用户原话「这个技能的攻击不计入普攻的累计数」指的是后面那 4 段突进（它们走
        //  `strikeTargets`，天然不碰 `completedAttackCount`）；触发它的这一次普攻仍然要记，
        //  否则「每 5 次普攻」这条节拍永远等不到第 5 次。
        //  🔴 序列本身归触发系统：`blinkTo` / `strike` 只接在 `ZCSkillTriggerContext` 那一侧
        //  （与 `blink_strike` / `single_strike` 同一个理由）。同一帧的 `applyDashChain` 接手。
        if (empowered && target.kind === 'unit' && skillParams && (skillParams.dashChainSpeed ?? 0) > 0) {
            unit.dashChainPendingAt = state.elapsedSeconds;
            unit.dashChainTargetId = target.id;
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`dash-chain:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} 强化那一击 → 腾云驾雾起手，目标 1 = ${target.id}`);
            }
            return null;
        }
        //  投枪（`破阵投枪`）：每 N 次普攻把本次攻击替换成一枚远程穿透弹。
        //  与「强化那一击」互斥（撞拍时强化优先），详见 `lanceBeatOf`。
        const lance = this.lanceBeatOf(unit, skillRuntime, empowered);
        //  「这一击固定发几颗」的显式声明（`skillParamJson.projectileCount`，只服务强化那一击）。
        //  与 `bulletNum`（普攻被动「多打 N 发」）是两种语义，必须分开记：
        //  麻辣铁锅 102601 给 `bulletNum +2`、102604 要求「凤凰降临固定 4 颗」，
        //  两者叠在一起会变成 6 颗。所以声明了固定颗数时不再叠加 `bulletNum`。
        //   现有计划行一条都没用过这个键（全表 grep 无命中）⇒ 存量单位行为逐字不变。
        const declaredProjectileCount = empowered && skillParams
            ? Math.max(0, Math.round(skillParams.projectileCount ?? 0))
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
            ? ((skillRuntime ? skillRuntime.statusId : undefined) ?? activeProfile.onHitStatusId)
            : undefined;
        const skillDamageRate = (empowered
            ? (skillParams
                ? (skillParams.impactDamageRate ?? skillParams.damageRate)
                : (definition.empoweredProfile ? definition.empoweredProfile.damageRate : undefined))
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
        const bulletFalloff = Math.max(0, Math.min(1, skillParams ? (skillParams.bulletFalloff ?? 0) : 0));
        const baseProjectileCount = Math.max(1, projectileCount - bulletNumExtra);
        const targetOwner = this.targetOwner(state, target, context);
        const targetUnitId = target.kind === 'unit' ? target.id : undefined;
        const counterMultiplier = this.counterMultiplierFor(
            unit, targetOwner, target.cardId, context, targetUnitId);
        const criticalHit = criticalMultiplier > 1;
        const floatTextKind = damageFloatTextKind(criticalHit, counterMultiplier);
        //  投枪的「首目标 70%」：设计口径是相对面板的倍率，不是相对普攻伤害的折扣 ——
        //  与 `damageRate` / `impactDamageRate` 同一条乘法链，所以直接乘进 `skillDamageRate`。
        const lanceDamageRate = lance
            ? Math.max(0, (skillParams ? skillParams.lanceDamageRate : undefined) ?? ZC_LANCE_DEFAULT_DAMAGE_RATE)
            : 1;
        //  投枪固定走面板伤害，不认旧 skillEffect 的伤害公式（那是近战挥击的算法，套在枪上会跑偏）。
        const damage = legacy.hasDamageFormula && !lance
            ? Math.round(legacy.damage * criticalMultiplier * counterMultiplier)
            : Math.round(this.unitDamage(context, unit, targetOwner, target.cardId,
                skillDamageRate * lanceDamageRate, targetUnitId) * criticalMultiplier);
        if (ZCDC_LOG_DAMAGE_FLOAT && activeProfile.mode !== 'projectile' && !lance) {
            console.info('[伤害飘字][技能出手]', {
                ...this.attackLogFields(unit, definition, context),
                targetKind: target.kind, targetId: target.id,
                skillId: activeProfile.skillId, skillName: activeProfile.name, skillDamageRate, criticalMultiplier,
                counterMultiplier, legacyDamage: legacy.hasDamageFormula ? legacy.damage : undefined, damage,
            });
        }
        const legacyAreaRadius = Math.max(0, legacy.range ?? 0) * context.rules.combatDistanceScale;
        const effectiveAreaRadius = legacyAreaRadius > 0
            ? legacyAreaRadius
            : (activeProfile.areaRadius || 0) * context.rules.combatDistanceScale;
        const from = context.unitPosition(unit);
        //  事件寿命（纯表现）：登记了飞行段的近战特效按「距离 / 速度」算，
        //  否则沿用固定 0.32s。伤害不在这里结算 —— 见下面 `state.combatEvents.push(event)`
        //  之后紧接着的 `context.damageUnit(...)`，所以改它不影响任何数值。
        //  需求 2026-11-02「猎头者的攻击特效需要匹配射程」（`ZCCombatEffectFlight`）。
        //  🔴 强化那一击的表现一律取**普攻行**（`profile`）的 prefab（2026-11-19 定案 A）。
        //  两条行各带一份美术（普攻 `xxx_普攻` / 武将技 `xxx_武将闪电`），让 36xxx 那一发
        //  换造型等于同一张卡每 5 秒突然变成另一个技能。唯一例外是投枪：它有一份专属的
        //  枪形弹体，而且走的是 `lanceProfileOf` 新造出来的 profile。
        //
        //  第二个例外（2026-11-23 第 42 批）：名单制覆盖。用户对重骑兵这条另有明确口径 ——
        //  「所有使用了【重骑兵_武将技能的】统一更换为【仙桃行者_重击技能】特效，
        //   并且该特效的释放一定是在目标的坐标位置播放」。名单在 `ZCQuakeFx` 里，
        //  没登记的 36xxx 行照旧借普攻行 ⇒ 定案 A 对全表其余卡逐字不变。
        //  🔴 `undefined` = 没登记（回落普攻行）、`null` = 登记为「不播贴图」，两者不能混：
        //  68009 的强化那一击换了形态（近战 → 弹道），它不该把普攻那张刀光拖着飞。
        const empoweredFxOverride = (empowered && !lance)
            ? zcEmpoweredFxOverrideOf(activeProfile.skillId)
            : undefined;
        const fxPrefabPath = lance
            ? activeProfile.effectPrefabPath
            : (empoweredFxOverride === undefined ? profile.effectPrefabPath : empoweredFxOverride);
        const travelSeconds = zcCombatEffectTravelSeconds(
            activeProfile.mode,
            distance(from.x, from.y, target.x, target.y),
            activeProfile.projectileSpeed,
            fxPrefabPath,
        );
        //  事件寿命取「飞行时长」与「目录登记的寿命下限」的较大值。
        //  🔴 `ZCGameModel` 按 `startedAt + durationSeconds` 摘事件：一次性长演出
        //  （重击柱 29 帧 ≈ 1.21s）不抬到这段长度就是「播一半没了」。
        //  没登记 `durationSeconds` 的路径该函数返回 0 ⇒ 存量事件寿命逐字不变
        //  （普攻那张刀光就属于这一档：与长枪兵行 30171 一样吃默认 0.32s）。
        const eventSeconds = Math.max(travelSeconds, zcEffectDurationOf(fxPrefabPath));
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
            //  强化那一击与普攻**共用同一份 prefab**（定案 A，见 `ZC_EMPOWERED_FX_SCALE`）：
            //  不再回落技能行（36xxx）的 `effectPrefabPath`，否则「同一个技能只是变强」在画面上
            //  读成「换了个技能」。
            effectPrefabPath: fxPrefabPath || null,
            //  强化那一击唯一的差别 —— 尺寸 ×1.2。落在事件级 `effectScale`（等比 `setScale`），
            //  不碰 `sizeScale`：那一路的倍率会同步乘进命中半径，等于把「看着大」变成「更容易擦到」。
            //  🔴 名单覆盖那一份**不吃 ×1.2**：它与仙桃行者自己那根重击柱是同一个 prefab，
            //  两处出现时必须是同一个尺寸（那份美术的「地面裂纹环」是照着判定半径量的）。
            //  `undefined` = 没登记（照旧 ×1.2）；`null` = 登记为不播，本来也没有节点可放大。
            effectScale: (empowered && empoweredFxOverride === undefined) ? ZC_EMPOWERED_FX_SCALE : undefined,
            fromX: from.x,
            fromY: from.y,
            toX: target.x,
            toY: target.y,
            radius: effectiveAreaRadius,
            damage,
            empowered,
            startedAt: state.elapsedSeconds,
            durationSeconds: eventSeconds,
        };
        //  贯穿/穿透射程：表现终点沿目标方向延伸 penetrateRange，
        //  弹道寿命也按 penetrateRange / 速度 算，确保射线穿透路径上的敌人并飞出屏幕。
        const penetrateRange = activeProfile.penetrateRange ?? profile.penetrateRange;
        if (penetrateRange && penetrateRange > 0) {
            const dx = target.x - from.x;
            const dy = target.y - from.y;
            const len = Math.hypot(dx, dy);
            const nx = len > 0 ? dx / len : Math.cos(unit.facingRadians);
            const ny = len > 0 ? dy / len : Math.sin(unit.facingRadians);
            event.toX = from.x + nx * penetrateRange;
            event.toY = from.y + ny * penetrateRange;
            event.durationSeconds = penetrateRange / (activeProfile.projectileSpeed || 500);
        }
        return { target, definition, patch, profile, activeProfile, empowered, lance, skillRuntime, projectileCount, bulletNumExtra, bulletFalloff, baseProjectileCount, criticalMultiplier, damageRateMultiplier, skillDamageRate, lanceDamageRate, legacy, legacyTargetBuffs, criticalHit, floatTextKind, damage, legacyAreaRadius, effectiveAreaRadius, from, event, onHitStatusId };
    }

    private static createAttackProjectiles(
        state: ZCSnapshot, unit: ZCUnitState, attack: IZCPreparedAttack, context: IZCAttackResolutionContext,
    ): void {
        const { target, definition, patch, activeProfile, empowered, lance, skillRuntime, projectileCount,
            bulletFalloff, baseProjectileCount, lanceDamageRate,
            criticalMultiplier, damageRateMultiplier, skillDamageRate, legacy, legacyTargetBuffs,
            criticalHit, onHitStatusId, legacyAreaRadius, from, event } = attack;
        const { profile } = attack;
        const parameters = skillRuntime ? skillRuntime.parameters : undefined;
        const empParams = empowered ? parameters : undefined;
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
        const lifeSeconds = empParams
            ? Math.max(0, empParams.projectileLifeSeconds ?? 0)
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
        const allyHealPct = parameters ? Math.max(0, Math.min(1, parameters.allyPierceHealPct ?? 0)) : 0;
        const allyHealMaxCount = parameters ? Math.max(0, Math.round(parameters.allyPierceMaxCount ?? 0)) : 0;
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
        const burstRadius = (empParams ? Math.max(0, empParams.impactBurstRadius ?? 0) : 0)
            * context.rules.combatDistanceScale;
        const burstRate = empParams ? Math.max(0, empParams.impactBurstDamageRate ?? 0) : 0;
        const burstBase = burstRadius > 0 && burstRate > 0
            ? ZCCombatSystem.unitDamageBase(unit, definition, bonuses, context.rules, burstRate)
                * (unit.attackMultiplier ?? 1) * criticalMultiplier
            : 0;
        const burstSecondRate = empParams ? Math.max(0, empParams.impactBurstSecondRate ?? 0) : 0;
        const burstSecondBase = burstRadius > 0 && burstSecondRate > 0
            ? ZCCombatSystem.unitDamageBase(unit, definition, bonuses, context.rules, burstSecondRate)
                * (unit.attackMultiplier ?? 1) * criticalMultiplier
            : 0;
        //  第二段的时间锚点：设计案「爆炸开始后第 26 帧」@30fps ⇒ 25/30 = 0.8333s。
        //  第 N 帧（1 起数）= 下标 N-1，与 `ZCBoltStrikeFx` 的「第 5 帧 ⇒ 4/30」同一条换算。
        const burstSecondDelay = empParams ? Math.max(0, empParams.impactBurstSecondDelay ?? 0) : 0;
        const burstEffectSeconds = empParams ? Math.max(0, empParams.impactBurstEffectSeconds ?? 0) : 0;
        //  命中附加特效同理取**普攻行**：`activeProfile` 在强化那一击指向 36xxx 行，那一行的
        //  `impactEffectPrefabPath` 十有八九是空的（36231 就是空）⇒ 强化击连命中特效都没有。
        const burstImpactPrefab = empowered ? (profile.impactEffectPrefabPath ?? null) : null;
        //  首目标重击（2026-11-23 仙桃行者「大地之力」100904）。
        //
        //  设计口径：「第一个被攻击的目标受到 300%/370%/450% 的伤害，并在该目标位置播放
        //  【仙桃行者_重击技能】，特效落点的圆圈内所有敌人受到第一个目标一致的伤害，
        //  其他的效果保持不变」。
        //
        //  ⇒ 与 `impactBurst*`（凤凰降临：含主目标再打一次）是两件事，所以另开 `quake*` 三个键：
        //    · `quakeFirstRate` 只作用于**第一个命中的单位**，其余被穿透的目标仍按 `baseDamage`；
        //    · `quakeRadius` 是落点圆，圆内**除首目标之外**的敌人各结算一次（首目标已经吃过直击）；
        //    · `quakeEffectSeconds` 只控制表现长度，与判定各自独立开关。
        //  三个键都只在 `empowered` 时读（计划行按 `unitId:pvpSkillId` 合并，不设闸门的话
        //  同一张卡的普通普攻也会被改成「首目标 300%」——与 `pierceCount` 同一个理由）。
        const quakeFirstRate = empParams ? Math.max(0, empParams.quakeFirstRate ?? 0) : 0;
        //  🔴 伤害基数走 `unitDamageBase`（**不含克制**）：克制系数逐个受击者算，
        //  存进弹道的必须是一个中性值，否则带首目标的克制关系去炸别人就会算错。
        const quakeBase = quakeFirstRate > 0
            ? ZCCombatSystem.unitDamageBase(unit, definition, bonuses, context.rules, quakeFirstRate)
                * (unit.attackMultiplier ?? 1) * criticalMultiplier
            : 0;
        const quakeRadius = quakeBase > 0 && empParams
            ? Math.max(0, empParams.quakeRadius ?? 0) * context.rules.combatDistanceScale
            : 0;
        //  表现时长固定取 clip 长度（29 帧 @24fps），不读配表：短了会被事件寿命截断在半路。
        const quakeEffectSeconds = quakeBase > 0 ? ZC_QUAKE_STRIKE_SECONDS : 0;
        for (let index = 0; index < projectileCount; index += 1) {
            const projectileEvent = index === 0 ? event : { ...event, id: state.nextCombatEventId++ };
            //  多发扇形展开：只有 `bulletAngle > 0` 时才转方向，缺省仍是全部打同一条直线
            //  （老技能没有任何表数据，行为必须逐字不变）。
            //  `projectileSpreadDeg`（2026-11-11 麻辣铁锅「凤凰降临」102604）是强化那一击专用的
            //  张角覆盖：`bulletAngle` 是 unit 域的修改器（`patch.bulletAngleFlat`），同一张卡的
            //  普攻与强化击共用一份，而 102601 要求普攻 20°、102604 要求 4 颗 90° —— 一个槽装不下。
            //  取「强化 + 配了就用它、否则退回 patch」：既有技能一条都没有这个键，行为逐字不变。
            const spreadTable = (empParams ? Math.max(0, empParams.projectileSpreadDeg ?? 0) : 0)
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
            const usesLegacyDamage = legacy.hasDamageFormula && !lance;
            const baseDamage = (usesLegacyDamage
                ? legacy.damage * criticalMultiplier
                : ZCCombatSystem.unitDamageBase(unit, definition, bonuses, context.rules,
                    skillDamageRate * damageRateMultiplier * lanceDamageRate)
                    * (unit.attackMultiplier ?? 1) * criticalMultiplier) * bulletScale;
            if (ZCDC_LOG_DAMAGE_FLOAT) {
                console.info('[伤害飘字][弹道出手]', {
                    ...this.attackLogFields(unit, definition, context),
                    projectileId: projectileEvent.id, skillId: activeProfile.skillId, skillName: activeProfile.name,
                    skillDamageRate, damageRateMultiplier, lanceDamageRate, criticalMultiplier, bulletScale,
                    legacyDamage: usesLegacyDamage ? legacy.damage : undefined, baseDamage,
                });
            }
            state.projectiles.push({
                ...projectileEvent, type: 'projectile', targetKind: target.kind, targetId: target.id,
                sourceCardId: unit.cardId,
                toX: bulletToX,
                toY: bulletToY,
                //  投枪的首目标折算（`lanceDamageRate`）也必须进这条链：这一发是纯伤害弹，
                //  没有再走 `unitDamage` 的机会。
                baseDamage,
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
                zoneDamage: empowered && parameters && parameters.explosionDamageRate != null
                    ? this.unitDamage(context, unit, this.targetOwner(state, target, context), target.cardId,
                        parameters.explosionDamageRate,
                        target.kind === 'unit' ? target.id : undefined) * criticalMultiplier
                    : undefined,
                remainingPierces: lance
                    //  投枪：`lancePierceCount` 是**目标总数**（含首目标），所以剩余穿透 = N − 1。
                    //  与上面 `pierceCount`（额外穿透次数）语义不同，别混用同一个键。
                    ? Math.max(0, Math.floor(
                        ((parameters ? parameters.lancePierceCount : undefined) ?? ZC_LANCE_DEFAULT_PIERCE_COUNT) - 1))
                    : empowered
                    ? Math.max(0, Math.floor((parameters ? parameters.pierceCount : undefined) ?? 0))
                    //  普攻穿透（2026-10-30「穿甲苔刺」100701/100801/103501）：`pierceCount` 原本只服务
                    //  「强化那一击」，被动要求的是「每一次普攻都穿透」。用独立键 `normalPierceCount`
                    //  而不是放宽 `pierceCount`，是为了不动任何既有强化击的口径。
                    : Math.max(0, Math.floor((parameters ? parameters.normalPierceCount : undefined) ?? 0)),
                //  每次穿透后的伤害衰减（玉林好汉「精英猎手」：每穿一人 -20%）；
                //  缺省 0 = 不衰减，既有穿透弹道（火船等）行为逐字不变。
                pierceFalloff: lance
                    ? Math.max(0, Math.min(1,
                        (parameters ? parameters.lancePierceFalloff : undefined) ?? ZC_LANCE_DEFAULT_PIERCE_FALLOFF))
                    : empowered
                    ? Math.max(0, Math.min(1, (parameters ? parameters.pierceFalloff : undefined) ?? 0))
                    : Math.max(0, Math.min(1, (parameters ? parameters.normalPierceFalloff : undefined) ?? 0)),
                hitUnitIds: [],
                executeChance: Math.max(0, Math.min(1,
                    (empParams ? empParams.executeChance : undefined)
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
                    : (empowered ? 0 : (parameters ? (parameters.splashRadius ?? 0) : 0) * context.rules.combatDistanceScale) || undefined,
                splashDamageRate: legacyAreaRadius > 0
                    ? undefined
                    : (empowered ? undefined : (parameters ? parameters.splashDamageRate : undefined)),
                //  溅射的多目标递减（2026-11-14）：与 `splashDamageRate` 同一路传入，缺省不写。
                splashFalloff: legacyAreaRadius > 0
                    ? undefined
                    : (empowered ? undefined : (parameters ? parameters.splashFalloff : undefined)),
                //  命中爆炸（见上面 `burstRadius` 那一段）。四项任一为 0 就不写，
                //  保持「没有这个键」= 存量弹道逐字不变。
                impactEffectPrefabPath: burstImpactPrefab,
                burstRadius: burstRadius > 0 ? burstRadius : undefined,
                burstDamage: burstBase > 0 ? burstBase : undefined,
                burstSecondDamage: burstSecondBase > 0 ? burstSecondBase : undefined,
                burstSecondDelay: burstSecondBase > 0 ? burstSecondDelay : undefined,
                burstEffectSeconds: burstEffectSeconds > 0 ? burstEffectSeconds : undefined,
                //  首目标重击（见上面 `quake*` 那一段）。三项任一为 0 就不写，
                //  保持「没有这个键」= 存量弹道逐字不变。
                quakeDamage: quakeBase > 0 ? quakeBase : undefined,
                quakeRadius: quakeRadius > 0 ? quakeRadius : undefined,
                quakeEffectSeconds: quakeEffectSeconds > 0 ? quakeEffectSeconds : undefined,
            });
        }
    }

    private static createAttackGroundZones(
        state: ZCSnapshot, unit: ZCUnitState, attack: IZCPreparedAttack, context: IZCAttackResolutionContext,
    ): void {
        const { target, activeProfile, empowered, skillRuntime, criticalMultiplier, damage,
            floatTextKind, onHitStatusId, effectiveAreaRadius, from, event } = attack;
        const skillParams = skillRuntime ? skillRuntime.parameters : undefined;
        const durationSeconds = activeProfile.durationSeconds ?? 0;
        const waves = Math.max(1, activeProfile.waves ?? 1);
        const slowRatio = empowered
            ? Math.max(0, Math.min(1, (skillParams ? skillParams.slowRatio : undefined) ?? activeProfile.slowRatio ?? 0))
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
        const zoneCount = empowered && skillParams ? Math.max(1, Math.round(skillParams.zoneCount ?? 1)) : 1;
        const expireDamage = empowered && skillParams && skillParams.expireDamageRate != null
            ? this.unitDamage(context, unit, this.targetOwner(state, target, context), target.cardId,
                skillParams.expireDamageRate,
                target.kind === 'unit' ? target.id : undefined) * criticalMultiplier
            : 0;
        //  会移动的区域（2026-11-04 椰蛋战士「暴风」）：给了 `zoneMoveSpeed` 才走这条口径 ——
        //  从施法者出发、朝目标方向扇形抛出、路径上每个敌人只吃一次、命中名额满了提前散。
        //  缺省 0 ⇒ 走下面原地的老分支，暴风雪 / 灼热地带 / 火船行为逐字不变。
        const moveSpeed = empowered && skillParams ? Math.max(0, skillParams.zoneMoveSpeed ?? 0) : 0;
        const moving = moveSpeed > 0;
        const movingDuration = moving && skillParams ? Math.max(0, skillParams.zoneDuration ?? durationSeconds) : durationSeconds;
        //  移动区域每 0.15s 探一次路（走过敌人就结算），而不是沿用「持续秒数 / 波数」。
        const movingInterval = skillParams ? Math.max(0.05, skillParams.zoneWaveInterval ?? 0.15) : 0.15;
        const movingWaves = Math.max(1, Math.ceil(movingDuration / movingInterval));
        const maxHits = moving && skillParams ? Math.max(0, Math.round(skillParams.zoneMaxHits ?? 0)) : 0;
        const spawnSpread = skillParams ? Math.max(0, skillParams.zoneSpreadDeg ?? 0) * Math.PI / 180 : 0;
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
        const selfCentered = !moving && skillParams && (skillParams.zoneSelfCentered ?? 0) > 0;
        //  出生点前移（2026-11-07 鹿神守护需求 1）：「生成位置在魔术师前进方向 15px 处」
        //  （2026-11-12 由 30 改成 15，与「子弹从枪口出来」的观感对齐）。
        //  与攻击距离 / 区域半径同一套表值口径 ⇒ 乘 `combatDistanceScale`。
        const spawnForward = moving && skillParams
            ? Math.max(0, skillParams.zoneSpawnForward ?? 0) * context.rules.combatDistanceScale
            : 0;
        //  追踪式移动（2026-11-07 鹿神守护需求 2，2026-11-12 改成「会追踪的子弹」）：
        //  给了 `zoneApproachSpeed` 才走「慢档走过去、贴近后提速」，缺省 0 ⇒ 一出生就按
        //  `zoneMoveSpeed` 飞（暴风 / 既有移动区域逐字不变）。
        const approachSpeed = moving && skillParams
            ? Math.max(0, skillParams.zoneApproachSpeed ?? 0) * context.rules.combatDistanceScale
            : 0;
        const sprintRange = skillParams ? Math.max(0, skillParams.zoneSprintRange ?? 0) * context.rules.combatDistanceScale : 0;
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
                expireStatusDuration: Math.max(0, skillParams ? (skillParams.freezeDuration ?? 0) : 0),
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
                    ? Math.max(0, Math.min(1, (skillParams ? skillParams.zoneDamageFalloff : undefined) ?? 0)) || undefined
                    : undefined,
                //  整段持有视觉（2026-11-07 鹿神守护小鹿冲刺）：给了 `zoneHoldVisual = 1` 才开 ——
                //  开了以后区域只在创建时推一条跟着自己走的长效表现事件，
                //  不再按波次在每波位置频闪（见 `ZCGroundZoneSystem.syncHoldVisual`）。
                //  缺省 0 ⇒ 暴风仍是原来的「一串残影」，行为逐字不变。
                holdVisual: moving && skillParams && (skillParams.zoneHoldVisual ?? 0) > 0 ? true : undefined,
                //  入场「由小变大」（2026-11-07 暴风需求 2）：只对整段持有视觉生效 ——
                //  逐波残影每条只活 0.15s，长不出来。
                growSeconds: moving
                    ? Math.max(0, (skillParams ? skillParams.zoneGrowSeconds : undefined) ?? 0) || undefined
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
        const { target, activeProfile, profile, lance, empowered, skillRuntime, legacy, legacyTargetBuffs,
            floatTextKind, onHitStatusId, damage, legacyAreaRadius, event } = attack;
        const skillParams = skillRuntime ? skillRuntime.parameters : undefined;
        const areaRadius = attack.effectiveAreaRadius;

        state.combatEvents.push(event);
        //  命中附加表现（2026-10-31 运动霸「拳击冲撞」203301 的「气浪」）。
        //  只补一条表现事件、不结算任何伤害，所以它与下面那段真正的伤害结算互不干扰。
        //  放在这里而不是结算之后：同一帧起播，「命中」和「气浪」才是同一拍。
        //  路径一律按**普攻行**（`profile`）取，强化那一击跟着一起回来；投枪例外 ——
        //  `lanceProfileOf` 刻意把 `impactEffectPrefabPath` 清成 undefined（投枪不带气浪）。
        this.pushImpactEffect(state, event, lance ? activeProfile : profile);
        if (target.kind === 'unit') {
            const targetUnit = context.unitById.get(target.id) ?? null;
            if (targetUnit) {
                const hitText = context.damageUnit(targetUnit, damage, {
                    owner: unit.owner, kind: 'unit', unitId: unit.id, floatTextKind,
                });
                this.applyLifesteal(unit, hitText, context);
                context.tryExecuteUnit(targetUnit,
                    (empowered && skillParams ? skillParams.executeChance : undefined) ?? legacy.executeChance,
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
                    context.tryExecuteUnit(splash, empowered && skillParams ? skillParams.executeChance : undefined,
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
        const skillRuntime = this.skillRuntimeOf(unit, profile.skillId, context);
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
        if (ZCDC_LOG_DAMAGE_FLOAT) {
            console.info('[伤害飘字][弹道出手]', {
                ...this.attackLogFields(unit, definition, context),
                projectileId: state.nextCombatEventId, skillId, skillName: profile.name,
                skillDamageRate: damageRate, damageRateMultiplier, criticalMultiplier, baseDamage,
            });
        }
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
            onHitStatusId: (skillRuntime ? skillRuntime.statusId : undefined) ?? profile.onHitStatusId,
            legacyBuffs: [],
        });
    }

    static resolveProjectileHit(state: ZCSnapshot, projectile: ZCProjectileState, target: ZCCombatTarget,
        context: IZCAttackResolutionContext): void {
        const targetOwner = this.targetOwner(state, target, context);
        //  首目标重击（2026-11-23 仙桃行者「大地之力」100904）：「第一个被攻击的目标」=
        //  这颗弹道命中的**第一个单位**。
        //  🔴 判据用 `hitUnitIds` 是否为空，不是自己再记一个计数器：`ZCProjectileSystem`
        //  是在 `context.hit()` **之后**才把 id 记进 `hitUnitIds` 的（穿透时），所以命中这一拍
        //  它还停在上一发的结果上；首击时它是空数组。墙体 / 建筑不记 id ⇒ 再补
        //  `target.kind === 'unit'`，否则「先蹭到一段城墙」会把首目标的那份让给墙。
        const quakeBase = projectile.quakeDamage ?? 0;
        const isQuakeHit = quakeBase > 0 && target.kind === 'unit'
            && (projectile.hitUnitIds?.length ?? 0) === 0;
        const multiplier = this.projectileCounterMultiplier(projectile, targetOwner, target.cardId, context,
            target.kind === 'unit' ? target.id : undefined);
        //  首目标吃 `quakeDamage`，其余穿透目标仍是 `baseDamage` —— 这就是「其他效果保持不变」。
        const damage = Math.round((isQuakeHit ? quakeBase : projectile.baseDamage) * multiplier);
        const floatTextKind = damageFloatTextKind(projectile.criticalHit === true, multiplier);
        if (ZCDC_LOG_DAMAGE_FLOAT) {
            console.info('[伤害飘字][弹道命中]', {
                projectileId: projectile.id, sourceId: projectile.sourceUnitId, skillId: projectile.skillId,
                targetKind: target.kind, targetId: target.id, baseDamage: projectile.baseDamage,
                quakeDamage: quakeBase, quakeHit: isQuakeHit,
                counterMultiplier: multiplier, pierceFalloff: projectile.pierceFalloff ?? 0, damage, floatTextKind,
            });
        }
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
                    owner: projectile.owner, kind: 'unit', unitId: projectile.sourceUnitId,
                    projectileId: projectile.id, floatTextKind, ranged: true,
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
        //  首目标重击的落点圆 + 表现（2026-11-23 仙桃行者「大地之力」100904）。
        //
        //  圆心就是命中点：`ZCProjectileSystem` 在回调 `hit` 之前已经把 `projectile.x/y`
        //  对齐到目标坐标，所以「特效落在目标坐标」与「判定圆心 = 目标坐标」是同一份坐标，
        //  不需要再查一次单位位置。
        //
        //  🔴 圆内**不含首目标**：它刚吃完 `quakeDamage` 的直击，再打一次就是 600%。
        //  这与 `burstRadius`（凤凰降临，含主目标）刻意不同。
        if (isQuakeHit) {
            const quakeRadius = projectile.quakeRadius ?? 0;
            if (quakeRadius > 0) {
                const quakeHexId = context.geometry.hexIdAt(projectile.x, projectile.y);
                const quakeHexRadius = quakeHexId == null
                    ? 0 : Math.ceil(quakeRadius / HEX_GRID_LOGICAL_ROW_STEP) + 1;
                const quakeCandidates = quakeHexId == null ? [] : context.unitsInRadius(quakeHexId, quakeHexRadius);
                for (const victim of quakeCandidates) {
                    if (victim.id === target.id) continue;
                    if (victim.owner === projectile.owner || victim.battleState === 'dead' || victim.hp <= 0) continue;
                    const position = context.unitPosition(victim);
                    if (distance(projectile.x, projectile.y, position.x, position.y) > quakeRadius) continue;
                    //  与首目标同一份基数（`quakeBase` = 该档 ×300%/370%/450%），按受击者自己的克制结算。
                    //  「一致的伤害」= 同一个倍率来源，而不是无视克制照抄一个数字 ——
                    //  本项目所有范围伤害都是逐个受击者算克制，这里不破例（否则被克制的敌人反而更痛）。
                    const quakeMultiplier = this.projectileCounterMultiplier(
                        projectile, victim.owner, victim.cardId, context, victim.id);
                    const quakeDamage = Math.round(quakeBase * quakeMultiplier);
                    if (ZCDC_LOG_DAMAGE_FLOAT) {
                        console.info('[伤害飘字][首目标落点圆]', {
                            projectileId: projectile.id, sourceId: projectile.sourceUnitId, targetId: victim.id,
                            base: quakeBase, counterMultiplier: quakeMultiplier, damage: quakeDamage,
                        });
                    }
                    const quakeText = context.damageUnit(victim, quakeDamage, {
                        owner: projectile.owner,
                        kind: 'unit',
                        unitId: projectile.sourceUnitId,
                        projectileId: projectile.id,
                        floatTextKind: damageFloatTextKind(projectile.criticalHit === true, quakeMultiplier),
                        ranged: true,
                    });
                    if (shooter) this.applyLifesteal(shooter, quakeText, context, this.lifestealSpreadRateOf(shooter, context));
                    context.tryExecuteUnit(victim, projectile.executeChance, projectile.owner,
                        projectile.sourceUnitId, quakeText);
                    context.applyHitStatus(victim, projectile.onHitStatusId, projectile.sourceUnitId);
                }
            }
            const quakeSeconds = projectile.quakeEffectSeconds ?? 0;
            if (quakeSeconds > 0) {
                //  纯表现：`radius` / `damage` 都是 0，伤害已经在上面的直击 / 落点圆里结清。
                pushQuakeStrikeVisualEvent(state, projectile.x, projectile.y, state.elapsedSeconds, {
                    owner: projectile.owner,
                    sourceUnitId: projectile.sourceUnitId,
                    skillId: projectile.skillId,
                    skillName: projectile.skillName,
                });
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
                if (ZCDC_LOG_DAMAGE_FLOAT) {
                    console.info('[伤害飘字][弹道溅射]', {
                        projectileId: projectile.id, sourceId: projectile.sourceUnitId, targetId: splash.id,
                        baseDamage: projectile.baseDamage, counterMultiplier: splashMultiplier,
                        splashDamageRate: projectile.splashDamageRate ?? 1, splashFalloff, index, damage: splashDamage,
                    });
                }
                const splashText = context.damageUnit(splash, splashDamage, {
                    owner: projectile.owner,
                    kind: 'unit',
                    unitId: projectile.sourceUnitId,
                    projectileId: projectile.id,
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
                const burstDamage = Math.round((projectile.burstDamage ?? 0) * burstMultiplier);
                if (ZCDC_LOG_DAMAGE_FLOAT) {
                    console.info('[伤害飘字][弹道爆炸]', {
                        projectileId: projectile.id, sourceId: projectile.sourceUnitId, targetId: victim.id,
                        baseDamage: projectile.burstDamage ?? 0, counterMultiplier: burstMultiplier, damage: burstDamage,
                    });
                }
                const burstText = context.damageUnit(victim,
                    burstDamage, {
                        owner: projectile.owner,
                        kind: 'unit',
                        unitId: projectile.sourceUnitId,
                        projectileId: projectile.id,
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
            //  强化那一击的命中表现同样 ×1.2（定案 A）。走 `effectScale` 而不是 `impactEffectScale`：
            //  后者是「追踪导弹同一份爆炸被两条技能按不同半径复用」的标定值，两件事别混。
            effectScale: projectile.empowered ? ZC_EMPOWERED_FX_SCALE : undefined,
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

