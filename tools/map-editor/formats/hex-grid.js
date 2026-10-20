/**
 * 六边格几何 —— **编辑器三套页面 + 客户端共用的唯一口径**。
 *
 * ## 为什么抽出来
 *
 * 之前这里有**四份**邻居实现：
 *
 * | 位置 | 与客户端一致？ |
 * | --- | --- |
 * | 客户端 `core/hex/HexGridLayout.hexGridNeighborIds` | 基准 |
 * | `formats/territory-format.js` | ❌ **400/400 格全不一致**（另一套 offset 约定） |
 * | `territory_format.py` | ✅ 一致 |
 * | `formats/bigmap-format.js` | ✅ 一致（照客户端重写） |
 *
 * 领地那份错的后果：编辑器刷「7 格笔刷」实际选中的是**另一组格子**，连通性判定与
 * 发布校验（python）也不同口径 —— 典型的「编辑器能存、发布报错」或者反过来的根源。
 *
 * ## 坐标口径（改之前先读）
 *
 * 逻辑网格 36×42，**偶数列下移 10.5**（= 行距/4），与 `hexGridLogicalPoint` 逐位一致：
 *
 * ```
 * x = (column - (columns-1)/2) * 36
 * y = ((rows-1)/2 - row) * 42 + (column % 2 === 0 ? -10.5 : +10.5)   // 客户端 y 向上
 * ```
 *
 * 编辑器画布 y 向下，所以相位符号相反（偶列 +10.5），`x/y` 的原点换成左上角 padding。
 * ⚠️ 渲染网格是 92.25×90（底图 130×119 压扁），与逻辑网格**不是等比**放大
 * （x ×2.5625 / y ×2.142857）—— 见 `bigmap-format.js` 的 `BIGMAP_EDITOR_TO_VIEW_SCALE`。
 */

/** 逻辑列距（= 1.5 × 格半径 24）。 */
export const HEX_COLUMN_STEP = 36;
/** 逻辑行距（= 格面高 42，与 `HEX_GRID_LOGICAL_ROW_STEP` 同值）。 */
export const HEX_ROW_STEP = 42;
/** 相邻列的垂直相位差 = 行距 / 4。**偶数列下移**（画布 y 向下）。 */
export const HEX_COLUMN_PHASE = HEX_ROW_STEP / 4;

/** 格 id → 行列。id 口径全工程统一：`row * columns + column`。 */
export function cellCoords(cellId, columns) {
    return { row: Math.floor(cellId / columns), column: cellId % columns };
}

/** 行列 → 格 id；越界返回 -1。 */
export function hexIdAt(row, column, rows, columns) {
    if (!Number.isInteger(row) || !Number.isInteger(column)) return -1;
    if (row < 0 || column < 0 || row >= rows || column >= columns) return -1;
    return row * columns + column;
}

/**
 * 六邻居（奇数列偏移，**与 `hexGridNeighborIds` 逐格一致**）。
 *
 * 相位：偶数列格 y 下移半格 ⇒ 斜邻居在**下一行**；奇数列在上一行。
 * 别改成另一套 offset —— 那会让「相邻」在编辑器与游戏里差一格。
 */
export function hexNeighbors(cellId, rows, columns) {
    const row = Math.floor(cellId / columns);
    const column = cellId % columns;
    const offsets = column % 2 === 0
        ? [[-1, 0], [1, 0], [0, -1], [1, -1], [0, 1], [1, 1]]
        : [[-1, 0], [1, 0], [0, -1], [-1, -1], [0, 1], [-1, 1]];
    return offsets
        .map(([dr, dc]) => hexIdAt(row + dr, column + dc, rows, columns))
        .filter((id) => id >= 0);
}

/**
 * odd-q（偶列下移）offset → axial 的 `r`。
 *
 * 六边格三着色用 `(q - r) mod 3`（`q = column`），同色两两不相邻 —— 泊松撒点靠它贴住
 * 「独立集上界 = 格数 / 3」。写错符号会让每个格子的 6 个邻居里有一个算成 2 环。
 */
export function hexAxialR(row, column) {
    return row - (column + (column & 1)) / 2;
}

/** 六边距离（与 `BigMapWorld.bigMapHexDistance` 同式）。越界返回 `Infinity`。 */
export function hexDistance(a, b, rows, columns) {
    const total = rows * columns;
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a >= total || b >= total) {
        return Number.POSITIVE_INFINITY;
    }
    const ra = Math.floor(a / columns);
    const ca = a % columns;
    const rb = Math.floor(b / columns);
    const cb = b % columns;
    const dq = cb - ca;
    const dr = hexAxialR(rb, cb) - hexAxialR(ra, ca);
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** 以锚点为中心、`radius` 环以内的所有格（含中心）。`radius = 0` 只有中心。 */
export function circleHexes(anchorHexId, radius, rows, columns) {
    const total = rows * columns;
    if (!Number.isInteger(anchorHexId) || anchorHexId < 0 || anchorHexId >= total) return [];
    const seen = new Set([anchorHexId]);
    let frontier = [anchorHexId];
    for (let step = 0; step < Math.max(0, Math.floor(radius)); step += 1) {
        const next = [];
        for (const hexId of frontier) {
            for (const neighbor of hexNeighbors(hexId, rows, columns)) {
                if (seen.has(neighbor)) continue;
                seen.add(neighbor);
                next.push(neighbor);
            }
        }
        frontier = next;
    }
    return [...seen];
}
