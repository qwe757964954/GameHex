/**
 * 「商城」的**文案常量** —— 引擎无关（不 import `cc`），单测直接 import。
 *
 * ## 为什么不用 `FW.G_W`
 *
 * 老端所有提示都走 `FW.G_W("键")` 读 `mL` 表（`assets/remoteRef/mL.json`）。
 * **本端 `FW.G_W` 是空实现**（`framework/FW.ts` 里 `static G_W(txt) { return }`
 * ⇒ 恒 `undefined`），而且 `mL` 表里**没有**老端概率说明用的
 * `putongbaoxiangjilv` / `gaojibaoxiangjilv` 两个键。
 *
 * 所以按本工程既有口径，把文案落在**本模块自带的 `*Texts.ts`**（与
 * `gift/GiftTexts.ts` / `hang/HangTexts.ts` / `celebration/CelebrationTexts.ts`
 * 同一处置）：**Demo3.8 自备**，不假装读表。
 *
 * ## 与 `roleProperty.json` 的关系（**这两条是真的读表**）
 *
 * 「不足」类提示本表**不硬编码**，而是读 `roleProperty` 表的 `unenoughTips`
 * （`resId=7 银币` / `resId=10 金币`），与老端 `CheckHaveEnoughCostAndOpenAlert`
 * 同一取数口径。表读不到时才退到本文件的兜底文案。
 */

/** 商城动作的通用提示。 */
export const STORE_TEXTS = {
    /** 服务器没连上（`GameNet.instance.isConnected === false`）。 */
    offline: '尚未连接服务器，请先登录游戏',
    /** 请求发出去了但超时 / 失败。 */
    requestFailed: '操作失败，请稍后再试',
    /** 钥匙（`gemBox.priceType` 对应的道具）不足。 */
    keyNotEnough: '金钥匙不足',
    /** 货币不足的兜底文案（读得到 `roleProperty.unenoughTips` 时不用它）。 */
    costNotEnough: '货币不足',
    /** 限购已满（`buyTimes >= limit`）。 */
    soldOut: '已售罄',
    /** 关卡礼包要求的关卡还没通关。 */
    clearStageFirst: '请先通关该关卡',
    /** 免费礼包已经领过。 */
    giftAlreadyTaken: '该礼包免费奖励已领取',
    /** 已到列表边界（翻页 / 左右箭头）。 */
    firstPage: '已经是第一页了',
    lastPage: '已经是最后一页了',
    /** 冷却中（`goldShop.interval` 未到）。 */
    coolingDown: '冷却中，请稍后再试',
    /** 抽奖前置确认（老端 `GEM_GACHA_TIP`，`{0}` = 花费数量）。 */
    gachaTip: '是否花费{0}金币进行抽奖？',
    /** 抽奖面板的左右按钮（老端 `ModelStore_1/2/3`）。 */
    rewardConfirm: '确认',
    rewardAgainTen: '再抽十次',
    rewardAgainOne: '再抽一次',
    /** 概率说明标题（老端 `CtrlAlert.OpenProbabilityTips(key, "概率说明")`）。 */
    probabilityTitle: '概率说明',
    /** 买广告位的统一占位（广告 SDK 未接入，见 `StoreAd`）。 */
    adNotReady: '广告暂不可用，请稍后再试',
    /** 今日该广告位的次数已用完（老端是直接隐藏 `btn_ad`，本端 `btn_ad` 常显 ⇒ 点击时拦）。 */
    adUsedUp: '今日观看次数已用完',
} as const;

/**
 * 「免费礼包领取」缺协议时的**如实**提示（老端 `claimGift` → `RequestRoleGuanKaGiftGetFree`）。
 *
 * 本端 `generated/requestMsg/RequestRoleMsg.ts` 里只有 `RequestRoleGuanKaGiftBuy` 与
 * `RequestRoleGuanKaGiftSelect`，**没有 `GetFree`**（`Cmd.d.ts` 同样没有
 * `CmdRoleGuanKaGiftGetFreeReqMsg`）⇒ 这个动作在本端**发不出去**。
 *
 * 按本工程对「缺能力」的既定口径（见 `GiftTexts.ts` 的 `payNotAvailable`）：
 * **如实告知缺什么**，不假装成功、也不含糊地说「开发中」。
 */
export const STORE_GIFT_FREE_UNAVAILABLE =
    '免费领奖需要 RequestRoleGuanKaGiftGetFree 协议，本端尚未生成该协议';

/** 关卡礼包「多页」尚未落地时的如实提示（本端礼包段是单卡）。 */
export const STORE_GIFT_PAGING_UNAVAILABLE = '礼包翻页尚未接入（本端礼包段目前只落了 1 档）';

/** 概率说明的一条行文案。 */
export function storeProbabilityLine(name: string, rate: number): string {
    return `${name}：${formatRate(rate)}`;
}

/** `1.2345%` 口径的百分比（保留 4 位小数、去掉尾随 0）。 */
export function formatRate(rate: number): string {
    const value = Number.isFinite(rate) ? rate : 0;
    const text = value.toFixed(4).replace(/\.?0+$/, '');
    return `${text === '' ? '0' : text}%`;
}
