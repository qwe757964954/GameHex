/**
 * 「好友」列表里的一行，三个页签共用一份（节点对应 FGUI `好友/组件/组件_好友项`）。
 *
 * 共用靠 `页签` controller 的 `gearDisplay` 切显隐，代码只改主按钮文案：
 * 「私聊」和「时长」只在好友列表页签显示，「勾选」只在好友列表的删除模式显示，
 * 主按钮文案按页签是「赠送 / 已赠送」「申请 / 已申请」「移除」。
 *
 * 整行会被虚拟列表 clone 复用，`render()` 里每一处都要绝对赋值 —— 条件式赋值会让上一行
 * 的状态串到下一行。最容易漏的是 `Duration`（非好友列表页签必须写空串并关节点）和 `CheckBtn/Mark`。
 */

import { _decorator, Button, Color, Component, Label, Node, Sprite, Vec3 } from 'cc';
import { FriendAvatarLoader } from './FriendAvatar';
import { friendTint } from './FriendArt';
import type { IFriendRowView } from './FriendTable';

const { ccclass, property } = _decorator;

@ccclass('FriendRow')
export class FriendRow extends Component {
    @property({ type: Sprite, tooltip: 'Bg：行底框（`fd_row_bg`，九宫格）' })
    background: Sprite = null;

    @property({ type: Sprite, tooltip: 'HeadFrame：头像框（`fd_head_frame`）' })
    headFrame: Sprite = null;

    @property({ type: Sprite, tooltip: 'Icon：头像（运行时按 `CmdFriend.img` 加载）' })
    icon: Sprite = null;

    @property({ type: Sprite, tooltip: 'LvTag：等级标签底（`fd_lv_tag`）' })
    lvTag: Sprite = null;

    @property({ type: Label, tooltip: 'Lv：等级数字' })
    lvLabel: Label = null;

    @property({ type: Label, tooltip: 'Name：玩家名' })
    nameLabel: Label = null;

    @property({ type: Label, tooltip: 'Power：战力文案' })
    powerLabel: Label = null;

    /**
     * 左侧一组节点的容器（头像框 / 头像 / 等级标签 / 等级数字 / 玩家名 / 战力）。
     *
     * 只有它随删除模式移动（对齐 FGUI 的 `gearXY`：controller 作用在组上，组内 6 个节点坐标不变）。
     */
    @property({ type: Node, tooltip: 'Group：左侧那一组（删除模式下整组右移 43、下移 6）' })
    shiftGroup: Node = null;

    @property({ type: Node, tooltip: 'ChatBtn：私聊按钮（仅好友列表页签显示）' })
    chatButton: Node = null;

    @property({ type: Label, tooltip: 'ChatBtn/Label：私聊文案（静态）' })
    chatLabel: Label = null;

    @property({ type: Node, tooltip: 'ActionBtn：主按钮（赠送 / 申请 / 移除）' })
    actionButton: Node = null;

    @property({ type: Sprite, tooltip: 'ActionBtn：按钮底图（置灰时改 tint）' })
    actionBackground: Sprite = null;

    @property({ type: Label, tooltip: 'ActionBtn/Label：主按钮文案' })
    actionLabel: Label = null;

    @property({ type: Label, tooltip: 'Duration：在线 / 离线时长（仅好友列表页签显示）' })
    durationLabel: Label = null;

    @property({ type: Node, tooltip: 'CheckBtn：勾选框（仅好友列表页签的删除模式显示）' })
    checkButton: Node = null;

    @property({ type: Node, tooltip: 'CheckBtn/Mark：对勾（勾选时显示）' })
    checkMark: Node = null;

    /**
     * 三个回调，由宿主在每次铺行时重设（`FriendPage.renderRow`）。
     *
     * 不能在 `render()` 里绑监听：同一个实例会被复用到别的下标，
     * 回调里必须按 index 现取当前行，否则会「点第 3 行删掉第 1 个」。
     */
    onAction: (() => void) | null = null;
    onChat: (() => void) | null = null;
    onCheck: (() => void) | null = null;

    private avatar: FriendAvatarLoader | null = null;
    /** 普通态位置取 prefab 初始值；删除态位置取 prefab 的 DeleteGroupAnchor。 */
    private normalGroupPosition: Vec3 | null = null;
    private deleteGroupAnchor: Node | null = null;

    protected onLoad(): void {
        this.avatar = new FriendAvatarLoader(() => this.icon);
        this.normalGroupPosition = this.shiftGroup.position.clone();
        this.deleteGroupAnchor = this.node.getChildByName('DeleteGroupAnchor');
        this.actionButton.on(Button.EventType.CLICK, this.emitAction, this);
        this.chatButton.on(Button.EventType.CLICK, this.emitChat, this);
        this.checkButton.on(Button.EventType.CLICK, this.emitCheck, this);
    }

    /** 铺一行（所有状态绝对赋值）。 */
    render(view: IFriendRowView): void {
        const tint = friendTint(view.actionGray);
        const color = new Color(tint[0], tint[1], tint[2], 255);

        this.lvLabel.string = view.level;
        this.nameLabel.string = view.name;
        this.powerLabel.string = view.powerText;
        this.avatar?.apply(view.avatarId);

        // 时长：非好友列表页签写空串并关节点，漏了会把好友的在线状态带到陌生人那一行。
        this.durationLabel.string = view.durationText;
        this.durationLabel.node.active = view.durationText.length > 0;

        // 私聊（Demo3.8 没有聊天模块，宿主传 `chatAvailable = false`，一律不显示）
        this.chatButton.active = view.showChat;

        // 删除模式下整组右移 43、下移 6：两档位置都在 prefab（默认位置 + DeleteGroupAnchor）
        const target = view.showCheck ? this.deleteGroupAnchor?.position : this.normalGroupPosition;
        if (target) this.shiftGroup.setPosition(target.x, target.y, 0);

        // 主按钮：文案 / 置灰 / 可点性 / 显隐，四样都要绝对赋值
        // （删除模式下 FGUI 把 `btn` 整块藏掉，留着会和勾选框挤在一起）
        this.actionButton.active = view.showAction;
        this.actionLabel.string = view.actionText;
        this.actionLabel.color = color;
        this.actionBackground.color = color;
        this.actionButton.getComponent(Button).interactable = view.actionEnabled;

        // 勾选框 + 对勾
        this.checkButton.active = view.showCheck;
        this.checkMark.active = view.showCheck && view.checkSelected;
    }

    /** 整行藏掉（列表数据不足时由宿主调用）。 */
    hide(): void {
        this.node.active = false;
    }

    private emitAction(): void {
        this.onAction?.();
    }

    private emitChat(): void {
        this.onChat?.();
    }

    private emitCheck(): void {
        this.onCheck?.();
    }

    protected onDestroy(): void {
        this.avatar?.invalidate();
        this.avatar = null;
    }
}
