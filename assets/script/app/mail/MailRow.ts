/**
 * 邮件列表行，560×108。未读/已读/已领取三态换行底图、状态字和印章。
 * v2 在行内加了快捷「领取」按钮：可领取（`!take`）时显示，点击交给宿主单封领取。
 * 行会被虚拟列表复用，render 必须绝对赋值；行底图由宿主预加载后传入，避免闪上一行的图。
 */

import { _decorator, Button, Component, Label, Node, Sprite, SpriteFrame } from 'cc';
import { RedDot } from '../common/RedDot';
import { mailStampVisible, mailStateTextVisible } from './MailArt';
import { IMailRowView, MAIL_STATE_UNREAD } from './MailTable';

const { ccclass, property } = _decorator;

/** 两张行底图（宿主预加载后传入）。 */
export interface IMailRowArt {
    readonly unread: SpriteFrame | null;
    readonly read: SpriteFrame | null;
}

@ccclass('MailRow')
export class MailRow extends Component {
    @property({ type: Sprite, tooltip: '本节点：行底图（未读 / 已读两张，运行时切换）' })
    background: Sprite = null;

    @property({ type: Sprite, tooltip: 'Deco：左侧信纸装饰（`ml_mail_deco`，静态）' })
    deco: Sprite = null;

    @property({ type: Sprite, tooltip: 'MailIcon：信封图标（`ml_mail_icon`，静态）' })
    mailIcon: Sprite = null;

    @property({ type: Label, tooltip: 'Title：邮件标题' })
    titleLabel: Label = null;

    @property({ type: Label, tooltip: 'Time：相对时间' })
    timeLabel: Label = null;

    @property({ type: Label, tooltip: 'State：状态文本（只有「已读」显示）' })
    stateLabel: Label = null;

    @property({ type: Node, tooltip: 'TakenStamp：「已领取」印章（只有已领取显示）' })
    takenStamp: Node = null;

    @property({ type: RedDot, tooltip: 'UnreadDot：未读红点（工程通用 RedDot，按未读态显隐）' })
    unreadDot: RedDot = null!;

    @property({ type: Button, tooltip: 'ClaimBtn：行内「领取」（可领取时显示）' })
    claimButton: Button = null!;

    @property({ type: Button, tooltip: '本节点：整行可点（打开详情）' })
    button: Button = null!;

    /**
     * 打开详情回调 —— **由宿主在每次铺行时重设**（`MailPage.renderRow`）。
     * 不能在 `render()` 里绑监听：同一个实例会被复用到别的下标，
     * 回调里必须按当前行现取 id，否则会「点第 3 行打开第 1 封」。
     */
    onOpen: ((id: string) => void) | null = null;

    /** 行内领取回调（同样由宿主每次铺行重设）。 */
    onClaim: ((id: string) => void) | null = null;

    /** 当前渲染的是哪一封（回调里用）—— 每次 `render` 覆盖。 */
    private mailId = '';

    protected onLoad(): void {
        this.button.node.on(Button.EventType.CLICK, this.emitOpen, this);
        this.claimButton.node.on(Button.EventType.CLICK, this.emitClaim, this);
    }

    /** 铺一行（所有状态绝对赋值）。 */
    render(view: IMailRowView, art: IMailRowArt): void {
        this.mailId = view.id;

        this.titleLabel.string = view.title;
        this.timeLabel.string = view.timeText;

        // 状态文本：未读 / 已领取都是空串 ⇒ 必须同时关节点（否则上一行的「已读」会留着）
        // 「哪一态显示文本 / 印章」由 `MailArt` 出（口径唯一，别在这里复述那张表）
        this.stateLabel.string = view.stateText;
        this.stateLabel.node.active = mailStateTextVisible(view.state) && !view.takeable;

        // 印章：只有「已领取」显示
        this.takenStamp.active = mailStampVisible(view.state);

        // 行内领取：可领取时显示；与状态文本互斥，避免同一行右端叠两层
        this.claimButton.node.active = view.takeable;

        // 未读红点：接入工程通用 RedDot，由三态数据驱动而不是常亮
        this.unreadDot.setRedDot(view.state === MAIL_STATE_UNREAD ? 1 : 0);

        // 行底图：未读一张、已读/已领取一张
        const frame = view.state === MAIL_STATE_UNREAD ? art.unread : art.read;
        if (frame) this.background.spriteFrame = frame;
    }

    /** 整行藏掉（列表数据不足时由宿主调用）。 */
    hide(): void {
        this.node.active = false;
    }

    private emitOpen(): void {
        if (!this.mailId) return;
        this.onOpen?.(this.mailId);
    }

    private emitClaim(): void {
        if (!this.mailId) return;
        this.onClaim?.(this.mailId);
    }
}
