import type { ZCPvpTables, ZCRuntimeRules } from './ZCGameRuntimeConfig';
import { parseZCModifierCatalogs } from './ZCModifierRuntime';
import { parseZCLegacySkillEffectConfig, parseZCLegacySkillViewBindings } from './ZCLegacySkillEffect';
import type { ZCAttackProfile, ZCDeckCard, ZCUnitDefinition, ZCUnitId, ZCCounterRule, ZCBondRule } from './ZCCombatCatalog';
import { ZCPvpTileType } from './ZCPvpTileRules';
import type { ZCPvpTileConfig, ZCPvpTileTypeWeight } from './ZCPvpTileRules';
import {
    object, number, text, globalNumber, globalNumberOr, parseCard, parseAttackProfiles,
    parseUnits, parseTileConfigs, parseBaseTeamWeights, parseTileWeights,
    parseCounterRules, parseBondRules, isHqCard, normalizeCardRow,
    refBool, refNullable, kvToObject,
} from './ZCPvpTableParser';

export interface IZCPvpCompiledConfig {
    readonly cards: readonly (ZCDeckCard & { enabled: boolean })[];
    readonly playerDeck: readonly ZCDeckCard[];
    readonly enemyDeck: readonly ZCDeckCard[];
    readonly units: ReadonlyMap<ZCUnitId, ZCUnitDefinition>;
    readonly counters: readonly ZCCounterRule[];
    readonly bonds: readonly ZCBondRule[];
    readonly tileConfigs: Readonly<Record<ZCPvpTileType, ZCPvpTileConfig>>;
    readonly tileWeights: readonly ZCPvpTileTypeWeight[];
    readonly goldPity: number;
    readonly modifierCatalogs: ReturnType<typeof parseZCModifierCatalogs>;
    readonly legacySkillEffects: ReturnType<typeof parseZCLegacySkillEffectConfig>;
    readonly rules: Readonly<ZCRuntimeRules>;
}

/** 校验并编译当前 PVP 分表；任何字段失败都不会污染运行时配置。 */
export function compilePvpTables(tables: ZCPvpTables): IZCPvpCompiledConfig {
    const global = kvToObject(tables.pvpGlobal);
    const schemaVersion = typeof global.schemaVersion === 'number' ? global.schemaVersion : 2;
    if (schemaVersion < 2) throw new Error('pvpGlobal.schemaVersion 必须不小于 2');

    const cards = (tables.pvpCard ?? [])
        .map(normalizeCardRow)
        .map(parseCard)
        .filter((card) => card.enabled);
    // 主城也是「金币建筑」：耐久与收入都取自卡表 type=5 的那一行
    // （`baseHp` 耐久、`goldDigTime` 产金周期、`buildDigGoldNum` 每次产金数量）。
    // 主城不进入双方可抽取的卡组。
    const hqCard = cards.find(isHqCard);
    if (!hqCard) throw new Error('pvpCard 缺少已启用的主城卡');
    // deck/slot 列已删除（2026-09-28）：双方卡组由后端 CmdStartBattleRspMsg.unitInfos 下发，
    // 本地 pvpCard 只提供数值模板。这里保留全量 enabled 卡作为 fallback（后端未给 heroIds 时用）。
    const playerDeck = cards.filter((card) => !isHqCard(card));
    const enemyDeck = cards.filter((card) => !isHqCard(card));
    const skillRows = (tables.pvpSkill ?? []).map((row) => ({
        ...row,
        effectKey: refNullable(row.effectKey),
        projectileKey: refNullable(row.projectileKey),
        effectPrefabPath: refNullable(row.effectPrefabPath),
    }));
    const parsedSkills = parseAttackProfiles(skillRows);
    const legacyBindings = parseZCLegacySkillViewBindings(
        tables.skillView ?? [],
        new Map(Array.from(parsedSkills, ([skillId, profile]) => [skillId, profile.empoweredSkillId])),
    );
    const skills = new Map<number, ZCAttackProfile>();
    for (const [skillId, profile] of parsedSkills) {
        const keys = legacyBindings[skillId] ?? [];
        skills.set(skillId, keys.length ? { ...profile, legacyEffectKeys: keys } : profile);
    }
    const referencedLegacyKeys = new Set<string>();
    for (const profile of skills.values()) {
        for (const key of profile.legacyEffectKeys ?? []) referencedLegacyKeys.add(key);
    }
    const nextLegacySkillEffects = parseZCLegacySkillEffectConfig(
        tables.skillAttr ?? [],
        tables.skillEffect ?? [],
        tables.skillBuff ?? [],
        tables.pvpStatus ?? [],
        referencedLegacyKeys,
    );

    //  合表后单位属性内联在卡行上（2026-09-20 起 `pvpUnit` 表已下线）：直接用**原始卡行**
    // 建单位目录。不能复用上面那份 `cards` —— 那是过滤后的**出战卡**，
    // 而卡池里的兵种同样要能上场（抽到卡池卡 → 进卡组 → 出兵）。
    const units = parseUnits((tables.pvpCard ?? []).map(normalizeCardRow), skills);
    const modifierCatalogs = parseZCModifierCatalogs(
        tables.skillAttrModifier ?? [],
        tables.generalStar ?? [],
        {
            pvpAttrMap: tables.pvpAttrMap ?? [],
            pvpModifierOverride: tables.pvpModifierOverride ?? [],
            pvpUnitGrowth: tables.pvpUnitGrowth ?? [],
            pvpSkillBinding: tables.pvpSkillBinding ?? [],
            pvpStatus: tables.pvpStatus ?? [],
            pvpSkillPlan: tables.pvpSkillPlan ?? [],
        },
    );

    const tileRows = (tables.pvpTile ?? []).map((row) => ({
        ...row,
        pityGroup: refNullable(row.pityGroup),
    }));
    const tileConfigs = parseTileConfigs(tileRows);
    // 抽取权重优先用基础阵容权重随机表（含初始/集合限制）；未提供时回退到地块生成表。
    const tileWeights = (tables.pvpBaseTeamWeight?.length
        ? parseBaseTeamWeights(tables.pvpBaseTeamWeight)
        : parseTileWeights(tables.pvpTileGen ?? []));

    const pityRules = (tables.pvpPity ?? []).map((row) => object(row, 'pvpPity[]'));
    // 保底规则按 `tileType` 关联地块（`pvpPity.tileType` = `pvpTile.id`），不是按自己的 `id`。
    const goldPity = number(
        pityRules.find((rule) => rule.tileType === ZCPvpTileType.AllRandom)?.triggerCount,
        'pvpPity[\u5168\u7c7b\u578b\u968f\u673a].triggerCount',
    );
    const counters = parseCounterRules(tables.pvpCounter ?? []);
    const bonds = parseBondRules(tables.pvpBond ?? []);
    const artifactRows: Array<Record<string, unknown> & { unlocked: boolean }> = (tables.pvpArtifact ?? []).map((row) => ({
        ...row,
        unlocked: refBool(row.unlocked) ?? false,
    }));
    const artifact = artifactRows.find((row) => row.unlocked && row.effectType === 'freezeDamage')
        ?? artifactRows.find((row) => row.unlocked);
    if (!artifact) throw new Error('pvpArtifact 至少需要一个已解锁神器');

    const tileParameters = kvToObject(tables.pvpTileGenParams);
    const nextRules: ZCRuntimeRules = {
        schemaVersion,
        sourceSha256: 'remoteRef',
        matchDurationSeconds: globalNumber(global, 'matchDurationSeconds'),
        initialGold: globalNumber(global, 'initialGold'),
        // 主城收入：卡表「主城」行的 `buildDigGoldNum`（每次产金数量，**固定值不随品级**）
        // 与 `goldDigTime`（产金周期）。缺值时退回 `PVP-全局` 的 hqIncome*。
        hqIncomeAmount: (hqCard.buildDigGoldNum ?? 0) > 0
            ? hqCard.buildDigGoldNum!
            : globalNumber(global, 'hqIncomeAmount'),
        hqIncomeIntervalSeconds: (hqCard.cycleSeconds ?? 0) > 0
            ? hqCard.cycleSeconds!
            : globalNumber(global, 'hqIncomeIntervalSeconds'),
        artifactChargePerDevelopment: number(artifact.chargePerGoldSpend, 'pvpArtifact[].chargePerGoldSpend'),
        artifactChargeFull: number(artifact.chargeFull, 'pvpArtifact[].chargeFull'),
        artifactMaxStored: number(artifact.maxStored, 'pvpArtifact[].maxStored'),
        artifactName: text(artifact.name, 'pvpArtifact[].name'),
        /**
         * 本局神器的图标名（`pvpArtifact[].icon`，如「霜封冰刃」），**不带目录、不带后缀**。
         *
         *  渲染层按 `image/artifact/<icon>` 拼路径去 `resources.load`（与 `pvpCard.icon` 同一口径，
         *  规则 137）。中立资源点「神器充能」图标要显示**玩家当前携带的这件神器**，
         * 用的就是这个字段 —— 换神器（改表的第一行）后图标会自动跟着变。
         */
        artifactIcon: text(artifact.icon, 'pvpArtifact[].icon'),
        artifactCooldownSeconds: number(artifact.cooldownSeconds, 'pvpArtifact[].cooldownSeconds', 0, true),
        artifactFreezeSeconds: number(artifact.effectSeconds, 'pvpArtifact[].effectSeconds', 0, true),
        artifactEnemySpeedMultiplier: globalNumber(global, 'artifactEnemySpeedMultiplier'),
        artifactDamage: number(artifact.effectValue, 'pvpArtifact[].effectValue', 0, true),
        unitCapPerSide: globalNumber(global, 'unitCapPerSide'),
        unitHpPerTier: globalNumber(global, 'unitHpPerTier', 0, true),
        unitAttackPerTier: globalNumber(global, 'unitAttackPerTier', 0, true),
        spawnTierReduction: globalNumber(global, 'spawnTierReduction', 0, true),
        spawnMinimumSeconds: globalNumber(global, 'spawnMinimumSeconds'),
        towerAttackInterval: globalNumber(global, 'towerAttackInterval'),
        towerRangeHex: globalNumber(global, 'towerRangeHex'),
        combatDamageMultiplier: globalNumber(global, 'combatDamageMultiplier'),
        combatDistanceScale: globalNumber(global, 'combatDistanceScale'),
        enemyAiIntervalSeconds: globalNumber(global, 'enemyAiIntervalSeconds'),
        captureSeconds: globalNumberOr(global, 'captureSeconds', .1),
        captureExtraUnitRate: globalNumberOr(global, 'captureExtraUnitRate', .25, 0, true),
        captureMaxSpeedMultiplier: globalNumberOr(global, 'captureMaxSpeedMultiplier', 2, 1, true),
        captureDecayMultiplier: globalNumberOr(global, 'captureDecayMultiplier', 1),
        captureDefendMultiplier: globalNumberOr(global, 'captureDefendMultiplier', 2),
        captureRequireSupply: refBool(global.captureRequireSupply) ?? true,
        killUnitGoldReward: globalNumber(global, 'killUnitGoldReward', 0, true),
        destroyBuildingGoldReward: globalNumber(global, 'destroyBuildingGoldReward', 0, true),
        // 每个席位各保底几个金矿 —— 口径见 `createPvpTileTypes` 阶段 1a（不是全场合计）。
        initialGuaranteedMine: number(tileParameters.initialGuaranteedMine, 'pvpTileGenParams.initialGuaranteedMine', 0, true),
        // 城墙耐久走全局表 —— 城墙不是卡牌、耐久挂在「边」上，卡表里没有它的行。
        // 主城耐久取自卡表主城行：`baseHp + 品级 × cyclePerTierValue`，主城格子开局即
        // `developed` 且品级固定为 1，所以这里直接拍下算好的值。
        wallMaxHp: globalNumber(global, 'wallMaxHp'),
        hqMaxHp: Math.round((hqCard.baseHp ?? 0) + (hqCard.cyclePerTierValue ?? 0)),
    };

    return {
        cards, playerDeck, enemyDeck, units, counters, bonds,
        tileConfigs, tileWeights, goldPity, modifierCatalogs,
        legacySkillEffects: nextLegacySkillEffects, rules: nextRules,
    };
}
