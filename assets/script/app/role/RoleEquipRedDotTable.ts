/**
 * 装备锻造红点判定的**唯一口径**（零 `cc` 依赖，可直接 import 单测）。
 *
 * 角色页「装备」页签 / 锻造入口 / 装备栏 6 格、锻造弹窗内的页签与按钮、底栏角色入口
 * 全部读 `RoleRepository.equipRedDots()` 的同一份结果；本文件只做纯判定，不碰缓存与配置表。
 *
 * 判定与 `RoleRepository.equipmentGrowth()` 展示的消耗**同源**（否则会出现「界面写材料够、
 * 红点却不亮」）：
 *   · 强化：`equipLevel[level+1].gold / drawings`，道具 = `equip.consumeId`；
 *   · 升品：当前品阶行 `equipRank.cost`（不是下一阶行，展示的也是当前行的 cost）；
 *   · 洗炼：当前品阶行 `libCount >= 2` 才开放，消耗 `equipRank.washCost`，与升品共用材料
 *     （`gameConfig.equipAddQualityCostId`）。
 */

import { ROLE_EQUIP_PART_COUNT, type IEquipPartRedDots, type IEquipRedDots } from './RoleTypes';

/** 强化等级上限：与锻造页 `level >= 100` 的封顶口径一致。 */
export const EQUIP_MAX_LEVEL = 100;

/** 洗炼开放门槛：当前品阶至少 2 个词条位（`equipRank.libCount`）。 */
const EQUIP_WASH_MIN_LIB_COUNT = 2;

/** 一个部位的锻造消耗与玩家持有量（由 `RoleRepository.equipRedDots()` 装配）。 */
export interface IEquipPartCostFacts {
    readonly partId: number;
    /** 当前等级；0 = 分页里查不到（按不可强化处理，避免假红点）。 */
    readonly level: number;
    /** `equipLevel[level + 1]` 是否存在（满级 / 缺行 = false）。 */
    readonly hasNextLevel: boolean;
    readonly nextLevelGold: number;
    readonly nextLevelDrawings: number;
    /** 升品消耗；缺行 / 未解锁下一阶 = null。 */
    readonly nextRankCost: number | null;
    /** 当前品阶的词条位数量。 */
    readonly washLibCount: number;
    /** 洗炼消耗；缺行 = null（`libCount` 不足由 {@link canWashEquip} 再判）。 */
    readonly washCost: number | null;
    readonly ownedGold: number;
    readonly ownedDrawings: number;
    readonly ownedMaterial: number;
}

/** 可强化：未到上限、有下一级行，金币与强化道具都够。 */
export function canStrengthenEquip(facts: IEquipPartCostFacts): boolean {
    if (facts.level <= 0 || facts.level >= EQUIP_MAX_LEVEL || !facts.hasNextLevel) return false;
    return facts.ownedGold >= facts.nextLevelGold && facts.ownedDrawings >= facts.nextLevelDrawings;
}

/** 可升品：存在下一阶且升品材料足够。 */
export function canUpgradeEquip(facts: IEquipPartCostFacts): boolean {
    if (facts.nextRankCost === null || facts.nextRankCost <= 0) return false;
    return facts.ownedMaterial >= facts.nextRankCost;
}

/** 可洗炼：词条位已开放且材料足够。 */
export function canWashEquip(facts: IEquipPartCostFacts): boolean {
    if (facts.washLibCount < EQUIP_WASH_MIN_LIB_COUNT) return false;
    if (facts.washCost === null || facts.washCost <= 0) return false;
    return facts.ownedMaterial >= facts.washCost;
}

/** 单部位三项判定。 */
export function equipPartRedDots(facts: IEquipPartCostFacts): IEquipPartRedDots {
    const strengthen = canStrengthenEquip(facts);
    const upgrade = canUpgradeEquip(facts);
    const wash = canWashEquip(facts);
    return { partId: facts.partId, strengthen, upgrade, wash, any: strengthen || upgrade || wash };
}

/**
 * 6 个部位的汇总。缺失的部位于全 false —— 界面按下标取结果，不会出现 `undefined`。
 */
export function buildEquipRedDots(facts: readonly IEquipPartCostFacts[]): IEquipRedDots {
    const byPart = new Map<number, IEquipPartCostFacts>();
    for (const item of facts) byPart.set(item.partId, item);
    const parts: IEquipPartRedDots[] = [];
    let strengthen = false;
    let upgrade = false;
    let wash = false;
    for (let partId = 1; partId <= ROLE_EQUIP_PART_COUNT; partId += 1) {
        const fact = byPart.get(partId);
        const dots = fact
            ? equipPartRedDots(fact)
            : { partId, strengthen: false, upgrade: false, wash: false, any: false };
        parts.push(dots);
        strengthen = strengthen || dots.strengthen;
        upgrade = upgrade || dots.upgrade;
        wash = wash || dots.wash;
    }
    return { parts, strengthen, upgrade, wash, any: strengthen || upgrade || wash };
}

/** 空快照（缓存未就绪 / 取数失败时用，保证界面拿到的形状稳定）。 */
export function emptyEquipRedDots(): IEquipRedDots {
    return buildEquipRedDots([]);
}
