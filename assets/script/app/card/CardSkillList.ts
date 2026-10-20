/**
 * 卡牌技能列表（`armySkillLevelUp`）的解析与「升到第几级」的纯函数。**不 import cc，可单测**。
 *
 * 表口径（`assets/remoteRef/armySkillLevelUp.json`，列存 `{k, v}`）：
 *   - `id`             技能编号，**与后端 `CmdPvpHeroSkillInfo.id` / 请求体 `skillId` 同一套编号**
 *                      （例如豌豆游侠 68001 的 4 个技能 = 100101 / 100102 / 100103 / 100104）
 *   - `unlockarmylevel` 解锁所需**英雄等级**（0 = 一级就会）
 *   - `skilllevel`     该技能的第几档（本项目里是 1 / 2 / 3，个别技能只有 1）
 *   - `armySkillType`  1 = 数值被动 / 2 = 行为被动（只影响展示，不影响升级）
 *   - `modfiy`         该档挂的修改器 id 列表（列名就是表里那个拼错的 `modfiy`，别改成 modify）
 *   - `name` / `desc`  技能名与**该档**的效果描述
 *
 * ⚠️ 一行 = 一个技能的**一个等级档**，不是「一个技能」。所以：
 *   ① 技能列表必须按 `id` 聚合，直接 `map` 出来会有 400+ 条；
 *   ② 同一个 `id` 的 `name` 只在有名字的那几行出现（有的技能首行 `name` 为空），
 *      聚合时要「取第一个非空」，否则技能名会变成空串。
 *
 * ⚠️ 按钮是**两个一组**的「上一级 / 下一级」，不是「4 个按钮 = 4 个档位」：
 *   `CmdPvpHeroUpSkillReqMsg` 只带 `{ heroId, skillId }`，即**一次只能升一级**，
 *   服务端自己决定升到哪一档。所以 UI 每行 4 个按钮 = 2 个技能 × 2 个方向。
 */

import type { PvpHeroSkillLevel } from './PvpHeroService';

/** `armySkillLevelUp` 的一个等级档（已归一化）。 */
export interface ZCArmySkillLevelRow {
    /** 技能编号（= 后端 `skillId`）。 */
    readonly skillId: number;
    /** 第几档，升序。 */
    readonly level: number;
    /** 解锁所需英雄等级。 */
    readonly unlockHeroLevel: number;
    /** 1 = 数值被动，2 = 行为被动。 */
    readonly skillType: number;
    /** 该档的效果描述。 */
    readonly desc: string;
}

/** 一个技能（聚合同一 `skillId` 的多个档）。 */
export interface ZCArmySkill {
    readonly skillId: number;
    /** 技能名；表里没配名字时为空串（视图应显示编号兜底）。 */
    readonly name: string;
    /** 按 `level` 升序的档位；非空（没档的行在建表时就被丢掉）。 */
    readonly levels: readonly ZCArmySkillLevelRow[];
}

/** 「技能 → 档位」索引，供卡牌页按 `pvpCard.skillList` 取用。 */
export type ZCArmySkillTable = ReadonlyMap<number, ZCArmySkill>;

/** 一行的解析结果：坏行返回 null（缺 id / 档位等必需列）。 */
export function parseArmySkillLevelRow(value: unknown): ZCArmySkillLevelRow | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;

    const skillId = toPositiveInt(row.id);
    const level = toPositiveInt(row.skilllevel);
    if (skillId === null || level === null) return null;

    return {
        skillId,
        level,
        // 解锁等级允许 0（一级就有），非法值按 0 处理而不是丢掉整行 —— 丢掉会让技能凭空少一档。
        unlockHeroLevel: Math.max(0, toCount(row.unlockarmylevel) ?? 0),
        skillType: toCount(row.armySkillType) ?? 1,
        desc: typeof row.desc === 'string' ? row.desc : '',
    };
}

/**
 * 建「技能 id → 聚合技能」。重复的 `(skillId, level)` 后值覆盖前值。
 *
 * `name` 取该技能**第一个非空**的名字：表里有些技能的某几行 `name` 是空的。
 */
export function buildArmySkillTable(rows: readonly unknown[]): ZCArmySkillTable {
    const levels = new Map<number, Map<number, ZCArmySkillLevelRow>>();
    const names = new Map<number, string>();

    for (const raw of rows) {
        const row = parseArmySkillLevelRow(raw);
        if (!row) continue;

        let byLevel = levels.get(row.skillId);
        if (!byLevel) {
            byLevel = new Map<number, ZCArmySkillLevelRow>();
            levels.set(row.skillId, byLevel);
        }
        byLevel.set(row.level, row);

        if (!names.has(row.skillId)) {
            const name = readName(raw);
            if (name) names.set(row.skillId, name);
        }
    }

    const table = new Map<number, ZCArmySkill>();
    for (const [skillId, byLevel] of levels) {
        if (byLevel.size === 0) continue;
        table.set(skillId, {
            skillId,
            name: names.get(skillId) ?? '',
            levels: Array.from(byLevel.values()).sort((a, b) => a.level - b.level),
        });
    }
    return table;
}

/** 按卡牌配置的 `skillList` 取技能，顺序**以配置为准**；缺失的 id 跳过并告警。 */
export function resolveCardSkills(
    table: ZCArmySkillTable,
    skillIds: readonly number[] | null | undefined,
    cardId?: string,
): readonly ZCArmySkill[] {
    const skills: ZCArmySkill[] = [];
    for (const raw of skillIds ?? []) {
        const skillId = Number(raw);
        if (!Number.isSafeInteger(skillId) || skillId <= 0) continue;
        const skill = table.get(skillId);
        if (!skill) {
            console.warn(`[CardSkillList] 卡 ${cardId ?? '?'} 的技能 ${skillId} 在 armySkillLevelUp 里没有配置，已跳过`);
            continue;
        }
        skills.push(skill);
    }
    return skills;
}

/**
 * 该技能当前是第几档。
 *
 * 后端 `skills` 里的 `level` 是「已升到第几档」；服务端没给（未拥有 / 老数据）时按
 * **第 1 档**算 —— 与 `armySkillLevelUp` 的 `skilllevel` 从 1 起、`unlockHeroLevel = 0`
 * 会立刻生效的口径一致，0 会让「下一级」按钮指向一个不存在的档位。
 */
export function resolveSkillLevel(skill: ZCArmySkill, levels: readonly PvpHeroSkillLevel[]): number {
    const entry = levels.find((item) => item.skillId === skill.skillId);
    const current = Math.floor(Number(entry?.level) || 0);
    if (current <= 0) return skill.levels.length > 0 ? skill.levels[0].level : 0;
    // 服务端档位高于表里配的档（表还没跟上）时按表里的最大档显示，避免「已满级」判错。
    const max = skillMaxLevel(skill);
    return max > 0 ? Math.min(current, max) : current;
}

/** 取某一档；没有则 undefined。 */
export function skillLevelRow(skill: ZCArmySkill, level: number): ZCArmySkillLevelRow | undefined {
    return skill.levels.find((row) => row.level === level);
}

/** 该技能的最大档位（= 满级）。 */
export function skillMaxLevel(skill: ZCArmySkill): number {
    return skill.levels.length > 0 ? skill.levels[skill.levels.length - 1].level : 0;
}

/**
 * 该技能是否已满级 = **`level + 1` 这一档在表里不存在**。
 *
 * 与 `CardSkillPresenter.step` 的目标档算法（`target = level + 1`）保持同一口径：
 * 升级请求永远是「+1 级」，所以只要有 `level + 1` 就能升，没有就是满级。
 *
 * 不用 `level >= skillMaxLevel`：档位可能不连续（配了 1/2/4、缺 3），
 * 那样 `level = 2` 时按最大档判不算满级，可「+1 = 3」又不存在 —— 按钮可点却必然无声失败。
 */
export function isSkillMaxed(skill: ZCArmySkill, level: number): boolean {
    if (skill.levels.length === 0) return true;
    return !skill.levels.some((row) => row.level === level + 1);
}

/**
 * 目标档的解锁判据：英雄等级够不够。
 *
 * 只做**按钮可用状态**，不是校验 —— 真正的扣费与门槛都在服务端。
 */
export function skillLevelUnlocked(skill: ZCArmySkill, targetLevel: number, heroLevel: number): boolean {
    const row = skillLevelRow(skill, targetLevel);
    if (!row) return false;
    return Math.floor(Number(heroLevel) || 0) >= row.unlockHeroLevel;
}

/**
 * 「↓」按钮能不能点：未满档 + 目标档已解锁 + 没有正在发的请求。
 * 「↑」按钮只看「有没有正在发的请求」—— 降级是本地预览，不消耗任何东西。
 */
export function canStepSkill(
    skill: ZCArmySkill,
    direction: 1 | -1,
    previewLevel: number,
    heroLevel: number,
    busy: boolean,
): boolean {
    if (busy) return false;
    const target = previewLevel + direction;
    if (target < 1) return false;
    if (!skillLevelRow(skill, target)) return false;
    // 往下翻总是允许（目标档一定已解锁过，否则也升不上来）；往上翻要判解锁等级。
    if (direction < 0) return true;
    return skillLevelUnlocked(skill, target, heroLevel);
}

// ------------------------------------------------------------------
// 内部工具
// ------------------------------------------------------------------

function toCount(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return Math.floor(num);
}

function toPositiveInt(value: unknown): number | null {
    const num = toCount(value);
    if (num === null || num <= 0) return null;
    return num;
}

function readName(value: unknown): string {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
    const name = (value as Record<string, unknown>).name;
    return typeof name === 'string' ? name.trim() : '';
}
