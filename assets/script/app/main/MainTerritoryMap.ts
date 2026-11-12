import {
    _decorator,
    Component,
    EffectAsset,
    instantiate,
    Node,
    Prefab,
    ScrollView,
    SpriteFrame,
    UITransform,
    Vec2,
    Vec3,
    view,
} from 'cc';
import type { AssetService } from '../../core/asset/AssetService';
import type { GameContext } from '../../core/runtime/GameContext';
import type { IControllerResources } from '../../framework/controller/ControllerBase';
import { createIconArtResolver, type IconRow } from '../HeadArtModel';
import {
    HEX_GROUND_GLOW_ART_ROOT,
    RESOURCE_ICON_ART_ROOT,
    spriteFramePath,
    spriteFramePathOf,
    TERRITORY_CHEST_ART_ROOT,
    TERRITORY_CLOUD_ART_ROOT,
    TERRITORY_RANDOM_GAIN_READOUT_ART,
} from '../ArtPaths';
import { GameRoute } from '../../core/runtime/GameRoute';
import { ZC_BATTLE_TYPE_CHAPTER } from '../battle/BattleStartModel';
import { ProcedureManager } from '../../framework/procedure/ProcedureManager';
import { FW } from '../../framework/FW';
import { EventMgr } from '../../framework/event/EventMgr';
import type { ITerritoryRewardPresentation } from '../territory/application/TerritoryEvents';
import type {
    TerritoryIdleRewardGain,
} from '../territory/model/TerritoryIdleReward';
import type { ITerritoryGrantedReward } from '../territory/model/TerritoryGrantedReward';
import {
    splitTerritoryRewards,
    TERRITORY_SILVER_RES_ID,
    TERRITORY_STAMINA_RES_ID,
    territoryWalletResKeyOf,
} from '../territory/model/TerritoryResourceGain';
import {
    territoryChestTierOfRewards,
    type TerritoryChestTier,
} from '../territory/model/TerritoryChestTier';
import { TERRITORY_CHEST_OPEN_FRAMES } from '../territory/model/TerritoryChestAnimation';
import type { ITerritoryChestIconEntry } from '../territory/view/TerritoryChestView';
import {
    ITEM_TABLE,
    resBarCellOfRefId,
    resBarIconSpritePath,
    ROLE_PROPERTY_TABLE,
    type IItemRefRow,
    type IResPropertyRow,
} from '../common/ResTypes';
import { RefUtil } from '../../framework/ref/RefUtil';
import { ResBar } from '../common/ResBar';
import { MainTabHost } from './MainTabHost';
import { MainTab } from './MainTabModel';
import { TabButton } from '../common/TabButton';
import { isTerritoryHeroRewardResId } from '../territory/model/TerritoryHeroReward';
import type {
    ITerritoryHeroProgressSource,
    ITerritoryRewardDelta,
} from '../territory/model/TerritoryHeroReward';
import { HeroFragmentBadge, type HeroFragmentBadgeFrames } from './HeroFragmentBadge';
import {
    TERRITORY_MAP_BOTTOM_INSET,
    territoryMapContentPaddingBottom,
    territoryMapContentPaddingTop,
    territoryMapOffsetForCell,
} from '../territory/model/TerritoryMapLayout';
import type { ITerritoryMapLayout } from '../territory/model/TerritoryMapLayout';
import type { ITerritorySaveOwner } from '../territory/model/TerritorySaveStore';
import {
    TERRITORY_BATTLE_PRELUDE_APPROACH_SECONDS,
    territoryBattlePreludeApproachSettled,
    territoryBattlePreludeSpawnSettled,
} from '../territory/model/TerritoryBattleApproach';
import {
    TERRITORY_BATTLE_INTRO_HOLD_MAX_SECONDS,
    TERRITORY_BATTLE_INTRO_READY_MAX_SECONDS,
    TERRITORY_BATTLE_INTRO_RESTORE_FALLBACK_SECONDS,
    TERRITORY_BATTLE_INTRO_TARGETS,
    territoryBattleIntroHoldFx,
    territoryBattleIntroInFx,
    territoryBattleIntroInFxAt,
    territoryBattleIntroOutFx,
    territoryBattleIntroOutFxAt,
    territoryBattleIntroPushPx,
    type ITerritoryBattleIntroFx,
} from '../territory/model/TerritoryBattleIntro';
import type { IMatchingEntryParams } from '../matching/MatchTypes';
import {
    TERRITORY_CHAPTER_SWITCH_WAIT_MAX_SECONDS,
    territoryChapterSwitchCoverProgress,
    territoryChapterSwitchLeadProgress,
    territoryChapterSwitchReadyToReveal,
    territoryChapterSwitchRevealOffset,
    territoryChapterSwitchRevealProgress,
    territoryChapterSwitchRise,
    territoryChapterSwitchSinkDistance,
    territoryChapterSwitchSinkOffset,
    territoryChapterSwitchWanted,
} from '../territory/model/TerritoryChapterSwitch';
import { TERRITORY_TEXTS } from '../territory/application/TerritoryTexts';
import { TerritoryMapView } from '../territory/view/TerritoryMapView';
import {
    acquireIntroHud,
    applyIntroHud,
    releaseIntroHud,
    type ITerritoryBattleIntroHud,
} from '../territory/view/TerritoryBattleIntroHud';
import { BigMapPlayerLevelPanel } from '../territory/view/BigMapPlayerLevelPanel';
import type {
    IBigMapPlayerLevelContent,
    IBigMapPlayerLevelReward,
} from '../territory/view/BigMapPlayerLevelPanel';
import { PopupBase } from '../../framework/ui/PopupBase';
import { PopupManager } from '../../framework/ui/PopupManager';
import { LevelInfoPanel } from './LevelInfoPanel';
import type { ILevelInfoContent } from './LevelInfoPanel';
import { LevelTipPanel } from './LevelTipPanel';
import type { ILevelTipContent, ILevelTipEnemy } from './LevelTipPanel';
import type {
    ITerritoryDetailState,
    ITerritoryLevelInfoContent,
    ITerritoryLevelTipContent,
    ITerritoryNavigateBattlePayload,
    ITerritoryPlayerStageContent,
    ITerritoryShowRewardsPayload,
    ITerritoryShowTipPayload,
    ITerritorySetBusyPayload,
} from '../territory/application/TerritoryEvents';
import { qualityFrameArtPath } from '../itemdetail/ItemDetailArt';
import { qualityFrameSuffixOf } from '../itemdetail/ItemDetailTable';
import { LoadingPopup } from '../common/LoadingPopup';

import { VIEW_LIFECYCLE } from '../../framework/ui/ViewLifecycle';
import { TerritoryUiEvent, TerritoryViewEvent, type TerritoryIntent,
    type ITerritoryRenderEvent, type ITerritoryCommandEvent } from '../territory/application/TerritoryEvents';
import type { ITerritoryRenderState } from '../territory/application/TerritoryViewState';

const { ccclass, property } = _decorator;
/**
 * 顶部 HUD（个人信息框 + 好友 / 邮件 / 排行榜 / 邀请）的节点名。
 *
 * 它**不在**地图 prefab 里：层级是 `ArenaRoot / MapRoot / MainTerritoryMap`，
 * 而 `TopHud` 是 `ArenaRoot` 的孩子 ⇒ 与地图页**隔了一层 `MapRoot`**，只能按名字往上找
 * （见 `hostPageRoot`）。
 * ⚠️ 尺寸不许抄 prefab 数字：它挂 `Widget` + 长屏适配（`MainHudLayout` 按安全区改 `top`），
 *    底边随屏幕比例变，抄死数值在长屏上会差几十像素。
 */
const TOP_HUD_NODE_NAME = 'TopHud';

/**
 * 底部挂件（任务入口 / 快速寻敌 / 宝箱栏）的节点名 —— 地图**下边界**的基准。
 *
 * 🔴 2026-10-28 用户：「地图最底部的地块限制拖动距离，最大只能间距 50px」，
 *    当场追问确认的基准是「到任务 / 快速寻敌挂件的**上沿**」，不是顶部 HUD。
 *
 * 三块的位置各不相同，所以只能按名字找：
 *  · `MainTaskEntry` 是 `BottomHud` 的**孩子**（prefab 实例，Widget 已关，靠 `_lpos` 定位）；
 *  · `BeginGame`（快速寻敌）与 `ChestBar`（宝箱栏）是宿主页 `ArenaRoot` 的**孩子**。
 *
 * 取它们上沿里**最高**的那个（= 咬入视口最深的那个）—— 地图要让开的是最高的那一块，
 * 不是平均线。`MainTaskEntry` 实测就是最高的（305px），也是用户红框画在它上方的原因。
 */
const BOTTOM_HUD_NODE_NAMES = ['MainTaskEntry', 'BeginGame', 'ChestBar'] as const;

/**
 * 在 `root` 子树里按名字找节点（深度优先，含 `root` 自己）。
 *
 * 不用 `cc.find('BottomHud/MainTaskEntry')`：那是**绝对路径**，宿主页结构一动就断，
 * 而这几个挂件有的是孩子、有的是孙辈，写死路径等于把结构抄进代码。
 */
function findDescendantByName(root: Node, name: string): Node | null {
    if (root.name === name) return root;
    for (const child of root.children) {
        const hit = findDescendantByName(child, name);
        if (hit) return hit;
    }
    return null;
}

/**
 * 整页过场"到点了要把玩家送去哪"。
 *
 * 两条路都从这里走同一个 `commitBattleNav`（保证全项目只有一处 `ProcedureManager.navigate`）：
 *
 * · `battle`：领地格点开战 —— 要等**服务器回包**（`navigate` 命令）才有 payload，
 *   过场正好把这段等待盖住；
 * · `matching`：宝箱栏的「战斗」格 —— 纯本地跳转，没有在途请求，所以起演那一刻就
 *   把这条记下来（`hold` 段立刻结束），过场退化成"推进去、再散开"。
 */
type ITerritoryBattleIntroNav =
    | { readonly route: 'battle'; readonly payload: ITerritoryNavigateBattlePayload }
    | { readonly route: 'matching'; readonly entry: IMatchingEntryParams };

/** 整页过场的运行时状态（时间轴在 page 里推进，曲线在 `model/TerritoryBattleIntro`）。 */
interface IBattleIntroState {
    phase: 'out' | 'hold' | 'in';
    /** 当前段的进度秒数。 */
    elapsed: number;
    /** `hold` 段"等回包"累计多久（超 `TERRITORY_BATTLE_INTRO_HOLD_MAX_SECONDS` 就取消）。 */
    held: number;
    /** 要把玩家送去哪（`navigate` 到达时才填）。 */
    nav: ITerritoryBattleIntroNav | null;
    /**
     * 目标页的资源是否就绪（`true` = 可以散场）。
     *
     * `nav` 到达只说明"知道去哪"，不说明"那边画得出来"：战场首帧资源实测要 5 秒
     * （`[BattleLoading] 首帧资源准备完成 5079ms`）。云必须盖到它好为止，
     * 否则玩家看到的是"云散开 → 一片空屏 5 秒 → 战场突然出现"。
     */
    ready: boolean;
    /** `nav` 到达之后又等了多久（等资源），与 `held`（等回包）分开记。 */
    waited: number;
    /** 已经发起过 `commitBattleNav`（`in` 段只许跳一次）。 */
    navigated: boolean;
    /** 推出去的 HUD 句柄（基准 / 方向 / 透明度都在 `TerritoryBattleIntroHud` 里）。 */
    hud: ITerritoryBattleIntroHud[];
    /** 推出距离（px），开演时按视口算一次。 */
    pushPx: number;
}

/**
 * 章节切换转场的运行时状态（时间轴在 page 里推进，曲线在 `model/TerritoryChapterSwitch`）。
 *
 * 需求 2026-11-04：「镜头快速上移，移动到新章节的位置，将新章节居中，
 * 玩家只能通过章节按钮播放切换动画，回到已通过的章节」。
 *
 * 三段：`cover`（云合拢 + 旧图被带着往下走）→ `wait`（黑场里换图，等新章画上来）
 * → `reveal`（新章从上方落回居中，云散开）。
 */
interface IChapterSwitchState {
    readonly from: number;
    readonly to: number;
    /**
     * `lead` 相机先行 → `cover` 云合拢 → `wait` 换图 → `reveal` 揭幕。
     *
     * `lead` 是 2026-11-05 用户补的：「相机先向上快速移动 0.1s 后，云层遮挡动画再开始播放」。
     * 那一段**云还没出来**，只有 `MapLayer` 在动 —— 所以它必须是独立的一段，并进 `cover`
     * 就变成"云一边合拢、镜头一边慢慢走"。
     */
    phase: 'lead' | 'cover' | 'wait' | 'reveal';
    /** 当前段的进度秒数。 */
    elapsed: number;
    /** 新章落位的总距离（px，按视口高度算；0 = 只演云不演位移）。 */
    readonly rise: number;
    /**
     * 「首通云散演完之后补的那一段切换」要等云盖满才允许换图（2026-11-11）。
     *
     * 自动推进时模型**早就**把新章加载完了；玩家点章节按钮那条路靠异步加载天然拖过
     * `lead` + `cover` 那 0.42s，而这条没有 ⇒ 不压住的话新图会在云还没盖住时直接露出来。
     */
    deferRender: boolean;
}

/**
 * 「冒险」页的 Passive View。
 *
 *  本类只做引擎生命周期、接线与渲染编排；状态、流程、规则全部在纯 TS 的
 *  application 层；页面只消费会话快照和表现命令，操作通过 Intent 派发。
 *
 * | 关注点 | 归属 |
 * |---|---|
 * | 主城地图页骨架 / Widget 对齐 / 滚动裁剪惯性 | `ui/main/MainTerritoryMap.prefab` + `cc.ScrollView` |
 * | 六边格 / 连线 / 站点渲染 | `TerritoryMapView` |
 * | 状态与业务编排（纯 TS、可单测） | `TerritoryController` |
 * | 章节加载 / 本地存档（端口适配器） | `TerritoryChapterLoader` / `TerritorySaveStoreAdapter` |
 *
 *  宿主在挂载前交付 GameContext；控制器基类管理资源作用域，页面只使用展示资源。
 */
@ccclass('MainTerritoryMap')
export class MainTerritoryMap extends Component {
    @property({ type: ScrollView, group: '节点引用', tooltip: 'MapScrollView：地图滚动容器（视口裁剪 + 惯性回弹）' })
    mapScrollView: ScrollView = null;

    @property({ type: TerritoryMapView, group: '节点引用', tooltip: 'MapScrollView 的内容层（六边格 / 连线 / 站点）' })
    mapView: TerritoryMapView = null;

    @property({ type: Prefab, group: '节点引用', tooltip: '异步据点「玩家关卡」弹窗 prefab（ui/territory/BigMapPlayerLevelPanel）' })
    playerStagePrefab: Prefab = null;


    /** 站点详情弹窗（onLoad 实例化，常驻页面、默认收起）。 */
    /** 异步据点「玩家关卡」弹窗（同 `detailPanel`，两个面板互斥显示）。 */
    private playerStagePanel: BigMapPlayerLevelPanel = null;

    /** 敌军头像按路径缓存（`pvpCard.headIcon` 是路径，不是 resId）。 */
    private readonly levelTipIcons = new Map<string, SpriteFrame | null>();
    private levelTipRevision = 0;
    private levelTipVisible = false;
    /**
     * 玩家关卡弹窗的奖励格图标缓存：`resId → { 图标, 品质框 }`。
     *
     * 与 `rewardIcons` 分开：那一份只缓存**裸图标**（飘字 / 喷发也在用），
     * 这里还要多一张按 `roleProperty.quality` 选出来的品质框。
     */
    private readonly playerStageIcons = new Map<number, IBigMapPlayerLevelReward>();
    /**
     * 「关卡界面」主按钮上的**费用图标**（体力）。
     *
     * 与飘字那批资源一起加载（`loadResourceGainIcons`）：那一批本来就取了 `图标_体力`，
     * 再单独 load 一次是白发一次请求。`null` = 图没加载到 ⇒ 弹窗只藏图标、数字照常。
     */
    private staminaIcon: SpriteFrame | null = null;
    private state: ITerritoryRenderState | null = null;
    /** 领地存档归属（roleId/serverId），进入对局时随 pve 一并下发。 */
    private saveOwner: ITerritorySaveOwner | null = null;
    private lastRenderedChapter = -1;
    /**
     * 上一帧的"换图"被压住了（整章云散还在演）。
     *
     * 用户 2026-11-04：「SVG 合并之后，完成章节云层消散的动画没有了」。真因不是动画被删，
     * 而是**通关那一刻模型立刻换章**，而 `syncGrid` 换章第一件事就是 `clouds.reset()` ——
     * 云散刚起手就被掐掉。修法是把"换图"这个动作压到演出演完（模型不用等，它已经换成新章了，
     * 只是页面先不画），所以需要这个标记在 `update` 里补一次渲染。
     */
    private chapterSwapPending = false;
    /**
     * 「这一章刚刚首次通关」的一次性编排信号（2026-11-11）。
     *
     * 用户：「章节首次通关需要播放章节通过动画后，再播放切换」。模型通关那一拍立刻
     * `advanceCompletedChapter()`，页面只有先把换图压住、等整章云散演完，才接得上切换转场。
     * 这里记的是**意图**，不是动画状态：即使 SVN 合并把 `chapterClearPending` 那条边沿冲掉，
     * 只要 `chapterCleared` 在同一章里 false→true，也照样认首通。
     */
    private chapterClearFollowup = false;
    /** 首通自动推进的「旧章 → 新章」：云散演完那一刻拿它起切换转场。 */
    private chapterClearSwitch: { readonly from: number; readonly to: number } | null = null;
    /** 上一次真正画出来那一帧的通关电平（只用于同章内的 false→true 边沿）。 */
    private lastRenderedChapterCleared = false;
    /**
     * 章节切换转场（`null` = 没在演）。玩家点章节按钮由模型的 `chapterSwitch` 命令起；
     * 首通自动推进由 {@link chapterClearSwitch} 在云散演完之后补起同一段演出。
     */
    private chapterSwitch: IChapterSwitchState | null = null;
    private focusCell: { readonly chapterId: number; readonly cellId: number } | null = null;
    /** 首次完整绘制后报告 presented，组合层据此确认首屏就绪。 */
    private firstReadyNotified = false;
    private controllerResources: IControllerResources = null;
    private get assets(): AssetService { return this.controllerResources.assets; }
    private get configs(): GameContext['configs'] { return this.controllerResources.configs; }
    private get sessionAssets(): GameContext['sessionAssets'] { return this.controllerResources.sessionAssets; }
    private battleReady: Promise<unknown> | null = null;
    /**
     * 「遭遇敌人」过场正在播（或排队中）⇒ 丢弃后续的 navigate 命令。
     *
     *  过场期间地图输入是锁着的（`playBattleApproach` 里 `setInputLocked(true)`），正常点不出第二个格子；
     *  这道闸是给「服务端推送 / 上一笔迟到回包」兜底的 —— 真跳两次会让战斗流程收到两份 `pve`。
     */
    private battleApproachPending = false;
    /**
     * 「进战斗 / 匹配」整页过场（`null` = 没在演）。
     *
     *  三段：`out`（UI 推出 + 地块隐藏 + 云合拢）→ `hold`（云静止，等服务器回包）→ `in`（云散开）。
     *  时间轴与曲线全在 `model/TerritoryBattleIntro`，这里只做三件事：
     *  ① 扣 `dt` 换段；② 写 HUD 节点的位移 / 透明度；③ 把同一帧的 `fx` 交给地图视图。
     *
     *  ⚠️ HUD 的基准位置在**开演那一刻**量一次（`base`）：Widget 会在布局事件里改 position，
     *    每帧重量会把"已经被推出去的"位置当成基准，越推越远。
     */
    private battleIntro: IBattleIntroState | null = null;
    /**
     * 跳转已经发出、页面还没被销毁时留的"现场"（`null` = 没有欠账）。
     *
     *  `in` 段播完就跳转，但页面要等预加载完才销毁 —— 这段时间**故意不还原**主界面
     *  （还原会整片闪回来，过场白做）。留一份现场挂个兜底定时器：真没跳走就还回去。
     */
    private battleIntroLeftover: { hud: ITerritoryBattleIntroHud[] } | null = null;
    /**
     * 上一次 `busyBattle` 被过场接管、**没有真的弹全屏 loading**。
     *
     *  起演时故意不 `LoadingPopup.show`（它在弹窗层最上面，会把 `out` / `hold` 盖掉），
     *  但 `busy = false` 那条收尾还在 ⇒ 用这个标志把"没 show 过的那一次"配掉，
     *  否则会多减一次全局引用计数、把别的请求的遮罩提前撤掉。
     */
    private battleBusyHiddenLoading = false;
    /** `canvas-resize` 只挂一次（页面复用时不重复累积回调）。 */
    private mapInsetResizeBound = false;
    /**
     * 开箱表演要用的资源图标：`resId → 帧`（`null` = 查不到，只是那枚没有图）。
     *
     *  **按需加载 + 永久缓存**：奖励的 `resId` 是服务端回的，配置期不可能穷举；
     *  一次开箱最多 3~5 种，加载完就留在表里，下次同种资源直接命中。
     */
    private readonly rewardIcons = new Map<number, SpriteFrame | null>();
    /**
     * 表名 → 取表 Promise（`roleProperty` / `item`）。见 {@link refRows}。
     *
     * 只存 Promise：并发取图时大家搭同一趟车，读完就一直是那个已完成的结果。
     */
    private readonly refTableCache = new Map<string, Promise<readonly unknown[]>>();
    /**
     * 随机格**读数**统一图标（`种族经验球_随机`）的加载 Promise。见 {@link ensureRandomGainReadoutIcon}。
     *
     * 存 Promise 而不是结果：同一个格子上连点两次也只会加载一次。
     */
    private readoutIconPending: Promise<SpriteFrame | null> | null = null;

    /**
     * 英雄碎片进度徽标的数据源（2026-11-10 需求 ③）。由 `MainPageComposition` 注入，
     * 页面只认接口 —— 卡库表 / 背包 / 排序权重全在组合层，领地不反向依赖 `app/card`。
     * `null` = 没注入（独立预览 / 单元测试）⇒ 不播徽标，发奖链路零变化。
     */
    private heroProgressSource: ITerritoryHeroProgressSource | null = null;
    /** 底栏英雄按钮上方的徽标（惰性创建，页面销毁时 dispose）。 */
    private heroBadge: HeroFragmentBadge | null = null;

    /** 组合层注入英雄进度查询；纯表现能力，不接也不影响任何玩法。 */
    setHeroProgressSource(source: ITerritoryHeroProgressSource | null): void {
        this.heroProgressSource = source;
    }

    /** Composition supplies presentation resources before mounting the page. */
    initialize(resources: IControllerResources, saveOwner: ITerritorySaveOwner | null = null): void {
        this.controllerResources = resources;
        this.saveOwner = saveOwner;
        EventMgr.instance.on(TerritoryViewEvent.Render, this.onRender, this);
        EventMgr.instance.on(TerritoryViewEvent.Command, this.onCommand, this);
        void this.loadHexFlipAssets();
        void this.loadResourceGainIcons();
        void this.loadChestArt();
        void this.loadCloudArt();
    }

    /**
     * 「云」的几套图：`image/territory/cloud/` 下按前缀分组。
     *
     * · `cloud_body_0` / `cloud_shadow_0` = 未解锁的**静止**云体与影子（地图用，各一张）；
     * · `cloud_dissolve_body_0…1` / `cloud_dissolve_shadow_0…1` = 解锁消散（地图用，各两帧）；
     * · `cloud_idle_0…4` = 美术源图（= 云体 + 影子烤在一起的合并图，**运行时不用**）。
     *
     * ⚠️ **必须按前缀分开、各自按文件名排序**：`loadDir` 返回顺序不保证（同族坑见
     * `loadHexFlipAssets`），混在一个数组里按名排序会让 `cloud_dissolve_*` 排到
     * `cloud_body_*` 之前，帧序就整体错位了。
     *
     * 🔴 盖层（过场那层）用**云体** `cloud_body_*`，不是 `cloud_idle_*`：
     *    合并图把影子烤进了每朵云里，密铺时每朵的黑影都盖在邻居的白云体上 ⇒ 整屏发灰
     *    （用户 2026-11-02 晚上实机截图，整屏均值 147；领地正常页 231）。
     *    地图不显灰是因为它把影子**全部抽到云体之下**（`CloudShadow` 一层），而不是逐朵叠。
     *
     * 一张都取不到 ⇒ 整条表现关闭（地图照常渲染、过场退回推镜），并打一条 warn ——
     * 刚加的图忘了刷新资源库时能一眼看到原因，而不是"云神秘消失"。
     */
    private async loadCloudArt(): Promise<void> {
        const groups = {
            body: 'cloud_body_',
            shadow: 'cloud_shadow_',
            dissolveBody: 'cloud_dissolve_body_',
            dissolveShadow: 'cloud_dissolve_shadow_',
        } as const;
        let frames: SpriteFrame[] = [];
        try {
            frames = (await this.assets.loadDir(TERRITORY_CLOUD_ART_ROOT, SpriteFrame) ?? [])
                .filter((frame) => !!frame?.name);
        } catch {
            // 目录整个没导入 ⇒ 下面统一按"全是空数组"降级。
        }
        const pick = (prefix: string): SpriteFrame[] => frames
            .filter((frame) => frame.name.startsWith(prefix))
            .sort((a, b) => a.name.localeCompare(b.name));
        if (!this.isValid) return;
        const body = pick(groups.body);
        if (!body.length) {
            console.warn('[MainTerritoryMap] 未解锁云帧缺失（image/territory/cloud/'
                + 'cloud_body_0 / cloud_shadow_0…），章节地图不盖云；若是刚加的图，请在资源管理器里刷新一次让编辑器导入');
        }
        this.mapView.setCloudFrames({
            body,
            shadow: pick(groups.shadow),
            dissolveBody: pick(groups.dissolveBody),
            dissolveShadow: pick(groups.dissolveShadow),
        });
        // 盖层与地图云体**同一组帧**：要的正是"白的那一层"，不是 `cloud_idle_*` 合并图。
        this.mapView.setBattleCloudFrames(body);
    }

    /**
     * 飘字要用的两张资源图标（银币 `resId 7` / 体力 `resId 9`）。
     *
     * 与翻格资源**分开 try**：缺图只让那条飘字没有图标（数字照常升起），
     * 不该把翻格表现一起废掉。
     */
    private async loadResourceGainIcons(): Promise<void> {
        const names = new Map<number, string>([
            [TERRITORY_SILVER_RES_ID, '图标_铜币'],
            [TERRITORY_STAMINA_RES_ID, '图标_体力'],
        ]);
        const frames = new Map<number, SpriteFrame | null>();
        await Promise.all(Array.from(names, async ([resId, name]) => {
            try {
                frames.set(resId, await this.assets.load(
                    spriteFramePath(RESOURCE_ICON_ART_ROOT, name), SpriteFrame));
            } catch {
                frames.set(resId, null);
            }
        }));
        if (!this.isValid) return;
        this.mapView.setGainIcons(frames);
        // 「玩家关卡」弹窗两颗按钮的费用图标 = **体力**（2026-11-04 山猫：「这里是扣体力不是扣银币」）。
        // 与「关卡界面」主按钮同一枚图；页面统一加载，弹窗不解表。
        if (this.playerStagePanel) this.playerStagePanel.setCostIcon(frames.get(TERRITORY_STAMINA_RES_ID) ?? null);
        // 「关卡界面」主按钮写的是**体力**消耗（2026-10-28 用户要求换图标）⇒ 存一份给 `levelInfoContentOf`。
        this.staminaIcon = frames.get(TERRITORY_STAMINA_RES_ID) ?? null;
        // 图标晚于弹窗到达（理论上不会，页面初始化就跑这条）⇒ 已开着的关卡界面重贴一次，
        // 否则会一直留着 prefab 里的硬币占位图。
        const info = this.state?.detail.levelInfo;
        const opened = PopupManager.inst.get(LevelInfoPanel);
        if (info && opened) opened.applyContent(this.levelInfoContentOf(info));
    }

    /**
     * 开箱动画的宝箱美术：**补帧序列** `image/territory/chest/chest_seq_0 … chest_seq_5`。
     *
     * 第 0 张是**闭合**的宝箱（就是地图格子上那只会发光的箱子），最后一张是**开盖**的
     * （策划给的 `zw_0005`）。中间帧由 `tools/gen_chest_open_frames.py` 离线烘焙 ——
     * 需求（2026-10-22 §2）要的「点击打开时切换成开盖图 + 补帧」就是这条序列，
     * 视图只按 `territoryChestOpenFrame` 取第几张，运行时不合成图像。
     *
     * 降级分两级（都不阻断）：
     *  ① 中间帧缺几张 ⇒ 只用手上这几张（少几帧，仍然会开到全盖）；
     *  ② 一张都取不到 ⇒ 整体没有箱体（光效 / 图标 / 飘字照播、奖励照发），并打一条 warn，
     *     换图后忘了刷新资源库时能一眼看到原因（而不是"宝箱神秘消失"）。
     */
    private async loadChestArt(): Promise<void> {
        const names = Array.from(
            { length: TERRITORY_CHEST_OPEN_FRAMES },
            (_, index) => `chest_seq_${index}`,
        );
        const loaded = await Promise.all(names.map(async (name) => {
            try {
                return await this.assets.load(spriteFramePath(TERRITORY_CHEST_ART_ROOT, name), SpriteFrame);
            } catch {
                return null;
            }
        }));
        if (!this.isValid) return;
        const frames = loaded.map((frame) => frame ?? null);
        if (!frames.some((frame) => frame !== null)) {
            console.warn('[MainTerritoryMap] 宝箱补帧序列缺失（image/territory/chest/chest_seq_0…'
                + `${TERRITORY_CHEST_OPEN_FRAMES - 1}），只播光效；若是刚加的图，`
                + '请在资源管理器里刷新一次让编辑器导入');
        }
        this.mapView.setChestArt(frames);
    }

    /**
     * 领地翻格表现要用的资源 —— 与对局**同一份** `shaders/hex-flip` + `image/effects/hex_ground_glow`。
     *
     * 走 `AssetService`（不在 view 里直调 `resources.load`）。取不到只是不播翻转 / 不画底光
     * （地图照常渲染、奖励照常发放），所以失败**静默**：不提示、不阻断进入页面。
     * 两者**分开 try**：透视材质挂了不该把底光一起废掉。
     */
    private async loadHexFlipAssets(): Promise<void> {
        try {
            const effect = await this.assets.load('shaders/hex-flip', EffectAsset);
            if (!this.isValid) return;
            this.mapView.setFlipEffect(effect ?? null);
        } catch {
            // 透视材质缺失：降级成等比压扁（`TerritoryHexFlip` 自己回退）。
        }
        try {
            const frames = await this.assets.loadDir(HEX_GROUND_GLOW_ART_ROOT, SpriteFrame);
            if (!this.isValid) return;
            // 🔴 按**文件名**排序：`loadDir` 的返回顺序不保证是帧序，直接按下标切帧会乱序。
            this.mapView.setGroundGlowFrames((frames ?? [])
                .filter((frame) => !!frame?.name)
                .sort((a, b) => a.name.localeCompare(b.name)));
        } catch {
            // 序列帧缺失：只翻格、不画底光。
        }
    }

    onLoad(): void {
        // 「玩家关卡」弹窗（异步据点）与站点详情同层、互斥显示：
        // 两者共用 DETAIL_CLOSE / DETAIL_START，玩家关卡多一条 DETAIL_SCOUT。
        const stageNode = instantiate(this.playerStagePrefab);
        stageNode.setParent(this.node);
        stageNode.setPosition(Vec3.ZERO);
        this.playerStagePanel = stageNode.getComponent(BigMapPlayerLevelPanel);
        // 面板自己的根节点挂四边对齐 Widget，交给引擎撑满；这里只传一份设计尺寸做兜底缩放。
        const pageSize = this.node.getComponent(UITransform)?.contentSize;
        this.playerStagePanel.initialize(pageSize?.width ?? 0, pageSize?.height ?? 0, null);
        this.playerStagePanel.close();

        // 关卡 / 首领的两个弹窗走 `PopupBase`（`PopupManager` 负责层级栈、遮罩、点击空白关闭、
        // 尺寸拉伸），页面**不实例化、不撑尺寸**，只在需要时 open / applyContent / close。
        //   · 感叹号 → `LEVEL_TIP_OPEN`，打开提示时下层关卡界面自动收 `onCover`；
        //   · 提示关闭只派发 `LEVEL_TIP_CLOSE`（不连带下面的关卡界面）。

        // ⚠️ 留白必须在 `initialize` **之前**注入：内容层偏移（(bottom − top)/2）在它里面写第一次。
        this.syncMapInsets();
        this.bindMapInsetResize();
        this.mapView.initialize();
        // 开箱表演期间锁滚动（需求 2026-10-22 §4）：表演挂在**页面坐标**上，而地图是 ScrollView
        // 的 content —— 播放时拖一下地图，宝箱就和地块错位了（实机 screenshot-3）。
        // 关 `ScrollView.enabled` 会一并摘掉拖拽监听，比改 `vertical/horizontal` 干净。
        this.mapView.scrollLock = (locked) => {
            if (this.mapScrollView?.isValid) this.mapScrollView.enabled = !locked;
        };

        if (!this.controllerResources) {
            throw new Error('[MainTerritoryMap] 页面挂载前必须注入展示资源');
        }
        // 防御：章节若在 onLoad 前已就绪（如重进复用），立即补一次完整绘制。
        EventMgr.instance.emit(TerritoryUiEvent.Ready);
    }

    start(): void {
        EventMgr.instance.emit(VIEW_LIFECYCLE, { owner: this, phase: 'ready' });
    }

    /** 宿主在挂载前传入返回地块，首个就绪画面消费一次。 */
    setFocusCell(chapterId: number, cellId: number): void {
        this.focusCell = { chapterId, cellId };
    }

    onDestroy(): void {
        // 徽标挂在 `BottomNav`（页面外层的兄弟节点），不会随本页子节点自动销毁 ⇒ 必须手动收。
        this.heroBadge?.dispose();
        this.heroBadge = null;
        // 飞舞奖励图标的顶层宿主挂在 `MainRoot`（本页之外），由视图建、由视图收：
        // 页面只负责通知，不自己搭 UI（架构守卫禁止 `new Node` / `addComponent`）。
        this.mapView?.disposeRewardFxLayer();
        this.heroProgressSource = null;
        this.mapView?.setHeroRewardLandedHandler(null);
        EventMgr.instance.emit(TerritoryUiEvent.Disposed);
        EventMgr.instance.emit(VIEW_LIFECYCLE, { owner: this, phase: 'destroyed' });
        // 「等流程接手」的订阅必须自己摘：它是挂在全局 ProcedureManager 上的，
        // 页面都没了还留着，下一次别的流程切换失败会回调到一个死节点上。
        this.stopBattleSwitchWatch();
        this.closePopup(LevelTipPanel);
        this.closePopup(LevelInfoPanel);
        EventMgr.instance.offTarget(this);
        this.battleReady = null;
        // 开箱表演正在播 ⇒ 收起（`stop` 不回调结算；页面都要没了，结算已由 Controller 落库）。
        this.mapView?.stopChestPlay();
        // `view` 是全局单例，不摘会随页面复用累积回调（每次进来多跑一次重量）。
        view?.off?.('canvas-resize', this.onCanvasResize, this);
        this.mapInsetResizeBound = false;
        // ⚠️ 这里不再对子节点调 `off(...)`：`Node._onPreDestroyBase()` 先销毁子节点、
        // 再跑本函数，节点销毁时 EventTarget 已释放，监听不泄漏；引擎这版 `Node.off` 不判空，
        // 手动摘必抛。同族规则见 docs/AI架构与代码规范.md §7.2。
    }

    // ============================================================
    // 渲染（Passive View：幂等全量赋值，不读上一次状态）
    // ============================================================

    private sendIntent(intent: TerritoryIntent): void {
        EventMgr.instance.emit(TerritoryUiEvent.Intent, { intent });
    }

    private onRender(event: ITerritoryRenderEvent): void {
        this.state = event.state;
        this.renderAll();
    }

    private onCommand(event: ITerritoryCommandEvent): void {
        const command = event.command;
        switch (command.kind) {
            case 'navigate': this.battleReady = command.ready ?? null; this.onNavigateToBattle(command.payload); break;
            case 'tip': this.onShowTip(command.payload); break;
            case 'rewards': this.onShowRewards(command.payload); break;
            case 'busy': this.onSetBusy(command.payload); break;
            case 'prepareBattle': this.sessionAssets.pauseWarmup?.(); break;
            case 'focusCell': if (this.state) this.scrollToCell(command.cellId, this.state.layout); break;
            // 玩家点了章节按钮（含章节选择弹窗里回到已通过的章节）⇒ 播「镜头上移、新章居中」。
            case 'chapterSwitch': this.beginChapterSwitch(command.fromChapterId, command.toChapterId); break;
        }
    }

    private onNavigateToBattle(payload: ITerritoryNavigateBattlePayload): void {
        // 有效回包已被 Controller 接受，此时关闭详情不会作废在途开战请求。
        // 弹窗挂在全局 PopupManager 下，必须在战斗流程接手时主动收起。
        this.closePopup(LevelTipPanel);
        this.closePopup(LevelInfoPanel);
        // 一次开战只跳一次：过场 / 前奏已经拿到去向之后再来一条 navigate
        //（服务端推送 / 迟到回包）一律丢弃。
        // 🔴 别用 `battleApproachPending` 当这道判据：`onSetBusy` 在**开战请求在途**时
        //    就起演了整页过场并将它置 true，回包后本该交给过场的那条 navigate 会被一起吞掉
        //    ⇒ 过场 `hold` 等不到 nav、3s 后判取消；而会话资源照常加载完（日志停在
        //    「[BattleLoading] 首帧资源准备完成」），玩家却永远进不了战斗、全程零报错。
        //    症状是「首次解锁直开那一波能进，之后重复挑战 / 下一关都进不去」。
        if (this.battleIntro?.nav || this.battlePrelude) return;
        // 🔴 首次解锁直开（`approach`）：「① 关卡地块生成 → ② 镜头推进 + 提示条 → ③ 云层过场」
        //    （用户 2026-11-02）。这条分支必须排在 `startBattleIntro()` **之前** ——
        //    云一旦先盖上来，前两段就全在云后面演，玩家什么都看不见。
        if (payload.approach) {
            this.beginBattlePrelude(payload);
            return;
        }
        // 过场已经开演（请求在途时由 `busy` 起的手）⇒ 交给它，回包就是"可以走了"的信号。
        if (this.battleIntro) {
            this.releaseBattleIntro({ route: 'battle', payload });
            return;
        }
        // 手按开战这条没有在途请求 ⇒ 就地开演（`out` 0.55s 后自己进 `in`，不等任何人）。
        if (this.startBattleIntro()) {
            this.releaseBattleIntro({ route: 'battle', payload });
            return;
        }
        // 云盖层建不出来（云美术没加载上 / 拿不到地图中心）⇒ 没有过场可播，直接走。
        this.commitBattleNav({ route: 'battle', payload });
    }

    /**
     * 「首次解锁直开」的前奏（用户 2026-11-02）：
     *
     * > 1. 首先播放关卡地块生成
     * > 2. 镜头推进，播放触发战斗提示条
     * > 3. 再播放云层的过渡动画
     *
     * 为什么单独一段：这条路的解锁回包**同时**带来"一批新地块"和"马上开战"。旧代码在
     * `busy` 那一刻就把云盖上了（`onSetBusy`），于是地块生成整段都在云后面演 —— 白做；
     * 而推镜 + 提示条也被云顶掉（`out` 段就把 HUD 推出去了）。现在按顺序排开，
     * 云留在最后，正好接上"云散开露出战场"那一段。
     */
    private battlePrelude: {
        stage: 'spawn' | 'approach';
        elapsed: number;
        payload: ITerritoryNavigateBattlePayload;
        /** 宽限期里**见过**地块生成在播（见过就必须等它播完）。 */
        seenSpawn: boolean;
    } | null = null;

    // ============================================================
    // 章节切换转场（2026-11-04）
    // ============================================================

    /**
     * 起演「镜头上移、新章居中」的切章转场。
     *
     * 只有**玩家点章节按钮**（含章节选择弹窗里回到已通过的章节）才会走到这里：
     * 模型发的 `chapterSwitch` 命令只在 `switchChapter` / `selectChapter` 里发，
     * 通关后自动推进那条路**不发**（用户原话：「玩家只能通过章节按钮播放切换动画」）。
     *
     * 演不了（云美术没加载 / 在演整页过场）就**什么都不做** —— 模型那边已经把章换了，
     * 页面照常换图，只是没有这段动画。宁可没动画，也不要盖一片空底色。
     */
    private beginChapterSwitch(fromChapterId: number, toChapterId: number, deferRender = false): void {
        if (!territoryChapterSwitchWanted(fromChapterId, toChapterId)) return;
        if (!this.mapView?.isValid) return;
        if (this.chapterSwitch) return;
        // 手动切章一到，旧的首通待播标记作废（去向由这次点击说了算）。
        this.chapterClearFollowup = false;
        if (!this.mapView.beginChapterSwitch()) return;
        const [, height] = this.battleIntroViewport();
        this.chapterSwitch = {
            from: fromChapterId,
            to: toChapterId,
            // 先走相机（云还没出来），再合拢 —— 2026-11-05 用户口径。
            phase: 'lead',
            elapsed: 0,
            rise: territoryChapterSwitchRise(height),
            deferRender,
        };
        // 第一帧就写：`lead(0)` 是"云还在画面外、地图没动"的原样，读作无缝起手。
        this.writeChapterSwitchLead(0);
    }

    /** 转场每帧推进（`update` 里调；它自己不碰 `battleIntro` / `battlePrelude` 的任何字段）。 */
    private stepChapterSwitch(step: number): void {
        const transition = this.chapterSwitch;
        if (!transition) return;
        // 云在等新章的那几秒也不能冻住（`cloud_idle_*` 待机循环，只换帧不动位置）。
        this.mapView?.stepChapterSwitchCover(step);
        transition.elapsed += step;
        if (transition.phase === 'lead') {
            const progress = territoryChapterSwitchLeadProgress(transition.elapsed);
            this.writeChapterSwitchLead(progress);
            if (progress >= 1) {
                transition.phase = 'cover';
                transition.elapsed = 0;
            }
            return;
        }
        if (transition.phase === 'cover') {
            const progress = territoryChapterSwitchCoverProgress(transition.elapsed);
            this.writeChapterSwitchFx(progress);
            if (progress >= 1) {
                transition.phase = 'wait';
                transition.elapsed = 0;
            }
            return;
        }
        if (transition.phase === 'wait') {
            // 新章**画上来了**才揭幕（判据见 `territoryChapterSwitchReadyToReveal`：
            // 看的是 `lastRenderedChapter`，不是 `state.chapterId` —— 后者在加载一开始就改了）。
            if (territoryChapterSwitchReadyToReveal(this.lastRenderedChapter, transition.to)) {
                transition.phase = 'reveal';
                transition.elapsed = 0;
                return;
            }
            // 加载失败：模型把章号退回旧章 ⇒ 当这次没发生，收场（云不能永远盖着）。
            const state = this.state;
            if (state && state.ready && state.chapterId === transition.from) {
                this.endChapterSwitch();
                return;
            }
            if (transition.elapsed >= TERRITORY_CHAPTER_SWITCH_WAIT_MAX_SECONDS) {
                console.warn('[ChapterSwitch] 等新章节加载超时，直接收场');
                this.endChapterSwitch();
            }
            return;
        }
        const progress = territoryChapterSwitchRevealProgress(transition.elapsed);
        this.writeChapterSwitchFx(1, progress);
        if (progress >= 1) this.endChapterSwitch();
    }

    /**
     * 写一帧「相机先行」姿态（`lead` 段）。
     *
     * 这一段**云还在画面外**（`cover` 进度恒 0：`spread` 保持初始、透明度 0），只有整张
     * 地图在快速上移。用户 2026-11-05：「相机先向上快速移动 0.1s 后，云层遮挡动画再开始播放」
     * —— 先让玩家看见"画面被带着往上走"，再让云盖上来，两件事分开读得清。
     *
     * @param progress `lead` 段进度（0~1）
     */
    private writeChapterSwitchLead(progress: number): void {
        const transition = this.chapterSwitch;
        const mapView = this.mapView;
        if (!transition || !mapView) return;
        const fx = territoryBattleIntroOutFxAt(0);
        mapView.applyChapterSwitchCover(fx.coverSpread, 0, 0);
        mapView.setChapterSwitchOffset(territoryChapterSwitchSinkOffset(progress, transition.rise));
    }

    /**
     * 写一帧转场姿态。
     *
     * @param coverProgress `cover` 段进度（0~1）
     * @param revealProgress `reveal` 段进度（0~1）；`undefined` = 还在合拢段
     *
     * 合拢段与揭幕段共用 `TerritoryBattleIntro` 的两条云曲线（`out` / `in`）：
     * 同一个云盖层、同一批点阵，换一段只是把 `(spread, opacity, release)` 换一条曲线，
     * 不用第二套美术，也不会出现"两种云"。
     */
    private writeChapterSwitchFx(coverProgress: number, revealProgress?: number): void {
        const transition = this.chapterSwitch;
        const mapView = this.mapView;
        if (!transition || !mapView) return;
        if (revealProgress === undefined) {
            // 合拢：云从画面外收到就位（`spread` 2.2 → 1、透明度 0 → 1）。
            const fx = territoryBattleIntroOutFxAt(coverProgress);
            mapView.applyChapterSwitchCover(fx.coverSpread, fx.coverOpacity, 0);
            // 相机在 `lead` 段已经走到位了，这里**每帧写同一个常量**（停下不动）。
            // 🔴 别换成按 `coverProgress` 再插值一次 —— 那会从 0 重新算起，画面往回弹一下。
            mapView.setChapterSwitchOffset(territoryChapterSwitchSinkDistance(transition.rise));
            return;
        }
        // 揭幕：新章从上方落回居中，云同时往四周散开 + 逐朵淡出。
        const fx = territoryBattleIntroInFxAt(revealProgress);
        mapView.applyChapterSwitchCover(fx.coverSpread, 1, fx.coverRelease);
        mapView.setChapterSwitchOffset(territoryChapterSwitchRevealOffset(revealProgress, transition.rise));
    }

    /** 转场收工（正常播完 / 加载失败 / 页面被销毁都走它，幂等）。 */
    private endChapterSwitch(): void {
        this.chapterSwitch = null;
        this.mapView?.endChapterSwitch();
    }

    private beginBattlePrelude(payload: ITerritoryNavigateBattlePayload): void {
        // 🔴 极端并发：别的开战请求（同屏另一格）已经把云盖上来了、整页过场正在演。
        //    前两段这时候补不了（云已经挡住画面），但也**绝不能干等** —— 过场的 `hold`
        //    在等 `nav`，这里不交出去就要硬等到 `HOLD_MAX` 3s 然后判取消、把界面还回去，
        //    玩家等于点了一下没进去。 ⇒ 直接把去向交给它，让它自己散场。
        if (this.battleIntro) {
            this.releaseBattleIntro({ route: 'battle', payload });
            return;
        }
        if (this.battlePrelude) return;
        this.battleApproachPending = true;
        // 弹窗先关（与整页过场同一口径：「先关闭弹窗，再播放过场动画」）。
        this.closeBattleIntroPopups();
        // 前奏两段都不许再点：推镜自己会锁输入，地块生成那 0.7s 没有镜头动画，
        // 只靠 `setInputLocked` 会被下一帧的自动解锁放掉 ⇒ 用前奏那把锁。
        this.mapView?.setPreludeLock(true);
        this.battlePrelude = { stage: 'spawn', elapsed: 0, payload, seenSpawn: false };
    }

    /** 前奏每帧推进；它跑的时候整页过场还没开演（`battleIntro` 为空）。 */
    private stepBattlePrelude(
        prelude: NonNullable<typeof this.battlePrelude>,
        step: number,
    ): void {
        const mapView = this.mapView;
        prelude.elapsed += step;
        if (prelude.stage === 'spawn') {
            // ① 等这一批新地块播完（`0` = 没在播：宽限期过了就认"这一局没有新地块"）。
            const remaining = mapView?.hexSpawnRemainingSeconds() ?? 0;
            if (remaining > 0) prelude.seenSpawn = true;
            if (!territoryBattlePreludeSpawnSettled(prelude.elapsed, remaining, prelude.seenSpawn)) return;
            // ② 镜头推进 + 「遭遇敌人，即将开始战斗」提示条（同一刻起）。
            prelude.stage = 'approach';
            prelude.elapsed = 0;
            FW.showTip(TERRITORY_TEXTS.battleApproach);
            const started = mapView?.playBattleApproach(prelude.payload.pve.territoryCellId) ?? false;
            // 播不了（格子不在视口 / 覆盖层没建）⇒ 不白等 1.2 秒，直接进第三段。
            if (!started) prelude.elapsed = TERRITORY_BATTLE_PRELUDE_APPROACH_SECONDS;
            return;
        }
        // ② → ③ 的交界必须确认推镜**已经收尾**：它和云写的是同一个 `MapLayer`，
        // 推镜还没还原就去量基准，云会盖在一张被放大过的地图上。
        if (!territoryBattlePreludeApproachSettled(prelude.elapsed, mapView?.isBattleApproachPlaying ?? false)) return;
        // ③ 云层过场（原来 `onNavigateToBattle` 里那条路，顺序没变，只是被推迟到这里）。
        const nav: ITerritoryBattleIntroNav = { route: 'battle', payload: prelude.payload };
        this.battlePrelude = null;
        this.battleApproachPending = false;
        // 前奏这把锁交给过场：`beginBattleIntro` 自己会 `setInputLocked(true)`。
        this.mapView?.setPreludeLock(false);
        if (this.startBattleIntro()) {
            this.releaseBattleIntro(nav);
            return;
        }
        // 云美术没加载上 ⇒ 没有过场可播。推镜已经播过了，直接走。
        this.commitBattleNav(nav);
    }

    /** 真正把玩家交给流程（过场前后都走这一条，保证只有一处 `ProcedureManager.navigate`）。 */
    /**
     * 这条去向要"把云交接过去"吗（而不是自己散场后再跳）？
     *
     * 只有**领地普通关**是：它去匹配页，而匹配页底下要铺同一屏云。其余两条不走这条：
     *  · 塔防 / boss 关（`mode = defence`）直进战场，没有匹配页，云得自己散完再跳；
     *  · 宝箱栏的「战斗」格是 PVP 匹配，跟领地无关，没有云可交接。
     */
    private isCoverHandover(nav: ITerritoryBattleIntroNav): boolean {
        return nav.route === 'battle' && nav.payload.pve.mode === 'match' && !!nav.payload.battleParams;
    }

    private commitBattleNav(nav: ITerritoryBattleIntroNav): void {
        // 宝箱匹配：没有战报 payload、也没有要移交的预加载，直接进匹配页。
        if (nav.route === 'matching') {
            ProcedureManager.navigate(GameRoute.Matching, nav.entry);
        } else if (nav.payload.pve.mode === 'match' && nav.payload.battleParams) {
            // 普通关（`mode = match`）先进**匹配界面**（用户 2026-11-02：「点击关卡后没有进到
            // 匹配界面，直接进了战场」）。开战请求由匹配页发，领地只把 `battleParams` 交出去。
            //
            // `pve` 必须原样捎上：匹配页自己不认识它，只在跳战场时透传
            // （见 `MatchingComposition.mount` 的 `navigate` 包装）。没有它，战斗页拿不到
            // 波次 / 敌阵 / `territorySaveOwner` ⇒ 打完这一关也不回写领地进度。
            ProcedureManager.navigate(GameRoute.Matching, {
                battleType: ZC_BATTLE_TYPE_CHAPTER,
                battleParams: nav.payload.battleParams,
                pve: nav.payload.pve,
                // 待机步进带过去，匹配页那层云接着同一拍循环 —— 不带的话切过去整屏云会"换一次脸"。
                coverStep: this.mapView?.battleIntroCoverStep ?? 0,
                // 视口尺寸也要带：领地这边量的是地图视口，和 `view.getVisibleSize()` 不一定相等。
                coverViewport: this.mapView?.battleIntroCoverSize,
            });
        } else {
            // 首领关（`mode = defence`，塔防类）不经过匹配，直进战场（用户同日补充）。
            EventMgr.instance.emit(TerritoryUiEvent.Intent, { intent: { kind: 'enterBattle', payload: nav.payload } });
        }
        // ⚠️ 订阅必须在 `navigate` **之后**（同一帧）：`changeProcedure` 开头会
        //    `cancelPendingSwitch()`，那一下会把**上一次**切换的失败同步播给所有订阅者 ——
        //    先订阅就会把它误读成本次失败，白白把过场收掉。
        this.watchBattleSwitch();
    }

    /** 「已发出跳转、等流程接手」阶段的订阅句柄（`null` = 没在等）。 */
    private battleSwitchWatch: (() => void) | null = null;

    /**
     * 盯住这次流程切换的**落定**结果。
     *
     * 为什么必须有：`navigate` 只是把切换排上，真正切走要等预加载。以前这段失败是**静默**的
     * —— 只有一条 `[ProcedureManager] 流程预加载失败`，玩家那边是「雾停在半空、过一会儿
     * 又回到领地」（兜底定时器还原），看起来和"点了没反应"没区别。
     * 现在要么切走（什么都不用做），要么当场把主界面还回去 + 说一句为什么没进去。
     */
    private watchBattleSwitch(): void {
        this.stopBattleSwitchWatch();
        this.battleSwitchWatch = ProcedureManager.onSwitchSettled((entered) => {
            this.stopBattleSwitchWatch();
            if (entered) {
                // 真的切走了：主界面马上会被 `onLeave` 卸掉，留个兜底定时器反而可能在
                // 交接的空档把 UI 弹回来，先把它作废。
                this.battleIntroLeftover = null;
                // 🔴 一次性门闩在**成功**路径也要复位：旧实现只在失败/收工
                //    （`restoreBattleIntroScene`）里清，成功切走时留着 true ⇒ 页面若被复用，
                //    下一次开战的 navigate 会被静默丢掉。
                this.battleApproachPending = false;
                return;
            }
            // 预加载失败 / 被别的切换顶掉 / 路由没注册 —— 这一局是进不去了。
            this.failBattleIntro('战斗流程没有接手（预加载失败或被其他切换顶掉）');
        });
    }

    private stopBattleSwitchWatch(): void {
        this.battleSwitchWatch?.();
        this.battleSwitchWatch = null;
    }

    /**
     * 战斗（或匹配）页最终没起来：把主界面**立刻**还回去，并让玩家知道这一下没成。
     *
     * 三件事缺一不可：
     *  · 把 HUD / 地块 / 云盖层复位、放开输入锁；
     *  · `cancelBattleStart` —— model 侧的 `startingBattle` 不复位的话，
     *    `requestBattle` 第一道 `if (this.startingBattle) return` 会把「开始战斗」变成死按钮；
     *  · 提示 —— 不然玩家只会看到"过场演完了我又回到领地了"。
     */
    private failBattleIntro(reason: string): void {
        console.warn(`[BattleIntro] ${reason}，退回领地界面`);
        // 兜底定时器那条路进来时订阅还挂着，这里一并摘掉（幂等）。
        this.stopBattleSwitchWatch();
        // 前奏（地块生成 / 推镜）里失败也要收干净：它那把输入锁不是过场那把。
        this.abortBattlePrelude();
        // 两种时机都要兜住：`in` 段还没播完（`battleIntro` 还在），或者已经交给
        // `abandonBattleIntro`（只剩 `battleIntroLeftover`）。HUD 句柄必须原样传回去，
        // 否则被推出去的底栏 / 顶栏永远回不来。
        const hud = this.battleIntro?.hud ?? this.battleIntroLeftover?.hud ?? [];
        this.battleIntro = null;
        this.battleIntroLeftover = null;
        this.restoreBattleIntroScene(hud);
        this.sendIntent({ kind: 'cancelBattleStart' });
        FW.showTip(TERRITORY_TEXTS.battleEnterFailed);
    }

    private onShowTip(payload: ITerritoryShowTipPayload): void {
        // 前奏里收到提示 ⇒ 这条开战链路已经断了（服务端拒绝 / 资源不足），别让地块生成
        // 和推镜继续演下去，直接把画面还给玩家。
        if (this.battlePrelude) this.abortBattlePrelude();
        // 过场还盖着整屏、输入也锁着 ⇒ 此刻的提示只可能来自这条开战链路
        // （资源不足 / 被服务端拒绝）。没有"反向过场"这种少见路径要演，直接复位放开玩家。
        if (this.battleIntro && !this.battleIntro.navigated) this.finishBattleIntro();
        FW.showTip(payload.text);
    }

    /** 丢掉前奏状态并放开那把输入锁（失败 / 被打断时用；幂等）。 */
    private abortBattlePrelude(): void {
        if (!this.battlePrelude) return;
        this.battlePrelude = null;
        this.battleApproachPending = false;
        this.mapView?.setPreludeLock(false);
    }

    private onShowRewards(payload: ITerritoryShowRewardsPayload): void {
        this.presentRewards(payload.rewards, payload.originCellId, payload.options);
    }

    private onSetBusy(payload: ITerritorySetBusyPayload): void {
        // 写请求在途 = 全屏 loading 遮挡（引用计数，多个并发请求只显一层）：
        // 请求期间玩家点不到地图/按钮，从源头防「服务端还没响应就快速连点」。
        if (payload.busy) {
            // 「开战校验」这条请求在途 ⇒ 先把整页过场演起来（需求 2026-11-02 第 3 条：
            // 雾合拢后**静止等回包**）。按文案认这条请求：`busyBattle` 只在领地 model 层的
            // `startBattle` / `unlockThenStartBattle` 里出现过，别的请求各有各的文案。
            //
            // 🔴 但「首次解锁直开」那一路例外（`payload.approach`）：它回包后要先播
            // 「① 关卡地块生成 → ② 镜头推进 + 提示条 → ③ 云层过场」（用户 2026-11-02），
            // 云必须留到最后 —— 这里盖上去，前两段就全在云后面演了。
            if (payload.text === TERRITORY_TEXTS.busyBattle && payload.approach !== true && this.startBattleIntro()) {
                // 🔴 过场接手了就不再叠全屏 loading（弹窗层在最上面）：
                //    它会把 `out`（UI 推出 + 雾合拢）和 `hold`（静止等回包）整段盖掉，
                //    玩家只看得见最后那点雾散 —— 等于过场白做。遮罩原本干的"挡连点"这件事，
                //    过场已经用 `setInputLocked(true)` 接管了（`beginBattleIntro` 里）。
                this.battleBusyHiddenLoading = true;
                return;
            }
            LoadingPopup.show(payload.text);
            return;
        }
        // 上一次 `busyBattle` 由过场接管、**没真的 show** ⇒ 这一次也不许 hide：
        // `LoadingPopup` 是全局引用计数，多减一次会把别的请求的遮罩提前撤掉。
        if (this.battleBusyHiddenLoading) {
            this.battleBusyHiddenLoading = false;
            return;
        }
        LoadingPopup.hide();
    }

    // ============================================================
    // 「进战斗 / 匹配」整页过场（需求 2026-11-02）
    // ============================================================

    /**
     * 每帧推进整页过场。没在演时只有一次 `null` 判断。
     *
     * 三段的状态机在这里，**曲线与常量全在** `model/TerritoryBattleIntro`：
     *
     *  · `out`：扣到 0.55s 后转 `hold`，并把 `hold` 的定格帧再写一次
     *    （保证"停在合拢末帧"这件事是显式的，不依赖上一帧恰好写到哪）；
     *  · `hold`：**位置/透明度一个都不写**（云停在合拢末帧），只有盖层的待机循环在换帧
     *    （`stepBattleIntroCover`）。`hold` 内部再分两段：
     *      - 没拿到 `nav` ⇒ 等服务器回包，超 `HOLD_MAX` 3s 判**取消**；
     *      - 拿到 `nav` 但目标页还没 ready ⇒ 继续盖着等资源，超 `READY_MAX` 12s **不判失败**、
     *        照样散场跳转（让战场页自己显示加载态）。
     *  · `in`：云散开；过 60% 发起跳转（只一次），播完复位。
     */
    update(dt: number): void {
        const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
        // 英雄碎片徽标：排在**所有早退之前**（下面过场 / 战斗前奏会 return），
        // 否则一个转场就能把整串队列卡住，后面的英雄永远不播。
        this.heroBadge?.step(step);
        // ① 整章云散演完了 ⇒ 把压住的那一帧新章补画上来（排在所有早退之前：
        //    换图这件事不能因为"过场在演"之类的分支被跳过）。
        if (this.chapterSwapPending) {
            // ①-a 整章云散（章节通过动画）还在演 ⇒ 一帧都不许动地图。
            if (this.mapView?.chapterClearPlaying) return;
            const followup = this.chapterClearSwitch;
            if (followup) {
                // ①-b 云散演完 ⇒ 接着起「相机上移、新章居中」的切换转场。
                this.chapterClearSwitch = null;
                this.beginChapterSwitch(followup.from, followup.to, true);
                if (!this.chapterSwitch) {
                    // 云美术没加载 / 整页过场占着 ⇒ 演不了就直接换章，绝不把玩家卡在旧图。
                    this.chapterSwapPending = false;
                    this.renderAll();
                    if (!this.isValid) return;
                }
                // 演得了 ⇒ 保持 chapterSwapPending，等 cover 走完由下面统一补画新章。
            } else if (!this.chapterSwitch?.deferRender) {
                // ①-c 普通换章（云散演完 / 没在演）：照旧补画。
                this.chapterSwapPending = false;
                this.renderAll();
                if (!this.isValid) return;
            }
        }
        // ② 切章转场（玩家点的 / 首通补起的）。它自己要靠新章画上来才能揭幕，所以排在①之后。
        if (this.chapterSwitch) {
            this.stepChapterSwitch(step);
            if (!this.isValid) return;
            const running = this.chapterSwitch;
            // 云已经盖满（cover 走完进 wait）⇒ 把压住的那一帧新章画上来，下一帧就能揭幕。
            if (running?.deferRender && this.chapterSwapPending
                && (running.phase === 'wait' || running.phase === 'reveal')) {
                running.deferRender = false;
                this.chapterSwapPending = false;
                this.renderAll();
                if (!this.isValid) return;
            }
        }
        // ③ 兜底：转场被超时 / 打断收掉了，压住的新章也必须补画，不能永远停在旧章。
        if (this.chapterSwapPending && !this.chapterSwitch) {
            this.chapterSwapPending = false;
            this.renderAll();
            if (!this.isValid) return;
        }
        // 「首次解锁直开」的前奏（地块生成 → 推镜 → 盖云）排在整页过场之前：
        // 它跑的时候 `battleIntro` 还没建，两段不会同时写 `MapLayer`。
        const prelude = this.battlePrelude;
        if (prelude) {
            this.stepBattlePrelude(prelude, step);
            return;
        }
        const intro = this.battleIntro;
        if (!intro) return;
        // 云盖层的待机循环**三段都要推**（尤其 `hold`：位置不动、云在呼吸）。
        // 只换帧、不碰位置，所以放在相位判断之前没有任何副作用。
        this.mapView?.stepBattleIntroCover(step);
        if (intro.phase === 'out') {
            intro.elapsed += step;
            const fx = territoryBattleIntroOutFx(intro.elapsed);
            this.writeBattleIntroFx(fx);
            if (fx.done) {
                intro.phase = 'hold';
                intro.held = 0;
                this.writeBattleIntroFx(territoryBattleIntroHoldFx());
            }
            return;
        }
        if (intro.phase === 'hold') {
            // 普通关（`mode = match`）：云**不散**，直接交给匹配页。
            // 匹配页在界面底下重建同一屏云（点阵确定性 + 待机步进接上），所以切过去那一帧
            // 画面不变；玩家看到的匹配界面始终盖在云上面，等匹配成功才露出云、再散开。
            // 这一段之前是"先散场再跳"，结果云散完到匹配页画出来之间会露出裸露的地图和底色
            // —— 用户 2026-11-02 拍的正是那一帧。
            if (intro.nav && this.isCoverHandover(intro.nav)) {
                this.commitBattleNav(intro.nav);
                if (!this.isValid) return;
                this.abandonBattleIntro();
                return;
            }
            if (intro.nav) {
                // 去向已知，但目标页可能还在加载（战场首帧实测 5 秒）⇒ 云继续盖着静止等，
                // 这一段**不套用** `HOLD_MAX`（那是"等回包"的超时）。
                if (intro.ready) {
                    intro.phase = 'in';
                    intro.elapsed = 0;
                    return;
                }
                intro.waited += step;
                if (intro.waited >= TERRITORY_BATTLE_INTRO_READY_MAX_SECONDS) {
                    // 超时不判失败：照样散、照样跳，让战场页自己显示加载态 ——
                    // 取消反而会把已经扣掉的资源白扣。
                    console.warn(`[BattleIntro] 等目标页资源超过 ${TERRITORY_BATTLE_INTRO_READY_MAX_SECONDS}s，先散场`);
                    intro.phase = 'in';
                    intro.elapsed = 0;
                }
                return;
            }
            intro.held += step;
            if (intro.held >= TERRITORY_BATTLE_INTRO_HOLD_MAX_SECONDS) this.finishBattleIntro();
            return;
        }
        intro.elapsed += step;
        const fx = territoryBattleIntroInFx(intro.elapsed);
        this.writeBattleIntroFx(fx);
        if (fx.navigate && !intro.navigated && intro.nav) {
            intro.navigated = true;
            this.commitBattleNav(intro.nav);
            if (!this.isValid) return;
        }
        if (fx.done) {
            // 已经交给战斗流程 ⇒ 不把主界面弹回来（预加载可能还要几十帧），只留兜底还原。
            // 没跳转（理论上不会有这条：`in` 只在有 payload 时才进）⇒ 立刻复位。
            if (intro.navigated) this.abandonBattleIntro();
            else this.finishBattleIntro();
        }
    }

    /**
     * 开演整页过场。
     *
     * @returns `true` = 已经开演（或本来就在演）；`false` = 演不了，
     *          调用方应退回推镜过场或直接跳转 —— 绝不能让云盖住一个不动的画面。
     */
    private startBattleIntro(): boolean {
        if (this.battleIntro) return true;
        if (!this.mapView?.isValid) return false;
        // 地图那半先起手（它会量基准、锁输入、建雾盖层）；失败就整个过场不做。
        if (!this.mapView.beginBattleIntro()) return false;
        // 用户 2026-11-02：「从弹窗这部分走过程需要先关闭弹窗，再播放过场动画」。
        // 弹窗不关，`out`（UI 推出 + 雾合拢）整段都在它后面 —— 玩家只看得见最后那点雾散。
        // 位置在 `beginBattleIntro()` **之后**：播不了时别白关玩家正在看的弹窗。
        this.closeBattleIntroPopups();
        this.battleIntro = {
            phase: 'out',
            elapsed: 0,
            held: 0,
            nav: null,
            ready: true,
            waited: 0,
            navigated: false,
            hud: this.collectBattleIntroHud(),
            pushPx: territoryBattleIntroPushPx(...this.battleIntroViewport()),
        };
        this.battleApproachPending = true;
        this.writeBattleIntroFx(territoryBattleIntroOutFx(0));
        return true;
    }

    /**
     * 关掉挡在过场前面的三个弹窗（关卡界面 / 关卡提示 / 玩家关卡面板）。
     *
     * 用户 2026-11-02：「从弹窗这部分走过程需要先关闭弹窗，再播放过场动画」。
     * 三个入口都汇到 `startBattleIntro` 这一处，所以这里关一次就全覆盖：
     *  · 弹窗里的「开始战斗」→ 请求在途时 `busy` 起演；
     *  · 地块上直接开战 → `navigate` 起演；
     *  · 宝箱栏的匹配格 → 本来就没有弹窗，`closePopup` 是空转。
     *
     * 关得掉的前提是 `PopupManager.close` **同步**（出栈 → 回收 / `destroy`），所以
     * 同一帧里"弹窗没了 + 过场第一帧（fx(0)，画面未动）"是连续的，读作"先关窗、再起演"。
     */
    private closeBattleIntroPopups(): void {
        // 🔴 顺序是硬要求：**先说「这是程序关的」，再关**。
        //    关卡界面的 `onClose` 会发 `closeDetail`，model 那边对它的默认解释是
        //    「玩家放弃了这一格」⇒ 换交互号 ⇒ 在途的开战回包被 `runCellWrite` 判成过期丢掉
        //    ⇒ 没有 `navigate` ⇒ 过场在 `hold` 干等 3 秒超时 ⇒ 复位回领地。
        //    2026-11-02 实测就是这个：回包日志明明打出来了，人却没进战斗。
        this.sendIntent({ kind: 'keepBattleRequest' });
        this.closePopup(LevelInfoPanel);
        this.closePopup(LevelTipPanel);
        // 玩家关卡面板不是 `PopupBase`（自带 `isOpen` / `close()`），单独关。
        if (this.playerStagePanel?.isOpen) this.playerStagePanel.close();
    }

    /**
     * 宝箱栏「战斗」格（→ 匹配）也走同一套整页过场（需求 2026-11-02 追加）。
     *
     * 与领地格点开战的区别只有一处：这条**没有在途请求**（`MainPage.onChestAction` 原本
     * 是直接 `ProcedureManager.navigate`），所以没有"等服务器回包"要盖 —— 起演那一刻
     * 就把去向记下来，`out` 播完直接进 `in`。玩家看到的仍然是
     * "UI 推出去、雾合上、雾散开，人已经在匹配页"。
     *
     * @returns `true` = 已经交给过场（调用方**不许**再自己 `navigate`）；
     *          `false` = 过场播不了（雾贴图缺失 / 拿不到地图中心），调用方直接跳转
     */
    playMatchingIntro(entry: IMatchingEntryParams): boolean {
        // 已经在演（领地开战正在等回包）⇒ 吞掉这一下：此刻再跳一次会把两条流程撞在一起。
        if (this.battleIntro) return true;
        if (!this.startBattleIntro()) return false;
        this.releaseBattleIntro({ route: 'matching', entry });
        return true;
    }

    /**
     * 服务器回包 / 本地跳转确定 ⇒ 交给过场。
     *
     * 在 `out` 段到达时**不打断**它（雾还没盖住就散开，等于什么也没发生），只在 `hold` 段切 `in`。
     */
    private releaseBattleIntro(nav: ITerritoryBattleIntroNav): void {
        const intro = this.battleIntro;
        if (!intro || intro.nav) return;
        intro.nav = nav;
        intro.ready = this.awaitBattleIntroAssets(intro, nav);
    }

    /**
     * 目标页资源没好就先别散场（用户 2026-11-02：「需要等待战场资源加载后，云雾才散开」）。
     *
     * @returns `true` = 不用等，可以立刻进 `in`
     */
    private awaitBattleIntroAssets(
        intro: IBattleIntroState,
        nav: ITerritoryBattleIntroNav,
    ): boolean {
        // 匹配页自己 preload（`MatchingController.createSession`），页面这边拿不到它的 promise；
        // 它只加载一个 prefab + 几张图标，不铺战场那 5 秒的美术，按"不用等"处理。
        if (nav.route !== 'battle') return true;
        const ready = this.battleReady;
        if (!ready) return true;
        // 成败都算"等完了"：失败时流程切换会自己报错，`watchBattleSwitch` 那边收尾。
        void ready.then(() => undefined, () => undefined).then(() => {
            if (this.battleIntro === intro) intro.ready = true;
        });
        return false;
    }

    /**
     * 收工 / 取消：把 HUD 与地图**一次性复位**，放开输入锁。
     *
     * 被拒那条路不做反向过场（`tip` 到达时直接复位）：过场每局最多一次、被拒更是少见，
     * 为它多写一条"倒着演"的时间轴不值当 —— 而且倒演期间玩家会看着一个"从没发生过的动画"。
     *
     * 顺带复位 model 侧的在途开战态（`cancelBattleStart`）：过场一旦不是"跳走"而是"收掉"，
     * 这一局就没开成 —— `startingBattle` 留着真值会让「开始战斗」变成死按钮。
     * 覆盖三条：`hold` 等回包超时、开战被拒（`tip`）、`in` 段没有去向的兜底。
     */
    private finishBattleIntro(): void {
        const intro = this.battleIntro;
        this.battleIntro = null;
        this.battleIntroLeftover = null;
        if (intro) this.restoreBattleIntroScene(intro.hud);
        else this.restoreBattleIntroScene([]);
        this.sendIntent({ kind: 'cancelBattleStart' });
    }

    /**
     * 跳转已发、`in` 段播完：**不还原**画面（云已散尽，接下来应该是战斗 / 匹配页），
     * 只留一份现场 + 一个兜底定时器。
     *
     * 🔴 为什么不在这里直接复位：预加载还没完，此时把 UI 复位、地块还原，
     *    主界面会整片闪回来一下 —— 玩家会看到"过场演完了，又回到主城，然后才进战斗"。
     *
     * 主路径是 `watchBattleSwitch()` 的落定回调：切走 ⇒ 作废 `battleIntroLeftover`（这里
     * 的定时器就变成空转）；没切走 ⇒ 当场 `failBattleIntro()`。这条定时器只剩
     * "连落定信号都没收到"那种情况（路由注册漏了 / 切换被永久挂起）。
     */
    private abandonBattleIntro(): void {
        const intro = this.battleIntro;
        if (!intro) return;
        this.battleIntro = null;
        this.battleIntroLeftover = { hud: intro.hud };
        this.scheduleOnce(() => {
            if (!this.isValid || !this.battleIntroLeftover) return;
            this.failBattleIntro(`等了 ${TERRITORY_BATTLE_INTRO_RESTORE_FALLBACK_SECONDS} 秒仍没等到流程切换落定`);
        }, TERRITORY_BATTLE_INTRO_RESTORE_FALLBACK_SECONDS);
    }

    /** 把 HUD 摆回开演前的位置 / 透明度，并收掉地图那半（地块倍率、不透明度、云盖层、输入锁）。 */
    private restoreBattleIntroScene(hud: readonly ITerritoryBattleIntroHud[]): void {
        for (const handle of hud) releaseIntroHud(handle);
        if (this.mapView?.isValid) this.mapView.endBattleIntro();
        this.battleApproachPending = false;
    }

    /** 写一帧：HUD 沿各自方向位移 + 淡出，并把同一帧交给地图（地块 / 云盖层）。 */
    private writeBattleIntroFx(fx: ITerritoryBattleIntroFx): void {
        const intro = this.battleIntro;
        if (!intro) return;
        const distance = intro.pushPx * fx.uiPush;
        for (const handle of intro.hud) applyIntroHud(handle, distance, fx.uiOpacity);
        if (this.mapView?.isValid) this.mapView.applyBattleIntro(fx);
    }

    /**
     * 点名要推出去的 HUD（清单在 `TERRITORY_BATTLE_INTRO_TARGETS`）。
     *
     * 基准位置在这里**量一次**：Widget 会在布局事件里改 `position`，每帧重量会把
     * "已经被推出去的"位置当成基准，越推越远（再也回不来）。
     * 找不到 / 已隐藏的节点直接跳过 —— 宿主页结构变了只是少推一件，不是过场失败。
     */
    private collectBattleIntroHud(): ITerritoryBattleIntroHud[] {
        const out: ITerritoryBattleIntroHud[] = [];
        // 起点同样是 `hostPageRoot()`（= `ArenaRoot`）：`TopHud` / `BottomHud` 都不是
        // `MapRoot` 的后代，拿 `this.node.parent` 起头等于一棵一棵白找（见 `hostPageRoot`）。
        const host = this.hostPageRoot();
        if (!host?.isValid) return out;
        for (const target of TERRITORY_BATTLE_INTRO_TARGETS) {
            const node = findDescendantByName(host, target.name) ?? this.findUpwardSibling(host, target.name);
            if (!node?.isValid || !node.activeInHierarchy) continue;
            const handle = acquireIntroHud(node, target.dir);
            if (handle) out.push(handle);
        }
        return out;
    }

    /**
     * 再往上找几层同名节点（`BottomNav` 挂在 `MainRoot` 上，不在本页的宿主 `ArenaRoot` 里）。
     *
     * 只往上找 4 层并且用 `getChildByName`（不是 `cc.find` 的绝对路径）：宿主页结构一动，
     * 这里最多是"推不出去"，不会抛错、也不会推错节点。
     */
    private findUpwardSibling(host: Node, name: string): Node | null {
        let parent = host.parent;
        for (let depth = 0; depth < 4 && parent?.isValid; depth += 1) {
            const hit = parent.getChildByName(name);
            if (hit) return hit;
            parent = parent.parent;
        }
        return null;
    }

    /**
     * 过场用的视口尺寸（推出距离按长边算）。
     *
     * 先用页面自己的 `UITransform`（HUD 的 `position` 就在这套坐标里），拿不到再退到
     * 设计分辨率的可视尺寸 —— 绝不给 0（0 ⇒ 推出距离 0 ⇒ UI 只会淡掉、不会"被推走"）。
     */
    private battleIntroViewport(): [number, number] {
        const size = this.node.getComponent(UITransform)?.contentSize;
        if (size && size.width > 0 && size.height > 0) return [size.width, size.height];
        const visible = view.getVisibleSize();
        return [visible?.width ?? 0, visible?.height ?? 0];
    }

    private renderAll(): void {
        const state = this.state;
        if (!state || !state.ready || !state.map || !state.progress) return;
        // 🔴 整章云散还在演 ⇒ 这一帧**先别换图**（用户 2026-11-04「完成章节云层消散的动画
        //    没有了」）。模型通关后立刻换章，`syncGrid` 换章第一件事是 `clouds.reset()` +
        //    `restoreChestCamera()`，云散 1.1s 拉远 + 2.0s 逐朵淡会被掐在第一帧。
        //    `state` 已经是新章了也没关系：地图保持旧章不动，等演出完再画（`update` 里补）。
        //    转场（玩家点的切章）例外：它自己要靠新章画上来才能揭幕。
        const chapterChanged = state.chapterId !== this.lastRenderedChapter;
        // 🔴 2026-11-11 首通编排：`chapterClearPending` 是模型给的一次性边沿，但 SVN 合并
        //    可能把它冲掉（症状「章节通关动画丢失，只剩切换」）⇒ 同一章里 `chapterCleared`
        //    false→true 也认首通。换章进来的那一帧不算（切回早已通过的章节不许演）。
        const firstClearEdge = state.chapterCleared && !this.lastRenderedChapterCleared
            && !chapterChanged;
        const clearSignal = state.chapterClearPending || firstClearEdge;
        if (clearSignal && state.chapterCleared) this.chapterClearFollowup = true;
        if (chapterChanged && !this.chapterSwitch) {
            if (this.chapterClearFollowup) {
                // 首通自动推进：把换图压住，update 里先演完云散、再起切换转场。
                this.chapterClearFollowup = false;
                this.chapterClearSwitch = { from: this.lastRenderedChapter, to: state.chapterId };
                this.chapterSwapPending = true;
                return;
            }
            // 非首通的换章也要让整章云散演完（旧口径，`syncGrid` 会 reset 掉云）。
            if (this.mapView?.chapterClearPlaying) {
                this.chapterSwapPending = true;
                return;
            }
        }
        // 切换转场正在合拢：新章早已加载完，云还没盖满时不许画（否则 lead 段露新图）。
        if (chapterChanged && this.chapterSwitch?.deferRender
            && (this.chapterSwitch.phase === 'lead' || this.chapterSwitch.phase === 'cover')) {
            this.chapterSwapPending = true;
            return;
        }
        // 首次成功渲染即通知宿主首屏就绪（一次性，之后切章不再触发）。
        if (!this.firstReadyNotified) {
            this.firstReadyNotified = true;
            EventMgr.instance.emit(VIEW_LIFECYCLE, { owner: this, phase: 'presented' });
        }
        // 数据就绪即挂 tick（进入页面/切章后只需一次；加载中 state.ready=false 不会走到这里）。
        const resetScroll = state.chapterId !== this.lastRenderedChapter;
        this.lastRenderedChapter = state.chapterId;
        this.lastRenderedChapterCleared = state.chapterCleared;

        this.mapView.renderMap({
            map: state.map,
            layout: state.layout,
            art: state.art,
            progress: state.progress,
            revealedCells: state.revealedCells,
            // 提前披露的格（2026-11-09）：视图据此给还没激活的关卡建筑画 35% 虚影。
            // ⚠️ 这些格**已经含在** `revealedCells` 里，这份只是"哪几格要画虚影"。
            previewCells: state.previewCells,
            siteOpenableCells: state.siteOpenableCells,
            // 锁标只认「结构性阻塞」（前置没打通 / 随机格四周没开），见 `ITerritoryViewState.lockBlockedCells`。
            lockBlockedCells: state.lockBlockedCells,
            stageByCell: state.stageByCell,
            randomResourceOpenableCells: state.randomResourceOpenableCells,
            pendingRandomResourceCells: state.pendingRandomResourceCells,
            pendingFixedResourceCells: state.pendingFixedResourceCells,
            // 「胜利通过」收进来的那几格 ⇒ 地图上的进场动画走更重的节奏档（2026-11-03）。
            victoryClaimCells: state.victoryClaimCells,
            // 钱包 ⇒ 判「银币 / 体力数字要不要染红」（2026-11-03）。
            wallet: state.wallet,
            // 通关 ⇒ 整章云散（2026-11-04：通关口径改成"最后一个首领"后，
            // 老判据「全图都打通了」可能永远不成立，得由状态显式告诉地图）。
            chapterCleared: state.chapterCleared,
            // 只给**首次通关**演的那一拍（一次性边沿）：切回已通过的章节时它是 false，
            // 地图只把雾收掉、不重演（2026-11-05）。
            // 合并后的电平边沿兜底与模型边沿一起喂给地图（二者都只认「首次通关」）。
            chapterClearPending: clearSignal,
        });
        if (resetScroll) {
            const focus = this.focusCell;
            this.focusCell = null;
            const cellId = focus && focus.chapterId === state.chapterId
                ? focus.cellId : state.map.startCellId;
            this.scrollToCell(cellId, state.layout);
        }
        this.renderDetail(state.detail);
    }

    /**
     * 弹窗分发：**异步据点走「玩家关卡」，关卡 / 首领走「关卡界面」（+ 关卡提示）**。
     *
     * 通用站点详情面板已移除（2026-10-27 山猫：不需要了）；选中的是资源点等其它格子时
     * 三个弹窗全部收起，信息只留在左侧 info 区。
     */
    private renderDetail(detail: ITerritoryDetailState): void {
        if (detail.playerStage) {
            this.closePopup(LevelInfoPanel);
            this.renderLevelTip(null);
            this.renderPlayerStage(detail.playerStage);
            return;
        }
        if (detail.levelInfo) {
            if (this.playerStagePanel.isOpen) this.playerStagePanel.close();
            this.renderLevelInfo(detail.levelInfo);
            this.renderLevelTip(detail.levelTip);
            return;
        }
        if (this.playerStagePanel.isOpen) this.playerStagePanel.close();
        this.closePopup(LevelInfoPanel);
        this.renderLevelTip(null);
    }

    /** 关掉某个 popup（没开就什么都不做；`get` 只查栈，已关的返回 `null`）。 */
    private closePopup(cls: typeof LevelInfoPanel | typeof LevelTipPanel): void {
        const opened = cls === LevelInfoPanel
            ? PopupManager.inst.get(LevelInfoPanel)
            : PopupManager.inst.get(LevelTipPanel);
        if (opened) opened.close();
    }

    /**
     * 关卡界面：先用手头已有的帧上屏，缺图的异步补齐后再 `applyContent` 刷一次。
     *
     * ⚠️ 不能靠「再 `open` 一次」刷新内容 —— `PopupManager.openAsync` 对同类弹窗单实例去重，
     * 已打开时直接返回现有实例、**不重走 `onOpen`**。
     */
    private renderLevelInfo(content: ITerritoryLevelInfoContent): void {
        this.showPopupContent(LevelInfoPanel, this.levelInfoContentOf(content));
        void this.prefillLevelIcons(content);
    }

    /** 关卡提示：`null` = 收起（关掉提示不影响下面的关卡界面）。 */
    private renderLevelTip(content: ITerritoryLevelTipContent | null): void {
        const revision = ++this.levelTipRevision;
        this.levelTipVisible = content !== null;
        if (!content) {
            this.closePopup(LevelTipPanel);
            return;
        }
        const opened = PopupManager.inst.get(LevelTipPanel);
        if (opened) {
            opened.applyContent(this.levelTipContentOf(content));
            void this.prefillLevelTipIcons(content, revision);
            return;
        }
        void LevelTipPanel.open({ userData: this.levelTipContentOf(content) }).then((panel) => {
            if (!this.isValid || !panel) return;
            if (revision !== this.levelTipRevision) {
                if (!this.levelTipVisible) panel.close();
                return;
            }
            // 同类弹窗的并发打开可能复用首次请求；始终以最新关卡内容覆盖。
            panel.applyContent(this.levelTipContentOf(content));
            void this.prefillLevelTipIcons(content, revision);
        });
    }

    /** 已开着就换内容，没开就打开（`userData` 走 `onOpen` 渲染）。 */
    private showPopupContent(cls: typeof PopupBase, userData: unknown): void {
        const opened = PopupManager.inst.get(cls);
        if (opened) {
            // 已开着：直接换内容（`openAsync` 单实例去重，不会重走 `onOpen`）
            (opened as unknown as { applyContent(data: unknown): void }).applyContent(userData);
            return;
        }
        void cls.open({ userData });
    }

    private levelInfoContentOf(content: ITerritoryLevelInfoContent): ILevelInfoContent {
        return {
            title: content.title,
            hasTip: content.hasTip,
            objective: content.objective,
            occupy: content.occupy,
            // 格子只要 id + 数量，图标/品质框由 `RewardItemView` 自己解析
            drops: content.drops.map((drop) => ({ resId: drop.resId, amount: drop.amount })),
            recommend: content.recommend,
            fightCaption: content.fightCaption,
            fightEnabled: content.fightEnabled,
            staminaCost: content.staminaCost,
            // 费用图标由页面加载后透传（弹窗不解配置表）；缺图时弹窗只藏图标、数字照常
            staminaIcon: this.staminaIcon,
        };
    }

    private levelTipContentOf(content: ITerritoryLevelTipContent): ILevelTipContent {
        return {
            title: content.title,
            enemies: content.enemies.map((enemy): ILevelTipEnemy => ({
                icon: this.levelTipIcons.get(enemy.headIcon) ?? null,
                name: enemy.name,
                // 逐个敌人的描述 —— 描述框显示**当前选中那个**（蓝湖设计稿口径）
                description: enemy.description,
            })),
            description: content.description,
        };
    }

    /** 补给关卡掉落的图标/品质框（与玩家关卡共用同一份 `playerStageIcons` 缓存）。 */
    private async prefillLevelIcons(content: ITerritoryLevelInfoContent): Promise<void> {
        const missing = content.drops.filter((drop) => !this.playerStageIcons.has(drop.resId));
        if (missing.length === 0) return;
        await Promise.all(missing.map((drop) => this.loadPlayerStageIcon(drop.resId)));
        if (!this.isValid) return;
        // 加载期间玩家可能已经关了弹窗或点了别的关卡
        if (this.state?.detail.levelInfo !== content) return;
        const opened = PopupManager.inst.get(LevelInfoPanel);
        if (!opened) return;
        opened.applyContent(this.levelInfoContentOf(content));
    }

    /** 补敌军头像（`headIcon` 是 icon 表的 key，不是资源路径）。 */
    private async prefillLevelTipIcons(content: ITerritoryLevelTipContent, revision = this.levelTipRevision): Promise<void> {
        const missing = content.enemies
            .map((enemy) => enemy.headIcon)
            .filter((path) => path !== '' && !this.levelTipIcons.has(path));
        if (missing.length === 0) return;
        const resolver = createIconArtResolver(await this.refRows<IconRow>('icon'));
        if (!this.isValid || revision !== this.levelTipRevision) return;
        await Promise.all(missing.map(async (path) => {
            const target = resolver.resolve(path);
            if (!target) {
                console.warn(`[LevelTipPanel] 找不到敌军头像配置：${path}`);
                return;
            }
            try {
                const frame = await this.assets.load(spriteFramePath(target.root, target.art), SpriteFrame);
                if (this.isValid && frame.isValid) this.levelTipIcons.set(path, frame);
            } catch (error) {
                console.warn(`[LevelTipPanel] 敌军头像加载失败：${path}`, error);
            }
        }));
        if (!this.isValid || revision !== this.levelTipRevision) return;
        const opened = PopupManager.inst.get(LevelTipPanel);
        if (!opened) return;
        opened.applyContent(this.levelTipContentOf(content), true);
    }


    /** 玩家关卡弹窗：先用缓存帧开一次（同步），缺图的异步补齐后再开一次。 */
    private renderPlayerStage(content: ITerritoryPlayerStageContent): void {
        this.playerStagePanel.open(this.playerStageContentOf(content));
        void this.prefillPlayerStageIcons(content);
    }

    private playerStageContentOf(content: ITerritoryPlayerStageContent): IBigMapPlayerLevelContent {
        return {
            title: content.title,
            chestText: content.chestText,
            rewards: content.rewards.map((reward) => ({ resId: reward.resId, amount: reward.amount })),
            scoutCost: content.scoutCost,
            fightCost: content.fightCost,
            fightCaption: content.fightCaption,
            fightEnabled: content.fightEnabled,
        };
    }

    /**
     * 补齐玩家关卡弹窗里还没加载过的奖励图标。
     *
     * 加载完只在「还是同一条内容 + 弹窗仍开着」时重开一次：期间玩家可能已经关掉弹窗
     * 或点了别的据点，无脑重开会把弹窗又弹回来。
     */
    private async prefillPlayerStageIcons(content: ITerritoryPlayerStageContent): Promise<void> {
        const missing = content.rewards.filter((reward) => !this.playerStageIcons.has(reward.resId));
        if (missing.length === 0) return;
        await Promise.all(missing.map((reward) => this.loadPlayerStageIcon(reward.resId)));
        if (!this.isValid) return;
        if (this.state?.detail.playerStage !== content || !this.playerStagePanel.isOpen) return;
        this.playerStagePanel.open(this.playerStageContentOf(content));
    }

    /**
     * 载入一格奖励的「图标 + 品质框」。
     *
     * 口径与 `ensureRewardIcon` 一致（`roleProperty` 优先、`item` 兜底），多出来的只是
     * **品质框**：`roleProperty.quality` → `cu_quality_0N`。查不到品质就不显示框，
     * 但图标照常显示 —— 缺框是视觉损失，缺图标才是"这条奖励看着不存在"。
     */
    private async loadPlayerStageIcon(resId: number): Promise<void> {
        if (this.playerStageIcons.has(resId)) return;
        let icon: SpriteFrame | null = null;
        let frame: SpriteFrame | null = null;
        try {
            const [propRows, itemRows] = await Promise.all([
                this.refRows<IResPropertyRow>(ROLE_PROPERTY_TABLE),
                this.refRows<IItemRefRow>(ITEM_TABLE),
            ]);
            const path = resBarIconSpritePath(resBarCellOfRefId(resId, propRows, itemRows));
            if (path) icon = await this.assets.load(path, SpriteFrame);
            const quality = Number(propRows.find((row) => Number(row.resId) === resId)?.quality);
            if (Number.isFinite(quality) && quality > 0) {
                const framePath = spriteFramePathOf(`image/${qualityFrameArtPath(qualityFrameSuffixOf(quality))}`);
                frame = await this.assets.load(framePath, SpriteFrame).catch(() => null);
            }
        } catch {
            icon = null;
        }
        if (!this.isValid) return;
        this.playerStageIcons.set(resId, { frame, icon, amount: 0 });
    }

    private scrollToCell(cellId: number, layout: ITerritoryMapLayout, retry = 0): void {
        const viewport = this.mapScrollView.node.getComponent(UITransform);
        const size = viewport.contentSize;
        // ⚠️ 两份留白必须与内容层**同源**：`territoryMapOffsetForCell` 用它们算可滚上限，
        //    少传就等于按「没留白」算 —— 跳过去会停在半路（差的那截滚不到）。
        const offset = territoryMapOffsetForCell(layout, cellId, size, {
            paddingBottom: this.mapView?.contentPaddingBottom,
            paddingTop: this.mapView?.contentPaddingTop,
        });
        this.mapScrollView.stopAutoScroll();
        this.mapScrollView.scrollToOffset(new Vec2(offset.x, offset.y), 0);
        // 首屏 Widget 可能尚未撑开视口；组件调度随销毁取消，换章后丢弃旧布局。
        if ((size.width <= 0 || size.height <= 0) && retry < 3) {
            this.scheduleOnce(() => {
                if (this.state?.layout === layout) this.scrollToCell(cellId, layout, retry + 1);
            }, 0);
        }
    }

    /**
     * 宿主页里**挂着 HUD 的那一层**（现结构是 `ArenaRoot`）。
     *
     * ## 为什么不能只认 `this.node.parent`
     *
     * 🔴 2026-11-05 用户截图「最上沿的地块还是被 UI 遮挡」—— 根因就在这一句：
     * 地图页实际的层级是 `ArenaRoot / MapRoot / MainTerritoryMap`（`MapRoot` 是那个
     * 嵌套 prefab 实例的宿主层），而 `TopHud` / `BottomHud` / `BeginGame` / `ChestBar`
     * 全都挂在 `ArenaRoot` 上。只查 `this.node.parent`（= `MapRoot`）一个都找不到 ⇒
     * `hudBottom` 恒 **0** ⇒ `padTop` 只剩 `15 + 45 + 60 = 120`，第一排地块停在离屏幕顶
     * **75** 的位置，正好落在 146 高的 `TopHud` 后面 —— 读起来就是"根本拖不下来"。
     *
     * 底部那侧一直没暴露同一个 bug：量不到会退到兜底 {@link TERRITORY_MAP_BOTTOM_INSET}
     * （300），与真实 305 只差 5px，肉眼看不出来。
     *
     * ⚠️ 往上最多找 4 层、逐层 `getChildByName`：宿主页再套一层容器也不会断；
     *    真找不到就退回 `this.node.parent`（= 老行为，退化但不抛错）。
     *    口径与 {@link findUpwardSibling}（过场推 HUD 那套）一致 —— 它早就为同一件事
     *    加过"往上找"的兜底，这里是同一个坑的第二次踩。
     */
    private hostPageRoot(): Node | null {
        const direct = this.node.parent;
        if (!direct?.isValid) return null;
        let node: Node | null = direct;
        let top: Node = direct;
        for (let depth = 0; depth < 4 && node?.isValid; depth += 1) {
            if (node.getChildByName(TOP_HUD_NODE_NAME)) return node;
            top = node;
            node = node.parent;
        }
        // 兜底：HUD 被人塞进某层容器里（不是直接孩子）时，从能到的最高一层按子树找一次。
        return findDescendantByName(top, TOP_HUD_NODE_NAME) ? top : direct;
    }

    /**
     * 从**宿主页**找顶部 HUD（它不在地图 prefab 里，只按名字找，没有引用可拿）。
     *
     * ⚠️ 起点必须是 {@link hostPageRoot} 而不是 `this.node.parent`：后者是 `MapRoot`，
     *    见那个方法里的 2026-11-05 复盘。
     */
    private findTopHud(): Node | null {
        const host = this.hostPageRoot();
        if (!host?.isValid) return null;
        return host.getChildByName(TOP_HUD_NODE_NAME) ?? findDescendantByName(host, TOP_HUD_NODE_NAME);
    }

    /**
     * 顶部 HUD 底边到**视口顶部**的距离（px）。
     *
     * 两个 `getBoundingBoxToWorld()` 相减：一个取 HUD 的底边（`box.yMin`），一个取视口的顶边
     * （`box.yMax`）。都是世界坐标 ⇒ 不受中间节点的缩放 / 锚点影响。
     *
     * 🔴 返回 0 **不是**"没有遮挡"这么温和的意思：0 ⇒ `padTop` 只剩 120 ⇒ 第一排地块停在
     * 离屏幕顶 75 的位置，正好在 146 高的 `TopHud` 后面（2026-11-05 用户截图就是这个症状）。
     * 所以"量不到"必须当成**待修的 bug**看，别拿它当合法退化。
     *
     * @returns 找不到 HUD / 视口时返回 0；正常结构下应是 `TopHud` 顶边距 + HUD 高（720×1280 上 146）。
     */
    private topHudBottom(viewport: UITransform): number {
        const hud = this.findTopHud();
        if (!hud?.isValid) return 0;
        const hudBox = hud.getComponent(UITransform)?.getBoundingBoxToWorld();
        const viewportBox = viewport?.getBoundingBoxToWorld();
        if (!hudBox || !viewportBox) return 0;
        const distance = viewportBox.yMax - hudBox.yMin;
        return Number.isFinite(distance) ? Math.max(0, distance) : 0;
    }

    /**
     * 底部挂件**上沿**到**视口底边**的距离（px）。
     *
     * 与 {@link topHudBottom} 是同一个套路（两个世界包围盒相减），只是方向相反：
     * 顶部量「视口顶 − HUD 底」，底部量「挂件顶 − 视口底」。
     *
     * 🔴 基准是**视口**底边，不是屏幕底边：`MapViewport` 底边离屏幕底还有 168px，
     *    拿屏幕底量会把这段也算进去，`pad` 直接大 168（底排又被压回挂件下面）。
     *
     * ⚠️ 起点同样要用 {@link hostPageRoot}：`MainTaskEntry` 在 `BottomHud` 里、
     *    `BeginGame` / `ChestBar` 是 `ArenaRoot` 的孩子，没有一个是 `MapRoot` 的后代。
     *
     * 几个挂件的高度都会变（任务入口有红点、宝箱栏有展开态、快速寻敌换文案），
     * 所以每次都得重量 —— 这也是它跟 `canvas-resize` 一起重算的原因。
     *
     * @returns 一个都找不到 / 量不到包围盒时返回 `null`：调用方退到
     *          {@link TERRITORY_MAP_BOTTOM_INSET}，而不是当成 0（0 = 底排被挂件压住）。
     */
    private bottomHudInset(viewport: UITransform): number | null {
        const host = this.hostPageRoot();
        const viewportBox = viewport?.getBoundingBoxToWorld();
        if (!host?.isValid || !viewportBox) return null;
        let top: number | null = null;
        for (const name of BOTTOM_HUD_NODE_NAMES) {
            const box = findDescendantByName(host, name)
                ?.getComponent(UITransform)?.getBoundingBoxToWorld();
            if (!box) continue;
            top = top === null ? box.yMax : Math.max(top, box.yMax);
        }
        if (top === null) return null;
        const inset = top - viewportBox.yMin;
        return Number.isFinite(inset) ? Math.max(0, inset) : null;
    }

    /**
     * 量一次上下两条基准线，把**上下两份**留白一起注入地图视图。
     *
     * 🔴 两条基准线**不是同一个东西**，别为了省一次测量合成一个：
     *  · 顶部留白看 `TopHud` 底边（{@link TERRITORY_MAP_HUD_GAP}：地块能被拖到个人信息框下方 15px）；
     *  · 底部留白看底部挂件上沿（{@link TERRITORY_MAP_BOTTOM_GAP}：最底那排最多比挂件高 50px）。
     * 2026-10-27 曾经两边都拿顶部 HUD 反算，`pad` 在 720×1280 上高达 951 ——
     * 拖到最底时地图下方留了 951px 纯云，就是用户截图里的「距离太高」。
     *
     * 同时把视口尺寸交给视图（全解锁镜头散场要用它算「整张图入画」的倍率）。
     */
    private syncMapInsets(): void {
        if (!this.mapScrollView?.isValid || !this.mapView?.isValid) return;
        const viewport = this.mapScrollView.node.getComponent(UITransform);
        if (!viewport) return;
        const hudBottom = this.topHudBottom(viewport);
        // `?? 兜底`：宿主页结构变了也要有一条可信的底线（0 会让底排被挂件压住）。
        const bottomInset = this.bottomHudInset(viewport) ?? TERRITORY_MAP_BOTTOM_INSET;
        this.mapView.setContentPaddingBottom(
            territoryMapContentPaddingBottom(viewport.height, bottomInset));
        this.mapView.setContentPaddingTop(territoryMapContentPaddingTop(hudBottom));
        this.mapView.setViewportSize(viewport.width, viewport.height);
    }

    /** 订阅屏幕变化：HUD 的 Widget 与安全区都会因此改变 ⇒ 留白必须跟着重量。 */
    private bindMapInsetResize(): void {
        if (this.mapInsetResizeBound) return;
        if (!this.mapScrollView?.isValid || !this.mapView?.isValid) return;
        this.mapInsetResizeBound = true;
        view?.on?.('canvas-resize', this.onCanvasResize, this);
    }

    /**
     * 屏幕变化 ⇒ **延一帧**再重量：`MainHudLayout` 也在同一个事件里排 TopHud 的 Widget，
     * 两个组件的执行顺序不保证，同帧量到的可能还是旧底边。
     */
    private onCanvasResize(): void {
        this.scheduleOnce(this.remapMapInsets, 0);
    }

    private remapMapInsets(): void {
        this.syncMapInsets();
    }

    /**
     * 发奖反馈：**带来源格（资源点宝箱）⇒ 先播开箱表演，再结算；随机格 ⇒ 就地喷资源；
     * 挂机产出 ⇒ 直接飘字 / 弹窗**（2026-10-22 用户口径，2026-10-26 补随机格）。
     *
     * ## 为什么按 `originCellId` 分流，而不是按奖励多少
     *
     * 「是不是宝箱」是**来源**决定的（资源点领取 / 随机格开启 = 有个箱子被打开；挂机产出没有格子），
     * 「开多大的箱」才是**数量**决定的（`territoryChestTierOfRewards`：<100 弱 / ≤1000 中 / >1000 强）。
     * 两件事各判各的 —— 混成一个 if 就会出现「挂机攒了很多也放全屏镜头」这种失控。
     *
     * ## 结算顺序
     *
     * 开箱表演 `2.3~3.2s` 播完再弹奖励窗（`onDone`），否则弹窗会盖住整段表演；
     * 钱包类资源（银币 / 体力）此时**不再叠 `+N` 飘字** —— 飞出图标的 `+N` 已经是那次反馈，
     * 再飘一遍是同一件事说两次。
     */
    private presentRewards(
        rewards: readonly (TerritoryIdleRewardGain | ITerritoryGrantedReward)[],
        originCellId?: number | null,
        presentation?: ITerritoryRewardPresentation,
    ): void {
        if (!rewards.length) return;
        // 2026-11-10 需求 ③：任何来源的领奖都查一次「本次新达成可升级」的英雄。
        // 徽标是纯表现且挂在底栏（比地图覆盖层更外层），放在所有分流之前 ⇒
        // 随机格 / 固定格 / 银币宝箱 / 挂机弹窗四条路都覆盖，也不会被开箱表演盖住。
        void this.playHeroBadges(rewards);
        const cellId = originCellId ?? null;
        // 挂机征收（`{ popup: true }`）：服务端发什么就弹什么 —— 产出常常只有银币 / 体力，
        // 走默认分流会被剥去飘字、一个弹窗都不出（用户 2026-11-09「点击征收就弹窗奖励」）。
        if (presentation?.popup === true) {
            FW.ShowReward(rewards.map((reward) => ({
                resId: reward.resId,
                number: reward.amount,
            })) as unknown as CmdGoods[]);
            return;
        }
        // 随机资源格：**不播开箱、也不弹奖励窗**，直接在格子上喷资源（需求 2026-10-22 §1 / 2026-10-26 §3）。
        // 由 Controller 指定（`{ chest: false }`），页面不自己判格子类型 —— 那是玩法口径。
        if (presentation?.chest === false) {
            void this.playCellGains(rewards, cellId);
            return;
        }
        // 银币宝箱（`rewardId = 1023` / `coinBox` 蓝银金属箱）：**独立**打开动画（2026-11-10）。
        // 不复用 `playChestOpen` —— 那是给卡牌碎片宝箱画的黄铜藤蔓箱 `chest_seq_*` 开盖补帧 +
        // 三档镜头/光柱/粒子，箱子图标与 `coinBox` 对不上。这里只让地图上那颗 icon 放大缩小消失。
        //
        // ⚠️ 奖励**当场结算**、绝不挂在动画回调上：pop 是纯表现，换章 / 页面销毁 / 视图被回收
        //    都可能让它播不完，把结算系在 `onDone` 上就会静默吞掉这一批银币。
        // ⚠️ `suppressGain = false`：这次没有飞出图标带过 `+N`，银币必须照常飘字（钱包类走
        //    `playResourceGain`，非钱包类走奖励窗），否则玩家点开箱子什么都看不到。
        if (presentation?.silverChest === true) {
            if (cellId !== null && cellId >= 0) this.mapView.playSilverChestOpen(cellId);
            this.settleRewards(rewards, cellId, false);
            return;
        }
        const tier = cellId !== null && cellId >= 0 ? territoryChestTierOfRewards(rewards) : null;
        if (!tier) {
            this.settleRewards(rewards, cellId, false);
            return;
        }
        void this.playChestThenSettle(tier, cellId as number, rewards);
    }

    /**
     * 「本次领奖让某英雄碎片满 + 经验满」⇒ 在英雄按钮上逐个播进度长满徽标
     * （2026-11-10 需求 ③）。
     *
     * 🔴 **纯表现、不接管结算**：拿不到数据源 / 查表失败 / 页面已销毁，一律安静跳过；
     *    奖励怎么发是 `presentRewards` 的事，这里只在旁边演一段动画。
     *
     * ⚠️ 两处 `await` 之后都要判 `isValid`：读表与加载碎片图都是异步的，
     *    期间换章 / 切 tab 会把页面销毁，往死节点上挂徽标会炸。
     */
    private async playHeroBadges(
        rewards: readonly (TerritoryIdleRewardGain | ITerritoryGrantedReward)[],
    ): Promise<void> {
        const source = this.heroProgressSource;
        if (!source) return;
        const deltas: ITerritoryRewardDelta[] = rewards.map((reward) => ({
            resId: Number(reward?.resId),
            amount: Number(reward?.amount),
        }));
        const items = await source.newlyReady(deltas);
        if (!this.isValid || !items.length) return;
        // 碎片图走页面现成的「奖励图标解析」真源（roleProperty + item 两张表 + 分包路由），
        // 不另建一套加载器。缺图 = 空图标，进度条照常长满。
        await Promise.all(items.map((item) => item.iconResId > 0
            ? this.ensureRewardIcon(item.iconResId)
            : Promise.resolve()));
        if (!this.isValid) return;
        const frames: HeroFragmentBadgeFrames = new Map(
            items.map((item) => [
                item.cardId,
                item.iconResId > 0 ? this.rewardIcons.get(item.iconResId) ?? null : null,
            ]),
        );
        this.ensureHeroBadge()?.enqueue(items, frames);
    }

    /** 惰性建徽标：挂在 `BottomNav` 上，摆在英雄按钮图标正上方。 */
    private ensureHeroBadge(): HeroFragmentBadge | null {
        if (this.heroBadge) return this.heroBadge;
        const host = this.findHeroTabHost();
        if (!host) return null;
        const button = this.findHeroTabButton();
        if (!button) return null;
        this.heroBadge = new HeroFragmentBadge(host.navBar, button);
        return this.heroBadge;
    }

    /**
     * 飞舞奖励图标的**顶层根节点**（2026-11-11）。
     *
     * 只负责「找哪个节点」，建节点 / 排兄弟序 / 坐标换算全在 `TerritoryMapView`：
     * 页面不许自己搭 UI（架构守卫 `territory-page-split` / `territory-battle-intro`）。
     *
     * `BottomNav` 是 `MainRoot` 的最后一个子节点 ⇒ 把特效层挂到它的父节点并排最后，
     * 才能盖过底栏与 `ArenaRoot/BottomHud` 的聊天框；弹窗挂在 `MainRoot` 之外，仍在其上。
     *
     * ⚠️ 找不到 `MainTabHost`（结构被改 / 测试沙箱）就退回 `hostPageRoot()`（= `ArenaRoot`），
     *    至少盖住聊天框；再找不到返回 `null` ⇒ 视图回退页面内覆盖层，**不静默消失**。
     */
    private rewardFxRoot(): Node | null {
        const navBar = this.findHeroTabHost()?.navBar ?? null;
        return navBar?.parent ?? this.hostPageRoot();
    }

    /**
     * 随机资源格「解锁即发奖」：**整批**奖励就地喷出来，一条都不进奖励弹窗。
     *
     * ## 为什么不能复用 `settleRewards`
     *
     * `settleRewards` 按 `resId` 把奖励拆成「钱包类（7 银币 / 9 体力）→ 飘字」与「其余 → 奖励弹窗」。
     * 那条分流是给**挂机产出**设计的（钱包里的数值涨了能看见，道具没有增量提示才需要弹窗）。
     * 随机格不是这个语义 —— 玩家刚点开的格子本身就是反馈舞台：
     *
     *  · 弹窗（`FW.ShowReward`）会把整张地图盖住，还要玩家点一下才关；
     *  · 随机池发的恰恰是**道具**（图纸 / 蓝本…），全是"非钱包类" ⇒ `gains` 空、`popup` 满，
     *    实机就是"粒子动画消失了，变成了奖励确认弹窗"（用户 2026-10-26 截图 2）。
     *
     * ⇒ 这里绕开分流：**全部奖励**按喷发 + 飘字播，`FW.ShowReward` 一次都不调。
     *
     * ## 图标为什么要在喷之前现取
     *
     * `setGainIcons` 预载的只有银币 / 体力两张（`loadResourceGainIcons`）。道具 id 是随机池给的，
     * 不现取就是**空图粒子**（有 `+N` 没图标，看起来像"粒子坏了"）。所以先 `collectRewardIcons`
     * 把这一批的图取齐，再逐枚回写给视图。
     *
     * ## 读数**合成一条**：统一图标 + 数量之和（2026-10-26 口径）
     *
     * 随机格一次发的是**同一种东西的不同版本**（`随机种族经验值` → 僵尸 / 盆栽 / 花果 / 蘑菇 四种
     * 种族经验球），逐条铺开会变成「4 行、4 个不同的球、4 个数字」，玩家既读不出总量、
     * 也看不懂为什么图不一样。所以这里：
     *
     *  · **读数**（icon + 数字 UI）= **一条**：图标统一 `种族经验球_随机`、数字取**全部数量之和**；
     *  · **喷发粒子**= 保持原规则，仍按每种奖励**各自的图**喷（能看出这一格给的是混合资源）。
     *
     * 分工靠 `playResourceGain` 的 `readout` 参数表达 —— 视图那边一个 `if` 就够，
     * 不要为此再写一套"合并"的视图。
     */
    private async playCellGains(
        rewards: readonly (TerritoryIdleRewardGain | ITerritoryGrantedReward)[],
        originCellId: number | null,
    ): Promise<void> {
        const cellId = originCellId;
        // 没有来源格（不该发生在随机格这条路上）⇒ 无处喷，也不能退回弹窗把玩家挡一次。
        if (cellId === null || cellId < 0) return;
        const [entries, readoutFrame] = await Promise.all([
            this.collectRewardIcons(rewards),
            this.ensureRandomGainReadoutIcon(),
        ]);
        if (!this.isValid) return;
        const gains = entries
            .filter((entry) => Number.isFinite(entry.resId) && entry.resId > 0 && entry.amount > 0)
            .map((entry) => ({ resId: entry.resId, amount: entry.amount }));
        if (!gains.length) return;
        for (const gain of gains) {
            this.mapView.setGainIcon(gain.resId, this.rewardIcons.get(gain.resId) ?? null);
        }
        // 读数合成一条：图标统一、数字求和；喷发粒子仍按 gains 各用各的图。
        const amount = gains.reduce((sum, gain) => sum + gain.amount, 0);
        this.mapView.playResourceGain(cellId, gains, { frame: readoutFrame, amount });

        // ②（2026-11-10 需求 ②）碎片 / 种族经验**再补一段**飞向底部「英雄」按钮的动画。
        //    只挑非钱包类：银币 / 体力归顶部资源栏，不能在这里重复飞一遍。
        //    拿不到按钮 / 目标坐标 ⇒ 视图整段跳过，喷发、读数、发奖一个都不少（纯表现）。
        const heroEntries = entries.filter((entry) => isTerritoryHeroRewardResId(entry.resId));
        if (heroEntries.length) {
            // 🔴 2026-11-11：飞行的图标必须画在**所有 UI 之上**（聊天框 / 快速寻敌 / 底栏）。
            //    页面内 `TerritoryOverlay` 只在 `Content / ArenaRoot` 里靠上，跨到底栏就输了；
            //    先把 `MainRoot` 交给视图建顶层宿主，再登记终点（否则坐标还是旧宿主的）。
            this.mapView.mountRewardFxLayer(this.rewardFxRoot());
            const heroButton = this.findHeroTabButton();
            this.mapView.setHeroRewardTargetWorld(this.heroTabWorldPositionOf(heroButton));
            this.mapView.setHeroRewardLandedHandler(() => {
                if (heroButton?.isValid) heroButton.playHitFeedback();
            });
            this.mapView.playHeroRewardFlight(cellId, heroEntries);
        }
    }

    /**
     * 随机格读数统一图标（`种族经验球_随机`）：**只加载一次**，失败也记成 `null`。
     *
     * 走 `spriteFramePathOf(TERRITORY_RANDOM_GAIN_READOUT_ART)`：那张图在 **`main-pages` 分包**的
     * `icons/item/` 下，形状与 `item.icon` 完全一致，所以 `CocosAssetService` 会按
     * `BundleCatalog.bundleForPath` 自动选包（分包没加载时它自己拉）。
     *
     * 取不到图**不阻断**：读数退化成「只有数字」（`readout.frame = null`），喷发与发奖照旧
     * —— 与「缺图仍照常升」同一口径。
     */
    private ensureRandomGainReadoutIcon(): Promise<SpriteFrame | null> {
        if (!this.readoutIconPending) {
            const path = spriteFramePathOf(TERRITORY_RANDOM_GAIN_READOUT_ART);
            this.readoutIconPending = this.assets.load(path, SpriteFrame).catch(() => {
                console.warn('[MainTerritoryMap] 随机格读数图标加载失败：' + path
                    + ' —— 读数会只剩数字（喷发粒子不受影响）；'
                    + '请确认「种族经验球_随机」已导入 main-pages 的 icons/item/');
                return null;
            });
        }
        return this.readoutIconPending;
    }

    /**
     * 取齐图标 → 播开箱 → 播完结算。
     *
     * ⚠️ 图标是**异步**取的（`roleProperty` 表 + `AssetService`），所以这里必须 await 之后再 `play`；
     *   取不到图（表里没登记 / 美术缺失）只是那枚图标是空的，**动画照播**、奖励照发。
     */
    private async playChestThenSettle(
        tier: TerritoryChestTier,
        cellId: number,
        rewards: readonly (TerritoryIdleRewardGain | ITerritoryGrantedReward)[],
    ): Promise<void> {
        const entries = await this.collectRewardIcons(rewards);
        if (!this.isValid) return;
        // 🔴 必须在 `playChestOpen` **之前**接线：落点是 `play()` 第一帧就要用的，
        //    接晚了第一批图标会先按默认落点飞出去（表现为"飞到屏幕中间"）。
        this.wireRewardCatch(rewards);
        const started = this.mapView.playChestOpen(cellId, tier, entries, () => {
            if (this.isValid) this.settleRewards(rewards, cellId, true);
        });
        // 没播起来（格子不在视口 / 覆盖层没建起来）⇒ 立刻结算，绝不能把奖励吞掉。
        if (!started) this.settleRewards(rewards, cellId, true);
    }

    /**
     * 把「奖励图标飞进资源栏 / 英雄按钮 → 那一格跳动 / 按钮受击抖动」这条链接上。
     *
     * ## 两条目标（2026-11-10 扩展）
     *
     * ```
     * 7 / 9（钱包类） → territoryWalletResKeyOf → ResBar.slotWorldPositionOf → 顶部资源栏
     * 其余（碎片/经验） → findHeroTabButton → 图标节点世界坐标 → 底部「英雄」按钮
     * 世界坐标 → 覆盖层    TerritoryMapView.setRewardCatchWorldPoint（矩阵换算留在视图）
     * ```
     *
     * 🔴 用户口径「**只改碎片经验**」：银币 / 体力必须继续飞顶部资源栏并触发数字跳动，
     *    否则钱包涨了玩家看不见。非钱包类以前没有登记落点 ⇒ 全部回落到「屏幕顶部中央」
     *    堆成一团（2026-11-10 截图红框），现在统一改道到英雄按钮。
     *
     * ## 为什么回调里再算一次 key
     * `TerritoryChestView` 的回调只给 `(resId, amount)` —— 它不知道资源栏 / 底栏长什么样，
     * 也不该知道。`resId → 目标` 是玩法口径，两次都走同一组纯函数，不缓存第二份映射。
     */
    private wireRewardCatch(
        rewards: readonly (TerritoryIdleRewardGain | ITerritoryGrantedReward)[],
    ): void {
        const bar = this.findResBar();
        const heroButton = this.findHeroTabButton();
        const heroWorld = this.heroTabWorldPositionOf(heroButton);
        this.mapView.clearRewardCatchPoints();
        for (const reward of rewards) {
            const resId = Number(reward?.resId);
            if (!Number.isFinite(resId) || resId <= 0) continue;
            const key = territoryWalletResKeyOf(resId);
            if (key) {
                // `null`（那一格没显示 / 取不到变换）= 清掉这一种资源的专属落点，回落默认。
                if (bar) this.mapView.setRewardCatchWorldPoint(resId, bar.slotWorldPositionOf(key));
            } else if (heroWorld) {
                this.mapView.setRewardCatchWorldPoint(resId, heroWorld);
            }
        }
        this.mapView.setRewardLandedHandler((resId, amount) => {
            const key = territoryWalletResKeyOf(resId);
            if (key) {
                if (bar?.isValid) bar.playGainFeedback(key, amount);
                return;
            }
            // 非钱包类落在英雄按钮上 ⇒ 按钮播「被砸一下」的抖动（core 那条先 Y 后 X 脉冲）。
            if (heroButton?.isValid && isTerritoryHeroRewardResId(resId)) {
                heroButton.playHitFeedback();
            }
        });
    }

    /**
     * 找底栏「英雄」按钮：逐层往上问 `MainTabHost`，再按 `tabType` 精确定位。
     *
     * 🔴 与 {@link findResBar} 同一个「不许从场景根搜」的理由：底栏在 `MainRoot` 层、
     *    与 `Content` 平级，逐层往上问保证拿到的是**本页那一栏**。按 `tabType` 而不是
     *    「第 2 个子节点」—— 七格顺序是排版，不是契约。
     */
    private findHeroTabHost(): MainTabHost | null {
        let scope: typeof this.node | null = this.node;
        while (scope) {
            const host = scope.getComponent(MainTabHost);
            if (host?.isValid && host.navBar?.isValid) return host;
            scope = scope.parent;
        }
        return null;
    }

    private findHeroTabButton(): TabButton | null {
        const host = this.findHeroTabHost();
        if (!host) return null;
        return host.navBar.getComponentsInChildren(TabButton)
            .find((item) => item?.isValid && item.tabType === MainTab.Hero) ?? null;
    }

    /** 英雄按钮**图标**中心的世界坐标（飞行终点）；拿不到变换返回 null ⇒ 回落默认落点。 */
    private heroTabWorldPositionOf(button: TabButton | null): Vec3 | null {
        const icon = button?.isValid ? button.icon : null;
        if (!icon?.isValid) return null;
        const transform = icon.node.getComponent(UITransform);
        if (!transform) return null;
        return transform.convertToWorldSpaceAR(new Vec3(0, 0, 0), new Vec3());
    }

    /**
     * 找**本页**那条资源栏：从本节点逐层往上问 `getComponentInChildren`。
     *
     * 🔴 不许从场景根搜 —— 商城 / 天赋页内嵌的是**同一个** `common/ResBar` 公共件，
     * 从根搜很容易先命中被弹窗盖住的那一份，图标就飞到一个看不见的格子里去了。
     */
    private findResBar(): ResBar | null {
        let scope: typeof this.node | null = this.node;
        while (scope) {
            const bar = scope.getComponentInChildren(ResBar);
            if (bar?.isValid) return bar;
            scope = scope.parent;
        }
        return null;
    }

    /**
     * 奖励 → 图标（**游戏内**的资源图标，不另画一套）。
     *
     * 解析口径与全工程一致：`ResTypes.resBarCellOfRefId` **先 `roleProperty`、再 `item`**，
     * 拼路径交给 `ResTypes.resBarIconSpritePath`（两支拼法不同，见那里的表）。
     * 结果按 `resId` 缓存 —— 同一批奖励里同种资源只查一次表、只加载一次图。
     */
    private async collectRewardIcons(
        rewards: readonly (TerritoryIdleRewardGain | ITerritoryGrantedReward)[],
    ): Promise<ITerritoryChestIconEntry[]> {
        const unique: number[] = [];
        for (const reward of rewards) {
            const resId = Number(reward?.resId);
            if (!Number.isFinite(resId) || resId <= 0) continue;
            if (!unique.includes(resId)) unique.push(resId);
        }
        await Promise.all(unique.map((resId) => this.ensureRewardIcon(resId)));
        return rewards.map((reward) => ({
            resId: Number(reward.resId),
            amount: Number(reward.amount) || 0,
            frame: this.rewardIcons.get(Number(reward.resId)) ?? null,
        }));
    }

    /**
     * 取一张资源图标并缓存（失败也缓存 `null`，避免每批奖励都重试一遍加载）。
     *
     * ## 🔴 必须查**两张表**（2026-10-26 修）
     *
     * 随机资源格发的是**道具**（兵种经验 / 图纸 / 升级石…），它们的 `resId` 只在 `item` 表里
     * （`16001` 精灵弓箭手、`16014` 天赋石…）。老写法只把 `roleProperty` 传进
     * `resBarCellOfRefId(resId, rows)`，`itemRows` 留空 ⇒ `itemRowOfResId(undefined, …)` 恒为
     * `null` ⇒ **`kind` 只能是 `roleProperty` 或 `unknown`**，下面那支 `item` 分支是**死代码**。
     *
     * 现场症状：点开随机格 → 4 条 `+165 / +143 / +141 / +151` 飘字**前面全没有图标**，
     * 12 颗喷发粒子也是**全空**（`TerritoryGainBurst` 与飘字共用 `gainIcons` 里同一批 frame，
     * frame 为 `null` 时 `Sprite` 什么都不画）⇒ 玩家看到的就是「资源奖励的粒子动画丢了」。
     *
     * ## 🔴 `item` 的图**不在 `resources` 里**
     *
     * `item.icon` = `icons/item/图标_兵书弓兵`，实盘在 `assets/bundles/main-pages/icons/item/…`
     * （`BundleCatalog.BUNDLE_DIRECTORIES[MAIN_PAGES_BUNDLE]` 登记了这一族目录）。
     * 所以：
     *   · 少拼 `/spriteFrame` ⇒ `Bundle resources doesn't contain …`（**不是 404**）；
     *   · 当成 `resources` 路径直接 load ⇒ **静默 null**（老写法 `assets.load(cell.icon, …)` 两坑都踩）。
     *
     * 现在统一走 `resBarIconSpritePath(cell)` 拿全名，bundle 由 `CocosAssetService` 按
     * `bundleForPath` 自动路由（`main-pages` 没加载时它自己 `loadBundle`）。
     *
     * 取不到图（表里没登记 / 美术缺失）**只让那一枚没图**：喷发照播、`+N` 照飘、奖励照发
     * —— 这是全工程既有口径（奖励格缺图就只剩品质框），**不放假图**：飘一个金币去代表「图纸」
     * 比没有图更误导。缺图会打一条 warn 带上 `resId`，催美术时有据可查。
     */
    private async ensureRewardIcon(resId: number): Promise<void> {
        if (this.rewardIcons.has(resId)) return;
        let frame: SpriteFrame | null = null;
        let path = '';
        try {
            const [propRows, itemRows] = await Promise.all([
                this.refRows<IResPropertyRow>(ROLE_PROPERTY_TABLE),
                this.refRows<IItemRefRow>(ITEM_TABLE),
            ]);
            path = resBarIconSpritePath(resBarCellOfRefId(resId, propRows, itemRows));
            if (path) frame = await this.assets.load(path, SpriteFrame);
        } catch {
            frame = null;
        }
        this.rewardIcons.set(resId, frame ?? null);
        if (!frame && path) {
            console.warn(`[MainTerritoryMap] 奖励图标加载失败（resId ${resId}）：${path}`
                + ' —— 表里登记了但图不在包里，请确认美术已导入并重新构建；缺图不影响发奖与数字飘字');
        } else if (!frame && !path) {
            console.warn(`[MainTerritoryMap] 奖励图标未登记（resId ${resId}）：`
                + `roleProperty / item 两张表都没有它的 icon —— 只能飘数字，请策划补表或补图`);
        }
    }

    /**
     * 取一张配置表（`roleProperty` / `item`），**按表名记忆 Promise**。
     *
     * 随机格一次可能连开好几格、每格 3~5 种资源，逐个 `await getRefAllAsync` 会把同一张表
     * 反复进出缓存（`RefUtil` 内部虽有缓存，但每次都要过一遍 `updateUseTime` / 超时检查）。
     * 记忆的是 **Promise 而不是结果**：并发取图时只有第一次真的读表，其余直接搭车。
     * 读失败记成空表，不重试 —— 与 `ensureRewardIcon` 的「失败也缓存」同一口径。
     */
    private refRows<T>(table: string): Promise<readonly T[]> {
        let pending = this.refTableCache.get(table);
        if (!pending) {
            pending = RefUtil.instance.getRefAllAsync(table).then(
                (rows) => (rows ?? []) as readonly unknown[],
                () => [] as readonly unknown[],
            );
            this.refTableCache.set(table, pending);
        }
        return pending as Promise<readonly T[]>;
    }

    /**
     * 结算：钱包类走飘字（`suppressGain` 时跳过）、其余走奖励弹窗。
     *
     *  `suppressGain = true` 只会出现在「刚播完开箱」这一路：那时飞出图标已经带过 `+N`。
     */
    private settleRewards(
        rewards: readonly (TerritoryIdleRewardGain | ITerritoryGrantedReward)[],
        originCellId: number | null,
        suppressGain: boolean,
    ): void {
        const { gains, popup } = splitTerritoryRewards(rewards);
        if (gains.length && !suppressGain) {
            const map = this.state?.map ?? null;
            const cellId = originCellId ?? map?.startCellId;
            if (cellId !== undefined && cellId !== null && cellId >= 0) {
                this.mapView.playResourceGain(cellId, gains);
            }
        }
        if (!popup.length) return;
        // FW.ShowReward 签名是服务端 CmdGoods[]，但 ShowRewardPage 内部归一化，
        // {resId:number, number:number} 形状兼容。
        FW.ShowReward(popup.map((reward) => ({
            resId: reward.resId,
            number: reward.amount,
        })) as unknown as CmdGoods[]);
    }

}
