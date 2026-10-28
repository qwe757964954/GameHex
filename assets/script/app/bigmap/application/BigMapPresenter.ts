/**
 * 大世界 Presenter —— 把「配置 + 世界 + 存档 + 冒险进度」粘起来，只吐**视图数据**与动作结果。
 *
 * 分层口径（见 `AGENTS.md`）：
 * - `model/` 里全是纯规则，不知道 lodash/引擎/UI 存在；
 * - 这里负责时序（tick）、持久化（经 `IBigMapStorage` 端口）、把规则结果翻译成界面能直接画的结构；
 * - `view/` 只读这里的数据、只调这里的方法，不自己算规则、不自己读配置。
 */
import {
    BIGMAP_RES_ORDER,
    BigMapQueueState,
    type BigMapCityState,
    type BigMapResType,
    type IBigMapConfig,
    type IBigMapBaseState,
    type IBigMapWorld,
    type IBigMapMonsterBattleConfig,
    type IBigMapBuildingConfig,
} from '../model/BigMapTypes';
import {
    bigMapBuildingCountWithQueue,
    bigMapCanAfford,
    bigMapCanMove,
    bigMapCanPlace,
    bigMapCanUpgrade,
    bigMapCancelQueue,
    bigMapClampQueueUnlocked,
    bigMapHarvest,
    bigMapHarvestAll,
    bigMapMainBuilding,
    bigMapMainLevel,
    bigMapMove,
    bigMapPendingHarvest,
    bigMapProducePerHour,
    bigMapResCap,
    bigMapStartBuild,
    bigMapStartUpgrade,
    bigMapTick,
    bigMapUnlockQueue,
} from '../model/BigMapBase';
import {
    bigMapAttackCity,
    bigMapAttackMonster,
    bigMapAttackPower,
    bigMapCityAttackPreview,
    bigMapCityHpRatio,
    bigMapMonsterHpRatio,
    bigMapUnlockContextOf,
    BIGMAP_MONSTER_BATTLE_UNAVAILABLE,
    BIGMAP_BATTLE_TEXT,
    type IBigMapBattleProgress,
} from '../model/BigMapBattle';
import {
    bigMapBuildingUnlock,
    bigMapCityState,
    bigMapCityUnlock,
    bigMapMonsterUnlock,
    bigMapUpgradeUnlock,
    type IBigMapUnlockContext,
} from '../model/BigMapUnlock';
import { bigMapHexDistance, buildBigMapWorld } from '../model/BigMapWorld';
import { buildBigMapWorldFromLayout, type IBigMapLayout } from '../model/BigMapLayout';
import type { ITerritoryColorRegion } from '../model/BigMapTerritoryColor';
import type { IBigMapCampInfo } from '../model/BigMapCampInfo';
import { BIGMAP_CAMP_QUERY_TEXT } from '../model/BigMapCampInfo';
import type { IBigMapCampRoleInfo, BigMapCampRoleStatus } from '../model/BigMapCampRoleInfo';
import { BIGMAP_CAMP_MOVE_TEXT } from '../model/BigMapCampMove';
import type { BigMapCampRepository } from './BigMapCampRepository';
import type { BigMapSlgRepository } from './BigMapSlgRepository';
import { projectBigMapServerBase } from '../model/BigMapServerState';
import { ZC_BATTLE_TYPE_SLG_CAMP, ZC_BATTLE_TYPE_SLG_MONSTER } from '../../battle/BattleStartModel';
import type { IZCSlgBattleType } from '../../battle/BattleStartModel';
import { parseBigMapSave, serializeBigMapSave, type IBigMapSaveData } from '../model/BigMapSaveData';
import {
    bigMapCityAttackGate,
    bigMapCityTimeline,
    type BigMapCityPhase,
    type IBigMapCityTimeline,
} from '../model/BigMapCitySchedule';
import {
    buildBigMapCityRankBoard,
    buildSoloRankBoard,
    type IBigMapCityRankBoard,
    type IBigMapRankProvider,
} from '../model/BigMapRank';
import {
    bigMapSnapshotDue,
    buildBigMapDaySnapshot,
    type IBigMapDaySnapshot,
} from '../model/BigMapSnapshot';

/** 存储端口（`sys.localStorage` 由 application 适配器注入，Presenter 不 import 引擎）。 */
export interface IBigMapStorage {
    read(key: string): string | null;
    write(key: string, value: string): void;
}

export interface IBigMapPresenterDeps {
    readonly config: IBigMapConfig;
    readonly storage: IBigMapStorage;
    readonly saveKey: string;
    /** 冒险已通关章节数（`TerritorySaveStoreAdapter.loadLastChapter` 的口径）。 */
    readonly adventureChapter: () => number;
    /**
     * 背包快照（道具 id → 数量）。**由入口注入**，不在这里 import `ItemBag` ——
     * 那条链经 `CacheMgr` 一路拖进 `cc`，会把本来能裸跑单测的 Presenter 绑死引擎。
     * 不注入（离线 / 预览态）时顶栏继续用存档 `base.res`。
     */
    readonly itemCounts?: () => ReadonlyMap<string, number>;
    readonly now: () => number;
    /** 世界种子，缺省用默认值；改它等于换一张地图。 */
    readonly seed?: number;
    /** 开服天数，缺省 0（单机版恒 0）。 */
    readonly openDay?: number;
    /**
     * 策划布局（`BigMapLayoutLoader` 产出）。缺省 / `null` = 按种子生成世界。
     * 传了就**布局优先**：城池/野怪/基地的落位全部以它为准。
     */
    readonly layout?: IBigMapLayout | null;
    /** 城池榜单来源（联机 = 服务器；缺省 = 本地 NPC 模拟）。 */
    readonly rankProvider?: IBigMapRankProvider;
    readonly campRepository?: BigMapCampRepository;
    readonly slgRepository?: BigMapSlgRepository;
    /** 发起服务端战斗并通过 GameRoute 导航；不得回退本地结算。 */
    readonly startBattle?: (battleType: IZCSlgBattleType, targetConfigId: number, isCurrent: () => boolean) => Promise<IBigMapActionFeedback>;
}

/**
 * 世界实例：**布局优先，种子兜底**。
 *
 * `resolveBigMapLayout` 已经做过解析与尺寸校验，这里再 try/catch 一次是给「绕过 loader
 * 直接塞进来」的调用方（单测、调试台）兜底 —— 建世界失败不该让大世界白屏。
 */
/**
 * 建造目录的组名：`粮食田-1` → `粮食田`、`装饰雕像1` → `装饰雕像`。
 *
 * 策划表 `baseBuilding` 每座田一个 id、名字带序号；建造目录按类合并展示，
 * 这里只剥尾部序号，不改表里的真实名字（详情面板仍显示「粮食田-1」）。
 */
function groupName(name: string): string {
    const trimmed = name.replace(/[-_\s]*\d+$/, '').trim();
    return trimmed || name;
}

function createBigMapWorldInstance(
    config: IBigMapConfig,
    seed: number | undefined,
    layout: IBigMapLayout | null | undefined,
): IBigMapWorld {
    if (layout) {
        try {
            return buildBigMapWorldFromLayout(config, layout);
        } catch (error) {
            console.warn('[BigMapPresenter] 用布局建世界失败，回退种子生成', error);
        }
    }
    return buildBigMapWorld(config, seed);
}

// ------------------------------------------------------------------ 视图数据

export interface IBigMapResourceView {
    readonly amountKnown?: boolean;
    readonly type: BigMapResType;
    readonly name: string;
    readonly amount: number;
    readonly cap: number;
    readonly pending: number;
    readonly perHour: number;
}

export interface IBigMapPlotCellView {
    readonly hexId: number;
    readonly row: number;
    readonly column: number;
    readonly instanceId: number;
    readonly buildingId: number;
    readonly name: string;
    /**
     * 这块地产什么（`baseBuildingLevel.resType` 反查出来的资源类型）；非资源田为 null。
     *
     * 以前 view 里硬编码 `{71002:grain,71003:wood,71004:iron,71005:coin}` ——
     * 策划表里 71002~71006 **全是粮食田**，硬编码会把粮食田-2 画成木材图标。
     */
    readonly resType: BigMapResType | null;
    readonly level: number;
    readonly stored: number;
    /** 站位预览色：空闲 / 已占 / 正在建造。 */
    readonly slot: 'empty' | 'building' | 'constructing';
    readonly remainSeconds: number;
}

export interface IBigMapPlotDetailView {
    readonly name: string;
    readonly buildingId: number;
    readonly instanceId: number;
    readonly level: number;
    readonly targetLevel: number;
    readonly stored: number;
    readonly costGrain: number;
    readonly costWood: number;
    readonly costIron: number;
    readonly buildTime: number;
    readonly canUpgrade: boolean;
    readonly reason: string;
    readonly queueSlotIndex: number;
    readonly remainSeconds: number;
    readonly progress: number;
}

export interface IBigMapBuildEntryView {
    /**
     * **下一次要建的建筑 id**（不是"这一行是哪栋"）。
     *
     * 策划表 `baseBuilding` 里每座田各占一个 id（粮食田 71002~71006 五座），
     * 建造目录按 `kind` 合并成一行（「粮食田 1/5」），点一次就把这一组里
     * 下一座没建满的 id 发出去。`0` = 这一组已经建满。
     */
    readonly buildingId: number;
    /** 分组键（= `baseBuildType`）；行点击按它回查菜单，避免用建过的旧 id。 */
    readonly kind: number;
    readonly name: string;
    readonly unlocked: boolean;
    readonly reason: string;
    readonly count: number;
    readonly maxOwnNum: number;
    readonly unlockChapter: number;
    readonly costGrain: number;
    readonly costWood: number;
    readonly costIron: number;
    readonly buildTime: number;
    readonly affordable: boolean;
}

export interface IBigMapQueueView {
    readonly slotIndex: number;
    readonly busy: boolean;
    readonly name: string;
    readonly targetLevel: number;
    readonly remainSeconds: number;
    readonly totalSeconds: number;
    readonly progress: number;
    /**
     * 还没解锁的槽位（`slotIndex >= queueUnlocked`）：只用于显示「上限是几条、还能解锁几条」，
     * 不能排任务。`bigmapQueue.maxBuildQueue` 就是靠这里在界面上体现出来的。
     */
    readonly locked: boolean;
}

export interface IBigMapCityView {
    readonly cityId: number;
    readonly name: string;
    readonly layer: number;
    readonly level: number;
    readonly state: BigMapCityState;
    readonly reason: string;
    readonly hpRatio: number;
    readonly warScore: number;
    readonly minWarScore: number;
    readonly staminaCost: number;
    readonly rewardCoin: number;
    readonly desc: string;
    readonly hexId: number;
    readonly distance: number;
    /** 本次攻打的预览值（未开放/已占领时为 0）。 */
    readonly previewDamage: number;
    readonly previewWarScore: number;
    readonly inRange: boolean;
    readonly damageCutPct: number;
    /**
     * 这座城就是我**所处**的城（服务器 `SlgGameInfo.toCampId`）。
     *
     * 与 `isServerCamp`（这座城有没有接服务器据点协议）不是一回事，别混。
     */
    readonly isPlayerCamp: boolean;
    /** 当前攻城日程阶段（顶栏/详情面板显示「可攻打 / 已锁榜 / 休战」）。 */
    readonly phase: BigMapCityPhase;
    /** 现在能不能打（= 已开放 + 日程放行）；`attackReason` 是打不了的具体原因。 */
    readonly canAttack: boolean;
    readonly attackReason: string;
    /** 玩家在这座城的当前名次（喂名次系数；没刷新过榜单时按「独自一人」算 = 1）。 */
    readonly playerRank: number;
    /** 同时在打的人数（喂拥挤系数）。 */
    readonly attackerCount: number;
    readonly topWarScore: number;
    /** 只有联机入口注入 Repository；预览与旧离线测试保留原有数据链路。 */
    readonly isServerCamp: boolean;
    readonly campInfo: IBigMapCampInfo | null;
    readonly campDetailStatus: 'idle' | 'loading' | 'ready' | 'failed';
    /**
     * 据点内角色（`CmdSlgCampRoleInfosRspMsg`，r879）。空数组 = 查过、确实没人。
     *
     * 与 `campDetailStatus` **各自独立**：据点状态和角色列表是两条协议，
     * 一条失败不该把另一条也标成失败（`campRolesStatus` 单独记）。
     */
    readonly campRoles: readonly IBigMapCampRoleInfo[];
    readonly campRolesStatus: BigMapCampRoleStatus;
}

export interface IBigMapMonsterView {
    readonly instanceId: number;
    readonly monsterId: number;
    readonly name: string;
    readonly level: number;
    /**
     * 已通关的最高野怪等级（联机取服务器 `SlgGameInfo.maxMonsterLevel` 与本地进度的较大者）。
     * 逐级解锁早就吃它，但界面一直没显示 —— 玩家看不到「打到第几级了」。
     */
    readonly clearedLevel: number;
    readonly hexId: number;
    readonly unlocked: boolean;
    readonly reason: string;
    readonly hpRatio: number | null;
    readonly staminaCost: number;
    readonly respawnInSeconds: number;
    readonly battle: IBigMapMonsterBattleConfig | null;
    readonly canAttack: boolean;
    readonly attackReason: string;
}

/** 建造队列解锁状态（给 UI 显示「解锁第 2 条 · 货币 120」）。 */
export interface IBigMapQueueUnlockInfo {
    readonly current: number;
    readonly max: number;
    /** 下一条的价格（已满时为 0）。 */
    readonly cost: number;
    readonly canUnlock: boolean;
    readonly reason: string;
}

/** 动作结果：`message` 直接丢给 toast，`ok=false` 时是失败原因。 */
export interface IBigMapActionFeedback {
    readonly ok: boolean;
    readonly message: string;
}

export class BigMapPresenter {
    private config: IBigMapConfig;
    private worldInstance: IBigMapWorld;
    private data: IBigMapSaveData;
    private version = 0;
    private readonly listeners = new Set<() => void>();
    /** 城池榜单缓存：`cityId → board`。只在 `refreshCityRank` 里写，视图同步读。 */
    private readonly rankBoards = new Map<number, IBigMapCityRankBoard>();
    private readonly deps: IBigMapPresenterDeps;
    private readonly territories: readonly ITerritoryColorRegion[];
    private isDisposed = false;
    private isStartingBattle = false;
    private readonly campDetailStatuses = new Map<number, IBigMapCityView['campDetailStatus']>();
    /** 角色列表的查询状态（与据点状态分开记，见 `IBigMapCityView.campRoles`）。 */
    private readonly campRoleStatuses = new Map<number, IBigMapCityView['campRolesStatus']>();
    private unsubscribeSlg: (() => void) | null = null;
    /** 据点角色广播订阅（页面销毁时摘掉）。 */
    private unsubscribeRoles: (() => void) | null = null;
    /** 据点缓存变化订阅（角色事件合进缓存后转成一次视图重绘）。 */
    private unsubscribeCampChanged: (() => void) | null = null;
    /**
     * 格 id → 据点 id 的**预建反查表**（角色广播只带 `pos`，不带 campId）。
     *
     * 用 Map 而不是每次遍历 `territories`：攻击事件可能一秒来好几条，
     * 每条都跑一遍「几十座城 × 每城几十格」的 includes 就是白烧 CPU。
     * 同格被多座城声明时以**先声明者**为准（`set` 不覆盖已有键）。
     */
    private readonly campIdByHex = new Map<number, number>();

    constructor(deps: IBigMapPresenterDeps) {
        this.deps = deps;
        this.config = deps.config;
        this.worldInstance = createBigMapWorldInstance(deps.config, deps.seed, deps.layout);
        this.territories = [...this.worldInstance.cities.values()].map((site) => {
            const annotation = deps.layout?.cities.find((city) => city.cityId === site.cityId);
            const hexIds = [...new Set([...site.hexIds, ...(annotation?.rangeHex ?? [])])]
                .filter((hexId) => this.worldInstance.tileById.has(hexId));
            return { id: site.cityId, hexIds };
        });
        for (const territory of this.territories) {
            for (const hexId of territory.hexIds) {
                if (!this.campIdByHex.has(hexId)) this.campIdByHex.set(hexId, territory.id);
            }
        }
        this.data = parseBigMapSave(deps.slgRepository ? null : deps.storage.read(deps.saveKey), deps.config, deps.now()).save;
        // 角色广播只联机有：事件按 `pos` 反查出据点，再合进该据点的角色缓存。
        // 合完要主动 `emit()` —— 广播是异步来的，没有它详情面板会停在上一帧的血量。
        if (deps.campRepository) {
            this.unsubscribeRoles = deps.campRepository.subscribeRoleEvents(
                (pos) => this.campIdByHex.get(pos) ?? 0,
            );
            this.unsubscribeCampChanged = deps.campRepository.onChanged(() => {
                if (!this.isDisposed) this.emit();
            });
        }
        if (deps.slgRepository) {
            const empty = projectBigMapServerBase({ builds: [], queues: [], unlockQueue: deps.config.queue.initBuildQueue },
                deps.config, deps.now());
            if (!empty) throw new Error('[SLG] 基地配置不可用');
            this.applyBase(empty);
            this.unsubscribeSlg = deps.slgRepository.onChanged(() => {
                const base = deps.slgRepository?.projectBase();
                if (this.isDisposed || !base) return;
                this.applyBase(base);
                this.emit();
            });
            return;
        }
        // 进页面先补一次离线结算，再落盘（否则「离线 8 小时」要等第一次操作才生效）。
        this.tick(false);
        this.persist();
    }

    // -------------------------------------------------------------- 基础访问

    get world(): IBigMapWorld {
        return this.worldInstance;
    }

    territoryRegions(): readonly ITerritoryColorRegion[] {
        return this.territories;
    }

    get battle(): IBigMapBattleProgress {
        return this.data.battle;
    }

    /** 主城建筑 id（视图给主城换特殊底色时用）。 */
    get mainBuildingId(): number {
        return this.config.mainBuildingId;
    }

    /** 某个建造区格子上「正在建造」的建筑名（空串 = 该格没有在建工程）。 */
    buildingNameOfQueueAt(hexId: number): string {
        const slot = this.data.base.queues.find((item) => (
            item.state === BigMapQueueState.Building && item.instanceId === 0 && item.anchorHexId === hexId
        ));
        if (!slot) return '';
        return this.config.buildings.get(slot.buildingId)?.name ?? '';
    }

    get base(): IBigMapBaseState {
        return this.data.base;
    }

    get isServerBase(): boolean { return !!this.deps.slgRepository; }
    get serverBaseReady(): boolean { return this.deps.slgRepository?.ready ?? true; }
    get actionRecoverSeconds(): number | null { return this.deps.slgRepository?.actionRemainingSeconds ?? null; }
    get canHarvest(): boolean {
        return this.isServerBase ? this.serverBaseReady && this.data.base.buildings.some((build) => this.isResourceBuilding(build.buildingId))
            : this.resourceBar().some((item) => item.pending > 0);
    }

    initializeSlg(): Promise<boolean> {
        return this.deps.slgRepository?.initialize() ?? Promise.resolve(true);
    }

    /** 视图订阅用：任何会改变显示结果的操作都会 +1。 */
    get refreshVersion(): number {
        return this.version;
    }

    onChanged(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    get unlockContext(): IBigMapUnlockContext {
        const context = bigMapUnlockContextOf(this.data.battle, this.deps.adventureChapter(), this.deps.openDay ?? 0);
        const server = this.deps.slgRepository;
        if (!server) return context;
        // 联机版的击杀进度在服务器（`SlgGameInfo.maxMonsterLevel`），本地存档是空的；
        // 不覆盖会把野外怪全部锁死（`preLevel > 0` 一律不放行）。
        return {
            ...context,
            maxClearedMonsterLevel: Math.max(context.maxClearedMonsterLevel, server.maxClearedMonsterLevel),
        };
    }

    /**
     * 我所处的城池 id（服务器 `SlgGameInfo.toCampId`，0 = 未知 / 未归属）。
     *
     * 势力范围判定只认它（见 `bigMapWithinCityRange`）；离线档恒 0 ⇒ 仍走距离，行为不变。
     */
    get playerCampId(): number {
        return this.deps.slgRepository?.campId ?? 0;
    }

    /**
     * 玩家基地在大地图上的格 —— **服务器 `toCampId` 那座城的锚点**。
     *
     * 口径（2026-10-23 山猫确认）：*「玩家基地就固定在 `toCampId` 那座城的锚点上」*。
     * 所以位置也认服务器，不再用布局档里的 `bases[].isPlayer` 那格当唯一真源 ——
     * 布局档只在「还没收到包 / 未归属 / 该城不在地图上」时兜底。
     *
     * ⚠️ 城锚点同时是城池的占格（`cityByHex`），基地钉上去后与城图标同格；
     * 点击仍按 `bigMapOccupantOf` 的「城优先」返回城池详情，基地入口走模式木牌。
     */
    get playerBaseHexId(): number {
        const campId = this.playerCampId;
        const city = campId > 0 ? this.worldInstance.cities.get(campId) : undefined;
        return city ? city.anchorHexId : this.worldInstance.playerBase.hexId;
    }

    get adventureChapter(): number {
        return this.deps.adventureChapter();
    }

    /**
     * 资源类型 → 背包道具图标路径（`item.icon`）。没配 itemId / 图标为空时是空表，
     * 视图退回 `image/bigmap/concept/sprites/<resType>` 概念图。
     */
    get resourceIcons(): ReadonlyMap<BigMapResType, string> {
        return this.config.resourceIcons;
    }

    /**
     * 叫一声「解锁依据可能变了」，让视图重算一遍。
     *
     * 冒险章节集合是登录后**并行**拉的（`TerritoryChapterInfoRepository.refresh()`），
     * 世界页开得比它早时，回包到达那一刻 Presenter 自己察觉不到 —— 建筑解锁会停在旧章节，
     * 直到下次重进页面。入口那边在回包后调用本方法补一次刷新。
     */
    refreshUnlockContext(): void {
        this.emit();
    }

    private emit(): void {
        if (this.isDisposed) return;
        this.version += 1;
        for (const listener of this.listeners) listener();
    }

    private persist(): void {
        if (this.isServerBase || this.isDisposed) return;
        this.data = { ...this.data, savedAt: this.deps.now() };
        this.deps.storage.write(this.deps.saveKey, serializeBigMapSave(this.data));
    }

    private applyBase(base: IBigMapBaseState): void {
        this.data = { ...this.data, base };
    }

    private applyBattle(battle: IBigMapBattleProgress): void {
        this.data = { ...this.data, battle };
    }

    // -------------------------------------------------------------- 时间推进

    /** 结算时间差（产出 / 队列 / 行动力）并顺手补当日快照。 */
    tick(notify = true): void {
        if (this.isServerBase) {
            this.deps.slgRepository?.tick();
            if (notify) this.emit();
            return;
        }
        const result = bigMapTick(this.config, this.data.base, this.deps.now());
        this.applyBase(result.state);
        const snapshotted = this.refreshDaySnapshot();
        if (result.completed.length > 0 || snapshotted) this.persist();
        // 快照是「玩家没操作也会发生」的状态变化，必须自己触发重绘。
        if (notify || snapshotted) this.emit();
    }

    /**
     * 过了 22:00（或次日开战前）就定格一份当日战绩快照；同一天只出一份。
     *
     * 只用**确定性**的输入（战功 + 榜单名次 + 日程），所以离线补算与在线结算结果一致。
     */
    private refreshDaySnapshot(): boolean {
        const now = this.deps.now();
        if (!bigMapSnapshotDue(this.config.schedule, now, this.data.snapshot)) return false;
        const snapshot = buildBigMapDaySnapshot(
            this.config.schedule,
            now,
            this.data.battle,
            (cityId) => {
                // 当刻现算，不依赖「玩家是否点开过这座城」——否则名次会随点没点过而变。
                try {
                    return buildBigMapCityRankBoard(this.config, cityId, this.data.battle.cityWarScore[cityId] ?? 0)
                        .playerRank;
                } catch {
                    return 1;
                }
            },
        );
        this.data = { ...this.data, snapshot };
        return true;
    }

    /** 最近一次当日战绩快照（没出过就是 `null`）。 */
    daySnapshot(): IBigMapDaySnapshot | null {
        return this.data.snapshot;
    }

    // -------------------------------------------------------------- 资源栏

    /**
     * 顶栏资源。
     *
     * 🔴 联机态的数量来自**背包**（`CmdItem` 缓存，道具 18501~18505），不是 SLG 存档：
     * 协议里 `SlgGameInfo` 只有 `maxMonsterLevel` / `toCampId`，**没有任何资源余额字段** ——
     * 资源在服务端就是背包道具（收取 `CmdSlgBuildCollectReqMsg` 也回 `tlCmdGoods`）。
     * 以前这里一律 `amountKnown = false`，顶栏 5 个格子全显示 `—`（2026-10-26 用户反馈）。
     *
     * 离线 / 预览态没有背包，继续读存档 `base.res`。
     */
    resourceBar(): readonly IBigMapResourceView[] {
        const pending = bigMapPendingHarvest(this.config, this.data.base);
        const perHour = bigMapProducePerHour(this.config, this.data.base);
        // 背包快照只取一次（读一次遍历整个 `CmdItem` 缓存）。
        const bag = this.isServerBase ? this.deps.itemCounts?.() ?? null : null;
        return BIGMAP_RES_ORDER.map((type) => {
            const config = this.config.resources.get(type);
            const itemId = config?.itemId ?? 0;
            const fromBag = bag !== null && itemId > 0;
            const amount = fromBag
                ? Math.max(0, bag!.get(String(itemId)) ?? 0)
                // ⚠️ 行动力走 `base.stamina`（会随攻打消耗、随时间恢复），不是资源包里的
                // `res.stamina`（那只是「初始值」的展示位）。两者同名字段，别串了。
                : type === 'stamina'
                    ? Math.floor(this.data.base.stamina)
                    : Math.floor(this.data.base.res[type]);
            return {
                // 联机态只有真从背包读到才算「已知」：没注入 / 没配 itemId 时仍显示 `—`，
                // 不能拿存档里的 0 冒充真实余额。
                amountKnown: !this.isServerBase || fromBag,
                type,
                name: config?.name ?? type,
                amount,
                // 背包没有「仓库上限」概念（上限是 SLG 自己的 resCap）：给 NaN，
                // 顶栏就不会拼 `/800` 这种对不上的数字。
                cap: fromBag ? Number.NaN : bigMapResCap(this.config, this.data.base, type),
                pending: Math.floor(pending[type]),
                perHour: perHour[type],
            };
        });
    }

    /**
     * 建造队列的解锁状态。
     *
     * 🔴 文档口径（`docs/bigmap-系统落地方案.md` §2「建造 · 队列」）：3 队列、**付费解锁** ——
     * 所以队列数量只看存档 `queueUnlocked`，与建了哪些建筑无关。
     */
    queueUnlockInfo(): IBigMapQueueUnlockInfo {
        const current = bigMapClampQueueUnlocked(this.config, this.data.base.queueUnlocked);
        const max = this.config.queue.maxBuildQueue;
        if (current >= max) {
            return { current, max, cost: 0, canUnlock: false, reason: '建造队列已满' };
        }
        const cost = current <= 1
            ? this.config.queue.queueUnlockCost2
            : this.config.queue.queueUnlockCost3;
        const affordable = Number.isFinite(cost) && cost > 0 && (this.isServerBase || this.data.base.res.coin >= cost);
        return {
            current,
            max,
            cost: affordable || Number.isFinite(cost) ? cost : 0,
            canUnlock: affordable,
            reason: affordable ? '' : `货币不足（需要 ${Math.round(cost || 0)}）`,
        };
    }

    /** 花货币解锁下一条建造队列。 */
    unlockBuildQueue(): IBigMapActionFeedback {
        if (this.isServerBase) return { ok: false, message: '请通过服务端提交操作' };
        const result = bigMapUnlockQueue(this.config, this.data.base);
        if (!result.ok || !result.state) return { ok: false, message: result.reason };
        this.applyBase(result.state);
        this.persist();
        this.emit();
        return { ok: true, message: `建造队列 +1（消耗货币 ${Math.round(result.cost)}）` };
    }

    mainLevel(): number {        return bigMapMainLevel(this.config, this.data.base);
    }

    attackPower(): number {
        return bigMapAttackPower(this.config, this.data.base);
    }

    // -------------------------------------------------------------- 建造区

    plotCells(): readonly IBigMapPlotCellView[] {
        const rows = this.config.queue.plotRows;
        const cols = this.config.queue.plotCols;
        const views: IBigMapPlotCellView[] = [];
        for (let row = 0; row < rows; row += 1) {
            for (let column = 0; column < cols; column += 1) {
                const hexId = row * cols + column;
                const instance = this.data.base.buildings.find((item) => item.hexId === hexId);
                const queue = this.data.base.queues.find((slot) => (
                    slot.state === BigMapQueueState.Building
                    && (instance ? slot.instanceId === instance.instanceId : slot.anchorHexId === hexId)
                ));
                views.push({
                    hexId,
                    row,
                    column,
                    instanceId: instance?.instanceId ?? 0,
                    buildingId: instance?.buildingId ?? 0,
                    name: instance ? (this.config.buildings.get(instance.buildingId)?.name ?? '') : '',
                    resType: instance
                        ? this.config.produce.get(instance.buildingId)?.get(instance.level)?.resType ?? null
                        : null,
                    level: instance?.level ?? 0,
                    stored: Math.floor(instance?.stored ?? 0),
                    slot: queue && !instance ? 'constructing' : instance ? 'building' : 'empty',
                    remainSeconds: queue ? Math.max(0, Math.ceil(queue.finishAt - this.deps.now())) : 0,
                });
            }
        }
        return views;
    }

    plotDetail(hexId: number): IBigMapPlotDetailView | null {
        const instance = this.data.base.buildings.find((building) => building.hexId === hexId);
        const queue = this.data.base.queues.find((slot) => slot.state === BigMapQueueState.Building
            && (instance ? slot.instanceId === instance.instanceId : slot.anchorHexId === hexId));
        const buildingId = instance?.buildingId ?? queue?.buildingId;
        if (buildingId === undefined) return null;
        const level = instance?.level ?? 0;
        const targetLevel = queue?.targetLevel ?? level + 1;
        const cost = this.config.levels.get(buildingId)?.get(targetLevel);
        const now = this.deps.now();
        const preview = instance
            ? bigMapCanUpgrade(this.config, this.data.base, this.unlockContext, instance.instanceId, !this.isServerBase)
            : { ok: false, reason: '建造中' };
        const remainSeconds = queue ? Math.max(0, Math.ceil(queue.finishAt - now)) : 0;
        return {
            name: this.config.buildings.get(buildingId)?.name ?? '', buildingId,
            instanceId: instance?.instanceId ?? 0, level, targetLevel, stored: Math.floor(instance?.stored ?? 0),
            costGrain: cost?.costGrain ?? 0, costWood: cost?.costWood ?? 0, costIron: cost?.costIron ?? 0,
            buildTime: cost?.buildTime ?? 0, canUpgrade: !queue && preview.ok,
            reason: queue ? '建造中' : preview.reason, queueSlotIndex: queue?.slotIndex ?? -1,
            remainSeconds, progress: queue ? Math.max(0, Math.min(1, 1 - remainSeconds / Math.max(1, queue.finishAt - queue.startAt))) : 0,
        };
    }

    /**
     * 建造目录：按 `baseBuildType`（kind）**合并同名**成一行。
     *
     * 策划表每座田一个 id（粮食田 71002~71006、木材田 71007~71011…），
     * 照 23 行铺出去面板放不下、玩家也分不清"粮食田-1/-2"。
     * 所以一行代表一类：`count` = 这类已建总数，`maxOwnNum` = 这类可用 id 数之和，
     * `buildingId` = **下一座**该建的 id（建满为 0）。
     *
     * 解锁按「组里还有未建满且已解锁的成员」判：只要还有一座能建就算解锁；
     * 全都锁着时把第一条锁的原因带出去（玩家看到的是"通关冒险第 N 章解锁"）。
     */
    buildMenu(): readonly IBigMapBuildEntryView[] {
        const context = this.unlockContext;
        const groups = new Map<number, IBigMapBuildingConfig[]>();
        for (const building of [...this.config.buildings.values()].sort((a, b) => a.sort - b.sort || a.id - b.id)) {
            const members = groups.get(building.kind) ?? [];
            members.push(building);
            groups.set(building.kind, members);
        }

        const rows: IBigMapBuildEntryView[] = [];
        for (const members of groups.values()) {
            const head = members[0];
            let nextId = 0;
            let lockedReason = '';
            let count = 0;
            let maxOwnNum = 0;
            for (const member of members) {
                const built = bigMapBuildingCountWithQueue(this.data.base, member.id);
                count += built;
                maxOwnNum += member.maxOwnNum;
                if (nextId !== 0 || built >= member.maxOwnNum) continue;
                const unlock = bigMapBuildingUnlock(member, context);
                if (!unlock.unlocked) {
                    if (!lockedReason) lockedReason = unlock.reason;
                    continue;
                }
                // 这一组里第一座「还没建满且已解锁」的 id 就是要建的那座。
                nextId = member.id;
            }
            const cost = this.config.levels.get(nextId || head.id)?.get(1);
            rows.push({
                buildingId: nextId,
                kind: head.kind,
                name: groupName(head.name),
                unlocked: nextId !== 0,
                reason: nextId !== 0 ? '' : (lockedReason || '已达数量上限'),
                count,
                maxOwnNum: Math.max(1, maxOwnNum),
                unlockChapter: head.unlockChapter,
                costGrain: cost?.costGrain ?? 0,
                costWood: cost?.costWood ?? 0,
                costIron: cost?.costIron ?? 0,
                buildTime: cost?.buildTime ?? 0,
                affordable: cost ? this.isServerBase || bigMapCanAfford(this.data.base, cost) : false,
            });
        }
        return rows;
    }

    /** 建筑升级入口是否已解锁（第 3 章），界面据此给「升级」按钮置灰。 */
    upgradeUnlocked(): boolean {
        return bigMapUpgradeUnlock(this.config, this.unlockContext).unlocked;
    }

    /**
     * 队列槽位：**按 `bigmapQueue.maxBuildQueue` 全部返回**，未解锁的标 `locked`。
     *
     * 以前是 `slice(0, queueUnlocked)` —— 界面只看得见已解锁的那几条，玩家根本不知道
     * 「上限是 3 条、还能解锁 2 条」，等于 `maxBuildQueue` 这列只在建造目录那一行生效。
     */
    queues(): readonly IBigMapQueueView[] {
        const now = this.deps.now();
        const max = this.config.queue.maxBuildQueue;
        const unlocked = Math.min(Math.max(0, this.data.base.queueUnlocked), max);
        return this.data.base.queues.slice(0, max).map((slot) => {
            const locked = slot.slotIndex >= unlocked;
            const busy = !locked && slot.state === BigMapQueueState.Building;
            const total = Math.max(1, slot.finishAt - slot.startAt);
            const remain = Math.max(0, slot.finishAt - now);
            return {
                slotIndex: slot.slotIndex,
                busy,
                locked,
                name: busy ? (this.config.buildings.get(slot.buildingId)?.name ?? '') : '',
                targetLevel: slot.targetLevel,
                remainSeconds: Math.ceil(remain),
                totalSeconds: total,
                progress: busy ? Math.min(1, Math.max(0, 1 - remain / total)) : 0,
            };
        });
    }

    // -------------------------------------------------------------- 动作：建造

    startBuild(hexId: number, buildingId: number): IBigMapActionFeedback {
        if (this.isServerBase) return { ok: false, message: '请通过服务端提交操作' };
        const result = bigMapStartBuild(this.config, this.data.base, this.unlockContext, buildingId, hexId, this.deps.now());
        if (!result.ok || !result.state) return { ok: false, message: result.reason };
        this.applyBase(result.state);
        this.persist();
        this.emit();
        return { ok: true, message: `开始建造${this.config.buildings.get(buildingId)?.name ?? ''}` };
    }

    startUpgrade(instanceId: number): IBigMapActionFeedback {
        if (this.isServerBase) return { ok: false, message: '请通过服务端提交操作' };
        const result = bigMapStartUpgrade(this.config, this.data.base, this.unlockContext, instanceId, this.deps.now());
        if (!result.ok || !result.state) return { ok: false, message: result.reason };
        this.applyBase(result.state);
        this.persist();
        this.emit();
        return { ok: true, message: '开始升级' };
    }

    cancelQueue(slotIndex: number): IBigMapActionFeedback {
        if (this.isServerBase) return { ok: false, message: '请通过服务端提交操作' };
        const result = bigMapCancelQueue(this.config, this.data.base, slotIndex);
        if (!result.ok || !result.state) return { ok: false, message: result.reason };
        this.applyBase(result.state);
        this.persist();
        this.emit();
        return { ok: true, message: '已取消，资源已返还' };
    }

    harvest(instanceId: number): IBigMapActionFeedback {
        if (this.isServerBase) return { ok: false, message: '请通过服务端提交操作' };
        const result = bigMapHarvest(this.config, this.data.base, instanceId);
        if (!result.resType) return { ok: false, message: '暂无可收取资源' };
        if (result.amount <= 0) return { ok: false, message: '仓库已满，先花掉一些资源' };
        this.applyBase(result.state);
        this.persist();
        this.emit();
        const name = this.config.resources.get(result.resType)?.name ?? result.resType;
        return { ok: true, message: `${name} +${result.amount}${result.capped ? '（仓库已满）' : ''}` };
    }

    harvestAll(): IBigMapActionFeedback {
        if (this.isServerBase) return { ok: false, message: '请通过服务端提交操作' };
        const result = bigMapHarvestAll(this.config, this.data.base);
        const parts = BIGMAP_RES_ORDER
            .filter((type) => result.gained[type] > 0)
            .map((type) => `${this.config.resources.get(type)?.name ?? type} +${Math.floor(result.gained[type])}`);
        if (parts.length === 0) return { ok: false, message: '暂无可收取资源' };
        this.applyBase(result.state);
        this.persist();
        this.emit();
        return { ok: true, message: parts.join('，') };
    }

    async requestBuild(hexId: number, buildingId: number): Promise<IBigMapActionFeedback> {
        const repository = this.deps.slgRepository;
        if (!repository) return this.startBuild(hexId, buildingId);
        const check = bigMapCanPlace(this.config, this.base, this.unlockContext, buildingId, hexId, false);
        if (!check.ok) return { ok: false, message: check.reason };
        return repository.build(buildingId, hexId);
    }

    async requestUpgrade(instanceId: number): Promise<IBigMapActionFeedback> {
        const repository = this.deps.slgRepository;
        if (!repository) return this.startUpgrade(instanceId);
        const check = bigMapCanUpgrade(this.config, this.base, this.unlockContext, instanceId, false);
        if (!check.ok) return { ok: false, message: check.reason };
        const id = repository.serverInstanceId(instanceId);
        return id ? repository.upgrade(id) : { ok: false, message: '建筑尚未同步' };
    }

    async requestCancelQueue(slotIndex: number): Promise<IBigMapActionFeedback> {
        const repository = this.deps.slgRepository;
        if (!repository) return this.cancelQueue(slotIndex);
        const id = repository.queueInstanceId(slotIndex);
        return id ? repository.cancel(id) : { ok: false, message: '队列尚未同步' };
    }

    async requestMove(instanceId: number, hexId: number): Promise<IBigMapActionFeedback> {
        const repository = this.deps.slgRepository;
        if (!repository) {
            const result = bigMapMove(this.config, this.data.base, instanceId, hexId);
            if (!result.ok || !result.state) return { ok: false, message: result.reason };
            this.applyBase(result.state);
            this.persist();
            this.emit();
            return { ok: true, message: '建筑已移动' };
        }
        // 服务端只管「实例 + 目标格」，本地先把这一层的合法位置拦掉，避免白发一次请求。
        const check = bigMapCanMove(this.config, this.data.base, instanceId, hexId);
        if (!check.ok) return { ok: false, message: check.reason };
        const id = repository.serverInstanceId(instanceId);
        return id ? repository.move(id, hexId) : { ok: false, message: '建筑尚未同步' };
    }

    async requestHarvest(instanceId: number): Promise<IBigMapActionFeedback> {
        const repository = this.deps.slgRepository;
        if (!repository) return this.harvest(instanceId);
        const id = repository.serverInstanceId(instanceId);
        if (!id) return { ok: false, message: '建筑尚未同步' };
        return repository.collect([id]);
    }

    async requestHarvestAll(): Promise<IBigMapActionFeedback> {
        if (!this.isServerBase) return this.harvestAll();
        const repository = this.deps.slgRepository;
        if (!repository) return { ok: false, message: '建筑尚未同步' };
        const ids = this.base.buildings.filter((build) => this.isResourceBuilding(build.buildingId)).map((build) => build.instanceId);
        if (ids.length === 0) return { ok: false, message: '暂无可收取建筑' };
        // 协议已支持批量领取，一次结算，避免逐栋串行写请求。
        return repository.collect(ids);
    }

    async requestUnlockBuildQueue(): Promise<IBigMapActionFeedback> {
        const repository = this.deps.slgRepository;
        return repository ? repository.unlockQueue(this.base.queueUnlocked + 1) : this.unlockBuildQueue();
    }

    canCollectBuilding(buildingId: number): boolean { return this.isServerBase && this.serverBaseReady && this.isResourceBuilding(buildingId); }
    private isResourceBuilding(buildingId: number): boolean { return !!this.config.produce.get(buildingId)?.size; }

    /** 点击建造区某格：建造中 → 取消；已建 → 升级；空 → 返回空（让界面进入摆放模式）。 */
    tapPlotCell(hexId: number): IBigMapActionFeedback {
        const instance = this.data.base.buildings.find((item) => item.hexId === hexId);
        if (instance) return this.startUpgrade(instance.instanceId);
        const constructing = this.data.base.queues.find((slot) => (
            slot.state === BigMapQueueState.Building && slot.instanceId === 0 && slot.anchorHexId === hexId
        ));
        if (constructing) return this.cancelQueue(constructing.slotIndex);
        return { ok: false, message: '空位：先从建造列表选一座建筑' };
    }

    // -------------------------------------------------------------- 动作：战斗

    async refreshVisibleCamps(campIds: readonly number[]): Promise<void> {
        if (this.isDisposed || !this.deps.campRepository) return;
        const ids = campIds.filter((id) => this.worldInstance.cities.has(id));
        if (await this.deps.campRepository.refreshSimple(ids)) this.emit();
    }

    async refreshCampDetail(campId: number): Promise<void> {
        const repository = this.deps.campRepository;
        if (this.isDisposed || !repository || !this.worldInstance.cities.has(campId)
            || this.campDetailStatuses.get(campId) === 'loading') return;
        this.campDetailStatuses.set(campId, 'loading');
        this.campRoleStatuses.set(campId, 'loading');
        this.emit();
        // 两条协议并行：据点状态（占领/开放）与角色列表互不依赖，
        // 串行会把详情面板的等待时间翻倍，且任一条失败不该拖住另一条。
        const [detailLoaded, rolesLoaded] = await Promise.all([
            repository.refreshDetail([campId]),
            repository.refreshRoles(campId),
        ]);
        if (this.isDisposed) return;
        this.campDetailStatuses.set(campId, detailLoaded ? 'ready' : 'failed');
        this.campRoleStatuses.set(campId, rolesLoaded ? 'ready' : 'failed');
        this.emit();
    }

    /**
     * 迁城：把 `campId` 这个据点挪到 `pos`（`CmdSlgCampMoveReqMsg`，r882）。
     *
     * **成功后必须三处一起重拉**，缺一处就是"迁了但界面还停在上一个城"：
     *   ① `SlgGameInfo.toCampId` —— 「我在哪座城」的唯一真源，它变了基地锚点/势力范围/距离全跟着变；
     *   ② 据点状态（占领/开放）—— 迁出/迁入会改两边的 opType/state；
     *   ③ 据点内角色列表 —— 自己这一条会从旧城消失、出现在新城。
     *
     * 离线（无 `campRepository`）直接拒：迁城没有本地兜底 —— 本地挪一个"城"对服务端毫无意义，
     * 下次拉 GameInfo 就会被打回原形。
     *
     * @param campId 据点 id
     * @param pos 目标位置（协议"下标"；客户端不做换算，谁选的格谁负责）
     */
    async requestMoveCamp(campId: number, pos: number): Promise<IBigMapActionFeedback> {
        if (this.isDisposed) return { ok: false, message: BIGMAP_CAMP_MOVE_TEXT.disposed };
        const repository = this.deps.campRepository;
        if (!repository) return { ok: false, message: BIGMAP_CAMP_MOVE_TEXT.offline };
        const result = await repository.moveCamp(campId, pos);
        if (this.isDisposed) return { ok: false, message: BIGMAP_CAMP_MOVE_TEXT.disposed };
        if (!result.ok) return result;
        void this.deps.slgRepository?.refreshGame();
        void this.refreshCampDetail(campId);
        return result;
    }

    dispose(): void {
        this.isDisposed = true;
        this.listeners.clear();
        this.campDetailStatuses.clear();
        this.campRoleStatuses.clear();
        this.deps.campRepository?.dispose();
        this.unsubscribeSlg?.();
        this.unsubscribeSlg = null;
        this.unsubscribeRoles?.();
        this.unsubscribeRoles = null;
        this.unsubscribeCampChanged?.();
        this.unsubscribeCampChanged = null;
        this.campIdByHex.clear();
        this.deps.slgRepository?.dispose();
    }

    /**
     * 当前攻城日程 —— 视图每帧直接读它（幂等），不自己算时间。
     *
     * 日程来自 `bigmapSchedule` 表（`config.schedule`），代码里不写 `21:00` 这种字面量；
     * 时钟走 `deps.now()` 端口（联机版换服务器校准秒即可），所以这里不出现 `Date.now()`。
     */
    cityTimeline(): IBigMapCityTimeline {
        return bigMapCityTimeline(this.config.schedule, this.deps.now());
    }

    /** 某座城当前的榜单（未刷新过就是「只有你」的兜底榜，绝不返回 null）。 */
    cityRankBoard(cityId: number): IBigMapCityRankBoard {
        const cached = this.rankBoards.get(cityId);
        if (cached) return cached;
        return buildSoloRankBoard(cityId, this.data.battle.cityWarScore[cityId] ?? 0);
    }

    /**
     * 刷新某座城的榜单 —— 进详情/进排行页时调，拿回来缓存住并通知重绘。
     *
     * 端口失败不抛给界面（与「存档损坏退回新档」同一口径）：回退到本地 NPC 榜。
     */
    async refreshCityRank(cityId: number): Promise<void> {
        if (!this.config.cities.has(cityId)) return;
        const warScore = this.data.battle.cityWarScore[cityId] ?? 0;
        let board: IBigMapCityRankBoard;
        try {
            board = this.deps.rankProvider
                ? await this.deps.rankProvider.fetchCityRank(cityId, warScore)
                : buildBigMapCityRankBoard(this.config, cityId, warScore);
        } catch {
            board = buildBigMapCityRankBoard(this.config, cityId, warScore);
        }
        this.rankBoards.set(cityId, board);
        this.emit();
    }

    private resolveCampAttackReason(campId: number, info: IBigMapCampInfo | null): string {
        if (this.isDisposed) return BIGMAP_BATTLE_TEXT.closed;
        if (this.isStartingBattle) return BIGMAP_BATTLE_TEXT.pending;
        if (!this.config.camps.has(campId)) return BIGMAP_BATTLE_TEXT.campMissing;
        if (!this.deps.startBattle) return BIGMAP_CAMP_QUERY_TEXT.attackUnavailable;
        if (!info) {
            // 详情查询与开战是独立协议；查询失败不能让开战入口永久不可用，资格以开战回包为准。
            return this.campDetailStatuses.get(campId) === 'failed' ? '' : BIGMAP_CAMP_QUERY_TEXT.pending;
        }
        return info.opType === 0 && (info.state === 1 || info.state === 2) ? '' : BIGMAP_BATTLE_TEXT.campUnavailable;
    }

    cityView(cityId: number): IBigMapCityView | null {
        const city = this.config.cities.get(cityId);
        const site = this.worldInstance.cities.get(cityId);
        if (!city || !site) return null;
        const context = this.unlockContext;
        const playerCampId = this.playerCampId;
        const campInfo = this.deps.campRepository?.get(cityId) ?? null;
        const camp = this.config.camps.get(cityId);
        const campAttackReason = this.resolveCampAttackReason(cityId, campInfo);
        const state = campInfo
            ? (campInfo.opType === 1 ? 'occupied' : campInfo.state === 0 ? 'unavailable' : 'open')
            : bigMapCityState(city, context);
        const reason = bigMapCityUnlock(city, context).reason;
        const timeline = this.cityTimeline();
        const gate = bigMapCityAttackGate(state, timeline);
        const board = this.cityRankBoard(cityId);
        const distance = bigMapHexDistance(
            this.worldInstance.rows, this.worldInstance.cols,
            this.playerBaseHexId, site.anchorHexId,
        );
        const preview = state === 'open'
            ? bigMapCityAttackPreview(
                this.config, this.data.base, city, distance,
                board.attackerCount, board.playerRank, playerCampId,
            )
            : null;
        return {
            cityId: city.cityId,
            name: this.deps.campRepository && camp ? camp.name : city.name,
            layer: city.layer,
            level: city.cityLevel,
            state,
            reason,
            hpRatio: bigMapCityHpRatio(this.data.battle, city),
            warScore: Math.round(this.data.battle.cityWarScore[city.cityId] ?? 0),
            minWarScore: this.config.cityLevels.get(city.cityLevel)?.minOccupyWarScore ?? 0,
            staminaCost: this.deps.campRepository && camp ? camp.staminaCost : city.staminaCost,
            rewardCoin: city.rewardCoin,
            desc: this.deps.campRepository && camp ? camp.desc : city.desc,
            hexId: site.anchorHexId,
            distance,
            previewDamage: preview?.damage ?? 0,
            previewWarScore: preview?.warScore ?? 0,
            inRange: preview?.inRange ?? false,
            damageCutPct: preview?.damageCutPct ?? 0,
            isPlayerCamp: playerCampId > 0 && cityId === playerCampId,
            phase: timeline.phase,
            canAttack: this.deps.campRepository ? campAttackReason === '' : gate.canAttack,
            attackReason: this.deps.campRepository ? campAttackReason : gate.reason,
            playerRank: board.playerRank,
            attackerCount: board.attackerCount,
            topWarScore: board.topWarScore,
            isServerCamp: !!this.deps.campRepository,
            campInfo,
            campDetailStatus: this.campDetailStatuses.get(cityId) ?? 'idle',
            campRoles: this.deps.campRepository?.rolesOf(cityId) ?? [],
            campRolesStatus: this.campRoleStatuses.get(cityId) ?? 'idle',
        };
    }

    allCityViews(): readonly IBigMapCityView[] {
        return [...this.config.cities.values()]
            .map((city) => this.cityView(city.cityId))
            .filter((view): view is IBigMapCityView => view !== null);
    }

    monsterView(instanceId: number): IBigMapMonsterView | null {
        const site = this.worldInstance.monsters.find((item) => item.instanceId === instanceId);
        if (!site) return null;
        const monster = this.config.monsters.get(site.monsterId);
        if (!monster) return null;
        const unlock = bigMapMonsterUnlock(monster, this.unlockContext);
        const respawnAt = monster.offlineBattle ? this.data.battle.monsterRespawnAt[instanceId] ?? 0 : 0;
        const respawnInSeconds = Math.max(0, Math.ceil(respawnAt - this.deps.now()));
        return {
            instanceId,
            monsterId: site.monsterId,
            name: monster.name,
            level: monster.level,
            clearedLevel: this.unlockContext.maxClearedMonsterLevel,
            hexId: site.anchorHexId,
            unlocked: unlock.unlocked,
            reason: unlock.reason,
            hpRatio: bigMapMonsterHpRatio(this.config, this.data.battle, site),
            staminaCost: monster.staminaCost,
            respawnInSeconds,
            battle: monster.battle,
            canAttack: (!!monster.offlineBattle || !!this.deps.startBattle && !!monster.battle)
                && unlock.unlocked && respawnInSeconds === 0 && !this.isStartingBattle && !this.isDisposed,
            attackReason: !unlock.unlocked ? unlock.reason : this.isStartingBattle ? BIGMAP_BATTLE_TEXT.pending
                : monster.battle && !this.deps.startBattle ? BIGMAP_MONSTER_BATTLE_UNAVAILABLE : '',
        };
    }

    async requestAttackCity(cityId: number): Promise<IBigMapActionFeedback> {
        if (this.isDisposed) return { ok: false, message: BIGMAP_BATTLE_TEXT.closed };
        if (!this.deps.campRepository) return this.attackCity(cityId);
        const view = this.cityView(cityId);
        const camp = this.config.camps.get(cityId);
        if (!view || !camp) return { ok: false, message: BIGMAP_BATTLE_TEXT.campMissing };
        if (!view.canAttack) return { ok: false, message: view.attackReason };
        return this.requestServerBattle(ZC_BATTLE_TYPE_SLG_CAMP, camp.campId);
    }

    async requestAttackMonster(instanceId: number): Promise<IBigMapActionFeedback> {
        if (this.isDisposed) return { ok: false, message: BIGMAP_BATTLE_TEXT.closed };
        const site = this.worldInstance.monsters.find((item) => item.instanceId === instanceId);
        const monster = site ? this.config.monsters.get(site.monsterId) : null;
        if (!monster) return { ok: false, message: BIGMAP_BATTLE_TEXT.monsterMissing };
        if (!monster.battle) return this.attackMonster(instanceId);
        const view = this.monsterView(instanceId);
        if (!view?.canAttack) return { ok: false, message: view?.attackReason || BIGMAP_BATTLE_TEXT.monsterUnavailable };
        return this.requestServerBattle(ZC_BATTLE_TYPE_SLG_MONSTER, monster.id);
    }

    private async requestServerBattle(battleType: IZCSlgBattleType, targetConfigId: number): Promise<IBigMapActionFeedback> {
        const start = this.deps.startBattle;
        if (!start || this.isStartingBattle || this.isDisposed) return { ok: false, message: BIGMAP_BATTLE_TEXT.unavailable };
        this.isStartingBattle = true;
        this.emit();
        try {
            const result = await start(battleType, targetConfigId, () => !this.isDisposed);
            return this.isDisposed ? { ok: false, message: BIGMAP_BATTLE_TEXT.closed } : result;
        } catch {
            return { ok: false, message: BIGMAP_BATTLE_TEXT.failed };
        } finally {
            this.isStartingBattle = false;
            this.emit();
        }
    }

    attackCity(cityId: number): IBigMapActionFeedback {
        // 当前协议只有查询，不能用本地结算冒充服务器攻城成功。
        if (this.deps.campRepository) return { ok: false, message: BIGMAP_CAMP_QUERY_TEXT.attackUnavailable };
        const city = this.config.cities.get(cityId);
        const view = this.cityView(cityId);
        if (!city || !view) return { ok: false, message: '城池不存在' };
        // 日程是**唯一入口**：休战/结算期即使城池开放也不许打，否则「锁榜后还能刷战功」。
        if (!view.canAttack) return { ok: false, message: view.attackReason || '当前无法攻城' };
        const outcome = bigMapAttackCity(
            this.config, this.data.base, this.data.battle, city, view.distance,
            {
                adventureChapter: this.deps.adventureChapter(),
                openDay: this.deps.openDay ?? 0,
                // 名次 / 拥挤系数用当前榜单的真值，不再恒等于 1。
                attackers: view.attackerCount,
                rank: view.playerRank,
                // 势力范围只认服务器下发的「所处城池」，与预览用同一判据。
                playerCampId: this.playerCampId,
            },
        );
        if (!outcome.ok || !outcome.base || !outcome.progress) {
            return { ok: false, message: outcome.reason };
        }
        this.applyBase(outcome.base);
        this.applyBattle(outcome.progress);
        this.persist();
        // 战功变了名次就变：同步重算一次本地榜（联机时再让 provider 覆盖成服务器真值）。
        this.rankBoards.set(
            cityId,
            buildBigMapCityRankBoard(this.config, cityId, this.data.battle.cityWarScore[cityId] ?? 0),
        );
        if (this.deps.rankProvider) void this.refreshCityRank(cityId);
        this.emit();
        if (outcome.occupied) return { ok: true, message: `占领 ${city.name}！货币 +${city.rewardCoin}` };
        if (outcome.breached) return { ok: true, message: `${city.name} 城防已破，继续积累战功` };
        return { ok: true, message: `造成 ${outcome.preview?.damage ?? 0} 伤害，战功 +${outcome.preview?.warScore ?? 0}` };
    }

    attackMonster(instanceId: number): IBigMapActionFeedback {
        const site = this.worldInstance.monsters.find((item) => item.instanceId === instanceId);
        if (!site) return { ok: false, message: '野怪不存在' };
        const outcome = bigMapAttackMonster(
            this.config, this.data.base, this.data.battle, site, this.deps.now(),
        );
        if (!outcome.ok || !outcome.base || !outcome.progress) {
            return { ok: false, message: outcome.reason };
        }
        this.applyBase(outcome.base);
        this.applyBattle(outcome.progress);
        this.persist();
        this.emit();
        if (outcome.breached) return { ok: true, message: '击杀成功，资源已入账' };
        return { ok: true, message: `造成 ${outcome.preview?.damage ?? 0} 伤害` };
    }

    // -------------------------------------------------------------- 便捷查询

    /** 玩家基地到某格的距离（界面显示「距离 x 格」）。基地位置见 `playerBaseHexId`。 */
    distanceFromBase(hexId: number): number {
        return bigMapHexDistance(
            this.worldInstance.rows, this.worldInstance.cols,
            this.playerBaseHexId, hexId,
        );
    }

    /** 主城建筑实例（建造区中心那座），给「主城」按钮用。 */
    mainInstanceId(): number {
        return bigMapMainBuilding(this.config, this.data.base)?.instanceId ?? 0;
    }

    /** 重置存档（调试面板用；正式版不给玩家入口）。 */
    resetSave(): IBigMapActionFeedback {
        if (this.isServerBase) return { ok: false, message: '联机基地不能重置本地存档' };
        const fresh = parseBigMapSave(null, this.config, this.deps.now()).save;
        this.data = fresh;
        this.persist();
        this.emit();
        return { ok: true, message: '基地已重置' };
    }
}
