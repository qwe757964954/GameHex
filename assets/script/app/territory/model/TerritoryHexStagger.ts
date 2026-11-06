/**
 * 「一批格子逐个错峰」的公共时间轴（纯函数、零 `cc`）。
 *
 * `TerritoryHexRecolor` 与 `TerritoryHexSpawn` 的 `territoryHex*Delays()` 原本各写了一份
 * 逐行同构的实现：按**这批格的簇心**由内向外排序、同距按 `cellId` 兜底保证可复现、
 * 再用 `min(cap, index × gap)` 封顶。口径是产品定的，改一处漏一处就会让换色与生成
 * 的观感分叉，所以收敛到这里，两侧只保留各自的默认值与上限常量。
 *
 * 调用方负责把 stagger / cap 校验成非负数（两者的默认值与上限口径不同），
 * 本函数只做排序与封顶，不替调用方改口径。
 */

/** 参与错峰排序所需的最小格子信息。 */
export interface IHexStaggerCell {
    readonly cellId: number;
    readonly x: number;
    readonly y: number;
}

/**
 * 计算每格的延迟（秒）。
 *
 * @param cells      这一批要播动画的格子；空批直接返回空 Map
 * @param gapSeconds 相邻两格的间隔（调用方已校验为非负数）
 * @param capSeconds 错峰总上限（调用方已校验；超出后剩余格子按上限同时进场）
 * @returns cellId → 延迟秒数
 */
export function territoryHexStaggerDelays<T extends IHexStaggerCell>(
    cells: readonly T[],
    gapSeconds: number,
    capSeconds: number,
): ReadonlyMap<number, number> {
    const delays = new Map<number, number>();
    if (cells.length === 0) return delays;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const cell of cells) {
        if (cell.x < minX) minX = cell.x;
        if (cell.x > maxX) maxX = cell.x;
        if (cell.y < minY) minY = cell.y;
        if (cell.y > maxY) maxY = cell.y;
    }
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const ordered = cells
        .map((cell) => ({
            cell,
            distance: (cell.x - centerX) * (cell.x - centerX) + (cell.y - centerY) * (cell.y - centerY),
        }))
        .sort((a, b) => (a.distance !== b.distance ? a.distance - b.distance : a.cell.cellId - b.cell.cellId));

    ordered.forEach((entry, index) => {
        delays.set(entry.cell.cellId, Math.min(capSeconds, index * gapSeconds));
    });
    return delays;
}
