import {
    _decorator, Button, Component, Label, Node, type SpriteFrame, UITransform, Widget,
} from 'cc';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { EventMgr } from '../../framework/event/EventMgr';
import { FW } from '../../framework/FW';
import { RoleEvent } from './RoleEvents';
import {
    EQUIP_DECOMPOSE_MAX,
    autoSelectDecompose,
    decomposeFitsFilter,
    toggleDecomposeSelection,
    type IEquipDecomposeFilter,
} from './EquipDecomposeTable';
import type { IRoleDecomposeResult, IRoleGemEntry } from './RoleTypes';
import { ItemInfoPage } from '../itemdetail/ItemInfoPage';
import { roleRepository } from './RoleRepository';
import { loadRoleBagIcon, loadRoleQualityFrame } from './RoleArtLoader';
import { bagCountText, bagRankText } from './RoleTable';
import { ROLE_TEXTS } from './RoleTexts';
import type { IRoleBagEntry, RoleBagTabId } from './RoleTypes';
import { RoleBagItem } from './RoleBagItem';

const { ccclass, property } = _decorator;

/** 分解筛选的默认值（老端进入分解页时的初始档位：3 阶及以下 / 史诗及以下）。 */
const DECOMPOSE_DEFAULT_RANK = 3;
const DECOMPOSE_DEFAULT_QUALITY = 4;
const DECOMPOSE_MAX_RANK = 6;
const DECOMPOSE_MAX_QUALITY = 7;

/**
 * 背包列表面板（挂 Role.prefab 内的 `BagPanel` 节点，全屏覆盖在角色主界面上）。
 *
 * 三个页签共用本面板：{@link show} 传 tab id，按 tab 取数、预加载图、重铺列表。
 * 装备页签额外提供**分解模式**（{@link enterDecompose}）：只铺背包中未穿戴的装备，
 * 点格勾选、底部操作条汇总返还、`分解`一次把整组 id 交给 Controller。
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

    /** 缓存：Grid（Viewport）的 Widget —— 分解模式下收底，给操作条让位。 */
    private viewportWidget: Widget = null!;
    private viewportBottomBase = 0;

    /** 缓存：EmptyTip 上的 Label（空态文案随页签 / 模式变化）。 */
    private emptyTipLabel: Label = null!;

    /** 当前展示条目（已排序）。 */
    private entries: IRoleBagEntry[] = [];
    /** 与 entries 同序的物品图标。 */
    private iconFrames: Array<SpriteFrameLike> = [];
    /** 品质 → 品质框（本面板缓存，只 8 种）。 */
    private readonly qualityFrames = new Map<number, SpriteFrameLike>();
    /** 每趟异步铺列表递增，丢弃过期结果。 */
    private revision = 0;
    /** {@link ensureInit} 是否跑过（幂等标记）。 */
    private inited = false;

    /** 当前页签（分解模式只在 2 = 装备页签可用）。 */
    private tab: RoleBagTabId = 1;

    // ============================================================
    // 分解模式
    // ============================================================

    private decomposing = false;
    private decomposeBusy = false;
    private decomposeRank = DECOMPOSE_DEFAULT_RANK;
    private decomposeQuality = DECOMPOSE_DEFAULT_QUALITY;
    /** 已勾选装备 uniqueId（全量；渲染时按当前筛选后的 entries 现取）。 */
    private readonly selectedIds = new Set<string>();

    @property({ type: Widget, tooltip: '分解操作条的底部定位' })
    private bar: Widget = null!;

    @property({ type: Label, tooltip: '分解操作条的收益汇总' })
    private barSummary: Label = null!;

    @property({ type: Button, tooltip: '关闭背包内的分解模式' })
    private barCancel: Button = null!;

    @property({ type: Button, tooltip: '确认分解已选装备' })
    private barDecompose: Button = null!;

    @property({ type: Label, tooltip: '分解按钮的数量文案' })
    private barDecomposeLabel: Label = null!;

    // ============================================================
    // 生命周期
    // ============================================================

    protected onLoad(): void {
        this.ensureInit();
        this.barCancel.node.on(Button.EventType.CLICK, this.onDecomposeCancel, this);
        this.barDecompose.node.on(Button.EventType.CLICK, this.onDecomposeConfirm, this);
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
        this.viewportWidget = this.grid.getComponent(Widget);
        this.viewportBottomBase = this.viewportWidget.bottom;
        this.emptyTipLabel = this.emptyTip.getComponent(Label);

        // 两个回调只接一次（技能 §20.7：放 onOpen 会随每次打开重复叠加）。
        this.list.renderItemFn = (node: Node, index: number) => this.renderItem(node, index);
        this.list.onItemClickFn = (_node: Node, index: number) => this.onItemClick(index);
    }

    // ============================================================
    // 对外
    // ============================================================

    /** 是否处于装备分解模式。 */
    get isDecomposing(): boolean {
        return this.decomposing;
    }

    /** 当前分解筛选（RolePage 用来刷新顶部按钮文案）。 */
    get decomposeRankFilter(): number {
        return this.decomposeRank;
    }

    get decomposeQualityFilter(): number {
        return this.decomposeQuality;
    }

    /** 切换页签并铺列表（列表区**常驻**在角色页下半屏，不是弹层）。 */
    async show(tab: RoleBagTabId, gemEquipId = 0): Promise<void> {
        this.ensureInit(); // 宿主可能还没激活过 ⇒ onLoad 没跑，这里兜住
        if (this.decomposing) this.exitDecompose(false);
        this.tab = tab;

        const entries = roleRepository.bagEntries(tab);
        const filtered = tab === 1 && gemEquipId
            ? entries.filter(entry => (entry as IRoleGemEntry).equipId === gemEquipId)
            : entries;

        await this.present(filtered, ROLE_TEXTS.equipEmpty);
        // 顶部宝石功能行显隐会改面板高度；这里再同步一次视口，兜住 Widget 对齐晚于列表刷新的时序。
        this.list.refreshViewportSize();
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
     * 进入装备分解模式：只铺可分解（未穿戴）的背包装备，默认 3 阶 / 史诗及以下并自动勾选。
     *
     * 没有「正在分解」遮罩：请求期间只把底部按钮置灰，回包后直接退出模式 / 弹奖励。
     */
    async enterDecompose(): Promise<void> {
        if (this.tab !== 2 || this.decomposing) return;
        this.ensureInit();

        this.decomposing = true;
        this.decomposeBusy = false;
        this.decomposeRank = DECOMPOSE_DEFAULT_RANK;
        this.decomposeQuality = DECOMPOSE_DEFAULT_QUALITY;
        this.selectedIds.clear();
        this.bar.node.active = true;
        this.setViewportBottom(this.bar.bottom + this.bar.getComponent(UITransform).height);
        EventMgr.instance.emit(RoleEvent.DecomposeModeChanged);
        await this.applyDecomposeFilter();
    }

    /** 退出分解模式；`restore = true` 时同时把列表恢复成完整装备背包。 */
    exitDecompose(restore = true): void {
        if (!this.decomposing) return;
        this.decomposing = false;
        this.decomposeBusy = false;
        this.selectedIds.clear();
        this.bar.node.active = false;
        this.setViewportBottom(this.viewportBottomBase);
        EventMgr.instance.emit(RoleEvent.DecomposeModeChanged);
        if (restore) void this.show(this.tab);
    }

    /** 顶部「阶数」筛选：按 1..6 循环，切档后老端口径清空重选。 */
    async cycleDecomposeRank(): Promise<void> {
        if (!this.decomposing) return;
        this.decomposeRank = this.decomposeRank >= DECOMPOSE_MAX_RANK ? 1 : this.decomposeRank + 1;
        EventMgr.instance.emit(RoleEvent.DecomposeModeChanged);
        await this.applyDecomposeFilter();
    }

    /** 顶部「品质」筛选：按 1..7 循环。 */
    async cycleDecomposeQuality(): Promise<void> {
        if (!this.decomposing) return;
        this.decomposeQuality = this.decomposeQuality >= DECOMPOSE_MAX_QUALITY ? 1 : this.decomposeQuality + 1;
        EventMgr.instance.emit(RoleEvent.DecomposeModeChanged);
        await this.applyDecomposeFilter();
    }

    /** 顶部「全选」：把当前筛选命中的前 99 件全部勾上。 */
    selectAllDecompose(): void {
        if (!this.decomposing) return;
        const filter = this.currentFilter();
        this.selectedIds.clear();
        for (const id of autoSelectDecompose(this.candidateFacts(), filter)) this.selectedIds.add(id);
        this.list.refreshList(this.entries.length);
        this.updateBar();
    }

    /** Controller 回包：成功退出模式并恢复列表，失败保留选择让玩家重试。 */
    async finishDecompose(result: IRoleDecomposeResult): Promise<void> {
        this.decomposeBusy = false;
        if (!this.isValid) return;
        if (result.status !== 'ok') {
            FW.showTip(ROLE_TEXTS.decomposeFailed);
            if (this.decomposing) this.updateBar();
            return;
        }
        const requested = this.selectedIds.size;
        const removed = result.removedIds.length;
        if (requested > removed) FW.showTip(ROLE_TEXTS.decomposePartial(requested - removed));
        else if (result.rewards.length === 0) FW.showTip(ROLE_TEXTS.decomposeDone);

        this.exitDecompose(false);
        await this.show(this.tab);
        EventMgr.instance.emit(RoleEvent.EquipChanged);
    }

    /**
     * 清空列表（角色页关闭时调，或切换页签前重置）。
     *
     * ⚠️ **不隐藏节点**：列表区是角色页下半屏的一部分，藏了会出现「下半屏空白」。
     * 页面整体关闭时随宿主节点一起隐藏即可。
     */
    hide(): void {
        this.ensureInit();
        this.exitDecompose(false);
        this.revision += 1;
        this.entries = [];
        this.iconFrames = [];
        this.list.refreshList(0);
    }

    // ============================================================
    // 内部：分解
    // ============================================================

    private currentFilter(): IEquipDecomposeFilter {
        return { rank: this.decomposeRank, quality: this.decomposeQuality };
    }

    /** 可分解事实（与仓库 `decomposeCandidates()` 同序）。 */
    private candidateFacts(): Array<{
        uniqueId: string; rank: number; quality: number; decompose: number; equipped: boolean;
    }> {
        return roleRepository.decomposeCandidates().map(entry => ({
            uniqueId: entry.uniqueId ?? '',
            rank: entry.rank,
            quality: entry.quality,
            decompose: entry.decompose ?? 0,
            equipped: entry.equipped,
        }));
    }

    /** 切筛选 / 进入模式：重新取候选、过滤、自动勾选命中的前 99 件。 */
    private async applyDecomposeFilter(): Promise<void> {
        const filter = this.currentFilter();
        const all = roleRepository.decomposeCandidates();
        const filtered = all.filter(entry => decomposeFitsFilter(entry.rank, entry.quality, filter));

        this.selectedIds.clear();
        for (const id of autoSelectDecompose(this.candidateFacts(), filter)) this.selectedIds.add(id);

        await this.present(filtered, ROLE_TEXTS.decomposeEmpty);
        if (this.decomposing) this.updateBar();
    }

    private onDecomposeCancel(): void {
        this.exitDecompose();
    }

    /** 请求发送：只把按钮置灰，不弹「正在分解」等待态。 */
    private onDecomposeConfirm(): void {
        if (this.decomposeBusy || this.selectedIds.size === 0) return;
        this.decomposeBusy = true;
        this.updateBar();
        EventMgr.instance.emit(RoleEvent.Intent, { kind: 'decompose', ids: Array.from(this.selectedIds) });
    }

    /** 底部操作条：已选件数 / 预计返还 / 分解按钮文案。 */
    private updateBar(): void {
        const summary = roleRepository.decomposeSummary(Array.from(this.selectedIds));
        this.barSummary.string = ROLE_TEXTS.decomposeSelected(summary.count, EQUIP_DECOMPOSE_MAX, summary.gain);
        this.barDecomposeLabel.string = ROLE_TEXTS.decomposeConfirm(summary.count);
        this.barDecompose.interactable = summary.count > 0 && !this.decomposeBusy;
    }

    private setViewportBottom(bottom: number): void {
        this.viewportWidget.bottom = bottom;
        this.viewportWidget.updateAlignment();
        this.list.refreshViewportSize();
    }

    // ============================================================
    // 内部：铺列表
    // ============================================================

    /** 预加载图 + 铺列表（`show` 与分解筛选共用）。 */
    private async present(entries: IRoleBagEntry[], emptyText: string): Promise<boolean> {
        const rev = (this.revision += 1);
        this.entries = entries;

        // 预加载物品图标（先 await 完，再 refresh —— renderItemFn 同步）。
        const icons = await Promise.all(entries.map((e) => loadRoleBagIcon(e)));
        if (rev !== this.revision) return false;
        this.iconFrames = icons;

        // 预加载本页出现的品质框（去重，含空槽用的 1 号中性框）。
        const qualities = Array.from(new Set([1, ...entries.map((e) => e.quality)]));
        await Promise.all(qualities.map(async (q) => {
            this.qualityFrames.set(q, await loadRoleQualityFrame(q));
        }));
        if (rev !== this.revision) return false;

        // 按实际物品数量刷新列表（对齐老端 TabGem / TabRoleEquip / TabRoleItem，有多少显示多少，不额外补空白框）。
        this.list.refreshList(this.entries.length);
        this.list.scrollToTop(false);
        this.emptyTipLabel.string = emptyText;
        this.emptyTip.active = this.entries.length === 0;
        return true;
    }

    /** 铺一格（图标 / 品质框 / 数量 / 品阶 / 标记全部无条件写）。 */
    private renderItem(node: Node, index: number): void {
        const item = node.getComponent(RoleBagItem);
        if (!item) return;

        const entry = this.entries[index];
        if (!entry) {
            node.active = false;
            return;
        }

        const gem = entry.kind === 'gem' ? entry as IRoleGemEntry : null;
        const checked = this.decomposing && !!entry.uniqueId && this.selectedIds.has(entry.uniqueId);
        item.render(
            this.qualityFrames.get(entry.quality) ?? null,
            this.iconFrames[index] ?? null,
            {
                selected: checked,
                equipped: entry.equipped,
                upMark: entry.upMark,
                redDot: false,
                masked: gem?.masked ?? false,
                checked,
            },
            bagCountText(entry),
            bagRankText(entry),
        );
    }

    /**
     * 点一格：
     * · 分解模式 → 勾选 / 取消（已穿戴的不会进候选列表）；
     * · 道具 → 通用物品详情。装备与宝石走角色操作。
     */
    private onItemClick(index: number): void {
        const entry = this.entries[index];
        if (!entry) return;
        if (this.decomposing) {
            const id = entry.uniqueId ?? '';
            if (!id || entry.equipped) return;
            const result = toggleDecomposeSelection(Array.from(this.selectedIds), id, EQUIP_DECOMPOSE_MAX);
            if (result.rejected === 'limit') {
                FW.showTip(ROLE_TEXTS.decomposeLimit);
                return;
            }
            this.selectedIds.clear();
            for (const selected of result.selected) this.selectedIds.add(selected);
            this.list.refreshList(this.entries.length);
            this.updateBar();
            return;
        }
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
