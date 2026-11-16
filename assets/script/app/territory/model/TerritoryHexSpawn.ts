/**
 * 新地块生成的时间轴（纯函数，零 cc）。
 *
 * 整格由透明渐显、由小变大，多格按簇心排序轻微错峰。
 * 格节点池化复用，因此用纯函数时间轴而不是 tween。
 * 与翻格同时发生时以翻格优先，避免两层淡入糊在一起。
 */

import { territoryHexStaggerDelays } from './TerritoryHexStagger';
import { easeOutCubic } from '../../../core/math/Easing';
import { clamp01Finite as clamp01 } from '../../../core/math/Scalar';

/** 单格生成时长（秒）。 */
export const TERRITORY_HEX_SPAWN_SECONDS = 0.4;

/** 相邻两格出场间隔（秒）。 */
export const TERRITORY_HEX_SPAWN_STAGGER_SECONDS = 0.055;

/** 错峰总上限（秒），超出部分同时出现。 */
export const TERRITORY_HEX_SPAWN_STAGGER_MAX_SECONDS = 0.3;

/** 起手缩放，避免缩到 0 时看不出六边形轮廓。 */
export const TERRITORY_HEX_SPAWN_FROM_SCALE = 0.55;

/** 透明度在该进度前铺满，剩余时间留给继续放大。 */
export const TERRITORY_HEX_SPAWN_OPACITY_PORTION = 0.7;

// ---------------------------------------------------------------------------
// 「胜利通过」那一批：同一套曲线，参数更重
// ---------------------------------------------------------------------------

/**
 * > 「胜利通过的地块动画节奏感需要比普通的地块生成动画更强，更明显」
 *
 * 普通生成是「云散开 / 解锁一片」这种**背景事件**，节奏要轻（0.4s、错峰 0.055、不过冲）——
 * 它常常一播十几格，重了就是挡视线。
 *
 * 「打完这一关、地盘归我」是**主动作的收尾**，玩家刚从一个弹窗/战斗里出来，视线就在这一格上。
 * 所以这一档刻意把它做成"一锤一锤"的：
 *
 * | 维度 | 普通 | 胜利 | 说明 |
 * | --- | --- | --- | --- |
 * | 单格时长 | 0.4s | 0.62s | 过冲要有时间收尾，不然读成"抖了一下" |
 * | 起手缩放 | 0.55 | 0.28 | 起手更小 ⇒ "从地里长出来"的落差更大 |
 * | 过冲峰值 | 无 | 1.14 @ 72% | 长过头再收回来，是"砸下去"的手感；只放不弹就是普通的缓出 |
 * | 错峰 | 0.055s | 0.14s | 一格一格**分得开**，才听得出节拍（普通那档几乎是同时冒头） |
 * | 错峰上限 | 0.3s | 0.62s | 一屏十几格也让它真的排完，"同时一坨"就又没有节奏了 |
 * | 透明度铺满 | 70% | 50% | 先亮起来、再长大 —— 亮的那一下正好压在过冲上 |
 */
export const TERRITORY_HEX_SPAWN_VICTORY_SECONDS = 0.62;

/** 见 {@link TERRITORY_HEX_SPAWN_VICTORY_SECONDS} 的表：普通 0.055 ⇒ 胜利 0.14。 */
export const TERRITORY_HEX_SPAWN_VICTORY_STAGGER_SECONDS = 0.14;

/** 见同上：普通 0.3 ⇒ 胜利 0.62。 */
export const TERRITORY_HEX_SPAWN_VICTORY_STAGGER_MAX_SECONDS = 0.62;

/** 起手缩放：普通 0.55 ⇒ 胜利 0.28（起手更小，落差更大）。 */
export const TERRITORY_HEX_SPAWN_VICTORY_FROM_SCALE = 0.28;

/** 过冲峰值：长到 `1.14` 再收回 1（普通档没有这一步）。 */
export const TERRITORY_HEX_SPAWN_VICTORY_PEAK_SCALE = 1.14;

/** 过冲峰值出现在第几成（0~1）。0.72 ⇒ 前 72% 长过头，后 28% 收回来。 */
export const TERRITORY_HEX_SPAWN_VICTORY_PEAK_PORTION = 0.72;

/** 透明度在第几成铺满：普通 0.7 ⇒ 胜利 0.5（先亮起来、再长大）。 */
export const TERRITORY_HEX_SPAWN_VICTORY_OPACITY_PORTION = 0.5;

/** 一套进场节奏。普通生成与「胜利通过」只用参数区分，曲线完全共用。 */
export interface ITerritoryHexSpawnTiming {
    /** 单格时长（秒）。 */
    readonly seconds: number;
    /** 起手缩放。 */
    readonly fromScale: number;
    /** 透明度在第几成铺满（0~1）。 */
    readonly opacityPortion: number;
    /** 相邻两格的间隔（秒）。 */
    readonly stagger: number;
    /** 错峰总上限（秒）。 */
    readonly staggerMax: number;
    /** 过冲峰值（`1` = 不过冲）。 */
    readonly peakScale: number;
    /** 过冲峰值出现在第几成（`1` = 用不上）。 */
    readonly peakPortion: number;
}

/** 普通档：新地块生成（云散开 / 解锁一片）。 */
export const TERRITORY_HEX_SPAWN_TIMING: ITerritoryHexSpawnTiming = {
    seconds: TERRITORY_HEX_SPAWN_SECONDS,
    fromScale: TERRITORY_HEX_SPAWN_FROM_SCALE,
    opacityPortion: TERRITORY_HEX_SPAWN_OPACITY_PORTION,
    stagger: TERRITORY_HEX_SPAWN_STAGGER_SECONDS,
    staggerMax: TERRITORY_HEX_SPAWN_STAGGER_MAX_SECONDS,
    peakScale: 1,
    peakPortion: 1,
};

/** 胜利档：战斗/关卡通过后收进来的那批格子（更重、更分得开）。 */
export const TERRITORY_HEX_SPAWN_VICTORY_TIMING: ITerritoryHexSpawnTiming = {
    seconds: TERRITORY_HEX_SPAWN_VICTORY_SECONDS,
    fromScale: TERRITORY_HEX_SPAWN_VICTORY_FROM_SCALE,
    opacityPortion: TERRITORY_HEX_SPAWN_VICTORY_OPACITY_PORTION,
    stagger: TERRITORY_HEX_SPAWN_VICTORY_STAGGER_SECONDS,
    staggerMax: TERRITORY_HEX_SPAWN_VICTORY_STAGGER_MAX_SECONDS,
    peakScale: TERRITORY_HEX_SPAWN_VICTORY_PEAK_SCALE,
    peakPortion: TERRITORY_HEX_SPAWN_VICTORY_PEAK_PORTION,
};


/** 某一时刻的姿态。视图直接照着写节点，不再做二次换算。 */
export interface ITerritoryHexSpawnFrame {
    /** 格节点缩放（`TERRITORY_HEX_SPAWN_FROM_SCALE → 1`）。 */
    readonly scale: number;
    /** 格节点不透明度（`0 → 1`，视图乘 255 取整）。 */
    readonly opacity: number;
}

/** 参与错峰排序的一格：只要 id 与格心坐标（排序用），不关心它是什么格。 */
export interface ITerritoryHexSpawnCell {
    readonly cellId: number;
    readonly x: number;
    readonly y: number;
}

/**
 * 已用时（秒）→ 这一帧的缩放与不透明度。
 *
 * @param seconds 相对**本格自己的**起点（延迟已扣掉）。`<= 0` = 还没轮到它 ⇒ 起手帧
 * （`fromScale` + 全透明）。视图 `play()` 时先写一遍这一帧，避免"闪一帧全尺寸"。
 * @param timing 节奏档位：默认普通生成；胜利通过那批传 `TERRITORY_HEX_SPAWN_VICTORY_TIMING`
 * （多一段"长过头再收回来"的过冲）。
 */
export function territoryHexSpawnFrame(
    seconds: number,
    timing: ITerritoryHexSpawnTiming = TERRITORY_HEX_SPAWN_TIMING,
): ITerritoryHexSpawnFrame {
    // `!(seconds > 0)` 一次挡掉 NaN / 0 / 负数 / -Infinity（NaN 的比较恒 false，正是想要的）。
    // +Infinity 落到下面那条 `>= 时长` ⇒ 终态，符合「已经过去很久了」的语义。
    if (!(seconds > 0)) {
        return { scale: timing.fromScale, opacity: 0 };
    }
    if (seconds >= timing.seconds) return { scale: 1, opacity: 1 };
    const t = seconds / timing.seconds;
    const fade = easeOutCubic(clamp01(t / timing.opacityPortion));
    const peakPortion = timing.peakScale > 1 ? clamp01(timing.peakPortion) : 1;
    // 没有过冲（普通档）：一条缓出长到底，`peakPortion = 1` 直接走最后那支。
    if (peakPortion >= 1) {
        return {
            scale: timing.fromScale + (1 - timing.fromScale) * easeOutCubic(t),
            opacity: fade,
        };
    }
    // 过冲（胜利档）：前段长到 `peakScale`，后段收回到 1 —— 两头都是精确值，中间不会跳。
    if (t < peakPortion) {
        return {
            scale: timing.fromScale + (timing.peakScale - timing.fromScale) * easeOutCubic(t / peakPortion),
            opacity: fade,
        };
    }
    const settle = easeOutCubic((t - peakPortion) / (1 - peakPortion));
    return {
        scale: timing.peakScale + (1 - timing.peakScale) * settle,
        opacity: fade,
    };
}

/**
 * 一批新格 → 每格的延迟（秒）。
 *
 * 排序按**到簇心的距离升序**：先中间冒头，再向外一圈铺开，读起来是"从中心长开"；
 * 若按 cellId / 数组顺序排，屏幕上会变成毫无方向的乱序闪烁。
 * 距离相同时按 `cellId` 兜底，保证同一批格子每次进场的顺序**完全可复现**（打日志 / 单测都靠它）。
 *
 * @param stagger 相邻两格的间隔；取负值按 0 处理（不允许倒序进场）。
 * @param staggerMax 错峰总上限；缺省 `TERRITORY_HEX_SPAWN_STAGGER_MAX_SECONDS`
 * （胜利档传 `TERRITORY_HEX_SPAWN_VICTORY_TIMING` 的那两个值）。
 */
export function territoryHexSpawnDelays(
    cells: readonly ITerritoryHexSpawnCell[],
    stagger: number = TERRITORY_HEX_SPAWN_STAGGER_SECONDS,
    staggerMax: number = TERRITORY_HEX_SPAWN_STAGGER_MAX_SECONDS,
): ReadonlyMap<number, number> {
    const gap = Number.isFinite(stagger) && stagger > 0 ? stagger : 0;
    const cap = Number.isFinite(staggerMax) && staggerMax > 0 ? staggerMax : 0;
    return territoryHexStaggerDelays(cells, gap, cap);
}

/**
 * 一批格子全部播完需要多久（秒）—— 页面/用例用它判断"整批是否结束"。
 *
 * 与 `territoryHexSpawnDelays` 共用同一套上限，改一处两边一起变。
 */
export function territoryHexSpawnBatchSeconds(
    cellCount: number,
    timing: ITerritoryHexSpawnTiming = TERRITORY_HEX_SPAWN_TIMING,
): number {
    if (!(cellCount > 0)) return 0;
    const gap = Number.isFinite(timing.stagger) && timing.stagger > 0 ? timing.stagger : 0;
    const cap = Number.isFinite(timing.staggerMax) && timing.staggerMax > 0 ? timing.staggerMax : 0;
    const delay = Math.min(cap, (cellCount - 1) * gap);
    return delay + timing.seconds;
}
