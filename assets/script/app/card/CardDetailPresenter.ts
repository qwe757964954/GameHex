/**
 * 卡牌详情页 Presenter：把 pvpCard / pvpUnitGrowth / armySkillLevelUp 三张表
 * 组装成视图可直接渲染的 `CardDetailPresentation`。不 import cc，可单测。
 *
 * 组装口径：
 *   - 六维数值 ← `computeDetailStats`（成长公式与战斗层同源，见 `CardDetailStats`）；
 *   - 技能链格子 ← 卡表 `skillIds` 顺序，格子名取技能名，角标 = 首档解锁英雄等级，
 *     锁定态 = 当前英雄等级不够；表里没配到的技能占「未解锁」空格；
 *   - 里程碑行 ← 每个技能的每一档（含首档），按解锁等级升序，行内带技能名；
 *   - 暴击伤害文案 ← `CardDetailCritDamage`（`pvpSkillPlan` 的 109001 链，取目标等级那一行）。
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

/**
 * 技能链：按卡表顺序出格，最多 5 格（超出的技能里程碑里仍能看到）。
 *
 * 2026-11-11 起不再补空占位格 —— 每张卡 `pvpCard.skillList` 都只有 4 个技能，
 * 补到 5 格会多出一个永远「未解锁」的假技能。表里查不到的技能 id 仍占一格（保持与卡表同序），
 * 由视图按 `empty` 画成锁定态。
 */
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
    return slots;
}

/**
 * 里程碑：卡表里每个技能的每一档（含首档），按解锁等级升序。
 *
 * 2026-11-10 起不再跳过首档 —— 首档（`unlockHeroLevel` 常为 0 / 3 / 6）才是玩家已经拿到的
 * 那几条，跳掉就会出现「技能格上有名字、描述栏里查无此技能」。同等级同描述的不同技能各留一行
 * （描述栏要囊括全部技能），只有同一技能的同一档重复出现在 `skillIds` 里才去重。
 *
 * 表里 `desc` 整块没填的技能（`armySkillLevelUp` 有 24 个技能 72 行是这样）整档不出列：
 * 玩家看到的是「18级 暂无描述」这种空条，不如不显示（2026-11-10 需求）。
 */
export function buildDetailMilestones(
    table: ZCArmySkillTable,
    skillIds: readonly number[],
    heroLevel: number,
): readonly CardDetailMilestone[] {
    const milestones: CardDetailMilestone[] = [];
    const seen = new Set<string>();
    for (const rawId of skillIds) {
        const skillId = Number(rawId);
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
 * 描述栏打开时的默认落点（`milestones` 已按解锁等级升序）。
 *
 * 从最新解锁的那一档开始看：它下面是「接下来能拿的」，上面是已经过去的档位（仍可上滚）。
 * 一档都没解锁时落在第一行；全部解锁时退一格，让最后两档同屏 —— 与 2026-11-10 的默认窗口口径一致，
 * 区别只是不再删行，历史档位始终能滚回去看。
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
