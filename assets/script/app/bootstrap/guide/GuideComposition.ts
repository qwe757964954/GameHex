import { instantiate, Prefab, type Node } from 'cc';
import { ControllerBase, type IControllerContext } from '../../../framework/controller/ControllerBase';
import { GuideController, type IGuideViewState } from '../../guide/application/GuideController';
import { VIEW_LIFECYCLE, type IViewLifecycle } from '../../../framework/ui/ViewLifecycle';
import { PopupManager } from '../../../framework/ui/PopupManager';
import { ShowRewardPage } from '../../showReward/ShowRewardPage';
import { loadGuideDialog, loadGuidePortraits, loadGuideSteps } from '../../guide/application/GuideLoader';
import { createGuideSaveStore } from '../../guide/application/GuideStorageAdapter';
import { GameNetGuideGateway } from '../../guide/application/GuideGateway';
import { GuideDialogView } from '../../guide/ui/GuideDialogView';
import { GuideFocusAnchor } from '../../guide/ui/GuideFocusAnchor';
import { MainTab, MainTabHost } from '../../main/MainTabHost';
import { CardLineupPage } from '../../card/CardLineupPage';
import { CardUpgradePage } from '../../card/CardUpgradePage';
import { GuideEvent, type IGuideCompletePayload } from '../../guide/application/GuideEvents';
import { MainTaskDetailPage } from '../../maintask/MainTaskDetailPage';
import type { MainTerritoryMap } from '../../main/MainTerritoryMap';
import { FW } from '../../../framework/FW';

const GUIDE_DIALOG_PREFAB = 'ui/Guide/GuideDialog';

/** 主界面与章节战斗复用同一装配逻辑，进度继续由 GuideController 和存档持有。 */
export class GuideComposition extends ControllerBase {
    private latestState: IGuideViewState | null = null;
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
        let ownsMainGoal = false;
        let mainGoal: MainTaskDetailPage | null = null;
        this.own(() => {
            if (ownsMainGoal && (!mainGoal || PopupManager.inst.get(MainTaskDetailPage) === mainGoal)) {
                PopupManager.inst.closeByClass(MainTaskDetailPage);
            }
        });
        const render = (state: IGuideViewState): void => {
            this.latestState = state;
            const battleFocus = state.focusNode.startsWith('Battle/') || state.focusNode.startsWith('BattleResult/');
            const requiredCard = /^cardLevelUp:(\d+)$/.exec(state.completeCond)?.[1];
            const otherCard = [...cardDetails].some(popup => state.focusNode !== 'CardDetail/BtnUpgrade' || popup.guideCardId !== requiredCard);
            if (rewards.size > 0 || otherCard || (!state.finished && battleFocus !== (this.phase === 'battle'))) view.hide();
            else {
                view.render(state);
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
            const popups: Set<object> | null = owner instanceof ShowRewardPage ? rewards : owner instanceof CardUpgradePage ? cardDetails : null;
            if (!popups) return;
            if (phase === 'enabled') popups.add(owner);
            else if (phase === 'disabled' || phase === 'destroyed') popups.delete(owner);
            else return;
            if (this.latestState) render(this.latestState);
        });
        this.listen(GuideEvent.Complete, (event: IGuideCompletePayload) => {
            if (event.cond === 'cardSelected' && this.latestState) render(this.latestState);
        });

        const controller = new GuideController(this.context, {
            store: createGuideSaveStore(),
            steps,
            gateway: new GameNetGuideGateway(),
            view: { owner: view, render },
            // 引导奖励出口。
            // ⚠️ 客户端**没有本地发奖通道**：钱包与背包都是服务端权威（`refreshWalletFromServer`），
            //    GM 的 addItem 也是走 `RequestSystemGm` 发到服务器。所以这里只能用通用奖励弹窗
            //    把「应得」展示出来，并留一条 warn 标明尚未入账 —— 真入账需要一条
            //    「引导奖励领取」协议（`client_proto` 里目前没有）。
            //    进度侧不受影响：`grantedSteps` 已经记账，协议补齐后可用 stepId 幂等补发。
            grant: (rewards, stepId) => {
                FW.ShowReward(rewards.map((reward) => ({
                    resId: reward.resId,
                    number: reward.number,
                })) as unknown as CmdGoods[]);
                console.warn(`[Guide] 步骤 ${stepId} 的 ${rewards.length} 项奖励已展示，但尚未入账（缺引导奖励协议）`);
            },
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
            this.own(() => node.destroy());
            const view = node.getComponent(GuideDialogView);
            if (view) {
                view.setFocusProvider(key => {
                    // 详情被误关或重登恢复时，依次找回英雄页、目标卡、升级按钮。
                    if ((key.startsWith('CardList/') || key === 'CardDetail/BtnUpgrade') && !PopupManager.inst.get(CardUpgradePage)) {
                        if (!this.root.getComponent(CardLineupPage)) key = 'Main/CardEntry';
                        else if (key === 'CardDetail/BtnUpgrade') {
                            const cardId = /^cardLevelUp:(\d+)$/.exec(this.latestState?.completeCond ?? '')?.[1];
                            if (cardId) key = `CardList/Card_${cardId}`;
                        }
                    }
                    if (key === 'Main/CardEntry') {
                        const tab = canvas.getComponentInChildren(MainTabHost)?.getGuideTabNode(MainTab.Hero);
                        return tab ? { node: tab, shape: 'rect' } : null;
                    }
                    const mapNode = this.territoryView?.getGuideFocusNode(key) ?? null;
                    if (mapNode) return { node: mapNode, shape: 'hex' };
                    const card = /^CardList\/Card_(\d+)$/.exec(key);
                    if (card) this.root.getComponent(CardLineupPage)?.revealGuideCard(card[1]);
                    let anchor: GuideFocusAnchor | null = null;
                    for (const item of canvas.getComponentsInChildren(GuideFocusAnchor)) {
                        if (item.key === key && item.node.activeInHierarchy && (!anchor || item.shownAt > anchor.shownAt)) anchor = item;
                    }
                    return anchor ? { node: anchor.node, shape: 'rect' } : null;
                });
            }
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
}
function reportGuideFailure(error: unknown): void { console.warn('[GuideComposition]', error); }
