/**
 * 地块轮廓的共享绘制层：整盘一个 `cc.Graphics`。
 *
 * `cc.Graphics` 每次 `stroke()` 提交一个独立 subModel，且进入时自动断批 ——
 * 每格一个 Graphics 的真实代价约 6 DC/格；合并后整盘只画 1 笔。
 *
 * 逐边描线而不是画闭合多边形：同阵营相邻格的共享边不画，否则内部出双线。
 * `boundaryMask` 的位约定见 `buildTerritoryBoundaryMasks`，本模块只负责画，不碰判据。
 */
import { Color, Graphics } from 'cc';
import type { ZCFaction } from '../model/ZCGameModel';
import { ZC_HEX_TOP_VERTICES } from '../model/ZCHexTopGeometry';
import { zcFactionColor } from './ZCTheme';

/**
 * 轮廓的六个顶点（索引即 `boundaryMask` 的 bit 号），描的是立体地块的**顶面**：
 * 顶点口径由 `core/hex` 的 FACE_WIDTH / FACE_HEIGHT / CONTENT_LIFT 派生（顶面中心比
 * 整图中心高 12.5px、左右各内收），是视图与破门模型共用的唯一来源，见
 * `ZCHexTopGeometry`。换图改 core 常量即可，轮廓与城墙缺口一起跟着挪。
 */
export const ZC_OUTLINE_HEX_POINTS: ReadonlyArray<readonly [number, number]> = ZC_HEX_TOP_VERTICES;

// 半透明色配 ROUND 端点会在边段交汇点叠成深色小点，故内线用不透明的低对比度褐色。
const INNER_GRID_MIX_RATIO = 0.25;
const INNER_GRID_MIX_CHANNEL = 160;
const INNER_LINE_WIDTH = 2;
const OWNED_OUTLINE_LINE_WIDTH = 6;
// 贴住台面边缘但不取 1.0：留 1px 余量，避免 6px 粗线压在格界上与邻格叠成粗缝。
export const OWNED_OUTLINE_INSET_SCALE = 0.98;
const SELECTED_HEX_COLOR = new Color(255, 235, 150, 255);
const SELECTED_HEX_LINE_WIDTH = 4;
const SELECTED_HEX_INSET_SCALE = 0.82;

/** 棋盘层局部坐标点（不是格内偏移）。 */
export interface IZCOutlinePoint {
    readonly x: number;
    readonly y: number;
}

/** 线的样式：同色同宽的线段在 `flushOutlineSegments` 时合为一笔。 */
export interface IZCOutlineStyle {
    readonly lineWidth: number;
    readonly color: Color;
}

/** 一条待描的线段（棋盘层局部坐标，不是格内偏移）。 */
export interface ZCOutlineSegment {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    lineWidth: number;
    color: Color;
}

/** 每帧全盘重画，缓冲复用，update 路径不分配临时数组。 */
const segmentPool: ZCOutlineSegment[] = [];
let segmentCount = 0;

// 以下四个 scratch 对象供「坐标/样式 → 池化线段」的搬运复用：
// appendEdges / pushSegment 同步读值、立即拷进池，调用方不保留引用 ⇒
// 热路径（每帧整盘逐边）不产生点/样式对象垃圾。
const scratchFrom = { x: 0, y: 0 };
const scratchTo = { x: 0, y: 0 };
const scratchCenter = { x: 0, y: 0 };
// scratch 字段需可变（逐拍覆写），故不用 readonly 的 IZCOutlineStyle 标注；
// 传入时按 Readonly<IZCOutlineStyle> 收窄。
const scratchStyle: { lineWidth: number; color: Color } = { lineWidth: 0, color: new Color() };

function pushSegment(
    from: Readonly<IZCOutlinePoint>,
    to: Readonly<IZCOutlinePoint>,
    style: Readonly<IZCOutlineStyle>,
): void {
    let segment = segmentPool[segmentCount];
    if (!segment) {
        segment = {
            x1: from.x, y1: from.y, x2: to.x, y2: to.y,
            lineWidth: style.lineWidth, color: style.color,
        };
        segmentPool[segmentCount] = segment;
    } else {
        segment.x1 = from.x; segment.y1 = from.y; segment.x2 = to.x; segment.y2 = to.y;
        segment.lineWidth = style.lineWidth; segment.color = style.color;
    }
    segmentCount += 1;
}

/** 按 mask 逐边追加线段；scale 为顶点相对格心的缩放，center 为格心。 */
function appendEdges(
    mask: number,
    style: Readonly<IZCOutlineStyle>,
    scale: number,
    center: Readonly<IZCOutlinePoint>,
): void {
    for (let edge = 0; edge < ZC_OUTLINE_HEX_POINTS.length; edge += 1) {
        if ((mask & (1 << edge)) === 0) continue;
        const from = ZC_OUTLINE_HEX_POINTS[edge];
        const to = ZC_OUTLINE_HEX_POINTS[(edge + 1) % ZC_OUTLINE_HEX_POINTS.length];
        scratchFrom.x = center.x + from[0] * scale;
        scratchFrom.y = center.y + from[1] * scale;
        scratchTo.x = center.x + to[0] * scale;
        scratchTo.y = center.y + to[1] * scale;
        pushSegment(scratchFrom, scratchTo, style);
    }
}

/** 单格轮廓入参（棋盘层局部坐标，已含格心偏移）。 */
export interface IZCHexOutlineInput {
    readonly centerX: number;
    readonly centerY: number;
    readonly owner: ZCFaction;
    readonly boundaryMask: number;
}

/**
 * 把一格的轮廓线段追加进共享缓冲。
 * @param input.owner 该格阵营（neutral 不画线；其余走阵营色外边界 + 内部线）
 * @param input.boundaryMask 低 6 位 = 外边界边；高 6 位（`>> 8`）= 同阵营内部线
 */
export function appendHexOutlineSegments(input: Readonly<IZCHexOutlineInput>): void {
    const { centerX, centerY, owner, boundaryMask } = input;
    const boundary = boundaryMask & 0x3f;
    if (owner === 'neutral') {
        // 中立格不画网格线：100% 不透明填充后，格间本身已有色差，无需描线。
        return;
    }
    const color = zcFactionColor(owner);
    // 复用 scratchCenter / scratchStyle：两个 appendEdges 串行调用、同步拷值，
    // 不在热路径上分配坐标点与样式对象。
    scratchCenter.x = centerX;
    scratchCenter.y = centerY;
    scratchStyle.lineWidth = OWNED_OUTLINE_LINE_WIDTH;
    scratchStyle.color = new Color(color.r, color.g, color.b, 255);
    appendEdges(boundary, scratchStyle, OWNED_OUTLINE_INSET_SCALE, scratchCenter);
    scratchStyle.lineWidth = INNER_LINE_WIDTH;
    scratchStyle.color = new Color(
        Math.round(color.r * (1 - INNER_GRID_MIX_RATIO) + INNER_GRID_MIX_CHANNEL * INNER_GRID_MIX_RATIO),
        Math.round(color.g * (1 - INNER_GRID_MIX_RATIO) + INNER_GRID_MIX_CHANNEL * INNER_GRID_MIX_RATIO),
        Math.round(color.b * (1 - INNER_GRID_MIX_RATIO) + INNER_GRID_MIX_CHANNEL * INNER_GRID_MIX_RATIO),
        255,
    );
    appendEdges((boundaryMask >> 8) & 0x3f, scratchStyle,
        OWNED_OUTLINE_INSET_SCALE, scratchCenter);
}

/** 已选主城位置独立高亮；内缩后不盖住共用边及相邻格图标。 */
export function appendSelectedHexOutlineSegments(centerX: number, centerY: number): void {
    scratchCenter.x = centerX;
    scratchCenter.y = centerY;
    scratchStyle.lineWidth = SELECTED_HEX_LINE_WIDTH;
    scratchStyle.color = SELECTED_HEX_COLOR;
    appendEdges(0x3f, scratchStyle, SELECTED_HEX_INSET_SCALE, scratchCenter);
}

/**
 * 结算收尾的**线条脉冲**：把一格的**六条边全部**按给定样式追加一笔亮线
 * （需求 2026-10-16：「回正动画结束再增加一个线条波动的脉冲效果，类似回正动画的」）。
 *
 * 🔴 **不看 `boundaryMask`，六条边全描**，理由有两条：
 *
 *  ① **共享边只由 id 小的那一格画**（`buildTerritoryBoundaryMasks` 的 `hex.id < adjacentId` 分支）。
 *  波带是按**行**走的，而行号与 id 大小毫无关系 ⇒ 按 mask 描的话，波带前沿 / 后沿那一圈里，
 *  一半的共享边会落在「该由邻居画、可邻居不在带里」的状态上 —— 亮线变成一圈**断断续续**的边，
 *  读起来是「有的格子亮了、有的没亮」，而不是「一道波扫过」。
 *  六条边全描则每个在带里的格都是一圈完整的亮环，波带是连续的一条。
 *
 *  ② 内部分隔线（`mask >> 8`）在 `appendHexOutlineSegments` 里是 **2px 的混色细线**，
 *  而脉冲要的是一条统一的 **7px 亮线**。走 mask 就得为同一格备两套样式（外 6px / 内 2px），
 *  既多占共享层的桶，也画不出「整圈一起亮」的重量感。
 *
 * ⚠️ 六条边全描会让相邻格的**共享边写两遍**。这里安全：两遍的坐标与样式完全相同，
 * 又落在同一条路径里的一次 `stroke()`（`flushOutlineSegments` 按同色同宽分桶）——
 * 描边叠描同一段实色线是幂等的，而该模块开头警告的「双线」只在**颜色或宽度不同**时才可见。
 * ⚠️ 也**不能拿它替 `appendHexOutlineSegments`**：那只会在整盘上把每格都变成重复描边。
 * 它只给波带里那 1~2 行用（见 `ZC_VICTORY_SWEEP_PULSE_BAND_ROWS`）。
 *
 * `style.color` 由调用方**按档位预建、同档复用**：`flushOutlineSegments` 按「同色同宽」分桶，
 * 逐格现算一个不同强度的颜色会让每格各占一个 subModel，共享层就白合了。
 */
export function appendHexPulseOutlineSegments(
    centerX: number,
    centerY: number,
    style: Readonly<IZCOutlineStyle>,
): void {
    scratchCenter.x = centerX;
    scratchCenter.y = centerY;
    scratchStyle.lineWidth = style.lineWidth;
    scratchStyle.color = style.color;
    appendEdges(0x3f, scratchStyle, OWNED_OUTLINE_INSET_SCALE, scratchCenter);
}

/**
 * 桶容量：四阵营各有外/内线，加已选格高亮，再留结算线条脉冲的几个亮档。
 *
 * 12 是「四阵营 × 2 + 已选格」时代的容量；2026-10-16 加入线条脉冲后要再让出
 * `ZC_VICTORY_SWEEP_PULSE_LEVELS = 4` 档（虽然脉冲期间整盘同属一方、实际只用到 2 档，
 * 但**不能靠「那时恰好只有一个阵营」**来省容量 —— 一旦将来脉冲期间归属不同，
 * 溢出的桶会被静默并进最后一桶，亮线颜色全糊在一起）。
 */
const MAX_BUCKETS = 16;
const bucketOf: number[] = [];
const bucketSegments: number[][] = [[], [], [], [], [], [], [], [], [], [], [], []];

export function resetOutlineSegments(): void {
    segmentCount = 0;
    for (const bucket of bucketSegments) bucket.length = 0;
}

/** 本轮已追加的线段数（`resetOutlineSegments` 之后）。 */
export function outlineSegmentCount(): number {
    return segmentCount;
}

/** 取第 i 条线段（供绘制遍历；不复制）。 */
export function outlineSegmentAt(i: number): ZCOutlineSegment {
    return segmentPool[i];
}

/**
 * 按「同色同宽」分桶画到 graphics：`cc.Graphics` 每次 `stroke()` 提交一个 subModel，
 * 同色同宽的线段必须攒成一段连续路径只 stroke 一次，否则 N 格 × 3 种线就是 3N 个
 * subModel，合层毫无收益。颜色种数为常数，用桶索引而非排序；桶结构复用，每帧不分配。
 * 线段坐标已是棋盘层局部坐标，这里不再叠任何偏移。
 */
export function flushOutlineSegments(graphics: Graphics): void {
    graphics.clear();
    if (segmentCount === 0) return;
    graphics.lineCap = Graphics.LineCap.ROUND;
    let bucketTotal = 0;
    for (let i = 0; i < segmentCount; i += 1) {
        const segment = segmentPool[i];
        let index = -1;
        for (let b = 0; b < bucketTotal; b++) {
            const head = bucketSegments[b][0];
            const other = segmentPool[head];
            if (other.lineWidth === segment.lineWidth && sameColor(other.color, segment.color)) {
                index = b;
                break;
            }
        }
        if (index < 0) {
            // 桶满时不静默丢弃：并入最后一个桶（视觉仍对，只是这一帧多几个 subModel）。
            index = bucketTotal < MAX_BUCKETS ? bucketTotal++ : MAX_BUCKETS - 1;
        }
        bucketOf[i] = index;
        bucketSegments[index].push(i);
    }
    for (let b = 0; b < bucketTotal; b += 1) {
        const indices = bucketSegments[b];
        const head = segmentPool[indices[0]];
        graphics.lineWidth = head.lineWidth;
        graphics.strokeColor = head.color;
        for (let k = 0; k < indices.length; k += 1) {
            const segment = segmentPool[indices[k]];
            graphics.moveTo(segment.x1, segment.y1);
            graphics.lineTo(segment.x2, segment.y2);
        }
        graphics.stroke();
    }
}

function sameColor(a: Color, b: Color): boolean {
    return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}
