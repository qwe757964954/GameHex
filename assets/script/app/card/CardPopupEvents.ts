export const CardPopupEvent = {
    UpgradeIntent: 'card-popup:upgrade-intent',
    BoardIntent: 'card-popup:board-intent',
} as const;

/** owner isolates concurrently open popup instances. */
export interface CardUpgradeIntent {
    readonly owner: object;
    readonly kind: 'submit' | 'skills';
}
export type LineupBoardIntent = { readonly owner: object } & (
    { readonly kind: 'toggle'; readonly cardId: string } |
    { readonly kind: 'preset'; readonly index: number } |
    { readonly kind: 'reset' | 'save' }
);
