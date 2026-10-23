import {
    _decorator,
    Component,
    EffectAsset,
    instantiate,
    Prefab,
    ScrollView,
    SpriteFrame,
    UITransform,
    Vec2,
    Vec3,
} from 'cc';
import type { AssetService } from '../../core/asset/AssetService';
import type { ConfigService } from '../../core/config/ConfigService';
import {
    HEX_GROUND_GLOW_ART_ROOT,
    RESOURCE_ICON_ART_ROOT,
    spriteFramePath,
    TERRITORY_CHEST_ART_ROOT,
} from '../ArtPaths';
import { GameRoute } from '../../core/runtime/GameRoute';
import { ProcedureManager } from '../../framework/procedure/ProcedureManager';
import { FW } from '../../framework/FW';
import { EventMgr } from '../../framework/event/EventMgr';
import { readRoleRow } from './MainRoleRow';
import { CacheMgr } from '../net/CacheMgr';
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
import { ZCGameLoader } from '../zcds/application/ZCGameLoader';
import { ZCGamePreload } from '../zcds/application/ZCGamePreload';
import { MAP_DIRECTORY } from '../zcds/ZCGame';
import type {
    TerritoryIdleRewardGain,
} from '../territory/model/TerritoryIdleReward';
import type { ITerritoryGrantedReward } from '../territory/model/TerritoryGrantedReward';
import {
    splitTerritoryRewards,
    TERRITORY_SILVER_RES_ID,
    TERRITORY_STAMINA_RES_ID,
} from '../territory/model/TerritoryResourceGain';
import {
    territoryChestTierOfRewards,
    type TerritoryChestTier,
} from '../territory/model/TerritoryChestTier';
import { TERRITORY_CHEST_OPEN_FRAMES } from '../territory/model/TerritoryChestAnimation';
import type { ITerritoryChestIconEntry } from '../territory/view/TerritoryChestView';
import {
    resBarCellOfRefId,
    resIconRoot,
    ROLE_PROPERTY_TABLE,
    type IResPropertyRow,
} from '../common/ResTypes';
import { RefUtil } from '../../framework/ref/RefUtil';
import { territoryMapOffsetForCell } from '../territory/model/TerritoryMapLayout';
import type { ITerritoryMapLayout } from '../territory/model/TerritoryMapLayout';
import type { ITerritorySaveOwner, TerritoryWallet } from '../territory/model/TerritorySaveStore';
import { TerritorySiteDetailPanel } from '../territory/view/TerritorySiteDetailPanel';
import { TerritoryMapView } from '../territory/view/TerritoryMapView';
import { TERRITORY_EVENTS, TERRITORY_PRESENTER_EVENTS } from '../territory/view/TerritoryEvents';
import type { TerritoryStationTarget } from '../territory/view/TerritoryStationView';
import { LoadingPopup } from '../common/LoadingPopup';

const { ccclass, property } = _decorator;
/** 兜底章节：服务器章节汇总还没到时，冒险页至少能开第 1 章。 */
const FALLBACK_CHAPTERS = [1] as const;

/**
 * 「冒险」页的 Passive View。
 *
 *  本类只做引擎生命周期、接线与渲染编排；**状态、流程、规则全部在纯 TS 的
 *  {@link TerritoryPresenter}**；页面仅订阅角色缓存更新，并将余额交给 Presenter 同步。
 *
 * | 关注点 | 归属 |
 * |---|---|
 * | 主城地图页骨架 / Widget 对齐 / 滚动裁剪惯性 | `ui/main/MainTerritoryMap.prefab` + `cc.ScrollView` |
 * | 六边格 / 连线 / 站点渲染 | `TerritoryMapView` |
 * | 站点详情弹窗 | `TerritorySiteDetailPanel` |
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

    @property({ type: Prefab, group: '节点引用', tooltip: '站点详情弹窗 prefab（ui/territory/TerritorySiteDetail）' })
    detailPrefab: Prefab = null!;

    /** 站点详情弹窗（onLoad 实例化，常驻页面、默认收起）。 */
    private detailPanel: TerritorySiteDetailPanel = null!;
    private presenter: TerritoryPresenter | null = null;
    private lastRenderedChapter = -1;
    /** tick 定时器只在首次渲染成功后挂一次（页面常驻期间一直跑）。 */
    private tickScheduled = false;
    /** `initialize` 注入的资源入口（`ensureBattlePreload` 构造对局加载器用）。 */
    private assets: AssetService | null = null;
    /** `initialize` 注入的配置入口（领地页常驻时可为对局预热资源）。 */
    private configs: ConfigService | null = null;
    /**
     * 对局资源预加载（与匹配页 `ZCGamePreload` 同款）：开战请求在途时并行启动，
     * 回包后 navigate 直接复用 —— 消除「服务端已回 `CmdStartBattleRspMsg` 还要等
     * 资源加载才进游戏」的延迟。navigate 后置空（资源已移交战斗页），下次开战重建。
     */
    private battlePreload: ZCGamePreload | null = null;
    /** 预加载失败标记：失败时 navigate 不带 preload，战斗页按原逻辑当场加载（不回退阻塞）。 */
    private battlePreloadFailed = false;
    /**
     * 开箱表演要用的资源图标：`resId → 帧`（`null` = 查不到，只是那枚没有图）。
     *
     *  **按需加载 + 永久缓存**：奖励的 `resId` 是服务端回的，配置期不可能穷举；
     *  一次开箱最多 3~5 种，加载完就留在表里，下次同种资源直接命中。
     */
    private readonly rewardIcons = new Map<number, SpriteFrame | null>();

    /** 由 `MainTabHost` 注入资源入口（setParent 触发 onLoad 之前）。 */
    initialize(assets: AssetService, configs?: ConfigService): void {
        this.assets = assets;
        this.configs = configs ?? null;
        const role = readRoleRow();
        const saveOwner: ITerritorySaveOwner | null = role ? {
            roleId: toIdString(role.id),
            serverId: toIdString(role.selectServerId),
        } : null;
        // 章节列表来自登录后拉到的 `ChapterInfo.chapters`（TerritoryChapterInfoRepository）。
        // 没拉到时兜底 [1] —— 与历史硬编码一致，首屏不空白。
        const availableChapters = TerritoryChapterInfoRepository.instance.availableChapters;
        this.presenter = new TerritoryPresenter({
            loader: new TerritoryChapterLoader(assets),
            gateway: new TerritoryCellRepository(),
            store: new TerritorySaveStoreAdapter(saveOwner, availableChapters, availableChapters[0] ?? FALLBACK_CHAPTERS[0]),
            availableChapters,
            lifecycleHost: this,
            walletSeed: () => this.walletSeed(),
            readServerWallet: () => this.readServerWallet(),
            outputs: {
                navigateToBattle: (pve, battle) => {
                    const preload = this.battlePreloadFailed ? undefined : this.battlePreload;
                    // 无论移交成功与否，本次都用掉了：下次开战按 `busyBattle` 重建。
                    this.battlePreload = null;
                    this.battlePreloadFailed = false;
                    ProcedureManager.navigate(GameRoute.Battle, {
                        pve: { ...pve, territorySaveOwner: saveOwner },
                        battle,
                        selfRoleId: saveOwner?.roleId,
                        preload,
                    });
                },
                showTip: (text) => FW.showTip(text),
                showRewards: (rewards, originCellId, presentation) =>
                    this.presentRewards(rewards, originCellId, presentation),
                // 写请求在途 = 全屏 loading 遮挡（引用计数，多个并发请求只显一层）：
                // 请求期间玩家点不到地图/按钮，从源头防「服务端还没响应就快速连点」。
                setBusy: (busy, text) => {
                    if (busy) {
                        LoadingPopup.show(text);
                        // 🔴 开战请求在途 ⇒ **并行**预加载对局资源：服务端回包前资源已在加载，
                        // 回包后 navigate 直接复用，不再出现「CmdStartBattleRspMsg 已回、还等一会才进游戏」。
                        if (text === TERRITORY_TEXTS.busyBattle) this.ensureBattlePreload();
                    } else {
                        LoadingPopup.hide();
                    }
                },
            },
        });
        // 状态变更通知走 `EventMgr` 全局中控（zcds 同款）：`onDestroy` 里 `offTarget(this)` 摘净。
        EventMgr.instance.on(TERRITORY_PRESENTER_EVENTS.StateChange, this.onPresenterStateChange, this);
        void this.loadHexFlipAssets(assets);
        void this.loadResourceGainIcons(assets);
        void this.loadChestArt(assets);
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
        CacheMgr.instance.setEventUpdate('CmdRole', this as unknown as destroyable, this.onRoleCacheUpdate);
        // 弹窗先于任何首帧渲染实例化（renderAll 会开它）。
        const detailNode = instantiate(this.detailPrefab);
        detailNode.setParent(this.node);
        detailNode.setPosition(Vec3.ZERO);
        this.detailPanel = detailNode.getComponent(TerritorySiteDetailPanel)!;
        this.detailPanel.initialize();
        this.detailPanel.close();
        // 视图间通知走节点事件（`TERRITORY_EVENTS` 契约）：监听挂组件自身节点，随节点销毁清理。
        this.detailPanel.node.on(TERRITORY_EVENTS.DETAIL_CLOSE, this.onDetailClose, this);
        this.detailPanel.node.on(TERRITORY_EVENTS.DETAIL_START, this.onDetailStart, this);

        this.mapView.initialize();
        // 开箱表演期间锁滚动（需求 2026-10-22 §4）：表演挂在**页面坐标**上，而地图是 ScrollView
        // 的 content —— 播放时拖一下地图，宝箱就和地块错位了（实机 screenshot-3）。
        // 关 `ScrollView.enabled` 会一并摘掉拖拽监听，比改 `vertical/horizontal` 干净。
        this.mapView.scrollLock = (locked) => {
            if (this.mapScrollView?.isValid) this.mapScrollView.enabled = !locked;
        };
        this.mapView.node.on(TERRITORY_EVENTS.STATION_CLICK, this.onSiteClick, this);

        if (!this.presenter) {
            // 资源入口缺失是宿主注入错误（开发配置问题），不整页锁死：轻提示 + 留空页面。
            console.error('[MainTerritoryMap] 缺少资源入口（MainTabHost 未注入 assets），无法加载领地');
            FW.showTip(TERRITORY_TEXTS.loadingResourceMissing);
        }
    }

    start(): void {
        this.presenter?.start();
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
        CacheMgr.instance.removeEventUpdate('CmdRole', this as unknown as destroyable, this.onRoleCacheUpdate);
        EventMgr.instance.offTarget(this);
        this.presenter?.dispose();
        // 预加载资源未移交（没进战斗）⇒ 释放，避免常驻内存；已移交则归战斗页 scope。
        this.battlePreload?.releaseFromMatching();
        this.battlePreload = null;
        // 开箱表演正在播 ⇒ 收起（`stop` 不回调结算；页面都要没了，结算已由 Presenter 落库）。
        this.mapView?.stopChestPlay();
        // ⚠️ 这里不再对子节点调 `off(...)`：`Node._onPreDestroyBase()` 先销毁子节点、
        // 再跑本函数，节点销毁时 EventTarget 已释放，监听不泄漏；引擎这版 `Node.off` 不判空，
        // 手动摘必抛。同族规则见 docs/AI架构与代码规范.md §7.2。
    }

    /**
     * 对局资源预加载（与匹配页 `ZCGamePreload` 同款）：点击开战（busy 回调 `busyBattle`）
     * 时与网络请求**并行**启动 `ZCGameLoader.prepare`，回包后 `navigateToBattle` 把
     * `preload` 交给 `ProcedureGame` 复用 —— 资源在请求期间已就绪，进游戏不再等加载。
     * 失败静默回退：标记失败后 navigate 不带 preload，战斗页按原逻辑当场加载。
     */
    private ensureBattlePreload(): void {
        if (!this.configs || !this.assets) return;
        if (this.battlePreload && !this.battlePreloadFailed) return;
        this.battlePreloadFailed = false;
        const preload = new ZCGamePreload(new ZCGameLoader(
            this.assets, this.configs, MAP_DIRECTORY, Math.random, TERRITORY_DEFAULT_PLAYER_COUNT,
        ));
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

    private renderAll(): void {
        const state = this.presenter?.state;
        if (!state || !state.ready || !state.map || !state.progress) return;
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
        if (state.detail.open && state.detail.content) {
            this.detailPanel.open(state.detail.content);
        } else if (!state.detail.open && this.detailPanel.isOpen) {
            this.detailPanel.close();
        }
    }

    private scrollToCell(cellId: number, layout: ITerritoryMapLayout): void {
        const viewport = this.mapScrollView.node.getComponent(UITransform);
        if (!viewport) throw new Error('领地地图视口缺少 UITransform');
        const offset = territoryMapOffsetForCell(layout, cellId, viewport.contentSize);
        this.mapScrollView.stopAutoScroll();
        this.mapScrollView.scrollToOffset(new Vec2(offset.x, offset.y), 0);
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
    private readonly onDetailStart = (): void => { this.presenter?.requestBattle(); };
    private readonly onSiteClick = (target: TerritoryStationTarget): void => {
        if ('kind' in target) this.presenter?.selectRandomResource(target.cellId);
        else this.presenter?.selectSite(target);
    };

    /**
     * 发奖反馈：**带来源格（宝箱 / 随机格）⇒ 先播开箱表演，再结算；挂机产出 ⇒ 直接飘字 / 弹窗**
     * （2026-10-22 用户口径）。
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
        // 随机资源格：**不播开箱**，直接在格子上喷资源（需求 2026-10-22 §1）。
        // 由 Presenter 指定（`{ chest: false }`），页面不自己判格子类型 —— 那是玩法口径。
        if (presentation?.chest === false) {
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
        const started = this.mapView.playChestOpen(cellId, tier, entries, () => {
            if (this.isValid) this.settleRewards(rewards, cellId, true);
        });
        // 没播起来（格子不在视口 / 覆盖层没建起来）⇒ 立刻结算，绝不能把奖励吞掉。
        if (!started) this.settleRewards(rewards, cellId, true);
    }

    /**
     * 奖励 → 图标（**游戏内**的资源图标，不另画一套）。
     *
     * 解析口径与全工程一致：`roleProperty` 表 → `resIconRoot(icon)`（默认 `icons/resource`，
     * 三张例外见 `ResTypes.ROLE_PROPERTY_ICON_ROOT_OVERRIDE`）；`item` 表那支的 `icon` 本身就是路径。
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

    /** 取一张资源图标并缓存（失败也缓存 `null`，避免每批奖励都重试一遍加载）。 */
    private async ensureRewardIcon(resId: number): Promise<void> {
        if (this.rewardIcons.has(resId)) return;
        const assets = this.assets;
        if (!assets) {
            this.rewardIcons.set(resId, null);
            return;
        }
        let frame: SpriteFrame | null = null;
        try {
            const rows = (await RefUtil.instance.getRefAllAsync(ROLE_PROPERTY_TABLE) ?? []) as IResPropertyRow[];
            const cell = resBarCellOfRefId(resId, rows);
            if (cell.kind === 'roleProperty' && cell.icon) {
                frame = await assets.load(spriteFramePath(resIconRoot(cell.icon), cell.icon), SpriteFrame);
            } else if (cell.kind === 'item' && cell.icon) {
                // `item` 表的 `icon` 已经是**相对 resources 的路径**（见 `ResTypes.resBarCellOfRefId`）。
                frame = await assets.load(cell.icon, SpriteFrame);
            }
        } catch {
            frame = null;
        }
        this.rewardIcons.set(resId, frame ?? null);
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
