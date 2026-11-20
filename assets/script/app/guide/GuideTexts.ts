/**
 * 新手引导的**全部文案**（唯一出口，纯数据、零 `cc`）。
 *
 * 与 `SHOW_REWARD_TEXTS` / `MAIN_TASK_TEXTS` 同一套做法：页面 / 组合层里不写中文字面量，
 * 改文案只动这一处。引导表的 `desc` 只描述玩法，不承载运行时提示。
 */

/** 引导层对外提示（目前只有收尾领奖那一条）。 */
export const GUIDE_TEXTS = {
    /**
     * 整条引导**最后一步（8-1）完成**时的系统提示（用户 2026-11-19 第 28 条）。
     *
     * 必须由客户端补：引导奖励是**后端在这一步完成时发的**，`guideStep.rewardJson`
     * 客户端只解析、没有任何消费方（`grep rewards assets/script/app/guide` 会命中这一点），
     * 所以「发了奖励」这件事没有别的出口可以挂提示 —— 见 `GuideComposition` 里对
     * `GuideEvent.Complete` 的监听（判 `pageOpened:task` + `stepId === '8-1'`）。
     */
    finishRewardTip: '新手引导完成，获得奖励',
} as const;
