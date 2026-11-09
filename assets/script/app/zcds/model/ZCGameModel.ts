import { HEX_GRID_LOGICAL_ROW_STEP } from '../../../core/hex/HexGridLayout';
import { missileLog } from '../ZCMissileSkillDiagnostics';
import { ZCCaptureSystem } from './systems/ZCCaptureSystem';
import { ZCNeutralFeatureSystem, isZCAwakeMonster } from './systems/ZCNeutralFeatureSystem';
import type { IZCModelServices } from './systems/ZCModelServices';
import { ZCMovementSystem } from './systems/ZCMovementSystem';
import { ZCProjectileContext, ZCProjectileSystem } from './systems/ZCProjectileSystem';
import { ZCTileSystem } from './systems/ZCTileSystem';
import { ZCUnitRegistry } from './systems/ZCUnitRegistry';
import { ZCUnitSystem, type IZCUnitContext } from './systems/ZCUnitSystem';
import { ZCUnitTargeting } from './systems/ZCUnitTargeting';
import type { ZCBattlePresentationEvents, ZCGameRenderFrame, ZCGameRenderHex } from './ZCGameRenderFrame';
import { ZCMapGeometry } from './ZCMapGeometry';
import { captureZCMatchConfig, ZCMatchConfig, ZCPveDefenceConfig } from './ZCMatchConfig';
import { ZCSnapshotCodec } from './ZCSnapshotCodec';
import { zcCombatEffectFadeSecondsOf } from './ZCCombatEffectFlight';

/** 20 Hz 固定逻辑步长；每次最多接受 5 秒，限制后台恢复时的主线程阻塞。 */
export const ZC_SIMULATION_STEP_SECONDS = 0.05;
export const ZC_MAX_TICK_SECONDS = 5;
const EMPTY_CONNECTED_DEVELOPED_HEXES: readonly number[] = [];

import { ZCArtifactSystem } from './systems/ZCArtifactSystem';
import { ZCAttackResolutionSystem, type IZCAttackResolutionContext, type IZCStructureDamageSource } from './systems/ZCAttackResolutionSystem';
import { ZCDamageResolutionSystem, type IZCDamageResolutionContext } from './systems/ZCDamageResolutionSystem';
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
import { ZCPvpTileType } from './ZCPvpTileRules';
import type { ZCSkillRuntimeDefinition } from './ZCSkillRuntime';
import { ZCStatusSystem } from './ZCStatusEffect';

import { ownersForPlayerCount, ZC_OWNER_ORDER, ZCOwner } from './ZCMapConfig';
import type { ZCFaction } from './ZCMapConfig';
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

export const ZC_UNIT_CAP = 100;
/**
 * 上报的帧事件操作码（协议 `CmdBattleFrameInfo.op`）：1=翻格、2=释放技能、4=出生点。
 * （协议还有 3=聊天，客户端没有战斗内聊天，不采集。）
 */
const FRAME_OP_DEVELOP = 1;
const FRAME_OP_SKILL = 2;
const FRAME_OP_SPAWN = 4;
/** 城墙耐久来自本局规则的 wallMaxHp（PVP-全局表）。 */

/** 城墙/建筑占据一格，近战单位可从相邻格继续靠近并攻击其边缘。 */
const STRUCTURE_TARGET_BODY_RADIUS = 80;
/**
 * 弹道扫掠段找结构目标时的采样间隔（逻辑 px）。
 *
 * 格距 36×42、格内切半径约 21 ⇒ 取 8 能保证一帧的飞行段不会被"跳格"漏掉，
 * 而每帧最多也只多算 2~3 个点（`hexIdAt` 是 3×3 邻域查表，代价可控）。
 */
const STRUCTURE_SAMPLE_STEP = 8;
/** 平顶六边形相邻格中心距（视觉步长，与 hexDistance 归一单位一致）。 */
const HEX_STEP = HEX_GRID_LOGICAL_ROW_STEP;
/** 伤害飘字存活时长（秒）。 */
const FLOAT_TEXT_DAMAGE_SECONDS = 0.85;
/**
 * 金币飘字存活时长（秒）。
 *
 * 2026-10-23 由 **1.1 → 0.62**：金币不再是"慢慢往上飘 1.1 秒"，而是「落到地上 → 停一下 →
 * 迅速缩小消失」（曲线见 `ZCGameViewUtil.floatTextGoldDrop`，三段比例 30% / 15% / 55%）。
 * 1.1s 摊到"缩小"这一段只剩 0.6s，读起来是"慢慢缩小"；0.62s 才配得上用户要的"迅速消失"。
 * 三段实秒数：掉落 0.19s、停住 0.09s、缩没 0.34s。
 */
const FLOAT_TEXT_GOLD_SECONDS = 0.62;
/**
 * 建筑产金飘字（主城 / 金矿的周期产出）的存活时长（秒）。
 *
 * 2026-10-27 与击杀掉落**拆开**：掉落是"迅速收掉"（0.62s），产出是"亮一下给你看"
 * —— 金币 icon 与数字要从建筑顶部往上升 50px 再淡出，0.62s 里 50px 会像被弹出去。
 * 0.9s 的实秒分配：上升 0.63s（走完 50px）、之后 0.27s 停在顶端淡出
 * （曲线见 `ZCGameViewUtil.floatTextGoldRise`，上升段 70%、30% 起淡出）。
 */
const FLOAT_TEXT_GOLD_INCOME_SECONDS = 0.9;
/**
 * 受击特效的存活时长（秒）= **表现总时长**。
 *
 * 2026-10-17 山猫「所有职业受击效果总时长固定 0.15s」后重定：**0.8 → 0.15**。
 * 这个数同时决定两件事，两边必须同值：
 *  - **队列保留时长**：`hitFxQueue` 到点就出队（视图层的「已播过」去重记录也跟着清）；
 *  - **拿不到 clip 时的兜底**：prefab 被改坏、连 `defaultClip` 都没有时按它回收。
 *
 * 正常路径的播放时长**由视图层锁定**：`ZCEffectPool.HIT_FX_TARGET_SECONDS = 0.15`
 * 用 `AnimationState.speed = clip.duration / 0.15` 把整段 clip 压进 0.15s
 * （美术真值仍是「帧数/18fps」：射手 0.4444s、法师 0.7222s）。
 *
 * 🔴 **改这个数必须同步改 `HIT_FX_TARGET_SECONDS`**（`tests/zcds-hit-fx.test.ts` 有断言钉住两者）。
 * 历史上这里写过 1.2 / 0.8 两版「留余量」的值 —— 现在两边同值，不需要余量了：
 * 队列比动画长出来的那一段，就是「播完了还杵着」的空窗。
 */
const HIT_FX_SECONDS = 0.15;
/**
 * 出兵落点相对兵营中心的偏移半径（逻辑单位）。
 *
 * 形如「半个格距」：新兵从兵营本体旁边冒出来，但**不压**在兵营图标中心。
 *
 * 为什么不是正好 21（行距 42 的一半）：同列相邻两格的中心正好相距一个行距，
 * 中点在 21 处 —— 那是**本格与同列邻格的公共边**。`ZCMapGeometry.hexIdAt`
 * 先取最近中心再判格内，落在公共边上时两边等距，归属由扫描顺序决定（实测会判给
 * 上邻格）。退 1 个逻辑单位（≈ 2.5 视图像素，肉眼看不出来）即可严格落在本格内：
 * 对角邻格中心距 √(36²+21²) ≈ 41.7，其平分线在 20.84，所以 20 在**任意角度**都安全。
 */
const SPAWN_OFFSET_RADIUS = HEX_GRID_LOGICAL_ROW_STEP / 2 - 1;

/** HUD 只读的塔防进度，不进入战斗快照；恢复时可由配置、时间与存活单位重新推导。 */
export interface ZCDefenceWaveProgress {
    totalWaves: number;
    spawnedWaves: number;
    currentWaveId: number | null;
    nextWaveId: number | null;
    secondsUntilNextWave: number | null;
    aliveEnemies: number;
    /**
     * 当前波（`currentWaveId` 那一波）**剩余的总血量**（蓝湖「BOSS」稿的血条填充）。
     *
     * 「按波聚合」而不是取某只代表怪：设计稿那条红条压着一整波怪，怪死一只条掉一截。
     */
    currentWaveHp: number;
    /** 当前波的**总血量上限**（生成那一刻固定下来，与剩余量同减才不会被"分母也跟着掉"骗到）。 */
    currentWaveMaxHp: number;
    /** 当前敌方服务端生命倍率（HUD 上显示成 `X4` 那类）。 */
    currentWaveHpRate: number;
    /** 当前波用的卡 id（HUD 用它取首领头像与名字）；该波没生成过单位时为 null。 */
    currentWaveCardId: string | null;
    /**
     * 当前波是不是 **BOSS 波**。
     *
     * HUD 那条大血条（`ZCBossPanel`）只在它为真时展示；普通小怪只有头顶血条。
     * 判据：`wave.isBoss`；表里没填时按「最后一波」兜底（口径见 `projectDefenceWaves`）。
     */
    currentWaveIsBoss: boolean;
}

export class ZCGameModel {
    private readonly neutralFeatures: ZCNeutralFeatureSystem;
    private state: ZCSnapshot;
    private debugDraw: { card: ZCDeckCard; remaining: number } | null = null;
    private readonly debugCards = new Map<string, ZCDeckCard>();
    /** 服务端完成战斗接口需要的操作记录，随结算 commands 一起上报。 */
    readonly frameEvents: Array<{ frameId: number; owner: ZCOwner; op: number; params: number[] }> = [];
    private readonly config: ZCMatchConfig;
    private readonly activeOwners: readonly ZCOwner[];
    private readonly geometry: ZCMapGeometry;
    /** 弹道找结构目标时复用（每次调用开头清空），避免每帧每弹道新建 Set。 */
    private readonly structureHexScratch = new Set<number>();
    private readonly captureSystem: ZCCaptureSystem;
    /** 模型能力表：各系统 context 从这里取子集，见 `IZCModelServices`。 */
    private readonly services: IZCModelServices;
    private readonly movement: ZCMovementSystem;
    private readonly economyContext: ZCEconomyContext;
    private readonly definitions: ReadonlyMap<string, ZCUnitDefinition>;
    /** 静态技能/星级修正按阵营隔离并预计算，tick 内不再分配临时对象。 */
    private readonly effectiveDefinitions: Record<ZCOwner, ReadonlyMap<string, ZCUnitDefinition>>;
    /** 2026-10-13 新增 9 种 statId 的累加值（暴击/弹幕/连击/产兵）；不在 `ZCUnitDefinition` 上，按 owner × unitId 索引。 */
    private readonly unitStatPatches: Partial<Record<ZCOwner, ReadonlyMap<string, ZCUnitStatPatch>>> = {};
    private readonly cards: Record<ZCOwner, ReadonlyMap<string, ZCDeckCard>>;
    private readonly skillRuntime: Record<ZCOwner, ReadonlyMap<string, ZCSkillRuntimeDefinition>>;
    private readonly legacySkillRuntime: ZCLegacySkillEffectRuntime;
    private readonly legacyAttributes: Record<ZCOwner, ReadonlyMap<string, Readonly<Record<string, unknown>>>>;
    private readonly units = new ZCUnitRegistry();
    private readonly statusSystem = new ZCStatusSystem();
    private readonly projectileSystem = new ZCProjectileSystem();
    private readonly projectileContext: ZCProjectileContext;
    private readonly targetingContext: ZCTargetingContext;
    private readonly unitTargeting: ZCUnitTargeting;
    private readonly radiusHexes = new Map<string, readonly number[]>();
    private targetHexRevision = -1;
    private readonly targetHexes: ZCHexState[] = [];
    private readonly exposedWalls = new Set<number>();
    private tileStatesDirty = true;
    private topologyRevision = 0;
    private readonly connectedDevelopedCache = new Map<number, readonly number[]>();
    private hexRenderMap: ReadonlyMap<number, ZCGameRenderHex> | null = null;
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
            statPatches: this.unitStatPatches,
            deckBonuses: this.deckBonuses,
            unitById: this.units.byId,
            geometry: this.services.geometry,
            statusSystem: this.services.statusSystem,
            random: this.services.random,
            currentTarget: (unit) => this.unitTargeting.current(unit),
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
     * NPC（本地 AI 席位）翻地块的最小间隔（秒）。
     *
     * 取 `max(rules.enemyAiIntervalSeconds, 关卡 openGrideTime)`：`openGrideTime` 是策划表
     * 「关卡翻地块频率」，**AI 的执行速度不允许超过这个限制**（用户 2026-11-07）。
     * 0 / 缺省 ⇒ 只受全局 AI 间隔约束。
     */
    private readonly aiDevelopIntervalSeconds: number;
    private nextDefenceWaveIndex = 0;
    /**
     * 本局**真正的胜方**（`draw` / 未定 = `null`），由 `ZCOutcomeSystem` 判定后写入。
     *
     * `status` 只有 playing / victory / defeat 三态，而且是以**我方视角**分的 ——
     * 4 人局里"我方出局"可能是 2 号红方赢、也可能是 4 号紫方赢，两者 status 都是 `defeat`。
     * 结算胜利扫场要按**胜方本色**铺地，靠 status 反推就只能一律铺成 2 号色（2026-10-28 用户报的 bug）。
     *
     * ⚠️ 刻意**不写进 `ZCSnapshot`**（与 `floatTexts` / `hitFxs` 同一口径）：它是纯表现用的
     * 一次性结论，混进快照要牵动 `version` 与存档兼容。快照里已经有 `status` + `hexes`，
     * 需要复盘时按同一套规则重算即可。
     */
    private matchWinner: ZCOwner | null = null;
    /**
     * 每波**生成过**的单位 id 与本波总血量上限（键 = 波序，与 `nextDefenceWaveIndex` 同序）。
     *
     * 塔防 HUD 那条「本波剩余 / 本波总」的血条要一个**不会跟着死亡往下掉**的分母 ⇒ 总血量必须在
     * 生成那一刻记下来（`spawnUnit` 里应用了服务端倍率与卡组加成，事后算不回来）。
     * 只记 id 不记对象引用：单位死亡后会被 `removeDeadUnits` 摘掉，活着查不到就按 0 计。
     */
    private readonly defenceWaveLedger: Array<{ ids: number[]; maxHp: number }> = [];
    /** 本局有效伤害统计；重开清零，存档恢复从零统计。 */
    private readonly damageDealt: Record<ZCOwner, number> = { player: 0, enemy: 0, enemy2: 0, enemy3: 0 };
    /** 每方「承受伤害」累计值；只给对局结算页（GameRunAway）读，不进快照。 */
    private readonly damageTaken: Record<ZCOwner, number> = { player: 0, enemy: 0, enemy2: 0, enemy3: 0 };

    /**
     * 建成的兵营「首批兵」延迟生成队列。
     *
     * 开格那拍兵营若已完工，首批兵不能立刻冒出来 —— 地块正播「脉冲 + 缩没」的收场动画，
     * 单位当帧出现会跟它抢镜。卡牌靠 `startedAt` 推到收场之后（有「未开始」态），
     * 单位是实体、没有这种态，只能把生成本身推迟（见 `ZC_CARD_START_SECONDS`）。
     * 建造中完工那条路径（`constructionComplete`）没有激活表现，不经过这里。
     */
    private readonly deferredBarracksSpawns: Array<{ atSeconds: number; hexId: number }> = [];

    private readonly presentation = new ZCBattlePresentationQueue();

    /**
     * `random` 是**整局唯一的随机源**：初始地块分布（`ZCSnapshotCodec.createInitialState`
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
        //  关卡「翻地块频率」只做**限速**：AI 原本 2.8s 一拍，关卡要求 18s 就按 18s 走。
        //  0 表示「够钱就翻」⇒ 不额外压，保持全局节奏。
        const openGrideTime = Number(this.config.openGrideTime);
        this.aiDevelopIntervalSeconds = Number.isFinite(openGrideTime) && openGrideTime > 0
            ? Math.max(this.rules.enemyAiIntervalSeconds, openGrideTime)
            : this.rules.enemyAiIntervalSeconds;
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
            cloneUnit: unit => this.cloneGateUnit(unit),
            spawnBatch: hex => this.spawnFirstBarracksUnit(hex),
            damageUnit: (unit, damage) => { this.damageUnit(unit, damage, { owner: 'neutral', kind: 'building' }); },
            changed: () => { this.tileStatesDirty = true; this.invalidateTerrain(); },
        });
        this.restoreOrCreateState(snapshot);
    }

    // 构造期装配：目标字段均为 readonly，只能在 constructor 内赋值，故此处返回后由调用方装配。
    //
    // ⚠️ 各 context 会重复声明 unitPosition / effectiveDefinition / units 等能力，**不要合并成统一能力表**。
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
            hexStep: HEX_STEP,
            hexIdAt: (x, y) => this.geometry.hexIdAt(x, y),
            unitsInRadius: (hexId, radiusHex) => this.unitsInRadius(hexId, radiusHex),
            unitPosition: this.services.unitPosition,
            damageUnit: this.services.damageUnit,
            ensureSlowStatus: (id, speedPct, duration) => this.ensureMoveSpeedStatus(id, speedPct, duration),
            applyStatus: (unit, id, options) => this.statusSystem.apply(String(unit.id), id, options),
            exportStatusEffects: () => this.statusSystem.exportSnapshot(),
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
            unitById: (id) => this.units.byId.get(id) ?? null,
            unitPosition: this.services.unitPosition,
            hexPosition: (id) => this.config.map.hexes[id],
            preferUnitTargets: (unit) => !!this.pveDefence && unit.owner === ZCOwner.Player,
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
            linger: (projectile) => this.lingerBeam(projectile),
        };
    }

    /**
     * 弹道消失的同一拍，补一条**定格光束**的表现事件（镭射飞龙）。
     *
     * 2026-11-03 需求：「朝着目标发射一条逐渐延长的射线，触碰到第一个敌人时就会停止延长，
     * 造成 1 次伤害，特效缓慢变透消失，0.18s 内消失」。
     *
     * 前两句本来就是既有行为（长度只跟弹头走、命中即回收，所以「不再伸长」是天然的）；
     * 缺的是最后那句 —— 弹道被摘掉的同时整条光柱也消失了，看着像「闪一下」。
     *
     * 这里补的是一条 `beamHold` 事件：`from` / `to` 取**出手点 / 命中点**（弹道被丢弃前
     * 已经被 `ZCProjectileSystem` 钉在接触点上，所以落点精确，不靠猜），
     * 寿命 = 配表里登记的淡出秒数，视图据此按满长画、逐帧压透明度。
     *
     * 不结算任何伤害 —— 伤害在弹道命中那一拍已经结完了；这条事件也不参与任何碰撞，
     * 它只是 `state.combatEvents` 里的一段表演。
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
                durationSeconds: 0.5,
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
                    x: position.x, y: position.y, durationSeconds: FLOAT_TEXT_DAMAGE_SECONDS,
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
                // 🔴 需求 2026-10-15 row12 / row13：「建筑生成金币的倒计时结束也播放一次
                //【建筑生成单位动画】」「基地和金矿建筑生成金币时，也播放一次建筑的抖动效果，
                // 效果和已经做好的【建筑生成单位角色】动画一致」。
                //
                // 挂在这里而不是 `grantGold` 里面：那条私有路径**击杀 / 拆建筑奖励**也走
                //（它们没有"建筑在产金币"这回事，没有建筑该抖）。而 `economyContext.grantGold`
                // 的调用点只有两处、正好就是需求的这两个对象：主城（`context.homeId(owner)`）
                // 与金矿（`mine.id`）—— 见 `ZCEconomySystem.tickIncome`。
                //
                // 金币没真的发出去（金额 <= 0 / 非法）就不抖：与 `grantGold` 内部那道闸同口径。
                if (Number.isFinite(amount) && amount > 0) this.presentation.pushBuildingShake(hexId);
            },
            constructionComplete: (hex) => {
                // 兵营建成出首批兵（数量 = 卡表 cycleBaseValue），产兵倒计时随后才从 0 起跑。
                // ⚠️ 与「开格即完工」那条路同一条推迟口径：建造期短于脉冲段的兵营，
                // 建成那一刻水波纹还没扩完 ⇒ 兵不能顶着波纹站上来。
                this.scheduleFirstBarracksUnit(hex.id);
            },
            unitCount: this.services.unitCount,
            spawnUnit: this.services.spawnUnit,
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
            effectiveDefinition: this.services.effectiveDefinition,
            controlOf: (unit) => this.statusSystem.controlOf(String(unit.id)),
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
            runtimeOf: (unit) => this.skillRuntime[unit.owner]
                .get(`${unit.unitId}:${this.effectiveUnitDefinition(unit).attackProfile.skillId}`),
            //  连发弹走 `sendBurstShot`，不进 `sendAttack`：后者会推进普攻节拍与强化 CD。
            fireBurst: (unit) => ZCAttackResolutionSystem.sendBurstShot(this.state, unit, this.attackResolutionContext),
            //  副轨主动（横扫）：走独立的扇形结算，不推进普攻节拍与强化 CD。
            castSecondary: (unit) => ZCAttackResolutionSystem.castFanSkill(this.state, unit, this.attackResolutionContext),
            //  友军光环半径的「表值 → 世界坐标」换算，与攻击距离 / 区域半径同一口径。
            distanceScale: this.rules.combatDistanceScale,
            //  自身施法的治疗（吃口菠萝 100603）：走与吸血同一条 `healUnit` 实现，
            //  封顶 maxHp、死亡不生效、真回了才推 heal 飘字。
            healUnit: (unit, amount) => ZCStatusResolutionSystem.healUnit(unit, amount, this.statusResolutionContext),
            //  多点打击（戈壁狂箭 100804 / 追踪导弹 101003）：挑人、伤害、溅射、吸血、处决
            //  全在攻击系统里，这里只做转发。
            strike: (unit, options) => ZCAttackResolutionSystem.strikeTargets(
                this.state, unit, options, this.attackResolutionContext),
            //  移形换影（魔术师 103404）：位移交给 `placeAt`，那一份实现会同时更新连续坐标、
            //  朝向与所在格索引；在这里直接改 `freeX/freeY` 会让「显示在哪」与「站在哪一格」分叉。
            blinkTo: (unit, x, y) => { this.movement.placeAt(unit, x, y); },
            //  挑「最近的敌人」必须与 `strikeTargets` 用同一份坐标，否则会挑中却打不到。
            unitPosition: (unit) => this.services.unitPosition(unit),
        };
    }

    private restoreOrCreateState(snapshot?: ZCSnapshot | null): void {
        if (snapshot != null) {
            const restored = ZCSnapshotCodec.decode(snapshot, this.config);
            if (restored.ok === false) throw new Error(`无效对局快照：${restored.errors.join(', ')}`);
            this.state = restored.snapshot;
        } else {
            this.state = ZCSnapshotCodec.createInitialState(this.config, this.random);
        }
        if (this.pveDefence && this.state.nextDefenceWaveIndex !== undefined) {
            this.nextDefenceWaveIndex = this.state.nextDefenceWaveIndex;
        } else if (this.pveDefence && this.state.elapsedSeconds > 0) {
            this.nextDefenceWaveIndex = this.pveDefence.waves.findIndex((wave) => wave.showAtSeconds > this.state.elapsedSeconds + 1e-9);
            if (this.nextDefenceWaveIndex < 0) this.nextDefenceWaveIndex = this.pveDefence.waves.length;
        }
        this.registerDynamicSnapshotStatuses();
        this.statusSystem.restore(this.state.statusEffects);
        this.state.statusEffects = this.statusSystem.exportSnapshot();
        for (const unit of this.state.units) this.units.register(unit);
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

    /** 生成本帧供表现层读取的投影；规则派生值在模型边界一次性计算。 */
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
            // 胜方身份随帧下发：结算扫场要按**胜方本色**铺地。为 null（未定 / 平局）时
            // 视图按 status 兜底，见 `ZCGame.beginVictorySweep`。
            winner: this.matchWinner,
            hexesById: this.hexRenderMap ??= this.buildHexRenderMap(),
            unitDefinitionsById: this.definitions,
            floatTexts: this.presentation.floatTexts,
            hitFxs: this.presentation.hitFxs,
            cardReveals: this.presentation.cardReveals,
            hexActivations: this.presentation.hexActivations,
            neutralRewards: this.presentation.neutralRewards,
        };
    }

    // 逻辑步和同步业务操作才改变这些派生值；不足一步的显示帧只更新插值余量。
    private buildHexRenderMap(): Map<number, ZCGameRenderHex> {
        const hexesById = new Map<number, ZCGameRenderHex>();
        for (const state of this.state.hexes) {
            hexesById.set(state.id, {
                state,
                canDevelop: this.canPlayerDevelop(state.id),
                cooldown: this.buildingCooldown(state.id),
                activation: this.activationOf(state.id),
                connectedDevelopedHexIds: this.connectedDevelopedHexIds(state.id),
            });
        }
        return hexesById;
    }

    /** 一次性表现通知的唯一消费入口；由对局编排层取走后交给动态渲染。 */
    drainPresentationEvents(): ZCBattlePresentationEvents {
        return {
            buildingShakes: this.presentation.drainBuildingShakes(),
            buildingDestructions: this.presentation.drainBuildingDestructions(),
        };
    }

    get terrainRevision(): number { return this.topologyRevision; }
    get mapConfig(): ZCMatchConfig['map'] { return this.config.map; }
    definitionForUnit(id: string): ZCUnitDefinition { return this.unitDefinition(id); }
    /** UI/调试读取本局最终属性；基础目录仍可用 definitionForUnit 查询。 */
    effectiveDefinitionForUnit(owner: ZCOwner, id: string): ZCUnitDefinition {
        return this.effectiveUnitDefinitionFor(owner, id);
    }

    private invalidateTerrain(): void {
        this.hexRenderMap = null;
        this.topologyRevision++;
        this.connectedDevelopedCache.clear();
        this.unitTargeting.invalidateTerrain();
    }

    get artifactChargeFull(): number { return this.rules.artifactChargeFull; }
    get artifactMaxStored(): number { return this.rules.artifactMaxStored; }
    get artifactCooldownDuration(): number { return this.rules.artifactCooldownSeconds; }

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

    /** 当前存活的飘字（Old Client 战斗文本 / 金币增长），视图每帧只读消费。 */
    get floatTexts(): readonly Readonly<ZCFloatText>[] { return this.presentation.floatTexts; }

    /** 当前存活的受击特效（按攻击方职业选 prefab），视图每帧只读消费。 */
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
     *  视图层要按人数分格摆位（传说卡出场横幅竖向均分屏高，见
     *  `ZCGameLegendBannerView.layoutYOf` 与 `bannerHeightOf`），
     *  而 `activeOwners` 本身是私有的 —— 这里只开一个只读出口，不外泄可写引用。
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
     * 给某一方加金币（含飘字）。
     *
     * `kind` 决定**表现走哪条路**（2026-10-27 用户口径：建筑产金与击杀掉落的动画必须区分开）：
     * · `'goldincome'` —— 建筑**产出**（主城 / 金矿）：coin + 数字从建筑顶部升起 50px 并淡出；
     * · `'gold'` —— 击杀 / 拆建筑的**掉落**（缺省）：原地掉落 → 缩小消失，无数字。
     * ⚠️ 缺省值是 `'gold'` 是刻意的：两个"掉落"调用点不该因为漏传参数就变成产金表现，
     *    而产金只有一个调用点（`economyContext.grantGold`），显式写清更不容易接错。
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
        return { x: config.x, y: config.y };
    }

    /** null 表示无时限；塔防只由清空全部波次或我方主城失守结束。 */
    get remainingSeconds(): number | null {
        if (this.pveDefence) return null;
        return Math.max(0, this.state.durationSeconds - this.state.elapsedSeconds);
    }

    /** 塔防 HUD 的当前波次、下波倒计时与剩余敌人数；普通对局返回 null。 */
    get defenceWaveProgress(): Readonly<ZCDefenceWaveProgress> | null {
        if (!this.pveDefence) return null;
        const current = this.nextDefenceWaveIndex > 0
            ? this.pveDefence.waves[this.nextDefenceWaveIndex - 1]
            : null;
        const next = this.pveDefence.waves[this.nextDefenceWaveIndex] ?? null;
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
            currentWaveHpRate: current ? this.config.ownerRates?.enemy?.hpRate ?? 1 : 1,
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

    /** BOSS 波序号；表里有标 `isBoss` 就认它，没有就按「最后一波」。无塔防 ⇒ -1。 */
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
        const bossCardId = defence.waves[index].cardId;
        const ids = this.defenceWaveLedger[index]?.ids ?? [];
        const alive = ids.length
            ? ids.some((id) => {
                const unit = this.units.byId.get(id);
                return !!unit && unit.battleState !== 'dead';
            })
            // ⚠️ 账本只活在内存里，快照恢复后是空的：这时按「场上还有没有 BOSS 波那张卡的怪」兜底，
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
     * 某席位当前占了几格（对局内排行榜用）。
     *
     * ⚠️ 排行榜要按 `2~4` 个席位逐个取数（见 `model/ZCRankBoard`），
     * 而 `playerTerritoryCount` / `enemyTerritoryCount` 只能覆盖"我方"与"敌方合计"，
     * `territoryCount` 本身是私有的 ⇒ 这里开一个**按 owner 取**的只读出口。
     *
     * 与上面两个 getter 的区别：**不合并**。`enemyTerritoryCount` 在 3~4 人局里
     * 是把 enemy2/enemy3 加在一起，排行榜要的是**每一席各自的数**。
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

    /** 建筑建造/工作周期的圆形进度条数据。 */
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

    /** 从指定已开发格出发，返回同阵营六方向相邻的完整连通块；抽空格也算已开发。 */
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
     * 己方格是老口径；**中立格也能开发，且开发即宣告归属**（`developFor` 里落 owner）：
     * 只要它与本方的已开发锚点相邻。等于给「派兵走过去占领」补了一条「花钱买地」的路。
     */
    canDevelopFor(owner: ZCOwner, hexId: number): boolean {
        return ZCTileSystem.canDevelopFor(this.state, this.config.map, hexId, owner);
    }

    /** GM 覆盖本局后续我方抽卡；不改卡组、金币费用或 AI 抽卡。 */
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

    developHex(hexId: number): ZCActionResult {
        if (this.state.status !== 'playing') return this.fail('本局已经结束。');
        const hex = this.hex(hexId);
        if (!hex) return this.fail('地块不存在。');
        if (!this.canPlayerDevelop(hexId)) return this.fail('该地块当前不可开发。');
        // 这一条带结构化原因：棋盘上给不出「钱不够」的可见反馈（那格的图标与价格照旧），
        // 只能由 HUD 的金币栏表达 ⇒ 表现层要看 `reason` 而不是这段中文。
        if (this.goldOf(ZCOwner.Player) < hex.developmentCost) {
            return this.fail(`金币不足，需要 ${hex.developmentCost}。`, 'insufficientGold');
        }
        this.hexRenderMap = null;
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
        this.hexRenderMap = null;
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
        this.state = ZCSnapshotCodec.createInitialState(this.config, this.random);
        this.neutralFeatures.initialize(this.state);
        this.statusSystem.restore(this.state.statusEffects);
        this.state.statusEffects = this.statusSystem.exportSnapshot();
        this.tileStatesDirty = true;
        this.units.clear();
        this.projectileSystem.reset();
        this.captureSystem.reset();
        this.invalidateTerrain();
        this.presentation.reset();
        this.deferredBarracksSpawns.length = 0;
        this.frameEvents.length = 0;
        this.nextDefenceWaveIndex = 0;
        // 胜方也归零：`reset()` 换的是一整局新快照，留着上一局的胜方会让 `renderFrame.winner`
        // 在下一局开局就带脏值（结算前谁赢这件事必须由本局重新判）。
        this.matchWinner = null;
        for (const owner of ZC_OWNER_ORDER) {
            this.damageDealt[owner] = 0;
            this.damageTaken[owner] = 0;
        }
        this.refreshTileStates();
        this.checkOutcome();
    }

    private advance(dt: number): void {
        this.hexRenderMap = null;
        this.captureSystem.beginStep(this.state.units);
        this.neutralFeatures.beginStep(this.state);
        this.state.elapsedSeconds = Math.round((this.state.elapsedSeconds + dt) * 1e9) / 1e9;
        this.flushDeferredBarracksSpawns();
        this.spawnDueDefenceWaves();
        this.state.combatEvents = this.state.combatEvents.filter((event) => (
            this.state.elapsedSeconds < event.startedAt + event.durationSeconds
        ));
        this.presentation.prune(this.state.elapsedSeconds);
        ZCArtifactSystem.tick(this.state, dt);
        ZCStatusResolutionSystem.tick(this.state, dt, this.statusResolutionContext);
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
        this.captureSystem.update(this.state, dt, (hex, owner) => this.captureEmptyTile(hex, owner));
        this.refreshTileStates();
        if (!this.pveDefence) {
            this.state.aiClock = Math.round((this.state.aiClock + dt) * 1e9) / 1e9;
            if (this.state.aiClock >= this.aiDevelopIntervalSeconds) {
                this.state.aiClock -= this.aiDevelopIntervalSeconds;
                this.runEnemyAI();
            }
        }
        this.checkOutcome();
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
            const target = this.unitsInRadius(tower.id, this.rules.towerRangeHex)
                .filter((unit) => unit.battleState !== 'dead' && unit.owner !== tower.owner)
                .sort((a, b) => this.geometry.distance(tower.id, a.sourceHexId) - this.geometry.distance(tower.id, b.sourceHexId)
                    || a.id - b.id)[0];
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
        ZCUnitSystem.update(this.state.units, dt, this.unitContext);
        this.removeDeadUnits();
        this.refreshTileStates();
    }

    /** 旧战斗测试从此入口直接触发出手；测试迁到独立攻击夹具后可删除。 */
    private sendAttack(unit: ZCUnitState): void {
        ZCAttackResolutionSystem.sendAttack(this.state, unit, this.attackResolutionContext);
    }

    /**
     * 弹道这一轮的**结构候选**（墙体 / 建筑），写进 `out`。
     *
     * 2026-11-06 需求：「单位角色子弹攻击如果是只造成一次伤害的，只会伤害接触的单位
     * （角色 / 城墙 / 建筑），不会穿透」。
     *
     * 改前只查**锁定格**，而且 `targetKind === 'unit'` 直接 `null` ⇒ 子弹锁定敌人时
     * 城墙 / 建筑**完全不参与判定**，于是出现了「子弹穿过城墙上打到里面单位」。
     * 现在两路都给：
     *  ① 锁定格：打墙 / 打楼 / 追踪导弹钉在格上的既有口径原样保留；
     *  ② 飞行段经过的每一格：墙体是沿格边围一圈的，所以「进入该格」≈「撞到墙」。
     *
     * **目标所在的格不算障碍**：子弹的终点就是那个单位，它脚下的那一圈墙属于"它的保护壳"，
     * 不是子弹路上的障碍 —— 否则站在城墙 / 主城里的单位在破墙之前完全免疫远程，
     * PVE 防御关的怪（刷在敌方主城格）会直接变成打不到。真正要拦的是**中途**的格。
     *
     * 谁先被碰到交给 `ZCProjectileSystem` 用扫掠 t 比较（与单位同一套连续碰撞），
     * 本方法只负责「路上有哪些结构」，不做圆判定。
     */
    private projectileStructureTargets(
        projectile: Readonly<ZCProjectileState>,
        fromX: number, fromY: number, toX: number, toY: number,
        out: ZCCombatTarget[],
    ): void {
        out.length = 0;
        const seen = this.structureHexScratch;
        seen.clear();
        //  ① 锁定格（子弹原本要打的那一格）—— 与改前逐字一致。
        if (projectile.targetKind !== 'unit') {
            const locked = this.structureTargetOfHex(projectile.targetId, projectile.owner);
            if (locked) { out.push(locked); seen.add(locked.id); }
        }
        //  目标单位的落脚格：跳过（见上面「目标所在的格不算障碍」）。
        let targetHexId = -1;
        if (projectile.targetKind === 'unit') {
            const target = this.units.byId.get(projectile.targetId);
            if (target) targetHexId = this.geometry.hexIdAt(target.freeX, target.freeY) ?? -1;
        }
        //  ② 飞行段扫过的格。段很短（一帧只飞十几个逻辑 px），采样点通常 1~3 个。
        const dx = toX - fromX;
        const dy = toY - fromY;
        const samples = Math.max(1, Math.ceil(Math.hypot(dx, dy) / STRUCTURE_SAMPLE_STEP));
        for (let index = 0; index <= samples; index += 1) {
            const t = index / samples;
            const hexId = this.geometry.hexIdAt(fromX + dx * t, fromY + dy * t);
            if (hexId === null || hexId === targetHexId || seen.has(hexId)) continue;
            seen.add(hexId);
            const target = this.structureTargetOfHex(hexId, projectile.owner);
            if (target) out.push(target);
        }
    }

    /** 单格 → 结构目标；`null` = 这格对这颗子弹没有可打的结构（己方 / 中立 / 无墙无楼）。 */
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

    /** Old repel moves away from the sender by the configured world-space distance. */
    private applyLegacyKnockback(target: ZCUnitState, source: ZCUnitState, rawDistance: number): void {
        const amount = Math.abs(rawDistance) * this.rules.combatDistanceScale;
        if (!(amount > 0)) return;
        const from = this.unitPosition(source);
        const current = this.unitPosition(target);
        let dx = current.x - from.x, dy = current.y - from.y;
        const length = Math.hypot(dx, dy);
        if (length <= 1e-9) {
            dx = Math.cos(source.facingRadians);
            dy = Math.sin(source.facingRadians);
        } else {
            dx /= length;
            dy /= length;
        }
        this.displaceUnit(target, dx * amount, dy * amount);
    }

    /** Forced movement stays on playable cells and invalidates the old path target. */
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

    private damageUnit(target: ZCUnitState, damage: number, source: ZCDamageSource): ZCFloatText | null {
        const result = ZCDamageResolutionSystem.damageUnit(
            this.state, target, damage, source, this.damageResolutionContext);
        if (!result) return null;
        const position = this.unitPosition(target);
        const floatText = this.pushFloatText({
            kind: source.floatTextKind ?? 'damage',
            owner: source.owner === 'neutral' ? target.owner : source.owner,
            value: result.applied + (source.floatTextValueOffset ?? 0),
            x: position.x,
            y: position.y,
            durationSeconds: FLOAT_TEXT_DAMAGE_SECONDS,
        });
        this.pushHitFx(target, result.applied, source, position);
        if (result.killed && source.owner !== 'neutral') {
            this.grantGold(source.owner, this.rules.killUnitGoldReward,
                position.x, position.y, FLOAT_TEXT_GOLD_SECONDS);
        }
        return floatText;
    }

    /**
     * 按**攻击方职业**推一条受击特效（山猫 2026-10-15 拍板）。
     *
     * 三道门，任一不满足就**不播**（都是"少一层表现"，绝不阻塞结算）：
     * ① `applied > 0` —— 伤害被 0 抵消（无敌/已死）时不该闪；
     * ② 攻击方有 `attackerTrait` —— 建筑/ 神器伤害压根没有攻击方单位（`source.unitId` 为空），
     *    职业查不到就不播，**不要**猜一个默认职业；
     * ③ 渲染层有对应 prefab —— 这一条由渲染层自己判（`options.hitFxPrefabs.get(trait)` 为空即跳过），
     *    模型层不感知资源，避免"美术没交就整个特效系统崩"。
     *
     * ⚠️ **坐标取的是打完这一下之后的 `position`**：与飘字同源，两者必须对齐在同一帧同一位置，
     * 否则闪白和飘字会错开半个身位。
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
            // 受击特效跟着**被打的那只**的体型走（2026-10-31）。取不到定义就按 1（= 烘焙原样），
            // 绝不因为查不到而把闪白缩成 0。
            targetScale: this.definitions.get(target.unitId)?.prefabSize ?? 1,
            x: position.x,
            y: position.y,
            durationSeconds: HIT_FX_SECONDS,
        });
    }

    /**
     * 攻击方职业 = 其卡牌 `traits.attack`。
     *
     * 🔴 **两级 id 一定要分清（这里曾是个「一次都不播」的真bug）**：
     *  - `source.unitId` 是**单位实例 id** = `ZCGameModel.state.nextUnitId`（从 1 严格递增）；
     *  - `ZCUnitState.unitId` 才是**卡牌 unitId**（`pvpCard.unitId`，与卡同值，如 68001）；
     *  - `cards[owner]` 的键是**卡牌 id**（`card.id`，同样 68001）。
     * 曾经直接 `cards[owner].get(String(source.unitId))` ⇒ 拿实例 id 去查卡表，**永远查不到**
     * ⇒ 受击特效一次都没播出来（表现为「完全看不到」，不报错）。
     * 正确链路：**实例 id → `units.byId` → 实例的 `cardId` → 卡表 → `traits.attack`**。
     *
     * 为什么要在这里反查而不是在伤害源头直接填：近战 / 投射物 / 区域 / 地面区域四条路径各自
     * 构造 `ZCDamageSource`，只有这里能保证「一条都不漏」。取不到（无 unitId / 实例已被移除 /
     * 卡表没这条）返回 `undefined`，由调用方决定不播。
     */
    private traitOfAttacker(source: ZCDamageSource): ZCAttackTrait | undefined {
        return this.traitOfAttackerUnitId(source.unitId);
    }

    /**
     * 攻击方**实例 id** → 职业。
     *
     * 单独拆一层的原因：单位受击走的是 `ZCDamageSource`（只有 `unitId`），
     * 而城墙 / 建筑的伤害入口 `context.damageWall/damageBuilding` 拿到的是**出手单位的本体**
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
     * 建筑 / 城墙的受击特效（2026-11-06 需求）。
     *
     * 原话：「建筑单位或城墙单位受到攻击时，也要播放对应的职业的受击特效，
     * 比如城墙被战士职业角色攻击，在城墙图片的中心坐标点播放战士受击」。
     *
     * 与打单位那条（{@link pushHitFx}）**同一套判据**：按**攻击方职业**选特效、`applied <= 0` 不播。
     * 三处不同：
     *  ① 攻击方是 `ZCUnitState` 本体（`damageWall/damageBuilding` 传的就是出手单位）而不是
     *    `ZCDamageSource`，所以职业走 {@link traitOfAttackerUnitId}；
     *  ② 锚点 = 该格**格心**（与飘字同源）。「建筑图比格心高 15.65px」属于视图口径，
     *    由渲染层按 `surface` 补，模型不碰视图像素；
     *  ③ `targetScale` 固定 1 —— 结构物没有 `pvpCard.prefabSize` 意义上的「模型缩放」
     *    （建筑外观大小由 `ZCGameHex.prefab` 的 `BuildingIcon` 与卡面图标定），
     *    拿兵种的 `prefabSize` 当房子的大小是错的。
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
            durationSeconds: HIT_FX_SECONDS,
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
        this.exposedWalls.clear();
        for (const hex of this.state.hexes) {
            if (isZCAwakeMonster(hex)) { this.targetHexes.push(hex); continue; }
            const exposed = ZCTileSystem.hasExposedWall(this.state, this.config.map, hex);
            if (exposed) this.exposedWalls.add(hex.id);
            if (exposed || (hex.owner !== 'neutral' && hex.building !== 'none' && hex.hp > 0 && hex.wallHp <= 0)) this.targetHexes.push(hex);
        }
    }

    private damageWall(unit: IZCStructureDamageSource, wall: ZCHexState, damage: number): void {
        const center = this.hexCenter(wall.id);
        const result = ZCDamageResolutionSystem.damageWall(
            wall, damage, unit, this.hasExposedWall(wall), center, this.damageResolutionContext);
        if (!result) return;
        this.pushFloatText({ kind: 'damage', owner: unit.owner, value: result.applied,
            x: center.x, y: center.y, durationSeconds: FLOAT_TEXT_DAMAGE_SECONDS });
        //  城墙受击特效：与飘字同一坐标（格心），职业取攻击方（2026-11-06 需求）。
        this.pushStructureHitFx(unit.id, wall.owner, result.applied, center, 'wall');
        if (result.killed) this.invalidateTerrain();
    }

    private damageBuilding(unit: IZCStructureDamageSource, building: ZCHexState, damage: number): void {
        if (isZCAwakeMonster(building)) {
            if (!Number.isFinite(damage) || damage <= 0) return;
            building.hp = Math.max(0, building.hp - damage);
            if (building.hp === 0) {
                building.neutralFeature.claimed = true;
                building.neutralResourceId = null;
                const center = this.config.map.hexes[building.id];
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
        const center = this.hexCenter(building.id);
        this.pushFloatText({ kind: 'damage', owner: unit.owner, value: result.applied,
            x: center.x, y: center.y, durationSeconds: FLOAT_TEXT_DAMAGE_SECONDS });
        //  建筑受击特效：锚点仍是格心，视图按 `surface = 'building'` 抬到建筑图中心
        //  （`ZCGameHex.prefab` 的 `BuildingIcon` 在 +15.65px）—— 2026-11-06 需求。
        //  `defender` 必须在伤害结算**之前**抓（拆掉那一拍 `building.owner` 已被改成攻方）。
        this.pushStructureHitFx(unit.id, defender, result.applied, center, 'building');
        if (!result.killed) return;
        if (summonsDefenceBoss) this.spawnDueDefenceWaves(true);
        if (!this.pveDefence && this.developedCount(unit.owner) === 0) building.owner = 'neutral';
        if (!this.pveDefence && defender !== 'neutral' && this.developedCount(defender) === 0) {
            // 最后一座建筑消失后，未被攻方占领的空地解除归属；废墟保留废墟状态。
            for (const hex of this.state.hexes) {
                if (hex.owner === defender) {
                    hex.owner = 'neutral';
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

    /** 选点结束、正式模型建立后记录各方最终出生格；重复通知不重复入队。 */
    recordSpawnSelection(): void {
        for (const owner of this.activeOwners) {
            if (this.frameEvents.some((event) => event.op === FRAME_OP_SPAWN && event.owner === owner)) continue;
            this.pushFrameEvent(owner, FRAME_OP_SPAWN, [this.homeId(owner)]);
        }
    }

    /**
     * 记一条战斗帧事件（随 `CmdFinishBattleReqMsg.commands` 上报，供服务端校验 / 回放）。
     *
     * `op` 口径由协议 `CmdBattleFrameInfo` 定死：**1=翻格（`params`=[格子 id]）、
     * 2=释放技能（`params`=[技能位置]，无位置就不传）、4=出生点（`params`=[格子 id]）**。
     * 保留操作方 owner，结算时由控制器映射到开战回包的战斗单元 unitId。
     * `frameId` 沿用毫秒时间戳的既有口径（协议注释写「帧 id」，但那会改变已经在上报的格式，未动）。
     */
    private pushFrameEvent(owner: ZCOwner, op: number, params: number[]): void {
        this.frameEvents.push({ frameId: Math.round(this.state.elapsedSeconds * 1000), owner, op, params });
    }

    private developFor(owner: ZCOwner, hex: ZCHexState): ZCActionResult {
        this.pushFrameEvent(owner, FRAME_OP_DEVELOP, [hex.id]);
        const forced = owner === ZCOwner.Player ? this.debugDraw : null;
        const result = ZCDevelopmentSystem.develop(
            this.state, owner, hex, this.deckFor(owner), this.config, this.random, this.developmentContext, forced?.card ?? null);
        if (forced && result.card === forced.card && result.building) {
            forced.remaining -= 1;
            if (forced.remaining === 0) this.debugDraw = null;
        }
        this.tileStatesDirty = true;
        this.invalidateTerrain();
        // 收场表现属于「开发这件事本身」，与**抽到什么无关**：
        // 全类型随机格（问号，25 费）的 `empty` 权重是 0.7 ⇒ 七成是空手。
        // 把 `pushHexActivation` 留在 `!result.card` / `!result.building` 两个 return
        // 之后，这些格子点下去既不收场也不出卡，观感就是「点了没反应」。
        // 口径：`develop` 一旦置真 `developmentResolved`（这次开发真的落地了）就必须播。
        // `hasCardReveal` 决定收场段之后怎么接 —— 没有卡牌时视图把「整格隐藏」换成原地缩回来
        // （隐藏段是给卡牌独占视线的，没卡牌就会露出棋盘底）。
        // 脉冲染色跟着「抽到的卡」走（2026-10-19）：没抽到卡时传 0（视图按绿处理）。
        // ⚠️ 抽到卡但建不上（`!result.building`）时仍有品阶 —— 用户要的是「对应获得的卡牌品阶」，
        // 与 `hasCardReveal`（有没有卡牌揭示）不是同一个判据。
        this.pushHexActivation(hex.id, result.building !== null, result.card ? rarityRank(result.card.rarity) : 0);
        if (!result.card) {
            this.refreshTileStates();
            return this.success();
        }
        const card = result.card;
        if (!result.building) {
            this.refreshTileStates();
            return this.success();
        }
        const building = result.building;
        const tier = result.tier;
        this.pushCardReveal({
            owner,
            hexId: hex.id,
            cardId: card.id,
            building,
            tier,
            cardName: card.name,
            unitId: card.unitId ?? null,
            luckText: result.tileType === ZCPvpTileType.AllRandom ? luckTextOfTier(tier) : '',
        });
        this.refreshTileStates();
        // 首批兵推到「翻面段」播完再出（见 `deferredBarracksSpawns`）。
        if (hex.constructionRemainingSeconds <= 0) this.scheduleFirstBarracksUnit(hex.id);
        return this.success(`抽到${rarityDisplayName(card.rarity)}卡【${card.name}】`);
    }

    private spawnFirstBarracksUnit(hex: ZCHexState): void {
        ZCEconomySystem.spawnFirstBarracksUnit(hex, this.economyContext);
    }

    /**
     * 开格后的兵营首批兵：**推迟到点击动画全部播完再生成**（`ZC_CARD_START_SECONDS`
     * = 脉冲 ∥ 缩没的合段 = 0.7s，也就是卡牌弹出的那一刻）。
     *
     * 开格这拍三件事同源 —— `pushCardReveal` / `pushHexActivation` / 首批兵。
     * 前两者靠 `startedAt` 落在未来就能「先不可见」，单位不行（它是实体），
     * 所以只能推迟生成本身，否则单位会在水波纹还在扩、地块还在缩的时候就站在格子上。
     *
     * 到这里的**两条路**观感要求一样（缩没段地块小到 0.1，兵会看着像浮在半空）：
     *  - **开格即完工**（绝大多数兵营卡，`developHex` 里判 `constructionRemainingSeconds <= 0`）：
     *    激活刚刚开始 ⇒ 剩余就是整段点击动画；
     *  - **建造中建成**（下面的 `constructionComplete` 回调）：建造期**短于**点击动画的兵营
     *    会在水波还没扩完时就落地 ⇒ 同样要推迟，且只推迟**剩下的那一小段**。
     *
     * 🔴 锚点必须是 `ZC_CARD_START_SECONDS`：单位是**独立节点**、不随格子的「整格隐藏」一起隐藏，
     * 唯一能盖住它的东西是随后弹出的卡牌 —— 所以必须等到卡牌真正弹出的那一刻再出兵。
     *
     * 建造期长于点击动画的兵营算出 0 ⇒ 立即出兵（不该因为别处的表现多等一轮）。
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

    /** 本格激活的**点击动画（脉冲 ∥ 缩没）**还剩多少秒（不在激活期 / 已播完 ⇒ 0）。 */
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

    /** 生成一个单位；拆城触发的末波 Boss 可越过兵力上限，避免跳波后 Boss 被吞掉。 */
    private spawnUnit(
        owner: ZCOwner,
        card: ZCDeckCard,
        tier: number,
        hexId: number,
        ignoreUnitCap = false,
    ): ZCUnitState | null {
        if (!card.unitId || (!ignoreUnitCap && this.unitCount(owner) >= this.rules.unitCapPerSide)) return null;
        const definition = this.effectiveUnitDefinitionFor(owner, card.unitId);
        const spawnCenter = this.hexCenter(hexId);
        // 落点：离兵营中心约半个格距、方向随机 —— 新兵不会和兵营图标叠在一起。
        // 角度取本局随机源（与抽卡同一个），保证同一种子下表现可复现。
        // 半径为什么略小于半格，见 `SPAWN_OFFSET_RADIUS`。
        const spawnAngle = this.random() * Math.PI * 2;
        const spawnX = spawnCenter.x + Math.cos(spawnAngle) * SPAWN_OFFSET_RADIUS;
        const spawnY = spawnCenter.y + Math.sin(spawnAngle) * SPAWN_OFFSET_RADIUS;
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
            facingRadians: this.facingTowardGoal(owner, hexId),
            deathRemoveAt: 0,
            marchAngle: null,
            freeX: spawnX,
            freeY: spawnY,
            completedAttackCount: 0,
        };
        this.units.register(unit);
        this.state.units.push(unit);
        //  诊断⑥：镭射飞龙真的上场了没。没有这一行 ⇒ 后面所有 `[模型]` 日志都不会出现，
        //  与「技能没触发」是两件事（这张卡是兵营卡，要先翻格建出来才会产兵）。
        if (unit.unitId === '68010') {
            missileLog('模型', `镭射飞龙上场：#${unit.id} owner=${unit.owner} hp=${maxHp}`
                + ` 位置=(${spawnX.toFixed(1)},${spawnY.toFixed(1)}) t=${this.state.elapsedSeconds.toFixed(1)}s`);
        }
        // 同上：单位出生不是协议里的「操作」（这里原本误报成 op=1=翻格，params 也不是格子 id）。
        this.state.nextUnitId += 1;
        return unit;
    }

    private cloneGateUnit(source: ZCUnitState): ZCUnitState | void {
        const card = findCatalogCard(source.cardId);
        if (!card) return;
        const clone = this.spawnUnit(source.owner, card, source.tier, source.sourceHexId);
        if (!clone) return;
        const definition = source.inheritedStats ?? this.effectiveUnitDefinitionFor(source.owner, source.unitId);
        clone.maxHp = clone.hp = source.maxHp;
        clone.attackMultiplier = source.attackMultiplier;
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
        };
        return clone;
    }

    /** 到配置时间或已出怪物全部被击退时，在敌方主城生成下一波；首波只按时间。 */
    private spawnDueDefenceWaves(forceLastWave = false): void {
        if (!this.pveDefence) return;
        if (forceLastWave) {
            if (this.nextDefenceWaveIndex >= this.pveDefence.waves.length) return;
            // 拆城直接挑战末波；已在场的怪物保留，尚未生成的中间波不再生成。
            this.nextDefenceWaveIndex = this.pveDefence.waves.length - 1;
        }
        while (this.nextDefenceWaveIndex < this.pveDefence.waves.length) {
            const wave = this.pveDefence.waves[this.nextDefenceWaveIndex];
            if (!forceLastWave && wave.showAtSeconds > this.state.elapsedSeconds + 1e-9) {
                if (this.nextDefenceWaveIndex === 0 || this.state.units.some((unit) => (
                    unit.owner !== ZCOwner.Player && unit.battleState !== 'dead'
                ))) return;
            }
            this.nextDefenceWaveIndex += 1;
            // 提前出怪后不能再按 elapsedSeconds 推导进度，存档必须记下实际波序。
            this.state.nextDefenceWaveIndex = this.nextDefenceWaveIndex;
            // 先占位再生成：波序与账本下标必须**逐位对齐**，中途 `continue` 也不能错位。
            const ledger = { ids: [] as number[], maxHp: 0 };
            this.defenceWaveLedger[this.nextDefenceWaveIndex - 1] = ledger;
            const card = this.cardById(ZCOwner.Enemy, wave.cardId);
            if (!card?.unitId) {
                continue;
            }
            const count = Math.max(0, Math.floor(wave.monsterCount));
            for (let index = 0; index < count; index += 1) {
                const unit = this.spawnUnit(ZCOwner.Enemy, card, Math.max(1, Math.floor(wave.tier)),
                    this.homeId(ZCOwner.Enemy), forceLastWave);
                if (!unit) continue;
                ledger.ids.push(unit.id);
                ledger.maxHp += Math.max(0, unit.maxHp);
            }
        }
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
        const definition = this.effectiveUnitDefinitionFor(unit.owner, unit.unitId);
        const original = unit.inheritedStats ? { ...definition, ...unit.inheritedStats } : definition;
        const base = unit.gateSize ? {
            ...original,
            moveSpeed: original.moveSpeed * (unit.gateMoveMultiplier ?? 1),
            attackInterval: original.attackInterval / (unit.gateAttackSpeedMultiplier ?? 1),
            attack: original.attack * (unit.gateDamageMultiplier ?? 1),
            prefabSize: original.prefabSize * (unit.gateScale ?? 1),
        } : original;
        const mods = this.statusSystem.statModsOf(String(unit.id));
        if (!Object.keys(mods).length) return base;
        const attackDuration = base.attackDuration;
        return {
            ...base,
            attack: Math.max(0, (base.attack + (mods.attackFlat ?? 0)) * Math.max(0, 1 + (mods.attackPct ?? 0) / 100)),
            maxHp: Math.max(1, base.maxHp * Math.max(0.01, 1 + (mods.maxHpPct ?? 0) / 100)),
            moveSpeed: Math.max(0, base.moveSpeed * Math.max(0, 1 + (mods.moveSpeedPct ?? 0) / 100)),
            attackRange: Math.max(0, base.attackRange * Math.max(0, 1 + (mods.attackRangePct ?? 0) / 100)),
            attackInterval: Math.max(0.01, base.attackInterval * Math.max(0.01, 1 - (mods.attackIntervalPct ?? 0) / 100)),
            attackHitTime: Math.min(attackDuration, base.attackHitTime),
        };
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
                this.unitTargeting.removeUnit(unit.id);
            } else {
                this.state.units[write++] = unit;
            }
        }
        this.state.units.length = write;
        this.state.statusEffects = this.statusSystem.exportSnapshot();
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

    /** 从当前位置选择最近的仍在局内的敌方主城，供 3/4 人单位自由行军。 */
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
        // ⚠️ 必须**在 refresh 之后**判断：邻接关系依赖「上一轮算出来的 state」，
        //    先判就会慢一拍（第一片资源点要等到下一次脏刷新才入袋）。
        this.claimAdjacentNeutralResources();
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
     * 中立资源奖励入袋的表现通知入口（`onNeutralReward` 的落地实现）。
     *
     * 按需求把「哪种资源播什么效果」收敛在模型这一处：
     *   · 金矿 / 兵营 → **只播「建筑被开发」激活**（见 `claimAdjacentNeutralResources`），
     *     不播金币飞行 —— 需求口径「金矿沿用建筑被开发效果」；
     *   · 宝箱 / 金币类 → 入队金币飞行事件（视图播「飞向金币栏 + 上飘 +N」）；
     *   · 神器充能 → 入队神器飞行事件（视图播「飞向神器栏」）；
     *   · 兵团 → 直接产兵、走出生表现，无飞行事件。
     * 其余（无实际入账金额）一律不入队，避免空特效。
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

    /** 本局胜方（`draw` / 未定 = `null`）。结算扫场用它上色，见 `matchWinner` 的说明。 */
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
        return this.state.hexes.filter((hex) => hex.owner === owner).length;
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

    /** 收集以 hexId 为中心、格距不超过 radiusHex 的所有单位（含中心格），供索敌/塔/溅射邻域查询。 */
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
