/**
 * CommonTips —— 通用提示弹窗（挂在 CommonTips.prefab 根节点上）。
 *
 * 继承 PopupBase，由 PopupManager 统一调度：
 *   - 挂到场景常驻节点 `Popup` 下，天然盖在所有业务 UI 之上；
 *   - 参与深度排序（本页默认在 SYSTEM 层，压住普通业务弹窗）；
 *   - **点击内容区以外的空白处自动关闭**（基类实现）。
 *
 * 所有子节点引用通过 @property 装饰器在编辑器 Inspector 中拖拽绑定，
 * 不在运行时按节点名硬编码查找（与 LoginPage / ServerSelectPanel 保持一致）。
 *
 * 两种用法：
 *   1) 弹窗模式（推荐）：
 *      CommonTips.open({
 *          userData: { content: '...', onSure: () => {} },
 *          onClose: () => {},
 *      });
 *   2) 面板内嵌模式：把本组件挂在已实例化的节点上，调用
 *      `await tips.initStandalone({ content: '...' })`。
 */

import {
    _decorator,
    Button,
    Label,
    Node,
    Sprite,
} from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { PopupCloseReason } from '../../framework/ui/PopupDef';

const { ccclass, property } = _decorator;

/** CommonTips 的 userData 结构。 */
export interface CommonTipsOptions {
    /** 正文内容（必填） */
    content: string;
    /** 标题，默认「提示」 */
    title?: string;
    /** 确定按钮文案，默认「确定」 */
    sureText?: string;
    /** 取消按钮文案，默认「取消」 */
    cancelText?: string;
    /** 是否显示取消按钮，默认 true（单按钮确认框传 false） */
    showCancel?: boolean;
    /** 是否显示右上角关闭按钮，默认 true */
    showClose?: boolean;
    /** 点击“确定”后的回调（关闭动作在回调之后自动执行） */
    onSure?: () => void;
    /** 点击“取消”后的回调 */
    onCancel?: () => void;
}

/** 默认文案，与预制体序列化文本保持一致 */
const DEFAULT_TITLE = '提示';
const DEFAULT_SURE = '确定';
const DEFAULT_CANCEL = '取消';

/**
 * 通用提示弹窗。
 * 关闭后的回调（点确定 / 取消 / 关闭按钮 / 点空白均会触发一次）请用
 * `CommonTips.open({ userData, onClose: (reason) => {...} })` 传入。
 */
@ccclass('CommonTips')
export class CommonTips extends PopupBase {
    /** 预制体路径（PopupManager 据此加载）。 */
    static prefabPath = 'ui/common/CommonTips';

    // ===== 编辑器拖拽绑定（@property 装饰器）=====
    //
    // ⚠️ 三个按钮字段是 **`Node`** 而不是 `cc.Button` —— 与 `CommonTips.prefab` 里实际存的东西对齐。
    //
    // 2026-09-23 实测（邮件模块接二次确认时踩到）：prefab 里 `closeButton` / `sureButton` /
    // `cancelButton` 存的是**节点**（`42neiO0ldDwbh5udpI5H8I` / `3dEOD/XeJCLoDGcTdqvtXw` /
    // `50ECWIFMlI1K5wsAoL/R1J`，即 `btn_close` / `SureBtn` / `CancelBtn` 三个**节点**的 uuid），
    // 而字段当时声明成 `@property({type: Button})` ⇒ 运行时拿到的是 `cc.Node`。
    // 于是 `apply()` 里 `this.cancelButton.node.active` 直接抛 `TypeError`（Node 没有 `.node`），
    // 弹窗**显示出来但三个按钮一个都没绑上**（`bindButton` 压根没执行到）——
    // 症状是「提示框弹出来了，点确定没反应」，而且**不报错**（异常在 `onOpen` 里被弹窗框架吞掉）。
    // 编辑器侧同样能看出来：`component_query` 里这三个属性的 `type` 报的是
    // **`Unknown`**（不是 `cc.Button`），而 `panelBg` 那种正常的是 `cc.Sprite`。
    //
    // 修法：声明改成 `Node`（与 prefab 一致，inspector 不再有类型不符），绑定一律在**节点**上做
    // —— `cc.Button` 的 `click` 本来就是 `node.emit` 出来的，监听节点与监听组件等价。
    // 另加一条「节点上没有 `cc.Button` 就 warn」，防以后有人拖进一个没有 Button 的节点。
    //
    // （不改 prefab 把三个字段重拖成 Button 组件：全工程只有 `MailPage` 调 `CommonTips.open`，
    //   而这个 prefab 是别人的资产；声明跟着实际数据走、代码做归一化，改动面最小。）
    @property({ type: Sprite, tooltip: '弹窗主背景 bg_05' })
    panelBg: Sprite = null!;

    @property({ type: Sprite, tooltip: '标题栏底图 title_01' })
    titleBg: Sprite = null!;

    @property({ type: Sprite, tooltip: '标题装饰底图 title_02' })
    titleDeco: Sprite = null!;

    @property({ type: Label, tooltip: '标题文字 TipsLab' })
    titleLabel: Label = null!;

    @property({ type: Label, tooltip: '正文文字 ContentLab' })
    contentLabel: Label = null!;

    @property({ type: Node, tooltip: '右上角关闭按钮 btn_close（节点；`cc.Button` 挂在它身上）' })
    closeButton: Node = null!;

    @property({ type: Node, tooltip: '按钮容器 Layout' })
    buttonLayout: Node = null!;

    @property({ type: Node, tooltip: '确定按钮 SureBtn（节点；`cc.Button` 挂在它身上）' })
    sureButton: Node = null!;

    @property({ type: Label, tooltip: '确定按钮文字 SureLab' })
    sureLabel: Label = null!;

    @property({ type: Node, tooltip: '取消按钮 CancelBtn（节点；`cc.Button` 挂在它身上）' })
    cancelButton: Node = null!;

    @property({ type: Label, tooltip: '取消按钮文字 CancelLab' })
    cancelLabel: Label = null!;

    // ===== 运行时状态 =====
    private options: CommonTipsOptions | null = null;

    // ============================================================
    // PopupBase 生命周期
    // ============================================================

    /** 应用参数并绑定按钮事件；每次打开都会走这里。 */
    protected onOpen(userData?: CommonTipsOptions): void {
        this.apply(userData ?? { content: '' });
    }

    // ============================================================
    // 业务 API
    // ============================================================

    /** 兼容旧写法：内嵌模式下先把组件挂在节点上，再调用本方法初始化。 */
    async initialize(options: CommonTipsOptions): Promise<void> {
        await this.initStandalone(options);
    }

    /** 仅更新正文 + 标题（不重绑事件），用于复用同一弹窗刷新内容。 */
    setContent(content: string, title?: string): void {
        this.contentLabel.string = content ?? '';
        if (title !== undefined) this.titleLabel.string = title;
    }

    // ============================================================
    // 内部实现
    // ============================================================

    private apply(options: CommonTipsOptions): void {
        this.options = options;
        const showCancel = options.showCancel !== false;
        const showClose = options.showClose !== false;

        this.titleLabel.string = options.title ?? DEFAULT_TITLE;
        this.contentLabel.string = options.content ?? '';

        this.sureLabel.string = options.sureText ?? DEFAULT_SURE;
        this.cancelLabel.string = options.cancelText ?? DEFAULT_CANCEL;

        // 单按钮模式：隐藏取消按钮，Layout 自动重新排布确定按钮到居中
        // ⚠️ 这三个是**节点**（见上面的字段注释），别写成 `xxx.node.active`
        if (this.cancelButton) this.cancelButton.active = showCancel;
        if (this.closeButton) this.closeButton.active = showClose;

        this.bindButton(this.closeButton, showClose, this.onCloseClick);
        this.bindButton(this.sureButton, true, this.onSureClick);
        this.bindButton(this.cancelButton, showCancel, this.onCancelClick);
    }

    private onSureClick(): void {
        const onSure = this.options?.onSure;
        // 先回调业务，再关闭；业务里若同步打开了新界面也不受影响
        onSure?.();
        this.close(PopupCloseReason.CloseButton);
    }

    private onCancelClick(): void {
        const onCancel = this.options?.onCancel;
        onCancel?.();
        this.close(PopupCloseReason.CloseButton);
    }

    private onCloseClick(): void {
        this.closeByButton();
    }

    /**
     * 统一绑定：需要显示时才注册，注册前先解绑。
     *
     * ⚠️ 收的是**节点**（`@property` 那三个字段就是节点，见上面的字段注释）——
     *    `cc.Button` 的点击事件是 `node.emit('click')` 出来的，所以监听节点和监听组件等价。
     *    早期写的是 `button.node.off(...)`：字段其实是 Node ⇒ `.node` 是 `undefined` ⇒ 抛异常，
     *    三个按钮全部绑不上（点了没反应、且不报错）。
     */
    private bindButton(buttonNode: Node | null, enabled: boolean, handler: () => void): void {
        if (!buttonNode) return;
        if (!buttonNode.getComponent(Button)) {
            console.warn(`[CommonTips] ${buttonNode.name} 上没有 cc.Button，点击不会有反应（检查 prefab 绑定）`);
        }
        buttonNode.off(Button.EventType.CLICK, handler, this);
        if (enabled) buttonNode.on(Button.EventType.CLICK, handler, this);
    }

    protected onClose(_reason: PopupCloseReason): void {
        this.options = null;
    }
}
