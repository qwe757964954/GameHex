/**
 * 匹配成功后**逐条揭示**玩家信息条的节奏（零 cc 纯函数）。
 *
 * 需求（2026-11-02 用户）：
 * > 匹配界面加载玩家数据可以随机逐个加载好，稍微有个 0.15~0.5s 的间隔
 *
 * ## 口径
 *
 * · **我方（slot 0）立刻出现**：那是玩家自己的数据，本来就在手上，等一秒只会显得卡；
 * · **第一个对手也立刻出现**：和"匹配成功"同一帧。否则服务端已经回包、标题已经翻成
 *   「匹配成功」，画面却一条都没变，玩家会读成"没反应"；
 * · 之后**每个**对手等一个 `[0.15, 0.5]` 的**随机**间隔，一条一条弹出来 —— 这正是
 *   "随机逐个加载"：间隔不是固定的，玩家不会觉得在读进度条。
 *
 * ## 总时长必须装得下
 *
 * 最坏情况 = (席位数 − 2) × {@link MATCH_REVEAL_GAP_MAX_SECONDS} ≤ **1.0s**，
 * 必须小于 {@link MATCH_MATCHED_STAY_SECONDS}（1.4s，匹配成功后停留多久就交接走）。
 * 装不下的话最后一条还没揭示，玩家就被带进战场了 —— 4 人局的第 4 条会"闪一下就没了"。
 * 这个不等式由 `tests/matching-reveal.test.ts` 钉住。
 *
 * ⚠️ 这是**视图节奏**，不是人数口径：条数仍然只由 `MatchSlots.matchSlotCount` 决定。
 */

/** 两条之间的最短间隔（秒）。 */
export const MATCH_REVEAL_GAP_MIN_SECONDS = 0.15;

/** 两条之间的最长间隔（秒）。 */
export const MATCH_REVEAL_GAP_MAX_SECONDS = 0.5;

/** 匹配成功后停留多久再交接（秒）。`MatchingController` 用它排 `matched` 那一档。 */
export const MATCH_MATCHED_STAY_SECONDS = 1.4;

/** 逐条揭示时的一次小回弹（从 0.92 倍回到 1 倍，见 `MatchPlayerItem.popIn`）。 */
export const MATCH_REVEAL_POP_SCALE = 0.92;

/** 回弹时长（秒）。要明显短于最短间隔，否则两条会叠在一起动。 */
export const MATCH_REVEAL_POP_SECONDS = 0.12;

function unit(value: number): number {
    if (!Number.isFinite(value)) return 0;
    if (value <= 0) return 0;
    return value >= 1 ? 1 : value;
}

/**
 * 逐条出现的时间点（秒，相对"匹配成功"那一刻）。
 *
 * @param count  要出现的条数（= 对手数量，不含我方）
 * @param random 随机源，默认 `Math.random`；用例传固定值就能得到确定结果
 * @returns 长度 = `count` 的数组，`[0]` 恒为 0，之后严格递增
 */
export function matchRevealDelays(count: number, random: () => number = Math.random): number[] {
    const total = Math.max(0, Math.floor(Number(count) || 0));
    const delays: number[] = [];
    let at = 0;
    for (let index = 0; index < total; index += 1) {
        if (index > 0) {
            const span = MATCH_REVEAL_GAP_MAX_SECONDS - MATCH_REVEAL_GAP_MIN_SECONDS;
            at += MATCH_REVEAL_GAP_MIN_SECONDS + unit(random()) * span;
        }
        // 只对输出取整（累加用原值）：浮点尾数进 `scheduleOnce` 无所谓，
        // 但用例要能逐字比对，视觉上也看得出"不是固定步长"。
        delays.push(Math.round(at * 1000) / 1000);
    }
    return delays;
}

/** 揭示全部对手需要多久（秒）；给用例校验"装得下停留时间"。 */
export function matchRevealTotalSeconds(count: number): number {
    const delays = matchRevealDelays(count, () => 1);
    return delays.length ? delays[delays.length - 1] : 0;
}
