/**
 * 卡牌阵容和布阵面板之间的事件契约，只放事件名和 payload。
 * 保存结果走事件而不是回调，面板开着时也能立刻刷新；本文件不 import cc。
 */
import type { CardLineupData } from './CardRepository';
import type { ZCDeckCard } from '../zcds/model/ZCCombatCatalog';

/** 本链条对外派发的事件名。 */
export const CardLineupEvent = {
    /** 出战阵型变了，保存成功和切页签选中都会发。 */
    DeckSaved: 'card-lineup-deck-saved',
    /** 某张卡升级成功；用事件替代旧回调，谁关心谁订阅。 */
    HeroUpgraded: 'card-lineup-hero-upgraded',
    /** 技能行点了上下切换，payload 为 ISkillStepPayload。 */
    SkillStep: 'card-skill-step',
} as const;

/** CardLineupEvent 的取值类型。 */
export type CardLineupEventName = typeof CardLineupEvent[keyof typeof CardLineupEvent];

/** 出战阵型变更的业务数据。 */
export interface ICardDeckSavedPayload {
    /** 被保存或切换选中的阵型编号。 */
    readonly formationId: number;
    /** 该阵型当前的英雄列表；保存用服务端确认值，切页签用本地草稿。 */
    readonly heroIds: readonly number[];
}

/** 升级成功的业务数据。 */
export interface IHeroUpgradedPayload {
    /** 英雄编号，与 pvpCard.id 同一套。 */
    readonly heroId: number;
    /** 服务端确认后的新等级。 */
    readonly level: number;
}

/** 技能行按钮：direction = -1 本地回看一档，+1 发技能升级请求。 */
export interface ISkillStepPayload {
    readonly skillId: number;
    readonly direction: 1 | -1;
}

export const CardLineupUiEvent = {
    Intent: 'card-lineup:intent', Render: 'card-lineup:render',
} as const;

/** 编辑与升级只报意图，数据更新由控制器发布。 */
export interface ICardLineupIntent {
    readonly kind: 'edit' | 'upgrade' | 'refresh';
    readonly card?: ZCDeckCard;
}

export interface ICardLineupRender {
    readonly data: CardLineupData;
}
