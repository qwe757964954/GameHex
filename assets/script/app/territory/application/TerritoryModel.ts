import type { TerritoryRandomCellOpenCheck } from '../../../core/territory/TerritoryRandomResourceRules';
import {
    canClaimTerritoryRandomResource,
    canOpenTerritoryRandomCell,
    selectTerritoryRandomResourceCell,
} from '../../../core/territory/TerritoryRandomResourceRules';
import type { ZCBattleStart } from '../../battle/BattleStartModel';
import {
    chapterCellBattleParams,
    chapterTreasureBattleParams,
    ZC_BATTLE_TYPE_CHAPTER,
} from '../../battle/BattleStartModel';
import { TERRITORY_BATTLE_STATUS } from '../model/TerritoryBattleStatus';
import type { TerritoryCampaignStage } from '../model/TerritoryCampaignConfig';
import {
    TERRITORY_IDLE_REWARD_MAX_HOURS_FALLBACK,
    TERRITORY_LEVEL_AUTO_START_FALLBACK,
} from '../model/TerritoryCampaignConfig';
import type { ITerritoryCellState } from '../model/TerritoryCellBitSet';
import { territoryRevealedCells } from '../model/TerritoryCellReveal';
import type { ITerritoryGrantedReward } from '../model/TerritoryGrantedReward';
import type {
    TerritoryIdleRewardGain,
    TerritoryIdleRewardSource,
} from '../model/TerritoryIdleReward';
import { TERRITORY_SILVER_RES_ID } from '../model/TerritoryIdleReward';
import type {
    TerritoryMapConfig,
    TerritorySite,
} from '../model/TerritoryMapConfig';
import { configureTerritoryMap, TERRITORY_SITE_TYPE } from '../model/TerritoryMapConfig';
import type { ITerritoryMapLayout } from '../model/TerritoryMapLayout';
import { buildTerritoryMapLayout } from '../model/TerritoryMapLayout';
import type { TerritoryProgressData } from '../model/TerritoryProgress';
import { TerritoryProgress } from '../model/TerritoryProgress';
import { TERRITORY_REQUEST_STATUS } from '../model/TerritoryRequestStatus';
import type {
    TerritoryBeginBattleResult,
    TerritoryChapterSave,
    TerritoryIdleRewardSaveResult,
    TerritoryWallet,
} from '../model/TerritorySaveStore';
import {
    applyTerritoryStageUnlocks,
    bindTerritoryBattleStages,
    bindTerritoryStages,
    expandBindingsToAreaSites,
    findCurrentTerritoryBoss,
    territoryChapterCompletion,
} from '../model/TerritoryStageBinding';
import type { TerritoryCellFetchResult, TerritoryStartBattleResult, TerritoryWriteResult } from './TerritoryCellRepository';
import type { ITerritoryBattleArt } from './TerritoryPageAssets';
import {
    TERRITORY_ASYNC_REWARD_SLOTS,
    TERRITORY_ASYNC_SCOUT_SILVER,
    TERRITORY_DEFAULT_PLAYER_COUNT,
    TERRITORY_LEVEL_DROP_SLOTS,
    TERRITORY_TEXTS,
    TERRITORY_UNBOUND_TYPE_NAMES,
} from './TerritoryTexts';

// ============================================================
// 端口
// ============================================================

/**
 * 「解锁那一次直开」的请求产物：两段回包一起交给 `runCellWrite` 的收尾处理。
 *
 * 只在解锁**成功**时才产生（失败时 `unlockThenStartBattle` 返回 `null`，
 * 进度不记账、不进战斗），所以这里没有失败态。
 */
interface ITerritoryUnlockThenBattleOutcome {
    readonly unlockedCellIds: readonly number[];
    readonly battle: TerritoryStartBattleResult;
}

/** 一章的加载产物；loader 内部允许碰 cc / RefUtil，Presenter 只消费结构。 */
export interface ITerritoryChapterBundle {
    readonly mapJson: unknown;
    readonly campaign: {
        readonly stages: TerritoryCampaignStage[];
        readonly playerCardCount: number;
        readonly idleRewardMaxHours: number;
        /** `gameConfig.chapterLevelAutoStartConfig`：首次激活关卡地块是否自动进战斗。 */
        readonly levelAutoStart: boolean;
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
        chapterId: number, maxCell: number, host?: object,
    ): Promise<TerritoryCellFetchResult>;
    /** 服务端解锁格子；战斗入口允许离线继续，固定资源领取只认成功回包。 */
    unlockCell(chapterId: number, cellId: number, host?: object): Promise<TerritoryWriteResult>;
    /** 探索到期占领后上报通关；fire-and-forget。 */
    passCell(chapterId: number, cellId: number, host?: object): Promise<TerritoryWriteResult>;
    /** Boss 关开战：请求战斗信息（`CmdStartBattleReqMsg`），**不走**通关上报。 */
    startBattle(
        battleType: number,
        battleParams: readonly string[],
        host?: object,
    ): Promise<TerritoryStartBattleResult>;
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

/** NavigateToBattle 事件载荷：pve 为现 ProcedureManager.navigate 的 { pve: … } 里的 pve。 */
export interface ITerritoryNavigateBattlePayload {
    readonly pve: ITerritoryBattleNavParams;
    readonly battle?: ZCBattleStart;
}

/** ShowTip 事件载荷。 */
export interface ITerritoryShowTipPayload {
    readonly text: string;
}

/**
 * ShowRewards 事件载荷。
 *
 * @param originCellId 奖励来自哪一格（资源点领取 / 随机格开启 ⇒ 那一格的 `cellId`；
 *   挂机产出按关卡结算、**没有格子** ⇒ `null`）。页面用它决定飘字落点
 *   （`null` 时回落到起始格），见 `TerritoryResourceGain` 的口径说明。
 */
export interface ITerritoryShowRewardsPayload {
    readonly rewards: readonly (TerritoryIdleRewardGain | ITerritoryGrantedReward)[];
    readonly originCellId?: number | null;
    readonly options?: ITerritoryRewardPresentation;
}

/**
 * SetBusy 事件载荷：写请求在途 `busy=true`（全屏遮挡，防快速点击重复发包），
 * 全部结束后 `busy=false`；文案由 Presenter 按操作类型给出（`TERRITORY_TEXTS.busy*`）。
 */
export interface ITerritorySetBusyPayload {
    readonly busy: boolean;
    readonly text?: string;
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

export interface ITerritoryModelPorts {
    readonly loader: ITerritoryChapterLoader;
    readonly gateway: ITerritoryCellGateway;
    readonly store: ITerritoryChapterStore;
    readonly walletSeed: () => TerritoryWallet;
    readonly readServerWallet: () => TerritoryWallet | null;
    readonly availableChapters: readonly number[];
    /** 网络请求的生命周期宿主（页面组件；断网/销毁时取消请求）。 */
    readonly lifecycleHost?: object;
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
    /**
     * 异步据点的「玩家关卡」弹窗内容（`null` = 当前选中的不是异步据点）。
     *
     * 与 `content` **互斥**：同一个 `detailSite` 只会走其中一条渲染路径，
     * 页面按「playerStage 有值就用玩家关卡弹窗，否则用通用详情弹窗」选面板。
     */
    readonly playerStage: ITerritoryPlayerStageContent | null;
    /** 关卡/首领据点的「关卡界面」内容（`null` = 当前选中的不是关卡型站点）。 */
    readonly levelInfo: ITerritoryLevelInfoContent | null;
    /** 「关卡提示」内容；非 `null` = 提示弹窗开着（压在关卡界面上面）。 */
    readonly levelTip: ITerritoryLevelTipContent | null;
}

/** 「关卡界面」里一格掉落（图标由页面按 `resId` 解析）。 */
export interface ITerritoryLevelDrop {
    readonly resId: number;
    readonly amount: number;
}

/** 「关卡界面」呈现数据（蓝湖「关卡界面」设计稿）。 */
export interface ITerritoryLevelInfoContent {
    readonly title: string;
    /** 有没有「敌军提示」可看（没有就隐藏右上角感叹号，别让玩家点出一个空面板）。 */
    readonly hasTip: boolean;
    readonly objective: string;
    readonly occupy: string;
    readonly drops: readonly ITerritoryLevelDrop[];
    /** 推荐文案；空串 = 整行隐藏。 */
    readonly recommend: string;
    readonly fightCaption: string;
    readonly fightEnabled: boolean;
    readonly staminaCost: number;
}

/**
 * 「关卡提示」里一个敌军卡位。
 *
 * 🔴 `description` 是**逐个敌人**的说明（`pvpCard.description`）——
 * 蓝湖设计稿里描述框显示的是**当前选中那个敌人**的技能描述，
 * 不是所有敌人拼在一起（拼在一起在超过 3 个敌人时会撑爆描述框）。
 */
export interface ITerritoryLevelTipEnemy {
    /** `pvpCard.headIcon` 路径；空串 = 没有头像。 */
    readonly headIcon: string;
    readonly name: string;
    /** 该敌人的技能描述；空串 = 描述框显示占位文案。 */
    readonly description: string;
}

/** 「关卡提示」呈现数据。 */
export interface ITerritoryLevelTipContent {
    readonly title: string;
    readonly enemies: readonly ITerritoryLevelTipEnemy[];
    /**
     * 描述框的**兜底**文案（所有敌人都没有描述时用）。
     * 正常路径是「选中敌人的 `description`」，这个字段只在全员无描述时兜底。
     */
    readonly description: string;
}

/** 玩家关卡弹窗里的一格占领奖励（图标由页面按 `resId` 解析，Presenter 只给纯数据）。 */
export interface ITerritoryPlayerStageReward {
    readonly resId: number;
    readonly amount: number;
}

/**
 * 异步据点「玩家关卡」弹窗的呈现数据。
 *
 * 字段对齐蓝湖「玩家关卡」设计稿：标题木牌 + 两条占领奖励（第二条是图标格）+ 侦查/开战双按钮。
 * 两个按钮各带一份**银币**消耗 —— 数值全部来自配置与存档，视图不自己造数。
 */
export interface ITerritoryPlayerStageContent {
    readonly title: string;
    /** 第一条占领奖励的文案；空串 = 整条隐藏（没有卡牌宝箱奖励的据点）。 */
    readonly chestText: string;
    readonly rewards: readonly ITerritoryPlayerStageReward[];
    readonly scoutCost: number;
    readonly fightCost: number;
    readonly fightCaption: string;
    readonly fightEnabled: boolean;
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

interface ITerritoryChapterContext {
    readonly map: TerritoryMapConfig;
    readonly progress: TerritoryProgress;
    saveState: TerritoryChapterSave;
    serverCellStateCache: ITerritoryCellState | null;
    readonly stages: TerritoryStageView[];
    readonly stageByCell: Map<number, TerritoryCampaignStage>;
    readonly layout: ITerritoryMapLayout;
    readonly art: ITerritoryBattleArt;
    readonly playerCardCount: number;
    readonly idleRewardMaxHours: number;
    readonly levelAutoStart: boolean;
    randomResourceCells: number[];
}

interface ITerritoryChapterPushes {
    readonly chapterId: number;
    readonly passCells: Set<number>;
    cellInfo: ITerritoryCellState | null;
}

/**
 * 章节地图状态与规则；输出仅通过实例订阅交给 Controller。
 *
 *  持有地图配置 / 玩家进度 / 本地存档与服务端格子端口，对页面暴露 intent 方法和一个视图状态。
 *  **不 import cc / 其他 app feature**：所有副作用（导航、提示、奖励弹层、存档落盘、
 *  资源加载、网络）都经端口进入，因此本类可以在 Node 下直接单测。
 *
 * 章节上下文原子替换，加载期推送与交互版本检查沿用既有规则。
 * Controller 负责同步消息入口的订阅存续，退出调用 dispose 作废异步任务。
 */
export type TerritoryModelOutput =
    | { readonly kind: 'changed' }
    | { readonly kind: 'navigate'; readonly payload: ITerritoryNavigateBattlePayload }
    | { readonly kind: 'tip'; readonly payload: ITerritoryShowTipPayload }
    | { readonly kind: 'rewards'; readonly payload: ITerritoryShowRewardsPayload }
    | { readonly kind: 'busy'; readonly payload: ITerritorySetBusyPayload };

export class TerritoryModel {
    private readonly outputs = new Set<(output: TerritoryModelOutput) => void>();

    onOutput(listener: (output: TerritoryModelOutput) => void): () => void {
        this.outputs.add(listener);
        return () => { this.outputs.delete(listener); };
    }

    private publish(output: TerritoryModelOutput): void {
        for (const listener of this.outputs) listener(output);
    }

    private currentChapterId: number;
    private chapter: ITerritoryChapterContext | null = null;
    private loadingPushes: ITerritoryChapterPushes | null = null;
    private get map() { return this.chapter?.map ?? null; }
    private get progress() { return this.chapter?.progress ?? null; }
    private get saveState() { return this.chapter?.saveState ?? null; }
    private get stages() { return this.chapter?.stages ?? []; }
    private get stageByCell() { return this.chapter?.stageByCell ?? new Map<number, TerritoryCampaignStage>(); }
    private get layout(): ITerritoryMapLayout {
        return this.chapter?.layout ?? { points: new Map(), width: 0, height: 0, paintOrder: [] };
    }
    private get art() { return this.chapter?.art ?? this.emptyArt; }
    private get playerCardCount() { return this.chapter?.playerCardCount ?? 0; }
    /** `gameConfig.chapterLevelAutoStartConfig`（1 开 / 0 关）；章节未加载时按缺省（开）。 */
    private get levelAutoStart(): boolean {
        return this.chapter?.levelAutoStart ?? TERRITORY_LEVEL_AUTO_START_FALLBACK;
    }

    private get idleRewardMaxHours() {
        return this.chapter?.idleRewardMaxHours ?? TERRITORY_IDLE_REWARD_MAX_HOURS_FALLBACK;
    }
    private get randomResourceCells() { return this.chapter?.randomResourceCells ?? []; }
    private requireChapter(): ITerritoryChapterContext {
        if (!this.chapter) throw new Error('Territory chapter is not loaded');
        return this.chapter;
    }
    private readonly emptyArt: ITerritoryBattleArt = {
        background: null,
        levelBubbleFrame: null,
        levelBubblePendingFrame: null,
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
    private startingBattle = false;
    private pendingFixedResourceCells = new Set<number>();
    private pendingRandomResourceCells = new Set<number>();
    /**
     * 当前交互号。**每次「换了目标格」才递增**（见 `beginInteraction`），回包靠它对号：
     * 号变了 = 玩家早已切走，结果不属于当前交互 ⇒ 不记账、不提示。
     * 管辖范围是**全部单格写请求**（解锁 / 通关 / 开战 / 随机格），不只是战斗。
     */
    private interactionId = 0;
    /** 当前交互的目标格；`null` = 没有进行中的交互（下一次点击必然开新号）。 */
    private interactionCell: number | null = null;
    /** 玩家写请求在途数；> 0 时全屏 loading 遮挡（引用计数，多请求并发只显一层）。 */
    private busyCount = 0;
    private readonly busyReleases = new Set<() => void>();
    private reportingLoadId: number | null = null;
    private loadId = 0;
    private resultNotice = '';
    private detailStage: TerritoryCampaignStage | null = null;
    private detailSite: TerritorySite | null = null;
    /** 「关卡提示」是否开着（压在关卡界面上的二级弹窗，关它不影响下面的面板）。 */
    private levelTipOpen = false;
    /** Boss 关最近一次 `CmdStartBattleReqMsg` 成功回包的战斗信息（battleId/seed）。 */
    private bossBattleStart: { readonly battleId: string; readonly seed: string } | null = null;
    /**
     * `state` 的脏标记缓存：`emitStateChange` 作废，下次读 `state` 重算一次。
     *
     * 页面每次 `StateChange` 都全量 `renderAll()`，`renderAll` 一轮里会多次读 `state`
     * （`renderMap` 取一批字段、`renderDetail` 再取 `detail`）。无缓存时每读一次就重算
     * `territoryRevealedCells` + 对全部 sites 跑 `checkUnlock` + 对全部随机候选格跑
     * `randomResourceOpenCheck`（各自 O(sites)/O(candidates) 线性扫描），`fastTick` 每秒一拍、
     * 连点写请求一次操作 emit 3~4 次，成本叠得很快。
     *
     * 缓存还顺带保证**同一轮渲染内 `state` 返回同一对象**：`MainTerritoryMap` 异步补图标后
     * 用 `this.presenter.state.detail.levelInfo !== content` 判「选中项还是不是发起时那条」，
     * 靠的就是对象身份稳定；每次新建会让这个比较恒成立（永远 return、不重开），缓存修正了它。
     * 失效时机齐全：所有改 map/progress/saveState/detail 的路径最终都走 `emitStateChange`
     * （类注释「页内刷新只有这一个通知通道」）。
     */
    private stateCache: ITerritoryViewState | null = null;

    constructor(private readonly ports: ITerritoryModelPorts) {
        this.currentChapterId = ports.store.loadLastChapter();
        // 页面在 start 前注册消息，首次加载也要接住这一小段窗口里的推送。
        this.loadingPushes = { chapterId: this.currentChapterId, passCells: new Set(), cellInfo: null };
    }

    // ============================================================
    // 生命周期
    // ============================================================

    start(): void {
        void this.loadChapter(this.currentChapterId);
    }

    /** CmdRole 缓存更新后调用；只有服务端余额能覆盖本地钱包。 */
    refreshWalletFromServer(emit = true): void {
        if (!this.map || !this.saveState) return;
        const wallet = this.ports.readServerWallet();
        if (!wallet || !Number.isSafeInteger(wallet.silver) || wallet.silver < 0
            || !Number.isSafeInteger(wallet.stamina) || wallet.stamina < 0) return;
        if (wallet.silver === this.saveState.wallet.silver
            && wallet.stamina === this.saveState.wallet.stamina) return;
        this.requireChapter().saveState = this.ports.store.saveWallet(this.map.chapterId, wallet, this.saveState);
        if (emit) this.emitStateChange();
    }

    dispose(): void {
        this.loadId += 1;
        this.chapter = null;
        this.loadingPushes = null;
        this.stateCache = null;
        this.cancelInteraction();
        // 🔴 写请求在途时页面被销毁 ⇒ 撤掉本页面贡献的每层 loading（enterBusy 的 show
        // 与这里逐次 hide 配对）。不清理会留下全屏遮罩：`LoadingPopup` 引用计数不为 0
        // 永不关闭，遮罩上的 `BlockInputEvents` 常驻吞点击，其他页面「点不动」。
        for (const release of this.busyReleases) release();
        // busy 释放通知完成后，再解除实例输出订阅。
        this.outputs.clear();
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
        if (this.startingBattle || this.busyCount > 0) return null;
        if (!this.map || !this.progress || this.map.chapterId !== this.currentChapterId) {
            this.showTip(TERRITORY_TEXTS.loadingChapter);
            return null;
        }
        const target = findCurrentTerritoryBoss(this.map.sites, this.stageByCell, this.progress);
        if (!target) {
            this.closeDetail();
            this.showTip(TERRITORY_TEXTS.noBossTarget);
            return null;
        }
        this.cancelInteraction();
        this.detailSite = target.site;
        this.detailStage = target.stage;
        this.emitStateChange();
        return target.site.cellId;
    }

    selectSite(site: TerritorySite): void {
        if (this.loadingPushes) return;
        // 先行换号：**点哪个格子**就是玩家的最新意图，哪怕这一格还没露出 / 点不动。
        // 在途的旧回包必须作废（否则会出现「点 A 在途 → 点了点不动的 B → A 的回包把界面解锁了」）。
        // 同一格连点是 no-op，所以「连点同一格仍要记账」的那两条用例不受影响。
        this.beginInteraction(site.cellId);
        if (!this.progress || !this.map
            || !territoryRevealedCells(this.map, this.progress).includes(site.cellId)) return;
        if (this.isBattleSite(site) && this.pendingFixedResourceCells.has(site.cellId)) return;
        // 关卡、首领和异步据点统一先解锁展示建筑；已解锁后再次点击打开各自详情。
        //
        // 🔴 2026-10-15 口径（山猫）：「点建筑就开始」是**所有关卡**的行为，不是 327/328 的特例。
        // 早前这里只有 `bossStage?.isBoss || isTerritoryTwoStepCell(site.cellId)`（硬编码 `[327,328]`）
        // ⇒ 关卡 2（configId 10002，cells 288/309/310）既不 isBoss 也不在名单里
        // ⇒ 落到下面的详情面板分支，表现为「点建筑没反应、只能弹面板」。
        // ⚠️ 判据：**站点类型**决定走哪条路，`isBoss`（= `levelMod === 2`）与是否绑到 campaign
        // 都不是准入条件 —— 找不到战斗配置时走 `handleUnlockOnly`，不会发空请求。
        //（`stageByCell` 已把主线与 asyncPvp 的同区域格子都填上 stage，见 `loadChapter`。）
        if (this.isBattleSite(site)) {
            // 🔴 2026-10-28 用户口径：「当关卡地块未解锁时（显示银币和数字 ui 时），点击地块消耗银币，
            // 播放地块切换成关卡地块的动画（与其他新生成的地块动画一致），**不要**直接改成点击银币
            // 弹出【领地关卡弹窗】」。
            //
            // ⇒ 锁着的格子点一下 = **花银币解锁**（校验前置 / 银币 / 体力 → `CmdCityChapterUnlockCellReqMsg`
            //   → `markCellsUnlocked`），界面**不弹**；主线关卡解锁成功后**立刻发开战**（2026-10-29，
            //   见下面那段口径）—— 只解锁的只剩 asyncPvp 与绑不到 campaign 行的格子。
            //   解锁动画由视图侧按「刚解锁」的 diff 播（与其它新露出格子同一套 `hexSpawn`）。
            //
            // ⚠️ 判据必须 **`isCellUnlocked || isAreaPassed`**（与 `isCellActivated` 同源）：
            //   只判 `isCellUnlocked` 会让「区域已通关、但本格没单独解锁」的格子反复走解锁请求。
            if (!this.progress.isCellUnlocked(site.cellId) && !this.progress.isAreaPassed(site.cellId)) {
                this.detailSite = null;
                this.detailStage = null;
                this.levelTipOpen = false;
                this.emitStateChange();
                const lockedStage = this.stageByCell.get(site.cellId) ?? null;
                // 🔴 2026-10-29 口径（山猫）：「**只有解锁那一次**直开，之后仍弹窗」。
                //   ⇒ 锁着的格子点一下 = 花银币解锁 → 解锁成功**立刻**发 `CmdStartBattleReqMsg`
                //     进战斗，中途不弹关卡界面；解锁过（或区域已通关）的格子照旧走下面的详情分支。
                //   ⇒ 判据就在这条 `if` 里，**不要**再按 `isOwned` / 是否打过二次分流：
                //     「未通关」不是「该直开」的条件，不然玩家退出战斗后再点它又是直开、永远看不到关卡界面。
                //   ⚠️ 只对**主线关卡**（stage / boss）生效：asyncPvp 的弹窗带「侦查」，先弹再接战；
                //     绑不到 campaign 行时没有 battleParams，退回「只解锁」。
                //   ⚠️ 开关是 `gameConfig.chapterLevelAutoStartConfig`（1 开 / 0 关，策划表口径），
                //     关掉之后这里退回「点一下只解锁」的老行为 —— 判据只在 `selectSite` 这一处，
                //     别在 `handleUnlockThenBattle` 里再判一遍（两处判据迟早不一致）。
                if (this.levelAutoStart && lockedStage && this.isLevelSite(site)) {
                    void this.handleUnlockThenBattle(site, lockedStage);
                    return;
                }
                void this.handleUnlockOnly(site, TERRITORY_TEXTS.stageUnlocked);
                return;
            }
            // 已解锁（或区域已通关）才弹窗：异步据点展示侦查/战斗，其余展示关卡界面。
            this.detailSite = site;
            this.detailStage = this.stageByCell.get(site.cellId) ?? null;
            this.levelTipOpen = false;
            this.emitStateChange();
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
        this.emitStateChange();
    }

    /** 点随机格直接开启；资源校验、失败提示和防连点统一由开启流程处理。 */
    selectRandomResource(cellId: number): void {
        if (this.loadingPushes || !this.map?.randomSites?.candidateCells.includes(cellId)) return;
        this.beginInteraction(cellId);
        this.detailSite = null;
        this.detailStage = null;
        this.emitStateChange();
        void this.openRandomResourceCell(cellId);
    }

    closeDetail(): void {
        this.cancelInteraction();
        this.detailSite = null;
        this.detailStage = null;
        this.levelTipOpen = false;
        this.emitStateChange();
    }

    /** 关卡界面的感叹号 → 打开「关卡提示」（只对关卡型站点有效）。 */
    openLevelTip(): void {
        if (!this.detailSite) return;
        // 没有敌军就没有提示可看（与感叹号的显隐口径一致）
        if (!this.levelTipContent()?.enemies.length) return;
        this.levelTipOpen = true;
        this.emitStateChange();
    }

    /** 关掉「关卡提示」，关卡界面留着。 */
    closeLevelTip(): void {
        if (!this.levelTipOpen) return;
        this.levelTipOpen = false;
        this.emitStateChange();
    }

    requestBattle(): void {
        const site = this.detailSite;
        const stage = this.detailStage;
        if (this.loadingPushes || !site || !this.map || !this.saveState || !this.progress) return;
        if (this.startingBattle) return;
        // 站点可达性（解锁/通关/花费）全部由 `handleBattleStationStart` 自己判 ——
        // 这里再拦一次会把「需要先解锁」的关卡挡成静默 return（弹窗点了没反应）。
        // 绑不到 campaign 行 ⇒ 无从开战（没有 battleParams 语义），退回纯解锁那一步。
        // 这条兜底原来在 `selectSite` 里，关卡改成「先弹界面」后挪到这里。
        if (!stage) {
            if (site.type === TERRITORY_SITE_TYPE.stage || site.type === TERRITORY_SITE_TYPE.boss) {
                void this.handleUnlockOnly(site);
            }
            return;
        }
        if (this.isBattleSite(site)) {
            if (this.pendingFixedResourceCells.has(site.cellId)) return;
            void this.handleBattleStationStart(site, stage);
            return;
        }
        void this.startBattle(site, stage);
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
        // 🔴 2026-10-28 用户：「已通过的关卡重复挑战仍需要消耗体力」——
        // 主线**普通关卡**打完不再是"只能看不能打"：再点开弹窗照样是「开始战斗」，
        // 再打一次照样走 `CmdStartBattleReqMsg`（格子战斗子类型 1），体力由服务端按
        // `stage.staminaCost` 结算。所以这里**没有**「已通关 ⇒ 直接 return」那道守卫；
        // `isAreaPassed` 只用来**跳过解锁**（这一片区域都归玩家了，不必再发 `unlockCell`）。
        // ⚠️ 别把它加回来：加了之后弹窗里的「开始战斗」就是死按钮（点了毫无反应）。
        const isAreaPassed = progress.isAreaPassed(site.cellId);
        if (!progress.isCellUnlocked(site.cellId) && !isAreaPassed) {
            // 第一步：解锁并展示建筑，**不发**战斗请求。
            // 守卫（revealed / pending / canAffordUnlock）、竞态号、按回包数组记账、在途帧与收尾渲染，
            // 全部与 `handleUnlockOnly` 是**同一份实现** —— 这里早前是一份逐字复制的副本，
            // 两份一起维护（改一边漏一边 = 「只在某种站点类型复现」的 bug）。
            await this.handleUnlockOnly(site, TERRITORY_TEXTS.bossUnlocked);
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
        // ⚠️ 防连点：同一格**开战请求还在飞** ⇒ 别再发一次（`runCellWrite` 里第一道 pending 判重；
        // 全屏 loading 是主防线，这里是代码层第二道）。
        //
        // 🔴 不再用「这一格已经拿到 battleId」（`bossBattleStart`）当判据：那是**上一次开战**的
        // 全局单值记录，navigate 后已消费并清空（见 `beginBattle`），拿它拦重复点击会把
        // 已通关格（asyncPvp 可重复挑战）在本章节里**永久锁死**；也不能用 `isOwned` 拦
        // （开战后到结算回报前本地不是 owned，拦不住连点，见下）。
        await this.runCellWrite(
            site.cellId, this.pendingFixedResourceCells, TERRITORY_TEXTS.busyBattle,
            () => this.ports.gateway.startBattle(
                ZC_BATTLE_TYPE_CHAPTER,
                this.battleParamsFor(site, map.chapterId),
                this.ports.lifecycleHost,
            ),
            (result) => this.applyBattleStart(site, stage, result),
        );
    }

    /**
     * `CmdStartBattleReqMsg` 的 `battleParams = [子类型, 章节id, 格子id]`。
     *
     * 弹窗里的「开始战斗」与「解锁那一次直开」共用这一份口径 —— 两条入口
     * 早前各拼一遍（`handleBattleStationStart` / 新增的一键路径），漏一条就是
     * 「某种入口点进去服务端说配置错误」。
     */
    private battleParamsFor(site: TerritorySite, chapterId: number): readonly string[] {
        if (site.type !== TERRITORY_SITE_TYPE.asyncPvp) {
            // 主线 stage / boss 恒为格子战斗子类型 1，不参与下面的分流。
            return chapterCellBattleParams(chapterId, site.cellId);
        }
        // 🔴 asyncPvp（异步据点）的子类型按**服务端确认的通关状态**分流（山猫 2026-10-21 细化）：
        //  未通关（首次挑战）→ 子类型 1（格子战斗 `chapterCellBattleParams`）；
        //  已通关（重复挑战）→ 子类型 2（宝箱战斗 `chapterTreasureBattleParams`）。
        //  判据必须用 `isServerOwned`（快照 `passCells` 权威）而非 `isOwned`：本地旧档残留 /
        //  离线结算未上报会让 owned 领先服务端 ⇒ 没打过的格也传 2，服务端回「配置错误」；
        //  而「一律传 1」又会把已通关格按主线关卡判定拒掉。两个方向都实测踩过。
        return this.progress?.isServerOwned(site.cellId)
            ? chapterTreasureBattleParams(chapterId, site.cellId)
            : chapterCellBattleParams(chapterId, site.cellId);
    }

    /** 开战回包的统一收尾：失败只提示；成功记下战斗信息并进战斗。 */
    private applyBattleStart(
        site: TerritorySite,
        stage: TerritoryCampaignStage,
        result: TerritoryStartBattleResult,
    ): void {
        if (!result.ok) {
            this.showTip(TERRITORY_TEXTS.bossBattleStartFailed);
            return;
        }
        this.bossBattleStart = { battleId: result.battle.battleId, seed: result.battle.seed };
        this.beginBattle(site, stage, result.battle);
    }

    /**
     * 锁着的关卡格：**解锁成功即开战**（不弹关卡界面）。
     *
     * 🔴 2026-10-29 口径（山猫）：「只有解锁那一次直开、之后仍弹窗」——
     * 所以这条入口只在 `!isCellUnlocked && !isAreaPassed` 时被 `selectSite` 调到；
     * 解锁过（或区域已通关）的格子照旧走详情弹窗那条路，不会自动开战。
     *
     * 🔴 两个请求**共用一具骨架**：一次 pending 登记、一层 loading、一个交互号。
     * 所以 `unlockCell` → `startBattle` 都写在 `runCellWrite` 的 `request` 里串行发，
     * 而不是两次 `runCellWrite` 嵌套 —— 那样 loading 会在中间归零闪一下，
     * 而且第二段取的是新交互号，中途点别的格作废不掉这条开战。
     */
    private async handleUnlockThenBattle(
        site: TerritorySite,
        stage: TerritoryCampaignStage,
    ): Promise<void> {
        const map = this.map;
        const progress = this.progress;
        if (!map || !progress) return;
        // 已占领 = 这一片已经打过了（`selectSite` 的锁态判据已排掉，这里再挡一次纯防御）。
        if (progress.isOwned(site.cellId)) return;
        if (!territoryRevealedCells(map, progress).includes(site.cellId)) return;
        // 解锁前的「前置满足 + 钱包够」与 `handleUnlockOnly` 同一条校验（失败自带提示）。
        if (!this.canAffordUnlock(site)) return;
        await this.runCellWrite<ITerritoryUnlockThenBattleOutcome | null>(
            site.cellId, this.pendingFixedResourceCells, TERRITORY_TEXTS.busyBattle,
            () => this.unlockThenStartBattle(site, map.chapterId),
            (outcome) => {
                if (!outcome) return;
                // 🔴 按**回包给的数组**逐格记账（服务端一次解锁整片区域），与 `handleUnlockOnly` 同口径。
                progress.markCellsUnlocked(outcome.unlockedCellIds);
                this.persistProgress();
                this.refreshWalletFromServer(false);
                this.applyBattleStart(site, stage, outcome.battle);
            },
        );
    }

    /**
     * 「解锁 → 开战」两段串行；解锁没成功就返回 `null`（格子仍锁着，下次点击重来）。
     *
     * ⚠️ 这里**不做** `startBattle` 那种 fail-open：解锁状态是服务端权威，
     * 回包 `offline` / `failed` 时直接发开战会被服务端按「未解锁」拒掉，
     * 不如原地提示（`startBattle` 放行的是纯本地开战，不发 `CmdStartBattleReqMsg`，两者不是一回事）。
     */
    private async unlockThenStartBattle(
        site: TerritorySite,
        chapterId: number,
    ): Promise<ITerritoryUnlockThenBattleOutcome | null> {
        const unlock = await this.ports.gateway.unlockCell(
            chapterId, site.cellId, this.ports.lifecycleHost);
        if (!unlock.ok) {
            this.showTip(TERRITORY_TEXTS.bossUnlockFailed);
            return null;
        }
        const battle = await this.ports.gateway.startBattle(
            ZC_BATTLE_TYPE_CHAPTER,
            this.battleParamsFor(site, chapterId),
            this.ports.lifecycleHost,
        );
        return { unlockedCellIds: unlock.unlockedCellIds ?? [site.cellId], battle };
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
        if (!this.canAffordUnlock(site)) return;
        await this.runCellWrite(
            site.cellId, this.pendingFixedResourceCells, TERRITORY_TEXTS.busyUnlock,
            () => this.ports.gateway.unlockCell(map.chapterId, site.cellId, this.ports.lifecycleHost),
            (result) => {
                if (!result.ok) {
                    this.showTip(TERRITORY_TEXTS.bossUnlockFailed);
                    return;
                }
                // 🔴 按**回包给的数组**逐格记账：服务端一次解锁整片区域（请求 327 → 回 [327,328]），
                // 只记请求那一格 ⇒ 同区域其余格界面上仍是锁态。
                progress.markCellsUnlocked(result.unlockedCellIds ?? [site.cellId]);
                this.persistProgress();
                this.refreshWalletFromServer(false);
                this.showTip(unlockedText);
            },
        );
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
        if (!progress || !map || progress.isOwned(site.cellId)) return;
        const isUnlocked = progress.isCellUnlocked(site.cellId);
        if (!isUnlocked) {
            if (!territoryRevealedCells(map, progress).includes(site.cellId)) return;
            if (!this.canAffordUnlock(site)) return;
        }
        await this.runCellWrite(
            site.cellId, this.pendingFixedResourceCells,
            isUnlocked ? TERRITORY_TEXTS.busyPass : TERRITORY_TEXTS.busyUnlock,
            () => (isUnlocked
                ? this.ports.gateway.passCell(map.chapterId, site.cellId, this.ports.lifecycleHost)
                : this.ports.gateway.unlockCell(map.chapterId, site.cellId, this.ports.lifecycleHost)),
            (result) => {
                if (!result.ok) {
                    this.showTip(isUnlocked ? texts.claimFailed : texts.unlockFailed);
                    return;
                }
                if (isUnlocked) progress.markCellPassed(site.cellId);
                else progress.markCellsUnlocked(result.unlockedCellIds ?? [site.cellId]);
                this.persistProgress();
                this.refreshWalletFromServer(false);
                // 空串 = 这次不提示（资源点解锁不再弹「已解锁，点击宝箱领取」，见 §3）。
                const tip = isUnlocked ? texts.claimed : texts.unlocked;
                if (tip) this.showTip(tip);
                if (isUnlocked && result.rewards?.length) {
                    this.showRewards(result.rewards, site.cellId);
                }
            },
        );
    }

    /**
     * 解锁前的「前置满足 + 钱包够」统一校验（失败时自行弹提示并返回 false）。
     *
     * 🔴 **全文件唯一口径**：点击路径（`handleBattleStationStart` / `handleUnlockOnly` /
     * `handleUnlockThenPass`）用带提示的默认模式；`buildState` 判「哪些格子显示成可解锁」
     * 走 `silent = true` —— 两边必须同源，否则会分裂成「界面显示能点、点下去弹银子不够」
     * 或反过来「钱够了却不显示可点」。
     *
     * ⚠️ `combatPower` 传 `Number.MAX_SAFE_INTEGER`：战力门槛已被架空（见 `checkUnlock`），
     * 这里显式表达「不因战力拦截」，与原三处行为一致。
     */
    private canAffordUnlock(site: TerritorySite, silent = false): boolean {
        const progress = this.progress;
        const wallet = this.saveState?.wallet;
        if (!progress || !wallet) return false;
        const check = progress.checkUnlock(site.cellId, Number.MAX_SAFE_INTEGER);
        if (!check.ok) {
            if ('reason' in check && !silent) this.showTip(check.reason);
            return false;
        }
        const shortfall = wallet.silver < site.unlock.silverCost ? TERRITORY_TEXTS.silverNotEnough
            : wallet.stamina < site.unlock.staminaCost ? TERRITORY_TEXTS.staminaNotEnough
                : '';
        if (!shortfall) return true;
        if (!silent) this.showTip(shortfall);
        return false;
    }

    /** 走「解锁 → 开战」的站点类型：关卡 / 首领 / 异步据点（资源点与纯装饰不算）。 */
    private isBattleSite(site: TerritorySite): boolean {
        return site.type === TERRITORY_SITE_TYPE.stage
            || site.type === TERRITORY_SITE_TYPE.boss
            || site.type === TERRITORY_SITE_TYPE.asyncPvp;
    }

    /**
     * **主线关卡**（普通关 / 首领）。「解锁那一次直开」只对它生效：
     * asyncPvp 的弹窗带「侦查」，要留给人点。
     */
    private isLevelSite(site: TerritorySite): boolean {
        return site.type === TERRITORY_SITE_TYPE.stage
            || site.type === TERRITORY_SITE_TYPE.boss;
    }

    /**
     * @param openedCells 预算好的「已开启格」（owned ∪ unlocked）。不传时就地计算，
     *   供单次点击（`openRandomResourceCell`）用；`state` 里对每个候选格批量判时传入
     *   同一份，免得每格都 `Array.from(new Set(...))` 重建一次全集。
     */
    private randomResourceOpenCheck(
        cellId: number,
        openedCells?: readonly number[],
    ): TerritoryRandomCellOpenCheck {
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
            openedCells: openedCells
                ?? Array.from(new Set(progress.ownedCells.concat(progress.unlockedCells))),
            silver: wallet.silver,
            stamina: wallet.stamina,
            silverCost: map.randomSites.triggerSilver,
            staminaCost: map.defaults.staminaCost,
        });
    }

    private async openRandomResourceCell(cellId: number): Promise<void> {
        const map = this.map;
        const progress = this.progress;
        if (!map || !progress) return;
        const check = this.randomResourceOpenCheck(cellId);
        if (!check.ok) {
            if ('reason' in check && check.reason !== 'alreadyOpen' && check.reason !== 'notCandidate') {
                const reason = check.reason === 'silver' ? TERRITORY_TEXTS.silverNotEnough
                    : check.reason === 'stamina' ? TERRITORY_TEXTS.staminaNotEnough
                        : TERRITORY_TEXTS.randomNeedsNeighbor;
                this.showTip(reason);
            }
            return;
        }
        await this.runCellWrite(
            cellId, this.pendingRandomResourceCells, TERRITORY_TEXTS.busyOpen,
            () => this.ports.gateway.unlockCell(map.chapterId, cellId, this.ports.lifecycleHost),
            (result) => {
                if (!result.ok) {
                    this.showTip(TERRITORY_TEXTS.randomOpenFailed);
                    return;
                }
                // 🔴 随机格「解锁即通关」：服务端在解锁回包时已发奖，没有通关请求。
                // 只记 unlockable ⇒ 地图底色仍是泥地（未通关）；必须同时记 owned，
                // 地块才会立即变草地（`img_land_01`），与已领取的固定资源点同口径。
                // 注意不进 pendingPasses —— 随机格永不发 CmdCityChapterPassCellReqMsg。
                const openedCellIds = result.unlockedCellIds ?? [cellId];
                progress.markCellsUnlocked(openedCellIds);
                progress.markCellsPassed(openedCellIds);
                this.persistProgress();
                this.refreshWalletFromServer(false);
                // ⚠️ 不补「已开启」轻提示：随机格是解锁即发奖，**格子上喷出的资源**已经承担了
                // 这次操作的反馈（2026-10-26：这条反馈是粒子 + 飘字，不是奖励弹窗），
                // 再弹一句轻提示会和它抢同一时刻。
                // 失败分支的轻提示保留（那时没有资源喷发）。
                // 随机格是**解锁即发奖**，没有"开箱"这一步：直接喷资源图标（需求 2026-10-22 §1）。
                // 粒子个数由页面按奖励总量分级（< 50 很稀疏），不在这里算。
                // ⚠️ `{ chest: false }` 同时还意味着**不弹奖励窗**（2026-10-26 §3）：
                //    随机池发的是道具（非钱包类），走 `settleRewards` 会被全部判进 `popup`。
                if (result.rewards?.length) {
                    this.showRewards(result.rewards, cellId, { chest: false });
                }
            },
        );
    }

    /**
     * 单格服务端写请求的**统一骨架**：登记 pending → 渲染在途帧 → 发请求 → 竞态校验 → 收尾。
     *
     * 四个入口（解锁 / 解锁+通关 / 开战 / 随机格）原来各写一份逐字相同的十二行。
     *
     * 「什么算过期回包」由**入口**决定，不在这里分叉：`beginInteraction` 只在换了目标格时递增
     * 交互号，所以同一格连点的在途请求不会被自己作废、切到别的格才会。
     *
     * - `requestId` 必须在 **await 之前**取（入口 `beginInteraction` 已递增过）。
     * - 收尾渲染放在 `finally` 里（见下），竞态丢弃的 `return` 也能让界面退出在途帧。
     */
    private async runCellWrite<T>(
        cellId: number,
        pending: Set<number>,
        busyText: string,
        request: () => Promise<T>,
        handle: (result: T) => void,
    ): Promise<void> {
        if (pending.has(cellId)) return;
        const loadId = this.loadId;
        const requestId = this.interactionId;
        pending.add(cellId);
        this.emitStateChange();
        const exitBusy = this.enterBusy(busyText);
        try {
            const result = await request();
            if (loadId !== this.loadId || requestId !== this.interactionId) return;
            handle(result);
        } finally {
            pending.delete(cellId);
            exitBusy();
            // 🔴 收尾渲染必须在 `finally` 里，不能写在 try 之后：竞态丢弃（`return`）会跳过 try
            // 之后那行 ⇒ `stateCache` 不作废 ⇒ 界面继续读「pending 还在」的旧 state，
            // 按钮停在禁用帧点不动（2026-10-28 实测：随机格被丢弃后 `pendingRandomResourceCells`
            // 仍是 [4]）。只收尾当前章节任务，已取消任务不再发布状态。
            if (loadId === this.loadId) this.emitStateChange();
        }
    }

    /**
     * 进入「玩家发起的服务端写请求」时段：全屏 loading 遮挡防连点，直到退出函数被调用。
     *
     * ⚠️ 必须在 **await 之前、所有前置校验通过之后** 调用 —— 校验失败（资源不足 / 不可解锁）不发
     * 请求就不弹遮挡；同一帧内 enter 后立即 exit（校验分支 return）时 loading 来不及渲染，玩家无感。
     * 返回的退出函数幂等，引用计数让「两步式的一次操作」全程只显一层 loading。
     */
    private enterBusy(text: string): () => void {
        const release = () => {
            // 正常结束和宿主退出消费同一份释放动作，避免迟到 finally 重复撤回遮罩。
            if (!this.busyReleases.delete(release)) return;
            this.busyCount -= 1;
            // 🔴 每次 exit 都 hide（与 enterBusy 的 show 严格配对）：`LoadingPopup` 自身是
            // 全局引用计数（show +1 / hide -1、归零才关）。「归零才 hide」在**两个写请求并发**
            // 时（A show 后 B show ⇒ _refCount=2，A exit 不 hide，B exit 归零只 hide 一次 ⇒
            // 残留 1）会让全屏遮罩常驻 —— 遮罩上的 `BlockInputEvents` 会吞掉地图所有点击，
            // 表现为「刚解锁的宝箱再点没反应」。每次 hide 配对后：并发 ⇒ 2→1→0 正常关闭。
            this.setBusy(false);
        };
        this.busyCount += 1;
        this.busyReleases.add(release);
        this.setBusy(true, text);
        return release;
    }

    /** 显式取消：作废在途交互（关详情 / 切章节 / 快速寻敌 / dispose）。 */
    private cancelInteraction(): void {
        this.interactionId += 1;
        this.startingBattle = false;
        this.interactionCell = null;
    }

    /**
     * **全文件唯一的换号入口**：递增交互号并把目标格一起记下，返回新号。
     *
     * ⚠️ 别在别处裸写 `++this.interactionId` —— 换号不同步 `interactionCell` 会让两个状态脱节：
     * 号已经变了，但记录里还「停在这一格」⇒ 下一次点同一格会被 `beginInteraction` 判成
     * no-op（同格连点）⇒ **既不作废在途请求，也不清 `startingBattle`**，界面停在在途帧。
     * （`startBattle` 早前就是这么裸写的，与 `beginInteraction` 形成两条不一致的递增路径。）
     */
    private nextInteraction(cellId: number): number {
        this.interactionId += 1;
        this.interactionCell = cellId;
        this.startingBattle = false;
        return this.interactionId;
    }

    /**
     * 点击入口的交互门闩：**只有换了目标格才开新交互号**。
     *
     * 连点同一格不能递增 —— 递增会把**自己刚发出的**那条请求的回包判成「过期」，
     * 表现是「点了没反应」（`tests/territory-presenter.test.ts` 的
     * 「fixed resource keeps one pending request and records success…」与
     * 「random candidate keeps one pending request…」钉的就是这个）。
     * 切到别的格才算新交互：旧格的迟到回包不记账、不提示
     *（「re-clicking a stage while its unlock is in flight cancels the stale attempt」）。
     *
     * ⚠️ 早前这里是「每次点击无条件 `cancelInteraction()`」，于是同一格连点也换号，
     * 两类站点的语义被迫在 `runCellWrite` 里用参数分叉 —— 那是把矛盾塞进骨架。
     * 差异其实只在**这里**：要不要把「同格重复点击」当成新交互。
     */
    private beginInteraction(cellId: number): void {
        if (this.interactionCell === cellId) return;
        this.nextInteraction(cellId);
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
        // ⚠️ 走 `nextInteraction` 而不是裸 `++this.interactionId`：换号必须同步 `interactionCell`，
        // 否则下一次点同一格会被 `beginInteraction` 判成「同格连点」⇒ 作废不了这条在途请求。
        const requestId = this.nextInteraction(site.cellId);
        this.startingBattle = true;
        this.emitStateChange();

        if (this.progress?.isCellUnlocked(site.cellId)) {
            this.beginBattle(site, stage);
            return;
        }

        const exitBusy = this.enterBusy(TERRITORY_TEXTS.busyBattle);
        try {
            const unlock = await this.ports.gateway.unlockCell(
                map.chapterId, site.cellId, this.ports.lifecycleHost);
            // 取消或换章 / 换交互会作废任务版本，迟到结果不再提交。
            if (loadId !== this.loadId || requestId !== this.interactionId) return;
            if ('reason' in unlock) {
                if (unlock.reason === TERRITORY_REQUEST_STATUS.rejected) {
                    this.startingBattle = false;
                    this.showTip(TERRITORY_TEXTS.unlockRejected);
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
        this.requireChapter().saveState = begin.save;
        if (!begin.ok) {
            const reason = 'reason' in begin ? begin.reason : TERRITORY_TEXTS.resourceNotEnoughFallback;
            this.bossBattleStart = null;
            this.startingBattle = false;
            this.showTip(reason);
            this.emitStateChange();
            return;
        }
        this.emitStateChange();
        this.navigateToBattle({
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
        if (offset > 0) {
            const completion = this.chapterCompletion();
            if (!completion.complete) {
                this.showTip(TERRITORY_TEXTS.requireChapterComplete(completion.occupied, completion.total));
                return;
            }
        }
        void this.loadChapter(nextChapter);
    }

    /** 1 秒拍：仅在有探索进行时工作；探索到期且无新占领时早退（与旧 tickProgress 口径一致）。 */
    fastTick(now: number): void {
        if (this.loadingPushes || !this.progress || !this.progress.activeExplorations.length) return;
        if (!this.settleProgress(now).length) return;
        const idle = this.settleIdleRewards(now);
        this.ensureRandomResources();
        this.persistProgress();
        this.emitStateChange();
        if (idle?.rewards.length) this.showRewards(idle.rewards);
    }

    /** 60 秒拍：每拍都结算探索与挂机产出（与旧 tickIdleRewards 口径一致）。 */
    slowTick(now: number): void {
        if (this.loadingPushes) return;
        const claimed = this.settleProgress(now);
        const idle = this.settleIdleRewards(now);
        const randomChanged = this.ensureRandomResources();
        if (claimed.length || idle?.changed || randomChanged) {
            this.persistProgress();
            this.emitStateChange();
        }
        if (idle?.rewards.length) this.showRewards(idle.rewards);
        void this.reportPendingPasses();
    }

    // ============================================================
    // 章节加载
    // ============================================================

    private async loadChapter(chapterId: number): Promise<void> {
        const { loader, gateway, store, lifecycleHost } = this.ports;
        const pushes: ITerritoryChapterPushes = this.loadId === 0
            && this.loadingPushes?.chapterId === chapterId
            ? this.loadingPushes
            : { chapterId, passCells: new Set(), cellInfo: null };
        this.loadingPushes = pushes;
        const loadId = ++this.loadId;
        this.cancelInteraction();
        this.pendingFixedResourceCells = new Set<number>();
        this.pendingRandomResourceCells = new Set<number>();
        // ⚠️ 切章节必须清上一章的开战记录：它是「防连点重发开战请求」的判据，
        // 不清的话换章后点新章的关卡会被当成「已经开过战」而永远拒绝。
        this.bossBattleStart = null;
        // 失败回退用：`currentChapterId` 下面会先切到新章，加载失败要退回旧章
        //（否则 map 还是旧章、currentChapterId 已是新章，页面按新章号渲染旧地图，状态错乱）。
        const previousChapterId = this.chapter?.map.chapterId ?? this.currentChapterId;
        this.currentChapterId = chapterId;
        // Repository 不得复用旧章快照；Presenter 旧上下文只留作加载失败回退。
        gateway.clear();
        store.saveLastChapter(chapterId);
        this.startingBattle = false;
        this.resultNotice = '';
        this.detailStage = null;
        this.detailSite = null;
        this.emitStateChange();

        let bundle: ITerritoryChapterBundle | null;
        try {
            bundle = await loader.load(chapterId);
        } catch (error) {
            console.error('[TerritoryPresenter] 领地数据加载失败', error);
            if (loadId === this.loadId) {
                this.showTip(TERRITORY_TEXTS.loadFailed);
                this.currentChapterId = previousChapterId;
                store.saveLastChapter(previousChapterId);
                this.loadingPushes = null;
                this.emitStateChange();
            }
            return;
        }
        if (loadId !== this.loadId) return;
        if (bundle == null) {
            this.showTip(TERRITORY_TEXTS.loadFailed);
            this.currentChapterId = previousChapterId;
            store.saveLastChapter(previousChapterId);
            this.loadingPushes = null;
            this.emitStateChange();
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
        const map: TerritoryMapConfig = {
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
        const saveState = store.load(map.chapterId, this.ports.walletSeed());
        const context: ITerritoryChapterContext = {
            map,
            progress: new TerritoryProgress(map, saveState.progress),
            saveState,
            serverCellStateCache: null,
            // 章节完成度分母用去重 bindings，同区域扩散表只用于逐格展示。
            stages: bindings.map(({ site, stage }) => ({ site, stage })),
            stageByCell,
            layout: buildTerritoryMapLayout(map),
            art,
            playerCardCount: campaign.playerCardCount,
            idleRewardMaxHours: campaign.idleRewardMaxHours,
            levelAutoStart: campaign.levelAutoStart,
            randomResourceCells: [],
        };
        this.chapter = context;
        this.loadingPushes = null;
        this.refreshWalletFromServer(false);
        // 推送早于地图就绪时，先落地再发布首屏；拉取失败也不会丢失已确认状态。
        if (pushes.cellInfo) this.mergeCellInfo(context, pushes.cellInfo);
        if (pushes.passCells.size) this.mergePassCells(context, Array.from(pushes.passCells));
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
        if (loadId !== this.loadId) return;

        this.applyStoredBattleResult();
        const now = Date.now();
        this.settleProgress(now);
        this.persistProgress();
        const idle = this.settleIdleRewards(now);
        this.emitStateChange();
        if (idle?.rewards.length) this.showRewards(idle.rewards);
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
     * - 新占领、待确认清除或首次服务端确认都会刷新并落盘；重复确认保持幂等。
     * - ⚠️ **不动 `serverStateKnown`**（别调 `markServerStateKnown`）：那个标志管的是
     *   「服务端状态是否已知」，置 true 后 `isUnlockable` 会从"全放行"收紧成"只看 unlockCells"。
     *   而 **Bro 只讲通关、不带解锁信息**（`unlockCells` 传空）⇒ 一旦置 true，
     *   `unlockable` 还是空集，玩家会**点不动任何格子**。零报错，纯功能塌方。
     *
     * @param levelChapter Bro 里的章节号
     * @param cellIds 本次新增的格子 id（可能一批多个）
     */
    applyPassCellsBro(levelChapter: number, cellIds: readonly number[]): void {
        const chapterId = this.normalizeBroChapter(levelChapter);
        if (this.loadingPushes) {
            if (chapterId === this.loadingPushes.chapterId) {
                for (const cellId of cellIds) this.loadingPushes.passCells.add(cellId);
            }
            return;
        }
        const context = this.chapter;
        if (!context || chapterId !== context.map.chapterId) return;
        if (this.mergePassCells(context, cellIds)) this.emitStateChange();
    }

    private mergePassCells(context: ITerritoryChapterContext, cellIds: readonly number[]): boolean {
        const unconfirmed = cellIds.filter(cellId => !context.progress.isServerOwned(cellId));
        const pending = context.progress.pendingPassCells.length;
        const added = context.progress.applyServerState({ unlockCells: [], passCells: cellIds });
        if (!added.length && pending === context.progress.pendingPassCells.length
            && !unconfirmed.some(cellId => context.progress.isServerOwned(cellId))) return false;
        this.persistChapter(context);
        return true;
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
     * - 占领、解锁、待确认或权威状态变化才刷新 + 落盘，重复推送幂等。
     */
    applyCellInfoState(state: ITerritoryCellState): void {
        const chapterId = this.normalizeBroChapter(state.levelChapter);
        if (this.loadingPushes) {
            if (chapterId === this.loadingPushes.chapterId) {
                const previous = this.loadingPushes.cellInfo;
                this.loadingPushes.cellInfo = {
                    ...state,
                    unlockCells: Array.from(new Set([...(previous?.unlockCells ?? []), ...state.unlockCells])),
                    passCells: Array.from(new Set([...(previous?.passCells ?? []), ...state.passCells])),
                };
            }
            return;
        }
        const context = this.chapter;
        if (!context || chapterId !== context.map.chapterId) return;
        if (this.mergeCellInfo(context, state)) this.emitStateChange();
    }

    private mergeCellInfo(context: ITerritoryChapterContext, state: ITerritoryCellState): boolean {
        const progress = context.progress;
        const known = progress.serverStateKnown;
        const unlocked = progress.unlockedCells.length;
        const pending = progress.pendingPassCells.length;
        const unconfirmed = state.passCells.filter(cellId => !progress.isServerOwned(cellId));
        progress.markServerStateKnown(true);
        const added = progress.applyServerState(state);
        context.serverCellStateCache = state;
        const changed = added.length > 0 || !known || unlocked !== progress.unlockedCells.length
            || pending !== progress.pendingPassCells.length
            || unconfirmed.some(cellId => progress.isServerOwned(cellId));
        if (changed) this.persistChapter(context);
        return changed;
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
        this.requireChapter().randomResourceCells = active;
        this.requireChapter().saveState = { ...save, randomResourceCells: Array.from(active) };
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
        host: object,
    ): Promise<void> {
        const context = this.chapter;
        if (!context) return;
        const total = context.map.rows * context.map.columns;
        const result = await this.ports.gateway.fetchChapterCells(chapterId, total, host);
        if (loadId !== this.loadId || context !== this.chapter) return;
        if ('reason' in result) {
            console.warn(`[TerritoryPresenter] 第 ${chapterId} 章服务端格子状态不可用（${result.reason}），沿用本地存档`);
            return;
        }
        if (this.mergeCellInfo(context, result.state)) this.emitStateChange();
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
                this.requireChapter().saveState = this.ports.store.clearBattle(this.map.chapterId, this.saveState);
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
        this.requireChapter().saveState = this.ports.store.clearBattle(this.map.chapterId, this.saveState);
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
        if (!this.map || !this.progress || this.reportingLoadId === this.loadId) return;
        const loadId = this.loadId;
        const chapterId = this.map.chapterId;
        const progress = this.progress;
        this.reportingLoadId = loadId;
        try {
            for (const cellId of progress.pendingPassCells) {
                // 离线开战可能连解锁都没送达 ⇒ 补解锁（这是唯一需要发的请求）。
                if (!progress.serverStateKnown || !progress.isUnlockable(cellId)) {
                    const unlock = await this.ports.gateway.unlockCell(chapterId, cellId, this.ports.lifecycleHost);
                    if (loadId !== this.loadId) return;
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
        // 去重绑定只保留区域代表格；完成度与地图同用区域查询，不扩写实际占领存档。
        const progress = this.progress;
        const completedStageCells = this.stages
            .filter(({ site }) => progress?.isAreaPassed(site.cellId))
            .map(({ site }) => site.cellId);
        return territoryChapterCompletion(this.stages, completedStageCells);
    }

    private persistProgress(): void {
        if (this.chapter) this.persistChapter(this.chapter);
    }

    private persistChapter(context: ITerritoryChapterContext): void {
        context.saveState = this.ports.store.saveProgress(
            context.map.chapterId, context.progress.toJSON(), context.saveState,
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
        this.requireChapter().saveState = result.save;
        return result;
    }

    // ============================================================
    // 视图状态组装
    // ============================================================

    /**
     * 视图状态；**同一轮渲染内多次读返回同一对象**（见 `buildState` 的缓存说明）。
     *
     * 🔴 缓存身份对页面侧两处「异步补图标后按 `!== content` 判断选中项是否还在」的引用比较
     * 至关重要（`MainTerritoryMap.prefillLevelIcons` / `prefillPlayerStageIcons`）：缓存后
     * 同一轮内 `state.detail.levelInfo` 恒等，异步回来 `=== content` 成立才重开弹窗，符合
     * 「还是同一条内容就重开」的本意。缓存由 `emitStateChange` 作废 —— 而所有改动
     * `detailSite / progress / saveState / pending*` 的路径最终都经 `emitStateChange`
     * 广播（类头注释：页内刷新只有这一个通知通道），失效时机齐全。
     */
    get state(): ITerritoryViewState {
        return this.stateCache ??= this.buildState();
    }

    private buildState(): ITerritoryViewState {
        const map = this.map;
        const progress = this.progress;
        const ready = this.chapter !== null && this.loadingPushes === null;
        const revealedCells = map && progress ? territoryRevealedCells(map, progress) : [];
        // `revealedCells` 下面 `siteOpenableCells` 要逐 site 查一次 ⇒ 先做成 Set，
        // 把原来的 `Array.includes`（O(n) 线性查）降为 O(1)。
        const revealedSet = new Set(revealedCells);
        const wallet = this.saveState?.wallet;
        // 「能解锁」的判据**不在**这里另写一份：走 `canAffordUnlock(site, true)`（静默模式），
        // 与点击路径同源（含 `checkUnlock` 前置 + 银币 + 体力三项）。
        const siteOpenableCells = map && progress && wallet ? map.sites
            .filter((site) => revealedSet.has(site.cellId)
                && !progress.isCellUnlocked(site.cellId)
                && !progress.isOwned(site.cellId)
                && this.canAffordUnlock(site, true))
            .map((site) => site.cellId) : [];
        // 随机格可开判定逐候选格一次，`openedCells`（owned+unlocked 并集）对每格都一样 ⇒
        // 提到循环外算一次传进去，省掉原先每格都 `Array.from(new Set(concat))` 重建全集。
        const openedCells = progress
            ? Array.from(new Set(progress.ownedCells.concat(progress.unlockedCells)))
            : [];
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
                this.randomResourceOpenCheck(cellId, openedCells).ok) ?? [],
            pendingRandomResourceCells: Array.from(this.pendingRandomResourceCells),
            pendingFixedResourceCells: Array.from(this.pendingFixedResourceCells),
            hud: ready ? this.buildHud() : null,
            detail: {
                // 站点详情面板已移除（2026-10-27 山猫：不需要了）⇒ `open` 只表示「有站点被选中」，
                // 显示哪个弹窗看下面三个内容字段（玩家关卡 / 关卡界面 / 关卡提示）。
                open: this.detailSite !== null,
                playerStage: this.playerStageContent(),
                levelInfo: this.levelInfoContent(),
                levelTip: this.levelTipOpen ? this.levelTipContent() : null,
            },
        };
    }

    private buildHud(): ITerritoryHudRender {
        const map = this.map;
        if (!map) throw new Error('TerritoryModel 未注入地图配置');
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

    private levelInfoContent(): ITerritoryLevelInfoContent | null {
        const site = this.detailSite;
        if (!site) return null;
        if (site.type !== TERRITORY_SITE_TYPE.stage && site.type !== TERRITORY_SITE_TYPE.boss) return null;
        const stage = this.detailStage;
        const title = stage
            ? `${stage.isBoss ? TERRITORY_TEXTS.bossStageTitle : TERRITORY_TEXTS.stageTitle}  ${stage.stage}`
            : TERRITORY_UNBOUND_TYPE_NAMES[site.type];
        const rewards = stage ? stage.idleRewards.filter((reward) => reward.probability > 0 && reward.amount > 0) : [];
        const silver = rewards.find((reward) => reward.resId === TERRITORY_SILVER_RES_ID);
        const drops = rewards
            .filter((reward) => reward.resId !== TERRITORY_SILVER_RES_ID)
            .slice(0, TERRITORY_LEVEL_DROP_SLOTS)
            .map((reward) => ({ resId: reward.resId, amount: reward.amount }));
        const progress = this.progress;
        // 🔴 2026-10-28 起这个弹窗对**已通关**的关卡也照常开，而且按钮口径不再打折：
        // 用户「已通过的关卡重复挑战仍需要消耗体力」⇒ 已通关的普通关卡同样是「开始战斗」+
        // 照常显示体力费用（`handleBattleStationStart` 也不再对它们提前 return）。
        // 只有**还没解锁**的格子才写「解锁后开战」（点了先解锁，见 `handleUnlockOnly`）。
        const passed = !!progress && !!site && progress.isAreaPassed(site.cellId);
        const unlocked = !!progress && !!site
            && (progress.isCellUnlocked(site.cellId) || passed);
        return {
            title,
            // 敌军列表为空 ⇒ 感叹号藏起来（点了只会弹一个空框）
            hasTip: !!stage && stage.enemies.length > 0,
            objective: TERRITORY_TEXTS.levelObjective,
            occupy: silver
                ? TERRITORY_TEXTS.levelOccupy(silver.amount, silver.name)
                : TERRITORY_TEXTS.noReward,
            drops,
            recommend: '',
            fightCaption: unlocked ? TERRITORY_TEXTS.levelFight : TERRITORY_TEXTS.levelUnlock,
            // 绑不到关卡也允许点（点了走 `handleUnlockOnly` 只解锁），只有请求在途时禁掉。
            fightEnabled: !this.pendingFixedResourceCells.has(site.cellId) && !this.startingBattle,
            // 重复挑战照常扣体力 ⇒ 费用不再按「能不能再战」归零，恒等于关卡配置。
            staminaCost: stage?.staminaCost ?? 0,
        };
    }

    /** 「关卡提示」内容：敌军前 3 张卡 + 敌方说明拼接。 */
    private levelTipContent(): ITerritoryLevelTipContent | null {
        const info = this.levelInfoContent();
        const stage = this.detailStage;
        if (!info) return null;
        // 敌军**全量**下发：虚拟列表按条数渲染（设计稿只画 3 张，但一章经常超过 3 个）
        const enemies = stage
            ? stage.enemies.map((enemy) => ({
                headIcon: enemy.headIcon ?? '',
                name: `${enemy.name} Lv.${enemy.level}`,
                description: enemy.description ?? '',
            }))
            : [];
        // 描述框兜底：所有敌人都没写描述时，至少别让框空着。
        // 复用上面那份（不再把 `stage.enemies` 重扫一遍取 description）。
        const description = enemies
            .map((enemy) => enemy.description)
            .filter((text) => text !== '')
            .join('\n');
        return { title: info.title, enemies, description };
    }

    /**
     * 异步据点的「玩家关卡」弹窗内容；选中别的站点时返回 `null`。
     *
     * ## 数值口径
     *
     * - **占领奖励**：第一条是固定的「1 个卡牌宝箱」（设计稿口径，本期所有异步据点都一样）；
     *   第二条起取 `PVP-关卡.idleReward`（与「占领挂机产出」同一份配置），按万分比概率
     *   过滤掉 `pro == 0` 的行 —— 那些是策划留的空位，展示出来等于骗玩家。
     * - **侦查**：`TERRITORY_ASYNC_SCOUT_SILVER` 常量（服务端还没有侦查协议/配置；
     *   等协议到位替换成服务端下发的价格，视图侧不用改）。
     * - **开始战斗**：`site.unlock.silverCost`（= 真正的解锁价，与现有点击开战扣的是同一笔）。
     */
    private playerStageContent(): ITerritoryPlayerStageContent | null {
        const site = this.detailSite;
        if (!site || site.type !== TERRITORY_SITE_TYPE.asyncPvp) return null;
        const stage = this.detailStage;
        const rewards = stage
            ? stage.idleRewards
                .filter((reward) => reward.probability > 0 && reward.amount > 0)
                .slice(0, TERRITORY_ASYNC_REWARD_SLOTS)
                .map((reward) => ({ resId: reward.resId, amount: reward.amount }))
            : [];
        return {
            // 🔴 服务端暂不下发**对手玩家昵称**（`CmdCityChapterCellInfoRspMsg` 只有 bitSet），
            //    所以标题只能写据点类型；协议补上昵称后只改这一行。
            title: TERRITORY_UNBOUND_TYPE_NAMES.asyncPvp,
            chestText: TERRITORY_TEXTS.asyncPlayerChestReward,
            rewards,
            scoutCost: TERRITORY_ASYNC_SCOUT_SILVER,
            fightCost: Math.max(0, Math.round(site.unlock.silverCost)),
            fightCaption: TERRITORY_TEXTS.asyncPlayerFight,
            // 绑不到关卡 = 没有可开战的战斗参数，按钮直接灰掉（与 `handleUnlockOnly` 的兜底同口径）；
            // 解锁/开战请求在途时也灰掉，防连点。
            fightEnabled: stage !== null && !this.pendingFixedResourceCells.has(site.cellId)
                && !this.startingBattle,
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
        this.stateCache = null;
        this.publish({ kind: 'changed' });
    }

    private navigateToBattle(pve: ITerritoryBattleNavParams, battle?: ZCBattleStart): void {
        this.publish({ kind: 'navigate', payload: { pve, battle } });
    }

    private showTip(text: string): void {
        this.publish({ kind: 'tip', payload: { text } });
    }

    private showRewards(
        rewards: readonly (TerritoryIdleRewardGain | ITerritoryGrantedReward)[],
        originCellId?: number | null,
        options?: ITerritoryRewardPresentation,
    ): void {
        this.publish({ kind: 'rewards', payload: { rewards, originCellId, options } });
    }

    private setBusy(busy: boolean, text?: string): void {
        this.publish({ kind: 'busy', payload: { busy, text } });
    }
}
