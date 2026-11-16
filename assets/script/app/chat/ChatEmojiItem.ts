/**
 * 「聊天 · 表情」弹窗列表里的一个格子（60×61）—— 44 个格子共用。
 *
 * 节点结构（对齐 FGUI `组件_聊天_表情项`，只有一个 loader）：
 *
 * ```
 * ChatEmojiItem
 * └─ Icon  Sprite   ct_emoji_<N>
 * ```
 *
 * 表情是虚拟列表的行：44 张又小、又在同一个 auto-atlas，由宿主一次性预加载、
 * 在铺行之前 `await` 完，这里只做同步赋值。每格自己异步加载会重演
 * 「结果落到已被复用的节点上」那类静默串图。
 */

import { _decorator, Component, Node, Sprite, SpriteFrame } from 'cc';

const { ccclass, property } = _decorator;

@ccclass('ChatEmojiItem')
export class ChatEmojiItem extends Component {
    @property({ type: Sprite, tooltip: 'Icon：表情图（ct_emoji_<N>）' })
    icon: Sprite = null;

    /** 由宿主在每次铺行时重设。 */
    onPick: (() => void) | null = null;

    protected onLoad(): void {
        this.node.on(Node.EventType.TOUCH_END, this.emitPick, this);
    }

    /** 铺一格。`frame` 为 `null` 时清空帧 —— 复用节点最容易漏这一处。 */
    render(frame: SpriteFrame | null): void {
        this.icon.spriteFrame = frame;
    }

    /** 整格藏掉（列表数据不足时由宿主调用）。 */
    hide(): void {
        this.node.active = false;
    }

    private emitPick(): void {
        this.onPick?.();
    }
}
