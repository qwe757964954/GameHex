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
 * 立绘盒宽度占宿主宽的比例：**149 / 720**（用户给的绿框口径）。
 *
 * 立绘整体要落在绿框里 —— 720 设计宽下约 149 宽。高度由 Inspector 的 `portraitHeight`
 * （233）给，两者一起构成立绘盒，图按比例 contain 进去，绝不拉伸。
 * 静图 500×800 与骨骼绑定框 654×916（`skel/豌豆射手`）的比例不同，
 * 所以「在框内」只能按 `min(框宽/原宽, 框高/原高)` 缩，两种立绘的显示高度本来就会差一点。
 */
export const PORTRAIT_BOX_WIDTH_RATIO = 149 / 720;

/**
 * 把立绘按比例 contain 进给定盒子（`boxWidth × boxHeight`），返回显示尺寸。
 *
 * 入参非法（0 / 负数 / NaN）返回 0 尺寸，调用方据此隐藏立绘。
 */
export function fitGuidePortrait(rawWidth: number, rawHeight: number,
    boxWidth: number, boxHeight: number): { readonly width: number; readonly height: number } {
    if (!(rawWidth > 0) || !(rawHeight > 0) || !(boxWidth > 0) || !(boxHeight > 0)) return { width: 0, height: 0 };
    const scale = Math.min(boxWidth / rawWidth, boxHeight / rawHeight);
    return { width: rawWidth * scale, height: rawHeight * scale };
}
