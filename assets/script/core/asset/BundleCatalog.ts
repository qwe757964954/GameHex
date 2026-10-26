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
    [BIGMAP_BUNDLE]: [
        'image/bigmap',
        'ui/bigmap',
    ],
    [MAIN_PAGES_BUNDLE]: [
        'ui/Role', 'ui/League', 'ui/Store', 'ui/card', 'ui/Gift', 'ui/BattleToken', 'ui/Friend',
        'ui/Chat', 'ui/Mail', 'ui/PlayerInfo', 'ui/Hang', 'ui/Activity', 'ui/SevenDay',
        'ui/Celebration', 'ui/FirstRecharge', 'ui/LimitTimeAct', 'ui/MonthCardGift', 'ui/ShowReward',
        'ui/ItemDetail', 'ui/gm', 'ui/vscroll',
        'image/role', 'image/league', 'image/store', 'image/card', 'image/gift', 'image/battletoken',
        'image/friend', 'image/chat', 'image/mail', 'image/playerinfo', 'image/hang', 'image/activity',
        'image/activityIcon', 'image/sevenDay', 'image/celebration', 'image/firstRecharge',
        'image/limitTimeAct', 'image/monthcard', 'image/showReward', 'image/itemdetail',
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
