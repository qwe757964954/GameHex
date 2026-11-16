import type { IControllerContext } from '../../framework/controller/ControllerBase';
import type { PopupBase } from '../../framework/ui/PopupBase';
import type { IPopupComposition } from '../../framework/ui/PopupCompositionHost';
import { FW } from '../../framework/FW';
import { LeagueEditPage } from '../league/LeagueEditPage';
import { LeagueEditModel, type ILeagueEditParams } from '../league/LeagueEditModel';
import { LeagueEditController } from '../league/LeagueEditController';
import { leagueRepository } from '../league/LeagueRepository';
import { LeagueRewardController } from '../league/LeagueRewardController';
import { LeagueStorePage } from '../league/LeagueStorePage';
import { LeagueDiscountPage } from '../league/LeagueDiscountPage';
import { LeagueTaskPage } from '../league/LeagueTaskPage';
import { LeagueNorthRewardPage } from '../league/LeagueNorthRewardPage';
import { LeagueNorthExpeditionPage } from '../league/LeagueNorthExpeditionPage';
import { GameNet } from '../net/GameNet';

class LeaguePopupComposition implements IPopupComposition {
    private controller: LeagueEditController | null = null;

    constructor(private readonly context: IControllerContext, private readonly view: LeagueEditPage) {}

    open(userData: unknown): void {
        if (this.controller) throw new Error('联盟编辑会话不可重复启动');
        const controller = this.createController(userData as ILeagueEditParams | undefined);
        this.controller = controller;
        controller.start();
    }

    private createController(userData: ILeagueEditParams | undefined): LeagueEditController {
        return new LeagueEditController(this.context, {
            owner: this.view,
            model: new LeagueEditModel(userData),
            repository: leagueRepository,
            view: { render: state => this.view.render(state), close: () => this.view.closeByButton() },
            feedback: { tip: text => FW.showTip(text) },
            requests: { removeCaller: caller => GameNet.instance.removeCaller(caller) },
        });
    }

    dispose(): void {
        const controller = this.controller;
        this.controller = null;
        controller?.dispose();
    }
}

class LeagueRewardPopupComposition implements IPopupComposition {
    private controller: LeagueRewardController | null = null;

    constructor(private readonly context: IControllerContext, private readonly view: PopupBase) {}

    open(): void {
        if (this.controller) throw new Error('联盟奖励会话不可重复启动');
        this.controller = this.createController();
        this.controller.start();
    }

    private createController(): LeagueRewardController {
        return new LeagueRewardController(this.context, {
            owner: this.view,
            repository: leagueRepository,
            feedback: { reward: goods => FW.ShowReward(goods) },
            requests: { removeCaller: caller => GameNet.instance.removeCaller(caller) },
        });
    }

    dispose(): void {
        this.controller?.dispose();
        this.controller = null;
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
