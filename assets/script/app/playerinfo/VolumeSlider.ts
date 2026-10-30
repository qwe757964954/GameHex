import {_decorator, Component, EventTouch, Node, UITransform, Vec3} from 'cc';

const { ccclass, property } = _decorator;

/** 复用的临时向量（拖动回调每帧都会调，别在里面 `new`）。 */
const _tmpLocal = new Vec3();

/**
 * 音量滑动条（0..100）。
 *
 * 对应老端 FGUI `设置/组件/进度条/滑动条_音量.xml`（`extention="Slider"`）：
 *   `n0` 底槽 246×22 + `bar` 填充（`relation height-height`，宽度靠 `value` 改）
 *   + `grip` 滑块 40×40（`relation right-right` 跟 `bar` 右缘）。
 *
 * ## 为什么手搓而不用 `cc.Slider` / `cc.ProgressBar`
 *
 * 与 `RechargeProgressBar` / `SevenDayPointBox` 同一处置（规则 83 的教训）：
 * `cc.ProgressBar` 会**回写** `barSprite.contentSize.width = totalLength × progress` 并把锚点
 * 强制成 `(0, 0.5)`；`cc.Slider` 还要另外引 `handle` + 一堆 `_progress` 早退 setter，
 * 槽位复用时会把宽度停在上一笔的值上。本组件只做「改一次宽度 + 挪一次滑块」，两个属性、
 * 没有隐藏状态，也不需要 prefab 里烘任何特殊锚点（生成器给所有节点的锚点恒为 `(0, 1)`）。
 *
 * ## 几何口径（**不依赖锚点**，只用设计值反推）
 *
 * 生成器把 FGUI 的 `scale` 吸进了尺寸、几何全部烘成画布绝对值，所以运行时的局部坐标
 * 就是设计期那一份。按下式换算：
 *
 * ```
 * ratio = value / 100                        // 0..1
 * Fill.width = TrackWidth × ratio            // 锚点 (0,1) ⇒ 左缘不动、向右长
 * Grip.x     = GripDesignX − TrackWidth × (1 − ratio)
 * ```
 *
 * `GripDesignX` 是 **prefab 里烘的**（设计值 = 100 ⇒ `ratio = 1`）：FGUI 的 `grip` 带
 * `relation right-right`，所以设计位置上它正好贴在满宽填充的右缘，反推成立。
 */
@ccclass('VolumeSlider')
export class VolumeSlider extends Component {
    @property({ type: Node, tooltip: 'Track：底槽（同时也是拖动热区，宽度是进度分母）' })
    track: Node = null;

    @property({ type: Node, tooltip: 'Fill：填充条（锚点 (0,1)，只改宽度）' })
    fill: Node = null;

    @property({ type: Node, tooltip: 'Grip：滑块（40×40，位置按 ratio 平移）' })
    grip: Node = null;

    /** 数值变化回调（拖动 / `setValue` 都会触发）。 */
    onChanged: ((value: number) => void) | null = null;

    /** 当前音量 0..100。 */
    private _value = 0;
    /** 设计期的滑块 x（`ratio = 1` 那一份），`onLoad` 里记一次。 */
    private _gripDesignX = 0;
    /** 底槽宽度。 */
    private _trackWidth = 0;
    /** 是否正在拖动（抬起前不重复触发 `onChanged` 的同值去重交给调用方）。 */
    private _dragging = false;

    // ============================================================
    // 生命周期
    // ============================================================

    protected onLoad(): void {
        if (!this.track || !this.fill || !this.grip) {
            console.error('[VolumeSlider] Track / Fill / Grip 三个引用缺一不可');
            return;
        }
        this._trackWidth = this.track.getComponent(UITransform)?.contentSize.width ?? 0;
        // ⚠️ 必须在 `onLoad` 记设计值 —— 首次 `setValue()` 之后 `grip.position.x` 就被改写了，
        //    再读就只是「上一次的值」，拖动会越拖越偏。
        this._gripDesignX = this.grip.position.x;

        this.track.on(Node.EventType.TOUCH_START, this.onTouch, this);
        this.track.on(Node.EventType.TOUCH_MOVE, this.onTouch, this);
        this.track.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.track.on(Node.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    }

    // ============================================================
    // 对外
    // ============================================================

    /** 当前音量。 */
    get value(): number {
        return this._value;
    }

    /**
     * 写值并铺界面。**无条件写**（规则 82）——同一实例会被开关按钮反向驱动，
     * 条件式赋值会让「开关关掉 → 滑块停在原处」。
     *
     * @param value 0..100（超范围截断、非数字按 0）
     * @param notify 是否触发 `onChanged`（`setValue` 由外部驱动时传 `false` 防止回环）
     */
    setValue(value: number, notify = false): void {
        const v = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
        this._value = v;
        this.layout(this._value);
        if (notify) this.onChanged?.(this._value);
    }

    // ============================================================
    // 内部
    // ============================================================

    /** 按 value 摆放 Fill / Grip。 */
    private layout(value: number): void {
        if (!this.fill || !this.grip) return;
        if (this._trackWidth <= 0) this._trackWidth = this.track?.getComponent(UITransform)?.contentSize.width ?? 0;
        if (this._trackWidth <= 0) return;

        const ratio = value / 100;
        const fillUi = this.fill.getComponent(UITransform);
        if (fillUi) {
            fillUi.setContentSize(this._trackWidth * ratio, fillUi.contentSize.height);
        }
        const y = this.grip.position.y;
        this.grip.setPosition(this._gripDesignX - this._trackWidth * (1 - ratio), y, 0);
    }

    /** 触摸 → 触点在底槽内的横向比例。 */
    private onTouch(event: EventTouch): void {
        if (!this.track || this._trackWidth <= 0) return;
        this._dragging = true;
        const ui = this.track.getComponent(UITransform);
        if (!ui) return;
        const p = event.getUILocation();
        ui.convertToNodeSpaceAR(_tmpLocal.set(p.x, p.y, 0));
        // 锚点 (0,1) ⇒ AR 原点 = 左上角 ⇒ `x ∈ [0, W]` 即 0..100。
        const ratio = Math.max(0, Math.min(1, _tmpLocal.x / this._trackWidth));
        this.setValue(Math.floor(ratio * 100), true);
    }

    private onTouchEnd(): void {
        this._dragging = false;
    }

    /** 是否正在被拖动（探针用来区分「点一下」与「拖过头」）。 */
    get isDragging(): boolean {
        return this._dragging;
    }
}
