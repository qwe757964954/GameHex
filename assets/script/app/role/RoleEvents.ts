import type { RoleBagTabId, RoleNavId } from './RoleTypes';

export const RoleEvent = {
    Intent: 'role:intent',
    WashConfirmed: 'role:washConfirmed',
    GemChanged: 'role:gemChanged',
} as const;
/** 当前角色页的背包选择或左侧功能导航。 */
export type IRoleIntent =
    | { readonly kind: 'bag'; readonly tab: RoleBagTabId }
    | { readonly kind: 'nav'; readonly navId: RoleNavId }
    | { readonly kind: 'gem'; readonly id: string }
    | { readonly kind: 'socket'; readonly partId: number; readonly order: number }
    | { readonly kind: 'compose' }
    | { readonly kind: 'forge'; readonly partId?: number }
    | { readonly kind: 'equip'; readonly id: string }
    | { readonly kind: 'equipPart'; readonly partId: number }
    | { readonly kind: 'gemFilter' };
