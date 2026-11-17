/**
 * 礼包界面文案的唯一出口。
 *
 * 子组件通过参数接收文案，只有页面持有本表。`empty` / `offline` / `failed`
 * 是列表降级提示，不是占位符。
 */
import { formatPlaceholders } from '../../core/text/Placeholder';

export const GIFT_TEXTS = {
    /** 商品行按钮：免费。 */
    free: '免费',
    /** 列表为空。 */
    empty: '暂无可购买的商品',
    /** 离线提示。 */
    offline: '网络未连接，请稍后再试',
    /** 通用失败。 */
    failed: '操作失败，请稍后再试',
    /** 购买成功。 */
    buyOk: '购买成功',
    /** 限购模板，`{0}` = 已购次数，`{1}` = 上限。 */
    limitSale: '限购 {0}/{1}',
    /** 折扣模板，`{0}` = 折扣数（如 `5` → 「5折」）。 */
    discount: '{0}折',
    /**
     * 商品货币名。`priceType = 10` 对应 `roleProperty.coin`，界面显示“幻灵玉”。
     * 仅在拿不到货币图标时拼进按钮文案。
     */
    currency: '幻灵玉',
    /** 灵玉直冲页尚未接入支付时的提示。 */
    payMissing: '支付功能尚未接入',
};

/**
 * 「累计充值 / 每日充值」两页的文案。
 *
 * 这两页属于活动体系，数据来自 `CmdActivity` / `CmdRechargeDaily`，与 `GIFT_TEXTS`
 * 分开维护，便于和对应配置表对账。
 */
export const RECHARGE_TEXTS = {
    // ---- 页签 ----
    /** 页签：累计充值（老端 `ActivityTabBtn.payGift`，controller 页名「基础」）。 */
    tabTotal: '累计充值',
    /** 页签：充值好礼（老端 `payGift2`，页名「高级」；只有 `type 1004` 的活动开启时才显示）。 */
    tabAdvanced: '充值好礼',
    /** 页签：60 档（`rechargeDaily.round = 1`）。 */
    tabDailyRound1: '60档',
    /** 页签：300 档（`rechargeDaily.round = 2`）。 */
    tabDailyRound2: '300档',

    // ---- 累计充值 ----
    /**
     * 档位行标题。老端 `StringUtil.format("充值{0}元 ({1}/{0})", rechargeProcess, curProcess)`
     * ——注意 `{0}` 出现两次（金额），`{1}` 是已充值。
     */
    totalRowTitle: '充值{0}元 ({1}/{0})',
    /** 宝箱下方的进度文本（老端 `detail.curProcess + "/" + ref.rechargeProcess`）。 */
    progressText: '{0}/{1}',
    /** 按钮：领取。 */
    btnClaim: '领取',
    /** 按钮：前往（未达成，老端跳商店）。 */
    btnGoto: '前往',
    /** 已领取的文案（老端档位行是 controller 页，共用一处文案）。 */
    taken: '已领取',

    // ---- 每日充值 ----
    /** 行描述。老端语言表 `LayerFirstRecharge_ReWard_2` = `第{0}天充值获取{1}金币`。 */
    dailyRowTitle: '第{0}天充值获取{1}金币',
    /** 阶段格下方天数。老端语言表 `LayerFirstRecharge_Day_NUM_2` = `累计{0}天`。 */
    dailyAccDay: '累计{0}天',
    /** 按钮：未解锁。 */
    dailyLocked: '未解锁',
    /** 按钮：去充值（已解锁但没充够 ⇒ 老端跳商店）。 */
    dailyGoto: '去充值',
    /**
     * 点「前往 / 去充值」的提示。
     *
     * 老端这两个按钮都走 `CtrlJumpView` 跳**商城**（`TabMall`），Demo3.8 还没接商城路由
     * ⇒ 按既定范式（`FirstRechargeRepository` / `GIFT_TEXTS.payMissing`）**不发请求、
     * 也不假装成功**，明确给一条提示（规则：不静默失败）。
     */
    gotoMissing: '充值入口尚未接入',
};

/** 按 `{0}` / `{1}` 占位符填参数；缺参数的位置原样保留，与历史礼包文案一致。 */
export function formatText(template: string, ...args: readonly (string | number)[]): string {
    return formatPlaceholders(template, args, { missing: 'keep', nullish: 'string' });
}
