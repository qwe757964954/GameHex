/**
 * 文明之火（`fire_zone`）的 facade。
 *
 * 2026-11-23 第 43 批：科学家 68035 的原「射线集束」103503 改成「文明之火」——
 * 不再是一条跟着本体转的矩形光束，而是在**目标点**周围随机撒 3 个火焰区域。
 *
 * 美术**直接复用灼热地带那张图**（`火焰树妖_灼热地带技能`），需求原话
 * 「特效使用灼热地带的特效，改成蓝色的」。原图主色是紫品红（≈ rgb(180,60,228)），
 * 乘法染色压掉红通道就能推到蓝紫，所以蓝色走目录里的 `tint`，不另做美术。
 *
 * 🔴 与 `ZCRayBeamFx` 的关系：那一条是「身前矩形光束」，这条是「撒在地上的区域」，
 * 两条车道互不影响 —— 射线集束的旧效果已经整条搬给机甲菇 68015 了。
 */

import {
    ZC_EFFECT_BEHAVIOR_KEYS,
    ZC_EFFECT_PATHS,
    zcEffectPathsForBehavior,
} from './ZCEffectCatalog';

/** 在目标点周围撒若干块持续燃烧的区域。*/
export const ZC_FIRE_ZONE_BEHAVIOR_KEY = ZC_EFFECT_BEHAVIOR_KEYS.fireZone;

/** 火焰区域的表现：灼热地带那张十簇火苗的散图。*/
export const ZC_FIRE_ZONE_PREFAB_PATH = ZC_EFFECT_PATHS.hotZone;

/**
 * 文明之火的蓝色（`[r, g, b]`，乘算叠色）。
 *
 * 原图主色是紫品红（最亮处 ≈ rgb(228,108,252)），乘这组数：
 * `228×70/255 ≈ 63`、`108×190/255 ≈ 80`、`252×255/255 = 252` ⇒ 亮蓝 rgb(63,80,252)。
 *
 * 🔴 为什么是「事件级 tint」而不是目录里的路径色：灼热地带那张图**同时**被火焰树妖 68003
 * 自己的灼热地带（30811）用着，那边必须保持紫品红。同一个路径两种颜色，
 * 染色只能跟着事件走（`ZCCombatEvent.tint` / `ZCGroundZoneState.tint`）。
 * 乘法只能压通道、不能提亮 —— 想要更亮的蓝得改美术，不是调这里。
 */
export const ZC_FIRE_ZONE_TINT: readonly [number, number, number] = [70, 190, 255];

/** 行为键 → 这条车道需要的 prefab 路径；不是这条车道返回空数组。*/
export function zcFireZoneEffectPaths(behaviorKey: string | null | undefined): readonly string[] {
    return behaviorKey === ZC_FIRE_ZONE_BEHAVIOR_KEY ? zcEffectPathsForBehavior(behaviorKey) : [];
}
