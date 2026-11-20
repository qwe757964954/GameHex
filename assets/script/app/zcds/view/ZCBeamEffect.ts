/**
 * 镭射光束的发射点 / 朝向 / 长度（纯表现几何，刻意不进 `ZCSnapshot`）。
 *
 * 配置数据在 `ZCEffectCatalog.ZC_EFFECT_BEAM_SPECS`，本文件只保留几何计算与兼容导出。
 * 这里只回答「画在哪、朝哪、多长」，不碰任何结算；必须保持无 `cc` 依赖。
 */

import { type IZCEffectBeamSpec, zcEffectBeamOf } from '../model/ZCEffectCatalog';
import { ZC_EFFECT_SCALE } from '../model/ZCEffectTuning';

/** 一段光束：发射口、画布可见段、粗细与按技能追加的倍率。*/
export type IZCBeamSpec = IZCEffectBeamSpec;

/** 光束最短长度（视图 px）：贴脸时 `to` 可能落在发射口后面，缩成 0 会整条消失。*/
export const ZC_BEAM_MIN_LENGTH = ZC_EFFECT_SCALE.beamMinLength;

/** 这条技能该用多粗：`widthScale × （该技能号的追加倍率 ?? 1）`。*/
export function zcBeamWidthScaleOf(spec: IZCBeamSpec, skillId: number | undefined): number {
    return spec.widthScale * beamMultiplierOf(spec, skillId);
}

/** 美术没加载时那条兜底线该多粗（视图 px）。*/
export function zcBeamCoreWidthOf(spec: IZCBeamSpec, skillId: number | undefined): number {
    return spec.coreWidth * beamMultiplierOf(spec, skillId);
}

function beamMultiplierOf(spec: IZCBeamSpec, skillId: number | undefined): number {
    return skillId === undefined ? 1 : (spec.widthMultiplierBySkill?.[skillId] ?? 1);
}

/** 这条技能是不是「超长射线」，是的话固定拉多长（视图 px）；0 = 不是。*/
export function zcBeamOvershootOf(spec: IZCBeamSpec, skillId: number | undefined): number {
    if (skillId === undefined) return 0;
    const reach = spec.overShootBySkill?.[skillId] ?? 0;
    return Number.isFinite(reach) && reach > 0 ? reach : 0;
}

/** 特效路径 → 光束配置。未登记 = `null`（走通用弹道）。*/
export function zcBeamSpecOf(effectPrefabPath: string | null | undefined): IZCBeamSpec | null {
    return zcEffectBeamOf(effectPrefabPath);
}

/** 光束在视图坐标下的一帧：原点、角度、长度。*/
export interface IZCBeamFrame {
    /** 发射口（= 特效节点的摆放位置）。*/
    readonly x: number;
    readonly y: number;
    /** 顺时针为正的旋转角（度），与 `Node.setRotationFromEuler` 同一口径。*/
    readonly angleDegrees: number;
    /** 从发射口到弹头端的长度（视图单位），乘 `1 / 画布宽度` 就是节点 `scaleX`。*/
    readonly length: number;
}

/**
 * 端点（弹头当前位置）→ 一帧光束。
 *
 * 传入的 `from` / `to` 必须已经是视图坐标：地图逻辑 x/y 与视图不等比，
 * 在地图坐标里算角度会把斜向光束掰歪。
 */
export function zcBeamFrame(
    from: Readonly<{ x: number; y: number }>,
    to: Readonly<{ x: number; y: number }>,
    spec: IZCBeamSpec,
    skillId?: number,
): IZCBeamFrame {
    const endX = to.x;
    const endY = to.y + (spec.tailLift ?? 0);
    const dx = endX - from.x;
    const dy = endY - from.y;
    const span = Math.hypot(dx, dy);
    // 两端重合（刚出手那一帧）时没有方向可言，按「朝右」退化成一条最短的线。
    const angle = span === 0 ? 0 : Math.atan2(dy, dx);
    // 贴脸时目标比前伸量还近：前伸最多吃掉半程，剩下的至少还有半个身位。
    const forward = Math.min(spec.muzzleForward, span * 0.5);
    const x = from.x + Math.cos(angle) * forward;
    const y = from.y + Math.sin(angle) * forward + spec.muzzleLift;
    // 超长射线（镭射死光）：长度写死，不看实际到达点；方向仍来自 `to`。
    const overshoot = zcBeamOvershootOf(spec, skillId);
    const length = overshoot > 0
        ? overshoot
        : Math.max(ZC_BEAM_MIN_LENGTH, Math.hypot(endX - x, endY - y));
    return {
        x,
        y,
        angleDegrees: angle * 180 / Math.PI,
        length,
    };
}

/** 光束预制体的拉伸参数（作用在美术子节点上，不是宿主节点）。*/
export interface IZCBeamStretch {
    /** 子节点 `scale.x`：让画布里的可见段正好等于 `length`。*/
    readonly scaleX: number;
    /** 子节点 `position.x`：把画布左侧留白推到锚点外面，让线条起点落在锚点上。*/
    readonly offsetX: number;
}

/**
 * 「发射口 → 弹头」这一段长度 → 预制体的 `scaleX` 与横向位移。
 *
 * 画布里线条只占 `[contentStart, contentEnd]`，按可见段归一化才能让
 * 「节点原点 = 发射口、线条末端 = 弹头」同时成立。
 */
export function zcBeamStretchOf(
    spec: IZCBeamSpec,
    canvasWidth: number,
    length: number,
): IZCBeamStretch {
    const contentWidth = Math.max(1, (spec.contentEnd - spec.contentStart) * canvasWidth);
    const scaleX = Math.max(ZC_BEAM_MIN_LENGTH, length) / contentWidth;
    return { scaleX, offsetX: -spec.contentStart * canvasWidth * scaleX };
}
