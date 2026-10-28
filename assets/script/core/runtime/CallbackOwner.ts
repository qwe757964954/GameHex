/** 回调归属的注册与解除端口；宿主退出时主动释放，不读取组件状态。 */
export interface ICallbackOwnerRegistry {
    addCallerCleanup(owner: object, cleanup: () => void): () => void;
    removeCallerListener(owner: object): void;
}
