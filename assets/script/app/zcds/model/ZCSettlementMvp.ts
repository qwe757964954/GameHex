/**
 * 结算页「MVP」卡片的数据口径（纯 TS，规则 78：不许 import `cc`）。
 *
 * 设计稿（蓝湖「结算-MVP」720×1610）把结算面板重排成「标题 → MVP 卡片 → 段位 → 通关奖励」：
 * MVP 卡片卖的是**本局赢家阵营里输出最高的那张卡**——骨骼模型站在立绘位播 idle，
 * 旁边是 `Lv.x` + 卡名，下面两条「总输出 / 总承伤」进度条（各带百分比与数值）。
 *
 * 三处口径写死在这里，视图只负责摆 prefab：
 *   · 谁当选：**赢家阵营**内 `damage` 最大的卡；并列时取传入顺序在前的（席位序 = 本机在前）。
 *     平局 / 主动撤退没有胜方（`winner` 为空）⇒ 退化成「全场输出最高的卡」，
 *     否则这两种局面会把 MVP 整块藏掉；
 *   · 百分比：该卡输出（/ 承伤）占**全场所有卡合计**的比例，四舍五入到整数百分点；
 *   · 数值：`265700` → `265.7K`（千 / 百万两级，整数值不留 `.0`）。
 *
 * 全场总输出为 0（统计缺失 / 一枪没开）⇒ 不出卡：避免一张「0%」的假卡片。
 */
import { ZCOwner } from './ZCMapConfig';

/** 参与评选的一张卡（同一张卡的多只兵已在模型侧合并成一行）。*/
export interface IZCSettlementMvpCard {
    readonly owner: ZCOwner;
    /** 兵种 id（= `pvpCard.id`，模型 prefab 与数值都按它查）。*/
    readonly unitId: string;
    readonly cardId: string;
    readonly name: string;
    /** 骨骼模型 prefab 路径（`resources` 相对路径）；空串 = 只出文案不出模型。*/
    readonly prefabPath: string;
    /** 立绘位用的等比缩放（`pvpCard.gameEndPrefabSize`，已按结算上限收敛过）。*/
    readonly prefabSize: number;
    readonly damage: number;
    readonly damageTaken: number;
    /** 卡牌等级（服务端英雄等级）；≤0 = 不可知，等级行收起。*/
    readonly level: number;
}

/** 渲染层需要的全部文案与进度（视图不再自己算数）。*/
export interface IZCSettlementMvp {
    readonly owner: ZCOwner;
    readonly unitId: string;
    readonly cardId: string;
    readonly name: string;
    readonly prefabPath: string;
    /** 立绘位用的等比缩放（已收敛到 `gameEndPrefabSize`；见 `IZCSettlementMvpCard`）。*/
    readonly prefabSize: number;
    /** `Lv.15`；空串 = 本行不显示（本地局拿不到英雄等级）。*/
    readonly levelText: string;
    readonly dealtText: string;
    readonly dealtRate: number;
    readonly dealtRateText: string;
    readonly takenText: string;
    readonly takenRate: number;
    readonly takenRateText: string;
}

const THOUSAND = 1000;
const MILLION = 1000 * 1000;

/** 去掉一位小数的 `.0` 尾巴：`1.0K` → `1K`。*/
function trimFixed(text: string): string {
    return text.endsWith('.0') ? text.slice(0, -2) : text;
}

/**
 * 结算数值缩写：999 → `999`、1000 → `1K`、265700 → `265.7K`、1234567 → `1.2M`。
 * 负数与非有限值按 0（统计链上偶发 NaN 时不把 `NaN` 写进 UI）。
 */
export function formatSettlementAmount(value: number): string {
    const amount = Number.isFinite(value) ? Math.max(0, value) : 0;
    if (amount >= MILLION) return `${trimFixed((amount / MILLION).toFixed(1))}M`;
    if (amount >= THOUSAND) return `${trimFixed((amount / THOUSAND).toFixed(1))}K`;
    return String(Math.round(amount));
}

/** 占比 → 0~1（分母为 0 时给 0，避免 NaN 进 `fillRange`）。*/
function rateOf(part: number, total: number): number {
    if (total <= 0) return 0;
    return Math.max(0, Math.min(1, part / total));
}

function percentText(rate: number): string {
    return `${Math.round(rate * 100)}%`;
}

/**
 * 由本局逐卡统计构筑 MVP 卡片数据；不满足出卡条件返回 `null`。
 *
 * @param cards 逐卡统计（同一张卡的多个实例已合并；顺序 = 席位序 + 卡表序）
 * @param winner 本局胜方；`null`（平局 / 撤退）时退化为全场最高
 */
export function buildSettlementMvp(
    cards: readonly IZCSettlementMvpCard[],
    winner: ZCOwner | null,
): IZCSettlementMvp | null {
    if (!cards.length) return null;
    let totalDealt = 0;
    let totalTaken = 0;
    for (const card of cards) {
        totalDealt += Math.max(0, card.damage);
        totalTaken += Math.max(0, card.damageTaken);
    }
    if (totalDealt <= 0) return null;

    //  胜方阵营一张卡都没打输出（0 伤）时也退化：MVP 立绘位站一个 0 输出的卡没有意义，
    //  而全场总输出 > 0 说明这一局确实有人打过伤害，展示真正的输出王更符合设计稿语义。
    const side = winner ? cards.filter(card => card.owner === winner) : [];
    const pool = side.some(card => card.damage > 0) ? side : cards;
    let best = pool[0];
    for (const card of pool) {
        // 严格大于：并列时保留先出现的那位（席位序稳定，避免每次结算换人）。
        if (card.damage > best.damage) best = card;
    }

    const dealt = Math.max(0, best.damage);
    const taken = Math.max(0, best.damageTaken);
    const dealtRate = rateOf(dealt, totalDealt);
    const takenRate = rateOf(taken, totalTaken);
    return {
        owner: best.owner,
        unitId: best.unitId,
        cardId: best.cardId,
        name: best.name || best.cardId,
        prefabPath: best.prefabPath,
        prefabSize: best.prefabSize > 0 ? best.prefabSize : 1,
        levelText: best.level >= 1 ? `Lv.${Math.floor(best.level)}` : '',
        dealtText: formatSettlementAmount(dealt),
        dealtRate,
        dealtRateText: percentText(dealtRate),
        takenText: formatSettlementAmount(taken),
        takenRate,
        takenRateText: percentText(takenRate),
    };
}
