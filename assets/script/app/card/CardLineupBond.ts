import { _decorator, Component, Label, Sprite, SpriteFrame } from 'cc';
import { ZCCardTally } from './CardLineupTypes';

const { ccclass, property } = _decorator;

/** 阵容中栏羁绊列表的单个「图标 + 数量」条目，由虚拟列表实例化复用。 */
@ccclass('CardLineupBond')
export class CardLineupBond extends Component {
    @property({ type: Sprite, tooltip: 'Icon：职业 / 阵营图标' })
    icon: Sprite = null;

    @property({ type: Label, tooltip: 'CountLabel：卡数' })
    countLabel: Label = null;

    /**
     * @param item null = 数字清 0
     * @param icon null = **清空图标**
     *
     *  图必须**无条件赋值**：本组件由虚拟列表创建 / 复用 / 回收，同一个槽位在滚动中会换成另一个
     *  条目。写成有条件的写法时，"没有图的条目"会保留上一项的图 —— 阵营图标现在拿不到图
     *  （见 `CAMP_ICON_ON_ART`），于是职业格子滑过去之后阵营格子还顶着职业图标。
     *  `this.icon` 是 `@property Sprite`（必绑），所以只判数据、不判组件。
     */
    render(item: ZCCardTally | null, icon: SpriteFrame | null): void {
        this.icon.spriteFrame = icon;
        this.countLabel.string = item ? String(item.count) : '0';
    }
}
