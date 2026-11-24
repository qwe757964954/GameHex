/**
 * 引导完成判定的上报通道。
 * 业务侧不持有 GuideController，统一通过 EventMgr 广播，由 Controller 判断是否当前步。
 * 用法：reportGuideComplete('tileFlipped') 或 reportGuideComplete('cardLevelUp', 68001)。
 */

import { EventMgr } from '../../../framework/event/EventMgr';

export const GuideEvent = {
    /** 业务侧上报「某步的完成判定达成了」。payload = `IGuideCompletePayload`。 */
    Complete: 'guide:complete',
    /** 对话组播放完后点击；owner + stepId 限定当前展示实例与步骤。 */
    Advance: 'guide:advance',
} as const;

export interface IGuideAdvancePayload {
    readonly stepId: string;
}

export const GuideDebugEvent = {
    ForceSkip: 'guide:debug-force-skip',
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
