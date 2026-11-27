import type { IControllerContext } from '../../framework/controller/ControllerBase';
import { PopupSession, type IPopupComposition } from '../../framework/ui/PopupCompositionHost';
import type { PopupBase } from '../../framework/ui/PopupBase';
import { EventMgr } from '../../framework/event/EventMgr';
import { FW } from '../../framework/FW';
import { LeagueCreateController } from '../league/LeagueCreateController';
import { LeagueCreateModel } from '../league/LeagueCreateModel';
import { LeagueCreateEvent, type LeagueCreateOutput } from '../league/LeagueCreateEvents';
import { LeagueCreatePage } from '../league/LeagueCreatePage';
import { leagueRepository } from '../league/LeagueRepository';
import { LeagueTabEvent } from '../league/LeagueTabEvents';

/** 一次打开 = 一个创建会话；关闭立即释放控制器与其在飞请求。 */
class LeagueCreatePopupComposition extends PopupSession<LeagueCreatePage, LeagueCreateController, LeagueCreateOutput> {
    constructor(context: IControllerContext, view: LeagueCreatePage) {
        super(context, view, LeagueCreateEvent.Output);
    }

    /** 命名工厂：与卡牌 / 联盟编辑一致，`open` 只负责委托与启动。 */
    protected createController(): LeagueCreateController {
        return new LeagueCreateController(this.context, {
            model: new LeagueCreateModel(),
            repository: leagueRepository,
        });
    }

    protected handleOutput(output: LeagueCreateOutput): void {
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
            case 'joined':
                EventMgr.instance.emit(LeagueTabEvent.Joined);
                break;
        }
    }
}

export function createLeagueCreatePopupComposition(
    context: IControllerContext,
    view: PopupBase,
): IPopupComposition | null {
    return view instanceof LeagueCreatePage ? new LeagueCreatePopupComposition(context, view) : null;
}
