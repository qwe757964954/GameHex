import { EventMgr } from '../../../framework/event/EventMgr';
import { ZC_BATTLE_EVENTS } from './ZCBattleEvents';
import { ControllerBase, type IControllerContext } from '../../../framework/controller/ControllerBase';
import type { IZCChapterBattleOutcome } from '../../battle/BattleResultService';
import type { IRankSeat, RankSeatProfiles } from '../model/ZCRankBoard';
import type { IZCSettlementOptions, IZCSettlementReward } from '../ui/ZCSettlementPage';

export interface IZCBattlePopup {
    close(reason?: 'manual' | 'force'): void;
    /** 弹窗被玩家关掉后兑现（点空白 / 关闭按钮 / 被强制关掉都算）。没有这个语义时省略。 */
    readonly whenClosed?: Promise<void>;
    /**
     * 询问类弹窗（确认框）的作答：确定 `true`，取消 / 点空白 / 被 `close()` 一律 `false`。
     *
     * 没有作答语义的弹窗不提供本字段；调用方拿不到时按「没确认」处理。
     */
    readonly answered?: Promise<boolean>;
}

/** 结算前的排行榜数据（`ZCGameRankBoard` 的入参）。 */
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
     * 结算前的排行榜（**≥3 人局才有**，`<3` 人或数据缺失时给 `null`）。
     *
     * 需求（11-4 测试包反馈）：多人结算先展示排行榜、再展示奖励界面。
     * 判定放在调用方（运行期控制器按 `model.owners.length`），这里只负责「有就弹、关掉再结算」。
     */
    readonly rank: IZCBattleSettlementRank | null;
}
export interface IZCBattleSettlementServices {
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
        /** 结算前的排行榜弹窗（复用 `ui/game/ZCGameRankBoard`）。 */
        openRank(seats: readonly IRankSeat[], profiles: RankSeatProfiles): Promise<IZCBattlePopup | null>;
    };
    readonly flow: {
        watchSwitch(callback: (entered: boolean) => void): () => void;
    };
    failed(error: unknown): void;
}

/** 结算编排只依赖服务契约，自身持有请求、弹窗和退订句柄。 */
export class ZCBattleSettlementController extends ControllerBase {
    private started = false;
    private popup: IZCBattlePopup | null = null;
    private options: IZCSettlementOptions | null = null;
    private opening = false;
    private returning = false;
    private stopSwitch: (() => void) | null = null;
    /** 结算前的排行榜弹窗（玩家读完关掉才继续弹结算页）。 */
    private rankPopup: IZCBattlePopup | null = null;
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
    }
    start(request: IZCBattleSettlementRequest): void {
        if (this.started || this.isDisposed) return;
        this.started = true;
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
            EventMgr.instance.emit(ZC_BATTLE_EVENTS.PVE_RESULT, { owner: this.host.owner, victory: result.code === 1 });
        }
        // 需求：≥3 人局的结算**先排行榜、后奖励**。排行榜是「看过就关」的信息页，
        // 它没关之前不加载奖励、也不弹结算页（否则两页叠在一起，玩家看不到排行榜）。
        await this.presentRank(request.rank);
        if (this.isDisposed) return;
        const rewards = result ? await this.services.rewards.loadRewards(result) : [];
        if (this.isDisposed) return;
        this.options = Object.assign({
            victory: result ? result.code === 1 : request.localVictory, rewards,
        }, result?.warScore !== undefined ? {
            rankName: '战功', scoreText: String(result.warScore), addScoreText: `+${result.warScore}`,
            rankHint: `本次战斗获得 ${result.warScore} 战功`,
        } : {});
        await this.open();
    }
    /**
     * 弹结算前的排行榜并**等玩家关掉**。
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
        EventMgr.instance.emit(ZC_BATTLE_EVENTS.RETURN_TO_MAIN, { owner: this.host.owner });
    }
    dispose(): void {
        if (this.isDisposed) return;
        this.releaseInputs();
        const stopSwitch = this.stopSwitch;
        this.stopSwitch = null;
        const popup = this.popup;
        const rankPopup = this.rankPopup;
        this.popup = null;
        this.rankPopup = null;
        this.options = null;
        // 先解除「等排行榜关闭」的等待，再关弹窗：两条路都要落定，缺一个 present 就悬着。
        this.resolveDisposed();
        try { stopSwitch?.(); }
        finally {
            try { this.services.results.cancelRequests(this); }
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
