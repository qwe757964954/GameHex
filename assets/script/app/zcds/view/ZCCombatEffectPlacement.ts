/**
 * 战斗特效的播放锚点（纯表现配置，刻意不进 `ZCSnapshot`）。
 *
 * 锚点只影响「画在哪」，不影响结算；混进模型 / 快照会牵动 `version` 与存档兼容。
 * 本文件只保留纯函数与受击特效的「按表面抬升」表；路径表已迁到
 * `ZCEffectCatalog`，这里只做 facade。
 *
 * 本文件必须保持无 `cc` 依赖：`tests/zcds-combat-effect-placement.test.ts` 直接 import。
 */
// `import type` 在编译后完全擦除 ⇒ 不影响本文件「无运行时依赖」的约束。
import type { ZCCombatEventType } from '../model/ZCCombatCatalog';
import type { ZCEffectAnchor, ZCEffectLayer } from '../model/ZCEffectCatalog';
import type { ZCHitFxSurface } from '../model/ZCGameTypes';
import {
    zcEffectAnchorOf,
    zcEffectHitFxSurfaceLiftY,
    zcEffectLayerOfPath,
    zcEffectLiftYOf,
    zcEffectOverlayChildOf,
} from '../model/ZCEffectCatalog';

/** 特效锚点：`caster` = 出手方（既有口径）、`midpoint` = 攻击者与受击目标的连线中点。*/
export type ZCCombatEffectAnchor = ZCEffectAnchor;

/** 特效层级：`ground` = 铺在地上（棋盘之上、动态对象之下）；`top` = 动态对象最上层。*/
export type ZCCombatEffectLayer = ZCEffectLayer;

/** 特效路径 → 锚点。空路径 / 未登记 = `caster`（既有行为）。*/
export function zcCombatEffectAnchorOf(
    effectPrefabPath: string | null | undefined,
): ZCCombatEffectAnchor {
    return zcEffectAnchorOf(effectPrefabPath);
}

/** 一次战斗事件里跟定位有关的两端（地图坐标，与 `mapToViewX/Y` 同一坐标系）。*/
export interface IZCombatEffectSpan {
    readonly fromX: number;
    readonly fromY: number;
    readonly toX: number;
    readonly toY: number;
}

/**
 * 锚点 → 逻辑坐标。
 *
 * `midpoint` 是两端坐标的算术中点，不做高度补偿 —— 高度补偿留在 prefab 根节点。
 * 每次调用返回新对象：调用点是「每帧 × 个位数特效」，不值得引入可变 scratch。
 */
export function zcCombatEffectAnchorPoint(
    span: Readonly<IZCombatEffectSpan>,
    anchor: ZCCombatEffectAnchor,
): { x: number; y: number } {
    if (anchor !== 'midpoint') return { x: span.fromX, y: span.fromY };
    return { x: (span.fromX + span.toX) * 0.5, y: (span.fromY + span.toY) * 0.5 };
}

/**
 * 特效路径 → 弹道竖直补偿（视图 px）。
 *
 * 单位根节点是逻辑脚点，子弹直接贴脚点会「擦着地面飞出去」；补偿加在 `mapToViewY`
 * 之后，是屏幕竖直方向，不跟弹道旋转。未登记 / 非法值 = `0`。
 */
export function zcCombatEffectLiftY(effectPrefabPath: string | null | undefined): number {
    return zcEffectLiftYOf(effectPrefabPath);
}

/**
 * 事件类型 → 特效层级。
 *
 * `area` 是「铺在地上的一片火」，必须在角色之下；`melee` / `projectile` 是「打在空中的一下」，
 * 必须在角色之上，否则刀光会被自己的身体挡住。
 */
export function zcCombatEffectLayerOf(type: ZCCombatEventType): ZCCombatEffectLayer {
    return type === 'area' ? 'ground' : 'top';
}

/**
 * 按特效路径覆盖层级。`area` 也可以是会跑的生物（鹿神守护），不能一律压在地面层；
 * 未登记 = 走 `zcCombatEffectLayerOf(事件类型)`。
 */
export function zcCombatEffectLayerOfPath(
    type: ZCCombatEventType,
    effectPrefabPath: string | null | undefined,
): ZCCombatEffectLayer {
    return zcEffectLayerOfPath(effectPrefabPath) ?? zcCombatEffectLayerOf(type);
}

/** 特效路径 → 预制体根节点直下的叠层子节点名；未登记 = `null`（视图一次都不碰 `active`）。*/
export function zcCombatEffectOverlayChild(effectPrefabPath: string | null | undefined): string | null {
    return zcEffectOverlayChildOf(effectPrefabPath);
}

/**
 * 层级 → `mapLayer` 里的 `siblingIndex`。
 *
 * `mapLayer` 里所有动态对象都是平铺的兄弟节点，规则是「谁后创建谁在上」；特效一旦先建、
 * 角色后建，遮挡关系就反过来。所以地面的东西必须显式插队到棋盘之后。
 *
 * @param boardIndex `ZCGameBoard` 在 `mapLayer` 里的下标（地块全在它内部）
 * @param siblingCount 含自己的兄弟数（节点已 `setParent` 到末尾）
 */
export function zcCombatEffectSiblingIndex(
    layer: ZCCombatEffectLayer,
    boardIndex: number,
    siblingCount: number,
): number {
    const last = Math.max(0, siblingCount - 1);
    if (layer === 'top') return last;
    // 棋盘之后第一个位置 = 地块之上、所有动态对象之下。
    return Math.max(0, Math.min(boardIndex + 1, last));
}

/**
 * 受击特效的锚点纵向补偿（视图 px）——按「这一下打在什么上」。
 *
 * 表与兜底已迁到 `ZCEffectCatalog`；建筑 +15.651 是 prefab 的美术摆位，
 * `tests/zcds-structure-hit-fx.test.ts` 直接读 prefab 对齐，美术挪图需同步目录。
 */
export function zcHitFxSurfaceLiftY(surface: ZCHitFxSurface | null | undefined): number {
    return zcEffectHitFxSurfaceLiftY(surface);
}
