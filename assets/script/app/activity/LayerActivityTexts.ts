/** 活动（每日任务）固定文案。带 `{0}` 模板由调用方 replace。 */
export const ACTIVITY_TEXTS = {
    /** 标题横幅上的字（FGUI `组件_活动_首页` 里 `n83` 的 text）。 */
    title: '每日任务',
    /** 周活跃积分的角标（FGUI `组件_活动_内容` 里 `n58` 的 text）。 */
    coinLabel: '周活跃',
    /** 未开始、且不知道跳转目标时的按钮文案（正常走 `taskGoto`）。 */
    taskUndone: '未完成',
    /** 可以去做（老端 `按钮_未完成` 的 title 就是「前 往」）。 */
    taskGoto: '前往',
    taskClaim: '领取',
    taskTaken: '已领取',
    /** 进度：`观看3次广告 (161/666)`。 */
    taskProgress: '({0}/{1})',
    empty: '暂无活动配置',
    offline: '未连接游戏服',
    failed: '操作失败，请稍后再试',
    /**
     * 老端 `goto` 是一个 `JUMP_TYPE` 枚举值，走 `CtrlJumpView.JumpType`。
     * 本端由 `ActivityJump.gotoActivityTask` 路由到**确实存在**的页面；
     * 表里没有的、或该玩法本工程还没落地 ⇒ 落到这句。
     */
    gotoMissing: '该功能暂未开放',
    /** 服务器上没有这个活动实例（活动没开 / 还没同步到）。 */
    notOpen: '活动暂未开启',
    /** 服务器上这个活动实例没有下发周活跃进度数据。 */
    boxMissing: '进度数据未同步',
    /** 宝箱的 `rewards` 是空数组 —— 没有东西可预览（表配错，说出来，别弹个空气泡）。 */
    boxRewardEmpty: '该宝箱暂无奖励',
} as const;
