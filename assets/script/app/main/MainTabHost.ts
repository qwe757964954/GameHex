import { _decorator, CCInteger, Component, instantiate, Node, Prefab, Vec3 } from 'cc';
import type { AssetService } from '../../core/asset/AssetService';
import { TabButton } from '../common/TabButton';
import { cardLineupNavItem, loadNavArt } from '../card/CardLineupNav';
import { CardLineupPage } from '../card/CardLineupPage';
import { checkFirstRechargeOnEnterMain } from '../firstRecharge/FirstRechargeAutoOpen';
import { TerritoryPage } from '../territory/view/TerritoryPage';

const { ccclass, property } = _decorator;

/**
 * 底部六格的语义下标，与配置组 `CARD_LINEUP_NAV_GROUP`（在 `card/CardLineupNav.ts`）
 * 顺序严格一致（设计稿从左到右：商店 / 角色 / 竞技 / 领地 / 冒险 / 联盟）。
 */
export const enum MainTab {
    Shop = 0,
    Role = 1,
    Arena = 2,
    Territory = 3,
    Adventure = 4,
    Alliance = 5,
}

/**
 * 主界面 tab 宿主（挂在 `assets/resources/ui/main/MainRoot.prefab` 根节点上）。
 *
 * 版式：`MainRoot` 只负责「一块全屏背景 + 一个内容容器 + 一条底部六格」——
 * 2026-09-24 起它**纯粹是外壳**：资源栏 / 左右入口列 / 聊天入口三块常驻 HUD 已搬到
 * `ui/main/ArenaRoot`（竞技页），随之一起实例化 / 销毁 ⇒ 切到角色页时它们不显示。
 *
 * 每个 tab 的真实内容各自是一个独立 prefab（竞技 = `ui/main/ArenaRoot`，
 * 角色 = `ui/card/CardLineup`），切 tab 时整页实例化 / 销毁。
 *
 *  六格的**页面映射**走 `@property`（Inspector 绑定），代码里不写死 URL。
 * 冒险使用独立的 `TerritoryPage` 承载章节地图；地图数据由 territory 模块从关卡/怪物/卡牌表加载。
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
 *  领地 tab 的页面是**角色主界面**（`ui/Role/Role`：背包三页签 + 装备栏 + 剑圣立绘）。
 * 它**曾经**是「覆盖式全屏弹窗」（`PopupManager.openAsync`），2026-09-26 山猫定
 * 「应该类似 `CardLineup`，不是弹窗」⇒ 现在和其它 tab 一样走 {@link showPage}（切走即销毁）。
 * 外部入口（`open.json` 的 `TabRoleMain`，走 `MainEntranceList`）改调 {@link switchToRoleMain}。
 *
 *  六格实例的**兄弟顺序不可依赖**（编辑器批量建节点会乱序），
 * 与 `CardLineupPage` 同一套做法：统一按节点 x 坐标排序后再和资源表对齐。
 *
 *  2026-09-28 起六格改用工程共用的页签组件 `common/TabButton`（与战令底栏四格同一个
 * `ui/common/TabButton.prefab`，依据见 `TabButton.ts` 文件头）——原来的 `CardLineupNav`
 * 只是「底图 + 图标 + 文字」的私有实现，和战令那四个各写一套。换共用件后：
 * - 点击不再由本类手工 `node.on(Button.EventType.CLICK)`，而是 `TabButton.bindSelect`；
 * - 槽位表仍然只有一份（`card/CardLineupNav.ts` 的 `CARD_LINEUP_NAV_GROUP`）——
 *   它现在只承担「数据表 + `loadNavArt`」两个职责，那个文件里的 `CardLineupNav` 类已弃用；
 * - 六格的红点通路一次性接好（`bindRedDotExpr`），口径留空 ⇒ 恒收起（见 `CardLineupNavItem.rdExpr`）。
 */
@ccclass('MainTabHost')
export class MainTabHost extends Component {
    @property({ type: Node, tooltip: 'BottomNav：底部六格导航容器' })
    navBar: Node = null!;

    @property({ type: Node, tooltip: 'Content：页面容器，切 tab 时把子页实例挂到这里' })
    content: Node = null!;

    @property({ type: Prefab, tooltip: '竞技页预制体（ui/main/ArenaRoot）' })
    arenaPage: Prefab = null!;

    @property({ type: Prefab, tooltip: '角色 tab 页预制体（ui/card/CardLineup 布阵页）' })
    rolePage: Prefab = null!;

    @property({ type: Prefab, tooltip: '领地 tab 页预制体（ui/Role/Role 角色主界面：背包 + 装备 + 立绘）' })
    roleMainPage: Prefab = null!;

    @property({ type: Prefab, tooltip: '联盟 tab 页预制体（ui/League/LeagueTab 容器页：按入没入盟二选一子页）' })
    alliancePage: Prefab = null!;

    @property({ type: Prefab, tooltip: '商店 tab 页预制体（ui/Store/Store 商城：NPC 背景 + 5 段长滚动）' })
    shopPage: Prefab = null!;

    @property({ type: Prefab, tooltip: '冒险 tab 页预制体（ui/territory/TerritoryPage 领地地图）' })
    adventurePage: Prefab = null!;

    // ⚠️ 必须 `CCInteger`：Cocos 3.8 的 `@property` 不认裸 `Number`，prefab 每次加载都会
    // warn（`must be CCFloat or CCInteger, not Number`）。prefab 里存的是裸数字 `2`，换类型后原样保留。
    @property({ type: CCInteger, tooltip: '初始选中的 tab：0商店 1角色 2竞技 3领地 4冒险 5联盟' })
    defaultTab = MainTab.Arena as number;

    /** 六格视图，按 x 从左到右排好。 */
    private readonly navItems: TabButton[] = [];

    /** 当前挂在 Content 下的页面实例。 */
    private currentPage: Node | null = null;

    /** 当前选中的 tab 下标；`-1` 表示还没选过。 */
    private currentTab = -1;

    /** 六格渲染轮次 —— 丢弃在途的异步加载结果（切 tab 比图片加载快时会发生）。 */
    private navRevision = 0;

    /**
     * 资源入口，由 `ProcedureMain` 注入（`ProcedureBase.assets`）。
     *
     *  页面是 `instantiate` 出来的 prefab，拿不到流程的依赖 ⇒ 由宿主在挂载时转交。
     *  目前只有领地页需要它（地图 JSON 与美术都走 `AssetService`，不再直调 `resources.load`）。
     */
    private assets: AssetService | null = null;

    /** 注入资源入口；必须在实例化并激活页面之前调用（`ProcedureMain.onEnter` 里就是这么做的）。 */
    setAssetService(assets: AssetService): void {
        this.assets = assets;
    }

    onLoad(): void {
        this.navItems.length = 0;
        this.navItems.push(...this.navBar
            .getComponentsInChildren(TabButton)
            .slice()
            .sort((a, b) => a.node.position.x - b.node.position.x));

        for (let index = 0; index < this.navItems.length; index += 1) {
            const button = this.navItems[index];
            // 点击：`TabButton` 内部已经挂了 CLICK（`ensureInit()` 幂等），宿主只交出「点我切哪一页」。
            // 事件监听随节点销毁由引擎自动清理，按项目约定不手动 off。
            button.bindSelect(() => { void this.switchTab(index); });
            // 红点：后端推送 → 变量标脏 → 表达式重算 → `RedDot.setRedDot`，全程不用宿主干预。
            // `rdExpr` 现在六格都是空的（见 `CardLineupNavItem.rdExpr`）⇒ 红点恒收起，
            // 但通路已就绪：`open.json` 登记好六格口径后填上即亮，本文件不用改。
            button.bindRedDotExpr(cardLineupNavItem(index)?.rdExpr);
        }

        // 「进主界面」= 本组件初始化完成 + 默认页切完。首充的自动弹出挂在这里
        // （对齐老客户端 `TabFight.init()` 那一段，见 `FirstRechargeAutoOpen`）。
        // ⚠️ 必须等 `switchTab` 落定再调：否则活动弹窗会和页面实例化抢同一帧，
        // 表现在弹窗「闪一下」或盖在不存在的页面上。`checkFirstRechargeOnEnterMain`
        // 内部全 catch、永不 reject，所以这里的 `then` 不会漏出 unhandled rejection。
        void this.switchTab(this.defaultTab).then(() => checkFirstRechargeOnEnterMain(this));
    }

    /**
     * 切到第 `index` 个 tab：换页面 + 刷新六格的选中态。
     *
     * 页面还没落地（`@property` 没绑）时**不改选中态**，避免点了个空 tab 后
     * 底部高亮和实际内容对不上。
     */
    async switchTab(index: number): Promise<void> {
        if (index === this.currentTab) return;

        const prefab = this.pagePrefab(index);
        if (!prefab) {
            console.warn(`[MainTabHost] tab ${index}（${cardLineupNavItem(index)?.name ?? '?'}）的页面还没落地，忽略切换`);
            return;
        }

        this.currentTab = index;
        this.showPage(prefab);
        await this.renderNav(index);
    }

    /**
     * 供**外部**（入口列 `MainEntranceList`）调用：切到「角色主界面」那一页。
     *
     * 角色主界面从「覆盖式弹窗」改成**主界面 tab 页**之后（2026-09-26 山猫定：
     * 「应该类似 CardLineup，不是弹窗」），`open.json` 里 `TabRoleMain` 那个入口
     * 就不能再 `PopupManager.openAsync` 了 —— 走这里切 tab。
     */
    switchToRoleMain(): void {
        void this.switchTab(MainTab.Territory);
    }

    /**
     * 供**外部**（跳转路由 `activity/ActivityJump`）按 tab 下标切页。
     *
     * 与 {@link switchToRoleMain} 同一条路径，只是不写死目标 —— 老端 `CtrlJumpView.JumpType`
     * 对 `HERO` / `FIGHT` 就是「切到第几格」（`LayerMainMenu` 里 `switchTab2(TabRoleMain/TabFight)`）。
     * 页面没落地（`@property` 没绑）时 `switchTab` 自己会 warn 并**不改选中态**，这里不重复判。
     */
    switchToTab(index: number): void {
        void this.switchTab(index);
    }

    /** tab 下标 → 页面预制体；未落地的返回 `null`。 */
    private pagePrefab(index: number): Prefab | null {
        if (index === MainTab.Shop) return this.shopPage;
        if (index === MainTab.Arena) return this.arenaPage;
        if (index === MainTab.Role) return this.rolePage;
        if (index === MainTab.Territory) return this.roleMainPage;
        if (index === MainTab.Adventure) return this.adventurePage;
        if (index === MainTab.Alliance) return this.alliancePage;
        return null;
    }

    /** 整页替换：销毁旧页，把新页实例挂到 Content 下并归位。 */
    private showPage(prefab: Prefab): void {
        this.currentPage?.destroy();
        const page = instantiate(prefab);
        // 依赖注入必须发生在 `setParent`（页面 onLoad / start）之前。
        const territory = page.getComponent(TerritoryPage);
        if (territory && this.assets) territory.initialize(this.assets);
        const lineup = page.getComponent(CardLineupPage);
        if (lineup && this.assets) lineup.initialize(this.assets);
        this.currentPage = page;
        page.setParent(this.content);
        page.setPosition(Vec3.ZERO);
    }

    /**
     * 刷新六格：名称与图标由本组按 `CARD_LINEUP_NAV_GROUP` 查，这里只告诉它
     * 「第几格、选中没有」；越界的格子直接隐藏。
     *
     *  选中态 / 名称**同步**落定（切 tab 的同一帧就正确），图标等图加载完再贴 ——
     * 与旧 `CardLineupNav.renderAt` 同一口径：`setIconFrame(null)` 表示「保留现有图」，
     * 加载失败时不会把木牌抹成空白。
     */
    private async renderNav(active: number): Promise<void> {
        const revision = ++this.navRevision;
        await Promise.all(this.navItems.map(
            (item, index) => this.renderNavItem(item, index, index === active, revision),
        ));
    }

    private async renderNavItem(item: TabButton, index: number, selected: boolean, revision: number): Promise<void> {
        const entry = cardLineupNavItem(index);
        if (!entry) {
            item.node.active = false;
            return;
        }
        item.node.active = true;
        item.setLabel(entry.name);
        item.setSelected(selected);

        const frame = await loadNavArt(selected ? entry.on : entry.off);
        // 在途期间节点已销毁 / 已经开了下一轮渲染 ⇒ 丢掉这次结果，别贴过期图
        if (!this.isValid || !item.isValid || !item.node.isValid || revision !== this.navRevision) return;
        item.setIconFrame(frame);
    }
}
