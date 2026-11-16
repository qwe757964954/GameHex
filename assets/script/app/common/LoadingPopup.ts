/**
 * 通用全屏加载提示：遮罩 + 转圈 + 文字。
 * 引用计数 show +1 / hide -1，归 0 才关闭，多业务并发不会互相关掉。
 *
 * 用法：
 *   LoadingPopup.show('连接中…');
 *   try { await doSomething(); } finally { LoadingPopup.hide(); }
 */

import { _decorator, Label, Node } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { PopupCloseReason, PopupLayer } from '../../framework/ui/PopupDef';

const { ccclass, property } = _decorator;

@ccclass('LoadingPopup')
export class LoadingPopup extends PopupBase {
    static prefabPath = 'ui/common/LoadingPopup';

    private static refCount = 0;
    private static current: LoadingPopup | null = null;
    private static opening = false;
    private static pendingText: string | undefined = undefined;

    /** 显示 loading；重复调用只加计数。 */
    static show(text?: string): void {
        LoadingPopup.refCount += 1;
        if (text !== undefined) LoadingPopup.pendingText = text;

        const inst = LoadingPopup.current;
        if (inst && inst.isValid) {
            if (text !== undefined) inst.setText(text);
            return;
        }
        if (LoadingPopup.opening) return;

        LoadingPopup.opening = true;
        void LoadingPopup.open({ layer: PopupLayer.TOP, closeOnBlank: false })
            .then((popup) => {
                LoadingPopup.opening = false;
                if (!popup) {
                    LoadingPopup.refCount = 0;
                    LoadingPopup.pendingText = undefined;
                    return;
                }
                LoadingPopup.current = popup;
                if (LoadingPopup.pendingText !== undefined) {
                    popup.setText(LoadingPopup.pendingText);
                    LoadingPopup.pendingText = undefined;
                }
                // 异步打开期间可能已 hide 到 0，立即关闭，否则会卡在屏幕上。
                if (LoadingPopup.refCount <= 0) popup.close();
            })
            .catch(() => {
                LoadingPopup.opening = false;
                LoadingPopup.pendingText = undefined;
                LoadingPopup.refCount = 0;
            });
    }

    /** 隐藏；计数归 0 才关闭。 */
    static hide(): void {
        if (LoadingPopup.refCount > 0) LoadingPopup.refCount -= 1;
        if (LoadingPopup.refCount > 0) return;
        const inst = LoadingPopup.current;
        if (inst && inst.isValid) inst.close();
    }

    static forceHide(): void {
        LoadingPopup.refCount = 0;
        const inst = LoadingPopup.current;
        if (inst && inst.isValid) inst.close();
    }

    @property({ type: Node, group: 'Loading', tooltip: 'Spinner：转圈容器' })
    spinner: Node = null!;

    @property({ type: Label, group: 'Loading', tooltip: 'Label：提示文字' })
    label: Label = null!;

    @property({ group: 'Loading', tooltip: '旋转速度（度/秒）' })
    spinSpeed = 240;

    private rotating = false;

    protected onOpen(): void {
        this.rotating = true;
        LoadingPopup.current = this;
    }

    protected onClose(_reason: PopupCloseReason): void {
        this.rotating = false;
        if (LoadingPopup.current === this) LoadingPopup.current = null;
        LoadingPopup.refCount = 0;
        LoadingPopup.pendingText = undefined;
    }

    update(deltaTime: number): void {
        if (!this.rotating) return;
        const euler = this.spinner.eulerAngles;
        this.spinner.setRotationFromEuler(euler.x, euler.y, euler.z - this.spinSpeed * deltaTime);
    }

    setText(text: string): void {
        this.label.string = text;
    }
}
