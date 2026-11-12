/**
 * Bundle 分包清单（2026-10-23 第二轮）。
 *
 * 首包保留 `resources`：config/、ui/login|loading|main|common|MainTask|territory|matching、
 * image/login|main|common|maintask|territory|matching|artifact|buildings|decor|legend|GameRank|setting|frame、
 * icons/common|main|head、skel/（含首屏 RedDot 依赖的 reddot）、塔防/（全局音频）、shaders/。
 *
 * 划分口径：只把**确定单一玩法域**使用的目录搬出首包；跨玩法复用（buildings/decor/territory/artifact）
 * 一律留首包，避免"进大世界/功能页需先下载战斗包"的坏耦合。
 */
export const RESOURCES_BUNDLE = 'resources';
export const BATTLE_BUNDLE = 'battle';
export const BIGMAP_BUNDLE = 'bigmap';
export const MAIN_PAGES_BUNDLE = 'main-pages';

/** 各 bundle 在 `assets/bundles/<name>/` 下的目录（相对路径）。迁移脚本与测试共用这一份。 */
export const BUNDLE_DIRECTORIES: Readonly<Record<string, readonly string[]>> = {
    [BATTLE_BUNDLE]: [
        'units',
        'ui/game',
        'image/effects',
        'image/map-resource',
        'image/spawn-region',
        'image/gameui',
        'image/settlement',
    ],
    // ⚠️ 2026-11-04 bundle 内 `image/bigmap/` **上提**成 `image/`，原来那条
    // `'image/bigmap'` 前缀隔离一起没了 —— 首包 `resources` 也有 `image/`，所以
    // **不能再登记 `'image'`**（会连带吞掉 `image/buildings`、`image/territory`、
    // `image/common` 等首包目录，`tests/bundle-scope.test.ts` 会直接红）。
    // 只能逐条登记 bigmap bundle 里**真实存在**的条目；新增图片务必同步这里，
    // 漏了就是「图不显示 + 零报错」（`tests/bigmap-bundle-coverage.test.ts` 兜底）。
    [BIGMAP_BUNDLE]: [
        'image/concept',
        'image/base_background',
        // 2048×2048 大背景，**刻意放在 bundle 顶层、不进 `image/` 的图集子树**：
        // `image/` 根的 pac 递归收一切 png，这么大的图塞进任何一页都会被缩糊；
        // 单个 spriteFrame 独立采样、不进图集也零损失。
        'bigMapBG',
        'ui/bigmap',
    ],
    [MAIN_PAGES_BUNDLE]: [
        'ui/Role', 'ui/League', 'ui/Store', 'ui/card', 'ui/Gift', 'ui/BattleToken', 'ui/Friend',
        'ui/Chat', 'ui/Mail', 'ui/PlayerInfo', 'ui/Hang', 'ui/Activity', 'ui/SevenDay',
        'ui/Celebration', 'ui/FirstRecharge', 'ui/LimitTimeAct', 'ui/MonthCardGift', 'ui/ShowReward',
        'ui/ItemDetail', 'ui/ItemInfo', 'ui/gm', 'ui/vscroll',
        'image/role', 'image/league', 'image/store', 'image/card', 'image/carddetail', 'image/gift', 'image/battletoken',
        'image/friend', 'image/chat', 'image/mail', 'image/playerinfo', 'image/hang', 'image/activity',
        'image/activityIcon', 'image/sevenDay', 'image/celebration', 'image/firstRecharge',
        'image/limitTimeAct', 'image/monthcard', 'image/showReward', 'image/itemdetail', 'image/iteminfo',
        'icons/item', 'icons/equip', 'icons/gem', 'icons/cardHead', 'icons/card', 'icons/skill',
        'icons/hero', 'icons/militia',
    ],
};

/**
 * 路径 → bundle 名（用于少数跨目录加载点：大世界美术同时取首包与 bigmap 资源）。
 * 未登记路径返回 undefined，即首包 `resources`。
 */
export function bundleForPath(path: string): string | undefined {
    for (const [bundle, dirs] of Object.entries(BUNDLE_DIRECTORIES)) {
        for (const dir of dirs) {
            if (path === dir || path.startsWith(`${dir}/`)) return bundle;
        }
    }
    return undefined;
}
