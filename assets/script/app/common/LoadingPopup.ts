/**
 * 通用全屏加载提示：遮罩 + 转圈 + 文字。
 * 引用计数：show +1 / hide -1，归 0 才关闭，多业务并发不打架。
 *
 * @example
 * LoadingPopup.show('连接中…');
 * try { await doSomething(); } finally { LoadingPopup.hide(); }
 */

import { _decorator, Label, Node } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { PopupCloseReason, PopupLayer } from '../../framework/ui/PopupDef';

const { ccclass, property } = _decorator;

@ccclass('LoadingPopup')
export class LoadingPopup extends PopupBase {
    static prefabPath = 'ui/common/LoadingPopup';

    private static _refCount = 0;
    private static _instance: LoadingPopup | null = null;
    private static _opening = false;
    private static _pendingText: string | undefined = undefined;

    /** 显示 loading；重复调用只加计数。 */
    static show(text?: string): void {
        LoadingPopup._refCount += 1;
        if (text !== undefined) LoadingPopup._pendingText = text;

        const inst = LoadingPopup._instance;
        if (inst && inst.isValid) {
            if (text !== undefined) inst.setText(text);
            return;
        }
        if (LoadingPopup._opening) return;

        LoadingPopup._opening = true;
        void LoadingPopup.open({ layer: PopupLayer.TOP, closeOnBlank: false })
            .then((popup) => {
                LoadingPopup._opening = false;
                if (!popup) {
                    LoadingPopup._refCount = 0;
                    LoadingPopup._pendingText = undefined;
                    return;
                }
                LoadingPopup._instance = popup;
                if (LoadingPopup._pendingText !== undefined) {
                    popup.setText(LoadingPopup._pendingText);
                    LoadingPopup._pendingText = undefined;
                }
                // 异步打开期间可能已 hide 到 0，立即关闭，否则卡在屏幕上。
                if (LoadingPopup._refCount <= 0) popup.close();
            })
            .catch(() => {
                LoadingPopup._opening = false;
                LoadingPopup._pendingText = undefined;
                LoadingPopup._refCount = 0;
            });
    }

    /** 隐藏；计数归 0 才关闭。 */
    static hide(): void {
        if (LoadingPopup._refCount > 0) LoadingPopup._refCount -= 1;
        if (LoadingPopup._refCount > 0) return;
        const inst = LoadingPopup._instance;
        if (inst && inst.isValid) inst.close();
    }

    static forceHide(): void {
        LoadingPopup._refCount = 0;
        const inst = LoadingPopup._instance;
        if (inst && inst.isValid) inst.close();
    }

    @property({ type: Node, group: 'Loading', tooltip: 'Spinner：转圈容器' })
    spinner: Node = null!;

    @property({ type: Label, group: 'Loading', tooltip: 'Label：提示文字' })
    label: Label = null!;

    @property({ group: 'Loading', tooltip: '旋转速度（度/秒）' })
    spinSpeed = 240;

    private _rotating = false;

    protected onOpen(): void {
        this._rotating = true;
        LoadingPopup._instance = this;
    }

    protected onClose(_reason: PopupCloseReason): void {
        this._rotating = false;
        if (LoadingPopup._instance === this) LoadingPopup._instance = null;
        LoadingPopup._refCount = 0;
        LoadingPopup._pendingText = undefined;
    }

    update(deltaTime: number): void {
        if (!this._rotating) return;
        const euler = this.spinner.eulerAngles;
        this.spinner.setRotationFromEuler(euler.x, euler.y, euler.z - this.spinSpeed * deltaTime);
    }

    setText(text: string): void {
        this.label.string = text;
    }
}
