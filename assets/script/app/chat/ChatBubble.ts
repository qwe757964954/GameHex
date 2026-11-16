/**
 * 一条聊天消息（频道 1/2/4 的消息列表用）—— 一个模板内含左右两套子树。
 *
 * 老端按「是不是自己发的」逐项换模板；本工程的虚拟列表按项换模板要开
 * `useDynamicSize` + `getItemTypeIndexFn`，代价是把尺寸采样一整套逻辑拉进来。
 * 这里改用等价且更稳的形态：模板固定一个，内部放 `Left` / `Right` 两套子树，
 * `render()` 按 `isSelf` 切 `active`（与 `FriendRow` 靠 active 切页签形态同款）。
 *
 * 虚拟列表会 clone 复用节点，所以三处必须绝对赋值：
 * ① `leftGroup` / `rightGroup.active`；② 两边文案都写（只写当前那套的话，
 * 切回来会留着上一行的残留）；③ 左右切换时 `invalidate()` 头像加载 ——
 * `FriendAvatarLoader.appliedId` 的去重会挡住「同一 id 换到另一套子树」。
 */

import { _decorator, Component, Label, Node, RichText, Sprite } from 'cc';
import { FriendAvatarLoader } from '../friend/FriendAvatar';

const { ccclass, property } = _decorator;

@ccclass('ChatBubble')
export class ChatBubble extends Component {
    @property({ type: Node, tooltip: 'Left：别人发的（530×112）' })
    leftGroup: Node = null;

    @property({ type: Sprite, tooltip: 'Left/Head/Icon：头像' })
    leftHead: Sprite = null;

    @property({ type: Label, tooltip: 'Left/Name：玩家名' })
    leftName: Label = null;

    @property({ type: RichText, tooltip: 'Left/Msg：正文（必须是 RichText，表情与艾特都靠它）' })
    leftMsg: RichText = null;

    @property({ type: Node, tooltip: 'Right：自己发的（530×114）' })
    rightGroup: Node = null;

    @property({ type: Sprite, tooltip: 'Right/Head/Icon：头像' })
    rightHead: Sprite = null;

    @property({ type: Label, tooltip: 'Right/Name：玩家名' })
    rightName: Label = null;

    @property({ type: RichText, tooltip: 'Right/Msg：正文（必须是 RichText）' })
    rightMsg: RichText = null;

    private avatar: FriendAvatarLoader | null = null;

    /** 上一次铺的是不是自己发的（用于判「要不要作废头像加载」）。 */
    private lastSelf: boolean | null = null;

    protected onLoad(): void {
        this.avatar = new FriendAvatarLoader(() => (this.lastSelf ? this.rightHead : this.leftHead));
    }

    /**
     * 铺一条消息。
     *
     * @param isSelf   是不是我自己发的（决定左 / 右子树）
     * @param name     玩家名
     * @param rich     已展开的富文本串（`ChatTable.parseEmoji` 处理过），本类不再碰标记
     * @param avatarId 头像 id（空串 = 清帧）
     */
    render(isSelf: boolean, name: string, rich: string, avatarId: string): void {
        // 左右切换后头像落到另一棵子树上，必须作废旧的在途结果（否则新那套永远留白）
        if (this.lastSelf !== isSelf) {
            this.lastSelf = isSelf;
            this.avatar?.invalidate();
        }

        this.leftGroup.active = !isSelf;
        this.rightGroup.active = isSelf;

        this.leftName.string = name;
        this.leftMsg.string = rich;
        this.rightName.string = name;
        this.rightMsg.string = rich;

        this.avatar?.apply(avatarId);
    }

    /** 整行藏掉（列表数据不足时由宿主调用）。 */
    hide(): void {
        this.node.active = false;
    }

    protected onDestroy(): void {
        this.avatar?.invalidate();
        this.avatar = null;
    }
}
