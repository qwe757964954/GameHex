/**
 * 商城动作编排：5 段的所有点击都收敛到这里。
 *
 * 本层只做前置校验、发包和提示，不修改本地状态。界面等服务端推送后刷新，
 * 避免本地先假装成功导致和服务器不一致。
 * storeAction 每次调用都会打一条带参日志，供点击链路探针判断按钮是否生效。
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

/** 商城可交互的动作种类。 */
export type StoreActionKind =
    | 'draw'
    | 'ad'
    | 'help'
    | 'pay'
    | 'buyCoin'
    | 'buyGoods'
    | 'buyGift'
    | 'claimGift'
    | 'page';

/** 动作上下文。 */
export interface IStoreActionContext {
    /** 段键：gem / gift / gold / silver / goods。 */
    readonly section: string;
    /** 卡序号。 */
    readonly index?: number;
    /** 该卡在配置表里的 id。 */
    readonly rowId?: number;
    /** 附加数量，例如抽奖次数或翻页方向。 */
    readonly amount?: number;
    /** 日志用的行名。 */
    readonly label?: string;
}

/**
 * 商城动作的请求归属。
 *
 * `caller` 归 Controller（主 tab 作用域），页面切走后已发出的请求仍能回包；
 * `canSend` 归当前页面，页面销毁后二次确认等延迟入口不得再发新请求。
 */
export interface IStoreRequestScope {
    readonly caller: object;
    readonly canSend: () => boolean;
}

/** 动作执行结果。 */
export type StoreActionOutcome = 'ok' | 'blocked' | 'offline' | 'failed' | 'unavailable';

/** 金币的 resId，用于判断抽奖是否要二次确认。 */
const COIN_RES_ID = 10;

function tip(message: string): void {
    Toast.show(message);
}

/** 仓库结果转动作结果，失败时给出提示。 */
function toOutcome(result: StoreRequestResult): StoreActionOutcome {
    if (result !== 'ok') {
        tip(result === 'offline' ? STORE_TEXTS.offline : STORE_TEXTS.requestFailed);
    }
    return result;
}

/** 读「不足」提示：先问 `roleProperty.unenoughTips`，读不到再用本文件的兜底。 */
async function notEnoughTip(resId: number): Promise<string> {
    const text = await storeRepository.unenoughTip(resId);
    return text.length > 0 ? text : STORE_TEXTS.costNotEnough;
}

/**
 * 执行一个商城动作。只做校验、发包和提示，不改本地状态。
 */
export async function storeAction(
    kind: StoreActionKind,
    ctx: IStoreActionContext,
    request?: IStoreRequestScope,
): Promise<StoreActionOutcome> {
    // 供点击链路探针判断按钮是否生效，前缀不要改。
    console.log(`[Store] action=${kind}`, JSON.stringify(ctx));
    if (request && !request.canSend()) return 'blocked';

    let outcome: StoreActionOutcome;
    try {
        switch (kind) {
            case 'draw': outcome = await handleDraw(ctx, request); break;
            case 'ad': outcome = await handleAd(ctx, request); break;
            case 'help': outcome = await handleHelp(ctx); break;
            case 'pay': outcome = handlePay(ctx); break;
            case 'buyCoin': outcome = await handleBuyCoin(ctx, request); break;
            case 'buyGoods': outcome = await handleBuyGoods(ctx, request); break;
            case 'buyGift': outcome = await handleBuyGift(ctx, request); break;
            case 'claimGift': outcome = handleClaimGift(); break;
            case 'page': outcome = handlePage(); break;
            default: outcome = 'failed'; break;
        }
    } catch (error) {
        console.warn('[Store] 动作执行异常', kind, error);
        tip(STORE_TEXTS.requestFailed);
        outcome = 'failed';
    }

    // Toast 是队列化的，文案可能来自上一条提示；结果以这条日志为准。
    console.log(`[Store] outcome=${outcome} kind=${kind} section=${ctx.section}`);
    return outcome;
}

// 宝石宝箱

/**
 * 抽 1 次或 10 次：算花费、校验余额，花金币时二次确认，最后发包。
 * 单次和十连各自独立算价。
 */
async function handleDraw(ctx: IStoreActionContext, request?: IStoreRequestScope): Promise<StoreActionOutcome> {
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
                onSure: () => {
                    // 确认框可能比页面活得久：页面已销毁就不再补发这条陈旧的购买意图。
                    if (request && !request.canSend()) return;
                    void storeRepository.draw(cardId, ten, request?.caller);
                },
            },
        });
        return 'ok';
    }
    if (request && !request.canSend()) return 'blocked';
    return toOutcome(await storeRepository.draw(cardId, ten, request?.caller));
}

/**
 * 看广告免费抽。按钮常显，次数用完的判断放在点击时。
 */
async function handleAd(ctx: IStoreActionContext, request?: IStoreRequestScope): Promise<StoreActionOutcome> {
    const type = storeAdTypeOfBox(ctx.rowId);
    if ((await storeRepository.adRemaining(type)) <= 0) {
        tip(STORE_TEXTS.adUsedUp);
        return 'blocked';
    }
    // 必须先播完广告再发领奖请求，否则等于白拿。
    if (!(await playStoreAd())) {
        tip(STORE_TEXTS.adNotReady);
        return 'blocked';
    }
    if (request && !request.canSend()) return 'blocked';
    return toOutcome(await storeRepository.watchAd(type, request?.caller));
}

/** 概率说明。老端文案表里没有对应键，这里按 gemBox 的原始字段生成，不编造百分比。 */
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

// 元宝铺

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

// 铜钱铺

/**
 * 买银币或看广告换银币。免费、广告、付费三档依次判断；
 * 付费档再查限购、冷却和余额。
 */
async function handleBuyCoin(ctx: IStoreActionContext, request?: IStoreRequestScope): Promise<StoreActionOutcome> {
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
        if (request && !request.canSend()) return 'blocked';
        return toOutcome(await storeRepository.watchAd(STORE_AD_TYPE_GOLD_SHOP, request?.caller));
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
    if (request && !request.canSend()) return 'blocked';
    return toOutcome(await storeRepository.buyShopGoods(id, STORE_SHOP_TYPE.gold, request?.caller));
}

// 杂货铺

/** 买黑市道具。resourceShop 没有免费档和广告档，直接查限购和余额。 */
async function handleBuyGoods(ctx: IStoreActionContext, request?: IStoreRequestScope): Promise<StoreActionOutcome> {
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
    if (request && !request.canSend()) return 'blocked';
    return toOutcome(await storeRepository.buyShopGoods(id, STORE_SHOP_TYPE.resource, request?.caller));
}

// 关卡礼包

/**
 * 买礼包。本地只查限购；等级前置交给服务端拒绝并提示，
 * 避免在商城侧重复实现一套可能算错的关卡判断。
 */
async function handleBuyGift(ctx: IStoreActionContext, request?: IStoreRequestScope): Promise<StoreActionOutcome> {
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
    if (request && !request.canSend()) return 'blocked';
    return toOutcome(await storeRepository.buyGuanKaGift(row.id, request?.caller));
}

/** 领礼包免费奖励。对应协议还没生成，这里如实提示不可用。 */
function handleClaimGift(): StoreActionOutcome {
    tip(STORE_GIFT_FREE_UNAVAILABLE);
    return 'unavailable';
}

/** 礼包翻页。当前只上架 1 档，多页要先把礼包表改成按 level 分页。 */
function handlePage(): StoreActionOutcome {
    tip(STORE_GIFT_PAGING_UNAVAILABLE);
    return 'unavailable';
}
