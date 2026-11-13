/**
 * 施法动作表现（2026-11-13 用户需求）。
 *
 * 原话：「角色使用技能的表现调整，当角色在移动中，释放任意的主动技能都需要角色要播放攻击动作
 * （当前已经是攻击动作就无需打断），释放 buff 类技能（回血，加伤害）时要打断 walk，
 * 停止在原地（不影响攻击），匹配对应的特效或数字加成的动画播放时间结束才继续」。
 *
 * 拆成两件互不耦合的事，各自一个字段（都挂在 `ZCUnitState` 上、进快照）：
 *
 * 1. **施法动作窗口**（`castActionUntil`）—— 任意一条**主动**车道真放出去的那一刻，往后
 *    {@link ZC_SKILL_CAST_ACTION_SECONDS} 秒内表现层把片段换成攻击动作（`ZCUnitView` 的 `casting`）。
 *    只改**播哪一段**，不动 `battleState`、不挡移动 —— 人还在跑，动作换成出拳。
 *    已经是 `attack` 状态时天然就是攻击动作，窗口不会打断它：`attackRestarted` 那条只认
 *    `attacking`，所以也不会把正在播的那一拳拉回第 0 帧。
 *
 * 2. **原地施法锁**（`castHoldUntil`）—— 只有 buff 类（`behaviorKey === 'self_cast'`：
 *    吃口菠萝自愈 100603 / 嗜血 100703 / 迅击 100903 / 狂暴 94031x）才写。
 *    `ZCUnitSystem.updateUnit` 在锁定期内把单位按回 `idle` 原地站着，**但不拦攻击**
 *    （用户口径「不影响攻击」）—— 射程内有目标、普攻 CD 到点就照常出拳。
 *    写法与 `dashRecoverUntil`（冲刺后原地待机）同一套，区别只是那个连索敌都不做。
 *
 * ## 为什么不走配表
 *
 * `pvpSkillPlan.skillParamJson` 里的 `selfCastSeconds` 是**增益持续秒**（4~8 秒），
 * 拿它当停顿时长会让角色站在半局不动；而「施法动作该持续多久」本质是**动画片段时长**，
 * 它属于表现、不属于数值槽 —— 与 `ZC_BLINK_CAST_EFFECT_SECONDS`（瞬间移动特效 0.75s）
 * 同一条理由。所以两条时长都收在这里；真要逐档不同，再单独加参数，
 * 别顺手往那张表里塞一列（那张表三写：源表 xlsx + remoteRef + client）。
 *
 * ⚠️ 本文件必须保持**无 `cc` 依赖**：模型层（触发系统 / 单位系统）与用例都要读它，
 * 有引擎依赖就没法在没有 Cocos 的环境里被直接断言。
 */

/** 施法动作窗口（秒）：任意主动技能落地后，角色改播攻击动作的时长。 */
export const ZC_SKILL_CAST_ACTION_SECONDS = 0.5;

/** buff 类（`self_cast`）施法时**原地站定**的时长（秒）。 */
export const ZC_SELF_CAST_HOLD_SECONDS = 0.5;
