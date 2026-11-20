import { instantiate, Prefab, type Node } from 'cc';
import { ControllerBase, type IControllerContext } from '../../../framework/controller/ControllerBase';
import { GuideController, type IGuideViewState } from '../../guide/application/GuideController';
import { VIEW_LIFECYCLE, type IViewLifecycle } from '../../../framework/ui/ViewLifecycle';
import { PopupManager } from '../../../framework/ui/PopupManager';
import { ShowRewardPage } from '../../showReward/ShowRewardPage';
import { loadGuideDialog, loadGuidePortraits, loadGuideSteps } from '../../guide/application/GuideLoader';
import { createGuidePersistence } from '../../guide/application/GuideStorageAdapter';
import { GameNetGuideGateway } from '../../guide/application/GuideGateway';
import { GuideDialogView } from '../../guide/ui/GuideDialogView';
import type { IGuideFocusTarget } from '../../guide/ui/GuideDialogView';
import { GuideFocusAnchor } from '../../guide/ui/GuideFocusAnchor';
import { MainTab, MainTabHost } from '../../main/MainTabHost';
import { CardLineupPage } from '../../card/CardLineupPage';
import { CardUpgradePage } from '../../card/CardUpgradePage';
import { GuideEvent, type IGuideCompletePayload } from '../../guide/application/GuideEvents';
import { GUIDE_TEXTS } from '../../guide/GuideTexts';
import { Toast } from '../../common/Toast';
import { MainTaskDetailPage } from '../../maintask/MainTaskDetailPage';
import { MainTaskEntry } from '../../maintask/MainTaskEntry';
import { TerritoryChestOpenPage } from '../../territory/view/TerritoryChestOpenPage';
import { TerritoryUiEvent } from '../../territory/application/TerritoryEvents';
import { HeroObtainPage } from '../../card/view/HeroObtainPage';
import type { MainTerritoryMap } from '../../main/MainTerritoryMap';

const GUIDE_DIALOG_PREFAB = 'ui/Guide/GuideDialog';

/**
 * 对话条出现时要一起收起的常驻 HUD（按节点名深度找，不写 `cc.find` 绝对路径 —— 页面结构一动就断）。
 *
 * | 节点 | 是什么 |
 * | --- | --- |
 * | `TopHud` | 左上玩家卡 + 右上资源条 + 好友 / 邮件 / 排行榜 / 邀请 |
 * | `BottomHud` | 任务入口 / 征收入口 / 聊天 / 宝箱入口与数量格 |
 * | `BeginGame` | 底部「快速寻敌」 |
 *
 * 底部七格导航（`BottomNav`）不在这张表里：它挂在 `Canvas / MainRoot` 上，不在 tab 页面里，
 * 由 `dialogHudNodes` 单独取（引导一开始就一起收）。
 */
const DIALOG_HIDDEN_HUD = ['TopHud', 'BottomHud', 'BeginGame'] as const;

/**
 * 主界面 HUD 的**引导进度**解锁点：第一关打完、回到章节地图（`5-4 → 6-1`）。
 *
 * 🔴 旧口径只在「引导层正在画」时收 HUD（`syncDialogHud`），一遇到全屏弹窗
 * （领奖 / 宝箱 / 卡牌升级）`render` 就走 `view.hide()` + `restoreDialogHud()`，
 * 顶栏入口、底栏、宝箱、聊天条、底部导航**全部被放回来** —— 玩家在引导第 2 关的领奖弹窗上
 * 就看见了完整主界面（用户 2026-11-18 第 26 条现场截图）。
 */
const HUD_UNLOCK_AFTER_STEP = '5-4';

/** 任务入口（`BottomHud/MainTaskEntry`）要等引导走到主线任务那一步才出现。 */
const TASK_ENTRY_UNLOCK_STEP = '8-1';

/**
 * 「等奖励演出演完再出场」的那一步（用户 2026-11-18 第 27 条补丁 B）。
 *
 * 7-1 翻掉那一格 → 立刻推进到 8-1，而那一格的**奖励粒子动画**（喷发 / 飘字 / 英雄飞）
 * 是异步回包之后才开始演的。老口径一上报就把窗口关掉 ⇒ 8-1 的光圈、台词、手指整个
 * 压在还在飞的粒子上，玩家既看不清奖励也看不清引导。
 *
 * 现在：进这一步先按住不出场，等领地页的「演出窗口」开→关完整走一遍
 * （{@link TerritoryUiEvent.ChestPresentation}，粒子演完才关）再画。
 *
 * 🔴 2026-11-19 追加：翻地那一格**还会弹「奖励领取」弹窗**（固定格 / 随机格的第一格走
 * `FW.ShowReward`，宝箱链路还要先过英雄页）。弹窗是独立于粒子的第二段，粒子演完 ≠ 奖励看完 ⇒
 * 只要还开着任一奖励页就不许放行，等它关掉再画（否则 8-1 在弹窗底下开口、关掉后从第一句重播）。
 */
const REWARD_HOLD_STEP = '8-1';

/**
 * 等奖励演出的兜底：那一格没给奖励 / 回包丢了 ⇒ 不会有点子动画，也就不会有窗口。
 *
 * 2.6s ≥ 一次往返 + 喷射演出（12 颗满喷 1.54s / 飘字 1.15s），只为「不把最后一步永久按住」，
 * 不参与任何玩法判据。
 */
const REWARD_HOLD_FALLBACK_MS = 2600;

/**
 * 8-1（整条引导的最后一步）完成时的系统提示文案。
 *
 * 引导奖励是**后端在完成这一步时发的**：`GuideStepConfig.rewardJson` 客户端只解析、无消费方
 * （`grep rewards assets/script/app/guide` 只有解析那一行），所以这条提示只能由引导层自己补。
 * 文案本体收在 `GuideTexts`（工程统一做法，见 `SHOW_REWARD_TEXTS` / `MAIN_TASK_TEXTS`）。
 */
const GUIDE_FINISH_REWARD_TOAST = GUIDE_TEXTS.finishRewardTip;

/**
 * 5-4 之前一律不显示的主界面 HUD。
 *
 * ⚠️ 不是整块 `TopHud`：左上玩家卡与资源条是核心信息，引导期间也要留着；
 * 要收的只是右上那排入口（好友 / 邮件 / 排行榜 / 邀请）。
 */
const GUIDE_LOCKED_HUD = ['EntryBar', 'BottomHud', 'BeginGame'] as const;

/** 深度优先按名字找节点（含自己）。 */
function findChildByName(root: Node, name: string): Node | null {
    if (root.name === name) return root;
    for (const child of root.children) {
        const hit = findChildByName(child, name);
        if (hit) return hit;
    }
    return null;
}

/** `node` 是否在 `ancestor` 子树里（含自身）。 */
function isInsideNode(node: Node, ancestor: Node): boolean {
    for (let cur: Node | null = node; cur; cur = cur.parent) if (cur === ancestor) return true;
    return false;
}

/**
 * 主相位「等地图首帧」的上限：领地页数据永远拉不下来（章节加载失败）时也要把引导放出来。
 *
 * 与 `MainTabHost.FIRST_SCREEN_FALLBACK_SECONDS` 同一个思路 —— 一次网络失败不该把整条引导
 * 永久钉死（玩家会看到「打完仗什么都没发生」）。
 */
const MAP_PRESENTED_FALLBACK_SECONDS = 8;

/** 焦点落在战斗页面里（对局由战斗自己的引导承接，主界面这层不该接管）。 */
function isBattleFocus(focusNode: string): boolean {
    return focusNode.startsWith('Battle/') || focusNode.startsWith('BattleResult/');
}

/** 主界面与章节战斗复用同一装配逻辑，进度继续由 GuideController 和存档持有。 */
export class GuideComposition extends ControllerBase {
    private latestState: IGuideViewState | null = null;
    /** 引导层挂载的 `Canvas`：焦点解析与 HUD 显隐都要从这里取宿主。 */
    private canvas: Node | null = null;
    /** 本次引导为「只留引导 UI」收起来的节点；恢复时只还原本就显示的那些。 */
    private readonly hiddenHud = new Set<Node>();
    /**
     * 主相位：领地图首帧画出来了吗。
     *
     * 🔴 结算页点「确定」的次序是「先 `reportGuideComplete('backToMap')` 再 `navigate`」
     * （`BattleComposition.onReturnToMain`），主页组合层一挂起来就 `controller.start()` → 首帧 `render`，
     * 而领地页的章节数据 / 贴图还在路上 ⇒ 6-1（卡牌升级）会浮在一片裸底上开口说话
     * （用户 2026-11-18 第 23 条：升级卡牌的引导要等回到主页面／章节地图再加载）。
     *
     * 信号取 `MainTerritoryMap` 首次成功渲染时发的 `VIEW_LIFECYCLE { phase: 'presented' }`
     * —— 那是「`state.ready && map && progress` 都到位、真正画了一帧」的时刻，比任何计时都准。
     * 没有领地图的页面（战斗里 / 英雄·角色 tab）直接置真，不受影响。
     */
    private mapPresented = false;
    /** 最近一次的状态出口（在 `startGuide` 里赋值），给「地图首帧迟到了」那几条路复用。 */
    private draw: ((state: IGuideViewState) => void) | null = null;
    /** `guideStep` 表里的 stepId 顺序；判「走到第几步」用它，别比字符串。 */
    private stepOrder: readonly string[] = [];
    /** 5-4 已过 ⇒ 主界面 HUD 解锁（见 {@link HUD_UNLOCK_AFTER_STEP}）。 */
    private hudUnlocked = false;
    /** 8-1 已到 ⇒ 任务入口解锁，并且已经重读过一次快照。 */
    private taskEntryUnlocked = false;
    /**
     * 8-1 的「等奖励演出」状态机：`idle` 未开始 / `armed` 按住中 / `released` 已放行。
     *
     * 放行是**一次性**的：一旦出场就永久放行，免得后面任何一次演出窗口再把这最后一步收回去
     * （那时台词已经开过口，收回去会从第一句重播）。
     */
    private rewardHold: 'idle' | 'armed' | 'released' = 'idle';
    /** 按住期间有没有真的见过演出窗口开着（见 `syncRewardHold`）。 */
    private rewardHoldSawPlaying = false;
    private rewardHoldTimer: ReturnType<typeof setTimeout> | null = null;
    /** 被进度门控压住的节点：`restoreDialogHud` / `syncDialogHud` 都不许把它们开回来。 */
    private readonly gateHidden = new Set<Node>();
    constructor(private readonly context: IControllerContext, private readonly root: Node,
        private readonly phase: 'main' | 'battle', private readonly territoryView: MainTerritoryMap | null = null) {
        super(context, 'guide-composition');
        // 没有领地图的页面（战斗里 / 其它 tab）不需要等，直接当成已就绪。
        this.mapPresented = !this.territoryView;
        // 用领地页（Component）的调度器而不是 `setTimeout`：节点销毁时 Cocos 自动取消，不留悬挂计时。
        // 战斗里没有领地页，`mapPresented` 已经是 true，不需要这条兜底。
        this.territoryView?.scheduleOnce(() => this.markMapPresented(), MAP_PRESENTED_FALLBACK_SECONDS);
        void this.startGuide().catch(reportGuideFailure);
    }

    private async startGuide(): Promise<void> {
        const steps = await loadGuideSteps();
        // await 之后组合层可能已经被销毁（切页 / 退出对局），必须判。
        if (this.isDisposed || steps.length === 0) return;
        // 「走到第几步」按表里的顺序判，不比字符串（`5-10` 这种两位序号按字面比会错）。
        this.stepOrder = steps.map(step => step.stepId);

        const view = await this.createGuideView();
        if (!view) return;
        if (this.isDisposed) { view.node.destroy(); return; }

        // 台词与立绘并行取；任一缺失只让对应表现空着（Loader 内部已兜底）。
        const [{ groups }, frames] = await Promise.all([
            loadGuideDialog(),
            loadGuidePortraits(this.resources),
        ]);
        if (this.isDisposed) { view.node.destroy(); return; }
        view.initialize(groups, frames);

        // 奖励可能由其它功能打开，也可能早于引导完成加载；统一按弹窗实例暂停。
        const rewards = new Set(PopupManager.inst.openedPopups.filter(popup => popup instanceof ShowRewardPage));
        const cardDetails = new Set(PopupManager.inst.openedPopups.filter(popup => popup instanceof CardUpgradePage));
        // 领地宝箱开启页也是全屏奖励页：它开着的时候引导层必须让位，否则「点收下」会被
        // 引导的 Dim/Blocker 盖住点不动。让位后玩家先安心关掉弹窗，关掉再回来播奖励对话。
        const chestPages = new Set(PopupManager.inst.openedPopups.filter(popup => popup instanceof TerritoryChestOpenPage));
        // 「获得英雄」全屏页（宝箱里的橙卡碎片）：引导层同样要让位，而且是**逐张**串起来的 ——
        // 关掉一张才轮到下一张，全部关完才轮到统一奖励弹窗。
        const heroPages = new Set(PopupManager.inst.openedPopups.filter(popup => popup instanceof HeroObtainPage));
        // 领地宝箱「开箱粒子动画 → 英雄页 → 统一奖励弹窗」这一整段的**窗口标记**。
        // 这一段的前半截（粒子动画）一个全屏弹窗都没有，光靠上面几个 Set 挡不住，
        // 2-3 的台词会抢在动画中间开口、等奖励窗一开又被打断、关掉再从第一句重播。
        let chestPresenting = false;
        const render = (state: IGuideViewState): void => {
            this.latestState = state;
            // 🔴 先过一遍**进度门控**：主界面那批 HUD 在 5-4 之前根本不该存在（第 26 条）。
            // 放在最前面是因为下面两个分支都会去动 HUD 显隐（`view.hide()` 时 `restoreDialogHud`
            // 会把它们全放回来），门控必须比它们更"权威"。
            this.applyHudGate(state);
            const battleFocus = isBattleFocus(state.focusNode);
            const requiredCard = /^cardLevelUp:(\d+)$/.exec(state.completeCond)?.[1];
            const otherCard = Array.from(cardDetails).some(popup => state.focusNode !== 'CardDetail/BtnUpgrade' || popup.guideCardId !== requiredCard);
            // 主相位第一步：**地图还没画出来就先不出**（第 23 条）。
            // 结算返回时组合层比领地页早建好几拍，这里不放行的话 6-1 会盖在一片裸底上。
            const waitingForMap = !state.finished && !!this.territoryView && !this.mapPresented;
            // 8-1：翻地那一格的奖励粒子还在飞就先别出场（第 27 条补丁 B）。
            // 放在这里（`applyHudGate` 之后）是有意的：任务入口该解锁还得解锁，
            // 否则等演出等到最后，玩家面前连个能点的 icon 都没有。
            // 第二段（2026-11-19）：粒子演完还会弹「奖励领取」弹窗（固定格 / 随机格的第一格是
            // `FW.ShowReward`，宝箱链路先过英雄页）⇒ 只要还开着任一奖励页就一并按住。
            const rewardPopupOpen = rewards.size > 0 || chestPages.size > 0 || heroPages.size > 0;
            const holdForReward = this.syncRewardHold(state, chestPresenting, rewardPopupOpen);
            if (rewardPopupOpen || chestPresenting || otherCard
                || waitingForMap || holdForReward
                || (!state.finished && battleFocus !== (this.phase === 'battle'))) {
                view.hide();
                this.setGuideCardScrollLocked(false);
                // 引导层没在显示就别占着底栏 —— 玩家这时该正常用主界面。
                this.restoreDialogHud();
            } else {
                // 地图步骤从其它页恢复时，先指向领地入口；切回地图后仍按原步骤定位地块。
                const shown = state.focusNode.startsWith('Map/') && !this.territoryView
                    ? { ...state, focusNode: 'Main/TerritoryEntry' } : state;
                view.render(shown);
                // 卡库那两步（6-2 指某张卡）把列表拖拽锁住：孔挖在卡上，拖走就对不上了。
                this.setGuideCardScrollLocked(shown.focusNode.startsWith('CardList/'));
                this.syncDialogHud(shown, battleFocus);
            }
        };
        // 「地图首帧迟到了」的几条路都从这里补画一次（`presented` 事件 / 兜底计时）。
        this.draw = render;
        this.listen(VIEW_LIFECYCLE, ({ owner, phase }: IViewLifecycle) => {
            // 领地页首帧画出来了 ⇒ 放开「等地图」这道闸，并立刻补画一次（此刻 `latestState` 多半已就绪）。
            if (owner === this.territoryView && phase === 'presented') { this.markMapPresented(); return; }
            const popups: Set<object> | null = owner instanceof ShowRewardPage ? rewards
                : owner instanceof CardUpgradePage ? cardDetails
                : owner instanceof TerritoryChestOpenPage ? chestPages
                : owner instanceof HeroObtainPage ? heroPages
                : null;
            if (!popups) return;
            if (phase === 'enabled') popups.add(owner);
            else if (phase === 'disabled' || phase === 'destroyed') popups.delete(owner);
            else return;
            // 统一奖励弹窗是领地宝箱演出的**最后一棒**：它上了台，演出窗口就由它接着挡；
            // 它关掉，窗口才算真正结束（这之后 2-3 的台词才开口）。
            // 只有它来关这个窗口 —— 组合层提前关会露出几帧空档，对话框先闪一下再被盖住。
            if (owner instanceof ShowRewardPage) chestPresenting = false;
            if (this.latestState) render(this.latestState);
        });
        this.listen(GuideEvent.Complete, (event: IGuideCompletePayload) => {
            if (event.cond === 'cardSelected' && this.latestState) render(this.latestState);
            // 8-1 报「打开主线任务」= 整条引导的最后一步完成，后端这一刻就把引导奖励发了
            // （`guideStep.rewardJson` 客户端没有任何消费方）⇒ 这里补一条系统提示，
            // 见用户 2026-11-18 第 27 条补丁 B「奖励发放时增加系统提示文案」。
            //
            // 🔴 必须判 `latestState.stepId`：`MainTaskDetailPage.onOpen` 每次开面板都会无条件
            //    上报（它不知道自己是不是引导步），引导早走完的玩家再点任务入口时不许再弹这句。
            //    本监听比 `GuideController` 的监听先注册 ⇒ 此刻读到的还是完成**前**的那一步。
            if (event.cond === 'pageOpened' && event.arg === 'task' && this.latestState?.stepId === REWARD_HOLD_STEP) {
                Toast.show(GUIDE_FINISH_REWARD_TOAST);
            }
        });
        // 领地宝箱演出窗口：true 时整层让位（见上面 `chestPresenting` 的注释）。
        // 演完再 `render(latestState)` —— 台词会从第一句开始，不会接着半句话播。
        this.listen(TerritoryUiEvent.ChestPresentation, (event: { readonly playing: boolean }) => {
            if (chestPresenting === event.playing) return;
            chestPresenting = event.playing;
            if (this.latestState) render(this.latestState);
        });
        // 兜底计时是 `setTimeout`（组合层没有自己的调度器）⇒ 销毁时必须自己摘，否则会往一个
        // 已经散架的引导层上补画一次。
        this.own(() => this.clearRewardHoldTimer());

        const { store, outbox } = createGuidePersistence();
        const controller = new GuideController(this.context, {
            store,
            outbox,
            steps,
            gateway: new GameNetGuideGateway(),
            view: { owner: view, render },
            failed: reportGuideFailure,
        });
        if (!controller.start()) {
            view.node.destroy();
            controller.dispose();
            return;
        }
        this.own(() => controller.dispose());
        if (this.phase === 'battle') controller.notify('battleEntered');
        // 切页会重建引导；加载完成后按实际页面补报，避免错过页面 ready 事件。
        else if (this.root.getComponent(CardLineupPage)) controller.notify('pageOpened', 'card');
        const detail = PopupManager.inst.get(CardUpgradePage);
        if (detail?.guideCardId) controller.notify('cardSelected', detail.guideCardId);
    }

    /**
     * 「地图首帧已就绪」：幂等。事件与兜底计时都走这一个口。
     *
     * 还没拿到 `latestState`（引导还在加载台词 / 立绘）时什么都不用补 ——
     * 首次 `render` 会自己读到 `mapPresented` 已经是 true。
     */
    private markMapPresented(): void {
        if (this.mapPresented || this.isDisposed) return;
        this.mapPresented = true;
        const state = this.latestState;
        if (state && this.draw) this.draw(state);
    }

    private async createGuideView(): Promise<GuideDialogView | null> {
        try {
            const prefab = await this.resources.assets.load(GUIDE_DIALOG_PREFAB, Prefab, { scope: this.resources.scope });
            if (this.isDisposed) return null;
            if (!prefab) {
                console.warn('[GuideComposition] 引导 prefab 加载失败，本次不做引导');
                return null;
            }
            const node = instantiate(prefab);
            node.active = false;
            // 焦点会落在导航栏与弹窗里，覆盖层不能局限在当前 tab 的内容节点下。
            const canvas = this.root.scene.getChildByName('Canvas');
            canvas.addChild(node);
            this.canvas = canvas;
            this.own(() => node.destroy());
            // 会话结束时（切页 / 退出）还原本次收起的 HUD。
            this.own(() => this.restoreDialogHud());
            this.own(() => this.setGuideCardScrollLocked(false));
            const view = node.getComponent(GuideDialogView);
            if (view) view.setFocusProvider(key => this.resolveFocusTarget(key));
            if (!view) {
                console.warn('[GuideComposition] 引导 prefab 上缺少 GuideDialogView');
                node.destroy();
                return null;
            }
            return view;
        } catch (error) {
            reportGuideFailure(error);
            return null;
        }
    }

    /**
     * 焦点标识 → 真实节点。组合层是唯一知道「哪个业务节点挂哪个键」的地方。
     *
     * 同一份解析也用于保留当前焦点所在的 HUD。
     */
    private resolveFocusTarget(key: string): IGuideFocusTarget | null {
        // 详情被误关或重登恢复时，依次找回英雄页、目标卡、升级按钮。
        if ((key.startsWith('CardList/') || key === 'CardDetail/BtnUpgrade') && !PopupManager.inst.get(CardUpgradePage)) {
            if (!this.root.getComponent(CardLineupPage)) key = 'Main/CardEntry';
            else if (key === 'CardDetail/BtnUpgrade') {
                const cardId = /^cardLevelUp:(\d+)$/.exec(this.latestState?.completeCond ?? '')?.[1];
                if (cardId) key = `CardList/Card_${cardId}`;
            }
        }
        if (key === 'Main/CardEntry' || key === 'Main/TerritoryEntry') {
            const tab = this.canvas ? this.canvas.getComponentInChildren(MainTabHost)?.getGuideTabNode(
                key === 'Main/TerritoryEntry' ? MainTab.Territory : MainTab.Hero) : null;
            return tab ? { node: tab, shape: 'rect' } : null;
        }
        if (key === 'Main/TaskEntry') {
            // 8-1（用户 2026-11-18 第 27 条）：高亮底栏里的任务入口，让玩家自己点开面板。
            // 这个入口既不是 `MainTabHost` 的页签，prefab 上也没挂 `GuideFocusAnchor`（它的显隐由
            // 任务快照驱动，挂静态锚点在没任务时会留一个空光圈）⇒ 按节点名找，没找到就交给
            // 视图的 150ms 重试继续等。
            const entry = findChildByName(this.root, 'MainTaskEntry');
            return entry?.isValid ? { node: entry, shape: 'rect' } : null;
        }
        const mapNode = this.territoryView?.getGuideFocusNode(key) ?? null;
        if (mapNode) {
            // 关卡格子还要把「1-1」编号气泡一起圈进光圈（第 17 条）：气泡挂在角标层，
            // 和地块不是父子关系，只有引导层做并集才能两者都圈住。
            // ⚠️ 必须在 `getGuideFocusNode` 之后调 —— 它才刚定下这一帧的格号。
            return { node: mapNode, shape: 'hex', extra: this.territoryView?.getGuideFocusExtraNodes(key) ?? [] };
        }
        const canvas = this.canvas;
        if (!canvas) return null;
        const card = /^CardList\/Card_(\d+)$/.exec(key);
        if (card) this.root.getComponent(CardLineupPage)?.revealGuideCard(card[1]);
        let anchor: GuideFocusAnchor | null = null;
        for (const item of canvas.getComponentsInChildren(GuideFocusAnchor)) {
            if (item.key === key && item.node.activeInHierarchy && (!anchor || item.shownAt > anchor.shownAt)) anchor = item;
        }
        return anchor ? { node: anchor.node, shape: 'rect' } : null;
    }

    /**
     * 引导期间收起页面常驻挂件与**底部七格导航**。
     *
     * `Canvas/GMButton` 不收（见 {@link dialogHudNodes}）。
     *
     * 需求（2026-11-17）：底栏从**第一句台词**播起就收，强制引导阶段同样保持收起 ——
     * 整段引导里玩家能点的只有光圈里那个目标，底栏既点不动也抢注意力。
     * 判据是「本步有没有台词或焦点」，而不是「对话条真的画出来了」：台词组缺失时
     * 对话条会藏，但引导仍在跑，HUD 同样不该给点 —— 玩家中途切页会把引导卡死。
     *
     * 唯一例外：焦点就落在某个要收的节点里，那个节点留着，
     * 否则手指导向一个玩家点不到的地方（第 6-1 步的焦点就是底栏里的「英雄」格）。
     */
    private syncDialogHud(state: IGuideViewState, battleFocus: boolean): void {
        const guiding = !!state.dialogId || !!state.focusNode;
        if (this.phase !== 'main' || state.finished || battleFocus || !guiding) {
            this.restoreDialogHud();
            return;
        }
        const focus = this.resolveFocusTarget(state.focusNode)?.node ?? null;
        // 焦点就在**底栏**里（6-1 的「英雄」格）时，底栏**无条件留着**。
        //
        // 老口径是「焦点解析出来、且落在这条底栏里才留」，可切回主页那几帧 `MainTabHost`
        // 还没把页签注册上（`getGuideTabNode` 返回 null）⇒ 焦点为空 ⇒ 底栏被当普通 HUD 收掉，
        // 玩家既看不到「已经回到主页」，也没地方点（用户 2026-11-17 第 13 条 ⑤：
        // 先露出底部菜单栏，再触发 6-1 去升级界面）。视图那边会按 150ms 的间隔重试解析，
        // 锚点一就位光圈自己会挖出来。
        const navBar = this.canvas?.isValid
            ? this.canvas.getComponentInChildren(MainTabHost)?.navBar ?? null : null;
        const keepNav = state.focusNode.startsWith('Main/') && !!navBar?.isValid;
        // 8-1 的目标（主线任务入口）在 `BottomHud` 里：**整块底栏无条件留着**。
        //
        // 不能只靠下面那条 `isInsideNode(focus, node)`：焦点解析要先 `findChildByName` 找到入口，
        // 而入口的 `refresh()` 是异步读表 + 读缓存 —— 8-1 出场那几帧它可能还是 `active=false`
        // （解锁时才刚打开），某些时序下甚至拿不到节点。那时 `focus` 为 null ⇒ 底栏被当普通 HUD
        // 收掉 ⇒ 玩家面前一个能点的图标都没有，光圈和手指也没地方挖（用户 2026-11-19：
        // 「引导要求点主线任务时，入口被隐藏」）。
        const keepTaskEntryHost = state.focusNode === 'Main/TaskEntry';
        const targets = this.dialogHudNodes().filter(node => {
            if (keepNav && node === navBar) return false;
            if (keepTaskEntryHost && node.name === 'BottomHud') return false;
            return !focus || !isInsideNode(focus, node);
        });
        // 上一步收起来、这一步不该收的先还回去。
        for (const node of [...this.hiddenHud]) {
            if (!node.isValid) { this.hiddenHud.delete(node); continue; }
            if (targets.includes(node)) continue;
            this.hiddenHud.delete(node);
            // 被**进度**门控压着的节点不还（5-4 之前它们压根不该出现）。
            if (this.gateHidden.has(node)) continue;
            node.active = true;
        }
        for (const node of targets) {
            if (!node.isValid || !node.active) continue;
            this.hiddenHud.add(node);
            node.active = false;
        }
    }

    /** 卡库拖拽开关；页面还没挂（其它 tab）时什么都不做。 */
    private setGuideCardScrollLocked(locked: boolean): void {
        this.root.getComponent(CardLineupPage)?.setGuideScrollLocked(locked);
    }

    /**
     * 把这次收起来的 HUD 全部还回去（引导层不显示 / 会话结束时）。
     *
     * ⚠️ 仍然要过 {@link applyHudGate} 那道闸：领奖 / 宝箱 / 卡牌升级这些全屏弹窗期间引导层
     * 会 `view.hide()` 让位，一到这里就把顶栏、底栏、宝箱、聊天条全放回来 —— 玩家在引导
     * 第 2 关的领奖弹窗上就看见了完整主界面（第 26 条）。
     */
    private restoreDialogHud(): void {
        for (const node of this.hiddenHud) {
            if (!node.isValid) continue;
            node.active = !this.gateHidden.has(node);
        }
        this.hiddenHud.clear();
    }

    /**
     * 主界面 HUD 的**引导进度**门控（第 26 条）。
     *
     * 两档，都只看「走到第几步」，与引导层此刻画不画无关：
     * · `5-4` **之后**：右上入口排 / 底栏（宝箱·聊天·挂机·任务）/ 底部七格导航 / 快速寻敌才解锁。
     *   之前的每一步（含领奖弹窗让位期间）都压着。`Canvas/GMButton` 不在这道闸里 —— 常驻调试入口。
     * · `8-1` **之前**：任务入口（`BottomHud/MainTaskEntry`）单独收着 —— 引导讲到主线任务那一步
     *   才让玩家看见这个按钮（它会自己弹任务详情窗）。
     *
     * 只压不还：解锁那一刻把 `gateHidden` 里的节点放回去，其余交给 `syncDialogHud` 按步收。
     */
    private applyHudGate(state: IGuideViewState): void {
        if (this.phase !== 'main') return;
        const unlocked = state.finished || this.passedStep(state.stepId, HUD_UNLOCK_AFTER_STEP);
        if (unlocked !== this.hudUnlocked) {
            this.hudUnlocked = unlocked;
            if (unlocked) {
                for (const node of this.gateHidden) if (node.isValid) node.active = true;
                this.gateHidden.clear();
            }
        }
        if (!unlocked) {
            for (const node of this.guideLockedHudNodes()) {
                if (!node.isValid) continue;
                this.gateHidden.add(node);
                if (node.active) node.active = false;
            }
        }
        this.applyTaskEntryGate(state.finished || this.reachedStep(state.stepId, TASK_ENTRY_UNLOCK_STEP));
    }

    /** 任务入口单独一档：8-1（主线任务）之前藏，到了才让 `MainTaskEntry` 重读快照。 */
    private applyTaskEntryGate(unlocked: boolean): void {
        const node = findChildByName(this.root, 'MainTaskEntry');
        // 静态标志先写：`MainTaskEntry` 之后任何一次 `refresh()` 都要遵守它。
        MainTaskEntry.guideUnlocked = unlocked;
        if (!unlocked) {
            this.taskEntryUnlocked = false;
            // 每次都要压一遍（幂等）：入口的 `onLoad` 早于组合层就绪，那时快照已经把它打开过。
            if (node?.isValid && node.active) node.active = false;
            return;
        }
        if (this.taskEntryUnlocked) return;
        this.taskEntryUnlocked = true;
        if (!node?.isValid) return;
        // 先立起来再校正：`refresh()` 是异步「读表 + 读缓存」，等它回来才显示的话，
        // 8-1 开场那几帧玩家面前什么都没有（光圈也就没地方挖）。之后 `applySnapshot`
        // 会按快照重算一次 —— 真的没任务配置时它自己会关回去，走下面的兜底。
        if (!node.active) node.active = true;
        // 解锁：让它按自己的快照重新算一次显隐（入口可能没配任务，不能无脑打开）。
        // 算完再判一次：图标真的立不起来（任务未配置 / 已领完 / 面板读不到）时，玩家没有能点的东西，
        // 8-1 会永久卡在那里（完成条件就是「玩家点开面板」）⇒ 退回「引导代开面板」，它一开也算完成。
        void Promise.resolve(node.getComponent(MainTaskEntry)?.refresh()).then(() => {
            if (this.isDisposed || !node.isValid || node.active) return;
            console.warn('[GuideComposition] 8-1 任务入口不可见（无任务配置），改由引导代开主线面板');
            void MainTaskDetailPage.open({});
        });
    }

    /**
     * 8-1 的「等奖励」闸（第 27 条补丁 B + 2026-11-19 追加）：返回 `true` = 这一步**还不许出场**。
     *
     * 奖励分两段，任何一段没收完都不放行：
     * ① **演出窗口**：`playing:true` 是奖励到账（粒子起播），`playing:false` 是粒子演完
     *    （`MainTerritoryMap.playCellGains` 按动画时长收窗）；
     * ② **奖励领取弹窗**：固定格 / 随机格的第一格走 `{ popup: true }` ⇒ `FW.ShowReward`；
     *    宝箱链路还要先过「获得英雄」页。窗口和弹窗是两条命，粒子演完不等于奖励看完。
     *
     * 放行条件 = 「见过动静」+「现在彻底安静」：只在这一次循环之后才画 —— 老口径一上报
     * `tileFlipped` 就画 8-1，光圈和台词整个压在还在飞的粒子上（第 27 条补丁 B 现场）。
     *
     * 三条边界：
     * · 进场那一刻**已经在演 / 已经弹着**（奖励比引导推进先到）⇒ 当成已经见过，等它安静；
     * · 一直没见过任何动静（那一格没给奖励 / 回包丢了）⇒ `REWARD_HOLD_FALLBACK_MS` 到点强制放行；
     * · 放行之后永久放行（`released`），后面任何一次演出都不再把最后一步收回去
     *   （那时台词已经开过口，收回去会从第一句重播）。
     *
     * 🔴 **有动静时不许挂着兜底计时**：兜底是给「什么都没来」准备的，2.6s 一到就放行。
     * 弹窗还开着（玩家可能看十几秒）时若让它继续跑，到点就把 8-1 放到弹窗底下去 ——
     * 这正是 2026-11-19「8-1 要等奖励弹窗关掉再弹」要修的现象。
     *
     * @param presenting `ChestPresentation` 窗口的当前值（由 `startGuide` 里的闭包持有）
     * @param popupOpen 任一奖励弹窗（`ShowReward` / 宝箱开启 / 获得英雄）当前是否开着
     */
    private syncRewardHold(state: IGuideViewState, presenting: boolean, popupOpen: boolean): boolean {
        if (this.rewardHold === 'released') return false;
        // 不是 8-1（含引导已结束）⇒ 状态清干净，换页重建时能重新武装。
        if (state.finished || this.stepDistance(state.stepId, REWARD_HOLD_STEP) !== 0) {
            this.clearRewardHold();
            return false;
        }
        const busy = presenting || popupOpen;
        if (this.rewardHold === 'idle') {
            this.rewardHold = 'armed';
            this.rewardHoldSawPlaying = busy;
            // 已经在演 / 已经弹着 ⇒ 兜底先不挂（挂了会在弹窗还开着时到点）。
            if (busy) return true;
            this.armRewardHoldTimer();
            return true;
        }
        if (busy) {
            this.rewardHoldSawPlaying = true;
            this.clearRewardHoldTimer();
            return true;
        }
        // 安静下来了，但一次动静都没见过 ⇒ 继续等（兜底可能被上一条 busy 摘掉过，补挂）。
        if (!this.rewardHoldSawPlaying) {
            if (this.rewardHoldTimer === null) this.armRewardHoldTimer();
            return true;
        }
        this.rewardHold = 'released';
        this.clearRewardHoldTimer();
        return false;
    }

    /** 挂上「什么都没来」的兜底：到点强制放行，不参与任何玩法判据。 */
    private armRewardHoldTimer(): void {
        this.clearRewardHoldTimer();
        this.rewardHoldTimer = setTimeout(() => {
            this.rewardHoldTimer = null;
            this.rewardHold = 'released';
            // 窗口一直没来：这一步不能再等下去了。
            if (this.latestState && this.draw) this.draw(this.latestState);
        }, REWARD_HOLD_FALLBACK_MS);
    }

    private clearRewardHold(): void {
        this.rewardHold = 'idle';
        this.rewardHoldSawPlaying = false;
        this.clearRewardHoldTimer();
    }

    private clearRewardHoldTimer(): void {
        if (this.rewardHoldTimer === null) return;
        clearTimeout(this.rewardHoldTimer);
        this.rewardHoldTimer = null;
    }

    /**
     * 5-4 之前要压住的主界面 HUD（不含整块 `TopHud`，见 {@link GUIDE_LOCKED_HUD}）。
     *
     * `Canvas/GMButton` 不在其中：GM 入口是调试用的常驻节点，游标卡在 5-4 之前时
     * 也不许被这道闸永久关掉（否则只能靠 F1 才能唤回来）。
     */
    private guideLockedHudNodes(): Node[] {
        const out: Node[] = [];
        for (const name of GUIDE_LOCKED_HUD) {
            const node = findChildByName(this.root, name);
            if (node?.isValid) out.push(node);
        }
        const canvas = this.canvas;
        if (canvas?.isValid) {
            const nav = canvas.getComponentInChildren(MainTabHost)?.navBar ?? null;
            if (nav?.isValid) out.push(nav);
        }
        return out;
    }

    /**
     * `stepId` 是否**已经走过** `target`（target 本身算「还没走完」）。
     *
     * 「5-4 完成后才解锁」要的就是这个口径：结算页点确定之前 `stepId` 还是 `5-4`，
     * 那一刻不该解锁；上报 `backToMap` 之后才变 `6-1`。
     */
    private passedStep(stepId: string, target: string): boolean {
        return this.stepDistance(stepId, target) > 0;
    }

    /** `stepId` 是否**到达或走过** `target`。 */
    private reachedStep(stepId: string, target: string): boolean {
        return this.stepDistance(stepId, target) >= 0;
    }

    /**
     * 当前步相对 `target` 的位置：>0 已过、0 正好、<0 还没到。
     *
     * 表里没有 `target`，或当前 `stepId` 认不出来（引导已结束 / 存档游标是空）⇒ 一律当成「已过」，
     * 宁可把 UI 放出来，也不要把一整套主界面永久锁死。
     */
    private stepDistance(stepId: string, target: string): number {
        const order = this.stepOrder;
        const want = order.indexOf(target);
        if (want < 0) return 1;
        const at = order.indexOf(stepId);
        if (at < 0) return 1;
        return at - want;
    }

    /**
     * 这一步要收的 HUD：页面常驻子树与底部七格导航。
     *
     * `BottomNav` 由 `MainTabHost` 持有；焦点若落在某一格上，调用方的过滤器会把它留下。
     *
     * `Canvas/GMButton`（`GMManager` 的常驻入口）**不在这里**：它是调试入口，
     * 按 GMManager 的契约「跨流程存活、所有界面都可见」，不参与任何 HUD 门控。
     */
    private dialogHudNodes(): Node[] {
        const out: Node[] = [];
        const canvas = this.canvas;
        if (canvas?.isValid) {
            const nav = canvas.getComponentInChildren(MainTabHost)?.navBar ?? null;
            if (nav?.isValid) out.push(nav);
        }
        for (const name of DIALOG_HIDDEN_HUD) {
            const node = findChildByName(this.root, name);
            if (node?.isValid) out.push(node);
        }
        return out;
    }
}
function reportGuideFailure(error: unknown): void { console.warn('[GuideComposition]', error); }
