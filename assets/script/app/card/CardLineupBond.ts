import { _decorator, Component, Label, Sprite, SpriteFrame } from 'cc';
import { ZCCardTally } from './CardLineupTypes';

const { ccclass, property } = _decorator;

/** 条目自取图标的入口（页面不再等图标行备齐才提交列表）。 */
export type ZCTallyIconLoader = (item: ZCCardTally) => Promise<SpriteFrame | null>;

/** 阵容中栏羁绊列表的单个「图标 + 数量」条目，由虚拟列表实例化复用。 */
@ccclass('CardLineupBond')
export class CardLineupBond extends Component {
    @property({ type: Sprite, tooltip: 'Icon：职业 / 阵营图标' })
    icon: Sprite = null;

    @property({ type: Label, tooltip: 'CountLabel：卡数' })
    countLabel: Label = null;

    /** 本条目当前画的是哪一次渲染，迟到的图标按 token 丢弃（槽位复用会换项）。 */
    private iconToken = 0;

    /**
     * @param item null = 数字清 0
     * @param icon null = **清空图标**
     * @param loader 图标还没备好时由条目自己补；`icon` 已就绪则不调用。
     *
     *  图必须**无条件赋值**：本组件由虚拟列表创建 / 复用 / 回收，同一个槽位在滚动中会换成另一个
     *  条目。写成有条件的写法时，"没有图的条目"会保留上一项的图 —— 阵营图标现在拿不到图
     *  （见 `cardUiArt.camp`），于是职业格子滑过去之后阵营格子还顶着职业图标。
     *  `this.icon` 是 `@property Sprite`（必绑），所以只判数据、不判组件。
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
