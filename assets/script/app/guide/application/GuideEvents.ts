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

/**
 * 战斗里那三步的完成判定，**按 `guideStep` 表序**排列。
 *
 * `5-2 battleEntered` → `5-3 cardRevealFinished` → `5-4 backToMap` 全都在对局内完成，
 * 而玩家可能压根走不到某一拍：战斗中「跳过战斗 / 提前返回」一两秒就进结算，
 * 抽到的那张卡还没消失、`cardRevealFinished` 永远不会上报 ⇒ 引导长期停在 `5-3`，
 * 回主界面后焦点 `Battle/DrawnCard` 解析不出来、整层让位 —— 玩家看到的就是
 * 「打完 1-1 出来没有升级卡牌的引导」（用户 2026-11-24）。
 */
export const GUIDE_BATTLE_SETTLED_CONDS = ['battleEntered', 'cardRevealFinished', 'backToMap'] as const;

/**
 * 离开对局时把战斗步**一次性了结**（按 {@link GUIDE_BATTLE_SETTLED_CONDS} 的表序）。
 *
 * `notify` 是严格相等匹配，所以这一串只会有「命中当前步」的那条生效、其余天然是 no-op：
 * · 停在 `5-2` ⇒ 三条依次推进到 `6-1`；
 * · 停在 `5-3`（卡在抽卡演出上）⇒ `cardRevealFinished` 补齐，再 `backToMap` 到 `6-1`；
 * · 停在 `5-4` ⇒ 只有最后一条命中；
 * · 已经 `6-1` 或更后 ⇒ 三条全落空，不把进度往回带。
 *
 * 语义上这些步「对局已经结束了还教玩家看战场」没有意义，属于**被对局终结而作废**，
 * 不是玩家走了捷径 —— 表里 `skipAble = 0` 拦的是「玩家自己点跳过」，拦不住这个。
 */
export function reportBattleGuideSettled(): void {
    for (const cond of GUIDE_BATTLE_SETTLED_CONDS) reportGuideComplete(cond);
}
