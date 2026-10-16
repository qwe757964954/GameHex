import { _decorator, Component, Label, Node, SpriteFrame } from 'cc';
import { GiftRewardSlot } from './GiftRewardSlot';

const { ccclass, property } = _decorator;

/**
 * 每日充值页**顶部一档累计阶段格**（90×90，实例 `scale = 0.8`）。
 *
 * 结构对齐 FGUI `礼包/组件/子页面/每日充值页面/组件_礼包_每日充值阶段item.xml`：
 *   `Frame`（`frame_03_9gong` 底条，挂在格子下沿）+ `Goods`（奖励格，复用 `GiftRewardSlot`）
 *   + `DayLabel`（「累计 N 天」）+ `ClaimTip`（「可领奖」，仅 `claimable`）
 *   + `CheckMark`（`shaixuan_duigou` 对勾，仅 `taken`）。
 *
 * 三态：`locked`（未达标）/ `claimable`（达标未领）/ `taken`（已领）。
 * 文案一律**由宿主传进来**（`GiftTexts.RECHARGE_TEXTS` 是唯一出口），本类零中文字面量。
 */
export type RechargeStageState = 'locked' | 'claimable' | 'taken';

@ccclass('RechargeDailyStage')
export class RechargeDailyStage extends Component {
    @property({ type: GiftRewardSlot, tooltip: 'Goods：奖励格（本节点 Sprite 是品质框，子节点 Icon 是道具图）' })
    goods: GiftRewardSlot = null!;

    @property({ type: Label, tooltip: 'DayLabel：下方天数文案（如「累计 2 天」）' })
    dayLabel: Label = null!;

    @property({ type: Node, tooltip: 'ClaimTip：可领奖文字（默认隐藏）' })
    claimTip: Node = null!;

    @property({ type: Node, tooltip: 'CheckMark：已领奖对勾（默认隐藏）' })
    checkMark: Node = null!;

    /** 宿主点这一格时回调（只有 `claimable` 态才真的派发）。 */
    onAction: (() => void) | null = null;

    /** 本格状态（宿主可取，避免再判一次）。 */
    private stageState: RechargeStageState = 'locked';

    get state(): RechargeStageState {
        return this.stageState;
    }

    /**
     * ⚠️ 这一格在 prefab 上**没有 `cc.Button`**（FGUI 原稿也没给它加），所以直接听节点的
     * `TOUCH_END`。节点有 `cc.UITransform`（90×90）⇒ 命中检测正常。
     */
    protected onLoad(): void {
        this.node.on(Node.EventType.TOUCH_END, () => this.onAction?.(), this);
    }

    /**
     * 铺一个阶段格。
     *
     * ⚠️ 三态一律**绝对赋值**（格子会被不同下标复用，遗留状态会串）。
     * `qualityFrame` / `iconFrame` 由宿主预加载后传入 —— 这里现加载会先闪一帧上一格的图。
     */
    render(dayText: string, state: RechargeStageState, qualityFrame: SpriteFrame | null, iconFrame: SpriteFrame | null): void {
        this.node.active = true;
        this.stageState = state;
        this.dayLabel.string = dayText;
        this.claimTip.active = state === 'claimable';
        this.checkMark.active = state === 'taken';
        this.goods.render(qualityFrame, iconFrame);
    }

    hide(): void {
        this.node.active = false;
    }
}
