import { captureZCMatchConfig, ZCMatchConfig, ZCPveDefenceConfig } from './ZCMatchConfig';
import { ZCSnapshotCodec } from './ZCSnapshotCodec';
import type { ZCBattlePresentationEvents, ZCGameRenderFrame, ZCGameRenderHex } from './ZCGameRenderFrame';
import { ZCMapGeometry } from './ZCMapGeometry';
import { HEX_GRID_LOGICAL_ROW_STEP } from '../../../core/hex/HexGridLayout';
import { ZCUnitRegistry } from './systems/ZCUnitRegistry';
import { ZCUnitSystem, type IZCUnitContext } from './systems/ZCUnitSystem';
import { ZCUnitTargeting } from './systems/ZCUnitTargeting';
import { ZCMovementSystem } from './systems/ZCMovementSystem';
import { ZCTileSystem } from './systems/ZCTileSystem';
import { ZCProjectileSystem, ZCProjectileContext } from './systems/ZCProjectileSystem';
import { ZCCaptureSystem } from './systems/ZCCaptureSystem';

/** 20 Hz 固定逻辑步长；每次最多接受 5 秒，限制后台恢复时的主线程阻塞。 */
export const ZC_SIMULATION_STEP_SECONDS = 0.05;
export const ZC_MAX_TICK_SECONDS = 5;
const EMPTY_CONNECTED_DEVELOPED_HEXES: readonly number[] = [];

import {
    cardCounterMultiplier,
    luckTextOfTier,
    ZC_CARD_TYPE_NAMES,
    ZC_RARITY_RANK,
    ZCAttackTrait,
    ZCDeckBonuses,
    ZCDeckCard,
    ZCUnitDefinition,
} from './ZCCombatCatalog';
import type { ZCUnitStatPatch } from './ZCModifierRuntime';
import { ZCPvpTileType } from './ZCPvpTileRules';
import type { ZCRuntimeRules } from './ZCGameRuntimeConfig';
import { ZCArtifactSystem } from './systems/ZCArtifactSystem';
import { ZCAttackResolutionSystem, type IZCAttackResolutionContext } from './systems/ZCAttackResolutionSystem';
import { ZCLegacyCombatSystem, type IZCLegacyCombatContext } from './systems/ZCLegacyCombatSystem';
import {
    ZCBattlePresentationQueue, ZC_CARD_START_SECONDS, type IZCCardRevealOptions, type IZCFloatTextOptions,
} from './ZCBattlePresentationQueue';
import { ZCOutcomeSystem, type IZCOutcomeContext } from './systems/ZCOutcomeSystem';
import { ZCGroundZoneSystem, type IZCGroundZoneContext } from './systems/ZCGroundZoneSystem';
import { ZCStatusResolutionSystem, type IZCStatusResolutionContext } from './systems/ZCStatusResolutionSystem';
import { ZCDamageResolutionSystem, type IZCDamageResolutionContext } from './systems/ZCDamageResolutionSystem';
import { ZCDevelopmentSystem, type IZCDevelopmentContext } from './systems/ZCDevelopmentSystem';
import { ZCEconomySystem, ZCEconomyContext } from './systems/ZCEconomySystem';
import type { ZCTargetingContext } from './systems/ZCTargetingSystem';
import { ZCStatusSystem } from './ZCStatusEffect';
import type { ZCSkillRuntimeDefinition } from './ZCSkillRuntime';
import { compileZCMatchRuntime } from './ZCMatchRuntimeCompiler';
import {
    ZCLegacySkillEffectRuntime,
    type ZCLegacyBuffApplication,
    type ZCLegacySkillEvaluation,
} from './ZCLegacySkillEffect';

import { ownersForPlayerCount, ZC_OWNER_ORDER, type ZCOwner } from './ZCMapConfig';
import { ZCNeutralResourceId, type ZCNeutralResourceReward } from './ZCNeutralResourceReward';
export {
    configureZCMap,
    defaultZCSectionAt,
    getZCMapOwner,
    getZCMapSection,
    getZCLocalPlayerCountOverride,
    isRandomMapCandidate,
    ownerForSection,
    ownersForPlayerCount,
    ZC_OWNER_ORDER,
    ZC_DEFAULT_HOME_MIN_DISTANCE,
    ZC_DEFAULT_RESOURCE_MIN_DISTANCE,
    ZC_DEPTH_ORDER,
    ZC_DEPTH_TENDENCY,
    ZC_ENEMY_HOME_ID,
    ZC_HEX_CONFIG,
    ZC_INITIAL_TERRITORY,
    ZC_MAP_ART,
    ZC_MAP_CITY_MODE,
    ZC_MAP_COLUMNS,
    ZC_MAP_HOMES,
    ZC_MAP_ID,
    ZC_MAP_PLAYER_COUNT,
    ZC_MAP_REGIONS,
    ZC_MAP_HOME_CANDIDATES,
    ZC_MAP_RESOURCE_POINTS,
    ZC_MAP_ROWS,
    ZC_MAP_SECTIONS,
    ZC_MAP_SPACING,
    ZC_PLAYER_HOME_ID,
    ZC_RESOURCE_MIN_DISTANCE_FLOOR,
    ZC_TENDENCY_TEXT,
} from './ZCMapConfig';
export type {
    ZCCityMode, ZCDepth, ZCFaction, ZCHexConfig, ZCMapArt, ZCMapHome, ZCMapLayout,
    ZCMapRegion, ZCMapHomeCandidates, ZCMapResolvedResource, ZCMapResourcePoint, ZCMapSpacing, ZCOwner, ZCPlayerCount, ZCSection, ZCTendency,
} from './ZCMapConfig';

import type {
    DeepReadonly,
    ZCDamageSource,
    ZCActionFailureReason,
    ZCActionResult,
    ZCBuildingCooldownState,
    ZCBuildingType,
    ZCBuildingShake,
    ZCCardReveal,
    ZCCombatTarget,
    ZCFloatText,
    ZCFloatTextKind,
    ZCGameStatus,
    ZCHexActivation,
    ZCHexState,
    ZCHitFx,
    ZCScoreBreakdown,
    ZCSnapshot,
    ZCUnitState,
    ZCProjectileState,
} from './ZCGameTypes';
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
    ZCHexState,
    ZCScoreBreakdown,
    ZCSnapshot,
    ZCTileState,
    ZCUnitBattleState,
    ZCUnitState,
    ZCProjectileState,
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
/** 平顶六边形相邻格中心距（视觉步长，与 hexDistance 归一单位一致）。 */
const HEX_STEP = HEX_GRID_LOGICAL_ROW_STEP;
/** 伤害飘字存活时长（秒）。金币飘字稍长，便于看清收入节奏。 */
const FLOAT_TEXT_DAMAGE_SECONDS = 0.85;
const FLOAT_TEXT_GOLD_SECONDS = 1.1;
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
    /** 当前波的血量倍率（塔防波的 `hpRate`，HUD 上显示成 `X4` 那类）。 */
    currentWaveHpRate: number;
    /** 当前波用的卡 id（HUD 用它取首领头像与名字）；该波没生成过单位时为 null。 */
    currentWaveCardId: string | null;
}

export class ZCGameModel {
    private state: ZCSnapshot;
    /** 服务端完成战斗接口需要的操作记录，随结算 commands 一起上报。 */
    readonly frameEvents: Array<{ frameId: number; unitId: number; op: number; params: number[] }> = [];
    private readonly config: ZCMatchConfig;
    private readonly activeOwners: readonly ZCOwner[];
    private readonly geometry: ZCMapGeometry;
    private readonly captureSystem: ZCCaptureSystem;
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
    private readonly unitContext: IZCUnitContext;
    private readonly groundZoneContext: IZCGroundZoneContext = {
        hexStep: HEX_STEP,
        hexIdAt: (x, y) => this.geometry.hexIdAt(x, y),
        unitsInRadius: (hexId, radiusHex) => this.unitsInRadius(hexId, radiusHex),
        unitPosition: (unit) => this.unitPosition(unit),
        damageUnit: (unit, damage, source) => this.damageUnit(unit, damage, source),
        ensureSlowStatus: (id, speedPct, duration) => this.ensureMoveSpeedStatus(id, speedPct, duration),
        applyStatus: (unit, id, options) => this.statusSystem.apply(String(unit.id), id, options),
        exportStatusEffects: () => this.statusSystem.exportSnapshot(),
    };
    private readonly attackResolutionContext: IZCAttackResolutionContext;
    private readonly statusResolutionContext: IZCStatusResolutionContext;
    private readonly damageResolutionContext: IZCDamageResolutionContext;
    private readonly developmentContext: IZCDevelopmentContext;
    private createAttackResolutionContext(): IZCAttackResolutionContext {
        return {
            rules: this.rules,
            counters: this.config.counters,
            cards: this.cards,
            skillRuntime: this.skillRuntime,
            statPatches: this.unitStatPatches,
            deckBonuses: this.deckBonuses,
            unitById: this.units.byId,
            geometry: this.geometry,
            statusSystem: this.statusSystem,
            random: this.random,
            currentTarget: (unit) => this.unitTargeting.current(unit),
            effectiveUnitDefinition: (unit) => this.effectiveUnitDefinition(unit),
            evaluateLegacySkill: (unit, keys, target, critical) => this.evaluateLegacySkill(unit, keys, target, critical),
            applyLegacySelfBuffs: (unit, buffs) => this.applyLegacySelfBuffs(unit, buffs),
            unitPosition: (unit) => this.unitPosition(unit),
            damageUnit: (unit, damage, source) => this.damageUnit(unit, damage, source),
            tryExecuteUnit: (unit, chance, owner, sourceId, text) => this.tryExecuteUnit(unit, chance, owner, sourceId, text),
            applyHitStatus: (unit, id, sourceId) => this.applyHitStatus(unit, id, sourceId),
            applyLegacyBuffs: (unit, buffs, sourceId) => this.applyLegacyBuffs(unit, buffs, sourceId),
            damageWall: (source, wall, damage) => this.damageWall(source, wall, damage),
            damageBuilding: (source, building, damage) => this.damageBuilding(source, building, damage),
            unitsInRadius: (id, radius) => this.unitsInRadius(id, radius),
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
    private nextDefenceWaveIndex = 0;
    /**
     * 每波**生成过**的单位 id 与本波总血量上限（键 = 波序，与 `nextDefenceWaveIndex` 同序）。
     *
     * 塔防 HUD 那条「本波剩余 / 本波总」的血条要一个**不会跟着死亡往下掉**的分母 ⇒ 总血量必须在
     * 生成那一刻记下来（`spawnUnit` 里应用了关卡倍率与波次 `hpRate`，事后算不回来）。
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
        this.legacySkillRuntime = new ZCLegacySkillEffectRuntime(this.config.legacySkillEffects!);
        this.activeOwners = ownersForPlayerCount(this.config.map.playerCount ?? 2);
        for (const definition of this.config.statusDefinitions ?? []) this.statusSystem.register(definition);
        this.rules = this.config.rules;
        this.pveDefence = this.config.pveDefence?.waves.length ? this.config.pveDefence : null;
        this.outcomeContext = {
            activeOwners: this.activeOwners,
            pveDefence: this.pveDefence,
            homeId: (owner) => this.homeId(owner),
        };
        this.geometry = new ZCMapGeometry(this.config.map);
        this.captureSystem = new ZCCaptureSystem(this.geometry, this.config.map, this.rules);
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
        this.registerRuntimeStatuses();
        this.economyContext = this.buildEconomyContext();
        this.movement = this.buildMovement();
        this.unitTargeting = this.buildUnitTargeting();
        this.unitContext = this.buildUnitContext();
        this.restoreOrCreateState(snapshot);
    }

    // 构造期装配：目标字段均为 readonly，只能在 constructor 内赋值，故此处返回后由调用方装配。

    private buildTargetingContext(): ZCTargetingContext {
        const model = this;
        return {
            get now() { return model.state.elapsedSeconds; },
            get units() { return model.state.units; },
            get hexes() { model.refreshTargetHexes(); return model.targetHexes; },
            unitById: (id) => this.units.byId.get(id) ?? null,
            unitPosition: (candidate, result) => this.unitPosition(candidate, result),
            hexPosition: (id) => this.config.map.hexes[id],
            effectiveDefinition: (candidate) => this.effectiveUnitDefinition(candidate),
            hasExposedWall: (hex) => this.hasExposedWall(hex),
        };
    }

    private buildProjectileContext(): ZCProjectileContext {
        const model = this;
        return {
            get now() { return model.state.elapsedSeconds; },
            get units() { return model.state.units; },
            distanceScale: this.rules.combatDistanceScale,
            effectiveDefinition: (unit) => this.effectiveUnitDefinition(unit),
            structureTarget: (projectile) => this.projectileStructureTarget(projectile),
            hit: (projectile, target) => this.resolveProjectileHit(projectile, target),
        };
    }

    private buildDamageResolutionContext(): IZCDamageResolutionContext {
        return {
            statusSystem: this.statusSystem,
            units: this.units,
            damageDealt: this.damageDealt,
            damageTaken: this.damageTaken,
        };
    }

    private buildDevelopmentContext(): IZCDevelopmentContext {
        return {
            rules: this.rules,
            goldOf: (owner) => this.goldOf(owner),
            setGold: (owner, amount) => this.setGold(owner, amount),
            unitCount: (owner) => this.unitCount(owner),
            spawnUnit: (owner, card, tier, hexId) => this.spawnUnit(owner, card, tier, hexId),
            onNeutralReward: (hexId, resourceId, owner, reward) => {
                this.pushNeutralReward(hexId, resourceId, owner, reward);
            },
        };
    }

    private buildStatusResolutionContext(): IZCStatusResolutionContext {
        return {
            statusSystem: this.statusSystem,
            unitById: this.units.byId,
            owners: this.activeOwners,
            combatDistanceScale: this.rules.combatDistanceScale,
            effectiveUnitDefinition: (unit) => this.effectiveUnitDefinition(unit),
            unitPosition: (unit) => this.unitPosition(unit),
            displaceUnit: (unit, dx, dy) => this.displaceUnit(unit, dx, dy),
            damageUnit: (unit, damage, source) => this.damageUnit(unit, damage, source),
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
            rules: this.rules, owners: this.activeOwners,
            homeId: (owner) => this.homeId(owner),
            bonuses: (owner) => this.bonusesFor(owner),
            cardById: (owner, id) => this.cardById(owner, id),
            cycleSeconds: (hex, card) => this.buildingCycleSeconds(hex, card),
            grantGold: (owner, amount, hexId) => {
                const center = this.hexCenter(hexId);
                this.grantGold(owner, amount, center.x, center.y, FLOAT_TEXT_GOLD_SECONDS);
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
            unitCount: (owner) => this.unitCount(owner),
            spawnUnit: (owner, card, tier, hexId) => this.spawnUnit(owner, card, tier, hexId),
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
            effectiveDefinition: (unit) => this.effectiveUnitDefinition(unit),
            bonuses: (owner) => this.bonusesFor(owner),
            goalHomeId: (owner, fromHexId) => this.goalHomeId(owner, fromHexId),
            frozenSeconds: () => this.state.enemyFrozenSeconds,
            hex: (id) => this.hex(id), hasExposedWall: (hex) => this.hasExposedWall(hex),
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
            effectiveDefinition: (unit) => this.effectiveUnitDefinition(unit),
            unitPosition: (unit) => this.unitPosition(unit),
            hex: (id) => this.hex(id),
            hasExposedWall: (hex) => this.hasExposedWall(hex),
        });
    }

    private buildUnitContext(): IZCUnitContext {
        return {
            now: () => this.state.elapsedSeconds,
            effectiveDefinition: (unit) => this.effectiveUnitDefinition(unit),
            controlOf: (unit) => this.statusSystem.controlOf(String(unit.id)),
            random: this.random,
            unitById: this.units.byId,
            targeting: this.unitTargeting,
            movement: this.movement,
            sendAttack: (unit) => ZCAttackResolutionSystem.sendAttack(this.state, unit, this.attackResolutionContext),
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
        if (this.pveDefence && this.state.elapsedSeconds > 0) {
            this.nextDefenceWaveIndex = this.pveDefence.waves.findIndex((wave) => wave.showAtSeconds > this.state.elapsedSeconds + 1e-9);
            if (this.nextDefenceWaveIndex < 0) this.nextDefenceWaveIndex = this.pveDefence.waves.length;
        }
        this.registerDynamicSnapshotStatuses();
        this.statusSystem.restore(this.state.statusEffects);
        this.state.statusEffects = this.statusSystem.exportSnapshot();
        for (const unit of this.state.units) this.units.register(unit);
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
            hexesById: this.buildHexRenderMap(),
            unitDefinitionsById: this.buildUnitDefinitionMap(),
            floatTexts: this.presentation.floatTexts,
            hitFxs: this.presentation.hitFxs,
            cardReveals: this.presentation.cardReveals,
            hexActivations: this.presentation.hexActivations,
            neutralRewards: this.presentation.neutralRewards,
        };
    }

    // 每帧渲染帧的两张查找表：格子状态与单位定义。逐格/逐兵查询都在这两张表上做，
    // 所以必须每帧重建（`canDevelop` / `cooldown` / `activation` 都随 tick 变化）。
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

    // 按 unitId 去重：同一兵种场上多个单位只查一次定义表。
    private buildUnitDefinitionMap(): Map<string, ZCUnitDefinition> {
        const unitDefinitionsById = new Map<string, ZCUnitDefinition>();
        for (const unit of this.state.units) {
            if (!unitDefinitionsById.has(unit.unitId)) {
                unitDefinitionsById.set(unit.unitId, this.definitionForUnit(unit.unitId));
            }
        }
        return unitDefinitionsById;
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

    /** 给某一方加金币（含飘字），矿区产出与击杀奖励共用。 */
    private grantGold(owner: ZCOwner, amount: number, x: number, y: number, floatSeconds: number): void {
        if (!Number.isFinite(amount) || amount <= 0) return;
        this.setGold(owner, this.goldOf(owner) + amount);
        this.pushFloatText({ kind: 'gold', owner, value: amount, x, y, durationSeconds: floatSeconds });
    }

    private hexCenter(hexId: number): { x: number; y: number } {
        const config = this.config.map.hexes[hexId];
        return { x: config.x, y: config.y };
    }

    get remainingSeconds(): number {
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
                unit.owner !== 'player' && unit.battleState !== 'dead' ? count + 1 : count
            ), 0),
            currentWaveHp,
            currentWaveMaxHp: ledger?.maxHp ?? 0,
            currentWaveHpRate: current?.hpRate ?? 1,
            currentWaveCardId: current?.cardId ?? null,
        };
    }

    get playerTerritoryCount(): number {
        return this.territoryCount('player');
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
        return this.developedCount('player');
    }

    get enemyDevelopedCount(): number {
        return this.activeOwners.slice(1).reduce((total, owner) => total + this.developedCount(owner), 0);
    }

    get playerIncomePerSecond(): number {
        return this.rules.hqIncomeAmount / this.rules.hqIncomeIntervalSeconds
            + this.bonusesFor('player').incomeBonus
            + this.mineIncome('player');
    }

    get playerBonds(): readonly string[] {
        return this.bonusesFor('player').activeBonds;
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
        return ZCOutcomeSystem.scoreFor(this.state, 'player', this.homeId('player'));
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
                const neighbor = this.hex(neighborId)!;
                if (neighbor.owner !== start.owner
                    || (!neighbor.developmentResolved && neighbor.building === 'none')) continue;
                connected.add(neighborId);
                queue.push(neighborId);
            }
        }
        // 用 `Array.from` 而非 `[...connected]`：release 构建会把展开降级成
        // `[].concat(set)`，而 concat 不展开迭代器，整套领土连通性会静默算错。
        const result = Array.from(connected);
        this.connectedDevelopedCache.set(hexId, result);
        return result;
    }

    canPlayerDevelop(hexId: number): boolean {
        return this.canDevelopFor('player', hexId);
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

    developHex(hexId: number): ZCActionResult {
        if (this.state.status !== 'playing') return this.fail('本局已经结束。');
        const hex = this.hex(hexId);
        if (!hex) return this.fail('地块不存在。');
        if (!this.canPlayerDevelop(hexId)) return this.fail('该地块当前不可开发。');
        // 这一条带结构化原因：棋盘上给不出「钱不够」的可见反馈（那格的图标与价格照旧），
        // 只能由 HUD 的金币栏表达 ⇒ 表现层要看 `reason` 而不是这段中文。
        if (this.goldOf('player') < hex.developmentCost) {
            return this.fail(`金币不足，需要 ${hex.developmentCost}。`, 'insufficientGold');
        }
        this.setGold('player', this.goldOf('player') - hex.developmentCost);
        this.chargeArtifactFromDevelopment();
        return this.developFor('player', hex);
    }

    useArtifact(): ZCActionResult {
        if (this.state.status !== 'playing') return this.fail('本局已经结束。');
        const activation = ZCArtifactSystem.activate(this.state, this.rules);
        if (activation.ok === false) {
            return this.fail(activation.reason === 'cooldown' ? '神器正在冷却。' : '神器尚未充满。');
        }
        for (const unit of this.state.units) {
            if (unit.owner !== 'player' && unit.battleState !== 'dead') this.damageUnit(unit, this.rules.artifactDamage, { owner: 'player', kind: 'artifact' });
        }
        this.removeDeadUnits();
        // 释放技能：神器是全局技，没有落点 ⇒ `params` 不传（协议注明「如无不用传」）。
        this.pushFrameEvent(FRAME_OP_SKILL, []);
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
        this.state = ZCSnapshotCodec.createInitialState(this.config, this.random);
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
        for (const owner of ZC_OWNER_ORDER) {
            this.damageDealt[owner] = 0;
            this.damageTaken[owner] = 0;
        }
        this.refreshTileStates();
        this.checkOutcome();
    }

    private advance(dt: number): void {
        this.captureSystem.beginStep(this.state.units);
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
        this.projectileSystem.update(this.state.projectiles, dt, this.projectileContext);
        this.captureSystem.update(this.state, dt, (hex, owner) => this.captureEmptyTile(hex, owner));
        this.refreshTileStates();
        if (!this.pveDefence) {
            this.state.aiClock = Math.round((this.state.aiClock + dt) * 1e9) / 1e9;
            if (this.state.aiClock >= this.rules.enemyAiIntervalSeconds) {
                this.state.aiClock -= this.rules.enemyAiIntervalSeconds;
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

    /** 建筑目标在弹道飞行期间可能破墙或易主，命中时读取当前防御状态。 */
    private projectileStructureTarget(projectile: ZCProjectileState): ZCCombatTarget | null {
        if (projectile.targetKind === 'unit') return null;
        const hex = this.hex(projectile.targetId);
        if (!hex || hex.owner === 'neutral' || hex.owner === projectile.owner) return null;
        const center = this.hexCenter(hex.id);
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
            owner: source.owner,
            value: result.applied + (source.floatTextValueOffset ?? 0),
            x: position.x,
            y: position.y,
            durationSeconds: FLOAT_TEXT_DAMAGE_SECONDS,
        });
        this.pushHitFx(target, result.applied, source, position);
        if (result.killed) {
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
        if (source.unitId === undefined) return undefined;
        const attacker = this.units.byId.get(source.unitId);
        // 实例可能已被 `removeDeadUnits` 摘掉（死亡后仍会被打到溅射）⇒ 这时不播。
        if (!attacker) return undefined;
        for (const owner of this.activeOwners) {
            const card = this.cards[owner].get(attacker.cardId);
            const trait = card?.traits?.attack;
            if (trait) return trait;
        }
        return undefined;
    }

    private unitPosition(unit: ZCUnitState, result?: { x: number; y: number }): { x: number; y: number } {
        return this.movement.position(unit, result);
    }

    private captureEmptyTile(hex: ZCHexState, owner: ZCOwner): void {
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
            const exposed = ZCTileSystem.hasExposedWall(this.state, this.config.map, hex);
            if (exposed) this.exposedWalls.add(hex.id);
            if (exposed || (hex.owner !== 'neutral' && hex.building !== 'none' && hex.hp > 0 && hex.wallHp <= 0)) this.targetHexes.push(hex);
        }
    }

    private damageWall(unit: Pick<ZCUnitState, 'owner' | 'freeX' | 'freeY'>, wall: ZCHexState, damage: number): void {
        const center = this.hexCenter(wall.id);
        const result = ZCDamageResolutionSystem.damageWall(
            wall, damage, unit, this.hasExposedWall(wall), center, this.damageResolutionContext);
        if (!result) return;
        this.pushFloatText({ kind: 'damage', owner: unit.owner, value: result.applied,
            x: center.x, y: center.y, durationSeconds: FLOAT_TEXT_DAMAGE_SECONDS });
        if (result.killed) this.invalidateTerrain();
    }

    private damageBuilding(unit: Pick<ZCUnitState, 'owner'>, building: ZCHexState, damage: number): void {
        const result = ZCDamageResolutionSystem.damageBuilding(
            this.state, building, damage, unit, this.damageResolutionContext);
        if (!result) return;
        const center = this.hexCenter(building.id);
        this.pushFloatText({ kind: 'damage', owner: unit.owner, value: result.applied,
            x: center.x, y: center.y, durationSeconds: FLOAT_TEXT_DAMAGE_SECONDS });
        if (!result.killed) return;
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

    /** 选点结束、正式模型建立后记录我方最终出生格；重复通知不重复入队。 */
    recordSpawnSelection(): void {
        if (this.frameEvents.some((event) => event.op === FRAME_OP_SPAWN)) return;
        this.pushFrameEvent(FRAME_OP_SPAWN, [this.homeId('player')]);
    }

    /**
     * 记一条战斗帧事件（随 `CmdFinishBattleReqMsg.commands` 上报，供服务端校验 / 回放）。
     *
     * `op` 口径由协议 `CmdBattleFrameInfo` 定死：**1=翻格（`params`=[格子 id]）、
     * 2=释放技能（`params`=[技能位置]，无位置就不传）、4=出生点（`params`=[格子 id]）**。
     * `unitId` 恒 0 —— 这些都是「某一方的操作」，不对应任何单位；协议里是 required 字段，只能用 0 占位
     * （与 `ZCGame.buildStatistics` 的 `unitId: 0` 同一约定）。
     * `frameId` 沿用毫秒时间戳的既有口径（协议注释写「帧 id」，但那会改变已经在上报的格式，未动）。
     */
    private pushFrameEvent(op: number, params: number[]): void {
        this.frameEvents.push({ frameId: Math.round(this.state.elapsedSeconds * 1000), unitId: 0, op, params });
    }

    private developFor(owner: ZCOwner, hex: ZCHexState): ZCActionResult {
        this.pushFrameEvent(FRAME_OP_DEVELOP, [hex.id]);
        const result = ZCDevelopmentSystem.develop(
            this.state, owner, hex, this.deckFor(owner), this.config, this.random, this.developmentContext);
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
        this.pushHexActivation(hex.id, result.building !== null, result.card ? ZC_RARITY_RANK[result.card.rarity] : 0);
        if (!result.card) {
            this.refreshTileStates();
            return this.success(`${owner === 'player' ? '你' : '敌方'}花费 ${hex.developmentCost} 金币，本次未抽到卡牌。`);
        }
        const card = result.card;
        if (!result.building) {
            this.refreshTileStates();
            return this.success(`${owner === 'player' ? '你' : '敌方'}花费 ${hex.developmentCost} 金币，抽到【${card.name}】，但${ZC_CARD_TYPE_NAMES[card.type]}不能建在格子上。`);
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
        const countdown = hex.constructionTotalSeconds > 0 ? `，建造需 ${hex.constructionTotalSeconds.toFixed(1)} 秒` : '';
        return this.success(`${owner === 'player' ? '你' : '敌方'}花费 ${hex.developmentCost} 金币，${result.pityTriggered ? '触发保底，' : ''}抽到${card.rarity}卡【${card.name}】${countdown}。`);
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

    /** 生成一个单位；返回**新建的**单位（被 `unitCapPerSide` 挡下或卡没配单位时返回 null）。 */
    private spawnUnit(
        owner: ZCOwner,
        card: ZCDeckCard,
        tier: number,
        hexId: number,
        waveRates?: { hpRate: number; attackRate: number },
    ): ZCUnitState | null {
        if (!card.unitId || this.unitCount(owner) >= this.rules.unitCapPerSide) return null;
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
        const hpRate = waveRates?.hpRate && waveRates.hpRate > 0 ? waveRates.hpRate : 1;
        const attackMultiplier = waveRates?.attackRate && waveRates.attackRate > 0 ? waveRates.attackRate : 1;
        const maxHp = Math.max(1, Math.round(definition.maxHp * bonuses.unitHpMultiplier * tierMultiplier * hpRate));
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
            attackMultiplier,
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
        // 同上：单位出生不是协议里的「操作」（这里原本误报成 op=1=翻格，params 也不是格子 id）。
        this.state.nextUnitId += 1;
        return unit;
    }

    /** 按 defenceModWave.waveShowTime 在敌方主城生成整波单位。 */
    private spawnDueDefenceWaves(): void {
        if (!this.pveDefence) return;
        while (this.nextDefenceWaveIndex < this.pveDefence.waves.length) {
            const wave = this.pveDefence.waves[this.nextDefenceWaveIndex];
            if (wave.showAtSeconds > this.state.elapsedSeconds + 1e-9) return;
            this.nextDefenceWaveIndex += 1;
            // 先占位再生成：波序与账本下标必须**逐位对齐**，中途 `continue` 也不能错位。
            const ledger = { ids: [] as number[], maxHp: 0 };
            this.defenceWaveLedger[this.nextDefenceWaveIndex - 1] = ledger;
            const card = this.cardById('enemy', wave.cardId);
            if (!card?.unitId) {
                continue;
            }
            const count = Math.max(0, Math.floor(wave.monsterCount));
            for (let index = 0; index < count; index += 1) {
                const unit = this.spawnUnit('enemy', card, Math.max(1, Math.floor(wave.tier)), this.homeId('enemy'), {
                    hpRate: wave.hpRate,
                    attackRate: wave.attackRate,
                });
                if (!unit) continue;
                ledger.ids.push(unit.id);
                ledger.maxHp += Math.max(0, unit.maxHp);
            }
        }
    }

    private cardById(owner: ZCOwner, id: string): ZCDeckCard | undefined {
        return this.cards[owner].get(id);
    }

    private unitDefinition(id: string): ZCUnitDefinition {
        const definition = this.definitions.get(id);
        if (!definition) throw new Error(`本局单位配置不存在：${id}`);
        return definition;
    }

    private effectiveUnitDefinition(unit: ZCUnitState): ZCUnitDefinition {
        const base = this.effectiveUnitDefinitionFor(unit.owner, unit.unitId);
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
            ?? (owner === 'player' ? this.config.playerDeck : this.config.enemyDeck);
    }

    private homeId(owner: ZCOwner): number {
        const index = ZC_OWNER_ORDER.indexOf(owner);
        return this.config.map.homes?.[index]
            ?? (owner === 'player' ? this.config.map.playerHomeId : this.config.map.enemyHomeId);
    }

    private goldOf(owner: ZCOwner): number {
        if (owner === 'player') return this.state.playerGold;
        if (owner === 'enemy') return this.state.enemyGold;
        return this.state.goldByOwner?.[owner] ?? 0;
    }

    private setGold(owner: ZCOwner, value: number): void {
        const normalized = Math.max(0, value);
        if (!this.state.goldByOwner) {
            this.state.goldByOwner = { player: this.state.playerGold, enemy: this.state.enemyGold, enemy2: 0, enemy3: 0 };
        }
        this.state.goldByOwner[owner] = normalized;
        if (owner === 'player') this.state.playerGold = normalized;
        else if (owner === 'enemy') this.state.enemyGold = normalized;
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
        return goal ? Math.atan2(goal.y - from.y, goal.x - from.x) : (owner === 'player' ? Math.PI / 2 : -Math.PI / 2);
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
        ZCDevelopmentSystem.claimAdjacentNeutralResources(
            this.state, this.config.map, this.activeOwners, this.developmentContext, (hexId, resourceId) => {
                this.tileStatesDirty = true;
                this.invalidateTerrain();
                // 金矿「被开发」：领取金矿走「建筑被开发」的点击动画（脉冲 ∥ 缩没、无卡牌），
                // 与「开出一块地」同一种观感（2026-10-20 需求）。
                if (resourceId === ZCNeutralResourceId.Mine) this.pushHexActivation(hexId, false, 0);
            });
    }

    /**
     * 中立资源奖励入袋的表现通知入口（`onNeutralReward` 的落地实现）。
     *
     * 按需求把「哪种资源播什么效果」收敛在模型这一处：
     *   · `mine`（金矿）→ **只播「建筑被开发」激活**（见 `claimAdjacentNeutralResources`），
     *     不播金币飞行 —— 需求口径「金矿沿用建筑被开发效果」；
     *   · `gold` / `chest`（金币堆 / 宝箱）→ 入队金币飞行事件（视图播「飞向金币栏 + 上飘 +N」）；
     *   · `artifact_charge`（神器充能）→ 入队神器飞行事件（视图播「飞向神器栏」）；
     *   · `unit_cap`（兵力）→ 直接产兵、走出生表现，无飞行事件。
     * 其余（无实际入账金额）一律不入队，避免空特效。
     */
    private pushNeutralReward(hexId: number, resourceId: ZCNeutralResourceId, owner: ZCOwner,
        reward: ZCNeutralResourceReward): void {
        if (resourceId === ZCNeutralResourceId.Mine) return;
        if (reward.gold <= 0 && reward.artifactCharge <= 0) return;
        this.presentation.pushNeutralReward({
            now: this.state.elapsedSeconds,
            hexId,
            resourceId,
            owner,
            gold: reward.gold,
            artifactCharge: reward.artifactCharge,
        });
    }

    private checkOutcome(): void {
        const result = ZCOutcomeSystem.checkOutcome(this.state, this.outcomeContext, this.nextDefenceWaveIndex);
        if (result) this.finish(result.status, result.reason);
    }

    private finish(status: Exclude<ZCGameStatus, 'playing'>, reason: string): void {
        this.state.status = status;
        this.state.resultReason = reason;
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
        return this.state.hexes.filter((hex) => hex.owner === owner && hex.building !== 'none' && hex.hp > 0).length;
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

    private success(message: string): ZCActionResult {
        return { ok: true, message };
    }

    private fail(message: string, reason?: ZCActionFailureReason): ZCActionResult {
        return { ok: false, message, reason };
    }

}
