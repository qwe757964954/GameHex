import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_TABLES = [
    'pvpSkill',
    'pvpCard',
    'pvpAttrMap',
    'pvpModifierOverride',
    'pvpUnitGrowth',
    'pvpSkillBinding',
    'pvpStatus',
    'skillAttrModifier',
    'generalStar',
    'armySkillLevelUp',
    // 老 Client 伤害公式链；PVP 战斗启动时会与上面的新表一起原子加载。
    'skillAttr',
    'skillView',
    'skillEffect',
    'skillBuff',
];

const LEGACY_RUNTIME_SCRIPTS = new Set([
    '基础伤害', '伤害加成', '伤害增幅', '伤害范围',
    '伤害次数', '伤害百分比', '斩杀', 'buff',
]);
const LEGACY_METADATA_SCRIPTS = new Set(['伤害类型', '受击']);
const LEGACY_FORMULA_ROOTS = new Set([
    'attr', 'GetValue', 'random', 'randomInt', 'buff', 'has', 'tid',
    'damageInfo', 'damageTag', 'isCrit', 'var', 'HpRateLe',
    'true', 'false', 'null', 'undefined', 'e', 'E',
]);

function normalizeRows(value, tableName) {
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value.k) && Array.isArray(value.v)) {
        return value.v.map((cells, rowIndex) => {
            if (!Array.isArray(cells)) throw new Error(`${tableName}.v[${rowIndex}] 不是数组`);
            return Object.fromEntries(value.k.map((key, index) => [key, cells[index]]));
        });
    }
    throw new Error(`${tableName}.json 不是数组，也不是 {k,v} 压缩表`);
}

function readTable(directory, name, required, errors, warnings) {
    const path = resolve(directory, `${name}.json`);
    if (!existsSync(path)) {
        (required ? errors : warnings).push(`${name}.json 不存在：${path}`);
        return [];
    }
    try {
        return normalizeRows(JSON.parse(readFileSync(path, 'utf8')), name);
    } catch (error) {
        errors.push(`${name}.json 读取失败：${error instanceof Error ? error.message : String(error)}`);
        return [];
    }
}

function enabled(row) {
    return row.enabled === true || row.enabled === 1 || row.enabled === '1';
}

function key(value) {
    return value == null ? '' : String(value).trim();
}

function numberList(value) {
    if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite);
    if (value == null || value === '') return [];
    try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        return Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : [];
    } catch {
        return [];
    }
}

function stringList(value) {
    if (Array.isArray(value)) return value.map(key).filter(Boolean);
    const valueKey = key(value);
    return valueKey ? [valueKey] : [];
}

function objectValue(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/**
 * 与客户端受限公式执行器相同的安全边界检查。完整语法仍由客户端加载时编译；
 * 这里在发布 JSON 前拦截全局访问、赋值、代码块和未知调用根。
 */
function validateLegacyFormula(value, label, errors) {
    if (typeof value !== 'string') return;
    const source = value.trim();
    if (!source || source === '默认' || source === 'default') return;
    if (/[;{}\x60]/.test(source) || /(^|[^=!<>])=([^=]|$)/.test(source)
        || /\b(?:new|function|class|this|globalThis|window|global|process|require|import|eval|Function)\b/.test(source)) {
        errors.push(`${label} 含公式白名单外的代码：${source}`);
        return;
    }

    let scrubbed = '';
    let quote = '';
    let escaped = false;
    const stack = [];
    for (let index = 0; index < source.length; index += 1) {
        const character = source[index];
        if (quote) {
            scrubbed += ' ';
            if (escaped) escaped = false;
            else if (character === '\\') escaped = true;
            else if (character === quote) quote = '';
            continue;
        }
        if (character === '\'' || character === '"') {
            quote = character;
            scrubbed += ' ';
            continue;
        }
        if (character === '(' || character === '[') stack.push(character);
        else if (character === ')' || character === ']') {
            const open = stack.pop();
            if ((character === ')' && open !== '(') || (character === ']' && open !== '[')) {
                errors.push(`${label} 括号不匹配：${source}`);
                return;
            }
        }
        scrubbed += character;
    }
    if (quote || stack.length) {
        errors.push(`${label} 字符串或括号未闭合：${source}`);
        return;
    }
    const identifiers = scrubbed.match(/[A-Za-z_$][\w$]*/g) ?? [];
    const unknown = [...new Set(identifiers.filter((identifier) => !LEGACY_FORMULA_ROOTS.has(identifier)))];
    if (unknown.length) errors.push(`${label} 使用公式白名单外标识符：${unknown.join(', ')}（${source}）`);
}

function validateNonNegative(value, label, errors, allowPermanentSentinel = false) {
    if (value == null || value === '') return;
    const numeric = Number(value);
    // 老 skillBuff 允许填写属性名，运行时由具体行为读取；-1 是永久 Buff 的历史哨兵。
    if (!Number.isFinite(numeric) && typeof value === 'string') return;
    if (!Number.isFinite(numeric) || (numeric < 0 && !(allowPermanentSentinel && numeric === -1))) {
        errors.push(`${label} 必须是非负有限数${allowPermanentSentinel ? '或永久值 -1' : ''}，实际为：${String(value)}`);
    }
}

function assertUnique(rows, makeKey, label, errors) {
    const seen = new Map();
    rows.forEach((row, index) => {
        const value = makeKey(row);
        if (!value) return;
        if (seen.has(value)) errors.push(`${label} 重复：${value}（第 ${seen.get(value) + 1}、${index + 1} 行）`);
        else seen.set(value, index);
    });
}

function assertConsistentAttrMappings(rows, errors) {
    const seen = new Map();
    rows.forEach((row, index) => {
        const legacyKey = key(row.legacyKey);
        if (!legacyKey || !key(row.statId)) return;
        const fields = ['domain', 'statId', 'operation', 'sourceUnit', 'scale', 'enabled', 'handlerKey'];
        if (['type', 'model', 'attackType'].includes(key(row.statId))) fields.push('priority');
        const signature = fields.map((field) => field === 'enabled'
            ? String(enabled(row)) : key(row[field])).join('\u0000');
        const previous = seen.get(legacyKey);
        if (previous && previous.signature !== signature) {
            errors.push(`pvpAttrMap.legacyKey 映射冲突：${legacyKey}（第 ${previous.index + 1}、${index + 1} 行）`);
        } else if (!previous) {
            seen.set(legacyKey, { signature, index });
        }
    });
}

/**
 * 校验客户端导表结果中“卡牌技能升级 -> 修改器 -> PVP 单位/技能/状态”的完整引用链。
 * 返回结构化结果，供命令行、CI 或编辑器扩展复用。
 */
export function validateSkillPipeline(clientDirectory, options = {}) {
    const directory = resolve(clientDirectory);
    const errors = [];
    const warnings = [];
    const tables = {};
    for (const name of REQUIRED_TABLES) tables[name] = readTable(directory, name, true, errors, warnings);
    tables.pvpSkillPlan = readTable(directory, 'pvpSkillPlan', false, errors, warnings);

    assertUnique(tables.pvpSkill, (row) => key(row.skillId), 'pvpSkill.skillId', errors);
    assertUnique(tables.pvpStatus, (row) => key(row.statusId), 'pvpStatus.statusId', errors);
    assertConsistentAttrMappings(tables.pvpAttrMap, errors);
    // 旧 J 表里已有少量重复 ID，运行时沿用“后行覆盖前行”。先告警兼容，
    // 新增的 PVP 计划/映射仍在下方按严格错误校验，避免存量问题阻断全量导表。
    assertUnique(tables.skillAttrModifier, (row) => key(row.id), 'skillAttrModifier.id（存量后行覆盖）', warnings);
    assertUnique(tables.armySkillLevelUp, (row) => `${key(row.id)}:${key(row.skilllevel)}`, 'armySkillLevelUp.id:skilllevel', errors);
    assertUnique(tables.pvpUnitGrowth, (row) => `${key(row.unitId)}:${key(row.level)}`, 'pvpUnitGrowth.unitId:level', errors);
    // skillAttr 存量表有重复 ID，老 Client/当前兼容层都按后行覆盖，保留为告警。
    assertUnique(tables.skillAttr, (row) => key(row.id), 'skillAttr.id（存量后行覆盖）', warnings);
    assertUnique(tables.skillView, (row) => key(row.skillId), 'skillView.skillId', errors);
    assertUnique(tables.skillBuff, (row) => key(row.key), 'skillBuff.key', errors);

    const skillIds = new Set(tables.pvpSkill.map((row) => key(row.skillId)).filter(Boolean));
    const unitIds = new Set(tables.pvpCard.map((row) => key(row.unitId)).filter(Boolean));
    const unitSkillById = new Map(tables.pvpCard
        .filter((row) => key(row.unitId))
        .map((row) => [key(row.unitId), key(row.unitSkillId)]));
    const statusIds = new Set(tables.pvpStatus.filter(enabled).map((row) => key(row.statusId)).filter(Boolean));
    const attrKeys = new Set(tables.pvpAttrMap.filter(enabled).map((row) => key(row.legacyKey)).filter(Boolean));
    const modifierIds = new Set(tables.skillAttrModifier.map((row) => key(row.id)).filter(Boolean));
    const plannedModifierIds = new Set(tables.pvpSkillPlan.filter(enabled).map((row) => key(row.modifierId)).filter(Boolean));
    const modifierById = new Map(tables.skillAttrModifier.map((row) => [key(row.id), row]));
    const legacySkillsByUnit = new Map();
    for (const star of tables.generalStar) {
        const unitId = key(star.id);
        if (!unitId) continue;
        const skills = legacySkillsByUnit.get(unitId) ?? new Set();
        for (const modifierId of numberList(star.modify)) {
            for (const operation of modifierById.get(key(modifierId))?.modify ?? []) {
                if (operation.type !== '添加武将') continue;
                for (const skillId of numberList(objectValue(operation.data).技能)) skills.add(key(skillId));
            }
        }
        legacySkillsByUnit.set(unitId, skills);
    }

    // 老 Client skillView -> skillEffect -> skillBuff -> pvpStatus 兼容链。
    const pvpSkillsById = new Map(tables.pvpSkill.map((row) => [key(row.skillId), row]));
    const referencedEffectKeys = new Map();
    const addEffectRefs = (values, profileId, field) => {
        for (const effectKey of stringList(values)) {
            const refs = referencedEffectKeys.get(effectKey) ?? [];
            refs.push(`${profileId}.${field}`);
            referencedEffectKeys.set(effectKey, refs);
        }
    };
    tables.skillView.forEach((row) => {
        const normalId = key(row.skillId);
        const normalProfile = pvpSkillsById.get(normalId);
        if (normalProfile) addEffectRefs(row.hurt, normalId, 'hurt');
        const empoweredId = key(row.exSkillId) || key(normalProfile?.empoweredSkillId);
        if (empoweredId && pvpSkillsById.has(empoweredId)) addEffectRefs(row.exHurt, empoweredId, 'exHurt');
    });

    const effectRowsByKey = new Map();
    tables.skillEffect.forEach((row, index) => {
        const effectKey = key(row.key);
        if (!effectKey) {
            errors.push(`skillEffect[${index}].key 为空`);
            return;
        }
        const grouped = effectRowsByKey.get(effectKey) ?? [];
        grouped.push({ row, index });
        effectRowsByKey.set(effectKey, grouped);
    });

    const buffByKey = new Map(tables.skillBuff.map((row) => [key(row.key), row]).filter(([buffKey]) => buffKey));
    const statusByLegacyKey = new Map(tables.pvpStatus.map((row) => [key(row.legacyBuffKey), row]).filter(([legacyKey]) => legacyKey));
    const disabledLegacyStatuses = new Set();
    for (const [effectKey, refs] of referencedEffectKeys) {
        const groups = effectRowsByKey.get(effectKey);
        if (!groups?.length) {
            errors.push(`skillView 引用的 skillEffect.key 不存在：${effectKey}（${refs.join(', ')}）`);
            continue;
        }
        groups.forEach(({ row, index }) => {
            if (!Array.isArray(row.effects)) {
                errors.push(`skillEffect[${index}].effects 不是数组：${effectKey}`);
                return;
            }
            row.effects.forEach((rawEffect, effectIndex) => {
                const effect = objectValue(rawEffect);
                const script = key(effect.script);
                const label = `skillEffect[${index}].effects[${effectIndex}]（${effectKey}）`;
                if (!LEGACY_RUNTIME_SCRIPTS.has(script) && !LEGACY_METADATA_SCRIPTS.has(script)) {
                    errors.push(`${label}.script 未进入 PVP 行为白名单：${script || '<空>'}`);
                    return;
                }
                if (!LEGACY_RUNTIME_SCRIPTS.has(script)) return;
                validateLegacyFormula(effect.condiction ?? effect.condition, `${label}.condition`, errors);
                const payload = objectValue(effect.effect);
                const formulaValues = script === 'buff' ? objectValue(payload.param) : payload;
                Object.entries(formulaValues).forEach(([name, value]) => {
                    validateLegacyFormula(value, `${label}.effect.${name}`, errors);
                });
                if (script !== 'buff') return;
                const legacyBuffKey = key(payload.id);
                if (!legacyBuffKey) {
                    errors.push(`${label}.effect.id 为空`);
                    return;
                }
                if (!buffByKey.has(legacyBuffKey)) errors.push(`${label} 引用的 skillBuff.key 不存在：${legacyBuffKey}`);
                const status = statusByLegacyKey.get(legacyBuffKey);
                if (!status) errors.push(`${label} 的 Buff 未在 pvpStatus.legacyBuffKey 映射：${legacyBuffKey}`);
                else if (!enabled(status)) disabledLegacyStatuses.add(legacyBuffKey);
            });
        });
    }
    if (disabledLegacyStatuses.size) {
        warnings.push(`以下老 Client Buff 已有 pvpStatus 映射但仍禁用，战斗会安全跳过：${[...disabledLegacyStatuses].sort().join('、')}`);
    }

    tables.skillAttr.forEach((row, index) => {
        if (row.type === 'number' && !Number.isFinite(Number(row.value))) {
            errors.push(`skillAttr[${index}].value 应为数字：${String(row.value)}（${key(row.key)}）`);
        }
    });
    tables.skillBuff.forEach((row, index) => {
        const params = objectValue(row.param);
        validateNonNegative(params['持续时间秒'], `skillBuff[${index}].param.持续时间秒`, errors, true);
        validateNonNegative(params['伤害间隔'], `skillBuff[${index}].param.伤害间隔`, errors);
        validateNonNegative(params['叠加上限'], `skillBuff[${index}].param.叠加上限`, errors);
    });

    tables.pvpSkillBinding.filter(enabled).forEach((row, index) => {
        if (!skillIds.has(key(row.pvpSkillId))) errors.push(`pvpSkillBinding[${index}].pvpSkillId 不存在：${row.pvpSkillId}`);
        if (!unitIds.has(key(row.targetUnitId))) errors.push(`pvpSkillBinding[${index}].targetUnitId 不存在：${row.targetUnitId}`);
        const currentSkillId = unitSkillById.get(key(row.targetUnitId));
        // 攻击结算按目标单位的普攻 skillId 查行为绑定；强化攻击也使用同一注册项。
        if (currentSkillId && key(row.pvpSkillId) !== currentSkillId) {
            const message = `pvpSkillBinding[${index}] 单位 ${row.targetUnitId} 绑定技能 ${row.pvpSkillId}，当前普攻技能是 ${currentSkillId}`;
            // 旧 generalStar 仍消费原英雄技能属性；保留其参数映射供构筑编译，
            // 但该绑定不会在当前普攻结算时触发，必须显式报告。
            if (legacySkillsByUnit.get(key(row.targetUnitId))?.has(key(row.pvpSkillId))) {
                warnings.push(`${message}（仅供旧升星构筑，当前攻击不会触发）`);
            } else {
                errors.push(message);
            }
        }
        if (key(row.parameterKey) && !attrKeys.has(key(row.parameterKey))) {
            warnings.push(`pvpSkillBinding[${index}].parameterKey 未在 pvpAttrMap 启用：${row.parameterKey}`);
        }
        if (key(row.statusId) && !statusIds.has(key(row.statusId))) errors.push(`pvpSkillBinding[${index}].statusId 不存在或未启用：${row.statusId}`);
    });

    tables.pvpModifierOverride.filter(enabled).forEach((row, index) => {
        const id = key(row.modifierId);
        if (id && !modifierIds.has(id) && !plannedModifierIds.has(id)) {
            errors.push(`pvpModifierOverride[${index}].modifierId 不存在：${id}`);
        }
        if (key(row.legacyKey) && !attrKeys.has(key(row.legacyKey))) {
            errors.push(`pvpModifierOverride[${index}].legacyKey 未映射或未启用：${row.legacyKey}`);
        }
        if (key(row.targetUnitId) && !unitIds.has(key(row.targetUnitId))) {
            errors.push(`pvpModifierOverride[${index}].targetUnitId 不存在：${row.targetUnitId}`);
        }
    });

    const armyModifierRefs = new Set();
    let emptyArmyModifiers = 0;
    tables.armySkillLevelUp.forEach((row, index) => {
        const ids = numberList(row.modfiy);
        if (!ids.length) emptyArmyModifiers += 1;
        ids.forEach((id) => {
            const idKey = key(id);
            armyModifierRefs.add(idKey);
            if (!modifierIds.has(idKey) && !plannedModifierIds.has(idKey)) {
                errors.push(`armySkillLevelUp[${index}].modfiy 引用不存在：${id}`);
            }
        });
    });

    const planKeys = new Set();
    tables.pvpSkillPlan.filter(enabled).forEach((row, index) => {
        const rowKey = `${key(row.unitId)}:${key(row.skillChainId)}:${key(row.skillLevel)}`;
        if (planKeys.has(rowKey)) errors.push(`pvpSkillPlan 升级档重复：${rowKey}`);
        planKeys.add(rowKey);
        if (!unitIds.has(key(row.unitId))) errors.push(`pvpSkillPlan[${index}].unitId 不存在：${row.unitId}`);
        if (key(row.pvpSkillId) && !skillIds.has(key(row.pvpSkillId))) errors.push(`pvpSkillPlan[${index}].pvpSkillId 不存在：${row.pvpSkillId}`);
        const currentSkillId = unitSkillById.get(key(row.unitId));
        if (currentSkillId && key(row.pvpSkillId) && key(row.pvpSkillId) !== currentSkillId) {
            errors.push(`pvpSkillPlan[${index}] 单位 ${row.unitId} 升级技能 ${row.pvpSkillId}，当前普攻技能是 ${currentSkillId}`);
        }
        if (key(row.statusId) && !statusIds.has(key(row.statusId)) && !key(row.statusStatJson)) {
            errors.push(`pvpSkillPlan[${index}].statusId 未在 pvpStatus 定义，且本行没有 statusStatJson：${row.statusId}`);
        }
        if (key(row.modifierId) && !armyModifierRefs.has(key(row.modifierId))) {
            warnings.push(`pvpSkillPlan[${index}].modifierId 尚未被 armySkillLevelUp.modfiy 引用：${row.modifierId}`);
        }
    });

    if (emptyArmyModifiers) warnings.push(`armySkillLevelUp 有 ${emptyArmyModifiers} 行 modfiy 为空；基础/未接入行允许为空`);
    if (!tables.pvpSkillPlan.length) warnings.push('未导出 pvpSkillPlan.json；旧表仍可运行，但无法校验技能升级闭环');

    if (options.serverDirectory) {
        const serverRows = readTable(resolve(options.serverDirectory), 'armySkillLevelUp', true, errors, warnings);
        if (serverRows.length && !serverRows.some((row) => key(row.skilllevel))) {
            errors.push('服务端 armySkillLevelUp.json 缺少 skilllevel 字段');
        }
    }

    return {
        ok: errors.length === 0,
        directory,
        errors,
        warnings,
        counts: Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length])),
    };
}

export function printValidationResult(result) {
    const prefix = result.ok ? '通过' : '失败';
    console.log(`[技能配置校验] ${prefix}：${result.directory}`);
    console.log(`[技能配置校验] 表行数：${Object.entries(result.counts).map(([name, count]) => `${name}=${count}`).join(', ')}`);
    for (const warning of result.warnings) console.warn(`[警告] ${warning}`);
    for (const error of result.errors) console.error(`[错误] ${error}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const clientDirectory = process.argv[2] || resolve(process.cwd(), 'assets', 'remoteRef');
    const result = validateSkillPipeline(clientDirectory);
    printValidationResult(result);
    process.exitCode = result.ok ? 0 : 1;
}
