import { ZCCardRarity, ZCDeckBonuses, ZCDeckCard, ZCCardTraits } from '../zcds/model/ZCCombatCatalog';
import { CARD_LINEUP_TEXTS } from './CardLineupTexts';

/**
 * 卡牌阵容界面视图契约与美术名映射。
 * 数据来自 pvpCard.json / pvpBond.json，这里只做美术名与卡牌分类翻译。
 */

/** 卡牌职业：战士 / 坦克 / 射手 / 法师。 */
export type ZCCardClass = 'warrior' | 'tank' | 'archer' | 'mage';

/** 固定顺序（设计稿从左到右：剑 / 法杖 / 弓 / 盾）。 */
export const ZC_CARD_CLASSES: readonly ZCCardClass[] = ['warrior', 'mage', 'archer', 'tank'];

export const ZC_CARD_CLASS_NAMES: Readonly<Record<ZCCardClass, string>> = {
    warrior: '战士', mage: '法师', archer: '射手', tank: '坦克',
};

/** traits.attack 取值 → 职业。无 traits 的卡（金矿）归坦克占位。 */
const ATTACK_TRAIT_CLASS: Readonly<Record<string, ZCCardClass>> = {
    战士: 'warrior', 法师: 'mage', 射手: 'archer', 坦克: 'tank',
};

export function resolveCardClass(card: ZCDeckCard): ZCCardClass {
    return ATTACK_TRAIT_CLASS[card.traits?.attack ?? ''] ?? 'tank';
}

/**
 * 卡牌美术复用键。头像按卡区分，键里必须带 headIcon，否则同品级同职业会串头像。
 */
export function cardArtKey(card: ZCDeckCard): string {
    return `${card.rarity}|${resolveCardClass(card)}|${card.headIcon ?? ''}`;
}

/** 职业 → 营地雕像（icons/card 下）。 */
export function resolveHeroArt(cardClass: ZCCardClass): string {
    return `camp_${cardClass}`;
}

/** 职业 → 布阵 Q 版立绘。目前只有两张，按物理/法术二分，美术补齐后只改此表。 */
export const BOARD_HERO_ART: Readonly<Record<ZCCardClass, string>> = {
    warrior: 'char_01', archer: 'char_01', mage: 'char_02', tank: 'char_02',
};

/** 品级 → 布阵卡池卡框。 */
export const POOL_FRAME_ART: Readonly<Record<ZCCardRarity, string>> = {
    金: 'common_img_pzk_01', 紫: 'common_img_pzk_02', 绿: 'common_img_pzk_03', 蓝: 'common_img_pzk_04',
};

/** 品级 → 卡面底图。01=金 02=紫 03=绿 04=蓝。 */
export const CARD_FACE_ART: Readonly<Record<ZCCardRarity, string>> = {
    金: 'common_img_kp_01', 紫: 'common_img_kp_02', 绿: 'common_img_kp_03', 蓝: 'common_img_kp_04',
};

/** 品级 → 站台彩色垫盘。 */
export const STAGE_DISC_ART: Readonly<Record<ZCCardRarity, string>> = {
    金: 'kpzr_di_01', 紫: 'kpzr_di_02', 绿: 'kpzr_di_03', 蓝: 'kpzr_di_04',
};

/** 职业 → 卡面左上角角标。 */
export const CLASS_BADGE_ART: Readonly<Record<ZCCardClass, string>> = {
    warrior: 'class_warrior', tank: 'class_tank', archer: 'class_archer', mage: 'class_mage',
};

/** 职业 → 中栏亮态图标。 */
export const CLASS_ICON_ON_ART: Readonly<Record<ZCCardClass, string>> = {
    warrior: 'common_img_zhanshi01', mage: 'common_img_fashi02',
    archer: 'common_img_sheshou_01', tank: 'common_img_tanke_01',
};

/** 职业 → 中栏灰态图标。 */
export const CLASS_ICON_OFF_ART: Readonly<Record<ZCCardClass, string>> = {
    warrior: 'common_img_zhanshi02', mage: 'common_img_gh_fashi01',
    archer: 'common_img_sheshou_02', tank: 'common_img_tanke_02',
};

/** 卡牌阵营（traits.camp）：花果 / 蘑菇 / 盆栽 / 僵尸。与职业是两个维度。 */
export type ZCCardCamp = 'huaguo' | 'mogu' | 'penzai' | 'jiangshi';

export const ZC_CARD_CAMPS: readonly ZCCardCamp[] = ['huaguo', 'mogu', 'penzai', 'jiangshi'];

export const ZC_CARD_CAMP_NAMES: Readonly<Record<ZCCardCamp, string>> = {
    huaguo: '花果', mogu: '蘑菇', penzai: '盆栽', jiangshi: '僵尸',
};

const CAMP_TRAIT_CAMP: Readonly<Record<string, ZCCardCamp>> = {
    花果: 'huaguo', 蘑菇: 'mogu', 盆栽: 'penzai', 僵尸: 'jiangshi',
};

/** 无 traits 的卡返回 null（不参与统计）。 */
export function resolveCardCamp(card: ZCDeckCard): ZCCardCamp | null {
    return CAMP_TRAIT_CAMP[card.traits?.camp ?? ''] ?? null;
}

/**
 * 阵营 → 图标行图标。美术补齐后只改此表。
 * 加载失败时条目保留占位图（已知降级）。
 */
export const CAMP_ICON_ON_ART: Readonly<Record<ZCCardCamp, string>> = {
    huaguo: 'common_img_huaguo', mogu: 'common_img_mogu',
    penzai: 'common_img_penzai', jiangshi: 'common_img_jiangshi',
};

/** 中栏一项：某职业在阵容里的卡数。 */
export interface ZCClassTally {
    cardClass: ZCCardClass;
    count: number;
    reached: boolean;
}

export function tallyDeckClasses(deck: readonly ZCDeckCard[]): ZCClassTally[] {
    return ZC_CARD_CLASSES.map((cardClass) => {
        const count = deck.filter((card) => resolveCardClass(card) === cardClass).length;
        return { cardClass, count, reached: count > 0 };
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

/** 图标行全部条目：先 4 职业、再 4 阵营。卡数之和不等于 8（一张卡同时贡献两类）。 */
export function tallyDeckIcons(deck: readonly ZCDeckCard[]): ZCCardTally[] {
    const classItems: ZCCardTally[] = tallyDeckClasses(deck).map((tally) => ({
        kind: 'class', key: tally.cardClass, name: ZC_CARD_CLASS_NAMES[tally.cardClass],
        count: tally.count, reached: tally.reached,
    }));
    const campItems: ZCCardTally[] = ZC_CARD_CAMPS.map((camp) => {
        const count = deck.filter((card) => resolveCardCamp(card) === camp).length;
        return { kind: 'camp', key: camp, name: ZC_CARD_CAMP_NAMES[camp], count, reached: count > 0 };
    });
    return classItems.concat(campItems);
}

/** 列表实际显示条目：滤掉卡数为 0 的。条目数跟着阵容变，不能写死。 */
export function visibleIconTallies(deck: readonly ZCDeckCard[]): ZCCardTally[] {
    return tallyDeckIcons(deck).filter((item) => item.count > 0);
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
