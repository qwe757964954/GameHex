import { _decorator, Component, Label, Sprite, SpriteFrame } from 'cc';
import { ZCCardTally } from './CardLineupTypes';

const { ccclass, property } = _decorator;

/** 阵容中栏羁绊列表的单个「图标 + 数量」条目，由虚拟列表实例化复用。 */
@ccclass('CardLineupBond')
export class CardLineupBond extends Component {
    @property({ type: Sprite, tooltip: 'Icon：职业 / 阵营图标' })
    icon: Sprite = null!;

    @property({ type: Label, tooltip: 'CountLabel：卡数' })
    countLabel: Label = null!;

    /** @param item null = 数字清 0；icon null = 保留占位图。 */
    render(item: ZCCardTally | null, icon: SpriteFrame | null): void {
        if (icon) this.icon.spriteFrame = icon;
        this.countLabel.string = item ? String(item.count) : '0';
    }
}
