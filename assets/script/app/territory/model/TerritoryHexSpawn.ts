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

// ---------------------------------------------------------------------------
// 「胜利通过」那一批：同一套曲线，参数更重（用户 2026-11-03）
// ---------------------------------------------------------------------------

/**
 * > 「胜利通过的地块动画节奏感需要比普通的地块生成动画更强，更明显」
 *
 * 普通生成是「云散开 / 解锁一片」这种**背景事件**，节奏要轻（0.4s、错峰 0.055、不过冲）——
 * 它常常一播十几格，重了就是挡视线。
 *
 * 「打完这一关、地盘归我」是**主动作的收尾**，玩家刚从一个弹窗/战斗里出来，视线就在这一格上。
 * 所以这一档刻意把它做成"一锤一锤"的：
 *
 * | 维度 | 普通 | 胜利 | 为什么 |
 * | --- | --- | --- | --- |
 * | 单格时长 | 0.4s | 0.62s | 过冲要有时间收尾，不然读成"抖了一下" |
 * | 起手缩放 | 0.55 | 0.28 | 起手更小 ⇒ "从地里长出来"的落差更大 |
 * | 过冲峰值 | 无 | 1.14 @ 72% | 长过头再收回来，是"砸下去"的手感；只放不弹就是普通的缓出 |
 * | 错峰 | 0.055s | 0.14s | 一格一格**分得开**，才听得出节拍（普通那档几乎是同时冒头） |
 * | 错峰上限 | 0.3s | 0.62s | 一屏十几格也让它真的排完，"同时一坨"就又没有节奏了 |
 * | 透明度铺满 | 70% | 50% | 先亮起来、再长大 —— 亮的那一下正好压在过冲上 |
 */
export const TERRITORY_HEX_SPAWN_VICTORY_SECONDS = 0.62;

/** 见 {@link TERRITORY_HEX_SPAWN_VICTORY_SECONDS} 的表：普通 0.055 ⇒ 胜利 0.14。 */
export const TERRITORY_HEX_SPAWN_VICTORY_STAGGER_SECONDS = 0.14;

/** 见同上：普通 0.3 ⇒ 胜利 0.62。 */
export const TERRITORY_HEX_SPAWN_VICTORY_STAGGER_MAX_SECONDS = 0.62;

/** 起手缩放：普通 0.55 ⇒ 胜利 0.28（起手更小，落差更大）。 */
export const TERRITORY_HEX_SPAWN_VICTORY_FROM_SCALE = 0.28;

/** 过冲峰值：长到 `1.14` 再收回 1（普通档没有这一步）。 */
export const TERRITORY_HEX_SPAWN_VICTORY_PEAK_SCALE = 1.14;

/** 过冲峰值出现在第几成（0~1）。0.72 ⇒ 前 72% 长过头，后 28% 收回来。 */
export const TERRITORY_HEX_SPAWN_VICTORY_PEAK_PORTION = 0.72;

/** 透明度在第几成铺满：普通 0.7 ⇒ 胜利 0.5（先亮起来、再长大）。 */
export const TERRITORY_HEX_SPAWN_VICTORY_OPACITY_PORTION = 0.5;

/** 一套进场节奏。普通生成与「胜利通过」只用参数区分，曲线完全共用。 */
export interface ITerritoryHexSpawnTiming {
    /** 单格时长（秒）。 */
    readonly seconds: number;
    /** 起手缩放。 */
    readonly fromScale: number;
    /** 透明度在第几成铺满（0~1）。 */
    readonly opacityPortion: number;
    /** 相邻两格的间隔（秒）。 */
    readonly stagger: number;
    /** 错峰总上限（秒）。 */
    readonly staggerMax: number;
    /** 过冲峰值（`1` = 不过冲）。 */
    readonly peakScale: number;
    /** 过冲峰值出现在第几成（`1` = 用不上）。 */
    readonly peakPortion: number;
}

/** 普通档：新地块生成（云散开 / 解锁一片）。 */
export const TERRITORY_HEX_SPAWN_TIMING: ITerritoryHexSpawnTiming = {
    seconds: TERRITORY_HEX_SPAWN_SECONDS,
    fromScale: TERRITORY_HEX_SPAWN_FROM_SCALE,
    opacityPortion: TERRITORY_HEX_SPAWN_OPACITY_PORTION,
    stagger: TERRITORY_HEX_SPAWN_STAGGER_SECONDS,
    staggerMax: TERRITORY_HEX_SPAWN_STAGGER_MAX_SECONDS,
    peakScale: 1,
    peakPortion: 1,
};

/** 胜利档：战斗/关卡通过后收进来的那批格子（更重、更分得开）。 */
export const TERRITORY_HEX_SPAWN_VICTORY_TIMING: ITerritoryHexSpawnTiming = {
    seconds: TERRITORY_HEX_SPAWN_VICTORY_SECONDS,
    fromScale: TERRITORY_HEX_SPAWN_VICTORY_FROM_SCALE,
    opacityPortion: TERRITORY_HEX_SPAWN_VICTORY_OPACITY_PORTION,
    stagger: TERRITORY_HEX_SPAWN_VICTORY_STAGGER_SECONDS,
    staggerMax: TERRITORY_HEX_SPAWN_VICTORY_STAGGER_MAX_SECONDS,
    peakScale: TERRITORY_HEX_SPAWN_VICTORY_PEAK_SCALE,
    peakPortion: TERRITORY_HEX_SPAWN_VICTORY_PEAK_PORTION,
};


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
 * @param timing  节奏档位：默认普通生成；胜利通过那批传 `TERRITORY_HEX_SPAWN_VICTORY_TIMING`
 *                （多一段"长过头再收回来"的过冲）。
 */
export function territoryHexSpawnFrame(
    seconds: number,
    timing: ITerritoryHexSpawnTiming = TERRITORY_HEX_SPAWN_TIMING,
): ITerritoryHexSpawnFrame {
    // `!(seconds > 0)` 一次挡掉 NaN / 0 / 负数 / -Infinity（NaN 的比较恒 false，正是想要的）。
    // +Infinity 落到下面那条 `>= 时长` ⇒ 终态，符合「已经过去很久了」的语义。
    if (!(seconds > 0)) {
        return { scale: timing.fromScale, opacity: 0 };
    }
    if (seconds >= timing.seconds) return { scale: 1, opacity: 1 };
    const t = seconds / timing.seconds;
    const fade = easeOutCubic(clamp01(t / timing.opacityPortion));
    const peakPortion = timing.peakScale > 1 ? clamp01(timing.peakPortion) : 1;
    // 没有过冲（普通档）：一条缓出长到底，`peakPortion = 1` 直接走最后那支。
    if (peakPortion >= 1) {
        return {
            scale: timing.fromScale + (1 - timing.fromScale) * easeOutCubic(t),
            opacity: fade,
        };
    }
    // 过冲（胜利档）：前段长到 `peakScale`，后段收回到 1 —— 两头都是精确值，中间不会跳。
    if (t < peakPortion) {
        return {
            scale: timing.fromScale + (timing.peakScale - timing.fromScale) * easeOutCubic(t / peakPortion),
            opacity: fade,
        };
    }
    const settle = easeOutCubic((t - peakPortion) / (1 - peakPortion));
    return {
        scale: timing.peakScale + (1 - timing.peakScale) * settle,
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
 * @param staggerMax 错峰总上限；缺省 `TERRITORY_HEX_SPAWN_STAGGER_MAX_SECONDS`
 *                   （胜利档传 `TERRITORY_HEX_SPAWN_VICTORY_TIMING` 的那两个值）。
 */
export function territoryHexSpawnDelays(
    cells: readonly ITerritoryHexSpawnCell[],
    stagger: number = TERRITORY_HEX_SPAWN_STAGGER_SECONDS,
    staggerMax: number = TERRITORY_HEX_SPAWN_STAGGER_MAX_SECONDS,
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
    const cap = Number.isFinite(staggerMax) && staggerMax > 0 ? staggerMax : 0;
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
export function territoryHexSpawnBatchSeconds(
    cellCount: number,
    timing: ITerritoryHexSpawnTiming = TERRITORY_HEX_SPAWN_TIMING,
): number {
    if (!(cellCount > 0)) return 0;
    const gap = Number.isFinite(timing.stagger) && timing.stagger > 0 ? timing.stagger : 0;
    const cap = Number.isFinite(timing.staggerMax) && timing.staggerMax > 0 ? timing.staggerMax : 0;
    const delay = Math.min(cap, (cellCount - 1) * gap);
    return delay + timing.seconds;
}
