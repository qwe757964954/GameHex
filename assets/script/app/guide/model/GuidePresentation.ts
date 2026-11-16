/** 绝对时间驱动，重渲染和帧率变化不会积累动画误差。 */
export function guideHintMotion(startedAt: number, now: number): { hintScale: number; handLift: number } {
    const seconds = Math.max(0, now - startedAt) / 1000;
    const wave = (1 - Math.cos(seconds * Math.PI * 2 / 1.2)) / 2;
    return { hintScale: 1 + 0.025 * wave, handLift: 7 * wave };
}

export function formatGuideContent(content: string): string {
    return content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/点它/g, '<color=#FFD129>点它</color>');
}

/** 底部焦点需要给按钮、手指和提示条让位；其余步骤沿用 prefab 的对话条位置。 */
export function guideDialogBottom(height: number, dialogHeight: number, defaultBottom: number,
    focusY: number, halfHeight: number): number {
    const bottom = defaultBottom - height / 2;
    const focusBottom = focusY - halfHeight - 24;
    const focusTop = focusY + halfHeight + 220;
    if (bottom > focusTop || bottom + dialogHeight < focusBottom) return defaultBottom;
    const above = focusTop + 16 + height / 2;
    if (above + dialogHeight <= height - 16) return above;
    return Math.max(16, focusBottom - 16 - dialogHeight + height / 2);
}
