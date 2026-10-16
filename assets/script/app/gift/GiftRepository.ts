/**
 * 礼包的数据端口 —— **表 + 服务器状态 + 网络请求** 三合一的 Repository。
 *
 * 与 `SevenDayRepository` / `FirstRechargeRepository` 同一套分层：页面只依赖本文件的接口，
 * 判定逻辑全在 `GiftTable`（纯函数、可单测），本文件只负责「把数据搬进来」。
 *
 * 数据来源：
 *   ① 配置表 `giftShop` / `payChannel`（`assets/remoteRef/*.json`，走 `RefUtil`）；
 *   ② 服务器状态 `CmdShop`（`cmdShopType = 5`）；
 *   ③ 配置表 `item`（奖励格的品质 + 图标；**主键是 `resId`**）；
 *   ④ `CmdRole.tlExtraId`（灵玉页判「首充双倍还没用」）。
 *
 * ## ⚠️ 与七日狂欢的**关键差异**：这里走 `CacheMgr`，那边不走
 *
 * `assets/resources/config/protoCache.json` 里**有** `CmdShop`（key = `cmdShopType`）⇒
 * 服务端会**主动推**，`GameNet` 收包时已经写进 `GameCache`。
 * 所以本类**不自己存快照**，每次 `load()` 现读 `CacheMgr.instance.getCmdShop(5)`。
 * （七日那张 `CmdSevenDayInfo` 不在 protoCache 里，是随 rsp 回来的，那边才必须自己存 —— 别照抄错。）
 *
 * ## 没有「请求商店数据」这一步
 *
 * 老端 `SubTabSpecialGiftBase` 打开时只读 `VOShopBag`（已有缓存），**不发拉取请求**；
 * `Cmd.d.ts` 里也没有 `CmdShopReqMsg`（只有 `CmdShop` 推送 + `CmdShopBuy` 请求）。
 * 所以缓存为空就是「服务端还没推 / 离线」，界面按已购 `0` 显示即可，不要造一个假请求。
 */

import { RefUtil } from '../../framework/ref/RefUtil';
import { FW } from '../../framework/FW';
import { GameNet } from '../net/GameNet';
import { CacheMgr } from '../net/CacheMgr';
import { withTimeout } from '../net/RequestGuard';
import {
    GIFT_SHOP_TYPE,
    normalizePaidChannelIds,
    normalizeShopGoods,
    parseGiftItemRows,
    parseGiftShopRows,
    parsePayChannelRows,
} from './GiftTable';
import type { IGiftItemInfo, IGiftShopRow, IPayChannelRow } from './GiftTable';
import { RequestGiftShopBuy } from './RequestGiftMsg';

/** 一次界面刷新要的全部数据。 */
export interface IGiftSnapshot {
    readonly shops: readonly IGiftShopRow[];
    readonly payChannels: readonly IPayChannelRow[];
    /** `giftShop.id` → 已购买次数（来自 `CmdShop`）。 */
    readonly buyTimes: ReadonlyMap<number, number>;
    /**
     * `item` 表（奖励格要的品质 + 图标）。
     *
     * ⚠️ 主键是 `item.resId`；`giftShop.rewards[].resId` 里有一半是 `roleProperty` 档
     * （铜币 / 体力 / 幻灵玉…），**本表查不到它们** —— 那几张图走 `GiftArt.giftResIconRef`。
     */
    readonly items: ReadonlyMap<number, IGiftItemInfo>;
    /** `CmdRole.tlExtraId` —— 已买过的 `payChannel.id`（灵玉页判「首充双倍还没用」）。 */
    readonly paidChannelIds: ReadonlySet<number>;
    /** 这次快照的时间基准（毫秒）。 */
    readonly now: number;
}

/** 请求结果：三态，页面据此决定提示文案。 */
export type GiftRequestResult = 'ok' | 'offline' | 'failed';

export interface IGiftRepository {
    /** 读表 + 读缓存，组装一次快照；**不发任何请求**。 */
    load(nowMs?: number): Promise<IGiftSnapshot>;
    /** 购买一个礼包商品（`id` = `giftShop.id`）。 */
    buyGift(id: number, caller?: unknown): Promise<GiftRequestResult>;
    /** 当前缓存的已购次数（调试 / 测试用）。 */
    peekBuyTimes(): ReadonlyMap<number, number>;
}

/** 请求超时（与首充 / 七日同口径：读 800ms / 写 5000ms）。 */
const READ_TIMEOUT_MS = 800;
const WRITE_TIMEOUT_MS = 5000;

/** 读一张分表的全部行；表缺失时返回空数组。 */
async function readRows(table: string): Promise<unknown[]> {
    return (await RefUtil.instance.getRefAllAsync(table)) ?? [];
}

/** 读 `CmdShop`（礼包商店）缓存；拿不到时返回空 Map（= 全都当没买过）。 */
function readBuyTimes(): ReadonlyMap<number, number> {
    try {
        // `getCmdShop` 的形参类型是生成的 `CmdShopType` enum，这里传常量数字，需要 cast。
        const shop = (CacheMgr.instance as any).getCmdShop(GIFT_SHOP_TYPE);
        return normalizeShopGoods(shop);
    } catch (error) {
        console.warn('[Gift] 读 CmdShop 缓存失败', error);
        return new Map<number, number>();
    }
}

/** 读 `CmdRole` 的第一行；拿不到返回 `null`（灵玉页按「全都没首充」渲染）。 */
function readRole(): unknown {
    try {
        const rows = CacheMgr.instance?.getTlCmdRole() ?? [];
        for (const row of rows) {
            if (row) return row;
        }
    } catch (error) {
        console.warn('[Gift] 读 CmdRole 缓存失败', error);
    }
    return null;
}

/** 生产环境 Repository。 */
export class RuntimeGiftRepository implements IGiftRepository {
    async load(nowMs: number = Date.now()): Promise<IGiftSnapshot> {
        const [shopRows, payRows, itemRows] = await Promise.all([
            readRows('giftShop'),
            readRows('payChannel'),
            readRows('item'),
        ]);

        return {
            shops: parseGiftShopRows(shopRows),
            payChannels: parsePayChannelRows(payRows),
            buyTimes: readBuyTimes(),
            items: parseGiftItemRows(itemRows),
            paidChannelIds: normalizePaidChannelIds(readRole()),
            now: nowMs,
        };
    }

    peekBuyTimes(): ReadonlyMap<number, number> {
        return readBuyTimes();
    }

    async buyGift(id: number, caller?: unknown): Promise<GiftRequestResult> {
        const net = GameNet.instance;
        if (!net.isConnected) return 'offline';

        let applied = false;
        const callback = (rsp: CmdShopBuyRspMsg): void => {
            // 服务端在 rsp 里回带本次获得的物品（`tlCmdGoods`）；
            // 商店的已购次数由服务端**另推** `CmdShop` 更新缓存，这里不用手动合并。
            FW.ShowReward(rsp?.tlCmdGoods ?? []);
            applied = true;
        };

        try {
            // ⚠️ 必须 withTimeout：`GameNet.send` 没有按请求的超时，服务端不回就永悬。
            const sent = await withTimeout(
                net.send(
                    new RequestGiftShopBuy(
                        { id, cmdShopType: GIFT_SHOP_TYPE as any, buyTimes: 1 },
                        caller as any,
                        callback,
                    ),
                    false,
                ),
                WRITE_TIMEOUT_MS,
                () => false,
            );
            if (sent !== true) return 'failed';
        } catch (error) {
            console.warn('[Gift] 购买礼包失败', error);
            return 'failed';
        }
        return applied ? 'ok' : 'failed';
    }
}

export const giftRepository: IGiftRepository = new RuntimeGiftRepository();

/** 读一次超时常量给测试用（避免测试里硬编码 800/5000）。 */
export const GIFT_READ_TIMEOUT_MS = READ_TIMEOUT_MS;
