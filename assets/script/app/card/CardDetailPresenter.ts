/**
 * 卡牌详情页 Presenter：把 pvpCard / pvpUnitGrowth / armySkillLevelUp 三张表
 * 组装成视图可直接渲染的 CardDetailPresentation。不 import cc，可单测。
 */

import type { ZCArmySkill, ZCArmySkillTable } from './CardSkillList';
import { computeDetailStats, parseUnitGrowthRow } from './CardDetailStats';
import type { ZCCardDetailBase, ZCUnitGrowthRow } from './CardDetailStats';
import type { ZCCardLevelAttrs } from './CardLevelAttr';

/** 卡库顺序循环切换；找不到当前卡或卡库只有一张时不跳转。 */
export function resolveDetailNeighbor<T extends { readonly id: string }>(
    catalog: readonly T[], currentId: string, direction: -1 | 1,
): T | null {
    const index = catalog.findIndex(card => card.id === currentId);
    if (index < 0 || catalog.length < 2) return null;
    return catalog[(index + direction + catalog.length) % catalog.length];
}

/** 详情页六维属性一维（已格式化为展示文本）。 */
export interface CardDetailStatLine {
    readonly key: 'hp' | 'attack' | 'buildHp' | 'spawn' | 'range' | 'speed';
    readonly value: string;
    /** 升一级增量（绿色 `+N`）；空串 = 不显示（满级 / 不成长）。 */
    readonly gain: string;
}

/** 技能链一格。 */
export interface CardDetailSkillSlot {
    readonly skillId: number;
    readonly name: string;
    /** 解锁所需英雄等级（首档）。 */
    readonly unlockLevel: number;
    readonly unlocked: boolean;
    /** 没配技能的占位格（hex_lock，无角标）。 */
    readonly empty: boolean;
}

/** 里程碑一行（某个技能某一档的解锁说明）。 */
export interface CardDetailMilestone {
    /** 该档所属技能名（表里没配名字时为空串，视图只显示描述）。 */
    readonly name: string;
    readonly unlockLevel: number;
    readonly desc: string;
    readonly unlocked: boolean;
}

/** 详情页一次渲染要的全部展示数据。 */
export interface CardDetailPresentation {
    readonly stats: readonly CardDetailStatLine[];
    /** 当前等级的单卡战力文案，与详情攻击属性同源。 */
    readonly powerText: string;
    /** 升到下一级新增的「全队暴击伤害」（百分点，1 = +1%）；无配置 / 已满级为 0。 */
    readonly critDamageGain: number;
    readonly chain: readonly CardDetailSkillSlot[];
    readonly milestones: readonly CardDetailMilestone[];
}

/** 血量、攻击、建筑血量取整，范围和移速保留 1 位小数。 */
function formatInt(value: number): string {
    return String(Math.round(value));
}

function formatOne(value: number): string {
    return (Math.round(value * 10) / 10).toFixed(1);
}

function gainText(gain: number, format: (value: number) => string): string {
    if (gain <= 0) return '';
    return `+${format(gain)}`;
}

/** 组装六维属性行；`hasUnit = false`（纯建筑卡）时兵种四维 value 也照常显示（为 0）。 */
export function buildDetailStats(
    base: ZCCardDetailBase,
    growthRows: readonly ZCUnitGrowthRow[],
    unitId: string,
    level: number,
    levelAttrs?: ZCCardLevelAttrs | null,
    nextLevelAttrs?: ZCCardLevelAttrs | null,
): readonly CardDetailStatLine[] {
    const stats = computeDetailStats(base, growthRows, unitId, level, levelAttrs, nextLevelAttrs);
    return [
        { key: 'hp', value: formatInt(stats.unitHp.value), gain: gainText(stats.unitHp.gain, formatInt) },
        { key: 'attack', value: formatInt(stats.unitAttack.value), gain: gainText(stats.unitAttack.gain, formatInt) },
        { key: 'buildHp', value: formatInt(stats.buildHp.value), gain: gainText(stats.buildHp.gain, formatInt) },
        { key: 'spawn', value: formatInt(stats.spawnSeconds), gain: '' },
        { key: 'range', value: formatOne(stats.attackRange.value), gain: gainText(stats.attackRange.gain, formatOne) },
        { key: 'speed', value: formatOne(stats.moveSpeed.value), gain: gainText(stats.moveSpeed.gain, formatOne) },
    ];
}

/**
 * 技能链按卡表顺序出格，最多 5 格。
 * 每张卡只有 4 个技能，不补空占位；查不到的 id 仍占一格，由视图画成锁定态。
 */
export const DETAIL_CHAIN_SLOTS = 5;

export function buildDetailChain(
    table: ZCArmySkillTable,
    skillIds: readonly number[],
    heroLevel: number,
): readonly CardDetailSkillSlot[] {
    const slots: CardDetailSkillSlot[] = [];
    for (const skillId of skillIds.slice(0, DETAIL_CHAIN_SLOTS)) {
        const skill: ZCArmySkill | undefined = table.get(skillId);
        if (!skill) {
            slots.push({ skillId: 0, name: '', unlockLevel: 0, unlocked: false, empty: true });
            continue;
        }
        const unlockLevel = skill.levels[0].unlockHeroLevel;
        slots.push({
            skillId,
            name: skill.name,
            unlockLevel,
            unlocked: Math.floor(Number(heroLevel) || 0) >= unlockLevel,
            empty: false,
        });
    }
    return slots;
}

/**
 * 里程碑：每个技能的每一档（含首档），按解锁等级升序。
 * 同技能同档去重，描述为空的档不显示。
 */
export function buildDetailMilestones(
    table: ZCArmySkillTable,
    skillIds: readonly number[],
    heroLevel: number,
): readonly CardDetailMilestone[] {
    const milestones: CardDetailMilestone[] = [];
    const seen = new Set<string>();
    for (const skillId of skillIds) {
        const skill = table.get(skillId);
        if (!skill) continue;
        for (const row of skill.levels) {
            if (!String(row.desc ?? '').trim()) continue;
            const key = `${skillId}|${row.level}`;
            if (seen.has(key)) continue;
            seen.add(key);
            milestones.push({
                name: skill.name,
                unlockLevel: row.unlockHeroLevel,
                desc: row.desc,
                unlocked: Math.floor(Number(heroLevel) || 0) >= row.unlockHeroLevel,
            });
        }
    }
    return milestones.sort((a, b) => a.unlockLevel - b.unlockLevel);
}

/**
 * 描述栏默认落点。从最新解锁的一档开始，下面是接下来能拿的；
 * 全解锁时退一格让最后两档同屏，一档都没解锁时落第一行。
 */
export function milestoneAnchorIndex(milestones: readonly CardDetailMilestone[]): number {
    const total = milestones.length;
    if (total === 0) return 0;
    let lastUnlocked = -1;
    for (let i = total - 1; i >= 0; i--) {
        if (milestones[i].unlocked) { lastUnlocked = i; break; }
    }
    if (lastUnlocked < 0) return 0;
    return lastUnlocked === total - 1 ? Math.max(0, total - 2) : lastUnlocked;
}

/**
 * `pvpCard` 原始行 → 详情属性的基础值（缺列按 0）。
 *
 * 列类型由导表保证（`unitMaxHp` / `unitAttack` 等均为 number，建筑卡整列为空），
 * 直接按可选数字读取；不再做 `Number()` / `isFinite` 的二次类型校验。
 */
export function detailBaseOfRow(row: Partial<IRefpvpCard> | null): ZCCardDetailBase {
    return {
        unitMaxHp: row?.unitMaxHp ?? 0,
        unitAttack: row?.unitAttack ?? 0,
        unitMoveSpeed: row?.unitMoveSpeed ?? 0,
        unitAttackRange: row?.unitAttackRange ?? 0,
        spawnSeconds: row?.soilderAddTime ?? 0,
        baseHp: row?.baseHp ?? 0,
    };
}

/** pvpUnitGrowth 原始行数组 → 归一化行（缺 unitId / 非正档位的行跳过）。 */
export function parseGrowthRows(rows: readonly IRefpvpUnitGrowth[]): readonly ZCUnitGrowthRow[] {
    const parsed: ZCUnitGrowthRow[] = [];
    for (const row of rows) {
        const normalized = parseUnitGrowthRow(row);
        if (normalized) parsed.push(normalized);
    }
    return parsed;
}
