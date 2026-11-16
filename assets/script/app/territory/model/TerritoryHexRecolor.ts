/**
 * 关卡通过后地皮换色的时间轴（纯函数，零 cc）。
 *
 * 旧地皮缩小变透明消失，新地皮由小放大并淡入，多格按簇心排序轻微错峰。
 * 缩放只写在格节点的临时子节点上，格根不动，建筑不受影响。
 * 格节点池化复用，因此用纯函数时间轴而不是 tween。
 */

import { territoryHexStaggerDelays } from './TerritoryHexStagger';

/** 单格换色总时长（秒）。 */
export const TERRITORY_HEX_RECOLOR_SECONDS = 0.36;

/** 相邻两格的换色间隔（秒）。 */
export const TERRITORY_HEX_RECOLOR_STAGGER_SECONDS = 0.07;

/** 错峰总上限（秒），避免大面积通关时排到一秒以上。 */
export const TERRITORY_HEX_RECOLOR_STAGGER_MAX_SECONDS = 0.3;

/** 旧地皮缩到该比例后消失，与生成动画的起手缩放一致。 */
export const TERRITORY_HEX_RECOLOR_OUT_SCALE = 0.55;

/** 新地皮的起手缩放，略大于旧地皮终态以保留交叉。 */
export const TERRITORY_HEX_RECOLOR_IN_FROM_SCALE = 0.6;

/** 旧地皮在整段动画的该比例处完全消失。 */
export const TERRITORY_HEX_RECOLOR_OUT_END = 0.55;

/** 新地皮开始出现的比例，与旧地皮退场交叉约 0.09s。 */
export const TERRITORY_HEX_RECOLOR_IN_START = 0.3;

/** 新地皮透明度在自己的窗口内走完该比例即铺满。 */
export const TERRITORY_HEX_RECOLOR_IN_OPACITY_PORTION = 0.7;

/** 某一时刻的姿态，视图直接写入节点。 */
export interface ITerritoryHexRecolorFrame {
    /** 旧地皮缩放。 */
    readonly outScale: number;
    /** 旧地皮不透明度。 */
    readonly outOpacity: number;
    /** 新地皮缩放。 */
    readonly inScale: number;
    /** 新地皮不透明度。 */
    readonly inOpacity: number;
}

/** 参与错峰排序的一格：只要 id 与格心坐标（排序用），不关心它是什么格。 */
export interface ITerritoryHexRecolorCell {
    readonly cellId: number;
    readonly x: number;
    readonly y: number;
}

function clamp01(value: number): number {
    if (!(value > 0)) return 0;
    return value > 1 ? 1 : value;
}

/** 起手快、落位慢 —— 「长出来」的手感（与生成动画同一个缓动，两套动画才像一家人）。 */
function easeOutCubic(p: number): number {
    const x = clamp01(p);
    return 1 - (1 - x) * (1 - x) * (1 - x);
}

/**
 * 起手慢、收尾快 —— 「化掉」的手感。
 *
 * 旧地皮**不能用** `easeOutCubic` 收尾：那样最后一段几乎不动，透明度到 0 的那一帧
 * 会读成"啪"地消失。先慢后快才是"逐渐被吸进去"。
 */
function easeInQuad(p: number): number {
    const x = clamp01(p);
    return x * x;
}

/**
 * 已用时（秒）→ 这一帧「旧的退场 / 新的进场」两组参数。
 *
 * @param seconds 相对**本格自己的**起点（延迟已扣掉）。`<= 0` = 还没轮到它 ⇒ 起手帧
 * （旧地皮原样、新地皮 0）。视图 `play()` 时先写一遍这一帧，避免"闪一帧新地皮"。
 */
export function territoryHexRecolorFrame(seconds: number): ITerritoryHexRecolorFrame {
    // `!(seconds > 0)` 一次挡掉 NaN / 0 / 负数 / -Infinity（NaN 的比较恒 false，正是想要的）。
    // +Infinity 落到下面那条 `>= 时长` ⇒ 终态，符合"已经过去很久了"的语义。
    if (!(seconds > 0)) {
        return { outScale: 1, outOpacity: 1, inScale: TERRITORY_HEX_RECOLOR_IN_FROM_SCALE, inOpacity: 0 };
    }
    if (seconds >= TERRITORY_HEX_RECOLOR_SECONDS) {
        return { outScale: TERRITORY_HEX_RECOLOR_OUT_SCALE, outOpacity: 0, inScale: 1, inOpacity: 1 };
    }
    const t = seconds / TERRITORY_HEX_RECOLOR_SECONDS;
    const outT = clamp01(t / TERRITORY_HEX_RECOLOR_OUT_END);
    const inT = clamp01((t - TERRITORY_HEX_RECOLOR_IN_START) / (1 - TERRITORY_HEX_RECOLOR_IN_START));
    return {
        // 旧：缩放用 `easeOut`（一上来就看得出在缩），透明度用 `easeIn`（后段加速化掉）——
        // 两者错开，才读得出"缩小 → 变透 → 消失"三步，而不是"整体等比淡掉"。
        outScale: 1 - (1 - TERRITORY_HEX_RECOLOR_OUT_SCALE) * easeOutCubic(outT),
        outOpacity: 1 - easeInQuad(outT),
        // 新：与生成动画同一条曲线（`easeOutCubic` 长开 + 前 70% 铺满不透明度）。
        inScale: TERRITORY_HEX_RECOLOR_IN_FROM_SCALE
            + (1 - TERRITORY_HEX_RECOLOR_IN_FROM_SCALE) * easeOutCubic(inT),
        inOpacity: easeOutCubic(clamp01(inT / TERRITORY_HEX_RECOLOR_IN_OPACITY_PORTION)),
    };
}

/**
 * 一批换色的格子 → 每格的延迟（秒）。
 *
 * 排序按**到簇心的距离升序**：先中间换、再向外一圈 —— 与「生成」同一套观感口径
 * （按 cellId / 数组顺序排会在屏幕上变成毫无方向的乱序闪烁）。
 * 距离相同时按 `cellId` 兜底，保证同一批格子每次的先后**完全可复现**（单测 / 打日志都靠它）。
 *
 * @param stagger 相邻两格的间隔；取负值按 0 处理（不允许倒序进场）。
 */
export function territoryHexRecolorDelays(
    cells: readonly ITerritoryHexRecolorCell[],
    stagger: number = TERRITORY_HEX_RECOLOR_STAGGER_SECONDS,
): ReadonlyMap<number, number> {
    const gap = Number.isFinite(stagger) && stagger > 0 ? stagger : 0;
    return territoryHexStaggerDelays(cells, gap, TERRITORY_HEX_RECOLOR_STAGGER_MAX_SECONDS);
}

/**
 * 一批格子全部播完需要多久（秒）—— 页面/用例用它判断"整批是否结束"。
 *
 * 与 `territoryHexRecolorDelays` 共用同一套上限，改一处两边一起变。
 */
export function territoryHexRecolorBatchSeconds(
    cellCount: number,
    stagger: number = TERRITORY_HEX_RECOLOR_STAGGER_SECONDS,
): number {
    if (!(cellCount > 0)) return 0;
    const gap = Number.isFinite(stagger) && stagger > 0 ? stagger : 0;
    const delay = Math.min(TERRITORY_HEX_RECOLOR_STAGGER_MAX_SECONDS, (cellCount - 1) * gap);
    return delay + TERRITORY_HEX_RECOLOR_SECONDS;
}
