import { Prefab, type Node } from 'cc';
import { bundleForPath } from '../../../core/asset/BundleCatalog';
import { ResourceScope } from '../../../core/asset/ResourceScope';
import { ControllerBase, type IControllerContext, type IControllerResources } from '../../../framework/controller/ControllerBase';
import { EventMgr } from '../../../framework/event/EventMgr';
import type { ProcedurePreloadContext } from '../../../framework/procedure/ProcedureBase';
import { ZCGame } from '../../zcds/ZCGame';
import { createZCBattleSession } from '../../zcds/application/ZCBattlePreparation';
import type { IZCGameEntry, ZCGameEntryParams } from '../../zcds/application/ZCGameEntry';
import type { ZCBattleController } from '../../zcds/application/ZCBattleController';
import { buildZCBattleReturnParams } from '../../zcds/application/ZCBattleEntryBuilder';
import { ZCBattleRuntimeController } from '../../zcds/application/ZCBattleRuntimeController';
import { ZCBattleSettlementController, type IZCBattleRankDialogPort } from '../../zcds/application/ZCBattleSettlementController';
import type { IZCBattleConfirmOptions, IZCBattleDialogPort, IZCBattleRuntimeServices } from '../../zcds/application/ZCBattleRuntimeContract';
import type { IZCBattleSettlementServices } from '../../zcds/application/ZCBattleSettlementController';
import type { IZCGuidePreparedContent } from '../../zcds/model/ZCGuideConfig';
import type { IRankSeat, RankSeatProfiles } from '../../zcds/model/ZCRankBoard';
import type { IZCDamageStatsSeats, IZCDamageStatsUnit } from '../../zcds/model/ZCDamageStats';
import { ZCSettlementPage, type IZCSettlementOptions } from '../../zcds/ui/ZCSettlementPage';
import { GameRunAway } from '../../zcds/ui/GameRunAway';
import { ZCGuidePanel } from '../../zcds/ui/ZCGuidePanel';
import { CommonTips } from '../../common/CommonTips';
import { Toast } from '../../common/Toast';
import { ZCGameRankBoard } from '../../zcds/view/ZCGameRankBoard';
import { PopupCloseReason, PopupLayer } from '../../../framework/ui/PopupDef';
import { ProcedureManager } from '../../../framework/procedure/ProcedureManager';
import { FW } from '../../../framework/FW';
import { AudioMgr } from '../../../framework/audio/AudioMgr';
import { GAME_AUDIO } from '../../ResConst';
import { GameRoute } from '../../../core/runtime/GameRoute';
import { BattleResultService } from '../../battle/BattleResultService';
import { finishBattle, BATTLE_RESULT_WIN, BATTLE_RESULT_LOSE } from '../../battle/BattleStartService';
import { GameNet } from '../../net/GameNet';
import { resolveCmdGoodsFrames } from '../../showReward/RewardFrames';
import {
    ZC_BATTLE_EVENTS,
    type IZCBattleShowTip,
    type ZCBattlePopupCommand,
    type ZCBattlePopupPhase,
} from '../../zcds/application/ZCBattleEvents';
import { GuideComposition } from '../guide/GuideComposition';
import { reportBattleGuideSettled } from '../../guide/application/GuideEvents';

/** Cocos 运行期、资源服务、弹窗托管和存档适配器只在组合边界装配。 */
export class BattleComposition extends ControllerBase {
    private readonly controller: ZCBattleController<ZCGame>;
    private returnParams: ReturnType<typeof buildZCBattleReturnParams>;
    get current(): ZCGame | null { return this.controller.current; }
    constructor(private readonly context: IControllerContext, private readonly host: Node, params?: ZCGameEntryParams) {
        super(context, 'battle-composition');
        this.resources.sessionAssets.pauseWarmup?.();
        this.controller = params?.session ?? createZCBattleSession(context, { owner: this.scope, params });
        this.own(this.controller.scope.defer(() => this.releaseInputs()));
        this.listen(ZC_BATTLE_EVENTS.RETURN_TO_MAIN, this.onReturnToMain);
        this.listen(ZC_BATTLE_EVENTS.SHOW_TIP, this.onShowTip);
    }

    async preload(params: ZCGameEntryParams | undefined, context: ProcedurePreloadContext): Promise<void> {
        await this.controller.adopt(params, context);
    }

    mount(): void {
        this.controller.mount({
            createRuntime: () => this.createRuntime(),
            createRuntimeController: (view, entry, resources) => this.createRuntimeController(view, entry, resources),
        });
        void AudioMgr.instance.playMusic(GAME_AUDIO.battleMusic);
        this.own(() => AudioMgr.instance.stopMusic());
    }

    private createRuntime(): ZCGame {
        return this.host.addComponent(ZCGame);
    }

    private createRuntimeController(view: ZCGame, entry: IZCGameEntry, resources: IControllerResources): ZCBattleRuntimeController {
        BattleResultService.ensureListening();
        this.returnParams = buildZCBattleReturnParams(entry);
        const popups = this.createPopupHost(view, resources);
        const settlement = this.createSettlementController(view, entry, resources, popups);
        try {
            const runtime = new ZCBattleRuntimeController(this.context, view, settlement,
                this.createRuntimeServices(view, resources, popups), this.controller);
            if (entry.pveContext?.levelId === 10001) {
                const guide = new GuideComposition(this.context, this.host, 'battle');
                this.own(() => guide.dispose());
            }
            return runtime;
        } catch (error) {
            try {
                settlement.dispose();
            } catch (cleanupError) {
                console.error('[BattleComposition] 装配失败后的结算清理失败', cleanupError);
            }
            popups.dispose();
            throw error;
        }
    }

    private createPopupHost(view: ZCGame, resources: IControllerResources): BattlePopupHost {
        const popups = new BattlePopupHost(
            view,
            victory => playBattleOutcomeAudio(resources, victory),
            error => console.warn('[BattleComposition] 弹窗流程失败', error),
        );
        resources.scope.defer(() => popups.dispose());
        return popups;
    }

    private createClock(view: ZCGame): IZCBattleRuntimeServices['clock'] {
        return {
            schedule(callback, seconds) {
                view.scheduleOnce(callback, seconds);
                return () => view.unschedule(callback);
            },
        };
    }

    private createRuntimeServices(
        view: ZCGame,
        resources: IControllerResources,
        popups: BattlePopupHost,
    ): IZCBattleRuntimeServices {
        const loadPrefab = (path: string) =>
            resources.assets.load(path, Prefab, { scope: resources.scope, bundle: bundleForPath(path) });
        return {
            audio: {
                playSound(key) {
                    void AudioMgr.instance.playSound(key, resources.scope);
                },
            },
            art: {
                loadUnitPrefab: loadPrefab,
                loadEffectPrefab: loadPrefab,
            },
            dialogs: popups.runtimeDialogs,
            clock: this.createClock(view),
            //  屏幕中央飘字（2026-11-26 第 56 批集火提示）。装配在这里而不是控制器里 import：
            //  `common/Toast` 顶层依赖 `cc`，而 application 层要能被 node 用例直接 import。
            toast(message) { Toast.show(message); },
            failed(error) {
                console.warn('[BattleComposition] 对局运行期失败', error);
            },
        };
    }

    private createSettlementController(
        view: ZCGame,
        entry: IZCGameEntry,
        resources: IControllerResources,
        popups: BattlePopupHost,
    ): ZCBattleSettlementController {
        return new ZCBattleSettlementController(this.context, this.createSettlementServices(resources, popups),
            { owner: view, hasPveContext: !!entry.pveContext });
    }

    private createSettlementServices(
        resources: IControllerResources,
        popups: BattlePopupHost,
    ): IZCBattleSettlementServices {
        return {
            results: BATTLE_RESULTS,
            rewards: {
                async loadRewards(result) {
                    if (!result.goods.length) return [];
                    const rewards = await resolveCmdGoodsFrames(result.goods, resources);
                    return rewards.map(({ entry: reward }) => ({ resId: reward.resId, amount: reward.number }));
                },
            },
            rank: popups.settlementRank,
            flow: BATTLE_FLOW,
            failed(error) {
                console.warn('[BattleComposition] 结算失败', error);
            },
        };
    }

    private onReturnToMain(_payload: undefined, source: object): void {
        if (!this.controller.current || source !== this.controller.current) return;
        // 🔴 不能只报 `backToMap`：玩家「跳过战斗 / 提前返回」时可能连抽卡演出都没看完
        //    （`cardRevealFinished` 不上报），引导会永久停在 5-3、回主界面后什么都不显示
        //    —— 用户 2026-11-24「打完 1-1 出来没引导升级卡牌」。离开对局即把战斗步一并了结，
        //    表序与命中规则见 `reportBattleGuideSettled`。
        reportBattleGuideSettled();
        ProcedureManager.navigate(GameRoute.Main, this.returnParams);
    }

    private onShowTip({ message }: IZCBattleShowTip, source: object): void {
        if (!this.controller.current || source !== this.controller.current) return;
        FW.showTip(message);
    }

    dispose(): void {
        try {
            this.controller.dispose();
        } finally {
            super.dispose();
        }
    }
}

// 无会话状态的适配器复用既有服务；资源、弹窗与时钟适配器在每局绑定真实 scope/宿主。
const BATTLE_RESULTS: IZCBattleSettlementServices['results'] = {
    waitResult(type, caller) {
        return BattleResultService.waitForBattleResult(type, undefined, caller);
    },
    finish(request, caller) {
        return finishBattle(request.elapsedSeconds, request.localVictory ? BATTLE_RESULT_WIN : BATTLE_RESULT_LOSE,
            request.commands, request.statistics, caller);
    },
    cancelRequests(caller) {
        GameNet.instance.removeCaller(caller);
        BattleResultService.cancelWait(caller);
    },
};
const BATTLE_FLOW: IZCBattleSettlementServices['flow'] = {
    watchSwitch(callback) { return ProcedureManager.onSwitchSettled(callback); },
};

function playBattleOutcomeAudio(resources: IControllerResources, victory: boolean): void {
    const audio = AudioMgr.instance;
    audio.stopMusic();
    void audio.playSound(victory ? GAME_AUDIO.victory : GAME_AUDIO.defeat, resources.scope);
}

/** 单局弹窗托管：以阶段 ResourceScope 交由 PopupManager 统一取消与关闭，只保留阻塞对话和实时刷新状态。 */
class BattlePopupHost {
    private readonly scope = new ResourceScope('battle-popups');
    private readonly runtimeScope = new ResourceScope('battle-runtime-popups');
    private readonly settlementScope = new ResourceScope('battle-settlement-popups');
    private readonly confirmCancel: { current: (() => void) | null } = { current: null };
    private readonly rankCancel: { current: (() => void) | null } = { current: null };
    private damageScope: ResourceScope | null = null;
    private damagePopup: GameRunAway | null = null;
    private damagePhase: ZCBattlePopupPhase | null = null;
    private settlementPopup: ZCSettlementPage | null = null;

    readonly runtimeDialogs: IZCBattleDialogPort = {
        confirm: options => this.confirm(options),
        cancel: () => this.confirmCancel.current?.(),
    };
    readonly settlementRank: IZCBattleRankDialogPort = {
        present: (seats, profiles) => this.presentSettlementRank(seats, profiles),
        cancel: () => this.rankCancel.current?.(),
    };

    constructor(
        private readonly owner: object,
        private readonly onSettlementOpened: (victory: boolean) => void,
        private readonly onFailed: (error: unknown) => void,
    ) {
        this.scope.defer(() => this.settlementScope.dispose());
        this.scope.defer(() => this.runtimeScope.dispose());
        this.scope.defer(() => EventMgr.instance.offTarget(this));
        EventMgr.instance.on(ZC_BATTLE_EVENTS.POPUP_COMMAND, this.onCommand, this);
    }

    private onCommand(command: ZCBattlePopupCommand, source: object): void {
        if (source !== this.owner) return;
        const report = (error: unknown) => {
            if (!this.scope.disposed) this.onFailed(error);
        };
        switch (command.kind) {
            case 'openGuide':
                void this.openGuide(command.content).catch(report);
                return;
            case 'openDamage':
                void this.openDamage(command.phase, command.units, command.seats).catch(report);
                return;
            case 'refreshDamage':
                if (this.damagePhase === 'runtime' && this.damagePopup?.isPopupOpen) {
                    this.damagePopup.refresh(command.units);
                }
                return;
            case 'openRank':
                void this.openRankPreview(command.seats, command.profiles).catch(report);
                return;
            case 'closeRuntimePopups':
                this.runtimeScope.dispose();
                return;
            case 'openSettlement':
                void this.openSettlement(command.options, command.playOutcome).catch(report);
                return;
            case 'closeSettlement':
                this.closeSettlement(command.reason);
                return;
            case 'closeSettlementPopups':
                this.settlementScope.dispose();
                return;
        }
    }

    private openGuide(content: IZCGuidePreparedContent): Promise<ZCGuidePanel | null> {
        return ZCGuidePanel.open({
            scope: this.runtimeScope,
            userData: { content },
        });
    }

    private async openDamage(
        phase: ZCBattlePopupPhase,
        units: readonly IZCDamageStatsUnit[],
        seats?: IZCDamageStatsSeats,
    ): Promise<void> {
        const phaseScope = phase === 'runtime' ? this.runtimeScope : this.settlementScope;
        if (phaseScope.disposed) {
            this.emitDamageState(phase, false);
            return;
        }
        if (this.damagePhase === phase && (this.damageScope !== null || this.damagePopup?.isPopupOpen)) {
            this.emitDamageState(phase, this.damagePopup?.isPopupOpen ?? false);
            return;
        }
        if (phase === 'settlement' && this.damagePhase === 'runtime') {
            this.damageScope?.dispose();
        }
        const openScope = new ResourceScope(`battle-damage-${phase}`);
        const detachPhase = phaseScope.defer(() => openScope.dispose());
        this.damageScope = openScope;
        this.damagePhase = phase;
        let closed = false;
        const release = () => {
            if (closed) return;
            closed = true;
            detachPhase();
            if (this.damageScope === openScope) {
                this.damageScope = null;
                this.damagePopup = null;
                this.damagePhase = null;
            }
            this.emitDamageState(phase, false);
        };
        openScope.defer(release);
        let popup: GameRunAway | null = null;
        try {
            popup = await GameRunAway.open({
                scope: openScope,
                closeOnBlank: true,
                userData: { units, seats },
                onClose: () => {
                    release();
                    openScope.dispose();
                },
            });
        } catch (error) {
            release();
            openScope.dispose();
            throw error;
        }
        if (!popup || openScope.disposed) {
            release();
            openScope.dispose();
            return;
        }
        this.damagePopup = popup;
        this.emitDamageState(phase, true);
    }

    private emitDamageState(phase: ZCBattlePopupPhase, open: boolean): void {
        if (this.scope.disposed) return;
        EventMgr.instance.emit(ZC_BATTLE_EVENTS.DAMAGE_POPUP_STATE, { phase, open }, this.owner);
    }

    private openRankPreview(seats: readonly IRankSeat[], profiles: RankSeatProfiles): Promise<ZCGameRankBoard | null> {
        return ZCGameRankBoard.open({
            scope: this.runtimeScope,
            closeOnBlank: true,
            userData: { seats, profiles },
        });
    }

    private presentSettlementRank(seats: readonly IRankSeat[], profiles: RankSeatProfiles): Promise<void> {
        this.runtimeScope.dispose();
        return this.awaitScopedDialog(this.settlementScope, undefined, this.rankCancel, (scope, finish) =>
            ZCGameRankBoard.open({
                scope,
                closeOnBlank: true,
                userData: { seats, profiles },
                onClose: () => finish(undefined),
            }),
        );
    }

    /**
     * 询问式确认框（通用 `ui/common/CommonTips`）。
     *
     * 「确定」走 `onSure`（在关窗之前触发），其余一切关闭来源（取消 / 点空白 / 强制关）都走 `onClose`。
     * 一次确认：不透传 `CommonTips.confirmAgainText`（2026-11-11 口径，见 `RETREAT_CONFIRM`）。
     */
    private confirm(options: IZCBattleConfirmOptions): Promise<boolean> {
        return this.awaitScopedDialog(this.runtimeScope, false, this.confirmCancel, (scope, finish) =>
            CommonTips.open({
                scope,
                userData: {
                    content: options.content,
                    title: options.title,
                    sureText: options.sureText,
                    cancelText: options.cancelText,
                    onSure: () => finish(true),
                },
                onClose: () => finish(false),
            }),
        );
    }

    private awaitScopedDialog<TResult>(
        phaseScope: ResourceScope,
        fallback: TResult,
        cancelRef: { current: (() => void) | null },
        start: (scope: ResourceScope, finish: (result: TResult) => void) => Promise<unknown>,
    ): Promise<TResult> {
        if (phaseScope.disposed) return Promise.resolve(fallback);
        cancelRef.current?.();
        const dialogScope = new ResourceScope('battle-dialog');
        const detachPhase = phaseScope.defer(() => dialogScope.dispose());
        return new Promise<TResult>((resolve, reject) => {
            let settled = false;
            const finish = (result: TResult) => {
                if (settled) return;
                settled = true;
                detachPhase();
                if (cancelRef.current === cancel) cancelRef.current = null;
                resolve(result);
            };
            const cancel = () => {
                finish(fallback);
                dialogScope.dispose();
            };
            cancelRef.current = cancel;
            dialogScope.defer(() => finish(fallback));
            void start(dialogScope, finish).then(
                popup => {
                    if (!popup) finish(fallback);
                },
                error => {
                    if (settled) return;
                    settled = true;
                    detachPhase();
                    if (cancelRef.current === cancel) cancelRef.current = null;
                    reject(error);
                },
            );
        });
    }

    private async openSettlement(options: IZCSettlementOptions, playOutcome: boolean): Promise<void> {
        if (this.settlementScope.disposed || this.settlementPopup?.isPopupOpen) return;
        const popup = await ZCSettlementPage.open({
            scope: this.settlementScope,
            layer: PopupLayer.SYSTEM,
            closeOnBlank: false,
            userData: options,
            onClose: () => {
                if (this.settlementPopup === popup) this.settlementPopup = null;
            },
        });
        if (!popup) return;
        const isFirstOpen = this.settlementPopup !== popup;
        this.settlementPopup = popup;
        if (playOutcome && isFirstOpen) this.onSettlementOpened(options.victory);
    }

    private closeSettlement(reason: 'manual' | 'force'): void {
        const settlement = this.settlementPopup;
        this.settlementPopup = null;
        if (settlement && settlement.isPopupOpen !== false) {
            settlement.close(reason === 'manual' ? PopupCloseReason.Manual : PopupCloseReason.Force);
        }
    }

    dispose(): void {
        this.scope.dispose();
    }
}
