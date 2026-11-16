/**
 * 入盟申请行。行宽按底框 540×128；RejectBtn 发 agree=false，AgreeBtn 发 agree=true。
 * 按钮由行脚本绑定，虚拟列表复用时读取当前数据。
 */

import { _decorator, Button, Component, Label, Node, Sprite, SpriteFrame } from 'cc';
import type { ILeagueApplyView } from './LeagueTable';

const { ccclass, property } = _decorator;

/** 行内的两种审批动作（宿主据此发包）。 */
export type LeagueApplyAction = 'agree' | 'reject';

@ccclass('LeagueApplyRow')
export class LeagueApplyRow extends Component {
    @property({ type: Label, tooltip: 'lab_name：申请人名（26px 左对齐）' })
    nameLabel: Label = null;

    @property({ type: Label, tooltip: 'lab_lv：等级（纯数字，无后缀）' })
    levelLabel: Label = null;

    @property({ type: Label, tooltip: 'lab_power：战力（纯数字）' })
    powerLabel: Label = null;

    @property({ type: Sprite, tooltip: 'icon：头像（宿主按 view.img 取图后调 applyAvatar）' })
    avatarSprite: Sprite = null;

    @property({ type: Node, tooltip: 'btn_sure：同意（ 发 agree=true）' })
    agreeButton: Node = null;

    @property({ type: Node, tooltip: 'btn_kick：拒绝（ 名字叫 kick，语义是「拒绝」、发 agree=false）' })
    rejectButton: Node = null;

    /** 点「同意 / 拒绝」的回调（`view` 是**点击那一刻**这一槽位上的行数据）。 */
    onAction: ((action: LeagueApplyAction, view: ILeagueApplyView) => void) | null = null;

    /** 点头像的回调（老端 `CtrlMgr.CtrlPlayer.openOtherPlayerInfo(...)` —— 看申请人的信息）。 */
    onAvatar: ((view: ILeagueApplyView) => void) | null = null;

    /** 当前铺在这一行上的申请（`null` = 空槽）。 */
    private current: ILeagueApplyView | null = null;

    /** 头像令牌：每次 `render` 自增，用来作废在飞的头像结果。 */
    private avatarSeq = 0;

    private bound = false;

    protected onLoad(): void {
        this.bind();
    }

    /** 当前行的 `applyId`（没铺数据时为空串）。 */
    get applyId(): string {
        return this.current?.applyId ?? '';
    }

    /** 当前行的数据（供宿主在回调外用）。 */
    get view(): ILeagueApplyView | null {
        return this.current;
    }

    /**
     * 铺一行（所有状态**绝对赋值**）。
     *
     * 传 `null` 等价于藏掉整行 —— 数据不够时宿主可以直接 `render(null)`。
     */
    render(view: ILeagueApplyView | null): void {
        this.current = view;
        this.avatarSeq += 1;

        if (!view) {
            this.hide();
            return;
        }

        if (this.nameLabel) this.nameLabel.string = view.name;
        if (this.levelLabel) this.levelLabel.string = view.levelText;
        if (this.powerLabel) this.powerLabel.string = view.powerText;

        // 先清头像：槽位是复用的，不清的话新行会短暂顶着上一行的头像
        if (this.avatarSprite) this.avatarSprite.spriteFrame = null;
    }

    /** 本次铺行对应的头像令牌（宿主取图时带走，回来时原样交给 `applyAvatar`）。 */
    get avatarToken(): number {
        return this.avatarSeq;
    }

    /**
     * 头像异步返回时调用。
     *
     * 令牌对不上说明这个槽位已经被**下一行**占用了 ⇒ 直接丢弃，否则会把 A 的头像贴到 B 身上。
     */
    applyAvatar(frame: SpriteFrame | null, token: number): void {
        if (token !== this.avatarSeq) return;
        if (this.avatarSprite) this.avatarSprite.spriteFrame = frame;
    }

    /** 整行藏掉（列表数据不足时由宿主调用）。 */
    hide(): void {
        this.current = null;
        this.node.active = false;
    }

    /** 两个按钮 + 头像，各接一次（克隆体各绑自己的，`bound` 保证只绑一次）。 */
    private bind(): void {
        if (this.bound) return;
        this.bound = true;
        this.bindClick(this.agreeButton, () => this.emit('agree'));
        this.bindClick(this.rejectButton, () => this.emit('reject'));
        this.bindClick(this.avatarSprite ? this.avatarSprite.node : null, () => {
            const view = this.current;
            if (view && this.onAvatar) this.onAvatar(view);
        });
    }

    private bindClick(node: Node | null, handler: () => void): void {
        if (!node) {
            console.warn('[LeagueApplyRow] 行内某个可点节点缺失（生成器漏了？），该处点击不会生效');
            return;
        }
        const button = node.getComponent(Button);
        if (button) button.node.on(Button.EventType.CLICK, handler, this);
        else node.on(Node.EventType.TOUCH_END, handler, this);
    }

    /** 只有一个「点了什么」出口：空槽（`current === null`）时按一次不发。 */
    private emit(action: LeagueApplyAction): void {
        const view = this.current;
        if (!view) return;
        if (this.onAction) this.onAction(action, view);
    }
}
