/** 限时活动（三页签）固定文案。带 `{0}` 模板由调用方 replace。 */
export const LIMIT_TIME_TEXTS = {
    /** 三页签名（老端 `LayerLimitActivity_1/3/5` 的 title）。 */
    tabTask: '每日任务',
    tabDayGift: '每日礼包',
    tabLimitBuy: '限购',
    /** 三页签描述（老端 `LayerLimitActivity_2/4/6`）。 */
    tabTaskDesc: '完成任务即可领取丰富奖励',
    tabDayGiftDesc: '每日限购超值礼包',
    tabLimitBuyDesc: '限时折扣，售完即止',
    /** 任务按钮三态。 */
    taskGoto: '前往',
    taskClaim: '领取',
    taskTaken: '已领取',
    /** 礼包 / 限购按钮。 */
    goodsBuy: '购买',
    goodsSoldout: '售罄',
    /** 限购文案：`限购 {0}/{1}`（老端 `Client_LimitSale`）。 */
    limitSale: '限购 {0}/{1}',
    /** 折扣文案：`{0} 折`（老端 `Client_Discount`）。 */
    discount: '{0} 折',
    /** 倒计时前缀：`剩余时间 {0}`（老端 `Client_RemainTime`）。 */
    remainTime: '剩余时间 {0}',
    /** 活动结束（老端 `Client_ActEnd`）。 */
    actEnd: '活动已结束',
    /** 数据缺失 / 未开。 */
    notOpen: '活动暂未开启',
    offline: '未连接游戏服',
    failed: '操作失败，请稍后再试',
    gotoMissing: '该功能暂未开放',
} as const;
