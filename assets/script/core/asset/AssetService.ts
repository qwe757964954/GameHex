import type { ResourceScope } from './ResourceScope';

/** Cocos 资源构造器的最小结构，避免核心接口依赖 `cc`。 */
export interface AssetType<T> {
    new (...args: any[]): T;
}

export interface AssetLoadOptions {
    /** 较大值优先派发；不改变资源身份或缓存键。 */
    readonly priority?: number;
    /** 省略时使用 Creator 内置 resources bundle。 */
    bundle?: string;
    /** 资源跟随该作用域释放。 */
    scope?: ResourceScope;
    /** false 时只由当前作用域持有，不占用会话复用缓存；引擎适配器忽略此提示。 */
    cache?: boolean;
}

/** 引擎无关的资源入口；业务层不再直接调用 resources.load。 */
export interface AssetService {
    /** 可选的后台预下载能力；不解析资源、不获取资产所有权。 */
    preload?(path: string, options?: AssetLoadOptions): Promise<void>;
    load<T>(path: string, type: AssetType<T>, options?: AssetLoadOptions): Promise<T>;
    loadDir<T>(path: string, type: AssetType<T>, options?: AssetLoadOptions): Promise<T[]>;
    /**
     * 预检资源是否在指定 bundle 的资源索引中（不触发实际加载）。
     *
     * 用于「先确认再加载」的场景：Cocos 对未进构建索引的路径抛的是
     * `Bundle resources doesn't contain xxx`，极易被误判成「美术没交图」。
     * 返回 `false` 表示路径不在索引（路径不符或未进入构建），调用方应走兜底。
     * 平台无法判定时返回 `true`（放行给 `load` 报真实错误），保证不阻断加载路径。
     */
    has<T>(path: string, type: AssetType<T>, options?: AssetLoadOptions): Promise<boolean>;
}


/** 页内动态资产默认归属页面；已明确指定的独立战斗作用域保持原样。 */
export function scopeAssetService(assets: AssetService, scope: ResourceScope): AssetService {
    const resolveOptions = (options: AssetLoadOptions = {}): AssetLoadOptions & { scope: ResourceScope } => ({
        ...options, scope: options.scope ?? scope,
    });
    const checkActive = (owner: ResourceScope): void => {
        if (owner.disposed) throw new Error('资源作用域已释放，加载已取消');
    };
    return {
        async load(path, type, options) {
            const resolved = resolveOptions(options);
            checkActive(resolved.scope);
            const value = await assets.load(path, type, resolved);
            checkActive(resolved.scope);
            return value;
        },
        async loadDir(path, type, options) {
            const resolved = resolveOptions(options);
            checkActive(resolved.scope);
            const values = await assets.loadDir(path, type, resolved);
            checkActive(resolved.scope);
            return values;
        },
        async has(path, type, options) {
            const resolved = resolveOptions(options);
            checkActive(resolved.scope);
            const exists = await assets.has(path, type, resolved);
            checkActive(resolved.scope);
            return exists;
        },
        async preload(path, options) {
            const resolved = resolveOptions(options);
            if (!resolved.scope.disposed) await assets.preload?.(path, resolved);
        },
    };
}
