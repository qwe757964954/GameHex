import { _decorator, Button, Component, Label, Node, Sprite, SpriteFrame, UITransform } from 'cc';
import { EventMgr } from '../../framework/event/EventMgr';
import { CHEST_EVENTS } from './ChestEvents';
import { ChestSlotAction, ChestSlotState, IChestSlotData } from './ChestTypes';

const { ccclass, property } = _decorator;
const CHEST_SPEED_UP_TEXT_X = 16;
const CHEST_SPEED_UP_TEXT_SPACING = 2;
const CHEST_CLOCK_WIDTH = 26;
const CHEST_TIMER_GAP = 4;
const CHEST_TIME_TEXT_MAX_WIDTH = 107;
const CHEST_TIME_TEXT_HEIGHT = 24;
const CHEST_PROGRESS_X = 15;
const CHEST_COUNTING_CLOCK_X = -57;
const CHEST_PROGRESS_SCALE_X = 0.78;

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

    @property({ type: Node, tooltip: 'Timer/TimeBg：仅激活倒计时中显示的进度条' })
    timeBg: Node = null!;

    @property({ type: Node, tooltip: 'Timer/Clock：闹钟图标' })
    clock: Node = null!;

    @property({ type: Sprite, tooltip: 'Timer/TimeBg/TimeFill：进度填充（FILLED）' })
    timeFill: Sprite = null!;

    @property({ type: Label, tooltip: 'Timer/TimeText：剩余时间文本' })
    timeText: Label = null!;

    @property({ type: UITransform, tooltip: 'Timer/TimeText：时间文本布局' })
    timeTextTransform: UITransform = null!;

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

    @property({ type: Node, tooltip: 'Btn/SpeedUpIcon：加速按钮的视频图标' })
    speedUpIcon: Node = null!;

    /** 三张卡底 + 三张按钮底，由 `ChestBar` 在装配时灌进来。 */
    private static cardFrames: { blue: SpriteFrame | null; gold: SpriteFrame | null; empty: SpriteFrame | null } =
        { blue: null, gold: null, empty: null };
    private static btnFrames: { gold: SpriteFrame | null; blue: SpriteFrame | null; green: SpriteFrame | null } =
        { gold: null, blue: null, green: null };

    /** 本格在界面数组里的下标（点击时随事件回传；服务端 `item.index` 是 1~4，不是它）。 */
    private dataIndex = -1;
    /** 这一格现在能不能点。**门闩用布尔字段**，不拿「回调有没有值」当门闩（规范 §2.1）。 */
    private actionEnabled = false;

    /** 由宿主一次性注入美术（三张卡底 / 三张按钮底）。 */
    static setArt(
        cards: { blue: SpriteFrame | null; gold: SpriteFrame | null; empty: SpriteFrame | null },
        buttons: { gold: SpriteFrame | null; blue: SpriteFrame | null; green: SpriteFrame | null },
    ): void {
        ChestSlotView.cardFrames = { ...cards };
        ChestSlotView.btnFrames = { ...buttons };
    }

    onLoad(): void {
        // cc.Button 会停止触摸事件冒泡，必须监听实际按钮的 CLICK。
        this.btn.node.on(Button.EventType.CLICK, this.handleAction, this);
    }

    private handleAction(): void {
        if (!this.actionEnabled) return;
        EventMgr.instance.emit(CHEST_EVENTS.SLOT_ACTION, this.dataIndex);
    }

    /** 全量赋值；空槽仅在被宝箱栏选为战斗入口时显示按钮及消耗。 */
    render(data: IChestSlotData, showBattleEntry = true, dataIndex = -1): void {
        const empty = data.state === ChestSlotState.Empty;
        const isUnactivated = data.action === ChestSlotAction.Activate;
        const isCounting = data.state === ChestSlotState.Counting;
        const isSpeedUp = data.action === ChestSlotAction.SpeedUp;

        // 蓝卡表示尚未完成等待（未激活或倒计时中），金卡表示等待结束可开。
        const cardFrame = empty ? ChestSlotView.cardFrames.empty
            : (isUnactivated || isCounting ? ChestSlotView.cardFrames.blue : ChestSlotView.cardFrames.gold);
        if (cardFrame) this.card.spriteFrame = cardFrame;

        const btnFrame = data.action === ChestSlotAction.Battle ? ChestSlotView.btnFrames.blue
            : (data.action === ChestSlotAction.SpeedUp ? ChestSlotView.btnFrames.green : ChestSlotView.btnFrames.gold);
        if (btnFrame) this.btn.spriteFrame = btnFrame;

        // 显隐
        this.box.node.active = !empty;
        this.nameLabel.node.active = !empty;
        this.timer.active = !empty && (isUnactivated || isCounting);
        this.timeBg.active = !empty && isCounting;
        this.speedUpIcon.active = isSpeedUp;
        const hasButton = !empty || showBattleEntry;
        this.btn.node.active = hasButton;
        this.dataIndex = dataIndex;
        this.actionEnabled = hasButton;
        if (this.emptyLabel) this.emptyLabel.node.active = empty;
        if (this.cost) this.cost.active = empty && showBattleEntry && data.cost > 0;

        // 文案
        if (!empty) this.nameLabel.string = data.name;
        if (this.costLabel) this.costLabel.string = String(data.cost);
        this.btnLabel.string = ChestSlotView.actionText(data);
        this.btnLabel.isBold = true;
        this.btnLabel.node.setPosition(isSpeedUp ? CHEST_SPEED_UP_TEXT_X : 0, 0, 0);
        this.btnLabel.spacingX = isSpeedUp ? CHEST_SPEED_UP_TEXT_SPACING : 0;

        this.timeBg.setPosition(CHEST_PROGRESS_X, 0, 0);
        this.timeBg.setScale(CHEST_PROGRESS_SCALE_X, 1, 1);
        if (this.timer.active) {
            const total = data.totalSeconds > 0 ? data.totalSeconds : 1;
            const ratio = Math.max(0, Math.min(1, 1 - data.remainSeconds / total));
            this.timeFill.fillRange = isCounting ? ratio : 0;
            this.timeText.string = isCounting
                ? ChestSlotView.formatCountdown(data.remainSeconds)
                : ChestSlotView.formatRemain(data.totalSeconds);
            let textWidth = CHEST_TIME_TEXT_MAX_WIDTH;
            if (isUnactivated) {
                // h/m/s 文本长短不同，按本帧真实字宽将图标和文字整体居中。
                this.timeText.overflow = Label.Overflow.NONE;
                this.timeText.updateRenderData(true);
                textWidth = Math.min(this.timeTextTransform.width, CHEST_TIME_TEXT_MAX_WIDTH);
            }
            this.timeText.overflow = Label.Overflow.SHRINK;
            this.timeTextTransform.setContentSize(textWidth, CHEST_TIME_TEXT_HEIGHT);
            this.clock.setPosition(isCounting ? CHEST_COUNTING_CLOCK_X : -(textWidth + CHEST_TIMER_GAP) / 2, 0, 0);
            this.timeText.node.setPosition(isCounting ? CHEST_PROGRESS_X : (CHEST_CLOCK_WIDTH + CHEST_TIMER_GAP) / 2, 0, 0);
        }
    }

    private static actionText(data: IChestSlotData): string {
        if (data.action === ChestSlotAction.Battle) return '开始战斗';
        if (data.action === ChestSlotAction.SpeedUp) return '-30分钟';
        if (data.action === ChestSlotAction.Activate) return '开启';
        return '开启';
    }

    /** 秒 → 紧凑英文时长；省略为零的单位，超过 24 小时继续累计小时。 */
    static formatRemain(seconds: number): string {
        const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        const secondsRemaining = total % 60;
        const parts: string[] = [];
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        if (secondsRemaining > 0 || parts.length === 0) parts.push(`${secondsRemaining}s`);
        return parts.join(' ');
    }

    /** 激活后的剩余时间固定时分秒，超过一天累计小时。 */
    static formatCountdown(seconds: number): string {
        const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
        return [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60]
            .map((part) => String(part).padStart(2, '0')).join(':');
    }
}
