import type { ZCUnitId } from './ZCCombatCatalog';
import { ZCCombatEventType } from './ZCCombatCatalog';
import type { IZCEffectFlight, IZCEffectMissileSpec } from './ZCEffectCatalog';
import {
    zcEffectFadeSecondsOf,
    zcEffectFacingOffsetOf,
    zcEffectFlightOf,
    zcEffectMissileOf,
    zcEffectMissilePaths,
} from './ZCEffectCatalog';
import { ZC_EFFECT_TUNING } from './ZCEffectTuning';

/**
 * 战斗特效的飞行段与朝向（纯表现配置，刻意不进 `ZCSnapshot`）。
 *
 * | 表 | 影响 | 由谁消费 |
 * | :-- | :-- | :-- |
 * | 飞行段 | 位置（跟着飞）+ 事件寿命（`durationSeconds`）+ 转角 | `ZCAttackResolutionSystem` / `ZCCombatEffectView` |
 * | 朝向 | 只影响转角（原地播、不飞） | `ZCCombatEffectView` |
 * | 淡出 | 消失前淡出多久（弹道丢弃后补一条定格事件） | `ZCProjectileSystem` → `ZCGameModel` → 视图 |
 *
 * 路径表已迁到 `ZCEffectCatalog`，本文件只保留纯函数与 facade。
 * 必须保持无 `cc` 依赖：`tests/zcds-combat-effect-flight.test.ts` 直接 import。
 */

/** 一条「先飞过去再炸」的配置。*/
export type IZCCombatEffectFlight = IZCEffectFlight;

/** 「追踪导弹」类的多点打击特效，按单位登记（弹体 + 爆炸两份 prefab）。*/
export type IZCMissileFxSpec = IZCEffectMissileSpec;

/** 特效路径 → 飞行配置；空路径 / 未登记 = `null`（不飞）。*/
export function zcCombatEffectFlightOf(
    effectPrefabPath: string | null | undefined,
): IZCCombatEffectFlight | null {
    return zcEffectFlightOf(effectPrefabPath);
}

/**
 * 特效的朝向偏移（度）；`null` = 不登记，保持 `0°`。
 *
 * 飞行段自带的 `facingOffsetDegrees` 优先 —— 同一个 prefab 不允许两张表给出两个答案。
 */
export function zcCombatEffectFacingOffsetOf(
    effectPrefabPath: string | null | undefined,
): number | null {
    return zcEffectFacingOffsetOf(effectPrefabPath);
}

/**
 * 「原地播」的特效这一帧该转多少度；`null` = 保持 0°。
 *
 * 入参是视图坐标的位移（`mapToViewX / mapToViewY` 的缩放比不同，拿逻辑坐标直接 `atan2` 会算歪）。
 * 三个 `null` 出口：没登记（保持既有行为）、两端同点（原地爆，没有朝向可言）、
 * 位移非有限值（`NaN` 泄进 `setRotationFromEuler` 会让节点矩阵变 `NaN`）。
 */
export function zcCombatEffectHeadingDegrees(
    viewDeltaX: number,
    viewDeltaY: number,
    effectPrefabPath: string | null | undefined,
): number | null {
    const offset = zcCombatEffectFacingOffsetOf(effectPrefabPath);
    if (offset === null) return null;
    if (!Number.isFinite(viewDeltaX) || !Number.isFinite(viewDeltaY)) return null;
    if (Math.abs(viewDeltaX) < 1e-6 && Math.abs(viewDeltaY) < 1e-6) return null;
    return Math.atan2(viewDeltaY, viewDeltaX) * 180 / Math.PI + offset;
}

/** 屏上转角（度）= 弹道方向 + 登记的朝向偏移；弹道方向由视图坐标算出后传进来。*/
export function zcCombatEffectFacingDegrees(
    flightAngleDegrees: number,
    flight: IZCCombatEffectFlight | null | undefined,
): number {
    const base = Number.isFinite(flightAngleDegrees) ? flightAngleDegrees : 0;
    return base + (flight?.facingOffsetDegrees ?? 0);
}

/**
 * 一次攻击事件的表现时长（秒）—— 事件的寿命，不是结算时刻。
 *
 * | 情况 | 时长 |
 * | :-- | :-- |
 * | 登记了飞行段的 melee | `距离 / speed`，夹在 `[minSeconds, maxSeconds]` |
 * | 其它 melee / area | 沿用 `ZCCombatSystem.attackTravelSeconds` 的固定 0.32s |
 * | projectile | `距离 / projectileSpeed`（随距离变，本来就已经匹配射程） |
 *
 * `distance` 必须是世界坐标距离，与 `speed` 的单位配对；乘 `combatDistanceScale`
 * 的事在调用点之前已经做完了。
 */
export function zcCombatEffectTravelSeconds(
    mode: ZCCombatEventType,
    distance: number,
    projectileSpeed: number | undefined,
    effectPrefabPath: string | null | undefined,
): number {
    const flight = zcCombatEffectFlightOf(effectPrefabPath);
    if (mode === ZCCombatEventType.Melee && flight) {
        const raw = (Number.isFinite(distance) && distance > 0 ? distance : 0) / flight.speed;
        if (!Number.isFinite(raw)) return flight.minSeconds;
        return Math.min(flight.maxSeconds, Math.max(flight.minSeconds, raw));
    }
    // 未登记 ⇒ 逐字沿用 `ZCCombatSystem.attackTravelSeconds` 的两条分支，不另立口径。
    return mode === ZCCombatEventType.Projectile
        ? Math.max(1e-6, (Number.isFinite(distance) ? distance : 0)
            / (projectileSpeed || ZC_EFFECT_TUNING.defaultProjectileSpeed))
        : ZC_EFFECT_TUNING.defaultAttackTravelSeconds;
}

/**
 * 这张特效消失前要淡出多少秒；`0` = 当场消失（不补表现事件）。
 *
 * 非法值（`NaN` / 负数 / 非数字）一律当 `0`：宁可闪没，也不能让一条 `NaN` 寿命的事件
 * 永远挂在 `state.combatEvents` 里。
 */
export function zcCombatEffectFadeSecondsOf(effectPrefabPath: string | null | undefined): number {
    return zcEffectFadeSecondsOf(effectPrefabPath);
}

/** 单位 → 导弹特效配置；未登记 = `null`（不是导弹，走普通多点打击）。*/
export function zcMissileFxOf(unitId: ZCUnitId): IZCMissileFxSpec | null {
    return zcEffectMissileOf(unitId);
}

/**
 * 所有登记过的导弹特效路径（弹体 + 爆炸，去重）。
 *
 * 这些路径在 pvpSkill 任何一行都不出现，纯表扫描收不到；漏收的后果是
 * 「导弹特效凭空消失且不报错」。
 */
export function zcMissileFxPaths(): readonly string[] {
    return zcEffectMissilePaths();
}
