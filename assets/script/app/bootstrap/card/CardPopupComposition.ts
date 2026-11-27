import type { IControllerContext } from '../../../framework/controller/ControllerBase';
import { PopupSession, type IPopupComposition } from '../../../framework/ui/PopupCompositionHost';
import type { PopupBase } from '../../../framework/ui/PopupBase';
import { CardUpgradePage } from '../../card/CardUpgradePage';
import { CardUpgradeModel } from '../../card/CardUpgradeModel';
import { CardUpgradeController } from '../../card/CardUpgradeController';
import {
    CardPopupEvent,
    type CardSkillOutput,
    type CardUpgradeOutput,
    type LineupBoardOutput,
} from '../../card/CardPopupEvents';
import { CardUpgradedPage } from '../../card/CardUpgradedPage';
import { loadCardUpgradedArt } from '../../card/CardUpgradedArt';
import { LineupBoardPage } from '../../card/LineupBoardPage';
import { LineupBoardModel } from '../../card/LineupBoardModel';
import { LineupBoardController } from '../../card/LineupBoardController';
import { cardRepository } from '../../card/CardRepository';
import type { ICardUpgradeOpenData, ICardSkillOpenData } from '../../card/CardPresentations';
import { CardSkillPage } from '../../card/CardSkillPage';
import { CardSkillController } from '../../card/CardSkillController';
import { LoadingPopup } from '../../common/LoadingPopup';
import { Toast } from '../../common/Toast';
import { CARD_LINEUP_TEXTS } from '../../card/CardLineupTexts';
import { reportGuideComplete } from '../../guide/application/GuideEvents';

class CardUpgradeSession extends PopupSession<CardUpgradePage, CardUpgradeController, CardUpgradeOutput> {
    private selectedCardId = '';
    private showingUpgradeLoading = false;

    constructor(context: IControllerContext, view: CardUpgradePage) {
        super(context, view, CardPopupEvent.UpgradeOutput);
    }

    protected createController(userData: unknown): CardUpgradeController {
        return new CardUpgradeController(this.context, {
            model: new CardUpgradeModel(userData as ICardUpgradeOpenData),
            repository: cardRepository,
            loadUpgradedArt: loadCardUpgradedArt.bind(null, this.context.assets),
        });
    }

    protected handleOutput(output: CardUpgradeOutput): void {
        switch (output.kind) {
            case 'render': {
                const { state } = output;
                this.view.render(state);
                // 合并打开请求时，仅对实际渲染且就绪的卡牌上报选卡。
                if (state.phase === 'ready' && state.cardId !== this.selectedCardId) {
                    this.selectedCardId = state.cardId;
                    reportGuideComplete('cardSelected', state.cardId);
                }
                break;
            }
            case 'loading':
                if (output.level === null) {
                    this.hideUpgradeLoading();
                } else if (!this.showingUpgradeLoading) {
                    this.showingUpgradeLoading = true;
                    LoadingPopup.show(output.level === 0 ? CARD_LINEUP_TEXTS.upgradeUnlocking : CARD_LINEUP_TEXTS.upgradeSending);
                }
                break;
            case 'failed':
                reportCardPopupFailure(output.error);
                break;
            case 'openSkills':
                void CardSkillPage.open({ userData: output.data }).catch(reportCardPopupFailure);
                break;
            case 'openUpgraded':
                void CardUpgradedPage.open({ userData: output.data }).catch(reportCardPopupFailure);
                break;
        }
    }

    protected onDispose(): void {
        this.selectedCardId = '';
        this.hideUpgradeLoading();
    }

    private hideUpgradeLoading(): void {
        if (!this.showingUpgradeLoading) {
            return;
        }
        this.showingUpgradeLoading = false;
        LoadingPopup.hide();
    }
}

class LineupBoardSession extends PopupSession<LineupBoardPage, LineupBoardController, LineupBoardOutput> {
    constructor(context: IControllerContext, view: LineupBoardPage) {
        super(context, view, CardPopupEvent.BoardOutput);
    }

    protected createController(): LineupBoardController {
        return new LineupBoardController(this.context, {
            model: new LineupBoardModel(this.view.presetBar.children.length, this.view.defaultPreset),
            repository: cardRepository,
            autoLoadDecks: this.view.autoLoadDecks,
            closeAfterSave: this.view.closeAfterSave,
        });
    }

    protected handleOutput(output: LineupBoardOutput): void {
        switch (output.kind) {
            case 'render':
                void Promise.resolve(this.view.render(output.state)).catch(reportCardPopupFailure);
                break;
            case 'tip':
                Toast.show(output.text);
                break;
            case 'close':
                this.view.close();
                break;
            case 'failed':
                reportCardPopupFailure(output.error);
                break;
        }
    }
}

class CardSkillSession extends PopupSession<CardSkillPage, CardSkillController, CardSkillOutput> {
    constructor(context: IControllerContext, view: CardSkillPage) {
        super(context, view, CardPopupEvent.SkillOutput);
    }

    protected createController(userData: unknown): CardSkillController {
        return this.createSkillController(this.view, userData as ICardSkillOpenData);
    }

    private createSkillController(view: CardSkillPage, data: ICardSkillOpenData): CardSkillController {
        return new CardSkillController(this.context, {
            data,
            repository: cardRepository,
        });
    }

    protected handleOutput(output: CardSkillOutput): void {
        switch (output.kind) {
            case 'render':
                this.view.render(output.state);
                break;
            case 'notify':
                Toast.show(output.status === 'offline' ? CARD_LINEUP_TEXTS.skillUpgradeOffline : CARD_LINEUP_TEXTS.skillUpgradeFailed);
                break;
            case 'close':
                this.view.close();
                break;
            case 'failed':
                reportCardPopupFailure(output.error);
                break;
        }
    }
}

export function createCardPopupComposition(context: IControllerContext, view: PopupBase): IPopupComposition | null {
    if (view instanceof CardUpgradePage) {
        return new CardUpgradeSession(context, view);
    }
    if (view instanceof LineupBoardPage) {
        return new LineupBoardSession(context, view);
    }
    if (view instanceof CardSkillPage) {
        return new CardSkillSession(context, view);
    }
    return null;
}

function reportCardPopupFailure(error: unknown): void {
    console.error('[CardPopupComposition] 卡牌会话失败', error);
}
