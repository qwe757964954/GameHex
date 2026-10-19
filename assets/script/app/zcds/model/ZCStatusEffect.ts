/**
 * 《占城大师》状态系统（ZCStatusEffect）。
 *
 * 服务对象：
 * - 旧塔防 skillAttrModifier 的 buff 类指令（添加兵种buff / 增加buff / 添加兵种buff列表）
 *   经 ZCModifierMapper 翻译后落地到这里；
 * - 占城未来玩法自有的 buff / 状态需求。
 *
 * 设计要点：
 * - **定义（Def）与实例（Instance）分离**：Def 是表驱动的只读配置，Instance 是对局内运行时；
 * - **独立维护，不塞进 ZCUnitState**：单位实例由 ZCGameModel 持有本系统，按战斗实例 id 索引，
 *   通过独立 statusEffects 快照块保存，不污染单位核心字段；
 * - **数值修正聚合**：多个状态同时作用时，flat 修正相加，pct 修正相加（与旧表
 *   「伤害+80%，每层+10%」的叠加语义一致），由结算方在读取属性时调用；
 * - **行为钩子**：连击 / 周期效果等行为型状态通过 behavior 声明，由战斗事件流触发。
 *
 * 本文件运行期只依赖 TS 标准库，不依赖 Cocos API，可独立单测
 * （`ZCOwner` 是 `import type`，编译后不产生 require 边）。
 */

import type { ZCOwner } from './ZCMapConfig';


// 数值修正：映射到占城单位属性（ZCUnitDefinition）


/**
 * 状态对单位属性的数值修正。
 *
 * pct 语义：旧表是「百分比加成」叠加（+80% 再 +10% = +90%），
 * 因此这里 pct 字段统一按「直接相加」聚合（80 表示 +80%，-19 表示 -19%），
 * 不做乘算，避免与表口径漂移。
 */
export interface ZCStatusStatMods {
    /** 攻击力固定值修正（正=加，负=减）。 */
    attackFlat?: number;
    /** 攻击力百分比修正（80 = +80%）。 */
    attackPct?: number;
    /** 生命上限百分比修正。 */
    maxHpPct?: number;
    /** 移速百分比修正。 */
    moveSpeedPct?: number;
    /** 攻击距离百分比修正。 */
    attackRangePct?: number;
    /** 攻击间隔百分比修正（正值 = 间隔缩短，20 = -20% 间隔 = 攻速提升）。 */
    attackIntervalPct?: number;
    /** 闪避概率（0~1，表里 20% → 0.2）。 */
    dodgePct?: number;
    /** 暴击率（0~1）。 */
    critPct?: number;
    /** 暴击伤害百分比修正（50 = +50% 暴伤）。 */
    critDamagePct?: number;
    /** 受到伤害百分比修正（25 = 受到的伤害 +25%，-10 = -10%）；在受伤结算时一次性乘算。 */
    damageTakenPct?: number;
}

/** 硬控类别：受控单位不能移动/攻击/施放，差异主要在视觉表现（详见 ZCUnitSystem 受控闸门）。 */
export const ZCControlKind = {
    Stun: 'stun',
    Freeze: 'freeze',
    Paralysis: 'paralysis',
    Blind: 'blind',
} as const;
export type ZCControlKind = (typeof ZCControlKind)[keyof typeof ZCControlKind];


/** 周期效果的结算方式：伤害 / 治疗。 */
export const ZCStatusEffectKind = {
    Damage: 'damage',
    Heal: 'heal',
} as const;
export type ZCStatusEffectKind = (typeof ZCStatusEffectKind)[keyof typeof ZCStatusEffectKind];

/** 周期结算基准：目标最大生命 或 施加者攻击力。 */
export const ZCStatusBasis = {
    TargetMaxHp: 'targetMaxHp',
    SenderAttack: 'senderAttack',
} as const;
export type ZCStatusBasis = (typeof ZCStatusBasis)[keyof typeof ZCStatusBasis];


// 行为钩子（行为型 buff）


/**
 * 行为型状态的钩子声明。具体结算由战斗事件流（ZCGameModel）按 kind 分发；
 * 本文件只负责定义与携带，不实现结算，避免状态系统反向依赖战斗模型。
 */
export type ZCStatusBehavior =
    /** 纯数值状态，无行为钩子。 */
    | { kind: 'none' }
    /** 连击：每 N 次攻击额外触发一次伤害（额外伤害 = 攻击力 × extraDamagePct%）。 */
    | { kind: 'extraHit'; everyNAttacks: number; extraDamagePct: number }
    /** 周期效果：每 intervalSeconds 秒结算一次 amountPct（%）的伤害/治疗。 */
    | {
        kind: 'periodic';
        intervalSeconds: number;
        effect: ZCStatusEffectKind;
        /** 每周期百分比数值（1 = 1%）。 */
        amountPct: number;
        /** 结算基准：目标最大生命 或 施加者攻击力。 */
        basis: ZCStatusBasis;
        /** 单次结算封顶 = 施加者攻击力 × 该倍数；缺省不封顶。 */
        capAttackMultiplier?: number;
    }
    /** 附带效果：攻击命中时按 chancePct 概率附加效果（冻结/麻痹/点燃等，由效果表名标识）。 */
    | { kind: 'onHitAppend'; chancePct: number; effectName: string }
    /** 条件触发：满足 condition 时一次性执行（如「拒马血量低于 25%」），执行后移除。 */
    | { kind: 'conditionalOneShot'; condition: string; effectName: string }
    /** 占位：旧表行为无法归类时挂此钩子，由接入方显式实现后替换。 */
    | { kind: 'custom'; key: string };

/** Per-instance behavior frozen from legacy skillEffect/skillBuff parameters. */
export type ZCStatusRuntimeBehavior =
    | {
        kind: 'legacyDot';
        intervalSeconds: number;
        /** Direct damage per stack, already based on the cast-time sender attack. */
        flatDamagePerStack: number;
        /** Optional target-max-HP damage per stack (1 = 1%). */
        targetMaxHpPctPerStack: number;
        capAttackMultiplier?: number;
        senderAttack: number;
        sourceOwner: ZCOwner;
        /** Old bleed blood-explosion: add this flat damage every N periodic ticks. */
        extraEveryTicks?: number;
        extraFlatDamage?: number;
    }
    | {
        /** Aura carried by the caster; pulls hostile units in range every fixed simulation step. */
        kind: 'legacyTraction';
        range: number;
        speed: number;
    };


// 定义与实例

/**
 * 重复施加时的刷新策略取值真源。
 *
 * 与 `ZCSkillStateMode` 同样处理：`as const` 数组 + 派生类型，给配置表校验用同一份集合，
 * 别在 `ZCStatSchema` 里再手写 `['refresh','extend','keep']`。
 */
export const ZCStatusRefreshPolicy = {
    Refresh: 'refresh',
    Extend: 'extend',
    Keep: 'keep',
} as const;
export type ZCStatusRefreshPolicy = (typeof ZCStatusRefreshPolicy)[keyof typeof ZCStatusRefreshPolicy];


export interface ZCStatusEffectDef {
    /** 稳定 id：旧表按 buff 名（如 '弓兵攻击相同目标伤害增加'）或 buffid 数字；占城新表自定。 */
    id: string;
    name: string;
    description?: string;
    /** 持续时间（秒）；缺省或 0 = 永久（持续到对局结束/被移除）。 */
    durationSeconds?: number;
    /** 叠加上限；缺省 1。 */
    maxStacks?: number;
    /** 重复施加时是否刷新剩余时间（默认 true）。 */
    refreshOnReapply?: boolean;
    /** 新表优先使用的刷新策略；兼容字段 refreshOnReapply 仍可读取。 */
    refreshPolicy?: ZCStatusRefreshPolicy;
    statMods?: ZCStatusStatMods;
    behavior?: ZCStatusBehavior;
    /** 硬控类别；非空时单位进入受控（停止一切行动），由单位状态机闸门处理。 */
    control?: ZCControlKind;
    /** 来源旧表 type（'添加兵种buff' 等），溯源/排障用。 */
    sourceType?: string;
    /** 适用目标提示：旧表 data 里的「兵种」键（'弓兵'），供接入方决定挂到哪些单位。 */
    targetUnitHint?: string;
}

export interface ZCStatusInstance {
    /** 实例唯一 id（对局内自增）。 */
    uid: number;
    defId: string;
    stacks: number;
    /** 剩余秒数；null = 永久。 */
    remainingSeconds: number | null;
    /** 施加时刻（对局内秒，由 tick 驱动更新）。 */
    appliedAt: number;
    /** 来源 modifier id（skillAttrModifier 的行 id），溯源用。 */
    sourceModifierId?: number;
    /** 施加者单位 id（periodic 按施加者攻击力结算/封顶时使用）。 */
    sourceUnitId?: string;
    /** 上一次周期触发的对局时刻；缺省时首次触发 = appliedAt + intervalSeconds。 */
    lastFiredAt?: number;
    /** Number of periodic settlements already emitted; persisted for bleed extra-hit cadence. */
    periodicCount?: number;
    /** Independent remaining lifetime of each legacy DOT stack. */
    stackRemainingSeconds?: number[];
    /** Dynamic legacy behavior parameters frozen at application time. */
    runtimeBehavior?: ZCStatusRuntimeBehavior;
}

export interface ZCStatusSystemSnapshot {
    nextUid: number;
    units: Array<{ unitId: string; instances: ZCStatusInstance[] }>;
}


// 状态系统


const DEFAULT_MAX_STACKS = 1;

export interface ZCStatusApplyOptions {
    stacks?: number;
    /** Overrides the registered stack cap for dynamic legacy buff parameters. */
    maxStacks?: number;
    sourceModifierId?: number;
    /** 施加者单位 id（periodic 状态记录来源，用于按攻击力结算/封顶）。 */
    sourceUnitId?: string;
    /** 当前对局时刻（秒）；缺省 0。 */
    at?: number;
    /** Overrides the registered duration for this concrete status instance. */
    durationSeconds?: number;
    /** Runtime behavior override for this concrete legacy status instance. */
    runtimeBehavior?: ZCStatusRuntimeBehavior;
    /** Legacy burn/bleed/rend stacks expire independently instead of refreshing as one block. */
    independentStackDuration?: boolean;
}

export interface ZCStatusApplyResult {
    applied: boolean;
    reason?: 'unknown-def' | 'max-stacks';
}

/** 周期结算事件：状态系统只产出事件，由状态结算 System 换算实际伤害/治疗，避免反向依赖。 */
export interface ZCPeriodicEvent {
    targetId: string;
    defId: string;
    sourceUnitId?: string;
    stacks: number;
    effect: ZCStatusEffectKind;
    amountPct: number;
    basis: ZCStatusBasis;
    capAttackMultiplier?: number;
    /** Legacy DOT direct damage per stack, already frozen against cast-time attack. */
    flatDamagePerStack?: number;
    senderAttack?: number;
    /** Extra flat damage fired on the configured bleed tick. */
    extraFlatDamage?: number;
    sourceOwner?: ZCOwner;
}

/**
 * 状态系统：按 unitId 维护单位实例集合，提供 注册 / 施加 / 移除 / 过期结算 / 修正聚合。
 *
 * 注意：本系统只管理「状态」，不读单位属性——聚合结果由消费方取走后自行应用，
 * 避免系统间循环依赖。
 */
export class ZCStatusSystem {
    private readonly defs = new Map<string, ZCStatusEffectDef>();
    /** unitId（ZCUnitId 字符串）→ 该单位的全部状态实例（按施加顺序）。 */
    private readonly instances = new Map<string, ZCStatusInstance[]>();
    private nextUid = 1;

    

    register(def: ZCStatusEffectDef): this {
        if (this.defs.has(def.id)) {
            throw new Error(`[ZCStatusSystem] 状态定义重复注册：${def.id}`);
        }
        this.defs.set(def.id, { ...def, behavior: def.behavior ?? { kind: 'none' } });
        return this;
    }

    hasDef(defId: string): boolean {
        return this.defs.has(defId);
    }

    getDef(defId: string): ZCStatusEffectDef | undefined {
        return this.defs.get(defId);
    }

    /** 全部已注册定义（仅供启动检查/调试）。 */
    allDefs(): readonly ZCStatusEffectDef[] {
        return Array.from(this.defs.values());
    }

    // ---- 实例管理 ----

    apply(unitId: string, defId: string, options: ZCStatusApplyOptions = {}): ZCStatusApplyResult {
        const def = this.defs.get(defId);
        if (!def) return { applied: false, reason: 'unknown-def' };

        const at = options.at ?? 0;
        const addStacks = Math.max(1, options.stacks ?? 1);
        const current = this.instances.get(unitId) ?? [];
        const existing = current.find((inst) => inst.defId === defId);

        if (existing) {
            const maxStacks = options.maxStacks ?? def.maxStacks ?? DEFAULT_MAX_STACKS;
            const nextStacks = Math.min(maxStacks, existing.stacks + addStacks);
            if (nextStacks <= 0) return { applied: false, reason: 'max-stacks' };
            existing.stacks = nextStacks;
            const refreshPolicy = def.refreshPolicy ?? (def.refreshOnReapply === false ? 'keep' : 'refresh');
            const durationSeconds = options.durationSeconds ?? def.durationSeconds;
            if (durationSeconds && refreshPolicy === 'refresh') {
                existing.remainingSeconds = durationSeconds;
            } else if (durationSeconds && refreshPolicy === 'extend') {
                existing.remainingSeconds = (existing.remainingSeconds ?? 0) + durationSeconds;
            }
            if (!existing.sourceUnitId && options.sourceUnitId) existing.sourceUnitId = options.sourceUnitId;
            if (options.sourceUnitId) existing.sourceUnitId = options.sourceUnitId;
            if (options.runtimeBehavior) existing.runtimeBehavior = cloneRuntimeBehavior(options.runtimeBehavior);
            if (options.independentStackDuration && durationSeconds && durationSeconds > 0) {
                const timers = existing.stackRemainingSeconds ?? Array(existing.stacks - 1).fill(existing.remainingSeconds ?? durationSeconds);
                const append = Math.max(0, nextStacks - timers.length);
                for (let index = 0; index < append; index += 1) timers.push(durationSeconds);
                existing.stackRemainingSeconds = timers;
                existing.remainingSeconds = Math.max(...timers);
            }
            existing.appliedAt = at;
            return { applied: true };
        }

        const initialStacks = Math.min(options.maxStacks ?? def.maxStacks ?? DEFAULT_MAX_STACKS, addStacks);
        current.push({
            uid: this.nextUid++,
            defId,
            stacks: initialStacks,
            remainingSeconds: (options.durationSeconds ?? def.durationSeconds) || null,
            appliedAt: at,
            sourceModifierId: options.sourceModifierId,
            sourceUnitId: options.sourceUnitId,
            runtimeBehavior: options.runtimeBehavior ? cloneRuntimeBehavior(options.runtimeBehavior) : undefined,
            stackRemainingSeconds: options.independentStackDuration && (options.durationSeconds ?? def.durationSeconds)
                ? Array(initialStacks).fill(options.durationSeconds ?? def.durationSeconds)
                : undefined,
        });
        this.instances.set(unitId, current);
        return { applied: true };
    }

    /** 移除单位上的指定状态（全部层数）。 */
    remove(unitId: string, defId: string): boolean {
        const current = this.instances.get(unitId);
        if (!current) return false;
        const next = current.filter((inst) => inst.defId !== defId);
        if (next.length === current.length) return false;
        if (next.length) this.instances.set(unitId, next);
        else this.instances.delete(unitId);
        return true;
    }

    removeAll(unitId: string): void {
        this.instances.delete(unitId);
    }

    /** 推进过期结算：所有有限时长状态按 dt 衰减，到期移除。 */
    tick(unitIds: readonly string[], dt: number): void {
        for (const unitId of unitIds) {
            const current = this.instances.get(unitId);
            if (!current) continue;
            let changed = false;
            const alive: ZCStatusInstance[] = [];
            for (const inst of current) {
                if (inst.stackRemainingSeconds?.length) {
                    inst.stackRemainingSeconds = inst.stackRemainingSeconds
                        .map((seconds) => seconds - dt)
                        .filter((seconds) => seconds > 0);
                    inst.stacks = inst.stackRemainingSeconds.length;
                    if (inst.stacks > 0) {
                        inst.remainingSeconds = Math.max(...inst.stackRemainingSeconds);
                        alive.push(inst);
                    } else changed = true;
                    continue;
                }
                if (inst.remainingSeconds == null) {
                    alive.push(inst);
                    continue;
                }
                inst.remainingSeconds -= dt;
                if (inst.remainingSeconds > 0) alive.push(inst);
                else changed = true;
            }
            if (changed) {
                if (alive.length) this.instances.set(unitId, alive);
                else this.instances.delete(unitId);
            }
        }
    }

    /**
     * 推进周期效果：返回自上次调用以来到点（now）的全部 periodic 结算事件，并把每个实例的
     * lastFiredAt 推进到最后一个触发点（确定性，可随快照回放）。调用方应在过期 tick 之前调用，
     * 使本帧到期的状态仍结算最后一次（与旧 update 先伤害后移除一致）。
     */
    collectPeriodicEvents(now: number): ZCPeriodicEvent[] {
        const events: ZCPeriodicEvent[] = [];
        for (const [unitId, instances] of this.instances) {
            for (const inst of instances) {
                const def = this.defs.get(inst.defId);
                const runtime = inst.runtimeBehavior;
                const behavior = runtime?.kind === 'legacyDot' ? runtime : def?.behavior;
                if (!behavior || (behavior.kind !== 'periodic' && behavior.kind !== 'legacyDot')) continue;
                const intervalSeconds = behavior.intervalSeconds;
                if (!(intervalSeconds > 0)) continue;
                let nextAt = (inst.lastFiredAt ?? inst.appliedAt) + intervalSeconds;
                while (nextAt <= now) {
                    inst.periodicCount = (inst.periodicCount ?? 0) + 1;
                    if (behavior.kind === 'legacyDot') {
                        const extra = behavior.extraEveryTicks && inst.periodicCount % behavior.extraEveryTicks === 0
                            ? behavior.extraFlatDamage : undefined;
                        events.push({
                            targetId: unitId, defId: inst.defId, sourceUnitId: inst.sourceUnitId,
                            stacks: inst.stacks, effect: ZCStatusEffectKind.Damage,
                            amountPct: behavior.targetMaxHpPctPerStack, basis: ZCStatusBasis.TargetMaxHp,
                            capAttackMultiplier: behavior.capAttackMultiplier,
                            flatDamagePerStack: behavior.flatDamagePerStack,
                            senderAttack: behavior.senderAttack,
                            extraFlatDamage: extra,
                            sourceOwner: behavior.sourceOwner,
                        });
                    } else {
                        events.push({
                            targetId: unitId,
                            defId: inst.defId,
                            sourceUnitId: inst.sourceUnitId,
                            stacks: inst.stacks,
                            effect: behavior.effect,
                            amountPct: behavior.amountPct,
                            basis: behavior.basis,
                            capAttackMultiplier: behavior.capAttackMultiplier,
                        });
                    }
                    inst.lastFiredAt = nextAt;
                    nextAt += intervalSeconds;
                }
            }
        }
        return events;
    }

    instancesOf(unitId: string): readonly ZCStatusInstance[] {
        return this.instances.get(unitId) ?? [];
    }

    stacksOf(unitId: string, defId: string): number {
        return this.instancesOf(unitId).find((inst) => inst.defId === defId)?.stacks ?? 0;
    }

    // ---- 聚合 ----

    /** 聚合单位全部状态的数值修正（flat 相加、pct 相加；返回 0/缺省 的键不写出）。 */
    statModsOf(unitId: string): ZCStatusStatMods {
        const result: ZCStatusStatMods = {};
        for (const inst of this.instancesOf(unitId)) {
            const def = this.defs.get(inst.defId);
            if (!def?.statMods) continue;
            const mods = def.statMods;
            for (const key of Object.keys(mods) as (keyof ZCStatusStatMods)[]) {
                const value = mods[key];
                if (value == null || value === 0) continue;
                const scaled = value * inst.stacks;
                result[key] = (result[key] ?? 0) + scaled;
            }
        }
        return result;
    }

    /**
     * 聚合单位当前的硬控；多个硬控同时存在时取剩余时间最长者（永久视为最长，同级取后者），
     * 供单位状态机在最前置闸门判断并决定表现类型。
     */
    controlOf(unitId: string): { kind: ZCControlKind; defId: string } | null {
        let best: { kind: ZCControlKind; defId: string; remaining: number } | null = null;
        for (const inst of this.instancesOf(unitId)) {
            const def = this.defs.get(inst.defId);
            if (!def?.control) continue;
            const remaining = inst.remainingSeconds ?? Number.POSITIVE_INFINITY;
            if (!best || remaining > best.remaining) {
                best = { kind: def.control, defId: inst.defId, remaining };
            }
        }
        return best ? { kind: best.kind, defId: best.defId } : null;
    }

    /** 聚合单位全部行为钩子（含层数缩放，kind='none' 跳过）。 */
    behaviorsOf(unitId: string): readonly (ZCStatusBehavior & { defId: string; stacks: number })[] {
        const result: (ZCStatusBehavior & { defId: string; stacks: number })[] = [];
        for (const inst of this.instancesOf(unitId)) {
            const def = this.defs.get(inst.defId);
            if (!def?.behavior || def.behavior.kind === 'none') continue;
            result.push({ ...def.behavior, defId: inst.defId, stacks: inst.stacks });
        }
        return result;
    }

    /** 单位身上是否有任一状态（供结算层跳过无状态单位）。 */
    hasAny(unitId: string): boolean {
        return (this.instances.get(unitId)?.length ?? 0) > 0;
    }

    unitIdsWithStatuses(): readonly string[] {
        return Array.from(this.instances.keys());
    }

    exportSnapshot(): ZCStatusSystemSnapshot {
        return {
            nextUid: this.nextUid,
            units: Array.from(this.instances.entries())
                .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
                .map(([unitId, instances]) => ({
                    unitId,
                    instances: instances.map(cloneStatusInstance),
                })),
        };
    }

    restore(snapshot?: ZCStatusSystemSnapshot | null): void {
        this.instances.clear();
        this.nextUid = 1;
        if (!snapshot) return;
        const errors = ZCStatusSystem.snapshotErrors(snapshot);
        if (errors.length) throw new Error(`[ZCStatusSystem] 无效状态快照：${errors.join(', ')}`);
        for (const row of snapshot.units) {
            for (const instance of row.instances) {
                if (!this.defs.has(instance.defId)) {
                    throw new Error(`[ZCStatusSystem] 状态快照引用未知定义：${instance.defId}`);
                }
            }
            this.instances.set(row.unitId, row.instances.map(cloneStatusInstance));
        }
        this.nextUid = snapshot.nextUid;
    }

    static snapshotErrors(value: unknown): string[] {
        const errors: string[] = [];
        const record = (item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item);
        if (!record(value)) return ['statusEffects'];
        if (!Number.isSafeInteger(value.nextUid) || Number(value.nextUid) < 1) errors.push('statusEffects.nextUid');
        if (!Array.isArray(value.units)) return [...errors, 'statusEffects.units'];
        const uids = new Set<number>();
        for (const [rowIndex, rawRow] of value.units.entries()) {
            const path = `statusEffects.units[${rowIndex}]`;
            if (!record(rawRow) || typeof rawRow.unitId !== 'string' || !Array.isArray(rawRow.instances)) {
                errors.push(path);
                continue;
            }
            for (const [index, rawInstance] of rawRow.instances.entries()) {
                const itemPath = `${path}.instances[${index}]`;
                if (!record(rawInstance)) { errors.push(itemPath); continue; }
                const uid = Number(rawInstance.uid);
                if (!Number.isSafeInteger(uid) || uid < 1 || uids.has(uid)) errors.push(`${itemPath}.uid`);
                uids.add(uid);
                if (typeof rawInstance.defId !== 'string' || !rawInstance.defId) errors.push(`${itemPath}.defId`);
                if (!Number.isSafeInteger(rawInstance.stacks) || Number(rawInstance.stacks) < 1) errors.push(`${itemPath}.stacks`);
                if (rawInstance.remainingSeconds !== null
                    && (typeof rawInstance.remainingSeconds !== 'number' || !Number.isFinite(rawInstance.remainingSeconds) || rawInstance.remainingSeconds < 0)) {
                    errors.push(`${itemPath}.remainingSeconds`);
                }
                if (typeof rawInstance.appliedAt !== 'number' || !Number.isFinite(rawInstance.appliedAt) || rawInstance.appliedAt < 0) {
                    errors.push(`${itemPath}.appliedAt`);
                }
                if (rawInstance.periodicCount != null
                    && (!Number.isSafeInteger(rawInstance.periodicCount) || Number(rawInstance.periodicCount) < 0)) {
                    errors.push(`${itemPath}.periodicCount`);
                }
                if (rawInstance.stackRemainingSeconds != null
                    && (!Array.isArray(rawInstance.stackRemainingSeconds)
                        || rawInstance.stackRemainingSeconds.length !== Number(rawInstance.stacks)
                        || rawInstance.stackRemainingSeconds.some((seconds: unknown) => (
                            typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0
                        )))) {
                    errors.push(`${itemPath}.stackRemainingSeconds`);
                }
                if (rawInstance.runtimeBehavior != null && !validRuntimeBehavior(rawInstance.runtimeBehavior)) {
                    errors.push(`${itemPath}.runtimeBehavior`);
                }
            }
        }
        for (const uid of uids) if (Number(value.nextUid) <= uid) errors.push('statusEffects.nextUid');
        return errors;
    }
}

function cloneRuntimeBehavior(value: ZCStatusRuntimeBehavior): ZCStatusRuntimeBehavior {
    return { ...value };
}

function cloneStatusInstance(instance: ZCStatusInstance): ZCStatusInstance {
    return {
        ...instance,
        stackRemainingSeconds: instance.stackRemainingSeconds ? [...instance.stackRemainingSeconds] : undefined,
        runtimeBehavior: instance.runtimeBehavior ? cloneRuntimeBehavior(instance.runtimeBehavior) : undefined,
    };
}

function validRuntimeBehavior(value: unknown): value is ZCStatusRuntimeBehavior {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    const finiteNonNegative = (child: unknown) => typeof child === 'number' && Number.isFinite(child) && child >= 0;
    if (record.kind === 'legacyTraction') return finiteNonNegative(record.range) && finiteNonNegative(record.speed);
    if (record.kind !== 'legacyDot') return false;
    if (!(typeof record.intervalSeconds === 'number' && Number.isFinite(record.intervalSeconds) && record.intervalSeconds > 0)
        || !finiteNonNegative(record.flatDamagePerStack)
        || !finiteNonNegative(record.targetMaxHpPctPerStack)
        || !finiteNonNegative(record.senderAttack)
        || !['player', 'enemy', 'enemy2', 'enemy3'].includes(String(record.sourceOwner))) return false;
    if (record.capAttackMultiplier != null && !finiteNonNegative(record.capAttackMultiplier)) return false;
    if (record.extraEveryTicks != null
        && (!Number.isSafeInteger(record.extraEveryTicks) || Number(record.extraEveryTicks) < 1)) return false;
    return record.extraFlatDamage == null || finiteNonNegative(record.extraFlatDamage);
}
