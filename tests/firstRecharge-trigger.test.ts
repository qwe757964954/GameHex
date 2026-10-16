/**
 * 「新首充」**自动弹出**的判定口径单测。
 *
 * 覆盖 `assets/script/app/firstRecharge/FirstRechargeTrigger.ts`（零 import 纯函数）。
 * 运行时胶水层（`FirstRechargeAutoOpen`）依赖 `cc` / 弹窗管理器 / 网络缓存，不在单测范围 ——
 * 它的正确性靠「判定全在纯函数里 + 本文件盯住判定」来保证。
 *
 * 口径来源：老客户端 `TabFight.init()` + `ModelChapterNew.GetMaxChallengeLevel()`。
 * 移植时把散落的判定收敛成传参纯函数，才有了这层回归网。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
    deriveMaxChallengeLevel,
    EMPTY_BATTLE_RESULT,
    FIRST_RECHARGE_CHALLENGE_LEVEL_THRESHOLD,
    GUANKA_INSTANCE_TYPE_NORMAL,
    isNewDay,
    parseGuankaLevelRow,
    resolveFirstRechargeTrigger,
    shouldMarkNewDay,
    startOfDayMs,
} from '../assets/script/app/firstRecharge/FirstRechargeTrigger';
import type { IGuankaLevelRow } from '../assets/script/app/firstRecharge/FirstRechargeTrigger';

// ============================================================
// 夹具
// ============================================================

/** 造一行关卡配置。 */
function guanka(level: number, instanceType: number = GUANKA_INSTANCE_TYPE_NORMAL): IGuankaLevelRow {
    return { level, instanceType };
}

/** 造一份「关卡 1..count 都过了」的判定函数。 */
function passedUpTo(count: number): (level: number) => boolean {
    return (level) => level <= count;
}

/** 读 remoteRef 的列存表（`{k, v, c}`）→ 行对象数组。 */
function readRefRows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as {
        k: string[];
        v: unknown[][];
    };
    return source.v.map((row) => {
        const entry: Record<string, unknown> = {};
        source.k.forEach((key, index) => { entry[key] = row[index]; });
        return entry;
    });
}

// ============================================================
// 触发条件矩阵
// ============================================================

test('阈值常量与老端口径一致（> 3）', () => {
    assert.equal(FIRST_RECHARGE_CHALLENGE_LEVEL_THRESHOLD, 3);
    assert.equal(GUANKA_INSTANCE_TYPE_NORMAL, 0);
    assert.deepEqual(EMPTY_BATTLE_RESULT, { level: 0, result: 0, star: 0 });
});

test('第一道闸：第 1 关失败一律不弹，跨天那支也不走', () => {
    // 老端 `if (lastBattleResult.level == 1 && lastBattleResult.result == 0) { // nothing to do }`
    const reason = resolveFirstRechargeTrigger({
        lastBattleResult: { level: 1, result: 0, star: 0 },
        isNewDay: true,
        maxChallengeLevel: 99,
    });
    assert.equal(reason, 'none');
});

test('触发①：通关第 3 关当场弹（与是否跨天无关）', () => {
    for (const isNewDay of [true, false]) {
        const reason = resolveFirstRechargeTrigger({
            lastBattleResult: { level: 3, result: 1, star: 1 },
            isNewDay,
            maxChallengeLevel: 1, // 故意给个不满足阈值的最小值，证明走的是①而不是②
        });
        assert.equal(reason, 'level', `isNewDay=${isNewDay} 时应命中①`);
    }
});

test('①与②互斥：两条件同时成立时优先报 level', () => {
    const reason = resolveFirstRechargeTrigger({
        lastBattleResult: { level: 3, result: 1, star: 3 },
        isNewDay: true,
        maxChallengeLevel: 50,
    });
    assert.equal(reason, 'level');
    // 老端用 `openFirstRecharge` 布尔保证①命中后②不再弹一次；这里用「单一返回值」表达同一件事。
    assert.equal(shouldMarkNewDay(reason), false, '①命中时不能记「今天弹过了」');
});

test('第 3 关失败不算①（result 必须为 1）', () => {
    const reason = resolveFirstRechargeTrigger({
        lastBattleResult: { level: 3, result: 0, star: 0 },
        isNewDay: false,
        maxChallengeLevel: 99,
    });
    assert.equal(reason, 'none');
});

test('其它关通关也不触发①（只有 level === 3）', () => {
    for (const level of [2, 4, 5, 10]) {
        const reason = resolveFirstRechargeTrigger({
            lastBattleResult: { level, result: 1, star: 3 },
            isNewDay: false,
            maxChallengeLevel: 99,
        });
        assert.equal(reason, 'none', `level=${level} 不该命中①`);
    }
});

test('触发②：跨天 + 关卡进度过阈值', () => {
    const reason = resolveFirstRechargeTrigger({
        lastBattleResult: EMPTY_BATTLE_RESULT,
        isNewDay: true,
        maxChallengeLevel: FIRST_RECHARGE_CHALLENGE_LEVEL_THRESHOLD + 1,
    });
    assert.equal(reason, 'newDay');
    assert.equal(shouldMarkNewDay(reason), true, '②命中后必须记「今天弹过了」');
});

test('阈值是严格大于：maxChallengeLevel 恰好 = 3 不弹', () => {
    const reason = resolveFirstRechargeTrigger({
        lastBattleResult: EMPTY_BATTLE_RESULT,
        isNewDay: true,
        maxChallengeLevel: FIRST_RECHARGE_CHALLENGE_LEVEL_THRESHOLD,
    });
    assert.equal(reason, 'none');
});

test('没跨天就不走②（同一天只弹一次的另一半保证）', () => {
    const reason = resolveFirstRechargeTrigger({
        lastBattleResult: EMPTY_BATTLE_RESULT,
        isNewDay: false,
        maxChallengeLevel: 99,
    });
    assert.equal(reason, 'none');
});

test('非第 1 关的失败仍继续往下判②（老端原样行为，别"顺手修正"）', () => {
    const reason = resolveFirstRechargeTrigger({
        lastBattleResult: { level: 2, result: 0, star: 0 },
        isNewDay: true,
        maxChallengeLevel: 5,
    });
    assert.equal(reason, 'newDay');
});

test('第 1 关胜利但没到 3 关：不触发①，交②判', () => {
    assert.equal(
        resolveFirstRechargeTrigger({
            lastBattleResult: { level: 1, result: 1, star: 3 },
            isNewDay: false,
            maxChallengeLevel: 5,
        }),
        'none',
    );
    assert.equal(
        resolveFirstRechargeTrigger({
            lastBattleResult: { level: 1, result: 1, star: 3 },
            isNewDay: true,
            maxChallengeLevel: 5,
        }),
        'newDay',
    );
});

// ============================================================
// 关卡进度（照搬 ModelChapterNew.GetMaxChallengeLevel）
// ============================================================

test('关卡进度从 1 起：一关没过 = 1', () => {
    const rows = [guanka(1), guanka(2), guanka(3), guanka(4)];
    assert.equal(deriveMaxChallengeLevel(rows, () => false), 1);
});

test('通关 N 关 ⇒ 进度 N + 1（返回的是"下一关"）', () => {
    const rows = [guanka(1), guanka(2), guanka(3), guanka(4), guanka(5)];
    assert.equal(deriveMaxChallengeLevel(rows, passedUpTo(3)), 4);
});

test('遇到第一个没过就 break —— 中间断档时后面过的也不算', () => {
    const rows = [guanka(1), guanka(2), guanka(3), guanka(4), guanka(5)];
    // 1、2 过，3 没过，4、5 过了 —— 结果必须停在第 3 关，不是「一共过了 4 关」。
    const isPassed = (level: number): boolean => level === 1 || level === 2 || level === 4 || level === 5;
    assert.equal(deriveMaxChallengeLevel(rows, isPassed), 3);
});

test('全过时 clamp 到普通关卡行数（不是行数 + 1）', () => {
    const rows = [guanka(1), guanka(2), guanka(3)];
    assert.equal(deriveMaxChallengeLevel(rows, () => true), 3);
});

test('非 Normal 的行既不计入进度、也不计入 clamp 的分母', () => {
    const rows = [guanka(1), guanka(2, 1), guanka(3, 10), guanka(4)];
    // Normal 行只有 level 1 与 4；难度关（instanceType 1 / 10）跳过。
    assert.equal(deriveMaxChallengeLevel(rows, passedUpTo(1)), 2);
    // 全过：普通行 2 行 ⇒ clamp 到 2。
    assert.equal(deriveMaxChallengeLevel(rows, () => true), 2);
});

test('clamp 用完整普通行数，不是 break 前数到的行数', () => {
    // 第 1 关就断：若 clamp 分母被误写成「break 前遍历到的行数」，这里会算出 1 而不是 4。
    const rows = [guanka(1), guanka(2), guanka(3), guanka(4)];
    assert.equal(deriveMaxChallengeLevel(rows, () => false), 1);
    // 第 5 关全过 ⇒ 4 行 ⇒ clamp 到 4（= 行数，不是 5）。
    const rows5 = [guanka(1), guanka(2), guanka(3), guanka(4), guanka(5)];
    assert.equal(deriveMaxChallengeLevel(rows5, () => true), 5);
});

test('空行列表返回 0 —— 老端 clamp 的原样行为（别改成 1）', () => {
    // 老端：`if (maxLevel > tlRef.length) maxLevel = tlRef.length` ⇒ 空表时 0。
    // 运行时侧「表读不到」由 `getMaxChallengeLevel()` 自己兜成 1，不靠这里。
    assert.equal(deriveMaxChallengeLevel([], () => true), 0);
});

test('真表 guankaReward：结构与阈值口径对得上', () => {
    const rows = readRefRows('guankaReward')
        .map((row) => parseGuankaLevelRow(row))
        .filter((row): row is IGuankaLevelRow => row != null);

    assert.ok(rows.length > 0, 'guankaReward 表不该一行都解析不出来');
    const normalCount = rows.filter((row) => row.instanceType === GUANKA_INSTANCE_TYPE_NORMAL).length;
    assert.ok(normalCount > 3, `普通关卡应多于 ${FIRST_RECHARGE_CHALLENGE_LEVEL_THRESHOLD} 关（现有 ${normalCount} 关）`);

    // 一关没过 ⇒ 进度 1 ⇒ 不满足阈值（首充不该在开局就自动弹）。
    assert.equal(deriveMaxChallengeLevel(rows, () => false), 1);
    // 普通关卡全过 ⇒ clamp 到普通关卡数。
    assert.equal(deriveMaxChallengeLevel(rows, () => true), normalCount);
});

// ============================================================
// 行解析容错
// ============================================================

test('parseGuankaLevelRow 只认合法 level，坏行返回 null', () => {
    assert.deepEqual(parseGuankaLevelRow({ level: 3, instanceType: 0 }), { level: 3, instanceType: 0 });
    // 数字串也认（列存表里可能是字符串）。
    assert.deepEqual(parseGuankaLevelRow({ level: '7', instanceType: '0' }), { level: 7, instanceType: 0 });
    // 缺 instanceType ⇒ -1（= 非普通关卡，会被 derive 跳过），不会当成 Normal。
    assert.deepEqual(parseGuankaLevelRow({ level: 1 }), { level: 1, instanceType: -1 });

    for (const bad of [null, undefined, 0, 'x', [], {}, { level: 0 }, { level: -1 }, { level: 1.5 }, { level: 'a' }]) {
        assert.equal(parseGuankaLevelRow(bad), null, `坏行未被拦下：${JSON.stringify(bad)}`);
    }
});

// ============================================================
// 跨天判定
// ============================================================

test('startOfDayMs 归到本地时区当天 0 点', () => {
    const at = new Date(2026, 8, 23, 10, 57, 26, 0).getTime();
    const start = startOfDayMs(at);
    const date = new Date(start);
    assert.equal(date.getHours(), 0);
    assert.equal(date.getMinutes(), 0);
    assert.equal(date.getSeconds(), 0);
    assert.equal(date.getDate(), 23);
});

test('isNewDay：与上次记录的那天 0 点比，从没记过（0）算新的一天', () => {
    const morning = new Date(2026, 8, 23, 9, 0, 0, 0).getTime();
    const night = new Date(2026, 8, 23, 23, 59, 0, 0).getTime();
    const today0 = startOfDayMs(morning);

    assert.equal(isNewDay(0, morning), true, '从没记过 ⇒ 视为新的一天');
    assert.equal(isNewDay(today0, night), false, '同一天的深夜仍不算跨天');
    assert.equal(isNewDay(today0, new Date(2026, 8, 24, 0, 1, 0, 0).getTime()), true, '次日 00:01 算跨天');
});

test('跨天戳是 0 点粒度：同一天内多次判定结果稳定', () => {
    const times = [0, 6, 12, 18, 23].map((hour) => new Date(2026, 8, 23, hour, 30, 0, 0).getTime());
    const stamps = times.map((t) => startOfDayMs(t));
    for (const stamp of stamps) assert.equal(stamp, stamps[0], '同一天不同时刻的 0 点必须相同');
});

// ============================================================
// 同一天只弹一次的完整推演
// ============================================================

test('推演：跨天弹一次 → 记录 → 同一天不再弹；次日再弹', () => {
    const day1 = new Date(2026, 8, 23, 9, 0, 0, 0).getTime();
    const day2 = new Date(2026, 8, 24, 9, 0, 0, 0).getTime();
    const input = (nowMs: number, saved: number) => ({
        lastBattleResult: EMPTY_BATTLE_RESULT,
        isNewDay: isNewDay(saved, nowMs),
        maxChallengeLevel: 5,
    });

    // 第一天：跨天 → 弹
    assert.equal(resolveFirstRechargeTrigger(input(day1, 0)), 'newDay');
    // 记录后同一天再看：不弹
    const saved = startOfDayMs(day1);
    assert.equal(resolveFirstRechargeTrigger(input(day1, saved)), 'none');
    // 次日：再弹
    assert.equal(resolveFirstRechargeTrigger(input(day2, saved)), 'newDay');
});

test('推演：先通关第 3 关弹过（不写跨天戳）→ 当天稍后仍会因跨天弹一次', () => {
    const now = new Date(2026, 8, 23, 9, 0, 0, 0).getTime();
    // 同一场战斗的结果被消费一次后清零 —— 模拟 `checkFirstRechargeOnEnterMain` 的 finally。
    const levelReason = resolveFirstRechargeTrigger({
        lastBattleResult: { level: 3, result: 1, star: 3 },
        isNewDay: true,
        maxChallengeLevel: 4,
    });
    assert.equal(levelReason, 'level');
    assert.equal(shouldMarkNewDay(levelReason), false);

    // 清零后再进主界面：战绩空了，但跨天戳还是 0 ⇒ 走②再弹一次。
    // 这正是老端的行为（①不写 SaveToday，所以跨天保底那支仍会命中）。
    assert.equal(
        resolveFirstRechargeTrigger({
            lastBattleResult: EMPTY_BATTLE_RESULT,
            isNewDay: isNewDay(0, now),
            maxChallengeLevel: 4,
        }),
        'newDay',
    );
});
