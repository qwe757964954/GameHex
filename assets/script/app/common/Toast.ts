/**
 * Toast —— 轻量浮动提示（吐司）
 * ------------------------------------------------------------------
 * 由 PopupBase / PopupManager 调度：实例挂到场景常驻节点 `Popup` 下，天然盖在业务 UI 之上；
 * 层级用 `PopupLayer.TOP`（与加载圈 / 断线重连同级）。
 *
 * ==================================================================
 * 三条交互约定（改之前先读）
 * ==================================================================
 * 1. **不参与命中检测**：吐司是纯提示，绝不能挡住下层按钮，所以
 *    - `closeOnBlank` 固定 `false`（不接受「点空白关闭」）；
 *    - 根节点 UITransform 刻意只给 1×1 —— PopupBase 会把 TOUCH_* 监听挂在根节点上，
 *      而引擎只对「UITransform 矩形命中」的节点派发触摸；根节点不铺满屏幕，
 *      就**结构性地**保证了吐司永远抢不到点击（而不是靠「监听不吞事件」这条假设）。
 *    - `contentNodes` 刻意留空：PopupBase 会退化成「全部激活的直接子节点」，
 *      而空白关闭已关掉，这一项对吐司无影响。
 *
 * 2. **同类单实例 + 排队依次播放**：多条消息进静态队列，由唯一实例按 `duration` 逐条播放；
 *    队列放空后实例自行 `close()`，下一条消息到来时重新打开。
 *    （`PopupManager` 默认就是「同类单实例」，这里顺着它的语义走，不额外维护实例池。）
 *
 * 3. **被外部强制关闭时丢弃剩余队列**：切流程调 `PopupManager.closeAll()` 时，
 *    跨流程的旧提示已经没有意义，直接清空；只有「队列放空后的自关闭」不清队列。
 *
 * ==================================================================
 * 表现
 * ==================================================================
 * 底条用 `cc.Graphics` 画圆角矩形，**不依赖美术资源**：宽度 / 高度 / 圆角 / 颜色 / 内边距
 * 全部是 @property，可在 Inspector 上直接调。要换成美术图（9 宫格）时，
 * 把 `panelGraphics` 换成 `cc.Sprite` 并去掉 `_drawPanel()` 的调用即可，其余逻辑不用动。
 *
 * 样式口径（2026-10-23 起）：**与主界面底部聊天条（`ArenaRoot/BottomHud/ChatBar`）一致**。
 * 那一条是主 HUD 上唯一的"浮在黑底上的说明文字"，用户要求吐司跟它统一，取值都是量出来的：
 *
 * | 项 | 值 | 来源 |
 * | --- | --- | --- |
 * | 底条填充 | `rgba(0,0,0,153)`（60% 黑） | `image/main/hud/hud_chat_bar.png` 实测像素 |
 * | 圆角 | 12（聊天条 8 / 41 ≈ 0.2 × 高，56 高 → 11.2） | 按同比例换算 |
 * | 文字 | 微软雅黑 / 24 / 行高 31 / **粗** / 字距 0.24 / 白 **alpha 145** | `ChatBar/ChatMsg` 的 Label |
 *
 * ⚠️ 字色 alpha 是 **145 不是 255**：聊天条里的消息正文本来就是 57% 白（旁边的「世界」角标才是
 * 纯白），吐司跟着它走才对得上。要调亮就改 `fontColor.a`，别在 prefab 里零散改 —— 运行时会覆盖。
 *
 * 文字固定单行：`overflow = SHRINK`（超宽只缩字）+ `enableWrapText = false`（绝不折行），
 * 所以换成美术底图后文字也不会把底条撑变形。
 *
 * ==================================================================
 * 用法
 * ==================================================================
 *   Toast.show('神器充能未完成');        // 没实例就立刻播，有实例就排队
 *   Toast.showAll(['A', 'B', 'C']);      // 依次播放
 *   Toast.clear();                       // 丢弃还没播的
 *
 * framework 层不直接依赖本类，而是经 `FW.showTip` 间接使用；
 * 装配点在组合根 `app/bootstrap/ProcedureBootstrap.onLoad()`。
 */

import {
    _decorator,
    Color,
    director,
    Graphics,
    Label,
    Node,
    UITransform,
} from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { PopupCloseReason } from '../../framework/ui/PopupDef';

const { ccclass, property } = _decorator;

/** 队列上限：预制体一直加载失败时也不至于无限堆积。 */
const MAX_QUEUE = 32;

@ccclass('Toast')
export class Toast extends PopupBase {
    /** 预制体路径（PopupManager 据此加载）。 */
    static prefabPath = 'ui/common/Toast';

    // ============================================================
    // 静态：消息队列 + 唯一消费者
    // ============================================================

    /** 待播放文案（跨实例共享）。 */
    private static _queue: string[] = [];
    /** 正在消费队列的实例；非空时不再开新实例。 */
    private static _owner: Toast | null = null;

    /**
     * 显示一条提示：没有实例就立刻播，有实例就排队等它播完。
     *
     * 非字符串 / 空串会被静默忽略 —— `FW.G_W()` 目前是空实现（返回 undefined），
     * `FW.showTip(FW.G_W('Func_1'))` 这类调用很常见，这里必须挡住，不能弹一个空气泡。
     */
    static show(message: string): void {
        if (typeof message !== 'string') return;
        const text = message.trim();
        if (!text) return;
        Toast._queue.push(text);
        if (Toast._queue.length > MAX_QUEUE) Toast._queue.shift();
        Toast._schedule();
    }

    /** 批量显示，按数组顺序排队。 */
    static showAll(messages: readonly string[]): void {
        if (!messages) return;
        for (const message of messages) Toast.show(message);
    }

    /** 丢弃尚未播放的文案（不影响正在播放的那条）。 */
    static clear(): void {
        Toast._queue.length = 0;
    }

    /** 尚未播放的条数（调试 / 测试用）。 */
    static get pendingCount(): number {
        return Toast._queue.length;
    }

    /**
     * 没有实例在消费队列时把它拉起来。
     * 同一个 tick 里重复调用不会开出多个实例：`PopupManager.openAsync` 对同类默认合并，
     * 正在加载时返回同一次打开任务。
     */
    private static _schedule(): void {
        const owner = Toast._owner;
        if (owner && owner.isValid) return;

        if (!director.getScene()) {
            // 还没进场景（framework 在启动早期调 showTip）：丢弃即可，不是错误
            Toast._queue.length = 0;
            return;
        }

        void Toast.open()
            .then((instance) => {
                // 打不开（预制体缺失 / 场景里没有 Popup 节点）：丢弃队列，避免每次 showTip 都重试
                if (!instance) Toast._queue.length = 0;
            })
            .catch((error) => {
                console.error('[Toast] 打开失败', error);
                Toast._queue.length = 0;
            });
    }

    // ============================================================
    // Inspector 配置
    // ============================================================

    @property({ type: Node, group: '吐司', tooltip: 'Bar：底条 + 文字的容器（图形绘制的宿主）' })
    panel: Node = null!;

    @property({ type: Graphics, group: '吐司', tooltip: 'Bar 上的 cc.Graphics：按下面参数绘制深色圆角底条' })
    panelGraphics: Graphics = null!;

    @property({ type: Label, group: '吐司', tooltip: 'Bar/Label：提示文字' })
    label: Label = null!;

    @property({ group: '吐司', tooltip: '底条宽度（设计像素，固定宽；文字在其中居中）' })
    barWidth = 430;

    @property({ group: '吐司', tooltip: '底条高度（设计像素）。对齐聊天条比例：24 号字塞在 56 高里' })
    barHeight = 56;

    @property({ group: '吐司', tooltip: '圆角半径（会被自动收敛到 min(宽,高)/2 以内）' })
    cornerRadius = 12;

    @property({
        group: '吐司',
        tooltip: '底条填充色。默认 60% 黑（= 聊天条 hud_chat_bar.png 的实测像素 rgba(0,0,0,153)）',
    })
    barColor: Color = new Color(0, 0, 0, 153);

    @property({
        group: '吐司',
        tooltip: '左右内边距：文字可用宽度 = 底条宽 − 2×该值；超出只缩字不折行',
    })
    paddingX = 48;

    // ------------------------------------------------------------
    // 文字样式（对齐聊天条 `ChatBar/ChatMsg`，运行时由 `_applyTextStyle` 写进 Label）
    // ------------------------------------------------------------

    @property({ group: '吐司·文字', tooltip: '字号（聊天条消息正文同为 24）' })
    fontSize = 24;

    @property({ group: '吐司·文字', tooltip: '行高（聊天条同为 31，比字号松一点才好读）' })
    lineHeight = 31;

    @property({ group: '吐司·文字', tooltip: '字色：白 @ alpha 145（聊天条消息正文同款，不是纯白）' })
    fontColor: Color = new Color(255, 255, 255, 145);

    @property({ group: '吐司·文字', tooltip: '字距（聊天条同为 0.24）' })
    letterSpacing = 0.24;

    @property({ group: '吐司·文字', tooltip: '字体族（聊天条同为微软雅黑）' })
    fontFamily = 'Microsoft YaHei';

    @property({ group: '吐司', tooltip: '单条停留时长（秒）' })
    duration = 2;

    // ============================================================
    // 运行时状态
    // ============================================================

    /** 当前这条的剩余停留时间（秒）。 */
    private _remain = 0;
    /** 是否正在播放。 */
    private _playing = false;
    /** 本次关闭是否是「队列放空后自行收尾」。 */
    private _selfClosing = false;

    /** 当前正在播放的文案（未播放时为空串）；调试 / 测试用。 */
    get currentText(): string {
        return this.label ? this.label.string : '';
    }

    // ============================================================
    // PopupBase 生命周期
    // ============================================================

    /** 首次实例化时摆好底条与文字框，并绘制一次圆角底条。 */
    protected onInit(): void {
        this.closeOnBlank = false;
        this._applyLayout();
    }

    /** 每次打开：接管队列，开始播第一条。 */
    protected onOpen(): void {
        Toast._owner = this;
        this._playing = true;
        this._remain = 0;
        this._playNext();
    }

    /** 关闭收尾：释放所有权；非「自关闭」时丢弃剩余队列。 */
    protected onClose(_reason: PopupCloseReason): void {
        this._playing = false;
        this._remain = 0;
        if (Toast._owner === this) Toast._owner = null;
        if (!this._selfClosing) Toast._queue.length = 0;
        this._selfClosing = false;
    }

    /**
     * 停留计时。用组件自带的 update 驱动（不用 setTimeout）：
     * 弹窗被强制关闭时组件随之停摆，不会留下悬空回调。
     */
    update(deltaTime: number): void {
        if (!this._playing) return;
        this._remain -= deltaTime;
        if (this._remain > 0) return;
        this._playNext();
    }

    // ============================================================
    // 内部
    // ============================================================

    /** 取下一条播放；队列空了就自行关闭。 */
    private _playNext(): void {
        const next = Toast._queue.shift();
        if (next === undefined) {
            this._stop();
            return;
        }
        this.label.string = next;
        this._remain = Math.max(0.1, this.duration);
    }

    /** 队列放空后的收尾：标记为自关闭（保留队列语义）再走正常 close 流程。 */
    private _stop(): void {
        this._playing = false;
        this._selfClosing = true;
        this.close();
    }

    /**
     * 按 @property 摆正底条 / 文字框尺寸，并重绘圆角底条。
     *
     * 顺序有讲究（项目铁律）：Label 默认 `overflow = NONE`，会把「文本实测尺寸」回写进
     * UITransform，于是 `setContentSize` 看着设了却没生效。必须先切到 `SHRINK`
     * （超宽只缩字）+ 关掉自动折行，再设 contentSize。
     */
    private _applyLayout(): void {
        const width = Math.max(64, this.barWidth);
        const height = Math.max(24, this.barHeight);
        const paddingX = Math.max(0, this.paddingX);
        const radius = Math.min(Math.max(0, this.cornerRadius), Math.min(width, height) / 2);

        const barSize = this.panel.getComponent(UITransform);
        if (barSize) barSize.setContentSize(width, height);

        this.label.overflow = Label.Overflow.SHRINK;
        this.label.enableWrapText = false;
        this._applyTextStyle();

        const labelSize = this.label.node.getComponent(UITransform);
        if (labelSize) labelSize.setContentSize(Math.max(1, width - paddingX * 2), height);

        this._drawPanel(width, height, radius);
    }

    /**
     * 把文字样式写进 Label —— 与主 HUD 底部聊天条（`ChatBar/ChatMsg`）同一套口径。
     *
     * 为什么在代码里写、而不是只配 prefab：prefab 只决定"编辑器里长什么样"，
     * 运行时一旦有人改宽高/换字号，两处就会打架。这里让 **@property 是唯一真源**，
     * prefab 只是同一组值的副本（改口径只改这一处，单测也钉在这里）。
     */
    private _applyTextStyle(): void {
        const label = this.label;
        label.fontSize = Math.max(1, this.fontSize);
        label.lineHeight = Math.max(1, this.lineHeight);
        label.color = this.fontColor;
        // 聊天条的消息正文是**加粗**的（旁边「世界」角标反倒不加粗），跟着走。
        label.isBold = true;
        label.spacingX = this.letterSpacing;
        if (this.fontFamily) label.fontFamily = this.fontFamily;
    }

    /** 画深色圆角底条（local 坐标原点 = 节点锚点，故从 −w/2, −h/2 起画）。 */
    private _drawPanel(width: number, height: number, radius: number): void {
        const graphics = this.panelGraphics;
        graphics.clear();
        graphics.fillColor = this.barColor;
        graphics.roundRect(-width / 2, -height / 2, width, height, radius);
        graphics.fill();
    }
}
