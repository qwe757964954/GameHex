import type { EquipEvolveTab, IRoleDecomposeResult, IRoleSnapshot, RoleBagTabId, RoleNavId } from './RoleTypes';

export const RoleEvent = {
    Intent: 'role:intent',
    Output: 'role:output',
    WashConfirmed: 'role:washConfirmed',
    GemChanged: 'role:gemChanged',
    /** 锻造写入已落地，控制器据此刷新角色页的红点、装备栏和背包。 */
    EquipChanged: 'role:equipChanged',
    /** 装备分解模式进入 / 退出 / 筛选变化：角色页据此切换顶部三个功能按钮的文案与显隐。 */
    DecomposeModeChanged: 'role:decomposeModeChanged',
    /** 装备分解弹窗的装备格点击。载荷为装备唯一 ID，来源为点击的格子实例。 */
    DecomposeItemClick: 'role:decomposeItemClick',
} as const;
/** 角色页派发给控制器的交互意图，涵盖导航、背包和养成操作。 */
export type IRoleIntent =
    | { readonly kind: 'bag'; readonly tab: RoleBagTabId }
    | { readonly kind: 'nav'; readonly navId: RoleNavId }
    | { readonly kind: 'gem'; readonly id: string }
    | { readonly kind: 'socket'; readonly partId: number; readonly order: number }
    | { readonly kind: 'compose' }
    | { readonly kind: 'decompose'; readonly ids: readonly string[] }
    | { readonly kind: 'forge'; readonly partId?: number }
    | { readonly kind: 'equip'; readonly id: string; readonly manage?: boolean }
    | { readonly kind: 'equipPart'; readonly partId: number }
    | { readonly kind: 'gemFilter' };

export type RoleOutput<T = IRoleSnapshot> =
    | { readonly kind: 'render'; readonly snapshot: T }
    | { readonly kind: 'selectBag'; readonly tab: RoleBagTabId }
    | { readonly kind: 'showBag'; readonly tab: RoleBagTabId; readonly filter?: number; readonly filterName?: string }
    | { readonly kind: 'openTalent' }
    | { readonly kind: 'openEquipInfo'; readonly partId: number; readonly bagUniqueId?: string }
    | { readonly kind: 'openEquipEvolve'; readonly partId?: number; readonly tab?: EquipEvolveTab }
    | { readonly kind: 'openGemInfo'; readonly gemId: string }
    | { readonly kind: 'openGongMing' }
    | ({ readonly kind: 'decomposeDone' } & IRoleDecomposeResult)
    | { readonly kind: 'tip'; readonly text: string }
    | { readonly kind: 'failed'; readonly error: unknown };
