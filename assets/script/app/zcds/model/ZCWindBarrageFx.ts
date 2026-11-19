/**
 * 风弹 + 命中留飓风（wind_bolt）与连射抛物线炸弹（missile_barrage）的 facade。
 *
 * 路径、行为键、时长与缩放基准已迁到目录/调参表；
 * 本文件只保留原导出名与纯函数。
 */

import { ZC_EFFECT_BEHAVIOR_KEYS, ZC_EFFECT_PATHS } from './ZCEffectCatalog';
import { ZC_EFFECT_SCALE, ZC_EFFECT_TUNING } from './ZCEffectTuning';

/** 风弹 + 命中点留一块持续区域。*/
export const ZC_WIND_BOLT_BEHAVIOR_KEY = ZC_EFFECT_BEHAVIOR_KEYS.windBolt;

/** 累计 N 次普攻后连射 N 颗抛物线炸弹。*/
export const ZC_BARRAGE_BEHAVIOR_KEY = ZC_EFFECT_BEHAVIOR_KEYS.missileBarrage;

/** 风弹弹体：三叶小丑_普攻。*/
export const ZC_WIND_BOLT_PREFAB_PATH = ZC_EFFECT_PATHS.clownDart;

/** 飓风：风法师_龙卷风。*/
export const ZC_WIND_HURRICANE_PREFAB_PATH = ZC_EFFECT_PATHS.windHurricane;

/** 飓风的接触判定间隔（秒）。*/
export const ZC_WIND_HURRICANE_TOUCH_SECONDS = ZC_EFFECT_TUNING.hurricaneTouchSeconds;

/** 连射炸弹的落点散布半径（逻辑 px）。*/
export const ZC_BARRAGE_SCATTER_RADIUS = ZC_EFFECT_TUNING.barrageScatterRadius;

/** 炸弹飞行段特效：镭射飞龙的追踪导弹弹体。*/
export const ZC_BARRAGE_MISSILE_PREFAB_PATH = ZC_EFFECT_PATHS.missileBody;

/** 炸弹落地爆炸特效：镭射飞龙的导弹命中爆炸。*/
export const ZC_BARRAGE_IMPACT_PREFAB_PATH = ZC_EFFECT_PATHS.missileImpact;

/** 炸弹飞行速度（逻辑 px/s）。*/
export const ZC_BARRAGE_FLIGHT_SPEED = ZC_EFFECT_TUNING.barrageFlightSpeed;

/** 一轮连射里两颗炸弹的间隔（秒）；配表缺省时用它兜底。*/
export const ZC_BARRAGE_DEFAULT_INTERVAL = ZC_EFFECT_TUNING.barrageDefaultInterval;

/** 炸弹落地的最短飞行时间（秒）。*/
export const ZC_BARRAGE_MIN_FLIGHT_SECONDS = ZC_EFFECT_TUNING.barrageMinFlightSeconds;

/** 导弹命中爆炸的基准判定半径（逻辑 px）。*/
export const ZC_BARRAGE_IMPACT_REFERENCE_RADIUS = ZC_EFFECT_TUNING.barrageImpactReferenceRadius;

/** 屏上 px = 逻辑 px × 0.76875。*/
export const ZC_BARRAGE_SCREEN_PER_LOGIC = ZC_EFFECT_SCALE.screenPxPerLogic;

const WIND_BARRAGE_BEHAVIOR_KEYS: ReadonlySet<string> = new Set([
    ZC_WIND_BOLT_BEHAVIOR_KEY, ZC_BARRAGE_BEHAVIOR_KEY,
]);

/** 这个行为键走不走这两条车道。*/
export function zcIsWindBarrageBehavior(behaviorKey: string | null | undefined): boolean {
    return behaviorKey != null && WIND_BARRAGE_BEHAVIOR_KEYS.has(behaviorKey);
}

/** 这个行为键走不走「射风弹、命中留飓风」这条车道。*/
export function zcIsWindBoltBehavior(behaviorKey: string | null | undefined): boolean {
    return behaviorKey === ZC_WIND_BOLT_BEHAVIOR_KEY;
}

/** 这个行为键走不走「累计普攻发射连射导弹」这条车道。*/
export function zcIsMissileBarrageBehavior(behaviorKey: string | null | undefined): boolean {
    return behaviorKey === ZC_BARRAGE_BEHAVIOR_KEY;
}

/** 风弹车道 → 弹体 + 飓风两条路径；不是该车道返回空数组。*/
export function zcWindBoltEffectPaths(behaviorKey: string | null | undefined): readonly string[] {
    return zcIsWindBoltBehavior(behaviorKey)
        ? [ZC_WIND_BOLT_PREFAB_PATH, ZC_WIND_HURRICANE_PREFAB_PATH]
        : [];
}

/** 连射导弹车道 → 弹体 + 命中爆炸两条路径；不是该车道返回空数组。*/
export function zcMissileBarrageEffectPaths(behaviorKey: string | null | undefined): readonly string[] {
    return zcIsMissileBarrageBehavior(behaviorKey)
        ? [ZC_BARRAGE_MISSILE_PREFAB_PATH, ZC_BARRAGE_IMPACT_PREFAB_PATH]
        : [];
}

/** 行为键 → 这条车道需要的 prefab 路径；不是这条车道返回空数组。*/
export function zcWindBarrageEffectPaths(behaviorKey: string | null | undefined): readonly string[] {
    if (behaviorKey === ZC_WIND_BOLT_BEHAVIOR_KEY) {
        return [ZC_WIND_BOLT_PREFAB_PATH, ZC_WIND_HURRICANE_PREFAB_PATH];
    }
    if (behaviorKey === ZC_BARRAGE_BEHAVIOR_KEY) {
        return [ZC_BARRAGE_MISSILE_PREFAB_PATH, ZC_BARRAGE_IMPACT_PREFAB_PATH];
    }
    return [];
}

/** 爆炸特效的整体尺寸倍率：让屏上直径等于判定直径。*/
export function zcBarrageImpactScale(logicRadius: number): number {
    if (!Number.isFinite(logicRadius) || logicRadius <= 0) return 1;
    const scale = logicRadius / ZC_BARRAGE_IMPACT_REFERENCE_RADIUS;
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/** 炸弹的飞行时长（秒）= 世界距离 ÷ 世界速度，保底最短飞行时间。*/
export function zcBarrageFlightSeconds(worldDistance: number, speedTable: number, distanceScale: number): number {
    const speedWorld = Math.max(1e-6, speedTable * Math.max(1e-6, distanceScale));
    const seconds = Math.max(0, worldDistance) / speedWorld;
    return Math.max(ZC_BARRAGE_MIN_FLIGHT_SECONDS, seconds);
}
