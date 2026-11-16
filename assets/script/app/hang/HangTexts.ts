/**
 * 挂机界面文案。静态串来自 mL.json，动态次数和倍率由 HangTable 格式化后传入。
 */

/** 征收文案表。 */
export const HJ_TEXTS = {
    /** 面板标题（FGUI `popBg` 的 `Label title="税收"`）。 */
    title: '税收',

    /** 进度条上的「已征收」标签（FGUI `text`）。 */
    barLabel: '已征收',

    /** 奖励区标题（FGUI `title`）。 */
    rewardTitle: '产出奖励',

    /**
     * 奖励区右上角的时间说明（FGUI `收益时间`，**静态文本**）。
     *
     * `8h` 与 `LayerHang.maxIdleTime = 8 * 60 * 60 * 1000` 同一个值，
     * 老端**没有**任何代码覆盖它 ⇒ 它是纯静态文案，改时长要同时改两处。
     * 冒号是**全角 `：`**（FGUI 原文如此）。
     */
    maxTimeHint: '当天最长征收时间：8h',

    /** 底部小字（FGUI `n69`）。 门槛与代码一致（`star` 位掩码 `>= 3` 就是 2 星），见文件头。 */
    levelHint: '征收最新2星及以上通关的关卡奖励',

    /** 月卡条说明（FGUI `n76`）。 是「**税收**不限次数」不是「征收」。 */
    monthCardHint: '购买后税收不限次数',

    /** 快速征收按钮文案（FGUI `按钮_快速征收.title`）。 */
    quickTitle: '快速征收',

    /** 领取按钮文案（FGUI `按钮_领取.title`）。 */
    claimTitle: '领取',

    /** 月卡按钮文案（FGUI `按钮_月卡.title` 初值 `￥30`，运行时按 `payChannel` 重算）。 */
    monthCardPriceFallback: '￥30',

    /**
     * 月卡价格的**模板**（老端 `monthCardBtn.title = '￥' + payRef.rmb`）。
     *
     * 与 `monthCardPriceFallback` 是两个用途：模板用于**算得出金额**时格式化，
     * 兜底值只在**表里没有福利月卡行**（`monthCard === null`）时整条照抄。
     */
    priceTemplate: '￥{0}',

    /** 月卡条左上角的「月卡」小标（设计图 `税-标注.jpg` 可见，FGUI 里画在 `taskBtn` 的图里）。 */
    monthCardLabel: '月卡',

    /** 月卡条标题（设计图 `税-标注.jpg`「福利月卡」，FGUI 里是 `n73` 这张图上的字）。 */
    monthCardTitle: '福利月卡',

    // mL.json

    /** `DAY_LEFT_TIME`：今日剩余({0}/{1})。 */
    dayLeftTime: '今日剩余({0}/{1})',
    /** `DAY_WATCH_TIME`：今日看广告次数:{0}/{1}。  冒号是半角 `:`。 */
    dayWatchTime: '今日看广告次数:{0}/{1}',
    /** `UNLIMITED_TIME`：无限征收（买月卡后替换「今日剩余」那一行）。 */
    unlimitedTime: '无限征收',
    /** `FULL_ONE_HOUR`：挂机满一小时可领取（不满 1h 点领取的提示）。 */
    fullOneHour: '挂机满一小时可领取',
    /** `ModelWorkShop_1`：领取成功。 */
    claimSuccess: '领取成功',
    /** `LayerGiftMonth_1`：月卡还在有效期内，暂不可重复购买。 */
    monthCardInEffect: '月卡还在有效期内，暂不可重复购买',

    /**
     * `TabGiftMonth_Lock`：激活月卡后解锁功能。
     *
     * **新工程 mL.json 里没有这条**（老端 id=601）⇒ 在这里新增常量。
     * 用途：非月卡玩家点 `change_btn`（倍率切换）时的提示。
     */
    monthCardLockTip: '激活月卡后解锁功能',

    /** `GObjChapterSelect_1`：免费扫荡次数已用完，是否观看广告增加1次扫荡机会？(每日最多加{0}/{1}次)。 */
    adConfirmContent: '免费扫荡次数已用完，是否观看广告增加1次扫荡机会？(每日最多加{0}/{1}次)',
    /** `GObjChapterSelect_2`：立即观看。 */
    adConfirmWatch: '立即观看',

    /** `BATTLE_SWEEP_ERROR`：当前关卡不能扫荡。 */
    sweepError: '当前关卡不能扫荡',
    /** `BATTLE_SWEEP_TIMES_ENOUGH`：每天只能扫荡%s次。  老端用 `%s` 占位（不是 `{0}`）。 */
    sweepTimesEnough: '每天只能扫荡%s次',

    // Demo3.8 自备

    /** 离线（未连服务器）统一提示。 */
    offlineTip: '网络未连接',
    /** 请求失败提示。 */
    failedTip: '操作失败，请稍后再试',
    /**
     * Demo3.8 自备：**广告播放能力没迁**（老端走 `CtrlPay.PayforAdVideo`，
     * 新工程里没有 `CtrlPay` / 也没有任何 `WxUtil` 广告 API）。
     *
     * 所以「立即观看」这一支在这里**只提示、不发 `CmdRoleWatchAdvertReqMsg`**：
     * 没有播放凭据就发请求 = 白拿一次扫荡次数（可刷）。等广告 SDK 接上再打开
     * `HangPage.HJ_AD_PLAYBACK_AVAILABLE`。
     */
    adUnavailable: '广告暂未接入',
} as const;

/** 文案表的键类型。 */
export type HangTextKey = keyof typeof HJ_TEXTS;

/**
 * `{0}` / `{1}` 占位符替换（对齐老端 `StringUtil.format` 的 `{n}` 口径）。
 *
 * 与 `%s` 不是同一套 —— `BATTLE_SWEEP_TIMES_ENOUGH` 用的是 `%s`（老端原文），
 * 那条要配 `hjFormatPercent()`。
 */
export function hjFormat(template: string, ...args: readonly (string | number)[]): string {
    return template.replace(/\{(\d+)\}/g, (whole, index: string) => {
        const i = Number(index);
        return Number.isInteger(i) && i >= 0 && i < args.length ? String(args[i]) : whole;
    });
}

/** `%s` 占位符替换（少数字段用这个口径）。 */
export function hjFormatPercent(template: string, ...args: readonly (string | number)[]): string {
    let i = 0;
    return template.replace(/%s/g, () => (i < args.length ? String(args[i++]) : '%s'));
}
