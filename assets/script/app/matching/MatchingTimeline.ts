/** 视觉时间轴只由经过时间决定，不积累逐帧误差。 */
export function matchingWaveOffset(elapsed: number, index: number): number {
    const time = Math.max(0, elapsed - index * 0.07);
    return 3 * (1 - Math.cos(time * Math.PI * 2 / 0.9));
}
export function matchingTipProgress(elapsed: number): number {
    const t = Math.max(0, Math.min(1, elapsed / 0.3));
    return t * t * (3 - 2 * t);
}
