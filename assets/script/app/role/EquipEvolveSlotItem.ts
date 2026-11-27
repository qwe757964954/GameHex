import { _decorator, Button, Component, Label, Node, Sprite, SpriteFrame } from 'cc';
import { RedDot } from '../common/RedDot';

const { ccclass, property } = _decorator;

/**
 * 装备锻造底部槽位项组件（对齐 FGUI `组件_装备锻造_装备按钮.xml`，蓝湖版式含等级徽章与 Lv 品阶）。
 */
@ccclass('EquipEvolveSlotItem')
export class EquipEvolveSlotItem extends Component {
    @property({ type: Sprite, tooltip: '品质底框' })
    frameSprite: Sprite = null!;

    @property({ type: Sprite, tooltip: '装备图标' })
    iconSprite: Sprite = null!;

    @property({ type: Node, tooltip: '选中高亮框' })
    selectedFrame: Node = null!;

    @property({ type: RedDot, tooltip: '红点' })
    redDot: RedDot = null!;

    @property({ type: Label, tooltip: '左上等级徽章（「N级」，空位隐藏）' })
    levelLabel: Label = null!;

    @property({ type: Label, tooltip: '右下品阶（「Lv.N」，无品阶隐藏）' })
    rankLabel: Label = null!;

    @property({ type: Button, tooltip: '点击按钮' })
    button: Button = null!;

    private redDotOn = false;

    get hasRedDot(): boolean {
        return this.redDotOn;
    }

    setRedDot(on: boolean): void {
        this.redDotOn = on;
        if (this.redDot) this.redDot.setRedDot(on);
    }

    setData(iconSf: SpriteFrame | null, isSelected: boolean, hasRedDot: boolean, level = 0, rank = 0): void {
        this.node.active = true;
        if (iconSf) {
            this.iconSprite.spriteFrame = iconSf;
            this.iconSprite.node.active = true;
        } else {
            this.iconSprite.node.active = false;
        }
        if (this.selectedFrame) {
            this.selectedFrame.active = isSelected;
        }
        this.setRedDot(hasRedDot);
        const levelBadge = this.levelLabel.node.parent;
        if (levelBadge) levelBadge.active = level > 0;
        else this.levelLabel.node.active = level > 0;
        this.levelLabel.string = `${level}级`;
        this.rankLabel.node.active = rank > 0;
        this.rankLabel.string = `Lv.${rank}`;
    }
}
