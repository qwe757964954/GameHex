/**
 * 卡牌技能列表（`armySkillLevelUp`）与「升到第几级」判定的单测。
 *
 * 覆盖几个**容易静默错**的点：
 *   ① 表里一行 = **一个技能的一个等级档**，聚合必须按 `id`（直接 map 会得到 400+ 条）；
 *   ② 技能名只在有名字的那几行出现，聚合要取**第一个非空**；
 *   ③ 后端没给技能等级时按**第 1 档**算（不是 0 —— 0 会让「↑」指向不存在的档）；
 *   ④ 「↑」要判目标档的 `unlockarmylevel`，「↓」不判（降级是本地预览）；
 *   ⑤ 卡表 `pvpCard.skillList` 的初值就是 4 个技能（一行两格 × 每格两个按钮）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    buildArmySkillTable,
    canStepSkill,
    isSkillMaxed,
    parseArmySkillLevelRow,
    resolveCardSkills,
    resolveSkillLevel,
    skillLevelRow,
    skillLevelUnlocked,
    skillMaxLevel,
} from '../assets/script/app/card/CardSkillList';
import type { PvpHeroSkillLevel } from '../assets/script/app/card/PvpHeroService';

/** 读 remoteRef 的列存表（`{k, v}`）→ 行对象数组。 */
function readTable(name: string): Array<Record<string, unknown>> {
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

const TABLE = buildArmySkillTable(readTable('armySkillLevelUp'));
const PEASHOOTER_SKILLS = [100101, 100102, 100103, 100104];

function levelsOf(pairs: readonly (readonly [number, number])[]): PvpHeroSkillLevel[] {
    return pairs.map(([skillId, level]) => ({ skillId, level }));
}

test('armySkillLevelUp：按 skillId 聚合，一行只是一个等级档', () => {
    const raw = readTable('armySkillLevelUp');
    // 原表 428 行 → 聚合后必须是「技能数」量级，不是行数量级。
    assert.equal(TABLE.size, new Set(raw.map((row) => Number(row.id))).size);
    assert.ok(TABLE.size < raw.length, `聚合失败：表 ${TABLE.size} 条 / 原 ${raw.length} 行`);

    const skill = TABLE.get(100101);
    assert.ok(skill, '100101（豌豆快送）必须存在于表里');
    assert.equal(skill.name, '豌豆快送');
    assert.deepEqual(skill.levels.map((row) => row.level), [1, 2, 3]);
    assert.deepEqual(skill.levels.map((row) => row.unlockHeroLevel), [3, 14, 22]);
    assert.equal(skillMaxLevel(skill), 3);
});

test('armySkillLevelUp：坏行跳过、name 取第一个非空', () => {
    const rows = [
        { id: 900001, skilllevel: 1, unlockarmylevel: 0, name: '', desc: '第一档' },
        { id: 900001, skilllevel: 2, unlockarmylevel: 10, name: '后置名字', desc: '第二档' },
        // 缺 skilllevel ⇒ 整行丢弃
        { id: 900002, name: '无档位', desc: '' },
        // 缺 id ⇒ 丢弃
        { skilllevel: 1, name: '无编号' },
    ];
    const table = buildArmySkillTable(rows);
    assert.equal(table.size, 1);
    assert.equal(table.get(900001)?.name, '后置名字');
    assert.equal(table.get(900001)?.levels.length, 2);
    assert.equal(parseArmySkillLevelRow({ id: 0, skilllevel: 1 }), null, 'id=0 非法');
});

test('resolveCardSkills：顺序以卡表 skillList 为准，缺失告警跳过', () => {
    const skills = resolveCardSkills(TABLE, PEASHOOTER_SKILLS, '68001');
    assert.deepEqual(skills.map((skill) => skill.skillId), PEASHOOTER_SKILLS);
    assert.deepEqual(skills.map((skill) => skill.name), ['豌豆快送', '强化豌豆', '饥饿缠身', '黄袍加身']);

    const reversed = resolveCardSkills(TABLE, [100104, 100101], '68001');
    assert.deepEqual(reversed.map((skill) => skill.skillId), [100104, 100101]);

    const withMissing = resolveCardSkills(TABLE, [100101, 999999], '68001');
    assert.deepEqual(withMissing.map((skill) => skill.skillId), [100101]);

    assert.deepEqual(resolveCardSkills(TABLE, null), [], '没有 skillList ⇒ 空（主城/金矿）');
});

test('resolveSkillLevel：后端没给时按第 1 档，超出表上限按表上限', () => {
    const skill = TABLE.get(100101)!;
    assert.equal(resolveSkillLevel(skill, []), 1, '未拥有 / 老数据 ⇒ 第 1 档');
    assert.equal(resolveSkillLevel(skill, levelsOf([[100101, 2]])), 2);
    assert.equal(resolveSkillLevel(skill, levelsOf([[100101, 9]])), 3, '服务端档位高于表 ⇒ 按表上限');
    // 别的技能的等级不能串味
    assert.equal(resolveSkillLevel(skill, levelsOf([[100102, 3]])), 1);
});

test('skillLevelUnlocked / canStepSkill：↑ 判解锁等级，↓ 不判', () => {
    const skill = TABLE.get(100101)!;
    // 第 2 档要英雄 14 级
    assert.equal(skillLevelUnlocked(skill, 2, 13), false);
    assert.equal(skillLevelUnlocked(skill, 2, 14), true);

    assert.equal(canStepSkill(skill, 1, 1, 3, false), false, '13 级以下升不到第 2 档');
    assert.equal(canStepSkill(skill, 1, 1, 14, false), true);
    assert.equal(canStepSkill(skill, 1, 1, 14, true), false, '发包期间置灰');
    assert.equal(canStepSkill(skill, -1, 2, 14, false), true, '降级不需要解锁等级');
    assert.equal(canStepSkill(skill, -1, 1, 14, false), false, '第 1 档没有更低的');
    assert.equal(canStepSkill(skill, 1, 3, 99, false), false, '满档不能再升');
});

test('isSkillMaxed / skillLevelRow：满档与档位查找', () => {
    const skill = TABLE.get(100101)!;
    assert.equal(isSkillMaxed(skill, 2), false);
    assert.equal(isSkillMaxed(skill, 3), true);
    assert.equal(skillLevelRow(skill, 2)?.unlockHeroLevel, 14);
    assert.equal(skillLevelRow(skill, 9), undefined);
});

test('isSkillMaxed：按「level + 1 是否存在」判满级，与发包口径一致', () => {
    // 配表只有 1 / 2 / 4 三档（缺 3）。升级请求永远是 +1 级，所以 2 级时
    // 目标档 3 不存在 ⇒ 必须判满级，否则按钮可点却必然无声失败。
    const sparse = buildArmySkillTable([
        { id: 910001, skilllevel: 1, unlockarmylevel: 0 },
        { id: 910001, skilllevel: 2, unlockarmylevel: 5 },
        { id: 910001, skilllevel: 4, unlockarmylevel: 20 },
    ]).get(910001)!;

    assert.equal(isSkillMaxed(sparse, 1), false, '1 → 2 存在');
    assert.equal(isSkillMaxed(sparse, 2), true, '2 → 3 缺档 ⇒ 满级');
    assert.equal(isSkillMaxed(sparse, 3), false, '3 → 4 存在');
    assert.equal(isSkillMaxed(sparse, 4), true, '4 → 5 不存在 ⇒ 满级');

    // 常规连续档位：1/2/3，3 级即满级。
    const normal = TABLE.get(100101)!;
    assert.equal(isSkillMaxed(normal, 3), true);
    assert.equal(isSkillMaxed(normal, 2), false);
});

test('pvpCard.skillList：启用卡每张 4 个技能，主城/金矿为 0', () => {
    const source = JSON.parse(readFileSync('assets/remoteRef/pvpCard.json', 'utf8')) as {
        k: string[];
        v: unknown[][];
    };
    const idAt = source.k.indexOf('id');
    const enabledAt = source.k.indexOf('enabled');
    const listAt = source.k.indexOf('skillList');
    const counts = new Map<string, number>();
    for (const row of source.v) {
        if (Number(row[enabledAt]) !== 1) continue;
        const list = row[listAt];
        counts.set(String(row[idAt]), Array.isArray(list) ? list.length : 0);
    }
    // 一行两格 × 每格两个按钮 ⇒ 4 个技能刚好铺满，多出来的会被视图隐藏。
    for (const [id, count] of counts) {
        assert.ok(count === 0 || count === 4, `卡 ${id} 的 skillList 是 ${count} 条（应为 0 或 4）`);
        if (count === 4) {
            for (const skillId of (source.v.find((row) => String(row[idAt]) === id)?.[listAt] as number[])) {
                assert.ok(TABLE.has(skillId), `卡 ${id} 的技能 ${skillId} 在 armySkillLevelUp 里查不到`);
            }
        }
    }
});
