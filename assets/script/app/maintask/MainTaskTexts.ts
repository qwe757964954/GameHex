/**
 * 主线任务 / 主界面「10级领取」HUD 的**全部文案**（唯一出口）。
 *
 * 静态文案真源 = FGUI `组件_主界面_领取武将.xml`：`n5` 的 `text="10级领取"`、
 * `lab_value` 的 `(7/10)`。改文案只动这一处；页面脚本里不许出现中文字面量。
 */

/** 主界面「10级领取」HUD（prefab `ui/MainTask/GetHeroEntry`）。 */
export const GET_HERO_TEXTS = {
    /** 角标文案（FGUI `n5` 的 `text="10级领取"`）。 */
    entryLabel: '10级领取',
    /**
     * 进度文案模板。老端是模板串 `` `(${value}/${max})` ``（FGUI `lab_value` 的 `(7/10)`），
     * 这里收敛成占位符形式，实际拼接走 `MainTaskTable.progressTextOf`。
     */
    progress: '({0}/{1})',
    /** 领奖成功的宿主提示。 */
    claimed: '领取成功',
    /** 领奖失败（服务端拒绝 / 网络异常）。 */
    claimFailed: '领取失败',
    /**
     * 未连接服务器时的提示。
     * `MainTaskRepository.claim()` 在 `GameNet.isConnected === false` 时**直接早退**（`'offline'`），
     * 一个包都没发出去 —— 这时说「领取失败」会让人以为服务端拒了，所以单独一条。
     */
    offlineWarn: '尚未连接服务器',
    /** 任务表里没配 `targetType = 99` 时打给控制台的日志（界面直接隐藏，不显示这句话）。 */
    noTaskWarn: '[MainTask] taskMain 表里没有 targetType = 99 的行，「10级领取」隐藏',
    /** 表里有任务但服务端还没推 `CmdTask` 时的日志。 */
    noCmdWarn: '[MainTask] CmdTask 缓存里没有英雄任务，按未完成（0 进度）显示',
} as const;

/**
 * 主线任务详情弹窗（prefab `ui/MainTask/MainTaskDetail`）+ 主界面入口
 * （prefab `ui/MainTask/MainTaskEntry`）的文案。
 *
 * 静态文案真源 = FGUI：
 *   · 弹窗标题 `组件_公共弹窗_新` 的实例覆写 `customProperty title="任务详情"`
 *     （XML 里 `<Label title="任务详情"/>`）；
 *   · 前往按钮 `按钮_公共_通用` 的实例覆写 `Button title="前往"`。
 *
 * 领奖三态与「10级领取」**共用同一份字面量**（同一个 `CmdTakeMainTaskRewardReqMsg`、
 * 同一种失败分类），别在两处各写一遍 —— 改一处漏一处必然分叉。
 */
export const MAIN_TASK_TEXTS = {
    /** 主界面左侧任务按钮。 */
    entryLabel: '任务',
    /** 弹窗标题（FGUI `popBg` 的 `title`）。 */
    detailTitle: '任务详情',
    /** 「前往」按钮文字（FGUI `btn_go` 的 `Button title`）。 */
    goBtn: '前往',
    /**
     * 「前往」点击后的提示。
     *
     * 老端 `LayerMainTaskDetailUI.goto()` 是按 `taskId` 分派：
     * `500002 ⇒ CtrlJumpView.JumpType(HERO)`、`500001/500004/500007 ⇒ FIGHT`、
     * 其余 `vo.GetRef().goto`；本工程**没有接 `CtrlJumpView` 这套跳转链路**
     * （与「礼包 / 七日狂欢 / 征收」同一处置：留接线口 + 提示，不硬编路由）。
     */
    jumpNotWired: '跳转未接入',
    /** 领奖成功（`CmdTakeMainTaskRewardRspMsg` 回来）。 */
    claimed: GET_HERO_TEXTS.claimed,
    /** 领奖失败（服务端拒绝 / 网络异常）。 */
    claimFailed: GET_HERO_TEXTS.claimFailed,
    /** 未连接服务器（`GameNet.isConnected === false` ⇒ 一个包都没发）。 */
    offlineWarn: GET_HERO_TEXTS.offlineWarn,
    /** 找不到可展示的主线任务（全表已领完 / 缓存未到）时打给控制台的日志。 */
    noTaskWarn: '[MainTask] 没有可展示的主线任务（已全部领取，或 CmdTask 缓存未到）',
    /** 表里有任务但缓存里没有该 `resId` 行时的日志。 */
    noCmdWarn: '[MainTask] CmdTask 缓存里没有这条主线任务，入口隐藏',
} as const;

