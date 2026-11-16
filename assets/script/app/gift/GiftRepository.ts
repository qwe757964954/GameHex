/**
 * 礼包的数据端口：读取配置表与缓存，并发送购买请求。
 *
 * 表数据和服务器状态在此聚合，购买判定在 `GiftTable`。
 * `CmdShop` 在 `protoCache` 中，由服务端主动推送，因此这里每次读取缓存，不另存快照。
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
    /** `item` 表：奖励格的品质与图标，主键为 `item.resId`。 */
    readonly items: ReadonlyMap<number, IGiftItemInfo>;
    /** `CmdRole.tlExtraId`：已买过的 `payChannel.id`。 */
    readonly paidChannelIds: ReadonlySet<number>;
}

/** 请求结果：三态，页面据此决定提示文案。 */
export type GiftRequestResult = 'ok' | 'offline' | 'failed';

export interface IGiftRepository {
    /** 读表 + 读缓存，组装一次快照；不发任何请求。 */
    load(): Promise<IGiftSnapshot>;
    /** 购买一个礼包商品（`id` = `giftShop.id`）。 */
    buyGift(id: number, caller?: object): Promise<GiftRequestResult>;
}

/** 请求超时（与首充 / 七日同口径：写 5000ms）。 */
const WRITE_TIMEOUT_MS = 5000;

/** 读一张分表的全部行；表缺失时返回空数组。 */
async function readRows(table: string): Promise<unknown[]> {
    return (await RefUtil.instance.getRefAllAsync(table)) ?? [];
}

/** 读 `CmdShop`（礼包商店）缓存；拿不到时返回空 Map。 */
function readBuyTimes(): ReadonlyMap<number, number> {
    try {
        const shop = CacheMgr.instance.getCmdShop(GIFT_SHOP_TYPE as CmdShopType);
        return normalizeShopGoods(shop);
    } catch (error) {
        console.warn('[Gift] 读 CmdShop 缓存失败', error);
        return new Map<number, number>();
    }
}

/** 读 `CmdRole` 的第一行；拿不到返回 `null`（灵玉页按「全都没首充」渲染）。 */
function readRole(): unknown {
    try {
        const rows = CacheMgr.instance.getTlCmdRole() ?? [];
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
    async load(): Promise<IGiftSnapshot> {
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
        };
    }

    async buyGift(id: number, caller?: object): Promise<GiftRequestResult> {
        const net = GameNet.instance;
        if (!net.isConnected) return 'offline';

        let applied = false;
        const callback = (rsp: CmdShopBuyRspMsg): void => {
            // 已购次数由服务端另推 CmdShop，这里只展示本次获得的物品。
            FW.ShowReward(rsp?.tlCmdGoods ?? []);
            applied = true;
        };

        try {
            const sent = await withTimeout(
                net.send(
                    new RequestGiftShopBuy(
                        { id, cmdShopType: GIFT_SHOP_TYPE as CmdShopType, buyTimes: 1 },
                        caller,
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
