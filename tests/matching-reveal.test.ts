/**
 * 匹配界面**逐条揭示**信息条的节奏（用户 2026-11-02）：
 *
 * > 匹配界面加载玩家数据可以随机逐个加载好，稍微有个 0.15~0.5s 的间隔
 *
 * 这里钉三件事：
 *  ① 间隔落在 `[0.15, 0.5]` 且是**随机**的（不是固定步长）；
 *  ② 第一条对手和"匹配成功"同一帧出现（否则服务端已回包、画面一条不动，读成没反应）；
 *  ③ 最坏情况（每次都抽到 0.5）的总时长**必须装得下**停留时间 1.4s，
 *     否则 4 人局的最后一条还没揭示，人就被带进战场了。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    MATCH_MATCHED_STAY_SECONDS,
    MATCH_REVEAL_GAP_MAX_SECONDS,
    MATCH_REVEAL_GAP_MIN_SECONDS,
    matchRevealDelays,
    matchRevealTotalSeconds,
} from '../assets/script/app/matching/MatchReveal';

const read = (path: string): string => readFileSync(new URL(`../assets/script/app/${path}`, import.meta.url), 'utf8');

test('间隔上下限就是需求里的 0.15 / 0.5 秒', () => {
    assert.equal(MATCH_REVEAL_GAP_MIN_SECONDS, 0.15);
    assert.equal(MATCH_REVEAL_GAP_MAX_SECONDS, 0.5);
    assert.equal(MATCH_MATCHED_STAY_SECONDS, 1.4);
});

test('第一条立刻出现，之后每条隔一个随机间隔', () => {
    const delays = matchRevealDelays(3, () => 0.5);
    assert.equal(delays.length, 3, '对手几条就排几个时间点');
    assert.equal(delays[0], 0, '第一个对手必须和"匹配成功"同帧');
    assert.ok(delays[1] > delays[0] && delays[2] > delays[1], '时间点必须严格递增');
    for (let index = 1; index < delays.length; index += 1) {
        const gap = delays[index] - delays[index - 1];
        assert.ok(gap >= MATCH_REVEAL_GAP_MIN_SECONDS - 1e-9 && gap <= MATCH_REVEAL_GAP_MAX_SECONDS + 1e-9,
            `第 ${index} 个间隔 ${gap} 不在 [0.15, 0.5]`);
    }
});

test('随机源取两端时的极端值：全 0 ⇒ 0.15，全 1 ⇒ 0.5', () => {
    assert.deepEqual(matchRevealDelays(4, () => 0), [0, 0.15, 0.3, 0.45]);
    assert.deepEqual(matchRevealDelays(4, () => 1), [0, 0.5, 1, 1.5]);
});

test('脏随机值当 0 处理（不许把 NaN 写进定时器）', () => {
    for (const value of [Number.NaN, -1, -0.5]) {
        const delays = matchRevealDelays(3, () => value);
        assert.equal(delays[1], MATCH_REVEAL_GAP_MIN_SECONDS);
    }
    // 超过 1 夹回 1
    assert.equal(matchRevealDelays(2, () => 9)[1], MATCH_REVEAL_GAP_MAX_SECONDS);
});

test('条数非法时不排（0 / 负数 / NaN / 小数都归一）', () => {
    assert.deepEqual(matchRevealDelays(0), []);
    assert.deepEqual(matchRevealDelays(-3), []);
    assert.deepEqual(matchRevealDelays(Number.NaN), []);
    assert.deepEqual(matchRevealDelays(2.7, () => 0), [0, 0.15]);
});

test('★★★最坏情况必须装得下停留时间（否则最后一条还没出来就被带走）', () => {
    // 本局最多 4 人 ⇒ 最多 3 个对手
    const worst = matchRevealTotalSeconds(3);
    assert.ok(worst < MATCH_MATCHED_STAY_SECONDS,
        `3 个对手最坏 ${worst}s，已经超过停留 ${MATCH_MATCHED_STAY_SECONDS}s`);
    // 顺带把边界说清楚：4 个对手（5 人局）就装不下了 —— 现在配色表只有 4 套，不存在
    assert.ok(matchRevealTotalSeconds(4) > MATCH_MATCHED_STAY_SECONDS,
        '上限算错了：匹配界面最多 4 条，对应对手 3 个');
});

test('★★★页面必须"逐条"揭示：没轮到的条目保持匹配中，不许一次全画上', () => {
    const page = read('matching/MatchingPage.ts');
    assert.ok(page.includes('matchRevealDelays'), '页面没用逐条节奏');
    assert.ok(page.includes('scheduleOnce(reveal'), '没有按时间点排揭示');
    assert.ok(page.includes('this.revealed'), '没有记录"哪条已经揭示"（重排会重播动画）');
    // 搜索态要撤销未揭示的条目（换局 / 回退都不会留半截数据）
    assert.ok(page.includes('this.revealToken += 1'), '切回搜索态没有作废在途的揭示');
    // 顺序揭示的条目在揭示前必须还是"放大镜"形态
    assert.ok(page.includes('setSearching(false)'), '揭示时没从"匹配中"切回数据态');
});

test('★★★条数仍然只由 MatchSlots 决定：节奏是视图的事，不许掺人数口径', () => {
    const reveal = read('matching/MatchReveal.ts');
    assert.ok(!reveal.includes('MATCH_MAX_PARTICIPANTS'), '揭示节奏不该知道"本局最多几个人"');
    assert.ok(!reveal.includes('slots'), '揭示节奏不该碰席位口径');
});
