/**
 * 「新地块生成」的**时间轴**（纯函数、零 `cc`）。
 *
 * 需求原文（2026-10-22）：*「增加新地块生成动画：生成新的地块整个节点由透明渐变 / 地块由小变大 /
 * 多个地块出现有轻微的先后落差」*。三句需求正好对应本文件的三个导出：
 *
 * | 需求 | 落到哪 |
 * | --- | --- |
 * | 整个节点由透明渐变 | `territoryHexSpawnFrame().opacity`（视图写格节点的 `UIOpacity`，子节点一起淡） |
 * | 地块由小变大 | `territoryHexSpawnFrame().scale`（从 `TERRITORY_HEX_SPAWN_FROM_SCALE` 长到 1） |
 * | 多个地块有先后落差 | `territoryHexSpawnDelays()`（一次出现的格子按**簇心**排序，逐个错峰） |
 *
 * ## 为什么不是 tween
 *
 * 与 `TerritoryHexFlip` / `TerritoryGainBurst` / `TerritoryChestAnimation` 同一套路
 * （见 `AGENTS.md`「渲染幂等与纯函数时间轴」）：tween 挂在**池化**的格节点上，节点被回收后
 * 还会继续跑（老坑）；而纯函数可以单测 —— 时长、错峰上限、脏数据这些是产品口径，
 * 不该只靠"看一遍动画"验收。
 *
 * ## 与「翻格」的分工
 *
 * 这两件事**不是一回事**，别合并：
 *  · **翻格**（`TerritoryHexFlip`）= 玩家点开**随机资源格**，那一格从泥块碎裂成草地；
 *  · **生成**（本文件）= 进度推进后**新露出**的格子整批进场。
 *  同一格两件事都可能发生（在边界上开一个随机格），此时以**翻格优先**：
 *  翻格自带「新地皮放大填充」，再叠一层整格淡入只会糊（视图里 `syncFlip` 会掐掉同格的生成动画）。
 */

/** 单格生成动画的总时长（秒）。0.4s ≈ 手感临界点：再慢就挡视线，再快就看不清渐变。 */
export const TERRITORY_HEX_SPAWN_SECONDS = 0.4;

/** 相邻两格的出场间隔（秒）—— 需求里的「轻微的先后落差」。0.055s 约 3 帧，够看出层次又不拖沓。 */
export const TERRITORY_HEX_SPAWN_STAGGER_SECONDS = 0.055;

/**
 * 错峰**总上限**（秒）。
 *
 * 一次露出一整排（十几格）时，`index × stagger` 会排到 0.6s 以上，最后几格要等半秒才出现 ——
 * 读起来像卡顿而不是"落差"。封顶之后多出来的格子按上限同时出现，整体长度可控。
 */
export const TERRITORY_HEX_SPAWN_STAGGER_MAX_SECONDS = 0.3;

/**
 * 起手缩放：`0.55`。
 *
 * 不用 0：缩到 0 时格子只剩一个点，六边形的形状（这次动画的主体）反而看不出来；
 * 0.55 起手能读到"一块地皮从格心长开"，且 0.4s 内涨到 1 的位移量刚好。
 */
export const TERRITORY_HEX_SPAWN_FROM_SCALE = 0.55;

/**
 * 透明度在第几成时**已经铺满**（0~1 的进度比例）。
 *
 * 0.7 ⇒ 前 70% 的时间就从透明走到不透明，剩下 30% 是"实体继续长大"。
 * 反过来（透明度跟着缩放一起到 100%）会出现「格子已经长大了但还是半透明」的灰蒙感。
 */
export const TERRITORY_HEX_SPAWN_OPACITY_PORTION = 0.7;

/** 某一时刻的姿态。视图直接照着写节点，不再做二次换算。 */
export interface ITerritoryHexSpawnFrame {
    /** 格节点缩放（`TERRITORY_HEX_SPAWN_FROM_SCALE → 1`）。 */
    readonly scale: number;
    /** 格节点不透明度（`0 → 1`，视图乘 255 取整）。 */
    readonly opacity: number;
}

/** 参与错峰排序的一格：只要 id 与格心坐标（排序用），不关心它是什么格。 */
export interface ITerritoryHexSpawnCell {
    readonly cellId: number;
    readonly x: number;
    readonly y: number;
}

function clamp01(value: number): number {
    if (!(value > 0)) return 0;
    return value > 1 ? 1 : value;
}

/** `easeOutCubic`：起手快、落位慢 —— 「长出来」的手感（`easeIn` 会读成"慢慢鼓起"）。 */
function easeOutCubic(p: number): number {
    const x = clamp01(p);
    return 1 - (1 - x) * (1 - x) * (1 - x);
}

/**
 * 已用时（秒）→ 这一帧的缩放与不透明度。
 *
 * @param seconds 相对**本格自己的**起点（延迟已扣掉）。`<= 0` = 还没轮到它 ⇒ 起手帧
 *                （`fromScale` + 全透明）。视图 `play()` 时先写一遍这一帧，避免"闪一帧全尺寸"。
 */
export function territoryHexSpawnFrame(seconds: number): ITerritoryHexSpawnFrame {
    // `!(seconds > 0)` 一次挡掉 NaN / 0 / 负数 / -Infinity（NaN 的比较恒 false，正是想要的）。
    // +Infinity 落到下面那条 `>= 时长` ⇒ 终态，符合「已经过去很久了」的语义。
    if (!(seconds > 0)) {
        return { scale: TERRITORY_HEX_SPAWN_FROM_SCALE, opacity: 0 };
    }
    if (seconds >= TERRITORY_HEX_SPAWN_SECONDS) return { scale: 1, opacity: 1 };
    const t = seconds / TERRITORY_HEX_SPAWN_SECONDS;
    const grow = easeOutCubic(t);
    const fade = easeOutCubic(clamp01(t / TERRITORY_HEX_SPAWN_OPACITY_PORTION));
    return {
        scale: TERRITORY_HEX_SPAWN_FROM_SCALE + (1 - TERRITORY_HEX_SPAWN_FROM_SCALE) * grow,
        opacity: fade,
    };
}

/**
 * 一批新格 → 每格的延迟（秒）。
 *
 * 排序按**到簇心的距离升序**：先中间冒头，再向外一圈铺开，读起来是"从中心长开"；
 * 若按 cellId / 数组顺序排，屏幕上会变成毫无方向的乱序闪烁。
 * 距离相同时按 `cellId` 兜底，保证同一批格子每次进场的顺序**完全可复现**（打日志 / 单测都靠它）。
 *
 * @param stagger 相邻两格的间隔；取负值按 0 处理（不允许倒序进场）。
 */
export function territoryHexSpawnDelays(
    cells: readonly ITerritoryHexSpawnCell[],
    stagger: number = TERRITORY_HEX_SPAWN_STAGGER_SECONDS,
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
    const gap = Number.isFinite(stagger) && stagger > 0 ? stagger : 0;
    const cap = TERRITORY_HEX_SPAWN_STAGGER_MAX_SECONDS;
    const ordered = cells
        .map((cell) => ({
            cell,
            distance: (cell.x - centerX) * (cell.x - centerX) + (cell.y - centerY) * (cell.y - centerY),
        }))
        .sort((a, b) => (a.distance !== b.distance ? a.distance - b.distance : a.cell.cellId - b.cell.cellId));
    ordered.forEach((entry, index) => {
        delays.set(entry.cell.cellId, Math.min(cap, index * gap));
    });
    return delays;
}

/**
 * 一批格子全部播完需要多久（秒）—— 页面/用例用它判断"整批是否结束"。
 *
 * 与 `territoryHexSpawnDelays` 共用同一套上限，改一处两边一起变。
 */
export function territoryHexSpawnBatchSeconds(cellCount: number, stagger: number = TERRITORY_HEX_SPAWN_STAGGER_SECONDS): number {
    if (!(cellCount > 0)) return 0;
    const gap = Number.isFinite(stagger) && stagger > 0 ? stagger : 0;
    const delay = Math.min(TERRITORY_HEX_SPAWN_STAGGER_MAX_SECONDS, (cellCount - 1) * gap);
    return delay + TERRITORY_HEX_SPAWN_SECONDS;
}
