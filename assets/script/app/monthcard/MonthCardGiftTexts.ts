/** 月卡礼包固定文案。prefab 里静态 Label 照此值生成，变化文案运行时赋值。 */
export const MONTHCARD_TEXTS = {
    remainPrefix: '剩余',
    remainSuffix: '天',
    descPrefix: '购买有效期持续',
    descSuffix: '天',
    gainLabel: '立即获得',
    dayLabel: '每日领取',
    buyPrefix: '￥',
    renewPrefix: '续费',
    claim: '领取',
    taken: '已领取',
    dailyNotTaken: '请先领取每日奖励',
    /**
     * 购买成功飘字（`CmdCardBuyBroMsg` 广播后）。
     * ⚠️ 老端 `ModelMonthCard` 这里飘的是 `BATTLE_SWEEP_TIMES_ENOUGH`（「免费次数已用尽，开启月卡无限扫荡」）
     * —— 那是复用了一条现成文案、语义错位（老端自己也注释「改文案改表这一行即可」）。
     * Demo3.8 的 Texts 约定是硬编码语义正确的文案，这里用「购买成功」。
     */
    buySuccess: '购买成功',
    empty: '暂无月卡配置',
    offline: '未连接游戏服',
    failed: '操作失败，请稍后再试',
    entryLoadFailed: '月卡内容加载失败',
} as const;
