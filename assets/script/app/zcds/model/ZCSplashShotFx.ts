/**
 * 孢爆箭 / 孢子凝珠（splash_shot / spore_burst）的 facade。
 *
 * 两条路径、行为键与减速状态前缀已迁到目录/调参表；
 * 本文件只保留原导出名与纯函数。
 */

import { ZC_EFFECT_BEHAVIOR_KEYS, ZC_EFFECT_PATHS, zcEffectPathsForBehavior } from './ZCEffectCatalog';
import { ZC_EFFECT_STATUS_PREFIX } from './ZCEffectTuning';

/** 弹体（飞行段）特效：通用箭矢。*/
export const ZC_SPLASH_SHOT_MISSILE_PREFAB_PATH = ZC_EFFECT_PATHS.splashMissile;

/** 命中爆点特效：普攻爆炸。*/
export const ZC_SPLASH_SHOT_IMPACT_PREFAB_PATH = ZC_EFFECT_PATHS.burstImpact;

/** 无减速的那条（孢爆箭）。*/
export const ZC_SPLASH_SHOT_BEHAVIOR_KEY = ZC_EFFECT_BEHAVIOR_KEYS.splashShot;

/** 带减速的那条（孢子凝珠）。*/
export const ZC_SPORE_BURST_BEHAVIOR_KEY = ZC_EFFECT_BEHAVIOR_KEYS.sporeBurst;

const SPLASH_SHOT_BEHAVIOR_KEYS: ReadonlySet<string> = new Set([
    ZC_SPLASH_SHOT_BEHAVIOR_KEY, ZC_SPORE_BURST_BEHAVIOR_KEY,
]);

/** 这个行为键走不走「射一发会爆的弹」这条车道。*/
export function zcIsSplashShotBehavior(behaviorKey: string | null | undefined): boolean {
    return behaviorKey != null && SPLASH_SHOT_BEHAVIOR_KEYS.has(behaviorKey);
}

/** 行为键 → 这条车道需要的两条 prefab 路径；不是这条车道返回空数组。*/
export function zcSplashShotEffectPaths(behaviorKey: string | null | undefined): readonly string[] {
    return zcIsSplashShotBehavior(behaviorKey) ? zcEffectPathsForBehavior(behaviorKey) : [];
}

/** 减速状态的 id：`__shotslow:<百分点>:<秒>__`。*/
export function splashShotSlowStatusId(slowPct: number, seconds: number): string {
    return `${ZC_EFFECT_STATUS_PREFIX.splashSlow}:${slowPct.toFixed(4)}:${seconds.toFixed(2)}__`;
}
