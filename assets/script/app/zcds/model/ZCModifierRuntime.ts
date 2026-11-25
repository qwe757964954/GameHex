import { ZC_RUNTIME_CONFIG } from './ZCRuntimeConfigStore';
import type { ZCUnitDefinition } from './ZCCombatCatalog';
import type { IZCBattleRates } from './ZCMatchConfig';
import { missileLog, ZC_MISSILE_DEBUG_HERO_LEVEL, zcIsMissileWatchUnit } from '../ZCMissileSkillDiagnostics';
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
    readZCSkillMixStats,
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

/** 客户端只需提供武将和星级；旧表的具体 modifier id 不向普通业务层泄漏。*/
export interface ZCGeneralStarSelection {
    generalId: number;
    star: number;
}

/**
 * 服务端下发的增量属性。
 *
 * 字段与 `app/battle/BattleStartModel` 的 `ZCBattleHeroModifier` 一致，这里重复声明是为了
 * 不让 `zcds/model` 反向 import `app/battle`（structural 类型，调用方直接传即可）。
*/
export interface IZCServerStatModifier {
    readonly statId: 'attack' | 'maxHp';
    /** `add` 进 flat，`addRate` 进 rate（`-0.2` = -20%）。*/
    readonly operation: 'add' | 'addRate';
    readonly value: number;
}

/** client/server 交给战斗编译器的构筑快照；修改器 id 仍会在开战前经过 PVP 白名单。*/
export interface ZCCombatBuildSelection {
    unitId: string;
    /** 服务端卡牌绝对属性（override，priority 1000）；覆盖同项本地成长、星级与技能数值，阵营倍率仍在最后应用。*/
    serverAttributes?: Readonly<Partial<Pick<ZCUnitDefinition, 'attack' | 'maxHp'>>>;
    /**
     * 服务端增量属性（`attack.add` / `attack.addRate`）。
     *
     * 与 {@link serverAttributes} 分工：那边是"最终绝对值"（override，priority 1000），
     * 这里是"相对增/减"，priority 900。合成口径见 `applyZCTypedUnitModifiers`：
     *   ① 没有绝对值 ⇒ `(base + add 累加) × (1 + addRate)`；
     *   ② 有绝对值 ⇒ 定值后再乘**服务端** `addRate`（PVP 关卡对敌方的 -20% 就在这一层）；
     *      本地成长 / 技能的 rate 仍被定值压制，不参与，避免二次污染服务端最终值。
     */
    serverModifiers?: readonly IZCServerStatModifier[];
    level?: number;
    /** 英雄养成等级：用于按 unlockHeroLevel 自动选择 J 表中的技能升级档。*/
    heroLevel?: number;
    generalStar?: ZCGeneralStarSelection;
    equipmentModifierIds?: readonly number[];
    gemModifierIds?: readonly number[];
    skillModifierIds?: readonly number[];
}

/** 兼容旧消费方的聚合补丁；新代码应优先读取 typedModifiers / breakdown。*/
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
     * 伤害转生命的比例（0.02 = 造成伤害的 2% 回血），比例不是百分数。
     * 按 `damageUnit` 实际扣血（applied）反算，护盾/溢出/零伤害不回血。缺省 0 ⇒ 不生效。
    */
    lifestealRate?: number;
    /**
     * 每秒回复自身最大生命的百分比（**1.5 = 每秒 1.5%**，与 `critRatePct` 同口径）。
     *
     * 消费点 `ZCSkillTriggerSystem.applyHpRegen`：跨过整秒的那一帧结算一拍，
     * 走与吸血同一条 `healUnit`（封顶 `maxHp`、死亡不生效、真回了才推飘字）。
     * 设计口径「不受治疗加成、不被护盾吸收、溢出丢弃」—— 前两条由 `healUnit` 天然满足
     * （不吃任何治疗倍率），第三条是封顶。缺省 0 ⇒ 整段不执行。
    */
    hpRegenPct?: number;
    /**
     * 普攻弹体的体积倍率（**绝对值，1.6 = ×1.6**），视觉与命中判定同步放大。
     *
     * 🔴 与其它 patch 字段的「相加」语义不同：它是一个**绝对倍率**，
     * 同卡两条链都写会加成 3.2（设计口径里一张卡只有一条，用例里有全表守卫）。
     * 缺省/非法（≤0）一律按 1 处理 ⇒ 存量弹道逐字不变。
    */
    bulletSizeScale?: number;
    /**
     * **单位本体**的体型缩放（百分点整数，`100` = 体型 ×2，`30` = +30%）。
     *
     * 2026-11-18 第 17 批新增，三条技能共用：101904 生命爆发（×2）、
     * 102104 巨型仙人掌（+30%）、102704 战神附体（×2）。
     * 消费者只有 `ZCGameModel.syncBodyScale`（每帧折算成 `unit.bodyScale`），
     * 再由 `ZCUnitView` 乘进本体缩放与血条偏移 —— 不影响 `bodyRadius`（命中判定按原半径，
     * 否则「体型 ×2」会顺手变成「半个屏幕都算挨着」）。
     * 缺省 0 ⇒ 缩放 1，存量单位逐字不变。
    */
    bodySizePct?: number;
    //  以下 10 种对应 `pvpAttrMap` 里 2026-10-13 补齐的数值属性。带 Pct 的一律是「百分数整数」（20 = +20%）。
    /** 暴击率修正（20 = +20% 暴击率）；直接进 `criticalMultiplier` 判定。*/
    critRatePct?: number;
    /** 暴击伤害修正（50 = +50% 暴伤）。*/
    critDamagePct?: number;
    /**
     * 技能级「克制条」（2026-11-17）：判据编进字段名，值一律是**百分数整数**。
     *
     *  · `counter{Camp|Role}1..4 Pct`   —— 攻方：对指定阵营 / 职业的目标额外增伤；
     *  · `countered{Camp|Role}1..4 Pct` —— 守方：受到指定阵营 / 职业来源的伤害降低。
     *
     * 序号 = `ZC_CAMP_TRAITS`（花果/蘑菇/盆栽/僵尸）与 `ZC_ATTACK_TRAITS`（射手/战士/法师/坦克）
     * 的声明顺序，见 `ZCStatSchema.ZC_COUNTER_STAT_IDS`。缺省 0 ⇒ 乘 1，存量单位逐字不变。
    */
    counterCamp1Pct?: number;
    counterCamp2Pct?: number;
    counterCamp3Pct?: number;
    counterCamp4Pct?: number;
    counterRole1Pct?: number;
    counterRole2Pct?: number;
    counterRole3Pct?: number;
    counterRole4Pct?: number;
    counteredCamp1Pct?: number;
    counteredCamp2Pct?: number;
    counteredCamp3Pct?: number;
    counteredCamp4Pct?: number;
    counteredRole1Pct?: number;
    counteredRole2Pct?: number;
    counteredRole3Pct?: number;
    counteredRole4Pct?: number;
    /** 弹幕数量修正（正=多几发）；最终发数 = profile 弹数 + 本值，下限 1。*/
    bulletNumFlat?: number;
    /** 多弹道的角度均分跨度（度）。缺省 0 = 不做扇形展开，行为与改造前逐字一致。*/
    bulletAngleFlat?: number;
    /** 一次普攻的额外连击段数（2 = 共打三段）；只加伤害，不重复触发处决 / 状态。*/
    multiHitFlat?: number;
    /** 产兵间隔修正（秒，正=更慢）；最终间隔不小于 `rules.spawnMinimumSeconds`。*/
    recruitCdFlat?: number;
    /** 产兵间隔百分比修正（20 = 间隔 +20%，即更慢）。*/
    recruitCdPct?: number;
    /** 单次产兵数量修正（正=多产几个）。*/
    singleRecruitNumFlat?: number;
    /** 单次产兵的军团数修正（与单次数量叠加，山猫 2026-10-13 定）。*/
    singleRecruitLegionCountFlat?: number;
    /** 单个兵营的产兵总量上限；缺省 = 走 `rules.unitCapPerSide`。*/
    recruitMaxNumFlat?: number;
}

/** 旧表属性操作方式：覆盖 或 累加。*/
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
    /** Flattened in modifier-id order; preserves old modifyList replace/add semantics across loadouts.*/
    legacyAttributeOperations?: readonly ZCLegacyAttributeOperation[];
    statPatch: Readonly<ZCUnitStatPatch>;
    typedModifiers: readonly ZCTypedModifier[];
    textModifiers?: readonly ZCTextAttackModifier[];
    /** 本次构筑实际选中的技能计划行；战斗层据此挂命中状态/未来事件被动。*/
    skillPlans: readonly ZCSkillPlanRecord[];
    /**
     * 「强化那一击」的解锁门控（2026-11-19）。
     *
     * 为 `true` ⇒ 本局这个单位的 `pvpSkill.empoweredSkillId`（武将技那一击）**不许放**，
     * 每次普攻都按普通普攻结算。判定口径见 `isZCEmpoweredLocked()`。
     *
     * 为什么需要它：施放与否只看基表 `pvpSkill`（`empoweredEvery` + `empoweredSkillId`），
     * 与等级完全无关 —— 而「这个技能属于哪条链、几级解锁」写在 `pvpSkillPlan` 上。
     * 结果就是**没解锁的技能照样放**（椰蛋战士 1 级就放暴风），缺的只是参数：轻则形状退化
     * （暴风静立在目标点），重则空转。用户口径（2026-11-19）：**没到解锁等级就别放**。
    */
    empoweredLocked?: boolean;
    /**
     * 上面那个门控要写进的参数袋 key（`${unitId}:${pvpSkillId}`，即该单位普攻行的运行时）。
     * 未解锁时 `skillPlans` 里未必有行能取到 `pvpSkillId`，所以构筑期就把它一起带出来。
    */
    empoweredBagKey?: string;
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
const EMPTY_CATALOGS: ZCModifierCatalogs = {
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

export function getZCModifierCatalogs(): ZCModifierCatalogs {
    return ZC_RUNTIME_CONFIG.snapshot.modifierCatalogs ?? EMPTY_CATALOGS;
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

/** 无 PVP 适配表时的兼容入口，供旧测试/旧回放继续读取百分数整数口径。*/
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
            //  吸血比例（2026-11-04）：只接受 add，值就是比例本身（0.02 = 2%）。
            //  与 `damageRate` 相反 —— 那边只接受 addRate 是因为它没有基础值、用的是百分数口径。
            case 'lifestealRate': if (!rate) add('lifestealRate', item.value); break;
            default: {
                //  扩展的 11 个 statId（`critRate` / `critDamage` / `bulletNum` / `bulletAngle` /
                //  `attackCount` / `recruit*`，2026-10-30 补）：它们没有基础值，映射表在
                //  `ZCStatSchema.STAT_TO_PATCH`，`applyZCTypedUnitModifiers` 早就在用它，
                //  但这个 switch 是第二套折表逻辑、当时漏了这批 —— 结果是
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
    mode: 'strict' | 'text' | 'campGem' = 'strict',
): { modifiers: ZCTypedModifier[]; textModifiers: ZCTextAttackModifier[]; unsupported: string[] } {
    const result: ZCTypedModifier[] = [];
    const textModifiers: ZCTextAttackModifier[] = [];
    const unsupported = new Set<string>();
    const campGem = mode === 'campGem';
    for (const modifierId of modifierIds) {
        const record = catalogs.modifiers.get(modifierId);
        if (!record) throw new Error(`[ZCModifierRuntime] 找不到修改器 ${modifierId}`);
        const reportUnsupported = (key: string) => {
            unsupported.add(campGem ? `${modifierId}:${key}` : key);
        };
        for (const operation of record.modify) {
            if (operation.type !== '修改属性' && operation.type !== '替换属性') {
                if (campGem) reportUnsupported(operation.type);
                continue;
            }
            if (!operation.data || typeof operation.data !== 'object' || Array.isArray(operation.data)) continue;
            for (const [legacyKey, rawValue] of Object.entries(operation.data as Record<string, unknown>)) {
                const textMapping = catalogs.adapters.textAttrMap.get(legacyKey);
                if (!campGem && textMapping?.enabled) {
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
                if (mode === 'text') continue;
                const mapping = catalogs.adapters.attrMap.get(legacyKey);
                if (!mapping?.enabled || (campGem && mapping.domain !== 'unit')) {
                    reportUnsupported(legacyKey);
                    continue;
                }
                let normalizedRawValue: number;
                if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
                    normalizedRawValue = rawValue;
                } else if (mapping.sourceUnit === 'text' && mapping.handlerKey === 'banner_crit_name' && typeof rawValue === 'string') {
                    const matched = /([135])星$/.exec(rawValue);
                    normalizedRawValue = matched?.[1] === '5' ? 50 : matched?.[1] === '3' ? 40 : matched?.[1] === '1' ? 30 : NaN;
                    if (!Number.isFinite(normalizedRawValue)) {
                        reportUnsupported(legacyKey);
                        continue;
                    }
                } else {
                    reportUnsupported(legacyKey);
                    continue;
                }
                if (mapping.domain === 'skill' && !catalogs.adapters.skillBindings.some((binding) => (
                    binding.enabled && binding.targetUnitId === targetUnitId && binding.parameterKey === legacyKey
                ))) {
                    throw new Error(`[ZCModifierRuntime] 技能属性缺少技能映射：${targetUnitId}:${legacyKey}`);
                }
                const override = findZCModifierOverride(catalogs.adapters, modifierId, legacyKey, targetUnitId, sourceKind);
                if (campGem && override?.enabled && override.domain !== 'unit') {
                    reportUnsupported(legacyKey);
                    continue;
                }
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

/** 阵营宝石仅消费已启用的单位属性。其余词条留待明确目标和运行时语义。 */
export function compileZCCampGemLoadouts(
    modifierIds: readonly number[],
    targetUnitIds: ReadonlySet<string>,
    units: readonly ZCUnitDefinition[],
    catalogs: ZCModifierCatalogs,
): readonly ZCCompiledModifierLoadout[] {
    const missing = new Set<number>();
    const knownIds = modifierIds.filter((id) => {
        if (catalogs.modifiers.has(id)) return true;
        missing.add(id);
        return false;
    });
    const unsupported = new Set<string>();
    const loadouts: ZCCompiledModifierLoadout[] = [];
    for (const unit of units) {
        if (!targetUnitIds.has(unit.unitId)) continue;
        const typed = compileTypedModifiers(knownIds, unit.unitId, 'gem', catalogs, 'campGem');
        for (const key of typed.unsupported) unsupported.add(key);
        if (!typed.modifiers.length) continue;
        const appliedIds = new Set(typed.modifiers.map((item) => item.sourceId));
        loadouts.push({
            sourceKey: `gem:${unit.unitId}`,
            sourceKind: 'gem',
            targetUnitId: unit.unitId,
            appliedModifierIds: knownIds.filter((id) => appliedIds.has(id)),
            rawAttributes: {},
            statPatch: typedToLegacyPatch(typed.modifiers),
            typedModifiers: typed.modifiers,
            skillPlans: [],
            breakdown: applyZCTypedUnitModifiers(unit, typed.modifiers).breakdown,
            effects: [],
            unsupportedAttributes: typed.unsupported,
            configHash: catalogs.adapters.configHash,
        });
    }
    if (missing.size || unsupported.size) {
        console.warn('[ZCModifierRuntime] 阵营宝石存在缺失 ID 或未适配词条', [...missing], [...unsupported]);
    }
    return loadouts;
}

/** 把客户端的武将/星级选择编译成本局冻结配置。*/
export function compileZCGeneralStarLoadout(
    selection: ZCGeneralStarSelection,
    units: readonly ZCUnitDefinition[],
    catalogs: ZCModifierCatalogs = getZCModifierCatalogs(),
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

/** 按英雄等级选择每条技能链的生效档：replace/branch 取最高档，accumulate 累计所有已解锁档。*/
export function selectZCSkillPlans(
    unitId: string,
    heroLevel: number,
    catalogs: ZCModifierCatalogs = getZCModifierCatalogs(),
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

/**
 * 「主链」的 id 区间（2026-11-19）。
 *
 * 设计案里每张卡 4 条主链，id 落在 `100000~109999`（`100501` 蔓生连打 / `102604` 凤凰降临 …）；
 * 辅助链是 `19xxxx` / `28xxxx` / `37xxxx`（老版残留，按兵种等级一路解锁到 22~23 级）。
 * 门控只能看主链：拿辅助链一起判，会让 12 级就该解锁的武将技被 22 级那条拴住。
*/
const ZC_MAIN_CHAIN_MIN = 100000;
const ZC_MAIN_CHAIN_MAX = 110000;

/**
 * 「强化那一击」该不该锁（2026-11-19 用户口径：**没到解锁等级就别放技能**）。
 *
 * 规则：**主链里只要还有一条没解锁，这个单位的武将技（`pvpSkill.empoweredSkillId`）就不许放。**
 *
 * 数据依据（全表实测）：每张卡 `pvpSkillPlan` 的最后一条主链都是 `100x04`，解锁等级 12 / 24 / 36，
 * 而它的 `skillParamJson` 恰好就是那个武将技的行为参数（暴风 `zone*` / 豌豆机关枪 `burst*` /
 * 迪斯科旋风 `zoneSelfCentered` / 飓风 `storm*` / 大吼大叫 `roar*` …）。
 * 也就是说「武将技解锁了没有」在表结构层面等价于「主链全解锁了没有」，
 * 不需要「技能 id ↔ 链 id」的映射列（`pvpSkill` 与 `pvpSkillPlan` 之间本来就没有这一列，
 * 按名字或参数前缀硬推等于把表知识搬进代码，换一张卡就静默失效）。
*/
function isZCEmpoweredLocked(
    unitId: string,
    skillPlans: readonly ZCSkillPlanRecord[],
    catalogs: ZCModifierCatalogs,
): boolean {
    const unlocked = new Set(skillPlans.map((row) => row.skillChainId));
    for (const row of catalogs.adapters.skillPlans) {
        if (!row.enabled || row.unitId !== unitId) continue;
        if (row.skillChainId < ZC_MAIN_CHAIN_MIN || row.skillChainId >= ZC_MAIN_CHAIN_MAX) continue;
        if (!unlocked.has(row.skillChainId)) return true;
    }
    return false;
}

/**
 * 强化门控要写进的参数袋 key（`${unitId}:${pvpSkillId}`，即该单位普攻行的运行时）。
 *
 * 同一单位的全部链共用一个普攻袋（`68005:30707` 住五条链），所以取哪一行都一样；
 * 优先取已选中的行，它为空时（等级低到只剩成长）退到表里第一条 —— 但等级再低也总有
 * `109001`「全队暴击」那一批，所以正常情况下走不到兜底。
*/
function zcEmpoweredBagKey(
    unitId: string,
    skillPlans: readonly ZCSkillPlanRecord[],
    catalogs: ZCModifierCatalogs,
): string | undefined {
    const selected = skillPlans[0]?.pvpSkillId;
    if (selected) return `${unitId}:${selected}`;
    const row = catalogs.adapters.skillPlans.find((item) => item.enabled && item.unitId === unitId);
    return row ? `${unitId}:${row.pvpSkillId}` : undefined;
}

function compileSkillPlanLoadout(
    unitId: string,
    heroLevel: number,
    units: readonly ZCUnitDefinition[],
    catalogs: ZCModifierCatalogs,
): ZCCompiledModifierLoadout | null {
    const unit = assertUnit(unitId, units);
    //  诊断/验证1.：101003「追踪导弹」三档门槛是 9 / 18 / 24 级（`unlockHeroLevel`）。
    //  等级不够时 `selectZCSkillPlans` 直接过滤掉整条链 ⇒ 运行时没有 `strikeRadius` 参数
    //  ⇒ 战场上一枚导弹都不会有，而配表看起来「明明配了」。
    //  `ZC_MISSILE_DEBUG_HERO_LEVEL` 只抬 68010 的技能计划筛选等级（成长仍按真实等级），
    //  用于低等级账号验证导弹美术/弹道，默认应改回 0。
    const isMissileUnit = zcIsMissileWatchUnit(unitId);
    const planLevel = isMissileUnit && ZC_MISSILE_DEBUG_HERO_LEVEL > 0
        ? Math.max(heroLevel, ZC_MISSILE_DEBUG_HERO_LEVEL)
        : heroLevel;
    const skillPlans = selectZCSkillPlans(unitId, planLevel, catalogs);
    if (isMissileUnit) {
        missileLog('配表', `导弹监视单位 ${unitId} heroLevel=${heroLevel}`
            + (planLevel !== heroLevel ? `（技能按 ${planLevel} 级筛，测试开关）` : '')
            + ` | 命中技能链 ${skillPlans.map(row => `${row.skillChainId}@Lv${row.skillLevel}`).join(' ') || '（空）'}`
            + ` | 含 101003 追踪导弹？${skillPlans.some(row => row.skillChainId === 101003)}`);
    }
    //  诊断1.：构筑期快照。这条一打出来就能判断「是等级没到」还是「参数没进运行时」。
    //  `因等级未解锁` 那段只列表里确实配了、但这一级还没到的链 —— 空的就说明不是等级问题。
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
    const typedModifiers: ZCTypedModifier[] = skillPlans.flatMap((row) => {
        const main: ZCTypedModifier[] = row.statId && row.operation && row.value != null
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
            : [];
        //  同条混搭（`skillParamJson` 的 `mix.<statId>[.addRate]`）：设计案里「克制条 + 暴击率」
        //  「溅射 + 攻速」这类一条技能两个属性，走这里补第二条；主属性仍是 `statId` 那一格。
        const mix = readZCSkillMixStats(row.skillParams).map((entry) => ({
            sourceId: row.modifierId,
            sourceKind: 'skill' as const,
            targetUnitId: unitId,
            domain: 'unit' as const,
            statId: entry.statId,
            operation: entry.operation,
            value: entry.value,
            priority: 100,
        }));
        return [...main, ...mix];
    });
    const textModifiers = legacyModifierIds.length
        ? compileTypedModifiers(legacyModifierIds, unitId, 'skill', catalogs, 'text').textModifiers
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
        //  武将技解锁门控：没到解锁等级就别放（见 `isZCEmpoweredLocked`）。
        empoweredLocked: isZCEmpoweredLocked(unitId, skillPlans, catalogs) || undefined,
        empoweredBagKey: zcEmpoweredBagKey(unitId, skillPlans, catalogs),
        breakdown: applyZCTypedUnitModifiers(unit, typedModifiers).breakdown,
        effects,
        unsupportedAttributes: [],
        configHash: catalogs.adapters.configHash,
    };
}

/** 将 client/server 的等级、升星、装备、宝石构筑编译成只读的本局修正。*/
export function compileZCCombatBuild(
    selection: ZCCombatBuildSelection,
    units: readonly ZCUnitDefinition[],
    catalogs: ZCModifierCatalogs = getZCModifierCatalogs(),
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
    if (selection.serverAttributes || selection.serverModifiers?.length) {
        const typedModifiers: ZCTypedModifier[] = [];
        for (const statId of ['attack', 'maxHp'] as const) {
            const value = selection.serverAttributes?.[statId];
            if (value === undefined) continue;
            if (!Number.isFinite(value) || (statId === 'maxHp' && value === 0)) {
                throw new Error(`[ZCModifierRuntime] 服务端英雄属性无效：${selection.unitId}:${statId}=${value}`);
            }
            typedModifiers.push({
                sourceId: selection.unitId, sourceKind: 'server', targetUnitId: selection.unitId,
                domain: 'unit', statId, operation: 'override', value, priority: 1000,
            });
        }
        for (const modifier of selection.serverModifiers ?? []) {
            if (!Number.isFinite(modifier.value)) {
                throw new Error(`[ZCModifierRuntime] 服务端英雄增量属性无效：`
                    + `${selection.unitId}:${modifier.statId}.${modifier.operation}=${modifier.value}`);
            }
            typedModifiers.push({
                sourceId: selection.unitId, sourceKind: 'server', targetUnitId: selection.unitId,
                domain: 'unit', statId: modifier.statId, operation: modifier.operation,
                value: modifier.value,
                //  priority 900：低于 override 的 1000。`addRate` 会在定值之后叠乘（关卡减益），
                //  `add` 仍被定值压制 —— 详见 `applyZCTypedUnitModifiers` 的合成分支。
                priority: 900,
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

/** 将同一单位命中的静态修正合并为有效定义；绝不修改全局单位目录。*/
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

/** 逐单位倍率优先，席位倍率只补未被服务端定值覆盖的属性。*/
export function resolveZCUnitDefinition(
    base: ZCUnitDefinition,
    loadouts: readonly ZCCompiledModifierLoadout[],
    rates?: IZCBattleRates,
    unitRates?: IZCBattleRates,
): ZCUnitDefinition {
    const definition = resolveZCModifiedUnitDefinition(base, loadouts);
    if (!rates && !unitRates) return definition;
    const serverOverrides = loadouts
        .filter((loadout) => loadout.sourceKind === 'server' && loadout.targetUnitId === base.unitId)
        .flatMap((loadout) => loadout.typedModifiers)
        .filter((modifier) => modifier.domain === 'unit' && modifier.operation === 'override');
    const attackRate = unitRates?.attackRate
        ?? (serverOverrides.some((modifier) => modifier.statId === 'attack') ? undefined : rates?.attackRate);
    const hpRate = unitRates?.hpRate
        ?? (serverOverrides.some((modifier) => modifier.statId === 'maxHp') ? undefined : rates?.hpRate);
    return {
        ...definition,
        attack: attackRate === undefined ? definition.attack : definition.attack * attackRate,
        maxHp: hpRate === undefined ? definition.maxHp : definition.maxHp * hpRate,
    };
}

/**
 * 与 `resolveZCUnitDefinition` 同输入，额外返回 2026-10-13 新增的 9 种 statId 所累加出的 patch。
 *
 * 拆成并列是因为这 9 种不在 `ZCUnitDefinition` 上（没有基础值），只能以 patch 形式传给战斗结算。
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
 * 全队共享暴击伤害：每张卡的「全队暴击伤害增幅」汇入 owner 级同一个池，
 * 再写回该 owner 的每个单位。入参是卡池 patch 表，汇总为 0 时原样返回。
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

/** UI/调试使用：返回最终属性的基础值、各层修正和来源。*/
export function getZCUnitStatBreakdown(
    base: ZCUnitDefinition,
    loadouts: readonly ZCCompiledModifierLoadout[],
): readonly ZCStatBreakdown[] {
    const typed = loadouts
        .filter((loadout) => loadout.targetUnitId === base.unitId)
        .flatMap((loadout) => loadout.typedModifiers);
    return applyZCTypedUnitModifiers(base, typed).breakdown;
}
