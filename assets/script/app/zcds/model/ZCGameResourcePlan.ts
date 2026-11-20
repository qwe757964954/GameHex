import { zcWarmupEffectPaths } from './ZCEffectCatalog';
import { ZC_ATTACK_TRAITS } from './ZCCombatCatalog';

/** 战斗外壳路径的唯一声明；预热只取公共子集，不构筑任何对局状态。*/
export const ZC_BATTLE_SHELL_PATHS = {
    // 棋盘图层顺序由 prefab 子节点声明。
    hud: 'ui/game/ZCGameHUD', board: 'ui/game/ZCGameBoard', hex: 'ui/game/ZCGameHex',
    unit: 'ui/game/ZCGameUnit', effect: 'ui/game/ZCGameEffect', wall: 'ui/game/ZCGameWall',
    wallLayer: 'ui/game/ZCGameWallLayer', floatText: 'ui/game/ZCGameFloatText',
    cardReveal: 'ui/game/ZCGameCardReveal', legendBanner: 'ui/game/ZCGameLegendBanner',
    killBanner: 'ui/game/ZCGameKillBanner',
    // 装饰 Sprite 的 CUSTOM 尺寸和不裁边由 prefab 声明。
    decor: 'ui/game/ZCGameDecor', spawnSelection: 'ui/game/ZCSpawnSelection', bossPanel: 'ui/game/ZCBossPanel',
} as const;

const BATTLE_EFFECTS_DIRECTORY = 'units/effects';
const BATTLE_PROJECTILES_DIRECTORY = 'units/projectiles';

export const ZC_BATTLE_FX_PATHS = {
    effectsDirectory: BATTLE_EFFECTS_DIRECTORY,
    projectilesDirectory: BATTLE_PROJECTILES_DIRECTORY,
    spawn: `${BATTLE_EFFECTS_DIRECTORY}/出生特效/出生特效`,
    death: `${BATTLE_EFFECTS_DIRECTORY}/死亡特效/死亡特效`,
    buildingDestroy: `${BATTLE_EFFECTS_DIRECTORY}/建筑死亡特效/建筑死亡特效`,
    hitDirectory: `${BATTLE_EFFECTS_DIRECTORY}/受击特效`,
} as const;

export const ZC_BATTLE_DOWNLOAD_PREFABS = [
    ZC_BATTLE_SHELL_PATHS.hud, ZC_BATTLE_SHELL_PATHS.board, ZC_BATTLE_SHELL_PATHS.hex,
    ZC_BATTLE_SHELL_PATHS.unit, ZC_BATTLE_SHELL_PATHS.effect, ZC_BATTLE_SHELL_PATHS.wall,
    ZC_BATTLE_SHELL_PATHS.wallLayer, ZC_BATTLE_SHELL_PATHS.floatText,
] as const;

const coreFxPaths: string[] = [
    ZC_BATTLE_FX_PATHS.spawn, ZC_BATTLE_FX_PATHS.death, ZC_BATTLE_FX_PATHS.buildingDestroy,
];
const ZC_BATTLE_COMMON_FX_PREFABS: readonly string[] = coreFxPaths.concat(
    ZC_ATTACK_TRAITS.map(trait => `${ZC_BATTLE_FX_PATHS.hitDirectory}/${trait}受击/${trait}受击`),
);

export const ZC_BATTLE_COMMON_PREFABS: readonly string[] = Array.from<string>(ZC_BATTLE_DOWNLOAD_PREFABS).concat(
    [ZC_BATTLE_SHELL_PATHS.cardReveal, ZC_BATTLE_SHELL_PATHS.legendBanner,
        ZC_BATTLE_SHELL_PATHS.killBanner, ZC_BATTLE_SHELL_PATHS.decor],
    ZC_BATTLE_COMMON_FX_PREFABS,
);

/** 只从表字段收集下载路径，不创建卡牌、地图或对局状态。*/
export function buildZCBattleWarmupPaths(
    cards: readonly unknown[], skills: readonly unknown[], overrides: readonly unknown[],
): readonly string[] {
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
    for (const path of ZC_BATTLE_COMMON_PREFABS.concat([ZC_BATTLE_SHELL_PATHS.spawnSelection, ZC_BATTLE_SHELL_PATHS.bossPanel])) {
        paths.add(path);
    }
    for (const value of skills) {
        const row = rowOf(value);
        if (!row) continue;
        add(row.effectPrefabPath);
        // 命中附加表现（运动霸 203301「气浪」）要和 ZCGameLoader 的 effectPaths 收在同一份清单，
        // 少一处就会出现「预下载有、实战没有」或者反过来。
        add(row.impactEffectPrefabPath);
    }
    for (const value of overrides) {
        const row = rowOf(value);
        if (row && row.enabled === 1 && row.statId === 'model') add(row.value);
    }
    // 行为技能 / 追踪导弹的路径只在目录里登记，pvpSkill 表扫描收不到；
    // 预热只取目录标记 `warmup: true` 的组，不能直接用全量目录（会改变首包路径集合）。
    for (const path of zcWarmupEffectPaths()) paths.add(path);
    return Array.from(paths);
}

/** 静默解析只覆盖公共外壳和单位模型，弹道仍按本局阵容取。*/
export function buildZCBattleParsePaths(cards: readonly unknown[]): readonly string[] {
    return buildZCBattleWarmupPaths(cards, [], [])
        .filter(path => !path.startsWith(`${ZC_BATTLE_FX_PATHS.projectilesDirectory}/`));
}
