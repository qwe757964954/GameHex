import { ControllerBase, type IControllerContext } from '../../framework/controller/ControllerBase';
import { GameRoute } from '../../core/runtime/GameRoute';
import type { ResourceScope } from '../../core/asset/ResourceScope';
import type { ZCBattleStart } from '../battle/BattleStartModel';
import type { ZCPvpInfo } from '../battle/PvpInfoModel';
import { MATCH_MATCHED_STAY_SECONDS } from './MatchReveal';
import { MatchingModel, type IMatchingViewState } from './MatchingModel';

export interface IMatchingBattleSession { readonly ready: Promise<unknown>; }


/**
 * 领地普通关的"交接"：匹配成功后不是直接切战场，而是把底下的云露出来、散掉，再走。
 *
 * 为什么交给匹配页做：玩家在匹配界面时，**云就铺在它下面**（领地页那一屏云由匹配页重建，
 * 点阵确定性一致、待机步进接上 ⇒ 切过来一帧没变）。所以"关掉界面 → 露云 → 云散"这件事
 * 只能发生在这一侧 —— 那边的主界面节点早就销毁了。
 *
 * 三个回调都由组合根提供（`MatchingComposition`），控制器不认识"云"也不认识领地。
 */
export interface IMatchingHandoff {
    /**
     * 匹配界面**瞬间**消失：只藏 UI（不做淡出，淡出会露出半张界面），
     * 并把云搬到**跨流程**的顶层（`TerritoryBattleCoverOverlay`），这样接着切流程时它不会
     * 跟着匹配页一起被销毁。
     */
    readonly closeInstantly: () => void;
    /**
     * 开始散云。**必须在切战场之后调**：云底下那层得是战场，不能是空屏。
     *
     * 内部自己等"流程切换落定"再等一两帧才真正散（见 `TerritoryBattleCoverOverlay`），
     * 散完自己收工，所以这里不返回任何时间。
     */
    readonly releaseCover: () => void;
    /** 等战场资源的**上限**（秒）。超时也散场跳转，让战场页自己显示加载态。 */
    readonly readyTimeout: number;
}

export interface IMatchingControllerOptions {
    readonly model: MatchingModel;
    readonly failed: (error: unknown) => void;
    readonly handoff?: IMatchingHandoff;
    readonly battle: {
        readonly requestBattle: (caller: object, isCurrent: () => boolean) => Promise<ZCBattleStart | null>;
        readonly createSession: (battle: Promise<ZCBattleStart | null>, owner: ResourceScope) => IMatchingBattleSession;
        readonly fetchPvp: (caller: object) => Promise<ZCPvpInfo | null>;
        readonly removeCaller: (caller: object) => void;
    };
    readonly view: {
        readonly render: (state: IMatchingViewState) => void;
    };
    readonly navigation: {
        readonly navigate: (route: string, params?: unknown) => void;
    };
    readonly clock: {
        readonly schedule: (callback: () => void, seconds: number) => () => void;
    };
}
/** 搜索至少 3 秒；服务端确认后展示 1.4 秒（够逐条揭示完）再进入同一份对局。 */
export class MatchingController extends ControllerBase {
    private started = false;
    private minimumElapsed = false;
    private finished = false;
    private session: IMatchingBattleSession | null = null;
    constructor(context: IControllerContext, private readonly options: IMatchingControllerOptions) {
        super(context, 'matching');
        this.own(() => options.battle.removeCaller(this));
    }
    start(): void {
        if (this.started || this.isDisposed) return;
        this.started = true;
        this.render();
        try {
            const task = this.options.battle.requestBattle(this, () => !this.isDisposed && !this.finished);
            this.session = this.options.battle.createSession(task, this.scope);
            void this.session.ready.catch(error => { if (!this.isDisposed && !this.finished) this.options.failed(error); });
            this.own(this.options.clock.schedule(() => { this.minimumElapsed = true; this.match(); }, 3));
            void task.then(battle => {
                if (this.isDisposed || this.finished) return;
                this.options.model.battle = battle;
                if (!battle || this.options.model.snapshot().opponents.length === 0) { this.fail(new Error('服务端未确认开战或未返回对手')); return; }
                this.render();
                this.match();
            }).catch(error => { if (!this.isDisposed && !this.finished) this.fail(error); });
            void this.options.battle.fetchPvp(this).then(info => {
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
        this.own(this.options.clock.schedule(() => {
            if (this.isDisposed || this.finished) return;
            this.finished = true;
            const handoff = this.options.handoff;
            if (handoff) {
                this.handoffToBattle(handoff);
                return;
            }
            this.navigateToBattle();
        }, MATCH_MATCHED_STAY_SECONDS));
    }

    /**
     * 领地普通关：关界面 → **先切战场** → 战场挂上后再散云。
     *
     * 时序依据（用户 2026-11-02 两次口述，第二次推翻了第一次的做法）：
     *
     * 第一次：「匹配成功、战斗资源加载完成时，匹配界面瞬间关闭，暴露出底层的云，同步云向四周
     * 散开，同步变淡消失」—— 于是"关界面"和"散云"分成两件事：先露一屏静止的云等资源。
     *
     * 第二次（实机截图打回）：「云散开进入战场的动画地图就应该是战场，不能是黑色的地图」——
     * 只把"等资源"挪到散云之前还不够：散云的**那一刻**云底下还是空的（匹配页 UI 刚被关掉，
     * 战场还没挂上），露出来就是镜头清屏色。所以现在是**先跳转、后散云**：
     *
     *  ① 关界面（云被搬到跨流程顶层，切场不会把它带走）；
     *  ② 战场挂到**云下面**（云密铺满屏、完全不透明 ⇒ 切场景全过程玩家看不见）；
     *  ③ 切换落定、战场渲染出一帧之后才散 ⇒ 散开露出来的就是战场。
     */
    private handoffToBattle(handoff: IMatchingHandoff): void {
        // ① 界面瞬间消失（云在它下面，本来就盖满整屏）。
        handoff.closeInstantly();
        let entered = false;
        const enter = (): void => {
            if (entered) return;
            entered = true;
            if (this.isDisposed) return;
            // ② 云还盖着，先把战场挂上去 —— 这一步的全过程玩家看不到。
            this.navigateToBattle();
            // ③ 散云。真正起散的时刻由盖层自己等（切换落定 + 一两帧），这里只发信号。
            handoff.releaseCover();
        };
        const ready = this.session?.ready;
        if (!ready) {
            enter();
        } else {
            void ready.then(enter, error => {
                if (entered) return;
                entered = true;
                if (this.isDisposed) return;
                // 资源没准备好就进战场只会炸在战场页里 —— 回主界面并说明，与老路径一致。
                this.options.failed(error);
                this.options.navigation.navigate(GameRoute.Main);
                // 回去也要散：否则一屏云会一直盖在主界面上。
                handoff.releaseCover();
            });
        }
        // ③ 上限：加载卡死 / 断网时不能永远盖着一屏云。
        this.own(this.options.clock.schedule(enter, handoff.readyTimeout));
    }

    /** 切战场（唯一出口，两条路共用 —— 保证载荷形状只有一份）。 */
    private navigateToBattle(): void {
        const model = this.options.model;
        const state = model.snapshot();
        this.options.navigation.navigate(GameRoute.Battle, { battle: model.battle, session: this.session,
            opponent: state.opponents[0], opponents: state.opponents, selfRoleId: model.selfRoleId });
    }
    private fail(error: unknown): void {
        if (this.isDisposed || this.finished) return;
        this.finished = true;
        this.options.failed(error);
        this.dispose();
        this.options.navigation.navigate(GameRoute.Main);
    }
    private render(): void { this.options.view.render(this.options.model.snapshot()); }
}
