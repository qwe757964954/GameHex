import type { ZCCardRarity } from './ZCCombatCatalog';
import { ZC_OWNER_ORDER, ZCOwner } from './ZCMapConfig';
import type { RankSeatProfiles } from './ZCRankBoard';

/** 统计页可切换的两列口径：造成伤害 / 承受伤害。*/
export type ZCDamageStatsMetric = 'damage' | 'taken';

/**
 * 战斗统计的一行（= 一张卡在某一席位的合并数据）。
 *
 * 同一张卡的多只兵合并成一行（与 `ZCGameModel.damageCards` 同口径）；
 * 不同席位即使抽到同一张卡也各占一行，避免把敌我数据混在一起。
 */
export interface IZCDamageStatsUnit {
    readonly owner: ZCOwner;
    readonly unitId: string;
    readonly cardId: string;
    readonly name: string;
    /** 卡表 `headIcon`（icon.json 的图标名；空 = 无头像）。*/
    readonly iconKey: string;
    /** 卡牌品级：头像底框按品级换色（金 / 紫 / 绿 / 蓝），取席位卡池的 `rarity`。*/
    readonly rarity: ZCCardRarity;
    readonly damage: number;
    readonly damageTaken: number;
    /**
     * 这张卡在**所属席位卡组里的下标**（0 起）；缺省 / 负数 = 不在卡组
     * （波次怪、中立怪、目录外单位）。
     *
     * 唯一的用途是「初始顺序」：进局时全员的数值都还是 0，此时按阵容序排列
     * （见 {@link compareDamageStatsRows}），而不是按首次产生伤害的先后乱序。
     */
    readonly deckOrder?: number;
}

/** 左右两列（我方 / 敌方）与各自的分母（该席位**全队合计**）。*/
export interface IZCDamageStatsColumns {
    readonly own: readonly IZCDamageStatsUnit[];
    readonly enemy: readonly IZCDamageStatsUnit[];
    /** 我方列合计：进度条分母 = 我方全队总伤害（或总承伤）。*/
    readonly totalOwn: number;
    /** 敌方列合计：只算当前选中的那一方，切头像时跟着换。*/
    readonly totalEnemy: number;
}

/**
 * 统计弹窗的席位上下文：敌方头像栏 + 默认选中。
 *
 * 由运行期/结算控制器随本局 `seatProfiles` 一起交出（`RankSeatProfiles` 是
 * 「席位 → 名字 / 头像」的唯一真源，排行榜与 HUD 用的是同一份）；缺省 ⇒ 弹窗不画头像栏、
 * 敌方列退回「全部敌方合并」的老口径。
 */
export interface IZCDamageStatsSeats {
    /** 本局参赛席位（`ZCGameModel.owners`，含玩家自己那一席）。*/
    readonly owners: readonly ZCOwner[];
    readonly profiles: RankSeatProfiles;
}

/** 进度条首位可见下限：真实占比更小时仍留一条细线，避免「有伤害但看起来是空条」。*/
export const ZC_DAMAGE_STATS_MIN_BAR_RATIO = 0.02;

/** 4 位数以内直接显示，10 万起收成 K，百万起收成 M（与设计稿 `265.7K` 同口径）。*/
export function formatDamageStatsValue(value: number): string {
    const normalized = normalize(value);
    if (normalized >= 1000000) return `${trimFixed(normalized / 1000000)}M`;
    if (normalized >= 100000) return `${trimFixed(normalized / 1000)}K`;
    return String(normalized);
}

/**
 * 行进度条比例 = 本行数值 ÷ 本列合计 ⇒ **占全队总量的占比**（11-24 用户口径）。
 *
 * 不是「按列内最大值发条」：那样第一名永远满格，看不出它到底占了全队多少。
 * 正数但占比过小时抬到 {@link ZC_DAMAGE_STATS_MIN_BAR_RATIO}，保证非零可见；
 * 分母为 0（开局全 0、单人局）⇒ 条全空。
 */
export function damageStatsBarRatio(value: number, total: number): number {
    const sum = normalize(total);
    const current = normalize(value);
    if (sum <= 0 || current <= 0) return 0;
    return Math.min(1, Math.max(ZC_DAMAGE_STATS_MIN_BAR_RATIO, current / sum));
}

/** 当前页签的数值（已做非负整数收敛）。*/
export function damageValueOf(unit: IZCDamageStatsUnit, metric: ZCDamageStatsMetric): number {
    return normalize(metric === 'damage' ? unit.damage : unit.damageTaken);
}

/** 该行是否来自阵容（有卡组下标）。*/
export function isDeckStatsUnit(unit: IZCDamageStatsUnit): boolean {
    return deckOrderOf(unit) >= 0;
}

/**
 * 排序口径：当前页签数值降序 → 阵容序升序 → 席位序 → 卡 id。
 *
 * 2026-11-24 需求：「进局默认按阵容排序，等战斗开始拿到实际数据再按数值降序」。
 * 这两段不需要一个「阶段开关」——开局所有行都是 0，数值比较全等，自然落到第二关键字
 * = 阵容序；一旦有人打出伤害，高数值的行就浮到上面，同数值的行仍按阵容序稳定排列
 * （不稳定会让虚拟列表每帧重排、行闪烁）。
 *
 * 不在阵容里的行（波次怪等）没有阵容下标，排在所有阵容卡之后，靠席位序 / 卡 id 收敛。
 */
export function compareDamageStatsRows(
    metric: ZCDamageStatsMetric,
): (a: IZCDamageStatsUnit, b: IZCDamageStatsUnit) => number {
    return (a, b) => {
        const value = damageValueOf(b, metric) - damageValueOf(a, metric);
        if (value !== 0) return value;
        const deck = deckRankOf(a) - deckRankOf(b);
        if (deck !== 0) return deck;
        const seat = seatRankOf(a.owner) - seatRankOf(b.owner);
        if (seat !== 0) return seat;
        return a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0;
    };
}

/**
 * 按当前页签把单位分到我方 / 敌方，并各自按 {@link compareDamageStatsRows} 排序。
 *
 * 收行口径（改过，别照抄旧注释）：**阵容内的卡一律保留**（含 0 伤害 / 0 承伤），
 * 阵容外的单位仍只在当前页签有数据时才出现 —— 否则开局面板是空的（11-24 现场：
 * 玩家打开统计面板，我方一栏什么都没有，得等第一波伤害才慢慢长出来）。
 *
 * @param enemyOwner 只收这一席的敌方行（头像栏选中的那一方）；
 *                   缺省 `null` = 全部非玩家席位合并（无席位上下文的旧调用方）。
 */
export function buildDamageStatsColumns(
    units: readonly IZCDamageStatsUnit[],
    metric: ZCDamageStatsMetric,
    enemyOwner: ZCOwner | null = null,
): IZCDamageStatsColumns {
    const own: IZCDamageStatsUnit[] = [];
    const enemy: IZCDamageStatsUnit[] = [];
    let totalOwn = 0;
    let totalEnemy = 0;
    for (const unit of units) {
        const value = damageValueOf(unit, metric);
        if (value <= 0 && !isDeckStatsUnit(unit)) continue;
        if (unit.owner === ZCOwner.Player) {
            own.push(unit);
            totalOwn += value;
        } else if (!enemyOwner || unit.owner === enemyOwner) {
            enemy.push(unit);
            totalEnemy += value;
        }
    }
    const compare = compareDamageStatsRows(metric);
    own.sort(compare);
    enemy.sort(compare);
    return { own, enemy, totalOwn, totalEnemy };
}

/**
 * 本局敌方席位（按席位序，从「id 小」到「id 大」）。
 *
 * 头像栏的显示顺序与默认选中都走这里。`owners` 是权威来源（席位表固定，某方还没打
 * 出伤害时也要列出它、也能切过去）；缺省时退回「`units` 里出现过的非玩家席位」。
 */
export function enemyOwnersOf(
    units: readonly IZCDamageStatsUnit[],
    owners?: readonly ZCOwner[],
): ZCOwner[] {
    const source = owners && owners.length ? owners : units.map(unit => unit.owner);
    const result: ZCOwner[] = [];
    for (const owner of source) {
        if (owner === ZCOwner.Player || result.indexOf(owner) >= 0) continue;
        result.push(owner);
    }
    result.sort((a, b) => seatRankOf(a) - seatRankOf(b));
    return result;
}

/** 默认选中的敌方 = 席位序最小的那一方（需求原话「默认选中 1 个 id 小的敌方」）；没有敌方 ⇒ `null`。*/
export function defaultEnemyOwner(
    units: readonly IZCDamageStatsUnit[],
    owners?: readonly ZCOwner[],
): ZCOwner | null {
    return enemyOwnersOf(units, owners)[0] ?? null;
}

function deckOrderOf(unit: IZCDamageStatsUnit): number {
    const order = Number(unit.deckOrder);
    return Number.isFinite(order) ? Math.floor(order) : -1;
}

/** 阵容序的比较键：不在阵容里的行排到所有阵容卡之后。*/
function deckRankOf(unit: IZCDamageStatsUnit): number {
    const order = deckOrderOf(unit);
    return order < 0 ? Number.MAX_SAFE_INTEGER : order;
}

/** 席位序（`player` → `enemy` → `enemy2` → `enemy3`）；未知席位排最后。*/
function seatRankOf(owner: ZCOwner): number {
    const index = ZC_OWNER_ORDER.indexOf(owner);
    return index < 0 ? ZC_OWNER_ORDER.length : index;
}

function normalize(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function trimFixed(value: number): string {
    return value.toFixed(1).replace(/\.0$/, '');
}
