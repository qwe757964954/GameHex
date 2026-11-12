import type { ZCUnitDefinition } from './ZCCombatCatalog';
import type { IZCBattleRates } from './ZCMatchConfig';
import { missileLog, ZC_MISSILE_DEBUG_HERO_LEVEL } from '../ZCMissileSkillDiagnostics';
import { skillCastLog, zcSkillCastWatched } from '../ZCSkillCastDiagnostics';
import {
    executeGeneralStarModifiers,
    indexGeneralStarRows,
    mergeSkillAttrModifierRows,
    ZCModifierExecutor,
    type ZCGeneralStarRecord,
    type ZCModifierRecord,
} from './ZCModifierEngine';
import { mapModifierCommand, type ZCMappedEffect } from './ZCModifierMapper';
import {
    applyZCTypedUnitModifiers,
    findZCModifierOverride,
    findZCTextModifierOverride,
    isZCTextAttackValue,
    parseZCModifierAdapterCatalogs,
    STAT_TO_PATCH,
    type ZCModifierAdapterCatalogs,
    type ZCModifierAdapterTables,
    type ZCModifierSourceKind,
    type ZCSkillPlanRecord,
    type ZCStatBreakdown,
    type ZCStatId,
    type ZCStatOperation,
    type ZCTextAttackModifier,
    type ZCTypedModifier,
} from './ZCStatSchema';

/** 客户端只需提供武将和星级；旧表的具体 modifier id 不向普通业务层泄漏。 */
export interface ZCGeneralStarSelection {
    generalId: number;
    star: number;
}

/** client/server 交给战斗编译器的构筑快照；修改器 id 仍会在开战前经过 PVP 白名单。 */
export interface ZCCombatBuildSelection {
    unitId: string;
    /** 服务端卡牌绝对属性；覆盖同项本地成长、星级与技能数值，阵营倍率仍在最后应用。 */
    serverAttributes?: Readonly<Partial<Pick<ZCUnitDefinition, 'attack' | 'maxHp'>>>;
    level?: number;
    /** 英雄养成等级：用于按 unlockHeroLevel 自动选择 J 表中的技能升级档。 */
    heroLevel?: number;
    generalStar?: ZCGeneralStarSelection;
    equipmentModifierIds?: readonly number[];
    gemModifierIds?: readonly number[];
    skillModifierIds?: readonly number[];
}

/** 兼容旧消费方的聚合补丁；新代码应优先读取 typedModifiers / breakdown。 */
export interface ZCUnitStatPatch {
    attackFlat?: number;
    attackPct?: number;
    maxHpFlat?: number;
    maxHpPct?: number;
    moveSpeedFlat?: number;
    moveSpeedPct?: number;
    attackRangeFlat?: number;
    attackRangePct?: number;
    attackIntervalFlat?: number;
    attackSpeedPct?: number;
    attackDurationFlat?: number;
    attackHitTimeFlat?: number;
    /**
     * 最终伤害倍率修正（百分数整数，10 = 伤害 +10%，2026-10-30 玉林好汉「铁质飞镖」）。
     *
     * 与 `attackPct` 的区别：攻击力会抬高面板、也会被其它按攻击力算的公式二次吃到；
     * 这个只在伤害结算处相乘一次，面板不变（设计案 100402 要求的「伤害倍率而非攻击力」）。
     * 缺省 0 ⇒ 乘 1，既有单位行为逐字不变。
     */
    damageRatePct?: number;
    /**
     * 伤害转生命的比例（2026-11-04，椰蛋战士「生命汲取」100503）。0.02 = 造成伤害的 2% 回血。
     *
     * **比例不是百分数**：与上面那批 `xxxPct`（20 = +20%）口径不同，表里 `operation = add`、
     * `value = 0.02` 就是这个字段。为什么不做成 `addRate`：`addRate` 走 `foldStatPatch` 的
     * `rate * baseValue` 分支，而它没有基础值 ⇒ 恒 0（同 2026-10-13 那批的约束）。
     *
     * 结算口径：按 `damageUnit` 真正扣掉的血量（`applied`）反算，不是面板伤害 ——
     * 打护盾 / 溢出 / 被 0 抵消时不该凭空回血。缺省 0 ⇒ 整段不执行，既有单位行为逐字不变。
     */
    lifestealRate?: number;
    //  以下 10 种对应 `pvpAttrMap` 里 2026-10-13 补齐的数值属性。带 Pct 的一律是「百分数整数」（20 = +20%）。
    /** 暴击率修正（20 = +20% 暴击率）；直接进 `criticalMultiplier` 判定。 */
    critRatePct?: number;
    /** 暴击伤害修正（50 = +50% 暴伤）。 */
    critDamagePct?: number;
    /** 弹幕数量修正（正=多几发）；最终发数 = profile 弹数 + 本值，下限 1。 */
    bulletNumFlat?: number;
    /** 多弹道的角度均分跨度（度）。缺省 0 = 不做扇形展开，行为与改造前逐字一致。 */
    bulletAngleFlat?: number;
    /** 一次普攻的**额外**连击段数（2 = 共打三段）；只加伤害，不重复触发处决 / 状态。 */
    multiHitFlat?: number;
    /** 产兵间隔修正（秒，正=更慢）；最终间隔不小于 `rules.spawnMinimumSeconds`。 */
    recruitCdFlat?: number;
    /** 产兵间隔百分比修正（20 = 间隔 +20%，即更慢）。 */
    recruitCdPct?: number;
    /** 单次产兵数量修正（正=多产几个）。 */
    singleRecruitNumFlat?: number;
    /** 单次产兵的军团数修正（与单次数量叠加，山猫 2026-10-13 定）。 */
    singleRecruitLegionCountFlat?: number;
    /** 单个兵营的产兵总量上限；缺省 = 走 `rules.unitCapPerSide`。 */
    recruitMaxNumFlat?: number;
}

/** 旧表属性操作方式：覆盖 或 累加。 */
export const ZCLegacyOperationMode = {
    Add: 'add',
    Replace: 'replace',
} as const;
export type ZCLegacyOperationMode = (typeof ZCLegacyOperationMode)[keyof typeof ZCLegacyOperationMode];

export interface ZCLegacyAttributeOperation {
    mode: ZCLegacyOperationMode;
    values: Readonly<Record<string, unknown>>;
}

export interface ZCCompiledModifierLoadout {
    sourceKey: string;
    sourceKind: ZCModifierSourceKind;
    generalId?: number;
    star?: number;
    targetUnitId: string;
    appliedModifierIds: readonly number[];
    rawAttributes: Readonly<Record<string, unknown>>;
    /** Flattened in modifier-id order; preserves old modifyList replace/add semantics across loadouts. */
    legacyAttributeOperations?: readonly ZCLegacyAttributeOperation[];
    statPatch: Readonly<ZCUnitStatPatch>;
    typedModifiers: readonly ZCTypedModifier[];
    textModifiers?: readonly ZCTextAttackModifier[];
    /** 本次构筑实际选中的技能计划行；战斗层据此挂命中状态/未来事件被动。 */
    skillPlans: readonly ZCSkillPlanRecord[];
    breakdown: readonly ZCStatBreakdown[];
    effects: readonly ZCMappedEffect[];
    unsupportedAttributes: readonly string[];
    configHash: string;
}

export interface ZCModifierCatalogs {
    modifiers: ReadonlyMap<number, ZCModifierRecord>;
    generalStars: ReadonlyMap<string, ZCGeneralStarRecord>;
    adapters: ZCModifierAdapterCatalogs;
}

type PackedRows = { k?: unknown; v?: unknown };

function normalizeRows(value: unknown): Record<string, unknown>[] {
    if (Array.isArray(value)) return value.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object');
    if (!value || typeof value !== 'object') return [];
    const packed = value as PackedRows;
    if (!Array.isArray(packed.k) || !Array.isArray(packed.v)) return [];
    const keys = packed.k.map(String);
    return packed.v.flatMap((values) => Array.isArray(values)
        ? [Object.fromEntries(keys.map((key, index) => [key, values[index]]))]
        : []);
}

const EMPTY_ADAPTERS = parseZCModifierAdapterCatalogs({});
let runtimeCatalogs: ZCModifierCatalogs = {
    modifiers: new Map(),
    generalStars: new Map(),
    adapters: EMPTY_ADAPTERS,
};

export function parseZCModifierCatalogs(
    modifierRows: unknown,
    generalStarRows: unknown,
    adapterTables: ZCModifierAdapterTables = {},
): ZCModifierCatalogs {
    const modifiers = mergeSkillAttrModifierRows(normalizeRows(modifierRows));
    return {
        modifiers,
        generalStars: indexGeneralStarRows(normalizeRows(generalStarRows)),
        adapters: parseZCModifierAdapterCatalogs(adapterTables, modifiers),
    };
}

/** 仅由配置加载事务在全部表校验成功后提交，避免半加载状态。 */
export function setZCModifierCatalogs(catalogs: ZCModifierCatalogs): void {
    runtimeCatalogs = catalogs;
}

export function getZCModifierCatalogs(): ZCModifierCatalogs {
    return runtimeCatalogs;
}

const ATTRIBUTE_TO_PATCH: Readonly<Record<string, keyof ZCUnitStatPatch>> = {
    攻击力: 'attackFlat',
    攻击力百分比: 'attackPct',
    生命值: 'maxHpFlat',
    最大生命值: 'maxHpFlat',
    血量: 'maxHpFlat',
    生命值百分比: 'maxHpPct',
    最大生命值百分比: 'maxHpPct',
    血量百分比: 'maxHpPct',
    移动速度: 'moveSpeedFlat',
    移速: 'moveSpeedFlat',
    移动速度百分比: 'moveSpeedPct',
    移速百分比: 'moveSpeedPct',
    攻击距离: 'attackRangeFlat',
    射程: 'attackRangeFlat',
    攻击距离百分比: 'attackRangePct',
    射程百分比: 'attackRangePct',
    攻击间隔: 'attackIntervalFlat',
    攻击速度百分比: 'attackSpeedPct',
    攻速百分比: 'attackSpeedPct',
    攻击持续时间: 'attackDurationFlat',
    攻击命中时间: 'attackHitTimeFlat',
};

/** 无 PVP 适配表时的兼容入口，供旧测试/旧回放继续读取百分数整数口径。 */
export function compileZCUnitStatPatch(attributes: Readonly<Record<string, unknown>>): {
    statPatch: ZCUnitStatPatch;
    unsupportedAttributes: string[];
} {
    const statPatch: ZCUnitStatPatch = {};
    const unsupportedAttributes: string[] = [];
    for (const [name, rawValue] of Object.entries(attributes)) {
        const key = ATTRIBUTE_TO_PATCH[name];
        if (!key || typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
            unsupportedAttributes.push(name);
            continue;
        }
        statPatch[key] = (statPatch[key] ?? 0) + rawValue;
    }
    return { statPatch, unsupportedAttributes };
}

function typedToLegacyPatch(modifiers: readonly ZCTypedModifier[]): ZCUnitStatPatch {
    const patch: ZCUnitStatPatch = {};
    const add = (key: keyof ZCUnitStatPatch, value: number) => { patch[key] = (patch[key] ?? 0) + value; };
    for (const item of modifiers) {
        if (item.domain !== 'unit' || item.operation === 'multiply' || item.operation === 'override') continue;
        const rate = item.operation === 'addRate';
        switch (item.statId) {
            case 'attack': add(rate ? 'attackPct' : 'attackFlat', rate ? item.value * 100 : item.value); break;
            case 'maxHp': add(rate ? 'maxHpPct' : 'maxHpFlat', rate ? item.value * 100 : item.value); break;
            case 'moveSpeed': add(rate ? 'moveSpeedPct' : 'moveSpeedFlat', rate ? item.value * 100 : item.value); break;
            case 'attackRange': add(rate ? 'attackRangePct' : 'attackRangeFlat', rate ? item.value * 100 : item.value); break;
            case 'attackInterval': if (!rate) add('attackIntervalFlat', item.value); break;
            case 'attackSpeed': if (rate) add('attackSpeedPct', item.value * 100); break;
            case 'attackDuration': if (!rate) add('attackDurationFlat', item.value); break;
            case 'attackHitTime': if (!rate) add('attackHitTimeFlat', item.value); break;
            //  伤害倍率（`damageRate`）只接受 addRate：它是「最终结算乘 1 + N%」，
            //  没有对应的绝对值语义（`add` 会变成「+0.1 点伤害」，没有意义）。
            case 'damageRate': if (rate) add('damageRatePct', item.value * 100); break;
            //  吸血比例（2026-11-04）：**只接受 add**，值就是比例本身（0.02 = 2%）。
            //  与 `damageRate` 相反 —— 那边只接受 addRate 是因为它没有基础值、用的是百分数口径。
            case 'lifestealRate': if (!rate) add('lifestealRate', item.value); break;
            default: {
                //  扩展的 11 个 statId（`critRate` / `critDamage` / `bulletNum` / `bulletAngle` /
                //  `attackCount` / `recruit*`，2026-10-30 补）：它们没有基础值，映射表在
                //  `ZCStatSchema.STAT_TO_PATCH`，`applyZCTypedUnitModifiers` 早就在用它，
                //  但这个 switch 是**第二套**折表逻辑、当时漏了这批 —— 结果是
                //  「pvpSkillPlan 里填了 bulletNum / critRate，运行时读不到」。
                const entry = STAT_TO_PATCH[item.statId];
                if (!entry) break;
                if (rate) {
                    if (entry[1]) add(entry[1], item.value * 100);
                } else {
                    add(entry[0], item.value);
                }
                break;
            }
        }
    }
    return patch;
}

function compileTypedModifiers(
    modifierIds: readonly number[],
    targetUnitId: string,
    sourceKind: ZCModifierSourceKind,
    catalogs: ZCModifierCatalogs,
    textOnly = false,
): { modifiers: ZCTypedModifier[]; textModifiers: ZCTextAttackModifier[]; unsupported: string[] } {
    const result: ZCTypedModifier[] = [];
    const textModifiers: ZCTextAttackModifier[] = [];
    const unsupported = new Set<string>();
    for (const modifierId of modifierIds) {
        const record = catalogs.modifiers.get(modifierId);
        if (!record) throw new Error(`[ZCModifierRuntime] 找不到修改器 ${modifierId}`);
        for (const operation of record.modify) {
            if (operation.type !== '修改属性' && operation.type !== '替换属性') continue;
            if (!operation.data || typeof operation.data !== 'object' || Array.isArray(operation.data)) continue;
            for (const [legacyKey, rawValue] of Object.entries(operation.data as Record<string, unknown>)) {
                const textMapping = catalogs.adapters.textAttrMap.get(legacyKey);
                if (textMapping?.enabled) {
                    const override = findZCTextModifierOverride(
                        catalogs.adapters, modifierId, legacyKey, targetUnitId, sourceKind,
                    );
                    const value = override?.enabled ? override.value : rawValue;
                    // 旧表的数字编码和资源名没有新对局语义；只消费显式的新模式和资源路径。
                    if (!isZCTextAttackValue(textMapping.statId, value)) continue;
                    const bindings = catalogs.adapters.skillBindings.filter((binding) => binding.enabled
                        && binding.targetUnitId === targetUnitId && binding.parameterKey === legacyKey);
                    if (!bindings.length) throw new Error(`[ZCModifierRuntime] 技能属性缺少技能映射：${targetUnitId}:${legacyKey}`);
                    for (const binding of bindings) textModifiers.push({
                        sourceId: modifierId, targetUnitId, skillId: binding.pvpSkillId,
                        statId: textMapping.statId, value, priority: textMapping.priority,
                    });
                    continue;
                }
                if (textOnly) continue;
                const mapping = catalogs.adapters.attrMap.get(legacyKey);
                if (!mapping || !mapping.enabled) {
                    unsupported.add(legacyKey);
                    continue;
                }
                let normalizedRawValue: number;
                if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
                    normalizedRawValue = rawValue;
                } else if (mapping.sourceUnit === 'text' && mapping.handlerKey === 'banner_crit_name' && typeof rawValue === 'string') {
                    const matched = /([135])星$/.exec(rawValue);
                    normalizedRawValue = matched?.[1] === '5' ? 50 : matched?.[1] === '3' ? 40 : matched?.[1] === '1' ? 30 : NaN;
                    if (!Number.isFinite(normalizedRawValue)) {
                        unsupported.add(legacyKey);
                        continue;
                    }
                } else {
                    unsupported.add(legacyKey);
                    continue;
                }
                if (mapping.domain === 'skill' && !catalogs.adapters.skillBindings.some((binding) => (
                    binding.enabled && binding.targetUnitId === targetUnitId && binding.parameterKey === legacyKey
                ))) {
                    throw new Error(`[ZCModifierRuntime] 技能属性缺少技能映射：${targetUnitId}:${legacyKey}`);
                }
                const override = findZCModifierOverride(catalogs.adapters, modifierId, legacyKey, targetUnitId, sourceKind);
                let value = override?.enabled ? override.value : normalizedRawValue * mapping.scale;
                const min = mapping.min;
                const max = mapping.max;
                if (min != null) value = Math.max(min, value);
                if (max != null) value = Math.min(max, value);
                result.push({
                    sourceId: modifierId,
                    sourceKind,
                    targetUnitId,
                    domain: override?.enabled ? override.domain : mapping.domain,
                    statId: override?.enabled ? override.statId : mapping.statId,
                    operation: override?.enabled ? override.operation : (operation.type === '替换属性' ? 'override' : mapping.operation),
                    value,
                    priority: mapping.priority,
                    legacyKey,
                    handlerKey: mapping.handlerKey,
                });
            }
        }
    }
    return { modifiers: result, textModifiers, unsupported: [...unsupported] };
}

function assertUnit(targetUnitId: string, units: readonly ZCUnitDefinition[]): ZCUnitDefinition {
    const unit = units.find((item) => item.unitId === targetUnitId);
    if (!unit) throw new Error(`[ZCModifierRuntime] 单位 ${targetUnitId} 不在本局单位表中`);
    return unit;
}

function compileIdsLoadout(
    targetUnitId: string,
    modifierIds: readonly number[],
    sourceKind: ZCModifierSourceKind,
    sourceKey: string,
    units: readonly ZCUnitDefinition[],
    catalogs: ZCModifierCatalogs,
    metadata: Pick<ZCCompiledModifierLoadout, 'generalId' | 'star'> = {},
): ZCCompiledModifierLoadout {
    const unit = assertUnit(targetUnitId, units);
    const executed = new ZCModifierExecutor().execute(modifierIds, catalogs.modifiers);
    const legacyAttributeOperations: ZCLegacyAttributeOperation[] = modifierIds.flatMap((modifierId) =>
        (catalogs.modifiers.get(modifierId)?.modify ?? []).flatMap((operation) => {
            if (operation.type !== '修改属性' && operation.type !== '替换属性') return [];
            if (!operation.data || typeof operation.data !== 'object' || Array.isArray(operation.data)) return [];
            return [{
                mode: operation.type === '替换属性' ? 'replace' as const : 'add' as const,
                values: { ...operation.data as Record<string, unknown> },
            }];
        }));
    const byName = new Map(units.map((item) => [item.name, item.unitId]));
    const effects = executed.commands.flatMap((command) => mapModifierCommand(command, {
        unitIdByName: (name) => byName.get(name),
    }));

    if (!catalogs.adapters.attrMap.size && !catalogs.adapters.textAttrMap.size) {
        const legacy = compileZCUnitStatPatch(executed.attributes);
        return {
            sourceKey,
            sourceKind,
            ...metadata,
            targetUnitId,
            appliedModifierIds: [...executed.appliedModifierIds],
            rawAttributes: { ...executed.attributes },
            legacyAttributeOperations,
            statPatch: legacy.statPatch,
            typedModifiers: [],
            skillPlans: [],
            breakdown: [],
            effects,
            unsupportedAttributes: legacy.unsupportedAttributes,
            configHash: catalogs.adapters.configHash,
        };
    }

    const typed = compileTypedModifiers(modifierIds, targetUnitId, sourceKind, catalogs);
    if (typed.unsupported.length) {
        throw new Error(`[ZCModifierRuntime] ${sourceKey} 存在未映射属性：${typed.unsupported.join(', ')}`);
    }
    return {
        sourceKey,
        sourceKind,
        ...metadata,
        targetUnitId,
        appliedModifierIds: [...executed.appliedModifierIds],
        rawAttributes: { ...executed.attributes },
        legacyAttributeOperations,
        statPatch: typedToLegacyPatch(typed.modifiers),
        typedModifiers: typed.modifiers,
        textModifiers: typed.textModifiers,
        skillPlans: [],
        breakdown: applyZCTypedUnitModifiers(unit, typed.modifiers).breakdown,
        effects,
        unsupportedAttributes: typed.unsupported,
        configHash: catalogs.adapters.configHash,
    };
}

/** 把客户端的武将/星级选择编译成本局冻结配置。 */
export function compileZCGeneralStarLoadout(
    selection: ZCGeneralStarSelection,
    units: readonly ZCUnitDefinition[],
    catalogs: ZCModifierCatalogs = runtimeCatalogs,
): ZCCompiledModifierLoadout {
    const key = `${selection.generalId}:${selection.star}`;
    const row = catalogs.generalStars.get(key);
    if (!row) throw new Error(`[ZCModifierRuntime] generalStar 不存在：${key}`);
    const targetUnitId = String(selection.generalId);
    assertUnit(targetUnitId, units);
    // 保持 executeGeneralStarModifiers 的显式校验语义，同时按原顺序取 modifier id。
    executeGeneralStarModifiers(selection.generalId, selection.star, catalogs.generalStars, catalogs.modifiers);
    return compileIdsLoadout(
        targetUnitId,
        [...row.modify, ...row.impactData],
        'generalStar',
        `generalStar:${key}`,
        units,
        catalogs,
        { generalId: selection.generalId, star: selection.star },
    );
}

function compileGrowthLoadout(
    unitId: string,
    level: number,
    units: readonly ZCUnitDefinition[],
    catalogs: ZCModifierCatalogs,
): ZCCompiledModifierLoadout {
    const unit = assertUnit(unitId, units);
    const row = catalogs.adapters.growth.get(`${unitId}:${level}`);
    if (!row || !row.enabled) throw new Error(`[ZCModifierRuntime] PVP 成长不存在或未启用：${unitId}:${level}`);
    const values: Array<[ZCStatId, ZCStatOperation, number]> = [
        ['attack', 'add', row.attackFlat],
        ['attack', 'addRate', row.attackRate],
        ['maxHp', 'add', row.maxHpFlat],
        ['maxHp', 'addRate', row.maxHpRate],
        ['moveSpeed', 'addRate', row.moveSpeedRate],
        ['attackRange', 'add', row.attackRangeFlat],
    ];
    const typedModifiers: ZCTypedModifier[] = values
        .filter(([, , value]) => value !== 0)
        .map(([statId, operation, value]) => ({
            sourceId: `${unitId}:${level}`,
            sourceKind: 'growth',
            targetUnitId: unitId,
            domain: 'unit',
            statId,
            operation,
            value,
            priority: 50,
        }));
    return {
        sourceKey: `growth:${unitId}:${level}`,
        sourceKind: 'growth',
        targetUnitId: unitId,
        appliedModifierIds: [],
        rawAttributes: {},
        statPatch: typedToLegacyPatch(typedModifiers),
        typedModifiers,
        skillPlans: [],
        breakdown: applyZCTypedUnitModifiers(unit, typedModifiers).breakdown,
        effects: [],
        unsupportedAttributes: [],
        configHash: catalogs.adapters.configHash,
    };
}

/** 按英雄等级选择每条技能链的生效档：replace/branch 取最高档，accumulate 累计所有已解锁档。 */
export function selectZCSkillPlans(
    unitId: string,
    heroLevel: number,
    catalogs: ZCModifierCatalogs = runtimeCatalogs,
): readonly ZCSkillPlanRecord[] {
    if (!Number.isSafeInteger(heroLevel) || heroLevel < 1) return [];
    const groups = new Map<number, ZCSkillPlanRecord[]>();
    for (const row of catalogs.adapters.skillPlans) {
        if (!row.enabled || row.unitId !== unitId || row.unlockHeroLevel > heroLevel) continue;
        const group = groups.get(row.skillChainId) ?? [];
        group.push(row);
        groups.set(row.skillChainId, group);
    }
    const selected: ZCSkillPlanRecord[] = [];
    for (const group of groups.values()) {
        group.sort((left, right) => left.skillLevel - right.skillLevel);
        const current = group[group.length - 1];
        if (current.progressionMode === 'accumulate') selected.push(...group);
        else selected.push(current);
    }
    return selected.sort((left, right) => left.skillChainId - right.skillChainId || left.skillLevel - right.skillLevel);
}

function compileSkillPlanLoadout(
    unitId: string,
    heroLevel: number,
    units: readonly ZCUnitDefinition[],
    catalogs: ZCModifierCatalogs,
): ZCCompiledModifierLoadout | null {
    const unit = assertUnit(unitId, units);
    //  诊断/验证①：101003「追踪导弹」三档门槛是 9 / 18 / 24 级（`unlockHeroLevel`）。
    //  等级不够时 `selectZCSkillPlans` 直接过滤掉整条链 ⇒ 运行时没有 `strikeRadius` 参数
    //  ⇒ 战场上一枚导弹都不会有，而配表看起来「明明配了」。
    //  `ZC_MISSILE_DEBUG_HERO_LEVEL` 只抬 68010 的**技能计划筛选**等级（成长仍按真实等级），
    //  用于低等级账号验证导弹美术/弹道，默认应改回 0。
    const planLevel = unitId === '68010' && ZC_MISSILE_DEBUG_HERO_LEVEL > 0
        ? Math.max(heroLevel, ZC_MISSILE_DEBUG_HERO_LEVEL)
        : heroLevel;
    const skillPlans = selectZCSkillPlans(unitId, planLevel, catalogs);
    if (unitId === '68010') {
        missileLog('配表', `镭射飞龙 heroLevel=${heroLevel}`
            + (planLevel !== heroLevel ? `（技能按 ${planLevel} 级筛，测试开关）` : '')
            + ` | 命中技能链 ${skillPlans.map(row => `${row.skillChainId}@Lv${row.skillLevel}`).join(' ') || '（空）'}`
            + ` | 含 101003 追踪导弹？${skillPlans.some(row => row.skillChainId === 101003)}`);
    }
    //  诊断①：构筑期快照。这条一打出来就能判断「是等级没到」还是「参数没进运行时」。
    //  `因等级未解锁` 那段只列**表里确实配了、但这一级还没到**的链 —— 空的就说明不是等级问题。
    if (zcSkillCastWatched(unitId)) {
        const locked = catalogs.adapters.skillPlans
            .filter(row => row.enabled && row.unitId === unitId && row.unlockHeroLevel > planLevel)
            .map(row => `${row.skillChainId}@${row.unlockHeroLevel}级`);
        skillCastLog('构筑', `${unitId} heroLevel=${planLevel}`
            + ` | 选中 ${skillPlans.map(row => `${row.skillChainId}/Lv${row.skillLevel}`).join(' ') || '（空）'}`
            + ` | 因等级未解锁 ${locked.join(' ') || '无'}`);
    }
    if (!skillPlans.length) return null;
    const modifierIds = skillPlans.map((row) => row.modifierId);
    // Keep the old-client attribute dictionary as well as the typed PVP patch.
    // skillEffect formulas still address Chinese legacy keys via attr.GetValue().
    // Projected J-table rows may use synthetic IDs and carry their typed stat
    // directly. If an ID also exists in legacy skillAttrModifier, replay it so
    // formula-only attributes remain visible; otherwise the typed row is enough.
    const legacyModifierIds = modifierIds.filter((id) => catalogs.modifiers.has(id));
    const executed = new ZCModifierExecutor().execute(legacyModifierIds, catalogs.modifiers);
    const legacyAttributeOperations: ZCLegacyAttributeOperation[] = legacyModifierIds.flatMap((modifierId) =>
        (catalogs.modifiers.get(modifierId)?.modify ?? []).flatMap((operation) => {
            if (operation.type !== '修改属性' && operation.type !== '替换属性') return [];
            if (!operation.data || typeof operation.data !== 'object' || Array.isArray(operation.data)) return [];
            return [{
                mode: operation.type === '替换属性' ? 'replace' as const : 'add' as const,
                values: { ...operation.data as Record<string, unknown> },
            }];
        }));
    const byName = new Map(units.map((item) => [item.name, item.unitId]));
    const effects = executed.commands.flatMap((command) => mapModifierCommand(command, {
        unitIdByName: (name) => byName.get(name),
    }));
    const typedModifiers: ZCTypedModifier[] = skillPlans.flatMap((row) => (
        row.statId && row.operation && row.value != null
            ? [{
                sourceId: row.modifierId,
                sourceKind: 'skill' as const,
                targetUnitId: unitId,
                domain: 'unit' as const,
                statId: row.statId,
                operation: row.operation,
                value: row.value,
                priority: 100,
            }]
            : []
    ));
    const textModifiers = legacyModifierIds.length
        ? compileTypedModifiers(legacyModifierIds, unitId, 'skill', catalogs, true).textModifiers
        : [];
    return {
        sourceKey: `skillPlan:${unitId}:${heroLevel}`,
        sourceKind: 'skill',
        targetUnitId: unitId,
        appliedModifierIds: modifierIds,
        rawAttributes: { ...executed.attributes },
        legacyAttributeOperations,
        statPatch: typedToLegacyPatch(typedModifiers),
        typedModifiers,
        textModifiers,
        skillPlans,
        breakdown: applyZCTypedUnitModifiers(unit, typedModifiers).breakdown,
        effects,
        unsupportedAttributes: [],
        configHash: catalogs.adapters.configHash,
    };
}

/** 将 client/server 的等级、升星、装备、宝石构筑编译成只读的本局修正。 */
export function compileZCCombatBuild(
    selection: ZCCombatBuildSelection,
    units: readonly ZCUnitDefinition[],
    catalogs: ZCModifierCatalogs = runtimeCatalogs,
): readonly ZCCompiledModifierLoadout[] {
    assertUnit(selection.unitId, units);
    const result: ZCCompiledModifierLoadout[] = [];
    if (selection.level != null) result.push(compileGrowthLoadout(selection.unitId, selection.level, units, catalogs));
    if (selection.heroLevel != null) {
        const skillPlan = compileSkillPlanLoadout(selection.unitId, selection.heroLevel, units, catalogs);
        if (skillPlan) result.push(skillPlan);
    }
    if (selection.generalStar) {
        if (String(selection.generalStar.generalId) !== selection.unitId) {
            throw new Error(`[ZCModifierRuntime] generalId ${selection.generalStar.generalId} 与 unitId ${selection.unitId} 不一致`);
        }
        result.push(compileZCGeneralStarLoadout(selection.generalStar, units, catalogs));
    }
    const append = (ids: readonly number[] | undefined, kind: ZCModifierSourceKind) => {
        if (!ids?.length) return;
        result.push(compileIdsLoadout(selection.unitId, ids, kind, `${kind}:${selection.unitId}`, units, catalogs));
    };
    append(selection.equipmentModifierIds, 'equipment');
    append(selection.gemModifierIds, 'gem');
    append(selection.skillModifierIds, 'skill');
    if (selection.serverAttributes) {
        const typedModifiers: ZCTypedModifier[] = [];
        for (const statId of ['attack', 'maxHp'] as const) {
            const value = selection.serverAttributes[statId];
            if (value === undefined) continue;
            if (!Number.isFinite(value) || value < 0 || (statId === 'maxHp' && value === 0)) {
                throw new Error(`[ZCModifierRuntime] 服务端英雄属性无效：${selection.unitId}:${statId}=${value}`);
            }
            typedModifiers.push({
                sourceId: selection.unitId, sourceKind: 'server', targetUnitId: selection.unitId,
                domain: 'unit', statId, operation: 'override', value, priority: 1000,
            });
        }
        if (typedModifiers.length) result.push({
            sourceKey: `serverAttrs:${selection.unitId}`, sourceKind: 'server', targetUnitId: selection.unitId,
            appliedModifierIds: [], rawAttributes: {}, statPatch: {}, typedModifiers,
            skillPlans: [], breakdown: applyZCTypedUnitModifiers(assertUnit(selection.unitId, units), typedModifiers).breakdown,
            effects: [], unsupportedAttributes: [], configHash: catalogs.adapters.configHash,
        });
    }
    return result;
}

function resolveLegacyPatch(base: ZCUnitDefinition, loadouts: readonly ZCCompiledModifierLoadout[]): ZCUnitDefinition {
    const patches = loadouts.map((loadout) => loadout.statPatch);
    const sum = (key: keyof ZCUnitStatPatch): number => patches.reduce((total, patch) => total + (patch[key] ?? 0), 0);
    const scaled = (value: number, flatKey: keyof ZCUnitStatPatch, pctKey: keyof ZCUnitStatPatch): number => (
        (value + sum(flatKey)) * Math.max(0, 1 + sum(pctKey) / 100)
    );
    const attackDuration = Math.max(0.01, base.attackDuration + sum('attackDurationFlat'));
    return {
        ...base,
        attack: Math.max(0, scaled(base.attack, 'attackFlat', 'attackPct')),
        maxHp: Math.max(1, scaled(base.maxHp, 'maxHpFlat', 'maxHpPct')),
        moveSpeed: Math.max(0, scaled(base.moveSpeed, 'moveSpeedFlat', 'moveSpeedPct')),
        attackRange: Math.max(0, scaled(base.attackRange, 'attackRangeFlat', 'attackRangePct')),
        attackInterval: Math.max(0.01, (base.attackInterval + sum('attackIntervalFlat')) * Math.max(0.01, 1 - sum('attackSpeedPct') / 100)),
        attackDuration,
        attackHitTime: Math.min(attackDuration, Math.max(0, base.attackHitTime + sum('attackHitTimeFlat'))),
    };
}

/** 将同一单位命中的静态修正合并为有效定义；绝不修改全局单位目录。 */
function resolveZCModifiedUnitDefinition(
    base: ZCUnitDefinition,
    loadouts: readonly ZCCompiledModifierLoadout[],
): ZCUnitDefinition {
    const matched = loadouts.filter((loadout) => loadout.targetUnitId === base.unitId);
    if (!matched.length) return base;
    const legacy = matched.filter((loadout) => !loadout.typedModifiers.length);
    const typed = matched.flatMap((loadout) => loadout.typedModifiers);
    const afterLegacy = legacy.length ? resolveLegacyPatch(base, legacy) : base;
    const definition = typed.length ? applyZCTypedUnitModifiers(afterLegacy, typed).definition : afterLegacy;
    const textModifiers = matched.flatMap((loadout) => loadout.textModifiers ?? [])
        .sort((left, right) => left.priority - right.priority);
    if (!textModifiers.length) return definition;
    let attackProfile = definition.attackProfile;
    let empoweredProfile = definition.empoweredProfile;
    for (const modifier of textModifiers) {
        const isNormal = attackProfile.skillId === modifier.skillId;
        const profile = isNormal ? attackProfile
            : empoweredProfile?.skillId === modifier.skillId ? empoweredProfile : null;
        if (!profile) {
            throw new Error(`[ZCModifierRuntime] 文本覆盖找不到技能档案：${base.unitId}:${modifier.skillId}`);
        }
        const updated = modifier.statId === 'model'
            ? { ...profile, effectPrefabPath: modifier.value }
            : { ...profile, mode: modifier.value as typeof profile.mode };
        if (isNormal) attackProfile = updated;
        else empoweredProfile = updated;
    }
    return { ...definition, attackProfile, empoweredProfile };
}

/** 服务端倍率在成长、星级和技能属性编译后生效，不进入普通百分比加成。 */
export function resolveZCUnitDefinition(
    base: ZCUnitDefinition,
    loadouts: readonly ZCCompiledModifierLoadout[],
    rates?: IZCBattleRates,
): ZCUnitDefinition {
    const definition = resolveZCModifiedUnitDefinition(base, loadouts);
    if (!rates) return definition;
    return {
        ...definition,
        attack: rates.attackRate === undefined ? definition.attack : definition.attack * rates.attackRate,
        maxHp: rates.hpRate === undefined ? definition.maxHp : definition.maxHp * rates.hpRate,
    };
}

/**
 * 与 `resolveZCUnitDefinition` 同输入，额外返回 2026-10-13 新增的 9 种 statId 所累加出的 patch。
 *
 * 拆成并列是因为这 9 种**不在 `ZCUnitDefinition` 上**（没有基础值），只能以 patch 形式传给战斗结算。
 * 已有 8 种（attack/maxHp/…）不在这里——它们已经改过 `definition`。
 */
export function resolveZCUnitStatPatch(
    base: ZCUnitDefinition,
    loadouts: readonly ZCCompiledModifierLoadout[],
): ZCUnitStatPatch {
    const typed = loadouts
        .filter((loadout) => loadout.targetUnitId === base.unitId)
        .flatMap((loadout) => loadout.typedModifiers);
    if (!typed.length) return {};
    return applyZCTypedUnitModifiers(base, typed).statPatch;
}

/**
 * 全队共享暴击伤害（2026-11-10）。
 *
 * `critDamage`（折成 `critDamagePct`）与暴击率**不是同一类属性**：
 * 暴击率是逐单位各自累加的；暴击伤害是 **owner 级唯一值** ——
 * 阵容里每张卡 `pvpSkillPlan` 的「全队暴击伤害增幅」（`skillChainId 109001`）都加进同一个池子，
 * 池子汇总之后再写回该 owner 的**每一个单位**。于是任何一张卡打出暴击，
 * 用的都是这同一个「全队暴击伤害」比例，而不是只有它自己那几行。
 *
 * 入参是 `compileZCMatchRuntime` 建好的 owner 卡池 patch 表（键 = unitId）。
 * 汇总为 0 时原样返回，没配这条属性的卡组结算路径逐字不变。
 */
export function shareLineupCritDamage(
    patches: ReadonlyMap<string, ZCUnitStatPatch>,
): ReadonlyMap<string, ZCUnitStatPatch> {
    let total = 0;
    for (const patch of patches.values()) total += patch.critDamagePct ?? 0;
    if (total <= 0) return patches;
    const shared = new Map<string, ZCUnitStatPatch>();
    for (const [unitId, patch] of patches) {
        shared.set(unitId, patch.critDamagePct === total ? patch : { ...patch, critDamagePct: total });
    }
    return shared;
}

/** UI/调试使用：返回最终属性的基础值、各层修正和来源。 */
export function getZCUnitStatBreakdown(
    base: ZCUnitDefinition,
    loadouts: readonly ZCCompiledModifierLoadout[],
): readonly ZCStatBreakdown[] {
    const typed = loadouts
        .filter((loadout) => loadout.targetUnitId === base.unitId)
        .flatMap((loadout) => loadout.typedModifiers);
    return applyZCTypedUnitModifiers(base, typed).breakdown;
}
