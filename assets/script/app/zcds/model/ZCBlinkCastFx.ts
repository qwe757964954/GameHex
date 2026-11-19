/**
 * 移形换影（blink_strike）的 facade。
 *
 * 路径、行为键与时长已迁到 `ZCEffectCatalog` / `ZCEffectTuning`；
 * 本文件只保留原导出名，避免调用点因目录迁移而改动。
 */

import { ZC_EFFECT_BEHAVIOR_KEYS, ZC_EFFECT_PATHS } from './ZCEffectCatalog';
import { ZC_EFFECT_TUNING } from './ZCEffectTuning';

/** 瞬间移动特效的 prefab 路径（assets/bundles/battle/ 分包根下的相对路径）。*/
export const ZC_BLINK_CAST_EFFECT_PREFAB_PATH = ZC_EFFECT_PATHS.blink;

/** 特效存活时长 = 动画 clip 长度（18 帧 @ sample 24）。*/
export const ZC_BLINK_CAST_EFFECT_SECONDS = ZC_EFFECT_TUNING.blinkSeconds;

/** 触发这条表现的行为键。*/
export const ZC_BLINK_CAST_BEHAVIOR_KEY = ZC_EFFECT_BEHAVIOR_KEYS.blinkStrike;

/** 行为键 → 施法瞬间的特效路径；不是移形换影返回 null。*/
export function zcBlinkCastEffectPath(behaviorKey: string | null | undefined): string | null {
    return behaviorKey === ZC_BLINK_CAST_BEHAVIOR_KEY ? ZC_BLINK_CAST_EFFECT_PREFAB_PATH : null;
}
