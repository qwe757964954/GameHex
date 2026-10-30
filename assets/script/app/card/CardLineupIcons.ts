import type { SpriteFrame } from 'cc';
import { createRoutedSpriteFrameCache } from '../common/SpriteFrameCache';
import {
    CARD_ART_ROOT,
    COMMON_ART_ROOT,
    FRAME_ART_ROOT,
    ICON_ART_ROOT,
} from '../ArtPaths';
import { HeadArt } from '../HeadArt';

/** 卡牌图标归会话缓存；目录与头像查表由本模块负责。 */
const artCache = createRoutedSpriteFrameCache('ArtIcons');

export function loadArt(name: string, root: string): Promise<SpriteFrame | null> {
    return artCache.loadNamed(name, root);
}

/** 退出登录时释放本次会话的美术引用。 */
export function releaseArtCache(): void {
    artCache.clear();
}

export function loadIconByArtPath(artPath: string): Promise<SpriteFrame | null> {
    return artCache.load(artPath);
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
