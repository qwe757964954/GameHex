/**
 * 「好友申请」列表里的一行（节点对应 FGUI `好友/组件/组件_申请列表项`）。
 *
 * 与 `FriendRow` 的差别：没有 `展示删除界面` controller（没有勾选框、没有删除模式位移）；
 * 头像 72×72（`FriendRow` 是 50×50）；右侧是两个按钮（拒绝 = 深色，添加 = 金色）。
 *
 * 两张按钮底图直接序列化在 prefab 上，运行时不换图 —— 没有「图没预加载到 ⇒ 按钮留白」的风险。
 * 整行会被虚拟列表 clone 复用，`render()` 里每一处状态都要绝对赋值。
 */

import { _decorator, Button, Component, Label, Node, Sprite } from 'cc';
import { FriendAvatarLoader } from './FriendAvatar';
import type { IFriendRowView } from './FriendTable';

const { ccclass, property } = _decorator;

@ccclass('FriendApplyRow')
export class FriendApplyRow extends Component {
    @property({ type: Sprite, tooltip: 'Background：行底框（本节点上的 cc.Sprite，`fd_row_bg` 九宫格）' })
    background: Sprite = null;

    @property({ type: Sprite, tooltip: 'HeadFrame：头像框（`fd_head_frame`，81×81）' })
    headFrame: Sprite = null;

    @property({ type: Sprite, tooltip: 'Icon：头像（72×72，运行时按 `CmdFriend.img` 加载）' })
    icon: Sprite = null;

    @property({ type: Sprite, tooltip: 'LvTag：等级标签底（`fd_lv_tag`，40×40）' })
    lvTag: Sprite = null;

    @property({ type: Label, tooltip: 'Lv：等级数字' })
    lvLabel: Label = null;

    @property({ type: Label, tooltip: 'Name：玩家名' })
    nameLabel: Label = null;

    @property({ type: Label, tooltip: 'Power：战力文案' })
    powerLabel: Label = null;

    @property({ type: Node, tooltip: 'RejectBtn：拒绝按钮（深色底图）' })
    rejectButton: Node = null;

    @property({ type: Node, tooltip: 'AgreeBtn：添加按钮（金色底图）' })
    agreeButton: Node = null;

    /** 两个回调由宿主在每次铺行时重设（回调里必须按 index 现取当前行）。 */
    onAgree: (() => void) | null = null;
    onReject: (() => void) | null = null;

    private avatar: FriendAvatarLoader | null = null;

    protected onLoad(): void {
        this.avatar = new FriendAvatarLoader(() => this.icon);
        this.rejectButton.on(Button.EventType.CLICK, this.emitReject, this);
        this.agreeButton.on(Button.EventType.CLICK, this.emitAgree, this);
    }

    /** 铺一行（所有状态绝对赋值）。 */
    render(view: IFriendRowView): void {
        this.lvLabel.string = view.level;
        this.nameLabel.string = view.name;
        this.powerLabel.string = view.powerText;
        this.avatar?.apply(view.avatarId);
    }

    /** 整行藏掉（列表数据不足时由宿主调用）。 */
    hide(): void {
        this.node.active = false;
    }

    private emitAgree(): void {
        this.onAgree?.();
    }

    private emitReject(): void {
        this.onReject?.();
    }

    protected onDestroy(): void {
        this.avatar?.invalidate();
        this.avatar = null;
    }
}
