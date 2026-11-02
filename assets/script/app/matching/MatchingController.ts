import { ControllerBase, type IControllerContext } from '../../framework/controller/ControllerBase';
import { GameRoute } from '../../core/runtime/GameRoute';
import type { ZCBattleStart } from '../battle/BattleStartModel';
import type { ZCPvpInfo } from '../battle/PvpInfoModel';
import { MatchingModel, type IMatchingViewState } from './MatchingModel';

interface IMatchingPreload { readonly ready: Promise<unknown>; releaseFromMatching(): void; }
export interface IMatchingControllerOptions {
    readonly model: MatchingModel;
    readonly requestBattle: (caller: object, isCurrent: () => boolean) => Promise<ZCBattleStart | null>;
    readonly createPreload: (battle: Promise<ZCBattleStart | null>) => IMatchingPreload;
    readonly fetchPvp: (caller: object) => Promise<ZCPvpInfo | null>;
    readonly render: (state: IMatchingViewState) => void;
    readonly navigate: (route: string, params?: unknown) => void;
    readonly schedule: (callback: () => void, seconds: number) => () => void;
    readonly removeCaller: (caller: object) => void;
    readonly failed: (error: unknown) => void;
}
/** 搜索至少 3 秒；服务端确认后展示 1.4 秒再进入同一份对局。 */
export class MatchingController extends ControllerBase {
    private started = false;
    private minimumElapsed = false;
    private finished = false;
    private preload: IMatchingPreload | null = null;
    constructor(context: IControllerContext, private readonly options: IMatchingControllerOptions) {
        super(context, 'matching');
        this.own(() => options.removeCaller(this));
    }
    start(): void {
        if (this.started || this.isDisposed) return;
        this.started = true;
        this.render();
        try {
            const task = this.options.requestBattle(this, () => !this.isDisposed && !this.finished);
            this.preload = this.options.createPreload(task);
            const preload = this.preload;
            this.own(() => preload.releaseFromMatching());
            void preload.ready.catch(error => { if (!this.isDisposed && !this.finished) this.options.failed(error); });
            this.own(this.options.schedule(() => { this.minimumElapsed = true; this.match(); }, 3));
            void task.then(battle => {
                if (this.isDisposed || this.finished) return;
                this.options.model.battle = battle;
                if (!battle || this.options.model.snapshot().opponents.length === 0) { this.fail(new Error('服务端未确认开战或未返回对手')); return; }
                this.render();
                this.match();
            }).catch(error => { if (!this.isDisposed && !this.finished) this.fail(error); });
            void this.options.fetchPvp(this).then(info => {
                if (this.isDisposed || this.finished || !info) return;
                this.options.model.pvp = info;
                this.render();
            }).catch(error => { if (!this.isDisposed && !this.finished) this.options.failed(error); });
        } catch (error) { this.fail(error); }
    }
    private match(): void {
        const model = this.options.model;
        if (this.isDisposed || this.finished || !this.minimumElapsed || !model.battle || model.phase === 'matched') return;
        model.phase = 'matched';
        this.render();
        this.own(this.options.schedule(() => {
            if (this.isDisposed || this.finished) return;
            this.finished = true;
            const state = model.snapshot();
            this.options.navigate(GameRoute.Battle, { battle: model.battle, preload: this.preload,
                opponent: state.opponents[0], opponents: state.opponents, selfRoleId: model.selfRoleId });
        }, 1.4));
    }
    private fail(error: unknown): void {
        if (this.isDisposed || this.finished) return;
        this.finished = true;
        this.options.failed(error);
        this.dispose();
        this.options.navigate(GameRoute.Main);
    }
    private render(): void { this.options.render(this.options.model.snapshot()); }
}
