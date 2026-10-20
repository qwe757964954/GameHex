import { _decorator, Component, Label, Node, Sprite, SpriteFrame } from 'cc';
import { ChestSlotAction, ChestSlotState, IChestSlotData } from './ChestTypes';

const { ccclass, property } = _decorator;

/**
 * 宝箱**单格**（`ui/main/ChestSlot.prefab`）。
 *
 * 两种形态共用一套节点，靠显隐切：
 * | | 宝箱态（Counting / Ready） | 空槽态（Empty） |
 * |---|---|---|
 * | Card | 蓝 / 金卡 | 空槽卡 |
 * | Box / NameLabel / Timer | 显示 | 隐藏 |
 * | EmptyLabel / Cost | 隐藏 | 显示 |
 */
@ccclass('ChestSlotView')
export class ChestSlotView extends Component {
    @property({ type: Sprite, tooltip: 'Card：卡片底（蓝 / 金 / 空槽三选一）' })
    card: Sprite = null!;

    @property({ type: Node, tooltip: 'Timer：顶部计时条容器' })
    timer: Node = null!;

    @property({ type: Sprite, tooltip: 'Timer/TimeBg/TimeFill：进度填充（FILLED）' })
    timeFill: Sprite = null!;

    @property({ type: Label, tooltip: 'Timer/TimeText：剩余时间文本' })
    timeText: Label = null!;

    @property({ type: Sprite, tooltip: 'Box：宝箱图' })
    box: Sprite = null!;

    @property({ type: Label, tooltip: 'NameLabel：宝箱名字' })
    nameLabel: Label = null!;

    @property({ type: Label, tooltip: 'EmptyLabel：「空槽位」' })
    emptyLabel: Label = null!;

    @property({ type: Node, tooltip: 'Cost：闪电 + 体力数字（空槽态）' })
    cost: Node = null!;

    @property({ type: Label, tooltip: 'Cost/Count：体力数字' })
    costLabel: Label = null!;

    @property({ type: Sprite, tooltip: 'Btn：按钮底（金 / 蓝 / 绿三选一）' })
    btn: Sprite = null!;

    @property({ type: Label, tooltip: 'Btn/BtnLabel：按钮文案' })
    btnLabel: Label = null!;

    /** 三张卡底 + 三张按钮底，由 `ChestBar` 在装配时灌进来。 */
    private static cardFrames: { blue: SpriteFrame | null; gold: SpriteFrame | null; empty: SpriteFrame | null } =
        { blue: null, gold: null, empty: null };
    private static btnFrames: { gold: SpriteFrame | null; blue: SpriteFrame | null; green: SpriteFrame | null } =
        { gold: null, blue: null, green: null };

    private onAction: (() => void) | null = null;

    /** 由宿主一次性注入美术（三张卡底 / 三张按钮底）。 */
    static setArt(
        cards: { blue: SpriteFrame | null; gold: SpriteFrame | null; empty: SpriteFrame | null },
        buttons: { gold: SpriteFrame | null; blue: SpriteFrame | null; green: SpriteFrame | null },
    ): void {
        ChestSlotView.cardFrames = { ...cards };
        ChestSlotView.btnFrames = { ...buttons };
    }

    onLoad(): void {
        this.node.on(Node.EventType.TOUCH_END, this.handleAction, this);
    }

    bindAction(handler: (() => void) | null): void {
        this.onAction = handler;
    }

    private handleAction(): void {
        this.onAction?.();
    }

    /** 全量赋值（幂等）。 */
    render(data: IChestSlotData): void {
        const empty = data.state === ChestSlotState.Empty;

        // 卡片 / 按钮底：两态都绝对赋值
        //  空槽 → 空槽卡；倒计时中 → 蓝卡；其余（可开启 / 未解锁）→ 金卡。设计稿「塔防主界面-2」口径。
        const cardFrame = empty ? ChestSlotView.cardFrames.empty
            : (data.state === ChestSlotState.Counting ? ChestSlotView.cardFrames.blue : ChestSlotView.cardFrames.gold);
        if (cardFrame) this.card.spriteFrame = cardFrame;

        const btnFrame = data.action === ChestSlotAction.Battle ? ChestSlotView.btnFrames.blue
            : (data.action === ChestSlotAction.SpeedUp ? ChestSlotView.btnFrames.green : ChestSlotView.btnFrames.gold);
        if (btnFrame) this.btn.spriteFrame = btnFrame;

        // 显隐
        this.box.node.active = !empty;
        this.nameLabel.node.active = !empty;
        this.timer.active = !empty && data.state === ChestSlotState.Counting;
        if (this.emptyLabel) this.emptyLabel.node.active = empty;
        if (this.cost) this.cost.active = empty && data.cost > 0;

        // 文案
        if (!empty) this.nameLabel.string = data.name;
        if (this.costLabel) this.costLabel.string = String(data.cost);
        this.btnLabel.string = ChestSlotView.actionText(data);
        this.btnLabel.isBold = data.action === ChestSlotAction.Battle || data.action === ChestSlotAction.SpeedUp;

        // 计时：进度 = 剩余 / 总时长；文本 = HH:MM:SS
        if (this.timer.active) {
            const total = data.totalSeconds > 0 ? data.totalSeconds : 1;
            const ratio = Math.max(0, Math.min(1, data.remainSeconds / total));
            if (this.timeFill) this.timeFill.fillRange = ratio;
            if (this.timeText) this.timeText.string = ChestSlotView.formatRemain(data.remainSeconds);
        }
    }

    private static actionText(data: IChestSlotData): string {
        if (data.action === ChestSlotAction.Battle) return '开始战斗';
        if (data.action === ChestSlotAction.SpeedUp) return '-30分钟';
        if (data.action === ChestSlotAction.Activate) return '开启';
        return '开启';
    }

    /**
     * 秒 → 计时文本。
     *
     * 设计稿口径：**整小时显示 `24h`**（卡1 那颗），非整点才走 `HH:MM:SS`（卡4 的 `04:11:05`）；
     * 超过 24h 也照常进位，不显示天数。
     */
    static formatRemain(seconds: number): string {
        const total = Math.max(0, Math.floor(seconds));
        if (total >= 3600 && total % 3600 === 0) return `${total / 3600}h`;
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        const pad = (value: number): string => (value < 10 ? `0${value}` : String(value));
        return `${pad(h)}:${pad(m)}:${pad(s)}`;
    }
}
