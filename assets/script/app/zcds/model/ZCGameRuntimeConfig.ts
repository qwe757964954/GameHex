import {
    getEnemyDeck, getPlayerDeck, hasUnitDefinition, setBondRules, setCardCatalog,
    setCounterRules, setUnitCatalog, setRuntimeDecks,
} from './ZCCombatCatalog';
import { setPvpTileRules } from './ZCPvpTileRules';
import { setZCModifierCatalogs } from './ZCModifierRuntime';
import type { ZCLegacySkillEffectConfig } from './ZCLegacySkillEffect';
import { compilePvpTables } from './ZCPvpConfigCompiler';
export { compilePvpTables } from './ZCPvpConfigCompiler';
export {
    isHqCard, parseCard, parseCardCatalogRow, parseUnits, parseBondRules, normalizeCardRow,
} from './ZCPvpTableParser';

export interface ZCConfigLoadResult {
    readonly schemaVersion: number;
    readonly sourceSha256: string;
    readonly cardCount: number;
    readonly unitCount: number;
}

export interface ZCRuntimeRules {
    schemaVersion: number;
    sourceSha256: string;
    matchDurationSeconds: number;
    initialGold: number;
    hqIncomeAmount: number;
    hqIncomeIntervalSeconds: number;
    artifactChargePerDevelopment: number;
    artifactChargeFull: number;
    artifactMaxStored: number;
    artifactName: string;
    /**
     * 本局神器的图标名（`pvpArtifact[].icon`，如「霜封冰刃」），**不带目录与后缀**。
     *
     *  渲染层按 `image/artifact/<icon>` 拼路径加载（规则 137）；中立资源点「神器充能」
     *  格的图标显示的就是玩家携带的这件神器，所以换神器后格子图标会自动跟着变。
     */
    artifactIcon: string;
    artifactCooldownSeconds: number;
    artifactFreezeSeconds: number;
    artifactEnemySpeedMultiplier: number;
    artifactDamage: number;
    unitCapPerSide: number;
    unitHpPerTier: number;
    unitAttackPerTier: number;
    spawnTierReduction: number;
    spawnMinimumSeconds: number;
    towerAttackInterval: number;
    towerRangeHex: number;
    combatDamageMultiplier: number;
    combatDistanceScale: number;
    enemyAiIntervalSeconds: number;
    captureSeconds: number;
    captureExtraUnitRate: number;
    captureMaxSpeedMultiplier: number;
    captureDecayMultiplier: number;
    captureDefendMultiplier: number;
    captureRequireSupply: boolean;
    killUnitGoldReward: number;
    destroyBuildingGoldReward: number;
    /** 每个席位在自己主城邻格里的金矿保底个数（`ZCPvpTileRules.createPvpTileTypes` 阶段 1a）。 */
    initialGuaranteedMine: number;
    wallMaxHp: number;
    hqMaxHp: number;
}

/** 运行时全局规则；loadPvpTables 注入后才能取。 */
let runtimeRules: Readonly<ZCRuntimeRules> | null = null;
/** 旧客户端公式冻结表；loadPvpTables 注入。 */
let legacySkillEffects: Readonly<ZCLegacySkillEffectConfig> | null = null;

/** 取运行时全局规则；配置未加载（初始化失败路径）时抛错，不做内置兜底。 */
export function getPvpRuntimeRules(): Readonly<ZCRuntimeRules> {
    if (!runtimeRules) throw new Error('[ZCGameRuntimeConfig] PVP 全局配置未加载');
    return runtimeRules;
}

/** Frozen into each match together with the normal PVP tables. */
export function getZCLegacySkillEffectConfig(): Readonly<ZCLegacySkillEffectConfig> {
    return legacySkillEffects;
}

/** 一张出战卡引用了「上不了场」的单位（单位表缺「单位预设」或「普攻技能ID」）。 */
export interface ZCUnplayableDeckCard {
    cardId: string;
    cardName: string;
    unitId: string;
}

/**
 * 出战卡 → 单位 的引用完整性：列出所有引用了**不可上场单位**的出战卡。
 *
 * 合表后（2026-09-20）单位列内联在卡行上，「卡引用的单位」就是它自己那一行。
 * 缺口的形态因此变成：某个**兵种卡行两项单位列都没配**（被 `parseUnits` 当建筑卡跳过），
 * 而这张卡却在出战卡组里 —— 场面会在**第一次出兵**时抛「本局单位有效属性不存在」，
 * 报错点离原因很远。所以由这里提前一次性汇总。
 */
export function findUnplayableDeckCards(): ZCUnplayableDeckCard[] {
    const missing: ZCUnplayableDeckCard[] = [];
    const seen = new Set<string>();
    for (const card of [...getPlayerDeck(), ...getEnemyDeck()]) {
        if (!card.unitId) continue;
        if (hasUnitDefinition(card.unitId)) continue;
        if (seen.has(card.unitId)) continue;
        seen.add(card.unitId);
        missing.push({ cardId: card.id, cardName: card.name, unitId: card.unitId });
    }
    return missing;
}

/** 当前 remoteRef 中的 PVP 分表。 */
export interface ZCPvpTables {
    pvpGlobal?: Array<{ key: string; value: unknown }>;
    pvpArtifact?: Array<Record<string, unknown>>;
    pvpCard?: Array<Record<string, unknown>>;
    //  `pvpUnit` 已于 2026-09-20 并入 `pvpCard`（单位列内联、加 `unit` 前缀）——
    // 表本身已下线，这里也刻意不再留可选字段：留着会让"表没了但代码还读得到空数组"
    // 变成一种能跑通的假象。
    pvpSkill?: Array<Record<string, unknown>>;
    pvpCounter?: Array<Record<string, unknown>>;
    pvpBond?: Array<Record<string, unknown>>;
    pvpTile?: Array<Record<string, unknown>>;
    pvpPity?: Array<Record<string, unknown>>;
    pvpTileGen?: Array<Record<string, unknown>>;
    pvpTileGenParams?: Array<{ key: string; value: unknown }>;
    pvpBaseTeamWeight?: Array<Record<string, unknown>>;
    skillAttrModifier?: Array<Record<string, unknown>>;
    generalStar?: Array<Record<string, unknown>>;
    pvpAttrMap?: Array<Record<string, unknown>>;
    pvpModifierOverride?: Array<Record<string, unknown>>;
    pvpUnitGrowth?: Array<Record<string, unknown>>;
    pvpSkillBinding?: Array<Record<string, unknown>>;
    pvpStatus?: Array<Record<string, unknown>>;
    pvpSkillPlan?: Array<Record<string, unknown>>;
    /** Old-client tables kept as the Excel-authoring compatibility surface. */
    skillAttr?: Array<Record<string, unknown>>;
    skillView?: Array<Record<string, unknown>>;
    skillEffect?: Array<Record<string, unknown>>;
    skillBuff?: Array<Record<string, unknown>>;
}

/** 编译成功后一次性安装运行时目录；外部仍使用原入口。 */
export function loadPvpTables(tables: ZCPvpTables): ZCConfigLoadResult {
    const compiled = compilePvpTables(tables);
    setUnitCatalog(compiled.units);
    setCardCatalog(new Map(compiled.cards.map((card) => [card.id, card])));
    setRuntimeDecks(compiled.playerDeck, compiled.enemyDeck);
    setCounterRules(compiled.counters);
    setBondRules(compiled.bonds);
    setPvpTileRules(compiled.tileConfigs, compiled.tileWeights, compiled.goldPity);
    setZCModifierCatalogs(compiled.modifierCatalogs);
    runtimeRules = compiled.rules;
    legacySkillEffects = compiled.legacySkillEffects;
    return {
        schemaVersion: compiled.rules.schemaVersion,
        sourceSha256: compiled.rules.sourceSha256,
        cardCount: compiled.playerDeck.length + compiled.enemyDeck.length,
        unitCount: compiled.units.size,
    };
}
