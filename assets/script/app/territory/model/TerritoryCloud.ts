/**
 * 「未解锁云」的摆放 / 挡云间隔 / 云洞缩小 / 消散时间轴（纯函数、零 `cc`）。
 *
 * ## 需求沿革（同一天四版，第四版为准）
 *
 * | 版本 | 口径 |
 * | --- | --- |
 * | 2026-10-23 一版 | 「未解锁云有序列帧，解锁云会消散」⇒ 待机 5 帧循环 + 逐格错相位 |
 * | 2026-10-23 二版 | ① 云与地块留**固定 15px** 间隔，不许遮挡地块；② 序列帧**只在云消散**时用，未解锁状态是一张**静止图** |
 * | 2026-10-23 三版 | ① 影子必须画在云体**之下**；② 云洞**不再裁剪**，改成"少放几朵 + 轻微缩小"（{@link TERRITORY_CLOUD_POCKET_SCALE}） |
 * | 2026-10-23 四版（本次） | 三版的"运行时按行切 `SpriteFrame.rect`"实机**翻车**（影子压到云上，整片云发灰）⇒ 改由**美术层离线拆图**：`cloud_body_N` / `cloud_shadow_N` 两张同画布 PNG，运行时一个 rect 都不算 |
 *
 * ⇒ 待机那套「5 帧循环 + 相位错开」整条退役（`territoryCloudIdleFrame` / `territoryCloudPhase`
 * 连常量一起删掉）。留着它等于留一条"以后有人顺手接回去"的路，与当初删白光爆点同一态度。
 * 三版的 `TERRITORY_CLOUD_BODY_BAND` / `TERRITORY_CLOUD_SHADOW_BAND` /
 * `territoryCloudBandRect` 同样**整条删除**，理由见文件末尾「为什么不再运行时切」。
 * 现在：
 *
 * | 表现 | 用什么 |
 * | --- | --- |
 * | 未解锁（静止） | `cloud_body_0`（云体）+ `cloud_shadow_0`（影子），**不随帧变化** |
 * | 云体 / 影子分层 | 两张同画布图、同坐标；影子分组恒为层里第 0 个孩子（视图侧的事） |
 * | 解锁消散 | `cloud_dissolve_body_0…1` + `cloud_dissolve_shadow_0…1` 各两帧 + 淡出（{@link territoryCloudDissolveFrame}） |
 * | 与地块的间隔 | 挡云遮罩：{@link territoryCloudKeepOutPoints}（格面外扩 {@link TERRITORY_CLOUD_KEEP_OUT_PX}） |
 *
 * ## 为什么要"外扩多边形"而不是"把云缩小"
 *
 * 一朵云 200×240，一格的脸才 123×90 —— 云**天生**盖到相邻格。所以"不遮挡地块"只能靠
 * **擦掉**（视图侧用 `Mask` 反向遮罩），擦除区 = 每个已解锁格的格面**外扩 15px**。
 * 外扩量必须是真的 15px，见 `territoryCloudKeepOutPoints` 的注释（按顶点等比放大会缩水到 ~7.5px）。
 *
 * ⚠️ 唯一的例外是**云洞**（被地块包围的未解锁格）：那里不擦、也不裁，靠
 * {@link TERRITORY_CLOUD_POCKET_SCALE} 把云缩小一点留出观感上的空隙（三版口径）。
 */

import {
    HEX_GRID_FACE_HEIGHT,
    HEX_GRID_FACE_WIDTH,
    HEX_GRID_VIEW_COLUMN_SPACING,
    HEX_GRID_VIEW_ROW_SPACING,
    hexGridNeighborIds,
    hexGridViewPoint,
} from '../../../core/hex/HexGridLayout';

/**
 * 消散总时长（秒）：2 帧（裂成环 → 几乎散尽）走完再淡到透明。
 *
 * 0.5s 是刻意压短的 —— 云散开之后地皮还要由 `TerritoryHexSpawn`（0.4s）长出来，
 * 两者同帧起步，云停留太久会读成"点了没反应"。
 */
export const TERRITORY_CLOUD_DISSOLVE_SECONDS = 0.5;

/** 消散过程中**保持全不透明**的比例（0~1）；过了这一段才开始淡出。 */
export const TERRITORY_CLOUD_DISSOLVE_HOLD = 0.3;

/**
 * 云与地块（格面）之间**固定的空白间隔**（像素，地图局部坐标）。
 *
 * 2026-10-23 用户：「云层和地块有个固定的间隔 15px，不会遮挡地块」。
 * 换算到屏幕要乘 `MapLayer` 的基准缩放（地图本身有适配缩放），这里只管地图坐标。
 */
export const TERRITORY_CLOUD_KEEP_OUT_PX = 15;

/**
 * 云的显示倍率（`1` = 美术原图 200×240 的 1:1）。
 *
 * ⚠️ 原图比一格（130×119）大一圈多，相邻格位之间**必然重叠** —— 这正是"连片云雾"的来源。
 * 别再指望靠"缩小云"来避免遮挡地块：缩到不碰脸要 0.37 倍，云会变成一颗颗孤立的小白点。
 * 遮挡由遮罩解决（{@link territoryCloudKeepOutPoints}）。
 */
export const TERRITORY_CLOUD_SCALE = 1;

/**
 * 云节点相对「格面中心」的 y 偏移（美术像素）。
 *
 * 原图 200×240 里云体（含投影）占 `y = 0…198`，重心比画布中心高约 21px
 * （中心对齐会把云体顶到格子上方去）。取负值把云体压回格面。
 */
export const TERRITORY_CLOUD_ART_OFFSET_Y = -21;

/** 一个二维点（只在本文件与视图之间传递，不引 `cc`）。 */
export interface ITerritoryCloudPoint {
    readonly x: number;
    readonly y: number;
}

/**
 * 格面六边形的**原始 6 个顶点**（相对格面中心，**逆时针**，y 向上）。
 *
 * 平顶蜂窝：左右各一个尖角，上下各一条平边 —— 与 `HEX_GRID_FACE_WIDTH / HEIGHT` 同源，
 * 所以"擦除区"永远与地块的真实轮廓对齐（改格子尺寸时不用改这里）。
 */
const HEX_FACE_OUTLINE: readonly ITerritoryCloudPoint[] = (() => {
    const hw = HEX_GRID_FACE_WIDTH / 2;
    const hh = HEX_GRID_FACE_HEIGHT / 2;
    const qw = HEX_GRID_FACE_WIDTH / 4;
    return [
        { x: hw, y: 0 },
        { x: qw, y: hh },
        { x: -qw, y: hh },
        { x: -hw, y: 0 },
        { x: -qw, y: -hh },
        { x: qw, y: -hh },
    ];
})();

/** 边 `a → b` 的**外法线**（逆时针多边形：`(dy, -dx)` 归一化）。 */
function edgeNormal(a: ITerritoryCloudPoint, b: ITerritoryCloudPoint): ITerritoryCloudPoint {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (!(length > 0)) return { x: 0, y: 0 };
    return { x: dy / length, y: -dx / length };
}

/**
 * 格面**向外平移 `inset` 像素**后的 6 个顶点（相对格面中心，逆时针，y 向上）。
 *
 * ## 为什么不是"顶点按比例放大"
 *
 *  等比放大看着等价，实际不是：格面 123×90，顶点 `(61.5, 0)` 放大后到 `(76.5, 0)`（= +15 ✓），
 *  但斜边上的顶点 `(30.75, 45)` 只往外挪了 `(7.5, 15)` —— **垂直于斜边的距离只有 ~7.5px**，
 *  于是"15px 间隔"在斜边上缩水一半，视觉上云就贴着地块的上/下边缘了。
 *
 *  这里走**斜接（miter）**：每个顶点按相邻两条边的外法线求交，
 *  `p' = p + inset × (n₁ + n₂) / (1 + n₁·n₂)` ⇒ 每条边都精确外移 `inset`。
 *
 * @param inset 外扩量（像素）；非有限值退回 {@link TERRITORY_CLOUD_KEEP_OUT_PX}，
 *              负数 / 0 按 0 处理（= 正好贴着格面）。
 */
export function territoryCloudKeepOutPoints(
    inset: number = TERRITORY_CLOUD_KEEP_OUT_PX,
): ITerritoryCloudPoint[] {
    const gap = Number.isFinite(inset) ? (inset > 0 ? inset : 0) : TERRITORY_CLOUD_KEEP_OUT_PX;
    const count = HEX_FACE_OUTLINE.length;
    const out: ITerritoryCloudPoint[] = [];
    for (let index = 0; index < count; index += 1) {
        const previous = HEX_FACE_OUTLINE[(index - 1 + count) % count];
        const current = HEX_FACE_OUTLINE[index];
        const next = HEX_FACE_OUTLINE[(index + 1) % count];
        const first = edgeNormal(previous, current);
        const second = edgeNormal(current, next);
        const denominator = 1 + (first.x * second.x + first.y * second.y);
        // 180° 反向的两条边（退化多边形）时分母为 0；此时退化成"沿法线直推"。
        const mx = denominator > 1e-6 ? (first.x + second.x) / denominator : first.x;
        const my = denominator > 1e-6 ? (first.y + second.y) / denominator : first.y;
        out.push({ x: current.x + mx * gap, y: current.y + my * gap });
    }
    return out;
}

function clamp01(value: number): number {
    if (!(value > 0)) return 0;
    return value > 1 ? 1 : value;
}

/** 消散某一帧的姿态。视图照着写节点，不再做二次换算。 */
export interface ITerritoryCloudDissolveFrame {
    /** 消散序列帧的下标（`0…frameCount-1`）。 */
    readonly index: number;
    /** 节点不透明度（`1 → 0`，视图乘 255 取整）。 */
    readonly opacity: number;
}

/**
 * 消散进度 → 这一帧用第几张 + 多透明；`null` = 已经散尽（该把云收掉了）。
 *
 * 帧号按**时长均分**（2 帧 ⇒ 前 0.25s 裂环、后 0.25s 碎散），淡出压在第二帧上：
 * 第一帧还是"裂开的云"，直接一起淡会读成"凭空变淡"而不是"散掉"。
 *
 * @param seconds 这一格自己的消散已用时（不含任何相位）。`<= 0` = 起手帧。
 */
export function territoryCloudDissolveFrame(
    seconds: number,
    frameCount: number,
    totalSeconds: number = TERRITORY_CLOUD_DISSOLVE_SECONDS,
): ITerritoryCloudDissolveFrame | null {
    if (!(frameCount > 0)) return null;
    const total = totalSeconds > 0 ? totalSeconds : 0;
    // `!(seconds > 0)` 一次挡掉 NaN / 0 / 负数：NaN 的比较恒 false，正是想要的语义。
    if (!(seconds > 0)) return { index: 0, opacity: 1 };
    if (!(seconds < total)) return null;
    const t = seconds / total;
    const index = Math.min(frameCount - 1, Math.floor(t * frameCount));
    const fade = 1 - clamp01((t - TERRITORY_CLOUD_DISSOLVE_HOLD) / (1 - TERRITORY_CLOUD_DISSOLVE_HOLD));
    return { index, opacity: fade };
}

/** 一朵云要盖在哪：只要格号与格心坐标（坐标 = 布局点，未加 `HEX_GRID_CONTENT_LIFT`）。 */
export interface ITerritoryCloudCell {
    readonly cellId: number;
    readonly x: number;
    readonly y: number;
}

// ============================================================
// 「铺满整个背景」与「被地块包围的云洞」（2026-10-23 第二轮）
// ============================================================

/**
 * 云图的**名义**尺寸（美术原图 200×240）。
 *
 * ⚠️ 只用来算「铺满背景需要多少格点」的范围，**不参与摆放**：真正写进节点的尺寸由
 * `Sprite.sizeMode = RAW` 跟帧走。改美术尺寸时这两个数与 `TERRITORY_CLOUD_ART_OFFSET_Y` 要一起复核。
 */
export const TERRITORY_CLOUD_ART_WIDTH = 200;
export const TERRITORY_CLOUD_ART_HEIGHT = 240;

// ============================================================
// 为什么这里**没有**任何"切片换算"（四版口径，别再加回来）
// ============================================================
//
// 三版在这一段放了 `TERRITORY_CLOUD_BODY_BAND` / `TERRITORY_CLOUD_SHADOW_BAND` 与
// `territoryCloudBandRect()`：把同一张 `cloud_idle_0` 按行切成"云体"和"影子"两刀，运行时
// `new SpriteFrame()` 拼 `rect + originalSize + offset`。
//
// 实机结果（2026-10-23 截图）：影子压到了云体上，整片云变成灰石头色
// （奶油色 `(237,237,225)` 被 22% 黑压成 `(185,185,176)`）。
//
// 原因：Cocos 3.x 的 `SpriteFrame.rect` 是**自上而下**的（`_calculateUV` 把 `rect.y` 直接当 top 用），
// 而当时按「纹理原点在左下」推 `y = H - bottom` ⇒ 体 / 影两条**整体互换**，影子内容被摆到
// 画布上方 +60px，正好糊在云体上。
//
// 现在改由 `tools/split_cloud_layers.py` **离线**拆成两张同画布 PNG
// （`cloud_body_N` / `cloud_shadow_N`，像素互斥、叠起来严格等于原图）。运行时只做
// 「两个 Sprite 写同一个 `setPosition`，影子分组是层里第 0 个孩子」——
// 一个 rect、一个 offset、一个 originalSize 都不用算，这类方向错误没有第二次机会。

/**
 * 「云洞」里那几朵云额外的缩小倍率（乘在 {@link TERRITORY_CLOUD_SCALE} 上）。
 *
 * 三版口径把云洞的**正像遮罩**撤了（用户：「云洞部分的不裁剪，只需要减少云朵数量，或者轻微
 * 缩小云朵的size，在视觉上保留云朵未解锁的象征意义即可」）—— 遮罩一撤，云 200×240 会实实在在
 * 糊到周围的地块上，只能靠"少放几朵（每格一朵）+ 缩一点"把观感找回来。
 *
 * 取 0.74 是算出来的：云体（alpha>100 的那块）是 200×120，一格格面 123×90，
 * 加上**四周 15px 的间隔**（用户第三轮：「这部分的云朵也要与地块有间隔」）刚好 153×120 ——
 * 200 × 0.74 = 148 < 153、120 × 0.74 = 89 < 120，一朵云正好落在"洞 + 15px"里，不再压地块。
 *
 * 为什么不再往下缩：缩到"连透明边都不碰格面"要 0.45 倍，那个尺寸的云会变成一颗颗孤立的小白点，
 * 反而读不出"这里被雾盖着"。
 */
export const TERRITORY_CLOUD_POCKET_SCALE = 0.74;

/**
 * 「被地块包围的云洞」最多算几格。
 *
 * 为什么要封顶：判定用的是"未解锁格不连通到地图边缘"，刚进游戏时**整片未探索区**就是这种
 * 连通块 —— 不封顶会把半张图搬到 UI 之上。洞是"岛屿内部的小坑"，超过这个格数就不再特殊处理
 * （当普通未解锁区，照常被 15px 挡云区吃边）。
 */
export const TERRITORY_CLOUD_POCKET_MAX_CELLS = 8;

/**
 * 铺满内容层要补的**虚拟云格点**（真实格之外、覆盖整块背景）。
 *
 * 为什么不用"再铺一层云"：那会和真实格那层形成**两套密度**（重叠区更亮），边界一眼可见。
 * 这里直接把**同一张格网向外延伸**：行列号允许越界，坐标仍旧由 `hexGridViewPoint` 算
 * （它不校验范围）⇒ 延伸出来的点与真实格**同相位、同间距**，云连成一片、没有接缝。
 *
 * @param width  / @param height  内容层尺寸（`territoryMapContentSize`），矩形以 (0,0) 为中心
 * @returns 只包含**真实格以外**的点，且只留「云的包围盒与内容层矩形相交」的那些
 */
export function territoryCloudFillPoints(
    rows: number,
    columns: number,
    width: number,
    height: number,
): ITerritoryCloudPoint[] {
    const out: ITerritoryCloudPoint[] = [];
    if (!(rows > 0) || !(columns > 0) || !(width > 0) || !(height > 0)) return out;
    const halfW = (TERRITORY_CLOUD_ART_WIDTH * TERRITORY_CLOUD_SCALE) / 2;
    const halfH = (TERRITORY_CLOUD_ART_HEIGHT * TERRITORY_CLOUD_SCALE) / 2;
    const centerCol = (columns - 1) / 2;
    const centerRow = (rows - 1) / 2;
    // 行列号范围：先按"云的包围盒要碰到矩形"反推，再多留 1 圈（多余的由下面的相交判定筛掉）。
    const columnStart = Math.floor((-width / 2 - halfW) / HEX_GRID_VIEW_COLUMN_SPACING + centerCol) - 1;
    const columnEnd = Math.ceil((width / 2 + halfW) / HEX_GRID_VIEW_COLUMN_SPACING + centerCol) + 1;
    const rowStart = Math.floor(centerRow - (height / 2 + halfH) / HEX_GRID_VIEW_ROW_SPACING) - 1;
    const rowEnd = Math.ceil(centerRow + (height / 2 + halfH) / HEX_GRID_VIEW_ROW_SPACING) + 1;
    for (let column = columnStart; column <= columnEnd; column += 1) {
        for (let row = rowStart; row <= rowEnd; row += 1) {
            // 真实格由 `sync` 那一套负责（要消散、要判解锁），这里只补外面的。
            if (row >= 0 && row < rows && column >= 0 && column < columns) continue;
            const point = hexGridViewPoint(row, column, rows, columns);
            if (Math.abs(point.x) - halfW > width / 2) continue;
            if (Math.abs(point.y) - halfH > height / 2) continue;
            out.push({ x: point.x, y: point.y });
        }
    }
    return out;
}

/**
 * 「被地块包围」的未解锁格（岛屿内部的小洞）。
 *
 * 判据：未解锁格彼此连通（六邻），且**这一块碰不到地图边缘** —— 只要有一条未解锁路径通到
 * 边界，这块就是"外围雾"，不是洞。实现是反过来做的：从边缘的未解锁格灌一遍，剩下的就是洞。
 *
 * ⚠️ 封顶 `maxCells`（见 `TERRITORY_CLOUD_POCKET_MAX_CELLS`）：超过就整块放弃，
 * 免得"开局半张图未探索"被当成一个巨洞搬到 UI 之上。
 *
 * ⚠️ 三版口径：洞里的云**不再裁剪**（`territoryCloudPocketPatchPoints` 已整条删除）——
 * 原来按「洞格 + 六邻」铺 7 朵、再用"洞外扩 15px"的正像遮罩裁形，实机看是**一块白色六边形**，
 * 完全不像云。现在每格只放一朵、缩到 `TERRITORY_CLOUD_POCKET_SCALE`，保留"此处未解锁"的
 * 象征意义即可（用户 2026-10-23 第三轮：「不裁剪，只需要减少云朵数量，或者轻微缩小云朵的size」）。
 *
 * @returns 升序的 cellId 列表（可复现，便于用例直接比数组）
 */
export function territoryCloudPocketCells(
    rows: number,
    columns: number,
    revealed: ReadonlySet<number>,
    maxCells: number = TERRITORY_CLOUD_POCKET_MAX_CELLS,
): number[] {
    const total = rows * columns;
    if (!Number.isInteger(total) || total <= 0) return [];
    const cap = Number.isFinite(maxCells) && maxCells > 0 ? maxCells : TERRITORY_CLOUD_POCKET_MAX_CELLS;
    const exposed = new Set<number>();
    const stack: number[] = [];
    // ① 边缘的未解锁格 = 必然通到外面。
    for (let cellId = 0; cellId < total; cellId += 1) {
        if (revealed.has(cellId)) continue;
        const row = Math.floor(cellId / columns);
        const column = cellId % columns;
        if (row !== 0 && row !== rows - 1 && column !== 0 && column !== columns - 1) continue;
        exposed.add(cellId);
        stack.push(cellId);
    }
    // ② 顺着未解锁格灌，能到边缘的都算"外围雾"。
    while (stack.length) {
        const cellId = stack.pop()!;
        for (const neighbor of hexGridNeighborIds(cellId, rows, columns)) {
            if (revealed.has(neighbor) || exposed.has(neighbor)) continue;
            exposed.add(neighbor);
            stack.push(neighbor);
        }
    }
    // ③ 剩下的未解锁格就是洞；按连通块分组，超过封顶的整块丢掉。
    const pockets: number[] = [];
    const visited = new Set<number>();
    for (let cellId = 0; cellId < total; cellId += 1) {
        if (revealed.has(cellId) || exposed.has(cellId) || visited.has(cellId)) continue;
        const component: number[] = [];
        const queue: number[] = [cellId];
        visited.add(cellId);
        while (queue.length) {
            const id = queue.pop()!;
            component.push(id);
            for (const neighbor of hexGridNeighborIds(id, rows, columns)) {
                if (revealed.has(neighbor) || exposed.has(neighbor) || visited.has(neighbor)) continue;
                visited.add(neighbor);
                queue.push(neighbor);
            }
        }
        if (component.length > cap) continue;
        for (const id of component) pockets.push(id);
    }
    pockets.sort((a, b) => a - b);
    return pockets;
}
