/**
 * 装备栏 6 格取值的回归网（`RoleTable.buildEquipSlotPlan`，纯函数、零 `cc`）。
 *
 * ## 为什么要有这条
 *
 * 角色页装备栏的「6 格全空」是个**静默故障**：判定错了，界面只是空格子，一个字都不报。
 * 判定按项目规则 78 抽到零依赖的 `RoleTable`，这一组用例就是它的守卫。
 *
 * ## 覆盖的事实（都从真服实测 / 老端口径来，2026-09-26）
 *
 * 1. **恒返回 6 条**（下标 = 部位号 − 1）—— 界面按 `Equip1..Equip6` 顺序取，少一条就错位；
 * 2. `CmdEquipPart.equipId` 是**部位号 1..6**（⚠️ 与 `CmdEquipPage.tlCmdEquip[].equipId`
 *    同名不同义 —— 那边是**装备 resId**，真服实测值 401111 段）；
 * 3. **装备实例直接取 `part.equip`** —— 已穿戴的装备**不在** `CmdEquipItem` 缓存里
 *    （真服实测 0 行），任何「按 uniqueId 回查背包」的写法都会 6 格全空；
 * 4. 等级 = 分页里 `row.equipId === part.equip.resId` 的行，**跨页取最小非零**（0 级不参与）；
 * 5. 空位 `entry = null`、`level = 0`；穿着但分页查不到等级也是 `0`；
 * 6. 装备 resId 不在 equip 表 ⇒ entry 仍成立（`iconKey` 空 ⇒ 界面隐藏图标但显示框/等级）。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildEquipSlotPlan } from '../assets/script/app/role/RoleTable';

/** 造一条 `CmdEquipPart`。 */
const part = (equipId: unknown, equip: unknown) => ({ equipId, equip });

/** 造一条 `CmdEquipItem`（穿着中的装备实例）。 */
const eq = (uniqueId: unknown, resId: unknown, extra: Record<string, unknown> = {}) =>
    ({ uniqueId, resId, rank: 1, curQuality: 2, ...extra });

/** 造一页 `CmdEquipPage`（行的 equipId = 装备 resId）。 */
const page = (rows: Array<{ equipId: unknown; level: unknown }>) => ({ page: 0, tlCmdEquip: rows });

/** 造一行 equip 表。 */
const refRow = (resId: number, icon: string, quality = 1) => ({ resId, icon, name: `N${resId}`, quality });

test('恒返回 6 条，partId 依次 1..6', () => {
    const plan = buildEquipSlotPlan([], [], []);
    assert.equal(plan.length, 6);
    assert.deepEqual(plan.map((p) => p.partId), [1, 2, 3, 4, 5, 6]);
});

test('无数据 ⇒ 6 格全空、等级全 0', () => {
    const plan = buildEquipSlotPlan([], [], []);
    assert.ok(plan.every((p) => p.entry === null && p.level === 0));
});

test('部位 1/3/5 穿着装备 ⇒ entry 直接由 part.equip 构建，空位为 null', () => {
    const plan = buildEquipSlotPlan(
        [part(1, eq(5001, 401111)), part(3, eq(5003, 401112)), part(5, eq(5005, 401113))],
        [page([{ equipId: 401111, level: 11 }, { equipId: 401112, level: 13 }, { equipId: 401113, level: 15 }])],
        [refRow(401111, '图标_装备_武器6'), refRow(401112, '图标_装备_帽子6'), refRow(401113, '图标_装备_衣服6')],
    );
    assert.deepEqual(plan.map((p) => (p.entry ? p.entry.resId : null)), [401111, null, 401112, null, 401113, null]);
    assert.deepEqual(plan.map((p) => p.level), [11, 0, 13, 0, 15, 0]);
    const first = plan[0].entry!;
    assert.equal(first.iconKey, '图标_装备_武器6');
    assert.equal(first.name, 'N401111');
    assert.equal(first.quality, 2);      // curQuality 优先于表品质
    assert.equal(first.equipped, true);  // 部位上的装备必然「穿着中」
});

test('★ 等级按「分页行 equipId = 装备 resId」匹配 —— 用部位号匹配是上一版的事故根因', () => {
    // 行的 equipId 给 resId（真服形态）⇒ 命中
    const hit = buildEquipSlotPlan([part(1, eq(1, 401111))], [page([{ equipId: 401111, level: 4 }])], []);
    assert.equal(hit[0].level, 4);
    // 行的 equipId 给部位号（旧误解）⇒ 不命中，等级 0
    const miss = buildEquipSlotPlan([part(1, eq(1, 401111))], [page([{ equipId: 1, level: 4 }])], []);
    assert.equal(miss[0].level, 0);
});

test('等级跨页取最小非零（page0=20 / page1=12 ⇒ 12）', () => {
    const plan = buildEquipSlotPlan(
        [part(2, eq(5002, 401222))],
        [page([{ equipId: 401222, level: 20 }]), page([{ equipId: 401222, level: 12 }])],
        [],
    );
    assert.equal(plan[1].level, 12);
});

test('跨页里的 0 级不参与取小（0=该页没有这件装备，不是「等级 0」）', () => {
    const plan = buildEquipSlotPlan(
        [part(2, eq(5002, 401222))],
        [page([{ equipId: 401222, level: 0 }]), page([{ equipId: 401222, level: 7 }])],
        [],
    );
    assert.equal(plan[1].level, 7);
});

test('穿着装备但分页里查不到等级 ⇒ level = 0（不是 NaN / undefined）', () => {
    const plan = buildEquipSlotPlan([part(4, eq(5004, 401444))], [], []);
    assert.ok(plan[3].entry);
    assert.equal(plan[3].level, 0);
});

test('装备 resId 不在 equip 表 ⇒ entry 仍成立，iconKey/名字为空（界面隐藏图标、框/等级照走）', () => {
    const plan = buildEquipSlotPlan([part(1, eq(5001, 999999))], [], []);
    assert.ok(plan[0].entry);
    assert.equal(plan[0].entry!.iconKey, '');
    assert.equal(plan[0].entry!.name, '');
});

test('反例：部位号越界（0 / 7 / 负数）、equip 缺失、resId ≤ 0 一律不采纳', () => {
    const plan = buildEquipSlotPlan(
        [part(0, eq(4001, 401001)), part(7, eq(4007, 401007)), part(-1, eq(4000, 401000)),
            part(2, null), { equipId: 3 }, part(4, eq(4004, 0))],
        [],
        [],
    );
    assert.ok(plan.every((p) => p.entry === null), JSON.stringify(plan));
});

test('脏数据不崩：null 条目 / tlCmdEquip 不是数组 / level 是字符串 / uniqueId 是 Long 形态', () => {
    const longLike = { low: 77, high: 0, toNumber: () => 77 };   // protobufjs Long 最小形态
    const plan = buildEquipSlotPlan(
        [null, { equipId: 1, equip: null }, part(2, eq(longLike, 402222))],
        [null, { tlCmdEquip: 'oops' }, { tlCmdEquip: [null, { equipId: 402222, level: '9' }] }],
        [refRow(402222, 'icon_x')],
    );
    assert.equal(plan[0].entry, null);      // partId 1：equip 为 null 不采纳
    assert.equal(plan[2].entry, null);      // partId 3：没有下发
    assert.equal(plan[1].entry!.id, 77);   // Long 形态也能读
    assert.equal(plan[1].level, 9);        // 字符串数字也认（服务端 Long / string 两种形态）
});

test('同一部位重复下发 ⇒ 后者覆盖（服务端全量重发语义）', () => {
    const plan = buildEquipSlotPlan([part(1, eq(5001, 401111)), part(1, eq(6001, 401112))], [], [refRow(401112, 'b')]);
    assert.equal(plan[0].entry!.resId, 401112);
    assert.equal(plan[0].entry!.id, 6001);
});
