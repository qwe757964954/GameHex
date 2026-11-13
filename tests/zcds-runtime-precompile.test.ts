import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ensureZCRuntimeCompiled, ZC_RUNTIME_TABLE_NAMES } from '../assets/script/app/zcds/application/ZCRuntimePrecompiler';
import type { ConfigService } from '../assets/script/core/config/ConfigService';
import { ZC_RUNTIME_CONFIG } from '../assets/script/app/zcds/model/ZCRuntimeConfigStore';
import { getPlayerDeck, getAllUnitDefinitions, findCatalogCard, setCardRarityMeta, rarityDisplayName } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import { getPvpRuntimeRules } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import {
    isZCRuntimeCompiled,
    loadPvpTables,
    resetZCRuntime,
    type ZCPvpTables,
} from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';

function rows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) =>
        Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

test('编译标志随 loadPvpTables 置位、resetZCRuntime 复位', () => {
    resetZCRuntime();
    assert.equal(isZCRuntimeCompiled(), false);
    const names = [
        'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
        'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams',
    ];
    loadPvpTables(Object.fromEntries(names.map((name) => [name, rows(name)])) as ZCPvpTables);
    assert.equal(isZCRuntimeCompiled(), true, '编译安装成功后标志置位');
    assert.ok(getAllUnitDefinitions().length > 0);
    assert.ok(getPlayerDeck().length > 0);
    const cardId = getPlayerDeck()[0].id;
    resetZCRuntime();
    assert.equal(isZCRuntimeCompiled(), false, '退出登录复位后强制下次重新编译');
    assert.deepEqual(ZC_RUNTIME_CONFIG.snapshot, {});
    assert.deepEqual(getAllUnitDefinitions(), []);
    assert.deepEqual(getPlayerDeck(), []);
    assert.equal(findCatalogCard(cardId), null);
    assert.throws(() => getPvpRuntimeRules(), /未加载/);
});

test('真实预编译入口并发只读取一套表，已编译后跳过初始化', async () => {
    resetZCRuntime();
    let getTableCalls = 0;
    let initializeCalls = 0;
    const configs: ConfigService = {
        initialize: async () => { initializeCalls++; },
        async getTable<T>(name: string): Promise<readonly T[]> {
            getTableCalls++;
            return rows(name) as unknown as T[];
        },
    };
    const first = ensureZCRuntimeCompiled(configs);
    assert.strictEqual(ensureZCRuntimeCompiled(configs), first);
    assert.equal(await first, true);
    assert.equal(await ensureZCRuntimeCompiled(configs), true);
    assert.equal(initializeCalls, 1);
    assert.equal(getTableCalls, ZC_RUNTIME_TABLE_NAMES.length);
    assert.ok(ZC_RUNTIME_CONFIG.snapshot.neutralResources.items.size > 0);
    resetZCRuntime();
});

test('编译安装保留同会话品级外观，reset 清除外观覆盖', async () => {
    setCardRarityMeta([{ id: 0, name: '测试金卡', sort: 0 }]);
    await ensureZCRuntimeCompiled({ initialize: async () => {}, async getTable<T>(name: string) {
        return rows(name) as unknown as T[];
    } });
    assert.equal(rarityDisplayName(0), '测试金卡');
    resetZCRuntime();
    assert.notEqual(rarityDisplayName(0), '测试金卡');
});
