import type { AssetLoadOptions, AssetService, AssetType } from './AssetService';
import { ResourceScope } from './ResourceScope';
import { bundleForPath, RESOURCES_BUNDLE } from './BundleCatalog';
import { ResourceLoadQueue } from './ResourceLoadQueue';

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
    /** cache key → 构造器 → 条目；命中不再线性扫描 `entries`。*/
    private readonly entriesByKey = new Map<string, Map<unknown, IAssetCacheEntry>>();
    private hits = 0;
    private misses = 0;
    private readonly loadQueue: ResourceLoadQueue | null;

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
        this.loadQueue = options.maxConcurrentLoads === undefined ? null : new ResourceLoadQueue(options.maxConcurrentLoads);
    }

    get stats(): { readonly entries: number; readonly hits: number; readonly misses: number } {
        return { entries: this.entries.length, hits: this.hits, misses: this.misses };
    }

    load<T>(path: string, type: AssetType<T>, options: AssetLoadOptions = {}): Promise<T> {
        return this.acquire('asset', path, type, options, (scope, priority) => this.delegate.load(path, type, Object.assign({}, options, { scope, priority })));
    }

    loadDir<T>(path: string, type: AssetType<T>, options: AssetLoadOptions = {}): Promise<T[]> {
        return this.acquire('directory', path, type, options, (scope, priority) => this.delegate.loadDir(path, type, Object.assign({}, options, { scope, priority })));
    }

    /** 后台只填充空位；已有前台缓存不因预热被淘汰。 */
    async warm<T>(path: string, type: AssetType<T>, options: AssetLoadOptions): Promise<boolean> {
        if (!options.scope || options.scope.disposed) return false;
        this.prune();
        const key = this.cacheKey('asset', path, options);
        const cached = this.entriesByKey.get(key)?.has(type) ?? false;
        if (this.entries.length >= this.options.maxEntries && !cached) return false;
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
        // 倒序遍历就地删除：不复制 `entries.slice()`，每帧预热/加载路径少一条临时数组。
        for (let index = this.entries.length - 1; index >= 0; index -= 1) {
            const entry = this.entries[index];
            if (entry.users === 0 && now - entry.lastUsed >= this.options.idleMs) this.retire(entry);
        }
    }

    clear(): void {
        for (let index = this.entries.length - 1; index >= 0; index -= 1) this.retire(this.entries[index]);
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
        let entry = this.entriesByKey.get(key)?.get(type);
        if (entry) { this.hits++; entry.priority = Math.max(entry.priority, options.priority ?? 0); }
        else {
            this.misses++;
            if (this.entries.length >= this.options.maxEntries) {
                let idle: IAssetCacheEntry | null = null;
                for (const item of this.entries) {
                    if (item.users > 0) continue;
                    if (!idle || item.lastUsed < idle.lastUsed) idle = item;
                }
                if (idle) this.retire(idle);
                else return Promise.resolve().then(() => this.dispatch(caller, load, () => options.priority ?? 0));
            }
            const scope = new ResourceScope(`asset-cache:${path}`);
            const created: IAssetCacheEntry = { key, type, scope, task: Promise.resolve(), users: 0, priority: options.priority ?? 0, lastUsed: this.now(), retired: false };
            // 先发布条目，再派发底层操作；重复调用始终接管同一个 Promise。
            this.entries.push(created);
            this.indexEntry(created);
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
        // 内部缓存键只用于查表：避免每次 acquire 都 JSON.stringify 一条三元素数组。
        return `${kind}\u0000${options.bundle ?? bundleForPath(path) ?? RESOURCES_BUNDLE}\u0000${path}`;
    }

    private indexEntry(entry: IAssetCacheEntry): void {
        let bucket = this.entriesByKey.get(entry.key);
        if (!bucket) {
            bucket = new Map<unknown, IAssetCacheEntry>();
            this.entriesByKey.set(entry.key, bucket);
        }
        bucket.set(entry.type, entry);
    }

    private retire(entry: IAssetCacheEntry): void {
        entry.retired = true;
        const index = this.entries.indexOf(entry);
        if (index >= 0) this.entries.splice(index, 1);
        const bucket = this.entriesByKey.get(entry.key);
        if (bucket?.get(entry.type) === entry) {
            bucket.delete(entry.type);
            if (bucket.size === 0) this.entriesByKey.delete(entry.key);
        }
        if (entry.users === 0) entry.scope.dispose();
    }

    private dispatch<T>(scope: ResourceScope | undefined, load: (scope: ResourceScope | undefined, priority: number) => Promise<T>,
        priority: () => number, hasUsers?: () => boolean): Promise<T> {
        if (!this.loadQueue) return load(scope, priority());
        return this.loadQueue.run(() => load(scope, priority()), scope, priority, hasUsers);
    }
}
