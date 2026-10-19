import {
    getAllUnitDefinitions, getBondRules, getCounterRules, getEnemyDeck, getPlayerDeck,
    ZCBondRule, ZCCounterRule, ZCDeckCard, ZCUnitDefinition,
} from './ZCCombatCatalog';
import { getPvpRuntimeRules, getZCLegacySkillEffectConfig, ZCRuntimeRules } from './ZCGameRuntimeConfig';
import type { ZCLegacySkillEffectConfig } from './ZCLegacySkillEffect';
import {
    getZCMapOwner, getZCMapSection, ZCCityMode, ZCFaction, ZCHexConfig, ZCMapArt, ZCMapHomeCandidates, ZCMapRegion,
    ZCMapResolvedResource, ZCMapResourcePoint, ZCMapSpacing, ZCOwner, ZCPlayerCount, ZCSection, ZC_HEX_CONFIG,
    ZC_MAP_ART, ZC_MAP_CITY_MODE, ZC_MAP_COLUMNS, ZC_MAP_HOMES, ZC_MAP_PLAYER_COUNT, ZC_MAP_REGIONS,
    ZC_MAP_RESOURCE_POINTS, ZC_MAP_HOME_CANDIDATES, ZC_MAP_ROWS, ZC_MAP_SPACING, ZC_MAP_ID,
    ZC_MAP_ZOOM_MIN, ZC_MAP_ZOOM_MAX,
    ZC_PLAYER_HOME_ID, ZC_ENEMY_HOME_ID, ZC_OWNER_ORDER,
} from './ZCMapConfig';
import {
    getAllRandomGoldPity, getPvpTileConfigs, getPvpTileTypeWeights,
    ZCPvpTileConfig, ZCPvpTileType, ZCPvpTileTypeWeight,
} from './ZCPvpTileRules';
import {
    compileZCCombatBuild,
    compileZCGeneralStarLoadout,
    getZCModifierCatalogs,
    ZCCombatBuildSelection,
    ZCCompiledModifierLoadout,
    ZCGeneralStarSelection,
} from './ZCModifierRuntime';
import type { ZCSkillBinding, ZCStatusConfigRecord } from './ZCStatSchema';
import type { ZCStatusBehavior, ZCStatusEffectDef } from './ZCStatusEffect';

export interface ZCMatchMap {
    id: string;
    rows: number;
    columns: number;
    playerHomeId: number;
    enemyHomeId: number;
    hexes: readonly ZCHexConfig[];
    owners: readonly ZCFaction[];
    /** 地图声明的对局人数（= 分区数）；缺省 2。第 1 席为本机玩家，其余席位为本地 AI。 */
    playerCount?: ZCPlayerCount;
    /** 主城模式；缺省 'fixed'。'select' 表示主城由开局选点产生，地图不产出坐标。 */
    cityMode?: ZCCityMode;
    /** 每格的分区归属；0 = 不属于任何分区（可通行时即中立格）。 */
    sections?: readonly ZCSection[];
    /** 固定主城模式下各方主城格 id（下标 0 = 1 区）；自选主城模式为空。 */
    homes?: readonly number[];
    /** 各方前 / 中 / 后区域；未圈画时为空。 */    regions?: readonly ZCMapRegion[];
    /** 自选主城候选格；某分区未声明时按旧规则选点。 */
    homeCandidates?: readonly ZCMapHomeCandidates[];
    /** 资源点位（开局据此抽中立资源）；无点位时为空。 */
    resourcePoints?: readonly ZCMapResourcePoint[];
    /** 选点结束后从各点位资源池抽出的本局结果。 */
    resolvedResources?: readonly ZCMapResolvedResource[];
    /** 可调间距参数（已补默认值）。 */
    spacing?: Readonly<Required<ZCMapSpacing>>;
    /** 美术配置。 */
    art?: Readonly<ZCMapArt>;
    /**
     * 局内镜头的倍率范围（R22 相机：「每个地图配置对应的最大和最小倍率」）。
     *
     *  真源是地图 JSON 的 `zoomMin` / `zoomMax`，经 `resolveZCMapZoom` 补默认值后带到这里，
     *  由 `ZCGame` 交给 HUD。缺省 `0.6 / 1.2`。
     */
    zoomMin?: number;
    zoomMax?: number;
}

/** 领地塔防的确定性出怪计划；由关卡表投影，随本局配置一起冻结。 */
export interface ZCPveDefenceWave {
    waveId: number;
    showAtSeconds: number;
    cardId: string;
    monsterCount: number;
    tier: number;
    hpRate: number;
    attackRate: number;
}

export interface ZCPveDefenceConfig {
    waves: readonly ZCPveDefenceWave[];
}

/** 只包含数据，允许测试、机器人模拟和回放注入独立的配置版本。 */
export interface ZCMatchConfig {
    map: ZCMatchMap;
    rules: Readonly<ZCRuntimeRules>;
    playerDeck: readonly ZCDeckCard[];
    enemyDeck: readonly ZCDeckCard[];
    /** 正式多方对局的逐 owner 卡池；旧配置缺省时仍按 playerDeck / enemyDeck 兼容。 */
    ownerDecks?: Readonly<Partial<Record<ZCOwner, readonly ZCDeckCard[]>>>;
    units: readonly ZCUnitDefinition[];
    bonds: readonly ZCBondRule[];
    counters: readonly ZCCounterRule[];
    tiles: Readonly<Record<ZCPvpTileType, ZCPvpTileConfig>>;
    tileWeights: readonly ZCPvpTileTypeWeight[];
    goldPity: number;
    /** 客户端选定武将/星级后编译出的本局修正；缺省表示本局不启用旧表修正。 */
    modifiers?: Readonly<Partial<Record<ZCOwner, readonly ZCCompiledModifierLoadout[]>>>;
    /** 本局冻结的技能行为绑定与状态定义，不在战斗中读取全局表。 */
    skillBindings?: readonly ZCSkillBinding[];
    statusDefinitions?: readonly ZCStatusEffectDef[];
    /** Old-client formulas frozen at match start; absent/empty keeps fixed pvpSkill damage fallback. */
    legacySkillEffects?: Readonly<ZCLegacySkillEffectConfig>;
    /** 仅领地塔防局存在；普通 PVP / 异步匹配均为空。 */
    pveDefence?: Readonly<ZCPveDefenceConfig>;
    configHash?: string;
}

function freezeData<T>(value: T): T {
    if (value && typeof value === 'object') {
        for (const child of Object.values(value)) freezeData(child);
        Object.freeze(value);
    }
    return value;
}

/** 把 pvpStatus 的 handlerKey 翻译成状态系统可执行的行为钩子（不再退化成 custom 死代码）。 */
function translateStatusBehavior(item: ZCStatusConfigRecord): ZCStatusBehavior {
    switch (item.handlerKey) {
        case 'none':
            return { kind: 'none' };
        case 'periodic_damage':
        case 'periodic_heal':
            return {
                kind: 'periodic',
                intervalSeconds: item.intervalSeconds,
                effect: item.handlerKey === 'periodic_heal' ? 'heal' : 'damage',
                amountPct: item.periodicAmountPct ?? 0,
                basis: item.periodicBasis ?? 'targetMaxHp',
                capAttackMultiplier: item.periodicCapMultiplier,
            };
        default:
            return { kind: 'custom', key: item.handlerKey };
    }
}

/** 拷贝并冻结本局配置，之后的全局配置加载不会影响正在进行的对局。 */
export function captureZCMatchConfig(
    source?: ZCMatchConfig,
    options?: { allowUnresolvedSelect?: boolean },
): ZCMatchConfig {
    const adapters = getZCModifierCatalogs().adapters;
    const config: ZCMatchConfig = source ?? {
        map: {
            id: ZC_MAP_ID, rows: ZC_MAP_ROWS, columns: ZC_MAP_COLUMNS,
            playerHomeId: ZC_PLAYER_HOME_ID, enemyHomeId: ZC_ENEMY_HOME_ID,
            playerCount: ZC_MAP_PLAYER_COUNT, cityMode: ZC_MAP_CITY_MODE,
            sections: ZC_HEX_CONFIG.map((hex) => getZCMapSection(hex.id)),
            homes: ZC_MAP_HOMES, regions: ZC_MAP_REGIONS, homeCandidates: ZC_MAP_HOME_CANDIDATES,
            resourcePoints: ZC_MAP_RESOURCE_POINTS,
            spacing: ZC_MAP_SPACING, art: ZC_MAP_ART,
            zoomMin: ZC_MAP_ZOOM_MIN, zoomMax: ZC_MAP_ZOOM_MAX,
            hexes: ZC_HEX_CONFIG, owners: ZC_HEX_CONFIG.map((hex) => getZCMapOwner(hex.id)),
        },
        rules: getPvpRuntimeRules(), playerDeck: getPlayerDeck(), enemyDeck: getEnemyDeck(),
        units: getAllUnitDefinitions(), bonds: getBondRules(), counters: getCounterRules(),
        tiles: getPvpTileConfigs(), tileWeights: getPvpTileTypeWeights(), goldPity: getAllRandomGoldPity(),
        skillBindings: adapters.skillBindings.filter((item) => item.enabled),
        statusDefinitions: adapters.statuses.filter((item) => item.enabled).map((item) => ({
            id: item.statusId,
            name: item.name,
            durationSeconds: item.durationSeconds,
            maxStacks: item.maxStacks,
            refreshOnReapply: item.refreshPolicy === 'refresh',
            refreshPolicy: item.refreshPolicy,
            statMods: item.statMods,
            behavior: translateStatusBehavior(item),
            control: item.control,
            sourceType: 'pvpStatus',
        })),
        legacySkillEffects: getZCLegacySkillEffectConfig(),
        configHash: adapters.configHash,
    };
    if (!config.map.hexes.length) throw new Error('地图配置未加载');
    // 自选主城地图不产出主城坐标（ZC_PLAYER_HOME_ID / ZC_ENEMY_HOME_ID = -1），只允许
    // ZCGame 的选点预备阶段显式放行；正式建模仍要求已解析为 fixed，避免 -1 向下游泄漏。
    if (config.map.cityMode === 'select' && !options?.allowUnresolvedSelect) {
        throw new Error('自选主城地图需要先完成开局选点，当前尚不支持直接开局');
    }
    const normalized: ZCMatchConfig = {
        ...config,
        modifiers: config.modifiers ?? { player: [], enemy: [] },
        skillBindings: config.skillBindings ?? [],
        statusDefinitions: config.statusDefinitions ?? [],
        legacySkillEffects: config.legacySkillEffects ?? {
            attributes: {}, effectsByKey: {}, buffDefaults: {}, buffTypes: {}, legacyStatusIds: {},
        },
        configHash: config.configHash ?? 'legacy',
    };
    return freezeData(JSON.parse(JSON.stringify(normalized)) as ZCMatchConfig);
}

/** client/server 构筑接入入口：等级、升星、装备、宝石统一在此编译后冻结。 */
export function withZCCombatBuildSelections(
    source: ZCMatchConfig,
    selections: Partial<Record<ZCOwner, readonly ZCCombatBuildSelection[]>>,
): ZCMatchConfig {
    const config = captureZCMatchConfig(source);
    const compile = (owner: ZCOwner) => (selections[owner] ?? [])
        .flatMap((selection) => compileZCCombatBuild(selection, config.units));
    return captureZCMatchConfig({
        ...config,
        modifiers: Object.fromEntries(ZC_OWNER_ORDER.map((owner) => [owner, compile(owner)])),
    });
}

/** 客户端组装开局参数的唯一入口：只传武将 id/星级，不直接拼 modifier id。 */
export function withZCGeneralStarSelections(
    source: ZCMatchConfig,
    selections: Partial<Record<ZCOwner, readonly ZCGeneralStarSelection[]>>,
): ZCMatchConfig {
    const config = captureZCMatchConfig(source);
    return captureZCMatchConfig({
        ...config,
        modifiers: Object.fromEntries(ZC_OWNER_ORDER.map((owner) => [owner,
            (selections[owner] ?? []).map((selection) => compileZCGeneralStarLoadout(selection, config.units)),
        ])),
    });
}
