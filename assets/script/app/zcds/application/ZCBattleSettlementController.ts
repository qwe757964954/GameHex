import { EventMgr } from '../../../framework/event/EventMgr';
import { ZC_BATTLE_EVENTS } from './ZCBattleEvents';
import { ControllerBase, type IControllerContext } from '../../../framework/controller/ControllerBase';
import type { IZCChapterBattleOutcome } from '../../battle/BattleResultService';
import type { IZCSettlementOptions, IZCSettlementReward } from '../ui/ZCSettlementPage';

export interface IZCBattlePopup { close(reason?: 'manual' | 'force'): void; }
export interface IZCBattleSettlementRequest {
    readonly localVictory: boolean;
    readonly elapsedSeconds: number;
    readonly commands: readonly CmdBattleFrameInfo[];
    readonly statistics: readonly CmdBattleStatisticsInfo[];
    readonly battleType: number | null;
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
    constructor(context: IControllerContext, private readonly services: IZCBattleSettlementServices,
        private readonly host: { readonly owner: object; readonly hasPveContext: boolean }) {
        super(context, 'battle-settlement');
    }
    start(request: IZCBattleSettlementRequest): void {
        if (this.started || this.isDisposed) return;
        this.started = true;
        // 等待必须早于上报，避免同步广播丢失。
        const result = request.battleType === null ? null : this.services.results.waitResult(request.battleType, this);
        void this.services.results.finish(request, this).catch(error => { if (!this.isDisposed) this.services.failed(error); });
        void this.present(request.localVictory, result).catch(error => { if (!this.isDisposed) this.services.failed(error); });
    }
    private async present(localVictory: boolean, pending: Promise<IZCChapterBattleOutcome | null> | null): Promise<void> {
        const result = pending ? await pending : null;
        if (this.isDisposed) return;
        // 广播 code 1 表示获胜；服务端结果覆盖本地模拟结果。
        if (result && this.host.hasPveContext) {
            EventMgr.instance.emit(ZC_BATTLE_EVENTS.PVE_RESULT, { owner: this.host.owner, victory: result.code === 1 });
        }
        const rewards = result ? await this.services.rewards.loadRewards(result) : [];
        if (this.isDisposed) return;
        this.options = {
            victory: result ? result.code === 1 : localVictory, rewards,
            ...(result?.warScore !== undefined ? {
                rankName: '战功', scoreText: String(result.warScore), addScoreText: `+${result.warScore}`,
                rankHint: `本次战斗获得 ${result.warScore} 战功`,
            } : {}),
        };
        await this.open();
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
        this.popup = null;
        this.options = null;
        try { stopSwitch?.(); }
        finally {
            try { this.services.results.cancelRequests(this); }
            finally {
                try { popup?.close(); }
                finally { super.dispose(); }
            }
        }
    }
}
