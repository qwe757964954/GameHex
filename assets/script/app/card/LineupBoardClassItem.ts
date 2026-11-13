import { _decorator, Component, Label, Sprite, SpriteFrame } from 'cc';
import { ZCClassTally } from './CardLineupTypes';

const { ccclass, property } = _decorator;

/**
 * 布阵面板「职业统计行」里的一项：一枚职业图标 + 一个数量。
 *
 * 与页面的 `CardLineupBond` 差一层：页面那套每项要画两枚图标（木条上方灰态 +
 * 条内亮态），布阵这里的行只有一枚（设计稿 `卡牌阵容_队伍编辑` 上就是「图标 + 2」），
 * 所以不复用 —— 复用会多出一个永远为空的 `iconOff` 绑定。
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
