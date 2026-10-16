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
import type { AssetService } from '../../../core/asset/AssetService';
import { HEX_GROUND_GLOW_ART_ROOT, RESOURCE_ICON_ART_ROOT, spriteFramePath } from '../../ArtPaths';
import { GameRoute } from '../../../core/runtime/GameRoute';
import { ProcedureManager } from '../../../framework/procedure/ProcedureManager';
import { FW } from '../../../framework/FW';
import { readRoleRow } from '../../main/MainResBar';
import { CacheMgr } from '../../net/CacheMgr';
import { toCount, toIdString } from '../../net/RequestGuard';
import { TerritoryChapterLoader } from '../application/TerritoryChapterLoader';
import { TerritoryCellRepository } from '../application/TerritoryCellRepository';
import { TerritoryChapterInfoRepository } from '../application/TerritoryChapterInfoRepository';
import { TerritorySaveStoreAdapter } from '../application/TerritorySaveStoreAdapter';
import {
    TERRITORY_FALLBACK_WALLET,
    TERRITORY_TEXTS,
} from '../application/TerritoryTexts';
import { TerritoryPresenter } from '../application/TerritoryPresenter';
import type {
    TerritoryIdleRewardGain,
} from '../model/TerritoryIdleReward';
import type { ITerritoryGrantedReward } from '../model/TerritoryGrantedReward';
import {
    splitTerritoryRewards,
    TERRITORY_SILVER_RES_ID,
    TERRITORY_STAMINA_RES_ID,
} from '../model/TerritoryResourceGain';
import { territoryMapOffsetForCell } from '../model/TerritoryMapLayout';
import type { ITerritorySaveOwner, TerritoryWallet } from '../model/TerritorySaveStore';
import { TerritorySiteDetailPanel } from '../view/TerritorySiteDetailPanel';
import { TerritoryHeaderView } from '../view/TerritoryHeaderView';
import { TerritoryMapView } from '../view/TerritoryMapView';

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
 * | 页面骨架 / Widget 对齐 / 滚动裁剪惯性 | `ui/territory/TerritoryPage.prefab` + `cc.ScrollView` |
 * | 六边格 / 连线 / 站点渲染 | `TerritoryMapView` |
 * | 顶部章节信息 / 底部提示 | `TerritoryHeaderView` |
 * | 站点详情弹窗 | `TerritorySiteDetailPanel` |
 * | 状态与业务编排（纯 TS、可单测） | `TerritoryPresenter` |
 * | 章节加载 / 本地存档（端口适配器） | `TerritoryChapterLoader` / `TerritorySaveStoreAdapter` |
 *
 *  ⚠️ `assets` 由 `MainTabHost` 在实例化后、`setParent`（触发 onLoad）之前注入 `initialize`，
 *  不要在这里直调 `resources.load`。
 */
@ccclass('TerritoryPage')
export class TerritoryPage extends Component {
    @property({ type: ScrollView, group: '节点引用', tooltip: 'MapScrollView：地图滚动容器（视口裁剪 + 惯性回弹）' })
    mapScrollView: ScrollView = null!;

    @property({ type: TerritoryMapView, group: '节点引用', tooltip: 'MapScrollView 的内容层（六边格 / 连线 / 站点）' })
    mapView: TerritoryMapView = null!;

    @property({ type: TerritoryHeaderView, group: '节点引用', tooltip: 'HudLayer：顶部章节信息与底部提示条' })
    hudView: TerritoryHeaderView = null!;

    @property({ type: Prefab, group: '节点引用', tooltip: '站点详情弹窗 prefab（ui/territory/TerritorySiteDetail）' })
    detailPrefab: Prefab = null!;

    /** 站点详情弹窗（onLoad 实例化，常驻页面、默认收起）。 */
    private detailPanel: TerritorySiteDetailPanel = null!;
    private presenter: TerritoryPresenter | null = null;
    private lastRenderedChapter = -1;
    /** tick 定时器只在首次渲染成功后挂一次（页面常驻期间一直跑）。 */
    private tickScheduled = false;

    /** 由 `MainTabHost` 注入资源入口（setParent 触发 onLoad 之前）。 */
    initialize(assets: AssetService): void {
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
                navigateToBattle: (pve, battle) =>
                    ProcedureManager.navigate(GameRoute.Battle, {
                        pve: { ...pve, territorySaveOwner: saveOwner },
                        battle,
                        selfRoleId: saveOwner?.roleId,
                    }),
                showTip: (text) => FW.showTip(text),
                showRewards: (rewards, originCellId) => this.presentRewards(rewards, originCellId),
            },
        });
        this.presenter.onStateChange = () => this.renderAll();
        void this.loadHexFlipAssets(assets);
        void this.loadResourceGainIcons(assets);
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
        this.detailPanel.initialize({
            onClose: () => this.presenter?.closeDetail(),
            onStart: () => this.presenter?.requestBattle(),
        });
        this.detailPanel.close();

        this.hudView.initialize({
            onPreviousChapter: () => this.presenter?.switchChapter(-1),
            onNextChapter: () => this.presenter?.switchChapter(1),
        });
        this.mapView.initialize((target) => {
            if ('kind' in target) this.presenter?.selectRandomResource(target.cellId);
            else this.presenter?.selectSite(target);
        });

        if (!this.presenter) {
            // 资源入口缺失是宿主注入错误（开发配置问题），不整页锁死：轻提示 + 留空页面。
            console.error('[TerritoryPage] 缺少资源入口（MainTabHost 未注入 assets），无法加载领地');
            FW.showTip(TERRITORY_TEXTS.loadingResourceMissing);
        }
    }

    start(): void {
        this.presenter?.start();
    }

    onDestroy(): void {
        CacheMgr.instance.removeEventUpdate('CmdRole', this as unknown as destroyable, this.onRoleCacheUpdate);
        this.presenter?.dispose();
        // ⚠️ 这里不再对子节点调 `off(...)`：`Node._onPreDestroyBase()` 先销毁子节点、
        // 再跑本函数，节点销毁时 EventTarget 已释放，监听不泄漏；引擎这版 `Node.off` 不判空，
        // 手动摘必抛。同族规则见 docs/AI架构与代码规范.md §7.2。
    }

    // ============================================================
    // 渲染（Passive View：幂等全量赋值，不读上一次状态）
    // ============================================================

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
            const viewport = this.mapScrollView.node.getComponent(UITransform);
            if (!viewport) throw new Error('领地地图视口缺少 UITransform');
            const offset = territoryMapOffsetForCell(
                state.layout, state.map.startCellId, viewport.contentSize);
            this.mapScrollView.scrollToOffset(new Vec2(offset.x, offset.y), 0);
        }
        if (state.hud) this.hudView.render(state.hud);

        if (state.detail.open && state.detail.content) {
            this.detailPanel.open(state.detail.content);
        } else if (!state.detail.open && this.detailPanel.isOpen) {
            this.detailPanel.close();
        }
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

    /**
     * 发奖反馈：**银币 / 体力走「格子上方 icon + 数字升起」，其余走奖励弹窗**
     * （山猫 2026-10-15 口径，判据与理由见 `TerritoryResourceGain`）。
     *
     *  两类**逐条分开**，不是整批二选一 —— 一批里既有银币又有道具时，银币飘字、道具弹窗。
     *
     * ⚠️ 挂机产出（`originCellId` 为空）没有来源格 ⇒ 回落到**起始格**（主城）：
     * 它恒在地图上、且是「领地产出」的语义落点；拿不到地图（未就绪）就只弹窗、不飘字。
     */
    private presentRewards(
        rewards: readonly (TerritoryIdleRewardGain | ITerritoryGrantedReward)[],
        originCellId?: number | null,
    ): void {
        if (!rewards.length) return;
        const { gains, popup } = splitTerritoryRewards(rewards);
        if (gains.length) {
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
