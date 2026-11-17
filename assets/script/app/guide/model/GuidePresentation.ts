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

/** 对话条避开焦点及其手指、提示条，其余步骤沿用预制体位置。 */
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

/**
 * 立绘最大宽度占宿主宽的比例（0.4 ≈ 720 屏宽下的 288px）。
 *
 * 依据：埃莉斯静图 500×800 按 `portraitHeight` 460 显示出来正好 ≈ 288 宽，
 * 也就是「美术给的立绘本来就该这么宽」。豌豆游侠的骨骼绑定框是 654×916（比例更宽），
 * 按高度缩完会撑到 328 —— 一眼就能看出比静图胖一圈，还会压到对话条外的地图。
 * 所以统一按这个上限等比缩：宁可矮一点，不许横向撑开。
 */
export const PORTRAIT_MAX_WIDTH_RATIO = 0.4;

/**
 * 按「目标高度 + 最大宽度」算立绘的显示尺寸（等比，绝不拉伸）。
 *
 * 高度优先：先按 `targetHeight` 等比缩放；宽高比大的图（骨骼 / 横幅立绘）会被宽度钳住，
 * 这时高度跟着一起降。入参非法（0 / 负数 / NaN）返回 0 尺寸，调用方据此隐藏立绘。
 */
export function fitGuidePortrait(rawWidth: number, rawHeight: number, targetHeight: number,
    hostWidth: number): { readonly width: number; readonly height: number } {
    if (!(rawWidth > 0) || !(rawHeight > 0) || !(targetHeight > 0)) return { width: 0, height: 0 };
    let width = rawWidth * (targetHeight / rawHeight);
    let height = targetHeight;
    const maxWidth = hostWidth > 0 ? hostWidth * PORTRAIT_MAX_WIDTH_RATIO : 0;
    if (maxWidth > 0 && width > maxWidth) {
        width = maxWidth;
        height = maxWidth * (rawHeight / rawWidth);
    }
    return { width, height };
}
