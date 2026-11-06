import type { IControllerContext } from '../../framework/controller/ControllerBase';
import type { PopupBase } from '../../framework/ui/PopupBase';
import type { IPopupComposition } from '../../framework/ui/PopupCompositionHost';
import { FW } from '../../framework/FW';
import { LeagueEditPage } from '../league/LeagueEditPage';
import { LeagueEditModel, type ILeagueEditParams } from '../league/LeagueEditModel';
import { LeagueEditController } from '../league/LeagueEditController';
import { leagueRepository } from '../league/LeagueRepository';
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

export function createLeaguePopupComposition(context: IControllerContext, view: PopupBase): IPopupComposition | null {
    return view instanceof LeagueEditPage ? new LeaguePopupComposition(context, view) : null;
}
