import { ZCDC_LOG_SKILL_ANNOUNCE, ZCDC_LOG_SKILL_CAST } from './ZCDCLogSwitch';

// 68025 大威天芦：2026-11-10 反馈“技能没效果”，最后查出来是构筑期整卡被跳过
// （没有 generalStar 行，客户端只在有星级行时才往 heroLevel 传值）。
// 2026-11-25 排查「看不到角色技能」：名单**置空 = 全量**，所有卡的车道日志都打；
// 定位完把关心的卡填回（如 ['68025']）即恢复「只打那几张」。
export const ZC_SKILL_CAST_WATCH_UNITS: readonly string[] = [];

export function zcSkillCastWatched(unitId: string | number | null | undefined): boolean {
    if (!ZCDC_LOG_SKILL_CAST || unitId == null) return false;
    if (!ZC_SKILL_CAST_WATCH_UNITS.length) return true;
    return ZC_SKILL_CAST_WATCH_UNITS.includes(String(unitId));
}

const onceKeys = new Set<string>();
const lastMessage = new Map<string, string>();

function write(scope: string, message: string, detail?: unknown): void {
    // 日志护栏按函数体扫开关，私有 helper 也得自己判一次。
    if (!ZCDC_LOG_SKILL_CAST) return;
    if (detail === undefined) console.info(`[技能诊断][${scope}] ${message}`);
    else console.info(`[技能诊断][${scope}] ${message}`, detail);
}

/** 每次都打，只给一局里只发生几次的地方用（构筑快照、一次施法）。*/
export function skillCastLog(scope: string, message: string, detail?: unknown): void {
    write(scope, message, detail);
}

/** 同一个 key 全局只打一次，给每帧都会被问一遍的快照用。*/
export function skillCastLogOnce(key: string, scope: string, message: string, detail?: unknown): void {
    if (!ZCDC_LOG_SKILL_CAST || onceKeys.has(key)) return;
    onceKeys.add(key);
    write(scope, message, detail);
}

/**
 * 只在值变化时打。
 * applySelfAura 参数不全时每帧都会被调一次（返回 false 就不消费 CD），直接打会刷屏，
 * 所以按结果串去重：失败留第一条，转成功再补一条。
*/
export function skillCastLogChanging(key: string, scope: string, message: string): void {
    if (!ZCDC_LOG_SKILL_CAST || lastMessage.get(key) === message) return;
    lastMessage.set(key, message);
    write(scope, message);
}

/* ------------------------------------------------------------------ 大招通报 */

const announceOnceKeys = new Set<string>();

/**
 * 大招通报链路（`[大招通报]`）。
 *
 * 为什么单独一条通道：通报不播时**没有任何异常** —— 可能是「车道没触发」「卡不是橙卡」
 * 「名字没查到」「队列被拒」四种之一，光看屏幕分辨不出来。每条都留一行，现场就能定位。
 *
 * 只写「一次成功」和「每卡每种原因一次」，不挂每帧路径。
*/
export function announceLog(message: string, detail?: unknown): void {
    if (!ZCDC_LOG_SKILL_ANNOUNCE) return;
    if (detail === undefined) console.info(`[大招通报] ${message}`);
    else console.info(`[大招通报] ${message}`, detail);
}

/** 同一 key 只打一次：失败原因是稳定值，一局打一行就够。*/
export function announceLogOnce(key: string, message: string, detail?: unknown): void {
    if (!ZCDC_LOG_SKILL_ANNOUNCE || announceOnceKeys.has(key)) return;
    announceOnceKeys.add(key);
    announceLog(message, detail);
}
