import {
    _decorator,
    CCInteger,
    Button,
    Component,
    Node,
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
            // 未开放的格子（角色 / 联盟 / 挑战）保持可见但压暗 + 挂锁，点击不派发切页。
            button.setEnabled(!isMainTabLocked(type));
            button.bindRedDotExpr(mainTabItem(type)?.rdExpr);
            button.node.on(Button.EventType.CLICK, () => {
                EventMgr.instance.emit(MainTabEvent.Select, { owner: this, tab: type });
            }, this);
        }

        EventMgr.instance.emit(VIEW_LIFECYCLE, { owner: this, phase: 'ready' });
    }

    /**
     * 兜底：首屏 ready 信号丢失（章节加载失败等）时强制结束等待，避免登录预加载永久卡死。
     */
    private onFirstScreenFallback = (): void => {
        this.firstScreenReadyResolve();
    };

    switchTab(index: number): void {
        EventMgr.instance.emit(MainTabEvent.Select, { owner: this, tab: index, source: 'route' });
    }

    activateBackgroundWarmup(): void {
        EventMgr.instance.emit(MainTabEvent.Warmup, { owner: this });
    }

    resolveFirstScreen(): void { this.scheduleOnce(() => this.firstScreenReadyResolve(), 0); }

    onDestroy(): void {
        EventMgr.instance.emit(VIEW_LIFECYCLE, { owner: this, phase: 'destroyed' });
        this.unschedule(this.onFirstScreenFallback);
        this.firstScreenReadyResolve();
    }

    /**
     * 供**外部**（入口列 `MainEntranceList`）调用：切到「角色主界面」那一页。
     *
     * 角色主界面从「覆盖式弹窗」改成**主界面 tab 页**之后（2026-09-26 山猫定：
     * 「应该类似 CardLineup，不是弹窗」），`open.json` 里 `TabRoleMain` 那个入口
     * 就不能再 `PopupManager.openAsync` 了 —— 走这里切 tab。
     *
     * ⚠️ 2026-11-04 起「角色」与「联盟」跟「挑战」一样**未开放**（见 `MainTabModel.isMainTabLocked`），
     * 这里切不过去：`MainTabController` 拿到 `locked` 直接返回，页面与选中态保持不变。
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
