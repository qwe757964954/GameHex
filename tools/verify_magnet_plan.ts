/**
 * 复现「磁电菇子弹看不见」：加载真实配表 → 编译单位目录 → 跑资源计划，
 * 打印雷蕉（68022）的 attackProfile 与本局 effectPaths 里有没有磁电菇。
 */
import { readFileSync } from 'node:fs';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { getAllUnitDefinitions } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import { getZCModifierCatalogs } from '../assets/script/app/zcds/model/ZCModifierRuntime';
import { buildZCVisualResourcePlan } from '../assets/script/app/zcds/model/ZCVisualResourcePlan';
import { zcMissileFxPaths } from '../assets/script/app/zcds/model/ZCCombatEffectFlight';

const TABLE_NAMES = [
    'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams', 'pvpBaseTeamWeight',
    'skillAttrModifier', 'generalStar', 'pvpAttrMap', 'pvpModifierOverride',
    'pvpUnitGrowth', 'pvpSkillBinding', 'pvpStatus', 'pvpSkillPlan',
];

function readRows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

const tables: Record<string, unknown> = { pvpSkill: readRows('pvpSkill') };
for (const name of TABLE_NAMES) tables[name] = readRows(name);
loadPvpTables(tables as unknown as ZCPvpTables);

const all = getAllUnitDefinitions();
const leijiao = all.find((u) => u.unitId === '68022');
console.log('68022 定义存在:', !!leijiao);
if (leijiao) {
    console.log('attackProfile.effectPrefabPath =', leijiao.attackProfile.effectPrefabPath);
    console.log('attackProfile.impactEffectPrefabPath =', leijiao.attackProfile.impactEffectPrefabPath);
    console.log('empoweredProfile =', (leijiao as { empoweredProfile?: { effectPrefabPath?: string } }).empoweredProfile?.effectPrefabPath ?? '(无)');
}

const adapters = getZCModifierCatalogs().adapters;
const plan = buildZCVisualResourcePlan(all, adapters, [68022], {});
console.log('\n本局 units:', plan.units.map((u) => u.unitId));
console.log('本局 effectPaths:');
for (const p of plan.effectPaths) console.log('  ', p);
console.log('\n磁电菇弹体在清单里:', plan.effectPaths.includes('units/projectiles/磁电菇_子弹攻击/磁电菇_子弹攻击'));
console.log('磁电菇命中在清单里:', plan.effectPaths.includes('units/projectiles/磁电菇_子弹命中/磁电菇_子弹命中'));
console.log('\n（对照）导弹常量表路径：', zcMissileFxPaths());
