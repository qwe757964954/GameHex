import { _decorator, Color, Component, Label, Sprite, UITransform } from 'cc';

import { CARD_LINEUP_TEXTS } from './CardLineupTexts';
import type { CardDetailPresentation } from './CardDetailPresenter';

const { ccclass, property } = _decorator;

/** 技能天赋虚拟列表复用行，完整写入文本、颜色与实际高度。 */
@ccclass('CardDetailMilestoneRow')
export class CardDetailMilestoneRow extends Component {
    @property({ type: UITransform })
    rowTransform: UITransform = null!;

    @property({ type: UITransform })
    backgroundTransform: UITransform = null!;

    @property({ type: UITransform })
    descTransform: UITransform = null!;

    @property({ type: Color })
    unlockedColor: Color = new Color(62, 38, 19, 255);

    @property({ type: Color })
    lockedColor: Color = new Color(124, 106, 83, 255);
    @property({ type: Sprite, tooltip: 'RowBg：行底板（ms_row）' })
    rowBg: Sprite = null!;

    @property({ type: Label, tooltip: 'LevelLabel：左侧 Lv 等级块上的数字' })
    levelLabel: Label = null!;

    @property({ type: Label, tooltip: 'DescLabel：右侧解锁描述' })
    descLabel: Label = null!;

    render(item: CardDetailPresentation['milestones'][number]): void {
        this.levelLabel.string = `${CARD_LINEUP_TEXTS.detailMilestonePrefix}${item.unlockLevel}`;
        this.descLabel.string = item.desc;
        this.descLabel.color = item.unlocked ? this.unlockedColor : this.lockedColor;
        this.descLabel.updateRenderData(true);
        const height = Math.max(52, this.descTransform.height + 18);
        this.rowTransform.height = height;
        this.backgroundTransform.height = height;
    }
}
