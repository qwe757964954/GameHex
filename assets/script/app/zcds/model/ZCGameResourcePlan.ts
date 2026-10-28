/** 战斗外壳路径唯一声明；预热只取公共子集，不构筑任何对局状态。 */
export const ZC_BATTLE_SHELL_PATHS = {
    hud: 'ui/game/ZCGameHUD', board: 'ui/game/ZCGameBoard', hex: 'ui/game/ZCGameHex',
    unit: 'ui/game/ZCGameUnit', effect: 'ui/game/ZCGameEffect', wall: 'ui/game/ZCGameWall',
    wallLayer: 'ui/game/ZCGameWallLayer', floatText: 'ui/game/ZCGameFloatText',
    cardReveal: 'ui/game/ZCGameCardReveal', legendBanner: 'ui/game/ZCGameLegendBanner',
    decor: 'ui/game/ZCGameDecor', spawnSelection: 'ui/game/ZCSpawnSelection', bossPanel: 'ui/game/ZCBossPanel',
} as const;

export const ZC_BATTLE_FX_PATHS = {
    spawn: 'units/effects/出生特效/出生特效',
    death: 'units/effects/死亡特效/死亡特效',
    buildingDestroy: 'units/effects/建筑死亡特效/建筑死亡特效',
    hitDirectory: 'units/effects/受击特效',
} as const;

export const ZC_BATTLE_DOWNLOAD_PREFABS = [
    ZC_BATTLE_SHELL_PATHS.hud, ZC_BATTLE_SHELL_PATHS.board, ZC_BATTLE_SHELL_PATHS.hex,
    ZC_BATTLE_SHELL_PATHS.unit, ZC_BATTLE_SHELL_PATHS.effect, ZC_BATTLE_SHELL_PATHS.wall,
    ZC_BATTLE_SHELL_PATHS.wallLayer, ZC_BATTLE_SHELL_PATHS.floatText,
] as const;

const ZC_BATTLE_COMMON_FX_PREFABS = [
    ZC_BATTLE_FX_PATHS.spawn, ZC_BATTLE_FX_PATHS.death, ZC_BATTLE_FX_PATHS.buildingDestroy,
    ...['射手', '战士', '法师', '坦克'].map(trait => `${ZC_BATTLE_FX_PATHS.hitDirectory}/${trait}受击/${trait}受击`),
] as const;

export const ZC_BATTLE_COMMON_PREFABS = [
    ...ZC_BATTLE_DOWNLOAD_PREFABS,
    ZC_BATTLE_SHELL_PATHS.cardReveal, ZC_BATTLE_SHELL_PATHS.legendBanner, ZC_BATTLE_SHELL_PATHS.decor,
    ...ZC_BATTLE_COMMON_FX_PREFABS,
] as const;

/** 只从表字段收集下载路径；不创建卡牌、地图或对局状态。 */
export function buildZCBattleWarmupPaths(
    cards: readonly unknown[], skills: readonly unknown[], overrides: readonly unknown[],
): readonly string[] {
    // 先保留 8 个首帧核心外壳，再准备单位和可后补的特效。
    const paths = new Set<string>(ZC_BATTLE_DOWNLOAD_PREFABS);
    const add = (value: unknown): void => {
        if (typeof value === 'string' && value.trim()) paths.add(value.trim().replace(/\\/g, '/'));
    };
    const rowOf = (value: unknown): Record<string, unknown> | null =>
        value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
    for (const value of cards) {
        const row = rowOf(value);
        if (row && row.enabled === 1) add(row.unitPrefabPath);
    }
    for (const path of [...ZC_BATTLE_COMMON_PREFABS, ZC_BATTLE_SHELL_PATHS.spawnSelection, ZC_BATTLE_SHELL_PATHS.bossPanel]) {
        paths.add(path);
    }
    for (const value of skills) {
        const row = rowOf(value);
        if (row) add(row.effectPrefabPath);
    }
    for (const value of overrides) {
        const row = rowOf(value);
        if (row && row.enabled === 1 && row.statId === 'model') add(row.value);
    }
    return [...paths];
}


/** 单通道静默解析只覆盖公共外壳与单位模型，弹道仍按本局阵容取用。 */
export function buildZCBattleParsePaths(cards: readonly unknown[]): readonly string[] {
    return buildZCBattleWarmupPaths(cards, [], []);
}
