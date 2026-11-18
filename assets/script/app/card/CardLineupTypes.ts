import { ZCCardType, ZC_CARD_RARITIES } from '../zcds/model/ZCCombatCatalog';
import type { ZCCardRarity, ZCDeckBonuses, ZCDeckCard } from '../zcds/model/ZCCombatCatalog';
import type { ICardLineupCatalog } from './CardArtConfig';
import { CARD_LINEUP_TEXTS } from './CardLineupTexts';

/**
 * 阵容页的视图契约和美术名映射。
 * 数据来自 pvpCard/pvpBond，维度名称和排序权重来自 PVP-卡牌美术.xlsx 的 name/sort 列。
 */

/**
 * 职业白名单：表 cardUiArtClass 必须和它对上，少一行或多一行都报错。
 */
const CARD_CLASS_IDS = ['warrior', 'mage', 'archer', 'tank'] as const;
export type ZCCardClass = (typeof CARD_CLASS_IDS)[number];
export const ZC_CARD_CLASSES: readonly ZCCardClass[] = CARD_CLASS_IDS;

/**
 * 品级：唯一字面量在 `ZCCombatCatalog`（档位与展示名都在那儿，对局层也在用），
 * 这里只 re-export 保持卡牌侧的引用面，不再存第二份数组。
 */
export { ZC_CARD_RARITIES };

/** 无 traits 的卡（金矿）与未知 traits 值的兜底职业。 */
const FALLBACK_CARD_CLASS: ZCCardClass = 'tank';

/** `traits.attack` 的中文名 → 职业，映射来自表内 `cardUiArtClass.name`。 */
export function resolveCardClass(card: ZCDeckCard, lineup: ICardLineupCatalog): ZCCardClass {
    return lineup.classOfTrait(card.traits?.attack ?? '') ?? FALLBACK_CARD_CLASS;
}

/** 仅筛选阵容页展示，不修改实际出战阵型与对局卡库。 */
export function visibleLineupCards(cards: readonly ZCDeckCard[]): ZCDeckCard[] {
    return cards.filter(card => card.type !== ZCCardType.Mine);
}

/**
 * 排序分组：**可升级 > 已上阵 > 已解锁 > 解锁中（未解锁但有碎片）> 未获得**；
 * 同组依次比较品质、等级、职业。
 *
 * 可升级排最前是用户 2026-11-17 第 16 条 ③ 的要求：引导第 6-2 步要在卡库里指出豌豆游侠，
 * 而卡库是横向列表 —— 目标卡排在后面就压根不在渲染窗口里，光圈挖不出来（表现为「没有高亮」）。
 * 判据与条目上的「可升级箭头」完全同源（`CardLineupCard.render`）：
 * 已解锁 + 未满级 + 所需碎片 > 0 + 持有 ≥ 所需。
 */
export function sortLineupCards(
    cards: readonly ZCDeckCard[],
    deployedIds: ReadonlySet<string>,
    heroLevels: ReadonlyMap<string, number>,
    fragments: ReadonlyMap<string, { readonly owned: number; readonly need?: number; readonly maxed?: boolean }>,
    lineup: ICardLineupCatalog,
    fallbackLevel = 0,
): ZCDeckCard[] {
    const levelOf = (card: ZCDeckCard): number => heroLevels.get(card.id) ?? fallbackLevel;
    const upgradable = (card: ZCDeckCard): boolean => {
        const progress = fragments.get(card.id);
        if (!progress || progress.maxed || levelOf(card) <= 0) return false;
        const need = progress.need ?? 0;
        return need > 0 && progress.owned >= need;
    };
    const groupOf = (card: ZCDeckCard): number => {
        if (upgradable(card)) return 0;
        if (deployedIds.has(card.id)) return 1;
        if (levelOf(card) > 0) return 2;
        return (fragments.get(card.id)?.owned ?? 0) > 0 ? 3 : 4;
    };
    //  权重来自表 `sort` 列；表里没覆盖到的取值排到最后，不抛错（不阻断列表）。
    const rarityRank = new Map(lineup.rarities.map((meta) => [meta.id, meta.sort]));
    const classRank = new Map(lineup.classes.map((meta) => [meta.id, meta.sort]));
    const rankOf = (ranks: ReadonlyMap<ZCCardRarity | ZCCardClass, number>, key: ZCCardRarity | ZCCardClass): number =>
        ranks.get(key) ?? Number.MAX_SAFE_INTEGER;
    return cards.slice().sort((a, b) => groupOf(a) - groupOf(b)
        || rankOf(rarityRank, a.rarity) - rankOf(rarityRank, b.rarity)
        || levelOf(b) - levelOf(a)
        || rankOf(classRank, resolveCardClass(a, lineup)) - rankOf(classRank, resolveCardClass(b, lineup)));
}

/**
 * 阵营白名单，和职业是两个维度；表 cardUiArtCamp 必须对得上。
 */
const CARD_CAMP_IDS = ['huaguo', 'mogu', 'penzai', 'jiangshi'] as const;
export type ZCCardCamp = (typeof CARD_CAMP_IDS)[number];
export const ZC_CARD_CAMPS: readonly ZCCardCamp[] = CARD_CAMP_IDS;

/** `traits.camp` 的中文名 → 阵营，映射来自表内 `cardUiArtCamp.name`。 */
export function resolveCardCamp(card: ZCDeckCard, lineup: ICardLineupCatalog): ZCCardCamp | null {
    return lineup.campOfTrait(card.traits?.camp ?? '');
}

/** 职业的中文显示名（表 `cardUiArtClass.name`）。 */
export function cardClassName(cardClass: ZCCardClass, lineup: ICardLineupCatalog): string {
    return lineup.classes.find((meta) => meta.id === cardClass)?.name ?? '';
}

/** 阵营的中文显示名（表 `cardUiArtCamp.name`）。 */
export function cardCampName(camp: ZCCardCamp, lineup: ICardLineupCatalog): string {
    return lineup.camps.find((meta) => meta.id === camp)?.name ?? '';
}

/** 中栏一项：某职业在阵容里的卡数。 */
export interface ZCClassTally {
    cardClass: ZCCardClass;
    count: number;
    reached: boolean;
}

/** 遍历顺序即表行序（`lineup.classes`）。 */
export function tallyDeckClasses(deck: readonly ZCDeckCard[], lineup: ICardLineupCatalog): ZCClassTally[] {
    return lineup.classes.map((meta) => {
        const count = deck.filter((card) => resolveCardClass(card, lineup) === meta.id).length;
        return { cardClass: meta.id, count, reached: count > 0 };
    });
}

/**
 * 阵容是否完整：上阵数够，且每个品级至少一张。
 * 只看 pvpCard.rarity，不看美术表，表缺行不该影响这个判断。
 */
export function isCompleteLineup(deck: readonly ZCDeckCard[], slotLimit: number): boolean {
    if (deck.length < Math.max(1, Math.round(slotLimit))) return false;
    const present = new Set(deck.map((card) => card.rarity));
    return ZC_CARD_RARITIES.every((rarity) => present.has(rarity));
}

/** 图标行一项：某维度取值在阵容里的卡数。职业和阵营共用条目预制体。 */
export interface ZCCardTally {
    kind: 'class' | 'camp';
    key: string;
    name: string;
    count: number;
    reached: boolean;
}

/** 图标行全部条目：先职业、再阵营（顺序取表行序）。卡数之和不等于 8（一张卡同时贡献两类）。 */
export function tallyDeckIcons(deck: readonly ZCDeckCard[], lineup: ICardLineupCatalog): ZCCardTally[] {
    const classItems: ZCCardTally[] = lineup.classes.map((meta) => {
        const count = deck.filter((card) => resolveCardClass(card, lineup) === meta.id).length;
        return { kind: 'class', key: meta.id, name: meta.name, count, reached: count > 0 };
    });
    const campItems: ZCCardTally[] = lineup.camps.map((meta) => {
        const count = deck.filter((card) => resolveCardCamp(card, lineup) === meta.id).length;
        return { kind: 'camp', key: meta.id, name: meta.name, count, reached: count > 0 };
    });
    return classItems.concat(campItems);
}

/** 列表实际显示条目：滤掉卡数为 0 的。条目数跟着阵容变，不能写死。 */
export function visibleIconTallies(deck: readonly ZCDeckCard[], lineup: ICardLineupCatalog): ZCCardTally[] {
    return tallyDeckIcons(deck, lineup).filter((item) => item.count > 0);
}

/**
 * 羁绊加成条标题：取第一条生效羁绊名 + 冒号；无生效羁绊退回通用标题。
 * activeBonds 存的是羁绊名（rule.name），不是 id。
 */
export function activeBondTitle(bonuses: ZCDeckBonuses): string {
    const first = bonuses.activeBonds[0];
    return first ? `${first}${CARD_LINEUP_TEXTS.bondTitleSuffix}` : CARD_LINEUP_TEXTS.bondBonusTitle;
}

/** 羁绊百分比合计：生命/攻击/移速/产兵间隔/塔攻击倍率。 */
export function bondPercentTotal(bonuses: ZCDeckBonuses): number {
    return bonuses.unitHpMultiplier - 1
        + (bonuses.unitAttackMultiplier - 1)
        + (bonuses.moveSpeedMultiplier - 1)
        + (1 - bonuses.spawnIntervalMultiplier)
        + (bonuses.towerAttackMultiplier - 1);
}
