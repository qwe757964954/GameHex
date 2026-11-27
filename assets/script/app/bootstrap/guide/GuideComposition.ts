import { instantiate, Prefab, type Node } from 'cc';
import { ControllerBase, type IControllerContext } from '../../../framework/controller/ControllerBase';
import { GuideController, type IGuideViewState } from '../../guide/application/GuideController';
import type { GuideStep } from '../../guide/model/GuideStepConfig';
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
import { GuideEvent, type GuideOutput, type IGuideCompletePayload } from '../../guide/application/GuideEvents';
import { GUIDE_TEXTS } from '../../guide/GuideTexts';
import { Toast } from '../../common/Toast';
import { MainTaskDetailPage } from '../../maintask/MainTaskDetailPage';
import { MainTaskEntry } from '../../maintask/MainTaskEntry';
import { TerritoryChestOpenPage } from '../../territory/view/TerritoryChestOpenPage';
import { TerritoryUiEvent } from '../../territory/application/TerritoryEvents';
import { HeroObtainPage } from '../../card/view/HeroObtainPage';
import type { MainTerritoryMap } from '../../main/MainTerritoryMap';
import { MainTopHudToggle } from '../../main/MainTopHudToggle';

const GUIDE_DIALOG_PREFAB = 'ui/Guide/GuideDialog';

/** 对话期间需隐藏的常驻 HUD（按节点名查找）。BottomNav 挂在 Canvas 上由 dialogHudNodes 单独处理。 */
const DIALOG_HIDDEN_HUD = ['TopHud', 'BottomHud', 'BeginGame'] as const;

/** 主界面 HUD 解锁步骤：该步完成后（5-4 -> 6-1）才允许显示常驻 HUD。 */
const HUD_UNLOCK_AFTER_STEP = '5-4';

/** 主线任务入口解锁步骤。 */
const TASK_ENTRY_UNLOCK_STEP = '8-1';

/**
 * 需等待奖励演出与弹窗全部结束才展示的步骤。
 * 该步仅在领地界面生效，避免切页后因缺失入口节点导致焦点遮罩阻断输入。
 */
const REWARD_HOLD_STEP = '8-1';

/** 奖励演出未触发或网络丢包时的等待兜底超时（毫秒）。 */
const REWARD_HOLD_FALLBACK_MS = 2600;

/** 引导完成提示文案（后端在完成最后一步时发奖，前端补提示）。 */
const GUIDE_FINISH_REWARD_TOAST = GUIDE_TEXTS.finishRewardTip;

/** 5-4 之前锁定的右上角入口整组节点。优先通过 MainTopHudToggle 锁定，无组件时按节点名隐藏。 */
const TOP_ENTRY_LOCKED_HUD = [
    'EntryBar', 'Friend', 'Mail', 'Rank', 'Invite', 'Arrow',
    'FriendLabel', 'MailLabel', 'RankLabel', 'InviteLabel',
] as const;

/** 5-4 之前锁定的其余主界面常驻节点（底栏与快速寻敌）。 */
const GUIDE_LOCKED_HUD = ['BottomHud', 'BeginGame'] as const;

/** 深度优先查找指定名称的子节点（含自身）。 */
function findChildByName(root: Node | null, name: string): Node | null {
    if (!root || !root.isValid) return null;
    if (root.name === name) return root;
    for (const child of root.children) {
        const hit = findChildByName(child, name);
        if (hit) return hit;
    }
    return null;
}

/** 检查 node 是否位于 ancestor 子树内（含自身）。 */
function isInsideNode(node: Node, ancestor: Node): boolean {
    for (let cur: Node | null = node; cur; cur = cur.parent) if (cur === ancestor) return true;
    return false;
}

/** 等待领地图首帧渲染就绪的超时上限（秒），防止地图加载失败阻断引导流程。 */
const MAP_PRESENTED_FALLBACK_SECONDS = 8;

/** 检查焦点是否属于战斗页面（战斗引导由对局独立处理）。 */
function isBattleFocus(focusNode: string): boolean {
    return focusNode.startsWith('Battle/') || focusNode.startsWith('BattleResult/');
}

/** 主界面与章节战斗复用同一装配逻辑，进度由 GuideController 和持久化仓储持有。 */
export class GuideComposition extends ControllerBase {
    private latestState: IGuideViewState | null = null;
    private canvas: Node | null = null;
    /** 本次引导过程中临时隐藏的 HUD 节点集合。 */
    private readonly hiddenHud = new Set<Node>();
    /** 领地图首帧是否已渲染完成（避免返回主界面时引导先于地图内容渲染）。 */
    private mapPresented = false;
    private view: GuideDialogView | null = null;
    private controller: GuideController | null = null;
    private chestPresenting = false;
    private readonly rewards = new Set<object>();
    private readonly cardDetails = new Set<CardUpgradePage>();
    private readonly chestPages = new Set<object>();
    private readonly heroPages = new Set<object>();
    /** 配置表步骤顺序，用于基于下标比较推进进度。 */
    private stepOrder: readonly string[] = [];
    /** 5-4 之后主界面常驻 HUD 是否已解锁。 */
    private hudUnlocked = false;
    /** 8-1 任务入口是否已解锁并完成首次刷新。 */
    private taskEntryUnlocked = false;
    /** 8-1 奖励演出等待状态机：放行后保持 released，避免台词重复播放。 */
    private rewardHold: 'idle' | 'armed' | 'released' = 'idle';
    private rewardHoldSawPlaying = false;
    private rewardHoldTimer: ReturnType<typeof setTimeout> | null = null;
    /** 受引导进度门控压制的节点集合，常规 HUD 恢复逻辑不得重新激活。 */
    private readonly gateHidden = new Set<Node>();
    /** 8-1 任务入口无配置兜底暂缓标记，待遮罩关闭后补开面板。 */
    private taskEntryFallbackPending = false;
    /** 单次 renderState 期间复用焦点解析节点，避免 syncDialogHud 重复遍历节点树。 */
    private renderFocusCacheKey: string | null = null;
    private renderFocusCacheNode: Node | null = null;
    private renderFocusCacheHit = false;
    constructor(private readonly context: IControllerContext, private readonly root: Node,
        private readonly phase: 'main' | 'battle', private readonly territoryView: MainTerritoryMap | null = null) {
        super(context, 'guide-composition');
        this.mapPresented = !this.territoryView;
        this.own(() => this.clearRewardHoldTimer());
        this.own(() => this.setTopHudEntriesLocked(false));
        this.listen(VIEW_LIFECYCLE, this.onViewLifecycle);
        this.listen(GuideEvent.Complete, this.onGuideComplete);
        this.listen(TerritoryUiEvent.ChestPresentation, this.onChestPresentation);
        this.listen(GuideEvent.Output, this.onGuideOutput);
        // 通过领地组件调度器执行首帧就绪兜底，随节点销毁自动取消
        this.territoryView?.scheduleOnce(() => this.markMapPresented(), MAP_PRESENTED_FALLBACK_SECONDS);
        void this.startGuide().catch(reportGuideFailure);
    }

    private async startGuide(): Promise<void> {
        const steps = await loadGuideSteps();
        if (this.isDisposed) return;
        if (steps.length === 0) {
            this.releaseMainTaskGateOnAbort();
            this.dispose();
            return;
        }
        this.stepOrder = steps.map(step => step.stepId);

        const view = await this.createGuideView();
        if (this.isDisposed) return;
        if (!view) {
            this.releaseMainTaskGateOnAbort();
            this.dispose();
            return;
        }

        const [{ groups }, frames] = await Promise.all([
            loadGuideDialog(),
            loadGuidePortraits(this.resources),
        ]);
        if (this.isDisposed) return;

        view.initialize(groups, frames);
        this.view = view;
        this.seedOpenedPopups();

        const controller = this.createController(steps);
        this.controller = controller;
        this.own(() => controller.dispose());
        if (!controller.start()) {
            this.releaseMainTaskGateOnAbort();
            this.dispose();
            return;
        }
        if (this.phase === 'battle') controller.notify('battleEntered');
        // 组合层异步加载完成后补报当前页面与卡牌选中状态
        else if (this.root?.isValid && this.root.getComponent(CardLineupPage)) controller.notify('pageOpened', 'card');
        const detail = PopupManager.inst.get(CardUpgradePage);
        if (detail?.guideCardId) controller.notify('cardSelected', detail.guideCardId);
    }

    private createController(steps: readonly GuideStep[]): GuideController {
        const { store, outbox } = createGuidePersistence();
        return new GuideController(this.context, {
            store,
            outbox,
            steps,
            gateway: new GameNetGuideGateway(),
        });
    }

    private seedOpenedPopups(): void {
        for (const popup of PopupManager.inst.openedPopups) {
            if (popup instanceof ShowRewardPage) this.rewards.add(popup);
            else if (popup instanceof CardUpgradePage) this.cardDetails.add(popup);
            else if (popup instanceof TerritoryChestOpenPage) this.chestPages.add(popup);
            else if (popup instanceof HeroObtainPage) this.heroPages.add(popup);
        }
    }

    private onGuideOutput(output: GuideOutput, source: object): void {
        if (this.isDisposed || source !== this.controller) return;
        if (output.kind === 'render') {
            this.renderState(output.state);
            // 8-1 完成时后端已发奖；由控制器在 Output 中明确确认完成步，不依赖监听器注册顺序。
            if (output.completedStepId === REWARD_HOLD_STEP) {
                Toast.show(GUIDE_FINISH_REWARD_TOAST);
            }
            return;
        }
        reportGuideFailure(output.error);
    }

    private onViewLifecycle({ phase }: IViewLifecycle, source: object): void {
        if (source === this.territoryView && phase === 'presented') {
            this.markMapPresented();
            return;
        }
        const changed = source instanceof CardUpgradePage ? this.updatePopupSet(this.cardDetails, phase, source)
            : source instanceof ShowRewardPage ? this.updatePopupSet(this.rewards, phase, source)
            : source instanceof TerritoryChestOpenPage ? this.updatePopupSet(this.chestPages, phase, source)
            : source instanceof HeroObtainPage ? this.updatePopupSet(this.heroPages, phase, source)
            : false;
        if (!changed) return;
        // 统一奖励弹窗接管演出窗口遮挡；弹窗关闭时由后续生命周期触发重新渲染
        if (source instanceof ShowRewardPage) this.chestPresenting = false;
        if (this.latestState) this.renderState(this.latestState);
    }

    private updatePopupSet<T>(set: Set<T>, phase: IViewLifecycle['phase'], item: T): boolean {
        if (phase === 'enabled') {
            set.add(item);
            return true;
        }
        if (phase === 'disabled' || phase === 'destroyed') {
            set.delete(item);
            return true;
        }
        return false;
    }

    private onGuideComplete(event: IGuideCompletePayload): void {
        if (event.cond === 'cardSelected' && this.latestState?.focusNode === 'CardDetail/BtnUpgrade') {
            this.renderState(this.latestState);
        }
    }

    private onChestPresentation(event: { readonly playing: boolean }): void {
        if (this.chestPresenting === event.playing) return;
        this.chestPresenting = event.playing;
        if (this.latestState) this.renderState(this.latestState);
    }

    private renderState(state: IGuideViewState): void {
        const view = this.view;
        if (!view || this.isDisposed) return;
        this.latestState = state;
        // 先行应用进度门控，确保弹窗或引导隐藏时不会误还原未解锁 HUD
        this.applyHudGate(state);
        const battleFocus = isBattleFocus(state.focusNode);
        const requiredCard = /^cardLevelUp:(\d+)$/.exec(state.completeCond)?.[1];
        const otherCard = Array.from(this.cardDetails).some(
            popup => state.focusNode !== 'CardDetail/BtnUpgrade' || popup.guideCardId !== requiredCard,
        );
        const waitingForMap = !state.finished && !!this.territoryView && !this.mapPresented;
        const rewardPopupOpen = this.hasRewardPopupOpen();
        const finishOffStage = !state.finished && !this.territoryView
            && this.stepDistance(state.stepId, REWARD_HOLD_STEP) === 0;
        if (finishOffStage) this.clearRewardHold();
        const holdForReward = !finishOffStage
            && this.syncRewardHold(state, this.chestPresenting, rewardPopupOpen);
        if (finishOffStage || rewardPopupOpen || this.chestPresenting || otherCard
            || waitingForMap || holdForReward
            || (!state.finished && battleFocus !== (this.phase === 'battle'))) {
            view.hide();
            this.setGuideCardScrollLocked(false);
            this.restoreDialogHud();
            return;
        }
        if (this.taskEntryFallbackPending) {
            this.taskEntryFallbackPending = false;
            if (!state.finished && this.stepDistance(state.stepId, REWARD_HOLD_STEP) === 0 && this.territoryView) {
                const entryNode = findChildByName(this.root, 'MainTaskEntry');
                if (!entryNode?.isValid || !entryNode.active) this.openTaskFallback();
            }
        }
        // 转换当前页面可见焦点（如从其它 tab 恢复或关闭详情回退），不污染原状态对象
        const effectiveFocus = this.resolveEffectiveFocusKey(state.focusNode, state.completeCond);
        const shown = effectiveFocus !== state.focusNode
            ? { ...state, focusNode: effectiveFocus } : state;
        this.renderFocusCacheKey = shown.focusNode;
        this.renderFocusCacheNode = null;
        this.renderFocusCacheHit = false;
        try {
            view.render(shown);
            // 聚焦在卡牌列表项时锁定滚动，防止滑动脱离高亮镂空
            this.setGuideCardScrollLocked(shown.focusNode.startsWith('CardList/'));
            this.syncDialogHud(shown, battleFocus);
        } finally {
            this.renderFocusCacheKey = null;
            this.renderFocusCacheNode = null;
            this.renderFocusCacheHit = false;
        }
    }
    /** 地图首帧就绪通知（幂等），更新状态并在已有状态时触发补画。 */
    private markMapPresented(): void {
        if (this.mapPresented || this.isDisposed) return;
        this.mapPresented = true;
        if (this.latestState) this.renderState(this.latestState);
    }

    private async createGuideView(): Promise<GuideDialogView | null> {
        let node: Node | null = null;
        try {
            const prefab = await this.resources.assets.load(GUIDE_DIALOG_PREFAB, Prefab, { scope: this.resources.scope });
            if (this.isDisposed) return null;
            if (!prefab) {
                console.warn('[GuideComposition] 引导 prefab 加载失败，本次不做引导');
                return null;
            }
            if (!this.root?.isValid || !this.root.scene) {
                console.warn('[GuideComposition] 引导宿主已脱离场景，本次不做引导');
                return null;
            }
            const canvas = this.root.scene.getChildByName('Canvas');
            if (!canvas?.isValid) {
                console.warn('[GuideComposition] 场景中找不到 Canvas，本次不做引导');
                return null;
            }
            node = instantiate(prefab);
            node.active = false;
            const view = node.getComponent(GuideDialogView);
            if (!view) {
                console.warn('[GuideComposition] 引导 prefab 上缺少 GuideDialogView');
                node.destroy();
                return null;
            }
            // 引导层挂载于 Canvas（低于 GMButton），确保覆盖导航栏与全局弹窗
            this.mountGuideNode(canvas, node);
            this.canvas = canvas;
            const mountedNode = node;
            this.own(() => mountedNode.destroy());
            this.own(() => this.restoreDialogHud());
            this.own(() => this.setGuideCardScrollLocked(false));
            view.setFocusProvider(key => this.resolveFocusTarget(key));
            return view;
        } catch (error) {
            if (node?.isValid) node.destroy();
            reportGuideFailure(error);
            return null;
        }
    }

    private mountGuideNode(canvas: Node, node: Node): void {
        const gmButton = canvas.getChildByName?.('GMButton') ?? null;
        const gmIndex = gmButton && Array.isArray(canvas.children) ? canvas.children.indexOf(gmButton) : -1;
        if (gmIndex >= 0 && typeof canvas.insertChild === 'function') {
            canvas.insertChild(node, gmIndex);
            return;
        }
        canvas.addChild(node);
    }

    private resolveEffectiveFocusKey(key: string, completeCond: string): string {
        if (key.startsWith('Map/') && !this.territoryView) return 'Main/TerritoryEntry';
        // 详情关闭或重登恢复时，依次定向至英雄页签或目标卡
        if ((key.startsWith('CardList/') || key === 'CardDetail/BtnUpgrade') && !PopupManager.inst.get(CardUpgradePage)) {
            if (!this.root?.isValid || !this.root.getComponent(CardLineupPage)) return 'Main/CardEntry';
            if (key === 'CardDetail/BtnUpgrade') {
                const cardId = /^cardLevelUp:(\d+)$/.exec(completeCond)?.[1];
                if (cardId) return `CardList/Card_${cardId}`;
            }
        }
        return key;
    }

    /** 将焦点标识解析为真实节点与形状，并缓存单次渲染的焦点节点。 */
    private resolveFocusTarget(key: string): IGuideFocusTarget | null {
        const requestedKey = key;
        key = this.resolveEffectiveFocusKey(key, this.latestState?.completeCond ?? '');
        const resolved = this.lookupFocusTarget(key);
        if (this.renderFocusCacheKey !== null && requestedKey === this.renderFocusCacheKey) {
            this.renderFocusCacheNode = resolved?.node ?? null;
            this.renderFocusCacheHit = true;
        }
        return resolved;
    }

    private lookupFocusTarget(key: string): IGuideFocusTarget | null {
        if (key === 'Main/CardEntry' || key === 'Main/TerritoryEntry') {
            const tab = this.canvas?.isValid ? this.canvas.getComponentInChildren(MainTabHost)?.getGuideTabNode(
                key === 'Main/TerritoryEntry' ? MainTab.Territory : MainTab.Hero) : null;
            return tab ? { node: tab, shape: 'rect' } : null;
        }
        if (key === 'Main/TaskEntry') {
            // 任务入口显隐由快照驱动，按节点名动态查找
            const entry = findChildByName(this.root, 'MainTaskEntry');
            return entry?.isValid ? { node: entry, shape: 'rect' } : null;
        }
        const mapNode = this.territoryView?.getGuideFocusNode(key) ?? null;
        if (mapNode) {
            // 地块及编号气泡组合高亮（气泡挂在独立层级，合并计算包围盒）
            return { node: mapNode, shape: 'hex', extra: this.territoryView?.getGuideFocusExtraNodes(key) ?? [] };
        }
        const canvas = this.canvas;
        if (!canvas?.isValid) return null;
        const card = /^CardList\/Card_(\d+)$/.exec(key);
        if (card && this.root?.isValid) this.root.getComponent(CardLineupPage)?.revealGuideCard(card[1]);
        let anchor: GuideFocusAnchor | null = null;
        for (const item of canvas.getComponentsInChildren(GuideFocusAnchor)) {
            if (item.key === key && item.node.activeInHierarchy && (!anchor || item.shownAt > anchor.shownAt)) anchor = item;
        }
        return anchor ? { node: anchor.node, shape: 'rect' } : null;
    }

    /** 引导进行期间隐藏常驻 HUD 及底部导航栏（焦点所在宿主节点除外）。 */
    private syncDialogHud(state: IGuideViewState, battleFocus: boolean): void {
        const guiding = !!state.dialogId || !!state.focusNode;
        if (this.phase !== 'main' || state.finished || battleFocus || !guiding) {
            this.restoreDialogHud();
            return;
        }
        const focus = this.renderFocusCacheHit && this.renderFocusCacheKey === state.focusNode
            ? this.renderFocusCacheNode
            : (this.resolveFocusTarget(state.focusNode)?.node ?? null);
        // 焦点位于主导航（如 6-1 英雄格）时保留底栏，避免切页初帧锚点未就绪被误隐藏
        const navBar = this.canvas?.isValid
            ? this.canvas.getComponentInChildren(MainTabHost)?.navBar ?? null : null;
        const keepNav = state.focusNode.startsWith('Main/') && !!navBar?.isValid;
        // 焦点为任务入口时保留 BottomHud，避免入口初次异步刷新就绪前被连带收起
        const keepTaskEntryHost = state.focusNode === 'Main/TaskEntry';
        const targets = this.dialogHudNodes().filter(node => {
            if (keepNav && node === navBar) return false;
            if (keepTaskEntryHost && node.name === 'BottomHud') return false;
            return !focus || !isInsideNode(focus, node);
        });
        // 恢复不在隐藏目标中的节点（受进度门控压制的节点除外）
        for (const node of Array.from(this.hiddenHud)) {
            if (!node.isValid) { this.hiddenHud.delete(node); continue; }
            if (targets.includes(node)) continue;
            this.hiddenHud.delete(node);
            if (this.gateHidden.has(node)) continue;
            node.active = true;
        }
        for (const node of targets) {
            if (!node.isValid || !node.active) continue;
            this.hiddenHud.add(node);
            node.active = false;
        }
    }

    /** 设置卡牌列表滚动锁定状态。 */
    private setGuideCardScrollLocked(locked: boolean): void {
        if (!this.root?.isValid) return;
        this.root.getComponent(CardLineupPage)?.setGuideScrollLocked(locked);
    }

    /** 恢复当前收起的 HUD 节点（受进度门控压制的节点保持隐藏）。 */
    private restoreDialogHud(): void {
        for (const node of this.hiddenHud) {
            if (!node.isValid) continue;
            node.active = !this.gateHidden.has(node);
        }
        this.hiddenHud.clear();
    }

    /**
     * 主界面常驻 HUD 进度门控：
     * - 5-4 完成前锁定右上角入口排、底栏、导航栏与快速寻敌；
     * - 8-1 到达前单独隐藏主线任务入口。
     */
    private applyHudGate(state: IGuideViewState): void {
        if (this.phase !== 'main') return;
        const unlocked = state.finished || this.passedStep(state.stepId, HUD_UNLOCK_AFTER_STEP);
        if (unlocked !== this.hudUnlocked) {
            this.hudUnlocked = unlocked;
            if (unlocked) {
                for (const node of this.gateHidden) if (node.isValid) node.active = true;
                this.gateHidden.clear();
                this.setTopHudEntriesLocked(false);
            }
        }
        if (!unlocked) {
            this.setTopHudEntriesLocked(true);
            for (const node of this.guideLockedHudNodes()) {
                if (!node.isValid || !node.active) continue;
                this.gateHidden.add(node);
                node.active = false;
            }
        }
        const allowTaskFallback = !state.finished
            && this.stepDistance(state.stepId, REWARD_HOLD_STEP) === 0
            && !!this.territoryView;
        this.applyTaskEntryGate(
            state.finished || this.reachedStep(state.stepId, TASK_ENTRY_UNLOCK_STEP),
            allowTaskFallback,
        );
    }

    /** 控制任务入口显隐；在 8-1 领地页若因无配置等原因无法显示图标，退回代开面板兜底。 */
    private applyTaskEntryGate(unlocked: boolean, allowFallback: boolean): void {
        const node = findChildByName(this.root, 'MainTaskEntry');
        MainTaskEntry.guideUnlocked = unlocked;
        if (!unlocked) {
            this.taskEntryUnlocked = false;
            this.taskEntryFallbackPending = false;
            if (node?.isValid && node.active) node.active = false;
            return;
        }
        if (!allowFallback) {
            this.taskEntryFallbackPending = false;
            if (!this.taskEntryUnlocked) {
                this.taskEntryUnlocked = true;
                if (node?.isValid) void node.getComponent(MainTaskEntry)?.refresh();
            }
            return;
        }
        if (this.taskEntryUnlocked) return;
        this.taskEntryUnlocked = true;
        if (!node?.isValid) return;
        // 预先激活节点供焦点定位，待异步 refresh 校验真实快照
        if (!node.active) node.active = true;
        void Promise.resolve(node.getComponent(MainTaskEntry)?.refresh()).then(() => {
            if (this.isDisposed || !node.isValid || node.active) return;
            if (!this.latestState || this.latestState.finished
                || this.stepDistance(this.latestState.stepId, REWARD_HOLD_STEP) !== 0
                || !this.territoryView) return;
            if (this.chestPresenting || this.hasRewardPopupOpen()) {
                this.taskEntryFallbackPending = true;
                return;
            }
            this.openTaskFallback();
        });
    }

    private hasRewardPopupOpen(): boolean {
        return this.rewards.size > 0 || this.chestPages.size > 0 || this.heroPages.size > 0;
    }

    private openTaskFallback(): void {
        console.warn('[GuideComposition] 8-1 任务入口不可见（无任务配置），改由引导代开主线面板');
        void MainTaskDetailPage.open({});
    }

    private releaseMainTaskGateOnAbort(): void {
        if (this.phase === 'main' && !this.isDisposed) {
            MainTaskEntry.guideUnlocked = true;
        }
    }

    /** 通知 TopHud 折叠组件锁定或恢复右上角入口，防止重激活时被写回可见。 */
    private setTopHudEntriesLocked(locked: boolean): boolean {
        const topHud = findChildByName(this.root, 'TopHud');
        const toggle = topHud?.getComponent?.(MainTopHudToggle) ?? null;
        if (!toggle) return false;
        toggle.setGuideLocked(locked);
        return true;
    }

    /**
     * 同步 8-1 奖励等待门控：
     * 等待粒子演出（presenting）与奖励弹窗（popupOpen）全部结束后才放行；
     * 演出期间清除超时计时器，避免弹窗停留时超时强行放行遮挡视图。
     *
     * @param presenting 宝箱与地块动画演出窗口是否处于播放中
     * @param popupOpen 是否存在打开中的奖励或获得弹窗
     * @returns 是否继续阻断该步骤展示
     */
    private syncRewardHold(state: IGuideViewState, presenting: boolean, popupOpen: boolean): boolean {
        if (this.rewardHold === 'released') return false;
        if (state.finished || this.stepDistance(state.stepId, REWARD_HOLD_STEP) !== 0) {
            this.clearRewardHold();
            return false;
        }
        const busy = presenting || popupOpen;
        if (this.rewardHold === 'idle') {
            this.rewardHold = 'armed';
            this.rewardHoldSawPlaying = busy;
            if (busy) return true;
            this.armRewardHoldTimer();
            return true;
        }
        if (busy) {
            this.rewardHoldSawPlaying = true;
            this.clearRewardHoldTimer();
            return true;
        }
        if (!this.rewardHoldSawPlaying) {
            if (this.rewardHoldTimer === null) this.armRewardHoldTimer();
            return true;
        }
        this.rewardHold = 'released';
        this.clearRewardHoldTimer();
        return false;
    }

    /** 启动奖励等待超时计时器，超时后强制放行避免流程卡住。 */
    private armRewardHoldTimer(): void {
        this.clearRewardHoldTimer();
        this.rewardHoldTimer = setTimeout(() => {
            this.rewardHoldTimer = null;
            this.rewardHold = 'released';
            if (this.latestState) this.renderState(this.latestState);
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

    /** 获取 5-4 之前锁定的主界面 HUD 节点列表（GMButton 调试节点除外）。 */
    private guideLockedHudNodes(): Node[] {
        const out: Node[] = [];
        const hasToggle = !!findChildByName(this.root, 'TopHud')?.getComponent?.(MainTopHudToggle);
        if (!hasToggle) {
            for (const name of TOP_ENTRY_LOCKED_HUD) {
                const node = findChildByName(this.root, name);
                if (node?.isValid) out.push(node);
            }
        }
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

    /** 检查当前步骤是否严格超过目标步骤（目标步骤进行中不算走过）。 */
    private passedStep(stepId: string, target: string): boolean {
        return this.stepDistance(stepId, target) > 0;
    }

    /** 检查当前步骤是否已到达或超过目标步骤。 */
    private reachedStep(stepId: string, target: string): boolean {
        return this.stepDistance(stepId, target) >= 0;
    }

    /** 计算当前步骤相对目标步骤的下标距离（未知步骤或结束态默认视为已通过）。 */
    private stepDistance(stepId: string, target: string): number {
        const order = this.stepOrder;
        const want = order.indexOf(target);
        if (want < 0) return 1;
        const at = order.indexOf(stepId);
        if (at < 0) return 1;
        return at - want;
    }

    /** 获取对话期间需收起的 HUD 节点集合（包含底部导航，排除常驻 GM 调试入口）。 */
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

    dispose(): void {
        if (this.isDisposed) return;
        this.releaseInputs();
        this.controller = null;
        this.view = null;
        this.latestState = null;
        this.canvas = null;
        this.stepOrder = [];
        this.taskEntryFallbackPending = false;
        this.gateHidden.clear();
        this.rewards.clear();
        this.cardDetails.clear();
        this.chestPages.clear();
        this.heroPages.clear();
        super.dispose();
    }
}
function reportGuideFailure(error: unknown): void {
    console.warn('[GuideComposition]', error);
}
