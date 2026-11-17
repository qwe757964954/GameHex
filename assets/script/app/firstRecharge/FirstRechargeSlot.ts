import { _decorator, Component, Sprite, SpriteFrame, UIOpacity } from 'cc';

const { ccclass, property } = _decorator;

/** 奖励格置灰时的透明度（`UIOpacity` 满值 255）。 */
const DIM_OPACITY = 150;

/**
 * 首充礼包一个奖励格（76×76）。
 * 本节点 cc.Sprite 当品质框，子节点 Icon 当道具图。
 * 无道具图时隐藏 Icon（不画问号），品质框保留。
 */
@ccclass('FirstRechargeSlot')
export class FirstRechargeSlot extends Component {
    @property({ type: Sprite, tooltip: 'Frame：品质框（本节点 cc.Sprite）' })
    frame: Sprite = null!;

    @property({ type: Sprite, tooltip: 'Icon：道具图标（无图时隐藏）' })
    icon: Sprite = null!;

    @property({ type: UIOpacity, tooltip: 'Dim：压暗用（可选）' })
    dim: UIOpacity | null = null;

    /** 框和图标由宿主预加载传入；qualityFrame null = 保留静态框。 */
    render(iconFrame: SpriteFrame | null, qualityFrame: SpriteFrame | null): void {
        if (qualityFrame) this.frame.spriteFrame = qualityFrame;
        if (iconFrame) {
            this.icon.spriteFrame = iconFrame;
            this.icon.node.active = true;
        } else {
            this.icon.node.active = false;
        }
    }

    hide(): void {
        this.node.active = false;
    }

    setDimmed(dimmed: boolean): void {
        if (this.dim) this.dim.opacity = dimmed ? DIM_OPACITY : 255;
    }
}
