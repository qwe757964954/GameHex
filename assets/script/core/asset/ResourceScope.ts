/**
 * 一组资源引用的生命周期边界。
 *
 * Scope 本身不依赖 Cocos；具体资源实现把释放动作登记进来。页面/流程退出时
 * dispose，即可按与加载相反的顺序释放本次进入期间持有的资源。
 */
export class ResourceScope {
    private releases: Array<() => void> = [];
    private _disposed = false;

    constructor(public readonly name: string) {}

    get disposed(): boolean {
        return this._disposed;
    }

    /** 登记释放动作；返回值只解除本次登记，不执行释放。 */
    defer(release: () => void): () => void {
        if (this._disposed) {
            release();
            return () => {};
        }
        const registered = () => release();
        this.releases.push(registered);
        return () => {
            const index = this.releases.indexOf(registered);
            if (index >= 0) this.releases.splice(index, 1);
        };
    }

    dispose(): void {
        if (this._disposed) return;
        this._disposed = true;
        // 先取出快照，释放回调解除其他登记时不会改变本轮遍历。
        const releases = this.releases.splice(0);
        for (let i = releases.length - 1; i >= 0; i--) {
            try {
                releases[i]();
            } catch (error) {
                console.error(`[ResourceScope:${this.name}] 释放资源失败`, error);
            }
        }
    }
}
