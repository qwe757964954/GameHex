/**
 * 主界面「活动入口」可见性判定的单测。
 *
 * 覆盖的事：**`open` 表里 64 行不是全都会显示** —— 老端 `GObjEntrance.Init()` 逐行判
 * `SystemObject.GetVisibleConditionSet().GetBool()`，判不过的不进列表。本工程等价物是
 * `MainEntranceVisible`，这里把它逐条钉住，并用**真实 `open.json`** 跑三态玩家：
 *
 * | 状态 | 左侧（belond=2） | 右侧（belond=3） |
 * |---|---|---|
 * | 未登录（无 `CmdRole`） | 1 条 | 2 条 |
 * | 新手（1 级 / 没过关 / 没充值 / 第 1 天） | 2 条 | 3 条 |
 * | 老玩家（100 级 / 全通关 / 创建 30 天 / 充过值） | 4 条 | 3 条 |
 *
 * 「全量」（只按 `belond` 过滤）是 8 / 4 —— 断言里两边都写，差值就是可见性判定砍掉的。
 *
 * 只 import 零引擎依赖的模块：`MainEntranceTypes` 对 `MainEntranceVisible` 只有
 * `import type`，运行时依赖链是空的。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { collectEntranceItems, EntranceBelond, type OpenRowLike } from '../assets/script/app/main/MainEntranceTypes';
import {
    EMPTY_ENTRANCE_PLAYER_STATE,
    evaluateEntranceCondition,
    expandVisibleConditions,
    indexOpenRowsByRefId,
    isEntranceRowVisible,
    type EntrancePlayerState,
    type EntranceVisibleRow,
} from '../assets/script/app/main/MainEntranceVisible';

const OPEN_TABLE = 'assets/remoteRef/open.json';

/** 真实 `open` 全表（`open.json` 顶层就是行数组，`icon`/`visibleCondition` 都是行内字段）。 */
const OPEN_ROWS: OpenRowLike[] = JSON.parse(readFileSync(OPEN_TABLE, 'utf8')) as OpenRowLike[];

/** 一份「要什么有什么」的基准状态，各用例只覆盖自己关心的列。 */
function stateWith(patch: Partial<EntrancePlayerState>): EntrancePlayerState {
    return { ...EMPTY_ENTRANCE_PLAYER_STATE, hasRole: true, ...patch };
}

/** 未登录：`CmdRole` 拿不到 ⇒ `EMPTY_ENTRANCE_PLAYER_STATE`。 */
const GUEST = EMPTY_ENTRANCE_PLAYER_STATE;

/** 新手：1 级、一关没过、没充过值、创角第 1 天。 */
const NEWBIE = stateWith({ roleLevel: 1, createdDays: 1, isLevelPassed: () => false });

/** 老玩家：100 级、200 关全通、每天登录第 30 天、充过值且首充还有下一档。 */
const VETERAN = stateWith({
    roleLevel: 100,
    createdDays: 30,
    rechargeCount: 1,
    firstRechargeId: 1,
    firstRechargeNextExists: true,
    isLevelPassed: (level) => level >= 1 && level <= 200,
});

/** 首充买完最后一档：`recharge > 0`、档位 4、且 `firstRechargeNew` 里没有第 5 档。 */
const FIRST_RECHARGE_DONE = stateWith({
    roleLevel: 100,
    createdDays: 30,
    rechargeCount: 1,
    firstRechargeId: 4,
    firstRechargeNextExists: false,
    isLevelPassed: () => true,
});

const byRefId = indexOpenRowsByRefId(OPEN_ROWS);

/** 某一侧在给定状态下的 refId 序（已过 belond / icon / 可见性三道闸，按 order+refId 排）。 */
function visibleRefIds(belond: EntranceBelond, state: EntrancePlayerState): number[] {
    return collectEntranceItems(OPEN_ROWS, belond, (row) => isEntranceRowVisible(row, byRefId, state)).map(
        (item) => item.refId,
    );
}

// ── 单条条件 ──────────────────────────────────────────────────────────

test('roleLevel：按等级比较，拿不到角色行时一律不满足', () => {
    const cond = { type: 'roleLevel', param: { value: 25 } };
    assert.equal(evaluateEntranceCondition(cond, stateWith({ roleLevel: 25 })), 'pass');
    assert.equal(evaluateEntranceCondition(cond, stateWith({ roleLevel: 100 })), 'pass');
    assert.equal(evaluateEntranceCondition(cond, stateWith({ roleLevel: 24 })), 'fail');
    // 老端 `vo && (vo.GetLevel() >= level) || false`
    assert.equal(evaluateEntranceCondition(cond, GUEST), 'fail');
    // 缺参数 → 按不满足（并 warn），不放一个判不动的入口进去
    assert.equal(evaluateEntranceCondition({ type: 'roleLevel' }, VETERAN), 'fail');
});

test('battleLevel：走 isLevelPassed，缺 resId 按不满足', () => {
    const cond = { type: 'battleLevel', param: { resId: 3 } };
    assert.equal(evaluateEntranceCondition(cond, stateWith({ isLevelPassed: (l) => l <= 3 })), 'pass');
    assert.equal(evaluateEntranceCondition(cond, stateWith({ isLevelPassed: (l) => l <= 2 })), 'fail');
    assert.equal(evaluateEntranceCondition({ type: 'battleLevel' }, VETERAN), 'fail');
    // 阈值是「这一关过没过」，不是「>= resId」的关卡进度 —— 第 3 关过了但第 5 关没过时
    // `battleLevel:5` 必须 fail
    assert.equal(evaluateEntranceCondition({ type: 'battleLevel', param: { resId: 5 } }, stateWith({
        isLevelPassed: (l) => l <= 3,
    })), 'fail');
});

test('notTiShen：非提审包放行，提审包隐藏', () => {
    assert.equal(evaluateEntranceCondition({ type: 'notTiShen' }, NEWBIE), 'pass');
    assert.equal(evaluateEntranceCondition({ type: 'notTiShen' }, stateWith({ audit: true })), 'fail');
});

test('hasFirstRecharge：四个分支（老端 VarHasFirstRecharge 逐行照搬）', () => {
    const cond = { type: 'hasFirstRecharge' };
    // ① 拿不到角色行 → false
    assert.equal(evaluateEntranceCondition(cond, GUEST), 'fail');
    // ② 从没充过值 → true
    assert.equal(evaluateEntranceCondition(cond, stateWith({ rechargeCount: 0 })), 'pass');
    // ③ 充过值但还没进首充流程（id == 0）→ true
    assert.equal(evaluateEntranceCondition(cond, stateWith({ rechargeCount: 1, firstRechargeId: 0 })), 'pass');
    // ④ 进过流程、下一档存在 → true；下一档不存在（买完）→ false
    assert.equal(evaluateEntranceCondition(cond, stateWith({
        rechargeCount: 1, firstRechargeId: 2, firstRechargeNextExists: true,
    })), 'pass');
    assert.equal(evaluateEntranceCondition(cond, FIRST_RECHARGE_DONE), 'fail');
});

test('roleCreateDays：闭区间 [resId, value]（老端 `>= stday && <= etday`）', () => {
    const cond = { type: 'roleCreateDays', param: { resId: 1, value: 7 } };
    assert.equal(evaluateEntranceCondition(cond, stateWith({ createdDays: 1 })), 'pass');
    assert.equal(evaluateEntranceCondition(cond, stateWith({ createdDays: 7 })), 'pass');
    assert.equal(evaluateEntranceCondition(cond, stateWith({ createdDays: 8 })), 'fail');
    // 拿不到创角时间时取数层给 0 ⇒ 0 >= 1 不成立
    assert.equal(evaluateEntranceCondition(cond, stateWith({ createdDays: 0 })), 'fail');
    assert.equal(evaluateEntranceCondition({ type: 'roleCreateDays', param: { resId: 1 } }, VETERAN), 'fail');
});

test('guardsExist：等级够或有守卫都算满足（老端 `IsLevelEnough() || IsGuardExist()`）', () => {
    const cond = { type: 'guardsExist', param: { value: 40 } };
    assert.equal(evaluateEntranceCondition(cond, stateWith({ roleLevel: 40 })), 'pass');
    assert.equal(evaluateEntranceCondition(cond, stateWith({ roleLevel: 39 })), 'fail');
    assert.equal(evaluateEntranceCondition(cond, stateWith({ roleLevel: 1, guardExists: true })), 'pass');
    assert.equal(evaluateEntranceCondition({ type: 'guardsExist' }, VETERAN), 'fail');
});

test('lotteryOpen：按 resId 命中已开启的转盘活动', () => {
    const cond = { type: 'lotteryOpen', param: { resId: 2 } };
    assert.equal(evaluateEntranceCondition(cond, stateWith({ lotteryOpenIds: [1, 2] })), 'pass');
    assert.equal(evaluateEntranceCondition(cond, stateWith({ lotteryOpenIds: [1, 3] })), 'fail');
    assert.equal(evaluateEntranceCondition(cond, VETERAN), 'fail');
    assert.equal(evaluateEntranceCondition({ type: 'lotteryOpen' }, VETERAN), 'fail');
});

test('open / close：常开与恒闭', () => {
    assert.equal(evaluateEntranceCondition({ type: 'open' }, GUEST), 'pass');
    assert.equal(evaluateEntranceCondition({ type: 'close' }, VETERAN), 'fail');
});

test('guanKaGiftShow 恒 false —— 老端那个 Var 没有 return，照搬不许"修"', () => {
    assert.equal(evaluateEntranceCondition({ type: 'guanKaGiftShow' }, VETERAN), 'fail');
    assert.equal(evaluateEntranceCondition({ type: 'guanKaGiftShow' }, GUEST), 'fail');
});

test('空 type 整条跳过（老端 `if (cond.type)`）；未识别类型按不满足', () => {
    assert.equal(evaluateEntranceCondition({}, VETERAN), 'skip');
    assert.equal(evaluateEntranceCondition({ type: '' }, VETERAN), 'skip');
    assert.equal(evaluateEntranceCondition({ type: '   ' }, VETERAN), 'skip');
    assert.equal(evaluateEntranceCondition(null, VETERAN), 'skip');
    assert.equal(evaluateEntranceCondition({ type: '还没实现的类型' }, VETERAN), 'fail');
});

// ── 整行（AND 语义） ──────────────────────────────────────────────────

test('一行入口 = 全部条件 && ；任一 fail 就隐藏，全 skip 则显示', () => {
    const row: EntranceVisibleRow = {
        refId: 900,
        visibleCondition: [{ type: 'battleLevel', param: { resId: 1 } }, { type: 'notTiShen' }],
    };
    assert.equal(isEntranceRowVisible(row, null, NEWBIE), false);
    assert.equal(isEntranceRowVisible(row, null, stateWith({ isLevelPassed: () => true })), true);
    assert.equal(isEntranceRowVisible(row, null, stateWith({ isLevelPassed: () => true, audit: true })), false);
    // `206` 那行的 `vis=[{}]` ⇒ 空 type 跳过 ⇒ 无约束
    assert.equal(isEntranceRowVisible({ refId: 206, visibleCondition: [{}] }, null, GUEST), true);
    // 没有 visibleCondition 字段 ⇒ 无约束
    assert.equal(isEntranceRowVisible({ refId: 301 }, null, GUEST), true);
    assert.equal(isEntranceRowVisible(null, null, GUEST), true);
});

// ── preResId 条件继承 ─────────────────────────────────────────────────

test('preResId：可见条件递归继承前置系统（413 → 409 → 103 是两跳）', () => {
    // 103 要求过关 1；409 要求过关 10（继承 103 + 自己）；413 继承 409（再叠个等级）
    const rows: EntranceVisibleRow[] = [
        { refId: 103, visibleCondition: [{ type: 'battleLevel', param: { resId: 1 } }] },
        { refId: 409, preResId: 103, visibleCondition: [{ type: 'battleLevel', param: { resId: 10 } }] },
        {
            refId: 413,
            preResId: 409,
            visibleCondition: [{ type: 'roleLevel', param: { value: 30 } }],
        },
    ];
    const index = indexOpenRowsByRefId(rows);

    const expanded = expandVisibleConditions(rows[2], index);
    assert.equal(expanded.length, 3, '前置链（103、409）+ 自己的应该全在');
    // 顺序 = 最远的前置在前（老端 concat 的同一顺序）
    assert.deepEqual(expanded.map((c) => (c.param as { resId?: number; value?: number }).resId ?? 0), [1, 10, 0]);

    const third = rows[2];
    // 只过 1 关 → 409 的 battleLevel:10 拦下 ⇒ 隐藏
    assert.equal(isEntranceRowVisible(third, index, stateWith({
        roleLevel: 99, isLevelPassed: (l) => l <= 5,
    })), false);
    // 过关 10 但等级不够 → 自己那条拦下
    assert.equal(isEntranceRowVisible(third, index, stateWith({
        roleLevel: 29, isLevelPassed: () => true,
    })), false);
    // 三条全过 → 显示
    assert.equal(isEntranceRowVisible(third, index, stateWith({
        roleLevel: 30, isLevelPassed: () => true,
    })), true);
});

test('preResId 成环不死循环（老端没防护，这里必须挡住）', () => {
    const rows: EntranceVisibleRow[] = [
        { refId: 1, preResId: 2, visibleCondition: [{ type: 'notTiShen' }] },
        { refId: 2, preResId: 1, visibleCondition: [{ type: 'battleLevel', param: { resId: 1 } }] },
    ];
    const index = indexOpenRowsByRefId(rows);
    assert.equal(isEntranceRowVisible(rows[0], index, NEWBIE), false); // 环停在 2 的条件上，判 fail
    assert.equal(isEntranceRowVisible(rows[0], index, stateWith({ isLevelPassed: () => true })), true);
});

test('indexOpenRowsByRefId：重复 refId 取先出现的那行，非法 refId 丢掉', () => {
    const index = indexOpenRowsByRefId([
        { refId: 5, visibleCondition: [{ type: 'notTiShen' }] },
        { refId: 5, visibleCondition: [{ type: 'close' }] },
        { refId: undefined, visibleCondition: [{ type: 'close' }] },
    ]);
    assert.equal(index.size, 1);
    assert.equal(index.get(5)?.visibleCondition?.length, 1);
});

// ── 真实 open 表 ─────────────────────────────────────────────────────

test('真实 open.json：belond 全量是左 8 / 右 4', () => {
    assert.equal(collectEntranceItems(OPEN_ROWS, EntranceBelond.left).length, 8);
    assert.equal(collectEntranceItems(OPEN_ROWS, EntranceBelond.right).length, 4);
});

test('真实 open.json：未登录（拿不到 CmdRole）时左 1 / 右 2', () => {
    // 老端 `vo == null ⇒ false`：带条件的全隐藏，只剩 410 月卡 / 206 好友 / 301 邮件
    assert.deepEqual(visibleRefIds(EntranceBelond.left, GUEST), [410]);
    assert.deepEqual(visibleRefIds(EntranceBelond.right, GUEST), [206, 301]);
});

test('真实 open.json：新手（1 级 / 没过关）时左 2 / 右 3', () => {
    // 左：首充（没充过 ⇒ 显示）+ 月卡；礼包/战令要过关 1、转盘要活动数据 ⇒ 全隐藏
    assert.deepEqual(visibleRefIds(EntranceBelond.left, NEWBIE), [101, 410]);
    // 右：七日（第 1 天在 1~7 窗口内）+ 好友 + 邮件；活动要过关 1 ⇒ 隐藏
    assert.deepEqual(visibleRefIds(EntranceBelond.right, NEWBIE), [202, 206, 301]);
});

test('真实 open.json：老玩家（100 级 / 全通关 / 第 30 天）时左 4 / 右 3', () => {
    // 左：首充 + 礼包 + 战令 + 月卡；4 个转盘入口仍隐藏（Demo3.8 没有活动数据）
    assert.deepEqual(visibleRefIds(EntranceBelond.left, VETERAN), [101, 103, 104, 410]);
    // 右：活动（过关 1）+ 好友 + 邮件；七日过了 7 天窗口 ⇒ 隐藏
    assert.deepEqual(visibleRefIds(EntranceBelond.right, VETERAN), [102, 206, 301]);
});

test('真实 open.json：首充买完最后一档后，首充入口消失', () => {
    assert.equal(visibleRefIds(EntranceBelond.left, FIRST_RECHARGE_DONE).includes(101), false);
    assert.equal(visibleRefIds(EntranceBelond.left, VETERAN).includes(101), true);
});

test('真实 open.json：左侧 entry 顺序按 order 升序（order 并列时按 refId）', () => {
    const items = collectEntranceItems(OPEN_ROWS, EntranceBelond.left);
    assert.deepEqual(items.map((i) => i.refId), [101, 103, 104, 410, 422, 424, 425, 426]);
    // 422/424/425/426 全是 order=6，按 refId 升序 —— 不依赖读表返回顺序
    assert.deepEqual(items.slice(4).map((i) => i.order), [6, 6, 6, 6]);
});
