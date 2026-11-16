/**
 * 商城的数据与网络端口。页面只依赖 StoreActions；购买规则在 StoreCostTable；
 * 静态展示内容在 StoreShopTable。
 *
 * cmdShopType 的数值与老端 StoreType 一致。RequestShopBuy 在本文件单独定义，
 * 不复用 league 的那份，避免 store 反向依赖 league。
 *
 * 离线直接返回 offline。发包统一走 withTimeout，因为 GameNet.send 没有按请求的超时。
 * 三个响应都用 FW.ShowReward 发奖；铜钱铺传 isGold 以播放金币音效。
 */

import { FW } from '../../framework/FW';
import { RefUtil } from '../../framework/ref/RefUtil';
import { RequestMsg } from '../../framework/net/RequestMsg';
import { GameNet } from '../net/GameNet';
import { CacheMgr } from '../net/CacheMgr';
import { withTimeout } from '../net/RequestGuard';
import { countItem } from '../card/ItemBag';
import { rolePropertyAmount } from '../league/LeagueTable';
import { RequestRoleGuanKaGiftBuy, RequestRoleWatchAdvert } from '../generated/requestMsg/RequestRoleMsg';
import { storeAdLimit } from './StoreAd';
import type {
    IGemBoxCostRow,
    IGemBoxRewardRow,
    IShopCostRow,
} from './StoreCostTable';

// 协议

/** 通用商店购买（`CmdShopBuyReqMsg`）。 */
export class RequestShopBuy extends RequestMsg<CmdShopBuyReqMsg, CmdShopBuyRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdShopBuyReqMsg';
    }
}

/**
 * 商城用到的 `CmdShopType` 档位（数值对齐 proto 枚举，见文件头第二节）。
 */
export const STORE_SHOP_TYPE = {
    /** 宝石宝箱（老端 `StoreType.gemBox`）。 */
    gemBox: 1,
    /** 杂货铺 = 黑市（老端 `StoreType.resource`）。 */
    resource: 2,
    /** 铜钱铺 = 银币（老端 `StoreType.gold`）。 */
    gold: 4,
    /** 超值礼包（老端 `StoreType.Gift`）。 */
    gift: 5,
} as const;

/** 请求结果三态（与 `LeagueRequestResult` / `HangRequestResult` 同口径）。 */
export type StoreRequestResult = 'ok' | 'offline' | 'failed';

// 表名与超时

const TABLE_GEM_BOX = 'gemBox';
const TABLE_GOLD_SHOP = 'goldShop';
const TABLE_RESOURCE_SHOP = 'resourceShop';
const TABLE_GUANKA_GIFT = 'guankaGift';
const TABLE_ROLE_PROPERTY = 'roleProperty';
const TABLE_ITEM = 'item';
const TABLE_AD = 'ad';

const READ_TIMEOUT_MS = 800;
const WRITE_TIMEOUT_MS = 5000;

// 行类型

/** `gemBox` 一行（花费字段 + 两串奖励，后者给概率说明用）。 */
export interface IStoreGemBoxRow extends IGemBoxCostRow {
    readonly rewards: readonly IGemBoxRewardRow[];
    readonly rareRewards: readonly IGemBoxRewardRow[];
}

/**
 * guankaGift 一行的购买字段。奖励展示由 StoreShopTable.STORE_GIFT_ROW 负责，
 * 这里只回答价格、限购和关卡要求。
 */
export interface IStoreGuanKaGiftRow {
    readonly id: number;
    /** 需要的关卡（`level`）；`nowLevel` 必须**大于**它（= 已通关）才可买。 */
    readonly level: number;
    readonly cost: number;
    readonly priceType: number;
    readonly limit: number;
}

/** 一个商店条目的服务端状态（`CmdShop` 缓存）。 */
export interface IStoreShopGoodsState {
    /** 已购次数（`CmdShopGoods.buyTimes`）。缓存缺失时 0。 */
    readonly buyTimes: number;
    /** 下次可买时间（**秒**；`0` = 无冷却）。 */
    readonly nextBuyTime: number;
}

// 端口

export interface IStoreRepository {
    /** 读 `gemBox` 一行（含两串奖励）。 */
    readGemBox(id: number): Promise<IStoreGemBoxRow | null>;
    /** 读 `goldShop` 一行（铜钱铺 / 银币）。 */
    readGoldShop(id: number): Promise<IShopCostRow | null>;
    /** 读 `resourceShop` 一行（杂货铺 / 黑市）。 */
    readResourceShop(id: number): Promise<IShopCostRow | null>;
    /** 读 `guankaGift` 一行。 */
    readGuanKaGift(id: number): Promise<IStoreGuanKaGiftRow | null>;

    /**
     * 我持有多少 `resId`（老端 `ModelGoods.GetGoodsNumberByRefId` 的取数口径）。
     *
     * 两步分流：`roleProperty` 里有这个 `resId` ⇒ 取它的 `key` 去 `CmdRole` 上读字段
     * （如 `resId=10 → key="coin"`）；否则当**道具**去背包（`CmdItem`）里数。
     */
    held(resId: number): Promise<number>;

    /** 某商店某条目的服务端状态（`CmdShop` 缓存，现读不缓存）。 */
    shopGoods(cmdShopType: number, id: number): IStoreShopGoodsState;

    /** `resId → 物品名`（`item` 表；查不到回退 `物品{resId}`）。 */
    itemName(resId: number): Promise<string>;

    /**
     * 某资源的「不足」提示（`roleProperty.unenoughTips`，如 `resId=10 → "金币不足"`）。
     *
     * 与老端 `CheckHaveEnoughCostAndOpenAlert` 同一取数口径 —— **真的读表**，不硬编码。
     * 查不到（道具类 `resId` 不在 `roleProperty` 里）返回**空串**，由调用方兜底文案。
     */
    unenoughTip(resId: number): Promise<string>;

    /** 今日**还能看几次**某广告位的视频（老端 `GetAdvertRestTimes` = `ad.limit` − `CmdRole.tlCmdAdvert[type].num`）。 */
    adRemaining(type: number): Promise<number>;

    /** 抽奖（`cmdShopType = gemBox`，`buyTimes` 1 / 10）。 */
    draw(cardId: number, tenTimes: boolean, caller?: object): Promise<StoreRequestResult>;
    /** 通用商店购买（铜钱铺 / 杂货铺）。 */
    buyShopGoods(id: number, cmdShopType: number, caller?: object): Promise<StoreRequestResult>;
    /** 记一次「看完广告」（`AdType`）。 */
    watchAd(type: number, caller?: object): Promise<StoreRequestResult>;
    /** 买关卡礼包（`RequestRoleGuanKaGiftBuy`）。 */
    buyGuanKaGift(resId: number, caller?: object): Promise<StoreRequestResult>;
    /** 发起真实支付（老端 `SDKMgr.pay(id, "common", 0)`）。 */
    pay(payChannelId: number): void;
}

// 实现

/** `Long` / `number` / `string` → 秒。认不出返回 0（**不能**直接 `Number(Long)`，会得 `NaN`）。 */
function toSeconds(value: unknown): number {
    if (value == null) return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'string') {
        const n = Number(value);
        return Number.isFinite(n) ? n : 0;
    }
    const long = value as { toNumber?: () => number };
    if (typeof long.toNumber === 'function') {
        const n = long.toNumber();
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
}

/** 读一张分表（`remoteRef`）；表缺失时返回空数组。 */
async function readRows(table: string): Promise<unknown[]> {
    return (await RefUtil.instance.getRefAllAsync(table)) ?? [];
}

function asRow(raw: unknown): Record<string, unknown> | null {
    return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
}

/** 按 `id` 扫一张表，返回第一行命中的原始行；无该 id 时返回 `null`。 */
async function findRowById(table: string, id: number): Promise<Record<string, unknown> | null> {
    for (const raw of await readRows(table)) {
        const row = asRow(raw);
        if (row && Number(row.id) === id) return row;
    }
    return null;
}

/**
 * 读 `CmdRole` 的**第一行**（持有量都从这一行取）。
 *
 * 选行口径对齐 `LeagueRepository.readSelfRoleRow`：优先「id 非空且非 0」的那一行，
 * 全表都没有合法 id 时才退回第一行 —— 两条链路读到同一行。
 */
function readSelfRoleRow(): unknown {
    const rows = CacheMgr.instance.getTlCmdRole() ?? [];
    let first: unknown = null;
    for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        if (!first) first = row;
        const id = String((row as { id?: unknown }).id ?? '');
        if (id.length > 0 && id !== '0') return row;
    }
    return first;
}

/**
 * 今日已用的看广告次数。CmdAdvert.num 是已用次数，剩余次数要用 ad.limit 减；
 * 字段缺失时按 0 处理。
 */
function adUsed(type: number): number {
    const rows = CacheMgr.instance.getTlCmdRole() ?? [];
    for (const row of rows) {
        if (!row) continue;
        const list = row.tlCmdAdvert;
        if (!list) return 0;
        for (const entry of list) {
            if (entry.type === type) return Number(entry.num) || 0;
        }
        return 0;
    }
    return 0;
}

class RuntimeStoreRepository implements IStoreRepository {
    // 读表

    async readGemBox(id: number): Promise<IStoreGemBoxRow | null> {
        const row = await findRowById(TABLE_GEM_BOX, id);
        if (!row) return null;
        return {
            id: Number(row.id) || 0,
            priceType: Number(row.priceType) || 0,
            cost: Number(row.cost) || 0,
            priceType3: Number(row.priceType3) || 0,
            cost3: Number(row.cost3) || 0,
            cost2: Number(row.cost2) || 0,
            quality: Number(row.quality) || 0,
            quality2: Number(row.quality2) || 0,
            rewards: parseRewardRows(row.rewards),
            rareRewards: parseRewardRows(row.rareRewards),
        };
    }

    async readGoldShop(id: number): Promise<IShopCostRow | null> {
        return this.readShopRow(TABLE_GOLD_SHOP, id);
    }

    async readResourceShop(id: number): Promise<IShopCostRow | null> {
        return this.readShopRow(TABLE_RESOURCE_SHOP, id);
    }

    async readGuanKaGift(id: number): Promise<IStoreGuanKaGiftRow | null> {
        const row = await findRowById(TABLE_GUANKA_GIFT, id);
        if (!row) return null;
        return {
            id: Number(row.id) || 0,
            level: Number(row.level) || 0,
            cost: Number(row.cost) || 0,
            priceType: Number(row.priceType) || 0,
            limit: Number(row.limit) || 0,
        };
    }

    private async readShopRow(table: string, id: number): Promise<IShopCostRow | null> {
        const row = await findRowById(table, id);
        if (!row) return null;
        return {
            id: Number(row.id) || 0,
            cost: Number(row.cost) || 0,
            priceType: Number(row.priceType) || 0,
            freeTimes: Number(row.freeTimes) || 0,
            adTimes: Number(row.adTimes) || 0,
            limit: Number(row.limit) || 0,
        };
    }

    // 读缓存

    async held(resId: number): Promise<number> {
        // ① `roleProperty` 里有 ⇒ 它的 `key` 就是 `CmdRole` 上的字段名。
        for (const raw of await readRows(TABLE_ROLE_PROPERTY)) {
            const row = asRow(raw);
            if (!row || Number(row.resId) !== resId) continue;
            const key = String(row.key ?? '');
            if (key.length === 0) break;
            return rolePropertyAmount(readSelfRoleRow(), key).value;
        }
        // ② 否则当道具（背包 `CmdItem`）。
        return countItem(resId);
    }

    shopGoods(cmdShopType: number, id: number): IStoreShopGoodsState {
        const shop = asRow(CacheMgr.instance.getCmdShop(cmdShopType as CmdShopType));
        const list = (shop?.tlCmdShopGoods ?? []) as unknown[];
        for (const raw of list) {
            const row = asRow(raw);
            if (!row || Number(row.id) !== id) continue;
            return {
                buyTimes: Math.max(0, Number(row.buyTimes) || 0),
                nextBuyTime: toSeconds(row.nextBuyTime),
            };
        }
        return { buyTimes: 0, nextBuyTime: 0 };
    }

    async itemName(resId: number): Promise<string> {
        for (const raw of await readRows(TABLE_ITEM)) {
            const row = asRow(raw);
            if (!row || Number(row.resId) !== resId) continue;
            const name = String(row.name ?? '');
            if (name.length > 0) return name;
        }
        return `物品${resId}`;
    }

    async unenoughTip(resId: number): Promise<string> {
        for (const raw of await readRows(TABLE_ROLE_PROPERTY)) {
            const row = asRow(raw);
            if (!row || Number(row.resId) !== resId) continue;
            return String(row.unenoughTips ?? '');
        }
        return '';
    }

    async adRemaining(type: number): Promise<number> {
        const limit = storeAdLimit(await readRows(TABLE_AD), type);
        return Math.max(0, limit - adUsed(type));
    }

    // 发包

    draw(cardId: number, tenTimes: boolean, caller?: object): Promise<StoreRequestResult> {
        return this.shopBuy(cardId, STORE_SHOP_TYPE.gemBox, tenTimes ? 10 : 1, caller);
    }

    buyShopGoods(id: number, cmdShopType: number, caller?: object): Promise<StoreRequestResult> {
        return this.shopBuy(id, cmdShopType, 1, caller);
    }

    async watchAd(type: number, caller?: object): Promise<StoreRequestResult> {
        if (!GameNet.instance.isConnected) return 'offline';
        try {
            const sent = await withTimeout(
                GameNet.instance.send(new RequestRoleWatchAdvert({ type }, caller, (rsp: CmdRoleWatchAdvertRspMsg) => {
                    if (rsp?.tlCmdGoods?.length) FW.ShowReward(rsp.tlCmdGoods);
                }), false),
                WRITE_TIMEOUT_MS,
                () => false,
            );
            return sent === true ? 'ok' : 'failed';
        } catch (error) {
            console.warn('[Store] 看广告请求失败', error);
            return 'failed';
        }
    }

    async buyGuanKaGift(resId: number, caller?: object): Promise<StoreRequestResult> {
        if (!GameNet.instance.isConnected) return 'offline';
        try {
            const sent = await withTimeout(
                GameNet.instance.send(new RequestRoleGuanKaGiftBuy({ resId }, caller, (rsp: CmdRoleGuanKaGiftBuyRspMsg) => {
                    if (rsp?.tlCmdGoods?.length) FW.ShowReward(rsp.tlCmdGoods);
                }), false),
                WRITE_TIMEOUT_MS,
                () => false,
            );
            return sent === true ? 'ok' : 'failed';
        } catch (error) {
            console.warn('[Store] 买礼包请求失败', error);
            return 'failed';
        }
    }

    pay(payChannelId: number): void {
        FW.pay(payChannelId, 'common', 0);
    }

    /** 通用商店购买的共同实现（三处调用点只差 `cmdShopType` / `buyTimes`）。 */
    private async shopBuy(
        id: number,
        cmdShopType: number,
        buyTimes: number,
        caller?: object,
    ): Promise<StoreRequestResult> {
        if (!GameNet.instance.isConnected) return 'offline';
        try {
            const sent = await withTimeout(
                GameNet.instance.send(new RequestShopBuy(
                    { id, cmdShopType, buyTimes } as CmdShopBuyReqMsg,
                    caller,
                    (rsp: CmdShopBuyRspMsg) => {
                        if (rsp?.tlCmdGoods?.length) {
                            FW.ShowReward(rsp.tlCmdGoods, { isGold: cmdShopType === STORE_SHOP_TYPE.gold });
                        }
                    },
                ), false),
                WRITE_TIMEOUT_MS,
                () => false,
            );
            return sent === true ? 'ok' : 'failed';
        } catch (error) {
            console.warn('[Store] 商店购买请求失败', error);
            return 'failed';
        }
    }
}

/** `rewards` / `rareRewards` 两串 → 规范化行（`resId` 为 0 的条目丢弃）。 */
function parseRewardRows(raw: unknown): readonly IGemBoxRewardRow[] {
    if (!Array.isArray(raw)) return [];
    const out: IGemBoxRewardRow[] = [];
    for (const entry of raw) {
        const row = asRow(entry);
        if (!row) continue;
        const resId = Number(row.resId) || 0;
        if (resId <= 0) continue;
        const pro = row.pro == null ? undefined : Number(row.pro) || 0;
        out.push({ resId, number: Number(row.number) || 0, ...(pro === undefined ? {} : { pro }) });
    }
    return out;
}

export const storeRepository: IStoreRepository = new RuntimeStoreRepository();

/** 读一次超时常量给测试用（避免测试里硬编码 800/5000）。 */
export const STORE_READ_TIMEOUT_MS = READ_TIMEOUT_MS;
export const STORE_WRITE_TIMEOUT_MS = WRITE_TIMEOUT_MS;
