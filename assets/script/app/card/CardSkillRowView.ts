import { _decorator, Button, Color, Component } from 'cc';
import type { CardSkillListPresentation, CardSkillRowPresentation } from './CardPresentations';
import { CardSkillSlotView } from './CardSkillSlotView';
import { CardLineupEvent } from './CardLineupEvents';
import type { ISkillStepPayload } from './CardLineupEvents';
import { EventMgr } from '../../framework/event/EventMgr';

const { ccclass, property } = _decorator;

/** 一行一个技能；布局与引用由 CardSkillRow.prefab 维护。 */
@ccclass('CardSkillRowView')
export class CardSkillRowView extends Component {
    @property({ type: CardSkillSlotView, tooltip: '技能展示组件' })
    slot: CardSkillSlotView = null!;

    @property({ type: Button, tooltip: '升级按钮' })
    upgradeButton: Button = null!;

    colors: { active: Color; locked: Color } | null = null;
    private skillId = 0;

    onLoad(): void {
        this.upgradeButton.node.on(Button.EventType.CLICK, this.onUpgrade, this);
    }

    render(item: CardSkillRowPresentation, data: CardSkillListPresentation | null): void {
        this.skillId = item.skill.skillId;
        this.slot.render(item, data, this.colors ?? undefined);
    }

    private onUpgrade(): void {
        if (this.skillId <= 0) return;
        EventMgr.instance.emit(CardLineupEvent.SkillStep, {
            skillId: this.skillId, direction: 1,
        } satisfies ISkillStepPayload);
    }

}
