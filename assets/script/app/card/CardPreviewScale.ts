/**
 * 阵容站台兵种预览的缩放系数，纯函数，零 cc。
 * 先按画布高度归一，再乘 pvpCard.prefabSize 的体型系数；顺序反了会把策划的体型意图抵消。
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
