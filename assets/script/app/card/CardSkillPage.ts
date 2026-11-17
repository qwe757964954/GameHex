import { _decorator, Button, Color, Label, Node, Sprite } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { EventMgr } from '../../framework/event/EventMgr';
import { Toast } from '../common/Toast';
import { CARD_LINEUP_TEXTS } from './CardLineupTexts';
import type { CardSkillListPresentation, ICardSkillCost } from './CardPresentations';
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
        this.renderCost(this.coinIcon, this.coinLabel, costs[0]);
        this.renderCost(this.materialIcon, this.materialLabel, costs[1]);
    }

    /**
     * 一项升级消耗：图标 + 数量各是一组（prefab 里 `CoinCost` / `MaterialCost` 两个节点）。
     *
     * `cost` 缺省 = 这一档没有这项消耗（满级 / 表里没配）：整组收起，文案与颜色一并复位，
     * 同一个弹窗换技能复用时不会留下上一档的数字。`frame` 为 null 是合法的「图还没到」，
     * 这时不空着数量，退化成「名字 + 数量」。
     */
    private renderCost(icon: Sprite, label: Label, cost: ICardSkillCost | undefined): void {
        icon.spriteFrame = cost?.frame ?? null;
        icon.node.parent.active = !!cost;
        label.string = cost ? (cost.frame ? String(cost.need) : `${cost.name} ${cost.need}`) : '';
        label.color = cost && cost.owned < cost.need ? this.insufficientColor : this.enoughColor;
    }

    notify(kind: 'offline' | 'failed'): void {
        Toast.show(kind === 'offline' ? CARD_LINEUP_TEXTS.skillUpgradeOffline : CARD_LINEUP_TEXTS.skillUpgradeFailed);
    }
    private readonly onUpgradeClick = (): void => {
        EventMgr.instance.emit(CardPopupEvent.SkillIntent, { owner: this });
    };
}
