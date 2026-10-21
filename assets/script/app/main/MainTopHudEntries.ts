import { _decorator, Button, Component, Node } from 'cc';
import { PopupManager } from '../../framework/ui/PopupManager';
import type { PopupBase } from '../../framework/ui/PopupBase';
import { FriendPage } from '../friend/FriendPage';
import { MailPage } from '../mail/MailPage';

const { ccclass, property } = _decorator;

/** 新顶栏复用已有好友、邮件页面，弹窗防连点由 PopupManager 统一处理。 */
@ccclass('MainTopHudEntries')
export class MainTopHudEntries extends Component {
    @property({ type: Button, tooltip: '好友图标按钮' })
    friendButton: Button = null!;

    @property({ type: Button, tooltip: '邮件图标按钮' })
    mailButton: Button = null!;

    @property({ type: Node, tooltip: '好友文字点击区域' })
    friendLabel: Node = null!;

    @property({ type: Node, tooltip: '邮件文字点击区域' })
    mailLabel: Node = null!;

    onEnable(): void {
        this.friendButton.node.on(Button.EventType.CLICK, this.openFriend, this);
        this.mailButton.node.on(Button.EventType.CLICK, this.openMail, this);
        this.friendLabel.on(Node.EventType.TOUCH_END, this.openFriend, this);
        this.mailLabel.on(Node.EventType.TOUCH_END, this.openMail, this);
    }

    onDisable(): void {
        this.friendButton.node.off(Button.EventType.CLICK, this.openFriend, this);
        this.mailButton.node.off(Button.EventType.CLICK, this.openMail, this);
        this.friendLabel.off(Node.EventType.TOUCH_END, this.openFriend, this);
        this.mailLabel.off(Node.EventType.TOUCH_END, this.openMail, this);
    }

    private openFriend(): void {
        void this.openPopup(FriendPage);
    }

    private openMail(): void {
        void this.openPopup(MailPage);
    }

    private async openPopup(page: new () => PopupBase): Promise<void> {
        const manager = PopupManager.inst;
        if (!manager) {
            console.error('[MainTopHudEntries] PopupManager 不可用');
            return;
        }
        try {
            const popup = await manager.openAsync(page);
            if (!this.isValid) return;
            if (!popup) console.error(`[MainTopHudEntries] ${page.name} 打开失败`);
        } catch (error) {
            console.error(`[MainTopHudEntries] ${page.name} 打开失败`, error);
        }
    }
}
