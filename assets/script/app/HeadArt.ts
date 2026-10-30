/**
 * 头像 / 图标加载入口。
 *
 * @example
 * const frame = await HeadArt.loadHeadFrame(avatarId);
 * if (frame) sprite.spriteFrame = frame;
 */
import type { SpriteFrame } from 'cc';
import { HEAD_ART_ROOT } from './ArtPaths';
import { createRoutedSpriteFrameCache } from './common/SpriteFrameCache';
import type { ConfigService } from '../core/config/ConfigService';
import { RefUtil } from '../framework/ref/RefUtil';
import {
    HeadArtResolver, HeadRow, HeadSpriteLoader, IconArtResolver, IconRow,
    createHeadArtResolver, createIconArtResolver, loadHeadById, loadIconByKey,
} from './HeadArtModel';

interface HeadArtTables {
    readonly head: HeadArtResolver;
    readonly icon: IconArtResolver;
}

/**
 * 头像 / 图标加载的唯一入口（id → head.json → icon.json → 资源 → SpriteFrame）。
 *
 * 全部为静态方法：模块级缓存（SpriteFrame 必须 addRef）与表解析任务都挂在类上，
 * 调用方无需自己持有实例，也不要在页面里另写一套拼路径加载。
 */
export class HeadArt {
    /** 头像解析依赖的两张远程表。 */
    private static readonly TABLES = ['head', 'icon'] as const;

    /** 头像 SpriteFrame 缓存（键 = `根目录/资源名`）。 */
    private static readonly spriteCache = createRoutedSpriteFrameCache('HeadArt');

    /** head + icon 表的单次加载任务（整个进程复用一个解析器）。 */
    private static tableTask: Promise<HeadArtTables> | null = null;

    /** 按资源名加载头像 SpriteFrame，带缓存。 */
    static loadHeadSprite(name: string, root: string = HEAD_ART_ROOT): Promise<SpriteFrame | null> {
        return HeadArt.spriteCache.loadNamed(name, root);
    }

    /** 头像 id → SpriteFrame。 */
    static async loadHeadFrame(
        avatarId: string,
        loader: HeadSpriteLoader = HeadArt.loadHeadSprite,
        resolver?: HeadArtResolver | null,
    ): Promise<SpriteFrame | null> {
        const table = resolver ?? (await HeadArt.loadHeadArtResolver());
        try {
            return await loadHeadById(avatarId, table, loader);
        } catch (error) {
            console.warn(`[HeadArt] 头像加载异常：${avatarId}`, error);
            return null;
        }
    }

    /** 图标名 → SpriteFrame（给表里直接写图标名的调用方）。 */
    static async loadHeadIconFrame(
        iconKey: string,
        loader: HeadSpriteLoader = HeadArt.loadHeadSprite,
        resolver?: IconArtResolver | null,
    ): Promise<SpriteFrame | null> {
        if (!iconKey) return null;
        const table = resolver ?? (await HeadArt.loadIconArtResolver());
        try {
            return await loadIconByKey(iconKey, table, loader);
        } catch (error) {
            console.warn(`[HeadArt] 图标加载异常：${iconKey}`, error);
            return null;
        }
    }

    /** 读 head + icon 表，建头像解析器。失败返回空解析器（退回占位图）。 */
    static async loadHeadArtResolver(configs?: ConfigService): Promise<HeadArtResolver> {
        return (await HeadArt.loadHeadArtTables(configs)).head;
    }

    static async loadIconArtResolver(configs?: ConfigService): Promise<IconArtResolver> {
        return (await HeadArt.loadHeadArtTables(configs)).icon;
    }

    private static loadHeadArtTables(configs?: ConfigService): Promise<HeadArtTables> {
        if (!HeadArt.tableTask) HeadArt.tableTask = HeadArt.readHeadArtTables(configs);
        return HeadArt.tableTask;
    }

    private static async readHeadArtTables(configs?: ConfigService): Promise<HeadArtTables> {
        try {
            const [headRows, iconRows] = configs
                ? await Promise.all(HeadArt.TABLES.map((name) => configs.getTable(name)))
                : await Promise.all(HeadArt.TABLES.map((name) => RefUtil.instance.getRefAllAsync(name)));
            const rows = iconRows as IconRow[];
            return {
                head: createHeadArtResolver(headRows as HeadRow[], rows),
                icon: createIconArtResolver(rows),
            };
        } catch (error) {
            console.error('[HeadArt] head/icon 表读取失败，头像退回占位图', error);
            return { head: createHeadArtResolver(null, null), icon: createIconArtResolver(null) };
        }
    }

    /** 仅供测试重置缓存。 */
    static resetCacheForTest(): void {
        HeadArt.tableTask = null;
        HeadArt.spriteCache.clear();
    }
}
