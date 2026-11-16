/**
 * 「聊天 · 私聊」左侧的联系人头像项（117×146）—— 频道 3 专用。
 *
 * 节点结构（对齐 FGUI `组件_聊天_私聊头像`）：
 *
 * ```
 * ChatPrivateHead
 * ├─ Bg        Sprite   fd_row_bg（九宫格）
 * ├─ Head      Node     scale 0.7
 * │   ├─ Frame Sprite   img_Touxiang_01
 * │   └─ Icon  Sprite   运行时按 img 加载
 * ├─ Name      Label
 * └─ RemoveBtn Button   右上角「删除」（ct_close_02，scale 0.5）
 * ```
 *
 * 两处刻意不落地：FGUI 的 `选中` 控制器那块矩形是全透明，选中态本来就没有可见表现，
 * 因此不建空节点、也不自己发明高亮；`com_rd` 未读红点按「红点统一后面做」的既定口径
 * 暂不放节点（判据见 `ChatTable.hasUnread`）。
 *
 * 删除按钮要自己截断冒泡：整项都可点，触摸会从删除按钮冒泡到本节点，
 * 不截断就会出现「对象删了，同时又把它选中了一次」。
 */

import { _decorator, Component, Label, EventTouch, Node, Sprite } from 'cc';
import { FriendAvatarLoader } from '../friend/FriendAvatar';

const { ccclass, property } = _decorator;

@ccclass('ChatPrivateHead')
export class ChatPrivateHead extends Component {
    @property({ type: Sprite, tooltip: 'Bg：底框（fd_row_bg，九宫格）' })
    background: Sprite = null;

    @property({ type: Sprite, tooltip: 'Head/Icon：头像（运行时按 img 加载）' })
    headIcon: Sprite = null;

    @property({ type: Label, tooltip: 'Name：玩家名' })
    nameLabel: Label = null;

    @property({ type: Node, tooltip: 'RemoveBtn：删除按钮（右上角）' })
    removeButton: Node = null;

    /** 由宿主在每次铺行时重设（见 `ChatRecruitRow` 的同款说明）。 */
    onSelect: (() => void) | null = null;
    onRemove: (() => void) | null = null;

    private avatar: FriendAvatarLoader | null = null;

    protected onLoad(): void {
        this.avatar = new FriendAvatarLoader(() => this.headIcon);
        this.node.on(Node.EventType.TOUCH_END, this.emitSelect, this);
        this.removeButton.on(Node.EventType.TOUCH_END, this.onRemoveTouch, this);
    }

    /** 铺一行（绝对赋值：空 `avatarId` 会清帧，不留上一行的头像）。 */
    render(name: string, avatarId: string): void {
        this.nameLabel.string = name;
        this.avatar?.apply(avatarId);
    }

    /** 整项藏掉（列表数据不足时由宿主调用）。 */
    hide(): void {
        this.node.active = false;
    }

    private emitSelect(): void {
        this.onSelect?.();
    }

    private onRemoveTouch(event: EventTouch): void {
        // 拦住冒泡，否则「点删除」会顺带把这一项选中（冒泡顺序：子 → 父）
        event.propagationStopped = true;
        this.onRemove?.();
    }

    protected onDestroy(): void {
        this.avatar?.invalidate();
        this.avatar = null;
    }
}
