/**
 * 平顶蜂窝尺寸口径（**对局与领地章节地图共用**）：底图是**非正方形画布**（130×119），
 * 间距按「中心 → 边中点」×2 解，**不能套正六边形的 1.5·hw**（格面明显压扁，123:90 = 1.367）：
 * 行距 = 格面高 90，列距 92.25，相邻列垂直差 45 ⇒ 相位恰好 = 行距/4 = 22.5。
 * ⚠️ 相位「自动等于行距/4」**依赖「行距 == 格面高」**，行距再偏离面高必须重推。
 * ⚠️ 两侧底图**不同**：对局 = 扁平 `hex_flat`，领地 = 2.5D `img_land_01_gray`；
 *    两者画布 / 格面 / 格面位置逐像素一致，所以下面这套常量可以共用。
 */
export const HEX_GRID_IMAGE_WIDTH = 130;
export const HEX_GRID_IMAGE_HEIGHT = 119;
/** 格面（可见六边形台面）尺寸 —— 轮廓线、墙砖、装饰缩放用它，不是整图。 */
export const HEX_GRID_FACE_WIDTH = 123;
export const HEX_GRID_FACE_HEIGHT = 90;
/**
 * 格内内容（建筑 / 站点 / 图标）应相对**格心**上移的量。
 * **格面中心 ≠ 整图中心**（格面偏上，下方留给透明边 / 侧壁），Sprite 锚点在整图中心
 * ⇒ 直接放格心会低 12.5px，看着不在格子正中央。
 *
 * 对局侧（扁平 `hex_flat`）与领地侧（2.5D `img_land_01_gray`）取值**相同**：
 * 扁平图就是**按这组锚点生成**的（`tmp/_gen_hex_flat.mjs`），不是巧合。
 */
export const HEX_GRID_CONTENT_LIFT = 12.5;

export const HEX_GRID_LOGICAL_COLUMN_STEP = 36;
export const HEX_GRID_LOGICAL_ROW_STEP = 42;
export const HEX_GRID_LOGICAL_COLUMN_PHASE = HEX_GRID_LOGICAL_ROW_STEP / 4;

export const HEX_GRID_VIEW_COLUMN_SPACING = 92.25;
export const HEX_GRID_VIEW_ROW_SPACING = 90;
export const HEX_GRID_VIEW_COLUMN_PHASE = HEX_GRID_VIEW_ROW_SPACING / 4;

export interface HexGridPoint {
    readonly x: number;
    readonly y: number;
}

export interface IHexGridLayout {
    readonly points: ReadonlyMap<number, HexGridPoint>;
    readonly width: number;
    readonly height: number;
    /** 按 y 降序、x 升序；后绘制的下方地块盖住上方地块的侧壁。 */
    readonly paintOrder: readonly number[];
}

export function hexGridViewPoint(row: number, column: number, rows: number, columns: number): HexGridPoint {
    const logical = hexGridLogicalPoint(row, column, rows, columns);
    return {
        x: logical.x * HEX_GRID_VIEW_COLUMN_SPACING / HEX_GRID_LOGICAL_COLUMN_STEP,
        y: logical.y * HEX_GRID_VIEW_ROW_SPACING / HEX_GRID_LOGICAL_ROW_STEP,
    };
}

/** 未取整的逻辑格心；对局持久化坐标由调用方沿用旧版取整口径。 */
export function hexGridLogicalPoint(row: number, column: number, rows: number, columns: number): HexGridPoint {
    return {
        x: (column - (columns - 1) / 2) * HEX_GRID_LOGICAL_COLUMN_STEP,
        y: ((rows - 1) / 2 - row) * HEX_GRID_LOGICAL_ROW_STEP
            + (column % 2 === 0 ? -HEX_GRID_LOGICAL_COLUMN_PHASE : HEX_GRID_LOGICAL_COLUMN_PHASE),
    };
}

/** 地图格心相对包围盒中心的坐标、完整底图尺寸与地块绘制顺序。 */
export function buildHexGridLayout(rows: number, columns: number): IHexGridLayout {
    if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows <= 0 || columns <= 0) {
        return { points: new Map(), width: 0, height: 0, paintOrder: [] };
    }
    const raw: { id: number; x: number; y: number }[] = [];
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
            const point = hexGridViewPoint(row, column, rows, columns);
            raw.push({ id: row * columns + column, ...point });
            minX = Math.min(minX, point.x);
            maxX = Math.max(maxX, point.x);
            minY = Math.min(minY, point.y);
            maxY = Math.max(maxY, point.y);
        }
    }
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const points = new Map<number, HexGridPoint>();
    for (const point of raw) points.set(point.id, { x: point.x - centerX, y: point.y - centerY });
    raw.sort((a, b) => b.y - a.y || a.x - b.x);
    return {
        points,
        width: maxX - minX + HEX_GRID_IMAGE_WIDTH,
        height: maxY - minY + HEX_GRID_IMAGE_HEIGHT,
        paintOrder: raw.map((point) => point.id),
    };
}

/** Six neighbors in the same odd-column offset grid used by territory maps. */
export function hexGridNeighborIds(cellId: number, rows: number, columns: number): number[] {
    if (!Number.isInteger(cellId) || !Number.isInteger(rows) || !Number.isInteger(columns)
        || rows <= 0 || columns <= 0 || cellId < 0 || cellId >= rows * columns) return [];
    const row = Math.floor(cellId / columns);
    const column = cellId % columns;
    // 与 hexGridViewPoint 的相位一致：偶数列格 y 下移半行 ⇒ 斜邻居在下一行（左下/右下）；
    // 奇数列格 y 上移半行 ⇒ 斜邻居在上一行（左上/右上）。
    const offsets = column % 2 === 0
        ? [[-1, 0], [1, 0], [0, -1], [1, -1], [0, 1], [1, 1]]
        : [[-1, 0], [1, 0], [0, -1], [-1, -1], [0, 1], [-1, 1]];
    return offsets.flatMap(([dr, dc]) => {
        const neighborRow = row + dr;
        const neighborColumn = column + dc;
        return neighborRow >= 0 && neighborRow < rows && neighborColumn >= 0 && neighborColumn < columns
            ? [neighborRow * columns + neighborColumn] : [];
    });
}
