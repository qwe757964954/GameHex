import type { IControllerContext } from '../../framework/controller/ControllerBase';
import type { IPopupComposition } from '../../framework/ui/PopupCompositionHost';
import type { PopupBase } from '../../framework/ui/PopupBase';
import { EventMgr } from '../../framework/event/EventMgr';
import { FW } from '../../framework/FW';
import { LeagueCreateController } from '../league/LeagueCreateController';
import { LeagueCreateModel } from '../league/LeagueCreateModel';
import { LeagueCreatePage, type ILeagueCreateParams } from '../league/LeagueCreatePage';
import { leagueRepository } from '../league/LeagueRepository';
import { LeagueTabEvent } from '../league/LeagueTabEvents';
import { GameNet } from '../net/GameNet';

/** 一次打开 = 一个创建会话；关闭立即释放控制器与其在飞请求。 */
class LeagueCreatePopupComposition implements IPopupComposition {
    private controller: LeagueCreateController | null = null;

    constructor(private readonly context: IControllerContext, private readonly view: LeagueCreatePage) {}

    open(userData: unknown): void {
        if (this.controller) throw new Error('联盟创建会话不可重复启动');
        const controller = this.createController(userData as ILeagueCreateParams | undefined);
        this.controller = controller;
        controller.start();
    }

    /** 命名工厂：与卡牌 / 联盟编辑一致，`open` 只负责委托与启动。 */
    private createController(params: ILeagueCreateParams | undefined): LeagueCreateController {
        return new LeagueCreateController(this.context, {
            owner: this.view,
            joinedOwner: params?.owner ?? null,
            model: new LeagueCreateModel(),
            repository: leagueRepository,
            view: {
                render: state => this.view.render(state),
                close: () => this.view.closeByButton(),
            },
            feedback: {
                tip: text => FW.showTip(text),
                // 老端靠 CmdRoleUnion 推送让容器切页；本端按 owner 发事件，不再让视图持有回调。
                notifyJoined: owner => {
                    if (owner) EventMgr.instance.emit(LeagueTabEvent.Joined, { owner });
                },
            },
            requests: { removeCaller: caller => GameNet.instance.removeCaller(caller) },
        });
    }

    dispose(): void {
        const controller = this.controller;
        this.controller = null;
        controller?.dispose();
    }
}

export function createLeagueCreatePopupComposition(
    context: IControllerContext,
    view: PopupBase,
): IPopupComposition | null {
    return view instanceof LeagueCreatePage ? new LeagueCreatePopupComposition(context, view) : null;
}
