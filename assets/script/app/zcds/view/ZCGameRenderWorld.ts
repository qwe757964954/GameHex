import { Animation, Color, EffectAsset, Graphics, instantiate, Material, Node, Prefab, Sprite, SpriteFrame, UITransform, Vec3 } from 'cc';
import { buildHexGridLayout } from '../../../core/hex/HexGridLayout';
import { findCatalogCard, getCardBuildIcon, resolveUnitDefinition, ZCUnitId } from '../model/ZCCombatCatalog';
import type { ZCAttackTrait } from '../model/ZCCombatCatalog';
import { neutralResourceRewardOf } from '../model/ZCNeutralResourceReward';
import { ZCCombatEffectView } from './ZCCombatEffectView';
import { ZCFloatTextView } from './ZCFloatTextView';
import { ZCCardRevealView } from './ZCCardRevealView';
import { ProcedureGame } from '../../procedure/ProcedureGame';
import { ZCGameLegendBannerView } from './ZCGameLegendBannerView';
import { ZCHexView } from './ZCHexView';
import { ZCGameUiEvent } from './ZCGameHudEvents';
import { EventMgr } from '../../../framework/event/EventMgr';
import type { ZCSpawnSelection } from '../model/ZCSpawnSelection';
import type { ZCMatchMap } from '../model/ZCMatchConfig';
import {
    type ZCCombatEvent,
    type ZCCardReveal,
    type ZCHexState,
    type ZCProjectileState,
    type ZCUnitState,
} from '../model/ZCGameTypes';
import { ZC_OWNER_ORDER } from '../model/ZCMapConfig';
import type { ZCFaction, ZCHexConfig, ZCOwner } from '../model/ZCMapConfig';
import type { ZCBattlePresentationEvents, ZCGameRenderFrame } from '../model/ZCGameRenderFrame';
import { ZCUnitView } from './ZCUnitView';
import { ZCUnitRenderInterpolator } from './ZCUnitRenderInterpolator';
import {
    buildTerritoryBoundaryMasks,
    mapToViewX,
    mapToViewY,
    spawnBaseConfirmPoint,
    territoryTintOwner,
    zcNeutralHintAlpha,
    ZC_NEUTRAL_HINT_RESOURCE_ID,
} from './ZCGameViewUtil';
import type { ZCDecorPlacement } from './ZCGameViewUtil';
import {
    appendHexOutlineSegments,
    appendSelectedHexOutlineSegments,
    flushOutlineSegments,
    resetOutlineSegments,
} from './ZCOutlineLayer';
import { ZCNodePool } from './ZCNodePool';
import { ZCClaimWave } from './ZCClaimWave';
import { ZCVictorySweep } from './ZCVictorySweep';
import { ZCEffectPool } from './ZCEffectPool';
import { ZCWallGeometry } from './ZCWallGeometry';
import { ZCWallRenderer } from './ZCWallRenderer';

type ZCRenderEntityKind = 'hex' | 'unit' | 'effect' | 'float' | 'cardReveal' | 'legendBanner';

interface ZCIdentityComponent {
    kind: ZCRenderEntityKind;
    sourceId: number;
}

/**
 * `unitPosition` 的复用返回值，以及每帧传给 `ZCUnitView.render` 的复用 presentation。
 *
 * 两者都是**每帧每单位**各用一次、用完即弃（视图同步解构取字段，不持有引用），
 * 所以单例复用一个 scratch 是安全的。原先两处都返回新对象 / 新字面量，
 * 46 个单位 × 60 帧 ≈ **5500 个短命对象/秒**，直接违反 AGENTS.md
 * 「禁止在 update 里创建临时数组/对象」，表现为 GC 尖刺与帧时间抖动。
 */
// 类型从 `ZCUnitView.render` 的签名反推，避免为了一个 scratch 再引一个类型导入。
// 视图侧的 `IZCUnitPresentation` 字段是 readonly（对外 immutability），
// 这里用 `-readonly` 剥掉：scratch 是**内部复用缓冲**，不交给任何调用方持有。
type ZCUnitPresentation = Parameters<ZCUnitView['render']>[0];

/** 已落位的格子：中心坐标 + 地块视图 + 节点（建格与「重置落位」两处共用）。 */
/** 描边模式：正式对局 / 选点阶段（两者底色口径不同，见 `redrawSharedOutline`）。 */
type ZCOutlineMode = 'battle' | 'spawn';

interface ZCPlacedHex {
    x: number;
    y: number;
    view: ZCHexView;
    node: Node;
}

interface ZCSceneComponent {
    node: Node;
}

interface ZCRenderWorldOptions {
    mapLayer: Node;
    /**
     * Board layer order comes from ZCGameBoard.prefab; the wall layer is inserted after OutlineLayer.
     * Resource icons use ResourceLayer because neighboring hex sprites overlap and can cover them.
     */
    board: Node;
    wallLayer: Node;
    hexPrefab: Prefab;
    unitPrefab: Prefab | null;
    unitVisualPrefabs: ReadonlyMap<ZCUnitId, Prefab>;
    /** image/buildings 下的建筑外观帧（按图片名索引）；缺失时视图回退 prefab 绑定图。 */
    buildingFrames?: ReadonlyMap<string, SpriteFrame>;
    /** image/walls 下的城墙砖帧（up/down/rightUp/rightDown）；缺失时回退 wall prefab 通用墙砖。 */
    wallFrames?: ReadonlyMap<string, SpriteFrame>;
    /**
     * 城墙砖接缝材质（`shaders/wall-tile.effect` 实例：连接端暗线用砖内颜色覆盖）。
     * 材质保持墙砖原 alpha，避免重叠不足时露出地块；缺失（null/undefined）时使用默认材质。
     */
    wallMaterial?: Material | null;
    /** 所有非己方 Spine 共享的**整体外轮廓**（放大副本）effect；缺省 ⇒ 只关闭该表现。 */
    unitOutlineCopyEffect?: EffectAsset | null;
    /**
     * 地块抬起后**原位地面**的底部发光序列帧（`image/effects/hex_ground_glow`，已按帧序）。
     * 缺省 / 空数组 ⇒ 不画光（其余表现不受影响）。
     */
    hexGroundGlowFrames?: readonly SpriteFrame[];
    /**
     * 翻格脉冲段的**水波纹序列帧**（`image/effects/hex_pulse`，已按帧序，30 帧一轮）。
     * 缺省 / 空数组 ⇒ 脉冲段只剩「原地呼吸缩放」，其余表现不受影响。
     */
    hexPulseFrames?: readonly SpriteFrame[];
    /**
     * 脉冲水波纹的**专用材质**（`shaders/hex-pulse.effect` 实例）。
     * 缺省 / `null` ⇒ 视图用默认 Sprite 材质，边缘维持「乘法染色」的偏暗观感。
     */
    hexPulseMaterial?: Material | null;
    effectPrefab: Prefab | null;
    effectVisualPrefabs: ReadonlyMap<string, Prefab>;
    floatTextPrefab: Prefab | null;
    /** 抽卡小卡牌 prefab；缺失时只少一层表现，不影响对局。 */
    cardRevealPrefab?: Prefab | null;
    /** 传说卡出场横幅 prefab；缺失时只少一层表现，不影响对局。 */
    legendBannerPrefab?: Prefab | null;
    /**
     * 全屏演出层（HUD 根节点）。
     *
     *  传说卡横幅弹在**屏幕正中**，所以不能挂 `mapLayer` —— 那是可滚动 `ScrollView` 的 content，
     * 横幅会跟着拖动跑、还会被 `view` 的 Mask 裁掉。挂在这里的子节点序末尾即「压在所有 HUD 之上」。
     */
    overlayLayer: Node;
    /**
     * 本局携带神器的图标帧（`image/artifact/<pvpArtifact[].icon>`）。
     *
     *  中立资源点「神器充能」格显示它（而不是中文字）。缺失时那一格退回文字兜底。
     *  由 `ZCGameLoader` 预加载、随 `ZCGamePreparedResources` 一路传进来。
     */
    artifactIconFrame?: SpriteFrame | null;
    /** 场景装饰条目 prefab（`sizeMode=CUSTOM` + 不裁边烘在它身上）；缺失时只少一层表现。 */
    decorPrefab?: Prefab | null;
    /**
     * 单位出生特效 prefab（`units/effects/出生特效`，老客户端 `兵种生成` 那套：
     * 16 帧 @8fps = 2.0s，原始像素 208×376 × `_lscale 0.4`）。
     *
     *  缺失时为 `null` —— 单位照常出现，只是少一层出生表现。
     *  时长不写死：播放一次所需时间从 clip 读（见 `spawnFxDuration`），改帧率不会让特效提前消失。
     */
    spawnFxPrefab?: Prefab | null;
    /**
     * 单位**阵亡特效** prefab（`units/effects/死亡特效`，13 帧 @12fps）。
     *
     *  挂在**阵亡单位自己的节点下**（与出生特效同一套 `host` 范式），所以人物倒下时特效
     *  跟着一起走、不用另算坐标。prefab 自带 `cc.Animation` + `playOnLoad`。
     *  缺失时为 `null` —— 阵亡退回"只有染灰 + alpha 190"。
     */
    deathFxPrefab?: Prefab | null;
    /**
     * 建筑**被拆掉**时的白烟雾爆炸（`units/effects/建筑死亡特效`，4 帧 @12fps）。
     *
     *  建筑 HP 归零那一步地块会直接转 `ruins`，快照里看不出「刚被打掉」——
     *  所以由模型发一条一次性的 `buildingDestructions` 通知，这里按 hexId 取格心播一次。
     *  缺失时为 `null`：建筑照常变废墟，只是少这团烟。
     */
    buildingDestroyFxPrefab?: Prefab | null;
    /**
     * 受击特效 prefab，按**攻击方职业**索引（`units/effects/受击特效/<职业>受击`）。
     *
     *  挂在 `mapLayer` 上（不是宿主节点）：受击是"贴在被打者身上的一下闪白"，
     *  而被打单位可能在同一帧被移除 —— 挂宿主会导致特效跟着消失，只闪半下。
     *  坐标每帧按 `hitFx.x / y` 写，不依赖宿主存活。
     *
     *   `get(trait)` 拿不到就是"这个职业没交资源" ⇒ **跳过这一下**，不猜默认职业。
     */
    hitFxPrefabs?: ReadonlyMap<ZCAttackTrait, Prefab>;
    wallPrefab: Prefab | null;
}

/**
 * Small render-only ECS. Domain state stays in ZCGameModel; each visual object is
 * an entity composed from identity + scene-node + one prefab view component.
 * Systems reconcile the immutable model snapshot into those components.
 */
export class ZCGameRenderWorld {

    /**
     * 阵营的稳定序号 —— 只用于共享轮廓的「内容探针」（把 `ZCFaction` 压成一个数字好比对）。
     *  顺序变了会导致探针数值错位；追加新阵营时**只许往后加**。
     */
    private static readonly FACTION_ORDER: readonly ZCFaction[] = ['neutral', 'player', 'enemy', 'enemy2', 'enemy3'];

    /**
     * 触发传说卡出场横幅的品级。`ZC_RARITY_BY_RANK` 的 `4 = 金`（`rarityNameOfTier` 叫「传说」），
     * 也是设计稿那四组横幅上写死的「传说卡牌」。
     */
    private static readonly LEGEND_BANNER_TIER = 4;

    /**
     * `unitPosition` 的复用返回值。
     *
     * 每帧每单位各用一次、用完即弃（视图同步解构取字段，不持有引用），单例复用安全；
     * 原先返回新对象，46 个单位 × 60 帧 ≈ 2700 个短命对象/秒，直接违反 AGENTS.md
     * 「禁止在 update 里创建临时数组/对象」，表现为 GC 尖刺与帧时间抖动。
     */
    private static readonly UNIT_POSITION_SCRATCH = { x: 0, y: 0 };

    /**
     * 每帧传给 `ZCUnitView.render` 的复用 presentation（与位置 scratch 同口径，见上）。
     */
    private static readonly UNIT_PRESENTATION_SCRATCH: { -readonly [K in keyof ZCUnitPresentation]: ZCUnitPresentation[K] } = {
        unit: null as never,
        definition: null as never,
        x: 0,
        y: 0,
        now: 0,
    };

    private nextEntityId = 1;
    private readonly identity = new Map<number, ZCIdentityComponent>();
    private readonly scene = new Map<number, ZCSceneComponent>();
    private readonly hexViews = new Map<number, ZCHexView>();
    /**
     * 整盘共享的领地轮廓画布（`ZCGameBoard.prefab` 的 `OutlineLayer` 上那个 `cc.Graphics`）。
     *
     * 2026-10-08：从「每格一个 `cc.Graphics`」合并到这一个。`cc.Graphics` 走引擎
     * `commitModel`，既不合批**又是断批点**，所以一格一个的真实代价约**6 DC/格**
     * （实测 200 格 = 1228 DC）。合并后上限 1 DC，且地块底图不再被切段。
     */
    private outlineGraphics: Graphics | null = null;
    /**
     * 中立资源图标专属的棋盘级图层（`ZCGameBoard.prefab` 的 `ResourceLayer`）。
     *
     * 地块整图 130×119、格距只有 92.25×90 ⇒ 相邻格整图互相重叠，后画的整格盖先画的。
     * 资源图标节点 128×128 比地块顶面 123×90 还大，压在格节点里伸进邻格的那一段就会被
     * 邻格整图沿**格边线**切掉。抬到这一层之后没有地块能盖它。
     *
     * `null`（prefab 还没这一层 / 取不到）⇒ 视图不抬层、图标留在 `BuildingLayer`：
     * 表现退回修之前的样子，但不崩。层序事实仍以 prefab 为准（见 `options.board` 的注释）。
     */
    private resourceLayer: Node | null = null;
    /**
     * 共享轮廓的「内容探针」与「上次已画快照」，两个复用数组做逐项比对。
     *
     * 存在的理由：`Graphics.clear()` + 重新 stroke 会重建整盘渲染数据，而 `renderStatic`
     * 每 0.15s 就要跑一次 —— 不比对就等于每 0.15s 白上传一次。
     * 见 `redrawSharedOutline`。
     */
    private readonly outlineProbe: number[] = [];
    private readonly outlineDrawn: number[] = [];
    private readonly unitViews = new Map<number, ZCUnitView>();
    /**
     * 一次性表现件（出生光柱 / 受击闪白 / 阵亡特效）统一由特效池管理，**不进 ECS**。
     *
     * 它们都是「本地一次性动画」，不来自模型快照、不参与网络同步，按时间轴回收就够
     * （塞进 ECS 只会让 `removeEntity` 多一条分支）。挂点差异（出生光柱挂单位节点跟随、
     * 受击/阵亡挂 mapLayer 与宿主存活解耦）与去重/回收判据都在 `ZCEffectPool` 内。
     */
    private readonly effectPool: ZCEffectPool;
    private readonly effectViews = new Map<number, ZCCombatEffectView>();
    private readonly floatTextViews = new Map<number, ZCFloatTextView>();
    private readonly cardRevealViews = new Map<number, ZCCardRevealView>();
    private readonly legendBannerViews = new Map<number, ZCGameLegendBannerView>();
    private readonly hexEntityBySource = new Map<number, number>();
    private readonly unitEntityBySource = new Map<number, number>();
    private readonly effectEntityBySource = new Map<number, number>();
    private readonly floatTextEntityBySource = new Map<number, number>();
    private readonly cardRevealEntityBySource = new Map<number, number>();
    private readonly legendBannerEntityBySource = new Map<number, number>();
    /** 棋盘上的纯表现装饰节点；不属于 ECS，销毁时显式清理。 */
    private readonly decorNodes: Node[] = [];
    private readonly pool = new ZCNodePool<Node>();
    private readonly pooledEntityKeys = new Map<number, string>();
    private readonly unitIds = new Set<number>();
    private readonly effectIds = new Set<number>();
    private readonly effectStates: Array<Readonly<ZCCombatEvent> | Readonly<ZCProjectileState>> = [];
    private readonly floatIds = new Set<number>();
    private readonly cardRevealIds = new Set<number>();
    private readonly legendBannerIds = new Set<number>();
    /**
     * 正在播「生成单位抖动」的建筑格（hexId 集合）。队列通常为空 ⇒ 每帧只多一次长度判断。
     *
     * 抖动状态本身存在 `ZCHexView` 上（起点 + 因子），这里只维护「哪些格子还要每帧推」。
     * 建筑产兵时由 `renderUnitEntity` 入队，播完（`advanceBuildingShake` 返回 false）出队。
     */
    private readonly buildingShakeHexes = new Set<number>();


    /**
     * 横幅**左侧卡面静态图**解析（与卡牌阵容同一条链）：`cardId` → 卡牌头像帧。
     *
     *  由 `ZCGame.loadLegendCardArt()` 预扫本局卡组后注入（异步）；没注入 / 该卡没配头像时
     *  `resolveLegendArt` 回退兵种 idle → 建筑图，横幅不会空着。
     */

    /**
     * 兵种 id → idle 立绘缓存，**传说横幅**的回退链用（见 `resolveLegendArt` ② / `resolveUnitFrame`）。
     *
     *   惰性填充，**不在构造期预扫** `options.unitVisualPrefabs`：视图测试会直接
     * `new ZCGameRenderWorld({...})` 并塞手写的 options 桩，构造期遍历那张表会在桩上抛
     * `prefabs is not iterable`，把飘字/单位这些**与卡牌毫不相干**的用例一起带崩。
     *
     *  小卡牌（`ZCCardRevealView`）2026-10-12 起**不再**用它 —— 卡面走角色卡牌图。
     */
    private readonly unitFrames = new Map<string, SpriteFrame>();
    private map: readonly ZCHexConfig[] = [];
    /** The spawn-confirm button is borrowed from the HUD; ZCGame owns its lifecycle. */
    private spawnConfirmButton: Node | null = null;
    /** 城墙每格六条边的几何（按 hexId 缓存，随地图固定）。 */
    private readonly wallGeometry = new ZCWallGeometry();
    /** 墙砖渲染器：节点池、材质帧槽、全盘 y 排序、接缝编码全部内聚于此（墙砖不进 ECS scene）。 */
    private readonly wallRenderer: ZCWallRenderer;
    private readonly unitInterpolator = new ZCUnitRenderInterpolator();
    /**
     * 结算扫场动画模块。纯表现层，不回写模型。
     * 步号表按「离起点那一侧隔了几行」分层、**整行共用一个步号**（我方从下往上 /
     * 其他玩家从上往下），每铺到一格就把那格的 `ZCHexView.sweepOwner` 设成胜利方；
     * 铺满前再从起点推回去、把深饱和色回正成阵营当前色（row8）。
     */
    private readonly sweep: ZCVictorySweep;
    /**
     * 开局「归属扩散」波：主城 + 周围邻格的底色从中立观感逐个换成归属色。
     * 纯表现层，不回写模型 —— 归属在开局那一刻就已经分配好了，这里只决定它**何时**显示。
     */
    private readonly claimWave: ZCClaimWave;
    /**
     * 开局「点击金矿」提示当前挂在哪一格（`null` = 没挂），见 `renderNeutralHint`。
     *
     * 记引用而不是 hexId：提示是**每帧**推的，落格那一步要走 `hexEntityBySource → hexViews`
     * 两次查表，而这一格在一整段提示里都不会变。
     */
    private hintOutlineView: ZCHexView | null = null;
    /**
     * 提示通道是否已经收工（窗口播完 / 换局复位）。
     *
     * 收工后整条通道直接返回，不再每帧扫一遍全盘快照找金矿格 —— 提示只活 4.4s，
     * 而 `renderDynamic` 是整局每帧都在跑的。
     */
    private hintOutlineSettled = false;
    /** 整体外轮廓（放大副本）材质；所有非己方 Spine 共用一份，靠顶点色区分阵营。 */
    private readonly unitOutlineCopyMaterial: Material | null;

    constructor(private readonly options: ZCRenderWorldOptions) {
        const effect = options.unitOutlineCopyEffect;
        if (effect) {
            const material = new Material();
            material.initialize({ effectAsset: effect });
            this.unitOutlineCopyMaterial = material;
        } else {
            this.unitOutlineCopyMaterial = null;
        }
        this.sweep = new ZCVictorySweep(this.hexViews, this.hexEntityBySource);
        this.claimWave = new ZCClaimWave({
            hexViews: this.hexViews,
            hexEntityBySource: this.hexEntityBySource,
        });
        this.effectPool = new ZCEffectPool({
            pool: this.pool,
            mapLayer: options.mapLayer,
            spawnFxPrefab: options.spawnFxPrefab ?? null,
            deathFxPrefab: options.deathFxPrefab ?? null,
            buildingDestroyFxPrefab: options.buildingDestroyFxPrefab ?? null,
            hitFxPrefabs: options.hitFxPrefabs ?? new Map(),
            mapToViewX,
            mapToViewY,
        });
        this.wallRenderer = new ZCWallRenderer({
            wallGeometry: this.wallGeometry,
            wallPrefab: options.wallPrefab,
            wallLayer: options.wallLayer,
            wallMaterial: options.wallMaterial ?? null,
            wallFrames: options.wallFrames ?? new Map(),
        });
    }

    /**
     * 选点阶段传 ZCMatchMap（无 model），按 select 地图的 playable 格建实体；
     * 正式战斗传入明确的地图配置，按该 map 建实体。
     */
    initialize(mapConfig: ZCMatchMap): void {
        // 兵种帧一次算好：`unitVisualPrefabs` 整局不变 ⇒ 下面 `resolveUnitFrame` 必然命中，不必再判缓存。
        // ⚠️ prefab 里没有 `Sprite.spriteFrame` 的兵种查不到（保持和以前一样返回 null）。
        for (const [unitId, prefab] of this.options.unitVisualPrefabs) {
            const frame = prefab?.data?.getComponentInChildren(Sprite)?.spriteFrame ?? null;
            if (frame) this.unitFrames.set(unitId, frame);
        }
        const map = mapConfig;
        this.wallRenderer.invalidate();
        this.map = map.hexes;
        // 地图可能换局，几何缓存跟着底图一起重置。
        this.wallGeometry.setMap(this.map);
        const rows = mapConfig.rows ?? this.map.reduce((maximum, hex) => Math.max(maximum, hex.row + 1), 0);
        const columns = mapConfig.columns ?? this.map.reduce((maximum, hex) => Math.max(maximum, hex.column + 1), 0);
        const layout = buildHexGridLayout(rows, columns);
        const firstHex = this.map[0];
        const firstPoint = firstHex ? layout.points.get(firstHex.id) : undefined;
        // 对局逻辑坐标为兼容旧快照保留取整；整个棋盘只差一个固定原点偏移。
        const originX = firstHex && firstPoint ? mapToViewX(firstHex.x) - firstPoint.x : 0;
        const originY = firstHex && firstPoint ? mapToViewY(firstHex.y) - firstPoint.y : 0;
        const minX = -layout.width / 2 + originX;
        const maxX = layout.width / 2 + originX;
        const minY = -layout.height / 2 + originY;
        const maxY = layout.height / 2 + originY;
        // 图层结构（水面 / 地块 / 装饰 / 建筑 / 状态条）声明在 `ZCGameBoard.prefab` 里，这里只按名取引用。
        // 层序 = prefab 的子节点顺序 —— 原来那套 `setSiblingIndex` 现算有个隐藏错位：
        // `decorSlotIndex = 地块数 + 1` 没算上 wallLayer 占掉的那个位置，装饰层实际被插到了
        // 最后一个地块之前（本意是「地块之上、建筑之下」）。声明在 prefab 里就没有这种算术。
        const water = this.boardLayer('MapWater');
        const hexLayer = this.boardLayer('HexLayer');
        // 共享轮廓层（整盘一个 `cc.Graphics`，见 `ZCOutlineLayer`）。
        //  prefab 上必须挂 `cc.Graphics`：不挂则整层**零报错地什么都不画**。
        this.outlineGraphics = this.boardLayer('OutlineLayer').getComponent(Graphics) ?? null;
        const outlineLayer = this.boardLayer('OutlineLayer');
        // 中立资源图标层（2026-10-14 加）。不带 `!` 断言：棋盘 prefab 万一还没补这一层，
        // 退化成「图标留在格节点里」就行 —— 表现为图标仍会被邻格切，但不该整局开不起来。
        this.resourceLayer = this.options.board.getChildByName('ResourceLayer') ?? null;
        const surface = water.getComponent(Graphics)!;
        surface.fillColor = new Color(30, 151, 215, 0);
        surface.rect(minX, minY, maxX - minX, maxY - minY);
        surface.fill();
        // 2.5D 地块有侧壁，渲染顺序须由共享布局给出；y 小的格子后画。
        const placedById = new Map<number, ZCPlacedHex>();
        for (const config of this.map) {
            if (!config.playable) continue;
            const point = layout.points.get(config.id);
            if (!point) throw new Error(`[ZCGameRenderWorld] 地图格 ${config.id} 超出 ${rows}×${columns} 布局`);
            const node = instantiate(this.options.hexPrefab);
            node.setParent(hexLayer);
            node.layer = hexLayer.layer;
            const viewX = point.x + originX;
            const viewY = point.y + originY;
            node.setPosition(new Vec3(viewX, viewY, 0));
            node.setScale(Vec3.ONE);
            node.name = `Hex_${config.id}`;
            // 视图组件与它的 @property 都在 ZCGameHex.prefab 上绑好了 —— 不再 `|| addComponent` 兜底：
            // 那个分支永远走不到，真掉组件时反而会悄悄补一个空视图（Inspector 引用全 null，表现全无）。
            const view = node.getComponent(ZCHexView)!;
            //  点击**只派发意图**（带 `hexId`），处理方由控制器订阅 —— 渲染世界不再收上层回调。
            view.initialize(() => EventMgr.instance.emit(ZCGameUiEvent.HexClick, config.id));
            // 建筑专属外观解析整局不变，新建视图时喂一次（与 unit frame resolver 同口径）。
            view.setBuildingFrameResolver((cardId, building, owner) => this.resolveBuildingFrame(cardId, building));
            // 抬升动效要临时挂到「所有层之上」= 棋盘根节点的末位（见 `ZCHexView.setRaised`）；
            // 引用整局不变，建视图时喂一次。
            view.setActivationLayer(this.options.board);
            // 中立资源图标要抬到棋盘级资源层：地块整图互相重叠，留在格节点里会被邻格
            // 沿格边线切掉（见 `ZCGameBoard.prefab` 的 `ResourceLayer` 与 `ZCHexView.setResourceIconRaised`）。
            // 引用整局不变，建视图时喂一次。
            view.setResourceIconLayer(this.resourceLayer);
            // 地面光斑的序列帧（抬升期点亮）。取不到时降级为「不画光」。
            //  地块收场已改成「原地缩到最小」（2026-10-14），不再压扁 ⇒ 不再注入
            // `shaders/hex-flip` 那份透视材质（领地地图的翻格仍自带一份）。
            view.setGroundGlowFrames(this.options.hexGroundGlowFrames ?? []);
            // 脉冲段的水波纹序列帧：中间层播，按地块类型染色（兵营蓝紫 / 金矿绿）。
            // 取不到时降级为「只呼吸」，不等于整段表现失效。
            view.setHexPulseFrames(this.options.hexPulseFrames ?? []);
            // 脉冲水波纹的专用材质（把灰环染亮，见 `shaders/hex-pulse.effect`）。
            // 取不到时降级为默认材质 ⇒ 边缘仍偏暗，但脉冲照播，不阻断对局。
            view.setHexPulseMaterial(this.options.hexPulseMaterial ?? null);
            // 废墟外观同理兜底 fx（prefab 已绑则不覆盖）。
            view.ensureRuinsFrame(this.options.buildingFrames);
            // 中立资源点「神器充能」格显示玩家携带的那件神器：整局一张，逐个视图喂同一份。
            view.setArtifactChargeFrame(this.options.artifactIconFrame ?? null);
            // 兵力资源点（`unit_cap`）按配置站N 个中立待机兵：卡 id + 数量都来自
            // `neutralResource` 表（经渲染层转成骨骼 prefab），逐个视图喂同一份。
            this.injectResourceUnits(view);
            const entityId = this.createEntity('hex', config.id, node);
            this.hexViews.set(entityId, view);
            this.hexEntityBySource.set(config.id, entityId);
            placedById.set(config.id, { x: viewX, y: viewY, view, node });
        }
        // 只重排 HexLayer 内的地块；棋盘图层顺序仍由 ZCGameBoard.prefab 声明。
        const placed = layout.paintOrder.flatMap((id) => {
            const item = placedById.get(id);
            return item ? [item] : [];
        });
        for (let index = 0; index < placed.length; index += 1) {
            placed[index].node.setSiblingIndex(index);
        }
        // 城墙砖层（`ZCGameWallLayer.prefab` 的实例，由 `ZCGame` 交进来）夹在**轮廓层之上**、
        // 装饰与建筑之下：墙线要压过地块底图与领地轮廓，但建筑要压过墙线。
        //
        //  锚点必须是 `OutlineLayer` 而不是 `HexLayer`：`OutlineLayer` 是共享轮廓的 Graphics
        // （2026-10-08 加在 HexLayer 之后）。按 `HexLayer + 1` 插会把城墙塞到轮廓**之下** ——
        // 墙砖压在轮廓线上，视觉上像"轮廓从墙里穿出来"。锚点跟着"地块之上最靠下的那层"走。
        this.options.wallLayer.setParent(this.options.board);
        this.options.wallLayer.setSiblingIndex(outlineLayer.getSiblingIndex() + 1);
        //  上面这一插会把后面的层整体后移一位：`ResourceLayer` 于是从「轮廓之后」变成
        // 「**墙线之后**」⇒ 资源图标压得过墙砖。这是有意的 —— 图标是内容标记，
        // 被墙线切一半比压住墙线难看得多；别为了「墙永远最上」把锚点改成 `ResourceLayer + 1`。
        this.attachBuildingOverlay(placed, this.boardLayer('BuildingOverlay'));
        this.attachCooldownOverlay(placed, this.boardLayer('CooldownOverlay'));
        // 提示通道是**每局一次**的：换局后重新开窗（窗口按新局的 `elapsedSeconds` 从 0 起算），
        // 上一局挂过的格（视图可能已经随地图重建销毁）也要松手。
        this.hintOutlineView = null;
        this.hintOutlineSettled = false;
    }

    /** 按名取 `ZCGameBoard.prefab` 里声明的图层 —— 结构在那里，代码不自己拼层。 */
    private boardLayer(name: string): Node {
        return this.options.board.getChildByName(name)!;
    }

    /**
     * 把建筑剪影从地块节点里**提升**到独立一层（`ZCGameBoard` 的 `BuildingOverlay`）：
     * 地块底图按地图顺序绘制、城墙整体压在地块之上，建筑再抬一层才不会让相邻格的墙线
     * 切过主城、矿场、兵营或防御塔。层本身来自 prefab，这里只搬节点。
     */
    private attachBuildingOverlay(
        placed: ReadonlyArray<ZCPlacedHex>,
        overlay: Node,
    ): void {
        for (const { x, y, view } of placed) {
            const building = view.buildingSprite?.node;
            if (!building) continue;
            const offset = building.position.clone();
            building.setParent(overlay);
            building.setPosition(x + offset.x, y + offset.y, offset.z);
        }
    }

    /** 同理把生命条与冷却圈抬到最上层（`CooldownOverlay`），高于城墙及建筑本体。 */
    private attachCooldownOverlay(
        placed: ReadonlyArray<ZCPlacedHex>,
        overlay: Node,
    ): void {
        for (const { x, y, view } of placed) {
            const health = view.healthBar?.node;
            if (!health) continue;
            const offset = health.position.clone();
            health.setParent(overlay);
            health.setPosition(x + offset.x, y + offset.y, offset.z);
        }
        for (const { x, y, view } of placed) {
            const cooldown = view.cooldownBar?.node;
            if (!cooldown) continue;
            const offset = cooldown.position.clone();
            cooldown.setParent(overlay);
            cooldown.setPosition(x + offset.x, y + offset.y, offset.z);
        }
    }

    /**
     * 将自由装饰铺到 prefab 的常驻 `DecorLayer`。调用方提供帧；重复调用会先清空旧节点。
     */
    installDecor(
        placements: readonly ZCDecorPlacement[],
        frames: ReadonlyMap<string, SpriteFrame>,
    ): void {
        this.clearDecor();
        if (!placements.length) return;
        const decorPrefab = this.options.decorPrefab;
        if (!decorPrefab) return;
        const layer = this.boardLayer('DecorLayer');
        for (const item of placements) {
            const frame = frames.get(item.art);
            if (!frame) continue;
            const node = instantiate(decorPrefab);
            node.name = `Decor_${item.id}`;
            // prefab 里的 layer 是 UI_2D，这里跟承接层对齐（两者本应一致，防手改走偏）。
            node.layer = layer.layer;
            node.setParent(layer);
            node.setPosition(item.x, item.y, 0);
            node.setRotationFromEuler(0, 0, item.rotation ?? 0);
            node.setScale(item.flipX ? -1 : 1, item.flipY ? -1 : 1, 1);
            // 尺寸由 UITransform 定死。与地图编辑器 `<image preserveAspectRatio="xMidYMid meet">`
            // 同口径：在 `item.width × item.height` 框内**等比缩放进框**，而不是 CUSTOM 拉伸 ——
            // 宽高比与图原始比例不一致时（旧数据、非等比手动缩放），拉伸会让游戏里变形、
            // 编辑器预览却正常。宽高等于原图时 fit = 1，正好 1:1。配它的 `sizeMode = CUSTOM`
            // 也烘在 prefab 里：默认的 TRIMMED 会按 SpriteFrame 自己重算尺寸，把这个 fit 吃掉。
            node.getComponent(Sprite)!.spriteFrame = frame;
            const transform = node.getComponent(UITransform)!;
            const original = frame.originalSize;
            if (original && original.width > 0 && original.height > 0) {
                const fit = Math.min(item.width / original.width, item.height / original.height);
                transform.setContentSize(original.width * fit, original.height * fit);
            } else {
                transform.setContentSize(item.width, item.height);
            }
            this.decorNodes.push(node);
        }
    }

    /** 摘掉棋盘上的装饰。重开局 / 退出对局 / 换地图都必须调，否则上一张图的装饰留在棋盘上。 */
    clearDecor(): void {
        for (const node of this.decorNodes) {
            if (node.isValid) node.destroy();
        }
        this.decorNodes.length = 0;
    }

    render(frame: ZCGameRenderFrame, events: ZCBattlePresentationEvents): void {
        this.renderStatic(frame);
        this.renderDynamic(frame, events);
    }

    /** 自选出生点阶段的棋盘表现；该阶段尚未创建 ZCGameModel。 */
    renderSpawnSelection(selection: ZCSpawnSelection, hintsVisible: boolean): void {
        const snapshot = selection.snapshot;
        const selectedByHex = new Map<number, { owner: ZCOwner; confirmed: boolean }>();
        for (const owner of ZC_OWNER_ORDER) {
            const state = snapshot.selections[owner];
            if (!state || state.selectedHexId === null) continue;
            selectedByHex.set(state.selectedHexId, { owner, confirmed: state.confirmedHexId !== null });
        }
        const playerSelection = snapshot.selections.player.selectedHexId;
        const unlockedResources = new Set<number>(playerSelection === null
            ? []
            : selection.map.hexes[playerSelection]?.neighbors.filter((id) => selection.isResourcePoint(id)) ?? []);
        const regionText = new Map<number, string>();
        // 半区归属 = 该席位的出生点可选范围（自选地图的「分区」）。地图自己画了分区就用地图的，
        // 没画（两张自选图当前全是中立格）按布局推导 —— 口径统一在 `ZCSpawnSelection` 里，
        // 这里只管着色，别再自己拼一份。
        const sectionOwnerByHex = new Map<number, ZCFaction>();
        for (const config of selection.map.hexes) {
            sectionOwnerByHex.set(config.id, (selection.regionOwnerOf(config.id) ?? 'neutral') as ZCFaction);
        }
        // 已选/已确认主城的邻格：归属到自选方。这一份**只管领地底色与轮廓**（`ownerForHex`），
        // 不再是「基地邻格」的表现来源 —— 需求 1 要的那 6 格深蓝高亮是下面单独一位
        // （`homeHighlight`），而且只给我方，不给 AI 的基地（三方同为深蓝会分不清是谁的圈）。
        const homeNeighborOwner = new Map<number, ZCOwner>();
        for (const owner of ZC_OWNER_ORDER) {
            const state = snapshot.selections[owner];
            if (!state || state.selectedHexId === null) continue;
            for (const neighborId of selection.map.hexes[state.selectedHexId]?.neighbors ?? []) {
                homeNeighborOwner.set(neighborId, owner);
            }
        }
        //  选点侧也有自己的逐格归属：两份表留给具名实现 `spawnOwnerForHex` 用（不再内联闭包）。
        this.spawnHomeNeighborOwner = homeNeighborOwner;
        this.spawnSectionOwnerByHex = sectionOwnerByHex;
        const boundaryMasks = buildTerritoryBoundaryMasks(selection.map.hexes, this.spawnOwnerForHex);
        const selectedHexId = playerSelection !== null
            && selection.invalidReason('player', playerSelection) === null ? playerSelection : null;
        // 我方基地的 6 格高亮：**只在「我方还在选点」期间**给。`isPlacing` 一转 false（玩家点了
        // 【确认位置】）高亮就没了、按钮也收起来 —— 需求 4「基地落定，高亮消失」。注意整体阶段
        // 此时可能还没结束（要等 AI 确认），所以判据用 `isPlacing` 而不是 `snapshot.finished`。
        // 邻格取法统一在 `ZCSpawnSelection.baseNeighborIds` 里（自己别再拼一份 neighbors）。
        const playerBaseId = selection.isPlacing('player') ? playerSelection : null;
        const playerBaseNeighbors = new Set<number>(
            playerBaseId === null ? [] : selection.baseNeighborIds('player'),
        );
        this.redrawSharedOutline(selection.map.hexes, boundaryMasks, 'spawn', selectedHexId);
        if (hintsVisible) {
            const depthName = { front: '前区', mid: '中区', back: '后区' } as const;
            for (const region of selection.map.regions ?? []) {
                if (region.section !== 1) continue;
                const anchor = region.cells.find((id) => !selection.isResourcePoint(id)) ?? region.cells[0];
                if (anchor !== undefined) regionText.set(anchor, `${depthName[region.depth]}·${region.text ?? ''}`);
            }
        }
        for (const config of selection.map.hexes) {
            const entityId = this.hexEntityBySource.get(config.id);
            if (!entityId) continue;
            const homeOwner = homeNeighborOwner.get(config.id);
            const sectionOwner = homeOwner ?? sectionOwnerByHex.get(config.id) ?? 'neutral';
            const chosen = selectedByHex.get(config.id);
            const blocked = sectionOwner === 'player'
                && !selection.isResourcePoint(config.id)
                && selection.invalidReason('player', config.id) !== null;
            this.hexViews.get(entityId)?.renderSpawnSelection({
                sectionOwner,
                selectedBy: chosen?.owner ?? null,
                confirmed: chosen?.confirmed ?? false,
                blocked,
                resourcePoint: selection.isResourcePoint(config.id),
                resourceId: selection.resourceIdAt(config.id),
                unlocksResource: unlockedResources.has(config.id),
                regionText: regionText.get(config.id),
                boundaryMask: boundaryMasks.get(config.id) ?? 0,
                homeHighlight: playerBaseNeighbors.has(config.id),
            });
        }
        this.renderSpawnConfirmButton(playerBaseId);
    }

    /**
     * 选点阶段的【确认位置】按钮：定位到基地正下方 `SPAWN_BASE_CONFIRM_ROW_OFFSET` 格，随基地走。
     *
     *  坐标口径与地块完全一致（`mapToViewX/Y` 的棋盘层局部坐标）—— 按钮已被 `ZCGame` 改挂到
     *  `mapLayer` 下，和基地建筑同层同缩放，所以「2 格间距」在世界坐标里恒成立，不随地图缩放漂移。
     *
     *  只有**我方正在选点**时才显示：玩家一确认（`isPlacing('player')` 转 false，尽管整体阶段
     *  要等我方与 AI 都确认才结束）按钮就收起来 —— 需求 4「点击【确认位置】后退出选基地模式」。
     *  显隐之外的一切（绿勾染色、点击回调）仍归 `ZCSpawnSelectionView`，这里**不**重复管，
     *  避免同一个按钮出现两套判据。
     */
    private renderSpawnConfirmButton(baseHexId: number | null): void {
        const node = this.spawnConfirmButton;
        if (!node || !node.isValid) return;
        const hex = baseHexId === null ? undefined : this.map[baseHexId];
        if (!hex) {
            if (node.active) node.active = false;
            return;
        }
        const point = spawnBaseConfirmPoint({ x: mapToViewX(hex.x), y: mapToViewY(hex.y) });
        if (node.active !== true) node.active = true;
        node.setPosition(point.x, point.y, 0);
    }

    renderStatic(frame: ZCGameRenderFrame): void {
        this.renderHexSystem(frame);
        this.wallRenderer.render(frame);
    }

    /** 逻辑仍为 20 Hz，连续坐标在相邻逻辑帧间插值。 */
    renderDynamic(frame: ZCGameRenderFrame, events: ZCBattlePresentationEvents): void {
        this.wallRenderer.render(frame);
        this.renderUnitSystem(frame);
        this.renderEffectSystem(frame);
        this.renderFloatTexts(frame);
        this.renderHitFxs(frame);
        this.renderCardReveals(frame);
        this.renderLegendBanners(frame);
        this.renderHexActivations(frame);
        this.renderBuildingShakes(frame, events);
        this.renderBuildingDestructions(frame, events);
        this.renderTerritoryClaimWave(frame);
        this.renderNeutralHint(frame);
    }

    /**
     * 开局「点击金矿」提示：给金矿那一格套一圈整体描边闪烁（需求 2026-10-15 row10）。
     *
     * 窗口锚在**对局时间**上（`visualTime`，进对局那一刻为 0）⇒ 需求原文的「进入游戏初始时」
     * 就是「`elapsedSeconds ∈ [0, ZC_NEUTRAL_HINT_SECONDS)`」，不需要另开一个状态机，
     * 换局 / 重连换 `elapsedSeconds` 天然重新计时。
     *
     * 三个收手条件（任一满足就停）：
     *  - 窗口播完（`zcNeutralHintAlpha` 归 0）；
     *  - 金矿被领取 / 被开发 —— 模型里 `neutralResourceId` 会被清空，目标自然消失；
     *  - 这一盘根本没有金矿格（`find` 不到）。
     *
     * ⚠️ 必须挂在 `renderDynamic` 上：闪烁要 60fps，走 `renderStatic` 的 0.15s 节流会变成频闪。
     */
    private renderNeutralHint(frame: ZCGameRenderFrame): void {
        if (this.hintOutlineSettled) return;
        const alpha = zcNeutralHintAlpha(this.visualTime(frame));
        if (alpha <= 0) {
            this.setHintOutlineTarget(null);
            this.hintOutlineSettled = true;
            return;
        }
        const hex = frame.snapshot.hexes.find(
            (state) => state.neutralResourceId === ZC_NEUTRAL_HINT_RESOURCE_ID);
        this.setHintOutlineTarget(hex ? this.hexViewOf(hex.id) : null);
        this.hintOutlineView?.renderHintOutline(alpha);
    }

    /** 换提示目标（先收掉旧的）—— 目标没变时零开销，每帧调用安全。 */
    private setHintOutlineTarget(next: ZCHexView | null): void {
        if (this.hintOutlineView === next) return;
        this.hintOutlineView?.renderHintOutline(0);
        this.hintOutlineView = next;
    }

    /** hexId → 地块视图（两跳查表 + 缺表兜底，散在几处就迟早有一处漏判 undefined）。 */
    private hexViewOf(hexId: number): ZCHexView | null {
        const entityId = this.hexEntityBySource.get(hexId);
        if (entityId === undefined) return null;
        return this.hexViews.get(entityId) ?? null;
    }

    /**
     * 给某一格的建筑登记一次抖动（见 `ZCHexView.playBuildingShake`）。
     *
     * 三个来源共用它：
     *  · **产兵**（需求 row5）：兵营 `spawnClocks` 走到 `recruitIntervalSeconds` 就产一批兵，
     *    那批新兵首次出现在快照的帧正是「倒计时结束」这一拍（调用点在 `renderUnitEntity` 的
     *    `isBirth` 分支）。一波多只新兵同帧出生 ⇒ 每只都登记一次、起点相同 ⇒ 建筑只抖一下。
     *  · **产金**（需求 row12 / row13）：主城 / 金矿的金币倒计时结束时模型推来一条通知，
     *    由 `renderBuildingShakes` 取走后再调这里。
     *
     * 取不到视图（换图 / 换局）就当没发生 —— 抖动是纯表现，不值得为它兜错。
     */
    private triggerBuildingShake(hexId: number, now: number): void {
        const view = this.hexViewOf(hexId);
        if (!view) return;
        view.playBuildingShake(now);
        this.buildingShakeHexes.add(hexId);
    }

    /**
     * 每帧推进所有正在抖的建筑（挂 `renderDynamic`，与单位 / 卡牌同拍），
     * 并先**取走**本帧模型攒下的产金抖动通知。
     *
     * 为什么单开一条：`renderHexSystem` 挂在 `renderStatic` 上、由 `ZCGame.update` 按 0.15s 节流，
     * 而抖动只有 2 × `SPAWN_SHAKE_PHASE_SECONDS` = 0.24s —— 6.7fps 根本播不出「先 Y 后 X」。
     * 通知通道平时是空的、抖动集合平时也是空的，两处都只多一次 `length` / `size` 判断。
     *
     * 抖动通知由 `ZCGame` 在本帧显式取走后传入：抖动不幂等，攒着不取
     * 或者取两遍就会一直重头抖。起点用这口与单位 / 卡牌共用的时钟（通知本身不带时间）。
     */
    private renderBuildingShakes(frame: ZCGameRenderFrame, events: ZCBattlePresentationEvents): void {
        const shakes = events.buildingShakes;
        if (!shakes.length && !this.buildingShakeHexes.size) return;
        const now = this.visualTime(frame);
        for (const event of shakes) this.triggerBuildingShake(event.hexId, now);
        for (const hexId of this.buildingShakeHexes) {
            const view = this.hexViewOf(hexId);
            // 视图没了（换图 / 换局）或抖动播完 ⇒ 出队。
            if (!view || !view.advanceBuildingShake(now)) this.buildingShakeHexes.delete(hexId);
        }
    }

    /**
     * 每帧推进建筑摧毁特效，并**取走**本帧模型攒下的「建筑被打掉」通知。
     *
     * 挂着 `renderDynamic`（与单位 / 卡牌同拍）：烟雾只活 `clip.duration`（4 帧 @12fps ≈ 0.33s），
     * 走 `renderStatic` 的 0.15s 节流会漏掉帧、看着像掉帧爆炸。
     *
     * ⚠️ 回收必须写在「有无通知」的判空**之前** —— 不然没有新拆楼的那些帧就永远不回收，
     * 播完的烟雾节点会一直挂在 mapLayer 上。
     */
    private renderBuildingDestructions(frame: ZCGameRenderFrame, events: ZCBattlePresentationEvents): void {
        const now = this.visualTime(frame);
        this.effectPool.recycleBuildingDestroyFx(now);
        const destructions = events.buildingDestructions;
        if (!destructions.length) return;
        for (const event of destructions) {
            const hex = this.map.find((item) => item.id === event.hexId);
            if (!hex) continue;
            this.effectPool.playBuildingDestroyFx(
                mapToViewX(hex.x), mapToViewY(hex.y), event.hexId, now);
        }
    }

    /**
     * 每帧推进「开局归属扩散」波（挂 `renderDynamic`，与单位 / 卡牌同拍）。
     *
     * 为什么单开一条：`renderHexSystem` 挂在 `renderStatic` 上、由 `ZCGame.update` 按 0.15s 节流，
     * 而每格自己的换色过渡只有 `ZC_CLAIM_WAVE_FADE_SECONDS = 0.1s` —— 6.7fps 会把它压成
     * 一帧硬切，看不到"过渡"。这里逐格写色（`ZCClaimWave` 内部会跳过没变化的格，所以
     * 每格整段只写十来次），平时不在播就只多一次 `active` 判断。
     */
    private renderTerritoryClaimWave(frame: ZCGameRenderFrame): void {
        if (!this.claimWave.active) return;
        this.claimWave.advance(this.visualTime(frame));
    }

    /**
     * 抽卡小卡牌：与飘字同一套「按 id 对齐、新增即建、过期即回收」的池化写法。
     *
     *   必须**每帧**刷（同 renderFloatTexts）：卡牌只活 2 秒多，跟棋盘重建的
     * 0.15s 节流会一卡一卡。
     */
    renderCardReveals(frame: ZCGameRenderFrame): void {
        const activeIds = this.cardRevealIds;
        activeIds.clear();
        for (const reveal of frame.cardReveals) activeIds.add(reveal.id);
        for (const [sourceId, entityId] of this.cardRevealEntityBySource) {
            if (activeIds.has(sourceId)) continue;
            this.removeEntity(entityId);
            this.cardRevealEntityBySource.delete(sourceId);
        }
        for (const reveal of frame.cardReveals) {
            let entityId = this.cardRevealEntityBySource.get(reveal.id);
            if (!entityId) {
                if (!this.options.cardRevealPrefab) return;
                const node = this.pool.acquire('cardReveal', () => instantiate(this.options.cardRevealPrefab));
                node.setParent(this.options.mapLayer);
                node.setSiblingIndex(this.options.mapLayer.children.length - 1);
                node.layer = this.options.mapLayer.layer;
                // 位置由 ZCCardRevealView.render 每帧写（根节点承担世界定位），
                // 这里只清掉实例化可能带进来的坐标 / 缩放残留。
                node.setPosition(Vec3.ZERO);
                node.setScale(Vec3.ONE);
                node.name = `CardReveal_${reveal.id}`;
                // 同上：视图组件在 ZCGameCardReveal.prefab 上。
                const view = node.getComponent(ZCCardRevealView)!;
                // 卡面图 / 建筑帧由视图自己按 id 向控制器取（`ProcedureGame.current`）⇒ 这里不再注入闭包。
                entityId = this.createEntity('cardReveal', reveal.id, node);
                this.pooledEntityKeys.set(entityId, 'cardReveal');
                this.cardRevealViews.set(entityId, view);
                this.cardRevealEntityBySource.set(reveal.id, entityId);
            }
            this.cardRevealViews.get(entityId)?.render(reveal, this.visualTime(frame));
        }
    }

    /**
     * 传说卡出场横幅：与小卡牌**同源**（都读渲染帧的卡牌事件），只筛出金卡（tier 4）。
     *
     *  为什么不再建一条模型层队列：横幅要展示的东西（owner / 卡名 / 兵种 / 时长）与小卡牌逐字相同，
     * 多一条队列就多一处会跟 `pushCardReveal` 脱节的状态。这里按 id 对齐的池化写法与
     * `renderCardReveals` 完全一致，只是换了挂载层与对象池 key。
     *
     *   挂**全屏层**而不是 `mapLayer`：横幅的落位按本局人数在屏幕上等分（横向跟着人数变），
     *  跟着棋盘滚动 / 被 view 的 Mask 裁掉都不对。
     */
    renderLegendBanners(frame: ZCGameRenderFrame): void {
        const activeIds = this.legendBannerIds;
        activeIds.clear();
        for (const reveal of frame.cardReveals) {
            if (reveal.tier === ZCGameRenderWorld.LEGEND_BANNER_TIER) activeIds.add(reveal.id);
        }
        // 落位上下文每帧重算：人数取模型的在场席位，宽度取全屏层（HUD 根）自己的宽度 ——
        // 换手机分辨率 / 折叠屏展开时层宽会变，横幅格子必须跟着重排。
        const placement = this.legendBannerPlacement(frame);
        for (const [sourceId, entityId] of this.legendBannerEntityBySource) {
            if (activeIds.has(sourceId)) continue;
            this.removeEntity(entityId);
            this.legendBannerEntityBySource.delete(sourceId);
        }
        for (const reveal of frame.cardReveals) {
            if (reveal.tier !== ZCGameRenderWorld.LEGEND_BANNER_TIER) continue;
            let entityId = this.legendBannerEntityBySource.get(reveal.id);
            if (!entityId) {
                const prefab = this.options.legendBannerPrefab;
                if (!prefab) return;
                const node = this.pool.acquire('legendBanner', () => instantiate(prefab));
                const layer = this.options.overlayLayer;
                node.setParent(layer);
                node.setSiblingIndex(layer.children.length - 1);
                node.layer = layer.layer;
                // 位置由 ZCGameLegendBannerView.render 每帧写（滑入曲线），这里只清掉实例化残留。
                node.setPosition(Vec3.ZERO);
                node.setScale(Vec3.ONE);
                node.name = `LegendBanner_${reveal.id}`;
                // 同上：视图组件在 ZCGameLegendBanner.prefab 上。
                const view = node.getComponent(ZCGameLegendBannerView)!;
                view.setArtResolver((item) => this.resolveLegendArt(item));
                //  头像帧在控制器上（`ProcedureGame.current`）⇒ 闭包每帧现取，晚到也能吃上。
                view.setPortraitResolver((owner) => ProcedureGame.current?.resolveLegendPortrait(owner) ?? null);
                entityId = this.createEntity('legendBanner', reveal.id, node);
                this.pooledEntityKeys.set(entityId, 'legendBanner');
                this.legendBannerViews.set(entityId, view);
                this.legendBannerEntityBySource.set(reveal.id, entityId);
            }
            const view = this.legendBannerViews.get(entityId);
            view?.setLayout(placement);
            view?.render(reveal, this.visualTime(frame));
        }
    }

    /**
     * 横幅竖排均分的落位上下文：本局人数 + 全屏层**宽高**。
     *
     *  竖排的每格高 = 层**高** / 人数（见 `ZCGameLegendBannerView.bannerHeightOf`），
     *  所以层高是落位与高度的唯一真源；层宽只用于**滑入动画的起止位置**
     *  （弹出方式保持原来的横向滑入）。都取 `overlayLayer` 的 `UITransform`（HUD 根就是全屏），
     *  拿不到就返回 0 —— 视图会回退到设计稿 720×1280（工程 `designResolution`）。
     */
    private legendBannerPlacement(frame: ZCGameRenderFrame): {
        readonly playerCount: number;
        readonly viewWidth: number;
        readonly viewHeight: number;
    } {
        const transform = this.options.overlayLayer?.getComponent(UITransform);
        return {
            playerCount: frame.owners.length || 2,
            viewWidth: transform?.width ?? 0,
            viewHeight: transform?.height ?? 0,
        };
    }

    /**
     * 注入 / 摘除选点阶段的【确认位置】按钮节点。
     *
     *  进 `startSpawnSelection`、出 `finishSpawnSelection` / `shutdown` —— 都是 `ZCGame` 调
     *  （借出时注入、归还时摘除）。摘除时必须显式置 `null`：`Node.destroy()` 当帧 `isValid`
     *  仍为 true，只靠下面的 `isValid` 守卫会多写一帧坐标到一个正在销毁的节点上。
     */
    setSpawnConfirmButton(node: Node | null): void {
        this.spawnConfirmButton = node;
    }

    /**
     * 注入**角色卡面图**解析（cardId → 卡牌头像帧，与卡牌阵容同链）。
     *
     *  与头像同理：卡面图要过 icon 表 + `resources.load`，`ZCGame` 预扫完才注入；晚于演出弹出
     *  也没关系 —— 这里连同**已经弹出来的横幅与小卡牌**一起重设解析器（视图内会作废内容键强制重绘），
     *  所以「先弹后到」不会留下空卡面 / 建筑图卡面。
     */
    /**
     * 卡面帧到齐后**补刷已经弹出来**的横幅与小卡牌（帧表本身在控制器上，视图按 id 现取）。
     * 卡视图要作废内容键，否则它缓存着"当时没有卡面图"的那一帧、会一直停在建筑图上。
     */
    refreshLegendCardArt(): void {
        for (const view of this.legendBannerViews.values()) {
            if (view.isValid) view.setArtResolver((item) => this.resolveLegendArt(item));
        }
        for (const view of this.cardRevealViews.values()) {
            if (view.isValid) view.invalidateArt();
        }
    }

    /** 横幅立绘（横幅**左边那一格**）：与卡牌阵容同一条链的静态卡面图优先，取不到才回退兵种 / 建筑图。 */
    private resolveLegendArt(reveal: Readonly<ZCCardReveal>): SpriteFrame | null {
        // ① 卡牌阵容那边的静态图：卡表 `headIcon` → `icons/cardHead/**`（阵容页「非spine」时
        //    铺在 Hero 位的就是同一张）。横幅是**这张卡**的出场，左格该长成阵容里那张卡的样子，
        //    而不是它产出兵种的 idle 图。由 `ZCGame` 预加载本局卡组后注入。
        const cardArt = ProcedureGame.current?.resolveCardArt(reveal.cardId) ?? null;
        if (cardArt) return cardArt;
        // ② 老链：兵种 idle 立绘。
        if (reveal.unitId) {
            const frame = this.resolveUnitFrame(reveal.unitId);
            if (frame) return frame;
        }
        // ③ 建筑图（金矿 / 主城这类没有头像也没有产出兵种的卡）。
        return this.resolveBuildingFrame(reveal.cardId, reveal.building);
    }

    /**
     * 兵种 id → 该兵种的 idle 立绘（带缓存），小卡牌卡面用。
     *
     *  单位视觉 Prefab 的形状是约定死的：1 个节点 + 1 个 `cc.Sprite`，`spriteFrame` 静态绑到
     * `units/<兵种>/atlas/<兵种>-idle_0`（实测 28 个兵种全部如此），所以直接从模板节点读组件即可，
     * 不必另建「兵种 → 图路径」表 —— 多一张表就多一处会跟美术改路径脱节的地方。
     *
     *  取不到就当这个兵种没有立绘，卡面回退建筑图；连 `unitVisualPrefabs` 不是 Map
     *  （视图测试的 options 桩就是普通对象）也算取不到，绝不抛错。
     */
    /**
     * 本帧快照与时间（描边染色用）。与 `UNIT_PRESENTATION_SCRATCH` 同口径：复用字段，
     * 不在调用点新建闭包／对象。
     */
    private territoryFrame: ZCGameRenderFrame | null = null;
    private territoryOutlineNow = 0;

    /** 逐格归属的稳定引用（整局一份，每帧直接传）。 */
    private readonly ownerForHex = this.territoryOwnerForHex.bind(this);

    /**
     * 逐格归属：领地**底图与描边共用同一处实现**（分开算就会出现「底图一个色、轮廓另一个色」）。
     *
     *  ① 扫场期间用胜利方覆盖真实归属（纯表现层，不回写模型）；
     *  ② 中立且可开发的格子按可开发方染色；
     *  ③ 新点亮的邻格在「按住窗」内仍未点亮 ⇒ 描边跟着一起等（需求 2026-10-15 row9：
     *     描边不许比地块图标先变色）。按住状态只问地块视图，`resolveDevelopableHold` 是唯一真源。
     */
    private territoryOwnerForHex(id: number): ZCFaction {
        const sweepOwner = this.sweep.ownerForHex(id);
        if (sweepOwner) return sweepOwner;
        const hex = this.territoryFrame?.hexesById.get(id);
        const owner = hex?.state.owner ?? 'neutral';
        if (hex?.canDevelop !== true) return territoryTintOwner(owner, false);
        const entityId = this.hexEntityBySource.get(id);
        const view = entityId === undefined ? undefined : this.hexViews.get(entityId);
        if (view?.resolveDevelopableHold(true, this.territoryOutlineNow)) return territoryTintOwner(owner, false);
        return territoryTintOwner(owner, true);
    }

    /** 选点阶段的逐格归属用表（由 `renderSpawnSelection` 每次刷新时写入）。 */
    private spawnHomeNeighborOwner: ReadonlyMap<number, ZCOwner> = new Map();
    private spawnSectionOwnerByHex: ReadonlyMap<number, ZCFaction> = new Map();

    /** 选点侧的逐格归属（稳定引用，整局一份）。 */
    private readonly spawnOwnerForHex = this.resolveSpawnOwnerForHex.bind(this);

    /** 选点：已选/已确认主城的邻格 → 该方，其次区域归属，最后中立。 */
    private resolveSpawnOwnerForHex(id: number): ZCFaction {
        return this.spawnHomeNeighborOwner.get(id)
            ?? this.spawnSectionOwnerByHex.get(id)
            ?? 'neutral';
    }

    /** 兵种 id → idle 帧（`initialize` 时已按 `unitVisualPrefabs` 预填）。 */
    private resolveUnitFrame(unitId: string): SpriteFrame | null {
        return this.unitFrames.get(unitId) ?? null;
    }

    /**
     * 建筑外观帧：① 卡牌配了 buildIcon → 取专属图；② 兵营 / 主城回退已加载的通用图；③ 其余返回 null。
     *
     * 取不到（buildingFrames 未加载 / 视图测试的 options 桩是普通对象）绝不抛错，
     * 与 resolveUnitFrame 同一防护。
     */
    /** 建筑帧查表搬去了控制器（`ZCGame.resolveBuildingFrame`）；这里只按同一口径转发。 */
    private resolveBuildingFrame(cardId: string | null, building: string): SpriteFrame | null {
        return ProcedureGame.current?.resolveBuildingFrame(cardId, building) ?? null;
    }

    /** 飘字使用连续表现时间，过期节点进入有界复用池。 */
    renderFloatTexts(frame: ZCGameRenderFrame): void {
        const activeIds = this.floatIds;
        activeIds.clear();
        for (const text of frame.floatTexts) activeIds.add(text.id);
        for (const [sourceId, entityId] of this.floatTextEntityBySource) {
            if (activeIds.has(sourceId)) continue;
            this.removeEntity(entityId);
            this.floatTextEntityBySource.delete(sourceId);
        }
        for (const text of frame.floatTexts) {
            let entityId = this.floatTextEntityBySource.get(text.id);
            if (!entityId) {
                if (!this.options.floatTextPrefab) return;
                const node = this.pool.acquire('float', () => instantiate(this.options.floatTextPrefab));
                node.setParent(this.options.mapLayer);
                node.setSiblingIndex(this.options.mapLayer.children.length - 1);
                node.layer = this.options.mapLayer.layer;
                // 位置由 ZCFloatTextView.render 每帧写（根节点承担世界定位），
                // 这里只清掉实例化可能带进来的坐标 / 缩放残留。
                node.setPosition(Vec3.ZERO);
                node.setScale(Vec3.ONE);
                node.name = `FloatText_${text.id}`;
                // 同上：视图组件在 ZCGameFloatText.prefab 上。
                const view = node.getComponent(ZCFloatTextView)!;
                entityId = this.createEntity('float', text.id, node);
                this.pooledEntityKeys.set(entityId, 'float');
                this.floatTextViews.set(entityId, view);
                this.floatTextEntityBySource.set(text.id, entityId);
            }
            this.floatTextViews.get(entityId)?.render(text, this.visualTime(frame));
        }
    }

    /**
     * 受击特效：与飘字同一套「按 id 对齐、新增即建、过期即回收」的池化写法。
     *
     *  必须**每帧**刷（不能跟棋盘重建的 0.15s 节流）：受击总共只有 0.15s，
     *  一卡一卡会看到「闪一下、消失、再闪一下」。
     *
     * 播放 / 回收 / 挂点（挂 mapLayer、不挂被打单位）/ 棋盘坐标换算都在 `ZCEffectPool` 内。
     */
    renderHitFxs(frame: ZCGameRenderFrame): void {
        const now = this.visualTime(frame);
        this.effectPool.recycleHitFx(now);
        // 🔴 走 `syncHitFx` 而不是逐个 `playHitFx`：`frame.hitFxs` 是模型层**整条存活队列**
        // （0.15s 内每帧都在），逐帧重新 `play()` 会把动画 seek 回第 0 帧
        // ⇒ 受击特效「停顿在角色身上、播不动」（2026-10-16 山猫反馈）。
        this.effectPool.syncHitFx(frame.hitFxs, now);
    }

    destroy(): void {
        this.sweep.clear();
        this.claimWave.clear();
        // 探针缓冲跨局残留会让下一局首帧沿用上一局的轮廓（内容恰好相同时直接 return）。
        this.invalidateSharedOutline();
        // 装饰不是 ECS 实体，下面的遍历收不到，必须显式摘。
        // 棋盘图层容器（`options.board`）与城墙层由调用方持有，随 HUD 一起销毁，这里不碰。
        this.clearDecor();
        // 一次性表现件（出生/受击/阵亡特效）不进 ECS，下面的遍历收不到，必须显式销毁，
        // 否则节点泄漏到下一局。直接 destroy 不回池（紧接着 this.pool.destroy() 会销毁整池）。
        this.effectPool.destroy();
        // 墙砖不进 ECS（渲染派生的固定下标池），scene 遍历收不到，必须显式销毁；墙层容器由调用方持有。
        this.wallRenderer.destroy();
        for (const scene of this.scene.values()) {
            if (scene.node.isValid) scene.node.destroy();
        }
        this.identity.clear();
        this.scene.clear();
        this.hexViews.clear();
        this.unitViews.clear();
        this.effectViews.clear();
        this.floatTextViews.clear();
        this.cardRevealViews.clear();
        this.legendBannerViews.clear();
        this.hexEntityBySource.clear();
        this.unitEntityBySource.clear();
        this.effectEntityBySource.clear();
        this.floatTextEntityBySource.clear();
        this.cardRevealEntityBySource.clear();
        this.legendBannerEntityBySource.clear();
        this.pool.destroy();
        this.pooledEntityKeys.clear();
        this.unitIds.clear();
        this.effectIds.clear();
        this.effectStates.length = 0;
        this.floatIds.clear();
        this.cardRevealIds.clear();
        this.legendBannerIds.clear();
        this.buildingShakeHexes.clear();
        this.unitInterpolator.clear();
        this.wallGeometry.clear();
        this.unitOutlineCopyMaterial?.destroy();
    }

    private createEntity(kind: ZCRenderEntityKind, sourceId: number, node: Node): number {
        const entityId = this.nextEntityId++;
        this.identity.set(entityId, { kind, sourceId });
        this.scene.set(entityId, { node });
        return entityId;
    }

    private removeEntity(entityId: number): void {
        const node = this.scene.get(entityId)?.node;
        const key = this.pooledEntityKeys.get(entityId);
        if (node?.isValid) {
            if (key !== undefined) this.pool.release(key, node);
            else node.destroy();
        }
        this.pooledEntityKeys.delete(entityId);
        this.identity.delete(entityId);
        this.scene.delete(entityId);
        this.hexViews.delete(entityId);
        this.unitViews.delete(entityId);
        this.effectViews.delete(entityId);
        this.floatTextViews.delete(entityId);
        this.cardRevealViews.delete(entityId);
        this.legendBannerViews.delete(entityId);
    }

    /**
     * 地块激活表现（开发成功后的「Y 上移 + 翻转」）**每帧**推进。
     *
     * 为什么单开一条：`renderHexSystem` 挂在 `renderStatic` 上、由 `ZCGame.update`
     * 按 0.15s 节流 —— 6.7fps 播不出翻面，会一卡一卡（卡牌 / 特效 / 飘字都在
     * `renderDynamic` 里每帧刷，这里对齐它们）。
     *
     * 只遍历**当前有激活事件**的格子，平时队列为空 ⇒ 零开销。事件过期由模型侧
     * `prune` 摘掉，摘掉那一刻这里不再调它 ⇒ 要复位的话靠 `ZCHexView.render` 的
     * 0.15s 兜底（同一条 `applyActivationFx`，幂等）。
     */
    private renderHexActivations(frame: ZCGameRenderFrame): void {
        const activations = frame.hexActivations;
        if (!activations.length) return;
        const now = this.visualTime(frame);
        for (const activation of activations) {
            const entityId = this.hexEntityBySource.get(activation.hexId);
            if (entityId === undefined) continue;
            const hex = frame.hexesById.get(activation.hexId);
            if (!hex) continue;
            const state = hex.state;
            const owner: ZCFaction = state.owner === 'neutral' && hex.canDevelop ? 'player' : state.owner;
            this.hexViews.get(entityId)?.renderActivation(activation, now, owner);
        }
    }

    private renderHexSystem(frame: ZCGameRenderFrame): void {
        const now = this.visualTime(frame);
        // 逐格归属抽成具名方法（规范：不在调用点写内联闭包）；本帧 frame / now 走字段。
        this.territoryFrame = frame;
        this.territoryOutlineNow = now;
        const boundaryMasks = buildTerritoryBoundaryMasks(this.map, this.ownerForHex);
        this.redrawSharedOutline(this.map, boundaryMasks);
        for (const state of frame.snapshot.hexes) {
            const entityId = this.hexEntityBySource.get(state.id);
            if (!entityId) continue;
            const hex = frame.hexesById.get(state.id);
            if (!hex) continue;
            this.hexViews.get(entityId)?.render({
                state,
                canDevelop: hex.canDevelop,
                playerGold: frame.snapshot.playerGold,
                cooldown: hex.cooldown,
                now,
                hideNeutralResourceLabel: frame.mapConfig.cityMode === 'select',
                boundaryMask: boundaryMasks.get(state.id) ?? 0,
                activation: hex.activation,
            });
        }
    }

    /**
     * 把整盘领地轮廓汇总到 `OutlineLayer` 的**单个** `cc.Graphics` 上。
     *
     * 逐边描线的判据（`boundaryMask` 的 bit 含义）全在 `buildTerritoryBoundaryMasks` 里，
     * 这里只负责把同一份 mask 画到共享画布上，**不碰判据**。
     *
     * 复用 `ownerForHex` + `boundaryMasks`（与地块底图染色同一套口径），保证
     * 「底图颜色」和「轮廓颜色」永远一致 —— 分成两处算就会在某帧对不上。
     *
     * 调用点：`renderHexSystem`（正式对局）和 `renderSpawnSelection`（选点阶段）。
     * 两者都只在**内容变化**时被调（见各自的 `contentKey` / 选点状态机），
     * 不是每帧。`ZCHexView` 自己那份 per-cell `cc.Graphics` 已不再绘制。
     */
    private redrawSharedOutline(
        //  具名类型用现成的 `ZCHexConfig`（两个调用点传的就是它）—— 不再内联形状、
        // 也不套 `Readonly<…>`（元素字段没人改，那层包装只是噪音；数组本身仍是只读视图）。
        hexes: readonly ZCHexConfig[],
        boundaryMasks: ReadonlyMap<number, number>,
        mode: ZCOutlineMode = 'battle',
        selectedHexId: number | null = null,
    ): void {
        //  逐格归属按 `mode` 选一份现成的具名实现（原先由调用点各传一个内联闭包进来）。
        const ownerForHex = mode === 'spawn' ? this.spawnOwnerForHex : this.ownerForHex;
        //  prefab 上 `OutlineLayer` 必须挂 `cc.Graphics`。这里**不崩**而是直接不画 ——
        // 崩掉会让整个对局开不起来（`renderHexSystem` 是地块系统的入口），而"轮廓没画"
        // 是个能靠肉眼立刻发现的视觉缺陷。宁可少画也不要整局打不开。
        if (!this.outlineGraphics) return;
        // 先比内容，**没变就连 Graphics 都不碰**。
        // `renderStatic` 是 0.15s 一次的低频刷新，而 `Graphics.clear()` + 重新 stroke
        // 会重建整个渲染数据（顶点缓冲上传）。绝大多数刷新里归属没变（只是血条/飘字在动），
        // 无条件重建等于每 0.15s 白upload 一次整盘轮廓。
        //
        // 用「复用数组 + 逐项比」而不是拼字符串签名：字符串每次都要新建 ~1.5KB
        // （AGENTS.md 禁 update 路径分配），而数字哈希又有碰撞风险 ——
        // 一次漏更新就是「领地底色和轮廓颜色对不上」这种极难查的视觉错。
        //
        // 前三个数是阶段、玩家选中格与棋盘缩放；每格再压 id、阵营序号、mask。
        // 选点格变化时即使领地 mask 没变，也必须重画内缩高亮。
        const probe = this.outlineProbe;
        const mapScale = Math.abs(this.options.mapLayer.scale.x) || 1;
        probe[0] = mode === 'spawn' ? 1 : 0;
        probe[1] = selectedHexId ?? -1;
        probe[2] = mapScale;
        let cursor = 3;
        for (const hex of hexes) {
            if (!hex.playable) continue;
            const mask = boundaryMasks.get(hex.id);
            if (!mask && hex.id !== selectedHexId) continue;
            probe[cursor] = hex.id;
            probe[cursor + 1] = ZCGameRenderWorld.FACTION_ORDER.indexOf(ownerForHex(hex.id)) + 1;
            probe[cursor + 2] = mask ?? 0;
            cursor += 3;
        }
        const drawn = this.outlineDrawn;
        if (cursor === drawn.length) {
            let same = true;
            for (let i = 0; i < cursor; i += 1) {
                if (probe[i] !== drawn[i]) {
                    same = false;
                    break;
                }
            }
            if (same) return;
        }
        for (let i = 0; i < cursor; i += 1) drawn[i] = probe[i];
        drawn.length = cursor;

        resetOutlineSegments();
        let selectedX = 0;
        let selectedY = 0;
        let hasSelectedHex = false;
        for (const hex of hexes) {
            if (!hex.playable) continue;
            const mask = boundaryMasks.get(hex.id);
            if (!mask && hex.id !== selectedHexId) continue;
            const x = mapToViewX(hex.x);
            const y = mapToViewY(hex.y);
            if (mask) appendHexOutlineSegments({
                centerX: x, centerY: y, owner: ownerForHex(hex.id), boundaryMask: mask,
            });
            if (hex.id === selectedHexId) {
                selectedX = x;
                selectedY = y;
                hasSelectedHex = true;
            }
        }
        if (hasSelectedHex) appendSelectedHexOutlineSegments(selectedX, selectedY);
        flushOutlineSegments(this.outlineGraphics);
    }

    /** 换局 / 换地图时强制下一次重画：探针缓冲跨局残留会让首帧沿用上一局的轮廓。 */
    invalidateSharedOutline(): void {
        this.outlineDrawn.length = 0;
        this.outlineProbe.length = 0;
    }

    /**
     * 开始结算扫场：建步号表，**但一格都不染**。幂等 —— 已在播时忽略。
     * 返回 false 表示这一盘没有可染的格子（全是虚空），调用方别等它。
     *
     * 起手不留亮格（`litStep = -1`，等第一次 `advanceVictorySweep` 才推到 0）是故意的：
     * 镜头要先拉远到看得见整盘，如果这里就把起手那一格染上，玩家在原视角下会先看到
     * 屏幕边上莫名变了一格、几百毫秒后镜头才动 —— 顺序反了。
     */
    startVictorySweep(frame: ZCGameRenderFrame, winner: ZCOwner): boolean {
        const wasActive = this.sweep.active;
        const started = this.sweep.start(this.map, winner);
        if (started && !wasActive) this.renderHexSystem(frame);
        return started;
    }

    /**
     * 推进扫场。返回 **true = 还在播**，调用方要继续等、先别弹结算。
     *
     * 只在「点亮到新的一格」时才重画：整盘 200 来格的 spriteFrame 赋值，每帧无条件
     * 刷会白白吃掉结算这几秒。逐格后重画频率高了一档，但 `ZCHexView.render` 自己用
     * `contentKey` 挡掉了无变化的格，实际只有刚跨过边界的那一两格会真的换图。
     */
    advanceVictorySweep(frame: ZCGameRenderFrame, dt: number): boolean {
        if (this.sweep.advance(dt)) this.renderHexSystem(frame);
        return this.sweep.isPlaying;
    }

    /**
     * 中止扫场并把所有格子还原成真实归属的底色。
     * 重开一局、退出对局都要调 —— 否则下一局的格子会带着上一局胜利方的颜色出场。
     */
    clearVictorySweep(): void {
        this.sweep.clear();
        for (const view of this.hexViews.values()) view.setSweepOwner(null);
    }

    /**
     * 开始播「开局归属扩散」波：两座主城各自为圆心，把**中立格**的底色从选点阶段铺的
     * 半区色逐个换成战斗底色（半径越来越大、越往外越快）。
     *
     * 调用点在选点确认、正式对局建好之后（`ZCGame.finishSpawnSelection`）—— 那一刻模型里
     * 的主城与邻格**已经归属好了**（它们不入波，一帧直接到位），而整盘底色还停在选点观感上。
     *
     * `selection` 只为取「这一格属于哪个半区」：那份分区口径（地图画的分区 / 按布局推导）
     * 全在 `ZCSpawnSelection.regionOwnerOf` 里，这里不自己拼第二份。⚠️ 必须在调用方把
     * `spawnSelection` 置空**之前**调（`finishSpawnSelection` 里那个局部 `selection` 仍有效）。
     *
     * 返回 `false` = 这一盘没有要染的格（没有主城 / 主城全是中立 / 查不到半区），调用方不必等。
     * 幂等 —— 已在播时直接返回 true，重复调用不会重排时间表。
     */
    startTerritoryClaimWave(frame: ZCGameRenderFrame, selection: ZCSpawnSelection): boolean {
        const map = frame.mapConfig;
        if (!map?.homes?.length) return false;
        const states = frame.snapshot.hexes;
        const ownerById = new Map(states.map((state) => [state.id, state.owner] as const));
        return this.claimWave.start(
            this.map,
            map.homes,
            {
                ownerOf: (hexId) => ownerById.get(hexId) ?? 'neutral',
                sectionOwnerOf: (hexId) => (selection.regionOwnerOf(hexId) ?? 'neutral') as ZCFaction,
                // 终点色与底图 / 轮廓同源：开局那一刻中立格都还不可开发，所以事实上全落回中立观感；
                // 走同一个 `territoryTintOwner` 是为了「万一它已经可开发」也不会在收工那一帧跳色。
                tintOwnerOf: (hexId) => territoryTintOwner(
                    ownerById.get(hexId) ?? 'neutral', frame.hexesById.get(hexId)?.canDevelop === true),
            },
            this.visualTime(frame),
        );
    }

    /**
     * 中止扩散波并把所有格交还常规渲染。
     * 重开一局、退出对局都要调 —— 否则下一局的格子会带着上一局中途的过渡色出场。
     */
    clearTerritoryClaimWave(): void {
        this.claimWave.clear();
    }

    private renderUnitSystem(frame: ZCGameRenderFrame): void {
        const now = this.visualTime(frame);
        this.effectPool.recycleSpawnFx(now);
        this.effectPool.recycleDeathFx(now);
        const activeIds = this.unitIds;
        activeIds.clear();
        for (const unit of frame.snapshot.units) activeIds.add(unit.id);
        for (const [sourceId, entityId] of this.unitEntityBySource) {
            if (activeIds.has(sourceId)) continue;
            // 光柱是这个单位节点的子节点：不先摘下来，它会跟着宿主进池，
            // 表现为「人没了原地还立着光柱」，更糟的是复用时挂到别的单位身上。
            const unitNode = this.scene.get(entityId)?.node;
            if (unitNode) this.effectPool.detachSpawnFxOf(unitNode);
            this.removeEntity(entityId);
            this.unitEntityBySource.delete(sourceId);
            this.unitInterpolator.forget(sourceId);
            // 单位已彻底从快照移除，清掉阵亡去重记录（为下一局/再次出现腾位）。
            this.effectPool.clearDeadFxPending(sourceId);
        }
        for (const unit of frame.snapshot.units) this.renderUnitEntity(unit, frame);
    }

    private renderUnitEntity(unit: Readonly<ZCUnitState>, frame: ZCGameRenderFrame): void {
        const definition = frame.unitDefinitionsById.get(unit.unitId) ?? resolveUnitDefinition(unit.unitId);
        let entityId = this.unitEntityBySource.get(unit.id);
        const isBirth = entityId === undefined;
        if (!entityId) {
            if (!this.options.unitPrefab) return;
            const key = `unit:${unit.unitId}`;
            const node = this.pool.acquire(key, () => instantiate(this.options.unitPrefab));
            node.setParent(this.options.mapLayer);
            node.setSiblingIndex(this.options.mapLayer.children.length - 1);
            node.layer = this.options.mapLayer.layer;
            node.setScale(Vec3.ONE);
            node.name = `Unit_${unit.id}`;
            // 同上：视图组件在 ZCGameUnit.prefab 上。
            const view = node.getComponent(ZCUnitView)!;
            view.setOutlineCopyMaterial(this.unitOutlineCopyMaterial);
            // 第二个参数是卡表 `pvpCard.prefabSize`（美术等比缩放，解析层永远给值、
            // 表里留空按 1）。 从 `definition` 取、不是从 prefab 取：同一个 prefab
            // 可能被多张卡共用（女猎手/泰兰德、冰法师/吉安娜…），体型是**按卡**配的。
            //  视图自己按 `definition.unitId` 向控制器取美术 prefab（`prefabSize` 也在 definition 上）。
            view.initialize(definition);
            entityId = this.createEntity('unit', unit.id, node);
            this.pooledEntityKeys.set(entityId, key);
            this.unitViews.set(entityId, view);
            this.unitEntityBySource.set(unit.id, entityId);
        }
        const currentPosition = this.unitPosition(unit);
        const { x, y } = this.unitInterpolator.positionOf(unit, frame, currentPosition.x, currentPosition.y);
        // 复用同一个 presentation 对象（见 UNIT_PRESENTATION_SCRATCH 的说明）：
        // 视图同步取字段、不持有引用，所以每帧覆写是安全的。
        const presentation = ZCGameRenderWorld.UNIT_PRESENTATION_SCRATCH;
        presentation.unit = unit;
        presentation.definition = definition;
        presentation.x = mapToViewX(x);
        presentation.y = mapToViewY(y);
        presentation.now = this.visualTime(frame);
        this.unitViews.get(entityId)?.render(presentation);
        // 出生光柱挂到**单位节点**下（不是 mapLayer 的兄弟），这样它自动跟着插值后的位置走。
        if (isBirth) {
            this.effectPool.playSpawnFx(this.scene.get(entityId)!.node, presentation.now);
            // 新兵自己原地抖一下（Y 拉 110% 回落、再 X 拉 110% 回落）。
            this.unitViews.get(entityId)?.playSpawnShake(presentation.now);
            // 生成它的**建筑**也抖一下（需求 2026-10-15 row5）：兵营产兵倒计时结束时，
            // 建筑模型（根下的 BuildingIcon）同样「先 Y 后 X」抖一次。
            //
            // 判据用「出生单位的 `sourceHexId` 这一格的建筑是不是**兵营**」，不用「有没有冷却环」——
            // 主城 / 金矿也有环（收入 / 产出），而这条路要的是**产兵**建筑抖；
            // 主城 / 金矿的抖动走的是产金那条表现事件，两者别混。
            if (frame.hexesById.get(unit.sourceHexId)?.state.building === 'barracks') {
                this.triggerBuildingShake(unit.sourceHexId, presentation.now);
            }
        }
        // 阵亡特效：**判死那一帧**播，坐标取 `presentation.x/y`（视图坐标，已含插值）。
        // 挂 mapLayer 不挂宿主、按 unitId 去重只播一次 —— 口径都在 `ZCEffectPool.playDeathFx`。
        if (unit.battleState === 'dead') {
            this.effectPool.playDeathFx(presentation.x, presentation.y, unit.id, this.visualTime(frame));
        }
    }

    /**
     * 把兵力资源点要站的骨骼喂给地块视图。
     *
     * 卡 id 与数量都来自 `neutralResource` 表的 `rewardCardId` / `rewardUnitCount`；
     * 骨骼 prefab 走既有 `unitVisualPrefabs`（已随首屏预加载），**不额外加载**。
     * 表里没配卡 / 卡没单位 prefab ⇒ 喂 `null`，视图退回文字兜底而不是留空格。
     */
    private injectResourceUnits(view: ZCHexView): void {
        const reward = neutralResourceRewardOf('unit_cap');
        const cardId = reward.rewardCardId;
        const prefabs = this.options.unitVisualPrefabs as ReadonlyMap<ZCUnitId, Prefab> | undefined;
        const unitId = cardId ? this.unitIdOfCard(cardId) : null;
        const prefab = unitId ? prefabs?.get(unitId) ?? null : null;
        view.setResourceUnits(cardId ?? '', prefab, reward.rewardUnitCount);
    }

    /** 卡 id → unitId。卡表里两者同值，但别假设：用目录反查，查不到就按同值兜一次。 */
    private unitIdOfCard(cardId: string): ZCUnitId | null {
        const card = findCatalogCard(cardId);
        return card ? (card.unitId as ZCUnitId) : (cardId as ZCUnitId);
    }

    private unitPosition(unit: Readonly<ZCUnitState>): { x: number; y: number } {
        // 模型在所有移动状态都更新连续坐标；切到等待/攻击时格子进度会被清零。
        if (Number.isFinite(unit.freeX) && Number.isFinite(unit.freeY)) {
            //  写进复用对象而不是返回新字面量：这段每帧每单位各跑一次
            // （46 单位 × 60 帧 ≈ 2800 个/秒），返回 `{x,y}` 正是 AGENTS.md 禁止的
            // 「update 路径分配临时对象」。调用方 `renderUnitEntity` 立刻解构取走、不持有，
            // 所以单例复用一个 scratch 是安全的（非重入）。
            const scratch = ZCGameRenderWorld.UNIT_POSITION_SCRATCH;
            scratch.x = unit.freeX;
            scratch.y = unit.freeY;
            return scratch;
        }
        // 仅兼容没有连续坐标的旧快照。
        const source = this.map[unit.sourceHexId];
        const target = unit.targetHexId === null ? source : this.map[unit.targetHexId];
        const legacy = ZCGameRenderWorld.UNIT_POSITION_SCRATCH;
        legacy.x = source.x + (target.x - source.x) * unit.progress;
        legacy.y = source.y + (target.y - source.y) * unit.progress;
        return legacy;
    }

    private renderEffectSystem(frame: ZCGameRenderFrame): void {
        const activeIds = this.effectIds;
        activeIds.clear();
        this.effectStates.length = 0;
        for (const event of frame.snapshot.combatEvents) this.effectStates.push(event);
        for (const projectile of frame.snapshot.projectiles ?? []) this.effectStates.push(projectile);
        for (const event of this.effectStates) activeIds.add(event.id);
        for (const [sourceId, entityId] of this.effectEntityBySource) {
            if (activeIds.has(sourceId)) continue;
            this.removeEntity(entityId);
            this.effectEntityBySource.delete(sourceId);
        }
        for (const event of this.effectStates) {
            let entityId = this.effectEntityBySource.get(event.id);
            if (!entityId) {
                if (!this.options.effectPrefab) return;
                const key = `effect:${event.effectPrefabPath ?? ''}`;
                const node = this.pool.acquire(key, () => instantiate(this.options.effectPrefab));
                node.setParent(this.options.mapLayer);
                node.setSiblingIndex(this.options.mapLayer.children.length - 1);
                node.layer = this.options.mapLayer.layer;
                node.setPosition(new Vec3(mapToViewX(event.fromX), mapToViewY(event.fromY), 0));
                node.setScale(Vec3.ONE);
                node.name = `SkillEffect_${event.skillId}_${event.id}`;
                // 同上：视图组件在 ZCGameEffect.prefab 上。
                const view = node.getComponent(ZCCombatEffectView)!;
                view.initialize(event.effectPrefabPath ? this.options.effectVisualPrefabs.get(event.effectPrefabPath) || null : null);
                entityId = this.createEntity('effect', event.id, node);
                this.pooledEntityKeys.set(entityId, key);
                this.effectViews.set(entityId, view);
                this.effectEntityBySource.set(event.id, entityId);
            }
            const projectile = event.type === 'projectile' && 'velocityX' in event ? event as Readonly<ZCProjectileState> : undefined;
            const alpha = frame.interpolationAlpha;
            this.effectViews.get(entityId)?.render(event, this.visualTime(frame), projectile, alpha);
        }
    }

    private visualTime(frame: ZCGameRenderFrame): number {
        return frame.snapshot.elapsedSeconds + (frame.snapshot.status === 'playing' ? frame.snapshot.pendingSeconds ?? 0 : 0);
    }

}
