/**
 * 阵容站台「兵种预览」的缩放系数（纯函数，零 `cc`，可在 Node 里直接测）。
 *
 * 两件事相乘，**顺序不能反**：
 *   ① 归一：把每份骨架/序列帧画布压到同一个可见高度（技术性补偿，各美术画布大小不同）；
 *   ② 体型：`pvpCard.prefabSize`（表现性，按卡配；对局里 `ZCUnitView.applyVisualSize`
 *      乘的是同一个系数）。
 *
 * 反过来的话，画布大的兵会被自己的画布再抵消一次策划的意图 —— 表里写 1.5，屏幕上反而更小。
 *
 * @param visibleHeight 站台期望的可见高度（`CardLineupSlot.previewHeight`）。
 * @param prefabSize    `pvpCard.prefabSize`；非法值（0 / NaN / 负数）按 1 —— 缩放取 0 会让模型消失。
 * @param sourceHeight  骨架 canvas 高（序列帧美术取节点高）。
 * @param visibleRatio  该美术形态下「角色占画布」的经验比例。
 * @param hostScale     宿主（站台立绘节点）的缩放，模型挂在它下面要抵消掉。
 */
export function cardPreviewFactor(
    visibleHeight: number,
    prefabSize: number,
    sourceHeight: number,
    visibleRatio: number,
    hostScale: number,
): number {
    const size = Number.isFinite(prefabSize) && prefabSize > 0 ? prefabSize : 1;
    return visibleHeight * size / (Math.max(1, sourceHeight * visibleRatio) * hostScale);
}

/**
 * 序列帧美术的脚点对齐偏移：这类 prefab 的原点在画布中心，要按缩放把中心往下推，
 * 脚才落在站台底边；spine 的脚点已经烘焙进骨架，不需要这一步。
 */
export const FRAME_FOOT_FROM_CENTER_Y = 45.7;
