import { resources, SpriteFrame, JsonAsset } from "cc";

/**
 * 图标管理器
 *
 * 功能：
 * - 根据物品 ID 异步加载 SpriteFrame
 * - 内存缓存，避免重复加载
 * - 批量预加载
 * - 释放缓存
 *
 * 数据来源：item.json（每个物品自带 iconPath 字段）
 *
 * 使用前必须先调用 IconManager.init() 加载配置表。
 *
 * @example
 * ```typescript
 * await IconManager.init();
 * const sf = await IconManager.getIconByItemId(10001);
 * ```
 */
export class IconManager {
    private static _initialized = false;

    /** 物品配置表: itemId -> itemData（含 iconPath） */
    private static _itemConfig: Map<number, ItemConfig> = new Map();

    /** 已加载的图标缓存: itemId -> SpriteFrame */
    private static _cache: Map<number, SpriteFrame> = new Map();

    /** 正在加载中的 Promise（防止并发重复加载） */
    private static _loading: Map<number, Promise<SpriteFrame | null>> = new Map();

    // ============================================================
    // 初始化
    // ============================================================

    /**
     * 加载配置表，初始化图标管理器。
     * 必须在使用其他接口前调用，且只需调用一次。
     */
    public static async init(): Promise<void> {
        if (this._initialized) {
            return;
        }

        // 只需要加载 item.json，里面已经包含 iconPath
        const itemJson = await this._loadJson<Record<string, any>>("config/item");

        this._itemConfig.clear();
        for (const [id, data] of Object.entries(itemJson)) {
            this._itemConfig.set(parseInt(id, 10), data as ItemConfig);
        }

        this._initialized = true;
        console.log(`[IconManager] 初始化完成: ${this._itemConfig.size} 物品`);
    }

    // ============================================================
    // 查询接口
    // ============================================================

    /**
     * 根据物品 ID 获取图标 SpriteFrame
     * @param itemId 物品 ID
     * @returns SpriteFrame，找不到返回 null
     */
    public static async getIconByItemId(itemId: number): Promise<SpriteFrame | null> {
        if (!itemId) {
            return null;
        }

        // 1. 先查缓存
        if (this._cache.has(itemId)) {
            return this._cache.get(itemId)!;
        }

        // 2. 正在加载中？复用 Promise
        if (this._loading.has(itemId)) {
            return this._loading.get(itemId)!;
        }

        // 3. 从物品配置里直接拿 iconPath
        const item = this._itemConfig.get(itemId);
        if (!item || !item.iconPath) {
            console.warn(`[IconManager] 未找到物品或图标: ${itemId}`);
            return null;
        }

        // 4. 异步加载
        const promise = this._loadSpriteFrame(item.iconPath);
        this._loading.set(itemId, promise);

        try {
            const sf = await promise;
            if (sf) {
                this._cache.set(itemId, sf);
            }
            return sf;
        } finally {
            this._loading.delete(itemId);
        }
    }

    /**
     * 根据物品 ID 获取物品配置数据（含名称、描述、iconPath 等）
     * @param itemId 物品 ID
     */
    public static getItemConfig(itemId: number): ItemConfig | undefined {
        return this._itemConfig.get(itemId);
    }

    // ============================================================
    // 预加载 & 释放
    // ============================================================

    /**
     * 批量预加载物品图标
     * @param itemIds 物品 ID 列表
     * @param onProgress 进度回调 (已完成, 总数)
     */
    public static async preloadByItemIds(
        itemIds: number[],
        onProgress?: (done: number, total: number) => void
    ): Promise<void> {
        const total = itemIds.length;
        let done = 0;

        const CONCURRENCY = 8;
        const queue = [...itemIds];

        const worker = async () => {
            while (queue.length > 0) {
                const id = queue.shift()!;
                await this.getIconByItemId(id);
                done++;
                onProgress?.(done, total);
            }
        };

        const workers = Array(Math.min(CONCURRENCY, queue.length)).fill(0).map(worker);
        await Promise.all(workers);
    }

    /**
     * 释放指定图标的缓存
     * @param itemIds 要释放的物品 ID 列表
     * @param decRef 是否减少资源引用计数（默认 true）
     */
    public static releaseIcons(itemIds: number[], decRef = true): void {
        for (const id of itemIds) {
            const sf = this._cache.get(id);
            if (sf) {
                if (decRef) {
                    sf.decRef();
                }
                this._cache.delete(id);
            }
        }
    }

    /**
     * 释放所有图标缓存
     * @param decRef 是否减少资源引用计数（默认 true）
     */
    public static releaseAll(decRef = true): void {
        if (decRef) {
            for (const sf of this._cache.values()) {
                sf.decRef();
            }
        }
        this._cache.clear();
        console.log("[IconManager] 已释放所有图标缓存");
    }

    /**
     * 获取当前缓存数量
     */
    public static get cacheCount(): number {
        return this._cache.size;
    }

    // ============================================================
    // 内部方法
    // ============================================================

    private static async _loadJson<T>(path: string): Promise<T> {
        return new Promise((resolve, reject) => {
            resources.load(path, JsonAsset, (err, asset) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(asset.json as T);
            });
        });
    }

    private static _loadSpriteFrame(resPath: string): Promise<SpriteFrame | null> {
        return new Promise((resolve) => {
            resources.load(resPath, SpriteFrame, (err, sf) => {
                if (err || !sf) {
                    console.warn(`[IconManager] 加载图标失败: ${resPath}`, err?.message);
                    resolve(null);
                    return;
                }
                resolve(sf);
            });
        });
    }
}

/** 物品配置结构（对应 item.json） */
export interface ItemConfig {
    id: number;
    name: string;
    desc: string;
    key: string;
    useType: number;
    type: number;
    quality: number;
    icon: string;
    iconPath: string;
}
