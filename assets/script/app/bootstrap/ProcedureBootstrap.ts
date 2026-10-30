import { _decorator, Component } from 'cc';
import { GameRoute } from '../../core/runtime/GameRoute';
import { AudioMgr, bindAudioToFramework } from '../../framework/audio/AudioMgr';
import { FW } from '../../framework/FW';
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
import { registerRdVars } from '../rd/RdRegistry';
import { GameNet } from '../net/GameNet';
import { GameSocketBridge } from '../gm/GameSocketBridge';

const { ccclass } = _decorator;

/**
 * 应用组合根：这是唯一可以同时了解 framework、platform 和具体业务流程的地方。
 *
 * `.meta` 沿用迁移前的 UUID，所以 Root.scene 上原有组件绑定无需重做。
 */
@ccclass('ProcedureBootstrap')
export class ProcedureBootstrap extends Component {
    public static __cname: string = 'ProcedureBootstrap';

    /** 真实支付发货广播：`CmdRecharge.rewards` 才是本次到账明细。 */
    private readonly onRechargeSettled = (msg: CmdRechargeBroMsg): void => {
        FW.ShowReward(msg?.cmdRecharge?.rewards ?? []);
    };

    onLoad(): void {
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

        const network = new FetchNetworkTransport();
        const payment = CenterPaymentService.instance(network);
        // 支付出口：中心服开单/内部账号发货已经落地；真实渠道扣款由 PaymentService 的平台处理器注入。
        FW.pay = (payChannelId, fromType, fromId) => {
            void payment.pay(payChannelId, fromType, fromId).catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                console.error('[Pay] 支付失败', error);
                FW.showTip(message);
            });
        };

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

        const manager = this.getComponent(ProcedureManager) ?? this.addComponent(ProcedureManager);
        const assets = new CocosAssetService();
        const configs = new RefConfigService();
        const callbackOwners = GameNet.instance.callbackOwners;
        PopupManager.inst.initialize(assets, callbackOwners);
        const sessionAssets = new AppSessionAssetService(assets, configs);
        manager.configure({
            assets,
            sessionAssets,
            configs,
            network: new FetchNetworkTransport(),
            callbackOwners,
        });
        manager.registerRoute(GameRoute.Update, ProcedureUpdate);
        manager.registerRoute(GameRoute.Login, ProcedureLogin);
        manager.registerRoute(GameRoute.PostLogin, ProcedurePostLogin);
        manager.registerRoute(GameRoute.Main, ProcedureMain);
        manager.registerRoute(GameRoute.Matching, ProcedureMatching);
        manager.registerRoute(GameRoute.Battle, ProcedureGame);
        manager.navigate(GameRoute.Update);

        // 浏览器控制台协议调试入口（`window.GameSocket`），复用游戏内连接与登录态；
        // 幂等安装，仅在有 window 的平台挂载。
        GameSocketBridge.install();
    }

    onDestroy(): void {
        GameNet.instance.removeEvent('CmdRechargeBroMsg', this, this.onRechargeSettled);
    }
}
