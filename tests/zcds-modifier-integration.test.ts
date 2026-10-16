import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ZCGameModel } from '../assets/script/app/zcds/model/ZCGameModel';
import { configureZCMap } from '../assets/script/app/zcds/model/ZCMapConfig';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { captureZCMatchConfig, withZCGeneralStarSelections } from '../assets/script/app/zcds/model/ZCMatchConfig';

function readRows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(
        source.k.map((key, index) => [key, values[index]]),
    ));
}

test('客户端武将星级选择经真实旧表进入本局有效属性且按阵营隔离', () => {
    //  `pvpUnit` 已于 2026-09-20 并入 `pvpCard`（单位列内联、加 `unit` 前缀），表已下线。
    const names = [
        'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
        'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams', 'pvpBaseTeamWeight',
        'skillAttrModifier', 'generalStar',
    ];
    const tables = Object.fromEntries(names.map((name) => [name, readRows(name)])) as unknown as ZCPvpTables;
    loadPvpTables(tables);
    configureZCMap(JSON.parse(readFileSync('tests/fixtures/zcds-legacy-map.json', 'utf8')));

    const base = captureZCMatchConfig();
    const match = withZCGeneralStarSelections(base, {
        player: [{ generalId: 68001, star: 1 }],
    });
    const model = new ZCGameModel(null, () => .1, match);
    const catalogAttack = model.definitionForUnit('68001').attack;

    assert.equal(catalogAttack, 12);
    assert.equal(model.effectiveDefinitionForUnit('player', '68001').attack, 92);
    assert.equal(model.effectiveDefinitionForUnit('enemy', '68001').attack, 12);
    assert.equal(match.modifiers?.player[0].rawAttributes.攻击力, 80);
    assert.ok(match.modifiers?.player[0].unsupportedAttributes.includes('弓兵武将技能箭矢数量'));
});

