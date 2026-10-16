/**
 * 「聊天 · 私聊」左侧的**联系人头像项**（`117×146`）—— 频道 3（私聊）专用。
 *
 * 真源 = FGUI `聊天/组件/组件_聊天_私聊头像.xml`。节点结构：
 *
 * ```
 * ChatPrivateHead (117×146)
 * ├─ Bg        Sprite   fd_row_bg（九宫格，= FGUI `frame_Zhikuang06`）
 * ├─ Head      Node     scale 0.7（FGUI `scale="0.7,0.7"`）
 * │   ├─ Frame Sprite   img_Touxiang_01（头像框）
 * │   └─ Icon  Sprite   运行时按 img 加载
 * ├─ Name      Label
 * └─ RemoveBtn Button   右上角「删除」（ct_close_02，scale 0.5）
 * ```
 *
 * ## 两个刻意的「不落地」
 *
 * ① FGUI 的 `选中` 控制器 + `n91` 矩形：那个矩形 `lineColor/fillColor` 都是 `#ffffff00`
 *    —— **完全透明**，也就是「选中态在这个组件里本来就没有可见表现」。
 *    本项目**不建这个空节点**（一个永远不渲染的节点只会让后来人去找它的开关），
 *    也不自己发明一套高亮。要加高亮时再按 FGUI 补图。
 * ② `com_rd` 红点（未读）：按既定口径「红点统一后面做」，这里不放节点。
 *
 * ## 点击：为什么删除按钮要自己截断冒泡
 *
 * 整项可点（老端 `headList.onClickHead` 是**列表项**点击）⇒ 触摸会从删除按钮冒泡到本节点。
 * 不截断的症状是「点删除 → 对象删了，同时又把它选中了一次」。
 * Cocos 的冒泡顺序是 子 → 父 ⇒ 在子节点的 TOUCH_END 里 `propagationStopped = true` 即可拦住。
 */

import { _decorator, Component, Label, EventTouch, Node, Sprite } from 'cc';
import { FriendAvatarLoader } from '../friend/FriendAvatar';

const { ccclass, property } = _decorator;

@ccclass('ChatPrivateHead')
export class ChatPrivateHead extends Component {
    @property({ type: Sprite, tooltip: 'Bg：底框（fd_row_bg，九宫格）' })
    background: Sprite = null!;

    @property({ type: Sprite, tooltip: 'Head/Icon：头像（运行时按 img 加载）' })
    headIcon: Sprite = null!;

    @property({ type: Label, tooltip: 'Name：玩家名' })
    nameLabel: Label = null!;

    @property({ type: Node, tooltip: 'RemoveBtn：删除按钮（右上角）' })
    removeButton: Node = null!;

    /** 由宿主在每次铺行时重设（见 `ChatRecruitRow` 的同款说明）。 */
    onSelect: (() => void) | null = null;
    onRemove: (() => void) | null = null;

    private avatar: FriendAvatarLoader | null = null;

    protected onLoad(): void {
        this.avatar = new FriendAvatarLoader(() => this.headIcon);
        this.node.on(Node.EventType.TOUCH_END, this.emitSelect, this);
        this.removeButton.on(Node.EventType.TOUCH_END, this.onRemoveTouch, this);
    }

    /** 铺一行（**绝对赋值**：空 `avatarId` 会清帧，不留上一行的头像）。 */
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
        // 拦住冒泡，否则「点删除」会顺带把这一项选中（顺序：子 → 父）
        event.propagationStopped = true;
        this.onRemove?.();
    }

    protected onDestroy(): void {
        this.avatar?.invalidate();
        this.avatar = null;
    }
}

// ============================================================
// 未接项：`com_rd` 未读红点
// ============================================================
//
// 老端 `renderHeadListItem` 里
//   `(item.tm("com_rd") as GObjRD).OnRDUpdate(this.ModelChat.hasNewChat(data.roleId))`
// 判据本身在 `ChatTable.hasUnread`（已实现、有单测），红点**节点**按既定口径「统一后面做」
// 暂不落地。几何备好：`com_rd` 在 FGUI 里是 `xy="6,12"`，红点组件 `组件_公用_红点` —— 
// 相对父中心 (58.5, 73)，红点中心 ≈ (58.5-6-w/2, 73-12-h/2)，补时按实际图尺寸算。
