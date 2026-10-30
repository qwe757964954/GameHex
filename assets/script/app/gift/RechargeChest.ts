import { _decorator, Button, Component, Label, Node, SpriteFrame } from 'cc';
import { GiftRewardSlot } from './GiftRewardSlot';

const { ccclass, property } = _decorator;

/**
 * 累计充值页「充值好礼」（`活动Tab.id = 4` 的第二个活动，`ActivityType.RechargeGiftAct2`）
 * 顶部**一个宝箱**（80×80）。
 *
 * 结构对齐 FGUI `礼包/自定义组件/Button2.xml`（紫宝箱）/ `Button1.xml`（红宝箱）：
 *   `Closed`（未开启宝箱图）+ `Opened`（已开启宝箱图）+ `Goods`（70×70 奖励格）+ `Progress`（`M/N` 文本）。
 *
 * 状态口径照老端 `TabGiftRechargeTotal.UpdateRewards`：
 *   - `opened`  = 该档已领取（`tlTakeProcess` 含本档）⇒ 显示已开启图、按钮不可点；
 *   - `reachable` = `detail.curProcess >= 本档` ⇒ 可领取（红点是宿主的事，本轮不接）；
 *   - 否则未达成 ⇒ 按钮不可点，奖励格可点（老端 `goodsItem.touchable = true`）。
 */
@ccclass('RechargeChest')
export class RechargeChest extends Component {
    @property({ type: Node, tooltip: 'Closed：未开启宝箱图' })
    closedIcon: Node = null;

    @property({ type: Node, tooltip: 'Opened：已开启宝箱图' })
    openedIcon: Node = null;

    @property({ type: Node, tooltip: 'Button：宝箱点击区（挂 cc.Button）' })
    button: Node = null;

    @property({ type: GiftRewardSlot, tooltip: 'Goods：奖励格（70×70）' })
    goods: GiftRewardSlot = null;

    @property({ type: Label, tooltip: 'Progress：`M/N` 进度文本' })
    progressLabel: Label = null;

    /** 宿主点宝箱时回调。 */
    onAction: (() => void) | null = null;

    private taken = false;
    private reachable = false;

    protected onLoad(): void {
        this.button.on(Node.EventType.TOUCH_END, () => this.onAction?.(), this);
    }

    get isTaken(): boolean {
        return this.taken;
    }

    get isReachable(): boolean {
        return this.reachable;
    }

    render(
        taken: boolean,
        reachable: boolean,
        progressText: string,
        qualityFrame: SpriteFrame | null,
        iconFrame: SpriteFrame | null,
    ): void {
        // ⚠️ `goods` / `progressLabel` 在 prefab 里是**兄弟节点**（FGUI 原稿把它们挂在
        //    `_内容` 的 displayList 上、不在宝箱内部）⇒ 藏 / 显必须三处一起，只动自己会留孤儿。
        this.node.active = true;
        this.goods.node.active = true;
        if (this.progressLabel) this.progressLabel.node.active = true;

        this.taken = taken;
        this.reachable = reachable;

        // 两态一律绝对赋值（宝箱只有 2 个槽位，但状态会随进度来回变）
        this.closedIcon.active = !taken;
        this.openedIcon.active = taken;
        this.button.getComponent(Button).interactable = !taken && reachable;

        this.progressLabel.string = progressText;
        this.goods.render(qualityFrame, iconFrame);
    }

    hide(): void {
        this.node.active = false;
        this.goods.node.active = false;
        if (this.progressLabel) this.progressLabel.node.active = false;
    }
}
