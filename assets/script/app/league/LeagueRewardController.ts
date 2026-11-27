import { ControllerBase, type IControllerContext } from '../../framework/controller/ControllerBase';
import { EventMgr } from '../../framework/event/EventMgr';
import {
    LeagueRewardEvent,
    type ILeagueRewardIntent,
    type LeagueRewardAction,
    type LeagueRewardOutput,
} from './LeagueRewardEvents';
import type { ILeagueRepository, ILeagueRewardResult } from './LeagueRepository';

export interface ILeagueRewardControllerOptions {
    readonly repository: Pick<ILeagueRepository, 'buyStoreGoods' | 'requestBargain' | 'requestTaskReward' | 'requestTaskProgressReward' | 'requestSweep'>;
}

/** 弹窗会话持有请求与奖励展示；页面只发意图、接收刷新结果。 */
export class LeagueRewardController extends ControllerBase {
    private busy = false;

    constructor(context: IControllerContext, private readonly options: ILeagueRewardControllerOptions) {
        super(context, 'league-reward');
    }

    start(): void {
        this.listen(LeagueRewardEvent.Intent, this.onIntent);
    }

    private readonly onIntent = (event: ILeagueRewardIntent): void => {
        if (this.busy) return;
        void this.execute(event.action);
    };

    private async execute(action: LeagueRewardAction): Promise<void> {
        this.busy = true;
        let result: ILeagueRewardResult = { status: 'failed', rewards: [] };
        try {
            result = await this.request(action);
        } catch (error) {
            if (!this.isDisposed) console.warn('[LeagueRewardController] 请求失败', error);
        } finally {
            this.busy = false;
        }
        if (this.isDisposed) return;
        if (result.status === 'ok' && result.rewards.length > 0) {
            EventMgr.instance.emit(LeagueRewardEvent.Output, { kind: 'reward', rewards: result.rewards } satisfies LeagueRewardOutput, this);
        }
        EventMgr.instance.emit(LeagueRewardEvent.Completed, { status: result.status });
    }

    private request(action: LeagueRewardAction): Promise<ILeagueRewardResult> {
        const repository = this.options.repository;
        switch (action.kind) {
            case 'store': return repository.buyStoreGoods(action.id, this);
            case 'bargain': return repository.requestBargain(action.buy, this);
            case 'task': return repository.requestTaskReward(action.resId, this);
            case 'progress': return repository.requestTaskProgressReward(action.subType, this);
            case 'sweep': return repository.requestSweep(this);
        }
    }
}
