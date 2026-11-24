import {
    HEX_GRID_LOGICAL_COLUMN_STEP, HEX_GRID_LOGICAL_ROW_STEP,
    HEX_GRID_VIEW_COLUMN_SPACING, HEX_GRID_VIEW_ROW_SPACING,
} from '../../../core/hex/HexGridLayout';
import { ZCDC_LOG_DAMAGE_FLOAT } from '../ZCDCLogSwitch';
import { missileLog, zcIsMissileWatchUnit } from '../ZCMissileSkillDiagnostics';
import { skillCastLog, zcSkillCastWatched } from '../ZCSkillCastDiagnostics';
import { ZCCaptureSystem } from './systems/ZCCaptureSystem';
import { ZCCombatSystem } from './systems/ZCCombatSystem';
import type { IZCModelServices } from './systems/ZCModelServices';
import { ZCMovementSystem } from './systems/ZCMovementSystem';
import { isZCAwakeMonster, zcMonsterPosition, ZCNeutralFeatureSystem } from './systems/ZCNeutralFeatureSystem';
import { ZCProjectileContext, ZCProjectileSystem } from './systems/ZCProjectileSystem';
import { ZCTileSystem } from './systems/ZCTileSystem';
import { ZCUnitRegistry } from './systems/ZCUnitRegistry';
import { ZCUnitSystem, type IZCUnitContext } from './systems/ZCUnitSystem';
import { ZCUnitTargeting } from './systems/ZCUnitTargeting';
import {
    ZC_CHAIN_SEGMENT_ANGLE_OFFSET_DEGREES, zcChainArcPieceLayout,
} from './ZCChainLightningFx';
import { zcCombatEffectFadeSecondsOf } from './ZCCombatEffectFlight';
import { ZC_EFFECT_PATHS } from './ZCEffectCatalog';
import { ZC_EFFECT_SCALE } from './ZCEffectTuning';
import type { ZCBattlePresentationEvents, ZCGameRenderFrame, ZCGameRenderHex } from './ZCGameRenderFrame';
import type { IZCPendingSummon } from './ZCGameTypes';
import { ZCMapGeometry } from './ZCMapGeometry';
import { captureZCMatchConfig, ZCMatchConfig, ZCPveDefenceConfig, type ZCMatchMap } from './ZCMatchConfig';
import { ZCSnapshotCodec } from './ZCSnapshotCodec';

/** 20 Hz 固定逻辑步长；每次最多接受 5 秒，限制后台恢复时的主线程阻塞。*/
export const ZC_SIMULATION_STEP_SECONDS = 0.05;
export const ZC_MAX_TICK_SECONDS = 5;
/**
 * NPC 翻地块间隔下限（秒），`openGrideTime` 的守卫值；低于 1 秒按 1 秒算。
 * 旧实现拿全局 2.8s 当下限，1~2.7 秒的配置会被静默抬回去。
*/
export const ZC_AI_MIN_DEVELOP_INTERVAL_SECONDS = 1;
/**
 * 塔防怪物体型的缩放上限。
 *
 * `defenceModWave.monsterSize` 当倍率用（1 = 原尺寸，2 = 两倍），这里只做防御性封顶：
 * 策划手滑写成 20 时不至于把整个棋盘糊住。
*/
export const ZC_DEFENCE_MONSTER_SCALE_MAX = 2.5;
const EMPTY_CONNECTED_DEVELOPED_HEXES: readonly number[] = [];

/** 投影对象的内部可变版本：对外仍经 `ZCGameRenderHex` 的只读视图暴露。*/
interface ZCMutableRenderHex {
    state: DeepReadonly<ZCHexState>;
    canDevelop: boolean;
    cooldown: DeepReadonly<ZCBuildingCooldownState> | null;
    activation: DeepReadonly<ZCHexActivation> | null;
    connectedDevelopedHexIds: readonly number[];
}

/**
 * `defenceModWave.monsterSize` → 单位模型缩放倍率：1 = 原始，2 = BOSS 两倍，封顶 MAX。
 * 缺省/0/负数/非数字按 1；值直接当倍率，不再另设档位映射表。
*/
export function defenceMonsterScale(monsterSize: number | null | undefined): number {
    const size = Number(monsterSize);
    if (!Number.isFinite(size) || size <= 1) return 1;
    return Math.min(ZC_DEFENCE_MONSTER_SCALE_MAX, size);
}

import { ZCArtifactSystem } from './systems/ZCArtifactSystem';
import { ZCAttackResolutionSystem, type IZCAttackResolutionContext, type IZCStructureDamageSource } from './systems/ZCAttackResolutionSystem';
import { ZCDamageResolutionSystem, type IZCDamageResolutionContext, HATRED_SECONDS } from './systems/ZCDamageResolutionSystem';
import { ZCDevelopmentSystem, type IZCDevelopmentContext } from './systems/ZCDevelopmentSystem';
import { ZCEconomyContext, ZCEconomySystem } from './systems/ZCEconomySystem';
import { ZCGroundZoneSystem, type IZCGroundZoneContext } from './systems/ZCGroundZoneSystem';
import { ZCLegacyCombatSystem, type IZCLegacyCombatContext } from './systems/ZCLegacyCombatSystem';
import { ZCOutcomeSystem, type IZCOutcomeContext } from './systems/ZCOutcomeSystem';
import { ZCSkillTriggerSystem, type IZCSkillTriggerContext } from './systems/ZCSkillTriggerSystem';
import { ZCStatusResolutionSystem, type IZCStatusResolutionContext } from './systems/ZCStatusResolutionSystem';
import type { ZCTargetingContext } from './systems/ZCTargetingSystem';
import {
    ZC_CARD_START_SECONDS,
    ZCBattlePresentationQueue,
    type IZCCardRevealOptions, type IZCFloatTextOptions,
} from './ZCBattlePresentationQueue';
import {
    cardCounterMultiplier,
    cardTypeToBuilding,
    findCatalogCard,
    luckTextOfTier,
    rarityDisplayName,
    rarityRank,
    ZCAttackTrait,
    ZCDeckBonuses,
    ZCDeckCard,
    ZCUnitDefinition,
} from './ZCCombatCatalog';
import type { ZCRuntimeRules } from './ZCGameRuntimeConfig';
import {
    ZCLegacySkillEffectRuntime,
    type ZCLegacyBuffApplication,
    type ZCLegacySkillEvaluation,
} from './ZCLegacySkillEffect';
import { compileZCMatchRuntime } from './ZCMatchRuntimeCompiler';
import type { ZCUnitStatPatch } from './ZCModifierRuntime';
import type { ZCPvpRarityModifier } from './ZCPvpTileRules';
import { ZCPvpTileType } from './ZCPvpTileRules';
import type { ZCSkillRuntimeDefinition } from './ZCSkillRuntime';
import { ZCStatusSystem } from './ZCStatusEffect';

import type { ZCFaction } from './ZCMapConfig';
import { ownersForPlayerCount, ZC_OWNER_ORDER, ZCOwner } from './ZCMapConfig';
import {
    isZCNeutralResourceBuilding, neutralResourceItemOf,
    type ZCNeutralResourceItem,
} from './ZCNeutralResourceGroup';
export type {
    ZCActionFailureReason,
    ZCActionResult,
    ZCBuildingCooldownState,
    ZCBuildingType,
    ZCCardReveal,
    ZCCombatEvent,
    ZCCombatEventType,
    ZCCombatFloatTextKind,
    ZCDevelopResult,
    ZCFloatText,
    ZCFloatTextKind,
    ZCGameStatus,
    ZCHexActivation,
    ZCHexState, ZCProjectileState, ZCScoreBreakdown,
    ZCSnapshot,
    ZCTileState,
    ZCUnitBattleState,
    ZCUnitState
} from './ZCGameTypes';
export {
    configureZCMap,
    defaultZCSectionAt, getZCLocalPlayerCountOverride, getZCMapOwner,
    getZCMapSection, isRandomMapCandidate,
    ownerForSection,
    ownersForPlayerCount, ZC_DEFAULT_HOME_MIN_DISTANCE,
    ZC_DEFAULT_RESOURCE_MIN_DISTANCE,
    ZC_DEPTH_ORDER,
    ZC_DEPTH_TENDENCY,
    ZC_ENEMY_HOME_ID,
    ZC_HEX_CONFIG,
    ZC_INITIAL_TERRITORY,
    ZC_MAP_ART,
    ZC_MAP_CITY_MODE,
    ZC_MAP_COLUMNS, ZC_MAP_HOME_CANDIDATES, ZC_MAP_HOMES,
    ZC_MAP_ID,
    ZC_MAP_PLAYER_COUNT,
    ZC_MAP_REGIONS, ZC_MAP_RESOURCE_POINTS,
    ZC_MAP_ROWS,
    ZC_MAP_SECTIONS,
    ZC_MAP_SPACING, ZC_OWNER_ORDER, ZC_PLAYER_HOME_ID,
    ZC_RESOURCE_MIN_DISTANCE_FLOOR,
    ZC_TENDENCY_TEXT
} from './ZCMapConfig';
export type {
    ZCCityMode, ZCDepth, ZCFaction, ZCHexConfig, ZCMapArt, ZCMapHome, ZCMapHomeCandidates, ZCMapLayout,
    ZCMapRegion, ZCMapResolvedResource, ZCMapResourcePoint, ZCMapSpacing, ZCOwner, ZCPlayerCount, ZCSection, ZCTendency
} from './ZCMapConfig';

import type {
    DeepReadonly,
    ZCActionFailureReason,
    ZCActionResult,
    ZCBuildingCooldownState, ZCCardReveal,
    ZCCombatTarget,
    ZCDamageSource,
    ZCDevelopResult,
    ZCFloatText, ZCGameStatus,
    ZCHexActivation,
    ZCHexState,
    ZCHitFx,
    ZCHitFxSurface,
    ZCProjectileState,
    ZCScoreBreakdown,
    ZCSnapshot,
    ZCUnitState
} from './ZCGameTypes';

 /** 《占城大师》PVE 对局纯逻辑层，不依赖 Cocos API。
 * 棋盘解析在 ZCMapConfig，状态结构在 ZCGameTypes，地块生成与抽取规则在 ZCPvpTileRules。
*/

/**
 * 结算 MVP 的逐卡统计（同一张卡的多只兵合并；键为 `owner:cardId`）。
 * 只在本局生命周期有效，不进快照。
*/
export interface IZCCardDamage {
    readonly owner: ZCOwner;
    readonly unitId: string;
    readonly cardId: string;
    readonly damage: number;
    readonly damageTaken: number;
}

/** 内部账本（同字段但可写；对外只暴露 `IZCCardDamage` 只读形态）。*/
type ZCCardDamageLedger = { -readonly [K in keyof IZCCardDamage]: IZCCardDamage[K] };

export const ZC_UNIT_CAP = 100;
/**
 * 上报的帧事件操作码（协议 `CmdBattleFrameInfo.op`）：1=翻格、2=释放技能、4=出生点。
 * （协议还有 3=聊天，客户端没有战斗内聊天，不采集。）
*/
const FRAME_OP_DEVELOP = 1;
const FRAME_OP_SKILL = 2;
const FRAME_OP_SPAWN = 4;
/** 城墙耐久来自本局规则的 wallMaxHp（PVP-全局表）。*/

/** 城墙/建筑占据一格，近战单位可从相邻格继续靠近并攻击其边缘。*/
const STRUCTURE_TARGET_BODY_RADIUS = 80;
/** 召唤物四个阵位的基准角（度，数学坐标系：0°=+x、90°=屏幕上方）：左上/右上/左下/右下。实际摆位叠加本体朝向。*/
const SUMMON_SLOT_DEGREES = [135, 45, 225, 315] as const;
/** 独立分身默认散落半径（棋盘逻辑 px）。*/
const SUMMON_SCATTER_RADIUS = 20;
/** 独立分身逐个生成间隔（秒），用于按时序错开生成表现。*/
const SUMMON_STAGGER_SECONDS = 0.1;
/** 特效起播至分身实体出现的时间差（秒），避免生成前实体作为隐形目标被攻击。*/
const SUMMON_APPEAR_DELAY_SECONDS = 0.32;
/** 分身生成特效默认时长（秒，26 帧 @ 24fps），与动画 clip 长度匹配。*/
const ZC_SUMMON_SPAWN_FX_SECONDS = 26 / 24;
/** 独立分身默认透明度兜底（配表缺省 summonAlpha 时使用）。*/
const SUMMON_INDEPENDENT_ALPHA = 0.65;
/** 召唤脚底光环默认兜底时长（秒，避免无限期常驻 groundZones）。*/
const SUMMON_AURA_FALLBACK_SECONDS = 6;
/**
 * 持续光环伤害效果覆盖本体及阵位随从的事件级放大倍率（effectScale）。
 * 基于可见环半轴（91.9 × 36.05 屏上 px）与斜角阵位投影换算，使纵向能完整圈入站位。
 */
export const ZC_SUMMON_AURA_COVER_SCALE = ZC_EFFECT_SCALE.summonAuraCoverScale;
/**
 * 屏上 px ÷ 世界 px（各向异性：2.5625 / 2.1429）。
 * 与 HexGridLayout 格距常量联动换算，改格距或镜头比例时自动跟随。
 */
const SUMMON_AURA_MAP_SCALE_X = HEX_GRID_VIEW_COLUMN_SPACING / HEX_GRID_LOGICAL_COLUMN_STEP;
const SUMMON_AURA_MAP_SCALE_Y = HEX_GRID_VIEW_ROW_SPACING / HEX_GRID_LOGICAL_ROW_STEP;
/** effectScale = 1 时持续光环可见环半轴（屏上 px）。*/
const SUMMON_AURA_RING_HALF_SCREEN_X = ZC_EFFECT_SCALE.summonAuraRingHalfScreenX;
const SUMMON_AURA_RING_HALF_SCREEN_Y = ZC_EFFECT_SCALE.summonAuraRingHalfScreenY;

/**
 * 光圈在世界坐标系下覆盖的半轴（世界 px）。
 * 地面特效尺寸由 prefab 与 effectScale 决定，以此作为召唤物活动范围真源。
 */
export function zcSummonAuraLeashHalfWorld(
    effectScale: number = ZC_SUMMON_AURA_COVER_SCALE,
): { readonly x: number; readonly y: number } {
    return {
        x: SUMMON_AURA_RING_HALF_SCREEN_X * effectScale / SUMMON_AURA_MAP_SCALE_X,
        y: SUMMON_AURA_RING_HALF_SCREEN_Y * effectScale / SUMMON_AURA_MAP_SCALE_Y,
    };
}
/**
 * 弹道扫掠段找结构目标时的采样间隔（逻辑 px）。
 *
 * 格距 36×42、格内切半径约 21 ⇒ 取 8 能保证一帧的飞行段不会被"跳格"漏掉，
 * 而每帧最多也只多算 2~3 个点（`hexIdAt` 是 3×3 邻域查表，代价可控）。
*/
const STRUCTURE_SAMPLE_STEP = 8;
/** 伤害飘字存活时长（秒）。*/
const FLOAT_TEXT_DAMAGE_SECONDS = 0.85;
/**
 * 金币掉落飘字存活时长（秒）；曲线见 `floatTextGoldDrop`（掉落 30% / 停顿 15% / 缩小 55%）。
 * 0.62s 才配得上「迅速缩小消失」的手感，拉长会变回慢慢缩小。
*/
const FLOAT_TEXT_GOLD_SECONDS = 0.62;
/**
 * 建筑产金飘字存活时长（秒）：上升 50px 再淡出，0.9s 分成上升 0.63s、顶端淡出 0.27s。
 * 与击杀掉落的 0.62s 拆开，两者表现不同。
*/
const FLOAT_TEXT_GOLD_INCOME_SECONDS = 0.9;
/**
 * 受击特效存活时长（秒），队列保留时长与拿不到 clip 时的兜底共用这个值。
 * 正常播放由 `ZCEffectPool.HIT_FX_TARGET_SECONDS` 压到 0.15s，两处必须同值
 * （`tests/zcds-hit-fx.test.ts` 有断言）；多出来的部分就是「播完还杵着」的空窗。
*/
const HIT_FX_SECONDS = 0.15;
/**
 * 出兵落点相对兵营中心的偏移半径（逻辑单位），取 20 而不是行距一半的 21。
 * 21 正好压在相邻格的公共边上，归属会判给上邻格；退 1 后任意角度都落在本格内。
*/
const SPAWN_OFFSET_RADIUS = HEX_GRID_LOGICAL_ROW_STEP / 2 - 1;
/**
 * 塔防「同一波内逐只出怪」的时间间隔（秒）。
 * 同一波怪按固定时间错峰生成形成行进纵队，平衡队列视觉表现与出兵推进节奏。
 */
export const ZC_DEFENCE_SPAWN_INTERVAL_SECONDS = 0.15;

/** 一张「这一波还要再出 N 只」的票；`spawned` 到 `count` 就出队。*/
interface ZCDefenceSpawnTicket {
    /** 波序（0 基），账本按它记账。*/
    readonly waveIndex: number;
    readonly card: ZCDeckCard;
    readonly tier: number;
    /** 表 `defenceModWave.monsterSize` 投影出的模型缩放，1 = 不缩放。*/
    readonly sizeScale: number;
    readonly count: number;
    /** 拆城跳末波时为真：末波不能被已有兵力上限吞掉。*/
    readonly ignoreUnitCap: boolean;
    spawned: number;
    nextSpawnAt: number;
}

/** HUD 只读的塔防进度，不进入战斗快照；恢复时可由配置、时间与存活单位重新推导。*/
export interface ZCDefenceWaveProgress {
    totalWaves: number;
    spawnedWaves: number;
    currentWaveId: number | null;
    nextWaveId: number | null;
    secondsUntilNextWave: number | null;
    aliveEnemies: number;
    /**
     * 当前波（`currentWaveId` 那一波）剩余的总血量（蓝湖「BOSS」稿的血条填充）。
     *
     * 「按波聚合」而不是取某只代表怪：设计稿那条红条压着一整波怪，怪死一只条掉一截。
    */
    currentWaveHp: number;
    /** 当前波的总血量上限（生成那一刻固定下来，与剩余量同减才不会被"分母也跟着掉"骗到）。*/
    currentWaveMaxHp: number;
    /** 当前敌方服务端生命倍率（HUD 上显示成 `X4` 那类）。*/
    currentWaveHpRate: number;
    /** 当前波用的卡 id（HUD 用它取首领头像与名字）；该波没生成过单位时为 null。*/
    currentWaveCardId: string | null;
    /**
     * 当前波是不是 BOSS 波。
     *
     * HUD 那条大血条（`ZCBossPanel`）只在它为真时展示；普通小怪只有头顶血条。
     * 判据：`wave.isBoss`；表里没填时按「最后一波」兜底（口径见 `projectDefenceWaves`）。
    */
    currentWaveIsBoss: boolean;
}

interface ZCEffectiveDefinitionCacheEntry {
    readonly revision: number;
    readonly inherited: ZCUnitState['inheritedStats'];
    readonly gateSize: ZCUnitState['gateSize'];
    readonly gateScale: ZCUnitState['gateScale'];
    readonly gateMove: ZCUnitState['gateMoveMultiplier'];
    readonly gateAttackSpeed: ZCUnitState['gateAttackSpeedMultiplier'];
    readonly gateDamage: ZCUnitState['gateDamageMultiplier'];
    readonly def: ZCUnitDefinition;
}

export class ZCGameModel {
    private readonly neutralFeatures: ZCNeutralFeatureSystem;
    private state: ZCSnapshot;
    private debugDraw: { card: ZCDeckCard; remaining: number } | null = null;
    private readonly debugCards = new Map<string, ZCDeckCard>();
    /** 服务端完成战斗接口需要的操作记录，随结算 commands 一起上报。*/
    readonly frameEvents: Array<{ frameId: number; owner: ZCOwner; op: number; params: number[] }> = [];
    private readonly config: ZCMatchConfig;
    private readonly activeOwners: readonly ZCOwner[];
    private readonly geometry: ZCMapGeometry;
    /** 弹道找结构目标时复用（每次调用开头清空），避免每帧每弹道新建 Set。*/
    private readonly structureHexScratch = new Set<number>();
    private readonly captureSystem: ZCCaptureSystem;
    /** 模型能力表：各系统 context 从这里取子集，见 `IZCModelServices`。*/
    private readonly services: IZCModelServices;
    private readonly movement: ZCMovementSystem;
    private readonly economyContext: ZCEconomyContext;
    private readonly definitions: ReadonlyMap<string, ZCUnitDefinition>;
    /** 静态技能/星级修正按阵营隔离并预计算，tick 内不再分配临时对象。*/
    private readonly effectiveDefinitions: Record<ZCOwner, ReadonlyMap<string, ZCUnitDefinition>>;
    /** 2026-10-13 新增 9 种 statId 的累加值（暴击/弹幕/连击/产兵）；不在 `ZCUnitDefinition` 上，按 owner × unitId 索引。*/
    private readonly unitStatPatches: Partial<Record<ZCOwner, ReadonlyMap<string, ZCUnitStatPatch>>> = {};
    private readonly cards: Record<ZCOwner, ReadonlyMap<string, ZCDeckCard>>;
    private readonly skillRuntime: Record<ZCOwner, ReadonlyMap<string, ZCSkillRuntimeDefinition>>;
    private readonly neutralSkillRuntime: ReadonlyMap<string, ZCSkillRuntimeDefinition>;
    private readonly legacySkillRuntime: ZCLegacySkillEffectRuntime;
    private readonly legacyAttributes: Record<ZCOwner, ReadonlyMap<string, Readonly<Record<string, unknown>>>>;
    private readonly units = new ZCUnitRegistry();
    private readonly statusSystem = new ZCStatusSystem();
    /** 按单位状态版本 + 门/继承字段缓存 effectiveDefinition，避免每次候选/攻击重算。*/
    private readonly effectiveCache = new Map<number, ZCEffectiveDefinitionCacheEntry>();
    private readonly projectileSystem = new ZCProjectileSystem();
    private readonly statusResolutionSystem = new ZCStatusResolutionSystem();
    private readonly projectileContext: ZCProjectileContext;
    private readonly targetingContext: ZCTargetingContext;
    private readonly unitTargeting: ZCUnitTargeting;
    private readonly radiusHexes = new Map<string, readonly number[]>();
    private targetHexRevision = -1;
    private readonly targetHexes: ZCHexState[] = [];
    /** 按索敌方 owner 预分组：怪物对所有人可索敌，其余目标只进入非己方 owner 的组。*/
    private readonly candidateHexesByOwner = new Map<ZCOwner, ZCHexState[]>(
        ZC_OWNER_ORDER.map(owner => [owner, [] as ZCHexState[]]),
    );
    private readonly exposedWalls = new Set<number>();
    private tileStatesDirty = true;
    private topologyRevision = 0;
    private readonly connectedDevelopedCache = new Map<number, readonly number[]>();
    private hexRenderMap: Map<number, ZCMutableRenderHex> | null = null;
    /** 投影字段最近一次刷新对应的逻辑时钟；同一逻辑步的多个显示帧直接复用。*/
    private hexRenderElapsed = -1;
    private hexRenderTopologyRevision = -1;
    /** 席位→格数缓存：HUD 一帧要取 4 个席位的数，不逐席位过滤全盘。*/
    private readonly territoryCounts = new Map<ZCFaction, number>();
    private territoryCountsReady = false;
    private readonly unitContext: IZCUnitContext;
    private readonly groundZoneContext: IZCGroundZoneContext;
    private readonly attackResolutionContext: IZCAttackResolutionContext;
    private readonly statusResolutionContext: IZCStatusResolutionContext;
    private readonly damageResolutionContext: IZCDamageResolutionContext;
    private readonly developmentContext: IZCDevelopmentContext;
    private readonly skillTriggerContext: IZCSkillTriggerContext;
    private createAttackResolutionContext(): IZCAttackResolutionContext {
        return {
            rules: this.services.rules,
            counters: this.config.counters,
            cards: this.cards,
            skillRuntime: this.skillRuntime,
            neutralSkillRuntime: this.neutralSkillRuntime,
            statPatches: this.unitStatPatches,
            deckBonuses: this.deckBonuses,
            unitById: this.units.byId,
            geometry: this.services.geometry,
            statusSystem: this.services.statusSystem,
            random: this.services.random,
            currentTarget: (unit, out?) => this.unitTargeting.current(unit, out),
            effectiveDefinition: this.services.effectiveDefinition,
            evaluateLegacySkill: (unit, keys, target, critical) => this.evaluateLegacySkill(unit, keys, target, critical),
            applyLegacySelfBuffs: (unit, buffs) => this.applyLegacySelfBuffs(unit, buffs),
            unitPosition: this.services.unitPosition,
            damageUnit: this.services.damageUnit,
            tryExecuteUnit: (unit, chance, owner, sourceId, text) => this.tryExecuteUnit(unit, chance, owner, sourceId, text),
            applyHitStatus: (unit, id, sourceId) => this.applyHitStatus(unit, id, sourceId),
            applyLegacyBuffs: (unit, buffs, sourceId) => this.applyLegacyBuffs(unit, buffs, sourceId),
            damageWall: (source, wall, damage) => this.damageWall(source, wall, damage),
            damageBuilding: (source, building, damage) => this.damageBuilding(source, building, damage),
            unitsInRadius: (id, radius) => this.unitsInRadius(id, radius),
            //  2026-11-04 椰蛋战士：吸血回血 / 横扫击退。两者都复用既有实现，
            //  不在这里另写一套 —— 回血的上限与飘字口径要跟状态表 `periodic_heal` 一致，
            //  击退的撞墙/不可走格吞噬要与 `legacy_knockback` 一致。
            healUnit: (unit, amount) => ZCStatusResolutionSystem.healUnit(unit, amount, this.statusResolutionContext),
            applyKnockback: (target, source, amount) => this.applyLegacyKnockback(target, source, amount),
            //  追踪导弹：把攻击系统构造好的弹体写进对局状态（复用既有 `state.projectiles` 口径，
            //  弹道飞行 / 碰撞 / 命中结算都在 `ZCProjectileSystem` + `resolveProjectileHit` 里完成）。
            pushProjectile: (projectile) => { this.state.projectiles.push(projectile); },
        };
    }
    private readonly legacyCombatContext: IZCLegacyCombatContext = {
        rules: () => this.rules,
        legacyConfig: () => this.config.legacySkillEffects,
        legacyAttributes: (owner) => this.legacyAttributes[owner],
        legacySkillRuntime: () => this.legacySkillRuntime,
        statusSystem: () => this.statusSystem,
        random: () => this.random(),
        bonusesFor: (owner) => this.bonusesFor(owner),
        effectiveUnitDefinition: (unit) => this.effectiveUnitDefinition(unit),
        unitById: (id) => this.units.byId.get(id),
        hex: (id) => this.hex(id),
        applyLegacyKnockback: (target, source, amount) => this.applyLegacyKnockback(target, source, amount),
    };
    private readonly random: () => number;
    private readonly rules: Readonly<ZCRuntimeRules>;
    private readonly deckBonuses: Readonly<Record<ZCOwner, ZCDeckBonuses>>;
    private readonly pveDefence: Readonly<ZCPveDefenceConfig> | null;
    private readonly outcomeContext: IZCOutcomeContext;
    /**
     * NPC 两次翻地块的最小间隔（秒）：只约束 NPC，玩家翻格不受影响；
     * 计时从第一次翻格之后开始，首格不被拖后。取值 max(下限 1s, openGrideTime)；
     * 0 / 缺省表示不额外限速，仍走全局 `enemyAiIntervalSeconds`。
    */
    private readonly aiDevelopIntervalSeconds: number;
    /**
     * `levelInfo.gradeProModifier`：NPC 席位翻地块抽卡的品质权重乘数。
     *
     * 玩家席位永远不套用（`drawRulesOf` 里按 `owner === ZCOwner.Player` 拦截）：
     * 这是关卡难度旋钮，压的是 NPC 抽卡质量，不是改全局地块表。
     * `null` ⇒ 本关没配（塔防关卡、以及空对象的 17 关）。
    */
    private readonly npcRarityModifier: ZCPvpRarityModifier | null;
    /**
     * 本局的非真人席位（关卡 PVE / 塔防的 NPC 队伍）；空 = 全员真人（PVP 匹配）。
     *
     * 只服务伤害飘字的显示口径，见 `floatTextToneOf`。真源是 `ZCMatchConfig.npcOwners`，
     * 由入口构筑时按「有没有 `pve`」写入 —— 这里不按 owner 反推（PVP 4 人局里
     * 另外三个席位也是真人）。
    */
    private readonly npcOwners: readonly ZCOwner[];
    private nextDefenceWaveIndex = 0;
    /**
     * 本局真正的胜方（draw/未定 = null），由 `ZCOutcomeSystem` 写入。
     * `status` 只分我方视角的胜负，4 人局里无法反推是哪一方赢，结算铺地要靠这个字段。
     * 刻意不进快照：纯表现用的一次性结论，复盘时按同一套规则重算。
    */
    private matchWinner: ZCOwner | null = null;
    /**
     * 每波生成过的单位 id 与本波总血量上限（键 = 波序，与 `nextDefenceWaveIndex` 同序）。
     *
     * 塔防 HUD 那条「本波剩余 / 本波总」的血条要一个不会跟着死亡往下掉的分母 ⇒ 总血量必须在
     * 生成那一刻记下来（`spawnUnit` 里应用了服务端倍率与卡组加成，事后算不回来）。
     * 只记 id 不记对象引用：单位死亡后会被 `removeDeadUnits` 摘掉，活着查不到就按 0 计。
    */
    private readonly defenceWaveLedger: Array<{ ids: number[]; maxHp: number }> = [];
    /**
     * 正在逐只出怪的波次（同一波按 `ZC_DEFENCE_SPAWN_INTERVAL_SECONDS` 拉开）。
     *
     * 波次到点 / 清空提前出怪时只**登记**一张票（`nextSpawnAt` = 当帧），真正的
     * `spawnUnit` 交给 `advanceDefenceSpawnQueue` 每拍补——这样同一波的多只怪
     * 不会挤在同一帧出生。票按波序各自计时：拆城跳末波时老票仍在排队，不互相顶掉。
     *
     * 🔴 只活在内存里（和 `defenceWaveLedger` 同口径）：读档后中途未出完的怪不再补，
     * 波序由 `nextDefenceWaveIndex` 恢复，与旧实现「账本丢失」的边界一致。
     */
    private readonly defenceSpawnQueue: ZCDefenceSpawnTicket[] = [];
    /** 本局有效伤害统计；重开清零，存档恢复从零统计。*/
    private readonly damageDealt: Record<ZCOwner, number> = { player: 0, enemy: 0, enemy2: 0, enemy3: 0 };
    /** 每方「承受伤害」累计值；只给对局结算页（GameRunAway）读，不进快照。*/
    private readonly damageTaken: Record<ZCOwner, number> = { player: 0, enemy: 0, enemy2: 0, enemy3: 0 };
    /**
     * 逐卡伤害（键 = `${owner}:${cardId}`）。
     * 结算页 MVP 要从「输出最高的**卡**」里选人，per-owner 的 `damageDealt` 分不出同阵营多张卡；
     * 同一张卡的多只兵合并成一行。与 owner 统计同生命周期：重开清零、不进快照。
    */
    private readonly cardDamage = new Map<string, ZCCardDamageLedger>();
    /**
     * 实例 id → 卡身份（`owner` + 兵种 + 卡）。
     * 单位死亡后仍保留：伤害发生在死亡前，结算时不能因为单位被摘掉就丢掉归属。
    */
    private readonly unitCards = new Map<number, Omit<IZCCardDamage, 'damage' | 'damageTaken'>>();

    /**
     * 建成的兵营「首批兵」延迟生成队列：开格动画期间单位不能提前站上来。
     * 建造中完工那条路径没有激活表现，不经过这里。
    */
    private readonly deferredBarracksSpawns: Array<{ atSeconds: number; hexId: number }> = [];

    private readonly presentation = new ZCBattlePresentationQueue();

    /**
     * `random` 是整局唯一的随机源：初始地块分布（`ZCSnapshotCodec.createInitialState`
     * → `createPvpTileTypes`）、抽地块与金币保底（`drawPvpTile`）、AI 选格、单位出生抖动
     * 全部走它。正式对局由服务端种子播种 —— `ZCGame.createGame` 传的就是
     * `ZCSeededRandom.createSeededRandom(seed)`；缺省 `Math.random` 供离线对局、
     * 编辑器里单独挂载与单测使用（行为与接入种子之前逐位一致）。
    */
    constructor(snapshot?: ZCSnapshot | null, random: () => number = Math.random, config?: ZCMatchConfig) {
        this.random = random;
        this.config = captureZCMatchConfig(config);
        this.legacySkillRuntime = new ZCLegacySkillEffectRuntime(this.config.legacySkillEffects);
        this.activeOwners = ownersForPlayerCount(this.config.map.playerCount ?? 2);
        for (const definition of this.config.statusDefinitions ?? []) this.statusSystem.register(definition);
        this.rules = this.config.rules;
        this.pveDefence = this.config.pveDefence?.waves.length ? this.config.pveDefence : null;
        //  关卡「翻地块频率」只做限速：AI 原本 2.8s 一拍，关卡要求 18s 就按 18s 走。
        //  0 表示「够钱就翻」⇒ 不额外压，保持全局节奏。
        const openGrideTime = Number(this.config.openGrideTime);
        //  关卡「翻地块频率」= NPC 两次点地块的最小间隔，可上可下：表里填 1~2.7 秒同样生效，
        //  只有小于 1 秒才会被压到 `ZC_AI_MIN_DEVELOP_INTERVAL_SECONDS`（旧实现用全局 2.8s 当下限，
        //  等于只能变慢、不能变快，策划调快会被静默吞掉）。0 = 不额外限速，按全局节奏。
        this.aiDevelopIntervalSeconds = Number.isFinite(openGrideTime) && openGrideTime > 0
            ? Math.max(ZC_AI_MIN_DEVELOP_INTERVAL_SECONDS, openGrideTime)
            : this.rules.enemyAiIntervalSeconds;
        //  关卡「抽卡品质权重乘数」：只给 NPC 席位。空对象等同于没配，早期就归一成 null，
        //  免得每一拍抽卡都白跑一次乘算。
        const gradeProModifier = this.config.gradeProModifier;
        this.npcRarityModifier = gradeProModifier && Object.keys(gradeProModifier).length > 0
            ? gradeProModifier
            : null;
        this.npcOwners = this.config.npcOwners ?? [];
        this.outcomeContext = {
            activeOwners: this.activeOwners,
            pveDefence: this.pveDefence,
            homeId: (owner) => this.homeId(owner),
        };
        this.geometry = new ZCMapGeometry(this.config.map);
        this.captureSystem = new ZCCaptureSystem(this.geometry, this.config.map, this.rules);
        this.services = this.buildServices();
        this.groundZoneContext = this.buildGroundZoneContext();
        this.targetingContext = this.buildTargetingContext();
        this.projectileContext = this.buildProjectileContext();
        const compiled = compileZCMatchRuntime(this.config);
        this.definitions = compiled.definitions;
        this.effectiveDefinitions = compiled.effectiveDefinitions;
        this.unitStatPatches = compiled.unitStatPatches;
        this.skillRuntime = compiled.skillRuntime;
        this.neutralSkillRuntime = compiled.neutralSkillRuntime;
        this.legacyAttributes = compiled.legacyAttributes;
        this.deckBonuses = compiled.deckBonuses;
        this.cards = {
            player: compiled.cards, enemy: compiled.cards,
            enemy2: compiled.cards, enemy3: compiled.cards,
        };
        this.attackResolutionContext = this.createAttackResolutionContext();
        this.damageResolutionContext = this.buildDamageResolutionContext();
        this.developmentContext = this.buildDevelopmentContext();
        this.statusResolutionContext = this.buildStatusResolutionContext();
        this.skillTriggerContext = this.buildSkillTriggerContext();
        this.registerRuntimeStatuses();
        this.economyContext = this.buildEconomyContext();
        this.movement = this.buildMovement();
        this.unitTargeting = this.buildUnitTargeting();
        this.unitContext = this.buildUnitContext();
        this.neutralFeatures = new ZCNeutralFeatureSystem(this.config.map, {
            random: this.random,
            definition: unit => this.effectiveUnitDefinition(unit),
            monsterDefinition: card => this.unitDefinition(card.unitId),
            rules: this.rules,
            cloneUnit: unit => this.cloneGateUnit(unit),
            spawnBatch: hex => this.spawnFirstBarracksUnit(hex),
            damageUnit: (unit, damage, owner) => { this.damageUnit(unit, damage, { owner: owner ?? 'neutral', kind: 'building' }); },
            damageStructure: (hex, damage, owner, fromId) => {
                const from = this.config.map.hexes[fromId];
                const source = { owner, freeX: from.x, freeY: from.y };
                if (hex.wallHp > 0) this.damageWall(source, hex, damage, true);
                else this.damageBuilding(source, hex, damage);
            },
            capture: (hex, owner) => this.captureEmptyTile(hex, owner),
            changed: () => { this.tileStatesDirty = true; this.invalidateTerrain(); },
        });
        this.restoreOrCreateState(snapshot);
    }

    // 构造期装配：目标字段均为 readonly，只能在 constructor 内赋值，故此处返回后由调用方装配。
    //
    //  各 context 会重复声明 unitPosition / effectiveDefinition / units 等能力，不要合并成统一能力表。
    // 重复是有意的类型收窄，彼此并不等价：
    //   · `IZCStatusResolutionContext.effectiveUnitDefinition` 只返回 Pick<ZCUnitDefinition,'attack'|'maxHp'>
    //     （状态系统只读这两个字段，实测只出现 attack×3 / maxHp×2）；其 `damageUnit` 返回 void（不产生飘字）。
    //   · `IZCAttackResolutionContext.damageUnit` 返回 ZCFloatText | null（攻击系统要拿飘字做命中数字）。
    //   · `units` 在 Target/Projectile 是 readonly ZCUnitState[]、在 UnitTargeting 是 ReadonlyMap、
    //     在 DamageResolution 是 ZCUnitRegistry —— 三种视图各服务不同遍历方式。
    // 合并成一套签名会让系统看到它不该依赖的字段，把「这个系统能改什么」的边界放大。

    // 用箭头函数而不是方法引用：这些回调会在系统内部的任意时刻被调用，
    // 必须把 this 绑死在组合根上，不能依赖调用方的 this。
    private buildServices(): IZCModelServices {
        return {
            rules: this.rules,
            statusSystem: this.statusSystem,
            geometry: this.geometry,
            random: () => this.random(),
            unitPosition: (unit, result) => this.unitPosition(unit, result),
            effectiveDefinition: (unit) => this.effectiveUnitDefinition(unit),
            damageUnit: (unit, damage, source) => this.damageUnit(unit, damage, source),
            hex: (id) => this.hex(id),
            hasExposedWall: (hex) => this.hasExposedWall(hex),
            unitCount: (owner) => this.unitCount(owner),
            spawnUnit: (owner, card, tier, hexId) => this.spawnUnit(owner, card, tier, hexId),
            bonuses: (owner) => this.bonusesFor(owner),
        };
    }

    private buildGroundZoneContext(): IZCGroundZoneContext {
        return {
            //  两段式移动的接近阶段要追着目标走（2026-11-07 鹿神守护 103405）：
            //  给的是索引查询而不是 `state.units.find`，一个区域每帧一次，不该线性扫全表。
            unitById: (id) => this.units.byId.get(id),
            hexStep: HEX_GRID_LOGICAL_ROW_STEP,
            hexIdAt: (x, y) => this.geometry.hexIdAt(x, y),
            unitsInRadius: (hexId, radiusHex) => this.unitsInRadius(hexId, radiusHex),
            unitPosition: this.services.unitPosition,
            damageUnit: this.services.damageUnit,
            //  牵引（2026-11-18 第 17 批 102004 飓风）：与状态系统那条强制位移共用同一个出口 ——
            //  落在不可走格上会减半重试，成功后清掉 `targetHexId` 让单位重新寻路。
            displaceUnit: (unit, dx, dy) => this.displaceUnit(unit, dx, dy),
            combatDistanceScale: this.rules.combatDistanceScale,
            ensureSlowStatus: (id, speedPct, duration) => this.ensureMoveSpeedStatus(id, speedPct, duration),
            applyStatus: (unit, id, options) => this.statusSystem.apply(String(unit.id), id, options),
            exportStatusEffects: () => this.statusSystem.exportSnapshot(),
            //  命中挂状态的概率掷骰（2026-11-11 磁电菇「五雷轰顶」的 30% 麻痹）：
            //  必须走对局种子随机，`Math.random` 会让回放/快照重算给出不同的控制结果。
            random: this.services.random,
            //  区域波次的吸血（2026-11-04）：区域上下文只有「谁打的 + 这一跳掉多少」，
            //  这里补回源单位，转给普攻同一条 applyLifesteal（比例取法完全同源）。
            //  源单位已阵亡 / 已离场 ⇒ 直接跳过：区域还在飘、人已经没了，不该继续吸。
            //  注意 `attackResolutionContext` 在本方法之后才构造，所以必须用闭包延迟取，
            //  不能在 buildGroundZoneContext 里直接读它的字段。
            lifestealFromHit: (sourceUnitId, hitText) => {
                const source = this.units.byId.get(sourceUnitId);
                if (!source || source.battleState === 'dead') return;
                ZCAttackResolutionSystem.applyLifesteal(source, hitText, this.attackResolutionContext);
            },
        };
    }

    private buildTargetingContext(): ZCTargetingContext {
        const model = this;
        return {
            get now() { return model.state.elapsedSeconds; },
            get units() { return model.state.units; },
            get hexes() { model.refreshTargetHexes(); return model.targetHexes; },
            unitsOf: (owner) => this.units.unitsOf(owner),
            candidateHexes: (owner) => {
                model.refreshTargetHexes();
                return model.candidateHexesByOwner.get(owner) ?? [];
            },
            unitById: (id) => this.units.byId.get(id) ?? null,
            unitPosition: this.services.unitPosition,
            hexPosition: (id) => this.hexCenter(id),
            preferUnitTargets: (unit) => !!this.pveDefence && unit.owner === ZCOwner.Player,
            baseDefinition: (id) => this.unitDefinition(id),
            effectiveDefinition: this.services.effectiveDefinition,
            hasExposedWall: this.services.hasExposedWall,
        };
    }

    private buildProjectileContext(): ZCProjectileContext {
        const model = this;
        return {
            get now() { return model.state.elapsedSeconds; },
            get units() { return model.state.units; },
            distanceScale: this.rules.combatDistanceScale,
            effectiveDefinition: this.services.effectiveDefinition,
            structureTargets: (projectile, fromX, fromY, toX, toY, out) =>
                this.projectileStructureTargets(projectile, fromX, fromY, toX, toY, out),
            hit: (projectile, target) => this.resolveProjectileHit(projectile, target),
            allyPass: (projectile, unit) => this.healAllyOnProjectilePass(projectile, unit),
            linger: (projectile) => this.lingerBeam(projectile),
            //  到点引爆（2026-11-18 第 16 批「连射导弹」101304）：只走落点的弹体飞完那一刻，
            //  在落点做范围结算。命中那条通道（`hit`）与它互斥 —— 两种弹体各自只走一条。
            arrive: (projectile) => this.resolveProjectileArrival(projectile),
        };
    }

    /**
     * 弹道穿过己方单位回血（2026-11-17 急冻瓜「贯穿滋养」102401）。
     *
     * 额度（`allyHealLeft`）与去重（`allyHealIds`）已经由 `ZCProjectileSystem` 扣好/记好，
     * 这里只负责把血加回去。走 `ZCStatusResolutionSystem.healUnit` —— 封顶 `maxHp`、
     * 死亡不生效、溢出丢弃，与吸血（100703）/ 吃口菠萝（100603）同一条实现，
     * 不另开一套治疗口径，免得「有的治疗吃加成、有的不吃」。
     *
     * 比例按**被治疗单位自己的最大生命**算（`unit.maxHp * pct`），
     * 不是施法者的 —— 「回复 3% 生命」在玩家理解里就是「回自己血条的 3%」。
     */
    private healAllyOnProjectilePass(projectile: Readonly<ZCProjectileState>, unit: ZCUnitState): void {
        const pct = Math.max(0, Math.min(1, projectile.allyHealPct ?? 0));
        if (!(pct > 0)) return;
        const amount = unit.maxHp * pct;
        if (amount > 0) ZCStatusResolutionSystem.healUnit(unit, amount, this.statusResolutionContext);
    }

    /**
     * 弹道消失同一拍补一条定格光束事件（镭射飞龙）：命中后光柱不跟着弹道一起消失。
     * `from`/`to` 取出手点与命中点，寿命取配表淡出秒数，视图按满长画、逐帧压透明度。
     * 不结算伤害、不参与碰撞，只是 `state.combatEvents` 里的一段表演。
    */
    private lingerBeam(projectile: Readonly<ZCProjectileState>): void {
        //  追踪导弹到点（没撞到人、飞到头）：在末端播爆炸，而不是光束淡出。
        if (projectile.impactEffectPrefabPath) {
            this.state.combatEvents.push({
                id: this.state.nextCombatEventId++,
                type: 'area',
                owner: projectile.owner,
                sourceUnitId: projectile.sourceUnitId,
                targetUnitId: null,
                skillId: projectile.skillId,
                skillName: projectile.skillName,
                effectKey: null,
                projectileKey: null,
                effectPrefabPath: projectile.impactEffectPrefabPath,
                fromX: projectile.x,
                fromY: projectile.y,
                toX: projectile.x,
                toY: projectile.y,
                radius: 0,
                damage: 0,
                empowered: projectile.empowered,
                startedAt: this.state.elapsedSeconds,
                //  与命中那一拍同一条口径：配了 `burstEffectSeconds` 就活够整段动画
                //  （爆炸龙卷 32 帧 = 1.0667s），否则沿用老口径 0.5s。
                durationSeconds: projectile.burstEffectSeconds ?? 0.5,
                //  到点爆炸的倍率（2026-11-18 第 16 批连射导弹）：同一份 prefab 被两条技能
                //  以不同半径复用，只能走事件级倍率；缺省 ⇒ 1（镭射飞龙那条逐字不变）。
                //  强化那一击没有 `impactEffectScale`，回落弹体自己的 `effectScale`（×1.2，定案 A）。
                effectScale: projectile.impactEffectScale ?? projectile.effectScale,
            });
            return;
        }
        const fadeSeconds = zcCombatEffectFadeSecondsOf(projectile.effectPrefabPath);
        if (!(fadeSeconds > 0)) return;
        this.state.combatEvents.push({
            id: this.state.nextCombatEventId++,
            type: 'projectile',
            owner: projectile.owner,
            sourceUnitId: projectile.sourceUnitId,
            targetUnitId: null,
            skillId: projectile.skillId,
            skillName: projectile.skillName,
            effectKey: projectile.effectKey,
            projectileKey: projectile.projectileKey,
            effectPrefabPath: projectile.effectPrefabPath ?? null,
            fromX: projectile.fromX,
            fromY: projectile.fromY,
            //  命中点（弹道已定格在接触点）；没打中就是射程末端。
            toX: projectile.x,
            toY: projectile.y,
            radius: 0,
            damage: 0,
            empowered: projectile.empowered,
            startedAt: this.state.elapsedSeconds,
            durationSeconds: fadeSeconds,
            beamHold: true,
        });
    }

    private buildDamageResolutionContext(): IZCDamageResolutionContext {
        return {
            statusSystem: this.statusSystem,
            units: this.units,
            damageDealt: this.damageDealt,
            damageTaken: this.damageTaken,
            rules: this.rules,
            random: () => this.random(),
        };
    }

    private buildDevelopmentContext(): IZCDevelopmentContext {
        return {
            rules: this.services.rules,
            goldOf: (owner) => this.goldOf(owner),
            setGold: (owner, amount) => this.setGold(owner, amount),
            unitCount: this.services.unitCount,
            spawnUnit: this.services.spawnUnit,
            //  关卡抽卡规则只作用于 NPC：玩家翻地块拿到的仍是 `pvpTile.rarityWeights` 原表 + 正常金色保底。
            //  NPC 一并关掉金色保底：保底绕过权重，会让本关的 `gradeProModifier` 形同虚设。
            //  同时打开「缺档逐级下降」：NPC 卡组由 `npcTeam.npcCard` 定，常常只有绿/蓝，
            //  而高级兵营格要求紫/金 —— 不兜底就永远是空手（用户 2026-11-23）。
            drawRulesOf: (owner) => (owner === ZCOwner.Player
                ? null
                : { rarityModifier: this.npcRarityModifier, goldPity: false, rarityFallback: true }),
            onNeutralReward: (hexId, itemId, owner, item) => {
                this.pushNeutralReward(hexId, itemId, owner, item);
            },
        };
    }

    private buildStatusResolutionContext(): IZCStatusResolutionContext {
        return {
            statusSystem: this.services.statusSystem,
            unitById: this.units.byId,
            owners: this.activeOwners,
            combatDistanceScale: this.rules.combatDistanceScale,
            effectiveDefinition: this.services.effectiveDefinition,
            unitPosition: this.services.unitPosition,
            displaceUnit: (unit, dx, dy) => this.displaceUnit(unit, dx, dy),
            damageUnit: this.services.damageUnit,
            presentHeal: (unit, amount) => {
                const position = this.unitPosition(unit);
                this.pushFloatText({
                    kind: 'heal', owner: unit.owner, value: amount,
                    x: position.x, y: position.y, durationSeconds: this.rules.floatTextDamageSeconds ?? FLOAT_TEXT_DAMAGE_SECONDS,
                });
            },
        };
    }

    private registerRuntimeStatuses(): void {
        // 收集所有技能行上的减速比例，注册成临时 status def（暴雪/冰环类持续区域用）。
        for (const definition of this.definitions.values()) {
            for (const p of [definition.attackProfile, definition.empoweredProfile]) {
                if (p && p.slowRatio && p.slowRatio > 0) {
                    const id = `__slow:${p.slowRatio}__`;
                    if (!this.statusSystem.hasDef(id)) {
                        this.statusSystem.register({
                            id,
                            name: `减速${Math.round(p.slowRatio * 100)}%`,
                            statMods: { moveSpeedPct: -p.slowRatio * 100 },
                            durationSeconds: 1,
                            refreshOnReapply: true,
                        });
                    }
                }
            }
        }
        for (const owner of ZC_OWNER_ORDER) {
            for (const runtime of this.skillRuntime[owner].values()) {
                const slowRatio = runtime.parameters.slowRatio ?? 0;
                if (slowRatio > 0) this.ensureMoveSpeedStatus(`__slow:${slowRatio}__`, -slowRatio * 100, 1);
                const haste = runtime.parameters.moveSpeedBoost ?? 0;
                if (haste > 0) this.ensureMoveSpeedStatus(`__haste:${haste.toFixed(4)}__`, haste * 100, 5);
                const bannerRate = runtime.parameters.bannerCritRate ?? 0;
                if (bannerRate > 0) this.ensureBannerStatus(bannerRate);
            }
        }
    }

    private buildEconomyContext(): ZCEconomyContext {
        return {
            rules: this.services.rules, owners: this.activeOwners,
            homeId: (owner) => this.homeId(owner),
            bonuses: this.services.bonuses,
            cardById: (owner, id) => this.cardById(owner, id),
            cycleSeconds: (hex, card) => this.buildingCycleSeconds(hex, card),
            grantGold: (owner, amount, hexId) => {
                const center = this.hexCenter(hexId);
                this.grantGold(owner, amount, center.x, center.y,
                    FLOAT_TEXT_GOLD_INCOME_SECONDS, 'goldincome');
                //  需求 2026-10-15 row12 / row13：「建筑生成金币的倒计时结束也播放一次
                //【建筑生成单位动画】」「基地和金矿建筑生成金币时，也播放一次建筑的抖动效果，
                // 效果和已经做好的【建筑生成单位角色】动画一致」。
                //
                // 挂在这里而不是 `grantGold` 里面：那条私有路径击杀 / 拆建筑奖励也走
                //（它们没有"建筑在产金币"这回事，没有建筑该抖）。而 `economyContext.grantGold`
                // 的调用点只有两处、正好就是需求的这两个对象：主城（`context.homeId(owner)`）
                // 与金矿（`mine.id`）—— 见 `ZCEconomySystem.tickIncome`。
                //
                // 金币没真的发出去（金额 <= 0 / 非法）就不抖：与 `grantGold` 内部那道闸同口径。
                if (Number.isFinite(amount) && amount > 0) this.presentation.pushBuildingShake(hexId);
            },
            constructionComplete: (hex) => {
                // 兵营建成出首批兵（数量 = 卡表 cycleBaseValue），产兵倒计时随后才从 0 起跑。
                //  与「开格即完工」那条路同一条推迟口径：建造期短于脉冲段的兵营，
                // 建成那一刻水波纹还没扩完 ⇒ 兵不能顶着波纹站上来。
                this.scheduleFirstBarracksUnit(hex.id);
            },
            unitCount: this.services.unitCount,
            spawnUnit: (owner, card, tier, hexId, portalHexId, barracksHexId) => {
                const unit = this.spawnUnit(owner, card, tier, hexId);
                if (unit && portalHexId !== undefined) {
                    unit.portalFlight = { fromHexId: portalHexId, barracksHexId, startedAt: this.state.elapsedSeconds };
                }
            },
            spawnHex: hex => this.neutralFeatures.spawnHex(this.state, hex),
            //  产兵四项修正（`pvpAttrMap` 的 recruitCd/recruitMaxNum/singleRecruitNum/
            //  singleRecruitLegionCount，2026-10-13）。建筑按卡的 `unitId` 找所属单位。
            recruitPatch: (owner, card) => (card.unitId
                ? this.unitStatPatches[owner]?.get(card.unitId) ?? {}
                : {}),
        };
    }

    private buildMovement(): ZCMovementSystem {
        return new ZCMovementSystem({
            map: this.config.map, rules: this.rules, geometry: this.geometry,
            effectiveDefinition: this.services.effectiveDefinition,
            bonuses: this.services.bonuses,
            goalHomeId: (owner, fromHexId) => this.goalHomeId(owner, fromHexId),
            frozenSeconds: () => this.state.enemyFrozenSeconds,
            hex: this.services.hex, hasExposedWall: this.services.hasExposedWall,
            moveUnitToHex: (unit, id) => this.moveUnitToHex(unit, id),
        });
    }

    private buildUnitTargeting(): ZCUnitTargeting {
        return new ZCUnitTargeting({
            map: this.config.map,
            geometry: this.geometry,
            units: this.units.byId,
            targeting: this.targetingContext,
            priorityMonster: unit => this.neutralFeatures.priorityTarget(this.state, unit),
            hasFocusableMonster: () => this.neutralFeatures.hasFocusableMonster(),
            combatDistanceScale: this.rules.combatDistanceScale,
            baseDefinition: (id) => this.unitDefinition(id),
            effectiveDefinition: this.services.effectiveDefinition,
            unitPosition: this.services.unitPosition,
            hex: this.services.hex,
            hasExposedWall: this.services.hasExposedWall,
        });
    }

    private buildUnitContext(): IZCUnitContext {
        return {
            now: () => this.state.elapsedSeconds,
            rules: this.rules,
            effectiveDefinition: this.services.effectiveDefinition,
            controlOf: (unit) => this.statusSystem.controlOf(String(unit.id)),
            //  软控（磁电菇「麻痹」`numb`）：只挡普攻 / 起冲，不冻移动 —— 与上面那行硬控分开。
            attackBlockedOf: (unit) => this.statusSystem.attackBlockedOf(String(unit.id)),
            random: this.services.random,
            unitById: this.units.byId,
            targeting: this.unitTargeting,
            movement: this.movement,
            sendAttack: (unit) => ZCAttackResolutionSystem.sendAttack(this.state, unit, this.attackResolutionContext),
        };
    }

    private buildSkillTriggerContext(): IZCSkillTriggerContext {
        return {
            statusSystem: this.statusSystem,
            //  键口径与 `ZCAttackResolutionSystem.sendAttack` 完全一致（`${unitId}:${普攻 profile.skillId}`），
            //  否则「配置里能查到、运行时查不到」会出现同一张卡在两条链路上行为不一致。
            runtimeOf: (unit) => (unit.neutralReinforcement ? this.neutralSkillRuntime : this.skillRuntime[unit.owner])
                .get(`${unit.unitId}:${this.effectiveUnitDefinition(unit).attackProfile.skillId}`),
            //  连发弹走 `sendBurstShot`，不进 `sendAttack`：后者会推进普攻节拍与强化 CD。
            fireBurst: (unit) => ZCAttackResolutionSystem.sendBurstShot(this.state, unit, this.attackResolutionContext),
            //  副轨主动（横扫）：走独立的扇形结算，不推进普攻节拍与强化 CD。
            castSecondary: (unit) => ZCAttackResolutionSystem.castFanSkill(this.state, unit, this.attackResolutionContext),
            // 自身光环：在本体脚下开启跟随本体的周期伤害区域，独立车道（unit.auraReadyAt）
            castSelfAura: (unit) => ZCAttackResolutionSystem.castSelfAura(this.state, unit, this.attackResolutionContext),
            // 五雷轰顶：沿目标背朝向排开落雷，独立车道（unit.boltReadyAt）
            castBolt: (unit) => ZCAttackResolutionSystem.castBoltLine(this.state, unit, this.attackResolutionContext),
            // 闪电链：从锁定目标起跳逐跳弹射，独立车道（unit.chainReadyAt）
            castChainLightning: (unit) => ZCAttackResolutionSystem.castChainLightning(
                this.state, unit, this.attackResolutionContext),
            // 随从召唤：随从生成与阵位在模型层直接操作 state.units 与注册表
            castSummon: (unit) => this.summonUnits(unit),
            // 怒吼：自心圆范围伤害、敌方减攻与友军护盾，独立车道（unit.roarReadyAt）
            castRoar: (unit) => ZCAttackResolutionSystem.castRoar(this.state, unit, this.attackResolutionContext),
            castStorm: (unit) => ZCAttackResolutionSystem.castStorm(this.state, unit, this.attackResolutionContext),
            castRayBeam: (unit, vulnStatusId) => ZCAttackResolutionSystem.castRayBeam(
                this.state, unit, this.attackResolutionContext, vulnStatusId),
            // 火焰区域：在目标点半径内生成地面伤害区域
            castFireZone: (unit) => ZCAttackResolutionSystem.castFireZone(
                this.state, unit, this.attackResolutionContext),
            // 精密陷阱：在本体脚下布置踩中/到点引爆陷阱，独立车道（unit.trapReadyAt）
            castTrap: (unit) => ZCAttackResolutionSystem.castTrap(this.state, unit, this.attackResolutionContext),
            // 爆点投掷物：朝锁定目标发射范围爆炸弹体，减速状态由触发系统统一传入
            castSplashShot: (unit, slowStatusId) => ZCAttackResolutionSystem.castSplashShot(
                this.state, unit, this.attackResolutionContext, slowStatusId),
            // 范围爆发/毒液喷吐：以自身为圆心爆发伤害并套盾或击退，独立车道（unit.burstReadyAt / unit.venomReadyAt）
            castBurstSkill: (unit, guardStatusId, lane) => ZCAttackResolutionSystem.castBurstSkill(
                this.state, unit, this.attackResolutionContext, guardStatusId, lane),
            // 扇形甩击：身前扇形判定并施加减速状态，独立车道（unit.fanReadyAt）
            castFanSweep: (unit, slowStatusId) => ZCAttackResolutionSystem.castFanSweep(
                this.state, unit, this.attackResolutionContext, slowStatusId),
            // 冲锋：沿位移线段判定碰撞并施加伤害与护盾
            castChargeDash: (unit, options) => ZCAttackResolutionSystem.castChargeDash(
                this.state, unit, this.attackResolutionContext, options),
            // 风暴弹：命中单体后生成滞留风暴区域，独立车道（unit.windReadyAt）
            castWindBolt: (unit) => ZCAttackResolutionSystem.castWindBolt(
                this.state, unit, this.attackResolutionContext),
            // 连射导弹：按 0/0.4/0.8s 节拍发射单枚弹体
            castBarrageShot: (unit) => ZCAttackResolutionSystem.castBarrageShot(
                this.state, unit, this.attackResolutionContext),
            // 冲锋定长位移边界保护：校验目标格子合法性，避免冲出地图边界
            hexIdAt: (x, y) => this.geometry.hexIdAt(x, y),
            // 技能朝向与攻击链路锁定目标保持一致
            currentTarget: (unit) => this.unitTargeting.current(unit),
            distanceScale: this.rules.combatDistanceScale,
            // 自身施法治疗：走与吸血同一条 healUnit 统一封顶并推飘字
            healUnit: (unit, amount) => ZCStatusResolutionSystem.healUnit(unit, amount, this.statusResolutionContext),
            // 多点打击：转发至攻击系统统一结算命中、溅射与处决
            strike: (unit, options) => ZCAttackResolutionSystem.strikeTargets(
                this.state, unit, options, this.attackResolutionContext),
            // 移形换影：位移统一转交 placeAt 维护连续坐标、朝向与地块索引一致
            blinkTo: (unit, x, y) => { this.movement.placeAt(unit, x, y); },
            unitPosition: (unit) => this.services.unitPosition(unit),
            // 触发范围闸门：普攻射程内有目标才实际施放，与普攻判定同源
            inAttackRange: (unit) => this.unitTargeting.hasTargetInAttackRange(unit),
            // 触发范围封顶：多点打击/移形换影搜索半径以普攻射程为上限
            attackReachOf: (unit) => this.unitTargeting.attackReachOf(unit),
            // 技能专属触发距离：按配置半径进一步收窄判定范围以对齐视觉特效
            nearestEnemyDistance: (unit) => this.unitTargeting.nearestEnemyDistance(unit),
            // 单位属性补丁：共享同一份 unitStatPatches 保证数值一致
            statPatchOf: (unit) => this.unitStatPatches[unit.owner]?.get(unit.unitId),
        };
    }

    private restoreOrCreateState(snapshot?: ZCSnapshot | null): void {
        this.territoryCountsReady = false;
        this.territoryCounts.clear();
        if (snapshot != null) {
            const restored = ZCSnapshotCodec.decode(snapshot, this.config);
            if (restored.ok === false) throw new Error(`无效对局快照：${restored.errors.join(', ')}`);
            this.state = restored.snapshot;
        } else {
            this.state = ZCSnapshotCodec.createInitialState(this.config, this.random);
            //  `openGrideTime` 约束的是「两次点击之间的最小间隔」，计时从第一次翻格之后开始（用户 2026-11-11）：
            //  新建快照时把 AI 时钟预置成一个完整间隔，第一次 `advance` 立刻给一拍（NPC 有钱且
            //  有相邻可翻格就当场动第一格），之后每 `aiDevelopIntervalSeconds` 秒一拍。
            //  若从 0 起算，这一列就变成了「开局干等 N 秒」的首刀延迟 —— 配 18 秒要等 18 秒才动，语义不符。
            //  从存档恢复时不清零：沿用快照里的 `aiClock`，否则读档会让 NPC 白得一次翻格机会。
            this.state.aiClock = this.aiDevelopIntervalSeconds;
        }
        if (this.pveDefence && this.state.nextDefenceWaveIndex !== undefined) {
            this.nextDefenceWaveIndex = this.state.nextDefenceWaveIndex;
        } else if (this.pveDefence && this.state.elapsedSeconds > 0) {
            this.nextDefenceWaveIndex = this.pveDefence.waves.findIndex((wave) => wave.showAtSeconds > this.state.elapsedSeconds + 1e-9);
            if (this.nextDefenceWaveIndex < 0) this.nextDefenceWaveIndex = this.pveDefence.waves.length;
        }
        this.registerDynamicSnapshotStatuses();
        this.statusSystem.restore(this.state.statusEffects);
        this.effectiveCache.clear();
        this.state.statusEffects = this.statusSystem.exportSnapshot();
        for (const unit of this.state.units) {
            this.units.register(unit);
            this.rememberUnitCard(unit);
        }
        this.neutralFeatures.initialize(this.state);
        this.refreshTileStates();
        this.checkOutcome();
    }


    // 快照创建、校验与对外查询。
    static createInitialState(random: () => number = Math.random, config?: ZCMatchConfig): ZCSnapshot {
        return ZCSnapshotCodec.createInitialState(captureZCMatchConfig(config), random);
    }

    static isValidSnapshot(value: unknown, config?: ZCMatchConfig): value is ZCSnapshot {
        if (!value || typeof value !== 'object') return false;
        try {
            return ZCSnapshotCodec.errors(value, captureZCMatchConfig(config)).length === 0;
        } catch {
            return false;
        }
    }

    exportSnapshot(): ZCSnapshot {
        this.state.statusEffects = this.statusSystem.exportSnapshot();
        const snapshot = ZCSnapshotCodec.clone(this.state);
        snapshot.combatEvents = [];
        return snapshot;
    }

    get snapshot(): DeepReadonly<ZCSnapshot> {
        return this.state;
    }

    /** 生成本帧供表现层读取的投影；规则派生值在模型边界一次性计算。*/
    createRenderFrame(): ZCGameRenderFrame {
        return {
            snapshot: this.state,
            mapConfig: this.config.map,
            terrainRevision: this.topologyRevision,
            simulationStepSeconds: ZC_SIMULATION_STEP_SECONDS,
            interpolationAlpha: this.state.status === 'playing'
                ? Math.max(0, Math.min(1, (this.state.pendingSeconds ?? 0) / ZC_SIMULATION_STEP_SECONDS))
                : 1,
            owners: this.activeOwners,
            // 胜方身份随帧下发：结算扫场要按胜方本色铺地。为 null（未定 / 平局）时
            // 视图按 status 兜底，见 `ZCGame.beginVictorySweep`。
            winner: this.matchWinner,
            hexesById: this.refreshHexRenderMap(),
            unitDefinitionsById: this.definitions,
            floatTexts: this.presentation.floatTexts,
            hitFxs: this.presentation.hitFxs,
            cardReveals: this.presentation.cardReveals,
            hexActivations: this.presentation.hexActivations,
            neutralRewards: this.presentation.neutralRewards,
        };
    }

    // 逻辑步和同步业务操作才改变这些派生值；不足一步的显示帧只更新插值余量。
    /**
     * 原地刷新地块投影。
     *
     * 规则派生值（canDevelop / cooldown / activation / connectedDevelopedHexIds）仍按每帧实际状态算，
     * 但 Map 与每格对象只建一次：否则 20 Hz 逻辑步会反复分配 200 个对象 + 一条 Map，
     * 投影对象本身是只读输出，调用方不会持有可变引用。
    */
    private refreshHexRenderMap(): ReadonlyMap<number, ZCGameRenderHex> {
        const hexesById = this.hexRenderMap ??= new Map<number, ZCMutableRenderHex>();
        const elapsed = this.state.elapsedSeconds;
        // 一个逻辑步（20 Hz）只算一次；60 Hz 显示帧里没有推进逻辑时直接复用上一拍。
        if (this.hexRenderElapsed === elapsed && this.topologyRevision === this.hexRenderTopologyRevision) {
            return hexesById;
        }
        this.hexRenderElapsed = elapsed;
        this.hexRenderTopologyRevision = this.topologyRevision;
        for (const state of this.state.hexes) {
            let entry = hexesById.get(state.id);
            if (!entry) {
                entry = {
                    state,
                    canDevelop: false,
                    cooldown: null,
                    activation: null,
                    connectedDevelopedHexIds: [],
                };
                hexesById.set(state.id, entry);
            }
            entry.state = state;
            entry.canDevelop = this.canPlayerDevelop(state.id);
            entry.cooldown = this.buildingCooldown(state.id);
            entry.activation = this.activationOf(state.id);
            entry.connectedDevelopedHexIds = this.connectedDevelopedHexIds(state.id);
        }
        return hexesById;
    }

    /** 一次性表现通知的唯一消费入口；由对局编排层取走后交给动态渲染。*/
    drainPresentationEvents(): ZCBattlePresentationEvents {
        return {
            buildingShakes: this.presentation.drainBuildingShakes(),
            buildingDestructions: this.presentation.drainBuildingDestructions(),
        };
    }

    get terrainRevision(): number { return this.topologyRevision; }
    get mapConfig(): ZCMatchMap { return this.config.map; }
    definitionForUnit(id: string): ZCUnitDefinition { return this.unitDefinition(id); }
    /**
     * 战斗音效取「攻击方职业 + 普攻/主动技能行」（`ZCBattleAudio` 的唯一数据源）。
     *
     * `activeSkillIds` 只装**主动**那两行（武将技 / 副轨）：被动触发的纯表现事件
     * （冲锋护盾 / 召唤 / 践踏）也带着自己的 `skillId` 走 `combatEvents`，
     * 不区分就会在没有施法时响技能音。
     */
    attackInfoForUnit(id: number): {
        readonly trait: ZCAttackTrait;
        readonly attackSkillId: number;
        readonly activeSkillIds: readonly number[];
    } | undefined {
        const unit = this.units.byId.get(id);
        if (!unit) return undefined;
        const trait = this.traitOfAttackerUnitId(id);
        if (!trait) return undefined;
        const profile = this.unitDefinition(unit.unitId).attackProfile;
        const activeSkillIds: number[] = [];
        if (Number.isFinite(profile.empoweredSkillId) && (profile.empoweredSkillId as number) > 0) {
            activeSkillIds.push(profile.empoweredSkillId as number);
        }
        if (Number.isFinite(profile.secondarySkillId) && (profile.secondarySkillId as number) > 0) {
            activeSkillIds.push(profile.secondarySkillId as number);
        }
        return { trait, attackSkillId: profile.skillId, activeSkillIds };
    }
    /** UI/调试读取本局最终属性；基础目录仍可用 definitionForUnit 查询。*/
    effectiveDefinitionForUnit(owner: ZCOwner, id: string): ZCUnitDefinition {
        return this.effectiveUnitDefinitionFor(owner, id);
    }

    private invalidateTerrain(): void {
        this.neutralFeatures.invalidateTerrain();
        this.clearHexRenderMap();
        this.topologyRevision++;
        this.connectedDevelopedCache.clear();
        this.unitTargeting.invalidateTerrain();
    }

    /** 投影表失效时同时忘掉刷新戳，避免同一逻辑步内的操作误命中空表。*/
    private clearHexRenderMap(): void {
        this.hexRenderMap = null;
        this.hexRenderElapsed = -1;
        this.hexRenderTopologyRevision = -1;
    }

    get artifactChargeFull(): number { return this.rules.artifactChargeFull; }
    get artifactMaxStored(): number { return this.rules.artifactMaxStored; }
    get artifactCooldownDuration(): number { return this.rules.artifactCooldownSeconds; }

    /**
     * 逐卡伤害明细（结算 MVP 选「赢家阵营输出最高的卡」用）。
     * 顺序 = 首次产生伤害的先后；调用方按自己需要再排序。
    */
    get damageCards(): readonly Readonly<IZCCardDamage>[] {
        return Array.from(this.cardDamage.values(), card => ({ ...card }));
    }

    /** 记一条卡身份；实例 id 与卡绑定后不再变。*/
    private rememberUnitCard(unit: ZCUnitState): void {
        if (!unit.unitId) return;
        this.unitCards.set(unit.id, { owner: unit.owner, unitId: unit.unitId, cardId: unit.cardId });
    }

    private cardDamageBucket(owner: ZCOwner, unitId: string, cardId: string): ZCCardDamageLedger {
        const key = `${owner}:${cardId}`;
        let bucket = this.cardDamage.get(key);
        if (!bucket) {
            bucket = { owner, unitId, cardId, damage: 0, damageTaken: 0 };
            this.cardDamage.set(key, bucket);
        }
        return bucket;
    }

    /** 攻击方是单位（有实例 id）时把伤害记到它所属的卡；塔 / 建筑 / 神器 / 中立怪不计。*/
    private creditCardDamage(unitId: number | undefined, amount: number): void {
        if (unitId === undefined || !(amount > 0)) return;
        const card = this.unitCards.get(unitId);
        if (!card || !this.activeOwners.includes(card.owner)) return;
        this.cardDamageBucket(card.owner, card.unitId, card.cardId).damage += amount;
    }

    /** 承受方是卡牌兵时把实际扣血记到该卡（多只兵合并）；中立怪不进 MVP 统计。*/
    private creditCardTaken(unit: ZCUnitState, amount: number): void {
        if (!unit.unitId || !(amount > 0) || !this.activeOwners.includes(unit.owner)) return;
        this.cardDamageBucket(unit.owner, unit.unitId, unit.cardId).damageTaken += amount;
    }

    /**
     * 双方累计伤害（造成 / 承受），供对局结算页 GameRunAway 读取。
     * 刻意不写进 ZCSnapshot：结算数据只在本局生命周期内有效，混进快照会牵动
     * `version` 和存档兼容，收益不成正比。
    */
    get damageStats(): Readonly<Record<ZCOwner, { readonly dealt: number; readonly taken: number }>> {
        return Object.fromEntries(this.activeOwners.map((owner) => [owner, {
            dealt: this.damageDealt[owner], taken: this.damageTaken[owner],
        }])) as Record<ZCOwner, { readonly dealt: number; readonly taken: number }>;
    }

    /** 当前存活的飘字（Old Client 战斗文本 / 金币增长），视图每帧只读消费。*/
    get floatTexts(): readonly Readonly<ZCFloatText>[] { return this.presentation.floatTexts; }

    /** 当前存活的受击特效（按攻击方职业选 prefab），视图每帧只读消费。*/
    get hitFxs(): readonly Readonly<ZCHitFx>[] { return this.presentation.hitFxs; }

    private pushFloatText(input: Omit<IZCFloatTextOptions, 'now'>): ZCFloatText | null {
        return this.presentation.pushFloatText({ now: this.state.elapsedSeconds, ...input });
    }

    get cardReveals(): readonly Readonly<ZCCardReveal>[] { return this.presentation.cardReveals; }
    get hexActivations(): readonly Readonly<ZCHexActivation>[] { return this.presentation.hexActivations; }
    activationOf(hexId: number): Readonly<ZCHexActivation> | null { return this.presentation.activationOf(hexId); }

    /**
     * 本局实际参赛的席位（人数 = `length`，2~4）。
     *
     * 视图层要按人数分格摆位（传说卡出场横幅竖向均分屏高，见
     * `ZCGameLegendBannerView.layoutYOf` 与 `bannerHeightOf`），
     * 而 `activeOwners` 本身是私有的 —— 这里只开一个只读出口，不外泄可写引用。
    */
    get owners(): readonly ZCOwner[] {
        return this.activeOwners;
    }

    private pushCardReveal(input: Omit<IZCCardRevealOptions, 'now' | 'x' | 'y'>): void {
        const center = this.hexCenter(input.hexId);
        this.presentation.pushCardReveal({ now: this.state.elapsedSeconds, x: center.x, y: center.y, ...input });
    }

    private pushHexActivation(hexId: number, hasCardReveal: boolean, cardRarity: number): void {
        this.presentation.pushHexActivation(this.state.elapsedSeconds, hexId, hasCardReveal, cardRarity);
    }

    /**
     * 给某一方加金币（含飘字）。`kind` 决定表现：`'goldincome'` 建筑产出（升起 50px + 数字），
     * `'gold'` 击杀/拆建筑掉落（原地缩小消失，无数字）。
     * 缺省取 `'gold'`，避免掉落调用点漏传参数变成产金表现。
    */
    private grantGold(
        owner: ZCOwner, amount: number, x: number, y: number, floatSeconds: number,
        kind: 'gold' | 'goldincome' = 'gold',
    ): void {
        if (!Number.isFinite(amount) || amount <= 0) return;
        this.setGold(owner, this.goldOf(owner) + amount);
        this.pushFloatText({ kind, owner, value: amount, x, y, durationSeconds: floatSeconds });
    }

    private hexCenter(hexId: number): { x: number; y: number } {
        const config = this.config.map.hexes[hexId];
        const hex = this.state.hexes[hexId];
        return hex.neutralFeature?.patrol ? zcMonsterPosition(this.config.map, hex, this.state.elapsedSeconds) : config;
    }

    /** null 表示无时限；塔防只由清空全部波次或我方主城失守结束。*/
    get remainingSeconds(): number | null {
        if (this.pveDefence) return null;
        return Math.max(0, this.state.durationSeconds - this.state.elapsedSeconds);
    }

    /** 塔防 HUD 的当前波次、下波倒计时与剩余敌人数；普通对局返回 null。*/
    get defenceWaveProgress(): Readonly<ZCDefenceWaveProgress> | null {
        if (!this.pveDefence) return null;
        const current = this.nextDefenceWaveIndex > 0
            ? this.pveDefence.waves[this.nextDefenceWaveIndex - 1]
            : null;
        const next = this.pveDefence.waves[this.nextDefenceWaveIndex] ?? null;
        const currentUnitId = current ? this.cardById(ZCOwner.Enemy, current.cardId)?.unitId : undefined;
        const waveHpRate = currentUnitId ? this.config.unitRates?.enemy?.[currentUnitId]?.hpRate : undefined;
        // 本波血条：分母取账本里生成那一刻记下的总血量（不随死亡变小），分子现算存活单位的血。
        const ledger = current ? this.defenceWaveLedger[this.nextDefenceWaveIndex - 1] : undefined;
        let currentWaveHp = 0;
        for (const id of ledger?.ids ?? []) {
            const unit = this.units.byId.get(id);
            if (unit && unit.battleState !== 'dead') currentWaveHp += Math.max(0, unit.hp);
        }
        return {
            totalWaves: this.pveDefence.waves.length,
            spawnedWaves: this.nextDefenceWaveIndex,
            currentWaveId: current?.waveId ?? null,
            nextWaveId: next?.waveId ?? null,
            secondsUntilNextWave: next
                ? Math.max(0, next.showAtSeconds - this.state.elapsedSeconds)
                : null,
            aliveEnemies: this.state.units.reduce((count, unit) => (
                unit.owner !== ZCOwner.Player && unit.battleState !== 'dead' ? count + 1 : count
            ), 0),
            currentWaveHp,
            currentWaveMaxHp: ledger?.maxHp ?? 0,
            currentWaveHpRate: current ? waveHpRate ?? this.config.ownerRates?.enemy?.hpRate ?? 1 : 1,
            currentWaveCardId: current?.cardId ?? null,
            currentWaveIsBoss: current ? this.isBossWave(this.nextDefenceWaveIndex - 1) : false,
        };
    }

    /**
     * 第 `index` 波（0 基）是不是 BOSS 波。
     *
     * 先认表里的 `isBoss`（`monsterType=3`），表里没填时按「每组最后一波」兜底 ——
     * 与 `projectDefenceWaves` 同一口径，保证 HUD、胜负判定、配置投影说的是同一件事。
    */
    private isBossWave(index: number): boolean {
        return index === this.defenceBossWaveIndex();
    }

    /** BOSS 波序号；表里有标 `isBoss` 就认它，没有就按「最后一波」。无塔防 ⇒ -1。*/
    private defenceBossWaveIndex(): number {
        const waves = this.pveDefence?.waves;
        if (!waves?.length) return -1;
        for (let index = waves.length - 1; index >= 0; index -= 1) {
            if (waves[index].isBoss) return index;
        }
        return waves.length - 1;
    }

    /**
     * BOSS 波进度：`spawned` = 末波已经出场过，`alive` = 末波还有活着的单位。
     *
     * 胜负判定只认它（「只有击败 BOSS 才算胜利」）：中间波次清空不再算赢。
     * 单位在死亡动画结束后会被摘掉，查不到按已死计。
    */
    private defenceBossState(): { spawned: boolean; alive: boolean } {
        const defence = this.pveDefence;
        const index = this.defenceBossWaveIndex();
        if (!defence || index < 0 || this.nextDefenceWaveIndex <= index) return { spawned: false, alive: false };
        // 逐只出怪（`ZC_DEFENCE_SPAWN_INTERVAL_SECONDS`）：末波还有怪排着队没出生时，
        // 已经被打死的先头几只不能算「BOSS 已被击败」，否则会当场误判胜利。
        if (this.defenceSpawnQueue.some((ticket) => ticket.waveIndex === index)) {
            return { spawned: true, alive: true };
        }
        const bossCardId = defence.waves[index].cardId;
        const ids = this.defenceWaveLedger[index]?.ids ?? [];
        const alive = ids.length
            ? ids.some((id) => {
                const unit = this.units.byId.get(id);
                return !!unit && unit.battleState !== 'dead';
            })
            //  账本只活在内存里，快照恢复后是空的：这时按「场上还有没有 BOSS 波那张卡的怪」兜底，
            // 不能因为账本没了就把 BOSS 判成已死（否则读档即胜利）。残留的小怪若与 BOSS 同卡，
            // 会把胜利拖到清完为止 —— 宁可晚赢，也不能没打 BOSS 就赢。
            : this.state.units.some((unit) => unit.owner !== ZCOwner.Player
                && unit.cardId === bossCardId
                && unit.battleState !== 'dead');
        return { spawned: true, alive };
    }

    get playerTerritoryCount(): number {
        return this.territoryCount(ZCOwner.Player);
    }

    /**
     * 某席位当前占了几格，排行榜按席位逐个取数用；与 `enemyTerritoryCount` 不同，不合并。
    */
    territoryCountOf(owner: ZCOwner): number {
        return this.territoryCount(owner);
    }

    get enemyTerritoryCount(): number {
        return this.activeOwners.slice(1).reduce((total, owner) => total + this.territoryCount(owner), 0);
    }

    get playerDevelopedCount(): number {
        return this.developedCount(ZCOwner.Player);
    }

    get enemyDevelopedCount(): number {
        return this.activeOwners.slice(1).reduce((total, owner) => total + this.developedCount(owner), 0);
    }

    get playerIncomePerSecond(): number {
        return this.rules.hqIncomeAmount / this.rules.hqIncomeIntervalSeconds
            + this.bonusesFor(ZCOwner.Player).incomeBonus
            + this.mineIncome(ZCOwner.Player);
    }

    get playerBonds(): readonly string[] {
        return this.bonusesFor(ZCOwner.Player).activeBonds;
    }

    get unitCap(): number {
        return this.rules.unitCapPerSide;
    }

    /** 建筑建造/工作周期的圆形进度条数据。*/
    buildingCooldown(hexId: number): ZCBuildingCooldownState | null {
        const hex = this.hex(hexId);
        if (!hex || hex.building === 'none') return null;
        const card = hex.building !== 'hq' && hex.cardId && hex.owner !== 'neutral'
            ? this.cardById(hex.owner, hex.cardId)
            : undefined;
        const cycleSeconds = hex.building === 'hq'
            ? this.rules.hqIncomeIntervalSeconds
            : card ? (hex.building === 'barracks'
                ? ZCEconomySystem.recruitIntervalSeconds(hex, card, this.economyContext)
                : this.buildingCycleSeconds(hex, card)) : 0;
        return ZCEconomySystem.buildingCooldown(this.state, hex, card, cycleSeconds);
    }

    get playerScore(): ZCScoreBreakdown {
        return ZCOutcomeSystem.scoreFor(this.state, ZCOwner.Player, this.homeId(ZCOwner.Player));
    }

    /** 从指定已开发格出发，返回同阵营六方向相邻的完整连通块；抽空格也算已开发。*/
    connectedDevelopedHexIds(hexId: number): readonly number[] {
        const cached = this.connectedDevelopedCache.get(hexId);
        if (cached) return cached;
        const start = this.hex(hexId);
        if (!start || (!start.developmentResolved && start.building === 'none')) {
            this.connectedDevelopedCache.set(hexId, EMPTY_CONNECTED_DEVELOPED_HEXES);
            return EMPTY_CONNECTED_DEVELOPED_HEXES;
        }
        const connected = new Set<number>([hexId]);
        const queue = [hexId];
        for (let head = 0; head < queue.length; head += 1) {
            const currentId = queue[head];
            for (const neighborId of this.config.map.hexes[currentId].neighbors) {
                if (connected.has(neighborId)) continue;
                const neighbor = this.hex(neighborId);
                if (neighbor.owner !== start.owner
                    || (!neighbor.developmentResolved && neighbor.building === 'none')) continue;
                connected.add(neighborId);
                queue.push(neighborId);
            }
        }
        // 用 `Array.from` 而非 `[...connected]`：release 构建会把展开降级成
        // `[].concat(set)`，而 concat 不展开迭代器，整套领土连通性会静默算错。
        const result = Array.from(connected);
        for (const id of result) this.connectedDevelopedCache.set(id, result);
        return result;
    }

    canPlayerDevelop(hexId: number): boolean {
        return this.canDevelopFor(ZCOwner.Player, hexId);
    }

    /**
     * 某一方能否开发这一格 —— 玩家点击（`ZCGame.onHexClick`）与敌方 AI 共用这一处判据。
     *
     * 己方格是老口径；中立格也能开发，且开发即宣告归属（`developFor` 里落 owner）：
     * 只要它与本方的已开发锚点相邻。等于给「派兵走过去占领」补了一条「花钱买地」的路。
    */
    canDevelopFor(owner: ZCOwner, hexId: number): boolean {
        return ZCTileSystem.canDevelopFor(this.state, this.config.map, hexId, owner);
    }

    addDebugGold(amount: number): ZCActionResult {
        if (this.state.status !== 'playing') return this.fail('本局已经结束。');
        const gold = this.goldOf(ZCOwner.Player) + amount;
        if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(gold)) {
            return this.fail('金币数量必须为正整数，且增加后不能超出安全整数范围。');
        }
        this.setGold(ZCOwner.Player, gold);
        return this.success(`已给自己增加 ${amount} 对局金币`);
    }

    /** GM 覆盖本局后续我方抽卡；不改卡组、金币费用或 AI 抽卡。*/
    setDebugDrawCard(cardId: string, count: number): ZCActionResult {
        if (this.state.status !== 'playing') return this.fail('本局已经结束。');
        if (!Number.isSafeInteger(count) || count <= 0) return this.fail('翻格次数必须为正整数。');
        const card = this.cards[ZCOwner.Player].get(cardId) ?? findCatalogCard(cardId);
        if (!card || !cardTypeToBuilding(card.type)) return this.fail(`战斗卡不存在或不能翻格生成：${cardId}`);
        if (card.unitId && !this.definitions.has(card.unitId)) return this.fail(`本局未加载该卡的单位配置：${cardId}`);
        this.debugCards.set(cardId, card);
        this.debugDraw = { card, remaining: count };
        return this.success(`后续 ${count} 次我方翻格必出【${card.name}】（${cardId}）`);
    }

    developHex(hexId: number): ZCDevelopResult {
        if (this.state.status !== 'playing') return this.fail('本局已经结束。');
        const hex = this.hex(hexId);
        if (!hex) return this.fail('地块不存在。');
        if (!this.canPlayerDevelop(hexId)) return this.fail('该地块当前不可开发。');
        // 这一条带结构化原因：棋盘上给不出「钱不够」的可见反馈（那格的图标与价格照旧），
        // 只能由 HUD 的金币栏表达 ⇒ 表现层要看 `reason` 而不是这段中文。
        if (this.goldOf(ZCOwner.Player) < hex.developmentCost) {
            return this.fail(`金币不足，需要 ${hex.developmentCost}。`, 'insufficientGold');
        }
        this.clearHexRenderMap();
        this.setGold(ZCOwner.Player, this.goldOf(ZCOwner.Player) - hex.developmentCost);
        this.chargeArtifactFromDevelopment();
        return this.developFor(ZCOwner.Player, hex);
    }

    useArtifact(): ZCActionResult {
        if (this.state.status !== 'playing') return this.fail('本局已经结束。');
        const activation = ZCArtifactSystem.activate(this.state, this.rules);
        if (activation.ok === false) {
            return this.fail(activation.reason === 'cooldown' ? '神器正在冷却。' : '神器尚未充满。');
        }
        this.clearHexRenderMap();
        for (const unit of this.state.units) {
            if (unit.owner !== ZCOwner.Player && unit.battleState !== 'dead') this.damageUnit(unit, this.rules.artifactDamage, { owner: ZCOwner.Player, kind: 'artifact' });
        }
        this.removeDeadUnits();
        // 释放技能：神器是全局技，没有落点 ⇒ `params` 不传（协议注明「如无不用传」）。
        this.pushFrameEvent(ZCOwner.Player, FRAME_OP_SKILL, []);
        return this.success(`神器【${this.rules.artifactName}】发动：敌军受创并冻结 ${this.rules.artifactFreezeSeconds} 秒！`);
    }

    // 时间推进：建筑、经济、单位与胜负结算都从这里进入。
    tick(deltaSeconds: number): void {
        if (this.state.status !== 'playing' || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
        this.state.pendingSeconds = (this.state.pendingSeconds ?? 0) + Math.min(deltaSeconds, ZC_MAX_TICK_SECONDS);
        while (this.state.pendingSeconds + 1e-9 >= ZC_SIMULATION_STEP_SECONDS && this.state.status === 'playing') {
            this.state.pendingSeconds = Math.max(0, this.state.pendingSeconds - ZC_SIMULATION_STEP_SECONDS);
            this.advance(ZC_SIMULATION_STEP_SECONDS);
        }
        // Remove sub-nanosecond floating-point residue so equivalent frame partitions serialize equally.
        if (this.state.pendingSeconds < 1e-9) this.state.pendingSeconds = 0;
    }

    reset(): void {
        this.debugDraw = null;
        this.debugCards.clear();
        this.matchWinner = null;
        this.territoryCountsReady = false;
        this.territoryCounts.clear();
        this.state = ZCSnapshotCodec.createInitialState(this.config, this.random);
        // 同 `restoreOrCreateState`：新开一局，AI 时钟预置成一个完整间隔，首格不被 openGrideTime 拖后。
        this.state.aiClock = this.aiDevelopIntervalSeconds;
        this.neutralFeatures.initialize(this.state);
        this.statusSystem.restore(this.state.statusEffects);
        this.effectiveCache.clear();
        this.state.statusEffects = this.statusSystem.exportSnapshot();
        this.tileStatesDirty = true;
        this.units.clear();
        this.projectileSystem.reset();
        this.captureSystem.reset();
        this.invalidateTerrain();
        this.presentation.reset();
        this.deferredBarracksSpawns.length = 0;
        //  排队中的召唤物属于「上一场」的状态，重开一局必须清掉，否则下一局一开场
        //  会有几只分裂菇凭空冒出来（`pendingSummons` 在快照里，`state` 已经被换成新的了）。
        if (this.state.pendingSummons) this.state.pendingSummons.length = 0;
        this.frameEvents.length = 0;
        this.nextDefenceWaveIndex = 0;
        for (const owner of ZC_OWNER_ORDER) {
            this.damageDealt[owner] = 0;
            this.damageTaken[owner] = 0;
        }
        this.cardDamage.clear();
        this.unitCards.clear();
        this.refreshTileStates();
        this.checkOutcome();
    }

    private advance(dt: number): void {
        this.captureSystem.beginStep(this.state.units);
        this.neutralFeatures.beginStep(this.state);
        this.state.elapsedSeconds = Math.round((this.state.elapsedSeconds + dt) * 1e9) / 1e9;
        this.flushDeferredBarracksSpawns();
        //  排队中的召唤物（2026-11-20 第 33 批 101404 分裂菇）：「先特效、后出现」的两个时刻
        //  到点了就地兑现。排在 `updateUnits` 之前 —— 这一帧生出来的分身当帧就能索敌 / 出手，
        //  与「施法那一拍召出」的旧口径只差「特效先播了 0.32s」。
        this.flushPendingSummons();
        this.spawnDueDefenceWaves();
        // 原地压缩过期战斗事件：不能每步 filter 出一条新数组（20 Hz 稳定垃圾）。
        const combatEvents = this.state.combatEvents;
        let write = 0;
        for (let read = 0; read < combatEvents.length; read += 1) {
            const event = combatEvents[read];
            if (this.state.elapsedSeconds < event.startedAt + event.durationSeconds) {
                if (write !== read) combatEvents[write] = event;
                write += 1;
            }
        }
        combatEvents.length = write;
        this.presentation.prune(this.state.elapsedSeconds);
        ZCArtifactSystem.tick(this.state, dt);
        this.statusResolutionSystem.tick(this.state, dt, this.statusResolutionContext);
        this.updateConstruction(dt);
        this.updateEconomy(dt);
        this.updateBarracks(dt);
        this.updateTowers(dt);
        ZCGroundZoneSystem.tick(this.state, dt, this.groundZoneContext);
        if (this.state.projectiles.length) this.projectileSystem.beginStep(this.state.units);
        this.updateUnits(dt);
        this.neutralFeatures.tick(this.state);
        //  技能时机（常驻被动 / 盾到期 / 连发 / 低血护体）：排在出手之后、弹道推进之前 ——
        //  连发弹当帧就能开始飞，不会凭空多等一步。三类时机在缺省参数下整段不执行，
        //  未配置这些技能的单位行为逐字不变。
        ZCSkillTriggerSystem.tick(this.state, dt, this.skillTriggerContext);
        this.projectileSystem.update(this.state.projectiles, dt, this.projectileContext);
        this.captureSystem.update(this.state, dt, (hex, owner) => this.captureEmptyTile(hex, owner),
            this.neutralFeatures.monsterTerritory);
        this.refreshTileStates();
        // 首领关默认由配置的波次出怪、跳过通用敌方翻格；但只要本关配了 NPC 卡组
        // （`npcDeckFromTeam` = `npcTeam.npcCard` 投影），防守方仍要按卡组翻地块发育 ——
        // 否则 NPC 整局站着不动，配表里的卡组一张都用不上（用户 2026-11-23）。
        if (!this.pveDefence || this.config.npcDeckFromTeam) {
            this.state.aiClock = Math.round((this.state.aiClock + dt) * 1e9) / 1e9;
            if (this.state.aiClock >= this.aiDevelopIntervalSeconds) {
                this.state.aiClock -= this.aiDevelopIntervalSeconds;
                this.runEnemyAI();
            }
        }
        //  跟随类特效（闪电链 102203）：单位这一帧已经走完了，此时把两端的坐标重算一遍，
        //  渲染读到的就是「弧粘在人身上」的当下位置。排在 AI 之后、`checkOutcome` 之前 ——
        //  与渲染同帧，且不会因为单位阵亡引发的移除而算到半路。
        this.syncFollowingCombatEvents();
        this.checkOutcome();
    }

    /**
     * 把「带跟随锚」的战斗事件按两端单位的**当前**坐标重新摆一遍
     * （闪电链 102203，2026-11-19 第 21 批）。
     *
     * 用户原话：「释放端的卡牌静止不动，敌人移动，技能尾端会跟随旋转或伸缩」。
     * `combatEvents` 是快照，坐标写一次就定死 ⇒ 想让弧跟着人走，只有两条路：
     * 每帧新建事件（`nextCombatEventId` 会爆、也没法淡出），或者让事件自己长着眼睛 ——
     * 这里走后者：模型每帧按 `followFromUnitId` / `followToUnitId` 重写坐标。
     *
     * 🔴 三个必须守住的细节：
     *  1. **段数用建链时的那一个**（`followPieceCount`），不按新距离重算 ——
     *     目标站远了，`ceil(距离/单段)` 会变大，可多出来的段**没有人创建**，
     *     结果是链条中间凭空缺口；固定段数则只会把每段拉长，正是「伸缩」。
     *  2. **一端没了就整条跳过**（阵亡被摘掉的单位查不到）⇒ 冻在最后一次的位置上。
     *     只动一端会把方向算歪，比不动更难看。
     *  3. **不动 `startedAt` / `durationSeconds`**，也不新建事件 ⇒ 生命周期仍然只由
     *     `advance()` 开头那一段裁剪决定。
     */
    private syncFollowingCombatEvents(): void {
        const events = this.state.combatEvents;
        if (!events.length) return;
        for (const event of events) {
            const fromId = event.followFromUnitId;
            const toId = event.followToUnitId;
            if (fromId == null && toId == null) continue;
            const fromUnit = fromId == null ? null : this.units.byId.get(fromId);
            const toUnit = toId == null ? null : this.units.byId.get(toId);
            if (!fromUnit || !toUnit) continue;
            const from = this.unitPosition(fromUnit);
            const to = this.unitPosition(toUnit);
            //  兜底角 = 上一帧的角度（去掉 -90° 的偏移量），两点重合时沿用上一帧的朝向，
            //  免得「擦身而过」的那一帧把弧甩成 0°（朝右）。
            const fallbackRadians = ((event.angleDegrees ?? ZC_CHAIN_SEGMENT_ANGLE_OFFSET_DEGREES)
                - ZC_CHAIN_SEGMENT_ANGLE_OFFSET_DEGREES) * Math.PI / 180;
            const layout = zcChainArcPieceLayout(
                from.x, from.y, to.x, to.y, fallbackRadians, event.followPieceCount ?? 1);
            const piece = Math.max(0, Math.round(event.followPieceIndex ?? 0));
            //  与 `ZCAttackResolutionSystem.pushChainArc` 同款：节点沿长轴后退透明留白，
            //  两处漏一处 ⇒ 只有首次施放贴合、跟随过程中又裂开。
            const x = from.x + layout.stepX * piece + layout.offsetX;
            const y = from.y + layout.stepY * piece + layout.offsetY;
            event.fromX = x;
            event.fromY = y;
            event.toX = x;
            event.toY = y;
            event.angleDegrees = layout.angleDegrees;
            event.stretchAlongAxis = layout.stretch;
        }
    }

    private updateConstruction(dt: number): void {
        ZCEconomySystem.tickConstruction(this.state, dt, this.economyContext);
    }

    private updateEconomy(dt: number): void {
        ZCEconomySystem.tickIncome(this.state, dt, this.economyContext);
    }

    private isBuildingOperational(hex: ZCHexState): boolean {
        return ZCEconomySystem.isBuildingOperational(hex);
    }

    private cycleKey(hex: Pick<ZCHexState, 'id' | 'building'>): string {
        return ZCEconomySystem.cycleKey(hex);
    }

    private buildingCycleSeconds(hex: ZCHexState, card: ZCDeckCard): number {
        const bonuses = this.bonusesFor(hex.owner as ZCOwner);
        return ZCEconomySystem.buildingCycleSeconds(hex, card, bonuses, this.rules, (id) => this.unitDefinition(id));
    }

    private updateBarracks(dt: number): void {
        ZCEconomySystem.tickBarracks(this.state, dt, this.economyContext);
    }

    private updateTowers(dt: number): void {
        for (const tower of this.state.hexes) {
            if (tower.building !== 'tower' || tower.owner === 'neutral' || !this.isBuildingOperational(tower)) continue;
            const towerCard = tower.cardId ? this.cardById(tower.owner, tower.cardId) : undefined;
            if (!towerCard) continue;
            const interval = this.buildingCycleSeconds(tower, towerCard);
            const key = this.cycleKey(tower);
            this.state.spawnClocks[key] = Math.min(interval, (this.state.spawnClocks[key] || 0) + dt);
            if (this.state.spawnClocks[key] < interval) continue;
            // 塔每次开火只取最近的一个目标：不要 filter + sort 两条中间数组，
            // 直接扫描范围桶并保留最小距离（同距离按 id 稳定）。
            let target: ZCUnitState | null = null;
            let targetDistance = Number.POSITIVE_INFINITY;
            const candidates = this.unitsInRadius(tower.id, this.rules.towerRangeHex);
            for (const unit of candidates) {
                if (unit.battleState === 'dead' || unit.owner === tower.owner) continue;
                const distance = this.geometry.distance(tower.id, unit.sourceHexId);
                if (distance < targetDistance || (distance === targetDistance && target && unit.id < target.id)) {
                    target = unit;
                    targetDistance = distance;
                }
            }
            if (!target) continue;
            const targetCard = this.cardById(target.owner, target.cardId);
            this.state.spawnClocks[key] -= interval;
            const bonuses = this.bonusesFor(tower.owner);
            //  只取 `cycleBaseValue`：`cyclePerTierValue` 语义已收窄为「每品级建筑耐久」，
            // 不能再当伤害的品级系数用（PVP 目前没有防御塔卡，这段是保留的旧路径）。
            const baseDamage = towerCard.cycleBaseValue ?? 18;
            const damage = baseDamage * bonuses.towerAttackMultiplier
                * cardCounterMultiplier(towerCard, targetCard, this.config.counters) * this.rules.combatDamageMultiplier;
            this.damageUnit(target, Math.round(damage), { owner: tower.owner, kind: 'building' });
        }
    }

    // 战斗循环与索敌、命中处理。
    private updateUnits(dt: number): void {
        //  召唤物先归位 / 到期收场，再跑状态机：状态机看到的是「这一帧该站的位置」，
        //  否则跟随的那一帧会先在旧坐标上索敌、再瞬移过去。
        this.syncSummons();
        ZCUnitSystem.update(this.state.units, dt, this.unitContext);
        this.removeDeadUnits();
        this.refreshTileStates();
        this.syncBodyScale();
    }

    /**
     * 把「构筑期 patch + 状态 mods」的 `bodySizePct` 折成 `unit.bodyScale`（2026-11-18 第 17 批）。
     *
     * 为什么要有这一步：`statPatch` 是按 `(owner, unitId)` 索引的构筑期表、状态 mods 是另一套
     * 缓存，两者都不在快照里，而 `ZCUnitView` 只拿得到 `ZCUnitState`。所以要有一个每帧落盘点，
     * 与 `gateScale`（中立资源门直接写状态字段）走同一侧。
     *
     * 🔴 只写视图字段，**不动 `bodyRadius`** —— 体型 ×2 不该顺手变成「命中判定也 ×2」，
     * 那会让「变大」变成纯亏。缺省 1 时不写字段（保持快照干净）。
     */
    private syncBodyScale(): void {
        for (const unit of this.state.units) {
            const buildPct = this.unitStatPatches[unit.owner]?.get(unit.unitId)?.bodySizePct ?? 0;
            const statusPct = this.statusSystem.statModsOf(String(unit.id)).bodySizePct ?? 0;
            const total = buildPct + statusPct;
            const scale = total === 0 ? 1 : Math.max(0.1, 1 + total / 100);
            //  逐值比较后才写：每帧无条件赋值会让快照哈希每帧都变（回放比对全红）。
            const next = scale === 1 ? undefined : scale;
            if (unit.bodyScale !== next) unit.bodyScale = next;
        }
    }

    /** 旧战斗测试从此入口直接触发出手；测试迁到独立攻击夹具后可删除。*/
    private sendAttack(unit: ZCUnitState): void {
        ZCAttackResolutionSystem.sendAttack(this.state, unit, this.attackResolutionContext);
    }

    /**
     * 弹道这一轮的结构候选（墙体/建筑），写进 `out`。
     * 两路来源：锁定格（打墙/打楼/追踪导弹的既有口径）+ 飞行段经过的每一格。
     * 目标所在格不算障碍，否则站在城墙里的单位破墙前完全免疫远程；真正要拦的是中途的格。
     * 谁先被碰到交给 `ZCProjectileSystem` 用扫掠 t 比较，本方法只列候选。
    */
    private projectileStructureTargets(
        projectile: Readonly<ZCProjectileState>,
        fromX: number, fromY: number, toX: number, toY: number,
        out: ZCCombatTarget[],
    ): void {
        out.length = 0;
        const seen = this.structureHexScratch;
        seen.clear();
        //  1. 锁定格（子弹原本要打的那一格）—— 与改前逐字一致。
        if (projectile.targetKind !== 'unit') {
            const locked = this.structureTargetOfHex(projectile.targetId, projectile.owner);
            if (locked) { out.push(locked); seen.add(locked.id); }
        }
        // 巡逻怪以出生格标识，但可能走到飞行段经过的其他格。
        for (const hexId of this.neutralFeatures.patrolOrigins) {
            if (seen.has(hexId) || !isZCAwakeMonster(this.state.hexes[hexId])) continue;
            const target = this.structureTargetOfHex(hexId, projectile.owner);
            if (target) { out.push(target); seen.add(hexId); }
        }
        //  目标单位的落脚格：跳过（见上面「目标所在的格不算障碍」）。
        let targetHexId = -1;
        if (projectile.targetKind === 'unit') {
            const target = this.units.byId.get(projectile.targetId);
            if (target) targetHexId = this.geometry.hexIdAt(target.freeX, target.freeY) ?? -1;
        }
        //  2. 飞行段扫过的格。段很短（一帧只飞十几个逻辑 px），采样点通常 1~3 个。
        const dx = toX - fromX;
        const dy = toY - fromY;
        const samples = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy) / STRUCTURE_SAMPLE_STEP));
        for (let index = 0; index <= samples; index += 1) {
            const t = index / samples;
            const hexId = this.geometry.hexIdAt(fromX + dx * t, fromY + dy * t);
            if (hexId === null || hexId === targetHexId || seen.has(hexId)) continue;
            seen.add(hexId);
            const target = this.structureTargetOfHex(hexId, projectile.owner);
            if (target) out.push(target);
        }
    }

    /** 单格 → 结构目标；`null` = 这格对这颗子弹没有可打的结构（己方 / 中立 / 无墙无楼）。*/
    private structureTargetOfHex(hexId: number, owner: ZCOwner): ZCCombatTarget | null {
        const hex = this.hex(hexId);
        if (!hex) return null;
        const center = this.hexCenter(hex.id);
        //  中立怪（觉醒怪）谁都能打，且排在归属判定之前 —— 与改前一致。
        if (isZCAwakeMonster(hex)) return { kind: 'building', id: hex.id, x: center.x, y: center.y, bodyRadius: STRUCTURE_TARGET_BODY_RADIUS, cardId: null };
        if (hex.owner === 'neutral' || hex.owner === owner) return null;
        if (this.hasExposedWall(hex)) return { kind: 'wall', id: hex.id, x: center.x, y: center.y, bodyRadius: STRUCTURE_TARGET_BODY_RADIUS, cardId: null };
        if (hex.building !== 'none' && hex.hp > 0 && hex.wallHp <= 0) return { kind: 'building', id: hex.id, x: center.x, y: center.y, bodyRadius: STRUCTURE_TARGET_BODY_RADIUS, cardId: hex.cardId };
        return null;
    }

    private resolveProjectileHit(projectile: ZCProjectileState, target: ZCCombatTarget): void {
        ZCAttackResolutionSystem.resolveProjectileHit(this.state, projectile, target, this.attackResolutionContext);
    }

    /**
     * 到点引爆（2026-11-18 第 16 批「连射导弹」101304）：`explodeOnArrival` 的弹体飞完那一刻，
     * 在落点对半径内所有敌人各结算一次。命中那条通道（`resolveProjectileHit`）不会被走到 ——
     * 这类弹体整段不参与碰撞。
     */
    private resolveProjectileArrival(projectile: ZCProjectileState): void {
        ZCAttackResolutionSystem.resolveProjectileArrival(this.state, projectile, this.attackResolutionContext);
    }

    private ensureMoveSpeedStatus(id: string, moveSpeedPct: number, durationSeconds: number): void {
        ZCAttackResolutionSystem.ensureMoveSpeedStatus(this.attackResolutionContext, id, moveSpeedPct, durationSeconds);
    }

    private ensureBannerStatus(rawRate: number): string {
        return ZCAttackResolutionSystem.ensureBannerStatus(this.attackResolutionContext, rawRate);
    }

    private registerDynamicSnapshotStatuses(): void {
        for (const row of this.state.statusEffects?.units ?? []) {
            for (const instance of row.instances) {
                const slow = /^__slow:([0-9.]+)__$/.exec(instance.defId);
                if (slow) {
                    const ratio = Number(slow[1]);
                    if (Number.isFinite(ratio)) this.ensureMoveSpeedStatus(instance.defId, -ratio * 100, 1);
                    continue;
                }
                const haste = /^__haste:([0-9.]+)__$/.exec(instance.defId);
                if (haste) {
                    const ratio = Number(haste[1]);
                    if (Number.isFinite(ratio)) this.ensureMoveSpeedStatus(instance.defId, ratio * 100, 5);
                    continue;
                }
                const banner = /^__banner:([0-9.]+)__$/.exec(instance.defId);
                if (banner) {
                    const rate = Number(banner[1]);
                    if (Number.isFinite(rate)) this.ensureBannerStatus(rate);
                }
            }
        }
    }

    private evaluateLegacySkill(source: ZCUnitState, effectKeys: readonly string[], target: ZCCombatTarget,
        isCritical: boolean): ZCLegacySkillEvaluation {
        return ZCLegacyCombatSystem.evaluateSkill(source, effectKeys, target, isCritical, this.legacyCombatContext);
    }

    private applyHitStatus(target: ZCUnitState, statusId: string | undefined, sourceUnitId?: number): void {
        ZCLegacyCombatSystem.applyHitStatus(this.state, target, statusId, sourceUnitId, this.legacyCombatContext);
    }

    private applyLegacyBuffs(target: ZCUnitState, buffs: readonly ZCLegacyBuffApplication[], sourceUnitId?: number): void {
        ZCLegacyCombatSystem.applyBuffs(this.state, target, buffs, sourceUnitId, this.legacyCombatContext);
    }

    private applyLegacySelfBuffs(source: ZCUnitState, buffs: readonly ZCLegacyBuffApplication[]): readonly ZCLegacyBuffApplication[] {
        return ZCLegacyCombatSystem.applySelfBuffs(this.state, source, buffs, this.legacyCombatContext);
    }

    /** Old repel moves away from the sender by the configured world-space distance.*/
    private applyLegacyKnockback(target: ZCUnitState, source: ZCUnitState, rawDistance: number): void {
        const amount = Math.abs(rawDistance) * this.rules.combatDistanceScale;
        if (!(amount > 0)) return;
        const from = this.unitPosition(source);
        const current = this.unitPosition(target);
        let dx = current.x - from.x, dy = current.y - from.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length <= 1e-9) {
            dx = Math.cos(source.facingRadians);
            dy = Math.sin(source.facingRadians);
        } else {
            dx /= length;
            dy /= length;
        }
        this.displaceUnit(target, dx * amount, dy * amount);
    }

    /** Forced movement stays on playable cells and invalidates the old path target.*/
    private displaceUnit(unit: ZCUnitState, dx: number, dy: number): void {
        if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return;
        const current = this.unitPosition(unit);
        let factor = 1;
        let nextHexId: number | null = null;
        let nx = current.x, ny = current.y;
        for (let attempt = 0; attempt < 8; attempt += 1) {
            nx = current.x + dx * factor;
            ny = current.y + dy * factor;
            nextHexId = this.geometry.hexIdAt(nx, ny);
            if (nextHexId !== null) break;
            factor *= .5;
        }
        if (nextHexId === null) return;
        unit.freeX = nx;
        unit.freeY = ny;
        unit.targetHexId = null;
        unit.progress = 0;
        unit.marchAngle = null;
        this.moveUnitToHex(unit, nextHexId);
    }

    private tryExecuteUnit(
        target: ZCUnitState,
        chance: number | undefined,
        owner: ZCOwner,
        sourceUnitId: number,
        precedingHitText: ZCFloatText | null = null,
    ): void {
        if (target.battleState === 'dead' || !chance || chance <= 0) return;
        if (this.random() >= Math.min(1, chance)) return;
        // Old Client marks the whole hit as Seckill. Remove the numeric hit queued just before
        // this roll and merge its actual damage into one execute battle text.
        let displayedBeforeExecute = 0;
        if (precedingHitText) {
            displayedBeforeExecute = this.presentation.removeFloatText(precedingHitText.id);
        }
        this.damageUnit(target, target.hp, {
            owner,
            kind: 'unit',
            unitId: sourceUnitId,
            floatTextKind: 'execute',
            floatTextValueOffset: displayedBeforeExecute,
        });
    }

    /**
     * 席位上是不是「真人玩家」。关卡 PVE / 塔防的非本机席位是 NPC 队伍，不算玩家；
     * PVP 匹配 `npcOwners` 为空 ⇒ 每个席位都是玩家。`neutral`（野怪 / 中立）永远不是玩家。
    */
    private isPlayerSeat(owner: ZCFaction): boolean {
        if (owner === 'neutral') return false;
        return !this.npcOwners.includes(owner);
    }

    /**
     * 扣血飘字的显示口径（2026-11-20 用户，同日二改）。
     *
     * · `none` —— 两个非玩家（NPC / 野怪）互打：只留血条变化，不出数字；
     * · `playerLoss` —— **本机席位**的卡牌被扣血：红字 + 负号（`-5`）。
     *   **不分攻方是玩家还是 NPC** —— 「我方被打」只有这一种样式；
     * · `normal` —— 其余全部白字（我方打出的伤害、克制增伤、别人家的卡被打）。
     *
     * 🔴 两条边界别写歪：
     * ① 红色只看 `defender === player`（本机），不是「任意玩家的卡」—— 否则我打别人也变红字，
     *    和「我方造成的伤害用白色」直接打架；
     * ② 攻方是不是玩家**不再参与**这一判定。2026-11-20 用户口径：「我方被 NPC 打和被另一个玩家打
     *    是一个样式，红字、无前缀、只有 -血量」。原先只认「受到其他玩家的攻击」，结果同一件
     *    「我方掉血」在塔防里是白字、在 PVP 里是红字，两套样式。
     */
    private floatTextToneOf(attacker: ZCFaction, defender: ZCFaction): 'normal' | 'playerLoss' | 'none' {
        const attackerIsPlayer = this.isPlayerSeat(attacker);
        const defenderIsPlayer = this.isPlayerSeat(defender);
        if (!attackerIsPlayer && !defenderIsPlayer) return 'none';
        return defender === ZCOwner.Player && attacker !== defender ? 'playerLoss' : 'normal';
    }

    private damageUnit(target: ZCUnitState, damage: number, source: ZCDamageSource): ZCFloatText | null {
        const result = ZCDamageResolutionSystem.damageUnit(
            this.state, target, damage, source, this.damageResolutionContext);
        if (!result) return null;
        if (result.applied > 0) {
            //  逐卡归属：攻击方必须是单位（塔 / 神器没有卡身份），承受方按目标兵的卡记。
            if (source.kind === 'unit') this.creditCardDamage(source.unitId, result.applied);
            this.creditCardTaken(target, result.applied);
        }
        const position = this.unitPosition(target);
        const tone = this.floatTextToneOf(source.owner, target.owner);
        // 前缀（暴击 / 克制 / 抵抗 / 秒杀）只标「我方打出去的战果」：
        // 攻方是玩家席位、且不是「我方被扣血」那一档才带。NPC 打我方卡走 `normal`，
        // 但攻方不是玩家 ⇒ 不带前缀；我方被另一个玩家扣血 ⇒ 也不带，只要负号 + 血量。
        const dealtByPlayer = tone === 'normal' && this.isPlayerSeat(source.owner);
        const floatText = tone === 'none' ? null : this.pushFloatText({
            kind: source.floatTextKind ?? 'damage',
            owner: source.owner === 'neutral' ? target.owner : source.owner,
            ...(tone === 'playerLoss' ? { takenFromPlayer: true as const } : {}),
            ...(dealtByPlayer ? { dealtByPlayer: true as const } : {}),
            // 飘字显示「完整命中伤害」= 减伤 / 吃盾之后、夹血量上限之前（`damageBeforeHpCap`）；
            // 统计、吸血、击杀归属走实际扣血（`appliedDamage`）。击杀那一下若按实际扣血显示，
            // 玩家看到的是「打了 60、只跳 20」（`tests/zcds-state-consistency.test.ts` 钉的就是这条）。
            value: result.damageBeforeHpCap + (source.floatTextValueOffset ?? 0),
            appliedDamage: result.applied + (source.floatTextValueOffset ?? 0),
            x: position.x,
            y: position.y,
            durationSeconds: this.rules.floatTextDamageSeconds ?? FLOAT_TEXT_DAMAGE_SECONDS,
        });
        if (ZCDC_LOG_DAMAGE_FLOAT) {
            console.info('[伤害飘字][飘字]', {
                sourceKind: source.kind, sourceId: source.unitId, projectileId: source.projectileId,
                targetKind: 'unit', targetId: target.id, targetUnitId: target.unitId, incomingDamage: damage,
                applied: result.applied, executeOffset: source.floatTextValueOffset ?? 0,
                floatTextId: floatText?.id, kind: floatText?.kind, value: floatText?.value ?? null,
            });
        }
        this.pushHitFx(target, result.applied, source, position);
        if (result.killed && source.owner !== 'neutral') {
            this.grantGold(source.owner, this.rules.killUnitGoldReward,
                position.x, position.y, FLOAT_TEXT_GOLD_SECONDS);
        }
        return floatText;
    }

    /**
     * 按攻击方职业推一条受击特效。三道门任一不满足就跳过：applied > 0、能查到职业、
     * 渲染层有对应 prefab（资源判定留给渲染层，模型不感知）。
     * 坐标取打完这一下之后的 position，与飘字同源同帧。
    */
    private pushHitFx(
        target: ZCUnitState,
        applied: number,
        source: ZCDamageSource,
        position: { x: number; y: number },
    ): void {
        if (applied <= 0) return;
        const trait = source.attackerTrait ?? this.traitOfAttacker(source);
        if (!trait) return;
        this.presentation.pushHitFx({
            now: this.state.elapsedSeconds,
            trait,
            owner: target.owner,
            surface: 'unit',
            // 受击特效跟着被打的那只的体型走（2026-10-31）。取不到定义就按 1（= 烘焙原样），
            // 绝不因为查不到而把闪白缩成 0。
            targetScale: this.definitions.get(target.unitId)?.prefabSize ?? 1,
            x: position.x,
            y: position.y,
            durationSeconds: this.rules.hitFxSeconds ?? HIT_FX_SECONDS,
        });
    }

    /**
     * 攻击方职业 = 其卡牌 `traits.attack`。
     * 注意两级 id：`source.unitId` 是实例 id，`ZCUnitState.unitId` 才是卡牌 id；
     * 正确链路是实例 id → units.byId → cardId → 卡表 → traits.attack。
     * 取不到返回 undefined，由调用方决定不播。
    */
    private traitOfAttacker(source: ZCDamageSource): ZCAttackTrait | undefined {
        return this.traitOfAttackerUnitId(source.unitId);
    }

    /**
     * 攻击方实例 id → 职业。
     *
     * 单独拆一层的原因：单位受击走的是 `ZCDamageSource`（只有 `unitId`），
     * 而城墙 / 建筑的伤害入口 `context.damageWall/damageBuilding` 拿到的是出手单位的本体
     * （`ZCUnitState`，`id` 才是实例 id）。两处共用同一段查表，别各写一份。
    */
    private traitOfAttackerUnitId(unitId: number | undefined): ZCAttackTrait | undefined {
        if (unitId === undefined) return undefined;
        const attacker = this.units.byId.get(unitId);
        // 实例可能已被 `removeDeadUnits` 摘掉（死亡后仍会被打到溅射）⇒ 这时不播。
        if (!attacker) return undefined;
        for (const owner of this.activeOwners) {
            const card = this.cards[owner].get(attacker.cardId);
            const trait = card?.traits?.attack;
            if (trait) return trait;
        }
        return undefined;
    }

    /**
     * 建筑/城墙的受击特效：按攻击方职业选特效，applied <= 0 不播。
     * 与打单位那条同判据，区别是攻击方直接是 `ZCUnitState`（走 traitOfAttackerUnitId）、
     * 锚点取该格格心（视图再按 surface 补高度）、targetScale 固定 1。
    */
    private pushStructureHitFx(
        attackerUnitId: number | undefined,
        defender: ZCFaction,
        applied: number,
        position: { x: number; y: number },
        surface: ZCHitFxSurface,
    ): void {
        if (applied <= 0) return;
        const trait = this.traitOfAttackerUnitId(attackerUnitId);
        if (!trait) return;
        this.presentation.pushHitFx({
            now: this.state.elapsedSeconds,
            trait,
            owner: defender,
            surface,
            targetScale: 1,
            x: position.x,
            y: position.y,
            durationSeconds: this.rules.hitFxSeconds ?? HIT_FX_SECONDS,
        });
    }

    private unitPosition(unit: ZCUnitState, result?: { x: number; y: number }): { x: number; y: number } {
        return this.movement.position(unit, result);
    }

    private captureEmptyTile(hex: ZCHexState, owner: ZCOwner): void {
        // 普通对局中建筑归零即出局；残兵不能让出局席位再次取得地块。
        if (!this.pveDefence && this.developedCount(owner) === 0) return;
        const result = ZCDevelopmentSystem.captureEmptyTile(hex, owner);
        if (!result.changed) return;
        this.territoryCountsReady = false;
        this.tileStatesDirty = true;
        if (result.terrainChanged) this.invalidateTerrain();
    }

    private hasExposedWall(hex: ZCHexState): boolean {
        this.refreshTargetHexes();
        return this.exposedWalls.has(hex.id);
    }

    private refreshTargetHexes(): void {
        if (this.targetHexRevision === this.topologyRevision) return;
        this.targetHexRevision = this.topologyRevision;
        this.targetHexes.length = 0;
        for (const bucket of this.candidateHexesByOwner.values()) bucket.length = 0;
        this.exposedWalls.clear();
        for (const hex of this.state.hexes) {
            if (isZCAwakeMonster(hex)) {
                this.targetHexes.push(hex);
                for (const bucket of this.candidateHexesByOwner.values()) bucket.push(hex);
                continue;
            }
            const exposed = ZCTileSystem.hasExposedWall(this.state, this.config.map, hex);
            if (exposed) this.exposedWalls.add(hex.id);
            if (!exposed && (hex.owner === 'neutral' || hex.building === 'none' || hex.hp <= 0 || hex.wallHp > 0)) continue;
            this.targetHexes.push(hex);
            if (hex.owner === 'neutral') continue;
            for (const [owner, bucket] of this.candidateHexesByOwner) {
                if (owner !== hex.owner) bucket.push(hex);
            }
        }
    }

    private broadcastStructureGuardAggro(attacker: IZCStructureDamageSource, defenderOwner: ZCOwner | 'neutral', hexId: number): void {
        if (!attacker || attacker.id === undefined || defenderOwner === 'neutral' || attacker.owner === defenderOwner) return;
        const attackerUnit = this.units.byId.get(attacker.id);
        if (!attackerUnit || attackerUnit.battleState === 'dead' || attackerUnit.hp <= 0) return;
        const center = this.hexCenter(hexId);
        if (!center || typeof center.x !== 'number' || typeof center.y !== 'number') return;
        const GUARD_RADIUS_SQ = 150 * 150; // 约 1.5 格守家求援半径
        for (const unit of this.state.units) {
            if (unit.owner !== defenderOwner || unit.battleState === 'dead' || unit.hp <= 0) continue;
            // 若当前正在与目标贴身肉搏交战（普攻前摇或等待），不打断既有决斗
            const inCombat = (unit.battleState === 'attack' || unit.battleState === 'waitAttack')
                && this.unitTargeting.isInAttackRange(unit);
            if (inCombat) continue;
            const distSq = (unit.freeX - center.x) ** 2 + (unit.freeY - center.y) ** 2;
            if (distSq > GUARD_RADIUS_SQ) continue;
            // 写入守家求援仇恨
            unit.hatredUnitId = attacker.id;
            unit.hatredUntil = this.state.elapsedSeconds + (this.rules.hatredSeconds ?? HATRED_SECONDS);
            // 若当前目标不是该攻击者，打破锁定重新索敌
            if (unit.targetUnitId !== attacker.id) {
                this.unitTargeting.acquire(unit);
                if (this.unitTargeting.current(unit)) {
                    ZCCombatSystem.switchState(unit, this.unitTargeting.isInAttackRange(unit) ? 'idle' : 'move');
                }
            }
        }
    }

    private damageWall(unit: IZCStructureDamageSource, wall: ZCHexState, damage: number, isExposed = this.hasExposedWall(wall)): void {
        const center = this.hexCenter(wall.id);
        const result = ZCDamageResolutionSystem.damageWall(
            wall, damage, unit, isExposed, center, this.damageResolutionContext);
        if (!result) return;
        this.broadcastStructureGuardAggro(unit, wall.owner, wall.id);
        this.creditCardDamage(unit.id, result.applied);
        // 同 `damageBuilding`：飘字按完整命中伤害，扣血/统计按实际值。
        const floatText = this.pushFloatText({ kind: 'damage', owner: unit.owner, value: result.damageBeforeHpCap,
            appliedDamage: result.applied,
            x: center.x, y: center.y, durationSeconds: this.rules.floatTextDamageSeconds ?? FLOAT_TEXT_DAMAGE_SECONDS });
        if (ZCDC_LOG_DAMAGE_FLOAT) {
            console.info('[伤害飘字][飘字]', {
                sourceId: unit.id, targetKind: 'wall', targetId: wall.id, incomingDamage: damage, applied: result.applied,
                floatTextId: floatText?.id, kind: floatText?.kind, value: floatText?.value ?? null,
            });
        }
        //  城墙受击特效：与飘字同一坐标（格心），职业取攻击方（2026-11-06 需求）。
        this.pushStructureHitFx(unit.id, wall.owner, result.applied, center, 'wall');
        if (result.killed) this.invalidateTerrain();
    }

    toggleMonsterFocus(hexId: number, owner: ZCOwner = ZCOwner.Player): boolean {
        const hex = this.state.hexes[hexId];
        if (this.state.status !== 'playing' || !this.activeOwners.includes(owner) || !hex) return false;
        const changed = this.neutralFeatures.toggleFocus(this.state, hex, owner);
        if (changed) for (const unit of this.state.units) {
            if (unit.owner === owner && this.unitTargeting.refreshPriorityTarget(unit)) {
                ZCCombatSystem.switchState(unit, 'target');
            }
        }
        return changed;
    }

    private damageBuilding(unit: IZCStructureDamageSource, building: ZCHexState, damage: number): void {
        if (isZCAwakeMonster(building)) {
            if (!Number.isFinite(damage) || damage <= 0) return;
            const feature = building.neutralFeature;
            if (unit.id !== undefined && this.units.byId.has(unit.id)) {
                feature.retaliationUnitIds ??= [];
                if (!feature.retaliationUnitIds.includes(unit.id)) feature.retaliationUnitIds.push(unit.id);
            }
            delete feature.disengagedAt;
            feature.regenUpdatedAt = this.state.elapsedSeconds;
            const applied = Math.min(damage, building.hp);
            building.hp = Math.max(0, building.hp - damage);
            this.creditCardDamage(unit.id, applied);
            if (building.hp === 0) {
                const center = this.hexCenter(building.id);
                const item = neutralResourceItemOf(building.neutralResourceId);
                const card = findCatalogCard(item.feature.resId);
                const definition = this.unitDefinition(card.unitId);
                feature.claimed = true;
                building.neutralResourceId = null;
                feature.focusOwners = [];
                feature.retaliationUnitIds = [];
                feature.targetUnitId = null;
                delete feature.monsterFacing;
                delete feature.attackStartedAt;
                delete feature.attackTargetUnitId;
                delete feature.disengagedAt;
                delete feature.regenUpdatedAt;
                const reinforcement = this.spawnUnit(unit.owner, card, 1, building.id, true);
                if (reinforcement) {
                    reinforcement.neutralReinforcement = true;
                    reinforcement.inheritedStats = { attack: definition.attack * item.feature.reviveRate,
                        maxHp: definition.maxHp * item.feature.reviveRate, moveSpeed: definition.moveSpeed,
                        attackInterval: definition.attackInterval, attackRange: definition.attackRange, bodyRadius: definition.bodyRadius };
                    reinforcement.hp = reinforcement.maxHp = definition.maxHp * item.feature.reviveRate;
                    reinforcement.nextAttackAt = this.state.elapsedSeconds + definition.attackInterval;
                    reinforcement.freeX = center.x;
                    reinforcement.freeY = center.y;
                }
                this.pushCardReveal({ owner: unit.owner, hexId: building.id, cardId: card.id,
                    building: 'barracks', tier: 4, cardName: card.name, unitId: card.unitId,
                    luckText: '', monsterClaim: true });
                this.grantGold(unit.owner, this.rules.killUnitGoldReward, center.x, center.y, FLOAT_TEXT_GOLD_SECONDS);
                this.tileStatesDirty = true;
                this.invalidateTerrain();
            }
            return;
        }
        if (building.building === 'none' || building.hp <= 0) return;
        const summonsDefenceBoss = this.pveDefence && building.owner === ZCOwner.Enemy
            && building.id === this.homeId(ZCOwner.Enemy) && building.building === 'hq';
        const defender = building.owner;
        const result = ZCDamageResolutionSystem.damageBuilding(
            this.state, building, damage, unit, this.damageResolutionContext);
        if (!result) return;
        this.broadcastStructureGuardAggro(unit, defender, building.id);
        const center = this.hexCenter(building.id);
        this.creditCardDamage(unit.id, result.applied);
        // 飘字显示「完整命中伤害」（`damageBeforeHpCap`），统计与吸血走实际扣血（`applied`）——
        // 击杀那一下如果按实际扣血显示，玩家会看到「打了 60、只跳 20」。
        const floatText = this.pushFloatText({ kind: 'damage', owner: unit.owner, value: result.damageBeforeHpCap,
            appliedDamage: result.applied,
            x: center.x, y: center.y, durationSeconds: this.rules.floatTextDamageSeconds ?? FLOAT_TEXT_DAMAGE_SECONDS });
        if (ZCDC_LOG_DAMAGE_FLOAT) {
            console.info('[伤害飘字][飘字]', {
                sourceId: unit.id, targetKind: 'building', targetId: building.id, incomingDamage: damage, applied: result.applied,
                floatTextId: floatText?.id, kind: floatText?.kind, value: floatText?.value ?? null,
            });
        }
        //  建筑受击特效：锚点仍是格心，视图按 `surface = 'building'` 抬到建筑图中心
        //  （`ZCGameHex.prefab` 的 `BuildingIcon` 在 +15.65px）—— 2026-11-06 需求。
        //  `defender` 必须在伤害结算之前抓（拆掉那一拍 `building.owner` 已被改成攻方）。
        this.pushStructureHitFx(unit.id, defender, result.applied, center, 'building');
        if (!result.killed) return;
        if (summonsDefenceBoss) this.spawnDueDefenceWaves(true);
        if (!this.pveDefence && this.developedCount(unit.owner) === 0) building.owner = 'neutral';
        if (!this.pveDefence && defender !== 'neutral' && this.developedCount(defender) === 0) {
            // 最后一座建筑消失后，未被攻方占领的空地解除归属；废墟保留废墟状态。
            for (const hex of this.state.hexes) {
                if (hex.owner === defender) {
                    hex.owner = 'neutral';
                    this.territoryCountsReady = false;
                    hex.developmentResolved = false;
                }
                if (hex.captureOwner === defender) {
                    hex.captureOwner = null;
                    hex.captureSeconds = 0;
                }
            }
        }
        this.tileStatesDirty = true;
        this.invalidateTerrain();
        // 建筑已转废墟 —— 快照里从这一帧起只剩 `state === 'ruins'`，「刚被拆掉」这件事
        // 只有这里知道。发一条通知让渲染层补白烟雾爆炸（坐标由渲染层按格心算）。
        this.presentation.pushBuildingDestruction(building.id);
        this.grantGold(unit.owner, this.rules.destroyBuildingGoldReward,
            center.x, center.y, FLOAT_TEXT_GOLD_SECONDS);
        this.refreshTileStates();
    }

    private runEnemyAI(): void {
        for (const owner of this.activeOwners.slice(1)) {
            if (this.developedCount(owner) === 0) continue;
            const targetHome = this.goalHomeId(owner, this.homeId(owner));
            const choices = this.state.hexes
                // 每个 AI 都独立吃中立格、独立花自己的金币。
                .filter((hex) => this.canDevelopFor(owner, hex.id))
                .filter((hex) => hex.developmentCost <= this.goldOf(owner))
                .sort((a, b) => a.developmentCost - b.developmentCost
                    || this.geometry.distance(a.id, targetHome) - this.geometry.distance(b.id, targetHome));
            if (!choices.length) continue;
            const affordableTop = choices.slice(0, Math.min(4, choices.length));
            const choice = affordableTop[Math.floor(this.random() * affordableTop.length)];
            this.setGold(owner, this.goldOf(owner) - choice.developmentCost);
            this.developFor(owner, choice);
        }
    }

    /** 选点结束、正式模型建立后记录各方最终出生格；重复通知不重复入队。*/
    recordSpawnSelection(): void {
        for (const owner of this.activeOwners) {
            if (this.frameEvents.some((event) => event.op === FRAME_OP_SPAWN && event.owner === owner)) continue;
            this.pushFrameEvent(owner, FRAME_OP_SPAWN, [this.homeId(owner)]);
        }
    }

    /**
     * 记一条战斗帧事件（随 `CmdFinishBattleReqMsg.commands` 上报）。
     * `op`：1=翻格、2=释放技能、4=出生点，`params` 带格子 id 或技能位置。
     * `frameId` 沿用毫秒时间戳口径；保留操作方 owner，结算时映射到战斗单元 id。
    */
    private pushFrameEvent(owner: ZCOwner, op: number, params: number[]): void {
        this.frameEvents.push({ frameId: Math.round(this.state.elapsedSeconds * 1000), owner, op, params });
    }

    /**
     * 玩家点地块开垦（`ZCGame.onHexClick`）；返回值在通用结果上多带一格 `cardRarity`，
     * 让表现层能按品阶挑音效（抽空 / 蓝绿 / 紫 / 金）—— 见 {@link ZCDevelopResult}。
     */
    private developFor(owner: ZCOwner, hex: ZCHexState): ZCDevelopResult {
        this.pushFrameEvent(owner, FRAME_OP_DEVELOP, [hex.id]);
        const forced = owner === ZCOwner.Player ? this.debugDraw : null;
        const result = ZCDevelopmentSystem.develop(
            this.state, owner, hex, this.deckFor(owner), this.config, this.random, this.developmentContext, forced?.card ?? null);
        // 开发/领地的归属和邻接资源领取都会改 owner，缓存交给 refreshTileStates 统一失效。
        this.territoryCountsReady = false;
        if (forced && result.card === forced.card && result.building) {
            forced.remaining -= 1;
            if (forced.remaining === 0) this.debugDraw = null;
        }
        this.tileStatesDirty = true;
        this.invalidateTerrain();
        // 收场表现属于「开发这件事本身」，与抽到什么无关：
        // 全类型随机格（问号，25 费）的 `empty` 权重是 0.7 ⇒ 七成是空手。
        // 把 `pushHexActivation` 留在 `!result.card` / `!result.building` 两个 return
        // 之后，这些格子点下去既不收场也不出卡，观感就是「点了没反应」。
        // 口径：`develop` 一旦置真 `developmentResolved`（这次开发真的落地了）就必须播。
        // `hasCardReveal` 决定收场段之后怎么接 —— 没有卡牌时视图把「整格隐藏」换成原地缩回来
        // （隐藏段是给卡牌独占视线的，没卡牌就会露出棋盘底）。
        // 脉冲染色跟着「抽到的卡」走（2026-10-19）：没抽到卡时传 0（视图按绿处理）。
        //  抽到卡但建不上（`!result.building`）时仍有品阶 —— 用户要的是「对应获得的卡牌品阶」，
        // 与 `hasCardReveal`（有没有卡牌揭示）不是同一个判据。
        this.pushHexActivation(hex.id, result.building !== null, result.card ? rarityRank(result.card.rarity) : 0);
        if (!result.card) {
            this.refreshTileStates();
            return this.success();
        }
        const card = result.card;
        if (!result.building) {
            this.refreshTileStates();
            // 抽到了卡但落不了地（该格建不上）：仍算「抽到这张」，音效按品阶走。
            return { ok: true, cardRarity: card.rarity };
        }
        const building = result.building;
        const tier = result.tier;
        const randomTile = result.tileType === ZCPvpTileType.AllRandom;
        this.pushCardReveal({
            owner,
            hexId: hex.id,
            cardId: card.id,
            building,
            tier,
            cardName: card.name,
            unitId: card.unitId ?? null,
            luckText: randomTile ? luckTextOfTier(tier) : '',
            randomTile,
        });
        this.refreshTileStates();
        // 首批兵推到「翻面段」播完再出（见 `deferredBarracksSpawns`）。
        if (hex.constructionRemainingSeconds <= 0) this.scheduleFirstBarracksUnit(hex.id);
        return { ok: true, message: `抽到${rarityDisplayName(card.rarity)}卡【${card.name}】`, cardRarity: card.rarity };
    }

    private spawnFirstBarracksUnit(hex: ZCHexState): void {
        ZCEconomySystem.spawnFirstBarracksUnit(hex, this.economyContext);
    }

    /**
     * 开格后的兵营首批兵：推迟到点击动画播完再生成，锚 `ZC_CARD_START_SECONDS`。
     * 卡牌与地块能靠 `startedAt` 先不可见，单位是实体，只能推迟生成。
     * 开格即完工推迟整段；建造中建成只推迟剩余那一小段；算出 0 就立即出兵。
    */
    private scheduleFirstBarracksUnit(hexId: number): void {
        const remaining = this.remainingHexPresentationSeconds(hexId);
        if (remaining <= 0) {
            this.spawnFirstBarracksUnit(this.state.hexes[hexId]);
            return;
        }
        this.deferredBarracksSpawns.push({
            atSeconds: this.state.elapsedSeconds + remaining,
            hexId,
        });
    }

    /** 本格激活的点击动画（脉冲 ∥ 缩没）还剩多少秒（不在激活期 / 已播完 ⇒ 0）。*/
    private remainingHexPresentationSeconds(hexId: number): number {
        const activation = this.activationOf(hexId);
        if (!activation) return 0;
        return Math.max(0, activation.startedAt + ZC_CARD_START_SECONDS - this.state.elapsedSeconds);
    }

    /**
     * 到点生成延迟的兵营首批兵。
     *
     * 生成前不额外校验：`ZCEconomySystem.spawnFirstBarracksUnit` 已自查
     * （还是兵营 / 非中立 / 卡还配着兵 / 建筑在运行），中途被拆了自然跳过。
     * 队列通常为空，空则直接返回、不分配。
    */
    private flushDeferredBarracksSpawns(): void {
        if (!this.deferredBarracksSpawns.length) return;
        const now = this.state.elapsedSeconds;
        const pending: Array<{ atSeconds: number; hexId: number }> = [];
        for (const spawn of this.deferredBarracksSpawns) {
            if (now + 1e-9 < spawn.atSeconds) pending.push(spawn);
            else this.spawnFirstBarracksUnit(this.state.hexes[spawn.hexId]);
        }
        this.deferredBarracksSpawns.length = 0;
        for (const spawn of pending) this.deferredBarracksSpawns.push(spawn);
    }

    /** 生成一个单位；拆城触发的末波 Boss 可越过兵力上限，避免跳波后 Boss 被吞掉。*/
    private spawnUnit(
        owner: ZCOwner,
        card: ZCDeckCard,
        tier: number,
        hexId: number,
        ignoreUnitCap = false,
        lineUpAlongGoal = false,
        lineUpIndex = 0,
        lineUpCount = 1,
    ): ZCUnitState | null {
        if (!card.unitId || (!ignoreUnitCap && this.unitCount(owner) >= this.rules.unitCapPerSide)) return null;
        const definition = this.effectiveUnitDefinitionFor(owner, card.unitId);
        const spawnCenter = this.hexCenter(hexId);
        // 落点：离兵营中心约半个格距 —— 新兵不会和兵营图标叠在一起。
        // 塔防出怪（`lineUpAlongGoal`）两列错位队列行进：整波怪在「主城 → 目标主城」主轴两侧
        // 呈左右交替错位（±9px 并附带 ±1.5px 微小抖动），避免单点重叠造成残影，同时保持两列队列前行。
        // 🔴 随机值照抽不误（下面的 `random()`），否则随机流一变，抽卡 / 技能全都不是同一个种子了。
        const spawnAngle = this.random() * Math.PI * 2;
        const facing = this.facingTowardGoal(owner, hexId);
        let spawnX: number;
        let spawnY: number;
        if (lineUpAlongGoal) {
            const forwardX = Math.cos(facing);
            const forwardY = Math.sin(facing);
            const lateralX = -forwardY;
            const lateralY = forwardX;
            let lateral = 0;
            if (lineUpCount > 1) {
                // 两列错位：偶数只在左侧（-1），奇数只在右侧（+1），基础偏移 9px，附带微小抖动
                const side = lineUpIndex % 2 === 0 ? -1 : 1;
                const jitter = Math.sin(spawnAngle) * 1.5;
                lateral = side * 9 + jitter;
            }
            spawnX = spawnCenter.x + forwardX * SPAWN_OFFSET_RADIUS + lateralX * lateral;
            spawnY = spawnCenter.y + forwardY * SPAWN_OFFSET_RADIUS + lateralY * lateral;
        } else {
            spawnX = spawnCenter.x + Math.cos(spawnAngle) * SPAWN_OFFSET_RADIUS;
            spawnY = spawnCenter.y + Math.sin(spawnAngle) * SPAWN_OFFSET_RADIUS;
        }
        const bonuses = this.bonusesFor(owner);
        const tierMultiplier = 1 + (tier - 1) * this.rules.unitHpPerTier;
        const maxHp = Math.max(1, Math.round(definition.maxHp * bonuses.unitHpMultiplier * tierMultiplier));
        // nextUnitId 理论上严格递增；若异常重复则自动顺延，避免整局崩在 register 上。
        while (this.units.byId.has(this.state.nextUnitId)) this.state.nextUnitId += 1;
        const unit: ZCUnitState = {
            id: this.state.nextUnitId,
            owner,
            unitId: card.unitId,
            cardId: card.id,
            tier,
            sourceHexId: hexId,
            targetHexId: null,
            progress: 0,
            hp: maxHp,
            maxHp,
            attackMultiplier: 1,
            shield: 0,
            battleState: 'born',
            stateTime: 0,
            targetUnitId: null,
            targetWallHexId: null,
            targetBuildingHexId: null,
            nextAttackAt: this.state.elapsedSeconds + definition.attackInterval,
            waitUntil: 0,
            attackHitDone: false,
            hatredUnitId: null,
            hatredUntil: 0,
            facingRadians: facing,
            deathRemoveAt: 0,
            marchAngle: null,
            freeX: spawnX,
            freeY: spawnY,
            completedAttackCount: 0,
        };
        this.units.register(unit);
        this.state.units.push(unit);
        this.rememberUnitCard(unit);
        //  诊断6.：追踪导弹单位是否真的上场了。
        if (zcIsMissileWatchUnit(unit.unitId)) {
            missileLog('模型', `镭射飞龙上场：#${unit.id} owner=${unit.owner} hp=${maxHp}`
                + ` 位置=(${spawnX.toFixed(1)},${spawnY.toFixed(1)}) t=${this.state.elapsedSeconds.toFixed(1)}s`);
        }
        // 同上：单位出生不是协议里的「操作」（这里原本误报成 op=1=翻格，params 也不是格子 id）。
        this.state.nextUnitId += 1;
        return unit;
    }

    /**
     * 召唤（`summon_unit`，2026-11-18 第 17 批 舞王 103103「舞王召唤」）。
     *
     * 设计口径（K/L/M + N 列）：召唤 4 个舞伴，继承本体 80/90/100% 生命与 60/70/80% 攻击，
     * 持续 6/7/8 秒；**跟随本体移动**（四个固定阵位，按本体朝向镜像）、**主动攻击最近的敌人**；
     * 只做普攻与被动，**不计入单位上限**，到期一起消失。
     *
     * 三条实现取舍，写清楚免得下一个人改回去：
     *  · **复制本体而不是造新兵种**：舞伴的 `unitId` / `cardId` 直接沿用本体 ⇒ 模型、动作、
     *    构筑加成全都天然一致，也不用为「舞伴僵尸」新开一张卡。半透明是视图按
     *    `summonAlpha` 叠的，不是另做一套美术。
     *  · **不计入上限**靠 `spawnUnit(..., ignoreUnitCap = true)`：这是拆城 Boss 用的同一条
     *    既有通道，不是新开口子。
     *  · **继承值写进 `inheritedStats`** 而不是直接改 `definition`：`effectiveDefinition`
     *    每帧从缓存折算，只有落在单位身上才不会被下一次刷新冲掉。
     *
     * 两条触发共用本方法（2026-11-19 第 26 批把 101404 的「一人成军」口径补全）：
     *  · 冷却制 `summonCooldown`（103103 舞王）—— 跟随、到期一起散；
     *  · 累计普攻 `summonEvery`（101404 分裂菇）—— `summonIndependent` 独立分身：
     *    自己寻路追人、本体阵亡不散（只等血量归零）、不占 `unitCapPerSide` 名额、
     *    场上同兵种最多 `summonMaxAlive` 只、超限整批**不释放**（不消费累计次数）。
     *
     * 2026-11-20 第 33 批给独立分身加了生成表现：**不在这里当拍出生**，而是压进
     * `state.pendingSummons`（第 i 只 `i × 0.1s` 播「分裂菇_生成分身」、再过 0.32s 才
     * `spawnUnit`，见 `flushPendingSummons`）。跟随型舞王仍走原来的当拍出生 ——
     * 它要钉在本体的阵位上，晚 0.32s 出场只会让「四个舞伴围着本体」这个语义错位。
     * 因此本方法的返回值含义是「**这次释放成立**」（已排队也算），不只是「当场生出了几个」。
     *
     * 返回 `true` = 至少召出一个（含排队中），调用方才消费 CD / 累计次数。
     */
    private summonUnits(master: ZCUnitState): boolean {
        const definition = this.effectiveUnitDefinition(master);
        const runtime = (master.neutralReinforcement ? this.neutralSkillRuntime : this.skillRuntime[master.owner])
            .get(`${master.unitId}:${definition.attackProfile.skillId}`);
        const params = runtime?.parameters;
        const count = Math.max(0, Math.round(params?.summonCount ?? 0));
        const hpInherit = Math.max(0, params?.summonHpInherit ?? 0);
        const attackInherit = Math.max(0, params?.summonAttackInherit ?? 0);
        //  三项缺一不可：漏配任何一项都按「参数不全」拒放（不消费 CD），
        //  而不是召出一群「0 血 / 0 攻击」的摆设 —— 那种错在场上完全看不出来。
        if (!(count >= 1) || !(hpInherit > 0) || !(attackInherit > 0)) return false;
        //  场上同种召唤物的同时存在上限（2026-11-19 第 26 批 101404）：
        //  设计原话「场上最多同时存在 12 个技能召唤出来的分裂菇；超过这个个数限制时不释放该技能」。
        //  口径取「这一批 + 现有 ≤ 上限才放」—— 不是「放到 12 为止」的截断：
        //  设计写的是「不释放」，截断成 2 只等于偷偷改了召唤数量，看不出错但收益全歪。
        //  `summonMaxAlive` 缺省 0 ⇒ 无上限，舞王 103103 逐字不变。
        const maxAlive = Math.max(0, Math.round(params?.summonMaxAlive ?? 0));
        if (maxAlive > 0) {
            //  排队中的那几只也要算进名额：它们已经「消费过」这一次释放，
            //  只数 `state.units` 会让 0.6s 内的第二次召唤看见「场上 0 只」再召一批。
            const alive = this.summonAliveCount(master);
            const pendingCount = this.pendingSummonCount(master);
            if (alive + pendingCount + count > maxAlive) {
                if (zcSkillCastWatched(master.unitId)) {
                    skillCastLog('召唤', `${master.unitId}#${master.id} 场上已有 ${alive}/${maxAlive} 只`
                        + `${pendingCount > 0 ? `（另有 ${pendingCount} 只正在生成）` : ''}`
                        + ` ⇒ 再召 ${count} 只会超限，本次不释放（不消费累计次数）`);
                }
                return false;
            }
        }
        const card = this.cards[master.owner].get(master.cardId) ?? findCatalogCard(master.cardId);
        if (!card) return false;
        const seconds = Math.max(0, params?.summonSeconds ?? 0);
        const follow = (params?.summonFollow ?? 0) > 0;
        //  独立分身（101404）：自己寻路追人、本体阵亡也不散、不占单位上限的名额。
        const independent = (params?.summonIndependent ?? 0) > 0;
        const slotRadius = Math.max(0, params?.summonSlotRadius ?? 0) * this.rules.combatDistanceScale;
        //  脚底光环的判定半径（世界 px）：既是「纯表现区域」的大小，也是舞伴的拴绳半径
        //  （用户口径「会在特效范围内移动和攻击」⇒ 光圈到哪，它们就能走到哪）。
        const auraRadiusTable = Math.max(0, params?.summonAuraRadius ?? 0);
        const auraRadiusWorld = auraRadiusTable * this.rules.combatDistanceScale;
        //  光圈放大倍率：跟随型才需要放大到圈住舞伴（阵位为 0 ⇒ 原尺寸）。
        //  🔴 只算一次：区域的 `effectScale` 与召唤物拴绳必须同一个数 ——
        //  一边 1.99 一边 1 就是「分身走出领域特效」那种错，而且只有肉眼能发现。
        const auraCoverScale = slotRadius > 0 ? (params?.summonAuraCoverScale ?? ZC_SUMMON_AURA_COVER_SCALE) : 1;
        //  透明度：配表优先（舞王 103103 是 0.6）；101404 三档都没填 `summonAlpha`，
        //  按设计口径「分身约 65%」兜底 —— 只在独立分身这一条车道上兜，普通召唤仍是实心。
        const alpha = Math.max(0, Math.min(1,
            params?.summonAlpha ?? (independent ? SUMMON_INDEPENDENT_ALPHA : 1)));
        //  基准取「本体当前的继承值」而不是兵种原表：本体若自己也是继承来的（门格复制、
        //  上一层召唤），链式继承才不会一代比一代虚高。与 `cloneGateUnit` 同一口径。
        const base = master.inheritedStats ?? definition;
        const inherited = {
            attack: Math.max(1, base.attack * attackInherit),
            moveSpeed: base.moveSpeed,
            attackInterval: base.attackInterval,
            attackRange: base.attackRange,
            bodyRadius: base.bodyRadius,
        };
        const maxHp = Math.max(1, Math.round(master.maxHp * hpInherit));
        const spawned: ZCUnitState[] = [];
        let queued = 0;
        const origin = this.services.unitPosition(master);
        for (let slot = 0; slot < count; slot += 1) {
            //  ── 独立分身：排队出生（2026-11-20 第 33 批）──
            //  三条设计口径都落在「什么时候真正 `spawnUnit`」上：
            //   1. 坐标散落在以本体为圆心 20px 的圆内（`sqrt` 让落点铺满圆面而不是堆在圆心）；
            //   2. 第 i 只比第 0 只晚 `i × 0.1s` 播特效；
            //   3. 自己那只特效起播 0.32s 后才出现在场上。
            //  不能改成「先召出来再隐藏」：隐藏单位照样是合法目标、也会自己走开（见常量注释）。
            if (independent) {
                //  角度按序号均分整圈、只用随机量做抖动：6 只若都听同一颗随机数，
                //  在某些种子下会**叠在同一个点**上（看起来只召出 1 只）。半径仍按
                //  `sqrt(随机)` 铺满圆面而不是全挤圆心。
                //  随机源取本局的（与 `spawnUnit` 的落点、抽卡同一个）⇒ 同一种子下可复现，
                //  与 `SPAWN_OFFSET_RADIUS` 那条注释同一条约定。
                const spread = Math.PI * 2 / Math.max(1, count);
                const angle = slot * spread + (this.random() - 0.5) * spread * 0.6;
                const scatterRadius = Math.max(0, params?.summonScatterRadius ?? SUMMON_SCATTER_RADIUS);
                const staggerSeconds = Math.max(0, params?.summonStaggerSeconds ?? SUMMON_STAGGER_SECONDS);
                const appearDelaySeconds = Math.max(0, params?.summonAppearDelaySeconds ?? SUMMON_APPEAR_DELAY_SECONDS);
                const radius = Math.sqrt(this.random()) * scatterRadius;
                const fxAt = this.state.elapsedSeconds + slot * staggerSeconds;
                (this.state.pendingSummons ??= []).push({
                    fxAtSeconds: Math.round(fxAt * 1e9) / 1e9,
                    spawnAtSeconds: Math.round((fxAt + appearDelaySeconds) * 1e9) / 1e9,
                    owner: master.owner,
                    cardId: master.cardId,
                    tier: master.tier,
                    sourceHexId: master.sourceHexId,
                    masterId: master.id,
                    skillId: definition.attackProfile.skillId,
                    skillName: definition.attackProfile.name,
                    effectPrefabPath: (params as any)?.summonSpawnFx ?? ZC_EFFECT_PATHS.fissionSpawn,
                    x: origin.x + Math.cos(angle) * radius,
                    y: origin.y + Math.sin(angle) * radius,
                    maxHp,
                    attack: inherited.attack,
                    moveSpeed: inherited.moveSpeed,
                    attackInterval: inherited.attackInterval,
                    attackRange: inherited.attackRange,
                    bodyRadius: inherited.bodyRadius,
                    summonUntil: seconds > 0 ? this.state.elapsedSeconds + seconds : undefined,
                    summonAlpha: alpha < 1 ? alpha : undefined,
                    summonIndependent: true,
                });
                queued += 1;
                continue;
            }
            const clone = this.spawnUnit(master.owner, card, master.tier, master.sourceHexId, true);
            if (!clone) continue;
            clone.maxHp = clone.hp = maxHp;
            clone.inheritedStats = { ...inherited, maxHp };
            clone.summonMasterId = master.id;
            //  注册那一刻还不知道自己是不是召唤物（`summonMasterId` 是这里才写的）
            //  ⇒ 必须补一刀把「单位上限名额」还回去，否则 12 只分身正好把兵营卡死。
            this.units.markSummon(clone);
            if (follow) {
                clone.summonSlot = slot;
                clone.summonSlotRadius = slotRadius > 0 ? slotRadius : undefined;
                //  拴绳 = **画面上那圈光环**的半轴（世界 px，2026-11-22 第 41 批改口径）。
                //  🔴 不是 `summonAuraRadius` 的判定半径：光圈是美术画的一张扁地面盘，
                //  视觉尺寸只由 `effectScale` 决定（见 `zcSummonAuraLeashHalfWorld`）。
                //  按判定半径（60 的圆）拴，纵向比可见环（≈33）大一倍 ⇒ 舞伴追人时明显出圈。
                //  🔴 没有光环就没有「圈」可拴 ⇒ 不写这个字段，保持老的「钉死阵位」行为。
                if (auraRadiusWorld > 0) {
                    const half = zcSummonAuraLeashHalfWorld(auraCoverScale);
                    clone.summonLeashRadius = half.x;
                    clone.summonLeashRadiusY = half.y;
                }
            }
            //  `summonSeconds <= 0` ⇒ 不写到期时刻 = 到战死为止（101404 一人成军的裁定口径）。
            if (seconds > 0) clone.summonUntil = this.state.elapsedSeconds + seconds;
            if (alpha < 1) clone.summonAlpha = alpha;
            if ((params as any)?.summonSlotAngles) clone.summonSlotAngles = (params as any).summonSlotAngles;
            this.placeSummon(clone, master, slot, slotRadius, follow);
            spawned.push(clone);
        }
        //  ── 脚底持续光环（2026-11-20 第 34 批 舞王 103103）──
        //  用户口径：「艺术家释放分身时，在本体脚底同步播放【持续光环伤害效果】，范围要囊括
        //  本体和 4 个分身」+「纯表现，无伤害」。所以它是**一条跟着本体的纯表现区域**：
        //  没有波次、没有触碰、到期不炸（三个口子都关死），只负责把那张 `holdVisual` 事件
        //  钉在本体脚下、和舞伴同起同落。
        //  🔴 只在**这一次真的召出来了**（含排队）才建：被 12 只上限拒放的那一次不该留一圈空光环。
        //  独立分身（101404）三档都没配 `summonAuraRadius` ⇒ 这段一次都不进。
        //  🔴 `auraRadiusTable` / `auraRadiusWorld` 只喂区域本身（判定半径 + 「有没有圈」）；
        //  召唤物的拴绳**不看它** —— 光圈的可视大小由 prefab 与 `effectScale` 决定，
        //  两者在纵向差近一倍（2026-11-22 第 41 批，见 `zcSummonAuraLeashHalfWorld`）。
        if (auraRadiusTable > 0 && spawned.length + queued > 0) {
            this.pushSummonAuraZone(master, auraRadiusTable, seconds, auraCoverScale,
                definition.attackProfile.skillId, definition.attackProfile.name);
        }
        if (zcSkillCastWatched(master.unitId)) {
            skillCastLog('召唤', `${master.unitId}#${master.id} 召出 ${spawned.length + queued}/${count} 个`
                + `（生命 ${Math.round(hpInherit * 100)}% / 攻击 ${Math.round(attackInherit * 100)}%`
                + `，持续 ${seconds > 0 ? `${seconds}s` : '到战死'}`
                + `${independent ? `，散落半径 ${SUMMON_SCATTER_RADIUS}、间隔 ${SUMMON_STAGGER_SECONDS}s、`
                    + `透明度 ${Math.round(alpha * 100)}%` : ''}`
                + `${follow ? `，阵位半径 ${slotRadius.toFixed(1)}` : '，自由行动'}）`);
        }
        return spawned.length + queued > 0;
    }

    /**
     * 召唤的「脚底持续光环」（2026-11-20 第 34 批 舞王 103103）。
     *
     * 设计口径（用户原话）：「艺术家释放分身时，在本体脚底同步播放【持续光环伤害效果】预制体
     * 特效，改特效的范围需要囊括本体和 4 个分身」；问过口径 ⇒ **纯表现，无伤害**。
     *
     * 做法是借「整段持有视觉」那条既有通道（`holdVisual` + `followUnitId`）—— 不是新开一套
     * 挂在单位身上的循环特效：
     *  · 区域本身就是「有寿命 + 每帧同步坐标」的结构，`syncHoldVisual` 会给它建一条长效
     *    `area` 事件、每帧把坐标刷过去，区域消散时同步摘掉 ⇒ 光圈自然跟着本体走、跟舞伴同起同落；
     *  · 视觉大小**不能**指望 `nodeScale` 那一刀切：那份倍率是给 `68021` / `68024` 的
     *    `auraRadius 120` 调的（它们看到环 174 屏上 px、判定 184.5，正好），照它的口径算
     *    「200 与画面同一圈」会差 1.77 倍。这条车道改走事件级 `effectScale`
     *    = `ZC_SUMMON_AURA_COVER_SCALE`（1.99，实测：这张盘比镜头扁 2 倍，纵向才是卡点）；
     *  · 三个「会伤人」的口子全部关死：`wavesLeft = 0`（不结算波次）、`contactRadius` 不写
     *    （踩上去什么都不会发生）、`expireDamage = 0` + `expirePrefabPath` 不写（到期不炸）。
     *    少关一个就会变成「一圈看不见的光环一直在掉血」—— 结算正常、画面全无，最难查。
     */
    private pushSummonAuraZone(master: ZCUnitState, radiusTable: number, seconds: number,
        coverScale: number, skillId: number, skillName: string): void {
        const origin = this.services.unitPosition(master);
        const duration = seconds > 0 ? seconds : SUMMON_AURA_FALLBACK_SECONDS;
        this.state.groundZones.push({
            x: origin.x,
            y: origin.y,
            //  表值是逻辑 px，与世界坐标差一个 `combatDistanceScale`（与 auraRadius 同一套）。
            radius: radiusTable * this.rules.combatDistanceScale,
            owner: master.owner,
            sourceUnitId: master.id,
            skillId,
            skillName,
            effectPrefabPath: (params as any)?.summonAuraFx ?? ZC_EFFECT_PATHS.sustainedAura,
            //  整段持有：一条事件跟着区域走，消散时摘掉（不是按波次频闪）。
            holdVisual: true,
            //  每帧把圆心拍回本体脚下；本体阵亡后停在最后位置，光圈到时自己消失。
            followUnitId: master.id,
            //  放大到「正好圈住本体 + 一圈舞伴」：`effectScale = 1` 时那圈环只有 184×72 屏上 px，
            //  而 4 个舞伴落在屏幕上 (65,55) 处、纵向还差一半 —— 不放大就是脚在环外。
            effectScale: coverScale,
            remainingSeconds: duration,
            wavesLeft: 0,
            nextWaveAt: this.state.elapsedSeconds + duration,
            waveInterval: duration,
            damage: 0,
            slowRatio: 0,
            expireDamage: 0,
        });
    }

    /**
     * 把到点的排队召唤物真正生出来（2026-11-20 第 33 批 101404 分裂菇）。
     *
     * 每一只两个时刻：`fxAtSeconds` 推特效事件、`spawnAtSeconds` 才 `spawnUnit`。
     * 两者之间那 0.32s 就是「先播放【分裂菇_生成分身】，再出现分身」。
     *
     * 🔴 三条不能省的：
     *  1. **本体死了照样出生**：独立分身的裁定是「血量为 0 才消失」，队列里存的是
     *     施法那一刻算好的继承值，所以这里不回头查本体。
     *  2. **`markSummon` 必须补**：`spawnUnit` 注册时它是普通单位，不还名额就会吃兵营上限。
     *  3. **坐标用队列里那一份**，不重新按本体算 —— 本体这 0.32s 内可能已经走开或已经没了。
     *
     * 队列通常为空（只有分裂菇在放技能后的 0.9s 内有货），空则直接返回、不分配。
     */
    private flushPendingSummons(): void {
        const pending = this.state.pendingSummons;
        if (!pending || !pending.length) return;
        const now = this.state.elapsedSeconds;
        let write = 0;
        for (let read = 0; read < pending.length; read += 1) {
            const entry = pending[read];
            if (entry.fxPlayed !== true && now + 1e-9 >= entry.fxAtSeconds) {
                entry.fxPlayed = true;
                this.pushSummonSpawnFx(entry);
            }
            if (now + 1e-9 < entry.spawnAtSeconds) {
                if (write !== read) pending[write] = entry;
                write += 1;
                continue;
            }
            this.materializeSummon(entry);
        }
        pending.length = write;
    }

    /** 队列里还排着的、属于这个本体的召唤物数量（`summonMaxAlive` 的名额判据）。*/
    private pendingSummonCount(master: ZCUnitState): number {
        const pending = this.state.pendingSummons;
        if (!pending || !pending.length) return 0;
        let total = 0;
        for (const entry of pending) {
            if (entry.owner !== master.owner || entry.cardId !== master.cardId) continue;
            total += 1;
        }
        return total;
    }

    /**
     * 推一条「生成」特效事件：落点就是这一只的出生坐标。
     *
     * `startedAt` 写当前时刻而不是排到未来 —— 到点才推是这条链的口径（视图侧对
     * `startedAt` 在未来的事件整条不建节点，两条一起用只会多一份没必要的排队）。
     */
    private pushSummonSpawnFx(entry: IZCPendingSummon): void {
        this.state.combatEvents.push({
            id: this.state.nextCombatEventId++,
            type: 'area',
            owner: entry.owner,
            sourceUnitId: entry.masterId,
            targetUnitId: null,
            skillId: entry.skillId,
            skillName: entry.skillName,
            effectKey: null,
            projectileKey: null,
            effectPrefabPath: entry.effectPrefabPath ?? ZC_EFFECT_PATHS.fissionSpawn,
            fromX: entry.x,
            fromY: entry.y,
            toX: entry.x,
            toY: entry.y,
            radius: 0,
            damage: 0,
            empowered: false,
            startedAt: this.state.elapsedSeconds,
            durationSeconds: ZC_SUMMON_SPAWN_FX_SECONDS,
        });
    }

    /** 把一条排队项变成真正的单位：属性、归属、名额、坐标全部按队列里那一份写死。*/
    private materializeSummon(entry: IZCPendingSummon): void {
        const card = this.cards[entry.owner].get(entry.cardId) ?? findCatalogCard(entry.cardId);
        //  卡查不到（构筑被换掉 / 存档来自别的版本）⇒ 这一只放弃，别让队列卡住永久重试。
        if (!card) return;
        const clone = this.spawnUnit(entry.owner, card, entry.tier, entry.sourceHexId, true);
        if (!clone) return;
        clone.maxHp = clone.hp = entry.maxHp;
        clone.inheritedStats = {
            attack: entry.attack,
            moveSpeed: entry.moveSpeed,
            attackInterval: entry.attackInterval,
            attackRange: entry.attackRange,
            bodyRadius: entry.bodyRadius,
            maxHp: entry.maxHp,
        };
        clone.summonMasterId = entry.masterId;
        if (entry.summonIndependent === true) clone.summonIndependent = true;
        this.units.markSummon(clone);
        if (entry.summonUntil !== undefined) clone.summonUntil = entry.summonUntil;
        if (entry.summonAlpha !== undefined) clone.summonAlpha = entry.summonAlpha;
        //  出生坐标用队列里那一份散落点：`placeAt` 同时更新连续坐标、朝向与所在格索引，
        //  直接写 `freeX/freeY` 会让「显示在哪」与「站在哪一格」分叉。
        this.movement.placeAt(clone, entry.x, entry.y, true);
    }

    /**
     * 场上「同阵营 + 同兵种」的活着的召唤物数量（`summonMaxAlive` 判据）。
     *
     * 按 `unitId` 而不是按 `summonMasterId` 数：设计说的是「场上最多同时存在 12 个
     * **技能召唤出来的分裂菇**」—— 三只本体各自召的分身共享同一个 12 的名额，
     * 因此阵亡/新召的本体不会各自重开一个 12。
     * `state.units` 里已死但还没被 `removeDeadUnits` 摘掉的会一并过滤。
     */
    private summonAliveCount(master: ZCUnitState): number {
        let total = 0;
        for (const unit of this.state.units) {
            if (unit.summonMasterId === undefined) continue;
            if (unit.owner !== master.owner || unit.unitId !== master.unitId) continue;
            if (unit.battleState === 'dead' || unit.hp <= 0) continue;
            total += 1;
        }
        return total;
    }

    /**
     * 把一个召唤物摆到它该站的位置：跟随 ⇒ 「本体坐标 + 阵位（随本体朝向旋转）」，
     * 不跟随 ⇒ 就站在本体脚下（等它自己走开）。
     *
     * `keepFacing`：位置是硬钉的，朝向不能被「位移方向」覆盖，否则本体转一圈，
     * 四个舞伴会各自扭头看自己"飞过去"的方向。朝向留给索敌/攻击去改。
     */
    private placeSummon(unit: ZCUnitState, master: ZCUnitState, slot: number,
        radius: number, follow: boolean): void {
        const origin = this.services.unitPosition(master);
        if (!follow || !(radius > 0)) {
            this.movement.placeAt(unit, origin.x, origin.y, true);
            return;
        }
        const degreesList = unit.summonSlotAngles && unit.summonSlotAngles.length > 0
            ? unit.summonSlotAngles : SUMMON_SLOT_DEGREES;
        const degrees = degreesList[slot % degreesList.length];
        const angle = master.facingRadians + degrees * Math.PI / 180;
        this.movement.placeAt(unit,
            origin.x + Math.cos(angle) * radius, origin.y + Math.sin(angle) * radius, true);
    }

    /**
     * 每帧推进召唤物（在 `ZCUnitSystem.update` **之前**跑，保证状态机看到的是这一帧的位置）。
     *
     * 三件事：
     *  1. 到期 ⇒ 置 `dead` + `deathRemoveAt = now`，同一帧被 `removeDeadUnits` 摘掉
     *     （设计「到期一起消失」，不留尸体也不走阵亡动画）；
     *  2. 本体没了（被打死 / 被移除）⇒ 召唤物跟着收场，否则位置无从算起；
     *     **独立分身除外**（`summonIndependent`，101404）：设计口径是「血量为 0 才消失」，
     *     本体先死也照常自己打，否则一波换血就把刚召出来的 6 只一起带走了；
     *  3. 跟随时守住阵位（独立分身不跟随，位置交给普通寻路）。两种语义：
     *     · 没配拴绳（`summonLeashRadius` 为空）⇒ 每帧钉死阵位，寸步不移；
     *     · 配了拴绳 ⇒ 只在**跑出圈**时拉回边界，圈内放过它自己走到的坐标
     *       （`ZCUnitSystem` 会用 `advanceTowardPoint` 让它去追目标）。
     */
    private syncSummons(): void {
        if (!this.state.units.length) return;
        const now = this.state.elapsedSeconds;
        for (const unit of this.state.units) {
            if (unit.summonMasterId === undefined) continue;
            if (unit.battleState === 'dead' || unit.hp <= 0) continue;
            const expired = unit.summonUntil !== undefined && now >= unit.summonUntil - 1e-9;
            if (expired) {
                //  与阵亡走同一条出口：`removeDeadUnits` 会把 registry / 状态 / 索敌缓存一起清掉，
                //  自己 `splice` 只会漏掉别的几份索引。
                unit.battleState = 'dead';
                unit.hp = 0;
                unit.deathRemoveAt = now;
                continue;
            }
            //  独立分身：本体在不在都与它无关（本体查不到也不必收场），只等血量归零。
            if (unit.summonIndependent === true) continue;
            const master = this.units.byId.get(unit.summonMasterId);
            if (!master || master.battleState === 'dead' || master.hp <= 0) {
                unit.battleState = 'dead';
                unit.hp = 0;
                unit.deathRemoveAt = now;
                continue;
            }
            if (unit.summonSlot === undefined) continue;
            const leash = unit.summonLeashRadius;
            if (!(typeof leash === 'number' && leash > 0)) {
                this.placeSummon(unit, master, unit.summonSlot, unit.summonSlotRadius ?? 0, true);
                continue;
            }
            //  `summonLeashRadiusY` 缺省 ⇒ 圆形（老快照 / 读档兼容）；非正数也按圆形兜（否则除以 0）。
            const leashY = unit.summonLeashRadiusY;
            this.leashSummon(unit, master, leash, typeof leashY === 'number' && leashY > 0 ? leashY : leash);
        }
    }

    /**
     * 拴绳：只处理「跑出圈」这一种情况。
     *
     * 🔴 为什么不能继续每帧 `placeSummon`：舞伴的普攻射程只有
     *    `(45 表内 + 12 体型) × combatDistanceScale` ≈ 17 世界 px，而阵位半径是 36 ——
     *    把坐标钉死在阵位上，它们**永远够不到站在本体旁边的敌人**（2026-11-21 第 36 批，
     *    用户原话「分身会在特效范围内移动和攻击其他敌人目标 / 建筑 / 城墙，现在不会攻击了」）。
     *
     * 🔴 圈是**椭圆**（2026-11-22 第 41 批）：光圈在屏上是个扁盘，换回世界坐标横向比纵向宽一倍
     *    （现在 ≈ 71 × 33）。按圆形拴的话，纵向会允许它们走到可见环的两倍高度以外 ——
     *    用户实测「分身会走出领域特效的范围」。
     *
     * 圈心是**本体**（光环挂在脚下），不是阵位点：阵位点只是出生位置，出了圈才拉回边界。
     * 🔴 这里**不为阵位留余量**（第 36 批曾经 `max(拴绳, 阵位半径)`）：圈就是画面上那圈光，
     *    阵位若比圈还大（配表调大 `summonSlotRadius`），正确的做法是「出生即被拉进圈」，
     *    而不是把圈放大到装下阵位 —— 那等于又允许它们站在画面外。
     */
    private leashSummon(unit: ZCUnitState, master: ZCUnitState, leashX: number, leashY: number): void {
        const origin = this.services.unitPosition(master);
        const current = this.services.unitPosition(unit);
        const rx = leashX;
        const ry = leashY;
        const dx = current.x - origin.x;
        const dy = current.y - origin.y;
        //  归一化到「单位椭圆」上判越界：`(dx/rx)² + (dy/ry)² > 1` ⇒ 出了圈。
        const nx = dx / rx;
        const ny = dy / ry;
        const norm = Math.sqrt(nx * nx + ny * ny);
        if (norm <= 1 + 1e-6) return;
        //  按同一比例缩回边界（椭圆上的点）：`(dx/norm, dy/norm)`。
        //  拉回边界而不是拉回阵位：它想打的目标通常就在圈边外一点，
        //  每帧拉回阵位等于让它「走一步退十步」，永远在原地抽动。
        this.movement.placeAt(unit, origin.x + dx / norm, origin.y + dy / norm, true);
    }

    private cloneGateUnit(source: ZCUnitState): ZCUnitState | void {
        const card = findCatalogCard(source.cardId);
        if (!card) return;
        const clone = this.spawnUnit(source.owner, card, source.tier, source.sourceHexId);
        if (!clone) return;
        const definition = source.inheritedStats ?? this.effectiveUnitDefinitionFor(source.owner, source.unitId);
        clone.maxHp = clone.hp = source.maxHp;
        clone.attackMultiplier = source.attackMultiplier;
        clone.neutralReinforcement = source.neutralReinforcement;
        clone.freeX = source.freeX;
        clone.freeY = source.freeY;
        clone.facingRadians = source.facingRadians;
        clone.gateSize = source.gateSize;
        clone.gateScale = source.gateScale;
        clone.gateMoveMultiplier = source.gateMoveMultiplier;
        clone.gateAttackSpeedMultiplier = source.gateAttackSpeedMultiplier;
        clone.gateDamageMultiplier = source.gateDamageMultiplier;
        clone.gateHpFlat = source.gateHpFlat;
        clone.passiveStatusApplied = source.passiveStatusApplied;
        this.statusSystem.cloneUnitStatuses(String(source.id), String(clone.id));
        clone.inheritedStats = {
            attack: definition.attack,
            moveSpeed: definition.moveSpeed,
            attackInterval: definition.attackInterval,
            attackRange: definition.attackRange,
            bodyRadius: definition.bodyRadius,
            ...(source.inheritedStats?.maxHp !== undefined ? { maxHp: source.inheritedStats.maxHp } : {}),
        };
        return clone;
    }

    /** 到配置时间或已出怪物全部被击退时，在敌方主城生成下一波；首波只按时间。*/
    private spawnDueDefenceWaves(forceLastWave = false): void {
        if (!this.pveDefence) return;
        this.triggerDueDefenceWaves(forceLastWave);
        //  每拍都推一次队列：波次触发那一拍也要把第一只当场放出来（旧实现「到点即出怪」）。
        this.advanceDefenceSpawnQueue();
    }

    /**
     * 波次触发：只决定「哪些波现在开始出」并登记出怪票，不直接生成单位。
     *
     * 一波 20~30 只时若在这里 for 循环全生成，观感是同一帧从主城爆出一坨、朝向随机散开；
     * 用户口径（2026-11-20）要求逐只 0.1~0.2s 排队走出来 ⇒ 实际生成挪到
     * `advanceDefenceSpawnQueue`。
     */
    private triggerDueDefenceWaves(forceLastWave: boolean): void {
        const waves = this.pveDefence?.waves;
        if (!waves?.length) return;
        if (forceLastWave) {
            if (this.nextDefenceWaveIndex >= waves.length) return;
            // 拆城直接挑战末波；已在场的怪物保留，尚未生成的中间波不再生成。
            this.nextDefenceWaveIndex = waves.length - 1;
        }
        while (this.nextDefenceWaveIndex < waves.length) {
            const wave = waves[this.nextDefenceWaveIndex];
            if (!forceLastWave && wave.showAtSeconds > this.state.elapsedSeconds + 1e-9) {
                if (this.nextDefenceWaveIndex === 0 || this.defenceForceOnField()) return;
            }
            this.nextDefenceWaveIndex += 1;
            // 提前出怪后不能再按 elapsedSeconds 推导进度，存档必须记下实际波序。
            this.state.nextDefenceWaveIndex = this.nextDefenceWaveIndex;
            // 先占位再生成：波序与账本下标必须逐位对齐，中途 `continue` 也不能错位。
            const ledger = { ids: [] as number[], maxHp: 0 };
            this.defenceWaveLedger[this.nextDefenceWaveIndex - 1] = ledger;
            const card = this.cardById(ZCOwner.Enemy, wave.cardId);
            if (!card?.unitId) {
                continue;
            }
            const count = Math.max(0, Math.floor(wave.monsterCount));
            if (count > 0) {
                this.defenceSpawnQueue.push({
                    waveIndex: this.nextDefenceWaveIndex - 1,
                    card,
                    tier: Math.max(1, Math.floor(wave.tier)),
                    // 怪物体型（表 `defenceModWave.monsterSize`）：BOSS 行填 2，模型放大一倍。
                    sizeScale: defenceMonsterScale(wave.monsterSize),
                    count,
                    ignoreUnitCap: forceLastWave,
                    spawned: 0,
                    nextSpawnAt: this.state.elapsedSeconds,
                });
            }
        }
    }

    /**
     * 场上还算不算「这一波没打完」：有活着的敌人，或者还有怪排着队没出生。
     *
     * 🔴 后半条不能省：逐只出怪后，「第一只刚死、第二只还没出生」会出现一帧场上空场，
     * 只判活体的话下一波会当场上没敌人直接提前触发，整局波次节奏就乱了。
     */
    private defenceForceOnField(): boolean {
        if (this.defenceSpawnQueue.length) return true;
        return this.state.units.some((unit) => unit.owner !== ZCOwner.Player && unit.battleState !== 'dead');
    }

    /** 按每拍补齐到点的出怪票：同波相邻两只的出生时刻相差 `ZC_DEFENCE_SPAWN_INTERVAL_SECONDS`。*/
    private advanceDefenceSpawnQueue(): void {
        if (!this.defenceSpawnQueue.length) return;
        const now = this.state.elapsedSeconds;
        for (let index = this.defenceSpawnQueue.length - 1; index >= 0; index -= 1) {
            const ticket = this.defenceSpawnQueue[index];
            // 掉帧 / 大步长时补发：按时间轴一只只补，间隔不被帧率吃掉。
            while (ticket.spawned < ticket.count && ticket.nextSpawnAt <= now + 1e-9) {
                this.spawnDefenceWaveUnit(ticket);
                ticket.spawned += 1;
                ticket.nextSpawnAt = Math.round(
                    (ticket.nextSpawnAt + ZC_DEFENCE_SPAWN_INTERVAL_SECONDS) * 1e9) / 1e9;
            }
            if (ticket.spawned >= ticket.count) this.defenceSpawnQueue.splice(index, 1);
        }
    }

    /** 出一只怪并记进本波账本；兵力上限拦下时这一只算已出（与旧的 `continue` 同口径）。*/
    private spawnDefenceWaveUnit(ticket: ZCDefenceSpawnTicket): void {
        const isBoss = ticket.sizeScale > 1;
        const lineUpCount = isBoss ? 1 : ticket.count;
        const unit = this.spawnUnit(ZCOwner.Enemy, ticket.card, ticket.tier,
            this.homeId(ZCOwner.Enemy), ticket.ignoreUnitCap, true, ticket.spawned, lineUpCount);
        if (!unit) return;
        // `gateScale` 是本工程现有的「单位级视觉缩放」通道：`ZCUnitView` 的模型缩放、
        // 头顶血条偏移与兜底体型半径都乘它（见 `ZCUnitView.render`）。体型只影响观感，
        // 不动 `bodyRadius` 等逻辑数值。
        if (ticket.sizeScale !== 1) unit.gateScale = ticket.sizeScale;
        const ledger = this.defenceWaveLedger[ticket.waveIndex];
        if (!ledger) return;
        ledger.ids.push(unit.id);
        ledger.maxHp += Math.max(0, unit.maxHp);
    }

    private cardById(owner: ZCOwner, id: string): ZCDeckCard | undefined {
        return this.cards[owner].get(id) ?? (owner === ZCOwner.Player ? this.debugCards.get(id) : undefined);
    }

    private unitDefinition(id: string): ZCUnitDefinition {
        const definition = this.definitions.get(id);
        if (!definition) throw new Error(`本局单位配置不存在：${id}`);
        return definition;
    }

    private effectiveUnitDefinition(unit: ZCUnitState): ZCUnitDefinition {
        const revision = this.statusSystem.revisionOf(String(unit.id));
        const cached = this.effectiveCache.get(unit.id);
        if (cached
            && cached.revision === revision
            && cached.gateSize === unit.gateSize
            && cached.gateScale === unit.gateScale
            && cached.gateMove === unit.gateMoveMultiplier
            && cached.gateAttackSpeed === unit.gateAttackSpeedMultiplier
            && cached.gateDamage === unit.gateDamageMultiplier
            && ZCGameModel.sameInheritedStats(cached.inherited, unit.inheritedStats)) {
            return cached.def;
        }
        const definition = unit.neutralReinforcement ? this.unitDefinition(unit.unitId)
            : this.effectiveUnitDefinitionFor(unit.owner, unit.unitId);
        const original = unit.inheritedStats ? { ...definition, ...unit.inheritedStats } : definition;
        const base = unit.gateSize ? {
            ...original,
            moveSpeed: original.moveSpeed * (unit.gateMoveMultiplier ?? 1),
            attackInterval: original.attackInterval / (unit.gateAttackSpeedMultiplier ?? 1),
            attack: original.attack * (unit.gateDamageMultiplier ?? 1),
            prefabSize: original.prefabSize * (unit.gateScale ?? 1),
        } : original;
        const modCount = this.statusSystem.statModsCountOf(String(unit.id));
        let def: ZCUnitDefinition;
        if (!modCount) {
            def = base;
        } else {
            const mods = this.statusSystem.statModsOf(String(unit.id));
            const attackDuration = base.attackDuration;
            def = {
                ...base,
                attack: Math.max(0, (base.attack + (mods.attackFlat ?? 0)) * Math.max(0, 1 + (mods.attackPct ?? 0) / 100)),
                maxHp: Math.max(1, base.maxHp * Math.max(0.01, 1 + (mods.maxHpPct ?? 0) / 100)),
                moveSpeed: Math.max(0, base.moveSpeed * Math.max(0, 1 + (mods.moveSpeedPct ?? 0) / 100)),
                attackRange: Math.max(0, base.attackRange * Math.max(0, 1 + (mods.attackRangePct ?? 0) / 100)),
                attackInterval: Math.max(0.01, base.attackInterval * Math.max(0.01, 1 - (mods.attackIntervalPct ?? 0) / 100)),
                attackHitTime: Math.min(attackDuration, base.attackHitTime),
            };
        }
        this.effectiveCache.set(unit.id, {
            revision,
            inherited: unit.inheritedStats,
            gateSize: unit.gateSize,
            gateScale: unit.gateScale,
            gateMove: unit.gateMoveMultiplier,
            gateAttackSpeed: unit.gateAttackSpeedMultiplier,
            gateDamage: unit.gateDamageMultiplier,
            def,
        });
        return def;
    }

    private static sameInheritedStats(
        left: ZCUnitState['inheritedStats'],
        right: ZCUnitState['inheritedStats'],
    ): boolean {
        if (left === right) return true;
        if (!left || !right) return false;
        return left.attack === right.attack
            && left.moveSpeed === right.moveSpeed
            && left.attackInterval === right.attackInterval
            && left.attackRange === right.attackRange
            && left.bodyRadius === right.bodyRadius
            && left.maxHp === right.maxHp;
    }

    private effectiveUnitDefinitionFor(owner: ZCOwner, id: string): ZCUnitDefinition {
        const definition = this.effectiveDefinitions[owner].get(id);
        if (!definition) throw new Error(`本局单位有效属性不存在：${owner}:${id}`);
        return definition;
    }

    private removeDeadUnits(): void {
        let write = 0;
        for (const unit of this.state.units) {
            if (unit.battleState === 'dead' && unit.deathRemoveAt <= this.state.elapsedSeconds) {
                this.units.remove(unit);
                this.statusSystem.removeAll(String(unit.id));
                this.effectiveCache.delete(unit.id);
                this.unitTargeting.removeUnit(unit.id);
            } else {
                this.state.units[write++] = unit;
            }
        }
        this.state.units.length = write;
        if (this.statusSystem.isDirty() || this.state.statusEffects == null) {
            this.state.statusEffects = this.statusSystem.exportSnapshot();
        }
    }

    private moveUnitToHex(unit: ZCUnitState, hexId: number): void {
        this.units.move(unit, hexId);
    }

    private bonusesFor(owner: ZCOwner): ZCDeckBonuses {
        return this.deckBonuses[owner];
    }

    private deckFor(owner: ZCOwner): readonly ZCDeckCard[] {
        return this.config.ownerDecks?.[owner]
            ?? (owner === ZCOwner.Player ? this.config.playerDeck : this.config.enemyDeck);
    }

    private homeId(owner: ZCOwner): number {
        const index = ZC_OWNER_ORDER.indexOf(owner);
        return this.config.map.homes?.[index]
            ?? (owner === ZCOwner.Player ? this.config.map.playerHomeId : this.config.map.enemyHomeId);
    }

    private goldOf(owner: ZCOwner): number {
        if (owner === ZCOwner.Player) return this.state.playerGold;
        if (owner === ZCOwner.Enemy) return this.state.enemyGold;
        return this.state.goldByOwner?.[owner] ?? 0;
    }

    private setGold(owner: ZCOwner, value: number): void {
        const normalized = Math.max(0, value);
        if (!this.state.goldByOwner) {
            this.state.goldByOwner = { player: this.state.playerGold, enemy: this.state.enemyGold, enemy2: 0, enemy3: 0 };
        }
        this.state.goldByOwner[owner] = normalized;
        if (owner === ZCOwner.Player) this.state.playerGold = normalized;
        else if (owner === ZCOwner.Enemy) this.state.enemyGold = normalized;
    }

    /** 从当前位置选择最近的仍在局内的敌方主城，供 3/4 人单位自由行军。*/
    private goalHomeId(owner: ZCOwner, fromHexId: number): number {
        const candidates = this.activeOwners
            .filter((candidate) => candidate !== owner && this.developedCount(candidate) > 0)
            .map((candidate) => this.homeId(candidate))
            .filter((id) => id >= 0);
        if (!candidates.length) return this.homeId(owner);
        return candidates.sort((a, b) => this.geometry.distance(fromHexId, a) - this.geometry.distance(fromHexId, b) || a - b)[0];
    }

    private facingTowardGoal(owner: ZCOwner, fromHexId: number): number {
        const from = this.config.map.hexes[fromHexId];
        const goal = this.config.map.hexes[this.goalHomeId(owner, fromHexId)];
        return goal ? Math.atan2(goal.y - from.y, goal.x - from.x) : (owner === ZCOwner.Player ? Math.PI / 2 : -Math.PI / 2);
    }

    private chargeArtifactFromDevelopment(): void {
        ZCArtifactSystem.chargeFromDevelopment(this.state, this.rules);
    }

    private refreshTileStates(): void {
        if (!this.tileStatesDirty) return;
        ZCTileSystem.refresh(this.state, this.config.map);
        this.tileStatesDirty = false;
        //  必须在 refresh 之后判断：邻接关系依赖「上一轮算出来的 state」，
        //    先判就会慢一拍（第一片资源点要等到下一次脏刷新才入袋）。
        this.claimAdjacentNeutralResources();
        // 邻接资源领取可能改多格 owner，统一在这里失效一次。
        this.territoryCountsReady = false;
    }

    private claimAdjacentNeutralResources(): void {
        this.neutralFeatures.claim(this.state);
        ZCDevelopmentSystem.claimAdjacentNeutralResources(
            this.state, this.config.map, this.activeOwners, this.developmentContext, (hexId, itemId) => {
                this.tileStatesDirty = true;
                this.invalidateTerrain();
                // 金矿 / 兵营「被开发」：这两类资源领取后原地立起一座建筑，走「建筑被开发」的
                // 点击动画（脉冲 ∥ 缩没、无卡牌），与「开出一块地」同一种观感（2026-10-20 需求）。
                if (isZCNeutralResourceBuilding(neutralResourceItemOf(itemId))) {
                    this.pushHexActivation(hexId, false, 0);
                }
            });
    }

    /**
     * 中立资源奖励入袋的表现入口：按资源类型收敛在这里。
     * 金矿/兵营播建筑激活，宝箱/金币入队金币飞行，神器充能入队神器飞行，兵团直接产兵。
     * 无实际入账金额一律不入队，避免空特效。
    */
    private pushNeutralReward(hexId: number, itemId: number, owner: ZCOwner,
        item: ZCNeutralResourceItem): void {
        if (isZCNeutralResourceBuilding(item)) return;
        if (item.gold <= 0 && item.artifactCharge <= 0) return;
        this.presentation.pushNeutralReward({
            now: this.state.elapsedSeconds,
            hexId,
            itemId,
            owner,
            gold: item.gold,
            artifactCharge: item.artifactCharge,
        });
    }

    private checkOutcome(): void {
        const result = ZCOutcomeSystem.checkOutcome(
            this.state, this.outcomeContext, this.nextDefenceWaveIndex, this.defenceBossState());
        if (result) this.finish(result.status, result.reason, result.winner);
    }

    private finish(status: Exclude<ZCGameStatus, 'playing'>, reason: string, winner: ZCOwner | null): void {
        this.state.status = status;
        this.state.resultReason = reason;
        this.matchWinner = winner;
    }

    /** 本局胜方（`draw` / 未定 = `null`）。结算扫场用它上色，见 `matchWinner` 的说明。*/
    get winner(): ZCOwner | null {
        return this.matchWinner;
    }

    private mineIncome(owner: ZCOwner): number {
        return ZCEconomySystem.mineIncome(
            owner,
            this.state.hexes,
            (cardOwner, cardId) => this.cardById(cardOwner, cardId),
            (hex, card) => this.buildingCycleSeconds(hex, card),
        );
    }

    private territoryCount(owner: ZCOwner): number {
        if (!this.territoryCountsReady) {
            this.territoryCounts.clear();
            for (const hex of this.state.hexes) {
                this.territoryCounts.set(hex.owner, (this.territoryCounts.get(hex.owner) ?? 0) + 1);
            }
            this.territoryCountsReady = true;
        }
        return this.territoryCounts.get(owner) ?? 0;
    }

    private developedCount(owner: ZCOwner): number {
        let count = 0;
        for (const hex of this.state.hexes) {
            if (hex.owner === owner && hex.building !== 'none' && hex.hp > 0) count++;
        }
        return count;
    }

    private unitCount(owner: ZCOwner): number {
        return this.units.count(owner);
    }

    /** 收集以 hexId 为中心、格距不超过 radiusHex 的所有单位（含中心格），供索敌/塔/溅射邻域查询。*/
    private unitsInRadius(hexId: number, radiusHex: number): ZCUnitState[] {
        const collected: ZCUnitState[] = [];
        const key = `${hexId}:${radiusHex}`;
        let neighborhood = this.radiusHexes.get(key);
        if (!neighborhood) {
            neighborhood = this.collectRadiusHexes(hexId, radiusHex);
            this.radiusHexes.set(key, neighborhood);
        }
        for (const id of neighborhood) {
            const bucket = this.units.byHex.get(id);
            if (bucket) for (const unit of bucket) collected.push(unit);
        }
        return collected;
    }

    private collectRadiusHexes(hexId: number, radiusHex: number): number[] {
        const collected: number[] = [];
        const visited = new Set<number>([hexId]);
        let frontier = [hexId];
        for (let depth = 0; depth <= radiusHex && frontier.length > 0; depth += 1) {
            const next: number[] = [];
            for (const currentId of frontier) {
                collected.push(currentId);
                for (const neighborId of this.config.map.hexes[currentId].neighbors) {
                    if (!visited.has(neighborId)) {
                        visited.add(neighborId);
                        next.push(neighborId);
                    }
                }
            }
            frontier = next;
        }
        return collected;
    }

    private hex(id: number): ZCHexState | null {
        return this.state.hexes[id] || null;
    }

    private success(message?: string): ZCActionResult {
        return { ok: true, message };
    }

    private fail(message: string, reason?: ZCActionFailureReason): ZCActionResult {
        return { ok: false, message, reason };
    }

}
