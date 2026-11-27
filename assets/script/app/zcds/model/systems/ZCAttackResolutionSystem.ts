import { ZCSkillResolutionSystem } from './ZCSkillResolutionSystem';
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
    pushSkillRangeRingEvent, zcRangeRingEnabledForUnit,
} from '../ZCSkillRangeRingFx';
import {
    ZC_DASH_GUARD_PREFAB_PATH, ZC_DASH_GUARD_SECONDS, pushDashGuardVisualEvent,
} from '../ZCDashFx';
import { zcImpactEffectAnchor } from '../ZCImpactEffectFx';
import { pushQuakeStrikeVisualEvent, zcEmpoweredFxOverrideOf, ZC_QUAKE_STRIKE_SECONDS } from '../ZCQuakeFx';
import { zcEffectDurationOf } from '../ZCEffectCatalog';
import { zcLanceEffectPrefabPath } from '../ZCLanceFx';
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
 * 投枪（`破阵术`，2026-11-25 前的名字是「破阵投枪」，2026-11-17 落地）的缺省参数。
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
     * 只对导弹分支生效，戈壁箭雨（原「戈壁狂箭」）那种立即结算的多点打击不受影响。
    */
    readonly missileCount?: number;
    /**
     * 「没目标也把表现放完」的保底开关（2026-11-26 第 55 批）。
     *
     * 0 目标时默认整段不发（`return 0`，调用点据此不推进冷却、每帧重试）；
     * 但**技能已经放出去之后**（戈壁箭雨的 6 秒窗口里）敌人可能被打光 / 走光，
     * 那一刻如果也停手，玩家会看到「圈还在、箭没了」——用户口径：
     * 「有目标释放后，即使目标死亡，也会继续播放，一定是整个技能动作做完」。
     *
     * 所以窗口内的每一波都带 `forceVisual: true`：没有敌人照样把这一批子弹抛出去
     * （落点退回散布中心），只是不再产生伤害。首次施法**不带**这个开关，
     * 「没有目标不释放技能」这条因此不受影响。
     */
    readonly forceVisual?: boolean;
    /**
     * 回填「这一发实际作用在哪」（世界坐标），2026-11-26 第 57 批。
     *
     * 用途只有一个：`random_strike` 的**范围指示白环**要画在箭落下的地方，而不是施法者脚下。
     * 圈心必须与子弹同源 —— 挑人带随机（`nearest: false` 时），调用方在外面重算一遍必然算出
     * 另一个质心，于是「圈在这头、箭落那头」。所以由 `strikeTargets` 在挑完之后把中心写回来。
     *
     * 传进来的是一个**可变**对象（不是返回值）：`strikeTargets` 有两条分支（导弹 / 立即结算），
     * 改返回类型会牵动所有调用点，而这里只有 `applyRandomStrike` 一家在用。
     * 没写 ⇒ 这一发没落地（0 目标且没有 `forceVisual`），调用方按施法者位置兜底。
     */
    readonly centerOut?: { x: number; y: number };
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

export function damageFloatTextKind(critical: boolean, counterMultiplier = 1): ZCCombatFloatTextKind {
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

export function distance(fromX: number, fromY: number, toX: number, toY: number): number {
    return Math.hypot(fromX - toX, fromY - toY);
}

/**
 * 战场攻击与伤害结算系统 (ZCAttackResolutionSystem)
 *
 * 职责划分 (MVC - Model 领域层):
 * 1. 核心职责：普攻派发（sendAttack）、弹道发射与全生命周期追踪（createAttackProjectiles、resolveProjectileHit）、
 *    地面区域持续生效（createAttackGroundZones）、近战即时结算（resolveImmediateAttack）以及伤害公式与职业克制计算。
 * 2. 静态兼容门面：为保障对既有业务流程、技能触发器及自动化测试 100% 向后兼容，此处保留主动技能与光环结算的
 *    静态同名门面，底层全量转接至 {@link ZCSkillResolutionSystem} 执行。
 * 3. 严格遵循纯逻辑规则：
 *    - 纯状态计算，绝不直接引用或持有 Cocos UI/节点组件
 *    - 伤害公式全量归口：`unitDamage(...)` 统一处理阶位、羁绊、局内养成加成、伤害率与暴击
 *    - 伤害飘字诊断：全链路对齐出手、飞行、命中与受击结算飘字类型
 *    - 鞭尸防护与越界截断：严格拦截已阵亡目标伤害扩散，放射技能严格限制在有效射程内
 */
export class ZCAttackResolutionSystem {
    private static readonly emptySkillRuntime = new Map<string, ZCSkillRuntimeDefinition>();
    private static readonly emptyStatPatch: ZCUnitStatPatch = Object.freeze({});

    public static statPatchOf(context: IZCAttackResolutionContext, owner: ZCOwner, id: string): ZCUnitStatPatch {
        const ownerPatches = context.statPatches[owner];
        return (ownerPatches && ownerPatches.get(id)) || this.emptyStatPatch;
    }

    private static skillRuntimeFor(unit: ZCUnitState, context: IZCAttackResolutionContext): ReadonlyMap<string, ZCSkillRuntimeDefinition> {
        return unit.neutralReinforcement ? context.neutralSkillRuntime ?? this.emptySkillRuntime : context.skillRuntime[unit.owner];
    }

    public static skillRuntimeOf(
        unit: ZCUnitState,
        skillId: number,
        context: IZCAttackResolutionContext,
    ): ZCSkillRuntimeDefinition | undefined {
        return this.skillRuntimeFor(unit, context).get(`${unit.unitId}:${skillId}`);
    }

    public static skillParamsOf(
        unit: ZCUnitState,
        skillId: number,
        context: IZCAttackResolutionContext,
    ): Readonly<Record<string, number>> | undefined {
        const runtime = this.skillRuntimeOf(unit, skillId, context);
        return runtime ? runtime.parameters : undefined;
    }

    public static cardById(context: IZCAttackResolutionContext, owner: ZCOwner, id: string): ZCDeckCard | undefined {
        return context.cards[owner].get(id);
    }

    public static unitStatPatchOf(unit: ZCUnitState, context: IZCAttackResolutionContext): ZCUnitStatPatch {
        return unit.neutralReinforcement ? this.emptyStatPatch : this.statPatchOf(context, unit.owner, unit.unitId);
    }

    /**
     * 克制乘数 = 全局克制（`pvpCounter`）× 技能级克制条（攻方增伤 / 守方减伤）。
     *
     * 守方 patch 优先按**单位实例**的 `unitId` 取（`statPatches` 的键是 unitId），
     * 取不到再退回 cardId（卡与兵种一一对应，多数情况下两者同串；建筑 / 格子没有卡技能）。
     *
     * 【P0-2 防御降级】：当调用方因目标为单位实例但缺失 targetCardId 时，若传入了 targetUnitId，
     * 自动从 targetUnit.cardId 回退解析守方卡牌，确保职业克制绝不静默失效。
     */
    public static counterMultiplierFor(
        unit: ZCUnitState,
        targetOwner: ZCOwner,
        targetCardId: string | null,
        context: IZCAttackResolutionContext,
        targetUnitId?: number,
    ): number {
        const targetUnit = targetUnitId != null ? context.unitById.get(targetUnitId) : undefined;
        const effectiveCardId = targetCardId ?? (targetUnit ? targetUnit.cardId : null);
        const attackerCard = this.cardById(context, unit.owner, unit.cardId);
        const defenderCard = effectiveCardId ? this.cardById(context, targetOwner, effectiveCardId) : undefined;
        const base = cardCounterMultiplier(attackerCard, defenderCard, context.counters);
        const defenderPatch = targetUnit
            ? this.statPatchOf(context, targetUnit.owner, targetUnit.unitId)
            : (effectiveCardId ? this.statPatchOf(context, targetOwner, effectiveCardId) : this.emptyStatPatch);
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

    public static targetOwner(state: ZCSnapshot, target: ZCCombatTarget, context: IZCAttackResolutionContext): ZCOwner {
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

    public static hex(state: ZCSnapshot, id: number): ZCHexState | null {
        return state.hexes[id] || null;
    }

    /**
     * 一次结算的面板伤害（含克制）。
     *
     * `targetUnitId` 是**目标单位实例**：技能级克制条要读守方的 `statPatches`，
     * 而那份补丁按 `unitId` 建键，只有拿到实例才查得准（建筑 / 格子传 `undefined`，
     * 那时只剩全局克制 —— 它们本来也没有卡技能）。缺省 `undefined` ⇒ 与改前逐字一致。
     */
    public static unitDamage(context: IZCAttackResolutionContext, unit: ZCUnitState,
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
     * 这一拍是不是「投枪」（`破阵术`，2026-11-25 前叫「破阵投枪」，2026-11-17 第 7 批）。
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
     * 走下面的 {@link ZC_LANCE_EFFECT_PREFAB_BY_UNIT}（2026-11-26 第 57 批起）。
     */
    private static lanceProfileOf(base: ZCAttackProfile,
        skillRuntime: ZCSkillRuntimeDefinition | undefined,
        unitId: string): ZCAttackProfile {
        const params = skillRuntime ? skillRuntime.parameters : undefined;
        return {
            ...base,
            mode: ZCCombatEventType.Projectile,
            projectileSpeed: Math.max(1, (params ? params.lanceSpeed : undefined) ?? ZC_LANCE_DEFAULT_SPEED),
            effectPrefabPath: zcLanceEffectPrefabPath(unitId),
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

    /**
     * 多方向射线技能判定（如藤蔓守卫、多向放射线技能）。
     *
     * 特性与约束：
     * - 【P0-1 阻断修复】：补齐射程上限判定 maxRange = Math.max(eventRange, defRange)。
     *   只有在沿轴正向（along >= 0）且在射程范围内（along <= maxRange + targetBodyRadius）的单位才会判定命中，
     *   彻底解决射线沿角度贯穿整张地图所有敌人的严重缺陷。
     * - 【P1-3 修复】：增加 target.hp <= 0 守卫，杜绝同一帧已被主伤害击杀的目标被射线二次鞭尸。
     * - 扇形方向技按「远程」结算（藤盾这类只减远程的护体要能吃到）。
     *
     * @param state 战斗运行时快照
     * @param source 施法单位状态
     * @param event 射线战斗事件
     * @param damage 结算伤害值
     * @param rawDirectionCount 射线发散方向数
     * @param onHitStatusId 命中后附加的状态 ID
     * @param legacyBuffs 兼容旧版 buff 列表
     * @param floatTextKind 伤害飘字类型
     * @param context 攻击与数值上下文
     */
    static resolveRadialSkill(state: ZCSnapshot, source: ZCUnitState, event: ZCCombatEvent,
        damage: number, rawDirectionCount: number, onHitStatusId: string | undefined,
        legacyBuffs: readonly ZCLegacyBuffApplication[], floatTextKind: ZCCombatFloatTextKind,
        context: IZCAttackResolutionContext): void {
        const directionCount = Math.max(1, Math.round(rawDirectionCount));
        const origin = context.unitPosition(source);
        const corridor = 6 * context.rules.combatDistanceScale;
        const eventRange = Math.hypot(event.toX - event.fromX, event.toY - event.fromY);
        const defRange = context.effectiveDefinition(source).attackRange * context.rules.combatDistanceScale;
        const maxRange = Math.max(eventRange, defRange);
        state.combatEvents.push(event);
        for (const target of state.units) {
            if (target.owner === source.owner || target.battleState === 'dead' || target.hp <= 0) continue;
            const pos = context.unitPosition(target);
            const dx = pos.x - origin.x, dy = pos.y - origin.y;
            const targetBodyRadius = context.effectiveDefinition(target).bodyRadius * context.rules.combatDistanceScale;
            let hit = false;
            for (let index = 0; index < directionCount && !hit; index += 1) {
                const angle = source.facingRadians + Math.PI * 2 * index / directionCount;
                const ux = Math.cos(angle), uy = Math.sin(angle);
                const along = dx * ux + dy * uy;
                const perpendicular = Math.abs(dx * uy - dy * ux);
                hit = along >= 0 && (maxRange <= 0 || along <= maxRange + targetBodyRadius)
                    && perpendicular <= corridor + targetBodyRadius;
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

    // =========================================================================
    // 技能结算门面方法（向后兼容重构：转接至 ZCSkillResolutionSystem）
    // 说明：为避免改动上层调用方与既有单测契约，此处保留 100% 兼容的静态方法转发。
    // =========================================================================

    /** 副轨主动：朝当前目标清一次扇形，只做伤害 + 击退 + 表现事件，不推进普攻节拍 */
    static castFanSkill(state: ZCSnapshot, unit: ZCUnitState, context: IZCAttackResolutionContext): boolean {
        return ZCSkillResolutionSystem.castFanSkill(state, unit, context);
    }

    /** 自身光环：在施法者脚下开一片跟随本体的周期伤害区域 */
    static castSelfAura(state: ZCSnapshot, unit: ZCUnitState, context: IZCAttackResolutionContext): boolean {
        return ZCSkillResolutionSystem.castSelfAura(state, unit, context);
    }

    /** 落雷连线：每道雷 = 一个单波地面区域，按 boltInterval 逐道出现 */
    static castBoltLine(state: ZCSnapshot, unit: ZCUnitState, context: IZCAttackResolutionContext): boolean {
        return ZCSkillResolutionSystem.castBoltLine(state, unit, context);
    }

    /** 闪电链（雷蕉）：传导跳跃伤害，首跳全额后续递减，带麻痹几率（P0-2已修复克制传参，GC已优化） */
    static castChainLightning(state: ZCSnapshot, unit: ZCUnitState, context: IZCAttackResolutionContext): boolean {
        return ZCSkillResolutionSystem.castChainLightning(state, unit, context);
    }

    /** 精密陷阱 / 蘑菇爆炸：原地或抛物线留一片陷阱区域，敌人触碰引爆 */
    static castTrap(state: ZCSnapshot, unit: ZCUnitState, context: IZCAttackResolutionContext): boolean {
        return ZCSkillResolutionSystem.castTrap(state, unit, context);
    }

    /** 孢爆箭 / 孢子凝珠：朝锁定目标发射高弹速溅射投射物 */
    static castSplashShot(state: ZCSnapshot, unit: ZCUnitState, context: IZCAttackResolutionContext, slowStatusId?: string): boolean {
        return ZCSkillResolutionSystem.castSplashShot(state, unit, context, slowStatusId);
    }

    /** 孢爆风弹（新口径）：射一枚慢速风弹，命中单体后原地留一片飓风 */
    static castWindBolt(state: ZCSnapshot, unit: ZCUnitState, context: IZCAttackResolutionContext): boolean {
        return ZCSkillResolutionSystem.castWindBolt(state, unit, context);
    }

    /** 连射导弹：发射抛物线炸弹，落点由目标位置随机抖动散布 */
    static castBarrageShot(state: ZCSnapshot, unit: ZCUnitState, context: IZCAttackResolutionContext): boolean {
        return ZCSkillResolutionSystem.castBarrageShot(state, unit, context);
    }

    /** 菌毯爆发 / 菌核爆裂：以自身为圆心产生范围爆炸，可附带守卫状态（P0-2已修复克制传参，GC已优化） */
    static castBurstSkill(state: ZCSnapshot, unit: ZCUnitState, context: IZCAttackResolutionContext, guardStatusId?: string, lane: 'burst' | 'venom' = 'burst'): boolean {
        return ZCSkillResolutionSystem.castBurstSkill(state, unit, context, guardStatusId, lane);
    }

    /** 战吼技能：以自身为中心造成伤害、击退及全队/自身护盾加成（P0-2已修复克制传参，P1-4已修复护盾时间） */
    static castRoar(state: ZCSnapshot, unit: ZCUnitState, context: IZCAttackResolutionContext): boolean {
        return ZCSkillResolutionSystem.castRoar(state, unit, context);
    }

    /** 飓风召唤：召唤向目标直线飞行的飓风移动伤害区域（P1-1已补全暴击与飘字） */
    static castStorm(state: ZCSnapshot, unit: ZCUnitState, context: IZCAttackResolutionContext): boolean {
        return ZCSkillResolutionSystem.castStorm(state, unit, context);
    }

    /** 聚能射线：朝目标方向射出长距离高频切割射线及末端光斑（P1-1已补全暴击与飘字） */
    static castRayBeam(state: ZCSnapshot, unit: ZCUnitState, context: IZCAttackResolutionContext, vulnStatusId?: string): boolean {
        return ZCSkillResolutionSystem.castRayBeam(state, unit, context, vulnStatusId);
    }

    /** 文明之火：在目标脚下及周围散布持续灼烧地火区域（P1-1已补全暴击与飘字） */
    static castFireZone(state: ZCSnapshot, unit: ZCUnitState, context: IZCAttackResolutionContext): boolean {
        return ZCSkillResolutionSystem.castFireZone(state, unit, context);
    }

    /** 扇形甩击：朝目标方向扇形范围内敌人造成一次性伤害并可附加减速（P0-2已修复克制传参） */
    static castFanSweep(state: ZCSnapshot, unit: ZCUnitState, context: IZCAttackResolutionContext, slowStatusId?: string): boolean {
        return ZCSkillResolutionSystem.castFanSweep(state, unit, context, slowStatusId);
    }

    /** 冲锋打击：沿位移线段造成穿越伤害并获得防守护盾（P0-2已修复克制传参） */
    static castChargeDash(state: ZCSnapshot, unit: ZCUnitState, context: IZCAttackResolutionContext, options: IZCChargeDashOptions): number {
        return ZCSkillResolutionSystem.castChargeDash(state, unit, context, options);
    }

    /** 多点定点打击：在攻击范围内选取至多 N 个目标逐个发动打击并附加溅射 */
    static strikeTargets(state: ZCSnapshot, unit: ZCUnitState, options: IZCStrikeOptions, context: IZCAttackResolutionContext): number {
        return ZCSkillResolutionSystem.strikeTargets(state, unit, options, context);
    }

    /** 确保移动速度加成状态已注册到状态机 */
    static ensureMoveSpeedStatus(context: IZCAttackResolutionContext, id: string, moveSpeedPct: number, durationSeconds: number): void {
        ZCSkillResolutionSystem.ensureMoveSpeedStatus(context, id, moveSpeedPct, durationSeconds);
    }

    /** 确保战旗暴击加成状态已注册到状态机 */
    static ensureBannerStatus(context: IZCAttackResolutionContext, rawRate: number): string {
        return ZCSkillResolutionSystem.ensureBannerStatus(context, rawRate);
    }

    /** 为己方全体单位施加护盾光环 */
    static applyShieldAura(state: ZCSnapshot, source: ZCUnitState, ratio: number): void {
        ZCSkillResolutionSystem.applyShieldAura(state, source, ratio);
    }

    /** 为自身施加持续指定秒数的护盾（P1-4已修复：取 Math.max 防覆盖更长有效期） */
    static applySelfShield(state: ZCSnapshot, source: ZCUnitState, ratio: number, seconds: number): void {
        ZCSkillResolutionSystem.applySelfShield(state, source, ratio, seconds);
    }

    /** 推送自身护盾的视觉表现事件 */
    static pushSelfShieldVisual(state: ZCSnapshot, unit: ZCUnitState, context: IZCAttackResolutionContext, skillId: number, skillName: string): void {
        ZCSkillResolutionSystem.pushSelfShieldVisual(state, unit, context, skillId, skillName);
    }

    /** 为己方所有在场单位施加移速提升光环 */
    static applyMoveSpeedAura(state: ZCSnapshot, owner: ZCOwner, ratio: number, durationSeconds: number, context: IZCAttackResolutionContext): void {
        ZCSkillResolutionSystem.applyMoveSpeedAura(state, owner, ratio, durationSeconds, context);
    }

    /** 为己方随机 N 个在场单位施加战旗暴击加成状态（GC已优化：Swap-Pop O(1) 随机抽取） */
    static applyBannerBuff(state: ZCSnapshot, owner: ZCOwner, rawCount: number, rawRate: number, context: IZCAttackResolutionContext): void {
        ZCSkillResolutionSystem.applyBannerBuff(state, owner, rawCount, rawRate, context);
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
        //  单体护盾（巨力护盾，2026-11-25 前叫「亡者护盾」）：只罩自己、且带到期时刻。与上面的 `shieldRatio`（全队光环盾）
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
        //  投枪（`破阵术`，2026-11-25 前叫「破阵投枪」）：每 N 次普攻把本次攻击替换成一枚远程穿透弹。
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
            ? this.lanceProfileOf(profile, skillRuntime, unit.unitId)
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

        //  🔴 「以目标为圆心」的区域必须有**实体敌方单位**当靶子（2026-11-25 第 53 批，篮球火）。
        //
        //  背景：`context.currentTarget` 在敌方单位全没了的时候不会返回 `null`，而是退化成
        //  「打城墙 / 打建筑」（`ZCUnitTargeting.current` 的 `kind: 'wall' | 'building'` 两支）。
        //  区域照建就会落在**城墙坐标**上 —— 而地面区域只结算单位（`resolveWave` 只遍历
        //  `unitsInRadius`），砸在墙上一个单位也伤不到，纯属白放一次 + 占掉 14 秒 CD。
        //  用户口径（2026-11-25）：「以敌方为目标…**没有目标就不释放**」。
        //
        //  只盖「原地 · 以目标为圆心」这一档（`!moving && !selfCentered`）：
        //  · `selfCentered`（斗气爆发 / 迪斯科旋风 / 死亡摇滚）本来就落在自己脚下，不需要靶子；
        //  · `moving`（暴风 / 鹿神守护小鹿）从施法者出发沿中轴飞，拆墙时也有意义，不动。
        const zoneSelfCenteredEarly = skillParams ? (skillParams.zoneSelfCentered ?? 0) > 0 : false;
        const zoneMovingEarly = empowered && skillParams ? (skillParams.zoneMoveSpeed ?? 0) > 0 : false;
        if (!zoneMovingEarly && !zoneSelfCenteredEarly && target.kind !== 'unit') {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`ground-zone-target:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} 区域技能没有敌方单位目标（目标 = ${target.kind}#${target.id}）`
                    + ` ⇒ 不建区域、不结算；命中状态与伤害一并不发`);
            }
            return;
        }

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
            //  出生点先落成局部变量：下面要拿同一个坐标去画范围圈（两处各算一遍迟早写歪）。
            //  🔴 「以目标为圆心」的区域（`!moving && !selfCentered`）圆心**只认 `target.x/y`**
            //  （2026-11-25 第 53 批复述）：`zoneCount === 1` 时 `offset` 恒 0 ⇒ 圆心就是目标本身。
            //  上面那道 `target.kind !== 'unit'` 闸门保证这里的 `target` 一定是敌方单位，
            //  所以「圆形落在自己脚下」只剩两种合法来源：`zoneSelfCentered`（配表开关）
            //  或目标本身就贴脸站在同一格。
            const zoneX = moving
                ? from.x + Math.cos(angle) * spawnForward
                : (selfCentered ? from.x : target.x + Math.cos(angle) * offset);
            const zoneY = moving
                ? from.y + Math.sin(angle) * spawnForward
                : (selfCentered ? from.y : target.y + Math.sin(angle) * offset);
            state.groundZones.push({
                //  移动区域的出生点 = 施法者坐标沿中轴前移 `zoneSpawnForward`
                //  （「小鹿在魔术师前进方向 30px」）。`zoneSpawnForward` 缺省 0 ⇒ 就是施法者本身。
                x: zoneX,
                y: zoneY,
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
            //  2026-11-25 第 45 批：篮球天才「篮球火」的区域技能画一圈范围指示（用户口径）。
            //  按单位白名单（`ZC_SKILL_RANGE_RING_UNITS`）：同样走 `mode: area` + `durationSeconds`
            //  的暴风雪 / 灼热地带一个都不多出这个圈。
            //  🔴 半径取**这个区域自己的** `areaRadius`（世界）÷ `combatDistanceScale` 换回表值，
            //  不读 `pvpSkill.areaRadius` 的裸值 —— 两者靠 `effectiveAreaRadius` 才相等。
            if (zcRangeRingEnabledForUnit(unit.unitId)) {
                const distanceScale = Math.max(1e-6, context.rules.combatDistanceScale);
                pushSkillRangeRingEvent(state, {
                    x: zoneX,
                    y: zoneY,
                    logicRadius: areaRadius / distanceScale,
                    worldRadius: areaRadius,
                    seconds: moving ? movingDuration : durationSeconds,
                    owner: unit.owner,
                    sourceUnitId: unit.id,
                    skillId: event.skillId,
                    skillName: event.skillName,
                });
            }
        }
    }

    private static resolveImmediateAttack(
        state: ZCSnapshot, unit: ZCUnitState, attack: IZCPreparedAttack, context: IZCAttackResolutionContext,
    ): void {
        const { target, activeProfile, profile, lance, empowered, skillRuntime, legacy, legacyTargetBuffs,
            floatTextKind, onHitStatusId, damage, legacyAreaRadius, event, skillDamageRate, criticalMultiplier } = attack;
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
                if ((target.kind === 'unit' && splash.id === target.id) || splash.owner === unit.owner || splash.battleState === 'dead' || splash.hp <= 0) continue;
                const pos = context.unitPosition(splash);
                if (distance(target.x, target.y, pos.x, pos.y) <= areaRadius) {
                    const splashCounterMultiplier = this.counterMultiplierFor(unit, splash.owner, splash.cardId, context, splash.id);
                    const splashDamage = Math.round(this.unitDamage(context, unit, splash.owner, splash.cardId, skillDamageRate, splash.id) * criticalMultiplier);
                    const splashFloatKind = damageFloatTextKind(criticalMultiplier > 1, splashCounterMultiplier);
                    const hitText = context.damageUnit(splash, splashDamage, {
                        owner: unit.owner, kind: 'unit', unitId: unit.id, floatTextKind: splashFloatKind, ranged: true,
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
                    || splash.owner === projectile.owner || splash.battleState === 'dead' || splash.hp <= 0) continue;
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
                if (victim.owner === projectile.owner || victim.battleState === 'dead' || victim.hp <= 0) continue;
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

