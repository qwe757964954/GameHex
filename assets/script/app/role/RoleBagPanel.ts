import { _decorator, Component, Node, Widget } from 'cc';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { EventMgr } from '../../framework/event/EventMgr';
import { RoleEvent } from './RoleEvents';
import type { IRoleGemEntry } from './RoleTypes';
import { ItemInfoPage } from '../itemdetail/ItemInfoPage';
import { roleRepository } from './RoleRepository';
import { loadRoleBagIcon, loadRoleQualityFrame } from './RoleArtLoader';
import { bagCountText, bagRankText } from './RoleTable';
import type { IRoleBagEntry, RoleBagTabId } from './RoleTypes';
import { RoleBagItem } from './RoleBagItem';

const { ccclass, property } = _decorator;

/**
 * 背包列表面板（挂 Role.prefab 内的 `BagPanel` 节点，全屏覆盖在角色主界面上）。
 *
 * 三个页签共用本面板：{@link show} 传 tab id，按 tab 取数、预加载图、重铺列表。
 * 关闭（{@link hide}）回到角色主界面。
 *
 * ## 列表：工程 `VirtualScrollView`（网格模式）
 *
 * 6 列网格（`gridCount=6`，格 96×96、横间距 22、行间距 15）由 Inspector 配置，**代码不覆盖**（项目约定：配置只在 prefab 一处）。
 * 本类只挂 `renderItemFn` / `onItemClickFn` 两个回调 + 喂 `refreshList(实际条目数)`。
 *
 * ⚠️ 两条时序（技能 §20.3）：
 *   ① 图必须先 `await` 完再 `refresh`（`renderItemFn` 同步，现加载会闪上一格图）；
 *   ② 回调里按 `index` **现取** `this.entries[index]`，不闭包捕获入参。
 */
@ccclass('RoleBagPanel')
export class RoleBagPanel extends Component {
    // ⚠️ 同 RolePage：prefab 里这个引用存的是【节点】，声明一律 `Node`，
    //    组件在 onLoad 里 getComponent 现取并缓存（声明成组件类型会拿到 cc.Node，运行时静默失效）。
    @property({ type: Node, tooltip: 'Grid：背包网格节点（其上挂 VirtualScrollView，gridCount=6）' })
    grid: Node = null;

    @property({ type: Node, tooltip: 'EmptyTip：空背包提示（无条目时显示）' })
    emptyTip: Node = null;

    /** 缓存：Grid 节点上的虚拟列表。 */
    private list: VirtualScrollView = null;

    /** 缓存：BagPanel 的 Widget（上下双向拉伸，改 top 即可整体上探）。 */
    private panelWidget: Widget = null!;
    /** Widget 的设计稿 top（切回宝石页签时还原）。 */
    private panelTopBase = 0;
    /** 当前顶部多占的高度（0 = 设计稿布局）。 */
    private topExtra = 0;

    /** 当前展示条目（已排序）。 */
    private entries: IRoleBagEntry[] = [];
    /** 与 entries 同序的物品图标。 */
    private iconFrames: Array<SpriteFrameLike> = [];
    /** 品质 → 品质框（本面板缓存，只 8 种）。 */
    private readonly qualityFrames = new Map<number, SpriteFrameLike>();
    /** 每趟 show 递增，丢弃过期异步结果。 */
    private revision = 0;
    /** {@link ensureInit} 是否跑过（幂等标记）。 */
    private inited = false;

    // ============================================================
    // 生命周期
    // ============================================================

    protected onLoad(): void {
        this.ensureInit();
    }

    /**
     * 拿组件 + 接列表回调（幂等）。
     *
     * ⚠️ 不能只放在 {@link onLoad}：宿主节点若初始是非激活的，引擎要等第一次激活才调 `onLoad`
     * ⇒ 「组件缓存 + 两个列表回调」全都挂不上，而**一个字都不报**（列表一片空白）。
     * {@link show} 开头先调一次兜住。
     */
    private ensureInit(): void {
        if (this.inited) return;
        this.inited = true;

        // prefab 已绑好，不判空：绑错应当场抛出来，而不是静默留个死界面。
        this.list = this.grid.getComponent(VirtualScrollView);
        this.panelWidget = this.node.getComponent(Widget);
        this.panelTopBase = this.panelWidget.top;

        // 两个回调只接一次（技能 §20.7：放 onOpen 会随每次打开重复叠加）。
        this.list.renderItemFn = (node: Node, index: number) => this.renderItem(node, index);
        this.list.onItemClickFn = (_node: Node, index: number) => this.onItemClick(index);
    }

    // ============================================================
    // 对外
    // ============================================================

    /** 切换页签并铺列表（列表区**常驻**在角色页下半屏，不是弹层）。 */
    async show(tab: RoleBagTabId, gemEquipId = 0): Promise<void> {
        const rev = (this.revision += 1);
        this.ensureInit(); // 宿主可能还没激活过 ⇒ onLoad 没跑，这里兜住

        const entries = roleRepository.bagEntries(tab);
        this.entries = tab === 1 && gemEquipId
            ? entries.filter(entry => (entry as IRoleGemEntry).equipId === gemEquipId)
            : entries;

        // 预加载物品图标（先 await 完，再 refresh —— renderItemFn 同步）。
        const icons = await Promise.all(this.entries.map((e) => loadRoleBagIcon(e)));
        if (rev !== this.revision) return;
        this.iconFrames = icons;

        // 预加载本页出现的品质框（去重，含空槽用的 1 号中性框）。
        const qualities = Array.from(new Set([1, ...this.entries.map((e) => e.quality)]));
        await Promise.all(
            qualities.map(async (q) => {
                this.qualityFrames.set(q, await loadRoleQualityFrame(q));
            }),
        );
        if (rev !== this.revision) return;

        // 按实际物品数量刷新列表（对齐老端 TabGem / TabRoleEquip / TabRoleItem，有多少显示多少，不额外补空白框）。
        this.list.refreshList(this.entries.length);
        this.list.scrollToTop(false);
        // 顶部宝石功能行显隐会改面板高度；这里再同步一次视口，兜住 Widget 对齐晚于列表刷新的时序。
        this.list.refreshViewportSize();
        this.emptyTip.active = this.entries.length === 0;
    }

    /**
     * 顶部宝石功能行隐藏后，让列表区整体上探、占满空出来的高度（底边仍贴页签栏）。
     *
     * 只改 `Widget.top`：BagPanel 是上下双向拉伸，上边一收高度自动补到下方，
     * `Viewport` 再跟着铺满，不用手写尺寸。
     * 视口高度变了要让虚拟列表重新量一次，否则可见行数与滚动边界还按旧高度算
     * （`_viewportSize` 只在 `start()` 里取一次）。
     *
     * @param extra 顶部空出的高度（0 = 还原设计稿布局）
     */
    setTopExtra(extra: number): void {
        this.ensureInit();
        if (extra === this.topExtra) return;
        this.topExtra = extra;
        this.panelWidget.top = this.panelTopBase - extra;
        this.panelWidget.updateAlignment();
        this.list.refreshViewportSize();
    }

    /**
     * 清空列表（角色页关闭时调，或切换页签前重置）。
     *
     * ⚠️ **不隐藏节点**：列表区是角色页下半屏的一部分，藏了会出现「下半屏空白」。
     * 页面整体关闭时随宿主节点一起隐藏即可。
     */
    hide(): void {
        this.ensureInit();
        this.revision += 1;
        this.entries = [];
        this.iconFrames = [];
        this.list.refreshList(0);
    }

    // ============================================================
    // 内部
    // ============================================================

    /** 铺一格（图标 / 品质框 / 数量 / 品阶 / 标记全部无条件写）。 */
    private renderItem(node: Node, index: number): void {
        const item = node.getComponent(RoleBagItem);
        if (!item) return;

        const entry = this.entries[index];
        if (!entry) {
            node.active = false;
            return;
        }

        item.render(
            this.qualityFrames.get(entry.quality) ?? null,
            this.iconFrames[index] ?? null,
            {
                selected: false,
                equipped: entry.equipped,
                upMark: entry.upMark,
                redDot: false,
            },
            bagCountText(entry),
            bagRankText(entry),
        );
    }

    /**
     * 点一格：
     * · 道具 → 通用物品详情。装备与宝石走角色操作。
     * · 宝石交由角色 Controller 展示详情或确认镶嵌。
     */
    private onItemClick(index: number): void {
        const entry = this.entries[index];
        if (!entry) return;
        if (entry.kind === 'gem') {
            EventMgr.instance.emit(RoleEvent.Intent, { kind: 'gem', id: (entry as IRoleGemEntry).gemId });
            return;
        }
        if (entry.kind === 'equip') {
            if (entry.uniqueId) EventMgr.instance.emit(RoleEvent.Intent, { kind: 'equip', id: entry.uniqueId });
            return;
        }
        void ItemInfoPage.open({
            userData: { resId: entry.resId, number: entry.count },
            allowMultiple: true,
        });
    }
}

type SpriteFrameLike = import('cc').SpriteFrame | null;
