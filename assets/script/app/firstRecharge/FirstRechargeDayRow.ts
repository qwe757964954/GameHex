import { _decorator, Component, Label, Node, SpriteFrame, UITransform } from 'cc';
import { qualityFrameName } from './FirstRechargeArt';
import type { IFirstRechargeItemInfo } from './FirstRechargeArt';
import { dayPlateWidth, rewardRowWidth, rewardSlotOffsets } from './FirstRechargeLayout';
import { FirstRechargeSlot } from './FirstRechargeSlot';
import type { FirstRechargeDayState, IFirstRechargeReward } from './FirstRechargeTable';
import { FIRST_RECHARGE_TEXTS } from './FirstRechargeTexts';

const { ccclass, property } = _decorator;

/** 一天的渲染数据。 */
export interface IFirstRechargeDayRowData {
    /** 第几天（1..3）。 */
    readonly day: number;
    readonly state: FirstRechargeDayState;
    readonly rewards: readonly IFirstRechargeReward[];
    readonly items: ReadonlyMap<number, IFirstRechargeItemInfo>;
    /** `resId → 已加载的图标 SpriteFrame`；没有就隐藏图标节点。 */
    readonly iconFrames: ReadonlyMap<number, SpriteFrame>;
    /** `品质框资源名 → SpriteFrame`（4 档固定图，宿主预加载一次即可）。 */
    readonly qualityFrames: ReadonlyMap<string, SpriteFrame>;
}

/**
 * 首充礼包弹窗里的**一天**（内联在 `FirstRecharge.prefab` 的 `DayList` 下，共 3 天，**横排**）。
 *
 * 结构对齐 FGUI `新首充/组件/组件_新首充_项.xml` / `_项2.xml`：
 *   `DayRow`（`sc4.png` 九宫格，186 或 269 宽 × 154 高）
 *     ├─ `DayLabel`  「第一天」（25px `#ffe2bb`，牌内水平居中）
 *     └─ `SlotBar`   一排奖励格（`FirstRechargeSlot`，76×76，间距 5）
 *
 *  **牌宽与格子位置是运行时算的，不在 prefab 上固定** —— 因为一天有几条奖励是**数据**定的
 *  （`config/firstRechargeNew.json` 是 `[3,2,2]`：第 1 天 3 条 → 269 宽，第 2/3 天各 2 条 → 186 宽）。
 *  老客户端靠 FairyGUI 的 `autoItemSize` 干这事，Cocos 的 `cc.Layout` 只支持等宽格子，
 *  所以公式收在 `FirstRechargeLayout`（纯函数、有单测），本类只负责把结果写到节点上。
 *
 *  ⚠️ 「横排」意味着**不能用 `position.y` 判断第几天**：宿主 `FirstRechargePage` 按 `position.x` 排。
 *
 *  格子数量按配置来：多出来的槽位必须显式 `hide()`，否则上一档的数据会残留在槽位上
 *  （列表复用类 bug 的经典形态）。
 */
@ccclass('FirstRechargeDayRow')
export class FirstRechargeDayRow extends Component {
    @property({ type: Label, tooltip: 'DayLabel：第几天，如「第1天」' })
    dayLabel: Label = null!;

    @property({ type: Node, tooltip: 'SlotBar：奖励格容器（下面挂 3 个 FirstRechargeSlot）' })
    slotBar: Node = null!;

    /**
     * 行内的奖励格，**按 x 从左到右**排序 —— 渲染顺序契约与设计稿一致。
     *
     *  ⚠️ 必须用 `getComponentsInChildren`：`getComponents` 只查**本节点自己**
     *  （引擎 `Node.getComponents` 的语义是 "all components of given type **in the node**"），
     *  而 `SlotBar` 自己身上一个 `FirstRechargeSlot` 都没有 → 返回空数组、整行静默空着。
     *  顺带一条：`getComponentsInChildren` 遍历 `_children` 时**不过滤 active**，
     *  所以被 `hide()` 掉的格子仍在列表里，下标不会错位。
     */
    private get slots(): FirstRechargeSlot[] {
        return this.slotBar.getComponentsInChildren(FirstRechargeSlot)
            .slice()
            .sort((a, b) => a.node.position.x - b.node.position.x);
    }

    render(data: IFirstRechargeDayRowData): void {
        const texts = FIRST_RECHARGE_TEXTS;
        this.dayLabel.string = `${texts.dayPrefix}${data.day}${texts.daySuffix}`;

        const slots = this.slots;
        const count = Math.min(data.rewards.length, slots.length);
        this.applyLayout(count);

        const offsets = rewardSlotOffsets(count);
        for (let index = 0; index < slots.length; index++) {
            const slot = slots[index];
            if (index >= count) {
                slot.hide();
                continue;
            }
            const reward = data.rewards[index];
            const item = data.items.get(reward.resId);
            slot.node.active = true;
            slot.node.setPosition(offsets[index], 0, 0);
            //  品质框与图标都必须由宿主**预加载好**再进来（见 `FirstRechargeSlot.render`）
            slot.render(
                data.iconFrames.get(reward.resId) ?? null,
                item ? data.qualityFrames.get(qualityFrameName(item.quality)) ?? null : null,
            );
            // 置灰只针对「已买但当天未到(locked)」和「已领(taken)」；
            // 未购买(unbought)/可领(claimable) 的奖励格要明亮展示，对齐设计稿。
            slot.setDimmed(data.state === 'locked' || data.state === 'taken');
        }
    }

    /** 整行隐藏（档位切换时用不到的行）。 */
    hide(): void {
        this.node.active = false;
    }

    /** 把「牌宽 + 格排宽」写到节点上（渲染组件是 `sizeMode=CUSTOM`，不会被贴图改回去）。 */
    private applyLayout(count: number): void {
        const plateWidth = dayPlateWidth(count);
        const plate = this.node.getComponent(UITransform);
        if (plate) plate.setContentSize(plateWidth, plate.contentSize.height);
        const bar = this.slotBar.getComponent(UITransform);
        if (bar) bar.setContentSize(rewardRowWidth(count), bar.contentSize.height);
    }
}
