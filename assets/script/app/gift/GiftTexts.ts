/**
 * 礼包界面文案 —— **唯一出口**。
 *
 * 约定见 `SevenDayTexts`：子组件通过参数收文案，自己不造字符串；
 * 只有页面持有本表。改文案只改这里。
 *
 * ⚠️ `empty` / `offline` / `failed` 三档是**降级文案**，不是占位符 ——
 * 离线时礼包列表照样能画（`giftShop` 是本地表），只是已购次数全 0；
 * 真正连不上的是「购买」这个动作，所以提示挂在按钮点击之后。
 */

export const GIFT_TEXTS = {
    /** 面板标题。 */
    title: '礼包',
    /** 大页签：超值礼包。 */
    tabSpecial: '超值礼包',
    /** 大页签：灵玉直冲。 */
    tabLingYu: '灵玉直冲',
    /** 大页签：晶石兑换（open.json 里 `roleLevel >= 9999`，当前不显示，先留文案）。 */
    tabJingShi: '晶石兑换',
    /** 商品行按钮：免费。 */
    free: '免费',
    /** 商品行按钮：购买（后面跟价格数字）。 */
    buy: '购买',
    /** 已售罄角标。 */
    soldOut: '已售罄',
    /** 列表为空。 */
    empty: '暂无可购买的商品',
    /** 加载中。 */
    loading: '加载中…',
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
    /** 首充翻倍角标。 */
    firstBuyDouble: '首充翻倍',
    /**
     * 商品货币名 —— `priceType = 10` = `roleProperty.coin`。
     * ⚠️ 老端叫「元宝」，Demo3.8 的图标是 `图标_幻灵玉` ⇒ 统一「幻灵玉」。
     * 只在**拿不到货币图标**时才会被拼进按钮文案（见 `giftBuyButtonOf`）。
     */
    currency: '幻灵玉',
    /**
     * 灵玉直冲页点购买时的提示 —— 真实支付走老端的 `SDKMgr.pay`，
     * Demo3.8 没有支付 SDK，按既定范式打到业务前置为止（这里连前置请求都没有）。
     */
    payMissing: '支付功能尚未接入',
};

/**
 * 「累计充值 / 每日充值」两页的文案 —— 与 `GIFT_TEXTS` 一样是**唯一出口**。
 *
 * 分开放是因为这两页属于**活动体系**（数据来自 `CmdActivity` / `CmdRechargeDaily`），
 * 与超值礼包 / 灵玉直冲（`giftShop` / `payChannel`）不是一条链；合成一个对象以后更难对账。
 *
 * ⚠️ 四档时间/天数的模板照抄老端语言表（`mL.json` 的 `LayerFirstRecharge_Day_NUM_2` /
 * `LayerFirstRecharge_ReWard_2`），**别自己改写**：
 *   `累计{0}天` / `第{0}天充值获取{1}金币`
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
    /**
     * 顶部静态提示（FGUI 原稿 `n8` 的静态文本，老端代码不填 ⇒ 就是这句）。
     * 口径：只有**商店金币**的充值才计入每日充值额度，直接支付不算。
     */
    dailyHint: '仅商店金币的充值会计入额度',
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

    /**
     * ⚠️ **FGUI 原稿里的 `文本_倒计时`（`n2`，"活动倒计时:2天09:02:00"）本轮不落地。**
     *
     * 理由：① 老端**没有任何代码**填它（`TabGiftEveryDay` / `LayerGift` 里都搜不到），
     * 显示的是一串永不变化的**设计占位文本**；② Demo3.8 的每日充值走 `CmdRechargeDaily`，
     * 结构里**没有活动结束时间**（`endTime` 只在 `CmdActivity` 上，那是活动体系的另一条链）。
     * ⇒ 加了就是假数据，纯视觉噪声。等这条链拿到结束时间再补（届时要当心别写成死值）。
     */
    dailyCountdownOmitted: '',
};

/** 按 `{0}` / `{1}` 占位符填参数；缺参数的位置原样保留。 */
export function formatText(template: string, ...args: readonly (string | number)[]): string {
    return template.replace(/\{(\d+)\}/g, (whole, index) => {
        const value = args[Number(index)];
        return value === undefined || value === null ? whole : String(value);
    });
}
