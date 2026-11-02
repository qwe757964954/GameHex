import type { AssetLoadOptions, AssetService, AssetType } from './AssetService';
import type { IResourceLoadBatch, IResourceLoadBatchOptions, IResourceLoadRequest } from './AssetService';
import { ResourceLoadCancelledError, ResourceLoadQueue } from './ResourceLoadQueue';
import { ResourceScope } from './ResourceScope';

export interface IResourceLoadManagerOptions {
    readonly maxConcurrentLoads: number;
}

/** 由组合根持有；只管理调度与批量任务，不另建资产缓存或改变资源所有权。 */
export class ResourceLoadManager implements AssetService {
    private readonly queue: ResourceLoadQueue;
    private disposed = false;

    constructor(private readonly delegate: AssetService, options: IResourceLoadManagerOptions) {
        this.queue = new ResourceLoadQueue(options.maxConcurrentLoads);
    }

    load<T>(path: string, type: AssetType<T>, options: AssetLoadOptions = {}): Promise<T> {
        return this.queue.run(() => this.delegate.load(path, type, options), options.scope, () => options.priority ?? 0);
    }

    loadDir<T>(path: string, type: AssetType<T>, options: AssetLoadOptions = {}): Promise<T[]> {
        return this.queue.run(() => this.delegate.loadDir(path, type, options), options.scope, () => options.priority ?? 0);
    }

    preload(path: string, options: AssetLoadOptions = {}): Promise<void> {
        const resolved = { ...options, priority: options.priority ?? -1 };
        return this.queue.run(() => this.delegate.preload?.(path, resolved) ?? Promise.resolve(),
            resolved.scope, () => resolved.priority);
    }

    async has<T>(path: string, type: AssetType<T>, options: AssetLoadOptions = {}): Promise<boolean> {
        if (this.disposed || options.scope?.disposed) throw new ResourceLoadCancelledError();
        const exists = await this.delegate.has(path, type, options);
        if (this.disposed || options.scope?.disposed) throw new ResourceLoadCancelledError();
        return exists;
    }

    /** 进度按清单项计数；成功资产由父作用域持有，取消与失败释放整个批次。 */
    loadBatch<T>(requests: readonly IResourceLoadRequest<T>[], options: IResourceLoadBatchOptions): IResourceLoadBatch<T> {
        const scope = new ResourceScope('resource-load-batch');
        const detach = options.scope.defer(() => scope.dispose());
        const total = requests.length;
        let completed = 0;
        let finished = false;
        const notify = (): void => options.onProgress?.({
            completed, total, ratio: total ? completed / total : 1,
        });
        const result = (async (): Promise<T[] | false> => {
            try {
                if (this.disposed || scope.disposed) { scope.dispose(); return false; }
                notify();
                const values = await Promise.all(requests.map(request => {
                    return this.load(request.path, request.type, { ...request.options, scope }).then(value => {
                        if (scope.disposed) throw new ResourceLoadCancelledError();
                        completed++;
                        try { notify(); }
                        catch (error) { scope.dispose(); throw error; }
                        return value;
                    }, error => { scope.dispose(); throw error; });
                }));
                if (scope.disposed) return false;
                return values;
            } catch (error) {
                scope.dispose();
                if (error instanceof ResourceLoadCancelledError) return false;
                throw error;
            } finally {
                finished = true;
                if (scope.disposed || total === 0) detach();
            }
        })();
        return { result, cancel: () => {
            if (finished) return;
            scope.dispose();
            detach();
        } };
    }

    dispose(): void {
        this.disposed = true;
        this.queue.dispose();
    }
}
