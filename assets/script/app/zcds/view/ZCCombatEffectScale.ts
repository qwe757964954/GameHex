/**
 * 战斗特效尺寸口径，两张互不相干的表：
 *
 * | 表 | 管什么 | 输入 | 输出 |
 * | :-- | :-- | :-- | :-- |
 * | `zcHitFxScale` / `zcHitFxNodeScale` | 受击闪白「跟着被打的兵多大」 | `pvpCard.prefabSize` | 乘在闪白节点的烘焙值上 |
 * | `zcCombatEffectNodeScaleOf` | 这张技能特效本身该多大 | prefab 路径 | 乘在特效宿主节点上 |
 *
 * 前者作用在受击闪白节点，后者作用在技能特效宿主，两者不会互相抵消。
 * 后者只是 `ZCEffectCatalog` 的 facade；新增/调整倍率改目录，不再改本文件。
 *
 * 本文件必须保持无 `cc` 依赖，否则这些数字无法在无引擎环境逐点断言。
 */

import { zcEffectNodeScaleOf } from '../model/ZCEffectCatalog';

/** 查不到 / 非法值时的兜底系数：保持烘焙原样，绝不让特效消失或炸掉。*/
export const ZC_HIT_FX_FALLBACK_SCALE = 1;

/**
 * 目标单位 → 受击特效的尺寸系数。
 *
 * @param targetScale 目标单位的 `pvpCard.prefabSize`（模型等比缩放，基准 1）。
 * 传 `undefined` / `null` / `NaN` / `≤0` 一律退回 {@link ZC_HIT_FX_FALLBACK_SCALE} ——
 * 旧存档、旧测试构造的 `ZCHitFx` 都没有这个字段，不能因此把特效缩成 0。
 */
export function zcHitFxScale(targetScale: number | null | undefined): number {
    if (typeof targetScale !== 'number' || !Number.isFinite(targetScale) || targetScale <= 0) {
        return ZC_HIT_FX_FALLBACK_SCALE;
    }
    return targetScale;
}

/**
 * 把「烘焙基准」与「目标系数」乘成实际要写进节点的缩放。
 *
 * 单独抽出来是为了让「池化复用不能累乘」这件事有个唯一入口：
 * 每次播放都从烘焙基准重算绝对值，而不是在上一次的节点缩放上再乘一遍。
 */
export function zcHitFxNodeScale(
    bakedScale: number,
    targetScale: number | null | undefined,
): number {
    const base = Number.isFinite(bakedScale) && bakedScale > 0 ? bakedScale : 1;
    return base * zcHitFxScale(targetScale);
}

/**
 * 特效路径 → 宿主节点的整体倍率；未登记 = `1`（美术原样）。
 *
 * 非法值（`NaN` / `≤0` / 非数字）一律退回 `1`：宁可尺寸没改，也不能把节点缩成 0
 * 让整条特效静默消失。
 *
 * 地面区域（area）视觉尺寸来自 prefab 烘焙缩放（ZCCombatEffectView 不按 event.radius 缩放），
 * 视觉缩放挂在特效倍率，碰撞范围同步配置在 pvpSkill.areaRadius，保持视觉与判定一致。
 */
export function zcCombatEffectNodeScaleOf(
    effectPrefabPath: string | null | undefined,
): number {
    return zcEffectNodeScaleOf(effectPrefabPath);
}

/**
 * 入场「由小变大」的缩放系数。
 *
 * @param growSeconds 生长时长（秒）。`undefined` / `0` / 非法 ⇒ 返回 1（不生长）
 * @param ageSeconds  事件年龄（`now - startedAt`）
 * @param growFrom    起始占比（0~1，缺省 0）。合成 `growFrom + (1-growFrom) * ease(t)`，支持初始带初生尺寸的平滑成长。
 *
 * 缓动取 ease-out quad（1 - (1-t)²），避免线性突兀感与回弹过冲。
 *
 * 🔴 `growSeconds` 非法时一律返回 **1**（满尺寸），不返回 `growFrom`：宁可「没有入场动画」，
 * 也不能让一格写歪的配表把整片飓风永久钉在 10% 上（那画面等于技能没放出来）。
 */
export function zcCombatEffectGrowFactor(
    growSeconds: number | null | undefined,
    ageSeconds: number,
    growFrom?: number | null,
): number {
    if (typeof growSeconds !== 'number' || !Number.isFinite(growSeconds) || growSeconds <= 0) return 1;
    if (!Number.isFinite(ageSeconds)) return 1;
    const from = typeof growFrom === 'number' && Number.isFinite(growFrom)
        ? Math.max(0, Math.min(1, growFrom))
        : 0;
    const t = Math.max(0, Math.min(1, ageSeconds / growSeconds));
    return from + (1 - from) * (1 - (1 - t) * (1 - t));
}

// 统一导出表现层与判定几何所需的换算及缩放工具
export {
    zcBurstEffectScale,
} from '../model/ZCBurstFx';
export {
    zcRayBeamEffectScale,
} from '../model/ZCRayBeamFx';
export {
    zcBarrageImpactScale,
} from '../model/ZCWindBarrageFx';
export {
    ZC_EFFECT_SCALE,
} from '../model/ZCEffectTuning';
