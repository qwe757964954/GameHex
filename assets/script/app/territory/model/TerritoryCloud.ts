/**
 * 未解锁云的摆放、挡云间隔、云洞缩放与消散时间轴（纯函数，零 cc）。
 *
 * 待机用 `cloud_body_0` 与 `cloud_shadow_0` 两张同画布图，运行时不切 rect；
 * 解锁时按四段消散：整朵膨胀、裂壳、碎块炸开上飘、淡出。
 * 遮挡采用地块轮廓外扩 15px 的反向遮罩，云洞不裁剪，仅略微缩小。
 */

import {
    HEX_GRID_FACE_HEIGHT,
    HEX_GRID_FACE_WIDTH,
    HEX_GRID_TILE_SIDE_HEIGHT,
    HEX_GRID_VIEW_COLUMN_SPACING,
    HEX_GRID_VIEW_ROW_SPACING,
    hexGridNeighborIds,
    hexGridViewPoint,
    type HexGridPoint,
} from '../../../core/hex/HexGridLayout';
import type { TerritoryMapConfig } from './TerritoryMapConfig';
import { clamp01Finite as clamp01 } from '../../../core/math/Scalar';

/** 消散总时长（秒）。 */
export const TERRITORY_CLOUD_DISSOLVE_SECONDS = 0.5;

/** 消散过程中保持全不透明的比例。 */
export const TERRITORY_CLOUD_DISSOLVE_HOLD = 0.3;

/** 消散起手整朵膨胀段占的比例，此段仍使用待机整朵图。 */
export const TERRITORY_CLOUD_DISSOLVE_INTACT = 0.12;

/** 起手膨胀的峰值倍率。 */
export const TERRITORY_CLOUD_DISSOLVE_PUNCH = 1.06;

/** 裂开段收尾的倍率。 */
export const TERRITORY_CLOUD_DISSOLVE_CRUSH_SCALE = 0.84;

/** 碎块段向外炸开的峰值倍率。 */
export const TERRITORY_CLOUD_DISSOLVE_BURST_SCALE = 1.15;

/** 缩放调头分界，之前收缩，之后炸开。 */
export const TERRITORY_CLOUD_DISSOLVE_FRAGMENT = 0.5;

/** 消散时云体上飘距离，影子不跟随。 */
export const TERRITORY_CLOUD_DISSOLVE_LIFT_PX = 12;

/** 影子提前消失的进度，到该比例时影子已全透明。 */
export const TERRITORY_CLOUD_DISSOLVE_SHADOW_GONE = 0.75;

/** 影子在碎块段收缩到的比例。 */
export const TERRITORY_CLOUD_DISSOLVE_SHADOW_SCALE = 0.7;

/** 云与地块轮廓之间的固定间隔（地图坐标像素）。 */
export const TERRITORY_CLOUD_KEEP_OUT_PX = 15;

/**
 * 云的显示倍率（`1` = 美术原图 200×240 的 1:1）。
 *
 * 原图比一格（130×119）大一圈多，相邻格位之间**必然重叠** —— 这正是"连片云雾"的来源。
 * 别再指望靠"缩小云"来避免遮挡地块：缩到不碰脸要 0.37 倍，云会变成一颗颗孤立的小白点。
 * 遮挡由遮罩解决（{@link territoryCloudKeepOutPoints}）。
 */
export const TERRITORY_CLOUD_SCALE = 1;

/**
 * 云美术「视觉重心」相对**画布中心**的偏移（美术像素，向上为正）。
 *
 * 原图 200×240 里云体（含投影）占 `y = 0…198` ⇒ 重心在 `y = 99`，比画布中心 `120`
 * 高 **21.5px**。这个数是**美术事实**，不随显示倍率变；真正写进节点的偏移要乘倍率
 * （见 {@link territoryCloudArtOffsetY}）。
 */
export const TERRITORY_CLOUD_ART_CENTER_Y = 21.5;

/**
 * 云节点相对「格面中心」的 y 偏移（地图像素）—— **必须按显示倍率算**。
 *
 * 不能写成固定值
 *
 * 重心偏移是**美术像素**，节点缩放后它在屏幕上的长度会跟着缩水：
 * 固定写 `-21.5` 时，1.0 倍正好把云压在格面上，0.6 倍就只压回 12.9px ⇒ 云整体**往下漂**
 * 8.6px（云洞缩得越小漂得越多，看起来"云跑到下面那格去了"）。
 * 乘倍率之后，任何一种倍率下云的重心都精确落在格面中心。
 *
 * @param scale 这一朵云的显示倍率（`TERRITORY_CLOUD_SCALE` 或再乘云洞倍率）。
 */
export function territoryCloudArtOffsetY(scale: number = TERRITORY_CLOUD_SCALE): number {
    const value = Number.isFinite(scale) ? scale : TERRITORY_CLOUD_SCALE;
    return -TERRITORY_CLOUD_ART_CENTER_Y * value;
}

/**
 * 1.0 倍下的 y 偏移（= `territoryCloudArtOffsetY(TERRITORY_CLOUD_SCALE)`）。
 *
 * 只给"倍率恒为 1"的调用方与用例当参照；真正摆位一律走 {@link territoryCloudArtOffsetY}。
 */
export const TERRITORY_CLOUD_ART_OFFSET_Y = territoryCloudArtOffsetY(TERRITORY_CLOUD_SCALE);

/**
 * 云体（alpha 主体，不含地面投影）的尺寸 —— 美术实测 `cloud_body_0` 的 `alpha > 40` 包围盒。
 *
 * 云洞的可用空间是按它算的：格面 + 四周 15px = `153×120`；
 * 而**整朵云**（体 + 影子）高 198，所以洞里的缩放上限由「198 × s ≤ 120」定死。
 */
export const TERRITORY_CLOUD_BODY_WIDTH = 200;
export const TERRITORY_CLOUD_BODY_HEIGHT = 120;
/** 整朵云（云体 + 地面投影）的高度 —— 美术实测 `cloud_idle_0` 包围盒 `y = 0…197`。 */
export const TERRITORY_CLOUD_FULL_HEIGHT = 198;

/**
 * 铺满层退场时长，与最后一朵真实云的消散时间相同。
 *
 * 两条时间轴等长，使边界雾与云同时散尽；不能写成消散结束后再淡出。
 * 逐朵窗口由 territoryCloudFillWaveWindow 计算，均不超过该总时长。
 */
export const TERRITORY_CLOUD_FILL_FADE_SECONDS = 0.5;

/**
 * 全解锁后云雾散场的镜头分段：拉远 1.1 秒、淡出 2 秒、拉回 0.7 秒。
 *
 * 淡出时长单独定义，不并入默认退场的 0.5 秒，演出需要放慢才能看清扩散过程。
 * 总时长由 territoryCloudDollyTotalSeconds 计算。
 */
export const TERRITORY_CLOUD_DOLLY_OUT_SECONDS = 1.1;
export const TERRITORY_CLOUD_DOLLY_FADE_SECONDS = 2;
export const TERRITORY_CLOUD_DOLLY_IN_SECONDS = 0.7;

/**
 * 拉远时给地图四周留的余量（0~1）。0.94 ⇒ 最长的那一边占满 94% 视口。
 *
 * 地图包围盒量的是**格心**，最外圈地块的图还往外探半格 ——
 * {@link territoryCloudDollyFitScale} 里已经把这一格算进尺寸，这里只留"呼吸感"。
 */
export const TERRITORY_CLOUD_DOLLY_FIT_MARGIN = 0.94;

/** 演出总时长（秒）；`elapsed >= 它` 就是收工，地图必须还原。 */
export function territoryCloudDollyTotalSeconds(): number {
    return TERRITORY_CLOUD_DOLLY_OUT_SECONDS
        + TERRITORY_CLOUD_DOLLY_FADE_SECONDS
        + TERRITORY_CLOUD_DOLLY_IN_SECONDS;
}

/**
 * 演出已用时 → 镜头「拉远程度」（**0 = 初始高度，1 = 整张图入画**）。纯函数。
 *
 * 曲线：拉远用 `easeOut`（一下子抬起来再收住），拉回用 `1 - easeOut`（对称地落回去，
 * 末段慢、不会"啪"一下砸回原位）。中间那段恒为 1 —— 雾就是在这段里淡完的。
 *
 * @param seconds 已用时（秒）；`<= 0` 或 `>= 总时长` 一律 0（收工态 = 初始高度）
 */
export function territoryCloudDollyZoom(seconds: number): number {
    const total = territoryCloudDollyTotalSeconds();
    if (!(seconds > 0) || !(seconds < total)) return 0;
    if (seconds < TERRITORY_CLOUD_DOLLY_OUT_SECONDS) {
        return easeOut(seconds / TERRITORY_CLOUD_DOLLY_OUT_SECONDS);
    }
    const backAt = TERRITORY_CLOUD_DOLLY_OUT_SECONDS + TERRITORY_CLOUD_DOLLY_FADE_SECONDS;
    if (seconds < backAt) return 1;
    return 1 - easeOut((seconds - backAt) / TERRITORY_CLOUD_DOLLY_IN_SECONDS);
}

/**
 * 铺满层该不该开始淡 —— **拉远到位那一刻**才起跑，否则玩家还没看清全图雾就淡一半了。
 */
export function territoryCloudDollyFadeDue(seconds: number): boolean {
    return seconds >= TERRITORY_CLOUD_DOLLY_OUT_SECONDS;
}

/**
 * 让「整张图入画」的内容层缩放（≤ 1，**只缩小不放大**）。
 *
 * 包围盒量的是格心（`layout.width/height`），最外圈地块的图还往外探**半格**
 * ⇒ 尺寸按「包围盒 + 一整格」（左右各半格）算，再乘 {@link TERRITORY_CLOUD_DOLLY_FIT_MARGIN}。
 *
 * 任一入参非法（0 / 负数 / NaN / Infinity）⇒ 返回 1（不缩放），绝不让地图塌成 0。
 * 四个都要 `Number.isFinite`：只判 `> 0` 的话 `Infinity` 视口会算出个"半倍率"，
 * 看着像正常值、实际是脏数据带进来的。
 */
export function territoryCloudDollyFitScale(
    mapWidth: number,
    mapHeight: number,
    viewportWidth: number,
    viewportHeight: number,
): number {
    if (!Number.isFinite(mapWidth) || !Number.isFinite(mapHeight)) return 1;
    if (!Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight)) return 1;
    if (!(mapWidth > 0) || !(mapHeight > 0)) return 1;
    if (!(viewportWidth > 0) || !(viewportHeight > 0)) return 1;
    const width = mapWidth + HEX_GRID_FACE_WIDTH;
    const height = mapHeight + HEX_GRID_FACE_HEIGHT;
    const fit = Math.min(viewportWidth / width, viewportHeight / height) * TERRITORY_CLOUD_DOLLY_FIT_MARGIN;
    if (!Number.isFinite(fit) || !(fit > 0)) return 1;
    return Math.min(1, fit);
}

/**
 * 铺满层退场时间轴：**已用时 → 不透明度（0~1）**。纯函数，`easeOut`（快起慢收）⇒
 * 起手一下就明显变透、尾段慢慢抹平，与消散那套同一条缓动。
 *
 * @param seconds 退场已用时（秒）；`<= 0` = 起手（全不透明）；`>= totalSeconds` = 退完（0）。
 */
export function territoryCloudFillOpacity(
    seconds: number,
    totalSeconds: number = TERRITORY_CLOUD_FILL_FADE_SECONDS,
): number {
    const total = totalSeconds > 0 ? totalSeconds : 0;
    // 与消散同一条挡脏参数的分界：`!(x > 0)` 一次吃掉 NaN / 0 / 负数。
    if (!(seconds > 0)) return 1;
    if (total <= 0) return 0;
    if (!(seconds < total)) return 0;
    return 1 - easeOut(seconds / total);
}

// ============================================================
// 雾散的「扩散波」：靠近地块的先散、越远越慢
// ============================================================
//
// 消散顺序按距地块由近到远，近处先散、远处后散，形成扩散观感。
//
// 老口径是**整层一个 `UIOpacity`** ⇒ 几百朵雾同一帧起淡、同一帧淡完，屏幕上是一层灰
// 整体变薄（读"调低了透明度"，不读"雾在退"）。现在按「这一朵到最近地块的距离」逐朵错峰：
//
// ```
// 距离 0（贴着地块） ────────────────────────→ 最远
// 起淡 0 ── 0.25 × 总时长 ──────→
// 时长 0.55 × 总时长 ──────────────────────→ 0.75 × 总时长
// 淡完 0.55 × 总时长 ──────────────────────→ 1.00 × 总时长
// ```
//
// 三条同时生效（起得早、还更快）⇒ 全透明的"边界"从地块外沿一圈一圈推出去，就是那个扩散读法。
// 只做起淡延迟、时长仍相同的话，观感是"整片雾匀速变薄、只是错开了"——远的那圈并不比近的慢。

/**
 * 近端**缩短**多少（占整条时长的比例，`0~1`）：贴着地块的那朵只淡 `1 - 它`。
 *
 * 0.45 ⇒ 近端 0.55 倍、远端 1.0 倍。太小（0）只是整层一起淡，太大（>0.6）近端会"啪"一下没。
 */
export const TERRITORY_CLOUD_FILL_WAVE_SPREAD = 0.45;

/**
 * 远端**推迟**多少（占整条时长的比例，`0~1`）：最远那朵晚这么多秒才起淡。
 *
 * 0.25 ⇒ 整条时长里前 1/4 只有近处的雾在动，远处的还没开始 —— 这一"先后"才是扩散感。
 *
 * **必须小于** {@link TERRITORY_CLOUD_FILL_WAVE_SPREAD}：窗长 = 总时长 − 推迟 − 近端缺口 ×(1−波次)，
 * 推迟 ≥ 差距时窗长会随距离**变短**（远的反而淡得更快，方向就反了）。
 */
export const TERRITORY_CLOUD_FILL_WAVE_STAGGER = 0.25;

/**
 * 「这一朵雾离地块多远」→ 波次（`0` = 贴着地块、`1` = 最远的那朵）。纯函数。
 *
 * @param distance 到这朵雾**最近的地块格心**的距离（地图像素）
 * @param maxDistance 全部铺满雾里的最大距离（归一化的分母）
 *
 * 脏参数一律当 0（= 当它贴着地块、按近端速度淡）：宁可让它早散一点，也不要算出 `NaN`
 * 让某朵雾永远停在半透明上。
 */
export function territoryCloudFillWaveOrder(distance: number, maxDistance: number): number {
    if (!Number.isFinite(distance) || !Number.isFinite(maxDistance) || !(maxDistance > 0)) return 0;
    return clamp01(distance / maxDistance);
}

/** 一朵雾的淡出窗口（秒，相对**整条时间轴的起点**）。 */
export interface ITerritoryCloudFillWaveWindow {
    /** 晚多少秒起淡（近端 0）。 */
    readonly delay: number;
    /** 自己这条淡出曲线有多长（近端短、远端长）。 */
    readonly duration: number;
}

/**
 * 波次 → 这一朵的淡出窗口（`[delay, delay + duration] ⊆ [0, 总时长]`）。纯函数。
 *
 * ```
 * delay = 波次 × STAGGER × 总时长
 * duration = 总时长 − delay − SPREAD × 总时长 × (1 − 波次)
 * ```
 *
 * 两端严格**收在整条时长以内**（远端 `delay + duration = 总时长`）—— 铺满层是按"整条时长走完"
 * 才 `active = false` 的，只要有一朵没淡完就被收起来，那朵就是"啪"一下没。
 *
 * @param order 波次（0~1，越界自动夹紧）
 * @param totalSeconds 整条时间轴时长；非正 / 脏值 ⇒ 退化成一帧淡完（与老口径一致）
 */
export function territoryCloudFillWaveWindow(
    order: number,
    totalSeconds: number = TERRITORY_CLOUD_FILL_FADE_SECONDS,
): ITerritoryCloudFillWaveWindow {
    const total = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 0;
    const wave = clamp01(order);
    const delay = wave * TERRITORY_CLOUD_FILL_WAVE_STAGGER * total;
    const duration = total - delay - TERRITORY_CLOUD_FILL_WAVE_SPREAD * total * (1 - wave);
    // 窗长被脏参数（比如把两个手感参数配成 SPREAD + STAGGER > 1）压到非正 ⇒ 退回"整条一条曲线"。
    if (!(duration > 0)) return { delay: 0, duration: total };
    return { delay, duration };
}

/**
 * 一朵雾在「整条时间轴已用时 `seconds`」时的不透明度（`0~1`）。纯函数。
 *
 * 就是 `territoryCloudFillOpacity(seconds − delay, duration)` —— 曲线仍是同一个 `easeOut`，
 * 只是每朵自己一个窗口。`seconds < delay` 时接口天然给 1（还没轮到它）。
 */
export function territoryCloudFillWaveOpacity(
    seconds: number,
    order: number,
    totalSeconds: number = TERRITORY_CLOUD_FILL_FADE_SECONDS,
): number {
    const window = territoryCloudFillWaveWindow(order, totalSeconds);
    return territoryCloudFillOpacity(seconds - window.delay, window.duration);
}

/** 「这一章通关了 ⇒ 整片雾收掉」这一拍该做什么，见 {@link territoryCloudClearAction}。 */
export type TerritoryCloudClearAction = 'none' | 'animate' | 'instant';

/**
 * 判断通关时该散雾还是直接收掉。
 *
 * cleared 决定是否散雾，animate 表示本次是否刚通关。
 * 持久已通关的章节只直接收掉，避免进页面时重播整段演出。
 */
export function territoryCloudClearAction(
    cleared: boolean,
    animate: boolean,
    resolved: boolean,
): TerritoryCloudClearAction {
    if (!cleared) return 'none';
    if (resolved) return 'none';
    return animate ? 'animate' : 'instant';
}

/** 一个二维点（只在本文件与视图之间传递，不引 `cc`）。 */
export interface ITerritoryCloudPoint {
    readonly x: number;
    readonly y: number;
}

/**
 * **格面**六边形的 6 个顶点（相对格面中心，逆时针，y 向上）—— 只有"台面"，不含侧壁。
 *
 * 什么时候用它：算「云洞」那种**只看台面**的可用空间（{@link TERRITORY_CLOUD_POCKET_SCALE}）；
 * 挡云遮罩请用 {@link territoryTileOutlinePoints}（含侧壁），否则底部会贴上去。
 */
export function territoryFaceOutlinePoints(): ITerritoryCloudPoint[] {
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
}

/**
 * 地块**可见轮廓**的 6 个顶点（相对格面中心，**逆时针**，y 向上）。
 *
 * 不是"格面六边形"，而是「格面 + 下方那截 2.5D 侧壁」—— 领地的地皮是 126×117 的立体图，
 * 侧壁在格面下方还有 {@link HEX_GRID_TILE_SIDE_HEIGHT}（26px）。只按格面算，就等于把地块
 * 当成一张薄纸，侧壁那片会被当成空地。
 *
 * 「底部的云层也要和地块有 15px 的间隙」。当时遮罩底边 = 格面底边 − 15，
 * 比**图底**还高 11px ⇒ 云压在侧壁上，看起来就是"底部 0 间隙"（上边缘却是正常的 14px，
 * 因为图顶只比格面顶多 1px）。
 *
 * 平顶蜂窝：左右各一个尖角，上下各一条平边 —— 与 `HEX_GRID_FACE_WIDTH / HEIGHT` 同源，
 * 所以"擦除区"永远与地块的真实轮廓对齐（改格子尺寸时不用改这里）。
 *
 * 侧壁怎么建模：把下面两个顶点**竖直下移**侧壁高（`x` 不变）⇒ 下边缘整段压低，
 * 两条下斜边随之变长。斜接外扩后，下斜边与底边各自精确外移 15px。
 *
 * @returns 新的数组（调用方可随意改）；点序恒为「右 → 右上 → 左上 → 左 → 左下 → 右下」。
 */
export function territoryTileOutlinePoints(): ITerritoryCloudPoint[] {
    const hw = HEX_GRID_FACE_WIDTH / 2;
    const hh = HEX_GRID_FACE_HEIGHT / 2;
    const qw = HEX_GRID_FACE_WIDTH / 4;
    const bottom = -hh - HEX_GRID_TILE_SIDE_HEIGHT;
    return [
        { x: hw, y: 0 },
        { x: qw, y: hh },
        { x: -qw, y: hh },
        { x: -hw, y: 0 },
        { x: -qw, y: bottom },
        { x: qw, y: bottom },
    ];
}

/** 边 `a → b` 的**外法线**（逆时针多边形：`(dy, -dx)` 归一化）。 */
function edgeNormal(a: ITerritoryCloudPoint, b: ITerritoryCloudPoint): ITerritoryCloudPoint {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (!(length > 0)) return { x: 0, y: 0 };
    return { x: dy / length, y: -dx / length };
}

/**
 * 地块可见轮廓**向外平移 `inset` 像素**后的 6 个顶点（相对格面中心，逆时针，y 向上）。
 *
 * 不按顶点比例放大
 *
 * 等比放大看着等价，实际不是：格面 123×90，顶点 `(61.5, 0)` 放大后到 `(76.5, 0)`（= +15 ✓），
 * 但斜边上的顶点 `(30.75, 45)` 只往外挪了 `(7.5, 15)` —— **垂直于斜边的距离只有 ~7.5px**，
 * 于是"15px 间隔"在斜边上缩水一半，视觉上云就贴着地块的上/下边缘了。
 *
 * 这里走**斜接（miter）**：每个顶点按相邻两条边的外法线求交，
 * `p' = p + inset × (n₁ + n₂) / (1 + n₁·n₂)` ⇒ 每条边都精确外移 `inset`。
 *
 * 基准是 {@link territoryTileOutlinePoints}（格面 + 侧壁），**不是**格面 ——
 * 否则底部那 26px 侧壁会被当成空地，云贴上去（那条）。
 *
 * @param inset 外扩量（像素）；非有限值退回 {@link TERRITORY_CLOUD_KEEP_OUT_PX}，
 * 负数 / 0 按 0 处理（= 正好贴着地块轮廓）。
 * @param outline 基准轮廓；**别在运行时传**（默认就是地块轮廓）。只有离线对照图会把它换成
 * 格面轮廓，用来画"旧口径长什么样"。
 */
export function territoryCloudKeepOutPoints(
    inset: number = TERRITORY_CLOUD_KEEP_OUT_PX,
    outline: readonly ITerritoryCloudPoint[] = territoryTileOutlinePoints(),
): ITerritoryCloudPoint[] {
    const gap = Number.isFinite(inset) ? (inset > 0 ? inset : 0) : TERRITORY_CLOUD_KEEP_OUT_PX;
    const count = outline.length;
    const out: ITerritoryCloudPoint[] = [];
    for (let index = 0; index < count; index += 1) {
        const previous = outline[(index - 1 + count) % count];
        const current = outline[index];
        const next = outline[(index + 1) % count];
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

/** 消散某一帧的姿态。视图照着写节点，不再做二次换算。 */
export interface ITerritoryCloudDissolveFrame {
    /**
     * 消散序列帧的下标（`0…frameCount-1`）；**`-1` = 还没裂开**，用待机的整朵云图。
     *
     * 起手段（{@link TERRITORY_CLOUD_DISSOLVE_INTACT}）只做"炸一下"的缩放、不换帧 ——
     * 否则第一帧就从整朵云跳到"中间已经裂出洞的环"，读成换图而不是过渡。
     */
    readonly index: number;
    /** 节点不透明度（`1 → 0`，视图乘 255 取整）。 */
    readonly opacity: number;
    /** 这一帧的缩放倍率（乘在这朵云的**基础倍率**上：正常层 1.0、云洞 0.6）。 */
    readonly scale: number;
    /** 云体相对起手位置的上飘量（地图像素，向上为正）；影子不吃这一项。 */
    readonly liftY: number;
    /** 影子的缩放比例（相对基础倍率）：裂开段跟云体同步、碎块段**反着收小**。 */
    readonly shadowScale: number;
    /** 影子的不透明度：比云体**更早**归零（云升空了，地上的投影先没）。 */
    readonly shadowOpacity: number;
}

/** 缓出（快起慢收）：`x ∈ [0,1]`。消散的缩放 / 上飘都走它 —— "快速变小"靠的就是前段陡。 */
function easeOut(x: number): number {
    const value = clamp01(x);
    return 1 - (1 - value) * (1 - value);
}

/**
 * 消散进度 → 这一帧的姿态（帧号 / 不透明度 / 缩放 / 上飘）；`null` = 已经散尽（该把云收掉了）。
 *
 * 四段
 *
 * | 段 | 进度 | 帧 | 缩放 | 其他 |
 * | --- | --- | --- | --- | --- |
 * | ① 炸一下 | `0 ~ 12%` | **整朵**（`index = -1`） | `1 → 1.06`（缓出） | 全不透明、不上飘 |
 * | ② 裂开 + 变小 | `12% ~ 56%` | 消散帧 0（裂出洞的环） | `1.06 → 0.84`（缓出，前段陡） | 开始上飘；过 `HOLD` 才开始淡 |
 * | ③ 碎块炸开 | `56% ~ 100%` | 消散帧 1（三块碎屑） | `0.84 → 1.15`（缓出） | 上飘到 +12px、透明度见底 |
 *
 * ②③ 的**调头点**是 {@link TERRITORY_CLOUD_DISSOLVE_FRAGMENT}（= 两帧序列的中点）：
 * 壳在收缩 → 碎块向外散。只有"一路缩小"会读成云瘪了，"一路放大"又变成云涨大；
 * 一收一放才是"炸开"。
 *
 * 帧号在 ②③ 段**按剩余时长均分**（2 帧 ⇒ 各占 44%）：淡出压在最后一帧上 ——
 * 第一帧就一起淡会读成"凭空变淡"而不是"散掉"。
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
    const punch = TERRITORY_CLOUD_DISSOLVE_PUNCH;
    const crush = TERRITORY_CLOUD_DISSOLVE_CRUSH_SCALE;
    const burstScale = TERRITORY_CLOUD_DISSOLVE_BURST_SCALE;
    const fragment = TERRITORY_CLOUD_DISSOLVE_FRAGMENT;
    const intact = TERRITORY_CLOUD_DISSOLVE_INTACT;
    // `!(seconds > 0)` 一次挡掉 NaN / 0 / 负数：NaN 的比较恒 false，正是想要的语义。
    if (!(seconds > 0)) {
        return { index: -1, opacity: 1, scale: 1, liftY: 0, shadowScale: 1, shadowOpacity: 1 };
    }
    if (!(seconds < total)) return null;
    const t = seconds / total;
    // ① 炸一下：整朵云只放大、不换帧、不上飘（影子跟着一起，还没到分家的阶段）。
    if (t < intact) {
        const grow = 1 + (punch - 1) * easeOut(t / intact);
        return { index: -1, opacity: 1, scale: grow, liftY: 0, shadowScale: grow, shadowOpacity: 1 };
    }
    const fade = 1 - clamp01((t - TERRITORY_CLOUD_DISSOLVE_HOLD) / (1 - TERRITORY_CLOUD_DISSOLVE_HOLD));
    // ②③ 裂开之后的进度（`intact` 处 = 0，到点 = 1）—— 帧号 / 缩放 / 上飘共用它，三者永远同步。
    const burst = (t - intact) / (1 - intact);
    const index = Math.min(frameCount - 1, Math.floor(burst * frameCount));
    const pivot = fragment > 0 && fragment < 1 ? fragment : 0.5;
    // 壳先收（②"变小"）、碎块再炸出去（③"散开"）：两段都用缓出（前段陡），接缝处严格连续。
    const scale = burst < pivot
        ? punch + (crush - punch) * easeOut(burst / pivot)
        : crush + (burstScale - crush) * easeOut((burst - pivot) / (1 - pivot));
    // 影子：裂开段跟云体同缩放（同一朵云），碎块段**反着收**（云升空了，投影只会更小）；
    // 透明度另有一条更早的曲线（{@link TERRITORY_CLOUD_DISSOLVE_SHADOW_GONE}）。
    const shadowScale = burst < pivot
        ? scale
        : crush + (TERRITORY_CLOUD_DISSOLVE_SHADOW_SCALE - crush) * easeOut((burst - pivot) / (1 - pivot));
    const shadowGone = TERRITORY_CLOUD_DISSOLVE_SHADOW_GONE;
    const shadowFade = shadowGone > TERRITORY_CLOUD_DISSOLVE_HOLD
        ? 1 - clamp01((t - TERRITORY_CLOUD_DISSOLVE_HOLD) / (shadowGone - TERRITORY_CLOUD_DISSOLVE_HOLD))
        : fade;
    return {
        index,
        opacity: fade,
        scale,
        liftY: TERRITORY_CLOUD_DISSOLVE_LIFT_PX * easeOut(burst),
        shadowScale,
        shadowOpacity: shadowFade,
    };
}

/** 一朵云要盖在哪：只要格号与格心坐标（坐标 = 布局点，未加 `HEX_GRID_CONTENT_LIFT`）。 */
export interface ITerritoryCloudCell {
    readonly cellId: number;
    readonly x: number;
    readonly y: number;
}

// ============================================================
// 「铺满整个背景」与「被地块包围的云洞」
// ============================================================

/**
 * 云图的**名义**尺寸（美术原图 200×240）。
 *
 * 只用来算「铺满背景需要多少格点」的范围，**不参与摆放**：真正写进节点的尺寸由
 * `Sprite.sizeMode = RAW` 跟帧走。改美术尺寸时这两个数与 `TERRITORY_CLOUD_ART_OFFSET_Y` 要一起复核。
 */
export const TERRITORY_CLOUD_ART_WIDTH = 200;
export const TERRITORY_CLOUD_ART_HEIGHT = 240;

// ============================================================
// 这里**没有**任何"切片换算"，别再加回来
// ============================================================
//
// 三版在这一段放了 `TERRITORY_CLOUD_BODY_BAND` / `TERRITORY_CLOUD_SHADOW_BAND` 与
// `territoryCloudBandRect()`：把同一张 `cloud_idle_0` 按行切成"云体"和"影子"两刀，运行时
// `new SpriteFrame()` 拼 `rect + originalSize + offset`。
//
// 实机结果（截图）：影子压到了云体上，整片云变成灰石头色
// （奶油色 `(237,237,225)` 被 22% 黑压成 `(185,185,176)`）。
//
// Cocos 3.x 的 `SpriteFrame.rect` 是**自上而下**的（`_calculateUV` 把 `rect.y` 直接当 top 用），
// 而当时按「纹理原点在左下」推 `y = H - bottom` ⇒ 体 / 影两条**整体互换**，影子内容被摆到
// 画布上方 +60px，正好糊在云体上。
//
// 现在改由 `tools/split_cloud_layers.py` **离线**拆成两张同画布 PNG
// （`cloud_body_N` / `cloud_shadow_N`，像素互斥、叠起来严格等于原图）。运行时只做
// 「两个 Sprite 写同一个 `setPosition`，影子分组是层里第 0 个孩子」——
// 一个 rect、一个 offset、一个 originalSize 都不用算，这类方向错误没有第二次机会。

/**
 * 云洞内云朵额外的缩小倍率，乘在 TERRITORY_CLOUD_SCALE 上。
 *
 * 按整朵云 200×198 与洞内可用区 153×120 取交集，高度先到上限，故取 0.60。
 * 再小会失去“被雾覆盖”的观感。
 */
export const TERRITORY_CLOUD_POCKET_SCALE = 0.6;

/**
 * 被地块包围的云洞最多按几格处理。
 *
 * 未探索区域整体连通到边缘时不应抬到 UI 之上，超过上限按普通未解锁区处理。
 */
export const TERRITORY_CLOUD_POCKET_MAX_CELLS = 8;

/**
 * 铺满内容层要补的虚拟云格点，包括格网内没有内容的空格。
 *
 * 复用同一张格网向外延伸，保持相位与间距一致，避免第二层云造成密度差。
 * 只跳过已由真实云层覆盖的 occupied 格。
 *
 * @param width 内容层宽
 * @param height 内容层高
 * @param occupied 真实云层已覆盖的格
 * @returns 与内容层矩形相交的云点
 */
export function territoryCloudFillPoints(
    rows: number,
    columns: number,
    width: number,
    height: number,
    occupied?: ReadonlySet<number>,
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
            // 真实云层已经盖过的格由 `sync` 那一套负责（要消散、要判解锁），这里不重复放。
            if (row >= 0 && row < rows && column >= 0 && column < columns) {
                const cellId = row * columns + column;
                if (occupied?.has(cellId)) continue;
            }
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
 * 封顶 `maxCells`（见 `TERRITORY_CLOUD_POCKET_MAX_CELLS`）：超过就整块放弃，
 * 免得"开局半张图未探索"被当成一个巨洞搬到 UI 之上。
 *
 * 三版口径：洞里的云**不再裁剪**（`territoryCloudPocketPatchPoints` 已整条删除）——
 * 原来按「洞格 + 六邻」铺 7 朵、再用"洞外扩 15px"的正像遮罩裁形，实机看是**一块白色六边形**，
 * 完全不像云。现在每格只放一朵、缩到 `TERRITORY_CLOUD_POCKET_SCALE`，保留"此处未解锁"的
 * 象征意义即可（第三轮：「不裁剪，只需要减少云朵数量，或者轻微缩小云朵的size」）。
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
        const cellId = stack.pop();
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
            const id = queue.pop();
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

/**
 * 要盖云的格：`sites` + `randomSites.candidateCells`（+ 起始格）。
 *
 * 口径（*「地图编辑器那都没有随机格子，就不要云了，配置没有的地方」*）：
 * 云不再"整张图铺满"，只有**配了内容的格位**盖云 —— 空白格位没有内容、也就永远不会解锁，
 * 盖上去的云永远散不掉，纯噪声。
 *
 * 每朵云只有格号与格心坐标（坐标 = 布局点，**未加 `HEX_GRID_CONTENT_LIFT`**，
 * 视图侧在 `sync` 里统一加）；`points` 缺该格时跳过（防御：布局永远与地图同源）。
 * 结果**去重 + 按 cellId 升序**（可复现；视图遍历顺序 = 渲染顺序）。
 */
export function territoryCloudCells(
    map: Pick<TerritoryMapConfig, 'sites' | 'randomSites' | 'startCellId'>,
    points: ReadonlyMap<number, HexGridPoint>,
): ITerritoryCloudCell[] {
    const out: ITerritoryCloudCell[] = [];
    const seen = new Set<number>();
    const add = (cellId: number): void => {
        if (seen.has(cellId)) return;
        const point = points.get(cellId);
        if (!point) return;
        seen.add(cellId);
        out.push({ cellId, x: point.x, y: point.y });
    };
    for (const site of map.sites) add(site.cellId);
    for (const cellId of map.randomSites?.candidateCells ?? []) add(cellId);
    add(map.startCellId);
    out.sort((a, b) => a.cellId - b.cellId);
    return out;
}
