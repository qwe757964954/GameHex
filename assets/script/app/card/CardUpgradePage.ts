import { _decorator, Button, Color, Label, Sprite } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { cardArtProvider } from './CardArtProvider';
import { CARD_LINEUP_TEXTS } from './CardLineupTexts';
import { upgradeButtonText } from './CardUpgradeCost';
import type { ZCUpgradeStatus } from './CardUpgradeCost';
import { applyCardHeadArt } from './CardHeadView';
import { CardPopupEvent } from './CardPopupEvents';
import { EventMgr } from '../../framework/event/EventMgr';
import type {
    CardUpgradePhase,
    CardUpgradePresentation,
} from './CardPresentations';

export type { ICardUpgradeOpenData } from './CardPresentations';

const { ccclass, property } = _decorator;

/** 卡牌升级视图：渲染外部会话快照，按钮仅派发意图。 */
@ccclass('CardUpgradePage')
export class CardUpgradePage extends PopupBase {
    private artRevision = 0;
    /** 弹窗预制体在 resources 下的路径（`PopupManager` 用它加载）。 */
    static prefabPath = 'ui/card/CardUpgrade';

    @property({ type: Label, tooltip: 'Title/Label：标题「卡牌升级」' })
    titleLabel: Label = null!;

    @property({ type: Button, tooltip: 'CloseBtn 上的 cc.Button（**绑组件不绑节点**）' })
    closeButton: Button = null!;

    @property({ type: Sprite, tooltip: 'Card/Face：卡面底图（common_img_kp_01..04，按品级换图）' })
    cardFace: Sprite = null!;

    @property({ type: Sprite, tooltip: 'Card/Badge：左上角职业角标（class_*）' })
    cardBadge: Sprite = null!;

    @property({ type: Sprite, tooltip: 'Card/Hero：职业营地雕像（camp_*）' })
    cardHero: Sprite = null!;

    @property({ type: Sprite, tooltip: 'Card/HeadIcon：该卡自己的头像（84×84，与 Hero 互斥显示）' })
    cardHeadIcon: Sprite = null!;

    @property({ type: Label, tooltip: 'Info/NameLabel：卡牌名（如「精灵弓箭手」）' })
    nameLabel: Label = null!;

    @property({ type: Label, tooltip: 'Info/LevelLabel：等级，写成「3级 → 4级」；已满级时只写当前等级' })
    levelLabel: Label = null!;

    @property({ type: Label, tooltip: 'CostCard/NameLabel：消耗行名称「卡牌」' })
    cardCostNameLabel: Label = null!;

    @property({ type: Label, tooltip: 'CostCard/CountLabel：卡牌数量「持有/需要」' })
    cardCostCountLabel: Label = null!;

    @property({ type: Label, tooltip: 'CostCard/ItemLabel：小字，写被消耗卡牌的道具 id' })
    cardCostItemLabel: Label = null!;

    @property({ type: Label, tooltip: 'CostExp/NameLabel：消耗行名称「经验」' })
    expCostNameLabel: Label = null!;

    @property({ type: Label, tooltip: 'CostExp/CountLabel：经验数量「合计持有/需要」（通用 + 兵种）' })
    expCostCountLabel: Label = null!;

    @property({ type: Label, tooltip: 'CostExp/ItemLabel：小字，写「通用 16000 + 兵种 16003」' })
    expCostItemLabel: Label = null!;

    @property({ type: Label, tooltip: 'Hint：底部提示（材料不足原因 / 未连接 / 已满级）' })
    hintLabel: Label = null!;

    @property({ type: Button, tooltip: 'BtnUpgrade 上的 cc.Button（**绑组件不绑节点**）' })
    upgradeButton: Button = null!;

    @property({ type: Label, tooltip: 'BtnUpgrade/Label：按钮文案' })
    upgradeLabel: Label = null!;

    /**
     * 「技能」按钮：打开独立的技能面板弹窗。
     *
     * 技能列表**不塞进本弹窗**：本弹窗纵向已被卡面 / 信息 / 消耗 / 经验 / 提示 /
     * 升级按钮占满（背景 651×982），硬塞会与「卡牌」「经验」两行文字重叠。
     * 允许为空 —— 没配这个按钮时技能入口就只从卡牌页走。
     */
    @property({ type: Button, tooltip: 'BtnSkill 上的 cc.Button（**绑组件不绑节点**；可留空）' })
    skillButton: Button | null = null;

    @property({ type: Color, tooltip: '材料已满足时的文字颜色（样式放 Inspector，代码不写死）' })
    enoughColor: Color = new Color(104, 218, 59, 255);

    @property({ type: Color, tooltip: '材料不足时的文字颜色' })
    lackColor: Color = new Color(226, 88, 74, 255);

    @property({ type: Color, tooltip: '已满级 / 无配置时的文字颜色' })
    idleColor: Color = new Color(176, 168, 150, 255);

    protected onInit(): void {
        this.titleLabel.string = CARD_LINEUP_TEXTS.upgradeTitle;
        this.cardCostNameLabel.string = CARD_LINEUP_TEXTS.upgradeCardRow;
        this.expCostNameLabel.string = CARD_LINEUP_TEXTS.upgradeExpRow;
        //  打开瞬间的初始文案由 render 按真实等级覆盖。
        //  按「1 级」写，于是仍然是「升级」；走同一个函数是为了让按钮文案**只有一个来源**，
        //  否则 0 级卡在打开的第一帧会闪一下「升级」。
        this.upgradeLabel.string = upgradeButtonText(1, false);

        //  CLICK 是挂在**节点**上的（Button 自身没有 on），别写成 button.on(...)。
        this.closeButton.node.on(Button.EventType.CLICK, this.onCloseClick, this);
        this.upgradeButton.node.on(Button.EventType.CLICK, this.onUpgradeClick, this);
        this.skillButton?.node.on(Button.EventType.CLICK, this.onSkillClick, this);
    }

    protected onOpen(): void {
        this.upgradeButton.interactable = false;
        this.cardFace.spriteFrame = null;
        this.cardBadge.spriteFrame = null;
        applyCardHeadArt({ hero: this.cardHero, headIcon: this.cardHeadIcon }, null, null);
    }

    private readonly onSkillClick = (): void => {
        EventMgr.instance.emit(CardPopupEvent.UpgradeIntent, { owner: this, kind: 'skills' });
    };

    /** 唯一的写 UI 入口：卡面 → 升级状态。 */
    render(data: CardUpgradePresentation): void {
        this.nameLabel.string = data.data.card?.name ?? data.cardId;
        this.renderCardFace(data);
        if (data.status) {
            this.renderStatus(data.status, data.phase);
            return;
        }
        this.upgradeButton.interactable = false;
        //  提交中按钮文案保持常态（「升级」/「解锁」）：进行中的状态提示由通用 loading 全屏承担，
        //  按钮不再显示「升级中…」，避免 loading 遮罩下按钮文案与 loading 文字重复。
        this.upgradeLabel.string = upgradeButtonText(data.level, false);
        this.levelLabel.string = `${data.level}${CARD_LINEUP_TEXTS.levelSuffix}`;
        this.cardCostCountLabel.string = '';
        this.cardCostItemLabel.string = '';
        this.expCostCountLabel.string = '';
        this.expCostItemLabel.string = '';
        this.cardCostCountLabel.color = this.idleColor;
        this.expCostCountLabel.color = this.idleColor;
        this.hintLabel.color = this.lackColor;
        this.hintLabel.string = data.phase === 'failed' ? CARD_LINEUP_TEXTS.upgradeFailed : '';
    }

    /** 组件所在节点是否仍然有效（面板随时可能被关掉，`close()` 是直接 destroy）。 */
    private get alive(): boolean {
        return !!this.node && this.node.isValid;
    }

    /** 卡面四张图：与卡库里那张卡同一套映射（品级 → 卡面，职业 → 角标 / 雕像，头像 → 按卡）。 */
    private renderCardFace(data: CardUpgradePresentation): void {
        const card = data.data.card;
        const scope = this.resourceScope;
        const revision = ++this.artRevision;
        if (!card) {
            this.cardFace.spriteFrame = null;
            this.cardBadge.spriteFrame = null;
            applyCardHeadArt({ hero: this.cardHero, headIcon: this.cardHeadIcon }, null, null);
            return;
        }
        void cardArtProvider.loadLineupCard(card).then((frames) => {
            if (scope.disposed || !this.alive || revision !== this.artRevision) return;
            this.cardFace.spriteFrame = frames.face;
            this.cardBadge.spriteFrame = frames.badge;
            // 与卡库同一入口：有头像铺头像、没头像退回雕像立绘（互斥显隐）。
            //  本类的两个 Sprite 叫 `cardHero` / `cardHeadIcon`（不是 `hero` / `headIcon`），
            //  结构上不满足 `CardHeadSlots`，所以显式组一个 —— 别为了少写这行去改名，
            //  这两个属性名是 prefab 上已绑的。
            applyCardHeadArt({ hero: this.cardHero, headIcon: this.cardHeadIcon }, frames.hero, frames.head);
        }).catch(error => { if (!scope.disposed && this.alive) console.error('[CardUpgradePage] 卡面加载失败', error); });
    }

    /** 把判定结果铺到界面上（这是本弹窗**唯一**的写 UI 入口）。 */
    private renderStatus(status: ZCUpgradeStatus, phase: CardUpgradePhase): void {
        const texts = CARD_LINEUP_TEXTS;

        // ---- 等级：可升时写「3级 → 4级」，满级 / 无配置只写当前等级 ----
        const current = `${status.level}${texts.levelSuffix}`;
        if (status.configured && !status.maxed) {
            this.levelLabel.string = `${current}${texts.upgradeLevelArrow}${status.targetLevel}${texts.levelSuffix}`;
        } else {
            this.levelLabel.string = current;
        }

        // ---- 两行材料 ----
        const [cardRow, expRow] = status.requirements;
        if (cardRow) {
            this.cardCostCountLabel.string = `${cardRow.owned}${texts.progressSeparator}${cardRow.need}`;
            this.cardCostCountLabel.color = cardRow.enough ? this.enoughColor : this.lackColor;
            this.cardCostItemLabel.string = `ID ${cardRow.itemId}`;
        } else {
            this.cardCostCountLabel.string = `${texts.progressSeparator}${texts.progressSeparator}`;
            this.cardCostCountLabel.color = this.idleColor;
            this.cardCostItemLabel.string = '';
        }
        if (expRow) {
            this.expCostCountLabel.string = `${expRow.owned}${texts.progressSeparator}${expRow.need}`;
            this.expCostCountLabel.color = expRow.enough ? this.enoughColor : this.lackColor;
            // 经验是「通用 + 兵种」合计 —— 把拆分写在下面，否则玩家看不懂这个和是怎么来的。
            this.expCostItemLabel.string =
                `${texts.upgradeExpDetail} ${status.generalExpOwned}` +
                `${texts.upgradeExpDetailJoin}${status.armyExpOwned}`;
        } else {
            this.expCostCountLabel.string = `${texts.progressSeparator}${texts.progressSeparator}`;
            this.expCostCountLabel.color = this.idleColor;
            this.expCostItemLabel.string = '';
        }

        // ---- 按钮与提示 ----
        if (!status.configured) {
            this.hintLabel.string = texts.upgradeNoConfig;
            this.hintLabel.color = this.idleColor;
            this.upgradeLabel.string = upgradeButtonText(status.level, false);
            this.upgradeButton.interactable = false;
            return;
        }
        if (status.maxed) {
            this.hintLabel.string = '';
            this.upgradeLabel.string = texts.upgradeMaxed;
            this.upgradeButton.interactable = false;
            return;
        }
        const submitting = phase === 'submitting';
        //  提交中按钮文案保持常态：进行中由通用 loading 提示，
        //  不显示「升级中…」（`submitting` 仍用于按钮置灰与提示分支）。
        this.upgradeLabel.string = upgradeButtonText(status.level, false);
        if (phase === 'offline' || phase === 'failed') {
            this.hintLabel.string = phase === 'offline' ? texts.upgradeOffline : texts.upgradeFailed;
            this.hintLabel.color = this.lackColor;
            this.upgradeButton.interactable = status.canUpgrade;
            return;
        }
        this.hintLabel.string = status.canUpgrade ? '' : status.blockedReason;
        this.hintLabel.color = status.canUpgrade ? this.enoughColor : this.lackColor;
        this.upgradeButton.interactable = status.canUpgrade && !submitting;
    }

    private onCloseClick(): void {
        this.closeByButton();
    }

    private readonly onUpgradeClick = (): void => {
        EventMgr.instance.emit(CardPopupEvent.UpgradeIntent, { owner: this, kind: 'submit' });
    };

    protected onClose(): void { this.artRevision++; }
}
