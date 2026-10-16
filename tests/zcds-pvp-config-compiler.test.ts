import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as runtimeConfig from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { getCounterRules } from '../assets/script/app/zcds/model/ZCCombatCatalog';

function rows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

function tables(): runtimeConfig.ZCPvpTables {
    const names = [
        'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
        'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams', 'pvpBaseTeamWeight',
    ];
    return Object.fromEntries(names.map((name) => [name, rows(name)])) as runtimeConfig.ZCPvpTables;
}

test('编译 PVP 表得到完整结果，且不会安装为全局运行时配置', () => {
    assert.equal(typeof runtimeConfig.compilePvpTables, 'function');
    assert.throws(() => runtimeConfig.getPvpRuntimeRules(), /未加载/);
    const compiled = runtimeConfig.compilePvpTables(tables());
    assert.ok(compiled.units.size > 0);
    assert.ok(compiled.cards.length > 0);
    assert.ok(compiled.playerDeck.length > 0);
    assert.equal(compiled.rules.sourceSha256, 'remoteRef');
    assert.throws(() => runtimeConfig.getPvpRuntimeRules(), /未加载/);
});

test('失败的表编译不会改变已安装的运行时规则', () => {
    const valid = tables();
    runtimeConfig.loadPvpTables(valid);
    const before = runtimeConfig.getPvpRuntimeRules();
    assert.throws(() => runtimeConfig.compilePvpTables({ ...valid, pvpArtifact: [] }), /pvpArtifact/);
    assert.strictEqual(runtimeConfig.getPvpRuntimeRules(), before);
});

test('缺主城卡时在配置边界报明确错误', () => {
    const valid = tables();
    const pvpCard = (valid.pvpCard ?? []).filter((row) => row.type !== 5 && row.type !== '5');
    assert.throws(() => runtimeConfig.compilePvpTables({ ...valid, pvpCard }), /主城/);
});

test('重载合法空克制表会清除上一次安装的规则', () => {
    const valid = tables();
    runtimeConfig.loadPvpTables(valid);
    assert.ok(getCounterRules().length > 0);
    runtimeConfig.loadPvpTables({ ...valid, pvpCounter: [] });
    assert.deepEqual(getCounterRules(), []);
});
