import { _decorator, Component, Label, Sprite, SpriteFrame } from 'cc';
import { ZCCardTally } from './CardLineupTypes';

const { ccclass, property } = _decorator;

/** 条目的图标加载入口。页面不再等整行图标备齐才提交。 */
export type ZCTallyIconLoader = (item: ZCCardTally) => Promise<SpriteFrame | null>;

/** 羁绊条里的一项：图标 + 数量，虚拟列表复用。 */
@ccclass('CardLineupBond')
export class CardLineupBond extends Component {
    @property({ type: Sprite, tooltip: 'Icon：职业 / 阵营图标' })
    icon: Sprite = null;

    @property({ type: Label, tooltip: 'CountLabel：卡数' })
    countLabel: Label = null;

    /** 本条目当前画的是哪一次渲染，迟到的图标按 token 丢弃（槽位复用会换项）。 */
    private iconToken = 0;

    /**
     * @param item 为空时数量显示 0。
     * @param icon 为空时清掉旧图。
     * @param loader 图还没到就交给条目自己补。
     *
     * 图必须无条件赋值。槽位会被复用，只写“有图”的情况会把上一项的图标留下来。
     */
    render(item: ZCCardTally | null, icon: SpriteFrame | null, loader?: ZCTallyIconLoader): void {
        const token = ++this.iconToken;
        this.icon.spriteFrame = icon;
        this.countLabel.string = item ? String(item.count) : '0';
        if (icon || !item || !loader) return;
        void loader(item).then((next) => {
            if (token !== this.iconToken || !this.isValid) return;
            this.icon.spriteFrame = next;
        }).catch(() => undefined);
    }
}
