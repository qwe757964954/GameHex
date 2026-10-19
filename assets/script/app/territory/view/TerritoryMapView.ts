import {
    _decorator,
    Color,
    Component,
    instantiate,
    Node,
    Prefab,
    Sprite,
    UITransform,
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
    TERRITORY_GAIN_STACK_GAP_PX,
    TERRITORY_GAIN_START_LIFT_PX,
    TERRITORY_SILVER_RES_ID,
    TERRITORY_STAMINA_RES_ID,
} from '../model/TerritoryResourceGain';
import { TerritoryResourceGainView } from './TerritoryResourceGainView';
import { TerritoryGainBurst, TERRITORY_GAIN_BURST_NODE } from './TerritoryGainBurst';
import type { TerritoryCampaignStage } from '../model/TerritoryCampaignConfig';
import type { ITerritoryMapLayout, ITerritoryMapPoint } from '../model/TerritoryMapLayout';
import type { TerritoryMapConfig, TerritorySite, TerritorySiteType } from '../model/TerritoryMapConfig';
import { TERRITORY_SITE_TYPE } from '../model/TerritoryMapConfig';
import type { TerritoryProgress } from '../model/TerritoryProgress';
import type {
    ITerritoryStationLayers,
    ITerritoryStationRender,
    TerritoryStationTarget,
} from './TerritoryStationView';
import { TerritoryStationView } from './TerritoryStationView';
import { TERRITORY_EVENTS } from './TerritoryEvents';
import { TERRITORY_HEX_REVEAL_NODE, TerritoryHexFlip } from './TerritoryHexFlip';
import {
    TERRITORY_COLORS,
    TERRITORY_STATION_STATE,
    territoryBossTint,
    territoryStationTint,
    territoryUnboundTint,
} from './TerritoryTheme';
import type { TerritorySiteState } from './TerritoryTheme';
import { TERRITORY_TEXTS, TERRITORY_UNBOUND_TYPE_NAMES } from '../application/TerritoryTexts';

const { ccclass, property } = _decorator;

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
    /** 普通关卡（`stage`）的框。 */
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
     * **建筑表按 `buildId` 查到的帧**（`buildId` → 帧）。
     *
     *  这一路优先于上面那组「按站点类型固定取图」的字段：外观由**地图 JSON 配的 `buildingId`**
     *  决定（山猫2026-10-10 口径「地图编辑配置哪个 id 就用哪个 id」）。
     *  查不到 / 没配 id 才回退到 `TERRITORY_SITE_ART` 那套。
     */
    readonly buildFrames?: ReadonlyMap<number, SpriteFrame | null>;
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
 * 领地地图的**数据渲染层**，挂在 `TerritoryPage.prefab` 的 `MapLayer`（滚动内容节点）上。
 *
 *  它只做两件事，别的一概不碰：
 *  1. 按 `ITerritoryMapLayout` 摆六边格（`GridLayer`）；
 *  2. 把「站点 + 进度」算成 `ITerritoryStationRender` 喂给池化复用的 `TerritoryStationView`。
 *
 *  **不负责**：拖拽（归 `cc.ScrollView`）、HUD 文案（归 `TerritoryHeaderView`）、
 *  弹窗（归 `TerritorySiteDetailPanel`）、数据加载与存档（归页面）。
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

    /** 初始化共享层引用与喷发粒子层（页面在 `onLoad` 里调，只需一次）。 */
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
     * 每帧推进翻格表现 + 补上「翻完才出现」的建筑；没有在播的格子时开销只是一次长度判断。
     *
     * ⚠️ 顺序不能换（判据钉的就是 `update` 第一句必须是 `hexFlip.step`）：
     *  · 先 `step` ⇒ 本帧刚好播完的那一格，`isPlaying` 已经变成 false，
     *    {@link resolveBuildingReveal} 同一帧就能补建筑（不会多等一帧）；
     *  · 再补建筑 ⇒ 建筑与抖动的起点都落在「格子已经翻过来」之后。
     */
    update(dt: number): void {
        this.hexFlip.step(dt);
        this.resolveBuildingReveal();
        this.stepGains(dt);
        this.stepBursts(dt);
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
     * ⚠️ 多条（同时给银币 + 体力）**纵向错开** `TERRITORY_GAIN_STACK_GAP_PX`，
     *  否则两条叠在一条线上互相压字；喷发则只有**一次**（多个图标轮流取两条的图）。
     *
     * @param entries 已经过 `splitTerritoryRewards` 筛选的钱包类奖励
     */
    playResourceGain(cellId: number, entries: readonly { resId: number; amount: number }[]): void {
        if (!entries.length) return;
        const hex = this.hexNodes.get(cellId);
        if (!hex) return;
        const originX = hex.position.x;
        const originY = hex.position.y + HEX_GRID_CONTENT_LIFT;
        const baseY = originY + TERRITORY_GAIN_START_LIFT_PX;
        this.playGainBurst(originX, originY, entries);
        entries.forEach((entry, index) => {
            const view = this.acquireGain();
            // ⚠️ 起点必须先写：`play()` 以「节点当前 y」为基准，池化复用时不重设会越飘越高。
            view.node.setPosition(originX, baseY + index * TERRITORY_GAIN_STACK_GAP_PX, 0);
            view.play(this.gainIcons.get(entry.resId) ?? null, entry.amount);
        });
    }

    /**
     * 播一次「喷发」：从 `(originX, originY)` 喷出 `TERRITORY_GAIN_BURST_COUNT` 个资源图标。
     *
     *  图标按 `entries` **轮流取**（同时给银币 + 体力时两种图各喷一半）；
     *  取不到图（资源还没加载好）只是那颗粒子是空的 —— 与飘字「缺图仍照常升」同一口径，
     *  **不是**把整条喷发关掉。
     */
    private playGainBurst(
        originX: number,
        originY: number,
        entries: readonly { resId: number }[],
    ): void {
        const frames = entries.map((entry) => this.gainIcons.get(entry.resId) ?? null);
        this.burstSeed = (this.burstSeed + 1) | 0;
        this.acquireBurst().play(originX, originY, this.burstSeed, frames);
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
        this.syncContentSize(input.layout);
        this.syncBackground(input);
        this.syncGrid(input);
        this.syncFlip(input);
        this.syncStations(input);
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
                this.pendingBuildingReveal.add(cellId);
            }
        }
    }

    /** 内容层尺寸 = 地图包围盒：`cc.ScrollView` 靠它算可滚范围。 */
    private syncContentSize(layout: ITerritoryMapLayout): void {
        this.node.getComponent(UITransform)!.setContentSize(layout.width, layout.height);
    }

    /**
     * 底图：换帧 + 按「地图包围盒」等比铺满。
     *
     * ## 为什么尺寸要跟地图走，而不是撑满视口
     *
     *  背景在 `MapLayer`（= ScrollView 的 content）里，滑到底时内容会整体移出视口；
     *  若背景只按视口尺寸铺，滑到边缘就会露出空白。**按包围盒铺**才能保证任意滚动位置下
     *  视口内始终是图（`layout.width/height` 已经是「格心包围盒 + 一格图的外接尺寸」，
     *  比格心范围大一整格图，刚好盖住边角那半格）。
     *
     * ## 等比 cover，不拉伸
     *
     *  底图是美术给的成品（如 `zdbg1` 1660×2916），非等比拉伸会把沙漠纹理压扁。
     *  取 `max(包围盒宽/图宽, 包围盒高/图高)` ⇒ 两边都不留白、比例不变，
     *  节点尺寸 = `图尺寸 × 该系数`（可超出包围盒，超出部分被 `Mask` 裁掉，正是想要的）。
     */
    private syncBackground(input: ITerritoryMapRenderInput): void {
        const sprite = this.mapBackground;
        const frame = input.art.background;
        if (frame && sprite.spriteFrame !== frame) sprite.spriteFrame = frame;
        if (!frame) return;
        const { width: artWidth, height: artHeight } = frame.originalSize;
        // 图尺寸未就绪（0/NaN）时不要把节点写成 0×0 —— 那会让整块底图消失且不报错。
        if (!(artWidth > 0) || !(artHeight > 0)) return;
        const { width, height } = input.layout;
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
        this.resetGains();
        this.openedRandomCells.clear();
        this.hexFlipBootstrapped = false;
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
     * 格子**地皮 + 格面框**：按 cellId 状态二选一地皮、四选一叠框。幂等，可重复调用。
     *
     *  🔴 2026-10-16 换口径（山猫）：
     *  · **地皮**只有两张 —— 已通关 ⇒ `tileCleared`（`img_land_01` 草地块），其余 ⇒
     *    `tileLocked`（`img_land_02` 泥土块）。原先的「一张 `img_land_01_gray` + 三色
     *    tint（已占领绿 / 有站点金 / 中立米）」整体删除：成品美术图自带明暗，再乘色会发脏，
     *    状态改由「哪张地皮 + 哪个框」表达。
     *  · **格面框**表达「这里有东西可打」：**已解锁且未通关**才叠，站点类型决定用哪张
     *    （首领 `frame_01` / 普通关卡 `frame_03` / 异步关卡 `frame_04` / 宝箱 `fram_02`）。
     *    需求原文后半句「**通关了，fram 要去掉，用 img_land_01**」就是这里的 `passed ⇒ 不叠框`。
     */
    private paintHexes(input: ITerritoryMapRenderInput): void {
        const revealed = new Set(input.revealedCells);
        const siteByCell = new Map(input.map.sites.map((site) => [site.cellId, site]));
        const candidateCells = new Set(input.map.randomSites?.candidateCells ?? []);
        for (const [cellId, node] of this.hexNodes) {
            node.active = revealed.has(cellId);
            if (!node.active) continue;
            const passed = this.isCellPassed(cellId, input, siteByCell, candidateCells);
            this.applyTileFrame(node, passed ? input.art.tileCleared : input.art.tileLocked);
            this.applyHexFrame(cellId, this.hexFrameOf(cellId, input, siteByCell, passed));
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

    /** 站点：按 cellId diff 复用，逐个全量赋值（同一章内每秒都会走一遍）。 */
    private syncStations(input: ITerritoryMapRenderInput): void {
        const revealed = new Set(input.revealedCells);
        const startPoint = input.layout.points.get(input.map.startCellId);
        if (startPoint) {
            const view = this.ensureStartView();
            const startCenter = this.cellCenter(startPoint);
            view.setMapPosition(startCenter.x, startCenter.y, 0);
            view.render({
                site: null,
                icon: input.art.start,
                caption: `${input.map.chapterId}-1`,
                tint: TERRITORY_COLORS.owned,
                badge: '',
                interactive: false,
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
            view.render(this.stationRenderOf(site, input));
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
        }
        for (const [cellId, view] of this.stationViews) {
            if (seen.has(cellId)) continue;
            this.stationViews.delete(cellId);
            view.dispose();
            view.node.destroy();
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
        // 站点点击：监听挂在**站点节点**上（随节点销毁自动清理），收到后在 `mapView.node`
        // 上转发给页面。起始格不建监听（`ensureStartView` 走 `clickable = false` 也不发）。
        node.on(TERRITORY_EVENTS.STATION_CLICK, this.onStationClick, this);
        this.stationViews.set(site.cellId, view);
        return view;
    }

    /** 站点点击转发：站点节点事件 → 地图容器节点事件（页面在 `mapView.node` 上收）。 */
    private readonly onStationClick = (site: TerritoryStationTarget): void => {
        this.node.emit(TERRITORY_EVENTS.STATION_CLICK, site);
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
            return {
                site,
                icon: null,
                isCondition: true,
                isLoading: isPending,
                conditionIcon: input.art.randomSilverIcon,
                conditionTextColor: isOpenable
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
            // 🔴 **已领取的宝箱格彻底清空**（山猫2026-10-12：「已经获得宝箱格子，隐藏宝箱」）：
            //   icon / caption / badge 三者全空⇒ 只剩 `tint` 的绿色地块（与随机格「已开启」同口径）。
            //
            // ⚠️ **光把 icon 置 null 达不到「彻底」** ——
            //   `TerritoryStationView.render` 里 `hasBuilding = icon !== null`，
            //   icon 为 null 会让 `captionSprite` / `captionLabel` / `badgeLabel`
            //   **三者的 active 全变 true** ⇒ 反而多出「资源据点」底条 + 「已领取」角标。
            //   所以 caption 与 badge 必须**同时**清空。
            return {
                site,
                icon: claimed ? null : this.stationIconOf(site, null, input.art),
                isLoading: pending,
                caption: pending || claimed ? '' : TERRITORY_UNBOUND_TYPE_NAMES.fixedResource,
                // 已领取（已通关）的固定资源点不再显示解锁消耗，用「已通关」绿与「可领取」区分开。
                tint: claimed ? TERRITORY_COLORS.cleared : territoryStationTint(TERRITORY_STATION_STATE.available),
                badge: pending || claimed ? '' : TERRITORY_TEXTS.fixedResourceClaimReady,
                interactive: !claimed && !pending,
            };
        }
        // 所有战斗站点（`stage` / `boss` / `asyncPvp`）都在这里：先解锁展示建筑，
        // 已解锁再点击 ⇒ `CmdStartBattleReqMsg` 开战（**不发**通关）。
        // 判定必须与 `TerritoryPresenter.selectSite` 的关卡分支**同口径**（都是站点类型），
        // 之前两边都写的是「两步式名单 [327,328] 或 isBoss」⇒ 只有关卡 1 会长这样、能点下有反应，
        // 其余关卡外观照旧却已经不可点 ⇒ 「外观说能打、点了没反应」。
        if (site.type === TERRITORY_SITE_TYPE.stage || site.type === TERRITORY_SITE_TYPE.boss || site.type === TERRITORY_SITE_TYPE.asyncPvp) {
            const boss = !!stage?.isBoss;
            const isAsyncPvp = site.type === TERRITORY_SITE_TYPE.asyncPvp;
            if (isAsyncPvp && !stage) {
                const isUnlocked = input.progress.isCellUnlocked(site.cellId);
                const isOwned = input.progress.isOwned(site.cellId);
                return {
                    site,
                    icon: this.stationIconOf(site, null, input.art),
                    caption: TERRITORY_UNBOUND_TYPE_NAMES.asyncPvp,
                    tint: isUnlocked ? territoryBossTint()
                        : isOwned ? TERRITORY_COLORS.owned : territoryStationTint(this.stateOf(site, input)),
                    badge: TERRITORY_TEXTS.pendingConfig,
                    interactive: !isUnlocked && !isOwned,
                };
            }
            // 🔴 **区域口径**（2026-10-12）：327 与 328 同 `configId=10001`、打同一关卡
            //   ⇒ 任一格通关，整片都算已通关（山猫「327/328 算一起的」）。
            //   只查查询态、不动 `owned` 存储 —— 见 `TerritoryProgress.isAreaPassed` 注释。
            const claimed = input.progress.isAreaPassed(site.cellId);
            const pending = input.pendingFixedResourceCells.includes(site.cellId);
            // 🔴 **无建筑的两步式格（327）不显示任何文案**（山猫「关卡 可 通关」去掉）：
            //   它和 328 是一片，未通关时 328 已经有建筑可点，327 再挂「关卡 / 可通关」
            //   角标既冗余又误导（点它并不代表这里有东西可拿）。
            //   ⚠️ 与 `fixedResource` 已领取分支同一条规律：`icon === null` 会让
            //   底条/文字/角标**全亮**（`hasBuilding` 反向控制），所以要显式清空。
            const isPlainTwoStep = !boss && !isAsyncPvp && !this.hasBuildingArt(site, stage, input.art);
            return {
                site,
                icon: this.stationIconOf(site, stage, input.art),
                isLoading: pending,
                caption: pending || isPlainTwoStep ? '' : isAsyncPvp
                    ? TERRITORY_UNBOUND_TYPE_NAMES.asyncPvp
                    : boss ? `首领 ${stage.stage}` : TERRITORY_UNBOUND_TYPE_NAMES.stage,
                // 已通关不再显示解锁消耗，用「已通关」绿区分开（与 fixedResource 同口径）。
                tint: claimed ? TERRITORY_COLORS.cleared
                    : isAsyncPvp && input.progress.isCellUnlocked(site.cellId)
                        ? territoryBossTint() : territoryStationTint(this.stateOf(site, input)),
                badge: pending || isPlainTwoStep ? '' : claimed
                    ? (boss || isAsyncPvp ? TERRITORY_TEXTS.bossBattleClaimed : TERRITORY_TEXTS.stagePassClaimed)
                    : (boss || isAsyncPvp ? TERRITORY_TEXTS.bossBattleReady : TERRITORY_TEXTS.stagePassClaimReady),
                interactive: !claimed && !pending,
            };
        }
        if (!stage) {
            return {
                site,
                icon: this.stationIconOf(site, null, input.art),
                caption: TERRITORY_UNBOUND_TYPE_NAMES[site.type],
                tint: input.progress.isOwned(site.cellId)
                    ? TERRITORY_COLORS.owned
                    : territoryUnboundTint(site.type),
                badge: TERRITORY_TEXTS.pendingConfig,
                interactive: true,
            };
        }
        const state = this.stateOf(site, input);
        const exploring = state === TERRITORY_STATION_STATE.exploring;
        return {
            site,
            icon: this.stationIconOf(site, stage, input.art),
            caption: exploring
                ? TERRITORY_TEXTS.exploringShort
                : stage.isBoss ? `首领 ${stage.stage}` : `关卡 ${stage.stage}`,
            tint: stage.isBoss && state !== TERRITORY_STATION_STATE.owned ? territoryBossTint() : territoryStationTint(state),
            badge: state === TERRITORY_STATION_STATE.locked ? TERRITORY_TEXTS.lockBadge : '',
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
     * 这一格**最终有没有图**—— 与 {@link stationIconOf} 同一判据，供「要不要挂文案」用。
     *
     * 为什么要单独一个方法：调用方常需要「先知道有没有图，才决定 caption/badge 填什么」
     *（例如无建筑的两步式格要彻底清空文案）。若改成调两次 `stationIconOf()` 判两次，
     * 两处判据一旦漂移就会出现「判有图、实际画null」的错位 —— 所以单一真源，这里只做转发。
     */
    private hasBuildingArt(
        site: TerritorySite,
        stage: TerritoryCampaignStage | null,
        art: ITerritoryMapArt,
    ): boolean {
        return this.stationIconOf(site, stage, art) !== null;
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
