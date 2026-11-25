import { _decorator, Button, Component, Node, Sprite, SpriteFrame } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 装备锻造底部槽位项组件（对齐 FGUI `组件_装备锻造_装备按钮.xml`）。
 */
@ccclass('EquipEvolveSlotItem')
export class EquipEvolveSlotItem extends Component {
    @property({ type: Sprite, tooltip: '品质底框' })
    frameSprite: Sprite = null!;

    @property({ type: Sprite, tooltip: '装备图标' })
    iconSprite: Sprite = null!;

    @property({ type: Node, tooltip: '选中高亮框' })
    selectedFrame: Node = null!;

    @property({ type: Node, tooltip: '红点' })
    redDotNode: Node = null!;

    @property({ type: Button, tooltip: '点击按钮' })
    button: Button = null!;

    setData(iconSf: SpriteFrame | null, isSelected: boolean, hasRedDot: boolean): void {
        this.node.active = true;
        if (iconSf && this.iconSprite) {
            this.iconSprite.spriteFrame = iconSf;
            this.iconSprite.node.active = true;
        } else if (this.iconSprite) {
            this.iconSprite.node.active = false;
        }
        if (this.selectedFrame) {
            this.selectedFrame.active = isSelected;
        }
        if (this.redDotNode) {
            this.redDotNode.active = hasRedDot;
        }
    }
}
