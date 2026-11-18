/**
 * 气泡 / 手指 / 光圈描边的呼吸。绝对时间驱动，重渲染和帧率变化不会积累动画误差。
 *
 * `ringAlpha` 是描边的不透明度系数（0.55~1）：只缩放的话描边只是「变大变小」，
 * 加上透明度才像在呼吸（用户 2026-11-17 第 16 条 ③：卡牌那一步的描边要一直呼吸）。
 */
export function guideHintMotion(startedAt: number, now: number): { hintScale: number; handLift: number; ringAlpha: number } {
    const seconds = Math.max(0, now - startedAt) / 1000;
    const wave = (1 - Math.cos(seconds * Math.PI * 2 / 1.2)) / 2;
    return { hintScale: 1 + 0.025 * wave, handLift: 7 * wave, ringAlpha: 0.55 + 0.45 * wave };
}

export function formatGuideContent(content: string): string {
    return content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/点它/g, '<color=#FFD129>点它</color>');
}

/** 宿主本地坐标里的一块轴对齐矩形（中心 + 半宽半高）。 */
export interface IGuideFocusRect {
    readonly x: number;
    readonly y: number;
    readonly halfWidth: number;
    readonly halfHeight: number;
}

/**
 * 把「主焦点 + 附加节点」并成一块外接矩形 —— 引导孔和光圈都用它。
 *
 * 为什么需要并：领地的关卡编号气泡（`1-1`）挂在 `StationBadgeLayer` 上、抬在建筑顶上方，
 * 和地块节点不是父子关系，只按地块算孔就会出现「气泡在圈外、圈挖在空地上」
 * （用户 2026-11-17 第 17 条：光圈要囊括 `1-1` 气泡）。并集是两者都圈住的唯一解。
 *
 * 入参为空 / 全是非法尺寸 ⇒ `null`，调用方按「没有孔」处理。
 */
export function unionGuideFocusRects(rects: readonly IGuideFocusRect[]): IGuideFocusRect | null {
    let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity;
    for (const rect of rects) {
        if (!Number.isFinite(rect.x) || !Number.isFinite(rect.y)) continue;
        if (!(rect.halfWidth > 0) || !(rect.halfHeight > 0)) continue;
        left = Math.min(left, rect.x - rect.halfWidth);
        right = Math.max(right, rect.x + rect.halfWidth);
        bottom = Math.min(bottom, rect.y - rect.halfHeight);
        top = Math.max(top, rect.y + rect.halfHeight);
    }
    if (!(right > left) || !(top > bottom)) return null;
    return { x: (left + right) / 2, y: (bottom + top) / 2, halfWidth: (right - left) / 2, halfHeight: (top - bottom) / 2 };
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
