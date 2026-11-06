import { ZCCardType } from '../zcds/model/ZCCombatCatalog';
import type { ZCCardRarity, ZCDeckBonuses, ZCDeckCard, ZCCardTraits } from '../zcds/model/ZCCombatCatalog';
import type { ICardLineupCatalog } from './CardArtConfig';
import { CARD_LINEUP_TEXTS } from './CardLineupTexts';

/**
 * 卡牌阵容界面视图契约与美术名映射。
 * 数据来自 pvpCard.json / pvpBond.json；维度名称、traits 归一化与列表排序权重来自
 * `PVP-卡牌美术.xlsx` 的 `name` / `sort` 列（`ICardArtConfig.lineup`）。
 */

/**
 * 卡牌职业：战士 / 坦克 / 射手 / 法师。
 *
 * 这份数组是**编译期白名单**：表 `cardUiArtClass` 的行集合必须与它一致，
 * 少一行会在解析时报缺少映射，多一行报「未知职业」（`tests/card-art-config.test.ts` 双向核对）。
 */
const CARD_CLASS_IDS = ['warrior', 'mage', 'archer', 'tank'] as const;
export type ZCCardClass = (typeof CARD_CLASS_IDS)[number];
export const ZC_CARD_CLASSES: readonly ZCCardClass[] = CARD_CLASS_IDS;

/**
 * 品级：唯一字面量在 `ZCCombatCatalog`（档位与展示名都在那儿，对局层也在用），
 * 这里只 re-export 保持卡牌侧的引用面，不再存第二份数组。
 */
export { ZC_CARD_RARITIES } from '../zcds/model/ZCCombatCatalog';

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

/** 已上阵 > 已解锁 > 解锁中（未解锁但有碎片）> 未获得；同组依次比较品质、等级、职业。 */
export function sortLineupCards(
    cards: readonly ZCDeckCard[],
    deployedIds: ReadonlySet<string>,
    heroLevels: ReadonlyMap<string, number>,
    fragments: ReadonlyMap<string, { readonly owned: number }>,
    lineup: ICardLineupCatalog,
    fallbackLevel = 0,
): ZCDeckCard[] {
    const levelOf = (card: ZCDeckCard): number => heroLevels.get(card.id) ?? fallbackLevel;
    const groupOf = (card: ZCDeckCard): number => {
        if (deployedIds.has(card.id)) return 0;
        if (levelOf(card) > 0) return 1;
        return (fragments.get(card.id)?.owned ?? 0) > 0 ? 2 : 3;
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
 * 卡牌阵营（traits.camp）：花果 / 蘑菇 / 盆栽 / 僵尸。与职业是两个维度。
 * 同样只保留一份字面量，类型由数组推导；表 `cardUiArtCamp` 的行集合必须与它一致。
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

/** 品级的中文显示名（表 `cardUiArtRarity.name`，普通/稀有/史诗/传说）。 */
export function cardRarityName(rarity: ZCCardRarity, lineup: ICardLineupCatalog): string {
    return lineup.rarities.find((meta) => meta.id === rarity)?.name ?? '';
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

/** 一条羁绊展示数据。 */
export interface ZCBondLine {
    id: string;
    name: string;
    condition: string;
    effect: string;
    active: boolean;
    matched: number;
    threshold: number;
    trait: keyof ZCCardTraits;
}

/** 倍率型效果才进百分比合计；金币收入是绝对值。 */
export function isPercentBond(effectType: string): boolean {
    return effectType !== 'income';
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
