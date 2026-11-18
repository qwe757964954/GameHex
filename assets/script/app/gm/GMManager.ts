import {
    _decorator,
    Component,
    EventKeyboard,
    Input,
    input,
    KeyCode,
    Node,
    sys,
} from 'cc';
import { PopupLayer } from '../../framework/ui/PopupDef';
import { PopupManager } from '../../framework/ui/PopupManager';
import { GMCommandTable } from './GMCommandTable';
import { GMPanel } from './GMPanel';
import { GMUtils } from './GMUtils';

const { ccclass, property } = _decorator;

/**
 * GM 常驻管理器（挂在各场景 Canvas 常驻节点上）。
 *
 * 对应 client 的 CtrlGM：
 * - 创建常驻 GM 入口按钮（Canvas 子节点，跨流程存活，所有界面都可见）；
 * - 注册快捷键（F1 开关 GM 面板，client 原为空格，Demo3.8 避免与玩法按键冲突改 F1）；
 * - 转发入口显隐指令（hideGMEntrance / showGMEntrance，本地持久化）；
 * - isGM 开关来自 GMUtils.isGM（对齐 client 的 ModelPublicData.getIsGM()）。
 */
@ccclass('GMManager')
export class GMManager extends Component {
    public static __cname: string = 'GMManager';

    private static _instance: GMManager | null = null;

    /** 全局访问点；场景里未挂载时返回 null（由调用方兜底）。 */
    static get inst(): GMManager | null {
        return GMManager._instance;
    }

    @property({ type: Node, tooltip: 'Canvas/GMButton：常驻 GM 入口（prefab 配好底图与文字）' })
    entrance: Node | null = null;

    private entranceHidden = false;

    /** 稳定引用的显隐回调，便于 onDestroy 时按引用清理。 */
    private _onToggleEntrance = (visible: boolean): void => {
        this.setEntranceVisible(visible);
    };

    // ============================================================
    // 生命周期
    // ============================================================

    onLoad(): void {
        if (GMManager._instance && GMManager._instance !== this) {
            console.warn('[GM] 场景内已存在 GMManager，忽略重复挂载');
            this.enabled = false;
            return;
        }
        GMManager._instance = this;

        GMCommandTable.init();
        GMCommandTable.onToggleEntrance = this._onToggleEntrance;

        if (!GMUtils.isGM) {
            if (this.entrance) this.entrance.active = false;
            return;
        }

        this.entranceHidden = sys.localStorage.getItem('gm_entrance_hidden') === '1';
        if (this.entrance) {
            this.entrance.on(Node.EventType.TOUCH_END, this.togglePanel, this);
            this.entrance.active = !this.entranceHidden;
        }
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    }

    onDestroy(): void {
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        if (GMCommandTable.onToggleEntrance === this._onToggleEntrance) {
            GMCommandTable.onToggleEntrance = null;
        }
        if (this.entrance && this.entrance.isValid) this.entrance.off(Node.EventType.TOUCH_END, this.togglePanel, this);
        if (GMManager._instance === this) {
            GMManager._instance = null;
        }
    }

    // ============================================================
    // 入口按钮
    // ============================================================

    /** 显示/隐藏入口按钮（本地持久化，对齐 client LayerGMEntrance.SetGMHide）。 */
    setEntranceVisible(visible: boolean): void {
        this.entranceHidden = !visible;
        sys.localStorage.setItem('gm_entrance_hidden', this.entranceHidden ? '1' : '0');
        if (this.entrance && this.entrance.isValid) {
            this.entrance.active = visible;
        }
    }

    // ============================================================
    // 面板开关
    // ============================================================

    openPanel(): void {
        void PopupManager.inst.openAsync(GMPanel, { layer: PopupLayer.SYSTEM, userData: {} });
    }

    togglePanel(): void {
        const panel = PopupManager.inst.get(GMPanel);
        if (panel) {
            panel.close();
            return;
        }
        this.openPanel();
    }

    /** 快捷键：F1 开关 GM 面板。 */
    private onKeyDown(event: EventKeyboard): void {
        if (event.keyCode !== KeyCode.F1) return;
        this.togglePanel();
    }
}
