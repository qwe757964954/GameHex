/**
 * 追踪导弹（镭射飞龙 68010）专项诊断日志。
 *
 * ## 为什么要单开一条通道
 *
 * 这条技能的表现是「整段消失且不报错」—— 断点可以从 5 个地方断，而每一处的静默失败
 * 都长得一样：**场上什么都没有**。所以临时开一条能一次跑完就能定位的日志：
 *
 *   ① 配表：101003 的三档有没有按 `unlockHeroLevel` 进本局（等级不够 ⇒ 参数压根不存在）
 *   ② 模型：`applyRandomStrike` 有没有真的开火（半径不够 ⇒ `strike()` 返回 0 ⇒ 连冷却都不推进）
 *   ③ 模型：`strikeTargets` 的导弹分支推了几个弹体（`missilePrefabPath` 有没有带下去）
 *   ④ 视图：特效节点创建时 `effectVisualPrefabs` 里取不取得到 prefab
 *   ⑤ 视图：挂上之后节点是否 active / 缩放 / 坐标落在哪
 *
 * 前缀统一 `[导弹诊断]`，控制台过滤这 6 个字就能看完整条链路。
 *
 * ⚠️ 定位完把 {@link ZC_LOG_MISSILE_SKILL} 改回 `false`（或整文件删除）。
 * 它不挂在 `ZCDC_LOG_DIAGNOSTICS` 上：那个开关一开会把整局所有诊断刷屏，
 * 而这次只需要盯一个技能。
 */
export const ZC_LOG_MISSILE_SKILL = true;

/**
 * 追踪导弹**测试用英雄等级**（0 = 关闭，按真实等级走）。
 *
 * ## 为什么需要
 *
 * `pvpSkillPlan` 里 101003「追踪导弹」三档的 `unlockHeroLevel` 是 **9 / 18 / 24**，
 * 而本地/测试账号的镭射飞龙普遍是 **1 级** ⇒ `selectZCSkillPlans` 把整条链过滤掉
 * ⇒ 运行时连 `strikeRadius` 参数都不存在 ⇒ 战场上永远没有导弹（2026-11-05 实测：
 * `[导弹诊断][配表] 镭射飞龙 heroLevel=1 … 含 101003 追踪导弹？false`）。
 *
 * 这时候「导弹不显示」不是 bug，是等级没到。但要验证美术/弹道就得先让它能触发，
 * 而改配表（`unlockHeroLevel`）会污染设计数据、还得记得改回去。
 *
 * 所以留这个闸门：**只对 68010（镭射飞龙）的技能计划筛选**把等级抬到该值，
 * 单位成长（攻击/血量，走 `pvpUnitGrowth`）仍按真实等级 —— 只为「看一眼导弹长什么样」。
 *
 * ⚠️ 上线前必须改回 `0`；本文件整体是临时诊断代码，定位完一起删。
 */
export const ZC_MISSILE_DEBUG_HERO_LEVEL = 24;

const ONCE_KEYS = new Set<string>();
const LAST_VALUES = new Map<string, string>();

function emit(scope: string, message: string, detail?: unknown): void {
    if (!ZC_LOG_MISSILE_SKILL) return;
    if (detail === undefined) console.info(`[导弹诊断][${scope}] ${message}`);
    else console.info(`[导弹诊断][${scope}] ${message}`, detail);
}

/** 每次都打。只用在「一局只发生几次」的地方（开火成功、实体创建）。 */
export function missileLog(scope: string, message: string, detail?: unknown): void {
    emit(scope, message, detail);
}

/** 同一个 `key` 全局只打一次。用于「每帧都会被问一遍」的参数快照。 */
export function missileLogOnce(key: string, scope: string, message: string, detail?: unknown): void {
    if (!ZC_LOG_MISSILE_SKILL || ONCE_KEYS.has(key)) return;
    ONCE_KEYS.add(key);
    emit(scope, message, detail);
}

/**
 * 值**变化时**才打。
 *
 * 射线技能打空时 `fire()` 每帧都会被调用一次（`if (!fire()) return;` 不推进冷却），
 * 直接打就是每帧一行的洪水。这里按「结果串」去重：失败只留第一条，转成功时再补一条。
 */
export function missileLogChanging(key: string, scope: string, message: string): void {
    if (!ZC_LOG_MISSILE_SKILL) return;
    if (LAST_VALUES.get(key) === message) return;
    LAST_VALUES.set(key, message);
    emit(scope, message);
}
