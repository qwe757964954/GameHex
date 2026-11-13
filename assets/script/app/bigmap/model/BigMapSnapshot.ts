/
 *当日战绩快照 —— 纯规则，零 `cc`、零 `Date`。
 *
 *文档口径：每日 21:00 锁榜、21:10 停攻、21:30 结算完成出快照。快照本身是客观可算的那一半：
 *把「今天打完的最终名次与战功」定格下来，供次日展示、也为将来的收益发放留位置。
 *
 * 刻意不做的两件事（口径未定，别在这里自作主张）：
 *1. 不发奖：文档只写了 21:30 推 `PushBigMapSnapshot{当日收益}`，「收益从哪来」没有定义，
 *   所以快照只记录成绩，不折算成资源；
 *2. 不清战功：「战功何时重置」在文档里没有唯一答案（占领后清零是已知规则，按日重置未定），
 *   快照只做记录，不碰 `battle.cityWarScore`。
 *
 *快照的幂等键是「业务日序号」：同一天只会出一份，21:30 不在线的话，次日凌晨上线补出
 *的仍是昨天那一份（见 `bigMapSnapshotDay`）。
 */
import type { IBigMapBattleProgress } from './BigMapBattle';
import { bigMapCityTimeline, type IBigMapCitySchedule } from './BigMapCitySchedule';

const SECONDS_PER_DAY = 86400;

/ 一座城在当日快照里的成绩。 */
export interface IBigMapCityDayScore {
    / 当日最终名次（喂名次系数的那一档）。 */
    readonly rank: number;
    readonly warScore: number;
}

/ 当日快照：21:30 定格，次日展示用。 */
export interface IBigMapDaySnapshot {
    / 业务日序号，用来做「一天只出一份」的幂等键。 */
    readonly day: number;
    / 生成时刻（逻辑秒）。 */
    readonly at: number;
    / 当日结束时的累计总积分。 */
    readonly totalWarScore: number;
    / `cityId → 成绩`。只收当日有战功的城，没打的城不进快照。 */
    readonly cities: Readonly<Record<string, IBigMapCityDayScore>>;
}

/ 本地日序号（已叠加时区偏移，与 `bigMapCityTimeline` 同一个折算口径）。 */
export function bigMapLocalDay(schedule: IBigMapCitySchedule, nowSeconds: number): number {
    if (!Number.isFinite(nowSeconds)) {
        throw new Error(`[BigMap] 快照收到非法时刻：${nowSeconds}`);
    }
    return Math.floor((nowSeconds + schedule.utcOffsetSeconds) / SECONDS_PER_DAY);
}

/
 *这一刻生成的快照属于哪一天的战绩。
 *
 *21:30 之后到午夜 = 今天的；午夜到次日 09:00 = 昨天的（那时今天的攻城还没开始）。
 */
export function bigMapSnapshotDay(schedule: IBigMapCitySchedule, nowSeconds: number): number {
    const timeline = bigMapCityTimeline(schedule, nowSeconds);
    const day = bigMapLocalDay(schedule, nowSeconds);
    const beforeOpen = timeline.phase === 'closed' && timeline.secondsOfDay < schedule.openAt;
    return beforeOpen ? day - 1 : day;
}

/
 *现在是否该出快照。
 *
 *只在「过了 21:30 快照点」或「次日开战前」为真；09:00~21:30 一律为假，
 *免得白天每帧 tick 都去算一份半成品。
 */
export function bigMapSnapshotDue(
    schedule: IBigMapCitySchedule,
    nowSeconds: number,
    last: IBigMapDaySnapshot | null,
): boolean {
    const timeline = bigMapCityTimeline(schedule, nowSeconds);
    if (timeline.phase !== 'closed') return false;
    const passedSnapshot = timeline.secondsOfDay >= schedule.snapshotAt;
    const beforeOpen = timeline.secondsOfDay < schedule.openAt;
    if (!passedSnapshot && !beforeOpen) return false;
    return !last || last.day !== bigMapSnapshotDay(schedule, nowSeconds);
}

/
 *造一份当日快照。
 *
 *@param rankOf 取某座城当前名次（Presenter 传榜单缓存，拿不到就用兜底榜）。
 */
export function buildBigMapDaySnapshot(
    schedule: IBigMapCitySchedule,
    nowSeconds: number,
    progress: IBigMapBattleProgress,
    rankOf: (cityId: number, warScore: number) => number,
): IBigMapDaySnapshot {
    const cities: Record<string, IBigMapCityDayScore> = {};
    for (const [key, rawScore] of Object.entries(progress.cityWarScore)) {
        const cityId = Number(key);
        const warScore = Math.round(Number(rawScore) || 0);
        //没打过的城不进快照：否则「昨日战绩」列表会塞满一串 0 分。
        if (!Number.isFinite(cityId) || warScore <= 0) continue;
        cities[key] = { rank: Math.max(1, Math.round(rankOf(cityId, warScore))), warScore };
    }
    return {
        day: bigMapSnapshotDay(schedule, nowSeconds),
        at: nowSeconds,
        totalWarScore: Math.round(progress.totalWarScore),
        cities,
    };
}

/ 快照里的城按战功降序（展示用，避免每次重排）。 */
export function sortSnapshotScores(
    snapshot: IBigMapDaySnapshot,
): readonly (readonly [number, IBigMapCityDayScore])[] {
    return Object.entries(snapshot.cities)
        .map(([key, score]) => [Number(key), score] as const)
        .sort((a, b) => b[1].warScore - a[1].warScore);
}
