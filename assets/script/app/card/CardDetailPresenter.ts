/**
 * 卡牌详情页 Presenter：把 pvpCard / pvpUnitGrowth / armySkillLevelUp 三张表
 * 组装成视图可直接渲染的 `CardDetailPresentation`。**不 import cc，可单测**。
 *
 * 组装口径：
 *   - 六维数值 ← `computeDetailStats`（成长公式与战斗层同源，见 `CardDetailStats`）；
 *   - 技能链格子 ← 卡表 `skillIds` 顺序，格子名取技能名，角标 = 首档解锁英雄等级，
 *     锁定态 = 当前英雄等级不够；表里没配到的技能占「未解锁」空格；
 *   - 里程碑行 ← 每个技能**除首档外**的每一档（`unlockHeroLevel > 0`），
 *     按 `Lv.X 解锁描述` 升序 —— 与效果图「Lv.3 / Lv.6 / Lv.9 / Lv.12」一致。
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

/** 里程碑一行（某个技能档的解锁说明）。 */
export interface CardDetailMilestone {
    readonly unlockLevel: number;
    readonly desc: string;
    readonly unlocked: boolean;
}

/** 详情页一次渲染要的全部展示数据。 */
export interface CardDetailPresentation {
    readonly stats: readonly CardDetailStatLine[];
    /** 战力占位文案（战力系统未落地，Inspector 可覆盖）。 */
    readonly powerText: string;
    readonly chain: readonly CardDetailSkillSlot[];
    readonly milestones: readonly CardDetailMilestone[];
}

/** 六维里血量/攻击取整、范围/移速保留 1 位小数、时间取整秒。 */
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

/** 技能链：按卡表顺序，最多 5 格（效果图 5 格；超出的技能里程碑里仍能看到）。 */
export const DETAIL_CHAIN_SLOTS = 5;

export function buildDetailChain(
    table: ZCArmySkillTable,
    skillIds: readonly number[],
    heroLevel: number,
): readonly CardDetailSkillSlot[] {
    const slots: CardDetailSkillSlot[] = [];
    for (const rawId of skillIds.slice(0, DETAIL_CHAIN_SLOTS)) {
        const skillId = Number(rawId);
        const skill: ZCArmySkill | undefined = Number.isSafeInteger(skillId) && skillId > 0 ? table.get(skillId) : undefined;
        if (!skill || skill.levels.length === 0) {
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
    while (slots.length < DETAIL_CHAIN_SLOTS) {
        slots.push({ skillId: 0, name: '', unlockLevel: 0, unlocked: false, empty: true });
    }
    return slots;
}

/** 里程碑：所有技能的非首档（unlockHeroLevel > 0），按解锁等级升序。 */
export function buildDetailMilestones(
    table: ZCArmySkillTable,
    skillIds: readonly number[],
    heroLevel: number,
): readonly CardDetailMilestone[] {
    const milestones: CardDetailMilestone[] = [];
    const seen = new Set<string>();
    for (const rawId of skillIds) {
        const skill = table.get(Number(rawId));
        if (!skill) continue;
        for (let i = 1; i < skill.levels.length; i++) {
            const row = skill.levels[i];
            if (row.unlockHeroLevel <= 0) continue;
            const key = `${row.unlockHeroLevel}|${row.desc}`;
            if (seen.has(key)) continue;
            seen.add(key);
            milestones.push({
                unlockLevel: row.unlockHeroLevel,
                desc: row.desc,
                unlocked: Math.floor(Number(heroLevel) || 0) >= row.unlockHeroLevel,
            });
        }
    }
    return milestones.sort((a, b) => a.unlockLevel - b.unlockLevel);
}

/** `pvpCard` 原始行 → 详情属性的基础值（缺列按 0）。 */
export function detailBaseOfRow(row: Record<string, unknown> | null): ZCCardDetailBase {
    const num = (key: string): number => {
        const value = Number(row?.[key]);
        return Number.isFinite(value) ? value : 0;
    };
    return {
        unitMaxHp: num('unitMaxHp'),
        unitAttack: num('unitAttack'),
        unitMoveSpeed: num('unitMoveSpeed'),
        unitAttackRange: num('unitAttackRange'),
        spawnSeconds: num('soilderAddTime'),
        baseHp: num('baseHp'),
    };
}

/** pvpUnitGrowth 原始行数组 → 归一化行（坏行跳过）。 */
export function parseGrowthRows(rows: readonly unknown[]): readonly ZCUnitGrowthRow[] {
    const parsed: ZCUnitGrowthRow[] = [];
    for (const row of rows) {
        const normalized = parseUnitGrowthRow(row);
        if (normalized) parsed.push(normalized);
    }
    return parsed;
}
