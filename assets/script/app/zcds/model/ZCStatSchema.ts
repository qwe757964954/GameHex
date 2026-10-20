import type { ZCUnitDefinition } from './ZCCombatCatalog';
import { ZCCombatEventType } from './ZCCombatCatalog';
import type { ZCModifierRecord } from './ZCModifierEngine';
import { ZCControlKind, ZCStatusRefreshPolicy } from './ZCStatusEffect';
//  `import type`：纯编译期依赖，运行时不产生 require 边 ⇒ 不会与 `ZCModifierRuntime` 形成环
//  （那边本来就 import 本文件）。字段定义在那边，这里只用来标注 statPatch 的形状。
import type { ZCUnitStatPatch } from './ZCModifierRuntime';

/** PVP 运行时允许出现的稳定属性 id；禁止把任意中文键直接带进战斗循环。 */
export type ZCStatId =
    | 'attack'
    | 'maxHp'
    | 'moveSpeed'
    | 'attackRange'
    | 'attackInterval'
    | 'attackSpeed'
    | 'attackDuration'
    | 'attackHitTime'
    | 'projectileCount'
    | 'damageRate'
    | 'pierceCount'
    | 'executeChance'
    | 'impactDamageRate'
    | 'explosionDamageRate'
    | 'zoneCount'
    | 'slowRatio'
    | 'expireDamageRate'
    | 'freezeDuration'
    | 'shieldRatio'
    | 'directionCount'
    | 'moveSpeedBoost'
    | 'bannerTargetCount'
    | 'bannerCritRate'
    | 'empoweredEvery'
    //  以下 9 种对应 `pvpAttrMap` 里 `sourceUnit !== 'text'` 的数值属性（2026-10-13 表补齐）。
    //  文本类（`type` / `model` / `attackType`）走独立 schema，不进入纯数值的 `ZCUnitStatPatch`。
    | 'attackCount'
    | 'bulletNum'
    | 'bulletAngle'
    | 'critRate'
    | 'critDamage'
    | 'recruitCd'
    | 'recruitMaxNum'
    | 'singleRecruitNum'
    | 'singleRecruitLegionCount';

//  取值真源 = `as const` 对象 + 同名派生类型（同 `ZCCardType`）：
//  `Object.values(X)` 就是运行时校验集合，新增一个取值只改这里。
export const ZCTextStatId = {
    Type: 'type',
    Model: 'model',
    AttackType: 'attackType',
} as const;
export type ZCTextStatId = (typeof ZCTextStatId)[keyof typeof ZCTextStatId];

export const ZCModifierDomain = {
    Unit: 'unit',
    Skill: 'skill',
    Building: 'building',
    Economy: 'economy',
    Status: 'status',
} as const;
export type ZCModifierDomain = (typeof ZCModifierDomain)[keyof typeof ZCModifierDomain];

export const ZCStatOperation = {
    Add: 'add',
    AddRate: 'addRate',
    Multiply: 'multiply',
    Override: 'override',
} as const;
export type ZCStatOperation = (typeof ZCStatOperation)[keyof typeof ZCStatOperation];

export const ZCSourceUnit = {
    Flat: 'flat',
    Percent: 'percent',
    BasisPoint: 'basisPoint',
    Millisecond: 'millisecond',
    Second: 'second',
    Ratio: 'ratio',
    Count: 'count',
    Text: 'text',
} as const;
export type ZCSourceUnit = (typeof ZCSourceUnit)[keyof typeof ZCSourceUnit];

export const ZCModifierSourceKind = {
    GeneralStar: 'generalStar',
    Equipment: 'equipment',
    Gem: 'gem',
    Skill: 'skill',
    Growth: 'growth',
    Status: 'status',
} as const;
export type ZCModifierSourceKind = (typeof ZCModifierSourceKind)[keyof typeof ZCModifierSourceKind];

/** 技能状态机模式：`ZCSkillBinding` 与 `ZCSkillRuntime` 共用的唯一真源。 */
export const ZCSkillStateMode = {
    None: 'none',
    Counter: 'counter',
    CastFsm: 'cast-fsm',
} as const;
export type ZCSkillStateMode = (typeof ZCSkillStateMode)[keyof typeof ZCSkillStateMode];

export interface ZCAttributeMapping {
    legacyKey: string;
    domain: ZCModifierDomain;
    statId: ZCStatId;
    operation: ZCStatOperation;
    sourceUnit: ZCSourceUnit;
    scale: number;
    min?: number;
    max?: number;
    priority: number;
    enabled: boolean;
    handlerKey?: string;
}

export interface ZCTextAttributeMapping {
    legacyKey: string;
    domain: 'skill';
    statId: ZCTextStatId;
    operation: 'override';
    sourceUnit: 'text';
    scale: 1;
    priority: number;
    enabled: boolean;
}

export interface ZCModifierOverride {
    modifierId: number;
    legacyKey: string;
    targetUnitId?: string;
    /** 养成方案；留空 = 通用，对所有方案生效。同一 modifierId + legacyKey 可按方案各给一套值。 */
    sourceKind?: ZCModifierSourceKind;
    domain: ZCModifierDomain;
    statId: ZCStatId;
    operation: ZCStatOperation;
    value: number;
    enabled: boolean;
}

export interface ZCTextModifierOverride {
    modifierId: number;
    legacyKey: string;
    targetUnitId?: string;
    sourceKind?: ZCModifierSourceKind;
    domain: 'skill';
    statId: ZCTextStatId;
    operation: 'override';
    value: string;
    enabled: boolean;
}

export interface ZCTextAttackModifier {
    sourceId: number;
    targetUnitId: string;
    skillId: number;
    statId: ZCTextStatId;
    value: string;
    priority: number;
}

export interface ZCUnitGrowthRecord {
    unitId: string;
    level: number;
    attackFlat: number;
    attackRate: number;
    maxHpFlat: number;
    maxHpRate: number;
    moveSpeedRate: number;
    attackRangeFlat: number;
    enabled: boolean;
}

export interface ZCSkillBinding {
    legacySkillId: number;
    pvpSkillId: number;
    targetUnitId: string;
    behaviorKey: string;
    trigger: string;
    stateMode: ZCSkillStateMode;
    parameterKey?: string;
    parameterStatId?: ZCStatId;
    enabled: boolean;
}

export const ZCSkillProgressionMode = {
    Replace: 'replace',
    Accumulate: 'accumulate',
    Branch: 'branch',
} as const;
export type ZCSkillProgressionMode = (typeof ZCSkillProgressionMode)[keyof typeof ZCSkillProgressionMode];

/** J-技能表/PVP技能配置的一行。它既可提供被动数值，也可声明命中状态等行为参数。 */
export interface ZCSkillPlanRecord {
    enabled: boolean;
    modifierId: number;
    unitId: string;
    skillChainId: number;
    skillLevel: number;
    unlockHeroLevel: number;
    progressionMode: ZCSkillProgressionMode;
    pvpSkillId: number;
    statId?: ZCStatId;
    operation?: ZCStatOperation;
    value?: number;
    behaviorKey?: string;
    triggerEvent?: string;
    stateMode: ZCSkillStateMode;
    targetSelector?: string;
    statusId?: string;
    statusStatMods?: Readonly<Record<string, number>>;
    durationSeconds?: number;
    maxStacks?: number;
    replacementSkillId?: number;
    cooldown?: number;
    maxTriggers?: number;
}

export interface ZCStatusConfigRecord {
    legacyBuffKey: string;
    statusId: string;
    name: string;
    durationSeconds: number;
    intervalSeconds: number;
    maxStacks: number;
    refreshPolicy: ZCStatusRefreshPolicy;
    handlerKey: string;
    statMods: Readonly<Record<string, number>>;
    enabled: boolean;
    /** periodic handler 每周期百分比（1 = 1%）；仅 periodic_damage/heal 使用。 */
    periodicAmountPct?: number;
    /** periodic 结算基准。 */
    periodicBasis?: 'targetMaxHp' | 'senderAttack';
    /** periodic 单次封顶 = 施加者攻击力 × 倍数。 */
    periodicCapMultiplier?: number;
    /** 硬控类别（stun/freeze/paralysis/blind）；非空时单位受控。 */
    control?: ZCControlKind;
}

export interface ZCTypedModifier {
    sourceId: number | string;
    sourceKind: ZCModifierSourceKind;
    targetUnitId: string;
    domain: ZCModifierDomain;
    statId: ZCStatId;
    operation: ZCStatOperation;
    value: number;
    priority: number;
    legacyKey?: string;
    handlerKey?: string;
}

export interface ZCStatBreakdown {
    statId: ZCStatId;
    base: number;
    flat: number;
    rate: number;
    multiplier: number;
    override: number | null;
    effective: number;
    sources: readonly Pick<ZCTypedModifier, 'sourceId' | 'sourceKind' | 'operation' | 'value'>[];
}

export interface ZCModifierAdapterCatalogs {
    attrMap: ReadonlyMap<string, ZCAttributeMapping>;
    /** 文本覆盖按技能绑定进入攻击档案，不进入数值修正器。 */
    textAttrMap: ReadonlyMap<string, ZCTextAttributeMapping>;
    overrides: ReadonlyMap<string, ZCModifierOverride>;
    textOverrides: ReadonlyMap<string, ZCTextModifierOverride>;
    growth: ReadonlyMap<string, ZCUnitGrowthRecord>;
    skillBindings: readonly ZCSkillBinding[];
    statuses: readonly ZCStatusConfigRecord[];
    skillPlans: readonly ZCSkillPlanRecord[];
    configHash: string;
}

export interface ZCModifierAdapterTables {
    pvpAttrMap?: readonly Record<string, unknown>[];
    /**
     * 支持两种输入：
     * 1. 单属性行：legacyKey + targetUnitId + domain/statId/operation/value；
     * 2. 多属性行：targetUnitIds + valuesJson。valuesJson 优先使用 `statId.operation`
     *    字段选择器（如 attack.add / attack.addRate），同时兼容旧中文 legacyKey。
     */
    pvpModifierOverride?: readonly Record<string, unknown>[];
    pvpUnitGrowth?: readonly Record<string, unknown>[];
    pvpSkillBinding?: readonly Record<string, unknown>[];
    pvpStatus?: readonly Record<string, unknown>[];
    pvpSkillPlan?: readonly Record<string, unknown>[];
}

const DOMAINS = new Set<ZCModifierDomain>(Object.values(ZCModifierDomain));
const OPERATIONS = new Set<ZCStatOperation>(Object.values(ZCStatOperation));
const SOURCE_UNITS = new Set<ZCSourceUnit>(Object.values(ZCSourceUnit));
const TEXT_STAT_IDS = new Set<ZCTextStatId>(Object.values(ZCTextStatId));
const SOURCE_KINDS = new Set<ZCModifierSourceKind>(Object.values(ZCModifierSourceKind));
const SKILL_STATES = new Set<ZCSkillStateMode>(Object.values(ZCSkillStateMode));
const REFRESH_POLICIES = new Set<ZCStatusRefreshPolicy>(Object.values(ZCStatusRefreshPolicy));
const STAT_IDS = new Set<ZCStatId>([
    'attack', 'maxHp', 'moveSpeed', 'attackRange', 'attackInterval', 'attackSpeed',
    'attackDuration', 'attackHitTime', 'projectileCount', 'damageRate', 'pierceCount',
    'executeChance', 'impactDamageRate', 'explosionDamageRate', 'zoneCount', 'slowRatio',
    'expireDamageRate', 'freezeDuration', 'shieldRatio', 'directionCount', 'moveSpeedBoost',
    'bannerTargetCount', 'bannerCritRate', 'empoweredEvery',
    'attackCount', 'bulletNum', 'bulletAngle', 'critRate', 'critDamage',
    'recruitCd', 'recruitMaxNum', 'singleRecruitNum', 'singleRecruitLegionCount',
]);
const SKILL_BEHAVIORS = new Set(['empowered_attack', 'multi_projectile', 'periodic_damage', 'on_hit_status']);
const STATUS_HANDLERS = new Set([
    'none', 'periodic_damage', 'periodic_heal', 'on_hit_status',
    'legacy_dot', 'legacy_knockback', 'legacy_traction',
]);
const PERIODIC_BASES = new Set(['targetMaxHp', 'senderAttack']);
const CONTROL_KINDS = new Set<ZCControlKind>(Object.values(ZCControlKind));
const PROGRESSION_MODES = new Set<ZCSkillProgressionMode>(Object.values(ZCSkillProgressionMode));

function bool(value: unknown): boolean {
    return value === true || value === 1 || value === '1';
}

function text(value: unknown, path: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`[ZCStatSchema] ${path} 必须是非空字符串`);
    return value.trim();
}

export function isZCTextAttackValue(statId: ZCTextStatId, value: unknown): value is string {
    if (typeof value !== 'string' || !value.trim() || value !== value.trim()) return false;
    if (statId !== 'model') {
        return (Object.values(ZCCombatEventType) as readonly string[]).includes(value);
    }
    const segments = value.split('/');
    return segments.length >= 2 && !value.includes('\\') && !/\.[A-Za-z0-9]+$/.test(value)
        && segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function textOverrideValue(statId: ZCTextStatId, value: unknown, path: string): string {
    const parsed = text(value, path);
    if (!isZCTextAttackValue(statId, parsed)) {
        throw new Error(`[ZCStatSchema] ${path} 不符合新对局的攻击模式或 Prefab 路径：${parsed}`);
    }
    return parsed;
}

function number(value: unknown, path: string, fallback?: number): number {
    if ((value === '' || value == null) && fallback !== undefined) return fallback;
    const result = Number(value);
    if (!Number.isFinite(result)) throw new Error(`[ZCStatSchema] ${path} 必须是有限数字`);
    return result;
}

function optionalNumber(value: unknown, path: string): number | undefined {
    if (value === '' || value == null) return undefined;
    return number(value, path);
}

function jsonValue(value: unknown, path: string): unknown {
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch {
        throw new Error(`[ZCStatSchema] ${path} 必须是合法 JSON`);
    }
}

function stringArray(value: unknown, path: string): string[] {
    if (value == null || value === '') return [];
    const source = jsonValue(value, path);
    if (!Array.isArray(source)) throw new Error(`[ZCStatSchema] ${path} 必须是 JSON 数组`);
    const result = source.map((item, index) => text(String(item ?? ''), `${path}[${index}]`));
    if (new Set(result).size !== result.length) throw new Error(`[ZCStatSchema] ${path} 不能包含重复单位`);
    return result;
}

function overrideValueObject(value: unknown, path: string): Record<string, unknown> {
    const source = jsonValue(value, path);
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new Error(`[ZCStatSchema] ${path} 必须是对象 JSON`);
    }
    const entries = Object.entries(source);
    if (!entries.length) throw new Error(`[ZCStatSchema] ${path} 不能为空对象`);
    return Object.fromEntries(entries.map(([key, child]) => [text(key, `${path}.key`), child]));
}

function hasConfiguredValue(value: unknown): boolean {
    return value != null && value !== '';
}

function resolveOverrideValueField(
    field: string,
    modifierId: number,
    modifiers: ReadonlyMap<number, ZCModifierRecord>,
    attrMap: ReadonlyMap<string, ZCAttributeMapping>,
    textAttrMap: ReadonlyMap<string, ZCTextAttributeMapping>,
    path: string,
): { legacyKey: string } {
    const legacyMapping = attrMap.get(field) ?? textAttrMap.get(field);
    if (legacyMapping) return { legacyKey: field };

    const selector = /^([A-Za-z][A-Za-z0-9]*)\.(add|addRate|multiply|override)$/.exec(field);
    const statId = selector?.[1] as ZCStatId | undefined;
    const operation = selector?.[2] as ZCStatOperation | undefined;
    if (!statId || !operation || (!STAT_IDS.has(statId) && !(operation === 'override' && TEXT_STAT_IDS.has(statId as ZCTextStatId)))) {
        throw new Error(`[ZCStatSchema] ${path} 字段非法：${field}；应填写 statId.operation，例如 attack.addRate`);
    }

    const modifier = modifiers.get(modifierId);
    if (!modifier) throw new Error(`[ZCStatSchema] 覆盖引用的修改器不存在：${modifierId}`);
    const candidates = new Set<string>();
    for (const item of modifier.modify) {
        if (!item.data || typeof item.data !== 'object' || Array.isArray(item.data)) continue;
        for (const legacyKey of Object.keys(item.data as Record<string, unknown>)) {
            const mapping = attrMap.get(legacyKey) ?? textAttrMap.get(legacyKey);
            if (mapping?.statId === statId && mapping.operation === operation) candidates.add(legacyKey);
        }
    }
    if (!candidates.size) {
        throw new Error(`[ZCStatSchema] ${path} 字段 ${field} 未匹配到修改器 ${modifierId} 的已映射属性`);
    }
    if (candidates.size > 1) {
        throw new Error(`[ZCStatSchema] ${path} 字段 ${field} 匹配到多个旧属性：${Array.from(candidates).join(', ')}`);
    }
    const legacyKey = Array.from(candidates)[0];
    return { legacyKey };
}

function enumValue<T extends string>(value: unknown, values: ReadonlySet<T>, path: string): T {
    const result = text(value, path) as T;
    if (!values.has(result)) throw new Error(`[ZCStatSchema] ${path} 非法：${result}`);
    return result;
}

function optionalEnumValue<T extends string>(value: unknown, values: ReadonlySet<T>, path: string): T | undefined {
    if (value == null || value === '') return undefined;
    return enumValue(value, values, path);
}

function overrideKey(modifierId: number, legacyKey: string, targetUnitId = '', sourceKind = ''): string {
    return `${modifierId}:${legacyKey}:${targetUnitId}:${sourceKind}`;
}

/**
 * 覆盖查找的回落顺序：单位+方案 → 单位通用 → 全单位+方案 → 全单位通用。
 * 于是「一个 modifierId 对应多个养成方案」只需按方案多写几行，未写方案的旧数据行为不变。
 */
export function findZCModifierOverride(
    catalogs: ZCModifierAdapterCatalogs,
    modifierId: number,
    legacyKey: string,
    targetUnitId: string,
    sourceKind?: ZCModifierSourceKind,
): ZCModifierOverride | undefined {
    const kind = sourceKind ?? '';
    return catalogs.overrides.get(overrideKey(modifierId, legacyKey, targetUnitId, kind))
        ?? catalogs.overrides.get(overrideKey(modifierId, legacyKey, targetUnitId))
        ?? catalogs.overrides.get(overrideKey(modifierId, legacyKey, '', kind))
        ?? catalogs.overrides.get(overrideKey(modifierId, legacyKey));
}

export function findZCTextModifierOverride(
    catalogs: ZCModifierAdapterCatalogs,
    modifierId: number,
    legacyKey: string,
    targetUnitId: string,
    sourceKind?: ZCModifierSourceKind,
): ZCTextModifierOverride | undefined {
    const kind = sourceKind ?? '';
    return catalogs.textOverrides.get(overrideKey(modifierId, legacyKey, targetUnitId, kind))
        ?? catalogs.textOverrides.get(overrideKey(modifierId, legacyKey, targetUnitId))
        ?? catalogs.textOverrides.get(overrideKey(modifierId, legacyKey, '', kind))
        ?? catalogs.textOverrides.get(overrideKey(modifierId, legacyKey));
}

function stableHash(value: unknown): string {
    const normalize = (item: unknown): unknown => {
        if (Array.isArray(item)) return item.map(normalize);
        if (item && typeof item === 'object') {
            return Object.fromEntries(Object.entries(item as Record<string, unknown>)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, child]) => [key, normalize(child)]));
        }
        return item;
    };
    const source = JSON.stringify(normalize(value));
    let hash = 0x811c9dc5;
    for (let index = 0; index < source.length; index += 1) {
        hash ^= source.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

/** 两份映射是否等价（忽略 `priority`/`min`/`max` 这类可能按技能微调的字段之外的核心部分）。 */
function sameMapping(left: ZCAttributeMapping, right: ZCAttributeMapping): boolean {
    return left.domain === right.domain
        && left.statId === right.statId
        && left.operation === right.operation
        && left.sourceUnit === right.sourceUnit
        && left.scale === right.scale
        && left.enabled === right.enabled
        && left.handlerKey === right.handlerKey;
}

/** 解析并严格校验五张 PVP 适配表；失败时不应提交到全局运行时。 */
export function parseZCModifierAdapterCatalogs(
    tables: ZCModifierAdapterTables,
    modifiers: ReadonlyMap<number, ZCModifierRecord> = new Map(),
): ZCModifierAdapterCatalogs {
    const attrMap = new Map<string, ZCAttributeMapping>();
    const textAttrMap = new Map<string, ZCTextAttributeMapping>();
    for (const [index, row] of (tables.pvpAttrMap ?? []).entries()) {
        const path = `pvpAttrMap[${index}]`;
        const legacyKey = text(row.legacyKey, `${path}.legacyKey`);
        //  整行占位：表里预留的空行（`statId`/`sourceUnit`/`operation` 全空，只有 legacyKey）。
        //  不是配错，是还没填 —— 跳过，别在校验期炸掉整局加载。
        if (row.statId == null || row.statId === '') {
            continue;
        }
        const sourceUnit = enumValue(row.sourceUnit, SOURCE_UNITS, `${path}.sourceUnit`);
        const statId = text(row.statId, `${path}.statId`);
        //  文本覆盖留在独立 schema，避免字符串进入纯数值 stat 通道。
        if (TEXT_STAT_IDS.has(statId as ZCTextStatId)) {
            const domain = enumValue(row.domain, DOMAINS, `${path}.domain`);
            const operation = enumValue(row.operation, OPERATIONS, `${path}.operation`);
            const scale = number(row.scale, `${path}.scale`);
            if (sourceUnit !== 'text') throw new Error(`[ZCStatSchema] ${path}.sourceUnit 必须是 text`);
            if (domain !== 'skill') throw new Error(`[ZCStatSchema] ${path}.domain 必须是 skill`);
            if (operation !== 'override') throw new Error(`[ZCStatSchema] ${path}.operation 必须是 override`);
            if (scale !== 1) throw new Error(`[ZCStatSchema] ${path}.scale 必须是 1`);
            if (hasConfiguredValue(row.min) || hasConfiguredValue(row.max)) {
                throw new Error(`[ZCStatSchema] ${path} 文本覆盖不能设置 min/max`);
            }
            if (hasConfiguredValue(row.handlerKey)) {
                throw new Error(`[ZCStatSchema] ${path}.handlerKey 不适用于文本覆盖`);
            }
            const mapping: ZCTextAttributeMapping = {
                legacyKey, domain, statId: statId as ZCTextStatId, operation, sourceUnit, scale,
                priority: number(row.priority, `${path}.priority`, 100), enabled: bool(row.enabled),
            };
            const previous = textAttrMap.get(legacyKey);
            if (attrMap.has(legacyKey) || (previous && (previous.statId !== mapping.statId
                || previous.priority !== mapping.priority || previous.enabled !== mapping.enabled))) {
                throw new Error(`[ZCStatSchema] legacyKey 重复且映射不一致：${legacyKey}（见 ${path}）`);
            }
            textAttrMap.set(legacyKey, mapping);
            continue;
        }
        const mapping: ZCAttributeMapping = {
            legacyKey,
            domain: enumValue(row.domain, DOMAINS, `${path}.domain`),
            statId: enumValue(row.statId, STAT_IDS, `${path}.statId`),
            operation: enumValue(row.operation, OPERATIONS, `${path}.operation`),
            sourceUnit,
            scale: number(row.scale, `${path}.scale`),
            min: optionalNumber(row.min, `${path}.min`),
            max: optionalNumber(row.max, `${path}.max`),
            priority: number(row.priority, `${path}.priority`, 100),
            enabled: bool(row.enabled),
            handlerKey: typeof row.handlerKey === 'string' && row.handlerKey.trim() ? row.handlerKey.trim() : undefined,
        };
        if (mapping.min != null && mapping.max != null && mapping.min > mapping.max) {
            throw new Error(`[ZCStatSchema] ${path} min 不能大于 max`);
        }
        //  同 `legacyKey` 允许重复出现：表里同一属性会按技能各复制一份（2348 行只有 2132 个不同 key）。
        //  内容完全一致时是**冗余拷贝**，覆盖即可；内容不一致说明两条适配规则打架，必须当场报出。
        const previous = attrMap.get(legacyKey);
        if (textAttrMap.has(legacyKey) || (previous && !sameMapping(previous, mapping))) {
            throw new Error(`[ZCStatSchema] legacyKey 重复且映射不一致：${legacyKey}（见 ${path}）`);
        }
        attrMap.set(legacyKey, mapping);
    }
    const overrides = new Map<string, ZCModifierOverride>();
    const textOverrides = new Map<string, ZCTextModifierOverride>();
    const appendOverride = (record: ZCModifierOverride, path: string) => {
        if (modifiers.size && !modifiers.has(record.modifierId)) {
            throw new Error(`[ZCStatSchema] 覆盖引用的修改器不存在：${record.modifierId}`);
        }
        if (!attrMap.has(record.legacyKey)) {
            throw new Error(`[ZCStatSchema] 覆盖引用的 legacyKey 未映射：${record.legacyKey}`);
        }
        const key = overrideKey(record.modifierId, record.legacyKey, record.targetUnitId, record.sourceKind);
        if (overrides.has(key)) throw new Error(`[ZCStatSchema] 修改器覆盖重复：${key} (${path})`);
        overrides.set(key, record);
    };
    const appendTextOverride = (record: ZCTextModifierOverride, path: string) => {
        if (modifiers.size && !modifiers.has(record.modifierId)) {
            throw new Error(`[ZCStatSchema] 覆盖引用的修改器不存在：${record.modifierId}`);
        }
        if (!textAttrMap.has(record.legacyKey)) {
            throw new Error(`[ZCStatSchema] 覆盖引用的 legacyKey 未映射：${record.legacyKey}`);
        }
        const key = overrideKey(record.modifierId, record.legacyKey, record.targetUnitId, record.sourceKind);
        if (textOverrides.has(key)) throw new Error(`[ZCStatSchema] 修改器覆盖重复：${key} (${path})`);
        textOverrides.set(key, record);
    };
    for (const [index, row] of (tables.pvpModifierOverride ?? []).entries()) {
        const path = `pvpModifierOverride[${index}]`;
        const modifierId = number(row.modifierId, `${path}.modifierId`);
        if (hasConfiguredValue(row.valuesJson)) {
            const mixedFields = ['legacyKey', 'targetUnitId', 'domain', 'statId', 'operation', 'value']
                .filter((field) => hasConfiguredValue(row[field]));
            if (mixedFields.length) {
                throw new Error(`[ZCStatSchema] ${path} 多属性模式不能同时填写单属性字段：${mixedFields.join(', ')}`);
            }
            const sourceKind = optionalEnumValue(row.sourceKind, SOURCE_KINDS, `${path}.sourceKind`);
            const targetUnitIds = stringArray(row.targetUnitIds, `${path}.targetUnitIds`);
            const values = overrideValueObject(row.valuesJson, `${path}.valuesJson`);
            const targets: Array<string | undefined> = targetUnitIds.length ? targetUnitIds : [undefined];
            for (const [field, value] of Object.entries(values)) {
                const { legacyKey } = resolveOverrideValueField(
                    field,
                    modifierId,
                    modifiers,
                    attrMap,
                    textAttrMap,
                    `${path}.valuesJson.${field}`,
                );
                const textMapping = textAttrMap.get(legacyKey);
                if (textMapping) {
                    const normalizedValue = textOverrideValue(textMapping.statId, value, `${path}.valuesJson.${field}`);
                    for (const targetUnitId of targets) {
                        appendTextOverride({
                            modifierId, legacyKey, targetUnitId, sourceKind,
                            domain: textMapping.domain, statId: textMapping.statId,
                            operation: textMapping.operation,
                            value: normalizedValue, enabled: bool(row.enabled),
                        }, path);
                    }
                    continue;
                }
                const numericMapping = attrMap.get(legacyKey);
                if (!numericMapping) {
                    throw new Error(`[ZCStatSchema] ${path}.valuesJson.${field} 未匹配到数值属性映射`);
                }
                const normalizedValue = number(value, `${path}.valuesJson.${field}`);
                for (const targetUnitId of targets) {
                    appendOverride({
                        modifierId,
                        legacyKey,
                        targetUnitId,
                        sourceKind,
                        domain: numericMapping.domain,
                        statId: numericMapping.statId,
                        operation: numericMapping.operation,
                        value: normalizedValue,
                        enabled: bool(row.enabled),
                    }, path);
                }
            }
            continue;
        }
        if (hasConfiguredValue(row.targetUnitIds)) {
            throw new Error(`[ZCStatSchema] ${path}.targetUnitIds 只能与 valuesJson 同时使用`);
        }
        const legacyKey = text(row.legacyKey, `${path}.legacyKey`);
        const targetUnitId = row.targetUnitId == null || row.targetUnitId === '' ? undefined : String(row.targetUnitId);
        const textMapping = textAttrMap.get(legacyKey);
        if (textMapping) {
            const domain = enumValue(row.domain, DOMAINS, `${path}.domain`);
            const statId = enumValue(row.statId, TEXT_STAT_IDS, `${path}.statId`);
            const operation = enumValue(row.operation, OPERATIONS, `${path}.operation`);
            if (domain !== textMapping.domain || statId !== textMapping.statId || operation !== 'override') {
                throw new Error(`[ZCStatSchema] ${path} 文本覆盖与属性映射不一致`);
            }
            appendTextOverride({
                modifierId, legacyKey, targetUnitId,
                sourceKind: optionalEnumValue(row.sourceKind, SOURCE_KINDS, `${path}.sourceKind`),
                domain, statId, operation,
                value: textOverrideValue(statId, row.value, `${path}.value`), enabled: bool(row.enabled),
            }, path);
            continue;
        }
        const record: ZCModifierOverride = {
            modifierId,
            legacyKey,
            targetUnitId,
            sourceKind: optionalEnumValue(row.sourceKind, SOURCE_KINDS, `${path}.sourceKind`),
            domain: enumValue(row.domain, DOMAINS, `${path}.domain`),
            statId: enumValue(row.statId, STAT_IDS, `${path}.statId`),
            operation: enumValue(row.operation, OPERATIONS, `${path}.operation`),
            value: number(row.value, `${path}.value`),
            enabled: bool(row.enabled),
        };
        appendOverride(record, path);
    }

    const growth = new Map<string, ZCUnitGrowthRecord>();
    for (const [index, row] of (tables.pvpUnitGrowth ?? []).entries()) {
        const path = `pvpUnitGrowth[${index}]`;
        const unitId = text(String(row.unitId ?? ''), `${path}.unitId`);
        const level = number(row.level, `${path}.level`);
        if (!Number.isSafeInteger(level) || level < 1) throw new Error(`[ZCStatSchema] ${path}.level 必须是正整数`);
        const key = `${unitId}:${level}`;
        if (growth.has(key)) throw new Error(`[ZCStatSchema] PVP 成长重复：${key}`);
        growth.set(key, {
            unitId,
            level,
            attackFlat: number(row.attackFlat, `${path}.attackFlat`, 0),
            attackRate: number(row.attackRate, `${path}.attackRate`, 0),
            maxHpFlat: number(row.maxHpFlat, `${path}.maxHpFlat`, 0),
            maxHpRate: number(row.maxHpRate, `${path}.maxHpRate`, 0),
            moveSpeedRate: number(row.moveSpeedRate, `${path}.moveSpeedRate`, 0),
            attackRangeFlat: number(row.attackRangeFlat, `${path}.attackRangeFlat`, 0),
            enabled: bool(row.enabled),
        });
    }

    const skillBindings: ZCSkillBinding[] = [];
    const bindingKeys = new Set<string>();
    for (const [index, row] of (tables.pvpSkillBinding ?? []).entries()) {
        const path = `pvpSkillBinding[${index}]`;
        const behaviorKey = text(row.behaviorKey, `${path}.behaviorKey`);
        if (!SKILL_BEHAVIORS.has(behaviorKey)) throw new Error(`[ZCStatSchema] 未注册 behaviorKey：${behaviorKey}`);
        const stateMode = text(row.stateMode, `${path}.stateMode`) as ZCSkillStateMode;
        if (!SKILL_STATES.has(stateMode)) throw new Error(`[ZCStatSchema] 非法 stateMode：${stateMode}`);
        const record: ZCSkillBinding = {
            legacySkillId: number(row.legacySkillId, `${path}.legacySkillId`),
            pvpSkillId: number(row.pvpSkillId, `${path}.pvpSkillId`),
            targetUnitId: text(String(row.targetUnitId ?? ''), `${path}.targetUnitId`),
            behaviorKey,
            trigger: text(row.trigger, `${path}.trigger`),
            stateMode,
            parameterKey: typeof row.parameterKey === 'string' && row.parameterKey.trim() ? row.parameterKey.trim() : undefined,
            parameterStatId: row.parameterStatId == null || row.parameterStatId === ''
                ? undefined
                : enumValue(row.parameterStatId, STAT_IDS, `${path}.parameterStatId`),
            enabled: bool(row.enabled),
        };
        const key = `${record.targetUnitId}:${record.pvpSkillId}:${record.behaviorKey}`
            + `:${record.parameterKey ?? ''}:${record.parameterStatId ?? ''}`;
        if (bindingKeys.has(key)) throw new Error(`[ZCStatSchema] 技能映射重复：${key}`);
        bindingKeys.add(key);
        skillBindings.push(record);
    }

    const statuses: ZCStatusConfigRecord[] = [];
    const statusIds = new Set<string>();
    for (const [index, row] of (tables.pvpStatus ?? []).entries()) {
        const path = `pvpStatus[${index}]`;
        const statusId = text(row.statusId, `${path}.statusId`);
        if (statusIds.has(statusId)) throw new Error(`[ZCStatSchema] statusId 重复：${statusId}`);
        statusIds.add(statusId);
        const handlerKey = text(row.handlerKey, `${path}.handlerKey`);
        if (!STATUS_HANDLERS.has(handlerKey)) throw new Error(`[ZCStatSchema] 未注册状态 handlerKey：${handlerKey}`);
        let statMods: Record<string, number> = {};
        try {
            const source = typeof row.statJson === 'string' && row.statJson.trim() ? JSON.parse(row.statJson) : {};
            if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('not-object');
            statMods = Object.fromEntries(Object.entries(source).map(([key, value]) => [key, number(value, `${path}.statJson.${key}`)]));
        } catch (error) {
            if (error instanceof Error && error.message.startsWith('[ZCStatSchema]')) throw error;
            throw new Error(`[ZCStatSchema] ${path}.statJson 必须是数字对象 JSON`);
        }
        const refreshPolicy = text(row.refreshPolicy, `${path}.refreshPolicy`) as ZCStatusConfigRecord['refreshPolicy'];
        if (!REFRESH_POLICIES.has(refreshPolicy)) throw new Error(`[ZCStatSchema] 非法 refreshPolicy：${refreshPolicy}`);
        const durationSeconds = number(row.durationSeconds, `${path}.durationSeconds`, 0);
        const intervalSeconds = number(row.intervalSeconds, `${path}.intervalSeconds`, 0);
        const maxStacks = number(row.maxStacks, `${path}.maxStacks`, 1);
        if (durationSeconds < 0 || intervalSeconds < 0 || !Number.isSafeInteger(maxStacks) || maxStacks < 1) {
            throw new Error(`[ZCStatSchema] ${path} 的时间或层数非法`);
        }
        const enabled = bool(row.enabled);
        const periodicAmountPct = number(row.periodicAmountPct, `${path}.periodicAmountPct`, 0);
        const periodicBasis = optionalEnumValue(
            row.periodicBasis, PERIODIC_BASES, `${path}.periodicBasis`,
        ) as ZCStatusConfigRecord['periodicBasis'];
        const periodicCapMultiplier = optionalNumber(row.periodicCapMultiplier, `${path}.periodicCapMultiplier`);
        const control = optionalEnumValue(row.control, CONTROL_KINDS, `${path}.control`);
        if (enabled && (handlerKey === 'periodic_damage' || handlerKey === 'periodic_heal')) {
            if (!periodicBasis) {
                throw new Error(`[ZCStatSchema] ${path} 启用的 periodic handler 缺少 periodicBasis`);
            }
        }
        statuses.push({
            legacyBuffKey: text(row.legacyBuffKey, `${path}.legacyBuffKey`),
            statusId,
            name: text(row.name, `${path}.name`),
            durationSeconds,
            intervalSeconds,
            maxStacks,
            refreshPolicy,
            handlerKey,
            statMods,
            enabled,
            periodicAmountPct,
            periodicBasis,
            periodicCapMultiplier,
            control,
        });
    }

    const skillPlans: ZCSkillPlanRecord[] = [];
    const skillPlanKeys = new Set<string>();
    for (const [index, row] of (tables.pvpSkillPlan ?? []).entries()) {
        const path = `pvpSkillPlan[${index}]`;
        const enabled = bool(row.enabled);
        const unitId = text(String(row.unitId ?? ''), `${path}.unitId`);
        const skillChainId = number(row.skillChainId, `${path}.skillChainId`);
        const skillLevel = number(row.skillLevel, `${path}.skillLevel`);
        const unlockHeroLevel = number(row.unlockHeroLevel, `${path}.unlockHeroLevel`);
        if (![skillChainId, skillLevel, unlockHeroLevel].every((value) => Number.isSafeInteger(value) && value >= 1)) {
            throw new Error(`[ZCStatSchema] ${path} 的技能/等级字段必须是正整数`);
        }
        const planKey = `${unitId}:${skillChainId}:${skillLevel}`;
        if (skillPlanKeys.has(planKey)) throw new Error(`[ZCStatSchema] PVP 技能升级档重复：${planKey}`);
        skillPlanKeys.add(planKey);
        const statId = row.statId == null || row.statId === ''
            ? undefined : enumValue(row.statId, STAT_IDS, `${path}.statId`);
        const operation = row.operation == null || row.operation === ''
            ? undefined : enumValue(row.operation, OPERATIONS, `${path}.operation`);
        const value = optionalNumber(row.value, `${path}.value`);
        if (enabled && ((statId == null) !== (operation == null) || (statId == null) !== (value == null))) {
            throw new Error(`[ZCStatSchema] ${path} 的 statId/operation/value 必须同时填写或同时留空`);
        }
        const behaviorKey = typeof row.behaviorKey === 'string' && row.behaviorKey.trim()
            ? row.behaviorKey.trim() : undefined;
        if (enabled && behaviorKey && !SKILL_BEHAVIORS.has(behaviorKey)) {
            throw new Error(`[ZCStatSchema] 未注册 behaviorKey：${behaviorKey}`);
        }
        const statusId = typeof row.statusId === 'string' && row.statusId.trim() ? row.statusId.trim() : undefined;
        let statusStatMods: Record<string, number> | undefined;
        if (statusId) {
            const raw = row.statusStatJson == null || row.statusStatJson === '' ? {} : jsonValue(row.statusStatJson, `${path}.statusStatJson`);
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`[ZCStatSchema] ${path}.statusStatJson 必须是对象`);
            statusStatMods = Object.fromEntries(Object.entries(raw).map(([name, child]) => [name, number(child, `${path}.statusStatJson.${name}`)]));
            if (!statusIds.has(statusId)) {
                statusIds.add(statusId);
                statuses.push({
                    legacyBuffKey: `pvpSkillPlan:${skillChainId}:${skillLevel}`,
                    statusId,
                    name: statusId,
                    durationSeconds: number(row.durationSeconds, `${path}.durationSeconds`, 0),
                    intervalSeconds: 0,
                    maxStacks: number(row.maxStacks, `${path}.maxStacks`, 1),
                    refreshPolicy: 'refresh',
                    handlerKey: 'none',
                    statMods: statusStatMods,
                    enabled,
                });
            }
        }
        skillPlans.push({
            enabled,
            modifierId: number(row.modifierId, `${path}.modifierId`),
            unitId,
            skillChainId,
            skillLevel,
            unlockHeroLevel,
            progressionMode: enumValue(row.progressionMode, PROGRESSION_MODES, `${path}.progressionMode`),
            pvpSkillId: number(row.pvpSkillId, `${path}.pvpSkillId`),
            statId,
            operation,
            value,
            behaviorKey,
            triggerEvent: typeof row.triggerEvent === 'string' && row.triggerEvent.trim() ? row.triggerEvent.trim() : undefined,
            stateMode: (typeof row.stateMode === 'string' && row.stateMode.trim() ? row.stateMode.trim() : 'none') as ZCSkillBinding['stateMode'],
            targetSelector: typeof row.targetSelector === 'string' && row.targetSelector.trim() ? row.targetSelector.trim() : undefined,
            statusId,
            statusStatMods,
            durationSeconds: optionalNumber(row.durationSeconds, `${path}.durationSeconds`),
            maxStacks: optionalNumber(row.maxStacks, `${path}.maxStacks`),
            replacementSkillId: optionalNumber(row.replacementSkillId, `${path}.replacementSkillId`),
            cooldown: optionalNumber(row.cooldown, `${path}.cooldown`),
            maxTriggers: optionalNumber(row.maxTriggers, `${path}.maxTriggers`),
        });
    }

    return {
        attrMap,
        textAttrMap,
        overrides,
        textOverrides,
        growth,
        skillBindings,
        statuses,
        skillPlans,
        configHash: stableHash(tables),
    };
}

const UNIT_STAT_IDS: readonly ZCStatId[] = [
    'attack', 'maxHp', 'moveSpeed', 'attackRange', 'attackInterval',
    'attackSpeed', 'attackDuration', 'attackHitTime',
    //  以下 8 种不在 `ZCUnitDefinition` 上（没有基础值），`baseValue` 一律给0 ⇒ 纯由修改器累加。
    'critRate', 'critDamage', 'bulletNum', 'bulletAngle',
    'attackCount', 'recruitCd', 'recruitMaxNum',
    'singleRecruitNum', 'singleRecruitLegionCount',
];

/**
 * 2026-10-13 新增的 8 种 statId → `ZCUnitStatPatch` 字段。
 * 第二个是 `addRate` 的去处（`null` = 该 statId 没有百分数口径）。
 * 已有的 8 种不在这里 —— 它们由 `typedToLegacyPatch` 负责。
 */
const STAT_TO_PATCH: Readonly<Record<string, [keyof ZCUnitStatPatch, keyof ZCUnitStatPatch | null]>> = {
    critRate: ['critRatePct', null],
    critDamage: ['critDamagePct', null],
    bulletNum: ['bulletNumFlat', null],
    bulletAngle: ['bulletAngleFlat', null],
    attackCount: ['multiHitFlat', null],
    recruitCd: ['recruitCdFlat', 'recruitCdPct'],
    recruitMaxNum: ['recruitMaxNumFlat', null],
    singleRecruitNum: ['singleRecruitNumFlat', null],
    singleRecruitLegionCount: ['singleRecruitLegionCountFlat', null],
};

/** 把一次结算出的 statId 明细折成 `ZCUnitStatPatch`；空 patch 不写键（下游按缺省走）。 */
function foldStatPatch(
    statId: ZCStatId,
    flat: number,
    rate: number,
    into: ZCUnitStatPatch,
): void {
    const entry = STAT_TO_PATCH[statId];
    if (!entry) return;
    const [flatKey, pctKey] = entry;
    if (flat !== 0) into[flatKey] = (into[flatKey] ?? 0) + flat;
    if (pctKey && rate !== 0) into[pctKey] = (into[pctKey] ?? 0) + rate * 100;
}

function baseValue(definition: ZCUnitDefinition, statId: ZCStatId): number {
    if (statId === 'attackSpeed') return 0;
    if (statId in definition) return Number(definition[statId as keyof ZCUnitDefinition]);
    return 0;
}

function clampStat(statId: ZCStatId, value: number): number {
    switch (statId) {
        case 'maxHp': return Math.max(1, value);
        case 'attackInterval':
        case 'attackDuration': return Math.max(0.01, value);
        case 'attack':
        case 'moveSpeed':
        case 'attackRange':
        case 'attackHitTime': return Math.max(0, value);
        default: return value;
    }
}

/** 按固定层级计算单位定义，同时生成 UI 可直接消费的基础值/绿色加成明细。 */
export function applyZCTypedUnitModifiers(
    base: ZCUnitDefinition,
    modifiers: readonly ZCTypedModifier[],
): { definition: ZCUnitDefinition; breakdown: readonly ZCStatBreakdown[]; statPatch: ZCUnitStatPatch } {
    const unitMods = modifiers
        .filter((item) => item.domain === 'unit' && item.targetUnitId === base.unitId)
        .slice()
        .sort((left, right) => left.priority - right.priority || String(left.sourceId).localeCompare(String(right.sourceId)));
    const values = new Map<ZCStatId, number>();
    const breakdown: ZCStatBreakdown[] = [];
    const statPatch: ZCUnitStatPatch = {};
    for (const statId of UNIT_STAT_IDS) {
        //   只折叠 2026-10-13 新增的 8 种；已有 8 种（attack/maxHp/…）由 `typedToLegacyPatch`
        //     负责（两条路径各自消费：前者进 `statPatch`、后者改 `definition`）。
        const sources = unitMods.filter((item) => item.statId === statId);
        if (!sources.length && statId === 'attackSpeed') continue;
        const baseStat = baseValue(base, statId);
        const flat = sources.filter((item) => item.operation === 'add').reduce((sum, item) => sum + item.value, 0);
        const rate = sources.filter((item) => item.operation === 'addRate').reduce((sum, item) => sum + item.value, 0);
        const multiplier = sources.filter((item) => item.operation === 'multiply').reduce((product, item) => product * item.value, 1);
        const overrides = sources.filter((item) => item.operation === 'override');
        const override = overrides.length ? overrides[overrides.length - 1].value : null;
        let effective = override ?? (baseStat + flat) * (1 + rate) * multiplier;
        effective = clampStat(statId, effective);
        values.set(statId, effective);
        //  `override` 直接定值；否则 flat 是绝对增量、rate 是相对增量（乘在 base 上）。
        foldStatPatch(statId, override ?? flat, override === null ? rate * baseStat : 0, statPatch);
        breakdown.push({
            statId,
            base: baseStat,
            flat,
            rate,
            multiplier,
            override,
            effective,
            sources: sources.map(({ sourceId, sourceKind, operation, value }) => ({ sourceId, sourceKind, operation, value })),
        });
    }

    const attackSpeedRate = values.get('attackSpeed') ?? 0;
    const directInterval = values.get('attackInterval') ?? base.attackInterval;
    const attackInterval = Math.max(0.01, directInterval * Math.max(0.01, 1 - attackSpeedRate));
    const attackDuration = values.get('attackDuration') ?? base.attackDuration;
    return {
        definition: {
            ...base,
            attack: values.get('attack') ?? base.attack,
            maxHp: values.get('maxHp') ?? base.maxHp,
            moveSpeed: values.get('moveSpeed') ?? base.moveSpeed,
            attackRange: values.get('attackRange') ?? base.attackRange,
            attackInterval,
            attackDuration,
            attackHitTime: Math.min(attackDuration, values.get('attackHitTime') ?? base.attackHitTime),
        },
        breakdown,
        statPatch,
    };
}
