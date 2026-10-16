import { _decorator, Component, Label, Sprite, SpriteFrame } from 'cc';

const { ccclass, property } = _decorator;

/** 月卡特权列表一行：行首的点 + 特权描述。 */
@ccclass('MonthCardGiftPrivilegeRow')
export class MonthCardGiftPrivilegeRow extends Component {
    @property({ type: Sprite, tooltip: 'Dot：行首的点' })
    dot: Sprite = null!;

    @property({ type: Label, tooltip: 'Label：特权描述' })
    label: Label = null!;

    /** @param dotFrame null = 保留 prefab 静态点。 */
    render(dotFrame: SpriteFrame | null, text: string): void {
        if (dotFrame) this.dot.spriteFrame = dotFrame;
        this.label.string = text;
    }

    hide(): void {
        this.node.active = false;
    }
}
