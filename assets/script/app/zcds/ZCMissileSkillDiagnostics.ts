import { ZCDC_LOG_MISSILE } from './ZCDCLogSwitch';

/**
 * 镭射飞龙 68010 的技能计划门槛，0 = 按真实等级。
 * 101003 追踪导弹三档要 9/18/24 级，测试号基本 1 级，整条链会被 selectZCSkillPlans 过滤掉。
 * 这里只抬 68010 的技能计划筛选，单位成长仍用真实等级。上线前必须改回 0。
*/
export const ZC_MISSILE_DEBUG_HERO_LEVEL = 24;

/** 需要监视追踪导弹诊断的单位 ID 清单。*/
export const ZC_MISSILE_WATCH_UNIT_IDS: readonly string[] = ['68010'];

export function zcIsMissileWatchUnit(unitId: string | number | null | undefined): boolean {
    if (unitId == null) return false;
    return ZC_MISSILE_WATCH_UNIT_IDS.includes(String(unitId));
}

const onceKeys = new Set<string>();
const lastMessage = new Map<string, string>();

/** 每次都打，用在开火成功、实体创建这种低频点。*/
export function missileLog(scope: string, message: string, detail?: unknown): void {
    if (!ZCDC_LOG_MISSILE) return;
    if (detail === undefined) console.info(`[导弹诊断][${scope}] ${message}`);
    else console.info(`[导弹诊断][${scope}] ${message}`, detail);
}

/** 同一个 key 全局只打一次。*/
export function missileLogOnce(key: string, scope: string, message: string, detail?: unknown): void {
    if (!ZCDC_LOG_MISSILE || onceKeys.has(key)) return;
    onceKeys.add(key);
    if (detail === undefined) console.info(`[导弹诊断][${scope}] ${message}`);
    else console.info(`[导弹诊断][${scope}] ${message}`, detail);
}

// 射线打空时 fire() 每帧都会失败一次（返回 false 不推进冷却），只在结果串变化时打。
export function missileLogChanging(key: string, scope: string, message: string): void {
    if (!ZCDC_LOG_MISSILE || lastMessage.get(key) === message) return;
    lastMessage.set(key, message);
    console.info(`[导弹诊断][${scope}] ${message}`);
}
