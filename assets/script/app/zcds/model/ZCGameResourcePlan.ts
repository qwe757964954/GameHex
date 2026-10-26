/** 战斗外壳路径唯一声明；预热只取公共子集，不构筑任何对局状态。 */
export const ZC_BATTLE_SHELL_PATHS = {
    hud: 'ui/game/ZCGameHUD', board: 'ui/game/ZCGameBoard', hex: 'ui/game/ZCGameHex',
    unit: 'ui/game/ZCGameUnit', effect: 'ui/game/ZCGameEffect', wall: 'ui/game/ZCGameWall',
    wallLayer: 'ui/game/ZCGameWallLayer', floatText: 'ui/game/ZCGameFloatText',
    cardReveal: 'ui/game/ZCGameCardReveal', legendBanner: 'ui/game/ZCGameLegendBanner',
    decor: 'ui/game/ZCGameDecor', spawnSelection: 'ui/game/ZCSpawnSelection', bossPanel: 'ui/game/ZCBossPanel',
} as const;

export const ZC_BATTLE_DOWNLOAD_PREFABS = [
    ZC_BATTLE_SHELL_PATHS.hud, ZC_BATTLE_SHELL_PATHS.board, ZC_BATTLE_SHELL_PATHS.hex,
    ZC_BATTLE_SHELL_PATHS.unit, ZC_BATTLE_SHELL_PATHS.effect, ZC_BATTLE_SHELL_PATHS.wall,
    ZC_BATTLE_SHELL_PATHS.wallLayer, ZC_BATTLE_SHELL_PATHS.floatText,
] as const;

export const ZC_BATTLE_COMMON_PREFABS = [
    ...ZC_BATTLE_DOWNLOAD_PREFABS,
    ZC_BATTLE_SHELL_PATHS.cardReveal, ZC_BATTLE_SHELL_PATHS.legendBanner, ZC_BATTLE_SHELL_PATHS.decor,
] as const;
