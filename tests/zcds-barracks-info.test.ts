import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { findCatalogCard, resolveUnitDefinition } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import { buildZCBarracksInfo } from '../assets/script/app/zcds/model/ZCBarracksInfo';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';

function readRows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map(values => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

test('兵营信息按六维属性 + 四技能装配（金发老板 68029）', () => {
    const names = ['pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
        'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams', 'skillAttrModifier', 'generalStar',
        'pvpAttrMap', 'pvpModifierOverride', 'pvpUnitGrowth', 'pvpSkillBinding', 'pvpStatus', 'pvpSkillPlan'];
    loadPvpTables(Object.fromEntries(names.map(name => [name, readRows(name)])) as unknown as ZCPvpTables);

    const card = findCatalogCard('68029');
    assert.ok(card, '68029 金发老板必须在本局卡池');
    const definition = resolveUnitDefinition(card.unitId);
    const low = buildZCBarracksInfo(card, definition, 1);
    assert.equal(low.name, '金发老板');
    assert.equal(low.stats.length, 6);
    assert.deepEqual(low.stats.map(row => row.label), [
        '兵种血量', '兵种攻击', '攻击间隔', '产兵间隔', '兵种射程', '兵种移速',
    ]);
    assert.equal(low.stats[0].value, String(Math.round(definition.maxHp)));
    assert.equal(low.skills.length, 4);
    assert.equal(low.skills[0].name, '菌甲厚化');
    assert.equal(low.skills[0].unlocked, false, '1 级时解锁等级 3 的技能应显示锁定');
    assert.equal(low.skills[0].passive, true);

    const high = buildZCBarracksInfo(card, definition, 5);
    assert.equal(high.skills[0].unlocked, true);
    assert.ok(high.skills[0].description.includes('最大生命'));
});
