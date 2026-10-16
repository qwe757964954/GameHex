/**
 * 旧塔防 skillAttrModifier 的占城兼容执行器。
 *
 * 这里保留旧表的「一个 id 对应多条 modify」语义：属性型修改立即写入属性包，
 * 结构/行为型修改转换成命令，交给后续占城技能系统逐项实现。
 */

export type ZCModifierType =
    | '卡牌进卡池'
    | '修改属性'
    | '增加buff'
    | '挂载buff'
    | '添加兵种buff'
    | '添加拒马buff'
    | '添加兵种buff列表'
    | '替换属性'
    | '使用卡牌'
    | '修改兵种'
    | '添加兵种'
    | '添加召唤物'
    | '添加武将'
    | '添加近卫'
    | '添加主公技'
    | '添加技能'
    | '修改技能'
    | '替换初始卡牌'
    | '修改射程'
    | '出场携带'
    | '开局招募'
    | '替换描述'
    | '修改皮肤'
    | '修改出兵'
    | string;

export interface ZCModifierOperation {
    type: ZCModifierType;
    /** 旧表大多数是对象；`添加兵种buff列表` 等少数类型直接使用数组。 */
    data: unknown;
}

export interface ZCModifierRecord {
    id: number;
    modify: readonly ZCModifierOperation[];
    name?: string;
    desc?: string;
}

export interface ZCGeneralStarRecord {
    id: number;
    star: number;
    modify: readonly number[];
    impactData: readonly number[];
}

export interface ZCModifierCommand {
    modifierId: number;
    type: ZCModifierType;
    data: unknown;
}

export interface ZCModifierExecutionResult {
    attributes: Readonly<Record<string, unknown>>;
    commands: readonly ZCModifierCommand[];
    appliedModifierIds: readonly number[];
}

export type ZCModifierHandler = (
    modifierId: number,
    operation: ZCModifierOperation,
    state: { attributes: Record<string, unknown>; commands: ZCModifierCommand[] },
) => void;

function asObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function asNumberArray(value: unknown): number[] {
    return Array.isArray(value)
        ? value.map(Number).filter((item) => Number.isFinite(item))
        : [];
}

function asOperations(value: unknown): ZCModifierOperation[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
        const raw = asObject(item);
        if (typeof raw.type !== 'string' || !raw.type) return [];
        return [{ type: raw.type, data: raw.data }];
    });
}

/** 合并 J 表中相同 id 的多行，保持首次出现的 id 顺序和每行 modify 顺序。 */
export function mergeSkillAttrModifierRows(rows: readonly Record<string, unknown>[]): Map<number, ZCModifierRecord> {
    const result = new Map<number, ZCModifierRecord>();
    for (const row of rows) {
        const id = Number(row.id);
        if (!Number.isFinite(id)) continue;
        const operations = asOperations(row.modify);
        const existing = result.get(id);
        if (existing) {
            result.set(id, { ...existing, modify: [...existing.modify, ...operations] });
        } else {
            result.set(id, {
                id,
                modify: operations,
                name: typeof row.name === 'string' ? row.name : undefined,
                desc: typeof row.desc === 'string' ? row.desc : undefined,
            });
        }
    }
    return result;
}

export function indexGeneralStarRows(rows: readonly Record<string, unknown>[]): Map<string, ZCGeneralStarRecord> {
    const result = new Map<string, ZCGeneralStarRecord>();
    for (const row of rows) {
        const id = Number(row.id);
        const star = Number(row.star);
        if (!Number.isFinite(id) || !Number.isFinite(star)) continue;
        result.set(`${id}:${star}`, {
            id,
            star,
            modify: asNumberArray(row.modify),
            impactData: asNumberArray(row.impactData),
        });
    }
    return result;
}

/** 可注册占城专用处理器；未注册的旧行为会保留成命令，不会静默丢失。 */
export class ZCModifierExecutor {
    private readonly handlers = new Map<string, ZCModifierHandler>();

    constructor() {
        this.register('修改属性', (modifierId, operation, state) => {
            for (const [key, value] of Object.entries(asObject(operation.data))) {
                if (typeof value === 'number' && typeof state.attributes[key] === 'number') {
                    state.attributes[key] = Number(state.attributes[key]) + value;
                } else if (typeof value === 'number' && state.attributes[key] == null) {
                    state.attributes[key] = value;
                } else {
                    state.attributes[key] = value;
                }
            }
        });
        this.register('替换属性', (_modifierId, operation, state) => {
            Object.assign(state.attributes, asObject(operation.data));
        });
    }

    register(type: ZCModifierType, handler: ZCModifierHandler): this {
        this.handlers.set(type, handler);
        return this;
    }

    execute(
        modifierIds: readonly number[],
        catalog: ReadonlyMap<number, ZCModifierRecord>,
        initialAttributes: Readonly<Record<string, unknown>> = {},
    ): ZCModifierExecutionResult {
        const state = { attributes: { ...initialAttributes }, commands: [] as ZCModifierCommand[] };
        const appliedModifierIds: number[] = [];
        for (const modifierId of modifierIds) {
            const record = catalog.get(modifierId);
            if (!record) throw new Error(`[ZCModifierEngine] 找不到修改器 ${modifierId}`);
            appliedModifierIds.push(modifierId);
            for (const operation of record.modify) {
                const handler = this.handlers.get(operation.type);
                if (handler) handler(modifierId, operation, state);
                else state.commands.push({ modifierId, type: operation.type, data: operation.data });
            }
        }
        return { attributes: state.attributes, commands: state.commands, appliedModifierIds };
    }
}

/** 执行武将指定星级的出战修改器与升星影响数据。 */
export function executeGeneralStarModifiers(
    generalId: number,
    star: number,
    generalStars: ReadonlyMap<string, ZCGeneralStarRecord>,
    modifierCatalog: ReadonlyMap<number, ZCModifierRecord>,
    executor = new ZCModifierExecutor(),
): ZCModifierExecutionResult {
    const row = generalStars.get(`${generalId}:${star}`);
    if (!row) return { attributes: {}, commands: [], appliedModifierIds: [] };
    return executor.execute([...row.modify, ...row.impactData], modifierCatalog);
}
