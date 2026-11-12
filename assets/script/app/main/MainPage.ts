import { _decorator, Button, Component, EventTouch, Node, Sprite, SpriteFrame, UITransform, Vec2 } from 'cc';
import type { IControllerResources } from '../../framework/controller/ControllerBase';
import { ResourceScope } from '../../core/asset/ResourceScope';
import { GameRoute } from '../../core/runtime/GameRoute';
import { ProcedureManager } from '../../framework/procedure/ProcedureManager';
import { FW } from '../../framework/FW';
import { EventMgr } from '../../framework/event/EventMgr';
import { ZC_BATTLE_TYPE_CHAPTER, ZC_CHAPTER_BATTLE_SUB_TREASURE } from '../battle/BattleStartModel';
import type { IMatchingEntryParams } from '../matching/MatchTypes';
import { spriteFramePathOf } from '../ArtPaths';
import { qualityFrameArtPath } from '../itemdetail/ItemDetailArt';
import { qualityFrameSuffixOf, qualityNameOf } from '../itemdetail/ItemDetailTable';
import { ChestBar } from './ChestBar';
import { PopupManager } from '../../framework/ui/PopupManager';
import { ChestDetailPanel } from './ChestDetailPanel';
import type { IChestDetailContent } from './ChestDetailPanel';
import { CHEST_EVENTS } from './ChestEvents';
import {
    CHEST_EMPTY_SLOT_STAMINA_COST, CHEST_SLOT_COUNT, ChestSlotAction, ChestSlotState,
    chestActionCaption, formatChestCountdown,
} from './ChestTypes';
import type { IChestDetailData, IChestSlotData } from './ChestTypes';
import { NewTreasureRepository } from './NewTreasureRepository';
import type { MainTerritoryMap } from './MainTerritoryMap';
import { GameNet } from '../net/GameNet';
import { ChapterSelectPanel } from './ChapterSelectPanel';
import { loadChapterSelectRows, readTerritorySaveOwner } from '../territory/application/ChapterSelectLoader';
import { createTerritorySaveStore } from '../territory/application/TerritorySaveStoreAdapter';
import type { TerritorySaveStore } from '../territory/model/TerritorySaveStore';
import { TerritoryUiEvent, TerritoryViewEvent, type ITerritoryRenderEvent } from '../territory/application/TerritoryEvents';
import type { ITerritoryProgressView } from '../territory/application/TerritoryViewState';
import type { TerritoryCampaignStage } from '../territory/model/TerritoryCampaignConfig';
import { RefUtil } from '../../framework/ref/RefUtil';
import { CacheMgr } from '../net/CacheMgr';
import { toCount } from '../net/RequestGuard';
import { battleLevelPassDetail, isLevelPassed } from './BattleLevelPassed';
import {
    CHEST_ENTRY_POP_SECONDS,
    activatedTerritoryLevelIds,
    chestEntryPopScale,
    inspectChestEntryConditions,
    isChestEntryVerdictProvisional,
    isTerritoryLevelActivatedInTerritory,
    isTerritoryLevelPassedInTerritory,
    passedTerritoryLevelIds,
    resolveChestEntryGate,
    territoryLevelCellsInChapter,
} from './ChestEntryGate';
import { resolveQuickFindGate } from './QuickFindGate';
import { EMPTY_ENTRANCE_PLAYER_STATE } from './MainEntranceVisible';
import type { EntrancePlayerState, EntranceVisibleRow } from './MainEntranceVisible';

const { ccclass, property } = _decorator;

/**
 * 宝箱栏展开时补出来的「空白接收层」节点名（运行时创建，不落 prefab）。
 * `__` 前缀同 `PopupBase.POPUP_BLANK_CATCHER`，一眼能看出是引擎无关的辅助层。
 */
const CHEST_BLANK_CATCHER = '__ChestBlankClose';

/**
 * 按下 → 抬起之间超过这个 UI 位移就不算「点空白」（与 `POPUP_BLANK_TOLERANCE` 同口径）。
 * 主城地图现在没有拖拽/缩放，留着是防将来加手势时误收。
 */
const CHEST_BLANK_TOUCH_TOLERANCE = 12;

const MAIN_PAGE_TEXTS = {
    treasureUnavailable: '宝箱数据暂不可用',
    treasureLoadFailed: '宝箱数据加载失败',
    networkUnavailable: '网络未连接',
    actionFailed: '操作失败，请稍后重试',
    openProtocolMissing: '开箱协议消息号未配置',
    bossMapUnavailable: '关卡地图未就绪',
} as const;

/**
 * 主城页交互入口。
 *
 * 领地主 tab 内嵌在主界面；底部宝箱状态从服务端读取并由协议广播刷新。
 */
@ccclass('MainPage')
export class MainPage extends Component {
    /**
     * 本次登录是否已经庆祝过「战斗宝箱解锁」。
     *
     * **必须是静态的**：主城页每从一局回来都会重建（`start()` 重新拉宝箱队列），
     * 放实例字段会让 icon 的生成动画每次都重播一遍 —— 那就不叫"生成"了。
     */
    private static chestEntryCelebrated = false;
    /**
     * 「领地格子还没到，先别判」这条 log 只打一次。
     *
     * 快照到之前 `refreshOpenGates` 会被调好几次（`onLoad`、关卡缓存推送），
     * 不去重就是同一条刷屏 —— 但也不能完全静默，否则「icon 一直不出现」时
     * 日志里连「还在等数据」都看不到。同样要静态：主城页会重建。
     */
    private static chestEntryWaitingLogged = false;
    /**
     * 逐条「未解锁 => fail」细节是否打印。
     *
     * 领地侧 `onTerritoryRender` 每次 `mergeServerState` 都会重判入口，打开后实机同一条
     * 会刷满控制台（2026-11-05 实测：格子 373/372/392 那行反复出现）。默认关，排障时临时改 true。
     */
    private static readonly chestEntryDetailLog = false;
    @property({ type: Node, tooltip: 'BeginGame：快速寻敌按钮' })
    startButton: Node = null;

    @property({ type: Node, tooltip: 'BeginGame/PreviousChapter：章节选择入口（左侧）' })
    previousChapterButton: Node = null!;

    @property({ type: Node, tooltip: 'BeginGame/NextChapter：章节选择入口（右侧）' })
    nextChapterButton: Node = null!;

    @property({ type: Node, tooltip: 'ChestEntry：打开 / 收起底部宝箱栏' })
    chestToggle: Node = null;

    @property({ type: Sprite, tooltip: 'BottomHud/Cell0：第一个宝箱数量格' })
    chestCell0: Sprite = null;

    @property({ type: Sprite, tooltip: 'BottomHud/Cell1：第二个宝箱数量格' })
    chestCell1: Sprite = null;

    @property({ type: Sprite, tooltip: 'BottomHud/Cell2：第三个宝箱数量格' })
    chestCell2: Sprite = null;

    @property({ type: Sprite, tooltip: 'BottomHud/Cell3：第四个宝箱数量格' })
    chestCell3: Sprite = null;

    @property({ type: SpriteFrame, tooltip: '宝箱数量格：已占用（绿色）' })
    chestCellFilled: SpriteFrame = null;

    @property({ type: SpriteFrame, tooltip: '宝箱数量格：空闲（灰色）' })
    chestCellEmpty: SpriteFrame = null;

    @property({ type: ChestBar, tooltip: 'ChestBar：底部宝箱栏（4 格，蓝湖「塔防主界面-2」）' })
    chestBar: ChestBar = null;

    hasTerritoryMap = false;
    /**
     * 领地地图页（整页过场的执行者）；`null` = 这个宿主没挂领地地图。
     *
     * 只用来借它的 `playMatchingIntro`：宝箱栏的「战斗」格进的是匹配，而推 UI、缩地块、
     * 盖雾这一整套过场**只有地图页拿得到**（HUD 是它的兄弟节点、雾盖层挂在它的覆盖层上）。
     * 所以这里不复制一份过场，只把"我要去匹配"这件事交给它 —— 全项目仍然只有一处
     * `ProcedureManager.navigate(GameRoute.Matching, …)` 在过场里。
     */
    territoryMap: MainTerritoryMap | null = null;
    private readonly treasureRepository = new NewTreasureRepository();
    /** 运行时当前章节（来自 `TerritoryViewEvent.Render` 的 `state.chapterId`），弹窗标「当前章」用。 */
    private currentChapterId = 0;
    /** 章节弹窗行数据在途标记：挡连点，避免同一次点击并发拉两次地图。 */
    private chapterSelectLoading = false;
    /** 详情弹窗当前对应的槽位（1~4）与那颗按钮要发的动作；`0` = 没开。 */
    private detailSlot = 0;
    private detailAction: ChestSlotAction = ChestSlotAction.Open;
    /** 宝箱栏展开期间的空白接收层（懒建，收起后只置 `active=false`，不反复 new）。 */
    private chestBlankCatcher: Node | null = null;
    private readonly chestBlankTouchStart = new Vec2();
    /** 战斗宝箱入口开没开（`open.json` `refId=701`「战斗掉落宝箱」的条件）；`false` = icon 不显示。 */
    private chestEntryUnlocked = false;
    /**
     * 快速寻敌开没开（`open` `refId=702`，条件是「激活第 1 章第 4 关地块」）；`false` = 按钮不显示。
     *
     * 默认 `false`（fail-closed）：`onLoad` 判完之前一帧都不该露出来。
     */
    private quickFindUnlocked = false;
    /** 领地最新一帧的「格子 → 关卡」映射（判 pvp 据点通没通要用）。 */
    private territoryStageByCell: ReadonlyMap<number, TerritoryCampaignStage> | null = null;
    /** 领地最新一帧的进度快照（冻结过的，读 `isAreaPassed` 不会读到半更新状态）。 */
    private territoryProgress: ITerritoryProgressView | null = null;
    /**
     * 账号级存档（读「已通关的领地关卡」用）。懒建：预览 / 没角色的宿主不需要它。
     */
    private territorySaveStore: TerritorySaveStore | null = null;
    /**
     * 账号级「已通关的领地关卡」的内存镜像（源在 `TerritorySaveStore.loadPassedLevels`）。
     *
     * 它是**跨章节的一次性成就**：`levelInfo.levelChapter` 决定了关卡归属哪一章，
     * 只看当前章的格子，切到别的章就查不到（2026-11-04 战斗宝箱入口消失的根因）。
     */
    private passedTerritoryLevels: Set<number> | null = null;
    /**
     * 账号级「已激活的领地关卡」的内存镜像（源在 `TerritorySaveStore.loadActivatedLevels`）。
     *
     * 与 {@link passedTerritoryLevels} 同一个用途、不同判据：快速寻敌要的是「激活」，
     * 而第 1 章第 4 关（10004）只在第 1 章的 `stageByCell` 里 ⇒ 不落盘就会切章即消失。
     */
    private activatedTerritoryLevels: Set<number> | null = null;
    /** 生成缩放动画的起播时刻（秒）；`chestEntryPopping` 为假时不看它。 */
    private chestEntryPopStartedAt = 0;
    private chestEntryPopping = false;
    private get assets() { return this.presentationResources.assets; }
    /** 图标按路径缓存（同一批奖励反复加载同一张图不值得）。 */
    private readonly chestIconCache = new Map<string, SpriteFrame>();
    private presentationResources: IControllerResources = null!;
    initialize(resources: IControllerResources): void { this.presentationResources = resources; }
    private get chestArtScope(): ResourceScope { return this.presentationResources.scope; }
    private readonly emptyChestSlots: readonly IChestSlotData[] = Array.from({ length: CHEST_SLOT_COUNT }, (_, index) => ({
        index: index + 1,
        state: ChestSlotState.Empty,
        name: '',
        remainSeconds: 0,
        totalSeconds: 0,
        action: ChestSlotAction.Battle,
        cost: CHEST_EMPTY_SLOT_STAMINA_COST,
    }));

    onLoad(): void {
        this.startButton.on(Button.EventType.CLICK, this.onStartGame, this);
        this.previousChapterButton.on(Button.EventType.CLICK, this.onOpenChapterSelect, this);
        this.nextChapterButton.on(Button.EventType.CLICK, this.onOpenChapterSelect, this);
        // 🔴 需求 2026-11-03：快速寻敌两侧的三角**关闭**（用户第 2 条）。
        //    章节选择的入口改成地图上那颗「章节」建筑（含气泡），见下面的 `ChapterSelect` 订阅。
        //    节点与点击绑定保留在 prefab 上（不删 `@property`，否则反序列化会丢掉引用），
        //    只是永久隐藏；将来若要恢复，把 `onTerritoryRender` 里的两行还回去即可。
        this.previousChapterButton.active = false;
        this.nextChapterButton.active = false;
        // 需求 2026-11-03：点地图上的章节建筑 / 它的「章节」气泡 ⇒ 打开章节选择弹窗。
        EventMgr.instance.on(TerritoryUiEvent.ChapterSelect, this.onOpenChapterSelect, this);
        EventMgr.instance.on(TerritoryViewEvent.Render, this.onTerritoryRender, this);
        this.chestToggle.on(Button.EventType.CLICK, this.onToggleChestPanel, this);
        // 宝箱栏意图：语义见 `ChestEvents.ts`，页面只订阅、退出时统一 offTarget(this)
        EventMgr.instance.on(CHEST_EVENTS.SLOT_ACTION, this.onChestAction, this);
        EventMgr.instance.on(CHEST_EVENTS.COLLAPSE, this.onChestCollapse, this);

        // 宝箱详情走 `PopupBase`：页面不实例化、不撑尺寸（层级 / 遮罩 / 点空白关闭由 `PopupManager` 管）。
        EventMgr.instance.on(CHEST_EVENTS.CLOSE, this.onChestDetailClose, this);
        EventMgr.instance.on(CHEST_EVENTS.FAST_OPEN, this.onChestDetailFastOpen, this);
        EventMgr.instance.on(CHEST_EVENTS.OPEN, this.onChestDetailOpen, this);
        // 关卡通关状态变化 ⇒ 重算宝箱入口开没开（20001 打完那一刻就该长出来，不必等重进主城）。
        // `setEventUpdate` 内部会 `getCache` → `new GameCache` → 读协议描述表，表没就绪时会抛
        // （`GameCacheMgr.peekCache` 的注释里有完整复盘）。订阅失败只丢「实时」这一个便利，
        // 不该连累整个主城页 —— 下次进主城照样重算。
        try {
            CacheMgr.instance.setEventUpdate('CmdBattleLevel', this, this.onBattleLevelCacheUpdate);
        } catch (error) {
            console.warn('[MainPage] 订阅 CmdBattleLevel 失败，宝箱入口改为下次进主城再判', error);
        }
        // 入口默认是藏的：先压下去再判，未解锁的号一帧都不该瞥见它（`onLoad` 早于首帧渲染）。
        // 四个数量格是入口的一部分，同步藏 —— 只藏 icon 会留下 4 个孤零零的格子。
        // 快速寻敌同理（`open` 702：激活第 1 章第 4 关地块后才有），一起在判之前压住。
        this.chestToggle.active = false;
        this.setChestCellsVisible(false);
        this.startButton.active = false;
        this.refreshOpenGates();
    }

    start(): void {
        this.renderChests(this.emptyChestSlots);
        this.chestBar.setOpen(false, false);
        // ⚠️ 不能无条件 `true`：这会把 `onLoad` 刚判完的「快速寻敌还没解锁」又亮回来。
        this.startButton.active = this.quickFindUnlocked;
        // 队列照拉：`open.json` 的开启条件是**客户端显示闸**，服务端不看它；
        // 提前把队列焐热，20001 一过 icon 长出来就有数据，不用再等一次往返。
        void this.loadTreasureQueue();
    }

    onEnable(): void {
        this.schedule(this.refreshTreasureDisplay, 1);
    }

    onDisable(): void {
        this.unschedule(this.refreshTreasureDisplay);
        // 播到一半被切走（进战斗 / 切页）：收干净，别把 0.4 倍缩放留在屏幕上
        this.unschedule(this.stepChestEntryPop);
        if (this.chestEntryPopping) {
            this.chestEntryPopping = false;
            this.chestToggle.setScale(1, 1, 1);
        }
    }

    onDestroy(): void {
        CacheMgr.instance.removeEventUpdate('CmdBattleLevel', this, this.onBattleLevelCacheUpdate);
        if (this.detailSlot > 0) PopupManager.inst.get(ChestDetailPanel)?.close();
        // 接收层是运行时补在 ArenaRoot 下的，不跟着本组件走 ⇒ 必须自己收掉，
        // 否则主城页换了、它还盖在地图上吃点击（全透明，零报错，最难受的那种）。
        if (this.chestBlankCatcher?.isValid) this.chestBlankCatcher.destroy();
        this.chestBlankCatcher = null;
        this.chestIconCache.clear();
        EventMgr.instance.offTarget(this);
        this.treasureRepository.dispose();
        GameNet.instance.removeCaller(this);
    }

    private readonly onBattleLevelCacheUpdate = (): void => { this.refreshOpenGates(); };

    // ========================================================
    // `open` 表驱动的入口：战斗宝箱（701）+ 快速寻敌（702）
    // ========================================================

    /**
     * 重算所有吃 `open` 表的入口（701 战斗宝箱 icon / 702 快速寻敌按钮）。
     *
     * 条件写在表里，这里**不认关卡号**，只把整张表交给两个闸门判 ——
     * 策划换关卡 / 换条件类型都不用动客户端。
     *
     * 一次读表判两个：两处各读一遍会让「表没进缓存」时并发拉两次
     * `getRefAllAsync('open')`，也会让两边的进/退时序不一致。
     *
     * 表没进缓存时走异步：`getRefAll` 返回 `undefined` 才是"没缓存"，不能当成"表里没这一行"。
     */
    private refreshOpenGates(): void {
        let rows: readonly EntranceVisibleRow[] | null = null;
        try {
            rows = (RefUtil.instance.getRefAll('open') ?? null) as readonly EntranceVisibleRow[] | null;
        } catch (error) {
            console.warn('[MainPage] 读 open 表缓存失败', error);
        }
        if (rows) {
            this.applyOpenGates(rows);
            return;
        }
        void this.loadOpenTableThenGates();
    }

    private async loadOpenTableThenGates(): Promise<void> {
        let rows: readonly EntranceVisibleRow[] | null = null;
        try {
            rows = (await RefUtil.instance.getRefAllAsync('open')) as readonly EntranceVisibleRow[];
        } catch (error) {
            console.warn('[MainPage] 拉 open 表失败，战斗宝箱 / 快速寻敌先不显示', error);
        }
        if (!this.isValid) return;
        this.applyOpenGates(rows ?? null);
    }

    private applyOpenGates(rows: readonly EntranceVisibleRow[] | null): void {
        this.applyChestEntryGate(rows);
        this.applyQuickFindGate(rows);
    }

    /**
     * 快速寻敌开没开：`open` 的 `refId=702`，条件是 `territoryLevelActivated`（激活第 1 章第 4 关地块）。
     *
     * 未解锁 ⇒ 整颗按钮藏起来（与 701 战斗宝箱入口、两侧三角同一个口径：还没开的入口不占位）。
     * 解锁后由存档记住（`territory.activatedLevels.v1`）⇒ 切章常驻。
     */
    private applyQuickFindGate(rows: readonly EntranceVisibleRow[] | null): void {
        const gate = resolveQuickFindGate(rows, this.entrancePlayerState());
        this.quickFindUnlocked = gate.unlocked;
        // 宝箱栏正展开时它是被收起的；这里只决定「解锁后该不该回来」。
        this.startButton.active = gate.unlocked && !(this.chestBar ? this.chestBar.opened : false);
    }

    /**
     * 四个宝箱数量格（`BottomHud/Cell0..Cell3`）—— 它们是入口 icon 的一部分，不是独立 UI：
     * 需求 2026-11-03 要求「和宝箱 icon 同步展示」，所以显隐只在这一处定义，
     * 填色（`renderChests`）也走同一份集合，免得将来只改了一边。
     *
     * 引用是 Inspector 上的，个别宿主（测试桩）不绑就为空 —— 少绑一个不该带崩整个主城页。
     */
    private chestCells(): Sprite[] {
        return [this.chestCell0, this.chestCell1, this.chestCell2, this.chestCell3].filter((cell) => cell != null);
    }

    /** 数量格跟着入口 icon 同进同出：没解锁 ⇒ 一并藏掉。 */
    private setChestCellsVisible(visible: boolean): void {
        for (const cell of this.chestCells()) cell.node.active = visible;
    }

    /**
     * 按判定结果落状态：解锁 ⇒ 显示 icon（**本次登录首次**播一遍生成动画）+ 数量格；
     * 未解锁 ⇒ 藏起来，连点击都不接。
     */
    private applyChestEntryGate(openRows: readonly EntranceVisibleRow[] | null): void {
        const state = this.entrancePlayerState();
        const gate = resolveChestEntryGate(openRows, state);
        this.chestEntryUnlocked = gate.unlocked;

        if (!gate.unlocked) {
            this.unschedule(this.stepChestEntryPop);
            this.chestEntryPopping = false;
            this.chestToggle.active = false;
            this.setChestCellsVisible(false);
            // `rowMissing` 已经在 `resolveChestEntryGate` 里报过了，这里只补「行在、条件没过」的细节。
            if (!gate.rowMissing) this.warnChestEntryBlocked(openRows, state);
            return;
        }

        this.chestToggle.active = true;
        this.setChestCellsVisible(true);
        if (!this.chestEntryPopping) this.chestToggle.setScale(1, 1, 1);
        if (MainPage.chestEntryCelebrated) return;
        MainPage.chestEntryCelebrated = true;
        this.startChestEntryPop();
    }

    /**
     * 「行在表里、但条件没过」时打一条诊断。
     *
     * 三种情况在 `unlocked=false` 上长得一模一样，日志必须能分开：
     * 关卡号配错 / `CmdBattleLevel` 里没这一关 / 有这一关但 0 星。
     * 关卡号从表里读，不写死（用例扫源码不许出现 20001）。
     */
    private warnChestEntryBlocked(
        openRows: readonly EntranceVisibleRow[] | null,
        state: EntrancePlayerState,
    ): void {
        const reports = inspectChestEntryConditions(openRows, state);
        if (!reports.length) {
            console.warn('[MainPage] 战斗宝箱入口未解锁：701 行没有 visibleCondition');
            return;
        }
        // ⚠️ 领地快照没到时 `territoryLevel` 必然 fail，但那是「还没数据」不是「没通关」。
        // 2026-11-03 实机：icon 出现前先刷了两行假的「未解锁 …=> fail（当前章节 0 格）」，
        // 看着像关卡号配错。这里只留一条说明，等 `TerritoryViewEvent.Render` 再判。
        if (isChestEntryVerdictProvisional(reports, this.territorySnapshotReady())) {
            if (!MainPage.chestEntryWaitingLogged) {
                MainPage.chestEntryWaitingLogged = true;
                console.log('[MainPage] 战斗宝箱入口：领地格子还没到，等地图刷一帧后再判（不是没通关）');
            }
            return;
        }
        // 逐条 fail 细节默认不打印：判定每次领地渲染都会重走，日志会刷屏。
        if (!MainPage.chestEntryDetailLog) return;
        for (const report of reports) {
            let detail = '';
            if (report.type === 'battleLevel' && report.resId != null) {
                detail = `（${battleLevelPassDetail(report.resId)}）`;
            } else if (report.type === 'territoryLevel' && report.resId != null) {
                detail = `（${this.territoryLevelDetail(report.resId)}）`;
            }
            console.warn(`[MainPage] 战斗宝箱入口未解锁：${report.type}(${String(report.resId)}) => ${report.verdict}${detail}`);
        }
    }

    /** 排障用：这一关在领地里对应的格子通了没有、为什么。 */
    private territoryLevelDetail(levelId: number): string {
        const stageByCell = this.territoryStageByCell;
        // ⚠️ 空表 ≠ 没数据。`onLoad` 时快照是空 Map，别报成「这一章没有这关」。
        if (!stageByCell || stageByCell.size === 0) {
            return '领地格子还没到（stageByCell 为空），等地图刷一帧后再判';
        }
        const cells = territoryLevelCellsInChapter({ stageByCell }, levelId);
        // 走到这里说明落盘的跨章成就里也没有它 —— 否则判定早就不是 fail 了。
        if (!cells.length) {
            return `领地这一章没有 levelId=${levelId} 的格子（当前章共 ${stageByCell.size} 格），`
                + '跨章成就里也没记过它';
        }
        const progress = this.territoryProgress;
        if (!progress) return `格子 ${cells.join('/')} 在，但领地进度快照还没到`;
        return `格子 ${cells.join('/')}：${cells.map((id) => (progress.isAreaPassed(id) ? '已通关' : '未通关')).join('、')}`;
    }

    /** 领地格子快照到位了没有 —— **空表也算没到**，不是「这一章没有这关」。 */
    private territorySnapshotReady(): boolean {
        const stageByCell = this.territoryStageByCell;
        return stageByCell != null && stageByCell.size > 0;
    }

    /**
     * 领地据点（`levelInfo.levelId`，pvp 异步据点是 2000x）那一片格子打完了没有。
     *
     * 判定用领地自己的口径：**同 `configId` 的格子任一个 owned ⇒ 整片算通关**
     * （`TerritoryProgress.isAreaPassed`，山猫 2026-10 定的）—— 一片战斗区域往往横跨好几格，
     * 只认其中一格会在"打完了但那格不是被记的那一格"时误判成没通过。
     *
     * ⚠️ **必须跨章节**：关卡归属哪一章由 `levelInfo.levelChapter` 决定，第 2 章（10011~20007）
     * 里根本没有第 1 章的 20001。只查当前章的 `stageByCell` ⇒ 玩家一切到第 2 章，
     * 战斗宝箱入口就会在「已经解锁过」之后消失（2026-11-04 实机）。
     * 所以账号级存档里那些「已通关」的关卡先算数（一次性成就），当前章快照只用来
     * **发现新的通关** —— 发现与落盘都在 `rememberPassedTerritoryLevels`，本函数是纯的。
     *
     * 两条来源都没有（领地还没渲染 / 这个宿主没挂地图 / 真没打过）才按没通过 ——
     * 宁可晚一点显示，也不要在没打过时把入口摆出来。
     */
    private readonly isTerritoryLevelPassed = (levelId: number): boolean => {
        const progress = this.territoryProgress;
        return isTerritoryLevelPassedInTerritory(levelId, {
            stageByCell: this.territoryStageByCell,
            isAreaPassed: progress ? (cellId: number) => progress.isAreaPassed(cellId) : null,
        }, this.passedTerritoryLevelSet());
    };

    /** 已通关关卡的集合（懒读盘：主城页每局重建，但一次会话只读一次）。 */
    private passedTerritoryLevelSet(): Set<number> {
        if (!this.passedTerritoryLevels) {
            this.passedTerritoryLevels = new Set(this.territoryArchive().loadPassedLevels());
        }
        return this.passedTerritoryLevels;
    }

    /**
     * 领地据点（`levelInfo.levelId`）那一片格子**激活**了没有 —— 快速寻敌（702）的门槛。
     *
     * 判据是领地自己那套「激活」：`isCellUnlocked || isOwned || isAreaPassed`
     * （`TerritoryMapView.isCellActivated` 同款）。**不是** `isAreaPassed`（通关）：
     * 用户口径是「激活第 1 章第 4 关的**地块**后解锁」，花银币解锁那一刻就该开，
     * 用通关会晚一整场战斗，打输了还一直锁着。
     *
     * 跨章节同 {@link isTerritoryLevelPassed}：先看账号级落盘（`territory.activatedLevels.v1`），
     * 再看当前章快照 —— 否则切到第 2 章，`stageByCell` 里没有 10004，按钮就会消失。
     */
    private readonly isTerritoryLevelActivated = (levelId: number): boolean => {
        const progress = this.territoryProgress;
        return isTerritoryLevelActivatedInTerritory(levelId, {
            stageByCell: this.territoryStageByCell,
            isCellActivated: progress ? (cellId: number) => MainPage.isCellActivatedIn(progress, cellId) : null,
        }, this.activatedTerritoryLevelSet());
    };

    /** 「这一格激活了没有」的单一判据（与 `TerritoryMapView.isCellActivated` 同口径）。 */
    private static isCellActivatedIn(progress: ITerritoryProgressView, cellId: number): boolean {
        return progress.isCellUnlocked(cellId) || progress.isOwned(cellId) || progress.isAreaPassed(cellId);
    }

    /** 已激活关卡的集合（懒读盘）。 */
    private activatedTerritoryLevelSet(): Set<number> {
        if (!this.activatedTerritoryLevels) {
            this.activatedTerritoryLevels = new Set(this.territoryArchive().loadActivatedLevels());
        }
        return this.activatedTerritoryLevels;
    }

    /**
     * 把当前章**已激活**的关卡整批记进账号成就（切章不回退）。
     *
     * 与 {@link rememberPassedTerritoryLevels} 成对：同一处（`onTerritoryRender` 每帧）调，
     * 同样幂等（内存 `Set` 先挡），同样必须 `Array.from`（release 会降级 `[...set]`）。
     */
    private rememberActivatedTerritoryLevels(): void {
        const progress = this.territoryProgress;
        if (!progress) return;
        const activated = this.activatedTerritoryLevelSet();
        const fresh = activatedTerritoryLevelIds({
            stageByCell: this.territoryStageByCell,
            isCellActivated: (cellId: number) => MainPage.isCellActivatedIn(progress, cellId),
        }).filter((levelId) => !activated.has(levelId));
        if (!fresh.length) return;
        for (const levelId of fresh) activated.add(levelId);
        const added = this.territoryArchive().markLevelsActivated(Array.from(activated));
        if (added.length) {
            console.log(`[MainPage] 领地关卡 ${added.join('/')} 已激活，记成跨章成就（切章后快速寻敌不消失）`);
        }
    }

    /**
     * 把当前章**已通关**的关卡整批记进账号成就（跨章节，切章不回退）。
     *
     * 落盘只在这一处（`onTerritoryRender` 每帧调），条件判定那边保持纯函数 ——
     * 判定每帧都可能走好几遍，把写盘塞进谓词里迟早写出重复写盘的虫子。
     * **幂等**：内存 `Set` 先挡一道，没有新增就不碰 localStorage。
     */
    private rememberPassedTerritoryLevels(): void {
        const progress = this.territoryProgress;
        if (!progress) return;
        const passed = this.passedTerritoryLevelSet();
        const fresh = passedTerritoryLevelIds({
            stageByCell: this.territoryStageByCell,
            isAreaPassed: (cellId: number) => progress.isAreaPassed(cellId),
        }).filter((levelId) => !passed.has(levelId));
        if (!fresh.length) return;
        for (const levelId of fresh) passed.add(levelId);
        // ⚠️ 必须 `Array.from`：release 构建把 `[...set]` 降级成 `[].concat(set)`，
        //    展开不了迭代器 ⇒ 传进去的是「装着 Set 本身」的数组，静默一条都记不上。
        const added = this.territoryArchive().markLevelsPassed(Array.from(passed));
        if (added.length) {
            console.log(`[MainPage] 领地关卡 ${added.join('/')} 已通关，记成跨章成就（切章后战斗宝箱入口不再丢）`);
        }
    }

    /** 账号级存档句柄（与章节存档同一命名空间，见 `readTerritorySaveOwner`）。 */
    private territoryArchive(): TerritorySaveStore {
        if (!this.territorySaveStore) {
            this.territorySaveStore = createTerritorySaveStore(readTerritorySaveOwner());
        }
        return this.territorySaveStore;
    }

    /**
     * 条件判定要的玩家状态（701 战斗宝箱 / 702 快速寻敌共用）。
     *
     * 三个取数口都给：`battleLevel` 查 `CmdBattleLevel`（主线关卡）；
     * `territoryLevel` 查领地格子通没通（pvp 据点）；`territoryLevelActivated` 查领地格子
     * 激活没激活 —— 服务端对据点不写 `CmdBattleLevel`，只有领地格子判得了。
     * 其余字段与主界面两侧入口同源，将来表上叠 `roleLevel` 之类也能直接生效。
     */
    private entrancePlayerState(): EntrancePlayerState {
        let role: CmdRole | null = null;
        try {
            role = (CacheMgr.instance.getTlCmdRole() ?? []).find((row) => row != null) ?? null;
        } catch (error) {
            console.warn('[MainPage] 读 CmdRole 缓存失败', error);
        }
        return {
            ...EMPTY_ENTRANCE_PLAYER_STATE,
            hasRole: role != null,
            roleLevel: role ? toCount(role.lv) : 0,
            isLevelPassed,
            isTerritoryLevelPassed: this.isTerritoryLevelPassed,
            isTerritoryLevelActivated: this.isTerritoryLevelActivated,
        };
    }

    /** 播「生成」缩放动画（`0 → 1.15 → 1`）；只在解锁那一次调。 */
    private startChestEntryPop(): void {
        this.chestEntryPopStartedAt = Date.now() / 1000;
        this.chestEntryPopping = true;
        this.chestToggle.setScale(0, 0, 1);
        this.unschedule(this.stepChestEntryPop);
        this.schedule(this.stepChestEntryPop, 0);
    }

    /** 生成动画的一帧（只在起播后按帧推进；落位即停，不留空转）。 */
    private readonly stepChestEntryPop = (): void => {
        const elapsed = Date.now() / 1000 - this.chestEntryPopStartedAt;
        const scale = chestEntryPopScale(elapsed);
        this.chestToggle.setScale(scale, scale, 1);
        if (elapsed < CHEST_ENTRY_POP_SECONDS) return;
        this.chestEntryPopping = false;
        this.unschedule(this.stepChestEntryPop);
    };

    private async loadTreasureQueue(): Promise<void> {
        // 队列变化的回调同时刷宝箱栏与详情弹窗（激活回包 / 广播一到就同步，
        // 不等下一次 1s tick；2026-11-11「点击解锁后详情按钮同步刷新」）。
        const result = await this.treasureRepository.load(this, () => this.refreshTreasureDisplay());
        if (!this.isValid) return;
        if (result === 'offline') FW.showTip(MAIN_PAGE_TEXTS.treasureUnavailable);
        else if (result === 'failed') FW.showTip(MAIN_PAGE_TEXTS.treasureLoadFailed);
    }

    private onToggleChestPanel(): void {
        // 入口没解锁时节点是藏着的；这里再挡一道，双保险（事件可能被别人转发进来）。
        if (!this.chestEntryUnlocked) return;
        this.setChestPanelOpen(!this.chestBar.opened);
    }

    /** 宝箱展开时收起快速寻敌按钮，避免两个战斗入口互相遮挡。 */
    private setChestPanelOpen(open: boolean): void {
        if (!this.chestBar) return;
        this.chestBar.setOpen(open);
        // 🔴 不能只写 `!open`：快速寻敌没解锁时，收起宝箱栏不该把它顺手亮出来。
        this.startButton.active = this.quickFindUnlocked && !open;
        this.applyChestBlankCatcher(open);
    }

    // ========================================================
    // 宝箱栏：点空白收起
    // ========================================================

    /**
     * 显示 / 收起宝箱栏的**空白接收层**。
     *
     * 需求（2026-11-04）：宝箱栏展开后点空白也要能收纳，不只左边那颗返回箭头。
     *
     * 为什么不给地图挂点击：地图上的地块 / 活动入口自带点击语义，逐个视图去派发
     * 「收起宝箱栏」既漏（没监听的空白处）又脏（一个动作散落十几处）。这里补一层
     * 全屏透明节点，命中即收起。
     */
    private applyChestBlankCatcher(open: boolean): void {
        // 收起且从没建过 ⇒ 什么都不用做（首次进主城就是这个路径）
        if (!open && !this.chestBlankCatcher) return;
        const catcher = this.ensureChestBlankCatcher();
        if (catcher) catcher.active = open;
    }

    /**
     * 懒建空白接收层，插在 **`TopHud` 之前**。
     *
     * 引擎按「最上层命中的节点」派发触摸，所以：
     *   · `TopHud`（好友 / 邮件 / 排行 / 邀请）、`BottomHud`（页签 / 宝箱入口 / 聊天）、
     *     `ChestBar` 本身都比它晚 ⇒ 照常可点；
     *   · 只有「地图 + 活动入口」这一层被接住 ⇒ 点那里先收起，不会同时触发地块/活动。
     *
     * 尺寸取 `ArenaRoot`（全屏 720×1280）而不是宝箱栏自身 —— 接收层要盖整屏，
     * 否则「点地图上方空白」根本不会命中（`PopupBase` 类头对这条有完整复盘）。
     */
    private ensureChestBlankCatcher(): Node | null {
        if (this.chestBlankCatcher?.isValid) return this.chestBlankCatcher;
        const bar = this.chestBar;
        const arena = bar?.node?.parent ?? null;
        if (!bar || !arena) return null;

        const catcher = new Node(CHEST_BLANK_CATCHER);
        catcher.layer = arena.layer;
        const arenaUi = arena.getComponent(UITransform);
        catcher.addComponent(UITransform).setContentSize(
            arenaUi?.width ?? 720,
            arenaUi?.height ?? 1280,
        );

        // 插入位置由「谁必须压在遮罩之上」决定，逐级兜底，最差也只退化到多盖一层 HUD，
        // 绝不会插到宝箱栏之后（那会把栏内按钮全盖死 ⇒ 只能靠左箭头收）。
        const topHud = arena.getChildByName('TopHud');
        const bottomHud = this.chestCell0?.node?.parent ?? null;
        const index = topHud
            ? topHud.getSiblingIndex()
            : (bottomHud && bottomHud.parent === arena ? bottomHud.getSiblingIndex() : bar.node.getSiblingIndex());
        arena.insertChild(catcher, index);

        catcher.on(Node.EventType.TOUCH_START, this.onChestBlankTouchStart, this);
        catcher.on(Node.EventType.TOUCH_END, this.onChestBlankTouchEnd, this);
        catcher.active = false;
        this.chestBlankCatcher = catcher;
        return catcher;
    }

    private readonly onChestBlankTouchStart = (event: EventTouch): void => {
        event.getUILocation(this.chestBlankTouchStart);
    };

    /** 点空白 = 收起；位移超阈值（拖拽）不算。 */
    private readonly onChestBlankTouchEnd = (event: EventTouch): void => {
        const end = event.getUILocation();
        if (Vec2.distance(end, this.chestBlankTouchStart) > CHEST_BLANK_TOUCH_TOLERANCE) return;
        EventMgr.instance.emit(CHEST_EVENTS.COLLAPSE);
    };

    private onStartGame(): void {
        // 节点藏着时正常点不到；事件被转发进来时也要挡住（`open` 702 没解锁不该能寻敌）。
        if (!this.quickFindUnlocked) return;
        if (!this.hasTerritoryMap) {
            FW.showTip(MAIN_PAGE_TEXTS.bossMapUnavailable);
            return;
        }
        EventMgr.instance.emit(TerritoryUiEvent.Intent, { intent: { kind: 'focusLevel' } });
    }

    private onTerritoryRender(event: ITerritoryRenderEvent): void {
        const { chapterId } = event.state;
        this.currentChapterId = chapterId;
        // ⚠️ 原来这里按 `ready` 把两侧三角显示出来（它们是章节选择入口）。2026-11-03 起
        //    入口改成地图上的章节建筑，三角一律隐藏 —— 所以这里**什么都不做**。
        //    别"顺手"把 `active = ready` 加回来：那会让三角重新出现在快速寻敌两侧。

        // 留一份领地快照给宝箱入口的开启条件用（pvp 据点通关不写 `CmdBattleLevel`，
        // 只能查领地格子）。快照是渲染帧冻结过的，`isAreaPassed` 读它不会读到半更新的状态。
        this.territoryStageByCell = event.state.stageByCell ?? null;
        this.territoryProgress = event.state.progress ?? null;
        // 先把这一章已通关 / 已激活的关卡记进账号成就，再判条件 —— 顺序反了会让「刚打完的那一帧」
        // 只靠快照通过，万一这一帧之后立刻切章，那一笔就永远没落盘。
        this.rememberPassedTerritoryLevels();
        this.rememberActivatedTerritoryLevels();
        this.refreshOpenGates();
    }

    /** 打开章节选择弹窗（行数据由 `loadChapterSelectRows` 组装，弹窗只负责铺行）。 */
    private readonly onOpenChapterSelect = (): void => { void this.openChapterSelect(); };

    private async openChapterSelect(): Promise<void> {
        if (!this.hasTerritoryMap || this.chapterSelectLoading) return;
        if (PopupManager.inst.get(ChapterSelectPanel)) return;
        this.chapterSelectLoading = true;
        try {
            const rows = await loadChapterSelectRows(this.presentationResources, this.currentChapterId);
            if (!this.isValid || PopupManager.inst.get(ChapterSelectPanel)) return;
            const currentIndex = rows.findIndex((row) => row.current);
            void ChapterSelectPanel.open({ userData: { rows, currentIndex } });
        } finally {
            this.chapterSelectLoading = false;
        }
    }

    private renderChests(data: readonly IChestSlotData[]): void {
        const count = data.reduce((total, slot) => total + Number(slot.state !== ChestSlotState.Empty), 0);
        const cells = this.chestCells();
        for (let index = 0; index < cells.length; index++) {
            cells[index].spriteFrame = index < count ? this.chestCellFilled : this.chestCellEmpty;
        }
        if (!this.chestBar) return;
        this.chestBar.render(data);
    }

    /** 宝箱栏收起（点折叠箭头 / 左箭头在展开态）。 */
    private readonly onChestCollapse = (): void => { this.setChestPanelOpen(false); };

    private readonly refreshTreasureDisplay = (): void => {
        this.renderChests(this.treasureRepository.slots);
        this.refreshChestDetailCountdown();
    };

    /** 弹窗开着时每秒刷一次倒计时（只写那一颗按钮，不整窗重开）。 */
    private refreshChestDetailCountdown(): void {
        const panel = PopupManager.inst.get(ChestDetailPanel);
        if (!panel || this.detailSlot <= 0) return;
        const detail = this.treasureRepository.detailOf(this.detailSlot);
        if (!detail) {
            // 槽位没了（刚开完箱）⇒ 收起弹窗，别指着一个空槽
            panel.close();
            return;
        }
        this.detailAction = detail.action;
        // 🔴 2026-11-11 用户：「点击解锁后，详情的按钮也要同步刷新」。
        //    旧实现只把倒计时塞给弹窗 ⇒ 槽位已变成绿色「加速」，弹窗还写着黄色「解锁」。
        //    现在文案、绿底、播放 icon 都随这份状态一起下发（弹窗内部是全量赋值）。
        const speedUp = detail.action === ChestSlotAction.SpeedUp;
        panel.updateCountdown(detail.remainSeconds, speedUp, {
            caption: chestActionCaption(detail.action),
            speedUp,
        });
    }

    private async onChestAction(slot: number): Promise<void> {
        const item = this.treasureRepository.slots[slot];
        if (!item) return;
        if (item.action === ChestSlotAction.Battle) {
            const entry: IMatchingEntryParams = {
                battleType: ZC_BATTLE_TYPE_CHAPTER,
                battleParams: [String(ZC_CHAPTER_BATTLE_SUB_TREASURE)],
            };
            // 宝箱栏的「战斗」格进的是**匹配**，与领地格点开战走同一套整页过场
            // （用户 2026-11-02：「宝箱匹配也要接」）。过场接手了就直接返回 ——
            // 它到点自己跳，这里再跳一次等于两份匹配请求。
            if (this.territoryMap?.playMatchingIntro(entry)) return;
            ProcedureManager.navigate(GameRoute.Matching, entry);
            return;
        }
        // 2026-10-27（蓝湖「宝箱详情」）：非空槽位**先弹详情**，让玩家看见能开出什么、
        // 立即开要花多少，再由弹窗的两颗按钮发请求。原来这里是点一下直接发
        // activate / fastOpen / open 三条之一，全程没有确认也没有奖励预览。
        await this.openChestDetail(item.index);
    }

    // ============================================================
    // 宝箱详情弹窗
    // ============================================================

    private async openChestDetail(index: number): Promise<void> {
        const detail = this.treasureRepository.detailOf(index);
        if (!detail) return;
        this.detailSlot = index;
        this.detailAction = detail.action;
        const content = await this.chestDetailContentOf(detail);
        if (!this.isValid) return;
        // 加载期间玩家可能又点了别的箱子（或关了弹窗）⇒ 以最新那次为准
        if (this.detailSlot !== index) return;
        const opened = PopupManager.inst.get(ChestDetailPanel);
        if (opened) { opened.applyContent(content); return; }
        void ChestDetailPanel.open({ userData: content });
    }

    private async chestDetailContentOf(detail: IChestDetailData): Promise<IChestDetailContent> {
        const [icon, frame, rewards] = await Promise.all([
            this.loadChestFrame(detail.icon),
            this.loadQualityFrame(detail.quality),
            // 奖励格只要 id + 数量，图标/品质框由 `RewardItemView` 自己解析
            detail.rewards.map((reward) => ({
                resId: reward.resId,
                amount: reward.amount,
                ratePercent: reward.ratePercent,
            })),
        ]);
        const counting = detail.action === ChestSlotAction.SpeedUp;
        const activated = detail.action !== ChestSlotAction.Activate;
        return {
            name: detail.name,
            qualityText: `品质：${qualityNameOf(null, detail.quality)}`,
            // 银币图标用 prefab 上的静态帧（弹窗只在传了帧时才覆盖）
            costIcon: null,
            // 协议没有「持有数量」字段（`CmdNewTreasureInfo` 只有 cardBoxID/openTime/index）
            // ⇒ 按「一个槽位一个宝箱」固定 1（山猫 2026-10-27 口径）。
            countText: '数量：1',
            icon,
            qualityFrame: frame,
            rewards,
            fastOpenCost: detail.fastOpenCost,
            // 未激活时也能花银币直接开（跳过倒计时）；空槽位走不到这里。
            fastOpenEnabled: true,
            // 🔴 与宝箱栏那颗按钮**同源**（`chestActionCaption`）：未激活 ⇒「解锁」、**正在等 ⇒「加速」**、
            //    等完 ⇒「开启」。以前这里固定写「打开」，未激活时点它其实是**启动倒计时**；
            //    2026-11-09 用户又补了一轮：「点击解锁中的宝箱，宝箱详情中的开启按钮用加速按钮替换」。
            openCaption: chestActionCaption(detail.action),
            // 加速态 = 绿色底 + 播放 icon（2026-11-11）；解锁 / 开启仍是黄色底。
            openSpeedUp: counting,
            openCountdown: detail.remainSeconds > 0 ? formatChestCountdown(detail.remainSeconds) : '',
            // 倒计时中不能开（要么等、要么点「立即打开」）；未激活时这颗 = 开始计时。
            // ⚠️ 等待中那颗写的是「加速」但**仍是禁用**：服务端只有
            //    `CmdNewTreasure{InfoList,Activate,FastOpen,Open}`，没有"加速"这条命令 ——
            //    真加速（看广告 / 扣资源把 openTime 提前）要先有协议，接上后把这里改 true
            //    并在 `onChestDetailOpen` 里加 `speedUp` 分支。
            openEnabled: !counting && (activated || detail.remainSeconds >= 0),
        };
    }

    /** 图标按路径缓存；缺图返回 `null`（那一枚没图，不影响其它格）。 */
    private async loadChestFrame(path: string): Promise<SpriteFrame | null> {
        if (!path || this.chestArtScope.disposed) return null;
        const cached = this.chestIconCache.get(path);
        if (cached?.isValid) return cached;
        this.chestIconCache.delete(path);
        try {
            const frame = await this.assets.load(spriteFramePathOf(path), SpriteFrame, { scope: this.chestArtScope });
            if (this.chestArtScope.disposed || !frame.isValid) return null;
            this.chestIconCache.set(path, frame);
            return frame;
        } catch (error) {
            console.warn(`[MainPage] 宝箱详情图标加载失败：${path}`, error);
            return null;
        }
    }

    private async loadQualityFrame(quality: number): Promise<SpriteFrame | null> {
        return this.loadChestFrame(`image/${qualityFrameArtPath(qualityFrameSuffixOf(quality))}`);
    }

    private readonly onChestDetailClose = (): void => {
        this.detailSlot = 0;
    };

    private readonly onChestDetailFastOpen = (): void => {
        void this.runTreasureAction('fastOpen');
    };

    private readonly onChestDetailOpen = (): void => {
        // 「打开」在未激活状态 = 开始计时；到点状态 = 开箱。
        if (this.detailAction === ChestSlotAction.Activate) void this.runTreasureAction('activate');
        else if (this.detailAction === ChestSlotAction.Open) void this.runTreasureAction('open');
    };

    /**
     * 发请求 + 收尾。
     *
     * 激活成功后在当前弹窗继续显示倒计时；真正开箱后关闭对应详情。
     */
    private async runTreasureAction(kind: 'activate' | 'fastOpen' | 'open'): Promise<void> {
        const index = this.detailSlot;
        if (index <= 0) return;
        const result = kind === 'activate'
            ? await this.treasureRepository.activate(index)
            : (kind === 'fastOpen'
                ? await this.treasureRepository.fastOpen(index)
                : await this.treasureRepository.open(index));
        if (!this.isValid || this.detailSlot !== index) return;
        if (result === 'busy') return;
        if (result === 'ok') {
            if (kind === 'activate') this.refreshChestDetailCountdown();
            else PopupManager.inst.get(ChestDetailPanel)?.close();
            return;
        }
        if (result === 'offline') FW.showTip(MAIN_PAGE_TEXTS.networkUnavailable);
        else if (result === 'failed') FW.showTip(MAIN_PAGE_TEXTS.actionFailed);
        else if (result === 'protocol-missing') FW.showTip(MAIN_PAGE_TEXTS.openProtocolMissing);
    }
}
