/** 主城 HUD 的纯时间轴函数，供视图按绝对时间取值。 */
export function resolveChestPanelX(
    fromX: number,
    toX: number,
    startedAt: number,
    now: number,
    duration: number,
): number {
    if (!(duration > 0)) return toX;
    const progress = Math.max(0, Math.min(1, (now - startedAt) / duration));
    const eased = 1 - (1 - progress) ** 3;
    return fromX + (toX - fromX) * eased;
}
