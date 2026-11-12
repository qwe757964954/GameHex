import type { IControllerContext, ControllerBase } from '../../../framework/controller/ControllerBase';
import type { IPopupComposition } from '../../../framework/ui/PopupCompositionHost';
import type { PopupBase } from '../../../framework/ui/PopupBase';
import { CardUpgradePage } from '../../card/CardUpgradePage';
import { CardUpgradeModel } from '../../card/CardUpgradeModel';
import { CardUpgradeController } from '../../card/CardUpgradeController';
import { LineupBoardPage } from '../../card/LineupBoardPage';
import { LineupBoardModel } from '../../card/LineupBoardModel';
import { LineupBoardController } from '../../card/LineupBoardController';
import { cardRepository } from '../../card/CardRepository';
import type { ICardUpgradeOpenData, ICardSkillOpenData } from '../../card/CardPresentations';
import { CardSkillPage } from '../../card/CardSkillPage';
import { CardSkillController } from '../../card/CardSkillController';
import { GameNet } from '../../net/GameNet';
import { LoadingPopup } from '../../common/LoadingPopup';
import { Toast } from '../../common/Toast';
import { CARD_LINEUP_TEXTS } from '../../card/CardLineupTexts';

/** PopupManager owns this session; pages only expose rendering and serialized configuration. */
class CardPopupComposition implements IPopupComposition {
    private controller: ControllerBase | null = null;
    constructor(private readonly context: IControllerContext, private readonly view: CardUpgradePage | LineupBoardPage | CardSkillPage) {}
    async open(userData: unknown): Promise<void> {
        if (this.controller) throw new Error('卡牌会话不可重复启动');
        const controller = this.createController(userData);
        this.controller = controller;
        try { await controller.start(); }
        catch (error) {
            try { this.dispose(); }
            catch (cleanupError) { console.error('[CardPopupComposition] 初始化失败后的清理失败', cleanupError); }
            throw error;
        }
    }
    private createController(userData: unknown): CardUpgradeController | LineupBoardController | CardSkillController {
        const view = this.view;
        if (view instanceof CardUpgradePage) return this.createUpgradeController(view, userData as ICardUpgradeOpenData);
        if (view instanceof LineupBoardPage) return this.createBoardController(view);
        return this.createSkillController(view, userData as ICardSkillOpenData);
    }
    private createUpgradeController(view: CardUpgradePage, userData: ICardUpgradeOpenData): CardUpgradeController {
        const model = new CardUpgradeModel(userData);
        return new CardUpgradeController(this.context, {
            owner: view,
            model,
            repository: cardRepository,
            failed: reportCardPopupFailure,
            view: {
                render: state => view.render(state),
            },
            loading: {
                beginLoading: () => {
                    LoadingPopup.show(model.snapshot.level === 0 ? CARD_LINEUP_TEXTS.upgradeUnlocking : CARD_LINEUP_TEXTS.upgradeSending);
                    return () => LoadingPopup.hide();
                }
            },
            requests: {
                removeCaller: removeCardPopupCaller
            },
            popups: {
                openSkills: data => { void CardSkillPage.open({ userData: data }).catch(reportCardPopupFailure); },
            },
        });
    }
    private createBoardController(view: LineupBoardPage): LineupBoardController {
        return new LineupBoardController(this.context, {
            owner: view,
            model: new LineupBoardModel(view.presetBar.children.length, view.defaultPreset),
            repository: cardRepository,
            autoLoadDecks: view.autoLoadDecks,
            closeAfterSave: view.closeAfterSave,
            failed: reportCardPopupFailure,
            view: {
                render: state => view.render(state),
                close: () => view.close()
            },
            feedback: {
                tip: text => Toast.show(text)
            },
            requests: {
                removeCaller: removeCardPopupCaller
            },
        });
    }
    private createSkillController(view: CardSkillPage, data: ICardSkillOpenData): CardSkillController {
        return new CardSkillController(this.context, {
            owner: view,
            data,
            repository: cardRepository,
            view: {
                render: state => view.render(state),
                close: () => view.close(),
                notify: kind => view.notify(kind),
            },
            requests: { removeCaller: removeCardPopupCaller },
            failed: reportCardPopupFailure,
        });
    }
    dispose(): void {
        const controller = this.controller;
        this.controller = null;
        controller?.dispose();
    }
}

export function createCardPopupComposition(context: IControllerContext, view: PopupBase): IPopupComposition | null {
    return view instanceof CardUpgradePage || view instanceof LineupBoardPage || view instanceof CardSkillPage
        ? new CardPopupComposition(context, view)
        : null;
}

function reportCardPopupFailure(error: unknown): void { console.error('[CardPopupComposition] 卡牌会话失败', error); }
function removeCardPopupCaller(caller: object): void { GameNet.instance.removeCaller(caller); }
