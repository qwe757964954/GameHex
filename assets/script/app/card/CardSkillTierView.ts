import { _decorator, Color, Component, Label, Node, RichText, UITransform } from 'cc';
import type { ZCArmySkillLevelRow } from './CardSkillList';
import { CARD_LINEUP_TEXTS } from './CardLineupTexts';
import { formatSkillDescMarkup, hexOfColor } from './CardSkillDescMarkup';

const { ccclass, property } = _decorator;

@ccclass('CardSkillTierView')
export class CardSkillTierView extends Component {
    @property(Node) unlockedBackground: Node = null!;
    @property(Node) lockedBackground: Node = null!;
    @property(Label) tierLabel: Label = null!;
    @property({ type: RichText, tooltip: 'DescLabel：该档效果描述（富文本，数字按增益/普通两色）' })
    descLabel: RichText = null!;
    @property(Label) lockLabel: Label = null!;
    @property(Node) lockRoot: Node = null!;
    @property(UITransform) rowTransform: UITransform = null!;
    @property(UITransform) descTransform: UITransform = null!;
    @property(Color) learnedColor = new Color(255, 192, 34, 255);
    @property(Color) unlearnedColor = new Color(255, 255, 255, 255);

    @property({ type: Color, tooltip: '增益百分比（提高/增加/提升 + %）的数字颜色' })
    boostNumberColor: Color = new Color(24, 115, 30, 255);

    @property({ type: Color, tooltip: '其余数字（每3次、额外发射1发、造成30%）的颜色' })
    plainNumberColor: Color = new Color(28, 74, 168, 255);

    render(row: ZCArmySkillLevelRow | null, currentLevel: number, heroLevel: number): void {
        this.node.active = !!row;
        const locked = !!row && heroLevel < row.unlockHeroLevel;
        this.unlockedBackground.active = !locked;
        this.lockedBackground.active = locked;
        this.lockRoot.active = locked;
        this.tierLabel.string = row ? `${row.level}${CARD_LINEUP_TEXTS.skillTierSuffix}` : '';
        this.tierLabel.color = row && row.level <= currentLevel ? this.learnedColor : this.unlearnedColor;
        //  `maxWidth` 要在赋文本之前定好（RichText 靠它换行），后面这一帧量到的行高才准。
        //  它是固定点（RichText 会把节点宽写回 maxWidth），所以只在与当前节点宽不一致时写。
        const maxWidth = this.descTransform.width;
        if (maxWidth > 0 && this.descLabel.maxWidth !== maxWidth) this.descLabel.maxWidth = maxWidth;
        //  这一档描述原本是 `cc.Label(_isBold = true)`，换 RichText 后用 `<b>` 保住粗体。
        this.descLabel.string = formatSkillDescMarkup(
            row?.desc || CARD_LINEUP_TEXTS.skillDescEmpty,
            {
                boost: hexOfColor(this.boostNumberColor),
                plain: hexOfColor(this.plainNumberColor),
            },
            true,
        );
        this.rowTransform.height = Math.max(141, this.descTransform.height + 60);
        this.lockLabel.string = row ? `${CARD_LINEUP_TEXTS.skillUnlockPrefix}${row.unlockHeroLevel}${CARD_LINEUP_TEXTS.skillUnlockSuffix}` : '';
    }
}
