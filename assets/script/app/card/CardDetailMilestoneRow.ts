import { _decorator, Color, Component, Label, RichText, Sprite, UITransform } from 'cc';

import { CARD_LINEUP_TEXTS } from './CardLineupTexts';
import { formatSkillDescMarkup, hexOfColor } from './CardSkillDescMarkup';
import type { CardDetailPresentation } from './CardDetailPresenter';

const { ccclass, property } = _decorator;

/** 技能天赋滚动列表复用行，完整写入文本、颜色与实际高度。 */
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

    @property({ type: RichText, tooltip: 'DescLabel：右侧解锁描述（富文本，数字按增益/普通两色）' })
    descLabel: RichText = null!;

    @property({ type: Color, tooltip: '增益百分比（提高/增加/提升 + %）的数字颜色' })
    boostNumberColor: Color = new Color(24, 115, 30, 255);

    @property({ type: Color, tooltip: '其余数字（每3次、半径60、造成30%）的颜色' })
    plainNumberColor: Color = new Color(28, 74, 168, 255);

    private readonly unlockedBackground = new Color(255, 255, 255, 255);
    private readonly lockedBackground = new Color(146, 129, 96, 255);

    render(item: CardDetailPresentation['milestones'][number]): void {
        this.levelLabel.string = item.unlockLevel > 0
            ? `${item.unlockLevel}${CARD_LINEUP_TEXTS.detailLevelSuffix}`
            : CARD_LINEUP_TEXTS.detailLevelInitial;
        //  行内带技能名：描述栏要能对上六边形格子里的技能（同一张卡多档文案可能完全相同）。
        //  表里没填描述的档位不会进列表（`buildDetailMilestones` 出列时就滤掉了）。
        const text = item.name
            ? `${item.name}${CARD_LINEUP_TEXTS.detailSkillNameSeparator}${item.desc}`
            : item.desc;
        //  `maxWidth` 要在赋文本之前定好：RichText 换行宽度靠它，改晚了这一帧量出来的高度是错的。
        //  它是固定点（RichText 会把节点宽写回 maxWidth），所以只在与当前节点宽不一致时写。
        const maxWidth = this.descTransform.width;
        if (maxWidth > 0 && this.descLabel.maxWidth !== maxWidth) this.descLabel.maxWidth = maxWidth;
        this.descLabel.string = formatSkillDescMarkup(text, {
            boost: hexOfColor(this.boostNumberColor),
            plain: hexOfColor(this.plainNumberColor),
        });
        //  非数字文案沿用解锁/锁定两色；带 <color> 的片段由 RichText 自己保留。
        this.descLabel.fontColor = item.unlocked ? this.unlockedColor : this.lockedColor;
        this.rowBg.color = item.unlocked ? this.unlockedBackground : this.lockedBackground;
        //  RichText 的 string setter 内部同步 `_updateRichText` 并写回节点高，不用再 updateRenderData。
        const height = Math.max(61, this.descTransform.height + 20);
        this.rowTransform.height = height;
        this.backgroundTransform.height = height;
    }
}
