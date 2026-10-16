/**
 * 角色攻击力汇总的回归网（`RolePowerTable.totalAttackOf`，纯函数、零 `cc`）。
 *
 * ## 为什么要有这条
 *
 * 「攻击力」是**纯客户端算**的（服务端 `CmdRole` 只给灵宠加成），链路是
 * 装备/禁军属性袋 → skillAttrModifier 修饰 → 默认值。任何一环取错都是**静默错数字**
 * （界面照常显示一个值，没人看得出少算了），所以逐个分项钉住。
 *
 * 口径全部照老端 `ModelTeam.GetTotalAtk()` + `VOEquipItem.GetFightAttr()` 抄，
 * 表结构对新端 `assets/remoteRef/{equipLevel,equipRank,equipLib,skillAttrModifier}.json`（已核对）。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    ATK_ATTR, EQUIP_ATK_ATTR, equipRankOf, totalAttackOf,
} from '../assets/script/app/role/RolePowerTable';
import type { IPowerTables } from '../assets/script/app/role/RolePowerTable';

/** 造一套最小表：等级 1/2、阶 1 的 qualityLevel 2/3（含 add1/add3，**故意不给 add4**）。 */
function tables(overrides: Partial<IPowerTables> = {}): IPowerTables {
    return {
        equipLevel: new Map([
            [1, { attack: 10, hpPer: 100 }],
            [2, { attack: 25, hpPer: 200 }],
        ]),
        equipRank: new Map([
            ['1|2', { attack: 6, hpPer: 600, add1: 3, add2: 4, add3: 5 }],
            ['1|3', { attack: 8, hpPer: 800, add1: 4, add2: 5, add3: 6 }],
        ]),
        equipLib: new Map([
            [101, { attribute: ATK_ATTR }],
            [102, { attribute: '生命值' }],
        ]),
        skillAttrModifier: new Map([
            [900, { modify: [{ type: '修改属性', data: { [ATK_ATTR]: 7, 生命值: 99 } }] }],
            [901, { modify: [{ type: '其他', data: { [ATK_ATTR]: 1000 } }] }],
        ]),
        roleDefaultAtk: 5,
        ...overrides,
    };
}

test('空装备 + 无修饰 ⇒ 只剩 gameConfig 默认值', () => {
    assert.equal(totalAttackOf([], [], tables()), 5);
});

test('单件装备：装备攻击力 = equipLevel.attack + equipRank.attack', () => {
    // 等级 1 → 10，阶 1/品质 2 → 6 ⇒ 16，加默认 5
    const atk = totalAttackOf([{ level: 1, rank: 1, qualityLevel: 2, effects: [] }], [], tables());
    assert.equal(atk, 10 + 6 + 5);
});

test('多件装备累加（6 格）', () => {
    const parts = Array.from({ length: 6 }, () => ({ level: 2, rank: 1, qualityLevel: 3, effects: [] }));
    // 每件 25 + 8 = 33 ⇒ 198
    assert.equal(totalAttackOf(parts, [], tables()), 33 * 6 + 5);
});

test('阶表查不到 ⇒ 退一档（qualityLevel-1）', () => {
    const t = tables();
    // 品质 4 没有 ⇒ 退到 1|3（8）
    assert.equal(equipRankOf(t, 1, 4)?.attack, 8);
    // 品质 2 恰好命中
    assert.equal(equipRankOf(t, 1, 2)?.attack, 6);
    // 都查不到 ⇒ null（不抛）
    assert.equal(equipRankOf(t, 99, 99), null);
});

test('阶表完全没有该装备 ⇒ 只算等级那份，且不抛', () => {
    const atk = totalAttackOf([{ level: 2, rank: 5, qualityLevel: 1, effects: [] }], [], tables());
    assert.equal(atk, 25 + 5);
});

test('tlEffects 按序号取 add1/add2/add3，属性名由 equipLib 解', () => {
    // effects = [101, 102] ⇒ 攻击力 += add1(4)、生命值 += add2(5)
    const atk = totalAttackOf([{ level: 1, rank: 1, qualityLevel: 3, effects: [101, 102] }], [], tables());
    // 等级 10 + 阶 8 + 附加攻击力 4 + 默认 5
    assert.equal(atk, 10 + 8 + 4 + 5);
});

test('⚠️ 第 4 项附加属性（add4 表里没有）按 0 算，不能让整条变成 NaN', () => {
    // 同一属性名挂 4 项：add1(3) + add2(4) + add3(5) + add4(缺列 ⇒ 0)
    const atk = totalAttackOf([{ level: 1, rank: 1, qualityLevel: 2, effects: [101, 101, 101, 101] }], [], tables());
    assert.ok(Number.isFinite(atk), `实际 ${atk}`);
    assert.equal(atk, 10 + 6 + (3 + 4 + 5 + 0) + 5);
});

test('equipLib 查不到的 attrId 直接跳过（不许写进一个 undefined 键）', () => {
    const atk = totalAttackOf([{ level: 1, rank: 1, qualityLevel: 3, effects: [999] }], [], tables());
    assert.equal(atk, 10 + 8 + 5);
});

test('skillAttrModifier：只认 type === "修改属性"，其它 type 不计', () => {
    // 900 生效（+7），901 是 '其他'（+1000 必须被忽略）
    const atk = totalAttackOf([], [900, 901], tables());
    assert.equal(atk, 7 + 5);
});

test('modifyIds 里有查不到的 id ⇒ 跳过不抛', () => {
    assert.equal(totalAttackOf([], [123456], tables()), 5);
});

test('roleDefaultAtk 缺失/为 0 时不炸（表里实际就是 0）', () => {
    const atk = totalAttackOf([], [], tables({ roleDefaultAtk: 0 }));
    assert.equal(atk, 0);
});

test('结果取整且恒为有限数', () => {
    const atk = totalAttackOf([{ level: 1, rank: 1, qualityLevel: 2, effects: [] }], [], tables());
    assert.equal(atk, Math.round(atk));
    assert.ok(Number.isFinite(atk));
});
