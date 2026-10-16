import { _decorator, Component, Label, Node, Sprite, SpriteFrame } from 'cc';
import { RedDot } from '../common/RedDot';

const { ccclass, property } = _decorator;

/**
 * 首充礼包弹窗里的**一个档位 tab**（内联在 `FirstRecharge.prefab` 的 `TierBar` 下，共 4 个）。
 *
 *  本组件只管视觉（价格 + 选中态底图 + 红点），点击由宿主 `FirstRechargePage` 监听
 *  `cc.Button` 的 CLICK —— 与 `CardLineupNav` 单格的分工一致：
 *  「哪一格对应哪一档」属于宿主的槽位表，格子自己不需要知道。
 *
 *  选中/未选中底图做成两个 `SpriteFrame` 引用（而不是按名字 `resources.load`）：
 *  本项目约定「资源引用在 Inspector 绑」，而且这两张图是**固定**的
 *  （`image/main/tab_bg_02` 选中 / `tab_bg_01` 未选中），没必要走异步加载。
 */
@ccclass('FirstRechargeTierTab')
export class FirstRechargeTierTab extends Component {
    @property({ type: Sprite, tooltip: 'Background：档位底图（本节点上的 cc.Sprite）' })
    background: Sprite = null!;

    @property({ type: Label, tooltip: 'PriceLabel：价格文案，写成「¥11」' })
    priceLabel: Label = null!;

    @property({ type: RedDot, tooltip: 'RedDot：可领取红点（默认隐藏）' })
    redDot: RedDot = null!;

    @property({ type: SpriteFrame, tooltip: '选中态底图（image/main/tab_bg_02）' })
    selectedFrame: SpriteFrame = null!;

    @property({ type: SpriteFrame, tooltip: '未选中态底图（image/main/tab_bg_01）' })
    normalFrame: SpriteFrame = null!;

    /** 铺一次数据；`redDot` 传 0/1。 */
    render(priceText: string, selected: boolean, redDot: number): void {
        this.priceLabel.string = priceText;
        const frame = selected ? this.selectedFrame : this.normalFrame;
        if (frame) this.background.spriteFrame = frame;
        this.redDot.setRedDot(redDot);
    }

    /** 这一档不显示时整体隐藏，并顺手关掉红点（避免复用时残影）。 */
    hide(): void {
        this.node.active = false;
        this.redDot.setRedDot(0);
    }
}
