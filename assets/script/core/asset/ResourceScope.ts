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

    /** 由资源适配器登记一个幂等释放动作。 */
    defer(release: () => void): void {
        if (this._disposed) {
            release();
            return;
        }
        this.releases.push(release);
    }

    dispose(): void {
        if (this._disposed) return;
        this._disposed = true;
        for (let i = this.releases.length - 1; i >= 0; i--) {
            try {
                this.releases[i]();
            } catch (error) {
                console.error(`[ResourceScope:${this.name}] 释放资源失败`, error);
            }
        }
        this.releases.length = 0;
    }
}
