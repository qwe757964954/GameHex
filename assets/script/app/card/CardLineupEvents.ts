import type { CardLineupData } from './CardRepository';
import type { ZCDeckCard } from '../zcds/model/ZCCombatCatalog';
/**
 * 卡牌阵容和布阵面板之间的事件契约，只放事件名和 payload。
 * 保存结果走事件而不是回调，面板开着时保存也能立刻刷新外面。
 * 本文件不 import cc，保证单测能直接 require。
 */

/** 本链条对外派发的全部事件名。 */
export const CardLineupEvent = {
    /**
     * 出战阵型变了（服务端已确认）。保存成功和切页签选中都会发。
     */
    DeckSaved: 'card-lineup-deck-saved',
    /**
     * 某张卡升级成功（服务端已确认）。
     * 原来靠 onUpgraded 回调，漏传就静默不刷新；现在谁关心谁订阅。
     */
    HeroUpgraded: 'card-lineup-hero-upgraded',
    /**
     * 技能行点了上下切换。payload = ISkillStepPayload。
     */
    SkillStep: 'card-skill-step',
} as const;

/** `CardLineupEvent` 的取值类型（`as const` 派生，别手写第二份字符串字面量）。 */
export type CardLineupEventName = typeof CardLineupEvent[keyof typeof CardLineupEvent];

/** 出战阵型变更时带的业务数据：够订阅方决定「要不要刷、刷哪一格」。 */
export interface ICardDeckSavedPayload {
    /** 被保存或切换选中的阵型编号（1 起）。 */
    readonly formationId: number;
    /** 该阵型当前的完整英雄列表（保存走服务端确认值，切页签走本地草稿）。 */
    readonly heroIds: readonly number[];
}

/** 升级成功时带的业务数据。 */
export interface IHeroUpgradedPayload {
    /** 英雄编号（与 `pvpCard.id` 同一套）。 */
    readonly heroId: number;
    /** 服务端确认后的新等级。 */
    readonly level: number;
}

/** 技能行按钮：`direction = -1` 本地往回看一档；`+1` 发技能升级请求。 */
export interface ISkillStepPayload {
    readonly skillId: number;
    readonly direction: 1 | -1;
}

export const CardLineupUiEvent = {
    Intent: 'card-lineup:intent', Render: 'card-lineup:render',
} as const;
/** owner 限定当前页；编辑与升级只报意图，数据更新由控制器发布。 */
export interface ICardLineupIntent {
    readonly owner: object;
    readonly kind: 'edit' | 'upgrade' | 'refresh';
    readonly card?: ZCDeckCard;
}
export interface ICardLineupRender { readonly owner: object; readonly data: CardLineupData; }
