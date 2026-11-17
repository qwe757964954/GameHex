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
import { MainTaskDetailPage } from '../../maintask/MainTaskDetailPage';
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

/** 常驻 GM 入口的节点名（`Canvas/GMButton`，见 `GMManager`）：也压在右上角，对话期间一起收。 */
const GM_BUTTON_NODE = 'GMButton';

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
    constructor(private readonly context: IControllerContext, private readonly root: Node,
        private readonly phase: 'main' | 'battle', private readonly territoryView: MainTerritoryMap | null = null) {
        super(context, 'guide-composition');
        void this.startGuide().catch(reportGuideFailure);
    }

    private async startGuide(): Promise<void> {
        const steps = await loadGuideSteps();
        // await 之后组合层可能已经被销毁（切页 / 退出对局），必须判。
        if (this.isDisposed || steps.length === 0) return;

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
        let ownsMainGoal = false;
        let mainGoal: MainTaskDetailPage | null = null;
        this.own(() => {
            if (ownsMainGoal && (!mainGoal || PopupManager.inst.get(MainTaskDetailPage) === mainGoal)) {
                PopupManager.inst.closeByClass(MainTaskDetailPage);
            }
        });
        const render = (state: IGuideViewState): void => {
            this.latestState = state;
            const battleFocus = isBattleFocus(state.focusNode);
            const requiredCard = /^cardLevelUp:(\d+)$/.exec(state.completeCond)?.[1];
            const otherCard = Array.from(cardDetails).some(popup => state.focusNode !== 'CardDetail/BtnUpgrade' || popup.guideCardId !== requiredCard);
            if (rewards.size > 0 || chestPages.size > 0 || heroPages.size > 0 || chestPresenting || otherCard
                || (!state.finished && battleFocus !== (this.phase === 'battle'))) {
                view.hide();
                // 引导层没在显示就别占着底栏 —— 玩家这时该正常用主界面。
                this.restoreDialogHud();
            } else {
                // 地图步骤从其它页恢复时，先指向领地入口；切回地图后仍按原步骤定位地块。
                const shown = state.focusNode.startsWith('Map/') && !this.territoryView
                    ? { ...state, focusNode: 'Main/TerritoryEntry' } : state;
                view.render(shown);
                this.syncDialogHud(shown, battleFocus);
                if (!state.finished && state.focusNode === 'Popup/MainGoal'
                    && !ownsMainGoal && !PopupManager.inst.get(MainTaskDetailPage)) {
                    ownsMainGoal = true;
                    void MainTaskDetailPage.open().then(popup => {
                        if (this.isDisposed) return;
                        mainGoal = popup;
                        if (!popup) {
                            ownsMainGoal = false;
                            reportGuideFailure(new Error('主线任务面板打开失败'));
                        }
                    }, error => {
                        if (this.isDisposed) return;
                        ownsMainGoal = false;
                        reportGuideFailure(error);
                    });
                }
            }
        };
        this.listen(VIEW_LIFECYCLE, ({ owner, phase }: IViewLifecycle) => {
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
        });
        // 领地宝箱演出窗口：true 时整层让位（见上面 `chestPresenting` 的注释）。
        // 演完再 `render(latestState)` —— 台词会从第一句开始，不会接着半句话播。
        this.listen(TerritoryUiEvent.ChestPresentation, (event: { readonly playing: boolean }) => {
            if (chestPresenting === event.playing) return;
            chestPresenting = event.playing;
            if (this.latestState) render(this.latestState);
        });

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
        const mapNode = this.territoryView?.getGuideFocusNode(key) ?? null;
        if (mapNode) return { node: mapNode, shape: 'hex' };
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
     * 引导期间收起页面常驻挂件、GM 入口与**底部七格导航**。
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
        const targets = this.dialogHudNodes().filter(node => !focus || !isInsideNode(focus, node));
        // 上一步收起来、这一步不该收的先还回去。
        for (const node of [...this.hiddenHud]) {
            if (!node.isValid) { this.hiddenHud.delete(node); continue; }
            if (targets.includes(node)) continue;
            node.active = true;
            this.hiddenHud.delete(node);
        }
        for (const node of targets) {
            if (!node.isValid || !node.active) continue;
            this.hiddenHud.add(node);
            node.active = false;
        }
    }

    /** 把这次收起来的 HUD 全部还回去（引导层不显示 / 会话结束时）。 */
    private restoreDialogHud(): void {
        for (const node of this.hiddenHud) if (node.isValid) node.active = true;
        this.hiddenHud.clear();
    }

    /**
     * 这一步要收的 HUD：页面常驻子树、`Canvas` 上的 GM 入口，以及底部七格导航。
     *
     * `BottomNav` 由 `MainTabHost` 持有；焦点若落在某一格上，调用方的过滤器会把它留下。
     */
    private dialogHudNodes(): Node[] {
        const out: Node[] = [];
        const canvas = this.canvas;
        if (canvas?.isValid) {
            // GM 入口是 `Canvas` 的直接子节点（不在 tab 页里），但它也压在右上角那一片。
            const gm = canvas.getChildByName(GM_BUTTON_NODE);
            if (gm?.isValid) out.push(gm);
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
