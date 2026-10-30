import { Color, Graphics, Mask, Node, Sprite, SpriteFrame, UITransform, Vec3 } from 'cc';
import { HEX_GRID_CONTENT_LIFT } from '../../../core/hex/HexGridLayout';
import {
    TERRITORY_CLOUD_DOLLY_FADE_SECONDS,
    TERRITORY_CLOUD_FILL_FADE_SECONDS,
    TERRITORY_CLOUD_POCKET_SCALE,
    TERRITORY_CLOUD_SCALE,
    territoryCloudArtOffsetY,
    territoryCloudDissolveFrame,
    territoryCloudDollyFadeDue,
    territoryCloudDollyTotalSeconds,
    territoryCloudDollyZoom,
    territoryCloudFillOpacity,
    territoryCloudFillPoints,
    territoryCloudFillWaveOpacity,
    territoryCloudFillWaveOrder,
    territoryCloudKeepOutPoints,
    type ITerritoryCloudCell,
    type ITerritoryCloudDissolveFrame,
    type ITerritoryCloudPoint,
} from '../model/TerritoryCloud';
import { territoryMapContentShiftY } from '../model/TerritoryMapLayout';

/** 云层节点名（`attach` 建、插在格子层之后）。用例按这个名字核层级。 */
export const TERRITORY_CLOUD_LAYER_NODE = 'CloudLayer';
/** 挡云遮罩节点名（`CloudLayer` 的父节点）。 */
export const TERRITORY_CLOUD_KEEP_OUT_NODE = 'CloudKeepOut';
/** 消散层节点名（自带一张"排除自己"的挡云遮罩，压在遮罩之上、站点层之下）。 */
export const TERRITORY_CLOUD_DISSOLVE_NODE = 'CloudDissolveLayer';
/** 「铺满背景」的虚拟云层（在 `CloudLayer` 之下、同一张挡云遮罩里）。 */
export const TERRITORY_CLOUD_FILL_NODE = 'CloudFillLayer';
/** 「被地块包围的云洞」顶层节点（挂在**页面根**、压在 UI 之上）。 */
export const TERRITORY_CLOUD_POCKET_NODE = 'TerritoryCloudPocket';
/**
 * 影子层节点名（`CloudKeepOut` 的**第 0 个**孩子）。
 *
 * 云体与影子是**两张同画布图**（`cloud_body_N` / `cloud_shadow_N`，由
 * `tools/split_cloud_layers.py` 离线拆出来）。所有影子都住进这一层 ⇒
 * **所有影子都在所有云体之下**，跨层也不可能有影子压在云上
 * （用户 2026-10-23 第三轮：「云层的影子部分的层级要比云层低」；
 *  2026-10-26 修的是**跨层**那一半：云层影子曾排在铺满层云体之上，形成一条灰云带）。
 */
export const TERRITORY_CLOUD_SHADOW_NODE = 'CloudShadow';
/** 影子层里的「铺满层影子」子分组（与真实云层影子分开，各自可清空）。 */
export const TERRITORY_CLOUD_FILL_SHADOW_NODE = 'CloudFillShadow';
/** 影子层里的「真实云层影子」子分组。 */
export const TERRITORY_CLOUD_LAYER_SHADOW_NODE = 'CloudLayerShadow';

/**
 * 注入的一套云美术。
 *
 * 云和影子是**两张图**（美术层拆好的同画布 PNG），所以每一档都要两份：
 *
 * | 字段 | 对应资源 | 用途 |
 * | --- | --- | --- |
 * | `body` | `cloud_body_0` | 未解锁的静止云体（只用第 1 张） |
 * | `shadow` | `cloud_shadow_0` | 静止云的影子（组内第 0 层） |
 * | `dissolveBody` | `cloud_dissolve_body_0…1` | 解锁消散：云体两帧 |
 * | `dissolveShadow` | `cloud_dissolve_shadow_0…1` | 解锁消散：影子两帧（与云体同 index 同步） |
 */
export interface ITerritoryCloudFrames {
    readonly body: readonly SpriteFrame[];
    readonly shadow: readonly SpriteFrame[];
    readonly dissolveBody: readonly SpriteFrame[];
    readonly dissolveShadow: readonly SpriteFrame[];
}

/** 两个集合是否完全一样（挡云区 / 云洞只在变化时重画 Graphics）。 */
function sameSet(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
    if (a.size !== b.size) return false;
    for (const value of a) {
        if (!b.has(value)) return false;
    }
    return true;
}

/** 取一档帧的第 1 张（空 / 全是 `null` ⇒ `null`）。待机只用 1 张，见类注释。 */
function firstFrame(frames: readonly SpriteFrame[] | undefined): SpriteFrame | null {
    for (const frame of frames ?? []) {
        if (frame) return frame;
    }
    return null;
}

/** 滤掉空帧、保留顺序（消散序列帧要按下标同步，不能留洞）。 */
function frameList(frames: readonly SpriteFrame[] | undefined): readonly SpriteFrame[] {
    const list: SpriteFrame[] = [];
    for (const frame of frames ?? []) {
        if (frame) list.push(frame);
    }
    return list;
}

/**
 * 一朵正在消散的云（一次消散 = 一条轨道）。
 *
 * 为什么要把"起点 / 基础倍率"存在轨道里，而不是每帧从别处查：
 *  · 缩放 / 上飘都是**相对起手**算的（`baseScale × pose.scale`、`baseY + pose.liftY`），
 *    消散过程中节点自己的 `scale` / `position` 一直在变，不能当基准；
 *  · 云洞那朵（0.6 倍）和解锁区的云（1.0 倍）走**同一条**时间轴，只有基准倍率不同；
 *  · 云洞那朵是从云洞层"借"过来的临时节点，散完要销毁（解锁区那朵是常驻节点、散完只是收起来），
 *    所以还要一个 `inPocket` 标记 —— 收尾动作不一样。
 */
interface ITerritoryCloudDissolveTrack {
    readonly body: Sprite;
    readonly shadow: Sprite | null;
    /** 从云洞层借来的临时节点（散完销毁；解锁区那朵散完只收起）。 */
    readonly inPocket: boolean;
    /** 起手位置（上飘的基准）。 */
    readonly baseX: number;
    readonly baseY: number;
    /** 这朵云的基础倍率：解锁区 = {@link TERRITORY_CLOUD_SCALE}；云洞 = 再乘 `POCKET_SCALE`。 */
    readonly baseScale: number;
    elapsed: number;
}

/**
 * 章节地图的「未解锁云」。
 *
 * ## 它盖的是**格位**，不是格子节点
 *
 * 没露出来的格子在 `TerritoryMapView.paintHexes` 里就是 `node.active = false`（连地皮都不画），
 * 所以云只能挂在自己的层里、按 `layout.points` 的坐标摆 —— 挂在格子节点下会跟着一起被隐藏，
 * 表现为"整张图一朵云都没有"且零报错。
 *
 * ## 层序（2026-10-23 第三轮定稿）
 *
 * ```
 * MapLayer
 * ├── MapBackground
 * ├── GridLayer            格子（已解锁的才画）
 * ├── CloudKeepOut        ← 挡云遮罩（反向 Mask，只画"已解锁格面外扩 15px"）
 * │   ├── CloudShadow      ← **影子层**（第 0 个孩子：所有影子都在所有云体之下）
 * │   │   ├── CloudFillShadow    铺满层的影子
 * │   │   └── CloudLayerShadow   真实云层的影子
 * │   ├── CloudFillLayer   铺满背景的虚拟云（云体）
 * │   └── CloudLayer       未解锁云（静止图，云体）
 * ├── CloudDissolveLayer  正在消散的云（**自带**一张"排除自己"的挡云遮罩）
 * │   └── CloudShadow      消散云的影子（层内第 0 ⇒ 在消散云体之下）
 * └── StationIconLayer ... 站点 / 飘字
 *
 * 页面根
 * └── TerritoryCloudPocket 被地块包围的云洞（**不裁剪**；压在 UI 之上、被 `TerritoryOverlay`
 *                         的宝箱/粒子压住；不拦点击）
 *     └── CloudShadow
 * ```
 *
 * · 云压在**格子之上**：2026-10-23 山猫实机口径（截图）—— 压在格子层下面时，已解锁地块会把云的
 *   溢出部分整块切平（草地边缘把云切成直角），看着像被裁掉而不是云飘过；
 * · 云压在**站点层之下**：云 200×240 比一格大，糊在建筑图标上会把别人家的据点盖掉；
 * · 真正"不遮挡地块"靠的是 `CloudKeepOut` 这层**反向遮罩**（用户口径：
 *   「云层和地块有个固定的间隔 15px，不会遮挡地块」）；
 * · **影子永远成组压在云体之下** —— 而且必须是**全局**的一个影子层：
 *   2026-10-26 实机出现一条"灰云带"，根因正是两层各带一个影子分组
 *   （`CloudLayer` 的影子在层内是第 0，但整个 `CloudLayer` 排在 `CloudFillLayer` 之后 ⇒
 *   云层影子压到了铺满层云体上）。现在影子全在 `CloudShadow` 层，跨层也不可能有影子压云。
 *   做成两层图而不是运行时切 rect，原因见 `TerritoryCloud.ts` 里「为什么这里没有切片换算」那段 ——
 *   三版运行时切出来是反的，影子糊在云体上，整片云发灰。
 *
 * ## 为什么消散要单独一层
 *
 * 遮罩是"已解锁格 → 立刻加进挡云区"。刚解锁那一格的云如果还在遮罩层里，消散动画第一帧就被
 * 自己的挡云区擦掉了 —— 等于没播。所以 `startDissolve` 把节点**挪到 `CloudDissolveLayer`**。
 *
 * 但消散层也不能完全不管间隔（用户第三轮：「这部分的云朵也要与地块有间隔，且图层在地块的上方」）：
 * 它自带一张**同形状、但把"正在消散的那些格"排除掉**的反向遮罩 ⇒ 云在自己那一格上完整地散，
 * 溢出到**邻居**地块的部分照旧被擦掉 15px。
 *
 * ⚠️ 两个层的父节点都在 `MapLayer` 的原点、缩放 1，所以 `setParent` 不改局部坐标 ——
 *   挪层那一刻云不会跳位。
 *
 * ## 帧
 *
 * 待机**不换帧**（2026-10-23 用户：「序列帧动画只有在地块解锁、云层消散时才使用，未解锁状态应该是
 * 静止的图片」）⇒ 只用 `idle[0]` 一张图，`step()` 只推进消散。
 *
 * ## 解锁消散：四段过渡（2026-10-26 六版）
 *
 * 用户口径：「云朵快速变小消失，爆炸散开消失，过程伴随透明度变透消失」。
 *
 * ```
 * 进度   0%────12%──────────────30%──────────56%─────────100%
 * 帧     └── 整朵（index=-1）──┴─ 消散帧 0（裂成环）─┴─ 消散帧 1（碎块）─┘
 * 体缩放 1 ──→ 1.06 ───────────→ 0.84 ──────→ 1.15（掉头向外炸）──────→
 * 体位置 0 ───────────────────── 云体 +12px（缓出）──────────────────→
 * 体透明 1 ──────────────────────┴──→ 0（hold 之后线性）──────────────→
 * 影缩放 1 ──→ 1.06 ───────────→ 0.84 ──────→ 0.70（反着收）──────────→
 * 影位置 全程不动（贴地投影）──────────────────────────────────────────→
 * 影透明 1 ──────────────────────┴──→ 0（比云体早 25% 归零）──────────→
 * ```
 *
 * 三件事各管一段语义，别互相替换：
 *  · **缩放**是"变小 / 炸开"——壳先收到 0.84（读"变小"）、碎块再炸到 1.15（读"散开"），
 *    一收一放才是爆炸；只缩会读成"云瘪了"，只涨会读成"云涨大"；
 *  · **序列帧**是"爆炸散开"的形（第 0 帧裂成环、第 1 帧只剩碎块）；
 *  · **不透明度**是"变透消失"，压在碎块帧上（第一帧就淡会读成"凭空变淡"而不是"散掉"）。
 *
 * 影子的三条曲线**都不跟云体共用**（见 `applyDissolve`）：不飘、碎块段反着收、更早归零 ——
 * 云升空散掉时，地上的投影只会更小更淡。同一条曲线会出现"云只剩几缕、地上还挂一大团灰"。
 *
 * 起手段**不换帧**（`index = -1` 用待机整朵图）—— 老口径第一帧直接写 `cloud_dissolve_body_0`，
 * 整朵云跳成"中间已经裂出洞的环"是一次瞬间跳变，用户说的是"加一个过渡动画"。
 *
 * ## 消散为什么也要给云洞那朵播
 *
 * 洞格的云画在页面顶层的云洞层里（0.6 倍），解锁区那朵是**收起来待命**的（1.0 倍）。
 * 老口径洞格一解锁就把云洞那朵销毁、同时点亮正常层那朵 ⇒ 实机是"小云凭空没 + 大云凭空来"。
 * 现在洞格解锁时把那朵（连同影子）**挪进消散层**、按 0.6 倍记一条消散轨道，散完再销毁
 * （见 `startPocketDissolve`）。
 *
 * ## 全解锁：镜头散场 + 铺满层**逐朵**退场（2026-10-27 两轮）
 *
 * 第一轮（用户）：「拉高摄像机，观看云层逐渐消失的过程……云雾消失后重新拉进镜头」⇒
 * 拉远 1.1s → 雾淡 2s → 拉回 0.7s（`TerritoryMapView.stepCloudDolly` 推镜头，时钟在这边）。
 *
 * 第二轮（用户）：「从靠近地块的云雾先消失，离地块远的消失的慢，形成一个消失扩散的视觉效果」⇒
 * 铺满层不再是一个 `UIOpacity` 管整层，而是**每朵按到最近地块的距离**各拿一条窗口：
 *
 * ```
 * 距离  0（贴着地块） ───────────────────────→ 最远
 * 起淡   ── 0 ──→ 0.25 × 总时长
 * 淡完   0.55 × 总时长 ──────────────────────→ 1.00 × 总时长
 * ```
 *
 * 起得早 + 淡得快，两条叠起来才是"雾从地块边缘一圈圈退出去"；只错开起淡时间的话，
 * 观感是"整片雾匀速变薄、只是先后不同"。
 *
 * ⚠️ 逐朵不能挂 `UIOpacity`（几百个组件会让节点退出静态合批），走 `Sprite.color.a`；
 *    影子在另一个节点里，必须用**同一个**读数一起写。
 *
 * ## 云体 / 影子怎么拆
 *
 * **美术层拆的**，运行时不切：`tools/split_cloud_layers.py` 按像素把 `cloud_idle_0` 拆成
 * `cloud_body_0` / `cloud_shadow_0`（同画布 200×240、像素互斥、叠起来严格等于原图），
 * 消散帧同理拆成 `cloud_dissolve_body_N` / `cloud_dissolve_shadow_N`。
 *
 * 所以体 / 影两个节点：同一张帧尺寸（`SizeMode.RAW`）、同一个锚点、写**同一个** `setPosition`
 * 就对齐 —— 这里不存在任何 rect / offset 换算（三版就是死在那套换算上）。
 */
export class TerritoryCloudView {
    /** 云层（静止云；`CloudKeepOut` 的子节点）。`null` = 还没 `attach`。 */
    private layer: Node | null = null;
    /** 影子层（`CloudKeepOut` 的第 0 个孩子 ⇒ **所有**影子在所有云体之下）。 */
    private shadowLayer: Node | null = null;
    /** 真实云层的影子子分组（住在 {@link shadowLayer} 里）。 */
    private shadowGroup: Node | null = null;
    /** 挡云遮罩节点（`CloudLayer` 的父节点）。 */
    private keepOut: Node | null = null;
    /** 挡云遮罩组件（反向 ⇒ 画到的地方**不显示**云）。 */
    private keepOutMask: Mask | null = null;
    /** 遮罩图形（`Mask` 在 GRAPHICS_STENCIL 下会用同一节点上的 `Graphics` 当模具）。 */
    private keepOutGraphics: Graphics | null = null;
    /** 消散层（自带遮罩：擦邻居、留自己那一格）。 */
    private dissolveLayer: Node | null = null;
    private dissolveShadowGroup: Node | null = null;
    private dissolveMask: Mask | null = null;
    private dissolveGraphics: Graphics | null = null;
    /** 上一版"正在消散的格"（只在变化时重画消散层的遮罩）。 */
    private dissolveIds: ReadonlySet<number> = new Set<number>();
    /**
     * 正在批量处理（`sync` 一帧里解锁好几格 / `step` 一帧里散完好几朵）。
     *
     * 消散层的遮罩一重建就是几百个多边形，逐格重建等于 O(N²)：批量期间只打标记，
     * 这一批结束时统一 flush 一次（`syncDissolveKeepOut` 本来就按集合判等，flush 很便宜）。
     */
    private batching = false;
    /**
     * 「铺满背景」的虚拟云层（`CloudKeepOut` 里**影子层之后**的那层 ⇒ 画在真实格云之下）。
     *
     *  为什么要铺：用户 2026-10-23 第二轮「云的填充整个背景图全部填充，包括玩家信息和资源栏上方」——
     *  原来只在**格位**摆云，地图包围盒之外的留白（`TERRITORY_MAP_CONTENT_PADDING` = 四周 300px）
     *  一片云都没有，滚到边缘时顶部那条露出底图（截图 1 的红框）。
     */
    private fillLayer: Node | null = null;
    /** 铺满层的影子子分组（同样住在影子层里，排在真实云层影子之前）。 */
    private fillShadowGroup: Node | null = null;
    /** 已生成的铺满格点（尺寸 / 行列变了才重算）。 */
    private fillPoints: readonly ITerritoryCloudPoint[] = [];
    /** 铺满层的云体 / 影子（`setFrames` 晚到时要把帧补给它们）。 */
    private readonly fillSprites: Sprite[] = [];
    private readonly fillShadowSprites: Sprite[] = [];
    /** 铺满区的指纹（内容层尺寸 + 行列）；同指纹不重建那几百个节点。 */
    private fillKey = '';
    /**
     * 铺满层**退场**的已用时（秒）；`< 0` = 没在退场。
     *
     * 与消散轨道同一个记法（{@link ITerritoryCloudDissolveTrack.elapsed}）：曲线是模型里的
     * 纯函数 {@link territoryCloudFillWaveOpacity}，视图只负责"已用时 + dt"与最后写进 `Sprite.color.a`。
     *
     * ⚠️ 这是**整条时间轴**的表：每朵雾的窗口（{@link fillWaveOrders}）都压在它以内，
     *    所以"该不该收工"只看它（见 {@link stepFillFade}）。
     */
    private fillFadeElapsed = -1;
    /**
     * 每朵铺满雾的**波次**（`0` = 贴着地块、`1` = 最远），与 {@link fillSprites} 同下标。
     *
     * 空数组 = 编不出波（没有地块坐标 / 还没建好）⇒ 整层退回"一条曲线"的老口径。
     * 只在起淡那一刻编一次（{@link prepareFillWave}）：全解锁时地块位置已经是终态，
     * 每帧按几百朵 × 几百格求最近距离是白白烧 CPU。
     */
    private fillWaveOrders: number[] = [];
    /**
     * 本次退场**用多长**（秒）—— 两条档：
     *
     *  · 默认 {@link TERRITORY_CLOUD_FILL_FADE_SECONDS}（0.5s，与最后一朵云的消散同长）；
     *  · 走镜头散场时 {@link TERRITORY_CLOUD_DOLLY_FADE_SECONDS}（2s，镜头已经拉远，
     *    玩家看着整张图，雾要"逐渐"消失才读得出过程）。
     *
     * ⚠️ 只在**起跑那一刻**写一次，`stepFillFade` 每帧只读它 —— 让时长跟"已用时"一起变
     *    等于每帧换一条曲线，表现是雾忽快忽慢。
     */
    private fillFadeSeconds = TERRITORY_CLOUD_FILL_FADE_SECONDS;
    /** 铺满层已经退完（此时 `active = false`，连绘制都省掉）。 */
    private fillDismissed = false;
    /**
     * 「全解锁 ⇒ 镜头拉远看雾散」的已用时（秒）；`< 0` = 没在演。
     *
     * 时钟放在**云层**而不是地图视图，因为「拉远 → 雾淡 → 拉回」是一条链：淡出起跑
     * 由 {@link territoryCloudDollyFadeDue} 定，两边各持一只表必然漂。
     * 地图视图每帧读 {@link dollyZoom} 去推 `MapLayer`，读 {@link dollyActive} 决定起/停基准。
     */
    private dollyElapsed = -1;
    /**
     * 「整张图刚好入画」的倍率（≤ 1，只缩不放）—— **页面/视图注入**，
     * 由 `territoryCloudDollyFitScale(layout.width, layout.height, 视口宽, 视口高)` 算出。
     *
     * = 1（或没注入）⇒ 没有拉远的余量（图本来就比视口小）⇒ 不演镜头，只走 0.5s 淡出。
     */
    private dollyFitScale = 1;
    /**
     * 「被地块包围的云洞」顶层节点（**页面根**的孩子、压在 UI 之上）。
     *
     *  · 三版口径：**不裁剪**（原来的正像遮罩已撤）。洞里每格只放一朵、缩到
     *    `TERRITORY_CLOUD_POCKET_SCALE`，留出观感上的空隙；
     *  · 它不在 `MapLayer` 里 ⇒ 不吃 `CloudKeepOut` 的反向擦除，也不被 ScrollView 视口裁掉，
     *    所以"视觉上可以压住 UI"；
     *  · 每帧把自己的世界位置 / 缩放对齐 `MapLayer`，于是子节点仍用**地图局部坐标**摆放。
     */
    private pocketNode: Node | null = null;
    private pocketShadowGroup: Node | null = null;
    /** 当前云洞格（集合变了才重建那几朵云）。 */
    private pocketCells: ReadonlySet<number> = new Set<number>();
    private readonly pocketSprites: Sprite[] = [];
    private readonly pocketShadowSprites: Sprite[] = [];
    /** `setFillArea` 存下的行列（`setFillArea` 没调过时保持 0）。 */
    private fillRows = 0;
    private fillColumns = 0;
    /** `setFillArea` 存下的内容层尺寸（改已盖格时要拿它重算格点）。 */
    private fillWidth = 0;
    private fillHeight = 0;
    /**
     * 已经由**真实云层**负责的格（`setFillOccupied` 注入）—— 铺满层要跳过它们。
     *
     * 空集合 = 铺满整张格网（含所有空格）。章节图里 400 格只有 ~117 格配了内容，
     * 剩下的空格全靠铺满层盖云，所以这个集合**只排除有内容的格**，不是"只铺有内容的格"。
     */
    private fillOccupied: ReadonlySet<number> = new Set<number>();
    /** `MapLayer`（`CloudKeepOut` 的父节点）—— 云洞层每帧对齐它的世界变换。 */
    private mapLayer: Node | null = null;
    /**
     * 内容层偏移（= `TerritoryMapView.applyContentShift` 真正写进 `GridLayer` 的那个 y）。
     *
     * 🔴 **必须由地图视图注入**（`setContentShiftY`），不能现算缺省值。
     * 自 2026-10-27 起两份留白都是页面按「视口高 + HUD 底边」反算的**运行时值**，
     * `territoryMapContentShiftY()` 不传参拿到的是老缺省（300 / 0 ⇒ +150），
     * 而 720×1280 上的真值是 342.5 —— 差 192.5px（≈ 两排），
     * 云洞层整排漂到上面那几排已解锁地块上（用户 2026-10-28 截图红圈）。
     *
     * 缺省值保留只为「没人注入」的场景（单测 / 页面还没量到 HUD）有个合理兜底。
     */
    private contentShiftY = territoryMapContentShiftY();
    /** 最近一次 `sync` 的布局（消散层重画挡云区时要用格坐标）。 */
    private cells: readonly ITerritoryCloudCell[] = [];
    /**
     * 「这一格**已经激活**」的探针（`sync` 每帧注入；`null` = 没人给 ⇒ 退回 `revealed` 口径）。
     *
     * 🔴 与 `revealed` 是**两个口径**，混用就是 2026-10-27 那个「还没激活完全部地块，云就散了」：
     * `revealed` 含「在已占领格**前沿**的随机候选格」—— 那些格**能看见、还没开**
     * （见 `territoryRevealedCells`）。它们一进 `revealed`，全解锁判据就提前成立。
     */
    private activatedProbe: ((cellId: number) => boolean) | null = null;

    /** 云体（切过片）/ 影子（切过片）/ 消散帧（切过片）的节点表。 */
    private readonly sprites = new Map<number, Sprite>();
    private readonly shadowSprites = new Map<number, Sprite>();
    /** 正在待机（静止）盖着的格。**上一帧**的状态，diff 出"刚被解锁"的就是靠它。 */
    private readonly shown = new Set<number>();
    /**
     * 正在散：`cellId → 轨道`（起点 / 基础倍率 / 已用时）。
     *
     * 值从"已用时（秒）"升级成轨道是 2026-10-26 六版的事 —— 消散要写缩放与上飘，
     * 两者都是**相对起手**算的，光有时间算不出来（见 {@link ITerritoryCloudDissolveTrack}）。
     */
    private readonly dissolving = new Map<number, ITerritoryCloudDissolveTrack>();
    /** 待机云体帧（`cloud_body_0`；空 = 整条云表现静默关闭）。 */
    private idleFrame: SpriteFrame | null = null;
    /** 待机影子帧（`cloud_shadow_0`；`null` = 美术没给影子 ⇒ 只画云体，不报错）。 */
    private shadowFrame: SpriteFrame | null = null;
    /** 消散云体帧（`cloud_dissolve_body_0…1`）。 */
    private dissolveFrames: readonly SpriteFrame[] = [];
    /** 消散影子帧（`cloud_dissolve_shadow_0…1`），与 {@link dissolveFrames} **同 index 同步换帧**。 */
    private dissolveShadowFrames: readonly SpriteFrame[] = [];
    /** 上一版挡云范围（只在它变化时才重画遮罩 —— 别每秒重画几百个多边形）。 */
    private keepOutIds: ReadonlySet<number> = new Set<number>();
    /** 写透明的复用容器（每帧 `new Color` 会在 update 里造垃圾）。 */
    private readonly tint = new Color(255, 255, 255, 255);
    /** 遮罩模具的填充色：**全透明**（模板只写 stencil，不写颜色）。 */
    private readonly keepOutFill = new Color(255, 255, 255, 0);
    /** 消散层遮罩的填充色：同样全透明。 */
    private readonly dissolveFill = new Color(255, 255, 255, 0);

    /**
     * 在**格子层的父节点**里建四层，并插到格子层的后两位（= 格子之上、站点层之下，见类注释）。
     *
     * @param hexLayer `TerritoryMapView.gridLayer` —— 只从它身上取父节点 / layer / 兄弟序，
     *                 云不会成为它的子节点。
     */
    attach(hexLayer: Node): void {
        if (this.keepOut?.isValid) return;
        const parent = hexLayer?.parent;
        if (!parent?.isValid) return;
        const sibling = hexLayer.getSiblingIndex() + 1;

        // ① 挡云遮罩（`CloudLayer` 的父节点）。
        const keepOut = this.createLayerNode(TERRITORY_CLOUD_KEEP_OUT_NODE, parent, hexLayer.layer, sibling);
        const mask = keepOut.addComponent(Mask);
        // `GRAPHICS_STENCIL` + `inverted`：画到哪、哪里就**看不见**云。
        // 用反向遮罩而不是"画一张云可以被裁的框"，是因为要擦的区域是"已解锁格的外扩并集"，
        // 正向画出来的形状是一堆洞（Graphics 不支持挖洞），反向就变成一笔 `fill()`。
        mask.type = Mask.Type.GRAPHICS_STENCIL;
        mask.inverted = true;
        // 一开始还没有已解锁格 ⇒ 挡云区是空的，先关掉（空模具的反向遮罩在某些驱动上是未定义行为）。
        mask.enabled = false;
        const graphics = keepOut.getComponent(Graphics) ?? keepOut.addComponent(Graphics);
        // ⚠️ 必须显式写全透明：`Mask` 自己建的 Graphics 才是 alpha 0，若这里先建了一个默认的，
        //    `_createGraphics` 就不会改它的颜色 ⇒ `fill()` 会画出一块**白色实心**的多边形。
        graphics.fillColor = this.keepOutFill;
        this.mapLayer = parent;
        this.keepOut = keepOut;
        this.keepOutMask = mask;
        this.keepOutGraphics = graphics;

        // ①.5 **全局影子层** —— `CloudKeepOut` 的第 0 个孩子，**所有**影子都住在这里。
        //
        // 🔴 2026-10-26：影子分组原来是"各层各一个（层里第 0 个孩子）"，那只保证
        // **层内**影子在云体之下。两层一叠就漏：`CloudLayer` 的影子在层内是第 0，
        // 但整个 `CloudLayer` 排在 `CloudFillLayer` **之后** ⇒ 真实云层的影子画到了
        // 铺满层的云体**之上**，地图上出现一条"灰云带"（用户截图）。
        // 现在把影子全部抽到一个独立层里、压在两个云体层之下 —— 跨层也不可能有影子压云。
        const shadowLayer = this.createLayerNode(TERRITORY_CLOUD_SHADOW_NODE, keepOut, hexLayer.layer, 0);
        this.shadowLayer = shadowLayer;
        // 两个子分组各自可清空：重建铺满层 / 换章清真实云层时互不干扰。
        this.fillShadowGroup = this.createShadowGroup(shadowLayer, TERRITORY_CLOUD_FILL_SHADOW_NODE);
        this.shadowGroup = this.createShadowGroup(shadowLayer, TERRITORY_CLOUD_LAYER_SHADOW_NODE);

        // ②-0 铺满层（虚拟格点）—— 画在真实格云之下。
        //      同一张遮罩 ⇒ 已解锁的地方连它一起擦，不用单独判一遍。
        const fill = this.createLayerNode(TERRITORY_CLOUD_FILL_NODE, keepOut, hexLayer.layer, 1);
        this.fillLayer = fill;

        // ② 云层（静止云）——挂在遮罩下，才会被擦。
        const layer = this.createLayerNode(TERRITORY_CLOUD_LAYER_NODE, keepOut, hexLayer.layer, 2);
        this.layer = layer;

        // ③ 消散层 —— 插在遮罩**之后**（遮罩之上、站点层之下）。
        //    ⚠️ 别写成 `parent.children.length`：那会跑到 `GainLayer` 之上，把飘字压住。
        const dissolve = this.createLayerNode(TERRITORY_CLOUD_DISSOLVE_NODE, parent, hexLayer.layer, sibling + 1);
        const dissolveMask = dissolve.addComponent(Mask);
        // 同挡云区：反向擦除。区别只有一个 —— 正在消散的那些格**不进**擦除区（见类注释）。
        dissolveMask.type = Mask.Type.GRAPHICS_STENCIL;
        dissolveMask.inverted = true;
        dissolveMask.enabled = false;
        const dissolveGraphics = dissolve.getComponent(Graphics) ?? dissolve.addComponent(Graphics);
        dissolveGraphics.fillColor = this.dissolveFill;
        this.dissolveLayer = dissolve;
        this.dissolveMask = dissolveMask;
        this.dissolveGraphics = dissolveGraphics;
        this.dissolveShadowGroup = this.createShadowGroup(dissolve);

        // ④ 云洞层（页面根，压在 UI 之上、被 `TerritoryOverlay` 压住 —— 见字段注释）。
        this.attachPocket(hexLayer);
    }

    /**
     * 建一个「影子分组」：**所有影子都必须排在所有云体之前**（见 `attach` 里的全局影子层）。
     *
     * 一个分组顶掉"每朵云两套兄弟序"的做法：挪层 / 回退只动分组，不用逐朵算该插到第几位。
     */
    private createShadowGroup(parent: Node, name: string = TERRITORY_CLOUD_SHADOW_NODE): Node {
        return this.createLayerNode(name, parent, parent.layer);
    }

    /**
     * 建一个只装 Sprite 的图层节点：`设 layer → 挂父 → 定兄弟序 → 补 UITransform` 四步合一处。
     *
     * ⚠️ 兄弟序**必须在调用点算**：`attachPocket` 的「挂到最后一个孩子」依赖 `setParent` **之后**
     * 的 `children.length`，挪进这里会差一位（云洞层压不住 UI）。
     */
    private createLayerNode(name: string, parent: Node, layer: number, siblingIndex?: number): Node {
        const node = new Node(name);
        node.layer = layer;
        node.setParent(parent);
        if (siblingIndex !== undefined) node.setSiblingIndex(siblingIndex);
        node.addComponent(UITransform);
        return node;
    }

    /**
     * 建「被地块包围的云洞」的顶层节点（`attach` 里调一次；没有页面根就静默跳过）。
     *
     * 层级要点：
     *  · **append 到页面根**（= 最后一个孩子）⇒ 压住玩家信息 / 资源栏等 UI，也压在地块之上；
     *  · `TerritoryOverlay`（宝箱 / 飞出的奖励粒子 / 点击反馈）是**之后**才建的，且建的时候会
     *    把自己设成最后一个孩子 ⇒ 天然压在云洞层之上，满足"不能遮挡粒子特效"；
     *  · 不注册任何触摸监听、也不挂 `BlockInputEvents` ⇒ **不影响点击**（事件照旧落到下面的
     *    ScrollView / 按钮上）；
     *  · 三版口径**没有遮罩**：原来"洞外扩 15px"的正像遮罩会把云裁成一块白色六边形。
     */
    private attachPocket(hexLayer: Node): void {
        if (this.pocketNode?.isValid) return;
        // `hexLayer` 是 `GridLayer`：再往上两级才是页面根（`MapLayer → MapViewport → 页面`）。
        const page = hexLayer?.parent?.parent?.parent;
        if (!page?.isValid) return;
        const pocket = new Node(TERRITORY_CLOUD_POCKET_NODE);
        pocket.layer = page.layer;
        pocket.setParent(page);
        pocket.setSiblingIndex(page.children.length - 1);
        pocket.addComponent(UITransform);
        this.pocketNode = pocket;
        // 云洞层是独立顶层节点 ⇒ 它自己层内"影子在前"就够（同层没有别的云体）。
        this.pocketShadowGroup = this.createShadowGroup(pocket);
    }

    /**
     * 注入美术（云体 / 影子是**两套图**，见 {@link ITerritoryCloudFrames}）。
     *
     * 降级口径（缺图只是不画，不阻断进页面）：
     *  - 没有云体帧 ⇒ 整条云表现静默关闭（地图照常渲染）；
     *  - 没有影子帧 ⇒ 只画云体（等价于老的单层表现，不会报错）；
     *  - 消散两套缺一套 ⇒ 缺的那套留空（影子不动 / 云体不换帧，靠淡出收尾）。
     *
     * 铺满层 / 云洞层可能**先**建了节点（`setFillArea` 早于美术就绪）：这里要把帧补上去，
     * 否则那几百个 Sprite 会一直是空帧、整片背景**没有云**且零报错。
     */
    setFrames(frames: ITerritoryCloudFrames): void {
        this.idleFrame = firstFrame(frames?.body);
        this.shadowFrame = firstFrame(frames?.shadow);
        this.dissolveFrames = frameList(frames?.dissolveBody);
        this.dissolveShadowFrames = frameList(frames?.dissolveShadow);
        this.rebindSprites(this.fillSprites, this.idleFrame);
        this.rebindSprites(this.fillShadowSprites, this.shadowFrame);
        this.rebindSprites(this.pocketSprites, this.idleFrame);
        this.rebindSprites(this.pocketShadowSprites, this.shadowFrame);
        for (const [cellId, sprite] of this.sprites) {
            // 消散中的那朵正在播序列帧，别拿待机图去覆盖它。
            if (this.dissolving.has(cellId)) continue;
            this.rebindSprites([sprite], this.idleFrame);
        }
        this.rebindSprites(Array.from(this.shadowSprites.values()), this.shadowFrame);
        if (!this.idleFrame) this.reset();
    }

    /**
     * 铺满整块背景所需的矩形与行列（`renderMap` 每次都会调，同指纹直接返回）。
     *
     * @param width   / @param height 内容层尺寸（`territoryMapContentSize`），以 (0,0) 为中心
     * @param rows    / @param columns 地图行列（决定格网相位；虚拟格点靠它延伸）
     */
    setFillArea(width: number, height: number, rows: number, columns: number): void {
        const key = `${rows}|${columns}|${Math.round(width)}|${Math.round(height)}`;
        this.fillRows = rows > 0 ? rows : 0;
        this.fillColumns = columns > 0 ? columns : 0;
        this.fillWidth = width > 0 ? width : 0;
        this.fillHeight = height > 0 ? height : 0;
        if (key === this.fillKey) return;
        this.fillKey = key;
        this.rebuildFillPoints();
    }

    /**
     * 告诉铺满层：这些格**已经由真实云层盖了**，不要重复铺（否则同一处两朵更亮、边界一眼可见）。
     *
     * 🔴 2026-10-26：这个集合是**铺满范围的唯一依据**。章节图 20×20 / 400 格里只有 ~117 格
     * 配了内容，剩下那 280 多格既没有真实云、以前又不在铺满范围（铺满只铺格网外那圈）
     * ⇒ 地图上出现**整条裸露的沙漠底图**（用户截图左侧红框）。现在格内空格照铺，
     * 只跳过这里登记的格。换章换了内容格 ⇒ 必须重算一次。
     */
    setFillOccupied(cellIds: readonly number[]): void {
        const next = new Set<number>(cellIds ?? []);
        if (sameSet(next, this.fillOccupied)) return;
        this.fillOccupied = next;
        // 还没 `setFillArea`（尺寸未知）时先记账，等尺寸到了自然重算。
        if (!this.fillKey) return;
        this.rebuildFillPoints();
    }

    /** 行列 / 尺寸 / 已盖格 任一变化 ⇒ 重算虚拟格点并重建节点。 */
    private rebuildFillPoints(): void {
        this.fillPoints = territoryCloudFillPoints(
            this.fillRows,
            this.fillColumns,
            this.fillWidth,
            this.fillHeight,
            this.fillOccupied,
        );
        this.rebuildFill();
    }

    get layerNode(): Node | null {
        return this.layer?.isValid ? this.layer : null;
    }

    /** 云层的影子子分组（用例核"影子在云体之下"用）。 */
    get shadowGroupNode(): Node | null {
        return this.shadowGroup?.isValid ? this.shadowGroup : null;
    }

    /** 影子层本体（`CloudKeepOut` 的第 0 个孩子；用例核"跨层也压不住云"用）。 */
    get shadowLayerNode(): Node | null {
        return this.shadowLayer?.isValid ? this.shadowLayer : null;
    }

    /** 铺满层的影子子分组（用例核"两层影子都住在影子层里"用）。 */
    get fillShadowGroupNode(): Node | null {
        return this.fillShadowGroup?.isValid ? this.fillShadowGroup : null;
    }

    /** 挡云遮罩节点（用例核层级用）。 */
    get keepOutNode(): Node | null {
        return this.keepOut?.isValid ? this.keepOut : null;
    }

    /** 消散层节点（用例核层级用）。 */
    get dissolveLayerNode(): Node | null {
        return this.dissolveLayer?.isValid ? this.dissolveLayer : null;
    }

    /** 正在盖着的云数（调试 / 用例用）。 */
    get cloudCount(): number {
        return this.shown.size;
    }

    /** 正在消散的云数（调试 / 用例用）。 */
    get dissolvingCount(): number {
        return this.dissolving.size;
    }
    /** 铺满背景用的虚拟云数（真实格之外的那些；用例用）。 */
    get fillCloudCount(): number {
        return this.fillSprites.length;
    }

    /** 铺满层的影子数（为 0 说明美术没给 `cloud_shadow_0`；用例用）。 */
    get fillShadowCount(): number {
        return this.fillShadowSprites.length;
    }

    /** 当前云洞格数（没有被包围的小洞时为 0；用例用）。 */
    get pocketCount(): number {
        return this.pocketCells.size;
    }

    /** 云洞层的节点（用例核层级 / 缩放用）。 */
    get pocketLayerNode(): Node | null {
        return this.pocketNode?.isValid ? this.pocketNode : null;
    }

    /** 铺满层是否在展示（全地图解锁并**淡完**后为 `false`；淡出过程中仍为 `true`）。 */
    get fillVisible(): boolean {
        return this.fillLayer?.isValid === true && this.fillLayer.active;
    }

    /** 铺满层的不透明度（0~1；退场时间轴的**名义**读数，用例用）。 */
    get fillOpacityValue(): number {
        return territoryCloudFillOpacity(
            this.fillFadeElapsed < 0 ? 0 : this.fillFadeElapsed,
            this.fillFadeSeconds,
        );
    }

    /**
     * 编出波次的雾有多少朵（`0` = 编不出波、整层一条曲线；用例用）。
     *
     * 正常全解锁 ⇒ 等于 {@link fillCloudCount}；`0` 只应出现在"没有地块坐标"的退化路径上。
     */
    get fillWaveCount(): number {
        return this.fillWaveOrders.length;
    }

    /** 本次退场用的时长（秒）—— 0.5（默认）或 2（走镜头散场）。用例用。 */
    get fillFadeDuration(): number {
        return this.fillFadeSeconds;
    }

    /** 「全解锁镜头散场」是否在演 —— 地图视图据此起 / 停镜头基准与输入锁。 */
    get dollyActive(): boolean {
        return this.dollyElapsed >= 0;
    }

    /**
     * 镜头「拉远程度」：0 = 初始高度、1 = 整张图入画。
     *
     * ⚠️ 没在演时恒 0（= 初始高度），地图视图可以无脑每帧拿它当插值参数。
     */
    get dollyZoom(): number {
        return this.dollyElapsed >= 0 ? territoryCloudDollyZoom(this.dollyElapsed) : 0;
    }

    /** 本次散场用的「整张图入画」倍率（≤ 1）；`1` = 没有余量、不演镜头。 */
    get dollyScale(): number {
        return this.dollyFitScale;
    }

    /**
     * 注入「整张图刚好入画」的倍率（页面按视口与包围盒算好，`territoryCloudDollyFitScale`）。
     *
     * 演出**中途不接受改写**：倍率一变，`dollyZoom` 插出来的倍率就会跳一下
     * （表现为拉远到一半忽然又缩一下）。换章由 `reset()` 清掉，那时演出本来就断了。
     */
    setDollyFitScale(scale: number): void {
        if (this.dollyElapsed >= 0) return;
        const value = Number.isFinite(scale) && scale > 0 ? scale : 1;
        this.dollyFitScale = Math.min(1, value);
    }

    /**
     * 按「这一帧露出哪些格」同步云与挡云区。**幂等**，可每帧调。
     *
     * 三种走向：
     *  · 格位没露出来 ⇒ 盖着静止云（首次则建节点）；
     *  · 格位刚刚露出来（上一帧还盖着）⇒ 挪进消散层、就地播一次消散，**不再待机**；
     *  · 格位早就露出来 ⇒ 什么都不做。
     *
     * ⚠️ 进页面 / 换章的首帧天然不会误播消散：`shown` 是空的 ⇒ 已露出的格走
     * "早就露出来"那条，直接跳过。
     *
     * @param pockets 「被地块包围」的未解锁格（`territoryCloudPocketCells`）。这些格子的云
     *                **搬到页面级云洞层**：不吃挡云区的反向擦除、压在 UI 之上（需求 2026-10-23 ②）。
     * @param isActivated 「这一格已经**激活**」的探针 —— 铺满层收官的判据。
     *                **必须**传（只服务端确认过的解锁/占领/通关才算），省略就退回 `revealed`
     *                口径 ⇒ 前沿可买但还没买的随机格会把收官提前（见 {@link activatedProbe}）。
     */
    sync(
        cells: readonly ITerritoryCloudCell[],
        revealed: ReadonlySet<number>,
        pockets: readonly number[] = [],
        isActivated?: (cellId: number) => boolean,
    ): void {
        const layer = this.layer;
        if (!layer?.isValid) return;
        this.cells = cells;
        this.activatedProbe = isActivated ?? null;
        if (!this.idleFrame) {
            this.reset();
            return;
        }
        // 全地图解锁 ⇒ 整片云收工（用户口径：「只有全地图解锁后才展示」）。
        // 光靠挡云区也能擦干净格位，但**内容层留白那圈虚拟云**没有对应的已解锁格，
        // 不显式收掉就会在"全解锁"后还挂着一圈雾 —— 影子同理，要跟着一起收。
        //
        // 🔴 2026-10-27 两轮：
        //  · 第一轮：收工从"瞬间 `active = false`"改成一条淡出时间轴；
        //  · 第二轮（本次）：判据从 `revealed` 换成「全部内容格**已激活**」，且开场先演镜头
        //    （拉远 → 雾淡 → 拉回）。这里只负责"起跑 / 取消"，推进在 `step` 里。
        if (this.isMapCleared(revealed)) {
            // 幂等：已经在淡的那一遍不会被后面的 `sync` 重置（`renderMap` 会反复调）。
            if (!this.fillDismissed && this.fillFadeElapsed < 0 && this.dollyElapsed < 0) {
                this.startDismiss();
            }
        } else if (this.fillDismissed || this.fillFadeElapsed >= 0 || this.dollyElapsed >= 0) {
            // 回退（撤销解锁 / 服务端快照改口径）：与消散的 `cancelDissolve` 同态度 ——
            // **回退不该有动画**，整层立刻复原到全不透明，镜头（若有）也立刻收。
            this.fillFadeElapsed = -1;
            this.fillDismissed = false;
            this.dollyElapsed = -1;
            this.fillFadeSeconds = TERRITORY_CLOUD_FILL_FADE_SECONDS;
            this.writeFillOpacity(1);
        }
        this.applyFillActive();
        // 挡云区排在逐格之前：这一帧刚解锁的格子也要立刻进入"云不许碰"的范围。
        this.syncKeepOut(cells, revealed);
        // 云洞**也要在逐格之前**：洞格解锁时它那朵得原地转成"消散"，而不是跟着洞一起被瞬间销毁。
        this.syncPocket(cells, pockets, revealed);

        // 这一帧可能一口气解锁/回退好几格：消散层遮罩只在批末重建一次。
        this.batching = true;
        const seen = new Set<number>();
        for (const cell of cells) {
            const cellId = cell.cellId;
            seen.add(cellId);
            const existing = this.sprites.get(cellId) ?? null;
            if (!revealed.has(cellId)) {
                const sprite = existing ?? this.createCloud(cellId);
                this.placeCloud(cellId, cell);
                // 回退（撤销解锁 / 服务端快照改口径）：这一格又没露出来 ⇒
                // 立刻取消消散、挪回云层、恢复静止帧。
                // ⚠️ 走 `cancelDissolve` 而不是直接 delete：云洞那朵是从云洞层借来的临时节点，
                //    取消时必须销毁（云洞层会自己重建一朵新的），否则原地留一颗孤儿云。
                this.cancelDissolve(cellId);
                if (sprite.node.parent !== layer) sprite.node.setParent(layer);
                this.restoreShadow(cellId);
                this.applyIdle(cellId);
                // 云洞格：页面顶层那层已经画了一朵（不裁剪 + 缩到 `POCKET_SCALE`），
                // 这里只留"待机记账"、把节点收起来 —— 否则洞心叠两朵，正常层那朵被邻格的
                // 15px 啃掉一圈，看着比别处更亮（就是截图里那块白斑）。
                // ⚠️ 但它**仍要记进 `shown`**：这一格解锁时要照常播消散（起手会重新点亮）。
                this.setCloudVisible(cellId, !this.pocketCells.has(cellId));
                this.shown.add(cellId);
                continue;
            }
            // 已经在散的那朵：让它自己播完，别在这里收（否则最后一帧看不见"散"）。
            if (this.dissolving.has(cellId)) continue;
            if (!this.shown.has(cellId)) {
                if (existing?.node?.active) existing.node.active = false;
                continue;
            }
            this.shown.delete(cellId);
            this.startDissolve(cellId);
        }
        // 布局里没有的格（换章后旧图残留）⇒ 回收，别留一堆孤儿节点在图外飘。
        for (const cellId of Array.from(this.sprites.keys())) {
            if (seen.has(cellId)) continue;
            this.recycle(cellId);
        }
        this.batching = false;
        // 消散集合可能刚变过（回退 / 回收）⇒ 让消散层的挡云区跟上。
        this.syncDissolveKeepOut();
    }

    /**
     * 「全地图都打通了」没 —— 决定铺满层（`CloudFillLayer`）要不要整层收掉。
     *
     * ## 判据的两次修订（都别再退回去）
     *
     * ### ① 分母不能用 `rows × columns`
     *
     * 老口径 `revealed.size >= rows × columns`。章节图的格网是 20×20 = 400，可里面
     * **只有 117~262 格配了内容**（`sites` + `randomSites.candidateCells` + 起始格），
     * 剩下 138~283 格什么都没有 —— 它们既不会出现在 `revealed` 里，也永远不会被解锁
     * ⇒ `revealed.size` 一辈子到不了 400，铺满层**永远不撤**（2026-10-27 用户：「全部解锁后，
     * 云团没有消失」）。
     *
     * 现在分母 = `cells`（只有有内容的格）。
     *
     * ### ② 分子不能用 `revealed`（🔴 本次）
     *
     * `revealed` 来自 `territoryRevealedCells`：= 已占领 / 已解锁 ∪ 前置满足的非随机站点
     * ∪ **在已占领格「前沿」的随机候选格**。最后那一类是「地图上看得见、还没花钱开」的格
     * —— 它们一进 `revealed`，判据就成立 ⇒ 玩家还有一格没激活，雾就散了
     * （用户 2026-10-27：「还未激活完全部地块，云层就消失了」）。
     *
     * 现在改问注入的探针 {@link activatedProbe}（页面给的是
     * `isCellUnlocked || isOwned || isAreaPassed`，见 `TerritoryMapView.isCellActivated`）。
     *
     * ⚠️ 两件事别顺手做：
     *  · **别把云团自己的消散也改成「激活才散」**—— 云团是"盖住没露出来的格"，
     *    格子一露就得让开，否则格子上压着一团雾；
     *  · 别拿 `revealed` 当探针的兜底之外的第二个判据（两者一旦"或"在一起，
     *    ①那条 bug 立刻回来）。
     *
     * 退化情况（`cells` 为空 = 整张图一格内容都没有，多半是配错图）⇒ `false`，
     * 免得空白图一进去就把云全撤了。
     */
    private isMapCleared(revealed: ReadonlySet<number>): boolean {
        if (this.cells.length === 0) return false;
        const probe = this.activatedProbe;
        if (!probe) {
            // 没人给探针（老的调用点 / 用例）⇒ 退回 `revealed` 口径。
            for (const cell of this.cells) {
                if (!revealed.has(cell.cellId)) return false;
            }
            return true;
        }
        for (const cell of this.cells) {
            if (!probe(cell.cellId)) return false;
        }
        return true;
    }

    /**
     * 开场：全图打通的这一帧。
     *
     *  · 有拉远余量（`dollyFitScale < 1`，页面量过视口）⇒ 先演镜头：拉远到位后**才**起淡出，
     *    淡出放慢到 {@link TERRITORY_CLOUD_DOLLY_FADE_SECONDS}；
     *  · 没余量 / 页面没注入视口（单测、极小图）⇒ 直接走默认 0.5s 淡出，不锁玩家输入。
     */
    private startDismiss(): void {
        if (this.dollyFitScale < 1) {
            this.dollyElapsed = 0;
            return;
        }
        this.beginFillFade(TERRITORY_CLOUD_FILL_FADE_SECONDS);
    }

    /**
     * 起跑一条铺满层退场时间轴（**唯一入口**：默认档与演出档都从这里进）。
     *
     * 三件事绑在一起做，少一件就有一条路径没编波：
     *  ① 定总时长（之后不再改，见 {@link fillFadeSeconds}）；
     *  ② 时钟归零；
     *  ③ 编波次（{@link prepareFillWave}）—— 必须在这一刻编：全解锁后地块位置已是终态，
     *     而"离地块多远"正是波的唯一依据。
     */
    private beginFillFade(seconds: number): void {
        this.fillFadeSeconds = Number.isFinite(seconds) && seconds > 0
            ? seconds
            : TERRITORY_CLOUD_FILL_FADE_SECONDS;
        this.fillFadeElapsed = 0;
        this.prepareFillWave();
    }

    /**
     * 铺满层的 `active` —— **唯一的写入口**（退场收尾 / 回退复原 / 重建都走它）。
     *
     * 退场**过程中**仍是 `true`（要画，只不过越来越透）；只有淡完了才 `active = false`。
     */
    private applyFillActive(): void {
        const show = !this.fillDismissed;
        if (this.fillLayer?.isValid && this.fillLayer.active !== show) this.fillLayer.active = show;
        if (this.fillShadowGroup?.isValid && this.fillShadowGroup.active !== show) {
            this.fillShadowGroup.active = show;
        }
    }

    /**
     * 按「这一朵到最近地块的距离」编出每朵的波次（写进 {@link fillWaveOrders}）。
     *
     * ## 为什么是"到最近**地块格心**"
     *
     * 雾本来就是"盖住没解锁的格"，它的空间语义只有一种参照物 —— 地块。铺满层还铺到了
     * 内容层留白那圈（`TERRITORY_MAP_CONTENT_PADDING`），那圈离地块最远，正好是"最后才散"的那部分。
     *
     * ## 为什么只编一次
     *
     * 几百朵 × 几百格 = 十几万次距离计算。它是**全解锁那一刻**的静态量（地块位置此后不变），
     * 每帧重算是白烧 CPU。重建铺满层 / 换章会清空这个数组（见 `rebuildFill` / `clearFill`）。
     *
     * 退化：没有地块坐标（`cells` 空）或全部距离为 0（雾与地块完全重合）⇒ 保持空数组，
     * 视图退回"整层一条曲线"的老口径 —— 单测与极小图的路径靠它兜底。
     */
    private prepareFillWave(): void {
        const count = this.fillSprites.length;
        if (this.fillWaveOrders.length === count) return;
        this.fillWaveOrders = [];
        if (count <= 0 || this.cells.length === 0) return;
        const points = this.fillPoints;
        const distances: number[] = [];
        let maxDistance = 0;
        for (let index = 0; index < count; index += 1) {
            const point = points[index];
            let nearest = Number.POSITIVE_INFINITY;
            if (point) {
                for (const cell of this.cells) {
                    const dx = cell.x - point.x;
                    const dy = cell.y - point.y;
                    const distance = dx * dx + dy * dy;
                    if (distance < nearest) nearest = distance;
                }
                nearest = Math.sqrt(nearest);
            }
            // 拿不到格点（`fillPoints` 与 `fillSprites` 不同步）⇒ 当它贴着地块，按近端速度淡。
            if (!Number.isFinite(nearest)) nearest = 0;
            distances.push(nearest);
            if (nearest > maxDistance) maxDistance = nearest;
        }
        if (!(maxDistance > 0)) return;
        this.fillWaveOrders = distances.map((distance) => territoryCloudFillWaveOrder(distance, maxDistance));
    }

    /**
     * 写铺满层的**整层**不透明度（`0~1` → `Sprite.color.a` 的 `0~255`）——
     * 回退复原 / 收工归零 / 编不出波时的兜底都走它。
     *
     * ## 为什么不用 `UIOpacity` 了（2026-10-27 第二轮）
     *
     * 老口径给整层挂一个 `UIOpacity` 写同一个 alpha ⇒ 几百朵雾**同一帧**起淡、同一帧淡完，
     * 屏幕上是"整层灰一起变薄"。用户要的是「从靠近地块的云雾先消失，离地块远的消失的慢」，
     * 那就只能**逐朵**写 —— 而逐朵挂组件会让每个节点退出静态合批（几百个组件只为这 2s），
     * 所以改走 `Sprite.color.a`（与消散同一套做法，见 {@link writeOpacity}）。
     *
     * ⚠️ 影子在**另一个节点**里（`fillShadowGroup` 住在全局影子层），必须一起写 ——
     *    只淡云体不淡影子，退场那几秒里地图上会浮着一层灰。
     */
    private writeFillOpacity(value: number): void {
        for (const sprite of this.fillSprites) this.writeOpacity(sprite, value);
        for (const sprite of this.fillShadowSprites) this.writeOpacity(sprite, value);
    }

    /**
     * 逐朵写不透明度（时间轴上的一帧）—— 每朵按自己的窗口算，见
     * {@link territoryCloudFillWaveOpacity}。
     *
     * 编不出波（{@link fillWaveOrders} 与云朵数对不上）时整层退回一条曲线：
     * 宁可"没有扩散感"，也不要让某一朵停在半透明上。
     */
    private applyFillWave(elapsed: number): void {
        const sprites = this.fillSprites;
        const orders = this.fillWaveOrders;
        if (orders.length !== sprites.length) {
            this.writeFillOpacity(territoryCloudFillOpacity(elapsed, this.fillFadeSeconds));
            return;
        }
        const shadows = this.fillShadowSprites;
        for (let index = 0; index < sprites.length; index += 1) {
            const value = territoryCloudFillWaveOpacity(elapsed, orders[index], this.fillFadeSeconds);
            this.writeOpacity(sprites[index], value);
            const shadow = shadows[index];
            if (shadow) this.writeOpacity(shadow, value);
        }
    }

    /** 推进铺满层的退场时间轴（在 `step` 里每帧调）。 */
    private stepFillFade(delta: number): void {
        if (this.fillFadeElapsed < 0 || this.fillDismissed) return;
        this.fillFadeElapsed += delta;
        // ⚠️ 收工只看**整条时长**：最慢那一朵的窗口右端正好等于它（见 wave 窗口的推导），
        //    所以"时间到"与"全都淡完"是同一时刻，不会出现"还有一朵没淡完就被收起来"。
        if (this.fillFadeElapsed < this.fillFadeSeconds) {
            this.applyFillWave(this.fillFadeElapsed);
            return;
        }
        // 淡完了才真的把节点收起来（`active = false`）—— 早一帧都会"啪"一下没。
        this.fillFadeElapsed = -1;
        this.fillDismissed = true;
        this.writeFillOpacity(0);
        this.applyFillActive();
    }

    /**
     * 推进「全解锁镜头散场」的时钟（在 `step` 里每帧调）。
     *
     * 它只管**自己这只表**和「什么时候起淡」：
     *  · `elapsed >= 拉远时长` 那一帧起淡，时长切到 2s（见 {@link beginFillFade}）；
     *  · 到总时长收工 ⇒ `dollyElapsed = -1`（`dollyActive` 变 false、`dollyZoom` 回到 0），
     *    地图视图看到它变 false 就会把 `MapLayer` 还原、放开输入。
     */
    private stepDolly(delta: number): void {
        if (this.dollyElapsed < 0) return;
        this.dollyElapsed += delta;
        if (this.fillFadeElapsed < 0 && !this.fillDismissed
            && territoryCloudDollyFadeDue(this.dollyElapsed)) {
            // 拉远到位才起淡：起早了玩家还没看清全图，雾就淡掉一半。
            this.beginFillFade(TERRITORY_CLOUD_DOLLY_FADE_SECONDS);
        }
        if (this.dollyElapsed >= territoryCloudDollyTotalSeconds()) this.dollyElapsed = -1;
    }

    /** 每帧推进：镜头散场 + 铺满层退场 + 消散（待机是静止图，不再换帧）+ 让云洞层跟着地图走。 */
    step(dt: number): void {
        if (!this.layer?.isValid) return;
        this.syncPocketTransform();
        const delta = Number.isFinite(dt) && dt > 0 ? dt : 0;
        // ⚠️ 顺序：镜头时钟在最前（它负责"该不该起淡"），淡出紧随其后消费同一帧的 dt
        //    ⇒ 起淡那一帧就能写出第一个不透明度，不会白等一帧。
        this.stepDolly(delta);
        // ⚠️ 铺满层的退场要排在消散的早退之前：全解锁那一帧可能没有任何朵在消散
        //    （存档进来就是全解锁的），此时也得有人把雾淡掉。
        this.stepFillFade(delta);
        if (!this.dissolving.size) return;
        this.batching = true;
        this.stepDissolve(delta);
        this.batching = false;
        this.syncDissolveKeepOut();
    }

    /** 整体复位（换章 / 页面收起）：销毁全部云节点、清空挡云区与铺满层。 */
    reset(): void {
        // 云洞那朵消散中的云已经挪出云洞层（住在消散层里）⇒ 不在这两张表里，得单独销毁。
        for (const track of this.dissolving.values()) this.destroyTrackNodes(track);
        for (const sprite of this.sprites.values()) {
            if (sprite.node?.isValid) sprite.node.destroy();
        }
        for (const sprite of this.shadowSprites.values()) {
            if (sprite.node?.isValid) sprite.node.destroy();
        }
        this.sprites.clear();
        this.shadowSprites.clear();
        this.shown.clear();
        this.dissolving.clear();
        this.cells = [];
        this.clearKeepOut();
        this.clearFill();
        this.clearPocket();
        this.syncDissolveKeepOut();
    }

    // ============================================================
    // 挡云遮罩
    // ============================================================

    /** 挡云范围只在**已解锁集合**变化时重画（每秒都重画几百个多边形是纯浪费）。 */
    private syncKeepOut(cells: readonly ITerritoryCloudCell[], revealed: ReadonlySet<number>): void {
        const mask = this.keepOutMask;
        const graphics = this.keepOutGraphics;
        if (!mask || !graphics) return;
        if (sameSet(revealed, this.keepOutIds)) return;
        this.keepOutIds = new Set(revealed);
        this.rebuildKeepOut(cells);
    }

    /**
     * 重画挡云模具：每个已解锁格画一个「格面外扩 15px」的六边形。
     *
     * 位置用**格面中心**（布局点 + `HEX_GRID_CONTENT_LIFT`），与地块同源 ——
     * 少加这一下，擦除区会整体低 12.5px，上边缘的云会压到地块。
     */
    private rebuildKeepOut(cells: readonly ITerritoryCloudCell[]): void {
        const mask = this.keepOutMask;
        const graphics = this.keepOutGraphics;
        if (!mask || !graphics) return;
        graphics.clear();
        if (!this.keepOutIds.size) {
            if (mask.enabled) mask.enabled = false;
            return;
        }
        if (!mask.enabled) mask.enabled = true;
        const points = territoryCloudKeepOutPoints();
        graphics.fillColor = this.keepOutFill;
        for (const cell of cells) {
            if (!this.keepOutIds.has(cell.cellId)) continue;
            this.traceKeepOut(graphics, cell, points);
        }
        // 一次 `fill()`：重叠的六边形（相邻格）会在模板里合成一个并集，正是要的"沿岛外一圈"。
        graphics.fill();
    }

    /**
     * 把一个格的「地块轮廓外扩 15px」描进模具（`rebuildKeepOut` / 消散层共用）。
     *
     * ⚠️ 基准点是**格面中心**（`cell.y + HEX_GRID_CONTENT_LIFT`），不是节点位置：地皮图锚在
     * 整图中心，图心比格面中心低 12.5；而多边形是"格面 + 下方 2.5D 侧壁"外扩来的。
     */
    private traceKeepOut(
        graphics: Graphics,
        cell: ITerritoryCloudCell,
        points: readonly ITerritoryCloudPoint[],
    ): void {
        const centerX = cell.x;
        const centerY = cell.y + HEX_GRID_CONTENT_LIFT;
        for (let index = 0; index < points.length; index += 1) {
            const x = centerX + points[index].x;
            const y = centerY + points[index].y;
            if (index === 0) graphics.moveTo(x, y);
            else graphics.lineTo(x, y);
        }
        graphics.close();
    }

    private clearKeepOut(): void {
        this.keepOutIds = new Set<number>();
        this.keepOutGraphics?.clear();
        if (this.keepOutMask?.enabled) this.keepOutMask.enabled = false;
    }

    /**
     * 消散层的挡云区：**已解锁格**（= `keepOutIds`）里，**正在消散的那些格不画**。
     *
     * 于是消散中的那朵云：在自己那一格上完整地播（不吃擦除），溢出到邻居地块的部分照旧被擦
     * 15px —— 用户第三轮：「这部分的云朵也要与地块有间隔，且图层在地块的上方」。
     */
    private syncDissolveKeepOut(): void {
        const mask = this.dissolveMask;
        const graphics = this.dissolveGraphics;
        if (!mask || !graphics) return;
        const ids = this.dissolving;
        let changed = ids.size !== this.dissolveIds.size;
        if (!changed) {
            for (const cellId of ids.keys()) {
                if (this.dissolveIds.has(cellId)) continue;
                changed = true;
                break;
            }
        }
        if (!changed) return;
        this.dissolveIds = new Set(ids.keys());
        graphics.clear();
        if (!ids.size || !this.keepOutIds.size) {
            if (mask.enabled) mask.enabled = false;
            return;
        }
        if (!mask.enabled) mask.enabled = true;
        const points = territoryCloudKeepOutPoints();
        graphics.fillColor = this.dissolveFill;
        for (const cell of this.cells) {
            if (!this.keepOutIds.has(cell.cellId)) continue;
            if (ids.has(cell.cellId)) continue;
            this.traceKeepOut(graphics, cell, points);
        }
        graphics.fill();
    }

    /**
     * 批量期间只记账、批末统一重画（见 `batching`）；单独调用（公开的 `startDissolve`）就立即重画。
     */
    private syncDissolveKeepOutDeferred(): void {
        if (this.batching) return;
        this.syncDissolveKeepOut();
    }

    // ============================================================
    // 铺满背景（虚拟格点）
    // ============================================================

    /** 按 `fillPoints` 重建铺满层（几百个静态 Sprite；只在尺寸 / 行列 / 已盖格变化时走）。 */
    private rebuildFill(): void {
        const layer = this.fillLayer;
        if (!layer?.isValid) return;
        this.clearLayerNodes(layer, this.fillShadowGroup);
        this.fillSprites.length = 0;
        this.fillShadowSprites.length = 0;
        // 节点换了 ⇒ 上一套波次（与旧数组同下标）作废，等下一次起淡重编。
        this.fillWaveOrders = [];
        const group = this.fillShadowGroup?.isValid ? this.fillShadowGroup : null;
        const offsetY = territoryCloudArtOffsetY(TERRITORY_CLOUD_SCALE);
        for (const point of this.fillPoints) {
            const y = point.y + HEX_GRID_CONTENT_LIFT + offsetY;
            const body = this.createSprite(layer, 'CloudFill', this.idleFrame, TERRITORY_CLOUD_SCALE);
            body.node.setPosition(point.x, y, 0);
            this.fillSprites.push(body);
            if (!group) continue;
            // 影子与云体**同坐标同缩放**：两张图同画布 200×240、同锚点，不用任何补偿。
            const shadow = this.createSprite(group, 'CloudFillShadow', this.shadowFrame, TERRITORY_CLOUD_SCALE);
            shadow.node.setPosition(point.x, y, 0);
            this.fillShadowSprites.push(shadow);
        }
        // ⚠️ 退完场之后再重建（换章后尺寸变了）不许把雾又点亮 —— 与 `applyFillActive` 同口径。
        const show = this.fillPoints.length > 0 && !this.fillDismissed;
        layer.active = show;
        if (group) group.active = show;
        // 退场**中途**重建（换章同尺寸、只换了已盖格）：新节点是默认全不透明，
        // 不补这一笔就会"啪"地又亮起来 —— 重编波次后按当前已用时重画一帧。
        if (show && this.fillFadeElapsed >= 0) {
            this.prepareFillWave();
            this.applyFillWave(this.fillFadeElapsed);
        }
    }

    private clearFill(): void {
        const layer = this.fillLayer;
        if (layer?.isValid) this.clearLayerNodes(layer, this.fillShadowGroup);
        this.fillSprites.length = 0;
        this.fillShadowSprites.length = 0;
        this.fillPoints = [];
        this.fillKey = '';
        // 铺满层整个作废 ⇒ 退场时间轴也一并回到"从没淡过"（波次同理，节点都换了）。
        this.fillFadeElapsed = -1;
        this.fillDismissed = false;
        this.fillFadeSeconds = TERRITORY_CLOUD_FILL_FADE_SECONDS;
        this.fillWaveOrders = [];
        // 快照里没有在演的散场（换章时地图视图会跟着还原镜头）。
        this.dollyElapsed = -1;
    }

    // ============================================================
    // 云洞（被地块包围 ⇒ 搬到页面顶层、不裁剪、少放几朵）
    // ============================================================

    /**
     * 同步云洞 → 重建那几朵云。
     *
     * 三版口径（用户 2026-10-23 第三轮）：
     *  · **不裁剪**（正像遮罩已撤，云不再被切成白色六边形）；
     *  · **减少数量**：每个洞格只放**一朵**（原来是「洞格 + 六邻」7 朵）；
     *  · **轻微缩小**：`TERRITORY_CLOUD_POCKET_SCALE`，留出与地块的观感空隙；
     *  · 图层仍在**页面根**（压在地块与 UI 之上）。
     *
     * ## 洞格解锁 ⇒ 那朵云要**原地消散**，不许凭空消失（2026-10-26 六版）
     *
     * 老口径里洞格一旦解锁，`rebuildPocket` 会把它连节点一起销毁，同一帧解锁区那朵（1.0 倍）
     * 又被 `startDissolve` 点亮 ⇒ 实机是"一朵小云凭空没 + 一朵大云凭空来"。现在先把要走的
     * 那朵挪进消散层转成一条消散轨道（倍率仍是 0.6），再重建剩下的洞格。
     */
    private syncPocket(
        cells: readonly ITerritoryCloudCell[],
        pockets: readonly number[],
        revealed: ReadonlySet<number>,
    ): void {
        // 逐帧比较（每帧 `new Set` 是白白造垃圾）：长度 + 成员都对得上就直接返回。
        if (pockets.length === this.pocketCells.size) {
            let same = true;
            for (const cellId of pockets) {
                if (this.pocketCells.has(cellId)) continue;
                same = false;
                break;
            }
            if (same) return;
        }
        const previous = this.pocketCells;
        this.pocketCells = new Set(pockets);
        // 必须在 `rebuildPocket` **之前**：重建会把洞格里的云全部销毁，销毁了就没得散了。
        for (const cellId of previous) {
            if (this.pocketCells.has(cellId)) continue;
            // 只有"变成已解锁"才是解锁消散；洞格只是被挪出洞集合（连通块超过封顶 / 贴到边缘）
            // 时云本来就该消失，不值得播一段消散。
            if (!revealed.has(cellId)) continue;
            this.startPocketDissolve(cellId);
        }
        this.rebuildPocket(cells);
    }

    /** 按当前洞格重建云洞层里的云（洞格量被 `TERRITORY_CLOUD_POCKET_MAX_CELLS` 封顶过）。 */
    private rebuildPocket(cells: readonly ITerritoryCloudCell[]): void {
        const pocket = this.pocketNode;
        if (!pocket?.isValid) return;
        this.clearLayerNodes(pocket, this.pocketShadowGroup);
        this.pocketSprites.length = 0;
        this.pocketShadowSprites.length = 0;
        if (!this.pocketCells.size) return;
        const group = this.pocketShadowGroup?.isValid ? this.pocketShadowGroup : null;
        const scale = TERRITORY_CLOUD_SCALE * TERRITORY_CLOUD_POCKET_SCALE;
        // 偏移**按这一朵的倍率**算：缩得越小，美术重心离画布中心越近，写死常数会让云往下漂。
        const offsetY = territoryCloudArtOffsetY(scale);
        for (const cell of cells) {
            if (!this.pocketCells.has(cell.cellId)) continue;
            const y = cell.y + HEX_GRID_CONTENT_LIFT + offsetY;
            // 名字带 cellId：洞格解锁时得靠它把"要走的那一朵"从一堆同款云里认出来。
            const body = this.createSprite(pocket, `CloudPocket_${cell.cellId}`, this.idleFrame, scale);
            body.node.setPosition(cell.x, y, 0);
            this.pocketSprites.push(body);
            if (!group) continue;
            const shadow = this.createSprite(group, `CloudPocketShadow_${cell.cellId}`, this.shadowFrame, scale);
            shadow.node.setPosition(cell.x, y, 0);
            this.pocketShadowSprites.push(shadow);
        }
        // 刚建完就先对齐一次：`step` 里那次要到下一帧才跑，中间会闪一帧"云在错位置"。
        this.syncPocketTransform();
    }

    /**
     * 把一个刚解锁的洞格的云转成消散：挪进消散层 + 记一条轨道（倍率仍是云洞那档）。
     *
     * 为什么挪进**地图里**的 `CloudDissolveLayer` 而不是留在云洞层自己散：
     *  · 消散层的挡云区会把"正在消散的格"排除，云在自己那格上完整地散；
     *  · 云洞那朵缩到 0.6 倍只有 120px 宽，本来就够不着邻居那圈 15px 擦除区 ⇒ 不会被削边；
     *  · 两个层用的是**同一套地图局部坐标**（`CloudDissolveLayer` 自己也吃了 150 的内容层偏移），
     *    所以 `setParent` 不改局部坐标、云不会跳位（同 {@link startDissolve}）。
     */
    private startPocketDissolve(cellId: number): void {
        if (this.dissolving.has(cellId)) return;
        const body = this.findSprite(this.pocketNode, `CloudPocket_${cellId}`);
        if (!body?.node?.isValid) return;
        const shadow = this.findSprite(this.pocketShadowGroup, `CloudPocketShadow_${cellId}`);
        this.shown.delete(cellId);
        const layer = this.dissolveLayer;
        if (layer?.isValid && body.node.parent !== layer) body.node.setParent(layer);
        const group = this.dissolveShadowGroup;
        if (shadow?.node?.isValid && group?.isValid && shadow.node.parent !== group) {
            shadow.node.setParent(group);
            if (!shadow.node.active) shadow.node.active = true;
        }
        const track = this.beginTrack(
            cellId,
            body,
            shadow ?? null,
            true,
            TERRITORY_CLOUD_SCALE * TERRITORY_CLOUD_POCKET_SCALE,
        );
        const pose = this.poseAt(0);
        if (pose) this.applyDissolve(track, pose);
        this.syncDissolveKeepOutDeferred();
    }

    private clearPocket(): void {
        this.pocketCells = new Set<number>();
        const pocket = this.pocketNode;
        if (pocket?.isValid) this.clearLayerNodes(pocket, this.pocketShadowGroup);
        this.pocketSprites.length = 0;
        this.pocketShadowSprites.length = 0;
    }

    /**
     * 注入「内容层偏移」—— 由 `TerritoryMapView.applyContentShift` 每次现算后写进来。
     *
     * 两份留白都是运行时值，这个数**不能缓存成常量**，也不能在云层这边自己再算一遍
     * （算就会算成缺省值，见 {@link contentShiftY} 的注释）。
     *
     * 幂等：值没变直接返回，避免每帧 `syncContentSize` 都触发一次对齐。
     */
    setContentShiftY(shift: number): void {
        const value = Number.isFinite(shift) ? shift : territoryMapContentShiftY();
        if (value === this.contentShiftY) return;
        this.contentShiftY = value;
        this.syncPocketTransform();
    }

    /**
     * 让云洞层每帧对齐 `MapLayer`（世界位置 + 世界缩放）。
     *
     * 这样云洞层里的子节点可以继续用**地图局部坐标**摆位：地图滚动 / 推镜时不用逐格换算，
     * 只有这一个节点在动。没有洞时开销就是一次 `size` 判断。
     *
     * ## 🔴 必须把「内容层偏移」一起算进去（2026-10-26 修，2026-10-28 补注入）
     *
     * `territoryMapContentShiftY()` 是 `TerritoryMapView.applyContentShift` 写在
     * **`MapLayer` 的孩子**上的（格子层 / 云层 / 站点层 / 飘字层都 +shift），`MapLayer` 自己
     * 的 `worldPosition` 里**没有**这一截。
     *
     * 云洞层偏偏是**页面根**的孩子（要压在 UI 之上），之前直接
     * `pocket.setWorldPosition(map.worldPosition)` ⇒ 它整层比地块**低 150 地图像素**
     * （≈ 一排半格）。实机表现就是用户 2026-10-26 截图红圈：云洞里的云没落在洞里，
     * 而是压到了**下面那一排已解锁地块**上。
     *
     * 所以这里不能拿 `worldPosition` 直接对齐，要问 `MapLayer` 要「局部 `(0, shift)` 的世界坐标」，
     * 缩放在内的整条变换链一次算完。
     *
     * ⚠️ 2026-10-28 复发：这个 `shift` 又变回了「现算缺省值」（+150），而真值在 720×1280 上是
     * **342.5**（见 `territoryMapContentShiftY` 的运行时口径）⇒ 云洞整层低 192.5px（≈ 两排），
     * 云没落在洞里、而是压到了上面那排已解锁地块上（用户截图红圈）。
     * 现值一律取自 {@link contentShiftY}，由 `applyContentShift` 注入。
     */
    private syncPocketTransform(): void {
        const pocket = this.pocketNode;
        const map = this.mapLayer;
        if (!pocket?.isValid || !map?.isValid || !this.pocketCells.size) return;
        const shift = this.contentShiftY;
        const transform = map.getComponent(UITransform);
        const world = transform
            ? transform.convertToWorldSpaceAR(new Vec3(0, shift, 0))
            : null;
        if (world) {
            pocket.setWorldPosition(world.x, world.y, world.z);
        } else {
            // 拿不到 `UITransform`（prefab 结构被改 / 用例桩）时按纯平移降级：宁可差一个缩放系数，
            // 也不要整层掉下去 150。
            const scaleY = map.worldScale?.y ?? 1;
            pocket.setWorldPosition(map.worldPosition.x, map.worldPosition.y + shift * scaleY, map.worldPosition.z);
        }
        pocket.setWorldScale(map.worldScale);
    }

    // ============================================================
    // 单朵云
    // ============================================================

    /** 建一朵云（云体 + 影子），两人共用同一个落点。 */
    private createCloud(cellId: number): Sprite {
        const layer = this.layer;
        if (!layer) throw new Error('TerritoryCloudView 云层节点未绑定');
        const body = this.createSprite(layer, `Cloud_${cellId}`, this.idleFrame, TERRITORY_CLOUD_SCALE);
        this.sprites.set(cellId, body);
        const group = this.shadowGroup?.isValid ? this.shadowGroup : null;
        if (group) {
            this.shadowSprites.set(
                cellId,
                this.createSprite(group, `CloudShadow_${cellId}`, this.shadowFrame, TERRITORY_CLOUD_SCALE),
            );
        }
        return body;
    }

    /** 建一个云 Sprite 节点（`RAW` 跟帧的原始尺寸；云体 / 影子两张图同画布 ⇒ 节点尺寸天然一致）。 */
    private createSprite(parent: Node, name: string, frame: SpriteFrame | null, scale: number): Sprite {
        const node = new Node(name);
        node.layer = parent.layer;
        node.setParent(parent);
        node.addComponent(UITransform);
        const sprite = node.addComponent(Sprite);
        // 序列帧同画布（200×240）：`RAW` 让尺寸跟帧走，不用在这里写死。
        sprite.trim = false;
        sprite.sizeMode = Sprite.SizeMode.RAW;
        node.setScale(scale, scale, 1);
        if (frame && sprite.spriteFrame !== frame) sprite.spriteFrame = frame;
        return sprite;
    }

    /**
     * 摆位置（**唯一的落点公式**）。
     *
     * 落点 = 布局点 + `HEX_GRID_CONTENT_LIFT`（格面中心，与 `cellCenter` 同口径）
     * + `territoryCloudArtOffsetY(倍率)`（云体在 200×240 画布里偏上，**按倍率**压回来）。
     */
    private placeCloud(cellId: number, cell: ITerritoryCloudCell): void {
        const y = cell.y + HEX_GRID_CONTENT_LIFT + territoryCloudArtOffsetY(TERRITORY_CLOUD_SCALE);
        const body = this.sprites.get(cellId);
        if (body?.node?.isValid) this.moveNode(body.node, cell.x, y);
        const shadow = this.shadowSprites.get(cellId);
        if (shadow?.node?.isValid) this.moveNode(shadow.node, cell.x, y);
    }

    private moveNode(node: Node, x: number, y: number): void {
        if (node.position.x !== x || node.position.y !== y) node.setPosition(x, y, 0);
    }

    /** 写静止图 + 全不透明 + 原始倍率（幂等：同帧不重写，站点每秒刷新也标不脏）。 */
    private applyIdle(cellId: number): void {
        const sprite = this.sprites.get(cellId);
        const frame = this.idleFrame;
        if (!sprite || !frame) return;
        if (sprite.spriteFrame !== frame) sprite.spriteFrame = frame;
        this.writeOpacity(sprite, 1);
        // 消散过程中缩放被改过 ⇒ 回到待机必须复位，否则会停在一朵"半缩的云"上。
        this.writeScale(sprite, TERRITORY_CLOUD_SCALE);
        const shadow = this.shadowSprites.get(cellId);
        if (!shadow) return;
        this.writeOpacity(shadow, 1);
        this.writeScale(shadow, TERRITORY_CLOUD_SCALE);
    }

    /** 影子回到云层（回退时用：它可能跟着消散挪到了消散层）。 */
    private restoreShadow(cellId: number): void {
        const shadow = this.shadowSprites.get(cellId);
        const group = this.shadowGroup;
        if (!shadow?.node?.isValid || !group?.isValid) return;
        if (shadow.node.parent !== group) shadow.node.setParent(group);
        const frame = this.shadowFrame;
        if (frame && shadow.spriteFrame !== frame) shadow.spriteFrame = frame;
        this.writeScale(shadow, TERRITORY_CLOUD_SCALE);
    }

    /** 体 / 影一起显示或收起（云洞格的云由页面顶层那层负责，这里要收起）。 */
    private setCloudVisible(cellId: number, visible: boolean): void {
        const body = this.sprites.get(cellId);
        if (body?.node?.isValid && body.node.active !== visible) body.node.active = visible;
        const shadow = this.shadowSprites.get(cellId);
        if (shadow?.node?.isValid && shadow.node.active !== visible) shadow.node.active = visible;
    }

    /**
     * 一个解锁格起手消散：把云（和影子）挪进消散层，记一条轨道，并写起手姿态。
     *
     * 起手姿态不是"第 0 帧消散图"，而是**整朵云原样**（`index = -1`、缩放 1）——
     * 让"炸一下"的缩放先演，裂开才交给序列帧（见 `territoryCloudDissolveFrame` 的三段表）。
     */
    private startDissolve(cellId: number): void {
        if (this.dissolving.has(cellId)) return;
        const sprite = this.sprites.get(cellId);
        if (!sprite?.node?.isValid) {
            this.shown.delete(cellId);
            return;
        }
        this.shown.delete(cellId);
        // 云洞格平时是收起来的（云洞层那朵顶班）⇒ 起手要先点亮，否则"散"的是空气。
        if (!sprite.node.active) sprite.node.active = true;
        // 挪出遮罩层：这一格刚进挡云区，留在里面会被自己那块"云不许碰"擦掉 ⇒ 消散看不见。
        const dissolveLayer = this.dissolveLayer;
        if (dissolveLayer?.isValid && sprite.node.parent !== dissolveLayer) {
            sprite.node.setParent(dissolveLayer);
        }
        // 影子跟着挪（进影子分组 ⇒ 仍在这朵云体之下）。
        const shadow = this.shadowSprites.get(cellId) ?? null;
        const group = this.dissolveShadowGroup;
        if (shadow?.node?.isValid && group?.isValid && shadow.node.parent !== group) {
            shadow.node.setParent(group);
            if (!shadow.node.active) shadow.node.active = true;
        }
        // 消散层的挡云区要先把这一格排除，否则起手第一帧就被擦掉。
        this.syncDissolveKeepOutDeferred();
        // 消散帧一张都没有 ⇒ 不播姿态（下一帧 `stepDissolve` 就按时间收掉）。别硬写空帧把云画成白块。
        const track = this.beginTrack(cellId, sprite, shadow, false, TERRITORY_CLOUD_SCALE);
        const pose = this.poseAt(0);
        if (pose) this.applyDissolve(track, pose);
    }

    /** 记一条消散轨道（**同时**进 `dissolving`：这一帧的逐格循环靠它认出"这朵已经在散"）。 */
    private beginTrack(
        cellId: number,
        body: Sprite,
        shadow: Sprite | null,
        inPocket: boolean,
        baseScale: number,
    ): ITerritoryCloudDissolveTrack {
        const position = body.node.position;
        const track: ITerritoryCloudDissolveTrack = {
            body,
            shadow,
            inPocket,
            baseX: position.x,
            baseY: position.y,
            baseScale: Number.isFinite(baseScale) && baseScale > 0 ? baseScale : TERRITORY_CLOUD_SCALE,
            elapsed: 0,
        };
        this.dissolving.set(cellId, track);
        return track;
    }

    /** 按已用时取姿态（没有消散帧 ⇒ `null` = 该收了）。 */
    private poseAt(elapsed: number): ITerritoryCloudDissolveFrame | null {
        const frames = this.dissolveFrames;
        return frames.length ? territoryCloudDissolveFrame(elapsed, frames.length) : null;
    }

    private stepDissolve(dt: number): void {
        for (const cellId of Array.from(this.dissolving.keys())) {
            const track = this.dissolving.get(cellId);
            if (!track) continue;
            track.elapsed += dt;
            const frame = this.poseAt(track.elapsed);
            if (!frame) {
                // 没有消散帧也照样收尾（时间到了就收），避免"云永远散不掉"。
                this.dissolving.delete(cellId);
                this.settleDissolve(track);
                continue;
            }
            this.applyDissolve(track, frame);
        }
    }

    /**
     * 把一帧姿态写到节点上：**帧 / 缩放 / 上飘 / 不透明度** 一把写，体和影**各写一套**。
     *
     * 缩放与上飘都乘在**轨道记的起手值**上（不是节点当前值）—— 节点自身一直在变，
     * 拿它当基准会滚雪球（每帧再缩一点，半秒后就没有云了）。
     */
    private applyDissolve(track: ITerritoryCloudDissolveTrack, frame: ITerritoryCloudDissolveFrame): void {
        const body = track.body;
        if (!body?.node?.isValid) return;
        const intact = frame.index < 0;
        const art = intact ? this.idleFrame : this.dissolveFrames[frame.index] ?? null;
        if (art && body.spriteFrame !== art) body.spriteFrame = art;
        const scale = track.baseScale * frame.scale;
        this.writeScale(body, scale);
        this.moveNode(body.node, track.baseX, track.baseY + frame.liftY);
        this.writeOpacity(body, frame.opacity);

        const shadow = track.shadow;
        if (!shadow?.node?.isValid) return;
        // 影子按**同一个 index** 换帧（两套图是同一段动画的两层），但缩放 / 透明度走**自己那条**：
        // 云升起来、炸开的时候，地上的投影只会更小更淡（跟着放大就是"灰也炸开了"，一眼假）；
        // 而且它比云体**更早**归零 —— 否则云都散了、地上还剩一大团灰。
        const shadowArt = intact ? this.shadowFrame : this.dissolveShadowFrames[frame.index] ?? null;
        if (shadowArt && shadow.spriteFrame !== shadowArt) shadow.spriteFrame = shadowArt;
        this.writeScale(shadow, track.baseScale * frame.shadowScale);
        this.writeOpacity(shadow, frame.shadowOpacity);
    }

    /**
     * 消散收尾。
     *
     *  · 解锁区那朵是**常驻节点** ⇒ 复位（缩放 / 不透明度 / 隐藏），这一格若又变回未解锁还要用；
     *  · 云洞那朵是从云洞层借的**临时节点** ⇒ 直接销毁（云洞层会自己重建，留着就是一颗孤儿云）。
     */
    private settleDissolve(track: ITerritoryCloudDissolveTrack): void {
        if (track.inPocket) {
            this.destroyTrackNodes(track);
            this.syncDissolveKeepOutDeferred();
            return;
        }
        const body = track.body;
        if (body?.node?.isValid) {
            this.writeOpacity(body, 1);
            this.writeScale(body, track.baseScale);
            this.moveNode(body.node, track.baseX, track.baseY);
            if (body.node.active) body.node.active = false;
        }
        const shadow = track.shadow;
        if (shadow?.node?.isValid) {
            this.writeOpacity(shadow, 1);
            this.writeScale(shadow, track.baseScale);
            if (shadow.node.active) shadow.node.active = false;
        }
        this.syncDissolveKeepOutDeferred();
    }

    /** 取消消散（回退 / 回收）：解锁区那朵交给调用方复位，云洞那朵直接销毁。 */
    private cancelDissolve(cellId: number): void {
        const track = this.dissolving.get(cellId);
        if (!track) return;
        this.dissolving.delete(cellId);
        if (track.inPocket) {
            this.destroyTrackNodes(track);
            return;
        }
        // 解锁区那朵的缩放 / 位置已被消散改过 ⇒ 立刻复位，别让"半缩的云"留在云层里。
        const body = track.body;
        if (body?.node?.isValid) {
            this.writeScale(body, track.baseScale);
            this.moveNode(body.node, track.baseX, track.baseY);
        }
        const shadow = track.shadow;
        if (shadow?.node?.isValid) {
            this.writeScale(shadow, track.baseScale);
            this.moveNode(shadow.node, track.baseX, track.baseY);
        }
    }

    /** 销毁一条轨道借来的节点（只用于云洞那朵 —— 解锁区那朵是常驻节点，不能销毁）。 */
    private destroyTrackNodes(track: ITerritoryCloudDissolveTrack): void {
        if (!track.inPocket) return;
        if (track.body?.node?.isValid) track.body.node.destroy();
        if (track.shadow?.node?.isValid) track.shadow.node.destroy();
    }

    /** 按名字找一朵云（云洞层按 `CloudPocket_${cellId}` 命名，解锁消散时要靠它定位）。 */
    private findSprite(parent: Node | null, name: string): Sprite | null {
        const node = parent?.isValid ? parent.getChildByName(name) : null;
        return node ? node.getComponent(Sprite) : null;
    }

    private recycle(cellId: number): void {
        this.cancelDissolve(cellId);
        const sprite = this.sprites.get(cellId);
        if (sprite?.node?.isValid) sprite.node.destroy();
        const shadow = this.shadowSprites.get(cellId);
        if (shadow?.node?.isValid) shadow.node.destroy();
        this.sprites.delete(cellId);
        this.shadowSprites.delete(cellId);
        this.shown.delete(cellId);
        this.dissolving.delete(cellId);
    }

    // ============================================================
    // 小工具
    // ============================================================

    /** 给已经建好的 Sprite 补帧（美术晚到时用；帧为空就跳过）。 */
    private rebindSprites(sprites: readonly Sprite[], frame: SpriteFrame | null): void {
        if (!frame) return;
        for (const sprite of sprites) {
            if (sprite?.node?.isValid && sprite.spriteFrame !== frame) sprite.spriteFrame = frame;
        }
    }

    /** 清空一个层里的云节点（影子分组是常驻节点，只清它自己的孩子）。 */
    private clearLayerNodes(layer: Node | null, group: Node | null): void {
        if (!layer?.isValid) return;
        for (const child of [...layer.children]) {
            if (child === group) continue;
            if (child.isValid) child.destroy();
        }
        if (!group?.isValid) return;
        for (const child of [...group.children]) {
            if (child.isValid) child.destroy();
        }
    }

    /**
     * 写不透明度（值没变就不写）。
     *
     * 用 `sprite.color` 而不是给每朵云挂 `UIOpacity`：几百朵云各挂一个组件只为消散那 0.5s，
     * 而且 `UIOpacity` 会让节点退出静态合批。
     */
    private writeOpacity(sprite: Sprite, opacity: number): void {
        const value = Math.round(Math.max(0, Math.min(1, opacity)) * 255);
        if (sprite.color.a === value) return;
        this.tint.a = value;
        sprite.color = this.tint;
    }

    /** 写缩放（值没变就不写；`z` 恒 1，2D 节点不吃它）。 */
    private writeScale(sprite: Sprite, scale: number): void {
        const node = sprite.node;
        if (!node?.isValid) return;
        const value = Number.isFinite(scale) && scale > 0 ? scale : TERRITORY_CLOUD_SCALE;
        if (node.scale.x === value && node.scale.y === value) return;
        node.setScale(value, value, 1);
    }
}
