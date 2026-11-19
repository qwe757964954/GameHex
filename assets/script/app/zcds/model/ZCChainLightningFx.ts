/**
 * 闪电链（chain_damage）的 facade。
 *
 * 路径、行为键、逐跳时长与透明度曲线参数已迁到目录/调参表；
 * 本文件只保留原导出名与纯函数。
 */

import { ZC_EFFECT_BEHAVIOR_KEYS, ZC_EFFECT_PATHS, zcEffectPathsForBehavior } from './ZCEffectCatalog';
import { ZC_EFFECT_TUNING } from './ZCEffectTuning';

/** 闪电链的行为键。*/
export const ZC_CHAIN_BEHAVIOR_KEY = ZC_EFFECT_BEHAVIOR_KEYS.chainDamage;

/** 每跳那一记雷的 prefab（复用磁电菇劈雷）。*/
export const ZC_CHAIN_EFFECT_PREFAB_PATH = ZC_EFFECT_PATHS.bolt;

/** 单跳表现存活时长（秒）。*/
export const ZC_CHAIN_EFFECT_SECONDS = ZC_EFFECT_TUNING.chainSeconds;

/** 逐跳的表现间隔（秒）。*/
export const ZC_CHAIN_STEP_SECONDS = ZC_EFFECT_TUNING.chainStepSeconds;

/** 首跳之后的每一跳透明度递减量。*/
export const ZC_CHAIN_FADE_STEP = ZC_EFFECT_TUNING.chainFadeStep;

/** 透明度下限。*/
export const ZC_CHAIN_FADE_FLOOR = ZC_EFFECT_TUNING.chainFadeFloor;

/** 第 `index` 跳（0 起）的透明度。*/
export function zcChainEffectAlpha(index: number): number {
    if (!(index > 0)) return 1;
    return Math.max(ZC_CHAIN_FADE_FLOOR, 1 - ZC_CHAIN_FADE_STEP * index);
}

/** 行为键 → 闪电链的表现路径；不是闪电链返回空数组。*/
export function zcChainLightningEffectPaths(behaviorKey: string | null | undefined): readonly string[] {
    return behaviorKey === ZC_CHAIN_BEHAVIOR_KEY ? zcEffectPathsForBehavior(behaviorKey) : [];
}
