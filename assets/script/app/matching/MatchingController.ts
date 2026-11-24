import { ControllerBase, type IControllerContext } from '../../framework/controller/ControllerBase';
import { EventMgr } from '../../framework/event/EventMgr';
import { BATTLE_START_SETTLED, ZC_BATTLE_TYPE_PVP, type ZCBattleStart } from '../battle/BattleStartModel';
import { requestBattleStart } from '../battle/BattleStartService';
import { fetchPvpInfo } from '../battle/PvpInfoService';
import { GameNet } from '../net/GameNet';
import { createZCBattleSession } from '../zcds/application/ZCBattlePreparation';
import type { ZCGameEntryParams } from '../zcds/application/ZCGameEntry';
import { MATCH_MATCHED_STAY_SECONDS } from './MatchReveal';
import { MATCHING_EVENTS, type IMatchingEntryParams, type IMatchingLeave } from './MatchTypes';
import type { MatchingModel } from './MatchingModel';

export interface IMatchingControllerOptions {
    readonly model: MatchingModel;
    readonly entry?: Pick<IMatchingEntryParams, 'battleType' | 'battleParams' | 'pve'>;
    readonly handoffReadyTimeout?: number;
}

const MINIMUM_SEARCH_SECONDS = 3;
// 固定步长反复相减会有浮点尾差，避免整秒边界多等一帧。
const FRAME_TIME_EPSILON = 1e-9;

/** 搜索至少 3 秒，服务端确认后展示匹配结果，再进入同一份对局。 */
export class MatchingController extends ControllerBase {
    private isLeaving = false;
    private session: ZCGameEntryParams['session'] | null = null;
    private wait: { readonly phase: 'search' | 'matched' | 'handoff'; secondsRemaining: number } | null = null;

    constructor(context: IControllerContext, private readonly options: IMatchingControllerOptions) {
        super(context, 'matching');
        this.own(() => {
            this.wait = null;
            GameNet.instance.removeCaller(this);
        });
    }

    start(): void {
        GameNet.instance.addEvent(BATTLE_START_SETTLED, this, this.onBattleStartSettled);
        this.render();
        try {
            const entry = this.options.entry;
            this.wait = { phase: 'search', secondsRemaining: MINIMUM_SEARCH_SECONDS };
            void requestBattleStart(entry?.battleType ?? ZC_BATTLE_TYPE_PVP, entry?.battleParams ?? []);
            void fetchPvpInfo(this).then(info => {
                if (this.isDisposed || this.isLeaving || !info) return;
                this.options.model.updatePvpInfo(info);
                this.render();
            }).catch(error => {
                if (!this.isDisposed && !this.isLeaving) this.logFailure(error);
            });
        } catch (error) {
            this.fail(error);
        }
    }

    private onBattleStartSettled(battle: ZCBattleStart | null): void {
        try {
            const model = this.options.model;
            const result = model.acceptBattleResult(battle);
            if (result === 'ignored') return;
            if (result === 'rejected') {
                this.fail(new Error('服务端未确认开战或未返回对手'));
                return;
            }
            const entry = this.options.entry;
            this.session = createZCBattleSession(this.resources, {
                owner: this.scope,
                params: { battle, pve: entry?.pve, selfRoleId: model.selfRoleId, battleType: entry?.battleType },
            });
            void this.session.ready.catch(error => {
                if (!this.isDisposed && !this.isLeaving) this.logFailure(error);
            });
            if (result === 'matched') this.showMatchResult();
            else this.render();
        } catch (error) {
            this.fail(error);
        }
    }

    advanceTime(seconds: number): void {
        const wait = this.wait;
        if (!wait) return;
        wait.secondsRemaining -= seconds;
        if (wait.secondsRemaining > FRAME_TIME_EPSILON) return;
        this.wait = null;
        switch (wait.phase) {
            case 'search':
                if (this.options.model.elapseMinimumSearchTime()) this.showMatchResult();
                break;
            case 'matched': {
                this.isLeaving = true;
                const timeout = this.options.handoffReadyTimeout;
                if (timeout === undefined) this.enterBattle();
                else this.handoffToBattle(timeout);
                break;
            }
            case 'handoff':
                this.enterBattle();
                break;
        }
    }

    private showMatchResult(): void {
        this.wait = { phase: 'matched', secondsRemaining: MATCH_MATCHED_STAY_SECONDS };
        this.render();
    }

    private handoffToBattle(timeout: number): void {
        const ready = this.session?.ready;
        // 加载卡住时仍切场，由战场页展示加载态。
        this.wait = { phase: 'handoff', secondsRemaining: timeout };
        EventMgr.instance.emit(MATCHING_EVENTS.HANDOFF);
        if (!ready) {
            this.wait = null;
            this.enterBattle();
            return;
        }
        void ready.then(
            () => this.completeHandoff({ ready: true }),
            error => this.completeHandoff({ ready: false, error }),
        );
    }

    private completeHandoff(result: { readonly ready: true } | { readonly ready: false; readonly error: unknown }): void {
        // 超时或释放会清掉本轮等待，迟到的准备结果不能再切一次流程。
        if (this.wait?.phase !== 'handoff') return;
        this.wait = null;
        if (result.ready === true) this.enterBattle();
        else this.returnToMain(result.error);
    }

    private enterBattle(): void {
        const model = this.options.model;
        const { opponents } = model.snapshot();
        const entry = this.options.entry;
        EventMgr.instance.emit(MATCHING_EVENTS.LEAVE, {
            destination: 'battle',
            entry: {
                battle: model.battle,
                session: this.session,
                opponent: opponents[0],
                opponents,
                selfRoleId: model.selfRoleId,
                pve: entry?.pve,
                battleType: entry?.battleType,
            },
        } satisfies IMatchingLeave);
    }

    private fail(error: unknown): void {
        if (this.isDisposed || this.isLeaving) return;
        this.isLeaving = true;
        this.dispose();
        this.returnToMain(error);
    }

    private returnToMain(error: unknown): void {
        EventMgr.instance.emit(MATCHING_EVENTS.LEAVE, {
            destination: 'main', error,
        } satisfies IMatchingLeave);
    }

    private render(): void {
        EventMgr.instance.emit(MATCHING_EVENTS.STATE, this.options.model.snapshot());
    }

    private logFailure(error: unknown): void {
        console.error('[MatchingController]', error);
    }
}
