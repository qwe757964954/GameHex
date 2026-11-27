import { ControllerBase, type IControllerContext } from '../../framework/controller/ControllerBase';
import { EventMgr } from '../../framework/event/EventMgr';
import {
    LeagueDonateEvent,
    type ILeagueDonateIntent,
    type LeagueDonateOutput,
} from './LeagueDonateEvents';
import type { LeagueDonateModel } from './LeagueDonateModel';
import type { ILeagueRepository, ILeagueRewardResult } from './LeagueRepository';
import {
    fillLeagueText,
    LEAGUE_DONATE_CONFIRM,
    LEAGUE_DONATE_SUCCESS,
    LEAGUE_TIP_AD_DONATE_LIMIT,
    LEAGUE_TIP_DONATE_LIMIT,
    LEAGUE_TIP_FAILED,
    LEAGUE_TIP_NOT_ENOUGH_TEMPLATE,
    LEAGUE_TIP_OFFLINE,
} from './LeagueTexts';

export interface ILeagueDonateControllerOptions {
    readonly model: LeagueDonateModel;
    readonly repository: Pick<ILeagueRepository, 'loadDonate' | 'requestDonate'>;
    /** 广告播放端口；返回「是否真的看完了」，没看完绝不发包。 */
    readonly ads: { readonly play: () => Promise<boolean> };
}

/**
 * 捐献的业务编排：快照读取、广告「先播后发」、金币三道关、写锁与迟到回包。
 *
 * 每次打开由 `LeagueDonatePopupComposition` 新建、关闭即 `dispose()`，
 * `removeCaller(this)` 作废在飞请求 —— 与联盟编辑 / 创建同构。
 */
export class LeagueDonateController extends ControllerBase {
    private busy = false;

    constructor(context: IControllerContext, private readonly options: ILeagueDonateControllerOptions) {
        super(context, 'league-donate');
    }

    start(): void {
        this.listen(LeagueDonateEvent.Intent, this.onIntent);
        // 组合会话晚于 view.onOpen ⇒ 首屏与取数都由这里主动推。
        this.publish();
        void this.reload();
    }

    private emitOutput(output: LeagueDonateOutput): void {
        if (this.isDisposed) {
            return;
        }
        EventMgr.instance.emit(LeagueDonateEvent.Output, output, this);
    }

    private readonly onIntent = (event: ILeagueDonateIntent): void => {
        if (this.busy) return;
        if (event.kind === 'free') {
            void this.donateFree();
        } else if (event.kind === 'confirmCoin') {
            this.confirmCoinDonate();
        } else {
            this.donateByCoin();
        }
    };

    /** 读一次快照（不发包）；成功后由 `afterWrite` 再读一次，等价老端靠推送刷新。 */
    private async reload(): Promise<void> {
        try {
            const snapshot = await this.options.repository.loadDonate();
            if (this.isDisposed) return;
            this.options.model.snapshot = snapshot;
            this.publish();
        } catch (error) {
            if (!this.isDisposed) console.warn('[LeagueDonateController] 读捐献数据失败', error);
        }
    }

    /**
     * 点「免费」（广告路）—— 老端 `onClickAdv()`。
     *
     * **先播后发**：`requestDonate(true)` 的凭据就是「广告放完了」，没放完就发等于白拿。
     * 这里自己管 `busy` 而不是转 `sendDonate()`，否则会二次加锁把自己锁死。
     */
    private async donateFree(): Promise<void> {
        const { model, repository, ads } = this.options;
        if (!model.freeAvailable) {
            this.emitOutput({ kind: 'tip', text: LEAGUE_TIP_AD_DONATE_LIMIT });
            return;
        }
        if (!this.beginWrite()) return;
        try {
            const watched = await ads.play();
            if (this.isDisposed) return;
            if (!watched) {
                this.emitOutput({ kind: 'tip', text: LEAGUE_TIP_FAILED });
                return;
            }
            const result = await repository.requestDonate(true, this);
            await this.afterWrite(result);
        } catch (error) {
            if (!this.isDisposed) {
                console.warn('[LeagueDonateController] 广告捐献失败', error);
                this.emitOutput({ kind: 'tip', text: LEAGUE_TIP_FAILED });
            }
        } finally {
            this.busy = false;
            if (!this.isDisposed) this.publish();
        }
    }

    /**
     * 点「金币」—— 老端 `onClickDonate()` 的三道关：次数 → 钱 → 确认。
     *
     * 确认弹窗回传 `{ kind: 'confirmCoin' }` 意图；会话关闭后输入监听已卸载。
     */
    private donateByCoin(): void {
        const { model } = this.options;
        const snapshot = model.snapshot;
        if (!snapshot) return;
        if (!snapshot.hasTimes) {
            this.emitOutput({ kind: 'tip', text: LEAGUE_TIP_DONATE_LIMIT });
            return;
        }
        if (!snapshot.enough) {
            this.emitOutput({ kind: 'tip', text: fillLeagueText(LEAGUE_TIP_NOT_ENOUGH_TEMPLATE, model.coinName) });
            return;
        }
        const content = fillLeagueText(LEAGUE_DONATE_CONFIRM, snapshot.config.donateCost);
        this.emitOutput({ kind: 'confirm', content });
    }

    private confirmCoinDonate(): void {
        const snapshot = this.options.model.snapshot;
        if (!snapshot || !snapshot.hasTimes || !snapshot.enough) {
            return;
        }
        void this.sendDonate(false);
    }

    /** 发一次捐献（`adv = false` 才真正会走到）。 */
    private async sendDonate(adv: boolean): Promise<void> {
        if (!this.beginWrite()) return;
        try {
            const result = await this.options.repository.requestDonate(adv, this);
            await this.afterWrite(result);
        } catch (error) {
            if (!this.isDisposed) {
                console.warn('[LeagueDonateController] 捐献请求失败', error);
                this.emitOutput({ kind: 'tip', text: LEAGUE_TIP_FAILED });
            }
        } finally {
            this.busy = false;
            if (!this.isDisposed) this.publish();
        }
    }

    /** 写完后按三态收口；成功则重读一次。关闭后的回包一律丢弃。 */
    private async afterWrite(result: ILeagueRewardResult): Promise<void> {
        if (this.isDisposed) return;
        if (result.status === 'ok') {
            this.emitOutput({ kind: 'tip', text: LEAGUE_DONATE_SUCCESS });
            if (result.rewards.length > 0) this.emitOutput({ kind: 'reward', goods: result.rewards });
            await this.reload();
            return;
        }
        this.emitOutput({ kind: 'tip', text: result.status === 'offline' ? LEAGUE_TIP_OFFLINE : LEAGUE_TIP_FAILED });
    }

    /** 防连点：写操作在飞时直接拒掉。 */
    private beginWrite(): boolean {
        if (this.busy) return false;
        this.busy = true;
        this.publish();
        return true;
    }

    private publish(): void {
        this.emitOutput({
            kind: 'render',
            state: { snapshot: this.options.model.snapshot, busy: this.busy },
        });
    }
}
