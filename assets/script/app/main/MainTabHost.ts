import { _decorator, CCInteger, Component, instantiate, Node, Prefab, Vec3 } from 'cc';
import type { AssetService } from '../../core/asset/AssetService';
import type { ConfigService } from '../../core/config/ConfigService';
import type { SessionAssetService } from '../../core/asset/SessionAssetService';
import { ResourceScope } from '../../core/asset/ResourceScope';
import { MAIN_PAGES_BUNDLE } from '../../core/asset/BundleCatalog';
import { TabButton } from '../common/TabButton';
import { mainTabItem } from './MainTabItems';
import { CardLineupPage } from '../card/CardLineupPage';
import { checkFirstRechargeOnEnterMain } from '../firstRecharge/FirstRechargeAutoOpen';
import { MainTerritoryMap } from './MainTerritoryMap';
import { MainPage } from './MainPage';
import { BigMapEntry } from '../bigmap/application/BigMapEntry';

const { ccclass, property } = _decorator;

/**
 * 底部七格的业务类型（MainRoot.prefab 内联绑定），与 `MainTabItems` 文案表对应。
 *
 * ⚠️ 版式是 **7 格**（旧版 6 格：商店 / 角色 / 竞技 / 领地 / 冒险 / 联盟）——
 * 「冒险」并入「领地」（领地 = 主城页，六边格地图）；「挑战」暂不开放，
 * 新增「英雄」「世界」两格。
 */
export const enum MainTab {
    Shop = 0,
    Hero = 1,
    Role = 2,
    Territory = 3,
    Challenge = 4,
    Alliance = 5,
    World = 6,
}

/**
 * 主界面 tab 宿主（挂在 `assets/resources/ui/main/MainRoot.prefab` 根节点上）。
 *
 * 版式：`MainRoot` 只负责「一块全屏背景 + 一个内容容器 + 一条底部七格」——
 * 2026-09-24 起它**纯粹是外壳**：资源栏 / 左右入口列 / 聊天入口三块常驻 HUD 已搬到
 * `ui/main/ArenaRoot`（竞技页），随之一起实例化 / 销毁 ⇒ 切到角色页时它们不显示。
 *
 * 每个 tab 的真实内容各自是一个独立 prefab（竞技 = `ui/main/ArenaRoot`，
 * 角色 = `ui/card/CardLineup`），切 tab 时整页实例化 / 销毁。
 *
 * 页面映射使用资源路径，避免外壳 Prefab 强引用未打开的功能页。
 * 领地主城使用 `MainTerritoryMap` 承载地图；地图数据由 territory 模块从关卡/怪物/卡牌表加载。
 *
 *  商店 tab 的页面是 `ui/Store/Store`（商城）—— 真源 FGUI `组件/组件_商店_界面.xml`：
 * **一条长滚动**（NPC 背景 + 5 段分组卡，段是 `list` 的 5 个 item），**没有页签**，
 * 与其它 tab 一样整页实例化 / 切走即销毁。
 *
 *  联盟 tab 的页面是 `ui/League/LeagueTab`（**容器页**，自己不画东西，只按「入没入盟」
 * 二选一实例化 `League`（已入盟）/ `LeagueJoin`（未入盟）—— 见 `LeagueTabPage`）。
 * 2026-09-28 补上映射：此前六个入口面板全在、只差宿主这一根线，点联盟格只会打一条
 * 「页面还没落地」的 warn，看着像整个模块没做。
 *
 *  The Territory tab opens `ArenaRoot`, which embeds `MainTerritoryMap`; the Challenge tab stays visible but disabled.
 *
 * 底栏实例的兄弟顺序不作为业务身份；节点按 x 排序只用于确定遍历顺序，
 * 页面与文案都按 prefab 上的 `tabType` 解析。
 *
 *  七格改用工程共用的页签组件 `common/TabButton`（与战令底栏四格同一个
 * `ui/common/TabButton.prefab`，依据见 `TabButton.ts` 文件头）——原来的 `CardLineupNav`
 * 只是「底图 + 图标 + 文字」的私有实现，和战令那四个各写一套。换共用件后：
 * - 点击不再由本类手工 `node.on(Button.EventType.CLICK)`，而是 `TabButton.bindSelect`；
 * - 名称与红点口径由 `MainTabItems` 提供；图标帧和类型序列化在每个 prefab 实例上；
 * - 七格的红点通路一次性接好（`bindRedDotExpr`），口径留空 ⇒ 恒收起（见 `IMainTabItem.rdExpr`）。
 */
@ccclass('MainTabHost')
export class MainTabHost extends Component {
    @property({ type: Node, tooltip: 'BottomNav：底部七格导航容器' })
    navBar: Node = null!;

    @property({ type: Node, tooltip: 'Content：页面容器，切 tab 时把子页实例挂到这里' })
    content: Node = null!;

    // ⚠️ 必须 `CCInteger`：Cocos 3.8 的 `@property` 不认裸 `Number`，prefab 每次加载都会
    // warn（`must be CCFloat or CCInteger, not Number`）。prefab 里存的是裸数字 `2`，换类型后原样保留。
    @property({
        type: CCInteger,
        tooltip: '初始选中的 tab：0商店 1英雄 2角色 3领地(主城) 4挑战 5联盟 6世界',
    })
    defaultTab = MainTab.Territory as number;

    /** 七格视图，按 x 从左到右排好。 */
    private readonly navItems: TabButton[] = [];

    /** 当前挂在 Content 下的页面实例。 */
    private currentPage: Node | null = null;

    /** 当前选中的 tab 下标；`-1` 表示还没选过。 */
    private currentTab = -1;

    /**
     * 资源入口，由 `ProcedureMain` 注入（`ProcedureBase.assets`）。
     *
     *  页面是 `instantiate` 出来的 prefab，拿不到流程的依赖 ⇒ 由宿主在挂载时转交。
     *  目前只有领地页需要它（地图 JSON 与美术都走 `AssetService`，不再直调 `resources.load`）。
     */
    private assets: AssetService | null = null;

    /**
     * 配置入口，由 `ProcedureMain` 注入。
     *
     * 目前只有大世界入口用它：`BigMap-*` 12 张表要在打开页面时解析成强类型配置，
     * 而 tab 页是 `instantiate` 出来的 prefab，同样拿不到流程依赖。
     */
    private configs: ConfigService | null = null;
    private sessionAssets: SessionAssetService | null = null;
    private pageScope: ResourceScope | null = null;
    private readonly pendingPageScopes = new Set<ResourceScope>();
    private pageRevision = 0;
    private loadingTab = -1;
    private pageLoadingTask: Promise<void> | null = null;

    /** 注入资源入口；必须在实例化并激活页面之前调用（`ProcedureMain.onEnter` 里就是这么做的）。 */
    setAssetService(assets: AssetService): void {
        this.assets = assets;
    }

    /** 注入配置入口（大世界用；同样要在 setParent 之前调用）。 */
    setConfigService(configs: ConfigService): void {
        this.configs = configs;
    }

    setSessionAssetService(assets: SessionAssetService): void {
        this.sessionAssets = assets;
    }

    onLoad(): void {
        this.navItems.length = 0;
        this.navItems.push(...this.navBar
            .getComponentsInChildren(TabButton)
            .slice()
            .sort((a, b) => a.node.position.x - b.node.position.x));

        for (let index = 0; index < this.navItems.length; index += 1) {
            const button = this.navItems[index];
            const type = button.tabType;

            // 「世界」= 大世界（大地图）入口：点它直接开全屏覆盖页，**不是** tab 页。
            // 2026-10-21 起大地图不再有单独的悬浮按钮，就挂在这一格上（见 `openBigMap`）。
            if (type === MainTab.World) {
                button.setEnabled(true);
                button.bindSelect(() => this.switchTab(type));
                button.bindRedDotExpr(mainTabItem(type)?.rdExpr);
                continue;
            }

            const isLocked = type === MainTab.Challenge;
            button.setEnabled(!isLocked);
            // 点击：`TabButton` 内部已经挂了 CLICK（`ensureInit()` 幂等），宿主只交出「点我切哪一页」。
            // 事件监听随节点销毁由引擎自动清理，按项目约定不手动 off。
            button.bindSelect(isLocked ? null : () => { void this.switchTab(type); });
            // 红点：后端推送 → 变量标脏 → 表达式重算 → `RedDot.setRedDot`，全程不用宿主干预。
            // `rdExpr` 现在七格都是空的（见 `IMainTabItem.rdExpr`）⇒ 红点恒收起，
            // 但通路已就绪：`open.json` 登记好口径后填上即亮，本文件不用改。
            button.bindRedDotExpr(mainTabItem(type)?.rdExpr);
        }

        // 「进主界面」= 本组件初始化完成 + 默认页切完。首充的自动弹出挂在这里
        // （对齐老客户端 `TabFight.init()` 那一段，见 `FirstRechargeAutoOpen`）。
        // ⚠️ 必须等 `switchTab` 落定再调：否则活动弹窗会和页面实例化抢同一帧，
        // 表现在弹窗「闪一下」或盖在不存在的页面上。`checkFirstRechargeOnEnterMain`
        // 内部全 catch、永不 reject，所以这里的 `then` 不会漏出 unhandled rejection。
        const initialPage = this.switchTab(this.defaultTab);
        const initialRevision = this.pageRevision;
        const canWarmup = (): boolean => this.isValid && this.pageRevision === initialRevision
            && this.currentPage !== null && this.loadingTab === -1;
        void initialPage.then(() => {
            if (!canWarmup()) return;
            void checkFirstRechargeOnEnterMain(this);
            this.scheduleOnce(() => {
                if (canWarmup()) void this.sessionAssets?.warmup?.().catch((error: unknown) => {
                    console.warn('[MainTabHost] 公共资源预下载失败', error);
                });
            }, 0);
        });
    }

    /**
     * 打开大世界（大地图）。
     *
     * 保留当前底页，只临时把底栏高亮切到「世界」，关掉时回调恢复 `currentTab`。
     */
    private async openBigMap(): Promise<void> {
        if (!this.configs) {
            console.warn('[MainTabHost] 还没注入 ConfigService，无法打开大世界');
            return;
        }
        if (BigMapEntry.shared().isOpen) return;
        this.sessionAssets?.pauseWarmup?.();
        try {
            this.renderNav(MainTab.World);
            await BigMapEntry.shared().open(this.configs, {
                navigation: this.navBar,
                onClose: () => this.renderNav(this.currentTab),
            });
        } catch (error) {
            if (this.isValid) this.renderNav(this.currentTab);
            console.warn('[MainTabHost] 世界页面加载失败', error);
        }
    }

    /** 关掉大世界（切 tab 前一律先关，否则它会一直压在旧页面上）。 */
    private closeBigMap(): void {
        BigMapEntry.shared().close();
    }

    /**
     * 切到第 `index` 个 tab：换页面 + 刷新七格的选中态。
     *
     * 页面未开放或加载失败时**不改选中态**，避免点了个空 tab 后
     * 底部高亮和实际内容对不上。
     */
    async switchTab(index: number): Promise<void> {
        // 「世界」不是 tab 页而是压在页面上的大世界：外部跳转（`switchToTab(6)` / 活动路由）也走这里。
        if (index === MainTab.World) {
            this.cancelPageLoading();
            await this.openBigMap();
            return;
        }
        if (this.loadingTab === index && this.pageLoadingTask) return this.pageLoadingTask;
        this.cancelPageLoading();
        this.closeBigMap();
        if (index === this.currentTab) return;

        const path = this.pagePath(index);
        if (!path || !this.assets) {
            console.warn(`[MainTabHost] tab ${index}（${mainTabItem(index)?.name ?? '?'}）的页面还没落地，忽略切换`);
            return;
        }

        this.sessionAssets?.pauseWarmup?.();
        const revision = this.pageRevision;
        const scope = new ResourceScope(`main-tab:${index}`);
        this.pendingPageScopes.add(scope);
        this.loadingTab = index;
        const task = this.loadPage(index, path, scope, revision);
        this.pageLoadingTask = task;
        await task;
        if (this.pageLoadingTask === task) {
            this.pageLoadingTask = null;
            this.loadingTab = -1;
        }
    }

    private async loadPage(index: number, path: string, scope: ResourceScope, revision: number): Promise<void> {
        const assets = this.assets;
        if (!assets) return;
        let adopted = false;
        try {
            const prefab = await assets.load(path, Prefab, { scope, bundle: this.pageBundle(index) });
            if (!this.isValid || revision !== this.pageRevision || scope.disposed) return;
            this.showPage(prefab);
            const previous = this.pageScope;
            this.pageScope = scope;
            adopted = true;
            previous?.dispose();
            this.currentTab = index;
            this.renderNav(index);
        } catch (error) {
            if (revision === this.pageRevision && this.isValid) console.warn(`[MainTabHost] 页面加载失败：${path}`, error);
        } finally {
            this.pendingPageScopes.delete(scope);
            if (!adopted) scope.dispose();
        }
    }

    private cancelPageLoading(): void {
        this.pageRevision += 1;
        this.loadingTab = -1;
        this.pageLoadingTask = null;
        for (const scope of this.pendingPageScopes) scope.dispose();
        this.pendingPageScopes.clear();
    }

    onDestroy(): void {
        this.cancelPageLoading();
        this.pageScope?.dispose();
        this.pageScope = null;
        this.sessionAssets?.pauseWarmup?.();
    }

    /**
     * 供**外部**（入口列 `MainEntranceList`）调用：切到「角色主界面」那一页。
     *
     * 角色主界面从「覆盖式弹窗」改成**主界面 tab 页**之后（2026-09-26 山猫定：
     * 「应该类似 CardLineup，不是弹窗」），`open.json` 里 `TabRoleMain` 那个入口
     * 就不能再 `PopupManager.openAsync` 了 —— 走这里切 tab。
     */
    switchToRoleMain(): void {
        // 2026-10-19 起「角色主界面」是第 2 格（Role）；第 3 格 Territory 已改成主城/领地图。
        void this.switchTab(MainTab.Role);
    }

    /**
     * 供**外部**（跳转路由 `activity/ActivityJump`）按 tab 下标切页。
     *
     * 与 {@link switchToRoleMain} 同一条路径，只是不写死目标 —— 老端 `CtrlJumpView.JumpType`
     * 对 `HERO` / `FIGHT` 就是「切到第几格」（`LayerMainMenu` 里 `switchTab2(TabRoleMain/TabFight)`）。
     * 页面未开放或加载失败时保留原页与选中态。
     */
    switchToTab(index: number): void {
        void this.switchTab(index);
    }

    /** tab 下标 → 页面资源路径；未开放的返回 `null`。 */
    private pagePath(index: number): string | null {
        if (index === MainTab.Shop) return 'ui/Store/Store';
        // 英雄 = 卡牌阵容（布阵 / 卡库），名称见配置组 `navHero`
        if (index === MainTab.Hero) return 'ui/card/CardLineup';
        // 角色 = 角色主界面（背包 + 装备 + 立绘，`ui/Role/Role`）
        if (index === MainTab.Role) return 'ui/Role/Role';
        // 领地 = **主城**（2026-10-19 蓝湖改版：「地图直接嵌进主城页，领地之后就是主城」）——
        // 主城页 `ui/main/ArenaRoot` 里嵌了一张六边格领地图，挑战 tab 暂未开放。
        if (index === MainTab.Territory) return 'ui/main/ArenaRoot';
        // 挑战暂不开放：保留底栏位置与视觉，但拒绝页面切换；旧章节地图已并入领地主城页。
        if (index === MainTab.Alliance) return 'ui/League/LeagueTab';
        // 世界：没有 tab 页 —— 它是全屏覆盖页，走 `openBigMap()`（`switchTab` 开头已拦截）。
        return null;
    }

    /**
     * tab 下标 → 页面资源所在 bundle；主城（Territory）在首包，其余功能页走 main-pages。
     * 世界/挑战不经过 `loadPage`，这里不需要分支。
     */
    private pageBundle(index: number): string | undefined {
        if (index === MainTab.Territory) return undefined;
        return MAIN_PAGES_BUNDLE;
    }

    /** 整页替换：销毁旧页，把新页实例挂到 Content 下并归位。 */
    private showPage(prefab: Prefab): void {
        const page = instantiate(prefab);
        try {
            // 依赖注入必须发生在 `setParent`（页面 onLoad / start）之前。
            const mainTerritoryMap = page.getComponentInChildren(MainTerritoryMap);
            if (mainTerritoryMap && this.assets) {
                mainTerritoryMap.setSessionAssetService(this.sessionAssets);
                mainTerritoryMap.initialize(this.assets, this.configs);
            }
            const mainPage = page.getComponent(MainPage);
            if (mainPage && mainTerritoryMap) {
                mainPage.bindFindCurrentBoss(() => mainTerritoryMap.focusCurrentBoss());
            }
            const lineup = page.getComponent(CardLineupPage);
            if (lineup && this.assets) lineup.initialize(this.assets);
            page.setParent(this.content);
            page.setPosition(Vec3.ZERO);
        } catch (error) {
            page.destroy();
            throw error;
        }
        this.currentPage?.destroy();
        this.currentPage = page;
    }

    /**
     * 刷新七格：名称与红点表达式按 `tabType` 查，图标来自实例自身绑定的资源；
     * 未配置类型的格子隐藏。
     *
     * 选中态 / 名称同步落定，图标由 `TabButton.prefab` 实例上的 SpriteFrame 资源绑定。
     */
    private renderNav(active: number): void {
        for (const item of this.navItems) {
            this.renderNavItem(item, item.tabType, item.tabType === active);
        }
    }

    private renderNavItem(item: TabButton, type: number, selected: boolean): void {
        const entry = mainTabItem(type);
        if (!entry) {
            item.node.active = false;
            return;
        }
        item.node.active = true;
        item.setLabel(entry.name);
        item.setSelected(selected);
    }
}
