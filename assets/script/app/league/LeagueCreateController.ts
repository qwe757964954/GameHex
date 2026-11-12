import { ControllerBase, type IControllerContext } from '../../framework/controller/ControllerBase';
import {
    LeagueCreateEvent,
    type ILeagueCreateIntent,
    type ILeagueCreateViewState,
} from './LeagueCreateEvents';
import type { LeagueCreateModel } from './LeagueCreateModel';
import type { ILeagueRepository } from './LeagueRepository';
import type { ILeagueCostView } from './LeagueTable';
import {
    fillLeagueText,
    LEAGUE_COST_NOT_ENOUGH_FALLBACK,
    LEAGUE_COST_NOT_ENOUGH_TEMPLATE,
    LEAGUE_TIP_FAILED,
    LEAGUE_TIP_OFFLINE,
    LEAGUE_TIP_UNION_NAME_EMPTY,
} from './LeagueTexts';

export interface ILeagueCreateControllerOptions {
    readonly owner: object;
    /** 容器页 owner；成功后按它发 `LeagueTabEvent.Joined`，替代视图回调穿透。 */
    readonly joinedOwner: object | null;
    readonly model: LeagueCreateModel;
    readonly repository: Pick<ILeagueRepository, 'createCost' | 'requestCreat'>;
    readonly view: {
        readonly render: (state: ILeagueCreateViewState) => void;
        readonly close: () => void;
    };
    readonly feedback: {
        readonly tip: (text: string) => void;
        readonly notifyJoined: (owner: object | null) => void;
    };
    readonly requests: { readonly removeCaller: (caller: object) => void };
}

/**
 * 创建联盟的业务编排：守卫链、费用复读、发包、成功通知。
 *
 * 与 `LeagueEditController` 同构 —— 每次打开由外部 Composition 新建一个实例，
 * 关闭即 `dispose()`，`removeCaller(this)` 作废在飞请求，迟到回包不再上屏。
 */
export class LeagueCreateController extends ControllerBase {
    private started = false;
    private submitting = false;
    private revision = 0;

    constructor(context: IControllerContext, private readonly options: ILeagueCreateControllerOptions) {
        super(context, 'league-create');
        this.own(() => options.requests.removeCaller(this));
    }

    start(): void {
        if (this.started || this.isDisposed) return;
        this.started = true;
        this.listen(LeagueCreateEvent.Intent, this.onIntent);
        // PopupManager 在 view.onOpen 之后才打开组合会话 ⇒ 首屏状态与取数都由这里主动推。
        this.publish();
        void this.refreshCost();
    }

    private readonly onIntent = (event: ILeagueCreateIntent): void => {
        if (event.owner !== this.options.owner) return;
        const model = this.options.model;
        if (event.kind === 'name') {
            model.name = event.name;
        } else if (event.kind === 'banner') {
            model.selectIndex = event.index;
            this.publish();
        } else if (event.kind === 'quickJoin') {
            model.quickJoin = event.quickJoin;
            this.publish();
        } else {
            void this.submit(event.name, event.quickJoin);
        }
    };

    private async refreshCost(): Promise<void> {
        const revision = ++this.revision;
        try {
            const cost = await this.options.repository.createCost();
            if (this.isDisposed || revision !== this.revision) return;
            this.options.model.cost = cost;
            this.publish();
        } catch (error) {
            if (!this.isDisposed) console.warn('[LeagueCreateController] 读创建消耗失败', error);
        }
    }

    /**
     * 老端 `onClickCreat()` 的守卫链：防连点 → 空名 → 现读消耗 → 钱够 → 发包。
     *
     * ⚠️ 提交时**重新读一次** `createCost()`：表可热更、金币也可能刚被花掉。
     * ⚠️ 每个 `await` 后都用 `isDisposed` + `model.name !== name` 作废迟到结果
     *    （结果回来时输入框已被改动 ⇒ 放弃，同老端 `input.text != labName`）。
     */
    private async submit(name: string, quickJoin: boolean): Promise<void> {
        if (this.submitting) return;
        const { model, repository, view, feedback } = this.options;
        model.name = name;
        model.quickJoin = quickJoin;
        if (!model.canSubmit) {
            feedback.tip(LEAGUE_TIP_UNION_NAME_EMPTY);
            return;
        }
        this.submitting = true;
        this.publish();
        try {
            const cost = await repository.createCost();
            if (this.isDisposed || model.name !== name) return;
            model.cost = cost;
            this.publish();
            if (!cost.enough) {
                feedback.tip(this.costTip(cost));
                return;
            }
            const result = await repository.requestCreat(model.banner, name, quickJoin, this);
            if (this.isDisposed || model.name !== name) return;
            if (result === 'ok') {
                view.close();
                feedback.notifyJoined(this.options.joinedOwner);
                return;
            }
            feedback.tip(result === 'offline' ? LEAGUE_TIP_OFFLINE : LEAGUE_TIP_FAILED);
        } catch (error) {
            if (!this.isDisposed && model.name === name) {
                console.warn('[LeagueCreateController] 创建请求失败', error);
                feedback.tip(LEAGUE_TIP_FAILED);
            }
        } finally {
            this.submitting = false;
            if (!this.isDisposed) this.publish();
        }
    }

    /** 老端 `ModelGoods.CheckHaveEnoughCostAndOpenAlert()` 的三级兜底。 */
    private costTip(cost: ILeagueCostView): string {
        if (cost.unenoughTips) return cost.unenoughTips;
        if (cost.name) return fillLeagueText(LEAGUE_COST_NOT_ENOUGH_TEMPLATE, cost.name);
        return LEAGUE_COST_NOT_ENOUGH_FALLBACK;
    }

    private publish(): void {
        const model = this.options.model;
        this.options.view.render({
            name: model.name,
            selectIndex: model.selectIndex,
            quickJoin: model.quickJoin,
            cost: model.cost,
            submitting: this.submitting,
        });
    }
}
