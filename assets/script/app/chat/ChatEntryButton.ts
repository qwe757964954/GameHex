/**
 * 主界面底部聊天条的点击入口（ArenaRoot/BottomHud/ChatBar）。
 *
 * 经 `PopupManager` 打开聊天页：同类弹窗单实例，连点不会叠出两个框。
 * 红点由宿主按需给；当前底部聊天条没有红点节点。
 */

import { _decorator, Button, Component, Node } from 'cc';
import { PopupManager } from '../../framework/ui/PopupManager';
import { ChatPage } from './ChatPage';

const { ccclass, property } = _decorator;

@ccclass('ChatEntryButton')
export class ChatEntryButton extends Component {
    @property({
        type: Node,
        tooltip: '红点节点（可选，由宿主提供；当前底部聊天条未挂）',
    })
    redDot: Node | null = null;

    protected onLoad(): void {
        // 刻意不配 onDestroy / off（与 login/ServerSelectItem、framework/ui/PopupBase 同一约定）：
        // 同节点组件按数组序销毁，cc.Button 先于本组件被销毁并清掉 `node`，
        // 此时再 `getComponent(Button).node.off(...)` 会抛错，异常从销毁循环里抛出后
        // 组件停在 Destroying 却未 Destroyed，之后重复销毁刷屏。
        // 不 off 本身是安全的：`Node._onPreDestroyBase` 会在销毁组件前清空监听。
        this.node.on(Button.EventType.CLICK, this.onClick, this);
    }

    private onClick(): void {
        void this.openChat();
    }

    /**
     * 打开聊天弹窗。管理器常驻节点被销毁、或预制体加载失败时 `openAsync` 返回 `null`，
     * 这里只留痕。
     */
    async openChat(): Promise<void> {
        const popup = await PopupManager.inst.openAsync(ChatPage);
        if (!popup) console.error('[Chat] 入口按钮：聊天弹窗打开失败');
    }

    /** 红点显隐的唯一入口（本轮不接数据源，接口先留好）。 */
    setRedDot(visible: boolean): void {
        if (this.redDot) this.redDot.active = visible;
    }
}
