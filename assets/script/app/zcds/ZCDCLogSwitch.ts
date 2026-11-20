// zcds 的日志总闸。所有 console.* 都得挂在这几个常量后面，tests/zcds-log-switch.test.ts 会扫。

/** 逐帧 / 高频诊断。默认关，排查时临时改 true。*/
export const ZCDC_LOG_DIAGNOSTICS = false;

/** 索敌切换诊断；只记录目标变化，默认关闭。*/
export const ZCDC_LOG_TARGET_SWITCH = false;

/** 加载失败、资源或配置缺失的告警。正式包里也开着，别挂到每帧路径上。*/
export const ZCDC_LOG_WARNINGS = true;

/** 镭射飞龙 68010 追踪导弹专项，控制台过滤 [导弹诊断]。定位完改回 false。*/
export const ZCDC_LOG_MISSILE = true;

/** 技能释放链路专项，只打 ZC_SKILL_CAST_WATCH_UNITS 里的卡，前缀 [技能诊断]。*/
export const ZCDC_LOG_SKILL_CAST = true;

/** 逐次打印出手、命中与伤害飘字，排查结束后可关闭。*/
export const ZCDC_LOG_DAMAGE_FLOAT = true;
