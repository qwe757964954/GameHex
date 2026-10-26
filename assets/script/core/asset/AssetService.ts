import type { ResourceScope } from './ResourceScope';

/** Cocos 资源构造器的最小结构，避免核心接口依赖 `cc`。 */
export interface AssetType<T> {
    new (...args: any[]): T;
}

export interface AssetLoadOptions {
    /** 省略时使用 Creator 内置 resources bundle。 */
    bundle?: string;
    /** 资源跟随该作用域释放。 */
    scope?: ResourceScope;
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
