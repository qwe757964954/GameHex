import { _decorator, Button, EditBox, Label, Node } from 'cc';
import { PopupBase, PopupOpenContext } from '../../framework/ui/PopupBase';
import { PopupCloseReason } from '../../framework/ui/PopupDef';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { GameNet } from '../net/GameNet';
import { GMCommandDef, GMCommandTable } from './GMCommandTable';

const { ccclass, property } = _decorator;

/**
 * 行模板（`Panel/ListView/content/Row`）里两个 Label 的节点名。
 * 行节点由 `VirtualScrollView` 克隆模板并复用，本组件只在 `renderItemFn` 里填字。
 */
const ROW_CMD = 'Cmd';
const ROW_DESC = 'Desc';

/**
 * GM 调试面板。
 *
 * 对应 client 的 LayerGMMain（指令页签）+ TabGMCommand + TabGMClient：
 * - 命令输入框 + 执行按钮；
 * - 可滚动指令列表（点击回填输入框），本地指令与服务器 GM 指令合并展示；
 * - 状态栏展示提示与服务器连接状态；
 * - 服务器 GM 指令（addItem 等）走 RequestSystemGm 原样发送。
 *
 * 界面结构（Bg / Panel / 标题 / 关闭按钮 / 输入框 / 执行按钮 / 列表 / 状态栏）
 * **全部在 `ui/gm/GMPanel.prefab` 里**，本类只做三件事：
 *   ① 在 `onInit` 里绑按钮与输入框事件、声明内容区、接上虚拟列表的两个回调；
 *   ② 在 `onOpen` 里填文案，并把指令条数喂给虚拟列表；
 *   ③ 服务器指令列表回来后再喂一次。
 *
 * 列表是**虚拟列表**（`VirtualScrollView`，视窗 + content + 行模板都在本 prefab 内联）：
 * 槽位节点只有「视窗能放下的行数 + buffer + 2」个，靠 `renderItemFn` 反复复用，
 * 所以指令表再长也只渲染十几个节点。**行模板必须留在 `content` 的第一个子节点**，
 * `VirtualScrollView.start()` 会把它摘下来当克隆源。
 *
 *  图片资源都是 prefab 的**静态引用**（不再是 `resources.load`），
 * 依赖表会替它持引用，面板销毁时不会出现「纹理被释放但节点还指着它」的每帧崩溃。
 */
@ccclass('GMPanel')
export class GMPanel extends PopupBase {
    public static __cname: string = 'GMPanel';

    static prefabPath = 'ui/gm/GMPanel';

    // ============================================================
    // Inspector 配置（结构与样式全在 prefab 上）
    // ============================================================

    @property({ type: Node, tooltip: 'Panel：面板主体（620×860），同时充当「点击空白关闭」的内容区' })
    panel: Node = null;

    @property({ type: Node, tooltip: 'Panel/BtnClose：右上角关闭按钮（挂 cc.Button）' })
    closeButton: Node = null;

    @property({ type: EditBox, tooltip: 'Panel/Input：GM 指令输入框' })
    cmdInput: EditBox = null;

    @property({ type: Node, tooltip: 'Panel/BtnExecute：执行按钮（挂 cc.Button）' })
    executeButton: Node = null;

    @property({ type: VirtualScrollView, tooltip: 'Panel/ListView：指令列表虚拟视窗（挂 VirtualScrollView + Mask）' })
    listView: VirtualScrollView = null;

    @property({ type: Label, tooltip: 'Panel/StatusLabel：底部状态栏（提示语 / 服务器连接状态）' })
    statusLabel: Label = null;

    // ============================================================
    // 运行时状态
    // ============================================================

    /** 当前展示的指令（虚拟列表按 index 从这里取，不复制进节点）。 */
    private _defs: GMCommandDef[] = [];

    /** 稳定引用的提示回调，便于 onClose 时按引用清理。 */
    private readonly _onTip = (message: string): void => this._setStatus(message);

    // ============================================================
    // 弹窗生命周期
    // ============================================================

    protected onInit(): void {
        // 内容区只认面板本体：Bg 是铺满全屏的压暗遮罩，若它也算内容区，空白点击将永远关不掉面板。
        this.contentNodes = [this.panel];

        //  CLICK 是挂在**节点**上的（Button 自身没有 on），别写成 button.on(...)。
        const close = this.closeButton.getComponent(Button);
        if (close) close.node.on(Button.EventType.CLICK, this.onCloseClick, this);

        const execute = this.executeButton.getComponent(Button);
        if (execute) execute.node.on(Button.EventType.CLICK, this.onExecuteClick, this);

        // 输入框回车 = 执行（事件名是 Node 上的字符串事件，不走 Button）
        this.cmdInput.node.on('editing-return', this.onInputReturn, this);

        //  两个回调只在初始化时接一次：槽位节点会被反复复用，不能在回调里再挂事件，
        // 否则每次滚动都会叠一层监听。
        this.listView.renderItemFn = this._renderRow;
        this.listView.onItemClickFn = this._onRowClick;
    }

    protected async onOpen(_userData?: any, _context?: PopupOpenContext): Promise<void> {
        this.cmdInput.string = GMCommandTable.lastInput;
        GMCommandTable.onTip = this._onTip;

        this._defs = GMCommandTable.getCommandList();
        this._pushList();

        this._setStatus(
            `GM v1.0 · 服务器:${GameNet.instance.isConnected ? '已连接' : '未连接'} · F1 开关面板`,
        );

        // 已连接时向服务器拉取 GM 指令列表（失败静默，仅本地列表可用）
        GMCommandTable.requestServerList((list) => {
            if (!this.isValid || !this.node.isValid) return;
            this._defs = list;
            this._pushList();
        });
    }

    protected onClose(_reason: PopupCloseReason): void {
        if (GMCommandTable.onTip === this._onTip) {
            GMCommandTable.onTip = null;
        }
        this._defs = [];
    }

    // ============================================================
    // 按钮 / 输入框
    // ============================================================

    private onCloseClick(): void {
        this.close(PopupCloseReason.CloseButton);
    }

    private onExecuteClick(): void {
        void this._execute();
    }

    private onInputReturn(): void {
        void this._execute();
    }

    // ============================================================
    // 指令列表（虚拟列表：只喂条数，行内容由 renderItemFn 现填）
    // ============================================================

    /**
     * 把当前指令条数交给虚拟列表。
     *
     *  `VirtualScrollView` 的槽位是在它自己的 `start()` 里建的，而 `onOpen` **早于**
     * `start()`；不等一帧就 `setTotalCount`，槽位数组还是空的，列表会一片空白。
     * 统一走 `PopupBase.nextPopupFrame()`：关闭期间返回 false，不留悬空 Promise。
     */
    private async _pushList(): Promise<void> {
        const list = this.listView;
        if (!list || !list.node.isValid) return;
        if (!await this.nextPopupFrame()) return;
        if (!this.isValid || !this.node.isValid || !list.node.isValid) return;

        list.setTotalCount(this._defs.length);
        // 条数变化后可能停在越界位置；回到顶部（不播动画）。
        list.scrollToTop(false);
    }

    /**
     * 把一个指令灌进行节点（新建或回收来的）。
     *
     *  必须是**同步**的：滚动中随时会被调用，里面不能 `await`。
     * 行节点是复用的，所以每次都要把两个 Label 都重写一遍，不能只写有值的那个。
     */
    private readonly _renderRow = (node: Node, index: number): void => {
        const def = this._defs[index];
        const cmd = node.getChildByName(ROW_CMD)?.getComponent(Label);
        const desc = node.getChildByName(ROW_DESC)?.getComponent(Label);
        if (cmd) cmd.string = def ? def.gm : '';
        if (desc) desc.string = def ? def.desc : '';
    };

    /** 点行回填输入框（不直接执行，避免误触）。 */
    private readonly _onRowClick = (_node: Node, index: number): void => {
        const def = this._defs[index];
        if (!def) return;
        this.cmdInput.string = def.gm;
    };

    // ============================================================
    // 交互
    // ============================================================

    private _setStatus(message: string): void {
        this.statusLabel.string = message ?? '';
    }

    private async _execute(): Promise<void> {
        const trimmed = this.cmdInput.string.trim();
        if (!trimmed) {
            this._setStatus('请输入要执行的 GM 指令');
            return;
        }
        this._setStatus(`执行:${trimmed}`);
        await GMCommandTable.execute(trimmed);
    }
}
