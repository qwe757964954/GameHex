/**
 * 科学家「精密陷阱」（trap_place）的 facade。
 *
 * 三条路径、行为键与两段动画时长已迁到目录/调参表；
 * 本文件只保留原导出名。
 */

import { ZC_EFFECT_BEHAVIOR_KEYS, ZC_EFFECT_PATHS } from './ZCEffectCatalog';
import { ZC_EFFECT_TUNING } from './ZCEffectTuning';

/** 触发这条车道的行为键。*/
export const ZC_TRAP_BEHAVIOR_KEY = ZC_EFFECT_BEHAVIOR_KEYS.trapPlace;

/** 陷阱常驻（idle 循环）：区域的 `holdVisual` 事件挂它。*/
export const ZC_TRAP_IDLE_PREFAB_PATH = ZC_EFFECT_PATHS.trapIdle;

/** 陷阱生成（start 一次性）：施法那一拍单独推一条可视事件。*/
export const ZC_TRAP_SPAWN_PREFAB_PATH = ZC_EFFECT_PATHS.trapSpawn;

/** 陷阱爆炸（一次性）：触碰 / 到点那一拍推一条事件。*/
export const ZC_TRAP_EXPIRE_PREFAB_PATH = ZC_EFFECT_PATHS.trapExpire;

/** 生成动画时长；同时是常驻视觉的延迟。*/
export const ZC_TRAP_SPAWN_SECONDS = ZC_EFFECT_TUNING.trapSpawnSeconds;

/** 爆炸动画时长；表现事件必须活够这么久。*/
export const ZC_TRAP_EXPIRE_SECONDS = ZC_EFFECT_TUNING.trapExpireSeconds;

/** 行为键 → 陷阱常驻路径；不是陷阱就返回 `null`。*/
export function zcTrapEffectPath(behaviorKey: string | null | undefined): string | null {
    return behaviorKey === ZC_TRAP_BEHAVIOR_KEY ? ZC_TRAP_IDLE_PREFAB_PATH : null;
}

/**
 * 「这条陷阱踩响/炸开时播哪张图」的逐单位例外（2026-11-19）。
 *
 * 缺省一律 `科学家_陷阱爆炸`（103504 精密陷阱就是这么配的，别动它）。
 * 68017「蘑菇爆炸」按用户口径要用**火法师普攻那一下爆点**（`普攻爆炸`）——
 * 同一份 prefab 也是菌毯爆发 / 大吼大叫的爆点，项目里唯一的一张通用爆点。
 *
 * 🔴 为什么按 **unitId** 登记、而不是加一列参数或按 skillId：
 *   · `skillParamJson` 是数值袋，塞路径会串到同卡其他技能；
 *   · 结算那一刻手上只有 `unit.unitId` 与**普攻行**的 `skillId`（30261），
 *     拿不到计划行的链号 101704 —— 按 skillId 登记会静默落到默认值。
 * 行为技能的造型一律落代码常量 + 按单位登记（与 `ZCSelfAuraFx` 同一条思路），
 * 并且必须进 `ZCVisualResourcePlan`（漏收 = 结算正常、画面全无）。
 */
export const ZC_TRAP_EXPIRE_PREFAB_BY_UNIT: Readonly<Record<string, string>> = {
    '68017': ZC_EFFECT_PATHS.burstImpact,
};

/** 这个单位的陷阱炸开时播的 prefab；没登记就沿用默认的「陷阱爆炸」。*/
export function zcTrapExpirePath(unitId: string): string {
    return ZC_TRAP_EXPIRE_PREFAB_BY_UNIT[unitId] ?? ZC_TRAP_EXPIRE_PREFAB_PATH;
}
