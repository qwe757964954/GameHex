import type { RoleBagTabId, RoleNavId } from './RoleTypes';

export const RoleEvent = { Intent: 'role:intent' } as const;
/** 当前角色页的背包选择或左侧功能导航。 */
export type IRoleIntent = { readonly owner: object } & (
    | { readonly kind: 'bag'; readonly tab: RoleBagTabId }
    | { readonly kind: 'nav'; readonly navId: RoleNavId }
);
