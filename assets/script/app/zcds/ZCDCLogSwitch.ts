// zcds 的日志总闸。所有 console.* 都得挂在这几个常量后面，tests/zcds-log-switch.test.ts 会扫。

/** 逐帧 / 高频诊断。默认关，排查时临时改 true。*/
export const ZCDC_LOG_DIAGNOSTICS = false;

/** 索敌切换诊断；只记录目标变化，默认关闭。*/
export const ZCDC_LOG_TARGET_SWITCH = false;

/** 加载失败、资源或配置缺失的告警。正式包里也开着，别挂到每帧路径上。*/
export const ZCDC_LOG_WARNINGS = true;

/** 镭射飞龙 68010 追踪导弹专项，控制台过滤 [导弹诊断]。定位完改回 false。*/
export const ZCDC_LOG_MISSILE = true;

/**
 * 技能释放链路专项，前缀 `[技能诊断]`。
 *
 * 2026-11-25 排查「看不到角色技能」期间把 `ZC_SKILL_CAST_WATCH_UNITS` 置空 ⇒ 全量打印
 * 所有卡；定位完把关心的卡填回白名单即可回到「只打那几张」。
*/
export const ZCDC_LOG_SKILL_CAST = true;

/**
 * 大招通报专项，前缀 `[大招通报]`。
 *
 * 默认开：一条通报一局只打几行，而这条链路「不播」时**一点报错都没有**（2026-11-25
 * 用户报「科学家放文明之火没弹出来」，隔着一个账号查了半天）⇒ 必须能在控制台直接看出
 * 是「没触发」「名字没查到」还是「队列满」。别挂到每帧路径上。
*/
export const ZCDC_LOG_SKILL_ANNOUNCE = true;

/**
 * 逐次打印出手、命中与伤害飘字。
 *
 * 2026-11-25 排查角色技能期间**临时关闭**（飘字日志一局几千行，会把 [技能诊断] 埋掉）；
 * 排查完要恢复逐次飘字，改回 true。
*/
export const ZCDC_LOG_DAMAGE_FLOAT = false;
