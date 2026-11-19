/**
 * 菌丝突刺（single_strike）的 facade。
 *
 * 路径、行为键、时长与两个状态 id 前缀已迁到目录/调参表；
 * 本文件只保留原导出名与纯函数。
 */

import { ZC_EFFECT_BEHAVIOR_KEYS, ZC_EFFECT_PATHS, zcEffectPathsForBehavior } from './ZCEffectCatalog';
import { ZC_EFFECT_STATUS_PREFIX, ZC_EFFECT_TUNING } from './ZCEffectTuning';

/** 菌丝突刺的行为键。*/
export const ZC_SINGLE_STRIKE_BEHAVIOR_KEY = ZC_EFFECT_BEHAVIOR_KEYS.singleStrike;

/** 命中表现：长戟兵_撕裂。*/
export const ZC_SINGLE_STRIKE_EFFECT_PREFAB_PATH = ZC_EFFECT_PATHS.singleStrike;

/** 命中表现播放时长 = 8 帧 ÷ 12fps。*/
export const ZC_SINGLE_STRIKE_EFFECT_SECONDS = ZC_EFFECT_TUNING.singleStrikeSeconds;

/** 这个行为键走不走「突进单体」这条车道。*/
export function zcIsSingleStrikeBehavior(behaviorKey: string | null | undefined): boolean {
    return behaviorKey != null && behaviorKey === ZC_SINGLE_STRIKE_BEHAVIOR_KEY;
}

/** 行为键 → 这条车道需要的 prefab 路径；不是这条车道返回空数组。*/
export function zcSingleStrikeEffectPaths(behaviorKey: string | null | undefined): readonly string[] {
    return zcIsSingleStrikeBehavior(behaviorKey) ? zcEffectPathsForBehavior(behaviorKey) : [];
}

/** 眩晕状态的 id：`__stunstrike:<秒>__`。*/
export function singleStrikeStunStatusId(seconds: number): string {
    return `${ZC_EFFECT_STATUS_PREFIX.singleStrikeStun}:${seconds.toFixed(2)}__`;
}

/** III 级「命中后自身攻击速度提高」的状态 id。*/
export function singleStrikeHasteStatusId(pct: number, seconds: number): string {
    return `${ZC_EFFECT_STATUS_PREFIX.singleStrikeHaste}:${pct.toFixed(4)}:${seconds.toFixed(2)}__`;
}
