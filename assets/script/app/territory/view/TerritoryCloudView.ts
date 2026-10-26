import { Color, Graphics, Mask, Node, Sprite, SpriteFrame, UITransform } from 'cc';
import { HEX_GRID_CONTENT_LIFT } from '../../../core/hex/HexGridLayout';
import {
    TERRITORY_CLOUD_ART_OFFSET_Y,
    TERRITORY_CLOUD_POCKET_SCALE,
    TERRITORY_CLOUD_SCALE,
    territoryCloudDissolveFrame,
    territoryCloudFillPoints,
    territoryCloudKeepOutPoints,
    type ITerritoryCloudCell,
    type ITerritoryCloudDissolveFrame,
    type ITerritoryCloudPoint,
} from '../model/TerritoryCloud';

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
 * 影子分组节点名（每个云层里的**第一个**孩子）。
 *
 * 云体与影子是**两张同画布图**（`cloud_body_N` / `cloud_shadow_N`，由
 * `tools/split_cloud_layers.py` 离线拆出来）：云体照旧摆在层里，影子统一塞进这个分组 ——
 * 分组是索引 0 ⇒ **所有影子都在所有云体之下**。
 * 用户 2026-10-23 第三轮：「云层的影子部分的层级要比云层低」。
 */
export const TERRITORY_CLOUD_SHADOW_NODE = 'CloudShadow';

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
 * │   ├── CloudFillLayer   铺满背景的虚拟云
 * │   │   └── CloudShadow   它的影子（索引 0 ⇒ 在云体之下）
 * │   └── CloudLayer       未解锁云（静止图）
 * │       └── CloudShadow   它的影子（索引 0）
 * ├── CloudDissolveLayer  正在消散的云（**自带**一张"排除自己"的挡云遮罩）
 * │   └── CloudShadow      消散云的影子
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
 * · **影子永远成组压在云体之下**：影子与云体是两张同画布 PNG（`cloud_shadow_N` / `cloud_body_N`），
 *   同坐标摆放、影子进每组索引 0 的分组。做成两张图而不是运行时切 rect，原因见
 *   `TerritoryCloud.ts` 里「为什么这里没有切片换算」那段 —— 三版运行时切出来是反的，
 *   影子糊在云体上，整片云发灰。
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
    /** 云层的影子分组（`layer` 的第一个孩子 ⇒ 所有影子在云体之下）。 */
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
     * 「铺满背景」的虚拟云层（`CloudKeepOut` 的第一个孩子 ⇒ 画在真实格云之下）。
     *
     *  为什么要铺：用户 2026-10-23 第二轮「云的填充整个背景图全部填充，包括玩家信息和资源栏上方」——
     *  原来只在**格位**摆云，地图包围盒之外的留白（`TERRITORY_MAP_CONTENT_PADDING` = 四周 300px）
     *  一片云都没有，滚到边缘时顶部那条露出底图（截图 1 的红框）。
     */
    private fillLayer: Node | null = null;
    private fillShadowGroup: Node | null = null;
    /** 已生成的铺满格点（尺寸 / 行列变了才重算）。 */
    private fillPoints: readonly ITerritoryCloudPoint[] = [];
    /** 铺满层的云体 / 影子（`setFrames` 晚到时要把帧补给它们）。 */
    private readonly fillSprites: Sprite[] = [];
    private readonly fillShadowSprites: Sprite[] = [];
    /** 铺满区的指纹（内容层尺寸 + 行列）；同指纹不重建那几百个节点。 */
    private fillKey = '';
    private totalCells = 0;
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
    /** `MapLayer`（`CloudKeepOut` 的父节点）—— 云洞层每帧对齐它的世界变换。 */
    private mapLayer: Node | null = null;
    /** 最近一次 `sync` 的布局（消散层重画挡云区时要用格坐标）。 */
    private cells: readonly ITerritoryCloudCell[] = [];

    /** 云体（切过片）/ 影子（切过片）/ 消散帧（切过片）的节点表。 */
    private readonly sprites = new Map<number, Sprite>();
    private readonly shadowSprites = new Map<number, Sprite>();
    /** 正在待机（静止）盖着的格。**上一帧**的状态，diff 出"刚被解锁"的就是靠它。 */
    private readonly shown = new Set<number>();
    /** 正在散：`cellId → 已用时（秒）`。 */
    private readonly dissolving = new Map<number, number>();
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
        const keepOut = new Node(TERRITORY_CLOUD_KEEP_OUT_NODE);
        keepOut.layer = hexLayer.layer;
        keepOut.setParent(parent);
        keepOut.setSiblingIndex(sibling);
        keepOut.addComponent(UITransform);
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

        // ②-0 铺满层（虚拟格点）—— `CloudKeepOut` 的**第一个**子节点，画在真实格云之下。
        //      同一张遮罩 ⇒ 已解锁的地方连它一起擦，不用单独判一遍。
        const fill = new Node(TERRITORY_CLOUD_FILL_NODE);
        fill.layer = hexLayer.layer;
        fill.setParent(keepOut);
        fill.setSiblingIndex(0);
        fill.addComponent(UITransform);
        this.fillLayer = fill;
        this.fillShadowGroup = this.createShadowGroup(fill);

        // ② 云层（静止云）——挂在遮罩下，才会被擦。
        const layer = new Node(TERRITORY_CLOUD_LAYER_NODE);
        layer.layer = hexLayer.layer;
        layer.setParent(keepOut);
        layer.addComponent(UITransform);
        this.layer = layer;
        this.shadowGroup = this.createShadowGroup(layer);

        // ③ 消散层 —— 插在遮罩**之后**（遮罩之上、站点层之下）。
        //    ⚠️ 别写成 `parent.children.length`：那会跑到 `GainLayer` 之上，把飘字压住。
        const dissolve = new Node(TERRITORY_CLOUD_DISSOLVE_NODE);
        dissolve.layer = hexLayer.layer;
        dissolve.setParent(parent);
        dissolve.setSiblingIndex(sibling + 1);
        dissolve.addComponent(UITransform);
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
     * 建一个「影子分组」：层里的**第一个**孩子（索引 0）⇒ 影子画在所有云体之下。
     *
     * 一个分组顶掉"每朵云两套兄弟序"的做法：挪层 / 回退只动分组，不用逐朵算该插到第几位。
     */
    private createShadowGroup(parent: Node): Node {
        const group = new Node(TERRITORY_CLOUD_SHADOW_NODE);
        group.layer = parent.layer;
        group.setParent(parent);
        group.setSiblingIndex(0);
        group.addComponent(UITransform);
        return group;
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
        this.totalCells = rows > 0 && columns > 0 ? rows * columns : 0;
        this.fillRows = rows > 0 ? rows : 0;
        this.fillColumns = columns > 0 ? columns : 0;
        if (key === this.fillKey) return;
        this.fillKey = key;
        this.fillPoints = territoryCloudFillPoints(rows, columns, width, height);
        this.rebuildFill();
    }

    get layerNode(): Node | null {
        return this.layer?.isValid ? this.layer : null;
    }

    /** 云层的影子分组（用例核"影子在云体之下"用）。 */
    get shadowGroupNode(): Node | null {
        return this.shadowGroup?.isValid ? this.shadowGroup : null;
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

    /** 铺满层是否在展示（全地图解锁后为 `false`）。 */
    get fillVisible(): boolean {
        return this.fillLayer?.isValid === true && this.fillLayer.active;
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
     */
    sync(
        cells: readonly ITerritoryCloudCell[],
        revealed: ReadonlySet<number>,
        pockets: readonly number[] = [],
    ): void {
        const layer = this.layer;
        if (!layer?.isValid) return;
        this.cells = cells;
        if (!this.idleFrame) {
            this.reset();
            return;
        }
        // 全地图解锁 ⇒ 整片云收工（用户口径：「只有全地图解锁后才展示」）。
        // 光靠挡云区也能擦干净格位，但**内容层留白那圈虚拟云**没有对应的已解锁格，
        // 不显式关掉就会在"全解锁"后还挂着一圈雾 —— 影子同理，要跟着一起关。
        const allRevealed = this.totalCells > 0 && revealed.size >= this.totalCells;
        if (this.fillLayer?.isValid && this.fillLayer.active === allRevealed) {
            this.fillLayer.active = !allRevealed;
            if (this.fillShadowGroup?.isValid) this.fillShadowGroup.active = !allRevealed;
        }
        // 挡云区排在逐格之前：这一帧刚解锁的格子也要立刻进入"云不许碰"的范围。
        this.syncKeepOut(cells, revealed);
        this.syncPocket(cells, pockets);

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
                this.dissolving.delete(cellId);
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

    /** 每帧推进：只推进消散（待机是静止图，不再换帧）+ 让云洞层跟着地图走。 */
    step(dt: number): void {
        if (!this.layer?.isValid) return;
        this.syncPocketTransform();
        const delta = Number.isFinite(dt) && dt > 0 ? dt : 0;
        if (!this.dissolving.size) return;
        this.batching = true;
        this.stepDissolve(delta);
        this.batching = false;
        this.syncDissolveKeepOut();
    }

    /** 整体复位（换章 / 页面收起）：销毁全部云节点、清空挡云区与铺满层。 */
    reset(): void {
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

    /** 把一个格的「格面外扩 15px」描进模具（`rebuildKeepOut` / 消散层共用）。 */
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

    /** 按 `fillPoints` 重建铺满层（几百个静态 Sprite；只在尺寸 / 行列变化时走）。 */
    private rebuildFill(): void {
        const layer = this.fillLayer;
        if (!layer?.isValid) return;
        this.clearLayerNodes(layer, this.fillShadowGroup);
        this.fillSprites.length = 0;
        this.fillShadowSprites.length = 0;
        const group = this.fillShadowGroup?.isValid ? this.fillShadowGroup : null;
        for (const point of this.fillPoints) {
            const y = point.y + HEX_GRID_CONTENT_LIFT + TERRITORY_CLOUD_ART_OFFSET_Y;
            const body = this.createSprite(layer, 'CloudFill', this.idleFrame, TERRITORY_CLOUD_SCALE);
            body.node.setPosition(point.x, y, 0);
            this.fillSprites.push(body);
            if (!group) continue;
            // 影子与云体**同坐标同缩放**：两张图同画布 200×240、同锚点，不用任何补偿。
            const shadow = this.createSprite(group, 'CloudFillShadow', this.shadowFrame, TERRITORY_CLOUD_SCALE);
            shadow.node.setPosition(point.x, y, 0);
            this.fillShadowSprites.push(shadow);
        }
        layer.active = this.fillPoints.length > 0;
        if (group) group.active = layer.active;
    }

    private clearFill(): void {
        const layer = this.fillLayer;
        if (layer?.isValid) this.clearLayerNodes(layer, this.fillShadowGroup);
        this.fillSprites.length = 0;
        this.fillShadowSprites.length = 0;
        this.fillPoints = [];
        this.fillKey = '';
        this.totalCells = 0;
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
     */
    private syncPocket(cells: readonly ITerritoryCloudCell[], pockets: readonly number[]): void {
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
        this.pocketCells = new Set(pockets);
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
        for (const cell of cells) {
            if (!this.pocketCells.has(cell.cellId)) continue;
            const y = cell.y + HEX_GRID_CONTENT_LIFT + TERRITORY_CLOUD_ART_OFFSET_Y;
            const body = this.createSprite(pocket, 'CloudPocket', this.idleFrame, scale);
            body.node.setPosition(cell.x, y, 0);
            this.pocketSprites.push(body);
            if (!group) continue;
            const shadow = this.createSprite(group, 'CloudPocketShadow', this.shadowFrame, scale);
            shadow.node.setPosition(cell.x, y, 0);
            this.pocketShadowSprites.push(shadow);
        }
    }

    private clearPocket(): void {
        this.pocketCells = new Set<number>();
        const pocket = this.pocketNode;
        if (pocket?.isValid) this.clearLayerNodes(pocket, this.pocketShadowGroup);
        this.pocketSprites.length = 0;
        this.pocketShadowSprites.length = 0;
    }

    /**
     * 让云洞层每帧对齐 `MapLayer`（世界位置 + 世界缩放）。
     *
     * 这样云洞层里的子节点可以继续用**地图局部坐标**摆位：地图滚动 / 推镜时不用逐格换算，
     * 只有这一个节点在动。没有洞时开销就是一次 `size` 判断。
     */
    private syncPocketTransform(): void {
        const pocket = this.pocketNode;
        const map = this.mapLayer;
        if (!pocket?.isValid || !map?.isValid || !this.pocketCells.size) return;
        pocket.setWorldPosition(map.worldPosition);
        pocket.setWorldScale(map.worldScale);
    }

    // ============================================================
    // 单朵云
    // ============================================================

    /** 建一朵云（云体 + 影子），两人共用同一个落点。 */
    private createCloud(cellId: number): Sprite {
        const layer = this.layer!;
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
     * + `TERRITORY_CLOUD_ART_OFFSET_Y`（云体在 200×240 画布里偏上，压回来）。
     */
    private placeCloud(cellId: number, cell: ITerritoryCloudCell): void {
        const y = cell.y + HEX_GRID_CONTENT_LIFT + TERRITORY_CLOUD_ART_OFFSET_Y;
        const body = this.sprites.get(cellId);
        if (body?.node?.isValid) this.moveNode(body.node, cell.x, y);
        const shadow = this.shadowSprites.get(cellId);
        if (shadow?.node?.isValid) this.moveNode(shadow.node, cell.x, y);
    }

    private moveNode(node: Node, x: number, y: number): void {
        if (node.position.x !== x || node.position.y !== y) node.setPosition(x, y, 0);
    }

    /** 写静止图 + 全不透明（幂等：同帧不重写，站点每秒刷新也标不脏）。 */
    private applyIdle(cellId: number): void {
        const sprite = this.sprites.get(cellId);
        const frame = this.idleFrame;
        if (!sprite || !frame) return;
        if (sprite.spriteFrame !== frame) sprite.spriteFrame = frame;
        this.writeOpacity(sprite, 1);
        const shadow = this.shadowSprites.get(cellId);
        if (shadow) this.writeOpacity(shadow, 1);
    }

    /** 影子回到云层（回退时用：它可能跟着消散挪到了消散层）。 */
    private restoreShadow(cellId: number): void {
        const shadow = this.shadowSprites.get(cellId);
        const group = this.shadowGroup;
        if (!shadow?.node?.isValid || !group?.isValid) return;
        if (shadow.node.parent !== group) shadow.node.setParent(group);
        const frame = this.shadowFrame;
        if (frame && shadow.spriteFrame !== frame) shadow.spriteFrame = frame;
    }

    /** 体 / 影一起显示或收起（云洞格的云由页面顶层那层负责，这里要收起）。 */
    private setCloudVisible(cellId: number, visible: boolean): void {
        const body = this.sprites.get(cellId);
        if (body?.node?.isValid && body.node.active !== visible) body.node.active = visible;
        const shadow = this.shadowSprites.get(cellId);
        if (shadow?.node?.isValid && shadow.node.active !== visible) shadow.node.active = visible;
    }

    private startDissolve(cellId: number): void {
        const sprite = this.sprites.get(cellId);
        if (!sprite?.node?.isValid) {
            this.shown.delete(cellId);
            return;
        }
        this.shown.delete(cellId);
        this.dissolving.set(cellId, 0);
        // 云洞格平时是收起来的（云洞层那朵顶班）⇒ 起手要先点亮，否则"散"的是空气。
        if (!sprite.node.active) sprite.node.active = true;
        // 挪出遮罩层：这一格刚进挡云区，留在里面会被自己那块"云不许碰"擦掉 ⇒ 消散看不见。
        const dissolveLayer = this.dissolveLayer;
        if (dissolveLayer?.isValid && sprite.node.parent !== dissolveLayer) {
            sprite.node.setParent(dissolveLayer);
        }
        // 影子跟着挪（进影子分组 ⇒ 仍在这朵云体之下）。
        const shadow = this.shadowSprites.get(cellId);
        const group = this.dissolveShadowGroup;
        if (shadow?.node?.isValid && group?.isValid && shadow.node.parent !== group) {
            shadow.node.setParent(group);
            if (!shadow.node.active) shadow.node.active = true;
        }
        // 消散层的挡云区要先把这一格排除，否则起手第一帧就被擦掉。
        this.syncDissolveKeepOutDeferred();
        const frames = this.dissolveFrames;
        // 消散帧一张都没有 ⇒ 不播（时间到了由 `stepDissolve` 收）。别硬写空帧把云画成白块。
        const first = frames.length ? territoryCloudDissolveFrame(0, frames.length) : null;
        if (first) this.applyDissolve(cellId, first);
    }

    private stepDissolve(dt: number): void {
        const frames = this.dissolveFrames;
        for (const cellId of Array.from(this.dissolving.keys())) {
            const elapsed = (this.dissolving.get(cellId) ?? 0) + dt;
            const frame = frames.length ? territoryCloudDissolveFrame(elapsed, frames.length) : null;
            if (!frame) {
                // 没有消散帧也照样收尾（时间到了就收），避免"云永远散不掉"。
                this.dissolving.delete(cellId);
                this.settleDissolve(cellId);
                continue;
            }
            this.dissolving.set(cellId, elapsed);
            this.applyDissolve(cellId, frame);
        }
    }

    private applyDissolve(cellId: number, frame: ITerritoryCloudDissolveFrame): void {
        const sprite = this.sprites.get(cellId);
        if (!sprite) return;
        const art = this.dissolveFrames[frame.index];
        if (art && sprite.spriteFrame !== art) sprite.spriteFrame = art;
        this.writeOpacity(sprite, frame.opacity);
        // 影子按**同一个 index** 换帧（两套图是同一段动画的两层），一起淡出 ——
        // 否则云散到一半影子还在，像地上一块灰。
        const shadow = this.shadowSprites.get(cellId);
        if (!shadow) return;
        const shadowArt = this.dissolveShadowFrames[frame.index];
        if (shadowArt && shadow.spriteFrame !== shadowArt) shadow.spriteFrame = shadowArt;
        this.writeOpacity(shadow, frame.opacity);
    }

    /** 消散收尾：隐藏 + 复位（下次这格若又变成未解锁，得从静止帧重新显形）。 */
    private settleDissolve(cellId: number): void {
        const sprite = this.sprites.get(cellId);
        if (sprite) {
            this.writeOpacity(sprite, 1);
            if (sprite.node?.isValid && sprite.node.active) sprite.node.active = false;
        }
        const shadow = this.shadowSprites.get(cellId);
        if (shadow) {
            this.writeOpacity(shadow, 1);
            if (shadow.node?.isValid && shadow.node.active) shadow.node.active = false;
        }
        this.syncDissolveKeepOutDeferred();
    }

    private recycle(cellId: number): void {
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
}
