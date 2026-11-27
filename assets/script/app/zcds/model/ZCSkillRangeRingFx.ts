/**
 * 技能范围指示「白环」的 facade。
 *
 * 用户口径（2026-11-25 第 45 批）：「释放技能时描绘一个白色的椭圆描边，边缘微亮，
 * 中间是 35% 的透明区域，用来标识技能的实际范围，椭圆和实际范围一样大，
 * 一直到技能的持续时间结束才消失」。
 *
 * ## 为什么是椭圆、而不是正圆
 *
 * 逻辑坐标 → 视图坐标横纵比例不同（`HexGridLayout`：横 2.5625、纵 2.142857），
 * 所以「半径 R 逻辑 px」的地面圆，屏上是半轴 `(R × 0.76875, R × 0.6429)` 的椭圆 ——
 * 纵向只有横向的 **0.8361**。美术图按这个比例画（见 `tools/build_range_ring_fx.py`），
 * 代码侧只需一个等比 `effectScale`，**不要**再自己乘纵向系数，否则会二次压扁。
 *
 * ## 尺寸只走事件级 `effectScale`
 *
 * `area` 类地面特效**从不按 `event.radius` 缩放**（§43 的口径）：prefab 的屏上尺寸
 * 完全由烘焙缩放与事件倍率决定。所以「圈 = 判定范围」只能靠
 * {@link zcSkillRangeRingScale} 把 `逻辑半径 × 0.76875 ÷ 基准半径 256` 算准。
 *
 * 必须保持无 `cc` 依赖：模型层与用例直接 import。
 */

import { ZCCombatEventType } from './ZCCombatCatalog';
import type { ZCSnapshot } from './ZCGameTypes';
import {
    ZC_EFFECT_PATHS,
    ZC_SKILL_RANGE_RING_UNITS,
    zcRangeRingEnabledForUnit,
    zcRangeRingPathsForUnit,
} from './ZCEffectCatalog';
import { ZC_EFFECT_SCALE } from './ZCEffectTuning';

/** 白环 prefab 路径（运行时按它取资源、按它判重）。*/
export const ZC_SKILL_RANGE_RING_PREFAB_PATH = ZC_EFFECT_PATHS.skillRangeRing;

/** scale 1 时白环的横向半径（屏上 px）；纵向 = 它 × 0.8361，烘焙在 prefab 里。*/
export const ZC_SKILL_RANGE_RING_REFERENCE_RADIUS = ZC_EFFECT_SCALE.rangeRingReferenceRadius;

export { ZC_SKILL_RANGE_RING_UNITS, zcRangeRingEnabledForUnit, zcRangeRingPathsForUnit };

/**
 * 范围圈的整体倍率：让白环的**屏上横向半径**等于判定半径。
 *
 * @param logicRadius 表值半径（逻辑 px），不是乘过 `combatDistanceScale` 的世界值。
 * 非法值 / 0 退回 1（宁可画大一点，也不能让 `NaN` 进节点缩放 —— 那会让整层矩阵变 NaN）。
 */
export function zcSkillRangeRingScale(logicRadius: number): number {
    if (!Number.isFinite(logicRadius) || logicRadius <= 0) return 1;
    const screenRadius = logicRadius * ZC_EFFECT_SCALE.screenPxPerLogic;
    const scale = screenRadius / ZC_SKILL_RANGE_RING_REFERENCE_RADIUS;
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/**
 * 光圈换目标时的移动速度（**世界 px / 秒**，2026-11-26 第 58 批）。
 *
 * 用户口径：「光圈（白色指示圈）切换到下个目标是快速移动（150px 速度），不要直接瞬移」。
 * 与弹道雨的弹速 `ZC_BULLET_RAIN_SPEED = 150` 同一档 —— 眼睛读出来就是「圈跟着子弹追过去」。
 */
export const ZC_SKILL_RANGE_RING_SLIDE_SPEED = 150;

export interface IZCSkillRangeRingOptions {
    readonly x: number;
    readonly y: number;
    /** 表值半径（逻辑 px）—— 只用来算 `effectScale`。 */
    readonly logicRadius: number;
    /** 判定半径（世界 px，= 逻辑 × `combatDistanceScale`）；只写进事件当诊断。 */
    readonly worldRadius: number;
    /** 圈活多久（秒）＝ 技能的持续时间，到点必须消失。 */
    readonly seconds: number;
    readonly owner: ZCSnapshot['units'][number]['owner'];
    readonly sourceUnitId: number;
    readonly skillId: number;
    readonly skillName: string;
}

/**
 * 推一条纯表现的范围圈事件。
 *
 * 🔴 伤害 / 判定一律由原本那条链结算，这里只画圈（`damage = 0`、`radius` 只作诊断）。
 * 🔴 **同一个单位只留一条**：戈壁狂箭会在持续窗口内反复开火，每次都推一条就会叠出
 * 一圈比一圈亮的「年轮」。已有覆盖当前时刻的就直接跳过（窗口内不重建）。
 *
 * @param followCenter 圆心会动的技能（`random_strike`：戈壁箭雨 / 急冻光线）传 `true`：
 *   已有那条**原地挪过去**并续命，而不是丢掉新位置。缺省 `false` ⇒ 存量逐字不变
 *   （冰山陨落的圈只推一次，本来就不需要跟随）。
 */
export function pushSkillRangeRingEvent(
    state: ZCSnapshot, options: IZCSkillRangeRingOptions, followCenter = false,
): boolean {
    const { x, y, logicRadius, worldRadius, seconds, owner, sourceUnitId, skillId, skillName } = options;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (!(logicRadius > 0) || !(seconds > 0)) return false;
    const now = state.elapsedSeconds;
    const alive = state.combatEvents.find((event) => event.effectPrefabPath === ZC_SKILL_RANGE_RING_PREFAB_PATH
        && event.sourceUnitId === sourceUnitId
        && event.startedAt + event.durationSeconds > now);
    if (alive) {
        if (!followCenter) return false;
        //  续命：技能还在窗口内，圈不能因为「最早那条到点」而提前消失。
        alive.startedAt = now;
        alive.durationSeconds = seconds;
        alive.effectScale = zcSkillRangeRingScale(logicRadius);
        alive.radius = worldRadius;
        //  🔴 只挪位置、不重建：重建会在那一帧闪一下，且视图侧会重新播入场动画。
        const dx = x - alive.toX;
        const dy = y - alive.toY;
        const distance = Math.hypot(dx, dy);
        if (distance > 1e-6) {
            //  **滑动**而不是瞬移：记下「从哪出发 / 什么时候出发 / 走多久」，
            //  视图每帧按 `slideSeconds` 插值。位移小于半像素时按瞬移处理（省一次无意义插值）。
            if (distance * 10 > 1) {
                alive.slideFromX = alive.toX;
                alive.slideFromY = alive.toY;
                alive.slideStartAt = now;
                alive.slideSeconds = distance / ZC_SKILL_RANGE_RING_SLIDE_SPEED;
            } else {
                alive.slideFromX = undefined;
                alive.slideFromY = undefined;
                alive.slideStartAt = undefined;
                alive.slideSeconds = undefined;
            }
            alive.fromX = x;
            alive.fromY = y;
            alive.toX = x;
            alive.toY = y;
        }
        return true;
    }
    state.combatEvents.push({
        id: state.nextCombatEventId++,
        type: ZCCombatEventType.Area,
        owner,
        sourceUnitId,
        targetUnitId: null,
        skillId,
        skillName,
        effectKey: null,
        projectileKey: null,
        effectPrefabPath: ZC_SKILL_RANGE_RING_PREFAB_PATH,
        fromX: x,
        fromY: y,
        toX: x,
        toY: y,
        //  判定半径（世界 px）只作诊断；`area` 从不按它缩放，尺寸由 `effectScale` 决定。
        radius: worldRadius,
        damage: 0,
        empowered: false,
        startedAt: now,
        durationSeconds: seconds,
        effectScale: zcSkillRangeRingScale(logicRadius),
    });
    return true;
}
