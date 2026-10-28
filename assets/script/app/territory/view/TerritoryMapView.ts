import { EventMgr } from '../../../framework/event/EventMgr';
import {
    _decorator,
    Color,
    Component,
    instantiate,
    Node,
    Prefab,
    Sprite,
    UITransform,
    Vec3,
} from 'cc';
import type { EffectAsset, SpriteFrame } from 'cc';
import {
    HEX_GRID_CONTENT_LIFT,
    HEX_GRID_FACE_HEIGHT,
    HEX_GRID_FACE_WIDTH,
    HEX_GRID_IMAGE_HEIGHT,
    HEX_GRID_IMAGE_WIDTH,
} from '../../../core/hex/HexGridLayout';
import {
    TERRITORY_GAIN_READOUT_LIFT_PX,
    TERRITORY_GAIN_STACK_GAP_PX,
    TERRITORY_GAIN_START_LIFT_PX,
    TERRITORY_SILVER_RES_ID,
    TERRITORY_STAMINA_RES_ID,
    territoryBurstCountForTotal,
} from '../model/TerritoryResourceGain';
import { TerritoryResourceGainView } from './TerritoryResourceGainView';
import { TerritoryGainBurst, TERRITORY_GAIN_BURST_NODE } from './TerritoryGainBurst';
import { TerritoryChestView, type ITerritoryChestIconEntry } from './TerritoryChestView';
import { TerritoryTapFeedback } from './TerritoryTapFeedback';
import type { TerritoryChestTier } from '../model/TerritoryChestTier';
import type { TerritoryCampaignStage } from '../model/TerritoryCampaignConfig';
import type { ITerritoryMapLayout, ITerritoryMapPoint } from '../model/TerritoryMapLayout';
import {
    TERRITORY_MAP_CONTENT_PADDING,
    TERRITORY_MAP_CONTENT_PADDING_TOP,
    territoryMapContentSize,
    territoryMapContentShiftY,
} from '../model/TerritoryMapLayout';
import type { TerritoryMapConfig, TerritorySite, TerritorySiteType } from '../model/TerritoryMapConfig';
import { TERRITORY_SITE_TYPE } from '../model/TerritoryMapConfig';
import type { TerritoryProgress } from '../model/TerritoryProgress';
import type {
    ITerritoryStationLayers,
    ITerritoryStationRender,
    TerritoryStationTarget,
} from './TerritoryStationView';
import { TerritoryStationView, territoryUsesBottomAnchor } from './TerritoryStationView';
import { TERRITORY_EVENTS } from './TerritoryEvents';
import { TERRITORY_HEX_REVEAL_NODE, TerritoryHexFlip } from './TerritoryHexFlip';
import { TerritoryHexSpawn } from './TerritoryHexSpawn';
import { territoryHexSpawnDelays } from '../model/TerritoryHexSpawn';
import {
    territoryCloudCells,
    territoryCloudDollyFitScale,
    type ITerritoryCloudCell,
} from '../model/TerritoryCloud';
import {
    TERRITORY_HEX_RECOLOR_NEW_NODE,
    TERRITORY_HEX_RECOLOR_OLD_NODE,
    TerritoryHexRecolor,
} from './TerritoryHexRecolor';
import { territoryHexRecolorDelays } from '../model/TerritoryHexRecolor';
import { TerritoryCloudView, type ITerritoryCloudFrames } from './TerritoryCloudView';
import { territoryCloudPocketCells } from '../model/TerritoryCloud';
import {
    TERRITORY_COLORS,
    TERRITORY_STATION_STATE,
    territoryBossTint,
    territoryStationTint,
    territoryUnboundTint,
} from './TerritoryTheme';
import type { TerritorySiteState } from './TerritoryTheme';

const { ccclass, property } = _decorator;

/**
 * 初始点位（`startCellId`）的气泡文案 —— 「章节」。
 *
 * 🔴 2026-10-28 用户：初始点位也要有气泡提示，提示词固定为「章节」。
 * （同日二次：原文案「章节选择」四字改成「章节」两字 —— 四字在 88 宽气泡里太挤，
 *   两字留白更接近美术稿；宽度预算见下条注释。）
 * 它与站点编号共用同一套气泡（`MAP_MARKER_BUBBLE_*`）：底图、字号、字距、抬升全都不另起一套，
 * 否则同一张图上会出现两种粗细 / 两种间距的角标。
 *
 * ⚠️ 文案**不许**带空格或换行：气泡宽 88、字 17 号，`章节` 两字正好 34 宽（余量 54），
 *    塞空格会白白吃掉字距预算；四字（68）虽然也装得下，但两边只剩 10px 显得顶格。
 */
export const TERRITORY_START_BUBBLE_TEXT = '章节';

/**
 * 异步据点（`asyncPvp`）的气泡文案 —— 「PVP」。
 *
 * 🔴 2026-10-28 用户：「异步据点气泡文案从【1-4】改为【PVP】」。
 *
 * 异步据点原本复用主线的 `章节-关卡` 编号（`${chapterId}-${stage}`），但它是**可重复挑战**的
 * 异步对战，编号会读成"第 4 关"（玩家以为打一次就过）；而 `PVP` 才是它真正的身份。
 * 底色仍沿用原有的「已通过 = 绿 / 未通过 = 红」二选一（见 `stationRenderOf`）。
 */
export const TERRITORY_ASYNC_PVP_BUBBLE_TEXT = 'PVP';

/** 地图渲染需要的建筑帧（页面持有更全的一套，多出的字段不影响结构类型兼容）。 */
export interface ITerritoryMapArt {
    /** 地图底图（`MapLayer/MapBackground` 的帧；null = 保持 prefab 默认）。 */
    readonly background: SpriteFrame | null;
    /**
     * **未通关**格的地皮：`img_land_02` 泥土块。
     *
     *  🔴 2026-10-16 换口径（山猫）：地皮按「通关 / 未通关」二选一，**不再三色染色**。
     *  未解锁、已解锁未通关、中立格**共用这一张** —— 「这一格有东西可打」由叠在上面的
     *  `frameBoss/frameStage/frameAsyncPvp/frameChest` 表达，不靠地皮区分。
     */
    readonly tileLocked: SpriteFrame | null;
    /** **已通关**格的地皮：`img_land_01` 草地块。 */
    readonly tileCleared: SpriteFrame | null;
    /**
     * 「已解锁但还没通关」的**格面高亮框**，按站点类型四选一；通关后一律摘掉。
     *
     *  ⚠️ 四张框都是 124×92 的六边形描边图，**贴地皮、不贴建筑** —— 它作为格子节点的子节点
     *  （`Frame`）渲染，所以天然在建筑图标之下、地皮之上。
     */
    readonly frameBoss: SpriteFrame | null;
    /**
     * 普通关卡（`stage`）的框。
     *
     * 🔴 2026-10-28 起**与首领同图（红）**：原来的 `frame_03` 紫框已被用户否掉。
     * 映射表里 `stage` 仍然指向这个槽位，换图只发生在 `TerritoryPageAssets` 的加载路径上。
     */
    readonly frameStage: SpriteFrame | null;
    /** 异步关卡（`asyncPvp`）的框。 */
    readonly frameAsyncPvp: SpriteFrame | null;
    /** 宝箱（`fixedResource`）的框。 */
    readonly frameChest: SpriteFrame | null;
    readonly start: SpriteFrame | null;
    readonly stage: SpriteFrame | null;
    readonly boss: SpriteFrame | null;
    /**
     * ⚠️ **已无渲染消费者**（2026-10-16 起）。
     *
     *  `asyncPvp` 并入「只有配了 `buildingId` 才画建筑」的口径后，这张固定图不再被任何分支取用
     *  （`TERRITORY_SITE_ART` 里那条映射已不可达）。暂不删：它同时是 `build.json` 里 `69002`
     *  的贴图来源，删字段要连 `loadTerritoryBattleArt` 的 `Promise.all` 一起改（两处一起改，
     *  否则漏一处只会在运行期报 `Bundle resources doesn't contain`）。
     */
    readonly asyncPvp: SpriteFrame | null;
    readonly fixedResource: SpriteFrame | null;
    /**
     * ⚠️ **已不是随机格的外观来源**（2026-10-10 起）。
     *
     * 随机格改成**逐格**取建筑（`randomSites.buildingIds[cellId]` → `buildFrames`），
     * 没配 id 的开启格只显示绿色地块、不给建筑图 ⇒ 这张固定图**没有渲染消费者了**。
     *
     * 暂不删：`territory_random_resource_v1` 同时是 `build.json` 里 `69006` 的贴图来源，
     * 删字段会连带要从 `loadTerritoryBattleArt` 的 `Promise.all` 里摘掉那一项。
     * 真要清理时**两处一起改**，否则会漏。
     */
    readonly randomResource: SpriteFrame | null;
    readonly randomSilverIcon: SpriteFrame | null;
    readonly bonus: SpriteFrame | null;
    /**
     * 关卡编号气泡底图（蓝，`image/spawn-region/frame_03`）。
     *
     * 🔴 2026-10-28 16:23 用户：「改回蓝色」⇒ 气泡**不再按通关状态分色**，所有格子同一张。
     * （此前试过「已通关绿 / 未通关红」，判据是 `progress.isAreaPassed`，已否决。）
     * 通关状态改由**地皮图**（`img_land_01` 草地 / `img_land_02` 泥土）表达，
     * 气泡只负责「这一格是第几关」这件事。
     */
    readonly levelBubbleFrame?: SpriteFrame | null;
    /**
     * 关卡编号气泡的**未通关**槽位 —— 目前与 {@link levelBubbleFrame} 同图（蓝色）。
     *
     * 字段保留只为不打乱二选一管线；取不到时回退 {@link levelBubbleFrame}：
     * 宁可同色一下，也不能没气泡 —— 编号是这一格唯一的关卡标识（`stationRenderOf` 里做兜底）。
     */
    readonly levelBubblePendingFrame?: SpriteFrame | null;
    /**
     * **建筑表按 `buildId` 查到的帧**（`buildId` → 帧）。
     *
     *  这一路优先于上面那组「按站点类型固定取图」的字段：外观由**地图 JSON 配的 `buildingId`**
     *  决定（山猫2026-10-10 口径「地图编辑配置哪个 id 就用哪个 id」）。
     *  查不到 / 没配 id 才回退到 `TERRITORY_SITE_ART` 那套。
     */
    readonly buildFrames?: ReadonlyMap<number, SpriteFrame | null>;
    /**
     * `buildId → buildSize`（表的「模型大小」，缺省 1）。
     *
     *  与 {@link buildFrames} 分开查：帧负责「画哪张图」，倍率负责「这张图多大」。
     *  查不到 / 缺省一律按 1 —— 与引入该字段之前的表现完全一致。
     */
    readonly buildScales?: ReadonlyMap<number, number>;
}

/**
 * 站点类型 → 建筑帧字段（2026-10-09 换新美术：关卡建筑图按类型分）。
 *
 *  起始格（`startCellId`）**不在 `sites` 里**，单独走 `start`。
 *  改建筑外观只需动两处：这里的字段名 + `TerritoryPageAssets.loadTerritoryBattleArt` 的加载路径。
 */
/**
 * 只允许指向「单个 SpriteFrame 字段」。
 *
 *  ⚠️ 不能直接写 `keyof ITerritoryMapArt` —— `ITerritoryMapArt` 新增了 `buildFrames`（一张
 *  `ReadonlyMap`），`keyof` 会把它算进来，于是 `art[TERRITORY_SITE_ART[type]]` 的类型变成
 *  `SpriteFrame | ReadonlyMap<…>`，`stationIconOf` 的返回类型就跟着不匹配（TS2322）。
 * 用 `Exclude` 按「值的类型不是 SpriteFrame」排除，比条件类型直观。
 */
type TerritorySiteArtKey = Exclude<
    keyof ITerritoryMapArt,
    { [K in keyof ITerritoryMapArt]: ITerritoryMapArt[K] extends SpriteFrame | null ? never : K }[keyof ITerritoryMapArt]
>;

/**
 * 站点类型 → 建筑帧字段（按 type 取图的那条**兜底**路径）。
 *
 * 🔴 只有 `fixedResource` / `bonus` 会真的走到这里：`stage` / `boss` / `asyncPvp`
 * 在 `stationIconOf` 里就「没配 `buildingId` ⇒ `return null`」早退了，映射表里那三条
 * **不可达**（保留是为了类型完整 + 万一口径再放宽时不用回来补表）。
 * 改建筑外观只需动两处：这里的字段名 + `TerritoryPageAssets.loadTerritoryBattleArt` 的加载路径。
 */
const TERRITORY_SITE_ART: Readonly<Record<TerritorySiteType, TerritorySiteArtKey>> = {
    stage: 'stage',
    boss: 'boss',
    asyncPvp: 'asyncPvp',
    fixedResource: 'fixedResource',
    bonus: 'bonus',
};

/**
 * 「已解锁未通关」站点类型 → 格面高亮框字段（2026-10-16 山猫定：框放**立体格子上**）。
 *
 *  ⚠️ `bonus` **不在表里** —— 四张美术框分别给了首领 / 普通关卡 / 异步关卡 / 宝箱，
 *  奖励据点没有对应框，所以查不到就**不叠框**（`?? null`）。别为了"表要全"给它硬指一张。
 */
const TERRITORY_SITE_FRAME: Readonly<Partial<Record<TerritorySiteType, TerritoryFrameKey>>> = {
    boss: 'frameBoss',
    stage: 'frameStage',
    asyncPvp: 'frameAsyncPvp',
    fixedResource: 'frameChest',
};

/** 只允许指向 `ITerritoryMapArt` 里那四个「框」字段。 */
type TerritoryFrameKey = 'frameBoss' | 'frameStage' | 'frameAsyncPvp' | 'frameChest';

/** 格面高亮框的节点名（`createHex` 建、`applyHexFrame` 换帧）。 */
const HEX_FRAME_NODE_NAME = 'Frame';

/**
 * 宝箱「生成」抖动比地块那一下**晚多少秒**（需求 2026-10-22 §3：
 * 「宝箱生成动画需要比地块生成动画稍晚展示」）。
 *
 *  · 地块（地皮换色 / 翻转）在**这一帧**就发生，宝箱是叠在同一个格子上的次级元素；
 *    同一帧一起动会读成「整格整体弹了一下」，读不出"格子上长出一只宝箱"。
 *  · `0.22s` ≈ 地块动效的第一段收势，此时再抖宝箱，前后关系清楚、又不会让人等。
 *  ⚠️ 别调到 0.4s 以上：`syncStations` 每秒才全量走一遍，太晚会被下一轮渲染盖掉节奏感。
 */
const CHEST_SPAWN_SHAKE_DELAY_SECONDS = 0.22;

/**
 * 一格待播的「换色」：本帧地皮**帧 → 帧**真的变了，攒起来统一算错峰。
 *
 *  为什么不在 `paintHexes` 的循环里直接 `play`：错峰要按**这一批**的簇心排
 *  （见 `territoryHexRecolorDelays`），循环里一格一格播就只能按扫描顺序，屏幕上读成乱序闪。
 */
interface ITerritoryHexRecolorPending {
    readonly cellId: number;
    readonly node: Node;
    readonly from: SpriteFrame | null;
    readonly to: SpriteFrame | null;
    readonly x: number;
    readonly y: number;
}

/**
 * 开箱镜头「地图那一半」的基准（只在开演前量**一次**）。
 *
 *  · `origin`：被点格子的台面中心，**覆盖层坐标**；
 *  · `layerOrigin`：`MapLayer` 的原点，同样换算到覆盖层坐标；
 *  · `basePos` / `baseScale`：`MapLayer` 原始的 position / scale（收工要原样还回去）。
 *
 *  ⚠️ 每帧现量会把"已经挪过的位置"当成原点 ⇒ 镜头成了一条越推越远的加速曲线。
 */
interface ITerritoryChestCameraBase {
    readonly origin: Vec3;
    readonly layerOrigin: Vec3;
    readonly basePos: Vec3;
    readonly baseScale: Vec3;
}

/** 一次完整的地图渲染输入（纯数据 + 只读状态查询）。 */
export interface ITerritoryMapRenderInput {
    readonly map: TerritoryMapConfig;
    readonly layout: ITerritoryMapLayout;
    readonly art: ITerritoryMapArt;
    readonly progress: TerritoryProgress;
    readonly revealedCells: readonly number[];
    readonly siteOpenableCells: readonly number[];
    /** cellId → 已绑定的关卡；固定资源点不绑定战斗关卡。 */
    readonly stageByCell: ReadonlyMap<number, TerritoryCampaignStage>;
    readonly randomResourceOpenableCells: readonly number[];
    readonly pendingRandomResourceCells: readonly number[];
    readonly pendingFixedResourceCells: readonly number[];
}

/**
 * 一条**合成**的奖励读数（见 {@link TerritoryMapView.playResourceGain} 的 `readout`）。
 *
 * 随机资源格一次会发好几种种族经验，页面上不想要「4 行、4 个不同的图」——
 * 所以把图标统一成一张（`TERRITORY_RANDOM_GAIN_READOUT_ART`）、数字取总和，
 * **只出一条**；喷发粒子不受影响（仍按每种奖励各自的图）。
 *
 * ⚠️ 图是 `SpriteFrame`（cc 类型），所以这个接口只能放在 view 层，不能落到
 *   `model/TerritoryResourceGain`（那里必须零 `cc`）。
 */
export interface ITerritoryGainReadout {
    /** 读数前面那张图；`null` = 没取到图，只飘数字（与逐条模式的降级口径一致）。 */
    readonly frame: SpriteFrame | null;
    /** 要显示的数量 —— 多笔奖励时是**全部数量之和**。 */
    readonly amount: number;
}

/**
 * 领地地图的**数据渲染层**，挂在 `MainTerritoryMap.prefab` 的 `MapLayer`（滚动内容节点）上。
 *
 *  它只做两件事，别的一概不碰：
 *  1. 按 `ITerritoryMapLayout` 摆六边格（`GridLayer`）；
 *  2. 把「站点 + 进度」算成 `ITerritoryStationRender` 喂给池化复用的 `TerritoryStationView`。
 *
 *  **不负责**：拖拽（归 `cc.ScrollView`）、主城 HUD 文案（归 `MainPage`）、
 *  弹窗（归 `LevelInfoPanel` / `BigMapPlayerLevelPanel`）、数据加载与存档（归页面）。
 *
 *  站点之间的**解锁连线已去掉**（2026-10-01）—— 原来由 `RouteLayer` 的 `Graphics`
 *  按 `site.unlock.requiredCells` 整层重画，视觉上太乱，改由**编辑器**（`tools/map-editor/territory.html`）
 *  的「依赖连线」开关承担查看职责，运行时不再绘制。
 *
 *  ⚠️ **节点按 cellId diff 复用，不再每次 `destroyAllChildren` 重建。**
 *  旧实现里 `tickProgress`（每秒）会走一遍 `drawMap()` → `clearPage()`，把 100+ 个六边格节点
 *  连同十几张站点一起销毁重建；现在只有**换章节**才会动格子（几何变了），同一章内每秒只更新
 *  站点的状态色与文案 —— 节点实例全程不变。
 */
@ccclass('TerritoryMapView')
export class TerritoryMapView extends Component {
    /**
     * `MapLayer/MapBackground`：地图底图。
     *
     * 🔴 它**必须在 `MapLayer` 里**（不能挂在页面根或 `MapViewport` 上）——
     * 那两处都在 `cc.ScrollView` 的 content 之外 ⇒ 滑动时格子走、背景不动，
     * 表现为「格子飘在一张静止的底图上」（2026-10-10 修）。
     * 渲染序同理：它必须是 `MapLayer` 的**第一个子节点**，格子才画在背景上（子节点顺序 = 渲染序）。
     */
    @property({ type: Sprite, group: '节点引用', tooltip: 'MapLayer/MapBackground：随地图一起滑动的底图（须是 MapLayer 第一个子节点）' })
    mapBackground: Sprite = null!;

    @property({ type: Node, group: '节点引用', tooltip: 'GridLayer：六边格容器（按 cellId 复用）' })
    gridLayer: Node = null!;

    @property({ type: Node, group: '节点引用', tooltip: 'StationIconLayer：连续渲染全部建筑图标' })
    stationIconLayer: Node = null!;

    @property({ type: Node, group: '节点引用', tooltip: 'StationCaptionLayer：连续渲染全部名称底条' })
    stationCaptionLayer: Node = null!;

    @property({ type: Node, group: '节点引用', tooltip: 'StationTextLayer：连续渲染全部站点名称' })
    stationTextLayer: Node = null!;

    @property({ type: Node, group: '节点引用', tooltip: 'StationBadgeLayer：连续渲染全部站点角标' })
    stationBadgeLayer: Node = null!;

    @property({ type: Node, group: '节点引用', tooltip: 'StationHitLayer：只保存站点按钮根节点' })
    stationHitLayer: Node = null!;

    @property({ type: Prefab, group: '节点引用', tooltip: '站点条目 prefab（ui/territory/TerritoryStation）' })
    stationPrefab: Prefab = null!;

    @property({ type: Prefab, group: '节点引用', tooltip: '资源飘字 prefab（ui/territory/TerritoryResourceGain）' })
    gainPrefab: Prefab = null!;

    /**
     * 开箱表演的覆盖层 prefab（`ui/territory/TerritoryChest`）。
     *
     * 节点树（Backdrop / Stage / 光效 / ChestArt / Fly）在 prefab 里，`TerritoryChestView`
     * 只取引用 + 每帧重画 —— 别再退回构造函数里 `new Node` 拼层级（Inspector 里看不见、改不了）。
     */
    @property({ type: Prefab, group: '节点引用', tooltip: '开箱表演 prefab（ui/territory/TerritoryChest）' })
    chestPrefab: Prefab = null!;

    /**
     * `MapLayer/GainLayer`：飘字容器（**必须是 MapLayer 的最后一个子节点**）。
     *
     * 挂在 `MapLayer` 里 ⇒ 与格子同一坐标系、随地图一起滚动；排在最后 ⇒ 画在全部站点之上。
     */
    @property({ type: Node, group: '节点引用', tooltip: 'MapLayer/GainLayer：资源飘字容器（MapLayer 最后一个子节点）' })
    gainLayer: Node = null!;

    /** cellId → 六边格节点。 */
    private readonly hexNodes = new Map<number, Node>();
    /**
     * cellId → 格面高亮框的 Sprite（`hexNodes` 的子节点 `Frame`）。
     *
     *  独立缓存是为了省掉每帧 `getChildByName`；生命周期与 `hexNodes` 同进同出
     *  （见 `syncGrid` 的淘汰段）。
     */
    private readonly hexFrames = new Map<number, Sprite>();
    /** cellId → 站点视图（含「起点」以外的全部站点）。 */
    private readonly stationViews = new Map<number, TerritoryStationView>();
    /** 起始格单独一个实例：唯一、不可点、不参与池化。 */
    private startView: TerritoryStationView | null = null;
    /** 上一次渲染的地图标识；变了才重建格子（同一章内每秒 tick 只更新站点状态）。 */
    private gridKey = '';
    private stationLayers: ITerritoryStationLayers | null = null;

    /**
     * 随机资源格的「翻开」表现 —— 与对局地块激活共用同一份动作曲线与透视材质
     * （见 `TerritoryHexFlip` 的类注释）。
     */
    private readonly hexFlip = new TerritoryHexFlip();
    /** 已记录为「已开启」的随机候选格；用来 diff 出**本次新翻开**的那几格。 */
    private readonly openedRandomCells = new Set<number>();
    /**
     * 是否已经用首帧做过一次「已开启」快照。
     *
     * 🔴 少了它，进页面 / 换章的首帧会把**历史上所有**已开启的随机格都当成「刚翻开」，
     * 一次性放出一串翻格动画。
     */
    private hexFlipBootstrapped = false;

    /**
     * 「新地块生成」表现（2026-10-22）：整格透明渐显 + 由小变大，多格按簇心错峰。
     *
     *  与 `hexFlip` 的分工见 `model/TerritoryHexSpawn` 的模块注释：翻格是**玩家点开某一格**，
     *  生成是**进度推进后新露出的一批格**。同一格两件事撞上时以翻格优先。
     */
    private readonly hexSpawn = new TerritoryHexSpawn();
    /**
     * 「关卡通过后地皮换色」（2026-10-23）：旧地皮缩小淡出 + 新地皮放大淡入，多格按簇心错峰。
     *
     *  三方让位顺序 **翻格 > 生成 > 换色**：翻格起播时会 `hexRecolor.stop(node)`（翻格要靠
     *  格根地皮演"旧 → 新"，而换色正把格根地皮藏着，两套一起跑必然打架）；生成与换色靠
     *  `isPlaying` 判据互相避开。见 `view/TerritoryHexRecolor` 的类注释。
     */
    private readonly hexRecolor = new TerritoryHexRecolor();
    /**
     * 是否已经用首帧做过一次「换色」破冰。
     *
     *  🔴 与 `hexFlipBootstrapped` / `spawnBootstrapped` 同一个理由：进页面 / 换章的首帧，
     *  整张图的地皮帧都会"从一开始的 null 变成正式帧"—— 不闸住就是**全屏一起换色**。
     */
    private recolorBootstrapped = false;
    /**
     * 「未解锁云」（2026-10-23）：没露出来的格位盖一朵循环飘动的云，那一格露出的那一帧
     * 就地播一次消散并收掉。层序 / 落点 / 帧推进都在 `TerritoryCloudView` 里，这里只负责接线。
     */
    private readonly clouds = new TerritoryCloudView();
    /**
     * 云要盖的格位 —— **只有地图里配置过的那几十格**（站点 + 随机候选 + 起始格），
     * 不是整张图的 400 个格位（口径见 `syncClouds`）。`cloudCellsKey` 变了才重建。
     */
    private readonly cloudCells: ITerritoryCloudCell[] = [];
    /** 上面那份快照的指纹：`格位总数 | 站点数 | 随机候选格数 | 起始格`。 */
    private cloudCellsKey = '';
    /**
     * 上一帧**已露出**的格子集合 —— 生成本身就是「这一帧有、上一帧没有」的 diff。
     *
     *  ⚠️ 只在 `paintHexes` 里维护；换章 / 布局重建时必须清空（否则新图上的格子会被判成"新增"）。
     */
    private readonly revealedSnapshot = new Set<number>();
    /**
     * 上一帧**已解锁**的格子集合（2026-10-28）。
     *
     * 为什么光有 `revealedSnapshot` 不够：`revealed` 里本来就包含「前沿看得见、还没花钱开」的格子，
     * 关卡格从「锁着（银币 + 数字）」变成「已解锁（关卡建筑）」时它**前后都在 revealed 里**
     * ⇒ 露出集合的 diff 恒为 0，解锁这一步就静默换了外观、没有动画。
     * 用户口径：「点击地块消耗银币，播放地块切换成关卡地块的动画（与其他新生成的地块动画一致）」。
     *
     * ⚠️ 与 `revealedSnapshot` 同生共死：同一帧更新、换章时一起清空。
     */
    private readonly unlockedSnapshot = new Set<number>();
    /**
     * 是否已经用首帧做过一次「已露出」快照。
     *
     * 🔴 与 `hexFlipBootstrapped` 同一个理由：少了它，进页面 / 换章的首帧会把**整张图**的格子
     * 都当成"刚生成"，上百格一起淡入 —— 表现为"进页面地图闪一下才出来"。
     */
    private spawnBootstrapped = false;

    /**
     * 「建筑展示要滞后到地块翻转结束」的待办格（需求 2026-10-16 row14）—— **key 存在 = 还在等**。
     *
     *  随机资源格翻开的那一帧，进度上已经是「已开启」，但地皮正在翻 ⇒ 建筑**先不出现**；
     *  本格的 `hexFlip` 播完才由 {@link resolveBuildingReveal} 补上建筑并播一次生成抖动。
     *
     *  ⚠️ 没有翻格表现时（没注入 effect ⇒ `play` 返回 `false`）**不会**登记 ⇒ 建筑照旧立刻出现，
     *    不会出现「格子不动、建筑也不出来」的静默丢失。
     */
    private readonly pendingBuildingReveal = new Set<number>();
    /**
     * 上面那些格子**这一帧**该用的站点数据 —— 由 `syncStations` 每次渲染刷新。
     *
     *  为什么要存下来：解除待办发生在 `update`（每帧），而站点数据只在 `renderMap` 里算得出，
     *  两者不同拍。存的是**最新一版**（同一格在等待期间还会被每秒的 tick 重算）。
     */
    private readonly pendingBuildingRender = new Map<number, ITerritoryStationRender>();

    /** 飘字用的资源图标：`resId → 帧`（页面在资源就绪后注入，缺哪张只是那一条没图标）。 */
    private gainIcons = new Map<number, SpriteFrame | null>();
    /** 正在播的飘字。 */
    private readonly activeGains: TerritoryResourceGainView[] = [];
    /** 播完回收的飘字（有界复用池，不无限新建节点）。 */
    private readonly gainPool: TerritoryResourceGainView[] = [];
    /**
     * 喷发粒子的容器层：`GainLayer` 的**第一个子节点**（需求 2026-10-16 row17）。
     *
     *  ⚠️ 排第一是**顺序要求**，不是随手写：子节点顺序 = 渲染顺序，喷出来的图标要画在
     *  「+N 读数」（`activeGains` 的节点，后建 ⇒ 排在后面）**之下**，
     *  否则粒子飞过读数时会把数字盖掉。见 {@link ensureBurstRoot}。
     */
    private burstRoot: Node | null = null;
    /** 正在喷的粒子组。 */
    private readonly activeBursts: TerritoryGainBurst[] = [];
    /** 喷完回收的粒子组（与 `gainPool` 同一套有界复用策略）。 */
    private readonly burstPool: TerritoryGainBurst[] = [];
    /**
     * 喷发抖动种子（每次点击自增）。
     *
     *  ⚠️ 用自增计数而不是 `Math.random()`：纯函数对同一 seed 必须**可复现**
     *  （单测验「倒圆锥」那条不等式就靠它），「每次不一样」由这里换 seed 提供。
     */
    private burstSeed = 0;

    /** 页面坐标系覆盖层宿主（点击反馈 + 开箱表演都挂它上面）。 */
    private overlayHost: Node | null = null;
    /** 开箱表演（懒建在覆盖层上；三档参数走 `model/TerritoryChestAnimation`）。 */
    private chestView: TerritoryChestView | null = null;
    /** 点击反馈（按压回弹 + 绿色光圈 + 蓝色圆环）。 */
    private tapFeedback: TerritoryTapFeedback | null = null;
    /**
     * 宝箱**补帧序列**（`image/territory/chest/chest_seq_0 … chest_seq_N-1`）。
     *
     *  第 0 张闭合、最后一张全开（`zw_0005`），中间帧由 `tools/gen_chest_open_frames.py` 烘焙。
     *  空数组 = 只播光效、没有箱体（与「资源缺失静默降级」同口径）。
     */
    private chestArt: readonly (SpriteFrame | null)[] = [];
    /**
     * 上一轮渲染时**摆着宝箱**的格子（固定资源格，需求 2026-10-22 §1）。
     *
     *  判「刚生成宝箱」只能靠 diff：`syncStations` 每秒全量走一遍，没有「新增」事件可用。
     */
    private readonly chestCells = new Set<number>();
    /**
     * 是否已经用首帧做过一次「摆着宝箱」快照。
     *
     *  🔴 少了它，进页面 / 换章的首帧会把**所有**固定资源格都当成「刚生成」，
     *  一屏几十个宝箱同时抖一下。
     */
    private stationsReady = false;
    /**
     * 「再等几秒就抖一下」的宝箱格（`cellId → 剩余秒`）。
     *
     *  为什么不直接 `playBuildingShake()`：需求要求宝箱比**地块**晚一点动（见
     *  `CHEST_SPAWN_SHAKE_DELAY_SECONDS`），而 `playBuildingShake` 是"立刻开始"的。
     *  与全工程一致，不建 tween/定时器 —— 在 `update` 里扣时间，扣到 0 再播
     *  （节点销毁时 Map 一起走，没有悬空回调）。
     */
    private readonly chestSpawnDelay = new Map<number, number>();
    /**
     * 正在播开箱表演的格子（`null` = 没在播）。
     *
     *  表演用的是**覆盖层**里那只宝箱，地图格子上那只还在（进度没变）—— 两只叠在一起时
     *  看不出问题，但收尾淡出会把覆盖层那只淡掉，**底下那只就露出来了**，
     *  读作「宝箱没消失」（需求 2026-10-22 §2「奖励光效和宝箱消失同步关闭」）。
     *  所以表演期间把地图上那一格的宝箱图摘掉，等结算后进度变成"已领取"，它本来也不再出现。
     */
    private chestPlayingCell: number | null = null;
    /**
     * 表演期间的输入锁（需求 2026-10-22 §4）。
     *
     *  只挡**输入**，不挡渲染：开箱时地图照常画，只是拖不动、点不了下一格。
     */
    private inputLocked = false;
    /**
     * 锁滚动容器的端口（页面注入）：`locked = true` 时关掉 `ScrollView`。
     *
     *  为什么不让地图视图自己拿 `ScrollView`：`MapLayer` 是 ScrollView 的 content，
     *  但滚动容器是页面 prefab 上的一个独立节点 —— 视图不该反向依赖页面结构。
     */
    scrollLock: ((locked: boolean) => void) | null = null;
    /**
     * 开箱镜头「地图那一半」的基准（`null` = 还没量过 / 已还原）。
     *
     *  为什么地图侧也要跟着推：只把倍率乘在覆盖层 `Stage` 上，`MapLayer` 一动不动 ⇒
     *  观感是"宝箱凑近屏幕、地块不动"（2026-10-23 用户报的问题）。视图每帧把 `(scale, focus)`
     *  经 `setCameraHook` 递过来，这里同帧缩 `MapLayer` 并平移，让**同一个格子**落回同一屏幕点。
     */
    private chestCamera: ITerritoryChestCameraBase | null = null;
    /** 镜头是否正把地图挪离基准（`false` ⇒ `applyChestCamera` 直接不写，省掉每帧的无谓标脏）。 */
    private chestCameraActive = false;

    /** 初始化共享层引用与喷发粒子层（页面在 `onLoad` 里调，只需一次）。 */
    protected onEnable(): void {
        EventMgr.instance.on(TERRITORY_EVENTS.STATION_TAP, this.onStationClick, this);
    }

    protected onDisable(): void {
        EventMgr.instance.offTarget(this);
    }

    initialize(): void {
        this.stationLayers = {
            icon: this.stationIconLayer,
            caption: this.stationCaptionLayer,
            text: this.stationTextLayer,
            badge: this.stationBadgeLayer,
            hit: this.stationHitLayer,
        };
        // 顺手建喷发粒子层：此刻飘字还没建过任何节点 ⇒ 它坐稳 `GainLayer` 的第一个子节点。
        this.ensureBurstRoot();
        // 云层：建在 `GridLayer` 的**后一位**（格子之上、站点层之下），只在第一次生效。
        // ⚠️ 必须在 `initialize` 里建而不是懒建在 `sync` 里 —— 懒建会在第一次 sync 时才
        //    插兄弟序，此时 `GridLayer` 的子节点已经排过 `paintOrder`，位置虽然不受影响，
        //    但"云在格子之上、站点之下"这条就变成隐式依赖调用时机了。
        this.clouds.attach(this.gridLayer);
        // 内容层纵向偏移必须在云层建好之后跑（它要连 `CloudLayer` 一起挪）。
        this.applyContentShift();
    }

    /**
     * 内容层**底部**留白（px）—— **运行时值**，由页面按「视口高 + 顶部 HUD 底边」反算后注入。
     *
     * 它是 `cc.ScrollView` 可滚范围的**全部来源**（`elastic = false` ⇒ 拖不过去、松手也不回弹），
     * 也就是「地图能拖到哪」的硬上限。缺省 {@link TERRITORY_MAP_CONTENT_PADDING}（300）只服务
     * 没注入的场景（单测 / 页面还没量到 HUD）。
     *
     * ⚠️ 改它必须走 {@link setContentPaddingBottom}：内容层偏移是 `(bottom − top)/2`，
     *    直接赋字段会让偏移停在旧值上。
     */
    contentPaddingBottom: number = TERRITORY_MAP_CONTENT_PADDING;

    /**
     * 内容层**顶部**留白（px）—— 同样是运行时值，由页面按同一个 HUD 底边反算注入。
     *
     * 缺省 0（{@link TERRITORY_MAP_CONTENT_PADDING_TOP}）是老行为：滚到顶时第一排格子贴视口顶。
     * 页面上第一排会被浮在视口之上的 `TopHud` 挡住且拖不下来（用户 2026-10-27 口径）。
     */
    contentPaddingTop: number = TERRITORY_MAP_CONTENT_PADDING_TOP;

    /** 地图视口尺寸（页面注入，见 `setViewportSize`）；散场镜头算入画倍率用。 */
    private viewportWidth = 0;
    private viewportHeight = 0;
    /** 散场镜头是否已起跑（起跑那帧要量基准、取对焦点、锁输入，只做一次）。 */
    private cloudDollyStarted = false;
    /** 散场镜头的对焦点（地图包围盒中心，只取一次）。 */
    private cloudDollyOrigin: Vec3 = null!;

    /** 页面注入：底部留白（顺带重写内容层偏移）。 */
    setContentPaddingBottom(padding: number): void {
        const value = Number.isFinite(padding) ? Math.max(0, padding) : TERRITORY_MAP_CONTENT_PADDING;
        if (value === this.contentPaddingBottom) return;
        this.contentPaddingBottom = value;
        this.applyContentShift();
    }

    /** 页面注入：顶部留白（顺带重写内容层偏移）。 */
    setContentPaddingTop(padding: number): void {
        const value = Number.isFinite(padding) ? Math.max(0, padding) : TERRITORY_MAP_CONTENT_PADDING_TOP;
        if (value === this.contentPaddingTop) return;
        this.contentPaddingTop = value;
        this.applyContentShift();
    }

    /**
     * 把「与格子同坐标系的内容层」整体上移到 {@link territoryMapContentShiftY}。
     *
     * ## 为什么要挪
     *
     * 内容层高度 = 包围盒 + 底部留白 + 顶部留白。`MapLayer` 锚点居中 ⇒ 内容层比地图高的那截
     * 会上下均分 —— 滚到顶就会有一块没有格子的空底图（用户 2026-10-23 截图「格子没有铺到顶端」）。
     * 把内容层上移 `(bottom − top)/2`，地图顶部正好与内容层顶部对齐。
     *
     * ⚠️ 两份留白都是**运行时值**（页面注入），偏移必须每次现算，别缓存。
     *
     * ## 谁不动
     *
     * `MapBackground` **不参与**：它是按内容层尺寸 cover 铺满的（`syncBackground`），
     * 跟着偏反而会在顶部露边。它的 `pos` 恒为 `(0, 0)`。
     */
    private applyContentShift(): void {
        const shift = territoryMapContentShiftY(this.contentPaddingBottom, this.contentPaddingTop);
        // 云洞层（`TerritoryCloudPocket`）是**页面根**的孩子（要压在 UI 之上），不在下面这个循环里，
        // 拿不到这层偏移 ⇒ 必须显式告诉它，否则它只能拿 `territoryMapContentShiftY()` 的缺省值对齐，
        // 两份留白一变成运行时值就整层漂掉（2026-10-28 用户截图：云洞的云压到上面那排已解锁地块上）。
        this.clouds.setContentShiftY(shift);
        for (const child of this.node.children) {
            if (child === this.mapBackground?.node) continue;
            if (child.position.y === shift) continue;
            child.setPosition(child.position.x, shift, child.position.z);
        }
    }

    /**
     * **页面坐标系覆盖层**（点击反馈 + 开箱表演）的宿主节点（懒建，幂等）。
     *
     * ## 为什么不能挂在 `this.node`（`MapLayer`）下
     *
     *  `MapLayer` 是 `cc.ScrollView` 的 **content**：挂在那里 ⇒ 光圈/宝箱会随地图滑动、
     *  还会被视口 `Mask` 裁掉（镜头推近时光柱直接被裁成方块）。
     *  规格里的光柱是「贯穿屏幕」、暗角是「全屏」的，必须活在**页面坐标系**里。
     *
     *  所以往上跳两级：`MapLayer` → `MapViewport`（ScrollView 节点）→ 页面根，
     *  覆盖层挂到页面根、并 `setSiblingIndex(最后)` 保证画在地图之上。
     *  ⚠️ 页面根拿不到（prefab 结构被改）时退回 `MapViewport` 的父节点，仍在地图之上 ——
     *  宁可少一层遮蔽，也不要这套表现在运行时静默消失。
     */
    private ensureOverlayHost(): Node {
        if (this.overlayHost?.isValid) return this.overlayHost;
        const page = this.node.parent?.parent ?? this.node.parent ?? this.node;
        const host = new Node('TerritoryOverlay');
        host.layer = page.layer;
        host.setParent(page);
        host.addComponent(UITransform);
        host.setSiblingIndex(page.children.length - 1);
        this.overlayHost = host;
        const size = this.readViewportSize();
        // 层级在 prefab 里（`ui/territory/TerritoryChest`）—— 这里只负责实例化 + 挂到覆盖层。
        const chestRoot = instantiate(this.chestPrefab);
        chestRoot.layer = host.layer;
        chestRoot.setParent(host);
        this.chestView = new TerritoryChestView(chestRoot, size);
        this.chestView.setArt({ frames: this.chestArt });
        // 镜头**拆两半**（2026-10-23）：覆盖层那半由视图自己缩 `Stage`，地图这半在这里接上。
        // 漏了这一句就是用户报的「只有宝箱放大、地块不动」。
        this.chestView.setCameraHook((scale, focus) => this.applyChestCamera(scale, focus));
        this.tapFeedback = new TerritoryTapFeedback(host);
        this.chestView.setCatchPoint(0, size.height / 2 - 46);
        return host;
    }

    /** 视口尺寸（覆盖层 / 光柱都要按它画）；拿不到时给一个不会产出 NaN 的兜底。 */
    private readViewportSize(): { width: number; height: number } {
        const viewport = this.node.parent?.getComponent(UITransform);
        const width = viewport?.contentSize.width ?? 0;
        const height = viewport?.contentSize.height ?? 0;
        return {
            width: width > 0 ? width : 1080,
            height: height > 0 ? height : 1920,
        };
    }

    /**
     * 格心（台面中心）→ **覆盖层局部坐标**。
     *
     * 走 `convertToWorldSpaceAR` → `convertToNodeSpaceAR` 而不是自己算偏移：
     * 地图在 ScrollView 里滚动、章节之间布局尺寸也不同，只有引擎的矩阵是权威。
     * 拿不到节点 / 变换时返回 `null`（调用方直接跳过这次表现，不猜一个坐标）。
     */
    private cellPointInOverlay(cellId: number): Vec3 | null {
        const hex = this.hexNodes.get(cellId);
        if (!hex?.isValid) return null;
        const hexTransform = hex.getComponent(UITransform);
        const host = this.ensureOverlayHost();
        const hostTransform = host.getComponent(UITransform);
        if (!hexTransform || !hostTransform) return null;
        // `HEX_GRID_CONTENT_LIFT` = 锚点与"人眼看到的台面中心"的差（见 `cellCenter`）。
        const world = hexTransform.convertToWorldSpaceAR(new Vec3(0, HEX_GRID_CONTENT_LIFT, 0));
        return hostTransform.convertToNodeSpaceAR(world, new Vec3());
    }

    /**
     * 注入宝箱**补帧序列**（页面在资源就绪后调；不注入 / 全空 = 只播光效、没有箱体）。
     *
     *  ⚠️ 传的是「按 0…N-1 排好的帧数组」而不是单张图：开盖这件事现在是**换帧**演出来的
     *  （需求 2026-10-22 §2），单张图只能演「一直是开盖态」，读不出「正在打开」。
     */
    setChestArt(frames: readonly (SpriteFrame | null)[]): void {
        this.chestArt = frames;
        this.chestView?.setArt({ frames });
    }

    /** 飞向的落点（覆盖层坐标）；页面能拿到真实资源栏时调这个接口。 */
    setRewardCatchPoint(x: number, y: number): void {
        this.ensureOverlayHost();
        this.chestView?.setCatchPoint(x, y);
    }

    /**
     * 给**某一种资源**指定落点，坐标是**世界坐标**（页面从资源栏那一格取到的是什么就传什么）。
     *
     * ## 为什么不要求调用方先换算成覆盖层坐标
     *
     *  覆盖层节点是 `TerritoryMapView` 自己懒建的（`ensureOverlayHost`），页面拿不到它；
     *  而「世界坐标 → 覆盖层局部坐标」只有引擎矩阵说得准（页面缩放 / 安全区都会影响）。
     *  所以换算留在本类，页面只负责「哪个 resId → 哪一格的世界坐标」这一层业务判断。
     *
     * @param world `null` = 清掉这一种资源的专属落点（回落 `setRewardCatchPoint` 的全局落点）。
     *              **只影响这一个 resId** —— 一次开箱要登记两种资源，这里不能顺手清别的。
     */
    setRewardCatchWorldPoint(resId: number, world: Vec3 | null): void {
        if (!world) {
            this.chestView?.clearCatchPointOf(resId);
            return;
        }
        const host = this.ensureOverlayHost();
        const transform = host.getComponent(UITransform);
        if (!transform) return;
        const local = transform.convertToNodeSpaceAR(world, new Vec3());
        this.chestView?.setCatchPointOf(resId, local.x, local.y);
    }

    /** 清空**全部**按资源登记的落点（页面在每次开箱前调一次，避免上一批的残留）。 */
    clearRewardCatchPoints(): void {
        this.chestView?.clearCatchPoints();
    }

    /**
     * 注入「奖励图标落进资源栏」的回调（页面据此让那一格跳一下 + **那一格**闪光，别的格不动）。
     *
     * 本类只做转发：`resId → 资源栏的哪一格` 是**玩法/版面口径**，归页面。
     */
    setRewardLandedHandler(handler: ((resId: number, amount: number) => void) | null): void {
        this.ensureOverlayHost();
        this.chestView?.setLandedHandler(handler);
    }

    /**
     * 播一次**开箱表演**（三档由 `territoryChestTierOfRewards` 判，本方法只负责演）。
     *
     * @returns `true` = 真的开播了（页面据此决定"奖励弹窗等它播完再弹"）；
     *          `false` = 没播（格子不在视口内 / 还没建覆盖层），页面应按原逻辑立刻发奖。
     */
    playChestOpen(
        cellId: number,
        tier: TerritoryChestTier,
        rewards: readonly ITerritoryChestIconEntry[],
        onDone?: () => void,
    ): boolean {
        const point = this.cellPointInOverlay(cellId);
        if (!point) return false;
        this.ensureOverlayHost();
        // 基准必须在 `play()` **之前**量：`play` 里第一句 `apply(0)` 就会把镜头摆到
        // 「k=1 / focus=0」那一帧 —— 先量，基准才是"没被推过"的地图。
        this.captureChestCamera(point);
        this.chestView?.play(tier, point, rewards, onDone);
        const started = this.chestView?.isPlaying === true;
        // 开演即锁输入（需求 2026-10-22 §4）：表演挂在**页面坐标**上，而地图是 ScrollView content，
        // 播放期间拖动一次地图，宝箱就会和地块错位（实机 screenshot-3）。
        if (started) {
            this.setInputLocked(true);
            // 摘掉地图上那只（见 `chestPlayingCell`：不摘会在收尾淡出时透出来）。
            this.chestPlayingCell = cellId;
        }
        return started;
    }

    /** 开箱表演是否在播（页面据此避免同时弹奖励窗）。 */
    get isChestPlaying(): boolean {
        return this.chestView?.isPlaying === true;
    }

    /** 立刻收掉开箱表演（换章 / 页面销毁前）。同时解锁输入（打断也要放开，否则页面点不动）。 */
    stopChestPlay(): void {
        this.chestView?.stop();
        // 🔴 还原地图**必须**在解锁滚动之前：`stop()` 以 `(1, 0)` 触发钩子只是"数值上回到原位"，
        // 真正把 position / scale 写回基准的是这一句；带着放大 + 平移过的 content 去开 `ScrollView`，
        // 之后的拖拽边界会按错的尺寸算（见 §3.1.1）。
        this.restoreChestCamera();
        this.setInputLocked(false);
        // 地图上那只宝箱要还回来：被打断时进度没变，格子还是"可领取"。
        this.chestPlayingCell = null;
    }

    /**
     * 量一次「地图那一半」的基准（`playChestOpen` 里、`play()` 之前调）。
     *
     * 记三样东西：格心 `origin`（覆盖层坐标）、`MapLayer` 原点在同一套坐标里的 `layerOrigin`、
     * 以及 `MapLayer` 原始的 position / scale。后两者是"收工要还回去"的东西。
     *
     *  ⚠️ 覆盖层拿不到（prefab 结构被改）⇒ 基准置空，`applyChestCamera` 全程静默 ——
     *    退化成"只有宝箱推进"，不是地图乱飞。
     */
    private captureChestCamera(origin: Vec3): void {
        const host = this.overlayHost;
        const hostTransform = host?.isValid ? host.getComponent(UITransform) : null;
        if (!hostTransform || !this.node?.isValid) {
            this.chestCamera = null;
            this.chestCameraActive = false;
            return;
        }
        // `MapLayer` 的"原点"就是它自己的 position（子节点坐标以它为基准），换算到覆盖层坐标即可。
        const layerOrigin = hostTransform.convertToNodeSpaceAR(this.node.getWorldPosition(), new Vec3());
        this.chestCamera = {
            origin: new Vec3(origin.x, origin.y, 0),
            layerOrigin,
            basePos: this.node.position.clone(),
            baseScale: this.node.scale.clone(),
        };
        this.chestCameraActive = true;
    }

    /**
     * 把 `MapLayer` 摆到与覆盖层宝箱**同一帧**的位置（每帧被 `setCameraHook` 调一次）。
     *
     * 推导（全在覆盖层坐标系里，`L` = 格心相对 `MapLayer` 原点的偏移）：
     *
     * ```
     * 格心屏幕位置 = layerOrigin' + k × L
     * 要求         = origin × (1 - focus)          // focus 0 → 原位，1 → 屏幕中心
     * ⇒ layerOrigin' = origin × (1 - focus) - k × L
     * 校验：focus=0 / k=1 ⇒ layerOrigin' = layerOrigin（原样）
     * ```
     *
     *  ⚠️ 这里**只吃 `(scale, focus)` 两个数** —— 不关心倍率是 1.08 还是 2.3，
     *    换档次不用动本方法（它拿到 `focus` 就已经知道该把格心挪到哪）。
     */
    private applyChestCamera(scale: number, focus: number, origin?: Vec3): void {
        const base = this.chestCamera;
        if (!base || !this.chestCameraActive || !this.node?.isValid) return;
        // 脏值兜底：`k` 必须是正数（0 / 负数 / NaN 会让地图塌成一条线），`f` 夹到 [0, 1]。
        const k = Number.isFinite(scale) && scale > 0 ? scale : 1;
        const f = Number.isFinite(focus) ? Math.min(1, Math.max(0, focus)) : 0;
        const node = this.node;
        // 倍率乘在 **prefab 的基准缩放**上，不是直接写 k —— 地图节点本身可能带着非 1 的缩放。
        node.setScale(base.baseScale.x * k, base.baseScale.y * k, 1);
        // 对焦点可被覆盖（全解锁散场要把**地图中心**而不是宝箱摆到屏幕正中）；
        // 不传就用宝箱那一次的基准点。
        const ox = origin?.x ?? base.origin.x;
        const oy = origin?.y ?? base.origin.y;
        const lx = ox - base.layerOrigin.x;
        const ly = oy - base.layerOrigin.y;
        const targetX = ox * (1 - f) - k * lx;
        const targetY = oy * (1 - f) - k * ly;
        // 三数值重载：帧循环里不 new Vec3（场景节点每次推镜都要摆位）。
        node.setPosition(
            base.basePos.x + (targetX - base.layerOrigin.x),
            base.basePos.y + (targetY - base.layerOrigin.y),
            base.basePos.z,
        );
    }

    /**
     * 把 `MapLayer` 原样还回去（收工 / 换章 / 页面销毁前）。
     *
     *  ⚠️ 必须在 `setInputLocked(false)` **之前**调：滚动容器要靠 content 的真实尺寸算拖拽边界。
     *  幂等 —— 基准已经空了就直接返回（重复调不会把地图推到别处）。
     */
    private restoreChestCamera(): void {
        this.chestCameraActive = false;
        const base = this.chestCamera;
        this.chestCamera = null;
        if (!base || !this.node?.isValid) return;
        this.node.setScale(base.baseScale.x, base.baseScale.y, base.baseScale.z);
        this.node.setPosition(base.basePos);
    }

    /**
     * 表演期间的输入锁（需求 2026-10-22 §4）。
     *
     * 两层一起关：
     *  1. **站点点击**：{@link onStationClick} 开头直接吞掉（避免连点再发一次解锁/领取请求）；
     *  2. **地图拖动**：通过 {@link scrollLock} 交给页面关 `ScrollView`（视图自己不认识滚动容器）。
     *
     * 用「标志位 + 一个回调」而不是 `node.active` 之类：锁只影响输入，地图与 UI 必须照常渲染。
     */
    setInputLocked(locked: boolean): void {
        if (this.inputLocked === locked) return;
        this.inputLocked = locked;
        this.scrollLock?.(locked);
    }

    /** 是否处于动画输入锁（页面/测试可读）。 */
    get isInputLocked(): boolean {
        return this.inputLocked;
    }

    /** 点击反馈：压一下被点的地块 + 绿色光圈 + 蓝色圆环（规格 §1）。 */
    playTapFeedback(cellId: number): void {
        const point = this.cellPointInOverlay(cellId);
        if (!point) return;
        this.tapFeedback?.play(point, this.hexNodes.get(cellId) ?? null);
    }

    /**
     * 喷发粒子的容器层（懒建，幂等）。
     *
     *  ⚠️ 只在**第一次**建它时校正一次兄弟序，之后两个池都不再动兄弟序
     *  （`acquireGain` / `acquireBurst` 复用节点时只改 `active`，不重新 `setParent`）
     *  ⇒ 「粒子永远在读数之下」这条顺序从建层那一刻起就固定了。
     */
    private ensureBurstRoot(): Node {
        if (!this.burstRoot) {
            const root = new Node(TERRITORY_GAIN_BURST_NODE);
            root.layer = this.gainLayer.layer;
            root.setParent(this.gainLayer);
            root.setSiblingIndex(0);
            this.burstRoot = root;
        }
        return this.burstRoot;
    }

    /**
     * 注入 `shaders/hex-flip` 的 effect（页面在资源就绪后调一次）。
     * 取不到就整条翻格表现静默关闭 —— 地图照常渲染，只是点开随机格不播翻转。
     */
    setFlipEffect(effect: EffectAsset | null): void {
        this.hexFlip.setEffect(effect);
    }

    /**
     * 注入底部发光的序列帧 —— 与对局**同一份** `image/effects/hex_ground_glow`（按帧序）。
     * 空数组只是不画底光，翻格照旧。
     */
    setGroundGlowFrames(frames: readonly SpriteFrame[]): void {
        this.hexFlip.setGroundGlowFrames(frames);
    }

    /**
     * 注入「未解锁云」的四套图（页面在资源就绪后调一次）。
     *
     * 云体和影子是**两张独立图**（美术层离线拆的，不是运行时切 rect —— 三版就是那么翻车的），
     * 具体字段见 `ITerritoryCloudFrames`。
     *
     * 全为空 ⇒ 整条表现关闭，地图照常渲染（只是没有云）。与领地其它美术同一降级口径。
     */
    setCloudFrames(frames: ITerritoryCloudFrames): void {
        this.clouds.setFrames(frames);
    }

    /**
     * 每帧推进翻格表现 + 补上「翻完才出现」的建筑；没有在播的格子时开销只是一次长度判断。
     *
     * ⚠️ 顺序不能换（判据钉的就是 `update` 第一句必须是 `hexFlip.step`）：
     *  · 先 `step` ⇒ 本帧刚好播完的那一格，`isPlaying` 已经变成 false，
     *    {@link resolveBuildingReveal} 同一帧就能补建筑（不会多等一帧）；
     *  · 再补建筑 ⇒ 建筑与抖动的起点都落在「格子已经翻过来」之后。
     */
    update(dt: number): void {
        this.hexFlip.step(dt);
        // 新地块生成：与翻格同一帧序，排在 `hexFlip.step` 之后（同格撞车时翻格先写、
        // 这里再写会把缩放掰回生成曲线 —— 所以 `syncFlip` 起播时会 `stop` 掉同格的生成动画，
        // 走到这里就不存在两套缩放抢同一格的情况）。
        this.hexSpawn.step(dt);
        this.resolveBuildingReveal();
        // 未解锁云：待机换帧（每 tick 一批）+ 消散逐朵计时。它只动自己层里的云、不写任何格子
        // 节点，所以**故意排在「解除建筑待办」之后** —— 那条链路的判据钉着
        // 「两个 step 之后立刻 `resolveBuildingReveal`」（见 `territory-building-shake`），
        // 夹进去会把它掰成"晚一帧出建筑"。
        this.clouds.step(dt);
        // 「关卡通过后地皮换色」同理排在 `resolveBuildingReveal` 之后（它只写两个临时子节点，
        // 不碰格根、也不参与建筑待办那条链），免得把「两个 step 之后立刻补建筑」掰成晚一帧。
        this.hexRecolor.step(dt);
        this.stepChestSpawnDelays(dt);
        this.stepGains(dt);
        this.stepBursts(dt);
        // 页面坐标系的两套表现：点击反馈（0.3s）与开箱表演（2.3~3.2s）。
        // 都是「时钟置 -1 即空闲」的池化契约，没在播时开销只是一次数值比较。
        this.tapFeedback?.step(dt);
        this.chestView?.step(dt);
        // 散场镜头：必须排在 `clouds.step` **之后** —— 拿到的才是这一帧的拉远程度
        // （排在前面 ⇒ 镜头比雾晚一帧，起淡那一帧画面是"已经淡了但还没拉远"）。
        this.stepCloudDolly();
        // 🔴 收尾只留一条路径：开箱与散场**共用同一套镜头基准**，谁还在播都不许还原 / 解锁。
        const cameraBusy = this.chestView?.isPlaying === true || this.clouds.dollyActive;
        if (this.chestCameraActive && !cameraBusy) this.restoreChestCamera();
        // 开箱播完（或被 `stop()` 收掉）⇒ 立刻放开输入。放在 `step` 之后而不是 `onDone` 里：
        // `stop()` 不走 `onDone`，锁必须由「还在不在播」这个状态来释放，才不会有漏放的路径。
        if (this.inputLocked && !cameraBusy) this.setInputLocked(false);
        // 表演结束 ⇒ 解开"摘掉地图宝箱"的标记（结算已经把进度改成已领取，格子自然不再画宝箱；
        // 若是被打断/降级导致没结算，这里也让宝箱回到格子上）。
        if (this.chestPlayingCell !== null && !this.chestView?.isPlaying) this.chestPlayingCell = null;
    }

    /**
     * 翻格播完 ⇒ 补上建筑 + 播一次生成抖动（需求 2026-10-16 row14）。
     *
     *  判据是「这一格的 `hexFlip` 里已经没有它了」，所以：
     *  · 换章 / `reset()` 打断（`syncGrid` 会清空待办）不会留一个永远不出现的建筑；
     *  · 格子被销毁 / 视图被回收时 `stationViews` 里已经查不到它 ⇒ 直接跳过。
     */
    private resolveBuildingReveal(): void {
        if (!this.pendingBuildingReveal.size) return;
        for (const cellId of this.pendingBuildingReveal) {
            const node = this.hexNodes.get(cellId);
            if (node && this.hexFlip.isPlaying(node)) continue;
            this.pendingBuildingReveal.delete(cellId);
            const content = this.pendingBuildingRender.get(cellId);
            this.pendingBuildingRender.delete(cellId);
            const view = this.stationViews.get(cellId);
            if (!view || !content) continue;
            view.render(content);
            // 建筑「生成」的那一下：与对局 `ZCHexView.playBuildingShake` 同一条脉冲（120%）。
            view.playBuildingShake();
        }
    }

    /**
     * 注入飘字要用的资源图标（银币 `resId 7` / 体力 `resId 9`）。
     *
     * 页面在资源就绪后调一次；取不到图只是那一条飘字没有图标（**数字照常升起**），
     * 不是整条表现关掉。
     */
    setGainIcons(frames: ReadonlyMap<number, SpriteFrame | null>): void {
        this.gainIcons = new Map(frames);
    }

    /**
     * 追加 / 覆盖**一枚**飘字图标（随机资源格的奖励 id 是动态的，不能只靠预载的两张）。
     *
     * 随机资源池发的是道具（图纸 / 蓝本…），`loadResourceGainIcons` 只预载了银币 / 体力两张，
     * 所以页面在喷之前必须把这一批的图标现取现塞进来 —— 否则粒子和飘字都是**空图**，
     * 看着就是"粒子没了，只剩奖励信息"（2026-10-26 §3 的现场）。
     *
     * @param frame `null` = 这一枚确实没图（照常喷、照常飘数字，只是没有图标）。
     */
    setGainIcon(resId: number, frame: SpriteFrame | null): void {
        const id = Number(resId);
        if (!Number.isFinite(id)) return;
        this.gainIcons.set(id, frame ?? null);
    }

    /**
     * 在**指定格子上方**播一组资源表现：格心**喷发**一把资源图标 + 图标与 `+N` 读数升起。
     *
     * 用于「银币 / 体力不走奖励弹窗」那条口径（见 `TerritoryResourceGain`）。
     * 资源点是玩家**刚点的那一格**，所以基准直接取格节点当前坐标（`hex.position` 就是布局点，
     * 见 `syncGrid`），不依赖额外的布局换算。
     *
     * ## 落点分工（需求 2026-10-16 row17 的「喷发坐标点」与「上方 40px」）
     *
     *  · **喷发原点** = 点击地块的中心点 = `hex.position.y + HEX_GRID_CONTENT_LIFT`
     *    （`HEX_GRID_CONTENT_LIFT` 就是「锚点 ≠ 人眼看到的台面中心」那 12.5px，见 `cellCenter`）；
     *  · **图标 + 数字 ui** 在原点**上方 `TERRITORY_GAIN_START_LIFT_PX`(= 需求里的 40px)** 起飘。
     *
     *  ⚠️ 两处都加 `HEX_GRID_CONTENT_LIFT`，但**只加一次**：飘字不再是「格心 + 30px 经验值」，
     *    而是「喷发原点 + 40px」。判据见 `tests/territory-cell-center-align.test.ts` 的反向守卫
     *    与 `tests/territory-resource-gain.test.ts` 的落点换算。
     *
     *  🔴 **合成读数是唯一的例外**：它落在「喷发原点 + `TERRITORY_GAIN_READOUT_LIFT_PX`(70 = 40 + 30)」
     *    —— 种族经验球那张图比银币大，贴着 40px 会和格心喷出的那把粒子挤在同一片区域（2026-10-26 用户口径
     *    「初始位置增加 30px，不会遮挡粒子效果」）。**逐条模式仍是 40**，上面那条 40px 判据不受影响。
     *
     * ⚠️ 多条（同时给银币 + 体力）**纵向错开** `TERRITORY_GAIN_STACK_GAP_PX`，
     *  否则两条叠在一条线上互相压字；喷发则只有**一次**（多个图标轮流取两条的图）。
     *
     * ## `readout`：把读数**合成一条**（2026-10-26 随机格口径）
     *
     * 随机资源格一次会发好几种**种族经验**（`+158 / +139 / +140 / +113`），传 `readout`
     * 时读数只出一条：图标用 {@link ITerritoryGainReadout.frame}（页面给「种族经验球_随机」）、
     * 数字用 `amount`（页面给**全部数量之和**）。
     *
     * 🔴 **只换读数，不换喷发**：粒子仍然按 `entries` **各用各的图**（随机格拿到 4 种经验就
     *    喷 4 种图，视觉上能看出"这一格给的是混合资源"），个数仍按数量之和分级。
     *
     * @param entries 已经过 `splitTerritoryRewards` 筛选的钱包类奖励（喷发用）
     * @param readout 给了就只出一条读数（图标 + 求和数字）；不给则每条 entries 各一条（旧行为）
     */
    playResourceGain(
        cellId: number,
        entries: readonly { resId: number; amount: number }[],
        readout?: ITerritoryGainReadout | null,
    ): void {
        if (!entries.length) return;
        const hex = this.hexNodes.get(cellId);
        if (!hex) return;
        const originX = hex.position.x;
        const originY = hex.position.y + HEX_GRID_CONTENT_LIFT;
        const baseY = originY + TERRITORY_GAIN_START_LIFT_PX;
        // 喷几颗看**这一批的总量**（需求 2026-10-22）：小奖励稀疏、大奖励满喷。
        const total = entries.reduce((sum, entry) => sum + (Number(entry.amount) > 0 ? Number(entry.amount) : 0), 0);
        this.playGainBurst(originX, originY, entries, total);
        if (readout) {
            // 合成一条：**不叠加**，落在起点线上（`index = 0`），比逐条模式**再高 30px**
            // —— 那颗种族经验球比银币图大，落在 40px 会被自己喷出的粒子盖住（2026-10-26 口径）。
            const view = this.acquireGain();
            view.node.setPosition(originX, originY + TERRITORY_GAIN_READOUT_LIFT_PX, 0);
            view.play(readout.frame ?? null, readout.amount);
            return;
        }
        entries.forEach((entry, index) => {
            const view = this.acquireGain();
            // ⚠️ 起点必须先写：`play()` 以「节点当前 y」为基准，池化复用时不重设会越飘越高。
            view.node.setPosition(originX, baseY + index * TERRITORY_GAIN_STACK_GAP_PX, 0);
            view.play(this.gainIcons.get(entry.resId) ?? null, entry.amount);
        });
    }

    /**
     * 播一次「喷发」：从 `(originX, originY)` 喷出若干资源图标（个数按奖励总量分级）。
     *
     *  图标按 `entries` **轮流取**（同时给银币 + 体力时两种图各喷一半）；
     *  取不到图（资源还没加载好）只是那颗粒子是空的 —— 与飘字「缺图仍照常升」同一口径，
     *  **不是**把整条喷发关掉。
     *
     * @param total 这一批奖励的总数量 —— 决定喷几颗（`territoryBurstCountForTotal`）。
     */
    private playGainBurst(
        originX: number,
        originY: number,
        entries: readonly { resId: number }[],
        total: number,
    ): void {
        const frames = entries.map((entry) => this.gainIcons.get(entry.resId) ?? null);
        this.burstSeed = (this.burstSeed + 1) | 0;
        this.acquireBurst().play(originX, originY, this.burstSeed, frames, territoryBurstCountForTotal(total));
    }

    /** 取一条飘字：池里有就复用，没有才 instantiate。 */
    private acquireGain(): TerritoryResourceGainView {
        const reused = this.gainPool.pop();
        if (reused) {
            this.activeGains.push(reused);
            return reused;
        }
        const node = instantiate(this.gainPrefab);
        node.layer = this.gainLayer.layer;
        node.setParent(this.gainLayer);
        const view = node.getComponent(TerritoryResourceGainView)!;
        this.activeGains.push(view);
        return view;
    }

    /** 取一喷粒子：池里有就复用，没有才现建（节点挂在 {@link ensureBurstRoot} 的层里）。 */
    private acquireBurst(): TerritoryGainBurst {
        const reused = this.burstPool.pop();
        if (reused) {
            this.activeBursts.push(reused);
            return reused;
        }
        const burst = new TerritoryGainBurst(this.ensureBurstRoot());
        this.activeBursts.push(burst);
        return burst;
    }

    /** 逐帧推进飘字，播完回池（节点不销毁，`active=false`）。 */
    private stepGains(dt: number): void {
        for (let index = this.activeGains.length - 1; index >= 0; index -= 1) {
            const view = this.activeGains[index];
            if (view.step(dt)) continue;
            this.activeGains.splice(index, 1);
            this.gainPool.push(view);
        }
    }

    /** 逐帧推进喷发粒子，放完回池（与 `stepGains` 同一套；两者时长不同、各走各的）。 */
    private stepBursts(dt: number): void {
        for (let index = this.activeBursts.length - 1; index >= 0; index -= 1) {
            const burst = this.activeBursts[index];
            if (burst.step(dt)) continue;
            this.activeBursts.splice(index, 1);
            this.burstPool.push(burst);
        }
    }

    /** 立刻收掉全部在播的飘字与喷发（换章 / 格子重建时调，免得飘在已经不存在的格子上）。 */
    private resetGains(): void {
        for (const view of this.activeGains) {
            view.stop();
            this.gainPool.push(view);
        }
        this.activeGains.length = 0;
        for (const burst of this.activeBursts) {
            burst.stop();
            this.burstPool.push(burst);
        }
        this.activeBursts.length = 0;
    }

    /**
     * 全量渲染：几何 + 站点。幂等，可每帧调用（但页面只在换章 / 进度变化时调）。
     *
     * 🔴 **`syncFlip` 必须排在 `syncStations` 之前**（2026-10-16 row14）：
     *  翻格那一帧「这一格要不要等翻转结束再出建筑」是由 `syncFlip` 决定的，
     *  排在后面的话站点会先用「已开启」的样子画一帧 —— 表现为建筑**闪一下就消失**
     *  （下一帧才被隐藏、要等 0.7s 再长出来）。
     */
    renderMap(input: ITerritoryMapRenderInput): void {
        this.syncContentSize(input.layout, input.map.rows, input.map.columns);
        this.syncBackground(input);
        this.syncGrid(input);
        // 未解锁云：排在格子之后（格子节点的 `active` 已定，两者互不影响，但顺序与"谁盖着谁"一致）。
        this.syncClouds(input);
        this.syncFlip(input);
        this.syncStations(input);
    }

    /**
     * 「未解锁云」：**真实云层**（会消散、能回退）只给地图里配置过的格位盖，
     * 其余格（含格网内的空格）由**铺满层**兜底（见 `TerritoryCloudView.setFillOccupied`）。
     *
     * 🔴 2026-10-23 山猫口径（*「地图编辑器那都没有随机格子，就不要云了，配置没有的地方」*）：
     * 有内容的格 = `sites` + `randomSites.candidateCells`（+ 起始格）这几格 —— 它们才会解锁、
     * 才需要"露出来时云消散"。
     * ⚠️ 2026-10-26 补：**"没有内容就不给云"不等于"整片留白"**。章节图 20×20 里只有 ~117 格
     * 有内容，剩下 280 多格以前既没真实云也不在铺满范围 ⇒ 地图上出现整条裸底图（用户截图红框）。
     * 现在那些空格由铺满层盖住，只是不参与消散。
     *
     * ⚠️ 判断「露没露出来」用 `input.revealedCells`（= `territoryRevealedCells`：
     * 已占领 / 已解锁 + 前沿可见格），**不是** `progress.isCellUnlocked` —— 后者只认
     * "服务端允许点"，与格子层 `node.active` 不同口径，用错会「格子没画、云已经散了」。
     */
    private syncClouds(input: ITerritoryMapRenderInput): void {
        const candidates = input.map.randomSites?.candidateCells.length ?? 0;
        const key = `${input.layout.points.size}|${input.map.sites.length}|${candidates}|${input.map.startCellId}`;
        if (key !== this.cloudCellsKey) {
            this.cloudCellsKey = key;
            this.cloudCells.length = 0;
            this.cloudCells.push(...territoryCloudCells(input.map, input.layout.points));
            // 铺满层要知道「哪些格已经有真实云」—— 否则格网里的空格要么叠两朵、要么一格云都没有
            // （2026-10-26 那条"左侧空了一块背景图"就是后者）。只在换图 / 换章时重算一次。
            this.clouds.setFillOccupied(this.cloudCells.map((cell) => cell.cellId));
        }
        const revealed = new Set(input.revealedCells);
        // 「被地块包围」的未解锁小洞（2026-10-23 第二轮）：这些格子里的云**不吃挡云区的反向擦除**，
        // 搬到页面顶层（压住 UI、不影响点击）。判定是纯函数，见 `territoryCloudPocketCells`。
        const pockets = territoryCloudPocketCells(input.map.rows, input.map.columns, revealed);
        // 散场镜头：先把「整张图入画」的倍率交给云层（它据此决定要不要演、演多远），
        // 再 sync —— 第四个参数是**激活探针**（见 `isCellActivated`）。
        this.clouds.setDollyFitScale(territoryCloudDollyFitScale(
            input.layout.width, input.layout.height, this.viewportWidth, this.viewportHeight));
        this.clouds.sync(this.cloudCells, revealed, pockets, (cellId) => this.isCellActivated(cellId, input));
    }

    /**
     * 「整片铺满雾该不该收工」的判据：**已激活**（不是"已露出"）。
     *
     * 🔴 与逐格消散（用 `revealed`）**故意不同源**：`revealed` 含「前沿随机候选格」
     * （看得见、还没花钱开）—— 拿它当收官判据会让雾在最后一格还没点时提前散掉
     * （用户 2026-10-27「还未激活完全部地块，云层就消失了」）。
     *
     * 三条都是**服务端确认过**的状态 ⇒ 判据不会死锁：
     *  · `isCellUnlocked` 服务端允许点；
     *  · `isOwned`      已占领；
     *  · `isAreaPassed` 区域已通关（宝箱领完 / 关卡打完）。
     *
     * ⚠️ **不要用 `isCellPassed`**：宝箱要"领完"才算，`bonus` 根本不走 `isAreaPassed`
     *    ⇒ 卡在最后一格永远收不了官。
     */
    private isCellActivated(cellId: number, input: ITerritoryMapRenderInput): boolean {
        if (cellId === input.map.startCellId) return true;
        const progress = input.progress;
        return progress.isCellUnlocked(cellId) || progress.isOwned(cellId) || progress.isAreaPassed(cellId);
    }

    /**
     * 页面注入：地图**视口**尺寸（px）—— 散场镜头靠它算「整张图入画」的倍率。
     *
     * ⚠️ 不猜、不从 prefab 反查：视口在页面那一侧（`MapScrollView`），视图只有 content。
     *    注入不了（单测 / 页面还没量）时倍率退化成 1 ⇒ 直接走淡出、不演镜头。
     */
    setViewportSize(width: number, height: number): void {
        this.viewportWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
        this.viewportHeight = Number.isFinite(height) ? Math.max(0, height) : 0;
    }

    /**
     * 推进「全解锁 ⇒ 镜头散场」（每帧调，排在 `clouds.step` 之后）。
     *
     * 镜头**复用宝箱那套基准**：`k: 1 → fit`（缩到整张图入画）、`f: 0 → 1`（把地图中心挪到屏幕正中），
     * 两条都用同一条 `zoom` 曲线插值 ⇒ 首末两帧都精确回到基准，不用单独记还原值。
     */
    private stepCloudDolly(): void {
        if (!this.clouds.dollyActive) {
            this.cloudDollyStarted = false;
            return;
        }
        if (!this.cloudDollyStarted) {
            const center = this.mapCenterInOverlay();
            if (!center) return;
            // 🔴 基准只量一次：开箱还在播时它的基准是动画中途量下来的，复用它会把地图永久停偏。
            if (!this.chestCameraActive) this.captureChestCamera(center);
            // 对焦点也只取一次：`mapCenterInOverlay` 量的是**当前世界位置**，镜头一动它每帧都在变，
            // 每帧重量就成了"追着自己跑"的反馈环。
            this.cloudDollyOrigin = center;
            this.setInputLocked(true);
            this.cloudDollyStarted = true;
        }
        const zoom = this.clouds.dollyZoom;
        const fit = this.clouds.dollyScale;
        this.applyChestCamera(1 + (fit - 1) * zoom, zoom, this.cloudDollyOrigin);
    }

    /**
     * 地图包围盒中心在**页面覆盖层坐标系**里的位置（散场镜头的对焦点）。
     *
     * `GridLayer` 的本地原点就是地图包围盒中心，加回内容层抬升量再换算到覆盖层。
     * 取不到时返回 `null`（⇒ 只演雾散、镜头不动）。
     */
    private mapCenterInOverlay(): Vec3 | null {
        const grid = this.gridLayer;
        const host = this.overlayHost;
        if (!grid?.isValid || !host?.isValid) return null;
        const world = grid.getComponent(UITransform)?.convertToWorldSpaceAR(Vec3.ZERO);
        if (!world) return null;
        const local = host.getComponent(UITransform)?.convertToNodeSpaceAR(world);
        if (!local) return null;
        return new Vec3(local.x, local.y + HEX_GRID_CONTENT_LIFT, 0);
    }

    /**
     * 随机资源格「翻开」→ 播一次与对局同款的翻格。
     *
     * 触发靠 **diff**：新出现的「已开启」随机候选格就是本次翻开的格子。
     * 不依赖 Presenter 多传一个「刚翻开」字段 —— 页面在这里只需要看最终进度，
     * 换章 / 重进页面也不会漏（首次只做快照，见 `hexFlipBootstrapped`）。
     */
    private syncFlip(input: ITerritoryMapRenderInput): void {
        const progress = input.progress;
        const candidates = input.map.randomSites?.candidateCells ?? [];
        if (!this.hexFlipBootstrapped) {
            for (const cellId of candidates) {
                if (progress.isCellUnlocked(cellId)) this.openedRandomCells.add(cellId);
            }
            this.hexFlipBootstrapped = true;
            return;
        }
        for (const cellId of candidates) {
            if (this.openedRandomCells.has(cellId) || !progress.isCellUnlocked(cellId)) continue;
            this.openedRandomCells.add(cellId);
            const node = this.hexNodes.get(cellId);
            const sprite = node?.getComponent(Sprite) ?? null;
            if (!node || !sprite) continue;
            // 「旧 → 新」两张地皮一起给：点击这一帧 `paintHexes`（在本函数之前跑）已经把地皮
            // 换成新的了 —— 不传旧的就等于「从新地皮开始翻」，读不出「翻开」这件事。
            // ⚠️ 翻开成功才登记「建筑滞后」（需求 2026-10-16 row14）：没翻（没注入 effect）
            //    就不该让建筑跟着等，否则会变成「格子不动、建筑也不出来」。
            if (this.hexFlip.play(node, sprite, { from: input.art.tileLocked, to: input.art.tileCleared })) {
                // 同一格刚被判成「新生成」时，把淡入掐掉：翻格全程把格根缩放写死为 1，
                // 两层缩放会互相掰（而且翻格自带"新地皮放大填充"，淡入是多余的）。
                this.hexSpawn.stop(node);
                // 换色一起掐掉：「三方让位顺序 = 翻格 > 生成 > 换色」。翻格要靠格根地皮演
                // "旧 → 新"换脸，而换色正把格根地皮藏着 —— 两套一起跑必然是地皮一闪一闪。
                this.hexRecolor.stop(node);
                this.pendingBuildingReveal.add(cellId);
            }
        }
    }

    /**
     * 内容层尺寸 = 地图包围盒 + **底部 / 顶部**留白：`cc.ScrollView` 靠它算可滚范围。
     *
     * 留白不是装饰，是**可滚范围**：底部那截让相机能在贴到地图下边缘时继续往上滚，把底部那几排
     * 地块抬到【快速寻敌】按钮之上；顶部那截让第一排地块能被拖到 `TopHud`（个人信息框）下方。
     * 两份都是**页面注入的运行时值**（见 `setContentPaddingBottom` / `setContentPaddingTop`），
     * 缺省 300 / 0 只服务没注入的场景。
     * 格心坐标一个都不动，对齐靠 {@link applyContentShift} 的内容层偏移。
     */
    private syncContentSize(layout: ITerritoryMapLayout, rows: number, columns: number): void {
        const content = territoryMapContentSize(layout, this.contentPaddingBottom, this.contentPaddingTop);
        this.node.getComponent(UITransform)!.setContentSize(content.width, content.height);
        // 云要铺满**整块内容层**（不只格位）：内容层四周还留着留白的空白，
        // 滚到边缘时那条空白会露出底图（用户 2026-10-23 截图 1 的红框）。
        this.clouds.setFillArea(content.width, content.height, rows, columns);
        // ⚠️ 尺寸变了 ⇒ 偏移也要跟着重写：只 setContentSize 不重算的话，
        //    「先注入留白、再首次 sync」这一帧的偏移还是旧的（顶部会露出一条空底图）。
        this.applyContentShift();
    }

    /**
     * 底图：换帧 + 按「内容层尺寸」等比铺满。
     *
     * ## 为什么尺寸要跟地图走，而不是撑满视口
     *
     *  背景在 `MapLayer`（= ScrollView 的 content）里，滑到底时内容会整体移出视口；
     *  若背景只按视口尺寸铺，滑到边缘就会露出空白。**按内容层铺**才能保证任意滚动位置下
     *  视口内始终是图（`content` 已经是「格心包围盒 + 一格图的外接尺寸 + 四周留白」，
     *  比格心范围大一整格图，刚好盖住边角那半格）。
     *
     *  ⚠️ 必须用 `territoryMapContentSize` 而不是 `layout.width/height`：
     *  留白那 2×300px 也在内容层里，按包围盒铺就会在滚到底时露出上下两条空白。
     *
     * ## 等比 cover，不拉伸
     *
     *  底图是美术给的成品（如 `zdbg1` 1660×2916），非等比拉伸会把沙漠纹理压扁。
     *  取 `max(内容宽/图宽, 内容高/图高)` ⇒ 两边都不留白、比例不变，
     *  节点尺寸 = `图尺寸 × 该系数`（可超出内容层，超出部分被 `Mask` 裁掉，正是想要的）。
     */
    private syncBackground(input: ITerritoryMapRenderInput): void {
        const sprite = this.mapBackground;
        const frame = input.art.background;
        if (frame && sprite.spriteFrame !== frame) sprite.spriteFrame = frame;
        if (!frame) return;
        const { width: artWidth, height: artHeight } = frame.originalSize;
        // 图尺寸未就绪（0/NaN）时不要把节点写成 0×0 —— 那会让整块底图消失且不报错。
        if (!(artWidth > 0) || !(artHeight > 0)) return;
        const { width, height } = territoryMapContentSize(
            input.layout, this.contentPaddingBottom, this.contentPaddingTop);
        if (!(width > 0) || !(height > 0)) return;
        const scale = Math.max(width / artWidth, height / artHeight);
        this.mapBackground.node.getComponent(UITransform)!
            .setContentSize(artWidth * scale, artHeight * scale);
    }

    /**
     * 六边格：按 cellId diff 复用节点。
     *
     *  几何只在**布局本身变了**的时候需要重算 —— 判据用 `layout` 的指纹（格子数 + 包围盒），
     *  而不是 `map.id`：换章节时地图 id 一定会变，但两张行列数相同的图几何完全一样，
     *  按 id 判会白重建一遍（旧实现每秒 `destroyAllChildren` 已经是极端，这里至少不做无用功）。
     *  章节之间行列数常常不同，交界处会有一批新格子与一批废弃格子；diff 只动差异部分，
     *  重叠的 cellId 连节点实例都保持不变。
     */
    private syncGrid(input: ITerritoryMapRenderInput): void {
        const key = `${input.layout.points.size}|${input.layout.width}|${input.layout.height}`;
        if (key === this.gridKey) {
            this.paintHexes(input);
            return;
        }
        this.gridKey = key;
        // 换图（换章 / 改布局）：格子节点会被重建 ⇒ 先把在播的翻格复位，并重新做一次
        // 「已开启」快照，免得新图的首帧把历史已开启格全当成刚翻开。
        this.hexFlip.reset();
        // 生成动画同理：格子节点要重建，按压缩放 / 半透明留在旧节点上会「烂掉一格」；
        // 快照一并作废 ⇒ 新图首帧只做快照，不会把整张图当成"刚生成"。
        this.hexSpawn.reset();
        // 换色同理：两个临时层留在旧节点上会「烂掉一格」（藏起来的格根地皮也不会自己回来）；
        // 破冰标志一并作废 ⇒ 新图首帧只做快照，不会把整张图当成"刚通关"。
        this.hexRecolor.reset();
        this.recolorBootstrapped = false;
        // 云跟着重建：换章后 cellId 换了含义，留着旧图的云会飘在错误的格位上。
        this.clouds.reset();
        this.cloudCells.length = 0;
        this.cloudCellsKey = '';
        this.revealedSnapshot.clear();
        this.unlockedSnapshot.clear();
        this.spawnBootstrapped = false;
        this.resetGains();
        // 覆盖层那两套也要收：格子节点会被重建 / 复用，按压缩放留在旧节点上就会「烂掉一格」。
        this.chestView?.stop();
        this.restoreChestCamera();
        this.tapFeedback?.stop();
        this.openedRandomCells.clear();
        this.hexFlipBootstrapped = false;
        // 宝箱「刚生成」的快照同理作废：换章后新图上**本来**就摆着宝箱的格子不算「刚生成」，
        // 不清会把它们全当成新增、一格抖一下。
        this.chestCells.clear();
        this.stationsReady = false;
        // 还没抖的宝箱排队也作废（格子节点会被重建，留着会抖到别人身上）。
        this.chestSpawnDelay.clear();
        // 待办建筑跟着作废：格子节点会被重建，留着会让新图上的同名格「永远等一个不会播完的翻转」。
        this.pendingBuildingReveal.clear();
        this.pendingBuildingRender.clear();
        const seen = new Set<number>();
        for (const [cellId, point] of input.layout.points) {
            seen.add(cellId);
            const node = this.hexNodes.get(cellId) ?? this.createHex(cellId);
            node.setPosition(point.x, point.y, 0);
        }
        for (const [cellId, node] of this.hexNodes) {
            if (seen.has(cellId)) continue;
            this.hexNodes.delete(cellId);
            // 框的 Sprite 缓存与格子节点同进同出，漏删会让下一章复用错格子的引用。
            this.hexFrames.delete(cellId);
            node.destroy();
        }
        // 共享布局把 y 小的地块排在后面，让立体侧壁被下一格顶面遮住。
        let paintIndex = 0;
        for (const cellId of input.layout.paintOrder) {
            const node = this.hexNodes.get(cellId);
            if (node) node.setSiblingIndex(paintIndex++);
        }
        this.paintHexes(input);
    }

    /**
     * 格心 → **格内内容的视觉中心**（= 2.5D 地皮的可见台面中心）。
     *
     * 🔴 2026-10-15 改回 `y + HEX_GRID_CONTENT_LIFT`（此前按「建筑坐标 == 格子节点坐标」
     * 的字面口径做过恒等映射，结果视觉偏下）。
     *
     * ## 为什么恒等映射看起来是「不居中」
     *
     * 地块底图 `img_land_01_gray` 是 **130×119 的 2.5D 立体图**，但**可见台面只有上面一块**：
     * 逐行扫 alpha 实测台面亮面占 **y = 2 ~ 91**（高 90px，正好等于 `HEX_GRID_FACE_HEIGHT`），
     * 下面 28px 是侧壁。而 `Sprite` 锚点在**整图中心 y = 59**
     * ⇒ 台面中心（46.5）比锚点高 **12.5px** —— 正是 `HEX_GRID_CONTENT_LIFT` 的值。
     *
     * 所以：建筑摆在锚点（恒等映射）上，就比「人眼看到的格子中心」低 12.5px。
     * 截图逐格实测偏差 **13 ~ 23 美术px** = 这 12.5 恒定项 + 逐图 trim 偏移
     * （后者由 `TerritoryStationView.applyIconPlacement` 抵消）。
     *
     * ⚠️ **格子节点本身的位置不动**（`syncGrid` 仍是 `setPosition(point.x, point.y, 0)`）——
     *   那是蜂窝几何的一部分（行距 90 / 列距 92.25 都以它为准），偏移的只有「格内内容」。
     * ⚠️ 判据见 `tests/territory-cell-center-align.test.ts`。
     */
    private cellCenter(point: ITerritoryMapPoint): ITerritoryMapPoint {
        return { x: point.x, y: point.y + HEX_GRID_CONTENT_LIFT };
    }

    private createHex(cellId: number): Node {
        const node = new Node(`Hex_${cellId}`);
        node.layer = this.gridLayer.layer;
        node.setParent(this.gridLayer);
        // 2.5D 立体地块整图（**非正方形**），CUSTOM 尺寸必须按宽高分别给，
        // 否则图会被非等比拉伸、立体厚度变形。
        // ⚠️ 这里给的是**设计画布兜底**；帧到位后 `applyTileFrame` 会按帧的 `originalSize`
        //    覆盖（2026-10-16 新美术是 126×117，比设计值 130×119 小一圈）。
        node.addComponent(UITransform).setContentSize(HEX_GRID_IMAGE_WIDTH, HEX_GRID_IMAGE_HEIGHT);
        const sprite = node.addComponent(Sprite);
        sprite.trim = false;
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        // 「换色」的两个临时地皮层（2026-10-23）—— **格根的前两个子节点**。
        // 先 `RecolorNew` 后 `RecolorOld`：子节点顺序 = 渲染序 ⇒ 旧地皮画在上面，
        // 它缩小的过程里新地皮从身下露出来，读作"换了一张"，而不是"两张各淡各的"。
        // ⚠️ 缩放 / 透明度只写在这两个节点上，**格根恒 1** ——「建筑保持原地不动」靠的就是它。
        this.createRecolorLayer(node, TERRITORY_HEX_RECOLOR_NEW_NODE);
        this.createRecolorLayer(node, TERRITORY_HEX_RECOLOR_OLD_NODE);
        // 格面高亮框（「已解锁未通关」才显示）：**必须排在 GroundGlow 之前**，
        // 让翻格底光压在框之上（两者不会同时出现，这个顺序只是观感兜底）。
        // 尺寸由 `applyHexFrame` 按帧写（现美术 124×92），落点与建筑同轴（`HEX_GRID_CONTENT_LIFT`）。
        const frameNode = new Node(HEX_FRAME_NODE_NAME);
        frameNode.layer = this.gridLayer.layer;
        frameNode.setParent(node);
        frameNode.setPosition(0, HEX_GRID_CONTENT_LIFT, 0);
        frameNode.active = false;
        frameNode.addComponent(UITransform);
        const frameSprite = frameNode.addComponent(Sprite);
        frameSprite.trim = false;
        frameSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        this.hexFrames.set(cellId, frameSprite);
        // 底部发光（开口光）：与对局共用同一份序列帧，只在翻格时亮（默认关）。
        // 作为格子节点的子节点 ⇒ 天然画在底图之上（子节点顺序 = 渲染序）。
        // ⚠️ `sizeMode = RAW`：序列帧 8 帧同画布，尺寸由帧的 originalSize 决定 ⇒ 不用在这里写死高度。
        const glowNode = new Node('GroundGlow');
        glowNode.layer = this.gridLayer.layer;
        glowNode.setParent(node);
        glowNode.active = false;
        glowNode.addComponent(UITransform);
        const glowSprite = glowNode.addComponent(Sprite);
        glowSprite.trim = false;
        glowSprite.sizeMode = Sprite.SizeMode.RAW;
        // 「新地皮」层（翻格**方案2**「原地快碎裂 → 新地皮从格心放大填充」用）：
        // 作为最后一个子节点 ⇒ 长大的新地皮正好压在正在碎掉的旧地皮之上（其余时候收起）。
        // ⚠️ `sizeMode = RAW`：尺寸跟帧走（与地皮同为 126×117），不用在这里写死；
        //    放大倍率由 `TerritoryHexFlip.applyReveal` 每帧写，**不动格根**。
        const revealNode = new Node(TERRITORY_HEX_REVEAL_NODE);
        revealNode.layer = this.gridLayer.layer;
        revealNode.setParent(node);
        revealNode.active = false;
        revealNode.addComponent(UITransform);
        const revealSprite = revealNode.addComponent(Sprite);
        revealSprite.trim = false;
        revealSprite.sizeMode = Sprite.SizeMode.RAW;
        this.hexNodes.set(cellId, node);
        return node;
    }

    /**
     * 建一个「换色」临时地皮层（`RecolorNew` / `RecolorOld`）。
     *
     *  · `sizeMode = RAW`：尺寸跟帧走（与格根地皮同一个 `originalSize`），不用在这里写死；
     *    实际缩放由 `TerritoryHexRecolor` 每帧写，落点是格心（(0,0)，与格根地皮同锚点）。
     *  · 默认收起：只有 `play` 那一刻才 `active`，池化复用时 `settle()` 会再收一次。
     */
    private createRecolorLayer(parent: Node, name: string): void {
        const layerNode = new Node(name);
        layerNode.layer = this.gridLayer.layer;
        layerNode.setParent(parent);
        layerNode.active = false;
        layerNode.addComponent(UITransform);
        const sprite = layerNode.addComponent(Sprite);
        sprite.trim = false;
        sprite.sizeMode = Sprite.SizeMode.RAW;
    }

    /**
     * 格子**地皮 + 格面框**：按 cellId 状态二选一地皮、四选一叠框。幂等，可重复调用。
     *
     *  🔴 2026-10-16 换口径（山猫）：
     *  · **地皮**只有两张 —— 已通关 ⇒ `tileCleared`（`img_land_01` 草地块），其余 ⇒
     *    `tileLocked`（`img_land_02` 泥土块）。原先的「一张 `img_land_01_gray` + 三色
     *    tint（已占领绿 / 有站点金 / 中立米）」整体删除：成品美术图自带明暗，再乘色会发脏，
     *    状态改由「哪张地皮 + 哪个框」表达。
     *  · **格面框**表达「这里有东西可打」：**已解锁且未通关**才叠，站点类型决定用哪张
     *    （首领 `frame_01` 红 / 普通关卡**同样用 `frame_01` 红**（2026-10-28 起，原 `frame_03` 紫）/
     *      异步关卡 `frame_04` 金 / 宝箱 `fram_02` 蓝）。
     *    需求原文后半句「**通关了，fram 要去掉，用 img_land_01**」就是这里的 `passed ⇒ 不叠框`。
     */
    private paintHexes(input: ITerritoryMapRenderInput): void {
        const revealed = new Set(input.revealedCells);
        const siteByCell = new Map(input.map.sites.map((site) => [site.cellId, site]));
        const candidateCells = new Set(input.map.randomSites?.candidateCells ?? []);
        const recolors: ITerritoryHexRecolorPending[] = [];
        for (const [cellId, node] of this.hexNodes) {
            node.active = revealed.has(cellId);
            if (!node.active) continue;
            const passed = this.isCellPassed(cellId, input, siteByCell, candidateCells);
            const nextFrame = passed ? input.art.tileCleared : input.art.tileLocked;
            const ground = node.getComponent(Sprite);
            // 换色判据要的是「**写之前**那一帧」—— `applyTileFrame` 一写就没有可 diff 的东西了。
            const fromFrame = ground?.spriteFrame ?? null;
            const recoloring = this.shouldRecolor(cellId, node, ground, nextFrame);
            this.applyTileFrame(node, nextFrame);
            if (recoloring) {
                const point = input.layout.points.get(cellId);
                recolors.push({
                    cellId,
                    node,
                    from: fromFrame,
                    to: nextFrame,
                    x: point?.x ?? 0,
                    y: point?.y ?? 0,
                });
            }
            this.applyHexFrame(cellId, this.hexFrameOf(cellId, input, siteByCell, passed));
        }
        this.syncHexRecolor(recolors);
        // 破冰：**首帧只做快照**（进页面 / 换章时整图的地皮帧都会"从 null 变成正式帧"）。
        this.recolorBootstrapped = true;
        this.syncHexSpawn(input, revealed);
    }

    /**
     * 这一格要不要播「换色」。
     *
     * 判据 = 地皮**帧 → 帧**真的变了，且这一格上一帧就看得见，且没被翻格 / 生成接管。
     *
     *  ⚠️ 刻意**不用** `passed` 翻转：「通关」在四类格上的口径各不相同（起始格 / 随机资源格 /
     *    宝箱 / 战斗站点，见 {@link isCellPassed}），而"地皮换了"是它们的共同结果 ——
     *    只要从泥块变草地就该放这段。
     *  ⚠️ 两张帧都要非空：美术刚加载完的那一帧是「null → 正式帧」，那是**整屏误判**的经典来源。
     */
    private shouldRecolor(
        cellId: number,
        node: Node,
        ground: Sprite | null,
        nextFrame: SpriteFrame | null,
    ): boolean {
        if (!this.recolorBootstrapped) return false;
        // 已经在播的格子不重入（`paintHexes` 每秒全量走一遍，而一段换色要 0.36s）。
        if (this.hexRecolor.isPlaying(node)) return false;
        return !!ground && !!nextFrame
            && ground.spriteFrame !== nextFrame
            && this.revealedSnapshot.has(cellId)
            && !this.hexFlip.isPlaying(node)
            && !this.hexSpawn.isPlaying(node);
    }

    /**
     * 把本帧攒下的格子**整批**起播。
     *
     *  为什么先攒再播：错峰要按这一批的**簇心**排（见 `territoryHexRecolorDelays`）——
     *  循环里一格一格播就只能按 `hexNodes` 的扫描顺序，屏幕上读成毫无方向的乱序闪烁。
     */
    private syncHexRecolor(pending: readonly ITerritoryHexRecolorPending[]): void {
        if (pending.length === 0) return;
        const delays = territoryHexRecolorDelays(pending);
        for (const entry of pending) {
            this.hexRecolor.play(entry.node, entry.from, entry.to, delays.get(entry.cellId) ?? 0);
        }
        // 🔴 写完帧要**同帧再藏一次**格根地皮：`applyTileFrame` 刚把满尺寸的新地皮写回格根、
        // 并把 `enabled` 置回 true，而换色正把格根地皮藏着 —— 不补这一下，每秒一次的重绘
        // 都会在"长大的新地皮"底下闪出一帧满尺寸的新地皮，读作"闪一下再长"。
        for (const entry of pending) {
            const node = entry.node;
            if (this.hexRecolor.isPlaying(node)) this.hexRecolor.hideGround(node);
        }
    }

    /**
     * 「新地块生成」：本帧**新出现**的格子整批进场。
     *
     * ## 两条触发（2026-10-28 加第二条）
     *
     * | 来源 | 判据 | 场景 |
     * | :-- | :-- | :-- |
     * | 新露出 | `revealed` 里上一帧没有 | 解锁一片新区域 / 云散开 |
     * | **新解锁** | `isCellUnlocked` 这一帧才变 true | 点锁着的关卡格花银币解锁（用户口径）|
     *
     * 🔴 第二条不能用第一条代替：`revealed` 本来就含「前沿看得见、还没花钱开」的格子，
     * 关卡格从「锁着（银币 + 数字）」变「已解锁（关卡建筑）」时**前后都在 `revealed` 里**
     * ⇒ 露出集合的 diff 恒为 0，外观直接换、没有过渡，读作"点了一下什么都没发生"。
     *
     * ⚠️ 必须排在 `paintHexes` 的末尾、且**在 `syncFlip` 之前**（`renderMap` 的调用顺序）：
     *  · 末尾 ⇒ 格子的 `active` 已经置好，`play` 写起手帧时节点是可见的；
     *  · 在 `syncFlip` 之前 ⇒ 同格如果紧接着要翻格（随机资源格），`syncFlip` 里的
     *    `hexSpawn.stop()` 能立刻掐掉这层淡入（翻格自己有"新地皮放大填充"，两层叠一起会糊）。
     */
    private syncHexSpawn(input: ITerritoryMapRenderInput, revealed: ReadonlySet<number>): void {
        const progress = input.progress;
        if (!this.spawnBootstrapped) {
            this.revealedSnapshot.clear();
            for (const cellId of revealed) this.revealedSnapshot.add(cellId);
            this.unlockedSnapshot.clear();
            for (const cellId of revealed) {
                if (progress.isCellUnlocked(cellId)) this.unlockedSnapshot.add(cellId);
            }
            this.spawnBootstrapped = true;
            return;
        }
        // ① 先攒「本帧要进场的格」：新露出 ∪ 新解锁，去重。
        const entered = new Set<number>();
        for (const cellId of revealed) {
            if (!this.revealedSnapshot.has(cellId)) entered.add(cellId);
        }
        // 新解锁：这一帧才变 true 的格子（解锁前就已露出 ⇒ 上面那条看不见）。
        for (const cellId of revealed) {
            if (!progress.isCellUnlocked(cellId) || this.unlockedSnapshot.has(cellId)) continue;
            entered.add(cellId);
        }
        // ② 再过滤成可播的节点
        const fresh: { cellId: number; x: number; y: number; node: Node }[] = [];
        for (const cellId of entered) {
            const node = this.hexNodes.get(cellId);
            if (!node) continue;
            // 正在翻的格子让给翻格（那条动画自带"新地皮从格心放大"）。
            if (this.hexFlip.isPlaying(node)) continue;
            const point = input.layout.points.get(cellId);
            fresh.push({ cellId, node, x: point?.x ?? 0, y: point?.y ?? 0 });
        }
        this.revealedSnapshot.clear();
        for (const cellId of revealed) this.revealedSnapshot.add(cellId);
        this.unlockedSnapshot.clear();
        for (const cellId of revealed) {
            if (progress.isCellUnlocked(cellId)) this.unlockedSnapshot.add(cellId);
        }
        if (fresh.length === 0) return;
        // 错峰只在**这一批**内部算（簇心 = 这批新格的包围盒中心），与场上其它格子无关。
        const delays = territoryHexSpawnDelays(fresh);
        for (const cell of fresh) {
            // 地形节点自己会淡（`UIOpacity` 挂在格节点上，子节点跟着淡）；
            // 站点那四块在别的层里，只能靠回调把同一档透明度递过去。
            this.hexSpawn.play(cell.node, delays.get(cell.cellId) ?? 0,
                (opacity) => this.stationViews.get(cell.cellId)?.setSpawnOpacity(opacity));
        }
    }


    /**
     * 这一格**是否已通关 / 已占领**（决定用草地块还是泥土块）。
     *
     *  ⚠️ 四类格的「通关」口径**各不相同**，别用一条 `isOwned` 打天下：
     *  · 起始格 —— 永远算通关（我方基地）；
     *  · 随机资源格（`randomSites.candidateCells`）—— 银币开启即算（开出来就是我的资源建筑）；
     *  · 宝箱（`fixedResource`）—— `isOwned`（领完即算）；
     *  · 战斗站点（`stage` / `boss` / `asyncPvp`）—— **`isAreaPassed`**（区域口径：
     *    同 `configId` 的 327/328 任一通关整片都算，与 `stationRenderOf` 同源）。
     */
    private isCellPassed(
        cellId: number,
        input: ITerritoryMapRenderInput,
        siteByCell: ReadonlyMap<number, TerritorySite>,
        candidateCells: ReadonlySet<number>,
    ): boolean {
        if (cellId === input.map.startCellId) return true;
        if (candidateCells.has(cellId)) return input.progress.isCellUnlocked(cellId);
        const site = siteByCell.get(cellId);
        if (!site || site.type === TERRITORY_SITE_TYPE.fixedResource) return input.progress.isOwned(cellId);
        return input.progress.isAreaPassed(cellId);
    }

    /**
     * 这一格要不要叠框、叠哪张；`null` = 不叠。
     *
     *  条件 = **已解锁（或已占领）且未通关**：
     *  · 未解锁 ⇒ 不叠（「解锁」这个动作本身就是框出现的那一刻）；
     *  · 已通关 ⇒ 不叠（需求原文「通关了 fram 要去掉」）；
     *  · `bonus` / 中立格查不到对应的美术框 ⇒ 不叠（`TERRITORY_SITE_FRAME` 里没有）。
     *
     *  ⚠️ 「已解锁」沿用地皮那套的老判据 `isCellUnlocked || isOwned`，与 `stationRenderOf`
     *  的 `isOpened` 同口径 —— 两处一旦漂移就会出现「地皮说能打、框没出来」且零报错。
     */
    private hexFrameOf(
        cellId: number,
        input: ITerritoryMapRenderInput,
        siteByCell: ReadonlyMap<number, TerritorySite>,
        passed: boolean,
    ): SpriteFrame | null {
        if (passed) return null;
        const site = siteByCell.get(cellId);
        if (!site) return null;
        const opened = input.progress.isCellUnlocked(cellId) || input.progress.isOwned(cellId);
        if (!opened) return null;
        const key = TERRITORY_SITE_FRAME[site.type];
        return key ? input.art[key] : null;
    }

    /**
     * 写格子的地皮帧（**唯一写入口**），并把节点尺寸对齐到帧的画布尺寸。
     *
     * ## 为什么尺寸要跟帧走，而不是钉死 `HEX_GRID_IMAGE_*`
     *
     *  两张新地皮是 **126×117**，而设计常量是 130×119。差 3% 看着无所谓，但**格面框
     *  （`frame_*.png`，124×92）是按实际格面画的**：底图被 CUSTOM 拉到 130×119 时格面渲染成
     *  ~129px 宽，框只有 124 ⇒ 框明显缩在格子中间、与地皮边缘错开。
     *  让节点尺寸 == `frame.originalSize`（1:1 像素映射、零拉伸）后格面 ≈ 125px、框 124px，贴合。
     *
     *  ⚠️ **格子站位（列距 92.25 / 行距 90）不由节点尺寸决定**，所以改尺寸不动布局几何、
     *  也不动 `cellCenter` 的落点口径。帧缺失时退回设计值，不写 0×0（那会让整格消失且不报错）。
     */
    private applyTileFrame(node: Node, frame: SpriteFrame | null): void {
        const sprite = node.getComponent(Sprite)!;
        if (sprite.spriteFrame !== frame) sprite.spriteFrame = frame;
        sprite.enabled = frame !== null;
        // 地皮恒白：状态不再靠染色，染色会把成品美术的明暗压脏。
        if (!sprite.color.equals(Color.WHITE)) sprite.color = Color.WHITE;
        const size = frame?.originalSize;
        const width = size && size.width > 0 ? size.width : HEX_GRID_IMAGE_WIDTH;
        const height = size && size.height > 0 ? size.height : HEX_GRID_IMAGE_HEIGHT;
        const transform = node.getComponent(UITransform)!;
        const current = transform.contentSize;
        // 同值不写：`setContentSize` 会把节点标脏，而本函数每次渲染（每秒）都会走一遍。
        if (current.width === width && current.height === height) return;
        transform.setContentSize(width, height);
    }

    /**
     * 写格面框的帧（**唯一写入口**）；`null` ⇒ 整个框节点收起。
     *
     *  尺寸同样按帧 1:1（124×92），落点由 `createHex` 固定在 `HEX_GRID_CONTENT_LIFT`
     *  —— 与建筑图标同轴，框的六边形中心就落在格面中心上。
     */
    private applyHexFrame(cellId: number, frame: SpriteFrame | null): void {
        const sprite = this.hexFrames.get(cellId);
        if (!sprite) return;
        const visible = frame !== null;
        if (sprite.spriteFrame !== frame) sprite.spriteFrame = frame;
        sprite.enabled = visible;
        // 写**绝对** active（换章复用后不能依赖上一次状态）。
        if (sprite.node.active !== visible) sprite.node.active = visible;
        if (!frame) return;
        const size = frame.originalSize;
        const width = size && size.width > 0 ? size.width : HEX_GRID_FACE_WIDTH;
        const height = size && size.height > 0 ? size.height : HEX_GRID_FACE_HEIGHT;
        const transform = sprite.node.getComponent(UITransform)!;
        const current = transform.contentSize;
        if (current.width === width && current.height === height) return;
        transform.setContentSize(width, height);
    }

    /**
     * 站点视图**追赶**「新地块生成」的当前进度。
     *
     *  `renderMap` 的顺序是「格子 → 翻格 → 站点」：新格子的站点视图是在**同一次 render 的后半段**
     *  才 `render` 出来的，它错过了 `hexSpawn.play()` 那一次起手帧 ⇒ 不补这一下，
     *  站点图标/银币数字会先以全不透明闪一帧，下一帧才跟地块一起淡入。
     */
    private applyHexSpawnFade(cellId: number, view: TerritoryStationView): void {
        const node = this.hexNodes.get(cellId);
        if (!node) return;
        const opacity = this.hexSpawn.opacityOf(node);
        if (opacity !== null) view.setSpawnOpacity(opacity);
    }

    /** 站点：按 cellId diff 复用，逐个全量赋值（同一章内每秒都会走一遍）。 */
    private syncStations(input: ITerritoryMapRenderInput): void {
        const revealed = new Set(input.revealedCells);
        // 首轮只做快照、不播任何「刚生成」的动效（见 `syncChestSpawnView`）。
        const firstPass = !this.stationsReady;
        const startPoint = input.layout.points.get(input.map.startCellId);
        if (startPoint) {
            const view = this.ensureStartView();
            const startCenter = this.cellCenter(startPoint);
            view.setMapPosition(startCenter.x, startCenter.y, 0);
            view.render({
                site: null,
                icon: input.art.start,
                caption: '',
                tint: TERRITORY_COLORS.owned,
                badge: '',
                interactive: false,
                // 🔴 2026-10-28 山猫：初始点位也要有气泡，提示这里是「章节」入口。
                // 底图走 `levelBubbleFrame`（现在与所有气泡同图，蓝色 `frame_03`）——
                // 初始点从开局就属于玩家，不该跟"待挑战"的格子长得不一样。
                levelBubble: TERRITORY_START_BUBBLE_TEXT,
                levelBubbleFrame: input.art.levelBubbleFrame ?? null,
            });
        }
        const seen = new Set<number>();
        for (const site of input.map.sites) {
            if (!revealed.has(site.cellId)) continue;
            const point = input.layout.points.get(site.cellId);
            if (!point) continue;
            seen.add(site.cellId);
            const view = this.stationViews.get(site.cellId) ?? this.createStation(site);
            const center = this.cellCenter(point);
            view.setMapPosition(center.x, center.y, 0);
            // 建筑体量倍率（表「模型大小」）在这里统一补：stationRenderOf 有 5 个 return 分支，
            // 逐个加字段容易漏；包一层只动一个点，且 site 本来就在手边。
            const base = this.stationRenderOf(site, input);
            const performing = this.chestPlayingCell === site.cellId;
            const content = {
                ...base,
                iconScale: this.buildScaleOf(site, input.art),
                // 四棵棕榈（69010~69013）走「底边对齐格心」而不是居中 —— 与 `iconScale` 同源
                // 判据（`site.buildingId` 在地图 JSON 里是**字符串**，必须 `Number(...)`）。
                // ⚠️ 判定函数从 `TerritoryStationView` 引入，白名单只留一份（这里抄 id 会口径分裂）。
                bottomAnchor: territoryUsesBottomAnchor(Number(site.buildingId)),
                // 开箱表演期间摘掉地图上那只（见 `chestPlayingCell`：不摘会在收尾淡出时透出来）。
                icon: performing ? null : base.icon,
            };
            view.render(content);
            // 站点比格节点晚一拍建出来 ⇒ 补写一次当前的生成进度，免得先以全不透明闪一帧。
            this.applyHexSpawnFade(site.cellId, view);
            // 固定资源格的「生成宝箱」反馈要按 diff 判（需求 2026-10-22 §1）。
            this.syncChestSpawnView(site, content, firstPass);
        }
        for (const cellId of input.map.randomSites?.candidateCells ?? []) {
            if (!revealed.has(cellId)) continue;
            const point = input.layout.points.get(cellId);
            if (!point || seen.has(cellId)) continue;
            seen.add(cellId);
            const isOpened = input.progress.isCellUnlocked(cellId);
            const isOpenable = input.randomResourceOpenableCells.includes(cellId);
            const isPending = input.pendingRandomResourceCells.includes(cellId);
            const target = { kind: 'randomResource' as const, cellId };
            const view = this.stationViews.get(cellId) ?? this.createStation(target);
            const center = this.cellCenter(point);
            view.setMapPosition(center.x, center.y, 0);
            // ⚠️ 建筑图**逐格**取：`randomSites.buildingIds[cellId]` 才是这一格配的建筑。
            // ⚠️ 键要 `Number(...)`：表里 `buildId` 是数字、地图 JSON 里是**字符串**（`"69006"`），
            //    不归一就是永远查不到、静默退回默认图 —— 表现为「配了 id 但外观没变」，零报错。
            const buildingId = Number(input.map.randomSites?.buildingIds?.[cellId] ?? '');
            const openedFrame = isOpened && Number.isFinite(buildingId)
                ? input.art.buildFrames?.get(buildingId) ?? null
                : null;
            const content: ITerritoryStationRender = {
                site: isOpened || isPending ? null : target,
                // 没配 buildingId（或查不到帧）⇒ **不给建筑图**，只留绿色地块表现已开启。
                icon: openedFrame,
                iconScale: isOpened && Number.isFinite(buildingId)
                    ? input.art.buildScales?.get(buildingId) ?? 1
                    : 1,
                // 与站点路同一条判定：`buildingId` 可能是 `undefined`（这一格没配建筑）⇒ 先挡非有限值，
                // 否则 `undefined` 会一路传进白名单判定。
                bottomAnchor: Number.isFinite(buildingId) && territoryUsesBottomAnchor(buildingId),
                isCondition: !isOpened,
                isLoading: isPending,
                conditionIcon: input.art.randomSilverIcon,
                conditionTextColor: isOpenable || isOpened
                    ? TERRITORY_COLORS.randomAvailableText : TERRITORY_COLORS.randomConditionText,
                caption: isOpened ? ''
                    : isPending ? ''
                        : String(input.map.randomSites?.triggerSilver ?? 0),
                // 随机格只展示银币图标与银币数量；开启后用绿色地块/建筑表达状态，不再叠加文字。
                // ⚠️ 没配buildingId 的开启格也是这个绿地块 —— 这是「没有建筑」的表现，
                //    不是漏画（漏画的症状是残留未开启时的银币条件样式）。
                tint: isOpened ? TERRITORY_COLORS.cleared
                    : isOpenable ? TERRITORY_COLORS.gold : TERRITORY_COLORS.locked,
                badge: '',
                interactive: !isOpened && !isPending,
            };
            if (this.pendingBuildingReveal.has(cellId)) {
                // 需求 2026-10-16 row14：**建筑展示滞后到地块翻转结束**。
                // 数据上这一格已经是「已开启」，但地皮正在翻 ⇒ 先整站不显示，
                // 等 `resolveBuildingReveal` 在翻转播完那一帧再把这同一份 content 交回去。
                // ⚠️ 必须存下**这一份**：解除待办发生在 `update`，那时算不出 content。
                this.pendingBuildingRender.set(cellId, content);
                view.render({ ...content, hidden: true });
            } else {
                view.render(content);
            }
            // 同上：随机格也会是新露出的格子，补写一次当前的生成进度。
            this.applyHexSpawnFade(cellId, view);
        }
        for (const [cellId, view] of this.stationViews) {
            if (seen.has(cellId)) continue;
            this.stationViews.delete(cellId);
            view.dispose();
            view.node.destroy();
        }
        // 首轮快照到此为止：从下一轮起「上一轮有没有宝箱」才有意义。
        this.stationsReady = true;
    }

    /**
     * 固定资源格「**生成宝箱**」的那一下（需求 2026-10-22 §1：「增加固定资源生成宝箱的动画反馈，
     * 类似装饰建筑的动效」）。
     *
     * ## 判据
     *
     *  ① 只看 `fixedResource` 格 —— 其它站点有自己的解锁/翻格表现，不该跟着抖；
     *  ② 「摆着宝箱」= 这一轮渲染出来**有宝箱图**（`content.icon != null`）。
     *     领取后 `stationRenderOf` 会给 `icon: null`（宝箱从地图上消失），所以领完再解锁一次
     *     也会重新抖一下 —— 这正是「又生成了一个宝箱」的观感；
     *  ③ 触发 = 「上一轮没有、这一轮有」，与 `syncStations` 每秒全量渲染的节奏对齐。
     *
     * ## 为什么首轮不播
     *
     *  进页面 / 换章的首帧上，所有已解锁的宝箱都是「这一轮有」；不做快照就会一屏几十个
     *  宝箱同时抖一下，读作「整章刚刷新」。`stationsReady` + `syncGrid` 的复位就是这道闸。
     *
     * ## 动效复用
     *
     *  直接借装饰建筑的那条脉冲（`TerritoryStationView.playBuildingShake` →
     *  `core/hex/ShakePresentation`，与随机格揭示建筑同一份曲线），不新造一套参数。
     */
    private syncChestSpawnView(
        site: TerritorySite,
        content: ITerritoryStationRender,
        firstPass: boolean,
    ): void {
        if (site.type !== TERRITORY_SITE_TYPE.fixedResource) {
            this.chestCells.delete(site.cellId);
            return;
        }
        // 这一格正在演开箱：宝箱图是我们自己摘掉的（≠ 真的没了），快照不动，免得演完又抖一次。
        if (this.chestPlayingCell === site.cellId) return;
        // 还在等翻格 ⇒ 这一轮根本看不见它，先不记快照，等可见那一轮再判（否则抖动会被吞掉）。
        if (content.hidden) return;
        const hasChest = content.icon !== null && content.icon !== undefined;
        const had = this.chestCells.has(site.cellId);
        if (hasChest) this.chestCells.add(site.cellId);
        else this.chestCells.delete(site.cellId);
        if (firstPass || !hasChest || had) return;
        // 不立刻抖：排进延迟表，由 `stepChestSpawnDelays` 在 `update` 里扣到 0 再播
        // （需求：宝箱要比地块那一下稍晚，见 `CHEST_SPAWN_SHAKE_DELAY_SECONDS`）。
        this.chestSpawnDelay.set(site.cellId, CHEST_SPAWN_SHAKE_DELAY_SECONDS);
    }

    /**
     * 推进「宝箱生成抖动」的延迟队列（每帧扣时间，扣到 0 的那一帧播脉冲）。
     *
     *  一次性队列：播完即删，同一格不会被抖第二次（下一次抖动由 `syncChestSpawnView` 重新排）。
     */
    private stepChestSpawnDelays(dt: number): void {
        if (!this.chestSpawnDelay.size) return;
        for (const [cellId, remain] of this.chestSpawnDelay) {
            const next = remain - dt;
            if (next > 0) {
                this.chestSpawnDelay.set(cellId, next);
                continue;
            }
            this.chestSpawnDelay.delete(cellId);
            // 格子可能已经被换章销毁 / 领取后站点被复用 ⇒ 查不到就跳过，不补播。
            this.stationViews.get(cellId)?.playBuildingShake();
        }
    }

    private createStation(site: TerritoryStationTarget): TerritoryStationView {
        const node = instantiate(this.stationPrefab);
        node.layer = this.stationHitLayer.layer;
        node.setParent(this.stationHitLayer);
        node.name = 'kind' in site ? `RandomResource_${site.cellId}` : `Site_${site.id}`;
        // ⚠️ 视图在 prefab 上（`TerritoryStation.prefab` 挂了 `TerritoryStationView`）。
        const view = node.getComponent(TerritoryStationView)!;
        view.initialize(this.getStationLayers());
        // 站点点击不再逐节点挂监听：全局订阅 `STATION_TAP` 一次（见 `onEnable`）。
        // 起始格（`ensureStartView` 走 `clickable = false`）本来就不发。
        this.stationViews.set(site.cellId, view);
        return view;
    }

    /** 站点点击转发：站点节点事件 → 地图容器节点事件（页面在 `mapView.node` 上收）。 */
    private readonly onStationClick = (site: TerritoryStationTarget): void => {
        // 表演期间的输入锁：直接吞掉（连点会再发一次解锁/领取请求，且动画位置会被刷新打断）。
        if (this.inputLocked) return;
        // 点击反馈必须在**转发之前**播：页面收到事件会发请求，请求期间有全屏 loading 遮挡，
        // 反馈若排在后面就永远被挡住（等于没做）—— 规格要求「按下 0.1s 内看到反馈」。
        this.playTapFeedback(site.cellId);
        EventMgr.instance.emit(TERRITORY_EVENTS.STATION_CLICK, site);
    };

    /** 起始格：唯一的固定实例（不可点、不池化），首次渲染时建。 */
    private ensureStartView(): TerritoryStationView {
        if (this.startView?.isValid) return this.startView;
        const node = instantiate(this.stationPrefab);
        node.layer = this.stationHitLayer.layer;
        node.setParent(this.stationHitLayer);
        node.name = 'Start';
        const view = node.getComponent(TerritoryStationView)!;
        view.initialize(this.getStationLayers(), false);
        this.startView = view;
        return view;
    }

    private getStationLayers(): ITerritoryStationLayers {
        if (this.stationLayers) return this.stationLayers;
        // 气泡带点击入口，必须高于相邻站点的透明命中区，否则点编号会选中上一行的关卡。
        const hitIndex = this.stationHitLayer.getSiblingIndex();
        if (this.stationBadgeLayer.getSiblingIndex() < hitIndex) this.stationBadgeLayer.setSiblingIndex(hitIndex);
        this.stationLayers = {
            icon: this.stationIconLayer,
            caption: this.stationCaptionLayer,
            text: this.stationTextLayer,
            badge: this.stationBadgeLayer,
            hit: this.stationHitLayer,
        };
        return this.stationLayers;
    }

    /**
     * 站点 → 画法。**状态判定的唯一真源**就在这里，视图只收结果。
     */
    private stationRenderOf(site: TerritorySite, input: ITerritoryMapRenderInput): ITerritoryStationRender {
        const stage = input.stageByCell.get(site.cellId) ?? null;
        const isOpened = input.progress.isCellUnlocked(site.cellId)
            || input.progress.isOwned(site.cellId);
        if (!isOpened) {
            const isOpenable = input.siteOpenableCells.includes(site.cellId);
            const isPending = input.pendingFixedResourceCells.includes(site.cellId);
            // 🔴 前置宝箱（fixedResource）已解锁但没领取 ⇒ 后继格银币数字用**红色**提示
            // （山猫 2026-10-21：前置格没有通关状态 = 还没 passCell 领取）。服务端对固定资源
            // 的 completed 记在 unlockCells（`isPrerequisiteComplete` 的固定资源特例正是镜像它），
            // 所以这里**只改视觉不动解锁**：未领取只把数字染红，点击解锁照常可进行 ——
            // 领取后（owned）数字回白。
            //（`input.map?.` 全链可选：防御沙箱测试的宽松输入，真实渲染 input.map 必有；
            //  `requiredCells ?? []` 同理 —— 配置归一后恒有，裸对象沙箱可能缺。）
            const unclaimedFixedPrereq = (site.unlock.requiredCells ?? []).some((cell) =>
                input.progress.isCellUnlocked(cell)
                && !input.progress.isOwned(cell)
                && (input.map?.sites?.find((s) => s.footprint.includes(cell))?.type
                    === TERRITORY_SITE_TYPE.fixedResource));
            return {
                site,
                icon: null,
                isCondition: true,
                isLoading: isPending,
                conditionIcon: input.art.randomSilverIcon,
                conditionTextColor: isOpenable && !unclaimedFixedPrereq
                    ? TERRITORY_COLORS.randomAvailableText : TERRITORY_COLORS.randomConditionText,
                caption: isPending
                    ? ''
                    : String(site.unlock.silverCost),
                tint: isOpenable ? TERRITORY_COLORS.gold : TERRITORY_COLORS.locked,
                badge: '',
                interactive: !isPending,
            };
        }
        if (site.type === TERRITORY_SITE_TYPE.fixedResource) {
            const claimed = input.progress.isOwned(site.cellId);
            const pending = input.pendingFixedResourceCells.includes(site.cellId);
            // 领取后清除宝箱图，状态只由地块颜色表达。
            return {
                site,
                icon: claimed ? null : this.stationIconOf(site, null, input.art),
                isLoading: pending,
                caption: '',
                // 已领取（已通关）的固定资源点不再显示解锁消耗，用「已通关」绿与「可领取」区分开。
                tint: claimed ? TERRITORY_COLORS.cleared : territoryStationTint(TERRITORY_STATION_STATE.available),
                badge: '',
                interactive: !claimed && !pending,
            };
        }
        // 所有战斗站点（`stage` / `boss` / `asyncPvp`）都在这里：先解锁展示建筑，
        // 已解锁再点击 ⇒ `CmdStartBattleReqMsg` 开战（**不发**通关）。
        // 判定必须与 `TerritoryPresenter.selectSite` 的关卡分支**同口径**（都是站点类型），
        // 之前两边都写的是「两步式名单 [327,328] 或 isBoss」⇒ 只有关卡 1 会长这样、能点下有反应，
        // 其余关卡外观照旧却已经不可点 ⇒ 「外观说能打、点了没反应」。
        if (site.type === TERRITORY_SITE_TYPE.stage || site.type === TERRITORY_SITE_TYPE.boss || site.type === TERRITORY_SITE_TYPE.asyncPvp) {
            const isAsyncPvp = site.type === TERRITORY_SITE_TYPE.asyncPvp;
            if (isAsyncPvp && !stage) {
                const isUnlocked = input.progress.isCellUnlocked(site.cellId);
                const isOwned = input.progress.isOwned(site.cellId);
                return {
                    site,
                    icon: this.stationIconOf(site, null, input.art),
                    caption: '',
                    tint: isUnlocked ? territoryBossTint()
                        : isOwned ? TERRITORY_COLORS.owned : territoryStationTint(this.stateOf(site, input)),
                    badge: '',
                    interactive: !isUnlocked && !isOwned,
                };
            }
            // 🔴 **区域口径**（2026-10-12）：327 与 328 同 `configId=10001`、打同一关卡
            //   ⇒ 任一格通关，整片都算已通关（山猫「327/328 算一起的」）。
            //   只查查询态、不动 `owned` 存储 —— 见 `TerritoryProgress.isAreaPassed` 注释。
            const claimed = input.progress.isAreaPassed(site.cellId);
            const pending = input.pendingFixedResourceCells.includes(site.cellId);
            return {
                site,
                icon: this.stationIconOf(site, stage, input.art),
                // 美术稿是 `1-1`：连字符两侧**不留空格**。间距由 `MAP_MARKER_BADGE_SPACING_X` 控，
                // 字符串里塞空格的话，换字号 / 换字体时那个空格宽度会跟着漂。
                // 🔴 异步据点（2026-10-28 山猫）**不显示编号**：它可重复挑战，编号会读成"第 4 关"，
                //   统一写 `PVP`。判定放在编号之前 —— 异步据点也有 `stage`（`configId` 2000x），
                //   若先算编号就只有"没绑关卡的异步据点"才会变，看起来像没改。
                levelBubble: isAsyncPvp
                    ? TERRITORY_ASYNC_PVP_BUBBLE_TEXT
                    : stage ? `${stage.chapterId}-${stage.stage}` : undefined,
                // 气泡底图**统一蓝色**（2026-10-28 16:23 用户改回）：两个槽位现在指同一张图，
                // 但二选一管线保留 —— 将来要分色只改 `MapMarkerBadge` 常量，这里不用动。
                // 通关状态由地皮图表达（草地 / 泥土），气泡只回答"这是第几关"。
                levelBubbleFrame: claimed
                    ? input.art.levelBubbleFrame ?? null
                    : input.art.levelBubblePendingFrame ?? input.art.levelBubbleFrame ?? null,
                isLoading: pending,
                caption: '',
                // 已通关不再显示解锁消耗，用「已通关」绿区分开（与 fixedResource 同口径）。
                tint: claimed ? TERRITORY_COLORS.cleared
                    : isAsyncPvp && input.progress.isCellUnlocked(site.cellId)
                        ? territoryBossTint() : territoryStationTint(this.stateOf(site, input)),
                badge: '',
                // 🔴 2026-10-28 用户：「点击已通过的关卡也可以打开【领地关卡信息弹窗】」。
                // 原来这里写的是 `claimed ? isAsyncPvp : true` —— 打完的 `stage`/`boss` 直接不可点，
                // 玩家想回头看一眼通关目标 / 占领奖励 / 敌军一览都点不开。
                // 现在**已通关也可点**：`selectSite` 对已解锁 / 区域已通关的关卡一律只开弹窗
                // （开战请求在 `handleBattleStationStart` 里另有守卫，不会误发）。
                // 唯一不可点的情况是请求在途（`pending`，防连点；loading 遮挡是主防线）。
                interactive: !pending,
            };
        }
        if (!stage) {
            return {
                site,
                icon: this.stationIconOf(site, null, input.art),
                caption: '',
                tint: input.progress.isOwned(site.cellId)
                    ? TERRITORY_COLORS.owned
                    : territoryUnboundTint(site.type),
                badge: '',
                interactive: true,
            };
        }
        const state = this.stateOf(site, input);
        return {
            site,
            icon: this.stationIconOf(site, stage, input.art),
            caption: '',
            tint: stage.isBoss && state !== TERRITORY_STATION_STATE.owned ? territoryBossTint() : territoryStationTint(state),
            badge: '',
            interactive: true,
        };
    }

    /**
     * 站点→ 建筑帧。**建筑类外观的唯一真源：地图配的 `buildingId`**（2026-10-10 起）。
     *
     * ## 🔴 关卡 / 首领：只有配了 `buildingId` 才展示建筑，**其余一律不画建筑**
     *
     * 山猫原话：「**boss关卡，只有有建筑id 才在解锁展示建筑，其余的不展示建筑**」。
     * 早期这里是「没配 id 就回退按 `type` 取图（`boss`→首领图/`stage`→普通关卡图）」，
     * 结果同 `configId` 的多个站点**人人有图**（截图中一片黄色六边形里到处是建筑图标），
     * 而设计上「一片区域只有那个配了 id 的站点生成建筑」。
     *
     * 🔴 **口径覆盖 `stage` / `boss` / `asyncPvp` 三类战斗站点**（`asyncPvp` 于 2026-10-16 并入，
     * 山猫「异步战点也要跟 Boss 一样，通关 / 解锁都是有建筑 id 才显示建筑」）：
     * 它们**一律**「配了 `buildingId` 且查得到帧」才画建筑，否则交给 `tint` + 格面框表现格子本身。
     * 仍然按 `type` 取图的只剩 `fixedResource` / `bonus` —— 宝箱（chapter_01 有 82 个）全部没配
     * `buildingId`，一刀切会让它们集体变成纯色块 + 文字，等于宝箱从地图上消失。
     *
     * ⚠️ 「解锁后才显示建筑」这层不在这里，而在 `stationRenderOf` 最上面的 `!isOpened` 分支
     * （未解锁一律 `icon: null` + 银币条件）。本方法只管「该不该有建筑图」，不管状态。
     *
     * 判据是 `site.buildingId`（**不是** type、**不是** `isBoss`）：
     * ① 配了 id ⇒ 按 `buildId` 去建筑表查（`art.buildFrames`）；
     * ② `stage`/`boss` 没配 id / 查不到 ⇒ **返回 `null`（不画建筑）**，交给 `tint` 表现格子本身。
     *
     * ⚠️ 查表键要 `Number(...)`：表里 `buildId` 是数字，地图 JSON 的 `buildingId` 是**字符串**
     *  （如 `"69003"`），不归一就是永远查不到、静默不画 —— 表现为「配了 id 但外观没变」。
     */
    private stationIconOf(
        site: TerritorySite,
        stage: TerritoryCampaignStage | null,
        art: ITerritoryMapArt,
    ): SpriteFrame | null {
        const buildingId = Number(site.buildingId);
        if (Number.isFinite(buildingId) && site.buildingId) {
            const framed = art.buildFrames?.get(buildingId);
            if (framed) return framed;
        }
        // 🔴 关卡 / 首领 / **异步据点**：没配 `buildingId`（或查不到帧）⇒ **返回 null，不画建筑**。
        // ⚠️ 这里**不能**再往下 fallback 到 `TERRITORY_SITE_ART` ——
        //   同一片战斗区域（相同 configId）里多个站点共用一张 type 图，
        //   而 `stage` 的 type 图恰好就是 `69004` 查表得到的同一张
        //   ⇒「327 和 328 长得一样」，视觉上仍是「一片区域到处是建筑」。
        // 🔴 2026-10-16 山猫「**异步战点也要跟 Boss 一样**，通关 / 解锁都是有建筑 id 才显示建筑」
        //   ⇒ `asyncPvp` 从「按 type 取图」并入本名单。chapter_01 的 16 个异步据点里只有 4 个配了
        //   `buildingId=69002` ⇒ 其余 12 个不再画建筑，只留格面框 + 「异步据点」文案。
        //   连带 `TerritorySiteType` 的 type 回退现在**只服务 `fixedResource` / `bonus`**。
        if (site.type === TERRITORY_SITE_TYPE.stage || site.type === TERRITORY_SITE_TYPE.boss || site.type === TERRITORY_SITE_TYPE.asyncPvp) return null;
        if (stage?.isBoss) return art.boss ?? art.stage;
        return art[TERRITORY_SITE_ART[site.type]] ?? art.stage;
    }

    /**
     * 建筑体量倍率（表 `build.json` 的 `buildSize`，缺省 1）。
     *
     *  查表键与 `stationIconOf` 同一套口径：地图 JSON 的 `buildingId` 是**字符串**（`"69003"`），
     *  不 `Number(...)` 归一就永远查不到，表现是「配了 buildSize 但外观没变」，零报错。
     *  非法值（NaN / ≤0）一律按 1 —— 倍率 0 会让建筑凭空消失，也不报错。
     */
    private buildScaleOf(site: TerritorySite, art: ITerritoryMapArt): number {
        const buildingId = Number(site.buildingId);
        if (!Number.isFinite(buildingId) || !site.buildingId) return 1;
        const scale = art.buildScales?.get(buildingId);
        return Number.isFinite(scale) && (scale as number) > 0 ? (scale as number) : 1;
    }

    private stateOf(site: TerritorySite, input: ITerritoryMapRenderInput): TerritorySiteState {
        if (input.progress.isOwned(site.cellId)) return TERRITORY_STATION_STATE.owned;
        if (input.progress.explorationAt(site.cellId)) return TERRITORY_STATION_STATE.exploring;
        // 战力传 `MAX_SAFE_INTEGER`：地图上只区分「资源 / 前置够不够」，
        // 战力门槛留给点开详情后的开战按钮去判（与旧实现同一口径）。
        return input.progress.checkUnlock(site.cellId, Number.MAX_SAFE_INTEGER).ok
            ? TERRITORY_STATION_STATE.available
            : TERRITORY_STATION_STATE.locked;
    }
}
