import { _decorator, Component, Label, Sprite, type SpriteFrame } from 'cc';

const { ccclass, property } = _decorator;

@ccclass('MilitiaTalentCostItem')
export class MilitiaTalentCostItem extends Component {
    @property({ type: Sprite, tooltip: '消耗图标' })
    private icon: Sprite = null!;

    @property({ type: Label, tooltip: '持有数量' })
    private ownedLabel: Label = null!;

    @property({ type: Label, tooltip: '需要数量' })
    private needLabel: Label = null!;

    render(frame: SpriteFrame | null, owned: number, need: number): void {
        this.icon.spriteFrame = frame;
        this.ownedLabel.string = String(owned);
        this.needLabel.string = `/${need}`;
    }
}
