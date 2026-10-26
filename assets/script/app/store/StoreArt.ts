import { SpriteFrame } from 'cc';
import { routedLoad } from '../common/RoutedResource';
import { spriteFramePathOf } from '../ArtPaths';

/**
 * 「商城」按 **resources 相对路径** 加载图标，带内存缓存。
 *
 * ## 为什么自带一份（而不是复用 `CardLineupIcons.loadIconByArtPath`）
 *
 * 本工程的口径是**每个模块自带小 loader**（`MainResBarArt.loadResBarSprite`、
 * `ItemDetailArtLoader.loadByPath`、`RoleArtLoader.loadRoleArt` 同构）。
 * `loadIconByArtPath` 那一份挂在 `card/CardLineupIcons` 上、还会把 `HeadArt` 一并拉进
 * 依赖链 —— 一个商城页没必要为了一张图标去依赖卡牌/头像模块。
 *
 * ## 三条必须遵守的实测口径
 *
 * 1. **必须补 `/spriteFrame`**（`spriteFramePathOf`）：resources bundle 的索引里只登记
 *    `xxx/spriteFrame`，裸路径 `xxx` 查不到 ⇒ `Bundle resources doesn't contain xxx`，
 *    界面静默留白、只打一条 warn。
 * 2. **缓存必须 `addRef()`**：JS `Map` 不参与 Cocos 引用计数，不持有引用会被
 *    `ReleaseManager` 回收 ⇒ 之后 `Simple.updateUVs` 空指针。
 * 3. **加载失败返回 `null` 且保留现有图**：商城一屏几十张图标，缺一张不该阻断渲染。
 */

/** 路径 → SpriteFrame（键就是传进来的 `artPath`，与 `loadIconByArtPath` 同键口径）。 */
const artCache = new Map<string, SpriteFrame>();

/** 正在加载中的请求（同一张图并发加载复用同一个 Promise）。 */
const pending = new Map<string, Promise<SpriteFrame | null>>();

let cacheGeneration = 0;

/** 加载一张 `assets/resources/<artPath>.png` 的 SpriteFrame（失败/空路径回 `null`）。 */
export function loadStoreIcon(artPath: string): Promise<SpriteFrame | null> {
    if (!artPath) return Promise.resolve(null);
    const key = artPath;
    const cached = artCache.get(key);
    if (cached?.isValid) return Promise.resolve(cached);
    if (cached) artCache.delete(key);
    const running = pending.get(key);
    if (running) return running;
    const generation = cacheGeneration;
    const framePath = spriteFramePathOf(artPath);

    const task = new Promise<SpriteFrame | null>((resolve) => {
        routedLoad(framePath, SpriteFrame, (error, frame) => {
            if (error || !frame || !frame.isValid) {
                console.warn(`[StoreArt] 图标加载失败：${framePath}`, error);
                resolve(null);
                return;
            }
            if (generation !== cacheGeneration) {
                resolve(null);
                return;
            }
            frame.addRef();
            artCache.set(key, frame);
            resolve(frame);
        });
    });
    pending.set(key, task);
    const clearPending = (): void => {
        if (pending.get(key) === task) pending.delete(key);
    };
    void task.then(clearPending, clearPending);
    return task;
}

/** 退出登录 / 卸载时释放本会话持有的引用。 */
export function releaseStoreArt(): void {
    cacheGeneration += 1;
    pending.clear();
    for (const frame of artCache.values()) {
        if (frame?.isValid) frame.decRef();
    }
    artCache.clear();
}
