import type { SpriteFrame } from 'cc';
import { createRoutedSpriteFrameCache } from '../common/SpriteFrameCache';
import { spriteFramePathOf } from '../ArtPaths';
import { loadItemIconArt } from '../itemdetail/ItemDetailArtLoader';
import { gemDetailHeaderKey, roleArtRelPath } from './RoleArt';
import type { IRoleBagEntry } from './RoleTypes';

/** 将美术键解析为带 `/spriteFrame` 后缀的资源路径。未知键返回空字符串。 */
export function roleFramePathOf(key: string): string {
    const path = roleArtRelPath(key);
    return path ? spriteFramePathOf(path) : '';
}

const cache = createRoutedSpriteFrameCache('RoleArt');

export function loadRoleArt(key: string): Promise<SpriteFrame | null> {
    const path = roleFramePathOf(key);
    if (!path) {
        console.warn(`[RoleArt] 没有 key ${key}`);
        return Promise.resolve(null);
    }
    return cache.load(path);
}

/** 已有缓存（不触发加载）。 */
export function peekRoleArt(key: string): SpriteFrame | null {
    return cache.peek(roleFramePathOf(key));
}

/** 供测试重置缓存。运行时清空会丢失已保留资源的引用记录。 */
export function resetRoleArtCacheForTest(): void {
    cache.clear();
    bagIconCache.clear();
}

// ============================================================
// 背包图标 / 品质框
// ============================================================

/** 宝石、装备和民兵天赋按类型定位目录。配置的图标键用于匹配文件名，头像包名不足以定位这些资源。 */
const BAG_ICON_ROOTS: Readonly<Record<'gem' | 'equip' | 'militia', string>> = {
    gem: 'icons/gem',
    equip: 'icons/equip',
    // 民兵天赋图标使用 `armyLevel.icon` 加解锁状态后缀。
    // 原始美术的 16～21 复用 tf1～tf6，且图标键的解锁后缀 `_1` 对应原图 `tf*_0`。
    militia: 'icons/militia',
};

const bagIconCache = createRoutedSpriteFrameCache('RoleBagArt');

/** 背包图标按 kind 分目录，不经过头像包名解析。 */
export function loadRoleBagIconSprite(
    kind: 'gem' | 'equip' | 'militia',
    iconKey: string,
): Promise<SpriteFrame | null> {
    return bagIconCache.loadNamed(iconKey, BAG_ICON_ROOTS[kind]);
}

/**
 * 加载背包一格的物品图标。
 *
 * · 道具（item）：item.icon 的 resources 相对路径（`icons/item/…`）；
 * · 宝石 / 装备：icon.json 的键**同时就是文件名**，图在 `icons/gem` / `icons/equip`。
 */
export function loadRoleBagIcon(entry: IRoleBagEntry): Promise<SpriteFrame | null> {
    if (entry.kind === 'item') {
        return entry.iconPath ? loadItemIconArt(entry.iconPath) : Promise.resolve(null);
    }
    return entry.iconKey ? loadRoleBagIconSprite(entry.kind, entry.iconKey) : Promise.resolve(null);
}

/** 民兵天赋图标键由 `armyLevel.icon` 和状态后缀组成，`_1` 表示已解锁，`_0` 表示未解锁。 */
export function loadMilitiaTalentIcon(iconKey: string): Promise<SpriteFrame | null> {
    return iconKey ? loadRoleBagIconSprite('militia', iconKey) : Promise.resolve(null);
}

/** 品质 1..5 → 角色背包扁平底；5 以上统一收口到金色，避免越界空图。 */
const ROLE_BAG_QUALITY_KEYS = ['bagQuality1', 'bagQuality2', 'bagQuality3', 'bagQuality4', 'bagQuality5'] as const;

export function loadRoleQualityFrame(quality: number): Promise<SpriteFrame | null> {
    const index = Math.min(Math.max(Math.round(quality) || 1, 1), ROLE_BAG_QUALITY_KEYS.length) - 1;
    return loadRoleArt(ROLE_BAG_QUALITY_KEYS[index]);
}

/** 宝石详情左卡的品质底板；白品质 / 越界返回 null（由调用方隐藏底板）。 */
export function loadGemDetailHeader(quality: number): Promise<SpriteFrame | null> {
    const key = gemDetailHeaderKey(quality);
    return key ? loadRoleArt(key) : Promise.resolve(null);
}

/** 该品质是否有独立底板；白品质没有，调用方应隐藏底板节点。 */
export function hasGemDetailHeader(quality: number): boolean {
    return !!gemDetailHeaderKey(quality);
}
