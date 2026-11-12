/**
 * ZCDC 日志开关（2026-10-15）。
 *
 */
export const ZCDC_LOG_DIAGNOSTICS = false;

/** 加载失败 / 资源缺失 / 配置缺失告警；默认开，定位完可以不关（它不打在每帧路径上）。 */
export const ZCDC_LOG_WARNINGS = true;

/**
 * 追踪导弹（镭射飞龙 68010）专项诊断；默认开，**定位完改回 false**。
 *
 * 为什么不并进 `ZCDC_LOG_DIAGNOSTICS`：那一个一开会把整局所有逐帧诊断一起刷屏，
 * 而这条只需要盯一个技能（每 12s 几行，频率极低），分开才看得清。
 * 用的还是同一个 `[导弹诊断]` 前缀，控制台过滤这 6 个字即可。
 */
export const ZCDC_LOG_MISSILE = true;

/**
 * 技能释放链路专项诊断（`[技能诊断]` 前缀，2026-11-10）。
 *
 * 只打 `ZCSkillCastDiagnostics.ZC_SKILL_CAST_WATCH_UNITS` 里的卡，所以即使开着也不会刷屏。
 * 排查完把关注名单清空，或把这里改回 `false`。
 */
export const ZCDC_LOG_SKILL_CAST = true;
