import type { IControllerContext } from '../../framework/controller/ControllerBase';
import { PopupSession, type IPopupComposition } from '../../framework/ui/PopupCompositionHost';
import type { PopupBase } from '../../framework/ui/PopupBase';
import { EventMgr } from '../../framework/event/EventMgr';
import { FW } from '../../framework/FW';
import { CommonTips } from '../common/CommonTips';
import { playLeagueAd } from '../league/LeagueAd';
import { LeagueDonateController } from '../league/LeagueDonateController';
import { LeagueDonateModel } from '../league/LeagueDonateModel';
import { LeagueDonateEvent, type ILeagueDonateIntent, type LeagueDonateOutput } from '../league/LeagueDonateEvents';
import { LeagueDonatePage } from '../league/LeagueDonatePage';
import { leagueRepository } from '../league/LeagueRepository';

/** 一次打开 = 一个捐献会话；关闭立即释放控制器与其在飞请求。 */
class LeagueDonatePopupComposition extends PopupSession<LeagueDonatePage, LeagueDonateController, LeagueDonateOutput> {
    constructor(context: IControllerContext, view: LeagueDonatePage) {
        super(context, view, LeagueDonateEvent.Output);
    }

    /** 命名工厂：与卡牌 / 联盟编辑一致，`open` 只负责委托与启动。 */
    protected createController(): LeagueDonateController {
        return new LeagueDonateController(this.context, {
            model: new LeagueDonateModel(),
            repository: leagueRepository,
            // 广告是 Mock：只有真的播完才返回 true，Controller 据此决定发不发 adv=true。
            ads: { play: () => playLeagueAd() },
        });
    }

    protected handleOutput(output: LeagueDonateOutput): void {
        switch (output.kind) {
            case 'render':
                this.view.render(output.state);
                break;
            case 'tip':
                FW.showTip(output.text);
                break;
            case 'reward':
                FW.ShowReward(output.goods);
                break;
            case 'confirm':
                // 老端带「不再提示」勾选框，本端恒问（复用 CommonTips，无勾选框）。
                void CommonTips.open({
                    userData: {
                        content: output.content,
                        onSure: () => {
                            EventMgr.instance.emit(LeagueDonateEvent.Intent, { kind: 'confirmCoin' } satisfies ILeagueDonateIntent);
                        },
                    },
                });
                break;
        }
    }
}

export function createLeagueDonatePopupComposition(
    context: IControllerContext,
    view: PopupBase,
): IPopupComposition | null {
    return view instanceof LeagueDonatePage ? new LeagueDonatePopupComposition(context, view) : null;
}
