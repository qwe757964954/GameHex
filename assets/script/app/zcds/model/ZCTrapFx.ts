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
