/** 缓动纯函数；本体不 clamp，调用方保留各自边界语义。 */
export function easeOutCubic(t: number): number {
    const inv = 1 - t;
    return 1 - inv * inv * inv;
}
