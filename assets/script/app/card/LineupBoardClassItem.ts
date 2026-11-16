import { _decorator, Component, Label, Sprite, SpriteFrame } from 'cc';
import { ZCClassTally } from './CardLineupTypes';

const { ccclass, property } = _decorator;

/**
 * 布阵面板职业统计行的一项：职业图标和数量。
 * 不复用 CardLineupBond，页面项是混排统计且要延迟补图，这里只有职业，图标由外部预先加载。
 * prefab 只有 Icon 和 CountLabel 两个子节点，没有旧版的 iconOff。
 */
@ccclass('LineupBoardClassItem')
export class LineupBoardClassItem extends Component {
    @property({ type: Sprite, tooltip: 'Icon：职业计数图标（白色 common_img_zs/fs/ss/tk）' })
    icon: Sprite = null;

    @property({ type: Label, tooltip: 'CountLabel：本职业在阵容里的卡数' })
    countLabel: Label = null;

    /**
     * 填入一项统计。
     *
     * @param tally 职业计数；为 `null` 时数字写 0、图标保留 prefab 现有图
     * @param art   已加载好的职业计数图标
     */
    render(tally: ZCClassTally | null, art: SpriteFrame | null): void {
        if (art) this.icon.spriteFrame = art;
        this.countLabel.string = tally ? String(tally.count) : '0';
    }
}
