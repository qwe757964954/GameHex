/**
 * 大世界（BigMap）玩法的基础类型与枚举 —— **纯 TS，零 `cc` 依赖**。
 *
 * 分层约定（见 `AGENTS.md` 架构硬约束）：规则全部落在 `model/`，`view/` 只做渲染编排，
 * `application/` 负责把配置、存档、冒险进度接进来。所以这里不 import 任何引擎/框架模块。
 */

/** 大地图资源。`stamina` 是行动力，与建造资源同表配置但不进资源栏上限。 */
export type BigMapResType = 'grain' | 'wood' | 'iron' | 'coin' | 'stamina';

/** 资源栏顺序（UI 顶栏按此顺序渲染）。 */
export const BIGMAP_RES_ORDER: readonly BigMapResType[] = ['grain', 'wood', 'iron', 'coin', 'stamina'];

/** 建造资源（可被主城 `resCap` 卡上限的那三种）。 */
export const BIGMAP_BUILD_RES: readonly BigMapResType[] = ['grain', 'wood', 'iron'];

/** 建筑类型枚举，对应 `BigMap-建筑配置.baseBuildType`。 */
export const enum BigMapBuildingKind {
    Main = 1,
    ResourceField = 2,
    CoinField = 3,
    Tech = 4,
    Function = 5,
    Decoration = 6,
}

/** 建造队列槽位状态：空闲 / 建造中。 */
export const enum BigMapQueueState {
    Idle = 0,
    Building = 1,
}

/** 城池层级：1 个人（本期唯一开放）/ 2 军团 / 3 战盟 / 4 王座。 */
export const enum BigMapCityLayer {
    Personal = 1,
    Legion = 2,
    WarAlliance = 3,
    Throne = 4,
}

/**
 * 据点可见状态（客户端表现用）。
 *
 * 与文档的六态状态机对齐，但本期只有「个人层」：
 * `Locked` 未到开放条件 / `Open` 可攻打 / `Attacking` 已攻破但未结算 / `Occupied` 已占领 /
 * `Unavailable` 联盟战盟层（配置 `available = 0`，本期不开放）。
 */
export type BigMapCityState = 'locked' | 'open' | 'breached' | 'occupied' | 'unavailable';

/** 世界格子的地形（线框图只用它区分底色，不影响规则）。 */
export type BigMapTerrain = 'plain' | 'forest' | 'rock' | 'water';

export interface IBigMapWorldConfig {
    readonly worldId: number;
    readonly worldName: string;
    readonly rows: number;
    readonly cols: number;
    /** 个人层（外圈）半径，单位：格。 */
    readonly cityRing1: number;
    /** 军团层半径（本期只用于画灰环）。 */
    readonly cityRing2: number;
    readonly baseRadiusMin: number;
    readonly baseRadiusMax: number;
    /** 模拟「其他玩家」的 NPC 基地数量（真实联机版由服务器下发）。 */
    readonly npcBaseCount: number;
    readonly monsterRingMax: number;
}

export interface IBigMapBuildingConfig {
    readonly id: number;
    readonly name: string;
    readonly kind: BigMapBuildingKind;
    readonly occupyHex: number;
    readonly maxOwnNum: number;
    /** 解锁所需冒险章节 —— **建筑解锁的唯一来源**。 */
    readonly unlockChapter: number;
    readonly queueType: number;
    readonly sort: number;
    readonly info: string;
}

export interface IBigMapBuildingLevelConfig {
    readonly id: number;
    readonly level: number;
    readonly costGrain: number;
    readonly costWood: number;
    readonly costIron: number;
    readonly instantCost: number;
    /** 0 表示无前置建筑。 */
    readonly preBuildId: number;
    readonly preBuildLevel: number;
    readonly buildTime: number;
    readonly maxOtherLevel: number;
    /** 主城等级决定资源栏上限；非主城为 0。 */
    readonly resCap: number;
    /** 千分比：50 = +5%。 */
    readonly attrBonus: number;
}

export interface IBigMapProduceConfig {
    readonly id: number;
    readonly level: number;
    readonly resType: BigMapResType;
    readonly producePerHour: number;
    readonly produceCap: number;
}

export interface IBigMapResConfig {
    readonly resType: BigMapResType;
    readonly name: string;
    readonly startAmount: number;
}

export interface IBigMapQueueConfig {
    readonly maxBuildQueue: number;
    readonly initBuildQueue: number;
    /** 第 2 / 3 个队列的解锁价（大地图货币）。 */
    readonly queueUnlockCost2: number;
    readonly queueUnlockCost3: number;
    readonly cancelReturnRate: number;
    readonly offlineMaxHours: number;
    /** 第几章解锁「建筑升级」功能（此前只能摆放）。 */
    readonly upgradeUnlockChapter: number;
    readonly plotRows: number;
    readonly plotCols: number;
}

export interface IBigMapCityConfig {
    readonly cityId: number;
    readonly name: string;
    readonly layer: BigMapCityLayer;
    /** 0 = 本期不开放（联盟 / 战盟 / 王座）。 */
    readonly available: boolean;
    readonly cityLevel: number;
    readonly unlockChapter: number;
    readonly openDay: number;
    readonly staminaCost: number;
    readonly defenseHp: number;
    readonly radiateCapacity: number;
    readonly cityLevelCoeff: number;
    /** 0 = 链头，否则必须**占领**该城才解锁本城。 */
    readonly prevCityId: number;
    readonly rewardCoin: number;
    readonly desc: string;
    readonly slot: number;
    readonly slotCount: number;
}

export interface IBigMapCityLevelConfig {
    readonly level: number;
    readonly warScoreRate: number;
    readonly occupyScore: number;
    readonly powerThreshold: number;
    readonly cityLevelCoeff: number;
    readonly staminaCost: number;
    readonly minOccupyWarScore: number;
    readonly defenseHp: number;
}

export interface IBigMapRankConfig {
    readonly rank: number;
    /** 百分比整数：100 = 100%。 */
    readonly coeffPct: number;
}

export interface IBigMapScoreRuleConfig {
    /** 伤害转战功的边际递减上限（伤害达到该值时约拿到 63% 上限）。 */
    readonly marginalDamageCap: number;
    /** 第 11 名起每降一名扣的百分点。 */
    readonly rankExtendStepPct: number;
    readonly rankExtendMinPct: number;
    readonly crowdBase: number;
    readonly crowdK: number;
    /** 基地不在城池势力范围内时的伤害削减（百分点）。 */
    readonly offRangeDamageCutPct: number;
    /** NPC 竞争者积分相对玩家同分位的比例。 */
    readonly npcScoreRatio: number;
}

export interface IBigMapMonsterConfig {
    readonly id: number;
    readonly name: string;
    readonly level: number;
    readonly occupyHex: number;
    /** 需要先通关的等级（0 = 无门槛）。 */
    readonly preLevel: number;
    readonly staminaCost: number;
    readonly warScore: number;
    readonly defenseHp: number;
    readonly respawnSeconds: number;
    readonly rewardGrain: number;
    readonly rewardWood: number;
    readonly rewardIron: number;
    readonly rewardCoin: number;
}

export interface IBigMapStaminaConfig {
    readonly staminaMax: number;
    readonly recoverInterval: number;
    readonly buyTimesDaily: number;
}

/** 全部配置的只读快照。构造后不再变化，可安全跨帧复用。 */
export interface IBigMapConfig {
    readonly world: IBigMapWorldConfig;
    readonly buildings: ReadonlyMap<number, IBigMapBuildingConfig>;
    readonly levels: ReadonlyMap<number, ReadonlyMap<number, IBigMapBuildingLevelConfig>>;
    readonly produce: ReadonlyMap<number, ReadonlyMap<number, IBigMapProduceConfig>>;
    readonly resources: ReadonlyMap<BigMapResType, IBigMapResConfig>;
    readonly queue: IBigMapQueueConfig;
    readonly cities: ReadonlyMap<number, IBigMapCityConfig>;
    readonly cityLevels: ReadonlyMap<number, IBigMapCityLevelConfig>;
    readonly ranks: readonly IBigMapRankConfig[];
    readonly scoreRule: IBigMapScoreRuleConfig;
    readonly monsters: ReadonlyMap<number, IBigMapMonsterConfig>;
    readonly stamina: IBigMapStaminaConfig;
    /** 主城 id（`baseBuildType = 1` 的那条），基地逻辑处处要用。 */
    readonly mainBuildingId: number;
}

// ------------------------------------------------------------------ 世界地图实例

/** 世界格：`id = row * cols + column`，与领地/对局的格子编号口径一致。 */
export interface IBigMapWorldTile {
    readonly id: number;
    readonly row: number;
    readonly column: number;
    /** 距地图中心的六边距离（环数），解锁与分布规则都用它。 */
    readonly ring: number;
    readonly terrain: BigMapTerrain;
}

/** 城池在地图上的落位：一个锚点格 + 占格块（文档：据点占 4 格）。 */
export interface IBigMapCitySite {
    readonly cityId: number;
    readonly anchorHexId: number;
    readonly hexIds: readonly number[];
    readonly ring: number;
}

/** 野怪实例落位。`instanceId` 与 `monsterId`（配置 id）区分：同一配置可刷多只。 */
export interface IBigMapMonsterSite {
    readonly instanceId: number;
    readonly monsterId: number;
    readonly level: number;
    readonly anchorHexId: number;
    readonly hexIds: readonly number[];
}

/** 玩家 / NPC 基地落位。真实联机版由服务器下发，本地用种子生成的 NPC 模拟「其他玩家」。 */
export interface IBigMapBaseSite {
    readonly baseId: string;
    readonly name: string;
    readonly isPlayer: boolean;
    readonly hexId: number;
    readonly ring: number;
    /** NPC 展示用战力，玩家基地为 0。 */
    readonly power: number;
}

/** 生成好的世界：一次性只读快照，渲染与规则共用同一份实例。 */
export interface IBigMapWorld {
    readonly worldId: number;
    readonly worldName: string;
    readonly rows: number;
    readonly cols: number;
    readonly seed: number;
    readonly centerHexId: number;
    readonly tiles: readonly IBigMapWorldTile[];
    readonly tileById: ReadonlyMap<number, IBigMapWorldTile>;
    /** 每个环的格子数，下标即环号。 */
    readonly ringCounts: readonly number[];
    readonly cities: ReadonlyMap<number, IBigMapCitySite>;
    /** 格 → 城池 id（占格块内每一格都登记，点击任意一格都能选中城池）。 */
    readonly cityByHex: ReadonlyMap<number, number>;
    readonly monsters: readonly IBigMapMonsterSite[];
    /** 格 → 野怪实例 id。 */
    readonly monsterByHex: ReadonlyMap<number, number>;
    readonly bases: readonly IBigMapBaseSite[];
    readonly playerBase: IBigMapBaseSite;
    /** 格 → 基地。 */
    readonly baseByHex: ReadonlyMap<number, IBigMapBaseSite>;
}

// ------------------------------------------------------------------ 基地运行时状态

/**
 * 基地里的一座建筑实例。
 *
 * `hexId` 是**建造区**格 id（`row * plotCols + column`），与大地图格 id 不同域，
 * 千万别混用 —— 建造区只有 5×5，大地图 40×40。
 */
export interface IBigMapBuildingInstance {
    readonly instanceId: number;
    readonly buildingId: number;
    readonly level: number;
    readonly hexId: number;
    /** 资源田未收获的存量（其它建筑恒为 0）。 */
    readonly stored: number;
    /** 上次产出结算时刻（逻辑秒）。 */
    readonly lastTickAt: number;
}

/** 建造队列槽位。`instanceId = 0` 表示新建，否则是升级。 */
export interface IBigMapQueueSlot {
    readonly slotIndex: number;
    readonly state: BigMapQueueState;
    readonly buildingId: number;
    readonly instanceId: number;
    readonly targetLevel: number;
    /** 新建时的目标格（升级时为 undefined，取建筑自己的格）。 */
    readonly anchorHexId?: number;
    readonly startAt: number;
    readonly finishAt: number;
}

/** 基地运行时状态（存档主体）。所有改动都是「返回新对象」，不原地改。 */
export interface IBigMapBaseState {
    readonly instanceSeq: number;
    readonly buildings: readonly IBigMapBuildingInstance[];
    readonly queues: readonly IBigMapQueueSlot[];
    /** 已解锁的队列数（1..maxBuildQueue）。 */
    readonly queueUnlocked: number;
    readonly res: Readonly<Record<BigMapResType, number>>;
    readonly stamina: number;
    /** 上次行动力结算时刻（逻辑秒）。 */
    readonly staminaAt: number;
}

/** 统一的动作结果：失败必有 `reason`，成功可带新状态。 */
export interface IBigMapActionResult {
    readonly ok: boolean;
    readonly reason: string;
    readonly state?: IBigMapBaseState;
}
