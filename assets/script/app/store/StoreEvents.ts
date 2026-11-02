import type { StoreActionKind, IStoreActionContext } from './StoreActions';

export const StoreEvent = { Action: 'store:action' } as const;
/** 分段按钮的业务意图，owner 为商城根页；避免多实例互相消费。 */
export interface IStoreActionEvent {
    readonly owner: object;
    readonly kind: StoreActionKind;
    readonly context: IStoreActionContext;
}
