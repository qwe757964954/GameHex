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
import type { ICardUpgradeOpenData } from '../../card/CardPresentations';
import { CardSkillPage } from '../../card/CardSkillPage';
import { GameNet } from '../../net/GameNet';
import { LoadingPopup } from '../../common/LoadingPopup';
import { Toast } from '../../common/Toast';
import { CARD_LINEUP_TEXTS } from '../../card/CardLineupTexts';

function upgradeData(value: unknown): ICardUpgradeOpenData {
    if (!value || typeof value !== 'object' || !('cardId' in value) || !('level' in value) || !('card' in value)) {
        throw new Error('卡牌升级缺少入口数据');
    }
    const cardId = String(value.cardId);
    const level = Number(value.level);
    const card = value.card;
    if (!cardId || !Number.isSafeInteger(level) || level < 0 ||
        (card !== null && (typeof card !== 'object' || !('id' in card) || String(card.id) !== cardId || !('name' in card)))) {
        throw new Error('卡牌升级入口数据无效');
    }
    return { cardId, level, card: card as ICardUpgradeOpenData['card'] };
}

/** PopupManager owns this session; pages only expose rendering and serialized configuration. */
class CardPopupComposition implements IPopupComposition {
    private controller: ControllerBase | null = null;
    constructor(private readonly context: IControllerContext, private readonly view: CardUpgradePage | LineupBoardPage) {}
    async open(userData: unknown): Promise<void> {
        const view = this.view;
        const failed = (error: unknown): void => { console.error('[CardPopupComposition] 卡牌会话失败', error); };
        const removeCaller = (caller: object): void => GameNet.instance.removeCaller(caller);
        if (view instanceof CardUpgradePage) {
            const model = new CardUpgradeModel(upgradeData(userData));
            const controller = new CardUpgradeController(this.context, {
                owner: view, model, repository: cardRepository, render: state => view.render(state), removeCaller, failed,
                close: () => view.close(),
                openSkills: data => { void CardSkillPage.open({ userData: data }).catch(failed); },
                beginLoading: () => {
                    LoadingPopup.show(model.snapshot.level === 0 ? CARD_LINEUP_TEXTS.upgradeUnlocking : CARD_LINEUP_TEXTS.upgradeSending);
                    return () => LoadingPopup.hide();
                },
            });
            this.controller = controller;
            await controller.start();
        } else {
            const controller = new LineupBoardController(this.context, {
                owner: view, model: new LineupBoardModel(view.presetBar.children.length, view.defaultPreset),
                repository: cardRepository, autoLoadDecks: view.autoLoadDecks, closeAfterSave: view.closeAfterSave,
                render: state => view.render(state), tip: text => Toast.show(text), removeCaller, failed,
                close: () => view.close(),
            });
            this.controller = controller;
            await controller.start();
        }
    }
    dispose(): void { this.controller?.dispose(); this.controller = null; }
}

export function createCardPopupComposition(context: IControllerContext, view: PopupBase): IPopupComposition | null {
    return view instanceof CardUpgradePage || view instanceof LineupBoardPage ? new CardPopupComposition(context, view) : null;
}
