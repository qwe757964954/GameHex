import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

test('真实详情仓库返回完整卡库与最新缓存等级，不借用卡库为空的首帧快照', async () => {
    const catalog = [{ id: '1' }, { id: '2' }, { id: '3' }];
    let infos: Array<{ heroId: number; level: number }> | null = [{ heroId: 2, level: 7 }];
    let networkCalls = 0;
    const exports: Record<string, any> = {};
    const code = ts.transpileModule(readFileSync('assets/script/app/card/CardRepository.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    runInNewContext(code, { exports, console, require: name => {
        if (name === './CardLineupDecks') return { loadPvpCatalogCards: async () => catalog, currentDeckBonuses: () => ({}) };
        if (name === './LineupSnapshot') return { readLineupSnapshot: () => ({ cards: [catalog[0]], levels: { '1': 4 } }) };
        if (name === './PvpHeroService') return {
            getCachedPvpHeroInfos: () => infos,
            fetchPvpHeroInfos: () => { networkCalls++; throw new Error('切卡不应发起英雄列表请求'); },
        };
        return {};
    } });
    const repository = new exports.RuntimeCardRepository();
    assert.equal(repository.loadLineupSnapshot().catalog.length, 0);
    const data = await repository.loadDetailNavigation();
    assert.equal(data.catalog, catalog);
    assert.equal(data.heroLevels.get('2'), 7);
    assert.equal(data.heroListKnown, true);
    infos = [{ heroId: 2, level: 8 }];
    assert.equal((await repository.loadDetailNavigation()).heroLevels.get('2'), 8);
    infos = null;
    const offline = await repository.loadDetailNavigation();
    assert.equal(offline.catalog, catalog);
    assert.equal(offline.heroListKnown, false);
    assert.equal(offline.heroLevels.size, 0);
    assert.equal(networkCalls, 0);
});
