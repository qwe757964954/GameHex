import { _decorator, Component, Sprite, SpriteFrame } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 一个奖励格的图（品质框 + 道具图标）。
 *
 * 品质框和图标必须逐格传入；同一行不同奖励的品质可能不同。
 */
export interface IGiftSlotFrame {
    readonly qualityFrame: SpriteFrame | null;
    /** `null` 时隐藏图标节点。 */
    readonly iconFrame: SpriteFrame | null;
}

/**
 * 商品行内的一个奖励格。
 *
 * 图片由宿主预加载后传入，组件内不做异步加载，避免复用时闪现上一行的图。
 */
@ccclass('GiftRewardSlot')
export class GiftRewardSlot extends Component {
    @property({ type: Sprite, tooltip: 'Frame：品质框底图（本节点上的 cc.Sprite）' })
    frame: Sprite = null!;

    @property({ type: Sprite, tooltip: 'Icon：道具图标（没有映射图时会被隐藏）' })
    icon: Sprite = null!;

    /**
     * 铺一个奖励；`qualityFrame` 为 `null` 时保留 prefab 上的静态框。
     */
    render(qualityFrame: SpriteFrame | null, iconFrame: SpriteFrame | null): void {
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
}
