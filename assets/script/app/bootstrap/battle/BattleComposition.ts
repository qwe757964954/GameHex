import type { Node } from 'cc';
import { ControllerBase, type IControllerContext } from '../../../framework/controller/ControllerBase';
import type { ProcedurePreloadContext } from '../../../framework/procedure/ProcedureBase';
import { ZCGame } from '../../zcds/ZCGame';
import { createZCBattleSession } from '../../zcds/application/ZCBattlePreparation';
import type { ZCGameEntryParams } from '../../zcds/application/ZCGameEntry';
import type { ZCBattleController } from '../../zcds/application/ZCBattleController';
import { buildZCBattleReturnParams } from '../../zcds/application/ZCBattleEntryBuilder';
import { ZCBattleRuntimeController } from '../../zcds/application/ZCBattleRuntimeController';
import { ZCBattleSettlementController } from '../../zcds/application/ZCBattleSettlementController';
import type { IZCBattlePopup } from '../../zcds/application/ZCBattleSettlementController';
import { ZCSettlementPage } from '../../zcds/ui/ZCSettlementPage';
import { GameRunAway } from '../../zcds/ui/GameRunAway';
import { ZCGuidePanel } from '../../zcds/ui/ZCGuidePanel';
import { ZCGameRankBoard } from '../../zcds/view/ZCGameRankBoard';
import { PopupCloseReason, PopupLayer } from '../../../framework/ui/PopupDef';
import { ProcedureManager } from '../../../framework/procedure/ProcedureManager';
import { FW } from '../../../framework/FW';
import { GameRoute } from '../../../core/runtime/GameRoute';
import { BattleResultService } from '../../battle/BattleResultService';
import { finishBattle, BATTLE_RESULT_WIN, BATTLE_RESULT_LOSE } from '../../battle/BattleStartService';
import { GameNet } from '../../net/GameNet';
import { resolveCmdGoodsFrames } from '../../showReward/RewardFrames';
import { ZC_BATTLE_EVENTS, type IZCBattleReturnToMain, type IZCBattleShowTip } from '../../zcds/application/ZCBattleEvents';

/** Cocos 运行期、资源服务和存档适配器只在组合边界装配。 */
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
        const context = this.context;
        this.controller.mount({
            createRuntime: () => this.host.addComponent(ZCGame),
            createRuntimeController: (view, entry, resources) => {
                BattleResultService.ensureListening();
                this.returnParams = buildZCBattleReturnParams(entry);
                const wrapPopup = async (pending: Promise<{ close(reason: PopupCloseReason): void } | null>): Promise<IZCBattlePopup | null> => {
                    const popup = await pending;
                    return popup ? { close: reason => popup.close(reason === 'manual' ? PopupCloseReason.Manual : PopupCloseReason.Force) } : null;
                };
                const settlement = new ZCBattleSettlementController(context, {
                    waitResult: (type, caller) => BattleResultService.waitForBattleResult(type, undefined, caller),
                    finish: (request, caller) => finishBattle(request.elapsedSeconds, request.localVictory ? BATTLE_RESULT_WIN : BATTLE_RESULT_LOSE, request.commands, request.statistics, caller),
                    loadRewards: async result => {
                        if (!result.goods.length) return [];
                        const rewards = await resolveCmdGoodsFrames(result.goods, resources);
                        return rewards.map(({ entry: reward }) => ({ resId: reward.resId, amount: reward.number }));
                    },
                    open: options => wrapPopup(ZCSettlementPage.open({ layer: PopupLayer.SYSTEM, closeOnBlank: false, userData: options })),
                    watchSwitch: callback => ProcedureManager.onSwitchSettled(callback),
                    cancelRequests: caller => { GameNet.instance.removeCaller(caller); BattleResultService.cancelWait(caller); },
                    failed: error => console.warn('[BattleComposition] 结算失败', error),
                }, { owner: view, hasPveContext: !!entry.pveContext });
                try {
                    return new ZCBattleRuntimeController(context, view, settlement, {
                        openGuide: content => wrapPopup(ZCGuidePanel.open({ userData: { content } })),
                        openDamage: summary => wrapPopup(GameRunAway.open({ userData: summary })),
                        openRank: (seats, profiles) => wrapPopup(ZCGameRankBoard.open({ userData: { seats, profiles } })),
                        schedule: (callback, seconds) => { view.scheduleOnce(callback, seconds); return () => view.unschedule(callback); },
                        failed: error => console.warn('[BattleComposition] 对局弹窗失败', error),
                    }, this.controller);
                } catch (error) {
                    try { settlement.dispose(); }
                    catch (cleanupError) { console.error('[BattleComposition] 装配失败后的结算清理失败', cleanupError); }
                    throw error;
                }
            },
        });
    }
    private onReturnToMain({ owner }: IZCBattleReturnToMain): void {
        if (!this.controller.current || owner !== this.controller.current) return;
        ProcedureManager.navigate(GameRoute.Main, this.returnParams);
    }
    private onShowTip({ owner, message }: IZCBattleShowTip): void {
        if (!this.controller.current || owner !== this.controller.current) return;
        FW.showTip(message);
    }
    dispose(): void {
        try { this.controller.dispose(); }
        finally { super.dispose(); }
    }
}
