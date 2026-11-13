/**
 * 引导的「完成判定」上报通道。
 *
 * ## 为什么要一个通道
 *
 * `guideStep.completeCond` 是业务事件名（`tileFlipped` / `cardLevelUp:68001` …），
 * 但业务侧（领地 / 卡牌 / 关卡）不该持有 `GuideController` 引用 —— 那会让每个 feature
 * 反向依赖引导。所以走 `EventMgr` 单向广播：业务侧只管说"这件事发生了"，
 * 由 Controller 决定它是不是当前步要的那件。
 *
 * ## 用法（业务侧一行）
 *
 * ```ts
 * reportGuideComplete('tileFlipped');          // 对应 completeCond = 'tileFlipped'
 * reportGuideComplete('cardLevelUp', heroId);  // 对应 completeCond = 'cardLevelUp:68001'
 * ```
 *
 * 引导没在跑时这行只是发一个无人订阅的事件，开销可忽略。
 */

import { EventMgr } from '../../../framework/event/EventMgr';

export const GuideEvent = {
    /** 业务侧上报「某步的完成判定达成了」。payload = `IGuideCompletePayload`。 */
    Complete: 'guide:complete',
} as const;

export interface IGuideCompletePayload {
    /** 与 `guideStep.completeCond` 冒号前半段对齐。 */
    readonly cond: string;
    /** 带参判据的参数；省略则只比 `cond`。 */
    readonly arg?: string | number;
}

/** 业务侧上报入口。不要手拼事件名字符串，统一走这里。 */
export function reportGuideComplete(cond: string, arg?: string | number): void {
    const payload: IGuideCompletePayload = arg === undefined ? { cond } : { cond, arg };
    EventMgr.instance.emit(GuideEvent.Complete, payload);
}
