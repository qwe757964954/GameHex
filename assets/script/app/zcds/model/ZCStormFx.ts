/**
 * 飓风（storm_zone）的 facade。
 *
 * 路径与行为键已迁到目录；本文件只保留原导出名与纯函数。
 */

import { ZC_EFFECT_BEHAVIOR_KEYS, ZC_EFFECT_PATHS, zcEffectPathsForBehavior } from './ZCEffectCatalog';

/** 在场上生成一团会走动的飓风。*/
export const ZC_STORM_BEHAVIOR_KEY = ZC_EFFECT_BEHAVIOR_KEYS.stormZone;

/** 飓风本体：风法师_龙卷风。*/
export const ZC_STORM_PREFAB_PATH = ZC_EFFECT_PATHS.windHurricane;

/** 行为键 → 这条车道需要的 prefab 路径；不是这条车道返回空数组。*/
export function zcStormEffectPaths(behaviorKey: string | null | undefined): readonly string[] {
    return behaviorKey === ZC_STORM_BEHAVIOR_KEY ? zcEffectPathsForBehavior(behaviorKey) : [];
}
