import { zcMissileFxPaths } from './ZCCombatEffectFlight';
import { ZC_SPLASH_SHOT_IMPACT_PREFAB_PATH, ZC_SPLASH_SHOT_MISSILE_PREFAB_PATH } from './ZCSplashShotFx';
import { ZC_BURST_IMPACT_PREFAB_PATH } from './ZCBurstFx';
import { ZC_SINGLE_STRIKE_EFFECT_PREFAB_PATH } from './ZCSingleStrikeFx';
import { ZC_DASH_EFFECT_PREFAB_PATH, ZC_DASH_GUARD_PREFAB_PATH } from './ZCDashFx';
import {
    ZC_BARRAGE_IMPACT_PREFAB_PATH, ZC_BARRAGE_MISSILE_PREFAB_PATH,
    ZC_WIND_BOLT_PREFAB_PATH, ZC_WIND_HURRICANE_PREFAB_PATH,
} from './ZCWindBarrageFx';
import { ZC_ATTACK_TRAITS } from './ZCCombatCatalog';

/** 战斗外壳路径的唯一声明；预热只取公共子集，不构筑任何对局状态。*/
export const ZC_BATTLE_SHELL_PATHS = {
    // 棋盘图层顺序由 prefab 子节点声明。
    hud: 'ui/game/ZCGameHUD', board: 'ui/game/ZCGameBoard', hex: 'ui/game/ZCGameHex',
    unit: 'ui/game/ZCGameUnit', effect: 'ui/game/ZCGameEffect', wall: 'ui/game/ZCGameWall',
    wallLayer: 'ui/game/ZCGameWallLayer', floatText: 'ui/game/ZCGameFloatText',
    cardReveal: 'ui/game/ZCGameCardReveal', legendBanner: 'ui/game/ZCGameLegendBanner',
    // 装饰 Sprite 的 CUSTOM 尺寸和不裁边由 prefab 声明。
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

const coreFxPaths: string[] = [
    ZC_BATTLE_FX_PATHS.spawn, ZC_BATTLE_FX_PATHS.death, ZC_BATTLE_FX_PATHS.buildingDestroy,
];
const ZC_BATTLE_COMMON_FX_PREFABS: readonly string[] = coreFxPaths.concat(
    ZC_ATTACK_TRAITS.map(trait => `${ZC_BATTLE_FX_PATHS.hitDirectory}/${trait}受击/${trait}受击`),
);

export const ZC_BATTLE_COMMON_PREFABS: readonly string[] = Array.from<string>(ZC_BATTLE_DOWNLOAD_PREFABS).concat(
    [ZC_BATTLE_SHELL_PATHS.cardReveal, ZC_BATTLE_SHELL_PATHS.legendBanner, ZC_BATTLE_SHELL_PATHS.decor],
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
    // 追踪导弹的弹体/爆炸路径只在 ZCCombatEffectFlight.MISSILE_FX_BY_UNIT 里登记，
    // pvpSkill 任何一行都不带，表扫描收不到，所以这里单独补一遍。
    for (const fx of zcMissileFxPaths()) paths.add(fx);
    //  孢爆箭 / 孢子凝珠（`splash_shot` / `spore_burst`，2026-11-17 第 12 批）的弹体与爆点
    //  同样只在代码常量里登记（`ZCSplashShotFx`），表扫描收不到。实战清单里那两条也要
    //  和这里对得上，否则会出现「预下载有、实战没有」或者反过来。
    paths.add(ZC_SPLASH_SHOT_MISSILE_PREFAB_PATH);
    paths.add(ZC_SPLASH_SHOT_IMPACT_PREFAB_PATH);
    //  菌毯爆发 / 菌核爆裂（`burst_aura` / `burst_knockback`，2026-11-17 第 13 批）的爆点
    //  同理只登记在 `ZCBurstFx` 里。这里加的是**去重后的集合**，重复的那条
    //  （`普攻爆炸` 本来就因为普攻/孢爆箭在清单里）不会产生第二份加载。
    paths.add(ZC_BURST_IMPACT_PREFAB_PATH);
    //  菌丝突刺（`single_strike`，2026-11-17 第 14 批）的撕裂只登记在 `ZCSingleStrikeFx` 里。
    //  菌丝绞杀（`fan_slow`）沿用上面那条普攻爆炸，不需要单独加。
    paths.add(ZC_SINGLE_STRIKE_EFFECT_PREFAB_PATH);
    //  冲锋（`charge_shield` / `legacy_dash`，2026-11-17 第 15 批）的残影与落地自保表现
    //  只登记在 `ZCDashFx` 里。两条都是「此前没有任何技能在用」的老资源。
    paths.add(ZC_DASH_EFFECT_PREFAB_PATH);
    paths.add(ZC_DASH_GUARD_PREFAB_PATH);
    //  风弹 + 飓风 / 连射导弹（`wind_bolt` / `missile_barrage`，2026-11-18 第 16 批）的四条路径
    //  只登记在 `ZCWindBarrageFx` 里。其中导弹弹体与命中爆炸与镭射飞龙是同一份文件，
    //  但这里加的是去重集合，不会产生第二份加载。
    paths.add(ZC_WIND_BOLT_PREFAB_PATH);
    paths.add(ZC_WIND_HURRICANE_PREFAB_PATH);
    paths.add(ZC_BARRAGE_MISSILE_PREFAB_PATH);
    paths.add(ZC_BARRAGE_IMPACT_PREFAB_PATH);
    return Array.from(paths);
}

/** 静默解析只覆盖公共外壳和单位模型，弹道仍按本局阵容取。*/
export function buildZCBattleParsePaths(cards: readonly unknown[]): readonly string[] {
    return buildZCBattleWarmupPaths(cards, [], []).filter(path => !path.startsWith('units/projectiles/'));
}
