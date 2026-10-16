/**
 * 角色「攻击力」汇总（老端 `ModelTeam.GetTotalAtk()` 口径）。
 *
 * **零引擎依赖**（能直接单测）—— 判定逻辑不许挂在带 `cc` 的 import 链上（项目规则 78）。
 *
 * ## 老端口径
 *
 * ```ts
 * atk = 属性袋['攻击力'] + 属性袋['装备攻击力']
 *     + Σ skillAttrModifier[modifyId] 里 type === '修改属性' 的 data['攻击力']
 *     + gameConfig.roleDefaultAtk          // 表里就是 0，代码仍照口径加上
 * ```
 * 属性袋由四系统 `GetFightAttr` 汇总（`ModelTeam.GetAtkAttr`），逐个核过：
 *
 * | 系统 | 老端 | 本轮 |
 * |---|---|---|
 * | 装备 | `ModelEquip.GetFightAttr` → 每件 `VOEquipItem.GetFightAttr` | **已接**（{@link equipAttackOf}） |
 * | 禁军 | `ModelGuards.GetAtkAttr` → `guards` 表 attribute1..3 + rank/level 表 | **待接** |
 * | 部队 | `ModelArmy.GetFightAttr` —— 老端**自身就是空实现**（函数体全被注释） | 无需接 |
 * | 城墙 | `ModelWalled.GetFightAttr` —— 只产「城墙基础血量增加 / 城墙皮肤」 | **对攻击力无贡献**，无需接 |
 *
 * `modify` 列表老端取 7 处（`GetTotalModifyList`）：装备 / 部队皮肤 / 城墙 / 禁军技能 /
 * 主公技 / 神像祝福 / 宝物（解锁+天赋+上阵技能）⇒ 目前由调用方给 `modifyIds`，**逐个待接**。
 */

/** 属性袋：属性名 → 数值（老端到处都是这种 `attrs` 字典）。 */
export type AttrBag = Record<string, number>;

/** 攻击力属性名（老端 `atkAttrName`）。 */
export const ATK_ATTR = '攻击力';

/** 装备专属攻击力属性名 —— 老端单列一项，最后与「攻击力」相加。 */
export const EQUIP_ATK_ATTR = '装备攻击力';

/**
 * 附加属性列名（老端 `VOEquipItem.ts` 里的 `RefEquipExtraAttrIndexNameList`，**顺序即语义**）。
 * ⚠️ `equipRank` 表实际只有 `add1..add3` ⇒ 第 4 项取不到时**必须按 0 算**，
 * 否则 `(attrs[x] || 0) + undefined = NaN` 会把整条攻击力污染成 NaN（老端这里有隐患）。
 */
export const EQUIP_EXTRA_ATTR_KEYS: readonly string[] = ['add1', 'add2', 'add3', 'add4'];

/** `equipLevel` 表一行（本模块只要这两列）。 */
export interface IEquipLevelRow {
    readonly attack: number;
    readonly hpPer: number;
}

/** `equipRank` 表一行（按 `rank` + `qualityLevel` 查）。 */
export interface IEquipRankRow {
    readonly attack: number;
    readonly hpPer: number;
    /** 附加属性值 `add1..add4`（缺列按 0）。 */
    readonly [key: string]: number;
}

/** `skillAttrModifier` 表里的一条修饰项。 */
export interface ISkillAttrModify {
    /** 老端判据：只有 `'修改属性'` 这种 type 才参与属性累加。 */
    readonly type: string;
    /** 属性名 → 值。 */
    readonly data: Record<string, number>;
}

/** `skillAttrModifier` 表一行。 */
export interface ISkillAttrModifierRow {
    readonly modify: readonly ISkillAttrModify[];
}

/** 一件**穿着中**的装备（凑 `GetTotalAtk` 需要的四项，其余字段与攻击力无关）。 */
export interface IEquipPowerPart {
    /** 该部位装备等级（`CmdEquip.level`，来自 `CmdEquipPage.tlCmdEquip`）。 */
    readonly level: number;
    /** 阶（`CmdEquipItem.rank`）—— 查 `equipRank` 的键之一。 */
    readonly rank: number;
    /** 当前品质档（`CmdEquipItem.curQuality`，老端 `GetQualitySpecialLv`）—— 查 `equipRank` 的另一半键。 */
    readonly qualityLevel: number;
    /** 初始属性 id 列表（`CmdEquipItem.tlEffects`），逐项去 `equipLib` 解属性名。 */
    readonly effects: readonly number[];
}

/** 汇总所需的表（调用方从 `RefUtil` 读好后传进来，本模块不碰引擎）。 */
export interface IPowerTables {
    /** `equipLevel` 表：key = `equipLevel`。 */
    readonly equipLevel: ReadonlyMap<number, IEquipLevelRow>;
    /** `equipRank` 表：key = `` `${rank}|${qualityLevel}` ``。 */
    readonly equipRank: ReadonlyMap<string, IEquipRankRow>;
    /** `equipLib` 表：key = `id`。 */
    readonly equipLib: ReadonlyMap<number, { readonly attribute: string }>;
    /** `skillAttrModifier` 表：key = `id`。 */
    readonly skillAttrModifier: ReadonlyMap<number, ISkillAttrModifierRow>;
    /** `gameConfig.roleDefaultAtk`（表里是 0）。 */
    readonly roleDefaultAtk: number;
}

/** 查阶表：老端口径「查不到就退一档」（`GetEquipRankRef`）。 */
export function equipRankOf(
    tables: IPowerTables,
    rank: number,
    qualityLevel: number,
): IEquipRankRow | null {
    return tables.equipRank.get(`${rank}|${qualityLevel}`)
        ?? tables.equipRank.get(`${rank}|${qualityLevel - 1}`)
        ?? null;
}

/**
 * 装备系统对属性袋的贡献（老端 `ModelEquip.GetFightAttr` + `VOEquipItem.GetFightAttr`）。
 *
 * 每件装备：
 *   · `装备攻击力 += equipLevel[部位等级].attack + equipRank[阶, 品质档].attack`
 *   · `生命百分比 += (两级 hpPer 之和) / 100`
 *   · 对 `tlEffects` 第 i 项：`attr[equipLib[attrId].attribute] += equipRank.add{i+1}`
 *
 * ⚠️ 老端口径：`装备攻击力` 一开始**显式置 0**（不是累加初始值），所以这里也先清零再累加。
 */
export function equipFightAttrs(parts: readonly IEquipPowerPart[], tables: IPowerTables): AttrBag {
    const attrs: AttrBag = {};
    attrs[EQUIP_ATK_ATTR] = 0;
    for (const part of parts) {
        const lv = tables.equipLevel.get(part.level);
        const rank = equipRankOf(tables, part.rank, part.qualityLevel);
        if (lv) attrs[EQUIP_ATK_ATTR] += lv.attack;
        if (rank) attrs[EQUIP_ATK_ATTR] += rank.attack;
        if (lv || rank) {
            attrs['生命百分比'] = (attrs['生命百分比'] ?? 0) + ((lv?.hpPer ?? 0) + (rank?.hpPer ?? 0)) / 100;
        }
        if (!rank) continue;
        part.effects.forEach((attrId, index) => {
            const name = tables.equipLib.get(attrId)?.attribute;
            if (!name) return;
            const key = EQUIP_EXTRA_ATTR_KEYS[index];
            const value = key === undefined ? 0 : Number(rank[key] ?? 0) || 0;   // 缺 add4 按 0，别让 NaN 串上去
            attrs[name] = (attrs[name] ?? 0) + value;
        });
    }
    return attrs;
}

/** `modifyIds` → `skillAttrModifier` 里 `'修改属性'` 项对攻击力的累加（老端 `GetTotalAtk` 中段）。 */
export function modifyAttackOf(modifyIds: readonly number[], tables: IPowerTables): number {
    let sum = 0;
    for (const id of modifyIds) {
        const row = tables.skillAttrModifier.get(id);
        if (!row) continue;
        for (const modify of row.modify ?? []) {
            if (modify.type !== '修改属性') continue;
            sum += Number(modify.data?.[ATK_ATTR] ?? 0) || 0;
        }
    }
    return sum;
}

/**
 * 角色总攻击力（老端 `ModelTeam.GetTotalAtk()`）。
 *
 * @param parts    穿着中的装备（空位不要传进来）
 * @param modifyIds 各类加成修饰 id（老端 7 处来源，**目前由调用方逐个接**）
 */
export function totalAttackOf(
    parts: readonly IEquipPowerPart[],
    modifyIds: readonly number[],
    tables: IPowerTables,
): number {
    const attrs = equipFightAttrs(parts, tables);
    const atk = (attrs[ATK_ATTR] ?? 0) + (attrs[EQUIP_ATK_ATTR] ?? 0)
        + modifyAttackOf(modifyIds, tables)
        + (tables.roleDefaultAtk ?? 0);
    return Number.isFinite(atk) ? Math.round(atk) : 0;
}
