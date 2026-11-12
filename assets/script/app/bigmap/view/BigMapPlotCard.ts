import { _decorator, Button, Component, Graphics, Label, Sprite, SpriteFrame, UITransform } from 'cc';
import { EventMgr } from '../../../framework/event/EventMgr';
import { BigMapUiEvent, type BigMapIntent } from '../application/BigMapEvents';
import { drawBigMapCardPanel } from './BigMapSkin';
import { formatBigMapDuration } from './BigMapPresentationText';

const { ccclass, property } = _decorator;

/** 二次确认时主按钮的文案（第一次点变成它，第二次点才执行）。 */
const CONFIRM_CANCEL_TEXT = '确认取消？';
const CONFIRM_UPGRADE_TEXT = '确认升级？';

/** 卡片上的一颗按钮：文案 + 可用性（不可用时给原因，不只置灰）。 */
export interface IBigMapPlotCardAction {
    readonly text: string;
    readonly enabled: boolean;
}

/** 建筑卡的完整展示数据（Presenter 算好，视图只写节点）。 */
export interface IBigMapPlotCardContent {
    readonly name: string;
    readonly level: number;
    readonly targetLevel: number;
    /** 改版后的详情正文（产量对比 / 消耗 / 耗时 / 前置 / 原因）。 */
    readonly body: string;
    readonly icon: SpriteFrame | null;
    readonly busy: boolean;
    readonly remainSeconds: number;
    readonly primary: IBigMapPlotCardAction | null;
    readonly secondary: IBigMapPlotCardAction | null;
}

/**
 * 基地建筑卡 —— **非模态**贴底卡，替代原先的居中 `BigMapInfoPopup`。
 *
 * ## 为什么不是 `PopupBase`
 *
 * `PopupBase` 自带 `__BlankClose` 空白接收层 + `Dim` 暗底，**会把地图整块挡住**，
 * 玩家想「升完这座顺手点下一座」必须先关弹窗。而这一层的目的恰恰是"地图不下线"，
 * 所以它只是 `BigMapPageLayout` 下的一个普通节点，层级与队列条同级。
 *
 * ## 关闭方式
 *
 * 非模态没有"点空白关闭"的天然时机，所以：
 * - 卡右上角一颗 ✕；
 * - 地图上点空地（`BigMapBaseView` 发 `clear`）；
 * - 点另一座建筑（直接换内容，不重播入场）。
 *
 * ## 布局
 *
 * 卡面用 `drawBigMapCardPanel` 手画（近黑描边 → 深板岩底 → 铜金细线），
 * 与资源条 / 队列条 / 城池弹窗同一套语法。贴底间距在 `BigMapPageLayout` 里按导航高算，
 * 与 `modeNode` / `exploreButton` 一致 —— 不在 prefab 里写死 `bottom`。
 */
@ccclass('BigMapPlotCard')
export class BigMapPlotCard extends Component {
    @property(Graphics) private background: Graphics = null!;
    @property(Sprite) private thumbnail: Sprite = null!;
    @property(Label) private title: Label = null!;
    @property(Label) private status: Label = null!;
    @property(Label) private body: Label = null!;
    @property(Button) private primaryButton: Button = null!;
    @property(Label) private primaryLabel: Label = null!;
    @property(Button) private secondaryButton: Button = null!;
    @property(Label) private secondaryLabel: Label = null!;
    @property(Button) private closeButton: Button = null!;

    private content: IBigMapPlotCardContent | null = null;
    private painted = false;
    /**
     * 主按钮的「确认态」：第一次点只把文案改成「确认取消？/ 确认升级？」，第二次点才真执行。
     *
     * 这两个动作误触没有回头路 —— 取消建造白等一次建造时间，升级直接扣粮木铁。
     * 状态只活在卡片里、不进 controller，也不用定时器：换选中、收卡、再点一次都会复位。
     */
    private confirmPending = false;

    protected onLoad(): void {
        this.paintBackground();
        this.primaryButton.node.on(Button.EventType.CLICK, this.handlePrimary, this);
        this.secondaryButton.node.on(Button.EventType.CLICK, this.handleSecondary, this);
        this.closeButton.node.on(Button.EventType.CLICK, this.handleClose, this);
    }

    /**
     * 卡底只画一次：尺寸在 prefab 里是固定的（692×168），不必每帧重建 Graphics
     * （`Graphics` 每次重画都会重建顶点缓冲，500ms 一次的全量 refresh 里做这件事纯属浪费）。
     */
    private paintBackground(): void {
        if (this.painted) return;
        const transform = this.node.getComponent(UITransform);
        if (!transform) return;
        drawBigMapCardPanel(this.background, transform.width, transform.height);
        this.painted = true;
    }

    /** 全量覆盖：每次把每个槽位写一遍，不留上一座建筑的残值（复用同一实例）。 */
    render(content: IBigMapPlotCardContent | null): void {
        // 换了一座建筑 / 等级变了 ⇒ 上一次的「确认？」作废，否则会把 A 的确认态带到 B 身上。
        if (this.confirmPending && (!content || !this.content
            || content.name !== this.content.name || content.level !== this.content.level)) {
            this.confirmPending = false;
        }
        this.content = content;
        if (!content) return;
        this.paintBackground();
        this.title.string = content.level > 0
            ? (content.busy
                ? `${content.name}  Lv.${content.level} → ${content.targetLevel}`
                : `${content.name}  Lv.${content.level}`)
            : `${content.name}  建造中`;
        this.status.string = content.busy && content.remainSeconds > 0
            ? `剩余 ${formatBigMapDuration(content.remainSeconds)}` : '';
        this.status.node.active = this.status.string !== '';
        this.body.string = content.body;
        this.thumbnail.spriteFrame = content.icon;
        this.thumbnail.node.active = !!content.icon;
        if (this.confirmPending) {
            // `render` 每 500ms 跑一遍，不挡住的话「确认取消？」会被立刻冲回「取消建造」。
            this.primaryLabel.string = content.busy ? CONFIRM_CANCEL_TEXT : CONFIRM_UPGRADE_TEXT;
        } else {
            this.renderAction(this.primaryButton, this.primaryLabel, content.primary);
        }
        this.renderAction(this.secondaryButton, this.secondaryLabel, content.secondary);
    }

    /** 拿最近一次的展示数据（页面侧判断"当前卡上是哪座建筑"用，不参与渲染）。 */
    get rendered(): IBigMapPlotCardContent | null { return this.content; }

    private renderAction(button: Button, label: Label, action: IBigMapPlotCardAction | null): void {
        button.node.active = action !== null;
        label.string = action?.text ?? '';
        button.interactable = action?.enabled ?? false;
    }

    private sendIntent(intent: BigMapIntent): void {
        EventMgr.instance.emit(BigMapUiEvent.Intent, { intent });
    }

    /**
     * 主按钮两段式：第一下只把文案切成「确认取消？/ 确认升级？」，第二下才真发意图。
     *
     * 这两个动作误触没有回头路（取消建造白等一次建造时间、升级直接扣粮木铁），
     * 而居中确认弹窗会挡住地图、打断连点节奏 —— 就地改文案既拦住了误触，也不打断操作。
     */
    private handlePrimary(): void {
        const content = this.content;
        if (!content?.primary || !content.primary.enabled) return;
        if (!this.confirmPending) {
            this.confirmPending = true;
            this.primaryLabel.string = content.busy ? CONFIRM_CANCEL_TEXT : CONFIRM_UPGRADE_TEXT;
            return;
        }
        this.confirmPending = false;
        this.sendIntent({ kind: 'primary' });
    }
    private handleSecondary(): void { this.sendIntent({ kind: 'secondary' }); }
    /** ✕ 与「点地图空地」等价：清掉选中，让卡一起收起来。 */
    private handleClose(): void { this.sendIntent({ kind: 'clear' }); }
}
