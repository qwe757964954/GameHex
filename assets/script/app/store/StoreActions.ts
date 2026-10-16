/**
 * 「商城」的**动作编排层** —— 5 段所有可点节点都收敛到这里。
 *
 * ## 分层（本文件在中间）
 *
 * ```
 * StoreSectionPage（点按钮）
 *      ↓  storeAction(kind, ctx)
 * StoreActions（本文件：校验 → 提示 / 发包）      ← 只做编排，不含规则、不读表
 *      ↓                                    ↘
 * StoreCostTable（纯函数：花多少 / 让不让买）   StoreRepository（读表 + 读缓存 + 发包）
 * ```
 *
 * ## 与老端 `TabStoreMain` 的对应
 *
 * | 本端 kind | 老端实施 | 本端做法 |
 * |---|---|---|
 * | `draw` | `RenderBox` 的 `按钮_1次/10次` → `ConfirmDraw` → `Draw` → `ModelStore.requestBuy(id, StoreType.gemBox, isTen)` | 算花费（{@link resolveDrawCost}）→ 不够则提示；花**金币**先二次确认（老端 `PanelDialog`）→ `draw` |
 * | `ad` | `btn_ad` → `ModelRole.RequestWatchAdvert(GetAdType(refGemBox.id))` | `playStoreAd()`（先播）→ `watchAd`（后发） |
 * | `help` | `btn_help` → `CtrlAlert.OpenProbabilityTips(key, "概率说明")` | 从 `gemBox` 表**当场生成**（本端 `mL` 表没有那两个键） |
 * | `pay` | `onClickCharge` → `SDKMgr.pay(ref.id, "common", 0)` | `storeRepository.pay(payChannel.id)` |
 * | `buyCoin` | `onClickCoin` | `resolveCoinBranch` 三档：免费 / 广告 / 付费（付费档再查限购 + 冷却 + 够钱） |
 * | `buyGoods` | `RenderGoods` + `onClickCoin` | 查限购 + 够钱 → `buyShopGoods(cmdShopType=resource)` |
 * | `buyGift` | `btn_buy` → `ModelStore.requestBuyGuanKaGift(ref.id)` | 查限购 → `buyGuanKaGift(resId)` |
 * | `claimGift` | `按钮_宝箱` → `RequestRoleGuanKaGiftGetFree` | **协议本端未生成** ⇒ 如实告知（见 `StoreTexts`） |
 * | `page` | 左右箭头切礼包页 | **本端礼包段只落 1 档** ⇒ 如实告知 |
 *
 * ## 为什么这里有 `await` 却没有「乐观更新」
 *
 * 老端所有写操作都等 `rsp` 回来才 `UpdateView()`。本端同口径：**只发请求，不改任何本地数据**
 * —— 界面刷新一律等服务端推送（`CmdShop` / `CmdRole` 在 `protoCache.json` 里，服务端会推）。
 * 「本地假装成功」会让界面与服务器状态不一致，这是上一版占位代码就守住的底线。
 *
 * ## 返回值是给探针 / 测试用的
 *
 * `storeAction` 返回 {@link StoreActionOutcome}，并且**每次调用都先打一条带参日志**
 * （`[Store] action=...`）—— `tmp/_store2_tap.mjs` 就是靠这条日志判定「点了到底有没有反应」。
 */

import { CommonTips } from '../common/CommonTips';
import { Toast } from '../common/Toast';
import { STORE_GIFT_ROW, STORE_GOLD_ROWS } from './StoreShopTable';
import { STORE_SHOP_TYPE, storeRepository, type StoreRequestResult } from './StoreRepository';
import {
    buildProbabilitySections,
    canBuyWithLimit,
    formatProbabilityText,
    isCooldownOver,
    resolveCoinBranch,
    resolveDrawCost,
} from './StoreCostTable';
import { playStoreAd, storeAdTypeOfBox, STORE_AD_TYPE_GOLD_SHOP } from './StoreAd';
import {
    STORE_GIFT_FREE_UNAVAILABLE,
    STORE_GIFT_PAGING_UNAVAILABLE,
    STORE_TEXTS,
} from './StoreTexts';

/** 商城可交互的动作种类（= 老端 `TabStoreMain` 里的 8 个点击入口）。 */
export type StoreActionKind =
    /** 宝箱：抽 1 次 / 抽 10 次（`RenderBox` 的 `按钮_1次` / `按钮_10次`）。 */
    | 'draw'
    /** 宝箱：看广告免费抽（`btn_ad`）。 */
    | 'ad'
    /** 宝箱：概率说明（`btn_help`）。 */
    | 'help'
    /** 元宝铺：拉起支付（`onClickCharge` → `SDKMgr.pay`）。 */
    | 'pay'
    /** 铜钱铺：买 / 看广告（`onClickCoin`）。 */
    | 'buyCoin'
    /** 杂货铺：买（`RenderGoods` 的 `组件_消耗`）。 */
    | 'buyGoods'
    /** 关卡礼包：购买（`btn_buy`）。 */
    | 'buyGift'
    /** 关卡礼包：领免费奖励（`按钮_宝箱`）。 */
    | 'claimGift'
    /** 关卡礼包：左右翻页（页面级）。 */
    | 'page';

/** 动作的上下文（`detail` 里放该动作需要的行数据）。 */
export interface IStoreActionContext {
    /** 段键（`gem` / `gift` / `gold` / `silver` / `goods`）。 */
    readonly section: string;
    /** 卡序号（`gem`/`gold`/`silver`/`goods` 有；`gift` 恒 0）。 */
    readonly index?: number;
    /** 该卡在真源表里的 id（`gemBox.id` / `payChannel.id` / `goldShop.id` / `resourceShop.id` / `guankaGift.id`）。 */
    readonly rowId?: number;
    /** 附加数量（抽奖次数 1/10、翻页方向 ±1 等）。 */
    readonly amount?: number;
    /** 人类可读的行名（日志用）。 */
    readonly label?: string;
}

/**
 * 动作执行结果。
 *
 * - `ok`：已发包（或已弹二次确认 / 已弹说明）—— **不代表服务端已成功**，结算看推送；
 * - `blocked`：**前置校验拦下**（钱不够 / 已售罄 / 冷却中 / 广告没放完），已给提示；
 * - `offline`：未连服务器，已给提示；
 * - `failed`：请求超时 / 失败，已给提示；
 * - `unavailable`：**本端缺能力**（协议未生成 / 页面未落地），已如实告知。
 */
export type StoreActionOutcome = 'ok' | 'blocked' | 'offline' | 'failed' | 'unavailable';

/**
 * 金币的 `resId`。
 *
 * 真源是 `roleProperty.json` 里 `key === "coin"` 的那一行（`resId = 10`）。
 * 老端同样把它编译成常量用（`roleProperty.coin`），这里对齐。
 * 用途只有一个：判断抽奖的实际花费是不是金币 ⇒ 决定要不要先弹二次确认（老端 `PanelDialog`）。
 */
const COIN_RES_ID = 10;

function tip(message: string): void {
    Toast.show(message);
}

/** `StoreRepository` 的三态 → 动作结果（顺带把提示打出去）。 */
function toOutcome(result: StoreRequestResult): StoreActionOutcome {
    if (result === 'ok') return 'ok';
    tip(result === 'offline' ? STORE_TEXTS.offline : STORE_TEXTS.requestFailed);
    return result;
}

/** 读「不足」提示：先问 `roleProperty.unenoughTips`，读不到再用本文件的兜底。 */
async function notEnoughTip(resId: number): Promise<string> {
    const text = await storeRepository.unenoughTip(resId);
    return text.length > 0 ? text : STORE_TEXTS.costNotEnough;
}

/**
 * 执行一个商城动作。
 *
 * ⚠️ 只做「校验 + 发包 + 提示」，**不改任何本地状态**（理由见文件头）。
 */
export async function storeAction(kind: StoreActionKind, ctx: IStoreActionContext): Promise<StoreActionOutcome> {
    // ⚠️ 这条日志是 `tmp/_store2_tap.mjs` 判定「点了有没有反应」的**唯一硬证据**。
    //    不要改前缀 —— 探针按 `[Store] action=` 抓。
    console.log(`[Store] action=${kind}`, JSON.stringify(ctx));

    let outcome: StoreActionOutcome;
    try {
        switch (kind) {
            case 'draw': outcome = await handleDraw(ctx); break;
            case 'ad': outcome = await handleAd(ctx); break;
            case 'help': outcome = await handleHelp(ctx); break;
            case 'pay': outcome = handlePay(ctx); break;
            case 'buyCoin': outcome = await handleBuyCoin(ctx); break;
            case 'buyGoods': outcome = await handleBuyGoods(ctx); break;
            case 'buyGift': outcome = await handleBuyGift(ctx); break;
            case 'claimGift': outcome = handleClaimGift(); break;
            case 'page': outcome = handlePage(); break;
            default: outcome = 'failed'; break;
        }
    } catch (error) {
        console.warn('[Store] 动作执行异常', kind, error);
        tip(STORE_TEXTS.requestFailed);
        outcome = 'failed';
    }

    // 同样给探针用：`Toast` 是**队列化**的（旧提示没播完，新提示要排队），所以
    // **吐司文案读到的不一定是本次动作的**。结果以这条日志为准，Toast 只作旁证。
    console.log(`[Store] outcome=${outcome} kind=${kind} section=${ctx.section}`);
    return outcome;
}

// ============================================================
// 宝石宝箱
// ============================================================

/**
 * 抽 1 次 / 抽 10 次。
 *
 * 对齐老端顺序：算花费 → 够不够 → （花金币则二次确认）→ 发包。
 * 单次与十连**各自独立**算花费（见 `StoreCostTable.resolveDrawCost`）。
 */
async function handleDraw(ctx: IStoreActionContext): Promise<StoreActionOutcome> {
    const cardId = Number(ctx.rowId) || 0;
    const ten = Number(ctx.amount) === 10;
    const row = await storeRepository.readGemBox(cardId);
    if (!row) {
        console.warn(`[Store] gemBox 表里找不到 id=${cardId}`);
        tip(STORE_TEXTS.requestFailed);
        return 'failed';
    }

    // `resolveDrawCost` 的 `heldOf` 是同步的 ⇒ 先把两种价格类型的持有量读出来。
    const held = new Map<number, number>();
    for (const resId of [row.priceType, row.priceType3]) {
        if (resId > 0 && !held.has(resId)) held.set(resId, await storeRepository.held(resId));
    }

    const cost = resolveDrawCost(row, (resId) => held.get(resId) ?? 0, ten);
    if (cost.resId <= 0 || cost.number <= 0) {
        console.warn(`[Store] gemBox id=${cardId} 未配置价格`, row);
        tip(STORE_TEXTS.requestFailed);
        return 'failed';
    }
    if ((held.get(cost.resId) ?? 0) < cost.number) {
        // 首选不够会先退到备选；备选也不够 ⇒ 提示备选货币不足。
        tip(cost.fallback ? await notEnoughTip(cost.resId) : STORE_TEXTS.keyNotEnough);
        return 'blocked';
    }

    if (cost.resId === COIN_RES_ID) {
        // 老端：花金币且玩家没勾过「不再提示」时先弹 `PanelDialog` 二次确认。
        void CommonTips.open({
            userData: {
                content: STORE_TEXTS.gachaTip.replace('{0}', String(cost.number)),
                showCancel: true,
                onSure: () => { void storeRepository.draw(cardId, ten); },
            },
        });
        return 'ok';
    }
    return toOutcome(await storeRepository.draw(cardId, ten));
}

/**
 * 看广告免费抽（老端 `btn_ad`）。
 *
 * ⚠️ 老端的 `btn_ad` 受 FGUI「有无广告」控制器 + 红点控制（`GetAdvertRestTimes > 0` 才显示），
 *    本端 prefab 里**没有那个控制器** ⇒ 按钮常显，于是把「次数用完」的判断挪到**点击时**。
 */
async function handleAd(ctx: IStoreActionContext): Promise<StoreActionOutcome> {
    const type = storeAdTypeOfBox(ctx.rowId);
    if ((await storeRepository.adRemaining(type)) <= 0) {
        tip(STORE_TEXTS.adUsedUp);
        return 'blocked';
    }
    // **先播后发**：`ad.json` 的 `type=1/2` 直接送 1 个钥匙，裸发等于白拿。
    if (!(await playStoreAd())) {
        tip(STORE_TEXTS.adNotReady);
        return 'blocked';
    }
    return toOutcome(await storeRepository.watchAd(type));
}

/**
 * 概率说明。
 *
 * ⚠️ 老端读 `mL` 表的预置文案（`putongbaoxiangjilv` / `gaojibaoxiangjilv`），
 *    本端 `mL.json` 里没有这两个键、且 `FW.G_W` 是空实现 ⇒ 这里按 `gemBox` 表的
 *    **原始字段当场生成**（奖励清单 + 稀有奖励的原始权重 `pro`），不编造百分比。
 */
async function handleHelp(ctx: IStoreActionContext): Promise<StoreActionOutcome> {
    const cardId = Number(ctx.rowId) || 0;
    const row = await storeRepository.readGemBox(cardId);
    if (!row) {
        console.warn(`[Store] gemBox 表里找不到 id=${cardId}`);
        tip(STORE_TEXTS.requestFailed);
        return 'failed';
    }

    const names = new Map<number, string>();
    for (const reward of [...row.rewards, ...row.rareRewards]) {
        if (names.has(reward.resId)) continue;
        names.set(reward.resId, await storeRepository.itemName(reward.resId));
    }

    const sections = buildProbabilitySections(
        row.rewards,
        row.rareRewards,
        (resId) => names.get(resId) ?? `物品${resId}`,
    );
    await CommonTips.open({
        userData: {
            content: formatProbabilityText(sections),
            title: STORE_TEXTS.probabilityTitle,
            showCancel: false,
        },
    });
    return 'ok';
}

// ============================================================
// 元宝铺（金币）
// ============================================================

/** 拉起支付（老端 `onClickCharge`）。请求由中心服处理，扣款由支付渠道处理。 */
function handlePay(ctx: IStoreActionContext): StoreActionOutcome {
    const index = Number(ctx.index) || 0;
    const row = STORE_GOLD_ROWS[index];
    if (!row) {
        console.warn(`[Store] 元宝铺第 ${index} 档不存在`);
        return 'failed';
    }
    storeRepository.pay(row.id);
    return 'ok';
}

// ============================================================
// 铜钱铺（银币）
// ============================================================

/**
 * 买银币 / 看广告换银币（老端 `onClickCoin` 的银币支）。
 *
 * 三档全部对齐：免费（`buyTimes < freeTimes`）/ 广告（`< freeTimes + adTimes`）/ 付费。
 * 付费档再查限购 → 冷却 → 够钱 —— 老端是**层层早退**，本端同序。
 */
async function handleBuyCoin(ctx: IStoreActionContext): Promise<StoreActionOutcome> {
    const id = Number(ctx.rowId) || 0;
    const row = await storeRepository.readGoldShop(id);
    if (!row) {
        console.warn(`[Store] goldShop 表里找不到 id=${id}`);
        tip(STORE_TEXTS.requestFailed);
        return 'failed';
    }

    const state = storeRepository.shopGoods(STORE_SHOP_TYPE.gold, id);
    const branch = resolveCoinBranch(row.freeTimes, row.adTimes, state.buyTimes);

    if (branch === 'ad') {
        if (!(await playStoreAd())) {
            tip(STORE_TEXTS.adNotReady);
            return 'blocked';
        }
        return toOutcome(await storeRepository.watchAd(STORE_AD_TYPE_GOLD_SHOP));
    }

    if (branch === 'paid') {
        if (!canBuyWithLimit(row.limit, state.buyTimes)) {
            tip(STORE_TEXTS.soldOut);
            return 'blocked';
        }
        if (!isCooldownOver(state.nextBuyTime, Math.floor(Date.now() / 1000))) {
            tip(STORE_TEXTS.coolingDown);
            return 'blocked';
        }
        if ((await storeRepository.held(row.priceType)) < row.cost) {
            tip(await notEnoughTip(row.priceType));
            return 'blocked';
        }
    }
    // 免费档（`branch === 'free'`）与付费档都走同一个购买请求。
    return toOutcome(await storeRepository.buyShopGoods(id, STORE_SHOP_TYPE.gold));
}

// ============================================================
// 杂货铺（黑市）
// ============================================================

/**
 * 买黑市道具（老端 `RenderGoods` + `onClickCoin` 的黑市支）。
 *
 * ⚠️ `resourceShop` **没有** `freeTimes` / `adTimes` ⇒ `resolveCoinBranch` 恒返 `'paid'`，
 *    这里不绕那一圈，直接查限购 + 够钱。
 */
async function handleBuyGoods(ctx: IStoreActionContext): Promise<StoreActionOutcome> {
    const id = Number(ctx.rowId) || 0;
    const row = await storeRepository.readResourceShop(id);
    if (!row) {
        console.warn(`[Store] resourceShop 表里找不到 id=${id}`);
        tip(STORE_TEXTS.requestFailed);
        return 'failed';
    }

    const state = storeRepository.shopGoods(STORE_SHOP_TYPE.resource, id);
    if (!canBuyWithLimit(row.limit, state.buyTimes)) {
        tip(STORE_TEXTS.soldOut);
        return 'blocked';
    }
    if ((await storeRepository.held(row.priceType)) < row.cost) {
        tip(await notEnoughTip(row.priceType));
        return 'blocked';
    }
    return toOutcome(await storeRepository.buyShopGoods(id, STORE_SHOP_TYPE.resource));
}

// ============================================================
// 关卡礼包
// ============================================================

/**
 * 买礼包（老端 `btn_buy` → `ModelStore.requestBuyGuanKaGift(ref.id)`）。
 *
 * ⚠️ 老端在本地还有**两道**前置：`nowLv <= ref.level` ⇒ 提示「请先通关该关卡」；
 *    `canBuy` 为假 ⇒ 提示「已售罄」。本端只做**限购**这一道：
 *    「当前可挑战关卡」在本端要 `guankaReward`（普通关列表）+ `CmdBattleLevel`（星位掩码）
 *    两处数据按 `firstRecharge/FirstRechargeTrigger.deriveMaxChallengeLevel` 的口径算，
 *    而商城这轮还没接那套查询 ⇒ **等级前置交给服务端**（它会拒并推提示），
 *    这里不硬造一个可能算错的判定。
 */
async function handleBuyGift(ctx: IStoreActionContext): Promise<StoreActionOutcome> {
    const id = Number(ctx.rowId) || STORE_GIFT_ROW.id;
    const row = await storeRepository.readGuanKaGift(id);
    if (!row) {
        console.warn(`[Store] guankaGift 表里找不到 id=${id}`);
        tip(STORE_TEXTS.requestFailed);
        return 'failed';
    }

    const state = storeRepository.shopGoods(STORE_SHOP_TYPE.gift, id);
    if (!canBuyWithLimit(row.limit, state.buyTimes)) {
        tip(STORE_TEXTS.soldOut);
        return 'blocked';
    }
    return toOutcome(await storeRepository.buyGuanKaGift(row.id));
}

/**
 * 领礼包的免费奖励（老端 `按钮_宝箱` → `RequestRoleGuanKaGiftGetFree`）。
 *
 * ⚠️ **本端缺这条协议**：`generated/netProto/Cmd.d.ts` 里只有
 *    `CmdRoleGuanKaGiftBuyReqMsg` / `CmdRoleGuanKaGiftSelectReqMsg`，
 *    **没有 `CmdRoleGuanKaGiftGetFreeReqMsg`**（`requestMsg/RequestRoleMsg.ts` 同样没有）。
 *    协议文件是 proto 生成的产物，**不能手写** ⇒ 这里如实告知，不假装成功。
 */
function handleClaimGift(): StoreActionOutcome {
    tip(STORE_GIFT_FREE_UNAVAILABLE);
    return 'unavailable';
}

/**
 * 礼包翻页（老端左右箭头）。
 *
 * ⚠️ 本端礼包段只落了 **1 档**（`guankaGift.id = 18`，即 50 关卡礼包）；
 *    真源 `guankaGift.json` 有 28 行。要做多页得先把 `StoreShopTable.STORE_GIFT_ROW`
 *    从「单行常量」改成「按 `level` 分页的行数组」，并让 `StoreSectionPage.refreshGift()`
 *    按当前页重填 —— 那是**版面改动**，不属于本轮「把点击接上真实反应」的范围。
 */
function handlePage(): StoreActionOutcome {
    tip(STORE_GIFT_PAGING_UNAVAILABLE);
    return 'unavailable';
}
