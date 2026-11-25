import { EventMgr } from '../../../framework/event/EventMgr';
import { ZC_BATTLE_EVENTS } from './ZCBattleEvents';
import { ControllerBase, type IControllerContext } from '../../../framework/controller/ControllerBase';
import type { IZCChapterBattleOutcome } from '../../battle/BattleResultService';
import type { IRankSeat, RankSeatProfiles } from '../model/ZCRankBoard';
import type { IZCSettlementMvp } from '../model/ZCSettlementMvp';
import { ZCGameUiEvent } from '../view/ZCGameHudEvents';
import type { IZCDamageStatsPopup, IZCDamageStatsSeats, IZCDamageStatsUnit } from './ZCBattleRuntimeContract';
import type { IZCSettlementOptions, IZCSettlementReward } from '../ui/ZCSettlementPage';

export interface IZCBattlePopup {
    close(reason?: 'manual' | 'force'): void;
    /** 弹窗被玩家关掉后兑现（点空白 / 关闭按钮 / 被强制关掉都算）。没有这个语义时省略。*/
    readonly whenClosed?: Promise<void>;
    /**
     * 询问类弹窗（确认框）的作答：确定 `true`，取消 / 点空白 / 被 `close()` 一律 `false`。
     *
     * 没有作答语义的弹窗不提供本字段；调用方拿不到时按「没确认」处理。
    */
    readonly answered?: Promise<boolean>;
}

/** 结算前的排行榜数据（`ZCGameRankBoard` 的入参）。*/
export interface IZCBattleSettlementRank {
    readonly seats: readonly IRankSeat[];
    readonly profiles: RankSeatProfiles;
}

export interface IZCBattleSettlementRequest {
    readonly localVictory: boolean;
    readonly elapsedSeconds: number;
    readonly commands: readonly CmdBattleFrameInfo[];
    readonly statistics: readonly CmdBattleStatisticsInfo[];
    readonly battleType: number | null;
    /**
     * 结算前的排行榜（≥3 人局才有，`<3` 人或数据缺失时给 `null`）。
     *
     * 需求（11-4 测试包反馈）：多人结算先展示排行榜、再展示奖励界面。
     * 判定放在调用方（运行期控制器按 `model.owners.length`），这里只负责「有就弹、关掉再结算」。
    */
    readonly rank: IZCBattleSettlementRank | null;
    /**
     * 本局逐单位（卡）战斗统计，用于「查看完整队伍」的战斗统计弹窗。
     *
     * 结算后模型不再推进，运行期在 `start` 时冻结转交，结算期不再回头读模型
     * （`phase.isSettled` 之后运行期的入口一律 return）。
     * 缺省 ⇒ 不出来源数据（老调用方 / 空统计）。
    */
    readonly units?: readonly IZCDamageStatsUnit[];
    /**
     * 席位上下文（敌方头像栏 + 默认选中），与 {@link units} 一起冻结在 `start`。
     *
     * 结算期不再回读模型，所以头像 / 名字必须在 `start` 时随请求一起交过来；缺省 ⇒
     * 「查看完整队伍」的统计面板不画头像栏、敌方列按老口径合并。
     */
    readonly seats?: IZCDamageStatsSeats;
    /**
     * 本局 MVP 卡片（赢家阵营输出最高的卡：骨骼模型 + 卡名 + 等级 + 输出/承伤占比）。
     *
     * 由运行期在冻结统计时一次算好（`buildSettlementMvp`），结算期不再回读模型；
     * 缺省 / 空 ⇒ 页面整组收起（老调用方、单席局、全员 0 输出）。
    */
    readonly mvp?: IZCSettlementMvp | null;
}
export interface IZCBattleSettlementServices {
    readonly playOutcome?: (victory: boolean) => void;
    readonly results: {
        waitResult(battleType: number, caller: object): Promise<IZCChapterBattleOutcome | null>;
        finish(request: IZCBattleSettlementRequest, caller: object): Promise<unknown>;
        cancelRequests(caller: object): void;
    };
    readonly rewards: {
        loadRewards(result: IZCChapterBattleOutcome): Promise<IZCSettlementReward[]>;
    };
    readonly popup: {
        open(options: IZCSettlementOptions): Promise<IZCBattlePopup | null>;
        /** 结算前的排行榜弹窗（复用 `ui/game/ZCGameRankBoard`）。*/
        openRank(seats: readonly IRankSeat[], profiles: RankSeatProfiles): Promise<IZCBattlePopup | null>;
        /**
         * 伤害统计弹窗（`ui/game/GameRunAway`），结算页「查看完整队伍」用。
         *
         * 与运行期的 `popups.openDamage` 同一个实现（`BATTLE_POPUPS`），只是入口换成结算控制器 ——
         * 结算期运行入口已被 `phase.isSettled` 拦掉。
        */
        openDamage(units: readonly IZCDamageStatsUnit[], seats?: IZCDamageStatsSeats): Promise<IZCDamageStatsPopup | null>;
    };
    readonly flow: {
        watchSwitch(callback: (entered: boolean) => void): () => void;
    };
    failed(error: unknown): void;
}

/** 结算编排只依赖服务契约，自身持有请求、弹窗和退订句柄。*/
export class ZCBattleSettlementController extends ControllerBase {
    private started = false;
    private popup: IZCBattlePopup | null = null;
    private options: IZCSettlementOptions | null = null;
    private opening = false;
    private returning = false;
    private stopSwitch: (() => void) | null = null;
    /** 结算前的排行榜弹窗（玩家读完关掉才继续弹结算页）。*/
    private rankPopup: IZCBattlePopup | null = null;
    /** 「查看完整队伍」打开的统计弹窗（结算页后面，关掉结算页时一并收掉）。*/
    private teamPopup: IZCDamageStatsPopup | null = null;
    /** 本局逐单位统计的冻结副本（请求在 `start` 时给一次，之后不回读模型）。*/
    private units: readonly IZCDamageStatsUnit[] = [];
    /** 席位上下文（敌方头像栏），与 {@link units} 同一时点冻结。*/
    private seats: IZCDamageStatsSeats | undefined;
    /**
     * 关停信号：`present` 里在等排行榜关掉，玩家可能直接退局 ⇒ dispose 时必须让这个 await 落定，
     * 否则整条结算流程悬着，谁也不会再推进（表现为「撤退后再也弹不出结算」）。
    */
    private readonly disposed: Promise<void>;
    private resolveDisposed: () => void = () => {};
    constructor(context: IControllerContext, private readonly services: IZCBattleSettlementServices,
        private readonly host: { readonly owner: object; readonly hasPveContext: boolean }) {
        super(context, 'battle-settlement');
        this.disposed = new Promise<void>(resolve => { this.resolveDisposed = resolve; });
        // 结算页的「查看完整队伍」走结算自己的事件（运行期入口在 `isSettled` 后被拦掉）。
        this.listen(ZCGameUiEvent.SettlementViewTeam, this.onViewTeam);
    }
    start(request: IZCBattleSettlementRequest): void {
        if (this.started || this.isDisposed) return;
        this.started = true;
        this.units = request.units ?? [];
        this.seats = request.seats;
        // 等待必须早于上报，避免同步广播丢失。
        const result = request.battleType === null ? null : this.services.results.waitResult(request.battleType, this);
        void this.services.results.finish(request, this).catch(error => { if (!this.isDisposed) this.services.failed(error); });
        void this.present(request, result).catch(error => { if (!this.isDisposed) this.services.failed(error); });
    }
    private async present(request: IZCBattleSettlementRequest, pending: Promise<IZCChapterBattleOutcome | null> | null): Promise<void> {
        const result = pending ? await pending : null;
        if (this.isDisposed) return;
        // 广播 code 1 表示获胜；服务端结果覆盖本地模拟结果。
        if (result && this.host.hasPveContext) {
            EventMgr.instance.emit(ZC_BATTLE_EVENTS.PVE_RESULT, { victory: result.code === 1 }, this.host.owner);
        }
        // 需求：≥3 人局的结算先排行榜、后奖励。排行榜是「看过就关」的信息页，
        // 它没关之前不加载奖励、也不弹结算页（否则两页叠在一起，玩家看不到排行榜）。
        await this.presentRank(request.rank);
        if (this.isDisposed) return;
        let rewards: IZCSettlementReward[] = [];
        if (result) {
            rewards = await this.services.rewards.loadRewards(result);
            if (this.isDisposed) return;
        }
        this.options = Object.assign({
            victory: result ? result.code === 1 : request.localVictory, rewards,
            // 运行期已算好 MVP（空 ⇒ 页面整组收起，不留空框）。
            mvp: request.mvp ?? null,
        }, result?.warScore !== undefined ? {
            rankName: '战功', scoreText: String(result.warScore), addScoreText: `+${result.warScore}`,
            rankHint: `本次战斗获得 ${result.warScore} 战功`,
        } : {});
        await this.open();
        if (this.popup) this.services.playOutcome?.(this.options.victory);
    }
    /**
     * 弹结算前的排行榜并等玩家关掉。
     *
     * 三个出口都必须落定：弹窗打开失败（null）、玩家关掉（`whenClosed`）、本局被 dispose。
     * 少一个就是整条结算流程卡死 —— 而且是零报错的（`await` 永远不返回）。
    */
    private async presentRank(rank: IZCBattleSettlementRank | null): Promise<void> {
        if (!rank || rank.seats.length < 3) return;
        const popup = await this.services.popup.openRank(rank.seats, rank.profiles);
        if (this.isDisposed) { popup?.close('force'); return; }
        if (!popup) return;
        this.rankPopup = popup;
        try {
            await Promise.race([popup.whenClosed ?? Promise.resolve(), this.disposed]);
        } finally {
            if (this.rankPopup === popup) this.rankPopup = null;
        }
    }
    private async open(): Promise<void> {
        if (this.isDisposed || this.opening || this.popup || !this.options) return;
        this.opening = true;
        try {
            const popup = await this.services.popup.open(this.options);
            if (this.isDisposed) { popup?.close(); return; }
            this.popup = popup;
        } finally { this.opening = false; }
    }
    confirm(): void {
        if (this.isDisposed || !this.options || this.returning) return;
        this.returning = true;
        const popup = this.popup;
        this.popup = null;
        popup?.close('manual');
        this.stopSwitch?.();
        const stop = this.services.flow.watchSwitch(entered => {
            stop();
            if (this.stopSwitch === stop) this.stopSwitch = null;
            if (!this.isDisposed && !entered) {
                this.returning = false;
                void this.open().catch(error => { if (!this.isDisposed) this.services.failed(error); });
            }
        });
        this.stopSwitch = stop;
        EventMgr.instance.emit(ZC_BATTLE_EVENTS.RETURN_TO_MAIN, undefined, this.host.owner);
    }
    /**
     * 「查看完整队伍」：用本局冻结的单位统计数据弹战斗统计面板。
     *
     * 页面只在 `options` 就绪后才存在，所以「还没结算就收到事件」不可能点得出来；
     * 连点两下用 `teamPopup.isOpen` 挡住（结算页不关，弹窗会叠在它上面）。
    */
    private onViewTeam(): void {
        if (!this.options || this.teamPopup?.isOpen) return;
        void this.services.popup.openDamage(this.units, this.seats)
            .then(popup => {
                if (!popup) return;
                if (this.isDisposed) { popup.close(); return; }
                this.teamPopup = popup;
            })
            .catch(error => { if (!this.isDisposed) this.services.failed(error); });
    }
    dispose(): void {
        if (this.isDisposed) return;
        this.releaseInputs();
        const stopSwitch = this.stopSwitch;
        this.stopSwitch = null;
        const popup = this.popup;
        const rankPopup = this.rankPopup;
        const teamPopup = this.teamPopup;
        this.popup = null;
        this.rankPopup = null;
        this.teamPopup = null;
        this.options = null;
        this.units = [];
        // 先解除「等排行榜关闭」的等待，再关弹窗：两条路都要落定，缺一个 present 就悬着。
        this.resolveDisposed();
        try { stopSwitch?.(); }
        finally {
            try { this.services.results.cancelRequests(this); }
            finally {
                try { teamPopup?.close(); }
                finally {
                    try { rankPopup?.close('force'); }
                    finally {
                        try { popup?.close(); }
                        finally { super.dispose(); }
                    }
                }
            }
        }
    }
}
