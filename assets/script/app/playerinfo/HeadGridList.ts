import { _decorator, Component, EventTouch, Node, UITransform } from 'cc';
import { HEAD_ITEM_COLUMNS, HEAD_ITEM_STEP_Y, HEAD_VIEW_H } from './PlayerInfoTable';

const { ccclass, property } = _decorator;

/** 拖动超过这个距离（像素）就不算「点一格」—— 否则滑列表会误触选中。 */
const TAP_TOLERANCE = 12;

/**
 * 「更换头像」的**按行虚拟网格列表**（4 列 × 2 行可见 = 8 个预摆槽位）。
 *
 * ## 为什么不用工程的 `VirtualScrollView`
 *
 * `assets/script/vscrollview/VScrollView.ts` 是为长列表写的重组件（池化 / 动态高度 / 分页吸附
 * / 出现动效），但它**目前一个 prefab 都没在用**（全工程 grep 无命中）——属未验证路径；
 * 而且它表达不了「N 列自动换行」。换头像列表只有 20 来条、固定 4 列、只需要上下拖动
 * ⇒ 这里手搓一个最小实现：**槽位恒定 8 个、只换数据不建节点**，没有池子、没有异步。
 *
 * ## 🔴 虚拟化口径 —— 槽位**位置固定**，滚动 = 换数据窗口（**不是**移动 `Content`）
 *
 * 旧版这里是让 `Content` 上移 `topRow × step`，那是**错的**，两个症状都在线上：
 *
 * ```
 * 错：槽位固定在内容坐标里，Content 上移 topRow×step
 *      ⇒ 视口里能看到的是「槽位序号 ∈ [topRow×4, topRow×4+7]」
 *      ⇒ 槽位只有 8 个时，topRow ≥ 1 就有整行「没有槽位」⇒ 下半屏空白
 *      ⇒ 槽位 0 被推到视口外，它承载的数据（还按 topRow×4 算）永远看不见
 *
 * 对：8 个槽位**永远占据视口里的 8 个格子位置**（位置不动）
 *      ⇒ 槽位 i 的视觉行 = ⌊i / 4⌋，显示的数据行 = topRow + ⌊i / 4⌋
 *      ⇒ dataIndex = (topRow + ⌊i / 4⌋) × 4 + (i % 4)
 * ```
 *
 * 代价是拖动时看不到「跟手滑动」（松手才换数据）。这是虚拟列表的固有取舍：
 * 想跟手滑动就得让槽位跟着内容走，而槽位数得覆盖到末尾 ⇒ 等于全量实例化，就不虚拟了。
 *
 * ## 点击链路
 *
 * 槽位 → `onSlotTap(槽位序号)` → 查 `_slotDataIndex[槽位序号]` 翻成**数据下标** → `onItemClick(数据下标)`。
 *
 * ⚠️ `renderItem` **只在 `bindSlots()` 里按当前数据下标现取**，绝不闭包捕获第一次的入参
 * （规则 55 的头号坑：同一槽位会被不同数据复用，捕获了就永远显示第一条）。
 * ⚠️ 点击监听用 `Node.EventType.TOUCH_END` 而不是 `Button.EventType.CLICK` —— 槽位是纯
 * `<component>` 迁过来的、**没有 `cc.Button`**，绑 `CLICK` 是静默死按钮（规则 81b）。
 */
@ccclass('HeadGridList')
export class HeadGridList extends Component {
    @property({ type: Node, tooltip: 'Content：槽位容器（**不参与滚动**，子节点 = 8 个 ChangeHeadItem 槽位）' })
    content: Node = null;

    /** 铺一格（**在每次重绑时按 `dataIndex` 现取数据**）。 */
    renderItem: ((node: Node, dataIndex: number) => void) | null = null;

    /** 点一格（参数是**数据下标**，不是槽位下标）。 */
    onItemClick: ((dataIndex: number) => void) | null = null;

    /** 数据总数。 */
    private _total = 0;
    /** 当前顶行下标。 */
    private _topRow = 0;
    /** 最大顶行下标。 */
    private _maxTopRow = 0;
    /** 按下时的 UI 坐标 y。 */
    private _dragStartY = 0;
    /** 按下时的顶行下标（拖动是相对它折算的）。 */
    private _dragStartRow = 0;
    private _dragging = false;
    /** 每个槽位**当前**承载的数据下标（`-1` = 空槽）。点击回调靠它把「槽位」翻成「数据下标」。 */
    private _slotDataIndex: number[] = [];
    /** 本轮触摸是否移动过（超过容差）—— 拖动列表时不该误触「点一格」。 */
    private _moved = false;

    // ============================================================
    // 生命周期
    // ============================================================

    protected onLoad(): void {
        this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.on(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        this.node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.on(Node.EventType.TOUCH_CANCEL, this.onTouchEnd, this);

        // 🔴 槽位点击**只在这里绑一次**。此前 `onItemClick` 是**声明了却从不被调用**的
        //    死回调（`ChangeHeadPage` 绑了它 ⇒ 换头像点一格选不中，且一条错都不报）。
        //    闭包捕获的是**槽位序号** `slot`（固定不变），不是数据下标 —— 槽位会被复用给
        //    别的数据，捕获数据下标就会「点第 3 格触发第 1 格的逻辑」（规则 55）。
        const slots = this.slots;
        for (let i = 0; i < slots.length; i += 1) {
            slots[i].on(Node.EventType.TOUCH_END, () => this.onSlotTap(i), this);
        }
    }

    // ============================================================
    // 对外
    // ============================================================

    /** 预置槽位（按 `Content` 的子节点序，**不是**运行时创建的）。 */
    get slots(): Node[] {
        return this.content ? [...this.content.children] : [];
    }

    /**
     * 重铺列表。
     *
     * @param total 数据总数（`0` 时清空所有槽位并归零滚动）
     */
    refreshList(total: number): void {
        this._total = Math.max(0, Math.floor(Number(total) || 0));
        const rows = Math.max(1, Math.ceil(this._total / HEAD_ITEM_COLUMNS));
        const contentH = this.contentHeight(rows);
        this._maxTopRow = Math.max(0, Math.ceil((contentH - this.viewHeight) / HEAD_ITEM_STEP_Y));

        // `Content` 尺寸只为「内容到底有多高」留个可读记录（**不参与滚动**）。
        const contentUi = this.content?.getComponent(UITransform);
        if (contentUi) contentUi.setContentSize(contentUi.contentSize.width, contentH);

        // ⚠️ **不重置** `_topRow`（只在越界时收敛回上界）：`refreshList` 也会在
        //    「点一格改选中态」之后被调用，那时候重置顶行会让列表「自己跳回顶部」。
        this._topRow = Math.min(this._topRow, this._maxTopRow);
        this.bindSlots();
    }

    /** 供测试 / 探针读取。 */
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

    /** 某个槽位当前承载的数据下标（探针用；`-1` = 空槽）。 */
    slotDataIndexOf(slot: number): number {
        return this._slotDataIndex[slot] ?? -1;
    }

    /** 供探针直接改滚动行（绕过触摸）。 */
    scrollToRow(row: number): void {
        this._topRow = Math.max(0, Math.min(this._maxTopRow, Math.floor(row) || 0));
        this.bindSlots();
    }

    // ============================================================
    // 内部：槽位与滚动
    // ============================================================

    private get viewHeight(): number {
        const h = this.node.getComponent(UITransform)?.contentSize.height ?? 0;
        return h > 0 ? h : HEAD_VIEW_H;
    }

    /** 内容总高（按行数算，末行不留 gap）。 */
    private contentHeight(rows: number): number {
        const step = HEAD_ITEM_STEP_Y;
        const item = step - 18; // lineGap 20 × 0.9 = 18
        return rows * step - (step - item);
    }

    /**
     * 把 8 个槽位重绑到当前窗口的数据。
     *
     * 公式见类注释「虚拟化口径」：**槽位位置固定**，槽位 `i` 的视觉行是 `⌊i / 列数⌋`，
     * 它要显示的数据行是 `_topRow + ⌊i / 列数⌋`。
     *
     * ⚠️ 每个槽位都要写 `dataIndex`（**无条件写**，规则 82）：槽位被复用后如果只是
     * 「没数据就不动」，上一屏的图会留在屏幕上。超出总数的槽位显式 `active = false`。
     */
    private bindSlots(): void {
        const slots = this.slots;
        for (let i = 0; i < slots.length; i += 1) {
            const node = slots[i];
            const row = this._topRow + Math.floor(i / HEAD_ITEM_COLUMNS);
            const dataIndex = row * HEAD_ITEM_COLUMNS + (i % HEAD_ITEM_COLUMNS);
            const has = dataIndex >= 0 && dataIndex < this._total;
            node.active = has;
            this._slotDataIndex[i] = has ? dataIndex : -1;
            if (!has) continue;
            // 回调按 **index 现取**，不闭包捕获（规则 55）。
            this.renderItem?.(node, dataIndex);
        }
    }

    // ---------- 拖动 ----------

    private onTouchStart(event: EventTouch): void {
        this._moved = false;
        this._dragStartY = event.getUILocation().y;
        this._dragStartRow = this._topRow;
        this._dragging = this._maxTopRow > 0;
    }

    /**
     * 拖动：按累积位移**实时**折算行并重绑（离散换行，不做跟手位移 —— 见类注释的取舍）。
     *
     * 方向：手指上拖（`dy < 0`）⇒ 想看**后面**的数据 ⇒ 顶行**增大**。
     */
    private onTouchMove(event: EventTouch): void {
        if (!this._dragging) return;
        const dy = event.getUILocation().y - this._dragStartY;
        if (Math.abs(dy) > TAP_TOLERANCE) this._moved = true;
        const row = this._dragStartRow - dy / HEAD_ITEM_STEP_Y;
        const rounded = Math.max(0, Math.min(this._maxTopRow, Math.round(row)));
        if (rounded !== this._topRow) {
            this._topRow = rounded;
            this.bindSlots();
        }
    }

    private onTouchEnd(): void {
        this._dragging = false;
    }

    /**
     * 点了一个槽位。
     *
     * ⚠️ 事件顺序：槽位的 `TOUCH_END` 在**网格节点之前**触发（子节点先收）⇒ 这里读到的
     * `_moved` 还是本轮触摸的最终值，能正确挡掉「滑完列表手抬起」那一下。
     */
    private onSlotTap(slot: number): void {
        if (this._moved) return;
        const dataIndex = this._slotDataIndex[slot] ?? -1;
        if (dataIndex < 0 || dataIndex >= this._total) return;
        this.onItemClick?.(dataIndex);
    }
}
