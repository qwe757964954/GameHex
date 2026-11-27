/**
 * 装备锻造红点判定的回归网（`RoleEquipRedDotTable`，纯函数、零 `cc`）。
 *
 * 红点错了不会报错：只是该亮的不亮、或亮了点不动。角色页 / 锻造弹窗 / 底栏入口现在共用
 * 这一份判定，所以口径的边界（满级、缺行、材料不够、洗炼未开放）必须有用例钉住。
 *
 * 覆盖的事实：
 * 1. 强化：等级 0（分页查不到）/ 满级 / 无下一级行 / 材料不足都不亮；
 * 2. 升品：消耗取**当前品阶行** `cost`（与锻造页展示一致），下一阶不存在 = 满品；
 * 3. 洗炼：`libCount < 2` 未开放，即使材料够也不亮；
 * 4. 汇总恒返回 6 项（缺部位按 false 补），整页 = 三项的并集。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    EQUIP_MAX_LEVEL,
    buildEquipRedDots,
    canStrengthenEquip,
    canUpgradeEquip,
    canWashEquip,
    emptyEquipRedDots,
    type IEquipPartCostFacts,
} from '../assets/script/app/role/RoleEquipRedDotTable';

/** 造一个部位的消耗事实（只写用例关心的字段，其余给「刚好不能操作」的默认值）。 */
const facts = (extra: Partial<IEquipPartCostFacts> = {}): IEquipPartCostFacts => ({
    partId: 1,
    level: 10,
    hasNextLevel: true,
    nextLevelGold: 200,
    nextLevelDrawings: 5,
    nextRankCost: null,
    washLibCount: 0,
    washCost: null,
    ownedGold: 1000,
    ownedDrawings: 10,
    ownedMaterial: 100,
    ...extra,
});

test('强化：金币与强化道具都够才亮', () => {
    assert.equal(canStrengthenEquip(facts()), true);
    assert.equal(canStrengthenEquip(facts({ ownedGold: 199 })), false);
    assert.equal(canStrengthenEquip(facts({ ownedDrawings: 4 })), false);
});

test('强化：等级 0 / 满级 / 无下一级行都不亮', () => {
    assert.equal(canStrengthenEquip(facts({ level: 0 })), false);
    assert.equal(canStrengthenEquip(facts({ level: EQUIP_MAX_LEVEL })), false);
    assert.equal(canStrengthenEquip(facts({ hasNextLevel: false })), false);
});

test('升品：消耗取当前品阶行，材料够才亮', () => {
    assert.equal(canUpgradeEquip(facts({ nextRankCost: 30, ownedMaterial: 30 })), true);
    assert.equal(canUpgradeEquip(facts({ nextRankCost: 30, ownedMaterial: 29 })), false);
    assert.equal(canUpgradeEquip(facts({ nextRankCost: null })), false);
    assert.equal(canUpgradeEquip(facts({ nextRankCost: 0 })), false);
});

test('洗炼：词条位不足 2 不开放，材料够也不亮', () => {
    assert.equal(canWashEquip(facts({ washLibCount: 1, washCost: 10 })), false);
    assert.equal(canWashEquip(facts({ washLibCount: 2, washCost: null })), false);
    assert.equal(canWashEquip(facts({ washLibCount: 2, washCost: 10, ownedMaterial: 10 })), true);
    assert.equal(canWashEquip(facts({ washLibCount: 2, washCost: 10, ownedMaterial: 9 })), false);
});

test('汇总：恒返回 6 项，缺部位按 false 补，整页 = 三项并集', () => {
    const dots = buildEquipRedDots([
        facts({ partId: 2, level: 0 }),
        facts({ partId: 4, hasNextLevel: false, nextRankCost: 30 }),
        facts({ partId: 6, hasNextLevel: false, washLibCount: 2, washCost: 10 }),
    ]);
    assert.equal(dots.parts.length, 6);
    assert.deepEqual(dots.parts.map(part => part.partId), [1, 2, 3, 4, 5, 6]);

    // 部位 2 等级 0 ⇒ 不可强化；部位 4 / 6 分别只有升品 / 洗炼。
    assert.equal(dots.parts[1].strengthen, false);
    assert.equal(dots.parts[1].any, false);
    assert.equal(dots.parts[3].upgrade, true);
    assert.equal(dots.parts[3].strengthen, false);
    assert.equal(dots.parts[5].wash, true);
    assert.equal(dots.parts[5].upgrade, false);

    assert.equal(dots.strengthen, false);
    assert.equal(dots.upgrade, true);
    assert.equal(dots.wash, true);
    assert.equal(dots.any, true);
});

test('空快照：6 项全 false', () => {
    const dots = emptyEquipRedDots();
    assert.equal(dots.any, false);
    assert.equal(dots.parts.length, 6);
    for (const part of dots.parts) {
        assert.equal(part.any, false);
    }
});
