/**
 * 一条私聊消息（频道 3 的 `privateList` 用）—— 与 `ChatBubble` 同构，只是几何不同。
 *
 * 私聊的四个元素几何与公共频道完全不同（气泡 320×84 vs 373×53），模板宽度也不同
 * （425 vs 530）；合成一份只能把几何搬进代码，违反「样式与布局全在 prefab」。
 * 所以按同款形态再落一份，保证「每个列表一个模板」。
 *
 * 私聊右气泡特别窄（`bg` 89×54、`msg` 54×32）是 FGUI 原稿（短消息气泡自适应后的模样），
 * 不是笔误。
 */

import { _decorator, Component, Label, Node, RichText, Sprite } from 'cc';
import { FriendAvatarLoader } from '../friend/FriendAvatar';

const { ccclass, property } = _decorator;

@ccclass('ChatPrivateBubble')
export class ChatPrivateBubble extends Component {
    @property({ type: Node, tooltip: 'Left：对方发的（425×143）' })
    leftGroup: Node = null;

    @property({ type: Sprite, tooltip: 'Left/Head/Icon：头像' })
    leftHead: Sprite = null;

    @property({ type: Label, tooltip: 'Left/Name：玩家名' })
    leftName: Label = null;

    @property({ type: RichText, tooltip: 'Left/Msg：正文（必须是 RichText）' })
    leftMsg: RichText = null;

    @property({ type: Node, tooltip: 'Right：我发的（425×113）' })
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

    /** 铺一条私聊消息（口径同 `ChatBubble.render`）。 */
    render(isSelf: boolean, name: string, rich: string, avatarId: string): void {
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
