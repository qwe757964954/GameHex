import type { IBigMapViewState } from './BigMapViewState';

export const BIGMAP_MOVE_HINT = '点击空地移过去；点这格取消';

export const BigMapUiEvent = { Intent: 'bigmap:ui-intent', Ready: 'bigmap:view-ready', Disposed: 'bigmap:view-disposed' } as const;
export const BigMapViewEvent = { Render: 'bigmap:render', Command: 'bigmap:view-command' } as const;

export type BigMapIntent =
    | { readonly kind: 'worldTap' | 'plotTap'; readonly hexId: number }
    | { readonly kind: 'build'; readonly buildingKind: number }
    | { readonly kind: 'harvest'; readonly instanceId: number }
    | { readonly kind: 'visibleCamps'; readonly campIds: readonly number[] }
    | { readonly kind: 'mode'; readonly mode: 'world' | 'base' }
    | { readonly kind: 'primary' | 'secondary' | 'clear' | 'toggleBuildMenu' | 'harvestAll' };

export interface IBigMapIntentEvent { readonly intent: BigMapIntent }
export type BigMapViewCommand =
    | { readonly kind: 'focusWorld' | 'focusBase'; readonly hexId: number }
    | { readonly kind: 'feedback'; readonly ok: boolean; readonly message: string };
export interface IBigMapViewCommandEvent { readonly command: BigMapViewCommand }
export interface IBigMapRenderEvent { readonly state: IBigMapViewState }
