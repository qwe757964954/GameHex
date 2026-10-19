import { _decorator, Color, Component, Graphics, Label, Node, Sprite, UITransform } from 'cc';
import type { ZCSpawnSelectionSnapshot } from '../model/ZCSpawnSelection';
import { ZCGameUiEvent } from './ZCGameHudEvents';
import { EventMgr } from '../../../framework/event/EventMgr';

const { ccclass, property } = _decorator;

/** 倒计时总时长（秒），进度条按它归一化。 */
const COUNTDOWN_SECONDS = 10;

/**
 * 顶栏文案的**两个** y（同一 prefab 的两态）：
 * 选择态是**三行式**（① 倒计时数字 ② 标题 ③ 进度条），标题落在第二行；
 * 等待态数字与进度条都收掉、只剩这一行字，回到**垂直居中**。
 */
export const SPAWN_HINT_PICKING_Y = -9;
export const SPAWN_HINT_CENTER_Y = 0;

/**
 * 视图只**派发意图事件**（{@link ZCGameUiEvent}，在 {@link events} 上 `emit`）：
 * 「确认落点」「切换提示显隐」由控制器 `ZCGame` 订阅后处理。
 */

/**
 * 自选主城（落点选择）阶段的常驻 HUD：顶部信息带 + 绿勾 + 左下「收回提示」+ 吐司。
 *
 * 节点树、尺寸、静态样式与**全部美术引用**都声明在 `ZCSpawnSelection.prefab` 里
 * （蓝湖「落点选择」稿，画布 720×1610，切图 1:1 落在 `image/gameui/`），代码只按状态刷
 * 「文案 / 数字 / 进度 / 显隐 / 染色」。
 *
 * 两态口径（同一 prefab）：
 *
 * | | 选择态（落点选择） | 等待态（落点选择2） |
 * |---|---|---|
 * | 倒计时数字（第一行，48 号） | 显示 @ +35 | **隐藏** |
 * | 标题（第二行，30 号） | 「选择己方主城位置」@ -9 | 「等待其他玩家」@ 0（居中） |
 * | 进度条（第三行） | 显示 @ -46 | **隐藏** |
 * | 绿勾 | 显示 | **隐藏** |
 * | 左下「收回提示」 | 显示 | 显示 |
 */
@ccclass('ZCSpawnSelectionView')
export class ZCSpawnSelectionView extends Component {
    
    /** 吐司底（设计稿没有吐司，这是即时反馈通道，保留）。 */
    private static readonly TOAST_PANEL = new Color(22, 31, 45, 244);
    /** 吐司圆角 = `min(26, 高度/4)`。 */
    private static readonly PANEL_CORNER_RADIUS = 26;
    /** 吐司停留时长（秒）。 */
    private static readonly TOAST_VISIBLE_SECONDS = 1.8;

    /** 顶栏文案只有两条（设计稿「落点选择」/「落点选择2」各一条）。 */
    private static readonly SPAWN_HINT_TEXTS: Readonly<Record<'picking' | 'waiting', string>> = {
        picking: '选择己方主城位置',
        waiting: '等待其他玩家',
    };

    /** 倒计时 ≤ 该秒数时数字转红。 */
    private static readonly SPAWN_URGENT_SECONDS = 3;

    /** 倒计时 / 确认勾染色（沿用旧客户端配色）。 */
    private static readonly WHITE = new Color(255, 255, 255, 255);
    private static readonly URGENT = new Color(235, 92, 92, 255);
    /** 绿勾三态（设计稿只画了「可确认」，另两态靠染色表达，原因一律由吐司说明）。 */
    private static readonly CONFIRM_READY = new Color(255, 255, 255, 255);
    private static readonly CONFIRM_INVALID = new Color(176, 96, 96, 255);
    private static readonly CONFIRM_IDLE = new Color(128, 136, 150, 255);

    @property({ type: Label, group: '节点引用', tooltip: 'SpawnInfoBand/Hint：顶栏文案' })
    hintLabel: Label = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'SpawnInfoBand/Clock：剩余秒数' })
    clockLabel: Label = null!;

    @property({ type: Node, group: '节点引用', tooltip: 'SpawnInfoBand/Progress：整条进度（等待态隐藏）' })
    progressNode: Node = null!;

    @property({ type: Sprite, group: '节点引用', tooltip: 'SpawnInfoBand/Progress/ProgressFill：FILLED 填充' })
    progressFill: Sprite = null!;

    @property({ type: Node, group: '节点引用', tooltip: 'ConfirmSpawn：确认落点（等待态隐藏）' })
    confirmButton: Node = null!;

    @property({ type: Sprite, group: '节点引用', tooltip: 'ConfirmSpawn 上的绿勾（按状态染色）' })
    confirmIcon: Sprite = null!;

    @property({ type: Node, group: '节点引用', tooltip: 'ToggleHints：收起/显示提示' })
    toggleButton: Node = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'ToggleHints/Label' })
    toggleLabel: Label = null!;

    @property({ type: Node, group: '节点引用', tooltip: 'ToggleHints/Arrow：收起/展开箭头' })
    toggleArrow: Node = null!;

    @property({ type: Node, group: '节点引用', tooltip: 'SpawnToast：只在 flash() 期间 active' })
    toastNode: Node = null!;

    @property({ type: Graphics, group: '节点引用' })
    toastBackground: Graphics = null!;

    @property({ type: Label, group: '节点引用' })
    toastLabel: Label = null!;

    initialize(): void {
        // 监听一律「具名方法 + this target」（规范 §7.5 配套第 3 条）：不内联箭头闭包 ——
        // 箭头闭包在调用栈里没有名字，将来要 off 也没有稳定函数引用可传。
        // 失效态仍然接收点击，由状态机给出「为什么失效」；未选择态同样给明确反馈。
        this.toggleButton.on(Node.EventType.TOUCH_END, this.onToggleHintsClick, this);
        this.confirmButton.on(Node.EventType.TOUCH_END, this.onConfirmClick, this);
        this.drawToastBackground();
        this.toastNode.active = false;
    }

    private onConfirmClick(): void {
        EventMgr.instance.emit(ZCGameUiEvent.SpawnConfirm);
    }

    private onToggleHintsClick(): void {
        EventMgr.instance.emit(ZCGameUiEvent.SpawnToggleHints);
    }

    render(snapshot: ZCSpawnSelectionSnapshot, hintsVisible: boolean): void {
        const mine = snapshot.selections.player;
        // 已确认 = 进入「等待其他玩家」那一帧（设计稿「落点选择2」）。
        const waiting = mine.confirmedHexId !== null;

        this.hintLabel.string = waiting
            ? ZCSpawnSelectionView.SPAWN_HINT_TEXTS.waiting
            : ZCSpawnSelectionView.SPAWN_HINT_TEXTS.picking;
        // 等待态只剩一行字，按设计稿垂直居中；选择态落在三行式的第二行（数字在上、进度条在下）。
        this.hintLabel.node.setPosition(0, waiting ? SPAWN_HINT_CENTER_Y : SPAWN_HINT_PICKING_Y, 0);

        const urgent = !waiting && snapshot.remainingSeconds <= ZCSpawnSelectionView.SPAWN_URGENT_SECONDS;
        this.clockLabel.node.active = !waiting;
        this.clockLabel.string = String(Math.max(0, Math.ceil(snapshot.remainingSeconds)));
        this.clockLabel.color = urgent ? ZCSpawnSelectionView.URGENT : ZCSpawnSelectionView.WHITE;

        this.progressNode.active = !waiting;
        const ratio = snapshot.remainingSeconds / COUNTDOWN_SECONDS;
        this.progressFill.fillRange = Math.max(0, Math.min(1, ratio));

        this.confirmButton.active = !waiting;
        const invalid = mine.selectedHexId !== null && mine.invalidReason !== null;
        const ready = mine.selectedHexId !== null && !invalid;
        this.confirmIcon.color = invalid
            ? ZCSpawnSelectionView.CONFIRM_INVALID
            : ready ? ZCSpawnSelectionView.CONFIRM_READY : ZCSpawnSelectionView.CONFIRM_IDLE;

        this.toggleLabel.string = hintsVisible ? '收回提示' : '显示提示';
        // 箭头在「收起」时朝上（设计稿那一帧就是 ∧），切到「显示提示」翻转 180°。
        this.toggleArrow.setRotationFromEuler(0, 0, hintsVisible ? 0 : 180);
    }

    flash(message: string): void {
        this.toastLabel.string = message;
        this.toastNode.active = true;
        this.unschedule(this.hideToast);
        this.scheduleOnce(this.hideToast, ZCSpawnSelectionView.TOAST_VISIBLE_SECONDS);
    }

    protected onDestroy(): void {
        this.unschedule(this.hideToast);
    }

    /** 吐司底：尺寸与圆角都从 prefab 上那个节点的 `UITransform` 读，代码不存宽高。 */
    private drawToastBackground(): void {
        const { width, height } = this.toastBackground.node.getComponent(UITransform)!.contentSize;
        const radius = Math.min(ZCSpawnSelectionView.PANEL_CORNER_RADIUS, height / 4);
        this.toastBackground.clear();
        this.toastBackground.fillColor = ZCSpawnSelectionView.TOAST_PANEL;
        this.toastBackground.roundRect(-width / 2, -height / 2, width, height, radius);
        this.toastBackground.fill();
    }

    private hideToast = (): void => {
        this.toastNode.active = false;
    };
}
