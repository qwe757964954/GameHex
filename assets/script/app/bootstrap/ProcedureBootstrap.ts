import { _decorator, Component } from 'cc';
import { DEBUG } from 'cc/env';
import { GameRoute } from '../../core/runtime/GameRoute';
import { ResourceLoadManager } from '../../core/asset/ResourceLoadManager';
import { AudioMgr, bindAudioToFramework } from '../../framework/audio/AudioMgr';
import { FW } from '../../framework/FW';
import { Log } from '../../framework/log/Log';
import { ProcedureManager } from '../../framework/procedure/ProcedureManager';
import { PopupManager } from '../../framework/ui/PopupManager';
import { CocosAssetService } from '../../platform/cocos/CocosAssetService';
import { RefConfigService } from '../../platform/config/RefConfigService';
import { FetchNetworkTransport } from '../../platform/network/FetchNetworkTransport';
import { CenterPaymentService } from '../../platform/payment/CenterPaymentService';
import { ProcedureGame } from '../procedure/ProcedureGame';
import { ProcedureLogin } from '../procedure/ProcedureLogin';
import { ProcedureMain } from '../procedure/ProcedureMain';
import { ProcedureMatching } from '../procedure/ProcedureMatching';
import { ProcedurePostLogin } from '../procedure/ProcedurePostLogin';
import { ProcedureUpdate } from '../procedure/ProcedureUpdate';
import { AppSessionAssetService } from '../session/AppSessionAssetService';
import { ShowRewardPage } from '../showReward/ShowRewardPage';
import { Toast } from '../common/Toast';
import { EventMgr } from '../../framework/event/EventMgr';
import { PopupLayer } from '../../framework/ui/PopupDef';
import { REWARD_ITEM_DETAIL_INTENT, type IRewardItemDetailIntent } from '../common/RewardItemEvents';
import { ItemDetailPage } from '../itemdetail/ItemDetailPage';
import { registerRdVars } from '../rd/RdRegistry';
import { GameNet } from '../net/GameNet';
import { GameSocketBridge } from '../gm/GameSocketBridge';
import { createCardPopupComposition } from './card/CardPopupComposition';
import { createLeaguePopupComposition } from './LeaguePopupComposition';
import { createLeagueCreatePopupComposition } from './LeagueCreatePopupComposition';
import { createLeagueDonatePopupComposition } from './LeagueDonatePopupComposition';
import { ensureZCRuntimeCompiled } from '../zcds/application/ZCRuntimePrecompiler';
import { resetZCRuntime } from '../zcds/model/ZCGameRuntimeConfig';

const { ccclass } = _decorator;
const RESOURCE_LOAD_CONCURRENCY = 4;

/**
 * 应用组合根：这是唯一可以同时了解 framework、platform 和具体业务流程的地方。
 *
 * `.meta` 沿用迁移前的 UUID，所以 Root.scene 上原有组件绑定无需重做。
 */
@ccclass('ProcedureBootstrap')
export class ProcedureBootstrap extends Component {
    public static __cname: string = 'ProcedureBootstrap';
    private resourceLoads: ResourceLoadManager | null = null;

    private readonly onRewardItemDetail = (intent: IRewardItemDetailIntent): void => {
        if (!Number.isSafeInteger(intent.resId) || intent.resId <= 0) return;
        // 奖励为预览数量，不能当成背包持有量开启合成；SYSTEM 层保证压在战斗结算页之上。
        void ItemDetailPage.open({
            userData: { resId: intent.resId, number: 0 },
            layer: PopupLayer.SYSTEM,
            allowMultiple: true,
        }).catch(error => { console.error('[RewardItem] 打开物品详情失败', error); });
    };

    /** 真实支付发货广播：`CmdRecharge.rewards` 才是本次到账明细。 */
    private readonly onRechargeSettled = (msg: CmdRechargeBroMsg): void => {
        FW.ShowReward(msg?.cmdRecharge?.rewards ?? []);
    };

    onLoad(): void {
        // 发布构建收口日志：cc/env 的 DEBUG 只在发布构建里为 false。
        // 编辑器 / 预览为 true；Node 单测沙箱把 cc/env mock 成空对象（undefined）。
        // 两种情况都不触发，避免误关测试与开发期日志。hideLog 保留 warn / error。
        if (DEBUG === false) Log.hideLog();
        this.configurePresentation();
        this.configurePayment(new FetchNetworkTransport());
        this.configureAudioAndIndicators();
        const manager = this.createProcedureManager();
        this.configureServices(manager);
        this.configurePopups(manager);
        this.registerRoutes(manager);
        manager.navigate(GameRoute.Update);
        GameSocketBridge.install();
    }
    private configurePresentation(): void {
        // framework 的提示出口 → app 层吐司。
        // 放在组合根而不是 FW.ts 里，是为了守住「framework 不反向依赖 app」这条线；
        // 赋值是幂等的，重复进场景也不会出问题。
        FW.showTip = (tip: string) => { Toast.show(tip); };
        // 「获得奖励」弹窗出口 → app 层的 `ShowRewardPage`。放在组合根的原因同 `showTip`
        // （framework 不反向依赖 app）。`ShowRewardPage` 内部只走 `PopupManager`，没有前置依赖；
        // 没有 `PopupManager` 时 `PopupBase.open` 会打一条 error 并返 null，不会抛。
        FW.showReward = (goods, isGold) => {
            void ShowRewardPage.open({ userData: { goods, isGold } });
        };
        // 对齐 2.0 `ModelStore.enter()`：支付请求/中心服开单本身不代表发货，必须等游戏服
        // `CmdRechargeBroMsg`。首充、灵玉直充等所有充值入口共用这一条全局结算出口。
        GameNet.instance.addEvent('CmdRechargeBroMsg', this, this.onRechargeSettled);
        EventMgr.instance.on(REWARD_ITEM_DETAIL_INTENT, this.onRewardItemDetail, this);
    }
    private configurePayment(network: FetchNetworkTransport): void {
        const payment = CenterPaymentService.instance(network);
        // 支付出口：中心服开单/内部账号发货已经落地；真实渠道扣款由 PaymentService 的平台处理器注入。
        FW.pay = (payChannelId, fromType, fromId) => {
            void payment.pay(payChannelId, fromType, fromId).catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                console.error('[Pay] 支付失败', error);
                FW.showTip(message);
            });
        };
    }
    private configureAudioAndIndicators(): void {
        // 音频：读本地存档（`setting_music/setting_sound<account>`）+ 建常驻 AudioRoot，
        // 并把 `FW.playSound` 从空实现接到真播放（framework 层自己不敢 import，
        // `FW → AudioMgr → ResourceMgr → FW` 是循环引用）。
        // 幂等：重复进场景只是再读一次存档。
        AudioMgr.instance.init();
        bindAudioToFramework(FW);
        // 红点变量注册 —— 必须早于任何界面调 `ToolSet.AddScriptListener(expr)`，
        // 否则表达式里的 `[RDXxx]` 找不到类、静默退化成 0（见 RdRegistry 文件头）。
        // 幂等，重复进场景重复调无副作用。
        registerRdVars();
    }
    private createProcedureManager(): ProcedureManager {
        return this.getComponent(ProcedureManager) ?? this.addComponent(ProcedureManager);
    }
    private configureServices(manager: ProcedureManager): void {
        const assets = new ResourceLoadManager(new CocosAssetService(), { maxConcurrentLoads: RESOURCE_LOAD_CONCURRENCY });
        this.resourceLoads = assets;
        const configs = new RefConfigService();
        const callbackOwners = GameNet.instance.callbackOwners;
        const sessionAssets = new AppSessionAssetService(assets, configs, {
            // 组合根注入：会话空闲期预编译运行时目录，退出登录复位；会话层不静态依赖战斗模块。
            ensureCompiled: () => ensureZCRuntimeCompiled(configs),
            reset: () => resetZCRuntime(),
        });
        manager.configure({
            assets,
            sessionAssets,
            configs,
            network: new FetchNetworkTransport(),
            callbackOwners,
        });
    }
    private configurePopups(manager: ProcedureManager): void {
        PopupManager.inst.initialize(manager.context.assets, GameNet.instance.callbackOwners, view =>
            createCardPopupComposition(manager.context, view) ?? createLeaguePopupComposition(manager.context, view)
                ?? createLeagueCreatePopupComposition(manager.context, view)
                ?? createLeagueDonatePopupComposition(manager.context, view));
    }
    private registerRoutes(manager: ProcedureManager): void {
        manager.registerRoute(GameRoute.Update, ProcedureUpdate);
        manager.registerRoute(GameRoute.Login, ProcedureLogin);
        manager.registerRoute(GameRoute.PostLogin, ProcedurePostLogin);
        manager.registerRoute(GameRoute.Main, ProcedureMain);
        manager.registerRoute(GameRoute.Matching, ProcedureMatching);
        manager.registerRoute(GameRoute.Battle, ProcedureGame);
    }

    onDestroy(): void {
        EventMgr.instance.off(REWARD_ITEM_DETAIL_INTENT, this.onRewardItemDetail, this);
        const resourceLoads = this.resourceLoads;
        this.resourceLoads = null;
        try { resourceLoads?.dispose(); }
        finally { GameNet.instance.removeEvent('CmdRechargeBroMsg', this, this.onRechargeSettled); }
    }
}
