import type { ResourceScope } from './ResourceScope';

export class ResourceLoadCancelledError extends Error {
    constructor() { super('资源加载已取消'); this.name = 'ResourceLoadCancelledError'; }
}

interface IQueuedResourceLoad {
    readonly priority: () => number;
    readonly start: () => void;
    readonly cancel: () => void;
}

/** 根加载调度；逻辑取消不会释放尚在引擎中运行的物理名额。 */
export class ResourceLoadQueue {
    private readonly queued: IQueuedResourceLoad[] = [];
    private readonly pending = new Set<IQueuedResourceLoad>();
    private active = 0;
    private disposed = false;

    constructor(private readonly maxConcurrentLoads: number) {
        if (!Number.isSafeInteger(maxConcurrentLoads) || maxConcurrentLoads < 1) {
            throw new Error('无效的资源加载并发预算');
        }
    }

    run<T>(load: () => Promise<T>, scope?: ResourceScope, priority: () => number = () => 0,
        hasUsers?: () => boolean): Promise<T> {
        if (this.disposed || scope?.disposed) return Promise.reject(new ResourceLoadCancelledError());
        return new Promise<T>((resolve, reject) => {
            let settled = false;
            let detach: () => void = () => {};
            const settle = (complete: () => void): void => {
                if (settled) return;
                settled = true;
                detach();
                this.pending.delete(task);
                complete();
            };
            const task: IQueuedResourceLoad = {
                priority,
                cancel: () => {
                    const index = this.queued.indexOf(task);
                    if (index >= 0) this.queued.splice(index, 1);
                    settle(() => reject(new ResourceLoadCancelledError()));
                },
                start: () => {
                    if (scope?.disposed || (hasUsers && !hasUsers())) { task.cancel(); return; }
                    this.active++;
                    let operation: Promise<T>;
                    try { operation = load(); }
                    catch (error) { operation = Promise.reject(error); }
                    void Promise.resolve(operation).then(
                        value => settle(() => resolve(value)),
                        error => settle(() => reject(error)),
                    ).then(() => {
                        this.active--;
                        this.dispatch();
                    });
                },
            };
            this.pending.add(task);
            if (scope) detach = scope.defer(task.cancel);
            this.queued.push(task);
            this.dispatch();
        });
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const task of this.pending) task.cancel();
    }

    private dispatch(): void {
        while (!this.disposed && this.active < this.maxConcurrentLoads && this.queued.length) {
            let next = 0;
            for (let index = 1; index < this.queued.length; index++) {
                if (this.queued[index].priority() > this.queued[next].priority()) next = index;
            }
            this.queued.splice(next, 1)[0].start();
        }
    }
}
