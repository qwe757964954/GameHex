import { EventMgr } from '../../../framework/event/EventMgr';
import { TERRITORY_PRESENTER_EVENTS } from '../view/TerritoryEvents';
import type { ITerritoryBattleArt } from './TerritoryPageAssets';
import type { TerritoryCellFetchResult, TerritoryStartBattleResult, TerritoryWriteResult } from './TerritoryCellRepository';
import {
    chapterCellBattleParams,
    chapterTreasureBattleParams,
    ZC_BATTLE_TYPE_CHAPTER,
} from '../../battle/BattleStartModel';
import type { ZCBattleStart } from '../../battle/BattleStartModel';
import {
    TERRITORY_DEFAULT_PLAYER_COUNT,
    TERRITORY_ENEMY_DISPLAY_LIMIT,
    TERRITORY_TEXTS,
    TERRITORY_UNBOUND_TYPE_NAMES,
} from './TerritoryTexts';
import type { TerritoryCampaignStage } from '../model/TerritoryCampaignConfig';
import { TERRITORY_IDLE_REWARD_MAX_HOURS_FALLBACK } from '../model/TerritoryCampaignConfig';
import type {
    TerritoryMapConfig,
    TerritorySite,
} from '../model/TerritoryMapConfig';
import { configureTerritoryMap, TERRITORY_SITE_TYPE } from '../model/TerritoryMapConfig';
import { TERRITORY_REQUEST_STATUS } from '../model/TerritoryRequestStatus';
import type { ITerritoryMapLayout } from '../model/TerritoryMapLayout';
import { buildTerritoryMapLayout } from '../model/TerritoryMapLayout';
import type { TerritoryProgressData } from '../model/TerritoryProgress';
import { territoryRevealedCells } from '../model/TerritoryCellReveal';
import { TerritoryProgress } from '../model/TerritoryProgress';
import {
    applyTerritoryStageUnlocks,
    bindTerritoryBattleStages,
    bindTerritoryStages,
    expandBindingsToAreaSites,
    findCurrentTerritoryBoss,
    territoryChapterCompletion,
} from '../model/TerritoryStageBinding';
import type { ITerritoryCellState } from '../model/TerritoryCellBitSet';
import type {
    TerritoryIdleRewardGain,
    TerritoryIdleRewardSource,
} from '../model/TerritoryIdleReward';
import type { ITerritoryGrantedReward } from '../model/TerritoryGrantedReward';
import type {
    TerritoryBeginBattleResult,
    TerritoryChapterSave,
    TerritoryIdleRewardSaveResult,
    TerritoryWallet,
} from '../model/TerritorySaveStore';
import { TERRITORY_BATTLE_STATUS } from '../model/TerritoryBattleStatus';
import type { ITerritorySiteDetailContent } from '../view/TerritorySiteDetailPanel';
import {
    canOpenTerritoryRandomCell,
    canClaimTerritoryRandomResource,
    selectTerritoryRandomResourceCell,
} from '../../../core/territory/TerritoryRandomResourceRules';
import type { TerritoryRandomCellOpenCheck } from '../../../core/territory/TerritoryRandomResourceRules';

// ============================================================
// 端口
// ============================================================

/** 一章的加载产物；loader 内部允许碰 cc / RefUtil，Presenter 只消费结构。 */
export interface ITerritoryChapterBundle {
    readonly mapJson: unknown;
    readonly campaign: {
        readonly stages: TerritoryCampaignStage[];
        readonly playerCardCount: number;
        readonly idleRewardMaxHours: number;
    };
    readonly art: ITerritoryBattleArt;
}

/** 章节数据加载（地图 JSON + campaign + 美术）。 */
export interface ITerritoryChapterLoader {
    /** 地图 JSON 拉不到（≠ 单张美术缺失）返回 null，调用方展示加载失败。 */
    load(chapterId: number): Promise<ITerritoryChapterBundle | null>;
}

/** 服务端格子网关；运行时直接传现有 TerritoryCellRepository 实例（结构匹配）。 */
export interface ITerritoryCellGateway {
    fetchChapterCells(
        chapterId: number, maxCell: number, host?: unknown,
    ): Promise<TerritoryCellFetchResult>;
    /** 服务端解锁格子；战斗入口允许离线继续，固定资源领取只认成功回包。 */
    unlockCell(chapterId: number, cellId: number, host?: unknown): Promise<TerritoryWriteResult>;
    /** 探索到期占领后上报通关；fire-and-forget。 */
    passCell(chapterId: number, cellId: number, host?: unknown): Promise<TerritoryWriteResult>;
    /** Boss 关开战：请求战斗信息（`CmdStartBattleReqMsg`），**不走**通关上报。 */
    startBattle(
        battleType: number,
        battleParams: readonly string[],
        host?: unknown,
    ): Promise<TerritoryStartBattleResult>;
    /**
     * 订阅「通关格子」广播（`CmdCityChapterPassCellBroMsg`）。**服务端主动推**，不走 req。
     *
     * 标成**可选**是因为测试与部分注入的桩网关没实现它 —— 缺了只是收不到联机广播，
     * 不该让整个 Presenter 构造不出来（`'x' in gateway` 那套分支反而更啰嗦）。
     */
    listenPassCellsBro?(onPassCells: (levelChapter: number, cellIds: readonly number[]) => void): void;
    /** 退订（`dispose` 必调，否则监听挂在 `GameNet` 上会回调到已销毁的对象）。 */
    unlistenPassCellsBro?(): void;
    /**
     * 订阅服务端**主动下发**的章节格子状态（`CmdCityChapterCellInfoRspMsg`，
     * 战斗结束、关卡通关后后端不经请求下发，前端据此刷新，不再发通关请求）。
     *
     * 与 `listenPassCellsBro` 一样标成可选；`maxCell` 用来裁剪上界，`fetchChapterCells`
     * 自己的正常响应不会重复回调（实现里用 in-flight 标志排除）。
     */
    listenCellInfo?(maxCell: number, onState: (state: ITerritoryCellState) => void): void;
    /** 退订（`dispose` 必调）。 */
    unlistenCellInfo?(): void;
    clear(): void;
}

/** 本地存档端口；落盘实现见 TerritorySaveStoreAdapter。 */
export interface ITerritoryChapterStore {
    loadLastChapter(): number;
    saveLastChapter(chapterId: number): void;
    load(chapterId: number, walletSeed: TerritoryWallet): TerritoryChapterSave;
    saveProgress(
        chapterId: number,
        progress: TerritoryProgressData,
        source: TerritoryChapterSave,
    ): TerritoryChapterSave;
    saveWallet(chapterId: number, wallet: TerritoryWallet, source: TerritoryChapterSave): TerritoryChapterSave;
    settleIdleRewards(
        chapterId: number,
        sources: readonly TerritoryIdleRewardSource[],
        maxHours: number,
        now: number,
        source: TerritoryChapterSave,
    ): TerritoryIdleRewardSaveResult;
    beginBattle(
        chapterId: number,
        request: {
            cellId: number;
            levelId: number;
            silverCost: number;
            staminaCost: number;
        },
        source: TerritoryChapterSave,
    ): TerritoryBeginBattleResult;
    clearBattle(chapterId: number, source: TerritoryChapterSave): TerritoryChapterSave;
}

// ============================================================
// 输出（页面实现）
// ============================================================

/** navigateToBattle 收到的就是现 ProcedureManager.navigate 的 { pve: … } 里的 pve。 */
export interface ITerritoryBattleNavParams {
    readonly levelId: number;
    readonly chapterId: number;
    readonly stage: number;
    readonly territoryCellId: number;
    readonly mode: TerritoryCampaignStage['mode'];
    readonly enemyName: string;
    readonly enemyCardIds: number[];
    readonly enemyTeamCardIds: readonly (readonly number[])[];
    readonly playerCount: number;
    readonly hpRate: number;
    readonly attackRate: number;
    readonly waves: ReadonlyArray<{
        readonly waveId: number;
        readonly showAtSeconds: number;
        readonly pvpCardId: number;
        readonly monsterCount: number;
        readonly hpRate: number;
        readonly attackRate: number;
    }>;
}

export interface ITerritoryPresenterOutputs {
    readonly navigateToBattle: (pve: ITerritoryBattleNavParams, battle?: ZCBattleStart) => void;
    readonly showTip: (text: string) => void;
    /**
     * 发奖反馈。
     *
     * @param originCellId 奖励来自哪一格（资源点领取 / 随机格开启 ⇒ 那一格的 `cellId`；
     *   挂机产出按关卡结算、**没有格子** ⇒ `null`）。页面用它决定飘字落点
     *   （`null` 时回落到起始格），见 `TerritoryResourceGain` 的口径说明。
     */
    readonly showRewards: (
        rewards: readonly (TerritoryIdleRewardGain | ITerritoryGrantedReward)[],
        originCellId?: number | null,
        options?: ITerritoryRewardPresentation,
    ) => void;
    /**
     * 与服务端通信中的全屏遮挡开关（解锁 / 通关 / 开战 / 随机格开启的写请求在途时
     * `busy=true`，全部结束后 `busy=false`）。页面用工程通用 `LoadingPopup` 实现：
     * 请求期间玩家无法点击，从源头防快速点击重复发包。
     *
     * 标成**可选**：测试与部分注入的桩 outputs 没实现它时，业务照常走，只是少了遮挡。
     * 文案由 Presenter 按操作类型给出（`TERRITORY_TEXTS.busy*`）。
     */
    readonly setBusy?: (busy: boolean, text?: string) => void;
}

/**
 * 发奖时**用哪套表现**（需求 2026-10-22 §1）。
 *
 *  · `chest`（默认）：资源点 / 宝箱类格子 —— 先播开箱表演，播完再结算；
 *  · `burst`：**随机资源格** —— 不播开箱，直接在格子上喷一把资源图标
 *    （沿用宝箱中档的粒子喷射表现，个数按奖励量分级，见 `territoryBurstCountForTotal`）。
 *
 *  为什么要由 Presenter 指定而不是页面自己判：**这是玩法口径**（哪种格子该放全屏表演），
 *  页面只该负责"怎么演"。将来多一种格子，也在这里加一个枚举值即可。
 */
export interface ITerritoryRewardPresentation {
    readonly chest?: boolean;
}

export interface ITerritoryPresenterPorts {
    readonly loader: ITerritoryChapterLoader;
    readonly gateway: ITerritoryCellGateway;
    readonly store: ITerritoryChapterStore;
    readonly outputs: ITerritoryPresenterOutputs;
    readonly walletSeed: () => TerritoryWallet;
    readonly readServerWallet: () => TerritoryWallet | null;
    readonly availableChapters: readonly number[];
    /** 网络请求的生命周期宿主（页面组件；断网/销毁时取消请求）。 */
    readonly lifecycleHost?: unknown;
}

/**
 * 两步式**资源点**的解锁 / 通关文案。
 *
 * ⚠️ 早期这里还有一组 `stage`（两步式**关卡**）文案，现已删除：
 * 战斗站点的两步式第二步是**开战**（走 `handleBattleStationStart`），不发通关请求，
 * 所以那组「已解锁，点击通关 / 通关失败」永远不会出现了。
 * `TERRITORY_TEXTS.stagePass*` 本身**不删** —— `TerritoryMapView` 的角标还在用。
 */
const TERRITORY_TWO_STEP_TEXTS = {
    fixedResource: {
        // 解锁成功**不再提示**（需求 2026-10-22 §3：关掉「已解锁，点击宝箱领取」那条 UI）。
        // 留空串而不是删字段：`handleUnlockThenPass` 的 texts 契约里 `unlocked` 是必填，
        // 删了要动签名，而"这次要不要提示"本来就是文案层的决定。
        unlocked: '',
        unlockFailed: TERRITORY_TEXTS.fixedResourceUnlockFailed,
        // 领取成功**也不再提示**（2026-10-22 追加：实机截图里那条「已领取」深色条正压在地图中央，
        // 把刚开的宝箱和地块都盖住了；结果是"领取成功"这件事已经由开箱表演 + 奖励飘字表达，
        // 再叠一条躺在屏幕中间的文字纯属抢画面）。同样用空串静音，不加开关。
        claimed: '',
        claimFailed: TERRITORY_TEXTS.fixedResourceClaimFailed,
    },
} as const;

// ============================================================
// 视图状态
// ============================================================

export interface ITerritoryDetailState {
    readonly open: boolean;
    readonly content: ITerritorySiteDetailContent | null;
}

/** 领地章节 HUD 的纯呈现数据；主城地图宿主不渲染这组字段。 */
export interface ITerritoryHudRender {
    readonly chapterText: string;
    readonly walletText: string;
    readonly walletHighlight: boolean;
    readonly inventoryText: string;
    readonly hintText: string;
    readonly previousEnabled: boolean;
    readonly nextEnabled: boolean;
    readonly nextCaption: string;
}

export interface ITerritoryViewState {
    readonly ready: boolean;
    readonly chapterId: number;
    readonly map: TerritoryMapConfig | null;
    readonly layout: ITerritoryMapLayout;
    readonly art: ITerritoryBattleArt;
    readonly progress: TerritoryProgress | null;
    readonly revealedCells: readonly number[];
    readonly siteOpenableCells: readonly number[];
    readonly stageByCell: ReadonlyMap<number, TerritoryCampaignStage>;
    readonly randomResourceCells: readonly number[];
    readonly randomResourceOpenableCells: readonly number[];
    readonly pendingRandomResourceCells: readonly number[];
    readonly pendingFixedResourceCells: readonly number[];
    readonly hud: ITerritoryHudRender | null;
    readonly detail: ITerritoryDetailState;
}

interface TerritoryStageView {
    site: TerritorySite;
    stage: TerritoryCampaignStage;
}

/**
 * 领地页纯 TS 编排器。
 *
 *  持有地图配置 / 玩家进度 / 本地存档与服务端格子端口，对页面暴露 intent 方法和一个视图状态。
 *  **不 import cc / 其他 app feature**：所有副作用（导航、提示、奖励弹层、存档落盘、
 *  资源加载、网络）都经端口进入，因此本类可以在 Node 下直接单测。
 *
 *  framework 只允许纯 TS 的事件中控 `EventMgr`（零依赖，可直接 require，zcds 同款）：
 *  状态变更经 `EventMgr.instance.emit(TERRITORY_PRESENTER_EVENTS.StateChange)` 广播，
 *  页面订阅后须在 `onDestroy` 里 `offTarget(this)` 摘干净（见 `TerritoryEvents.ts`）。
 *
 *  页内刷新只有这一个通知通道——加载失败走 `outputs.showTip` 轻提示，
 *  不再有整页 loading 面板（生产口径：本地存档先渲染、服务端状态后台合并、失败不锁屏）。
 */
export class TerritoryPresenter {

    private currentChapterId: number;
    private map: TerritoryMapConfig | null = null;
    private progress: TerritoryProgress | null = null;
    private saveState: TerritoryChapterSave | null = null;
    private serverCellStateCache: ITerritoryCellState | null = null;
    private stages: TerritoryStageView[] = [];
    private stageByCell = new Map<number, TerritoryCampaignStage>();
    private layout: ITerritoryMapLayout = { points: new Map(), width: 0, height: 0, paintOrder: [] };
    private art: ITerritoryBattleArt = {
        background: null,
        // 地皮两态（未通关 / 已通关）+ 四张「已解锁未通关」的格面框，口径见 `TerritoryMapView.paintHexes`。
        tileLocked: null,
        tileCleared: null,
        frameBoss: null,
        frameStage: null,
        frameAsyncPvp: null,
        frameChest: null,
        start: null,
        stage: null,
        boss: null,
        asyncPvp: null,
        fixedResource: null,
        randomResource: null,
        randomSilverIcon: null,
        bonus: null,
        header: null,
        navButton: null,
        actionButton: null,
        // 空表 = 一个建筑 id 都查不到⇒ 视图全部退回按 `site.type` 取图（旧行为）。
        buildFrames: new Map(),
        // 空表 = 所有建筑倍率按 1（与引入 buildSize 之前完全一致）。
        buildScales: new Map(),
    };
    private playerCardCount = 0;
    private idleRewardMaxHours = TERRITORY_IDLE_REWARD_MAX_HOURS_FALLBACK;
    private startingBattle = false;
    private pendingFixedResourceCells = new Set<number>();
    private pendingRandomResourceCells = new Set<number>();
    private battleRequestId = 0;
    /** 玩家写请求在途数；> 0 时全屏 loading 遮挡（引用计数，多请求并发只显一层）。 */
    private busyCount = 0;
    private reportingLoadId: number | null = null;
    private loadId = 0;
    private resultNotice = '';
    private detailStage: TerritoryCampaignStage | null = null;
    private detailSite: TerritorySite | null = null;
    private randomResourceCells: number[] = [];
    /** 开战失败后显示的原因；请求进行中由 startingBattle 驱动转圈。 */
    private battleStartNotice: string | null = null;
    /** Boss 关最近一次 `CmdStartBattleReqMsg` 成功回包的战斗信息（battleId/seed）。 */
    private bossBattleStart: { readonly battleId: string; readonly seed: string } | null = null;
    private disposed = false;

    constructor(private readonly ports: ITerritoryPresenterPorts) {
        this.currentChapterId = ports.store.loadLastChapter();
    }

    // ============================================================
    // 生命周期
    // ============================================================

    start(): void {
        void this.loadChapter(this.currentChapterId);
    }

    /** CmdRole 缓存更新后调用；只有服务端余额能覆盖本地钱包。 */
    refreshWalletFromServer(emit = true): void {
        if (this.disposed || !this.map || !this.saveState) return;
        const wallet = this.ports.readServerWallet();
        if (!wallet || !Number.isSafeInteger(wallet.silver) || wallet.silver < 0
            || !Number.isSafeInteger(wallet.stamina) || wallet.stamina < 0) return;
        if (wallet.silver === this.saveState.wallet.silver
            && wallet.stamina === this.saveState.wallet.stamina) return;
        this.saveState = this.ports.store.saveWallet(this.map.chapterId, wallet, this.saveState);
        if (emit) this.emitStateChange();
    }

    dispose(): void {
        this.disposed = true;
        this.cancelBattleRequest();
        // 🔴 写请求在途时页面被销毁 ⇒ 撤掉本页面贡献的每层 loading（enterBusy 的 show
        // 与这里逐次 hide 配对）。不清理会留下全屏遮罩：`LoadingPopup` 引用计数不为 0
        // 永不关闭，遮罩上的 `BlockInputEvents` 常驻吞点击，其他页面「点不动」。
        while (this.busyCount > 0) {
            this.busyCount -= 1;
            this.ports.outputs.setBusy?.(false);
        }
        // 必须退订：Bro 监听挂在 `GameNet` 上（进程级），Presenter 销毁后还在监听会往
        // 已dispose 的对象上回调，表现为「关页面后再进，格子莫名变已占领」。
        this.ports.gateway.unlistenPassCellsBro?.();
        this.ports.gateway.unlistenCellInfo?.();
        // 全局中控上的残留监听一并摘干净（zcds 的 `ZCGame.shutdown` 同款；
        // 页面侧由 `MainTerritoryMap.onDestroy` 的 `offTarget(this)` 负责）。
        EventMgr.instance.offTarget(this);
    }

    /** Boss 关最近一次开战请求成功返回的战斗信息；未开战过为 `null`。 */
    get lastBossBattleStart(): Readonly<{ battleId: string; seed: string }> | null {
        return this.bossBattleStart;
    }

    // ============================================================
    // intents
    // ============================================================

    /** 快速寻敌只选中详情并返回定位格，不调用点击站点的解锁 / 开战流程。 */
    focusCurrentBoss(): number | null {
        if (this.disposed || this.startingBattle || this.busyCount > 0) return null;
        if (!this.map || !this.progress || this.map.chapterId !== this.currentChapterId) {
            this.ports.outputs.showTip(TERRITORY_TEXTS.loadingChapter);
            return null;
        }
        const target = findCurrentTerritoryBoss(this.map.sites, this.stageByCell, this.progress);
        if (!target) {
            this.closeDetail();
            this.ports.outputs.showTip(TERRITORY_TEXTS.noBossTarget);
            return null;
        }
        this.cancelBattleRequest();
        this.detailSite = target.site;
        this.detailStage = target.stage;
        this.emitStateChange();
        return target.site.cellId;
    }

    selectSite(site: TerritorySite): void {
        if (this.disposed || !this.progress || !this.map
            || !territoryRevealedCells(this.map, this.progress).includes(site.cellId)) return;
        if ((site.type === TERRITORY_SITE_TYPE.stage || site.type === TERRITORY_SITE_TYPE.boss || site.type === TERRITORY_SITE_TYPE.asyncPvp)
            && this.progress.isCellUnlocked(site.cellId)
            && this.pendingFixedResourceCells.has(site.cellId)) return;
        this.cancelBattleRequest();
        // 可开战站点（`stage` / `boss` / `asyncPvp`）统一走「两步式」：先解锁展示建筑；已解锁再次点击
        // → `CmdStartBattleReqMsg` 开战（**不发**通关）。
        //
        // 🔴 2026-10-15 口径（山猫）：「点建筑就开始」是**所有关卡**的行为，不是 327/328 的特例。
        // 早前这里只有 `bossStage?.isBoss || isTerritoryTwoStepCell(site.cellId)`（硬编码 `[327,328]`）
        // ⇒ 关卡 2（configId 10002，cells 288/309/310）既不 isBoss 也不在名单里
        // ⇒ 落到下面的详情面板分支，表现为「点建筑没反应、只能弹面板」。
        // ⚠️ 判据：**站点类型**决定走哪条路，`isBoss`（= `levelMod === 2`）与是否绑到 campaign
        // 都不是准入条件 —— 找不到战斗配置时走 `handleUnlockOnly`，不会发空请求。
        //（`stageByCell` 已把主线与 asyncPvp 的同区域格子都填上 stage，见 `loadChapter`。）
        if (site.type === TERRITORY_SITE_TYPE.stage || site.type === TERRITORY_SITE_TYPE.boss || site.type === TERRITORY_SITE_TYPE.asyncPvp) {
            const stage = this.stageByCell.get(site.cellId) ?? null;
            this.detailSite = null;
            this.detailStage = null;
            this.emitStateChange();
            if (stage) {
                void this.handleBattleStationStart(site, stage);
            } else {
                // 没有 stage 绑定（绑不到 campaign 行）⇒ 无从开战，退回纯解锁那一步，
                // 别硬发一个没有 battleParams 语义的请求。
                void this.handleUnlockOnly(site);
            }
            return;
        }
        // 只剩**资源点**走「解锁 → 通关」（`CmdCityChapterPassCellReqMsg`）。
        // 关卡（`stage` / `boss`）已在上面那条分支 return 掉 —— 给关卡发通关会被服务端
        // 回「章节格子非资源类型」（早期实机踩过），别把这两条路合并。
        if (site.type === TERRITORY_SITE_TYPE.fixedResource) {
            this.detailSite = null;
            this.detailStage = null;
            this.emitStateChange();
            void this.handleUnlockThenPass(site, TERRITORY_TWO_STEP_TEXTS.fixedResource);
            return;
        }
        this.detailSite = site;
        this.detailStage = this.stageByCell.get(site.cellId) ?? null;
        this.battleStartNotice = null;
        this.emitStateChange();
    }

    /** 点随机格直接开启；资源校验、失败提示和防连点统一由开启流程处理。 */
    selectRandomResource(cellId: number): void {
        if (this.disposed || !this.map?.randomSites?.candidateCells.includes(cellId)) return;
        this.cancelBattleRequest();
        this.detailSite = null;
        this.detailStage = null;
        this.battleStartNotice = null;
        this.emitStateChange();
        void this.openRandomResourceCell(cellId);
    }

    closeDetail(): void {
        this.cancelBattleRequest();
        this.detailSite = null;
        this.detailStage = null;
        this.battleStartNotice = null;
        this.emitStateChange();
    }

    requestBattle(): void {
        const site = this.detailSite;
        const stage = this.detailStage;
        if (this.disposed || !site || !this.map || !this.saveState || !this.progress) return;
        if (!stage || this.startingBattle) return;
        if (!this.progress.isOwned(site.cellId) && !this.progress.isCellUnlocked(site.cellId)
            && !this.progress.checkUnlock(site.cellId, Number.MAX_SAFE_INTEGER).ok) return;
        if (!this.progress.isOwned(site.cellId)
            && (site.type === TERRITORY_SITE_TYPE.boss || site.type === TERRITORY_SITE_TYPE.stage
                || site.type === TERRITORY_SITE_TYPE.asyncPvp)) {
            if (this.pendingFixedResourceCells.has(site.cellId)) return;
            void this.handleBattleStationStart(site, stage);
            return;
        }
        void this.startBattle(site, stage);
    }

    /** 固定资源点先解锁并露出宝箱，再由下一次点击请求通关领奖。 */
    private async handleFixedResource(site: TerritorySite): Promise<void> {
        await this.handleUnlockThenPass(site, TERRITORY_TWO_STEP_TEXTS.fixedResource);
    }

    /**
     * 战斗站点两步式：与两步式**资源点**同交互骨架，但第二步**不发** `CmdCityChapterPassCellReqMsg`，
     * 改为发 `CmdStartBattleReqMsg` 请求战斗信息
     * （`battleType = ZC_BATTLE_TYPE_CHAPTER`（1002，**固定**章节战斗类型）、
     *   `battleParams = [子类型, 章节id, 格子id]`（子类型 = 1 格子战斗，见
     *   `chapterCellBattleParams`）—— 关卡身份靠 `格子id` 定位，不是 battleType）。
     */
    private async handleBattleStationStart(
        site: TerritorySite,
        stage: TerritoryCampaignStage,
    ): Promise<void> {
        const progress = this.progress;
        const map = this.map;
        if (!progress || !map) return;
        // 🔴 已通关（owned）的关卡 / 首领不再开战（主线打完即通关，旧口径）；
        // **异步据点（asyncPvp）例外 —— 可重复挑战**：它是异步 PVP 玩法，通关后还能再打
        // （`TERRITORY_TEXTS.owned = '已占领，可重复挑战'`）。owned 的 asyncPvp 通常同时
        // 在服务端 `unlockCells` 里 ⇒ 落到下面的第二步直接开战；即使不在，也跳过解锁直接开战。
        const isOwned = progress.isOwned(site.cellId);
        if (isOwned && site.type !== TERRITORY_SITE_TYPE.asyncPvp) return;
        // 🔴 `selectSite` 开头已经 `cancelBattleRequest()` 递增过 ⇒ 记下这一次的号，回包到了先核对。
        // 「上一次点击的解锁回包迟到 ⇒ 把界面解锁」是**必须**挡住的：关卡现在是所有关卡型站点的
        // 通例，连点比只有两格特例（327/328）时常见得多。
        const requestId = this.battleRequestId;
        if (!progress.isCellUnlocked(site.cellId)
            && !(isOwned && site.type === TERRITORY_SITE_TYPE.asyncPvp)) {
            // 第一步：解锁并展示建筑（与两步式同一口径），不发战斗请求。
            if (!territoryRevealedCells(map, progress).includes(site.cellId)) return;
            // 同一格的解锁还在飞 ⇒ 别再发一次（否则连点会连发解锁、回包到了重复弹提示）
            if (this.pendingFixedResourceCells.has(site.cellId)) return;
            const check = progress.checkUnlock(site.cellId, Number.MAX_SAFE_INTEGER);
            if (!check.ok) {
                if ('reason' in check) this.ports.outputs.showTip(check.reason);
                return;
            }
            const wallet = this.saveState?.wallet;
            if (!wallet) return;
            if (wallet.silver < site.unlock.silverCost) {
                this.ports.outputs.showTip(TERRITORY_TEXTS.silverNotEnough);
                return;
            }
            if (wallet.stamina < site.unlock.staminaCost) {
                this.ports.outputs.showTip(TERRITORY_TEXTS.staminaNotEnough);
                return;
            }
            const pending = this.pendingFixedResourceCells;
            const loadId = this.loadId;
            pending.add(site.cellId);
            this.emitStateChange();
            const exitBusy = this.enterBusy(TERRITORY_TEXTS.busyUnlock);
            try {
                const result = await this.ports.gateway.unlockCell(
                    map.chapterId, site.cellId, this.ports.lifecycleHost,
                );
                // ⚠️ requestId 变了 = 期间又点过别的地方 ⇒ 这次的结果已经不属于当前交互，直接丢。
                if (this.disposed || loadId !== this.loadId
                    || requestId !== this.battleRequestId) return;
                if (result.ok) {
                    // 🔴 按**回包给的数组**逐格记账：服务端一次解锁整片区域（请求 327 → 回 [327,328]），
                    // 只记请求那一格 ⇒ 同区域其余格界面上仍是锁态。
                    progress.markCellsUnlocked(result.unlockedCellIds ?? [site.cellId]);
                    this.persistProgress();
                    this.refreshWalletFromServer(false);
                    this.ports.outputs.showTip(TERRITORY_TEXTS.bossUnlocked);
                } else {
                    this.ports.outputs.showTip(TERRITORY_TEXTS.bossUnlockFailed);
                }
            } finally {
                pending.delete(site.cellId);
                exitBusy();
            }
            // 渲染最终态（pending 已清）：try 内渲染的是「请求在途」帧（Button 禁用），
            // finally 删掉 pending 后必须再渲染一次，否则解锁成功站点仍停留禁用帧。
            this.emitStateChange();
            return;
        }
        // 第二步：已解锁 → `CmdStartBattleReqMsg`，成功才进入战斗。
        //
        // ⚠️ `battleType` 是**固定 1002**（章节战斗类型），**不是** `site.configId` ——
        // battleType 表达「打哪一类战斗」，下面还嵌了一层**子类型**占 `battleParams[0]`（1 = 格子战斗），
        // 关卡身份由 `battleParams[2]` 的格子 id 定位（山猫 2026-10-15 定）。
        // 早期误传 `configId`（每关不同，如 10001）⇒ 服务端按未知类型处理，点 Boss 关没反应。
        //
        // ⚠️ 也不做 `configId` 整数校验了：它已不参与这条请求，缺了不该拦住开战
        //（缺的是 `cellId`，而那来自站点本身，一定有）。
        //
        // ⚠️ 防连点：同一格**开战请求还在飞** ⇒ 别再发一次（与第一步解锁的 `pending` 判重同款；
        // 全屏 loading 是主防线，这里是代码层第二道）。
        //
        // 🔴 不再用「这一格已经拿到 battleId」（`bossBattleStart`）当判据：那是**上一次开战**的
        // 全局单值记录，navigate 后已消费并清空（见 `beginBattle`），拿它拦重复点击会把
        // 已通关格（asyncPvp 可重复挑战）在本章节里**永久锁死**；也不能用 `isOwned` 拦
        // （开战后到结算回报前本地不是 owned，拦不住连点，见下）。
        if (this.pendingFixedResourceCells.has(site.cellId)) return;
        const pending = this.pendingFixedResourceCells;
        const loadId = this.loadId;
        pending.add(site.cellId);
        this.emitStateChange();
        const exitBusy = this.enterBusy(TERRITORY_TEXTS.busyBattle);
        try {
            // 🔴 asyncPvp（异步据点）的子类型按**服务端确认的通关状态**分流（山猫 2026-10-21 细化）：
            //  未通关（首次挑战）→ 子类型 1（格子战斗 `chapterCellBattleParams`）；
            //  已通关（重复挑战）→ 子类型 2（宝箱战斗 `chapterTreasureBattleParams`）。
            //  判据必须用 `isServerOwned`（快照 `passCells` 权威）而非 `isOwned`：本地旧档残留 /
            //  离线结算未上报会让 owned 领先服务端 ⇒ 没打过的格也传 2，服务端回「配置错误」；
            //  而「一律传 1」又会把已通关格按主线关卡判定拒掉。两个方向都实测踩过。
            // （主线 stage/boss 恒为格子战斗子类型 1，不参与这个分流。）
            const battleParams = site.type === TERRITORY_SITE_TYPE.asyncPvp
                ? (progress.isServerOwned(site.cellId)
                    ? chapterTreasureBattleParams(map.chapterId, site.cellId)
                    : chapterCellBattleParams(map.chapterId, site.cellId))
                : chapterCellBattleParams(map.chapterId, site.cellId);
            const result = await this.ports.gateway.startBattle(
                ZC_BATTLE_TYPE_CHAPTER,
                battleParams,
                this.ports.lifecycleHost,
            );
            if (this.disposed || loadId !== this.loadId || requestId !== this.battleRequestId) return;
            if (!result.ok) {
                this.ports.outputs.showTip(TERRITORY_TEXTS.bossBattleStartFailed);
            } else {
                this.bossBattleStart = { battleId: result.battle.battleId, seed: result.battle.seed };
                this.beginBattle(site, stage, result.battle);
            }
        } finally {
            pending.delete(site.cellId);
            exitBusy();
        }
        // 失败也要渲染最终态（pending 已清 → 按钮恢复可点）；成功已 navigate，此处 emit 无害。
        this.emitStateChange();
    }

    /**
     * 只解锁、不发通关（硬编码两步式关卡**绑不到 stage** 时的兜底）。
     *
     * 为什么需要它：两步式名单里的格子是「关卡」，第二步该开战。
     * ⚠️ `stageByCell` 走 `expandBindingsToAreaSites`（同区域格子共享关卡），
     * 所以**同 `configId` 的格子都能拿到 stage** —— 这一条退化成纯防御：
     * 万一 `configId` 在 `levelInfo` 里真的查不到（表改了 / 行被删），
     * `bossStage === null` ⇒ 无从开战，此时**只解锁**。
     *
     * 此时**只做解锁**，绝不退回 `CmdCityChapterPassCellReqMsg` ——
     * 服务端会回「章节格子非资源类型」并拒绝（用户实测过）。
     */
    private async handleUnlockOnly(
        site: TerritorySite,
        unlockedText: string = TERRITORY_TEXTS.bossUnlocked,
    ): Promise<void> {
        const progress = this.progress;
        const map = this.map;
        if (!progress || !map || progress.isOwned(site.cellId)
            || progress.isCellUnlocked(site.cellId)
            || this.pendingFixedResourceCells.has(site.cellId)) return;
        if (!territoryRevealedCells(map, progress).includes(site.cellId)) return;
        const check = progress.checkUnlock(site.cellId, Number.MAX_SAFE_INTEGER);
        if (!check.ok) {
            if ('reason' in check) this.ports.outputs.showTip(check.reason);
            return;
        }
        const wallet = this.saveState?.wallet;
        if (!wallet) return;
        if (wallet.silver < site.unlock.silverCost) {
            this.ports.outputs.showTip(TERRITORY_TEXTS.silverNotEnough);
            return;
        }
        if (wallet.stamina < site.unlock.staminaCost) {
            this.ports.outputs.showTip(TERRITORY_TEXTS.staminaNotEnough);
            return;
        }
        const pending = this.pendingFixedResourceCells;
        const loadId = this.loadId;
        pending.add(site.cellId);
        this.emitStateChange();
        const exitBusy = this.enterBusy(TERRITORY_TEXTS.busyUnlock);
        try {
            const result = await this.ports.gateway.unlockCell(map.chapterId, site.cellId, this.ports.lifecycleHost);
            if (this.disposed || loadId !== this.loadId) return;
            if (result.ok) {
                progress.markCellsUnlocked(result.unlockedCellIds ?? [site.cellId]);
                this.persistProgress();
                this.refreshWalletFromServer(false);
                this.ports.outputs.showTip(unlockedText);
            } else {
                this.ports.outputs.showTip(TERRITORY_TEXTS.bossUnlockFailed);
            }
        } finally {
            pending.delete(site.cellId);
            exitBusy();
        }
        // 渲染最终态（pending 已清）：try 内渲染的是「请求在途」帧（Button 禁用）。
        this.emitStateChange();
    }

    /**
     * 两步式**资源点**（`fixedResource`）：先解锁展示建筑，再由下一次点击请求通关
     * （`CmdCityChapterPassCellReqMsg`）。
     *
     * ⚠️ **只用于资源点**。战斗站点走 `handleBattleStationStart`——
     * 关卡发通关会被服务端回「章节格子非资源类型」并拒绝。
     */
    private async handleUnlockThenPass(
        site: TerritorySite,
        texts: Readonly<{ unlocked: string; unlockFailed: string; claimed: string; claimFailed: string }>,
    ): Promise<void> {
        const progress = this.progress;
        const map = this.map;
        if (!progress || !map || progress.isOwned(site.cellId)
            || this.pendingFixedResourceCells.has(site.cellId)) return;
        const isUnlocked = progress.isCellUnlocked(site.cellId);
        if (!isUnlocked) {
            if (!territoryRevealedCells(map, progress).includes(site.cellId)) return;
            const check = progress.checkUnlock(site.cellId, Number.MAX_SAFE_INTEGER);
            if (!check.ok) {
                if ('reason' in check) this.ports.outputs.showTip(check.reason);
                return;
            }
            const wallet = this.saveState?.wallet;
            if (!wallet) return;
            if (wallet.silver < site.unlock.silverCost) {
                this.ports.outputs.showTip(TERRITORY_TEXTS.silverNotEnough);
                return;
            }
            if (wallet.stamina < site.unlock.staminaCost) {
                this.ports.outputs.showTip(TERRITORY_TEXTS.staminaNotEnough);
                return;
            }
        }
        const pending = this.pendingFixedResourceCells;
        const loadId = this.loadId;
        pending.add(site.cellId);
        this.emitStateChange();
        const exitBusy = this.enterBusy(isUnlocked ? TERRITORY_TEXTS.busyPass : TERRITORY_TEXTS.busyUnlock);
        try {
            const result = isUnlocked
                ? await this.ports.gateway.passCell(map.chapterId, site.cellId, this.ports.lifecycleHost)
                : await this.ports.gateway.unlockCell(map.chapterId, site.cellId, this.ports.lifecycleHost);
            if (this.disposed || loadId !== this.loadId) return;
            if (result.ok) {
                if (isUnlocked) progress.markCellPassed(site.cellId);
                else progress.markCellsUnlocked(result.unlockedCellIds ?? [site.cellId]);
                this.persistProgress();
                this.refreshWalletFromServer(false);
                // 空串 = 这次不提示（资源点解锁不再弹「已解锁，点击宝箱领取」，见 §3）。
                const tip = isUnlocked ? texts.claimed : texts.unlocked;
                if (tip) this.ports.outputs.showTip(tip);
                if (isUnlocked && result.rewards?.length) {
                    this.ports.outputs.showRewards(result.rewards, site.cellId);
                }
            } else {
                this.ports.outputs.showTip(isUnlocked
                    ? texts.claimFailed : texts.unlockFailed);
            }
        } finally {
            pending.delete(site.cellId);
            exitBusy();
        }
        // 🔴 渲染必须发生在 pending 清空之后：视图的 `isLoading` 由 `pendingFixedResourceCells`
        // 驱动（`TerritoryStationView.render`：`interactable = interactive && !isLoading`），
        // try 内的 `emitStateChange` 渲染的是「请求在途」帧（Button 禁用）。此前 finally 删掉
        // pending 后不再渲染 ⇒ 页面停留在在途帧：宝箱已解锁、图标可领取外观，但点击被禁用
        // ⇒ 实机「弹出已解锁宝箱可领取，再次点击领不了」。
        //（`disposed / loadId` 变化在 try 内已 return，到不了这里 —— 旧结果不渲染。）
        this.emitStateChange();
    }

    private randomResourceOpenCheck(cellId: number): TerritoryRandomCellOpenCheck {
        const map = this.map;
        const progress = this.progress;
        const wallet = this.saveState?.wallet;
        if (!map || !progress || !wallet || !map.randomSites) {
            return { ok: false, reason: 'notCandidate' };
        }
        return canOpenTerritoryRandomCell({
            cellId,
            rows: map.rows,
            columns: map.columns,
            candidateCells: map.randomSites.candidateCells,
            openedCells: Array.from(new Set(progress.ownedCells.concat(progress.unlockedCells))),
            silver: wallet.silver,
            stamina: wallet.stamina,
            silverCost: map.randomSites.triggerSilver,
            staminaCost: map.defaults.staminaCost,
        });
    }

    private async openRandomResourceCell(cellId: number): Promise<void> {
        const map = this.map;
        const progress = this.progress;
        if (!map || !progress || this.pendingRandomResourceCells.has(cellId)) return;
        const check = this.randomResourceOpenCheck(cellId);
        if (!check.ok) {
            if ('reason' in check && check.reason !== 'alreadyOpen' && check.reason !== 'notCandidate') {
                const reason = check.reason === 'silver' ? TERRITORY_TEXTS.silverNotEnough
                    : check.reason === 'stamina' ? TERRITORY_TEXTS.staminaNotEnough
                        : TERRITORY_TEXTS.randomNeedsNeighbor;
                this.ports.outputs.showTip(reason);
            }
            return;
        }
        const pending = this.pendingRandomResourceCells;
        const loadId = this.loadId;
        pending.add(cellId);
        this.emitStateChange();
        const exitBusy = this.enterBusy(TERRITORY_TEXTS.busyOpen);
        try {
            const result = await this.ports.gateway.unlockCell(map.chapterId, cellId, this.ports.lifecycleHost);
            if (this.disposed || loadId !== this.loadId) return;
            if (result.ok) {
                // 🔴 随机格「解锁即通关」：服务端在解锁回包时已发奖，没有通关请求。
                // 只记 unlockable ⇒ 地图底色仍是泥地（未通关）；必须同时记 owned，
                // 地块才会立即变草地（`img_land_01`），与已领取的固定资源点同口径。
                // 注意不进 pendingPasses —— 随机格永不发 CmdCityChapterPassCellReqMsg。
                const openedCellIds = result.unlockedCellIds ?? [cellId];
                progress.markCellsUnlocked(openedCellIds);
                progress.markCellsPassed(openedCellIds);
                this.persistProgress();
                this.refreshWalletFromServer(false);
                // ⚠️ 不补「已开启」轻提示：随机格是解锁即发奖，奖励弹窗已经承担了这次操作的反馈，
                // 再弹一句轻提示会和奖励窗同时出现（两条 UI 抢同一时刻）。
                // 失败分支的轻提示保留（那时没有奖励窗）。
                // 随机格是**解锁即发奖**，没有"开箱"这一步：直接喷资源图标（需求 2026-10-22 §1）。
                // 粒子个数由页面按奖励总量分级（< 50 很稀疏），不在这里算。
                if (result.rewards?.length) {
                    this.ports.outputs.showRewards(result.rewards, cellId, { chest: false });
                }
            } else {
                this.ports.outputs.showTip(TERRITORY_TEXTS.randomOpenFailed);
            }
        } finally {
            pending.delete(cellId);
            exitBusy();
        }
        // 渲染最终态（pending 已清）：try 内渲染的是「请求在途」帧（Button 禁用），
        // finally 删掉 pending 后必须再渲染一次，否则开完的随机格停留禁用帧点不动。
        this.emitStateChange();
    }

    /**
     * 进入「玩家发起的服务端写请求」时段：全屏 loading 遮挡防连点，直到退出函数被调用。
     *
     * ⚠️ 必须在 **await 之前、所有前置校验通过之后** 调用 —— 校验失败（资源不足 / 不可解锁）不发
     * 请求就不弹遮挡；同一帧内 enter 后立即 exit（校验分支 return）时 loading 来不及渲染，玩家无感。
     * 返回的退出函数幂等，引用计数让「两步式的一次操作」全程只显一层 loading。
     */
    private enterBusy(text: string): () => void {
        this.busyCount += 1;
        this.ports.outputs.setBusy?.(true, text);
        return () => {
            // dispose 已统一撤回在途 loading（见 `dispose`），这里再退就是重复 hide，
            // 会把**其他页面**贡献的 loading 也关掉。
            if (this.disposed) return;
            this.busyCount = Math.max(0, this.busyCount - 1);
            // 🔴 每次 exit 都 hide（与 enterBusy 的 show 严格配对）：`LoadingPopup` 自身是
            // 全局引用计数（show +1 / hide -1、归零才关）。「归零才 hide」在**两个写请求并发**
            // 时（A show 后 B show ⇒ _refCount=2，A exit 不 hide，B exit 归零只 hide 一次 ⇒
            // 残留 1）会让全屏遮罩常驻 —— 遮罩上的 `BlockInputEvents` 会吞掉地图所有点击，
            // 表现为「刚解锁的宝箱再点没反应」。每次 hide 配对后：并发 ⇒ 2→1→0 正常关闭。
            this.ports.outputs.setBusy?.(false);
        };
    }

    private cancelBattleRequest(): void {
        this.battleRequestId += 1;
        this.startingBattle = false;
        this.battleStartNotice = null;
    }

    /**
     * 开战：先问服务端解锁这格，成功（或网络不可用 fail-open）才扣本地资源进战斗。
     *
     *  - `rejected` = 服务端权威说不行 ⇒ 停，按钮恢复，给提示。
     *  - `offline` / `failed` = 不知道 ⇒ 按本地规则继续（战斗结果随后走 passCell 补报）。
     *  反过来（先扣费再问）会在拒绝时白扣银币体力，本地存档是唯一副本，要不回来。
     */
    private async startBattle(site: TerritorySite, stage: TerritoryCampaignStage): Promise<void> {
        const map = this.map;
        if (!map) return;
        const loadId = this.loadId;
        const requestId = ++this.battleRequestId;
        this.startingBattle = true;
        this.battleStartNotice = null;
        this.emitStateChange();

        if (this.progress?.isCellUnlocked(site.cellId)) {
            this.beginBattle(site, stage);
            return;
        }

        const exitBusy = this.enterBusy(TERRITORY_TEXTS.busyBattle);
        try {
            const unlock = await this.ports.gateway.unlockCell(
                map.chapterId, site.cellId, this.ports.lifecycleHost);
            // ⚠️ await 后重新判活：等回包期间可能已关页 / 切章节 / dispose。
            if (loadId !== this.loadId || requestId !== this.battleRequestId || this.disposed) return;
            if ('reason' in unlock) {
                if (unlock.reason === TERRITORY_REQUEST_STATUS.rejected) {
                    this.startingBattle = false;
                    this.battleStartNotice = null;
                    this.ports.outputs.showTip(TERRITORY_TEXTS.unlockRejected);
                    this.emitStateChange();
                    return;
                }
                console.warn(
                    `[TerritoryPresenter] 第 ${map.chapterId} 章格子 ${site.cellId} 解锁请求未确认（${unlock.reason}），按本地继续`,
                );
            }
            if (unlock.ok) this.progress?.markCellsUnlocked(unlock.unlockedCellIds ?? [site.cellId]);

            this.beginBattle(site, stage);
        } finally {
            exitBusy();
        }
    }

    /** 解锁已确认（或网络不可用决定放行）之后，真正扣资源 + 进战斗。 */
    private beginBattle(site: TerritorySite, stage: TerritoryCampaignStage, battle?: ZCBattleStart): void {
        if (!this.map || !this.saveState) return;
        const begin = this.ports.store.beginBattle(this.map.chapterId, {
            cellId: site.cellId,
            levelId: stage.levelId,
            silverCost: site.unlock.silverCost,
            staminaCost: stage.staminaCost,
        }, this.saveState);
        this.saveState = begin.save;
        if (!begin.ok) {
            const reason = 'reason' in begin ? begin.reason : TERRITORY_TEXTS.resourceNotEnoughFallback;
            this.bossBattleStart = null;
            this.startingBattle = false;
            this.battleStartNotice = reason;
            this.ports.outputs.showTip(reason);
            this.emitStateChange();
            return;
        }
        this.emitStateChange();
        this.ports.outputs.navigateToBattle({
            levelId: stage.levelId,
            chapterId: stage.chapterId,
            stage: stage.stage,
            territoryCellId: site.cellId,
            mode: stage.mode,
            enemyName: stage.isBoss ? `第 ${stage.stage} 关首领` : `第 ${stage.stage} 关守军`,
            enemyCardIds: stage.enemies.flatMap((enemy) =>
                enemy.pvpCardId ? [enemy.pvpCardId] : []),
            enemyTeamCardIds: stage.enemyTeamCardIds,
            playerCount: TERRITORY_DEFAULT_PLAYER_COUNT,
            hpRate: stage.hpRate,
            attackRate: stage.attackRate,
            waves: stage.waves.flatMap((wave) => wave.pvpCardId ? [{
                waveId: wave.waveId,
                showAtSeconds: wave.showAtSeconds,
                pvpCardId: wave.pvpCardId,
                monsterCount: wave.monsterCount,
                hpRate: wave.hpRate,
                attackRate: wave.attackRate,
            }] : []),
        }, battle);
    }

    switchChapter(offset: number): void {
        const index = this.ports.availableChapters.indexOf(this.currentChapterId);
        const nextChapter = this.ports.availableChapters[index + offset];
        if (nextChapter === undefined || nextChapter === this.currentChapterId) return;
        if (offset > 0 && !this.chapterCompletion().complete) {
            const completion = this.chapterCompletion();
            this.ports.outputs.showTip(
                TERRITORY_TEXTS.requireChapterComplete(completion.occupied, completion.total),
            );
            return;
        }
        void this.loadChapter(nextChapter);
    }

    /** 1 秒拍：仅在有探索进行时工作；探索到期且无新占领时早退（与旧 tickProgress 口径一致）。 */
    fastTick(now: number): void {
        if (this.disposed || !this.progress || !this.progress.activeExplorations.length) return;
        if (!this.settleProgress(now).length) return;
        const idle = this.settleIdleRewards(now);
        this.ensureRandomResources();
        this.persistProgress();
        this.emitStateChange();
        if (idle?.rewards.length) this.ports.outputs.showRewards(idle.rewards);
    }

    /** 60 秒拍：每拍都结算探索与挂机产出（与旧 tickIdleRewards 口径一致）。 */
    slowTick(now: number): void {
        if (this.disposed) return;
        const claimed = this.settleProgress(now);
        const idle = this.settleIdleRewards(now);
        const randomChanged = this.ensureRandomResources();
        if (claimed.length || idle?.changed || randomChanged) {
            this.persistProgress();
            this.emitStateChange();
        }
        if (idle?.rewards.length) this.ports.outputs.showRewards(idle.rewards);
        void this.reportPendingPasses();
    }

    // ============================================================
    // 章节加载
    // ============================================================

    private async loadChapter(chapterId: number): Promise<void> {
        const { loader, gateway, store, outputs, lifecycleHost } = this.ports;
        const loadId = ++this.loadId;
        this.cancelBattleRequest();
        this.pendingFixedResourceCells = new Set<number>();
        this.pendingRandomResourceCells = new Set<number>();
        // ⚠️ 切章节必须清上一章的开战记录：它是「防连点重发开战请求」的判据，
        // 不清的话换章后点新章的关卡会被当成「已经开过战」而永远拒绝。
        this.bossBattleStart = null;
        // 失败回退用：`currentChapterId` 下面会先切到新章，加载失败要退回旧章
        //（否则 map 还是旧章、currentChapterId 已是新章，页面按新章号渲染旧地图，状态错乱）。
        const previousChapterId = this.currentChapterId;
        this.currentChapterId = chapterId;
        // ⚠️ 切章节必须清上一章的服务端快照：gateway 与 serverCellStateCache 都是内存态，
        // 不清的话这一章会先渲染出上一章的领奖/解锁态，再被新回包覆盖（格子闪一下才变对）。
        gateway.clear();
        this.serverCellStateCache = null;
        store.saveLastChapter(chapterId);
        this.startingBattle = false;
        this.resultNotice = '';
        this.detailStage = null;
        this.detailSite = null;
        this.randomResourceCells = [];
        this.battleStartNotice = null;

        let bundle: ITerritoryChapterBundle | null;
        try {
            bundle = await loader.load(chapterId);
        } catch (error) {
            console.error('[TerritoryPresenter] 领地数据加载失败', error);
            if (loadId === this.loadId && !this.disposed) {
                this.ports.outputs.showTip(TERRITORY_TEXTS.loadFailed);
                this.currentChapterId = previousChapterId;
            }
            return;
        }
        if (loadId !== this.loadId || this.disposed) return;
        if (bundle == null) {
            this.ports.outputs.showTip(TERRITORY_TEXTS.loadFailed);
            this.currentChapterId = previousChapterId;
            return;
        }

        const { mapJson, campaign, art } = bundle;
        const sourceMap = configureTerritoryMap(mapJson);
        const bindings = bindTerritoryStages(sourceMap.sites, campaign.stages);
        const battleBindings = bindTerritoryBattleStages(sourceMap.sites, campaign.stages);
        // 🔴 `stageByCell` 喂的是**扩散后**的表（2026-10-12）：同一 `configId` 的全部站点
        //   都挂上本区域的关卡 ⇒ 「同区域但排在第二个」的格子（cellId 328）不再查不到 stage，
        //   不会误弹「站点配置待补齐 / 当前 PVP-关卡表中没有可绑定关卡」——
        //   实际 `configId` 配了、`levelInfo.json` 里也有那一行，只是被去重踢掉了。
        const stageByCell = expandBindingsToAreaSites(sourceMap.sites, battleBindings);
        const playableMap = applyTerritoryStageUnlocks(sourceMap, bindings);
        this.map = {
            ...playableMap,
            sites: playableMap.sites.map((site) => {
                const stage = stageByCell.get(site.cellId);
                return stage ? {
                    ...site,
                    unlock: {
                        ...site.unlock,
                        staminaCost: stage.staminaCost,
                        exploreSeconds: stage.exploreSeconds,
                    },
                } : site;
            }),
        };
        this.layout = buildTerritoryMapLayout(this.map);
        this.art = art;
        this.playerCardCount = campaign.playerCardCount;
        this.idleRewardMaxHours = campaign.idleRewardMaxHours;
        this.saveState = store.load(this.map.chapterId, this.ports.walletSeed());
        this.progress = new TerritoryProgress(this.map, this.saveState.progress);
        this.refreshWalletFromServer(false);

        // ⚠️ `stages` 是**章节进度分母**（`territoryChapterCompletion` 直接读 length）
        //   ⇒ 必须用**去重后的** `bindings`（一片区域只算一步），不能拿上面的扩散表。
        //   扩散只影响「这一格能不能打 / 显示什么」，不影响「这一片要打几次」。
        this.stages = bindings.map(({ site, stage }) => ({ site, stage }));
        this.stageByCell = stageByCell;
        this.ensureRandomResources();
        console.info('[TerritoryRandomResource] 章节随机点', {
            chapterId: this.map.chapterId,
            candidateCount: this.map.randomSites?.candidateCells.length ?? 0,
            activeCells: Array.from(this.randomResourceCells),
            savedSilver: this.saveState?.wallet.silver ?? 0,
        });

        // 页面立即可用：先用本地存档渲染（地图/进度/随机点/角标都齐了）。
        // 不再等服务端格子状态 —— 服务端慢/超时不再整页锁屏（生产口径：失败不阻断、本地兜底）。
        this.emitStateChange();

        await this.mergeServerState(chapterId, loadId, lifecycleHost);
        if (loadId !== this.loadId || this.disposed) return;

        // 订阅「通关格子」广播（`CmdCityChapterPassCellBroMsg`）。放在 mergeServerState **之后** ——
        // 先把本章权威状态拉齐再开监听，避免「拉取途中到的广播」被 clear 掉或重复落地。
        // 重复调用是幂等的（Repository 只挂一次监听、只换回调）。
        // ⚠️ 可选链：桩网关（单测 / 注入的精简实现）可能没实现订阅，缺了只是收不到广播。
        gateway.listenPassCellsBro?.((broChapter, broCells) => {
            this.applyPassCellsBro(broChapter, broCells);
        });
        // 战斗结束后后端**主动下发**的章节格子状态（非请求响应），收到即刷新。
        gateway.listenCellInfo?.(this.map.rows * this.map.columns, (state) => {
            this.applyCellInfoState(state);
        });

        this.applyStoredBattleResult();
        const now = Date.now();
        this.settleProgress(now);
        this.persistProgress();
        const idle = this.settleIdleRewards(now);
        this.emitStateChange();
        if (idle?.rewards.length) outputs.showRewards(idle.rewards);
        void this.reportPendingPasses();
    }

    /**
     * 落地服务端推来的「通关格子」广播（`CmdCityChapterPassCellBroMsg`）。
     *
     * ## 口径
     *
     * - **章节不匹配直接丢**：Bro 带的是**别的章节**（切章节时服务端可能还在推旧章）。
     *   比对 `map.chapterId`（已归一的那份），不匹配就当没收到 —— 零报错。
     * - **落地复用 `applyServerState`**：它本来就是**单调增加**（服务端有的补进来、
     *   本地已有的保留）、按 `rows × columns` 裁上界、顺带清掉「探索中的那一格」。
     *   Bro 的语义完全一致（服务端权威说这几格通了）⇒ 不另写一套合并逻辑。
     *   ⚠️ 只传 `passCells`、**不传 `unlockCells`**：广播只讲通关，不该顺手放行未解锁的格子。
     * - **只有真新增了才刷新 + 落存档**：同一批格子推两次是常态，
     *   `added` 为空就直接返回，避免无谓的界面刷新与写盘。
     * - ⚠️ **不动 `serverStateKnown`**（别调 `markServerStateKnown`）：那个标志管的是
     *   「服务端状态是否已知」，置 true 后 `isUnlockable` 会从"全放行"收紧成"只看 unlockCells"。
     *   而 **Bro 只讲通关、不带解锁信息**（`unlockCells` 传空）⇒ 一旦置 true，
     *   `unlockable` 还是空集，玩家会**点不动任何格子**。零报错，纯功能塌方。
     *
     * @param levelChapter Bro 里的章节号
     * @param cellIds 本次新增的格子 id（可能一批多个）
     */
    private applyPassCellsBro(levelChapter: number, cellIds: readonly number[]): void {
        if (this.disposed || !this.progress || !this.map) return;
        if (this.normalizeBroChapter(levelChapter) !== this.map.chapterId) return;
        const added = this.progress.applyServerState({ unlockCells: [], passCells: cellIds });
        if (!added.length) return;
        this.persistProgress();
        this.emitStateChange();
        console.info('[TerritoryBro] 收到通关格子广播', {
            chapterId: this.map.chapterId,
            received: cellIds.length,
            added,
        });
    }

    /**
     * Bro 章节号归一。
     *
     * 与 `TerritoryCellRepository.normalizeChapter` **同一口径**（0 / 负数 / NaN → 第 1 章）——
     * 两处必须一致，否则「服务端推 `levelChapter=0`」时 Repository 归成 1、这里却按 0 比对，
     * 格子就白收了（症状：广播收到了但格子没变，且零报错）。
     */
    private normalizeBroChapter(levelChapter: number): number {
        const parsed = Math.floor(Number(levelChapter));
        return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
    }

    /**
     * 落地服务端**主动下发**的章节格子状态（`CmdCityChapterCellInfoRspMsg`）。
     *
     * 与 {@link mergeServerState} 拉到的快照同性质（含 unlockCells/passCells 的完整权威状态），
     * 区别只在"是后端主动推的、不是我们请求的"：
     * - 章节不匹配直接丢（切章节时服务端可能还在推旧章）；
     * - 这是完整快照 ⇒ 可以 `markServerStateKnown(true)`（不像只讲通关的 Bro 不敢 mark）；
     * - 落地复用 `applyServerState`（单调增加、按上界裁剪、清掉待确认的 pendingPasses）；
     * - 只有真新增才刷新 + 落盘，重复推送幂等。
     */
    private applyCellInfoState(state: ITerritoryCellState): void {
        if (this.disposed || !this.progress || !this.map) return;
        if (this.normalizeBroChapter(state.levelChapter) !== this.map.chapterId) return;
        this.progress.markServerStateKnown(true);
        const added = this.progress.applyServerState(state);
        this.serverCellStateCache = state;
        if (!added.length) return;
        this.persistProgress();
        this.emitStateChange();
        console.info('[TerritoryCellInfo] 服务端主动下发章节格子状态', {
            chapterId: this.map.chapterId,
            added,
        });
    }

    /** 随机资源位置只在章节装载时掷点，随后由章节存档固定。 */
    private ensureRandomResources(): boolean {
        const map = this.map;
        const progress = this.progress;
        const save = this.saveState;
        const config = map?.randomSites;
        if (!map || !progress || !save || !config) return false;
        const ownedCells = progress.ownedCells;
        const occupiedCells = [map.startCellId].concat(ownedCells, map.sites.flatMap((site) => site.footprint));
        const occupied = new Set(occupiedCells);
        const candidates = new Set(config.candidateCells);
        const adjacentCandidates = new Set(config.candidateCells.filter((cell) =>
            !occupied.has(cell) && canClaimTerritoryRandomResource(cell, [cell], ownedCells, map)));
        const active = Array.from(new Set(save.randomResourceCells ?? []))
            .filter((cell) => candidates.has(cell) && !occupied.has(cell)
                && (!adjacentCandidates.size || adjacentCandidates.has(cell)))
            .slice(0, config.maxActive);
        // 首个随机点随章节默认展示；triggerSilver 留给服务端后续补点规则。
        while (active.length < config.maxActive) {
            const cell = selectTerritoryRandomResourceCell({
                rows: map.rows,
                columns: map.columns,
                candidateCells: config.candidateCells,
                occupiedCells,
                blockedCells: [],
                activeCells: active,
                claimedCells: [],
                ownedCells,
                maxActive: config.maxActive,
            }, Math.floor(Math.random() * 0x100000000));
            if (cell === null) break;
            active.push(cell);
        }
        const changed = active.length !== this.randomResourceCells.length
            || active.some((cell, index) => cell !== this.randomResourceCells[index]);
        this.randomResourceCells = active;
        this.saveState = { ...save, randomResourceCells: Array.from(active) };
        return changed;
    }

    /**
     * 拉服务端章节格子状态并合并进本地进度。
     *
     *  ⚠️ **失败不阻断页面**：离线 / 超时 / 回包解析失败时沿用本地存档，且不调
     *  `markServerStateKnown()` —— `TerritoryProgress.isUnlockable` 在未知状态下一律放行，
     *  网络抖动不会让玩家点不动格子。静默失败只 console.warn，不弹 tip。
     */
    private async mergeServerState(
        chapterId: number,
        loadId: number,
        host: unknown,
    ): Promise<void> {
        const progress = this.progress;
        const map = this.map;
        if (!progress || !map) return;
        const total = map.rows * map.columns;
        const result = await this.ports.gateway.fetchChapterCells(chapterId, total, host);
        if (loadId !== this.loadId || this.disposed) return;
        // ⚠️ 用 `if ('reason' in result)` 收窄：`!result.ok` 对该联合类型不触发判别式收窄。
        if ('reason' in result) {
            console.warn(`[TerritoryPresenter] 第 ${chapterId} 章服务端格子状态不可用（${result.reason}），沿用本地存档`);
            return;
        }
        progress.markServerStateKnown(true);
        const added = progress.applyServerState(result.state);
        this.serverCellStateCache = result.state;
        // 服务端多给了占领格 ⇒ 本地存档要跟上，否则下次进页面又少一截。
        if (added.length) {
            this.persistProgress();
            this.emitStateChange();
        }
    }

    // ============================================================
    // 进度 / 存档
    // ============================================================

    private applyStoredBattleResult(): void {
        if (!this.map || !this.progress || !this.saveState?.battle) return;
        const battle = this.saveState.battle;
        // ⚠️ 战斗已有结果 ⇒ 清掉 `bossBattleStart`，否则这一格会被「已开过战」的防重**永久拒绝**。
        // 该字段只在 `loadChapter` 末尾被消费一次（战斗页读它拿 battleId/seed）。
        this.bossBattleStart = null;
        if (battle.status === TERRITORY_BATTLE_STATUS.pending) {
            // 未收到结算确认时保留记录；下一次进入领地仍可用服务端格子快照核对。
            if (this.progress.isOwned(battle.cellId)) {
                this.saveState = this.ports.store.clearBattle(this.map.chapterId, this.saveState);
            } else {
                this.resultNotice = TERRITORY_TEXTS.battleIncomplete;
            }
            return;
        }
        if (battle.status === TERRITORY_BATTLE_STATUS.victory) {
            const result = this.progress.startExplore(
                battle.cellId,
                Number.MAX_SAFE_INTEGER,
                battle.resolvedAt ?? Date.now(),
            );
            this.resultNotice = result.ok ? TERRITORY_TEXTS.victory : TERRITORY_TEXTS.victoryNoExplore;
        } else if (battle.status === TERRITORY_BATTLE_STATUS.defeat) {
            this.resultNotice = TERRITORY_TEXTS.defeat;
        }
        this.saveState = this.ports.store.clearBattle(this.map.chapterId, this.saveState);
    }

    private settleProgress(now: number): number[] {
        if (!this.progress) return [];
        const claimed = this.progress.settle(now);
        if (claimed.length) {
            this.resultNotice = TERRITORY_TEXTS.newlyOwned(claimed.length);
            if (this.chapterCompletion().complete) {
                this.resultNotice += TERRITORY_TEXTS.chapterComplete;
            }
            // 占领与待补报队列一起落盘，防止发包前关页丢失待确认记录。
            this.persistProgress();
            void this.reportPendingPasses();
        }
        return claimed;
    }

    /**
     * 战斗胜利格子的服务端确认（定时拍 / 重进重试）。
     *
     * 🔴 **只补解锁，绝不发 `CmdCityChapterPassCellReqMsg`**：
     * `pendingPasses` 里的格子全部来自战斗胜利后的**关卡格**（stage/boss/asyncPvp，见
     * `settle` → `startExplore`），而关卡通关由服务端在战斗结束后**主动下发**
     * `CmdCityChapterCellInfoRspMsg`（或通关广播）；对关卡格发通关请求只会被回
     * 「章节格子非资源类型」（2026-10-13 用户实测）。
     * 所以这里只做离线兜底的**补解锁**（离线开战可能连解锁都没送达，让服务端先
     * 知道这格），之后格子留在 `pendingPasses` 等推送 —— `applyServerState`
     * 收到服务端 `passCells` 时会自动 `delete` 清账（见 `TerritoryProgress`）。
     */
    private async reportPendingPasses(): Promise<void> {
        if (this.disposed || !this.map || !this.progress || this.reportingLoadId === this.loadId) return;
        const loadId = this.loadId;
        const chapterId = this.map.chapterId;
        const progress = this.progress;
        this.reportingLoadId = loadId;
        try {
            for (const cellId of progress.pendingPassCells) {
                // 离线开战可能连解锁都没送达 ⇒ 补解锁（这是唯一需要发的请求）。
                if (!progress.serverStateKnown || !progress.isUnlockable(cellId)) {
                    const unlock = await this.ports.gateway.unlockCell(chapterId, cellId, this.ports.lifecycleHost);
                    if (this.disposed || loadId !== this.loadId) return;
                    if (!unlock.ok) break;
                    progress.markCellsUnlocked(unlock.unlockedCellIds ?? [cellId]);
                }
                // 🔴 不发 passCell：关卡通关等服务端主动下发，applyServerState 清 pendingPasses。
            }
        } finally {
            if (this.reportingLoadId === loadId) this.reportingLoadId = null;
        }
    }

    private chapterCompletion() {
        return territoryChapterCompletion(this.stages, this.progress?.ownedCells ?? []);
    }

    private persistProgress(): void {
        if (!this.map || !this.progress || !this.saveState) return;
        this.saveState = this.ports.store.saveProgress(
            this.map.chapterId,
            this.progress.toJSON(),
            this.saveState,
        );
    }

    /** 收集已占领站点的挂机产出配置；禁用站点不在 ownedCells 里，无需额外过滤。 */
    private buildIdleRewardSources(): TerritoryIdleRewardSource[] {
        if (!this.progress) return [];
        const sources: TerritoryIdleRewardSource[] = [];
        for (const item of this.stages) {
            if (!this.progress.isOwned(item.site.cellId) || !item.stage.idleRewards.length) continue;
            sources.push({ levelId: item.stage.levelId, rewards: item.stage.idleRewards });
        }
        return sources;
    }

    /** 结算离线/挂机产出；每个站点自带领取时间戳，账本里没有的站点从 now 起算，不补发占领前时间。 */
    private settleIdleRewards(now: number): TerritoryIdleRewardSaveResult | null {
        if (!this.map || !this.saveState) return null;
        const result = this.ports.store.settleIdleRewards(
            this.map.chapterId,
            this.buildIdleRewardSources(),
            this.idleRewardMaxHours,
            now,
            this.saveState,
        );
        this.saveState = result.save;
        return result;
    }

    // ============================================================
    // 视图状态组装
    // ============================================================

    get state(): ITerritoryViewState {
        const map = this.map;
        const progress = this.progress;
        const ready = map !== null && progress !== null;
        const revealedCells = map && progress ? territoryRevealedCells(map, progress) : [];
        const wallet = this.saveState?.wallet;
        const siteOpenableCells = map && progress && wallet ? map.sites
            .filter((site) => revealedCells.includes(site.cellId)
                && !progress.isCellUnlocked(site.cellId)
                && !progress.isOwned(site.cellId)
                && progress.checkUnlock(site.cellId, Number.MAX_SAFE_INTEGER).ok
                && wallet.silver >= site.unlock.silverCost
                && wallet.stamina >= site.unlock.staminaCost)
            .map((site) => site.cellId) : [];
        return {
            ready,
            chapterId: this.currentChapterId,
            map,
            layout: this.layout,
            art: this.art,
            progress,
            revealedCells,
            siteOpenableCells,
            stageByCell: this.stageByCell,
            randomResourceCells: this.randomResourceCells,
            randomResourceOpenableCells: map?.randomSites?.candidateCells.filter((cellId) =>
                this.randomResourceOpenCheck(cellId).ok) ?? [],
            pendingRandomResourceCells: Array.from(this.pendingRandomResourceCells),
            pendingFixedResourceCells: Array.from(this.pendingFixedResourceCells),
            hud: ready ? this.buildHud() : null,
            detail: {
                open: this.detailSite !== null,
                content: this.detailContent(),
            },
        };
    }

    private buildHud(): ITerritoryHudRender {
        const map = this.map!;
        const chapterIndex = this.ports.availableChapters.indexOf(this.currentChapterId);
        const completion = this.chapterCompletion();
        const hasNextChapter = chapterIndex >= 0
            && chapterIndex < this.ports.availableChapters.length - 1;
        const wallet = this.saveState?.wallet ?? { silver: 0, stamina: 0 };
        const random = map.randomSites;
        const randomHint = random?.candidateCells.length
            ? TERRITORY_TEXTS.randomCostHint(random.triggerSilver, map.defaults.staminaCost)
            : '';
        return {
            chapterText: `${map.name}  ·  已占领 ${completion.occupied}/${completion.total}`
                + `  ·  已启用 ${this.playerCardCount} 张卡牌`,
            walletText: `银币 ${wallet.silver}     体力 ${wallet.stamina}`
                + (this.resultNotice ? `     ${this.resultNotice}` : ''),
            walletHighlight: this.resultNotice !== '',
            inventoryText: `领地库存：${this.inventorySummary()}`,
            hintText: `点击站点查看详情${randomHint}`,
            previousEnabled: chapterIndex > 0,
            nextEnabled: hasNextChapter && completion.complete,
            nextCaption: !hasNextChapter
                ? TERRITORY_TEXTS.finalChapter
                : completion.complete ? TERRITORY_TEXTS.nextChapter : TERRITORY_TEXTS.nextChapterLocked,
        };
    }

    private detailContent(): ITerritorySiteDetailContent | null {
        const site = this.detailSite;
        if (!site) return null;
        const stage = this.detailStage;
        if (stage) return this.stageDetailContent(site, stage);
        return this.unboundDetailContent(site);
    }

    private stageDetailContent(site: TerritorySite, stage: TerritoryCampaignStage): ITerritorySiteDetailContent {
        const progress = this.progress;
        if (!progress) {
            return {
                title: '', subtitle: '', info: '', canStart: false,
                startCaption: '', startEnabled: false, isLoading: false,
            };
        }
        const owned = progress.isOwned(site.cellId);
        const exploration = progress.explorationAt(site.cellId);
        const check = progress.checkUnlock(site.cellId, Number.MAX_SAFE_INTEGER);
        const canStart = owned || (!exploration && (progress.isCellUnlocked(site.cellId) || check.ok));
        const remainSeconds = exploration
            ? Math.max(0, Math.ceil((exploration.finishesAt - Date.now()) / 1000))
            : 0;
        const stateText = owned
            ? TERRITORY_TEXTS.owned
            : exploration
                ? TERRITORY_TEXTS.exploring(remainSeconds)
                : canStart
                    ? TERRITORY_TEXTS.available
                    : 'reason' in check ? check.reason : TERRITORY_TEXTS.notUnlocked;
        const enemyLimit = TERRITORY_ENEMY_DISPLAY_LIMIT;
        const enemyText = stage.enemies.length
            ? `${stage.enemies.slice(0, enemyLimit).map((enemy) => `${enemy.name} Lv.${enemy.level}`).join('、')}`
                + `${stage.enemies.length > enemyLimit ? ` 等 ${stage.enemies.length} 张卡牌` : ''}`
            : TERRITORY_TEXTS.noEnemyCards;
        const waveText = stage.waves.length
            ? `${stage.waves.length} 波，`
                + `${stage.waves.map((wave) => `${wave.showAtSeconds}s ${wave.monsterName}×${wave.monsterCount}`).join('；')}`
            : stage.mode === 'defence'
                ? TERRITORY_TEXTS.noWavesUseBossTeam
                : TERRITORY_TEXTS.singleNpcOpponent;
        const rewardText = stage.idleRewards.length
            ? stage.idleRewards
                .map((reward) => `${reward.name}×${reward.amount}${reward.probability < 10000 ? `(${reward.probability / 100}%)` : ''}`)
                .join('、')
            : TERRITORY_TEXTS.noReward;
        const isLoading = this.startingBattle || this.pendingFixedResourceCells.has(site.cellId);
        const startCaption = isLoading ? '' : (this.battleStartNotice
            ?? (canStart
                ? (progress.isCellUnlocked(site.cellId) || owned ? TERRITORY_TEXTS.startBattle : TERRITORY_TEXTS.unlockBattle)
                : exploration ? TERRITORY_TEXTS.exploringShort : TERRITORY_TEXTS.notUnlocked));
        return {
            title: stage.isBoss ? `首领关卡  ${stage.stage}` : `领地关卡  ${stage.stage}`,
            subtitle: `关卡 ID  ${stage.levelId}`,
            info: [
                `站点状态：${stateText}`,
                `挑战消耗：体力 ${stage.staminaCost}  ·  银币 ${site.unlock.silverCost}`,
                `探索耗时：${stage.exploreSeconds} 秒`,
                // ⚠️ 建筑 ID **有值才显示这一行**（2026-10-10 口径）。
                // 解锁后的建筑完全来自 `chapter_XX.json` 里配的 `buildingId`：
                // 同一个 `configId`（战斗 id）算一片区域，区域内只有配了 id 的那个站点是建筑；
                // 没配 id 的格子不生成建筑，这一行也整行不出现（不是显示「未配置」占位）。
                ...(site.buildingId ? [`建筑 ID：${site.buildingId}`] : []),
                `敌方生命：${Math.round(stage.hpRate * 100)}%    敌方攻击：${Math.round(stage.attackRate * 100)}%`,
                `${stage.mode === 'defence' ? TERRITORY_TEXTS.defenceWavesLabel : TERRITORY_TEXTS.matchLineupLabel}：${waveText}`,
                `守军：${enemyText}`,
                `占领挂机产出：${rewardText}`,
                `挂机累计：每满 1 小时自动结算，最多累计 ${this.idleRewardMaxHours} 小时`,
            ].join('\n\n'),
            canStart: true,
            startCaption,
            startEnabled: canStart && !isLoading && this.battleStartNotice === null,
            isLoading,
        };
    }

    private unboundDetailContent(site: TerritorySite): ITerritorySiteDetailContent {
        return {
            title: TERRITORY_TEXTS.pendingTitle,
            subtitle: `类型  ${TERRITORY_UNBOUND_TYPE_NAMES[site.type]}`,
            info: [
                `站点：${site.id}`,
                `类型：${site.type}`,
                `格子：${site.cellId}`,
                `配置 ID：${site.configId || TERRITORY_TEXTS.unboundConfigId}`,
                // ⚠️ 建筑 ID **有值才显示这一行**（2026-10-10 口径）。
                // 以前是无条件显示、缺失时填 `unboundConfigId` 占位 —— 那会让「没配建筑」的格子
                // 也显示一行「建筑 ID：（未配置）」，看着像配错了。
                ...(site.buildingId ? [`建筑 ID：${site.buildingId}`] : []),
                `状态：${TERRITORY_TEXTS.unboundStatus}`,
            ].join('\n\n'),
            canStart: false,
            startCaption: '',
            startEnabled: false,
            isLoading: false,
        };
    }

    private inventorySummary(): string {
        if (!this.saveState) return TERRITORY_TEXTS.emptyInventory;
        const entries = Object.entries(this.saveState.inventory);
        if (!entries.length) return TERRITORY_TEXTS.emptyInventory;
        const names = this.idleRewardNames();
        return entries
            .map(([key, count]) => `${names.get(Number(key)) ?? `道具 ${key}`}×${count}`)
            .join('  ');
    }

    private idleRewardNames(): Map<number, string> {
        const names = new Map<number, string>();
        for (const item of this.stages)
            for (const reward of item.stage.idleRewards)
                if (!names.has(reward.resId)) names.set(reward.resId, reward.name);
        return names;
    }

    // ============================================================
    // 回调派发
    // ============================================================

    private emitStateChange(): void {
        EventMgr.instance.emit(TERRITORY_PRESENTER_EVENTS.StateChange);
    }
}
