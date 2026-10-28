/**
 * 首充礼包（新首充）的数据端口 —— **表 + 服务器缓存 + 网络请求** 三合一的 Repository。
 *
 * 与 `CardRepository` 同一套分层：页面（`FirstRechargePage`）只依赖本文件的接口，
 * 判定逻辑全在 `FirstRechargeTable`（纯函数、可单测），本文件只负责「把数据搬进来」。
 *
 * 数据来源三条：
 *   ① 配置表 `firstRechargeNew` + `payChannel` + `item`（`assets/remoteRef/*.json`，走 `RefUtil`）；
 *   ② 服务器状态 `CmdFirstRechargeNew.infos`（网关卡按 `protoCache` 建的缓存，走 `CacheMgr`）；
 *   ③ 请求 `CmdFirstRechargesBuy / CmdFirstRechargeReward / CmdFirstRechargeOpen`。
 *
 *  ⚠️ `CmdFirstRechargeNew` 这张表的形状很特别（见 `CacheMgrGen` 上的长注释）：
 *  它按**内容**分桶，`getTlCmdFirstRechargeNew()` 通常只有 1 条，拿到之后要再取 `.infos`。
 *  别去 `getCmdFirstRechargeNew({infos: ...})` 按字段查 —— 那条路按设计就取不到。
 */

import { FW } from '../../framework/FW';
import { RefUtil } from '../../framework/ref/RefUtil';
import { GameNet } from '../net/GameNet';
import { CacheMgr } from '../net/CacheMgr';
import {
    buildPriceResolver,
    buildStateMap,
    buildTiers,
} from './FirstRechargeTable';
import type {
    IFirstRechargeState,
    IFirstRechargeTier,
} from './FirstRechargeTable';
import type { IFirstRechargeItemInfo } from './FirstRechargeArt';
import {
    RequestFirstRechargeBuy,
    RequestFirstRechargeOpen,
    RequestFirstRechargeReward,
} from './RequestFirstRechargeMsg';

/** 一次界面刷新要的全部数据。 */
export interface IFirstRechargeSnapshot {
    readonly tiers: readonly IFirstRechargeTier[];
    readonly states: ReadonlyMap<number, IFirstRechargeState>;
    readonly items: ReadonlyMap<number, IFirstRechargeItemInfo>;
    /** 计算「今天第几天」用的时间基准（毫秒）。 */
    readonly now: number;
}

/** 请求结果：三态，页面据此决定提示文案。 */
export type FirstRechargeRequestResult = 'ok' | 'offline' | 'failed';

export interface IFirstRechargeRepository {
    /** 读表 + 读缓存，组装一次快照；**不发请求**。 */
    load(nowMs?: number): Promise<IFirstRechargeSnapshot>;
    /** 打开界面时向服务端要一次最新状态（失败不抛错，页面继续用缓存渲染）。 */
    refreshFromServer(caller?: object): Promise<boolean>;
    /** 购买某一档（`rmb` = `firstRechargeNew.rmb`，即 `payChannel.id`）。 */
    buy(rmb: number, caller?: object): Promise<FirstRechargeRequestResult>;
    /** 领取某一档第 `day` 天的奖励。 */
    claim(id: number, day: number, caller?: object): Promise<FirstRechargeRequestResult>;
}

/** 读一张分表的全部行；表缺失时返回空数组（与 `CardLineupDecks.readRows` 同口径）。 */
async function readRows(table: string): Promise<unknown[]> {
    return (await RefUtil.instance.getRefAllAsync(table)) ?? [];
}

/** `item.json` 行 → 展示信息；字段不全的行跳过。 */
function parseItemInfo(value: unknown): IFirstRechargeItemInfo | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    const resId = Number(row.resId);
    if (!Number.isSafeInteger(resId) || resId <= 0) return null;
    return {
        resId,
        name: typeof row.name === 'string' ? row.name : '',
        icon: typeof row.icon === 'string' ? row.icon : '',
        quality: Number.isFinite(Number(row.quality)) ? Number(row.quality) : 1,
    };
}

/** 生产环境 Repository。 */
export class RuntimeFirstRechargeRepository implements IFirstRechargeRepository {
    async load(nowMs: number = Date.now()): Promise<IFirstRechargeSnapshot> {
        const [tierRows, payRows, itemRows] = await Promise.all([
            readRows('firstRechargeNew'),
            readRows('payChannel'),
            readRows('item'),
        ]);

        const tiers = buildTiers(tierRows, buildPriceResolver(payRows));

        const items = new Map<number, IFirstRechargeItemInfo>();
        for (const row of itemRows) {
            const info = parseItemInfo(row);
            if (info && !items.has(info.resId)) items.set(info.resId, info);
        }

        return { tiers, states: this.readStates(), items, now: nowMs };
    }

    /**
     * 从缓存读服务器状态。
     *
     * 缓存为空是**正常情况**（没连服 / 没买过）—— 返回空 Map，界面按「全部未购买」渲染，
     * 不要当成错误，也别在这里发请求（`load()` 会被预览页频繁调用）。
     */
    readStates(): Map<number, IFirstRechargeState> {
        const buckets = CacheMgr.instance.getTlCmdFirstRechargeNew();
        if (buckets.length === 0) return new Map<number, IFirstRechargeState>();
        const infos: unknown[] = [];
        for (const bucket of buckets) {
            const list = bucket?.infos;
            if (!list) continue;
            // 不用 `push(...list)`：实参展开在 release 构建会降级成 `apply`，
            // 虽然对真数组成立，但这里没有性能诉求，显式循环更不容易被后来人改坏。
            for (const info of list) infos.push(info);
        }
        return buildStateMap(infos);
    }

    async refreshFromServer(caller?: object): Promise<boolean> {
        const net = GameNet.instance;
        if (!net.isConnected) return false;
        try {
            // 打开界面时拉一次，服务端会把 CmdFirstRechargeNew 同步进缓存。
            // 这里不看响应体（`CmdFirstRechargeOpenRspMsg` 是空的），后续统一从缓存读。
            return await net.send(new RequestFirstRechargeOpen({}, caller), false);
        } catch (error) {
            console.warn('[FirstRecharge] 拉取首充状态失败', error);
            return false;
        }
    }

    async buy(rmb: number, caller?: object): Promise<FirstRechargeRequestResult> {
        const net = GameNet.instance;
        if (!net.isConnected) return 'offline';
        // 老客户端在 `rsp.ret` 为真之后调 `SDKMgr.pay(ref.rmb, "common", 0)` 发起真实支付。
        // `rsp.ret` 只表示游戏服允许购买；不继续调用支付出口，中心服就收不到订单，
        // 也不会完成发货并把新的 CmdFirstRechargeNew 推进缓存。
        let ret = false;
        try {
            const ok = await net.send(
                new RequestFirstRechargeBuy({ id: rmb }, caller, (rsp) => { ret = rsp?.ret === true; }),
                false,
            );
            if (!ok) return 'failed';
        } catch (error) {
            console.warn('[FirstRecharge] 购买请求失败', error);
            return 'failed';
        }
        if (!ret) return 'failed';
        FW.pay(rmb, 'common', 0);
        return 'ok';
    }

    async claim(id: number, day: number, caller?: object): Promise<FirstRechargeRequestResult> {
        const net = GameNet.instance;
        if (!net.isConnected) return 'offline';
        let ret = false;
        try {
            const ok = await net.send(
                new RequestFirstRechargeReward(
                    { id, day },
                    caller,
                    // 老端 `ModelFirstRecharge` L65：`if (rsp.tlCmdGoods) FW.ShowReward(rsp.tlCmdGoods)`。
                    // 之前只认 `ret`、奖励明细被丢掉；现在走同一条全局出口。
                    // ⚠️ `FW.ShowReward` 是可注入的全局出口（组合根接成 `ShowRewardPage.open`），
                    //    本文件不 import 任何视图类、不 import `cc`（同 `CelebrationRepository` 的说明）。
                    // ⚠️ 老端**有**那层 `if (rsp.tlCmdGoods)` 判空，这里照抄（与本文件 `ret` 的口径一致）。
                    (rsp) => {
                        ret = rsp?.ret === true;
                        const goods = rsp?.tlCmdGoods;
                        if (ret && goods) FW.ShowReward(goods);
                    },
                ),
                false,
            );
            if (!ok) return 'failed';
        } catch (error) {
            console.warn('[FirstRecharge] 领取请求失败', error);
            return 'failed';
        }
        return ret ? 'ok' : 'failed';
    }
}

export const firstRechargeRepository: IFirstRechargeRepository = new RuntimeFirstRechargeRepository();
