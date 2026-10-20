import { _decorator, Color, Component, Label, Node, Sprite, SpriteFrame } from 'cc';
import { RedDot } from '../common/RedDot';

const { ccclass, property } = _decorator;
const TIER_LABEL_COLOR_ON = new Color(48, 38, 24, 255);
const TIER_LABEL_COLOR_OFF = new Color(255, 255, 255, 255);

/**
 * 首充礼包弹窗里的**一个档位 tab**（内联在 `FirstRecharge.prefab` 的 `TierBar` 下，共 4 个）。
 *
 *  本组件只管视觉（价格 + 选中态底图 + 红点），点击由宿主 `FirstRechargePage` 监听
 *  `cc.Button` 的 CLICK —— 与共用 `TabButton` 单格的分工一致：
 *  「哪一格对应哪一档」属于宿主的槽位表，格子自己不需要知道。
 *
 *  选中态复用主页的金色 `nav_sel`，未选中不铺独立底板；帧引用由 prefab Inspector 绑定。
 */
@ccclass('FirstRechargeTierTab')
export class FirstRechargeTierTab extends Component {
    @property({ type: Sprite, tooltip: 'Background：档位底图（本节点上的 cc.Sprite）' })
    background: Sprite = null!;

    @property({ type: Label, tooltip: 'PriceLabel：价格文案，写成「¥11」' })
    priceLabel: Label = null!;

    @property({ type: RedDot, tooltip: 'RedDot：可领取红点（默认隐藏）' })
    redDot: RedDot = null!;

    @property({ type: SpriteFrame, tooltip: '选中态底板（主页同款 city/nav_sel）' })
    selectedFrame: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: '未选中态无单独底板' })
    normalFrame: SpriteFrame | null = null;

    /** 铺一次数据；`redDot` 传 0/1。 */
    render(priceText: string, selected: boolean, redDot: number): void {
        this.priceLabel.string = priceText;
        const frame = selected ? this.selectedFrame : this.normalFrame;
        this.background.spriteFrame = frame;
        this.priceLabel.color = selected ? TIER_LABEL_COLOR_ON : TIER_LABEL_COLOR_OFF;
        this.redDot.setRedDot(redDot);
    }

    /** 这一档不显示时整体隐藏，并顺手关掉红点（避免复用时残影）。 */
    hide(): void {
        this.node.active = false;
        this.redDot.setRedDot(0);
    }
}
