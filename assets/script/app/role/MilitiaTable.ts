/**
 * 民兵天赋的**纯函数表**（零引擎依赖，可直接单测）—— 项目规则 78：
 * 判定逻辑不许落在带 `cc` 的 import 链上。
 *
 * 口径逐条照抄老端 `TabMilitiaTalent`：
 *   · 列表数据 = `armyLevel[id=66014]` 的行**倒序**（等级降序，最高级在最上）；
 *   · `isUnlock = curLevel >= ref.level`、`isSelect = curLevel === ref.level`；
 *   · 图标 = `ref.icon + (isUnlock ? "_1" : "_0")`；
 *   · 有 `modify` 的行 → 显示效果名/描述、图标放大 1.3；
 *   · 红点只给「下一级」那格 = `checkMilitiaCanLevelUp()`（按**当前等级**行的消耗判）；
 *   · 详情弹窗的消耗取 **`lv - 1` 行**（升到 lv 要花的是上一级的价），`lv - 1` 不存在则退回本行；
 *   · 「激活」按钮只在 `lv === curLevel + 1` 时出现。
 */
import type {
    IMilitiaLevelRow,
    IMilitiaModifierEntry,
    IMilitiaModifierRow,
    IMilitiaTalentCell,
    IMilitiaTalentDetail,
    IMilitiaTalentSnapshot,
    MilitiaTalentState,
} from './MilitiaTypes';
import { MILITIA_ARMY_ID, MILITIA_DEFAULT_LEVEL } from './MilitiaTypes';

// ============================================================
// 防御式取值（与 RoleTable 同一套）
// ============================================================

/** 数字归一：`Long` / `string` / `number` 都要能落到 `number`；非法值给 `fallback`。 */
function numOf(value: unknown, fallback = 0): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
    if (typeof value === 'string') {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }
    if (value && typeof (value as { toNumber?: unknown }).toNumber === 'function') {
        const n = Number((value as { toNumber(): unknown }).toNumber());
        return Number.isFinite(n) ? n : fallback;
    }
    return fallback;
}

/** 字符串归一：`null` / `undefined` → 空串。 */
function strOf(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

/**
 * 数字数组归一。
 *
 * ⚠️ 表里这两列（`attrList` / `modify`）在压缩形态下可能是 **JSON 字符串**
 * （同 `skillAttrModifier.modify`，见 `RoleRepository.normalizeModify`）⇒ 两种都认。
 */
function numsOf(value: unknown): readonly number[] {
    let raw: unknown = value;
    if (typeof raw === 'string') {
        try {
            raw = JSON.parse(raw);
        } catch {
            return [];
        }
    }
    if (!Array.isArray(raw)) return [];
    const out: number[] = [];
    for (const item of raw) {
        const n = numOf(item, Number.NaN);
        if (Number.isFinite(n)) out.push(n);
    }
    return out;
}

// ============================================================
// 配置表解析
// ============================================================

/**
 * `armyLevel` 原始行 → 民兵的行（**按 level 升序**）。
 *
 * 表里 669 行混着多个兵种 ⇒ 先按 id 过滤；level 乱序也没关系，这里显式排序
 * （老端依赖表本身的顺序，新端不依赖 —— 表转出来是什么序不该影响界面）。
 */
export function parseMilitiaLevelRows(raw: readonly unknown[]): IMilitiaLevelRow[] {
    const out: IMilitiaLevelRow[] = [];
    for (const row of raw ?? []) {
        const r = row as Record<string, unknown> | null;
        if (!r) continue;
        if (numOf(r.id, 0) !== MILITIA_ARMY_ID) continue;
        out.push({
            id: MILITIA_ARMY_ID,
            level: numOf(r.level, 0),
            costGoldCnt: numOf(r.costGoldCnt, 0),
            costItemID: numOf(r.costItemID, 0),
            costItemNum: numOf(r.costItemNum, 0),
            modifyDesc: strOf(r.modifyDesc),
            attrList: numsOf(r.attrList),
            icon: strOf(r.icon),
            modify: numsOf(r.modify),
        });
    }
    out.sort((a, b) => a.level - b.level);
    return out;
}

/**
 * `skillAttrModifier` 原始行 → id 索引。
 *
 * ⚠️ `modify` / `armyTalent` 两列在压缩形态下可能是 **JSON 字符串**（同 `RoleRepository.normalizeModify`）
 * ⇒ 两种都认，认不出就当空。
 */
export function parseMilitiaModifiers(raw: readonly unknown[]): Map<number, IMilitiaModifierRow> {
    const out = new Map<number, IMilitiaModifierRow>();
    for (const row of raw ?? []) {
        const r = row as Record<string, unknown> | null;
        if (!r) continue;
        const id = numOf(r.id, 0);
        if (id <= 0) continue;
        out.set(id, {
            id,
            name: strOf(r.name),
            desc: strOf(r.desc),
            modify: parseModifierEntries(r.modify),
            armyTalent: parseStringMap(r.armyTalent),
        });
    }
    return out;
}

/** `modify` 列 → 条目数组。 */
function parseModifierEntries(raw: unknown): IMilitiaModifierEntry[] {
    let value: unknown = raw;
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value);
        } catch {
            return [];
        }
    }
    if (!Array.isArray(value)) return [];
    const out: IMilitiaModifierEntry[] = [];
    for (const item of value) {
        const e = item as { type?: unknown; data?: unknown } | null;
        if (!e) continue;
        out.push({
            type: strOf(e.type),
            data: (e.data && typeof e.data === 'object' ? e.data : {}) as Record<string, number>,
        });
    }
    return out;
}

/** `armyTalent` 列 → 字符串映射。 */
function parseStringMap(raw: unknown): Record<string, string> {
    let value: unknown = raw;
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value);
        } catch {
            return {};
        }
    }
    if (!value || typeof value !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (typeof v === 'string') out[k] = v;
    }
    return out;
}

// ============================================================
// 列表
// ============================================================

/** 三态：当前等级 = current，已解锁 = unlocked，否则未解锁。 */
export function talentStateOf(level: number, currentLevel: number): MilitiaTalentState {
    if (currentLevel === level) return 'current';
    return currentLevel >= level ? 'unlocked' : 'locked';
}

/**
 * 一格的 effect（`skillAttrModifier`）：老端**先用 `modify`**，没有再退回 `attrList`。
 *
 * 老端 `renderListItem` 里用的是 `ref.modify[0]`（并据此切「数据/有」页），
 * `showSkillEffect` 里先 `cfg.attrList[0]`、没有再 `cfg.modify[0]` + `modifyDesc`。
 * 两处顺序不一致 ⇒ 这里统一成「`modify` 优先，退回 `attrList`」，
 * 因为**列表那格必须和点开后的详情显示同一个效果**（否则点同一格两次看到两个名字）。
 */
function effectOf(
    row: IMilitiaLevelRow,
    modifiers: ReadonlyMap<number, IMilitiaModifierRow>,
): { name: string; desc: string; hasEffect: boolean } {
    const ids = row.modify.length ? row.modify : row.attrList;
    const first = ids.length ? modifiers.get(ids[0]) : undefined;
    if (!first) {
        // 有 modifyDesc 但查不到 modifier 表 ⇒ 至少把策划手写的描述显示出来（老端也是这么兜的）。
        return { name: '', desc: row.modifyDesc, hasEffect: false };
    }
    return { name: first.name, desc: row.modifyDesc || first.desc, hasEffect: true };
}

/** 图标 key = 表名 + 解锁后缀（老端 `ref.icon + (isUnlock ? "_1" : "_0")`）。 */
export function talentIconKeyOf(row: IMilitiaLevelRow, currentLevel: number): string {
    if (!row.icon) return '';
    return `${row.icon}${currentLevel >= row.level ? '_1' : '_0'}`;
}

/** 行数组 → 列表格（**等级降序**）。 */
export function talentCellsOf(
    rows: readonly IMilitiaLevelRow[],
    currentLevel: number,
    modifiers: ReadonlyMap<number, IMilitiaModifierRow>,
): IMilitiaTalentCell[] {
    const out: IMilitiaTalentCell[] = [];
    for (const row of rows) {
        const effect = effectOf(row, modifiers);
        out.push({
            level: row.level,
            state: talentStateOf(row.level, currentLevel),
            iconKey: talentIconKeyOf(row, currentLevel),
            effectName: effect.name,
            effectDesc: effect.desc,
            hasEffect: effect.hasEffect,
            isNext: row.level === currentLevel + 1,
        });
    }
    // 老端 `[...tlSkin].reverse()` ⇒ 最高级在最上面。
    return out.reverse();
}

/**
 * 打开时要滚到中间的那一项下标（老端 `nextLevelIndex`）。
 *
 * 优先「下一级」（`cur + 1`），没有则取「当前级」；都没有返回 -1（不滚）。
 */
export function focusIndexOf(cells: readonly IMilitiaTalentCell[], currentLevel: number): number {
    const next = cells.findIndex((c) => c.level === currentLevel + 1);
    if (next >= 0) return next;
    return cells.findIndex((c) => c.level === currentLevel);
}

// ============================================================
// 消耗 / 升级判定
// ============================================================

/** 按等级取行（找不到 = `null`）。 */
export function rowOfLevel(
    rows: readonly IMilitiaLevelRow[],
    level: number,
): IMilitiaLevelRow | null {
    return rows.find((r) => r.level === level) ?? null;
}

/**
 * 材料够不够（老端 `ModelArmy.checkCanLvUp`）：金币 + 道具**都要**够。
 *
 * ⚠️ 消耗行是「**当前等级**那一行」（升到下一级要花的钱写在当前等级行上），
 * 不是下一级那一行 —— 老端 `checkCanLvUp(id, getLevel())` 就是这个口径。
 */
export function canAffordOf(
    row: IMilitiaLevelRow | null,
    goldOwned: number,
    itemOwned: number,
): boolean {
    if (!row) return false;
    return goldOwned >= row.costGoldCnt && itemOwned >= row.costItemNum;
}

/**
 * 详情小弹窗（老端 `showSkillEffect(lv)`）。
 *
 * ⚠️ 消耗取 **`lv - 1` 行**（升到 lv 的价写在上一级），取不到退回本行 —— 老端 `cfgPre` 同理。
 * ⚠️ 图标的解锁后缀按**被点的等级**判（`isUnlock = cur >= lv`），不是按当前等级。
 */
export function talentDetailOf(
    rows: readonly IMilitiaLevelRow[],
    currentLevel: number,
    level: number,
    goldOwned: number,
    itemOwned: number,
    modifiers: ReadonlyMap<number, IMilitiaModifierRow>,
): IMilitiaTalentDetail | null {
    const cfg = rowOfLevel(rows, level);
    if (!cfg) return null;
    const cfgPre = rowOfLevel(rows, level - 1) ?? cfg;
    const effect = effectOf(cfg, modifiers);
    const unlocked = currentLevel >= level;

    return {
        level,
        iconKey: cfg.icon ? `${cfg.icon}${unlocked ? '_1' : '_0'}` : '',
        effectName: effect.name,
        effectDesc: effect.desc,
        goldNeed: cfgPre.costGoldCnt,
        goldOwned,
        itemId: cfgPre.costItemID,
        itemNeed: cfgPre.costItemNum,
        itemOwned,
        goldEnough: goldOwned >= cfgPre.costGoldCnt,
        itemEnough: itemOwned >= cfgPre.costItemNum,
        activatable: level === currentLevel + 1,
        canAfford: goldOwned >= cfgPre.costGoldCnt && itemOwned >= cfgPre.costItemNum,
    };
}

// ============================================================
// 天赋总览（老端 `LayerMiltiaAllAttr`）
// ============================================================

/**
 * 已解锁天赋的**属性聚合**（老端 `updataAttrList`）。
 *
 * 遍历 1..当前等级的行，取 `attrList[0]` → `skillAttrModifier`，只认 `type === '修改属性'`
 * 的那条，把 `data` 累加；显示名用 `armyTalent` 里的映射（没有就直接用属性名）。
 *
 * ⚠️ 老端这里用的是 **`attrList`**（不是 `modify`）—— 与列表格（`modify` 优先）**列不同**，
 * 两边照抄各自的口径，别合并（表里这两列本来就不同：一个给节点用、一个给总览用）。
 */
export function talentAttrsOf(
    rows: readonly IMilitiaLevelRow[],
    currentLevel: number,
    modifiers: ReadonlyMap<number, IMilitiaModifierRow>,
): string[] {
    const acc = new Map<string, number>();
    for (const row of rows) {
        if (row.level > currentLevel) continue;
        const id = row.attrList[0];
        if (id === undefined) continue;
        const ref = modifiers.get(id);
        const entry: IMilitiaModifierEntry | undefined = ref?.modify[0];
        if (!entry || entry.type !== '修改属性') continue;
        for (const [key, value] of Object.entries(entry.data)) {
            const shown = ref?.armyTalent?.[key] || key;
            acc.set(shown, (acc.get(shown) ?? 0) + numOf(value, 0));
        }
    }
    const out: string[] = [];
    for (const [key, value] of acc) out.push(`${key}+${value.toFixed(1)}%`);
    return out;
}

/**
 * 已解锁天赋的**描述列表**（老端 `updataList`）：有 `modify` 的行取 `modifyDesc`。
 *
 * ⚠️ 老端用的是 `for (let i = 1; i <= lv; i++)`（含当前等级）—— 与属性聚合同一区间。
 */
export function talentDescsOf(rows: readonly IMilitiaLevelRow[], currentLevel: number): string[] {
    const out: string[] = [];
    for (const row of rows) {
        if (row.level > currentLevel) continue;
        if (!row.modify.length) continue;
        out.push(row.modifyDesc);
    }
    return out;
}

/**
 * 组装整页快照（视图层只调这一个入口）。
 *
 * `redDot` = 老端 `checkMilitiaCanLevelUp()`：按**当前等级行**的消耗判，
 * 与详情弹窗里 lv=cur+1 的消耗是同一行（自洽）。
 */
export function buildMilitiaSnapshot(
    rows: readonly IMilitiaLevelRow[],
    level: number,
    modifiers: ReadonlyMap<number, IMilitiaModifierRow>,
    goldOwned: number,
    itemOwned: number,
): IMilitiaTalentSnapshot {
    const currentLevel = level > 0 ? level : MILITIA_DEFAULT_LEVEL;
    return {
        level: currentLevel,
        cells: talentCellsOf(rows, currentLevel, modifiers),
        focusIndex: focusIndexOf(talentCellsOf(rows, currentLevel, modifiers), currentLevel),
        redDot: canAffordOf(rowOfLevel(rows, currentLevel), goldOwned, itemOwned) ? 1 : 0,
    };
}
