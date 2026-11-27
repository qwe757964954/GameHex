type CompactUnit = readonly [divisor: number, suffix: string, threshold?: number];

const K = [1e3, 'K'] as const;
const M = [1e6, 'M'] as const;
const W = [1e4, 'W'] as const;
const K_ONLY = [K] as const;
const W_ONLY = [W] as const;
const KM = [M, K] as const;
const KMBT = [[1e12, 'T'], [1e9, 'B'], ...KM] as const;
const DAMAGE_STATS = [M, [K[0], K[1], 1e5]] as const;
const RANKING = [[1e9, 'G', 1e10], [M[0], M[1], 1e7], [K[0], 'k', 1e4]] as const;
const CHINESE = [[1e8, '亿'], [1e4, '万']] as const;

/** 按从大到小排列的档位缩写，调用方指定数值精度和原值的显示方式。 */
function formatCompact(
    value: number,
    units: readonly CompactUnit[],
    formatScaled: (value: number, divisor: number) => number | string,
    plainValue: number | string = Math.floor(value),
    magnitude = value,
): string {
    for (const [divisor, suffix, threshold = divisor] of units) {
        if (magnitude >= threshold) return `${formatScaled(value, divisor)}${suffix}`;
    }
    return String(plainValue);
}

function floorScaled(value: number, divisor: number): number {
    return Math.floor(value / divisor);
}

function floorScaledTenth(value: number, divisor: number): number {
    return Math.floor(value / (divisor / 10)) / 10;
}

function fixedScaledTenth(value: number, divisor: number): string {
    return (value / divisor).toFixed(1);
}

function roundScaledTenth(value: number, divisor: number): string {
    return fixedScaledTenth(value, divisor).replace(/\.0$/, '');
}

function roundScaledHundredth(value: number, divisor: number): string {
    return (value / divisor).toFixed(2).replace(/\.?0+$/, '');
}

function roundBattleScaled(value: number, divisor: number): number | string {
    const scaled = value / divisor;
    return scaled >= 100 ? Math.round(scaled) : roundScaledTenth(value, divisor);
}

function finiteOrZero(value: number): number {
    return Number.isFinite(value) ? value : 0;
}

/** 伤害统计从 10 万起缩写为 K，百万起用 M。 */
export function formatDamageStatsValue(value: number): string {
    const amount = Math.max(0, Math.floor(finiteOrZero(value)));
    return formatCompact(amount, DAMAGE_STATS, roundScaledTenth);
}

export function formatSettlementAmount(value: number): string {
    const amount = Math.max(0, finiteOrZero(value));
    return formatCompact(amount, KM, roundScaledTenth, Math.round(amount));
}

export function formatPowerText(value: number): string {
    const amount = Math.max(0, Math.floor(finiteOrZero(value)));
    return amount < 1e4 ? String(amount) : formatCompact(amount, KM, roundScaledHundredth);
}

export function formatBattleFloatAmount(value: number): string {
    const amount = Math.max(0, Math.ceil(value));
    if (Number.isNaN(amount)) return 'NaNT';
    return formatCompact(amount, KMBT, roundBattleScaled);
}

export function formatBigMapResourceAmount(value: number): string {
    return formatCompact(Math.floor(finiteOrZero(value)), K_ONLY, fixedScaledTenth);
}

/** 城池积分只用 K，小于阈值时保留服务端提供的文本。 */
export function formatCityScore(score: string): string {
    return formatCompact(Number(score), K_ONLY, floorScaled, score);
}

export function formatNumberToZH(value: number): string {
    return formatCompact(value, CHINESE, floorScaledTenth, undefined, Number.isNaN(value) ? Infinity : value);
}

export function formatNumberToKMBT(value: number): string {
    return value < 1e4 ? String(Math.floor(value)) : formatCompact(value, KMBT, floorScaled);
}

/**
 * 资源 / 货币读数：1 万以下原样，1 万起按 K/M/B/T 保留一位小数（向下取整）。
 *
 * 与老端资源栏 `BigNum.shortNum(value, 1)`（`bigNum` 表：9999 / 9999999 / 9999999999 / 1e12）
 * 同口径。货币读数不能按整数档截断 —— 1,900,000 必须读成 `1.9M`，`formatNumberToKMBT`
 * 那种整数截断会把它写成 `1M`，账面对不上。
 */
export function formatResourceAmount(value: number): string {
    const amount = Math.max(0, finiteOrZero(value));
    return amount < 1e4 ? String(Math.floor(amount)) : formatCompact(amount, KMBT, floorScaledTenth);
}

/** 旧版榜单按绝对值选档，缩放后的带符号数值向下取整。 */
export function formatLegacyRankAmount(value: number): string {
    return formatCompact(value, RANKING, floorScaled, undefined, Math.abs(value));
}

export function formatCelebrationRankAmount(value: number): string {
    return formatLegacyRankAmount(finiteOrZero(value));
}

export function formatNumberWithLimit(value: number, limit: number, divisor: number): string {
    if (!(value >= limit)) return String(value);
    return formatCompact(value, divisor === K[0] ? K_ONLY : W_ONLY, floorScaled, value);
}
