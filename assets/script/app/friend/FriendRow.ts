/**
 * 「好友」列表里的**一行** —— 三个页签共用（`564×133`）。
 *
 * 结构逐节点对齐 FGUI `好友/组件/组件_好友项.xml`。**为什么三个页签共用一份**：
 * 老端也是这么做的 —— `LayerFriend.renderListItem` 里对同一个 item 调
 * `item.setSelectedIndex("页签", this.selectIndex)`，靠 `页签` controller 的 `gearDisplay`
 * 切「私聊 / 时长 / 勾选」的显隐，主按钮文案由代码按页签改写。
 *
 * | FGUI 节点 | 本节点 | 页签 0（好友列表） | 页签 1（添加好友） | 页签 2（黑名单） |
 * |---|---|---|---|---|
 * | `n70` 行底框 | `Bg` | 显示 | 显示 | 显示 |
 * | `n71` 头像框 | `HeadFrame` | 显示 | 显示 | 显示 |
 * | `icon` | `Icon` | 头像 | 头像 | 头像 |
 * | `n73` / `文本_等级` | `LvTag` / `Lv` | 显示 | 显示 | 显示 |
 * | `玩家名` / `战力` | `Name` / `Power` | 显示 | 显示 | 显示 |
 * | `按钮_私聊` | `ChatBtn` | **显示** | 隐藏 | 隐藏 |
 * | `btn` | `ActionBtn` | 赠送/已赠送 | 申请/已申请 | 移除 |
 * | `时长` | `Duration` | **显示** | 隐藏 | 隐藏 |
 * | `按钮_勾选` | `CheckBtn` (+`Mark`) | **删除模式才显示** | 隐藏 | 隐藏 |
 *
 * ⚠️ 整行会被虚拟列表 **clone 复用** ⇒ `render()` 里每一处都要**绝对赋值**
 *   （记忆规则 10：条件式赋值会让上一行的状态串到下一行）。
 *   最容易漏的两处：`Duration`（页签 1/2 必须写空串 + 关节点）与 `CheckBtn/Mark`。
 */

import { _decorator, Button, Color, Component, Label, Node, Sprite } from 'cc';
import { FriendAvatarLoader } from './FriendAvatar';
import { friendTint } from './FriendArt';
import { rowGroupPosition } from './FriendTable';
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
     * 「头像框 / 头像 / 等级标签 / 等级数字 / 玩家名 / 战力」这一组的容器
     * （= FGUI `组件_好友项` 的 `group n80`）。
     *
     * 只有它一个节点会随删除模式移动（`rowGroupPosition`），组内的 6 个节点坐标**不变** ——
     * 对齐 FGUI 的 `gearXY`：那个 controller 作用在组上，不作用在成员上。
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
     * 三个回调，**由宿主在每次铺行时重设**（`FriendPage.renderRow`）。
     *
     * ⚠️ 不能在 `render()` 里绑监听：同一个实例会被复用到别的下标，
     * 回调里必须按 index 现取当前行，否则会「点第 3 行删掉第 1 个」。
     */
    onAction: (() => void) | null = null;
    onChat: (() => void) | null = null;
    onCheck: (() => void) | null = null;

    private avatar: FriendAvatarLoader | null = null;

    protected onLoad(): void {
        this.avatar = new FriendAvatarLoader(() => this.icon);
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

        // 时长（页签 1/2 写空串并关节点 —— 漏了会把好朋友的在线状态带到陌生人那行）
        this.durationLabel.string = view.durationText;
        this.durationLabel.node.active = view.durationText.length > 0;

        // 私聊（Demo3.8 没有聊天模块，宿主传 `chatAvailable=false` ⇒ 一律不显示）
        this.chatButton.active = view.showChat;

        // 删除模式下整组右移 43、下移 6，把左边让给勾选框（FGUI `group n80` 的 gearXY）
        const group = rowGroupPosition(view.showCheck);
        if (this.shiftGroup) this.shiftGroup.setPosition(group.x, group.y, 0);

        // 主按钮：文案 + 置灰 + 可点性 + 显隐，四样都要绝对赋值
        // （删除模式下 FGUI 把 `btn` 整块藏掉，留着会和勾选框挤在一起）
        this.actionButton.active = view.showAction;
        this.actionLabel.string = view.actionText;
        this.actionLabel.color = color;
        if (this.actionBackground) this.actionBackground.color = color;
        const button = this.actionButton.getComponent(Button);
        if (button) button.interactable = view.actionEnabled;

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
