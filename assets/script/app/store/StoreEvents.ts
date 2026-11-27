import type { StoreActionKind, IStoreActionContext } from './StoreActions';

export const StoreEvent = {
    Action: 'store:action',
    Output: 'store:output',
} as const;
/** 分段按钮的业务意图，owner 为商城根页；避免多实例互相消费。 */
export interface IStoreActionEvent {
    readonly kind: StoreActionKind;
    readonly context: IStoreActionContext;
}

export type StoreOutput = { readonly kind: 'failed'; readonly error: unknown };
