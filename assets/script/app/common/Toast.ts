/**
 * 轻量浮动提示（吐司）。由 PopupBase / PopupManager 调度：实例挂在场景常驻 `Popup` 节点下，
 * 层级 TOP，与加载圈 / 断线重连同级。
 *
 * 三条交互约定：
 * 1. 不参与命中检测：`closeOnBlank` 固定 false；根节点 UITransform 只给 1×1 ——
 *    引擎只对 UITransform 矩形命中的节点派发触摸，所以吐司结构性抢不到点击。
 * 2. 同类单实例 + 排队：多条消息进静态队列，由唯一实例按 `duration` 逐条播；放空后自关闭。
 * 3. 被外部强制关闭（切流程 `closeAll`）时丢弃剩余队列；只有队列放空后的自关闭保留队列。
 *
 * 底条用 `cc.Graphics` 画圆角矩形，不依赖美术资源；样式与主界面底部聊天条对齐：
 * 60% 黑底、微软雅黑 24 / 行高 31 / 加粗 / 字距 0.24 / 白 alpha 145。
 * 字色 alpha 是 145 不是 255（聊天条正文就是 57% 白），运行时由 `applyTextStyle` 覆盖 prefab，
 * 改口径只改 @property。文字固定单行：`SHRINK` + 关自动折行，换美术底图也不会被撑变形。
 *
 * 用法：
 *   Toast.show('神器充能未完成');   // 没实例就立刻播，有实例就排队
 *   Toast.showAll(['A', 'B', 'C']);
 *   Toast.clear();                  // 丢弃还没播的
 * framework 经 `FW.showTip` 间接使用，装配点在组合根 `ProcedureBootstrap`。
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
    static prefabPath = 'ui/common/Toast';

    /** 待播放文案（跨实例共享）。 */
    private static queue: string[] = [];
    /** 正在消费队列的实例；非空时不再开新实例。 */
    private static owner: Toast | null = null;

    /**
     * 显示一条提示：没有实例就立刻播，有实例就排队。
     *
     * 非字符串 / 空串静默忽略 —— `FW.G_W()` 目前是空实现（返回 undefined），
     * `FW.showTip(FW.G_W('Func_1'))` 这类调用很常见，不能弹一个空气泡。
     */
    static show(message: string): void {
        if (typeof message !== 'string') return;
        const text = message.trim();
        if (!text) return;
        Toast.queue.push(text);
        if (Toast.queue.length > MAX_QUEUE) Toast.queue.shift();
        Toast.schedule();
    }

    /** 批量显示，按数组顺序排队。 */
    static showAll(messages: readonly string[]): void {
        if (!messages) return;
        for (const message of messages) Toast.show(message);
    }

    /** 丢弃尚未播放的文案（不影响正在播放的那条）。 */
    static clear(): void {
        Toast.queue.length = 0;
    }

    /** 尚未播放的条数（调试 / 测试用）。 */
    static get pendingCount(): number {
        return Toast.queue.length;
    }

    /**
     * 没有实例在消费队列时把它拉起来。
     * 同一 tick 里重复调用不会开出多个实例：`PopupManager.openAsync` 对同类默认合并。
     */
    private static schedule(): void {
        const current = Toast.owner;
        if (current && current.isValid) return;

        if (!director.getScene()) {
            // 还没进场景（启动早期调 showTip）：丢弃即可，不是错误
            Toast.queue.length = 0;
            return;
        }

        void Toast.open()
            .then((instance) => {
                // 打不开（预制体缺失 / 场景里没有 Popup 节点）：丢弃队列，避免每次 showTip 都重试
                if (!instance) Toast.queue.length = 0;
            })
            .catch((error) => {
                console.error('[Toast] 打开失败', error);
                Toast.queue.length = 0;
            });
    }

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

    /** 当前这条的剩余停留时间（秒）。 */
    private remain = 0;
    /** 是否正在播放。 */
    private playing = false;
    /** 本次关闭是否是「队列放空后自行收尾」。 */
    private selfClosing = false;

    /** 当前正在播放的文案（未播放时为空串）；调试 / 测试用。 */
    get currentText(): string {
        return this.label.string;
    }

    /** 首次实例化时摆好底条与文字框，并绘制一次圆角底条。 */
    protected onInit(): void {
        this.closeOnBlank = false;
        this.applyLayout();
    }

    /** 每次打开：接管队列，开始播第一条。 */
    protected onOpen(): void {
        Toast.owner = this;
        this.playing = true;
        this.remain = 0;
        this.playNext();
    }

    /** 关闭收尾：释放所有权；非自关闭时丢弃剩余队列。 */
    protected onClose(_reason: PopupCloseReason): void {
        this.playing = false;
        this.remain = 0;
        if (Toast.owner === this) Toast.owner = null;
        if (!this.selfClosing) Toast.queue.length = 0;
        this.selfClosing = false;
    }

    /**
     * 停留计时。用组件自带的 update 驱动（不用 setTimeout）：
     * 弹窗被强制关闭时组件随之停摆，不会留下悬空回调。
     */
    update(deltaTime: number): void {
        if (!this.playing) return;
        this.remain -= deltaTime;
        if (this.remain > 0) return;
        this.playNext();
    }

    /** 取下一条播放；队列空了就自行关闭。 */
    private playNext(): void {
        const next = Toast.queue.shift();
        if (next === undefined) {
            this.stop();
            return;
        }
        this.label.string = next;
        this.remain = Math.max(0.1, this.duration);
    }

    /** 队列放空后的收尾：标记为自关闭（保留队列语义）再走正常 close 流程。 */
    private stop(): void {
        this.playing = false;
        this.selfClosing = true;
        this.close();
    }

    /**
     * 按 @property 摆正底条 / 文字框，并重绘圆角底条。
     *
     * 顺序有讲究：Label 默认 `overflow = NONE`，会把文本实测尺寸回写 UITransform，
     * 先 `setContentSize` 会被覆盖。必须先切 `SHRINK` 并关自动折行，再设尺寸。
     */
    private applyLayout(): void {
        const width = Math.max(64, this.barWidth);
        const height = Math.max(24, this.barHeight);
        const paddingX = Math.max(0, this.paddingX);
        const radius = Math.min(Math.max(0, this.cornerRadius), Math.min(width, height) / 2);

        this.panel.getComponent(UITransform).setContentSize(width, height);

        this.label.overflow = Label.Overflow.SHRINK;
        this.label.enableWrapText = false;
        this.applyTextStyle();

        this.label.node.getComponent(UITransform).setContentSize(Math.max(1, width - paddingX * 2), height);

        this.drawPanel(width, height, radius);
    }

    /**
     * 把文字样式写进 Label，与主 HUD 底部聊天条同一套口径。
     * @property 是唯一真源，prefab 只是同一组值的副本，避免两处打架。
     */
    private applyTextStyle(): void {
        const label = this.label;
        label.fontSize = Math.max(1, this.fontSize);
        label.lineHeight = Math.max(1, this.lineHeight);
        label.color = this.fontColor;
        label.isBold = true;
        label.spacingX = this.letterSpacing;
        if (this.fontFamily) label.fontFamily = this.fontFamily;
    }

    /** 画深色圆角底条（local 坐标原点 = 节点锚点，故从 −w/2, −h/2 起画）。 */
    private drawPanel(width: number, height: number, radius: number): void {
        const graphics = this.panelGraphics;
        graphics.clear();
        graphics.fillColor = this.barColor;
        graphics.roundRect(-width / 2, -height / 2, width, height, radius);
        graphics.fill();
    }
}
