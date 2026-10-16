/**
 * 角色模块美术的**加载层**（`RoleArt.ts` 的表 + 这里的一份缓存）。
 *
 * 与表本身分开的原因（**别合并回去**）：
 *   `RoleArt.ts` 是纯数据（键 → 路径），零 `cc` 依赖 ⇒ `tests/role.test.ts` 能直接
 *   import 它做「美术映射 ↔ 磁盘文件」双向对账；一旦在那边写 `import { resources } from 'cc'`，
 *   整组用例就 `Cannot find module 'cc'` 静默失效（项目规则：判定/数据层不许引引擎）。
 *
 * ⚠️ 缓存**必须** `addRef()`（项目规则 81）：模块级 `Map` 不参与引用计数，
 * `SpriteFrame.refCount` 停在 0 会被引擎的 `ReleaseManager._freeAssets()` 直接 `destroy()`，
 * 而 `cc.Sprite._spriteFrame` 仍指着它 ⇒ 下一次标脏渲染炸
 * `Simple.updateUVs: Cannot read properties of null (reading '0')`
 * （只在重新渲染那一刻炸，看着像别的模块的锅）。
 */
import { resources, SpriteFrame } from 'cc';
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

const cache = new Map<string, SpriteFrame>();
const pending = new Map<string, Promise<SpriteFrame | null>>();
let generation = 0;

/** 取一张角色模块的图；拿不到返回 `null`（调用方自己决定留白 / 隐藏）。 */
export function loadRoleArt(key: string): Promise<SpriteFrame | null> {
    const path = roleFramePathOf(key);
    if (!path) {
        console.warn(`[RoleArt] 没有 key ${key}`);
        return Promise.resolve(null);
    }
    const cached = cache.get(key);
    if (cached?.isValid) return Promise.resolve(cached);
    if (cached) cache.delete(key);
    const running = pending.get(key);
    if (running) return running;

    const mark = generation;
    const task = new Promise<SpriteFrame | null>((resolve) => {
        resources.load(path, SpriteFrame, (error, frame) => {
            if (error || !frame || !frame.isValid) {
                console.warn(`[RoleArt] 加载失败：${path}`, error);
                resolve(null);
                return;
            }
            if (mark !== generation) {
                resolve(null);
                return;
            }
            frame.addRef();
            cache.set(key, frame);
            resolve(frame);
        });
    });
    pending.set(key, task);
    const clear = () => {
        if (pending.get(key) === task) pending.delete(key);
    };
    void task.then(clear, clear);
    return task;
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
    const cached = cache.get(key);
    return cached?.isValid ? cached : null;
}

/**
 * 清缓存（测试用）。
 * 正常流程**不要**在运行时调 —— 会把已经 `addRef()` 的图丢掉引用来源。
 */
export function resetRoleArtCacheForTest(): void {
    generation += 1;
    for (const frame of cache.values()) {
        if (frame.isValid) frame.decRef();
    }
    cache.clear();
    pending.clear();
    for (const frame of bagIconCache.values()) {
        if (frame.isValid) frame.decRef();
    }
    bagIconCache.clear();
    bagIconPending.clear();
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

const bagIconCache = new Map<string, SpriteFrame>();
const bagIconPending = new Map<string, Promise<SpriteFrame | null>>();

/** 取 `icons/<kind>/<iconKey>` 一张图；拿不到返回 `null`（调用方留白）。 */
export function loadRoleBagIconSprite(
    kind: 'gem' | 'equip' | 'militia',
    iconKey: string,
): Promise<SpriteFrame | null> {
    const root = BAG_ICON_ROOTS[kind];
    if (!root || !iconKey) return Promise.resolve(null);
    const key = `${root}/${iconKey}`;

    const cached = bagIconCache.get(key);
    if (cached?.isValid) return Promise.resolve(cached);
    if (cached) bagIconCache.delete(key);
    const running = bagIconPending.get(key);
    if (running) return running;

    const task = new Promise<SpriteFrame | null>((resolve) => {
        resources.load(spriteFramePathOf(key), SpriteFrame, (error, frame) => {
            if (error || !frame || !frame.isValid) {
                // 图确实缺（美术未导）⇒ 这条 warn 是**正确路径**的缺图提示，不是拼错目录。
                console.warn(`[RoleArt] 背包图标缺失：${key}`, error);
                resolve(null);
                return;
            }
            frame.addRef();   // 同 loadRoleArt：模块级缓存必须持引用（规则 81）
            bagIconCache.set(key, frame);
            resolve(frame);
        });
    });
    bagIconPending.set(key, task);
    const clear = () => {
        if (bagIconPending.get(key) === task) bagIconPending.delete(key);
    };
    void task.then(clear, clear);
    return task;
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
