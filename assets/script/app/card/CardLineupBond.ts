import { _decorator, Component, Label, Sprite, SpriteFrame } from 'cc';
import type { ZCCardTally } from './CardLineupTypes';

const { ccclass, property } = _decorator;

/** 条目的图标加载入口。页面不再等整行图标备齐才提交。 */
export type ZCTallyIconLoader = (item: ZCCardTally) => Promise<SpriteFrame | null>;

/** 羁绊条里的一项：图标 + 数量，虚拟列表复用。 */
@ccclass('CardLineupBond')
export class CardLineupBond extends Component {
    @property({ type: Sprite, tooltip: 'Icon：职业 / 阵营图标' })
    icon: Sprite = null!;

    @property({ type: Label, tooltip: 'CountLabel：卡数' })
    countLabel: Label = null!;

    /** 本条目当前画的是哪一次渲染，迟到的图标按 token 丢弃（槽位复用会换项）。 */
    private iconToken = 0;

    /**
     * 复用槽位时先覆盖旧图，缺图时再异步补载。
     */
    render(item: ZCCardTally, icon: SpriteFrame | null, loader: ZCTallyIconLoader): void {
        const token = ++this.iconToken;
        this.icon.spriteFrame = icon;
        this.countLabel.string = String(item.count);
        if (icon !== null) return;
        void loader(item).then((next) => {
            if (token !== this.iconToken || !this.isValid) return;
            this.icon.spriteFrame = next;
        }).catch(() => undefined);
    }
}
