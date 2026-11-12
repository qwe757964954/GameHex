export const CardPopupEvent = {
    UpgradeIntent: 'card-popup:upgrade-intent',
    BoardIntent: 'card-popup:board-intent',
    SkillIntent: 'card-popup:skill-intent',
} as const;

/** owner isolates concurrently open popup instances. */
export type CardUpgradeIntent = { readonly owner: object } & (
    { readonly kind: 'skills'; readonly skillId: number } |
    { readonly kind: 'submit' | 'previous' | 'next' }
);
export type LineupBoardIntent = { readonly owner: object } & (
    { readonly kind: 'toggle'; readonly cardId: string } |
    { readonly kind: 'preset'; readonly index: number } |
    { readonly kind: 'reset' | 'save' }
);
