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
 * | 2026-10-26 五版 | ① 铺满不再跳过格网内的空格（否则整条裸底图）；② 云洞按**整朵云含影子**收倍率（`0.74 → 0.60`）；③ y 偏移改成**按倍率算**（`territoryCloudArtOffsetY`），缩小时不再往下漂 |
 * | 2026-10-26 六版 | 消散从"瞬间换帧 + 淡出"升级成四段过渡：**整朵炸一下（放大 6%）→ 裂开（壳收到 0.84）→ 碎块炸开（1.15）+ 上飘 + 淡出**；`ITerritoryCloudDissolveFrame` 增加 `scale` / `liftY` / `shadowScale` / `shadowOpacity`，`index = -1` 表示"还没裂" |
 * | 2026-10-26 七版（本次） | 挡云遮罩的基准从**格面**换成**地块可见轮廓**（格面 + 下方 {@link HEX_GRID_TILE_SIDE_HEIGHT} 侧壁）—— 只按格面外扩时遮罩底边比图底还高 11px，云压在侧壁上（用户：「底部的云层也要和地块有 15px 的间隙」） |
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
 * | 解锁消散 | 四段：整朵炸一下 → `cloud_dissolve_body_0`（壳收到 0.84）→ `cloud_dissolve_body_1`（碎块炸到 1.15）+ 上飘 + 淡出（{@link territoryCloudDissolveFrame}） |
 * | 与地块的间隔 | 挡云遮罩：{@link territoryCloudKeepOutPoints}（**地块轮廓**外扩 {@link TERRITORY_CLOUD_KEEP_OUT_PX}） |
 *
 * ## 为什么要"外扩多边形"而不是"把云缩小"
 *
 * 一朵云 200×240，一格的脸才 123×90 —— 云**天生**盖到相邻格。所以"不遮挡地块"只能靠
 * **擦掉**（视图侧用 `Mask` 反向遮罩），擦除区 = 每个已解锁格的地块轮廓**外扩 15px**。
 * 外扩量必须是真的 15px，见 `territoryCloudKeepOutPoints` 的注释（按顶点等比放大会缩水到 ~7.5px）。
 *
 * ⚠️ 基准是**地块可见轮廓**（格面 + 下方 26px 侧壁），不是格面 —— 见 {@link territoryTileOutlinePoints}。
 *
 * ⚠️ 唯一的例外是**云洞**（被地块包围的未解锁格）：那里不擦、也不裁，靠
 * {@link TERRITORY_CLOUD_POCKET_SCALE} 把云缩小一点留出观感上的空隙（三版口径）。
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

/**
 * 消散总时长（秒）：整朵炸一下 → 裂成环 → 碎块散尽，全程伴随缩小与淡出。
 *
 * 0.5s 是刻意压短的 —— 云散开之后地皮还要由 `TerritoryHexSpawn`（0.4s）长出来，
 * 两者同帧起步，云停留太久会读成"点了没反应"。
 */
export const TERRITORY_CLOUD_DISSOLVE_SECONDS = 0.5;

/** 消散过程中**保持全不透明**的比例（0~1）；过了这一段才开始淡出。 */
export const TERRITORY_CLOUD_DISSOLVE_HOLD = 0.3;

/**
 * 消散起手「整朵炸一下」占的比例（0~1）—— 这一段**还没换消散帧**，用的仍是待机整朵图。
 *
 * 2026-10-26 六版：老口径第一帧就直接写 `cloud_dissolve_body_0`（中间已经裂出一个大洞的环），
 * 于是"整朵云 → 断掉的环"是一次**瞬间跳变**，看着不像过渡，像换了一张图。
 * 现在先让整朵云**放大 6% 再收**，把"炸开"的动作交给缩放，裂开才交给序列帧。
 */
export const TERRITORY_CLOUD_DISSOLVE_INTACT = 0.12;

/** 起手膨胀的峰值倍率（"炸开"那一下；≥1，大会晕、小看不见）。 */
export const TERRITORY_CLOUD_DISSOLVE_PUNCH = 1.06;

/**
 * 裂开段收尾的倍率：外壳"炸出洞"时收缩到的尺寸（< 1 = 在变小）。
 *
 * 这一段对应消散帧 0（中间已经裂出一个大洞的环）—— 壳在往回收，读"云朵快速变小"。
 */
export const TERRITORY_CLOUD_DISSOLVE_CRUSH_SCALE = 0.84;

/**
 * 碎块段收尾的倍率：碎片向外炸出去的峰值（> 1 = 在散开）。
 *
 * ⚠️ 这个数**大于 1** 不矛盾：消散帧 1 只有三小块碎屑（美术包围盒 75×152，整朵是 200×198），
 * 放大 1.15 之后碎块的可见范围仍只有整朵云的一半 —— 观感是"云炸开、碎片飞散"，
 * 而不是"整朵云涨大"。反过来若在这一段继续缩小，就变成"碎块往中间缩"，与"爆炸散开"相反。
 */
export const TERRITORY_CLOUD_DISSOLVE_BURST_SCALE = 1.15;

/**
 * 缩放**调头的分界**（裂开之后的进度比例，0~1）：这段之前收缩、之后炸开。
 *
 * `0.5` 故意对上"两帧序列的中点"——消散帧 1（碎块）接管的那一帧正好开始向外炸，
 * 帧与缩放同一拍，不会出现"先炸开再换图"的错位。以后美术给更多帧时这个数不用跟帧号绑定，
 * 它只是手感参数。
 */
export const TERRITORY_CLOUD_DISSOLVE_FRAGMENT = 0.5;

/**
 * 消散过程中云体**上飘**的距离（地图像素）；影子不跟着飘。
 *
 * 影子是贴在地面上的投影：云被炸散时它是留在原地的，只有云体往上走 ——
 * 体 / 影一分离，"散开"才有方向感（两个一起飘就只是"整体平移"）。
 */
export const TERRITORY_CLOUD_DISSOLVE_LIFT_PX = 12;

/**
 * 影子**消失得更早**（进度比例）：到这一刻影子已经全透明。
 *
 * 🔴 2026-10-26 六版（预览图看出来的）：云体和影子原来同一个透明度、一起淡到 100%，
 * 结果是最后那 0.2s 里**云已经只剩几缕、地上还挂着一大团灰影子**（像忘了清的一块脏）。
 * 物理上也说不通：云升起来、散掉，地上的投影只会先没。
 */
export const TERRITORY_CLOUD_DISSOLVE_SHADOW_GONE = 0.75;

/**
 * 影子在碎块段收到多小（不跟着向外炸）。
 *
 * 云体在碎块段是放大到 1.15（碎片向外飞），影子**反过来**收到 0.7 ——
 * 投影只会随着云变薄、升高而收缩。跟着放大就是"地上那团灰也炸开了"，一眼假。
 */
export const TERRITORY_CLOUD_DISSOLVE_SHADOW_SCALE = 0.7;

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
 * ## 为什么不能写成常数
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
 * 铺满层（`CloudFillLayer`）**退场**的时长（秒）—— 全解锁后整层雾淡到全透明。
 *
 * ## 为什么与消散同长（0.5s）
 *
 * 铺满层的退场起点 = "最后一个有内容的格被露出"的那一帧，而那一刻**最后一朵真实云**也开始散。
 * 两条时间轴同长 ⇒ 边界那圈雾与那朵云一起散尽，读起来是"整片雾退掉"；
 * 铺满层比消散长 ⇒ 云已经散完了地图上还挂着一层灰，比消散短 ⇒ 边界比中心先秃一块。
 *
 * ⚠️ 别写成"消完再淡"：那会让全解锁的画面上多出 0.5s 的"只有边界有雾"的空档。
 *
 * 2026-10-27 用户：「给铺满层挂 UIOpacity 走一条淡出时间轴」（此前是 `active = false` 瞬间没）。
 *
 * ⚠️ 这个数是**整条时间轴**的长度（最慢的那一朵刚好在它上面淡完），不是每一朵的时长 ——
 *    逐朵窗口见 {@link territoryCloudFillWaveWindow}（近端 0.55 倍、远端 1 倍，都压在它以内）。
 */
export const TERRITORY_CLOUD_FILL_FADE_SECONDS = 0.5;

/**
 * 「全解锁 ⇒ 云雾散场」的镜头演出分段（秒，2026-10-27 用户口径）：
 *
 * > 「优化云层消失效果，拉高摄像机，观看云层逐渐消失的过程，屏幕内囊括了所有地块，
 * >  云雾消失后重新拉进镜头，回到初始高度」
 *
 * | 段 | 时长 | 画面 |
 * | --- | --- | --- |
 * | 拉远 | {@link TERRITORY_CLOUD_DOLLY_OUT_SECONDS} 1.1s | 镜头抬高到「整张图入画」 |
 * | 淡出 | {@link TERRITORY_CLOUD_DOLLY_FADE_SECONDS} 2.0s | 铺满层在拉远视角里**慢慢**淡掉（逐朵错峰，见 {@link TERRITORY_CLOUD_FILL_WAVE_STAGGER}） |
 * | 拉回 | {@link TERRITORY_CLOUD_DOLLY_IN_SECONDS} 0.7s | 回到初始高度 |
 *
 * ⚠️ 淡出时长在这里**单独一份**，不写进 `TERRITORY_CLOUD_FILL_FADE_SECONDS`（0.5s）：
 *    那个 0.5 是"散场没人看"时的默认值，且刻意与最后一朵云的消散同长。
 *    进了演出就得放慢到能看清"逐渐消失"，两条时长各有各的约束，不能合并。
 *
 * 📌 2026-10-27 第二轮（用户）：「拉远 0.7s 改成 1.1s，雾淡阶段 1.4s 改成 2s」——
 *    拉远要抬得"看得清是在抬"，1.4s 里几百朵雾一起淡完太快、读不出"扩散"。
 *    总时长随之 2.8s → **3.8s**（`territoryCloudDollyTotalSeconds()`，别在这里写死）。
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
 * ⚠️ 四个都要 `Number.isFinite`：只判 `> 0` 的话 `Infinity` 视口会算出个"半倍率"，
 *    看着像正常值、实际是脏数据带进来的。
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
// 雾散的「扩散波」：靠近地块的先散、越远越慢（2026-10-27 第二轮）
// ============================================================
//
// 用户原话：「从靠近地块的云雾先消失，离地块远的消失的慢，形成一个消失扩散的视觉效果」。
//
// 老口径是**整层一个 `UIOpacity`** ⇒ 几百朵雾同一帧起淡、同一帧淡完，屏幕上是一层灰
// 整体变薄（读"调低了透明度"，不读"雾在退"）。现在按「这一朵到最近地块的距离」逐朵错峰：
//
// ```
// 距离  0（贴着地块） ────────────────────────→ 最远
// 起淡   0            ── 0.25 × 总时长 ──────→
// 时长   0.55 × 总时长 ──────────────────────→ 0.75 × 总时长
// 淡完   0.55 × 总时长 ──────────────────────→ 1.00 × 总时长
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
 * ⚠️ **必须小于** {@link TERRITORY_CLOUD_FILL_WAVE_SPREAD}：窗长 = 总时长 − 推迟 − 近端缺口 ×(1−波次)，
 *    推迟 ≥ 差距时窗长会随距离**变短**（远的反而淡得更快，方向就反了）。
 */
export const TERRITORY_CLOUD_FILL_WAVE_STAGGER = 0.25;

/**
 * 「这一朵雾离地块多远」→ 波次（`0` = 贴着地块、`1` = 最远的那朵）。纯函数。
 *
 * @param distance    到这朵雾**最近的地块格心**的距离（地图像素）
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
 * delay    = 波次 × STAGGER × 总时长
 * duration = 总时长 − delay − SPREAD × 总时长 × (1 − 波次)
 * ```
 *
 * 两端严格**收在整条时长以内**（远端 `delay + duration = 总时长`）—— 铺满层是按"整条时长走完"
 * 才 `active = false` 的，只要有一朵没淡完就被收起来，那朵就是"啪"一下没。
 *
 * @param order        波次（0~1，越界自动夹紧）
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
 * 🔴 2026-10-26：用户「底部的云层也要和地块有 15px 的间隙」。当时遮罩底边 = 格面底边 − 15，
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
 * ## 为什么不是"顶点按比例放大"
 *
 *  等比放大看着等价，实际不是：格面 123×90，顶点 `(61.5, 0)` 放大后到 `(76.5, 0)`（= +15 ✓），
 *  但斜边上的顶点 `(30.75, 45)` 只往外挪了 `(7.5, 15)` —— **垂直于斜边的距离只有 ~7.5px**，
 *  于是"15px 间隔"在斜边上缩水一半，视觉上云就贴着地块的上/下边缘了。
 *
 *  这里走**斜接（miter）**：每个顶点按相邻两条边的外法线求交，
 *  `p' = p + inset × (n₁ + n₂) / (1 + n₁·n₂)` ⇒ 每条边都精确外移 `inset`。
 *
 * 基准是 {@link territoryTileOutlinePoints}（格面 + 侧壁），**不是**格面 ——
 * 否则底部那 26px 侧壁会被当成空地，云贴上去（2026-10-26 那条）。
 *
 * @param inset 外扩量（像素）；非有限值退回 {@link TERRITORY_CLOUD_KEEP_OUT_PX}，
 *              负数 / 0 按 0 处理（= 正好贴着地块轮廓）。
 * @param outline 基准轮廓；**别在运行时传**（默认就是地块轮廓）。只有离线对照图会把它换成
 *               格面轮廓，用来画"旧口径长什么样"。
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

function clamp01(value: number): number {
    if (!(value > 0)) return 0;
    return value > 1 ? 1 : value;
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
 * ## 四段（2026-10-26 六版）
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
 * ## 0.60 是"整朵云刚好塞进洞里"算出来的（2026-10-26 修）
 *
 * 洞的可用空间 = 格面 + 四周 15px = **153×120**。
 * 老口径 0.74 是拿**云体**（200×120）算的 —— 漏掉了下面那块**地面投影**：
 * 整朵云其实是 `200×198`，0.74 时高 **147px**，比洞的 120 还高出 27px
 * ⇒ 云实实在在糊到上下相邻的地块上（用户 2026-10-26 截图红圈："被地块包围的云层太大"）。
 *
 * 现在按**整朵云**收：
 *  - 高：`198 × s ≤ 120` ⇒ `s ≤ 0.606`
 *  - 宽：`200 × s ≤ 153` ⇒ `s ≤ 0.765`
 *
 * 取两者的小值并留一点余量 ⇒ **0.60**（实机 118.8×120 正好落在洞 + 15px 里，一朵都不压地块）。
 *
 * 为什么不再往下缩：缩到"连透明边都不碰格面"要 0.45 倍，那个尺寸的云会变成一颗颗孤立的小白点，
 * 反而读不出"这里被雾盖着"。
 */
export const TERRITORY_CLOUD_POCKET_SCALE = 0.6;

/**
 * 「被地块包围的云洞」最多算几格。
 *
 * 为什么要封顶：判定用的是"未解锁格不连通到地图边缘"，刚进游戏时**整片未探索区**就是这种
 * 连通块 —— 不封顶会把半张图搬到 UI 之上。洞是"岛屿内部的小坑"，超过这个格数就不再特殊处理
 * （当普通未解锁区，照常被 15px 挡云区吃边）。
 */
export const TERRITORY_CLOUD_POCKET_MAX_CELLS = 8;

/**
 * 铺满内容层要补的**虚拟云格点**（覆盖整块背景，含格网内没有内容的空格）。
 *
 * 为什么不用"再铺一层云"：那会和真实格那层形成**两套密度**（重叠区更亮），边界一眼可见。
 * 这里直接把**同一张格网向外延伸**：行列号允许越界，坐标仍旧由 `hexGridViewPoint` 算
 * （它不校验范围）⇒ 延伸出来的点与真实格**同相位、同间距**，云连成一片、没有接缝。
 *
 * ## 🔴 2026-10-26：格网内**没有内容的空格**也必须盖云
 *
 * 老口径只铺"格网矩形之外"那圈（格内交给真实云层）。可真实云层只认 `sites` /
 * `randomSites.candidateCells` / 起始格 —— 章节图 20×20 / 400 格里只有 ~117 格配了内容，
 * 剩下那 280 多格既没内容云、又不在铺满范围内 ⇒ **一整条裸露的沙漠底图**
 * （用户 2026-10-26 截图左侧红框：「未解锁的地块没有云层遮挡，空了一块背景图」）。
 *
 * 现在改成：格网内的空格**照铺**，只跳过 {@link occupied}（= 已经由真实云层负责的格），
 * 免得同一处叠两朵。
 *
 * @param width  / @param height  内容层尺寸（`territoryMapContentSize`），矩形以 (0,0) 为中心
 * @param occupied 真实云层已经盖了哪些格（`territoryCloudCells` 的 cellId 集合）；不传 = 一格都不占
 * @returns 只留「云的包围盒与内容层矩形相交」的点
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
 * 2026-10-23 山猫口径（*「地图编辑器那都没有随机格子，就不要云了，配置没有的地方」*）：
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
