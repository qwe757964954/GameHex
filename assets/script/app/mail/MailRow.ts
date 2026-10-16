/**
 * 「邮件」列表里的**一行**（`575×170`）。
 *
 * 结构逐节点对齐 FGUI `邮件/组件/组件_邮件_主界面Item.xml`：
 *
 * | FGUI 节点 | 本节点 | 说明 |
 * |---|---|---|
 * | `n21` loader | 本节点 `cc.Sprite` | 行底图 —— **三态换图**（见下） |
 * | `n24` | `Deco` | 左侧信纸装饰（`ml_mail_deco`） |
 * | `n25` | `MailIcon` | 信封图标（`ml_mail_icon`） |
 * | `文本_标题` | `Title` | 邮件标题 |
 * | `文本_时间` | `Time` | 相对时间（右对齐，`pivot 0,0.5` ⇒ 左边缘固定） |
 * | `状态` | `State` | 「已读」（`pivot 1,0.5` ⇒ **右边缘固定**） |
 * | `n26` | `TakenStamp` | 「已领取」印章（`ml_taken_stamp`） |
 * | ~~`com_rd`~~ | — | 红点：**本轮不接**（见 `tmp/_mail_nodes.md`） |
 *
 * ## 三态（FGUI `controller 状态`）
 *
 * | state | 行底图 | `State` 文本 | `TakenStamp` |
 * |---|---|---|---|
 * | 0 未读 | `frame_Zhikuang06`（`friend/fd_row_bg`） | 隐藏 | 隐藏 |
 * | 1 已读 | `frame_Zhikuang06_b`（`mail/ml_row_bg_read`） | 「已读」 | 隐藏 |
 * | 2 已领取 | 同上（`_b` 版） | **隐藏**（`gearText` 改的那支被 `gearDisplay` 挡掉） | 显示 |
 *
 * ⚠️ 整行会被虚拟列表 **clone 复用** ⇒ `render()` 里每一处都要**绝对赋值**
 *   （记忆规则 10：条件式赋值会让上一行的状态串到下一行）。
 *   最容易漏的是 `State` 的 `active` 与 `TakenStamp` 的 `active`。
 *
 * ⚠️ 行底图由**宿主预加载好再传进来**（`IMailRowArt`）：在这里现加载会先闪一帧上一行的图
 *   （`VScrollView` 回收残影缺陷，与 `ActivityRewardSlot` 同款口径）。
 */

import { _decorator, Button, Component, Label, Node, Sprite, SpriteFrame } from 'cc';
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
    background: Sprite = null!;

    @property({ type: Sprite, tooltip: 'Deco：左侧信纸装饰（`ml_mail_deco`，静态）' })
    deco: Sprite = null!;

    @property({ type: Sprite, tooltip: 'MailIcon：信封图标（`ml_mail_icon`，静态）' })
    mailIcon: Sprite = null!;

    @property({ type: Label, tooltip: 'Title：邮件标题' })
    titleLabel: Label = null!;

    @property({ type: Label, tooltip: 'Time：相对时间' })
    timeLabel: Label = null!;

    @property({ type: Label, tooltip: 'State：状态文本（只有「已读」显示）' })
    stateLabel: Label = null!;

    @property({ type: Node, tooltip: 'TakenStamp：「已领取」印章（只有已领取显示）' })
    takenStamp: Node = null!;

    @property({ type: Button, tooltip: '本节点：整行可点（打开详情）' })
    button: Button = null!;

    /**
     * 打开详情回调 —— **由宿主在每次铺行时重设**（`MailPage.renderRow`）。
     * ⚠️ 不能在 `render()` 里绑监听：同一个实例会被复用到别的下标，
     *    回调里必须按当前行现取 id，否则会「点第 3 行打开第 1 封」。
     */
    onOpen: ((id: string) => void) | null = null;

    /** 当前渲染的是哪一封（回调里用）—— 每次 `render` 覆盖。 */
    private viewId = '';

    protected onLoad(): void {
        this.button?.node.on(Button.EventType.CLICK, this.emitOpen, this);
    }

    /** 铺一行（所有状态绝对赋值）。 */
    render(view: IMailRowView, art: IMailRowArt): void {
        this.viewId = view.id;

        this.titleLabel.string = view.title;
        this.timeLabel.string = view.timeText;

        // 状态文本：未读 / 已领取都是空串 ⇒ 必须同时关节点（否则上一行的「已读」会留着）
        // 「哪一态显示文本 / 印章」由 `MailArt` 出（口径唯一，别在这里复述那张表）
        this.stateLabel.string = view.stateText;
        this.stateLabel.node.active = mailStateTextVisible(view.state);

        // 印章：只有「已领取」显示
        this.takenStamp.active = mailStampVisible(view.state);

        // 行底图：未读一张、已读/已领取一张
        const frame = view.state === MAIL_STATE_UNREAD ? art.unread : art.read;
        if (frame) this.background.spriteFrame = frame;
    }

    /** 整行藏掉（列表数据不足时由宿主调用）。 */
    hide(): void {
        this.node.active = false;
    }

    private emitOpen(): void {
        if (!this.viewId) return;
        this.onOpen?.(this.viewId);
    }
}
