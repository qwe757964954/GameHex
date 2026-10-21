/**
 * 当日战绩快照（`BigMapSnapshot`）的回归测试。
 *
 * 快照最容易错的不是算法，是**边界日**：22:00 之后算今天、凌晨算昨天、
 * 白天根本不该出。这三条错一条，玩家就会看到「昨日战绩」里是今天的半成品。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    bigMapLocalDay,
    bigMapSnapshotDay,
    bigMapSnapshotDue,
    buildBigMapDaySnapshot,
    sortSnapshotScores,
    type IBigMapDaySnapshot,
} from '../assets/script/app/bigmap/model/BigMapSnapshot';
import { DEFAULT_BIGMAP_CITY_SCHEDULE } from '../assets/script/app/bigmap/model/BigMapCitySchedule';
import { createBigMapBattleProgress } from '../assets/script/app/bigmap/model/BigMapBattle';

const SCHEDULE = DEFAULT_BIGMAP_CITY_SCHEDULE;
const OFFSET = SCHEDULE.utcOffsetSeconds;

/** 造一个「本地时刻恰好是 localSeconds」的 UTC 时间戳。 */
function atLocal(localSeconds: number): number {
    return localSeconds - OFFSET;
}

const LOCAL_2205 = 22 * 3600 + 5 * 60;
const LOCAL_0300 = 3 * 3600;
const LOCAL_1000 = 10 * 3600;
const LOCAL_2130 = 21 * 3600 + 30 * 60;

test('本地日序号按时区折算，不按 UTC', () => {
    const noon = atLocal(12 * 3600);
    assert.equal(bigMapLocalDay(SCHEDULE, noon), bigMapLocalDay(SCHEDULE, noon + 3600));
    // UTC 00:30 == 东八区 08:30，属于同一天；UTC 16:30 == 次日 00:30，日序号必须 +1。
    const utcLate = 16 * 3600 + 30 * 60;
    assert.equal(bigMapLocalDay(SCHEDULE, utcLate), bigMapLocalDay(SCHEDULE, utcLate - 12 * 3600) + 1);
});

test('22:00 之后算今天的战绩，凌晨到开战前算昨天的', () => {
    const today = bigMapLocalDay(SCHEDULE, atLocal(LOCAL_2205));
    assert.equal(bigMapSnapshotDay(SCHEDULE, atLocal(LOCAL_2205)), today);
    // 「次日 03:00」要在绝对时刻上真的跨一天（`atLocal` 只解决时区，不解决跨日）。
    assert.equal(bigMapSnapshotDay(SCHEDULE, atLocal(LOCAL_0300 + 86400)), today, '次日 03:00 补的仍是昨天那份');
});

test('白天和锁榜期都不出快照，22:00 起才出', () => {
    const none: IBigMapDaySnapshot | null = null;
    assert.equal(bigMapSnapshotDue(SCHEDULE, atLocal(LOCAL_1000), none), false, '10:00 不该出');
    assert.equal(bigMapSnapshotDue(SCHEDULE, atLocal(LOCAL_2130), none), false, '21:30 还没到快照点');
    assert.equal(bigMapSnapshotDue(SCHEDULE, atLocal(LOCAL_2205), none), true, '22:05 该出');
    assert.equal(bigMapSnapshotDue(SCHEDULE, atLocal(LOCAL_0300 + 86400), none), true, '凌晨补昨天的');
});

test('同一天只出一份：已有当日快照就不再触发', () => {
    const already: IBigMapDaySnapshot = {
        day: bigMapSnapshotDay(SCHEDULE, atLocal(LOCAL_2205)),
        at: atLocal(LOCAL_2205),
        totalWarScore: 100,
        cities: {},
    };
    assert.equal(bigMapSnapshotDue(SCHEDULE, atLocal(LOCAL_2205 + 600), already), false);
    assert.equal(bigMapSnapshotDue(SCHEDULE, atLocal(LOCAL_0300 + 86400), already), false, '凌晨仍是同一天');
    // 隔一天就该重新出。
    assert.equal(bigMapSnapshotDue(SCHEDULE, atLocal(LOCAL_2205 + 86400), already), true);
});

test('只收当日有战功的城，名次与总分如实记录', () => {
    const progress = {
        ...createBigMapBattleProgress(),
        cityWarScore: { 101: 800, 102: 0, 103: 137 },
        totalWarScore: 1234,
    };
    const snapshot = buildBigMapDaySnapshot(SCHEDULE, atLocal(LOCAL_2205), progress, (cityId) => (
        cityId === 101 ? 3 : 11
    ));
    assert.deepEqual(Object.keys(snapshot.cities).sort(), ['101', '103'], '0 分的城不进快照');
    assert.deepEqual(snapshot.cities['101'], { rank: 3, warScore: 800 });
    assert.deepEqual(snapshot.cities['103'], { rank: 11, warScore: 137 });
    assert.equal(snapshot.totalWarScore, 1234);

    const sorted = sortSnapshotScores(snapshot);
    assert.deepEqual(sorted.map(([cityId]) => cityId), [101, 103], '按战功降序');
});

test('不打任何城时快照为空成绩单，不是 null', () => {
    const snapshot = buildBigMapDaySnapshot(
        SCHEDULE, atLocal(LOCAL_2205), createBigMapBattleProgress(), () => 1,
    );
    assert.deepEqual(snapshot.cities, {});
    assert.equal(snapshot.totalWarScore, 0);
});
