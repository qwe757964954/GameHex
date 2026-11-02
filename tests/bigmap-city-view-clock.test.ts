/**
 * 城池视图快照的**时钟一致性**。
 *
 * 背景：`cityView()` 一次调用里原本会取两次 `cityTimeline()` —— 一次在
 * `resolveCampAttackReason` 内部（判「现在能不能打」），一次在函数体里（给 `phase` 文案与 gate）。
 * 两次各自读 `deps.now()`，跨过秒边界时同一座城的「能不能打」与「阶段文案」就来自两个不同时刻，
 * 会出现「phase 显示休战、按钮却可打」这种自相矛盾的快照。
 *
 * 口径：**一次 cityView 只读一次时钟**（跨城市各读一次不算不一致，同一座城内部必须自洽）。
 *
 * ⚠️ 用例显式「先喂快照再断言」：`campInfo` 为 null 时 `resolveCampAttackReason` 会提前返回
 * 「查询中」而走不到日程判定，此时「只读一次时钟」同样成立 —— 也就是说「分支被跳过」和
 * 「分支只读一次」在计数上无法区分。所以用例里先 `refreshSimple([101])`，并用
 * `assert.ok(repo.get(101))` 把「分支确实执行了」钉死，避免后来改代码时用例悄悄失效。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { BigMapModel } from '../assets/script/app/bigmap/application/BigMapModel';
import { BigMapCampRepository, type IBigMapCampGateway } from '../assets/script/app/bigmap/application/BigMapCampRepository';
import { createMemoryBigMapStorage } from '../assets/script/app/bigmap/application/BigMapSaveKeys';
import { bigMapCityTimeline } from '../assets/script/app/bigmap/model/BigMapCitySchedule';
import { loadBigMapConfig, loadBigMapLayout } from './helpers/bigmap-fixtures';

const config = loadBigMapConfig();
const layout = loadBigMapLayout();

/** 当日 `secondsOfDay` → 逻辑秒（`bigMapCityTimeline` 内部会 `+ utcOffsetSeconds` 再折进一天）。 */
const atSecondsOfDay = (secondsOfDay: number): number => secondsOfDay - config.schedule.utcOffsetSeconds;
/** 12:00 —— 处于 `prepare`（可攻打），且不在跨天禁攻窗（23:00~01:00）内。 */
const AT_PREPARE = atSecondsOfDay(12 * 3600);
/** 23:59:30 —— 落在跨天禁攻窗内，`phase` 已是 `closed`。 */
const AT_CROSS_DAY = atSecondsOfDay(86400 - 30);

interface IHarness {
    model: BigMapModel;
    repository: BigMapCampRepository;
    reads: () => number;
    reset: () => void;
}

/**
 * 联机档模型：`campRepository` 有快照 ⇒ `isServerCamp` 恒 true，
 * `cityView` 会真的走 `resolveCampAttackReason` → 日程判定。
 */
async function createOnline(now: (reads: number) => number): Promise<IHarness> {
    let reads = 0;
    const clock = (): number => {
        reads += 1;
        return now(reads);
    };
    const gateway: IBigMapCampGateway = {
        fetchSimple: async () => ({ infos: [{ campId: 101, opType: 0 }] }),
        fetchDetail: async () => ({ infos: [{ campId: 101, opType: 0, occupyRoleId: '', occupyRoleName: '' }] }),
        fetchRoles: async () => ({ infos: [] }),
        requestMove: async () => ({}),
    };
    const repository = new BigMapCampRepository(gateway, clock);
    const model = new BigMapModel({
        config,
        layout,
        campRepository: repository,
        storage: createMemoryBigMapStorage(),
        saveKey: 'city-view-clock',
        now: clock,
        adventureChapter: () => 6,
        startBattle: async () => ({ ok: true, message: '' }),
    });
    // 关键：没有这一步，`campInfo` 恒 null ⇒ 日程分支根本不执行，用例会假绿。
    await repository.refreshSimple([101]);
    return { model, repository, reads: () => reads, reset: () => { reads = 0; } };
}

test('一次 cityView 只读一次时钟：日程不会再取第二次', async () => {
    const h = await createOnline(() => AT_PREPARE);
    assert.ok(h.repository.get(101), '前置：101 必须有据点快照，否则测的是空跑路径');
    h.reset();

    const view = h.model.cityView(101);
    assert.ok(view, '101 必须在地图上');
    assert.equal(h.reads(), 1, `一次 cityView 应只读一次时钟，实际 ${h.reads()} 次`);
    assert.equal(view.isServerCamp, true);
});

test('整份 allCityViews 的时钟读取次数 == 城池数（每城各一次，不重复求值）', async () => {
    const h = await createOnline(() => AT_PREPARE);
    h.reset();

    const views = h.model.allCityViews();
    assert.ok(views.length > 1);
    assert.equal(h.reads(), views.length, `应每城读一次时钟：城池 ${views.length} 座，实际读 ${h.reads()} 次`);
});

test('时钟在两次读取之间跨到另一阶段时，同一座城的 canAttack 与 phase 仍自洽', async () => {
    // 第 1 次读给 12:00（可攻打），第 2 次起给 23:59:30（跨天禁攻、phase=closed）。
    // 老实现第 1 次读喂给 `attackReason`、第 2 次读喂给 `phase` ⇒ 「phase=closed 但 canAttack=true」。
    const h = await createOnline((reads) => (reads === 1 ? AT_PREPARE : AT_CROSS_DAY));
    assert.ok(h.repository.get(101), '前置：101 必须有据点快照');
    h.reset();

    const view = h.model.cityView(101);
    assert.ok(view);
    assert.equal(h.reads(), 1, `cityView 应只读一次时钟，实际 ${h.reads()} 次`);
    const expected = bigMapCityTimeline(config.schedule, AT_PREPARE);
    assert.equal(view.phase, expected.phase, 'phase 必须来自本次快照唯一那次时钟读取');
    assert.equal(view.canAttack, true, `12:00 应可攻打，实际 reason=「${view.attackReason}」`);
    assert.equal(view.attackReason, '');
});
