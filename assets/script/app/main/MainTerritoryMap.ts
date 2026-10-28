import type { SessionAssetService } from '../../core/asset/SessionAssetService';
import { createZCBattlePreload } from '../zcds/application/ZCBattlePreparation';
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
import { scopeAssetService, type AssetService } from '../../core/asset/AssetService';
import { ResourceScope } from '../../core/asset/ResourceScope';
import type { ConfigService } from '../../core/config/ConfigService';
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
import type { ZCBattleStart } from '../battle/BattleStartModel';
import { ProcedureManager } from '../../framework/procedure/ProcedureManager';
import { FW } from '../../framework/FW';
import { EventMgr } from '../../framework/event/EventMgr';
import { readRoleRow } from './MainRoleRow';
import { CacheMgr } from '../net/CacheMgr';
import { GameNet } from '../net/GameNet';
import { toCount, toIdString } from '../net/RequestGuard';
import { TerritoryChapterLoader } from '../territory/application/TerritoryChapterLoader';
import { TerritoryCellRepository } from '../territory/application/TerritoryCellRepository';
import { TerritoryChapterInfoRepository } from '../territory/application/TerritoryChapterInfoRepository';
import { TerritorySaveStoreAdapter } from '../territory/application/TerritorySaveStoreAdapter';
import {
    TERRITORY_DEFAULT_PLAYER_COUNT,
    TERRITORY_FALLBACK_WALLET,
    TERRITORY_TEXTS,
} from '../territory/application/TerritoryTexts';
import { TerritoryPresenter } from '../territory/application/TerritoryPresenter';
import type { ITerritoryRewardPresentation } from '../territory/application/TerritoryPresenter';
import type { ZCGamePreload } from '../zcds/application/ZCGamePreload';
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
import {
    territoryMapContentPaddingBottom,
    territoryMapContentPaddingTop,
    territoryMapOffsetForCell,
} from '../territory/model/TerritoryMapLayout';
import type { ITerritoryMapLayout } from '../territory/model/TerritoryMapLayout';
import type { ITerritorySaveOwner, TerritoryWallet } from '../territory/model/TerritorySaveStore';
import { TerritoryMapView } from '../territory/view/TerritoryMapView';
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
} from '../territory/application/TerritoryPresenter';
import { qualityFrameArtPath } from '../itemdetail/ItemDetailArt';
import { qualityFrameSuffixOf } from '../itemdetail/ItemDetailTable';
import { TERRITORY_EVENTS, TERRITORY_PRESENTER_EVENTS } from '../territory/view/TerritoryEvents';
import type { TerritoryStationTarget } from '../territory/view/TerritoryStationView';
import { LoadingPopup } from '../common/LoadingPopup';

const { ccclass, property } = _decorator;
/** 兜底章节：服务器章节汇总还没到时，冒险页至少能开第 1 章。 */
const FALLBACK_CHAPTERS = [1] as const;

/**
 * 顶部 HUD（个人信息框 + 好友 / 邮件 / 排行榜 / 邀请）的节点名。
 *
 * 它与本页**同级**（都在宿主页 `ArenaRoot` 下），不在地图 prefab 里 ⇒ 只能按名字往上找。
 * ⚠️ 尺寸不许抄 prefab 数字：它挂 `Widget` + 长屏适配（`MainHudLayout` 按安全区改 `top`），
 *    底边随屏幕比例变，抄死数值在长屏上会差几十像素。
 */
const TOP_HUD_NODE_NAME = 'TopHud';

/**
 * 「冒险」页的 Passive View。
 *
 *  本类只做引擎生命周期、接线与渲染编排；**状态、流程、规则全部在纯 TS 的
 *  {@link TerritoryPresenter}**；页面订阅角色缓存与格子消息，将解析后的数据交给 Presenter。
 *
 * | 关注点 | 归属 |
 * |---|---|
 * | 主城地图页骨架 / Widget 对齐 / 滚动裁剪惯性 | `ui/main/MainTerritoryMap.prefab` + `cc.ScrollView` |
 * | 六边格 / 连线 / 站点渲染 | `TerritoryMapView` |
 * | 状态与业务编排（纯 TS、可单测） | `TerritoryPresenter` |
 * | 章节加载 / 本地存档（端口适配器） | `TerritoryChapterLoader` / `TerritorySaveStoreAdapter` |
 *
 *  ⚠️ `assets` 由 `MainTabHost` 在实例化后、`setParent`（触发 onLoad）之前注入 `initialize`，
 *  不要在这里直调 `resources.load`。
 */
@ccclass('MainTerritoryMap')
export class MainTerritoryMap extends Component {
    @property({ type: ScrollView, group: '节点引用', tooltip: 'MapScrollView：地图滚动容器（视口裁剪 + 惯性回弹）' })
    mapScrollView: ScrollView = null!;

    @property({ type: TerritoryMapView, group: '节点引用', tooltip: 'MapScrollView 的内容层（六边格 / 连线 / 站点）' })
    mapView: TerritoryMapView = null!;

    @property({ type: Prefab, group: '节点引用', tooltip: '异步据点「玩家关卡」弹窗 prefab（ui/territory/BigMapPlayerLevelPanel）' })
    playerStagePrefab: Prefab = null!;


    /** 站点详情弹窗（onLoad 实例化，常驻页面、默认收起）。 */
    /** 异步据点「玩家关卡」弹窗（同 `detailPanel`，两个面板互斥显示）。 */
    private playerStagePanel: BigMapPlayerLevelPanel = null!;

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
    private presenter: TerritoryPresenter | null = null;
    private cellRepository: TerritoryCellRepository | null = null;
    /** 领地存档归属（roleId/serverId），进入对局时随 pve 一并下发。 */
    private saveOwner: ITerritorySaveOwner | null = null;
    private lastRenderedChapter = -1;
    /** 首次数据就绪并成功渲染的一次性回调：宿主（MainTabHost）用来确认首屏就绪。 */
    private firstReadyCallback: (() => void) | null = null;
    private firstReadyNotified = false;
    /** tick 定时器只在首次渲染成功后挂一次（页面常驻期间一直跑）。 */
    private tickScheduled = false;
    /** `initialize` 注入的资源入口（`ensureBattlePreload` 构造对局加载器用）。 */
    private readonly resourceScope = new ResourceScope('territory-page');
    private assets: AssetService | null = null;
    /** `initialize` 注入的配置入口（领地页常驻时可为对局预热资源）。 */
    private configs: ConfigService | null = null;
    /**
     * 对局资源预加载（与匹配页 `ZCGamePreload` 同款）：开战请求在途时并行启动，
     * 回包后 navigate 直接复用 —— 消除「服务端已回 `CmdStartBattleRspMsg` 还要等
     * 资源加载才进游戏」的延迟。navigate 后置空（资源已移交战斗页），下次开战重建。
     */
    private sessionAssets: SessionAssetService | null = null;
    private battlePreload: ZCGamePreload | null = null;
    /** 预加载失败标记：失败时 navigate 不带 preload，战斗页按原逻辑当场加载（不回退阻塞）。 */
    private battlePreloadFailed = false;
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

    setSessionAssetService(service: SessionAssetService | null): void { this.sessionAssets = service; }

    /** 由 `MainTabHost` 注入资源入口（setParent 触发 onLoad 之前）。 */
    initialize(assets: AssetService, configs?: ConfigService): void {
        const pageAssets = scopeAssetService(assets, this.resourceScope);
        this.assets = pageAssets;
        this.configs = configs ?? null;
        const role = readRoleRow();
        this.saveOwner = role ? {
            roleId: toIdString(role.id),
            serverId: toIdString(role.selectServerId),
        } : null;
        // 章节列表来自登录后拉到的 `ChapterInfo.chapters`（TerritoryChapterInfoRepository）。
        // 没拉到时兜底 [1] —— 与历史硬编码一致，首屏不空白。
        const availableChapters = TerritoryChapterInfoRepository.instance.availableChapters;
        this.cellRepository = new TerritoryCellRepository();
        this.presenter = new TerritoryPresenter({
            loader: new TerritoryChapterLoader(pageAssets),
            gateway: this.cellRepository,
            store: new TerritorySaveStoreAdapter(this.saveOwner, availableChapters, availableChapters[0] ?? FALLBACK_CHAPTERS[0]),
            availableChapters,
            lifecycleHost: this,
            walletSeed: () => this.walletSeed(),
            readServerWallet: () => this.readServerWallet(),
        });
        // Presenter → 页面通知统一走 EventMgr（zcds 同款）：`onDestroy` 里 `offTarget(this)` 摘净。
        EventMgr.instance.on(TERRITORY_PRESENTER_EVENTS.StateChange, this.onPresenterStateChange, this);
        EventMgr.instance.on(TERRITORY_PRESENTER_EVENTS.NavigateToBattle, this.onNavigateToBattle, this);
        EventMgr.instance.on(TERRITORY_PRESENTER_EVENTS.ShowTip, this.onShowTip, this);
        EventMgr.instance.on(TERRITORY_PRESENTER_EVENTS.ShowRewards, this.onShowRewards, this);
        EventMgr.instance.on(TERRITORY_PRESENTER_EVENTS.SetBusy, this.onSetBusy, this);
        void this.loadHexFlipAssets(pageAssets);
        void this.loadResourceGainIcons(pageAssets);
        void this.loadChestArt(pageAssets);
        void this.loadCloudArt(pageAssets);
    }

    /**
     * 「未解锁云」的四套图：`image/territory/cloud/` 下按前缀分四组。
     *
     * · `cloud_body_0` / `cloud_shadow_0` = 未解锁的**静止**云体与影子（各一张，不轮播）；
     * · `cloud_dissolve_body_0…1` / `cloud_dissolve_shadow_0…1` = 解锁消散（各两帧）。
     *
     * ⚠️ **必须按前缀分开、各自按文件名排序**：`loadDir` 返回顺序不保证（同族坑见
     * `loadHexFlipAssets`），混在一个数组里按名排序会让 `cloud_dissolve_*` 排到
     * `cloud_body_*` 之前，帧序就整体错位了。
     *
     * 一张都取不到 ⇒ 整条表现关闭（地图照常渲染），并打一条 warn —— 刚加的图忘了
     * 刷新资源库时能一眼看到原因，而不是"云神秘消失"。
     */
    private async loadCloudArt(assets: AssetService): Promise<void> {
        const groups = {
            body: 'cloud_body_',
            shadow: 'cloud_shadow_',
            dissolveBody: 'cloud_dissolve_body_',
            dissolveShadow: 'cloud_dissolve_shadow_',
        } as const;
        let frames: SpriteFrame[] = [];
        try {
            frames = (await assets.loadDir(TERRITORY_CLOUD_ART_ROOT, SpriteFrame) ?? [])
                .filter((frame) => !!frame?.name);
        } catch {
            // 目录整个没导入 ⇒ 下面统一按"全是空数组"降级。
        }
        const pick = (prefix: string): SpriteFrame[] => frames
            .filter((frame) => frame.name.startsWith(prefix))
            .sort((a, b) => a.name.localeCompare(b.name));
        if (!this.isValid) return;
        if (!pick(groups.body).length) {
            console.warn('[MainTerritoryMap] 未解锁云帧缺失（image/territory/cloud/'
                + 'cloud_body_0 / cloud_shadow_0…），章节地图不盖云；若是刚加的图，请在资源管理器里刷新一次让编辑器导入');
        }
        this.mapView.setCloudFrames({
            body: pick(groups.body),
            shadow: pick(groups.shadow),
            dissolveBody: pick(groups.dissolveBody),
            dissolveShadow: pick(groups.dissolveShadow),
        });
    }

    /**
     * 飘字要用的两张资源图标（银币 `resId 7` / 体力 `resId 9`）。
     *
     * 与翻格资源**分开 try**：缺图只让那条飘字没有图标（数字照常升起），
     * 不该把翻格表现一起废掉。
     */
    private async loadResourceGainIcons(assets: AssetService): Promise<void> {
        const names = new Map<number, string>([
            [TERRITORY_SILVER_RES_ID, '图标_铜币'],
            [TERRITORY_STAMINA_RES_ID, '图标_体力'],
        ]);
        const frames = new Map<number, SpriteFrame | null>();
        await Promise.all(Array.from(names, async ([resId, name]) => {
            try {
                frames.set(resId, await assets.load(
                    spriteFramePath(RESOURCE_ICON_ART_ROOT, name), SpriteFrame));
            } catch {
                frames.set(resId, null);
            }
        }));
        if (!this.isValid) return;
        this.mapView.setGainIcons(frames);
        // 「玩家关卡」弹窗两颗按钮的费用图标 = 同一枚银币（页面统一加载，弹窗不解表）。
        if (this.playerStagePanel) this.playerStagePanel.setCostIcon(frames.get(TERRITORY_SILVER_RES_ID) ?? null);
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
    private async loadChestArt(assets: AssetService): Promise<void> {
        const names = Array.from(
            { length: TERRITORY_CHEST_OPEN_FRAMES },
            (_, index) => `chest_seq_${index}`,
        );
        const loaded = await Promise.all(names.map(async (name) => {
            try {
                return await assets.load(spriteFramePath(TERRITORY_CHEST_ART_ROOT, name), SpriteFrame);
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
    private async loadHexFlipAssets(assets: AssetService): Promise<void> {
        try {
            const effect = await assets.load('shaders/hex-flip', EffectAsset);
            if (!this.isValid) return;
            this.mapView.setFlipEffect(effect ?? null);
        } catch {
            // 透视材质缺失：降级成等比压扁（`TerritoryHexFlip` 自己回退）。
        }
        try {
            const frames = await assets.loadDir(HEX_GROUND_GLOW_ART_ROOT, SpriteFrame);
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
        CacheMgr.instance.setEventUpdate('CmdRole', this, this.onRoleCacheUpdate);
        this.bindCellEvents();
        // 「玩家关卡」弹窗（异步据点）与站点详情同层、互斥显示：
        // 两者共用 DETAIL_CLOSE / DETAIL_START，玩家关卡多一条 DETAIL_SCOUT。
        const stageNode = instantiate(this.playerStagePrefab);
        stageNode.setParent(this.node);
        stageNode.setPosition(Vec3.ZERO);
        this.playerStagePanel = stageNode.getComponent(BigMapPlayerLevelPanel)!;
        // 面板自己的根节点挂四边对齐 Widget，交给引擎撑满；这里只传一份设计尺寸做兜底缩放。
        const pageSize = this.node.getComponent(UITransform)?.contentSize;
        this.playerStagePanel.initialize(pageSize?.width ?? 0, pageSize?.height ?? 0, null);
        this.playerStagePanel.close();

        // 关卡 / 首领的两个弹窗走 `PopupBase`（`PopupManager` 负责层级栈、遮罩、点击空白关闭、
        // 尺寸拉伸），页面**不实例化、不撑尺寸**，只在需要时 open / applyContent / close。
        //   · 感叹号 → `LEVEL_TIP_OPEN`，打开提示时下层关卡界面自动收 `onCover`；
        //   · 提示关闭只派发 `LEVEL_TIP_CLOSE`（不连带下面的关卡界面）。

        //  弹窗按钮统一走 `EventMgr`：四个弹窗共用一套语义，页面**只订阅一次**。
        //  旧写法给每个弹窗的 node 各挂一份 —— `DETAIL_CLOSE`/`DETAIL_START` 挂了三遍，
        //  换成全局事件后会一次触发三次（`requestBattle()` 就连发三个开战请求）。
        EventMgr.instance.on(TERRITORY_EVENTS.DETAIL_CLOSE, this.onDetailClose, this);
        EventMgr.instance.on(TERRITORY_EVENTS.DETAIL_START, this.onDetailStart, this);
        EventMgr.instance.on(TERRITORY_EVENTS.DETAIL_SCOUT, this.onDetailScout, this);
        EventMgr.instance.on(TERRITORY_EVENTS.LEVEL_TIP_OPEN, this.onLevelTipOpen, this);
        EventMgr.instance.on(TERRITORY_EVENTS.LEVEL_TIP_CLOSE, this.onLevelTipClose, this);
        EventMgr.instance.on(TERRITORY_EVENTS.STATION_CLICK, this.onSiteClick, this);

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

        if (!this.presenter) {
            // 资源入口缺失是宿主注入错误（开发配置问题），不整页锁死：轻提示 + 留空页面。
            console.error('[MainTerritoryMap] 缺少资源入口（MainTabHost 未注入 assets），无法加载领地');
            FW.showTip(TERRITORY_TEXTS.loadingResourceMissing);
        }
        // 防御：章节若在 onLoad 前已就绪（如重进复用），立即补一次完整绘制。
        if (this.presenter?.state.ready) this.renderAll();
    }

    start(): void {
        this.presenter?.start();
    }

    /**
     * 注册「首次数据就绪」回调（由宿主在页面挂载前注入）。
     * 只在首次 renderAll 成功时触发一次，触发后立即清空；传 `null` 可取消。
     */
    onFirstReady(callback: (() => void) | null): void {
        this.firstReadyCallback = callback;
    }

    /** 主城快速寻敌：打开当前 Boss 详情，并将地图移到同一个格子。 */
    focusCurrentBoss(): void {
        const presenter = this.presenter;
        if (!presenter) {
            FW.showTip(TERRITORY_TEXTS.loadingResourceMissing);
            return;
        }
        const cellId = presenter.focusCurrentBoss();
        if (cellId !== null) this.scrollToCell(cellId, presenter.state.layout);
    }

    onDestroy(): void {
        CacheMgr.instance.removeEventUpdate('CmdRole', this, this.onRoleCacheUpdate);
        GameNet.instance.removeCaller(this);
        EventMgr.instance.offTarget(this);
        this.presenter?.dispose();
        this.cellRepository = null;
        // 预加载资源未移交（没进战斗）⇒ 释放，避免常驻内存；已移交则归战斗页 scope。
        this.battlePreload?.releaseFromMatching();
        this.battlePreload = null;
        // 开箱表演正在播 ⇒ 收起（`stop` 不回调结算；页面都要没了，结算已由 Presenter 落库）。
        this.mapView?.stopChestPlay();
        // `view` 是全局单例，不摘会随页面复用累积回调（每次进来多跑一次重量）。
        view?.off?.('canvas-resize', this.onCanvasResize, this);
        this.mapInsetResizeBound = false;
        this.resourceScope.dispose();
        // ⚠️ 这里不再对子节点调 `off(...)`：`Node._onPreDestroyBase()` 先销毁子节点、
        // 再跑本函数，节点销毁时 EventTarget 已释放，监听不泄漏；引擎这版 `Node.off` 不判空，
        // 手动摘必抛。同族规则见 docs/AI架构与代码规范.md §7.2。
    }

    private bindCellEvents(): void {
        GameNet.instance.addEvent('CmdCityChapterPassCellBroMsg', this, this.onPassCellsBro);
        GameNet.instance.addEvent('CmdCityChapterCellInfoRspMsg', this, this.onCellInfo);
    }

    private onPassCellsBro(msg: unknown): void {
        if (!this.cellRepository || !this.presenter) return;
        const bro = this.cellRepository.readPassCellsBro(msg);
        if (bro) this.presenter.applyPassCellsBro(bro.levelChapter, bro.cellIds);
    }

    private onCellInfo(msg: unknown): void {
        if (!this.cellRepository || !this.presenter) return;
        const map = this.presenter.state.map;
        if (!map) return;
        const state = this.cellRepository.readCellInfo(msg, map.rows * map.columns);
        if (state) this.presenter.applyCellInfoState(state);
    }

    /**
     * 回包后按实际阵容和本关波次准备资源，将同一个 preload 移交战斗流程。
     * 失败静默回退：标记失败后 navigate 不带 preload，战斗页按原逻辑当场加载。
     */
    private ensureBattlePreload(battle: ZCBattleStart | null, waveCardIds: readonly number[]): void {
        if (!this.configs || !this.assets) return;
        if (this.battlePreload && !this.battlePreloadFailed) return;
        this.battlePreloadFailed = false;
        const preload = createZCBattlePreload(this.sessionAssets?.reusableAssets ?? this.assets, this.configs,
            Promise.resolve(battle), { playerCount: TERRITORY_DEFAULT_PLAYER_COUNT, waveCardIds });
        void preload.ready.catch(() => {
            if (this.battlePreload === preload) this.battlePreloadFailed = true;
        });
        this.battlePreload = preload;
    }

    // ============================================================
    // 渲染（Passive View：幂等全量赋值，不读上一次状态）
    // ============================================================

    /** Presenter 状态变更（`TERRITORY_PRESENTER_EVENTS.StateChange`）：全量重渲染。 */
    private onPresenterStateChange(): void {
        this.renderAll();
    }

    private onNavigateToBattle(payload: ITerritoryNavigateBattlePayload): void {
        const { pve, battle } = payload;
        // 有效回包已被 Presenter 接受，此时关闭详情不会作废在途开战请求。
        // 弹窗挂在全局 PopupManager 下，必须在战斗流程接手时主动收起。
        this.closePopup(LevelTipPanel);
        this.closePopup(LevelInfoPanel);
        this.ensureBattlePreload(battle ?? null, pve.waves.map((wave) => wave.pvpCardId));
        const preload = this.battlePreloadFailed ? undefined : this.battlePreload;
        // 无论移交成功与否，本次都用掉了：下次开战按 busyBattle 重建。
        this.battlePreload = null;
        this.battlePreloadFailed = false;
        ProcedureManager.navigate(GameRoute.Battle, {
            pve: { ...pve, territorySaveOwner: this.saveOwner },
            battle,
            selfRoleId: this.saveOwner?.roleId,
            preload,
        });
    }

    private onShowTip(payload: ITerritoryShowTipPayload): void {
        FW.showTip(payload.text);
    }

    private onShowRewards(payload: ITerritoryShowRewardsPayload): void {
        this.presentRewards(payload.rewards, payload.originCellId, payload.options);
    }

    private onSetBusy(payload: ITerritorySetBusyPayload): void {
        // 写请求在途 = 全屏 loading 遮挡（引用计数，多个并发请求只显一层）：
        // 请求期间玩家点不到地图/按钮，从源头防「服务端还没响应就快速连点」。
        if (payload.busy) {
            LoadingPopup.show(payload.text);
        } else {
            LoadingPopup.hide();
        }
    }

    private renderAll(): void {
        const state = this.presenter?.state;
        if (!state || !state.ready || !state.map || !state.progress) return;
        // 首次成功渲染即通知宿主首屏就绪（一次性，之后切章不再触发）。
        if (!this.firstReadyNotified) {
            this.firstReadyNotified = true;
            const callback = this.firstReadyCallback;
            this.firstReadyCallback = null;
            callback?.();
        }
        // 数据就绪即挂 tick（进入页面/切章后只需一次；加载中 state.ready=false 不会走到这里）。
        this.ensureTicks();
        const resetScroll = state.chapterId !== this.lastRenderedChapter;
        this.lastRenderedChapter = state.chapterId;

        this.mapView.renderMap({
            map: state.map,
            layout: state.layout,
            art: state.art,
            progress: state.progress,
            revealedCells: state.revealedCells,
            siteOpenableCells: state.siteOpenableCells,
            stageByCell: state.stageByCell,
            randomResourceOpenableCells: state.randomResourceOpenableCells,
            pendingRandomResourceCells: state.pendingRandomResourceCells,
            pendingFixedResourceCells: state.pendingFixedResourceCells,
        });
        if (resetScroll) {
            this.scrollToCell(state.map.startCellId, state.layout);
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
    private closePopup(cls: typeof PopupBase): void {
        const opened = PopupManager.inst?.get(cls);
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
        const opened = PopupManager.inst?.get(LevelTipPanel);
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
        const opened = PopupManager.inst?.get(cls);
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
        const assets = this.assets;
        if (!assets) return;
        const missing = content.drops.filter((drop) => !this.playerStageIcons.has(drop.resId));
        if (missing.length === 0) return;
        await Promise.all(missing.map((drop) => this.loadPlayerStageIcon(drop.resId, assets)));
        if (!this.isValid) return;
        // 加载期间玩家可能已经关了弹窗或点了别的关卡
        if (this.presenter?.state.detail.levelInfo !== content) return;
        const opened = PopupManager.inst?.get(LevelInfoPanel);
        if (!opened) return;
        opened.applyContent(this.levelInfoContentOf(content));
    }

    /** 补敌军头像（`headIcon` 是 icon 表的 key，不是资源路径）。 */
    private async prefillLevelTipIcons(content: ITerritoryLevelTipContent, revision = this.levelTipRevision): Promise<void> {
        const assets = this.assets;
        if (!assets) return;
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
                const frame = await assets.load(spriteFramePath(target.root, target.art), SpriteFrame);
                if (this.isValid && frame.isValid) this.levelTipIcons.set(path, frame);
            } catch (error) {
                console.warn(`[LevelTipPanel] 敌军头像加载失败：${path}`, error);
            }
        }));
        if (!this.isValid || revision !== this.levelTipRevision) return;
        const opened = PopupManager.inst?.get(LevelTipPanel);
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
        const assets = this.assets;
        if (!assets) return;
        const missing = content.rewards.filter((reward) => !this.playerStageIcons.has(reward.resId));
        if (missing.length === 0) return;
        await Promise.all(missing.map((reward) => this.loadPlayerStageIcon(reward.resId, assets)));
        if (!this.isValid) return;
        if (this.presenter?.state.detail.playerStage !== content || !this.playerStagePanel.isOpen) return;
        this.playerStagePanel.open(this.playerStageContentOf(content));
    }

    /**
     * 载入一格奖励的「图标 + 品质框」。
     *
     * 口径与 `ensureRewardIcon` 一致（`roleProperty` 优先、`item` 兜底），多出来的只是
     * **品质框**：`roleProperty.quality` → `cu_quality_0N`。查不到品质就不显示框，
     * 但图标照常显示 —— 缺框是视觉损失，缺图标才是"这条奖励看着不存在"。
     */
    private async loadPlayerStageIcon(resId: number, assets: AssetService): Promise<void> {
        if (this.playerStageIcons.has(resId)) return;
        let icon: SpriteFrame | null = null;
        let frame: SpriteFrame | null = null;
        try {
            const [propRows, itemRows] = await Promise.all([
                this.refRows<IResPropertyRow>(ROLE_PROPERTY_TABLE),
                this.refRows<IItemRefRow>(ITEM_TABLE),
            ]);
            const path = resBarIconSpritePath(resBarCellOfRefId(resId, propRows, itemRows));
            if (path) icon = await assets.load(path, SpriteFrame);
            const quality = Number(propRows.find((row) => Number(row.resId) === resId)?.quality);
            if (Number.isFinite(quality) && quality > 0) {
                const framePath = spriteFramePathOf(`image/${qualityFrameArtPath(qualityFrameSuffixOf(quality))}`);
                frame = await assets.load(framePath, SpriteFrame).catch(() => null);
            }
        } catch {
            icon = null;
        }
        if (!this.isValid) return;
        this.playerStageIcons.set(resId, { frame, icon, amount: 0 });
    }

    private scrollToCell(cellId: number, layout: ITerritoryMapLayout): void {
        const viewport = this.mapScrollView.node.getComponent(UITransform)!;
        // ⚠️ 两份留白必须与内容层**同源**：`territoryMapOffsetForCell` 用它们算可滚上限，
        //    少传就等于按「没留白」算 —— 跳过去会停在半路（差的那截滚不到）。
        const offset = territoryMapOffsetForCell(layout, cellId, viewport.contentSize, {
            paddingBottom: this.mapView?.contentPaddingBottom,
            paddingTop: this.mapView?.contentPaddingTop,
        });
        this.mapScrollView.stopAutoScroll();
        this.mapScrollView.scrollToOffset(new Vec2(offset.x, offset.y), 0);
    }

    /**
     * 从**宿主页**找顶部 HUD（它与本页同级，不在地图 prefab 里）。
     *
     * ⚠️ 只能按名字往上找：地图页是 `MainTabHost` 动态挂上去的，HUD 是宿主的兄弟节点，
     *    没有引用可拿；`MainTopHudToggle` 那套同名查找也是这个口径。
     */
    private findTopHud(): Node | null {
        return this.node.parent?.getChildByName(TOP_HUD_NODE_NAME) ?? null;
    }

    /**
     * 顶部 HUD 底边到**视口顶部**的距离（px）。
     *
     * 两个 `getBoundingBoxToWorld()` 相减：一个取 HUD 的底边（`box.yMin`），一个取视口的顶边
     * （`box.yMax`）。都是世界坐标 ⇒ 不受中间节点的缩放 / 锚点影响。
     *
     * @returns 找不到 HUD / 视口时返回 0（= 退化成「没有 HUD 遮挡」那一档）。
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
     * 量一次 HUD 底边，把**上下两份**留白一起注入地图视图。
     *
     * 🔴 `hudBottom` **只量一次**：量世界包围盒要走两趟 `getBoundingBoxToWorld()`，
     *    两次注入各量一遍既浪费又可能取到两个不同帧的值（HUD 正在适配时上下限会错开）。
     *
     * 同时把视口尺寸交给视图（全解锁镜头散场要用它算「整张图入画」的倍率）。
     */
    private syncMapInsets(): void {
        if (!this.mapScrollView?.isValid || !this.mapView?.isValid) return;
        const viewport = this.mapScrollView.node.getComponent(UITransform);
        if (!viewport) return;
        const hudBottom = this.topHudBottom(viewport);
        this.mapView.setContentPaddingBottom(
            territoryMapContentPaddingBottom(viewport.height, hudBottom));
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
        if (!this.isValid) return;
        this.scheduleOnce(this.remapMapInsets, 0);
    }

    private remapMapInsets(): void {
        if (!this.isValid) return;
        this.syncMapInsets();
    }

    /** tick 定时器：首次渲染成功后挂一次（加载态不再停/启，Presenter 内部对未就绪状态判空）。 */
    private ensureTicks(): void {
        if (this.tickScheduled) return;
        this.tickScheduled = true;
        this.schedule(this.onFastTick, 1);
        this.schedule(this.onSlowTick, 60);
    }

    private walletSeed(): TerritoryWallet {
        return this.readServerWallet() ?? { ...TERRITORY_FALLBACK_WALLET };
    }

    private readServerWallet(): TerritoryWallet | null {
        const role = readRoleRow();
        if (!role) return null;
        return {
            silver: Math.max(0, toCount(role.gold)),
            stamina: Math.max(0, toCount(role.end)),
        };
    }

    private readonly onRoleCacheUpdate = (): void => {
        if (this.isValid) this.presenter?.refreshWalletFromServer();
    };

    // ============================================================
    // 视图事件处理（`TERRITORY_EVENTS` 契约，见 `TerritoryEvents.ts`）
    // ============================================================

    private readonly onDetailClose = (): void => { this.presenter?.closeDetail(); };
    private readonly onDetailStart = (): void => {
        this.sessionAssets?.pauseWarmup?.();
        // 关闭会派发 DETAIL_CLOSE 并递增 battleRequestId；请求期间保留详情，
        // 由 LoadingPopup 挡住重复输入，成功后在 onNavigateToBattle 统一关闭。
        this.presenter?.requestBattle();
    };
    /**
     * 「侦查」暂未开放：服务端既没有协议也没有对应扣费配置。
     *
     * 这里**只提示、不扣钱**（按钮上那个 10 银币是设计稿的展示值）。等协议落地，
     * 在 Presenter 加一个 `requestScout()` 走同样的端口链路即可，视图侧不用改。
     */
    private readonly onDetailScout = (): void => { FW.showTip(TERRITORY_TEXTS.asyncPlayerScoutUnavailable); };
    /** 关卡界面的感叹号 → 关卡提示。 */
    private readonly onLevelTipOpen = (): void => { this.presenter?.openLevelTip(); };
    /** 关卡提示关闭：只收提示，关卡界面留着。 */
    private readonly onLevelTipClose = (): void => { this.presenter?.closeLevelTip(); };
    private readonly onSiteClick = (target: TerritoryStationTarget): void => {
        if ('kind' in target) this.presenter?.selectRandomResource(target.cellId);
        else this.presenter?.selectSite(target);
    };

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
        const cellId = originCellId ?? null;
        // 随机资源格：**不播开箱、也不弹奖励窗**，直接在格子上喷资源（需求 2026-10-22 §1 / 2026-10-26 §3）。
        // 由 Presenter 指定（`{ chest: false }`），页面不自己判格子类型 —— 那是玩法口径。
        if (presentation?.chest === false) {
            void this.playCellGains(rewards, cellId);
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
            const assets = this.assets;
            this.readoutIconPending = assets
                ? assets.load(path, SpriteFrame).catch(() => {
                    console.warn('[MainTerritoryMap] 随机格读数图标加载失败：' + path
                        + ' —— 读数会只剩数字（喷发粒子不受影响）；'
                        + '请确认「种族经验球_随机」已导入 main-pages 的 icons/item/');
                    return null;
                })
                : Promise.resolve(null);
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
     * 把「奖励图标飞进资源栏 → 那一格跳动 + 闪光」这条链接上（2026-10-26 需求 ②）。
     *
     * ## 三个落点各管一段
     *
     * ```
     * resId → key        TERRITORY_WALLET_RES_KEY（7→gold / 9→end）
     * key   → 那格中心  ResBar.slotWorldPositionOf(key)（世界坐标）
     * 世界  → 覆盖层    TerritoryMapView.setRewardCatchWorldPoint(resId, world)（矩阵换算留在视图）
     * ```
     *
     * 拿到其它资源（道具 / 图纸）⇒ 不登记落点，图标按默认落点飞（那些资源**没有格子**，
     * 硬飞过去只会砸在某一格上撒谎）。
     *
     * ## 为什么回调里再算一次 key
     *
     * `TerritoryChestView` 的回调只给 `(resId, amount)` —— 它不知道资源栏长什么样，
     * 也不该知道。`resId → key` 是玩法口径，两次都走同一个纯函数，不缓存第二份映射。
     */
    private wireRewardCatch(
        rewards: readonly (TerritoryIdleRewardGain | ITerritoryGrantedReward)[],
    ): void {
        const bar = this.findResBar();
        if (!bar) {
            // 独立预览 / HUD 没挂这条栏：不阻断表演，只是图标飞向默认落点、没有资源栏反馈。
            console.warn('[MainTerritoryMap] 没找到资源栏（ResBar），奖励图标按默认落点飞、不做跳动/闪光');
            return;
        }
        this.mapView.clearRewardCatchPoints();
        for (const reward of rewards) {
            const resId = Number(reward?.resId);
            const key = territoryWalletResKeyOf(resId);
            if (!key) continue;
            // `null`（那一格没显示 / 取不到变换）= 清掉这一种资源的专属落点，回落默认。
            this.mapView.setRewardCatchWorldPoint(resId, bar.slotWorldPositionOf(key));
        }
        this.mapView.setRewardLandedHandler((resId, amount) => {
            const key = territoryWalletResKeyOf(resId);
            if (!key || !bar.isValid) return;
            bar.playGainFeedback(key, amount);
        });
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
        const assets = this.assets;
        if (!assets) {
            this.rewardIcons.set(resId, null);
            return;
        }
        let frame: SpriteFrame | null = null;
        let path = '';
        try {
            const [propRows, itemRows] = await Promise.all([
                this.refRows<IResPropertyRow>(ROLE_PROPERTY_TABLE),
                this.refRows<IItemRefRow>(ITEM_TABLE),
            ]);
            path = resBarIconSpritePath(resBarCellOfRefId(resId, propRows, itemRows));
            if (path) frame = await assets.load(path, SpriteFrame);
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
            const map = this.presenter?.state.map ?? null;
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

    private readonly onFastTick = (): void => this.presenter?.fastTick(Date.now());
    private readonly onSlowTick = (): void => this.presenter?.slowTick(Date.now());
}
