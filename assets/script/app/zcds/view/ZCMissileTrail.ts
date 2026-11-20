/**
 * 弹道拖尾（锥形 + 渐隐）——纯几何，不 import 任何 `cc`。
 *
 * 形状是「宽端贴弹体、往外收成尖」：宽度从 `rootHalfWidth` 线性收到 `tipHalfWidth`，
 * 透明度从 `alpha` 衰减到 0。配置数据在 `ZCEffectCatalog.ZC_EFFECT_TRAIL_SPECS`，
 * 本文件只保留切段算法与兼容导出。
 *
 * 坐标：拖尾画在特效宿主节点的 `Graphics` 上，宿主已按「本地 +X = 飞行方向」旋转，
 * 所以沿 -X 伸展。所有长度都是本地 px，屏上还要乘宿主缩放。
 */

import { type IZCEffectTrailSpec, zcEffectTrailOf, zcEffectTrailPaths } from '../model/ZCEffectCatalog';

/** 一条拖尾的形状与颜色；目录 `ZC_EFFECT_TRAIL_SPECS` 的视图侧别名。*/
export type IZCMissileTrailSpec = IZCEffectTrailSpec;

/** 拖尾的一段梯形（近端 `x0` 靠弹体，远端 `x1` 在更后面）。*/
export interface IZCMissileTrailQuad {
    /** 近端 X（离弹体近，|x0| 小）。*/
    readonly x0: number;
    /** 远端 X（在 x0 后面，|x1| 更大）。*/
    readonly x1: number;
    /** 近端半宽。*/
    readonly halfWidth0: number;
    /** 远端半宽。*/
    readonly halfWidth1: number;
    /** 这一段的不透明度（0~1，已乘入整体 `alpha`）。*/
    readonly alpha: number;
}

/** prefab 路径 → 拖尾配置；未登记 / 非法入参 = `null`。*/
export function zcMissileTrailOf(prefabPath: string | null | undefined): IZCMissileTrailSpec | null {
    return zcEffectTrailOf(prefabPath);
}

/** 所有登记过拖尾的 prefab 路径（给资源清单 / 测试用）。*/
export function zcMissileTrailPaths(): readonly string[] {
    return zcEffectTrailPaths();
}

/**
 * 把一条拖尾切成 `slices` 段梯形。
 *
 * 宽度取线性：锥形的两条边必须是直线，缓动会把边画成外凸的弧形。
 * 渐隐的平滑程度靠段数解决，不靠曲线。
 *
 * @param alphaScale 额外的整体透明度倍率（0~1）；非法值按 1，不允许负数或 NaN。
 */
export function zcMissileTrailQuads(
    spec: IZCMissileTrailSpec,
    alphaScale = 1,
): IZCMissileTrailQuad[] {
    const slices = Math.max(1, Math.round(spec.slices));
    const scale = Number.isFinite(alphaScale) ? Math.max(0, Math.min(1, alphaScale)) : 1;
    const quads: IZCMissileTrailQuad[] = [];
    for (let index = 0; index < slices; index += 1) {
        //  t 用段中点取值：两端都不会出现整段不透明 / 直接跳成 0，渐变才连贯。
        const t0 = index / slices;
        const t1 = (index + 1) / slices;
        quads.push({
            x0: spec.startX - spec.length * t0,
            x1: spec.startX - spec.length * t1,
            halfWidth0: spec.rootHalfWidth + (spec.tipHalfWidth - spec.rootHalfWidth) * t0,
            halfWidth1: spec.rootHalfWidth + (spec.tipHalfWidth - spec.rootHalfWidth) * t1,
            alpha: Math.max(0, spec.alpha * (1 - (t0 + t1) / 2) * scale),
        });
    }
    return quads;
}
