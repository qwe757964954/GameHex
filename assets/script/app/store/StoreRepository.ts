/**
 * 「商城」的**数据 + 网络端口** —— 与 `LeagueRepository` / `HangRepository` 同一套分层：
 *
 * - 页面（`StoreSectionPage`）只依赖 `StoreActions`；
 * - `StoreActions` 只依赖本文件的**取数**与**发包**两组能力；
 * - 「花了多少 / 让不让买」的规则全在 `StoreCostTable`（纯函数、可单测）；
 * - 「卡上显示什么」在 `StoreShopTable`（静态内容表）。
 *
 * ## 一、老端的四个点击入口 → 本端的四个协议动作
 *
 * | 老端实施 | 协议 | 本端方法 |
 * |---|---|---|
 * | `onClickCharge` → `SDKMgr.pay(ref.id, "common", 0)` | ——（支付 SDK，不经游戏服） | `StoreActions` 直接调 `FW.pay` |
 * | `onClickCoin` 免费 / 付费档 | `RequestShopBuy`（`CmdShopBuyReqMsg { id, cmdShopType, buyTimes }`） | {@link IStoreRepository.buyShopGoods} |
 * | `onClickCoin` 广告档 | `RequestRoleWatchAdvert`（`CmdRoleWatchAdvertReqMsg { type }`） | {@link IStoreRepository.watchAd} |
 * | 礼包 `btn_buy` → `ModelStore.requestBuyGuanKaGift(ref.id)` | `RequestRoleGuanKaGiftBuy`（`{ resId }`） | {@link IStoreRepository.buyGuanKaGift} |
 * | 宝箱 `按钮_1次/10次` → `ModelStore.requestBuy(id, StoreType.gemBox, isTen)` | `RequestShopBuy`（`cmdShopType = 1`） | {@link IStoreRepository.draw} |
 *
 * ## 二、`cmdShopType` 与老端 `StoreType` 的数值**重合**（不是我凑的）
 *
 * `CmdShopType`（proto 枚举，`Cmd.d.ts`）: `box=1 / resource=2 / diamond=3 / gold=4 / gift=5 …
 * / union=8`。
 * 老端 `ModelStore.StoreType`: `gemBox=1 / resource=2 / diamond=3 / gold=4 / Gift=5 … / League=8`。
 * 两套**逐位相同** ⇒ 商城只需要 `gemBox(1)` / `resource(2)` / `gold(4)` / `gift(5)` 四个。
 *
 * ⚠️ 但**类型不同**：`CmdShopBuyReqMsg.cmdShopType` 声明的是 proto 枚举 `CmdShopType`，
 *    而本工程从 proto 重新生成时**没有**导出该枚举的 TS 字面量（只有 `Cmd.d.ts` 的
 *    `declare enum`）。所以这里用本文件的 `STORE_SHOP_TYPE` 提供带名的数字常量，
 *    与 `league/RequestLeagueMsg.ts` 的 `LEAGUE_SHOP_TYPE_UNION` 同一处置。
 *
 * ## 三、`RequestShopBuy` 为什么在本文件重新定义
 *
 * `league/RequestLeagueMsg.ts` 里**有一份**同名类（联盟商店在用）。本文件**不复用它**：
 * 那份的注释与常量（`LEAGUE_SHOP_TYPE_UNION`）都是「联盟视角」，商城复用会让
 * `store` 模块反向依赖 `league`。而 `RequestMsg` 子类只是 `getReqMsgProtoName()`
 * 的薄包装（proto 注册在 `Cmd.d.ts` / `protoCompiledStatic.ts`，与包装类无关），
 * 两边各持一份**不会冲突**。
 *
 * ## 四、离线与超时
 *
 * - `GameNet.instance.isConnected === false` ⇒ 直接返回 `'offline'`（不静默失败，调用方据此提示）；
 * - 发送一律过 `withTimeout`（`GameNet.send` **没有**按请求的超时，服务端不回就永悬）。
 *
 * ## 五、`FW.ShowReward` 是本工程的统一发奖出口
 *
 * 三个 Rsp 都带 `tlCmdGoods` ⇒ 统一 `FW.ShowReward(...)`（组合根接到 `ShowRewardPage`）。
 * 铜钱铺（`cmdShopType = 4`）传 `{ isGold: true }` —— 对齐老端 `requestBuy` 里
 * `isGold: storeType == StoreType.gold` 的口径（换音效）。
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

// ============================================================
// 协议
// ============================================================

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

// ============================================================
// 表名 / 超时
// ============================================================

const TABLE_GEM_BOX = 'gemBox';
const TABLE_GOLD_SHOP = 'goldShop';
const TABLE_RESOURCE_SHOP = 'resourceShop';
const TABLE_GUANKA_GIFT = 'guankaGift';
const TABLE_ROLE_PROPERTY = 'roleProperty';
const TABLE_ITEM = 'item';
const TABLE_AD = 'ad';

const READ_TIMEOUT_MS = 800;
const WRITE_TIMEOUT_MS = 5000;

// ============================================================
// 行类型
// ============================================================

/** `gemBox` 一行（花费字段 + 两串奖励，后者给概率说明用）。 */
export interface IStoreGemBoxRow extends IGemBoxCostRow {
    readonly rewards: readonly IGemBoxRewardRow[];
    readonly rareRewards: readonly IGemBoxRewardRow[];
}

/**
 * `guankaGift` 一行的购买相关字段。
 *
 * ⚠️ 这里**不落** `rewards`（那是 `StoreShopTable.STORE_GIFT_ROW` 的展示职责）——
 *    本文件只回答「这一档要多少钱、限购几次、要通关到第几关」。
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

// ============================================================
// 端口
// ============================================================

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
    draw(cardId: number, tenTimes: boolean, caller?: unknown): Promise<StoreRequestResult>;
    /** 通用商店购买（铜钱铺 / 杂货铺）。 */
    buyShopGoods(id: number, cmdShopType: number, caller?: unknown): Promise<StoreRequestResult>;
    /** 记一次「看完广告」（`AdType`）。 */
    watchAd(type: number, caller?: unknown): Promise<StoreRequestResult>;
    /** 买关卡礼包（`RequestRoleGuanKaGiftBuy`）。 */
    buyGuanKaGift(resId: number, caller?: unknown): Promise<StoreRequestResult>;
    /** 发起真实支付（老端 `SDKMgr.pay(id, "common", 0)`）。 */
    pay(payChannelId: number): void;
}

// ============================================================
// 实现
// ============================================================

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

/**
 * 读 `CmdRole` 的**第一行**（持有量都从这一行取）。
 *
 * 选行口径对齐 `LeagueRepository.readSelfRoleRow`：优先「id 非空且非 0」的那一行，
 * 全表都没有合法 id 时才退回第一行 —— 两条链路读到同一行。
 */
function readSelfRoleRow(): unknown {
    try {
        const rows = (CacheMgr.instance as { getTlCmdRole?: () => unknown[] })?.getTlCmdRole?.() ?? [];
        let first: unknown = null;
        for (const row of rows) {
            if (!row || typeof row !== 'object') continue;
            if (!first) first = row;
            const id = String((row as { id?: unknown }).id ?? '');
            if (id.length > 0 && id !== '0') return row;
        }
        return first;
    } catch (error) {
        console.warn('[Store] 读 CmdRole 缓存失败', error);
        return null;
    }
}

/**
 * 今日**已用**的看广告次数（`CmdRole.tlCmdAdvert` 里某 `type` 的 `num`）。
 *
 * ⚠️ `CmdAdvert.num` 是「已用」不是「剩余」—— 剩余要拿 `ad.limit` 去减。
 * ⚠️ 该字段**只在有记录时才存在**（`tlCmdAdvert?: (CmdAdvert[]|null)`）⇒ 读不到按 0 算。
 */
function adUsed(type: number): number {
    try {
        const rows = (CacheMgr.instance as { getTlCmdRole?: () => unknown[] })?.getTlCmdRole?.() ?? [];
        for (const row of rows) {
            if (!row) continue;
            const list = (row as Record<string, unknown>).tlCmdAdvert;
            if (!Array.isArray(list)) return 0;
            for (const entry of list) {
                if (!entry || typeof entry !== 'object') continue;
                const e = entry as Record<string, unknown>;
                if (Number(e.type) === type) return Number(e.num) || 0;
            }
            return 0;
        }
    } catch (error) {
        console.warn('[Store] 读 CmdAdvert 缓存失败', error);
    }
    return 0;
}

class RuntimeStoreRepository implements IStoreRepository {
    // ---------- 读表 ----------

    async readGemBox(id: number): Promise<IStoreGemBoxRow | null> {
        for (const raw of await readRows(TABLE_GEM_BOX)) {
            const row = asRow(raw);
            if (!row || Number(row.id) !== id) continue;
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
        return null;
    }

    async readGoldShop(id: number): Promise<IShopCostRow | null> {
        return this.readShopRow(TABLE_GOLD_SHOP, id);
    }

    async readResourceShop(id: number): Promise<IShopCostRow | null> {
        return this.readShopRow(TABLE_RESOURCE_SHOP, id);
    }

    async readGuanKaGift(id: number): Promise<IStoreGuanKaGiftRow | null> {
        for (const raw of await readRows(TABLE_GUANKA_GIFT)) {
            const row = asRow(raw);
            if (!row || Number(row.id) !== id) continue;
            return {
                id: Number(row.id) || 0,
                level: Number(row.level) || 0,
                cost: Number(row.cost) || 0,
                priceType: Number(row.priceType) || 0,
                limit: Number(row.limit) || 0,
            };
        }
        return null;
    }

    private async readShopRow(table: string, id: number): Promise<IShopCostRow | null> {
        for (const raw of await readRows(table)) {
            const row = asRow(raw);
            if (!row || Number(row.id) !== id) continue;
            return {
                id: Number(row.id) || 0,
                cost: Number(row.cost) || 0,
                priceType: Number(row.priceType) || 0,
                freeTimes: Number(row.freeTimes) || 0,
                adTimes: Number(row.adTimes) || 0,
                limit: Number(row.limit) || 0,
            };
        }
        return null;
    }

    // ---------- 读缓存 ----------

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
        try {
            const mgr = CacheMgr.instance as { getCmdShop?: (type: number) => unknown };
            const shop = asRow(mgr?.getCmdShop?.(cmdShopType));
            const list = (shop?.tlCmdShopGoods ?? []) as unknown[];
            for (const raw of list) {
                const row = asRow(raw);
                if (!row || Number(row.id) !== id) continue;
                return {
                    buyTimes: Math.max(0, Number(row.buyTimes) || 0),
                    nextBuyTime: toSeconds(row.nextBuyTime),
                };
            }
        } catch (error) {
            console.warn('[Store] 读 CmdShop 缓存失败', error);
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

    // ---------- 发包 ----------

    draw(cardId: number, tenTimes: boolean, caller?: unknown): Promise<StoreRequestResult> {
        return this.shopBuy(cardId, STORE_SHOP_TYPE.gemBox, tenTimes ? 10 : 1, caller);
    }

    buyShopGoods(id: number, cmdShopType: number, caller?: unknown): Promise<StoreRequestResult> {
        return this.shopBuy(id, cmdShopType, 1, caller);
    }

    async watchAd(type: number, caller?: unknown): Promise<StoreRequestResult> {
        const net = GameNet.instance;
        if (!net?.isConnected) return 'offline';
        try {
            const sent = await withTimeout(
                net.send(new RequestRoleWatchAdvert({ type }, caller as any, (rsp: CmdRoleWatchAdvertRspMsg) => {
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

    async buyGuanKaGift(resId: number, caller?: unknown): Promise<StoreRequestResult> {
        const net = GameNet.instance;
        if (!net?.isConnected) return 'offline';
        try {
            const sent = await withTimeout(
                net.send(new RequestRoleGuanKaGiftBuy({ resId }, caller as any, (rsp: CmdRoleGuanKaGiftBuyRspMsg) => {
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
        // 老端 `SDKMgr.pay(ref.id, "common", 0)`；本端由组合根接到 `CenterPaymentService`
        // （见 `bootstrap/ProcedureBootstrap.ts`），失败时它自己 `FW.showTip`。
        FW.pay(payChannelId, 'common', 0);
    }

    /** 通用商店购买的共同实现（三处调用点只差 `cmdShopType` / `buyTimes`）。 */
    private async shopBuy(
        id: number,
        cmdShopType: number,
        buyTimes: number,
        caller?: unknown,
    ): Promise<StoreRequestResult> {
        const net = GameNet.instance;
        if (!net?.isConnected) return 'offline';
        try {
            const sent = await withTimeout(
                net.send(new RequestShopBuy(
                    { id, cmdShopType, buyTimes } as CmdShopBuyReqMsg,
                    caller as any,
                    (rsp: CmdShopBuyRspMsg) => {
                        if (rsp?.tlCmdGoods?.length) {
                            // 铜钱铺用金币音效（老端 `isGold: storeType == StoreType.gold`）。
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
