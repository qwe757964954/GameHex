export const CardPopupEvent = {
    UpgradeIntent: 'card-popup:upgrade-intent',
    BoardIntent: 'card-popup:board-intent',
    SkillIntent: 'card-popup:skill-intent',
} as const;

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
