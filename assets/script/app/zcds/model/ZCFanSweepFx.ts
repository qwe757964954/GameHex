/**
 * 菌丝绞杀（fan_slow）的 facade。
 *
 * 爆点路径、行为键、三个扇形比例与减速状态前缀已迁到目录/调参表；
 * 本文件只保留原导出名与纯函数。
 */

import { ZC_EFFECT_BEHAVIOR_KEYS, zcEffectPathsForBehavior } from './ZCEffectCatalog';
import { ZC_EFFECT_SCALE, ZC_EFFECT_STATUS_PREFIX } from './ZCEffectTuning';

/** 菌丝绞杀的行为键。*/
export const ZC_FAN_SWEEP_BEHAVIOR_KEY = ZC_EFFECT_BEHAVIOR_KEYS.fanSlow;

/** 扇形里铺几发爆点。*/
export const ZC_FAN_SWEEP_BURSTS = ZC_EFFECT_SCALE.fanBurstCount;

/** 每发爆点的半径 = 扇形半径 × 这个比例。*/
export const ZC_FAN_SWEEP_BURST_RADIUS_RATIO = ZC_EFFECT_SCALE.fanBurstRadiusRatio;

/** 爆点离施法者的距离 = 扇形半径 × 这个比例。*/
export const ZC_FAN_SWEEP_BURST_DISTANCE_RATIO = ZC_EFFECT_SCALE.fanBurstDistanceRatio;

/** 相邻爆点的角度间隔 = 半个扇形角 × 这个比例。*/
export const ZC_FAN_SWEEP_BURST_SPREAD = ZC_EFFECT_SCALE.fanBurstSpread;

/** 这个行为键走不走「扇形甩击」这条车道。*/
export function zcIsFanSweepBehavior(behaviorKey: string | null | undefined): boolean {
    return behaviorKey != null && behaviorKey === ZC_FAN_SWEEP_BEHAVIOR_KEY;
}

/** 行为键 → 这条车道需要的 prefab 路径；不是这条车道返回空数组。*/
export function zcFanSweepEffectPaths(behaviorKey: string | null | undefined): readonly string[] {
    return zcIsFanSweepBehavior(behaviorKey) ? zcEffectPathsForBehavior(behaviorKey) : [];
}

/** 减速状态的 id：`__fanslow:<百分点>:<秒>__`。*/
export function fanSweepSlowStatusId(slowPct: number, seconds: number): string {
    return `${ZC_EFFECT_STATUS_PREFIX.fanSlow}:${slowPct.toFixed(4)}:${seconds.toFixed(2)}__`;
}
