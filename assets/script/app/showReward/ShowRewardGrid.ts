import { _decorator, Component, EventTouch, Node, UITransform } from 'cc';
import { contentHeightOf, maxTopRowOf, SR_STEP_Y, SR_VIEW_H, windowSlotOf } from './ShowRewardTable';

// 公式真源在零 `cc` 的 ShowRewardTable（便于单测穷举），这里只转发，不另写一份。
export { windowSlotOf } from './ShowRewardTable';

const { ccclass, property } = _decorator;

/** 拖动超过该距离（像素）不算「点一格」，避免滑列表误触。 */
const TAP_TOLERANCE = 12;

/**
 * 按行虚拟网格（4×3 可见 = 12 个固定槽位，只换数据不建节点）。
 * 不用 VScrollView：它表达不了 N 列流式换行，且对 12 格的弹窗过重。
 *
 * 虚拟化口径：槽位位置固定，滚动 = 换数据窗口（不是移动 Content）。
 * 槽位 i 视觉行 = ⌊i/4⌋，数据行 = topRow + ⌊i/4⌋（公式见 ShowRewardTable.windowSlotOf）。
 * 代价：拖动不跟手，松手按离散行吸附。
 *
 * 点击：槽位 TOUCH_END 在 onLoad 绑一次、闭包捕获槽位序号（槽位会复用，不捕获数据下标）；
 * 无 cc.Button 故用 TOUCH_END 而非 CLICK；位移超 TAP_TOLERANCE 不当点击。
 */
@ccclass('ShowRewardGrid')
export class ShowRewardGrid extends Component {
    @property({ type: Node, tooltip: 'Content：槽位容器（不参与滚动，子节点 = 预摆的 12 个 ShowRewardItem）' })
    content: Node = null!;

    /** 铺一格（重绑时按 dataIndex 现取数据）。 */
    renderItem: ((node: Node, dataIndex: number) => void) | null = null;

    /** 点一格（参数是数据下标，不是槽位下标）。 */
    onItemClick: ((dataIndex: number) => void) | null = null;

    /** 数据总数。 */
    private _total = 0;
    /** 当前顶行下标。 */
    private _topRow = 0;
    /** 最大顶行下标。 */
    private _maxTopRow = 0;
    /** 按下时的 UI 坐标 y。 */
    private _dragStartY = 0;
    /** 按下时的顶行下标（拖动相对它折算）。 */
    private _dragStartRow = 0;
    private _dragging = false;
    /** 每个槽位当前承载的数据下标（`-1` = 空槽）。 */
    private _slotDataIndex: number[] = [];
    /** 本轮触摸是否移动超容差。 */
    private _moved = false;

    // ============================================================
    // 生命周期
    // ============================================================

    protected onLoad(): void {
        this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.on(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        this.node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.on(Node.EventType.TOUCH_CANCEL, this.onTouchEnd, this);

        // 槽位点击只在这里绑一次（见类注释）。
        const slots = this.slots;
        for (let i = 0; i < slots.length; i += 1) {
            slots[i].on(Node.EventType.TOUCH_END, () => this.onSlotTap(i), this);
        }
    }

    // ============================================================
    // 对外
    // ============================================================

    /** 预摆槽位（按 Content 子节点序，非运行时创建）。 */
    get slots(): Node[] {
        return this.content ? [...this.content.children] : [];
    }

    /** 重铺列表（`total` 为 0 时槽位全空）。 */
    refreshList(total: number): void {
        this._total = Math.max(0, Math.floor(Number(total) || 0));
        this._maxTopRow = maxTopRowOf(this._total, this.viewHeight);

        // Content 尺寸只作内容高度的记录（不参与滚动），便于编辑器里判断能否滚。
        const contentUi = this.content?.getComponent(UITransform);
        if (contentUi) contentUi.setContentSize(contentUi.contentSize.width, contentHeightOf(this._total));

        // 不重置 _topRow（仅越界时收敛）：点格后也会调本函数，重置会自己跳回顶部。
        this._topRow = Math.min(this._topRow, this._maxTopRow);
        this.bindSlots();
    }

    /** 数据总数（探针 / 单测用）。 */
    get total(): number {
        return this._total;
    }

    /** 当前顶行下标。 */
    get topRow(): number {
        return this._topRow;
    }

    /** 是否正在拖动（探针用）。 */
    get isDragging(): boolean {
        return this._dragging;
    }

    /** 某槽位当前承载的数据下标（探针用；`-1` = 空槽）。 */
    slotDataIndexOf(slot: number): number {
        return this._slotDataIndex[slot] ?? -1;
    }

    /** 直接改滚动行（绕过触摸，探针用）。 */
    scrollToRow(row: number): void {
        this._topRow = Math.max(0, Math.min(this._maxTopRow, Math.floor(row) || 0));
        this.bindSlots();
    }

    // ============================================================
    // 内部
    // ============================================================

    private get viewHeight(): number {
        const h = this.node.getComponent(UITransform)?.contentSize.height ?? 0;
        return h > 0 ? h : SR_VIEW_H;
    }

    /**
     * 槽位无条件重绑到当前窗口（复用槽位不重写会残留上一屏）；
     * 越界槽位 active=false、数据下标置 -1。
     */
    private bindSlots(): void {
        const slots = this.slots;
        for (let i = 0; i < slots.length; i += 1) {
            const node = slots[i];
            const where = windowSlotOf(i, this._topRow);
            const has = where >= 0 && where < this._total;
            node.active = has;
            this._slotDataIndex[i] = has ? where : -1;
            if (!has) continue;
            // 回调按 index 现取，不闭包捕获。
            this.renderItem?.(node, where);
        }
    }

    // ---------- 拖动 ----------

    private onTouchStart(event: EventTouch): void {
        this._moved = false;
        this._dragStartY = event.getUILocation().y;
        this._dragStartRow = this._topRow;
        this._dragging = this._maxTopRow > 0;
    }

    /** 拖动：按累积位移实时折算行（离散换行，不跟手）；手指上拖（dy<0）⇒ 顶行增大。 */
    private onTouchMove(event: EventTouch): void {
        if (!this._dragging) return;
        const dy = event.getUILocation().y - this._dragStartY;
        if (Math.abs(dy) > TAP_TOLERANCE) this._moved = true;
        const row = Math.max(0, Math.min(this._maxTopRow, this._dragStartRow - dy / SR_STEP_Y));
        const rounded = Math.round(row);
        if (rounded !== this._topRow) {
            this._topRow = rounded;
            this.bindSlots();
        }
    }

    private onTouchEnd(): void {
        this._dragging = false;
    }

    /** 点了一个槽位；槽位 TOUCH_END 先于网格触发，此时 _moved 已是最终值，可挡掉滑完抬手那一下。 */
    private onSlotTap(slot: number): void {
        if (this._moved) return;
        const dataIndex = this._slotDataIndex[slot] ?? -1;
        if (dataIndex < 0 || dataIndex >= this._total) return;
        this.onItemClick?.(dataIndex);
    }
}
