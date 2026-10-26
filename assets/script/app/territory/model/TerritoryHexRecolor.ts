/**
 * 「关卡通过后地皮换色」的**时间轴**（纯函数、零 `cc`）。
 *
 * 需求原文（2026-10-23）：*「原本红色的地块变小，变透消失，新的地块小变大出现，伴随透明度变实 /
 * 有多个地块变化时，动画轻微的时间落差 / 地块上的建筑保持原地不动」*。四句需求正好对应本文件
 * 与视图的四件事：
 *
 * | 需求 | 落到哪 |
 * | --- | --- |
 * | 旧地块变小、变透消失 | `territoryHexRecolorFrame().outScale / outOpacity`（1 → 0.55 / 1 → 0） |
 * | 新地块小变大 + 透明度变实 | 同上的 `.inScale / inOpacity`（0.6 → 1 / 0 → 1） |
 * | 多格轻微时间落差 | `territoryHexRecolorDelays()`（按**这批格的簇心**排序，逐个错峰） |
 * | 地块上的建筑不动 | **不在本文件**：视图只动格节点的两个临时子节点，格根缩放恒 1 ⇒ 建筑（在 `Station*Layer`）不受影响 |
 *
 * ## 为什么不是 tween / 为什么不缩放格根
 *
 * 与 `TerritoryHexSpawn` / `TerritoryHexFlip` / `TerritoryChestAnimation` 同一套路
 * （见 `AGENTS.md`「渲染幂等与纯函数时间轴」）：格节点是**池化复用**的，tween 在节点回收后
 * 还会继续跑（老坑）；而纯函数能单测 —— 时长、交叉、错峰上限这些是产品口径，不该只靠"看一遍"验收。
 *
 * 缩放**只能写在临时子节点上**：格根一缩，格面框 / 底光 / 翻格用的 `Reveal` 会跟着缩；
 * 建筑虽然不在格节点下（挂 `StationIconLayer` 等四层），但把格根当缩放载体迟早会牵连到别的东西。
 *
 * ## 与「翻格」「生成」的分工
 *
 * 三件事都改地皮，但**不是一回事**，别合并：
 *  · **翻格**（`TerritoryHexFlip`）= 玩家点开随机资源格，碎裂 + 新地皮放大填充；
 *  · **生成**（`TerritoryHexSpawn`）= 进度推进后新露出的格子整批进场（整格透明 + 由小变大）；
 *  · **换色**（本文件）= 已经在场上的格子，**通关**后地皮从泥土块换成草地块。
 * 同一格撞车时优先级：翻格 > 生成 > 换色（视图里按这个顺序互相 `stop`）。
 */

/** 单格换色动画的总时长（秒）。0.36s：比"生成"（0.4s）略快 —— 它是旧东西退场，不该让人等。 */
export const TERRITORY_HEX_RECOLOR_SECONDS = 0.36;

/** 相邻两格的换色间隔（秒）—— 需求里的「轻微的先后落差」。0.07s ≈ 4 帧。 */
export const TERRITORY_HEX_RECOLOR_STAGGER_SECONDS = 0.07;

/**
 * 错峰**总上限**（秒）。
 *
 * 一次通关常常只影响 1~3 格，但「区域通关」口径下（同 `configId` 的多格一起算）可能一次十几格，
 * 不封顶就排到 1s 以上 —— 读起来像卡顿而不是"落差"。
 */
export const TERRITORY_HEX_RECOLOR_STAGGER_MAX_SECONDS = 0.3;

/**
 * 旧地皮缩到多小再消失：`0.55`。
 *
 * 与「生成」的起手缩放同值（`TERRITORY_HEX_SPAWN_FROM_SCALE`）：一进一出都是"半格大小"，
 * 两套动画放在同一屏上不会一大一小。不用 0：缩到 0 会先变成一个点再消失，像被针刺掉。
 */
export const TERRITORY_HEX_RECOLOR_OUT_SCALE = 0.55;

/**
 * 新地皮从多大开始长：`0.6`。
 *
 * 比旧地皮的终态（0.55）略大一点，交叉的那几帧里"新"不会被"旧"完全盖住，
 * 视觉上是**从旧的残影里顶出来**，而不是"旧的缩没了、新的才开始"。
 */
export const TERRITORY_HEX_RECOLOR_IN_FROM_SCALE = 0.6;

/**
 * 旧地皮在整段的**第几成**彻底消失（0~1）。
 *
 * 0.55 ⇒ 前 0.198s 走完"缩小 + 化掉"，剩下的时间全给新地皮收尾。
 * 超过 0.7 就会读到"两半同时在动"，谁是主体就分不清了。
 */
export const TERRITORY_HEX_RECOLOR_OUT_END = 0.55;

/**
 * 新地皮在整段的**第几成**开始出现（0~1）。
 *
 * 0.30 ⇒ 与旧地皮的退场**交叉 0.09s**（0.30~0.55）。这一段重叠是刻意的：
 * 完全错开（`>= OUT_END`）会在中间留一帧"格子空了"，一闪就是漏光。
 */
export const TERRITORY_HEX_RECOLOR_IN_START = 0.3;

/**
 * 新地皮的透明度在自己的窗口里走完几成就铺满（0~1）。
 *
 * 与生成动画同一口径（`TERRITORY_HEX_SPAWN_OPACITY_PORTION = 0.7`）：先"变实"再"长满"，
 * 反过来会出现「已经长到 1 了还是半透明」的灰蒙感。
 */
export const TERRITORY_HEX_RECOLOR_IN_OPACITY_PORTION = 0.7;

/** 某一时刻的姿态。视图直接照着写节点，不再做二次换算。 */
export interface ITerritoryHexRecolorFrame {
    /** 旧地皮缩放（`1 → TERRITORY_HEX_RECOLOR_OUT_SCALE`）。 */
    readonly outScale: number;
    /** 旧地皮不透明度（`1 → 0`，视图乘 255 取整）。 */
    readonly outOpacity: number;
    /** 新地皮缩放（`TERRITORY_HEX_RECOLOR_IN_FROM_SCALE → 1`）。 */
    readonly inScale: number;
    /** 新地皮不透明度（`0 → 1`）。 */
    readonly inOpacity: number;
}

/** 参与错峰排序的一格：只要 id 与格心坐标（排序用），不关心它是什么格。 */
export interface ITerritoryHexRecolorCell {
    readonly cellId: number;
    readonly x: number;
    readonly y: number;
}

function clamp01(value: number): number {
    if (!(value > 0)) return 0;
    return value > 1 ? 1 : value;
}

/** 起手快、落位慢 —— 「长出来」的手感（与生成动画同一个缓动，两套动画才像一家人）。 */
function easeOutCubic(p: number): number {
    const x = clamp01(p);
    return 1 - (1 - x) * (1 - x) * (1 - x);
}

/**
 * 起手慢、收尾快 —— 「化掉」的手感。
 *
 * 旧地皮**不能用** `easeOutCubic` 收尾：那样最后一段几乎不动，透明度到 0 的那一帧
 * 会读成"啪"地消失。先慢后快才是"逐渐被吸进去"。
 */
function easeInQuad(p: number): number {
    const x = clamp01(p);
    return x * x;
}

/**
 * 已用时（秒）→ 这一帧「旧的退场 / 新的进场」两组参数。
 *
 * @param seconds 相对**本格自己的**起点（延迟已扣掉）。`<= 0` = 还没轮到它 ⇒ 起手帧
 *                （旧地皮原样、新地皮 0）。视图 `play()` 时先写一遍这一帧，避免"闪一帧新地皮"。
 */
export function territoryHexRecolorFrame(seconds: number): ITerritoryHexRecolorFrame {
    // `!(seconds > 0)` 一次挡掉 NaN / 0 / 负数 / -Infinity（NaN 的比较恒 false，正是想要的）。
    // +Infinity 落到下面那条 `>= 时长` ⇒ 终态，符合"已经过去很久了"的语义。
    if (!(seconds > 0)) {
        return { outScale: 1, outOpacity: 1, inScale: TERRITORY_HEX_RECOLOR_IN_FROM_SCALE, inOpacity: 0 };
    }
    if (seconds >= TERRITORY_HEX_RECOLOR_SECONDS) {
        return { outScale: TERRITORY_HEX_RECOLOR_OUT_SCALE, outOpacity: 0, inScale: 1, inOpacity: 1 };
    }
    const t = seconds / TERRITORY_HEX_RECOLOR_SECONDS;
    const outT = clamp01(t / TERRITORY_HEX_RECOLOR_OUT_END);
    const inT = clamp01((t - TERRITORY_HEX_RECOLOR_IN_START) / (1 - TERRITORY_HEX_RECOLOR_IN_START));
    return {
        // 旧：缩放用 `easeOut`（一上来就看得出在缩），透明度用 `easeIn`（后段加速化掉）——
        // 两者错开，才读得出"缩小 → 变透 → 消失"三步，而不是"整体等比淡掉"。
        outScale: 1 - (1 - TERRITORY_HEX_RECOLOR_OUT_SCALE) * easeOutCubic(outT),
        outOpacity: 1 - easeInQuad(outT),
        // 新：与生成动画同一条曲线（`easeOutCubic` 长开 + 前 70% 铺满不透明度）。
        inScale: TERRITORY_HEX_RECOLOR_IN_FROM_SCALE
            + (1 - TERRITORY_HEX_RECOLOR_IN_FROM_SCALE) * easeOutCubic(inT),
        inOpacity: easeOutCubic(clamp01(inT / TERRITORY_HEX_RECOLOR_IN_OPACITY_PORTION)),
    };
}

/**
 * 一批换色的格子 → 每格的延迟（秒）。
 *
 * 排序按**到簇心的距离升序**：先中间换、再向外一圈 —— 与「生成」同一套观感口径
 * （按 cellId / 数组顺序排会在屏幕上变成毫无方向的乱序闪烁）。
 * 距离相同时按 `cellId` 兜底，保证同一批格子每次的先后**完全可复现**（单测 / 打日志都靠它）。
 *
 * @param stagger 相邻两格的间隔；取负值按 0 处理（不允许倒序进场）。
 */
export function territoryHexRecolorDelays(
    cells: readonly ITerritoryHexRecolorCell[],
    stagger: number = TERRITORY_HEX_RECOLOR_STAGGER_SECONDS,
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
    const cap = TERRITORY_HEX_RECOLOR_STAGGER_MAX_SECONDS;
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
 * 与 `territoryHexRecolorDelays` 共用同一套上限，改一处两边一起变。
 */
export function territoryHexRecolorBatchSeconds(
    cellCount: number,
    stagger: number = TERRITORY_HEX_RECOLOR_STAGGER_SECONDS,
): number {
    if (!(cellCount > 0)) return 0;
    const gap = Number.isFinite(stagger) && stagger > 0 ? stagger : 0;
    const delay = Math.min(TERRITORY_HEX_RECOLOR_STAGGER_MAX_SECONDS, (cellCount - 1) * gap);
    return delay + TERRITORY_HEX_RECOLOR_SECONDS;
}
