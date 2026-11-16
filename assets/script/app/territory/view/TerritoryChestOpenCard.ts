/**
 * 「宝箱开启」奖励页里的一格卡（模板由 `TerritoryChestOpenPage` 克隆复用）。
 *
 * 只做三件事：换卡框 / 换图标（等比适配 prefab 的图标位）/ 写数量，再把入场动画的视觉量写进节点。
 * 卡片的位置、尺寸、图标位与数量底条全部来自 prefab；这里不计算栅格。
 */
import { _decorator, CCFloat, Component, Label, Sprite, SpriteFrame, UIOpacity, UITransform } from 'cc';
import type { IChestOpenCardVisual } from '../model/TerritoryChestOpenLayout';
import { chestOpenIconFitOf } from '../model/TerritoryChestOpenLayout';

const { ccclass, property } = _decorator;

@ccclass('TerritoryChestOpenCard')
export class TerritoryChestOpenCard extends Component {
    @property({ type: Sprite, tooltip: '品质卡框（整图，按 quality 换 01~04）' })
    frame: Sprite = null!;

    @property({ type: Sprite, tooltip: '奖励图标（等比适配 prefab 的图标位，居中）' })
    icon: Sprite = null!;

    @property({ type: Label, tooltip: '数量（道具 X1 / 货币 +4095）' })
    count: Label = null!;

    @property({ type: UIOpacity, tooltip: '整卡透明度（入场淡入）' })
    opacity: UIOpacity = null!;

    @property({ type: CCFloat, tooltip: '图标相对图标位最多放大的倍数（prefab 配置）' })
    iconMaxUpscale = 0;

    private readonly _base = { x: 0, y: 0 };
    private _iconUi: UITransform | null = null;
    private _slotWidth = 0;
    private _slotHeight = 0;

    protected onLoad(): void {
        this._iconUi = this.icon.node.getComponent(UITransform);
        if (this._iconUi) {
            this._slotWidth = this._iconUi.width;
            this._slotHeight = this._iconUi.height;
        }
    }

    /** 布局完成后记下 prefab/Layout 给出的最终位置；入场动画只在这个位置附近做临时偏移。 */
    captureBase(): void {
        this._base.x = this.node.position.x;
        this._base.y = this.node.position.y;
    }

    /**
     * 换图 + 文案。
     *
     * @param frame 卡框；`null` 保留 prefab 绑的默认框（蓝框），宁可颜色不对也别整格空白
     * @param icon 图标；`null` 隐藏图标位（表里没登记 / 美术缺失时只留框和数量）
     */
    render(frame: SpriteFrame | null, icon: SpriteFrame | null, countText: string): void {
        if (frame) this.frame.spriteFrame = frame;
        this.count.string = countText;
        this.icon.node.active = icon !== null;
        if (!icon || !this._iconUi) return;
        if (!(this._slotWidth > 0) || !(this._slotHeight > 0)) {
            this._slotWidth = this._iconUi.width;
            this._slotHeight = this._iconUi.height;
        }
        this.icon.spriteFrame = icon;
        const fit = chestOpenIconFitOf(
            icon.width,
            icon.height,
            this._slotWidth,
            this._slotHeight,
            this.iconMaxUpscale,
        );
        this._iconUi.setContentSize(fit.width, fit.height);
    }

    /** 写一帧入场视觉量（缩放 / 透明 / 上落位）。 */
    applyReveal(visual: IChestOpenCardVisual): void {
        this.node.setScale(visual.scale, visual.scale, 1);
        this.node.setPosition(this._base.x, this._base.y - visual.rise, 0);
        this.opacity.opacity = visual.opacity;
    }

    /** 入场结束：与设计稿静止态完全一致（缩放 1、不透明、落在 prefab 最终位置）。 */
    settle(): void {
        this.node.setScale(1, 1, 1);
        this.node.setPosition(this._base.x, this._base.y, 0);
        this.opacity.opacity = 255;
    }
}
