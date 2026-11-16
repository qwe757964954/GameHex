/**
 * 「聊天 · 艾特」弹窗列表里的一行（240×116）。
 *
 * 节点结构（对齐 FGUI `组件_聊天_艾特项`，一个 controller 都没有，几何全静态）：
 *
 * ```
 * ChatAtRow
 * ├─ Bg     Sprite  fd_row_bg（九宫格）
 * ├─ Head   Node    scale 0.7
 * │   ├─ Frame Sprite img_Touxiang_01
 * │   └─ Icon  Sprite 运行时按 img 加载
 * ├─ Name   Label   玩家名
 * └─ Server Label   区服名
 * ```
 *
 * 数据来源是好友列表（与好友模块同一张 `CmdFriend` 缓存）。
 */

import { _decorator, Component, Label, Node, Sprite } from 'cc';
import { FriendAvatarLoader } from '../friend/FriendAvatar';

const { ccclass, property } = _decorator;

@ccclass('ChatAtRow')
export class ChatAtRow extends Component {
    @property({ type: Sprite, tooltip: 'Bg：底框（fd_row_bg，九宫格）' })
    background: Sprite = null;

    @property({ type: Sprite, tooltip: 'Head/Icon：头像（运行时按 img 加载）' })
    headIcon: Sprite = null;

    @property({ type: Label, tooltip: 'Name：玩家名' })
    nameLabel: Label = null;

    @property({ type: Label, tooltip: 'Server：区服名' })
    serverLabel: Label = null;

    /** 由宿主在每次铺行时重设（见 `ChatRecruitRow` 的同款说明）。 */
    onPick: (() => void) | null = null;

    private avatar: FriendAvatarLoader | null = null;

    protected onLoad(): void {
        this.avatar = new FriendAvatarLoader(() => this.headIcon);
        this.node.on(Node.EventType.TOUCH_END, this.emitPick, this);
    }

    /**
     * 铺一行。
     *
     * @param name     玩家名
     * @param server   区服名（本工程没有区服表，调用方按老端 fallback 传区服 id）
     * @param avatarId 头像 id
     */
    render(name: string, server: string, avatarId: string): void {
        this.nameLabel.string = name;
        this.serverLabel.string = server;
        this.avatar?.apply(avatarId);
    }

    /** 整行藏掉（列表数据不足时由宿主调用）。 */
    hide(): void {
        this.node.active = false;
    }

    private emitPick(): void {
        this.onPick?.();
    }

    protected onDestroy(): void {
        this.avatar?.invalidate();
        this.avatar = null;
    }
}
