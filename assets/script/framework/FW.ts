import { EngineMain } from "../engine/EngineMain";
import { ScriptObject } from "./base/ScriptObject";
import { GameCacheMgr } from "./cache/GameCacheMgr";
import { ErrorLogMgr } from "./errorlog/ErrorLogMgr";
import { FWEventCenter } from "./event/FWEventCenter";
import { ExprMgr } from "./expr/ExprMgr";
import { Log } from "./log/Log";
import { Http } from "./net/Http";
import { NetSocket } from "./net/NetSocket";
import { Pool } from "./pool/Pool";
import { Task } from "./task/Task";
import { DeviceTime } from "./utils/DeviceTime";
import { Timer } from "./utils/Timer";

export class FW {

    static readonly resPath: string = "res/"
    static refPath: string = "ref/"
    static isRemoteRef: boolean = false //内网Runtime配置表地址

    static Task = Task.instance;
    // static GameCacheMgr = GameCacheMgr.instance;
    /**
     * 缓存管理器。
     *
     * 源工程在 `App.initFWFunc()` 里用 DI 容器装配：`FW.CacheMgr = Container.inst().get("CacheMgr")`
     * （`app/net/CacheMgr` → `app/generated/netProto/CacheMgrGen` → `GameCacheMgr`）。Demo3.8 不建容器：
     * framework 层不能反过来 import app 层，所以这里只做**惰性兜底**（new 框架基类 + setter 允许外部注入）。
     * 真正的装配在 `app/net/GameNet.doPrepare()`：`FW.CacheMgr = CacheMgr.instance` ——
     * 别省这一步，否则收包写进兜底实例、业务从 `CacheMgr.instance` 读，两份 GameCache 各自为空。
     *
     * 两个坑：
     * 1. 不能写成 `static CacheMgr = new GameCacheMgr()`。`FW → GameCacheMgr → GameCache → FW`
     *    是循环引用，模块求值期 new 会踩到还没初始化的类。
     * 2. 必须在连服前 `await FW.CacheMgr.init()`：收包路径
     *    （`ConnectedNetState.onReceiveMessage` → `FW.CacheMgr.handleCmdCache`）会在
     *    `GameCache` 构造时读 `GameCacheMgr.protoCacheMessage`（来自 `config/protoCache`），
     *    没初始化会炸在 `message["tmField"]`。
     */
    private static _cacheMgr: GameCacheMgr;
    static get CacheMgr(): GameCacheMgr {
        if (FW._cacheMgr == null) {
            FW._cacheMgr = new GameCacheMgr();
        }
        return FW._cacheMgr;
    }
    static set CacheMgr(value: GameCacheMgr) {
        FW._cacheMgr = value;
    }
    // FairyMgr stubbed: FGUI 已剔除，业务层用 framework/ui 自建 UI 替代
    // static FairyMgr = FairyMgr.instance;
    static Http = Http.instance;
    static FWEvent = FWEventCenter.instance;
    static ExprMgr = ExprMgr.instance;
    static ErrorLogMgr = ErrorLogMgr.instance;
    static EngineMain = EngineMain
    static DeviceTime = DeviceTime.instance;

    static Log = Log.inst;
    static YJ = new Log("%c YJ");
    static LHF = new Log("%c LHF");
    static ZJJ = new Log("%c ZJJ");
    static GZT = new Log("%c GZT");
    static ZJR = new Log("%c ZJR");
    static LWX = new Log("%c LWX");
    static DSX = new Log("%c DSX");
    static XD = new Log("%c XD");
    static readonly ignoreShowloadingNet: string[] = [
        "CmdSystemSyncTimeReqMsg",
        "CmdWorldMarchEndReqMsg",
        "CmdHeroAuctionInfoReqMsg",
        "CmdCorpseInvasionChallengeReqMsg",
        "CmdHeroLevelUpReqMsg",
        "CmdBuildingLevelUpReqMsg",
        "CmdNationalWarTurntableInfoReqMsg",
        "CmdPveWeaponInfoReqMsg",
        "CmdBattleBeatReqMsg"
    ]

    private static poolTimer: Timer;
    /**播放音效 */
    static playSound(key: string) { };

    static showLoadingDelay = (reason: string = "def") => {
        FW.showLoading(reason, 2000)
    }

    /**转圈等待加载提示 */
    static showLoading(reason: string = "def", delayTime?: number) {
    };

    static removeLoading(reason: string = "def") {
    };

    static clearLoading() {
    };


    static showSpine(str: string) { }

    static showSJCG() {
        FW.showSpine("djts")
    }

    /**
     * 浮动提示（吐司）出口。
     *
     * framework 层不能反向 import app 层（见 CacheMgr 的同类说明），所以这里只留一个
     * 可注入的空实现：由组合根 `app/bootstrap/ProcedureBootstrap.onLoad()` 接成
     * `Toast.show`。注入之前调用是**静默丢弃**，与 showLoading / playSound 等
     * 尚未落地的能力同口径，不会崩。
     */
    static showTip: (tip: string) => void = (_tip: string) => { };

    /**
     * 「获得奖励」弹窗出口。
     *
     * 与 `showTip` 同口径：framework 层不能反向 import app 层
     * （`FW → ShowRewardPage → PopupManager → FW` 是循环引用），所以这里只留一个可注入的
     * 空实现 —— 由组合根 `app/bootstrap/ProcedureBootstrap.onLoad()` 接成 `ShowRewardPage.open`。
     * 注入之前调用是**静默丢弃**，与 showLoading / playSound 等尚未落地的能力同口径，不会崩。
     *
     * @param goods  奖励明细（`CmdGoods[]`，`{resId, number}`）
     * @param isGold 铜钱 / 金币奖励 ⇒ 换音效（老端 `params?.isGold`）
     */
    static showReward: (goods: CmdGoods[], isGold: boolean) => void = () => { };

    /**
     * 发起支付出口。
     *
     * 与 `showReward` / `showTip` 同口径：framework 层不能反向 import app 层
     * （`FW → 支付 SDK → … → FW` 是循环引用），所以这里只留一个可注入的空实现 ——
     * 由组合根 `app/bootstrap/ProcedureBootstrap.onLoad()` 接成真正的支付 SDK。
     *
     * 老端调用点统一是 `SDKMgr.pay(payChannelId, fromType, fromId)`，`fromType` 恒 `"common"`、
     * `fromId` 恒 `0`（见 `TabGiftMonth` / `TabGiftLingYu` / `LayerLimitTimeBuy`）。
     *
     * ⚠️ 支付 SDK 尚未落地前这是**静默丢弃**：业务侧（月卡 / 首充 / 礼包）的 `buy()` 在
     *    `rsp.ret` 为真后调它表示「服务端已开单，该去收钱了」，真正发货靠后续的
     *    `CmdCardBuyBroMsg` 广播（见 `MonthCardGiftRepository.listen`）。等 SDK 接上，这里换成真实现即可，
     *    业务层一行都不用改。
     *
     * @param payChannelId `payChannel.id`（= `monthCardActPlan.rmb`），不是价格
     * @param fromType      购买来源（老端恒 `"common"`）
     * @param fromId        来源 id（老端恒 `0`）
     */
    static pay: (payChannelId: number, fromType: string, fromId: number) => void = () => { };

    static PushError(errorLog: string, message: string) {
    }

    static init() {
        // 需要在ScriptObject父类销毁的
        ScriptObject.scriptObjectDestroy = (t: ScriptObject) => {
            NetSocket.msgEventProxy.removeCallerListener(t)
            FW.CacheMgr.removeEventCallerAllCache(t)
        }

        if (!FW.poolTimer) {
            // 一段时间检测一次,删除长时间不用的缓存
            let timer = Timer.getTimer(FW.timeUpdate, null, 60000, -1)
            timer.start()
            FW.poolTimer = timer
        }
    }


    /**代码多语言文本翻译 */
    static G_W(txt: IRefmL_key): string {
        return
    }




    private static timeUpdate() {
        let tmPool = Pool.tmPool;
        tmPool.forEach((v1, v2, s) => {
            v1.clear(v1.retainCount)
        })
    }

    static adjustViewFullPhone(com: fairygui.GComponent, liuhaiHeightAdjust: number = 0) {
        if (com == null) {
            return
        }
        if (EngineMain.isNeedLiuHaiAdjust()) {
            let fullCom = com.tm("组件_通用_全面屏适配")
            if (fullCom != null && !fullCom["isAdjustLiuHai"]) {
                let h = EngineMain.liuhaiHeight + liuhaiHeightAdjust;
                fullCom.height = h;
                fullCom["isAdjustLiuHai"] = true
                //处理关联：延展的处理
                if (h != 0) {
                    let listRelationCom = com.tm("组件_通用_全面屏适配_延展")
                    if (listRelationCom != null && !listRelationCom["clientHitRelationOk"]) {
                        listRelationCom.height -= h;
                        listRelationCom["clientHitRelationOk"] = true;
                    }
                }
            }
        }
    }

    static GetRefPath(resName: string) {
        if (FW.isRemoteRef)
            return FW.refPath + resName + ".json"
        else
            return FW.refPath + resName
    }

    /**
     * 「获得奖励」弹窗 —— 老端的**全局入口**（`FW.ShowReward(tlCmdGoods, param)`），
     * 调用点遍布庆典 / 首充 / 商店 / 限时购买 / 关卡礼包 / 每日分享 / 请神 / 转盘 等 20+ 处。
     *
     * 老端链路：`FW.ShowReward` → `CtrlAlert.openLayerShowReward(tlCmdGoods, param)`
     * → `PopLayerMgr.AddLayer(LayerShowReward)`；本工程对应 `FW.showReward` → `ShowRewardPage`。
     *
     * @param tlCmdGoods 奖励明细（`CmdGoods{resId, number}`；空数组 ⇒ 弹窗自己 `close()`，
     *                   与老端 `UpdateList()` 里 `tlGoods.length <= 0` 的 `unload()` 同口径）
     * @param param      `{ isGold }` —— 铜钱 / 金币奖励换音效（老端 `ModelRole` L599 传的这个形状）
     */
    static ShowReward(tlCmdGoods: CmdGoods[], param?: { isGold?: boolean }) {
        // ⚠️ 这里**只做转交**，不直接弹窗：真正的实现由组合根注入（见 `FW.showReward` 的说明）。
        FW.showReward(tlCmdGoods ?? [], !!param?.isGold);
    }
}
