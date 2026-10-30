/**
 * 「好友申请」列表里的**一行** —— `564×133`。
 *
 * 结构逐节点对齐 FGUI `好友/组件/组件_申请列表项.xml`。与 `FriendRow` 的差别（**只差这些**）：
 *   · **没有 `展示删除界面` controller** ⇒ 没有勾选框、没有删除模式的位移；
 *   · 头像框 `n71` 在 `(37,21)`、`icon` 是 **72×72**（`FriendRow` 是 50×50）；
 *   · 等级标签在 `(27,8)`（`FriendRow` 是 `(30,21)`，因为要在 `AvatarBox` 里跟着位移）；
 *   · 右侧是**两个**按钮：`按钮_拒绝`(277,37 / dark) + `按钮_添加`(414,37 / gold)；
 *   · **没有** `时长`、**没有** `按钮_私聊`、**没有** `btn`。
 *
 * | FGUI 节点 | 本节点 |
 * |---|---|
 * | `n70` 行底框 | 本节点自己的 `cc.Sprite` (`fd_row_bg`) |
 * | `n71` 头像框 | `HeadFrame` |
 * | `icon` (72×72) | `Icon` |
 * | `n73` / `文本_等级` | `LvTag` / `Lv` |
 * | `玩家名` / `战力` | `Name` / `Power` |
 * | `按钮_拒绝`（`颜色,0` 深色） | `RejectBtn` |
 * | `按钮_添加`（`颜色,1` 金色） | `AgreeBtn` |
 *
 * ⚠️ 颜色别按图名猜：FGUI `颜色,1`(=Orange) 指向 `TY_btn06`（**金色** = 主操作「添加」），
 *    `颜色,0`(=Bule) 指向 `TY_btn07`（**深色** = 次操作「拒绝」）。两张底图**直接序列化在
 *    prefab 上**，运行时不换图 —— 也就没有「图没预加载到 ⇒ 按钮静默留白」这条风险。
 *
 * ⚠️ 整行会被虚拟列表 **clone 复用** ⇒ `render()` 每一处状态都要**绝对赋值**。
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

    @property({ type: Sprite, tooltip: 'Icon：头像（**72×72**，运行时按 `CmdFriend.img` 加载）' })
    icon: Sprite = null;

    @property({ type: Sprite, tooltip: 'LvTag：等级标签底（`fd_lv_tag`，40×40）' })
    lvTag: Sprite = null;

    @property({ type: Label, tooltip: 'Lv：等级数字' })
    lvLabel: Label = null;

    @property({ type: Label, tooltip: 'Name：玩家名' })
    nameLabel: Label = null;

    @property({ type: Label, tooltip: 'Power：战力文案' })
    powerLabel: Label = null;

    @property({ type: Node, tooltip: 'RejectBtn：拒绝按钮（深色底图，`颜色,0`）' })
    rejectButton: Node = null;

    @property({ type: Node, tooltip: 'AgreeBtn：添加按钮（金色底图，`颜色,1`）' })
    agreeButton: Node = null;

    /** 两个回调**由宿主在每次铺行时重设**（回调里必须按 index 现取当前行）。 */
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
        if (!this.background) {
            const own = this.getComponent(Sprite);
            if (own) this.background = own;
        }
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
