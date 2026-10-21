/**
 * 城池攻城日程（`BigMapCitySchedule`）的回归测试。
 *
 * 关注点都是「错了会全服发错奖 / 玩家打不了」的规则：
 * 1. 四个切换时点必须**逐秒精确**（提前 1 秒进下阶段就会让锁榜后的攻击仍计分）；
 * 2. `closed` 段横跨午夜，`remainSeconds` 要跨到**次日** 09:00；
 * 3. 时钟是 UTC 秒、日程是本地时间，时区换算必须落在同一处；
 * 4. 日程写错要当场抛错，不能静默退化成「永远可打」。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_BIGMAP_CITY_SCHEDULE,
    bigMapCityAttackGate,
    bigMapCityTimeline,
    parseBigMapClockTime,
    type BigMapCityPhase,
} from '../assets/script/app/bigmap/model/BigMapCitySchedule';
import type { BigMapCityState } from '../assets/script/app/bigmap/model/BigMapTypes';
import { loadBigMapConfig } from './helpers/bigmap-fixtures';

const OFFSET = DEFAULT_BIGMAP_CITY_SCHEDULE.utcOffsetSeconds;

/** 造一个「本地时刻恰好是 localSeconds 当日秒」的 UTC 时间戳（可跨负值，模块自己折回）。 */
function atLocal(localSeconds: number): number {
    return localSeconds - OFFSET;
}

function phaseAt(localSeconds: number): BigMapCityPhase {
    return bigMapCityTimeline(DEFAULT_BIGMAP_CITY_SCHEDULE, atLocal(localSeconds)).phase;
}

test('四个切换时点逐秒精确：08:59:59 / 09:00 / 20:59:59 / 21:00 / 21:10 / 22:00', () => {
    assert.equal(phaseAt(8 * 3600 + 59 * 60 + 59), 'closed');
    assert.equal(phaseAt(9 * 3600), 'prepare');
    assert.equal(phaseAt(20 * 3600 + 59 * 60 + 59), 'prepare');
    assert.equal(phaseAt(21 * 3600), 'locked');
    assert.equal(phaseAt(21 * 3600 + 10 * 60), 'settling');
    assert.equal(phaseAt(22 * 3600), 'closed');
});

test('remainSeconds 指向下一阶段，且 closed 段跨到次日 09:00', () => {
    const beforeOpen = bigMapCityTimeline(DEFAULT_BIGMAP_CITY_SCHEDULE, atLocal(8 * 3600 + 59 * 60 + 59));
    assert.equal(beforeOpen.remainSeconds, 1);

    const open = bigMapCityTimeline(DEFAULT_BIGMAP_CITY_SCHEDULE, atLocal(9 * 3600));
    assert.equal(open.remainSeconds, 12 * 3600, '09:00 到 21:00 锁榜 = 12 小时');

    const locked = bigMapCityTimeline(DEFAULT_BIGMAP_CITY_SCHEDULE, atLocal(21 * 3600));
    assert.equal(locked.remainSeconds, 10 * 60, '锁榜到结算 = 10 分钟');

    const settling = bigMapCityTimeline(DEFAULT_BIGMAP_CITY_SCHEDULE, atLocal(21 * 3600 + 10 * 60));
    assert.equal(settling.remainSeconds, 50 * 60);

    // 22:00 之后到今天结束，再到次日 09:00：2h + 9h = 11h。
    const night = bigMapCityTimeline(DEFAULT_BIGMAP_CITY_SCHEDULE, atLocal(22 * 3600));
    assert.equal(night.phase, 'closed');
    assert.equal(night.remainSeconds, 11 * 3600);
    // 23:00 同理，只剩 10h。
    assert.equal(bigMapCityTimeline(DEFAULT_BIGMAP_CITY_SCHEDULE, atLocal(23 * 3600)).remainSeconds, 10 * 3600);
    // 午夜 00:30 仍在 closed，距 09:00 = 8.5h。
    assert.equal(bigMapCityTimeline(DEFAULT_BIGMAP_CITY_SCHEDULE, atLocal(30 * 60)).remainSeconds, 8.5 * 3600);
});

test('remain 与 phase 自洽：secondsOfDay + remain 恰好落在下一阶段', () => {
    for (let local = 0; local < 86400; local += 137) {
        const timeline = bigMapCityTimeline(DEFAULT_BIGMAP_CITY_SCHEDULE, atLocal(local));
        assert.equal(timeline.secondsOfDay, local);
        assert.ok(timeline.remainSeconds > 0, `${local} 秒处的 remain 必须为正`);
        const boundary = (local + timeline.remainSeconds) % 86400;
        const expected =
            timeline.phase === 'closed' ? DEFAULT_BIGMAP_CITY_SCHEDULE.openAt
                : timeline.phase === 'prepare' ? DEFAULT_BIGMAP_CITY_SCHEDULE.lockAt
                    : timeline.phase === 'locked' ? DEFAULT_BIGMAP_CITY_SCHEDULE.settleAt
                        : DEFAULT_BIGMAP_CITY_SCHEDULE.snapshotAt;
        assert.equal(boundary, expected, `${local} 秒处的下一阶段边界不对`);
    }
});

test('计分与攻打两个判据分离：锁榜后还能打但不再计分', () => {
    const prepare = bigMapCityTimeline(DEFAULT_BIGMAP_CITY_SCHEDULE, atLocal(15 * 3600));
    assert.deepEqual([prepare.canAttack, prepare.canScore], [true, true]);

    const locked = bigMapCityTimeline(DEFAULT_BIGMAP_CITY_SCHEDULE, atLocal(21 * 3600 + 60));
    assert.deepEqual([locked.canAttack, locked.canScore], [true, false], '21:00-21:10 只停计分');

    for (const local of [21 * 3600 + 10 * 60, 22 * 3600, 3 * 3600]) {
        const timeline = bigMapCityTimeline(DEFAULT_BIGMAP_CITY_SCHEDULE, atLocal(local));
        assert.deepEqual([timeline.canAttack, timeline.canScore], [false, false], `${local} 秒处不该能打`);
    }
});

test('时钟是 UTC 秒、日程是本地时间：时区换算只在这一处', () => {
    // UTC 01:00 == 东八区 09:00，必须已经开战。
    assert.equal(bigMapCityTimeline(DEFAULT_BIGMAP_CITY_SCHEDULE, 3600).phase, 'prepare');
    // 换一个时区（UTC+0 的日程）看同一时刻：01:00 还在休战。
    const utc = { ...DEFAULT_BIGMAP_CITY_SCHEDULE, utcOffsetSeconds: 0 };
    assert.equal(bigMapCityTimeline(utc, 3600).phase, 'closed');
    // 负时间戳也要能折回当天（存档回拨 / 测试夹具会遇到）。
    assert.equal(bigMapCityTimeline(DEFAULT_BIGMAP_CITY_SCHEDULE, atLocal(9 * 3600) - 86400 * 3).phase, 'prepare');
});

test('日程写错当场抛错，不静默退化成永远可打', () => {
    const base = DEFAULT_BIGMAP_CITY_SCHEDULE;
    assert.throws(() => bigMapCityTimeline({ ...base, lockAt: 8 * 3600 }, 0), /倒挂/);
    assert.throws(() => bigMapCityTimeline({ ...base, snapshotAt: 86400 }, 0), /86400/);
    assert.throws(() => bigMapCityTimeline({ ...base, openAt: Number.NaN }, 0), /86400/);
    assert.throws(() => bigMapCityTimeline(base, Number.NaN), /非法时刻/);
});

test('城池攻击门：五态与日程合起来只放行「已开放 + 阶段允许」', () => {
    const prepare = bigMapCityTimeline(DEFAULT_BIGMAP_CITY_SCHEDULE, atLocal(15 * 3600));
    const closed = bigMapCityTimeline(DEFAULT_BIGMAP_CITY_SCHEDULE, atLocal(3 * 3600));
    const states: readonly BigMapCityState[] = ['locked', 'open', 'breached', 'occupied', 'unavailable'];

    const open = states.map((state) => bigMapCityAttackGate(state, prepare));
    assert.equal(open.filter((gate) => gate.canAttack).length, 1, '只有 open 态能打');
    assert.equal(open[states.indexOf('open')].canAttack, true);
    assert.equal(open[states.indexOf('open')].reason, '');

    const night = states.map((state) => bigMapCityAttackGate(state, closed));
    assert.equal(night.some((gate) => gate.canAttack), false, '休战期全都不放行');
    assert.match(night[states.indexOf('open')].reason, /休战/, '休战期要给出可读原因');
});

test('配置表解析出的日程与兜底常量同值（表改漏了这条先红）', () => {
    const config = loadBigMapConfig();
    assert.deepEqual(config.schedule, DEFAULT_BIGMAP_CITY_SCHEDULE);
    // 兜底常量只是夹具，真源在表里：两者必须一致，否则「表改了但代码没跟」查不出来。
    assert.equal(config.schedule.utcOffsetSeconds, 8 * 3600);
});

test('"HH:MM" 解析严格：错格式 / 越界当场抛错', () => {
    assert.equal(parseBigMapClockTime('09:00'), 9 * 3600);
    assert.equal(parseBigMapClockTime('21:10'), 21 * 3600 + 600);
    assert.equal(parseBigMapClockTime(' 22:00 '), 22 * 3600);
    assert.equal(parseBigMapClockTime('00:00'), 0);
    for (const bad of ['9', '9:0', '25:00', '12:60', '', 'ab:cd', '12:0a']) {
        assert.throws(() => parseBigMapClockTime(bad), /HH:MM|23:59/, `应拒绝 ${JSON.stringify(bad)}`);
    }
});
