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
import type { TerritoryGradeProModifier } from '../model/TerritoryCampaignConfig';
import {
    TERRITORY_IDLE_REWARD_MAX_HOURS_FALLBACK,
    TERRITORY_LEVEL_AUTO_START_FALLBACK,
} from '../model/TerritoryCampaignConfig';
import type { ITerritoryCellState } from '../model/TerritoryCellBitSet';
import { territoryRevealedCells } from '../model/TerritoryCellReveal';
import { territoryPreviewCells } from '../model/TerritoryPreview';
import type { ITerritoryGrantedReward } from '../model/TerritoryGrantedReward';
import type {
    TerritoryIdleRewardGain,
    TerritoryIdleRewardSource,
} from '../model/TerritoryIdleReward';
import { initializeTerritoryIdleRewards, TERRITORY_SILVER_RES_ID } from '../model/TerritoryIdleReward';
import type {
    TerritoryMapConfig,
    TerritorySite,
} from '../model/TerritoryMapConfig';
import { configureTerritoryMap, TERRITORY_SITE_TYPE, TERRITORY_SILVER_CHEST_REWARD_ID } from '../model/TerritoryMapConfig';
import type { ITerritoryMapLayout } from '../model/TerritoryMapLayout';
import { buildTerritoryMapLayout } from '../model/TerritoryMapLayout';
import { territoryPrerequisiteText } from '../model/TerritoryPrerequisite';
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
    chapterFinalBossCell,
    expandBindingsToAreaSites,
    findCurrentTerritoryLevel,
    findHighestPassedTerritoryLevel,
    territoryChapterCompletion,
} from '../model/TerritoryStageBinding';
import type { TerritoryChapterCompletion } from '../model/TerritoryStageBinding';
import type {
    TerritoryCellFetchResult,
    TerritoryIdleRewardResult,
    TerritoryStartBattleResult,
    TerritoryWriteResult,
} from './TerritoryCellRepository';
import type { ITerritoryBattleArt } from './TerritoryPageAssets';
import {
    TERRITORY_ASYNC_REWARD_SLOTS,
    TERRITORY_ASYNC_SCOUT_STAMINA,
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
    readonly rewards: readonly ITerritoryGrantedReward[];
    /**
     * 服务端开战结果。
     *
     * `null` = **这一条没有发开战请求**：普通关（`mode = match`）要先过匹配界面，
     * 开战请求归匹配页发（见 `ITerritoryNavigateBattlePayload.battleParams`）。
     */
    readonly battle: TerritoryStartBattleResult | null;
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
    /**
     * 领挂机奖励（`CmdCityChapterIdleRewardReqMsg`）。
     *
     * 回包 `tlCmdGoods` 是**服务端实际发放**的物品，必须原样展示；
     * `idleTime` 是新的挂机起点（秒），写回本地账本的只有它，不再本地掷骰结算。
     */
    claimIdleReward(host?: object): Promise<TerritoryIdleRewardResult>;
    /**
     * 章节扫荡（`CmdCityChapterSweepReqMsg { levelChapter, cellId, times }`）。
     *
     * 回包 `succ === 1` 才算成功，`tlCmdGoods` 是实际发放。
     * `times` 是**扫荡倍率**（协议缺省 1，档位见 `HJ_SWEEP_GEARS`）：服务端按
     * `倍率 × 单次消耗` 扣体力、按倍率发奖 —— 客户端只透传，不做本地结算。
     */
    sweep(chapterId: number, cellId: number, times: number, host?: object): Promise<TerritoryWriteResult>;
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
    /** `levelInfo.openGrideTime`：本关翻地块频率（秒），对局内用它压 NPC 翻地块的速度。 */
    readonly openGrideTime: number;
    /**
     * `levelInfo.gradeProModifier`：NPC 翻地块抽卡的品质权重乘数。
     * 缺省 ⇒ 不调整（塔防关卡 / 该列留空的关卡）。
     */
    readonly gradeProModifier?: TerritoryGradeProModifier;
    readonly waves: ReadonlyArray<{
        readonly waveId: number;
        readonly showAtSeconds: number;
        readonly pvpCardId: number;
        readonly monsterCount: number;
        readonly hpRate: number;
        readonly attackRate: number;
        /** 塔防 BOSS 波（每组最后一波）：HUD 大血条与胜负判定都用它。 */
        readonly isBoss: boolean;
        /** `defenceModWave.monsterSize`：1 普通 / 2 BOSS，对局内当怪物模型缩放倍率。 */
        readonly monsterSize: number;
    }>;
}

/** NavigateToBattle 事件载荷：pve 为现 ProcedureManager.navigate 的 { pve: … } 里的 pve。 */
export interface ITerritoryNavigateBattlePayload {
    readonly pve: ITerritoryBattleNavParams;
    readonly battle?: ZCBattleStart;
    /**
     * 这次是不是「**首次解锁 ⇒ 自动进战斗**」（需求 2026-11-02）。
     *
     * `true` ⇒ 页面先播一段镜头推进过场 + 弹「遭遇敌人，即将开始战斗」，过场结束再跳战斗页。
     * 只有 `handleUnlockThenBattle` 会置真：两条入口里，`handleBattleStationStart`
     * 是玩家在弹窗里自己按的「开始战斗」，那一下他早就在等跳转了，不能再拖 1.2 秒。
     */
    readonly approach?: boolean;
    /**
     * 普通关（`mode = 'match'`）交给**匹配页**发开战请求用的 `CmdStartBattleReqMsg.battleParams`
     * （`[子类型, 章节id, 格子id]`，见 `battleParamsFor`）。
     *
     * 为什么要交出去：2026-11-02 用户口径「点击关卡后没有进到匹配界面，直接进了战场」
     * + 「boss 关卡（塔防类模式）不进匹配界面」⇒ 普通关要先过匹配页，而匹配页本来就会自己发
     * 开战请求。领地这边再发一次就是同一关两个 battleId，所以改由匹配页发、这里只传参数。
     * 首领关（`defence`）走的是"先拿 battleId 再直进战场"，这一项为 `undefined`。
     */
    readonly battleParams?: readonly string[];
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
    /**
     * `true` = 这次写请求是**首次解锁直开**（解锁成功即开战，`approach` 那一路）。
     *
     * 为什么要提前告诉页面：其余开战请求在 `busy` 那一刻就把整页过场演起来了（云合拢、
     * 静止等回包）；而这一路要在回包之后先播「关卡地块生成 → 镜头推进 + 提示条」，
     * 云必须**最后**才盖上来。页面据此在 busy 阶段**不**起演过场。
     */
    readonly approach?: boolean;
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
    /**
     * `true` = **银币宝箱**（`rewardId = 1023` / `coinBox` 蓝银金属箱）的独立打开动画
     * （2026-11-10 用户口径：「不要用卡牌宝箱的打开动画，因为他们的图标不一致」）。
     *
     * 页面收到后**不播** `playChestOpen`（那是黄铜藤蔓箱 `chest_seq_*` 的三档全屏表演），
     * 改为让地图上那颗 `coinBox` icon 放大 → 缩小 → 消失。
     *
     * ⚠️ 判据由 Presenter 按 `site.rewardId` 给，页面不自己判格子类型 —— 与 `chest: false`
     * 同一条「玩法口径由 Model 指定」的分工。缺省 `false` = 卡牌碎片宝箱 / 其它来源，保持原样。
     */
    readonly silverChest?: boolean;
    /**
     * `true` = **强制弹奖励窗**，即使全部是钱包类（银币 / 体力）。
     *
     * 默认分流（`splitTerritoryRewards`）会把银币 / 体力剥去飘字、其余弹窗 ——
     * 那是给「格子产出」设计的。挂机征收要的是「点一下就看到服务端发了什么」，
     * 产出常常只有银币 / 体力，不强制弹就什么都看不到。
     */
    readonly popup?: boolean;
}

export interface ITerritoryModelPorts {
    readonly loader: ITerritoryChapterLoader;
    readonly gateway: ITerritoryCellGateway;
    readonly store: ITerritoryChapterStore;
    readonly walletSeed: () => TerritoryWallet;
    readonly readServerWallet: () => TerritoryWallet | null;
    /**
     * 服务端章节级挂机起点（**秒**）；`null` = 还没拿到。
     *
     * 真源是 `TerritoryChapterInfoRepository.instance.current.idleTime`
     * （账号级单例，登录后拉一次 + Bro 覆盖）—— Model 不自己发 `CmdCityChapterInfoReqMsg`，
     * 否则每进一次领地页就多一条重复请求（2026-11-09 实测日志里出现过两条）。
     */
    readonly readServerIdleTimeSeconds?: () => number | null;
    /**
     * 把领奖回包的新起点写回账号级快照（`TerritoryChapterInfoRepository`）。
     *
     * 服务端只在领奖 rsp 里给新 `idleTime`，不保证再推 `CmdCityChapterInfoBroMsg`；
     * 不写回的话征收弹窗 / 主城金币车的计时会停在旧值（领完仍显示满格）。
     */
    readonly writeServerIdleTimeSeconds?: (seconds: number) => void;
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
 * 两个按钮各带一份**体力**消耗 —— 数值全部来自配置与存档，视图不自己造数。
 */
export interface ITerritoryPlayerStageContent {
    readonly title: string;
    /** 第一条占领奖励的文案；空串 = 整条隐藏（没有卡牌宝箱奖励的据点）。 */
    readonly chestText: string;
    readonly rewards: readonly ITerritoryPlayerStageReward[];
    /** 「侦查」按钮的**体力**消耗。 */
    readonly scoutCost: number;
    /** 「开始战斗」按钮的**体力**消耗（= 关卡表的 `levelCost`，与主线「关卡界面」同源）。 */
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
    readonly idleRewardStartedAt: number | null;
    readonly idleRewardMaxHours: number;
    readonly chapterId: number;
    readonly map: TerritoryMapConfig | null;
    readonly layout: ITerritoryMapLayout;
    readonly art: ITerritoryBattleArt;
    readonly progress: TerritoryProgress | null;
    readonly revealedCells: readonly number[];
    /**
     * **提前披露**的格（2026-11-09）：第 1 关开局就露、通过第 1 关露首领 1、通过首领 1 露首领 2。
     *
     * 口径全在 `model/TerritoryPreview`（序列 = 第 1 关 + 每个首领，链式触发，整关 footprint）。
     * 这些格**已经并进** {@link revealedCells}，这里单独再给一份是为了让视图知道
     * 「哪几格要画建筑虚影」—— 只看 `revealedCells` 分不出"正常露出"与"提前披露"。
     *
     * 🔴 披露 ≠ 能开：解锁/扣银币那条链只认前置与钱包，与这份集合无关。
     */
    readonly previewCells: readonly number[];
    readonly siteOpenableCells: readonly number[];
    /**
     * 「被**前置**卡住、现在开不了」的格 —— 未解锁锁标（`icon_lock`）只认这一份。
     *
     *  · 站点格：`TerritoryProgress.isPrerequisitePending`
     *    = `prerequisiteBlockers` 非空（前置关卡没打通）**或** 前置宝箱「解锁了但没点开」；
     *  · 随机候选格：`canOpenTerritoryRandomCell` 判 `needsNeighbor`（四周没有已开启格）。
     *
     * 🔴 **不含「银币 / 体力不够」**（山猫 2026-11-05：「只有这种才需要上锁」，配图是
     *   「PVP 关卡通关后解锁」那种被前置卡住的格）。缺钱是钱包问题，价格数字变红才是它的表达 ——
     *   把缺钱也上锁，玩家每花一笔银子就会看见整图上锁。
     * 🔴 与 {@link siteOpenableCells} **互补**：进了这里的格一定不在可开启集合里（反之亦然），
     *   守卫见 `tests/territory-presenter.test.ts`「never overlaps cells that can be opened」。
     */
    readonly lockBlockedCells: readonly number[];
    readonly stageByCell: ReadonlyMap<number, TerritoryCampaignStage>;
    readonly randomResourceCells: readonly number[];
    readonly randomResourceOpenableCells: readonly number[];
    readonly pendingRandomResourceCells: readonly number[];
    readonly pendingFixedResourceCells: readonly number[];
    /**
     * 「胜利通过」收进来的格子（打完关卡 / 战斗胜利后新归我的那几格）。
     *
     * 只用来**挑动画节奏**：这批格子在 `TerritoryHexSpawn` 里走更重的那一档
     * （更长、带过冲、错峰更分明），普通的"云散开 / 解锁一片"仍是轻档。
     * 用户 2026-11-03：「胜利通过的地块动画节奏感需要比普通的地块生成动画更强，更明显」。
     */
    readonly victoryClaimCells: readonly number[];
    /**
     * 当前钱包（银币 / 体力）的只读快照 —— 供地图判「这颗消耗数字够不够」。
     *
     * 用户 2026-11-03：「体力不足或银币不足时，对应的数字 UI 显示红色」。
     * ⚠️ 只读语义：视图拿它做**比较**，不在这里扣钱（扣费真源是 `TerritorySaveStore`）。
     */
    readonly wallet: Readonly<TerritoryWallet>;
    /**
     * 本章是否**已通关**（= 通过本章最后一个首领关卡，见 {@link chapterCompletion}）。
     *
     * 给地图用：通关那一刻要演「整章云散」（用户 2026-11-04「完成章节云层消散的动画没有了」）。
     * 🔴 与 `hud.nextEnabled` **不同源**：后者还要 `hasNextChapter`（最后一章没有下一章，
     * 但同样该散雾），所以不能拿它反推。
     */
    readonly chapterCleared: boolean;
    /**
     * 「本章刚刚通关、云散还没演」—— **一次性**信号（发出去一拍就消费掉）。
     *
     * 与 {@link chapterCleared} 分开是为了区分「边沿」和「电平」：散雾只给首次通关演，
     * 切回一个早就通了的章节时 `chapterCleared` 依然为真，但这里是 `false`
     * ⇒ 地图直接把雾收掉、不演（用户 2026-11-05：「通过的动画只有首次通关章节播放，
     * 切换章节后获取到通过状态也不用播放」）。
     */
    readonly chapterClearPending: boolean;
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
    | { readonly kind: 'busy'; readonly payload: ITerritorySetBusyPayload }
    /**
     * 玩家主动切章（点章节按钮 / 章节选择弹窗）⇒ 页面播「镜头上移、新章居中」的转场。
     * 自动推进不发这条（见 `announceChapterSwitch`）。
     */
    | { readonly kind: 'chapterSwitch'; readonly fromChapterId: number; readonly toChapterId: number };

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
    /**
     * 服务端章节级挂机起点（毫秒）；`null` = 还没拿到（没拉过 `ChapterInfo`、离线、或刚切章）。
     *
     * ⚠️ 这是**服务端权威**的起点，优先级高于本地 per-level 账本
     * `idleRewardAtByLevel`（后者是接入协议前自造的：每个据点独立计时）。
     * 接入后 UI 计时看它，账本只在离线兜底时用。
     */
    private serverIdleTimeMs: number | null = null;
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
        // 宝箱提示气泡里的体力 icon（地图还没加载时页面会用这套空图，别让类型少一项）。
        staminaIcon: null,
        // 地皮三态（未通关 / 已通关 / **被前置卡住时置灰**）+ 四张「已解锁未通关」的格面框，
        // 口径见 `TerritoryMapView.paintHexes`。灰版取不到 ⇒ 锁着的格退回泥土（不空不裂）。
        tileLocked: null,
        tileCleared: null,
        tileGrey: null,
        // 前沿空锁格的锁标（`image/territory/icon_lock`）；空图 ⇒ 锁格只显示泥土台面。
        lockIcon: null,
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
        chestIcon: null,
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
    /**
     * 「开战流程已经接手，接下来这一下关详情是**程序关的**」。
     *
     * 交互号那条规则（换目标格才递增 ⇒ 旧回包作废）对「玩家关弹窗」是对的：玩家关掉详情 =
     * 放弃这一格，迟到回包不该再把他拽进战斗。但**整页过场接手的关详情不是这个意思** ——
     * 玩家刚刚按下的就是「开始战斗」，程序只是为了让过场露出来把弹窗收掉。
     *
     * 🔴 两者混在一起就是 2026-11-02 实测的那个 bug：点弹窗里的「开始战斗」
     *   ⇒ `busy` 命令起演过场 ⇒ `startBattleIntro` 关掉关卡界面 ⇒ 弹窗 `onClose` 发
     *   `closeDetail` ⇒ `cancelInteraction()` 把 `interactionId` 加一 ⇒ 回包到达时
     *   `runCellWrite` 判成过期**直接丢弃**（一行日志都没有）⇒ 没有 `navigate` ⇒
     *   过场在 `hold` 段干等 3 秒超时 ⇒ 复位回领地。
     *   表现就是「雾静止等回包，回包到了却没进战斗，又退回领地」。
     *
     * 生命周期：`keepBattleRequest()` 置真；任一开战收尾（发布 `navigate` / 开战被拒 /
     * 本地扣费失败 / 换交互 / 换章 / 销毁）置假。过场期间输入是锁着的（`setInputLocked(true)`），
     * 玩家点不到东西，所以这个窗口不会被玩家操作穿过。
     */
    private battleHandoff = false;
    private pendingFixedResourceCells = new Set<number>();
    private pendingRandomResourceCells = new Set<number>();
    /**
     * 上一次结算里**「胜利通过」收进来的格子**（只给动画挑节奏用，不参与玩法判定）。
     *
     * 每次 `settleProgress` 重算：它是"这一批该重播"的一次性信号，不是账本。
     */
    private victoryClaimCells: number[] = [];
    /** 已读到胜利存档、还没被 `settleProgress` 兑现过一次（见 `applyStoredBattleResult`）。 */
    private victoryPending = false;
    /**
     * 「本章**刚刚**通关、整章云散还没演过」—— 一次性信号，只随状态发出去一拍。
     *
     * 🔴 与 `chapterCleared` 是**两回事**：那个是持久状态（这一章通没通），这个是**边沿**
     * （这一次停留里是不是刚打通）。散雾是一段庆祝演出，只有首次通关才配播 ——
     * 按状态起演的话，切回一个早就通了的章节、或者存档里就通着的章节，进页面第一帧就要
     * 演一遍（用户 2026-11-05：「通过的动画只有首次通关章节播放，切换章节后获取到通过
     * 状态也不用播放」）。
     *
     * 只在本页实例里判「看着它从没通变成通」：本页一进来它就已经通着（`wasComplete` 为真）
     * ⇒ 永远不置位，跨会话/跨页面自然也不会重演，不需要额外落盘。
     */
    private chapterClearPending = false;
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
        this.battleHandoff = false;
        // 页面销毁后实例不再复用，但清掉更安全（防止同一实例被重新 start 时带着旧胜利标记）。
        this.victoryClaimCells = [];
        this.victoryPending = false;
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

    /**
     * 快速寻敌：选中**当前章节关卡链上「推进到的那一关」**（选点真源 `findCurrentTerritoryLevel`），
     * 返回定位格给视图滚屏。
     *
     * 2026-10-31 用户口径：「跳到当前章节地图上最新一个未通过的关卡，如果没有未通过的关卡，
     * 就打开已通过的关卡」—— 所以目标从「Boss」放宽成「整条关卡链」，全部通关才退回最高关。
     * 只开详情，**不**走点击站点的解锁 / 开战流程；镜头仍是既有的 `focusCell` 命令链，一行没动。
     */
    focusCurrentLevel(): number | null {
        if (this.startingBattle || this.busyCount > 0 || this.pendingRandomResourceCells.size > 0) return null;
        if (!this.map || !this.progress || this.map.chapterId !== this.currentChapterId) {
            this.showTip(TERRITORY_TEXTS.loadingChapter);
            return null;
        }
        const target = findCurrentTerritoryLevel(this.map.sites, this.stageByCell, this.progress);
        if (!target) {
            this.closeDetail();
            this.showTip(TERRITORY_TEXTS.noLevelTarget);
            return null;
        }
        this.cancelInteraction();
        this.detailSite = target.site;
        this.detailStage = target.stage;
        this.emitStateChange();
        return target.site.cellId;
    }

    selectSite(site: TerritorySite): void {
        if (this.loadingPushes || this.pendingRandomResourceCells.size > 0) return;
        // 先行换号：**点哪个格子**就是玩家的最新意图，哪怕这一格还没露出 / 点不动。
        // 在途的旧回包必须作废（否则会出现「点 A 在途 → 点了点不动的 B → A 的回包把界面解锁了」）。
        // 同一格连点是 no-op，所以「连点同一格仍要记账」的那两条用例不受影响。
        this.beginInteraction(site.cellId);
        if (!this.progress || !this.map
            || !territoryRevealedCells(this.map, this.progress, this.previewCellsNow()).includes(site.cellId)) return;
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
            //   → `markCellsUnlocked`），界面**不弹**；战斗站点解锁成功后**立刻发开战**（2026-10-29，
            //   2026-11-11 起含 asyncPvp，见下面那段口径）—— 只解锁的只剩绑不到 campaign 行的格子。
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
                //   ⚠️ 2026-11-11 用户「触发异步据点也是直接进入战斗」：直开名单从
                //     主线关卡（stage / boss）扩到**全部战斗站点**（含 asyncPvp）。
                //     已解锁 / 已通关的 asyncPvp 仍走下面 `detailSite = site` ⇒
                //     `BigMapPlayerLevelPanel` 的侦查 / 占领奖励 / 双按钮完整保留，
                //     被跳过的只是「花银币解锁那一次」的弹窗。
                //     绑不到 campaign 行时 `lockedStage = null` ⇒ 退回「只解锁」，不会发空请求。
                //   ⚠️ 开关是 `gameConfig.chapterLevelAutoStartConfig`（1 开 / 0 关，策划表口径），
                //     关掉之后这里退回「点一下只解锁」的老行为 —— 判据只在 `selectSite` 这一处，
                //     别在 `handleUnlockThenBattle` 里再判一遍（两处判据迟早不一致）。
                if (this.levelAutoStart && lockedStage && this.isAutoStartSite(site)) {
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
        if (this.loadingPushes || this.busyCount > 0 || this.pendingRandomResourceCells.size > 0
            || !this.map?.randomSites?.candidateCells.includes(cellId)) return;
        this.beginInteraction(cellId);
        this.detailSite = null;
        this.detailStage = null;
        this.emitStateChange();
        void this.openRandomResourceCell(cellId);
    }

    closeDetail(): void {
        // 🔴 过场接手的关详情 ≠ 玩家放弃（见 `battleHandoff` 的注释）：
        // 这时候**不能**换交互号，否则在途的开战回包会被 `runCellWrite` 判成过期丢掉，
        // 过场就只能等 `hold` 超时再把自己撤掉 —— 玩家看到的是「雾停住，然后退回领地」。
        if (this.battleHandoff) this.battleHandoff = false;
        else if (this.pendingRandomResourceCells.size === 0) this.cancelInteraction();
        this.detailSite = null;
        this.detailStage = null;
        this.levelTipOpen = false;
        this.emitStateChange();
    }

    /**
     * 「整页过场已经接手这次开战」—— 接下来由程序关掉的详情**不算玩家放弃**。
     *
     * 页面在 `startBattleIntro()` 里、关弹窗**之前**发这条：`busy`（开战中）起演、
     * 回包到达、跳转，这三段之间玩家按下的「开始战斗」都还是有效意图。
     * 真正的玩家放弃仍然走 `closeDetail`（点空白 / 关闭按钮），照旧作废迟到回包。
     */
    keepBattleRequest(): void {
        this.battleHandoff = true;
    }

    /**
     * 战斗流程没接手（预加载失败 / 路由没注册 / 被别的切换顶掉）⇒ 复位在途态。
     *
     * 不复位的话 `startingBattle` 会永远停在真：`requestBattle` 第一道 `if (this.startingBattle) return`
     * 把「开始战斗」变成死按钮，本地存档里那笔扣费也再没有第二次机会。
     */
    cancelBattleStart(): void {
        this.battleHandoff = false;
        this.startingBattle = false;
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
        // 🔴 2026-11-02（用户）：「点击关卡后没有进到匹配界面，直接进了战场」
        //    ⇒ **普通关（`mode = match`）不在这里发开战请求**：它要先过匹配界面，
        //      而匹配页本来就会自己发 `CmdStartBattleReqMsg`（`MatchingController.requestBattle`）。
        //      领地只负责扣费 + 把 `battleParams` 交出去；这里再发一次 = 同一关两个 battleId。
        // 🔴 同日补充：「boss 关卡（塔防类模式的关卡）不进匹配界面」
        //    ⇒ `mode = defence` 没有匹配这一步，仍然先拿 battleId 再直进战场。
        //    两条分支的判据就是 `stage.mode`，别按 `isBoss` / 站点类型另判一遍（两处判据迟早不一致）。
        if (stage.mode === 'match') {
            // 防连点靠 `navigateToBattle` 关详情（这一支**同步**落定、没有在途请求可拦），
            // 不靠 `startingBattle`：那个闩是给"等回包"用的，普通关没有回包可等，
            // 立起来反而要等页面发 `cancelBattleStart` 才解开（页面没播过场时永远解不开）。
            this.beginBattle(site, stage);
            return;
        }
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

    /**
     * 开战回包的统一收尾：失败只提示；成功记下战斗信息并进战斗。
     *
     * `result = null` = **这一局没走服务端开战**（普通关交给匹配页发请求），
     * 直接扣费进匹配。别把它当成失败：失败是 `{ ok: false }`。
     */
    private applyBattleStart(
        site: TerritorySite,
        stage: TerritoryCampaignStage,
        result: TerritoryStartBattleResult | null,
        /** `true` = 首次解锁直开，页面对这次跳转播一段「遭遇敌人」过场（见 payload 的 `approach`）。 */
        approach = false,
    ): void {
        if (result && !result.ok) {
            // 服务端没认这一局 ⇒ 过场会由页面的 `tip` 收掉，接管窗口在这里先关。
            this.battleHandoff = false;
            this.showTip(TERRITORY_TEXTS.bossBattleStartFailed);
            return;
        }
        // `result?.ok` 缩窄成"有 battle"的那一支；别写成 `result.battle`（联合类型上取不到）。
        const battle = result?.ok ? result.battle : undefined;
        if (battle) this.bossBattleStart = { battleId: battle.battleId, seed: battle.seed };
        this.beginBattle(site, stage, battle, approach);
    }

    /**
     * 锁着的战斗站点格（关卡 / 首领 / **异步据点**）：**解锁成功即开战**（不弹详情面板）。
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
        if (!territoryRevealedCells(map, progress, this.previewCellsNow()).includes(site.cellId)) return;
        // 解锁前的「前置满足 + 钱包够」与 `handleUnlockOnly` 同一条校验（失败自带提示）。
        if (!this.canAffordUnlock(site)) return;
        await this.runCellWrite<ITerritoryUnlockThenBattleOutcome | null>(
            site.cellId, this.pendingFixedResourceCells, TERRITORY_TEXTS.busyBattle,
            () => this.unlockThenStartBattle(site, stage, map.chapterId),
            (outcome) => {
                if (!outcome) return;
                if (outcome.rewards.length) this.showRewards(outcome.rewards, site.cellId);
                // 🔴 按**回包给的数组**逐格记账（服务端一次解锁整片区域），与 `handleUnlockOnly` 同口径。
                progress.markCellsUnlocked(outcome.unlockedCellIds);
                this.persistProgress();
                this.refreshWalletFromServer(false);
                // 🔴 只有这条入口带 `approach`：解锁成功即开战是**系统替玩家做的决定**，
                // 玩家连关卡界面都没看到就突然切场景，所以要一段"遭遇敌人"的过场交代一句。
                this.applyBattleStart(site, stage, outcome.battle, true);
            },
            // 🔴 同上：busy 那一刻**不要**让页面把云盖上来 —— 这一路要先看
            // 「① 关卡地块生成 → ② 镜头推进 + 提示条 → ③ 云层过场」（用户 2026-11-02）。
            true,
        );
    }

    /**
     * 「解锁 → 开战」两段串行；解锁没成功就返回 `null`（格子仍锁着，下次点击重来）。
     *
     * ⚠️ 这里**不做** `startBattle` 那种 fail-open：解锁状态是服务端权威，
     * 回包 `offline` / `failed` 时直接发开战会被服务端按「未解锁」拒掉，
     * 不如原地提示（`startBattle` 放行的是纯本地开战，不发 `CmdStartBattleReqMsg`，两者不是一回事）。
     *
     * ⚠️ 普通关（`mode = match`）第二段**不发**开战请求，`battle` 返回 `null`：
     * 它要先过匹配界面，开战请求归匹配页（与 `handleBattleStationStart` 同一条口径）。
     */
    private async unlockThenStartBattle(
        site: TerritorySite,
        stage: TerritoryCampaignStage,
        chapterId: number,
    ): Promise<ITerritoryUnlockThenBattleOutcome | null> {
        const unlock = await this.ports.gateway.unlockCell(
            chapterId, site.cellId, this.ports.lifecycleHost);
        if (!unlock.ok) {
            this.showTip(TERRITORY_TEXTS.bossUnlockFailed);
            return null;
        }
        if (stage.mode === 'match') {
            return { unlockedCellIds: unlock.unlockedCellIds ?? [site.cellId], battle: null, rewards: unlock.rewards ?? [] };
        }
        const battle = await this.ports.gateway.startBattle(
            ZC_BATTLE_TYPE_CHAPTER,
            this.battleParamsFor(site, chapterId),
            this.ports.lifecycleHost,
        );
        return { unlockedCellIds: unlock.unlockedCellIds ?? [site.cellId], battle, rewards: unlock.rewards ?? [] };
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
        if (!territoryRevealedCells(map, progress, this.previewCellsNow()).includes(site.cellId)) return;
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
                if (result.rewards?.length) this.showRewards(result.rewards, site.cellId);
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
            if (!territoryRevealedCells(map, progress, this.previewCellsNow()).includes(site.cellId)) return;
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
                    // 银币宝箱（rewardId = 1023 / coinBox 蓝银金属箱）走**独立**打开动画；
                    // 卡牌碎片宝箱（1016~1022 / 黄铜藤蔓箱）仍走 `chest_seq_*` 三档开箱表演。
                    // ⚠️ 保留 else 分支里 `showRewards(result.rewards, site.cellId)` 这串原样调用：
                    //    `territory-cell-protocol` / `territory-burst-density` 钉的是「资源点领取
                    //    仍走默认开箱」，不能因为新增一种宝箱就把那条契约抹掉。
                    // ⚠️ 判据只认 `site.rewardId`（配表口径），不看回包奖励内容：奖励按概率抽，
                    //    卡牌碎片宝箱这一批也可能恰好全是银币。
                    if (site.rewardId === TERRITORY_SILVER_CHEST_REWARD_ID) {
                        this.showRewards(result.rewards, site.cellId, { silverChest: true });
                    } else {
                        this.showRewards(result.rewards, site.cellId);
                    }
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
            if ('reason' in check && !silent) this.showTip(this.unlockBlockTip(check.reason, site));
            return false;
        }
        const shortfall = wallet.silver < site.unlock.silverCost ? TERRITORY_TEXTS.silverNotEnough
            : wallet.stamina < site.unlock.staminaCost ? TERRITORY_TEXTS.staminaNotEnough
                : '';
        if (!shortfall) return true;
        if (!silent) this.showTip(shortfall);
        return false;
    }

    /**
     * 把 `checkUnlock` 的失败原因翻成**玩家看得懂的那句话**。
     *
     * 只有「前置没满足」需要改写（需求 2026-11-02）：原来一律弹「前置领地尚未占领」，
     * 而玩家真正需要知道的是**卡在哪一块** —— 是几号关卡没打，还是哪只宝箱没打开。
     * 其余 reason（战力不足 / 已在探索 / 已占领…）本来就够具体，原样返回。
     */
    private unlockBlockTip(reason: string, site: TerritorySite): string {
        if (reason !== TERRITORY_TEXTS.prerequisiteNotOwned) return reason;
        return this.prerequisiteBlockText(site);
    }

    /**
     * 「先打完 1-1 关卡」还是「先把宝箱点开」—— 拼给玩家看的那一句。
     *
     * 只负责取数据（未满足的前置格 + 地图 + 关卡表），拼法与口径全在
     * `model/TerritoryPrerequisite.territoryPrerequisiteText`（纯函数，按真数据单测）。
     * 叫不出名字（前置是不属于任何站点的普通地块）⇒ 退回通用文案。
     */
    private prerequisiteBlockText(target: TerritorySite): string {
        const progress = this.progress;
        const map = this.map;
        if (!progress || !map) return TERRITORY_TEXTS.prerequisiteNotOwned;
        const text = territoryPrerequisiteText(
            progress.prerequisiteBlockers(target.cellId), map.sites, this.stageByCell,
        );
        return text || TERRITORY_TEXTS.prerequisiteNotOwned;
    }

    /** 走「解锁 → 开战」的站点类型：关卡 / 首领 / 异步据点（资源点与纯装饰不算）。 */
    private isBattleSite(site: TerritorySite): boolean {
        return site.type === TERRITORY_SITE_TYPE.stage
            || site.type === TERRITORY_SITE_TYPE.boss
            || site.type === TERRITORY_SITE_TYPE.asyncPvp;
    }

    /**
     * **「花银币解锁那一次就立刻开战」的站点名单**（2026-11-11）。
     *
     * 2026-10-29 只有主线关卡（stage / boss）；当时的注释「asyncPvp 的弹窗带侦查，
     * 要留给人点」在 2026-11-11 被用户「触发异步据点也是直接进入战斗」覆盖：
     * asyncPvp 并入直开名单。**已解锁 / 已通关仍弹侦查面板**，那句旧注释只针对锁态分支。
     *
     * 与 {@link isBattleSite} 的区别：那边管「能不能发开战请求」，这边只管「要不要跳过弹窗」。
     * 两张名单眼下恰好相同，但语义不同 —— 以后某个战斗站点要保留弹窗时只改这里。
     */
    private isAutoStartSite(site: TerritorySite): boolean {
        return this.isBattleSite(site);
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
            cellId, this.pendingRandomResourceCells, null,
            async () => {
                const loadId = this.loadId;
                const result = await this.ports.gateway.unlockCell(map.chapterId, cellId, this.ports.lifecycleHost);
                // 写请求超时不代表服务器没执行，先用既有章节快照合并流程核对。
                if (loadId === this.loadId && 'reason' in result && result.reason === TERRITORY_REQUEST_STATUS.failed) {
                    await this.mergeServerState(map.chapterId, loadId, this.ports.lifecycleHost);
                }
                return result;
            },
            (result) => {
                if (!result.ok) {
                    if (!progress.isCellUnlocked(cellId)) this.showTip(TERRITORY_TEXTS.randomOpenFailed);
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
        busyText: string | null,
        request: () => Promise<T>,
        handle: (result: T) => void,
        /** `true` = 这一路是首次解锁直开：busy 阶段只弹加载条，过场交给页面在回包后排。 */
        approachBusy = false,
    ): Promise<void> {
        if (pending.has(cellId)) return;
        const loadId = this.loadId;
        const requestId = this.interactionId;
        pending.add(cellId);
        this.emitStateChange();
        const exitBusy = busyText === null ? null : this.enterBusy(busyText, approachBusy);
        try {
            const result = await request();
            if (loadId !== this.loadId || requestId !== this.interactionId) {
                // 🔴 这里静默 `return` 过一次实机事故（2026-11-02）：过场接手时关掉关卡界面
                //    ⇒ `closeDetail` 换交互号 ⇒ 开战回包被当成过期丢掉 ⇒ 没有 `navigate`
                //    ⇒ 过场干等 3 秒再复位。控制台里只有「收到开战回包」，看不出后半段没发生。
                //    丢弃是**正常**路径（玩家确实切走了），但不该无迹可寻。
                console.info(
                    `[TerritoryModel] 第 ${this.map?.chapterId ?? '?'} 章格子 ${cellId} 的写回包被竞态作废`
                    + `（交互号 ${requestId} → ${this.interactionId}），结果不记账`,
                );
                return;
            }
            handle(result);
        } finally {
            pending.delete(cellId);
            if (exitBusy) exitBusy();
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
    private enterBusy(text: string, approach = false): () => void {
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
        this.setBusy(true, text, approach);
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
        // 换了目标格 ⇒ 上一次「开战接管」肯定已经过期，别把它留给下一次关详情。
        this.battleHandoff = false;
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
                    `[TerritoryModel] 第 ${map.chapterId} 章格子 ${site.cellId} 解锁请求未确认（${unlock.reason}），按本地继续`,
                );
            }
            if (unlock.ok) {
                this.progress?.markCellsUnlocked(unlock.unlockedCellIds ?? [site.cellId]);
                if (unlock.rewards?.length) this.showRewards(unlock.rewards, site.cellId);
            }

            this.beginBattle(site, stage);
        } finally {
            exitBusy();
        }
    }

    /** 解锁已确认（或网络不可用决定放行）之后，真正扣资源 + 进战斗。 */
    private beginBattle(
        site: TerritorySite,
        stage: TerritoryCampaignStage,
        battle?: ZCBattleStart,
        /** `true` = 首次解锁直开，页面据此先播「遭遇敌人」过场再跳转。 */
        approach = false,
    ): void {
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
            // 本地扣费没过 ⇒ 这一局压根没开：过场由 `tip` 收掉，接管窗口同步关。
            this.battleHandoff = false;
            this.showTip(reason);
            this.emitStateChange();
            return;
        }
        this.emitStateChange();
        // 普通关（`mode = match`）要先过匹配界面，而开战请求由匹配页发 ⇒ 把参数交出去。
        // 首领关（`defence`）在这一步已经拿到 `battle`（battleId / 单元），不需要再带。
        const battleParams = stage.mode === 'match'
            ? this.battleParamsFor(site, this.map.chapterId)
            : undefined;
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
            openGrideTime: stage.openGrideTime,
            gradeProModifier: stage.gradeProModifier,
            waves: stage.waves.flatMap((wave) => wave.pvpCardId ? [{
                waveId: wave.waveId,
                showAtSeconds: wave.showAtSeconds,
                pvpCardId: wave.pvpCardId,
                monsterCount: wave.monsterCount,
                hpRate: wave.hpRate,
                attackRate: wave.attackRate,
                isBoss: wave.isBoss,
                monsterSize: wave.monsterSize,
            }] : []),
        }, battle, approach, battleParams);
    }

    switchChapter(offset: number): void {
        const index = this.ports.availableChapters.indexOf(this.currentChapterId);
        const nextChapter = this.ports.availableChapters[index + offset];
        if (nextChapter === undefined || nextChapter === this.currentChapterId) return;
        if (offset > 0) {
            const completion = this.chapterCompletion();
            if (!completion.complete) {
                this.showTip(TERRITORY_TEXTS.requireChapterComplete());
                return;
            }
        }
        this.announceChapterSwitch(nextChapter);
        void this.loadChapter(nextChapter, false);
    }

    /**
     * 章节选择弹窗选章：按 `chapterId` 直接切（`switchChapter` 只够「翻一页」）。
     *
     * 门槛与「往后翻」一致：目标章排位在当前章之后、且当前章未通关 ⇒ 只出提示、不切章；
     * 往回选旧章不设门槛（既有行为，见 `switchChapter` 的 `offset > 0` 分支）。
     */
    selectChapter(chapterId: number): void {
        const chapters = this.ports.availableChapters;
        if (chapterId === this.currentChapterId || !chapters.includes(chapterId)) return;
        if (chapters.indexOf(chapterId) > chapters.indexOf(this.currentChapterId)) {
            const completion = this.chapterCompletion();
            if (!completion.complete) {
                this.showTip(TERRITORY_TEXTS.requireChapterComplete());
                return;
            }
        }
        this.announceChapterSwitch(chapterId);
        void this.loadChapter(chapterId, false);
    }

    /**
     * 告诉页面「这一次换章是**玩家点的章节按钮**」⇒ 播「镜头上移、新章居中」的转场。
     *
     * 🔴 只有玩家点了才播（用户 2026-11-04：「玩家只能通过章节按钮播放切换动画」）：
     *   自动推进（通关后 `advanceCompletedChapter`）走的是另一条路，那里**不发**这条命令，
     *   页面就不会演转场 —— 两条路径的差别就在这里，不靠"猜这次是不是自动"。
     *
     * 时机在 `loadChapter` **之前**：页面要先把云合拢，新图才有地方"升进来"。
     * 加载失败时模型会把 `chapterId` 退回旧章，页面看到"章号没变"就当没这回事收场。
     */
    private announceChapterSwitch(toChapterId: number): void {
        this.publish({ kind: 'chapterSwitch', fromChapterId: this.currentChapterId, toChapterId });
    }

    private advanceCompletedChapter(): void {
        if (this.loadingPushes || !this.chapterCompletion().complete) return;
        const index = this.ports.availableChapters.indexOf(this.currentChapterId);
        const nextChapter = index >= 0 ? this.ports.availableChapters[index + 1] : undefined;
        if (nextChapter !== undefined) void this.loadChapter(nextChapter);
    }

    /**
     * 「这一拍通关了」⇒ 置位一次性演出信号（{@link chapterClearPending}）。
     *
     * 判据必须是**前后对比**（`wasComplete` 是这一拍动手**之前**取的），不能是"现在通没通"：
     * 那个是持久状态，切回旧章一进页面就成立。而且比完要赶在 `emitStateChange` **之前**
     * ——状态是随这次广播发出去的，晚一拍页面就收不到置位（下一拍起又都是 false）。
     *
     * @param wasComplete 这一拍开始**之前**的通关态（各调用点已经取好的那个局部量）
     */
    private noteChapterJustCleared(wasComplete: boolean): void {
        if (wasComplete) return;
        if (!this.chapterCompletion().complete) return;
        this.chapterClearPending = true;
    }

    /** 1 秒拍：仅在有探索进行时工作；探索到期且无新占领时早退（与旧 tickProgress 口径一致）。 */
    fastTick(now: number): void {
        if (this.loadingPushes || !this.progress || !this.progress.activeExplorations.length) return;
        const wasComplete = this.chapterCompletion().complete;
        if (!this.settleProgress(now).length) return;
        this.ensureRandomResources();
        this.persistProgress();
        this.noteChapterJustCleared(wasComplete);
        this.emitStateChange();
        if (!wasComplete) this.advanceCompletedChapter();
    }

    /** 60 秒拍：刷新探索和随机资源；挂机产出留到点击征收时领取。 */
    slowTick(now: number): void {
        if (this.loadingPushes) return;
        const wasComplete = this.chapterCompletion().complete;
        const claimed = this.settleProgress(now);
        const randomChanged = this.ensureRandomResources();
        if (claimed.length || randomChanged) {
            this.persistProgress();
            this.noteChapterJustCleared(wasComplete);
            this.emitStateChange();
        }
        void this.reportPendingPasses();
        if (!wasComplete) this.advanceCompletedChapter();
    }

    // ============================================================
    // 章节加载
    // ============================================================

    private async loadChapter(chapterId: number, autoAdvance = true): Promise<void> {
        const { loader, gateway, store, lifecycleHost } = this.ports;
        const pushes: ITerritoryChapterPushes = this.loadId === 0
            && this.loadingPushes?.chapterId === chapterId
            ? this.loadingPushes
            : { chapterId, passCells: new Set(), cellInfo: null };
        this.loadingPushes = pushes;
        const loadId = ++this.loadId;
        this.cancelInteraction();
        this.battleHandoff = false;
        this.pendingFixedResourceCells = new Set<number>();
        this.pendingRandomResourceCells = new Set<number>();
        // 上一章的胜利标记不能漏到新章：否则新章第一次普通生成也会被当成「胜利通过」放大播。
        this.victoryClaimCells = [];
        this.victoryPending = false;
        // 通关演出的待播信号同理：它只属于"刚刚打通的那一章"，新章有它自己的命。
        this.chapterClearPending = false;
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
            console.error('[TerritoryModel] 领地数据加载失败', error);
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
                        // 只覆盖体力；`exploreSeconds`（通关后「探索中」倒计时）留在**地图配置**里，
                        // 不能被 `levelInfo.openGrideTime` 带过来 —— 那一列只管战斗内 NPC 翻地块的频率（2026-11-11）。
                        staminaCost: stage.staminaCost,
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
        this.serverIdleTimeMs = null;
        this.loadingPushes = null;
        const wasComplete = this.chapterCompletion().complete;
        const returningFromBattle = saveState.battle !== null && saveState.battle !== undefined;
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
        this.noteChapterJustCleared(wasComplete);
        this.emitStateChange();
        this.refreshServerIdleTime(chapterId);

        await this.mergeServerState(chapterId, loadId, lifecycleHost);
        if (loadId !== this.loadId) return;

        this.applyStoredBattleResult();
        const now = Date.now();
        this.settleProgress(now);
        this.persistProgress();
        this.noteChapterJustCleared(wasComplete);
        this.emitStateChange();
        void this.reportPendingPasses();
        // 手动回看只展示旧章；战斗返回或新同步的通关结果才自动推进。
        if (autoAdvance && (!wasComplete || returningFromBattle)) this.advanceCompletedChapter();
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
        const wasComplete = this.chapterCompletion().complete;
        if (this.mergePassCells(context, cellIds)) {
            this.noteChapterJustCleared(wasComplete);
            this.emitStateChange();
        }
        if (!wasComplete) this.advanceCompletedChapter();
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
        const wasComplete = this.chapterCompletion().complete;
        if (this.mergeCellInfo(context, state)) {
            this.noteChapterJustCleared(wasComplete);
            this.emitStateChange();
        }
        if (!wasComplete) this.advanceCompletedChapter();
    }

    private mergeCellInfo(context: ITerritoryChapterContext, state: ITerritoryCellState): boolean {
        const progress = context.progress;
        const known = progress.serverStateKnown;
        const unlocked = progress.unlockedCells.length;
        const pending = progress.pendingPassCells.length;
        const unconfirmed = state.passCells.filter(cellId => !progress.isServerOwned(cellId));
        progress.markServerStateKnown(true);
        // `CmdCityChapterCellInfoRspMsg` 是**完整快照**（`unlockCells` / `passCells` 都是全量 bitSet）
        // ⇒ 解锁集按它重建。只并集的话，本地存档里多出来的解锁格会永久顶着「前置已满足」，
        // 点击就会发 `CmdCityChapterUnlockCellReqMsg` 被服务端打回「前置地块未解锁」（2026-11-09 实机）。
        const added = progress.applyServerState(state, { replaceUnlocks: true });
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
            console.warn(`[TerritoryModel] 第 ${chapterId} 章服务端格子状态不可用（${result.reason}），沿用本地存档`);
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
            // 这一批格子是"打赢了才归我的"⇒ 记下来，下一次 `settle` 收到它们时走更重的进场节奏。
            if (result.ok) this.victoryPending = true;
        } else if (battle.status === TERRITORY_BATTLE_STATUS.defeat) {
            this.resultNotice = TERRITORY_TEXTS.defeat;
        }
        this.requireChapter().saveState = this.ports.store.clearBattle(this.map.chapterId, this.saveState);
    }

    private settleProgress(now: number): number[] {
        if (!this.progress) return [];
        const claimed = this.progress.settle(now);
        // 每次结算都重定这批"胜利格"：它只服务于**紧接着的那一次渲染**，
        // 留着不放会让后面无关的生成批次也走重档。
        this.victoryClaimCells = [];
        if (claimed.length) {
            if (this.victoryPending) {
                this.victoryClaimCells = claimed.slice();
                this.victoryPending = false;
            }
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
                    if (unlock.rewards?.length) this.showRewards(unlock.rewards, cellId);
                }
                // 🔴 不发 passCell：关卡通关等服务端主动下发，applyServerState 清 pendingPasses。
            }
        } finally {
            if (this.reportingLoadId === loadId) this.reportingLoadId = null;
        }
    }

    /**
     * 章节通关判定 + HUD 用的占领进度。
     *
     * ## 通关判据（2026-11-04 用户口径）
     * **通过本章最后一个首领（boss）关卡**即算通关，**异步据点不参与判定**：
     *
     * > 「章节通关条件：通过该章节的最后 1 个 boss 关卡，但是不用通过所有的异步据点」
     *
     * `occupied / total` 仍然按「已占领的关卡站点数 / 关卡站点总数」算 —— 它们是 HUD 上
     * 「已占领 x/y」的展示口径，与"通没通关"是两件事，别合成一个数。
     *
     * ⚠️ 本章一个可打的首领都没配（配置缺失）⇒ **退回**旧的「全部站点占领」口径：
     * 那种情况按新判据永远不成立，会让下一章永远锁着（死锁比漏判严重）。
     */
    private chapterCompletion(): TerritoryChapterCompletion & { readonly bossCellId: number | null } {
        // 去重绑定只保留区域代表格；完成度与地图同用区域查询，不扩写实际占领存档。
        const progress = this.progress;
        const completedStageCells = this.stages
            .filter(({ site }) => progress?.isAreaPassed(site.cellId))
            .map(({ site }) => site.cellId);
        const completion = territoryChapterCompletion(this.stages, completedStageCells);
        const bossCellId = chapterFinalBossCell(this.stages);
        const complete = bossCellId === null
            ? completion.complete
            : progress != null && progress.isAreaPassed(bossCellId);
        return { ...completion, complete, bossCellId };
    }

    private persistProgress(): void {
        if (this.chapter) this.persistChapter(this.chapter);
    }

    private persistChapter(context: ITerritoryChapterContext): void {
        context.saveState = {
            ...context.saveState,
            idleRewardAtByLevel: initializeTerritoryIdleRewards(
                context.saveState.idleRewardAtByLevel, this.buildIdleRewardSources(context), Date.now()),
        };
        context.saveState = this.ports.store.saveProgress(
            context.map.chapterId, context.progress.toJSON(), context.saveState,
        );
    }

    /** 收集已占领站点的挂机产出配置；禁用站点不在 ownedCells 里，无需额外过滤。 */
    private buildIdleRewardSources(context = this.chapter): TerritoryIdleRewardSource[] {
        if (!context) return [];
        const sources: TerritoryIdleRewardSource[] = [];
        for (const item of context.stages) {
            if (!context.progress.isOwned(item.site.cellId) || !item.stage.idleRewards.length) continue;
            sources.push({ levelId: item.stage.levelId, rewards: item.stage.idleRewards });
        }
        return sources;
    }

    /**
     * 征收（领取挂机奖励）。
     *
     * ## 在线走协议（2026-11-09 接入）
     *
     * `CmdCityChapterIdleRewardReqMsg`（**空请求体**）→ rsp `{ idleTime, tlCmdGoods }`：
     *
     *   · `tlCmdGoods` 是服务端**实际发放**的物品，原样进奖励弹窗。这里传
     *     `{ popup: true }` 强制弹 —— 挂机产出常常只有银币 / 体力，默认分流
     *     （`splitTerritoryRewards`）会把这些剥去飘字、永不弹窗；
     *   · `idleTime` 是新的挂机起点（秒），写进 `serverIdleTimeMs` 并落账本，
     *     UI 的「已征收 00:xx:xx」立刻从它算。
     *
     * ## 离线才回落本地结算
     *
     * `offline` ⇒ 走 `settleIdleRewards()`（`TerritorySaveStore` 的本地概率结算），
     * 保证断网 / 预览环境仍能看到产出。
     *
     * 🔴 **只在离线走**：在线也走会双算（服务端已进钱包，本地再加一次）；
     * `failed` / `rejected` 也不走 —— 否则网络抖动一次就能靠本地掷骰刷奖励。
     */
    async claimIdleRewards(now: number): Promise<void> {
        if (this.loadingPushes || !this.chapter) return;
        const exitBusy = this.enterBusy(TERRITORY_TEXTS.busyIdleReward);
        try {
            const result = await this.ports.gateway.claimIdleReward(this.ports.lifecycleHost);
            if (result.ok) {
                if (result.idleTimeSeconds > 0) this.applyServerIdleTime(result.idleTimeSeconds);
                if (result.rewards.length) this.showRewards(result.rewards, null, { popup: true });
                else this.showTip(TERRITORY_TEXTS.noIdleRewards);
                this.emitStateChange();
                return;
            }
            // ⚠️ 用 `'reason' in result` 而不是 `!result.ok` 窄化：本工程 `strictNullChecks` 关闭，
            //    字面量 `false` 可能被 widen 成 `boolean`，`if (!result.ok)` 之后拿不到 `reason`。
            if (!('reason' in result)) return;
            if (result.reason !== TERRITORY_REQUEST_STATUS.offline) {
                this.showTip(TERRITORY_TEXTS.idleRewardFailed);
                return;
            }
            const idle = this.settleIdleRewards(now);
            this.emitStateChange();
            if (idle?.rewards.length) this.showRewards(idle.rewards);
            else this.showTip(TERRITORY_TEXTS.noIdleRewards);
        } finally {
            exitBusy();
        }
    }

    /**
     * 扫荡（征收弹窗的「快速征收」按钮）。
     *
     * 目标格 = **已通关的最高关卡格**（山猫 2026-11-09 口径，`findHighestPassedTerritoryLevel`）：
     * 扫荡是「把已经推进到的进度再收一次」，不是去开新关 —— 所以不取「下一关」。
     * 一个都没通关 ⇒ 提示，不发请求（`cellId` 是协议必填，瞎填必被服务端拒）。
     *
     * `times` = 扫荡倍率（2026-11-11 需求：协议新增 `optional uint32 times = 3`）。
     * 由视图（征收弹窗的 `GearSwitch`）决定，这里**只透传不校验档位** ——
     * 合法档位表在 `HJ_SWEEP_GEARS`，业务侧的扣费口径在服务端。
     */
    async sweepIdleRewards(times: number = 1): Promise<void> {
        if (this.loadingPushes || !this.chapter || !this.map || !this.progress) return;
        const target = findHighestPassedTerritoryLevel(this.map.sites, this.stageByCell, this.progress);
        if (!target) {
            this.showTip(TERRITORY_TEXTS.noSweepTarget);
            return;
        }
        const chapterId = this.map.chapterId;
        const exitBusy = this.enterBusy(TERRITORY_TEXTS.busySweep);
        try {
            const result = await this.ports.gateway.sweep(chapterId, target.site.cellId, times, this.ports.lifecycleHost);
            if (!result.ok) {
                // `'reason' in` 而不是 `!result.ok` —— 本工程 `strictNullChecks` 关闭，
                // 字面量 `false` 会 widen 成 `boolean`，直接读 `result.reason` 报 TS2339。
                const reason = 'reason' in result ? result.reason : TERRITORY_REQUEST_STATUS.failed;
                this.showTip(reason === TERRITORY_REQUEST_STATUS.offline
                    ? TERRITORY_TEXTS.idleRewardOffline
                    : TERRITORY_TEXTS.sweepFailed);
                return;
            }
            if (result.rewards?.length) this.showRewards(result.rewards, target.site.cellId, { popup: true });
            else this.showTip(TERRITORY_TEXTS.noIdleRewards);
            this.emitStateChange();
        } finally {
            exitBusy();
        }
    }

    /**
     * 把服务端的章节级 `idleTime`（秒）落成起点：内存 + 本地账本各写一份。
     *
     * 账本（`idleRewardAtByLevel`）是 per-level 的，服务端只给一个数 ⇒ 所有据点写成同一个值。
     * 这样切章重进、离线兜底、老的 `idleRewardStartedAt` 取最早值那套都不会读到过期起点。
     */
    private applyServerIdleTime(seconds: number): void {
        const ms = Math.floor(seconds) * 1000;
        if (!(ms > 0)) return;
        this.serverIdleTimeMs = ms;
        // 回包里的新起点同步写回账号级快照 —— 服务端不保证再推 Bro。
        this.ports.writeServerIdleTimeSeconds?.(Math.floor(seconds));
        const context = this.chapter;
        if (!context) return;
        const ledger = { ...context.saveState.idleRewardAtByLevel };
        for (const key of Object.keys(ledger)) ledger[key] = ms;
        context.saveState = { ...context.saveState, idleRewardAtByLevel: ledger };
        context.saveState = this.ports.store.saveProgress(
            context.map.chapterId, context.progress.toJSON(), context.saveState,
        );
    }

    /**
     * 进章后取一次服务端挂机起点（**读单例端口，不发请求**）。
     *
     * 端口没注入 / 还没拉到 ⇒ 静默跳过：本地账本已经有一份起点，界面不会因此停摆。
     */
    private refreshServerIdleTime(chapterId: number): void {
        const read = this.ports.readServerIdleTimeSeconds;
        if (!read) return;
        const seconds = read();
        if (!seconds || seconds <= 0) return;
        if (this.chapter?.map.chapterId !== chapterId) return;
        this.applyServerIdleTime(seconds);
        this.emitStateChange();
    }

    /** 领取后推进每个据点的账本，重复点击不会再次领取同一小时。 */
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

    /**
     * 当前该**提前披露**的格（口径与序列见 `model/TerritoryPreview`）。
     *
     * ⚠️ 与 `territoryRevealedCells` 同一个起点：没有地图 / 进度 / 关卡表时一律空数组
     *   （章节还没加载完的那几帧，别让虚影先冒出来再消失）。
     *
     * 每次现算：`O(站点数 + 关卡数)`，百来级；调用方是 `buildState`（每秒一次，已有缓存）
     * 与四条点击拦截（用户手势），都不在逐帧热路径上。
     */
    private previewCellsNow(): number[] {
        const map = this.map;
        const progress = this.progress;
        if (!map || !progress) return [];
        return territoryPreviewCells({
            sites: map.sites,
            stageByCell: this.stageByCell,
            // 区域口径（同 `configId` 任一格 owned 即算通过），与显示侧 / 点击侧同源。
            isAreaPassed: (cellId) => progress.isAreaPassed(cellId),
        });
    }

    private buildState(): ITerritoryViewState {
        const map = this.map;
        const progress = this.progress;
        const ready = this.chapter !== null && this.loadingPushes === null;
        // 🔴 顺序不能反：先算「提前披露」的格，再并进揭示集合（`previewCells` 是它的可选入参）。
        //    不传就是上一版行为，见 `territoryRevealedCells` 文件头第三条通道。
        const previewCells = this.previewCellsNow();
        const revealedCells = map && progress ? territoryRevealedCells(map, progress, previewCells) : [];
        // `revealedCells` 下面 `siteOpenableCells` 要逐 site 查一次 ⇒ 先做成 Set，
        // 把原来的 `Array.includes`（O(n) 线性查）降为 O(1)。
        const revealedSet = new Set(revealedCells);
        const wallet = this.saveState?.wallet;
        // 「能解锁」的判据**不在**这里另写一份：走 `canAffordUnlock(site, true)`（静默模式），
        // 与点击路径同源（含 `checkUnlock` 前置 + 银币 + 体力三项）。
        // 🔴 「被前置卡住」只算一遍，**同时**喂下面两个集合（一个排除、一个纳入）：
        // 两边共用同一份判据才不会出现「这格能开却顶着锁」。
        // 判据见 `TerritoryProgress.isPrerequisitePending`：前置关卡没打通 ∪ 前置宝箱没点开。
        const prereqPending = new Set<number>();
        if (map && progress) {
            for (const site of map.sites) {
                if (progress.isPrerequisitePending(site.cellId)) prereqPending.add(site.cellId);
            }
        }
        const siteOpenableCells = map && progress && wallet ? map.sites
            .filter((site) => revealedSet.has(site.cellId)
                && !progress.isCellUnlocked(site.cellId)
                && !progress.isOwned(site.cellId)
                && !prereqPending.has(site.cellId)
                && this.canAffordUnlock(site, true))
            .map((site) => site.cellId) : [];
        // 随机格可开判定逐候选格一次，`openedCells`（owned+unlocked 并集）对每格都一样 ⇒
        // 提到循环外算一次传进去，省掉原先每格都 `Array.from(new Set(concat))` 重建全集。
        const openedCells = progress
            ? Array.from(new Set(progress.ownedCells.concat(progress.unlockedCells)))
            : [];
        // 锁标只认「结构性阻塞」：站点格看前置、随机格看「四周有没有已开格」。
        // 🔴 不含银币/体力 —— 见 `ITerritoryViewState.lockBlockedCells` 的口径说明。
        const siteLockCells = map && progress ? map.sites
            .filter((site) => revealedSet.has(site.cellId)
                && !progress.isCellUnlocked(site.cellId)
                && !progress.isOwned(site.cellId)
                && prereqPending.has(site.cellId))
            .map((site) => site.cellId) : [];
        const randomResourceOpenableCells = map?.randomSites?.candidateCells.filter((cellId) =>
            this.randomResourceOpenCheck(cellId, openedCells).ok) ?? [];
        const randomLockCells = map?.randomSites?.candidateCells.filter((cellId) => {
            if (!revealedSet.has(cellId)) return false;
            if (progress?.isCellUnlocked(cellId) || progress?.isOwned(cellId)) return false;
            const check = this.randomResourceOpenCheck(cellId, openedCells);
            return 'reason' in check && check.reason === 'needsNeighbor';
        }) ?? [];
        // 🔴 服务端 `ChapterInfo.idleTime` 优先（章节级权威起点）；没拿到才回落本地 per-level 账本
        //    的最早值 —— 后者是接入协议前自造的计时，只能当离线预览用。
        const idleRewardStartedAt = this.serverIdleTimeMs
            ?? this.buildIdleRewardSources().reduce<number | null>((earliest, source) => {
                const start = this.saveState.idleRewardAtByLevel[String(source.levelId)];
                return start === undefined ? earliest : earliest === null ? start : Math.min(earliest, start);
            }, null);
        return {
            ready,
            idleRewardStartedAt,
            idleRewardMaxHours: this.idleRewardMaxHours,
            chapterId: this.currentChapterId,
            map,
            layout: this.layout,
            art: this.art,
            progress,
            revealedCells,
            previewCells,
            siteOpenableCells,
            // 锁标：前置没满足的站点格 + 四周没有已开格的随机候选格（见字段注释）。
            lockBlockedCells: siteLockCells.concat(randomLockCells),
            stageByCell: this.stageByCell,
            randomResourceCells: this.randomResourceCells,
            randomResourceOpenableCells,
            pendingRandomResourceCells: Array.from(this.pendingRandomResourceCells),
            pendingFixedResourceCells: Array.from(this.pendingFixedResourceCells),
            victoryClaimCells: this.victoryClaimCells,
            // 地图拿它判「银币 / 体力数字要不要染红」。与 `buildHud` 同一个兜底：
            // 存档还没读到时就当 0（此时 `ready` 为 false，站点根本不会渲染）。
            wallet: { silver: wallet?.silver ?? 0, stamina: wallet?.stamina ?? 0 },
            // 通关 ≈ 可以让地图演「整章云散」。未就绪（存档没读到）时一律 false：
            // 拿半截进度判通关会在地图还没画出来的时候先把雾散了。
            chapterCleared: ready ? this.chapterCompletion().complete : false,
            // 只有"这一拍刚打通"才为真（见 `noteChapterJustCleared`），未就绪一律 false。
            chapterClearPending: ready ? this.chapterClearPending : false,
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
     * - **侦查**：`TERRITORY_ASYNC_SCOUT_STAMINA` 常量（服务端还没有侦查协议/配置；
     *   等协议到位替换成服务端下发的价格，视图侧不用改）。
     * - **开始战斗**：`stage.staminaCost`（= 关卡表 `levelCost`，与「关卡界面」弹窗同一份口径）。
     *
     * 🔴 2026-11-04 山猫：「这里是扣体力不是扣银币」（截图里两颗按钮挂的是银币图标 + 银币数字）。
     *   原来开战读的是 `site.unlock.silverCost`（据点解锁价，第一版按"开战即解锁"理解），
     *   那笔银子只在**首次解锁**时由服务端扣，玩家每打一次真正消耗的是关卡体力
     *   ⇒ 按钮口径改体力。银子仍会在解锁那一步扣，但那是解锁价，不进这个按钮。
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
            scoutCost: TERRITORY_ASYNC_SCOUT_STAMINA,
            // 与「关卡界面」的 `levelInfoContent.staminaCost` 同一条口径：关卡配多少体力就显示多少。
            // 绑不到关卡 ⇒ 0（视图按 `<= 0` 不显示费用角标），不拿解锁价顶替。
            fightCost: stage ? Math.max(0, Math.round(stage.staminaCost)) : 0,
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
        // 「首次通关 ⇒ 整章云散」是**一次性**演出：这一拍已经随状态交给页面了
        //（`publish` 是同步的，页面在返回前就渲染完了）⇒ 立刻消费掉，后面每一拍都不再带。
        // 不消费的话，任何一次重绘都会把同一章的散雾重演一遍。
        if (this.chapterClearPending && this.state.chapterCleared) this.chapterClearPending = false;
    }

    private navigateToBattle(
        pve: ITerritoryBattleNavParams,
        battle?: ZCBattleStart,
        approach = false,
        battleParams?: readonly string[],
    ): void {
        // 请求已经落定、去向也已经发布 ⇒ 过场接管窗口到此为止（此后关详情按玩家放弃处理）。
        this.battleHandoff = false;
        // 🔴 两个可选项**按需**才带：老断言是"载荷就是 `{ pve, battle }`"，
        //    无条件塞 `approach: false` / `battleParams: undefined` 会把它们判成不相等。
        const payload: ITerritoryNavigateBattlePayload = approach || battleParams
            ? { pve, battle, approach, battleParams }
            : { pve, battle };
        // 🔴 交出去之后这一格的详情就作废了：普通关（`match`）是**同步**落定的，
        //    没有任何在途请求能挡住"同一帧连点两次"（不关详情 ⇒ 两次过场、两次跳匹配页）。
        //    与 `closeDetail` 的区别：这里不换交互号（不撤销任何东西，只是"这一格已经打过了"），
        //    页面那边本来也会在 `navigate` 的同一帧把弹窗关掉。
        this.detailSite = null;
        this.detailStage = null;
        this.levelTipOpen = false;
        this.publish({ kind: 'navigate', payload });
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

    private setBusy(busy: boolean, text?: string, approach?: boolean): void {
        // `approach` 只在"置忙"那一侧有意义；解除时不必重复带（页面只读 busy=true 那一次）。
        this.publish({ kind: 'busy', payload: approach ? { busy, text, approach } : { busy, text } });
    }
}
