/**
 * 「聊天 · 表情」弹窗列表里的一个格子（`60×61`）—— 44 个格子共用。
 *
 * 真源 = FGUI `聊天/组件/组件_聊天_表情项.xml`（只有一个 loader）：
 *
 * ```
 * ChatEmojiItem (60×61)
 * └─ Icon  Sprite   ct_emoji_<N>
 * ```
 *
 * ## 为什么是「宿主预加载 44 帧 + 传进来」，不是每格自己异步加载
 *
 * 表情是**虚拟列表**的行：`renderItemFn` 只绑一次、按 `index` 现取。
 * 若每格自己 `resources.load`，就会重演「异步结果落到已被复用的节点上」那类
 * 静默串图（同 `FriendAvatar` 文件头说的坑）。
 * 44 张又小、又在同一个 auto-atlas ⇒ 宿主一次性 `Promise.all` 预加载、
 * 在 `present()` **之前** `await` 完（虚拟列表铁律②），这里只做同步赋值。
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

    /**
     * 铺一格。`frame` 为 `null` 时**清空帧**（不能留着上一格的图 —— 复用节点最容易漏这处）。
     */
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
