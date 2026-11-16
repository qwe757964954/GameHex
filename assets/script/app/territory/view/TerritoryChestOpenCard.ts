/**
 * 「宝箱开启」奖励页里的一格卡（模板由 `TerritoryChestOpenPage` 克隆复用）。
 *
 * 只做三件事：换卡框 / 换图标（等比适配 112×147）/ 写数量，再把入场动画的视觉量写进节点。
 * 所有算术都在 `TerritoryChestOpenLayout`（纯函数、可单测），这里只碰 `cc` 节点。
 */
import { _decorator, Component, Label, Sprite, SpriteFrame, UIOpacity, UITransform } from 'cc';
import type { IChestOpenCardVisual } from '../model/TerritoryChestOpenLayout';
import { chestOpenIconFitOf } from '../model/TerritoryChestOpenLayout';

const { ccclass, property } = _decorator;

@ccclass('TerritoryChestOpenCard')
export class TerritoryChestOpenCard extends Component {
    @property({ type: Sprite, tooltip: '品质卡框（139×185 整图，按 quality 换 01~04）' })
    frame: Sprite = null!;

    @property({ type: Sprite, tooltip: '奖励图标（等比适配 112×147，居中）' })
    icon: Sprite = null!;

    @property({ type: Label, tooltip: '数量（道具 X1 / 货币 +4095）' })
    count: Label = null!;

    @property({ type: UIOpacity, tooltip: '整卡透明度（入场淡入）' })
    opacity: UIOpacity = null!;

    private readonly _base = { x: 0, y: 0 };
    private _iconUi: UITransform | null = null;

    protected onLoad(): void {
        this._iconUi = this.icon.node.getComponent(UITransform);
    }

    /**
     * 铺一张卡：记下**最终位置**（入场动画只在这个位置附近做偏移，不动栅格本身）。
     * 坐标是「卡片容器」局部坐标（容器锚点 = 顶部中心）。
     */
    place(x: number, y: number): void {
        this._base.x = x;
        this._base.y = y;
        this.node.setPosition(x, y, 0);
    }

    /**
     * 换图 + 文案。
     *
     * @param frame 卡框；`null` 保留 prefab 绑的默认框（蓝框），宁可颜色不对也别整格空白
     * @param icon  图标；`null` 隐藏图标位（表里没登记 / 美术缺失时只留框和数量）
     */
    render(frame: SpriteFrame | null, icon: SpriteFrame | null, countText: string): void {
        if (frame) this.frame.spriteFrame = frame;
        this.count.string = countText;
        this.icon.node.active = icon !== null;
        if (!icon || !this._iconUi) return;
        this.icon.spriteFrame = icon;
        const fit = chestOpenIconFitOf(icon.width, icon.height);
        this._iconUi.setContentSize(fit.width, fit.height);
    }

    /** 写一帧入场视觉量（缩放 / 透明 / 上落位）。 */
    applyReveal(visual: IChestOpenCardVisual): void {
        this.node.setScale(visual.scale, visual.scale, 1);
        this.node.setPosition(this._base.x, this._base.y - visual.rise, 0);
        this.opacity.opacity = visual.opacity;
    }

    /** 入场结束：与设计稿静止态完全一致（缩放 1、不透明、落在栅格位）。 */
    settle(): void {
        this.node.setScale(1, 1, 1);
        this.node.setPosition(this._base.x, this._base.y, 0);
        this.opacity.opacity = 255;
    }
}
