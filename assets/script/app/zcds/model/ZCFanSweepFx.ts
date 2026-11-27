/**
 * 菌丝绞杀 / 武器绞杀（fan_slow）的 facade。
 *
 * 爆点路径、行为键、三个扇形比例与减速状态前缀已迁到目录/调参表；
 * 本文件只保留原导出名与纯函数。
 *
 * 2026-11-25 第 45 批：扇形甩击的表现从「扇形里铺 3 发爆点」换成**整条扇形挥击特效**
 * （机甲菇_武器绞杀，`tools/build_jiajigu_fan_fx.py`）。原来那三个 burst 常量
 * （片数 / 半径比 / 距离比 / 角度间隔）随之退场 —— 留着就是「没人读但看着像还在生效」。
 */

import { ZC_EFFECT_BEHAVIOR_KEYS, ZC_EFFECT_PATHS, zcEffectPathsForBehavior } from './ZCEffectCatalog';
import { ZC_EFFECT_TUNING, ZC_EFFECT_STATUS_PREFIX } from './ZCEffectTuning';

/** 菌丝绞杀的行为键。*/
export const ZC_FAN_SWEEP_BEHAVIOR_KEY = ZC_EFFECT_BEHAVIOR_KEYS.fanSlow;

/** 扇形挥击 prefab：锚点在施法者、尖端朝 +X（由目录的 `facingDegrees: 0` 转向目标）。*/
export const ZC_FAN_SWEEP_PREFAB_PATH = ZC_EFFECT_PATHS.jiajiguFan;

/** 挥击演出时长（秒）= 19 帧 @ 24fps；短于它 clip 会被事件寿命截断。*/
export const ZC_FAN_SWEEP_SECONDS = ZC_EFFECT_TUNING.fanSweepSeconds;

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
