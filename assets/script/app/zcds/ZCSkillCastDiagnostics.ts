import { ZCDC_LOG_SKILL_CAST } from './ZCDCLogSwitch';

// 68025 大威天芦：2026-11-10 反馈“技能没效果”，最后查出来是构筑期整卡被跳过
// （没有 generalStar 行，客户端只在有星级行时才往 heroLevel 传值）。
export const ZC_SKILL_CAST_WATCH_UNITS: readonly string[] = ['68025'];

export function zcSkillCastWatched(unitId: string | number | null | undefined): boolean {
    if (!ZCDC_LOG_SKILL_CAST || unitId == null) return false;
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
