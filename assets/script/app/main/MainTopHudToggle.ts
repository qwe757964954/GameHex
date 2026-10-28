import { _decorator, Button, Component, Node } from 'cc';

const { ccclass, property } = _decorator;

/** 主城顶栏社交入口展开 / 收起；玩家信息与货币由其它组件独立管理。 */
@ccclass('MainTopHudToggle')
export class MainTopHudToggle extends Component {
    @property({ type: Node, tooltip: 'EntryBar: background of the collapsible shortcuts' })
    entryBar: Node = null!;

    @property({ type: Node, tooltip: 'Friend：好友图标' })
    friend: Node = null!;

    @property({ type: Node, tooltip: 'Mail：邮件图标' })
    mail: Node = null!;

    @property({ type: Node, tooltip: 'Rank：排行图标' })
    rank: Node = null!;

    @property({ type: Node, tooltip: 'Invite：邀请图标' })
    invite: Node = null!;

    @property({ type: Node, tooltip: 'FriendLabel：好友文字' })
    friendLabel: Node = null!;

    @property({ type: Node, tooltip: 'MailLabel：邮件文字' })
    mailLabel: Node = null!;

    @property({ type: Node, tooltip: 'RankLabel：排行文字' })
    rankLabel: Node = null!;

    @property({ type: Node, tooltip: 'InviteLabel：邀请文字' })
    inviteLabel: Node = null!;

    @property({ type: Button, tooltip: 'Arrow：展开 / 收起按钮（绑 cc.Button）' })
    arrow: Button = null!;

    private expanded = true;

    onEnable(): void {
        this.arrow.node.on(Button.EventType.CLICK, this.toggle, this);
        this.applyState();
    }

    onDisable(): void {
        this.arrow.node.off(Button.EventType.CLICK, this.toggle, this);
    }

    private toggle(): void {
        this.expanded = !this.expanded;
        this.applyState();
    }

    private applyState(): void {
        for (const node of [
            this.entryBar,
            this.friend, this.mail, this.rank, this.invite,
            this.friendLabel, this.mailLabel, this.rankLabel, this.inviteLabel,
        ]) {
            node.active = this.expanded;
        }
        this.arrow.node.angle = this.expanded ? 0 : 180;
    }
}
