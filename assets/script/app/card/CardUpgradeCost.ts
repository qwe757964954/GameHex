/**
 * 卡牌升级消耗解析与判定。不 import cc，可单测。
 *
 * 数据源 cardLevelUp.json：一行 = 一张卡的一个目标等级。
 * 升级条件：① 消耗卡牌数量够；② 通用经验 + 兵种经验合计够。
 * 从 level 升到 level+1 读的是 level+1 那一行。
 *
 * **解锁（level 0 → 1）也走同一套判定**：按钮叫「解锁」只是说法（`upgradeButtonText()`），
 * 经验照样按 `costArmyLevelNum` 判 —— 表里 level=1 那行配了多少经验就得有多少。
 */

import { CARD_LINEUP_TEXTS } from './CardLineupTexts';

function resolveUpgradeRow(
    levels: ReadonlyMap<number, ZCCardLevelUpRow> | undefined,
    currentLevel: number,
): ZCCardLevelUpRow | undefined {
    return levels?.get(currentLevel + 1);
}

/** cardLevelUp 一行（已归一化）。 */
export interface ZCCardLevelUpRow {
    id: string;
    /** 目标等级。 */
    level: number;
    costCardID: string;
    costCardNum: number;
    costArmyLevelID: string;
    costGeneralLevelID: string;
    /** 经验消耗（通用 + 兵种合计）。 */
    costArmyLevelNum: number;
}

export type ZCCardLevelUpTable = ReadonlyMap<string, ReadonlyMap<number, ZCCardLevelUpRow>>;

/** 一行待满足材料。 */
export interface ZCUpgradeRequirement {
    key: 'card' | 'exp';
    /** card=消耗卡牌id；exp=通用经验id。 */
    itemId: string;
    owned: number;
    need: number;
    enough: boolean;
}

/** 一次升级判定结果。 */
export interface ZCUpgradeStatus {
    cardId: string;
    configured: boolean;
    level: number;
    targetLevel: number;
    maxLevel: number;
    maxed: boolean;
    armyExpItemId: string;
    generalExpItemId: string;
    armyExpOwned: number;
    generalExpOwned: number;
    requirements: readonly ZCUpgradeRequirement[];
    canUpgrade: boolean;
    blockedReason: string;
}

/** 收成非负整数；非法值 null（空串/null 不能当 0）。 */
function toCount(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) return null;
    return Math.floor(num);
}

function toId(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text.length === 0 ? null : text;
}

/** 解析一行；坏行返回 null。 */
export function parseCardLevelUpRow(value: unknown): ZCCardLevelUpRow | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;

    const id = toId(row.id);
    const level = toCount(row.level);
    const costCardID = toId(row.costCardID);
    const costCardNum = toCount(row.costCardNum);
    const armyId = toId(row.costArmyLevelID);
    const generalId = toId(row.costGeneralLevelID);
    const costArmyLevelNum = toCount(row.costArmyLevelNum);
    if (id === null || level === null || costCardID === null || costCardNum === null) return null;
    if (armyId === null || generalId === null || costArmyLevelNum === null) return null;

    return { id, level, costCardID, costCardNum, costArmyLevelID: armyId, costGeneralLevelID: generalId, costArmyLevelNum };
}

/** 建「卡牌 → (等级 → 行)」两级表。重复行后值覆盖。 */
export function buildCardLevelUpTable(rows: readonly unknown[]): ZCCardLevelUpTable {
    const table = new Map<string, Map<number, ZCCardLevelUpRow>>();
    for (const raw of rows) {
        const row = parseCardLevelUpRow(raw);
        if (!row) continue;
        let levels = table.get(row.id);
        if (!levels) {
            levels = new Map<number, ZCCardLevelUpRow>();
            table.set(row.id, levels);
        }
        levels.set(row.level, row);
    }
    return table;
}

/** 等级上限（表里最大 level）；无配置返回 0。 */
export function resolveMaxLevel(table: ZCCardLevelUpTable, cardId: string): number {
    const levels = table.get(String(cardId));
    if (!levels) return 0;
    let max = 0;
    for (const level of levels.keys()) {
        if (level > max) max = level;
    }
    return max;
}

export type ZCItemCounter = (itemId: string) => number;

/**
 * 算「cardId 从 currentLevel 升一级」的完整判定。不缓存，每次重读。
 */
export function evaluateUpgrade(
    table: ZCCardLevelUpTable,
    cardId: string,
    currentLevel: number,
    countOf: ZCItemCounter,
): ZCUpgradeStatus {
    const id = String(cardId);
    const level = Math.max(0, Math.floor(Number(currentLevel) || 0));

    const empty: ZCUpgradeStatus = {
        cardId: id,
        configured: false,
        level,
        targetLevel: level,
        maxLevel: 0,
        maxed: false,
        armyExpItemId: '',
        generalExpItemId: '',
        armyExpOwned: 0,
        generalExpOwned: 0,
        requirements: [],
        canUpgrade: false,
        blockedReason: '',
    };

    const levels = table.get(id);
    if (!levels || levels.size === 0) {
        return { ...empty, blockedReason: '该卡没有升级配置' };
    }

    const maxLevel = resolveMaxLevel(table, id);
    const row = resolveUpgradeRow(levels, level);
    if (!row) {
        return { ...empty, configured: true, maxLevel, maxed: true, blockedReason: '已满级' };
    }

    const armyExpOwned = Math.max(0, Math.floor(countOf(row.costArmyLevelID) || 0));
    const generalExpOwned = Math.max(0, Math.floor(countOf(row.costGeneralLevelID) || 0));
    const cardOwned = Math.max(0, Math.floor(countOf(row.costCardID) || 0));

    const expOwned = generalExpOwned + armyExpOwned;
    const cardEnough = cardOwned >= row.costCardNum;
    const expEnough = expOwned >= row.costArmyLevelNum;

    const requirements: ZCUpgradeRequirement[] = [
        { key: 'card', itemId: row.costCardID, owned: cardOwned, need: row.costCardNum, enough: cardEnough },
        { key: 'exp', itemId: row.costGeneralLevelID, owned: expOwned, need: row.costArmyLevelNum, enough: expEnough },
    ];

    const missing: string[] = [];
    if (!cardEnough) missing.push(`卡牌不足（${cardOwned}/${row.costCardNum}）`);
    if (!expEnough) missing.push(`经验不足（${expOwned}/${row.costArmyLevelNum}）`);

    return {
        cardId: id,
        configured: true,
        level,
        targetLevel: level + 1,
        maxLevel,
        maxed: false,
        armyExpItemId: row.costArmyLevelID,
        generalExpItemId: row.costGeneralLevelID,
        armyExpOwned,
        generalExpOwned,
        requirements,
        canUpgrade: cardEnough && expEnough,
        blockedReason: missing.join('，'),
    };
}

/**
 * 升级按钮文案。等级 0 → 1 是解锁，叫「解锁」；只换文案，判定与请求不变。
 */
export function upgradeButtonText(level: number, sending: boolean): string {
    const texts = CARD_LINEUP_TEXTS;
    const current = Math.max(0, Math.floor(Number(level) || 0));
    if (current === 0) return sending ? texts.upgradeUnlocking : texts.upgradeUnlock;
    return sending ? texts.upgradeSending : texts.upgradeConfirm;
}
