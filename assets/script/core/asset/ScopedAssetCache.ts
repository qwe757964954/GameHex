import type { AssetLoadOptions, AssetService, AssetType } from './AssetService';
import { ResourceScope } from './ResourceScope';
import { bundleForPath, RESOURCES_BUNDLE } from './BundleCatalog';

export interface IScopedAssetCacheOptions {
    readonly maxEntries: number;
    readonly idleMs: number;
    readonly maxConcurrentLoads?: number;
}

interface IAssetCacheEntry {
    readonly key: string;
    readonly type: unknown;
    readonly scope: ResourceScope;
    task: Promise<unknown>;
    users: number;
    priority: number;
    lastUsed: number;
    retired: boolean;
}

/** 只复用资产请求；调用方租约与缓存保留期共同决定底层作用域的寿命。 */
export class ScopedAssetCache implements AssetService {
    private readonly entries: IAssetCacheEntry[] = [];
    private hits = 0;
    private misses = 0;
    private activeLoads = 0;
    private readonly queuedLoads: Array<{ start: () => void; priority: () => number }> = [];

    constructor(private readonly delegate: AssetService,
        private readonly options: IScopedAssetCacheOptions,
        private readonly now: () => number) {
        if (!Number.isSafeInteger(options.maxEntries) || options.maxEntries < 1 || options.idleMs < 0) {
            throw new Error('无效的资源缓存预算');
        }
        if (options.maxConcurrentLoads !== undefined
            && (!Number.isSafeInteger(options.maxConcurrentLoads) || options.maxConcurrentLoads < 1)) {
            throw new Error('无效的资源加载并发预算');
        }
    }

    get stats(): { readonly entries: number; readonly hits: number; readonly misses: number } {
        return { entries: this.entries.length, hits: this.hits, misses: this.misses };
    }

    load<T>(path: string, type: AssetType<T>, options: AssetLoadOptions = {}): Promise<T> {
        return this.acquire('asset', path, type, options, (scope, priority) => this.delegate.load(path, type, { ...options, scope, priority }));
    }

    loadDir<T>(path: string, type: AssetType<T>, options: AssetLoadOptions = {}): Promise<T[]> {
        return this.acquire('directory', path, type, options, (scope, priority) => this.delegate.loadDir(path, type, { ...options, scope, priority }));
    }

    /** 后台只填充空位；已有前台缓存不因预热被淘汰。 */
    async warm<T>(path: string, type: AssetType<T>, options: AssetLoadOptions): Promise<boolean> {
        if (!options.scope || options.scope.disposed) return false;
        this.prune();
        const key = this.cacheKey('asset', path, options);
        if (this.entries.length >= this.options.maxEntries
            && !this.entries.some(entry => entry.key === key && entry.type === type)) return false;
        await this.load(path, type, options);
        return true;
    }

    has<T>(path: string, type: AssetType<T>, options?: AssetLoadOptions): Promise<boolean> {
        return this.delegate.has(path, type, options);
    }

    preload(path: string, options?: AssetLoadOptions): Promise<void> {
        return this.delegate.preload?.(path, options) ?? Promise.resolve();
    }

    prune(): void {
        const now = this.now();
        for (const entry of this.entries.slice()) {
            if (entry.users === 0 && now - entry.lastUsed >= this.options.idleMs) this.retire(entry);
        }
    }

    clear(): void {
        for (const entry of this.entries.slice()) this.retire(entry);
    }

    private acquire<T>(kind: string, path: string, type: unknown, options: AssetLoadOptions,
        load: (scope: ResourceScope | undefined, priority: number) => Promise<T>): Promise<T> {
        const caller = options.scope;
        if (caller?.disposed) return Promise.reject(new Error('资源加载已取消'));
        if (options.cache === false) return Promise.resolve().then(() => this.dispatch(caller, load, () => options.priority ?? 0));
        // 无作用域的调用没有释放租约的时机，保持原端口语义，不替它永久保留。
        if (!caller) return this.dispatch(undefined, load, () => options.priority ?? 0);
        this.prune();
        const key = this.cacheKey(kind, path, options);
        let entry = this.entries.find(item => item.key === key && item.type === type);
        if (entry) { this.hits++; entry.priority = Math.max(entry.priority, options.priority ?? 0); }
        else {
            this.misses++;
            if (this.entries.length >= this.options.maxEntries) {
                const idle = this.entries.filter(item => item.users === 0).sort((a, b) => a.lastUsed - b.lastUsed)[0];
                if (idle) this.retire(idle);
                else return Promise.resolve().then(() => this.dispatch(caller, load, () => options.priority ?? 0));
            }
            const scope = new ResourceScope(`asset-cache:${path}`);
            const created: IAssetCacheEntry = { key, type, scope, task: Promise.resolve(), users: 0, priority: options.priority ?? 0, lastUsed: this.now(), retired: false };
            // 先发布条目，再派发底层操作；重复调用始终接管同一个 Promise。
            this.entries.push(created);
            created.task = Promise.resolve().then(() => this.dispatch(scope, load, () => created.priority, () => created.users > 0)).catch(error => {
                this.retire(created);
                scope.dispose();
                throw error;
            });
            entry = created;
        }
        const leased = entry;
        leased.users++;
        caller.defer(() => {
            leased.users--;
            leased.lastUsed = this.now();
            if (leased.retired && leased.users === 0) leased.scope.dispose();
        });
        return leased.task.then(value => {
            if (caller.disposed) throw new Error('资源加载已取消');
            // key + 构造器 + asset/directory 在本类边界保证返回类型对应。
            return value as T;
        });
    }

    private cacheKey(kind: string, path: string, options: AssetLoadOptions): string {
        return JSON.stringify([kind, options.bundle ?? bundleForPath(path) ?? RESOURCES_BUNDLE, path]);
    }

    private retire(entry: IAssetCacheEntry): void {
        entry.retired = true;
        const index = this.entries.indexOf(entry);
        if (index >= 0) this.entries.splice(index, 1);
        if (entry.users === 0) entry.scope.dispose();
    }

    private dispatchNext(): void {
        if (!this.queuedLoads.length) return;
        let next = 0;
        for (let index = 1; index < this.queuedLoads.length; index++) {
            if (this.queuedLoads[index].priority() > this.queuedLoads[next].priority()) next = index;
        }
        this.queuedLoads.splice(next, 1)[0].start();
    }

    private dispatch<T>(scope: ResourceScope | undefined, load: (scope: ResourceScope | undefined, priority: number) => Promise<T>,
        priority: () => number, hasUsers?: () => boolean): Promise<T> {
        const limit = this.options.maxConcurrentLoads;
        if (limit === undefined) return load(scope, priority());
        return new Promise<T>((resolve, reject) => {
            const start = (): void => {
                if (scope?.disposed || (hasUsers && !hasUsers())) {
                    reject(new Error('资源加载已取消'));
                    this.dispatchNext();
                    return;
                }
                this.activeLoads++;
                // 根资源自身还会派发依赖下载；限制根请求，避免多个大动画图集同时争抢解析。
                void (async () => {
                    try { resolve(await load(scope, priority())); }
                    catch (error) { reject(error); }
                    finally {
                        this.activeLoads--;
                        this.dispatchNext();
                    }
                })();
            };
            if (this.activeLoads < limit) start();
            else this.queuedLoads.push({ start, priority });
        });
    }
}
