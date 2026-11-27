import {
    _decorator, Button, instantiate, Label, Node, UITransform,
} from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { EventMgr } from '../../framework/event/EventMgr';
import { FW } from '../../framework/FW';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { roleRepository } from './RoleRepository';
import { RoleEvent, type RoleOutput } from './RoleEvents';
import { EquipDecomposeFilterPickEvent, EquipDecomposeFilterRow } from './EquipDecomposeFilterRow';
import { EquipDecomposeItem, type IEquipDecomposeItemViewData } from './EquipDecomposeItem';
import {
    EQUIP_DECOMPOSE_MAX,
    EQUIP_DECOMPOSE_QUALITY_MAX,
    autoSelectDecompose,
    decomposeFitsFilter,
    decomposeRankOptions,
    toggleDecomposeSelection,
    type IEquipDecomposeFilter,
} from './EquipDecomposeTable';
import { ROLE_TEXTS, roleQualityName } from './RoleTexts';
import { bagRankText } from './RoleTable';
import { loadRoleBagIcon, loadRoleQualityFrame } from './RoleArtLoader';
import type { IRoleBagEntry } from './RoleTypes';

const { ccclass, property } = _decorator;

type FilterMenu = 'rank' | 'quality';

/**
 * 装备分解弹窗（按蓝湖效果稿 `0dbb5bbb` 重建）。
 *
 * 结构：木质标题牌 + 面板、「分解获得」奖励条、装备网格、底部两颗筛选下拉与分解按钮。
 * 进入时**不筛**（按钮显示「全部」）；阶下拉只列背包实际出现的阶，品质下拉 1..7。
 * 选档后按「N 阶及以下 / 品质及以下」重算自动勾选（99 上限沿用 `EquipDecomposeTable`），
 * 选「全部」只回到不筛并清空勾选，不自动全选。分解请求仍经 `RoleEvent.Intent` 交给
 * Controller，回包 `decomposeDone` 由本弹窗收口。
 */
@ccclass('EquipDecomposePopup')
export class EquipDecomposePopup extends PopupBase {
    static prefabPath = 'ui/Role/EquipDecomposePopup';

    @property({ type: Button, tooltip: '关闭按钮' })
    btnClose: Button = null!;

    @property({ type: Button, tooltip: '阶级筛选条' })
    btnRankFilter: Button = null!;

    @property({ type: Label, tooltip: '阶级筛选标题' })
    private rankFilterLabel: Label = null!;

    @property({ type: Node, tooltip: '阶级筛选展开箭头' })
    rankArrow: Node = null!;

    @property({ type: Button, tooltip: '品质筛选条' })
    btnQualityFilter: Button = null!;

    @property({ type: Label, tooltip: '品质筛选标题' })
    private qualityFilterLabel: Label = null!;

    @property({ type: Node, tooltip: '品质筛选展开箭头' })
    qualityArrow: Node = null!;

    @property({ type: UITransform, tooltip: '阶级下拉列表' })
    rankList: UITransform = null!;

    @property({ type: UITransform, tooltip: '品质下拉列表' })
    qualityList: UITransform = null!;

    @property({ type: UITransform, tooltip: '下拉行模板（隐藏）' })
    filterRowTemplate: UITransform = null!;

    @property({ tooltip: '下拉列表顶部内边距' })
    filterPaddingTop = 0;

    @property({ tooltip: '下拉列表底部内边距' })
    filterPaddingBottom = 0;

    @property({ type: VirtualScrollView, tooltip: '装备虚拟网格' })
    grid: VirtualScrollView = null!;

    @property({ type: Node, tooltip: '空态提示' })
    emptyLabel: Node = null!;

    @property({ type: Node, tooltip: '奖励格容器' })
    rewardContent: Node = null!;

    @property({ type: Node, tooltip: '奖励格模板（潜藏）' })
    rewardTemplate: Node = null!;

    @property({ type: Button, tooltip: '分解按钮' })
    btnConfirm: Button = null!;

    private rankLimit = -1;
    private qualityLimit = -1;
    private menu: FilterMenu | null = null;
    private readonly selectedIds = new Set<string>();
    private readonly rankRows: EquipDecomposeFilterRow[] = [];
    private readonly qualityRows: EquipDecomposeFilterRow[] = [];
    private decomposePending = false;
    private refreshRevision = 0;
    private items: readonly IEquipDecomposeItemViewData[] = [];
    private readonly itemViews = new Map<Node, EquipDecomposeItem>();

    protected onInit(): void {
        this.grid.renderItemFn = this.renderGridItem.bind(this);
        this.bindEvents();
    }

    protected onOpen(): Promise<void> {
        this.rankLimit = -1;
        this.qualityLimit = -1;
        this.decomposePending = false;
        this.selectedIds.clear();
        this.hideFilterLists();
        this.renderControls();
        EventMgr.instance.on(RoleEvent.Output, this.onRoleOutput, this);
        EventMgr.instance.on(RoleEvent.DecomposeItemClick, this.onItemClick, this);
        return this.refresh();
    }

    protected onClose(): void {
        EventMgr.instance.offTarget(this);
        this.decomposePending = false;
        this.menu = null;
    }

    onDestroy(): void {
        EventMgr.instance.offTarget(this);
        super.onDestroy();
    }

    /** 下拉展开时，空白点击先收下拉，不直接关弹窗。 */
    protected canCloseOnBlank(): boolean {
        if (this.menu !== null) {
            this.hideFilterLists();
            return false;
        }
        return true;
    }

    private bindEvents(): void {
        this.btnClose.node.on(Button.EventType.CLICK, () => this.close(), this);
        this.btnRankFilter.node.on(Button.EventType.CLICK, () => this.toggleMenu('rank'), this);
        this.btnQualityFilter.node.on(Button.EventType.CLICK, () => this.toggleMenu('quality'), this);
        this.rankList.node.on(EquipDecomposeFilterPickEvent.TYPE, this.pickRank, this);
        this.qualityList.node.on(EquipDecomposeFilterPickEvent.TYPE, this.pickQuality, this);
        this.btnConfirm.node.on(Button.EventType.CLICK, () => this.confirm(), this);
    }

    private toggleMenu(menu: FilterMenu): void {
        this.menu = this.menu === menu ? null : menu;
        this.applyMenuState();
    }

    private hideFilterLists(): void {
        this.menu = null;
        this.applyMenuState();
    }

    private applyMenuState(): void {
        this.rankList.node.active = this.menu === 'rank';
        this.qualityList.node.active = this.menu === 'quality';
        this.rankArrow.setScale(1, this.menu === 'rank' ? 1 : -1, 1);
        this.qualityArrow.setScale(1, this.menu === 'quality' ? 1 : -1, 1);
        this.renderFilterChecks();
    }

    /** 阶下拉只列背包实际出现的阶；「全部」(-1) 固定在首位。 */
    private syncFilterOptions(entries: readonly IRoleBagEntry[]): void {
        this.syncRankRows(decomposeRankOptions(this.candidateFacts(entries)));
        this.buildQualityRows();
        this.renderFilterChecks();
        this.renderFilterTitles();
    }

    private syncRankRows(ranks: readonly number[]): void {
        const values = [-1, ...ranks];
        const unchanged = values.length === this.rankRows.length
            && values.every((value, index) => value === this.rankRows[index].value);
        if (unchanged) return;

        this.clearFilterRows(this.rankRows);
        for (const value of values) {
            this.rankRows.push(this.createFilterRow(
                this.rankList.node,
                value < 0 ? ROLE_TEXTS.decomposeAll : `${value}阶及以下`,
                value,
            ));
        }
        // 已选阶被分解完 ⇒ 回到「全部」，避免按钮文案指向不存在的档位
        if (!values.includes(this.rankLimit)) this.rankLimit = -1;
        this.layoutFilterRows(this.rankList, this.rankRows);
    }

    private buildQualityRows(): void {
        if (this.qualityRows.length > 0) return;
        this.qualityRows.push(this.createFilterRow(
            this.qualityList.node, ROLE_TEXTS.decomposeAll, -1,
        ));
        for (let quality = 1; quality <= EQUIP_DECOMPOSE_QUALITY_MAX; quality++) {
            this.qualityRows.push(this.createFilterRow(
                this.qualityList.node, `${roleQualityName(quality)}及以下`, quality,
            ));
        }
        this.layoutFilterRows(this.qualityList, this.qualityRows);
    }

    private clearFilterRows(rows: EquipDecomposeFilterRow[]): void {
        for (const row of rows) {
            row.node.removeFromParent();
            row.node.destroy();
        }
        rows.length = 0;
    }

    private createFilterRow(list: Node, text: string, value: number): EquipDecomposeFilterRow {
        const node = instantiate(this.filterRowTemplate.node);
        const row = node.getComponent(EquipDecomposeFilterRow);
        if (!row) {
            node.destroy();
            throw new Error('FilterRowTemplate 缺少 EquipDecomposeFilterRow 组件');
        }
        node.name = value < 0 ? 'Option_All' : `Option_${value}`;
        row.render(text, value);
        list.addChild(node);
        node.active = true;
        return row;
    }

    private layoutFilterRows(list: UITransform, rows: readonly EquipDecomposeFilterRow[]): void {
        const rowHeight = this.filterRowTemplate.height;
        const height = this.filterPaddingTop + this.filterPaddingBottom + rows.length * rowHeight;
        list.height = height;
        for (let index = 0; index < rows.length; index++) {
            rows[index].node.setPosition(0, height - this.filterPaddingTop - (index + 0.5) * rowHeight);
        }
    }

    private renderFilterChecks(): void {
        for (const row of this.rankRows) {
            row.renderSelection(this.rankLimit);
        }
        for (const row of this.qualityRows) {
            row.renderSelection(this.qualityLimit);
        }
    }

    private renderFilterTitles(): void {
        this.rankFilterLabel.string = this.rankLimit < 0
            ? ROLE_TEXTS.decomposeAll
            : ROLE_TEXTS.decomposeRank(this.rankLimit);
        this.qualityFilterLabel.string = this.qualityLimit < 0
            ? ROLE_TEXTS.decomposeAll
            : ROLE_TEXTS.decomposeQuality(this.qualityLimit);
    }

    private pickRank(event: EquipDecomposeFilterPickEvent): void {
        this.rankLimit = event.value;
        this.onFilterChanged();
    }

    private pickQuality(event: EquipDecomposeFilterPickEvent): void {
        this.qualityLimit = event.value;
        this.onFilterChanged();
    }

    private onFilterChanged(): void {
        this.hideFilterLists();
        // 「全部」只回到不筛并清空，不自动全选；选具体档位才按老端 fliterEquipItem 自动勾选
        this.clearSelection(this.rankLimit >= 0 || this.qualityLimit >= 0);
        this.renderFilterTitles();
        void this.refresh();
    }

    private filter(): IEquipDecomposeFilter {
        return { rank: this.rankLimit, quality: this.qualityLimit };
    }

    private candidateFacts(entries: readonly IRoleBagEntry[]): Array<{
        uniqueId: string; rank: number; quality: number; decompose: number; equipped: boolean;
    }> {
        return entries.map(entry => ({
            uniqueId: entry.uniqueId ?? '',
            rank: entry.rank,
            quality: entry.quality,
            decompose: entry.decompose ?? 0,
            equipped: entry.equipped,
        }));
    }

    private clearSelection(autoFill: boolean): void {
        this.selectedIds.clear();
        if (autoFill) {
            const entries = roleRepository.decomposeCandidates();
            for (const id of autoSelectDecompose(this.candidateFacts(entries), this.filter())) {
                this.selectedIds.add(id);
            }
        }
        this.renderFilterChecks();
    }

    private onItemClick(uniqueId: string, source?: object): void {
        if (this.decomposePending || !(source instanceof EquipDecomposeItem)
            || !source.node.active || this.itemViews.get(source.node) !== source) return;
        const result = toggleDecomposeSelection(Array.from(this.selectedIds), uniqueId, EQUIP_DECOMPOSE_MAX);
        if (result.rejected === 'limit') {
            FW.showTip(ROLE_TEXTS.decomposeLimit);
            return;
        }
        this.selectedIds.clear();
        for (const id of result.selected) this.selectedIds.add(id);
        this.hideFilterLists();
        this.renderChecks();
        this.renderSummary();
    }

    private async refresh(): Promise<void> {
        const context = this.popupOpenContext;
        if (!context || context.cancelled) return;
        const revision = ++this.refreshRevision;
        const all = roleRepository.decomposeCandidates();
        this.syncFilterOptions(all);
        const filter = this.filter();
        const filtered = all.filter(entry => decomposeFitsFilter(entry.rank, entry.quality, filter));
        const items = await Promise.all(filtered.map(async entry => {
            const uniqueId = entry.uniqueId ?? '';
            const [iconFrame, qualityFrame] = await Promise.all([
                uniqueId ? loadRoleBagIcon(entry) : null,
                loadRoleQualityFrame(entry.quality),
            ]);
            return {
                uniqueId,
                iconFrame,
                qualityFrame,
                rankText: bagRankText(entry),
                // 暂无可独立读取的装备等级，右下角先复用品阶。
                levelText: entry.rank > 0 ? `Lv.${entry.rank}` : '',
            };
        }));
        if (!this.isValid || context.cancelled || revision !== this.refreshRevision) return;

        this.renderGrid(items);
        this.renderSummary();
    }

    private renderGrid(items: readonly IEquipDecomposeItemViewData[]): void {
        this.items = items;
        const empty = items.length === 0;
        this.emptyLabel.active = empty;
        this.grid.setTotalCount(items.length);
        this.grid.node.active = !empty;
        if (empty) return;

        const scroll = this.grid.nativeScrollView;
        scroll.stopAutoScroll();
        scroll.scrollToTop();
    }

    private renderGridItem(node: Node, index: number): void {
        let item = this.itemViews.get(node);
        if (!item) {
            item = node.getComponent(EquipDecomposeItem);
            if (!item) throw new Error('ItemTemplate 缺少 EquipDecomposeItem 组件');
            this.itemViews.set(node, item);
        }
        const data = this.items[index];
        item.render(data, this.selectedIds.has(data.uniqueId));
    }

    private renderChecks(): void {
        for (const item of this.itemViews.values()) {
            if (item.node.active) item.renderSelection(this.selectedIds.has(item.uniqueId));
        }
    }

    private renderSummary(): void {
        const summary = roleRepository.decomposeSummary(Array.from(this.selectedIds));
        this.renderReward(summary.gain);
        this.renderControls(summary.count > 0);
    }

    /** 奖励条按实际返还物数量居中排布（当前只返还精炼石，1 格居中；稿中的 3 格是模拟数据）。 */
    private renderReward(gain: number): void {
        for (const child of this.rewardContent.children.slice()) {
            child.removeFromParent();
            child.destroy();
        }
        const visible = gain > 0;
        this.rewardContent.active = visible;
        if (!visible) return;

        const cell = instantiate(this.rewardTemplate);
        cell.active = true;
        cell.name = 'RewardCell_0';
        this.rewardContent.addChild(cell);
        const count = cell.getChildByName('Count')?.getComponent(Label);
        if (count) count.string = `${gain}`;
    }

    private confirm(): void {
        if (this.decomposePending || this.selectedIds.size === 0) return;
        this.decomposePending = true;
        this.renderControls();
        EventMgr.instance.emit(RoleEvent.Intent, { kind: 'decompose', ids: Array.from(this.selectedIds) });
    }

    private renderControls(hasSelection = this.selectedIds.size > 0): void {
        const available = !this.decomposePending;
        this.btnConfirm.interactable = available && hasSelection;
        this.btnClose.interactable = available;
        this.btnRankFilter.interactable = available;
        this.btnQualityFilter.interactable = available;
    }

    private onRoleOutput(output: RoleOutput): void {
        if (!this.decomposePending || output.kind !== 'decomposeDone') return;
        this.decomposePending = false;
        if (output.status === 'ok') {
            this.close();
            return;
        }
        // 失败提示由 RolePage → RoleBagPanel.finishDecompose 统一收口，这里只恢复可用态。
        this.renderControls();
        void this.refresh();
    }
}
