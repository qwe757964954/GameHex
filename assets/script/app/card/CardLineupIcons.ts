import { SpriteFrame } from 'cc';
import { routedLoad } from '../common/RoutedResource';
import {
    artKey,
    CARD_ART_ROOT,
    COMMON_ART_ROOT,
    FRAME_ART_ROOT,
    ICON_ART_ROOT,
    MAIN_ART_ROOT,
    spriteFramePath,
    spriteFramePathOf,
} from '../ArtPaths';
import { HeadArt } from '../HeadArt';

/**
 * 按名加载 `image/**` 下的 SpriteFrame，带内存缓存。
 *
 * 资源名一律由数据（配置表 / 卡组 / 六格配置组）驱动，不写死；
 * 加载失败时返回 `null` 并**保留视图现有图片**，不抛异常 —— 卡牌阵容整页 30+ 张图，
 * 单张缺失不该阻断渲染（`MatchIcons.loadMatchIcon` 是同一套写法）。
 *
 *  根目录必须显式传入：卡面在 `CARD_ART_ROOT`（`image/card`），底部六格导航
 * 在 `MAIN_ART_ROOT`（`image/main`），两者都叫 `btn_*`/`icon_*` 风格的名字，
 * 混用会「图能出来但出的是另一张」。
 */

/** 应用级图标缓存，持有引用以跨主界面/对局切换复用（键 = `根目录/资源名`）。 */
const artCache = new Map<string, SpriteFrame>();

/** 正在加载中的请求（同一张图并发加载时复用同一个 Promise）。 */
const pending = new Map<string, Promise<SpriteFrame | null>>();
let cacheGeneration = 0;

/** 加载 `root/<name>` 的 SpriteFrame；`root` 取 `ArtPaths` 里的常量。 */
export function loadArt(name: string, root: string): Promise<SpriteFrame | null> {
    if (!name || !root) return Promise.resolve(null);
    const key = artKey(root, name);
    const cached = artCache.get(key);
    if (cached?.isValid) return Promise.resolve(cached);
    if (cached) artCache.delete(key);
    const running = pending.get(key);
    if (running) return running;
    const generation = cacheGeneration;

    const task = new Promise<SpriteFrame | null>((resolve) => {
        routedLoad(spriteFramePath(root, name), SpriteFrame, (error, frame) => {
            if (error || !frame || !frame.isValid) {
                console.warn(`[ArtIcons] 图标加载失败：${key}`, error);
                resolve(null);
                return;
            }
            if (generation !== cacheGeneration) {
                resolve(null);
                return;
            }
            // JS Map 不参与 Cocos 引用计数，缓存必须自己持有引用。
            frame.addRef();
            artCache.set(key, frame);
            resolve(frame);
        });
    });
    pending.set(key, task);
    // 缓存命中时加载回调可能同步执行，等 Promise 完成后再清理请求记录。
    const clearPending = () => {
        if (pending.get(key) === task) pending.delete(key);
    };
    void task.then(clearPending, clearPending);
    return task;
}

/** 退出登录时释放本次会话持有的动态美术引用。 */
export function releaseArtCache(): void {
    cacheGeneration += 1;
    pending.clear();
    for (const frame of artCache.values()) {
        if (frame?.isValid) frame.decRef();
    }
    artCache.clear();
}

/**
 * 按 resources 直接路径加载 `icons/**` 下的 SpriteFrame。
 * 物品表 `icon` 字段现在直接是 icons/ 路径，用它一步加载。
 *
 *  ⚠️ 传进来的 `artPath` 是**图片资源路径**（`icons/item/图标_兵书随机`），
 *  **必须**经 `spriteFramePathOf()` 补成 `<路径>/spriteFrame` 再去 load。
 *  实测（2026-09-23 编辑器预览，`tmp/_icon_path_probe.mjs`）：resources bundle 的索引里
 *  只登记 `xxx/spriteFrame`，裸路径 `xxx` 查不到 ⇒ `Bundle resources doesn't contain xxx`，
 *  界面静默留白（只打一条 warn）。这跟自动图集无关 ——
 *  `image/card/*`、`image/main/*` 这些老目录的裸路径同样查不到，全部目录一致。
 */
export function loadIconByArtPath(artPath: string): Promise<SpriteFrame | null> {
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
                console.warn(`[ArtIcons] 图标加载失败：${framePath}`, error);
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
    const clearPending = () => {
        if (pending.get(key) === task) pending.delete(key);
    };
    void task.then(clearPending, clearPending);
    return task;
}

/** 卡牌阵容页美术（`image/card`）：卡面 `common_img_kp_*`、站台 `kpzr_stage`、垫盘 `kpzr_di_*`。 */
export function loadLineupArt(name: string): Promise<SpriteFrame | null> {
    return loadArt(name, CARD_ART_ROOT);
}

/**
 * 立绘与职业图标（`image/icon/card`）：`camp_*` / `char_0*` / `class_*` / `common_img_{职业}0*`。
 *
 *  这几类图**不在** `image/card` 里，用 `loadLineupArt` 取会静默返回 `null`
 * （只打一条 warn，界面留着 prefab 占位图）—— 2026-09-15 美术收编时踩过。
 * 2026-09-17（r172）美术又把它们从 `image/icon` 挪进了 `image/icon/card` 子目录，
 * 同样只表现为静默留白；根目录一律取 `ICON_ART_ROOT`，别再写死。
 */
export function loadIconArt(name: string): Promise<SpriteFrame | null> {
    return loadArt(name, ICON_ART_ROOT);
}

/** 布阵卡池卡框（`image/frame`）：`common_img_pzk_01..04`。 */
export function loadFrameArt(name: string): Promise<SpriteFrame | null> {
    return loadArt(name, FRAME_ART_ROOT);
}

/** 通用底图 / 按钮（`image/common`）：`bg_04`、`bg_05`、`title_01`、`anniu_0*`。 */
export function loadCommonArt(name: string): Promise<SpriteFrame | null> {
    return loadArt(name, COMMON_ART_ROOT);
}

/** 批量加载，按传入顺序返回（缺失位置为 `null`）。 */
export function loadLineupArtList(names: readonly string[]): Promise<(SpriteFrame | null)[]> {
    return Promise.all(names.map((name) => loadLineupArt(name)));
}

/** 预加载一批图标（进入界面前调用，减少首帧空白）。 */
export function preloadLineupArt(names: readonly string[]): Promise<void> {
    return loadLineupArtList(names).then(() => undefined);
}

/**
 * 卡牌头像：收的是 **`PVP-卡牌.headIcon` 那个「图标名」本身**，不是资源名。
 *
 *  ⚠️ **不能走上面的 `loadIconArt`** —— 那一套是「给我一个资源名、我去 `image/icon/card` 找」，
 *  而头像这一列的类型是「`icon.json` 的 `key`」：要先查表解出资源名、**并且目录由包名决定**
 *  （`兵种_头像_*` → `image/icon/cardHead`，`图标_头像_*` → `image/icon/head`）。
 *  自己拼路径的写法会在**一半的卡**上静默留白（只打一条 warn），正是 `[ArtIcons] 图标加载失败`
 *  那类报错的来源。
 *
 *  解表 / 判目录 / 拼路径 / 缓存 / 失败返回 `null` 全在 `HeadArt.loadHeadIconFrame()` 里，
 *  本函数只是把它挂到卡牌这条加载器链上，让 `CardArtProvider` 不需要知道 `headIcon` 与
 *  其它美术名**不是同一种东西**。
 */
export function loadCardHeadArt(iconKey: string | undefined): Promise<SpriteFrame | null> {
    if (!iconKey) return Promise.resolve(null);
    return HeadArt.loadHeadIconFrame(iconKey);
}
