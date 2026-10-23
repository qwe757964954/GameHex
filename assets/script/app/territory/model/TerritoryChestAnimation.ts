/**
 * 章节宝箱开箱的**时间轴**（纯函数、零 `cc`）—— 三档共用一套骨架，参数表化。
 *
 * ## 来源
 *
 * `docs/章节地图动画实现规格.md`（按两段参考视频 30fps 逐帧拆解）§3「宝箱奖励三档」。
 * 那套规格是引擎无关的描述（Unity/DOTween 口径），本文件把它落成**纯函数 + 参数表**，
 * 视图（`view/TerritoryChestView`）只负责「每帧读这些数、写进节点」。
 *
 * ## 为什么不是 tween
 *
 * 与 `TerritoryHexFlip` / `TerritoryGainBurst` 同一套路（见 `AGENTS.md`「渲染幂等与纯函数时间轴」）：
 *  · `tween` 挂在池化节点上，回收后还会继续跑（规则 106 / 247 的老坑）；
 *  · 纯函数可以**单测**：三档时长、镜头倍率、光柱只在中档出现…这些是产品口径，
 *    不该只靠"看一遍动画"验收。
 *
 * 所以：模型给「t=1.23s 时宝箱第 3 帧、白光 0.31、光柱 0.9、收尾系数 1」这样的**结果**，
 * 视图逐帧写节点；节点被复用/回收时把 `elapsed` 置 -1 即可，没有要销毁的定时器。
 *
 * ## 三档的一句话差异（规格 §3.4）
 *
 * | 维度 | 弱 | 中 | 强 |
 * | --- | --- | --- | --- |
 * | 镜头 | 开盖时轻推 **1.06×**（无暗角） | 开盖时轻推 **1.10×**（无暗角） | 入场即推 2.3× + 暗角，结束拉回 |
 * | 全屏光柱 | 无 | 有（贯穿屏幕） | 无直柱，改彩虹旋转光束 |
 * | 粒子 | 无 | 金币喷泉 + 彩色星光 | 更密 + 拖尾 + twinkle |
 * | 时长 | 2.26s | 2.38s | 3.23s |
 *
 * ⚠️ 时长**不是**参考视频里量到的 3.0 / 2.6 / 4.0，而是「最后一枚奖励落袋 + `settleSeconds`
 *   + `fadeOutSeconds`」（见 {@link territoryChestEndSeconds}）。2026-10-22 实机反馈
 *   「获取奖励后快速消失，现在停止的时间太长了」—— 参考视频那三个数里各有一段
 *   0.67 / 0.30 / 0.83s 的「开着的空箱子静置」，播放起来读作卡顿。想找回原节奏只调
 *   `settleSeconds`（一个数），别再去改 `totalSeconds`：那会重新引入空转。
 *
 * ⚠️ 弱档的禁止项是「**全屏遮罩 + 粒子雨 + 2.3× 怼脸推镜**」，不是「镜头不许动」——
 *   2026-10-22 用户要求「宝箱打开时，增加镜头轻微推进动画效果」，弱 / 中档因此各加了
 *   6% / 10% 的轻推进（暗角仍为 0）。单测钉的是**幅度上限**（≤1.12）与**无暗角**，
 *   以及光柱 / 彩虹 / 粒子仍然恒 `null`。
 */

import { TERRITORY_CHEST_TIER, type TerritoryChestTier } from './TerritoryChestTier';

/**
 * 「开盖」一段用几张补帧图（= 美术目录里 `chest_seq_0 … chest_seq_N-1` 的张数）。
 *
 *  三档共用同一套帧（箱子是同一只），差别只在 `lidSeconds`（切帧快慢）。
 *  ⚠️ 改这里必须同步 `tools/gen_chest_open_frames.py` 的 `STEPS` 张数，否则视图会取到空帧。
 */
export const TERRITORY_CHEST_OPEN_FRAMES = 6;

/**
 * 补帧美术的**几何口径**（`chest_seq_0 … chest_seq_5`，六张同画布）。
 *
 * ## 为什么需要这张表
 *
 * 表演里那只箱子必须和**地图格子上静止的那只**一样大、摆在同一处 —— 否则点击的瞬间
 * 能看出「换了个箱子」（2026-10-22 用户口径：「动画的节点大小需要与原宝箱静止状态的大小相近
 * （可以轻微的放大），坐标点保持一致不要有明显的偏移」）。
 *
 * 但补帧图是 `trimType: "none"` 导入的（理由见 `docs/章节地图动画与点击反馈实现说明.md` §3.3：
 * 每帧 alpha 包围盒都不一样，裁了会让一开盖整体缩小 + 左右跳），运行时 `frame.rect`
 * **恒等于整块画布** ⇒ 引擎那边**拿不到可见区**，只能把实测值写在这里。
 *
 * ## 数字怎么来的
 *
 * `chest_seq_0.png`（闭合态）的 alpha 包围盒，**画布坐标系、原点在左下**：
 * 画布 `142×156`，箱子占 `x ∈ [2,140]`、`y ∈ [2,112]`。
 *
 *  ⚠️ 画布上方那 `44px` 是**留给箱盖张开的**（第 5 帧顶到 `y=154`），所以画布中心比闭合箱子的
 *    视觉中心高 `21px`（`78 - 57`）。不补这 21px，箱子会**沉进格子里小半个身位** ——
 *    这正是「坐标点有明显偏移」的来源。
 *
 *  ⚠️ 换美术必须重新量：`tests/territory-chest-placement.test.ts` 会自己解 PNG 的 alpha
 *    重算一遍包围盒来比对这些数字，对不上直接红。
 */
export interface ITerritoryChestArtMetrics {
    readonly canvasWidth: number;
    readonly canvasHeight: number;
    /** 闭合态可见区左边界（画布像素，含）。 */
    readonly closedLeft: number;
    /** 闭合态可见区下边界（画布像素，含）。六帧都从同一条底边起 ⇒ 箱体不会上下跳。 */
    readonly closedBottom: number;
    readonly closedWidth: number;
    readonly closedHeight: number;
}

/** 见 {@link ITerritoryChestArtMetrics}（实测值）。 */
export const TERRITORY_CHEST_ART_METRICS: ITerritoryChestArtMetrics = {
    canvasWidth: 142,
    canvasHeight: 156,
    closedLeft: 2,
    closedBottom: 2,
    closedWidth: 138,
    closedHeight: 110,
};

/** 宝箱「画布 → 世界」的落位（视图照抄，不在视图里算几何）。 */
export interface ITerritoryChestPlacement {
    /** `ChestArt` 的基准缩放：让**闭合态可见宽**等于目标宽。 */
    readonly scale: number;
    /** 可见区中心相对画布中心的偏移（屏幕像素）—— 写位置时**加上**它，可见区就落在原点上。 */
    readonly offsetX: number;
    readonly offsetY: number;
}

/**
 * 把「闭合态可见宽 = `targetWidth`」翻译成**缩放 + 落位补偿**。
 *
 *  推一遍就明白：画布中心与可见区中心差 `(dx, dy)` 画布像素，乘上缩放就是屏幕像素；
 *  节点摆在 `原点 + (dx, dy) × scale`，可见区中心才回到原点。
 *  （`dy = canvasHeight/2 - (closedBottom + closedHeight/2)`，闭合态是 `78 - 57 = 21`，
 *   即**节点要比原点高 21×scale**，把箱子从画布中心"提"回视觉中心。）
 *
 * @param targetWidth 目标可见宽（像素）。表演里取**地图上静止宝箱的可见宽**
 *   （`TerritoryStationView` 的 `BUILDING_VISIBLE_WIDTH`），这样两边严丝合缝。
 * @param canvasWidth 实际帧的画布宽（`frame.rect.width`，运行期真值）。
 * @param canvasHeight 同上，高。
 *   画布尺寸从帧里读而不是直接用表里的值：换图改了画布，宽度归一依然算得对，
 *   只是表要跟着重测（测试会红，不会静默跑偏）。
 */
export function territoryChestPlacement(
    metrics: ITerritoryChestArtMetrics,
    targetWidth: number,
    canvasWidth: number,
    canvasHeight: number,
): ITerritoryChestPlacement {
    const closedWidth = metrics.closedWidth > 0 ? metrics.closedWidth : Math.max(1, canvasWidth);
    const scale = Number.isFinite(targetWidth) && targetWidth > 0 ? targetWidth / closedWidth : 1;
    const centeredX = canvasWidth / 2 - (metrics.closedLeft + closedWidth / 2);
    const centeredY = canvasHeight / 2 - (metrics.closedBottom + metrics.closedHeight / 2);
    return {
        scale,
        offsetX: Number.isFinite(centeredX) ? centeredX * scale : 0,
        offsetY: Number.isFinite(centeredY) ? centeredY * scale : 0,
    };
}

/** 三档的全部可调参数（一个档一份，视图不写任何时间常量）。 */
export interface ITerritoryChestSpec {
    readonly tier: TerritoryChestTier;
    /** 整段表现的总时长（秒）；到点强制收尾。 */
    readonly totalSeconds: number;

    // ── 宝箱本体 ──────────────────────────────────────────
    /** 宝箱弹出（`0 → 1.15 → 1`）的相对起点与时长。 */
    readonly popStart: number;
    readonly popSeconds: number;
    /** 蓄力（下压 / 上下浮动）的相对起点与时长。 */
    readonly chargeStart: number;
    readonly chargeSeconds: number;
    /** 蓄力期的上下浮动幅度（像素）；弱档是「下压」不走这条。 */
    readonly chargeFloatPx: number;
    /** 蓄力期的下压量（`scaleY`，弱档 0.96）。 */
    readonly chargeSquashY: number;
    /** 箱盖弹开的起点 / 时长 / **补帧张数**。 */
    readonly lidStart: number;
    readonly lidSeconds: number;
    /**
     * 「开盖」这段用几张图（≥2）。
     *
     *  ⚠️ 2026-10-22 起箱盖不再靠**旋转分片**演，而是**换帧**：手上同时有「闭合」与「开盖」
     *  两张美术（同一只箱子、同一视角），中间帧由 `tools/gen_chest_open_frames.py` 烘焙好
     *  （箱盖绕接缝纵向长出 + 闭合盖淡出），视图按 `territoryChestOpenFrame` 取第几张。
     *  只在 `lidStart ~ lidStart + lidSeconds` 这段换帧，之后恒停最后一张（全开）。
     */
    readonly openFrames: number;

    // ── 开箱光效 ──────────────────────────────────────────
    /** 白光爆闪的起点 / 时长 / 峰值不透明度。 */
    readonly flashStart: number;
    readonly flashSeconds: number;
    readonly flashPeak: number;
    /** 金色放射光条的起点 / 时长 / 条数。 */
    readonly rayStart: number;
    readonly raySeconds: number;
    readonly rayCount: number;

    // ── 全屏元素（弱档全 0 / 1） ──────────────────────────
    /** 光柱：`beamSeconds = 0` ⇒ 本档没有光柱。 */
    readonly beamStart: number;
    readonly beamDownSeconds: number;
    readonly beamHoldSeconds: number;
    readonly beamFadeSeconds: number;
    /** 彩虹光束的起点 / 终点（`rainbowEnd <= rainbowStart` ⇒ 没有）。 */
    readonly rainbowStart: number;
    readonly rainbowEnd: number;
    /** 彩虹整体转速（度/秒）。 */
    readonly rainbowSpinDegPerSecond: number;
    /**
     * 镜头推近倍率；`1` ⇒ 不推镜。
     *
     * ## 三档都有，只是幅度不同（2026-10-22 用户：「宝箱打开时，增加镜头轻微推进动画效果」）
     *
     * | 档 | `cameraZoom` | 起手 | 到位 |
     * | --- | --- | --- | --- |
     * | 弱 | **1.06** | 开盖瞬间（`lidStart`） | 开盖结束（+`lidSeconds`） |
     * | 中 | **1.10** | 同上 | 同上 |
     * | 强 | 2.3 | 入场即推（0s） | 0.30s |
     *
     * 弱 / 中的推进**刻意只做 6% / 10%**：弱档没有全屏遮罩、也没有粒子承担"重点"，纯靠镜头上一点
     * 就能把"这一下是开箱"读出来；幅度再大就会让人觉得视野在抖（那正是规格把"弱档推镜"列为
     * 禁止项的原因 —— 禁的是**强档那种 2.3× 怼脸 + 压暗**，不是"镜头完全不能动"）。
     * 暗角仍然是 0：轻推进 + 无遮罩，观感仍是"地块原位完成"。
     */
    readonly cameraZoom: number;
    /**
     * 推近的起点 / 时长（秒）。
     *
     * 弱 / 中档取 `lidStart` 起、与 `lidSeconds` 同长 ⇒ **箱盖张开的同时镜头跟上**，
     * 开盖读完也就推到位（不是"点一下就怼上来"）。
     */
    readonly cameraInStart: number;
    readonly cameraInSeconds: number;
    /**
     * 拉回的起点 / 时长（秒）。
     *
     * 一律与**收尾起点**对齐（`cameraOutStart = territoryChestFadeStart`、
     * `cameraOutSeconds = fadeOutSeconds`）⇒ 镜头回到 1.0 的那一帧宝箱正好淡完，
     * 不会出现「镜头还怼着、箱子已经没了」或者「箱子淡完了还在原地推拉」。
     */
    readonly cameraOutStart: number;
    readonly cameraOutSeconds: number;
    /** 暗角峰值不透明度；`0` ⇒ 不压暗。 */
    readonly vignetteAlpha: number;
    readonly vignetteSeconds: number;

    // ── 粒子 ─────────────────────────────────────────────
    /** 喷泉（有重力的资源图标）：起点 / 窗口 / 数量。`fountainCount = 0` ⇒ 没有。 */
    readonly fountainStart: number;
    readonly fountainSeconds: number;
    readonly fountainCount: number;
    /** 星光（无重力、纯装饰）：起点 / 窗口 / 数量。 */
    readonly starStart: number;
    readonly starSeconds: number;
    readonly starCount: number;

    // ── 奖励飞向栏位 ──────────────────────────────────────
    /** 飞向顶部栏的起点 / 单枚时长 / 最多几枚。 */
    readonly flyStart: number;
    readonly flySeconds: number;
    readonly flyCount: number;

    // ── 收尾 ──────────────────────────────────────────────
    /**
     * **收尾淡出**的时长（秒），从 {@link territoryChestFadeStart} 开始（不是手填的
     * `totalSeconds - fadeOutSeconds`——那个算式正是 2026-10-22「停太久」的来源）。
     *
     *  这段时间里**宝箱本体与它周围的光效一起**淡到 0（需求 2026-10-22 §2
     *  「奖励光效和宝箱消失同步关闭」）。
     *
     *  ⚠️ 为什么必须统一乘一个系数，而不是各自窗口到点就消失：
     *   放射光条 / 白光 / 光柱 / 喷泉的窗口长短不一，宝箱却要留到最后 ——
     *   不统一收尾就会出现「光都没了，一只宝箱还杵在那儿」或者相反的「宝箱先没了、光还在」。
     *   一个乘子把两者钉在同一条时间线上。
     */
    readonly fadeOutSeconds: number;

    /**
     * **最后一枚奖励落袋之后，再停留多久开始收尾**（秒）。
     *
     * ## 为什么要单独一个字段（2026-10-22 用户口径）
     *
     * 用户：「宝箱打开后，获取奖励后快速消失，现在停止的时间太长了」。
     *
     * 老口径把收尾钉在 `totalSeconds - fadeOutSeconds`：那个数**与奖励飞完的时刻无关**，
     * 于是两者的差就是一段纯空转 —— 实机实测「开着的空箱子」静置：
     *
     * | 档 | 末枚落袋 | 老收尾起点 | 空转 |
     * | --- | --- | --- | --- |
     * | 弱 | 1.78s | 2.45s | **0.67s** |
     * | 中 | 1.90s | 2.20s | 0.30s |
     * | 强 | 2.67s | 3.50s | **0.83s** |
     *
     * 现在收尾起点 = 末枚落袋 + 本字段 ⇒ 空转**永远是这么一个常数**，
     * 无论以后把奖励改成几枚、飞多快，都不会再"飘"出一段静止。
     * 想让它多喘一口 / 更催人，只调这一个数（`0.10` 极快 · `0.25` 明显停留）。
     */
    readonly settleSeconds: number;
}

/**
 * 三档参数表。
 *
 * ⚠️ 改这里等于改动画本身：`totalSeconds` 与各 `*Start` 必须仍在区间内，
 *   否则会出现「开盖发生在收尾之后」这种不报错但明显穿帮的时序
 *   （单测 `territory-chest-animation` 有一条时序单调性用例挡着）。
 *
 * ⚠️ `totalSeconds` 不是随手填的整数，它等于
 *   `末枚奖励落袋 + settleSeconds + fadeOutSeconds`（见 {@link territoryChestEndSeconds}）。
 *   单测会逐档比对这三者，填歪了直接红 —— 因为这三个数一旦不同步，
 *   屏幕上就多出一段「开着的空箱子静置」（2026-10-22 用户：「停止的时间太长了」）。
 */
export const TERRITORY_CHEST_SPECS: Readonly<Record<TerritoryChestTier, ITerritoryChestSpec>> = {
    /** 弱档：地块原位完成，≈2.3s，镜头轻推 1.06×，**无全屏遮罩 / 无粒子雨**。 */
    [TERRITORY_CHEST_TIER.weak]: {
        tier: TERRITORY_CHEST_TIER.weak,
        // 末枚落袋 1.78 + 0.16 + 0.32（老值 3.0：末枚落袋后还静置 0.67s 才动手）
        totalSeconds: 2.26,
        popStart: 0,
        popSeconds: 0.25,
        chargeStart: 0.25,
        chargeSeconds: 0.10,
        chargeFloatPx: 0,
        chargeSquashY: 0.96,
        // 2026-10-22：0.15s → 0.42s。6 张补帧平摊 70ms/张才读得出「闭合 → 半开 → 全开」，
        // 原来的 25ms/张 等价于 40fps 闪过，肉眼看就是「箱子直接变成开盖图」。
        lidStart: 0.35,
        lidSeconds: 0.42,
        openFrames: TERRITORY_CHEST_OPEN_FRAMES,
        // 白光落在**箱盖张开的瞬间**（= lid 结束），与开盖同一帧炸开。
        flashStart: 0.77,
        flashSeconds: 0.10,
        flashPeak: 0.9,
        rayStart: 0.35,
        raySeconds: 0.55,
        rayCount: 10,
        beamStart: 0,
        beamDownSeconds: 0,
        beamHoldSeconds: 0,
        beamFadeSeconds: 0,
        rainbowStart: 0,
        rainbowEnd: 0,
        rainbowSpinDegPerSecond: 0,
        // 轻微推进：只在「开盖」这一段做 6%，与箱盖同步到位（2026-10-22 用户要求）。
        // 暗角仍为 0 —— 弱档不许有全屏遮罩，禁的是"怼脸 + 压暗"，不是"镜头不能动"。
        cameraZoom: 1.06,
        cameraInStart: 0.35,
        cameraInSeconds: 0.42,
        cameraOutStart: 1.94,
        cameraOutSeconds: 0.32,
        vignetteAlpha: 0,
        vignetteSeconds: 0,
        // 弱档不许有粒子（禁止项）：「奖励生成动画」由飞出的 4 枚图标承担，紧跟白光。
        fountainStart: 0,
        fountainSeconds: 0,
        fountainCount: 0,
        starStart: 0,
        starSeconds: 0,
        starCount: 0,
        flyStart: 0.80,
        flySeconds: 0.80,
        flyCount: 4,
        fadeOutSeconds: 0.32,
        settleSeconds: 0.16,
    },
    /** 中档：光柱贯穿屏幕 + 白光中爆点 + 金币喷泉 + 彩色星光，≈2.4s，镜头轻推 1.10×。 */
    [TERRITORY_CHEST_TIER.medium]: {
        tier: TERRITORY_CHEST_TIER.medium,
        // 末枚落袋 1.90 + 0.18 + 0.30（老值 2.6：静置 0.30s）
        totalSeconds: 2.38,
        popStart: 0,
        popSeconds: 0.25,
        chargeStart: 0.25,
        chargeSeconds: 0.20,
        chargeFloatPx: 8,
        chargeSquashY: 1,
        lidStart: 0.45,
        lidSeconds: 0.42,
        openFrames: TERRITORY_CHEST_OPEN_FRAMES,
        flashStart: 0.87,
        flashSeconds: 0.15,
        flashPeak: 1,
        rayStart: 0.45,
        raySeconds: 0.45,
        rayCount: 12,
        beamStart: 0.45,
        beamDownSeconds: 0.20,
        beamHoldSeconds: 0.50,
        beamFadeSeconds: 0.15,
        rainbowStart: 0,
        rainbowEnd: 0,
        rainbowSpinDegPerSecond: 0,
        // 同上，幅度稍大一档（10%）：中档有光柱，镜头跟一点会让光柱显得更"打下来"。
        // 仍然没有暗角 —— 全屏压暗是强档的独占项。
        cameraZoom: 1.10,
        cameraInStart: 0.45,
        cameraInSeconds: 0.42,
        cameraOutStart: 2.08,
        cameraOutSeconds: 0.30,
        vignetteAlpha: 0,
        vignetteSeconds: 0,
        // 粒子与开盖**同一时刻**起（需求 2026-10-22 §1「同时播放奖励生成动画」）：
        // 原来 1.20s 起，箱盖 0.80s 就开完了 ⇒ 有 0.4s 是「开着的空箱子」，读作延迟。
        fountainStart: 0.45,
        fountainSeconds: 1.30,
        fountainCount: 30,
        starStart: 0.45,
        starSeconds: 1.40,
        starCount: 40,
        // ⚠️ 末枚必须落在收尾之前：`flyStart + 0.06×(count-1) + flySeconds ≤ fadeStart`
        //   （原来是 2.0/0.6，末枚到 2.9s —— 会被总时长硬切，最后两枚「飞一半消失」）。
        flyStart: 1.05,
        flySeconds: 0.55,
        flyCount: 6,
        fadeOutSeconds: 0.30,
        settleSeconds: 0.18,
    },
    /** 强档：镜头拉近 2.3x + 暗角 + 彩虹旋转光束 + 高密度奖励，≈3.2s。 */
    [TERRITORY_CHEST_TIER.strong]: {
        tier: TERRITORY_CHEST_TIER.strong,
        // 末枚落袋 2.67 + 0.22 + 0.34（老值 4.0：静置 0.83s，镜头还一直怼着空箱子）
        totalSeconds: 3.23,
        popStart: 0.30,
        popSeconds: 0.20,
        chargeStart: 0.50,
        chargeSeconds: 0.20,
        chargeFloatPx: 6,
        chargeSquashY: 1,
        lidStart: 0.70,
        lidSeconds: 0.48,
        openFrames: TERRITORY_CHEST_OPEN_FRAMES,
        flashStart: 1.18,
        flashSeconds: 0.12,
        flashPeak: 1,
        rayStart: 0.70,
        raySeconds: 0.50,
        rayCount: 16,
        beamStart: 0,
        beamDownSeconds: 0,
        beamHoldSeconds: 0,
        beamFadeSeconds: 0,
        rainbowStart: 1.18,
        // 彩虹收到收尾起点（2.89）为止 —— 与镜头回拉、淡出同一条线，不留空转
        rainbowEnd: 2.89,
        rainbowSpinDegPerSecond: 30,
        cameraZoom: 2.3,
        cameraInStart: 0,
        cameraInSeconds: 0.30,
        // 回拉与淡出同起同落：镜头拉回 1.0 的那一刻，宝箱已经淡完
        cameraOutStart: 2.89,
        cameraOutSeconds: 0.34,
        vignetteAlpha: 0.55,
        vignetteSeconds: 0.25,
        // 与中档同口径：开盖那一瞬就开始喷（原来 1.20，卡在箱盖开完之后）。
        fountainStart: 0.70,
        fountainSeconds: 1.50,
        fountainCount: 34,
        starStart: 0.70,
        starSeconds: 1.50,
        starCount: 48,
        flyStart: 1.35,
        flySeconds: 0.90,
        flyCount: 8,
        fadeOutSeconds: 0.34,
        settleSeconds: 0.22,
    },
};

// ============================================================
// 收尾时序（末尾这段**全部由「最后一枚奖励落袋」推出来**，不再手填）
// ============================================================

/**
 * 奖励飞行的错峰间隔（秒）：第 `i` 枚比第 0 枚晚 `i × 这个值` 起飞。
 *
 *  `territoryChestFlyFx` 用它排起飞时刻，{@link territoryChestLastRewardAt} 用它算末枚落地
 *  —— 两处必须是同一个数，所以抽成常量（以前是两处各写一个 `0.06`）。
 */
export const TERRITORY_CHEST_FLY_STAGGER = 0.06;

/**
 * **最后一枚奖励落袋的时刻**（秒）。
 *
 *  这就是「获取奖励」这个事件在时间轴上的位置，也是收尾唯一的锚点：
 *  玩家看到最后一枚图标飞走之后，屏幕上还能留多久，全部由它决定。
 *
 *  ⚠️ 没有奖励飞行（`flyCount = 0` / 飞行为 0 时长）时退化成「总时长减去尾巴」：
 *   那种档位没有"落袋"这一刻，收尾只能照旧从末尾倒推。
 */
export function territoryChestLastRewardAt(spec: ITerritoryChestSpec): number {
    if (!(spec.flyCount > 0) || !(spec.flySeconds > 0)) {
        return Math.max(0, spec.totalSeconds - spec.fadeOutSeconds - spec.settleSeconds);
    }
    // 第 `count-1` 枚的起飞时刻 + 它飞完所用的时间
    return spec.flyStart + TERRITORY_CHEST_FLY_STAGGER * (spec.flyCount - 1) + spec.flySeconds;
}

/**
 * **收尾淡出的起点**（秒）—— `最后一枚奖励落袋 + settleSeconds`。
 *
 *  ⚠️ 与 `totalSeconds` 取小是**保险**不是主逻辑：参数表若被人把 `totalSeconds` 调大
 *   （想"多演一会"），收尾仍然会贴着奖励走 —— 多出来的那段时间没人看见，
 *   因为 {@link territoryChestEndSeconds} 也跟着缩了。想真的拖长，调 `settleSeconds`。
 */
export function territoryChestFadeStart(spec: ITerritoryChestSpec): number {
    if (!(spec.fadeOutSeconds > 0)) return spec.totalSeconds;
    const want = territoryChestLastRewardAt(spec) + Math.max(0, spec.settleSeconds);
    const cap = spec.totalSeconds - spec.fadeOutSeconds;
    const start = Math.min(want, cap);
    return Number.isFinite(start) ? Math.max(0, start) : 0;
}

/**
 * **整段表演真正的结束时刻**（秒）—— 视图按它停播（不是 `totalSeconds`）。
 *
 *  正常参数下三者相等：`totalSeconds = 末枚落袋 + settleSeconds + fadeOutSeconds`
 *  （单测逐档比对，填歪直接红）。
 *  等式的意义在于：**屏幕上永远不会有「奖励已经拿完、箱子还开着杵在那儿」的空白**，
 *  2026-10-22 用户反馈的「停止的时间太长了」就是这段空白（老弱档 0.67s / 强档 0.83s）。
 */
export function territoryChestEndSeconds(spec: ITerritoryChestSpec): number {
    if (!(spec.fadeOutSeconds > 0)) return spec.totalSeconds;
    const end = territoryChestFadeStart(spec) + spec.fadeOutSeconds;
    return Number.isFinite(end) ? Math.min(spec.totalSeconds, end) : spec.totalSeconds;
}

// ============================================================
// 缓动
// ============================================================

/** `0..1` 夹紧（脏 `t` 不产出 NaN 几何）。 */
function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * 窗口端点的浮点容差。
 *
 * `0.47 - 0.37` 在 IEEE754 下是 `0.09999999999999998`，除以 0.1 得 `0.9999999999999998` ——
 * 于是「窗口最后一帧」会落在区间**内**，收尾值变成 `2e-16` 而不是 0：
 * 白光会留一丝白、飞行图标会多播一帧、`stop()` 前多写一次位置。
 * 这类残值肉眼看不见，但单测没法钉（`assert.equal(x, 0)` 直接挂），
 * 所以端点判定统一走这个容差 —— 窗口末尾一律当成 `1` / 已结束。
 */
const PHASE_EPSILON = 1e-9;

/** 区间进度：`t` 在 `[start, start+seconds)` 内返回 `0..1`，区间外 `null`。 */
function phase(t: number, start: number, seconds: number): number | null {
    if (!(seconds > 0)) return null;
    if (t < start) return null;
    const local = (t - start) / seconds;
    if (local >= 1 - PHASE_EPSILON) return 1;
    return local < 0 ? 0 : local;
}

function easeOutCubic(p: number): number {
    const x = clamp01(p);
    return 1 - (1 - x) * (1 - x) * (1 - x);
}

function easeInQuad(p: number): number {
    const x = clamp01(p);
    return x * x;
}

/**
 * `SpringPop` —— `0 → overshoot → 1`（规格 §0.1「scale 0→1.15→1.0，0.25s」）。
 *
 * ⚠️ 不用 `Back.easeOut` 的解析式：那条曲线的**峰值由 s 隐式决定**（s 是"过冲强度"而不是
 *   "峰值倍率"），写 `1.15` 进去实际只冲到 1.02 —— 视觉上"弹"不出来。
 *   这里改成**两段显式曲线**：前 65% 从 0 涨到 `overshoot`（`EaseOutCubic`），
 *   后 35% 从 `overshoot` 落回 1。峰值**恒等于参数**，写 1.15 就是 1.15，改参所见即所得。
 */
function springPop(p: number, overshoot: number): number {
    const x = clamp01(p);
    const rise = 0.65;
    if (x < rise) return overshoot * easeOutCubic(x / rise);
    return overshoot + (1 - overshoot) * easeOutCubic((x - rise) / (1 - rise));
}

// ============================================================
// 宝箱本体
// ============================================================

/** 宝箱本体某一帧的姿态（全部相对「落位后的基准」）。 */
export interface ITerritoryChestBodyFx {
    /** 整体缩放（弹出 `0→1.15→1`；蓄力在此基础上叠 `chargeSquashY`）。 */
    readonly scale: number;
    /** 纵向缩放倍率（蓄力下压 / 浮动不影响它，单列出来是为了写节点时一眼看清）。 */
    readonly scaleY: number;
    /** 相对落点的纵向偏移（像素，向上为正）—— 蓄力浮动。 */
    readonly offsetY: number;
    /** 是否已经「出场」（`false` 时视图应把宝箱整个藏起来）。 */
    readonly visible: boolean;
}

/** 弹出动画的**峰值缩放**（规格 §0.1 `SpringPop`：`0 → 1.15 → 1`）。 */
export const TERRITORY_CHEST_POP_OVERSHOOT = 1.15;

/**
 * 宝箱本体在 `t` 秒时的姿态。
 *
 * 阶段：`popStart` 弹出（SpringPop）→ `chargeStart` 蓄力（弱档下压 / 中强档浮动）。
 *
 * ⚠️ 箱盖的「张开」不在这里 —— 它走**换帧**（见 {@link territoryChestOpenFrame}）：
 *   两张美术（闭合 / 开盖）之间没有可插值的姿态参数，只有一张张成品图。
 */
export function territoryChestBodyFx(spec: ITerritoryChestSpec, t: number): ITerritoryChestBodyFx {
    if (!Number.isFinite(t) || t < spec.popStart) {
        return { scale: 0, scaleY: 1, offsetY: 0, visible: false };
    }
    const pop = phase(t, spec.popStart, spec.popSeconds);
    // 弹出：`backOut` 从 0 起、峰值约 1.15、落回 1。`visible` 由出场即真。
    const popScale = pop === null ? 0 : springPop(pop, TERRITORY_CHEST_POP_OVERSHOOT);
    let scaleY = 1;
    let offsetY = 0;
    const charge = phase(t, spec.chargeStart, spec.chargeSeconds);
    if (charge !== null && charge < 1) {
        // 蓄力：先压/浮到极值再回位（`sin(π·p)` 一个完整来回，两端都是 0）
        const swing = Math.sin(Math.PI * charge);
        offsetY = spec.chargeFloatPx * swing;
        scaleY = 1 + (spec.chargeSquashY - 1) * swing;
    }
    return { scale: Math.max(0, popScale), scaleY, offsetY, visible: true };
}

/**
 * 「开盖」这一段该显示第几张补帧图（`0` = 完全闭合，`openFrames - 1` = 完全开盖）。
 *
 *  · `lidStart` 之前 → `0`（闭合，与地图格子上那张宝箱图一致，接得上）；
 *  · `lidStart ~ lidStart + lidSeconds` 内 → 按进度线性切帧；
 *  · 之后 → 恒停最后一张（全开）。
 *
 * ⚠️ 时间线外**不返回 `null`**：宝箱始终得有一张图在屏幕上，
 *   「不显示」这件事由 `territoryChestBodyFx().visible` 表达。两者分工不同，别混。
 */
export function territoryChestOpenFrame(spec: ITerritoryChestSpec, t: number): number {
    const total = Math.max(1, Math.floor(spec.openFrames) || 1);
    if (!Number.isFinite(t) || t < spec.lidStart) return 0;
    const p = phase(t, spec.lidStart, spec.lidSeconds);
    if (p === null) return 0;
    const index = Math.floor(p * total);
    return index < 0 ? 0 : index > total - 1 ? total - 1 : index;
}

/**
 * **收尾淡出系数**（`1` = 不淡，`0` = 完全消失）。
 *
 * 窗口是 `[fadeStart, fadeStart + fadeOutSeconds)`，`fadeStart` 由
 * {@link territoryChestFadeStart} 从「最后一枚奖励落袋」推出来 —— **不是**
 * `totalSeconds - fadeOutSeconds`。以前那样写，奖励飞完到收尾之间会留下一段
 * 「开着的空箱子静置」，2026-10-22 用户读作「停止的时间太长了」。
 *
 * 宝箱本体、光柱、彩虹、放射光条、白光、箱口光晕、喷泉 / 星光、飞出图标**全部**乘这个系数
 * —— 这样整段表演只可能「一起亮、一起灭」，不会出现
 * 「光效窗口走完了、宝箱还杵着」（需求 2026-10-22 §2「奖励光效和宝箱消失同步关闭」）。
 *
 *  ⚠️ 系数走 `EaseInCubic` 的**反向**（前段慢、越到后面灭得越快）：
 *   收尾要让"最后一下"干净，慢慢淡会拖出一个灰印子。
 */
export function territoryChestTailFade(spec: ITerritoryChestSpec, t: number): number {
    const seconds = spec.fadeOutSeconds;
    if (!(seconds > 0)) return 1;
    if (!Number.isFinite(t)) return 0;
    const start = territoryChestFadeStart(spec);
    const end = start + seconds;
    if (t <= start) return 1;
    if (t >= end) return 0;
    const p = (t - start) / seconds;
    return 1 - p * p * p;
}

// ============================================================
// 开箱光效
// ============================================================

/** 白光爆闪的不透明度（`0` = 不画）。 */
export function territoryChestFlashAlpha(spec: ITerritoryChestSpec, t: number): number {
    const local = phase(t, spec.flashStart, spec.flashSeconds);
    if (local === null) return 0;
    // 起手就是峰值（爆闪要「炸」出来），然后线性收到 0。
    return spec.flashPeak * (1 - local);
}

/** 金色放射光条的缩放与不透明度；`null` = 这一帧不画。 */
export interface ITerritoryChestRayFx {
    readonly scale: number;
    readonly alpha: number;
}

export function territoryChestRayFx(spec: ITerritoryChestSpec, t: number): ITerritoryChestRayFx | null {
    const local = phase(t, spec.rayStart, spec.raySeconds);
    if (local === null) return null;
    const eased = easeOutCubic(local);
    return { scale: 0.5 + 0.9 * eased, alpha: 0.9 * (1 - eased) };
}

/**
 * 光柱的强度（`0` = 不画）；**只有中档有**（`beamSeconds = 0` ⇒ 恒 `null`）。
 *
 * 三段：劈下（`0 → 0.9`，`EaseInQuad`）→ 持续照射（±15% 呼吸）→ 快速淡出。
 */
export function territoryChestBeamAlpha(spec: ITerritoryChestSpec, t: number): number | null {
    if (!(spec.beamDownSeconds > 0)) return null;
    if (t < spec.beamStart) return 0;
    const down = phase(t, spec.beamStart, spec.beamDownSeconds);
    const holdStart = spec.beamStart + spec.beamDownSeconds;
    if (down !== null && down < 1) return 0.9 * easeInQuad(down);
    const holdEnd = holdStart + spec.beamHoldSeconds;
    if (t < holdEnd) {
        // 呼吸：强度 ±15%，周期 0.25s（规格「光束做明暗呼吸」）。
        const breathe = Math.sin((t - holdStart) / 0.25 * Math.PI * 2);
        // 夹到 1：呼吸峰值 0.9×1.15 = 1.035，超过 1 的 alpha 没有意义（视图还得再夹一次）。
        return Math.min(1, 0.9 * (1 + 0.15 * breathe));
    }
    const fade = phase(t, holdEnd, spec.beamFadeSeconds);
    // 淡出段走完 ⇒ **归零**（不是留一个底噪）：光柱必须干净消失，否则收尾那一帧还挂着一道白。
    if (fade === null) return 0;
    return 0.9 * (1 - easeOutCubic(fade));
}

/** 彩虹光束的强度与转角（度）；**只有强档有**，弱/中档恒 `null`。 */
export interface ITerritoryChestRainbowFx {
    readonly alpha: number;
    readonly spinDeg: number;
}

export function territoryChestRainbowFx(spec: ITerritoryChestSpec, t: number): ITerritoryChestRainbowFx | null {
    if (!(spec.rainbowEnd > spec.rainbowStart)) return null;
    if (t < spec.rainbowStart || t > spec.rainbowEnd + 0.3) return null;
    const fadeIn = phase(t, spec.rainbowStart, 0.15) ?? 0;
    const fadeOut = phase(t, spec.rainbowEnd, 0.30);
    const alpha = fadeIn < 1 ? fadeIn : fadeOut === null ? 1 : 1 - fadeOut;
    return {
        alpha: Math.max(0, Math.min(1, alpha)),
        spinDeg: (t - spec.rainbowStart) * spec.rainbowSpinDegPerSecond,
    };
}

// ============================================================
// 镜头 / 暗角
// ============================================================

/** 镜头与暗角的当前值。 */
export interface ITerritoryChestCameraFx {
    /** 缩放倍率（`1` = 不推镜）。视图把它乘到「开箱舞台」上。 */
    readonly scale: number;
    /** 全屏暗角不透明度（`0` = 不压暗）。 */
    readonly vignette: number;
}

/**
 * 镜头推拉 + 暗角。**三档都会推镜，只是幅度与起手时刻不同**（`cameraZoom` 见字段注释）。
 *
 *  · 弱 / 中：`cameraInStart`（= 开盖那一刻）起，`cameraInSeconds`（= 开盖时长）内推到
 *    `1.06 / 1.10`（`EaseOutCubic`，前快后慢 ⇒ "凑近"的手感），**暗角恒 0**；
 *  · 强：`0 ~ 0.3s` 直接推到 `2.3` 并压暗；
 *  · 三档都到 `cameraOutStart` 起、`cameraOutSeconds` 内用 `EaseInQuad` 拉回 1。
 *
 * `cameraOutStart` 一律与**收尾起点**（{@link territoryChestFadeStart}）对齐、`cameraOutSeconds`
 * 等于 `fadeOutSeconds`：镜头回到 1.0 的那一帧宝箱正好淡完，不会出现「镜头还怼着、箱子已经没了」
 * 或者「箱子淡完了还在原地推拉」。
 *
 * ⚠️ 推近**从 1 开始**（`t = 0` 时恒为 1）：点击那一瞬间的画面必须与地图上静止那只**逐像素同大**，
 *   否则会读作「点一下箱子突然弹大一圈」（2026-10-22 上一轮就修过这个问题）。
 *   要改幅度只动 `cameraZoom`，别把 `scale` 的起点抬起来。
 */
export function territoryChestCameraFx(spec: ITerritoryChestSpec, t: number): ITerritoryChestCameraFx {
    const idle: ITerritoryChestCameraFx = { scale: 1, vignette: 0 };
    if (spec.cameraZoom === 1 && spec.vignetteAlpha === 0) return idle;
    if (!Number.isFinite(t) || t < 0) return idle;

    let scale = 1;
    if (spec.cameraZoom !== 1 && spec.cameraInSeconds > 0) {
        const zoomIn = phase(t, spec.cameraInStart, spec.cameraInSeconds);
        if (zoomIn !== null && t < spec.cameraOutStart) {
            scale = 1 + (spec.cameraZoom - 1) * easeOutCubic(zoomIn);
        } else {
            const zoomOut = phase(t, spec.cameraOutStart, spec.cameraOutSeconds);
            scale = zoomOut === null
                ? 1
                : spec.cameraZoom + (1 - spec.cameraZoom) * easeInQuad(zoomOut);
        }
    }

    let vignette = 0;
    if (spec.vignetteAlpha > 0) {
        const fadeIn = phase(t, spec.cameraInStart, spec.vignetteSeconds) ?? 0;
        const fadeOut = phase(t, spec.cameraOutStart, spec.vignetteSeconds);
        vignette = fadeOut === null
            ? spec.vignetteAlpha * (fadeIn < 1 ? fadeIn : 1)
            : spec.vignetteAlpha * (1 - fadeOut);
    }
    return { scale, vignette: Math.max(0, Math.min(1, vignette)) };
}

// ============================================================
// 粒子（确定性抖动：同 seed 同索引恒等，便于单测与复现）
// ============================================================

/**
 * 确定性哈希 → `[0, 1)`。
 *
 * 与 `TerritoryResourceGain.burstNoise` 同一套路：**不用 `Math.random()`**，
 * 同一 `(seed, index, salt)` 必须给出同一个偏移，否则单测无法验证判据、池化复用无法复现。
 * 视觉上的「每次不一样」由调用方每次开箱换一个 seed 提供。
 */
function chestNoise(seed: number, index: number, salt: number): number {
    let h = Math.imul(seed | 0, 0x27d4eb2d)
        ^ Math.imul(index + 1, 0x9e3779b1)
        ^ Math.imul(salt + 1, 0x85ebca6b);
    h = (h ^ (h >>> 15)) | 0;
    h = Math.imul(h, 0x2545f491);
    h = (h ^ (h >>> 13)) | 0;
    return (h >>> 0) / 4294967296;
}

/** 喷泉粒子的重力（px/s²）与出射档位（规格「60°~100° 扇形、初速 600~900」）。 */
export const TERRITORY_CHEST_FOUNTAIN_GRAVITY = 1400;
export const TERRITORY_CHEST_FOUNTAIN_SPEED_MIN = 600;
export const TERRITORY_CHEST_FOUNTAIN_SPEED_MAX = 900;

/** 星光粒子的扩散速度（px/s，规格「200~500 无重力」）。 */
export const TERRITORY_CHEST_STAR_SPEED_MIN = 200;
export const TERRITORY_CHEST_STAR_SPEED_MAX = 500;
/** 星光单颗生命周期（秒，规格「1.5~2.5s 后淡出」）。 */
export const TERRITORY_CHEST_STAR_LIFE_MIN = 1.5;
export const TERRITORY_CHEST_STAR_LIFE_MAX = 2.5;

/** 一颗喷泉粒子的当帧状态（坐标相对**箱口**）。 */
export interface ITerritoryChestParticle {
    readonly x: number;
    /** 向上为正。 */
    readonly y: number;
    readonly scale: number;
    readonly rotationDeg: number;
    readonly opacity: number;
}

/**
 * 第 `index` 颗喷泉粒子在 `t` 秒时的状态；`null` = 还没出发 / 已消失。
 *
 * 出射角取 `60° ~ 100°`（相对屏幕水平轴向上），初速 `600~900`，只受重力 ⇒ 抛物线；
 * 落回箱口（`y <= 0`）即淡出，**不穿进宝箱**（与 `territoryBurstParticle` 同一口径）。
 */
export function territoryChestFountainFx(
    spec: ITerritoryChestSpec,
    seed: number,
    index: number,
    t: number,
): ITerritoryChestParticle | null {
    if (!(spec.fountainCount > 0) || !(spec.fountainSeconds > 0)) return null;
    if (!Number.isInteger(index) || index < 0 || index >= spec.fountainCount) return null;
    if (!Number.isFinite(t) || t < 0) return null;
    // 分 3 批错峰（规格「按 0.08s 间隔分 3~4 批」）
    const launchAt = spec.fountainStart + (index % 4) * 0.08 + index * (spec.fountainSeconds * 0.35 / spec.fountainCount);
    const local = t - launchAt;
    if (local < 0) return null;

    const spread = chestNoise(seed, index, 0);
    const angle = ((60 + spread * 40) * Math.PI) / 180;
    const speed = TERRITORY_CHEST_FOUNTAIN_SPEED_MIN
        + chestNoise(seed, index, 1) * (TERRITORY_CHEST_FOUNTAIN_SPEED_MAX - TERRITORY_CHEST_FOUNTAIN_SPEED_MIN);
    const vx = Math.cos(angle) * speed * (chestNoise(seed, index, 2) < 0.5 ? -1 : 1);
    const vy = Math.sin(angle) * speed;
    const gravity = TERRITORY_CHEST_FOUNTAIN_GRAVITY;
    const surface = (2 * vy) / gravity;
    const life = Math.min(spec.fountainSeconds, surface + 0.25);
    if (local >= life) return null;

    const flight = Math.min(local, surface);
    const y = vy * flight - 0.5 * gravity * flight * flight;
    // 落地后 0.25s 淡出；飞得久的那几颗在窗口末尾淡出。
    const fadeSpan = 0.25;
    const opacity = local > life - fadeSpan ? Math.max(0, 1 - (local - (life - fadeSpan)) / fadeSpan) : 1;
    return {
        x: vx * flight,
        y: Math.max(0, y),
        scale: 0.85 + chestNoise(seed, index, 3) * 0.4,
        rotationDeg: local * (540 + chestNoise(seed, index, 4) * 360),
        opacity,
    };
}

/**
 * 第 `index` 颗星光在 `t` 秒时的状态；`null` = 还没出现 / 已消失。
 *
 * 与喷泉的区别：**无重力**，径向扩散后匀速漂、自转、末段淡出（规格 §3.2 彩色星光）。
 */
export function territoryChestStarFx(
    spec: ITerritoryChestSpec,
    seed: number,
    index: number,
    t: number,
): ITerritoryChestParticle | null {
    if (!(spec.starCount > 0) || !(spec.starSeconds > 0)) return null;
    if (!Number.isInteger(index) || index < 0 || index >= spec.starCount) return null;
    if (!Number.isFinite(t) || t < 0) return null;
    const launchAt = spec.starStart + chestNoise(seed, index, 5) * 0.15;
    const life = TERRITORY_CHEST_STAR_LIFE_MIN
        + chestNoise(seed, index, 6) * (TERRITORY_CHEST_STAR_LIFE_MAX - TERRITORY_CHEST_STAR_LIFE_MIN);
    const local = t - launchAt;
    if (local < 0 || local >= life) return null;

    const theta = chestNoise(seed, index, 7) * Math.PI * 2;
    const speed = TERRITORY_CHEST_STAR_SPEED_MIN
        + chestNoise(seed, index, 8) * (TERRITORY_CHEST_STAR_SPEED_MAX - TERRITORY_CHEST_STAR_SPEED_MIN);
    // 匀速 + 轻微阻尼（`local^0.85`），读作「扩散后停住慢慢飘」
    const distance = speed * Math.pow(local, 0.85);
    const fadeStart = life - 0.6;
    return {
        x: Math.cos(theta) * distance,
        y: Math.sin(theta) * distance,
        scale: 0.6 + chestNoise(seed, index, 9) * 0.8,
        rotationDeg: local * (180 + chestNoise(seed, index, 10) * 360),
        opacity: local > fadeStart ? Math.max(0, 1 - (local - fadeStart) / 0.6) : 1,
    };
}

// ============================================================
// 奖励飞向栏位（二次贝塞尔，规格 §0.3 的 FlyArc）
// ============================================================

/** 一枚飞行的进度与外观；`null` = 这一帧不画。 */
export interface ITerritoryChestFlyFx {
    /** `0..1` 的飞行进度（视图据此在起终点之间插值）。 */
    readonly progress: number;
    readonly scale: number;
    readonly opacity: number;
    /** 抛物线拱高占「起终点直线距离」的比例（视图乘上距离得控制点高度）。 */
    readonly arcRatio: number;
}

/** 飞行段的拱高比例（规格「控制点向上偏移屏幕高的 18%~25%」，这里按起终点距离的 0.55 取）。 */
export const TERRITORY_CHEST_FLY_ARC_RATIO = 0.55;

/**
 * 第 `index` 枚奖励图标在 `t` 秒时的飞行状态。
 *
 * 错峰 `0.06s`；飞行 `EaseOutCubic`；到终点前 `12%` 做「被吸入」的缩放收小
 * （规格 §0.3「到达：图标在终点处 scale 1→0.3」）。
 */
export function territoryChestFlyFx(
    spec: ITerritoryChestSpec,
    index: number,
    t: number,
): ITerritoryChestFlyFx | null {
    if (!(spec.flyCount > 0) || !(spec.flySeconds > 0)) return null;
    if (!Number.isInteger(index) || index < 0 || index >= spec.flyCount) return null;
    const local = t - (spec.flyStart + index * TERRITORY_CHEST_FLY_STAGGER);
    const progress = local / spec.flySeconds;
    // 端点用容差判（见 `PHASE_EPSILON`）：窗口末帧不该再返回一个 `opacity≈1e-15` 的残影。
    if (local < 0 || progress >= 1 - PHASE_EPSILON) return null;
    const scale = progress < 0.88 ? 1 : 1 + (0.3 - 1) * easeOutCubic((progress - 0.88) / 0.12);
    return {
        progress: easeOutCubic(progress),
        scale,
        opacity: progress < 0.92 ? 1 : Math.max(0, 1 - (progress - 0.92) / 0.08),
        arcRatio: TERRITORY_CHEST_FLY_ARC_RATIO,
    };
}
