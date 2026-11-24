/** 视觉时间轴只由经过时间决定，不积累逐帧误差。 */
export function matchingWaveOffset(elapsed: number, index: number): number {
    const time = Math.max(0, elapsed - index * 0.07);
    return 3 * (1 - Math.cos(time * Math.PI * 2 / 0.9));
}
export function matchingTipProgress(elapsed: number): number {
    const t = Math.max(0, Math.min(1, elapsed / 0.3));
    return t * t * (3 - 2 * t);
}

/** Tip 淡入淡出透明度：前半段淡出（255 -> 0），后半段淡入（0 -> 255）。 */
export function matchingTipOpacity(progress: number): number {
    if (progress <= 0 || progress >= 1) return 255;
    if (progress < 0.5) {
        return Math.round(255 * (1 - progress * 2));
    }
    return Math.round(255 * ((progress - 0.5) * 2));
}

/** Tip 垂直微位移：前半段随方向漂出，后半段从相反方向归位。 */
export function matchingTipOffsetY(progress: number, direction = 1, maxOffset = 10): number {
    if (progress <= 0 || progress >= 1) return 0;
    if (progress < 0.5) {
        return direction * maxOffset * (progress * 2);
    }
    return -direction * maxOffset * (1 - (progress - 0.5) * 2);
}

