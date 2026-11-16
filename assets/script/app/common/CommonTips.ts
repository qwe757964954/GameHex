/**
 * 通用提示弹窗（`CommonTips.prefab` 根节点），由 PopupManager 调度：
 * 挂到场景常驻 `Popup` 节点下、参与深度排序、点内容区以外的空白自动关闭。
 *
 * 用法：
 *   CommonTips.open({ userData: { content: '...', onSure: () => {} }, onClose: () => {} });
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
export interface ICommonTipsOptions {
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
    /**
     * 「点两次才算确认」：第一次点确定不关闭，只把确定按钮文案换成这个值，
     * 第二次点才走 `onSure` + 关闭。缺省 = 一次即确认。
     * 用于「提前退出对局」这类不可逆操作；是两次点击，不是叠两个弹窗。
     */
    confirmAgainText?: string;
    /** 点击「确定」后的回调（关闭动作在回调之后自动执行） */
    onSure?: () => void;
    /** 点击「取消」后的回调 */
    onCancel?: () => void;
}

/** 默认文案，与预制体序列化文本保持一致 */
const DEFAULT_TITLE = '提示';
const DEFAULT_SURE = '确定';
const DEFAULT_CANCEL = '取消';

@ccclass('CommonTips')
export class CommonTips extends PopupBase {
    static prefabPath = 'ui/common/CommonTips';

    /*
     * 三个按钮字段是 Node，不是 cc.Button —— 与 prefab 里实际存的节点对齐。
     * 早期按 Button 声明，运行时拿到的是 Node，`this.cancelButton.node` 直接抛 TypeError，
     * 三个按钮都绑不上且不报错。cc.Button 的 click 本来就是 node.emit 出来的，
     * 所以监听节点与监听组件等价。
     */
    @property({ type: Node, tooltip: '右上角关闭按钮 btn_close（节点；`cc.Button` 挂在它身上）' })
    closeButton: Node = null!;

    @property({ type: Node, tooltip: '确定按钮 SureBtn（节点；`cc.Button` 挂在它身上）' })
    sureButton: Node = null!;

    @property({ type: Node, tooltip: '取消按钮 CancelBtn（节点；`cc.Button` 挂在它身上）' })
    cancelButton: Node = null!;

    @property({ type: Node, tooltip: '按钮容器 Layout（取消按钮隐藏时自动重排）' })
    buttonLayout: Node = null!;

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

    @property({ type: Label, tooltip: '确定按钮文字 SureLab' })
    sureLabel: Label = null!;

    @property({ type: Label, tooltip: '取消按钮文字 CancelLab' })
    cancelLabel: Label = null!;

    private options: ICommonTipsOptions | null = null;
    /** 「两次确认」是否已上膛：第一次点确定后为 true，第二次点才真的确认。 */
    private armed = false;

    /** 应用参数并绑定按钮事件；每次打开都会走这里。 */
    protected onOpen(userData?: ICommonTipsOptions): void {
        this.apply(userData ?? { content: '' });
    }

    private apply(options: ICommonTipsOptions): void {
        this.options = options;
        this.armed = false;
        const showCancel = options.showCancel !== false;
        const showClose = options.showClose !== false;

        this.titleLabel.string = options.title ?? DEFAULT_TITLE;
        this.contentLabel.string = options.content ?? '';

        this.sureLabel.string = options.sureText ?? DEFAULT_SURE;
        this.cancelLabel.string = options.cancelText ?? DEFAULT_CANCEL;

        // 单按钮模式：隐藏取消按钮，Layout 自动把确定按钮排到居中。
        this.cancelButton.active = showCancel;
        this.closeButton.active = showClose;

        this.bindButton(this.closeButton, showClose, this.onCloseClick);
        this.bindButton(this.sureButton, true, this.onSureClick);
        this.bindButton(this.cancelButton, showCancel, this.onCancelClick);
    }

    private onSureClick(): void {
        const options = this.options;
        // 两次确认：第一下只「上膛」，按钮文案换掉、窗口留着；第二下才回调 + 关闭。
        if (options?.confirmAgainText && !this.armed) {
            this.armed = true;
            this.sureLabel.string = options.confirmAgainText;
            return;
        }
        if (options?.onSure) options.onSure();
        this.close(PopupCloseReason.CloseButton);
    }

    private onCancelClick(): void {
        if (this.options?.onCancel) this.options.onCancel();
        this.close(PopupCloseReason.CloseButton);
    }

    private onCloseClick(): void {
        this.closeByButton();
    }

    /** 统一绑定：需要显示时才注册，注册前先解绑，避免重复打开叠监听。 */
    private bindButton(buttonNode: Node, enabled: boolean, handler: () => void): void {
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
