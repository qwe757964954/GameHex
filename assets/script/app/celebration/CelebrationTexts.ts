/**
 * 开服庆典的全部文案 —— 改文案只动这一处。
 *
 * 出处有三类：
 * 1. `mL.json`：`Client_LimitSale` / `Client_NotInRank` / `RANK_COUNTDOWN_TEXT` / `RANK_POSITION_TEXT` /
 *    `SERVER_LAUNCH_RANKING_CONDITION_TITLE` / `SERVER_LAUNCH_RANKING_CONDITION_TEXT_0,1`，本工程 `assets/remoteRef/mL.json` 里都能对上。
 * 2. FGUI「开服冲榜」包的 `text` / `title`，静态文案以它为准。
 * 3. 本工程自备：老端走 `FW.showTip` / `FW.ShowReward` / `SDKMgr.pay` 的那几条提示。
 *
 * 两处原文要照抄，不要「顺手修正」：
 * - `footerTip` 里的「多钱」是 FGUI 原文的错别字（应为「本次」），探针按原文对账。
 * - `myRankLabel` / `powerLabelFallback` 的冒号是半角 `:`，FGUI 原文如此。
 *
 * `lab_proty` / `lab_proty1` / `lab_my_rank` 三个设计期初值运行时必被覆写，这里保留常量只用于
 * 「拿不到 config / server 时」的兜底与单测对账。
 */

/** 开服庆典文案表。 */
export const CL_TEXTS = {
    // ---------- FGUI 静态文案 ----------
    /** `按钮_详细_排名.title`。 */
    detailButton: '详细排名>',
    /** `btn_go_build`（`按钮_前往提升`）的静态文案。 */
    goBuildButton: '前往提升>',
    /** 排名页表头（`n119`）。 */
    colRank: '排名',
    /** 排名页表头（`n120`）。 */
    colReward: '基础奖励',
    /** 庆典目标页表头（`lab_proty1` 设计期初值，运行时被 `name + 要求` 覆写）。 */
    colConditionFallback: '战力要求',
    /** `lab_proty` 设计期初值，运行时被 `config.name` 覆写。 */
    powerLabelFallback: '战斗力:',
    /** `n99`。 */
    myRankLabel: '我的名次:',
    /** 底栏小字（`n105`）；「多钱」是 FGUI 原文。 */
    footerTip: '排行榜奖励将于多钱活动结束后次日0：00通过邮件发放',
    /** 商品卡「已售罄」（`n41`）。 */
    soldOut: '已售罄',
    /** 详细排名弹窗的表头。 */
    detailColRank: '排名',
    detailColPlayer: '玩家信息',
    detailColPower: '战力',

    // ---------- mL.json ----------
    /** `RANK_COUNTDOWN_TEXT`（463）。 */
    countdownSuffix: '后刷新',
    /** `RANK_POSITION_TEXT`（464）。 */
    positionTemplate: '第{0}名',
    /** `Client_NotInRank`（241）。 */
    notInRank: '未上榜',
    /** `Client_LimitSale`（115）。 */
    limitSaleTemplate: '限购{0}/{1}',
    /** `SERVER_LAUNCH_RANKING_CONDITION_TITLE`（465），与 `config.name` 拼成表头。 */
    conditionTitle: '要求',
    /** `SERVER_LAUNCH_RANKING_CONDITION_TEXT_0`（466），庆典目标项描述。 */
    conditionText0: '{0}达到{1}',
    /** `SERVER_LAUNCH_RANKING_CONDITION_TEXT_1`（467），庆典排名项的战力要求。 */
    conditionText1: '{0}达{1}',
    /** 折扣尾缀（`5折`）。 */
    discountSuffix: '折',

    // ---------- 本工程自备 ----------
    /** 离线（未连服务器）统一提示。 */
    offlineTip: '网络未连接',
    /** 请求失败提示。 */
    failedTip: '操作失败，请稍后再试',
    /** 领取成功；本工程还没做奖励飘字，用 Toast 顶老端的 `FW.ShowReward`。 */
    claimSuccess: '领取成功',
    /** 目标未达标就点「领取」（老化按钮按状态换页，理论上点不到，这是防重复点击的提示）。 */
    notReachedTip: '尚未达到领取条件',
    /** 已领取过再点（同上）。 */
    alreadyClaimedTip: '该奖励已领取',
    /** 支付未接入：老端 `rsp.canRmb` 后走 `SDKMgr.pay`，本工程没有支付 SDK（与礼包 / 首充 / 月卡 / 战令同一处置）。 */
    payUnavailable: '支付暂未接入',
    /** 跳转未接入（`celebrationConfig.goto`，老端走 `CtrlJumpView.JumpType`）。 */
    gotoUnavailable: '跳转功能暂未接入',
    /** 帮助未接入（老端走 `CtrlAlert.OpenHelpe(config.tips)`）。 */
    helpUnavailable: '帮助说明暂未接入',
} as const;
