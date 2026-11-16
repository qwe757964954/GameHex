/**
 * 「领取体力」列表里的一行（节点对应 FGUI `好友/组件/组件_领取粮草项`）。
 *
 * 与 `FriendRow` 的差别：没有删除模式（无勾选框、无位移）；右侧多一列「体力数:N」
 * —— 这一列只有本行有，`IFriendRowView.endNumText` 的唯一消费者就是本组件。
 *
 * 空串要连节点一起关掉：虚拟列表 clone 复用，条件式赋值会把上一行的数字串过来。
 */

import { _decorator, Button, Component, Label, Node, Sprite } from 'cc';
import { FriendAvatarLoader } from './FriendAvatar';
import type { IFriendRowView } from './FriendTable';

const { ccclass, property } = _decorator;

@ccclass('FriendGetEndRow')
export class FriendGetEndRow extends Component {
    @property({ type: Sprite, tooltip: 'Background：行底框（本节点上的 cc.Sprite，`fd_row_bg` 九宫格）' })
    background: Sprite = null;

    @property({ type: Sprite, tooltip: 'HeadFrame：头像框（`fd_head_frame`，81×81）' })
    headFrame: Sprite = null;

    @property({ type: Sprite, tooltip: 'Icon：头像（50×50，运行时按 `CmdFriend.img` 加载）' })
    icon: Sprite = null;

    @property({ type: Sprite, tooltip: 'LvTag：等级标签底（`fd_lv_tag`，40×40）' })
    lvTag: Sprite = null;

    @property({ type: Label, tooltip: 'Lv：等级数字' })
    lvLabel: Label = null;

    @property({ type: Label, tooltip: 'Name：玩家名' })
    nameLabel: Label = null;

    @property({ type: Label, tooltip: 'Power：战力文案' })
    powerLabel: Label = null;

    @property({ type: Label, tooltip: 'EndNum：右侧「体力数:N」（右对齐，空串时整块隐藏）' })
    endNumLabel: Label = null;

    @property({ type: Node, tooltip: 'ActionBtn：领取按钮（金色底图）' })
    actionButton: Node = null;

    /** 点击回调由宿主在每次铺行时重设（虚拟列表复用节点，只能靠 index 认行）。 */
    onAction: (() => void) | null = null;

    private avatar: FriendAvatarLoader | null = null;

    protected onLoad(): void {
        this.avatar = new FriendAvatarLoader(() => this.icon);
        this.actionButton.on(Button.EventType.CLICK, this.emitAction, this);
    }

    /** 铺一行（所有状态绝对赋值）。 */
    render(view: IFriendRowView): void {
        this.lvLabel.string = view.level;
        this.nameLabel.string = view.name;
        this.powerLabel.string = view.powerText;
        this.avatar?.apply(view.avatarId);

        // 体力数：空串要连节点一起关掉，否则上一行的数字会留在这一行。
        this.endNumLabel.string = view.endNumText;
        this.endNumLabel.node.active = view.endNumText.length > 0;
    }

    /** 整行藏掉（列表数据不足时由宿主调用）。 */
    hide(): void {
        this.node.active = false;
    }

    private emitAction(): void {
        this.onAction?.();
    }

    protected onDestroy(): void {
        this.avatar?.invalidate();
        this.avatar = null;
    }
}
