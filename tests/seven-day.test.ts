/**
 * 七日狂欢（老端 `LayerSevenDay`）移植的回归网。
 *
 * 分四段，各守一件事：
 *
 *   A. **判定口径**（`SevenDayTable`，零 import 纯函数）—— 老端这些判定散在
 *      `ModelSevenday` + `LayerSevendayUI` 里（依赖 DI 容器 / `TimeUtil`），没法单测；
 *      移植时全部收敛成传参纯函数，本段是它们唯一的回归网。
 *   B. **prefab 结构**（`assets/resources/ui/SevenDay/SevenDay.prefab`）—— 脚本组件的
 *      `__type__` **必须**能从 `*.ts.meta` 的 uuid 反解出来（23 位 cid），
 *      `_layer` 必须全 `UI_2D`，节点尺寸必须与 FGUI XML 反解出的几何一致。
 *   C. **数据管道接线**（源码文本）—— 四条协议名、内存态口径、超时兜底。
 *   D. **文案表**。
 *
 * 口径真源：
 *   - 配置：`assets/remoteRef/sevenDay{Task,Shop,Point}.json`
 *   - 老端：`client/assets/script/app/game/model/sevenday/ModelSevenday.ts`
 *           + `client/assets/script/app/game/ctrl/sevenday/LayerSevenday.ts`
 *   - 设计：`zarts/art/UIProject/trunk/UIProject/assets/七日狂欢/组件/组件_七日狂欢_主界面.xml`
 *
 * ⚠️ **界面口径 = 完全对齐老端**（2026-09-26 按用户「完整度跟老端实拍一样」收敛，别再改回去）：
 *   老端 `list_tab` 在 FGUI 原稿就是 `visible="false"`、`listTab.update([SevenDayTab.task])` 只喂
 *   一个页签 ⇒ 界面上**没有页签栏**，只有一个混合列表 = 当天全部 `type=2` 的行（福利 + 挑战混排）。
 *   所以界面走 `listRowsOfDay`（本文件用契约钉住）；`listDayTabs` / `listRowsOfTab` 是**数据层能力**
 *   （按 `typeName` 分组），当前不被界面消费 —— 开关 = `SevenDayPage.SHOW_PAGE_TAB_BAR`，
 *   打开时**必须同时**把 `RowView` 顶边从 392 退回 450。
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
    anyDayHasRedDot,
    boxHasRedDot,
    boxProgressOf,
    boxStateOf,
    dayHasRedDot,
    dayLabelOf,
    dayStartOf,
    deriveCurDay,
    deriveEndTimeMs,
    deriveTaskMaxDay,
    discountText,
    EMPTY_SEVEN_DAY_STATE,
    formatRemain,
    isDayUnlocked,
    isSpecialProgressTarget,
    listDayTabs,
    listRowsOfDay,
    listRowsOfTab,
    parseItemRows,
    parsePointRow,
    parsePointRows,
    parseShopRow,
    parseShopRows,
    parseTaskRow,
    parseTaskRows,
    SEVEN_DAY_FALLBACK_MAX_DAY,
    SEVEN_DAY_STATE_FINISH,
    SEVEN_DAY_STATE_REWARDED,
    SEVEN_DAY_STATE_UNDONE,
    SEVEN_DAY_TARGET_FIGHT,
    SEVEN_DAY_TASK_TYPE,
    shopStateOf,
    sortKeyOf,
    taskProgressText,
    taskStateOf,
} from '../assets/script/app/sevenDay/SevenDayTable';
import type {
    ISevenDayPointRow,
    ISevenDayServerState,
    ISevenDayShopRow,
    ISevenDayTaskRow,
} from '../assets/script/app/sevenDay/SevenDayTable';
import { SEVEN_DAY_TEXTS } from '../assets/script/app/sevenDay/SevenDayTexts';
import {
    QUALITY_FRAME_NAMES,
    qualityFrameLevel,
    qualityFrameName,
    resolveItemIconPath,
    resolveItemIconRef,
    SEVEN_DAY_ART_ROOT,
    splitIconPath,
} from '../assets/script/app/sevenDay/SevenDayArt';

// ============================================================
// 夹具
// ============================================================

/**
 * 读 `remoteRef` 的表。
 *
 * ⚠️ `remoteRef/*.json` **有两种形态**（175 张里 82 张是行数组、93 张是 `{k,v}` 列存）：
 * `sevenDayTask/Shop/Point` 与 `item` 都是**行数组**，别照抄首充测试里那套 `{k,v}` 解包。
 */
function readRows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as unknown;
    assert.ok(Array.isArray(source), `${name} 应当是行数组（形态变了？）`);
    return source as Array<Record<string, unknown>>;
}

const TASK_ROWS = readRows('sevenDayTask');
const SHOP_ROWS = readRows('sevenDayShop');
const POINT_ROWS = readRows('sevenDayPoint');

const TASKS = parseTaskRows(TASK_ROWS);
const SHOPS = parseShopRows(SHOP_ROWS);
const BOXES = parsePointRows(POINT_ROWS);

/** 造一份服务端状态（不碰模块级 `EMPTY_SEVEN_DAY_STATE` 里的 Map）。 */
function stateOf(input: {
    point?: number;
    takenBoxIds?: readonly number[];
    tasks?: ReadonlyArray<readonly [number, number, number]>;
    shops?: ReadonlyArray<readonly [number, number]>;
} = {}): ISevenDayServerState {
    return {
        point: input.point ?? 0,
        takenBoxIds: input.takenBoxIds ?? [],
        tasks: new Map((input.tasks ?? []).map(([resId, count, rewardState]) => [resId, { count, rewardState }])),
        shops: new Map((input.shops ?? []).map(([id, times]) => [id, times])),
    };
}

/** 从**今天**派生的当天 0 点 —— 写死 UTC 常量会让断言随时段漂移（踩过）。 */
function todayStart(): number {
    return dayStartOf(Date.now());
}

/** 造一行任务（只覆盖判定用得到的字段，其余给中性值）。 */
function task(input: Partial<ISevenDayTaskRow> & { resId: number }): ISevenDayTaskRow {
    return {
        days: 1,
        type: 2,
        typeName: '今日福利',
        name: 'test',
        targetType: 1,
        targetCount: 1,
        reward: [],
        goto: 0,
        ...input,
    };
}

/** 造一行商品。 */
function shop(input: Partial<ISevenDayShopRow> & { id: number }): ISevenDayShopRow {
    return {
        days: 1,
        type: 3,
        typeName: '半价礼包',
        name: 'test',
        rewards: [],
        priceType: 10,
        cost: 150,
        originalPrice: 300,
        limit: 1,
        discount: 5,
        ...input,
    };
}

/** 造一个宝箱。 */
function box(resId: number, point: number): ISevenDayPointRow {
    return { resId, point, reward: [] };
}

// ============================================================
// A0. 真表能全量解析
// ============================================================

test('真实三张表全量解析，无丢弃（行数变了先确认是不是策划改表）', () => {
    assert.equal(TASK_ROWS.length, 69, `sevenDayTask 行数变了（${TASK_ROWS.length}）`);
    assert.equal(SHOP_ROWS.length, 21, `sevenDayShop 行数变了（${SHOP_ROWS.length}）`);
    assert.equal(POINT_ROWS.length, 5, `sevenDayPoint 行数变了（${POINT_ROWS.length}）`);
    assert.equal(TASKS.length, TASK_ROWS.length, '有任务行解析失败');
    assert.equal(SHOPS.length, SHOP_ROWS.length, '有商品行解析失败');
    assert.equal(BOXES.length, POINT_ROWS.length, '有宝箱行解析失败');
});

test('解析出的 task 行带上 param.count / typeName / goto（界面全靠这三样）', () => {
    const first = TASKS.find((row) => row.resId === 10001);
    assert.ok(first, 'sevenDayTask 里应当有 resId=10001');
    assert.equal(first!.days, 1);
    assert.equal(first!.typeName, '今日福利');
    assert.equal(first!.name, '累计登陆1天');
    assert.equal(first!.targetCount, 1);
    assert.equal(first!.reward.length, 1);
});

test('商品行的 cost/originalPrice/limit/discount 都读到了（未配 discount 时兜底 10）', () => {
    const first = SHOPS.find((row) => row.id === 11);
    assert.ok(first, 'sevenDayShop 里应当有 id=11');
    assert.equal(first!.cost, 150);
    assert.equal(first!.originalPrice, 300);
    assert.equal(first!.limit, 1);
    assert.equal(first!.discount, 5);
    // 没写 discount 的行按「不打折」处理（10），而不是 0 —— 0 会被 discountText 判成"不打折"，
    // 但语义上 0 是「免费」，混起来迟早出事。
    assert.equal(parseShopRow({ id: 1, cost: 10 })!.discount, 10);
});

test('非法行一律返回 null / 被跳过，绝不抛（表里有用空行占位的习惯）', () => {
    const bad = [null, undefined, 0, '', 'x', {}, [], { resId: 0 }, { resId: -1 }, { id: 0 }];
    for (const value of bad) {
        assert.equal(parseTaskRow(value), null, `parseTaskRow(${JSON.stringify(value)})`);
        assert.equal(parseShopRow(value), null, `parseShopRow(${JSON.stringify(value)})`);
        assert.equal(parsePointRow(value), null, `parsePointRow(${JSON.stringify(value)})`);
    }
    assert.deepEqual(parseTaskRows([{ resId: 1, reward: 'oops' }])[0]!.reward, [], '奖励不是数组时给空数组');
});

test('parseRewards 跳过 resId 非法的奖励项（resId<=0 / 非对象）', () => {
    const parsed = parseTaskRow({
        resId: 1,
        reward: [{ resId: 7, number: 5 }, { resId: 0, number: 9 }, null, 'x', { number: 3 }],
    });
    assert.deepEqual(parsed!.reward, [{ resId: 7, number: 5 }]);
});

test('parsePointRows 按积分升序（输入乱序也要排）', () => {
    const sorted = parsePointRows([box(3, 40), box(1, 10), box(2, 25)]).map((row) => row.point);
    assert.deepEqual(sorted, [10, 25, 40]);
    // 真实表本来就是升序 —— 顺手钉一下 10/25/40/55/65 这组阈值
    assert.deepEqual(BOXES.map((row) => row.point), [10, 25, 40, 55, 65]);
});

test('parseItemRows：重复 resId 只留第一条（奖励展示按 id 查表）', () => {
    const map = parseItemRows([{ resId: 7, name: '先', quality: 2 }, { resId: 7, name: '后', quality: 5 }]);
    assert.equal(map.size, 1);
    assert.equal(map.get(7)!.name, '先');
    assert.equal(parseItemRows([{ resId: 7 }]).get(7)!.quality, 1, '缺 quality 时兜底 1 档');
});

// ============================================================
// A1. 时间口径
// ============================================================

test('deriveCurDay：创角当天 = 第 1 天，隔 N 个自然日 = 第 N+1 天', () => {
    const today = todayStart();
    assert.equal(deriveCurDay(today, today), 1, '当天激活 = 第 1 天');
    assert.equal(deriveCurDay(today - 86400000, today), 2, '昨天激活 = 第 2 天');
    assert.equal(deriveCurDay(today - 6 * 86400000, today), 7, '6 天前激活 = 第 7 天');
    // 同一天内任意时刻都算同一天（拿中午激活、晚上打开验证）
    assert.equal(deriveCurDay(today + 12 * 3600000, today + 20 * 3600000), 1);
});

test('deriveCurDay：创角时间晚于现在（服务端时间偏快）clamp 到第 1 天，不能算出 0 或负数', () => {
    const today = todayStart();
    assert.equal(deriveCurDay(today + 5 * 86400000, today), 1);
    assert.equal(deriveCurDay(0, today), 1, '没有创角时间按第 1 天');
    assert.equal(deriveCurDay(-1, today), 1);
});

test('deriveEndTimeMs：创角当天 0 点 + 活动天数；无创角时间给 0', () => {
    const today = todayStart();
    assert.equal(deriveEndTimeMs(today + 3600000, 7), today + 7 * 86400000);
    assert.equal(deriveEndTimeMs(0, 7), 0);
    assert.equal(SEVEN_DAY_FALLBACK_MAX_DAY, 7, '活动总天数兜底 7（还没有 sevenTaskShowDay 表）');
});

test('deriveTaskMaxDay：取任务/商品表实际配置的最大天数（不是活动总天数）', () => {
    assert.equal(deriveTaskMaxDay(TASKS, SHOPS), 7);
    assert.equal(deriveTaskMaxDay([task({ resId: 1, days: 5 })], []), 5);
    assert.equal(deriveTaskMaxDay([], [shop({ id: 1, days: 3 })]), 3, '只看任务表会漏掉商品表的天数');
    assert.equal(deriveTaskMaxDay([], []), 0);
});

test('formatRemain 四档粒度（对齐老端 timeSec2HMSStr14）', () => {
    const sec = 1000;
    assert.equal(formatRemain(3 * 86400000 + 12 * 3600000 + 30 * 60000), '3天12时', '够一天只给到「时」');
    assert.equal(formatRemain(12 * 3600000 + 5 * 60000 + 9 * sec), '12时05分', '不足一天给到「分」');
    assert.equal(formatRemain(5 * 60000 + 9 * sec), '05分09秒', '不足一小时给到「秒」');
    assert.equal(formatRemain(59 * sec), '00分59秒');
    assert.equal(formatRemain(0), '已结束');
    assert.equal(formatRemain(-1), '已结束');
});

// ============================================================
// A2. 页签（刻意与老端不同：数据驱动）
// ============================================================

test('真实表：七天每天都是三个页签，顺序 = 今日福利 / 今日挑战 / 半价礼包（任务在前、商品在后）', () => {
    for (let day = 1; day <= 7; day++) {
        const tabs = listDayTabs(TASKS, SHOPS, day);
        assert.deepEqual(
            tabs.map((tab) => tab.typeName),
            ['今日福利', '今日挑战', '半价礼包'],
            `第 ${day} 天的页签变了`,
        );
        assert.deepEqual(tabs.map((tab) => tab.index), [0, 1, 2], 'index 应当是 0..n-1 的连续序号');
    }
});

test('⚠️ 商品页签真的会出现在列表里（老端漏了这一条：list_tab 只 update([task])）', () => {
    // 老端 `LayerSevenday.InitList()` 里 `listTab.update([SevenDayTab.task])` 只渲染任务页签，
    // 商品表于是永远看不到 —— 那是未完成态，本工程按设计图补齐。这条断言就是防止改回去。
    const day1Tabs = listDayTabs(TASKS, SHOPS, 1);
    assert.ok(day1Tabs.some((tab) => tab.typeName === '半价礼包'), '商品页签必须在页签列表里');
    const rows = listRowsOfTab(TASKS, SHOPS, 1, '半价礼包');
    assert.ok(rows.length > 0, '「半价礼包」页签下必须有商品行');
    assert.ok(rows.every((row) => row.kind === 'shop'), '该页签只该有商品行');
});

test('页签按表中首现序（不是字母序、不是 type 号序）', () => {
    const tasks = [task({ resId: 1, typeName: 'B页' }), task({ resId: 2, typeName: 'A页' })];
    const shops = [shop({ id: 1, typeName: 'C页' }), shop({ id: 2, typeName: 'A页' })];
    assert.deepEqual(listDayTabs(tasks, shops, 1).map((tab) => tab.typeName), ['B页', 'A页', 'C页']);
});

test('页签只收当天的行；typeName 为空的行不造页签；没配置的天返回空数组', () => {
    const tasks = [task({ resId: 1, days: 2, typeName: 'X' }), task({ resId: 2, days: 1, typeName: '' })];
    assert.deepEqual(listDayTabs(tasks, [], 1), [], '当天只有一条 typeName 为空的行 → 没有页签');
    assert.deepEqual(listDayTabs(tasks, [], 2).map((tab) => tab.typeName), ['X']);
    assert.deepEqual(listDayTabs(TASKS, SHOPS, 99), [], '没配置的天不凭空造页签（界面要隐藏页签栏）');
});

// ============================================================
// A3. 列表内容与排序
// ============================================================

test('listRowsOfTab 只收「当天 + 该页签」的行，任务与商品分得开', () => {
    const rows = listRowsOfTab(TASKS, SHOPS, 1, '今日挑战');
    const expectedTask = TASKS.filter((row) => row.days === 1 && row.typeName === '今日挑战').length;
    assert.equal(rows.length, expectedTask, `第 1 天「今日挑战」行数变了（${rows.length}）`);
    assert.ok(rows.every((row) => row.kind === 'task'));
    assert.ok(
        rows.every((row) => (row.kind === 'task' ? row.task.days : 0) === 1),
        '不能混进别的天的行',
    );
});

test('任务排序：可领取(1) → 未完成(4) → 已领取/无记录(9)，同档按 resId 升序', () => {
    const tasks = [
        task({ resId: 10030 }),                       // 无记录 → 9
        task({ resId: 10010 }),                       // 未完成 → 4
        task({ resId: 10020 }),                       // 可领取 → 1
        task({ resId: 10005 }),                       // 未完成 → 4
    ];
    const state = stateOf({
        tasks: [
            [10010, 0, SEVEN_DAY_STATE_UNDONE],
            [10020, 1, SEVEN_DAY_STATE_FINISH],
            [10005, 0, SEVEN_DAY_STATE_UNDONE],
        ],
    });
    const order = listRowsOfTab(tasks, [], 1, '今日福利', state).map((row) => (row.kind === 'task' ? row.task.resId : -1));
    assert.deepEqual(order, [10020, 10005, 10010, 10030]);
});

test('商品排序：已售空的排最前（照抄老端，与任务相反），同档按 id 升序', () => {
    const shops = [shop({ id: 12, limit: 1 }), shop({ id: 11, limit: 1 }), shop({ id: 13, limit: 1 })];
    const state = stateOf({ shops: [[13, 1]] });
    const order = listRowsOfTab([], shops, 1, '半价礼包', state)
        .map((row) => (row.kind === 'shop' ? row.shop.id : -1));
    assert.deepEqual(order, [13, 11, 12]);
});

test('sortKeyOf 的档位量级不会串档（1e8 远大于任何真实 id）', () => {
    const state = stateOf({
        tasks: [
            [10001, 1, SEVEN_DAY_STATE_FINISH],
            [99999, 1, SEVEN_DAY_STATE_UNDONE],
        ],
    });
    const claimable = sortKeyOf({ kind: 'task', task: task({ resId: 10001 }) }, state);
    const undone = sortKeyOf({ kind: 'task', task: task({ resId: 99999 }) }, state);
    const noRecord = sortKeyOf({ kind: 'task', task: task({ resId: 88888 }) }, state);
    assert.ok(claimable < undone, '可领取必须排在未完成之前');
    assert.ok(undone < noRecord, '未完成排在「已领取 / 无记录」之前');
    assert.equal(Math.floor(claimable / 1e8), 1);
    assert.equal(Math.floor(undone / 1e8), 4);
    assert.equal(Math.floor(noRecord / 1e8), 9);
    // 同档内按 id 递增，id 再大也不会溢出到下一档
    assert.equal(sortKeyOf({ kind: 'task', task: task({ resId: 70010 }) }, state) % 1e8, 70010);
});

// ============================================================
// A4. 状态判定
// ============================================================

test('⚠️ 任务状态是「服务端先说话」：没有服务端记录 = 未完成，绝不是可领取', () => {
    const row = task({ resId: 1, goto: 0 });
    assert.equal(taskStateOf(row, EMPTY_SEVEN_DAY_STATE), 'undone');
    // 刚进游戏（一条状态都没有）时把任务全画成「领取」是老端明确避免的事
    const allClaimable = listRowsOfTab([row], [], 1, '今日福利', EMPTY_SEVEN_DAY_STATE)
        .every((item) => taskStateOf((item as { task: ISevenDayTaskRow }).task, EMPTY_SEVEN_DAY_STATE) !== 'claimable');
    assert.ok(allClaimable);
});

test('任务四态：可领取 / 已领取 / 可前往（有 goto 且未完成）/ 未完成', () => {
    const plain = task({ resId: 1, goto: 0 });
    const withGoto = task({ resId: 2, goto: 8 });
    assert.equal(taskStateOf(plain, stateOf({ tasks: [[1, 3, SEVEN_DAY_STATE_FINISH]] })), 'claimable');
    assert.equal(taskStateOf(plain, stateOf({ tasks: [[1, 3, SEVEN_DAY_STATE_REWARDED]] })), 'taken');
    assert.equal(taskStateOf(withGoto, stateOf({ tasks: [[2, 1, SEVEN_DAY_STATE_UNDONE]] })), 'goto');
    assert.equal(taskStateOf(withGoto, stateOf()), 'goto', '没有服务端记录但有 goto，也亮「前往」');
    assert.equal(taskStateOf(plain, stateOf({ tasks: [[1, 1, SEVEN_DAY_STATE_UNDONE]] })), 'undone');
});

test('⚠️ 商品状态先判售空再判免费（免费限量商品买完后必须显示「已售空」）', () => {
    const freeLimited = shop({ id: 1, cost: 0, limit: 1 });
    assert.equal(shopStateOf(freeLimited, stateOf()), 'free', '没买过时是免费');
    assert.equal(
        shopStateOf(freeLimited, stateOf({ shops: [[1, 1]] })),
        'soldOut',
        '判断顺序反了就会继续显示「免费」——层叠条件顺序是契约',
    );
    assert.equal(shopStateOf(shop({ id: 2, cost: 150, limit: 1 }), stateOf({ shops: [[2, 1]] })), 'soldOut');
    assert.equal(shopStateOf(shop({ id: 3, cost: 150, limit: 1 }), stateOf()), 'buyable');
});

test('limit <= 0 视为不限购（怎么买都不会售空）', () => {
    const unlimited = shop({ id: 1, cost: 150, limit: 0 });
    assert.equal(shopStateOf(unlimited, stateOf({ shops: [[1, 999]] })), 'buyable');
});

test('宝箱三态：已领取优先于积分达标', () => {
    const target = box(1, 10);
    assert.equal(boxStateOf(target, stateOf({ point: 0 })), 'locked');
    assert.equal(boxStateOf(target, stateOf({ point: 10 })), 'claimable', '刚好达标也算可领');
    assert.equal(boxStateOf(target, stateOf({ point: 11 })), 'claimable');
    assert.equal(boxStateOf(target, stateOf({ point: 99, takenBoxIds: [1] })), 'taken');
});

test('boxProgressOf：第 0 档按「当前/本档」；第 N 档在「上一档→本档」区间里取比例', () => {
    const boxes = [box(1, 10), box(2, 25), box(3, 40)];
    assert.equal(boxProgressOf(0, boxes, 5), 0.5);
    assert.equal(boxProgressOf(1, boxes, 17), (17 - 10) / 15);
    assert.equal(boxProgressOf(2, boxes, 32), (32 - 25) / 15);
});

test('boxProgressOf：低于上一档给 0、达到本档给 1、越界/非法给 0（负比例是老端踩过的坑）', () => {
    const boxes = [box(1, 10), box(2, 25), box(3, 40)];
    assert.equal(boxProgressOf(1, boxes, 9), 0, '9 < 上一档 10 → 0，不能算成负数');
    assert.equal(boxProgressOf(1, boxes, 25), 1);
    assert.equal(boxProgressOf(2, boxes, 999), 1);
    assert.equal(boxProgressOf(0, boxes, 999), 1, '封顶 1');
    assert.equal(boxProgressOf(0, boxes, -5), 0, '封底 0');
    assert.equal(boxProgressOf(9, boxes, 50), 0, '下标越界给 0，不抛');
    assert.equal(boxProgressOf(0, [box(1, 0)], 50), 0, '本档积分为 0 时（除零）给 0');
    assert.equal(boxProgressOf(1, [box(1, 10), box(2, 10)], 10), 1, '相邻档位积分相同时不给 NaN');
});

test('真实宝箱阈值下的进度（10 / 25 / 40 / 55 / 65）', () => {
    assert.equal(boxProgressOf(0, BOXES, 10), 1);
    assert.equal(boxProgressOf(1, BOXES, 17.5), 0.5);
    assert.equal(boxProgressOf(2, BOXES, 24), 0, '没到上一档 25');
    assert.equal(boxProgressOf(4, BOXES, 60), 0.5);
});

// ============================================================
// A5. 红点
// ============================================================

test('⚠️ dayHasRedDot 按正确语义：已领取的宝箱/任务不算红点（老端 findIndex 回调漏 return 的笔误不照抄）', () => {
    const tasks = [task({ resId: 1, days: 1 }), task({ resId: 2, days: 1 })];
    const curDay = 7;
    assert.equal(dayHasRedDot(tasks, 1, curDay, stateOf({ tasks: [[1, 1, SEVEN_DAY_STATE_FINISH]] })), true);
    assert.equal(
        dayHasRedDot(tasks, 1, curDay,
            stateOf({ tasks: [[1, 1, SEVEN_DAY_STATE_REWARDED], [2, 1, SEVEN_DAY_STATE_REWARDED]] })),
        false,
        '老端这里恒为 true（回调漏 return，findIndex 恒 -1）—— 别照抄',
    );
    assert.equal(dayHasRedDot(tasks, 1, curDay, stateOf()), false, '没有服务端记录不算红点');
    assert.equal(dayHasRedDot(tasks, 2, curDay, stateOf({ tasks: [[1, 1, SEVEN_DAY_STATE_FINISH]] })), false, '只看当天');
});

test('⚠️ dayHasRedDot 未开启的天不亮（老端 ref.days > curDay 就 continue）', () => {
    // 服务端确实会把未来天的任务也标成 FINISH ⇒ 少了那道过滤，第 5 天（还没开）就亮红点
    const tasks = [task({ resId: 1, days: 1 }), task({ resId: 5, days: 5 })];
    const state = stateOf({ tasks: [[1, 1, SEVEN_DAY_STATE_FINISH], [5, 1, SEVEN_DAY_STATE_FINISH]] });
    assert.equal(dayHasRedDot(tasks, 5, 1, state), false, 'curDay=1 时第 5 天还没开 ⇒ 不亮');
    assert.equal(dayHasRedDot(tasks, 5, 5, state), true, '到了第 5 天才亮');
    assert.equal(dayHasRedDot(tasks, 1, 1, state), true, '已开启的天照常亮');
    assert.equal(dayHasRedDot(tasks, 7, 7, state), false, '第 7 天没任务 ⇒ 不亮');
});

test('anyDayHasRedDot 只在「已解锁的天」里找（未来天的可领取不算）', () => {
    const tasks = [task({ resId: 1, days: 1 }), task({ resId: 5, days: 5 })];
    assert.equal(anyDayHasRedDot(tasks, 1, stateOf({ tasks: [[5, 1, SEVEN_DAY_STATE_FINISH]] })), false);
    assert.equal(anyDayHasRedDot(tasks, 5, stateOf({ tasks: [[5, 1, SEVEN_DAY_STATE_FINISH]] })), true);
    assert.equal(anyDayHasRedDot(tasks, 7, stateOf({ tasks: [[1, 1, SEVEN_DAY_STATE_FINISH]] })), true);
});

test('boxHasRedDot：有可领宝箱才有红点', () => {
    assert.equal(boxHasRedDot(BOXES, stateOf({ point: 0 })), false);
    assert.equal(boxHasRedDot(BOXES, stateOf({ point: 10 })), true);
    assert.equal(boxHasRedDot(BOXES, stateOf({ point: 10, takenBoxIds: [1] })), false);
    assert.equal(boxHasRedDot(BOXES, stateOf({ point: 65 })), true);
});

test('isDayUnlocked：第 day 天 <= 今天即解锁', () => {
    assert.equal(isDayUnlocked(1, 1), true);
    assert.equal(isDayUnlocked(2, 1), false);
    assert.equal(isDayUnlocked(7, 7), true);
});

// ============================================================
// A6. 展示文案
// ============================================================

test('taskProgressText：普通任务走「(当前/目标)」模板', () => {
    const row = task({ resId: 1, targetType: 27, targetCount: 3, goto: 0 });
    const templates = { progress: SEVEN_DAY_TEXTS.taskProgress, fight: SEVEN_DAY_TEXTS.taskFight, unFight: SEVEN_DAY_TEXTS.taskUnFight };
    assert.equal(taskProgressText(row, stateOf({ tasks: [[1, 2, SEVEN_DAY_STATE_UNDONE]] }), templates, () => null), '(2/3)');
    assert.equal(taskProgressText(row, stateOf(), templates, () => null), '(0/3)');
});

test('taskProgressText：通关类（targetType=8）三条分支', () => {
    const row = task({ resId: 1, targetType: SEVEN_DAY_TARGET_FIGHT, goto: 2 });
    const templates = { progress: SEVEN_DAY_TEXTS.taskProgress, fight: SEVEN_DAY_TEXTS.taskFight, unFight: SEVEN_DAY_TEXTS.taskUnFight };
    const withMap = (level: number) => `${level}`;
    assert.equal(
        taskProgressText(row, stateOf({ tasks: [[1, 2, SEVEN_DAY_STATE_UNDONE]] }), templates, withMap),
        '通关第2关',
        '走 taskFight 模板（本工程退化成「通关第N关」，老端是「通关{章节}-{关卡}」）',
    );
    assert.equal(taskProgressText(row, stateOf(), templates, withMap), SEVEN_DAY_TEXTS.taskUnFight, '没有进度记录 → 未通关');
    assert.equal(
        taskProgressText(row, stateOf({ tasks: [[1, 5, SEVEN_DAY_STATE_REWARDED]] }), templates, withMap),
        '',
        '已完成/已领取的通关任务不显示进度（老端同）',
    );
    // fightLabel 返回 null（关卡表查不到）也走「未通关」
    assert.equal(taskProgressText(row, stateOf({ tasks: [[1, 2, SEVEN_DAY_STATE_UNDONE]] }), templates, () => null), SEVEN_DAY_TEXTS.taskUnFight);
});

test('真实表里存在通关类任务，且它们的 goto 都配了（界面要能「前往」）', () => {
    const fightTasks = TASKS.filter((row) => row.targetType === SEVEN_DAY_TARGET_FIGHT);
    assert.ok(fightTasks.length > 0, '表里应当有 targetType=8 的任务');
    for (const row of fightTasks) {
        assert.ok(row.goto > 0, `${row.resId}（${row.name}）没配 goto，只能干等）`);
    }
    assert.equal(isSpecialProgressTarget(SEVEN_DAY_TARGET_FIGHT), true);
    assert.equal(isSpecialProgressTarget(27), false);
});

test('discountText：10 折不显示标签，5 折显示「5折」，0/负也当不打折', () => {
    assert.equal(discountText(10, SEVEN_DAY_TEXTS.discount), '');
    assert.equal(discountText(11, SEVEN_DAY_TEXTS.discount), '');
    assert.equal(discountText(5, SEVEN_DAY_TEXTS.discount), '5折');
    assert.equal(discountText(0, SEVEN_DAY_TEXTS.discount), '');
    assert.equal(discountText(-1, SEVEN_DAY_TEXTS.discount), '');
});

test('dayLabelOf 拼出「第N天」（前缀/后缀都来自文案表）', () => {
    assert.equal(dayLabelOf(3, SEVEN_DAY_TEXTS.dayPrefix, SEVEN_DAY_TEXTS.daySuffix), '第3天');
});

// ============================================================
// B. prefab 结构
// ============================================================

const PREFAB_PATH = 'assets/resources/ui/SevenDay/SevenDay.prefab';

/** 编辑器压缩 uuid：前 5 个 hex 原样 + 其余 27 个 hex 每 3 个编 2 个 base64 字符 = 23 位。 */
function compressUuid(uuid: string): string {
    const KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const hex = uuid.replace(/-/g, '');
    let out = hex.slice(0, 5);
    for (let i = 5; i < 32; i += 3) {
        const value = parseInt(hex.slice(i, i + 3), 16);
        out += KEYS[value >> 6] + KEYS[value & 63];
    }
    return out;
}

/** 读一个脚本的 cid（= 编译器 `_RF.push` 用的那个）。 */
function scriptCid(tsPath: string): string {
    const meta = JSON.parse(readFileSync(`${tsPath}.meta`, 'utf8')) as { uuid: string };
    return compressUuid(meta.uuid);
}

const PREFAB = JSON.parse(readFileSync(PREFAB_PATH, 'utf8')) as Array<Record<string, unknown>>;
const PREFAB_NODES = PREFAB.filter((entry) => entry && entry.__type__ === 'cc.Node');

/** 脚本类名 → 源文件（顺序无所谓）。 */
const SCRIPT_FILES: Readonly<Record<string, string>> = {
    SevenDayPage: 'assets/script/app/sevenDay/SevenDayPage.ts',
    SevenDayDayTab: 'assets/script/app/sevenDay/SevenDayDayTab.ts',
    SevenDayPageTab: 'assets/script/app/sevenDay/SevenDayPageTab.ts',
    SevenDayRewardRow: 'assets/script/app/sevenDay/SevenDayRewardRow.ts',
    SevenDayRewardSlot: 'assets/script/app/sevenDay/SevenDayRewardSlot.ts',
    SevenDayPointBox: 'assets/script/app/sevenDay/SevenDayPointBox.ts',
    SevenDayGlow: 'assets/script/app/sevenDay/SevenDayGlow.ts',
    RedDot: 'assets/script/app/common/RedDot.ts',
    VScrollView: 'assets/script/vscrollview/VScrollView.ts',
};

test('prefab 存在，根节点是第一个 cc.Node 且 cc.Prefab.data 指向它（排错会让整棵子树消失）', () => {
    assert.ok(existsSync(PREFAB_PATH), `prefab 不存在：${PREFAB_PATH}`);
    const data = (PREFAB[0] as { data: { __id__: number } }).data;
    const firstNodeIndex = PREFAB.findIndex((entry) => entry && entry.__type__ === 'cc.Node');
    assert.equal(data.__id__, firstNodeIndex, 'cc.Prefab.data 必须指向第一个 cc.Node');
    assert.equal(PREFAB_NODES[0]!._name, 'SevenDay');
    assert.equal((PREFAB_NODES[0]!._parent as unknown), null, '根节点没有父节点');
});

test('⚠️ 所有节点的 _layer 都是 UI_2D（落在 DEFAULT 会让整棵子树不渲染）', () => {
    const layers = new Set(PREFAB_NODES.map((node) => node._layer));
    assert.deepEqual([...layers], [33554432], `出现非 UI_2D 的 layer：${[...layers].join(', ')}`);
});

test('⚠️ 每个脚本组件的 __type__ 都能从对应 .ts.meta 的 uuid 反解出来（防 cid 抄错成 MissingScript）', () => {
    const expected = new Map<string, string>();
    for (const [className, file] of Object.entries(SCRIPT_FILES)) {
        expected.set(scriptCid(file), className);
    }
    const used = new Set(
        PREFAB
            .filter(
                (entry) => entry
                    && typeof entry.__type__ === 'string'
                    && !entry.__type__.startsWith('cc.')
                    && !entry.__type__.startsWith('sp.'),
            )
            .map((entry) => entry.__type__ as string),
    );
    assert.ok(used.size >= Object.keys(SCRIPT_FILES).length, `脚本组件种类少了：只用到 ${used.size} 种`);
    for (const cid of used) {
        assert.equal(cid.length, 23, `cid 长度必须是 23 位：${cid}`);
        assert.ok(expected.has(cid), `prefab 里的 cid ${cid} 反解不出任何脚本（抄错了？）`);
    }
    // 反向：九种脚本组件都在 prefab 里出现过（少一种说明有一块界面没建）
    for (const [cid, className] of expected) {
        assert.ok(used.has(cid), `${className} 的组件没出现在 prefab 里`);
    }
});

test('节点几何逐条等于 FGUI XML 反解值（画布 720×1280，坐标已换成左/上边缘）', () => {
    const CANVAS_W = 720;
    const CANVAS_H = 1280;

    /**
     * 从根节点累加 `_lpos` 求**视觉框**（`_lpos` 是相对父节点锚点原点的局部坐标）。
     *
     * ⚠️ 两个易错点（都在本轮踩过）：
     *   ① `_lpos` 累加出来的是**锚点**位置，不是中心 —— 必须再按 `anchor` 展开成矩形：
     *      `left = 画布中心x + accX − anchorX·w`、`top = 画布中心y − accY − (1 − anchorY)·h`；
     *   ② 画布 y 向下、Cocos 局部 y 向上，所以 `top` 是减出来的。
     */
    function boxOf(name: string): { x: number; y: number; w: number; h: number } | null {
        const index = PREFAB.findIndex((entry) => entry && entry.__type__ === 'cc.Node' && entry._name === name);
        if (index < 0) return null;
        let nodeIndex: number | null = index;
        let x = 0;
        let y = 0;
        while (nodeIndex !== null) {
            const node = PREFAB[nodeIndex]!;
            const pos = node._lpos as { x: number; y: number };
            x += pos.x;
            y += pos.y;
            const parent = node._parent as { __id__: number } | null;
            nodeIndex = parent ? parent.__id__ : null;
        }
        const comps = (PREFAB[index]!._components as Array<{ __id__: number }>) ?? [];
        const uit = comps
            .map((ref) => PREFAB[ref.__id__])
            .find((comp) => comp && comp.__type__ === 'cc.UITransform') as
            | {
                  _contentSize: { width: number; height: number };
                  _anchorPoint: { x: number; y: number };
              }
            | undefined;
        if (!uit) return null;
        const { width, height } = uit._contentSize;
        return {
            x: CANVAS_W / 2 + x - uit._anchorPoint.x * width,
            y: CANVAS_H / 2 - y - (1 - uit._anchorPoint.y) * height,
            w: width,
            h: height,
        };
    }

    /** FGUI `组件_七日狂欢_主界面.xml` 的 `xy` / `size`（换算成左/上边缘的视觉框）。 */
    const EXPECTED: ReadonlyArray<readonly [string, readonly [number, number, number, number]]> = [
        // bg 组件 0,0 720×484
        ['BgTop', [0, 0, 720, 484]],
        // qrdl_3（原图 440×454）324,-47
        ['BgDeco', [324, -47, 440, 454]],
        // 标题美术字 8,-29（原图 403×164）
        ['TitleArt', [8, -29, 403, 164]],
        // panel_window_02_9gong 0,296 720×940
        ['Panel', [0, 296, 720, 940]],
        // 关闭按钮 660,1（尺寸取本工程 `common/btn_close` 的 54×51）
        ['CloseBtn', [660, 1, 54, 51]],
        // ⚠️ n128 xy=65,321 size=300,71 **scale=1,0.5** → 视觉 300×35.5（漏 scale 会高一倍）
        ['TimeBg', [65, 321, 300, 35.5]],
        // n5 pivot+anchor=true → xy 是中心 (171,339)，113×36
        ['TimeLabel', [114.5, 321, 113, 36]],
        // 天数组 8,106 398×192
        ['DayBar', [8, 106, 398, 192]],
        ['Day1', [8, 112, 99, 99]],
        ['Day2', [66, 197, 99, 99]],
        ['Day3', [113, 110, 99, 99]],
        ['Day4', [166, 198, 99, 99]],
        ['Day5', [213, 107, 99, 99]],
        ['Day6', [268, 199, 99, 99]],
        ['Day7', [307, 106, 99, 99]],
        // list_tab 31,382 660×68，`align="center"` + colGap 20 → 首项左边缘 31+(660−634)/2 = 44
        ['TabBar', [31, 382, 660, 68]],
        ['Tab1', [44, 383.5, 198, 65]],
        ['Tab2', [262, 383.5, 198, 65]],
        ['Tab3', [480, 383.5, 198, 65]],
        // list 30,392 660×645（视口锚点 (0.5,1)，`_lpos` 指顶边 —— 见下面单独一条）
        // ⚠️ 2026-09-26 起**照抄 FGUI 原稿**：界面没有页签栏（老端把 `list_tab` 设成
        //    `visible="false"`），所以列表顶边就是原稿的 392，底边 1037 不变 ⇒ 高 645。
        //    先前为了让开页签栏压到 450/587 的做法已按用户要求撤回
        //    （恢复页签栏时要一起改回来，开关 = `SevenDayPage.SHOW_PAGE_TAB_BAR`）。
        ['RowView', [30, 392, 660, 645]],
        // list_box 167,1074 518×113，`colGap=-5` 且**没有 align**（默认 left）
        ['BoxBar', [167, 1074, 518, 113]],
        ['Box1', [167, 1070.5, 100, 120]],
        ['Box2', [262, 1070.5, 100, 120]],
        ['Box3', [357, 1070.5, 100, 120]],
        ['Box4', [452, 1070.5, 100, 120]],
        ['Box5', [547, 1070.5, 100, 120]],
        // 行内奖励区（item 内 list xy=(36,111) pivot=(0,0.5)：x=36 左边缘、y=111 垂直中心；行画布 y=392）
        // ⚠️ 2026-09-26 修正：旧生成器把 111 当顶边又加半高 ⇒ 整体偏下 55px（Slot 底超行框 28px）
        ['RewardBar', [66, 448, 363, 110]],
        // 奖励格 = FGUI 奖励 item 80×80、colGap 2（旧 84×84/间距 88 已对齐）；vAlign middle ⇒ 顶 = 392+111-40
        ['Slot1', [66, 463, 80, 80]],
        ['Slot2', [148, 463, 80, 80]],
        // img_HuiZhang_01 57,1051 83×94
        ['Medal', [57, 1051, 83, 94]],
    ];

    const wrong: string[] = [];
    for (const [name, [x, y, w, h]] of EXPECTED) {
        const actual = boxOf(name);
        if (!actual) {
            wrong.push(`${name}: 节点不存在`);
            continue;
        }
        if (actual.x !== x || actual.y !== y || actual.w !== w || actual.h !== h) {
            wrong.push(`${name}: 期望 (${x}, ${y}) ${w}×${h}，实际 (${actual.x}, ${actual.y}) ${actual.w}×${actual.h}`);
        }
    }
    assert.deepEqual(wrong, [], `与 FGUI XML 对不上：\n${wrong.join('\n')}`);
});

test('左对齐的三个 Label 以「左边缘」对齐（宽的盒子居中会整体位移）', () => {
    // `_lpos` 累加：TimeText 左边缘 = 236（FGUI n92）、Hint 左边缘 = 400（工程自加，避开倒计时）
    const leftEdgeOf = (name: string): number => {
        const index = PREFAB.findIndex((entry) => entry && entry.__type__ === 'cc.Node' && entry._name === name);
        let nodeIndex: number | null = index;
        let x = 0;
        while (nodeIndex !== null) {
            const node = PREFAB[nodeIndex]!;
            x += (node._lpos as { x: number }).x;
            const parent = node._parent as { __id__: number } | null;
            nodeIndex = parent ? parent.__id__ : null;
        }
        const comps = (PREFAB[index]!._components as Array<{ __id__: number }>) ?? [];
        const uit = comps
            .map((ref) => PREFAB[ref.__id__])
            .find((comp) => comp && comp.__type__ === 'cc.UITransform') as {
            _contentSize: { width: number };
            _anchorPoint: { x: number };
        };
        return 360 + x - uit._anchorPoint.x * uit._contentSize.width;
    };
    assert.equal(leftEdgeOf('TimeText'), 236, '倒计时左边缘必须钉在 236（按中心对齐写会左移 14.5px）');
    assert.equal(leftEdgeOf('Hint'), 400, '提示行不能压在倒计时上（倒计时右缘 396）');
});

test('prefab 里有 7 个天数按钮 / 3 个页签 / 5 个宝箱（与表里的天数、页签、阈值一一对应）', () => {
    const names = new Set(PREFAB_NODES.map((node) => node._name as string));
    for (let day = 1; day <= 7; day++) assert.ok(names.has(`Day${day}`), `缺天数按钮 Day${day}`);
    assert.ok(!names.has('Day8'), '多了第 8 个天数按钮');
    for (let tab = 1; tab <= 3; tab++) assert.ok(names.has(`Tab${tab}`), `缺页签 Tab${tab}`);
    // 3 个页签节点留在 prefab 里（= 数据层能力，将来打开 `SHOW_PAGE_TAB_BAR` 就能用），
    // 但**界面上不显示** —— 运行期整块 `active = false`，见下面那条契约用例。
    assert.ok(!names.has('Tab4'), '页签最多 3 个（typeName 集合 = 今日福利/今日挑战/半价礼包）');
    for (let index = 1; index <= 5; index++) assert.ok(names.has(`Box${index}`), `缺宝箱 Box${index}`);
    assert.ok(!names.has('Box6'), '宝箱档位是 5 个（10/25/40/55/65）');
});

test('行模板 = content 的第一个子节点（VScrollView 会 removeAllChildren 后取 children[0]）', () => {
    const contentIndex = PREFAB.findIndex((entry) => entry && entry.__type__ === 'cc.Node' && entry._name === 'content');
    assert.ok(contentIndex >= 0, 'RowView 下必须有 content 节点');
    const content = PREFAB[contentIndex]!;
    const children = (content._children as Array<{ __id__: number }>) ?? [];
    assert.ok(children.length >= 1, 'content 里必须有行模板');
    const template = PREFAB[children[0]!.__id__]!;
    assert.equal(template._name, 'RowTemplate', '模板必须是 content 的第一个子节点');

    // 视口锚点必须 (0.5, 1)：组件直接写 content.position.y 并以下标 0 为顶边
    const rowViewIndex = PREFAB.findIndex((entry) => entry && entry.__type__ === 'cc.Node' && entry._name === 'RowView');
    const rowViewComps = (PREFAB[rowViewIndex]!._components as Array<{ __id__: number }>) ?? [];
    const rowViewUit = rowViewComps
        .map((ref) => PREFAB[ref.__id__])
        .find((comp) => comp && comp.__type__ === 'cc.UITransform') as { _anchorPoint: { x: number; y: number } };
    assert.deepEqual(
        { x: rowViewUit._anchorPoint.x, y: rowViewUit._anchorPoint.y },
        { x: 0.5, y: 1 },
        '视口锚点错了会让整条列表下移半个视口高',
    );
});

test('页签栏排在奖励列表**之后**（顺序反了会被列表的 Mask 裁掉，也收不到触摸）', () => {
    // `_children` 序 = 渲染序。FGUI 原稿里 `list_tab` 排在 `list` **之前**，且两者重叠 58px
    // （382..450 vs 392..1037）。
    // 现行口径（2026-09-26，对齐老端）：页签栏**整块不显示**
    // （`SevenDayPage.presentPageTabs` 里 `this.tabBar.active = SHOW_PAGE_TAB_BAR = false`），
    // 所以列表顶边就照抄原稿的 392。
    // 本用例钉的是「万一有人把 `SHOW_PAGE_TAB_BAR` 打开」时**仍然**成立的顺序约束：
    // 页签必须排在列表之后 —— 否则会被列表的 Mask 裁掉，静默消失、连触摸都收不到。
    // ⚠️ 打开页签栏时**还必须**把 RowView 顶边从 392 退回 450（页签栏占 382..450），
    //    那一步单测自动校验不了，靠 `SHOW_PAGE_TAB_BAR` 上的注释 + `EXPECTED` 表提示。
    const indexOf = (name: string): number => {
        const index = PREFAB.findIndex((entry) => entry && entry.__type__ === 'cc.Node' && entry._name === name);
        assert.ok(index >= 0, `缺节点 ${name}`);
        return index;
    };
    const parentOf = (index: number): number => {
        const parent = PREFAB[index]!._parent as { __id__: number } | undefined;
        assert.ok(parent, `#${index} 没有父节点`);
        return parent.__id__;
    };

    const tabBar = indexOf('TabBar');
    const rowView = indexOf('RowView');
    assert.equal(parentOf(tabBar), parentOf(rowView), '页签与列表必须在同一个父节点下');

    const siblings = ((PREFAB[parentOf(rowView)]!._children as Array<{ __id__: number }>) ?? []).map((ref) => ref.__id__);
    assert.ok(
        siblings.indexOf(tabBar) > siblings.indexOf(rowView),
        `页签要画在列表上层（sibling ${siblings.indexOf(tabBar)} 必须大于 ${siblings.indexOf(rowView)}）`,
    );
});

test('cc.CompPrefabInfo.fileId 唯一且都是 22 位（长度错会让资源库查询整个炸掉，报错不指向文件）', () => {
    const ids = PREFAB
        .filter((entry) => entry && entry.__type__ === 'cc.CompPrefabInfo')
        .map((entry) => entry.fileId as string);
    assert.ok(ids.length > 0);
    const bad = ids.filter((id) => typeof id !== 'string' || id.length !== 22);
    assert.deepEqual(bad, [], `这些 fileId 长度不是 22 位：${bad.join(', ')}`);
    assert.equal(new Set(ids).size, ids.length, 'fileId 必须唯一（重复会让 TargetInfo 命中错对象）');
});

test('所有 __id__ 引用都在数组范围内（越界会让字段静默变 null）', () => {
    const out: string[] = [];
    const walk = (value: unknown, where: string): void => {
        if (Array.isArray(value)) {
            value.forEach((item, index) => walk(item, `${where}[${index}]`));
            return;
        }
        if (!value || typeof value !== 'object') return;
        const record = value as Record<string, unknown>;
        if (typeof record.__id__ === 'number') {
            const id = record.__id__;
            if (Object.keys(record).length === 1 && (id < 0 || id >= PREFAB.length)) {
                out.push(`${where} → ${id}`);
            }
        }
        for (const key of Object.keys(record)) walk(record[key], `${where}.${key}`);
    };
    PREFAB.forEach((entry, index) => walk(entry, `#${index}`));
    assert.deepEqual(out, []);
});

test('数组里没有 null 空洞（运行时遍历会炸）', () => {
    const holes = PREFAB.map((entry, index) => (entry ? -1 : index)).filter((index) => index >= 0);
    assert.deepEqual(holes, []);
});

// ============================================================
// C. 数据管道接线（源码文本）
// ============================================================

test('四条请求的协议名与老端一一对应（名字改了服务端就认不出来）', () => {
    const request = readFileSync('assets/script/app/sevenDay/RequestSevenDayMsg.ts', 'utf8');
    assert.match(request, /return ['"]CmdSevenDayInfoReqMsg['"]/);
    assert.match(request, /return ['"]CmdSevenDayTakeTaskRewardReqMsg['"]/);
    assert.match(request, /return ['"]CmdSevenDayShopBuyReqMsg['"]/);
    assert.match(request, /return ['"]CmdSevenDayTakePointRewardReqMsg['"]/);
    assert.match(request, /class RequestSevenDayInfo extends RequestMsg/);
    assert.match(request, /class RequestSevenDayTakeTaskReward extends RequestMsg/);
    assert.match(request, /class RequestSevenDayShopBuy extends RequestMsg/);
    assert.match(request, /class RequestSevenDayTakePointReward extends RequestMsg/);
});

test('Repository：状态内存持有（不走 CacheMgr）+ 四表并发读 + 读写超时兜底', () => {
    const repository = readFileSync('assets/script/app/sevenDay/SevenDayRepository.ts', 'utf8');
    // ⚠️ `CmdSevenDayInfo` 不在 protoCache 里（服务端不推），所以不能像首充那样走 CacheMgr
    assert.ok(
        !/CacheMgr\.get[A-Za-z]*\(\s*['"]CmdSevenDayInfo['"]/.test(repository),
        'CmdSevenDayInfo 不在 protoCache 里，别当成推送表去 CacheMgr 查',
    );
    assert.match(repository, /private state: ISevenDayServerState = EMPTY_SEVEN_DAY_STATE/);
    assert.match(repository, /normalizeServerState\(/);
    for (const table of ['sevenDayTask', 'sevenDayShop', 'sevenDayPoint', 'item']) {
        assert.match(repository, new RegExp(`['"]${table}['"]`), `没读到 ${table} 表`);
    }
    // `GameNet.send` 没有按请求的超时 → 不兜就永远悬着，面板停在占位外观
    assert.match(repository, /withTimeout\(/);
    assert.match(repository, /READ_TIMEOUT_MS/);
    assert.match(repository, /WRITE_TIMEOUT_MS/);
    // uint64 一律走字符串（经 number 会超 2^53 静默丢精度）
    assert.match(repository, /toIdString\(/);
    assert.match(repository, /toCount\(/);
});

test('入口接线：MainEntranceRoute 的白名单 + MainEntranceList 的类映射都要有 sevenDay', () => {
    const route = readFileSync('assets/script/app/main/MainEntranceRoute.ts', 'utf8');
    assert.match(route, /LayerSevenDay:\s*['"]sevenDay['"]/);
    assert.match(route, /EntrancePopupKey = ['"]firstRecharge['"] \| ['"]sevenDay['"]/);

    const list = readFileSync('assets/script/app/main/MainEntranceList.ts', 'utf8');
    assert.match(list, /import \{ SevenDayPage \} from '\.\.\/sevenDay\/SevenDayPage'/);
    assert.match(list, /sevenDay:\s*SevenDayPage/);
});

test('弹窗类契约：prefabPath 指向新 prefab，且路径真的存在', () => {
    const page = readFileSync('assets/script/app/sevenDay/SevenDayPage.ts', 'utf8');
    const matched = page.match(/static prefabPath = ['"]([^'"]+)['"]/);
    assert.ok(matched, 'SevenDayPage 必须声明 static prefabPath');
    assert.equal(matched![1], 'ui/SevenDay/SevenDay');
    assert.ok(
        existsSync(`assets/resources/${matched![1]}.prefab`),
        `prefabPath 指向的文件不存在：assets/resources/${matched![1]}.prefab`,
    );
});

test('界面文案全部来自 SEVEN_DAY_TEXTS（别把中文散到 prefab 的 Label 上）', () => {
    // 唯一持有文案表的是页面；三个子组件通过 `render(...)` 的参数收文案，自己不造字符串。
    const page = readFileSync('assets/script/app/sevenDay/SevenDayPage.ts', 'utf8');
    assert.match(page, /import \{ SEVEN_DAY_TEXTS \} from '\.\/SevenDayTexts'/);

    // 页面确实把文案表用起来了（不是 import 了摆着）。两种写法都算数：
    // 直接 `SEVEN_DAY_TEXTS.xxx`，或页内别名 `const texts = SEVEN_DAY_TEXTS;` 后的 `texts.xxx`
    // （`buildRowView` 用的就是别名 —— 只认一种写法会把「用对了」判成红的）。
    assert.match(page, /const texts = SEVEN_DAY_TEXTS;/);
    const consumed = (key: string): boolean =>
        page.includes(`SEVEN_DAY_TEXTS.${key}`) || page.includes(`texts.${key}`);
    /**
     * 刻意还没接上的键（必须写清原因，别默默堆着 —— 没人管的键就是下一处漏文案的入口）。
     */
    const PENDING: Readonly<Record<string, string>> = {
        title: '只给日志 / 测试用的活动名（界面标题是美术字 `sd_title.png`）',
        countPrefix: '奖励数量角标还没画（老端由公共「物品框」组件带的）',
    };
    /**
     * 烘进 prefab Label 的 FGUI 静态文案（`剩余时间:` / `当前积分`）—— 它们**不该**被运行时注入，
     * 所以下面反向校验「prefab 里的字面量 === 文案表里的值」。
     */
    const BAKED = new Set(['timePrefix', 'pointLabel']);

    for (const key of Object.keys(PENDING)) {
        assert.ok(key in SEVEN_DAY_TEXTS, `PENDING 里的 ${key} 在文案表里不存在（拼错了？）`);
    }

    const orphans = Object.keys(SEVEN_DAY_TEXTS)
        .filter((key) => !consumed(key) && !BAKED.has(key) && !(key in PENDING));
    assert.deepEqual(orphans, [], `文案表里这些键没人消费，也不在 PENDING 里：${orphans.join(', ')}`);

    // 改名了也能立刻发现：prefab 里烘死的静态文案必须与文案表一致（只改一边 = 界面纹丝不动）
    const prefab = readFileSync('assets/resources/ui/SevenDay/SevenDay.prefab', 'utf8');
    for (const key of BAKED) {
        const value = SEVEN_DAY_TEXTS[key as keyof typeof SEVEN_DAY_TEXTS];
        assert.ok(
            prefab.includes(`"_string": "${value}"`),
            `prefab 里烘死的静态文案与 SEVEN_DAY_TEXTS.${key}（${value}）对不上`,
        );
    }

    // 子组件里**不能有硬编码的中文 UI 文案**（注释 / tooltip 里的中文不算）。
    const subComponents = [
        'SevenDayRewardRow.ts',
        'SevenDayPointBox.ts',
        'SevenDayDayTab.ts',
        'SevenDayPageTab.ts',
        'SevenDayRewardSlot.ts',
    ];
    for (const file of subComponents) {
        const source = readFileSync(`assets/script/app/sevenDay/${file}`, 'utf8');
        const offenders = source
            .split('\n')
            .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))       // 去掉注释行
            .filter((line) => /['"`][^'"`]*[\u4e00-\u9fa5][^'"`]*['"`]/.test(line))
            .filter((line) => !/tooltip:/.test(line))                 // Inspector 提示允许中文
            .map((line) => line.trim());
        assert.deepEqual(offenders, [], `${file} 里出现了硬编码中文文案（应走文案表注入）`);
    }
});

test('行内按钮真的接了点击（别只画按钮不发请求）', () => {
    // 这是个真实踩过的坑：按钮文案 / 三态 / 红点全铺对了，但 `ActionBtn` 上一个监听都没有，
    // 点下去毫无反应 —— 静态断言挡不住，所以在这里把「组件绑监听 + 宿主给回调 + 参数口径」钉死。
    const row = readFileSync('assets/script/app/sevenDay/SevenDayRewardRow.ts', 'utf8');
    assert.match(row, /import \{[^}]*\bButton\b[^}]*\} from 'cc'/, 'Button 没从 cc 里 import（会运行时炸）');
    assert.match(row, /this\.actionButton\.on\(Button\.EventType\.CLICK/, '行的按钮没绑 CLICK');
    assert.match(row, /onAction: \(\(\) => void\) \| null/, 'onAction 回调字段没了');
    assert.match(row, /this\.onAction\?\.\(\)/, '绑了监听但没把回调透出去');

    const page = readFileSync('assets/script/app/sevenDay/SevenDayPage.ts', 'utf8');
    assert.match(page, /view\.onAction = \(\) => \{/, '页面没给行按钮设回调');
    // 回调必须**按 index 现取**，不能捕获渲染那一刻的 row（虚拟列表会复用节点到别的下标）
    assert.match(page, /const current = this\.rows\[index\];/, 'onAction 没按 index 现取当前行');
    assert.match(page, /private async onRowAction\(row: SevenDayListRow\)/, '没有 onRowAction');
    // 参数口径：领任务奖励传的是**天**（不是任务 id）
    assert.match(page, /claimTaskReward\(row\.task\.days/, '领任务奖励传的应是天（老端口径）');
    assert.match(page, /buyShop\(row\.shop\.id/, '买商品传的应是 sevenDayShop.id');
    // 「前往」还没接跳转 ⇒ 必须给提示，不能静默
    assert.match(page, /SEVEN_DAY_TEXTS\.gotoMissing, true/, '「前往」没给未开放提示');
    // 宝箱与行按钮共用同一段写请求壳（别各写一份漏掉 busy 复位 / alive 判定）
    assert.match(page, /private async runWrite\(write: \(\) => Promise<SevenDayRequestResult>\)/, '没有公共写请求壳');
    assert.equal(page.match(/await this\.runWrite\(/g)?.length, 3, '三条写路径（领任务/买商品/领宝箱）应共用 runWrite');
});

test('列表行渲染不许闭包捕获 present() 的入参（否则 reload 后界面永远停在第一份快照）', () => {
    // 真实踩过的坑：`renderItemFn` 只挂一次，闭包里捕获了第一次 `presentRows(snapshot, …)` 的
    // `snapshot` / 预加载图 ⇒ 后续每次 reload 都用**第一份**快照渲染。
    // 症状极其隐蔽：数据层已经变了（`this.rows` 都换了新数组、`setTotalCount` 也确实重铺了），
    // 但行上的文案 / 进度 / 红点一动不动 —— 表现为「领奖成功后按钮还是『领取』」。
    // 单测挡不住（要跑引擎才知道），所以这里把「现取」这个形状钉死。
    const page = readFileSync('assets/script/app/sevenDay/SevenDayPage.ts', 'utf8');
    assert.match(page, /private rowContext: \{/, '没有存「本趟渲染上下文」的字段');
    assert.match(page, /this\.rowContext = \{ snapshot, qualityFrames, iconFrames \};/);
    assert.match(page, /list\.renderItemFn = \(node, index\) => this\.renderRow\(node, index\);/,
        'renderItemFn 应委托给方法（在里面现取上下文），不要内联闭包');
    assert.match(page, /private renderRow\(node: Node, index: number\): void \{/);
    assert.match(page, /const context = this\.rowContext;/, 'renderRow 没现取上下文');
    assert.match(page, /view\.render\(this\.buildRowView\(context\.snapshot, row, context\.qualityFrames, context\.iconFrames\)\)/,
        '行渲染应使用现取的上下文，而不是闭包里的 snapshot');
    // 反向：不许再出现「用闭包里的 snapshot 铺行」的写法
    assert.equal(/view\.render\(this\.buildRowView\(snapshot,/.test(page), false,
        'renderItemFn 仍在闭包捕获 presentRows 的 snapshot 参数');
});

test('图标预加载按「这一趟算出来的行」，不是 this.rows（否则首次打开图标全部不加载）', () => {
    // 踩过的坑：`loadIconFrames(snapshot)` 在 `presentRows` **之前** await，
    // 而它内部读的是 `this.rows` —— 那一刻 `this.rows` 还是**上一帧**的行（首次打开更是空数组）
    // ⇒ 一个图标都不预加载，界面静默只画品质框。不抛错、不告警，只有端到端探针能逮住。
    const page = readFileSync('assets/script/app/sevenDay/SevenDayPage.ts', 'utf8');

    // ① 行要在预加载之前算好，并作为参数传进去
    //    ⚠️ 锚点用 `const rows = SevenDayPage.SHOW_PAGE_TAB_BAR`：行的来源是**分支**的
    //    （默认 `listRowsOfDay`，打开页签栏才是 `listRowsOfTab`），别再写死某一路的函数名。
    const rowsIndex = page.indexOf('const rows = SevenDayPage.SHOW_PAGE_TAB_BAR');
    const loadIndex = page.indexOf('this.loadIconFrames(snapshot, rows)');
    assert.ok(rowsIndex > 0, '`present()` 里没先把行算出来');
    assert.ok(loadIndex > rowsIndex, '`rows` 必须在 `loadIconFrames` 之前算好并传进去');

    // ② 预加载函数不许再自己读 `this.rows`
    assert.match(
        page,
        /private async loadIconFrames\(\s*snapshot: ISevenDaySnapshot,\s*rows: readonly SevenDayListRow\[\],?\s*\)/,
        'loadIconFrames 应该按入参 rows 预加载',
    );
    assert.equal(/for \(const row of this\.rows\)/.test(page), false, 'loadIconFrames 又去读 this.rows 了');
});

// ============================================================
// D. 文案表与美术口径
// ============================================================

test('带占位符的模板必须真的含 {0}/{1}（少了就会把占位符原样显示在界面上）', () => {
    assert.ok(SEVEN_DAY_TEXTS.taskProgress.includes('{0}') && SEVEN_DAY_TEXTS.taskProgress.includes('{1}'));
    assert.ok(SEVEN_DAY_TEXTS.taskFight.includes('{0}'));
    assert.ok(SEVEN_DAY_TEXTS.discount.includes('{0}'));
});

test('任务/商品按钮文案与状态枚举一一对应（四态 / 三态都有人管）', () => {
    assert.equal(taskStateOf(task({ resId: 1 }), stateOf()), 'undone');
    assert.equal(SEVEN_DAY_TEXTS.taskUndone, '未完成');
    assert.equal(SEVEN_DAY_TEXTS.taskGoto, '前往');
    assert.equal(SEVEN_DAY_TEXTS.taskClaim, '领取');
    assert.equal(SEVEN_DAY_TEXTS.taskTaken, '已领取');
    assert.equal(SEVEN_DAY_TEXTS.shopFree, '免费');
    assert.equal(SEVEN_DAY_TEXTS.shopBuy, '购买');
    assert.equal(SEVEN_DAY_TEXTS.shopSoldOut, '已售空');
    // 售空/已领取之后按钮整块隐藏（在 prefab 里由 `SevenDayRewardRow.render` 控制），
    // 这里只保证文案非空 —— 空串会被 Label 判成没配，界面上就是一片空白。
    for (const [key, value] of Object.entries(SEVEN_DAY_TEXTS)) {
        assert.notEqual(value, '', `${key} 的文案是空串`);
    }
});

test('美术口径：品质框按「框档」枚举 4 张（按品质档枚举会漏掉 04）', () => {
    assert.deepEqual([...QUALITY_FRAME_NAMES], [
        'common_img_pzk_01',
        'common_img_pzk_02',
        'common_img_pzk_03',
        'common_img_pzk_04',
    ]);
    assert.equal(qualityFrameName(1), 'common_img_pzk_01');
    assert.equal(qualityFrameName(2), 'common_img_pzk_01', '品质 2 → 第 1 档（老端就是 4 张框盖 5+ 种品质）');
    assert.equal(qualityFrameName(3), 'common_img_pzk_02');
    assert.equal(qualityFrameName(99), 'common_img_pzk_04', '高品级封顶第 4 档');
    assert.equal(qualityFrameLevel(0), 1);
    assert.equal(qualityFrameLevel(1.9), 1, '小数向下取整');
    assert.equal(SEVEN_DAY_ART_ROOT, 'image/sevenDay');
});

test('道具图标：`item.icon` 是资源路径时直通解析，老格式裸名一律 null（调用方据此隐藏图标）', () => {
    // 2026-09-23 起 `item.icon` 从「老客户端 FGUI 组件名」改成「相对 assets/resources/ 的路径」
    // （`icons/<dir>/<name>`），图已导进 `assets/resources/icons/*`。所以主路径是**直通解析**，
    // 人工白名单 `SEVEN_DAY_ITEM_ICON_MAP` 退化成「个别对不上时的补丁」。
    assert.deepEqual(splitIconPath('icons/item/图标_兵书随机'), { root: 'icons/item', name: '图标_兵书随机' });
    assert.deepEqual(splitIconPath('icons/common/铜币'), { root: 'icons/common', name: '铜币' });
    assert.deepEqual(
        resolveItemIconRef('icons/equip/乌瑟尔之戒碎片'),
        { root: 'icons/equip', name: '乌瑟尔之戒碎片' },
    );
    assert.equal(
        resolveItemIconPath('icons/item/图标_兵书随机'),
        'icons/item/图标_兵书随机/spriteFrame',
        '装配路径要能被 resources.load 直接吃',
    );

    // 老格式裸名 → 不认，否则会拿组件名当路径去加载、刷一屏「图标加载失败」
    assert.equal(splitIconPath('图标_图纸_帽子'), null);
    assert.equal(resolveItemIconRef('图标_随便什么'), null);
    assert.equal(resolveItemIconPath('图标_随便什么'), null);

    // 边界：空串 / 只有根没有名 / 别的前缀（老 image/ 体系）
    assert.equal(resolveItemIconRef(''), null, '空 key 也返回 null');
    assert.equal(splitIconPath('icons/item/'), null, '缺文件名');
    assert.equal(splitIconPath('icons'), null, '缺目录与文件名');
    assert.equal(splitIconPath('image/icon/card/char_01'), null, '不是 icons/ 前缀一律不认');
});

test('真表 + 磁盘：七日狂欢的奖励图标能解析出来，且解析出来的图确实在 icons/ 下', () => {
    // 端到端对账：表里的 resId → `item.icon` → 磁盘文件。
    // 「解析不出来」不算错（货币 / 老数据 → 调用方降级成只画品质框）；
    // 但「解析出来了磁盘上却没图」必须报 —— 那种缺失不会抛错，只会在界面上变成一格空框。
    const items = JSON.parse(readFileSync('assets/remoteRef/item.json', 'utf8')) as Array<{
        resId: number;
        icon?: string;
    }>;
    const byId = new Map(items.map((row) => [row.resId, row]));
    const idsOf = (path: string, key: string): number[] => {
        const rows = JSON.parse(readFileSync(path, 'utf8')) as Array<Record<string, unknown>>;
        const ids = new Set<number>();
        for (const row of rows) {
            for (const reward of (row[key] as Array<{ resId: number }> | undefined) ?? []) ids.add(reward.resId);
        }
        return Array.from(ids);
    };

    const ids = [
        ...idsOf('assets/remoteRef/sevenDayTask.json', 'reward'),
        ...idsOf('assets/remoteRef/sevenDayShop.json', 'rewards'),
        // 2026-09-26 补：宝箱奖励也要对账。宝箱里的物品是界面上**唯一没有降级余地**的地方 ——
        // 行里至少还有标题/进度/按钮，宝箱只有「品质框 + 物品图」两样。
        ...idsOf('assets/remoteRef/sevenDayPoint.json', 'reward'),
    ];
    const resolved: string[] = [];
    const broken: string[] = [];
    for (const resId of ids) {
        const ref = resolveItemIconRef(byId.get(resId)?.icon ?? '');
        if (!ref) continue;
        resolved.push(`${ref.root}/${ref.name}`);
        if (!['png', 'jpg'].some((ext) => existsSync(`assets/resources/${ref.root}/${ref.name}.${ext}`))) {
            broken.push(`resId=${resId} → ${ref.root}/${ref.name}`);
        }
    }
    assert.ok(resolved.length > 0, '一个奖励图标都解析不出来（`item.icon` 的口径又变了？）');
    assert.deepEqual(broken, [], `这些解析出来了但磁盘上没有图：\n${broken.join('\n')}`);

    // 宝箱这一路单独钉一次条数：现在 5 档里 4 档指向 2 个不同的物品（10992 金钥匙 / 10085 随机橙色宝石）。
    //
    // ⚠️ 已知**策划表缺口**（2026-09-26 实测，不是代码问题）：
    //    `sevenDayPoint` 第 1 档（`point=10`）的 `reward.resId = 1033325` 在 `item` 表里**没有行**
    //    （`item.resId` 最大值 19503，全工程搜 `1033325` 只在 `sevenDayPoint` / `refSmallAll.sevenDayPoint` 命中）。
    //    后果 = 第 1 个宝箱永远只画品质框、不画物品（界面上看着像「第一个箱子是空的」）。
    //    这里**不**断言它必须解析出来（策划一补表就会误伤），只断言其余档位是好的。
    const pointResolved = idsOf('assets/remoteRef/sevenDayPoint.json', 'reward')
        .map((resId) => resolveItemIconRef(byId.get(resId)?.icon ?? ''))
        .filter((ref) => ref !== null);
    assert.ok(pointResolved.length >= 2, `宝箱奖励只解析出 ${pointResolved.length} 个图标（宝箱会只剩品质框）`);
});

test('七日美术资源都在 image/sevenDay 下，且九宫图的 border 已按 FGUI scale9grid 写入', () => {
    // ⚠️ `SEVEN_DAY_ART_ROOT` 是**运行时**路径（相对 `resources`）；落盘时还要带 `assets/resources/`。
    const artDir = `assets/resources/${SEVEN_DAY_ART_ROOT}`;
    const required = [
        'sd_bg_top', 'sd_deco', 'sd_title', 'sd_panel', 'sd_time_bg', 'sd_chip_bg', 'sd_medal',
        'sd_day_on', 'sd_day_off', 'sd_day_glow', 'sd_bar', 'sd_bar_bg', 'sd_tab_on', 'sd_tab_off',
        'sd_box_glow', 'sd_box_ray', 'sd_bb24', 'sd_check', 'sd_row_bg', 'sd_row_title_bg',
        'sd_soldout', 'sd_taken', 'sd_discount', 'sd_btn_green', 'sd_btn_blue', 'sd_btn_red',
    ];
    const missing: string[] = [];
    for (const name of required) {
        const found = ['png', 'jpg'].some((ext) => existsSync(`${artDir}/${name}.${ext}`));
        if (!found) missing.push(name);
    }
    assert.deepEqual(missing, [], `这些美术没落进 ${artDir}：${missing.join(', ')}`);

    /** 九宫 border 写在 spriteFrame 子资源的 userData 上（不是 ImageAsset 上）。 */
    const borderOf = (name: string) => {
        const meta = JSON.parse(readFileSync(`${artDir}/${name}.png.meta`, 'utf8')) as {
            subMetas: Record<string, { userData: Record<string, number> }>;
        };
        return meta.subMetas.f9941!.userData;
    };
    // 只有 Sprite.type = SLICED(1) 的图才需要 border；缺了不会报错，只是拉伸时四角被拉扁。
    const slided: ReadonlyArray<readonly [string, readonly [number, number, number, number]]> = [
        ['sd_panel', [85, 117, 50, 84]],
        ['sd_row_bg', [38, 28, 41, 29]],
        ['sd_time_bg', [154, 17, 154, 20]],
        ['sd_chip_bg', [54, 17, 56, 18]],
        ['sd_bar_bg', [26, 8, 16, 15]],
        ['sd_bar', [7, 4, 9, 4]],
        ['sd_btn_blue', [51, 23, 55, 26]],
        ['sd_btn_red', [54, 17, 56, 18]],
    ];
    for (const [name, [left, top, right, bottom]] of slided) {
        const userData = borderOf(name);
        assert.deepEqual(
            [userData.borderLeft, userData.borderTop, userData.borderRight, userData.borderBottom],
            [left, top, right, bottom],
            `${name} 的九宫 border 与 FGUI scale9grid 不符（拉伸会错位）`,
        );
    }
    // `sd_btn_green` 在 FGUI 里没有 scale9grid，保持 0（别顺手补一个）
    const green = borderOf('sd_btn_green');
    assert.deepEqual(
        [green.borderLeft, green.borderTop, green.borderRight, green.borderBottom],
        [0, 0, 0, 0],
    );
});

test('EMPTY_SEVEN_DAY_STATE 是共享常量，测试不能就地改它（后跑到的用例会连带失败）', () => {
    assert.equal(EMPTY_SEVEN_DAY_STATE.point, 0);
    assert.deepEqual(EMPTY_SEVEN_DAY_STATE.takenBoxIds, []);
    assert.equal(EMPTY_SEVEN_DAY_STATE.tasks.size, 0);
    assert.equal(EMPTY_SEVEN_DAY_STATE.shops.size, 0);
});

// ============================================================
// E. 2026-09-26「完整度对齐」—— 用户点名三件事：红点 / 列表 / 物品显示
// ============================================================
//
// 这一轮的全部判据都来自「界面截图上看得出来、但单测和编译都不报错」那一类：
//   ① 天球底板绑反 ⇒ 已解锁的天显示成暗球；
//   ② 宝箱没有物品图标位 ⇒ 5 个箱子永远空着（老端有 `com_goods` 物品框）；
//   ③ 装饰件盖住达标积分数字 ⇒ `10` 看着像 `,0`；
//   ④ 图标预加载只收列表行、不收宝箱 ⇒ 宝箱物品图静默不加载。
// 端到端的那一半在 `tmp/_sevenday_probe.mjs`（44 条），这里守结构与源码形状。

/** 取某张七日美术的 SpriteFrame uuid（`@f9941` 子资源）—— 用来按**图身份**比对 prefab 里的引用。 */
function frameUuidOf(name: string): string {
    const meta = JSON.parse(
        readFileSync(`assets/resources/${SEVEN_DAY_ART_ROOT}/${name}.png.meta`, 'utf8'),
    ) as { uuid: string };
    return `${meta.uuid}@f9941`;
}

/** `{"__id__": n}` → 数组里的那个对象（越界返回 null，不抛）。 */
function refAt(ref: unknown): Record<string, unknown> | null {
    const id = (ref as { __id__?: number } | null | undefined)?.__id__;
    return typeof id === 'number' && id >= 0 && id < PREFAB.length
        ? (PREFAB[id] as Record<string, unknown>)
        : null;
}

function parentOfNode(node: Record<string, unknown>): Record<string, unknown> | null {
    return refAt(node._parent);
}

/** 节点上挂的全部组件对象。 */
function componentsOf(node: Record<string, unknown>): Array<Record<string, unknown>> {
    const refs = (node._components as Array<{ __id__: number }> | undefined) ?? [];
    return refs.map((ref) => refAt(ref)).filter((comp): comp is Record<string, unknown> => comp !== null);
}

function childNamesOf(node: Record<string, unknown>): string[] {
    const refs = (node._children as Array<{ __id__: number }> | undefined) ?? [];
    return refs.map((ref) => String(refAt(ref)?._name ?? '?'));
}

test('天球底板方向：已解锁 = `sd_day_on`（亮）、未解锁 = `sd_day_off`（暗）—— 7 个球逐个按图身份对', () => {
    // 现场（2026-09-26）：`SevenDayDayTab` 两个 tooltip 写反 + prefab 照错的绑 ⇒
    // curDay=1 时**第 1 天是暗球**、第 2..7 天全是亮球（探针实测 `frame:sd_day_off` / `frame:sd_day_on`）。
    // 方向真源 = 老端 `七日狂欢/自定义组件/按钮_七日狂欢_天数.xml`：
    //   `<controller name="状态" pages="0,开启,1,未开启">`，`状态=开启` 挂 `七日狂欢_按钮_天数01.png`、
    //   `未开启` 挂 `…天数02.png`；磁盘 md5 实测 `天数01(19355B)==sd_day_on`、`天数02(18888B)==sd_day_off`。
    // ⚠️ 别拿「文件名里带 on/off」「哪个文件大」推方向 —— 只有 md5 / 这里的 uuid 是硬的。
    const onUuid = frameUuidOf('sd_day_on');
    const offUuid = frameUuidOf('sd_day_off');
    assert.notEqual(onUuid, offUuid, '两张底板解析成了同一张图（这个用例就白写了）');

    const cid = scriptCid('assets/script/app/sevenDay/SevenDayDayTab.ts');
    const tabs = PREFAB.filter((entry) => entry && entry.__type__ === cid) as Array<{
        unlockedFrame: { __uuid__?: string } | null;
        lockedFrame: { __uuid__?: string } | null;
    }>;
    assert.equal(tabs.length, 7, `天数按钮上的 SevenDayDayTab 应为 7 个，实际 ${tabs.length}`);

    const wrong: string[] = [];
    tabs.forEach((tab, index) => {
        const at = `Day${index + 1}`;
        if (tab.unlockedFrame?.__uuid__ !== onUuid) {
            wrong.push(`${at}.unlockedFrame = ${tab.unlockedFrame?.__uuid__ ?? '(空)'}（应为 sd_day_on）`);
        }
        if (tab.lockedFrame?.__uuid__ !== offUuid) {
            wrong.push(`${at}.lockedFrame = ${tab.lockedFrame?.__uuid__ ?? '(空)'}（应为 sd_day_off）`);
        }
    });
    assert.deepEqual(wrong, [], `天球底板绑反了（已解锁的天会显示成暗球）：\n${wrong.join('\n')}`);
});

test('5 个宝箱都要有 `BoxBtn/Frame/Icon` 物品位，且 `rewardIcon` 全绑上（老端的 `com_goods`）', () => {
    // 老端 `自定义组件/按钮_七日狂欢_宝箱.xml` 的 displayList = `特效`（可领取光效）+ **`com_goods`（物品框）**
    // + `shaixuan_duigou`（对勾）；老端代码 `com_goods.UpdateByGoods(tlGoods[0], false)` 对**每个**宝箱都调。
    // 新端先前只画了品质框、压根没有图标节点 ⇒ 宝箱永远空着，不报错、单测也测不出，只有截图看得出来。
    //
    // 口径跟行奖励格（`SevenDayRewardSlot`）**必须一致**：CUSTOM sizeMode + 72×72 装在 80×80 的品质框里。
    // 2026-09-26 FGUI 对齐：com_goods 100×100×0.8 = 视觉 80×80，Icon 76→72（行奖励格同步 84→80/76→72）。
    // 自成一套尺寸的话，同一件物品在列表里和在宝箱里大小会不一样。
    const boxIcons = PREFAB_NODES.filter(
        (node) => node._name === 'Icon' && parentOfNode(node)?._name === 'Frame',
    );
    assert.equal(boxIcons.length, 5, `5 个宝箱各要有一个 BoxBtn/Frame/Icon，实际 ${boxIcons.length}`);

    const wrong: string[] = [];
    const iconSprites = new Set<Record<string, unknown>>();
    for (const icon of boxIcons) {
        const frame = parentOfNode(icon);
        const boxButton = frame ? parentOfNode(frame) : null;
        const box = boxButton ? parentOfNode(boxButton) : null;
        const where = String(box?._name ?? '(游离)');
        if (boxButton?._name !== 'BoxBtn') {
            wrong.push(`${where} 的 Icon 不在 BoxBtn 下（父链 = ${boxButton?._name ?? '?'}/${frame?._name ?? '?'}）`);
        }
        const sprite = componentsOf(icon).find((comp) => comp.__type__ === 'cc.Sprite');
        const transform = componentsOf(icon).find((comp) => comp.__type__ === 'cc.UITransform');
        if (!sprite) {
            wrong.push(`${where} 的 Icon 缺 cc.Sprite`);
        } else {
            iconSprites.add(sprite);
            if (sprite._sizeMode !== 0) {
                wrong.push(`${where} 的 Icon sizeMode=${String(sprite._sizeMode)}（应为 0/CUSTOM，与行奖励格一致）`);
            }
        }
        const size = transform?._contentSize as { width?: number; height?: number } | undefined;
        if (size?.width !== 72 || size?.height !== 72) {
            wrong.push(`${where} 的 Icon 尺寸 ${size?.width ?? '?'}x${size?.height ?? '?'}（应为 72x72，FGUI com_goods 100×0.8=80 框内口径）`);
        }
        if (icon._layer !== 33554432) {
            wrong.push(`${where} 的 Icon layer=${String(icon._layer)}（不是 UI_2D 会整棵不渲染）`);
        }
    }

    const cid = scriptCid('assets/script/app/sevenDay/SevenDayPointBox.ts');
    const pointBoxes = PREFAB.filter((entry) => entry && entry.__type__ === cid);
    assert.equal(pointBoxes.length, 5, `SevenDayPointBox 应为 5 个，实际 ${pointBoxes.length}`);
    for (const component of pointBoxes) {
        const target = refAt(component.rewardIcon);
        if (!target) {
            wrong.push('有 SevenDayPointBox 的 rewardIcon 没绑（宝箱里那件物品永远出不来）');
            continue;
        }
        if (target.__type__ !== 'cc.Sprite') {
            wrong.push(`rewardIcon 指到了 ${String(target.__type__)}（应为 Icon 上的 cc.Sprite）`);
        } else if (!iconSprites.has(target)) {
            wrong.push('rewardIcon 指到了 5 个宝箱图标之外的 Sprite');
        }
        // 老端宝箱**没有**红点（`com_rd` 只出现在天球 / 页签 / 行内「领取」三处），
        // 所以这里刻意是 null；`SevenDayPointBox.render` 靠 `if (this.redDot)` 兜着。
        if (component.redDot !== null) {
            wrong.push('宝箱上出现了红点 —— 老端 `按钮_七日狂欢_宝箱.xml` 里没有 com_rd，属于多做的东西');
        }
    }
    assert.deepEqual(wrong, [], `宝箱的物品位没接完整：\n${wrong.join('\n')}`);
});

test('宝箱「达标积分」数字要画在装饰件之上（FGUI displayList 序 ≠ 新端节点序）', () => {
    // 老端 `组件/组件_七日狂欢_宝箱item.xml` 的 displayList 序 = 进度条 → btn_box → `bb_pic24`（六边形装饰）
    // → `title`（数字）；FGUI 的语义是**后列的画在上层** ⇒ 数字压在装饰件上。
    // 新端先前把 `Deco`（`sd_bb24`）摆成最后一个子节点 ⇒ 数字被六边形盖住。
    // 现场：实拍里数字看着像 `,0 / ,25`，而 dump 里 `string` 明明是 `10 / 25`。
    const wrong: string[] = [];
    for (let index = 1; index <= 5; index++) {
        const box = PREFAB_NODES.find((node) => node._name === `Box${index}`);
        if (!box) {
            wrong.push(`缺 Box${index}`);
            continue;
        }
        const order = childNamesOf(box);
        const deco = order.indexOf('Deco');
        const label = order.indexOf('NeedLabel');
        if (deco < 0 || label < 0) {
            wrong.push(`Box${index} 缺 Deco/NeedLabel（当前 ${order.join(' > ')}）`);
            continue;
        }
        if (deco > label) {
            wrong.push(`Box${index}: ${order.join(' > ')} —— Deco 必须排在 NeedLabel **之前**`);
        }
    }
    assert.deepEqual(wrong, [], `宝箱层序不对（数字被装饰件压住）：\n${wrong.join('\n')}`);
});

test('图标预加载必须**两路**都收：列表行 + 底部宝箱（只收行 ⇒ 宝箱物品图静默不加载）', () => {
    // `loadIconFrames` 的入口参数是「这一趟算出来的行」，但奖励来源有**两处**：
    // 列表行（task/shop）与底部积分宝箱（`snapshot.boxes`）。只收行的话，宝箱里那件物品的图
    // 永远进不了缓存 —— 症状是「宝箱只剩品质框、物品位置空着」，不报错也不告警。
    const page = readFileSync('assets/script/app/sevenDay/SevenDayPage.ts', 'utf8');
    assert.match(
        page,
        /for \(const box of snapshot\.boxes\) collect\(box\.reward\[0\]\);/,
        'loadIconFrames 没收集宝箱奖励',
    );
    assert.match(page, /this\.presentBoxes\(snapshot, iconFrames\)/, 'presentBoxes 没拿到 iconFrames');
    assert.match(
        page,
        /this\.iconFrameOf\(row\.reward\[0\], snapshot, iconFrames\)/,
        '宝箱 render 没拿到图标帧（预加载了也白搭）',
    );
    // 反向：宝箱渲染不许退回到「不传图标」的那个签名
    assert.equal(
        /boxes\[index\]\.render\(\s*row\.point,[\s\S]{0,120}?qualityFrame,\s*\)/.test(page),
        false,
        '宝箱 render 又变回 4 参了（图标位被丢掉）',
    );
});

test('宝箱 `redDot` 必须判空（prefab 里刻意没有这个节点，无条件写会 TypeError 把整页带崩）', () => {
    const source = readFileSync('assets/script/app/sevenDay/SevenDayPointBox.ts', 'utf8');
    // 规则 104：反向断言先剥注释行，再按**行首**锚定（否则会误伤注释里引用的同一串代码）。
    const code = source
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));

    assert.ok(
        code.some((line) => /if \(this\.redDot\) this\.redDot\.active = state === 'claimable';/.test(line)),
        '宝箱红点没有判空',
    );
    const unconditional = code.filter((line) => /^\s*this\.redDot\.active\s*=/.test(line));
    assert.deepEqual(unconditional, [], '宝箱红点被改回无条件写了（渲染期 TypeError）');
});

test('11 个红点用的必须是工程的 RedDot 组件（不是挂占位 icon_01 的裸 Sprite）', () => {
    // 2026-09-28 按用户要求：首充 / 七日狂欢的红点统一改用工程的 RedDot 组件
    // （`assets/script/app/common/RedDot.ts` + `ui/common/RedDot.prefab`），不再用
    // 「裸 cc.Sprite + cm_red_dot」。红点美术（普通走 spine、回退静态图）由 RedDot
    // 组件自身保证（见 `reddot.test.ts`），本用例只钉三件事：
    //   ① 该有红点的 11 个位置一个不少；
    //   ② 每个 RedDot 根节点挂 RedDot 脚本组件、30×30、UI_2D；
    //   ③ 整个红点子树没有任何 Sprite 指回占位图 image/gameui/icon_01.png
    //      （该图已于 2026-10-09 随 `image/gameui` 旧资源清理删除；断言保留作历史防护 ——
    //        prefab 里永远不该再出现这个 uuid，资源没了更不该有）。
    const redDotCid = scriptCid('assets/script/app/common/RedDot.ts');
    const PLACEHOLDER = 'b1af7bc4-39bc-49d6-9e2c-83e96a1d3a08@f9941';

    const dots = PREFAB_NODES.filter((node) => node._name === 'RedDot');
    assert.equal(dots.length, 11, `RedDot 应为 11 个（7 天球 + 1 行内按钮 + 3 页签），实际 ${dots.length}`);

    /** 节点自身 + 全部后代节点（用来在整棵红点子树里查占位图）。 */
    const collectSubtree = (node: Record<string, unknown>): Array<Record<string, unknown>> => {
        const kids = ((node._children as Array<{ __id__: number }> | undefined) ?? [])
            .map((ref) => refAt(ref))
            .filter((child): child is Record<string, unknown> => child !== null);
        return [node, ...kids.flatMap(collectSubtree)];
    };

    const wrong: string[] = [];
    for (const node of dots) {
        const where = String(parentOfNode(node)?._name ?? '(游离)');
        const comps = componentsOf(node);
        if (!comps.some((comp) => comp.__type__ === redDotCid)) {
            wrong.push(`${where}.RedDot 没挂 RedDot 脚本组件（__type__ 应为 ${redDotCid}）`);
        }
        const transform = comps.find((comp) => comp.__type__ === 'cc.UITransform');
        const size = transform?._contentSize as { width?: number; height?: number } | undefined;
        if (size?.width !== 30 || size?.height !== 30) {
            wrong.push(`${where}.RedDot size = ${size?.width ?? '?'}x${size?.height ?? '?'}（应为 30x30，对齐老端 com_rd）`);
        }
        if (node._layer !== 33554432) wrong.push(`${where}.RedDot layer = ${String(node._layer)}`);
        for (const sub of collectSubtree(node)) {
            for (const comp of componentsOf(sub)) {
                const frame = (comp._spriteFrame as { __uuid__?: string } | null | undefined)?.__uuid__;
                if (frame === PLACEHOLDER) wrong.push(`${where} 红点子树指回了占位图 icon_01`);
            }
        }
    }
    assert.deepEqual(wrong, [], `红点不对（组件缺失 / 尺寸错 / 占位图）：\n${wrong.join('\n')}`);
});

test('天数红点画在选中光效上层（active 后不能仍被 SelectGlow 盖住）', () => {
    const wrong: string[] = [];
    for (let day = 1; day <= 7; day++) {
        const dayIndex = PREFAB.findIndex((entry) => entry && entry.__type__ === 'cc.Node' && entry._name === `Day${day}`);
        assert.ok(dayIndex >= 0, `缺 Day${day}`);
        const children = ((PREFAB[dayIndex]!._children as Array<{ __id__: number }>) ?? [])
            .map((ref) => PREFAB[ref.__id__]?._name as string);
        if (children.indexOf('RedDot') <= children.indexOf('SelectGlow')) wrong.push(`Day${day}: ${children.join(' > ')}`);
    }
    assert.deepEqual(wrong, [], `红点必须晚于选中光效渲染：\n${wrong.join('\n')}`);
});

test('长屏适配：页头贴顶、积分区贴底，Panel 与 RowView 吃掉额外高度', () => {
    const source = readFileSync('assets/script/app/sevenDay/SevenDayPage.ts', 'utf8');
    assert.match(source, /const DESIGN_HEIGHT = 1280;/);
    assert.match(source, /this\.captureLayoutBase\(\);/);
    assert.match(source, /this\.applyScreenLayout\(\);/);
    assert.match(source, /baseY \+ extra \/ 2/, '贴顶节点没有上移半个额外高度');
    assert.match(source, /baseY - extra \/ 2/, '贴底节点没有下移半个额外高度');
    assert.match(source, /this\.panelBaseHeight \+ extra/, 'Panel 没有纵向拉伸');
    assert.match(source, /this\.rowListBaseHeight \+ extra/, 'RowView 没有纵向拉伸');

    const pageCid = scriptCid('assets/script/app/sevenDay/SevenDayPage.ts');
    const page = PREFAB.find((entry) => entry && entry.__type__ === pageCid) as {
        panel?: { __id__: number };
        topAlignedNodes?: Array<{ __id__: number }>;
        bottomAlignedNodes?: Array<{ __id__: number }>;
    } | undefined;
    assert.ok(page?.panel, 'SevenDayPage.panel 未绑定');
    assert.equal(PREFAB[page!.panel!.__id__]!._name, 'Panel');
    const namesOf = (refs: Array<{ __id__: number }> | undefined): string[] =>
        (refs ?? []).map((ref) => String(PREFAB[ref.__id__]?._name));
    assert.deepEqual(
        namesOf(page!.topAlignedNodes),
        ['BgTop', 'BgDeco', 'TitleArt', 'CloseBtn', 'TimeBg', 'TimeLabel', 'TimeText', 'Hint', 'DayBar', 'TabBar'],
    );
    assert.deepEqual(namesOf(page!.bottomAlignedNodes), ['BoxBar', 'Medal', 'PointLabel', 'ChipBg', 'ChipLabel']);
});

test('点空白关闭：内容区只认 5 个**交互**节点（全屏美术/底板算空白），否则整屏都算内容 ⇒ 点哪儿都不关', () => {
    const source = readFileSync('assets/script/app/sevenDay/SevenDayPage.ts', 'utf8');

    // 必须真的在 onInit 里绑（PopupBase 的 `_internalOpen` 是 onInit → _bindBlankClose，顺序有保证）
    assert.match(source, /this\.bindBlankContent\(\);/, 'onInit 里没绑内容区');
    assert.match(source, /private bindBlankContent\(\): void \{/);

    // 判据 = 显式给「交互节点」，而不是留空让 PopupBase 自动取「全部激活的直接子节点」
    assert.match(
        source,
        /this\.closeButton, this\.dayBar, this\.tabBar, this\.rowList\?\.node, this\.boxBar/,
        '内容区没按「交互节点」列（少一个就会把对应控件那一片算成空白，点它误关）',
    );
    assert.match(source, /this\.contentNodes = interactive;/, '算了却没用上');

    // ⚠️ 反例 1：内容区被清空 ⇒ PopupBase 退回「全部直接子节点」⇒ BgTop(720×484) + Panel(720×1145)
    //    两根全屏底图都算内容 ⇒ 整屏都是内容 ⇒ 点空白永不关闭（用户报的就是这个）。
    assert.equal(
        /this\.contentNodes\s*=\s*\[\s*\]/.test(source),
        false,
        '内容区被清空了 ⇒ 又会退回「点哪儿都不关」',
    );
    // ⚠️ 反例 2：不能把全屏装饰底图塞进内容区。
    assert.equal(
        /this\.contentNodes\s*=\s*\[[^\]]*(BgTop|BgDeco|TitleArt|panel)/.test(source),
        false,
        '把全屏装饰底图当成内容区了 ⇒ 点它不关',
    );

    // 顺带钉住 prefab 侧：现在（工具写不了 nodeArray，见 bindBlankContent 注释）必须是空，
    // 将来若改成 Inspector 配置，也**只许**列交互节点、不许出现那几张全屏美术。
    const pageCid = scriptCid('assets/script/app/sevenDay/SevenDayPage.ts');
    const page = PREFAB.find((entry) => entry && entry.__type__ === pageCid) as
        | { contentNodes?: Array<{ __id__: number }> }
        | undefined;
    const names = (page?.contentNodes ?? []).map((ref) => String(PREFAB[ref.__id__]?._name));
    for (const bad of ['BgTop', 'BgDeco', 'TitleArt', 'Panel']) {
        assert.equal(names.includes(bad), false, `prefab 的 contentNodes 里不该出现全屏美术 ${bad}`);
    }
});

test('prefab 生成器同步红点与长屏布局配置（重生成不能回退）', () => {
    const generator = readFileSync('tmp/gen_seven_day.mjs', 'utf8');
    assert.match(generator, /dot: artUuid\('common\/cm_red_dot'\)/);
    assert.equal(/dot: artUuid\('gameui\/icon_01'\)/.test(generator), false);
    assert.match(generator, /page\.panel = refOf\('node', 'SevenDay\/Panel'\)/);
    assert.match(generator, /page\.topAlignedNodes = \[/);
    assert.match(generator, /page\.bottomAlignedNodes = \[/);
});

// ============================================================
// F. 「列表」口径 —— 完全对齐老端：**一张混合列表，没有页签栏**（2026-09-26）
// ============================================================
//
// 背景：用户拿老端实拍（图一）对比移植版（图二），图一没有页签栏、列表里一天的任务全都在。
// 真源 = FGUI 原稿 `<list name="list_tab" … visible="false">` + 老端
//        `listTab.update([SevenDayTab.task])` / `selectTab` 恒为 `task`。
// 用户明确选了「完全对齐图一」⇒ 界面走 `listRowsOfDay`，页签栏整块不显示。
// `listDayTabs` / `listRowsOfTab` **保留**为数据层能力（效果图里确实是 3 个页签，将来可能恢复）。

test('列表口径 = 老端的**单张混合列表**：day1 全部 10 条（2 福利 + 8 挑战）混排，且不含商品', () => {
    const rows = listRowsOfDay(TASKS, 1);
    assert.equal(rows.length, 10, `day1 应有 10 行（2 福利 + 8 挑战），实际 ${rows.length}`);
    assert.ok(rows.every((row) => row.kind === 'task'), '单列表里只该有任务行');
    const typeNames = new Set(rows.map((row) => (row.kind === 'task' ? row.task.typeName : '')));
    assert.deepEqual([...typeNames].sort(), ['今日挑战', '今日福利'], '福利与挑战必须在同一张列表里混排');

    // 含商品的行一条都没有 —— 老端 `tlShowTab = [SevenDayTab.task]`，半价礼包那一页本来就进不去
    assert.equal(rows.every((row) => row.kind === 'task'), true, '单列表不该混入商品行');

    // 与「按 typeName 拆页签」的能力对照：任务侧的条数应当**等量**，说明只是分组方式不同、没丢内容
    const byTab = listDayTabs(TASKS, SHOPS, 1);
    assert.equal(byTab.length, 3, '数据层仍能算出 3 个页签（今日福利/今日挑战/半价礼包）');
    const taskCountViaTabs = byTab.reduce(
        (sum, tab) => sum + listRowsOfTab(TASKS, SHOPS, 1, tab.typeName).filter((row) => row.kind === 'task').length,
        0,
    );
    assert.equal(taskCountViaTabs, rows.length, '拆页签与单列表的任务条数必须一致（只差分组）');

    // 过滤键是 `type`（老端 `["days","type"]`），不是 `typeName`
    assert.equal(SEVEN_DAY_TASK_TYPE, 2, '老端 `SevenDayTab.task = 2`');
    assert.ok(TASKS.every((task) => task.type === SEVEN_DAY_TASK_TYPE), '任务表 type 恒为 2');
    assert.ok(SHOPS.every((shop) => shop.type !== SEVEN_DAY_TASK_TYPE), '商品表 type 恒为 3');

    // 排序沿用 `sortKeyOf`：可领取（FINISH）的最前
    const claimable = TASKS.find((task) => task.days === 1)!;
    const sorted = listRowsOfDay(TASKS, 1, stateOf({ tasks: [[claimable.resId, 1, SEVEN_DAY_STATE_FINISH]] }));
    const head = sorted[0]!;
    assert.equal(head.kind === 'task' ? head.task.resId : 0, claimable.resId, '可领取的应排最前');

    // 空天：表里没有的天不凭空造行
    assert.deepEqual(listRowsOfDay(TASKS, 99), [], '不存在的天应给空列表');
});

test('界面默认走单列表：`SHOW_PAGE_TAB_BAR = false` + 行来自 `listRowsOfDay` + 页签栏在代码里关', () => {
    // 三处必须同时成立，少一处就退回「一个页签只剩 2 条、列表看着是空的」：
    //   ① 开关是 false；② 默认分支走 `listRowsOfDay`；③ `tabBar` 在**代码**里关
    //      （只靠 prefab 关的话，别人把 `_active` 改回 true 就「页签露出来 + 列表压住它」）。
    const page = readFileSync('assets/script/app/sevenDay/SevenDayPage.ts', 'utf8');
    assert.ok(
        page.includes('private static readonly SHOW_PAGE_TAB_BAR = false;'),
        '页签栏开关被打开或删掉了（老端口径 = 不显示）',
    );
    assert.ok(
        page.includes(': listRowsOfDay(snapshot.tasks, this.selectedDay, snapshot.state);'),
        '默认分支没走 `listRowsOfDay`（会不会只剩一个 typeName 的行？）',
    );
    assert.ok(
        page.includes('this.tabBar.active = SevenDayPage.SHOW_PAGE_TAB_BAR;'),
        '页签栏没有在代码里关掉',
    );
    assert.ok(
        page.includes('listRowsOfTab(snapshot.tasks, snapshot.shops, this.selectedDay, this.selectedTab, snapshot.state)'),
        '`listRowsOfTab` 那条分支被删了（将来要恢复页签就没路可走）',
    );
});
