/**
 * 《占城大师》skillAttrModifier → 占城 effect 翻译层（ZCModifierMapper）。
 *
 * 依据：skillAttrModifier映射清单_20260918.md（19 个未注册 type 的映射判定）。
 * 职责：把 ZCModifierEngine 输出的 ZCModifierCommand（字符串 type + 自由 data）
 *       翻译成占城强类型 effect（判别联合），供消费方（ZCGameModel 对局启动 / 状态系统）直接消费。
 *
 * 设计约束：
 * - **纯函数**：不读表、不碰引擎状态，可单测；中文名 → 单位/卡 id 的解析通过
 *   resolvers 注入（占城 pvpCard 的 name 列在运行时由接入方提供）。
 * - **一条命令可产出多条 effect**：如「添加主公技」按拍板双落点产出 heroSkill + artifactSkill；
 *   「添加召唤物」产出 addUnit + 召唤物定时消失的 addStatus。
 * - **可忽略项显式落 'ignored'**：不静默丢弃，给 reason 可审计。
 * - 已注册的「修改属性 / 替换属性」不经过这里（引擎直接处理），但 classify 覆盖检查仍统计它们。
 *
 * 本文件只依赖 TS 标准库 + ZCModifierEngine 的类型，不依赖 Cocos API。
 */

import type { ZCModifierCommand } from './ZCModifierEngine';


// 占城 effect 判别联合


export type ZCMappedEffectKind =
    | 'statModify'          // 修改属性 / 替换属性 → 属性包（引擎已注册路径，透传）
    | 'cardToPool'          // 卡牌进卡池 → 初始卡池加卡
    | 'addUnit'             // 添加兵种 / 武将 / 近卫 / 召唤物 → 单位入卡池/卡组
    | 'useInitialCard'      // 使用卡牌 → 开局初始卡
    | 'replaceInitialCard'  // 替换初始卡牌 → 开局卡组替换
    | 'initialRecruit'      // 开局招募 → 对局启动生成单位
    | 'deployPosition'      // 修改出兵 → 出生位置（bornType）
    | 'replaceUnit'         // 修改兵种 → 单位转职/替换
    | 'setSkill'            // 添加技能 → 覆盖单位普攻/技能
    | 'heroSkill'           // 添加主公技 → 英雄主动技能（落点一）
    | 'artifactSkill'       // 添加主公技 → 神器（落点二）
    | 'addStatus'           // buff 类 → 状态系统 ZCStatusEffect
    | 'ignored';            // 可忽略（塔防遗留 / 表现层 / 脏数据 / 数值在别行）

export interface ZCMappedEffectBase {
    kind: ZCMappedEffectKind;
    /** 来源 modifier id（skillAttrModifier 行 id），全链路溯源。 */
    modifierId: number;
    notes?: string;
}

export type ZCMappedEffect =
    | (ZCMappedEffectBase & { kind: 'statModify'; data: Readonly<Record<string, unknown>> })
    | (ZCMappedEffectBase & { kind: 'cardToPool'; cardName: string })
    | (ZCMappedEffectBase & {
          kind: 'addUnit';
          /** 占城单位 id（= pvpCard 卡行的 `unitId`）；resolvers 无法解析时为 undefined。 */
          unitId?: string;
          unitName?: string;
          /** 招募数量（旧表「招募」键）。 */
          count?: number;
          /** 旧表「技能」id 列表（30011 等，供接入方挂 ZCAttackProfile 用）。 */
          skillIds?: readonly number[];
      })
    | (ZCMappedEffectBase & { kind: 'useInitialCard'; cardName: string })
    | (ZCMappedEffectBase & { kind: 'replaceInitialCard'; cardName: string })
    | (ZCMappedEffectBase & { kind: 'initialRecruit'; unitName: string; count: number })
    | (ZCMappedEffectBase & { kind: 'deployPosition'; unitName: string; bornType: number })
    | (ZCMappedEffectBase & {
          kind: 'replaceUnit';
          fromUnitName?: string;
          toUnitId?: string;
          toUnitName?: string;
          skillIds?: readonly number[];
      })
    | (ZCMappedEffectBase & { kind: 'setSkill'; unitName?: string; skillId: number })
    | (ZCMappedEffectBase & { kind: 'heroSkill'; skillId: number })
    | (ZCMappedEffectBase & { kind: 'artifactSkill'; skillId: number })
    | (ZCMappedEffectBase & { kind: 'addStatus'; statusName: string; unitName?: string; stacks?: number })
    | (ZCMappedEffectBase & { kind: 'ignored'; reason: string });


// 解析器注入（中文名 → 占城 id）


export interface ZCModifierResolvers {
    /** 中文兵种/单位名 → pvpCard 的 `unitId`（如 '冰法师' → '68011'）；返回 undefined 表示未解析。 */
    unitIdByName?: (name: string) => string | undefined;
    /** 中文卡名 → pvpCard.id；返回 undefined 表示未解析。 */
    cardIdByName?: (name: string) => string | undefined;
}


// data 解析辅助（旧表 data 是宽松 Record<string, unknown>）


function asString(value: unknown, key: string): string | undefined {
    return typeof value === 'string' && value ? value : undefined;
}

function asNumberArray(value: unknown): readonly number[] {
    if (!Array.isArray(value)) return [];
    return value.map(Number).filter((item) => Number.isFinite(item));
}

function asNumber(value: unknown): number | undefined {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
}

function asObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

/** 保留 kind 字面量类型，使展开后的对象可赋值给 ZCMappedEffect 联合对应成员。 */
function base<K extends ZCMappedEffectKind>(cmd: ZCModifierCommand, kind: K): ZCMappedEffectBase & { kind: K } {
    return { kind, modifierId: cmd.modifierId };
}


// 主映射


/**
 * 把一条 command 翻译成 0..n 条占城 effect。
 *
 * @param cmd ZCModifierEngine 输出的命令（type 未注册 → commands；已注册 type 不会走到这）。
 * @param resolvers 中文名 → 占城 id 的解析器（可缺省；缺省时 unitId/cardId 为 undefined，由接入方补）。
 */
export function mapModifierCommand(
    cmd: ZCModifierCommand,
    resolvers: ZCModifierResolvers = {},
): ZCMappedEffect[] {
    const rawData = cmd.data;
    const data = asObject(rawData);
    switch (cmd.type) {
        case '卡牌进卡池': {
            const cardName = asString(data['卡牌'], '卡牌');
            if (!cardName) return [ignored(cmd, '卡牌进卡池缺少 data.卡牌')];
            return [{ ...base(cmd, 'cardToPool'), cardName }];
        }
        case '使用卡牌': {
            const cardName = asString(data['卡牌'], '卡牌');
            if (!cardName) return [ignored(cmd, '使用卡牌缺少 data.卡牌')];
            return [{ ...base(cmd, 'useInitialCard'), cardName }];
        }
        case '替换初始卡牌': {
            const cardName = asString(data['卡牌'], '卡牌');
            if (!cardName) return [ignored(cmd, '替换初始卡牌缺少 data.卡牌')];
            return [{ ...base(cmd, 'replaceInitialCard'), cardName }];
        }
        case '添加兵种':
        case '添加武将':
        case '添加近卫': {
            const unitName = asString(data['兵种'], '兵种');
            const monsterId = asNumber(data['monster']);
            const count = asNumber(data['招募']);
            const skillIds = asNumberArray(data['技能']);
            const resolved = monsterId != null
                ? String(monsterId)
                : (unitName ? resolvers.unitIdByName?.(unitName) : undefined);
            const result: ZCMappedEffect = {
                ...base(cmd, 'addUnit'),
                unitId: resolved,
                unitName,
                count,
                skillIds: skillIds.length ? skillIds : undefined,
                notes: `旧type=${cmd.type}`,
            };
            return [result];
        }
        case '添加召唤物': {
            const unitName = asString(data['兵种'], '兵种');
            const monsterId = asNumber(data['monster']);
            const count = asNumber(data['招募']);
            const skillIds = asNumberArray(data['技能']);
            const resolved = monsterId != null
                ? String(monsterId)
                : (unitName ? resolvers.unitIdByName?.(unitName) : undefined);
            const effects: ZCMappedEffect[] = [{
                ...base(cmd, 'addUnit'),
                unitId: resolved,
                unitName,
                count,
                skillIds: skillIds.length ? skillIds : undefined,
                notes: '召唤物单位',
            }];
            // 召唤物常带「定时消失」状态：一并产出 addStatus，接入方决定是否施加。
            const vanishBuff = asString(data['buff'], 'buff');
            if (vanishBuff) {
                effects.push({ ...base(cmd, 'addStatus'), statusName: vanishBuff, unitName });
            }
            return effects;
        }
        case '修改兵种': {
            const fromUnitName = asString(data['兵种'], '兵种');
            const toUnitName = asString(data['展示兵种'], '展示兵种');
            const monsterId = asNumber(data['monster']);
            const skillIds = asNumberArray(data['技能']);
            const resolved = monsterId != null
                ? String(monsterId)
                : (toUnitName ? resolvers.unitIdByName?.(toUnitName) : undefined);
            return [{
                ...base(cmd, 'replaceUnit'),
                fromUnitName,
                toUnitId: resolved,
                toUnitName,
                skillIds: skillIds.length ? skillIds : undefined,
            }];
        }
        case '添加技能': {
            const unitName = asString(data['兵种'], '兵种');
            const skillIds = asNumberArray(data['技能']);
            if (!skillIds.length) return [ignored(cmd, '添加技能缺少 data.技能')];
            return [{ ...base(cmd, 'setSkill'), unitName, skillId: skillIds[0] }];
        }
        case '添加主公技': {
            const skillIds = asNumberArray(data['技能']);
            if (!skillIds.length) return [ignored(cmd, '添加主公技缺少 data.技能')];
            const skillId = skillIds[0];
            // 拍板：双落点 —— 英雄主动技能 + 神器
            return [
                { ...base(cmd, 'heroSkill'), skillId },
                { ...base(cmd, 'artifactSkill'), skillId },
            ];
        }
        case '开局招募': {
            const unitName = asString(data['兵种'], '兵种');
            const count = asNumber(data['数目']) ?? 1;
            if (!unitName) return [ignored(cmd, '开局招募缺少 data.兵种')];
            return [{ ...base(cmd, 'initialRecruit'), unitName, count }];
        }
        case '修改出兵': {
            const unitName = asString(data['兵种'], '兵种');
            const attr = asObject(data['attr']);
            const bornType = asNumber(attr['bornType']) ?? 0;
            return [{ ...base(cmd, 'deployPosition'), unitName: unitName ?? '', bornType }];
        }
        case '添加兵种buff':
        case '增加buff':
        case '添加兵种buff列表': {
            const effects: ZCMappedEffect[] = [];
            // 列表型：data 直接是数组（[ {buff,兵种}, ... ]）
            if (Array.isArray(rawData)) {
                for (const item of rawData) {
                    const entry = asObject(item);
                    const statusName = asString(entry['buff'], 'buff') ?? asString(entry['buffid'], 'buffid');
                    if (!statusName) {
                        effects.push(ignored(cmd, '添加兵种buff列表存在缺少 buff/buffid 的条目'));
                        continue;
                    }
                    effects.push({
                        ...base(cmd, 'addStatus'),
                        statusName,
                        unitName: asString(entry['兵种'], '兵种'),
                    });
                }
                return effects;
            }
            const statusName = asString(data['buff'], 'buff') ?? String(asNumber(data['buffid']) ?? '');
            if (!statusName) return [ignored(cmd, `${cmd.type}缺少 data.buff/buffid`)];
            return [{
                ...base(cmd, 'addStatus'),
                statusName,
                unitName: asString(data['兵种'], '兵种'),
                notes: cmd.type === '增加buff' ? 'buffid 状态' : undefined,
            }];
        }
        case '修改皮肤': {
            return [ignored(cmd, '表现层（prefabPath 换皮），不阻塞对局逻辑')];
        }
        case '添加拒马buff': {
            return [ignored(cmd, '拒马是塔防专属单位，占城无载体；状态系统建成后可直接复用')];
        }
        case '出场携带': {
            return [ignored(cmd, '伴生单位机制（携带战鹰/猛虎），延后 / 用召唤物表达')];
        }
        case '修改射程': {
            return [ignored(cmd, 'data 无内联数值（射程数值由同 id 的修改属性行承载），接入时按单位定义核对')];
        }
        case '': {
            return [ignored(cmd, '空 type（源头脏数据，modify 无内容）')];
        }
        default:
            return [ignored(cmd, `未识别的 type：${cmd.type}（映射清单未覆盖）`)];
    }
}

function ignored(cmd: ZCModifierCommand, reason: string): ZCMappedEffect {
    return { ...base(cmd, 'ignored'), reason };
}

export type ZCModifierCoverageStatus = 'registered' | 'mapped' | 'ignored' | 'unknown';

export interface ZCModifierCoverageEntry {
    type: string;
    status: ZCModifierCoverageStatus;
    /** ignored 时的理由 / mapped 时的 effect kind 集合。 */
    detail: string;
}

/**
 * 闭环检查：把表里出现的 type 集合过一遍，返回每个 type 的实现状态。
 * 接入方（启动阶段）调用：表中出现 'unknown' → 报错；'mapped/registered' → 已实现；'ignored' → 显式忽略。
 */
export function classifyModifierTypes(typesInTable: readonly string[]): ZCModifierCoverageEntry[] {
    const seen = new Set<string>();
    const entries: ZCModifierCoverageEntry[] = [];
    for (const type of typesInTable) {
        const key = type ?? '';
        if (seen.has(key)) continue;
        seen.add(key);
        switch (key) {
            case '修改属性':
            case '替换属性':
                entries.push({ type: key, status: 'registered', detail: 'ZCModifierExecutor 已注册处理器' });
                break;
            case '卡牌进卡池':
            case '使用卡牌':
            case '替换初始卡牌':
            case '添加兵种':
            case '添加武将':
            case '添加近卫':
            case '添加召唤物':
            case '修改兵种':
            case '添加技能':
            case '添加主公技':
            case '开局招募':
            case '修改出兵':
            case '添加兵种buff':
            case '增加buff':
            case '添加兵种buff列表':
                entries.push({ type: key, status: 'mapped', detail: 'ZCModifierMapper 已翻译' });
                break;
            case '修改皮肤':
                entries.push({ type: key, status: 'ignored', detail: '表现层，不阻塞对局逻辑' });
                break;
            case '添加拒马buff':
                entries.push({ type: key, status: 'ignored', detail: '塔防专属单位，占城无载体' });
                break;
            case '出场携带':
                entries.push({ type: key, status: 'ignored', detail: '伴生单位机制，延后' });
                break;
            case '修改射程':
                entries.push({ type: key, status: 'ignored', detail: '数值由同 id 修改属性行承载' });
                break;
            case '':
                entries.push({ type: '(empty)', status: 'ignored', detail: '源头脏数据，待修 xlsx' });
                break;
            default:
                entries.push({ type: key, status: 'unknown', detail: '映射清单未覆盖，需人工核对' });
                break;
        }
    }
    return entries;
}

/** 便捷检查：表里 type 集合中是否存在未覆盖项。 */
export function hasUncoveredModifierTypes(entries: readonly ZCModifierCoverageEntry[]): boolean {
    return entries.some((entry) => entry.status === 'unknown');
}
