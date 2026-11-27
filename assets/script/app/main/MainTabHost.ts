import {
    _decorator,
    CCInteger,
    Button,
    Component,
    Node,
    UITransform,
    Vec3,
} from 'cc';
import { TabButton } from '../common/TabButton';
import { mainTabItem } from './MainTabItems';
import { isMainTabLocked, MainTab } from './MainTabModel';
import { VIEW_LIFECYCLE } from '../../framework/ui/ViewLifecycle';
import { MainTabEvent } from './MainTabEvents';
import { EventMgr } from '../../framework/event/EventMgr';
export { MainTab } from './MainTabModel';

const { ccclass, property } = _decorator;

/** 兜底：首屏 ready 信号丢失（章节加载失败等）时，最多等待此时长后强制结束，避免 onPreload 永久卡死。 */
const FIRST_SCREEN_FALLBACK_SECONDS = 8;

/** 底栏红点层：挂在 `BottomNav` 的最后一位，保证红点画在七格页签之上。 */
const RED_DOT_LAYER_NAME = 'RedDotLayer';

/** 主界面节点宿主；导航决策与资源归属由 MainTabController 管理。 */
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

    /**
     * 「领地页回来先看这一格」的一次性口令（`ProcedureMain` 在 `setParent` 之前写入）。
     *
     * 章节局结算返回时带 `{ chapterId, cellId }`：领地页首次渲染会把它居中（看通关翻转），
     * 取走即置 `null` —— 单次消费，别让它在下一次切 tab 时又把相机拽回去。
     */
    focusCellId: { readonly chapterId: number; readonly cellId: number } | null = null;

    /** 七格视图，按 x 从左到右排好。 */
    private readonly navItems: TabButton[] = [];

    /** 当前挂在 Content 下的页面实例。 */
    private currentPage: Node | null = null;

    /**
     * 首屏（默认页）真实渲染就绪的 Promise：MainRoot 在登录预加载阶段提前挂载、在登录图下完成渲染后 resolve。
     * ProcedureMain 在 onPreload 等待它，确保登录图移除时下面已是完整主城。
     */
    private firstScreenReadyResolve!: () => void;
    private readonly firstScreenReady = new Promise<void>((resolve) => {
        this.firstScreenReadyResolve = resolve;
    });

    /** 首屏真实渲染就绪的等待（ProcedureMain 在登录预加载挂载后 await）。 */
    get whenFirstScreenReady(): Promise<void> {
        return this.firstScreenReady;
    }

    onLoad(): void {
        // 兜底：首屏 ready 信号丢失时强制结束等待，避免登录预加载永久卡死。
        this.scheduleOnce(this.onFirstScreenFallback, FIRST_SCREEN_FALLBACK_SECONDS);

        this.navItems.length = 0;
        this.navItems.push(...this.navBar
            .getComponentsInChildren(TabButton)
            .slice()
            .sort((a, b) => a.node.position.x - b.node.position.x));

        for (const button of this.navItems) {
            const type = button.tabType;
            // 未开放的格子（挑战）保持可见但压暗 + 挂锁；事件照派发，由 controller 拦下不切页。
            button.setEnabled(!isMainTabLocked(type));
            button.node.on(Button.EventType.CLICK, () => {
                EventMgr.instance.emit(MainTabEvent.Select, { tab: type });
            });
        }

        EventMgr.instance.emit(VIEW_LIFECYCLE, { phase: 'ready' }, this);
    }

    /**
     * 红点绑定放到 `start`：`MainTabHost.onLoad` 早于子节点 `RedDot.onLoad`，
     * 表达式首帧就 >0 时会往未初始化的 `RedDot` 写尺寸（`iconTransform` 还是 undefined）。
     * `start` 在整棵激活树 `onLoad` 完成后才跑，红点组件已就绪。
     */
    protected start(): void {
        this.hoistRedDotsAboveTabs();
        for (const button of this.navItems) {
            button.bindRedDotExpr(mainTabItem(button.tabType)?.rdExpr);
        }
    }

    /**
     * 把七格红点统一搬到页签之上的 `RedDotLayer`。
     *
     * 红点在 `TabButton.prefab` 里是本格的子节点（`RedDot` 实例，x=53 正好探出格子右缘），
     * 而页签节点按兄弟序绘制：右邻格一选中，`SelBg`（106×143 的金色底板）会把左邻格探出的半颗盖掉
     * （2026-11-25 截图：领地选中时「角色」的红点只剩左半边）。
     * 这里只改绘制归属、不改视觉坐标 —— `setParent(layer, true)` 保留世界坐标，
     * `TabButton.redDot` / `RdExprBinding` 都持有组件引用，不受影响。
     *
     * 层节点放在 `BottomNav` 子节点末尾 = 渲染序最后一档；`HeroFragmentBadge` 之后再挂会压在本层之上。
     */
    private hoistRedDotsAboveTabs(): void {
        let layer = this.navBar.getChildByName(RED_DOT_LAYER_NAME);
        if (!layer) {
            layer = new Node(RED_DOT_LAYER_NAME);
            layer.layer = this.navBar.layer;
            layer.addComponent(UITransform);
            layer.setParent(this.navBar);
        }
        layer.setSiblingIndex(this.navBar.children.length - 1);
        for (const button of this.navItems) {
            const dot = button.redDot;
            if (!dot?.isValid) continue;
            if (dot.node.parent !== layer) dot.node.setParent(layer, true);
        }
    }

    /**
     * 兜底：首屏 ready 信号丢失（章节加载失败等）时强制结束等待，避免登录预加载永久卡死。
     */
    private onFirstScreenFallback = (): void => {
        this.firstScreenReadyResolve();
    };

    switchTab(index: number): void {
        EventMgr.instance.emit(MainTabEvent.Select, { tab: index, source: 'route' });
    }

    activateBackgroundWarmup(): void {
        EventMgr.instance.emit(MainTabEvent.Warmup);
    }

    resolveFirstScreen(): void { this.scheduleOnce(() => this.firstScreenReadyResolve(), 0); }

    onDestroy(): void {
        EventMgr.instance.emit(VIEW_LIFECYCLE, { phase: 'destroyed' }, this);
        this.firstScreenReadyResolve();
    }

    /**
     * 供**外部**（入口列 `MainEntranceList`）调用：切到「角色主界面」那一页。
     *
     * 角色主界面从「覆盖式弹窗」改成**主界面 tab 页**之后（2026-09-26 山猫定：
     * 「应该类似 CardLineup，不是弹窗」），`open.json` 里 `TabRoleMain` 那个入口
     * 就不能再 `PopupManager.openAsync` 了 —— 走这里切 tab。
     *
     * ⚠️ 2026-11-05 起「角色」与「联盟」恢复开放（名单见 `MainTabModel.isMainTabLocked`，
     * 只剩挑战锁着），这里能正常切到角色页；未开放的格子仍由 controller 拦下，页面与选中态不变。
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

    mountPage(page: Node): void {
        page.setParent(this.content);
        page.setPosition(Vec3.ZERO);
        this.currentPage?.destroy();
        this.currentPage = page;
    }

    /**
     * 刷新七格：名称与红点表达式按 `tabType` 查，图标来自实例自身绑定的资源；
     * 未配置类型的格子隐藏。
     *
     * 选中态 / 名称同步落定，图标由 `TabButton.prefab` 实例上的 SpriteFrame 资源绑定。
     */
    renderNav(active: number): void {
        for (const item of this.navItems) {
            this.renderNavItem(item, item.tabType, item.tabType === active);
        }
    }

    getGuideTabNode(tab: MainTab): Node | null {
        return this.navItems.find(item => item.tabType === tab)?.node ?? null;
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
