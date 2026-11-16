/**
 * 施法动作（2026-11-13 需求）。
 *
 * 移动中放主动技能，要把片段换成攻击动作；buff 类（self_cast：回血、加伤害）则原地停下，
 * 但不影响攻击，等动作播完再继续走。拆成两个时间戳，都挂在 ZCUnitState 上、进快照：
 *
 * - castActionUntil：任意主动技能真正放出去时写，之后 ZC_SKILL_CAST_ACTION_SECONDS 内
 * 表现层播攻击动作（ZCUnitView 的 casting）。只换片段，不动 battleState、不挡移动；
 * 已经在 attack 的不会被打断。
 * - castHoldUntil：只有 self_cast 写。ZCUnitSystem.updateUnit 在锁定期内把单位按回 idle 原地站，
 * 但照常索敌出拳。写法同 dashRecoverUntil，区别是那个连索敌都不做。
 *
 * 时长不走配表：skillParamJson.selfCastSeconds 是增益持续秒（4~8s），拿来当停顿人会在原地站半局；
 * 「施法动作播多久」本质是动画片段长度，和 ZC_BLINK_CAST_EFFECT_SECONDS 一样属于表现。
 * 本文件不能引 cc，模型层和用例都要直接读。
*/

/** 施法动作窗口（秒）。*/
export const ZC_SKILL_CAST_ACTION_SECONDS = 0.5;

/** buff 类施法时原地站定的时长（秒）。*/
export const ZC_SELF_CAST_HOLD_SECONDS = 0.5;
