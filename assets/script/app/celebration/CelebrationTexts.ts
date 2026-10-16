/**
 * 开服庆典（老端 FGUI `开服冲榜` 包 + `LayerOSRankUI`）全部文案 —— **改文案只动这一处**。
 *
 * 三个真源，逐条标了出处：
 *   ① 老端 `client/assets/remoteRef/mL.json`（列式表 `k=["id","key","name"]`）——
 *      在**本工程** `assets/remoteRef/mL.json` 里逐条比对过（7 条全在，见下）；
 *   ② FGUI「开服冲榜」包各组件的 `text` / `title` 属性 —— **静态文案的权威**；
 *   ③ Demo3.8 自备（老端的 `FW.showTip` / `FW.ShowReward` / `SDKMgr.pay` 那几条）。
 *
 * ## 已核到的 mL.json 原文（本工程 id / key / 原文）
 *
 * | id | key | 原文 |
 * |---|---|---|
 * | 115 | `Client_LimitSale` | `限购{0}/{1}` |
 * | 241 | `Client_NotInRank` | `未上榜` |
 * | 463 | `RANK_COUNTDOWN_TEXT` | `后刷新` |
 * | 464 | `RANK_POSITION_TEXT` | `第{0}名` |
 * | 465 | `SERVER_LAUNCH_RANKING_CONDITION_TITLE` | `要求` |
 * | 466 | `SERVER_LAUNCH_RANKING_CONDITION_TEXT_0` | `{0}达到{1}` |
 * | 467 | `SERVER_LAUNCH_RANKING_CONDITION_TEXT_1` | `{0}达{1}` |
 *
 * ✅ **7 条全在**，没有像 `TabGiftMonth_Lock`（挂机那轮）那种「老端有、新工程没有」的缺口。
 *
 * ## FGUI 原文（静态文案逐条抄自 XML）
 *
 * | 出处 | 节点 | 原文 |
 * |---|---|---|
 * | `组件_开服冲榜_主界面.xml` | `n119` | `排名` |
 * | 同上 | `n120` | `基础奖励` |
 * | 同上 | `lab_proty1` | `战力要求`（**设计期初值**，运行时被 `name + 要求` 覆写） |
 * | 同上 | `n105` | `排行榜奖励将于多钱活动结束后次日0：00通过邮件发放` |
 * | 同上 | `lab_proty` | `战斗力:`（**设计期初值**，运行时被 `config.name` 覆写） |
 * | 同上 | `n99` | `我的名次:` |
 * | 同上 | `lab_my_rank` | `暂无`（**设计期初值**，运行时被 `第N名` / `未上榜` 覆写） |
 * | 同上 | `refreshTime` | `13:16:55后刷新`（设计期初值，运行时 = `HH:MM:SS` + `后刷新`） |
 * | `按钮_详细_排名.xml` | `title` | `详细排名>` |
 * | `组件_开服冲榜_item3.xml` | `n41` | `已售罄` |
 * | `组件_开服冲榜_排行.xml` | — | `排名` / `玩家信息` / `战力` |
 *
 * ⚠️ **`n105` 的「多钱」是老端原文的错别字**（应为「本次」）。
 * 按「静态文案以 FGUI 为权威」这条约定**照抄不改** —— 改它等于单方面改设计稿，
 * 而且探针 / 单测是按 FGUI 原文对账的。要改先让策划改 FGUI。
 *
 * ⚠️ `myRankLabel` 的冒号是**半角 `:`**（`我的名次:`），`myPowerLabel` 也是（`战斗力:`）
 * —— FGUI 原文如此，别"顺手"换成全角。
 *
 * ## ⚠️ `lab_proty` / `lab_proty1` / `lab_my_rank` 三个初值**不留**
 *
 * 它们运行时**必然**被覆写（`config.name` / `name+要求` / 名次文案），
 * 所以迁过来的 prefab 里烘的就是初值（视觉上跟老端设计图一致），
 * 页面每趟**无条件**重写（规则 82）。这里的常量只给「拿不到 config 时」的兜底与单测对账用。
 */

/** 开服庆典文案表。 */
export const CL_TEXTS = {
    /**
     * 面板标题。
     *
     * ⚠️ FGUI 主界面的标题是**美术字**（在 `titlebg` 这张图上），没有独立文本节点
     * ⇒ 这条是老端 `CtrlRank.openLayerOSRank` 那层 / 日志 / 探针用的名字，**不上界面**。
     */
    title: '开服庆典',

    // ---------- 页签（FGUI 用图标表达，无文本；这里是名字，给日志 / 探针 / 无障碍用）----------
    tabTarget: '庆典目标',
    tabRank: '庆典排名',
    tabShop: '限时特惠',

    // ---------- FGUI 静态文案 ----------
    /** `按钮_详细_排名.title`。 */
    detailButton: '详细排名>',
    /** `btn_go_build`（`按钮_前往提升`）的静态文案。 */
    goBuildButton: '前往提升>',
    /** 排名页表头（`n119`）。 */
    colRank: '排名',
    /** 排名页表头（`n120`）。 */
    colReward: '基础奖励',
    /** 庆典目标页表头（`lab_proty1` 设计期初值）。 */
    colConditionFallback: '战力要求',
    /** `lab_proty` 设计期初值。 */
    powerLabelFallback: '战斗力:',
    /** `n99`。 */
    myRankLabel: '我的名次:',
    /** `lab_my_rank` 设计期初值（拿不到 server / rank 时显示它）。 */
    myRankFallback: '暂无',
    /** 底栏小字（`n105`）。⚠️「多钱」是原文错别字，照抄 —— 见文件头。 */
    footerTip: '排行榜奖励将于多钱活动结束后次日0：00通过邮件发放',
    /** 商品卡「已售罄」（`n41`）。 */
    soldOut: '已售罄',
    /** 详细排名弹窗的列表表头。 */
    detailColRank: '排名',
    detailColPlayer: '玩家信息',
    detailColPower: '战力',

    // ---------- mL.json ----------
    /** `RANK_COUNTDOWN_TEXT`（463）：后刷新。 */
    countdownSuffix: '后刷新',
    /** `RANK_POSITION_TEXT`（464）：第{0}名。 */
    positionTemplate: '第{0}名',
    /** `Client_NotInRank`（241）：未上榜。 */
    notInRank: '未上榜',
    /** `Client_LimitSale`（115）：限购{0}/{1}。 */
    limitSaleTemplate: '限购{0}/{1}',
    /** `SERVER_LAUNCH_RANKING_CONDITION_TITLE`（465）：要求（与 `config.name` 拼成表头）。 */
    conditionTitle: '要求',
    /** `SERVER_LAUNCH_RANKING_CONDITION_TEXT_0`（466）：{0}达到{1}（**庆典目标项**描述）。 */
    conditionText0: '{0}达到{1}',
    /** `SERVER_LAUNCH_RANKING_CONDITION_TEXT_1`（467）：{0}达{1}（**庆典排名项**战力要求）。 */
    conditionText1: '{0}达{1}',

    // ---------- 拼装用的字 / 尾缀 ----------
    /** 名次前缀（`第1名`）。 */
    rankPrefix: '第',
    /** 名次尾缀（`第1名` / `2-3名`）。 */
    rankSuffix: '名',
    /** 折扣尾缀（`5折`）。 */
    discountSuffix: '折',

    // ---------- Demo3.8 自备（老端对应 `FW.showTip` / `FW.ShowReward` / `SDKMgr.pay`）----------
    /** 离线（未连服务器）统一提示。 */
    offlineTip: '网络未连接',
    /** 请求失败提示。 */
    failedTip: '操作失败，请稍后再试',
    /** 领取成功（老端 `FW.ShowReward(rsp.tlCmdGoods)` 的替代 —— 本工程还没做奖励飘字）。 */
    claimSuccess: '领取成功',
    /** 目标未达标就点「领取」（老端没有这个分支：按钮本身按状态换页，理论上点不到）。 */
    notReachedTip: '尚未达到领取条件',
    /** 已领取过再点（同上，防御性）。 */
    alreadyClaimedTip: '该奖励已领取',
    /** 达到限购上限（老端按钮会被 `购买状态=不可购买` 盖住，同理防御性）。 */
    soldOutTip: '已达到限购上限',
    /**
     * 支付未接入。
     *
     * 老端 `ModelCelebration.RequestCelebrationBuyShop` 的分支：
     * `rsp.canRmb ? SDKMgr.pay(rmb, "common", 0) : FW.ShowReward(rsp.tlCmdGoods)`。
     * Demo3.8 **没有支付 SDK**（与礼包 / 首充 / 月卡 / 战令同一处置）⇒
     * rmb 分支只提示、不假装成功。见 `CelebrationRepository.CL_PAY_SDK_AVAILABLE`。
     */
    payUnavailable: '支付暂未接入',
    /** 跳转未接入（`celebrationConfig.goto`；老端走 `CtrlJumpView.JumpType`）。 */
    gotoUnavailable: '跳转功能暂未接入',
    /** 帮助 / 公式说明未接入（老端走 `CtrlAlert.OpenHelpe(config.tips)`）。 */
    helpUnavailable: '帮助说明暂未接入',
} as const;

/** 文案表的键类型。 */
export type CelebrationTextKey = keyof typeof CL_TEXTS;

/**
 * `{0}` / `{1}` 占位符替换（对齐老端 `StringUtil.format` 的 `{n}` 口径）。
 *
 * ⚠️ 与 `CelebrationTable` 里的 `fill` 是同一套规则的两个副本：
 * Table 那份是**零 import** 约束下的自足实现（供纯函数用），这份给页面用。
 * 两边规则一致（正则 `/\{(\d+)\}/g`、越界的占位符**原样保留**）——
 * 越界保留而不是替换成空串，是为了让"表填错列数"这种问题在界面上看得见。
 */
export function clFormat(template: string, ...args: readonly (string | number)[]): string {
    return template.replace(/\{(\d+)\}/g, (whole, index: string) => {
        const i = Number(index);
        return Number.isInteger(i) && i >= 0 && i < args.length ? String(args[i]) : whole;
    });
}
