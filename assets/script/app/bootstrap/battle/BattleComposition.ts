import { Prefab, type Node } from 'cc';
import { bundleForPath } from '../../../core/asset/BundleCatalog';
import { ControllerBase, type IControllerContext, type IControllerResources } from '../../../framework/controller/ControllerBase';
import type { ProcedurePreloadContext } from '../../../framework/procedure/ProcedureBase';
import { ZCGame } from '../../zcds/ZCGame';
import { createZCBattleSession } from '../../zcds/application/ZCBattlePreparation';
import type { IZCGameEntry, ZCGameEntryParams } from '../../zcds/application/ZCGameEntry';
import type { ZCBattleController } from '../../zcds/application/ZCBattleController';
import { buildZCBattleReturnParams } from '../../zcds/application/ZCBattleEntryBuilder';
import { ZCBattleRuntimeController } from '../../zcds/application/ZCBattleRuntimeController';
import { ZCBattleSettlementController } from '../../zcds/application/ZCBattleSettlementController';
import type { IZCBattleRuntimeServices } from '../../zcds/application/ZCBattleRuntimeContract';
import type { IZCBattlePopup, IZCBattleSettlementServices } from '../../zcds/application/ZCBattleSettlementController';
import { ZCSettlementPage } from '../../zcds/ui/ZCSettlementPage';
import { GameRunAway } from '../../zcds/ui/GameRunAway';
import { ZCGuidePanel } from '../../zcds/ui/ZCGuidePanel';
import { CommonTips } from '../../common/CommonTips';
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
        this.controller.mount({
            createRuntime: () => this.createRuntime(),
            createRuntimeController: (view, entry, resources) => this.createRuntimeController(view, entry, resources),
        });
    }
    private createRuntime(): ZCGame {
        return this.host.addComponent(ZCGame);
    }
    private createRuntimeController(view: ZCGame, entry: IZCGameEntry, resources: IControllerResources): ZCBattleRuntimeController {
        BattleResultService.ensureListening();
        this.returnParams = buildZCBattleReturnParams(entry);
        const settlement = this.createSettlementController(view, entry, resources);
        try {
            return new ZCBattleRuntimeController(this.context, view, settlement,
                createBattleRuntimeServices(view, resources), this.controller);
        } catch (error) {
            try { settlement.dispose(); }
            catch (cleanupError) { console.error('[BattleComposition] 装配失败后的结算清理失败', cleanupError); }
            throw error;
        }
    }
    private createSettlementController(view: ZCGame, entry: IZCGameEntry, resources: IControllerResources): ZCBattleSettlementController {
        return new ZCBattleSettlementController(this.context, createBattleSettlementServices(resources),
            { owner: view, hasPveContext: !!entry.pveContext });
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

// 无会话状态的适配器复用既有服务；资源与时钟适配器在每局绑定真实 scope/宿主。
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
const BATTLE_POPUPS: IZCBattleRuntimeServices['popups'] & IZCBattleSettlementServices['popup'] = {
    open(options) {
        return wrapPopup(ZCSettlementPage.open({ layer: PopupLayer.SYSTEM, closeOnBlank: false, userData: options }));
    },
    openGuide(content) { return wrapPopup(ZCGuidePanel.open({ userData: { content } })); },
    async openDamage(players) {
        const popup = await GameRunAway.open({ closeOnBlank: true, userData: { players } });
        return popup ? {
            get isOpen() { return popup.isPopupOpen; },
            refresh: players => popup.refresh(players),
            close: () => { if (popup.isPopupOpen) popup.close(PopupCloseReason.Force); },
        } : null;
    },
    openRank(seats, profiles) {
        // 结算要先等玩家把排行榜关掉再弹奖励页 ⇒ 这里把「关闭」也交出去（`onClose` 覆盖
        // 点空白 / 按钮 / 强制关闭三种来源）。打开失败时必须照样兑现，否则结算永远停在等待。
        let resolveClosed: () => void = () => {};
        const whenClosed = new Promise<void>(resolve => { resolveClosed = resolve; });
        return ZCGameRankBoard.open({
            userData: { seats, profiles }, closeOnBlank: true, onClose: () => resolveClosed(),
        }).then(popup => {
            if (!popup) { resolveClosed(); return null; }
            return {
                whenClosed,
                close: () => { if (popup.isPopupOpen) popup.close(PopupCloseReason.Force); },
            };
        }, error => { resolveClosed(); throw error; });
    },
    /**
     * 询问式确认框（通用 `ui/common/CommonTips`）。
     *
     * 「确定」走 `onSure`（在关窗之前触发），其余一切关闭来源（取消 / 点空白 / 强制关）都走 `onClose`。
     * 两条路都兑现 `answered`，所以调用方**不会**出现「点了确定却永远等不到回答」。
     *
     * 一次确认：不透传 `CommonTips.confirmAgainText`（2026-11-11 口径，见 `RETREAT_CONFIRM`）。
     */
    confirm(options) {
        let resolveAnswer: (answer: boolean) => void = () => {};
        const answered = new Promise<boolean>(resolve => { resolveAnswer = resolve; });
        return CommonTips.open({
            userData: {
                content: options.content, title: options.title,
                sureText: options.sureText, cancelText: options.cancelText,
                onSure: () => resolveAnswer(true),
            },
            onClose: () => resolveAnswer(false),
        }).then(popup => {
            if (!popup) { resolveAnswer(false); return null; }
            return { answered, close: () => { if (popup.isPopupOpen) popup.close(PopupCloseReason.Force); } };
        }, error => { resolveAnswer(false); throw error; });
    },
};
async function wrapPopup(pending: Promise<{ close(reason: PopupCloseReason): void } | null>): Promise<IZCBattlePopup | null> {
    const popup = await pending;
    return popup ? { close: reason => popup.close(reason === 'manual' ? PopupCloseReason.Manual : PopupCloseReason.Force) } : null;
}
function createBattleRuntimeServices(view: ZCGame, resources: IControllerResources): IZCBattleRuntimeServices {
    return {
        art: {
            loadUnitPrefab(path) {
                return resources.assets.load(path, Prefab, { scope: resources.scope, bundle: bundleForPath(path) });
            },
            loadEffectPrefab(path) {
                //  与单位模型同一条加载通道：`bundleForPath('units/projectiles/…')` 也是 `battle`。
                return resources.assets.load(path, Prefab, { scope: resources.scope, bundle: bundleForPath(path) });
            },
        },
        popups: BATTLE_POPUPS,
        clock: {
            schedule(callback, seconds) {
                view.scheduleOnce(callback, seconds);
                return () => view.unschedule(callback);
            },
        },
        failed(error) { console.warn('[BattleComposition] 对局运行期失败', error); },
    };
}
function createBattleSettlementServices(resources: IControllerResources): IZCBattleSettlementServices {
    return {
        results: BATTLE_RESULTS,
        rewards: {
            async loadRewards(result) {
                if (!result.goods.length) return [];
                const rewards = await resolveCmdGoodsFrames(result.goods, resources);
                return rewards.map(({ entry: reward }) => ({ resId: reward.resId, amount: reward.number }));
            },
        },
        popup: BATTLE_POPUPS,
        flow: BATTLE_FLOW,
        failed(error) { console.warn('[BattleComposition] 结算失败', error); },
    };
}
