import type { IControllerContext } from '../../framework/controller/ControllerBase';
import type { PopupBase } from '../../framework/ui/PopupBase';
import { PopupSession, type IPopupComposition } from '../../framework/ui/PopupCompositionHost';
import { FW } from '../../framework/FW';
import { LeagueEditPage } from '../league/LeagueEditPage';
import { LeagueEditModel, type ILeagueEditParams } from '../league/LeagueEditModel';
import { LeagueEditController } from '../league/LeagueEditController';
import { LeagueEditEvent, type LeagueEditOutput } from '../league/LeagueEditEvents';
import { leagueRepository } from '../league/LeagueRepository';
import { LeagueRewardController } from '../league/LeagueRewardController';
import { LeagueRewardEvent, type LeagueRewardOutput } from '../league/LeagueRewardEvents';
import { LeagueStorePage } from '../league/LeagueStorePage';
import { LeagueDiscountPage } from '../league/LeagueDiscountPage';
import { LeagueTaskPage } from '../league/LeagueTaskPage';
import { LeagueNorthRewardPage } from '../league/LeagueNorthRewardPage';
import { LeagueNorthExpeditionPage } from '../league/LeagueNorthExpeditionPage';

class LeaguePopupComposition extends PopupSession<LeagueEditPage, LeagueEditController, LeagueEditOutput> {
    constructor(context: IControllerContext, view: LeagueEditPage) {
        super(context, view, LeagueEditEvent.Output);
    }

    protected createController(userData: unknown): LeagueEditController {
        return new LeagueEditController(this.context, {
            model: new LeagueEditModel(userData as ILeagueEditParams | undefined),
            repository: leagueRepository,
        });
    }

    protected handleOutput(output: LeagueEditOutput): void {
        switch (output.kind) {
            case 'render':
                this.view.render(output.state);
                break;
            case 'close':
                this.view.closeByButton();
                break;
            case 'tip':
                FW.showTip(output.text);
                break;
        }
    }
}

class LeagueRewardPopupComposition extends PopupSession<PopupBase, LeagueRewardController, LeagueRewardOutput> {
    constructor(context: IControllerContext, view: PopupBase) {
        super(context, view, LeagueRewardEvent.Output);
    }

    protected createController(): LeagueRewardController {
        return new LeagueRewardController(this.context, {
            repository: leagueRepository,
        });
    }

    protected handleOutput(output: LeagueRewardOutput): void {
        if (output.kind === 'reward') {
            FW.ShowReward(output.rewards);
        }
    }
}

export function createLeaguePopupComposition(context: IControllerContext, view: PopupBase): IPopupComposition | null {
    if (view instanceof LeagueEditPage) return new LeaguePopupComposition(context, view);
    if (view instanceof LeagueStorePage || view instanceof LeagueDiscountPage || view instanceof LeagueTaskPage
        || view instanceof LeagueNorthRewardPage || view instanceof LeagueNorthExpeditionPage) {
        return new LeagueRewardPopupComposition(context, view);
    }
    return null;
}
