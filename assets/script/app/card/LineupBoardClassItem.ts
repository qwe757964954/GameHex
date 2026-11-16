import { _decorator, Component, Label, Sprite, SpriteFrame } from 'cc';
import { ZCClassTally } from './CardLineupTypes';

const { ccclass, property } = _decorator;

/**
 * 布阵面板「职业统计行」里的一项：一枚职业图标 + 一个数量。
 *
 * 不复用页面的 `CardLineupBond`：两者虽然都画「图标 + 数量」，但条目数据与取图方式不同 ——
 * 页面项是 `ZCCardTally`（职业/阵营混排，支持 `loader` 延迟补图并用 token 丢弃迟到结果）；
 * 这里只有职业（`ZCClassTally`），图标由 `LineupBoardPage` 预先加载好再传入。
 *
 * ⚠️ 页面项历史上曾按「木条上方灰态 + 条内亮态」画两枚图，现已简化为单枚 `Icon`
 * （`CardLineupBond.prefab` 只剩 Icon / CountLabel 两个子节点），别再照着旧结构找 `iconOff`。
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
