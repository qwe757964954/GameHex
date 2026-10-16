import { resources, SpriteFrame } from 'cc';
import type { AssetService } from '../../core/asset/AssetService';
import type { ResourceScope } from '../../core/asset/ResourceScope';
import { artKey, spriteFramePath } from '../ArtPaths';

/**
 * 匹配页图标加载器。`root` 取 `ArtPaths` 里的常量，**必须显式传**。
 *
 * 匹配页的图分两个根目录（见 `ArtPaths` 的 `MATCH_ART_ROOT` / `MATCH_ICON_ART_ROOT`）：
 * 头像 / 神器 / 雷达在 `image/matching`，信息条小图标 `icon_01..05` 在
 * `image/icon/matching`。两个目录下都有 `icon_*` 风格的名字，所以不按名字猜根目录 ——
 * 猜错只会「图能出来但出的是另一张」，比报错更难查。
 */
export type MatchIconLoader = (name: string, root: string) => Promise<SpriteFrame | null>;

/** 已加载的图标缓存（键 = `根目录/资源名`）。 */
const iconCache = new Map<string, SpriteFrame>();

/**
 * 加载 `root/<name>` 的 SpriteFrame，带内存缓存。
 *
 * 匹配界面上的头像、神器图标与小图标都由数据驱动，资源名来自对手数据；
 * 加载失败时返回 `null` 并保留视图现有图片，不抛异常。
 *
 *  缓存键必须带根目录：`icon_01` 这类名字在两个匹配根目录下都可能出现，
 * 只用名字做键会互相串图。
 */
export function loadMatchIcon(name: string, root: string): Promise<SpriteFrame | null> {
    if (!name || !root) return Promise.resolve(null);
    const key = artKey(root, name);
    const cached = iconCache.get(key);
    if (cached) return Promise.resolve(cached);
    return new Promise<SpriteFrame | null>((resolve) => {
        resources.load(spriteFramePath(root, name), SpriteFrame, (error, frame) => {
            if (error || !frame) {
                console.warn(`[MatchIcons] 图标加载失败：${key}`, error);
                resolve(null);
                return;
            }
            iconCache.set(key, frame);
            resolve(frame);
        });
    });
}

/**
 * 为一次匹配流程创建图标加载器。缓存与 ResourceScope 同生共死，不会把已经释放的
 * SpriteFrame 留在模块级缓存中供下一次匹配误用。
 */
export function createMatchIconLoader(assets: AssetService, scope: ResourceScope): MatchIconLoader {
    const cache = new Map<string, SpriteFrame>();
    return async (name: string, root: string): Promise<SpriteFrame | null> => {
        if (!name || !root) return null;
        const key = artKey(root, name);
        const cached = cache.get(key);
        if (cached) return cached;
        try {
            const frame = await assets.load(spriteFramePath(root, name), SpriteFrame, { scope });
            if (scope.disposed) return null;
            cache.set(key, frame);
            return frame;
        } catch (error) {
            console.warn(`[MatchIcons] 图标加载失败：${key}`, error);
            return null;
        }
    };
}

/**
 * 预加载一批同根目录的图标（用于流程 onPreload，减少进入界面后的首帧空白）。
 *
 * 同一批图标必然同根 —— 头像 / 神器 / 雷达都在 `MATCH_ART_ROOT`；小图标由
 * `MatchPlayerItem.refresh` 按需取（数量随对手而变）。
 */
export function preloadMatchIcons(
    names: readonly string[],
    root: string,
    loader: MatchIconLoader = loadMatchIcon,
): Promise<void> {
    return Promise.all(names.map((name) => loader(name, root))).then(() => undefined);
}
