/**
 * 「领取体力」列表里的**一行** —— `564×133`。
 *
 * 结构逐节点对齐 FGUI `好友/组件/组件_领取粮草项.xml`。与 `FriendRow` 的差别：
 *   · **没有 `展示删除界面` controller** ⇒ 无勾选框、无删除模式位移；
 *   · 头像框 `n71` 在 `(36,24)` 且带 `aspect="true"`，`icon` 仍是 **50×50**（在 `(76,64)`）；
 *   · 等级标签在 `(27,15)`；玩家名 `(146,34)` / 战力 `(146,65)`（各差 1px，逐值保留）；
 *   · 右侧上方是 **`粮草数`**（`(540,14)`，`pivot="1,0"` 右上角对齐，**81 宽**，
 *     比 `FriendRow` 的 `时长` 宽 37px），文案 `体力数:{0}`；
 *   · 右侧是**一个**金色按钮 `btn`(414,43) 文案「领取」。
 *
 * ⚠️ 「粮草数」这一列**只有本行有** —— `FriendRow` / `FriendApplyRow` 上都没有对应节点。
 *    所以 `IFriendRowView.endNumText` 的**唯一消费者就是本组件**；另外两个行组件忽略它。
 *    空串 = 整块隐藏（本行数据一定可领，所以实际总会带上文案，但保留这条守则：
 *    虚拟列表 clone 复用下，**每一处都要绝对赋值**，条件式赋值会让上一行的数字串过来）。
 */

import { _decorator, Button, Component, Label, Node, Sprite } from 'cc';
import { FriendAvatarLoader } from './FriendAvatar';
import type { IFriendRowView } from './FriendTable';

const { ccclass, property } = _decorator;

@ccclass('FriendGetEndRow')
export class FriendGetEndRow extends Component {
    @property({ type: Sprite, tooltip: 'Background：行底框（本节点上的 cc.Sprite，`fd_row_bg` 九宫格）' })
    background: Sprite = null!;

    @property({ type: Sprite, tooltip: 'HeadFrame：头像框（`fd_head_frame`，81×81）' })
    headFrame: Sprite = null!;

    @property({ type: Sprite, tooltip: 'Icon：头像（50×50，运行时按 `CmdFriend.img` 加载）' })
    icon: Sprite = null!;

    @property({ type: Sprite, tooltip: 'LvTag：等级标签底（`fd_lv_tag`，40×40）' })
    lvTag: Sprite = null!;

    @property({ type: Label, tooltip: 'Lv：等级数字' })
    lvLabel: Label = null!;

    @property({ type: Label, tooltip: 'Name：玩家名' })
    nameLabel: Label = null!;

    @property({ type: Label, tooltip: 'Power：战力文案' })
    powerLabel: Label = null!;

    @property({ type: Label, tooltip: 'EndNum：右侧「体力数:N」（右对齐，空串时整块隐藏）' })
    endNumLabel: Label = null!;

    @property({ type: Node, tooltip: 'ActionBtn：领取按钮（金色底图，`颜色,1`）' })
    actionButton: Node = null!;

    /** 点击回调，**由宿主在每次铺行时重设**（虚拟列表复用节点，只能靠 index 认行）。 */
    onAction: (() => void) | null = null;

    private avatar: FriendAvatarLoader | null = null;

    protected onLoad(): void {
        this.avatar = new FriendAvatarLoader(() => this.icon);
        this.actionButton.on(Button.EventType.CLICK, this.emitAction, this);
    }

    /** 铺一行（所有状态绝对赋值）。 */
    render(view: IFriendRowView): void {
        if (!this.background) {
            const own = this.getComponent(Sprite);
            if (own) this.background = own;
        }
        this.lvLabel.string = view.level;
        this.nameLabel.string = view.name;
        this.powerLabel.string = view.powerText;
        this.avatar?.apply(view.avatarId);

        // 体力数：空串要连节点一起关掉（否则上一行的数字会留在这一行）
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
