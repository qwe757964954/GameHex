import { _decorator, Component, Label, Sprite, SpriteFrame } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 装备锻造消耗展示组件（对齐 FGUI `组件_公用_消耗_单个.xml`）。
 */
@ccclass('EquipEvolveCostItem')
export class EquipEvolveCostItem extends Component {
    @property({ type: Sprite, tooltip: '消耗物品图标' })
    iconSprite: Sprite = null!;

    @property({ type: Label, tooltip: '消耗数量标签' })
    costLabel: Label = null!;

    setData(text: string, iconFrame?: SpriteFrame | null): void {
        this.node.active = true;
        this.costLabel.string = text;
        if (iconFrame && this.iconSprite) {
            this.iconSprite.spriteFrame = iconFrame;
            this.iconSprite.node.active = true;
        } else if (this.iconSprite) {
            this.iconSprite.node.active = false;
        }
    }
}
