import type {
    CardSkillListPresentation,
    ICardSkillOpenData,
    ICardUpgradeViewState,
    LineupBoardPresentation,
} from './CardPresentations';
import type { ICardUpgradedContent } from './CardUpgradedPresentation';

export const CardPopupEvent = {
    UpgradeIntent: 'card-popup:upgrade-intent',
    UpgradeOutput: 'card-popup:upgrade-output',
    BoardIntent: 'card-popup:board-intent',
    BoardOutput: 'card-popup:board-output',
    SkillIntent: 'card-popup:skill-intent',
    SkillOutput: 'card-popup:skill-output',
} as const;

/** 来源为产生输出的升级控制器。loading 的 level 为 null 时收起遮罩。 */
export type CardUpgradeOutput =
    | { readonly kind: 'render'; readonly state: ICardUpgradeViewState }
    | { readonly kind: 'loading'; readonly level: number | null }
    | { readonly kind: 'failed'; readonly error: unknown }
    | { readonly kind: 'openSkills'; readonly data: ICardSkillOpenData }
    | { readonly kind: 'openUpgraded'; readonly data: ICardUpgradedContent };

/** 来源为产生输出的布阵弹窗控制器。 */
export type LineupBoardOutput =
    | { readonly kind: 'render'; readonly state: LineupBoardPresentation }
    | { readonly kind: 'tip'; readonly text: string }
    | { readonly kind: 'close' }
    | { readonly kind: 'failed'; readonly error: unknown };

/** 来源为产生输出的技能升级控制器；未加载完成前 state 为 null。 */
export type CardSkillOutput =
    | { readonly kind: 'render'; readonly state: CardSkillListPresentation | null }
    | { readonly kind: 'notify'; readonly status: 'offline' | 'failed' }
    | { readonly kind: 'close' }
    | { readonly kind: 'failed'; readonly error: unknown };

/** 事件来源用于区分同时打开的卡牌弹窗。 */
export type CardUpgradeIntent = (
    { readonly kind: 'skills'; readonly skillId: number } |
    { readonly kind: 'submit' | 'previous' | 'next' }
);
export type LineupBoardIntent = (
    { readonly kind: 'toggle'; readonly cardId: string } |
    { readonly kind: 'preset'; readonly index: number } |
    { readonly kind: 'reset' | 'save' }
);
