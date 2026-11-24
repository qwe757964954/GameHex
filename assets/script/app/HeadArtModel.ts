/**
 * 头像数据层：id → 资源名两层查表。
 * 纯函数、零引擎依赖，可单测。
 *
 * 链路：
 *   头像 id → head.json → 中文图标名 → icon.json → 资源名
 */
import type { SpriteFrame } from 'cc';
import { CARD_HEAD_ART_ROOT, HEAD_ART_ROOT, ICON_PACKAGE_ART_ROOT } from './ArtPaths';
import { toCount } from './net/RequestGuard';

/** head 表行。 */
export interface HeadRow {
    resId?: unknown;
    icon?: unknown;
    type?: unknown;
}

/** icon 表行。 */
export interface IconRow {
    key?: unknown;
    path?: unknown;
}

/** 头像 id → 资源名解析器（同步查表）。 */
export interface HeadArtResolver {
    artName(avatarId: string): string;
}

export const EMPTY_HEAD_ART: HeadArtResolver = { artName: () => '' };

/** 从 ui:// 路径取资源名（末段）。 */
export function artNameFromHeadIconPath(path: string): string {
    if (!path) return '';
    const cut = path.lastIndexOf('/');
    return cut < 0 ? path : path.slice(cut + 1);
}

/** 从 ui:// 路径取包名。 */
export function packageFromIconPath(path: string): string {
    if (!path) return '';
    const body = path.startsWith('ui://') ? path.slice('ui://'.length) : path;
    const cut = body.indexOf('/');
    return cut < 0 ? '' : body.slice(0, cut);
}

/** 图标名 → 资源解析结果（资源名与根目录成对）。 */
export interface IconArtTarget {
    readonly art: string;
    readonly root: string;
}

/** 图标名 → 资源解析器。 */
export interface IconArtResolver {
    resolve(iconKey: string): IconArtTarget | null;
}

export const EMPTY_ICON_ART: IconArtResolver = { resolve: () => null };

/**
 * 允许被当成「图标路径」的根目录：两个头像目录 + `ICON_PACKAGE_ART_ROOT` 的全部目的一起收口。
 *
 * 🔴 白名单不是洁癖：配表里填错列（`skel/豌豆射手/...`、`units/...`）时如果照拼不误，
 * 表现是「这张卡永远停在占位图 + 后台一条 load warn」，查起来比直接不认难十倍。
 */
const ICON_ART_ROOTS: ReadonlySet<string> = new Set<string>([
    HEAD_ART_ROOT,
    CARD_HEAD_ART_ROOT,
    ...Object.values(ICON_PACKAGE_ART_ROOT),
]);

/**
 * 表里的值**直接是资源路径**时，拆成「目录 + 资源名」（2026-11-23）。
 *
 * 背景：`headIcon` 这一类格子原先是「`icon.json` 的图标名」，解析要过两层表；
 * 美术换图时按习惯把格子改成了直路径（`icons/cardHead/wandouyouxia`）⇒ 走到
 * `targets.get()` 落空 ⇒ `loadIconByKey` 返回 null ⇒ **头像整片退占位图且不报错**。
 * 这里让两种写法都能用：key 优先（命中表就不再看路径），落空再按路径拆。
 *
 * 认三种形态（都能带 `/spriteFrame` 尾巴）：
 *   · `icons/cardHead/wandouyouxia`      —— 真目录
 *   · `icons/head/icon_hero_head_40018`  —— 真目录
 *   · `ui://图标_兵种_头像/wandouyouxia`  —— 老端包名，经 `ICON_PACKAGE_ART_ROOT` 换成目录
 * 不带 `/` 的一律当 key（返回 null），不登记目录的路径也返回 null —— 见 `ICON_ART_ROOTS`。
 */
export function iconArtTargetOfPath(path: string): IconArtTarget | null {
    const raw = typeof path === 'string' ? path.trim() : '';
    // 没有 `/` ⇒ 是图标名，不是路径（这种值必须去 icon.json 查，不能当路径猜）。
    if (raw.indexOf('/') < 0) return null;
    const body = raw.startsWith('ui://') ? raw.slice('ui://'.length) : raw;
    const value = body.endsWith('/spriteFrame') ? body.slice(0, -'/spriteFrame'.length) : body;
    const cut = value.lastIndexOf('/');
    const dir = value.slice(0, cut);
    const art = value.slice(cut + 1);
    if (!dir || !art) return null;
    // 目录形态（`icons/cardHead`）与包名形态（`图标_兵种_头像`）互不重叠，一次查表就够。
    const root = ICON_ART_ROOTS.has(dir) ? dir : ICON_PACKAGE_ART_ROOT[dir];
    return root ? { art, root } : null;
}

/** 用 icon.json 行建「图标名 → 资源」解析器。目录由包名决定；key 没命中时按直路径兜底。 */
export function createIconArtResolver(iconRows?: readonly IconRow[] | null): IconArtResolver {
    const targets = new Map<string, IconArtTarget>();
    for (const row of iconRows ?? []) {
        if (!row) continue;
        const key = typeof row.key === 'string' ? row.key : '';
        const path = typeof row.path === 'string' ? row.path : '';
        const art = artNameFromHeadIconPath(path);
        const root = ICON_PACKAGE_ART_ROOT[packageFromIconPath(path)];
        if (!key || !art || !root) continue;
        targets.set(key, { art, root });
    }
    return {
        // key 命中优先（表里查得到就是它），否则当直路径再试一次。
        resolve: (iconKey: string): IconArtTarget | null =>
            targets.get(iconKey) ?? iconArtTargetOfPath(iconKey),
    };
}

/** 用 head + icon 两张表建头像解析器。 */
export function createHeadArtResolver(
    headRows?: readonly HeadRow[] | null,
    iconRows?: readonly IconRow[] | null,
): HeadArtResolver {
    const icons = createIconArtResolver(iconRows);
    const heads = new Map<number, string>();
    for (const row of headRows ?? []) {
        if (!row) continue;
        const id = toCount(row.resId);
        const key = typeof row.icon === 'string' ? row.icon : '';
        const art = key ? icons.resolve(key)?.art ?? '' : '';
        if (id <= 0 || !art) continue;
        heads.set(id, art);
    }
    return {
        artName: (avatarId: string): string => {
            const id = toCount(avatarId);
            if (id <= 0) return '';
            return heads.get(id) ?? '';
        },
    };
}

/** 可承载头像的视图数据。 */
export interface HeadArtSlot {
    avatarIcon: string;
    avatarRoot?: string;
}

/**
 * 把头像 id 写进视图：名字与根目录成对换。
 * @returns 是否写入成功
 */
export function applyHeadArt<T extends HeadArtSlot>(
    data: T,
    avatarId: string,
    resolver?: HeadArtResolver | null,
    root: string = HEAD_ART_ROOT,
): boolean {
    const art = resolver ? resolver.artName(avatarId) : '';
    if (!art) return false;
    data.avatarIcon = art;
    data.avatarRoot = root;
    return true;
}

/** 资源名加载器形状。 */
export type HeadSpriteLoader = (name: string, root: string) => Promise<SpriteFrame | null>;

/** 头像 id → SpriteFrame。 */
export function loadHeadById(
    avatarId: string,
    resolver: HeadArtResolver | null | undefined,
    loader: HeadSpriteLoader,
): Promise<SpriteFrame | null> {
    const art = resolver ? resolver.artName(avatarId) : '';
    if (!art) return Promise.resolve(null);
    return loader(art, HEAD_ART_ROOT);
}

/** 图标名 → SpriteFrame。 */
export function loadIconByKey(
    iconKey: string,
    resolver: IconArtResolver | null | undefined,
    loader: HeadSpriteLoader,
): Promise<SpriteFrame | null> {
    const target = resolver && iconKey ? resolver.resolve(iconKey) : null;
    if (!target) return Promise.resolve(null);
    return loader(target.art, target.root);
}

/** 预取一批图标名。不 reject。 */
export function preloadIconKeys(
    iconKeys: readonly string[],
    resolver: IconArtResolver | null | undefined,
    loader: HeadSpriteLoader,
): Promise<void> {
    const one = (key: string): Promise<unknown> => loadIconByKey(key, resolver, loader).catch((error) => {
        console.warn(`[HeadArt] 图标预取失败：${key}`, error);
        return null;
    });
    return Promise.all(iconKeys.map(one)).then(() => undefined);
}

/** 预取一批头像。不 reject。 */
export function preloadHeadByIds(
    ids: readonly string[],
    resolver: HeadArtResolver | null | undefined,
    loader: HeadSpriteLoader,
): Promise<void> {
    const one = (id: string): Promise<unknown> => loadHeadById(id, resolver, loader).catch((error) => {
        console.warn(`[HeadArt] 头像预取失败：${id}`, error);
        return null;
    });
    return Promise.all(ids.map(one)).then(() => undefined);
}
