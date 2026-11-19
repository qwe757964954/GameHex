/**
 * 落雷（bolt_strike）的 facade。
 *
 * 路径、行为键、时长与麻痹状态 id 已迁到目录/调参表；本文件只保留原导出名。
 */

import { ZC_EFFECT_BEHAVIOR_KEYS, ZC_EFFECT_PATHS } from './ZCEffectCatalog';
import { ZC_EFFECT_STATUS_PREFIX, ZC_EFFECT_TUNING } from './ZCEffectTuning';

/** 落雷 prefab 路径。*/
export const ZC_BOLT_EFFECT_PREFAB_PATH = ZC_EFFECT_PATHS.bolt;

/** 动画总时长 = 20 帧 @ sample 30；配表 boltDelay 0.15 落在第 5 帧。*/
export const ZC_BOLT_EFFECT_SECONDS = ZC_EFFECT_TUNING.boltSeconds;

/** 触发这条表现的行为键。*/
export const ZC_BOLT_STRIKE_BEHAVIOR_KEY = ZC_EFFECT_BEHAVIOR_KEYS.boltStrike;

/** 落雷命中后挂的状态：麻痹（只禁攻击、移速 -50%）。*/
export const ZC_BOLT_NUMB_STATUS_ID = ZC_EFFECT_STATUS_PREFIX.boltNumb;

/** 行为键 → 落雷特效路径；不是落雷返回 null。*/
export function zcBoltStrikeEffectPath(behaviorKey: string | null | undefined): string | null {
    return behaviorKey === ZC_BOLT_STRIKE_BEHAVIOR_KEY ? ZC_BOLT_EFFECT_PREFAB_PATH : null;
}
