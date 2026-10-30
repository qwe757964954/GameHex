import type { SpriteFrame } from 'cc';
import { createRoutedSpriteFrameCache } from '../common/SpriteFrameCache';
import { spriteFramePathOf } from '../ArtPaths';
import { loadItemIconArt, loadQualityFrameArt } from '../itemdetail/ItemDetailArtLoader';
import { qualityFrameSuffixOf } from '../itemdetail/ItemDetailTable';
import { RL_ART_NAMES, RL_ART_ROOT, roleArtRelPath } from './RoleArt';
import type { IRoleBagEntry } from './RoleTypes';

/**
 * 角色模块美术的根（真源在零 `cc` 的 `RoleArt.RL_ART_ROOT`，这里只是转发）。
 *
 * ⚠️ 绝大多数 value 相对它，但 `icons/**` 那几条**与 `image/` 平级** ⇒ 一律拼前缀会拼成
 * `image/icons/main/icon_qianghua` ⇒ `Bundle resources doesn't contain`
 * （不崩，只是装备锻造页签图标静默留白）。分流见 `roleArtRelPath`。
 */
export const ROLE_ART_ROOT = RL_ART_ROOT;

/** key → `resources.load` 用的装配路径（`image/role/rl_js_img_bg/spriteFrame`）。 */
export function roleFramePathOf(key: string): string {
    const rel = RL_ART_NAMES[key];
    if (!rel) return '';
    return spriteFramePathOf(roleArtRelPath(key));
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

/** 批量预加载（同一批里失败的记 `null`，调用方按 `null` 留白）。 */
export async function loadRoleArtAll(keys: readonly string[]): Promise<Map<string, SpriteFrame | null>> {
    const out = new Map<string, SpriteFrame | null>();
    await Promise.all(keys.map(async (key) => {
        out.set(key, await loadRoleArt(key));
    }));
    return out;
}

/** 已有缓存（不触发加载）。 */
export function peekRoleArt(key: string): SpriteFrame | null {
    return cache.peek(roleFramePathOf(key));
}

/**
 * 清缓存（测试用）。
 * 正常流程**不要**在运行时调 —— 会把已经 `addRef()` 的图丢掉引用来源。
 */
export function resetRoleArtCacheForTest(): void {
    cache.clear();
    bagIconCache.clear();
}

// ============================================================
// 背包图标 / 品质框
// ============================================================

/**
 * 宝石 / 装备图标的目录（**按 kind 分**，key 就是文件名）。
 *
 * ⚠️ **不要**把这两类丢给 `HeadArt.loadHeadIconFrame()`：那条链按 `icon.json` 的**包名**
 * 解目录，而宝石 / 装备的包名都是「图标」⇒ 会被拼成 `icons/head/图标_宝石_蓝色`
 * （头像目录）—— 结果既报一条 `[HeadArt] 头像加载失败`，列表又照样空白（2026-09-26 实测）。
 */
const BAG_ICON_ROOTS: Readonly<Record<'gem' | 'equip' | 'militia', string>> = {
    gem: 'icons/gem',
    equip: 'icons/equip',
    // 民兵天赋（`armyLevel.icon` 的键 + 解锁后缀，如「图标_民兵天赋_21_1」）—— 共 21×2 = 42 张。
    // 已于 2026-09-28 从 zarts `图标_民兵/天赋/tf<M>_<S>.png` 导入（脚本 `tmp/_import_militia_icons.mjs`）；
    // ⚠️ 命名是**老端 icon.json 定的**，16..21 复用 tf1..tf6、且**后缀反着**（`_1`=解锁 → `tf*_0` 彩色），
    // 重新导美术时别按「tf 序号 = 天赋序号」直接对拷。缺图守卫：`tests/art-paths.test.ts`。
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

/**
 * 民兵天赋图标（`armyLevel.icon` + `_1`/`_0` 后缀，如「图标_民兵天赋_1_0」）。
 *
 * 走 `icons/militia`（与宝石 / 装备同一条通道，规则 115：按 kind 分目录）。
 * ⚠️ 美术未导之前这里会 warn 并返回 `null` —— 界面留白，**不是**拼错目录。
 */
export function loadMilitiaTalentIcon(iconKey: string): Promise<SpriteFrame | null> {
    return iconKey ? loadRoleBagIconSprite('militia', iconKey) : Promise.resolve(null);
}

/** 按品质加载品质框（与「获得奖励」弹窗同一套 cu_quality 图）。 */
export function loadRoleQualityFrame(quality: number): Promise<SpriteFrame | null> {
    return loadQualityFrameArt(qualityFrameSuffixOf(quality));
}
