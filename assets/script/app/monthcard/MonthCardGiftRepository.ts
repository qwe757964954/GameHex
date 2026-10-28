/**
 * 月卡礼包的数据端口 —— **表 + 服务器缓存 + 网络请求** 三合一的 Repository。
 *
 * 与 `FirstRechargeRepository` / `CardRepository` 同一套分层：页面（`MonthCardGiftPage`）
 * 只依赖本文件的接口，判定逻辑全在 `MonthCardGiftTable`（纯函数、可单测），
 * 本文件只负责「把数据搬进来」。
 *
 * 数据来源：
 *   ① 配置表 `monthCardActPlan` + `payChannel` + `roleProperty` + `item` + `activity`
 *      （`assets/remoteRef/*.json`，走 `RefUtil`）；
 *   ② 服务器状态 —— 两张缓存：
 *      - `CmdCardCache { resId, endTime }`：卡的有效期（`getTlCmdCardCache()`）；
 *      - `CmdActivity.detail.monthCardActDetail{2}.todayTake`：今日是否已领（`getTlCmdActivity()`）；
 *   ③ 请求 `CmdCardBuyReqMsg` / `CmdTakeMonthCardActRewardReqMsg`。
 *
 * ## ⚠️ 本模块**没有** `refreshFromServer()` —— 这是刻意的
 *
 *  老端这个界面**也没有独立的拉取请求**：`TabMonthCardAct.ts` 里除了领奖什么都不发，
 *  活动数据由活动模块统一维护、靠登录同步 + 服务端广播进 `CmdActivity` 缓存。
 *  `LayerGiftMonth` 是从主界面直接开的独立入口，看完的是**当前缓存**。
 *
 *  所以这里不造一个「发出去但不知道会同步什么」的假刷新接口：
 *  - 界面打开：只 `load()`（读表 + 读缓存）；
 *  - 买 / 领之后：由页面**再 `load()` 一次**拿新状态。
 *
 *  等本工程的「活动模块」落地后，在这里补一次真正的 `CmdActivity` 拉取即可
 *  （页面对返回值已经是三态处理，不用改）。
 */

import { FW } from '../../framework/FW';
import { RefUtil } from '../../framework/ref/RefUtil';
import { GameNet } from '../net/GameNet';
import { CacheMgr } from '../net/CacheMgr';
import {
    buildGifts,
    buildPriceResolver,
    buildRewardMeta,
    buildStates,
    toMillis,
} from './MonthCardGiftTable';
import type {
    IMonthCardGiftSnapshot,
} from './MonthCardGiftTable';
import {
    RequestMonthCardBuy,
    RequestTakeMonthCardReward,
} from './RequestMonthCardMsg';

/** 请求结果：三态，页面据此决定提示文案。 */
export type MonthCardRequestResult = 'ok' | 'offline' | 'failed';

export interface IMonthCardGiftRepository {
    /** 读表 + 读缓存，组装一次快照；**不发请求**。 */
    load(nowMs?: number): Promise<IMonthCardGiftSnapshot>;
    /**
     * 购买 / 续费一张月卡。
     * `type` = `monthCardActPlan.type`（**不是** `plan`，见 `RequestMonthCardMsg` 的说明）；
     * `payId` = `payChannel.id`（= `monthCardActPlan.rmb`），`rsp.ret` 为真后发起支付。
     */
    buy(type: number, payId: number, caller?: object): Promise<MonthCardRequestResult>;
    /**
     * 领取某张月卡的今日奖励。
     * `activityResId` = 该活动在缓存里的 `openResId`（`buildStates` 已把它带在状态里）。
     */
    claim(activityResId: number, caller?: object): Promise<MonthCardRequestResult>;
    /**
     * 接购买成功广播（`CmdCardBuyBroMsg`）。同一 `caller` 重复调用只生效一次。
     * 回调收到的是**服务端真发货**（endTime 已加、buyReward 已发）后的奖励明细 `tlRewards`。
     */
    listen(caller: object, onReward: (goods: CmdGoods[]) => void): void;
    /** 断开购买成功广播监听。 */
    unlisten(caller: object): void;
}

/** 读一张分表的全部行；表缺失时返回空数组（与 `CardLineupDecks.readRows` 同口径）。 */
async function readRows(table: string): Promise<unknown[]> {
    return (await RefUtil.instance.getRefAllAsync(table)) ?? [];
}

/** 生产环境 Repository。 */
export class RuntimeMonthCardGiftRepository implements IMonthCardGiftRepository {
    /** 购买成功广播监听：一个 caller 一个回调（`GameNet.addEvent` 的键）。 */
    private readonly listeners = new Map<object, (goods: CmdGoods[]) => void>();

    /** 已注册的广播分发器（只注册一次，多个 caller 共享）。 */
    private broadcaster: object | null = null;

    async load(nowMs: number = Date.now()): Promise<IMonthCardGiftSnapshot> {
        const [planRows, payRows, roleRows, itemRows, activityRows] = await Promise.all([
            readRows('monthCardActPlan'),
            readRows('payChannel'),
            readRows('roleProperty'),
            readRows('item'),
            readRows('activity'),
        ]);

        const rewardMeta = buildRewardMeta(roleRows, itemRows);
        const gifts = buildGifts(planRows, buildPriceResolver(payRows), rewardMeta);

        return {
            gifts,
            states: buildStates(CacheMgr.instance.getTlCmdActivity(), activityRows),
            endTimes: this.readEndTimes(),
            now: nowMs,
        };
    }

    /**
     * 从 `CmdCardCache` 读各卡的有效期。
     *
     * key 用 **`resId`**（= `monthCardActPlan.plan`）：老端是
     * `VOMonthCardBag.Get(refLimit.plan)`，而 `CmdCardCache_Key` 就是 `{ resId }`。
     * 缓存为空是**正常情况**（没连服 / 没买过）—— 返回空 Map，界面按「全部未购买」渲染，
     * 不要当成错误，也别在这里发请求（`load()` 会被预览页频繁调用）。
     */
    readEndTimes(): Map<number, number> {
        const map = new Map<number, number>();
        for (const raw of CacheMgr.instance.getTlCmdCardCache()) {
            if (!raw || typeof raw !== 'object') continue;
            const row = raw as unknown as Record<string, unknown>;
            const plan = Number(row.resId);
            if (!Number.isSafeInteger(plan) || plan <= 0) continue;
            const endMs = toMillis(row.endTime);
            if (endMs > 0) map.set(plan, endMs);
        }
        return map;
    }

    async buy(type: number, payId: number, caller?: object): Promise<MonthCardRequestResult> {
        const net = GameNet.instance;
        if (!net.isConnected) return 'offline';
        // 老客户端在 `rsp.ret` 为真之后调 `SDKMgr.pay(payRef.id, "common", 0)` 发起真实支付，
        // 其中 `payRef` = `payChannel` 里 `id === monthCardActPlan.rmb` 的那一行（= `payId`）。
        // `rsp.ret` 只代表「服务端受理了开单请求」（那时还没付款）—— 真正发货靠 `CmdCardBuyBroMsg`
        // 广播（见 `listen`）。所以这里 `rsp.ret` 为真后走 `FW.pay` 触发支付，返回 `'ok'` 只表示「已开单」。
        let ret = false;
        try {
            const ok = await net.send(
                new RequestMonthCardBuy({ res_Id: type }, caller, (rsp) => { ret = rsp?.ret === true; }),
                false,
            );
            if (!ok) return 'failed';
        } catch (error) {
            console.warn('[MonthCardGift] 购买请求失败', error);
            return 'failed';
        }
        if (!ret) return 'failed';
        FW.pay(payId, 'common', 0);
        return 'ok';
    }

    async claim(activityResId: number, caller?: object): Promise<MonthCardRequestResult> {
        const net = GameNet.instance;
        if (!net.isConnected) return 'offline';
        //  ⚠️ `CmdTakeMonthCardActRewardRspMsg` **没有 `ret` 字段**（整个响应体只有 `tlReward` ——
        //  见 `Cmd.d.ts:3153`），与购买那条协议不一样。老端也从不判它：
        //  `ModelActivity.RequestTakeMonthCardActReward()` 收到响应就直接 `FW.ShowReward(rsp.tlReward)`。
        //  所以这里的成功判据是「响应到达」；失败路径是 `net.send` 返回 false 或者抛异常。
        let responded = false;
        try {
            const ok = await net.send(
                new RequestTakeMonthCardReward(
                    { resId: activityResId },
                    caller,
                    // 老客户端收到响应直接弹奖励（`ModelActivity.RequestTakeMonthCardActReward` →
                    // `FW.ShowReward(rsp.tlReward)`）。`FW.ShowReward` 是可注入全局出口
                    // （组合根接成 `ShowRewardPage.open`），本文件不 import 视图类 / `cc`
                    // （同 `CelebrationRepository` / `FirstRechargeRepository`）。
                    // 空奖励不弹（与 `FirstRechargeRepository.claim` 的判空口径一致）。
                    (rsp) => {
                        responded = true;
                        const goods = rsp?.tlReward;
                        if (goods && goods.length > 0) FW.ShowReward(goods);
                    },
                ),
                false,
            );
            if (!ok) return 'failed';
        } catch (error) {
            console.warn('[MonthCardGift] 领取每日奖励请求失败', error);
            return 'failed';
        }
        return responded ? 'ok' : 'failed';
    }

    // ============================================================
    // 购买成功广播（`CmdCardBuyBroMsg`）
    // ============================================================

    listen(caller: object, onReward: (goods: CmdGoods[]) => void): void {
        this.listeners.set(caller, onReward);
        if (this.broadcaster) return;
        // 老端 `ModelMonthCard.enter()` 挂在常驻 Model 上，覆盖「挂机页 / 礼包页」两处购买入口；
        // Demo3.8 所有月卡购买都收敛到 `MonthCardGiftPage`（挂机页也只是 `open` 它），
        // 所以广播监听挂在 Repository 上、由页面 onOpen/onClose 驱动即可，购买时弹窗一定开着。
        this.broadcaster = {};
        GameNet.instance.addEvent('CmdCardBuyBroMsg', this.broadcaster, (msg: any) => {
            const goods: CmdGoods[] = Array.isArray(msg?.tlRewards) ? (msg.tlRewards as CmdGoods[]) : [];
            for (const fn of this.listeners.values()) fn(goods);
        });
    }

    unlisten(caller: object): void {
        this.listeners.delete(caller);
        if (this.listeners.size === 0 && this.broadcaster) {
            GameNet.instance.removeCallerEvent(this.broadcaster);
            this.broadcaster = null;
        }
    }
}

export const monthCardGiftRepository: IMonthCardGiftRepository = new RuntimeMonthCardGiftRepository();
