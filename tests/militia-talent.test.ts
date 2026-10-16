/**
 * 民兵天赋（`assets/script/app/role/Militia*`）的单测。
 *
 * 覆盖**判定层**（`MilitiaTable` / `MilitiaTypes`，零 `cc`，规则 78）+ 一张真表端到端
 * （`assets/remoteRef/armyLevel.json`）—— 只测纯函数，不碰引擎。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
    buildMilitiaSnapshot,
    canAffordOf,
    focusIndexOf,
    parseMilitiaLevelRows,
    parseMilitiaModifiers,
    rowOfLevel,
    talentAttrsOf,
    talentCellsOf,
    talentDescsOf,
    talentDetailOf,
    talentIconKeyOf,
    talentStateOf,
} from '../assets/script/app/role/MilitiaTable';
import type { IMilitiaLevelRow } from '../assets/script/app/role/MilitiaTypes';
import { MILITIA_ARMY_ID } from '../assets/script/app/role/MilitiaTypes';

/** 列式表（`{k, v, c:1}`）→ 行对象数组（与 `RefUtil.compressKeyRefDataFix` 同形）。 */
function rowsOf(relPath: string): Array<Record<string, unknown>> {
    const json = JSON.parse(readFileSync(relPath, 'utf8')) as { k: string[]; v: unknown[][] };
    return json.v.map((cells) => {
        const row: Record<string, unknown> = {};
        json.k.forEach((key, i) => { row[key] = cells[i]; });
        return row;
    });
}

const levelRows = parseMilitiaLevelRows(rowsOf('assets/remoteRef/armyLevel.json'));
const modifiers = parseMilitiaModifiers(rowsOf('assets/remoteRef/skillAttrModifier.json'));

/** 手搓三行（1/2/3 级），用于不依赖真表的定点断言。 */
function fixture(): IMilitiaLevelRow[] {
    return parseMilitiaLevelRows([
        { id: MILITIA_ARMY_ID, level: 1, costGoldCnt: 80, costItemID: 16014, costItemNum: 10, modifyDesc: '', attrList: null, icon: '图标_民兵天赋_21', modify: null },
        { id: MILITIA_ARMY_ID, level: 2, costGoldCnt: 85, costItemID: 16014, costItemNum: 10, modifyDesc: '解锁"兵贵神速"选项', attrList: [26601401], icon: '图标_民兵天赋_1', modify: [26601407] },
        { id: MILITIA_ARMY_ID, level: 3, costGoldCnt: 90, costItemID: 16014, costItemNum: 10, modifyDesc: '', attrList: [26601402], icon: '图标_民兵天赋_2', modify: null },
        // 别的兵种 ⇒ 必须被过滤掉
        { id: 66001, level: 1, costGoldCnt: 500, costItemID: 16001, costItemNum: 75, modifyDesc: '', attrList: null, icon: 'x', modify: null },
    ]);
}

test('行解析：只留民兵，按等级升序', () => {
    const rows = fixture();
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((r) => r.level), [1, 2, 3]);
    assert.ok(rows.every((r) => r.id === MILITIA_ARMY_ID));
});

test('真表：民兵 201 级，1 级起、201 级止', () => {
    assert.ok(levelRows.length > 0, 'armyLevel 表里必须能解析出民兵的行');
    assert.equal(levelRows[0].level, 1);
    assert.equal(levelRows[levelRows.length - 1].level, levelRows.length);
    assert.equal(levelRows.length, 201);
});

test('三态 + 图标后缀：已解锁带 _1，未解锁带 _0', () => {
    assert.equal(talentStateOf(1, 1), 'current');
    assert.equal(talentStateOf(1, 3), 'unlocked');
    assert.equal(talentStateOf(5, 3), 'locked');

    const rows = fixture();
    assert.equal(talentIconKeyOf(rows[0], 1), '图标_民兵天赋_21_1'); // 1 级已解锁
    assert.equal(talentIconKeyOf(rows[2], 1), '图标_民兵天赋_2_0');  // 3 级未解锁
});

test('列表：等级降序（最高级在最上）', () => {
    const cells = talentCellsOf(fixture(), 1, modifiers);
    assert.deepEqual(cells.map((c) => c.level), [3, 2, 1]);
    assert.equal(cells[2].state, 'current');
    assert.equal(cells[1].isNext, true, '2 级是「下一级」');
});

test('焦点：优先「下一级」，没有则退「当前级」', () => {
    const cells = talentCellsOf(fixture(), 1, modifiers);
    assert.equal(focusIndexOf(cells, 1), 1, '下一级 = 2 级，索引 1（降序）');

    const maxed = talentCellsOf(fixture(), 3, modifiers);
    assert.equal(focusIndexOf(maxed, 3), 0, '已到顶：退回当前级（3 级在索引 0）');
});

test('effect：以 modify 优先，退回 attrList', () => {
    const cells = talentCellsOf(fixture(), 1, modifiers);
    const lv2 = cells.find((c) => c.level === 2)!;
    assert.equal(lv2.hasEffect, true);
    // modify[0] = 26601407（不是 attrList 的 26601401）⇒ 名字必须来自 modify 那条。
    assert.equal(lv2.effectName, modifiers.get(26601407)?.name ?? '');
    assert.ok(lv2.effectName.length > 0);
});

test('消耗判定：金币与道具都要够', () => {
    const row = rowOfLevel(fixture(), 1)!;
    assert.equal(canAffordOf(row, 80, 10), true);
    assert.equal(canAffordOf(row, 79, 10), false);
    assert.equal(canAffordOf(row, 80, 9), false);
    assert.equal(canAffordOf(null, 9999, 9999), false);
});

test('详情：消耗取 lv-1 那一行（升到 lv 的价写在上一级）', () => {
    const rows = fixture();
    const detail = talentDetailOf(rows, 1, 2, 100, 10, modifiers)!;
    assert.equal(detail.level, 2);
    assert.equal(detail.goldNeed, 80, '升到 2 级花的是 1 级那行的 80');
    assert.equal(detail.itemNeed, 10);
    assert.equal(detail.activatable, true, 'lv === cur+1 ⇒ 可激活');
    assert.equal(detail.canAfford, true);

    const notNext = talentDetailOf(rows, 1, 3, 100, 10, modifiers)!;
    assert.equal(notNext.activatable, false, '不是下一级 ⇒ 不给激活');
});

test('详情：点位未解锁的等级时图标后缀按该等级判', () => {
    const detail = talentDetailOf(fixture(), 1, 3, 0, 0, modifiers)!;
    assert.equal(detail.iconKey, '图标_民兵天赋_2_0');
    assert.equal(detail.canAfford, false);
});

test('快照：红点按当前等级行的消耗判', () => {
    const snap = buildMilitiaSnapshot(fixture(), 1, modifiers, 100, 10);
    assert.equal(snap.redDot, 1);
    assert.equal(buildMilitiaSnapshot(fixture(), 1, modifiers, 79, 10).redDot, 0);
    assert.equal(buildMilitiaSnapshot(fixture(), 0, modifiers, 999, 999).level, 1, '等级读不到兜 1');
});

test('总览：属性聚合并走 armyTalent 显示名', () => {
    // 真表：1 级没有 attrList，2 级起有 ⇒ 当前 3 级时应聚合出 2、3 两级的属性。
    const attrs = talentAttrsOf(levelRows, 3, modifiers);
    assert.ok(attrs.length > 0, '3 级时应当有聚合属性');
    for (const line of attrs) assert.match(line, /^.+[+-]?\d+\.\d%$/);

    // 显示名必须是 armyTalent 映射后的（26601401 的 data key 是「民兵暴击率」，
    // armyTalent 把它映射成同名 ⇒ 这里只断言「不是空 key 也没带百分号」）。
    assert.ok(attrs.every((a) => !a.startsWith('+')));
});

test('总览：描述列表取 modifyDesc（只含有 modify 的行）', () => {
    const descs = talentDescsOf(fixture(), 3);
    assert.deepEqual(descs, ['解锁"兵贵神速"选项'], '只有 2 级有 modify');
    assert.deepEqual(talentDescsOf(fixture(), 1), [], '1 级还没解锁任何 modify');
});
