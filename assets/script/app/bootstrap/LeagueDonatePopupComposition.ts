import type { IControllerContext } from '../../framework/controller/ControllerBase';
import type { IPopupComposition } from '../../framework/ui/PopupCompositionHost';
import type { PopupBase } from '../../framework/ui/PopupBase';
import { FW } from '../../framework/FW';
import { CommonTips } from '../common/CommonTips';
import { playLeagueAd } from '../league/LeagueAd';
import { LeagueDonateController } from '../league/LeagueDonateController';
import { LeagueDonateModel } from '../league/LeagueDonateModel';
import { LeagueDonatePage } from '../league/LeagueDonatePage';
import { leagueRepository } from '../league/LeagueRepository';
import { GameNet } from '../net/GameNet';

/** 一次打开 = 一个捐献会话；关闭立即释放控制器与其在飞请求。 */
class LeagueDonatePopupComposition implements IPopupComposition {
    private controller: LeagueDonateController | null = null;

    constructor(private readonly context: IControllerContext, private readonly view: LeagueDonatePage) {}

    open(): void {
        if (this.controller) throw new Error('联盟捐献会话不可重复启动');
        const controller = this.createController();
        this.controller = controller;
        controller.start();
    }

    /** 命名工厂：与卡牌 / 联盟编辑一致，`open` 只负责委托与启动。 */
    private createController(): LeagueDonateController {
        return new LeagueDonateController(this.context, {
            owner: this.view,
            model: new LeagueDonateModel(),
            repository: leagueRepository,
            view: { render: state => this.view.render(state) },
            feedback: {
                tip: text => FW.showTip(text),
                // 老端带「不再提示」勾选框，本端恒问（复用 CommonTips，无勾选框）。
                confirm: (content, onSure) => {
                    void CommonTips.open({ userData: { content, onSure } });
                },
            },
            // 广告是 Mock：只有真的播完才返回 true，Controller 据此决定发不发 adv=true。
            ads: { play: () => playLeagueAd() },
            requests: { removeCaller: caller => GameNet.instance.removeCaller(caller) },
        });
    }

    dispose(): void {
        const controller = this.controller;
        this.controller = null;
        controller?.dispose();
    }
}

export function createLeagueDonatePopupComposition(
    context: IControllerContext,
    view: PopupBase,
): IPopupComposition | null {
    return view instanceof LeagueDonatePage ? new LeagueDonatePopupComposition(context, view) : null;
}
