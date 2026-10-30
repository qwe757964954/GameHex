import {
    _decorator,
    Color,
    Component,
    EventKeyboard,
    Input,
    input,
    KeyCode,
    Label,
    Layers,
    Node,
    resources,
    Sprite,
    SpriteFrame,
    sys,
    UITransform,
    Widget,
} from 'cc';
import { PopupLayer } from '../../framework/ui/PopupDef';
import { PopupManager } from '../../framework/ui/PopupManager';
import { GMCommandTable } from './GMCommandTable';
import { GMPanel } from './GMPanel';
import { GMUtils } from './GMUtils';

const { ccclass } = _decorator;

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

    /** 入口按钮节点（代码创建，挂在 Canvas 下）。 */
    private entrance: Node | null = null;
    private entranceHidden = false;

    /**
     * GMButton 底图自己持有的那份引用（见 `createEntrance` 里的 `addRef`）。
     * `onDestroy` 时必须归还，否则这张图会被 GMButton 永久拽住。
     */
    private entranceFrame: SpriteFrame | null = null;

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
            console.log('[GM] GMUtils.isGM=false，不创建 GM 入口');
            return;
        }

        this.entranceHidden = sys.localStorage.getItem('gm_entrance_hidden') === '1';
        this.createEntrance();
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    }

    onDestroy(): void {
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        if (GMCommandTable.onToggleEntrance === this._onToggleEntrance) {
            GMCommandTable.onToggleEntrance = null;
        }
        this.entrance = null;
        // 归还 GMButton 底图的那份自持引用（与 `createEntrance` 里的 addRef 配对）。
        this.entranceFrame?.decRef();
        this.entranceFrame = null;
        if (GMManager._instance === this) {
            GMManager._instance = null;
        }
    }

    // ============================================================
    // 入口按钮
    // ============================================================

    private createEntrance(): void {
        const parent = this.node;
        if (!parent || !parent.isValid) return;

        // 入口按钮尺寸（要改大小只动这两个数，底图与文字一起跟着走）
        const BUTTON_W = 52;
        const BUTTON_H = 33;
        // 字号按高度等比缩：原 104×44 配 24/28 → 33/44 ≈ 0.75 → 18/21
        const FONT_SIZE = 18;
        const LINE_HEIGHT = 21;

        const button = new Node('GMButton');
        button.layer = Layers.Enum.UI_2D as unknown as number;
        parent.addChild(button);
        this.entrance = button;

        // 尺寸口径：52×33（原 104×44）。GM 只是调试入口，占位收小，别挡 UI。
        const transform = button.addComponent(UITransform);
        transform.setContentSize(BUTTON_W, BUTTON_H);

        // 右上角常驻
        const widget = button.addComponent(Widget);
        widget.isAlignTop = true;
        widget.isAlignRight = true;
        widget.top = 10;
        widget.right = 10;
        widget.alignMode = Widget.AlignMode.ALWAYS;
        widget.updateAlignment();

        // 按钮底图（异步加载，失败时仍可点击：UITransform 命中即可）
        const sprite = button.addComponent(Sprite);
        sprite.type = Sprite.Type.SLICED;
        //  **必须显式 CUSTOM**，否则上面那句 setContentSize 是死代码：
        //    `Sprite._sizeMode` 默认是 `TRIMMED`（引擎 sprite.ts: `protected _sizeMode = SizeMode.TRIMMED`），
        //    而 `spriteFrame` 的 setter 会调 `_applySpriteFrame() -> _applySpriteSize()`，
        //    TRIMMED 分支执行 `setContentSize(frame.rect.width, frame.rect.height)`
        //    —— 直接把节点尺寸改成底图的原始尺寸。`anniu_01` 是 201×72，
        //    于是这个按钮**一直**渲染成 201×72（旧代码里写的 104×44 从来没生效过），
        //    这也是「GM 按钮太大」的真正原因。设成 CUSTOM 后节点尺寸才归我们管。
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        resources.load('image/common/anniu_01/spriteFrame', SpriteFrame, (error, frame) => {
            if (error || !frame || !button.isValid) return;

            //  **必须自己持引用**，否则 GM 按钮会从「登录页被销毁」那一刻起每帧报错：
            //   TypeError: Cannot read properties of null (reading 'getGFXTexture')
            //     at SpriteFrame.getGFXTexture
            //     at Batcher2D.commitComp ← Sprite._render
            //   （同时引擎打一条 `frame should not be invalid, it may have been released`）
            //
            // 原因：`anniu_01` 还被 `LoginRoot` / `CommonTips` / `GameRunAway` / `LineupBoard`
            // 这几个 prefab 静态引用，它活着**只是因为那些 prefab 在内存里** ——
            // 静态引用的资源由 prefab 的依赖表替它 addRef，而 `resources.load` 拿到的
            // 资源不归调用方所有。登录成功切流程、`LoginRoot` 被销毁后，这张 SpriteFrame
            // 的 refCount 归 0，引擎连它的 `_texture` 一起释放；GMButton 是**跨流程常驻**
            // 节点，仍指着这个空壳 → 渲染时 `getGFXTexture()` 内部读到 `_texture === null` 就崩，
            // 而且崩在渲染管线里，每帧一条，刷满控制台。
            frame.addRef();
            sprite.spriteFrame = frame;
            // 记下来，等本组件所在节点销毁时归还（GMButton 是它的子节点，同生共死）。
            // 不用 `Node.EventType.NODE_DESTROYED`：那个常量在当前引擎声明里取不到，
            // 走 `onDestroy` 一样精确，还少一次编译期风险。
            this.entranceFrame = frame;
        });

        // 文字
        const labelNode = new Node('GMLabel');
        labelNode.layer = button.layer;
        button.addChild(labelNode);
        const labelTransform = labelNode.addComponent(UITransform);
        const label = labelNode.addComponent(Label);
        //  顺序要紧：`overflow` 默认是 NONE，该分支会把「按文本量出来的尺寸」写回
        //    `contentSize`，于是后设的 setContentSize 被**无声覆盖**，文字被压成小字换行
        //    （技能 §20.7 坑 2）。先关换行 → 再设 SHRINK → 之后设 string 就不会再改尺寸。
        label.enableWrapText = false;
        label.overflow = Label.Overflow.SHRINK;
        label.fontSize = FONT_SIZE;
        label.lineHeight = LINE_HEIGHT;
        label.isBold = true;
        label.color = new Color(255, 255, 255, 255);
        labelTransform.setContentSize(BUTTON_W, BUTTON_H);
        label.string = 'GM';
        labelNode.setPosition(0, 0, 0);

        button.on(Node.EventType.TOUCH_END, this.togglePanel, this);

        button.active = !this.entranceHidden;
    }

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
        const mgr = PopupManager.inst;
        void mgr.openAsync(GMPanel, { layer: PopupLayer.SYSTEM, userData: {} });
    }

    togglePanel(): void {
        const mgr = PopupManager.inst;
        const panel = mgr.get(GMPanel);
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
