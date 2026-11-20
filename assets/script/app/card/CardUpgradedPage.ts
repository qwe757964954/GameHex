import { _decorator, Label, Node, RichText, Sprite, UITransform } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { CardUnitPreview } from './CardUnitPreview';
import type { ICardUpgradedContent } from './CardUpgradedPresentation';

const { ccclass, property } = _decorator;

/** 设计稿英雄立绘高 426，骨骼 idle 也按这个可见高归一。 */
const HERO_VISIBLE_HEIGHT = 426;

/** 升级成功弹窗：只渲染控制器给的数据；关闭走 PopupBase 的空白接收层。 */
@ccclass('CardUpgradedPage')
export class CardUpgradedPage extends PopupBase {
    static prefabPath = 'ui/card/CardUpgraded';

    private progressFillUi: UITransform | null = null;
    private heroPreview: CardUnitPreview | null = null;

    @property({ group: '背景', type: Sprite, tooltip: 'Bg：720×1610 品质背景' })
    background: Sprite = null!;

    @property({ group: '属性框', type: Sprite, tooltip: 'Stats/Left/Frame：左属性框' })
    frameLeft: Sprite = null!;

    @property({ group: '属性框', type: Sprite, tooltip: 'Stats/Right/Frame：右属性框' })
    frameRight: Sprite = null!;

    @property({ group: '角色', type: Sprite, tooltip: 'Hero：英雄立绘，同时作为骨骼加载失败时的兜底' })
    hero: Sprite = null!;

    @property({ group: '角色', type: Sprite, tooltip: 'Hero/Shadow：脚下影子' })
    shadow: Sprite = null!;

    @property({ group: '头部', type: Sprite, tooltip: 'Header/Quality：品质徽章' })
    quality: Sprite = null!;

    @property({ group: '头部', type: Sprite, tooltip: 'Header/Class/Icon：职业图标' })
    classIcon: Sprite = null!;

    @property({ group: '头部', type: Label, tooltip: 'Header/Name：卡牌名' })
    nameLabel: Label = null!;

    @property({ group: '头部', type: Label, tooltip: 'Header/Class/Label：职业名' })
    classLabel: Label = null!;

    @property({ group: '等级', type: Label, tooltip: 'Level/Bar/Label：等级' })
    levelLabel: Label = null!;

    @property({ group: '等级', type: Node, tooltip: 'Level/Progress：进度条整组' })
    progressRoot: Node = null!;

    @property({ group: '等级', type: Sprite, tooltip: 'Level/Progress/Fill：绿色进度填充' })
    progressFill: Sprite = null!;

    @property({ group: '等级', type: Label, tooltip: 'Level/Progress/Label：材料进度' })
    progressLabel: Label = null!;

    @property({ group: '属性', type: Label, tooltip: 'Stats/Left/Hp/Value：生命值' })
    hpValue: Label = null!;

    @property({ group: '属性', type: Label, tooltip: 'Stats/Left/Hp/Gain：生命增量' })
    hpGain: Label = null!;

    @property({ group: '属性', type: Label, tooltip: 'Stats/Right/Attack/Value：攻击力' })
    attackValue: Label = null!;

    @property({ group: '属性', type: Label, tooltip: 'Stats/Right/Attack/Gain：攻击增量' })
    attackGain: Label = null!;

    @property({ group: '增益', type: Node, tooltip: 'Bonus：底部战斗力增益条' })
    bonusRoot: Node = null!;

    @property({ group: '增益', type: RichText, tooltip: 'Bonus/Desc：增益描述（主色+高亮）' })
    bonusDesc: RichText = null!;

    @property({ group: '弹窗', type: Node, tooltip: 'TapArea：1×1 隐藏节点，令整屏点击都按空白关闭' })
    tapArea: Node = null!;

    protected onInit(): void {
        this.progressFillUi = this.progressFill.getComponent(UITransform);
        this.heroPreview = new CardUnitPreview(this.hero, HERO_VISIBLE_HEIGHT);
        this.contentNodes = [this.tapArea];
    }

    protected onOpen(userData?: ICardUpgradedContent): void {
        if (userData) this.render(userData);
    }

    onDestroy(): void {
        this.heroPreview?.clear();
        this.heroPreview = null;
        super.onDestroy();
    }

    render(content: ICardUpgradedContent): void {
        this.background.spriteFrame = content.background;
        this.background.node.active = !!content.background;

        this.frameLeft.spriteFrame = content.frame;
        this.frameRight.spriteFrame = content.frame;
        this.frameLeft.node.active = !!content.frame;
        this.frameRight.node.active = !!content.frame;

        const showHero = !!content.hero || !!content.heroPrefab;
        this.heroPreview?.clear();
        this.hero.spriteFrame = content.hero;
        this.hero.enabled = !!content.hero;
        this.hero.node.active = showHero;
        this.shadow.node.active = showHero;
        if (content.heroPrefab) {
            try {
                if (!this.heroPreview?.show(content.heroPrefab)) {
                    this.hero.enabled = !!content.hero;
                }
            } catch (error) {
                console.warn('[CardUpgradedPage] 骨骼 idle 启动失败，回退静态立绘', error);
                this.heroPreview?.clear();
                this.hero.spriteFrame = content.hero;
                this.hero.node.active = !!content.hero;
                this.hero.enabled = !!content.hero;
                this.shadow.node.active = !!content.hero;
            }
        }

        this.quality.spriteFrame = content.quality;
        this.quality.node.active = !!content.quality;

        this.classIcon.spriteFrame = content.classIcon;
        this.classIcon.node.active = !!content.classIcon && !!content.className;
        this.nameLabel.string = content.name;
        this.classLabel.string = content.className;

        this.levelLabel.string = content.levelText;

        this.progressRoot.active = content.progressText.length > 0;
        this.progressLabel.string = content.progressText;
        const ratio = Math.max(0, Math.min(1, content.progressRatio));
        this.progressFill.node.active = ratio > 0;
        // 设计稿填充段从外框内侧起算，按比例裁切；0 时整段隐藏。
        if (this.progressFillUi) this.progressFillUi.width = 436 * ratio;

        this.hpValue.string = content.hpValue;
        this.hpGain.string = content.hpGain;
        this.attackValue.string = content.attackValue;
        this.attackGain.string = content.attackGain;

        this.bonusRoot.active = content.bonusText.length > 0;
        this.bonusDesc.string = content.bonusText;
    }
}
