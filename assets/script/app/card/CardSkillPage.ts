import { _decorator, Button, Color, Label, Node, Sprite } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { EventMgr } from '../../framework/event/EventMgr';
import { Toast } from '../common/Toast';
import { CARD_LINEUP_TEXTS } from './CardLineupTexts';
import type { CardSkillListPresentation } from './CardPresentations';
import { CardSkillTierView } from './CardSkillTierView';
import { CardPopupEvent } from './CardPopupEvents';
import { skillLevelRow } from './CardSkillList';
import { VirtualScrollView } from '../../vscrollview/VScrollView';

export type { ICardSkillOpenData } from './CardPresentations';
const { ccclass, property } = _decorator;

/** 单技能弹窗；输入与渲染，升级规则和请求由会话控制器处理。 */
@ccclass('CardSkillPage')
export class CardSkillPage extends PopupBase {
    static prefabPath = 'ui/card/CardSkill';
    @property(Label) nameLabel: Label = null!;
    @property(Label) kindLabel: Label = null!;
    @property(Label) cooldownLabel: Label = null!;
    @property(Label) cooldownValue: Label = null!;
    @property(Node) skillSkin: Node = null!;
    @property(VirtualScrollView) tierScroll: VirtualScrollView = null!;
    @property(Button) upgradeButton: Button = null!;
    @property(Label) upgradeLabel: Label = null!;
    @property(Sprite) coinIcon: Sprite = null!;
    @property(Label) coinLabel: Label = null!;
    @property(Sprite) materialIcon: Sprite = null!;
    @property(Label) materialLabel: Label = null!;
    @property(Color) enoughColor = new Color(255, 255, 255, 255);
    @property(Color) insufficientColor = new Color(255, 119, 93, 255);
    private state: CardSkillListPresentation | null = null;

    protected onInit(): void {
        this.tierScroll.getItemTypeIndexFn = () => 0;
        this.tierScroll.renderItemFn = (node, index) => {
            const row = this.state?.rows[0];
            node.getComponent(CardSkillTierView).render(row?.skill.levels[index] ?? null, row?.level ?? 0, this.state?.heroLevel ?? 0);
        };
        this.upgradeButton.node.on(Button.EventType.CLICK, this.onUpgradeClick, this);
    }
    protected onOpen(): void { this.render(null); }
    protected onClose(): void { this.render(null); }

    render(state: CardSkillListPresentation | null): void {
        this.state = state;
        const row = state?.rows[0];
        const texts = CARD_LINEUP_TEXTS;
        this.skillSkin.active = !!row;
        this.nameLabel.string = row ? row.skill.name || `${texts.skillNameFallback}${row.skill.skillId}` : '';
        this.kindLabel.node.parent.active = !!state?.skillKind;
        this.kindLabel.string = state?.skillKind === 'active' ? texts.skillActive : state?.skillKind ? texts.skillPassive : '';
        const hasCooldown = !!state && state.cooldown > 0;
        this.cooldownLabel.node.active = hasCooldown;
        this.cooldownValue.node.active = hasCooldown;
        this.cooldownLabel.string = texts.skillCooldown;
        this.cooldownValue.string = hasCooldown ? `${state.cooldown}${texts.skillSeconds}` : '';
        this.tierScroll.refreshList(row?.skill.levels.length ?? 0);
        this.upgradeButton.interactable = !!state?.canUpgrade;
        const next = row ? skillLevelRow(row.skill, row.level + 1) : undefined;
        this.upgradeLabel.string = state?.busy ? texts.skillUpgradeSending : row && !next ? texts.upgradeMaxed : texts.skillUpgradeSingle;
        const costs = state?.costs ?? [];
        [this.coinIcon, this.materialIcon].forEach((icon, index) => {
            const cost = costs[index];
            const label = index === 0 ? this.coinLabel : this.materialLabel;
            icon.spriteFrame = cost?.frame ?? null;
            icon.node.parent.active = !!cost;
            label.string = cost ? (cost.frame ? String(cost.need) : `${cost.name} ${cost.need}`) : '';
            label.color = cost && cost.owned < cost.need ? this.insufficientColor : this.enoughColor;
        });
    }
    notify(kind: 'offline' | 'failed'): void {
        Toast.show(kind === 'offline' ? CARD_LINEUP_TEXTS.skillUpgradeOffline : CARD_LINEUP_TEXTS.skillUpgradeFailed);
    }
    private readonly onUpgradeClick = (): void => {
        EventMgr.instance.emit(CardPopupEvent.SkillIntent, { owner: this });
    };
}
