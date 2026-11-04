import { _decorator, Button, Component, Node, Sprite, SpriteFrame } from 'cc';
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
    CHEST_EMPTY_SLOT_STAMINA_COST, CHEST_SLOT_COUNT, ChestSlotAction, ChestSlotState, formatChestCountdown,
} from './ChestTypes';
import type { IChestDetailData, IChestSlotData } from './ChestTypes';
import { NewTreasureRepository } from './NewTreasureRepository';
import type { MainTerritoryMap } from './MainTerritoryMap';
import { GameNet } from '../net/GameNet';
import { ChapterSelectPanel } from './ChapterSelectPanel';
import { loadChapterSelectRows } from '../territory/application/ChapterSelectLoader';
import { TerritoryUiEvent, TerritoryViewEvent, type ITerritoryRenderEvent } from '../territory/application/TerritoryEvents';
import type { ITerritoryProgressView } from '../territory/application/TerritoryViewState';
import type { TerritoryCampaignStage } from '../territory/model/TerritoryCampaignConfig';
import { RefUtil } from '../../framework/ref/RefUtil';
import { CacheMgr } from '../net/CacheMgr';
import { toCount } from '../net/RequestGuard';
import { battleLevelPassDetail, isLevelPassed } from './BattleLevelPassed';
import {
    CHEST_ENTRY_POP_SECONDS,
    chestEntryPopScale,
    inspectChestEntryConditions,
    isChestEntryVerdictProvisional,
    resolveChestEntryGate,
} from './ChestEntryGate';
import { EMPTY_ENTRANCE_PLAYER_STATE } from './MainEntranceVisible';
import type { EntrancePlayerState, EntranceVisibleRow } from './MainEntranceVisible';

const { ccclass, property } = _decorator;

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
     * 快照到之前 `refreshChestEntry` 会被调好几次（`onLoad`、关卡缓存推送），
     * 不去重就是同一条刷屏 —— 但也不能完全静默，否则「icon 一直不出现」时
     * 日志里连「还在等数据」都看不到。同样要静态：主城页会重建。
     */
    private static chestEntryWaitingLogged = false;
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
    /** 战斗宝箱入口开没开（`open.json` `refId=701`「战斗掉落宝箱」的条件）；`false` = icon 不显示。 */
    private chestEntryUnlocked = false;
    /** 领地最新一帧的「格子 → 关卡」映射（判 pvp 据点通没通要用）。 */
    private territoryStageByCell: ReadonlyMap<number, TerritoryCampaignStage> | null = null;
    /** 领地最新一帧的进度快照（冻结过的，读 `isAreaPassed` 不会读到半更新状态）。 */
    private territoryProgress: ITerritoryProgressView | null = null;
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
        this.chestToggle.active = false;
        this.setChestCellsVisible(false);
        this.refreshChestEntry();
    }

    start(): void {
        this.renderChests(this.emptyChestSlots);
        this.chestBar.setOpen(false, false);
        this.startButton.active = true;
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
        this.chestIconCache.clear();
        EventMgr.instance.offTarget(this);
        this.treasureRepository.dispose();
        GameNet.instance.removeCaller(this);
    }

    private readonly onBattleLevelCacheUpdate = (): void => { this.refreshChestEntry(); };

    // ========================================================
    // 战斗宝箱入口：开启条件（open.json refId=701「战斗掉落宝箱」）+ 生成动画
    // ========================================================

    /**
     * 重算「战斗宝箱入口」开没开。
     *
     * 条件写在 `open.json` 的 `refId=701`（`battleLevel` + `resId=20001`），这里**不认关卡号**，
     * 只把整张表交给 `ChestEntryGate` 判 —— 策划换关卡 / 叠条件都不用动客户端。
     *
     * 表没进缓存时走异步：`getRefAll` 返回 `undefined` 才是"没缓存"，不能当成"表里没这一行"。
     */
    private refreshChestEntry(): void {
        let rows: readonly EntranceVisibleRow[] | null = null;
        try {
            rows = (RefUtil.instance.getRefAll('open') ?? null) as readonly EntranceVisibleRow[] | null;
        } catch (error) {
            console.warn('[MainPage] 读 open 表缓存失败', error);
        }
        if (rows) {
            this.applyChestEntryGate(rows);
            return;
        }
        void this.loadOpenTableThenGate();
    }

    private async loadOpenTableThenGate(): Promise<void> {
        let rows: readonly EntranceVisibleRow[] | null = null;
        try {
            rows = (await RefUtil.instance.getRefAllAsync('open')) as readonly EntranceVisibleRow[];
        } catch (error) {
            console.warn('[MainPage] 拉 open 表失败，战斗宝箱入口先不显示', error);
        }
        if (!this.isValid) return;
        this.applyChestEntryGate(rows ?? null);
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
        const state = this.chestEntryPlayerState();
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
        const cells = [...stageByCell].filter(([, stage]) => stage.levelId === levelId).map(([cellId]) => cellId);
        if (!cells.length) return `领地这一章没有 levelId=${levelId} 的格子（当前章共 ${stageByCell.size} 格）`;
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
     * 快照没到（领地还没渲染 / 这个宿主没挂地图）一律按没通过 —— 宁可晚一点显示，
     * 也不要在没打过时把入口摆出来。
     */
    private readonly isTerritoryLevelPassed = (levelId: number): boolean => {
        const stageByCell = this.territoryStageByCell;
        const progress = this.territoryProgress;
        if (!stageByCell || !progress) return false;
        for (const [cellId, stage] of stageByCell) {
            if (stage.levelId === levelId && progress.isAreaPassed(cellId)) return true;
        }
        return false;
    };

    /**
     * 条件判定要的玩家状态。
     *
     * 两个取数口都给：`battleLevel` 查 `CmdBattleLevel`（主线关卡），
     * `territoryLevel` 查领地格子（pvp 据点）—— 前者服务端对据点不写，后者才能判 20001。
     * 其余字段与主界面两侧入口同源，将来表上叠 `roleLevel` 之类也能直接生效。
     */
    private chestEntryPlayerState(): EntrancePlayerState {
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
        const result = await this.treasureRepository.load(this, (slots) => this.renderChests(slots));
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
        this.startButton.active = !open;
    }

    private onStartGame(): void {
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
        this.refreshChestEntry();
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
        panel.updateCountdown(detail.remainSeconds, detail.action === ChestSlotAction.SpeedUp);
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
            openCaption: '打开',
            openCountdown: detail.remainSeconds > 0 ? formatChestCountdown(detail.remainSeconds) : '',
            // 倒计时中不能开（要么等、要么点「立即打开」）；未激活时这颗 = 开始计时。
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
